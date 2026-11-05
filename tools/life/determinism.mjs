#!/usr/bin/env node
// L1 (CONTRACT.md section 7), its Node leg: life's simulation is a function of the place and utcMs. node --no-warnings tools/life/determinism.mjs
//   twice     the same place and moment twice: the same snapshot bytes
//   steps     3,600 steps of a second end where one jump of an hour does (a plane's place is a function of the clock, never a sum of steps)
//   places    two places differ
//   sky       how many scripted planes are up over the place across a day, and the fewest and most at once
//   weather   L7: CLEAR and no weather give the same snapshot
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { scriptedPlanes } = await import('../../src/life/sim/planes.ts');
const { ROW } = await import('../../src/life/kinds.ts');
const { CLEAR } = await import('../../src/life/weather.ts');

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
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
