#!/usr/bin/env node
// Flies src/sky/MoonTrip.ts in Node, on the real sky, and sets every leg beside verdict/route.py's: node --no-warnings tools/sky/route-check.mjs [--all]
// The tap at 300 km is route.py's t = 35.4 s, G5 is asked for at once, and home leaves 20 minutes after arrival, as route.py's trips() does. Pass: within 4 s a leg, and 6 s on a way.
// The route's table was read off route.py's outbound() and inbound() at DT = 1/30. It stops at speed at both ends and this file doesn't: those are the two lines that may run long.
import { registerHooks } from 'node:module';

// (the game's imports have no extension; a tool under Node needs them to)
registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const { MoonTrip, R_E, R_M } = await import('../../src/sky/MoonTrip.ts');
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
const outOrder = (ref) => {
  const k = ref.length - 4;
  return [
    ...(k ? [['G4 up until clear', ['climb'], [0]]] : []),
    ['G4 out', ['out'], [k]],
    ['G5', ['cruise'], [k + 1]],
    ['ring brake', ['brake'], [k + 2]],
    ['G4 down, and the flare', ['down', 'flare'], [k + 3]],
  ];
};
const homeOrder = [
  ['G4 out', ['homeOut'], [0]],
  ['G5', ['homeCruise'], [1]],
  ['ring brake', ['homeBrake'], [2]],
  ['G4 down, level run, drop', ['homeDown', 'homeLevel', 'homeDrop'], [3, 4, 5]],
];

const DT = 1 / 30;
let fails = 0;

function flyTrip(g5, iso) {
  // route.py's clock reaches the tap at 35.4 s
  const trip = new MoonTrip(series, Date.parse(iso) + 35400, { g5 });
  const run = (until, tap) => {
    for (let i = 0; i < 400000 && !until(); i++) {
      if (tap?.()) trip.tap();
      trip.step(DT, 0);
    }
    if (!until()) throw new Error(`never reached: ${until}`);
  };
  trip.step(DT, 0);
  trip.tap();
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
  trip.tap();
  asked = false;
  run(() => trip.leg === 'wait', () => {
    if (asked || trip.leg === 'orbit') return false;
    return (asked = true);
  });
  const home = { h: trip.hEarth, v: trip.v, total: trip.t - lapAt };
  return { trip, landed, home, orbitH };
}

/** Leg by leg against the route's. Its table is in leg order; the G4 down of the way home runs on into the level run and the drop here (LEVEL_END), so those three are one line. */
function table(name, legs, order, ref) {
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
  const total = sum - refSum;
  if (Math.abs(total) > 6 || bad) fails++;
  console.log(`  ${name}: ${sum.toFixed(1)} s against the route's ${refSum.toFixed(1)} s, ${total >= 0 ? '+' : ''}${total.toFixed(1)} s`);
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
    table('out', legsOut, outOrder(ref.out), ref.out);
    table('home', legsHome, homeOrder, ref.back);
    const okEnd = Math.abs(landed.h - 300) < 12 && Math.abs(orbitH - 300) < 0.01 && Math.abs(home.h - 300) < 2.5 && trip.leg === 'wait';
    if (!okEnd) fails++;
    console.log(`  ends: Moon floor at ${landed.h.toFixed(1)} km, ${orbitH.toFixed(3)} km after 20 min in orbit; home at ${home.h.toFixed(1)} km; ${okEnd ? 'ok' : 'FAIL'}`);
  }
}

// Twice in a row, the second launch from where the first came home.
{
  const trip = new MoonTrip(series, Date.parse('2026-11-25T04:00:35Z'), { g5: 6000 });
  trip.step(DT, 0);
  for (let n = 0; n < 2; n++) {
    trip.tap();
    trip.step(DT, 0);
    trip.tap();
    for (let i = 0; i < 40000 && trip.leg !== 'orbit'; i++) trip.step(DT, 0);
    trip.tap();
    trip.step(DT, 0);
    trip.tap();
    for (let i = 0; i < 40000 && trip.leg !== 'wait'; i++) trip.step(DT, 0);
    console.log(`trip ${n + 1}: home after ${trip.clock.toFixed(1)} s, ${trip.hEarth.toFixed(1)} km up, ${trip.leg}`);
    if (trip.leg !== 'wait' || trip.trips !== n + 1) fails++;
  }
}

