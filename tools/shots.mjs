#!/usr/bin/env node
// Scripted beauty shots from the real game (index.html), iPhone 15 viewport.
//   node tools/shots.mjs [baseUrl] [outDir] [--det] [--views=grey,painted,...] [--q=farmap&farfade]
// Produces: grey.png (grey city from the gameplay camera), painted.png (a
// painted block after a few splats), opening.png (the Golden Gate opening),
// and stats.json (renderer stats; SwiftShader fps is NOT representative).
// --det: repeatable frames, for an image diff between two builds (python -I
// tools/shotdiff.py <dirA> <dirB>): ?fixeddt, a seeded Math.random, the game
// clock held while streaming and paint settle, the same frames from any build
// (also fidi, soma, high: a climb to ~250 m, ceiling: ~500 m, swap: painted towers
// through a climb to coarse and a dive back to detail; asked for by name, the far-field poses at the ceiling:
// sunset, presidio, marin, sunward, into the sun, westward, into it over the city; london, amsterdam).
// --q: appended to every view's query (the flags under test).
// --seq (with --det): five more frames after each view's shot, one fixed step apart (<name>-seq-0.png is the shot itself, then 1..5): a
// burst from the same camera on any build, so tools/far/bandflip.py's crawl can be compared between two builds.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const base = pos[0] ?? 'http://127.0.0.1:5173/';
const out = pos[1] ?? 'shots';
const det = 'det' in opt;
mkdirSync(out, { recursive: true });

// (PW_WS: connect to a running tools/pw-server.mjs instead of launching a browser)
const browser = process.env.PW_WS ? await chromium.connect(process.env.PW_WS, { timeout: 60000 }) : await chromium.launch({
  ...browserOptions([]),
});
const stats = {};

const STEP = 1 / 30;

async function open(query) {
  if (opt.q) query += `&${opt.q}`;
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  if (det) {
    await page.addInitScript(() => {
      // Math.random reseeded from the game clock on every frame, and again after the streaming step: a
      // build that makes a few more three.js objects (each draws UUID randoms) can't shift hues or particles
      let s = 1;
      let g = null;
      const seed = () => (s = 1 + ((987654321 + (g ? Math.round(g.clock() * 30) : 0) * 48271) % 2147483646));
      Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((t) => (seed(), cb(t)));
      // the game clock stands from the first frame (frames run at dt 0, as under iOS's motion sheet): the city
      // streams in with the bus still at its spawn
      Object.defineProperty(window, '__game', {
        configurable: true,
        get: () => g,
        set: (v) => {
          g = v;
          v.controls.tilt.status = 'requesting';
          // (while it runs, the clock stands whenever regions are on their way: streaming lands at the same game
          // time on any machine, and a query that fell back to the far grid here can't move the camera a hair)
          const update = v.city.update;
          v.city.update = function (...a) {
            update.apply(this, a);
            seed();
            if (window.__detRunning) v.controls.tilt.status = this.busy ? 'requesting' : 'off';
          };
        },
      });
    });
    query += `&fixeddt=${STEP}`;
  }
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  if (det) await settle(page);
  if (det)
    await page.evaluate(() => {
      window.__qa = {};
      const g = window.__game;
      g.splatter.nextHue = 0;
      g.splatter.seed = 0x5eed1234;
      // (what the first steps remember of how the city arrived: both take the settled ground from here, at the spawn)
      g.flight.floorRise = NaN;
      g.flight.groundBroad = NaN;
      return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
    });
  return page;
}

// --det: the clock runs to exactly `seconds` later (frame-exact on the fixed step), then stands again
async function runDet(page, seconds) {
  await page.evaluate((s) => {
    const g = window.__game;
    window.__qa.held = false;
    window.__qa.holdAt = g.clock() + s;
    g.controls.tilt.status = 'off';
    window.__detRunning = true;
  }, seconds);
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 300000, polling: 50 });
  await page.evaluate(() => {
    window.__detRunning = false;
    window.__game.controls.tilt.status = 'requesting';
    window.__qa.holdAt = undefined;
    window.__qa.held = false;
  });
}

