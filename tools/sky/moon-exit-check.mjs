#!/usr/bin/env node
// Leaving the Moon as Earth is left (the producer, 2026-11-04: "Can you also apply this same mechanics and user experience to exiting the moon?"), in Node: node --no-warnings tools/sky/moon-exit-check.mjs
//   orbit    a trip that can land comes into the orbit in Rainbow Warp
//   gears    the street's ladder there: eight flicks down are Stratos, Turbo 3, 2 and 1, Jet, Nonstop, Express and Cruise, and eight back up Rainbow Warp, the turbos at the street's speeds
//   top      at the top a flick up does nothing: no climb to the button
//   pull     a pull held climbs out of the orbit, free; at 2,000 km TO PLANET EARTH? is up, and the bus flies on up to 3,500 km; a push back under 1,500 and it goes
//   home     a pull back up, a tap on it, and the trip goes home to Earth
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { MoonTrip, rungV } = await import('../../src/sky/MoonTrip.ts');
const { series } = await import('../../src/sky/series.gen.js');

const DT = 1 / 30;
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(74)} ${JSON.stringify(got)}`);
};
const trip = new MoonTrip(series, Date.parse('2026-11-25T04:00:00Z'), { g5: 1550, land: true });
const ok = () => [...trip.ob.pos, ...trip.dir, ...trip.heading].every(Number.isFinite);
/** n seconds of flight with the yoke as given, or until `until` says stop; each, a look every frame */
const fly = (s, yoke = 0, until, each) => {
  let i = 0;
  for (; i < s / DT && !until?.(); i++) {
    trip.step(DT, 0, yoke);
    each?.();
  }
  return i * DT;
};
const step = () => `${trip.rung}${trip.level ? `+${trip.level}` : ''}`;

// ---- to the Moon's orbit
fly(2);
trip.qaGo();
const out = fly(1200, 0, () => trip.leg === 'orbit');
fly(5);
row('orbit: a trip that can land comes into the orbit in Rainbow Warp', trip.leg === 'orbit' && trip.rung === 5 && !trip.level && Math.abs(trip.v - 30) < 0.3 && Math.abs(trip.hMoon - 300) < 2, { leg: trip.leg, rung: trip.rung, kms: +trip.v.toFixed(2), km: +trip.hMoon.toFixed(1), outS: Math.round(out) });

// ---- the street's ladder in the orbit
const said = [];
for (let i = 0; i < 8; i++) {
  trip.shiftDown();
  fly(0.5);
  said.push(step());
}
fly(3);
row('gears: eight flicks down in the orbit are Stratos, the three turbos, Jet, and on to Cruise', said.join(' ') === '4 3+3 3+2 3+1 3 2 1 0' && trip.leg === 'orbit' && Math.abs(trip.v * 1000 - rungV(0) * 1000) < 0.5, { said: said.join(' '), ms: +(trip.v * 1000).toFixed(1) });
const turboV = [];
for (let i = 0; i < 8; i++) {
  trip.tap();
  fly(i >= 3 && i <= 6 ? 8 : 0.5);
  if (trip.level) turboV.push(Math.round(trip.v * 1000));
}
fly(6);
row("gears: and eight back up are Rainbow Warp, the turbos at the street's speeds", trip.rung === 5 && !trip.level && trip.leg === 'orbit' && Math.abs(trip.v - 30) < 0.3 && turboV.join(' ') === [1.3, 1.6, 2].map((x) => Math.round(rungV(3) * 1000 * x)).join(' '), { rung: trip.rung, kms: +trip.v.toFixed(2), turboMs: turboV });

// ---- at the top a flick up does nothing
let left = 0;
trip.tap();
fly(10, 0, undefined, () => (left += trip.leg !== 'orbit'));
row('top: in the orbit at the top gear a flick up does nothing, no climb to the button', !left && trip.rung === 5 && trip.egg === null && Math.abs(trip.hMoon - 300) < 2, { left, leg: trip.leg, km: +trip.hMoon.toFixed(1), egg: trip.egg });

// ---- a held pull out of the orbit, free, up to the button and past it
const pulledOut = fly(2, -1, () => trip.leg !== 'orbit');
let upAt = null, top = 0;
fly(600, -1, undefined, () => {
  if (upAt === null && trip.egg === 'earth') upAt = Math.round(trip.hMoon);
  top = Math.max(top, trip.hMoon);
});
row('pull: a pull held leaves the orbit, free, and at 2,000 km TO PLANET EARTH? is up', trip.leg === 'fall' && pulledOut < 1 && upAt >= 2000 && upAt < 2040 && trip.egg === 'earth', { leg: trip.leg, outS: +pulledOut.toFixed(2), upAt, egg: trip.egg });
row('pull: and it flies on up to 3,500 km, levelled off there', Math.abs(top - 3500) < 5 && Math.abs(trip.hMoon - 3500) < 5 && ok(), { top: Math.round(top), km: Math.round(trip.hMoon) });
let goneAt = null;
fly(600, 1, () => trip.egg === null, () => {
  if (goneAt === null && trip.egg === null) goneAt = Math.round(trip.hMoon);
});
goneAt ??= Math.round(trip.hMoon);
row('pull: a push back down, and under 1,500 km the button goes', trip.leg === 'fall' && trip.egg === null && goneAt <= 1500 && goneAt > 1460, { goneAt, egg: trip.egg });
let inFall = 0;
trip.tap();
fly(5, 0, undefined, () => (inFall += trip.leg !== 'fall'));
row('top: free over the Moon at the top gear a flick up does nothing', !inFall && trip.rung === 5 && trip.leg === 'fall', { left: inFall, rung: trip.rung });

// ---- home
const again = fly(600, -1, () => trip.egg === 'earth');
trip.toEarth();
const leftAs = trip.leg;
const home = fly(1800, 0, () => trip.leg === 'wait');
row('home: a pull back up to the button, a tap on it, and the trip goes home to Earth', trip.egg === null && leftAs === 'leave' && trip.leg === 'wait' && Math.abs(trip.hEarth - 300) < 2 && ok(), { againS: Math.round(again), leftAs, homeMin: +(home / 60).toFixed(2), leg: trip.leg, km: +trip.hEarth.toFixed(1) });

console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
