#!/usr/bin/env node
// Flies src/sky/MoonTrip.ts in Node, on the real sky, and sets every leg beside verdict/route.py's: node --no-warnings tools/sky/route-check.mjs [--all]
// The tap at 300 km is route.py's t = 35.4 s, G5 is asked for at once, and home leaves 20 minutes after arrival, as route.py's trips() does. Pass: within 4 s a leg, and 6 s on a way.
// The route's table was read off route.py's outbound() and inbound() at DT = 1/30. It stops at speed at both ends and this file doesn't, and its ring and its G4 down are one brake here, v = d / tau, on arrival only:
// so climbing and leaving are held to route.py, G5 to the route's distance less what the brake takes, and the way in to that law, integrated here, on its own, at a finer step.
import { registerHooks } from 'node:module';

// (the game's imports have no extension; a tool under Node needs them to)
registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { MoonTrip, PULL, R_E, R_M, TAU } = await import('../../src/sky/MoonTrip.ts');
const { series } = await import('../../src/sky/series.gen.js');

const ROUTE = {
  '3000|Moon up': { out: [[50.7, 14918], [108.2, 322061], [4.8, 4482], [40.2, 12160]], back: [[42.8, 12709], [108.3, 322361], [4.8, 4482], [40.6, 12302], [0, 0], [9, 2735]] },
  '3000|Moon -26': { out: [[3, 625], [71.5, 21443], [108.4, 322761], [4.8, 4482], [40.4, 12221]], back: [[42.8, 12709], [108.7, 323461], [4.8, 4482], [56.6, 17126], [14.3, 4319], [8.9, 2705]] },
  '3000|New Moon': { out: [[64.2, 18978], [123.3, 367261], [4.8, 4482], [40.3, 12211]], back: [[42.8, 12709], [123.5, 367961], [4.8, 4482], [56.6, 17136], [7.1, 2160], [8.9, 2705]] },
  '6000|Moon up': { out: [[50.6, 14908], [54, 318440], [5.6, 8125], [40.1, 12152]], back: [[42.8, 12709], [54, 318640], [5.6, 8125], [41, 12424], [0, 0], [9, 2735]] },
  '6000|Moon -26': { out: [[3, 625], [71.5, 21443], [54.1, 319240], [5.6, 8125], [39.9, 12091]], back: [[42.8, 12709], [54.2, 319640], [5.6, 8125], [57.1, 17299], [14.4, 4350], [8.9, 2705]] },
  '6000|New Moon': { out: [[64.2, 18978], [61.5, 363640], [5.6, 8125], [40.2, 12182]], back: [[42.8, 12709], [61.6, 364040], [5.6, 8125], [57.5, 17410], [6.9, 2099], [8.9, 2705]] },
  '10000|Moon up': { out: [[50.6, 14908], [32.3, 313878], [6.1, 12852], [39.6, 11990]], back: [[42.8, 12709], [32.3, 313878], [6.1, 12852], [41.2, 12475], [0, 0], [9.1, 2745]] },
  '10000|Moon -26': { out: [[3, 625], [71.5, 21443], [32.4, 314545], [6.1, 12852], [39.8, 12061]], back: [[42.8, 12709], [32.4, 314545], [6.1, 12852], [58.4, 17673], [14.4, 4350], [8.9, 2705]] },
  '10000|New Moon': { out: [[64.2, 18978], [36.8, 358878], [6.1, 12852], [40.4, 12222]], back: [[42.8, 12709], [36.8, 359212], [6.1, 12852], [57.8, 17511], [6.9, 2079], [8.9, 2705]] },
};
const CASES = [
  ['Moon up', '2026-11-25T04:00:00Z'],
  ['Moon -26', '2026-11-24T21:00:00Z'],
  ['New Moon', '2026-12-09T01:00:00Z'],
];
const DT = 1 / 30;
let fails = 0;

/** The way in to the Moon from G5's speed, on the law alone: speed is 30 + x / tau over the orbit's floor, and the dive a constant turn that lands level on it. Seconds and km. */
function lawIn(g5, tau = TAU, h = 1 / 240) {
  let x = (g5 - 30) * tau, s = 0, km = 0;
  for (; x > 0.02 && s < 400; s += h) {
    const v = 30 + x / tau, cos = Math.max(0, 1 - PULL * tau * Math.log(v / 30));
    x -= v * Math.sqrt(1 - cos * cos) * h;
    km += v * h;
  }
  return { s, km };
}

/** The way in to rest over home: the same law down a straight line, with the last stop's steady deceleration. */
function lawHome(g5, tau = TAU, h = 1 / 240) {
  // (where the law meets G5: the root of (d / tau)^2 + 2 d = g5^2)
  const km = tau * tau * (Math.sqrt(1 + (g5 * g5) / (tau * tau)) - 1);
  let d = km, s = 0;
  for (; d > 0.3 && s < 400; s += h) d -= Math.sqrt((d / tau) ** 2 + 2 * d) * h;
  return { s, km };
}

