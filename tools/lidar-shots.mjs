#!/usr/bin/env node
// Downtown massing shots (LiDAR tiers), from the real game.
//   node tools/lidar-shots.mjs <baseUrl> <outDir> [--city=sf] [--only=fidi,salesforce] [--paint]
// chase-*.png: the gameplay chase camera over SoMa / FiDi / Rincon.
// hero-*.png:  a fixed telephoto vista on one tower (the rig is overridden for
//              the shot only), so ?city=sf_before vs sf pairs line up exactly.
// --paint:     barf on each hero tower through the real splat pipeline and
//              shoot it again once the color has flooded down the whole tower.
// perf.json:   renderer stats per view (draw calls, triangles, CPU workMs).
// SwiftShader renders ~1.5 fps: everything waits on the game clock.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const base = pos[0] ?? 'http://127.0.0.1:4302/';
const out = pos[1] ?? 'shots/lidar';
const city = opt.city ?? 'sf';
const only = opt.only ? new Set(opt.only.split(',')) : null;
mkdirSync(out, { recursive: true });

const CHASE = [
  { name: 'soma', lat: 37.782, lon: -122.399, heading: 330 },
  { name: 'fidi', lat: 37.7925, lon: -122.401, heading: 0 },
  { name: 'rincon', lat: 37.788, lon: -122.39, heading: 300 },
];
// target (tower base lat/lon, look height), camera azimuth from the target (deg, compass), distance, camera height
const HERO = [
  { name: 'salesforce', lat: 37.78977, lon: -122.39676, look: 150, az: 200, dist: 760, camY: 210 },
  { name: '181fremont', lat: 37.78970, lon: -122.39520, look: 110, az: 125, dist: 620, camY: 170 },
  { name: '555california', lat: 37.79210, lon: -122.40370, look: 110, az: 215, dist: 620, camY: 170 },
  { name: 'embarcadero', lat: 37.79520, lon: -122.39720, look: 70, az: 25, dist: 620, camY: 140 },
  // review cases: towers on podiums (collapsed to their podium once), lots under a tower the footprints lack
  { name: 'onerincon', lat: 37.78599, lon: -122.39226, look: 100, az: 300, dist: 650, camY: 160 },
  { name: 'millennium', lat: 37.79048, lon: -122.39596, look: 100, az: 160, dist: 650, camY: 160 },
  { name: 'beale', lat: 37.7904, lon: -122.3945, look: 90, az: 220, dist: 600, camY: 150 },
  { name: 'mission1550', lat: 37.77369, lon: -122.41838, look: 60, az: 30, dist: 500, camY: 120 },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const perf = {};

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  return page;
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

async function settle(page) {
  // let streaming finish (regions + detail upgrades), then a couple of frames
  await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 300000 });
  await runFor(page, 1.2);
  await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 300000 });
  await runFor(page, 1.2);
}

const snap = (page) => page.evaluate(() => window.__stats ?? null);

for (const v of CHASE) {
  if (only && !only.has(v.name)) continue;
  const page = await open(`?city=${city}&lat=${v.lat}&lon=${v.lon}&heading=${v.heading}&skipintro`);
  await page.evaluate(() => (window.__qa = { sx: 0, sy: -0.6 }));
  await runFor(page, 2.5);
  await settle(page);
  await page.screenshot({ path: `${out}/chase-${v.name}.png` });
  perf[`chase-${v.name}`] = await snap(page);
  await page.close();
  console.log('saved', `${out}/chase-${v.name}.png`, JSON.stringify(perf[`chase-${v.name}`]));
}

for (const v of HERO) {
  if (only && !only.has(v.name)) continue;
  const page = await open(`?city=${city}&lat=${v.lat}&lon=${v.lon}&heading=0&skipintro`);
  await page.evaluate((v) => {
    const g = window.__game;
    const [lat0, lon0] = g.city.manifest.origin;
    const tx = (v.lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
    const tz = -(v.lat - lat0) * 110574;
    const ty = g.city.groundAt(tx, tz) + v.look;
    const a = (v.az * Math.PI) / 180;
    const cx = tx + Math.sin(a) * v.dist, cz = tz - Math.cos(a) * v.dist;
    // park the bus behind the camera, hovering
    g.flight.x = tx + Math.sin(a) * (v.dist + 60);
    g.flight.z = tz - Math.cos(a) * (v.dist + 60);
    window.__qa = { sx: 0, sy: -1 };
    g.rig.update = (cam, focusOut) => {
      cam.position.set(cx, v.camY, cz);
      cam.up.set(0, 1, 0);
      cam.lookAt(tx, ty, tz);
      focusOut.set(tx, ty, tz);
    };
  }, v);
  await runFor(page, 1.5);
  await settle(page);
  await page.screenshot({ path: `${out}/hero-${v.name}.png` });
  perf[`hero-${v.name}`] = await snap(page);
  console.log('saved', `${out}/hero-${v.name}.png`);
  if (opt.paint) {
    await page.evaluate((v) => window.__game.barfAtLatLon(v.lat, v.lon), v);
    await runFor(page, 7.5); // the flood pours down ~55 m/s: let it reach the street
    await page.screenshot({ path: `${out}/hero-${v.name}-painted.png` });
    console.log('saved', `${out}/hero-${v.name}-painted.png`);
  }
  await page.close();
}

writeFileSync(`${out}/perf.json`, JSON.stringify(perf, null, 2));
await browser.close();
