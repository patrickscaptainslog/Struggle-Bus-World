// Readers for the baked city tiles (writer: tools/bake/bake.py — keep in sync).
// All little-endian. Coordinates are local meters: +X east, +Z south, +Y up.

export const Arch = {
  GENERIC: 0,
  VICTORIAN: 1,
  FLATS: 2,
  COMMERCIAL: 3,
  TOWER: 4,
  STUCCO: 5,
  MARINA: 6,
  SHED: 7,
  CIVIC: 8,
} as const;

/**
 * Ground classes of the 2 m class texture. 0-3 are every bake's; 4-10 come with OpenStreetMap ('SBT2'):
 * PLAZA pedestrian areas, squares, piers; PATH footways, cycleways, steps, tracks; SAND beaches, dunes,
 * bunkers; RAIL tracks on their own bed; FOREST woods; YARD block interiors (gardens, unmapped land);
 * ROCK bare rock, cliffs, scree.
 */
export const Ground = { PAVED: 0, GRASS: 1, WATER: 2, SIDEWALK: 3, PLAZA: 4, PATH: 5, SAND: 6, RAIL: 7, FOREST: 8, YARD: 9, ROCK: 10 } as const;

/** Roof shapes ('SBB3' roofShape; OpenStreetMap roof:shape). 0 = untagged: the mesher's own choice. */
export const RoofShape = {
  NONE: 0, FLAT: 1, GABLED: 2, HIPPED: 3, PYRAMIDAL: 4, SKILLION: 5, DOME: 6, ONION: 7, ROUND: 8,
  GAMBREL: 9, MANSARD: 10, HALF_HIPPED: 11, SALTBOX: 12, CONE: 13,
} as const;

/** Facade / roof materials ('SBB3' facadeMat / roofMat; OpenStreetMap building:material / roof:material). */
export const Material = {
  NONE: 0, BRICK: 1, WOOD: 2, PLASTER: 3, CONCRETE: 4, GLASS: 5, METAL: 6, STONE: 7, TILES: 8, SLATE: 9,
  GRASS: 10, ASPHALT: 11, PLASTIC: 12, THATCH: 13,
} as const;

export interface CityManifest {
  name: string;
  slug: string;
  origin: [number, number];
  tileSize: number;
  terrainN: number;
  obstN: number;
  classN: number;
  bounds: [number, number, number, number];
  buildingCount: number;
  tiles: Array<[number, number, number]>; // tx, tz, buildingCount
  neighborhoods: Array<{ name: string; x: number; z: number }>;
  landmarks: Array<{ kind: string; x: number; y: number; z: number; height: number }>;
  start: { x: number; z: number; heading: number };
  source: string;
  /** Data credit to show in the game (ODbL: OpenStreetMap-derived bakes). */
  attribution?: string;
  license?: string;
}

