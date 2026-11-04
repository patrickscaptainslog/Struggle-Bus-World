#!/usr/bin/env node
// The page change in the long dark, in Node (docs/specs/earth/EARTHFLIGHT.md, E3): flies src/sky/MoonTrip.ts and src/sky/TripView.ts to the middle of 'cruise', saves both as JSON, resumes them into a fresh
// MoonTrip and TripView made on another clock, and flies the two side by side for 60 s of trip, a carving thumb on both. Then the same from 'homeCruise'. node --no-warnings tools/sky/resume-check.mjs [g5]
// Pass: at every frame the two agree on the leg, to a metre on the position and the velocity's step, and to a hundredth of a degree on the view's axes and the bus's pose; and the saved trip goes through JSON.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { MoonTrip } = await import('../../src/sky/MoonTrip.ts');
const { TripView } = await import('../../src/sky/TripView.ts');
const { series } = await import('../../src/sky/series.gen.js');

const g5 = Number(process.argv[2]) || 1550;
const DT = 1 / 30;
const DEG = 180 / Math.PI;
let fails = 0;

const fresh = (ms) => ({ trip: new MoonTrip(series, ms, { g5, land: true }), view: new TripView() });
const step = ({ trip, view }, i) => {
  // (a thumb carving about the set path, so the view's springs have something to carry)
  view.carveX = Math.sin(i / 40) * 0.8;
  view.carveY = Math.cos(i / 55) * 0.5;
  trip.step(DT, 0, 0);
  view.update(DT, trip, i % 90 < 20 ? 0.01 : 0, 0, i % 90 < 20, 0);
};
const axAngle = (a, b) => {
  let worst = 0;
  for (let r = 0; r < 3; r++) {
    const d = a[r * 3] * b[r * 3] + a[r * 3 + 1] * b[r * 3 + 1] + a[r * 3 + 2] * b[r * 3 + 2];
    worst = Math.max(worst, Math.acos(Math.min(1, d)) * DEG);
  }
  return worst;
};
const qAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w))) * DEG;

function check(name, until) {
  const ms = Date.parse('2026-11-25T04:00:00Z');
  const a = fresh(ms);
  let i = 0;
  step(a, i++);
  a.trip.qaGo();
  for (; i < 200000 && !until(a.trip); i++) {
    step(a, i);
    // (home: once in orbit, leave again)
    if (a.trip.leg === 'orbit' && a.trip.t - a.trip.log.at(-1).at - a.trip.launchedAt > 10) a.trip.qaGo();
  }
  if (!until(a.trip)) throw new Error(`never reached ${name}`);
  const json = JSON.stringify({ trip: a.trip.save(), view: a.view.save() });
  // (another page, another clock: everything that counts comes from the saved trip)
  const b = fresh(ms + 3.6e6);
  const s = JSON.parse(json);
  b.trip.resume(s.trip);
  b.view.resume(s.view);
  let pos = 0, view = 0, bus = 0, legs = 0, clock = 0;
  const leg0 = a.trip.leg, t0 = a.trip.t, h0 = a.trip.hEarth;
  for (let k = 0; k < 60 / DT; k++, i++) {
    step(a, i);
    step(b, i);
    pos = Math.max(pos, Math.hypot(a.trip.r[0] - b.trip.r[0], a.trip.r[1] - b.trip.r[1], a.trip.r[2] - b.trip.r[2]) * 1000);
    view = Math.max(view, axAngle(a.trip.ob.axes, b.trip.ob.axes));
    bus = Math.max(bus, qAngle(a.view.busQuat, b.view.busQuat));
    clock = Math.max(clock, Math.abs(a.trip.ms - b.trip.ms));
    if (a.trip.leg !== b.trip.leg) legs++;
  }
  const ok = pos <= 1 && view <= 0.01 && bus <= 0.01 && !legs && clock === 0;
  if (!ok) fails++;
  console.log(`${name}: saved ${(json.length / 1024).toFixed(1)} KB at ${leg0}, ${t0.toFixed(1)} s, ${Math.round(h0).toLocaleString('en-US')} km up; 60 s on: ${a.trip.leg} and ${b.trip.leg}, ` +
    `worst ${pos.toFixed(6)} m apart, view ${view.toExponential(2)} deg, bus ${bus.toExponential(2)} deg, clock ${clock} ms, legs apart ${legs} frames; ${ok ? 'ok' : 'FAIL'}`);
}

let seen = 0;
check('out', (t) => t.leg === 'cruise' && ++seen > 5 / DT && t.v > 0.5 * g5);
seen = 0;
check('home', (t) => t.leg === 'homeCruise' && ++seen > 5 / DT && t.v > 0.5 * g5);
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
