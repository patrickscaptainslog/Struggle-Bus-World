#!/usr/bin/env node
// The Lift's stills for the phone (docs/specs/factions/LIFT.md): ?lift&lifted on Alamo Square, at noon and at golden hour on 2026-11-06 over San
// Francisco (the sun at its highest, 36 degrees, and at 7 degrees setting), for each faction asked for (&lifted=<key>: rainbow is &lifted, as it
// always was), then a contact sheet (tools/sky/sheet.py). Real time on a real GPU, not --det: each view waits on the game clock (the wave's start,
// __game.lift.waveAt), so a slow machine gets the same moments.
//   under   from the street under the Painted Ladies, looking up at their bellies (__qa.camAt, the vista's 38-degree lens)
//   low     the bus at 30 m under the south end of the row, the real rig in its low shot
//   mid     the start pose's chase camera 1.6 s into the wave: the ring round the park up, its front jumping
//   street  from the street about 200 m from the heart on the sun's side (Lift.skyEye), looking up at the houses and the faction's sky piece over the heart (45 degrees)
//   250     the bus climbed to 250 m over the ground from 400 m out on the sun's side: the whole neighbourhood floating over its shadows
//   1k      the same to 1 km, from 1,800 m out
//   gif     the street view's camera from half a second into the wave to 12 s (the piece forming, then moving), a frame each 0.25 s of game time
//           (Hyperglow's each 0.125 s, so its 0.09 s snaps show), into <faction>-motion.gif at one pixel a game pixel, played in real time
// Each frame's draws and triangles (__game.perf), the frame time over 90 frames before it (median and 95th, ms) and the lift's state go to
// stills.json. Exit 1 if a view failed or a page threw.
//   node tools/factions/lift-stills.mjs <url> <outDir> [--views=under,low,mid,street,250,1k] [--skies=noon,golden] [--factions=rainbow,atlantis,...]
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
const factions = (opt.factions ?? 'rainbow').split(',');
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const PY = process.env.SB_PYTHON || 'python';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ ...browserOptions([]) });
const stats = {};
let failed = 0;

async function open(q) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => {
    failed++;
    console.log('[pageerror]', e.message);
  });
  // (a shader that doesn't compile is a console error, not a page error: three.js logs it and draws nothing)
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // (a file the build doesn't have is the game's own business: it asks for optional ones)
    if (!m.text().startsWith('Failed to load resource')) failed++;
    console.log('[console error]', m.text().slice(0, 1500));
  });
  await page.goto(base + q, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await page.evaluate(() => (window.__qa = {}));
  await page.waitForFunction(() => window.__game.lift && window.__game.lift.waveAt > 0, null, { timeout: 240000, polling: 100 });
  return page;
}
const at = (page, t) => page.waitForFunction((t) => window.__game.splatter.clock >= t, t, { timeout: 240000, polling: 50 });
const clock = (page) => page.evaluate(() => window.__game.splatter.clock);
/** the wall clock's frames over n frames (ms): median and 95th */
const frames = (page, n = 90) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        const t = [];
        let last = performance.now();
        const step = (now) => {
          t.push(now - last);
          last = now;
          if (t.length < n) requestAnimationFrame(step);
          else {
            t.sort((a, b) => a - b);
            done({ p50: +t[Math.floor(n / 2)].toFixed(1), p95: +t[Math.floor(n * 0.95)].toFixed(1) });
          }
        };
        requestAnimationFrame(step);
      }),
    n,
  );
