// No byte of the live tables is brown or taupe at any height of the Sun (docs/reviews/main-live-2026-11-05.md, m3): the real TableBlend from 80 to -20 degrees by 0.01,
// setting and rising, and by 0.05 at the setting shares between (noon and midnight), every row it writes, rounded to the bytes the palette holds, through skycheck's
// own test (tools/sky/oklch.mjs). Paint on and off. Then the gate on its own, whatever the tables: every swatch of a grid round its lines comes out of it with bytes
// that test passes (gatedBytes, fix/live's review: its second write wasn't tested again). No browser: node tools/sky/run.mjs brown.ts. Exit 1 on any brown byte.
import { isBrown, lch } from './oklch.mjs';
import { Ramp, RAMP_COUNT, RAMP_STEPS } from '@src/render/palette';
import { gatedBytes, TableBlend } from '@src/sky/SkyTable';

const NAME = Object.fromEntries(Object.entries(Ramp).map(([k, v]) => [v, k]));
const T = new TableBlend();
const data = new Uint8Array(RAMP_COUNT * RAMP_STEPS * 4);
/** every brown swatch: (row, step) -> how often, the heights it was brown at, and one of its colours */
const found = new Map<number, { n: number; lo: number; hi: number; w: Set<string>; c: number }>();
let tables = 0;

const sweep = (w: number, n: number, paint: boolean) => {
  for (let k = 0; k <= 100 * n; k++) {
    const h = (80 * n - k) / n;
    T.place(h, w);
    T.write(data, paint);
    tables++;
    for (let r = 0; r < RAMP_COUNT; r++)
      for (let s = 0; s < RAMP_STEPS; s++) {
        const i = (r * RAMP_STEPS + s) * 4, c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        if (!isBrown(c)) continue;
        const key = r * RAMP_STEPS + s;
        const f = found.get(key) ?? { n: 0, lo: Infinity, hi: -Infinity, w: new Set<string>(), c };
        f.n++;
        f.lo = Math.min(f.lo, h);
        f.hi = Math.max(f.hi, h);
        f.w.add(w === 1 ? 'setting' : w === 0 ? 'rising' : `share ${w}`);
        found.set(key, f);
      }
  }
};
for (const paint of [true, false]) {
  sweep(1, 100, paint);
  sweep(0, 100, paint);
  for (let k = 1; k < 10; k++) sweep(k / 10, 20, paint);
}

for (const [key, f] of found) {
  const [L, C, h] = lch(f.c);
  console.log(`FAIL  ${NAME[Math.floor(key / RAMP_STEPS)] ?? `row ${Math.floor(key / RAMP_STEPS)}`} ${key % RAMP_STEPS}: brown or taupe in ${f.n} tables, the Sun ${f.lo.toFixed(2)} to ${f.hi.toFixed(2)} degrees (${[...f.w].join(', ')}), e.g. #${f.c.toString(16).padStart(6, '0')} (L ${L.toFixed(3)}, C ${C.toFixed(3)}, hue ${h.toFixed(1)})`);
}
console.log(found.size ? `${found.size} swatches brown or taupe somewhere, of ${tables} tables` : `no byte brown or taupe in ${tables} tables, every row, 80 to -20 degrees, paint on and off`);

// ---- the gate on its own: L 0.02 to 0.76 by 0.002, C 0 to 0.12 by 0.002, hue 25 to 110 degrees by 0.5, its lines (35 and 100 degrees, 0.016, 0.6, 0.72) on the grid
let gateBad = 0;
{
  const px = new Uint8Array(4);
  let n = 0, eg = '';
  for (let l = 0; l <= 370; l++)
    for (let c = 0; c <= 60; c++)
      for (let k = 0; k <= 170; k++) {
        const L = 0.02 + l * 0.002, C = c * 0.002, hue = 25 + k * 0.5;
        gatedBytes(L, C, (hue * Math.PI) / 180, px, 0);
        n++;
        const col = (px[0] << 16) | (px[1] << 8) | px[2];
        if (!isBrown(col)) continue;
        if (!gateBad++) eg = `, e.g. L ${L.toFixed(3)}, C ${C.toFixed(3)}, hue ${hue} to #${col.toString(16).padStart(6, '0')}`;
      }
  console.log(`${gateBad ? 'FAIL' : 'pass'}  the gate on its own, ${n} swatches round its lines: ${gateBad ? `${gateBad} come out brown or taupe${eg}` : 'none comes out brown or taupe'}`);
}
process.exit(found.size || gateBad ? 1 : 0);
