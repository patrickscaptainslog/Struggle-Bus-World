#!/usr/bin/env node
// L1 (CONTRACT.md section 7), its Node leg: life's simulation is a function of the place and utcMs. node --no-warnings tools/life/determinism.mjs
//   twice     the same place and moment twice: the same snapshot bytes
//   steps     3,600 steps of a second end where one jump of an hour does (a plane's place is a function of the clock, never a sum of steps)
//   places    two places differ
//   sky       how many scripted planes are up over the place across a day, and the fewest and most at once
//   weather   L7: CLEAR and no weather give the same snapshot
//   people    on a tile of sidewalks: the same twice, an hour's steps where its jump is, every one on a walkable cell and on its ground, none where nothing's walkable
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { scriptedPlanes } = await import('../../src/life/sim/planes.ts');
const { ROW } = await import('../../src/life/kinds.ts');
const { CLEAR } = await import('../../src/life/weather.ts');
const { peopleOn, WALK_CELL } = await import('../../src/life/sim/people.ts');

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
  // (people, on a tile laid out as a city block's sidewalks: every eighth row and column of its 4 m cells walkable, the ground rising 1 m every 40 m)
  const n = 64, walk = new Uint8Array(n * n), h = new Float32Array(n * n);
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
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
