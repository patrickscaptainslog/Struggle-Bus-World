// The far city as boxes, built on the device from the far raster (tools/bake/farmap.py): the wire carries an image, the boxes are what a
// phone makes of it. Equal runs of roof cells merge row by row; no box crosses a 256 m tile, so a tile that loads hides exactly what it
// replaces (uMask), and no box crosses a chunk, which is one draw and lines up with a region: a loaded region's chunk isn't drawn at all. Only
// a roof cell makes a box (a footprint over half of it): less than that a building is tone on the far ground, which conserves area, so nothing
// is lost by the gate. No three.js here: this runs in a worker.

/** The far raster's ROOF class (tools/bake/farmap.py). */
export const FAR_ROOF = 11;

export interface FarBlocksRequest {
  W: number;
  H: number;
  /** world x, z of cell (i, j)'s corner: x = a * i + c, z = e * j + f */
  a: number;
  c: number;
  e: number;
  f: number;
  /** cells to a tile edge, tiles to a chunk edge (chunks sit on the world's grid of them, like regions) */
  tileCells: number;
  chunkTiles: number;
  /** a top in steps of this (m): equal tops merge */
  topStep: number;
  /** a stable number per city: which faces light up at night */
  seed: number;
  cls: Uint8Array;
  /** building top above ground, 2 m a step */
  height: Uint8Array;
  tone: Uint8Array;
  wallTone: Uint8Array;
  /** true ground (far.bin's grid) */
  ground: Float32Array;
  groundW: number;
  groundH: number;
  groundX: number;
  groundZ: number;
  groundCell: number;
  /** far.bin's tall boxes, 7 floats each: they keep their own true outlines, so the cells under them make no box */
  towers: Float32Array;
  towerCount: number;
}

/** One chunk's boxes, one draw: per box 4 u16 (i, j, w, h in cells), 2 i16 (base, top in half metres), 4 u8 (roof tone, wall tone, lit faces, wake). */
export interface FarBlockChunk {
  /** in chunks from the world's origin */
  ci: number;
  cj: number;
  count: number;
  cell: Uint16Array;
  y: Int16Array;
  tone: Uint8Array;
  /** its bounds: center x, y, z, radius */
  sphere: Float32Array;
}

export interface FarBlocksResult {
  chunks: FarBlockChunk[];
  boxes: number;
  /** roof cells that went in */
  cells: number;
  ms: number;
}

/** Sunk under the lowest ground of a box: the far mesh is 64 m, so true ground can stand a few metres off it. */
const SKIRT = 8;

