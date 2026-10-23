#!/usr/bin/env node
// Paintable-landmark QA in the real game (index.html, iPhone portrait viewport).
//   node tools/landmarks.mjs <baseUrl> <outDir> [probe] [seq] [altitude] [sutro] [reload] [near] [perf]
//
//   probe     the pyramid and Sutro are registered buildings: refs, pick at and near
//             them, the aim from the chase camera at the floor (the classic shot hits the
//             pyramid's face), the glint (glint.png)
// Results: <outDir>/landmarks-<modes>.json.
//   seq       taps at the Transamerica Pyramid from the chase camera at the floor, at
//             level 1, 2 and 3 (the same pose each time): frames 0.1 / 0.4 / 1.0 / 2.5 s
//             after impact (pyr-L<n>-<t>.png)
//   altitude  a tap from ~420 m aimed at the painted pyramid (it must be the target),
//             then the skyline from there (pyr-altitude*.png)
//   sutro     the same three taps at Sutro Tower (sutro-L<n>-<t>.png)
//   reload    reload: both landmarks still painted (levels, saved keys, shots)
//   near      a fresh city, a blast landing ~40 m from the pyramid's base: it blooms
//   views     Sutro Tower painted at levels 1 and 3, whole, from 650 m out (sutro-far-L<n>.png)
//   perf      draws / triangles / workMs at the pyramid view, grey and painted (perf.json)
// Everything steps on a fixed 1/30 s game clock and waits on it, never on wall time.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4801/';
const out = process.argv[3] ?? 'shots/landmarks';
const modes = new Set(process.argv.slice(4).length ? process.argv.slice(4) : ['probe', 'seq', 'altitude', 'sutro', 'reload']);
mkdirSync(out, { recursive: true });

// 120 m west of the pyramid, heading east at it (over Chinatown's low roofs, the low sun behind the camera)
const PYR = '?lat=37.79519&lon=-122.40415&heading=90&skipintro&fixeddt=0.0333';
const MARKS = [0.1, 0.4, 1.0, 2.5];
const report = {};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

async function open(query, fresh = true) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  if (fresh) {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('sbqa')) {
        sessionStorage.setItem('sbqa', '1');
        for (const k of Object.keys(localStorage)) if (k.startsWith('strugglebus.')) localStorage.removeItem(k);
      }
    });
  }
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await installHelpers(page);
  return page;
}

