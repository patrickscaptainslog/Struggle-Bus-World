import * as THREE from 'three';
import { SHADOW_LAYER, makeRampMaterial, globals } from '../render/materials';
import { Ramp } from '../render/palette';
import { makeBuildingMaterial, paintUniforms } from './buildingMaterial';
import { makeHeightGrid, makeTerrainMaterial, makeWaterMaterial } from './terrainMaterial';
import { PaintState } from './PaintState';
import { GroundPaint } from './GroundPaint';
import type { ObstaclePost } from './Bridges';
import { parseFar, type CityManifest, type FarData, type BuildingTile, type TerrainTile } from './tiles';
import { loadRegion, type GridArrays, type RegionRequest, type RegionResponse, type TileResult } from './regionLoader';
import type { CasterArrays, MeshArrays } from './BuildingMesher';

// Streams the baked city around the bus: region bundles are fetched and
// meshed in a worker, tiles appear inside the fog, far ones are dropped.
// Also answers the questions gameplay asks: how high is the ground here,
// what's the tallest thing under this point, which buildings are near.

/** One building (all of its LiDAR tiers): what gameplay paints, aims at and names. */
export interface BuildingRef {
  index: number;
  stableId: number;
  tile: BuildingTile;
  local: number; // record of the ground tier (the footprint) within the tile
  parts: number; // records [local, local + parts) are this building's tiers
  top: number; // record of the highest tier
  cx: number;
  cz: number;
  baseY: number; // ground
  roofY: number; // top of the highest tier
  area: number; // footprint area
  hood: number;
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
}

/** A coarse region drawn as two meshes (its tiles keep their data for gameplay queries). */
interface RegionMesh {
  buildings: THREE.Mesh | null;
  /** where each tile's triangles end in the buildings' index ("tx,tz"): an upgrade to detail trims the mesh tile by tile */
  ends: Map<string, number> | null;
  terrain: THREE.Mesh | null;
  classTex: THREE.DataTexture | null;
  hidden: boolean;
}

/** Work queued for adoption, a few items per frame. */
type Adopt =
  /** one tile of a newly arrived region (coarse: its meshes come with the region item) */
  | { kind: 'tile'; key: string; t: TileResult; coarse: boolean }
  /** after a coarse region's tiles: its merged meshes */
  | { kind: 'coarse'; key: string; msg: RegionResponse }
  /** an adopted region going coarse: all at once (its one merged mesh replaces the tiles') */
  | { kind: 'swap'; key: string; msg: RegionResponse }
  /** an adopted region going to full detail, a tile at a time (the coarse mesh shrinks as they land), then its ground */
  | { kind: 'detail'; key: string; t: TileResult }
  | { kind: 'detailEnd'; key: string };

