#!/usr/bin/env node
// Flies ?moonrun in one browser and takes frames along the way: node tools/sky/moon-fly.mjs <out dir> [--g5=6000] [--t=2026-11-25T04:00:00Z] [--live=0.05]
// BASE is the page (http://localhost:4179/). The first TURBO is a real touch on the real button; G5 is asked for at once and home leaves when the marks say so.
//   marks: the page almost stands still (?fixeddt small) and the flight jumps from mark to mark through __game.moon.skip, at the route's step, drawing nothing between. It says nothing about frame rate.
//   --live=dt: the whole round trip through the real frame loop at that fixed step, two taps at a time, and it prints the legs. No frames.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const g5 = opt('g5', '6000'), t = opt('t', '2026-11-25T04:00:00Z'), live = Number(opt('live', 0)), extra = opt('q', '');
mkdirSync(out, { recursive: true });

// seconds from this trip's launch. `home` leaves orbit there.
const OUT = [[0, 'wait'], [1.2, 'tip'], [3, 'g4-3s'], [8, 'g4-8s'], [20, 'g4-20s'], [50, 'g4-earth-fits'], [56, 'g5-5s'], [62, 'g5-lens'], [69, 'g5-marble'], [96, 'g5-swing0'], [98.5, 'g5-swing1'], [103, 'g5-moon'], [106, 'brake'], [110.5, 'ring'], [125, 'in-125'], [140, 'in-140'], [148, 'in-148'], [151, 'flare'], [156, 'orbit'], [170, 'orbit-170']];
const BACK = [[1.5, 'leave'], [8, 'leave-8'], [30, 'leave-30'], [46, 'home-g5'], [75, 'home-g5-mid'], [91, 'home-swing'], [102, 'home-brake'], [106, 'home-ring'], [125, 'home-in'], [142, 'home-3000'], [150, 'home-brakes'], [165, 'home-wait']];

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text().slice(0, 400)}`);
  });
  page.on('pageerror', (e) => {
    bad++;
    console.log('  [pageerror]', e.message);
  });
  await page.goto(`${BASE}?moonrun&t=${t}&g5=${g5}&fixeddt=${live || 0.0005}${extra ? `&${extra}` : ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  const say = () =>
    page.evaluate(() => {
      const m = window.__game.moon, s = m.sky, tr = m.trip, px = 1 / window.__game.pipeline.pixelWorldSize(1);
      return { leg: tr.leg, gear: tr.gear, clock: +tr.clock.toFixed(1), v: Math.round(tr.v), hE: Math.round(tr.hEarth), hM: Math.round(tr.hMoon), lens: +m.view.hfov.toFixed(1), look: m.view.target ? 'moon' : 'earth', body: tr.ob.body, earthPx: Math.round(2 * Math.tan(s.earthR) * px), moonPx: Math.round(2 * Math.tan(s.moonR) * px) };
    });
  const turbo = await page.locator('[data-hud="turbo"]').boundingBox();
  const hudOn = await page.evaluate(() => [...document.querySelectorAll('[data-hud]')].filter((e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden').map((e) => e.dataset.hud));
  console.log('HUD shows:', hudOn.join(', '));
  if (live) {
    await page.touchscreen.tap(turbo.x + turbo.width / 2, turbo.y + turbo.height / 2);
    await page.waitForFunction(() => window.__game.moon.trip.leg !== 'wait', null, { timeout: 20000 });
    await page.touchscreen.tap(turbo.x + turbo.width / 2, turbo.y + turbo.height / 2);
    const log = (s) => say().then((v) => console.log(s, JSON.stringify(v)));
    await page.waitForFunction(() => window.__game.moon.trip.leg === 'orbit', null, { timeout: 600000, polling: 500 });
    await log('orbit');
    await page.waitForTimeout(3000);
    await page.touchscreen.tap(turbo.x + turbo.width / 2, turbo.y + turbo.height / 2);
    await page.waitForFunction(() => window.__game.moon.trip.leg !== 'orbit', null, { timeout: 20000 });
    await page.touchscreen.tap(turbo.x + turbo.width / 2, turbo.y + turbo.height / 2);
    await page.waitForFunction(() => window.__game.moon.trip.leg === 'wait', null, { timeout: 600000, polling: 500 });
    await log('home');
    const legs = await page.evaluate(() => window.__game.moon.trip.log);
    for (const l of legs) console.log(`  ${l.at.toFixed(1).padStart(7)} ${l.s.toFixed(1).padStart(6)} s ${String(Math.round(l.km)).padStart(7)} km ${l.leg}`);
    const stats = await page.evaluate(() => window.__stats);
    console.log('frame:', JSON.stringify({ calls: stats?.calls, triangles: stats?.triangles, points: stats?.points, lines: stats?.lines, programs: stats?.programs, textures: stats?.textures }));
  } else {
    let at = 0;
    const shoot = async (name) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(out, `${name}.png`) });
      console.log(name.padEnd(16), JSON.stringify(await say()));
    };
    const fly = async (list, prefix) => {
      for (const [when, name] of list) {
        await page.evaluate((s) => window.__game.moon.skip(s), when - at);
        at = when;
        await shoot(`${prefix}-${name}`);
      }
    };
    await shoot('00-wait');
    await page.touchscreen.tap(turbo.x + turbo.width / 2, turbo.y + turbo.height / 2);
    await page.waitForFunction(() => window.__game.moon.trip.leg !== 'wait', null, { timeout: 20000 });
    await page.evaluate(() => window.__game.moon.trip.tap());
    await fly(OUT.slice(1), '1');
    await page.evaluate(() => window.__game.moon.trip.tap());
    at = 0;
    await page.evaluate(() => window.__game.moon.skip(0.1));
    await page.evaluate(() => window.__game.moon.trip.tap());
    await fly(BACK, '2');
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