// Steering in orbit: a hard turn all the way round, and the height holds.
{
  const trip = new MoonTrip(series, Date.parse('2026-11-25T04:00:35Z'), { g5: 6000 });
  trip.step(DT, 0);
  trip.tap();
  trip.step(DT, 0);
  trip.tap();
  for (let i = 0; i < 40000 && trip.leg !== 'orbit'; i++) trip.step(DT, 0);
  let lo = Infinity, hi = 0;
  for (let i = 0; i < 1800; i++) {
    trip.step(DT, Math.sin(i / 90));
    if (i > 300) {
      lo = Math.min(lo, trip.hMoon);
      hi = Math.max(hi, trip.hMoon);
    }
  }
  trip.shiftDown();
  for (let i = 0; i < 300; i++) trip.step(DT, 0);
  const g3 = trip.v;
  trip.tap();
  for (let i = 0; i < 150; i++) trip.step(DT, 0);
  const g4 = trip.v;
  const ok = hi - lo < 0.01 && Math.abs(g3 - 30) < 0.1 && Math.abs(g4 - 300) < 0.5;
  if (!ok) fails++;
  console.log(`orbit, steering: ${lo.toFixed(3)}-${hi.toFixed(3)} km; down tab ${g3.toFixed(1)} km/s, up tab ${g4.toFixed(1)} km/s; ${ok ? 'ok' : 'FAIL'}`);
}

// Every way a trip can start or end up, across a month: launch, orbit, leave, home, from wherever the Moon and home are. It must always arrive.
if (all) {
  let worstOut = 0, worstHome = 0, level = 0, n = 0;
  for (let k = 0; k < 90; k++) {
    const ms = Date.parse('2026-11-01T00:00:00Z') + k * 8 * 3600e3;
    const trip = new MoonTrip(series, ms, { g5: 6000 });
    trip.step(DT, 0);
    trip.tap();
    trip.step(DT, 0);
    trip.tap();
    for (let i = 0; i < 60000 && trip.leg !== 'orbit'; i++) trip.step(DT, 0);
    const out = trip.clock;
    const nOut = trip.log.length;
    // a part-lap, so it leaves from anywhere: the far side too
    for (let i = 0; i < 37 * k; i++) trip.step(DT, 0);
    const t0 = trip.t;
    trip.tap();
    trip.step(DT, 0);
    trip.tap();
    for (let i = 0; i < 60000 && trip.leg !== 'wait'; i++) trip.step(DT, 0);
    n++;
    if (trip.leg !== 'wait' || Math.abs(trip.hEarth - 300) > 2.5 || out > 300 || trip.t - t0 > 300) {
      fails++;
      console.log(`  FAIL at ${new Date(ms).toISOString()}: ${trip.leg}, ${trip.hEarth.toFixed(1)} km, out ${out.toFixed(1)} s, home ${(trip.t - t0).toFixed(1)} s`);
    }
    worstOut = Math.max(worstOut, out);
    worstHome = Math.max(worstHome, trip.t - t0);
    if (trip.log.slice(nOut).some((l) => l.leg === 'homeLevel') || trip.log.slice(0, nOut).some((l) => l.leg === 'arc')) level++;
  }
  console.log(`${n} launches over a month, each leaving orbit from a different place: worst ${worstOut.toFixed(1)} s out, ${worstHome.toFixed(1)} s home; ${level} needed a level run`);
}
console.log(fails ? `${fails} FAILED` : 'all pass');
console.log(`(spheres ${R_E} and ${R_M} km)`);
process.exit(fails ? 1 : 0);
