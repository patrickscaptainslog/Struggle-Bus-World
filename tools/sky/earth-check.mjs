#!/usr/bin/env node
// The free leg over the plain Earth (docs/specs/earth/EARTHFLIGHT.md, E1), in Node: node --no-warnings tools/sky/earth-check.mjs
//   gears    over home, flicks down to Cruise and its speed is Cruise's
//   down     from 300 km a held push in Rainbow Warp, braked by the law, levels at Warp's floor; Jet's, then Cruise's, each a gear down, never under the floor
//   drift    an hour at Cruise and its floor: the ground it covers is Cruise's speed for an hour, and the height holds (Earth fixed: the Earth turns under EQJ)
//   pole     turned north and flown in Rainbow Warp over the pole and down the other side, nothing comes apart
//   button   a full pull in Rainbow Warp to the ceiling puts TO THE MOON? up; a push takes it under 10,000 km and the button goes; at the top gear a flick up does nothing, and a pull puts it up again
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { MoonTrip, rungV } = await import('../../src/sky/MoonTrip.ts');
const { series } = await import('../../src/sky/series.gen.js');

const DT = 1 / 30, DEG = Math.PI / 180;
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(74)} ${JSON.stringify(got)}`);
};
const trip = new MoonTrip(series, Date.parse('2026-11-25T04:00:00Z'), { g5: 1550 });
const ok = () => [...trip.ob.pos, ...trip.dir, ...trip.heading].every(Number.isFinite);
/** n seconds of flight with the stick and the yoke as given; returns the least height over the ground, km */
const fly = (s, stick = 0, yoke = 0, each) => {
  let low = Infinity;
  for (let i = 0; i < s / DT; i++) {
    trip.step(DT, stick, yoke);
    low = Math.min(low, trip.hGround);
    each?.();
  }
  return low;
};
const latOf = () => Math.asin(trip.ef[2] / Math.hypot(...trip.ef)) / DEG;

fly(2);
row('start: free over home, 300 km up, in Rainbow Warp', trip.leg === 'wait' && Math.abs(trip.hEarth - 300) < 1 && trip.rung === 5, { leg: trip.leg, km: +trip.hEarth.toFixed(1), rung: trip.rung });

// ---- gears
for (let i = 0; i < 5; i++) {
  trip.shiftDown();
  fly(0.5);
}
fly(3);
row('gears: five flicks down are Cruise, at its speed', trip.rung === 0 && Math.abs(trip.v * 1000 - rungV(0) * 1000) < 0.5, { rung: trip.rung, ms: +(trip.v * 1000).toFixed(1) });
for (let i = 0; i < 5; i++) {
  trip.tap();
  fly(0.5);
}
fly(6);
row('gears: and five back up are Rainbow Warp', trip.rung === 5 && Math.abs(trip.v - 30) < 0.3, { rung: trip.rung, kms: +trip.v.toFixed(2) });

// ---- down, a floor a gear
let overLaw = 0;
const lawAt = (h) => 0.45 + Math.max(h - 2, 0) / ((300 - 2) / (30 - 0.45));
const low1 = fly(90, 0, 1, () => {
  if (trip.nose < -0.05) overLaw = Math.max(overLaw, trip.v - lawAt(trip.hGround) * 1.05 - 0.05);
});
row("down: a held push in Rainbow Warp, braked by the law, levels at Warp's 10 km floor", low1 > 9.5 && trip.hGround < 10.6 && overLaw <= 0, { low: +low1.toFixed(2), now: +trip.hGround.toFixed(2), overLaw: +overLaw.toFixed(3), kms: +trip.v.toFixed(2) });
trip.shiftDown();
fly(0.3, 0, 1);
trip.shiftDown();
fly(0.3, 0, 1);
const low2 = fly(60, 0, 1);
row("down: two gears down, Jet's floor, 150 m", trip.rung === 3 && low2 > 0.14 && trip.hGround < 0.3, { rung: trip.rung, low: +(low2 * 1000).toFixed(0), now: +(trip.hGround * 1000).toFixed(0) });
for (let i = 0; i < 3; i++) {
  trip.shiftDown();
  fly(0.3, 0, 1);
}
const low3 = fly(30, 0, 1);
row("down: Cruise's floor, 60 m, and never under it", trip.rung === 0 && low3 > 0.055 && trip.hGround < 0.1, { rung: trip.rung, low: +(low3 * 1000).toFixed(0), now: +(trip.hGround * 1000).toFixed(0), ms: +(trip.v * 1000).toFixed(1) });

// ---- drift: an hour at Cruise, low
fly(5);
let path = 0, lo = Infinity, hi = -Infinity;
const prev = Float64Array.from(trip.ef);
fly(3600, 0, 0, () => {
  path += Math.hypot(trip.ef[0] - prev[0], trip.ef[1] - prev[1], trip.ef[2] - prev[2]);
  prev.set(trip.ef);
  lo = Math.min(lo, trip.hGround);
  hi = Math.max(hi, trip.hGround);
});
const want = rungV(0) * 3600;
row('drift: an hour at Cruise covers Cruise\'s hour of ground, and the height holds', Math.abs(path / want - 1) < 0.01 && hi - lo < 0.002 && ok(), { km: +path.toFixed(2), want: +want.toFixed(2), heightM: [+(lo * 1000).toFixed(1), +(hi * 1000).toFixed(1)] });

// ---- over the pole
for (let i = 0; i < 5; i++) {
  trip.tap();
  fly(0.3);
}
fly(30, 0, -1);
// (turn north: the heading's share of Earth's axis, at this place)
const north = () => {
  const u = trip.ef.map((x) => x / Math.hypot(...trip.ef)), h = trip.eh, n = [-u[0] * u[2], -u[1] * u[2], 1 - u[2] * u[2]], l = Math.hypot(...n);
  return (h[0] * n[0] + h[1] * n[1] + h[2] * n[2]) / l;
};
for (let i = 0; i < 20000 && north() < 0.99995; i++) trip.step(DT, north() < 0.99 ? 0.5 : 0.02, 0);
let maxLat = -90, crossed = false;
fly(400, 0, 0, () => {
  const l = latOf();
  maxLat = Math.max(maxLat, l);
  if (maxLat > 89 && l < 80) crossed = true;
});
row('pole: north in Rainbow Warp, over the pole and down the other side, whole', crossed && ok() && trip.hGround > 9, { maxLat: +maxLat.toFixed(2), lat: +latOf().toFixed(1), km: +trip.hGround.toFixed(1), finite: ok() });

// ---- the button
const upAt = fly(600, 0, -1);
row('button: a full pull in Rainbow Warp to the ceiling, and TO THE MOON? is up', trip.hEarth > 12900 && trip.egg === 'moon', { km: Math.round(trip.hEarth), egg: trip.egg, low: +upAt.toFixed(1) });
fly(200, 0, 1);
row('button: a push takes it back under 10,000 km and the button goes', trip.hEarth < 10000 && trip.egg === null && trip.leg === 'wait', { km: Math.round(trip.hEarth), egg: trip.egg });
// (the producer, 2026-11-04: "I do not like the flick up to climb function". At the top gear a flick up does nothing: the bus flies on free, and the button is flown up to)
const h0 = trip.hEarth;
let left = 0;
trip.tap();
fly(10, 0, 0, () => (left += trip.leg !== 'wait'));
row('button: at the top gear a flick up does nothing, the bus flies on free', !left && trip.rung === 5 && trip.hEarth <= h0 + 1 && trip.egg === null && ok(), { left, rung: trip.rung, km: Math.round(trip.hEarth), was: Math.round(h0) });
fly(600, 0, -1);
row('button: and a pull back up to the ceiling puts it up again', trip.hEarth > 12900 && trip.egg === 'moon' && trip.leg === 'wait', { km: Math.round(trip.hEarth), egg: trip.egg });

console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
