#!/usr/bin/env node
// The Moon's ground as the flight meets it, to look at: node tools/sky/moon-ground.mjs <out dir> [--t=2026-11-25T04:00:00Z] [--g5=6000] [--hs=13000,6000,3000,1500,800,500,300] [--secs=0,20,40,60] [--burst=8] [--w=402] [--h=874] [--q=]
// No touches and no real time: the route's own step, the clock held while a frame is shot. --hs: heights on the way in, km over the Moon. --secs: seconds on, in orbit. Prints what it read each frame, and the two bodies' size.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const dir = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const list = (k, d) => opt(k, d).split(',').filter(Boolean).map(Number);
const g5 = opt('g5', '6000'), t = opt('t', '2026-11-25T04:00:00Z'), w = Number(opt('w', 402)), h = Number(opt('h', 874)), extra = opt('q', '');
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('  [console]', m.text().slice(0, 400)));
  await page.goto(`${BASE}?moonrun&t=${t}&g5=${g5}${extra ? `&${extra}` : ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__game.moon.draw.ground?.ready !== false, null, { timeout: 30000 }).catch(() => console.log('  (the ground map never came)'));
  const say = () => page.evaluate(() => {
    const m = window.__game.moon, s = m.sky, tr = m.trip, f = 1 / window.__game.pipeline.pixelWorldSize(1), O = s.moonO, R = Math.hypot(O[0], O[1], O[2]);
    return `${tr.leg} ${tr.clock.toFixed(1)} s v ${Math.round(tr.v)} hM ${Math.round(tr.hMoon)} lens ${m.view.hfov.toFixed(1)} moon ${Math.round(2 * Math.tan(s.moonR) * f)} px, over ${(Math.asin(O[2] / R) * 57.29578).toFixed(1)}, ${(Math.atan2(O[1], O[0]) * 57.29578).toFixed(1)}, lit ${s.moonLit.toFixed(2)}`;
  });
  const shoot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(dir, `${name}.png`) });
    console.log(name.padEnd(12), await say());
  };
  await page.evaluate(() => {
    const m = window.__game.moon;
    m.hold(true);
    m.skip(0.1);
    m.trip.tap();
    m.skip(0.1);
    m.trip.tap();
  });
  for (const km of list('hs', '13000,6000,3000,1500,800,500,300')) {
    await page.evaluate((km) => {
      const m = window.__game.moon;
      for (let i = 0; i < 12000 && m.trip.leg !== 'orbit' && !(m.trip.leg === 'in' && m.trip.hMoon <= km); i++) m.skip(0.05);
    }, km);
    await shoot(`in-${String(km).padStart(5, '0')}`);
  }
  await page.evaluate(() => {
    const m = window.__game.moon;
    for (let i = 0; i < 12000 && m.trip.leg !== 'orbit'; i++) m.skip(0.05);
  });
  let at = 0;
  for (const s of list('secs', '0,20,40,60')) {
    await page.evaluate((d) => window.__game.moon.skip(d), s - at);
    at = s;
    await shoot(`orbit-${String(s).padStart(3, '0')}`);
  }
  // --burst=8: frames one after another at the phone's step from there, to look at how the ground moves
  for (let i = 0; i < Number(opt('burst', 0)); i++) {
    await page.evaluate(() => new Promise((done) => {
      const m = window.__game.moon;
      m.hold(false);
      requestAnimationFrame(() => {
        m.hold(true);
        requestAnimationFrame(done);
      });
    }));
    await page.screenshot({ path: join(dir, `burst-${i}.png`) });
  }
} finally {
  await browser.close();
}
