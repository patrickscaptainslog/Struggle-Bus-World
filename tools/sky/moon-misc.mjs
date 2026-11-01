#!/usr/bin/env node
// The small ways a first flight goes wrong, one page each: node tools/sky/moon-misc.mjs <out dir>
//   a long press on TURBO; the down tab; a turn of the phone in flight; the GL context lost and given back; the browser's bars coming and going; a laptop's keys and mouse; the phone's real 3x canvas.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const out = process.argv[2];
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const open = async (query, opts = {}) => {
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, ...opts });
  page.on('pageerror', (e) => {
    bad++;
    console.log('  [pageerror]', e.message);
  });
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('  [console]', m.text().slice(0, 300)));
  page.on('response', (r) => {
    if (r.status() >= 400) console.log(`  [${r.status()}]`, r.url());
  });
  await page.goto(`${BASE}?moonrun&t=2026-11-25T04:00:00Z&${query}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  return page;
};
const box = (page, name) => page.locator(`[data-hud="${name}"]`).boundingBox();
const state = (page) => page.evaluate(() => {
  const t = window.__game.moon.trip;
  return { leg: t.leg, gear: t.gear, armed: t.armed, clock: +t.clock.toFixed(1), say: document.querySelector('[data-hud="trip-label"]')?.dataset.say };
});
const press = async (page, b, ms) => {
  const cdp = await page.context().newCDPSession(page);
  const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
try {
  // ---- a long press launches, once
  {
    const page = await open('fixeddt=0.0166');
    await press(page, await box(page, 'turbo'), 800);
    await page.waitForTimeout(300);
    const s = await state(page);
    console.log('long press on TURBO, 800 ms:', JSON.stringify(s));
    if (s.leg === 'wait' || s.armed) bad++;
    // a press of 350 ms: both the hold and the tap: one shift only
    await press(page, await box(page, 'turbo'), 350);
    await page.waitForTimeout(300);
    const s2 = await state(page);
    console.log('a 350 ms press, once in flight:', JSON.stringify(s2));
    if (!s2.armed) bad++;
    // the down tab takes it back
    await press(page, await box(page, 'gear-down'), 80);
    await page.waitForTimeout(300);
    const s3 = await state(page);
    console.log('the down tab:', JSON.stringify(s3));
    if (s3.armed) bad++;
    await page.close();
  }
  // ---- the phone turned in flight, then back, and the browser's bars
  {
    const page = await open('fixeddt=0.05');
    const turbo = await box(page, 'turbo');
    await page.touchscreen.tap(turbo.x + turbo.width / 2, turbo.y + turbo.height / 2);
    await page.waitForFunction(() => window.__game.moon.trip.leg !== 'wait', null, { timeout: 20000 });
    await page.waitForTimeout(400);
    await page.setViewportSize({ width: 874, height: 402 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, 'landscape.png') });
    console.log('landscape:', JSON.stringify(await state(page)), JSON.stringify(await page.evaluate(() => window.__game.pipeline.info)));
    await page.setViewportSize({ width: 402, height: 700 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, 'bars.png') });
    console.log('with bars:', JSON.stringify(await page.evaluate(() => window.__game.pipeline.info)));
    await page.setViewportSize({ width: 402, height: 874 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, 'portrait.png') });
    console.log('back:', JSON.stringify(await state(page)));
    await page.close();
  }
  // ---- a lost context: the page comes back at the start, and says nothing wrong
  {
    const page = await open('fixeddt=0.05');
    await page.evaluate(() => {
      const gl = window.__game.pipeline.renderer.getContext();
      window.__lose = gl.getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await page.waitForTimeout(1500);
    const nav = page.waitForNavigation({ timeout: 30000 }).catch(() => null);
    await page.evaluate(() => window.__lose.restoreContext());
    await nav;
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 60000 });
    console.log('lost and restored: the page reloaded, back at', JSON.stringify(await state(page)));
    await page.close();
  }
  // ---- a laptop: the keys and the mouse, the same flight
  {
    const page = await open('fixeddt=0.0166', { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__game.moon.trip.leg !== 'wait', null, { timeout: 20000 });
    await page.keyboard.press('e');
    await page.waitForTimeout(300);
    const s = await state(page);
    console.log('laptop, E twice:', JSON.stringify(s));
    if (!s.armed) bad++;
    await page.keyboard.press('q');
    await page.waitForTimeout(300);
    console.log('Q:', JSON.stringify(await state(page)));
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(300);
    const e0 = await page.evaluate(() => [...window.__game.moon.sky.earth]);
    await page.mouse.move(640, 500);
    await page.mouse.down();
    await page.mouse.move(720, 500, { steps: 6 });
    await page.waitForTimeout(800);
    await page.mouse.up();
    const e1 = await page.evaluate(() => [...window.__game.moon.sky.earth]);
    const swung = (Math.acos(Math.min(1, e0[0] * e1[0] + e0[1] * e1[1] + e0[2] * e1[2])) * 180) / Math.PI;
    console.log(`mouse drag: the camera swung ${swung.toFixed(1)} deg`);
    if (swung < 5) bad++;
    await page.screenshot({ path: join(out, 'laptop.png') });
    await page.close();
  }
  // ---- the phone's own canvas
  {
    const page = await open('fps&fixeddt=0.0166', { deviceScaleFactor: 3 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, 'phone-3x.png') });
    console.log('3x:', JSON.stringify(await page.evaluate(() => ({ info: window.__game.pipeline.info, canvas: `${window.__game.pipeline.renderer.domElement.width}x${window.__game.pipeline.renderer.domElement.height}`, stats: window.__stats?.fps }))));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(bad ? `${bad} BAD` : 'all fine');
process.exit(bad ? 1 : 0);
