#!/usr/bin/env node
// The budget's worst case: the frame's draws and triangles (the sun pass included) over a compass sweep, at the ceiling,
// at ~250 m and at the street, from the city's densest spots. tools/fps.mjs holds one heading; a view across the
// densest blocks is what the budget has to survive.
//   node tools/sweep.mjs <baseUrl> <out.json> [--spots=richmond,sunset,...] [--alts=30,250,350,500] [--step=45]
// A fresh page per spot, the real game clock, the bus held on the spot and at the height (heights ascending), window.__stats
// (a 1 s window) after streaming settles at each heading.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base = 'http://127.0.0.1:4175/', out = 'sweep.json'] = pos;
const SPOTS = {
  richmond: [37.7790, -122.4780],
  sunset: [37.7560, -122.4830],
  mission: [37.7600, -122.4150],
  nobhill: [37.7930, -122.4150],
  alamo: [37.7763, -122.4340],
  fidi: [37.7925, -122.4010],
  marina: [37.8010, -122.4370],
  // (the hillsides: over a slope the view takes in far more roofs than from the flats, and the budget's worst views are here)
  noe: [37.7500, -122.4330],
  twinpeaks: [37.7530, -122.4470],
  excelsior: [37.7240, -122.4280],
  bernal: [37.7400, -122.4160],
};
const spots = (opt.spots ?? Object.keys(SPOTS).join(',')).split(',');
const alts = (opt.alts ?? '30,250,350,500').split(',').map(Number);
const step = Number(opt.step ?? 45);
const browser = await chromium.launch(browserOptions([]));
const report = { base, rows: [] };
for (const spot of spots) {
  const [lat, lon] = SPOTS[spot];
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}?lat=${lat}&lon=${lon}&heading=0&skipintro&nohud&fps`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
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
  // (hold the spot, every frame: the sweep turns on it, it doesn't fly away over the bay)
  await page.evaluate(() => {
    const f = window.__game.flight, hold = (window.__hold = { x: f.x, z: f.z, y: null, heading: f.heading });
    const tick = () => {
      f.x = hold.x;
      f.z = hold.z;
      f.heading = hold.heading;
      if (hold.y !== null) {
        f.y = hold.y;
        f.vy = 0;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
  for (const alt of alts) {
    if (alt > 40) {
      await page.evaluate(() => (window.__hold.y = null));
      await qa({ sx: 0, sy: -1 });
      await run(`g.flight.y + Math.max(0, g.flight.vy) / (2 * 0.85) >= ${alt} || g.flight.strain > 0.85`, 90);
      await qa(null);
      // (a hilltop's spawn can already stand higher than the height asked for)
      await page.evaluate((a) => (window.__hold.y = Math.max(a, window.__game.flight.y)), alt);
    }
    let worst = null;
    for (let h = 0; h < 360; h += step) {
      await page.evaluate((d) => (window.__hold.heading = (d * Math.PI) / 180), h);
      await run('false', 2);
      await run('!g.city.busy', 8);
      const a = await page.evaluate(() => window.__stats?.frames ?? -1);
      await page.waitForFunction((f) => (window.__stats?.frames ?? -1) !== f, a, { timeout: 8000 }).catch(() => {});
      const s = await page.evaluate(() => ({ calls: window.__stats.calls, tris: window.__stats.triangles, fps: window.__stats.fps, y: Math.round(window.__game.flight.y) }));
      const row = { spot, alt, heading: h, ...s };
      report.rows.push(row);
      if (!worst || s.tris > worst.tris) worst = row;
    }
    console.log('worst', JSON.stringify(worst), 'most draws', Math.max(...report.rows.filter((r) => r.spot === spot && r.alt === alt).map((r) => r.calls)));
  }
  await page.close();
}
await browser.close();
const top = [...report.rows].sort((a, b) => b.tris - a.tris)[0];
report.worst = top;
report.mostDraws = [...report.rows].sort((a, b) => b.calls - a.calls)[0];
writeFileSync(out, JSON.stringify(report, null, 1));
console.log('worst of all', JSON.stringify(top), 'most draws', JSON.stringify(report.mostDraws));
