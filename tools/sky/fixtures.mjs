#!/usr/bin/env node
// research-astro.md section 4's five Horizons fixtures through src/sky/SkyModel.ts in the Observer form, on the bundle the game ships. Pass at 0.005 degrees or 0.05 points.
// Runs the real TypeScript under Node (type stripping, on by default from Node 23.6): node tools/sky/fixtures.mjs
//
// Then the forms flight will lean on: free flight in EQJ against the fixed form, and rebaseBody, which must move nothing on screen.
import { series } from '../../src/sky/series.gen.js';
import { EARTH, MOON, R_MOON, SkyModel, SkyState, rebaseBody } from '../../src/sky/SkyModel.ts';
import { axesAt, geodeticToFix, sphereToFix } from '../../src/sky/WorldFrame.ts';

const DEG = Math.PI / 180;
const unit = (az, el) => [Math.cos(el * DEG) * Math.sin(az * DEG), Math.cos(el * DEG) * Math.cos(az * DEG), Math.sin(el * DEG)]; // E N U
const sep = (a, b) => {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(...c), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / DEG;
};
const azEl = (d) => [(Math.atan2(d[0], -d[2]) / DEG + 360) % 360, Math.asin(d[1]) / DEG];

const SF = [37.7749, -122.4194, 0.016], TOKYO = [35.6762, 139.6503, 0.04], McM = [-77.8463, 166.6682, 0.01], A11 = [0.67416, 23.47314, 0];
const FIX = [
  ['2026-10-31T12:00:00Z', 'SF', SF, EARTH, 'moon', 130.7033, 71.4653, 65.099],
  ['2027-06-21T12:00:00Z', 'Tokyo', TOKYO, EARTH, 'moon', 119.2072, 1.1213, 94.274],
  ['2026-12-21T12:00:00Z', 'McMurdo', McM, EARTH, 'sun', 192.0197, 11.5635, null],
  ['2026-10-31T12:00:00Z', 'Apollo 11', A11, MOON, 'earth', 256.9817, 69.3854, 34.741],
  ['2026-10-31T12:00:00Z', 'Apollo 11', A11, MOON, 'sun', 268.573, -2.2763, null],
];

const model = new SkyModel(series);
const s = new SkyState();
const place = (body, [lat, lon, h]) => ({
  body,
  free: false,
  pos: body === EARTH ? geodeticToFix(lat, lon, h, new Float64Array(3)) : sphereToFix(R_MOON, lat, lon, h, new Float64Array(3)),
  axes: axesAt(lat, lon, 0, new Float64Array(9)),
});

let fails = 0;
for (const [t, name, at, body, what, az0, el0, lit0] of FIX) {
  model.frame(Date.parse(t), place(body, at), s);
  const [az, el] = azEl(s[what]);
  const off = sep(unit(az, el), unit(az0, el0));
  const lit = what === 'moon' ? s.moonLit * 100 : what === 'earth' ? s.earthLit * 100 : null;
  const litOff = lit0 === null ? 0 : Math.abs(lit - lit0);
  const ok = off <= 0.005 && litOff <= 0.05;
  if (!ok) fails++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${t.slice(0, 16)} ${name.padEnd(9)} ${what.padEnd(5)} az ${az.toFixed(4)} el ${el.toFixed(4)} off by ${off.toFixed(4)} deg${lit0 === null ? '' : `, lit ${lit.toFixed(3)} % off by ${litOff.toFixed(3)} points`}`);
}

// The same point and the same axes as free flight in EQJ, and rebased onto the Moon: directions may not move.
{
  const ms = Date.parse('2026-11-25T04:00:00Z');
  const ob = place(EARTH, [37.7749, -122.4194, 300]);
  model.frame(ms, ob, s);
  const fixed = { sun: [...s.sun], moon: [...s.moon], earth: [...s.earth] };
  const free = { body: EARTH, free: true, pos: Float64Array.from(model.obsEqj), axes: Float64Array.from(s.starRot) };
  model.frame(ms, free, s);
  let worst = Math.max(sep(fixed.sun, s.sun), sep(fixed.moon, s.moon), sep(fixed.earth, s.earth));
  rebaseBody(free, MOON, model);
  model.frame(ms, free, s);
  worst = Math.max(worst, sep(fixed.sun, s.sun), sep(fixed.moon, s.moon), sep(fixed.earth, s.earth));
  rebaseBody(ob, MOON, model);
  model.frame(ms, ob, s);
  worst = Math.max(worst, sep(fixed.sun, s.sun), sep(fixed.moon, s.moon), sep(fixed.earth, s.earth));
  const ok = worst < 1e-9;
  if (!ok) fails++;
  console.log(`${ok ? 'pass' : 'FAIL'}  free flight and rebaseBody, fixed form against both: worst ${worst.toExponential(2)} deg`);
}

// frame() in a tight loop: its cost, and that it holds its window (no series run) inside a minute.
{
  const ob = place(EARTH, [37.7749, -122.4194, 300]);
  const ms = Date.parse('2026-11-25T04:00:30Z');
  model.frame(ms, ob, s);
  const t0 = performance.now();
  for (let i = 0; i < 200000; i++) model.frame(ms + i * 0.1, ob, s);
  console.log(`frame(): ${((performance.now() - t0) / 200).toFixed(2)} us each, this laptop, no phone number`);
}
process.exit(fails ? 1 : 0);