/**
 * Building tile. One record per building *part*: a plain building is one part;
 * a LiDAR-tiered tower is several (podium, setbacks, crown...) stacked on each
 * other. Parts of one building are consecutive, tier 0 (the footprint) first,
 * and share index (the paint texel), stableId, arch, floors, hood and seed.
 *
 * 'SBB2':
 *   header: magic[4] u32 count, u32 vertCount, f32 originX, f32 originZ, u32 reserved
 *   u32 index[count], u32 stableId[count], u32 vertStart[count+1],
 *   f32 baseY[count]   (bottom of this part: the ground for tier 0, else the top of the tier below)
 *   f32 roofY[count]   (top of this part)
 *   f32 groundY[count] (the building's true ground: window rows line up across tiers)
 *   u8 arch[count], u8 floors[count], u8 front[count], u8 front2[count], u8 hood[count], u8 seed[count],
 *   u8 tier[count] (0 = ground tier),
 *   u8 taper[count] (0 = vertical walls; else the part's top outline is its base ring scaled by
 *                    1 - taper/255 about the ring's area centroid: Salesforce Tower's taper), pad to 4,
 *   i16 vx[vertCount], i16 vz[vertCount]   (decimeters relative to origin; rings CCW in (x, z))
 * 'SBB1': the same without groundY, tier and taper (every record is a one-part building: groundY = baseY, tier = 0, taper = 0).
 *
 * 'SBB3' (OpenStreetMap bakes): SBB2 plus, after groundY:
 *   u32 facadeColor[count], u32 roofColor[count]  (0xFFRRGGBB as mapped in OSM; 0 = not mapped)
 *   u16 roofH[count]   (decimeters: a shaped roof's rise above roofY, which is then the eave; 0 = none)
 * and after taper:
 *   u8 roofShape[count] (RoofShape), u8 roofDir[count] (the way the main roof face looks, downhill: angle
 *   atan2(dz, dx) in the local frame, 256 = a full turn; the ridge runs across it),
 *   u8 facadeMat[count], u8 roofMat[count] (Material), u8 source[count] (bits 0-2 footprint: 0 OSM,
 *   1 Overture other, 2 USA Structures, 3 LiDAR only; bits 3-5 height: 0 default, 1 LiDAR, 2 OSM height,
 *   3 OSM floors, 4 USA Structures, 5 neighbours; bit 6 massing from OSM building parts, bit 7 LiDAR tiers)
 * then pad to 4 (from the start of the tile) and the rings as above. A building's parts may then hold
 * several tier-0 records (OSM parts on the ground, pieces cut through a courtyard), the biggest first.
 */
export interface BuildingTile {
  count: number;
  originX: number;
  originZ: number;
  index: Uint32Array;
  stableId: Uint32Array;
  vertStart: Uint32Array;
  baseY: Float32Array;
  roofY: Float32Array;
  groundY: Float32Array;
  arch: Uint8Array;
  floors: Uint8Array;
  front: Uint8Array;
  front2: Uint8Array;
  hood: Uint8Array;
  seed: Uint8Array;
  tier: Uint8Array;
  taper: Uint8Array;
  /** 'SBB3' (zeros before): roof shape, its rise (m) above roofY, its direction byte; colours, materials, source. */
  roofShape: Uint8Array;
  roofH: Float32Array;
  roofDir: Uint8Array;
  facadeColor: Uint32Array;
  roofColor: Uint32Array;
  facadeMat: Uint8Array;
  roofMat: Uint8Array;
  source: Uint8Array;
  /** Absolute world coords, interleaved per building ring: x0,z0,x1,z1... indexed by vertStart*2. */
  xz: Float32Array;
}

export function parseBuildingTile(buf: ArrayBuffer): BuildingTile {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SBB1' && magic !== 'SBB2' && magic !== 'SBB3') throw new Error('bad building tile');
  const v3 = magic === 'SBB3';
  const v2 = magic === 'SBB2' || v3;
  const count = dv.getUint32(4, true);
  const vertCount = dv.getUint32(8, true);
  const originX = dv.getFloat32(12, true);
  const originZ = dv.getFloat32(16, true);
  let o = 24;
  const u32 = (n: number) => {
    const a = new Uint32Array(buf.slice(o, o + n * 4));
    o += n * 4;
    return a;
  };
  const f32 = (n: number) => {
    const a = new Float32Array(buf.slice(o, o + n * 4));
    o += n * 4;
    return a;
  };
  const u8 = (n: number) => {
    const a = new Uint8Array(buf, o, n).slice();
    o += n;
    return a;
  };
  const index = u32(count);
  const stableId = u32(count);
  const vertStart = u32(count + 1);
  const baseY = f32(count);
  const roofY = f32(count);
  const groundY = v2 ? f32(count) : baseY.slice();
  const facadeColor = v3 ? u32(count) : new Uint32Array(count);
  const roofColor = v3 ? u32(count) : new Uint32Array(count);
  const roofH = new Float32Array(count);
  if (v3) {
    for (let i = 0; i < count; i++) roofH[i] = dv.getUint16(o + i * 2, true) / 10;
    o += count * 2;
  }
  const arch = u8(count);
  const floors = u8(count);
  const front = u8(count);
  const front2 = u8(count);
  const hood = u8(count);
  const seed = u8(count);
  const tier = v2 ? u8(count) : new Uint8Array(count);
  const taper = v2 ? u8(count) : new Uint8Array(count);
  const roofShape = v3 ? u8(count) : new Uint8Array(count);
  const roofDir = v3 ? u8(count) : new Uint8Array(count);
  const facadeMat = v3 ? u8(count) : new Uint8Array(count);
  const roofMat = v3 ? u8(count) : new Uint8Array(count);
  const source = v3 ? u8(count) : new Uint8Array(count);
  o += (4 - (o % 4)) % 4;
  const vx = new Int16Array(buf.slice(o, o + vertCount * 2));
  o += vertCount * 2;
  const vz = new Int16Array(buf.slice(o, o + vertCount * 2));
  const xz = new Float32Array(vertCount * 2);
  for (let i = 0; i < vertCount; i++) {
    xz[i * 2] = originX + vx[i] / 10;
    xz[i * 2 + 1] = originZ + vz[i] / 10;
  }
  return {
    count, originX, originZ, index, stableId, vertStart, baseY, roofY, groundY, arch, floors, front, front2, hood, seed, tier, taper,
    roofShape, roofH, roofDir, facadeColor, roofColor, facadeMat, roofMat, source, xz,
  };
}

