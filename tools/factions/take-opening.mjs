#!/usr/bin/env node
// Taking the block, part A's opening in the browser (docs/specs/factions/LIFT.md, "Taking the block"): the producer's link, ?lift&lifted=inferno,
// starts as every page does. Three pages at a fixed step (&fixeddt, so their clocks agree frame for frame) on the same date and clock
// (&t=...&rate=0): the plain page, ?lift&lifted=inferno and ?lift alone, each frozen every 0.5 s of game time (__qa.holdAt) from the first frame.
//   - ?lift&lifted=inferno starts at the opening's start (within 50 m of the Golden Gate's gap less 640 m along the start heading, at 0.5 s);
//   - the bus's and the camera's poses on it are the plain page's, within 0.5 m and 0.2 degrees, every sample until the glance begins (the
//     opening's gate opening), over at least the first 12 s;
//   - then the glance: the look's yaw reaches at least 25 degrees toward the heart and comes home to 0;
//   - ?lift alone: the bridge's start (the plain page's pose at 0.5 s), and no far sign (no beam).
// Writes <out>/take-opening.json; prints pass or FAIL a line; exit 1 on any failure, a page error or a shader error.
//
//   node tools/factions/take-opening.mjs <url> <outDir>
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserOptions } from '../browser.mjs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = pos[0] ?? 'http://127.0.0.1:4179/';
const out = resolve(pos[1] ?? 'shots/tmp/take-opening');
mkdirSync(out, { recursive: true });
const CLOCK = '&t=2026-11-06T20:49:00Z&rate=0&fixeddt=0.016666666666666666&nohud';
const STEP = 0.5, UNTIL = 45;

