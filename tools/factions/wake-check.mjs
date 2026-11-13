#!/usr/bin/env node
// Taking the block, part A's rules under Node (docs/specs/factions/LIFT.md, "Taking the block"): where ?lift starts (liftHoodStart), whose paint
// the bus breathes (paintAsOf), when the block wakes (liftWakes, LIFT_WAKE) and when the wave's slow motion plays (waveSlow), bundled with rolldown
// as lift-check.mjs bundles liftGlsl.ts; then the wake on the real data, Alamo Square from hoods.bin: the tools' start by it (&hoodstart, hoodStart,
// at eight suns) wakes it at once, and the Golden Gate's opening start never does, at any gear. The beam's width (beamWidth). Prints pass or FAIL
// a line with its numbers, exits 1 on any failure.
//
//   node tools/factions/wake-check.mjs
import { rolldown } from 'rolldown';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const R = root.replace(/\\/g, '/');
const out = `${here}.out`;
mkdirSync(out, { recursive: true });
writeFileSync(
  `${out}/wake-entry.ts`,
  [
    `export * from '${R}/src/world/liftGlsl.ts';`,
    `export * from '${R}/src/world/hoods.ts';`,
    `export { paintAsOf, FACTIONS } from '${R}/src/game/factions.ts';`,
    `export { config } from '${R}/src/config.ts';`,
  ].join('\n'),
);
const bundle = await rolldown({ input: `${out}/wake-entry.ts`, platform: 'node', logLevel: 'silent', external: [/^three/] });
await bundle.write({ dir: out, format: 'esm', entryFileNames: 'wake.mjs' });
await bundle.close();
const L = await import(pathToFileURL(`${out}/wake.mjs`).href);
const W = L.LIFT_WAKE;

let failed = 0;
function report(name, value, limit, ok) {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${value}  (${limit})`);
}
const Q = (s) => new URLSearchParams(s);

// ------------------------------------------------------------------ 1. the start and the paint
for (const [q, want] of [
  ['?lift&lifted=inferno', false],
  ['?lift', false],
  ['?lift&lifted', false],
  ['?lift&lifted=inferno&hoodstart', true],
  ['?lift&lifted&hoodstart&skipintro', true],
  ['?lift&lifted&hoodstart&lat=37.776&lon=-122.433', false],
]) report(`the start by the neighbourhood, ${q}`, L.liftHoodStart(Q(q)), String(want), L.liftHoodStart(Q(q)) === want);
for (const [q, want] of [
  ['?lift&lifted=inferno', undefined],
  ['?lift&lifted=hyperglow', undefined],
  ['?lift&lifted=inferno&paintas=atlantis', 'atlantis'],
  ['?lift&lifted=inferno&paintas=inferno', 'inferno'],
  ['?paintas=elderwood', 'elderwood'],
  ['?paintas=nobody', undefined],
]) {
  const f = L.paintAsOf(Q(q))?.key;
  report(`the bus paints as, ${q}`, f ?? 'its own (Rainbow)', want ?? 'its own (Rainbow)', f === want);
}

// ------------------------------------------------------------------ 2. the wake's rule
{
  const c = Math.cos((W.cone * Math.PI) / 180);
  const cos = (deg) => Math.cos((deg * Math.PI) / 180);
  const F = L.config.flight, T = L.config.turbo ?? {};
  const gears = [
    ['Cruise', F.cruiseSpeed],
    ['Express', F.surgeSpeed],
    ['Nonstop', T.nonstopSpeed ?? 225],
    ['Jet', T.jetSpeed ?? 450],
  ];
  for (const [g, v] of gears) {
    const reach = Math.min(W.max, Math.max(W.r, W.s * v));
    const ok = L.liftWakes(reach - 1, reach - 1, 60, v, 1, false) && !L.liftWakes(reach + 1, reach + 1, 60, v, 1, false);
    report(`wakes at ${g} (${v} m/s), heading for the heart, 60 m up`, `${reach.toFixed(0)} m out, ${(reach / v).toFixed(1)} s`, `max(${W.r}, ${W.s} s) to ${W.max} m`, ok);
  }
  report('the cone: 34 degrees off the heading wakes, 36 does not', `${L.liftWakes(400, 400, 60, 30, cos(34), false)} / ${L.liftWakes(400, 400, 60, 30, cos(36), false)}`, `${W.cone} degrees`, L.liftWakes(400, 400, 60, 30, cos(34), false) && !L.liftWakes(400, 400, 60, 30, cos(36), false) && c > 0);
  report('flying away within 150 m wakes it', `${L.liftWakes(149, 100, 60, 30, -1, false)} / 151 m: ${L.liftWakes(151, 130, 60, 30, -1, false)}`, `${W.in} m whatever the heading`, L.liftWakes(149, 100, 60, 30, -1, false) && !L.liftWakes(151, 130, 60, 30, -1, false));
  // (high: three dimensions, so 700 m over the block is 700 m from it)
  report('700 m over the block, the heart out of the frame', String(L.liftWakes(700, 0, 700, 30, 1, false)), 'false: over 600 m only the frame wakes it', !L.liftWakes(700, 0, 700, 30, 1, false));
  report('700 m up, 1.1 km off, the heart in the frame', String(L.liftWakes(Math.hypot(1100, 700), 1100, 700, 30, -1, true)), 'true', L.liftWakes(Math.hypot(1100, 700), 1100, 700, 30, -1, true));
  report('700 m up, 1.3 km off, the heart in the frame', String(L.liftWakes(Math.hypot(1300, 700), 1300, 700, 30, -1, true)), `false: past ${W.max} m`, !L.liftWakes(Math.hypot(1300, 700), 1300, 700, 30, -1, true));
  report('low, 500 m off at Cruise, heading for it, seen', String(L.liftWakes(500, 500, 60, 30, 1, true)), `false: under 600 m the frame alone doesn't, ${W.r} m at Cruise`, !L.liftWakes(500, 500, 60, 30, 1, true));
}

