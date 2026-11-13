#!/usr/bin/env node
// A first visit's opening, two builds side by side (docs/specs/core/CORE.md stage 1: a first-time player's start is the one before the return visit).
//   node tools/openingsame.mjs <ref url> <new url> <outdir>      exit 0 equal, 1 different, 3 the ref against itself isn't stable
// Each run: a fresh profile, ?t=2026-11-07T00:22:00Z&rate=0&fixeddt=0.0333333, the game held from before its first frame (controls.frozen: the frame still
// runs, the city streams, game time and the opening's clock stand) until city.loadedRegionCount() > 0 and !city.loading, then stepped 30 s of game time
// with no touch (__qa.holdFrames), the canvas taken at 0.5, 1, 2, 4.2, 8, 16 and 30 s. The trace: each game frame's x, y, z, heading, the opening's
// clock as the lens's pull (rig.openingPull, 140 (1 - k)^2: the clock itself isn't on BASE's __game), controls.opening and gearsLocked, to the last bit.
// The ref against itself twice first: traces not equal, exit 3 (the measure isn't stable); pixels not equal, the legs compare traces only, and say so.
// Then (i) new &hose against the ref, with the HUD: trace and pixels; (ii) both &nohud: trace and pixels; (iii) both with the HUD: the trace only
// (with the Hose off, the plain link's first-run hint has three lines where the ref's has four).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const [refUrl, newUrl, out = 'shots/tmp/openingsame'] = process.argv.slice(2);
if (!refUrl || !newUrl) {
  console.log('usage: node tools/openingsame.mjs <ref url> <new url> <outdir>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const Q = '?t=2026-11-07T00:22:00Z&rate=0&fixeddt=0.0333333';
const DT = 0.0333333, SHOTS = [0.5, 1, 2, 4.2, 8, 16, 30];
const browser = await chromium.launch(browserOptions([]));
const errors = [];

async function run(label, base, extra) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    let game;
    window.__tr = [];
    Object.defineProperty(window, '__game', {
      configurable: true,
      get: () => game,
      set(v) {
        game = v;
        v.controls.frozen = true;
        let last = -1;
        // (each game frame once: the clock moves by fixeddt on each, and stands while frozen or held)
        const tick = () => {
          const c = v.clock(), f = v.flight;
          if (c !== last) {
            last = c;
            window.__tr.push([c, f.x, f.y, f.z, f.heading, v.rig.openingPull, v.controls.opening ? 1 : 0, v.controls.gearsLocked ? 1 : 0]);
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
    });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => (errors.push(`${label}: ${e.message}`), console.log(`[pageerror] ${label}:`, e.message)));
  await page.goto(base + Q + extra, { waitUntil: 'domcontentloaded', timeout: 400000 });
  await page.waitForFunction(() => window.__game && window.__game.city.loadedRegionCount() > 0 && !window.__game.city.loading, null, { timeout: 400000, polling: 100 });
  // (the first frame's entry, before any step: then held, and stepped to each still)
  await page.evaluate(() => {
    window.__tr.length = 0;
    window.__qa = { holdFrames: 0, held: false };
    window.__game.controls.frozen = false;
  });
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 60000 });
  const pix = [];
  let frames = 0;
  for (const s of SHOTS) {
    const n = Math.round(s / DT) - frames;
    frames += n;
    await page.evaluate((n) => (window.__qa = { holdFrames: n, held: false }), n);
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 300000, polling: 50 });
    pix.push(await page.screenshot({ path: `${out}/${label}-${String(s).replace('.', '_')}.png` }));
  }
  const tr = await page.evaluate(() => window.__tr);
  await ctx.close();
  console.log(`${label}: ${tr.length} frames traced, the clock to ${tr.at(-1)?.[0]?.toFixed(3)}`);
  return { tr, pix };
}
/** the first frame where two traces differ in any field, or null */
const traceDiff = (a, b) => {
  const n = Math.max(a.tr.length, b.tr.length);
  for (let i = 0; i < n; i++) {
    const x = a.tr[i], y = b.tr[i];
    if (!x || !y) return `frame ${i}: one trace ends (${a.tr.length} against ${b.tr.length})`;
    for (let k = 0; k < x.length; k++) if (!Object.is(x[k], y[k])) return `frame ${i} (clock ${x[0].toFixed(3)}): field ${['clock', 'x', 'y', 'z', 'heading', 'openingPull', 'opening', 'gearsLocked'][k]} ${x[k]} against ${y[k]}`;
  }
  return null;
};
const pixDiff = (a, b) => SHOTS.filter((_, i) => !a.pix[i].equals(b.pix[i]));

const fails = [];
const R1 = await run('ref-a', refUrl, '');
const R2 = await run('ref-b', refUrl, '');
const stableTrace = traceDiff(R1, R2), stablePix = pixDiff(R1, R2);
console.log(`the ref against itself: trace ${stableTrace ?? 'equal'}; pixels ${stablePix.length ? 'differ at ' + stablePix.join(', ') + ' s' : 'equal'}`);
if (stableTrace) {
  console.log('OPENINGSAME: the measure is not stable (the ref against itself): exit 3');
  await browser.close();
  process.exit(3);
}
const withPix = stablePix.length === 0;
if (!withPix) console.log('the ref against itself differs in its pixels: every leg compares the trace only');
const leg = (name, a, b, pixels) => {
  const t = traceDiff(a, b), p = pixels && withPix ? pixDiff(a, b) : [];
  if (t) fails.push(`${name}: trace ${t}`);
  if (p.length) fails.push(`${name}: pixels differ at ${p.join(', ')} s`);
  console.log(`${name}: trace ${t ?? 'equal'}${pixels ? (withPix ? `; pixels ${p.length ? 'differ at ' + p.join(', ') + ' s' : 'equal at ' + SHOTS.join(', ') + ' s'}` : '; pixels not compared') : ''}`);
};
const Bh = await run('new-hose', newUrl, '&hose');
leg('(i) new &hose against the ref, with the HUD', Bh, R1, true);
const Rn = await run('ref-nohud', refUrl, '&nohud');
const Bn = await run('new-nohud', newUrl, '&nohud');
leg('(ii) both &nohud', Bn, Rn, true);
const B = await run('new-plain', newUrl, '');
leg('(iii) both with the HUD', B, R1, false);
if (errors.length) fails.push(`page errors: ${errors[0]}`);
await browser.close();
writeFileSync(`${out}/openingsame.json`, JSON.stringify({ fails, stablePix, withPix }, null, 1));
console.log(fails.length ? `OPENINGSAME FAILED ${fails.length}:\n  ${fails.join('\n  ')}` : 'openingsame: all legs equal');
process.exit(fails.length ? 1 : 0);