async function installHelpers(page) {
  await page.evaluate(() => {
    const g = window.__game;
    window.__lm = {
      refs() {
        const out = {};
        for (const r of g.city.landmarkRefs()) out[g.city.neighborhoodName(r.hood)] = r;
        return out;
      },
      info(r) {
        const p = g.city.paint.get(r.index);
        return { index: r.index, cx: +r.cx.toFixed(1), cz: +r.cz.toFixed(1), baseY: +r.baseY.toFixed(1), roofY: +r.roofY.toFixed(1), area: Math.round(r.area), level: p.level, hue: p.color, bloom: +p.bloomTime.toFixed(2) };
      },
      snap() {
        const f = g.flight;
        const s = {};
        for (const k of Object.keys(f)) if (typeof f[k] === 'number') s[k] = f[k];
        return s;
      },
      restore(s) {
        Object.assign(g.flight, s);
        g.rig.initialized = false;
      },
      /** put the bus d m from (x, z), on the given heading toward it (rad, 0 = north), at its floor */
      place(x, z, d, heading, y) {
        const f = g.flight;
        f.heading = heading;
        f.x = x - Math.sin(heading) * d;
        f.z = z + Math.cos(heading) * d;
        if (y !== undefined) f.y = y;
        g.rig.initialized = false;
      },
      target() {
        return g.city.buildingMaterial.uniforms.uTarget.value;
      },
    };
  });
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

async function until(page, cond, maxS) {
  return page.evaluate(
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
}

async function holdShot(page, at, path) {
  await page.evaluate((t) => {
    window.__qa = Object.assign(window.__qa || {}, { holdAt: t, held: false });
  }, at);
  await page.waitForFunction(() => window.__qa && window.__qa.held === true, null, { timeout: 300000 });
  await page.screenshot({ path });
  await page.evaluate(() => {
    window.__qa.holdAt = undefined;
    window.__qa.held = false;
  });
}

/** A real tap now: returns the shot (aim, target, impact time). */
async function tap(page) {
  return page.evaluate(() => {
    const g = window.__game;
    g.forceReady();
    const aim = g.aimNow();
    g.tapSplat();
    const s = g.lastShot();
    return { aim, shot: s, impact: s ? s.t + s.travel : null };
  });
}

/**
 * Three taps from the same pose (d m from the landmark, on `heading`, at its floor): level 1, 2, 3, with
 * frames after each impact. The bus drifts slowly (the opening's glide speed, as tools/shots.mjs does), so it
 * still faces the landmark seconds after the tap instead of reaching its collision post.
 */
async function levels(page, name, refName, d, heading) {
  const placeSlow = ([n, d, h]) => {
    const g = window.__game;
    const r = window.__lm.refs()[n];
    window.__qa = {};
    g.flight.glideSpeed = 6;
    g.flight.speed = 6;
    // (at the rooftop floor: no held altitude left over from an earlier phase)
    Object.assign(g.flight, { holdY: -Infinity, mode: 0, vy: 0 });
    window.__lm.place(r.cx, r.cz, d, h);
    g.flight.y = g.city.obstacleAt(g.flight.x, g.flight.z) + g.config.flight.clearance;
  };
  await page.evaluate(placeSlow, [refName, d, heading]);
  await until(page, '!g.city.busy', 40);
  await runFor(page, 1.5);
  await page.evaluate(placeSlow, [refName, d, heading]);
  await runFor(page, 0.3);
  const pose = await page.evaluate(() => window.__lm.snap());
  const rows = [];
  for (let L = 1; L <= 3; L++) {
    await page.evaluate((s) => {
      window.__lm.restore(s);
      window.__qa = {};
    }, pose);
    await runFor(page, 0.25);
    const t = await tap(page);
    for (const m of MARKS) await holdShot(page, t.impact + m, `${out}/${name}-L${L}-${m.toFixed(2)}.png`);
    const info = await page.evaluate((n) => window.__lm.info(window.__lm.refs()[n]), refName);
    rows.push({ L, aimLm: t.aim.lm, aim: [t.aim.x, t.aim.y, t.aim.z].map((v) => +v.toFixed(1)), target: t.shot?.target?.index ?? null, impact: +t.impact.toFixed(2), after: info });
    console.log(name, `L${L}`, JSON.stringify(rows[rows.length - 1]));
    await runFor(page, 1.2);
  }
  await page.evaluate(() => {
    window.__game.flight.glideSpeed = 0;
    window.__qa = {};
  });
  return rows;
}

let page = null;

if (modes.has('probe') || modes.has('seq') || modes.has('altitude') || modes.has('sutro') || modes.has('reload')) {
  page = await open(PYR);
  await page.evaluate(() => (window.__qa = {}));
  await runFor(page, 0.3);
  const probe = await page.evaluate(() => {
    const g = window.__game;
    const L = window.__lm;
    const refs = L.refs();
    const out = {};
    for (const [n, r] of Object.entries(refs)) {
      const pickC = g.splatter.pick(r.cx, r.cz);
      const pickEdge = g.splatter.pick(r.cx + Math.sqrt(r.area) * 0.45, r.cz);
      out[n] = {
        ...L.info(r),
        ring: r.tile.vertStart[1],
        pickCenter: pickC ? pickC.index : null,
        pickNearEdge: pickEdge ? pickEdge.index : null,
        surfaceCenter: +g.city.surfaceAt(r.cx, r.cz).toFixed(1),
        surfaceMid: +g.city.surfaceAt(r.cx, r.cz + Math.sqrt(r.area) * 0.25).toFixed(1),
        roofAtMid: +g.city.roofAtPart(r, r.cx, r.cz + Math.sqrt(r.area) * 0.25).toFixed(1),
      };
    }
    g.forceReady();
    return out;
  });
  await runFor(page, 0.4);
  probe.aimFromFloor = await page.evaluate(() => ({ aim: window.__game.aimNow(), glint: window.__lm.target(), bus: [window.__game.flight.x, window.__game.flight.y, window.__game.flight.z].map((v) => +v.toFixed(1)) }));
  console.log('probe', JSON.stringify(probe));
  report.probe = probe;
  await runFor(page, 0.3);
  await page.screenshot({ path: `${out}/glint.png` });
}

if (modes.has('seq')) report.pyramid = await levels(page, 'pyr', 'Transamerica', 100, Math.PI / 2);

if (modes.has('altitude')) {
  // ~900 m west of the pyramid, climb to ~430 m, heading east: the 20-degree breath ray meets its face
  // (lifted there and held, as a climb that let go at 430 m would: a real climb is minutes of SwiftShader)
  await page.evaluate(() => {
    const g = window.__game;
    const r = window.__lm.refs().Transamerica;
    window.__lm.place(r.cx, r.cz, 900, Math.PI / 2);
    window.__qa = {};
    g.flight.glideSpeed = 12;
    Object.assign(g.flight, { y: 430, holdY: 430, targetY: 430, vy: 0, mode: 1 });
  });
  const took = 0;
  await until(page, '!g.city.busy', 60);
  await runFor(page, 3.0);
  // right at it again, where the 20-degree breath ray meets its face ~150 m up
  await page.evaluate(() => {
    const g = window.__game;
    const r = window.__lm.refs().Transamerica;
    const d = (g.flight.y - (r.baseY + 150)) / Math.tan((20 * Math.PI) / 180);
    window.__lm.place(r.cx, r.cz, d, Math.PI / 2);
  });
  await runFor(page, 0.2);
  // how far ahead the ray meets the pyramid now; drift there along the heading
  const st = await page.evaluate(() => {
    const g = window.__game;
    const r = window.__lm.refs().Transamerica;
    g.forceReady();
    const a = g.aimNow();
    return { took: 0, y: g.flight.y, dx: g.flight.x - r.cx, aim: a, glint: window.__lm.target(), pyr: r.index };
  });
  st.took = took;
  console.log('altitude before', JSON.stringify(st));
  await until(page, '(g.forceReady(), g.aimNow().lm && window.__lm.target() === window.__lm.refs().Transamerica.index)', 3);
  await page.screenshot({ path: `${out}/pyr-altitude-glint.png` });
  const t = await tap(page);
  report.altitude = { climb: st, aimLm: t.aim.lm, aim: t.aim, target: t.shot?.target?.index ?? null, pyramid: st.pyr };
  console.log('altitude tap', JSON.stringify(report.altitude));
  for (const m of [0.1, 1.0]) await holdShot(page, t.impact + m, `${out}/pyr-altitude-${m.toFixed(2)}.png`);
  await runFor(page, 2.5);
  await page.screenshot({ path: `${out}/pyr-altitude.png` });
  report.altitude.after = await page.evaluate(() => window.__lm.info(window.__lm.refs().Transamerica));
}

if (modes.has('sutro')) {
  await page.evaluate(() => {
    const r = window.__lm.refs()['Sutro Tower'];
    window.__lm.place(r.cx, r.cz, 100, Math.PI / 2, r.baseY + 30);
    window.__qa = {};
  });
  report.sutro = await levels(page, 'sutro', 'Sutro Tower', 100, Math.PI / 2);
}

if (modes.has('reload') && page) {
  await runFor(page, 1.5); // the paint save timer
  const before = await page.evaluate(() => Object.fromEntries(Object.entries(window.__lm.refs()).map(([n, r]) => [n, window.__lm.info(r)])));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await installHelpers(page);
  await page.evaluate(() => (window.__qa = {}));
  await runFor(page, 1.0);
  const after = await page.evaluate(() => Object.fromEntries(Object.entries(window.__lm.refs()).map(([n, r]) => [n, window.__lm.info(r)])));
  const saved = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('strugglebus.paint.v1') || '{}');
    return { keys: Object.keys(s).length, landmarks: Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith('lm:'))) };
  });
  report.reload = { before, after, saved };
  console.log('reload', JSON.stringify(report.reload));
  await page.screenshot({ path: `${out}/reload-pyr.png` });
  await page.evaluate(() => {
    const r = window.__lm.refs()['Sutro Tower'];
    window.__lm.place(r.cx, r.cz, 130, 0, r.baseY + 30);
  });
  await until(page, '!g.city.busy', 40);
  await runFor(page, 2.0);
  await page.screenshot({ path: `${out}/reload-sutro.png` });
}
if (page) await page.close();

