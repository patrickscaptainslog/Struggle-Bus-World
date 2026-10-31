#!/usr/bin/env node
// Tap to skip the opening: a first visit plays it through (and a tap there doesn't skip); on the next visit a tap does.
//   node tools/skipopening.mjs <url>
// Prints ms from the first frame to ready for: a first visit with a tap, a repeat visit untouched, a repeat visit with a
// tap, and whether the skipping tap also fired a splat (it must not).
import { chromium } from 'playwright-core';
import { browserOptions } from './browser.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:4175/';
const browser = await chromium.launch(browserOptions([]));
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const cdp = await ctx.newCDPSession(page);
const tap = async () => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 500, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  await page.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
async function visit(label, tapAfterMs) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game && window.__game.clock() > 0.05, null, { timeout: 300000, polling: 20 });
  const t0 = Date.now();
  if (tapAfterMs >= 0) {
    await page.waitForTimeout(tapAfterMs);
    await tap();
  }
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000, polling: 16 });
  const ms = Date.now() - t0;
  const s = await page.evaluate(() => ({ belly: window.__game.flight.fullness, barf: window.__game.flight.barfT, shot: window.__game.lastShot(), seen: localStorage.getItem('strugglebus.opening.v1') }));
  console.log(label, JSON.stringify({ msToReady: ms, ...s }));
}
await visit('first visit, a tap at 1 s:', 1000);
await visit('repeat visit, no tap:', -1);
await visit('repeat visit, a tap at 0.5 s:', 500);
await browser.close();
