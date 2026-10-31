#!/usr/bin/env node
// Play it over mapped, sloped roofs, in the real game (iPhone viewport, ?fixeddt off: the real clock): three taps on one
// block (levels 1-3: the crest gardens), a mega blast, a firehose, a low hover along the ridges, a reload with paint saved.
//   node tools/osm-play.mjs <baseUrl> <outDir> [amsterdam] [ladies] [london]
// Writes <outDir>/<place>-<step>.png and osm-play.json. Exit 1 on a page error or the bus inside a roof.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [baseArg = 'http://127.0.0.1:4175/', out = 'shots/local/osm-play', ...modes] = pos;
const base = baseArg.endsWith('/') ? baseArg : baseArg + '/';
mkdirSync(out, { recursive: true });
const PLACES = {
  amsterdam: { q: 'city=amsterdam&lat=52.3735&lon=4.8820&heading=0' },
  ladies: { q: 'lat=37.77605&lon=-122.4345&heading=90' },
  london: { q: 'city=london&lat=51.5128&lon=-0.1860&heading=90' },
};
const want = modes.length ? modes : Object.keys(PLACES);
const browser = await chromium.launch(browserOptions([]));
const report = {};
let failed = 0;
for (const name of want) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
  await page.goto(`${base}?${PLACES[name].q}&skipintro&nohud&fps&controls=touch`);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  const clock = (s) =>
    page.evaluate(
      (t) =>
        new Promise((res) => {
          const g = window.__game, t0 = g.clock();
          const tick = () => (g.clock() - t0 >= t ? res(null) : requestAnimationFrame(tick));
          tick();
        }),
      s,
    );
  const shot = (step) => page.screenshot({ path: `${out}/${name}-${step}.png` });
  await clock(2);
  const r = (report[name] = { taps: [] });
  // hold the bus still over the block: the same target three times
  const hold = await page.evaluate(() => {
    const g = window.__game;
    window.__hold = { x: g.flight.x, z: g.flight.z, y: g.flight.y };
    return window.__hold;
  });
  for (let i = 1; i <= 3; i++) {
    const before = await page.evaluate(() => {
      const g = window.__game, f = g.flight;
      f.x = window.__hold.x;
      f.z = window.__hold.z;
      g.forceReady();
      g.tapSplat();
      return g.lastShot();
    });
    await clock(2.6);
    const after = await page.evaluate((shotT) => {
      const g = window.__game;
      const t = shotT?.target;
      const near = g.city.buildingsNear(t ? t.cx : g.flight.x, t ? t.cz : g.flight.z, 3, []);
      const ref = near.find((n) => n.ref.index === t?.index)?.ref ?? null;
      return { target: t, level: t ? g.city.paint.level(t.index) : null, rect: ref ? g.city.roofRect(ref) : null, built: ref ? ref.roofBuild[ref.top] : null, aimY: shotT?.aim?.[1], sign: g.lastSign(), roofAt: t ? g.city.roofAtPart(ref ?? { }, t.cx, t.cz) : null };
    }, before).catch((e) => ({ error: String(e) }));
    r.taps.push(after);
    await shot(`L${i}`);
    console.log(name, `tap ${i}`, JSON.stringify(after).slice(0, 260));
  }
  // a mega blast
  const m = await page.evaluate(() => {
    const g = window.__game;
    g.flight.x = window.__hold.x + 120;
    g.flight.z = window.__hold.z;
    return g.superSplat(4);
  });
  await clock(5);
  r.mega = await page.evaluate(() => window.__game.superState());
  await shot('mega');
  console.log(name, 'mega', m, JSON.stringify(r.mega.stats).slice(0, 200));
  // the firehose
  await page.evaluate(() => window.__game.superSkip(100));
  await clock(0.3);
  const fh = await page.evaluate(() => window.__game.superSplat(10));
  await clock(12);
  await shot('hose-end');
  r.hose = await page.evaluate(() => window.__game.superState());
  console.log(name, 'hose', fh, JSON.stringify(r.hose.stats).slice(0, 200));
  await clock(2);
  // a low hover along the ridges: dive to the floor, hold, read the clearance over what is drawn
  await page.evaluate(() => (window.__qa = { sx: 0, sy: 1 }));
  const rows = await page.evaluate(
    () =>
      new Promise((res) => {
        const g = window.__game, f = g.flight, c = g.city;
        const t0 = g.clock();
        let min = Infinity, at = null, n = 0;
        const tick = () => {
          const s = c.surfaceAt(f.x, f.z), o = c.obstacleAt(f.x, f.z);
          const clear = f.y - s;
          if (clear < min) {
            min = clear;
            at = { x: +f.x.toFixed(1), z: +f.z.toFixed(1), y: +f.y.toFixed(1), surface: +s.toFixed(1), obstacle: +o.toFixed(1) };
          }
          n++;
          if (g.clock() - t0 >= 10) res({ min, at, n });
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  await page.evaluate(() => (window.__qa = null));
  r.hover = rows;
  await shot('hover');
  console.log(name, 'hover', JSON.stringify(rows));
  if (rows.min < 0) failed++;
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__game.city.ground.persist());
  const painted = await page.evaluate(() => {
    const g = window.__game;
    const ids = [];
    for (const r of g.city.loadedRefs()) if (g.city.paint.level(r.index) > 0.5) ids.push(r.stableId);
    return ids.length;
  });
  await page.reload();
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await clock(2);
  const back = await page.evaluate(() => {
    const g = window.__game;
    let n = 0;
    for (const r of g.city.loadedRefs()) if (g.city.paint.level(r.index) > 0.5) n++;
    return n;
  });
  await shot('reload');
  r.painted = painted;
  r.back = back;
  r.errors = errors;
  console.log(name, 'painted', painted, 'after a reload', back, 'errors', errors.length, errors.slice(0, 3));
  if (errors.length) failed++;
  await ctx.close();
}
writeFileSync(`${out}/osm-play.json`, JSON.stringify(report, null, 1));
await browser.close();
process.exit(failed ? 1 : 0);