// ------------------------------------------------------------------ 3. the wave's slow motion
{
  const far = 420;
  report('slow motion: the front at the bus, 100 m up', String(L.waveSlow(300, far, 300, 100)), '1', L.waveSlow(300, far, 300, 100) === 1);
  report('slow motion: the front 120 m short of the bus, 60 m up', String(L.waveSlow(180, far, 300, 60)), '1 (134 m in three dimensions)', L.waveSlow(180, far, 300, 60) === 1);
  report('slow motion: the front 200 m short of the bus', String(L.waveSlow(100, far, 300, 60)), '0, not yet', L.waveSlow(100, far, 300, 60) === 0);
  report('slow motion: the bus 700 m up over the front', String(L.waveSlow(300, far, 300, 700)), '0, never at 600 m or more', L.waveSlow(300, far, 300, 700) === 0);
  report('slow motion: the front past the block (farthest house + 150 m)', String(L.waveSlow(far + 151, far, far + 151, 60)), '-1, skipped for good', L.waveSlow(far + 151, far, far + 151, 60) === -1);
  report('slow motion: the bus 1 km out as the front crosses the block', String(L.waveSlow(far, far, 1000, 60)), '0', L.waveSlow(far, far, 1000, 60) === 0);
}

// ------------------------------------------------------------------ 4. the real block: the tools' start wakes it, the Golden Gate's never does
{
  const slug = 'sf';
  const dir = `${root}/public/city/${slug}`;
  const man = JSON.parse(readFileSync(`${dir}/city.json`, 'utf8'));
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x/');
    const p = `${root}/public${u.pathname}`;
    return existsSync(p) ? new Response(readFileSync(p)) : new Response(null, { status: 404 });
  };
  const T = await L.loadHoods(`/city/${slug}`, man.hoods);
  const n = L.pickHood(T, null, man);
  const sq = new Set(T.squares[n]), S = L.SQUARE;
  const heart = T.hearts[n], hx = (L.squareIx(heart) + 0.5) * S, hz = (L.squareIz(heart) + 0.5) * S;
  // (every square of the neighbourhood: the staged ones are those with a house, a subset, so the distance here is the least the game's can be)
  const near = (x, z) => {
    let d = Infinity;
    for (const k of sq) {
      const x0 = L.squareIx(k) * S, z0 = L.squareIz(k) * S;
      d = Math.min(d, Math.hypot(Math.max(x0 - x, 0, x - x0 - S), Math.max(z0 - z, 0, z - z0 - S)));
    }
    return d;
  };
  const wake = (x, z, heading, y, v) => {
    const fx = Math.sin(heading), fz = -Math.cos(heading);
    const dh = near(x, z), d = Math.hypot(dh, y), l = Math.hypot(hx - x, hz - z) || 1;
    return { dh, d, ok: L.liftWakes(d, dh, y, v, ((hx - x) * fx + (hz - z) * fz) / l, false) };
  };
  let worst = 0, all = true;
  for (let a = 0; a < 8; a++) {
    const s = hoodStart(a);
    const w = wake(s.x, s.z, s.heading, 60, L.config.flight.cruiseSpeed);
    worst = Math.max(worst, w.d);
    all &&= w.ok;
  }
  function hoodStart(a) {
    const b = (a * Math.PI) / 4;
    return L.hoodStart(sq, heart, Math.cos(b), Math.sin(b));
  }
  report(`${T.names[n]}: the tools' start (&hoodstart) at eight suns, 60 m up, Cruise`, `wakes from each, the farthest ${worst.toFixed(0)} m from a square in three dimensions`, `within ${W.in} m`, all && worst <= W.in);
  const ggb = man.landmarks.find((l) => l.kind === 'ggb');
  const [, t1, t2] = ggb.points;
  const sl = Math.hypot(t2[0] - t1[0], t2[1] - t1[1]);
  const gap = [t1[0] + ((t2[0] - t1[0]) / sl) * 85, t1[1] + ((t2[1] - t1[1]) / sl) * 85];
  const h0 = man.start.heading, fx = Math.sin(h0), fz = -Math.cos(h0);
  const g0 = [gap[0] - fx * 640, gap[1] - fz * 640];
  let none = true;
  for (const [, v] of [['Cruise', L.config.flight.cruiseSpeed], ['Jet', 450]]) none &&= !wake(g0[0], g0[1], Math.atan2(hx - g0[0], -(hz - g0[1])), 60, v).ok;
  report(`${T.names[n]}: the Golden Gate's opening start`, `${near(g0[0], g0[1]).toFixed(0)} m from the block, heading straight for the heart: no wake at Cruise or Jet`, `over ${W.max} m`, none);
}

// ------------------------------------------------------------------ 5. the beam's width
{
  const p00 = 1 / Math.tan((L.config.camera.hfovPortrait * Math.PI) / 360);
  const px = L.config.render.pixelWidth;
  const at = (d) => L.beamWidth(d, p00, px);
  report('the beam 200 m off', `${at(200).toFixed(1)} m`, `${L.BEAM.wMin} m at least`, Math.abs(at(200) - L.BEAM.wMin) < 1e-9);
  const w6 = at(6217), pix = (w6 * p00 * px) / (2 * 6217);
  report('the beam 6,217 m off', `${w6.toFixed(1)} m, ${pix.toFixed(2)} game pixels`, `${L.BEAM.px} game pixels`, Math.abs(pix - L.BEAM.px) < 1e-6);
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
