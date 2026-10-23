#!/usr/bin/env node
// Visual A/B of two builds: the same views frozen at the same game time on a
// fixed step (?fixeddt), with Math.random seeded and the camera pinned to a
// fixed chase pose per view (the bus's terrain following depends on when tiles
// stream in, and the chase camera would carry that into a one-pixel shift of
// the whole frame), so a pixel that differs is a real difference (shadows,
// wobble, paint), not timing. The bus itself may sit a little apart.
//   node tools/ab-shots.mjs <baseUrlA> <baseUrlB> <outDir> [views...]
// views: grey (Painted Ladies, grey), painted (the Ladies row after blasts, walls
// wobbling), fidi (downtown towers and their rooftop boxes' shadows), soma, d250 (a climb to ~250 m).
// Writes <view>-A.png, <view>-B.png; then run
//   python3 -I tools/ab-diff.py <outDir> <view>...   (diff image + changed-pixel count)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [A, B, out = 'shots/ab', ...want] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const STEP = 1 / 30;
// cam: the pinned chase pose (look point lat/lon, compass heading, distance, elevation deg, height of
// the look point above the ground)
const VIEWS = {
  grey: { q: '?lat=37.77628&lon=-122.4352&heading=88&skipintro', drift: 6, hold: 3, cam: { lat: 37.7762, lon: -122.4336, heading: 88, dist: 175, elev: 31, up: 12 } },
  painted: {
    q: '?lat=37.77615&lon=-122.4340&heading=88&skipintro',
    drift: 6,
    barfs: [37.7754, 37.7758, 37.7762, 37.7766, 37.777].map((lat, i) => ({ t: 1.5 + i * 1.3, lat, lon: -122.43262 })),
    hold: 10.5,
    cam: { lat: 37.7761, lon: -122.4339, heading: 88, dist: 120, elev: 24, up: 8 },
  },
  fidi: { q: '?lat=37.7925&lon=-122.4010&heading=0&skipintro', drift: 6, hold: 3, cam: { lat: 37.7935, lon: -122.4010, heading: 0, dist: 175, elev: 31, up: 20 } },
  soma: { q: '?lat=37.782&lon=-122.399&heading=330&skipintro', drift: 6, hold: 3, cam: { lat: 37.7832, lon: -122.3998, heading: 330, dist: 175, elev: 31, up: 20 } },
  // from altitude the vista lens follows the climb, so this one isn't pinned (the climb is the same in game time)
  d250: { q: '?lat=37.7700&lon=-122.4300&heading=45&skipintro', climb: [1, 7.5], hold: 14 },
};
const views = want.length ? want : Object.keys(VIEWS);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});

async function shoot(base, name, v, file) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('strugglebus.')) localStorage.removeItem(k);
    let s = 987654321;
    Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  });
  await page.goto(base + v.q + `&fixeddt=${STEP}`, { waitUntil: 'load' });
  if (v.cam)
    await page.waitForFunction(() => !!(window.__game && window.__game.rig), null, { timeout: 300000 }).then(() =>
      page.evaluate((c) => {
        const g = window.__game;
        const [lat0, lon0] = g.city.manifest.origin;
        const tx = (c.lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
        const tz = -(c.lat - lat0) * 110574;
        const h = (c.heading * Math.PI) / 180;
        const fx = Math.sin(h), fz = -Math.cos(h);
        const e = (c.elev * Math.PI) / 180;
        const orig = g.rig.update.bind(g.rig);
        g.rig.update = (camera, focus, flight, dt) => {
          orig(camera, focus, flight, dt);
          const ty = g.city.groundAt(tx, tz) + c.up;
          focus.set(tx, ty, tz);
          camera.position.set(tx - fx * c.dist * Math.cos(e), ty + c.dist * Math.sin(e), tz - fz * c.dist * Math.cos(e));
          camera.up.set(0, 1, 0);
          camera.lookAt(tx, ty, tz);
        };
      }, v.cam),
    );
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  // the blast's first hue and its seed: a build that constructs a few more three.js objects at load
  // draws a few more UUIDs from Math.random, which would shift them (different hues, not a rendering change)
  await page.evaluate(() => {
    const sp = window.__game.splatter;
    sp.nextHue = 0;
    sp.seed = 0x5eed1234;
  });
  const holdAt = (t) =>
    page.evaluate((t) => {
      window.__qa = window.__qa ?? {};
      window.__qa.held = false;
      window.__qa.holdAt = t;
    }, t);
  const waitHeld = () => page.waitForFunction(() => window.__qa && window.__qa.held === true, null, { timeout: 600000, polling: 200 });
  const release = () => page.evaluate(() => ((window.__qa.holdAt = undefined), (window.__qa.held = false)));
  // events at fixed game times: hold on the frame, act, release
  const events = [];
  if (v.drift) events.push({ t: 0, fn: () => page.evaluate((d) => (window.__game.flight.glideSpeed = d), v.drift) });
  if (v.climb) {
    events.push({ t: v.climb[0], fn: () => page.evaluate(() => Object.assign(window.__qa, { sx: 0, sy: -1 })) });
    events.push({ t: v.climb[1], fn: () => page.evaluate(() => (delete window.__qa.sx, delete window.__qa.sy)) });
  }
  for (const b of v.barfs ?? []) events.push({ t: b.t, fn: () => page.evaluate(([la, lo]) => window.__game.barfAtLatLon(la, lo), [b.lat, b.lon]) });
  events.sort((a, b) => a.t - b.t);
  for (const e of events) {
    await holdAt(e.t);
    await waitHeld();
    await e.fn();
    await release();
  }
  await holdAt(v.hold);
  await waitHeld();
  await page.waitForTimeout(400);
  const clock = await page.evaluate(() => window.__game.clock());
  await page.screenshot({ path: file });
  console.log('shot', name, file, clock.toFixed(3));
  await page.close();
}

for (const name of views) {
  const v = VIEWS[name];
  await shoot(A, name, v, `${out}/${name}-A.png`);
  await shoot(B, name, v, `${out}/${name}-B.png`);
}
await browser.close();
