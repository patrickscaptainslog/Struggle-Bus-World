// One map centred at 88 N. Twenty blasts painted at the map's middle (88 N, ordinary ground), saved. Then ONE blast at a pole-side spot
// (argument: metres north of the middle; 60,640 m north is the pole). What fold makes, how long it and the next save take, and what of
// the first twenty blasts' pictures is still in storage after.
import { store } from './fake-storage.mjs';
import { GroundPaint, layout, geoFor, map } from './hooks.mjs';
const north = Number(process.argv[2] ?? 60600);
const { geo, f } = geoFor(88, 10);
const g = new GroundPaint(256, 'moon_88.00_10.00', 'osm');
g.useGeo(geo);
for (let k = 0; k < 20; k++) g.fold(layout.makeBlastSpec(128 + 40 * (k % 5), 128 + 40 * Math.floor(k / 5), layout.blastRadiusFor(0), k % 6, 1000 + k));
g.saveGeo(Infinity);
const keys = (s) => [...store.keys()].filter((k) => k.includes('gpic:'));
const before = new Set(keys());
const d = [0, 0, 0];
map.dirOf(f, 128, -north, d);
console.log('before the pole blast: pictures in storage', before.size, 'pole blast at lat', map.latOf(d).toFixed(4));
let t0 = performance.now();
g.fold(layout.makeBlastSpec(128, -north, layout.blastRadiusFor(0), 3, 777));
const foldMs = performance.now() - t0;
const made = g.geoPics.size;
t0 = performance.now();
g.saveGeo(Infinity);
const saveMs = performance.now() - t0;
const after = keys();
const kept = [...before].filter((k) => store.has(k)).length;
console.log(JSON.stringify({ foldMs: Math.round(foldMs), picturesInMemoryAfterFold: made, saveMs: Math.round(saveMs), picturesInStorageAfter: after.length, ofTheFirst20BlastsPicturesStillStored: `${kept} of ${before.size}`, picturesInMemoryAfterSave: g.geoPics.size }));
