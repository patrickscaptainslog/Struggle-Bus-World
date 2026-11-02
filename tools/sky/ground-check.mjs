#!/usr/bin/env node
// The Moon's two maps, under Node: node --no-warnings tools/sky/ground-check.mjs
// The ground map's second mip is the tone map to within a rounding, so a far disc reads what it always read; the slope is the relief's; the tile has no mean slope and wraps; and how long a worker has to think about it all.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { GROUND_H, GROUND_W, craterTile, groundMap } = await import('../../src/sky/MoonGround.ts');
const { SLOPE_MAX, TILE } = await import('../../src/sky/groundSize.ts');
const { readRelief } = await import('../../src/moon/map.ts');

const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const inflate = (b) => (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b);
const relief = readRelief(ab(inflate(readFileSync('public/moon/relief.bin'))));
const moon = inflate(readFileSync('public/sky/moon.bin'));
const dv = new DataView(ab(moon)), w = dv.getUint16(0, true), h = dv.getUint16(2, true);
const tone = Uint8Array.from(moon.subarray(4, 4 + w * h), (v) => Math.round(v * 36.43));
let t0 = performance.now();
const map = groundMap(relief, tone, w, h);
const t1 = performance.now();
const tile = craterTile();
const t2 = performance.now();
console.log(`groundMap ${Math.round(t1 - t0)} ms, ${(map.length / 1e6).toFixed(1)} MB; craterTile ${Math.round(t2 - t1)} ms, ${(tile.length / 1e6).toFixed(2)} MB`);

let worst = 0, n = 0, bad = 0;
for (let j = 0; j < h; j++)
  for (let i = 0; i < w; i++) {
    const y = j * 2, x = i * 2, m = (map[(y * GROUND_W + x) * 4] + map[(y * GROUND_W + x + 1) * 4] + map[((y + 1) * GROUND_W + x) * 4] + map[((y + 1) * GROUND_W + x + 1) * 4]) / 4;
    const d = Math.abs(m - tone[j * w + i]);
    if (d > worst) worst = d;
    if (d > 1) n++;
  }
console.log(`the second mip against the tone map: worst ${worst}, ${n} of ${w * h} over 1`);
if (worst > 40) bad++;

// the slope at the equator, read back, against the relief's own central difference, the same place
const S = SLOPE_MAX / 127, R = 1737400;
let sum = 0, cnt = 0;
for (let k = 0; k < 2000; k++) {
  const i = (k * 7) % GROUND_W, j = GROUND_H / 2;
  const q = (j * GROUND_W + i) * 4, lon = ((i + 0.5) / GROUND_W - 0.5) * 2 * Math.PI;
  const x = (map[q + 1] - 128) * S, y = (map[q + 2] - 128) * S;
  // east here, by the map: at the equator e = (-sin, cos, 0), and dn = -ge e
  const ge = x * Math.sin(lon) - y * Math.cos(lon);
  const fi = ((lon / (2 * Math.PI) + 0.5) * relief.w - 0.5), a = Math.floor(fi), row = (relief.h >> 1) * relief.w;
  const real = (relief.data[row + ((a + 2) % relief.w)] - relief.data[row + ((a - 1 + relief.w) % relief.w)]) / ((3 * 2 * Math.PI * R) / relief.w);
  sum += ge * real;
  cnt += real * real;
}
console.log(`the map's east slope against the relief's, the equator: ${(sum / cnt).toFixed(2)} (1 is the same)`);
if (Math.abs(sum / cnt - 1) > 0.25) bad++;

let mx = 0, my = 0, ml = 0;
for (let i = 0; i < tile.length; i += 4) {
  mx += tile[i] - 128;
  my += tile[i + 1] - 128;
  ml += tile[i + 2] - 128;
}
mx /= TILE * TILE;
my /= TILE * TILE;
ml /= TILE * TILE;
let edge = 0, inner = 0;
for (let i = 0; i < TILE; i++) {
  edge += Math.abs(tile[(TILE - 1) * TILE * 4 + i * 4] - tile[i * 4]);
  inner += Math.abs(tile[(TILE >> 1) * TILE * 4 + i * 4] - tile[((TILE >> 1) + 1) * TILE * 4 + i * 4]);
}
console.log(`the tile's mean slope ${mx.toFixed(2)}, ${my.toFixed(2)} and brightness ${ml.toFixed(1)}, of 128. Over its seam a texel differs by ${(edge / TILE).toFixed(1)}, inside it by ${(inner / TILE).toFixed(1)}`);
if (Math.abs(mx) > 1 || Math.abs(my) > 1 || edge > inner * 1.3) bad++;
console.log(bad ? `${bad} BAD` : 'all fine');
process.exit(bad ? 1 : 0);
