#!/usr/bin/env node
// Blast QA at the Painted Ladies (real game, iPhone portrait viewport).
//   node tools/blast.mjs <baseUrl> <outDir> [perf] [seq] [top] [reload] [escalate] [tap] [drop] [layouts]
//
//   perf    CPU work ms / draw calls / triangles per frame: grey hover baseline,
//           then the frames during and after one blast and an escalation (perf.json)
//   seq     frame sequence after impact (jet, flash, ring, blooms, settled),
//           stepped on a fixed 1/30 s game clock so frames land on time
//   top     the settled blast seen from straight above (hue layout check)
//   reload  reloads the page and shoots the same spot (persistence check)
//   escalate  a second barf on the same spot (everything levels up)
//   tap     a real tap in cruise (gameplay framing)
//   drop    a barf dropped from 300 m (the altitude interface: twice the radius)
//   layouts the hue-layout bake-off (pinwheel / rings / spiral), chase + top-down
//
// SwiftShader fps is meaningless; workMs, calls and triangles are what count.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4301/';
const out = process.argv[3] ?? 'shots/blast';
const modes = new Set(process.argv.slice(4).length ? process.argv.slice(4) : ['perf', 'seq', 'top', 'reload']);
mkdirSync(out, { recursive: true });

const START = '?lat=37.7745&lon=-122.4330&heading=0&skipintro';
const IMPACT = [37.7762, -122.4328];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
let ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

async function open(query, fresh = true) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  if (fresh) {
    // start from a grey city (both building and ground paint)
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('sbqa')) {
        sessionStorage.setItem('sbqa', '1');
        for (const k of Object.keys(localStorage)) if (k.startsWith('strugglebus.')) localStorage.removeItem(k);
      }
    });
  }
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  return page;
}

/** Run until the game clock has advanced `seconds` (or reached `abs` if given). */
async function runFor(page, seconds) {
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
}

/** Record per-frame work ms / draws / triangles for `seconds` of game time. */
async function sample(page, seconds, tag) {
  return page.evaluate(
    ({ s, tag }) =>
      new Promise((res) => {
        const g = window.__game;
        const p = g.perf;
        const orig = p.frame;
        const rows = [];
        const start = g.clock();
        p.frame = function (dt, work) {
          const r = this.renderer.info.render;
          rows.push({ t: +(g.clock() - start).toFixed(3), work: +work.toFixed(2), calls: r.calls, tris: r.triangles, points: r.points });
          return orig.call(this, dt, work);
        };
        const tick = () => {
          if (g.clock() - start >= s && rows.length >= 4) {
            p.frame = orig;
            res({ tag, rows });
          } else requestAnimationFrame(tick);
        };
        tick();
      }),
    { s: seconds, tag },
  );
}

function summarize(rows) {
  const w = rows.map((r) => r.work).sort((a, b) => a - b);
  const med = w[Math.floor(w.length / 2)];
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  return {
    frames: rows.length,
    workMedian: +med.toFixed(2),
    workMean: +mean.toFixed(2),
    workMax: w[w.length - 1],
    callsMax: Math.max(...rows.map((r) => r.calls)),
    callsMin: Math.min(...rows.map((r) => r.calls)),
    trisMax: Math.max(...rows.map((r) => r.tris)),
    pointsMax: Math.max(...rows.map((r) => r.points)),
  };
}

const hover = (page) => page.evaluate(() => (window.__qa = { sx: 0, sy: -1 }));
const barf = (page) => page.evaluate(([la, lo]) => window.__game.barfAtLatLon(la, lo), IMPACT);

if (modes.has('perf')) {
  const page = await open(START + '&fps');
  await hover(page);
  await runFor(page, 1.5);
  const grey = await sample(page, 1.5, 'grey');
  await barf(page);
  const blast = await sample(page, 1.6, 'blast');
  const after = await sample(page, 1.5, 'painted');
  // a second barf on the same spot: everything escalates (rooftop gardens, re-pops)
  await barf(page);
  const blast2 = await sample(page, 1.6, 'escalate');
  const after2 = await sample(page, 1.5, 'painted2');
  const report = {
    grey: summarize(grey.rows), blast: summarize(blast.rows), painted: summarize(after.rows), escalate: summarize(blast2.rows), painted2: summarize(after2.rows),
    raw: { grey: grey.rows, blast: blast.rows, painted: after.rows, escalate: blast2.rows, painted2: after2.rows },
  };
  writeFileSync(`${out}/perf.json`, JSON.stringify(report, null, 2));
  const { raw, ...sum } = report;
  console.log('perf', JSON.stringify(sum, null, 1));
  await page.screenshot({ path: `${out}/perf-end.png` });
  await page.close();
}

if (modes.has('seq')) {
  // fixed 1/30 s steps: each rendered frame advances the game exactly one step
  const page = await open(START + '&fixeddt=0.0333');
  await hover(page);
  await runFor(page, 1.0);
  const tImpact = await barf(page);
  const marks = [-0.2, 0, 0.05, 0.15, 0.3, 0.6, 1.2, 2.5];
  for (const m of marks) {
    // hold the frame loop on the first frame at/after impact + m
    await page.evaluate((at) => (window.__qa.holdAt = at), tImpact + m);
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 300000 });
    const name = m < 0 ? `seq-jet` : `seq-${m.toFixed(2)}`;
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log('shot', name, await page.evaluate(() => window.__game.clock().toFixed(3)));
    await page.evaluate(() => {
      window.__qa.holdAt = undefined;
      window.__qa.held = false;
    });
  }
  await page.close();
}

