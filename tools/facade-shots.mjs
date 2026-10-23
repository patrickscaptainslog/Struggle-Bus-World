#!/usr/bin/env node
// Tower facade QA from the real game (index.html), iPhone 15 portrait viewport.
//   node tools/facade-shots.mjs <baseUrl> <outDir> [--only=a,b] [--seq] [--paint] [--perf]
// chase-<name>.png : the gameplay chase camera over a downtown district.
// hero-<name>.png  : a fixed telephoto view of one icon (the rig is overridden for the
//                    shot only), so two builds' shots line up exactly. All hero views
//                    share one page (the bus teleports between them).
// alt-<name>.png   : the vista camera after a real yoke climb (~250 m) over downtown.
// --seq            : chase and alt views also capture frames exactly 1/30 s apart
//                    (<view>-seq-<i>.png; python3 -I tools/seqstat.py <out>/<view>-seq 3).
//                    Hero views drift the camera sideways at 20 m/s for their sequence.
// --paint          : painted-tower sequence on the hero views (paint-<name>-L1/L2/L3.png):
//                    barf on the tower through the real splat pipeline three times.
// --only=ladies    : the Painted Ladies row (shots.mjs' painted camera), one blast per
//                    level: ladies-L1/L2/L3.png (the calm Painted Ladies, then the riot).
// --perf           : renderer stats per view (draw calls, triangles, CPU workMs), the median of
//                    8 frames; perf.json (without --perf: 2 frames).
// SwiftShader renders ~1.5 fps: everything waits on the game clock, never wall time.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const base = pos[0] ?? 'http://127.0.0.1:4711/';
const out = pos[1] ?? 'shots/facade';
const only = opt.only ? new Set(opt.only.split(',')) : null;
const want = (n) => !only || only.has(n);
mkdirSync(out, { recursive: true });

const CHASE = [
  { name: 'fidi', lat: 37.7925, lon: -122.401, heading: 0 },
  { name: 'soma', lat: 37.782, lon: -122.399, heading: 330 },
  { name: 'rincon', lat: 37.788, lon: -122.39, heading: 300 },
  { name: 'embarcadero', lat: 37.7915, lon: -122.3985, heading: 20 },
  // the grey regression view (tools/shots.mjs): houses, not towers
  { name: 'alamo', lat: 37.77628, lon: -122.4352, heading: 88 },
];
// target (lat/lon, look height above its ground), camera azimuth from the target (deg, compass), distance, camera height (m ASL)
const HERO = [
  { name: 'salesforce', lat: 37.78977, lon: -122.39676, look: 150, az: 200, dist: 760, camY: 210 },
  { name: '181fremont', lat: 37.7897, lon: -122.3952, look: 110, az: 125, dist: 620, camY: 170 },
  { name: '555california', lat: 37.7921, lon: -122.4037, look: 110, az: 215, dist: 620, camY: 170 },
  { name: 'embarcadero', lat: 37.7952, lon: -122.3972, look: 70, az: 25, dist: 620, camY: 140 },
  { name: 'millennium', lat: 37.79048, lon: -122.39596, look: 100, az: 160, dist: 650, camY: 160 },
  { name: 'transamerica', lat: 37.79518, lon: -122.40278, look: 110, az: 115, dist: 700, camY: 170 },
  { name: 'coit', lat: 37.80235, lon: -122.40582, look: 120, az: 150, dist: 520, camY: 190 },
  { name: 'ferry', lat: 37.7955, lon: -122.3935, look: 30, az: 150, dist: 420, camY: 85 },
  { name: 'skyline', lat: 37.7905, lon: -122.3975, look: 110, az: 225, dist: 1500, camY: 420 },
  { name: 'rinconhill', lat: 37.7865, lon: -122.3925, look: 100, az: 250, dist: 950, camY: 340 },
  { name: 'fidinorth', lat: 37.7935, lon: -122.4, look: 100, az: 335, dist: 1150, camY: 360 },
  { name: 'fidiclose', lat: 37.7915, lon: -122.4005, look: 60, az: 200, dist: 330, camY: 120 },
];
const ALT = [{ name: 'downtown250', lat: 37.7835, lon: -122.4085, heading: 45, y: 250 }];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const perf = {};

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  // a controllable rAF (as tools/altitude.mjs): hold the game, then advance it one fixed step per frame
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    let fake = null, lastT = -1, allowedT = -1;
    window.__rv = { step: 0, hold: false, advance: 0, q: [] };
    window.__rvFlush = () => { const R = window.__rv; const q = R.q; R.q = []; for (const f of q) raf(f); };
    window.requestAnimationFrame = (cb) => {
      const runF = (t) => {
        const R = window.__rv;
        if (R.hold && t !== allowedT) {
          if (R.advance > 0) { R.advance--; allowedT = t; } else { R.q.push(runF); return; }
        }
        if (R.step > 0) { if (t !== lastT) fake = (fake ?? t) + R.step; lastT = t; cb(fake); } else { fake = null; lastT = t; cb(t); }
      };
      return raf(runF);
    };
  });
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  return page;
}

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

