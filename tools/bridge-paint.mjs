#!/usr/bin/env node
// The bridges take paint (landmarkPaint.ts, Bridges.ts paintBridge), in the real game (index.html, iPhone portrait viewport).
//   node tools/bridge-paint.mjs <baseUrl> <outDir> [probe] [aim] [levels] [frames]
//
//   probe   the six landmarks in their slots (Sutro, the pyramid, Coit, the Ferry Building, then lm:ggb and lm:baybridge),
//           each texel, seed and ring; saved paint the four older ones had comes back on them; the bridges' surface seen
//           from above, from under the deck, beside it and on a cable's line
//   aim     for each bridge, a tap from the deck's height beside it and one from ~350 m above land on it (it glints, it is
//           the target, the breath comes down on its deck); one from under the Golden Gate's deck lands on the water
//   levels  three taps from above each bridge escalate it L1 -> L2 -> L3, then a reload: both come back at L3, saved
//           under lm:ggb and lm:baybridge in the landmark store
//   frames  both bridges grey, at L1 and at L3, at noon and at night (?t=, the sky's clock): <bridge>-<moment>-<state>.png,
//           and one contact sheet, sheet.png
// Results: <outDir>/bridge-paint.json. Everything steps on a fixed 1/30 s game clock and waits on it, never on wall time.
// The browser comes from tools/browser.mjs (the real GPU off the cloud machine).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4801/';
const out = process.argv[3] ?? 'shots/local/bridge-paint';
const modes = new Set(process.argv.slice(4).length ? process.argv.slice(4) : ['probe', 'aim', 'levels', 'frames']);
mkdirSync(out, { recursive: true });

// the sky's moments for San Francisco (tools/sky/clock-frames.mjs): noon, and a moonless midnight
const MOMENTS = { noon: '2026-11-05T20:05:00Z', night: '2026-11-06T08:00:00Z' };
const Q = '&skipintro&nohud&fixeddt=0.0333';
// a start in the Presidio's air, near the Golden Gate's south end
const START = '?lat=37.8040&lon=-122.4700&heading=0';
const NAMES = { ggb: 'Golden Gate Bridge', baybridge: 'Bay Bridge' };
const report = {};

const browser = await chromium.launch(browserOptions());
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

/** A page on the game; `seed`: landmark paint already saved before it loads (a fresh store otherwise). */
async function open(query, seed = null) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('sbqa')) {
      sessionStorage.setItem('sbqa', '1');
      for (const k of Object.keys(localStorage)) if (k.startsWith('strugglebus.')) localStorage.removeItem(k);
      if (s) localStorage.setItem('strugglebus.landmarks.v1', JSON.stringify(s));
    }
  }, seed);
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  // (the bridges are made paintable last, an idle tick each after the others)
  await page.waitForFunction(() => window.__game.city.landmarkRefs().length >= 6, null, { timeout: 120000 }).catch(() => console.log('fewer than 6 landmarks'));
  await installHelpers(page);
  return page;
}

