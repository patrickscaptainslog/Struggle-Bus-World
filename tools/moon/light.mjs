#!/usr/bin/env node
// What lights the Moon's ground is chosen again at each slide (src/moon/MoonSky.ts, slide), at a fixed step: node tools/moon/light.mjs
//   night    first quarter, on the equator six degrees west of the terminator: night, lit by Earth
//   day      slid east over the terminator, a slide at a time: the Sun lights the ground there
// The first account's review, 2026-11-04: chosen once a session, a night lit by Earth never got its day. BASE is the page (http://localhost:4179/).
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4179/';
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?moon&nohud&lat=0&lon=-12&t=2026-11-17T12:00:00Z&fixeddt=0.033333`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => !!window.__game?.moon?.sky, null, { timeout: 300000, polling: 500 });
  const read = () => page.evaluate(() => { const g = window.__game, s = g.moon.sky, f = g.moon.frame; return { byEarth: s.byEarth, lon: +f.lon0.toFixed(2), lightUp: +s.sun[1].toFixed(3) }; });
  const n0 = await read();
  row('night: six degrees west of the terminator at first quarter, lit by Earth', n0.byEarth && n0.lightUp > 0.5, n0);
  // (east a slide at a time: 131 km, about 4.3 degrees of longitude on the equator)
  const steps = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__game.moon.slide(131072, 0, new Set()));
    steps.push(await read());
  }
  // (night while the new middle's still in it, and from the first in the day the Sun, up there)
  const k = steps.findIndex((s) => !s.byEarth);
  row('day: slid east over the terminator, the Sun lights the ground there', k > 0 && steps[k].lightUp > 0.02 && steps.slice(0, k).every((s) => s.byEarth) && steps.slice(k).every((s) => !s.byEarth), { steps });
} catch (e) {
  bad++;
  console.log('FAIL ', e.message);
} finally {
  row('no page errors', !errors.length, errors.slice(0, 3));
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