function hash32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export function mergeFarBlocks(r: FarBlocksRequest): FarBlocksResult {
  const t0 = performance.now();
  const { W, H, a, c, e, f, tileCells: tc, chunkTiles, topStep } = r;
  const gw = r.groundW, gh = r.groundH, gc = r.groundCell;
  // cells under a tall box are its own
  const theirs = new Uint8Array(W * H);
  for (let k = 0; k < r.towerCount; k++) {
    const o = k * 7;
    const cx = r.towers[o], cz = r.towers[o + 1], hw = r.towers[o + 2], hd = r.towers[o + 3], yaw = r.towers[o + 4];
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const rad = Math.hypot(hw, hd);
    const i0 = Math.max(0, Math.floor((cx - rad - c) / a)), i1 = Math.min(W - 1, Math.ceil((cx + rad - c) / a));
    const j0 = Math.max(0, Math.floor((cz - rad - f) / e)), j1 = Math.min(H - 1, Math.ceil((cz + rad - f) / e));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = a * (i + 0.5) + c - cx, dz = e * (j + 0.5) + f - cz;
        if (Math.abs(dx * co + dz * si) <= hw + a * 0.5 && Math.abs(-dx * si + dz * co) <= hd + e * 0.5) theirs[j * W + i] = 1;
      }
  }
  // what merges: a cell's top, in steps, over sea level, so a box never lies on a hillside; 0 no box
  const key = new Int32Array(W * H);
  const lowest = new Float32Array(W * H);
  let cells = 0;
  for (let j = 0; j < H; j++) {
    const z = e * (j + 0.5) + f;
    const gz = Math.min(gh - 1.001, Math.max(0, (z - r.groundZ) / gc));
    const gj = Math.floor(gz), tz = gz - gj;
    for (let i = 0; i < W; i++) {
      const q = j * W + i;
      if (r.cls[q] !== FAR_ROOF || r.height[q] === 0 || theirs[q]) continue;
      const gx = Math.min(gw - 1.001, Math.max(0, (a * (i + 0.5) + c - r.groundX) / gc));
      const gi = Math.floor(gx), tx = gx - gi;
      const h00 = r.ground[gj * gw + gi], h10 = r.ground[gj * gw + gi + 1], h01 = r.ground[(gj + 1) * gw + gi], h11 = r.ground[(gj + 1) * gw + gi + 1];
      const g = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
      key[q] = Math.round((g + r.height[q] * 2) / topStep) + 8192;
      lowest[q] = g;
      cells++;
    }
  }
  // equal runs, row by row: an open box stays open while the next row has the same run under it
  const maxBoxes = cells;
  const outCell = new Uint16Array(maxBoxes * 4);
  const outY = new Int16Array(maxBoxes * 2);
  const outTone = new Uint8Array(maxBoxes * 4);
  const openW = new Int32Array(W), openKey = new Int32Array(W), openJ = new Int32Array(W), openSeen = new Int32Array(W);
  const sumTone = new Float64Array(W), sumWall = new Float64Array(W), low = new Float32Array(W);
  let boxes = 0;
  const close = (i: number, jEnd: number) => {
    const b = boxes++;
    const w = openW[i], j0 = openJ[i], h = jEnd - j0, n = w * h;
    outCell[b * 4] = i;
    outCell[b * 4 + 1] = j0;
    outCell[b * 4 + 2] = w;
    outCell[b * 4 + 3] = h;
    outY[b * 2] = Math.round((low[i] - SKIRT) * 2);
    outY[b * 2 + 1] = Math.round((openKey[i] - 8192) * topStep * 2);
    outTone[b * 4] = Math.round(sumTone[i] / n);
    outTone[b * 4 + 1] = Math.round(sumWall[i] / n);
    openW[i] = 0;
  };
  for (let j = 0; j < H; j++) {
    // (rows too end at a tile edge)
    if (j % tc === 0) for (let i = 0; i < W; i++) if (openW[i]) close(i, j);
    let i = 0;
    while (i < W) {
      const k = key[j * W + i];
      if (k === 0) {
        i++;
        continue;
      }
      const i0 = i;
      const end = Math.min(W, (Math.floor(i / tc) + 1) * tc);
      let st = 0, sw = 0, lo = Infinity;
      while (i < end && key[j * W + i] === k) {
        st += r.tone[j * W + i];
        sw += r.wallTone[j * W + i];
        lo = Math.min(lo, lowest[j * W + i]);
        i++;
      }
      const w = i - i0;
      if (openW[i0] === w && openKey[i0] === k) {
        sumTone[i0] += st;
        sumWall[i0] += sw;
        low[i0] = Math.min(low[i0], lo);
      } else {
        if (openW[i0]) close(i0, j);
        openW[i0] = w;
        openKey[i0] = k;
        openJ[i0] = j;
        sumTone[i0] = st;
        sumWall[i0] = sw;
        low[i0] = lo;
      }
      openSeen[i0] = j + 1;
    }
    // (what this row didn't carry on)
    for (let q = 0; q < W; q++) if (openW[q] && openSeen[q] !== j + 1) close(q, j);
  }
  for (let i = 0; i < W; i++) if (openW[i]) close(i, H);

  // into chunks: every box is inside one, it is inside one tile. (The raster's corner is on the tile grid, as the mask's is.)
  const cc = tc * chunkTiles;
  const ox = Math.round(c / a), oz = Math.round(f / e);
  const ci0 = Math.floor(ox / cc), cj0 = Math.floor(oz / cc);
  const cw = Math.floor((ox + W - 1) / cc) - ci0 + 1, ch = Math.floor((oz + H - 1) / cc) - cj0 + 1;
  const slotOf = (i: number, j: number) => (Math.floor((oz + j) / cc) - cj0) * cw + Math.floor((ox + i) / cc) - ci0;
  const counts = new Int32Array(cw * ch);
  for (let b = 0; b < boxes; b++) counts[slotOf(outCell[b * 4], outCell[b * 4 + 1])]++;
  const chunks: FarBlockChunk[] = [];
  const slots: Array<FarBlockChunk | null> = [];
  for (let q = 0; q < cw * ch; q++) {
    const n = counts[q];
    if (!n) {
      slots.push(null);
      continue;
    }
    const ch1: FarBlockChunk = { ci: ci0 + q % cw, cj: cj0 + Math.floor(q / cw), count: 0, cell: new Uint16Array(n * 4), y: new Int16Array(n * 2), tone: new Uint8Array(n * 4), sphere: new Float32Array(4) };
    slots.push(ch1);
    chunks.push(ch1);
  }
  const seeds = new Uint32Array(cw * ch);
  for (let q = 0; q < cw * ch; q++) seeds[q] = hash32(q + 1 + Math.imul(r.seed, 0x9e3779b1));
  const y0 = new Float32Array(cw * ch).fill(Infinity), y1 = new Float32Array(cw * ch).fill(-Infinity);
  for (let b = 0; b < boxes; b++) {
    const i = outCell[b * 4], j = outCell[b * 4 + 1];
    const q = slotOf(i, j);
    const s = slots[q]!;
    const k = s.count++;
    s.cell.set(outCell.subarray(b * 4, b * 4 + 4), k * 4);
    s.y[k * 2] = outY[b * 2];
    s.y[k * 2 + 1] = outY[b * 2 + 1];
    // at night: which of its four walls light up (each one in two), and when (the wave's byte). A hash of where it stands: stable across bakes
    const h = hash32((i | (j << 16)) ^ seeds[q]);
    s.tone[k * 4] = outTone[b * 4];
    s.tone[k * 4 + 1] = outTone[b * 4 + 1];
    s.tone[k * 4 + 2] = h & 15;
    s.tone[k * 4 + 3] = (h >>> 8) & 255;
    y0[q] = Math.min(y0[q], outY[b * 2] / 2);
    y1[q] = Math.max(y1[q], outY[b * 2 + 1] / 2);
  }
  for (const s of chunks) {
    const q = (s.cj - cj0) * cw + s.ci - ci0;
    const xa = a * s.ci * cc, xb = a * (s.ci + 1) * cc;
    const za = e * s.cj * cc, zb = e * (s.cj + 1) * cc;
    const mx = (xa + xb) / 2, mz = (za + zb) / 2, my = (y0[q] + y1[q]) / 2;
    s.sphere.set([mx, my, mz, Math.hypot(xb - mx, zb - mz, y1[q] - my)]);
  }
  return { chunks, boxes, cells, ms: performance.now() - t0 };
}
