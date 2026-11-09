#!/usr/bin/env node
// Cars along the bridges' decks (the re-review's M9; src/life/sim/cars.ts), in Node on San Francisco's own road graphs: node --no-warnings tools/life/bridges.mjs
//   decks    the Bay Bridge's and the Golden Gate's carriageways at 08:00 on a Thursday, every car on a deck with no thinning by distance, counted by
//            the 500 m along each way: no stretch of a carriageway with under half its own mean, each carriageway's far end over 0.6 of its near
//   same     the same moment twice, the same cars; a minute of seconds ends where one jump does (a car's place is its age's)
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { buildNet, carsOn } = await import('../../src/life/sim/cars.ts');
const { Col, ROW } = await import('../../src/life/kinds.ts');
const { rolldown } = await import('rolldown');
const { gunzipSync } = await import('node:zlib');
const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
const { fileURLToPath, pathToFileURL } = await import('node:url');
const here = fileURLToPath(new URL('.', import.meta.url)), root = fileURLToPath(new URL('../..', import.meta.url)), outDir = `${here}.out`;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/entry-bridges.ts`, `export { parseRegionGraph } from '${root.replace(/\\/g, '/')}src/world/lifeData.ts';`);
const bundle = await rolldown({ input: `${outDir}/entry-bridges.ts`, platform: 'node', logLevel: 'warn' });
await bundle.write({ dir: outDir, format: 'esm', entryFileNames: 'lifedata-bridges.mjs' });
await bundle.close();
const { parseRegionGraph } = await import(pathToFileURL(`${outDir}/lifedata-bridges.mjs`).href);

let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const city = `${root}public/city/sf`, man = JSON.parse(readFileSync(`${city}/city.json`, 'utf8')), M = man.regionSize * man.tileSize;
const TZ = -480, T0 = Date.parse('2026-11-05T08:00:00-08:00'), MAX = 16384, BIN = 500;
const out = new Float32Array(MAX * ROW), u32 = new Uint32Array(out.buffer), ways = new Int32Array(MAX);
/** The net of the regions within `pad` m of the box (x0, z0, x1, z1). */
const netOf = (x0, z0, x1, z1, pad) => {
  const graphs = [];
  for (const [rx, rz] of man.life.regions) {
    if ((rx + 1) * M < x0 - pad || rx * M > x1 + pad || (rz + 1) * M < z0 - pad || rz * M > z1 + pad) continue;
    let b = readFileSync(`${city}/g_${rx}_${rz}.bin`);
    if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
    graphs.push(parseRegionGraph(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), M));
  }
  graphs.sort((p, q) => p.rx - q.rx || p.rz - q.rz);
  return buildNet(graphs);
};
/**
 * A bridge's deck ways (its drawn deck, a motorway's or a trunk's, in the box), and the cars on them at utcMs: each way's cars by the kilometre along `axis` (0 the
 * map's x, 2 its z), the two carriageways apart by the way they're driven along it.
 */
const bridge = (name, box, axis, utcMs) => {
  const [x0, z0, x1, z1] = box, net = netOf(x0, z0, x1, z1, 2500), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, R = Math.hypot(x1 - x0, z1 - z0) / 2 + 3000;
  // (each way's carriageway by the way it's driven along the axis, 1 + or 2 -; and each carriageway's own reach along it, its ways' starts and their ends as near
  // as a straight deck's are: a start and its length the way it leaves)
  const side = new Uint8Array(net.n), lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  let deckWays = 0;
  for (let w = 0; w < net.n; w++) {
    if (!net.deck[w] || net.cls[w] > 2 || net.link[w] || net.x0[w] < x0 || net.x0[w] > x1 || net.z0[w] < z0 || net.z0[w] > z1) continue;
    const t = net.t0[w * 2 + (axis === 0 ? 0 : 1)], d = t >= 0 ? 0 : 1, a = axis === 0 ? net.x0[w] : net.z0[w], e = a + t * net.len[w];
    side[w] = d + 1;
    deckWays++;
    lo[d] = Math.min(lo[d], a, e);
    hi[d] = Math.max(hi[d], a, e);
  }
  const n = carsOn(net, utcMs, TZ, cx, cz, R, R, 1, out, 0, MAX, undefined, ways);
  // (bins the way it's driven: the first where its cars come on)
  const bins = [0, 1].map((d) => new Array(Math.max(1, Math.floor((hi[d] - lo[d]) / BIN))).fill(0));
  let cars = 0;
  for (let i = 0; i < n; i++) {
    const d = side[ways[i]] - 1;
    if (d < 0) continue;
    const a = out[i * ROW + (axis === 0 ? Col.X : Col.Z)], along = d === 0 ? a - lo[d] : hi[d] - a, b = Math.floor(along / BIN);
    cars++;
    if (b >= 0 && b < bins[d].length) bins[d][b]++;
  }
  const judge = bins.map((b) => {
    const mean = b.reduce((s, c) => s + c, 0) / b.length;
    return { mean: +mean.toFixed(1), least: Math.min(...b), farOverNear: +(b[b.length - 1] / Math.max(1, b[0])).toFixed(2) };
  });
  return { name, rows: n, full: n >= MAX, deckWays, lengthM: [0, 1].map((d) => Math.round(hi[d] - lo[d])), cars, byKm: bins, judge };
};
// (the Bay Bridge's west span and Yerba Buena's, east to the map's edge; the Golden Gate, south to north)
const bay = bridge('Bay Bridge', [1900, -3300, 5632, -900], 0, T0), gate = bridge('Golden Gate', [-6200, -7900, -4600, -4300], 2, T0);
const fine = (b) => !b.full && b.deckWays > 0 && b.cars > 100 && b.judge.every((j) => j.mean > 8 && j.least >= 0.5 * j.mean && j.farOverNear >= 0.6);
row('decks: each carriageway at 08:00 by the 500 m: none under half its own mean, its far end over 0.6 of its near', fine(bay) && fine(gate),
  [bay, gate].map((b) => ({ bridge: b.name, lengthM: b.lengthM, deckWays: b.deckWays, cars: b.cars, byKm: b.byKm, judge: b.judge })));

// ---- same ----
const net = netOf(1900, -3300, 5632, -900, 2500), at = (utcMs) => {
  const n = carsOn(net, utcMs, TZ, 3700, -2100, 5000, 5000, 1, out, 0, MAX);
  return Buffer.from(out.buffer, 0, n * ROW * 4).toString('base64');
};
const a = at(T0 + 60000);
for (let s = 0; s < 60; s++) at(T0 + s * 1000);
const b = at(T0 + 60000);
row('same: the same moment twice, the same cars, after a minute of seconds between', a === b && a.length > 1000, { bytes: a.length });
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
