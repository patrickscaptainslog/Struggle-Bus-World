import * as THREE from 'three';
import { config } from '../config';
import { SHADOW_LAYER, makeRampMaterial, globals } from '../render/materials';
import { Ramp } from '../render/palette';
import { makeBuildingMaterial, paintUniforms } from './buildingMaterial';
import { makeHeightGrid, makeTerrainMaterial, makeWaterMaterial } from './terrainMaterial';
import { farBlockMesh, farFlags, farTowerLooks, farWallLo, makeFarBlockMaterial, makeFarGroundMaterial, makeFarTextures, makeFarTowerMaterial, type FarTextures } from './farMaterial';
import { mergeFarBlocks, type FarBlockChunk, type FarBlocksRequest, type FarBlocksResult } from './farBlocks';
import { PaintState, LANDMARK_KEY_PREFIX } from './PaintState';
import { GroundPaint } from './GroundPaint';
import type { ObstaclePost } from './Bridges';
import { meshHeights, parseFar, parseFarRaster, WATER_Y, type CityManifest, type FarData, type FarRaster, type FarTowers, type BuildingTile, type TerrainTile } from './tiles';
import { loadRegion, type GridArrays, type RegionRequest, type RegionResponse, type TileResult } from './regionLoader';
import { GROWN_STRIDE, type CasterArrays, type MeshArrays } from './BuildingMesher';
import { treeCrown } from './props/trees';
import { RoofBuild, eaveY, newRoofFrame, roofFrame, roofSurfaceY, type RoofFrame } from './roofGeom';
import { FAR_STAND_INS, HIDDEN, hiddenAt, isSfOrigin, type Hidden, type PropBox } from './towerStyles';
import { gunzip, isGzip } from './gunzip';
import { registerWarm } from '../render/warmup';

// Streams the baked city around the bus: region bundles are fetched and
// meshed in a worker, tiles appear inside the fog, far ones are dropped.
// Also answers the questions gameplay asks: how high is the ground here,
// what's the tallest thing under this point, which buildings are near.

/** One building (all of its LiDAR tiers): what gameplay paints, aims at and names. */
export interface BuildingRef {
  index: number;
  stableId: number; // (< 0 for a landmark: its paint is saved under its 'lm:' key)
  tile: BuildingTile; // (a landmark's is a one-record tile of its own: its base ring)
  local: number; // record of the ground tier (the footprint) within the tile
  parts: number; // records [local, local + parts) are this building's tiers
  top: number; // record of the highest tier
  cx: number;
  cz: number;
  baseY: number; // ground
  roofY: number; // top of the highest tier (a built mapped roof's ridge / apex: its eave + roofH)
  /** per record of `tile` (shared by the tile's refs): how its mapped roof is built (RoofBuild; FLAT = flat at roofY) */
  roofBuild: Uint8Array;
  area: number; // footprint area
  hood: number;
  /** footprint bounds (its ground-tier rings) and the farthest footprint vertex from (cx, cz) (m) */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  rad: number;
  /** area-index query stamp (dedupes a ref listed in several cells; no allocation) */
  q: number;
}

/** A result list of buildingsNear, with the entries it can use again. */
type NearList = Array<{ ref: BuildingRef; d: number }> & { pool?: Array<{ ref: BuildingRef; d: number }> };

/** Scratch list for the prop stamp's building queries (no allocation per cell). */
const stampNear: Array<{ ref: BuildingRef; d: number }> = [];

/** Distance from (x, z) to the edges of record k's ring (m). */
function ringDist(b: BuildingTile, k: number, x: number, z: number): number {
  const s = b.vertStart[k], e = b.vertStart[k + 1];
  let d = Infinity;
  for (let i = s, j = e - 1; i < e; j = i++) d = Math.min(d, segDist(b.xz[j * 2], b.xz[j * 2 + 1], b.xz[i * 2], b.xz[i * 2 + 1], x, z));
  return d;
}

/** Distance from (x, z) to the segment a-b (m). */
function segDist(ax: number, az: number, bx: number, bz: number, x: number, z: number): number {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

interface LoadedTile {
  tx: number;
  tz: number;
  buildings: THREE.Mesh | null;
  /** full-detail tiles: the buildings' sun-pass proxy (SHADOW_LAYER only; the detailed mesh doesn't cast) */
  caster: THREE.Mesh | null;
  terrain: THREE.Mesh | null;
  terrainData: TerrainTile | null;
  buildingData: BuildingTile | null;
  refs: BuildingRef[];
  classTex: THREE.DataTexture | null;
  /** tallest thing in the tile (m ASL) */
  maxY: number;
  /** hidden because it's buried in solid fog (seen from above the marine layer) */
  hidden: boolean;
  /** grid step of its own ground mesh (2 = 4 m detailed, 4 = 8 m like a coarse region's), 0 = none */
  terrainStep: number;
  /** a ground grid the worker built, until a ground mesh takes it (later rebuilds make their own) */
  grid: GridArrays | null;
  /** the heights those rebuilds mesh (tiles.ts meshHeights), kept: a coarse region remakes every tile's grid for each tile a blast first touches */
  meshH: Float32Array | null;
  /** its painted towers' collapsed growth elements (BuildingMesher GROWN_STRIDE records), or null */
  grown: Float32Array | null;
  /** a building of the tile has grown its gardens / domes: its mesh draws its growth triangles */
  growthShown: boolean;
  /** a swap to detail on its way: this tile's meshes, made and uploaded ahead, shown by the swap's commit */
  prep: TilePrep | null;
}

/** A tile's meshes for a swap to detail, waiting for the swap's commit (they go up to the GPU unseen: see City.ghost). */
interface TilePrep {
  buildings: THREE.Mesh | null;
  caster: THREE.Mesh | null;
  grown: Float32Array | null;
  terrain: TileGround | null;
}

/** A tile's own ground, made but not attached yet (ground paint attaches when it replaces the old one). */
interface TileGround {
  mesh: THREE.Mesh;
  classTex: THREE.DataTexture;
  gu: ReturnType<GroundPaint['tileUniforms']>;
  step: number;
}

/** A coarse region drawn as two meshes (its tiles keep their data for gameplay queries). */
interface RegionMesh {
  buildings: THREE.Mesh | null;
  terrain: THREE.Mesh | null;
  classTex: THREE.DataTexture | null;
  hidden: boolean;
}

/** Work queued for adoption, a few items per frame. */
type Adopt =
  /** one tile of a newly arrived region (coarse: its meshes come with the region item) */
  | { kind: 'tile'; key: string; bytes: number; t: TileResult; coarse: boolean }
  /** after a coarse region's tiles: its merged meshes */
  | { kind: 'coarse'; key: string; bytes: number; msg: RegionResponse }
  /** before a swap to detail: one tile's meshes made and uploaded unseen, its obstacle cells raised, so the swap only commits */
  | { kind: 'prep'; key: string; bytes: number; t: TileResult }
  /** an adopted region switching level of detail, all at once */
  | { kind: 'swap'; key: string; bytes: number; msg: RegionResponse };

async function maybeInflate(buf: ArrayBuffer): Promise<ArrayBuffer> {
  return isGzip(buf) ? await gunzip(buf) : buf;
}

/** The boot downloads index.html starts before the game's script has even loaded (see its inline script). */
type BootFetches = { base: string; manifest: Promise<Response>; far: Promise<Response>; horizon: Promise<Response> };
/** A boot download index.html started for the city at `base` (city.json, far.bin, horizon.bin), handed out once; else null. */
export function bootFetch(base: string, what: 'manifest' | 'far' | 'horizon'): Promise<Response> | null {
  const b = (globalThis as { __sbBoot?: Partial<BootFetches> }).__sbBoot;
  if (!b || b.base !== base || !b[what]) return null;
  const p = b[what]!;
  delete b[what];
  return p;
}

/** The data's version for a URL under /city/ (index.html sets it; ARCHITECTURE "Re-baking a city"), '' on a page without it. */
export function dataQuery(): string {
  const v = (globalThis as { __sbDataV?: string }).__sbDataV;
  return v ? `?v=${v}` : '';
}

/** A tile's (or a coarse region's) building mesh: the one place its vertex layout is set. `cast`: it is its own sun-pass caster. */
function buildingMesh(m: MeshArrays, material: THREE.Material, cast: boolean): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3, true));
  g.setAttribute('aFacade', new THREE.BufferAttribute(m.facade, 2));
  g.setAttribute('aMeta', new THREE.BufferAttribute(m.meta, 4));
  g.setAttribute('aBld', new THREE.BufferAttribute(m.bld, 4));
  g.setAttribute('aBld2', new THREE.BufferAttribute(m.bld2, 2));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  const mesh = new THREE.Mesh(g, material);
  if (cast) mesh.layers.enable(SHADOW_LAYER);
  mesh.userData.sunCull = true; // (the sun pass skips it when its shadow can't reach the view)
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false; // (static, at the origin: the graph update skips it)
  return mesh;
}

/** A detailed tile's sun-pass proxy: positions only, on the shadow camera's layer alone. */
function casterMesh(c: CasterArrays): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(c.position, 3));
  g.setIndex(new THREE.BufferAttribute(c.index, 1));
  const mesh = new THREE.Mesh(g, CASTER_MATERIAL); // (the sun pass draws it with its depth override)
  mesh.layers.set(SHADOW_LAYER);
  mesh.userData.sunCull = true;
  mesh.userData.sbKind = 'caster';
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  return mesh;
}

/** A tile's own ground mesh (a coarse region's merged ground is the same, without the shadow layer). */
function groundMesh(geo: THREE.BufferGeometry, material: THREE.Material, casts: boolean): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  if (casts) mesh.layers.enable(SHADOW_LAYER);
  mesh.userData.sunCull = true;
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  return mesh;
}

/** The far skyline's boxes: the ramp material, hiding the boxes over loaded tiles (mask) in its vertex shader. */
function makeSkylineMaterial(mask: THREE.Texture, rect: THREE.Vector4, size: THREE.Vector2): THREE.ShaderMaterial {
  const mat = makeRampMaterial({
    ramp: Ramp.GREY,
    lightOffset: 0.02,
    uniforms: { uMask: { value: mask }, uMaskRect: { value: rect }, uMaskSize: { value: size } },
    vertexChunk: /* glsl */ `
      {
        vec3 wc = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        ivec2 mc = ivec2(floor((wc.xz - uMaskRect.xy) * uMaskRect.z));
        mc = clamp(mc, ivec2(0), ivec2(uMaskSize) - 1);
        if (texelFetch(uMask, mc, 0).r > 0.5) p *= 0.0;
      }
    `,
  });
  // declare the mask uniforms in the vertex shader
  mat.vertexShader = mat.vertexShader.replace('void main() {', 'uniform sampler2D uMask;\nuniform vec4 uMaskRect;\nuniform vec2 uMaskSize;\nvoid main() {');
  return mat;
}

