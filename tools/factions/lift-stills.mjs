#!/usr/bin/env node
// The Lift's stills for the phone (docs/specs/factions/LIFT.md): ?lift&lifted on Alamo Square, five views at noon and at golden hour on 2026-11-06
// over San Francisco (the sun at its highest, 36 degrees, and at 7 degrees setting), then a contact sheet (tools/sky/sheet.py). Real time on a
// real GPU, not --det: each view waits on the game clock (the wave's start, __game.lift.waveAt), so a slow machine gets the same moments.
//   lift-under  from the street under the Painted Ladies, looking up at their bellies (__qa.camAt, the vista's 38-degree lens)
//   lift-low    the bus at 30 m under the south end of the row, the real rig in its low shot
//   lift-mid    the start pose's chase camera 1.6 s into the wave: the ring round the park up, its front jumping
//   lift-250    the bus climbed to 250 m over the ground from 400 m out on the sun's side: the whole neighbourhood floating over its shadows
//   lift-1k     the same to 1 km, from 900 m out
// Each frame's draws and triangles (__game.perf) and the lift's state go to stills.json.
//   node tools/factions/lift-stills.mjs <url> <outDir> [--views=under,low,mid,250,1k] [--skies=noon,golden]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const base = pos[0] ?? 'http://127.0.0.1:4179/';
const out = resolve(pos[1] ?? 'shots/tmp/lift-stills');
const views = (opt.views ?? 'under,low,mid,250,1k').split(',');
const SKIES = { noon: '2026-11-06T20:49:00Z', golden: '2026-11-07T00:22:00Z' };
const skies = (opt.skies ?? 'noon,golden').split(',');
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ ...browserOptions([]) });
const stats = {};

async function open(q) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(base + q, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await page.evaluate(() => (window.__qa = {}));
  await page.waitForFunction(() => window.__game.lift && window.__game.lift.waveAt > 0, null, { timeout: 240000, polling: 100 });
  return page;
}
const at = (page, t) => page.waitForFunction((t) => window.__game.splatter.clock >= t, t, { timeout: 240000, polling: 50 });
const clock = (page) => page.evaluate(() => window.__game.splatter.clock);
async function shot(page, name) {
  // (the frame held where it is, so the screenshot is one frame)
  await page.evaluate(() => (window.__qa.holdAt = window.__game.splatter.clock));
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 30000 });
  stats[name] = await page.evaluate(() => {
    const g = window.__game, l = g.lift;
    return { clock: +g.splatter.clock.toFixed(2), waveAt: +l.waveAt.toFixed(2), up: l.up, held: l.stats.held, capsTris: l.stats.capsTris, calls: g.perf.calls, tris: g.perf.tris, busY: +g.flight.y.toFixed(1), busH: +g.flight.height.toFixed(1), low: +g.rig.openingLow.toFixed(2) };
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, JSON.stringify(stats[name]));
}
for (const sky of skies) {
  const q0 = `?lift&lifted&skipintro&nohud&t=${SKIES[sky]}&rate=0`;
  for (const v of views) {
    const name = `${sky}-lift-${v}`;
    try {
      if (v === 'under') {
        const page = await open(`${q0}&lat=37.77620&lon=-122.43300&heading=0`);
        const w = await page.evaluate(() => window.__game.lift.waveAt);
        await at(page, w + 6);
        await page.evaluate(() => {
          window.__qa.camAt = { lat: 37.7762, lon: -122.433, h: 2.5, lookLat: 37.7762, lookLon: -122.43262, lookH: 46, hfov: 38 };
          const g = window.__game, f = g.flight;
          window.__qa.pin = { x: f.x, y: g.city.groundAt(f.x, f.z) + 14, z: f.z, heading: 0 };
        });
        await at(page, (await clock(page)) + 0.4);
        await shot(page, name);
        await page.close();
      } else if (v === 'low') {
        const page = await open(`${q0}&lat=37.77585&lon=-122.43264&heading=0`);
        const w = await page.evaluate(() => window.__game.lift.waveAt);
        await at(page, w + 3);
        await page.evaluate(() => {
          const g = window.__game, f = g.flight;
          window.__qa.pin = { x: f.x, y: g.city.groundAt(f.x, f.z) + 30, z: f.z, heading: 0 };
        });
        await at(page, w + 6);
        await shot(page, name);
        await page.close();
      } else if (v === 'mid') {
        const page = await open(q0);
        const w = await page.evaluate(() => window.__game.lift.waveAt);
        await at(page, w + 1.6);
        await shot(page, name);
        await page.close();
      } else if (v === '250' || v === '1k') {
        const [out0, h] = v === '250' ? [400, 250] : [900, 1000];
        // (placed out on the sun's side by the Lift's own rule, through ?lat=&lon=: a first page reads where that is)
        const probe = await open(q0);
        const ll = await probe.evaluate((d) => {
          // (the start pose faces in, away from the sun: the sun's ground direction is its heading turned round)
          const g = window.__game, h = g.flight.heading;
          return g.lift.startFor(-Math.sin(h), Math.cos(h), d);
        }, out0);
        await probe.close();
        const page = await open(q0);
        await page.evaluate((s) => {
          const f = window.__game.flight;
          f.x = s.x;
          f.z = s.z;
          f.heading = s.heading;
        }, ll);
        await page.evaluate(() => Object.assign(window.__qa, { sx: 0, sy: -1 }));
        await page.waitForFunction((h) => window.__game.flight.height >= h, h, { timeout: 300000, polling: 100 });
        await page.evaluate(() => {
          delete window.__qa.sx;
          delete window.__qa.sy;
        });
        await at(page, (await clock(page)) + 2);
        await shot(page, name);
        await page.close();
      }
    } catch (e) {
      console.log(name, 'failed:', String(e).slice(0, 300));
    }
  }
}
await browser.close();
writeFileSync(`${out}/stills.json`, JSON.stringify(stats, null, 1));
const files = skies.flatMap((s) => views.map((v) => `${out}/${s}-lift-${v}.png`));
const r = spawnSync('python', ['-I', `${root}/tools/sky/sheet.py`, `${out}/sheet.png`, ...files], { encoding: 'utf8' });
console.log(r.status === 0 ? `sheet: ${out}/sheet.png` : `sheet failed: ${r.stderr || r.stdout}`);
