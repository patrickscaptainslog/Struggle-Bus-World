#!/usr/bin/env node
// Flies ?moonrun in one browser and takes frames along the way: node tools/sky/moon-fly.mjs <out dir> [--g5=6000] [--t=2026-11-25T04:00:00Z] [--live=0.05]
// BASE is the page (http://localhost:4179/). The first flick is a real touch, in the left of the screen (TURBO's button is gone); G5 is asked for at once and home leaves when the marks say so.
//   marks: the page almost stands still (?fixeddt small) and the flight jumps from mark to mark through __game.moon.skip, at the route's step, drawing nothing between. It says nothing about frame rate.
//   --thumb: real touch drags on the canvas, in G5 and in orbit: the camera swings and comes back, the bus steers.
//   --live=dt: the whole round trip through the real frame loop at that fixed step, two taps at a time, and it prints the legs. No frames.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';
import { flick } from '../flick.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const g5 = opt('g5', '6000'), t = opt('t', '2026-11-25T04:00:00Z'), live = Number(opt('live', 0)), extra = opt('q', ''), thumbTest = args.includes('--thumb');
mkdirSync(out, { recursive: true });

// seconds from this trip's launch. `home` leaves orbit there.
const OUT = [[0, 'wait'], [1.2, 'tip'], [3, 'g4-3s'], [8, 'g4-8s'], [20, 'g4-20s'], [50, 'g4-earth-fits'], [56, 'g5-5s'], [60, 'g5-swing'], [64, 'g5-moon'], [90, 'g5-marble'], [97, 'in-97'], [110, 'in-110'], [125, 'in-125'], [140, 'in-140'], [150, 'in-150'], [160, 'in-160'], [171, 'orbit'], [180, 'orbit-180']];
const BACK = [[1.5, 'leave'], [8, 'leave-8'], [30, 'leave-30'], [50, 'home-g5-5'], [80, 'home-g5-mid'], [93, 'home-swing'], [101, 'home-g5-end'], [105, 'home-brake'], [112, 'home-ring'], [130, 'home-in'], [146, 'home-3000'], [156, 'home-drop'], [164, 'home-stop'], [172, 'home-wait']];

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
  await page.goto(`${BASE}?moonrun&t=${t}&g5=${g5}&fixeddt=${thumbTest ? 0.0333 : live || 0.0005}${extra ? `&${extra}` : ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  const say = () =>
    page.evaluate(() => {
      const m = window.__game.moon, s = m.sky, tr = m.trip, px = 1 / window.__game.pipeline.pixelWorldSize(1);
      return { leg: tr.leg, gear: tr.gear, clock: +tr.clock.toFixed(1), v: Math.round(tr.v), hE: Math.round(tr.hEarth), hM: Math.round(tr.hMoon), lens: +m.view.hfov.toFixed(1), bound: m.trip.bound ? 'moon' : 'earth', body: tr.ob.body, earthPx: Math.round(2 * Math.tan(s.earthR) * px), moonPx: Math.round(2 * Math.tan(s.moonR) * px) };
    });
  const flicks = await page.context().newCDPSession(page);
  const flickUp = () => flick(flicks, 1);
  const hudOn = await page.evaluate(() => [...document.querySelectorAll('[data-hud]')].filter((e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden').map((e) => e.dataset.hud));
  console.log('HUD shows:', hudOn.join(', '));
  if (thumbTest) {
    // a real drag on the canvas, through the real Input: touch events, not a call
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const drag = async (dx, dy, ms) => {
      await touch('touchStart', 200, 520);
      for (let i = 1; i <= 8; i++) {
        await touch('touchMove', 200 + (dx * i) / 8, 520 + (dy * i) / 8);
        await page.waitForTimeout(30);
      }
      await page.waitForTimeout(ms);
      await touch('touchEnd');
    };
    const earth = () => page.evaluate(() => [...window.__game.moon.sky.earth].map((x) => +x.toFixed(3)));
    const heading = () => page.evaluate(() => [...window.__game.moon.trip.heading]);
    await flickUp();
    await page.waitForFunction(() => window.__game.moon.trip.leg !== 'wait', null, { timeout: 20000 });
    await page.evaluate(() => {
      window.__game.moon.trip.qaGo();
      window.__game.moon.skip(70);
    });
    await page.waitForTimeout(600);
    const e0 = await earth();
    console.log('G5, thumb off, Earth in the render frame:', JSON.stringify(e0), JSON.stringify(await say()));
    await drag(70, 0, 900);
    const e1 = await earth();
    const swung = Math.acos(e0[0] * e1[0] + e0[1] * e1[1] + e0[2] * e1[2]) * (180 / Math.PI);
    await page.screenshot({ path: join(out, 'thumb-g5.png') });
    console.log(`  dragged right: Earth at ${JSON.stringify(e1)}, the camera swung ${swung.toFixed(1)} deg`);
    await page.waitForFunction((z) => Math.abs(window.__game.moon.sky.earth[2] - z) < 0.01, e0[2], { timeout: 30000, polling: 200 });
    console.log(`  let go: back on the law's view: ${JSON.stringify(await earth())}`);
    await page.evaluate(() => {
      const m = window.__game.moon;
      for (let i = 0; i < 4000 && m.trip.leg !== 'orbit'; i++) m.skip(0.1);
    });
    await page.waitForTimeout(600);
    const h0 = await heading();
    const lap0 = await say();
    await drag(70, 0, 900);
    const h1 = await heading();
    const turned = Math.acos(h0[0] * h1[0] + h0[1] * h1[1] + h0[2] * h1[2]) * (180 / Math.PI);
    await page.screenshot({ path: join(out, 'thumb-orbit.png') });
    console.log(`orbit: the thumb turned the bus ${turned.toFixed(1)} deg (the lap alone turns it about 8 deg/s); ${JSON.stringify(lap0)} then ${JSON.stringify(await say())}`);
  } else if (live) {
    await flickUp();
    await page.waitForFunction(() => window.__game.moon.trip.leg !== 'wait', null, { timeout: 20000 });
    await flickUp();
    const log = (s) => say().then((v) => console.log(s, JSON.stringify(v)));
    await page.waitForFunction(() => window.__game.moon.trip.leg === 'orbit', null, { timeout: 600000, polling: 500 });
    await log('orbit');
    await page.waitForTimeout(3000);
    await flickUp();
    await page.waitForFunction(() => window.__game.moon.trip.leg !== 'orbit', null, { timeout: 20000 });
    await flickUp();
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
    await flickUp();
    await page.waitForFunction(() => window.__game.moon.trip.leg !== 'wait', null, { timeout: 20000 });
    await page.evaluate(() => window.__game.moon.trip.qaGo());
    await fly(OUT.slice(1), '1');
    await page.evaluate(() => {
      const m = window.__game.moon;
      for (let i = 0; i < 4000 && m.trip.leg !== 'orbit'; i++) m.skip(0.1);
      m.trip.qaGo();
    });
    at = 0;
    await page.evaluate(() => window.__game.moon.skip(0.1));
    await page.evaluate(() => window.__game.moon.trip.qaGo());
    await fly(BACK, '2');
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
