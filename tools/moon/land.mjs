#!/usr/bin/env node
// The way down, with a real thumb: node tools/moon/land.mjs <out dir> [--t=2026-11-25T04:00:00Z] [--dt=] [--every=3] [--push=90] [--steer=0] [--q=] [--secs=120] [--burst] [--late=0] [--pull=0] [--lift=0]
// Opens ?moonland, skips the trip to the orbit (the route's own step, not drawn), lays a thumb on the screen and pushes it, and holds it there, in one page. A frame every few seconds of the fall, a line of what the page says each time, and at the end
// what compiled in flight and how long the frames took. --dt is the game's fixed step: with one, nothing here is a timing.
//   --burst   frames as fast as they can be taken through the two hand-overs, 125 to 85 km and 16 to 11 km, in burst/
//   --late=ms the far field's first ask held back that long: the fall must hold, not show a hole
//   --pull=h  the thumb goes down at h km, and the bus is flown back up; the run ends at the top, or at --secs
//   --lift=h  the thumb lets go at h km for 3 s and pushes again
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const dir = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', '2026-11-25T04:00:00Z'), dt = opt('dt', ''), every = Number(opt('every', 3)), push = Number(opt('push', 90)), extra = opt('q', ''), secs = Number(opt('secs', 120));
const steer = Number(opt('steer', 0)), burst = args.includes('--burst'), late = Number(opt('late', 0)), pullAt = Number(opt('pull', 0)), liftAt = Number(opt('lift', 0));
mkdirSync(dir, { recursive: true });
if (burst) mkdirSync(join(dir, 'burst'), { recursive: true });
const W = 393, H = 852;
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall') && !m.text().includes('did not converge') && !m.text().includes('404')) errors.push(`${m.type()} ${m.text().slice(0, 200)}`);
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
  await page.evaluate((late) => {
    const s = window.__space, m = s.moon, info = s.pipeline.renderer.info;
    m.hold(true);
    m.skip(0.1);
    m.trip.tap();
    m.skip(0.1);
    m.trip.tap();
    for (let i = 0; i < 40000 && m.trip.leg !== 'orbit'; i++) m.skip(0.05);
    m.hold(false);
    if (late) {
      const far = m.landing.world.far, f = far.place;
      far.place = function (...a) {
        setTimeout(() => f.apply(this, a), late);
      };
    }
    // what compiles in flight, and what takes a frame's whole time, by name
    window.__compiled = [];
    const src = WebGL2RenderingContext.prototype.shaderSource;
    WebGL2RenderingContext.prototype.shaderSource = function (sh, text) {
      window.__compiled.push([text.length, (text.match(/uniform [^;]*;/g) ?? []).slice(-5).join(' ').slice(0, 200)]);
      return src.call(this, sh, text);
    };
    window.__slow = [];
    const g = window.__game, wrap = (o, name, label) => {
      const f = o[name];
      o[name] = function (...a) {
        const t = performance.now();
        const r = f.apply(this, a);
        const ms = performance.now() - t;
        if (ms > 25) window.__slow.push([label ?? name, Math.round(ms), Math.round(m.landing.height)]);
        return r;
      };
    };
    wrap(g.city, 'update', 'city.update');
    wrap(g.pipeline, 'render', 'render');
    wrap(g.moon.far, 'update', 'far.update');
    wrap(g.moon.paint, 'update', 'paint.update');
    wrap(g.controls, 'frame', 'controls.frame');
    wrap(g.flight, 'step', 'flight.step');
    // a frame's length, from the page's own clock, and what it drew, kept round everything that could hitch
    window.__frames = [];
    window.__draws = {};
    let last = performance.now();
    info.autoReset = false;
    const tick = (now) => {
      window.__frames.push([Math.round(now - last), m.trip.leg, Math.round(m.landing.height), m.landing.near ? 1 : 0]);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (const perf of [s.perf, g.perf]) {
      const f = perf.frame.bind(perf);
      perf.frame = (a, b) => {
        const leg = m.trip.leg, k = leg === 'ground' ? (g.flight.height < 500 ? 'ground, low' : 'ground, high') : m.landing.near ? 'fall, near' : leg;
        const d = (window.__draws[k] ??= [0, 0]);
        d[0] = Math.max(d[0], info.render.calls);
        d[1] = Math.max(d[1], info.render.triangles);
        info.reset();
        f(a, b);
      };
    }
  }, late);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(dir, '00-orbit.png') });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  const read = () => page.evaluate(() => {
    const s = window.__space, m = s.moon, g = window.__game, f = g.flight, l = m.landing, tr = m.trip, r = (x, k = 1) => +(+x).toFixed(k);
    const low = l.ground;
    return {
      leg: tr.leg, clock: r(tr.t, 1), h: low ? r(f.height / 1000, 2) : r(l.height, 1), v: low ? r(f.speed) : r(tr.v * tr.gov * 1000), nose: r(((low ? f.nose : tr.nose) * 180) / Math.PI, 0), gov: r(tr.gov, 2), show: r(l.show, 2), near: l.near,
      gear: g.controls.turbo.gear, y: low ? r(f.y - g.city.groundAt(f.x, f.z), 1) : null, tiles: g.city.loadedRegionCount(),
    };
  });
  const x = W / 2, y = H * 0.68;
  const thumb = async (dx, dy) => {
    await touch('touchMove', x + dx, y + dy);
    await page.waitForTimeout(16);
  };
  await touch('touchStart', x, y);
  for (let i = 1; i <= 6; i++) await thumb((steer * i) / 6, -(push * i) / 6);
  const log = [];
  let n = 1, at = -1e9, s = await read(), b = 0, pulled = false, lifted = 0, liftT = 0;
  const c0 = s.clock;
  const wall0 = Date.now();
  for (;;) {
    s = await read();
    log.push(s);
    if (burst && ((s.h <= 125 && s.h >= 85) || (s.h <= 16 && s.h >= 11))) await page.screenshot({ path: join(dir, 'burst', `${String(b++).padStart(3, '0')}-${s.h}km.png`) });
    else if (s.clock - at >= every) {
      at = s.clock;
      await page.screenshot({ path: join(dir, `${String(n++).padStart(2, '0')}-${s.h}km.png`) });
      console.log(`${(s.clock - c0).toFixed(1).padStart(6)} s  ${String(s.leg).padEnd(7)} ${String(s.h).padStart(7)} km  ${String(s.v).padStart(8)} m/s  nose ${String(s.nose).padStart(4)}  gov ${s.gov}  show ${s.show}  gear ${s.gear}  tiles ${s.tiles}  clearance ${s.y}`);
    }
    if (pullAt && !pulled && s.h <= pullAt) {
      pulled = true;
      await thumb(0, push);
      console.log(`  pulled at ${s.h} km`);
    }
    if (liftAt && !lifted && s.h <= liftAt) {
      lifted = 1;
      liftT = s.clock;
      await touch('touchEnd');
      console.log(`  lifted at ${s.h} km`);
    }
    if (lifted === 1 && s.clock - liftT > 3) {
      lifted = 2;
      console.log(`  pushed again at ${s.h} km, nose ${s.nose}, near ${s.near}`);
      await touch('touchStart', x, y);
      for (let i = 1; i <= 6; i++) await thumb(0, -(push * i) / 6);
    }
    if (s.leg === 'ground' && s.y !== null && s.y < 14 && !pullAt) break;
    if (pullAt && pulled && s.leg === 'orbit') {
      console.log(`  back in orbit: ${s.h} km, ${s.v} m/s`);
      break;
    }
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
  // a tap down there: the low game's thumb, a breath, a crater
  await touch('touchStart', x, y);
  await page.waitForTimeout(70);
  await touch('touchEnd');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(dir, `${String(n++).padStart(2, '0')}-tap.png`) });
  console.log('after a tap:', await page.evaluate(() => JSON.stringify({ shot: !!window.__game.lastShot(), painted: window.__game.moon.paint.recs.size })));
  const end = await page.evaluate(() => {
    const g = window.__game, f = g.flight, frames = window.__frames;
    const legs = {};
    for (const [ms, leg] of frames) (legs[leg] ??= []).push(ms);
    const worst = (a) => [...a].sort((x, y) => y - x).slice(0, 4);
    const flip = frames.findIndex((r) => r[1] === 'ground');
    const near = frames.findIndex((r) => r[3] === 1);
    return {
      compiled: window.__compiled,
      slow: window.__slow.slice(0, 8),
      legs: Object.fromEntries(Object.entries(legs).map(([k, v]) => [k, { frames: v.length, mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length), worst: worst(v) }])),
      aroundNear: near >= 0 ? frames.slice(Math.max(0, near - 3), near + 8).map((r) => r[0]) : [],
      aroundGround: flip >= 0 ? frames.slice(Math.max(0, flip - 3), flip + 12).map((r) => r[0]) : [],
      draws: window.__draws,
      clearance: +(f.y - g.city.groundAt(f.x, f.z)).toFixed(1), floorGap: +(f.y - f.floorY).toFixed(1), speed: +f.speed.toFixed(1), tiles: g.city.loadedRegionCount(), gear: g.controls.turbo.gear,
    };
  });
  console.log(JSON.stringify(end));
  writeFileSync(join(dir, 'log.json'), JSON.stringify({ first, world, load, end, log, errors }));
} finally {
  console.log(errors.length ? `errors:\n  ${errors.slice(0, 12).join('\n  ')}` : 'no errors');
  await browser.close();
}
