#!/usr/bin/env node
// Shader warm-up check in the real game (index.html): a cold load (fresh browser = cold GPU program
// cache) through the real opening, then everything that used to compile a shader in flight:
// a climb to the vista, three blasts on one building (the first street sign, the rooftop gardens at
// level 2, the Hundertwasser crowns at level 3), and the landmarks seen from altitude (the
// Transamerica Pyramid, Sutro Tower). Reports every WebGL program created after the warm-up
// finished (target: none), every frame gap and long task over 100 ms after ready, by phase, and
// every first draw after it: a Metal render pipeline is keyed by the program AND the target's
// format, the color write mask, blending and the topology class, so a program that exists can
// still build a pipeline in flight (target: the upscale onto the canvas, never warmed, frame 1).
//   node tools/warmcheck.mjs <url> <out.json> [--throttle=4] [--late=9000]
// --late=<ms>: far16.bin held back that long by a route, so it lands in play (City.landFar), and ready waits for it.
// --moon: the url is ?moonrun: no city, so the phases are the flight's: real flicks, out and home.
// --low: the url is ?moon, the ground: real touches through a cruise, a surge, Jet, a climb, a dive, a crater taken to level 3, a mega and a firehose
//   (MEGA is asleep since 2026-11-06: give the url &mega for those two).
// --crew: the url has ?crew: after the blasts, the faction crest switched through all five by real taps (Atlantis, the Elderwood, Hyperglow, Inferno,
//   Rainbow), each switch followed by three blasts on a fresh block (levels 1-3, the gardens and crowns in that faction's rows), in view.
// --comet: after the blasts (and --crew's factions), the shots' step 3 by real taps (CDP): at Jet over the Western Addition a Comet with the full show
//   (the first) and one with the lighter (the next), its pillar flown through; with --crew in each of the five factions, switched on the crest.
// --hose: after the blasts, the shots' step 2 by real touches (CDP) over the Western Addition: a tap off the lane, a hold to aim that pours the Hose,
//   a sweep, the tank run dry, its refill, a second hold taken through the hook (window.__game.holds.add) that fires a homing shot at a point ahead.
// --bomb: the url has &bomb: after the blasts (and --crew's factions, --comet's Comets), the Bomb (src/game/Bomb.ts) by real touches (CDP) held still on the
//   bus itself (Input.busBox): at Cruise over the Western Addition a Bomb II and a Bomb III, at Jet a Bomb III where the Comet lands (its full show), and a
//   gift (holds.bomb.gift(3)) let go at III; with --crew in each of the five factions, switched on the crest.
// --boom: the url has &boom: after the blasts (and the modes before it), Sonic Boom (src/game/Boom.ts): at Turbo 2 over the Western Addition a real flick into
//   Turbo 3, its crack, the hoop landing as the ring and its crown; with --crew in each of the five factions, switched on the crest.
// --falls: the url has &falls: the Waterfall (src/fx/Falls.ts): a tap on a Financial District tower's roof, its runs, drops and pool; with --crew in each faction.
// --curb: the url is a street with ?life (?lat=37.736181&lon=-122.426973&heading=227&life&skipintro, GEARS.md's arterial): Curb with real touches, on and off.
// Wall clock, real GPU (tools/browser.mjs): meaningful on a laptop, not in the cloud's SwiftShader.
// `lamps` in the report: when the street lamps' list was asked for and landed, ms after ready (a dusk with them in flight: ?t=2026-11-07T00:01:00Z&rate=120).
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';
import { flick, flickTo } from './flick.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [url = 'http://127.0.0.1:4173/', out = 'warmcheck.json'] = pos;

const browser = await chromium.launch(browserOptions([]));
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
if (opt.throttle) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(opt.throttle) });
}
if (opt.late)
  await page.route('**/far16.bin*', async (r) => {
    await new Promise((d) => setTimeout(d, Number(opt.late)));
    await r.continue();
  });
