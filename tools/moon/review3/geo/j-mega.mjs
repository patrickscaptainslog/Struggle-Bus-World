// J: a MEGA from 600 m up (r = 180 x 2.6 = 468), timed with nothing wrapped; pictures made and painted (painted: coded or with a texel on). And geoNear for one tile on Shackleton's floor once any picture exists.
import { Store, paintAt, makeBlastSpec, nextSeed } from './common.mjs';
for (const r of [180, 468]) {
  const g = paintAt(30, 30, new Store(50 * 1024 * 1024));
  for (let k = 0; k < 2; k++) g.fold(makeBlastSpec(-40000 - 4000 * k, 0, r, 1, nextSeed()));
  const T = [];
  let made = 0, painted = 0;
  for (let k = 0; k < 4; k++) {
    const keys0 = new Set(g.geoPics.keys());
    const t0 = performance.now();
    g.fold(makeBlastSpec(4000 * k, 0, r, k % 6, nextSeed()));
    T.push(performance.now() - t0);
    for (const [key, q] of g.geoPics) if (!keys0.has(key)) { made++; if (q.enc || (q.data && q.data.some((v) => v))) painted++; }
  }
  console.log(`r ${r}: fold ${T.map((t) => t.toFixed(0)).join(' ')} ms; ${made / 4} pictures made a blast, ${painted / 4} painted, ${((made - painted) / 4).toFixed(1)} empty`);
}
const g = paintAt(-89.67, 129.78, new Store(1e9));
g.fold(makeBlastSpec(0, -50000, 60, 1, nextSeed()));
const T = [];
for (let k = 0; k < 5; k++) { const t0 = performance.now(); g.hasSaved(k, 0); T.push(performance.now() - t0); }
console.log(`hasSaved (geoNear) for one tile on Shackleton's floor, with one picture kept 50 km off: ${T.map((t) => t.toFixed(0)).join(' ')} ms`);
