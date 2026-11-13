#!/usr/bin/env node
// Taking the block's frames (docs/specs/factions/LIFT.md, "Taking it: the looks"), for one outside look: Rainbow's bus on Inferno's block at a
// fixed sun. 01 from the producer's own link (?lift&lifted=inferno, the opening under the Golden Gate) as the glance turns to the block's light;
// 02 and 03 flying on from it at Nonstop to the block, the game's own camera; the rest on the tools' start (&hoodstart&skipintro), the game's
// camera behind the bus held still out from a square of the block, its hits the bus's real taps (the rules' scripted hit, Lift.qaHit, where a
// tap lands off the square; forceReady between), the heart's and 13 from a lens (__qa.camAt): 02 the block waking ahead, 03 the wave, 04 a parry after the crack
// (the bounce, the shimmer, the line's pulse), 05 the crack (veins, the raft's list), 06 the fall mid-air, 07 landed (the slow motion, the lakes
// draining), 08 a wilt, 09 the flip's front, 10 the square Rainbow's at 3, 11 the sky piece coming down through the heart's fall, 12 the square
// lifted as Rainbow's, 13 the heart flipped and the light relit in Rainbow's from 3 km. Each frame held as it is drawn (__qa.held); its draws
// and triangles go to <out>/look.json. Exit 1 if a frame can't be taken, a page or shader error, or a program made after the warm-up.
//
//   node tools/factions/take-look.mjs <url> <outDir>
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserOptions } from '../browser.mjs';
import { flickTo } from '../flick.mjs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = pos[0] ?? 'http://127.0.0.1:4179/';
const out = resolve(pos[1] ?? 'shots/tmp/take-look');
mkdirSync(out, { recursive: true });
const T = '&nohud&t=2026-11-06T20:49:00Z&rate=0';
const RB = 1;
let failed = 0;
const frames = {};

