#!/usr/bin/env node
// The street camera preview's stills (?streetcam, docs/specs/shots/GEARS.md): each street tools/streetcam/pick.ts chose, at noon and
// at golden hour, through both lenses (the chase, and ?streetcam=wide's), the live sky's clock pinned so a frame is the same twice.
//   node tools/streetcam/shots.mjs <baseUrl> <outDir> <streets.json> [--date=2026-11-06]
// Writes <outDir>/<street>-<hour>-<lens>.png (393 x 852 CSS px at 1x: one game pixel each) and stills.json (the draws, triangles and the
// bus's height over the road at each). tools/streetcam/sheet.py makes the contact sheet.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const [base, out, list] = args.filter((a) => !a.startsWith('--'));
const date = (args.find((a) => a.startsWith('--date=')) ?? '--date=2026-11-06').slice(7);
mkdirSync(out, { recursive: true });
const streets = JSON.parse(readFileSync(list, 'utf8')).filter((s) => !s.none);
// (San Francisco's clock, UTC: noon is 20:00, golden hour 40 minutes before a November sunset at about 16:59)
const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const hours = [
  { name: 'noon', t: `${date}T20:00:00Z` },
  { name: 'golden', t: `${next}T00:20:00Z` },
];
const LENSES = { chase: { back: 34, eye: 7.5, ahead: 90, at: 3.5, hfov: 34 }, wide: { back: 16, eye: 3.2, ahead: 60, at: 3, hfov: 58 } };

const browser = await chromium.launch(browserOptions());
const rows = [];
for (const s of streets) {
  for (const h of hours) {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    const url = `${base}${s.query}&nohud&fixeddt=0.05&t=${h.t}&rate=0`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 240000 });
    for (const [lens, L] of Object.entries(LENSES)) {
      await page.evaluate((L) => {
        const r = window.__game.rig;
        r.street = { ...L, floor: r.street.floor };
      }, L);
      // (two seconds of game time: the rig, the bus's bob and whatever streamed in settle)
      await page.evaluate(() => new Promise((res) => { const g = window.__game, t0 = g.clock(); const tick = () => (g.clock() - t0 >= 2 ? res(null) : requestAnimationFrame(tick)); tick(); }));
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000 });
      const file = `${s.name}-${h.name}-${lens}.png`;
      await page.screenshot({ path: `${out}/${file}` });
      const st = await page.evaluate(() => { const g = window.__game, f = g.flight, p = g.perf; return { overRoad: +(f.y - g.city.groundAt(f.x, f.z)).toFixed(2), calls: p.calls, tris: p.tris }; });
      rows.push({ street: s.name, hour: h.name, lens, file, ...st });
      console.log(file, JSON.stringify(st));
    }
    await page.close();
  }
}
writeFileSync(`${out}/stills.json`, JSON.stringify({ streets, hours, rows }, null, 1));
await browser.close();
