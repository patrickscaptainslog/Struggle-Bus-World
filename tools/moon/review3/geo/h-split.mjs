// H: where a fold's time goes, for a level breath and a MEGA from 600 m up: the scratch drawing (rows + dots), the opens and writes (geoPic), and the picture loop (a template string and a Map lookup per texel in the box).
import { Store, paintAt, makeBlastSpec, nextSeed } from './common.mjs';
for (const r of [60, 468]) {
  const g = paintAt(30, 30, new Store(50 * 1024 * 1024));
  let tr = 0, tp = 0, opens = 0;
  const R = g.rows.bind(g), Dd = g.dots.bind(g), P = g.geoPic.bind(g);
  g.rows = (...a) => { const t = performance.now(); R(...a); tr += performance.now() - t; };
  g.dots = (...a) => { const t = performance.now(); Dd(...a); tr += performance.now() - t; };
  g.geoPic = (...a) => { const t = performance.now(); const v = P(...a); tp += performance.now() - t; opens++; return v; };
  for (let k = 0; k < 3; k++) g.fold(makeBlastSpec(-40000 - 4000 * k, 0, r, 1, nextSeed()));
  tr = tp = opens = 0;
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const N = 4;
  for (let k = 0; k < N; k++) g.fold(makeBlastSpec(4000 * k, 0, r, k % 6, nextSeed()));
  const all = (performance.now() - t0) / N;
  console.log(`r ${r}: fold ${all.toFixed(1)} ms a blast: scratch rows+dots ${(tr / N).toFixed(1)} ms, opens+writes ${(tp / N).toFixed(1)} ms (${opens / N} opens), the picture loop the rest, ${(all - tr / N - tp / N).toFixed(1)} ms; heap grew ${((process.memoryUsage().heapUsed - heap0) / 1048576 / N).toFixed(1)} MB a blast before GC`);
}
