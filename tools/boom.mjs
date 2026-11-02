#!/usr/bin/env node
// The turbo's hero frames, deterministic: ?fixeddt steps the game a frame at a time and each shot is
// taken with the loop frozen (so a screenshot's stall never shows in the sequence).
//   node tools/boom.mjs <baseUrl> <outDir> [--every=4] [--frames=26]
// The boom (from 20 frames before Mach 1), then the jet held (tail, speed lines), then a banked turn.
// Writes <outDir>/boom-NN.png, jet-N.png, bank-N.png.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base = 'http://127.0.0.1:4175/', out = 'shots/local/boom'] = pos;
const every = Number(opt.every ?? 4);
const frames = Number(opt.frames ?? 26);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions([]));
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
await page.addInitScript(() => {
  if (window.DeviceOrientationEvent) window.DeviceOrientationEvent.requestPermission = undefined;
});
await page.goto(base + (opt.q ?? '?lat=37.77628&lon=-122.4352&heading=88') + '&skipintro&nohud&fps&fixeddt=0.016667', { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 400000 });

// run n frames, then wait for the freeze
const step = async (n) => {
  await page.evaluate((n) => {
    window.__qa = { ...(window.__qa ?? {}), holdFrames: n, held: false };
  }, n);
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 120000 });
};
const state = () => page.evaluate(() => ({ speed: window.__game.flight.speed, y: window.__game.flight.y, fov: window.__game.camera.fov, gear: window.__game.controls.turbo.gear }));

await step(1);
await page.evaluate(() => { const g = window.__game; g.controls.turbo.shift(1, g.flight); g.controls.turbo.shift(1, g.flight); });
// up to 20 frames short of Mach 1
for (let i = 0; i < 600; i++) {
  await step(1);
  const s = await state();
  if (s.speed > 310) break;
}
for (let i = 0; i < frames; i++) {
  await page.screenshot({ path: `${out}/boom-${String(i).padStart(2, '0')}.png` });
  console.log('boom', i, JSON.stringify(await state()));
  await step(every);
}
await step(150);
for (let i = 0; i < 3; i++) {
  await page.screenshot({ path: `${out}/jet-${i}.png` });
  await step(30);
}
// a banked turn at jet speed
await page.evaluate(() => (window.__qa.sx = 0.9, window.__qa.sy = 0));
await step(40);
for (let i = 0; i < 3; i++) {
  await page.screenshot({ path: `${out}/bank-${i}.png` });
  await step(25);
}
console.log('errors', JSON.stringify(errors));
await browser.close();