const outOrder = (ref) => {
  const k = ref.length - 4;
  return [
    ...(k ? [['G4 up until clear', ['climb'], [0]]] : []),
    ['G4 out', ['out'], [k]],
  ];
};
const homeOrder = [['G4 out', ['homeOut'], [0]]];

function flyTrip(g5, iso) {
  // route.py's clock reaches the tap at 35.4 s
  const trip = new MoonTrip(series, Date.parse(iso) + 35400, { g5 });
  const run = (until, tap) => {
    for (let i = 0; i < 400000 && !until(); i++) {
      if (tap?.()) trip.qaGo();
      trip.step(DT, 0);
    }
    if (!until()) throw new Error(`never reached: ${until}`);
  };
  trip.step(DT, 0);
  trip.qaGo();
  let asked = false;
  run(() => trip.leg === 'orbit', () => {
    if (asked || trip.leg === 'wait') return false;
    return (asked = true);
  });
  const landed = { h: trip.hMoon, at: trip.clock, v: trip.v, nFar: trip.log.length };
  const arrive = trip.t;
  run(() => trip.t >= arrive + 20 * 60);
  // (the route leaves from under the Earth, 300 km over the Moon: wait for the lap to come round to it)
  run(() => {
    const m = Math.hypot(...trip.rm), e = Math.hypot(...trip.r);
    return -(trip.rm[0] * trip.r[0] + trip.rm[1] * trip.r[1] + trip.rm[2] * trip.r[2]) / (m * e) > 0.998;
  });
  const lapAt = trip.t;
  const orbitH = trip.hMoon;
  trip.qaGo();
  asked = false;
  run(() => trip.leg === 'wait', () => {
    if (asked || trip.leg === 'orbit') return false;
    return (asked = true);
  });
  const home = { h: trip.hEarth, v: trip.v, total: trip.t - lapAt };
  return { trip, landed, home, orbitH };
}

/** Leg by leg against the route's. Its table is in leg order; the G4 down of the way home runs on into the level run and the drop here (LEVEL_END), so those three are one line. */
function table(name, legs, order, ref, far) {
  const get = (leg) => legs.filter((l) => leg.includes(l.leg)).reduce((o, l) => ({ s: o.s + l.s, km: o.km + l.km }), { s: 0, km: 0 });
  let sum = 0, refSum = 0, bad = 0;
  const lines = [];
  order.forEach(([label, keys, rows]) => {
    const m = get(keys);
    const r = rows.reduce((o, i) => ({ s: o.s + ref[i][0], km: o.km + ref[i][1] }), { s: 0, km: 0 });
    const diff = m.s - r.s;
    sum += m.s;
    refSum += r.s;
    if (Math.abs(diff) > 4) bad++;
    lines.push(`    ${label.padEnd(30)} ${m.s.toFixed(1).padStart(6)} s ${String(Math.round(m.km)).padStart(7)} km | route ${r.s.toFixed(1).padStart(6)} s ${String(Math.round(r.km)).padStart(7)} km | ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} s`);
  });
  // what route.py's G5, ring and G4 down covered, this file's G5 and way in cover. G5 is the route's distance less the way in's, at the route's own spool; the way in is the law's, and on a day with home round the limb,
  // what the path has over the straight line, past 2,000 km of curve, at G4
  const g = get(far.g5), w = get(far.way), R = ref.slice(ref.length - far.tail), g5km = R[0][1], covered = R.reduce((a, r) => a + r[1], 0);
  const spool = R[0][0] - g5km / far.v;
  const eG = (covered - w.km) / far.v + spool, eW = far.law.s + Math.max(0, w.km - far.law.km - 2000) / 300;
  for (const [label, m, e] of [['G5', g, eG], ['the way in', w, eW]]) {
    const diff = m.s - e;
    sum += m.s;
    refSum += e;
    if (Math.abs(diff) > 4) bad++;
    lines.push(`    ${label.padEnd(30)} ${m.s.toFixed(1).padStart(6)} s ${String(Math.round(m.km)).padStart(7)} km | law   ${e.toFixed(1).padStart(6)} s ${String(Math.round(label === 'G5' ? covered - w.km : far.law.km)).padStart(7)} km | ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} s`);
  }
  const total = sum - refSum;
  if (Math.abs(total) > 6 || bad) fails++;
  console.log(`  ${name}: ${sum.toFixed(1)} s against ${refSum.toFixed(1)} s, ${total >= 0 ? '+' : ''}${total.toFixed(1)} s`);
  for (const l of lines) console.log(l);
}

