#!/usr/bin/env node
// Frame-level look QA from the real game (index.html), iPhone 15 portrait viewport.
//   node tools/look.mjs <baseUrl> <outDir> [scene ...] [--tune='{"camera.elevationCruise":24}'] [--seq]
// Every scene runs on a fixed 1/30 s game step (?fixeddt) and captures with
// __qa.holdAt, so two builds shoot the same frames (A/B). Scenes:
//   ladies    Alamo Square at the Painted Ladies row: cruise, slow drift, surge
//   dolores   Dolores Park toward downtown, cruise (trees in the foreground)
//   twinpeaks Twin Peaks toward downtown, cruise (the skyline vista)
//   fidi      a surge north through SoMa into FiDi
//   alt120    a climb to 120 m above the ground over the Painted Ladies, held
//   opening   the Golden Gate opening at 2 s and 8 s
//   sign      a real tap at the Painted Ladies: impact +0.15 / +0.6 / +1.4 / +3 s;
//             then the same block escalated to level 3 (+1.4 / +3 s)
//   eye       the headlight: full belly, squinting mid-breath (+0.3 s), wide on the relief (+1.3 s)
//   perf      renderer cost per frame (exact draw calls / triangles of the frame, CPU work of the last
//             frames) at the Painted Ladies cruise, a FiDi surge and 250 m up (perf.json)
// --seq adds frame pairs exactly 1/30 s apart (<scene>-seq-0/1.png) at ladies
// cruise, dolores cruise and alt120 for shimmer counts (tools/lookstat.py).
// --tune sets the tuning panel's saved overrides (sb.tuning.v1 config paths)
// before load: try numbers without a rebuild.
// SwiftShader renders ~1.5 fps: everything waits on the game clock, never wall time.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base = 'http://127.0.0.1:4741/', out = 'shots/look', ...sceneArgs] = pos;
const scenes = new Set(sceneArgs.length ? sceneArgs : ['ladies', 'dolores', 'twinpeaks', 'fidi', 'alt120', 'opening', 'sign']);
const withSeq = !!opt.seq;
const tune = opt.tune ? JSON.parse(opt.tune) : null;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const report = {};
const DT = 1 / 30;

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  await page.addInitScript((t) => {
    try {
      localStorage.clear();
      if (t) localStorage.setItem('sb.tuning.v1', JSON.stringify({ config: t, groups: {} }));
    } catch {}
  }, tune);
  await page.goto(base + query + `&fixeddt=${DT}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 400000 });
  return page;
}
const clock = (page) => page.evaluate(() => window.__game.clock());
const qa = (page, v) => page.evaluate((x) => (window.__qa = x), v);
/** Run until game time `at`, then freeze there (the canvas keeps the frame). */
async function holdAt(page, at) {
  await page.evaluate((t) => {
    const q = (window.__qa = window.__qa ?? {});
    q.held = false;
    q.holdAt = t;
  }, at);
  await page.waitForFunction(() => window.__qa && window.__qa.held === true, null, { timeout: 600000, polling: 200 });
}
const release = (page) => page.evaluate(() => { if (window.__qa) { window.__qa.holdAt = undefined; window.__qa.held = false; } });
async function shot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  const info = await page.evaluate(() => {
    const g = window.__game, f = g.flight, c = g.camera.position;
    // (the held frame's exact draw calls / triangles; __stats is a one-second window)
    return { t: +g.clock().toFixed(3), bus: [+f.x.toFixed(1), +f.y.toFixed(1), +f.z.toFixed(1)], speed: +f.speed.toFixed(1), cam: [+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)], vista: +g.rig.vista.toFixed(3), calls: g.perf.calls, tris: g.perf.tris, stats: window.__stats ?? null };
  });
  report[name] = info;
  console.log('shot', name, JSON.stringify(info));
}
/** Two frames exactly one game step apart, starting at the frame held now. */
async function pair(page, name) {
  if (!withSeq) return;
  await shot(page, `${name}-seq-0`);
  const t = await clock(page);
  await holdAt(page, t + DT * 0.5);
  await shot(page, `${name}-seq-1`);
}
/** Keep the stick where it is and run `s` seconds of game time from now, then hold. */
async function runHold(page, s) {
  const t = await clock(page);
  await holdAt(page, t + s);
}
/** A slow drift at the rooftops (glide speed, no stick), as tools/shots.mjs. */
const drift = (page, v) => page.evaluate((x) => { window.__qa = { holdAt: window.__qa?.holdAt }; window.__game.flight.glideSpeed = x; }, v);
const stick = (page, sx, sy) => page.evaluate(([a, b]) => { const q = (window.__qa = window.__qa ?? {}); q.sx = a; q.sy = b; }, [sx, sy]);
const noStick = (page) => page.evaluate(() => { const q = window.__qa; if (q) { delete q.sx; delete q.sy; } });

if (scenes.has('ladies')) {
  const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro');
  await noStick(page);
  await runHold(page, 3); // released: cruise
  await shot(page, 'ladies-cruise');
  await pair(page, 'ladies');
  await release(page);
  await drift(page, 6);
  await runHold(page, 3.5);
  await shot(page, 'ladies-slow');
  await release(page);
  await stick(page, 0, 1);
  await runHold(page, 2.5);
  await shot(page, 'ladies-surge');
  await page.close();
}

if (scenes.has('dolores')) {
  const page = await open('?lat=37.7552&lon=-122.4284&heading=20&skipintro');
  await noStick(page);
  await runHold(page, 3);
  await shot(page, 'dolores-cruise');
  await pair(page, 'dolores');
  await page.close();
}

if (scenes.has('twinpeaks')) {
  const page = await open('?lat=37.7505&lon=-122.4490&heading=45&skipintro');
  await noStick(page);
  await runHold(page, 3);
  await shot(page, 'twinpeaks-cruise');
  await page.close();
}

if (scenes.has('fidi')) {
  const page = await open('?lat=37.7790&lon=-122.4005&heading=0&skipintro');
  await stick(page, 0, 1);
  await runHold(page, 2.5);
  await shot(page, 'fidi-surge');
  await page.close();
}

if (scenes.has('alt120')) {
  const page = await open('?lat=37.77628&lon=-122.4370&heading=88&skipintro');
  await stick(page, 0, -1);
  // climb, letting go early enough that the coast lands at 120 m above the broad ground
  await page.evaluate(() => {
    const q = window.__qa;
    const g = window.__game;
    const tick = () => {
      const f = g.flight;
      if (f.height + Math.max(0, f.vy) / (2 * 0.85) >= 120 || g.clock() > 40) { delete q.sx; delete q.sy; return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
  await page.waitForFunction(() => window.__qa.sy === undefined, null, { timeout: 600000, polling: 300 });
  await runHold(page, 3.5);
  await shot(page, 'alt120');
  await pair(page, 'alt120');
  await page.close();
}

if (scenes.has('opening')) {
  const page = await open('?openingshot');
  await noStick(page);
  await holdAt(page, 2);
  await shot(page, 'opening-2s');
  await release(page);
  await holdAt(page, 8);
  await shot(page, 'opening-8s');
  await page.close();
}

if (scenes.has('sign')) {
  // a real tap in cruise over Alamo Square, heading east at the Painted Ladies row (as blast.mjs tap)
  const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro');
  await noStick(page);
  await runHold(page, 1.5);
  await release(page);
  const tImpact = await page.evaluate(() => {
    const g = window.__game;
    g.forceReady();
    g.tapSplat();
    return g.clock() + 0.42;
  });
  for (const m of [0.15, 0.6, 1.4, 3.0]) {
    await holdAt(page, tImpact + m);
    await shot(page, `sign-L1-${m.toFixed(2)}`);
    await release(page);
  }
  await page.close();
  // escalation to level 3: a slow drift and three barfs on the same row (as shots.mjs painted)
  const p2 = await open('?lat=37.77615&lon=-122.4340&heading=88&skipintro');
  await drift(p2, 6);
  await runHold(p2, 1);
  for (let k = 1; k <= 3; k++) {
    await release(p2);
    const t = await p2.evaluate(() => window.__game.barfAtLatLon(37.7762, -122.43262));
    for (const m of k === 3 ? [0.6, 1.4, 3.0] : [1.2]) {
      await holdAt(p2, t + m);
      if (k === 3) await shot(p2, `sign-L3-${m.toFixed(2)}`);
      await release(p2);
    }
  }
  await p2.close();
}

if (scenes.has('perf')) {
  const sample = async (page, label) => {
    const rows = [];
    for (let i = 0; i < 8; i++) {
      const t = await clock(page);
      await holdAt(page, t + DT * 2.5);
      rows.push(await page.evaluate(() => {
        const p = window.__game.perf;
        const ring = p.workRing, n = ring.length;
        return { calls: p.calls, tris: p.tris, work: ring[(p.ringI - 1 + n) % n] };
      }));
      await release(page);
    }
    const med = (k) => { const v = rows.map((r) => r[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const res = { calls: med('calls'), tris: med('tris'), workMs: +med('work').toFixed(2), workMin: +Math.min(...rows.map((r) => r.work)).toFixed(2) };
    perfOut[label] = res;
    console.log('perf', label, JSON.stringify(res));
  };
  const perfOut = {};
  let page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro');
  await noStick(page);
  await runHold(page, 3);
  await release(page);
  await sample(page, 'ladies-cruise');
  await page.close();
  page = await open('?lat=37.7790&lon=-122.4005&heading=0&skipintro');
  await stick(page, 0, 1);
  await runHold(page, 2.5);
  await release(page);
  await sample(page, 'fidi-surge');
  await page.close();
  page = await open('?lat=37.7700&lon=-122.4300&heading=45&skipintro');
  await stick(page, 0, -1);
  await page.evaluate(() => {
    const q = window.__qa, g = window.__game;
    const tick = () => { const f = g.flight; if (f.height + Math.max(0, f.vy) / 1.7 >= 250 || g.clock() > 50) { delete q.sx; delete q.sy; return; } requestAnimationFrame(tick); };
    tick();
  });
  await page.waitForFunction(() => window.__qa.sy === undefined, null, { timeout: 600000, polling: 300 });
  await runHold(page, 3.5);
  await release(page);
  await sample(page, 'climb-250m');
  await page.close();
  writeFileSync(`${out}/perf.json`, JSON.stringify(perfOut, null, 1));
}

if (scenes.has('eye')) {
  const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro');
  await noStick(page);
  await runHold(page, 2);
  await shot(page, 'eye-full');
  await release(page);
  const t = await page.evaluate(() => { const g = window.__game; g.forceReady(); g.tapSplat(); return g.clock(); });
  await holdAt(page, t + 0.3);
  await shot(page, 'eye-barf');
  await release(page);
  await holdAt(page, t + 1.3);
  await shot(page, 'eye-relief');
  await page.close();
}

// (merged into an existing look.json, so scenes shot in separate runs keep their numbers)
let prev = {};
try { prev = JSON.parse(readFileSync(`${out}/look.json`, 'utf8')); } catch {}
writeFileSync(`${out}/look.json`, JSON.stringify({ ...prev, ...report }, null, 1));
await browser.close();
console.log('saved to', out);
