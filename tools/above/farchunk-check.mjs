#!/usr/bin/env node
// The far boxes in chunks of 8 tiles (src/world/farBlocks.ts), in Node, no browser: node --no-warnings tools/above/farchunk-check.mjs [--ref=<farBlocks.ts>] [--src=<farBlocks.ts>]
// On made-up rasters (roof cells at random, the raster's corner off the chunk grid by a few tiles either way), chunks of 4 and of 8 must make
// the same boxes with the same bytes (cell, base and top, roof and wall tone, lit faces and grey, wake): a chunk groups boxes, it never changes
// one. With --ref (another farBlocks.ts, e.g. one before this change), its chunks of 4 must make the same boxes too. --src tests another
// farBlocks.ts in place of the repo's (its proof: one that seeds by the chunk drawn must fail). Exit 1 if any differs.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const srcArg = process.argv.find((a) => a.startsWith('--src='));
const { mergeFarBlocks, FAR_ROOF } = await import(pathToFileURL(srcArg ? path.resolve(srcArg.slice(6)) : path.join(here, '../../src/world/farBlocks.ts')).href);
const refArg = process.argv.find((a) => a.startsWith('--ref='));
const ref = refArg ? (await import(pathToFileURL(path.resolve(refArg.slice(6))).href)).mergeFarBlocks : null;

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);

function raster(tc, tilesW, tilesH, offTx, offTz) {
  const W = tc * tilesW, H = tc * tilesH, cell = 256 / tc;
  const cls = new Uint8Array(W * H), height = new Uint8Array(W * H), tone = new Uint8Array(W * H), wallTone = new Uint8Array(W * H);
  for (let q = 0; q < W * H; q++) {
    if (rnd() < 0.45) continue;
    cls[q] = FAR_ROOF;
    // (runs of equal tops, so boxes merge across cells)
    height[q] = q % W > 0 && rnd() < 0.6 ? height[q - 1] || 1 + Math.floor(rnd() * 40) : 1 + Math.floor(rnd() * 40);
    tone[q] = Math.floor(rnd() * 256);
    wallTone[q] = Math.floor(rnd() * 256);
  }
  const gw = 20, gh = 20;
  const ground = new Float32Array(gw * gh).map(() => rnd() * 30);
  return {
    W, H, a: cell, c: offTx * 256, e: cell, f: offTz * 256, tileCells: tc, chunkTiles: 4, topStep: 4, seed: 37775122,
    cls, height, tone, wallTone, ground, groundW: gw, groundH: gh, groundX: offTx * 256, groundZ: offTz * 256, groundCell: (tilesW * 256) / (gw - 1),
    towers: new Float32Array([offTx * 256 + 300, offTz * 256 + 300, 20, 30, 0.4, 0, 0]), towerCount: 1,
  };
}

/** Every box as a string of its bytes, keyed by its cell (no two boxes share a corner). */
function boxes(res) {
  const m = new Map();
  for (const s of res.chunks)
    for (let k = 0; k < s.count; k++) {
      const c = s.cell.subarray(k * 4, k * 4 + 4);
      m.set(`${c[0]},${c[1]}`, `${[...c]}|${s.y[k * 2]},${s.y[k * 2 + 1]}|${[...s.tone.subarray(k * 4, k * 4 + 4)]}`);
    }
  return m;
}
function same(a, b) {
  let bad = 0;
  if (a.size !== b.size) bad++;
  for (const [k, v] of a) if (b.get(k) !== v) bad++;
  return bad;
}

let fails = 0;
const cases = [
  [8, 12, 10, 0, 0],
  [8, 13, 11, -3, 5],
  [16, 9, 17, 6, -7],
  [4, 21, 19, -13, -2],
];
for (const [tc, tw, th, ox, oz] of cases) {
  const r = raster(tc, tw, th, ox, oz);
  const r4 = mergeFarBlocks({ ...r, chunkTiles: 4 });
  const r8 = mergeFarBlocks({ ...r, chunkTiles: 8 });
  const b4 = boxes(r4), b8 = boxes(r8);
  const d = same(b4, b8);
  let line = `raster ${tc} cells a tile, ${tw} x ${th} tiles, corner at tile (${ox}, ${oz}): ${r4.boxes} boxes; chunks of 4: ${r4.chunks.length}, of 8: ${r8.chunks.length}; boxes differing 8 vs 4: ${d}`;
  if (d) fails++;
  if (ref) {
    const dr = same(boxes(ref({ ...r, chunkTiles: 4 })), b8);
    line += `; differing 8 vs the reference's 4: ${dr}`;
    if (dr) fails++;
  }
  // (every chunk of 8 holds boxes on its own 8 x 8 tiles only)
  for (const s of r8.chunks)
    for (let k = 0; k < s.count; k++) {
      const ti = Math.floor((s.cell[k * 4] + ox * tc) / (tc * 8)), tj = Math.floor((s.cell[k * 4 + 1] + oz * tc) / (tc * 8));
      if (ti !== s.ci || tj !== s.cj) {
        fails++;
        line += `; a box outside its chunk (${s.ci}, ${s.cj})`;
        break;
      }
    }
  console.log(line);
}
console.log(fails ? `FARCHUNK FAILED: ${fails}` : 'farchunk: every box the same in chunks of 4 and 8');
process.exit(fails ? 1 : 0);