/**
 * 'SBT1' terrain tile:
 *   header: magic[4] i32 tx, i32 tz, u16 n, u16 obstN, f32 cell, f32 originX, f32 originZ   (28 bytes)
 *   i16 h[n*n] (decimeters), u8 cls[n*n], pad to 4,
 *   i16 obst[obstN*obstN] (decimeters; max of roofs (+3 m buffer) and ground per 8 m cell)
 *   u16 treeCount, u16 pad, trees: { i16 x, i16 z, i16 y (dm), u8 size*100, u8 kind } * treeCount, pad to 4,
 *   u8 class[classN*classN] (2 m ground class texture, texel centers)
 * 'SBT2' (OpenStreetMap bakes): the same, then pad to 4 and the street-name section:
 *   u8 hood[8*8] (the neighbourhood of each 32 m cell, row-major z rows: an index into
 *                 manifest.neighborhoods; 255 = none)
 *   u16 nameCount, u16 lineCount
 *   names: { u8 byteLength, utf-8 bytes (as signed: 'Haight St') } * nameCount, pad to 2
 *   lines: { u16 name, u8 rank (0 street, 1 path / plaza), u8 vertCount, i16 x, z (dm from the tile
 *            origin) * vertCount } * lineCount   (named centerlines clipped to the tile + 2 m)
 */
export interface TerrainTile {
  tx: number;
  tz: number;
  n: number;
  cell: number;
  originX: number;
  originZ: number;
  heights: Float32Array; // n*n meters, row-major (z rows, x cols)
  obstN: number;
  obst: Float32Array; // obstN*obstN meters
  trees: Array<{ x: number; y: number; z: number; size: number; kind: number }>;
  classN: number;
  cls: Uint8Array; // classN*classN
  /** 'SBT2': street names of the tile and their centerlines (absolute x, z pairs); the 8x8 hood grid. */
  streetNames: string[];
  streets: Array<{ name: number; rank: number; xz: Float32Array }>;
  hoodGrid: Uint8Array | null;
}

