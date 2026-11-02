#!/usr/bin/env node
// Paints in Node, no browser: node --no-warnings tools/sky/moon-paint-check.mjs
// src/sky/MoonPaint.ts is pure, so what must hold can be read off its bytes. A live flight and a rebuild from its strokes make the same map. Strokes survive, a blocked store changes nothing else, and a slice
// never runs far past its budget, anywhere on the Moon. Prints what the map costs.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { MoonPaint, PAINT_W, PAINT_H, TEXEL_KM, EDGE_KM, MAX_STROKES } = await import('../../src/sky/MoonPaint.ts');

let fails = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) fails++;
};
const memory = () => {
  const m = new Map();
  return { m, writes: 0, get(k) { return m.get(k) ?? null; }, set(k, v) { this.writes++; m.set(k, v); } };
};
const lap = (paint, job, settle = true) => {
  paint.work(job, Infinity);
  if (settle) paint.settle(job);
  return job;
};
const fly = (paint, list) => {
  for (const [lat, lon] of list) {
    lap(paint, paint.begin(paint.strike(lat, lon), true));
    paint.save();
  }
};
const rnd = ((s) => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)(7);

// ---- a flight, every level and the seam and both poles
const places = [[10, 20], [10.2, 20.1], [10.4, 20.2], [-5, 179.8], [-5, -179.9], [-5.1, 179.9], [85, 0], [85, 40], [85.1, 40], [-88, 100], [40, -60]];
for (let i = 0; i < 60; i++) places.push([rnd() * 170 - 85, rnd() * 360 - 180]);
const store = memory();
const a = new MoonPaint(store, 12345);
fly(a, places);
const levels = [0, 0, 0, 0];
for (const s of a.strokes) levels[s.level]++;
check(levels[2] > 0 && levels[3] > 0, `hits on paint level up: L1 ${levels[1]}, L2 ${levels[2]}, L3 ${levels[3]}`);
check(a.painted > 0 && a.painted < 1, `painted ${(a.painted * 100).toFixed(2)} % after ${a.strokes.length} strokes`);
const seen = a.mips[0].data;
let revealLeft = 0;
for (let o = 3; o < seen.length; o += 4) if (seen[o]) revealLeft++;
check(revealLeft === 0, 'settled: no texel still waits for a wave');
// (the shader adds these bits to the first paint ramp: a 6 or a 7 would be the bus's yellow or a sign's green)
let notHue = 0, levelsOk = true;
for (const m of a.mips) {
  for (let o = 0; o < m.data.length; o += 4) if ((m.data[o + 1] & 7) > 5 || (m.data[o + 2] & 7) > 5) notHue++;
}
for (let l = 1; l < a.mips.length; l++) {
  const d = a.mips[l].data;
  for (let o = 0; o < d.length; o += 4) if ((d[o + 1] & 7) !== (d[o + 2] & 7)) levelsOk = false;
}
check(notHue === 0, 'every texel of every level holds two hues');
check(levelsOk, 'a far level holds one hue a texel: no mix to read from up there');

// ---- the next flight finds it: the same bytes, built from the strokes alone
const b = new MoonPaint(store, 999);
check(b.load() === a.strokes.length, `the store gives back ${a.strokes.length} strokes (${[...store.m.values()].reduce((n, v) => n + v.length, 0)} chars in ${store.m.size} chunks, ${store.writes} writes)`);
for (let t = 0; b.rebuild(1, () => (t += 2)) === false && b.rebuilding; );
let diff = 0, diffR = 0;
for (let i = 0; i < seen.length; i++) if (seen[i] !== b.mips[0].data[i]) {
  diff++;
  if (i % 4 === 0) diffR++;
}
check(diff === 0, `rebuilt map against the live one: ${diff} bytes differ (${diffR} coverage)`);
check(Math.abs(a.painted - b.painted) < 1e-9, `the same share: ${(b.painted * 100).toFixed(3)} %`);

// ---- a blocked store: strokes paint, nothing throws
const blocked = { get() { throw new Error('no'); }, set() { throw new Error('no'); } };
const c = new MoonPaint(blocked, 5);
c.load();
fly(c, places.slice(0, 5));
check(c.strokes.length === 5 && c.painted > 0, 'a blocked store only means it does not persist');
const none = new MoonPaint(null, 5);
none.load();
fly(none, places.slice(0, 3));
check(none.strokes.length === 3, 'no store at all');

