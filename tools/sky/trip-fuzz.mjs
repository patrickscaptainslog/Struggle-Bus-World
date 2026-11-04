#!/usr/bin/env node
// Players who haven't read anything: node --no-warnings tools/sky/trip-fuzz.mjs [trips=120] [seed=1]
// Flies src/sky/MoonTrip.ts and TripView.ts in Node: a random date in the coming year, a random speed, a rough frame rate, and a thumb and a TURBO that do what they like: taps at any moment, tabs down, the stick held
// over and let go at random, long rests in orbit. Every frame is checked, and a trip fails if it never gets home, comes apart (NaN), dives through a body, or turns the view or the bus in one frame. Prints the worst of each.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { MoonTrip } = await import('../../src/sky/MoonTrip.ts');
const { TripView } = await import('../../src/sky/TripView.ts');
const { series } = await import('../../src/sky/series.gen.js');

const N = Number(process.argv[2] ?? 120);
let seed = Number(process.argv[3] ?? 1) >>> 0;
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const DEG = Math.PI / 180;
const START = Date.parse('2026-11-01T00:00:00Z'), YEAR = 365 * 864e5;
const LEG_LIMIT = { climb: 60, arc: 80, cruise: 140, in: 100, leave: 240, homeCruise: 140, homeIn: 110, homeLevel: 110, homeDrop: 100 };
const worst = { view: [0], bus: [0], lens: [0], hMoon: [1e9], hEarth: [1e9], ground: [1e9], out: [0], home: [0], leg: [0] };
const bump = (k, v, why) => {
  if (v > worst[k][0]) worst[k] = [v, why];
};
const dip = (k, v, why) => {
  if (v < worst[k][0]) worst[k] = [v, why];
};
const failures = [];

