#!/usr/bin/env node
// Altitude QA from the real game (index.html), iPhone 15 portrait viewport.
//   node tools/altitude.mjs <baseUrl> <outDir> <phase> [--noshots]
// phases:
//   downtown | west : climb in steps over a start point (shots at ~30 m, ~120 m,
//                     ~250 m and the ceiling), taps at three altitudes (aim point
//                     vs. the building that blooms + its screen position), perf
//                     at cruise vs. ceiling, then hold -> dive -> floor. Every
//                     0.1 s of game time is logged to <phase>-log.json.
//   opening         : the Golden Gate opening; logs the pass under the deck.
// SwiftShader renders ~1.5 fps: everything waits on the game clock, never wall time.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base = 'http://127.0.0.1:5173/', out = 'shots/altitude', phase = 'downtown'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const noShots = process.argv.includes('--noshots');
mkdirSync(out, { recursive: true });

const STARTS = {
  downtown: '?lat=37.7700&lon=-122.4300&heading=45&skipintro',
  west: '?lat=37.7600&lon=-122.4800&heading=60&skipintro',
  opening: '',
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
await page.goto(base + STARTS[phase], { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });

// in-page helpers: one row per 0.1 s of game time, and a frame loop that runs until a condition
await page.evaluate(() => {
  const g = window.__game;
  window.__alt = {
    rows: [],
    next: 0,
    row() {
      const f = g.flight;
      const c = g.camera.position;
      return {
        t: +g.clock().toFixed(2),
        y: +f.y.toFixed(2),
        vy: +f.vy.toFixed(2),
        speed: +f.speed.toFixed(2),
        floorY: +f.floorY.toFixed(2),
        targetY: +f.targetY.toFixed(2),
        holdY: Number.isFinite(f.holdY) ? +f.holdY.toFixed(2) : null,
        roof: +f.obstacleUnder.toFixed(2),
        clear: +(f.y - f.obstacleUnder).toFixed(2),
        mode: ['floor', 'hold', 'climb', 'dive'][f.mode],
        camDist: +g.rig.distance.toFixed(1),
        camY: +c.y.toFixed(1),
        vista: +g.rig.vista.toFixed(3),
        hfov: +g.rig.hfov.toFixed(2),
        strain: +f.strain.toFixed(3),
        qa: window.__qa ? window.__qa.sy : 0,
      };
    },
    // run frames until cond(g) is true (or maxS of game time); log rows while running
    run(cond, maxS, log) {
      return new Promise((res) => {
        const t0 = g.clock();
        const tick = () => {
          const t = g.clock();
          if (log && t >= this.next) {
            this.rows.push(this.row());
            this.next = t + 0.1 - 1e-6;
          }
          if (t - t0 >= maxS || cond(g)) res(+(t - t0).toFixed(2));
          else requestAnimationFrame(tick);
        };
        tick();
      });
    },
  };
});

const run = (cond, maxS, log = true) => page.evaluate(([c, m, l]) => window.__alt.run(new Function('g', `return (${c})`), m, l), [cond, maxS, log]);
const qa = (v) => page.evaluate((x) => (window.__qa = x), v);
const settle = async (s) => {
  await run('false', s);
  await run('!g.city.busy', 30);
};
const perfNow = async () => {
  // __stats refreshes about once per wall second: sample a few windows
  const samples = [];
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(1300);
    samples.push(await page.evaluate(() => window.__stats));
  }
  const avg = (k) => +(samples.reduce((a, s) => a + s[k], 0) / samples.length).toFixed(2);
  return { workMs: avg('workMs'), workMaxMs: Math.max(...samples.map((s) => s.workMaxMs)), calls: Math.max(...samples.map((s) => s.calls)), triangles: Math.max(...samples.map((s) => s.triangles)) };
};
const shot = async (name) => {
  if (noShots) return;
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', `${out}/${name}.png`);
};
// climb with a full pull, letting go early enough that the coast lands on `alt` (m ASL)
const climbTo = async (alt) => {
  await qa({ sx: 0, sy: -1 });
  const took = await run(`g.flight.y + Math.max(0, g.flight.vy) / (2 * 0.85) >= ${alt} || g.flight.strain > 0.85`, 60);
  await qa(null);
  return took;
};
// a breath from here: log the aim, wait for the impact, report what bloomed and where it sits on screen
const tap = async (label) => {
  await page.evaluate(() => window.__game.forceReady());
  await run('false', 0.15);
  await page.evaluate(() => window.__game.tapSplat());
  const s = await page.evaluate(() => window.__game.lastShot());
  await run('false', (s ? s.travel : 0.5) + 0.6);
  const res = await page.evaluate((shotRec) => {
    const g = window.__game;
    const v = g.camera.position.clone();
    const proj = (x, y, z) => {
      const p = g.pipeline.project(v.set(x, y, z));
      return [+p.x.toFixed(1), +p.y.toFixed(1)];
    };
    const tgt = shotRec && shotRec.target;
    return {
      ...shotRec,
      aimScreen: shotRec ? proj(shotRec.aim[0], shotRec.aim[1], shotRec.aim[2]) : null,
      targetScreen: tgt ? proj(tgt.cx, tgt.roofY, tgt.cz) : null,
      bloomed: tgt ? g.city.paint.level(tgt.index) : null,
      screenCenter: [393 / 2, 852 / 2],
    };
  }, s);
  res.label = label;
  console.log('tap', JSON.stringify(res));
  return res;
};

