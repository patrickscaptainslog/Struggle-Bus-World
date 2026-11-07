#!/usr/bin/env node
// Curb's stills (docs/specs/shots/CURB.md), ?life: on each street tools/streetcam/pick.ts chose (GEARS.md's four), at noon and at golden hour, the
// bus landed with two real flicks down (School Zone, then the street) and rolled a few seconds, through both lenses (the kerb chase, and
// &curblens=wide's ride-along, swapped in on the same roll), the live sky's clock pinned.
//   node tools/streetcam/curb-shots.mjs <baseUrl> <outDir> <streets.json> [--date=2026-11-06] [--roll=6]
// Writes <outDir>/<street>-<hour>-<lens>.png at 1179 x 2556 (393 x 852 at 3x, the phone's) and stills.json (the state, draws, triangles, frame
// time and the bus's height over the road at each). tools/streetcam/sheet.py makes the contact sheet (its lens names are chase and wide).
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { browserOptions } from '../browser.mjs';
import { flick } from '../flick.mjs';

const args = process.argv.slice(2);
const [base, out, list] = args.filter((a) => !a.startsWith('--'));
const date = (args.find((a) => a.startsWith('--date=')) ?? '--date=2026-11-06').slice(7);
const roll = Number((args.find((a) => a.startsWith('--roll=')) ?? '--roll=6').slice(7));
mkdirSync(out, { recursive: true });
const streets = JSON.parse(readFileSync(list, 'utf8')).filter((s) => !s.none);
// (San Francisco's clock, UTC: noon is 20:00, golden hour 40 minutes before a November sunset at about 16:59)
const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const hours = [
  { name: 'noon', t: `${date}T20:00:00Z` },
  { name: 'golden', t: `${next}T00:20:00Z` },
];
const WIDE = { back: 16, eye: 3.2, ahead: 60, at: 3, fov: 58 };

const browser = await chromium.launch(browserOptions());
const rows = [];
const runFor = (page, s) => page.evaluate((s) => new Promise((res) => { const g = window.__game, t0 = g.clock(); const tick = () => (g.clock() - t0 >= s ? res(null) : requestAnimationFrame(tick)); tick(); }), s);
const state = (page) => page.evaluate(() => {
  const g = window.__game, f = g.flight, p = g.perf.snapshot();
  return { state: g.curb?.state, name: g.controls.turbo.name, overRoad: +(f.y - g.city.groundAt(f.x, f.z)).toFixed(2), speed: +f.speed.toFixed(1), beside: g.life?.curb.beside ?? null, cam: +g.rig.distance.toFixed(1), calls: p.calls, tris: p.triangles, frameMs: p.frameMs };
});
for (const s of streets) {
  for (const h of hours) {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    const cdp = await page.context().newCDPSession(page);
    const url = `${base}?lat=${s.lat}&lon=${s.lon}&heading=${s.heading}&skipintro&life&fixeddt=0.05&t=${h.t}&rate=0`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 240000 });
    await page.evaluate(() => { window.__game.flight.glideSpeed = 0; });
    await runFor(page, 2);
    await flick(cdp, -1);
    await runFor(page, 3);
    await flick(cdp, -1);
    await runFor(page, roll);
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000 });
    for (const lens of ['chase', 'wide']) {
      if (lens === 'wide') {
        await page.evaluate((L) => { window.__game.rig.curbLens = L; }, WIDE);
        await runFor(page, 2);
      }
      const file = `${s.name}-${h.name}-${lens}.png`;
      await page.screenshot({ path: `${out}/${file}` });
      const st = await state(page);
      rows.push({ street: s.name, hour: h.name, lens, file, ...st });
      console.log(file, JSON.stringify(st));
    }
    await page.close();
  }
}
writeFileSync(`${out}/stills.json`, JSON.stringify({ streets, hours, rows }, null, 1));
await browser.close();
