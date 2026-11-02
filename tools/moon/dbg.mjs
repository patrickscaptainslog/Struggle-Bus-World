// A look inside ?moon: boots it, waits, runs an expression in the page if given, dumps the state, takes the frame. node tools/moon/dbg.mjs <png> [wait ms] [query] [js]
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const out = process.argv[2], wait = Number(process.argv[3] ?? 25000), q = process.argv[4] ?? '', js = process.argv[5];
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 900)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.slice(0, 800)));
page.on('response', (r) => {
  if (r.status() >= 400) console.log('[http]', r.status(), r.url());
});
await page.goto(`http://localhost:4179/?moon&fixeddt=0.0333&nohud${q ? '&' + q : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 }).catch(() => console.log('never ready'));
if (js) console.log('js:', JSON.stringify(await page.evaluate(js)));
await page.waitForTimeout(wait);
const st = await page.evaluate(() => {
  const g = window.__game;
  if (!g) return 'no game';
  const c = g.city;
  return { ready: window.__shotReady, busy: c.busy, regions: c.loadedRegionCount(), y: g.flight.y, x: g.flight.x, z: g.flight.z, far: g.moon?.far?.patchCount, cam: g.camera.position.toArray() };
});
console.log(JSON.stringify(st));
await page.screenshot({ path: out });
await browser.close();
