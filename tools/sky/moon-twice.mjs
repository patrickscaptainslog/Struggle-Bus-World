#!/usr/bin/env node
// Two round trips in a row in one page, drawn: node tools/sky/moon-twice.mjs <out dir>. The page stands almost still and the flight jumps along through __game.moon.skip, so this proves the second launch draws,
// not how it feels. A frame 3 s into each trip and one home after each.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const out = process.argv[2];
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => {
    bad++;
    console.log('  [pageerror]', e.message);
  });
  await page.goto(`${BASE}?moonrun&t=2026-11-25T04:00:00Z&fixeddt=0.0005`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  const until = (leg) =>
    page.evaluate((l) => {
      const m = window.__game.moon;
      for (let i = 0; i < 5000 && m.trip.leg !== l; i++) m.skip(0.1);
      return { leg: m.trip.leg, clock: +m.trip.clock.toFixed(1), trips: m.trip.trips, hE: Math.round(m.trip.hEarth) };
    }, leg);
  for (const n of [1, 2]) {
    await page.evaluate(() => {
      const m = window.__game.moon;
      m.trip.qaGo();
      m.skip(0.1);
      m.trip.qaGo();
      m.skip(3);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `trip${n}-3s.png`) });
    console.log(`trip ${n} orbit:`, JSON.stringify(await until('orbit')));
    await page.evaluate(() => {
      const m = window.__game.moon;
      m.trip.qaGo();
      m.skip(0.1);
      m.trip.qaGo();
    });
    const home = await until('wait');
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `trip${n}-home.png`) });
    console.log(`trip ${n} home:`, JSON.stringify(home));
    if (home.leg !== 'wait' || home.trips !== n) bad++;
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
