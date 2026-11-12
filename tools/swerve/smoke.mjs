#!/usr/bin/env node
// ?swerve stands up in a browser and does what its Node rows say, a frame at a time at 1x: node tools/swerve/smoke.mjs [out=shots/tmp/swerve]
// A served build (BASE, default http://localhost:4179/). One page over the Mission at a fixed step: the hard turn bites (the thumb at 124 px turns the bus
// faster than the stick alone at its limit), a skid starts, slips and sprays, eased back in it grips and throws the wave and spends the belly, the long swipe takes Jet to Cruise,
// a page without ?swerve has none of it, and nothing compiled on the way (the programs' count). Frames land in `out`. Prints a row each, exits 1 on a failure.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const OUT = process.argv[2] ?? 'shots/tmp/swerve', BASE = process.env.BASE ?? 'http://localhost:4179/';
const Q = 'skipintro&lat=37.7599&lon=-122.4148&heading=0&fixeddt=0.033333&t=2026-11-07T21:00:00Z';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (ok, name, o) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(22)} ${JSON.stringify(o)}`);
};
async function open(q) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => (window.__qa = { holdFrames: 4, held: false }));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`.slice(0, 300)));
  page.on('console', (m) => {
    // (a failed load says so here without its address: the responses below name it, and the page has no icon of its own, on main too)
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console ${m.text()}`.slice(0, 300));
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`.slice(0, 200));
  });
  await page.goto(`${BASE}?${q}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 900000, polling: 500 });
  const frames = async (n) => {
    await page.evaluate((k) => (window.__qa = { ...window.__qa, holdFrames: k, held: false }), n);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 900000, polling: 50 });
  };
  const read = () =>
    page.evaluate(() => {
      const g = window.__game, f = g.flight, s = window.__swerve, t = g.controls.turbo;
      return {
        heading: f.heading, yaw: f.yawRate, speed: f.speed, full: f.fullness, y: f.y, gear: t.gear + t.level, below: t.below,
        swerve: s ? { hard: s.core.hard, sliding: s.core.sliding, skidding: s.core.skidding, slip: s.slip, roll: s.roll, pitch: s.pitch } : null,
        programs: g.pipeline?.renderer?.info?.programs?.length ?? null,
      };
    });
  const stick = (sx, thumb) => page.evaluate(([x, th]) => {
    window.__qa = { ...window.__qa, sx: x, sy: 0 };
    if (x === null) {
      delete window.__qa.sx;
      delete window.__qa.sy;
    }
    if (window.__swerve) window.__swerve.thumb = th;
  }, [sx, thumb]);
  return { ctx, page, errors, frames, read, stick };
}

try {
  // ---- without ?swerve: none of it, and the stick's own limit to hold the hard turn against
  let todayYaw = 0;
  {
    const P = await open(Q);
    await P.frames(30);
    await P.stick(1, null);
    await P.frames(30);
    const a = await P.read();
    todayYaw = a.yaw;
    row(a.swerve === null && P.errors.length === 0, 'the page without it', { swerve: a.swerve, yawAtTheLimit: +a.yaw.toFixed(2), errors: P.errors.slice(0, 4) });
    await P.ctx.close();
  }
  const P = await open(`swerve&${Q}`);
  await P.frames(30);
  const p0 = (await P.read()).programs;
  // ---- the hard turn
  await P.stick(1, 124);
  await P.frames(30);
  const hard = await P.read();
  await P.page.screenshot({ path: `${OUT}/hard.png` });
  row(hard.swerve.hard === 1 && !hard.swerve.skidding && hard.yaw > todayYaw * 1.3, 'the hard turn', { hard: hard.swerve.hard, yaw: +hard.yaw.toFixed(2), todayAtTheLimit: +todayYaw.toFixed(2) });
  // ---- the skid
  await P.stick(0, null);
  await P.frames(45);
  await P.stick(1, 172);
  await P.frames(18);
  const skid = await P.read();
  await P.page.screenshot({ path: `${OUT}/skid.png` });
  row(skid.swerve.sliding && skid.swerve.slip > 0.4 && skid.swerve.roll < -0.02 && skid.full > 0.99, 'the skid', { sliding: skid.swerve.sliding, slipDeg: +((skid.swerve.slip * 180) / Math.PI).toFixed(1), rollDeg: +((skid.swerve.roll * 180) / Math.PI).toFixed(1), speed: +skid.speed.toFixed(1) });
  // ---- its grip, and the wave: eased back in, the thumb's own grip (a lift, or the slide's time up, keeps the belly for the next tap: SWERVE.md section 4)
  await P.stick(1, 110);
  await P.frames(3);
  const grip = await P.read();
  await P.stick(0, null);
  await P.frames(12);
  await P.page.screenshot({ path: `${OUT}/wave.png` });
  await P.frames(20);
  const after = await P.read();
  await P.page.screenshot({ path: `${OUT}/after.png` });
  row(grip.swerve.skidding && !grip.swerve.sliding && grip.full < 0.2 && !after.swerve.skidding && after.swerve.slip === 0, 'the grip and the wave', { bellyAtTheGrip: +grip.full.toFixed(2), slipAfter: after.swerve.slip, headingTurnedDeg: +(((after.heading - skid.heading + skid.swerve.slip * 0) * 180) / Math.PI).toFixed(1) });
  // ---- the long swipe, from Jet
  await P.page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 3; i++) g.controls.turbo.rung(1, g.flight);
  });
  for (let k = 0; k < 40; k++) {
    await P.frames(15);
    const s = await P.read();
    if (s.gear === 3 && s.speed > 440) break;
  }
  const jet = await P.read();
  await P.page.evaluate(() => window.__swerve.swipe());
  await P.frames(5);
  await P.page.screenshot({ path: `${OUT}/brake.png` });
  await P.frames(19);
  const braked = await P.read();
  row(jet.gear === 3 && braked.gear === 0 && braked.below === 0 && braked.speed < 35, 'the long swipe', { from: +jet.speed.toFixed(0), after0p8s: +braked.speed.toFixed(1), rung: braked.gear, heightKept: +(braked.y - jet.y).toFixed(1) });
  const p1 = (await P.read()).programs;
  row(p1 === p0 && P.errors.length === 0, 'nothing compiled', { programs: [p0, p1], errors: P.errors.slice(0, 4) });
  await P.ctx.close();
} finally {
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