if (modes.has('near')) {
  const p2 = await open(PYR);
  await p2.evaluate(() => (window.__qa = {}));
  await runFor(p2, 0.5);
  // 40 m west of the pyramid's west face (its base half-width is ~27 m)
  const res = await p2.evaluate(() => {
    const g = window.__game;
    const r = window.__lm.refs().Transamerica;
    const x = r.cx - 27 - 40, z = r.cz + 6;
    const before = window.__lm.info(r);
    const primary = g.splatter.pick(x, z);
    const [lat0, lon0] = g.city.manifest.origin;
    const lat = lat0 - z / 110574, lon = lon0 + x / (111320 * Math.cos((lat0 * Math.PI) / 180));
    const t = g.barfAtLatLon(lat, lon);
    return { before, primary: primary ? primary.index : null, x, z, t };
  });
  await runFor(p2, 0.1);
  await holdShot(p2, res.t + 0.15, `${out}/near-0.15.png`);
  await holdShot(p2, res.t + 1.5, `${out}/near-1.50.png`);
  res.after = await p2.evaluate(() => window.__lm.info(window.__lm.refs().Transamerica));
  report.near = res;
  console.log('near', JSON.stringify(res));
  await p2.close();
}

if (modes.has('views')) {
  // the whole of Sutro Tower painted (levels 1 and 3, set straight on its texel: a look, not a pipeline
  // test), from 650 m out and a little above its hilltop
  const p4 = await open(PYR);
  for (const L of [1, 3]) {
    await p4.evaluate((L) => {
      const g = window.__game;
      const r = window.__lm.refs()['Sutro Tower'];
      g.city.paint.set(r.index, { faction: 1, color: 4, level: L, bloomTime: -100 });
      window.__qa = {};
      g.flight.glideSpeed = 6;
      window.__lm.place(r.cx, r.cz, 650, Math.PI * 0.35);
      Object.assign(g.flight, { y: r.baseY + 140, holdY: r.baseY + 140, targetY: r.baseY + 140, vy: 0, mode: 1 });
    }, L);
    await until(p4, '!g.city.busy', 60);
    await runFor(p4, 3.0);
    await p4.screenshot({ path: `${out}/sutro-far-L${L}.png` });
  }
  await p4.close();
}