async function shot(page, name, file = `${out}/${name}.png`, quiet = false) {
  const ft = quiet ? null : await frames(page);
  // (the frame held where it is, so the screenshot is one frame)
  await page.evaluate(() => {
    window.__qa.held = false;
    window.__qa.holdAt = window.__game.splatter.clock;
  });
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 30000 });
  const s = await page.evaluate(() => {
    const g = window.__game, l = g.lift;
    return { clock: +g.splatter.clock.toFixed(2), waveAt: +l.waveAt.toFixed(2), up: l.up, held: l.stats.held, capsTris: l.stats.capsTris, skyTris: l.stats.skyTris, skyMs: l.stats.skyMs, calls: g.perf.calls, tris: g.perf.tris, busY: +g.flight.y.toFixed(1), busH: +g.flight.height.toFixed(1), low: +g.rig.openingLow.toFixed(2) };
  });
  if (ft) Object.assign(s, { frameP50: ft.p50, frameP95: ft.p95 });
  await page.screenshot({ path: file });
  if (!quiet) {
    stats[name] = s;
    console.log(name, JSON.stringify(s));
  }
  return s;
}
/** the street view's lens: about 200 m from the heart on the sun's side, 2.5 m over the ground, looking up at the sky piece */
async function streetCam(page) {
  await page.evaluate(() => {
    const g = window.__game, l = g.lift, h = g.flight.heading;
    // (about 200 m out on the sun's side, clear of the falls and the columns: Lift.skyEye)
    const [hx, hz] = l.heart;
    const [x, z] = l.skyEye(200);
    window.__qa.camAt = { x, z, h: 2.5, lookX: hx, lookZ: hz, lookH: 140, hfov: 45 };
    // (the bus held behind the lens, out of the frame)
    const bx = x - (hx - x) * 0.15, bz = z - (hz - z) * 0.15;
    window.__qa.pin = { x: bx, y: g.city.groundAt(bx, bz) + 3, z: bz, heading: Math.atan2(-(hx - x), hz - z) };
  });
}
for (const fac of factions) {
  for (const sky of skies) {
    const q0 = `?lift&lifted${fac === 'rainbow' ? '' : `=${fac}`}&skipintro&nohud&t=${SKIES[sky]}&rate=0`;
    for (const v of views) {
      if (v === 'gif' && sky !== skies[0]) continue;
      const name = `${fac}-${sky}-lift-${v}`;
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
        } else if (v === 'street' || v === 'gif') {
          const page = await open(q0);
          const w = await page.evaluate(() => window.__game.lift.waveAt);
          await streetCam(page);
          await at(page, w + 6.5);
          if (v === 'street') await shot(page, name);
          else {
            const dir = `${out}/${fac}-gif`;
            mkdirSync(dir, { recursive: true });
            const list = [];
            const step = fac === 'hyperglow' ? 0.125 : 0.25;
            for (let k = 0; k * step <= 11.5; k++) {
              const f = `${dir}/${String(k).padStart(2, '0')}.png`;
              await page.evaluate((t) => {
                window.__qa.held = false;
                window.__qa.holdAt = t;
              }, w + 0.5 + k * step);
              await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 60000 });
              await page.screenshot({ path: f });
              list.push(f);
            }
            const r = spawnSync(PY, ['-I', `${root}/tools/factions/gif.py`, `--ms=${step * 1000}`, `${out}/${fac}-motion.gif`, ...list], { encoding: 'utf8' });
            if (r.status !== 0) throw new Error(`gif.py: ${r.stderr || r.stdout}`);
            console.log(name, `${out}/${fac}-motion.gif`);
          }
          await page.close();
        } else if (v === '250' || v === '1k') {
          // (the 1 km climb flies about 900 m on: from 900 m out it ended over the neighbourhood, which sat on the frame's bottom edge)
          const [out0, h] = v === '250' ? [400, 250] : [1800, 1000];
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
        failed++;
        console.log(name, 'failed:', String(e).slice(0, 300));
      }
    }
  }
}
await browser.close();
writeFileSync(`${out}/stills.json`, JSON.stringify(stats, null, 1));
const files = factions.flatMap((f) => skies.flatMap((s) => views.filter((v) => v !== 'gif').map((v) => `${out}/${f}-${s}-lift-${v}.png`)));
// (sheet.py needs PIL: SB_PYTHON names a python that has it)
if (files.length) {
  const r = spawnSync(PY, ['-I', `${root}/tools/sky/sheet.py`, `${out}/sheet.png`, `--cols=${Math.min(files.length, views.filter((v) => v !== 'gif').length * skies.length)}`, '--w=393', ...files], { encoding: 'utf8' });
  console.log(r.status === 0 ? `sheet: ${out}/sheet.png` : `sheet failed: ${r.stderr || r.stdout}`);
}
console.log(failed ? `FAIL: ${failed} view(s) failed or threw` : 'stills: all taken');
process.exit(failed ? 1 : 0);