if (modes.has('top')) {
  // straight down over the impact (QA camera override), after the blast settles
  const page = await open(START + '&fixeddt=0.0333');
  await hover(page);
  await runFor(page, 1.0);
  await barf(page);
  await runFor(page, 2.5);
  console.log('painted', JSON.stringify(await page.evaluate(([la, lo]) => window.__game.paintedNear(la, lo, 90), IMPACT)));
  await page.evaluate(([la, lo]) => (window.__qa.topDown = { lat: la, lon: lo, height: 420 }), IMPACT);
  await runFor(page, 0.2);
  await page.screenshot({ path: `${out}/top.png` });
  await page.evaluate(() => (window.__qa.topDown = null));
  await runFor(page, 0.2);
  await page.screenshot({ path: `${out}/chase.png` });
  if (modes.has('reload')) {
    await runFor(page, 1.5); // let the paint save timers run
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
    await hover(page);
    await runFor(page, 3.5);
    await page.screenshot({ path: `${out}/reload.png` });
    await page.evaluate(([la, lo]) => (window.__qa.topDown = { lat: la, lon: lo, height: 420 }), IMPACT);
    await runFor(page, 0.2);
    await page.screenshot({ path: `${out}/reload-top.png` });
    console.log('painted after reload', JSON.stringify(await page.evaluate(([la, lo]) => window.__game.paintedNear(la, lo, 90), IMPACT)));
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('strugglebus.')).map((k) => [k, localStorage.getItem(k).length]));
    console.log('storage', JSON.stringify(keys));
  }
  await page.close();
}

if (modes.has('escalate')) {
  // two barfs on the same spot: the second escalates everything (gardens, re-pops, new ground hues)
  const page = await open(START + '&fixeddt=0.0333');
  await hover(page);
  await runFor(page, 1.0);
  await barf(page);
  await runFor(page, 2.5);
  await page.screenshot({ path: `${out}/esc-1.png` });
  const t2 = await barf(page);
  for (const m of [0.3, 2.5]) {
    await page.evaluate((at) => (window.__qa.holdAt = at), t2 + m);
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 300000 });
    await page.screenshot({ path: `${out}/esc-2-${m.toFixed(2)}.png` });
    await page.evaluate(() => {
      window.__qa.holdAt = undefined;
      window.__qa.held = false;
    });
  }
  console.log('escalated', JSON.stringify(await page.evaluate(([la, lo]) => window.__game.paintedNear(la, lo, 90), IMPACT)));
  await page.evaluate(([la, lo]) => (window.__qa.topDown = { lat: la, lon: lo, height: 420 }), IMPACT);
  await runFor(page, 0.2);
  await page.screenshot({ path: `${out}/esc-top.png` });
  await page.close();
}

if (modes.has('tap')) {
  // a real tap in cruise over Alamo Square, heading east at the Painted Ladies row
  const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro&fixeddt=0.0333');
  await page.evaluate(() => (window.__qa = null));
  await runFor(page, 1.5);
  const tImpact = await page.evaluate(() => {
    const g = window.__game;
    g.forceReady();
    g.tapSplat();
    return g.clock() + 0.42;
  });
  for (const m of [0.15, 0.6, 2.0]) {
    await page.evaluate((at) => (window.__qa = { holdAt: at }), tImpact + m);
    await page.waitForFunction(() => window.__qa && window.__qa.held === true, null, { timeout: 300000 });
    await page.screenshot({ path: `${out}/tap-${m.toFixed(2)}.png` });
    await page.evaluate(() => (window.__qa = null));
  }
  await page.close();
}

if (modes.has('drop')) {
  // the altitude interface: barf(x, z, { drop: 300 }) doubles the radius
  const page = await open(START + '&fixeddt=0.0333');
  await hover(page);
  await runFor(page, 1.0);
  await page.evaluate(([la, lo]) => window.__game.barfAtLatLon(la, lo, 300), IMPACT);
  await runFor(page, 2.5);
  await page.screenshot({ path: `${out}/drop300-chase.png` });
  console.log('drop300', JSON.stringify(await page.evaluate(([la, lo]) => window.__game.paintedNear(la, lo, 160), IMPACT)));
  await page.evaluate(([la, lo]) => (window.__qa.topDown = { lat: la, lon: lo, height: 760 }), IMPACT);
  await runFor(page, 0.2);
  await page.screenshot({ path: `${out}/drop300-top.png` });
  await page.close();
}

if (modes.has('layouts')) {
  // hue layout bake-off: 0 pinwheel, 1 rings, 2 spiral — chase + top-down each
  for (const L of [0, 1, 2]) {
    await ctx.close();
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    await ctx.addInitScript((l) => localStorage.setItem('sb.tuning.v1', JSON.stringify({ config: { 'splat.hueLayout': l }, groups: {} })), L);
    const page = await open(START + '&fixeddt=0.0333');
    await hover(page);
    await runFor(page, 1.0);
    await barf(page);
    await runFor(page, 2.5);
    await page.screenshot({ path: `${out}/layout${L}-chase.png` });
    await page.evaluate(([la, lo]) => (window.__qa.topDown = { lat: la, lon: lo, height: 420 }), IMPACT);
    await runFor(page, 0.2);
    await page.screenshot({ path: `${out}/layout${L}-top.png` });
    await page.close();
  }
}

await browser.close();
console.log('blast shots saved to', out);
