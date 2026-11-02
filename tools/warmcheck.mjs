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
// --moon: the url is ?moonrun: no city, so the phases are the flight's: TURBO's real touches, out and home.
// Wall clock, real GPU (tools/browser.mjs): meaningful on a laptop, not in the cloud's SwiftShader.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

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
  const turbo = await page.locator('[data-hud="turbo"]').boundingBox();
  const tap = () => page.touchscreen.tap(turbo.x + turbo.width / 2, turbo.y + turbo.height / 2);
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

if (opt.moon) await moon();
if (!opt.moon) await phase('opening-end');
if (!opt.moon) await run(2);
let blast = null;
if (!opt.moon) {
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
  warm: info.report && { programs: info.report.programs, draws: info.report.draws, doneMs: info.report.doneMs },
  programsAtReady: info.programsAtReady,
  blast,
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
