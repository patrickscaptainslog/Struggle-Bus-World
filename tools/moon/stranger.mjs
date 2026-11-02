#!/usr/bin/env node
// A whole flight, as a stranger flies it, with real touches and nothing but what's on the screen: node tools/moon/stranger.mjs <out dir> [options]
// TURBO to the Moon, a thumb pushed down to the ground, skimming, taps at what glints, TURBO back out to the orbit, TURBO home. One page, one link. What it says at the end: every leg, what compiled in flight, every long frame and what was going on.
//   --t=2026-11-25T04:00:00Z   the date: full Moon by default, 2026-11-09T22:00:00Z is about new
//   --q=                       more of the URL
//   --real                     the flight to the Moon and home flown in real time. Without it the long dark is skipped: the route's own step, not drawn
//   --lap=s                    seconds of orbit skipped before the push: round to the far side (200 is about half a lap)
//   --splash=n                 taps from orbit before going down
//   --paint=n                  taps at what glints, down there
//   --out=gears|pull           how it leaves: TURBO's gears, or a held thumb in Jet to the hand-back and then TURBO
//   --again=n                  down and up this many more times before going home
//   --steer=px                 a sideways thumb on the way down
//   --down=s                   how long it skims before it leaves
//   --dt=                      the game's fixed step: with one, nothing here is a timing
//   --burst                    frames as fast as they'll come through the joins on the way up
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const has = (k) => args.includes(`--${k}`);
const dir = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', '2026-11-25T04:00:00Z'), extra = opt('q', ''), real = has('real'), lap = Number(opt('lap', 0)), splash = Number(opt('splash', 0)), paint = Number(opt('paint', 2)), out = opt('out', 'gears'), again = Number(opt('again', 0)), steer = Number(opt('steer', 0)), dt = opt('dt', ''), down = Number(opt('down', 6)), burst = has('burst');
mkdirSync(join(dir, 'burst'), { recursive: true });
const W = 393, H = 852;
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const errors = [];
let shots = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall') && !m.text().includes('did not converge') && !m.text().includes('404')) errors.push(`${m.type()} ${m.text().slice(0, 300)}`);
  });
  const t0 = Date.now();
  await page.goto(`${BASE}?moonland&t=${t}${dt ? `&fixeddt=${dt}` : ''}${extra ? `&${extra}` : ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  console.log(`first frame ${Date.now() - t0} ms`);
  await page.waitForFunction(() => window.__space?.moon.landing.world != null, null, { timeout: 180000 });
  console.log(`low game ready ${Date.now() - t0} ms`);
  await page.evaluate(() => {
    const s = window.__space, m = s.moon, g = window.__game, info = s.pipeline.renderer.info;
    window.__compiled = [];
    const src = WebGL2RenderingContext.prototype.shaderSource;
    WebGL2RenderingContext.prototype.shaderSource = function (sh, text) {
      window.__compiled.push([text.length, m.trip.leg, Math.round(m.landing.height)]);
      return src.call(this, sh, text);
    };
    window.__frames = [];
    window.__draws = {};
    // (every frame: where the bus stands on the screen, how far the lens has moved and turned, and the lens: what a join would show as a step)
    const cam = s.camera, THREE_V = cam.position.constructor, THREE_Q = cam.quaternion.constructor, pv = new THREE_V(), pq = new THREE_Q(), bv = new THREE_V();
    window.__track = [];
    const track = () => {
      const low = m.landing.ground, f = g.flight;
      if (m.trip.leg === 'fall' || m.trip.leg === 'ground') {
        // (the bus's own place: its position has the frame's snap on it, which goes with the render)
        if (low) bv.set(f.x, f.y, f.z);
        else bv.copy(m.landing.bus);
        cam.updateMatrixWorld();
        const p = bv.clone().project(cam), w = window.innerWidth, h = window.innerHeight;
        window.__track.push([low ? 1 : 0, +(low ? f.height / 1000 : m.landing.height).toFixed(2), Math.round((p.x * 0.5 + 0.5) * w), Math.round((0.5 - p.y * 0.5) * h), +cam.position.distanceTo(pv).toFixed(0), +((cam.quaternion.angleTo(pq) * 180) / Math.PI).toFixed(3), +cam.fov.toFixed(2), +cam.position.distanceTo(bv).toFixed(0), +(low ? f.nose * 57.3 : m.trip.nose * 57.3).toFixed(1)]);
      }
      pv.copy(cam.position);
      pq.copy(cam.quaternion);
    };
    for (const pl of [s.pipeline]) {
      const f = pl.render.bind(pl);
      pl.render = (...a) => {
        track();
        return f(...a);
      };
    }
    let last = performance.now();
    info.autoReset = false;
    const tick = (now) => {
      window.__frames.push([Math.round(now - last), m.trip.leg, Math.round(m.landing.ground ? g.flight.height / 1000 : m.landing.height), m.landing.ground ? 1 : 0]);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (const perf of [s.perf, g.perf]) {
      const f = perf.frame.bind(perf);
      perf.frame = (a, b) => {
        const leg = m.trip.leg, k = leg === 'ground' ? (g.flight.height < 500 ? 'ground, low' : 'ground, high') : m.landing.near ? 'mesh' : leg;
        const d = (window.__draws[k] ??= [0, 0]);
        d[0] = Math.max(d[0], info.render.calls);
        d[1] = Math.max(d[1], info.render.triangles);
        info.reset();
        f(a, b);
      };
    }
  });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
  const read = () => page.evaluate(() => {
    const s = window.__space, m = s.moon, g = window.__game, f = g.flight, l = m.landing, tr = m.trip, r = (x, k = 1) => +(+x).toFixed(k);
    const low = l.ground;
    return {
      leg: tr.leg, clock: r(tr.t, 1), h: low ? r(f.height / 1000, 2) : r(l.height, 1), v: low ? r(f.speed) : r(tr.v * tr.gov * 1000), nose: r(((low ? f.nose : tr.nose) * 180) / Math.PI, 0), show: r(l.show, 2), near: l.near, low,
      gear: low ? g.controls.turbo.gear : tr.gear, y: low ? r(f.y - g.city.groundAt(f.x, f.z), 1) : null, gap: low ? r(f.y - f.floorY, 1) : null, tiles: g.city.loadedRegionCount(), say: document.querySelector('[data-hud="trip-label"]')?.dataset.say ?? '', toast: [...document.querySelectorAll('[data-hud="toast"]')].map((e) => e.getAttribute('aria-label') ?? '').join('/'), hudLow: g.controls.hud.root.style.display !== 'none',
      painted: g.moon.paint.recs.size, orbit: +(m.breath.paint.painted * 100).toFixed(3), glint: !!g.moon.paint.target, full: f.fullness >= 0.999,
    };
  });
  const say = (s) => console.log(`${s.clock.toFixed(1).padStart(7)} s ${String(s.leg).padEnd(10)} ${String(s.h).padStart(9)} km ${String(s.v).padStart(9)} m/s nose ${String(s.nose).padStart(4)} G${s.gear} show ${s.show} ${s.low ? `clearance ${s.y} gap ${s.gap}` : ''} ${s.say.split('|').filter(Boolean).slice(2).join(' / ')}`);
  const shot = async (name) => page.screenshot({ path: join(dir, `${String(shots++).padStart(3, '0')}-${name}.png`) });
  const turbo = async () => {
    const b = await page.evaluate(() => {
      const e = [...document.querySelectorAll('[data-hud="turbo"]')].map((x) => x.getBoundingClientRect()).find((r) => r.width > 0);
      return e ? [e.left + e.width / 2, e.top + e.height / 2] : null;
    });
    if (!b) throw new Error('no TURBO on the screen');
    await touch('touchStart', [[b[0], b[1], 5]]);
    await page.waitForTimeout(60);
    await touch('touchEnd', []);
  };
  const tapAt = async (x, y) => {
    await touch('touchStart', [[x, y, 6]]);
    await page.waitForTimeout(70);
    await touch('touchEnd', []);
  };
  const x0 = W / 2, y0 = H * 0.68;
  const holdThumb = async (dx, dy) => {
    await touch('touchStart', [[x0, y0, 1]]);
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', [[x0 + (dx * i) / 6, y0 + (dy * i) / 6, 1]]);
      await page.waitForTimeout(16);
    }
  };
  const thumbTo = async (dx, dy) => touch('touchMove', [[x0 + dx, y0 + dy, 1]]);
  const lift = async () => touch('touchEnd', []);
  /** Goes on until `until(state)`, a line every `every` game seconds and a frame with it; false if it never came. */
  const fly = async (name, until, { secs = 120, every = 4, frames = true, each = null } = {}) => {
    const wall = Date.now();
    let s = await read(), at = -1e9;
    for (;;) {
      s = await read();
      if (each) await each(s);
      if (s.clock - at >= every) {
        at = s.clock;
        say(s);
        if (frames) await shot(`${name}-${s.h}km`);
      }
      if (until(s)) {
        say(s);
        return s;
      }
      if (Date.now() - wall > secs * 1000) {
        console.log(`  ${name}: out of time, ${JSON.stringify(s)}`);
        return null;
      }
      await page.waitForTimeout(100);
    }
  };

  // ---- to the Moon
  await shot('home');
  await turbo();
  if (real) {
    await page.waitForTimeout(3000);
    await turbo();
    await fly('out', (s) => s.leg === 'orbit', { secs: 400, every: 15 });
  } else {
    await page.evaluate(() => {
      const m = window.__space.moon;
      m.hold(true);
      for (let i = 0; i < 40000 && m.trip.leg !== 'orbit'; i++) m.skip(0.05);
      m.hold(false);
    });
  }
  await page.waitForTimeout(1500);
  if (lap) {
    await page.evaluate((lap) => {
      const m = window.__space.moon;
      m.hold(true);
      m.skip(lap);
      m.hold(false);
    }, lap);
    await page.waitForTimeout(600);
  }
  let s = await read();
  say(s);
  console.log(`  says: ${s.say}`);
  await shot('orbit');
  for (let i = 0; i < splash; i++) {
    await tapAt(W / 2, H * 0.42);
    await page.waitForTimeout(3600);
  }
  if (splash) {
    s = await read();
    console.log(`  splashes: ${s.orbit} % of the Moon`);
    await page.waitForTimeout(2500);
    await shot('splashed');
  }

  for (let round = 0; round <= again; round++) {
    // ---- down: a thumb, pushed and held, as far as it goes
    console.log(`--- down ${round + 1}`);
    await holdThumb(steer, -90);
    s = await fly('down', (s) => s.leg === 'ground' && s.gap !== null && s.gap < 20, { every: 6 });
    if (!s) break;
    await lift();
    await page.waitForTimeout(1500);
    await fly('skim', (s) => s.gap !== null && s.gap < 6, { secs: 12, every: 3 });
    await shot('floor');
    // ---- paint: what glints, a tap at a time, steering a little in between
    let hits = 0;
    const wall = Date.now();
    while (hits < paint && Date.now() - wall < 40000) {
      s = await read();
      if (s.glint && s.full) {
        await tapAt(W / 2, H * 0.3);
        hits++;
        await page.waitForTimeout(1500);
        s = await read();
        console.log(`  tap ${hits}: ${s.painted} craters painted`);
        await shot(`paint${hits}`);
      } else await page.waitForTimeout(150);
    }
    await page.waitForTimeout(down * 1000);
    await shot('skimmed');
    s = await read();
    say(s);

    // ---- up
    console.log(`--- up ${round + 1}, ${out}`);
    if (out === 'pull') {
      await turbo();
      await page.waitForTimeout(800);
      await holdThumb(0, 110);
      s = await fly('jet', (s) => s.leg === 'fall', { secs: 80, every: 6 });
      await lift();
      await page.waitForTimeout(1000);
      s = await read();
      say(s);
      console.log(`  says: ${s.say}`);
      await shot('handed');
      await turbo();
    } else {
      await turbo();
      await page.waitForTimeout(700);
      await turbo();
      await page.waitForTimeout(700);
      await turbo();
    }
    let b = 0;
    s = await fly('up', (s) => s.leg === 'orbit', {
      secs: 90,
      every: 3,
      each: async (s) => {
        if (burst && ((s.h >= 12 && s.h <= 20) || (s.h >= 115 && s.h <= 250))) await page.screenshot({ path: join(dir, 'burst', `${String(b++).padStart(3, '0')}-${s.h}km.png`) });
      },
    });
    if (!s) break;
    await page.waitForTimeout(2500);
    s = await read();
    say(s);
    console.log(`  says: ${s.say}`);
    await shot('orbit-again');
  }

  // ---- home
  console.log('--- home');
  await turbo();
  if (real) await fly('home', (s) => s.leg === 'wait', { secs: 400, every: 15 });
  else {
    await page.waitForTimeout(3000);
    await shot('leaving');
    await page.evaluate(() => {
      const m = window.__space.moon;
      m.hold(true);
      for (let i = 0; i < 80000 && !(m.trip.leg === 'homeDrop' && m.trip.hEarth < 1500); i++) m.skip(0.05);
      m.hold(false);
    });
    await fly('home', (s) => s.leg === 'wait', { secs: 60, every: 5 });
  }
  await page.waitForTimeout(1000);
  await shot('home-again');
  s = await read();
  say(s);
  console.log(`  says: ${s.say}`);
  const end = await page.evaluate(() => {
    const frames = window.__frames, legs = {};
    for (const [ms, leg] of frames) (legs[leg] ??= []).push(ms);
    const long = [];
    for (let i = 1; i < frames.length; i++) if (frames[i][0] > 34) long.push(frames[i]);
    return {
      compiled: window.__compiled,
      legs: Object.fromEntries(Object.entries(legs).map(([k, v]) => [k, { frames: v.length, mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), worst: [...v].sort((x, y) => y - x).slice(0, 3) }])),
      long: long.slice(0, 40),
      joins: (() => {
        const t = window.__track, out = [];
        for (let i = 1; i < t.length; i++) if (t[i][0] !== t[i - 1][0]) out.push(t.slice(Math.max(0, i - 4), i + 6));
        return out;
      })(),
      longCount: long.length,
      draws: window.__draws,
      trips: window.__space.moon.trip.trips,
    };
  });
  for (const j of end.joins) {
    console.log('join (low, km, bus x, bus y, lens moved m, lens turned deg, fov, lens to bus m, nose):');
    for (const r of j) console.log('  ' + r.join('  '));
  }
  delete end.joins;
  console.log(JSON.stringify(end));
  writeFileSync(join(dir, 'end.json'), JSON.stringify(end));
} finally {
  console.log(errors.length ? `errors:\n  ${errors.slice(0, 12).join('\n  ')}` : 'no errors');
  await browser.close();
}
