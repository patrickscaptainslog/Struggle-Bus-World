#!/usr/bin/env node
// The jet's frame pacing, attributed: real time on this machine's GPU, nothing else running in the
// page (no screenshots during the trace: a 3x page.screenshot is itself a long frame).
//   node tools/jet.mjs <baseUrl> <outDir> [--seconds=9] [--routes=east,west,north,south] [--shots=1]
// Every route: settle at the street, shift to G1, wait for the engagement, then trace --seconds of
// jet over the city. Each frame records the rAF gap, the frame's CPU, and the time inside the
// streaming work (city.update and what it calls, the mesh uploads inside the renderer's first draw).
// --shots=1 also captures the screenshots of the judge's trace (every 380 ms), to see what they cost.
// Writes <outDir>/jet.json; prints p50/p95/p99/max, frames > 34 ms, and the worst frames' breakdown.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base = 'http://127.0.0.1:4175/', out = 'shots/local/jet'] = pos;
const seconds = Number(opt.seconds ?? 9);
const ROUTES = {
  gate: '?lat=37.8050&lon=-122.4650&heading=135',
  east: '?lat=37.77628&lon=-122.4352&heading=88',
  west: '?lat=37.7800&lon=-122.4100&heading=268',
  north: '?lat=37.7300&lon=-122.4300&heading=8',
  south: '?lat=37.7990&lon=-122.4200&heading=185',
};
const routes = (opt.routes ?? 'east').split(',');
mkdirSync(out, { recursive: true });

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { base, seconds, routes: {} };

