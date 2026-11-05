// D: the cap of 600 in play. A straight flight, a breath every 2.6 s (Flight.ts: S.duration 1.0 s, then S.recharge 1.6 s to a full belly), saved as play saves (flush, 156 frames between).
// When does the first breath's paint leave storage, and what does storage hold then? Then a reload: the first breath's tile and the last's.
import { Store, paintAt, makeBlastSpec, nextSeed, uni } from './common.mjs';
const scen = [
  { name: 'Express, low (112 m/s, drop 0, r 60)', v: 112, r: 60 },
  { name: 'Jet at its 150 m (450 m/s, r 90)', v: 450, r: 90 },
  { name: 'Turbo 3 (900 m/s, r 90)', v: 900, r: 90 },
  { name: 'from 600 m up (450 m/s, r 180)', v: 450, r: 180 },
];
const rows = [];
for (const s of scen) {
  const store = new Store(5 * 1024 * 1024);
  const g = paintAt(0, 30, store);
  const gap = s.v * 2.6;
  let firstKeys = null, firstGoneAt = -1, allGoneAt = -1, peakChars = 0, n = 0, empties = 0;
  for (; n < 400 && allGoneAt < 0; n++) {
    const before = new Set(g.geoPics.keys());
    g.fold(makeBlastSpec(-60000 + n * gap, (n % 2 ? 1 : -1) * 30, s.r, n % 6, nextSeed()));
    if (!firstKeys) firstKeys = [...g.geoPics].filter(([k, q]) => !before.has(k) && q.dirty).map(([k]) => k);
    for (let f = 0; f < 156; f++) g.flush(null, 1 / 60);
    peakChars = Math.max(peakChars, store.used);
    const saved = new Set([...store.m.keys()].map((k) => k.slice(k.indexOf('gpic:') + 5)));
    const left = firstKeys.filter((k) => saved.has(k)).length;
    if (left < firstKeys.length && firstGoneAt < 0) firstGoneAt = n;
    if (left === 0) allGoneAt = n;
  }
  empties = [...g.geoPics.values()].filter((q) => !q.enc).length;
  rows.push({ flight: s.name, breathsTillFirstGone: firstGoneAt, minutes: ((firstGoneAt * 2.6) / 60).toFixed(1), allOfFirstGone: allGoneAt, savedPics: [...store.m.keys()].length, emptyInMemory: empties, chars: store.used, peakChars });
}
console.table(rows);