async function installHelpers(page) {
  await page.evaluate((names) => {
    const g = window.__game;
    const c = g.city;
    const bridge = (kind) => {
      const lm = c.manifest.landmarks.find((l) => l.kind === kind);
      const ref = c.landmarkRefs().find((r) => c.neighborhoodName(r.hood) === names[kind]) ?? null;
      const d = lm.deck;
      // the deck's middle station and its direction there
      let L = 0;
      const s = [0];
      for (let i = 1; i < d.length; i++) s.push((L += Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1])));
      const at = (t) => {
        const S = t * L;
        let i = 0;
        while (i + 2 < d.length && S > s[i + 1]) i++;
        const k = (S - s[i]) / (s[i + 1] - s[i]);
        const dx = d[i + 1][0] - d[i][0], dz = d[i + 1][1] - d[i][1], n = Math.hypot(dx, dz);
        return { x: d[i][0] + dx * k, z: d[i][1] + dz * k, top: d[i][2] + (d[i + 1][2] - d[i][2]) * k, ux: dx / n, uz: dz / n };
      };
      return { ref, at, points: lm.points, length: L };
    };
    window.__br = {
      bridge,
      info(r) {
        const p = c.paint.get(r.index);
        return { index: r.index, slot: r.index - c.manifest.buildingCount, seed: r.tile.seed[0], level: p.level, hue: p.color, bloom: +p.bloomTime.toFixed(2) };
      },
      /** the bus at (x, z), y m up, heading along (fx, fz), holding there, still */
      place(x, z, y, fx, fz, speed = 0) {
        const f = g.flight;
        Object.assign(f, { x, z, y, heading: Math.atan2(fx, -fz), holdY: y, vy: 0, glideSpeed: speed, speed });
        g.rig.initialized = false;
      },
      target() {
        return c.buildingMaterial.uniforms.uTarget.value;
      },
    };
  }, NAMES);
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

/** A real tap, as tools/landmarks.mjs: loaded, a few frames for the Aimer to pick and glint, then the tap. */
async function tap(page) {
  await page.evaluate(() => window.__game.forceReady());
  await runFor(page, 0.2);
  return page.evaluate(() => {
    const g = window.__game;
    g.forceReady();
    const glint = g.glintNow();
    const bus = [g.flight.x, g.flight.y, g.flight.z].map((v) => +v.toFixed(1));
    g.tapSplat();
    const s = g.lastShot();
    return { glint: glint ? glint.index : null, target: s?.target?.index ?? null, aim: s ? s.aim.map((v) => +v.toFixed(1)) : null, wall: s?.wall ?? null, miss: !!s?.miss, bus, impact: s ? s.t + s.travel : null };
  });
}

/** Poses at a bridge's middle: beside it at the deck's height (110 m out, heading at it), 350 m over its line 900 m back, and under it. */
async function pose(page, kind, which) {
  await page.evaluate(
    ([k, w]) => {
      const b = window.__br.bridge(k);
      const m = b.at(0.5);
      if (w === 'deck') window.__br.place(m.x - m.uz * 110, m.z + m.ux * 110, m.top + 4, m.uz, -m.ux);
      else if (w === 'above') window.__br.place(m.x - m.ux * 900, m.z - m.uz * 900, 350, m.ux, m.uz);
      else window.__br.place(m.x - m.ux * 30, m.z - m.uz * 30, 26, m.ux, m.uz);
    },
    [kind, which],
  );
  await until(page, '!g.city.busy', 40);
  await runFor(page, 0.6);
}

/** What the surface reads at a bridge: from above, from under the deck, beside it, on the cable's line. */
async function surfaces(page, kind) {
  return page.evaluate((k) => {
    const c = window.__game.city;
    const b = window.__br.bridge(k);
    const m = b.at(0.5), q = b.at(0.3);
    const r = (v) => (v === -Infinity ? '-inf' : +v.toFixed(1));
    const [tx, tz] = b.points[1];
    return {
      deckTop: +m.top.toFixed(1),
      midAbove: r(c.surfaceAt(m.x, m.z)),
      midFromUnder: r(c.surfaceAt(m.x, m.z, m.top - 30)),
      midGround: r(c.groundAt(m.x, m.z)),
      beside60m: r(c.surfaceAt(m.x - m.uz * 60, m.z + m.ux * 60)),
      // over the main cable's line at 30 % of the deck, just outside the deck's edge
      cableLine: r(c.landmarkSurfaceAt(q.x - q.uz * (k === 'ggb' ? 14.6 : 12.4), q.z + q.ux * (k === 'ggb' ? 14.6 : 12.4))),
      towerTop: r(c.landmarkSurfaceAt(tx - m.uz * (k === 'ggb' ? 16 : 11.5), tz + m.ux * (k === 'ggb' ? 16 : 11.5))),
      buildingAtMid: c.buildingAt(m.x, m.z)?.index ?? null,
      buildingAtMidFromUnder: c.buildingAt(m.x, m.z, m.top - 30)?.index ?? null,
    };
  }, kind);
}

