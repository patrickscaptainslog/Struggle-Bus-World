// G: a MEGA over the oldest picture kept, once the cap is reached. geoPic opens that picture, its close loop writes a dirty one, writeGeo evicts the oldest: the picture being opened.
// Then fold's `this.geoPics.get(key)!.t = now` meets undefined. Through the real entry point, blast() -> land() -> fold().
import { Store, paintAt, makeBlastSpec, nextSeed } from './common.mjs';
const store = new Store(50 * 1024 * 1024);
const g = paintAt(0, 30, store);
const frames = (n) => { for (let k = 0; k < n; k++) g.flush(null, 1 / 60); };
// the first breath (its pictures are the oldest kept)
g.blast(makeBlastSpec(0, 0, 60, 0, nextSeed()), -100);
frames(156);
const oldest = new Set(g.geoPics.keys());
// painting elsewhere, 30 km off, until the cap is about to be reached
let n = 0;
while (g.geoPics.size < 596) { g.blast(makeBlastSpec(30000 + (n % 40) * 300, Math.floor(n / 40) * 300, 60, n % 6, nextSeed()), -100); frames(156); n++; }
console.log(`after ${n + 1} breaths: ${g.geoPics.size} pictures, the first breath's ${[...oldest].filter((k) => g.geoPics.has(k)).length} still kept`);
// a full MEGA (r = 60 x 2.6 = 156 at drop 0; 468 from 600 m up) placed so the walk reaches one of the first breath's pictures as its 49th
const r = 468, SEED = 777;
// which pictures this MEGA paints, from a fresh copy of the same map (the fold is deterministic by its seed)
const paintedBy = (dx, dz) => { const h = paintAt(0, 30, new Store(1e9)); h.fold(makeBlastSpec(dx, dz, r, 3, SEED)); return new Set([...h.geoPics].filter(([, q]) => q.enc || (q.data && q.data.some((v) => v))).map(([k]) => k)); };
let found = null;
let tried = 0;
for (let dz = -900; dz <= 900 && !found; dz += 40) for (let dx = -600; dx <= 600 && !found; dx += 40) {
  const p = g.prepare(makeBlastSpec(dx, dz, r, 3, SEED)), box = g.boxOf(p.minX, p.minZ, p.maxX, p.maxZ), order = [];
  g.eachPic(box, (i, j) => order.push(`${i},${j}`));
  const idx = order.map((k, i) => (oldest.has(k) ? i : -1)).filter((i) => i >= 48 && i < 48 + 50);
  if (!idx.length) continue;
  tried++;
  const S = paintedBy(dx, dz), E = order.findIndex((k) => S.has(k));
  // (the first dirty picture leaves the 48 open at the walk's 49th + E: that open evicts the oldest)
  if (E >= 0 && oldest.has(order[48 + E]) && S.has(order[48 + E])) found = { dx, dz, E, key: order[48 + E], walk: order.length };
}
console.log('MEGA placed at', JSON.stringify(found), 'after', tried, 'placements folded');
try {
  g.blast(makeBlastSpec(found.dx, found.dz, r, 3, SEED), -100);
  console.log('no throw');
} catch (e) {
  console.log(`blast() threw: ${e.constructor.name}: ${e.message}`);
  console.log(e.stack.split('\n').slice(1, 4).join('\n'));
}
