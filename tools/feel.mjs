#!/usr/bin/env node
// Feel QA in the real game (index.html), iPhone portrait viewport.
//   node tools/feel.mjs <baseUrl> <outDir> [strip] [glint] [taps]
//
//   strip  tap -> inhale -> jet -> impact -> the 4 hit-stop frames -> bloom, at the
//          Painted Ladies, stepped on a fixed 1/60 s clock (each frame frozen with
//          __qa.holdAt / __qa.holdFrames); strip.png is a crop of every frame side by side
//   glint  the glinting building with the glint on and off (same pose, one frame apart):
//          glint.json counts the pixels it changes
//   taps   real taps through Input's path (tapSplat): at the floor (cruise, surge,
//          second finger while turning, lift-then-tap) and from 120 m / 250 m / the
//          ceiling: the building glinting before the tap vs the one the breath hits and
//          paints (taps.json)
//
// SwiftShader renders ~1.5 fps: everything waits on the game clock, never wall time.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = process.argv[2] ?? 'http://127.0.0.1:4731/';
const out = process.argv[3] ?? 'shots/feel';
const modes = new Set(process.argv.slice(4).length ? process.argv.slice(4) : ['strip', 'glint', 'taps']);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  return page;
}
const runFor = (page, s) =>
  page.evaluate(
    (s) =>
      new Promise((res) => {
        const g = window.__game;
        const t0 = g.clock();
        const tick = () => (g.clock() - t0 >= s ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    s,
  );
const until = (page, cond, maxS) =>
  page.evaluate(
    ([cond, maxS]) =>
      new Promise((res) => {
        const g = window.__game;
        const t0 = g.clock();
        const f = new Function('g', `return (${cond});`);
        const tick = () => (f(g) || g.clock() - t0 >= maxS ? res(g.clock() - t0) : requestAnimationFrame(tick));
        tick();
      }),
    [cond, maxS],
  );
// freeze on the first frame at/after game time t (or after n more rendered frames)
const holdAt = async (page, t) => {
  await page.evaluate((t) => Object.assign(window.__qa ?? (window.__qa = {}), { holdAt: t, holdFrames: undefined, held: false }), t);
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 300000 });
};
const holdFrames = async (page, n) => {
  await page.evaluate((n) => Object.assign(window.__qa, { holdAt: undefined, holdFrames: n, held: false }), n);
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 300000 });
};
const state = (page) =>
  page.evaluate(() => {
    const g = window.__game, f = g.flight;
    return { t: +g.clock().toFixed(4), barfT: +f.barfT.toFixed(3), belly: +(f.barfT >= 0 ? f.belly : f.fullness).toFixed(2), pitch: +f.pitch.toFixed(3), y: +f.y.toFixed(1), glint: g.glintNow()?.index ?? -1 };
  });

const START = '?lat=37.77628&lon=-122.4343&heading=88&skipintro';

if (modes.has('strip')) {
  const page = await open(START + '&fixeddt=0.016667');
  await page.evaluate(() => ((window.__qa = null), (window.__game.flight.glideSpeed = 19.2)));
  await runFor(page, 0.6);
  await page.evaluate(() => window.__game.forceReady());
  await runFor(page, 0.4);
  const T0 = await page.evaluate(() => window.__game.clock() + 0.05);
  const frames = [];
  const grab = async (name) => {
    const st = await state(page);
    await page.screenshot({ path: `${out}/strip-${name}.png` });
    frames.push({ name, ...st });
    console.log('frame', name, JSON.stringify(st));
  };
  await holdAt(page, T0);
  await grab('0-glint');
  await page.evaluate(() => window.__game.tapSplat());
  const shot = await page.evaluate(() => window.__game.lastShot());
  await holdFrames(page, 1);
  await grab('1-tap');
  for (const dt of [0.05, 0.1, 0.15, 0.25, 0.35]) {
    await holdAt(page, shot.t + dt);
    await grab(`2-${dt.toFixed(2)}`);
  }
  await holdAt(page, shot.t + shot.travel);
  await grab('3-impact');
  for (let i = 1; i <= 4; i++) {
    await holdFrames(page, 1);
    await grab(`4-hitstop${i}`);
  }
  for (const dt of [0.1, 0.3, 0.6]) {
    await holdAt(page, shot.t + shot.travel + dt);
    await grab(`5-after${dt.toFixed(1)}`);
  }
  const painted = await page.evaluate((i) => window.__game.city.paint.level(i), shot.target?.index ?? -1);
  writeFileSync(`${out}/strip.json`, JSON.stringify({ shot, painted, frames }, null, 1));
  await page.close();
  try {
    execFileSync('python3', ['-I', new URL('./feel-strip.py', import.meta.url).pathname, out, ...frames.map((f) => `strip-${f.name}.png`)], { stdio: 'inherit' });
  } catch (e) {
    console.log('strip composite failed', String(e));
  }
}