const all = process.argv.includes('--all');
for (const g5 of all ? [3000, 6000, 10000] : [6000]) {
  for (const [label, iso] of all ? CASES : CASES.slice(0, 1)) {
    const { trip, landed, home, orbitH } = flyTrip(g5, iso);
    const ref = ROUTE[`${g5}|${label}`];
    console.log(`--- G5 ${g5} km/s, ${label}, ${iso}`);
    const log = trip.log;
    const legsOut = log.slice(0, landed.nFar), legsHome = log.slice(landed.nFar);
    const inOut = lawIn(g5), inHome = lawHome(g5);
    table('out', legsOut, outOrder(ref.out), ref.out, { g5: ['cruise'], way: ['in'], tail: 3, v: g5, law: inOut });
    table('home', legsHome, homeOrder, ref.back, { g5: ['homeCruise'], way: ['homeIn', 'homeLevel', 'homeDrop'], tail: 5, v: g5, law: inHome });
    const okEnd = Math.abs(landed.h - 300) < 0.05 && Math.abs(landed.v - 30) < 0.1 && Math.abs(orbitH - 300) < 0.01 && Math.abs(home.h - 300) < 2.5 && trip.leg === 'wait';
    if (!okEnd) fails++;
    console.log(`  ends: Moon floor at ${landed.h.toFixed(2)} km at ${landed.v.toFixed(2)} km/s, ${orbitH.toFixed(3)} km after 20 min in orbit; home at ${home.h.toFixed(1)} km; ${okEnd ? 'ok' : 'FAIL'}`);
  }
}

// Twice in a row, the second launch from where the first came home.
{
  const trip = new MoonTrip(series, Date.parse('2026-11-25T04:00:35Z'), { g5: 6000 });
  trip.step(DT, 0);
  for (let n = 0; n < 2; n++) {
    trip.qaGo();
    trip.step(DT, 0);
    trip.qaGo();
    for (let i = 0; i < 40000 && trip.leg !== 'orbit'; i++) trip.step(DT, 0);
    trip.qaGo();
    trip.step(DT, 0);
    trip.qaGo();
    for (let i = 0; i < 40000 && trip.leg !== 'wait'; i++) trip.step(DT, 0);
    console.log(`trip ${n + 1}: home after ${trip.clock.toFixed(1)} s, ${trip.hEarth.toFixed(1)} km up, ${trip.leg}`);
    if (trip.leg !== 'wait' || trip.trips !== n + 1) fails++;
  }
}

// Steering in orbit: a hard turn all the way round, and the height holds.
{
  const trip = new MoonTrip(series, Date.parse('2026-11-25T04:00:35Z'), { g5: 6000 });
  trip.step(DT, 0);
  trip.qaGo();
  trip.step(DT, 0);
  trip.qaGo();
  for (let i = 0; i < 40000 && trip.leg !== 'orbit'; i++) trip.step(DT, 0);
  let lo = Infinity, hi = 0;
  for (let i = 0; i < 1800; i++) {
    trip.step(DT, Math.sin(i / 90));
    if (i > 300) {
      lo = Math.min(lo, trip.hMoon);
      hi = Math.max(hi, trip.hMoon);
    }
  }
  const g3 = trip.v, gear = trip.gear;
  // (the street's gears from the orbit down, VOYAGE.md V2c: a flick down is Stratos, and a flick up Rainbow Warp, the orbit's speed, again)
  trip.shiftDown();
  for (let i = 0; i < 90; i++) trip.step(DT, 0);
  const down = trip.leg === 'orbit' && trip.rung === 4 && Math.abs(trip.v - 4.5) < 0.05;
  trip.tap();
  for (let i = 0; i < 120; i++) trip.step(DT, 0);
  const same = down && trip.leg === 'orbit' && trip.rung === 5 && Math.abs(trip.v - 30) < 0.1;
  // TURBO heads home from the orbit's gear, in one tap
  trip.qaGo();
  trip.step(DT, 0);
  const left = trip.leg;
  const ok = hi - lo < 0.01 && gear === 3 && Math.abs(g3 - 30) < 0.1 && same && left === 'leave';
  if (!ok) fails++;
  console.log(`orbit, steering: ${lo.toFixed(3)}-${hi.toFixed(3)} km; settles at G${gear}, ${g3.toFixed(1)} km/s; a flick down and up: ${same ? 'Stratos and back' : 'no'}; a tap: ${left}; ${ok ? 'ok' : 'FAIL'}`);
}

