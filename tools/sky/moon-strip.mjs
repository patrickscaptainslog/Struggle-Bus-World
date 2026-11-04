#!/usr/bin/env node
// Frames of a flight at set moments, to look at: node tools/sky/moon-strip.mjs <out dir> [--out=50,54,58] [--home=40,44] [--g5=6000] [--t=2026-11-25T04:00:00Z] [--w=402] [--h=874] [--q=]
// --out: seconds from the launch. --home: seconds from leaving orbit. No touches and no real time: the route's own step, the clock held while the frame is shot, so each one lands at the same moment of the same flight.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const dir = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const marks = (k) => opt(k, '').split(',').filter(Boolean).map(Number);
const g5 = opt('g5', '6000'), t = opt('t', '2026-11-25T04:00:00Z'), w = Number(opt('w', 402)), h = Number(opt('h', 874)), extra = opt('q', '');
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`${BASE}?moonrun&t=${t}&g5=${g5}${extra ? `&${extra}` : ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  const say = () => page.evaluate(() => {
    const m = window.__game.moon, s = m.sky, tr = m.trip, f = 1 / window.__game.pipeline.pixelWorldSize(1);
    return `${tr.leg} ${tr.clock.toFixed(1)} s v ${Math.round(tr.v)} hE ${Math.round(tr.hEarth)} hM ${Math.round(tr.hMoon)} lens ${m.view.hfov.toFixed(1)} earth ${Math.round(2 * Math.tan(s.earthR) * f)} moon ${Math.round(2 * Math.tan(s.moonR) * f)}`;
  });
  const shoot = async (name) => {
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(dir, `${name}.png`) });
    console.log(name.padEnd(12), await say());
  };
  await page.evaluate(() => {
    const m = window.__game.moon;
    m.hold(true);
    m.skip(0.1);
    m.trip.qaGo();
    m.skip(0.1);
    m.trip.qaGo();
  });
  let at = 0.1;
  for (const s of marks('out')) {
    await page.evaluate((d) => window.__game.moon.skip(d), s - at);
    at = s;
    await shoot(`out-${String(s).padStart(5, '0')}`);
  }
  if (marks('home').length) {
    await page.evaluate(() => {
      const m = window.__game.moon;
      for (let i = 0; i < 6000 && m.trip.leg !== 'orbit'; i++) m.skip(0.1);
      m.skip(6);
      m.trip.qaGo();
      m.skip(0.1);
      m.trip.qaGo();
    });
    at = 0.1;
    for (const s of marks('home')) {
      await page.evaluate((d) => window.__game.moon.skip(d), s - at);
      at = s;
      await shoot(`home-${String(s).padStart(5, '0')}`);
    }
  }
} finally {
  await browser.close();
}
