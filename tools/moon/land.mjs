#!/usr/bin/env node
// The way down, with a real thumb: node tools/moon/land.mjs <out dir> [--t=2026-11-25T04:00:00Z] [--dt=] [--every=3] [--push=90] [--q=] [--secs=120] [--fast]
// Opens ?moonland, skips the trip to the orbit (the route's own step, not drawn), lays a thumb on the screen and pushes it, and holds it there. A frame every few seconds of the fall and a line of what the page says each time, on one page,
// with what programs and how long a frame took around the two hand-overs. --dt is the game's fixed step: with one, nothing here is a timing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const dir = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', '2026-11-25T04:00:00Z'), dt = opt('dt', ''), every = Number(opt('every', 3)), push = Number(opt('push', 90)), extra = opt('q', ''), secs = Number(opt('secs', 120));
mkdirSync(dir, { recursive: true });
const W = 393, H = 852;
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall') && !m.text().includes('did not converge')) errors.push(`${m.type()} ${m.text().slice(0, 200)}`);
  });
  const t0 = Date.now();
  await page.goto(`${BASE}?moonland&t=${t}${dt ? `&fixeddt=${dt}` : ''}${extra ? `&${extra}` : ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  const first = Date.now() - t0;
  await page.waitForFunction(() => window.__space?.moon.landing.world != null, null, { timeout: 180000 });
  const world = Date.now() - t0;
  await page.waitForFunction(() => window.__space.moon.draw.ground?.ready !== false, null, { timeout: 60000 });
  const load = await page.evaluate(() => ({ programs: window.__space.pipeline.renderer.info.programs.length, warm: window.__game?.warm?.report?.doneMs ?? null, space: window.__space.moon.load }));
  console.log(`first frame ${first} ms, the low game ready behind it ${world} ms, ${load.programs} programs, warm-up ${load.warm} ms`, JSON.stringify(load.space));
  await page.evaluate(() => {
    const s = window.__space, m = s.moon, info = s.pipeline.renderer.info;
    m.hold(true);
    m.skip(0.1);
    m.trip.tap();
    m.skip(0.1);
    m.trip.tap();
    for (let i = 0; i < 40000 && m.trip.leg !== 'orbit'; i++) m.skip(0.05);
    m.hold(false);
    window.__p0 = info.programs.length;
    // a frame's length, from the page's own clock, kept round everything that could hitch
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push([Math.round(now - last), m.trip.leg, Math.round(m.landing.height)]);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(dir, '00-orbit.png') });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  const read = () => page.evaluate(() => {
    const s = window.__space, m = s.moon, g = window.__game, f = g.flight, l = m.landing, tr = m.trip, r = (x, k = 1) => +(+x).toFixed(k);
    const low = l.ground;
    return {
      leg: tr.leg, clock: r(tr.t, 1), h: low ? r(f.height / 1000, 2) : r(l.height, 1), v: low ? r(f.speed) : r(tr.v * tr.gov * 1000), nose: r(((low ? f.nose : tr.nose) * 180) / Math.PI, 0), gov: r(tr.gov, 2), show: r(l.show, 2), near: l.near,
      gear: g.controls.turbo.gear, y: low ? r(f.y - g.city.groundAt(f.x, f.z), 1) : null, tiles: g.city.loadedRegionCount(), programs: s.pipeline.renderer.info.programs.length,
    };
  });
  const x = W / 2, y = H * 0.68;
  await touch('touchStart', x, y);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', x, y - (push * i) / 6);
    await page.waitForTimeout(16);
  }
  const log = [];
  let n = 1, at = -1e9, s = await read();
  const c0 = s.clock;
  const wall0 = Date.now();
  for (;;) {
    s = await read();
    log.push(s);
    if (s.clock - at >= every) {
      at = s.clock;
      const name = `${String(n++).padStart(2, '0')}-${s.h}km`;
      await page.screenshot({ path: join(dir, `${name}.png`) });
      console.log(`${(s.clock - c0).toFixed(1).padStart(6)} s  ${String(s.leg).padEnd(7)} ${String(s.h).padStart(7)} km  ${String(s.v).padStart(8)} m/s  nose ${String(s.nose).padStart(4)}  gov ${s.gov}  show ${s.show}  gear ${s.gear}  tiles ${s.tiles}  clearance ${s.y}`);
    }
    if (s.leg === 'ground' && s.y !== null && s.y < 14) break;
    if (Date.now() - wall0 > secs * 1000) {
      console.log('out of time');
      break;
    }
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: join(dir, `${String(n++).padStart(2, '0')}-floor.png`) });
  await touch('touchEnd');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(dir, `${String(n++).padStart(2, '0')}-skim.png`) });
  const end = await page.evaluate(() => {
    const s = window.__space, g = window.__game, f = g.flight, frames = window.__frames;
    const legs = {};
    for (const [ms, leg] of frames) (legs[leg] ??= []).push(ms);
    const worst = (a) => [...a].sort((x, y) => y - x).slice(0, 5);
    const flip = frames.findIndex((r) => r[1] === 'ground');
    return {
      programsAdded: s.pipeline.renderer.info.programs.slice(window.__p0).map((p) => p.name + ' ' + String(p.cacheKey).slice(0, 80)),
      legs: Object.fromEntries(Object.entries(legs).map(([k, v]) => [k, { frames: v.length, mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length), worst: worst(v) }])),
      aroundShow: frames.slice(Math.max(0, frames.findIndex((r) => r[2] <= 120) - 3)).slice(0, 12).map((r) => r[0]),
      aroundGround: flip >= 0 ? frames.slice(Math.max(0, flip - 4), flip + 12).map((r) => r[0]) : [],
      clearance: +(f.y - g.city.groundAt(f.x, f.z)).toFixed(1), floorGap: +(f.y - f.floorY).toFixed(1), speed: +f.speed.toFixed(1), tiles: g.city.loadedRegionCount(), gear: g.controls.turbo.gear,
    };
  });
  console.log(JSON.stringify(end, null, 0));
  writeFileSync(join(dir, 'log.json'), JSON.stringify({ first, world, load, end, log, errors }, null, 0));
} finally {
  console.log(errors.length ? `errors:\n  ${errors.slice(0, 12).join('\n  ')}` : 'no errors');
  await browser.close();
}