async function maybeInflate(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const h = new Uint8Array(buf, 0, 2);
  if (h[0] !== 0x1f || h[1] !== 0x8b) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
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

/** World-aligned chunks of a vertex grid's attributes: one frustum-culled mesh per chunk, Uint16 indices. */
type GridAttrs = Record<'position' | 'normal' | 'ramp' | 'lightOffset' | 'glow', Float32Array>;

/**
 * Split a w x h vertex grid (row-major, attribute arrays in `at`) into meshes
 * of `size` x `size` m, binned by each quad's first corner in world space
 * (keyed "cx,cz" = floor(x / size), floor(z / size)). Quads `keep` rejects
 * are dropped. Each chunk gets its own compact copy of the vertices it uses,
 * so normals stay identical across chunk borders (no seams). Static meshes:
 * no matrix updates; the caller sets the material.
 */
function chunkGrid(w: number, h: number, at: GridAttrs, size: number, keep: (a: number, b: number, c: number, d: number) => boolean): Map<string, THREE.Mesh> {
  const quads = new Map<string, number[]>();
  const P = at.position;
  for (let j = 0; j < h - 1; j++)
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      if (!keep(a, b, c, d)) continue;
      const key = `${Math.floor(P[a * 3] / size + 1e-6)},${Math.floor(P[a * 3 + 2] / size + 1e-6)}`;
      let l = quads.get(key);
      if (!l) quads.set(key, (l = []));
      l.push(a);
    }
  const remap = new Int32Array(w * h).fill(-1);
  const out = new Map<string, THREE.Mesh>();
  for (const [key, list] of quads) {
    const used: number[] = [];
    const idx: number[] = [];
    const vid = (v: number) => {
      if (remap[v] < 0) {
        remap[v] = used.length;
        used.push(v);
      }
      return remap[v];
    };
    for (const a of list) {
      const b = a + 1, c = a + w, d = c + 1;
      const A = vid(a), B = vid(b), C = vid(c), D = vid(d);
      idx.push(A, C, B, B, C, D);
    }
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(at) as Array<keyof GridAttrs>) {
      const src = at[name];
      const n = src.length / (w * h);
      const dst = new Float32Array(used.length * n);
      for (let k = 0; k < used.length; k++) for (let q = 0; q < n; q++) dst[k * n + q] = src[used[k] * n + q];
      g.setAttribute(name, new THREE.BufferAttribute(dst, n));
    }
    g.setIndex(new THREE.BufferAttribute(used.length < 65535 ? new Uint16Array(idx) : new Uint32Array(idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    for (const v of used) remap[v] = -1;
    const mesh = new THREE.Mesh(g);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    // a flat slab: its sphere reaches a kilometer above it, the pipeline tests the box (world = local here)
    mesh.userData.viewBox = g.boundingBox;
    out.set(key, mesh);
  }
  return out;
}

const HORIZON_CHUNK = 16384;
const tileKeyNum = (tx: number, tz: number) => (tx + 4096) * 8192 + (tz + 4096);
/** far terrain chunks span this many regions a side (4 km: seen from the ceiling, 2 km chunks cost ~20 more draws than they saved) */
const FAR_CHUNK_REGIONS = 4;
/** view height (m above the floor) above which the far terrain and horizon draw as one mesh each, and below which they go back to chunks */
const FAR_WHOLE_ABOVE = 80;
const FAR_WHOLE_BELOW = 60;

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
  (this as unknown as { array: ArrayLike<number> | null }).array = null;
}

/** New geometry a tile brings (its detailed mesh and caster), for the per-frame upload budget. */
function meshBytes(t: TileResult): number {
  let b = 0;
  const m = t.mesh;
  if (m) b += m.position.byteLength + m.normal.byteLength + m.facade.byteLength + m.meta.byteLength + m.bld.byteLength + m.bld2.byteLength + m.index.byteLength;
  if (t.caster) b += t.caster.position.byteLength + t.caster.index.byteLength;
  return b;
}

function mergedBytes(msg: RegionResponse): number {
  const m = msg.merged;
  return m ? m.position.byteLength + m.normal.byteLength + m.facade.byteLength + m.meta.byteLength + m.bld.byteLength + m.bld2.byteLength + m.index.byteLength : 0;
}
const LOAD_RADIUS = 1500; // m: regions whose center is within this get loaded
const DETAIL_RADIUS = 650; // m: regions nearer than this get full-detail meshes (bays, cornices, stoops)
const UNLOAD_RADIUS = 2300;
// at altitude (viewHeight ~500 m) the circle widens; detail is judged by distance from the lens
// (and its fov), so high up everything is the coarse mesh
const LOAD_RADIUS_HIGH = 1900;
const UNLOAD_RADIUS_HIGH = 2800;
// arrived tiles adopted per frame: at least this many, more while under this many ms and this
// much new geometry (three uploads a mesh the first frame it's drawn: this bounds the upload per frame)
const ADOPT_MIN = 2;
const ADOPT_MS = 2.5;
const ADOPT_BYTES = 3 << 20;
const HASH_CELL = 32;
/** never drawn: casters live on SHADOW_LAYER only, where the sun pass's depth override replaces it */
const CASTER_MATERIAL = new THREE.MeshBasicMaterial();

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
  /** landmark/bridge collision posts, hashed in 64 m cells */
  private posts = new Map<number, ObstaclePost[]>();
  private far: FarData | null = null;
  private farGroup = new THREE.Group();
  /** far terrain in chunks of FAR_CHUNK_REGIONS^2 regions, hidden where every region it covers has its own ground in */
  private farChunks = new Map<string, { mesh: THREE.Mesh; regions: string[] }>();
  /** region ("rx,rz") -> the far chunk its far quads are in */
  private regionFar = new Map<string, string>();
  private horizonChunks: THREE.Mesh[] = [];
  /** the far terrain and the horizon as one mesh each, drawn instead of the chunks while the view is high */
  private farWhole: THREE.Mesh[] = [];
  private farHigh = false;
  /** tiles of a newly arrived region still waiting in the adoption queue */
  private adoptLeft = new Map<string, number>();
  private restoreHooked = false;
  private loadedMask: THREE.DataTexture;
  private maskW: number;
  private maskH: number;
  private regionSize: number;
  /** extension of the binary city files (hosts without a generic binary type serve them under another binary-safe extension) */
  private ext: string;
  /** Called for every tile that arrives (trees, props, landmarks hook in here). */
  onTile: ((t: { tx: number; tz: number; terrain: TerrainTile | null; refs: BuildingRef[] }) => void) | null = null;
  onTileUnload: ((tx: number, tz: number) => void) | null = null;
  readonly loadedRegionCount = () => this.regionsLoaded.size;
  /** Height of the view above the ground (m), set by the game each frame: widens streaming, coarsens detail. */
  viewHeight = 0;
  /** Detail scale of the lens: tan(cruise half-fov) / tan(current half-fov) (a wider lens needs less detail). */
  detailScale = 1;
  private want: Array<[number, number, number, 0 | 1]> = [];
  private adopt: Adopt[] = [];
  /** coarse (LOD 1) regions: all their buildings / all their ground as one mesh each */
  private regionMeshes = new Map<string, RegionMesh>();
  /** tiles that keep their own ground mesh even inside a coarse region (see setOwnGround) */
  private ownGround = new Set<string>();
  /**
   * Adopt arrived tiles all at once (as soon as they land) instead of a few per
   * frame: the game sets it while the loading fog is up, so the first frame
   * matches the classic streaming exactly; afterwards adoption is budgeted.
   */
  eager = false;

  constructor(readonly manifest: CityManifest & { regions: Array<[number, number, number]>; regionSize: number }, readonly baseUrl: string) {
    this.paint = new PaintState(manifest.buildingCount);
    this.ground = new GroundPaint(manifest.tileSize);
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
    this.loadedMask.needsUpdate = true;
    // (static: the far meshes' matrices never change)
    this.farGroup.matrixAutoUpdate = false;
    this.farGroup.matrixWorldAutoUpdate = false;
    this.root.add(this.farGroup);
    // the bay / ocean: a huge still plane below everything
    const water = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), makeWaterMaterial());
    water.position.set((minX + maxX) / 2, -0.6, (minZ + maxZ) / 2);
    water.frustumCulled = false;
    this.root.add(water);
  }

  async loadFar(): Promise<void> {
    const [res, hz] = await Promise.all([fetch(`${this.baseUrl}/far${this.ext}`), fetch(`${this.baseUrl}/horizon${this.ext}`).catch(() => null)]);
    this.far = parseFar(await maybeInflate(await res.arrayBuffer()));
    this.buildFar();
    if (hz && hz.ok) this.buildHorizon(await maybeInflate(await hz.arrayBuffer()));
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
        ramp[k] = y > 40 ? Ramp.GREEN_GREY : Ramp.GREY_LIGHT;
        lo[k] = 0.02;
        land[k] = y > 0.5 ? 1 : 0;
      }
    const [bx0, bz0, bx1, bz1] = this.manifest.bounds;
    // (16 km chunks, culled: the chase camera looks down, so it rarely sees any of them; up high one mesh)
    const mat = makeRampMaterial({ vertexRamp: true, shadowMul: 0 });
    const at = { position: pos, normal: nrm, ramp, lightOffset: lo, glow: gl };
    const keep = (a: number, b: number, c: number, d: number) => {
      if (!(land[a] || land[b] || land[c] || land[d])) return false;
      const x = pos[a * 3], z = pos[a * 3 + 2];
      // the city's own far grid covers its frame
      return !(x >= bx0 && x + step * cell <= bx1 && z >= bz0 && z + step * cell <= bz1);
    };
    for (const mesh of chunkGrid(w, h, at, HORIZON_CHUNK, keep).values()) {
      mesh.material = mat;
      mesh.visible = !this.farHigh;
      this.farGroup.add(mesh);
      this.horizonChunks.push(mesh);
    }
    for (const mesh of chunkGrid(w, h, at, Infinity, keep).values()) {
      mesh.material = mat;
      mesh.visible = this.farHigh;
      this.farGroup.add(mesh);
      this.farWhole.push(mesh);
    }
  }

  private buildFar() {
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
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const gi = i * step, gj = j * step;
        const k = j * W + i;
        const water = f.cls[Math.min(f.gridH - 1, gj) * f.gridW + Math.min(f.gridW - 1, gi)] === 2;
        pos[k * 3] = f.minX + gi * f.cell;
        pos[k * 3 + 1] = water ? -6 : hAt(gi, gj) - 2.2;
        pos[k * 3 + 2] = f.minZ + gj * f.cell;
        const dx = (hAt(gi + 1, gj) - hAt(gi - 1, gj)) / (2 * f.cell);
        const dz = (hAt(gi, gj + 1) - hAt(gi, gj - 1)) / (2 * f.cell);
        const l = Math.hypot(dx, 1, dz);
        nrm[k * 3] = -dx / l;
        nrm[k * 3 + 1] = 1 / l;
        nrm[k * 3 + 2] = -dz / l;
        ramp[k] = water ? Ramp.WATER : Ramp.GREY_LIGHT;
        lo[k] = water ? -0.1 : -0.06;
      }
    }
    // culled 4x4-region chunks (the grid's quads land exactly on region edges), each hidden once
    // every region it covers has its own ground in; quads whose four corners are water sit under the
    // bay and are never seen
    const R = this.regionSize * this.manifest.tileSize;
    const C = R * FAR_CHUNK_REGIONS;
    const land = (a: number, b: number, c: number, d: number) => !(ramp[a] === Ramp.WATER && ramp[b] === Ramp.WATER && ramp[c] === Ramp.WATER && ramp[d] === Ramp.WATER);
    const mat = makeRampMaterial({ vertexRamp: true, shadowMul: 1 });
    const at = { position: pos, normal: nrm, ramp, lightOffset: lo, glow: gl };
    for (const [key, mesh] of chunkGrid(W, H, at, C, land)) {
      mesh.material = mat;
      this.farGroup.add(mesh);
      this.farChunks.set(key, { mesh, regions: [] });
    }
    // seen from high up most chunks are in view: there it's one mesh (one draw instead of a dozen)
    for (const mesh of chunkGrid(W, H, at, Infinity, land).values()) {
      mesh.material = mat;
      mesh.visible = this.farHigh;
      this.farGroup.add(mesh);
      this.farWhole.push(mesh);
    }
    // which regions each chunk's quads lie in
    for (let j = 0; j < H - 1; j++)
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i;
        if (!land(a, a + 1, a + W, a + W + 1)) continue;
        const x = pos[a * 3] + 1e-3, z = pos[a * 3 + 2] + 1e-3;
        const rk = `${Math.floor(x / R)},${Math.floor(z / R)}`;
        if (this.regionFar.has(rk)) continue;
        const ck = `${Math.floor(x / C)},${Math.floor(z / C)}`;
        this.regionFar.set(rk, ck);
        this.farChunks.get(ck)?.regions.push(rk);
      }
    for (const key of this.regionsLoaded) this.refreshFarChunk(key);

    // far skyline: tall buildings as boxes, hidden where real tiles are loaded
    const n = f.index.length;
    if (n) {
      const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const mat = makeRampMaterial({
        ramp: Ramp.GREY,
        lightOffset: 0.02,
        uniforms: {
          uMask: { value: this.loadedMask },
          uMaskRect: { value: new THREE.Vector4(this.manifest.bounds[0], this.manifest.bounds[1], 1 / this.manifest.tileSize, 0) },
          uMaskSize: { value: new THREE.Vector2(this.maskW, this.maskH) },
        },
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
      const inst = new THREE.InstancedMesh(box, mat, n);
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
      this.farGroup.add(inst);
    }
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

  /** Stream regions around a point (at altitude the game passes a point ahead of the bus, under the view). */
  update(focus: THREE.Vector3, renderer: THREE.WebGLRenderer, dt: number) {
    if (!this.restoreHooked) {
      // (three re-creates its GL state first: its own listener was added with the renderer)
      this.restoreHooked = true;
      renderer.domElement.addEventListener('webglcontextrestored', () => this.reloadAll());
    }
    const R = this.regionSize * this.manifest.tileSize;
    // at altitude: a wider circle of coarse regions, detail only where pixels are still small
    const hk = Math.min(1, Math.max(0, (this.viewHeight - 40) / 460));
    const loadR = LOAD_RADIUS + (LOAD_RADIUS_HIGH - LOAD_RADIUS) * hk;
    const unloadR = UNLOAD_RADIUS + (UNLOAD_RADIUS_HIGH - UNLOAD_RADIUS) * hk;
    const lift = Math.max(0, this.viewHeight - 30);
    const ds = Math.max(0.2, this.detailScale);
    const detailD = (d: number) => (lift > 0 ? Math.hypot(d, lift) : d) / ds;
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
        if (d < loadR) want.push([rx, rz, d, detailD(d) < DETAIL_RADIUS ? 0 : 1]);
      }
    // upgrade already-loaded coarse regions that are now close; coarsen detailed ones the view rose above
    for (const key of this.regionsLoaded) {
      const lod = this.regionLod.get(key);
      if (lod === undefined || this.isPending(key)) continue;
      // (a swap that failed backs off too: offline, it would re-request every frame)
      if ((this.retryAt.get(key) ?? 0) > performance.now()) continue;
      const [rx, rz] = this.regionXZ.get(key)!;
      const cx = (rx + 0.5) * R, cz = (rz + 0.5) * R;
      const d = Math.hypot(Math.max(Math.abs(focus.x - cx) - R / 2, 0), Math.max(Math.abs(focus.z - cz) - R / 2, 0));
      if (lod === 1 && detailD(d) < DETAIL_RADIUS * 0.8) want.push([rx, rz, d - 10000, 0]);
      else if (lod === 0 && detailD(d) > DETAIL_RADIUS * 1.4) want.push([rx, rz, d + 10000, 1]);
    }
    want.sort((a, b) => a[2] - b[2]);
    for (const [rx, rz, , lod] of want) {
      if (this.pending.size >= 2) break;
      const key = this.regionKey(rx, rz);
      this.regionsRequested.add(key);
      const id = this.nextId++;
      this.pending.set(id, { key, lod });
      const msg: RegionRequest = { type: 'region', id, url: new URL(`${this.baseUrl}/r_${rx}_${rz}${this.ext}`, location.href).href, classN: this.manifest.classN, lod };
      if (this.worker) this.worker.postMessage(msg);
      else void loadRegion(msg).then((r) => this.onRegion(r));
    }
    // unload far regions
    for (const key of this.regionsLoaded) {
      const [rx, rz] = this.regionXZ.get(key)!;
      const cx = (rx + 0.5) * R, cz = (rz + 0.5) * R;
      const dx = Math.max(Math.abs(focus.x - cx) - R / 2, 0);
      const dz = Math.max(Math.abs(focus.z - cz) - R / 2, 0);
      if (Math.hypot(dx, dz) > unloadR) this.unloadRegion(rx, rz);
    }
    // adopt arrived tiles a few per frame: a region landing never hitches one frame
    const t0 = performance.now();
    let n = 0;
    let bytes = 0;
    while (this.adopt.length && (this.eager || n < ADOPT_MIN || (performance.now() - t0 < ADOPT_MS && bytes < ADOPT_BYTES))) {
      const a = this.adopt.shift()!;
      n++;
      if (!this.regionsLoaded.has(a.key)) continue; // unloaded while queued
      if (a.kind === 'tile') {
        this.addTile(a.t, a.coarse);
        this.loadedMask.needsUpdate = true;
        if (!a.coarse) bytes += meshBytes(a.t);
      } else if (a.kind === 'coarse') {
        this.buildRegionMesh(a.key, a.msg);
        bytes += mergedBytes(a.msg);
      } else if (a.kind === 'swap') {
        this.swapRegion(a.key, a.msg);
        bytes += mergedBytes(a.msg);
      } else if (a.kind === 'detail') {
        this.detailTile(a.key, a.t);
        bytes += meshBytes(a.t);
      } else this.detailEnd(a.key);
      if (a.kind === 'tile' || a.kind === 'coarse') {
        // the region's own ground is all in: its far terrain goes
        const left = (this.adoptLeft.get(a.key) ?? 1) - 1;
        if (left > 0) this.adoptLeft.set(a.key, left);
        else {
          this.adoptLeft.delete(a.key);
          this.refreshFarChunk(a.key);
        }
      }
    }
    // far terrain and horizon: culled chunks near the rooftops, one mesh each from high up
    const high = this.viewHeight > (this.farHigh ? FAR_WHOLE_BELOW : FAR_WHOLE_ABOVE);
    if (high !== this.farHigh) {
      this.farHigh = high;
      for (const m of this.farWhole) m.visible = high;
      for (const m of this.horizonChunks) m.visible = !high;
      for (const ch of this.farChunks.values()) this.showFarChunk(ch);
    }
    this.paint.flush(renderer, dt);
    this.ground.work();
    this.ground.flush(renderer, dt);
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
    const rm: RegionMesh = { buildings: merged ? this.makeBuildingMesh(merged, msg.mergedSphere ?? null, true) : null, ends: null, terrain: null, classTex: null, hidden: false };
    if (rm.buildings && msg.mergedEnds) {
      rm.ends = new Map();
      for (let i = 0; i < msg.tiles.length; i++) if (msg.mergedEnds[i] >= 0) rm.ends.set(`${msg.tiles[i].tx},${msg.tiles[i].tz}`, msg.mergedEnds[i]);
    }
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
      const mesh = new THREE.Mesh(g, makeTerrainMaterial(tex, rx * rs * ts, rz * rs * ts, rs * ts, N));
      mesh.matrixAutoUpdate = false;
      mesh.visible = !rm.hidden;
      this.root.add(mesh);
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

  /** Switch an adopted region to its coarse level in one go (same frame: the tiles' meshes go and the region's arrive, no holes). */
  private swapRegion(key: string, msg: RegionResponse) {
    for (const k of this.tileKeysOf(key)) {
      const lt = this.tiles.get(k);
      if (lt) this.dropTileMeshes(lt);
    }
    for (const t of msg.tiles) {
      const lt = this.tiles.get(`${t.tx},${t.tz}`);
      if (lt) lt.grid = t.grid;
    }
    this.buildRegionMesh(key, msg);
  }

  /**
   * One tile of a region going to full detail: its detailed buildings arrive
   * and the coarse mesh stops drawing that tile (tiles land in the merged
   * mesh's own order, so what's left of it is one index range). No holes, no
   * overlap, and the upload spreads over a few frames instead of ~20 MB in one.
   */
  private detailTile(key: string, t: TileResult) {
    const tk = `${t.tx},${t.tz}`;
    const lt = this.tiles.get(tk);
    if (!lt) return;
    this.dropTileBuildings(lt);
    this.makeTileBuildings(lt, t);
    lt.grid = t.grid; // (its 4 m ground lands with the region's last tile)
    if (lt.buildings) lt.buildings.visible = !lt.hidden;
    if (lt.caster) lt.caster.visible = !lt.hidden;
    const rm = this.regionMeshes.get(key);
    const end = rm?.ends?.get(tk);
    if (rm?.buildings && end !== undefined) {
      const g = rm.buildings.geometry;
      if (end > g.drawRange.start) g.setDrawRange(end, Infinity);
    }
  }

  /** The region's detailed tiles are all in: the ground follows (4 m grids, they cast) and the coarse meshes go. */
  private detailEnd(key: string) {
    for (const k of this.tileKeysOf(key)) {
      const lt = this.tiles.get(k);
      if (!lt) continue;
      if (lt.terrainStep !== 2) {
        this.dropTileTerrain(lt);
        this.makeTileTerrain(lt, 2);
      }
    }
    this.disposeRegionMesh(key);
  }

  private dropTileMeshes(lt: LoadedTile) {
    this.dropTileBuildings(lt);
    this.dropTileTerrain(lt);
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
    const tr = lt.terrainData;
    if (!tr) return;
    const tex = new THREE.DataTexture(tr.cls, tr.classN, tr.classN, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    lt.classTex = tex;
    const geo = this.takeGrid(lt, step);
    dropAfterUpload(geo);
    const gu = this.ground.tileUniforms();
    const mesh = new THREE.Mesh(geo, makeTerrainMaterial(tex, tr.originX, tr.originZ, this.manifest.tileSize, tr.classN, 0, gu));
    this.ground.attach(lt.tx, lt.tz, tr.originX, tr.originZ, gu);
    if (step === 2) mesh.layers.enable(SHADOW_LAYER);
    mesh.userData.sunCull = true; // (the sun pass skips it when its shadow can't reach the view)
    mesh.matrixAutoUpdate = false;
    mesh.visible = !lt.hidden;
    this.root.add(mesh);
    lt.terrain = mesh;
    lt.terrainStep = step;
  }

  /** The tile's ground grid as geometry: the worker's if it built this step, else made here. */
  private takeGrid(lt: LoadedTile, step: number): THREE.BufferGeometry {
    const g = lt.grid;
    lt.grid = null;
    const tr = lt.terrainData!;
    if (!g || g.step !== step) return makeHeightGrid(tr.heights, tr.n, tr.cell, tr.originX, tr.originZ, step);
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
    const rs = this.regionSize;
    for (const lt of this.tiles.values()) {
      const h = buried ? buried(lt.tx * ts, lt.tz * ts, (lt.tx + 1) * ts, (lt.tz + 1) * ts, lt.maxY, lt.hidden) : false;
      if (h === lt.hidden) continue;
      lt.hidden = h;
      this.refreshFarChunk(`${Math.floor(lt.tx / rs)},${Math.floor(lt.tz / rs)}`);
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
    return this.pending.size > 0 || this.adopt.length > 0;
  }

  private isPending(key: string): boolean {
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
      // back off: a flaky network shouldn't turn into a request storm
      this.retryAt.set(key, performance.now() + 3000);
      return;
    }
    if (!this.regionsRequested.has(key)) return; // unloaded while in flight
    // an already-loaded region goes coarse in one go, or to detail a tile at a time; a new one adopts its tiles a few per frame
    if (this.regionsLoaded.has(key)) {
      if (msg.lod === 1) this.adopt.push({ kind: 'swap', key, msg });
      else {
        for (const t of msg.tiles) this.adopt.push({ kind: 'detail', key, t });
        this.adopt.push({ kind: 'detailEnd', key });
      }
    } else {
      this.regionsLoaded.add(key);
      const coarse = msg.lod === 1;
      for (const t of msg.tiles) this.adopt.push({ kind: 'tile', key, t, coarse });
      if (coarse) this.adopt.push({ kind: 'coarse', key, msg });
      this.adoptLeft.set(key, msg.tiles.length + (coarse ? 1 : 0));
      if (!msg.tiles.length && !coarse) this.adoptLeft.delete(key);
    }
    this.regionLod.set(key, msg.lod);
  }

  private makeBuildingMesh(m: MeshArrays, sphere: Float32Array | null, cast: boolean): THREE.Mesh | null {
    if (m.vertexCount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3, true));
    g.setAttribute('aFacade', new THREE.BufferAttribute(m.facade, 2));
    g.setAttribute('aMeta', new THREE.BufferAttribute(m.meta, 4));
    g.setAttribute('aBld', new THREE.BufferAttribute(m.bld, 4));
    g.setAttribute('aBld2', new THREE.BufferAttribute(m.bld2, 2));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    // (bounds come from the worker; the main thread never walks the vertices)
    if (sphere) g.boundingSphere = new THREE.Sphere(new THREE.Vector3(sphere[0], sphere[1], sphere[2]), sphere[3]);
    else g.computeBoundingSphere();
    // generous bounds: painted buildings pop and wobble a little outside their rest pose
    if (g.boundingSphere) g.boundingSphere.radius += 6;
    dropAfterUpload(g);
    const mesh = new THREE.Mesh(g, this.buildingMaterial);
    if (cast) mesh.layers.enable(SHADOW_LAYER);
    mesh.userData.sunCull = true;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    return mesh;
  }

  /** The sun-pass proxy of a detailed tile: positions only, drawn by the shadow camera alone. */
  private makeCasterMesh(c: CasterArrays, sphere: THREE.Sphere): THREE.Mesh | null {
    if (c.vertexCount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(c.position, 3));
    g.setIndex(new THREE.BufferAttribute(c.index, 1));
    g.boundingSphere = sphere.clone(); // a subset of the detailed mesh: its bounds hold
    dropAfterUpload(g);
    const mesh = new THREE.Mesh(g, CASTER_MATERIAL); // (the sun pass draws it with its depth override)
    mesh.layers.set(SHADOW_LAYER);
    mesh.matrixAutoUpdate = false;
    mesh.userData.sbKind = 'caster';
    mesh.userData.sunCull = true;
    this.root.add(mesh);
    return mesh;
  }

  /** Adopt one tile: gameplay data always; its own meshes unless it's part of a coarse region (drawn whole). */
  private addTile(t: TileResult, coarse = false) {
    const key = `${t.tx},${t.tz}`;
    if (this.tiles.has(key)) return;
    const lt: LoadedTile = { tx: t.tx, tz: t.tz, buildings: null, caster: null, terrain: null, terrainData: t.terrain, buildingData: t.building, refs: [], classTex: null, maxY: -Infinity, hidden: false, terrainStep: 0, grid: t.grid };
    if (!coarse) this.makeTileBuildings(lt, t);
    if (t.building) {
      const b = t.building;
      for (let i = 0; i < b.count; ) {
        // a building's tiers are consecutive records sharing its paint index: one ref for all of them
        let j = i + 1;
        let top = i;
        while (j < b.count && b.index[j] === b.index[i]) {
          if (b.roofY[j] > b.roofY[top]) top = j;
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
        const ref: BuildingRef = { index: b.index[i], stableId: b.stableId[i], tile: b, local: i, parts: j - i, top, cx, cz, baseY: b.groundY[i], roofY: b.roofY[top], area: Math.abs(area) / 2, hood: b.hood[i] };
        i = j;
        lt.refs.push(ref);
        if (ref.roofY + 6 > lt.maxY) lt.maxY = ref.roofY + 6;
        const hk = this.hashKey(cx, cz);
        let list = this.hash.get(hk);
        if (!list) this.hash.set(hk, (list = []));
        list.push(ref);
        this.paint.register(ref.index, ref.stableId);
      }
    }
    if (t.terrain) {
      const tr = t.terrain;
      // trees are obstacles too: the bus skims canopies, never flies through them
      const oc = this.manifest.tileSize / tr.obstN;
      for (const tree of tr.trees) {
        const ix = Math.floor((tree.x - tr.originX) / oc), iz = Math.floor((tree.z - tr.originZ) / oc);
        if (ix < 0 || iz < 0 || ix >= tr.obstN || iz >= tr.obstN) continue;
        const top = tree.y + 16 * tree.size;
        const k = iz * tr.obstN + ix;
        if (top > tr.obst[k]) tr.obst[k] = top;
      }
      for (let k = 0; k < tr.obst.length; k++) if (tr.obst[k] > lt.maxY) lt.maxY = tr.obst[k];
      for (let k = 0; k < tr.heights.length; k++) if (tr.heights[k] > lt.maxY) lt.maxY = tr.heights[k];
      if (!coarse) {
        this.makeTileTerrain(lt, 2);
        // (a coarse region masks the far skyline when its own meshes land)
        this.setMask(t.tx, t.tz, 255);
      }
    }
    this.tiles.set(key, lt);
    this.tileNum.set(tileKeyNum(t.tx, t.tz), lt);
    this.onTile?.({ tx: t.tx, tz: t.tz, terrain: t.terrain, refs: lt.refs });
  }

  private unloadRegion(rx: number, rz: number) {
    const key = `${rx},${rz}`;
    this.regionsLoaded.delete(key);
    this.regionsRequested.delete(key);
    this.regionLod.delete(key);
    if (this.adopt.length) this.adopt = this.adopt.filter((a) => a.key !== key);
    this.adoptLeft.delete(key);
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
        }
        const mx = Math.round((tx * ts - minX) / ts);
        const mz = Math.round((tz * ts - minZ) / ts);
        if (mx >= 0 && mz >= 0 && mx < this.maskW && mz < this.maskH) (this.loadedMask.image.data as Uint8Array)[mz * this.maskW + mx] = 0;
        this.tiles.delete(k);
        this.tileNum.delete(tileKeyNum(tx, tz));
        this.onTileUnload?.(tx, tz);
      }
    this.loadedMask.needsUpdate = true;
    this.refreshFarChunk(key);
  }

  /** The far chunk under a region shows unless all of its regions have their own ground in. */
  private refreshFarChunk(key: string) {
    const ck = this.regionFar.get(key);
    const ch = ck !== undefined ? this.farChunks.get(ck) : undefined;
    if (ch) this.showFarChunk(ch);
  }

  private showFarChunk(ch: { mesh: THREE.Mesh; regions: string[] }) {
    let covered = true;
    if (!this.farHigh) for (const r of ch.regions) if (!(covered = this.groundIn(r))) break;
    ch.mesh.visible = !this.farHigh && !covered;
  }

  /** True if a region's own ground is all in (loaded, adopted, none of it hidden in the fog sea). */
  private groundIn(key: string): boolean {
    if (!this.regionsLoaded.has(key) || this.adoptLeft.has(key)) return false;
    for (const k of this.tileKeysOf(key)) if (this.tiles.get(k)?.hidden) return false;
    return true;
  }

  private hashKey(x: number, z: number) {
    return (Math.floor(x / HASH_CELL) + 4096) * 8192 + (Math.floor(z / HASH_CELL) + 4096);
  }

  private tileAt(x: number, z: number): LoadedTile | undefined {
    const ts = this.manifest.tileSize;
    return this.tileNum.get(tileKeyNum(Math.floor(x / ts), Math.floor(z / ts)));
  }

  /** Ground height (m). Falls back to the far grid where tiles aren't loaded. */
  groundAt(x: number, z: number): number {
    const lt = this.tileAt(x, z);
    if (lt?.terrainData) {
      const t = lt.terrainData;
      const fx = Math.min(t.n - 1.001, Math.max(0, (x - t.originX) / t.cell));
      const fz = Math.min(t.n - 1.001, Math.max(0, (z - t.originZ) / t.cell));
      const ix = Math.floor(fx), iz = Math.floor(fz);
      const ax = fx - ix, az = fz - iz;
      const h = t.heights;
      const n = t.n;
      const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
      return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
    }
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

  /** Tallest roof, tree or ground at a point, without the landmark posts and bridge decks (what a breath lands on). */
  surfaceAt(x: number, z: number): number {
    return this.baseObstacleAt(x, z);
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
    out.length = 0;
    const c0x = Math.floor((x - r) / HASH_CELL), c1x = Math.floor((x + r) / HASH_CELL);
    const c0z = Math.floor((z - r) / HASH_CELL), c1z = Math.floor((z + r) / HASH_CELL);
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = this.hash.get((cx + 4096) * 8192 + (cz + 4096));
        if (!list) continue;
        for (const ref of list) {
          const d = Math.hypot(ref.cx - x, ref.cz - z);
          if (d <= r) out.push({ ref, d });
        }
      }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  /** Roof height at (x, z) of the building whose footprint contains it (its part there), or null (no allocation, no sort). */
  roofAt(x: number, z: number): number | null {
    const cx0 = Math.floor(x / HASH_CELL), cz0 = Math.floor(z / HASH_CELL);
    for (let cz = cz0 - 1; cz <= cz0 + 1; cz++)
      for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
        const list = this.hash.get((cx + 4096) * 8192 + (cz + 4096));
        if (!list) continue;
        for (const ref of list) if (this.contains(ref, x, z)) return this.roofAtPart(ref, x, z);
      }
    return null;
  }

  /** True if (x, z) is inside the footprint of ref (any ground-tier part; the tiers above stand on it). */
  contains(ref: BuildingRef, x: number, z: number): boolean {
    const b = ref.tile;
    for (let k = ref.local; k < ref.local + ref.parts; k++) if (b.tier[k] === 0 && ringContains(b, k, x, z)) return true;
    return false;
  }

  /** Roof height of ref right at (x, z): the highest of its parts covering the point (a tiered
   * tower's podium roof is not the top of its tower), or ref.roofY if none does. */
  roofAtPart(ref: BuildingRef, x: number, z: number): number {
    const b = ref.tile;
    let y = -Infinity;
    for (let k = ref.local; k < ref.local + ref.parts; k++) if (b.roofY[k] > y && ringContains(b, k, x, z)) y = b.roofY[k];
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

  /** Oriented roof rectangle (for rooftop sprouts), aligned with the street front: the roof of the
   * highest tier that is a real roof (a fifth of the footprint or more), not a crown or a penthouse. */
  roofRect(ref: BuildingRef): { cx: number; cz: number; y: number; w: number; d: number; yaw: number } {
    const f = this.frontOf(ref);
    const ux = -f.nz, uz = f.nx;
    const b = ref.tile;
    let top = ref.local;
    for (let k = ref.local + 1; k < ref.local + ref.parts; k++) if (b.roofY[k] > b.roofY[top] && ringArea(b, k) >= 0.2 * ref.area) top = k;
    const s = b.vertStart[top], e = b.vertStart[top + 1];
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

  /** Every currently loaded building ref (for ambient sparkles etc.). */
  *loadedRefs(): IterableIterator<BuildingRef> {
    for (const t of this.tiles.values()) yield* t.refs;
  }

  get time() {
    return globals.uTime.value;
  }
}