async function settle(page) {
  await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 300000 });
  await runFor(page, 1.2);
  await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 300000 });
  await runFor(page, 1.0);
}

// renderer stats per frame (draw calls, triangles, CPU workMs): a hook on perf.frame() reads
// renderer.info before the meter resets it (window.__stats only refreshes on frames < 1 s apart,
// which SwiftShader at ~1 fps often misses); the median of the last frames
const snap = async (page) => {
  await page.evaluate(() => {
    const g = window.__game;
    if (g.__statsHook) return;
    g.__statsHook = true;
    window.__fstats = [];
    const orig = g.perf.frame.bind(g.perf);
    g.perf.frame = (dt, work) => {
      const r = g.pipeline.renderer.info.render;
      window.__fstats.push({ calls: r.calls, triangles: r.triangles, workMs: work });
      if (window.__fstats.length > 24) window.__fstats.shift();
      orig(dt, work);
    };
  });
  const n = opt.perf ? 8 : 2;
  await page.evaluate((n) => { window.__fstats.length = 0; return new Promise((res) => { const tick = () => (window.__fstats.length >= n ? res(null) : requestAnimationFrame(tick)); tick(); }); }, n);
  const rows = await page.evaluate(() => window.__fstats.slice());
  const med = (k) => [...rows].map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  return { calls: med('calls'), triangles: med('triangles'), workMs: +med('workMs').toFixed(2), workMaxMs: +Math.max(...rows.map((r) => r.workMs)).toFixed(2), frames: rows.length };
};