// ---- a store that fills up in flight: what went in is good, paint goes on, and it catches up if there's room again
{
  const m = memory();
  let room = 3;
  const full = { get: (k) => m.get(k), set(k, v) { if (room-- <= 0) throw new Error('full'); m.set(k, v); } };
  const p = new MoonPaint(full, 5);
  p.load();
  fly(p, places.slice(0, 10));
  check(p.strokes.length === 10 && p.painted > 0, 'a full store: paint goes on');
  const q = new MoonPaint(m, 6);
  const kept = q.load();
  check(kept >= 1 && kept < 10, `a full store keeps what went in: ${kept} of 10 strokes`);
  room = 1e6;
  fly(p, places.slice(10, 12));
  const r = new MoonPaint(m, 7);
  check(r.load() === 12, 'room again: the next save catches up');
}

// ---- a spoiled store: what can be read is drawn
const bad = memory();
bad.m.set('strugglebus.moon.v1.0', '[1,2,3,4,"x",2,3,4,5,6,9,1]');
const d = new MoonPaint(bad, 5);
check(d.load() === 1, 'a spoiled entry is skipped');
bad.m.set('strugglebus.moon.v1.0', '{{{');
const e = new MoonPaint(bad, 5);
check(e.load() === 0, 'an unreadable chunk is nothing');

// ---- slices: the most a frame draws, the worst place on the Moon, the rectangle it sends
let worstSlice = 0, worstRect = 0, worstMs = 0;
for (const [lat, lon] of [[0, 0], [60, 10], [84, 30], [89.5, 120], [-89.5, 0], [0, 179.9], [75, -179.5]]) {
  const p = new MoonPaint(null, 3);
  const job = p.begin({ lat, lon, level: 3, seed: 42 }, true);
  const t0 = performance.now();
  let slices = 0;
  for (;;) {
    const s0 = performance.now();
    const done = p.work(job, 9000);
    worstSlice = Math.max(worstSlice, performance.now() - s0);
    slices++;
    if (done) break;
  }
  worstMs = Math.max(worstMs, performance.now() - t0);
  const r = job.rect, w = Math.min(PAINT_W, r.x1 - r.x0 + 1), h = r.y1 - r.y0 + 1;
  worstRect = Math.max(worstRect, w * h);
  console.log(`  L3 at ${String(lat).padStart(5)}, ${String(lon).padStart(6)}: ${slices} slices, rect ${w} x ${h}, ${((w * h * 4) / 1024).toFixed(0)} KB on the first level`);
}
console.log(`  a slice at most ${worstSlice.toFixed(2)} ms here, a whole L3 at most ${worstMs.toFixed(2)} ms (this laptop, in Node)`);
check(worstRect < PAINT_W * PAINT_H * 0.5, `the worst rectangle is ${((worstRect / (PAINT_W * PAINT_H)) * 100).toFixed(0)} % of the map`);

// ---- a whole Moon's worth of strokes
{
  const s = memory();
  const list = [];
  for (let i = 0; i < MAX_STROKES; i++) list.push(rnd() * 160 - 80, rnd() * 360 - 180, 1 + (i % 3), (rnd() * 2 ** 31) >>> 0);
  for (let k = 0; k * 256 < list.length; k++) s.m.set(`strugglebus.moon.v1.${k}`, JSON.stringify(list.slice(k * 256, (k + 1) * 256)));
  const p = new MoonPaint(s, 1);
  const n = p.load();
  const t0 = performance.now();
  let frames = 0;
  while (p.rebuilding) {
    p.rebuild(3, () => performance.now());
    frames++;
  }
  console.log(`  ${n} strokes rebuild in ${(performance.now() - t0).toFixed(0)} ms, ${frames} frames of 3 ms: ${(p.painted * 100).toFixed(1)} % painted`);
  check(n === MAX_STROKES, 'the list holds its cap');
}

const bytes = a.mips.reduce((n, m) => n + m.data.length, 0);
console.log(`map ${PAINT_W} x ${PAINT_H} RGBA8, ${a.mips.length} levels, ${(bytes / 1048576).toFixed(2)} MB; a texel ${TEXEL_KM.toFixed(1)} km; floods ${EDGE_KM.slice(1).join(', ')} km`);
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