if (modes.has('probe')) {
  // the four older landmarks' saved paint, as a build before this one wrote it: it must come back on each
  const seed = { 'lm:sutro': [1, 2, 3], 'lm:transamerica': [1, 4, 2], 'lm:coit': [1, 1, 1], 'lm:ferry': [1, 5, 3] };
  const page = await open(START + Q, seed);
  report.probe = await page.evaluate(() => {
    const c = window.__game.city;
    return c.landmarkRefs().map((r) => ({ name: c.neighborhoodName(r.hood), ...window.__br.info(r), ring: r.tile.xz.length / 2, cx: +r.cx.toFixed(1), cz: +r.cz.toFixed(1), roofY: +r.roofY.toFixed(1), area: Math.round(r.area) }));
  });
  report.probe.seeded = seed;
  for (const r of report.probe) console.log('probe', JSON.stringify(r));
  report.surface = { ggb: await surfaces(page, 'ggb'), baybridge: await surfaces(page, 'baybridge') };
  console.log('surface', JSON.stringify(report.surface));
  await page.close();
}

if (modes.has('aim')) {
  const page = await open(START + Q);
  report.aim = {};
  for (const kind of ['ggb', 'baybridge']) {
    const idx = await page.evaluate((k) => window.__br.bridge(k).ref.index, kind);
    for (const which of kind === 'ggb' ? ['deck', 'above', 'under'] : ['deck', 'above']) {
      await pose(page, kind, which);
      const t = await tap(page);
      await until(page, `g.clock() > ${t.impact ?? 0} + 0.3`, 6);
      const ground = await page.evaluate(([x, z]) => +window.__game.city.groundAt(x, z).toFixed(1), [t.aim?.[0] ?? 0, t.aim?.[2] ?? 0]);
      const after = await page.evaluate((k) => window.__br.info(window.__br.bridge(k).ref), kind);
      const row = { ...t, bridge: idx, glintIsBridge: t.glint === idx, targetIsBridge: t.target === idx, groundAtLanding: ground, after };
      await page.screenshot({ path: `${out}/aim-${kind}-${which}.png` });
      report.aim[`${kind}-${which}`] = row;
      console.log('aim', kind, which, JSON.stringify(row));
      await runFor(page, 1.5);
    }
  }
  await page.close();
}

if (modes.has('levels')) {
  const page = await open(START + Q);
  report.levels = {};
  for (const kind of ['ggb', 'baybridge']) {
    const rows = [];
    for (let L = 1; L <= 3; L++) {
      await pose(page, kind, 'above');
      const t = await tap(page);
      await until(page, `g.clock() > ${t.impact ?? 0} + 1.5`, 8);
      const info = await page.evaluate((k) => window.__br.info(window.__br.bridge(k).ref), kind);
      rows.push({ tap: L, target: t.target, aim: t.aim, level: info.level, hue: info.hue });
      console.log('levels', kind, JSON.stringify(rows[rows.length - 1]));
    }
    report.levels[kind] = rows;
  }
  await runFor(page, 1.5); // the paint save timer
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await page.waitForFunction(() => window.__game.city.landmarkRefs().length >= 6, null, { timeout: 120000 });
  await installHelpers(page);
  report.reload = await page.evaluate(() => ({
    ggb: window.__br.info(window.__br.bridge('ggb').ref),
    baybridge: window.__br.info(window.__br.bridge('baybridge').ref),
    saved: JSON.parse(localStorage.getItem('strugglebus.landmarks.v1') || '{}'),
    lmKeysInBuildingStore: Object.keys(JSON.parse(localStorage.getItem('strugglebus.paint.v3') || '{}')).filter((k) => k.startsWith('lm:')).length,
  }));
  console.log('reload', JSON.stringify(report.reload));
  await page.close();
}

