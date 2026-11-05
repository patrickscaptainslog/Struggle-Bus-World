// K: a breath at a small crater, shaped as CraterPaint.barf shapes it (r = 1.2 t.r + 26, reach (2.3 t.r + 36) / r, blobs 18 + 0.4 t.r, no splat edge, rays or dots): pictures made and painted.
import { Store, paintAt, makeBlastSpec, nextSeed } from './common.mjs';
for (const tr of [20, 60, 150]) {
  const g = paintAt(30, 30, new Store(1e9));
  let made = 0, painted = 0;
  for (let k = 0; k < 4; k++) {
    const keys0 = new Set(g.geoPics.keys());
    const s = makeBlastSpec(5000 * k, 0, tr * 1.2 + 26, k, nextSeed());
    s.edge = 0.02; s.ragged = 0; s.rays = 0; s.dots = 0; s.blobs = Math.round(18 + tr * 0.4); s.reach = (tr * 2.3 + 36) / s.r;
    g.fold(s);
    for (const [key, q] of g.geoPics) if (!keys0.has(key)) { made++; if (q.enc || (q.data && q.data.some((v) => v))) painted++; }
  }
  console.log(`crater of r ${tr} m: ${made / 4} pictures made a breath, ${painted / 4} painted`);
}