if (modes.has('perf')) {
  const p3 = await open(PYR.replace('&fixeddt=0.0333', '') + '&fps');
  await p3.evaluate(() => (window.__qa = {}));
  const pose = await p3.evaluate(() => window.__lm.snap());
  const sample = async (tag) => {
    await p3.evaluate((s) => window.__lm.restore(s), pose);
    await runFor(p3, 0.6);
    return p3.evaluate(
      (tag) =>
        new Promise((res) => {
          const g = window.__game;
          const p = g.perf;
          const orig = p.frame;
          const rows = [];
          const start = g.clock();
          p.frame = function (dt, work) {
            const r = this.renderer.info.render;
            rows.push({ work: +work.toFixed(2), calls: r.calls, tris: r.triangles });
            return orig.call(this, dt, work);
          };
          const tick = () => {
            if (g.clock() - start >= 1.5 && rows.length >= 6) {
              p.frame = orig;
              const w = rows.map((r) => r.work).sort((a, b) => a - b);
              res({ tag, frames: rows.length, workMedian: w[Math.floor(w.length / 2)], workMean: +(w.reduce((a, b) => a + b, 0) / w.length).toFixed(2), callsMax: Math.max(...rows.map((r) => r.calls)), callsMin: Math.min(...rows.map((r) => r.calls)), trisMax: Math.max(...rows.map((r) => r.tris)) });
            } else requestAnimationFrame(tick);
          };
          tick();
        }),
      tag,
    );
  };
  const grey = await sample('grey');
  const hasLm = await p3.evaluate(() => typeof window.__game.city.landmarkRefs === 'function');
  let painted = null;
  if (hasLm) {
    // paint it (level 3, settled) without a blast, so the view is the same
    await p3.evaluate(() => {
      const g = window.__game;
      const r = window.__lm.refs().Transamerica;
      g.city.paint.set(r.index, { faction: 1, color: 4, level: 3, bloomTime: -100 });
    });
    painted = await sample('painted');
  }
  report.perf = { grey, painted };
  console.log('perf', JSON.stringify(report.perf));
  await p3.screenshot({ path: `${out}/perf-view.png` });
  await p3.close();
}

writeFileSync(`${out}/landmarks-${[...modes].join('-')}.json`, JSON.stringify(report, null, 1));
await browser.close();
console.log('landmark shots saved to', out);