// --det: with the clock standing, streaming and the ground paint finish (quiet for 30 frames in a row: a region's
// next batch is only asked for a frame after the last one lands), then a few frames
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((res) => {
        const g = window.__game;
        let quiet = 0;
        const tick = () => {
          quiet = !g.city.busy && g.city.ground.queued === 0 ? quiet + 1 : 0;
          if (quiet >= 30) res(null);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  await page.waitForTimeout(200);
}

// let the game run for `seconds` of simulated time (SwiftShader is slow; we
// wait on the game's own clock instead of wall time)
async function runFor(page, seconds) {
  const t0 = await page.evaluate(() => window.__game.flight && performance.now());
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
  return t0;
}

// A slow drift at the rooftops (the thumb's down-stretch is the yoke's climb
// now, so the shots slow the bus with the opening's glide speed instead; same
// speeds as the old hover stretch: -0.45 -> 19.2 m/s, -1 -> 6 m/s).
const drift = (page, speed) => page.evaluate((v) => ((window.__qa = null), (window.__game.flight.glideSpeed = v)), speed);

const views = new Set((opt.views ?? (det ? 'grey,painted,opening,fidi,soma,high,ceiling,swap' : 'grey,painted,opening')).split(','));

async function detShot(name, query, script) {
  if (!views.has(name)) return;
  const page = await open(query);
  await script(page);
  await settle(page);
  // (tree levels of detail tick on the game clock: what streamed in while it stood takes its level now)
  await runDet(page, 0.3);
  await settle(page);
  await page.screenshot({ path: `${out}/${name}.png` });
  if ('seq' in opt) {
    await page.screenshot({ path: `${out}/${name}-seq-0.png` });
    for (let i = 1; i <= 5; i++) {
      await runDet(page, STEP);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/${name}-seq-${i}.png` });
    }
  }
  stats[name] = await page.evaluate(() => {
    const r = window.__game.pipeline.renderer.info;
    const g = window.__game, f = g.flight, p = g.pipeline;
    return { clock: g.clock(), y: f.y, x: f.x, z: f.z, heading: f.heading, groundBroad: f.groundBroad, cam: g.camera.position.toArray(), focus: p.focus.toArray(), sub: p.subPixel.toArray(), snapLevel: p.snapLevel, regions: g.city.regionsLoaded.size, tiles: g.city.tiles.size, lods: [...g.city.regionLod.entries()].sort().join(' '), maskSum: g.city.loadedMask.image.data.reduce((a, b) => a + b, 0) };
  });
  await page.close();
  console.log('shot', name);
}

if (det) {
  const glide = (page, v) => page.evaluate((s) => (window.__game.flight.glideSpeed = s), v);
  const stick = (page, sy) => page.evaluate((v) => Object.assign(window.__qa, { sx: 0, sy: v }), sy);
  await detShot('grey', '?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud', async (p) => {
    await glide(p, 19.2);
    await runDet(p, 3);
  });
  await detShot('painted', '?lat=37.77615&lon=-122.4340&heading=88&skipintro&nohud', async (p) => {
    await glide(p, 6);
    await runDet(p, 2);
    for (const lat of [37.7754, 37.7758, 37.7762, 37.7766, 37.777, 37.7762, 37.7758]) {
      await p.evaluate((la) => window.__game.barfAtLatLon(la, -122.43262), lat);
      await runDet(p, 1.3);
    }
    await runDet(p, 2.5);
  });
  await detShot('opening', '?openingshot&nohud', (p) => runDet(p, 4.5));
  await detShot('fidi', '?lat=37.7925&lon=-122.4010&heading=0&skipintro&nohud', async (p) => {
    await glide(p, 19.2);
    await runDet(p, 3);
  });
  await detShot('soma', '?lat=37.782&lon=-122.399&heading=330&skipintro&nohud', async (p) => {
    await glide(p, 19.2);
    await runDet(p, 3);
  });
  await detShot('high', '?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud', async (p) => {
    await runDet(p, 1);
    await stick(p, -1);
    await runDet(p, 6.5);
    await p.evaluate(() => (delete window.__qa.sx, delete window.__qa.sy));
    await runDet(p, 1);
  });
  await detShot('ceiling', '?lat=37.7925&lon=-122.4010&heading=0&skipintro&nohud', async (p) => {
    await runDet(p, 1);
    await stick(p, -1);
    await runDet(p, 16);
    await p.evaluate(() => (delete window.__qa.sx, delete window.__qa.sy));
    await runDet(p, 1);
  });
  const ceilingAt = async (p) => {
    await runDet(p, 1);
    await stick(p, -1);
    await runDet(p, 16);
    await p.evaluate(() => (delete window.__qa.sx, delete window.__qa.sy));
    await runDet(p, 1);
  };
  await detShot('sunset', '?lat=37.7530&lon=-122.4950&heading=90&skipintro&nohud', ceilingAt);
  await detShot('presidio', '?lat=37.7990&lon=-122.4660&heading=180&skipintro&nohud', ceilingAt);
  await detShot('marin', '?lat=37.8020&lon=-122.4650&heading=330&skipintro&nohud', ceilingAt);
  await detShot('sunward', '?lat=37.7600&lon=-122.5000&heading=292&skipintro&nohud', ceilingAt);
  await detShot('westward', '?lat=37.7880&lon=-122.3990&heading=280&skipintro&nohud', ceilingAt);
  await detShot('london', '?city=london&lat=51.5073&lon=-0.1657&heading=90&skipintro&nohud', ceilingAt);
  await detShot('amsterdam', '?city=amsterdam&lat=52.3738&lon=4.8775&heading=75&skipintro&nohud', ceilingAt);
  await detShot('swap', '?lat=37.7820&lon=-122.4010&heading=0&skipintro&nohud', async (p) => {
    await glide(p, 6);
    await runDet(p, 1);
    // three blasts on the towers ahead (rooftop gardens, domes), up out of detail, down into it again, stopping short of them
    for (let i = 0; i < 3; i++) {
      await p.evaluate(() => window.__game.barfAtLatLon(37.7925, -122.401));
      await runDet(p, 2.5);
    }
    await stick(p, -1);
    await runDet(p, 9);
    await stick(p, 1);
    await runDet(p, 7);
    await p.evaluate(() => (delete window.__qa.sx, delete window.__qa.sy));
    await glide(p, 6);
    await runDet(p, 1);
  });
  writeFileSync(`${out}/stats.json`, JSON.stringify(stats, null, 2));
  await browser.close();
  console.log('shots saved to', out);
  process.exit(0);
}

// 1) grey city: drifting over Alamo Square, looking east at the Painted Ladies
//    row with downtown behind it in the fog
{
  const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud');
  await drift(page, 19.2);
  await runFor(page, 3);
  await page.screenshot({ path: `${out}/grey.png` });
  stats.grey = await page.evaluate(() => window.__stats ?? null);
  await page.close();
}

// 2) painted: drift slowly over Steiner Street and barf down the Painted Ladies
//    row through the real splat pipeline (cascade, bloom, sign, sound)
{
  const page = await open('?lat=37.77615&lon=-122.4340&heading=88&skipintro&nohud');
  await drift(page, 6);
  await runFor(page, 2);
  const row = [37.7754, 37.7758, 37.7762, 37.7766, 37.7770, 37.7762, 37.7758];
  for (const lat of row) {
    await page.evaluate((la) => window.__game.barfAtLatLon(la, -122.43262), lat);
    await runFor(page, 1.3);
  }
  await runFor(page, 2.5);
  await page.screenshot({ path: `${out}/painted.png` });
  stats.painted = await page.evaluate(() => window.__stats ?? null);
  await page.close();
}

// 3) the opening: fog bank west of the Golden Gate
{
  const page = await open('?openingshot&nohud');
  await runFor(page, 4.5);
  await page.screenshot({ path: `${out}/opening.png` });
  await page.close();
}

writeFileSync(`${out}/stats.json`, JSON.stringify(stats, null, 2));
await browser.close();
console.log('shots saved to', out);