/** The bus where a bridge's frame is: the Golden Gate's south tower from the bay, the Bay Bridge's second tower from the north. */
async function framePose(page, kind) {
  await page.evaluate((k) => {
    const b = window.__br.bridge(k);
    const m = b.at(0.5);
    // (a tower, 150 m on along the span: the deck runs on past it into the frame)
    const [tx, tz] = b.points[k === 'ggb' ? 1 : 2];
    const px = tx + m.ux * 150, pz = tz + m.uz * 150;
    const side = k === 'ggb' ? 1 : -1;
    const x = px - m.uz * side * 430 - m.ux * 150, z = pz + m.ux * side * 430 - m.uz * 150;
    const L = Math.hypot(px - x, pz - z);
    window.__br.place(x, z, k === 'ggb' ? 95 : 85, (px - x) / L, (pz - z) / L);
  }, kind);
}

/** A bridge's frame, once the city around it has streamed in and the camera has settled. */
async function frame(page, kind, path) {
  await framePose(page, kind);
  await until(page, '!g.city.busy', 40);
  await runFor(page, 2.5);
  await page.screenshot({ path });
}

if (modes.has('frames')) {
  const shots = [];
  for (const [moment, t] of Object.entries(MOMENTS)) {
    const page = await open(START + Q + `&t=${t}&rate=0`);
    for (const kind of ['ggb', 'baybridge']) {
      const name = (s) => `${out}/${kind}-${moment}-${s}.png`;
      await frame(page, kind, name('grey'));
      shots.push([kind, moment, 'grey']);
      for (let L = 1; L <= 3; L++) {
        await pose(page, kind, 'above');
        const tp = await tap(page);
        if (L === 1) {
          // the paint's run out along the deck from the breath, seen from the frame (the camera is there by then)
          await framePose(page, kind);
          await until(page, `g.clock() > ${tp.impact ?? 0} + 0.75`, 10);
          await page.screenshot({ path: name('run') });
          shots.push([kind, moment, 'run']);
        }
        await until(page, `g.clock() > ${tp.impact ?? 0} + 4`, 10);
        if (L === 1 || L === 3) {
          await frame(page, kind, name(`L${L}`));
          shots.push([kind, moment, `L${L}`]);
        }
      }
      console.log('frames', kind, moment, JSON.stringify(await page.evaluate((k) => window.__br.info(window.__br.bridge(k).ref), kind)));
    }
    await page.close();
  }
  // one contact sheet: a row per bridge and moment, grey / the run / L1 / L3
  const img = (f) => `data:image/png;base64,${readFileSync(`${out}/${f}`).toString('base64')}`;
  const rows = [];
  for (const kind of ['ggb', 'baybridge'])
    for (const moment of Object.keys(MOMENTS))
      rows.push(`<div class="row">${['grey', 'run', 'L1', 'L3'].map((s) => `<figure><img src="${img(`${kind}-${moment}-${s}.png`)}"><figcaption>${kind} ${moment} ${s}</figcaption></figure>`).join('')}</div>`);
  const sheet = await ctx.newPage();
  await sheet.setViewportSize({ width: 4 * 300 + 50, height: rows.length * 690 + 20 });
  await sheet.setContent(`<style>body{margin:10px;background:#222;font:14px sans-serif;color:#ddd}.row{display:flex;gap:10px;margin-bottom:10px}figure{margin:0}img{width:300px;height:650px;display:block;image-rendering:pixelated}</style>${rows.join('')}`);
  await sheet.screenshot({ path: `${out}/sheet.png`, fullPage: true });
  report.frames = shots;
}

writeFileSync(`${out}/bridge-paint.json`, JSON.stringify(report, null, 1));
await browser.close();
