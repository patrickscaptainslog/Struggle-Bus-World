#!/usr/bin/env node
// A lost GL context, the game's whole way through it (WEBGL_lose_context, as a GPU reset or iOS under memory pressure).
//   node tools/contextloss.mjs <url> <outDir> [--query=...] [--repeat=2]
// A deep link on a fixed step with the clock standing (the same frame before and after), then lose, wait, restore. Prints
// exceptions, how long the city took to come back, programs and buffers, and writes before.png / after-N.png
// (python -I tools/shotdiff.py compares them: they should be the same frame).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [url = 'http://127.0.0.1:4175/', out = 'shots/local/contextloss'] = pos;
const repeat = Number(opt.repeat ?? 2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(browserOptions([]));
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => (errors.push(e.message), console.log('[pageerror]', e.message)));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && (errors.push(m.text()), console.log('[console]', m.text())));
await page.addInitScript(() => {
  let g = null;
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => {
    g = v;
    v.controls.frozen = true;
    // (a build from before the tilt went stands on its motion sheet's status)
    if (v.controls.tilt) v.controls.tilt.status = 'requesting';
  } });
});
await page.goto(url + (opt.query ?? '?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud&fixeddt=0.03333333333333333'), { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
const settle = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const c = window.__game.city;
        let q = 0;
        const t = () => {
          q = !c.busy ? q + 1 : 0;
          if (q >= 60) res(null);
          else requestAnimationFrame(t);
        };
        t();
      }),
  );
await settle();
await page.screenshot({ path: `${out}/before.png` });
for (let n = 1; n <= repeat; n++) {
  const t0 = Date.now();
  await page.evaluate(() => window.__game.loseContext());
  await page.waitForTimeout(800);
  const lost = await page.evaluate(() => ({ lost: window.__game.pipeline.renderer.getContext().isContextLost(), canvas: document.getElementById('game').style.visibility }));
  await page.evaluate(() => window.__game.restoreContext());
  await page.waitForFunction(() => document.getElementById('game').style.visibility === '', null, { timeout: 120000, polling: 50 });
  const back = Date.now() - t0 - 800;
  await settle();
  const info = await page.evaluate(() => {
    const g = window.__game;
    const r = g.pipeline.renderer.info;
    return { programs: r.programs.length, geometries: r.memory.geometries, textures: r.memory.textures, regions: g.city.loadedRegionCount(), warm: g.warm.report ? { programs: g.warm.report.programs, doneMs: g.warm.report.doneMs } : null };
  });
  await page.screenshot({ path: `${out}/after-${n}.png` });
  console.log(JSON.stringify({ n, ...lost, backMs: back, ...info }));
}
console.log('errors', errors.length);
await browser.close();