for (let n = 0; n < N; n++) {
  const ms = START + rnd() * YEAR, g5 = [3000, 6000, 10000][Math.floor(rnd() * 3)];
  const iso = new Date(ms).toISOString();
  // (every fifth player has come up off the street, climbing on some heading: MoonTrip's `launch`, where the old launch from the street went. Not by rnd(), so the rest fly as they did)
  const launch = n % 5 === 4 ? (n * 37) % 360 : undefined;
  const trip = new MoonTrip(series, ms, { g5, launch });
  const view = new TripView();
  // how this player is: how often they tap TURBO, the tab, and the stick
  const tapEvery = [3, 10, 40, 1e9][Math.floor(rnd() * 4)], tabEvery = [10, 60, 1e9][Math.floor(rnd() * 3)], stickEvery = [2, 8, 30][Math.floor(rnd() * 3)], eggEvery = [1, 6, 30][Math.floor(rnd() * 3)];
  const fps = [60, 30, 20, 0][Math.floor(rnd() * 4)];
  const dtNow = () => (fps ? 1 / fps : 1 / 60 + rnd() * (0.05 - 1 / 60));
  let sx = 0, sy = 0, down = false, stickT = 0;
  const axes = new Float64Array(9), q = view.busQuat.clone();
  let going = false, frames = 0, hfov = 38, legNow = 'wait', legT = 0, restT = 0, nextRest = rnd() * 60, t = 0, out = 0, launched = 0, outAt = 0;
  const say = () => `${iso} g5 ${g5} ${fps || 'rough'} fps tap ${tapEvery} tab ${tabEvery}${launch === undefined ? '' : ` off the street at ${launch}`}`;
  let trips = 0, broken = false;
  for (let i = 0; i < 3e6 && !broken; i++) {
    const dt = dtNow();
    t += dt;
    if (rnd() < dt / tapEvery) trip.tap();
    if (rnd() < dt / tabEvery) trip.shiftDown();
    stickT -= dt;
    if (stickT <= 0) {
      stickT = rnd() * stickEvery;
      down = rnd() < 0.5;
      sx = down ? rnd() * 2 - 1 : 0;
      sy = down ? rnd() * 2 - 1 : 0;
    }
    // (a player who stops: nothing but the label's tap, a beat late, on the legs that ask)
    const leg = trip.leg;
    if (leg !== legNow) {
      going = false;
      if (legNow === 'wait' && leg !== 'wait') launched = t;
      if (leg === 'orbit') {
        out = t - launched;
        bump('out', out, say());
      }
      if (legNow === 'orbit') outAt = t;
      if (leg === 'wait' && trip.trips) {
        bump('home', t - outAt, say());
        trips++;
      }
      legNow = leg;
      legT = 0;
      restT = 0;
      nextRest = rnd() * (leg === 'orbit' ? 120 : 8);
    }
    legT += dt;
    restT += dt;
    if (restT > nextRest && (leg === 'wait' || leg === 'orbit' || leg === 'out' || leg === 'homeOut' || leg === 'leave')) {
      trip.tap();
      restT = 0;
      nextRest = 1 + rnd() * 6;
      going = leg === 'wait';
    }
    // (over Earth the button is flown up to: a player who stops for the label shifts up and holds a full pull until it comes up. The producer, 2026-11-04: "I just want to be able to freely fly")
    if (going && leg === 'wait') {
      down = true;
      sx = 0;
      sy = -1;
    }
    // (and the easter egg, when it's up: a player who sees it presses it, sooner or later)
    if (trip.egg && rnd() < dt / eggEvery) {
      if (trip.egg === 'moon') trip.toMoon();
      else trip.toEarth();
    }
    const lim = LEG_LIMIT[leg];
    if (lim && legT > lim) {
      failures.push(`${say()}: ${leg} ran past ${lim} s at h ${trip.hEarth | 0}/${trip.hMoon | 0}`);
      broken = true;
    }
    bump('leg', leg === 'out' || leg === 'homeOut' ? 0 : legT, `${leg} ${say()}`);
    // (and the yoke, which flies the free legs: over Earth from the floor to the button, docs/specs/earth/EARTHFLIGHT.md)
    trip.step(dt, trip.steering && down ? sx : 0, down ? sy : 0);
    // (the thumb pans as a finger moving at 70 degrees a second at full stretch would, steers the lean where it steers, and carves where it doesn't)
    view.steerX = trip.steering && down ? sx : 0;
    view.carveX = !trip.steering && down ? sx : 0;
    view.carveY = !trip.steering && down ? sy : 0;
    view.update(dt, trip, -sx * 1.22 * dt, sy * 1.22 * dt, down, 0);
    const a = trip.ob.axes, k = 1 / 30 / dt;
    const bad = [...trip.ob.pos, ...a, ...trip.dir, ...trip.heading, view.hfov, view.busQuat.x, view.busQuat.w].some((x) => !Number.isFinite(x));
    if (bad) {
      failures.push(`${say()}: NaN on ${trip.leg} at ${trip.clock.toFixed(1)}`);
      broken = true;
    }
    if (frames > 2) {
      const c = (a[0] * axes[0] + a[1] * axes[1] + a[2] * axes[2] + a[3] * axes[3] + a[4] * axes[4] + a[5] * axes[5] + a[6] * axes[6] + a[7] * axes[7] + a[8] * axes[8] - 1) / 2;
      // (the thumb's own swing is the player's, so the view's limit is read with the thumb off)
      if (!down) {
        const turned = (Math.acos(Math.min(1, c)) / DEG) * k;
        bump('view', turned, `${trip.leg} ${trip.clock.toFixed(1)} ${say()}`);
        if (turned > 6) {
          failures.push(`${say()}: the view turned ${turned.toFixed(1)} degrees in a frame on ${trip.leg} at ${trip.clock.toFixed(1)}`);
          broken = true;
        }
      }
      // (and the bus, thumb or not: 30 degrees a frame is a tumble. The first account's review, 2026-11-04: after TO THE MOON? from a steep climb it turned 85 to 344 a frame, and the fuzz only said so)
      const busTurn = ((2 * Math.acos(Math.min(1, Math.abs(view.busQuat.dot(q))))) / DEG) * k;
      bump('bus', busTurn, `${trip.leg} ${trip.clock.toFixed(1)} ${say()}`);
      if (busTurn > 30) {
        failures.push(`${say()}: the bus turned ${busTurn.toFixed(1)} degrees in a frame on ${trip.leg} at ${trip.clock.toFixed(1)}`);
        broken = true;
      }
      bump('lens', Math.abs(view.hfov - hfov) * k, `${trip.leg} ${say()}`);
    }
    axes.set(a);
    q.copy(view.busQuat);
    hfov = view.hfov;
    frames++;
    if (trip.leg === 'wait') {
      // (free over Earth: never under its floor, over the ellipsoid it's drawn on)
      dip('ground', trip.hGround, `${trip.leg} ${say()}`);
      if (trip.hGround < 0.02) {
        failures.push(`${say()}: under the floor over Earth: ${(trip.hGround * 1000).toFixed(0)} m`);
        broken = true;
      }
    } else {
      dip('hMoon', trip.hMoon, `${trip.leg} ${say()}`);
      dip('hEarth', trip.hEarth, `${trip.leg} ${say()}`);
      if (trip.hMoon < 0 || trip.hEarth < 0) {
        failures.push(`${say()}: through a body on ${trip.leg}: ${trip.hEarth | 0} / ${trip.hMoon | 0}`);
        broken = true;
      }
    }
    if (trips >= 2) break;
  }
  if (trips < 2 && !broken) failures.push(`${say()}: never got home twice, last on ${trip.leg}`);
}
for (const [k, v] of Object.entries(worst)) console.log(k.padEnd(7), typeof v[0] === 'number' ? v[0].toFixed(2) : v[0], v[1] ?? '');
console.log(`${N} players, ${failures.length} failures`);
for (const f of failures.slice(0, 30)) console.log(' ', f);
process.exit(failures.length ? 1 : 0);