/** The far terrain and the horizon hills: per-vertex ramps (vertexRamp attributes, all float), or `material` over the same layout. */
function farGridMesh(pos: Float32Array, nrm: Float32Array, ramp: Float32Array, lo: Float32Array, gl: Float32Array, index: THREE.BufferAttribute | number[], shadowMul: number, material?: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('ramp', new THREE.BufferAttribute(ramp, 1));
  g.setAttribute('lightOffset', new THREE.BufferAttribute(lo, 1));
  g.setAttribute('glow', new THREE.BufferAttribute(gl, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material ?? makeRampMaterial({ vertexRamp: true, shadowMul }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * The horizon hills' material: green over the 40 m contour, pale under it, chosen per pixel. A 256 m cell is far too big for a vertex to choose: flat, the
 * contour saws into teeth a cell wide; interpolated, it passes through ramps nobody chose. 37: buildHorizon's mesh stands 3 m under the DEM.
 */
const makeHorizonMaterial = () => makeRampMaterial({ vertexRamp: true, shadowMul: 0, rampAbove: { y: 37, below: Ramp.GREY_LIGHT, above: Ramp.GREEN_GREY } });

// Shader warm-up (render/warmup.ts): one of every mesh streaming makes later, made by the same
// functions: a building tile (its vertex layout from the worker's mesher), a tile's own ground (and
// a coarse region's: same program), the far terrain, the horizon and the far skyline.
registerWarm('city', () => {
  const v = 3;
  const m: MeshArrays = {
    position: new Float32Array(v * 3),
    normal: new Int8Array(v * 3),
    facade: new Float32Array(v * 2),
    meta: new Uint8Array(v * 4),
    bld: new Float32Array(v * 4),
    bld2: new Float32Array(v * 2),
    index: new Uint16Array([0, 1, 2]),
    vertexCount: v,
    solidIndexCount: 3,
  };
  const tex = new THREE.DataTexture(new Uint8Array(4), 2, 2, THREE.RedFormat, THREE.UnsignedByteType);
  const f = (n: number) => new Float32Array(n);
  return [
    buildingMesh(m, makeBuildingMaterial(), false),
    buildingMesh(m, makeBuildingMaterial(), true),
    casterMesh({ position: f(v * 3), index: new Uint16Array([0, 1, 2]), vertexCount: v }),
    groundMesh(makeHeightGrid(f(4), 2, 1, 0, 0, 1), makeTerrainMaterial(tex, 0, 0, 1, 2), true),
    farGridMesh(f(9), f(9), f(3), f(3), f(3), [0, 1, 2], 1),
    farGridMesh(f(9), f(9), f(3), f(3), f(3), [0, 1, 2], 0, makeHorizonMaterial()),
    new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), makeSkylineMaterial(tex, new THREE.Vector4(), new THREE.Vector2(1, 1)), 1),
    ...(farFlags.blocks ? [farBlockMesh({ count: 1, cell: new Uint16Array(4), y: new Int16Array(2), tone: new Uint8Array(4), sphere: new Float32Array(4) }, makeFarBlockMaterial([1, 0, 0, 0, 1, 0], tex, new THREE.Vector4(), new THREE.Vector2(1, 1))), farTowerMesh(new Float32Array(3), 1, makeFarTowerMaterial(tex, new THREE.Vector4(), new THREE.Vector2(1, 1)))] : []),
  ];
});

/** The far skyline's boxes on their towers' facade families (?farblocks): `looks` three floats a box. */
function farTowerMesh(looks: Float32Array, n: number, material: THREE.Material): THREE.InstancedMesh {
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  box.setAttribute('aTower', new THREE.InstancedBufferAttribute(looks, 3));
  return new THREE.InstancedMesh(box, material, n);
}

/** Point-in-ring test for record k of a building tile. */
function ringContains(b: BuildingTile, k: number, x: number, z: number): boolean {
  const s = b.vertStart[k], e = b.vertStart[k + 1];
  let inside = false;
  for (let i = s, j = e - 1; i < e; j = i++) {
    const xi = b.xz[i * 2], zi = b.xz[i * 2 + 1], xj = b.xz[j * 2], zj = b.xz[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const rectFrame = newRoofFrame();
/** roofRect's sample grid on a mapped roof: RECT_N x RECT_N roof heights (-Infinity off the ring), i along the ridge */
const RECT_N = 17;
const rectY = new Float64Array(RECT_N * RECT_N);

/** Share of the turf of a roof rect (in the roof frame f: center cs, ct; w along S, d along D) over record k's ring. */
function rectOnRing(b: BuildingTile, k: number, f: RoofFrame, cs: number, ct: number, w: number, d: number): number {
  const hw = Math.max(0, w - 0.9) / 2, hd = Math.max(0, d - 0.9) / 2;
  let n = 0;
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      const ss = cs + (hw * i) / 2, tt = ct + (hd * j) / 2;
      if (ringContains(b, k, f.cx + ss * f.Sx + tt * f.Dx, f.cz + ss * f.Sz + tt * f.Dz)) n++;
    }
  return n / 25;
}

/** Top of record k as drawn: a built mapped roof's ridge / apex (eave + rise), else its flat roof (roofY). */
function partTop(b: BuildingTile, kinds: Uint8Array, k: number): number {
  return kinds[k] !== RoofBuild.FLAT ? eaveY(b.baseY[k], b.roofY[k], b.tier[k]) + b.roofH[k] : b.roofY[k];
}

/** Roof height of record k at (x, z) inside its ring, as BuildingMesher draws it (a mapped roof's slope, else roofY). */
function partRoofAt(b: BuildingTile, kinds: Uint8Array, k: number, x: number, z: number): number {
  if (kinds[k] === RoofBuild.FLAT) return b.roofY[k];
  return roofSurfaceY(b.xz, b.vertStart[k], b.vertStart[k + 1], eaveY(b.baseY[k], b.roofY[k], b.tier[k]), b.roofH[k], b.roofShape[k], b.roofDir[k], x, z);
}

/** Area of record k's ring (m^2). */
function ringArea(b: BuildingTile, k: number): number {
  const s = b.vertStart[k], e = b.vertStart[k + 1];
  let a = 0;
  for (let i = s; i < e; i++) {
    const j = i + 1 < e ? i + 1 : s;
    a += b.xz[i * 2] * b.xz[j * 2 + 1] - b.xz[j * 2] * b.xz[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}

const tileKeyNum = (tx: number, tz: number) => (tx + 4096) * 8192 + (tz + 4096);

/**
 * Let a streamed mesh's arrays go once they're on the GPU: three keeps a JS
 * copy of every attribute otherwise (as much memory again as the geometry).
 * Nothing reads them back (bounds come with the mesh, nothing raycasts the
 * city); a lost GL context reloads every region (City.reloadAll).
 */
function dropAfterUpload(g: THREE.BufferGeometry) {
  for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(dropArray);
  g.index?.onUpload(dropArray);
}
function dropArray(this: THREE.BufferAttribute) {
  // (empty, of the same type: the warm-up reads a live object's vertex layout from it)
  const a = this as unknown as { array: Float32Array | Uint8Array | Int8Array | Uint16Array | Uint32Array };
  a.array = a.array.slice(0, 0);
}

/** New geometry a tile brings (its detailed mesh and caster, its ground), for the per-frame upload budget. */
function meshBytes(t: TileResult): number {
  let b = 0;
  const m = t.mesh;
  if (m) b += m.position.byteLength + m.normal.byteLength + m.facade.byteLength + m.meta.byteLength + m.bld.byteLength + m.bld2.byteLength + m.index.byteLength;
  if (t.caster) b += t.caster.position.byteLength + t.caster.index.byteLength;
  if (t.grid) b += t.grid.position.byteLength + t.grid.normal.byteLength + t.grid.index.byteLength;
  return b;
}

function mergedBytes(msg: RegionResponse): number {
  const m = msg.merged;
  return m ? m.position.byteLength + m.normal.byteLength + m.facade.byteLength + m.meta.byteLength + m.bld.byteLength + m.bld2.byteLength + m.index.byteLength : 0;
}
const LOAD_RADIUS = 1500; // m: regions whose center is within this get loaded
const DETAIL_RADIUS = 650; // m: regions nearer than this get full-detail meshes (bays, cornices, stoops)
const UNLOAD_RADIUS = 2300;
/** The loaded-tile mask over a FAR_STAND_INS tile with nothing loaded: its far boxes hide, and the far ground doesn't sink (farMaterial). */
const MASK_STAND_IN = 200;
// at altitude (viewHeight ~500 m) the circle widens (config.city.loadRadiusHigh); detail is judged by
// distance from the lens (and its fov), so high up everything is the coarse mesh
const UNLOAD_RADIUS_HIGH = 2800;
// arrived tiles adopted per frame: at least this many, more while under this many ms and this
// much new geometry (three uploads a mesh the first frame it's drawn: this bounds the upload per frame)
const ADOPT_MIN = 2;
const ADOPT_MS = 2.5;
const ADOPT_BYTES = 3 << 20;
/** The far boxes' chunks, in tiles a side (?farblocks; ?farchunk= overrides it): a region's 4, one draw each, none where the region is in. */
const FAR_CHUNK_TILES = 4;
/** A far box's roof in steps of this (m): equal tops merge. */
const FAR_TOP_STEP = 4;
const FAR_CHUNKS_A_FRAME = 8;
// (while the opening's fog is up everything lands at once, up to this much per frame: a deep link into
// downtown is ~100 MB of first uploads)
const ADOPT_BYTES_EAGER = 16 << 20;
// regions in flight at once: in play (budgeted), and while the opening's fog is up (`eager`: its
// whole first ring, ~8 regions, goes out together instead of two per frame)
const IN_FLIGHT = 2;
const OPENING_IN_FLIGHT = 10;
const HASH_CELL = 32;
/** never drawn: casters live on SHADOW_LAYER only, where the sun pass's depth override replaces it */
const CASTER_MATERIAL = new THREE.MeshBasicMaterial();
const crownTmp = { top: 0, mid: 0, r: 0 };
const byDistance = (a: [number, number, number, 0 | 1], b: [number, number, number, 0 | 1]) => a[2] - b[2];
/**
 * A mesh's ghost draw (see City.ghost): a real draw whose every fragment fails the depth test. (Not RASTERIZER_DISCARD:
 * ANGLE on Metal compiles a variant of the vertex shader for it, in flight; a depth func is only state.) three's
 * depth cache is told LEQUAL first, so its own setMaterial, right before the draw, leaves the func alone.
 */
const GHOST_ON = (r: THREE.WebGLRenderer) => {
  r.state.buffers.depth.setFunc(THREE.LessEqualDepth);
  r.getContext().depthFunc(WebGL2RenderingContext.NEVER);
};
const GHOST_OFF = (r: THREE.WebGLRenderer) => r.getContext().depthFunc(WebGL2RenderingContext.LEQUAL);

export class City {
  readonly root = new THREE.Group();
  readonly paint: PaintState;
  /** paint splattered on streets, sidewalks and parks (per-tile masks) */
  readonly ground: GroundPaint;
  readonly buildingMaterial = makeBuildingMaterial();
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { key: string; lod: 0 | 1 }>();
  private regionLod = new Map<string, 0 | 1>();
  private retryAt = new Map<string, number>();
  private failCount = new Map<string, number>();
  private regionsLoaded = new Set<string>();
  private regionsRequested = new Set<string>();
  private regionAvailable = new Set<string>();
  private tiles = new Map<string, LoadedTile>();
  /** the same tiles keyed by number (tileKeyNum): the per-frame ground / obstacle lookups build no strings */
  private tileNum = new Map<number, LoadedTile>();
  /** region keys and their coordinates, made once per region (the per-frame streaming loops build no strings) */
  private regionKeys = new Map<number, string>();
  private regionXZ = new Map<string, [number, number]>();
  private hash = new Map<number, BuildingRef[]>();
  /** area index: every ref in every HASH_CELL cell its footprint bounds overlap (aim / hit tests: a big
   * footprint is found wherever you aim into it, not only near its centroid) */
  private areaHash = new Map<number, BuildingRef[]>();
  private qStamp = 0;
  /** landmark/bridge collision posts, hashed in 64 m cells */
  private posts = new Map<number, ObstaclePost[]>();
  /** hand-built landmarks registered as paintable buildings (never unloaded) */
  private landmarks: LandmarkRec[] = [];
  private far: FarData | null = null;
  /** ?farmap: the far raster's class and height stay here for what comes next (far boxes, the low sun's sweep) */
  farRaster: Pick<FarRaster, 'W' | 'H' | 'affine' | 'cls' | 'height'> | null = null;
  /** ?farblocks: the far boxes' chunks as they stand, and what the worker reported */
  farBlocks: { ms: number; boxes: number; cells: number; chunks: Array<{ ci: number; cj: number; count: number; cell: Uint16Array; mesh: THREE.Mesh; x0: number; z0: number; x1: number; z1: number; tiles: number[] }> } | null = null;
  /** the merge is out, or chunks of it wait for their frame */
  private farBusy = false;
  private farLanding: FarBlockChunk[] = [];
  private farBlockMat: THREE.ShaderMaterial | null = null;
  private farChunkM = 0;
  private farGroup = new THREE.Group();
  private loadedMask: THREE.DataTexture;
  /** tiles whose far skyline boxes never show (FAR_STAND_INS) */
  private maskedForGood = new Set<string>();
  private maskW: number;
  private maskH: number;
  private regionSize: number;
  /** extension of the binary city files (hosts without a generic binary type serve them under another binary-safe extension) */
  private ext: string;
  /** Called for every tile that arrives (trees, props, landmarks hook in here). */
  onTile: ((t: { tx: number; tz: number; terrain: TerrainTile | null; refs: BuildingRef[] }) => void) | null = null;
  onTileUnload: ((tx: number, tz: number) => void) | null = null;
  readonly loadedRegionCount = () => this.regionsLoaded.size;
  /**
   * The bus is tearing through (set by the game each frame while a turbo gear lifts, drives or brakes): at 450 m/s
   * a detailed region is on screen for under a second, and swapping it in cost a frame in every two seconds. So
   * nothing changes level of detail while this holds: what arrives is coarse, what is loaded stays as it is, and
   * the classic streaming sorts out the detail once the bus has slowed down.
   */
  detailHold = false;
  /** Height of the view above the ground (m), set by the game each frame: widens streaming, coarsens detail. */
  viewHeight = 0;
  /** Where the lens stands (m): how far away the far boxes' chunks are. */
  viewX = 0;
  viewZ = 0;
  /** Detail scale of the lens: tan(cruise half-fov) / tan(current half-fov) (a wider lens needs less detail). */
  detailScale = 1;
  private want: Array<[number, number, number, 0 | 1]> = [];
  private adopt: Adopt[] = [];
  /** meshes on their first draw (see firstDraw), and frames run (the first one's meshes are drawn by that frame) */
  private firsts: THREE.Mesh[] = [];
  private framesRun = 0;
  /** coarse (LOD 1) regions: all their buildings / all their ground as one mesh each */
  private regionMeshes = new Map<string, RegionMesh>();
  /** tiles that keep their own ground mesh even inside a coarse region (see setOwnGround) */
  private ownGround = new Set<string>();
  /** San Francisco (the mesher's icons and HIDDEN tables, and hidden footprints in the refs, apply) */
  private readonly sf: boolean;
  /** hand-built props whose own surface replaces hidden footprints in the obstacle grid (setPropObstacles) */
  private propObstacles: Array<{ clear: Hidden; boxes: PropBox[] }> = [];
  /**
   * Adopt arrived tiles all at once (as soon as they land) instead of a few per
   * frame: the game sets it while the loading fog is up, so the first frame
   * matches the classic streaming exactly; afterwards adoption is budgeted.
   */
  eager = false;

  constructor(readonly manifest: CityManifest & { regions: Array<[number, number, number]>; regionSize: number }, readonly baseUrl: string) {
    this.paint = new PaintState(manifest.buildingCount + LANDMARK_SLOTS, manifest.slug);
    this.ground = new GroundPaint(manifest.tileSize, manifest.slug);
    this.sf = isSfOrigin(manifest.origin);
    // (a hidden stand-in's cells of the obstacle grid are open water again, or whatever else stands there)
    if (this.sf) for (const h of HIDDEN) if (h.clears) this.propObstacles.push({ clear: h, boxes: [] });
    // a blast's tiles get their own ground mesh first, so a coarse region (seen from altitude) shows the paint
    this.ground.onTilesTouched = (keys) => {
      for (const k of keys) {
        const [tx, tz] = k.split(',').map(Number);
        this.setOwnGround(tx, tz);
      }
    };
    paintUniforms.uPaint.value = this.paint.texture;
    paintUniforms.uPaintW.value = this.paint.width;
    this.regionSize = manifest.regionSize;
    this.ext = (manifest as { binExt?: string }).binExt ?? '.bin';
    for (const [rx, rz] of manifest.regions) this.regionAvailable.add(`${rx},${rz}`);
    try {
      this.worker = new Worker(new URL('./cityWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<RegionResponse>) => this.onRegion(ev.data);
      this.worker.onerror = () => {
        // sandboxed hosts can refuse module workers: fall back to the main thread
        this.worker = null;
        for (const [id, p] of this.pending) {
          this.pending.delete(id);
          this.regionsRequested.delete(p.key);
        }
      };
    } catch {
      this.worker = null;
    }
    const [minX, minZ, maxX, maxZ] = manifest.bounds;
    this.maskW = Math.round((maxX - minX) / manifest.tileSize);
    this.maskH = Math.round((maxZ - minZ) / manifest.tileSize);
    this.loadedMask = new THREE.DataTexture(new Uint8Array(this.maskW * this.maskH), this.maskW, this.maskH, THREE.RedFormat, THREE.UnsignedByteType);
    this.loadedMask.minFilter = this.loadedMask.magFilter = THREE.NearestFilter;
    if (this.sf)
      for (const [x, z] of FAR_STAND_INS) {
        const tx = Math.floor(x / manifest.tileSize), tz = Math.floor(z / manifest.tileSize);
        this.setMask(tx, tz, MASK_STAND_IN);
        this.maskedForGood.add(`${tx},${tz}`);
      }
    this.loadedMask.needsUpdate = true;
    // (nothing in the city ever moves: no matrix work per frame, the scene graph only walks past it)
    this.root.matrixAutoUpdate = false;
    this.farGroup.matrixAutoUpdate = false;
    this.root.add(this.farGroup);
    // the pipeline's sun-pass culling walks only the city (its casters and ground)
    this.root.userData.cullRoot = true;
    // the bay / ocean: a huge still plane below everything. (A fade past the default one sees further: from anywhere in the frame the plane
    // has to end inside the fade's full fog, or the sea stops in a hard line under the true horizon.)
    const side = config.fog.clearFarFull > 20000 ? 2 * (config.fog.clearFarFull + Math.hypot(maxX - minX, maxZ - minZ) / 2 + 2000) : 60000;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(side, side).rotateX(-Math.PI / 2), makeWaterMaterial());
    water.position.set((minX + maxX) / 2, WATER_Y, (minZ + maxZ) / 2);
    water.frustumCulled = false;
    water.matrixAutoUpdate = false;
    water.updateMatrix();
    water.updateMatrixWorld(true);
    this.root.add(water);
  }

  async loadFar(renderer?: THREE.WebGLRenderer): Promise<void> {
    // (index.html already asked for the default extension's files)
    const pre = (what: 'far' | 'horizon') => (this.ext === '.bin' ? bootFetch(this.baseUrl, what) : null);
    const farP = pre('far') ?? fetch(`${this.baseUrl}/far${this.ext}${dataQuery()}`);
    const hzP = (pre('horizon') ?? fetch(`${this.baseUrl}/horizon${this.ext}${dataQuery()}`)).catch(() => null);
    const rasterP = farFlags.map || farFlags.blocks ? fetch(`${this.baseUrl}/far16${this.ext}${dataQuery()}`).catch(() => null) : null;
    const [res, hz, rr] = await Promise.all([farP, hzP, rasterP]);
    this.far = parseFar(await maybeInflate(await res.arrayBuffer()));
    // (a city with no raster, or a dev server's page in its place: the far ground as it always was)
    const raster = rr && rr.ok ? parseFarRaster(await maybeInflate(await rr.arrayBuffer())) : null;
    let tex: FarTextures | null = null;
    if (raster && farFlags.blocks) this.startFarBlocks(raster);
    if (raster && farFlags.map) {
      tex = makeFarTextures(raster);
      // (one upload a tick, the boot loop running between them)
      renderer?.initTexture(tex.cls);
      await new Promise((r) => setTimeout(r, 16));
      renderer?.initTexture(tex.tone);
      this.farRaster = { W: raster.W, H: raster.H, affine: raster.affine, cls: raster.cls.slice(), height: raster.height.slice() };
    }
    this.buildFar(farFlags.map ? raster : null, tex, farFlags.blocks ? raster?.towers ?? null : null);
    if (hz && hz.ok) this.buildHorizon(await maybeInflate(await hz.arrayBuffer()));
  }

  /** ?farblocks: every building as a merged box past the streaming edge, built off the main thread (farBlocks.ts). */
  private startFarBlocks(r: FarRaster) {
    const f = this.far!;
    const q = new URLSearchParams(location.search);
    const chunk = Number(q.get('farchunk')) || FAR_CHUNK_TILES;
    this.farChunkM = chunk * this.manifest.tileSize;
    const req: FarBlocksRequest = {
      W: r.W, H: r.H, a: r.affine[0], c: r.affine[2], e: r.affine[4], f: r.affine[5],
      tileCells: Math.round(this.manifest.tileSize / r.cellM), chunkTiles: chunk, topStep: Number(q.get('fartop')) || FAR_TOP_STEP,
      seed: Math.round(Math.abs(this.manifest.origin[0] * 1000 + this.manifest.origin[1])),
      // (copies: these are views of the whole inflated file)
      cls: r.cls.slice(), height: r.height.slice(), tone: r.tone.slice(), wallTone: r.wallTone.slice(),
      ground: f.heights.slice(), groundW: f.gridW, groundH: f.gridH, groundX: f.minX, groundZ: f.minZ, groundCell: f.cell,
      towers: f.boxes.slice(), towerCount: f.index.length,
    };
    this.farBlockMat = makeFarBlockMaterial(r.affine, this.loadedMask, this.maskRect(), new THREE.Vector2(this.maskW, this.maskH));
    this.farBusy = true;
    const landed = (res: FarBlocksResult) => {
      this.farBusy = false;
      this.farBlocks = { ms: res.ms, boxes: res.boxes, cells: res.cells, chunks: [] };
      this.farLanding = res.chunks;
    };
    const onThread = () => void Promise.resolve().then(() => landed(mergeFarBlocks(req)));
    try {
      const worker = new Worker(new URL('./farWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<FarBlocksResult>) => {
        worker.terminate();
        landed(ev.data);
      };
      // (a sandboxed host can refuse a module worker)
      worker.onerror = () => {
        worker.terminate();
        onThread();
      };
      worker.postMessage(req);
    } catch {
      onThread();
    }
  }

  /** A few far chunks a frame (three uploads each at its first draw: ~7 KB), and which chunks are near enough to draw at all. */
  private farBlocksFrame() {
    const fb = this.farBlocks;
    if (!fb) return;
    for (let n = this.eager ? 32 : FAR_CHUNKS_A_FRAME; n > 0 && this.farLanding.length; n--) {
      const s = this.farLanding.pop()!;
      const mesh = farBlockMesh(s, this.farBlockMat!);
      this.farGroup.add(mesh);
      this.firstDraw(mesh);
      const size = this.farChunkM, x0 = s.ci * size, z0 = s.cj * size;
      // (the tiles it has boxes in, by their place in the mask)
      const ts = this.manifest.tileSize, cell = this.farBlockMat!.uniforms.uFarCell.value.x as number;
      const tiles = new Set<number>();
      for (let b = 0; b < s.count; b++) tiles.add(Math.floor((s.cell[b * 4 + 1] * cell) / ts) * this.maskW + Math.floor((s.cell[b * 4] * cell) / ts));
      fb.chunks.push({ ci: s.ci, cj: s.cj, count: s.count, cell: s.cell, mesh, x0, z0, x1: x0 + size, z1: z0 + size, tiles: [...tiles] });
    }
    const end = config.far.blockEnd;
    const mask = this.loadedMask.image.data as Uint8Array;
    for (const c of fb.chunks) {
      const dx = Math.max(c.x0 - this.viewX, 0, this.viewX - c.x1), dz = Math.max(c.z0 - this.viewZ, 0, this.viewZ - c.z1);
      let show = dx * dx + dz * dz < end * end;
      if (show) {
        // (a chunk whose every box a loaded tile hides is no draw at all)
        show = false;
        for (let k = 0; k < c.tiles.length && !show; k++) show = mask[c.tiles[k]] < 128;
      }
      c.mesh.visible = show;
    }
  }

  /** The hills around the city (Marin, East Bay, San Bruno Mtn) as a coarse fogged ring. */
  private buildHorizon(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    if (buf.byteLength < 24 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'SBH1') return;
    const W = dv.getUint32(4, true), H = dv.getUint32(8, true);
    const minX = dv.getFloat32(12, true), minZ = dv.getFloat32(16, true), cell = dv.getFloat32(20, true);
    const hq = new Int16Array(buf.slice(24, 24 + W * H * 2));
    const step = 2;
    const w = Math.floor((W - 1) / step) + 1, h = Math.floor((H - 1) / step) + 1;
    const hAt = (i: number, j: number) => hq[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))] / 10;
    const pos = new Float32Array(w * h * 3);
    const nrm = new Float32Array(w * h * 3);
    // (the layout's: the material takes the ramp from height)
    const ramp = new Float32Array(w * h);
    const lo = new Float32Array(w * h);
    const gl = new Float32Array(w * h);
    const land = new Uint8Array(w * h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const gi = i * step, gj = j * step, k = j * w + i;
        const y = hAt(gi, gj);
        pos[k * 3] = minX + gi * cell;
        pos[k * 3 + 1] = y > 0.5 ? y - 3 : -6;
        pos[k * 3 + 2] = minZ + gj * cell;
        const dx = (hAt(gi + 2, gj) - hAt(gi - 2, gj)) / (4 * cell), dz = (hAt(gi, gj + 2) - hAt(gi, gj - 2)) / (4 * cell);
        const l = Math.hypot(dx, 1, dz);
        nrm[k * 3] = -dx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = -dz / l;
        lo[k] = 0.02;
        land[k] = y > 0.5 ? 1 : 0;
      }
    const [bx0, bz0, bx1, bz1] = this.manifest.bounds;
    const idx: number[] = [];
    for (let j = 0; j < h - 1; j++)
      for (let i = 0; i < w - 1; i++) {
        const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
        if (!(land[a] || land[b] || land[c] || land[d])) continue;
        const x = pos[a * 3], z = pos[a * 3 + 2];
        // the city's own far grid covers its frame
        if (x >= bx0 && x + step * cell <= bx1 && z >= bz0 && z + step * cell <= bz1) continue;
        idx.push(a, c, b, b, c, d);
      }
    this.farGroup.add(farGridMesh(pos, nrm, ramp, lo, gl, idx, 0, makeHorizonMaterial()));
  }

  private buildFar(raster: FarRaster | null, tex: FarTextures | null, towers: FarTowers | null) {
    const f = this.far!;
    // far terrain: 64 m grid over the whole city, sunk a little under the near tiles
    const step = 2;
    const W = Math.floor((f.gridW - 1) / step) + 1;
    const H = Math.floor((f.gridH - 1) / step) + 1;
    const pos = new Float32Array(W * H * 3);
    const nrm = new Float32Array(W * H * 3);
    const ramp = new Float32Array(W * H);
    const lo = new Float32Array(W * H);
    const gl = new Float32Array(W * H);
    const hAt = (i: number, j: number) => f.heights[Math.min(f.gridH - 1, Math.max(0, j)) * f.gridW + Math.min(f.gridW - 1, Math.max(0, i))];
    const waterAt = (i: number, j: number) => f.cls[Math.min(f.gridH - 1, Math.max(0, j)) * f.gridW + Math.min(f.gridW - 1, Math.max(0, i))] === 2;
    const wallLo = raster ? farWallLo(raster) : null;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const gi = i * step, gj = j * step;
        const k = j * W + i;
        const water = waterAt(gi, gj);
        pos[k * 3] = f.minX + gi * f.cell;
        pos[k * 3 + 1] = water ? -6 : hAt(gi, gj) - 2.2;
        pos[k * 3 + 2] = f.minZ + gj * f.cell;
        if (raster) {
          // true ground: lamps and boxes stand on it, and it no longer has to hide under the near tiles (it sinks where they're loaded).
          // Water beside land stands just over the plane, so the raster, 16 m to the mesh's 64, draws the shore.
          let shore = false;
          if (water) for (let b = -1; b <= 1 && !shore; b++) for (let a = -1; a <= 1 && !shore; a++) shore = !waterAt(gi + a * step, gj + b * step);
          pos[k * 3 + 1] = water ? (shore ? WATER_Y + 0.3 : -6) : hAt(gi, gj);
        }
        const dx = (hAt(gi + 1, gj) - hAt(gi - 1, gj)) / (2 * f.cell);
        const dz = (hAt(gi, gj + 1) - hAt(gi, gj - 1)) / (2 * f.cell);
        const l = Math.hypot(dx, 1, dz);
        nrm[k * 3] = -dx / l;
        nrm[k * 3 + 1] = 1 / l;
        nrm[k * 3 + 2] = -dz / l;
        // (no water ramp: water vertices stand under the plane, so whatever of a triangle shows is land, and the plane cuts the
        // shore. The ramp is flat: a shore triangle taking a water vertex's would climb the hillside as a blue tooth)
        ramp[k] = Ramp.GREY_LIGHT;
        // (?farmap: this attribute carries the walls' lo, a 64 m value on the mesh: no texture, no fetch)
        lo[k] = wallLo ? wallLo(pos[k * 3], pos[k * 3 + 2]) : water ? -0.1 : -0.06;
      }
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let q = 0;
    for (let j = 0; j < H - 1; j++)
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    const maskRect = this.maskRect();
    const maskSize = new THREE.Vector2(this.maskW, this.maskH);
    const ground = raster && tex ? makeFarGroundMaterial(raster, tex, this.loadedMask, maskRect, maskSize) : undefined;
    this.farGroup.add(farGridMesh(pos, nrm, ramp, lo, gl, new THREE.BufferAttribute(idx, 1), 1, ground));

    // far skyline: tall buildings as boxes, hidden where real tiles are loaded
    const n = f.index.length;
    if (n) {
      const inst = towers
        ? farTowerMesh(farTowerLooks(f, towers, this.sf), n, makeFarTowerMaterial(this.loadedMask, maskRect, maskSize))
        : new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), makeSkylineMaterial(this.loadedMask, maskRect, maskSize), n);
      const m4 = new THREE.Matrix4();
      const qn = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const ps = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const o = i * 7;
        const [cx, cz, hw, hd, yaw, baseY, roofY] = [f.boxes[o], f.boxes[o + 1], f.boxes[o + 2], f.boxes[o + 3], f.boxes[o + 4], f.boxes[o + 5], f.boxes[o + 6]];
        qn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
        sc.set(hw * 2, Math.max(1, roofY - baseY + 2), hd * 2);
        ps.set(cx, baseY - 2, cz);
        m4.compose(ps, qn, sc);
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false; // far skyline: always drawn, never casts (it's beyond the shadow box)
      inst.matrixAutoUpdate = false;
      this.farGroup.add(inst);
    }
  }

  /** The mask's frame, as its readers take it: min x, min z, 1 / tile. */
  private maskRect(): THREE.Vector4 {
    return new THREE.Vector4(this.manifest.bounds[0], this.manifest.bounds[1], 1 / this.manifest.tileSize, 0);
  }

  /** Drop every region (they stream back in): after a lost GL context, whose streamed meshes kept no JS copy. */
  reloadAll() {
    for (const key of [...this.regionsLoaded]) {
      const c = key.indexOf(',');
      this.unloadRegion(Number(key.slice(0, c)), Number(key.slice(c + 1)));
    }
    for (const p of this.pending.values()) this.regionsRequested.delete(p.key);
    this.pending.clear();
  }

  /**
   * Ask for every region the opening needs around a point at once, before the first frame
   * (the frame's update() then finds them requested). Call it with the first frame's focus.
   */
  prime(focus: THREE.Vector3) {
    this.request(focus);
  }

  /**
   * Stream regions around a point (at altitude the game passes a point ahead of the bus, under the view).
   * `adoptMs`: adopt arrived tiles for about this long even while eager (before the first frame).
   */
  update(focus: THREE.Vector3, renderer: THREE.WebGLRenderer, dt: number, adoptMs?: number) {
    // (a frame's update: the frame before it drew what was fresh then)
    if (adoptMs === undefined && this.framesRun++ > 0 && this.firsts.length) this.firstsDone();
    this.request(focus);
    const R = this.regionSize * this.manifest.tileSize;
    const hk = Math.min(1, Math.max(0, (this.viewHeight - 40) / 460));
    const unloadR = UNLOAD_RADIUS + (UNLOAD_RADIUS_HIGH - UNLOAD_RADIUS) * hk;
    // unload far regions
    for (const key of this.regionsLoaded) {
      const xz = this.regionXZ.get(key)!;
      const cx = (xz[0] + 0.5) * R, cz = (xz[1] + 0.5) * R;
      const dx = Math.max(Math.abs(focus.x - cx) - R / 2, 0);
      const dz = Math.max(Math.abs(focus.z - cz) - R / 2, 0);
      if (Math.hypot(dx, dz) > unloadR) {
        this.unloadRegion(xz[0], xz[1]);
        break; // (one region a frame: disposing one is a few ms)
      }
    }
    // adopt arrived tiles a few per frame: a region landing never hitches one frame, and what a frame
    // adopts is what it uploads (firstDraw): this much new geometry at most, unless it is one big tile
    const t0 = performance.now();
    let n = 0;
    let bytes = 0;
    const eager = this.eager && adoptMs === undefined;
    const budget = adoptMs ?? ADOPT_MS;
    const cap = this.eager ? ADOPT_BYTES_EAGER : ADOPT_BYTES;
    while (this.adopt.length && (eager || n < ADOPT_MIN || performance.now() - t0 < budget)) {
      // (a swap that landed as the hold began waits for it to end, behind whatever else has arrived)
      const i = this.detailHold ? this.adopt.findIndex((x) => x.kind !== 'swap' && x.kind !== 'prep') : 0;
      if (i < 0) break;
      if (n > 0 && bytes + this.adopt[i].bytes > cap) break;
      const a = this.adopt.splice(i, 1)[0];
      n++;
      if (!this.regionsLoaded.has(a.key)) continue; // unloaded while queued
      bytes += a.bytes;
      if (a.kind === 'tile') {
        this.addTile(a.t, a.coarse);
        this.loadedMask.needsUpdate = true;
      } else if (a.kind === 'coarse') this.buildRegionMesh(a.key, a.msg);
      else if (a.kind === 'prep') this.prepTile(a.t);
      else {
        this.swapRegion(a.key, a.msg);
        if (!this.eager) break; // (a swap happens all at once: it is this frame's whole budget)
      }
    }
    this.farBlocksFrame();
    this.paint.flush(renderer, dt);
    this.ground.work();
    this.ground.flush(renderer, dt);
  }

  /** Request the regions around `focus` that aren't loaded or in flight (nearest first, a few at a time). */
  private request(focus: THREE.Vector3) {
    const R = this.regionSize * this.manifest.tileSize;
    // at altitude: a wider circle of coarse regions, detail only where pixels are still small
    const hk = Math.min(1, Math.max(0, (this.viewHeight - 40) / 460));
    const loadR = LOAD_RADIUS + (config.city.loadRadiusHigh - LOAD_RADIUS) * hk;
    const rx0 = Math.floor((focus.x - loadR) / R);
    const rx1 = Math.floor((focus.x + loadR) / R);
    const rz0 = Math.floor((focus.z - loadR) / R);
    const rz1 = Math.floor((focus.z + loadR) / R);
    const want = this.want;
    want.length = 0;
    for (let rz = rz0; rz <= rz1; rz++)
      for (let rx = rx0; rx <= rx1; rx++) {
        const key = this.regionKey(rx, rz);
        if (!this.regionAvailable.has(key) || this.regionsRequested.has(key)) continue;
        if ((this.retryAt.get(key) ?? 0) > performance.now()) continue;
        const cx = (rx + 0.5) * R, cz = (rz + 0.5) * R;
        // distance from focus to the region rectangle
        const dx = Math.max(Math.abs(focus.x - cx) - R / 2, 0);
        const dz = Math.max(Math.abs(focus.z - cz) - R / 2, 0);
        const d = Math.hypot(dx, dz);
        if (d < loadR) want.push([rx, rz, d, !this.detailHold && this.detailD(d) < DETAIL_RADIUS ? 0 : 1]);
      }
    // upgrade already-loaded coarse regions that are now close; coarsen detailed ones the view rose above
    if (!this.detailHold) for (const key of this.regionsLoaded) {
      const lod = this.regionLod.get(key);
      if (lod === undefined || this.isPending(key)) continue;
      // (a failed level-of-detail swap backs off like a failed first load: no request per frame while offline)
      if ((this.retryAt.get(key) ?? 0) > performance.now()) continue;
      const xz = this.regionXZ.get(key)!;
      const cx = (xz[0] + 0.5) * R, cz = (xz[1] + 0.5) * R;
      const d = Math.hypot(Math.max(Math.abs(focus.x - cx) - R / 2, 0), Math.max(Math.abs(focus.z - cz) - R / 2, 0));
      if (lod === 1 && this.detailD(d) < DETAIL_RADIUS * 0.8) want.push([xz[0], xz[1], d - 10000, 0]);
      else if (lod === 0 && this.detailD(d) > DETAIL_RADIUS * 1.4) want.push([xz[0], xz[1], d + 10000, 1]);
    }
    if (!want.length) return;
    want.sort(byDistance);
    // (while the opening's fog is up everything it needs goes out at once; then two at a time, so
    // streaming in flight stays budgeted)
    const cap = this.eager ? OPENING_IN_FLIGHT : IN_FLIGHT;
    for (const [rx, rz, , lod] of want) {
      if (this.pending.size >= cap) break;
      const key = this.regionKey(rx, rz);
      this.regionsRequested.add(key);
      const id = this.nextId++;
      this.pending.set(id, { key, lod });
      const msg: RegionRequest = { type: 'region', id, url: new URL(`${this.baseUrl}/r_${rx}_${rz}${this.ext}${dataQuery()}`, location.href).href, classN: this.manifest.classN, lod, sf: this.sf, tileSize: this.manifest.tileSize };
      if (this.worker) this.worker.postMessage(msg);
      else void loadRegion(msg).then((r) => this.onRegion(r));
    }
  }

  /**
   * A mesh's first draw happens the next frame, in view or not: three uploads a mesh the first time it is
   * drawn, so without this everything streamed in beside or behind the bus uploads the moment the view turns
   * to it, all at once. This way each upload lands with its adoption, on the adoption's byte budget.
   */
  firstDraw(m: THREE.Mesh) {
    m.frustumCulled = false;
    m.userData.sunCullAfter = m.userData.sunCull;
    m.userData.sunCull = false;
    this.firsts.push(m);
  }

  /** A first draw nobody sees, for a mesh that shows later, at its swap's commit. */
  private ghost(m: THREE.Mesh) {
    this.firstDraw(m);
    m.userData.ghost = true;
    m.onBeforeRender = GHOST_ON;
    m.onAfterRender = GHOST_OFF;
  }

  private unghost(m: THREE.Mesh | null) {
    if (!m?.userData.ghost) return;
    m.userData.ghost = false;
    delete (m as { onBeforeRender?: unknown }).onBeforeRender;
    delete (m as { onAfterRender?: unknown }).onAfterRender;
  }

  private firstsDone() {
    for (const m of this.firsts) {
      m.frustumCulled = true;
      m.userData.sunCull = m.userData.sunCullAfter;
      if (m.userData.ghost) {
        this.unghost(m);
        m.visible = false; // (until its swap commits)
      }
    }
    this.firsts.length = 0;
  }

  /** Distance `d` from the focus as the detail radii judge it: from the lens up high, and its fov. */
  private detailD(d: number): number {
    const lift = Math.max(0, this.viewHeight - 30);
    return (lift > 0 ? Math.hypot(d, lift) : d) / Math.max(0.2, this.detailScale);
  }

  /** "rx,rz", made once per region (with its coordinates for the streaming loops). */
  private regionKey(rx: number, rz: number): string {
    const n = (rx + 4096) * 8192 + (rz + 4096);
    let k = this.regionKeys.get(n);
    if (k === undefined) {
      k = `${rx},${rz}`;
      this.regionKeys.set(n, k);
      this.regionXZ.set(k, [rx, rz]);
    }
    return k;
  }

  private tileKeysOf(key: string): string[] {
    const [rx, rz] = key.split(',').map(Number);
    const rs = this.regionSize;
    const out: string[] = [];
    for (let tz = rz * rs; tz < (rz + 1) * rs; tz++) for (let tx = rx * rs; tx < (rx + 1) * rs; tx++) out.push(`${tx},${tz}`);
    return out;
  }

  private setMask(tx: number, tz: number, v: number) {
    const [minX, minZ] = this.manifest.bounds;
    const ts = this.manifest.tileSize;
    const mx = Math.round((tx * ts - minX) / ts);
    const mz = Math.round((tz * ts - minZ) / ts);
    if (mx >= 0 && mz >= 0 && mx < this.maskW && mz < this.maskH) (this.loadedMask.image.data as Uint8Array)[mz * this.maskW + mx] = v;
  }

  /** A coarse region's two meshes: its merged buildings and its ground (one grid, one class texture). */
  private buildRegionMesh(key: string, msg: RegionResponse) {
    this.disposeRegionMesh(key);
    const merged = msg.merged ?? null;
    // (coarse buildings are their own sun-pass casters: one quad per wall already)
    const rm: RegionMesh = { buildings: merged ? this.makeBuildingMesh(merged, msg.mergedSphere ?? null, true) : null, terrain: null, classTex: null, hidden: false };
    // (a region coming back coarse keeps showing the domes its painted towers grew)
    if (rm.buildings && this.tileKeysOf(key).some((k) => this.tiles.get(k)?.growthShown)) rm.buildings.geometry.setDrawRange(0, Infinity);
    if (rm.buildings) this.firstDraw(rm.buildings);
    this.regionMeshes.set(key, rm);
    this.buildRegionGround(key, rm);
  }

  /**
   * A coarse region's ground as one mesh (an 8 m grid; the class texture keeps
   * every street edge), except the tiles that own their ground (setOwnGround):
   * those get their own mesh on the same 8 m grid, so the seams match.
   */
  private buildRegionGround(key: string, rm: RegionMesh) {
    if (rm.terrain) {
      this.root.remove(rm.terrain);
      rm.terrain.geometry.dispose();
      (rm.terrain.material as THREE.Material).dispose();
      rm.terrain = null;
    }
    rm.classTex?.dispose();
    rm.classTex = null;
    const [rx, rz] = key.split(',').map(Number);
    const rs = this.regionSize;
    const ts = this.manifest.tileSize;
    const cn = this.manifest.classN;
    const N = cn * rs;
    const cls = new Uint8Array(N * N);
    const grids: THREE.BufferGeometry[] = [];
    let any = false;
    for (let tz = rz * rs; tz < (rz + 1) * rs; tz++)
      for (let tx = rx * rs; tx < (rx + 1) * rs; tx++) {
        const lt = this.tiles.get(`${tx},${tz}`);
        const tr = lt?.terrainData;
        if (!lt || !tr) continue;
        this.setMask(tx, tz, 255);
        if (this.ground.hasSaved(tx, tz)) this.ownGround.add(`${tx},${tz}`);
        if (this.ownGround.has(`${tx},${tz}`)) {
          // its own ground (painted: ground paint attaches per tile)
          if (lt.terrainStep !== 4) {
            this.dropTileTerrain(lt);
            this.makeTileTerrain(lt, 4);
          }
          continue;
        }
        if (lt.terrain) this.dropTileTerrain(lt);
        any = true;
        const ox = (tx - rx * rs) * cn, oz = (tz - rz * rs) * cn;
        for (let j = 0; j < cn; j++) cls.set(tr.cls.subarray(j * cn, j * cn + cn), (oz + j) * N + ox);
        grids.push(this.takeGrid(lt, 4));
      }
    if (any) {
      // one grid: the tiles' 8 m grids concatenated (typed copies, no per-vertex pushes)
      let vc = 0, ic = 0;
      for (const g of grids) {
        vc += g.getAttribute('position').count;
        ic += g.getIndex()!.count;
      }
      const pos = new Float32Array(vc * 3);
      const nrm = new Float32Array(vc * 3);
      const idx = vc < 65535 ? new Uint16Array(ic) : new Uint32Array(ic);
      let vo = 0, io = 0;
      for (const g of grids) {
        pos.set(g.getAttribute('position').array as Float32Array, vo * 3);
        nrm.set(g.getAttribute('normal').array as Float32Array, vo * 3);
        const ii = g.getIndex()!.array;
        for (let k = 0; k < ii.length; k++) idx[io + k] = ii[k] + vo;
        vo += g.getAttribute('position').count;
        io += ii.length;
        g.dispose();
      }
      const tex = new THREE.DataTexture(cls, N, N, THREE.RedFormat, THREE.UnsignedByteType);
      tex.minFilter = tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      dropAfterUpload(g);
      // (far ground doesn't cast: the shadow window is near the view, and buildings carry the shadows up high)
      const mesh = groundMesh(g, makeTerrainMaterial(tex, rx * rs * ts, rz * rs * ts, rs * ts, N), false);
      mesh.visible = !rm.hidden;
      this.root.add(mesh);
      this.firstDraw(mesh);
      rm.terrain = mesh;
      rm.classTex = tex;
    }
    this.loadedMask.needsUpdate = true;
  }

  /**
   * Give tile (tx, tz) its own ground mesh even while its region is coarse
   * (drawn whole), or merge it back. Ground paint lives per tile (a mask and
   * uniforms on the tile's own terrain material), so a painted tile must not
   * vanish into its region's merged ground: whoever paints the ground marks the
   * tile here. Sticky across streaming; costs one draw per marked tile seen.
   */
  setOwnGround(tx: number, tz: number, own = true) {
    const k = `${tx},${tz}`;
    if (own === this.ownGround.has(k)) return;
    if (own) this.ownGround.add(k);
    else this.ownGround.delete(k);
    const rs = this.regionSize;
    const rkey = `${Math.floor(tx / rs)},${Math.floor(tz / rs)}`;
    const rm = this.regionMeshes.get(rkey);
    if (rm) this.buildRegionGround(rkey, rm);
  }

  private disposeRegionMesh(key: string) {
    const rm = this.regionMeshes.get(key);
    if (!rm) return;
    this.regionMeshes.delete(key);
    if (rm.buildings) {
      this.root.remove(rm.buildings);
      rm.buildings.geometry.dispose();
    }
    if (rm.terrain) {
      this.root.remove(rm.terrain);
      rm.terrain.geometry.dispose();
      (rm.terrain.material as THREE.Material).dispose();
    }
    rm.classTex?.dispose();
  }

  /** Switch an adopted region to its other level of detail in one go (no holes in between). */
  private swapRegion(key: string, msg: RegionResponse) {
    if (msg.lod === 1) {
      // (same frame: the tiles' meshes go and the region's arrive, no holes in between)
      for (const k of this.tileKeysOf(key)) {
        const lt = this.tiles.get(k);
        if (lt) this.dropTileMeshes(lt);
      }
      for (const t of msg.tiles) {
        const lt = this.tiles.get(`${t.tx},${t.tz}`);
        if (lt) lt.grid = t.grid;
      }
      this.buildRegionMesh(key, msg);
      return;
    }
    for (const t of msg.tiles) {
      const lt = this.tiles.get(`${t.tx},${t.tz}`);
      if (!lt) continue;
      this.dropTileBuildings(lt);
      if (!lt.prep) this.prepTile(t); // (eager, or a tile with no mesh that had no prep item)
      const p = lt.prep!;
      lt.prep = null;
      lt.buildings = p.buildings;
      lt.caster = p.caster;
      this.unghost(p.buildings);
      this.unghost(p.caster);
      if (lt.buildings) lt.buildings.visible = !lt.hidden;
      if (lt.caster) lt.caster.visible = !lt.hidden;
      // (the detailed mesh has every setback garden and dome: re-raise and show what paint already grew)
      if (p.grown) lt.grown = p.grown;
      lt.growthShown = false;
      for (const ref of lt.refs) {
        const lv = this.paint.level(ref.index);
        if (lv >= 2) this.growTo(ref, lv);
      }
      if (p.terrain) {
        this.unghost(p.terrain.mesh);
        this.dropTileTerrain(lt);
        this.fitTileTerrain(lt, p.terrain);
      }
    }
    this.disposeRegionMesh(key);
  }

  /**
   * A swap's slow part, one tile at a time on the adoption budget: the tile's detailed meshes and its 4 m ground,
   * sent up to the GPU unseen (ghost), and the obstacle scan. The swap itself only commits.
   */
  private prepTile(t: TileResult) {
    const lt = this.tiles.get(`${t.tx},${t.tz}`);
    if (!lt || lt.prep) return;
    const p: TilePrep = { buildings: null, caster: null, grown: t.grown, terrain: null };
    if (t.mesh) {
      p.buildings = this.makeBuildingMesh(t.mesh, t.sphere, !t.caster);
      if (t.caster && p.buildings) p.caster = this.makeCasterMesh(t.caster, p.buildings.geometry.boundingSphere!);
      this.adoptTops(lt, t.tops);
    }
    lt.grid = t.grid;
    if (lt.terrainStep !== 2 && lt.terrainData) p.terrain = this.makeGround(lt, 2);
    lt.prep = p;
    if (p.buildings) this.ghost(p.buildings);
    if (p.caster) this.ghost(p.caster);
    if (p.terrain) this.ghost(p.terrain.mesh);
  }

  private dropTileMeshes(lt: LoadedTile) {
    this.dropTileBuildings(lt);
    this.dropTileTerrain(lt);
    this.dropPrep(lt);
  }

  /** A swap that won't happen (its region unloaded): what it made ahead goes. */
  private dropPrep(lt: LoadedTile) {
    const p = lt.prep;
    if (!p) return;
    lt.prep = null;
    for (const m of [p.buildings, p.caster]) {
      if (!m) continue;
      this.root.remove(m);
      m.geometry.dispose();
    }
    if (p.terrain) {
      this.root.remove(p.terrain.mesh);
      p.terrain.mesh.geometry.dispose();
      (p.terrain.mesh.material as THREE.Material).dispose();
      p.terrain.classTex.dispose();
    }
  }

  private dropTileBuildings(lt: LoadedTile) {
    if (lt.buildings) {
      this.root.remove(lt.buildings);
      lt.buildings.geometry.dispose();
      lt.buildings = null;
    }
    if (lt.caster) {
      this.root.remove(lt.caster);
      lt.caster.geometry.dispose();
      lt.caster = null;
    }
  }

  /** A full-detail tile's buildings: the detailed mesh (main pass) and its caster proxy (sun pass). */
  private makeTileBuildings(lt: LoadedTile, t: TileResult) {
    if (!t.mesh) return;
    lt.buildings = this.makeBuildingMesh(t.mesh, t.sphere, !t.caster);
    if (t.caster && lt.buildings) lt.caster = this.makeCasterMesh(t.caster, lt.buildings.geometry.boundingSphere!);
    if (lt.buildings) this.firstDraw(lt.buildings);
    if (lt.caster) this.firstDraw(lt.caster);
  }

  /** The one place a tile's own ground mesh goes away (per-tile ground paint detaches here). */
  private dropTileTerrain(lt: LoadedTile) {
    if (lt.terrain) {
      this.ground.detach(lt.tx, lt.tz);
      this.root.remove(lt.terrain);
      lt.terrain.geometry.dispose();
      (lt.terrain.material as THREE.Material).dispose();
      lt.terrain = null;
    }
    lt.classTex?.dispose();
    lt.classTex = null;
    lt.terrainStep = 0;
  }

  /**
   * The one place a tile's own ground mesh is made (per-tile ground paint
   * attaches here): a 4 m grid that casts shadows in detailed regions (step 2),
   * the coarse region's 8 m grid for a tile split out of one (step 4).
   */
  private makeTileTerrain(lt: LoadedTile, step: 2 | 4) {
    if (!lt.terrainData) return;
    const g = this.makeGround(lt, step);
    this.fitTileTerrain(lt, g);
    this.firstDraw(g.mesh);
  }

  /** The tile's ground mesh, in the scene but not the tile's yet. */
  private makeGround(lt: LoadedTile, step: 2 | 4): TileGround {
    const tr = lt.terrainData!;
    const tex = new THREE.DataTexture(tr.cls, tr.classN, tr.classN, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const geo = this.takeGrid(lt, step);
    dropAfterUpload(geo);
    const gu = this.ground.tileUniforms();
    const mesh = groundMesh(geo, makeTerrainMaterial(tex, tr.originX, tr.originZ, this.manifest.tileSize, tr.classN, 0, gu), step === 2);
    this.root.add(mesh);
    return { mesh, classTex: tex, gu, step };
  }

  /** A tile takes its ground mesh (per-tile ground paint attaches here). */
  private fitTileTerrain(lt: LoadedTile, g: TileGround) {
    const tr = lt.terrainData!;
    this.ground.attach(lt.tx, lt.tz, tr.originX, tr.originZ, g.gu);
    g.mesh.visible = !lt.hidden;
    lt.terrain = g.mesh;
    lt.classTex = g.classTex;
    lt.terrainStep = g.step;
  }

  /** The tile's ground grid as geometry: the worker's if it built this step, else made here. */
  private takeGrid(lt: LoadedTile, step: number): THREE.BufferGeometry {
    const g = lt.grid;
    lt.grid = null;
    const tr = lt.terrainData!;
    if (!g || g.step !== step) return makeHeightGrid((lt.meshH ??= meshHeights(tr)), tr.n, tr.cell, tr.originX, tr.originZ, step);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
    geo.setIndex(new THREE.BufferAttribute(g.index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(g.sphere[0], g.sphere[1], g.sphere[2]), g.sphere[3]);
    return geo;
  }

  /**
   * Hide tiles the predicate calls buried (high above the marine layer they'd
   * render as solid fog anyway, so they only cost draws); show them again when
   * it says so. Pass null to show everything.
   */
  cullBuried(buried: ((x0: number, z0: number, x1: number, z1: number, maxY: number, wasHidden: boolean) => boolean) | null) {
    const ts = this.manifest.tileSize;
    for (const lt of this.tiles.values()) {
      const h = buried ? buried(lt.tx * ts, lt.tz * ts, (lt.tx + 1) * ts, (lt.tz + 1) * ts, lt.maxY, lt.hidden) : false;
      if (h === lt.hidden) continue;
      lt.hidden = h;
      if (lt.buildings) lt.buildings.visible = !h;
      if (lt.caster) lt.caster.visible = !h;
      if (lt.terrain) lt.terrain.visible = !h;
    }
    // a coarse region hides only when every one of its tiles is buried
    for (const [key, rm] of this.regionMeshes) {
      let h = !!buried;
      if (h)
        for (const k of this.tileKeysOf(key)) {
          const lt = this.tiles.get(k);
          if (lt && !lt.hidden) {
            h = false;
            break;
          }
        }
      if (h === rm.hidden) continue;
      rm.hidden = h;
      if (rm.buildings) rm.buildings.visible = !h;
      if (rm.terrain) rm.terrain.visible = !h;
    }
  }

  /** True if tile (tx, tz) is hidden in the fog sea (its trees should hide too). */
  tileHidden(tx: number, tz: number): boolean {
    return this.tiles.get(`${tx},${tz}`)?.hidden ?? false;
  }

  get busy(): boolean {
    return this.pending.size > 0 || this.adopt.length > 0 || this.farBusy || this.farLanding.length > 0;
  }

  private isPending(key: string): boolean {
    if (!this.pending.size) return false;
    for (const p of this.pending.values()) if (p.key === key) return true;
    return false;
  }

  private onRegion(msg: RegionResponse) {
    const p = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    if (!p) return;
    const key = p.key;
    if (msg.error) {
      console.warn('region failed', key, msg.error);
      if (!this.regionsLoaded.has(key)) this.regionsRequested.delete(key);
      // back off (3 s, doubling up to 30 s): a flaky network shouldn't turn into a request storm
      const n = (this.failCount.get(key) ?? 0) + 1;
      this.failCount.set(key, n);
      this.retryAt.set(key, performance.now() + Math.min(30000, 3000 * 2 ** (n - 1)));
      return;
    }
    this.failCount.delete(key);
    this.retryAt.delete(key);
    if (!this.regionsRequested.has(key)) return; // unloaded while in flight
    // an already-loaded region switches level of detail in one go (detail prepares tile by tile first, so that
    // one go is only a commit); a new one adopts its tiles a few per frame
    if (this.regionsLoaded.has(key)) {
      if (msg.lod === 0) for (const t of msg.tiles) this.adopt.push({ kind: 'prep', key, bytes: meshBytes(t), t });
      this.adopt.push({ kind: 'swap', key, bytes: mergedBytes(msg), msg });
    } else {
      this.regionsLoaded.add(key);
      const coarse = msg.lod === 1;
      for (const t of msg.tiles) this.adopt.push({ kind: 'tile', key, bytes: coarse ? 0 : meshBytes(t), t, coarse });
      if (coarse) this.adopt.push({ kind: 'coarse', key, bytes: mergedBytes(msg), msg });
    }
    this.regionLod.set(key, msg.lod);
  }

  private makeBuildingMesh(m: MeshArrays, sphere: Float32Array | null, cast: boolean): THREE.Mesh | null {
    if (m.vertexCount === 0) return null;
    const mesh = buildingMesh(m, this.buildingMaterial, cast);
    const g = mesh.geometry;
    // the collapsed growth (last in the index) isn't drawn until a building of the mesh grows it (growTo)
    const growth = m.index.length > m.solidIndexCount;
    if (growth) g.setDrawRange(0, m.solidIndexCount);
    // (bounds come from the worker; the main thread never walks the vertices)
    if (sphere) g.boundingSphere = new THREE.Sphere(new THREE.Vector3(sphere[0], sphere[1], sphere[2]), sphere[3]);
    else g.computeBoundingSphere();
    // generous bounds: painted buildings pop and wobble a little outside their rest pose, and grown
    // domes / trees reach up to ~20 m over the mesh's highest vertex
    if (g.boundingSphere) g.boundingSphere.radius += growth ? 26 : 6;
    dropAfterUpload(g);
    this.root.add(mesh);
    return mesh;
  }

  /** The sun-pass proxy of a detailed tile: positions only, drawn by the shadow camera alone. */
  private makeCasterMesh(c: CasterArrays, sphere: THREE.Sphere): THREE.Mesh | null {
    if (c.vertexCount === 0) return null;
    const mesh = casterMesh(c);
    mesh.geometry.boundingSphere = sphere.clone(); // a subset of the detailed mesh: its bounds hold
    dropAfterUpload(mesh.geometry);
    this.root.add(mesh);
    return mesh;
  }

  /** Adopt one tile: gameplay data always; its own meshes unless it's part of a coarse region (drawn whole). */
  private addTile(t: TileResult, coarse = false) {
    const key = `${t.tx},${t.tz}`;
    if (this.tiles.has(key)) return;
    const lt: LoadedTile = { tx: t.tx, tz: t.tz, buildings: null, caster: null, terrain: null, terrainData: t.terrain, buildingData: t.building, refs: [], classTex: null, maxY: -Infinity, hidden: false, terrainStep: 0, grid: t.grid, meshH: null, grown: t.grown, growthShown: false, prep: null };
    if (!coarse) this.makeTileBuildings(lt, t);
    if (t.building) {
      const b = t.building;
      // how each part's mapped roof is built (as the mesher built it): gameplay heights follow the drawn roofs
      const kinds = t.kinds!;
      for (let i = 0; i < b.count; ) {
        // a building's tiers are consecutive records sharing its paint index: one ref for all of them
        let j = i + 1;
        let top = i;
        while (j < b.count && b.index[j] === b.index[i]) {
          if (partTop(b, kinds, j) > partTop(b, kinds, top)) top = j;
          j++;
        }
        const s = b.vertStart[i], e = b.vertStart[i + 1];
        let cx = 0, cz = 0, area = 0;
        for (let k = s; k < e; k++) {
          cx += b.xz[k * 2];
          cz += b.xz[k * 2 + 1];
          const k2 = k + 1 < e ? k + 1 : s;
          area += b.xz[k * 2] * b.xz[k2 * 2 + 1] - b.xz[k2 * 2] * b.xz[k * 2 + 1];
        }
        cx /= e - s;
        cz /= e - s;
        // footprints a hand-built prop draws instead (towerStyles HIDDEN, as the mesher decides): no ref, so
        // no aim, pick, paint or blast lands on what nobody can see (their obstacle cells: setPropObstacles)
        if (this.sf) {
          let hTop = 0;
          for (let k = i; k < j; k++) hTop = Math.max(hTop, partTop(b, kinds, k), b.baseY[k] + 2.5);
          if (hiddenAt(cx, cz, hTop - b.groundY[i])) {
            i = j;
            continue;
          }
        }
        // footprint bounds over the ground-tier rings (what contains() tests), and its reach from the centroid
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, rad = 0;
        for (let k = i; k < j; k++) {
          if (b.tier[k] !== 0) continue;
          for (let v = b.vertStart[k]; v < b.vertStart[k + 1]; v++) {
            const vx = b.xz[v * 2], vz = b.xz[v * 2 + 1];
            if (vx < x0) x0 = vx;
            if (vx > x1) x1 = vx;
            if (vz < z0) z0 = vz;
            if (vz > z1) z1 = vz;
            rad = Math.max(rad, Math.hypot(vx - cx, vz - cz));
          }
        }
        const ref: BuildingRef = { index: b.index[i], stableId: b.stableId[i], tile: b, local: i, parts: j - i, top, cx, cz, baseY: b.groundY[i], roofY: partTop(b, kinds, top), roofBuild: kinds, area: Math.abs(area) / 2, hood: b.hood[i], x0, z0, x1, z1, rad, q: 0 };
        i = j;
        lt.refs.push(ref);
        if (ref.roofY + 6 > lt.maxY) lt.maxY = ref.roofY + 6;
        const hk = this.hashKey(cx, cz);
        let list = this.hash.get(hk);
        if (!list) this.hash.set(hk, (list = []));
        list.push(ref);
        this.areaCells(ref, true);
        this.paint.register(ref.index, ref.stableId);
      }
    }
    if (t.terrain) {
      const tr = t.terrain;
      // trees are obstacles too: the bus skims canopies, never flies through them. Each crown is a dome
      // over its whole reach (a park's canopy closes over the cells between the trunks), at its real height
      for (const tree of tr.trees) this.crownCells(tr, tree);
      for (let k = 0; k < tr.obst.length; k++) if (tr.obst[k] > lt.maxY) lt.maxY = tr.obst[k];
      for (let k = 0; k < tr.heights.length; k++) if (tr.heights[k] > lt.maxY) lt.maxY = tr.heights[k];
      if (!coarse) {
        this.makeTileTerrain(lt, 2);
        // (a coarse region masks the far skyline when its own meshes land)
        this.setMask(t.tx, t.tz, 255);
      }
    }
    if (!coarse) this.adoptTops(lt, t.tops);
    this.tiles.set(key, lt);
    this.tileNum.set(tileKeyNum(t.tx, t.tz), lt);
    // a prop's cells (and its neighbors' buildings in them) are rebuilt with every tile under it
    for (const p of this.propObstacles) {
      const c = p.clear, ts = this.manifest.tileSize, r = c.halfL + c.halfW + 2;
      if (Math.abs((t.tx + 0.5) * ts - c.cx) <= ts / 2 + r && Math.abs((t.tz + 0.5) * ts - c.cz) <= ts / 2 + r) this.stampProp(p);
    }
    this.onTile?.({ tx: t.tx, tz: t.tz, terrain: t.terrain, refs: lt.refs });
  }

  private unloadRegion(rx: number, rz: number) {
    const key = `${rx},${rz}`;
    this.regionsLoaded.delete(key);
    this.regionsRequested.delete(key);
    this.regionLod.delete(key);
    if (this.adopt.length) this.adopt = this.adopt.filter((a) => a.key !== key);
    this.disposeRegionMesh(key);
    const rs = this.regionSize;
    const [minX, minZ] = this.manifest.bounds;
    const ts = this.manifest.tileSize;
    for (let tz = rz * rs; tz < (rz + 1) * rs; tz++)
      for (let tx = rx * rs; tx < (rx + 1) * rs; tx++) {
        const k = `${tx},${tz}`;
        const lt = this.tiles.get(k);
        if (!lt) continue;
        this.dropTileMeshes(lt);
        for (const ref of lt.refs) {
          const hk = this.hashKey(ref.cx, ref.cz);
          const list = this.hash.get(hk);
          if (list) {
            const i = list.indexOf(ref);
            if (i >= 0) list.splice(i, 1);
          }
          this.areaCells(ref, false);
        }
        const mx = Math.round((tx * ts - minX) / ts);
        const mz = Math.round((tz * ts - minZ) / ts);
        if (mx >= 0 && mz >= 0 && mx < this.maskW && mz < this.maskH) (this.loadedMask.image.data as Uint8Array)[mz * this.maskW + mx] = this.maskedForGood.has(k) ? MASK_STAND_IN : 0;
        this.tiles.delete(k);
        this.tileNum.delete(tileKeyNum(tx, tz));
        this.onTileUnload?.(tx, tz);
      }
    this.loadedMask.needsUpdate = true;
  }

  private hashKey(x: number, z: number) {
    return (Math.floor(x / HASH_CELL) + 4096) * 8192 + (Math.floor(z / HASH_CELL) + 4096);
  }

  /** Raise tile tr's obstacle cells under one tree's crown (a dome over its reach, at its real height). */
  private crownCells(tr: TerrainTile, tree: TerrainTile['trees'][number]) {
    const oc = this.manifest.tileSize / tr.obstN;
    const N = tr.obstN;
    const c = treeCrown(tree.kind, tree.size, crownTmp);
    const ix0 = Math.max(0, Math.floor((tree.x - c.r - tr.originX) / oc)), ix1 = Math.min(N - 1, Math.floor((tree.x + c.r - tr.originX) / oc));
    const iz0 = Math.max(0, Math.floor((tree.z - c.r - tr.originZ) / oc)), iz1 = Math.min(N - 1, Math.floor((tree.z + c.r - tr.originZ) / oc));
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        // the crown's height over the cell point nearest the trunk
        const qx = Math.min(Math.max(tree.x, tr.originX + ix * oc), tr.originX + (ix + 1) * oc);
        const qz = Math.min(Math.max(tree.z, tr.originZ + iz * oc), tr.originZ + (iz + 1) * oc);
        const u = Math.hypot(qx - tree.x, qz - tree.z) / c.r;
        if (u >= 1) continue;
        const top = tree.y + c.mid + (c.top - c.mid) * Math.sqrt(1 - u * u);
        const k = iz * N + ix;
        if (top > tr.obst[k]) tr.obst[k] = top;
      }
  }

  /** Ground height (m) from one terrain tile's grid (bilinear, clamped to the tile). */
  private tileGround(t: TerrainTile, x: number, z: number): number {
    const fx = Math.min(t.n - 1.001, Math.max(0, (x - t.originX) / t.cell));
    const fz = Math.min(t.n - 1.001, Math.max(0, (z - t.originZ) / t.cell));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const ax = fx - ix, az = fz - iz;
    const h = t.heights;
    const n = t.n;
    const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
    return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
  }

  private tileAt(x: number, z: number): LoadedTile | undefined {
    const ts = this.manifest.tileSize;
    return this.tileNum.get(tileKeyNum(Math.floor(x / ts), Math.floor(z / ts)));
  }

  /** Ground height (m). Falls back to the far grid where tiles aren't loaded. */
  groundAt(x: number, z: number): number {
    const lt = this.tileAt(x, z);
    if (lt?.terrainData) return this.tileGround(lt.terrainData, x, z);
    const f = this.far;
    if (!f) return 0;
    const fx = Math.min(f.gridW - 1.001, Math.max(0, (x - f.minX) / f.cell));
    const fz = Math.min(f.gridH - 1.001, Math.max(0, (z - f.minZ) / f.cell));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const ax = fx - ix, az = fz - iz;
    const w = f.gridW;
    const a = f.heights[iz * w + ix], b = f.heights[iz * w + ix + 1], c = f.heights[(iz + 1) * w + ix], d = f.heights[(iz + 1) * w + ix + 1];
    return Math.max(0, (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az);
  }

  /** The ground class (tiles.ts Ground: paved, grass, water, sidewalk) under (x, z) from the loaded tile's
   * 2 m class grid; null where no tile is loaded. Per query, not per frame. */
  groundClassAt(x: number, z: number): number | null {
    const tr = this.tileAt(x, z)?.terrainData;
    if (!tr) return null;
    const ts = this.manifest.tileSize, n = tr.classN;
    const i = Math.min(n - 1, Math.max(0, Math.floor(((x - tr.originX) / ts) * n)));
    const j = Math.min(n - 1, Math.max(0, Math.floor(((z - tr.originZ) / ts) * n)));
    return tr.cls[j * n + i];
  }

  /** The city's low ground (m): the 5th percentile of the far grid's land heights (0 before it loads). A
   * per-city reference for heights tuned as "above the city" (the fog ceiling). Once, at load. */
  lowGround(): number {
    const f = this.far;
    if (!f) return 0;
    const hs: number[] = [];
    for (let i = 0; i < f.heights.length; i += 3) if (f.cls[i] !== 2) hs.push(f.heights[i]);
    if (!hs.length) return 0;
    hs.sort((a, b) => a - b);
    return hs[Math.floor(hs.length * 0.05)];
  }

  /** Register landmark collision posts (bridges, towers). */
  addObstacles(list: ObstaclePost[]) {
    for (const p of list) {
      const c0x = Math.floor((p.x - p.r) / 64), c1x = Math.floor((p.x + p.r) / 64);
      const c0z = Math.floor((p.z - p.r) / 64), c1z = Math.floor((p.z + p.r) / 64);
      for (let cz = c0z; cz <= c1z; cz++)
        for (let cx = c0x; cx <= c1x; cx++) {
          const k = (cx + 4096) * 8192 + (cz + 4096);
          let l = this.posts.get(k);
          if (!l) this.posts.set(k, (l = []));
          l.push(p);
        }
    }
  }

  /** Tallest thing (roof, tree, ground, landmark) at a point, in meters. With
   * `fromY`, posts whose open underside is above fromY are ignored (flying under a deck). */
  obstacleAt(x: number, z: number, fromY?: number): number {
    let top = this.baseObstacleAt(x, z);
    const l = this.posts.size ? this.posts.get((Math.floor(x / 64) + 4096) * 8192 + (Math.floor(z / 64) + 4096)) : undefined;
    if (l)
      for (const p of l) {
        if (fromY !== undefined && fromY < p.under) continue;
        if ((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < p.r * p.r && p.top > top) top = p.top;
      }
    return top;
  }

  /** What the hard floor stands on: obstacleAt, with a deck post only up to its roadway, and under a deck no post at all. */
  hardAt(x: number, z: number, fromY: number): number {
    let top = this.baseObstacleAt(x, z);
    const l = this.posts.size ? this.posts.get((Math.floor(x / 64) + 4096) * 8192 + (Math.floor(z / 64) + 4096)) : undefined;
    if (l && this.overheadAt(x, z, fromY) === Infinity)
      for (const p of l) {
        const t = p.hard ?? p.top;
        if (fromY >= p.under && t > top && (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < p.r * p.r) top = t;
      }
    return top;
  }

  /** Is this point inside a post solid to the ground (a tower, an anchorage, a block)? */
  solidAt(x: number, z: number): boolean {
    const l = this.posts.size ? this.posts.get((Math.floor(x / 64) + 4096) * 8192 + (Math.floor(z / 64) + 4096)) : undefined;
    if (l)
      for (const p of l) {
        if (p.under === -Infinity && (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < p.r * p.r) return true;
      }
    return false;
  }

  /** The flight's obstacle cells take what the detailed mesh has on its roofs (regionLoader's roofTops, made in the worker). */
  private adoptTops(lt: LoadedTile, tops: Float32Array | null) {
    const o = lt.terrainData?.obst;
    if (!o || !tops) return;
    for (let k = 0; k < o.length; k++) if (tops[k] > o[k]) o[k] = tops[k];
  }

  /** Raise tile tr's obstacle cells inside the bounds whose centers pass `inside` to at least `top` (m). */
  private raiseCells(tr: TerrainTile, x0: number, z0: number, x1: number, z1: number, top: number, inside: (x: number, z: number) => boolean) {
    const N = tr.obstN, oc = this.manifest.tileSize / N;
    const ix0 = Math.max(0, Math.floor((x0 - tr.originX) / oc - 0.5)), ix1 = Math.min(N - 1, Math.floor((x1 - tr.originX) / oc - 0.5) + 1);
    const iz0 = Math.max(0, Math.floor((z0 - tr.originZ) / oc - 0.5)), iz1 = Math.min(N - 1, Math.floor((z1 - tr.originZ) / oc - 0.5) + 1);
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const k = iz * N + ix;
        if (tr.obst[k] >= top) continue;
        const cx = tr.originX + (ix + 0.5) * oc, cz = tr.originZ + (iz + 0.5) * oc;
        if (cx < x0 || cx > x1 || cz < z0 || cz > z1 || !inside(cx, cz)) continue;
        tr.obst[k] = top;
      }
  }

  /**
   * A rooftop garden or a Hundertwasser crown grew on a roof (rect as roofRect, `top` m ASL): the
   * obstacle field rises over it (+3 m around it, as the bake buffers roofs), so the bus never flies
   * through the player's own domes and spires. Tiles keep it until they unload (the restore re-raises it).
   */
  raiseRoof(rect: { cx: number; cz: number; w: number; d: number; yaw: number }, top: number, pad = 3) {
    const ux = Math.sin(rect.yaw), uz = Math.cos(rect.yaw);
    const hw = rect.w / 2 + pad, hd = rect.d / 2 + pad;
    const ex = Math.abs(ux) * hw + Math.abs(uz) * hd, ez = Math.abs(uz) * hw + Math.abs(ux) * hd;
    const ts = this.manifest.tileSize;
    for (let tz = Math.floor((rect.cz - ez) / ts); tz <= Math.floor((rect.cz + ez) / ts); tz++)
      for (let tx = Math.floor((rect.cx - ex) / ts); tx <= Math.floor((rect.cx + ex) / ts); tx++) {
        const lt = this.tiles.get(`${tx},${tz}`);
        if (!lt?.terrainData) continue;
        this.raiseCells(lt.terrainData, rect.cx - ex, rect.cz - ez, rect.cx + ex, rect.cz + ez, top, (x, z) => {
          const dx = x - rect.cx, dz = z - rect.cz;
          return Math.abs(dx * ux + dz * uz) <= hw && Math.abs(dx * uz - dz * ux) <= hd;
        });
        if (top + 6 > lt.maxY) lt.maxY = top + 6;
      }
  }

  /**
   * A painted tower reached `level`: its collapsed growth (setback bushes at level 2; trees and onion domes
   * at 3) grows out in the vertex shader. Its tile's mesh draws its growth triangles from now on, and the
   * flight's obstacle field rises over every element the level reached (the mesher records each one's
   * center, reach and grown top): the bus never flies through the player's own domes and trees. Tiles keep
   * it until they unload (the restore and the detailed re-mesh call this again).
   */
  growTo(ref: BuildingRef, level: number) {
    for (const lt of this.tiles.values()) {
      if (lt.buildingData !== ref.tile) continue;
      const g = lt.grown;
      if (!g) return;
      let any = false;
      // (grown by half a cell diagonal: a bush smaller than an 8 m cell still lifts the cell it stands in)
      const half = (this.manifest.tileSize / (lt.terrainData?.obstN ?? 32)) * Math.SQRT1_2;
      for (let k = 0; k < g.length; k += GROWN_STRIDE) {
        if (g[k] !== ref.index || g[k + 1] > level + 0.01) continue;
        any = true;
        this.raiseDisc(g[k + 2], g[k + 3], g[k + 4] + half, g[k + 5] + 0.5);
      }
      if (any && !lt.growthShown) {
        lt.growthShown = true;
        lt.buildings?.geometry.setDrawRange(0, Infinity);
        lt.prep?.buildings?.geometry.setDrawRange(0, Infinity);
        const rs = this.regionSize;
        this.regionMeshes.get(`${Math.floor(lt.tx / rs)},${Math.floor(lt.tz / rs)}`)?.buildings?.geometry.setDrawRange(0, Infinity);
      }
      return;
    }
  }

  /** Raise every loaded tile's obstacle cells within r of (x, z) to at least `top`. */
  private raiseDisc(x: number, z: number, r: number, top: number) {
    const ts = this.manifest.tileSize;
    for (let tz = Math.floor((z - r) / ts); tz <= Math.floor((z + r) / ts); tz++)
      for (let tx = Math.floor((x - r) / ts); tx <= Math.floor((x + r) / ts); tx++) {
        const lt = this.tiles.get(`${tx},${tz}`);
        if (!lt?.terrainData) continue;
        this.raiseCells(lt.terrainData, x - r, z - r, x + r, z + r, top, (cx, cz) => (cx - x) * (cx - x) + (cz - z) * (cz - z) <= r * r);
        if (top + 6 > lt.maxY) lt.maxY = top + 6;
      }
  }

  /**
   * A hand-built prop replaces footprints (towerStyles HIDDEN): inside `clear` (grown by 2 m, the lots'
   * buffer) every 8 m obstacle cell is rebuilt the way the bake builds one, without the hidden lots: the
   * highest ground of a 3 x 3 sample, the prop's boxes and every other building's parts (grown 3 m, 6 m
   * above 40 m, as the bake's roofs), then the tree crowns that reach it. The bus neither flies into the
   * prop nor bumps into invisible lots beside it, and a breath lands on the prop's roof. Applied to the
   * loaded tiles now and again whenever a tile under `clear` arrives (its neighbors' buildings count).
   */
  setPropObstacles(clear: Hidden, boxes: PropBox[]) {
    const p = { clear, boxes };
    this.propObstacles.push(p);
    this.stampProp(p);
  }

  private stampProp(p: { clear: Hidden; boxes: PropBox[] }) {
    const c = p.clear;
    const hl = c.halfL + 2, hw = c.halfW + 2;
    const ex = Math.abs(c.ax) * hl + Math.abs(c.az) * hw, ez = Math.abs(c.az) * hl + Math.abs(c.ax) * hw;
    const inBox = (b: { cx: number; cz: number; ax: number; az: number; halfL: number; halfW: number }, x: number, z: number, grow: number) => {
      const dx = x - b.cx, dz = z - b.cz;
      return Math.abs(dx * b.ax + dz * b.az) <= b.halfL + grow && Math.abs(-dx * b.az + dz * b.ax) <= b.halfW + grow;
    };
    const ts = this.manifest.tileSize;
    for (let tz = Math.floor((c.cz - ez) / ts); tz <= Math.floor((c.cz + ez) / ts); tz++)
      for (let tx = Math.floor((c.cx - ex) / ts); tx <= Math.floor((c.cx + ex) / ts); tx++) {
        const lt = this.tiles.get(`${tx},${tz}`);
        const tr = lt?.terrainData;
        if (!lt || !tr) continue;
        const N = tr.obstN, oc = ts / N;
        const ix0 = Math.max(0, Math.floor((c.cx - ex - tr.originX) / oc)), ix1 = Math.min(N - 1, Math.floor((c.cx + ex - tr.originX) / oc));
        const iz0 = Math.max(0, Math.floor((c.cz - ez - tr.originZ) / oc)), iz1 = Math.min(N - 1, Math.floor((c.cz + ez - tr.originZ) / oc));
        for (let iz = iz0; iz <= iz1; iz++)
          for (let ix = ix0; ix <= ix1; ix++) {
            const x = tr.originX + (ix + 0.5) * oc, z = tr.originZ + (iz + 0.5) * oc;
            if (!inBox(c, x, z, 2)) continue;
            let top = -Infinity;
            for (let sx = -1; sx <= 1; sx++) for (let sz = -1; sz <= 1; sz++) top = Math.max(top, this.groundAt(x + sx * 0.4 * oc, z + sz * 0.4 * oc));
            for (const b of p.boxes) if (b.top > top && inBox(b, x, z, b.pad)) top = b.top;
            for (const { ref } of this.buildingsWithin(x, z, 6, stampNear)) {
              // (a landmark prop's ref is one record: its hull at its top. Its real surface is its boxes here
              // and landmarkSurfaceAt in surfaceAt; stamping the hull would be an invisible wall)
              if (ref.index >= this.manifest.buildingCount) continue;
              const t = ref.tile;
              for (let k = ref.local; k < ref.local + ref.parts; k++) {
                const y = partTop(t, ref.roofBuild, k);
                if (y <= top) continue;
                const grow = y - t.baseY[k] > 40 ? 6 : 3;
                if (ringContains(t, k, x, z) || ringDist(t, k, x, z) <= grow) top = y;
              }
            }
            tr.obst[iz * N + ix] = top;
            if (top > lt.maxY) lt.maxY = top;
          }
        // (tree crowns reaching into it stand again: a crown is never cut by the box's edge)
        for (const tree of tr.trees) {
          const r = treeCrown(tree.kind, tree.size, crownTmp).r;
          if (Math.abs(tree.x - c.cx) <= ex + r && Math.abs(tree.z - c.cz) <= ez + r) this.crownCells(tr, tree);
        }
      }
  }

  /** Tallest roof, tree or ground at a point, without the landmark posts and bridge decks (what a breath lands on). */
  surfaceAt(x: number, z: number): number {
    // (and a landmark's real surface: a breath lands on the pyramid's slope, not on its collision post)
    return this.landmarks.length ? Math.max(this.baseObstacleAt(x, z), this.landmarkSurfaceAt(x, z)) : this.baseObstacleAt(x, z);
  }

  /** The highest landmark surface over (x, z), or -Infinity (no allocation). */
  landmarkSurfaceAt(x: number, z: number): number {
    let y = -Infinity;
    for (const lm of this.landmarks) {
      if (x < lm.x0 || x > lm.x1 || z < lm.z0 || z > lm.z1 || !ringContains(lm.ref.tile, 0, x, z)) continue;
      const h = lm.heightAt ? lm.heightAt(x, z) : lm.ref.roofY;
      if (h > y) y = h;
    }
    return y;
  }

  /**
   * Register a building the bake doesn't have (a hand-built landmark prop) as
   * a first-class paintable one: a normal BuildingRef with a paint texel from
   * the reserved range past the baked buildings (LANDMARK_SLOTS), in every
   * spatial index (indexRef), its saved paint applied (saved under its string
   * key). Its tile is a one-record tile of its own (the base ring), so
   * contains / frontOf / roofRect work unchanged; roofAtPart and surfaceAt
   * follow its real surface (heightAt). Never unloaded. Returns null when the
   * reserve is full.
   */
  addLandmarkBuilding(lb: LandmarkBuilding): BuildingRef | null {
    const k = this.landmarks.length;
    // (its paint is saved by name, 'lm:<name>', in the landmark store: never a number a bake could hand a building)
    if (k >= LANDMARK_SLOTS || lb.ring.length < 3 || !lb.key.startsWith(LANDMARK_KEY_PREFIX)) return null;
    const n = lb.ring.length;
    const xz = new Float32Array(n * 2);
    // (the area centroid: a hull's vertices bunch up where the prop has detail)
    let cx = 0, cz = 0, area = 0;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const [x, z] = lb.ring[i];
      const [xn, zn] = lb.ring[(i + 1) % n];
      xz[i * 2] = x;
      xz[i * 2 + 1] = z;
      const c = x * zn - xn * z;
      cx += (x + xn) * c;
      cz += (z + zn) * c;
      area += c;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    cx /= 3 * area;
    cz /= 3 * area;
    let rad = 0; // (its reach from the centroid)
    for (const [x, z] of lb.ring) rad = Math.max(rad, Math.hypot(x - cx, z - cz));
    let hood = 0, best = Infinity;
    const hoods = this.manifest.neighborhoods;
    for (let i = 0; i < hoods.length; i++) {
      const d = Math.hypot(hoods[i].x - cx, hoods[i].z - cz);
      if (d < best) {
        best = d;
        hood = i;
      }
    }
    // a named landmark is its own "neighborhood" (what the street sign shows)
    if (lb.name && hoods.length < 255) hood = hoods.push({ name: lb.name, x: cx, z: cz }) - 1;
    const index = this.manifest.buildingCount + k;
    const one = <T extends Uint8Array | Uint32Array | Float32Array>(A: new (n: number) => T, v: number): T => {
      const a = new A(1);
      a[0] = v;
      return a;
    };
    const tile: BuildingTile = {
      count: 1,
      originX: cx,
      originZ: cz,
      index: one(Uint32Array, index),
      stableId: one(Uint32Array, 0),
      vertStart: Uint32Array.of(0, n),
      baseY: one(Float32Array, lb.baseY),
      roofY: one(Float32Array, lb.roofY),
      groundY: one(Float32Array, lb.baseY),
      arch: one(Uint8Array, lb.arch ?? 8),
      floors: one(Uint8Array, Math.min(255, Math.round((lb.roofY - lb.baseY) / 4))),
      front: one(Uint8Array, 255),
      front2: one(Uint8Array, 255),
      hood: one(Uint8Array, hood),
      seed: one(Uint8Array, (k * 97 + 31) & 255),
      tier: one(Uint8Array, 0),
      taper: one(Uint8Array, 0),
      roofShape: one(Uint8Array, 0),
      roofH: one(Float32Array, 0),
      roofDir: one(Uint8Array, 0),
      facadeColor: one(Uint32Array, 0),
      roofColor: one(Uint32Array, 0),
      facadeMat: one(Uint8Array, 0),
      roofMat: one(Uint8Array, 0),
      source: one(Uint8Array, 0),
      xz,
    };
    // (bounds + reach as a baked ref's: it lives in the area index, where every aim, pick and blast query looks)
    const ref: BuildingRef = { index, stableId: -1 - k, tile, local: 0, parts: 1, top: 0, cx, cz, baseY: lb.baseY, roofY: lb.roofY, roofBuild: one(Uint8Array, 0), area: Math.abs(area) / 2, hood, x0, z0, x1, z1, rad, q: 0 };
    this.landmarks.push({ ref, x0, z0, x1, z1, rad, heightAt: lb.heightAt ?? null });
    this.indexRef(ref);
    this.paint.register(index, lb.key);
    return ref;
  }

  /** True if ref is a hand-built landmark (addLandmarkBuilding), not a baked building. */
  isLandmark(ref: BuildingRef): boolean {
    return ref.index >= this.manifest.buildingCount;
  }

  /** The registered landmark buildings. */
  landmarkRefs(): BuildingRef[] {
    return this.landmarks.map((l) => l.ref);
  }

  /** Puts a ref that doesn't come from a tile (a landmark) in every spatial index City keeps. */
  private indexRef(ref: BuildingRef) {
    const hk = this.hashKey(ref.cx, ref.cz);
    let list = this.hash.get(hk);
    if (!list) this.hash.set(hk, (list = []));
    list.push(ref);
    this.areaCells(ref, true);
  }

  /** Lowest underside of a deck overhead (above fromY) at a point, or Infinity: a climb stops under it. */
  overheadAt(x: number, z: number, fromY: number): number {
    const l = this.posts.size ? this.posts.get((Math.floor(x / 64) + 4096) * 8192 + (Math.floor(z / 64) + 4096)) : undefined;
    let under = Infinity;
    if (l)
      for (const p of l) {
        if (p.under > fromY && p.under < under && (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < p.r * p.r) under = p.under;
      }
    return under;
  }

  private baseObstacleAt(x: number, z: number): number {
    const lt = this.tileAt(x, z);
    if (lt?.terrainData) {
      const t = lt.terrainData;
      const c = this.manifest.tileSize / t.obstN;
      const ix = Math.min(t.obstN - 1, Math.max(0, Math.floor((x - t.originX) / c)));
      const iz = Math.min(t.obstN - 1, Math.max(0, Math.floor((z - t.originZ) / c)));
      return t.obst[iz * t.obstN + ix];
    }
    return this.groundAt(x, z) + 18; // unknown: assume rooftops
  }

  /** Buildings whose centroid is within r of (x, z), nearest first. One entry per building
   * (a tiered tower is one ref; its roofY is the top of the highest tier). */
  buildingsNear(x: number, z: number, r: number, out: Array<{ ref: BuildingRef; d: number }> = []): Array<{ ref: BuildingRef; d: number }> {
    // (the entries of `out` are used again, and what it held beyond this call's count stays in a pool of its own)
    const pool = ((out as NearList).pool ??= []);
    for (const e of out) pool.push(e);
    out.length = 0;
    const c0x = Math.floor((x - r) / HASH_CELL), c1x = Math.floor((x + r) / HASH_CELL);
    const c0z = Math.floor((z - r) / HASH_CELL), c1z = Math.floor((z + r) / HASH_CELL);
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = this.hash.get((cx + 4096) * 8192 + (cz + 4096));
        if (!list) continue;
        for (const ref of list) {
          const dx = ref.cx - x, dz = ref.cz - z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > r) continue;
          // (kept in order as they come, nearest first: Array.sort allocates, and this is called every frame)
          const e = pool.pop() ?? { ref, d };
          e.ref = ref;
          e.d = d;
          let i = out.length;
          out.push(e);
          while (i > 0 && out[i - 1].d > d) {
            out[i] = out[i - 1];
            i--;
          }
          out[i] = e;
        }
      }
    return out;
  }

  /** Roof height at (x, z) of the building whose footprint contains it (its part there), or null (no allocation, no sort). */
  roofAt(x: number, z: number): number | null {
    const ref = this.buildingAt(x, z);
    return ref ? this.roofAtPart(ref, x, z) : null;
  }

  /** Add (or remove) a ref in every area-index cell its footprint bounds overlap. */
  private areaCells(ref: BuildingRef, add: boolean) {
    if (!(ref.x1 >= ref.x0)) return;
    const c0x = Math.floor(ref.x0 / HASH_CELL), c1x = Math.floor(ref.x1 / HASH_CELL);
    const c0z = Math.floor(ref.z0 / HASH_CELL), c1z = Math.floor(ref.z1 / HASH_CELL);
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const k = (cx + 4096) * 8192 + (cz + 4096);
        let list = this.areaHash.get(k);
        if (add) {
          if (!list) this.areaHash.set(k, (list = []));
          list.push(ref);
        } else if (list) {
          const i = list.indexOf(ref);
          if (i >= 0) list.splice(i, 1);
          if (!list.length) this.areaHash.delete(k);
        }
      }
  }

  /** The building whose footprint contains (x, z), wherever in it the point is (the tallest if
   * footprints overlap: a LiDAR tower over a lot the footprint data still has), or null. One cell lookup.
   * A landmark ranks by its surface right there, not its top: between Sutro's legs the transmitter
   * building's roof wins over the 298 m tower whose hull holds it. */
  buildingAt(x: number, z: number): BuildingRef | null {
    const list = this.areaHash.get(this.hashKey(x, z));
    if (!list) return null;
    let best: BuildingRef | null = null, by = -Infinity;
    for (const r of list) {
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      const y = r.index >= this.manifest.buildingCount ? this.ownTop(r, x, z) : r.roofY;
      if ((!best || y > by) && this.contains(r, x, z)) {
        best = r;
        by = y;
      }
    }
    return best;
  }

  /** A building whose roof right at (x, z) stands above y (the tallest), or null: the line-of-fire test.
   * Buildings whose top is below y are skipped before any ring test (most of them, near the rooftops). */
  buildingAbove(x: number, z: number, y: number): BuildingRef | null {
    const list = this.areaHash.get(this.hashKey(x, z));
    if (!list) return null;
    let best: BuildingRef | null = null, by = y;
    for (const r of list) {
      if (r.roofY <= by || x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      if (!this.contains(r, x, z)) continue;
      // (a landmark by its own surface: nothing of Sutro stands in the line of fire between its legs)
      const ry = r.index >= this.manifest.buildingCount ? this.ownTop(r, x, z) : this.roofAtPart(r, x, z);
      if (ry > by) {
        by = ry;
        best = r;
      }
    }
    return best;
  }

  /** True distance (m) from (x, z) to ref's footprint: 0 inside, else to its nearest ground-tier edge. */
  edgeDistance(ref: BuildingRef, x: number, z: number): number {
    if (this.contains(ref, x, z)) return 0;
    const b = ref.tile;
    let d = Infinity;
    for (let k = ref.local; k < ref.local + ref.parts; k++) {
      if (b.tier[k] !== 0) continue;
      const s = b.vertStart[k], e = b.vertStart[k + 1];
      for (let i = s, j = e - 1; i < e; j = i++) d = Math.min(d, segDist(b.xz[j * 2], b.xz[j * 2 + 1], b.xz[i * 2], b.xz[i * 2 + 1], x, z));
    }
    return d;
  }

  /** Distance found by the last nearestBuilding() call (m; 0 = inside). */
  nearestDist = Infinity;

  /**
   * The building nearest to (x, z) by true footprint distance (0 inside: the tallest containing one),
   * within r, or null; buildings lower than minHeight (sheds, slivers) are skipped. Sets nearestDist.
   * Uses the area index: big footprints count by their edge, never by a far-away centroid. No allocation.
   */
  nearestBuilding(x: number, z: number, r: number, minHeight = 0): BuildingRef | null {
    const inside = this.buildingAt(x, z);
    if (inside && inside.roofY - inside.baseY >= minHeight) {
      this.nearestDist = 0;
      return inside;
    }
    const stamp = ++this.qStamp;
    let best: BuildingRef | null = null;
    let bd = r;
    const c0x = Math.floor((x - r) / HASH_CELL), c1x = Math.floor((x + r) / HASH_CELL);
    const c0z = Math.floor((z - r) / HASH_CELL), c1z = Math.floor((z + r) / HASH_CELL);
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = this.areaHash.get((cx + 4096) * 8192 + (cz + 4096));
        if (!list) continue;
        for (const ref of list) {
          if (ref.q === stamp) continue;
          ref.q = stamp;
          // bounds first: most refs in reach are culled without touching their rings
          const bx = Math.max(ref.x0 - x, 0, x - ref.x1), bz = Math.max(ref.z0 - z, 0, z - ref.z1);
          if (bx * bx + bz * bz > bd * bd || ref.roofY - ref.baseY < minHeight) continue;
          const d = this.edgeDistance(ref, x, z);
          if (d < bd || (d === bd && best && ref.roofY > best.roofY)) {
            bd = d;
            best = ref;
          }
        }
      }
    this.nearestDist = best ? bd : Infinity;
    return best;
  }

  /** Every building whose footprint comes within r of (x, z) (true edge distance d, 0 inside), unsorted. */
  buildingsWithin(x: number, z: number, r: number, out: Array<{ ref: BuildingRef; d: number }> = []): Array<{ ref: BuildingRef; d: number }> {
    out.length = 0;
    const stamp = ++this.qStamp;
    const c0x = Math.floor((x - r) / HASH_CELL), c1x = Math.floor((x + r) / HASH_CELL);
    const c0z = Math.floor((z - r) / HASH_CELL), c1z = Math.floor((z + r) / HASH_CELL);
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = this.areaHash.get((cx + 4096) * 8192 + (cz + 4096));
        if (!list) continue;
        for (const ref of list) {
          if (ref.q === stamp) continue;
          ref.q = stamp;
          const bx = Math.max(ref.x0 - x, 0, x - ref.x1), bz = Math.max(ref.z0 - z, 0, z - ref.z1);
          if (bx * bx + bz * bz > r * r) continue;
          const d = this.edgeDistance(ref, x, z);
          if (d <= r) out.push({ ref, d });
        }
      }
    return out;
  }

  /** Where a shot aimed at (x, z) lands on ref: a house-sized building (every vertex within `smallRad` of
   * its centroid) at its centroid, as ever; a big one at (x, z) itself when that is on it, else at the point
   * of its footprint nearest to (x, z) pulled `inset` m further in (never at a centroid 100 m from the aim). */
  landingOn(ref: BuildingRef, x: number, z: number, inset: number, out: { x: number; z: number }, smallRad = 0): { x: number; z: number } {
    if (ref.rad <= smallRad && this.contains(ref, ref.cx, ref.cz)) {
      out.x = ref.cx;
      out.z = ref.cz;
      return out;
    }
    if (this.contains(ref, x, z)) {
      out.x = x;
      out.z = z;
      return out;
    }
    const b = ref.tile;
    let d = Infinity, px = ref.cx, pz = ref.cz;
    for (let k = ref.local; k < ref.local + ref.parts; k++) {
      if (b.tier[k] !== 0) continue;
      const s = b.vertStart[k], e = b.vertStart[k + 1];
      for (let i = s, j = e - 1; i < e; j = i++) {
        const ax = b.xz[j * 2], az = b.xz[j * 2 + 1], dx = b.xz[i * 2] - ax, dz = b.xz[i * 2 + 1] - az;
        const L2 = dx * dx + dz * dz;
        const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
        const qx = ax + dx * t, qz = az + dz * t;
        const dd = Math.hypot(qx - x, qz - z);
        if (dd < d) {
          d = dd;
          px = qx;
          pz = qz;
        }
      }
    }
    // in toward the centroid (never past it); an L-shaped footprint whose centroid is outside it keeps the edge point
    const tx = ref.cx - px, tz = ref.cz - pz, tl = Math.hypot(tx, tz);
    const k = tl > 1e-6 ? Math.min(1, inset / tl) : 0;
    out.x = px + tx * k;
    out.z = pz + tz * k;
    if (!this.contains(ref, out.x, out.z)) {
      const k2 = tl > 1e-6 ? Math.min(1, 0.6 / tl) : 0;
      out.x = px + tx * k2;
      out.z = pz + tz * k2;
    }
    return out;
  }

  /** True if (x, z) is inside the footprint of ref (any ground-tier part; the tiers above stand on it). */
  contains(ref: BuildingRef, x: number, z: number): boolean {
    const b = ref.tile;
    for (let k = ref.local; k < ref.local + ref.parts; k++) if (b.tier[k] === 0 && ringContains(b, k, x, z)) return true;
    return false;
  }

  /** A landmark's own surface over (x, z) (m ASL): its height field inside its ring (its top without one),
   * -Infinity outside it or where nothing of it stands (between Sutro's legs). What it is ranked by. */
  private ownTop(ref: BuildingRef, x: number, z: number): number {
    const lm = this.landmarks[ref.index - this.manifest.buildingCount];
    if (!lm || !ringContains(ref.tile, 0, x, z)) return -Infinity;
    if (!lm.heightAt) return ref.roofY;
    const h = lm.heightAt(x, z);
    return h > -Infinity ? Math.max(ref.baseY, h) : -Infinity;
  }

  /** Roof height of ref right at (x, z): the highest of its parts covering the point (a tiered
   * tower's podium roof is not the top of its tower; a mapped roof's slope where the point is, as drawn),
   * or ref.roofY if none does. No allocation (the aim calls it every frame). */
  roofAtPart(ref: BuildingRef, x: number, z: number): number {
    if (ref.index >= this.manifest.buildingCount) {
      // a landmark: its real surface (a pyramid's slope, not its spire's top); where nothing of it stands
      // (between Sutro's legs) a breath comes down on what is there: a roof, a tree crown, the ground
      const lm = this.landmarks[ref.index - this.manifest.buildingCount];
      if (!lm?.heightAt || !ringContains(ref.tile, 0, x, z)) return ref.roofY;
      const h = lm.heightAt(x, z);
      return h > -Infinity ? Math.max(ref.baseY, h) : this.baseObstacleAt(x, z);
    }
    const b = ref.tile, kinds = ref.roofBuild;
    let y = -Infinity;
    for (let k = ref.local; k < ref.local + ref.parts; k++) {
      if (partTop(b, kinds, k) <= y || !ringContains(b, k, x, z)) continue;
      const ry = partRoofAt(b, kinds, k, x, z);
      if (ry > y) y = ry;
    }
    return y > -Infinity ? y : ref.roofY;
  }

  /** Street-facing edge of a building (its ground tier): midpoint, outward normal, length. */
  frontOf(ref: BuildingRef): { x: number; z: number; nx: number; nz: number; len: number } {
    const b = ref.tile;
    const s = b.vertStart[ref.local], e = b.vertStart[ref.local + 1];
    const n = e - s;
    let k = b.front[ref.local];
    if (k === 255 || k >= n) {
      // fallback: longest edge
      let best = 0;
      for (let i = 0; i < n; i++) {
        const a = s + i, c = s + ((i + 1) % n);
        const L = Math.hypot(b.xz[c * 2] - b.xz[a * 2], b.xz[c * 2 + 1] - b.xz[a * 2 + 1]);
        if (L > best) { best = L; k = i; }
      }
    }
    const a = s + k, c = s + ((k + 1) % n);
    const ax = b.xz[a * 2], az = b.xz[a * 2 + 1], cx = b.xz[c * 2], cz = b.xz[c * 2 + 1];
    const len = Math.hypot(cx - ax, cz - az) || 1;
    let nx = (cz - az) / len, nz = -(cx - ax) / len;
    // make sure the normal points away from the centroid
    const mx = (ax + cx) / 2, mz = (az + cz) / 2;
    if ((mx - ref.cx) * nx + (mz - ref.cz) * nz < 0) { nx = -nx; nz = -nz; }
    return { x: mx, z: mz, nx, nz, len };
  }

  /** The edge of ref (2 m or longer) that faces (x, z) best, as frontOf's: a landmark has no street front,
   * so its sign goes on the side the bus sees (not the Ferry Building's bay side). Per hit, not per frame. */
  edgeToward(ref: BuildingRef, x: number, z: number): { x: number; z: number; nx: number; nz: number; len: number } {
    const b = ref.tile;
    const s = b.vertStart[ref.local], n = b.vertStart[ref.local + 1] - s;
    let best = -Infinity, out = this.frontOf(ref);
    for (let i = 0; i < n; i++) {
      const a = s + i, c = s + ((i + 1) % n);
      const ax = b.xz[a * 2], az = b.xz[a * 2 + 1], cx = b.xz[c * 2], cz = b.xz[c * 2 + 1];
      const len = Math.hypot(cx - ax, cz - az);
      if (len < 2) continue;
      let nx = (cz - az) / len, nz = -(cx - ax) / len;
      const mx = (ax + cx) / 2, mz = (az + cz) / 2;
      if ((mx - ref.cx) * nx + (mz - ref.cz) * nz < 0) { nx = -nx; nz = -nz; }
      // (how squarely it faces the point: the cosine between its normal and the way to the point)
      const k = (nx * (x - mx) + nz * (z - mz)) / (Math.hypot(x - mx, z - mz) || 1);
      if (k > best) {
        best = k;
        out = { x: mx, z: mz, nx, nz, len };
      }
    }
    return out;
  }

  /** Oriented roof rectangle (for rooftop sprouts), aligned with the street front: the roof of the
   * highest tier that is a real roof (a fifth of the footprint or more), not a crown or a penthouse. On a
   * mapped roof (gabled, hipped, domed...) it is a deck along the roof's crest instead, aligned with the
   * ridge, its turf just over the top (the drawn roof's heights, roofSurfaceY). No allocation. */
  roofRect(ref: BuildingRef): { cx: number; cz: number; y: number; w: number; d: number; yaw: number } {
    const f = this.frontOf(ref);
    const ux = -f.nz, uz = f.nx;
    const b = ref.tile, kinds = ref.roofBuild;
    let top = ref.local;
    for (let k = ref.local + 1; k < ref.local + ref.parts; k++) if (partTop(b, kinds, k) > partTop(b, kinds, top) && ringArea(b, k) >= 0.2 * ref.area) top = k;
    const s = b.vertStart[top], e = b.vertStart[top + 1];
    if (kinds[top] !== RoofBuild.FLAT) {
      // a mapped (pitched, domed) roof: the garden is a deck riding the crest (like Amsterdam's roof terraces),
      // not a flat mat at the eave (buried in the slopes) or a lid at the ridge over the whole footprint (hiding
      // the roof's shape). On a 17 x 17 grid in the roof frame (i along the ridge, S; j across, D): the deck runs
      // along the row of the top sample over one unbroken run of crest samples (the roof within `band` of its
      // top; a ridge crossing a notch or a courtyard has several: the longest at the top), as deep as the crest
      // is unbroken across those columns, and at least 3.2 m each way where the roof is that big, so the
      // garden's lawn, centerpiece and bunting fit (sprouts' layout wants 2.2 / 2.6 / 3 m), as long as its turf
      // stays on the roof. Its turf (0.1 m under the deck's y to 0.22 over it) just covers the top
      const fr = roofFrame(b.xz, s, e, b.roofDir[top], rectFrame);
      const band = Math.max(0.6, 0.3 * b.roofH[top]);
      const N = RECT_N - 1;
      const L = fr.s1 - fr.s0, W = fr.t1 - fr.t0, ds = L / N, dt = W / N;
      let hi = -Infinity, jTop = -1;
      for (let i = 0; i <= N; i++)
        for (let j = 0; j <= N; j++) {
          const ss = fr.s0 + ds * i, tt = fr.t0 + dt * j;
          const x = fr.cx + ss * fr.Sx + tt * fr.Dx, z = fr.cz + ss * fr.Sz + tt * fr.Dz;
          const y = ringContains(b, top, x, z) ? partRoofAt(b, kinds, top, x, z) : -Infinity;
          rectY[i * RECT_N + j] = y;
          if (y > hi) {
            hi = y;
            jTop = j;
          }
        }
      // the runs of crest samples along the top's row: the longest that reaches the top
      let i0 = -1, i1 = -1, bestTop = false;
      for (let i = 0; i <= N; ) {
        if (!(rectY[i * RECT_N + jTop] >= hi - band)) {
          i++;
          continue;
        }
        let k = i, atTop = false;
        for (; k <= N && rectY[k * RECT_N + jTop] >= hi - band; k++) if (rectY[k * RECT_N + jTop] >= hi - 0.05) atTop = true;
        if (i0 < 0 || (atTop && !bestTop) || (atTop === bestTop && k - 1 - i > i1 - i0)) {
          i0 = i;
          i1 = k - 1;
          bestTop = atTop;
        }
        i = k;
      }
      if (i0 >= 0) {
        // across: the crest unbroken from the top's row, in each of the run's columns
        let j0 = jTop, j1 = jTop;
        for (let i = i0; i <= i1; i++) {
          let a = jTop, c = jTop;
          while (a > 0 && rectY[i * RECT_N + a - 1] >= hi - band) a--;
          while (c < N && rectY[i * RECT_N + c + 1] >= hi - band) c++;
          if (a < j0) j0 = a;
          if (c > j1) j1 = c;
        }
        const w0 = 0.92 * ds * (i1 - i0), d0 = dt * (j1 - j0);
        let cs = fr.s0 + (ds * (i0 + i1)) / 2, ct = fr.t0 + (dt * (j0 + j1)) / 2;
        let w = Math.max(w0, Math.min(3.2, 0.86 * L)), d = Math.max(d0, Math.min(3.2, 0.86 * W));
        // (kept inside the roof's extents: a skillion's crest is its high edge)
        const ws = Math.min(Math.max(cs, fr.s0 + w / 2), fr.s1 - w / 2), dts = Math.min(Math.max(ct, fr.t0 + d / 2), fr.t1 - d / 2);
        if (rectOnRing(b, top, fr, ws, dts, w, d) >= 0.7) {
          cs = ws;
          ct = dts;
        } else {
          // widened, the deck would hang off the roof (a notch beside a short ridge): the crest alone
          w = w0;
          d = d0;
        }
        return { cx: fr.cx + cs * fr.Sx + ct * fr.Dx, cz: fr.cz + cs * fr.Sz + ct * fr.Dz, y: hi - 0.12, w: Math.max(1.2, w), d: Math.max(1.2, d), yaw: Math.atan2(fr.Sx, fr.Sz) };
      }
    }
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (let k = s; k < e; k++) {
      const x = b.xz[k * 2] - ref.cx, z = b.xz[k * 2 + 1] - ref.cz;
      const ss = x * ux + z * uz;
      const tt = x * f.nx + z * f.nz;
      s0 = Math.min(s0, ss); s1 = Math.max(s1, ss); t0 = Math.min(t0, tt); t1 = Math.max(t1, tt);
    }
    const cs = (s0 + s1) / 2, ct = (t0 + t1) / 2;
    const sc = 1 - b.taper[top] / 255; // a tapering tier's roof is its base ring scaled
    return { cx: ref.cx + ux * cs + f.nx * ct, cz: ref.cz + uz * cs + f.nz * ct, y: b.roofY[top], w: (s1 - s0) * 0.86 * sc, d: (t1 - t0) * 0.86 * sc, yaw: Math.atan2(ux, uz) };
  }

  neighborhoodName(hood: number): string {
    return this.manifest.neighborhoods[hood]?.name ?? this.manifest.name;
  }

  /**
   * The nearest named street to (x, z) within maxDist (m), as signed ('Haight St'), from the loaded tiles'
   * OpenStreetMap centerlines ('SBT2'); paths and plazas only when no street is near. null: none / old bake.
   */
  streetNameAt(x: number, z: number, maxDist = 45): string | null {
    const ts = this.manifest.tileSize;
    let best = Infinity;
    let name: string | null = null;
    for (let tz = Math.floor((z - maxDist) / ts); tz <= Math.floor((z + maxDist) / ts); tz++)
      for (let tx = Math.floor((x - maxDist) / ts); tx <= Math.floor((x + maxDist) / ts); tx++) {
        const tr = this.tiles.get(`${tx},${tz}`)?.terrainData;
        if (!tr || !tr.streets.length) continue;
        for (const ln of tr.streets) {
          const xz = ln.xz;
          const pen = ln.rank ? 20 : 0; // (a footway's name only where no street is in reach)
          for (let k = 0; k + 3 < xz.length; k += 2) {
            const d = segDist(xz[k], xz[k + 1], xz[k + 2], xz[k + 3], x, z) + pen;
            if (d < best && d <= maxDist) {
              best = d;
              // (OpenStreetMap's multi-value names: 'Hang Ah Alley;Pagoda Aly' signs its first)
              name = tr.streetNames[ln.name]?.split(';')[0] ?? null;
            }
          }
        }
      }
    return name;
  }

  /** The neighbourhood (an index into manifest.neighborhoods) at (x, z) from the tiles' hood grid ('SBT2'), or -1. */
  hoodAt(x: number, z: number): number {
    const ts = this.manifest.tileSize;
    const tx = Math.floor(x / ts), tz = Math.floor(z / ts);
    const g = this.tiles.get(`${tx},${tz}`)?.terrainData?.hoodGrid;
    if (!g) return -1;
    const i = Math.min(7, Math.max(0, Math.floor(((x - tx * ts) / ts) * 8)));
    const j = Math.min(7, Math.max(0, Math.floor(((z - tz * ts) / ts) * 8)));
    const h = g[j * 8 + i];
    return h === 255 ? -1 : h;
  }

  /** Every currently loaded building ref (for ambient sparkles etc.). */
  *loadedRefs(): IterableIterator<BuildingRef> {
    for (const t of this.tiles.values()) yield* t.refs;
  }

  get time() {
    return globals.uTime.value;
  }
}

/** Paint texels reserved past the baked buildings for hand-built landmark props (addLandmarkBuilding). */
export const LANDMARK_SLOTS = 32;

/**
 * A paintable building that isn't in the baked tiles: a hand-built landmark
 * prop (the Transamerica Pyramid, Sutro Tower). See City.addLandmarkBuilding.
 */
export interface LandmarkBuilding {
  /** paint is saved under this key ('lm:transamerica', LANDMARK_KEY_PREFIX + name) in the landmark store
   * (PaintState landmarkStoreKey), never among the baked stableIds; stable across re-bakes, so never rename one */
  key: string;
  /** its base footprint: a world (x, z) polygon (either winding) */
  ring: Array<[number, number]>;
  /** ground and top (m ASL) */
  baseY: number;
  roofY: number;
  arch?: number;
  /** what the street sign says when it is hit (default: the neighborhood it stands in) */
  name?: string;
  /** its surface height (m ASL) over a point inside the ring (what a breath lands on), default roofY */
  heightAt?: (x: number, z: number) => number;
}

interface LandmarkRec {
  ref: BuildingRef;
  /** its footprint bounds and reach from the centroid (m) */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  rad: number;
  heightAt: ((x: number, z: number) => number) | null;
}
