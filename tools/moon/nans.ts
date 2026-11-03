// Walks the far levels and regions over a map and looks for anything that isn't a number. node tools/moon/run.mjs nans.ts [lat lon [slides]]
// slides: then the map slides north (its -z) that many times, as main.ts slides it, on one datum and a true Sun, and it's walked again each time: over a pole, if it's near one.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FAR, FarStore, MoonGen, makeRegion, sunLine } from '../../src/moon/gen';
import { frameAt, latOf, lonOf, makeFrame, readAlbedo, readPlaces, readRelief, readWindow, SLIDE, type PlaceRow } from '../../src/moon/map';

const root = pathToFileURL(`${process.cwd()}/public/`);
const gz = (u: string) => {
  const r = gunzipSync(readFileSync(new URL(u, root)));
  return r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) as ArrayBuffer;
};
const [lat = -11.45, lon = 26.28, slides = 0] = process.argv.slice(2).map(Number);
const relief = readRelief(gz('moon/relief.bin')), window = readWindow(gz('moon/theophilus.bin')), albedo = readAlbedo(gz('sky/moon.bin'));
const places = readPlaces(JSON.parse(readFileSync(new URL('moon/places.json', root), 'utf8')) as PlaceRow[]);
let frame = makeFrame(lat, lon);
const az = (247 * Math.PI) / 180, el = (20 * Math.PI) / 180;
const sx = Math.sin(az) * Math.cos(el), sy = Math.sin(el), sz = -Math.cos(az) * Math.cos(el);
const sun = sunLine(sx, sy, sz), bounds = [-128000, -128000, 128000, 128000];
// (with slides, a true Sun: this one, Moon fixed, so each block and region is lit by the Sun over it)
const fix = [0, 1, 2].map((i) => frame.e[i] * sx + frame.u[i] * sy - frame.n[i] * sz);
let gen = new MoonGen({ relief, albedo, window, places }, frame, sun, 7, bounds);
const datum = gen.datum;
if (slides) gen.sunFix = fix;
const far = new FarStore(gen);
const walk = () => {
const bad = (a: ArrayLike<number>) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) n++;
  return n;
};
for (const [x, z] of [[0, 0], [120000, 0], [-120000, 60000], [0, -127000], [127000, 127000]]) {
  let total = 0;
  for (let k = FAR.LEVELS - 1; k >= 0; k--) {
    const b = FAR.B * FAR.C0 * 2 ** k;
    const bi = 2 * Math.round(x / (2 * b)) - 4, bj = 2 * Math.round(z / (2 * b)) - 4;
    const u = far.move(k, bi, bj);
    const c = bad(u.heights);
    total += c;
    if (c) console.log('at', x, z, 'level', k, 'blocks', bi, bj, 'bad heights', c);
  }
  const rs = 1024, rx = Math.max(-125, Math.min(124, Math.floor(x / rs))), rz = Math.max(-125, Math.min(124, Math.floor(z / rs)));
  for (const lod of [1, 0] as const) {
    const r = makeRegion(gen, rx, rz, lod, far.planeAt);
    for (const t of r.tiles) total += bad(t.heights) + bad(t.obst);
  }
  console.log('at', x, z, 'not numbers:', total);
}
};
console.log('map round', lat, lon);
walk();
for (let k = 1; k <= slides; k++) {
  frame = frameAt(frame, 0, -SLIDE);
  gen = new MoonGen({ relief, albedo, window, places }, frame, sun, 7, bounds, datum);
  gen.sunFix = fix;
  far.slide(gen, 0, -SLIDE);
  console.log('slide', k, 'map round', +latOf(frame.u).toFixed(3), +lonOf(frame.u).toFixed(3), 'lat0', +frame.lat0.toFixed(3));
  walk();
}
