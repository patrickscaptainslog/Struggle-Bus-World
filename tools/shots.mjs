#!/usr/bin/env node
// Scripted beauty shots from the real game (index.html), iPhone 15 viewport.
//   node tools/shots.mjs [baseUrl] [outDir]
// Produces: grey.png (grey city from the gameplay camera), painted.png (a
// painted block after a few splats), opening.png (the Golden Gate opening),
// and stats.json (renderer stats; SwiftShader fps is NOT representative).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = process.argv[3] ?? 'shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  ...browserOptions([]),
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

// A slow drift at the rooftops (the thumb's down-stretch is the yoke's climb
// now, so the shots slow the bus with the opening's glide speed instead; same
// speeds as the old hover stretch: -0.45 -> 19.2 m/s, -1 -> 6 m/s).
const drift = (page, speed) => page.evaluate((v) => ((window.__qa = null), (window.__game.flight.glideSpeed = v)), speed);

// 1) grey city: drifting over Alamo Square, looking east at the Painted Ladies
//    row with downtown behind it in the fog
{
  const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro');
  await drift(page, 19.2);
  await runFor(page, 3);
  await page.screenshot({ path: `${out}/grey.png` });
  stats.grey = await page.evaluate(() => window.__stats ?? null);
  await page.close();
}

// 2) painted: drift slowly over Steiner Street and barf down the Painted Ladies
//    row through the real splat pipeline (cascade, bloom, sign, sound)
{
  const page = await open('?lat=37.77615&lon=-122.4340&heading=88&skipintro');
  await drift(page, 6);
  await runFor(page, 2);
  const row = [37.7754, 37.7758, 37.7762, 37.7766, 37.7770, 37.7762, 37.7758];
  for (const lat of row) {
    await page.evaluate((la) => window.__game.barfAtLatLon(la, -122.43262), lat);
    await runFor(page, 1.3);
  }
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
