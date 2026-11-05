// C: one level breath near a pole. The real fold, its walk capped at N pictures to time it, and what the save does to older paint kept 50 km away.
import { Store, paintAt, makeBlastSpec, nextSeed } from './common.mjs';
const store = new Store(5 * 1024 * 1024);
const g = paintAt(-89.67, 129.78, store); // Shackleton's floor, a named place (places.json)
const frames = (n) => { for (let k = 0; k < n; k++) g.flush(null, 1 / 60); };
// 30 breaths 50 km off (lat about -88.0, not polar), saved as play saves them
for (let k = 0; k < 30; k++) {
  g.fold(makeBlastSpec((k % 6) * 300, -50000 - Math.floor(k / 6) * 300, 60, k % 6, nextSeed()));
  frames(156);
}
const keys = () => [...store.m.keys()].filter((k) => k.includes('gpic:'));
const old = new Set(keys());
console.log(`before: ${g.geoPics.size} pictures in memory, ${old.size} saved, ${store.used} chars`);
// the breath on Shackleton's floor: how far the walk goes, then the fold with its walk capped at N
const p = g.prepare(makeBlastSpec(0, 0, 60, 2, nextSeed()));
const box = g.boxOf(p.minX, p.minZ, p.maxX, p.maxZ);
let walk = 0;
g.eachPic(box, () => walk++);
const N = 3000, orig = g.eachPic.bind(g);
g.eachPic = (b, f) => { let n = 0; orig(b, (i, j, w) => { if (n++ < N) f(i, j, w); }); };
let t0 = performance.now();
g.fold(makeBlastSpec(0, 0, 60, 2, nextSeed()));
const ms = performance.now() - t0;
g.eachPic = orig;
console.log(`Shackleton breath r=60: box lat ${box.la0.toFixed(4)}..${box.la1.toFixed(4)}, lon ${box.lo0}..${box.lo1}: the walk is ${walk} pictures; the first ${N} folded in ${ms.toFixed(0)} ms (${(ms / N).toFixed(3)} ms a picture) -> all ${walk}: ${((ms / N) * walk / 1000).toFixed(0)} s on this laptop, and ${(walk * 65536 / 2 ** 30).toFixed(1)} GiB of 64 KB pictures allocated`);
console.log(`after the capped fold: ${g.geoPics.size} pictures in memory, ${[...g.geoPics.values()].filter((q) => q.dirty).length} dirty`);
t0 = performance.now();
frames(200);
const left = keys();
console.log(`after 200 frames of saves (${(performance.now() - t0).toFixed(0)} ms): ${g.geoPics.size} in memory, ${left.length} saved; of the ${old.size} older pictures 50 km away, ${left.filter((k) => old.has(k)).length} still saved`);
// and a breath on the pole itself, uncapped
const s2 = new Store(5 * 1024 * 1024);
const g2 = paintAt(-90, 0, s2);
for (let k = 0; k < 10; k++) { g2.fold(makeBlastSpec(k * 300, -40000, 60, k % 6, nextSeed())); for (let f = 0; f < 156; f++) g2.flush(null, 1 / 60); }
const old2 = new Set([...s2.m.keys()]);
t0 = performance.now();
g2.fold(makeBlastSpec(0, 0, 60, 2, nextSeed()));
const ms2 = performance.now() - t0;
const made = g2.geoPics.size;
for (let f = 0; f < 200; f++) g2.flush(null, 1 / 60);
console.log(`a breath on the south pole: fold ${ms2.toFixed(0)} ms, ${made} pictures in memory after it; after the saves ${[...s2.m.keys()].filter((k) => old2.has(k)).length} of ${old2.size} older saved pictures 40 km off are left`);