await page.addInitScript(() => {
  const W = (window.__wc = { phase: 'load', programs: [], frames: [], long: [] });
  const P = WebGL2RenderingContext.prototype;
  const cp = P.createProgram;
  P.createProgram = function () {
    W.programs.push([Math.round(performance.now()), W.phase]);
    return cp.call(this);
  };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) W.long.push([Math.round(e.startTime), Math.round(e.duration), W.phase]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  // every draw's pipeline key, as far as GL shows one (vertex layouts aside)
  const D = (W.draws = { prog: null, fb: null, mask: 'xxxx', blend: false, blendFn: '', seen: new Map(), shown: 0 });
  const ids = new Map();
  const id = (o) => (o === null ? 0 : ids.get(o) ?? (ids.set(o, ids.size + 1), ids.size));
  const spy = (name, f) => {
    const o = P[name];
    P[name] = function (...a) {
      f.call(this, a);
      return o.apply(this, a);
    };
  };
  spy('useProgram', (a) => (D.prog = a[0]));
  spy('bindFramebuffer', function (a) {
    if (a[0] !== this.READ_FRAMEBUFFER) D.fb = a[1];
  });
  spy('colorMask', (a) => (D.mask = a.map((x) => (x ? 'x' : '-')).join('')));
  spy('blendFuncSeparate', (a) => (D.blendFn = a.join(',')));
  spy('blendFunc', (a) => (D.blendFn = a.join(',')));
  spy('enable', function (a) {
    if (a[0] === this.BLEND) D.blend = true;
  });
  spy('disable', function (a) {
    if (a[0] === this.BLEND) D.blend = false;
  });
  const draw = (a) => {
    if (D.fb === null) D.shown++;
    const cls = a[0] === 0 ? 'points' : a[0] <= 3 ? 'lines' : 'tris';
    const blend = D.blend ? `blend ${D.blendFn}` : 'no blend';
    const key = `${id(D.prog)}|${id(D.fb)}|${D.mask}|${blend}|${cls}`;
    if (!D.seen.has(key)) D.seen.set(key, { prog: D.prog, fb: D.fb, mask: D.mask, blend, cls, t: performance.now(), phase: W.phase, shown: D.shown });
  };
  for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) spy(n, draw);
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  const tick = (t) => {
    if (last && t - last > 100) W.frames.push([Math.round(last), Math.round(t - last), W.phase]);
    last = t;
    raf(tick);
  };
  raf(tick);
});

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000, polling: 100 });
const readyMs = Date.now() - t0;
const readyAt = await page.evaluate(() => performance.now());

// in-page helpers: city-local meters from lat/lon (tools mirror src/game/geo.ts), a game-clock wait
await page.evaluate(() => {
  const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2), E4 = E2 * E2, E6 = E4 * E2;
  const mer = (p) => A * ((1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256) * p - ((3 * E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024) * Math.sin(2 * p) + ((15 * E4) / 256 + (45 * E6) / 1024) * Math.sin(4 * p) - ((35 * E6) / 3072) * Math.sin(6 * p));
  window.__ll = (lat, lon) => {
    const o = window.__game.city.manifest.origin;
    const r = Math.PI / 180, phi = lat * r, s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
    const N = A / Math.sqrt(1 - E2 * s * s), T = t * t, C = EP2 * c * c, a = (lon - o[1]) * r * c, a2 = a * a;
    const x = N * (a + ((1 - T + C) * a2 * a) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a2 * a2 * a) / 120);
    const y = mer(phi) - mer(o[0] * r) + N * t * (a2 / 2 + ((5 - T + 9 * C + 4 * C * C) * a2 * a2) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a2 * a2 * a2) / 720);
    return [x, -y];
  };
  window.__run = (s) =>
    new Promise((res) => {
      const g = window.__game, start = g.clock();
      const tick = () => (g.clock() - start >= s ? res(null) : requestAnimationFrame(tick));
      tick();
    });
});
// (the warm-up's end: on ?earth the flight boots behind the street and warms its own programs in a round after ready, so ready is too soon to read it. It's over
// once the flight is up (window.__space) and the report counts every program the renderer has, or 30 s on, said)
await page
  .waitForFunction(() => {
    const g = window.__game, w = g.warm;
    if (!w) return true;
    if (/[?&]earth\b/.test(location.search) && !window.__space?.moon) return false;
    return !!w.report && !w.running && w.report.programs >= g.pipeline.renderer.info.programs.length;
  }, null, { timeout: 30000, polling: 250 })
  .catch(() => console.log('[warm] its report never counted every program the renderer has: read 30 s after ready'));
// (a build without the warm-up: everything after ready counts)
const info = await page.evaluate(() => ({ warmDoneAt: Math.round(window.__game.warm?.doneAt ?? performance.now()), report: window.__game.warm?.report ?? null, programsAtReady: window.__game.pipeline.renderer.info.programs.length }));
const phase = (p) => page.evaluate((x) => (window.__wc.phase = x), p);
const run = (s) => page.evaluate((x) => window.__run(x), s);
const settle = () => page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
// teleport the bus (QA): a point, a height above sea level held, a heading (rad, 0 = north)
const place = (lat, lon, y, heading) =>
  page.evaluate(([la, lo, yy, h]) => {
    const g = window.__game;
    const [x, z] = window.__ll(la, lo);
    window.__qa = {};
    Object.assign(g.flight, { x, z, heading: h, y: yy, holdY: yy, targetY: yy, vy: 0, mode: 1 });
    g.flight.glideSpeed = 14;
  }, [lat, lon, y, heading]);

