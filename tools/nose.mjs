#!/usr/bin/env node
// The path on the real game with the real stick (window.__qa), at a fixed step, frames taken with the loop frozen:
//   node tools/nose.mjs <baseUrl> <outDir> [--flights=street,g1,dive3k,...] [--dt=0.033333]
// Each flight logs the motion (up, forward, along the path, nose, the bus's pitch, the view's pitch, where the bus and the place it is
// heading for stand on screen) to <outDir>/nose.json and keeps its frames in <outDir>.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base = 'http://127.0.0.1:4177/', out = 'shots/local/nose/run'] = pos;
const DT = Number(opt.dt ?? 1 / 30);
mkdirSync(out, { recursive: true });
const report = {};

const browser = await chromium.launch(browserOptions([]));
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
await page.addInitScript(() => {
  if (window.DeviceOrientationEvent) window.DeviceOrientationEvent.requestPermission = undefined;
});

const open = async (lat, lon, heading) => {
  await page.goto(`${base}?lat=${lat}&lon=${lon}&heading=${heading}&skipintro&nohud&fixeddt=${DT.toFixed(6)}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 400000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.flight.glideSpeed = 0;
    g.flight.fullness = 0.5; // (no breath, no glint: the frames are about the flight)
    window.__qa = { holdFrames: 0 };
  });
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 120000 });
};
/** n seconds of game time, the stick as it is; then frozen. */
const run = async (secs) => {
  const n = Math.max(1, Math.round(secs / DT));
  await page.evaluate((k) => {
    window.__qa = { ...window.__qa, holdFrames: k, held: false };
  }, n);
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 600000 });
};
const stick = (sx, sy) => page.evaluate(([x, y]) => Object.assign(window.__qa, { sx: x, sy: y }), [sx, sy]);
const letGo = () => page.evaluate(() => {
  delete window.__qa.sx;
  delete window.__qa.sy;
});
const turbo = (on) => page.evaluate((v) => (window.__game.input.keyBoost = v), on);
const shift = (d) => page.evaluate((v) => window.__game.controls.turbo.shift(v, window.__game.flight), d);
/** Hand the bus a height and a held altitude, the lens already set for it. */
const place = (y) => page.evaluate((v) => {
  const g = window.__game, f = g.flight;
  f.y = v;
  f.holdY = v;
  f.mode = 1;
  f.vy = 0;
  g.rig.vista = g.rig.vistaTarget = 1;
  g.rig.lensHeight = g.rig.lensTarget = v - f.groundUnder;
}, y);
const state = () => page.evaluate(() => {
  const g = window.__game, f = g.flight, c = g.camera, T = g.controls.turbo;
  const scr = (x, y, z) => {
    const m = c.matrixWorldInverse.elements, p = c.projectionMatrix.elements;
    const vx = m[0] * x + m[4] * y + m[8] * z + m[12], vy = m[1] * x + m[5] * y + m[9] * z + m[13], vz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const w = -vz;
    return w > 0 ? [+(0.5 + ((p[0] * vx) / w) * 0.5).toFixed(3), +(0.5 - ((p[5] * vy) / w) * 0.5).toFixed(3)] : null;
  };
  const ground = f.ground;
  const h = f.y - f.groundUnder;
  // where the path meets the ground
  const lead = f.vy < -1 ? (h / -f.vy) * ground : 0;
  const d = new c.position.constructor();
  c.getWorldDirection(d);
  const r = (x, k = 1) => +x.toFixed(k);
  const fwd = Math.hypot(f.fx * ground, f.fz * ground);
  return {
    t: r(g.clock(), 2), y: r(f.y), h: r(h), up: r(f.vy), fwd: r(fwd), speed: r(f.speed), path: r((Math.atan2(f.vy, ground) * 180) / Math.PI), nose: r((f.nose * 180) / Math.PI), pitch: r((f.pitch * 180) / Math.PI), mode: f.mode,
    gear: T.gear, engaged: T.engaged, edge: r(T.edge, 2), floor: r(f.floorY), over: r(f.y - f.floorY), view: r((Math.asin(-d.y) * 180) / Math.PI), vista: r(g.rig.vista, 2), hfov: r(g.rig.hfov),
    bus: scr(f.x, f.y, f.z), dest: f.vy < -1 ? scr(f.x + f.fx * lead, f.groundUnder, f.z + f.fz * lead) : null, camDist: r(g.rig.distance), near: r(c.near), far: r(c.far, 0), x: r(f.x, 0), z: r(f.z, 0),
  };
});
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const log = [];
const note = async (tag) => {
  const s = await state();
  log.push({ tag, ...s });
  console.log(tag.padEnd(20), JSON.stringify(s));
  return s;
};
/** Step until cond(state), logging every `every` s; returns the last state. */
const until = async (tag, cond, maxS, every = 1) => {
  let s = await state();
  for (let t = 0; t < maxS && !cond(s); t += every) {
    await run(every);
    s = await note(tag);
  }
  return s;
};

const FLIGHTS = {
  // the street: the plain pull, then TURBO on the pull, then TURBO off, then let go
  async street() {
    await open(37.7763, -122.4352, 88);
    await run(1.5);
    await note('street');
    await shot('street-level');
    await stick(0, -1);
    await run(1);
    await note('pull 1s');
    await shot('pull-street-1s');
    await run(1);
    await note('pull 2s');
    await shot('pull-street-2s');
    await run(3);
    await note('pull 5s');
    await shot('pull-5s');
    await turbo(true);
    await run(0.5);
    await note('turbo 0.5s');
    await run(1.5);
    await note('turbo 2s');
    await shot('pull-turbo-2s');
    await run(3);
    await note('turbo 5s');
    await shot('pull-turbo-5s');
    await letGo();
    await turbo(false);
    for (let i = 1; i <= 6; i++) {
      await run(0.25);
      await note(`released ${i * 0.25}s`);
      if (i === 2) await shot('release-climb-0.5s');
    }
    await run(3);
    const a = await note('held');
    await run(2);
    const b = await note('held +2s');
    report.streetHold = { y0: a.y, y1: b.y };
  },
  // G1 from the street on full pull: to the ceiling, the stop there, then let go
  async g1() {
    await open(37.7763, -122.4352, 88);
    await run(1.5);
    await stick(0, -1);
    await shift(1);
    await run(1);
    await note('g1 1s');
    await shot('g1-1s');
    await run(2);
    await note('g1 3s');
    await shot('g1-3s');
    let s = await note('g1');
    let t = 0;
    for (const y of [1500, 3000, 6000, 12000]) {
      s = await until(`g1 to ${y}`, (q) => q.y >= y, 40, 2);
      await shot(`g1-${y}`);
    }
    s = await until('g1 to the top', (q) => q.y >= 14900, 12, 0.5);
    let peak = s.y;
    for (let i = 0; i < 16; i++) {
      await run(0.5);
      s = await note('g1 top');
      peak = Math.max(peak, s.y);
    }
    await shot('g1-ceiling');
    report.g1Ceiling = { peak, overshoot: +(peak - 15000).toFixed(1) };
    await letGo();
    await run(4);
    await note('g1 let go at the top');
    await shot('g1-ceiling-held');
    // the G1 dive from 12 km: down to the gear's floor
    await page.evaluate(() => {
      const f = window.__game.flight;
      f.y = f.holdY = 12000;
    });
    await run(2);
    await note('g1 at 12 km');
    await stick(0, 1);
    await run(2);
    await note('g1 dive 2s');
    await shot('g1-dive-2s');
    s = await until('g1 dive', (q) => q.y < 2200, 30, 2);
    await shot('g1-dive-2km');
    s = await until('g1 dive', (q) => q.y < 1000, 8, 0.25);
    await shot('g1-dive-1km');
    let low = Infinity;
    for (let i = 0; i < 30; i++) {
      await run(0.1);
      s = await note('g1 swoop');
      low = Math.min(low, s.over);
      if (i % 3 === 0) await shot(`g1-swoop-${i}`);
    }
    report.g1Swoop = { minOverFloor: low };
    await letGo();
    await run(3);
    await note('g1 after');
  },
  // a dive from 3 km in plain flight, over the rooftops
  async dive3k() {
    await open(37.7763, -122.4352, 88);
    await place(3000);
    await run(3);
    await note('held 3 km');
    await shot('dive-held-3km');
    await stick(0, 1);
    for (let i = 0; i < 8; i++) {
      await run(0.25);
      await note(`push ${(i + 1) * 0.25}s`);
      if (i === 3 || i === 7) await shot(`dive-${(i + 1) * 0.25}s`);
    }
    await until('dive', (q) => q.y < 2000, 12, 1);
    await shot('dive-2km');
    await until('dive', (q) => q.y < 1000, 12, 1);
    await shot('dive-1km');
    await until('dive', (q) => q.over < 260, 12, 0.5);
    await shot('dive-260m');
    let low = Infinity, lowHard = Infinity;
    for (let i = 0; i < 60; i++) {
      await run(0.1);
      const s = await note('swoop');
      low = Math.min(low, s.over);
      lowHard = Math.min(lowHard, s.h);
      if (i % 4 === 0) await shot(`swoop-${i}`);
      if (s.mode === 0) break;
    }
    report.diveRoofs = { minOverFloor: low, minOverGround: lowHard };
    await letGo();
    await run(3);
    await note('after');
    await shot('swoop-after');
  },
  // the same with TURBO held, over the water off the Embarcadero
  async diveWater() {
    await open(37.8020, -122.3850, 60);
    await place(3000);
    await run(2);
    await note('held 3 km');
    await turbo(true);
    await stick(0, 1);
    await run(3);
    await note('turbo dive 3s');
    await shot('water-dive-3s');
    await until('water dive', (q) => q.y < 1500, 15, 1);
    await shot('water-dive-1500');
    await until('water dive', (q) => q.over < 260, 14, 0.5);
    let low = Infinity;
    for (let i = 0; i < 60; i++) {
      await run(0.1);
      const s = await note('water swoop');
      low = Math.min(low, s.over);
      if (i % 5 === 0) await shot(`water-swoop-${i}`);
      if (s.mode === 0) break;
    }
    report.diveWater = { minOverFloor: low };
    await letGo();
    await turbo(false);
    await run(3);
    await note('water after');
  },
  // G1 from 12 km over the city, down to its floor
  async g1dive() {
    await open(37.7600, -122.4800, 60);
    await place(12000);
    await shift(1);
    await run(5);
    await note('g1 at 12 km');
    await shot('g1dive-held');
    await stick(0, 1);
    await run(2);
    await note('g1 dive 2s');
    await shot('g1dive-2s');
    await until('g1 dive', (q) => q.y < 2000, 26, 2);
    await shot('g1dive-2km');
    await until('g1 dive', (q) => q.over < 900, 8, 0.25);
    await shot('g1dive-900');
    let low = Infinity;
    for (let i = 0; i < 40; i++) {
      await run(0.1);
      const s = await note('g1 swoop');
      low = Math.min(low, s.over);
      if (i % 5 === 0) await shot(`g1dive-swoop-${i}`);
    }
    report.g1dive = { minOverFloor: low };
    await letGo();
    await run(3);
    await note('g1 after');
    await shot('g1dive-after');
  },
  // release mid-climb (the other half is street's) and mid-dive
  async release() {
    await open(37.7600, -122.4800, 40);
    await place(2500);
    await run(2);
    await stick(0, 1);
    await run(3);
    await note('mid-dive');
    await letGo();
    for (let i = 1; i <= 10; i++) {
      await run(0.2);
      await note(`let go ${(i * 0.2).toFixed(1)}s`);
    }
    await run(3);
    await note('hold');
    await shot('release-dive-hold');
  },
  // under the Golden Gate's deck: the climb must stop under it
  async deck() {
    await open(37.8150, -122.4777, 355);
    await page.evaluate(() => {
      const g = window.__game, f = g.flight;
      const [, a, b] = g.city.manifest.landmarks.find((l) => l.kind === 'ggb').points;
      f.x = (a[0] + b[0]) / 2;
      f.z = (a[1] + b[1]) / 2;
      f.y = 30;
      f.holdY = 30;
      f.mode = 1;
      f.heading = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
    });
    await run(0.5);
    await note('under the deck');
    report.deckAt = await page.evaluate(() => {
      const g = window.__game, f = g.flight;
      return { over: g.city.overheadAt(f.x, f.z, f.y), y: f.y };
    });
    await turbo(true);
    await stick(0, -1);
    let peak = -1e9;
    for (let i = 0; i < 12; i++) {
      await run(0.25);
      const s = await note('TURBO pull');
      peak = Math.max(peak, s.y);
      if (i === 6) await shot('deck-turbo');
    }
    await turbo(false);
    await shift(1);
    for (let i = 0; i < 12; i++) {
      await run(0.25);
      const s = await note('G1 pull');
      peak = Math.max(peak, s.y);
    }
    await shot('deck-g1');
    report.deck = { peak, deck: report.deckAt.over };
    await letGo();
    await shift(-1);
    await run(2);
    await note('deck after');
  },
  // the map's edge in G1: a level run fades, a climb keeps the gear
  async edge() {
    await open(37.7500, -122.3650, 100);
    await place(1000);
    await shift(1);
    await run(2);
    await note('g1 near the edge');
    await stick(0, -1);
    await until('edge climb', (q) => q.t > 30 || q.y > 9000, 30, 1);
    await shot('edge-climb');
    await letGo();
    await run(2);
    await until('edge level', (q) => false, 14, 1);
    await shot('edge-level');
  },
};

const chosen = (opt.flights ?? Object.keys(FLIGHTS).join(',')).split(',');
for (const name of chosen) {
  log.length = 0;
  console.log(`---- ${name}`);
  await FLIGHTS[name]();
  await turbo(false);
  report[name] = [...log];
  writeFileSync(`${out}/nose-${name}.json`, JSON.stringify(report[name]));
}
writeFileSync(`${out}/nose.json`, JSON.stringify(report, null, 1));
console.log('page errors:', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
