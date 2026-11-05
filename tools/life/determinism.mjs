#!/usr/bin/env node
// L1 (CONTRACT.md section 7), its Node leg: life's simulation is a function of the place and utcMs. node --no-warnings tools/life/determinism.mjs
//   twice     the same place and moment twice: the same snapshot bytes
//   steps     3,600 steps of a second end where one jump of an hour does (a plane's place is a function of the clock, never a sum of steps)
//   places    two places differ
//   sky       how many scripted planes are up over the place across a day, and the fewest and most at once
//   weather   L7: CLEAR and no weather give the same snapshot
//   people    on a tile of sidewalks: the same twice, an hour's steps where its jump is, every one on a walkable cell and on its ground, none where nothing's walkable
//   cars      on San Francisco's own road graphs round the Financial District, as the worker fills them: the same twice and with the regions loaded in another order, ten minutes' steps where
//             the jump is, fewer at 3 am than at 8, every one in a lane of a way cars may drive (never UNDRAWN, NO_CARS or in a tunnel), and no jump or snap of its
//             heading from one moment to the next for 20 s at 50 Hz, round every bend
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { scriptedPlanes } = await import('../../src/life/sim/planes.ts');
const { ROW } = await import('../../src/life/kinds.ts');
const { CLEAR } = await import('../../src/life/weather.ts');
const { peopleOn, WALK_CELL } = await import('../../src/life/sim/people.ts');
const { buildNet, carsOn } = await import('../../src/life/sim/cars.ts');
// (the world's parser, bundled with rolldown as tools/world/graph-check.mjs does: Node's own type stripping refuses its enums)
const { rolldown } = await import('rolldown');
const { gunzipSync } = await import('node:zlib');
const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
const { fileURLToPath, pathToFileURL } = await import('node:url');
const here = fileURLToPath(new URL('.', import.meta.url)), root = fileURLToPath(new URL('../..', import.meta.url)), outDir = `${here}.out`;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/entry.ts`, `export { parseRegionGraph } from '${root.replace(/\\/g, '/')}src/world/lifeData.ts';`);
const bundle = await rolldown({ input: `${outDir}/entry.ts`, platform: 'node', logLevel: 'warn' });
await bundle.write({ dir: outDir, format: 'esm', entryFileNames: 'lifedata.mjs' });
await bundle.close();
const { parseRegionGraph } = await import(pathToFileURL(`${outDir}/lifedata.mjs`).href);

let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(70)} ${JSON.stringify(got)}`);
};
const MAX = 4096, T0 = Date.parse('2026-11-05T17:30:00Z');
const snap = (place, t, reach = 80000, bx = 0, bz = 0, ...weather) => {
  const out = new Float32Array(MAX * ROW), n = scriptedPlanes(place, t, bx, bz, reach, out, 0, MAX, undefined, ...weather);
  return { n, bytes: Buffer.from(out.buffer, 0, n * ROW * 4) };
};
{
  const a = snap('sf', T0), b = snap('sf', T0);
  row('twice: the same place and moment, the same bytes', a.n > 0 && a.bytes.equals(b.bytes), { planes: a.n });
}
{
  // (the clock stepped a second at a time for an hour, and asked each step, against one jump)
  let last = null;
  for (let k = 1; k <= 3600; k++) last = snap('sf', T0 + k * 1000);
  const jump = snap('sf', T0 + 3600 * 1000);
  row('steps: 3,600 one-second steps end where one hour\'s jump does', last.bytes.equals(jump.bytes), { planes: jump.n });
}
{
  const a = snap('sf', T0), b = snap('lagos', T0);
  row('places: two places differ', !a.bytes.equals(b.bytes), { sf: a.n, lagos: b.n });
}
{
  let lo = Infinity, hi = 0, sum = 0, k = 0;
  for (let t = T0; t < T0 + 86400000; t += 300000, k++) {
    const n = snap('sf', t, 150000).n;
    lo = Math.min(lo, n);
    hi = Math.max(hi, n);
    sum += n;
  }
  row('sky: over the place all day, never an empty sky, never a crowd', lo >= 8 && hi <= 60, { fewest: lo, most: hi, mean: +(sum / k).toFixed(1) });
}
{
  // (L7: the weather is an input from the start, held at clear: CLEAR handed in and none give the same sky, at every hour of a day)
  let same = 0, k = 0;
  for (let t = T0; t < T0 + 86400000; t += 3600000, k++) if (snap('sf', t, 150000, 0, 0).bytes.equals(snap('sf', t, 150000, 0, 0, CLEAR).bytes)) same++;
  row('weather: CLEAR and no weather give the same snapshot, every hour of a day', same === k, { same, hours: k });
}
{
  // (people, on a tile laid out as a city block's sidewalks: every eighth row and column of its 2 m cells walkable, the ground rising 1 m every 40 m)
  const n = Math.round(256 / WALK_CELL), walk = new Uint8Array(n * n), h = new Float32Array(n * n);
  let count = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const ok = i % 8 === 0 || j % 8 === 0 ? 1 : 0;
      walk[j * n + i] = ok;
      count += ok;
      h[j * n + i] = 12 + (i * WALK_CELL) / 40;
    }
  const tile = { tx: 3, tz: -2, x0: 768, z0: -512, cell: WALK_CELL, n, walk, h, count };
  const day = Math.floor(T0 / 86400000), out = new Float32Array(MAX * ROW);
  const people = (t, bx = 896, bz = -384, r = 800) => {
    const k = peopleOn(tile, day, t, bx, bz, r, out, 0, MAX);
    return { n: k, bytes: Buffer.from(out.buffer, 0, k * ROW * 4) };
  };
  const a = people(T0), b = people(T0);
  row('people: the same tile and moment twice, the same bytes', a.n > 0 && a.bytes.equals(b.bytes), { people: a.n });
  let last = null;
  for (let k = 1; k <= 3600; k++) last = people(T0 + k * 1000);
  row("people: 3,600 steps of a second end where one hour's jump does", last.bytes.equals(people(T0 + 3600000).bytes), { people: last.n });
  // (every person on a walkable cell, and on its ground, every ten seconds of an hour)
  let off = 0, seen = 0, worstY = 0;
  for (let t = T0; t < T0 + 3600000; t += 10000) {
    const k = peopleOn(tile, day, t, 896, -384, 800, out, 0, MAX);
    for (let q = 0; q < k; q++) {
      const x = out[q * ROW + 2], y = out[q * ROW + 3], z = out[q * ROW + 4], i = Math.floor((x - tile.x0) / WALK_CELL), j = Math.floor((z - tile.z0) / WALK_CELL);
      seen++;
      if (i < 0 || j < 0 || i >= n || j >= n || !walk[j * n + i]) off++;
      worstY = Math.max(worstY, Math.abs(y - (12 + (x - tile.x0) / 40)));
    }
  }
  row('people: every one on a walkable cell and on its ground, every 10 s of an hour', seen > 1000 && off === 0 && worstY < 0.1, { seen, off, worstYm: +worstY.toFixed(3) });
  const none = peopleOn({ ...tile, walk: new Uint8Array(n * n), count: 0 }, day, T0, 896, -384, 800, out, 0, MAX);
  row('people: none on a tile with nowhere to walk, and none past the reach', none === 0 && people(T0, 50000, 50000, 800).n === 0, { none });
}
{
  // (cars on the city's own graphs: the regions within 2.1 km of the Financial District, as the worker loads them, every car in 700 m and fewer on out to 1.2 km)
  const man = JSON.parse(readFileSync(`${root}public/city/sf/city.json`, 'utf8')), M = man.regionSize * man.tileSize, BX = 1700, BZ = -1700, R0 = 700, R = 1200;
  const graphs = [];
  for (const [rx, rz] of man.life.regions) {
    const dx = Math.max(rx * M - BX, 0, BX - (rx + 1) * M), dz = Math.max(rz * M - BZ, 0, BZ - (rz + 1) * M);
    if (Math.hypot(dx, dz) > 2100) continue;
    let b = readFileSync(`${root}public/city/sf/g_${rx}_${rz}.bin`);
    if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
    graphs.push(parseRegionGraph(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), M));
  }
  graphs.sort((p, q) => p.rx - q.rx || p.rz - q.rz);
  const net = buildNet(graphs), tz = -480, out = new Float32Array(MAX * ROW), u32 = new Uint32Array(out.buffer), ways = new Int32Array(MAX);
  const cars = (t, n0 = net, w) => {
    const k = carsOn(n0, t, tz, BX, BZ, R0, R, 1, out, 0, MAX, undefined, w);
    return { n: k, bytes: Buffer.from(out.buffer, 0, k * ROW * 4) };
  };
  // (09:30 in San Francisco)
  const a = cars(T0), b = cars(T0);
  row('cars: the same graphs and moment twice, the same bytes', a.n > 50 && a.bytes.equals(b.bytes), { regions: graphs.length, ways: net.n, cars: a.n });
  // (the regions in another order: the same cars, each where it was, whatever order the rows come in)
  const byKey = (k, src) => {
    const m = new Map();
    for (let q = 0; q < k; q++) m.set(src.u32[q * ROW], Array.from(src.f.subarray(q * ROW + 2, q * ROW + 9)).map((x) => x.toFixed(3)).join());
    return m;
  };
  const first = byKey(a.n, { u32, f: out });
  const back = buildNet([...graphs].reverse()), nb = cars(T0, back).n, second = byKey(nb, { u32, f: out });
  let differ = 0;
  for (const [k, v] of first) if (second.get(k) !== v) differ++;
  row('cars: the regions loaded in another order, the same cars where they were', nb === a.n && differ === 0, { cars: nb, differ });
  let last = null;
  for (let k = 1; k <= 600; k++) last = cars(T0 + k * 1000);
  row("cars: 600 steps of a second end where ten minutes' jump does", last.bytes.equals(cars(T0 + 600000).bytes), { cars: last.n });
  // (the hour: 3 am and 8 am in San Francisco, 11:00Z and 16:00Z, a mean over ten minutes of each)
  const mean = (t) => {
    let s = 0;
    for (let k = 0; k < 10; k++) s += cars(t + k * 60000).n;
    return s / 10;
  };
  const night = mean(Date.parse('2026-11-05T11:00:00Z')), peak = mean(Date.parse('2026-11-05T16:00:00Z'));
  row('cars: by the hour, 3 am a fifth of 8 am or fewer', peak > 200 && night < peak * 0.2, { night, peak });
  // (every car on a way cars may drive, in a lane of it: within its lanes' width and a metre of the way's line)
  let seen = 0, off = 0, worst = 0, banned = 0;
  const near = (g, i, x, z) => {
    const E = g.edges, N = g.nodes, s0 = E.shape[i], s1 = E.shape[i + 1];
    const P = [[N.xyz[E.a[i] * 3], N.xyz[E.a[i] * 3 + 2]]];
    for (let p = s0; p < s1; p++) P.push([g.pts[p * 3], g.pts[p * 3 + 2]]);
    P.push([N.xyz[E.b[i] * 3], N.xyz[E.b[i] * 3 + 2]]);
    let best = Infinity;
    for (let j = 0; j + 1 < P.length; j++) {
      const [ax, az] = P[j], [bx, bz] = P[j + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, f = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      best = Math.min(best, Math.hypot(x - ax - dx * f, z - az - dz * f));
    }
    return best;
  };
  for (let t = T0; t < T0 + 600000; t += 30000) {
    const k = carsOn(net, t, tz, BX, BZ, R0, R, 1, out, 0, MAX, undefined, ways);
    for (let q = 0; q < k; q++) {
      const w = ways[q], g = net.graphs[net.g[w]], i = net.e[w], f = g.edges.flags[i];
      seen++;
      if (f & (2 | 4 | 64)) banned++;
      const d = near(g, i, out[q * ROW + 2], out[q * ROW + 4]), lim = net.lanes[w] * 3.2 + 1;
      worst = Math.max(worst, d);
      if (d > lim) off++;
    }
  }
  row("cars: every one in a lane of a way cars may drive, every 30 s of ten minutes", seen > 1000 && off === 0 && banned === 0, { seen, off, banned, worstM: +worst.toFixed(2) });
  // (from one moment to the next, 20 s at 50 Hz: none jumps past where its speed takes it, a lane's slide in it, nor snaps round, at a bend or anywhere. A jump is
  // the same size at any step and motion isn't: at a 20 ms step a break of 0.3 m stands out from the fastest car's travel)
  let prev = new Map(), pairs = 0, jumps = 0, worstJ = 0, snaps = 0, worstH = 0;
  const DT = 0.02;
  for (let t = T0; t <= T0 + 20000; t += DT * 1000) {
    const k = carsOn(net, t, tz, BX, BZ, R0, R, 1, out, 0, MAX);
    const now = new Map();
    for (let q = 0; q < k; q++) {
      const o = q * ROW, x = out[o + 2], z = out[o + 4], h = out[o + 8], v = Math.hypot(out[o + 5], out[o + 7]), p = prev.get(u32[o]);
      now.set(u32[o], [x, z, h, v]);
      if (!p) continue;
      pairs++;
      // (at the faster of its two moments' speeds, onto a slower way, and a lane's slide over 8 m at the most 60 % of that sideways)
      const j = Math.hypot(x - p[0], z - p[1]) - Math.max(v, p[3]) * DT * 1.17, dh = Math.abs(((h - p[2] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      worstJ = Math.max(worstJ, j);
      worstH = Math.max(worstH, dh);
      if (j > 0.3) jumps++;
      if (dh > 0.25) snaps++;
    }
    prev = now;
  }
  row('cars: no jump past its speed, nor a snap of its heading, 20 s at 50 Hz', pairs > 10000 && jumps === 0 && snaps === 0, { pairs, jumps, worstJumpM: +worstJ.toFixed(2), snaps, worstTurnRad: +worstH.toFixed(2) });
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
