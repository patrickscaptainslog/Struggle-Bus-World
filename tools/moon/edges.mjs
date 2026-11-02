#!/usr/bin/env node
// The corners of ?moonland that a whole flight doesn't go round: node tools/moon/edges.mjs <out dir> [--only=abort,stratos,big,site]
//   abort    a fall called off with TURBO, then a push on the way back up, and on to the ground
//   stratos  two taps of TURBO on the ground, and level at Stratos for a while, and down again
//   big      a crater over 1 km takes a level: it goes on the orbit's map, and its big mark doesn't lie on the ground
//   site     a splash from orbit over a crewed site: inside its line it stays grey
// The long dark is skipped, the thumbs are real, and the crater and the splash are put there by hand.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const dir = args.find((a) => !a.startsWith('--'));
const only = opt('only', 'abort,stratos,big,site').split(',');
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', '2026-11-25T04:00:00Z');
mkdirSync(dir, { recursive: true });
const W = 393, H = 852, x0 = W / 2, y0 = H * 0.68;
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const errors = [];

async function open() {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall') && !m.text().includes('did not converge') && !m.text().includes('404')) errors.push(`${m.type()} ${m.text().slice(0, 300)}`);
  });
  await page.goto(`${BASE}?moonland&t=${t}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__space?.moon.landing.world != null, null, { timeout: 180000 });
  await page.evaluate(() => {
    const m = window.__space.moon;
    m.hold(true);
    m.trip.tap();
    m.skip(0.1);
    m.trip.tap();
    for (let i = 0; i < 40000 && m.trip.leg !== 'orbit'; i++) m.skip(0.05);
    m.hold(false);
  });
  await page.waitForTimeout(800);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
  const read = () => page.evaluate(() => {
    const s = window.__space, m = s.moon, g = window.__game, f = g.flight, l = m.landing, tr = m.trip, r = (x, k = 1) => +(+x).toFixed(k);
    const low = l.ground;
    return { leg: tr.leg, clock: r(tr.t), h: low ? r(f.height / 1000, 2) : r(l.height), v: low ? r(f.speed) : r(tr.v * tr.gov * 1000), nose: r(((low ? f.nose : tr.nose) * 180) / Math.PI, 0), show: r(l.show, 2), near: l.near, low, gear: low ? g.controls.turbo.gear : tr.gear, climb: tr.climbV, gap: low ? r(f.y - f.floorY, 1) : null, tiles: g.city.loadedRegionCount(), say: document.querySelector('[data-hud="trip-label"]')?.dataset.say ?? '', painted: +(m.breath.paint.painted * 100).toFixed(4) };
  });
  const say = (s, note = '') => console.log(`${String(s.clock).padStart(7)} s ${s.leg.padEnd(7)} ${String(s.h).padStart(8)} km ${String(s.v).padStart(8)} m/s nose ${String(s.nose).padStart(4)} G${s.gear} show ${s.show} ${note}`);
  const turbo = async (down) => {
    const b = await page.evaluate((q) => {
      const e = [...document.querySelectorAll(q)].map((x) => x.getBoundingClientRect()).find((r) => r.width > 0);
      return e ? [e.left + e.width / 2, e.top + e.height / 2] : null;
    }, down ? '[data-hud="gear-down"]' : '[data-hud="turbo"]');
    if (!b) throw new Error('no such button');
    await touch('touchStart', [[b[0], b[1], 5]]);
    await page.waitForTimeout(60);
    await touch('touchEnd', []);
  };
  const push = async (dy = -90) => {
    await touch('touchStart', [[x0, y0, 1]]);
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', [[x0, y0 + (dy * i) / 6, 1]]);
      await page.waitForTimeout(16);
    }
  };
  const lift = () => touch('touchEnd', []);
  const until = async (name, f, secs = 90) => {
    const wall = Date.now();
    let at = 0;
    for (;;) {
      const s = await read();
      if (Date.now() - at > 3000) {
        at = Date.now();
        say(s, name);
      }
      if (f(s)) return s;
      if (Date.now() - wall > secs * 1000) {
        console.log(`  ${name}: out of time ${JSON.stringify(s)}`);
        return s;
      }
      await page.waitForTimeout(100);
    }
  };
  const shot = (name) => page.screenshot({ path: join(dir, `${name}.png`) });
  return { ctx, page, read, say, turbo, push, lift, until, shot };
}

try {
  if (only.includes('abort')) {
    console.log('--- abort');
    const p = await open();
    await p.push();
    await p.until('falling', (s) => s.leg === 'fall' && s.h < 85);
    await p.lift();
    await p.page.waitForTimeout(150);
    await p.turbo();
    const s = await p.until('called off', (s) => s.h > 125 && s.nose > 0, 20);
    p.say(s, 'pushing again');
    await p.shot('abort-up');
    await p.push();
    await p.until('down again', (s) => s.leg === 'ground', 60);
    await p.until('to the floor', (s) => s.gap !== null && s.gap < 20, 30);
    p.say(await p.read(), 'on the floor');
    await p.lift();
    await p.shot('abort-floor');
    await p.ctx.close();
  }
  if (only.includes('stratos')) {
    console.log('--- stratos');
    const p = await open();
    await p.push();
    await p.until('falling', (s) => s.leg === 'ground' && s.gap < 20);
    await p.lift();
    await p.page.waitForTimeout(1500);
    await p.turbo();
    await p.page.waitForTimeout(500);
    await p.turbo();
    await p.until('lifting to Stratos', (s) => s.h > 1.9, 20);
    for (let i = 0; i < 6; i++) {
      await p.page.waitForTimeout(3000);
      p.say(await p.read(), `tiles ${(await p.read()).tiles}`);
      if (i === 2) await p.shot('stratos');
    }
    await p.turbo(true);
    await p.page.waitForTimeout(6000);
    p.say(await p.read(), 'shifted down');
    await p.shot('stratos-jet');
    await p.ctx.close();
  }
  if (only.includes('big')) {
    console.log('--- big');
    const p = await open();
    await p.push();
    await p.until('falling', (s) => s.leg === 'ground' && s.gap < 20);
    await p.lift();
    await p.page.waitForTimeout(1200);
    const before = (await p.read()).painted;
    const hit = await p.page.evaluate(() => {
      const g = window.__game, f = g.flight, list = g.moon.cratersNear(f.x, f.z, 9000, 2000).filter((c) => c.r >= 1000 && c.r < 6000);
      const c = list.sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
      if (!c) return null;
      window.__big = c;
      for (let i = 0; i < 3; i++) g.moon.paint.qaHit(c.id, g.clock() + i * 0.2, 2);
      return { id: c.id, r: Math.round(c.r), d: Math.round(Math.hypot(c.x - f.x, c.z - f.z)) };
    });
    console.log('  crater', JSON.stringify(hit));
    await p.page.waitForTimeout(2500);
    await p.shot('big-low');
    await p.turbo();
    await p.page.waitForTimeout(400);
    await p.turbo();
    await p.page.waitForTimeout(400);
    await p.turbo();
    await p.until('up', (s) => s.leg === 'fall' && s.h > 24, 30);
    await p.shot('big-24km');
    await p.until('up', (s) => s.leg === 'orbit', 30);
    await p.page.waitForTimeout(2000);
    const s = await p.read();
    console.log(`  on the orbit's map: ${before} % before, ${s.painted} % now`);
    await p.shot('big-orbit');
    await p.ctx.close();
  }
  if (only.includes('site')) {
    console.log('--- site');
    const p = await open();
    // a splash on Apollo 11, and the orbit turned to fly at it, a hundred km short
    const d = await p.page.evaluate(() => {
      const s = window.__space, m = s.moon, tr = m.trip, b = m.breath, lat = 0.67416, lon = 23.47314, D = Math.PI / 180;
      const stroke = b.paint.strike(lat, lon);
      const job = b.paint.begin(stroke, false);
      b.paint.work(job, Infinity);
      b.tex.needsUpdate = true;
      m.hold(true);
      const fix = [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)], F = m.model.moonFix;
      const e = [0, 1, 2].map((j) => F[j] * fix[0] + F[3 + j] * fix[1] + F[6 + j] * fix[2]);
      const r = Math.hypot(...tr.rm), u = [...tr.rm].map((x) => x / r), dot = u[0] * e[0] + u[1] * e[1] + u[2] * e[2];
      const h = e.map((x, i) => x - u[i] * dot), l = Math.hypot(...h);
      for (let i = 0; i < 3; i++) tr.heading[i] = tr.dir[i] = h[i] / l;
      const km = Math.acos(dot) * 1737.4;
      m.skip(Math.max(0, (km - 100) / 30));
      m.hold(false);
      return Math.round(km);
    });
    console.log(`  ${d} km from the site, flown to 100 km short`);
    await p.page.waitForTimeout(600);
    await p.shot('site-orbit');
    await p.push();
    await p.until('falling', (s) => s.leg === 'ground' && s.gap < 30, 80);
    await p.lift();
    const near = await p.page.evaluate(() => {
      const g = window.__game, c = g.moon.paint.sites?.[0] ?? null;
      return c ? { n: g.moon.paint.sites.length, x: c.x, z: c.z, name: c.name } : null;
    });
    console.log('  site', JSON.stringify(near));
    if (near) {
      await p.page.evaluate((c) => {
        const g = window.__game, f = g.flight;
        window.__qa = { pin: { x: c.x - 900, z: c.z + 900, heading: Math.PI / 4 } };
      }, near);
      await p.page.waitForTimeout(4000);
      await p.shot('site-low');
      await p.page.evaluate(() => (window.__qa = null));
    }
    await p.ctx.close();
  }
} finally {
  console.log(errors.length ? `errors:\n  ${[...new Set(errors)].slice(0, 12).join('\n  ')}` : 'no errors');
  await browser.close();
}
