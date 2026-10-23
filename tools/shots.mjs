#!/usr/bin/env node
// Scripted beauty shots from the real game (index.html), iPhone 15 viewport.
//   node tools/shots.mjs [baseUrl] [outDir]
// Produces: grey.png (grey city from the gameplay camera), painted.png (a
// painted block after a few splats), opening.png (the Golden Gate opening),
// and stats.json (renderer stats; SwiftShader fps is NOT representative).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = process.argv[3] ?? 'shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const stats = {};

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  return page;
}

// let the game run for `seconds` of simulated time (SwiftShader is slow; we
// wait on the game's own clock instead of wall time)
async function runFor(page, seconds) {
  const t0 = await page.evaluate(() => window.__game.flight && performance.now());
  await page.evaluate(
    (s) =>
      new Promise((res) => {
        const g = window.__game;
        const start = g.clock();
        const tick = () => (g.clock() - start >= s ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    seconds,
  );
  return t0;
}

// 1) grey city: Alamo Square, heading east toward the Painted Ladies + downtown
{
  const page = await open('?lat=37.7745&lon=-122.4395&heading=80&skipintro&fps');
  await page.evaluate(() => (window.__qa = { sx: 0, sy: -0.25 }));
  await runFor(page, 4);
  await page.screenshot({ path: `${out}/grey.png` });
  stats.grey = await page.evaluate(() => window.__stats ?? null);
  // 2) painted: barf along the row, escalating a few
  for (let i = 0; i < 7; i++) {
    await page.evaluate(() => window.__game.forceReady());
    await page.evaluate(() => window.__game.tapSplat());
    await runFor(page, 1.7);
  }
  await page.evaluate(() => (window.__qa = { sx: 0.25, sy: -0.6 }));
  await runFor(page, 2.5);
  await page.screenshot({ path: `${out}/painted.png` });
  stats.painted = await page.evaluate(() => window.__stats ?? null);
  await page.close();
}

// 3) the opening: fog bank west of the Golden Gate
{
  const page = await open('?openingshot');
  await runFor(page, 4.5);
  await page.screenshot({ path: `${out}/opening.png` });
  await page.close();
}

writeFileSync(`${out}/stats.json`, JSON.stringify(stats, null, 2));
await browser.close();
console.log('shots saved to', out);
