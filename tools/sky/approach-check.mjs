#!/usr/bin/env node
// "It grew", as a number: flies src/sky/MoonTrip.ts and TripView.ts in Node at 3,000, 6,000 and 10,000 km/s and reads the destination's size on screen every frame, as the page draws it: the true size on the frame's lens, under the far floor.
// node --no-warnings tools/sky/approach-check.mjs [out.json] [--tau=12] [--iso=2026-11-25T04:00:00Z] [--w=393]
// Writes every frame's numbers for the plot (tools/sky/approach-plot.py), and prints the worst of each. Pass, from the moment the view is on the destination to the end of the way in, both ways:
//  - the disc never shrinks and never jumps: at most 2 % a frame at 30 fps, at most 0.1 % down
//  - no flat stretch: a stretch under 0.2 %/s lasts no longer than the floor does
//  - the view is on the destination, inside the frame, while the disc is under the frame's width
// and the speed never steps: at most 2 % a frame, and it ends on the orbit's 30 km/s at 300 km, level, with no leg between the long dark and the orbit.
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
const { busPx, busRig, busSize } = await import('../../src/game/busSize.ts');
const { series } = await import('../../src/sky/series.gen.js');

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = args.find((a) => !a.startsWith('--'));
const tau = Number(opt('tau', 12)), iso = opt('iso', '2026-11-25T04:00:00Z'), W = Number(opt('w', 393)), H = Math.round((W * 852) / 393);
const DT = 1 / 30, DEG = Math.PI / 180;
let fails = 0;
const say = (ok, line) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${line}`);
};

function fly(g5) {
  const trip = new MoonTrip(series, Date.parse(iso), { g5, tau });
  const view = new TripView();
  view.width = W;
  view.height = H;
  const model = new SkyModel(series), sky = new SkyState();
  const rows = [];
  const frame = () => {
    trip.step(DT, 0);
    view.update(DT, trip, 0, 0, false, 0);
    model.frame(trip.ms, trip.ob, sky);
    const f = W / 2 / Math.tan((view.hfov * DEG) / 2);
    const elong = Math.acos(Math.min(1, sky.sun[0] * sky.moon[0] + sky.sun[1] * sky.moon[1] + sky.sun[2] * sky.moon[2])) / DEG;
    const mR = Math.asin(Math.min(1, moonDrawnKm(sky.moonKm, f, 15, elong) / sky.moonKm));
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    rows.push({
      t: +trip.t.toFixed(3), clock: +trip.clock.toFixed(2), leg: trip.leg, gear: trip.gear, v: +trip.v.toFixed(2), hE: +trip.hEarth.toFixed(2), hM: +trip.hMoon.toFixed(2), lens: +view.hfov.toFixed(3), target: view.target,
      moonPx: +(2 * f * Math.tan(mR)).toFixed(2), moonTrue: +(2 * f * Math.tan(sky.moonR)).toFixed(2), earthPx: +(2 * f * Math.tan(sky.earthR)).toFixed(2),
      // how far off the frame's axis: 1 at the frame's nearer edge
      moonOff: sky.moon[2] < 0 ? +Math.hypot((sky.moon[0] / -sky.moon[2]) * f / (W / 2), (sky.moon[1] / -sky.moon[2]) * f / (H / 2)).toFixed(3) : 9,
      earthOff: sky.earth[2] < 0 ? +Math.hypot((sky.earth[0] / -sky.earth[2]) * f / (W / 2), (sky.earth[1] / -sky.earth[2]) * f / (H / 2)).toFixed(3) : 9,
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

/** One way in, from the view's arrival on the body to the end of the way in. */
function growth(rows, key, name) {
  const dead = key === 'moonPx' ? 15 : 0;
  const n = rows.length, off = key === 'moonPx' ? 'moonOff' : 'earthOff';
  let wide = 0;
  for (const r of rows) if (r[key] < W) wide = Math.max(wide, r[off]);
  say(wide < 0.6, `${name}: while it's narrower than the frame it stays in the middle of it, at most ${wide.toFixed(2)} of the way to the edge`);
  let up = 0, down = 0, flat = 0, flatLong = 0, flatTop = 0, floorS = 0;
  for (let i = 1; i < n; i++) {
    const a = rows[i - 1][key], b = rows[i][key], r = b / a - 1;
    // past the frame's height the disc is the horizon's job, and the view is pinning it
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
    if (dead && rows[i].moonTrue < dead) floorS += DT;
  }
  say(up < 0.02, `${name}: the fastest frame adds ${(up * 100).toFixed(2)} %`);
  say(down > -0.001, `${name}: the worst drop is ${(down * 100).toFixed(3)} % in a frame`);
  say(flatLong <= floorS + 0.5, `${name}: the longest flat stretch is ${flatLong.toFixed(1)} s, at ${flatTop.toFixed(0)} px; the true size is under the floor for ${floorS.toFixed(1)} s of this`);
}

