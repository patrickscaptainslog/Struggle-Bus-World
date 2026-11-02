// What stands near a place on the map, for setting up a frame: the highest points and the largest craters. node tools/moon/run.mjs places.ts <lat> <lon> <x> <z> <half km>
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MoonGen, sunLine } from '../../src/moon/gen';
import { makeFrame, readAlbedo, readPlaces, readRelief, readWindow, type PlaceRow } from '../../src/moon/map';
import { cratersNear } from '../../src/moon/craters';

const root = pathToFileURL(`${process.cwd()}/public/`);
const gz = (u: string) => {
  const r = gunzipSync(readFileSync(new URL(u, root)));
  return r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) as ArrayBuffer;
};
const [lat, lon, cx, cz, half] = process.argv.slice(2).map(Number);
const relief = readRelief(gz('moon/relief.bin')), window = readWindow(gz('moon/theophilus.bin')), albedo = readAlbedo(gz('sky/moon.bin'));
const places = readPlaces(JSON.parse(readFileSync(new URL('moon/places.json', root), 'utf8')) as PlaceRow[]);
const frame = makeFrame(lat, lon);
const gen = new MoonGen({ relief, albedo, window, places }, frame, sunLine(0.5, 0.36, 0.5), 7, [-128000, -128000, 128000, 128000]);
const cell = 128, W = Math.round((half * 2000) / cell);
const H = new Float32Array(W * W), T = new Float32Array(W * W);
const x0 = Math.round((cx - half * 1000) / cell) * cell, z0 = Math.round((cz - half * 1000) / cell) * cell;
gen.raster(x0, z0, W, W, cell, H, T);
const peaks: Array<[number, number, number]> = [];
const R = 24;
for (let j = R; j < W - R; j++)
  for (let i = R; i < W - R; i++) {
    const k = j * W + i, h = H[k];
    let top = true;
    for (let b = -R; b <= R && top; b += 4) for (let a = -R; a <= R && top; a += 4) if (H[(j + b) * W + i + a] > h) top = false;
    if (top) peaks.push([x0 + i * cell, z0 + j * cell, Math.round(h)]);
  }
peaks.sort((a, b) => b[2] - a[2]);
console.log('datum', gen.datum, 'peaks (x, z, world Y):', JSON.stringify(peaks.slice(0, 8)));
const c = cratersNear(frame, albedo, 7, cx, cz, half * 1000, 500);
console.log('craters over 500 m:', c.length);
for (const k of c.slice(0, 14)) console.log(' ', k.id, Math.round(k.x), Math.round(k.z), 'D', Math.round(k.r * 2), 'age', k.age);
