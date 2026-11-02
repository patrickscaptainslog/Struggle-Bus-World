#!/usr/bin/env node
// "It grew", as a number: flies src/sky/MoonTrip.ts and TripView.ts in Node at 3,000, 6,000 and 10,000 km/s and reads the destination on screen every frame, as the page draws it: its size on the lens, on the flight's steady floor, and where the camera has it.
// node --no-warnings tools/sky/approach-check.mjs [out.json] [--tau=12] [--iso=2026-11-25T04:00:00Z] [--w=393]
// Writes every frame's numbers for the plot (tools/sky/approach-plot.py), and prints the worst of each. Pass, from G5's full speed to the end of the way in, both ways:
//  - the disc never shrinks and never jumps: at most 2 % a frame at 30 fps, at most 0.1 % down
//  - no flat stretch: no half second under 0.2 %/s
//  - it stands in the frame, over the bus, from the moment the chase is on the path until it's wider than the frame
// and the camera is the game's: the lens on its 38 degrees on every frame, the bus on the city's row all the way across, the chase on the path.
// The speed never steps: at most 2 % a frame, and it ends on the orbit's 30 km/s at 300 km, level, with no leg between the long dark and the orbit.
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { MoonTrip } = await import('../../src/sky/MoonTrip.ts');
const { TripView } = await import('../../src/sky/TripView.ts');
const { SkyModel, SkyState, moonDrawnKm, R_EARTH_A, R_MOON } = await import('../../src/sky/SkyModel.ts');
const { series } = await import('../../src/sky/series.gen.js');

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = args.find((a) => !a.startsWith('--'));
const tau = Number(opt('tau', 12)), iso = opt('iso', '2026-11-25T04:00:00Z'), W = Number(opt('w', 393)), H = Math.round((W * 852) / 393);
const DT = 1 / 30, DEG = Math.PI / 180;
/** moonrun.ts's STEADY_FLOOR */
const FLOOR = 43;
let fails = 0;
const say = (ok, line) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${line}`);
};

function fly(g5) {
  const trip = new MoonTrip(series, Date.parse(iso), { g5, tau });
  const view = new TripView();
  const model = new SkyModel(series), sky = new SkyState();
  const rows = [];
  const was = new Float64Array(3);
  const frame = () => {
    trip.step(DT, 0);
    view.update(DT, trip, 0, 0, false, 0);
    model.frame(trip.ms, trip.ob, sky);
    const c = Math.min(1, was[0] * trip.dir[0] + was[1] * trip.dir[1] + was[2] * trip.dir[2]), turn = (Math.acos(c) / DEG) / DT;
    was.set(trip.dir);
    const f = W / 2 / Math.tan((view.hfov * DEG) / 2);
    const elong = Math.acos(Math.min(1, sky.sun[0] * sky.moon[0] + sky.sun[1] * sky.moon[1] + sky.sun[2] * sky.moon[2])) / DEG;
    const mR = Math.asin(Math.min(1, moonDrawnKm(sky.moonKm, f, FLOOR, elong, true) / sky.moonKm));
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // where a direction stands on the screen, game px; far off for one behind the lens
    const col = (v) => (v[2] < 0 ? +(W / 2 + (v[0] / -v[2]) * f).toFixed(1) : 1e6), row = (v) => (v[2] < 0 ? +(H / 2 - (v[1] / -v[2]) * f).toFixed(1) : 1e6);
    const way = trip.v < 20 ? trip.heading : trip.dir, a = view.ahead;
    rows.push({
      t: +trip.t.toFixed(3), clock: +trip.clock.toFixed(2), leg: trip.leg, gear: trip.gear, v: +trip.v.toFixed(2), turn: +turn.toFixed(2), hE: +trip.hEarth.toFixed(2), hM: +trip.hMoon.toFixed(2), lens: +view.hfov.toFixed(3), bound: trip.bound,
      moonPx: +(2 * f * Math.tan(mR)).toFixed(2), moonTrue: +(2 * f * Math.tan(sky.moonR)).toFixed(2), earthPx: +(2 * f * Math.tan(sky.earthR)).toFixed(2),
      moonCol: col(sky.moon), moonRow: row(sky.moon), earthCol: col(sky.earth), earthRow: row(sky.earth),
      // how far off the frame's axis: 1 at the frame's nearer edge (the plot starts where this comes under 1)
      moonOff: sky.moon[2] < 0 ? +Math.hypot((sky.moon[0] / -sky.moon[2]) * f / (W / 2), (sky.moon[1] / -sky.moon[2]) * f / (H / 2)).toFixed(3) : 9,
      earthOff: sky.earth[2] < 0 ? +Math.hypot((sky.earth[0] / -sky.earth[2]) * f / (W / 2), (sky.earth[1] / -sky.earth[2]) * f / (H / 2)).toFixed(3) : 9,
      // the bus's row, and how far the chase is off the way the bus goes, degrees
      busRow: +(H / 2 + f * Math.tan(view.below)).toFixed(1), off: +(Math.acos(Math.min(1, a.x * way[0] + a.y * way[1] + a.z * way[2])) / DEG).toFixed(2),
      dive: trip.leg === 'wait' ? 0 : +((Math.asin(Math.max(-1, Math.min(1, -dot(trip.dir, trip.rm) / Math.hypot(...trip.rm)))) / DEG)).toFixed(2),
    });
  };
  frame();
  trip.tap();
  frame();
  trip.tap();
  for (let i = 0; i < 40000 && trip.leg !== 'orbit'; i++) frame();
  for (let i = 0; i < 300; i++) frame();
  trip.tap();
  frame();
  trip.tap();
  for (let i = 0; i < 40000 && trip.leg !== 'wait'; i++) frame();
  for (let i = 0; i < 90; i++) frame();
  return rows;
}

/** One way in, from G5's full speed to the end of the way in. */
function growth(rows, key, name) {
  const n = rows.length;
  let up = 0, down = 0, flat = 0, flatLong = 0, flatTop = 0;
  for (let i = 1; i < n; i++) {
    const a = rows[i - 1][key], b = rows[i][key], r = b / a - 1;
    // past the frame's height the disc is the horizon's job
    if (b > 852) break;
    up = Math.max(up, r);
    down = Math.min(down, r);
    if (r / DT < 0.002) {
      flat += DT;
      if (flat > flatLong) {
        flatLong = flat;
        flatTop = b;
      }
    } else flat = 0;
  }
  say(up < 0.02, `${name}: the fastest frame adds ${(up * 100).toFixed(2)} %`);
  say(down > -0.001, `${name}: the worst drop is ${(down * 100).toFixed(3)} % in a frame`);
  say(flatLong <= 0.5, `${name}: the longest flat stretch is ${flatLong.toFixed(1)} s, at ${flatTop.toFixed(0)} px`);
}

/** The disc from the moment it's in frame until it's wider than the frame: in the frame, and over the bus. */
function frame(rows, key, name) {
  const c = key === 'moonPx' ? 'moonCol' : 'earthCol', r = key === 'moonPx' ? 'moonRow' : 'earthRow';
  let top = 1e9, low = -1e9, wide = 0, n = 0;
  for (const x of rows) {
    if (x[key] >= W) break;
    n++;
    top = Math.min(top, x[r]);
    low = Math.max(low, x[r] - x.busRow);
    wide = Math.max(wide, Math.abs(x[c] - W / 2));
  }
  say(n > 0 && top > 0 && low < 0 && wide < W / 2, `${name}: ${(n * DT).toFixed(0)} s in frame: its middle no higher than row ${top.toFixed(0)}, at least ${(-low).toFixed(0)} px over the bus, at most ${wide.toFixed(0)} px off the middle column`);
}

const all = {};
for (const g5 of [3000, 6000, 10000]) {
  const rows = fly(g5);
  all[g5] = rows;
  console.log(`--- G5 ${g5} km/s, tau ${tau} s`);
  const at = (i) => rows[i];
  const launched = rows.findIndex((r) => r.leg !== 'wait'), inAt = rows.findIndex((r) => r.leg === 'in'), orbitAt = rows.findIndex((r) => r.leg === 'orbit');
  const lit = rows.findIndex((r) => r.leg === 'cruise'), full = rows.findIndex((r) => r.leg === 'cruise' && r.v >= g5 * 0.5);
  const leftAt = rows.findIndex((r) => r.leg === 'leave'), homeAt = rows.findIndex((r) => r.leg === 'homeIn'), restAt = rows.findIndex((r, i) => i > leftAt && r.leg === 'wait');
  const litHome = rows.findIndex((r) => r.leg === 'homeCruise'), fullHome = rows.findIndex((r) => r.leg === 'homeCruise' && r.v >= g5 * 0.5);
  // the chase has come round to the path, and what the path points at is there
  const onMoon = rows.findIndex((r, i) => i > launched && r.off < 3 && r.moonRow > 0 && r.moonRow < r.busRow);
  const onEarth = rows.findIndex((r, i) => i > leftAt && r.off < 3 && r.earthRow > 0 && r.earthRow < r.busRow);
  console.log(`  launch at ${at(launched).t.toFixed(1)} s. The Moon is in frame ahead of the bus ${(at(onMoon).t - at(launched).t).toFixed(1)} s on, at (${at(onMoon).moonCol}, ${at(onMoon).moonRow}), ${at(onMoon).moonPx.toFixed(1)} px. G5 lit at ${at(lit).t.toFixed(1)} s`);
  console.log(`  the way in: from ${at(inAt).hM.toFixed(0)} km at ${at(inAt).v.toFixed(0)} km/s, ${at(inAt).moonPx.toFixed(0)} px, ${(at(orbitAt).t - at(inAt).t).toFixed(1)} s to the floor`);
  say(Math.abs(at(orbitAt).hM - 300) < 0.1 && Math.abs(at(orbitAt).v - 30) < 0.2 && Math.abs(at(orbitAt).dive) < 1.2, `the floor: ${at(orbitAt).hM.toFixed(3)} km, ${at(orbitAt).v.toFixed(2)} km/s, dive ${at(orbitAt).dive.toFixed(2)} degrees`);
  const between = new Set(rows.slice(lit, orbitAt).map((r) => r.leg));
  say([...between].join() === 'cruise,in', `legs from G5 to the orbit: ${[...between].join(', ')}`);
  let vStep = 0, vUp = 0, turn = 0;
  for (let i = inAt + 1; i < orbitAt; i++) {
    const a = rows[i - 1], b = rows[i];
    vStep = Math.min(vStep, b.v / a.v - 1);
    vUp = Math.max(vUp, b.v / a.v - 1);
    turn = Math.max(turn, Math.abs(b.dive - a.dive) / DT);
  }
  say(vStep > -0.02 && vUp < 1e-6 && turn < 4, `speed on the way in: at most ${(-vStep * 100).toFixed(2)} % down a frame, ${(vUp * 100).toFixed(4)} % up; the dive turns at most ${turn.toFixed(2)} deg/s`);
  frame(rows.slice(onMoon, orbitAt), 'moonPx', 'Moon');
  growth(rows.slice(Math.max(onMoon, full), orbitAt), 'moonPx', 'Moon');
  console.log(`  home: left at ${at(leftAt).t.toFixed(1)} s. Earth is in frame ahead of the bus ${(at(onEarth).t - at(leftAt).t).toFixed(1)} s on, at (${at(onEarth).earthCol}, ${at(onEarth).earthRow}), ${at(onEarth).earthPx.toFixed(1)} px. G5 lit at ${at(litHome).t.toFixed(1)} s`);
  console.log(`  the way home: from ${at(homeAt).hE.toFixed(0)} km at ${at(homeAt).v.toFixed(0)} km/s, ${at(homeAt).earthPx.toFixed(0)} px, ${(at(restAt).t - at(homeAt).t).toFixed(1)} s to rest over home`);
  frame(rows.slice(onEarth, restAt), 'earthPx', 'Earth');
  growth(rows.slice(Math.max(onEarth, fullHome), restAt).filter((r) => r.earthPx < 800), 'earthPx', 'Earth');
  let v2 = 0, v3 = 0, bend = 0;
  for (let i = homeAt + 1; i < restAt; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.v > 5) v2 = Math.min(v2, b.v / a.v - 1);
    v3 = Math.max(v3, b.v / a.v - 1);
    if (b.v > 60) bend = Math.max(bend, b.turn);
  }
  say(v2 > -0.05 && v3 < 1e-6 && bend < 21, `speed coming home: at most ${(-v2 * 100).toFixed(2)} % down a frame, ${(v3 * 100).toFixed(4)} % up; the path turns at most ${bend.toFixed(1)} deg/s over 60 km/s`);
  // the camera
  const lensLo = Math.min(...rows.map((r) => r.lens)), lensHi = Math.max(...rows.map((r) => r.lens));
  say(lensLo === 38 && lensHi === 38, `the lens: ${lensLo} to ${lensHi} degrees, on every frame of the flight`);
  const across = rows.filter((r) => r.leg === 'cruise' || r.leg === 'homeCruise' || (r.leg === 'in' && r.hM > 3000) || (r.leg === 'homeIn' && r.hE > 3000));
  const busLo = Math.min(...across.map((r) => r.busRow)), busHi = Math.max(...across.map((r) => r.busRow)), offLong = Math.max(...across.map((r) => r.off));
  say(busHi - busLo < 0.5, `the bus all the way across: row ${busLo} to ${busHi} of ${H}`);
  say(offLong < 1, `the chase all the way across: at most ${offLong.toFixed(2)} degrees off the path`);
}
if (out) writeFileSync(out, JSON.stringify({ tau, iso, W, H, flights: all }));
console.log(fails ? `${fails} FAILED` : 'all pass');
console.log(`(Moon ${R_MOON} km, Earth ${R_EARTH_A} km)`);
process.exit(fails ? 1 : 0);
