// The player's view of it: paint at one place, then one blast elsewhere, reload (a new GroundPaint on the same storage), and the tiles come in again.
// argv[2]: the map's centre latitude for the SECOND blast's place (its map is centred there). The first blasts are at 30 N on their own map.
// Prints painted texels on the first place's tile live and after the reload, and on the second place's tile.
import { store } from './fake-storage.mjs';
import { GroundPaint, layout, geoFor } from './hooks.mjs';
const lat2 = Number(process.argv[2] ?? 90);
const U = () => ({ tGround: { value: null }, uGroundOn: { value: 0 } });
const painted = (g, key) => { const m = g.masks.get(key); if (!m) return 0; let n = 0; for (let t = 0; t < m.data.length; t += 4) if (m.data[t]) n++; return n; };
const slug = 'moon_30.00_10.00';
// session 1, place A (30 N): 20 blasts on tile 0,0
const A = geoFor(30, 10);
let g = new GroundPaint(256, slug, 'osm');
g.useGeo(A.geo);
g.attach(0, 0, 0, 0, U());
for (let k = 0; k < 20; k++) g.blast(layout.makeBlastSpec(60 + 35 * (k % 5), 60 + 35 * Math.floor(k / 5), layout.blastRadiusFor(0), k % 6, 1000 + k), 0);
const aLive = painted(g, '0,0');
g.persist();
const storedA = [...store.keys()].filter((k) => k.includes('gpic:')).length;
// session 1 goes on: the map made again round place B (lat2), one blast there. (As a new map round the bus does: the same store, another frame.)
const B = geoFor(lat2, 10);
const g2 = new GroundPaint(256, slug, 'osm');
g2.useGeo(B.geo);
g2.attach(0, 0, 0, 0, U());
let t0 = performance.now();
g2.blast(layout.makeBlastSpec(128, 128, layout.blastRadiusFor(0), 3, 777), 0);
const blastMs = performance.now() - t0;
const bLive = painted(g2, '0,0');
t0 = performance.now();
g2.persist();
const persistMs = performance.now() - t0;
// reload: back at A, and at B
const r1 = new GroundPaint(256, slug, 'osm');
r1.useGeo(A.geo);
r1.attach(0, 0, 0, 0, U());
const aBack = painted(r1, '0,0');
const r2 = new GroundPaint(256, slug, 'osm');
r2.useGeo(B.geo);
r2.attach(0, 0, 0, 0, U());
const bBack = painted(r2, '0,0');
console.log(JSON.stringify({ secondPlaceLat: lat2, placeA: { liveTexels: aLive, picturesStored: storedA, afterReloadTexels: aBack }, placeB: { blastMs: Math.round(blastMs), persistMs: Math.round(persistMs), liveTexels: bLive, afterReloadTexels: bBack }, picturesStoredAtEnd: [...store.keys()].filter((k) => k.includes('gpic:')).length }));