// (?moonrun: the flight's phases instead of the city's. It flies at the url's own fixeddt: all that's read here is what first draws, and when)
const moon = async () => {
  const cdp = await ctx.newCDPSession(page);
  const tap = () => flick(cdp, 1);
  const until = (leg) => page.waitForFunction((l) => window.__game.moon.trip.leg === l, leg, { timeout: 600000, polling: 200 });
  await phase('wait');
  await page.waitForTimeout(1500);
  await phase('out');
  await tap();
  await page.waitForFunction(() => window.__game.moon.trip.leg !== 'wait', null, { timeout: 30000, polling: 50 });
  await tap();
  await until('orbit');
  await phase('orbit');
  await page.waitForTimeout(1500);
  // three breaths, each on the paint of the last: the particles' first draws, the flash, the wave, a level up, rays
  await phase('paint');
  for (let i = 0; i < 3; i++) {
    await page.waitForFunction(() => window.__game.moon.breath.loaded, null, { timeout: 30000, polling: 50 });
    const at = await page.evaluate(() => {
      const b = window.__game.moon.breath, s = b.paint.strokes.at(-1);
      return s ? b.screenOf(s.lat, s.lon) : { x: 196, y: 420 };
    });
    await page.touchscreen.tap(at.x, Math.min(at.y, 560));
    await page.waitForFunction(() => window.__game.moon.breath.stats.shots > 0 && !window.__game.moon.breath.loaded, null, { timeout: 5000, polling: 50 });
  }
  await page.waitForTimeout(4000);
  await phase('home');
  await tap();
  await page.waitForFunction(() => window.__game.moon.trip.leg !== 'orbit', null, { timeout: 30000, polling: 50 });
  await tap();
  await until('wait');
  await phase('done');
};

// (?moon: the same questions on the ground. Real touches through CDP; the crater by a hit a level at a time on what glints)
const low = async () => {
  const cdp = await ctx.newCDPSession(page);
  const down = (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  const to = (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  const up = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const tap = async (x = 196, y = 530, ms = 70) => {
    await down(x, y);
    await page.waitForTimeout(ms);
    await up();
  };
  const pull = async (dx, dy, secs) => {
    await down(196, 580);
    for (let i = 1; i <= 6; i++) {
      await to(196 + (dx * i) / 6, 580 + (dy * i) / 6);
      await page.waitForTimeout(16);
    }
    await run(secs);
    await up();
  };
  const centre = async (name) => {
    const b = await page.locator(`[data-hud="${name}"]`).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const breaths = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.waitForFunction(() => window.__game.flight.fullness >= 0.999 && !!window.__game.moon.paint.target, null, { timeout: 30000, polling: 50 }).catch(() => {});
      await tap();
      await run(2.4);
    }
  };
  await phase('cruise');
  await run(3);
  await phase('surge');
  await pull(30, -70, 6);
  await phase('paint');
  await breaths(5);
  await phase('level3');
  const id = await page.evaluate(() => {
    const g = window.__game, f = g.flight, c = g.moon.cratersNear(f.x + f.fx * 200, f.z + f.fz * 200, 500, 30).find((k) => k.r > 15 && k.r < 400 && !k.name);
    if (c) for (const l of [1, 2, 3]) g.moon.paint.qaHit(c.id, g.clock(), l);
    return c?.id ?? null;
  });
  await run(3.5);
  await phase('mega');
  await run(2);
  const [mx, my] = await centre('mega');
  await tap(mx, my, 3000);
  await run(4);
  await page.evaluate(() => window.__game.superSkip(100));
  await run(1);
  await phase('firehose');
  await tap(mx, my, 10600);
  await run(7);
  await page.evaluate(() => window.__game.superSkip(100));
  await phase('jet');
  await flickTo(page, cdp, 3);
  await run(8);
  await phase('climb');
  await pull(0, 90, 22);
  await phase('dive');
  await pull(0, -90, 16);
  await phase('done');
  return { id, recs: await page.evaluate(() => window.__game.moon.paint.recs.size) };
};

// (--curb: the url is a street with ?life, GEARS.md's arterial for one: Curb's phases, with real touches. A flick down to School Zone and another onto
// the street, the lens coming down, the roll with its paint behind, a car ridden beside until it's painted, the push on, a tap's drive-by, a flick up
// off it, School Zone's drift down onto it again, a pull held off it: docs/specs/shots/CURB.md)
const curb = async () => {
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 2, radiusX: 4, radiusY: 4, force: 1 }] });
  const hold = async (dy, secs) => {
    await touch('touchStart', 300, 640);
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', 300, 640 + (dy * i) / 6);
      await page.waitForTimeout(16);
    }
    await run(secs);
    await touch('touchEnd');
  };
  await page.evaluate(() => {
    window.__game.flight.glideSpeed = 0;
    window.__game.audio.unlock();
  });
  await phase('curb-zone');
  await run(1);
  await flick(cdp, -1);
  await run(3);
  await phase('curb-land');
  await flick(cdp, -1);
  await run(4);
  await phase('curb-roll');
  await run(20);
  await phase('curb-push');
  await hold(-130, 4);
  await phase('curb-driveby');
  await page.waitForFunction(() => window.__game.flight.fullness >= 0.999, null, { timeout: 20000, polling: 50 }).catch(() => {});
  await page.touchscreen.tap(300, 380);
  await run(3);
  await phase('curb-off');
  await flick(cdp, 1);
  await run(3);
  await phase('curb-again');
  await hold(-130, 8);
  await run(3);
  await phase('curb-pull');
  await hold(130, 2);
  await run(2);
  await phase('done');
  return page.evaluate(() => { const c = window.__game.curb; return { state: c.state, left: c.left, asked: c.qa.asked, dabs: c.qa.dabs, passes: c.qa.passes, hits: window.__game.life.qa.hits }; });
};

