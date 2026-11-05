import { ROW } from './kinds';
import { scriptedPlanes } from './sim/planes';
import vectors from './checkVectors.json';

// L1's WebKit leg (CONTRACT.md section 7, Agreed 0.5): life-check.html, which the producer opens on the iPhone. The scripted sky at each vector's place and moment,
// worked out in this engine, held to V8's (tools/life/vectors.mjs) within 1 cm a position and 0.1 mm/s a velocity; then 3,600 steps of a second against one jump of an
// hour. It says on the screen whether it matches. window.__lifeCheck is the verdict for tools/life/check.mjs.

const POS = 0.01, VEL = 1e-4;
const log = document.getElementById('log')!, verdict = document.getElementById('verdict')!;
const say = (s: string) => (log.textContent += s + '\n');
const out = new Float32Array(4096 * ROW), u32 = new Uint32Array(out.buffer);
let worst = 0, bad = 0;
for (const v of vectors.vectors) {
  const n = scriptedPlanes(v.place, v.utcMs, v.bx, v.bz, 60000, out, 0, 4096);
  let miss = n === v.rows.length ? 0 : Infinity;
  for (let i = 0; i < Math.min(n, v.rows.length); i++) {
    const r = v.rows[i], o = i * ROW;
    if (u32[o] !== r[0]) miss = Infinity;
    for (let c = 0; c < 7; c++) {
      const d = Math.abs(out[o + 2 + c] - r[1 + c]) / (c < 3 ? POS : c < 6 ? VEL : 1e-6);
      miss = Math.max(miss, d);
    }
  }
  worst = Math.max(worst, miss);
  if (miss > 1) bad++;
  say(`${miss <= 1 ? 'ok  ' : 'DIFF'} ${v.place} ${new Date(v.utcMs).toISOString().slice(0, 19)} ${n} planes${miss > 1 ? ` (${miss === Infinity ? 'not the same planes' : `${miss.toFixed(1)} x the bar`})` : ''}`);
}
// (a plane's place is a function of the clock, never a sum of steps: 3,600 seconds stepped end where one hour's jump does)
const t0 = vectors.vectors[0].utcMs, a = new Float32Array(4096 * ROW);
let last = 0;
for (let k = 1; k <= 3600; k++) last = scriptedPlanes('sf', t0 + k * 1000, 0, 0, 60000, a, 0, 4096);
const jump = scriptedPlanes('sf', t0 + 3600000, 0, 0, 60000, out, 0, 4096);
let steps = last === jump;
for (let i = 0; steps && i < jump * ROW; i++) if (a[i] !== out[i] && !(Number.isNaN(a[i]) && Number.isNaN(out[i]))) steps = false;
if (!steps) bad++;
say(`${steps ? 'ok  ' : 'DIFF'} 3,600 steps of a second end where an hour's jump does`);
const ok = bad === 0;
verdict.className = ok ? 'ok' : 'no';
verdict.textContent = ok ? `MATCHES ${vectors.engine} WITHIN 1 CM` : `DIFFERS FROM ${vectors.engine}: ${bad} OF ${vectors.vectors.length + 1}`;
say(`\nthis browser: ${navigator.userAgent}\nvectors made ${vectors.made}, worst ${worst === Infinity ? 'not the same planes' : `${(worst * 100).toFixed(1)} % of the bar`}`);
(window as unknown as { __lifeCheck: unknown }).__lifeCheck = { ok, bad, worst };
