#!/usr/bin/env node
// Real frame rate on this machine's GPU (the ?fps meter's own numbers), iPhone 15
// portrait viewport, at street level and up high.
//   node tools/fps.mjs <baseUrl> <outDir> [--seconds=10] [--spots=alamo,fidi]
// For every spot: cruise released at the rooftops, then climb to ~250 m and to the
// ceiling (~500 m) and hold. Each phase samples window.__stats (refreshed once per
// wall second by src/ui/Perf.ts) for --seconds wall seconds after streaming settles,
// screenshots the frame with the meter, and writes <outDir>/fps.json.
// Wall-clock fps only means something on a real GPU: run it here, not in the cloud.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base = 'http://127.0.0.1:4173/', out = 'shots/local/fps'] = pos;
const seconds = Number(opt.seconds ?? 10);
const SPOTS = {
  alamo: '?lat=37.77628&lon=-122.4352&heading=88&skipintro&fps',
  fidi: '?lat=37.7925&lon=-122.4010&heading=0&skipintro&fps',
  west: '?lat=37.7600&lon=-122.4800&heading=60&skipintro&fps',
};
const spots = (opt.spots ?? 'alamo,fidi').split(',');
mkdirSync(out, { recursive: true });

const launch = browserOptions([]);
const browser = await chromium.launch(launch);
const report = { base, headless: launch.headless, channel: launch.channel ?? launch.executablePath, seconds, spots: {} };

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const r1 = (v) => Math.round(v * 10) / 10;

for (const spot of spots) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  await page.goto(base + SPOTS[spot], { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  if (!report.gpu) {
    report.gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : 'no webgl2';
    });
    console.log('gpu', report.gpu);
  }
  // run frames until cond(g) holds or maxS of game time passed
  const run = (cond, maxS) =>
    page.evaluate(
      ([c, m]) =>
        new Promise((res) => {
          const g = window.__game;
          const f = new Function('g', `return (${c})`);
          const t0 = g.clock();
          const tick = () => (g.clock() - t0 >= m || f(g) ? res(+(g.clock() - t0).toFixed(2)) : requestAnimationFrame(tick));
          tick();
        }),
      [cond, maxS],
    );
  const qa = (v) => page.evaluate((x) => (window.__qa = x), v);
  const settle = async () => {
    await run('false', 2);
    await run('!g.city.busy', 30);
    await run('false', 1);
  };
  // climb with a full pull, letting go so the coast lands on `alt` (m ASL)
  const climbTo = async (alt) => {
    await qa({ sx: 0, sy: -1 });
    await run(`g.flight.y + Math.max(0, g.flight.vy) / (2 * 0.85) >= ${alt} || g.flight.strain > 0.85`, 90);
    await qa(null);
  };
  const sample = async (phase) => {
    await settle();
    const rows = [];
    // __stats is a 1 s window: skip the one in progress, then take `seconds` fresh ones
    let last = await page.evaluate(() => window.__stats?.frames ?? -1);
    while (rows.length < seconds) {
      await page.waitForTimeout(250);
      const s = await page.evaluate(() => window.__stats);
      if (s && s.frames !== last) {
        last = s.frames;
        rows.push(s);
      }
    }
    const pos = await page.evaluate(() => {
      const g = window.__game;
      return { y: +g.flight.y.toFixed(1), height: +g.flight.height.toFixed(1), speed: +g.flight.speed.toFixed(1), vista: +g.rig.vista.toFixed(2) };
    });
    const fps = rows.map((r) => r.fps);
    const res = {
      ...pos,
      fpsMedian: r1(med(fps)),
      fpsMin: r1(Math.min(...fps)),
      fpsMax: r1(Math.max(...fps)),
      low1Median: r1(med(rows.map((r) => r.low1))),
      frameMsMedian: r1(med(rows.map((r) => r.frameMs))),
      frameMaxMs: r1(Math.max(...rows.map((r) => r.frameMaxMs))),
      workMsMedian: r1(med(rows.map((r) => r.workMs))),
      workMaxMs: r1(Math.max(...rows.map((r) => r.workMaxMs))),
      calls: med(rows.map((r) => r.calls)),
      triangles: med(rows.map((r) => r.triangles)),
      lowRes: rows[rows.length - 1].lowRes,
      canvas: rows[rows.length - 1].canvas,
      cap30: rows.some((r) => r.cap30),
      perSecondFps: fps.map(r1),
    };
    await page.screenshot({ path: `${out}/${spot}-${phase}.png` });
    console.log(spot, phase, JSON.stringify(res));
    return res;
  };

  const r = {};
  r.street = await sample('street');
  await climbTo(250);
  r.alt250 = await sample('alt250');
  await climbTo(500);
  r.ceiling = await sample('ceiling');
  report.spots[spot] = r;
  await page.close();
}

writeFileSync(`${out}/fps.json`, JSON.stringify(report, null, 2));
console.log('wrote', `${out}/fps.json`);
await browser.close();
