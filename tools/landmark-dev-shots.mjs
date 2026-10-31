#!/usr/bin/env node
// Batch shots of the paintable-landmarks dev page (dev/landmarks.html) in ONE
// browser session (iPhone portrait viewport, SwiftShader).
//   node tools/landmark-dev-shots.mjs <devServerBase> <outDir> name=query [name=query ...]
// e.g. node tools/landmark-dev-shots.mjs http://127.0.0.1:5173/ shots/landmarks/dev \
//        trans-l1=view=trans&level=1&t=3&dist=560&elev=10&yaw=1.9
// With no name=query pairs it shoots the standard set (both landmarks, grey,
// the flood at 0.1 / 0.4 / 1.0 s, levels 1-3 settled, the glint).
// The browser comes from tools/browser.mjs (the real GPU off the cloud machine). The dev page needs the
// vite dev server (dev pages aren't in the static build).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const [base = 'http://127.0.0.1:5173/', out = 'shots/landmarks/dev', ...pairs] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const T = 'view=trans&dist=560&elev=10&yaw=1.9';
const S = 'view=sutro&dist=640&elev=12&yaw=1.2';
const std = [
  ['trans-grey', `${T}&level=0`],
  ['trans-l1-0.10', `${T}&level=1&t=0.1&hit=4,60,24`],
  ['trans-l1-0.40', `${T}&level=1&t=0.4&hit=4,60,24`],
  ['trans-l1-1.00', `${T}&level=1&t=1.0&hit=4,60,24`],
  ['trans-l1', `${T}&level=1&t=3`],
  ['trans-l2', `${T}&level=2&t=3&keep=1`],
  ['trans-l3', `${T}&level=3&t=3&keep=1`],
  ['trans-glint', `${T}&level=0&target=1&t=0.6`],
  ['sutro-grey', `${S}&level=0`],
  ['sutro-l1-0.40', `${S}&level=1&t=0.4`],
  ['sutro-l1', `${S}&level=1&t=3&hue=4`],
  ['sutro-l2', `${S}&level=2&t=3&keep=1&hue=4`],
  ['sutro-l3', `${S}&level=3&t=3&keep=1&hue=4`],
];
const list = pairs.length ? pairs.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]) : std;

const browser = await chromium.launch(browserOptions());
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
for (const [name, q] of list) {
  await page.goto(`${base}dev/landmarks.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000 });
  // a few rendered frames after ready
  await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 3 ? r(null) : requestAnimationFrame(f)); f(); }));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}
await browser.close();
