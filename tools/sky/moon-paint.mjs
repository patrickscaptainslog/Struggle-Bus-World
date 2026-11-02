#!/usr/bin/env node
// Paints the Moon with real touches: node tools/sky/moon-paint.mjs <out dir> [--t=2026-11-25T04:00:00Z] [--w=393] [--h=852] [--taps=x,y;x,y ...] [--keep]
// Flies straight to orbit without drawing (the route's own step), then a tap, frames through its flight and its bloom, and two more on the same paint for levels 2 and 3.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', '2026-11-25T04:00:00Z'), w = Number(opt('w', 393)), h = Number(opt('h', 852));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
try {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text().slice(0, 500)}`);
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`${BASE}?moonrun&t=${t}&fixeddt=0.0166`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  await page.evaluate(() => {
    const m = window.__game.moon;
    m.trip.tap();
    m.skip(0.1);
    m.trip.tap();
    for (let i = 0; i < 6000 && m.trip.leg !== 'orbit'; i++) m.skip(0.1);
    m.skip(4);
  });
  await page.waitForTimeout(800);
  const state = () => page.evaluate(() => {
    const m = window.__game.moon, b = m.breath;
    return { leg: m.trip.leg, gear: m.trip.gear, v: +m.trip.v.toFixed(1), hM: +m.trip.hMoon.toFixed(1), t: +b.t.toFixed(2), barf: +b.barfT.toFixed(2), full: +b.fullness.toFixed(2), painted: +(b.paint.painted * 100).toFixed(3), strokes: b.paint.strokes.length, stats: b.stats, tap: b.lastTap, say: document.querySelector('[data-hud="trip-label"]')?.dataset.say };
  });
  console.log(JSON.stringify(await state()));
  await page.screenshot({ path: join(out, '00-orbit.png') });
  // (time stops on the frame the clock passes T, and starts again once the shot is taken)
  const shootAt = async (name, T) => {
    await page.evaluate((T) => new Promise((done) => {
      const m = window.__game.moon;
      const tick = () => {
        if (m.breath.t >= T) {
          m.hold(true);
          requestAnimationFrame(() => requestAnimationFrame(done));
        } else requestAnimationFrame(tick);
      };
      tick();
    }), T);
    await page.screenshot({ path: join(out, `${name}.png`) });
    await page.evaluate(() => window.__game.moon.hold(false));
  };
  const breath = async (tag, x, y) => {
    await page.touchscreen.tap(x, y);
    const t0 = await page.evaluate(() => window.__game.moon.breath.t);
    for (const [n, dt] of [['a-leave', 0.2], ['b-mid', 0.55], ['c-near', 0.85], ['d-hit', 1.03], ['e-bloom1', 1.25], ['f-bloom2', 1.55], ['g-bloom3', 1.95], ['h-settled', 2.5]]) await shootAt(`${tag}${n}`, t0 + dt);
    await page.waitForFunction(() => window.__game.moon.breath.loaded, null, { timeout: 20000, polling: 30 });
    console.log(tag, JSON.stringify(await state()));
  };
  if (args.includes('--flash')) {
    // (a flash lasts two drawn frames: hold the frame and give it thirty, to see what it covers)
    await page.evaluate(() => {
      window.__game.moon.hold(true);
      window.__game.pipeline.flash(0.5, 0.5, 40, 1);
    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: join(out, '0-flash.png') });
    await page.evaluate(() => window.__game.moon.hold(false));
    await page.waitForTimeout(900);
  }
  await breath('1', 196, 426);
  // the next two where the last one landed, wherever it has slid to
  const last = () => page.evaluate(() => {
    const b = window.__game.moon.breath, s = b.paint.strokes.at(-1);
    return b.screenOf(s.lat, s.lon);
  });
  let p = await last();
  await breath('2', p.x, Math.min(p.y, 590));
  await page.waitForTimeout(200);
  p = await last();
  await breath('3', p.x, Math.min(p.y - 40, 590));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, '4-after.png') });
  // ---- a few more along the way, each hit three times, so there are rays to see from far off
  const more = Number(opt('more', 0));
  const ready = () => page.waitForFunction(() => window.__game.moon.breath.loaded, null, { timeout: 20000, polling: 30 });
  for (let i = 0; i < more; i++) {
    await ready();
    await page.waitForTimeout(1500);
    await page.touchscreen.tap(90 + ((i * 2) % 3) * 110, 300 + (i % 2) * 40);
    for (let k = 0; k < 2; k++) {
      await page.waitForTimeout(300);
      await ready();
      const q = await last();
      await page.touchscreen.tap(q.x, Math.min(q.y, 590));
    }
    await page.waitForTimeout(300);
  }
  if (more) {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(out, '5-more.png') });
    console.log(JSON.stringify(await state()));
  }
  await page.waitForTimeout(500);
  console.log('stored:', await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('strugglebus.moon')).map((k) => [k, localStorage.getItem(k).length]).join(' ')));
  await page.close();
  for (const spec of opt('far', 'km13000=view=moon&km=13000,km100000=view=mid&f=0.74&look=moon,km384000=view=mid&f=0.02&look=moon').split(',')) {
    const i = spec.indexOf('='), name = spec.slice(0, i), q = spec.slice(i + 1);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('  [pageerror]', e.message));
    await p.goto(`${BASE}?moonrun&t=${t}&${q}`, { waitUntil: 'load', timeout: 60000 });
    await p.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(out, `far-${name}.png`) });
    console.log(name, await p.evaluate(() => {
      const m = window.__game.moon, s = m.sky, f = 1 / window.__game.pipeline.pixelWorldSize(1);
      return JSON.stringify({ km: Math.round(s.moonKm), px: Math.round(2 * Math.tan(s.moonR) * f), lit: +s.moonLit.toFixed(3), strokes: m.breath.paint.strokes.length, painted: +(m.breath.paint.painted * 100).toFixed(2) });
    }));
    await p.close();
  }
} finally {
  await browser.close();
}
