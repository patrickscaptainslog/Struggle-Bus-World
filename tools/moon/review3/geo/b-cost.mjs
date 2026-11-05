// B: what one fold costs at impact (Node on this laptop), how many pictures it creates and paints, what each painted one codes to; then a tile coming in (pictureInto).
import { paintAt, makeBlastSpec, encodeMask, nextSeed, uni } from './common.mjs';
const now = () => performance.now();
const rows = [];
for (const lat of [0, 45]) for (const r of [60, 90, 180, 468]) {
  const g = paintAt(lat, 30);
  // warm up the JIT on the same sizes elsewhere
  for (let k = 0; k < 3; k++) g.fold(makeBlastSpec(20000 + k * 3000, 0, r, k % 6, nextSeed()));
  const before = g.geoPics.size;
  const T = [];
  let made = 0, painted = 0, sizes = [];
  for (let k = 0; k < 5; k++) {
    const keys0 = new Set(g.geoPics.keys());
    const t0 = now();
    g.fold(makeBlastSpec(-20000 - k * 3000, 0, r, k % 6, nextSeed()));
    T.push(now() - t0);
    for (const [key, pic] of g.geoPics) if (!keys0.has(key)) {
      made++;
      if (pic.dirty) { painted++; sizes.push(encodeMask(pic.data).length); }
    }
  }
  sizes.sort((a, b) => a - b);
  rows.push({ lat, r, foldMs: T.map((t) => t.toFixed(1)).join(' '), madePerBlast: made / 5, paintedPerBlast: painted / 5, encMedian: sizes[sizes.length >> 1], encMax: sizes[sizes.length - 1], scratch: g.scratchPool.length });
}
console.table(rows);

// a tile coming in under painted pictures: one pass of 16,384 texels, a string key per texel
{
  const g = paintAt(0, 30);
  for (let k = 0; k < 20; k++) g.fold(makeBlastSpec((k % 5) * 120, Math.floor(k / 5) * 120, 60, k % 6, nextSeed()));
  const T = [];
  let n = 0;
  for (let rep = 0; rep < 3; rep++)
    for (let tx = 0; tx < 3; tx++) for (let tz = 0; tz < 2; tz++) {
      g.detach(tx, tz);
      const t0 = now();
      g.attach(tx, tz, tx * 256, tz * 256, uni());
      T.push(now() - t0);
      n++;
    }
  T.sort((a, b) => a - b);
  console.log(`pictureInto at lat 0: ${n} tiles in, median ${T[T.length >> 1].toFixed(2)} ms, max ${T[T.length - 1].toFixed(2)} ms (Node, this laptop)`);
  const g2 = paintAt(86, 30);
  for (let k = 0; k < 20; k++) g2.fold(makeBlastSpec((k % 5) * 120, Math.floor(k / 5) * 120, 60, k % 6, nextSeed()));
  const T2 = [];
  for (let rep = 0; rep < 3; rep++) for (let tx = 0; tx < 3; tx++) for (let tz = 0; tz < 2; tz++) {
    g2.detach(tx, tz);
    const t0 = now();
    g2.attach(tx, tz, tx * 256, tz * 256, uni());
    T2.push(now() - t0);
  }
  T2.sort((a, b) => a - b);
  console.log(`pictureInto at lat 86 (polar: a toLatLon per texel): median ${T2[T2.length >> 1].toFixed(2)} ms, max ${T2[T2.length - 1].toFixed(2)} ms`);
}
