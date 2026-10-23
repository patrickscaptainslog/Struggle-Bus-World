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

export const Ground = { PAVED: 0, GRASS: 1, WATER: 2, SIDEWALK: 3 } as const;

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
}

/**
 * 'SBB1' building tile:
 *   header: magic[4] u32 count, u32 vertCount, f32 originX, f32 originZ, u32 reserved
 *   u32 index[count], u32 stableId[count], u32 vertStart[count+1],
 *   f32 baseY[count], f32 roofY[count],
 *   u8 arch[count], u8 floors[count], u8 front[count], u8 front2[count], u8 hood[count], u8 seed[count], pad to 4,
 *   i16 vx[vertCount], i16 vz[vertCount]   (decimeters relative to origin; rings CCW in (x, z))
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
  arch: Uint8Array;
  floors: Uint8Array;
  front: Uint8Array;
  front2: Uint8Array;
  hood: Uint8Array;
  seed: Uint8Array;
  /** Absolute world coords, interleaved per building ring: x0,z0,x1,z1... indexed by vertStart*2. */
  xz: Float32Array;
}

export function parseBuildingTile(buf: ArrayBuffer): BuildingTile {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SBB1') throw new Error('bad building tile');
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
  const arch = u8(count);
  const floors = u8(count);
  const front = u8(count);
  const front2 = u8(count);
  const hood = u8(count);
  const seed = u8(count);
  o += (4 - ((count * 6) % 4)) % 4;
  const vx = new Int16Array(buf.slice(o, o + vertCount * 2));
  o += vertCount * 2;
  const vz = new Int16Array(buf.slice(o, o + vertCount * 2));
  const xz = new Float32Array(vertCount * 2);
  for (let i = 0; i < vertCount; i++) {
    xz[i * 2] = originX + vx[i] / 10;
    xz[i * 2 + 1] = originZ + vz[i] / 10;
  }
  return { count, originX, originZ, index, stableId, vertStart, baseY, roofY, arch, floors, front, front2, hood, seed, xz };
}

/**
 * 'SBT1' terrain tile:
 *   header: magic[4] i32 tx, i32 tz, u16 n, u16 obstN, f32 cell, f32 originX, f32 originZ   (28 bytes)
 *   i16 h[n*n] (decimeters), u8 cls[n*n], pad to 4,
 *   i16 obst[obstN*obstN] (decimeters; max of roofs (+3 m buffer) and ground per 8 m cell)
 *   u16 treeCount, u16 pad, trees: { i16 x, i16 z, i16 y (dm), u8 size*100, u8 kind } * treeCount, pad to 4,
 *   u8 class[classN*classN] (2 m ground class texture, texel centers)
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
}

export function parseTerrainTile(buf: ArrayBuffer, classN: number): TerrainTile {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SBT1') throw new Error('bad terrain tile');
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
  const heights = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) heights[i] = hq[i] / 10;
  const obst = new Float32Array(obstN * obstN);
  for (let i = 0; i < obstN * obstN; i++) obst[i] = oq[i] / 10;
  return { tx, tz, n, cell, originX, originZ, heights, obstN, obst, trees, classN, cls };
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
