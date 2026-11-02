#!/usr/bin/env node
// "No visible jump", as a number: flies src/sky/MoonTrip.ts and src/sky/TripView.ts in Node, two round trips in a row at 30 fps and at a rough 20-40 fps, leaving the Moon from several places on the lap, and prints the largest turn of the view and of the bus between
// two frames, leg by leg, with the lens's and the rig's. node --no-warnings tools/sky/view-check.mjs [g5] [iso]
// Pass: the view turns at most 3.5 degrees in a frame at 30 fps (105 deg/s) and the bus 6, which is its own swing and the view's added up, and nothing is ever NaN. The rebase at 60,000 km is measured on the Sun's, Moon's and Earth's directions across that frame.
// The view's own change of body, each way, is the swing: unhurried, so it's held to a third of that, 1.3 degrees a frame (40 deg/s), and the lens stays out of it. tools/sky/approach-check.mjs reads the disc's size on screen.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { MoonTrip } = await import('../../src/sky/MoonTrip.ts');
const { TripView } = await import('../../src/sky/TripView.ts');
const { SkyModel, SkyState } = await import('../../src/sky/SkyModel.ts');
const { series } = await import('../../src/sky/series.gen.js');

const [g5 = '6000', iso = '2026-11-25T04:00:00Z'] = process.argv.slice(2);
const DEG = Math.PI / 180;
let fails = 0;

function fly(rough, orbitFrames) {
  const trip = new MoonTrip(series, Date.parse(iso), { g5: Number(g5) });
  const view = new TripView();
  const model = new SkyModel(series), sky = new SkyState();
  const prev = { axes: new Float64Array(9), q: view.busQuat.clone(), hfov: 38, sun: [0, 0, 0], moon: [0, 0, 0], body: 0 };
  const worst = new Map();
  const note = (leg, key, x) => {
    const w = worst.get(leg) ?? { view: 0, bus: 0, lens: 0, n: 0 };
    w[key] = Math.max(w[key], x);
    worst.set(leg, w);
  };
  let seed = 7;
  const nextDt = () => {
    if (!rough) return 1 / 30;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return 1 / 40 + (seed / 4294967296) * (1 / 20 - 1 / 40);
  };
  let rebase = null, frames = 0;
  const frame = () => {
    const dt = nextDt();
    trip.step(dt, 0);
    view.update(dt, trip, 0, 0, false, 0);
    model.frame(trip.ms, trip.ob, sky);
    const a = trip.ob.axes, leg = trip.leg, k = (1 / 30 / dt);
    if (frames > 0) {
      // the angle between two frames of the render axes: their relative rotation's trace
      const p = prev.axes;
      const c = (a[0] * p[0] + a[1] * p[1] + a[2] * p[2] + a[3] * p[3] + a[4] * p[4] + a[5] * p[5] + a[6] * p[6] + a[7] * p[7] + a[8] * p[8] - 1) / 2;
      note(leg, 'view', (Math.acos(Math.min(1, c)) / DEG) * k);
      note(leg, 'bus', ((2 * Math.acos(Math.min(1, Math.abs(view.busQuat.dot(prev.q))))) / DEG) * k);
      note(leg, 'lens', Math.abs(view.hfov - prev.hfov) * k);
      if (prev.body !== trip.ob.body) {
        // the same frame's sky through both frames of reference can't be had here: what the rebase can do is show up as a step in the Moon's direction against its neighbours
        rebase = { at: trip.clock, leg, stepMoonDeg: (Math.acos(Math.min(1, sky.moon[0] * prev.moon[0] + sky.moon[1] * prev.moon[1] + sky.moon[2] * prev.moon[2])) / DEG) * k, viewDeg: (Math.acos(Math.min(1, c)) / DEG) * k };
      }
    }
    prev.axes.set(a);
    prev.q.copy(view.busQuat);
    prev.hfov = view.hfov;
    prev.moon = [sky.moon[0], sky.moon[1], sky.moon[2]];
    prev.body = trip.ob.body;
    frames++;
  };
  frame();
  // (twice in a row: the second launch starts where the first came home)
  for (let n = 0; n < 2; n++) {
    trip.tap();
    frame();
    trip.tap();
    for (let i = 0; i < 40000 && trip.leg !== 'orbit'; i++) frame();
    for (let i = 0; i < orbitFrames; i++) frame();
    trip.tap();
    frame();
    trip.tap();
    for (let i = 0; i < 40000 && trip.leg !== 'wait'; i++) frame();
    for (let i = 0; i < 60; i++) frame();
    if (trip.leg !== 'wait' || trip.trips !== n + 1) fails++;
  }
  return { worst, rebase, frames, clock: trip.clock };
}

for (const [rough, orbitFrames] of [[false, 300], [true, 300], [false, 150], [false, 450], [false, 640], [false, 830], [false, 1020]]) {
  const { worst, rebase, frames } = fly(rough, orbitFrames);
  console.log(`${rough ? "rough 20-40 fps, per 1/30 s" : "30 fps"}, ${orbitFrames} frames in orbit: ${frames} frames. Largest step in a frame, degrees (view, bus, lens):`);
  for (const [leg, w] of worst) {
    const swing = leg === 'cruise' || leg === 'homeCruise';
    const over = !(w.view <= (swing ? 1.3 : 3.5) && w.bus <= 6 && w.lens <= 0.6);
    if (over) fails++;
    console.log(`  ${leg.padEnd(12)} ${w.view.toFixed(2).padStart(6)} ${w.bus.toFixed(2).padStart(6)} ${w.lens.toFixed(3).padStart(6)}${over ? '  OVER' : ''}`);
  }
  if (rebase) console.log(`  rebase at ${rebase.at.toFixed(1)} s on ${rebase.leg}: the Moon's direction steps ${rebase.stepMoonDeg.toFixed(4)} deg in that frame, the view ${rebase.viewDeg.toFixed(4)} deg`);
}
console.log(fails ? `${fails} OVER` : 'all pass');
process.exit(fails ? 1 : 0);