let lowRun = null, curbRun = null;
if (opt.low) lowRun = await low();
if (opt.moon) await moon();
if (opt.curb) curbRun = await curb();
const street = !opt.moon && !opt.low && !opt.curb;
if (street) await phase('opening-end');
if (street) await run(2);
let blast = null;
let crewRun = null;
let hoseRun = null;
let cometRun = null;
let boomRun = null;
let fallsRun = null;
let bombRun = null;
if (street) {
// the climb to the vista (the yoke pulled: sy -1), and a look around up there
await phase('climb');
await page.evaluate(() => (window.__qa = { sx: 0, sy: -1 }));
await run(9);
await page.evaluate(() => (window.__qa = { sx: 0.6, sy: 0 }));
await run(4);
// three blasts on one building: a street sign, then rooftop gardens (L2), then the crowns (L3)
await phase('blasts');
await place(37.77615, -122.4352, 60, Math.PI / 2);
await settle();
await run(1.5);
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__game.barfAtLatLon(37.7762, -122.43262));
  await run(2.2);
}
// (did it escalate? the most painted building there should be at level 3, with its gardens)
blast = await page.evaluate(() => {
  const g = window.__game;
  const [x, z] = window.__ll(37.7762, -122.43262);
  let top = 0;
  for (const n of g.city.buildingsNear(x, z, 40, [])) top = Math.max(top, g.city.paint.level(n.ref.index));
  return { maxLevel: top, ...g.paintedNear(37.7762, -122.43262, 40) };
});
// --hose: a tap, a hold to aim and its pour, a sweep, the tank dry and refilled, and a homing shot through the hook, all by real touches
if (opt.hose) {
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 8, radiusY: 8, force: 1 })) });
  const wait = (ms) => page.waitForTimeout(ms);
  const state = () => page.evaluate(() => window.__game.hoseState());
  hoseRun = {};
  await phase('hose-tap');
  await place(37.7752, -122.44, 60, Math.PI / 2 + 0.09);
  await page.evaluate(() => (window.__qa = null));
  await settle();
  await run(1.5);
  // (a first touch in the lane: the page's first touch runs a long task in its touchstart, and CDP's dispatch waits on it, so a 150 ms tap sent after it
  // is down for 390 ms by the page's clock: a hold, honestly)
  await touch('touchStart', [[196, 760]]);
  await wait(60);
  await touch('touchEnd', []);
  await run(1);
  await page.evaluate(() => window.__game.forceReady());
  await touch('touchStart', [[300, 300]]);
  await wait(150);
  await touch('touchEnd', []);
  await run(1.5);
  hoseRun.tap = await page.evaluate(() => ({ last: window.__game.lastShot(), hose: window.__game.hoseState().stats }));
  await phase('hose-pour');
  await page.evaluate(() => window.__game.forceReady());
  await touch('touchStart', [[300, 330]]);
  await wait(1200);
  hoseRun.pouring = (await state()).pouring;
  await phase('hose-sweep');
  for (let i = 1; i <= 24; i++) {
    await touch('touchMove', [[300 - 8 * i, 330 + 4 * i]]);
    await wait(50);
  }
  await wait(1200);
  await touch('touchEnd', []);
  hoseRun.afterPour = (await state()).stats;
  await phase('hose-refill');
  await wait(3500);
  hoseRun.refilled = (await state()).tank;
  // the hook: a handler that takes the next hold and fires a homing shot from its release at a point 500 m ahead, at the bus's height or 40 m over the roofs
  // there (30 m over the ground was in the houses, and the shot ended as a miss into the city)
  await phase('hose-homing');
  await page.evaluate(() => {
    const g = window.__game, H = (window.__wcHoming = { took: 0, fired: 0, white: 0, hit: 0, miss: null });
    const off = g.holds.add({
      name: 'warm-lock',
      start: () => (H.took++, true),
      end(h, cancelled) {
        off();
        if (cancelled) return;
        const f = g.flight, x0 = f.x + f.fx * 500, z0 = f.z + f.fz * 500, y0 = Math.max(g.city.surfaceAt(x0, z0) + 40, f.y);
        const s = g.holds.fire({ target: (o) => (o.set(x0, y0, z0), true), speed: 300, turn: 2.2, white: 0.7, onWhite: () => H.white++, onHit: () => H.hit++, onMiss: (_a, _s, w) => (H.miss = w) });
        if (s) H.fired++;
      },
    });
  });
  await page.evaluate(() => window.__game.forceReady());
  await touch('touchStart', [[200, 300]]);
  await wait(700);
  await touch('touchEnd', []);
  await wait(3000);
  hoseRun.homing = await page.evaluate(() => window.__wcHoming);
}
// --crew: the faction crest, a real tap on it and on each swatch, and each faction's paint at three levels
if (opt.crew) {
  await phase('crew');
  crewRun = [];
  const tapHud = async (name) => {
    const b = await page.locator(`[data-hud="${name}"]`).boundingBox({ timeout: 8000 }).catch(async (e) => {
      await page.screenshot({ path: `${out}.fail.png` }).catch(() => {});
      console.log('[crew]', name, 'not found:', await page.evaluate(() => ({ url: location.href, hud: [...document.querySelectorAll('[data-hud]')].map((x) => x.dataset.hud) })).catch((x) => String(x)));
      throw e;
    });
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await run(0.3);
  };
  // (about 400 m apart: an 85 m splat from the bus's height grows to about 130 m, so no faction's blasts reach another's spot. Review of step 1, 12)
  const spots = [[37.7762, -122.4306], [37.7762, -122.4261], [37.7798, -122.4351], [37.7726, -122.4351], [37.7798, -122.4306]];
  const keys = ['atlantis', 'elderwood', 'hyperglow', 'inferno', 'rainbow'];
  // (--crewr=60: the blasts at that radius, today's before the shots' rework, to tell the switch's cost from the bigger splat's)
  if (opt.crewr) await page.evaluate((r) => (window.__game.config.splat.blastRadius = r), Number(opt.crewr));
  const now = () => page.evaluate(() => Math.round(performance.now()));
  for (let k = 0; k < keys.length; k++) {
    const at = { switch: await now(), blasts: [] };
    await tapHud('crew');
    await tapHud(`crew-${keys[k]}`);
    for (let i = 0; i < 3; i++) {
      at.blasts.push(await now());
      await page.evaluate(([a, b]) => window.__game.barfAtLatLon(a, b), spots[k]);
      await run(2.2);
    }
    crewRun.push(await page.evaluate(([key, [la, lo]]) => {
      const g = window.__game, [x, z] = window.__ll(la, lo), owners = {};
      let top = 0;
      for (const n of g.city.buildingsNear(x, z, 40, [])) {
        const r = g.city.paint.get(n.ref.index);
        top = Math.max(top, r.level);
        if (r.level > 0.5) owners[r.faction] = (owners[r.faction] ?? 0) + 1;
      }
      return { key, faction: g.splatter.faction, maxLevel: top, owners };
    }, [keys[k], spots[k]]));
    crewRun[k].at = at;
  }
}
// --comet: a Comet's full show and its lighter one at Jet, by real taps off the lane, in every faction with --crew
if (opt.comet) {
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 8, radiusY: 8, force: 1 })) });
  const tapAt = async (x, y) => {
    await touch('touchStart', [[x, y]]);
    await page.waitForTimeout(110);
    await touch('touchEnd', []);
  };
  const tapCrest = async (name) => {
    const b = await page.locator(`[data-hud="${name}"]`).boundingBox({ timeout: 8000 });
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await run(0.3);
  };
  cometRun = [];
  // (the page's first touch runs a long task: one in the lane first, as --hose does)
  await touch('touchStart', [[196, 760]]);
  await page.waitForTimeout(60);
  await touch('touchEnd', []);
  for (const key of opt.crew ? ['atlantis', 'elderwood', 'hyperglow', 'inferno', 'rainbow'] : [null]) {
    if (key) {
      await tapCrest('crew');
      await tapCrest(`crew-${key}`);
    }
    await phase(`comet-${key ?? 'plain'}`);
    // (held there while the city streams in: at Jet a long settle flew the bus kilometres on, over the bay, where a Comet is a miss)
    await page.evaluate(() => {
      const g = window.__game;
      const [x, z] = window.__ll(37.7756, -122.4655);
      const y = g.city.groundAt(x, z) + 150;
      window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
      Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0, speed: 450 });
      g.controls.turbo.arrive(3, 0);
    });
    await settle();
    await page.evaluate(() => (window.__qa = null));
    await run(2.5);
    for (const show of ['full', 'light']) {
      await page.evaluate(() => window.__game.forceReady());
      await run(0.4);
      const before = await page.evaluate(() => window.__game.cometState());
      await tapAt(300, 300);
      await run(3.4);
      const after = await page.evaluate(() => {
        const g = window.__game, l = g.lastShot(), c = l?.comet;
        return { ...g.cometState(), last: l, ground: c ? g.city.groundAt(c.x, c.z) : null, inFlight: g.splatter.inFlight, faction: g.splatter.faction };
      });
      const c = after.last?.comet;
      cometRun.push({ key, show, faction: after.faction, planned: !!before.plan, fired: after.fired - before.fired, full: after.full - before.full, booms: after.booms - before.booms, drops: after.drops - before.drops, pillars: after.pillars - before.pillars, gear: after.gear, inFlight: after.inFlight, last: c && { reach: Math.round(c.reach), pass: +c.pass.toFixed(2), loaded: c.loaded, wall: c.wall, target: c.target, x: Math.round(c.x), y: Math.round(c.y), z: Math.round(c.z), ground: Math.round(after.ground), miss: !!after.last.miss } });
    }
  }
}
// --bomb: Bomb II and III at Cruise, a Bomb III at Jet on the Comet's landing, and a gift, by real touches held still on the bus, in every faction with --crew
if (opt.bomb) {
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 8, radiusY: 8, force: 1 })) });
  const tapCrest = async (name) => {
    const b = await page.locator(`[data-hud="${name}"]`).boundingBox({ timeout: 8000 });
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await run(0.3);
  };
  const state = () => page.evaluate(() => {
    const g = window.__game, s = g.bombState(), l = g.lastShot();
    return { ...s.stats, box: s.box, full: g.cometState().full, comet: !!l?.comet, gear: g.controls.turbo.name, faction: g.splatter.faction };
  });
  // (held still on the middle of the bus's box for ms, then lifted: II shows at 0.69 s, III at 1.29)
  const bombHold = async (key, kind, ms) => {
    await page.evaluate(() => window.__game.forceReady());
    await run(0.5);
    const a = await state();
    if (!a.box) return bombRun.push({ key, kind, error: 'no busBox' });
    const x = Math.round((a.box.x0 + a.box.x1) / 2), y = Math.round((a.box.y0 + a.box.y1) / 2);
    await touch('touchStart', [[x, y]]);
    await page.waitForTimeout(ms);
    await touch('touchEnd', []);
    await run(3.5);
    const b = await state();
    bombRun.push({ key, kind, faction: b.faction, gear: b.gear, at: [x, y], fired: b.fired - a.fired, fizzles: b.fizzles - a.fizzles, taps: b.taps - a.taps, tier: b.tier, radius: Math.round(b.radius), jump: b.jump, gift: b.gift, comet: b.comet, full: b.full - a.full });
  };
  bombRun = [];
  // (the page's first touch runs a long task: one in the lane first, as --hose does)
  await touch('touchStart', [[196, 760]]);
  await page.waitForTimeout(60);
  await touch('touchEnd', []);
  // (every faction's Cruise Bombs first, then every faction's at Jet: back down from Jet a bus still at Jet's speed flew its box off the screen)
  const keys = opt.crew ? ['atlantis', 'elderwood', 'hyperglow', 'inferno', 'rainbow'] : [null];
  for (const key of keys) {
    if (key) {
      await tapCrest('crew');
      await tapCrest(`crew-${key}`);
    }
    await phase(`bomb-${key ?? 'plain'}-cruise`);
    await place(37.7752, -122.44, 60, Math.PI / 2 + 0.09);
    await page.evaluate(() => (window.__qa = null));
    await settle();
    await run(1.5);
    await bombHold(key, 'II', 1000);
    await bombHold(key, 'III', 1700);
    await phase(`bomb-${key ?? 'plain'}-gift`);
    await page.evaluate(() => window.__game.holds.bomb.gift(3));
    await bombHold(key, 'gift', 650);
  }
  for (const key of keys) {
    if (key) {
      await tapCrest('crew');
      await tapCrest(`crew-${key}`);
    }
    await phase(`bomb-${key ?? 'plain'}-jet`);
    // (held there while the city streams in, as --comet's)
    await page.evaluate(() => {
      const g = window.__game;
      const [x, z] = window.__ll(37.7756, -122.4655);
      const y = g.city.groundAt(x, z) + 150;
      window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
      Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0, speed: 450 });
      g.controls.turbo.arrive(3, 0);
    });
    await settle();
    await page.evaluate(() => (window.__qa = null));
    await run(2.5);
    await bombHold(key, 'jet', 1700);
  }
}
// --boom: the flick into Turbo 3 at Turbo 2's 720 m/s, 150 m over the Western Addition, in every faction with --crew
if (opt.boom || opt.falls) {
  const cdp = await ctx.newCDPSession(page);
  const tapCrest = async (name) => {
    const b = await page.locator(`[data-hud="${name}"]`).boundingBox({ timeout: 8000 });
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await run(0.3);
  };
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 8, radiusY: 8, force: 1 })) });
  // (the page's first touch runs a long task: one in the lane first, as --hose does)
  await touch('touchStart', [[196, 760]]);
  await page.waitForTimeout(60);
  await touch('touchEnd', []);
  const keys = opt.crew ? ['atlantis', 'elderwood', 'hyperglow', 'inferno', 'rainbow'] : [null];
  if (opt.boom) {
    boomRun = [];
    for (const key of keys) {
      if (key) {
        await tapCrest('crew');
        await tapCrest(`crew-${key}`);
      }
      await phase(`boom-${key ?? 'plain'}`);
      // (held 1.1 km short of the ring's place while the city streams in, at Turbo 2)
      await page.evaluate(() => {
        const g = window.__game;
        const [x, z] = window.__ll(37.7795, -122.4335);
        const y = g.city.groundAt(x - 950, z) + 150;
        window.__qa = { pin: { x: x - 950, z, heading: Math.PI / 2, y } };
        Object.assign(g.flight, { x: x - 950, z, heading: Math.PI / 2, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0, speed: 720 });
        g.controls.turbo.arrive(3, 2);
      });
      await settle();
      const a = await page.evaluate(() => ((window.__qa = null), { ...window.__game.boomState().stats, level: window.__game.controls.turbo.level }));
      await run(0.2);
      await flick(cdp, 1);
      // (4.2 s: the crack's flash and pressure ring, the hoop out from the nose and standing, threaded about a second on, slammed onto the band and lying
      // there 2 s, the ring's band in the faction's rows and its crown, the contrail in its spray)
      await run(4.2);
      const b = await page.evaluate(() => {
        const g = window.__game, s = g.boomState();
        return { stats: s.stats, kind: s.plan?.kind ?? null, threaded: s.plan?.threaded ?? null, level: g.controls.turbo.level, faction: g.splatter.faction };
      });
      boomRun.push({ key, faction: b.faction, level: [a.level, b.level], kind: b.kind, threaded: b.threaded, rings: b.stats.rings - a.rings, cracks: b.stats.cracks - a.cracks, flicks: b.stats.flicks - a.flicks });
      // (the 10 s run out before the next faction's)
      await page.evaluate(() => (window.__game.boom.last = -Infinity));
    }
  }
  if (opt.falls) {
    fallsRun = [];
    for (const key of keys) {
      if (key) {
        await tapCrest('crew');
        await tapCrest(`crew-${key}`);
      }
      await phase(`falls-${key ?? 'plain'}`);
      // (over the Financial District first, while its tiles stream in)
      await page.evaluate(() => {
        const g = window.__game;
        const [cx, cz] = window.__ll(37.7946, -122.3999);
        const y = g.city.groundAt(cx, cz) + 200;
        window.__qa = { pin: { x: cx - 300, z: cz, heading: Math.PI / 2, y } };
        Object.assign(g.flight, { x: cx - 300, z: cz, heading: Math.PI / 2, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0 });
      });
      await run(1.5);
      await settle();
      // (a Financial District tower's roof, through the real splat pipeline as __game.splatAt does a tap, the bus 300 m west of it, 60 m over its roof; the
      // next tower if it didn't pour: a footprint whose middle lies off it lands the tap on its edge, a podium's roof under 40 m)
      let tries = 0, r = null, b = null, p0 = 0;
      for (let k = keys.indexOf(key); tries < 3 && !(b && b.pours > p0); k += 5, tries++) {
        r = await page.evaluate(async (k) => {
          const g = window.__game;
          const [cx, cz] = window.__ll(37.7946, -122.3999);
          const all = g.city.buildingsWithin(cx, cz, 700, []).map((n) => n.ref).filter((r) => r.stableId >= 0 && r.roofY - r.baseY > 60 && g.city.roofAtPart(r, r.cx, r.cz, Infinity) - r.baseY > 45);
          const t = all[(k ?? 0) % Math.max(1, all.length)];
          if (!t) return { error: 'no tower' };
          const y = t.roofY + 60;
          window.__qa = { pin: { x: t.cx - 300, z: t.cz, heading: Math.PI / 2, y } };
          Object.assign(g.flight, { x: t.cx - 300, z: t.cz, heading: Math.PI / 2, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0 });
          return { index: t.index, cx: t.cx, cz: t.cz, h: t.roofY - t.baseY };
        }, k);
        await settle();
        p0 = await page.evaluate(() => window.__game.falls.stats.pours);
        await page.evaluate((r) => {
          const g = window.__game, t = g.city.buildingsWithin(r.cx, r.cz, 5, []).map((n) => n.ref).find((q) => q.index === r.index);
          if (t) g.splatter.barf(t.cx, t.cz, { target: t, drop: 60, hitStop: 0 });
        }, r);
        await run(3.5);
        b = await page.evaluate(() => ((window.__qa = null), { ...window.__game.falls.stats, faction: window.__game.splatter.faction }));
      }
      fallsRun.push({ key, faction: b.faction, tower: r, tries, pours: b.pours - p0, pools: b.pools, drops: b.drops });
    }
  }
}
// the landmarks from altitude: west of the pyramid at 430 m heading east, then Sutro Tower from the east
await phase('landmarks');
await place(37.7952, -122.4130, 430, Math.PI / 2);
await settle();
await run(4);
await place(37.7552, -122.4400, 380, -Math.PI / 2);
await settle();
await run(4);
await phase('done');

}