// n+1 consecutive frames exactly 1/30 s apart (--seqn=<n>, default 3)
async function seq(page, name, n = Number(opt.seqn ?? 3)) {
  const wait = () => page.waitForFunction(() => window.__rv.advance <= 0 && window.__rv.q.length > 0, null, { timeout: 120000, polling: 100 });
  await page.evaluate(() => Object.assign(window.__rv, { step: 1000 / 30, hold: true, advance: 3 }));
  await wait();
  for (let i = 0; i <= n; i++) {
    if (i > 0) {
      await page.evaluate(() => { window.__rv.advance = 1; window.__rvFlush(); });
      await wait();
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${name}-seq-${i}.png` });
  }
  await page.evaluate(() => { Object.assign(window.__rv, { step: 0, hold: false, advance: 0 }); window.__rvFlush(); });
}

// ---- chase views
for (const v of CHASE) {
  if (!want(`chase-${v.name}`) && !want('chase')) continue;
  const page = await open(`?lat=${v.lat}&lon=${v.lon}&heading=${v.heading}&skipintro`);
  await page.evaluate(() => (window.__qa = { sx: 0, sy: -0.15 }));
  await runFor(page, 2.0);
  await settle(page);
  await page.screenshot({ path: `${out}/chase-${v.name}.png` });
  perf[`chase-${v.name}`] = await snap(page);
  console.log('saved', `${out}/chase-${v.name}.png`, JSON.stringify(perf[`chase-${v.name}`]));
  if (opt.seq) await seq(page, `chase-${v.name}`);
  await page.close();
}

// ---- the vista after a real climb
for (const v of ALT) {
  if (!want(`alt-${v.name}`) && !want('alt')) continue;
  const page = await open(`?lat=${v.lat}&lon=${v.lon}&heading=${v.heading}&skipintro`);
  await page.evaluate(() => (window.__qa = { sx: 0, sy: -1 }));
  await page.evaluate((y) => new Promise((res) => { const tick = () => (window.__game.flight.y >= y ? res(null) : requestAnimationFrame(tick)); tick(); }), v.y);
  await page.evaluate(() => (window.__qa = null));
  await runFor(page, 3.0);
  await settle(page);
  await page.screenshot({ path: `${out}/alt-${v.name}.png` });
  perf[`alt-${v.name}`] = await snap(page);
  console.log('saved', `${out}/alt-${v.name}.png`, JSON.stringify(perf[`alt-${v.name}`]));
  if (opt.seq) await seq(page, `alt-${v.name}`);
  await page.close();
}

// ---- hero views: one page, the bus teleports
const heroes = HERO.filter((v) => want(`hero-${v.name}`) || want('hero'));
if (heroes.length) {
  const page = await open(`?lat=${heroes[0].lat}&lon=${heroes[0].lon}&heading=0&skipintro`);
  for (const v of heroes) {
    await page.evaluate((v) => {
      const g = window.__game;
      const [lat0, lon0] = g.city.manifest.origin;
      const tx = (v.lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
      const tz = -(v.lat - lat0) * 110574;
      const ty = g.city.groundAt(tx, tz) + v.look;
      const a = (v.az * Math.PI) / 180;
      const cx = tx + Math.sin(a) * v.dist, cz = tz - Math.cos(a) * v.dist;
      g.flight.x = tx + Math.sin(a) * (v.dist + 60);
      g.flight.z = tz - Math.cos(a) * (v.dist + 60);
      window.__qa = { sx: 0, sy: -1 };
      // the drift (for the sequence) slides the camera sideways, keeping its aim direction
      window.__drift = 0;
      const rx = Math.cos(a), rz = Math.sin(a);
      g.rig.update = (cam, focusOut) => {
        const d = window.__drift * (g.clock() - window.__drift0);
        cam.position.set(cx + rx * d, v.camY, cz + rz * d);
        cam.up.set(0, 1, 0);
        cam.lookAt(tx + rx * d, ty, tz + rz * d);
        focusOut.set(tx + rx * d, ty, tz + rz * d);
      };
      window.__drift0 = g.clock();
    }, v);
    await runFor(page, 1.5);
    await settle(page);
    await page.screenshot({ path: `${out}/hero-${v.name}.png` });
    perf[`hero-${v.name}`] = await snap(page);
    console.log('saved', `${out}/hero-${v.name}.png`, JSON.stringify(perf[`hero-${v.name}`]));
    if (opt.seq) {
      await page.evaluate(() => { window.__drift = 20; window.__drift0 = window.__game.clock(); });
      await seq(page, `hero-${v.name}`);
      await page.evaluate(() => { window.__drift = 0; });
    }
    if (opt.paint) {
      for (const L of [1, 2, 3]) {
        await page.evaluate((v) => window.__game.barfAtLatLon(v.lat, v.lon), v);
        await runFor(page, L === 1 ? 7.5 : 4.5);
        await page.screenshot({ path: `${out}/paint-${v.name}-L${L}.png` });
        console.log('saved', `${out}/paint-${v.name}-L${L}.png`);
      }
    }
  }
  await page.close();
}

// ---- the Painted Ladies row (tools/shots.mjs' painted camera): one blast per level, L1 / L2 / L3
if (want('ladies')) {
  const page = await open('?lat=37.77615&lon=-122.4340&heading=88&skipintro');
  await page.evaluate(() => ((window.__qa = null), (window.__game.flight.glideSpeed = 6)));
  await runFor(page, 2);
  for (const L of [1, 2, 3]) {
    await page.evaluate(() => window.__game.barfAtLatLon(37.7762, -122.43262));
    await runFor(page, 3.2);
    await page.screenshot({ path: `${out}/ladies-L${L}.png` });
    console.log('saved', `${out}/ladies-L${L}.png`);
  }
  await page.close();
}

writeFileSync(`${out}/perf.json`, JSON.stringify(perf, null, 2));
await browser.close();
