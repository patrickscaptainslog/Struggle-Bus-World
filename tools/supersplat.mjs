#!/usr/bin/env node
// Super splat QA in the real game (index.html), iPhone portrait viewport, one browser.
//   node tools/supersplat.mjs <baseUrl> <outDir> [modes...] [--base=<baseline url>]
// modes (default: all but base):
//   charge    the charge strip: frames at 0 / 2.5 / 5 / 7.5 / 10 s of a scripted hold (__game.superSplat(10)),
//             then the firehose it lets go (charge-*.png, charge.json)
//   sweep     the firehose sweeping a right turn over the Painted Ladies toward Hayes Valley: a frame every 0.5 s,
//             counts (buildings painted, ground share) vs a single tap at the same spot, perf every frame of the
//             pour (work ms, draws, triangles, points, texture uploads) vs the tap blast (sweep-*.png, sweep.json)
//   alt       the firehose from 250 m (a climb on the yoke, then a full charge) (alt-*.png)
//   mega      an early release at 50 %: the mega blast (frames around the impact, counts, radius, cooldown) (mega-*.png)
//   cooldown  the meter at 0 / 30 / 59 / 60 s of the cooldown after a firehose, and "not yet" (meter-*.png)
//   audio     (with cooldown) the super splat's sounds rendered offline: peak, clipping, NaN (audio.json)
//   base      (with --base=<url>) the same tap blast perf on the baseline build, for before/after
// Everything waits on the game clock (?fixeddt=1/30 steps it exactly), never wall time: SwiftShader runs ~1.5 fps.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [base = 'http://127.0.0.1:5201/', out = 'shots/supersplat', ...modeList] = args.filter((a) => !a.startsWith('--'));
const modes = new Set(modeList.length ? modeList : ['charge', 'sweep', 'alt', 'mega', 'cooldown']);
mkdirSync(out, { recursive: true });
const DT = '&fixeddt=0.0333333';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

async function open(url) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  await page.addInitScript(() => {
    // a grey city every time (building + ground paint)
    for (const k of Object.keys(localStorage)) if (k.startsWith('strugglebus.')) localStorage.removeItem(k);
    // count GPU uploads per frame (texture sub-uploads, and the most any one texture got; full texture uploads; buffer sub-uploads)
    window.__up = { tex: 0, texFull: 0, buf: 0, perTex: new Map(), perTexMax: 0 };
    const P = WebGL2RenderingContext.prototype;
    const wrap = (name, key) => {
      const o = P[name];
      P[name] = function (...a) {
        window.__up[key]++;
        return o.apply(this, a);
      };
    };
    const sub = P.texSubImage2D;
    P.texSubImage2D = function (...a) {
      const U = window.__up;
      U.tex++;
      const t = this.getParameter(this.TEXTURE_BINDING_2D);
      const n = (U.perTex.get(t) ?? 0) + 1;
      U.perTex.set(t, n);
      if (n > U.perTexMax) U.perTexMax = n;
      return sub.apply(this, a);
    };
    wrap('texImage2D', 'texFull');
    wrap('bufferSubData', 'buf');
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 400000 });
  return page;
}

