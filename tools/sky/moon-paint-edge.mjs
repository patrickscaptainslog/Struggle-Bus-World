#!/usr/bin/env node
// The small ways a tap in orbit goes wrong, in the real page: node tools/sky/moon-paint-edge.mjs <out dir>
// A tap on the sky, under the bus, or from a key lands at the glint. A drag steers and paints nothing. Tapping while it reloads does nothing. A tap off orbit does nothing. The paint is still there after a reload, and a
// store that throws changes nothing but that. Two flights in a row find the same paint.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const out = process.argv[2];
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const T = '2026-11-25T04:00:00Z';
mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok, what, more = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} ${more}`);
  if (!ok) bad++;
};
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const view = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
const open = async (ctx) => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    bad++;
    console.log('  [pageerror]', e.message);
  });
  await page.goto(`${BASE}?moonrun&t=${T}&fixeddt=0.02`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  return page;
};
const orbit = (page) => page.evaluate(() => {
  const m = window.__game.moon;
  m.trip.tap();
  m.skip(0.1);
  m.trip.tap();
  for (let i = 0; i < 6000 && m.trip.leg !== 'orbit'; i++) m.skip(0.1);
  m.skip(4);
});
const read = (page) => page.evaluate(() => {
  const b = window.__game.moon.breath;
  return { shots: b.stats.shots, denied: b.stats.denied, tap: { ...b.lastTap }, strokes: b.paint.strokes.length, painted: b.paint.painted, loaded: b.loaded, leg: window.__game.moon.trip.leg, last: b.paint.strokes.at(-1) };
});
const loaded = (page) => page.waitForFunction(() => window.__game.moon.breath.loaded, null, { timeout: 30000, polling: 30 });

try {
  const ctx = await browser.newContext(view);
  {
    const page = await open(ctx);
    await page.touchscreen.tap(196, 420);
    await page.waitForTimeout(400);
    let s = await read(page);
    check(s.shots === 0 && s.denied === 1, 'a tap over home does nothing', JSON.stringify(s.tap));
    await orbit(page);
    await page.waitForTimeout(500);
    // ---- a tap on the sky: the glint
    await page.touchscreen.tap(300, 100);
    await page.waitForTimeout(150);
    s = await read(page);
    check(s.shots === 1 && !s.tap.ground && s.tap.y === 0, 'a tap on the sky lands at the glint', JSON.stringify(s.tap));
    // ---- tapping while it reloads
    await page.touchscreen.tap(196, 420);
    await page.waitForTimeout(100);
    await page.touchscreen.tap(196, 420);
    s = await read(page);
    check(s.shots === 1 && s.denied >= 3, 'taps while it reloads do nothing', `denied ${s.denied}`);
    await loaded(page);
    // ---- under the bus: the glint
    await page.touchscreen.tap(196, 760);
    await page.waitForTimeout(150);
    s = await read(page);
    check(s.shots === 2 && !s.tap.ground, 'a tap under the bus lands at the glint', JSON.stringify(s.tap));
    await loaded(page);
    // ---- a key: the glint, whatever was last touched
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    s = await read(page);
    check(s.shots === 3 && !s.tap.ground, 'Space lands at the glint', JSON.stringify(s.tap));
    await loaded(page);
    // ---- the game's sound is up, and the graph has played something (nothing here can hear it)
    const heard = await page.evaluate(async () => {
      const a = window.__game.moon.breath.audio;
      await new Promise((r) => setTimeout(r, 300));
      return a ? { ...a.debugState(), unlocked: a.unlocked } : null;
    });
    check(heard && heard.unlocked, 'the sound is up', JSON.stringify(heard));
    // ---- the ground, off to one side
    await page.touchscreen.tap(80, 500);
    await page.waitForTimeout(100);
    s = await read(page);
    const land = await page.evaluate(() => {
      const b = window.__game.moon.breath, l = b.paint.strokes.at(-1);
      return b.screenOf(l.lat, l.lon);
    });
    check(s.shots === 4 && s.tap.ground && Math.hypot(land.x - 80, land.y - 500) < 12, 'a tap on the ground lands there', `${Math.round(land.x)}, ${Math.round(land.y)} a moment later`);
    await loaded(page);
    // ---- a drag steers and paints nothing
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', 200, 560);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', 200 + i * 9, 560);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(400);
    await touch('touchEnd');
    await page.waitForTimeout(200);
    const before = s.shots;
    s = await read(page);
    check(s.shots === before, 'a drag steers, and paints nothing');
    // ---- a second finger, while the thumb steers, fires
    await touch('touchStart', 200, 560);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', 200 + i * 6, 560);
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 248, y: 560, id: 0 }, { x: 150, y: 400, id: 1 }] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: 248, y: 560, id: 0 }] });
    await page.waitForTimeout(100);
    await touch('touchEnd');
    await page.waitForTimeout(150);
    s = await read(page);
    check(s.shots === before + 1 && s.tap.ground, 'a second finger while steering fires, where it touched', JSON.stringify(s.tap));
    await page.waitForTimeout(2500);
    const saved = await page.evaluate(() => localStorage.getItem('strugglebus.moon.v1.0'));
    check(saved && JSON.parse(saved).length === s.strokes * 4, 'every stroke is in the store', `${saved?.length} chars`);
    // ---- the frame's size changes: a tap still lands where it touched
    await page.setViewportSize({ width: 402, height: 700 });
    await page.waitForTimeout(800);
    await loaded(page);
    await page.touchscreen.tap(250, 300);
    await page.waitForTimeout(100);
    const land2 = await page.evaluate(() => {
      const b = window.__game.moon.breath, l = b.paint.strokes.at(-1);
      return b.screenOf(l.lat, l.lon);
    });
    check(Math.hypot(land2.x - 250, land2.y - 300) < 14, 'with the browser bars in, the same', `${Math.round(land2.x)}, ${Math.round(land2.y)}`);
    await page.waitForTimeout(2000);
    const was = (await read(page)).painted;
    await page.close();

    // ---- the next flight finds it
    const again = await open(ctx);
    s = await read(again);
    check(s.strokes > 4 && Math.abs(s.painted - was) < 1e-6, 'a reload finds the paint', `${s.strokes} strokes, ${(s.painted * 100).toFixed(2)} %`);
    await again.waitForTimeout(400);
    await again.screenshot({ path: join(out, 'reload-home.png') });
    await orbit(again);
    await again.waitForTimeout(800);
    await again.screenshot({ path: join(out, 'reload-orbit.png') });
    check((await again.evaluate(() => document.querySelector('[data-hud="trip-label"]').dataset.say)).includes('PAINTED'), 'the label says so');
    await again.close();
  }
  await ctx.close();

  // ---- a store that throws
  {
    const c2 = await browser.newContext(view);
    await c2.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    });
    const page = await open(c2);
    await orbit(page);
    await page.waitForTimeout(500);
    await page.touchscreen.tap(196, 420);
    await page.waitForTimeout(200);
    await page.waitForFunction(() => window.__game.moon.breath.paint.painted > 0, null, { timeout: 20000, polling: 50 });
    const s = await read(page);
    check(s.shots === 1 && s.painted > 0, 'a store that throws: it paints all the same');
    await page.close();
    await c2.close();
  }
} finally {
  await browser.close();
}
console.log(bad ? `${bad} FAILED` : 'all pass');
process.exit(bad ? 1 : 0);
