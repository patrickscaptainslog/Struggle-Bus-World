// F: one 5 M-character store shared by the street's ground paint and the Moon's pictures, as one origin's localStorage is.
// The street paints 100 tiles; the Moon then paints 40 patches as keep.mjs's heavy row does (60 breaths each, r 65); then the street paints 30 new tiles.
import { Store, GroundPaint, paintAt, makeBlastSpec, nextSeed, uni } from './common.mjs';
const store = new Store(1300000);
globalThis.localStorage = store;
const streetKeys = () => [...store.m.keys()].filter((k) => k.startsWith('strugglebus.ground.v4:'));
const moonKeys = () => [...store.m.keys()].filter((k) => k.includes(':gpic:'));
function street(tiles, blasts, t0) {
  const gs = new GroundPaint(256, 'sf', 'osm');
  for (const [tx, tz] of tiles) gs.attach(tx, tz, tx * 256, tz * 256, uni());
  for (let k = 0; k < blasts; k++) {
    const [tx, tz] = tiles[k % tiles.length];
    gs.blast(makeBlastSpec(tx * 256 + 40 + ((k * 37) % 170), tz * 256 + 40 + ((k * 53) % 170), 60, k % 6, nextSeed()), -100);
    gs.dirty.length = 0;
  }
  for (let f = 0; f < 600; f++) { gs.dirty.length = 0; gs.flush(null, 1 / 60); }
  gs.persist();
  return gs;
}
const A = [];
for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) A.push([i, j]);
street(A, 300);
const s1 = new Set(streetKeys());
console.log(`street: ${s1.size} tiles saved, ${store.used} chars`);
const gm = paintAt(10, 30, store);
let fails0 = store.fails;
for (let p = 0; p < 12; p++) {
  const cx = (p % 8) * 2000 - 8000, cz = Math.floor(p / 8) * 2000 - 5000;
  for (let k = 0; k < 60; k++) {
    const u = (k % 10) / 9 - 0.5, v = Math.floor(k / 10) / 5 - 0.5; if (p === 11 && k === 0) { globalThis.__before = new Map([...gm.geoPics].filter(([, q]) => q.enc).map(([kk, q]) => [kk, q.enc])); }
    gm.fold(makeBlastSpec(cx + u * 330, cz + v * 210, 65, k % 6, nextSeed()));
  }
  for (let f = 0; f < 156; f++) gm.flush(null, 1 / 60);
}
gm.persist();
const savedMoon = new Set(moonKeys().map((k) => k.slice(k.indexOf('gpic:') + 5)));
const inMem = [...gm.geoPics].filter(([, q]) => q.enc);
console.log(`moon: ${gm.geoPics.size} pictures in memory, ${inMem.length} with paint, ${savedMoon.size} saved, ${inMem.filter(([k]) => !savedMoon.has(k)).length} painted but not in storage (gone on a reload), ${store.fails - fails0} failed setItem calls; store ${store.used} chars; street tiles still saved ${streetKeys().length} of ${s1.size}`);
const B = [];
for (let i = 20; i < 26; i++) for (let j = 0; j < 5; j++) B.push([i, j]);
fails0 = store.fails;
street(B, 90);
const s2 = streetKeys();
console.log(`street again, 30 new tiles: ${store.fails - fails0} failed setItem calls; of the first ${s1.size} street tiles ${s2.filter((k) => s1.has(k)).length} are left, ${s2.filter((k) => !s1.has(k)).length} of the 30 new saved; store ${store.used} chars`);
// what a reload would find, against what the session showed
const g2 = paintAt(10, 30, store);
let back = 0, stale = 0;
for (const [k, q] of gm.geoPics) if (q.enc) { const r = g2.geoPics.get(k); if (!r) continue; back++; if (r.enc !== q.enc) stale++; }
console.log(`a reload: ${g2.geoPics.size} pictures read back; of those the session had, ${stale} come back as an older picture than the session showed`);
