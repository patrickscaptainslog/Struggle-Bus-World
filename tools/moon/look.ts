// Pictures of the generator with no game in the way: a raster of heights and light, as PNGs. node tools/moon/run.mjs look.ts <out dir> [name=lat,lon,sizeKm,cellM ...]
import { deflateSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FAR, FarStore, MoonGen, sunLine, sweepSun, makeRegion } from '../../src/moon/gen';
import { makeFrame, readAlbedo, readPlaces, readRelief, readWindow, type PlaceRow } from '../../src/moon/map';
import { cratersNear } from '../../src/moon/craters';

const root = pathToFileURL(`${process.cwd()}/public/`);
const gz = (u: string) => {
  const b = readFileSync(new URL(u, root));
  const r = gunzipSync(b);
  return r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) as ArrayBuffer;
};
const t0 = performance.now();
const relief = readRelief(gz('moon/relief.bin'));
const window = readWindow(gz('moon/theophilus.bin'));
const albedo = readAlbedo(gz('sky/moon.bin'));
const places = readPlaces(JSON.parse(readFileSync(new URL('moon/places.json', root), 'utf8')) as PlaceRow[]);
console.log('load ms', Math.round(performance.now() - t0));

function png(path: string, w: number, h: number, g: Uint8Array) {
  const crcT = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (b: Uint8Array) => {
    let c = -1;
    for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (t: string, d: Uint8Array) => {
    const o = new Uint8Array(12 + d.length), v = new DataView(o.buffer);
    v.setUint32(0, d.length);
    for (let i = 0; i < 4; i++) o[4 + i] = t.charCodeAt(i);
    o.set(d, 8);
    v.setUint32(8 + d.length, crc(o.subarray(4, 8 + d.length)));
    return o;
  };
  const raw = new Uint8Array((w + 1) * h);
  for (let j = 0; j < h; j++) raw.set(g.subarray(j * w, (j + 1) * w), j * (w + 1) + 1);
  const ih = new Uint8Array(13), iv = new DataView(ih.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ih[8] = 8;
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  writeFileSync(path, Buffer.concat(parts));
}

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const specs = process.argv.slice(3);
const az = (+(process.env.SUNAZ ?? 100) * Math.PI) / 180, el = (+(process.env.SUNEL ?? 22) * Math.PI) / 180;
const sun = sunLine(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
for (const spec of specs) {
  const [name, rest] = spec.split('=');
  const [lat, lon, km, cell] = rest.split(',').map(Number);
  const frame = makeFrame(lat, lon);
  const half = km * 500;
  const gen = new MoonGen({ relief, albedo, window, places }, frame, sun, 7, [-half, -half, half, half]);
  const W = Math.round((km * 1000) / cell);
  const H = new Float32Array(W * W), T = new Float32Array(W * W), P = new Float32Array(W * W);
  const x0 = Math.round(-half / cell) * cell;
  const t1 = performance.now();
  gen.raster(x0, x0, W, W, cell, H, T);
  const t2 = performance.now();
  sweepSun(H, W, W, x0, x0, cell, sun, () => -1e9, P);
  const t3 = performance.now();
  let lo = Infinity, hi = -Infinity;
  for (const v of H) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  console.log(name, W + 'x' + W, 'raster', Math.round(t2 - t1), 'ms', 'sweep', Math.round(t3 - t2), 'ms; heights', Math.round(lo + gen.datum), Math.round(hi + gen.datum), 'datum', gen.datum);
  const g = new Uint8Array(W * W);
  const sy = Math.sin(el), sxz = Math.cos(el);
  for (let j = 1; j < W - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const k = j * W + i;
      const sxx = (H[k + 1] - H[k - 1]) / (2 * cell), szz = (H[k + W] - H[k - W]) / (2 * cell);
      const ndl = (-sxx * sun.ax * sxz + sy - szz * sun.az * sxz) / Math.hypot(sxx, 1, szz);
      const toneK = 0.55 + 0.9 * T[k];
      const lit = P[k] > H[k] ? 0.03 : Math.max(0, ndl / sy) * 0.42 * toneK + 0.03;
      g[k] = Math.max(0, Math.min(255, Math.round(255 * lit)));
    }
  png(`${out}/${name}.png`, W, W, g);
  const c = cratersNear(frame, albedo, 7, 0, 0, 1000, 40);
  console.log('  craters within 1 km of the centre, D >= 40 m:', c.length, JSON.stringify(c.slice(0, 2)));
}
if (process.env.FARTEST) {
  const frame = makeFrame(-11.45, 26.28);
  const gen = new MoonGen({ relief, albedo, window, places }, frame, sun, 7, [-128000, -128000, 128000, 128000]);
  const far = new FarStore(gen);
  const t = performance.now();
  for (let k = FAR.LEVELS - 1; k >= 0; k--) {
    const t1 = performance.now();
    const b = FAR.B * FAR.C0 * 2 ** k;
    const u = far.move(k, -4, -4);
    console.log('level', k, 'blocks', u.blocks.length / 2, 'ms', Math.round(performance.now() - t1), 'cell', FAR.C0 * 2 ** k, 'block m', b);
    // (each level's map as the far field reads it: the tone of the slope along the Sun, black in shadow)
    const N = FAR.N, g = new Uint8Array(N * N), dec = (v: number) => {
      const s = (v - 128) / 127;
      return s * Math.abs(s) * 2;
    };
    for (let q = 0; q < u.blocks.length / 2; q++) {
      const ox = (u.blocks[q * 2] + 4) * FAR.B, oz = (u.blocks[q * 2 + 1] + 4) * FAR.B;
      for (let j = 0; j < FAR.B; j++)
        for (let i = 0; i < FAR.B; i++) {
          const o = (q * FAR.B * FAR.B + j * FAR.B + i) * 4;
          const sx = dec(u.map[o]), sz = dec(u.map[o + 1]);
          const lit = u.map[o + 3] > 128 ? 0 : Math.max(0, 0.4 * (1 - (sx * sun.ax + sz * sun.az) / sun.tanE));
          g[(oz + j) * N + ox + i] = Math.min(255, 255 * lit);
        }
    }
    png(`${out}/far${k}.png`, N, N, g);
  }
  console.log('far total ms', Math.round(performance.now() - t));
  for (const lod of [1, 0] as const) {
    const t1 = performance.now();
    const r = makeRegion(gen, 0, 0, lod, far.planeAt);
    console.log('region lod', lod, 'ms', Math.round(performance.now() - t1), 'bytes', r.transfer.reduce((a, b) => a + b.byteLength, 0));
  }
}
