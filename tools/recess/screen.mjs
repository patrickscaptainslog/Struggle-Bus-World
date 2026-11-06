#!/usr/bin/env node
// ?recess on screen, at a fixed step in software graphics: node tools/recess/screen.mjs <out dir>. BASE is the page (http://localhost:4179/). A short match
// (&recesslen=30), Learner captains, so one match shows every row. The phone and the GPU are the producer's and the first account's.
//   up        the page boots into the match: two captains' buses in the scene, in their colours, over the arena, the player on its edge, no Golden Gate opening
//   programs  nothing compiles after the warm-up: the programs at the first frame are the programs 200 frames on
//   paint     the captains paint the real city in their own one hue as Atlantis and Inferno (blue, red), inside the arena, and their squares count in the score
//   gotcha    the player behind a captain, its glint on it: a real tap's breath at it rides it (Possessed), or it hops out (tried three times)
//   possessed the player ridden: the real gear goes to Nonstop, a flick down only wheezes, full right still turns the bus, its hiccups paint the hitter's hue
//   bell      at the last bell the brain stops and the camera climbs to 1,500 m over the arena: the painted map, and the score in order (scoreboard.png)
//   flag off  the same page without ?recess has no match and no captains
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv[2] ?? 'shots/tmp/recess-screen';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(76)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => (window.__qa = { holdFrames: 4, held: false }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 300)));
  const frames = async (n, extra = {}) => {
    await page.evaluate(([k, x]) => (window.__qa = { ...x, holdFrames: k, held: false }), [n, extra]);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 900000, polling: 50 });
  };
  const open = async (q) => {
    await page.goto(`${BASE}?fixeddt=0.066667&t=2026-11-07T21:00:00Z${q}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 900000, polling: 500 });
  };
  await open('&recess&recesslen=30&bots=learner');
  const programs0 = await page.evaluate(() => window.__game.pipeline.renderer.info.programs.length);
  // ---- up ----
  await frames(45);
  const up = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, f = g.flight;
    const caps = [1, 2].map((i) => g.scene.getObjectByName(`RecessCaptain${i}`)).filter(Boolean);
    const at = caps.map((c) => ({ r: Math.round(Math.hypot(c.position.x - R.cx, c.position.z - R.cz)), agl: Math.round(c.position.y - g.city.groundAt(c.position.x, c.position.z)), shown: c.visible }));
    return { phase: R.phase, captains: caps.length, at, playerR: Math.round(Math.hypot(f.x - R.cx, f.z - R.cz)), simT: +R.sim.t.toFixed(1), camps: R.sim.areas.realm.count };
  });
  row('up: the match, two captains over the arena, the player on its edge', up.phase === 'play' && up.captains === 2 && up.at.every((c) => c.r < 900 && c.agl > 20 && c.shown) && up.playerR < 800 && up.camps === 3, up);
  await page.screenshot({ path: join(dir, 'match.png') });
  // ---- gotcha: behind captain 1, nose on it ----
  let gotcha = null;
  for (let k = 0; k < 3 && !gotcha?.rode; k++) {
    await page.evaluate(() => {
      const R = window.__recess, b = R.sim.buses[1], hg = b.heading + Math.PI / 2;
      window.__qa.pin = { x: R.cx + b.x - Math.sin(hg) * 170, y: R.ys?.[1] ?? 80, z: R.cz + b.z + Math.cos(hg) * 170, heading: hg };
    });
    await frames(3, { pin: await page.evaluate(() => window.__qa.pin) });
    const before = await page.evaluate(() => ({ lock: window.__recess.sim.buses[0].lock, glint: window.__game.aimer.mover?.key ?? null }));
    await page.evaluate(() => { delete window.__qa.pin; window.__game.flight.barfT = -1; window.__game.flight.fullness = 1; window.__game.tapSplat(); });
    await frames(30);
    gotcha = await page.evaluate((b) => ({ ...b, fired: window.__recess.counts.fire ?? 0, hits: window.__recess.counts.hit ?? 0, hops: window.__recess.counts.hop ?? 0, misses: window.__recess.counts.miss ?? 0, rode: window.__recess.sim.buses[1].state === 'ride' || window.__recess.sim.buses[1].state === 'shield' }), before);
  }
  row('gotcha: the glint on a captain, a real tap rides it', !!gotcha && gotcha.glint === 'recess:1' && gotcha.rode, gotcha);
  // ---- possessed: the player ridden by Inferno ----
  const p0 = await page.evaluate(() => {
    const R = window.__recess, S = R.sim;
    S.buses[0].state = 'free';
    S.land(S.buses[2], S.buses[0]);
    return { state: S.buses[0].state, gear: window.__game.controls.turbo.gear };
  });
  await frames(12);
  const p1 = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, took = g.controls.flickGate(-1);
    return { state: R.sim.buses[0].state, gear: g.controls.turbo.gear, took, h0: g.flight.heading };
  });
  await frames(20, { sx: 1, sy: 0 });
  const p2 = await page.evaluate(() => ({ gear: window.__game.controls.turbo.gear, h1: window.__game.flight.heading, hiccups: window.__recess.counts.hiccup ?? 0 }));
  await frames(70);
  const p3 = await page.evaluate(() => {
    const g = window.__game, P = g.city.paint, n = P.data.length >> 2;
    let red = 0;
    for (let i = 0; i < n; i++) { const r = P.get(i); if (r.level > 0.5 && r.faction === 5) red++; }
    return { state: window.__recess.sim.buses[0].state, hiccups: window.__recess.counts.hiccup ?? 0, infernoBuildings: red };
  });
  const turned = Math.abs(Math.atan2(Math.sin(p2.h1 - p1.h0), Math.cos(p2.h1 - p1.h0)));
  row('possessed: Nonstop, a flick down only wheezes, full right still turns, the hiccups paint the hitter\'s', p0.state === 'ride' && p1.took && p1.gear === 2 && p2.gear === 2 && turned > 0.1 && p3.hiccups >= 8 && p3.infernoBuildings > 0,
    { p0, gear: p1.gear, took: p1.took, turnedRad: +turned.toFixed(2), ...p3 });
  await page.screenshot({ path: join(dir, 'possessed.png') });
  // ---- paint: the captains' own hues on the city, in the arena, and in the score ----
  const paint = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, P = g.city.paint, n = P.data.length >> 2, by = { 1: 0, 2: 0, 5: 0 }, hues = { 2: new Set(), 5: new Set() };
    for (let i = 0; i < n; i++) {
      const r = P.get(i);
      if (r.level < 0.5) continue;
      by[r.faction] = (by[r.faction] ?? 0) + 1;
      if (hues[r.faction]) hues[r.faction].add(r.color);
    }
    return { buildings: by, atlantisHues: [...hues[2]], infernoHues: [...hues[5]], score: R.sim.score().filter((_, i) => [1, 2, 5].includes(i)), paints: R.counts.paint ?? 0 };
  });
  row('paint: the captains paint the city in one hue each (Atlantis blue 4, Inferno red 0), and it scores', paint.buildings[2] > 0 && paint.atlantisHues.every((h) => h === 4) && paint.infernoHues.every((h) => h === 0) && paint.score[1] > 0, paint);
  // ---- the bell ----
  for (let k = 0; k < 20 && (await page.evaluate(() => window.__recess.phase)) !== 'over'; k++) await frames(30);
  await frames(75);
  const bell = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, c = g.camera.position;
    return { phase: R.phase, simT: +R.sim.t.toFixed(1), camAGL: Math.round(c.y - g.city.groundAt(R.cx, R.cz)), camFromMiddle: Math.round(Math.hypot(c.x - R.cx, c.z - R.cz)), score: R.sim.score().filter((_, i) => [1, 2, 5].includes(i)), hud: document.querySelector('[data-hud=recess]')?.childElementCount ?? 0 };
  });
  await page.screenshot({ path: join(dir, 'scoreboard.png') });
  row('bell: the brain stops, the camera at 1,500 m over the arena, the score up', bell.phase === 'over' && bell.simT <= 30.1 && Math.abs(bell.camAGL - 1500) < 60 && bell.camFromMiddle < 700 && bell.hud === 1, bell);
  const programs1 = await page.evaluate(() => window.__game.pipeline.renderer.info.programs.length);
  row('programs: nothing compiled after the warm-up, the whole match on', programs1 === programs0, { atFirst: programs0, atTheEnd: programs1 });
  // ---- flag off ----
  await open('&lat=37.7745&lon=-122.43');
  const off = await page.evaluate(() => ({ recess: !!window.__recess, captains: [1, 2].filter((i) => window.__game.scene.getObjectByName(`RecessCaptain${i}`)).length, hud: !!document.querySelector('[data-hud=recess]') }));
  row('flag off: no match, no captains, no clock', !off.recess && off.captains === 0 && !off.hud, off);
  row('no page errors', errors.length === 0, errors.slice(0, 5));
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