const report = { phase, start: STARTS[phase], shots: [], taps: [], perf: {}, events: [] };
const mark = async (label) => report.events.push({ label, ...(await page.evaluate(() => window.__alt.row())) });

if (phase === 'opening') {
  // the bus glides under the Golden Gate deck: log until it is well past the bridge
  await run('false', 15);
  const rows = await page.evaluate(() => window.__alt.rows);
  const under = rows.filter((r) => r.y < 57);
  report.minY = Math.min(...rows.map((r) => r.y));
  report.maxY = Math.max(...rows.map((r) => r.y));
  report.rowsUnderDeckAlt = under.length;
  writeFileSync(`${out}/opening-log.json`, JSON.stringify({ report, rows }, null, 1));
  await shot('opening-after');
} else {
  if (phase === 'west') {
    // carve right toward Sutro Tower and Twin Peaks (they sit east-southeast of the start)
    await qa({ sx: 0.7, sy: 0 });
    await run('((g.flight.heading * 180 / Math.PI) % 360 + 360) % 360 > 92', 8);
    await qa(null);
  }
  await settle(2.5);
  await mark('cruise');
  await shot(`${phase}-030m`);
  report.perf.cruise = await perfNow();
  console.log('perf cruise', JSON.stringify(report.perf.cruise));
  report.taps.push(await tap('cruise'));

  await climbTo(120);
  await settle(3);
  await mark('120m');
  await shot(`${phase}-120m`);
  report.taps.push(await tap('120m'));

  await climbTo(250);
  await settle(3.5);
  await mark('250m');
  await shot(`${phase}-250m`);
  report.taps.push(await tap('250m'));

  await climbTo(560);
  await settle(4);
  await mark('ceiling');
  await shot(`${phase}-ceiling`);
  report.perf.ceiling = await perfNow();
  console.log('perf ceiling', JSON.stringify(report.perf.ceiling));
  report.taps.push(await tap('ceiling'));

  // hold, then nose down all the way to the rooftops, then let go
  await run('false', 3);
  await mark('hold');
  await qa({ sx: 0, sy: 1 });
  await run('g.flight.mode === 0', 40);
  await mark('floor reached');
  await run('false', 1.5);
  await qa(null);
  await run('false', 4);
  await mark('floor cruise');
  await shot(`${phase}-after-dive`);
  const rows = await page.evaluate(() => window.__alt.rows);
  report.minClearance = Math.min(...rows.map((r) => r.clear));
  report.maxY = Math.max(...rows.map((r) => r.y));
  writeFileSync(`${out}/${phase}-log.json`, JSON.stringify({ report, rows }, null, 1));
}
writeFileSync(`${out}/${phase}-report.json`, JSON.stringify(report, null, 2));
console.log('report', JSON.stringify({ perf: report.perf, minClearance: report.minClearance, maxY: report.maxY, events: report.events.map((e) => [e.label, e.y, e.camDist, e.vista]) }));
await browser.close();