const all = {};
for (const g5 of [3000, 6000, 10000]) {
  const rows = fly(g5);
  all[g5] = rows;
  console.log(`--- G5 ${g5} km/s, tau ${tau} s`);
  // the view's change of body, each way
  const toMoon = rows.findIndex((r) => r.target === 1), inAt = rows.findIndex((r) => r.leg === 'in'), orbitAt = rows.findIndex((r) => r.leg === 'orbit');
  const onMoon = rows.findIndex((r, i) => i > toMoon && r.moonOff < 0.3);
  const lit = rows.findIndex((r) => r.leg === 'cruise');
  const leftAt = rows.findIndex((r) => r.leg === 'leave');
  const toEarth = rows.findIndex((r, i) => i > leftAt && r.target === 0), homeIn = rows.findIndex((r) => r.leg === 'homeIn'), restAt = rows.findIndex((r, i) => i > leftAt && r.leg === 'wait');
  const onEarth = rows.findIndex((r, i) => i > toEarth && r.earthOff < 0.3);
  const litHome = rows.findIndex((r) => r.leg === 'homeCruise');
  const at = (i) => rows[i];
  console.log(`  G5 lit at ${at(lit).t.toFixed(1)} s, Earth ${at(lit).earthPx.toFixed(0)} px. The view leaves it ${(at(toMoon).t - at(lit).t).toFixed(1)} s on, at ${at(toMoon).earthPx.toFixed(0)} px; the Moon is on the frame's middle ${(at(onMoon).t - at(toMoon).t).toFixed(1)} s after that, at ${at(onMoon).hM.toFixed(0)} km, ${at(onMoon).moonPx.toFixed(1)} px`);
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
  say(vStep > -0.02 && vUp < 1e-6, `speed on the way in: at most ${(-vStep * 100).toFixed(2)} % down a frame, ${(vUp * 100).toFixed(4)} % up; the dive turns at most ${turn.toFixed(2)} deg/s`);
  growth(rows.slice(onMoon, orbitAt), 'moonPx', 'Moon');
  console.log(`  home: G5 lit at ${at(litHome).t.toFixed(1)} s, the Moon ${at(litHome).moonPx.toFixed(0)} px. The view left it at ${at(toEarth).t.toFixed(1)} s, at ${at(toEarth).moonPx.toFixed(0)} px, ${at(toEarth).hM.toFixed(0)} km; Earth on the frame's middle ${(at(onEarth).t - at(toEarth).t).toFixed(1)} s on`);
  console.log(`  the way home: from ${at(homeIn).hE.toFixed(0)} km at ${at(homeIn).v.toFixed(0)} km/s, ${at(homeIn).earthPx.toFixed(0)} px, ${(at(restAt).t - at(homeIn).t).toFixed(1)} s to rest over home`);
  growth(rows.slice(Math.max(onEarth, litHome), restAt).filter((r) => r.earthPx < 800), 'earthPx', 'Earth');
  let v2 = 0, v3 = 0;
  for (let i = homeIn + 1; i < restAt; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.v > 5) v2 = Math.min(v2, b.v / a.v - 1);
    v3 = Math.max(v3, b.v / a.v - 1);
  }
  say(v2 > -0.05 && v3 < 1e-6, `speed coming home: at most ${(-v2 * 100).toFixed(2)} % down a frame, ${(v3 * 100).toFixed(4)} % up`);
}
// the bus's size on screen: as it was to about 1 km, about twice the far size at 15 km, the far size from 100 km up, in one smooth curve
{
  const L = 17.95, f38 = W / 2 / Math.tan(19 * DEG), near = (f38 * L * 1.55) / 270;
  const rig = { px: 0, hero: 1, distance: 270 };
  console.log('--- the bus');
  for (const h of [0, 0.3, 1, 3, 5, 10, 15, 30, 50, 100, 300, 13000, 380000]) {
    busRig(h, f38, W, L, rig);
    console.log(`  ${String(h).padStart(7)} km: ${rig.px.toFixed(1).padStart(5)} px, scale ${rig.hero.toFixed(2)}, the camera ${Math.round(rig.distance)} m back`);
  }
  let step = 0, up = 0, a = busPx(0.01, near);
  for (let h = 0.01; h < 500; h *= 1.02) {
    const b = busPx(h, near);
    step = Math.max(step, Math.abs(b / a - 1));
    up = Math.max(up, b - a);
    a = b;
  }
  say(busPx(1, near) > near * 0.97 && Math.abs(busPx(15, near) - busSize.midPx) < 0.5 && busPx(100, near) < busSize.farPx * 1.05 && up <= 0 && step < 0.03, `as today to 1 km, ${busPx(1, near).toFixed(1)} of ${near.toFixed(1)} px; ${busPx(15, near).toFixed(1)} px at 15 km; ${busPx(100, near).toFixed(1)} px at 100 km; it only ever falls, at most ${(step * 100).toFixed(1)} % for each 2 % of height`);
}
if (out) writeFileSync(out, JSON.stringify({ tau, iso, W, H, flights: all }));
console.log(fails ? `${fails} FAILED` : 'all pass');
console.log(`(Moon ${R_MOON} km, Earth ${R_EARTH_A} km)`);
process.exit(fails ? 1 : 0);