const browser = await chromium.launch({ ...browserOptions([]) });
async function open(q) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => {
    failed++;
    console.log('[pageerror]', e.message);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error' || m.text().startsWith('Failed to load resource')) return;
    failed++;
    console.log('[console error]', m.text().slice(0, 1500));
  });
  await page.addInitScript(() => {
    const W = (window.__tk = { programs: [] });
    const cp = WebGL2RenderingContext.prototype.createProgram;
    WebGL2RenderingContext.prototype.createProgram = function () {
      W.programs.push(Math.round(performance.now()));
      return cp.call(this);
    };
  });
  await page.goto(base + q, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const g = window.__game, w = g?.warm;
    return !!g && !!w?.report && !w.running && w.report.programs >= g.pipeline.renderer.info.programs.length;
  }, null, { timeout: 240000, polling: 100 });
  page.warmDoneAt = await page.evaluate(() => Math.round(window.__game.warm?.doneAt ?? performance.now()));
  // (the QA's hooks: the held frame, the lens and the bus's pin)
  await page.evaluate(() => (window.__qa = window.__qa ?? {}));
  return page;
}
const wait = (page, fn, arg, timeout = 120000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });
async function shot(page, name) {
  await page.evaluate(() => {
    window.__qa.held = false;
    window.__qa.holdAt = window.__game.splatter.clock;
  });
  await wait(page, () => window.__qa.held === true, null, 30000);
  const s = await page.evaluate(() => {
    const g = window.__game, l = g.lift;
    return { clock: +l.now.toFixed(2), calls: g.perf.calls, tris: g.perf.tris, up: l.up, stats: { counted: l.stats.counted, parried: l.stats.parried, falls: l.stats.falls, landings: l.stats.landings, crackHeld: l.stats.crackHeld, fallHeld: l.stats.fallHeld } };
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  // (and on: the hold let go)
  await page.evaluate(() => {
    delete window.__qa.holdAt;
    window.__qa.held = false;
  });
  frames[name] = s;
  console.log(name, JSON.stringify(s));
}
const programsAfter = (page) => page.evaluate((t) => window.__tk.programs.filter((p) => p > t).length, page.warmDoneAt);

try {
  // ---- 01: the producer's link, the glance toward the block's light as the opening hands over (from about 18.0 s, held 0.6 to 1.5 s in)
  {
    const page = await open('?lift&lifted=inferno' + T);
    await wait(page, () => window.__game.lift.now >= 18.9, null, 240000);
    await shot(page, '01-start');
    // ---- 02, 03: the producer's flight on from 01: a real flick to Nonstop and the QA stick at the heart, the game's own camera behind the
    // bus; 02 as the block wakes ahead of it, 03 its wave 1.6 s on (the first look's 02 was the tools' start, the bus in the block at 0.28 s:
    // not the game's)
    await wait(page, () => window.__game.lift.now >= 19.6, null, 60000);
    const cdp = await page.context().newCDPSession(page);
    await flickTo(page, cdp, 2);
    const steer = () => page.evaluate(() => {
      const g = window.__game, L = g.lift, f = g.flight;
      window.__qa.sy = 0;
      let e = Math.atan2(L.heart[0] - f.x, -(L.heart[1] - f.z)) - f.heading;
      e = Math.atan2(Math.sin(e), Math.cos(e));
      // (plus sx turns the heading up: Flight's yaw)
      window.__qa.sx = Math.max(-1, Math.min(1, 2 * e));
      return L.waveAt;
    });
    const t0 = await page.evaluate(() => window.__game.lift.now);
    while ((await steer()) < 0 && (await page.evaluate(() => window.__game.lift.now)) < t0 + 75) await page.waitForTimeout(40);
    await shot(page, '02-arrive');
    const wa = await page.evaluate(() => window.__game.lift.waveAt);
    if (wa < 0) (failed++, console.log('no wave on the flight for 02'));
    while ((await page.evaluate(() => window.__game.lift.now)) < wa + 1.6) (await steer(), await page.waitForTimeout(40));
    await shot(page, '03-wave');
    const p = await programsAfter(page);
    if (p) (failed++, console.log('programs after the warm-up (01-03):', p));
    await page.close();
  }

  const page = await open('?lift&lifted=inferno&hoodstart&skipintro' + T);
  const now = () => page.evaluate(() => window.__game.lift.now);
  const until = async (t) => wait(page, (t) => window.__game.lift.now >= t, t);
  const state = () => page.evaluate(() => window.__game.lift.takeState());
  await wait(page, () => window.__game.lift.waveAt > 0, null, 240000);

  // ---- the square: a ready one with houses, not the heart, on the block's edge; the lens 230 m out from it, the bus pinned beside the lens
  await wait(page, () => window.__game.lift.takeState().filter((s) => !s.heart && s.houses.length >= 6 && s.readyAt <= window.__game.lift.now).length >= 2, null, 120000);
  const sq = await state();
  const heart = sq.find((s) => s.heart);
  const ready = sq.filter((s) => !s.heart && s.houses.length >= 6 && s.readyAt <= sq[0].readyAt + 1e9).sort((a, b) => Math.hypot(b.x - heart.x, b.z - heart.z) - Math.hypot(a.x - heart.x, a.z - heart.z));
  const A = ready[0];
  // (the lens d m out from s on the side away from (hx, hz): the heart's, for a square; for the heart itself, square A's, the far side from it)
  // (`pin`: where the bus is pinned from the lens, [along the view, to its right, down] m; 20 m beside it at the lens's height unless said)
  const look = (s, d, h, lookH, hfov = 50, from = heart, pin = null) =>
    page.evaluate(([s, hx, hz, d, h, lookH, hfov, pin]) => {
      const g = window.__game, l = Math.hypot(s.x - hx, s.z - hz) || 1;
      const x = s.x + ((s.x - hx) / l) * d, z = s.z + ((s.z - hz) / l) * d;
      // (the lens kept under 270 m above the sea: from 285 m the marine layer seen from above fades in, and full it buries the city's tiles,
      // 11 and 13 of the first runs a frame of fog)
      h = Math.max(40, Math.min(h, 270 - g.city.groundAt(x, z)));
      window.__qa.camAt = { x, z, h, lookX: s.x, lookZ: s.z, lookH, hfov };
      const ux = (s.x - x) / (d || 1), uz = (s.z - z) / (d || 1);
      const [px, pz, py] = pin ? [x + ux * pin[0] - uz * pin[1], z + uz * pin[0] + ux * pin[1], h - pin[2]] : [x + 20, z, h];
      window.__qa.pin = { x: px, y: g.city.groundAt(px, pz) + py, z: pz, heading: Math.atan2(-(s.x - x), s.z - z) };
    }, [s, from.x, from.z, d, h, lookH, hfov, pin]);
  const ready5 = () => page.evaluate(() => window.__game.lift.forceReady());
  const after = async (dt) => until((await now()) + dt);
  // (the fight from the game's own camera behind the bus (the first look's lens put the bus out of every frame of it): the bus pinned d m out
  // from square A on the side away from the heart, `up` m over the ground, heading at it, where a breath's aim lands on A; its hits real taps,
  // the bus's own Rainbow breath on screen. A tap that lands off A's square is made up by the rules' scripted hit, and counted)
  const chase = async (s, d, up) => {
    await page.evaluate(([s, hx, hz, d, up]) => {
      const g = window.__game, l = Math.hypot(s.x - hx, s.z - hz) || 1;
      const x = s.x + ((s.x - hx) / l) * d, z = s.z + ((s.z - hz) / l) * d;
      window.__qa.camAt = null;
      // (held still: a pinned bus keeps its ground speed otherwise, and the fall's hold keeps the houses on its path ahead up)
      window.__qa.pin = { x, y: g.city.groundAt(x, z) + up, z, heading: Math.atan2(s.x - x, -(s.z - z)), speed: 0, ground: 0 };
    }, [s, heart.x, heart.z, d, up]);
    await after(0.4);
    return page.evaluate((s) => {
      const a = window.__game.aimNow();
      return Math.floor(a.x / 128) === Math.floor(s.x / 128) && Math.floor(a.z / 128) === Math.floor(s.z / 128);
    }, s);
  };
  let pose = null;
  for (const d of [110, 150, 190, 80]) for (const up of [35, 55, 80]) if (!pose && (await chase(A, d, up))) pose = [d, up];
  if (!pose) console.log('no pose puts the aim on square A: the scripted hits alone');
  else await chase(A, ...pose);
  await after(1.2);
  let scripted = 0;
  const hit = async (s, f = RB, via = 0) => {
    const c0 = await page.evaluate(() => window.__game.lift.stats.counted + window.__game.lift.stats.parried + window.__game.lift.stats.encores);
    if (pose && f === RB && !via) {
      const at = await page.evaluate(() => {
        const g = window.__game;
        g.forceReady();
        g.tap();
        const s = g.lastShot();
        return s ? s.t + s.travel : null;
      });
      if (at !== null) await until(at + 0.05);
      const c1 = await page.evaluate(() => window.__game.lift.stats.counted + window.__game.lift.stats.parried + window.__game.lift.stats.encores);
      if (c1 > c0) return;
    }
    scripted++;
    await page.evaluate(([x, z, f, via]) => window.__game.lift.qaHit(x, z, f, via), [s.x, s.z, f, via]);
  };

  await hit(A);
  await after(0.5);
  await hit(A);
  await after(0.12);
  await shot(page, '04-parry');
  await after(0.8);
  await shot(page, '05-crack');
  await ready5();
  await hit(A);
  await wait(page, (k) => window.__game.lift.stats.landings > 0 || window.__game.lift.takeState().find((s) => s.key === k).falling === 0, A.key, 20000).catch(() => {});
  await shot(page, '06-fall-mid');
  await after(0.9);
  await shot(page, '07-landed');
  await wait(page, (k) => window.__game.lift.takeState().find((s) => s.key === k).falling === 0, A.key, 60000).catch(() => {});
  await ready5();
  await hit(A);
  await after(0.35);
  await shot(page, '08-wilt');
  await after(1);
  await ready5();
  await hit(A);
  await ready5();
  await after(0.1);
  await hit(A);
  await after(0.55);
  await shot(page, '09-flip-front');
  await after(1.2);
  for (let k = 0; k < 2; k++) {
    await ready5();
    await hit(A);
    await after(1.6);
  }
  await shot(page, '10-square-yours');

  // ---- the heart through the piece: its crack, then its fall; the lens out on the heart's own side
  const hasSky = await page.evaluate(() => !!window.__game.lift.sky);
  if (hasSky) {
    await look(heart, 520, 240, 300, 60, A, [90, -30, 60]);
    await after(0.4);
    await page.evaluate(() => window.__game.lift.forceReady());
    await page.evaluate(() => window.__game.lift.qaHit(-1e9, -1e9, 1, 1));
    await after(1.2);
    await ready5();
    await page.evaluate(() => window.__game.lift.qaHit(-1e9, -1e9, 1, 1));
    await after(0.5);
    await shot(page, '11-sky-out');
  } else (failed++, console.log('no sky piece for 11'));

  // ---- 12: the square's third up lifts it as Rainbow's
  if (pose) await chase(A, ...pose);
  else await look(A, 260, 190, 10);
  await ready5();
  await hit(A);
  await after(4);
  await shot(page, '12-your-lift');

  // ---- 13: the heart taken to the flip (two wilts and the flip), the light relit in Rainbow's, from 3 km
  for (let k = 0; k < 3; k++) {
    await ready5();
    await hit(heart);
    await after(0.3);
  }
  await look(heart, 3000, 220, 500, 40, A, [-40, 0, 0]);
  await after(2.2);
  await shot(page, '13-beam-yours');
  const p = await programsAfter(page);
  if (p) (failed++, console.log('programs after the warm-up:', p));
  frames.programsAfterWarmup = p;
  frames.pose = pose;
  frames.scriptedHits = scripted;
  frames.final = await state().then((s) => s.map((x) => ({ key: x.key, heart: x.heart, owner: x.owner, stage: x.stage, up: x.up })));
} catch (e) {
  failed++;
  console.log('FAIL', e.message);
}
await browser.close();
writeFileSync(`${out}/look.json`, JSON.stringify(frames, null, 1));
console.log(failed ? `${failed} failed` : 'all taken');
process.exit(failed ? 1 : 0);