for (const route of routes) {
  const browser = await chromium.launch(browserOptions([]));
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
  await page.addInitScript(() => {
    if (window.DeviceOrientationEvent) window.DeviceOrientationEvent.requestPermission = undefined;
  });
  await page.goto(base + ROUTES[route] + '&skipintro&nohud&fps', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 400000 });
  await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 60000 });
  await sleep(1500);

  // wrap the streaming work: every call's time lands in this frame's row
  await page.evaluate(() => {
    const g = window.__game;
    const P = (window.__prof = { cur: {}, n: {} });
    const wrap = (o, name, label = name) => {
      const fn = o[name];
      if (typeof fn !== 'function') return;
      o[name] = function (...a) {
        const t = performance.now();
        const r = fn.apply(this, a);
        P.cur[label] = (P.cur[label] ?? 0) + performance.now() - t;
        P.n[label] = (P.n[label] ?? 0) + 1;
        return r;
      };
    };
    const c = g.city;
    for (const m of ['update', 'addTile', 'buildRegionMesh', 'buildRegionGround', 'swapRegion', 'unloadRegion', 'makeBuildingMesh', 'makeTileTerrain', 'cullBuried', 'onRegion', 'stampProp', 'prepTile', 'meshTops', 'growTo', 'disposeRegionMesh', 'dropTileTerrain']) wrap(c, m);
    wrap(c, 'onTile');
    wrap(g.pipeline, 'render');
    wrap(g.controls, 'frame', 'controls.frame');
  });

  // the trace starts at the shift: the climb is when the view's height swaps regions' level of detail
  await page.evaluate(() => window.__game.input.onTurbo(1));

  const trace = page.evaluate(
    (secs) =>
      new Promise((res) => {
        const g = window.__game;
        const P = window.__prof;
        const rows = [];
        const longs = [];
        const po = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) longs.push([Math.round(e.startTime - window.__t0), Math.round(e.duration)]);
        });
        try {
          po.observe({ entryTypes: ['longtask'] });
        } catch {
          /* no longtask here */
        }
        const t0 = performance.now();
        window.__t0 = t0;
        let last = t0;
        const tick = (now) => {
          const s = g.perf.snapshot();
          rows.push({ t: Math.round(now - t0), dt: +(now - last).toFixed(1), speed: Math.round(g.flight.speed), y: Math.round(g.flight.y), x: Math.round(g.flight.x), z: Math.round(g.flight.z), calls: s.calls, tris: s.triangles, adopt: g.city.adopt.length, pending: g.city.pending.size, prof: P.cur });
          P.cur = {};
          last = now;
          if (now - t0 < secs * 1000) requestAnimationFrame(tick);
          else {
            po.disconnect();
            res({ rows, longs, n: P.n });
          }
        };
        requestAnimationFrame(tick);
      }),
    seconds + 5,
  );
  if (opt.shots) {
    await sleep(3000); // (the judge's frames start around the engagement)
    for (let i = 0; i < 16; i++) {
      await page.screenshot({ path: `${out}/${route}-${String(i).padStart(2, '0')}.png` });
      await sleep(380);
    }
  }
  const { rows: all, longs, n } = await trace;
  // rows of the climb + spool, then the jet proper (the judge's 9 s window: speed > 400)
  const jetAt = all.findIndex((r) => r.speed > 400);
  const climbRows = all.slice(0, Math.max(0, jetAt));
  const rows = all.slice(Math.max(0, jetAt));
  const end = await page.evaluate(() => ({ gear: window.__game.controls.turbo.gear, speed: window.__game.flight.speed, edge: window.__game.controls.turbo.edge }));
  // the brake, and the seconds after it: what the hold deferred comes due here
  const brake = await page.evaluate(
    (secs) =>
      new Promise((res) => {
        const g = window.__game;
        const P = window.__prof;
        P.cur = {};
        g.input.onTurbo(-1);
        const rows = [];
        const t0 = performance.now();
        let last = t0;
        const tick = (now) => {
          rows.push({ t: Math.round(now - t0), dt: +(now - last).toFixed(1), speed: Math.round(g.flight.speed), adopt: g.city.adopt.length, prof: P.cur });
          P.cur = {};
          last = now;
          if (now - t0 < secs * 1000) requestAnimationFrame(tick);
          else res(rows);
        };
        requestAnimationFrame(tick);
      }),
    12,
  );
  await page.screenshot({ path: `${out}/${route}-end.png` });

  const d = rows.slice(2).map((r) => r.dt);
  const cd = climbRows.slice(2).map((r) => r.dt);
  const summary = {
    climb: cd.length ? { frames: cd.length, p99: pct(cd, 0.99), max: Math.max(...cd), over34: cd.filter((x) => x > 34).length } : null,
    frames: d.length,
    fps: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1),
    p50: pct(d, 0.5),
    p95: pct(d, 0.95),
    p99: pct(d, 0.99),
    max: Math.max(...d),
    over34: d.filter((x) => x > 34).length,
    over20: d.filter((x) => x > 20).length,
    calls: Math.max(...rows.map((r) => r.calls || 0)),
    tris: Math.max(...rows.map((r) => r.tris || 0)),
    speed: [Math.min(...rows.map((r) => r.speed)), Math.max(...rows.map((r) => r.speed))],
    end,
    errors,
  };
  // the landing: the detail is back around the bus, nothing left queued
  summary.landed = await page.evaluate(() => {
    const c = window.__game.city;
    return { busy: c.busy, detail: [...c.regionLod.values()].filter((l) => l === 0).length, coarse: [...c.regionLod.values()].filter((l) => l === 1).length, hold: c.detailHold };
  });
  await page.screenshot({ path: `${out}/${route}-landed.png` });
  const bd = brake.slice(2).map((r) => r.dt);
  summary.brake = { frames: bd.length, p99: pct(bd, 0.99), max: Math.max(...bd), over34: bd.filter((x) => x > 34).length, over20: bd.filter((x) => x > 20).length, swaps: brake.filter((r) => r.prof.swapRegion).length };
  report.routes[route] = { summary, calls: n, longs, rows: all, brake };
  console.log(route, JSON.stringify(summary));
  // the frame after a hitch: the gap belongs to the frame that ran just before this rAF
  const worst = all
    .map((r, i) => ({ r, prev: all[i - 1] }))
    .filter((x) => x.r.dt > 22 && x.prev)
    .slice(0, 24);
  for (const { r, prev } of worst) {
    const p = Object.entries(prev.prof)
      .filter(([, v]) => v > 0.5)
      .map(([k, v]) => `${k} ${v.toFixed(1)}`)
      .join(', ');
    console.log(`  t=${r.t} ${r.speed} m/s gap ${r.dt} ms  adopt ${prev.adopt}  pend ${prev.pending}  ${p}`);
  }
  console.log('  long tasks', JSON.stringify(longs.slice(0, 24)));
  await browser.close();
}
writeFileSync(`${out}/jet.json`, JSON.stringify(report));
