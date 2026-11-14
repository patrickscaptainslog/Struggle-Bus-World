#!/usr/bin/env node
// A first visit's opening, two builds side by side (docs/specs/core/CORE.md stage 1: a first-time player's start is the one before the return visit).
//   node tools/openingsame.mjs <ref url> <new url> <outdir>      exit 0 equal, 1 different, 3 the ref against itself isn't stable
// Each run: a fresh profile, ?t=2026-11-07T00:22:00Z&rate=0&fixeddt=0.0333333, the game held from before its first frame (controls.frozen: the frame still
// runs, the city streams, game time and the opening's clock stand) until city.loadedRegionCount() > 0 and !city.loading, then stepped 30 s of game time
// with no touch (__qa.holdFrames), the canvas taken at 0.5, 1, 2, 4.2, 8, 16 and 30 s. The trace: each game frame's x, y, z, heading, the opening's
// clock as the lens's pull (rig.openingPull, 140 (1 - k)^2: the clock itself isn't on BASE's __game), controls.opening and gearsLocked, to the last bit.
// Each still twice: as drawn, then drawn again with the bus's exhaust puffs taken out (their slots' births to 1e9, src/fx/Particles.ts's K_PUFF, and
// __game.renderAgain()): the puffs are Math.random's, and they alone moved 400-900 pixels round the bus from one run of one build to the next (r3). The
// pixels compared are the second's.
// The ref against itself twice first: traces not equal, exit 3 (the measure isn't stable). A still where they differ (before 4.2 s one run in three,
// the camera 9 cm off at the release, the whole frame resampled; at 30 s a lit spot far off: r3, neither found why) passes on a leg when the new run
// equals any of the ref's runs there, up to two more ref runs taken while it equals none.
// Then (i) new &hose against the ref, with the HUD: trace and pixels; (ii) both &nohud: trace and pixels; (iii) both with the HUD: the trace only
// (with the Hose off, the plain link's first-run hint has three lines where the ref's has four).
// SB_OPEN_Q=&nohud appends to every run of the new url, to show the pixels bite: (i) must then fail.
// SB_OPEN_REF_Q=&hose appends to the ref's runs with the HUD (the ref against itself and (i)): with a ref whose Hose is off too (the core's own build, as
// the ref for a branch merged with it), its hint then has the Hose's four lines, as 4f33648's had.
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
const NEW_Q = process.env.SB_OPEN_Q ?? '';
const REF_Q = process.env.SB_OPEN_REF_Q ?? '';
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
  let frames = 0, puffs = 0;
  for (const s of SHOTS) {
    const n = Math.round(s / DT) - frames;
    frames += n;
    await page.evaluate((n) => (window.__qa = { holdFrames: n, held: false }), n);
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 300000, polling: 50 });
    await page.screenshot({ path: `${out}/${label}-${String(s).replace('.', '_')}.png` });
    puffs += await page.evaluate(() => {
      // (Particles.ts: STRIDE 24 floats a slot, its birth at 3, its kind at 15, K_PUFF 4)
      const P = window.__game.particles, d = P.data;
      let k = 0;
      for (let i = 0; i < P.cap; i++) if (d[i * 24 + 15] === 4 && d[i * 24 + 3] < 1e8) (d[i * 24 + 3] = 1e9), k++;
      P.buf.updateRanges.length = 0;
      P.buf.needsUpdate = true;
      window.__game.renderAgain();
      return k;
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    pix.push(await page.screenshot({ path: `${out}/${label}-${String(s).replace('.', '_')}-nopuff.png` }));
  }
  const tr = await page.evaluate(() => window.__tr);
  await ctx.close();
  console.log(`${label}: ${tr.length} frames traced, the clock to ${tr.at(-1)?.[0]?.toFixed(3)}; ${puffs} puffs taken out at the stills`);
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
const pixDiff = (a, b, at = SHOTS) => SHOTS.filter((s, i) => at.includes(s) && !a.pix[i].equals(b.pix[i]));
/** the stills where `a` equals none of `refs` */
const pixDiffAny = (a, refs) => SHOTS.filter((s, i) => !refs.some((r) => a.pix[i].equals(r.pix[i])));

const fails = [];
const R1 = await run('ref-a', refUrl, REF_Q);
const R2 = await run('ref-b', refUrl, REF_Q);
const stableTrace = traceDiff(R1, R2), stablePix = pixDiff(R1, R2);
console.log(`the ref against itself: trace ${stableTrace ?? 'equal'}; pixels ${stablePix.length ? 'differ at ' + stablePix.join(', ') + ' s' : 'equal'}`);
if (stableTrace) {
  console.log('OPENINGSAME: the measure is not stable (the ref against itself, its trace): exit 3');
  await browser.close();
  process.exit(3);
}
// (a still where the ref's own runs differ is still compared: the new run must equal one of the ref's runs there, and while it equals none another
// ref run is taken, up to MORE_REFS. Left out, the fog's frames, where the first draws act, were never compared (r3's review); and at 30 s one lit
// spot far off in the city, 17 pixels, is on in some of the base's own runs and not others (r3))
const MORE_REFS = 2;
if (stablePix.length) console.log(`the ref against itself differs at ${stablePix.join(', ')} s: there each leg passes on any of the ref's runs`);
const leg = async (name, a, refs, pixels, label, extra) => {
  const t = traceDiff(a, refs[0]);
  let p = pixels ? pixDiffAny(a, refs) : [];
  for (let k = 0; pixels && p.length && k < MORE_REFS; k++) {
    refs.push(await run(`${label}-${refs.length + 1}`, refUrl, extra));
    p = pixDiffAny(a, refs);
  }
  if (t) fails.push(`${name}: trace ${t}`);
  if (p.length) fails.push(`${name}: pixels differ at ${p.join(', ')} s`);
  const which = pixels ? SHOTS.map((s, i) => `${s} ${refs.findIndex((r) => a.pix[i].equals(r.pix[i])) + 1 || '-'}`).join(', ') : '';
  console.log(`${name}: trace ${t ?? 'equal'}${pixels ? `; pixels (the puffs out) ${p.length ? 'differ at ' + p.join(', ') + ' s' : 'equal at every still'} (the ref run each equals: ${which})` : ''}`);
};
const Bh = await run('new-hose', newUrl, '&hose' + NEW_Q);
await leg('(i) new &hose against the ref, with the HUD', Bh, [R1, R2], true, 'ref', REF_Q);
const Rn = await run('ref-nohud', refUrl, '&nohud');
const Bn = await run('new-nohud', newUrl, '&nohud' + NEW_Q);
await leg('(ii) both &nohud', Bn, [Rn], true, 'ref-nohud', '&nohud');
const B = await run('new-plain', newUrl, NEW_Q);
await leg('(iii) both with the HUD', B, [R1], false);
if (errors.length) fails.push(`page errors: ${errors[0]}`);
await browser.close();
writeFileSync(`${out}/openingsame.json`, JSON.stringify({ fails, stablePix, comparedAt: SHOTS }, null, 1));
console.log(fails.length ? `OPENINGSAME FAILED ${fails.length}:\n  ${fails.join('\n  ')}` : 'openingsame: all legs equal');
process.exit(fails.length ? 1 : 0);
