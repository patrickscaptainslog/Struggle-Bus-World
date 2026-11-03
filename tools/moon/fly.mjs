#!/usr/bin/env node
// The real bus over ?moon by the real stick (window.__qa), at a fixed step, frames taken with the loop frozen:
//   node tools/moon/fly.mjs <out dir> [--flights=cruise,surge,jet,climb,dive,swoop,peaks,edge] [--dt=0.033333] [--q=site=TYCHO]
// BASE is the page (http://localhost:4179/). Each row is a state at that moment; moon-fly.json keeps them. Nothing here is a timing: a laptop, a fixed step.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const out = pos[0] ?? 'shots/local/moonlow/ground/fly';
const base = process.env.BASE ?? 'http://localhost:4179/';
const DT = Number(opt.dt ?? 1 / 30);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
});
await page.addInitScript(() => {
  if (window.DeviceOrientationEvent) window.DeviceOrientationEvent.requestPermission = undefined;
});

const open = async () => {
  await page.goto(`${base}?moon&nohud&fixeddt=${DT.toFixed(6)}${opt.q ? '&' + opt.q : ''}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await page.evaluate(() => {
    const g = window.__game, info = g.pipeline.renderer.info;
    g.flight.fullness = 0.5;
    window.__qa = { holdFrames: 0 };
    info.autoReset = false;
    const f = g.perf.frame.bind(g.perf);
    window.__stats = { calls: 0, triangles: 0 };
    g.perf.frame = (a, b) => {
      window.__stats = { calls: info.render.calls, triangles: info.render.triangles };
      info.reset();
      f(a, b);
    };
  });
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 120000 });
};
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
/** Up or down the ladder a flick at a time to a gear: Cruise 0, Express 1, Nonstop 2, Jet 3. */
const gear = (n) => page.evaluate((k) => {
  const g = window.__game;
  for (let i = 0; i < 8 && g.controls.turbo.gear !== k; i++) g.input.onTurbo(g.controls.turbo.gear < k ? 1 : -1);
}, n);
const state = () => page.evaluate(() => {
  const g = window.__game, f = g.flight, c = g.camera, T = g.controls.turbo, r = (x, k = 1) => +x.toFixed(k);
  const gy = g.city.groundAt(f.x, f.z);
  return { t: r(g.clock(), 2), x: r(f.x, 0), z: r(f.z, 0), y: r(f.y), h: r(f.y - gy), floor: r(f.floorY - gy), speed: r(f.speed), ground: r(f.ground), vy: r(f.vy), nose: r((f.nose * 180) / Math.PI), mode: f.mode, gear: T.gear, near: r(c.near), ...window.__stats, patches: g.moon.far.patchCount, regions: g.city.loadedRegionCount(), sun: r(g.flight ? 1 : 0, 0) };
});
const log = [];
const note = async (tag) => {
  const s = await state();
  log.push({ tag, ...s });
  console.log(tag.padEnd(20), JSON.stringify(s));
  return s;
};
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
/** Flies `secs`, a row and a frame every `every` s. */
const leg = async (tag, secs, every) => {
  for (let t = every; t <= secs + 1e-6; t += every) {
    await run(every);
    await note(tag);
    await shot(`${tag}-${String(Math.round(t * 10)).padStart(4, '0')}`);
  }
};

const FLIGHTS = {
  async cruise() {
    await open();
    await leg('cruise', 12, 3);
  },
  async surge() {
    await open();
    await stick(0, 1);
    await leg('surge', 16, 4);
    await stick(0.7, 0.8);
    await leg('surge-turn', 6, 2);
    await letGo();
  },
  async jet() {
    await open();
    await gear(3);
    await leg('jet-lift', 8, 2);
    await letGo();
    await leg('jet', 24, 6);
    await gear(0);
    await leg('jet-brake', 6, 2);
  },
  async climb() {
    await open();
    await stick(0, -1);
    await leg('climb', 20, 5);
    await gear(3);
    await leg('climb-g1', 24, 6);
    await gear(0);
    await letGo();
    await leg('hold', 6, 2);
  },
  async dive() {
    await open();
    await gear(3);
    await stick(0, -1);
    await run(14);
    await gear(0);
    await letGo();
    await run(4);
    await note('top of the dive');
    await shot('dive-top');
    await stick(0, 1);
    await leg('dive', 40, 5);
    await letGo();
    await leg('dive-out', 8, 2);
  },
  /** Straight at the rim of the nearest good crater, at a surge, and over it. */
  async swoop() {
    await open();
    const c = await page.evaluate(() => {
      const g = window.__game, f = g.flight;
      const list = g.moon.cratersNear(f.x + f.fx * 900, f.z + f.fz * 900, 800, 180).filter((k) => k.r > 90 && k.r < 400);
      const k = list[0];
      if (!k) return null;
      f.heading = Math.atan2(k.x - f.x, -(k.z - f.z));
      return k;
    });
    console.log('crater', JSON.stringify(c));
    await stick(0, 0.9);
    await leg('swoop', 20, 1);
    await letGo();
  },
  /** At the central peaks, low, and over them. */
  async peaks() {
    await open();
    await stick(0, 1);
    await leg('peaks', 150, 15);
    await letGo();
  },
  /** A breath on the ground, as a street's: where it lands, the sign, and the ground it paints. */
  async paint() {
    await open();
    await run(2);
    const fire = async (tag) => {
      await page.evaluate(() => {
        const g = window.__game;
        g.flight.fullness = 1;
        g.tapSplat();
      });
      await leg(tag, 3.6, 0.6);
      console.log(JSON.stringify(await page.evaluate(() => ({ shot: window.__game.lastShot(), sign: window.__game.lastSign() }))));
    };
    await fire('paint-1');
    await stick(0.5, 0.3);
    await run(3);
    await letGo();
    await fire('paint-2');
    await fire('paint-3');
  },
  /** Jet for the edge of the map: the homing turns it back. */
  async edge() {
    await open();
    await gear(3);
    await page.evaluate(() => {
      const g = window.__game, f = g.flight;
      f.x = 120000;
      f.z = 0;
      f.heading = Math.PI / 2;
    });
    await run(4);
    await leg('edge', 60, 10);
  },
};

const want = (opt.flights ?? Object.keys(FLIGHTS).join(',')).split(',');
try {
  for (const name of want) {
    console.log('----', name);
    await FLIGHTS[name]();
  }
} finally {
  writeFileSync(`${out}/moon-fly.json`, JSON.stringify(log, null, 0));
  console.log('errors:', errors.length, errors.slice(0, 6));
  console.log('programs:', JSON.stringify(await page.evaluate(() => ({ now: window.__game?.pipeline.renderer.info.programs.length, warmed: window.__game?.warm.report?.programs }))));
  await browser.close();
}
process.exit(errors.length ? 1 : 0);
