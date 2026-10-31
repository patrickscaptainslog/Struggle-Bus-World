#!/usr/bin/env node
// Saved paint and the data credit on OpenStreetMap data, in the real game (index.html, iPhone viewport, one browser).
//   node tools/osm-paint.mjs <baseUrl> <outDir> [stale] [paint] [landmarks] [credit] [cities]
//   stale      old saves on the device: rank-keyed building paint, ground tiles, a broken store, landmark paint. The old
//              stores go, nothing lands on a building, nothing throws, the landmarks keep their paint
//   paint      a blast on SF, reload: the same stable ids painted, the stores the id scheme names
//   landmarks  every paintable landmark takes paint on this data, it saves by name, and it survives a reload
//   credit     the ODbL credit on a first visit, after a tap past the opening, under ?skipintro; settings' MAP DATA
//   cities     ?city=amsterdam and ?city=london: a blast, reload, the paint back in that city's own store
// Writes <outDir>/osm-paint.json and a few PNGs. Exit 1 on any failed check.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [baseArg = 'http://127.0.0.1:4175/', out = 'shots/local/osm-paint', ...modes] = pos;
const base = baseArg.endsWith('/') ? baseArg : baseArg + '/';
const want = new Set(modes.length ? modes : ['stale', 'paint', 'landmarks', 'credit', 'cities']);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(browserOptions([]));
const report = {};
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ' ' + JSON.stringify(detail) : ''}`);
  if (!ok) failed++;
  (report.checks ??= []).push({ name, ok, detail });
};
const VIEW = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true };
async function fresh(seed) {
  const ctx = await browser.newContext(VIEW);
  if (seed) await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('sb-seeded')) return;
    sessionStorage.setItem('sb-seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => {
    page.errors.push(e.message);
    console.log('[pageerror]', e.message);
  });
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && page.errors.push(m.text()));
  return page;
}
const ready = (page) => page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
const settle = (page, s = 1) =>
  page.evaluate(
    (t) =>
      new Promise((res) => {
        const g = window.__game, t0 = g.clock();
        const tick = () => (g.clock() - t0 >= t && !g.city.busy ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    s,
  );
const keys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('strugglebus.')).sort());
const ALAMO = [37.77605, -122.43262];

if (want.has('stale')) {
  // a device that played main: rank ids that are also real OSM ids here must not land on anything
  const page = await fresh(null);
  await page.goto(base + `?lat=${ALAMO[0]}&lon=${ALAMO[1]}&heading=90&skipintro&nohud`);
  await ready(page);
  await settle(page, 1);
  // the stable ids of real buildings under the bus: saved against the OLD stores, the worst case
  const ids = await page.evaluate(() => {
    const g = window.__game;
    return g.city.buildingsNear(g.flight.x, g.flight.z, 120, []).slice(0, 40).map((n) => n.ref.stableId);
  });
  await page.context().close();
  const rank = Object.fromEntries(ids.map((id) => [String(id), [1, 2, 3]]));
  const page2 = await fresh({
    'strugglebus.paint.v1': JSON.stringify({ ...rank, 'lm:coit': [1, 3, 2] }),
    'strugglebus.paint.v2': '{broken',
    'strugglebus.ground.v2:0,0': JSON.stringify({ t: 1, m: 'x', p: [] }),
    'strugglebus.ground.v3:1,1': 'not json',
    'strugglebus.ground.v1': '[]',
    'strugglebus.landmarks.v1': JSON.stringify({ 'lm:sutro': [1, 2, 2] }),
  });
  await page2.goto(base + `?lat=${ALAMO[0]}&lon=${ALAMO[1]}&heading=90&skipintro&nohud`);
  await ready(page2);
  await settle(page2, 1);
  const r = await page2.evaluate((ids) => {
    const g = window.__game;
    const near = g.city.buildingsNear(g.flight.x, g.flight.z, 120, []);
    const lm = Object.fromEntries(g.city.landmarkRefs().map((l) => [l.tile.hood[0], g.city.paint.level(l.index)]));
    return { nearPainted: near.filter((n) => g.city.paint.level(n.ref.index) > 0).length, near: near.length, ids: ids.length, landmarks: g.city.landmarkRefs().map((l) => [g.city.neighborhoodName(l.hood), g.city.paint.level(l.index)]), lm, painted: g.city.paint.paintedCount, scheme: g.city.paint.scheme };
  }, ids);
  await page2.waitForTimeout(1200);
  const left = await keys(page2);
  report.stale = { ...r, keys: left };
  check('stale: no page errors', page2.errors.length === 0, page2.errors);
  check('stale: osm scheme', r.scheme === 'osm', r.scheme);
  check('stale: no building takes old paint', r.nearPainted === 0, { near: r.near, painted: r.nearPainted });
  check('stale: old stores gone', !left.some((k) => /paint\.v[12]$|ground\.v[123]/.test(k)), left);
  check('stale: landmark store kept', left.includes('strugglebus.landmarks.v1'), left);
  check('stale: lm:sutro painted', r.landmarks.some(([n, l]) => /sutro/i.test(n) && l === 2), r.landmarks);
  check('stale: lm:coit left in the old store moved over', r.landmarks.some(([n, l]) => /coit/i.test(n) && l === 2), r.landmarks);
  await page2.context().close();
}

async function blastAndReload(query, lat, lon, label) {
  const page = await fresh(null);
  await page.goto(base + query);
  await ready(page);
  await settle(page, 1);
  const tImpact = await page.evaluate(([la, lo]) => window.__game.barfAtLatLon(la, lo), [lat, lon]);
  await page.waitForFunction((t) => window.__game.clock() > t + 2.5, tImpact, { timeout: 60000 });
  const before = await page.evaluate(() => {
    const g = window.__game;
    const all = [];
    for (const r of g.city.loadedRefs()) if (g.city.paint.level(r.index) > 0.5) all.push([r.stableId, g.city.paint.level(r.index)]);
    return { all: all.sort((a, b) => a[0] - b[0]), sign: g.lastSign?.() ?? null, tiles: g.city.ground.tileCount };
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__game.city.ground.persist());
  await page.screenshot({ path: `${out}/${label}-painted.png` });
  const k0 = await keys(page);
  await page.reload();
  await ready(page);
  await settle(page, 1);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const g = window.__game;
    const all = [];
    for (const r of g.city.loadedRefs()) if (g.city.paint.level(r.index) > 0.5) all.push([r.stableId, g.city.paint.level(r.index)]);
    return { all: all.sort((a, b) => a[0] - b[0]), tiles: g.city.ground.tileCount };
  });
  await page.screenshot({ path: `${out}/${label}-reloaded.png` });
  report[label] = { buildings: before.all.length, sign: before.sign, keys: k0, ground: [before.tiles, after.tiles] };
  check(`${label}: painted`, before.all.length > 0, before.all.length);
  check(`${label}: the same buildings after a reload`, JSON.stringify(before.all) === JSON.stringify(after.all), { before: before.all.length, after: after.all.length });
  check(`${label}: ground tiles back`, after.tiles >= before.tiles && before.tiles > 0, [before.tiles, after.tiles]);
  check(`${label}: no page errors`, page.errors.length === 0, page.errors);
  console.log(`${label} sign`, JSON.stringify(before.sign), 'keys', k0.join(' ').slice(0, 200));
  await page.context().close();
  return k0;
}

if (want.has('paint')) {
  const k = await blastAndReload(`?lat=${ALAMO[0]}&lon=${ALAMO[1]}&heading=90&skipintro&nohud`, ALAMO[0], ALAMO[1], 'sf');
  check('sf: building store is paint.v3', k.includes('strugglebus.paint.v3'), k.slice(0, 6));
  check('sf: ground store is ground.v4', k.some((x) => x.startsWith('strugglebus.ground.v4:')), k.slice(0, 6));
}

if (want.has('landmarks')) {
  const page = await fresh(null);
  await page.goto(base + `?lat=37.7925&lon=-122.4010&heading=90&skipintro&nohud`);
  await ready(page);
  await settle(page, 1);
  const names = await page.evaluate(() => window.__game.city.landmarkRefs().map((l) => window.__game.city.neighborhoodName(l.hood)));
  const L = { Transamerica: [37.79516, -122.40279], 'Sutro Tower': [37.75525, -122.45275], 'Coit Tower': [37.80235, -122.40582], 'Ferry Building': [37.795507, -122.393448] };
  const res = {};
  for (const [name, [lat, lon]] of Object.entries(L)) {
    const t = await page.evaluate(([la, lo, nm]) => {
      const g = window.__game;
      const r = g.city.landmarkRefs().find((l) => g.city.neighborhoodName(l.hood) === nm);
      if (!r) return null;
      g.flight.x = r.cx - 90;
      g.flight.z = r.cz;
      return g.splatter.barf(r.cx, r.cz, { target: r });
    }, [lat, lon, name]);
    if (t === null) {
      res[name] = 'no ref';
      continue;
    }
    await page.waitForFunction((x) => window.__game.clock() > x + 1, t, { timeout: 60000 });
    res[name] = await page.evaluate((nm) => {
      const g = window.__game;
      const r = g.city.landmarkRefs().find((l) => g.city.neighborhoodName(l.hood) === nm);
      return g.city.paint.level(r.index);
    }, name);
  }
  await page.waitForTimeout(1500);
  const stored = await page.evaluate(() => localStorage.getItem('strugglebus.landmarks.v1'));
  await page.reload();
  await ready(page);
  await settle(page, 1);
  const back = await page.evaluate(() => {
    const g = window.__game;
    return Object.fromEntries(g.city.landmarkRefs().map((l) => [g.city.neighborhoodName(l.hood), g.city.paint.level(l.index)]));
  });
  report.landmarks = { names, res, stored, back };
  for (const n of Object.keys(L)) {
    check(`landmark ${n} takes paint`, Number(res[n]) >= 1, res[n]);
    check(`landmark ${n} back after a reload`, back[n] >= 1, back[n]);
  }
  check('landmarks: saved by name', /lm:transamerica/.test(stored ?? '') && /lm:sutro/.test(stored ?? '') && /lm:coit/.test(stored ?? '') && /lm:ferry/.test(stored ?? ''), stored);
  check('landmarks: no page errors', page.errors.length === 0, page.errors);
  await page.context().close();
}

if (want.has('credit')) {
  const creditLife = async (page, label, act) => {
    const t0 = Date.now();
    let seenAt = null, goneAt = null, opaque = false;
    await act?.();
    for (let i = 0; i < 400; i++) {
      const st = await page.evaluate(() => {
        const el = document.querySelector('[data-sb-credit]');
        return el ? { text: el.textContent, op: Number(getComputedStyle(el).opacity), box: el.getBoundingClientRect().toJSON() } : null;
      });
      if (st && seenAt === null) seenAt = Date.now() - t0;
      if (st && st.op > 0.9 && !opaque) {
        opaque = true;
        report[label + 'Text'] = st;
        await page.screenshot({ path: `${out}/credit-${label}.png` });
      }
      if (!st && seenAt !== null) {
        goneAt = Date.now() - t0;
        break;
      }
      await page.waitForTimeout(100);
    }
    report[label] = { seenAt, goneAt, opaque };
    check(`credit: ${label} shows`, opaque, { seenAt, goneAt });
    check(`credit: ${label} leaves`, goneAt !== null && goneAt - seenAt > 3000, { seenAt, goneAt });
  };
  // a first visit: the whole opening
  let page = await fresh(null);
  await page.goto(base);
  await creditLife(page, 'first');
  await page.context().close();
  // a repeat visit: a tap past the opening
  page = await fresh({ 'strugglebus.opening.v1': '1' });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.city.loadedRegionCount() > 0, null, { timeout: 120000 });
  await creditLife(page, 'tapped', async () => {
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__game.input.onTap?.());
  });
  await page.context().close();
  // ?skipintro
  page = await fresh(null);
  await page.goto(base + '?skipintro');
  await creditLife(page, 'skipintro');
  // settings: MAP DATA
  await page.evaluate(() => window.__game.controls.hud.openSettings());
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/settings.png` });
  await page.evaluate(() => {
    const hud = window.__game.controls.hud;
    hud.creditsOpen = true;
    hud.renderSettings();
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/settings-mapdata.png` });
  check('credit: no page errors', page.errors.length === 0, page.errors);
  await page.context().close();
}

if (want.has('cities')) {
  const k = await blastAndReload('?city=amsterdam&skipintro&nohud', 52.3745, 4.8790, 'amsterdam');
  check('amsterdam: its own stores', k.includes('strugglebus.paint.v3:amsterdam') && k.some((x) => x.startsWith('strugglebus.ground.v4.amsterdam:')), k.slice(0, 6));
  const l = await blastAndReload('?city=london&lat=51.5128&lon=-0.1830&heading=90&skipintro&nohud', 51.5128, -0.1815, 'london');
  // a blast in the park, no building in reach: nothing blooms, the sign names the spot
  const page = await fresh(null);
  await page.goto(base + '?city=london&skipintro&nohud');
  await ready(page);
  await settle(page, 1);
  const t = await page.evaluate(() => {
    const g = window.__game;
    g.forceReady();
    g.tapSplat();
    return g.clock() + 1;
  });
  await page.waitForFunction((x) => window.__game.clock() > x + 5, t, { timeout: 60000 });
  const sign = await page.evaluate(() => window.__game.lastSign());
  await page.screenshot({ path: `${out}/london-park.png` });
  report.londonPark = sign;
  check('london: a blast in the park raises a place sign', !!sign, sign);
  await page.context().close();
  check('london: its own stores', l.includes('strugglebus.paint.v3:london') && l.some((x) => x.startsWith('strugglebus.ground.v4.london:')), l.slice(0, 6));
}

writeFileSync(`${out}/osm-paint.json`, JSON.stringify(report, null, 1));
await browser.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
