#!/usr/bin/env node
// Headless screenshot helper (Chromium + SwiftShader WebGL2).
// usage: node tools/shot.mjs <url> <out.png> [--w=393] [--h=852] [--dpr=3]
//        [--wait=1500] (ms after __shotReady) [--timeout=60000] [--eval="js"]
// Prints console errors. Exit code 2 if the page threw.
import { chromium } from 'playwright-core';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.join('=') || '1'];
  }),
);
const [url, out] = pos;
if (!url || !out) {
  console.error('usage: node tools/shot.mjs <url> <out.png> [--w= --h= --dpr= --wait= --eval=]');
  process.exit(1);
}
const w = Number(opt.w ?? 393);
const h = Number(opt.h ?? 852);
const dpr = Number(opt.dpr ?? 3);

const browser = await chromium.launch({
  ...browserOptions(['--enable-webgl']),
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
let threw = false;
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
  else if (opt.verbose) console.log(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => {
  threw = true;
  console.log('[pageerror]', e.message);
});
await page.goto(url, { waitUntil: 'load', timeout: Number(opt.timeout ?? 60000) });
try {
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: Number(opt.timeout ?? 60000) });
} catch {
  console.log('[warn] __shotReady never set; capturing anyway');
}
if (opt.eval) await page.evaluate(opt.eval);
await page.waitForTimeout(Number(opt.wait ?? 1500));
await page.screenshot({ path: out });
if (opt.stats) {
  const stats = await page.evaluate(() => window.__stats ?? null);
  console.log('stats', JSON.stringify(stats));
}
await browser.close();
console.log('saved', out);
process.exit(threw ? 2 : 0);
