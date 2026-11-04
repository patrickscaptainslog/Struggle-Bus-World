#!/usr/bin/env node
// The pictures a box on the map reaches are all walked (src/world/GroundPaint.ts, eachPic), in Node: node --no-warnings tools/moon/walk-check.mjs
// For boxes of a tile and a blast's reach, on maps centred from the equator to the poles and on the date line: every picture under a point in the box is one the walk visits. The second
// review, 2026-11-04 (P3): the walk was on a grid the keys weren't, and missed up to half a cell at one end of a tile's longitudes.
// Exit 1 if one is missed.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { GroundPaint } = await import('../../src/world/GroundPaint.ts');
const { makeFrame, dirOf, latLonToMap, latOf, lonOf } = await import('../../src/moon/map.ts');

let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
let boxes = 0, points = 0, missed = 0;
const worst = [];
for (const lat0 of [0, 20, 42.5, -42.5, 60, 75, 85, 89.5]) for (const lon0 of [0, 179.9, -179.95, 90]) {
  const f = makeFrame(lat0, lon0), d = [0, 0, 0];
  const g = new GroundPaint(256, 'moon-walk-check');
  g.useGeo({ toLatLon(x, z, o) { dirOf(f, x, z, d); o[0] = latOf(d); o[1] = lonOf(d); }, toXZ(la, lo, o) { latLonToMap(f, la, lo, d); o[0] = d[0]; o[1] = d[1]; } });
  for (let n = 0; n < 250; n++) {
    const x0 = (rnd() - 0.5) * 20000, z0 = (rnd() - 0.5) * 20000, w = 256 + 800 * rnd(), h = 256 + 800 * rnd();
    const box = g.boxOf(x0, z0, x0 + w, z0 + h);
    if (!box) continue;
    const seen = new Set();
    g.eachPic(box, (i, j) => seen.add(`${i},${j}`));
    boxes++;
    for (let k = 0; k < 60; k++) {
      const x = x0 + rnd() * w, z = z0 + rnd() * h, o = [0, 0];
      g.geo.toLatLon(x, z, o);
      const i = Math.floor(o[0] / 0.005), wl = 0.005 / Math.max(0.02, Math.cos(((i + 0.5) * 0.005 * Math.PI) / 180)), j = Math.floor(((((o[1] + 180) % 360) + 360) % 360) / wl);
      points++;
      if (!seen.has(`${i},${j}`)) {
        missed++;
        if (worst.length < 5) worst.push({ lat0, lon0, lat: +o[0].toFixed(5), lon: +o[1].toFixed(5), key: `${i},${j}` });
      }
    }
  }
}
console.log(`${missed ? 'FAIL' : 'pass'}  every picture under a point in a box is walked: ${boxes} boxes, ${points} points, ${missed} missed`, JSON.stringify(worst));
process.exit(missed ? 1 : 0);