if (modes.has('glint')) {
  const page = await open(START + '&fixeddt=0.016667');
  await page.evaluate(() => ((window.__qa = null), (window.__game.flight.glideSpeed = 6)));
  await runFor(page, 0.5);
  await page.evaluate(() => window.__game.forceReady());
  await runFor(page, 0.3);
  const t = await page.evaluate(() => window.__game.clock() + 0.05);
  await holdAt(page, t);
  const on = await state(page);
  await page.screenshot({ path: `${out}/glint-on.png` });
  // a quarter sweep later: the band of light has moved up the facade
  await holdAt(page, t + 0.12);
  await page.screenshot({ path: `${out}/glint-on2.png` });
  await page.evaluate(() => (window.__game.flight.fullness = 0.5));
  await holdFrames(page, 1);
  const off = await state(page);
  await page.screenshot({ path: `${out}/glint-off.png` });
  const target = await page.evaluate((i) => {
    const g = window.__game;
    const r = [...g.city.loadedRefs()].find((q) => q.index === i);
    if (!r) return null;
    const v = g.camera.position.clone();
    const p = g.pipeline.project(v.set(r.cx, (r.baseY + r.roofY) / 2, r.cz));
    return { index: i, screen: [p.x, p.y], height: r.roofY - r.baseY };
  }, on.glint);
  writeFileSync(`${out}/glint.json`, JSON.stringify({ on, off, target }, null, 1));
  await page.close();
  try {
    execFileSync('python3', ['-I', new URL('./feel-strip.py', import.meta.url).pathname, out, '--diff', 'glint-on.png', 'glint-off.png', 'glint-on2.png'], { stdio: 'inherit' });
  } catch (e) {
    console.log('glint diff failed', String(e));
  }
}

if (modes.has('taps')) {
  const page = await open('?lat=37.7762&lon=-122.4380&heading=90&skipintro');
  const qa = (v) => page.evaluate((v) => (window.__qa = v), v);
  const res = [];
  const tap = async (label, before) => {
    await page.evaluate(() => window.__game.forceReady());
    await runFor(page, 0.3);
    if (before) await before();
    const g0 = await page.evaluate(() => window.__game.glintNow());
    await page.evaluate(() => window.__game.tapSplat());
    const s = await page.evaluate(() => window.__game.lastShot());
    await runFor(page, (s?.travel ?? 0.5) + 0.25);
    const r = await page.evaluate(
      ([s, g0]) => {
        const g = window.__game;
        const v = g.camera.position.clone();
        const p = s ? g.pipeline.project(v.set(s.aim[0], s.aim[1], s.aim[2])) : null;
        return {
          glint: g0 ? g0.index : -1,
          target: s?.target?.index ?? -1,
          painted: s?.target ? g.city.paint.level(s.target.index) : null,
          wall: s?.wall ?? false,
          lift: +g.flight.lift.toFixed(0),
          impactScreen: p ? [+(p.x / 393).toFixed(2), +(p.y / 852).toFixed(2)] : null,
        };
      },
      [s, g0],
    );
    r.label = label;
    r.ok = r.glint === r.target && (r.target < 0 || r.painted > 0.5);
    res.push(r);
    console.log('tap', JSON.stringify(r));
  };
  await qa(null);
  await runFor(page, 0.5);
  await tap('floor cruise');
  await runFor(page, 1.8);
  await qa({ sx: 0, sy: 1 });
  await runFor(page, 1.2);
  await tap('floor surge');
  await qa({ sx: 0.6, sy: 0 });
  await runFor(page, 1.8);
  await tap('floor turning, second finger');
  await runFor(page, 1.8);
  await tap('floor turning, lift then tap', async () => {
    await qa(null);
    await runFor(page, 0.25);
  });
  for (const [label, alt] of [['120 m', 120], ['250 m', 250], ['ceiling', 9999]]) {
    await qa({ sx: 0, sy: -1 });
    await until(page, alt > 9000 ? 'g.flight.y > 500 || g.flight.strain > 0.8' : `g.flight.lift >= ${alt}`, 40);
    await qa(null);
    await runFor(page, 1.5);
    await tap(label);
    await runFor(page, 0.4);
  }
  writeFileSync(`${out}/taps.json`, JSON.stringify(res, null, 1));
  console.log(`taps: ${res.filter((r) => r.ok).length}/${res.length} glint == hit (and painted)`);
  await page.close();
}

await browser.close();
