#!/usr/bin/env node
// The pictures a box on the map reaches are all walked, and not many more (src/world/GeoPaint.ts, picsOver), in Node: node --no-warnings tools/moon/walk-check.mjs
// For boxes of a tile to a MEGA's reach, on maps centred from the equator to either pole and on the date line: every picture under a point in the box is one the walk visits, and the walk
// visits no more than a few times the pictures the box covers. The second review, 2026-11-04 (P3): the walk was on a grid the keys weren't, and missed up to half a cell at one end of a tile's
// longitudes. The third (B1): near a pole one box walked every longitude, up to 276,672 pictures, and nothing here went near one.
// Exit 1 if one is missed, or a walk is long.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { GeoPaint, MemoryStore, geoGrid } = await import('../../src/world/GeoPaint.ts');
const { makeFrame, dirOf, latLonToMap, latOf, lonOf } = await import('../../src/moon/map.ts');

let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
let boxes = 0, points = 0, missed = 0, long = 0, most = 0, ms = 0;
const worst = [], longest = [];
const spot = { key: 0, a: 0, b: 0 };
for (const lat0 of [0, 20, 42.5, -42.5, 60, -60, 75, 85, -85, 87.9, -88, 88.6, 89.5, -89.67, 89.99, 90, -90]) for (const lon0 of [0, 179.9, -179.95, 90]) {
  const f = makeFrame(lat0, lon0), d = [0, 0, 0];
  const geo = { toLatLon(x, z, o) { dirOf(f, x, z, d); o[0] = latOf(d); o[1] = lonOf(d); }, toXZ(la, lo, o) { latLonToMap(f, la, lo, d); o[0] = d[0]; o[1] = d[1]; } };
  const g = new GeoPaint(geo, new MemoryStore(), () => null, () => undefined, 256);
  for (let n = 0; n < 200; n++) {
    // (round the map's middle, where the pole is when it's centred there, and out to 70 km)
    const far = n < 100 ? 3000 : 140000, x0 = (rnd() - 0.5) * far, z0 = (rnd() - 0.5) * far, w = 256 + 1300 * rnd(), h = 256 + 1300 * rnd();
    const t0 = performance.now(), keys = g.picsOver(x0, z0, x0 + w, z0 + h);
    ms = Math.max(ms, performance.now() - t0);
    const seen = new Set(keys);
    boxes++;
    // (the pictures the box covers, and a ring of them round it for the walk's padding)
    const cover = (w / geoGrid.PIC_M + 3) * (h / geoGrid.PIC_M + 3);
    most = Math.max(most, keys.length / cover);
    if (keys.length > 3 * cover) {
      long++;
      if (longest.length < 5) longest.push({ lat0, lon0, x0: Math.round(x0), z0: Math.round(z0), w: Math.round(w), h: Math.round(h), walked: keys.length, cover: Math.round(cover) });
    }
    for (let k = 0; k < 60; k++) {
      const x = x0 + rnd() * w, z = z0 + rnd() * h, o = [0, 0];
      geo.toLatLon(x, z, o);
      geoGrid.locate(o[0], o[1], spot);
      points++;
      if (!seen.has(spot.key)) {
        missed++;
        if (worst.length < 5) worst.push({ lat0, lon0, lat: +o[0].toFixed(5), lon: +o[1].toFixed(5), key: spot.key });
      }
    }
  }
}
console.log(`${missed ? 'FAIL' : 'pass'}  every picture under a point in a box is walked: ${boxes} boxes, ${points} points, ${missed} missed`, JSON.stringify(worst));
console.log(`${long ? 'FAIL' : 'pass'}  no walk over three times the pictures its box covers: ${long} long, the most ${most.toFixed(2)} times, the slowest walk ${ms.toFixed(2)} ms`, JSON.stringify(longest));
process.exit(missed || long ? 1 : 0);
