// What the far field costs a worker: each level's whole window, coarse to fine, around a place, then a move of two blocks, as a world reached from orbit makes them. node tools/moon/run.mjs farcost.ts [lat lon]
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FAR, FarStore, MoonGen, makeRegion, sunLine } from '../../src/moon/gen';
import { makeFrame, readAlbedo, readPlaces, readRelief, readWindow, type PlaceRow } from '../../src/moon/map';

const root = pathToFileURL(`${process.cwd()}/public/`);
const gz = (u: string) => {
  const r = gunzipSync(readFileSync(new URL(u, root)));
  return r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) as ArrayBuffer;
};
const [lat = 0.67, lon = 23.47] = process.argv.slice(2).map(Number);
const relief = readRelief(gz('moon/relief.bin')), window = readWindow(gz('moon/theophilus.bin')), albedo = readAlbedo(gz('sky/moon.bin'));
const places = readPlaces(JSON.parse(readFileSync(new URL('moon/places.json', root), 'utf8')) as PlaceRow[]);
const frame = makeFrame(lat, lon);
const sun = sunLine(0.7, 0.4, 0.3);
const t00 = performance.now();
const gen = new MoonGen({ relief, albedo, window, places }, frame, sun, 7, [-128000, -128000, 128000, 128000]);
gen.sunFix = [frame.u[0] * 0.5 + frame.e[0] * 0.8, frame.u[1] * 0.5 + frame.e[1] * 0.8, frame.u[2] * 0.5 + frame.e[2] * 0.8];
const far = new FarStore(gen, FAR.HIGH_LEVELS);
console.log(`a place: ${(performance.now() - t00).toFixed(0)} ms`);
let sum = 0;
for (let k = FAR.HIGH_LEVELS - 1; k >= 0; k--) {
  const t0 = performance.now();
  const u = far.move(k, -4, -4);
  const ms = performance.now() - t0;
  sum += ms;
  console.log(`level ${k}, ${FAR.C0 * 2 ** k} m: ${u.blocks.length / 2} blocks, ${ms.toFixed(0)} ms, ${(ms / (u.blocks.length / 2)).toFixed(1)} ms a block, all so far ${sum.toFixed(0)} ms`);
}
for (let k = FAR.HIGH_LEVELS - 1; k >= 0; k--) {
  const t0 = performance.now();
  const u = far.move(k, -2, -4);
  console.log(`level ${k} moves two blocks: ${u.blocks.length / 2} blocks, ${(performance.now() - t0).toFixed(0)} ms`);
}
for (const lod of [1, 0] as const) {
  const t0 = performance.now();
  makeRegion(gen, 0, 0, lod, far.planeAt);
  console.log(`region, lod ${lod}: ${(performance.now() - t0).toFixed(0)} ms`);
}
