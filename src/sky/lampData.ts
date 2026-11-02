// The street lamps' list, off the main thread (SKY.md 4.4). lamps.bin (tools/bake/lamps.py, keep in sync) holds where they stand on a 2 m grid and no heights: those
// come from far.bin's grid here, 0 bytes on the wire, within 4 m on 94 % of SF's lamps. No three.js: this runs in a worker. Lamps sit sorted by tile, so a tile's pools
// stamp from its own short run of the list.

export interface LampRequest {
  url: string;
  /** far.bin's ground grid: heights at x = minX + i * cell, z = minZ + j * cell, as the far mesh stands on it */
  ground: Float32Array;
  gridW: number;
  gridH: number;
  minX: number;
  minZ: number;
  cell: number;
  tileSize: number;
  /** a lamp's head over the ground (m) */
  head: number;
}

export interface LampResult {
  /** 4 i16 a lamp: x, y, z, 0, sorted by tile; x and z in 2 m steps (LAMP_XZ), y in quarter metres (LAMP_Y) */
  pos: Int16Array;
  count: number;
  /** the tiles that hold a lamp, by tileKey, ascending; `starts[i]` is the first lamp of `keys[i]`, with one entry more at the end */
  keys: Int32Array;
  starts: Int32Array;
  ms: number;
}

/** The list's units, for the shader and the pools. */
export const LAMP_XZ = 2;
export const LAMP_Y = 0.25;

/** A tile's key in the sorted list (City's tileKeyNum). */
export const tileKey = (tx: number, tz: number) => (tx + 4096) * 8192 + (tz + 4096);

/** The decoded list, or null: not a lamp file (a dev server's page stands in for a city without one). */
export function readLamps(buf: ArrayBuffer, r: Omit<LampRequest, 'url'>): LampResult | null {
  const t0 = performance.now();
  if (buf.byteLength < 16) return null;
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'SBL1') return null;
  const chunks = dv.getUint32(4, true), grid = dv.getFloat32(8, true), size = dv.getFloat32(12, true);
  let count = 0;
  for (let c = 0; c < chunks; c++) count += dv.getUint32(16 + c * 8 + 4, true);
  const x = new Float32Array(count), z = new Float32Array(count);
  let o = 16 + chunks * 8, k = 0;
  for (let c = 0; c < chunks; c++) {
    const ci = dv.getInt16(16 + c * 8, true), cj = dv.getInt16(16 + c * 8 + 2, true), n = dv.getUint32(16 + c * 8 + 4, true);
    let v = 0;
    for (let i = 0; i < n; i++, o += 2) x[k + i] = ci * size + (v = (v + dv.getUint16(o, true)) & 0xffff) * grid;
    v = 0;
    for (let i = 0; i < n; i++, o += 2) z[k + i] = cj * size + (v = (v + dv.getUint16(o, true)) & 0xffff) * grid;
    k += n;
  }
  const keys = new Int32Array(count);
  for (let i = 0; i < count; i++) keys[i] = tileKey(Math.floor(x[i] / r.tileSize), Math.floor(z[i] / r.tileSize));
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => keys[a] - keys[b] || a - b);
  const pos = new Int16Array(count * 4);
  const outKeys: number[] = [], starts: number[] = [];
  const W = r.gridW, H = r.gridH;
  for (let n = 0; n < count; n++) {
    const i = order[n];
    if (!n || keys[i] !== outKeys[outKeys.length - 1]) {
      outKeys.push(keys[i]);
      starts.push(n);
    }
    const gx = Math.min(W - 1.001, Math.max(0, (x[i] - r.minX) / r.cell)), gz = Math.min(H - 1.001, Math.max(0, (z[i] - r.minZ) / r.cell));
    const a = Math.floor(gx), b = Math.floor(gz), tx = gx - a, tz = gz - b;
    const h = (r.ground[b * W + a] * (1 - tx) + r.ground[b * W + a + 1] * tx) * (1 - tz) + (r.ground[(b + 1) * W + a] * (1 - tx) + r.ground[(b + 1) * W + a + 1] * tx) * tz;
    pos[n * 4] = Math.round(x[i] / LAMP_XZ);
    pos[n * 4 + 1] = Math.round((Math.max(h, 0) + r.head) / LAMP_Y);
    pos[n * 4 + 2] = Math.round(z[i] / LAMP_XZ);
  }
  starts.push(count);
  return { pos, count, keys: Int32Array.from(outKeys), starts: Int32Array.from(starts), ms: performance.now() - t0 };
}