export function parseTerrainTile(buf: ArrayBuffer, classN: number): TerrainTile {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SBT1' && magic !== 'SBT2') throw new Error('bad terrain tile');
  const tx = dv.getInt32(4, true);
  const tz = dv.getInt32(8, true);
  const n = dv.getUint16(12, true);
  const obstN = dv.getUint16(14, true);
  const cell = dv.getFloat32(16, true);
  const originX = dv.getFloat32(20, true);
  const originZ = dv.getFloat32(24, true);
  let o = 28;
  const hq = new Int16Array(buf.slice(o, o + n * n * 2));
  o += n * n * 2;
  o += n * n; // coarse classes (unused on the client; the 2 m texture is used)
  o += (4 - (o % 4)) % 4;
  const oq = new Int16Array(buf.slice(o, o + obstN * obstN * 2));
  o += obstN * obstN * 2;
  const treeCount = dv.getUint16(o, true);
  o += 4;
  const trees: TerrainTile['trees'] = [];
  for (let i = 0; i < treeCount; i++) {
    const x = originX + dv.getInt16(o, true) / 10;
    const z = originZ + dv.getInt16(o + 2, true) / 10;
    const y = dv.getInt16(o + 4, true) / 10;
    const size = dv.getUint8(o + 6) / 100;
    const kind = dv.getUint8(o + 7);
    trees.push({ x, y, z, size, kind });
    o += 8;
  }
  o += (4 - (o % 4)) % 4;
  const cls = new Uint8Array(buf, o, classN * classN).slice();
  o += classN * classN;
  const streetNames: string[] = [];
  const streets: TerrainTile['streets'] = [];
  let hoodGrid: Uint8Array | null = null;
  if (magic === 'SBT2') {
    o += (4 - (o % 4)) % 4;
    hoodGrid = new Uint8Array(buf, o, 64).slice();
    o += 64;
    const nn = dv.getUint16(o, true);
    const nl = dv.getUint16(o + 2, true);
    o += 4;
    const dec = new TextDecoder();
    for (let i = 0; i < nn; i++) {
      const len = dv.getUint8(o);
      streetNames.push(dec.decode(new Uint8Array(buf, o + 1, len)));
      o += 1 + len;
    }
    o += o % 2;
    for (let i = 0; i < nl; i++) {
      const name = dv.getUint16(o, true);
      const rank = dv.getUint8(o + 2);
      const nv = dv.getUint8(o + 3);
      o += 4;
      const xz = new Float32Array(nv * 2);
      for (let k = 0; k < nv; k++) {
        xz[k * 2] = originX + dv.getInt16(o, true) / 10;
        xz[k * 2 + 1] = originZ + dv.getInt16(o + 2, true) / 10;
        o += 4;
      }
      streets.push({ name, rank, xz });
    }
  }
  const heights = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) heights[i] = hq[i] / 10;
  const obst = new Float32Array(obstN * obstN);
  for (let i = 0; i < obstN * obstN; i++) obst[i] = oq[i] / 10;
  return { tx, tz, n, cell, originX, originZ, heights, obstN, obst, trees, classN, cls, streetNames, streets, hoodGrid };
}

/**
 * 'SBF1' far LOD:
 *   header: magic[4] u32 nBuildings, u32 gridW, u32 gridH, f32 minX, f32 minZ, f32 cell (28 bytes)
 *   f32 boxes[n*7] (cx, cz, halfW, halfD, yaw, baseY, roofY), u32 index[n],
 *   i16 h[gridW*gridH] (dm), u8 cls[gridW*gridH]
 */
export interface FarData {
  boxes: Float32Array;
  index: Uint32Array;
  gridW: number;
  gridH: number;
  minX: number;
  minZ: number;
  cell: number;
  heights: Float32Array;
  cls: Uint8Array;
}

export function parseFar(buf: ArrayBuffer): FarData {
  const dv = new DataView(buf);
  const n = dv.getUint32(4, true);
  const gridW = dv.getUint32(8, true);
  const gridH = dv.getUint32(12, true);
  const minX = dv.getFloat32(16, true);
  const minZ = dv.getFloat32(20, true);
  const cell = dv.getFloat32(24, true);
  let o = 28;
  const boxes = new Float32Array(buf.slice(o, o + n * 28));
  o += n * 28;
  const index = new Uint32Array(buf.slice(o, o + n * 4));
  o += n * 4;
  const hq = new Int16Array(buf.slice(o, o + gridW * gridH * 2));
  o += gridW * gridH * 2;
  const cls = new Uint8Array(buf, o, gridW * gridH).slice();
  const heights = new Float32Array(gridW * gridH);
  for (let i = 0; i < heights.length; i++) heights[i] = hq[i] / 10;
  return { boxes, index, gridW, gridH, minX, minZ, cell, heights, cls };
}
