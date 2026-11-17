#!/usr/bin/env node
// The Alamo Square before/after (exp/ladies): the same posed lenses on two builds, frozen once the city has settled.
//   node tools/ladies/shots.mjs <url> <outdir> [--only=postcard,roofs] [--paint]
// Each pose places the lens through the QA hook (window.__qa.camAt: a place over the ground looking at another) with the bus pinned behind the lens,
// out of the frame, at 2:30 pm on 2026-11-07 with the clock standing. 640 x 420 CSS at deviceScaleFactor 2, 400 game pixels across.
// --paint: before the shot, the game's own splats (Splatter.barf, 85 m) twice on a 110 m grid within `paint` m of what the lens looks at, each spot's
// hue the same on every build (the splatter's next hue set by its place in the grid): buildings, trees and ground take it as a player's paint does.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [url = 'http://127.0.0.1:4173/', out = 'shots/tmp/ladies'] = pos;
mkdirSync(out, { recursive: true });

// lens (lat, lon, h m over its ground) looking at (lat, lon, lookH m over that ground), horizontal field of view
export const POSES = [
  { name: 'postcard', lat: 37.7762, lon: -122.43345, h: 17, lookLat: 37.77622, lookLon: -122.4326, lookH: 10, hfov: 60, paint: 130 },
  { name: 'roofs', lat: 37.7738, lon: -122.4385, h: 170, lookLat: 37.7772, lookLon: -122.4318, lookH: 0, hfov: 58, paint: 280 },
  { name: 'overhead', lat: 37.7745, lon: -122.4312, h: 300, lookLat: 37.7756, lookLon: -122.4300, lookH: 0, hfov: 52, paint: 260 },
  { name: 'street', lat: 37.77566, lon: -122.43257, h: 18, lookLat: 37.77605, lookLon: -122.42962, lookH: 3, hfov: 62, paint: 200 },
].filter((p) => !opt.only || opt.only.split(',').includes(p.name));
const Q = '&skipintro&nohud&t=2026-11-07T22:30:00Z&rate=0&fixeddt=0.0333333&px=400';

const browser = await chromium.launch(browserOptions([]));
const log = {};
try {
  for (const p of POSES) {
    const t0 = Date.now();
    const ctx = await browser.newContext({ viewport: { width: 640, height: 420 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}?lat=${p.lat}&lon=${p.lon}&heading=0${Q}`);
    await page.waitForFunction(() => window.__shotReady === true && !!window.__game?.flight, null, { timeout: 240000, polling: 200 });
    const settle = () =>
      page.evaluate(
        () =>
          new Promise((res, rej) => {
            const g = window.__game, t0 = performance.now();
            let quiet = 0;
            const tick = () => {
              quiet = !g.city.busy && g.city.ground.queued === 0 ? quiet + 1 : 0;
              if (quiet >= 30) res(null);
              else if (performance.now() - t0 > 400000) rej(new Error('the city never settled'));
              else requestAnimationFrame(tick);
            };
            tick();
          }),
      );
    const frames = (k) => page.evaluate((k) => new Promise((res) => requestAnimationFrame(function f() { if (--k > 0) requestAnimationFrame(f); else res(null); })), k);
    await page.evaluate((p) => {
      const g = window.__game, f = g.flight;
      // (the bus 80 m behind the lens and 40 m over it: out of the frame, its shadow too)
      const M = 111320, ml = M * Math.cos((p.lat * Math.PI) / 180);
      const dx = (p.lookLon - p.lon) * ml, dz = -(p.lookLat - p.lat) * M, d = Math.hypot(dx, dz) || 1;
      const x = f.x - (dx / d) * 80, z = f.z - (dz / d) * 80;
      window.__lad = {
        pin: { x, y: g.city.groundAt(f.x, f.z) + p.h + 40, z, heading: f.heading },
        camAt: { lat: p.lat, lon: p.lon, h: p.h, lookLat: p.lookLat, lookLon: p.lookLon, lookH: p.lookH, hfov: p.hfov },
      };
      window.__ladStart = { x: f.x, z: f.z };
      window.__qa = { ...window.__lad };
    }, p);
    await frames(60);
    await settle();
    if (opt.paint) {
      const n = await page.evaluate((p) => {
        const g = window.__game, sp = g.splatter;
        const M = 111320, ml = M * Math.cos((p.lat * Math.PI) / 180);
        // (the bus's start is the lens's own place: the look target from it)
        const s0 = window.__ladStart;
        const tx = s0.x + (p.lookLon - p.lon) * ml, tz = s0.z - (p.lookLat - p.lat) * M;
        let k = 0;
        for (let i = -4; i <= 4; i++)
          for (let j = -4; j <= 4; j++) {
            const x = tx + i * 110 + (j % 2) * 55, z = tz + j * 95;
            if (Math.hypot(x - tx, z - tz) > p.paint) continue;
            for (let rep = 0; rep < 2; rep++) {
              // (red, green, blue, violet: not yellow or orange, the bus's own, as ogshot.mjs)
              sp.nextHue = [0, 3, 4, 5][k % 4];
              sp.barf(x, z, { travel: 0.05 + 0.02 * k, radius: 85, drop: 60 });
            }
            k++;
          }
        return k;
      }, p);
      console.log(p.name, 'painted', n, 'spots');
      await frames(150);
      await settle();
    }
    await frames(30);
    await settle();
    await page.evaluate(() => (window.__qa = { ...window.__lad, holdFrames: 4, held: false }));
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 120000, polling: 50 });
    const stats = await page.evaluate(() => {
      const s = window.__stats ?? window.__game.perf?.snapshot?.();
      return s ? { calls: s.calls, triangles: s.triangles } : null;
    });
    await page.locator('canvas').first().screenshot({ path: `${out}/${p.name}.png` });
    log[p.name] = { s: Math.round((Date.now() - t0) / 1000), stats, errors };
    console.log(p.name, log[p.name].s, 's', JSON.stringify(stats), errors.length ? errors : '');
    await ctx.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/shots.json`, JSON.stringify(log, null, 1));
}