const clock = (page) => page.evaluate(() => window.__game.clock());
async function runFor(page, s) {
  await page.evaluate(
    (s) =>
      new Promise((res) => {
        const g = window.__game;
        const start = g.clock();
        const tick = () => (g.clock() - start >= s ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    s,
  );
}
async function runUntil(page, cond, maxS = 60) {
  await page.evaluate(
    ({ cond, maxS }) =>
      new Promise((res) => {
        const g = window.__game;
        const start = g.clock();
        const f = new Function('g', `return (${cond});`);
        const tick = () => (f(g) || g.clock() - start >= maxS ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    { cond, maxS },
  );
}
const setQa = (page, o) => page.evaluate((o) => (window.__qa = o ? { ...(window.__qa || {}), ...o } : null), o);
/** Freeze on the first frame at/after game time t, screenshot, carry on. */
async function shotAt(page, t, path, clip) {
  await page.evaluate((t) => {
    window.__qa = { ...(window.__qa || {}), holdAt: t, held: false };
  }, t);
  await page.waitForFunction(() => window.__qa && window.__qa.held === true, null, { timeout: 2400000 });
  const info = await page.evaluate(() => ({ t: +window.__game.clock().toFixed(3), ...window.__game.superState() }));
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  await page.evaluate(() => {
    delete window.__qa.holdAt;
    window.__qa.held = false;
  });
  console.log('shot', path, JSON.stringify({ t: info.t, phase: info.phase, charge: +info.charge.toFixed(3), cooldownLeft: +info.cooldownLeft.toFixed(1) }));
  return info;
}
const meterClip = (page) =>
  page.evaluate(() => {
    const r = document.querySelector('[data-sb-ui=super]').getBoundingClientRect();
    return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 };
  });

/** Per-frame work ms / draw calls / triangles / points / uploads for `seconds` of game time. */
async function sample(page, seconds) {
  return page.evaluate(
    (s) =>
      new Promise((res) => {
        const g = window.__game;
        const p = g.perf;
        const orig = p.frame;
        const rows = [];
        const start = g.clock();
        const up = window.__up;
        const reset = () => {
          up.tex = up.texFull = up.buf = up.perTexMax = 0;
          up.perTex.clear();
        };
        reset();
        p.frame = function (dt, work) {
          const r = this.renderer.info.render;
          rows.push({ t: +(g.clock() - start).toFixed(3), work: +work.toFixed(2), calls: r.calls, tris: r.triangles, points: r.points, tex: up.tex, perTex: up.perTexMax, texFull: up.texFull, buf: up.buf, phase: g.superState ? g.superState().phase : '' });
          reset();
          return orig.call(this, dt, work);
        };
        const tick = () => {
          if (g.clock() - start >= s && rows.length >= 4) {
            p.frame = orig;
            res(rows);
          } else requestAnimationFrame(tick);
        };
        tick();
      }),
    seconds,
  );
}
function summarize(rows) {
  if (!rows.length) return null;
  const w = rows.map((r) => r.work).sort((a, b) => a - b);
  const q = (k) => rows.map((r) => r[k]);
  const sorted = (a) => [...a].sort((x, y) => x - y);
  return {
    frames: rows.length,
    workMedian: w[Math.floor(w.length / 2)],
    workP90: w[Math.floor(w.length * 0.9)],
    workMax: w[w.length - 1],
    callsMedian: sorted(q('calls'))[Math.floor(rows.length / 2)],
    callsMax: Math.max(...q('calls')),
    trisMedian: sorted(q('tris'))[Math.floor(rows.length / 2)],
    trisMax: Math.max(...q('tris')),
    pointsMax: Math.max(...q('points')),
    texUploadsMedian: sorted(q('tex'))[Math.floor(rows.length / 2)],
    texUploadsMax: Math.max(...q('tex')),
    texUploadsPerTextureMax: Math.max(...q('perTex')),
    texFullMax: Math.max(...q('texFull')),
    bufUploadsMax: Math.max(...q('buf')),
  };
}

// the Painted Ladies (Steiner St between Hayes and Grove) and the start of the sweep south-west of them
const LADIES = [37.7762, -122.4328];
const SWEEP = '?lat=37.7748&lon=-122.4342&heading=30&skipintro';
const report = {};

if (modes.has('charge')) {
  // cruise east over Alamo Square, hold for the whole charge; the firehose lets go on its own
  const page = await open(base + '?lat=37.7752&lon=-122.4400&heading=75&skipintro' + DT);
  await runFor(page, 1.5);
  const t0 = await clock(page);
  await page.evaluate(() => window.__game.superSplat(10));
  const strip = [];
  for (const [label, dt] of [['0', 0.05], ['2.5', 2.5], ['5', 5], ['7.5', 7.5], ['10', 9.97]]) strip.push(await shotAt(page, t0 + dt, `${out}/charge-${label}.png`));
  // it lets go: the first frames of the firehose
  strip.push(await shotAt(page, t0 + 10.3, `${out}/charge-hose-0.3.png`));
  strip.push(await shotAt(page, t0 + 11.2, `${out}/charge-hose-1.2.png`));
  report.charge = strip;
  writeFileSync(`${out}/charge.json`, JSON.stringify(report.charge, null, 1));
  await page.close();
}

if (modes.has('sweep')) {
  // (1) perf + the tap's counts: a single tap at the start of the sweep on a fresh page, then (no screenshots
  // anywhere near: a screenshot stalls the frame it lands in) a full firehose, every frame of it sampled
  const tapPage = await open(base + SWEEP + DT);
  await runFor(tapPage, 1.5);
  const greyRows = await sample(tapPage, 1.2);
  await tapPage.evaluate(() => window.__game.forceReady());
  await runFor(tapPage, 0.1);
  await tapPage.evaluate(() => window.__game.tapSplat());
  const tapShot = await tapPage.evaluate(() => window.__game.lastShot());
  const tapRows = await sample(tapPage, 1.6);
  await runFor(tapPage, 1);
  const tapCounts = await tapPage.evaluate(([la, lo]) => window.__game.paintedNear(la, lo, 220), LADIES);
  await tapPage.screenshot({ path: `${out}/sweep-tap.png` });
  await runFor(tapPage, 1);
  await tapPage.evaluate(() => window.__game.superSplatter.chargeStart(9.9));
  await runUntil(tapPage, "g.superState().phase === 'firehose'", 2);
  await setQa(tapPage, { sx: 0.25, sy: 0 });
  const hoseRows = await sample(tapPage, 4.6);
  await setQa(tapPage, null);
  const settledRows = await sample(tapPage, 1.5);
  await tapPage.close();

  // (2) the sweep's frames and counts on a fresh page
  const page = await open(base + SWEEP + DT);
  await runFor(page, 1.5);
  // a full charge (the strip above checks the charge itself): from 9.9 s held
  await page.evaluate(() => window.__game.superSplatter.chargeStart(9.9));
  await runUntil(page, "g.superState().phase === 'firehose'", 2);
  await setQa(page, { sx: 0.25, sy: 0 });
  const t0 = await clock(page);
  const frames = [];
  for (let k = 0; k <= 8; k++) frames.push(await shotAt(page, t0 + 0.02 + k * 0.5, `${out}/sweep-${(k * 0.5).toFixed(1)}.png`));
  await runUntil(page, "g.superState().phase === 'cooldown'", 3);
  await setQa(page, null);
  await runFor(page, 1.5);
  await page.screenshot({ path: `${out}/sweep-after.png` });
  const st = await page.evaluate(() => window.__game.superState());
  const hoseCounts = await page.evaluate(([la, lo]) => window.__game.paintedNear(la, lo, 220), LADIES);
  // every painted building within 600 m (a fresh page: all of it is this firehose's), by level
  const levels = await page.evaluate(() => {
    const g = window.__game;
    let l1 = 0, l2 = 0, l3 = 0;
    for (const n of g.city.buildingsNear(g.flight.x, g.flight.z, 600, [])) {
      const lv = g.city.paint.level(n.ref.index);
      if (lv > 2.5) l3++;
      else if (lv > 1.5) l2++;
      else if (lv > 0.5) l1++;
    }
    return { l1, l2, l3, painted: l1 + l2 + l3 };
  });
  report.sweep = {
    tap: { shot: tapShot, within220OfLadies: tapCounts, perf: summarize(tapRows), grey: summarize(greyRows) },
    firehose: { stats: st.stats, within220OfLadies: hoseCounts, levelsWithin600: levels, perf: summarize(hoseRows.filter((r) => r.phase === 'firehose')), perfSettled: summarize(settledRows), frames },
    raw: { grey: greyRows, tap: tapRows, hose: hoseRows, settled: settledRows },
  };
  writeFileSync(`${out}/sweep.json`, JSON.stringify(report.sweep, null, 1));
  const { raw, ...brief } = report.sweep;
  console.log('sweep', JSON.stringify({ tap: brief.tap, firehose: { ...brief.firehose, frames: undefined } }, null, 1));
  await page.close();
}

if (modes.has('alt')) {
  const page = await open(base + '?lat=37.7700&lon=-122.4420&heading=60&skipintro' + DT);
  await runFor(page, 1);
  // climb on the yoke to ~250 m above the ground, let go (the coast lands there), let the lens settle
  await setQa(page, { sx: 0, sy: -1 });
  await runUntil(page, 'g.flight.y + Math.max(0, g.flight.vy) / 1.7 - g.flight.groundUnder >= 250', 40);
  await setQa(page, null);
  await runFor(page, 3);
  await page.screenshot({ path: `${out}/alt-before.png` });
  await page.evaluate(() => window.__game.superSplatter.chargeStart(9.9));
  await runUntil(page, "g.superState().phase === 'firehose'", 2);
  await setQa(page, { sx: 0.12, sy: 0 });
  const t0 = await clock(page);
  const frames = [];
  for (const dt of [0.6, 1.6, 2.6, 3.6]) frames.push(await shotAt(page, t0 + dt, `${out}/alt-${dt.toFixed(1)}.png`));
  await runUntil(page, "g.superState().phase === 'cooldown'", 4);
  await setQa(page, null);
  await runFor(page, 1.5);
  await page.screenshot({ path: `${out}/alt-after.png` });
  const st = await page.evaluate(() => ({ ...window.__game.superState(), lift: window.__game.flight.lift, height: window.__game.flight.y - window.__game.flight.groundUnder }));
  report.alt = { frames, state: st };
  writeFileSync(`${out}/alt.json`, JSON.stringify(report.alt, null, 1));
  console.log('alt', JSON.stringify(st.stats), 'height', st.height.toFixed(0));
  await page.close();
}

if (modes.has('mega')) {
  const page = await open(base + '?lat=37.7741&lon=-122.4372&heading=60&skipintro' + DT);
  await runFor(page, 1.5);
  const t0 = await clock(page);
  // (the charge itself is the charge strip's: this one starts 4.4 s in and lets go at 5 s = 50 %)
  const rel = await page.evaluate(() => window.__game.superSplat(5, 4.4));
  const frames = [];
  frames.push(await shotAt(page, t0 + 0.5, `${out}/mega-charge50.png`));
  // the release: inhale, the fat jet, the impact (hit-stop frames hold it), the bloom
  const shot = await page.evaluate(() => new Promise((res) => {
    const g = window.__game;
    const tick = () => (g.superState().phase === 'cooldown' ? res(g.lastShot()) : requestAnimationFrame(tick));
    tick();
  }));
  const tr = shot ? shot.travel : 0.45;
  const tRel = shot ? shot.t : rel;
  frames.push(await shotAt(page, tRel + 0.2, `${out}/mega-jet.png`));
  frames.push(await shotAt(page, tRel + tr + 0.01, `${out}/mega-impact.png`));
  frames.push(await shotAt(page, tRel + tr + 0.35, `${out}/mega-wave.png`));
  frames.push(await shotAt(page, tRel + tr + 1.5, `${out}/mega-after.png`));
  const counts = shot ? await page.evaluate((a) => {
    const g = window.__game;
    // paintedNear takes lat/lon: measure in game meters directly
    const [x, , z] = a;
    const near = g.city.buildingsNear(x, z, 160, []);
    let p = 0;
    for (const n of near) if (g.city.paint.level(n.ref.index) > 0.5) p++;
    return { buildings160: near.length, painted160: p };
  }, shot.aim) : null;
  const st = await page.evaluate(() => window.__game.superState());
  report.mega = { shot, counts, state: st, frames };
  writeFileSync(`${out}/mega.json`, JSON.stringify(report.mega, null, 1));
  console.log('mega', JSON.stringify({ radius: shot?.mega, counts, cooldownTotal: st.cooldownTotal, stats: st.stats }));
  await page.close();
}

if (modes.has('cooldown')) {
  const page = await open(base + '?lat=37.7762&lon=-122.4400&heading=90&skipintro' + DT);
  await runFor(page, 1.5);
  const clip0 = await meterClip(page);
  await page.screenshot({ path: `${out}/meter-ready.png`, clip: clip0 });
  await page.evaluate(() => window.__game.superSplatter.chargeStart(9.2));
  await runFor(page, 0.5);
  await page.screenshot({ path: `${out}/meter-charging.png`, clip: await meterClip(page) });
  await page.evaluate(() => window.__game.superSplatter.chargeStart(0)); // (no-op while charging)
  await runUntil(page, "g.superState().phase === 'firehose'", 3);
  await runFor(page, 0.3);
  await page.screenshot({ path: `${out}/meter-firehose.png`, clip: await meterClip(page) });
  await runUntil(page, "g.superState().phase === 'cooldown'", 6);
  const shots = [];
  for (const at of [0, 30, 59, 60]) {
    const st = await page.evaluate(() => window.__game.superState());
    const elapsed = st.cooldownTotal - st.cooldownLeft;
    // (0 s: the drain as it ends, then the empty ring; the rest skip the cooldown clock ahead)
    if (at === 0) {
      await runFor(page, 0.2);
      await page.screenshot({ path: `${out}/meter-cooldown-0-drain.png`, clip: await meterClip(page) });
      await runFor(page, 0.35);
    }
    else await page.evaluate((s) => window.__game.superSkip(s), Math.max(0, at - elapsed));
    await runFor(page, 0.07);
    const clip = await meterClip(page);
    const s2 = await page.evaluate(() => window.__game.superState());
    await page.screenshot({ path: `${out}/meter-cooldown-${at}.png`, clip });
    shots.push({ at, phase: s2.phase, left: +s2.cooldownLeft.toFixed(2) });
    if (at === 30) {
      // "not yet": holding during the cooldown
      await page.evaluate(() => window.__game.superSplatter.chargeStart(0));
      await runFor(page, 0.1);
      await page.screenshot({ path: `${out}/meter-notyet.png`, clip: await meterClip(page) });
      await page.screenshot({ path: `${out}/notyet.png` });
    }
    if (at === 0) await page.screenshot({ path: `${out}/spent.png` });
  }
  await runFor(page, 0.25);
  await page.screenshot({ path: `${out}/meter-ready-again.png`, clip: await meterClip(page) });
  report.cooldown = shots;
  writeFileSync(`${out}/cooldown.json`, JSON.stringify(shots, null, 1));
  console.log('cooldown', JSON.stringify(shots));
  if (modes.has('audio')) {
    // the super splat's sounds rendered offline through the real graph (levels, clipping, NaN)
    report.audio = await page.evaluate(() => window.__game.superAudioCheck());
    writeFileSync(`${out}/audio.json`, JSON.stringify(report.audio, null, 1));
    console.log('audio', JSON.stringify(report.audio));
  }
  await page.close();
}

if (modes.has('base') && flags.base) {
  const page = await open(flags.base + SWEEP + DT);
  await runFor(page, 1.5);
  const grey = await sample(page, 1.2);
  await page.evaluate(() => window.__game.forceReady());
  await runFor(page, 0.1);
  await page.evaluate(() => window.__game.tapSplat());
  const tap = await sample(page, 1.6);
  report.base = { grey: summarize(grey), tap: summarize(tap) };
  writeFileSync(`${out}/base.json`, JSON.stringify(report.base, null, 1));
  console.log('base', JSON.stringify(report.base, null, 1));
  await page.close();
}

await browser.close();