let failed = 0;
function report(name, value, limit, ok) {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${value}  (${limit})`);
}

const browser = await chromium.launch({ ...browserOptions([]) });
async function open(q) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => {
    failed++;
    console.log('[pageerror]', e.message);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error' || m.text().startsWith('Failed to load resource')) return;
    failed++;
    console.log('[console error]', m.text().slice(0, 1500));
  });
  // (frozen at the first sample from the first frame, so every page's clock is the same frame count when read)
  await page.addInitScript((t) => (window.__qa = { holdAt: t }), STEP);
  await page.goto(base + q, { waitUntil: 'load' });
  return page;
}
/** the poses at game time t (the frame at or past it): the bus, the camera (its forward's yaw and pitch, degrees), the look's yaw */
async function at(page, t) {
  await page.evaluate((t) => {
    window.__qa.held = false;
    window.__qa.holdAt = t;
  }, t);
  await page.waitForFunction(() => window.__qa.held === true && !!window.__game, null, { timeout: 600000, polling: 20 });
  return page.evaluate(() => {
    const g = window.__game, f = g.flight, c = g.camera, q = c.quaternion;
    const fx = -2 * (q.x * q.z + q.w * q.y), fy = -2 * (q.y * q.z - q.w * q.x), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const l = g.lift;
    return {
      t: g.splatter.clock,
      bus: [f.x, f.y, f.z],
      heading: f.heading,
      cam: [c.position.x, c.position.y, c.position.z],
      yaw: (Math.atan2(fx, -fz) * 180) / Math.PI,
      pitch: (Math.asin(Math.max(-1, Math.min(1, fy))) * 180) / Math.PI,
      look: (g.rig.lookYawNow * 180) / Math.PI,
      lift: l ? { beam: !!l.beam, heart: l.heart, waveAt: l.waveAt } : null,
    };
  });
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dAng = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

const rec = { plain: [], lifted: [], alone: [] };
// (one page at a time: the laptop has 8 GB. At a fixed step each page's poses are a function of its clock alone)
const plain = await open(`?${CLOCK.slice(1)}`);
for (let t = STEP; t <= UNTIL + 1e-9; t += STEP) rec.plain.push(await at(plain, t));
await plain.close();
const alone = await open(`?lift${CLOCK}`);
const a0 = await at(alone, STEP);
rec.alone.push(a0);
await alone.close();
const lifted = await open(`?lift&lifted=inferno${CLOCK}`);
const p0 = rec.plain[0], l0 = await at(lifted, STEP);
rec.lifted.push(l0);
const start = await lifted.evaluate(() => {
  const m = window.__game.city.manifest, ggb = m.landmarks.find((l) => l.kind === 'ggb');
  const [, t1, t2] = ggb.points, sl = Math.hypot(t2[0] - t1[0], t2[1] - t1[1]);
  const gap = [t1[0] + ((t2[0] - t1[0]) / sl) * 85, t1[1] + ((t2[1] - t1[1]) / sl) * 85];
  const h = m.start.heading;
  return [gap[0] - Math.sin(h) * 640, gap[1] + Math.cos(h) * 640];
});
const ds = Math.hypot(l0.bus[0] - start[0], l0.bus[2] - start[1]);
report('?lift&lifted=inferno starts at the opening', `${ds.toFixed(1)} m from the Golden Gate's gap less 640 m at ${l0.t.toFixed(2)} s`, 'within 50 m', ds <= 50);
report('?lift&lifted=inferno has its far sign', String(l0.lift?.beam), 'true', l0.lift?.beam === true);
report('?lift alone starts at the bridge, as the plain page', `${dist(a0.bus, p0.bus).toFixed(3)} m from it`, 'within 0.5 m', dist(a0.bus, p0.bus) <= 0.5);
report('?lift alone has no far sign', String(a0.lift?.beam), 'false', a0.lift !== null && a0.lift.beam === false);

// ---- the same opening until the glance
let worstBus = 0, worstCam = 0, worstAng = 0, same = 0, glanceT = -1, t = STEP;
for (let k = 1; k < rec.plain.length; k++) {
  t += STEP;
  const p = rec.plain[k], l = await at(lifted, t);
  rec.lifted.push(l);
  if (Math.abs(p.t - l.t) > 1e-6) console.log(`[note] the clocks differ at ${t}: ${p.t} and ${l.t}`);
  if (Math.abs(l.look) > 1e-6) {
    glanceT = l.t;
    break;
  }
  worstBus = Math.max(worstBus, dist(p.bus, l.bus));
  worstCam = Math.max(worstCam, dist(p.cam, l.cam));
  worstAng = Math.max(worstAng, dAng(p.yaw, l.yaw), dAng(p.pitch, l.pitch));
  same = l.t;
}
const paired = rec.lifted.length;
report('the clocks frame for frame', `${paired} samples`, 'the same game time on both pages', rec.lifted.every((l, k) => Math.abs(rec.plain[k].t - l.t) < 1e-6));
report('the opening, ?lift&lifted=inferno against the plain page', `the bus ${worstBus.toFixed(3)} m, the camera ${worstCam.toFixed(3)} m and ${worstAng.toFixed(3)} degrees apart at worst, to ${same.toFixed(2)} s`, 'within 0.5 m and 0.2 degrees, over 12 s at least', worstBus <= 0.5 && worstCam <= 0.5 && worstAng <= 0.2 && same >= 12);

// ---- the glance
let peak = 0, home = false, toward = 0;
if (glanceT >= 0) {
  const g0 = rec.lifted.at(-1), [hx, hz] = g0.lift.heart;
  const fx = Math.sin(g0.heading), fz = -Math.cos(g0.heading);
  const ex = hx - g0.bus[0], ez = hz - g0.bus[2];
  toward = Math.sign(ex * -fz + ez * fx) || 1;
  for (let k = 0; k < 20 && !home; k++) {
    t += 0.25;
    const l = await at(lifted, t);
    rec.lifted.push(l);
    peak = Math.max(peak, l.look * toward);
    home = peak > 0 && l.look === 0;
  }
}
report('the glance toward the heart', glanceT < 0 ? 'none' : `from ${glanceT.toFixed(2)} s, ${peak.toFixed(1)} degrees toward it at most, ${home ? 'home again' : 'not home'}`, 'at least 25 degrees, and home', glanceT >= 0 && peak >= 25 && home);
await browser.close();
writeFileSync(`${out}/take-opening.json`, JSON.stringify(rec, null, 1));
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
