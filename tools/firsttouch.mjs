#!/usr/bin/env node
// The first touch of a session: how long the audio unlock holds the main thread.
//   node tools/firsttouch.mjs <url> [--runs=3] [--throttle=4]
// A fresh page per run, a real touch on the canvas once the city is in. Prints the time inside audio.unlock(), the long
// tasks (> 50 ms) of the second after the touch, the worst gap between frames, and when the sound graph was up.
import { chromium } from 'playwright-core';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [url = 'http://127.0.0.1:4173/'] = pos;
const runs = Number(opt.runs ?? 3);
const browser = await chromium.launch(browserOptions(['--autoplay-policy=user-gesture-required']));
for (let run = 0; run < runs; run++) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript(() => {
    const S = (window.__ft = { long: [], gaps: [], on: false, last: 0 });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (S.on) S.long.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: false });
    const tick = (t) => {
      if (S.on && S.last) S.gaps.push(t - S.last);
      S.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(url + '?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 300000 });
  await page.waitForTimeout(1000);
  const cdp = await page.context().newCDPSession(page);
  if (opt.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(opt.throttle) });
  await page.evaluate(() => {
    const S = window.__ft;
    const a = window.__game.audio;
    const o = a.unlock.bind(a);
    a.unlock = (...x) => {
      const t0 = performance.now();
      const v = o(...x);
      S.unlockMs = performance.now() - t0;
      S.unlockAt = t0;
      return v;
    };
    S.on = true;
    S.t0 = performance.now();
    const poll = () => {
      if (a.debugState().state !== 'locked' && a.context && !S.graphAt) S.graphAt = performance.now();
      if (!S.graphAt) setTimeout(poll, 4);
    };
    poll();
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 500, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  await page.waitForTimeout(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const S = window.__ft;
    S.on = false;
    const a = window.__game.audio;
    return { unlockMs: +(S.unlockMs ?? -1).toFixed(1), graphAfterMs: S.graphAt ? Math.round(S.graphAt - S.unlockAt) : null, long: S.long, maxGap: +Math.max(0, ...S.gaps).toFixed(1), audio: a.debugState().state };
  });
  console.log(JSON.stringify({ run, ...r }));
  await page.close();
}
await browser.close();
