#!/usr/bin/env node
// Frames of ?moon at set poses, in one browser, closed at the end. A frame is 393 x 852 game pixels, one PNG pixel each.
//   node tools/moon/shots.mjs <out dir> <name=h,x,z,heading[,pitch]> ... [--q=site=TYCHO] [--stats]
// h: height over the ground (m). x, z: the map (m; `s` = the start). heading in degrees (`s` = the start). 0 height: the bus as it boots, on the floor, skimming.
// BASE is the page (http://localhost:4179/). Draws and triangles (--stats) are the whole frame, sun pass and post included.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opts = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [out, ...specs] = args.filter((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text().slice(0, 700)}`);
  });
  page.on('pageerror', (e) => {
    bad++;
    console.log('  [pageerror]', e.message);
  });
  const url = `${BASE}?moon&fixeddt=0.0333&nohud${opts.q ? '&' + opts.q : ''}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 180000 });
  console.log('ready after', Date.now() - t0, 'ms');
  // (draws and triangles over the frame's passes)
  await page.evaluate(() => {
    const g = window.__game, info = g.pipeline.renderer.info;
    info.autoReset = false;
    const f = g.perf.frame.bind(g.perf);
    window.__stats = { calls: 0, triangles: 0, points: 0 };
    g.perf.frame = (a, b) => {
      window.__stats = { calls: info.render.calls, triangles: info.render.triangles, points: info.render.points };
      info.reset();
      f(a, b);
    };
  });
  for (const spec of specs) {
    const i = spec.indexOf('=');
    const name = spec.slice(0, i), [hs, xs, zs, hd, pitch] = spec.slice(i + 1).split(',');
    await page.evaluate(
      ({ hs, xs, zs, hd, pitch }) => {
        const g = window.__game, f = g.flight, r = g.rig, st = g.moon.manifest.start;
        const h = Number(hs);
        f.x = xs === 's' || xs === undefined ? st.x : Number(xs);
        f.z = zs === 's' || zs === undefined ? st.z : Number(zs);
        f.heading = hd === 's' || hd === undefined ? st.heading : (Number(hd) * Math.PI) / 180;
        f.yawRate = 0;
        const gy = g.city.groundAt(f.x, f.z);
        f.speed = 26;
        f.vy = 0;
        if (h > 0) {
          f.y = gy + h;
          f.holdY = f.y;
          f.mode = 1;
          f.height = h;
          f.groundBroad = gy;
          f.lift = h;
          const C = g.config.camera, t = Math.min(1, Math.max(0, (h - C.vistaStart) / (C.vistaFull - C.vistaStart))), v = t * t * (3 - 2 * t);
          r.vista = r.vistaTarget = v;
          r.lensHeight = r.lensTarget = h;
        } else {
          f.y = gy + 12;
          f.holdY = -Infinity;
          r.vista = r.vistaTarget = 0;
          r.lensHeight = r.lensTarget = 0;
        }
        // (the camera starts again from where it should be)
        r.pos.set(0, 0, 0);
        r.posVel.set(0, 0, 0);
        r.look.set(0, 0, 0);
        r.yaw = f.heading;
        r.yawVel = 0;
        window.__shotReady = false;
        window.__pitchOverride = pitch === undefined ? null : Number(pitch);
      },
      { hs, xs, zs, hd, pitch },
    );
    await page.waitForTimeout(600);
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 }).catch(() => {
      bad++;
      console.log('  [warn] never settled:', name);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `${name}.png`) });
    const info = await page.evaluate(() => {
      const g = window.__game, f = g.flight;
      return { x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z), ground: Math.round(g.city.groundAt(f.x, f.z)), height: Math.round(f.y - g.city.groundAt(f.x, f.z)), ...window.__stats, patches: g.moon.far.patchCount, tiles: g.city.loadedRegionCount() };
    });
    console.log(name, JSON.stringify(info));
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