// Earth's page with its page change refused in the long dark (storage blocked, review five's 35): the trip flies on into the Moon's orbit there. A flick is a gear,
// and a pull held climbs out of it to TO PLANET EARTH?, and home.
{
  const { geodeticToFix } = await import('../../src/sky/WorldFrame.ts');
  const trip = new MoonTrip(series, Date.parse('2026-11-25T04:00:35Z'), { g5: 6000, street: true });
  trip.fromStreet(geodeticToFix(37.7749, -122.4194, 15, new Float64Array(3)), new Float64Array([0, 0, 1]), 0, 0.3, 3, 3);
  trip.step(DT, 0);
  trip.qaGo();
  trip.step(DT, 0);
  trip.qaGo();
  for (let i = 0; i < 40000 && trip.leg !== 'orbit'; i++) trip.step(DT, 0);
  const orbit = trip.leg;
  for (let i = 0; i < 3; i++) {
    trip.tap();
    for (let k = 0; k < 30; k++) trip.step(DT, 0);
  }
  const flicked = trip.leg;
  for (let i = 0; i < 4 * 30 && trip.leg === 'orbit'; i++) trip.step(DT, 0, -1);
  const pulled = trip.leg;
  let egg = null;
  for (let i = 0; i < 40000 && !egg; i++) {
    trip.step(DT, 0, -1);
    egg = trip.egg;
  }
  const eggKm = trip.hMoon;
  trip.toEarth();
  for (let i = 0; i < 60000 && trip.leg !== 'wait'; i++) trip.step(DT, 0);
  const ok = orbit === 'orbit' && flicked === 'orbit' && pulled === 'moonRise' && egg === 'earth' && trip.leg === 'wait';
  if (!ok) fails++;
  console.log(`Earth's page, its page change refused: ${orbit}; three flicks up: ${flicked}; a pull held: ${pulled}; ${egg ? `TO PLANET EARTH? at ${eggKm.toFixed(0)} km` : 'no button'}; then ${trip.leg}; ${ok ? 'ok' : 'FAIL'}`);
}

// Every way a trip can start or end up, across a month: launch, orbit, leave, home, from wherever the Moon and home are. It must always arrive.
if (all) {
  let worstOut = 0, worstHome = 0, level = 0, n = 0, lowMoon = Infinity, lowEarth = Infinity, lowHomeEarth = Infinity;
  for (let k = 0; k < 90; k++) {
    const ms = Date.parse('2026-11-01T00:00:00Z') + k * 8 * 3600e3;
    const trip = new MoonTrip(series, ms, { g5: 6000 });
    const step = (stick = 0) => {
      trip.step(DT, stick);
      lowMoon = Math.min(lowMoon, trip.hMoon);
      if (trip.log.length || trip.leg !== 'wait') lowEarth = Math.min(lowEarth, trip.hEarth);
    };
    step();
    trip.qaGo();
    step();
    trip.qaGo();
    for (let i = 0; i < 60000 && trip.leg !== 'orbit'; i++) step();
    const out = trip.clock;
    const nOut = trip.log.length;
    // a part-lap with the thumb working, so it leaves from anywhere, facing any way: the far side too, and flying dead away from Earth
    for (let i = 0; i < 37 * k; i++) step(k % 3 ? Math.sin(i / 50) : 0);
    const t0 = trip.t;
    trip.qaGo();
    step();
    trip.qaGo();
    for (let i = 0; i < 60000 && trip.leg !== 'wait'; i++) {
      step();
      lowHomeEarth = Math.min(lowHomeEarth, trip.hEarth);
    }
    n++;
    if (trip.leg !== 'wait' || Math.abs(trip.hEarth - 300) > 2.5 || out > 300 || trip.t - t0 > 300 || lowMoon < 280) {
      fails++;
      console.log(`  FAIL at ${new Date(ms).toISOString()}: ${trip.leg}, ${trip.hEarth.toFixed(1)} km, out ${out.toFixed(1)} s, home ${(trip.t - t0).toFixed(1)} s, lowest over the Moon ${lowMoon.toFixed(1)} km`);
    }
    worstOut = Math.max(worstOut, out);
    worstHome = Math.max(worstHome, trip.t - t0);
    if (trip.log.slice(nOut).some((l) => l.leg === 'homeLevel') || trip.log.slice(0, nOut).some((l) => l.leg === 'arc')) level++;
  }
  console.log(`${n} launches over a month, each leaving orbit from a different place: worst ${worstOut.toFixed(1)} s out, ${worstHome.toFixed(1)} s home; ${level} needed a level run; lowest ${lowMoon.toFixed(1)} km over the Moon, ${lowEarth.toFixed(1)} km over Earth (route.py's path to the limb, with no floor: 96 km by geometry), ${lowHomeEarth.toFixed(1)} km on the way home`);
}
console.log(fails ? `${fails} FAILED` : 'all pass');
console.log(`(spheres ${R_E} and ${R_M} km)`);
process.exit(fails ? 1 : 0);