// first draws after the warm-up, by what a pipeline is keyed on: the glow and resolve targets are all RGBA8
const firstDraws = await page.evaluate((warmDoneAt) => {
  const D = window.__wc.draws, p = window.__game.pipeline, pr = p.renderer.properties, programs = p.renderer.info.programs;
  const target = (fb) => (fb === null ? 'canvas' : fb === pr.get(p.shadowRT).__webglFramebuffer ? 'sun' : fb === pr.get(p.gbuf).__webglFramebuffer ? 'g-buffer' : 'rgba8');
  const name = (pg) => {
    const x = programs.find((q) => q.program === pg);
    return x ? `${x.name || x.cacheKey.slice(0, 8)}#${x.id}` : '?';
  };
  const first = new Map();
  for (const e of D.seen.values()) {
    const k = `${name(e.prog)} into ${target(e.fb)}, mask ${e.mask}, ${e.blend}, ${e.cls}`;
    if (!first.has(k) || e.t < first.get(k).t) first.set(k, e);
  }
  window.__wc.draws = null;
  return { keys: first.size, after: [...first].filter(([, e]) => e.t > warmDoneAt).map(([k, e]) => `${k} (${e.phase}, frame ${e.shown})`) };
}, info.warmDoneAt);
const W = await page.evaluate(() => window.__wc);
const after = W.programs.filter(([t]) => t > info.warmDoneAt);
const res = {
  url,
  throttle: opt.throttle ?? 1,
  readyMs,
  // (the street lamps' list, asked for once the city is in and the Sun is under 3 degrees: ms after ready, under 0 before it, null if it never was)
  lamps: await page.evaluate((r) => {
    const s = window.__game.sky, l = s?.hour?.lamps ?? s?.lamps, at = (t) => (t >= 0 ? Math.round(t - r) : null);
    return l && 'askedAt' in l ? { askedAfterReadyMs: at(l.askedAt), landedAfterReadyMs: at(l.landedAt) } : null;
  }, readyAt),
  warm: info.report && { programs: info.report.programs, draws: info.report.draws, doneMs: info.report.doneMs },
  programsAtReady: info.programsAtReady,
  blast,
  crew: crewRun,
  hose: hoseRun,
  comet: cometRun,
  bomb: bombRun,
  boom: boomRun,
  falls: fallsRun,
  low: lowRun,
  curb: curbRun,
  programsTotal: W.programs.length,
  programsAfterWarmup: after.length,
  programsAfterWarmupByPhase: after.map(([t, p]) => `${p}@${t}`),
  drawKeys: firstDraws.keys,
  firstDrawsAfterWarmup: firstDraws.after,
  framesOver100AfterReady: W.frames.filter(([, , p]) => p !== 'load'),
  longTasksOver100AfterReady: W.long.filter(([, d, p]) => p !== 'load' && d > 100),
  longTasksDuringLoad: W.long.filter(([, , p]) => p === 'load').sort((a, b) => b[1] - a[1]).slice(0, 8),
};
writeFileSync(out, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 1));
await browser.close();
