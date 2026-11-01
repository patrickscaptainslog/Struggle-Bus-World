#!/usr/bin/env node
// Controls QA in the real game (index.html), iPhone portrait viewport, touch + mobile emulation.
//   node tools/controls.mjs <baseUrl> <outDir> [touch] [thumbs] [turbo] [firstrun] [opening] [layout] [states] [keyboard] [audio] [perf=<otherBaseUrl>]
//
//   touch    shots of the HUD and the settings panel; real gestures on MEGA (tap / hold / slide)      -> touch in controls.json
//   thumbs   the gesture table through the real page: CDP multi-touch, real pointer events, the real Shifter and drive.
//            A row's events are stamped with CDP timestamps and sent while the game loop is frozen, so a stroke is
//            exactly as long as the row says on any host. tools/controls-sim/s_gesture.ts has every row; this is
//            the proof that the browser's own multi-touch reaches them              -> thumbs.json
//   turbo    flicks at Alamo Square: a lone left flick into G1 (the climb, engagement, the boom), two flicks, the levels,
//            a flick down, LOCKED, with shots and a per-frame log                                -> turbo.json
//   firstrun a first visit: no card, the cues in order (TAP, DRAG, HOLD)                         -> firstrun.json
//   opening  flicks under the opening's gate: answered, taken back, firing at the gate; a double -> opening.json
//   layout   real rects against layoutHud at 393 x 852, 393 x 659, 320 x 568, 852 x 393, swapped or not (shots)
//   states   every state of MEGA and the readout, cropped (states/*.png; tools/hud-sheet.py makes a sheet of them)
//   keyboard a desktop: Esc, Space, E, E twice, Q, Shift, the right mouse's look           -> keyboard in controls.json
//   audio    the turbo voice rendered offline through the real AudioEngine graph
//   perf=<otherBaseUrl>  CPU work ms, draw calls, triangles at the same Alamo Square view (cruising at the
//            floor, the fps meter's per-frame counters) for <otherBaseUrl> (e.g. the build before) and
//            <baseUrl>, in one browser session                                              -> perf in controls.json
// Launches through tools/browser.mjs (the GPU here, SwiftShader in the cloud): everything waits on the game
// clock (fixed 1/20 s steps), never wall time.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const [base = 'http://127.0.0.1:5101/', out = 'shots/controls', ...rest] = process.argv.slice(2);
const modes = new Set((rest.length ? rest : ['touch', 'thumbs', 'turbo', 'firstrun', 'opening', 'layout', 'states', 'keyboard', 'audio']).map((m) => m.split('=')[0]));
const perfOther = (rest.find((m) => m.startsWith('perf=')) ?? '').slice(5);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions());
const Q = '?lat=37.77628&lon=-122.4352&heading=88&skipintro&fixeddt=0.05';
const LOG_INPUT = () => {
  const g = window.__game, inp = g.input;
  window.__ev = [];
  for (const k of ['onTap', 'onChargeStart', 'onChargeEnd', 'onTurbo', 'onTripleFinger']) {
    const orig = inp[k];
    inp[k] = (...a) => {
      window.__ev.push({ k, a, t: +g.clock().toFixed(2) });
      return orig?.(...a);
    };
  }
};

async function open(query, init, at = base, opt = {}) {
  const page = await browser.newPage({ viewport: opt.viewport ?? { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  if (init) await page.addInitScript(init);
  await page.goto(at + query, { waitUntil: 'load' });
  await page.waitForFunction(opt.ready ?? (() => window.__shotReady === true && window.__game), null, { timeout: 400000 });
  // log the input contract's callbacks (wrapping what main / Controls installed)
  await page.evaluate(LOG_INPUT);
  return page;
}
const runFor = (page, s) =>
  page.evaluate(
    (s) =>
      new Promise((res) => {
        const g = window.__game;
        const t0 = g.clock();
        const tick = () => (g.clock() - t0 >= s ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    s,
  );
const until = (page, cond, maxS) =>
  page.evaluate(
    ([cond, maxS]) =>
      new Promise((res) => {
        const g = window.__game;
        const f = new Function('g', `return (${cond});`);
        const t0 = g.clock();
        const tick = () => (f(g) || g.clock() - t0 > maxS ? res(f(g)) : requestAnimationFrame(tick));
        tick();
      }),
    [cond, maxS],
  );
const rectOf = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}, sel);
const events = (page, clear = true) => page.evaluate((c) => { const e = window.__ev.slice(); if (c) window.__ev.length = 0; return e; }, clear);
const snap = (page) => page.evaluate(() => window.__game.controls.snapshot());
const wall = (ms) => new Promise((r) => setTimeout(r, ms));
const res = {};

/**
 * Real fingers over CDP: each is a point in the page's touch list. `at` (ms into the gesture, see stamped()) stamps the
 * event, so a stroke's length on the page's clock is the row's, whatever the round trip costs here.
 */
function hand(page, cdp) {
  const pts = new Map();
  let t0 = 0;
  const list = () => [...pts.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 }));
  const send = (type, at) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: list(), ...(at !== undefined ? { timestamp: t0 + at / 1000 } : {}) });
  return {
    get points() { return pts.size; },
    down(id, x, y, at) { pts.set(id, { x, y }); return send('touchStart', at); },
    move(id, x, y, at) { pts.set(id, { x, y }); return send('touchMove', at); },
    // (a touchEnd lists the point that lifts; empty, all of them)
    up(id, at) {
      const p = pts.get(id);
      pts.delete(id);
      return cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pts.size ? [{ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 }] : [], ...(at !== undefined ? { timestamp: t0 + at / 1000 } : {}) });
    },
    cancel() { pts.clear(); return send('touchCancel'); },
    /** run fn with the game loop frozen (frames are instant, the page sees the touches as they come) and its events stamped from 2 s ago */
    async stamped(fn) {
      await page.evaluate(() => (window.__qa = { holdFrames: 0 }));
      await wall(40);
      t0 = Date.now() / 1000 - 2;
      await fn();
      await page.evaluate(() => (window.__qa = null));
    },
    /** one stroke, x0, y0 by dx, dy over ms, inside stamped(): `from` = ms into the gesture */
    async stroke(id, x0, y0, dx, dy, ms, from = 0) {
      await this.down(id, x0, y0, from);
      await this.move(id, x0 + dx / 2, y0 + dy / 2, from + ms / 2);
      await this.move(id, x0 + dx, y0 + dy, from + ms);
      await this.up(id, from + ms);
    },
  };
}

if (modes.has('touch')) {
  const page = await open(Q);
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  await page.evaluate(() => (window.__game.flight.glideSpeed = 19.2));
  await runFor(page, 2);
  await page.screenshot({ path: `${out}/hud-touch.png` });
  const st = await rectOf(page, '[data-hud="settings"]');
  await page.touchscreen.tap(st.x, st.y);
  await runFor(page, 0.3);
  if (!(await snap(page)).hud.settings) {
    // (faded out: the first tap only brought it back)
    await page.touchscreen.tap(st.x, st.y);
    await runFor(page, 0.3);
  }
  await page.screenshot({ path: `${out}/hud-settings.png` });
  const panelOpen = (await snap(page)).hud.settings;
  const close = await rectOf(page, '[data-hud="close"]');
  await page.touchscreen.tap(close.x, close.y);
  await runFor(page, 0.2);
  // MEGA: tap, hold 1.4 s, hold 0.8 s then slide off (it keeps charging and steers; the lift ends it)
  const sb = await rectOf(page, '[data-hud="mega"]');
  await page.evaluate(() => window.__game.forceReady());
  await events(page);
  await H.down(1, sb.x, sb.y); await wall(90); await H.up(1);
  await runFor(page, 0.3);
  const tapEv = await events(page);
  await H.down(1, sb.x, sb.y); await wall(1400); await H.up(1);
  await runFor(page, 0.2);
  const holdEv = await events(page);
  await H.down(1, sb.x, sb.y); await wall(800); await H.move(1, sb.x - 90, sb.y - 40); await wall(100); await H.up(1);
  await runFor(page, 0.2);
  const slideEv = await events(page);
  const seen = await page.evaluate(() => [...document.querySelectorAll('[data-hud]')].map((e) => e.dataset.hud));
  res.touch = { panelOpen, megaTap: tapEv, megaHold: holdEv, megaSlideOff: slideEv, hudElements: seen };
  console.log('touch:', JSON.stringify(res.touch));
  await page.close();
}

if (modes.has('thumbs')) {
  const page = await open(Q);
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  await page.evaluate(() => window.__game.audio.unlock());
  const R = [];
  const state = () => page.evaluate(() => {
    const g = window.__game, s = g.controls.snapshot();
    return { gear: s.turbo.gear, level: s.turbo.level, armed: s.turbo.armed, thumb: s.input.thumb, sx: +s.input.sx.toFixed(2), look: s.input.look, tuner: g.tuner.visible };
  });
  /** a clean slate between rows: nothing down, G0, no turbo, the memory of two thumbs spent */
  const clean = async () => {
    await page.evaluate(() => {
      const g = window.__game, c = g.controls;
      c.turbo.boostOff();
      while (c.turbo.gear > 0) c.turbo.shift(-1, g.flight);
      if (g.tuner.visible) g.tuner.toggle();
      g.input.twoAt = -Infinity;
      g.forceReady();
    });
    await runFor(page, 0.1);
    await events(page);
  };
  const row = async (name, fn, want) => {
    await clean();
    const note = await fn();
    await runFor(page, 0.2);
    const r = { name, ...(await state()), events: (await events(page)).map((e) => `${e.k}${e.k === 'onTurbo' ? (e.a[0] > 0 ? '+' : '-') : ''}`), note };
    r.ok = want(r);
    R.push(r);
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${name} ${JSON.stringify({ ...r, name: undefined, ok: undefined })}`);
  };
  const LX = 100, LY = 520, RX = 300, RY = 600;
  const has = (r, k) => r.events.filter((e) => e === k).length;
  /** the right thumb flying, moved off its landing */
  const steer = async () => { await H.down(1, RX, RY); await H.move(1, RX + 30, RY); };
  const lift1 = () => H.up(1);

  // ---- the first thumb
  await row('first thumb: tap', async () => { await H.stamped(async () => { await H.down(1, RX, RY, 0); await H.up(1, 120); }); }, (r) => has(r, 'onTap') === 1 && r.gear === 0);
  await row('first thumb: drag steers', async () => { await steer(); await runFor(page, 0.2); const s = await state(); await lift1(); return s; }, (r) => r.note.thumb && r.note.sx > 0.2 && has(r, 'onTap') === 0);
  // ---- the second thumb
  await row('second: tap fires on its lift', async () => { await steer(); await runFor(page, 0.1); await H.down(2, LX, LY); await wall(30); const landed = (await events(page, false)).length; await H.up(2); await wall(30); await lift1(); return { landed }; }, (r) => r.note.landed === 0 && has(r, 'onTap') === 1);
  await row('second: a drag looks, the stick stays', async () => {
    await steer();
    await runFor(page, 0.2);
    const before = (await state()).sx;
    await H.down(2, LX, LY);
    await wall(150);
    await H.move(2, LX + 60, LY - 40);
    await runFor(page, 0.2);
    const during = await state();
    await H.up(2);
    await runFor(page, 0.1);
    const after = await state();
    await lift1();
    return { before, during, after };
  }, (r) => r.note.during.look.on && Math.round(r.note.during.look.x) === 60 && Math.round(r.note.during.look.y) === 40 && r.note.during.sx === r.note.before && !r.note.after.look.on && r.note.during.thumb && has(r, 'onTap') === 0 && has(r, 'onTurbo+') === 0);
  await row('second: flick up: a gear', async () => { await steer(); await runFor(page, 0.1); await H.stamped(async () => { await H.stroke(2, LX, LY, 0, -74, 85); }); await runFor(page, 0.4); await lift1(); }, (r) => r.gear === 1 && has(r, 'onTurbo+') === 1);
  await row('second: flick down at G1', async () => { await page.evaluate(() => window.__game.controls.turbo.shift(1, window.__game.flight)); await steer(); await runFor(page, 0.1); await H.stamped(async () => { await H.stroke(2, LX, LY, 0, 74, 85); }); await lift1(); }, (r) => r.gear === 0 && has(r, 'onTurbo-') === 1);
  await row('double flick: turbo, no gear', async () => { await steer(); await runFor(page, 0.1); await H.stamped(async () => { await H.stroke(2, LX, LY, 0, -74, 85); await H.stroke(2, LX, LY, 0, -74, 85, 235); }); await runFor(page, 0.5); await lift1(); }, (r) => r.level === 1 && r.gear === 0);
  const double = async () => { await H.stamped(async () => { await H.stroke(2, LX, LY, 0, -74, 85); await H.stroke(2, LX, LY, 0, -74, 85, 235); }); await runFor(page, 0.3); };
  await row('third double: the top level; a fourth changes nothing', async () => { await steer(); await runFor(page, 0.1); await double(); await double(); await double(); const top = (await state()).level; await double(); await lift1(); return { top }; }, (r) => r.note.top === 3 && r.level === 3);
  await row('flick down ends all turbo, the next a gear', async () => {
    await page.evaluate(() => window.__game.controls.turbo.shift(1, window.__game.flight));
    await steer();
    await runFor(page, 0.1);
    await double();
    await double();
    await H.stamped(async () => { await H.stroke(2, LX, LY, 0, 74, 85); });
    await runFor(page, 0.1);
    const off = await state();
    await H.stamped(async () => { await H.stroke(2, LX, LY, 0, 74, 85); });
    await runFor(page, 0.1);
    await lift1();
    return { off };
  }, (r) => r.note.off.level === 0 && r.note.off.gear === 1 && r.gear === 0);
  await row('undo: a flick down takes the waiting gear back', async () => { await steer(); await runFor(page, 0.1); await H.stamped(async () => { await H.stroke(2, LX, LY, 0, -74, 85); await H.stroke(2, LX, LY, 0, 74, 85, 145); }); await runFor(page, 0.6); await lift1(); }, (r) => r.gear === 0 && r.level === 0 && has(r, 'onTurbo-') === 1);
  // ---- the lone strokes
  await row('lone left flick: a gear', async () => { await H.stamped(async () => { await H.stroke(1, LX, LY, 0, -74, 85); }); await runFor(page, 0.4); }, (r) => r.gear === 1);
  await row('lone right flick: never', async () => { await H.stamped(async () => { await H.stroke(1, RX, RY, 0, -74, 85); }); await runFor(page, 0.4); }, (r) => r.gear === 0 && has(r, 'onTurbo+') === 0);
  await row('two lone left flicks: turbo', async () => { await H.stamped(async () => { await H.stroke(1, LX, LY, 0, -74, 85); await H.stroke(1, LX, LY, 0, -74, 85, 235); }); await runFor(page, 0.4); }, (r) => r.level === 1 && r.gear === 0);
  await row('bottom band: no command', async () => { await H.stamped(async () => { await H.stroke(1, LX, 830, 0, -74, 85); }); await runFor(page, 0.4); }, (r) => r.gear === 0 && has(r, 'onTurbo+') === 0);
  // ---- the memory (a short one, tuned: the rule is the same and the wait isn't)
  await row('memory: a lone far touch looks, then lapses', async () => {
    await page.evaluate(() => window.__game.tuneGroup('Input', 'memoryMs', 1500));
    await steer();
    await H.down(2, LX, LY);
    await wall(60);
    await H.up(2);
    await lift1();
    await wall(60);
    await H.down(1, LX, LY);
    await wall(150);
    await H.move(1, LX + 50, LY);
    await runFor(page, 0.15);
    const inside = await state();
    await H.up(1);
    await wall(1700);
    await H.down(1, LX, LY);
    await wall(150);
    await H.move(1, LX + 50, LY);
    await runFor(page, 0.15);
    const past = await state();
    await H.up(1);
    await page.evaluate(() => window.__game.tuneGroup('Input', 'memoryMs', 30000));
    return { inside, past };
  }, (r) => r.note.inside.look.on && !r.note.inside.thumb && !r.note.past.look.on && r.note.past.thumb);
  await row('the look outlives the flying thumb', async () => { await steer(); await H.down(2, LX, LY); await wall(150); await H.move(2, LX + 50, LY); await runFor(page, 0.1); await lift1(); await runFor(page, 0.1); const s = await state(); await H.up(2); return s; }, (r) => r.note.look.on && !r.note.thumb);
  // ---- MEGA, three fingers, a lost touch
  await row('MEGA: a tap, with a thumb steering', async () => { const m = await rectOf(page, '[data-hud="mega"]'); await steer(); await runFor(page, 0.1); await H.down(2, m.x, m.y); await wall(90); await H.up(2); await wall(30); await lift1(); }, (r) => has(r, 'onTap') === 1);
  await row('three fingers: the tuner', async () => { await H.down(1, RX, RY); await H.down(2, LX, LY); await H.down(3, 200, 300); await wall(60); await H.up(3); await H.up(2); await H.up(1); await runFor(page, 0.1); }, (r) => r.tuner && has(r, 'onTripleFinger') === 1 && has(r, 'onTap') === 0);
  await row('lost: touchcancel lets go of everything', async () => { await steer(); await H.down(2, LX, LY); await wall(150); await H.move(2, LX + 50, LY); await runFor(page, 0.1); const before = await state(); await H.cancel(); await runFor(page, 0.1); const after = await state(); return { before, after }; }, (r) => r.note.before.look.on && !r.note.after.look.on && !r.note.after.thumb);
  await row('two thumbs moving apart: the page does not zoom', async () => { const a = await page.evaluate(() => visualViewport.scale); await H.down(1, 220, 600); await H.down(2, 170, 600); for (let i = 1; i <= 6; i++) { await H.move(1, 220 + i * 20, 600); await H.move(2, 170 - i * 20, 600); } const b = await page.evaluate(() => visualViewport.scale); await H.up(2); await H.up(1); return { a, b }; }, (r) => r.note.a === r.note.b);
  res.thumbs = R;
  const bad = R.filter((r) => !r.ok);
  console.log(bad.length ? `thumbs: FAILED ${bad.length} of ${R.length}: ${bad.map((r) => r.name).join('; ')}` : `thumbs: all ${R.length} rows passed in the real page`);
  writeFileSync(`${out}/thumbs.json`, JSON.stringify(R, null, 1));
  await page.close();
}

if (modes.has('turbo')) {
  // the jet: over the Western Addition heading east toward downtown
  const page = await open(Q);
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  await page.evaluate(() => {
    const g = window.__game;
    window.__log = [];
    const p = g.perf;
    const orig = p.frame.bind(p);
    p.frame = (dt, work) => {
      orig(dt, work);
      const c = g.controls.snapshot();
      window.__log.push({ t: +g.clock().toFixed(2), gear: c.turbo.gear, level: c.turbo.level, engaged: c.turbo.engaged, speed: +c.flight.speed.toFixed(1), agl: +c.flight.agl.toFixed(1), mode: c.flight.mode, strain: +c.turbo.strain.toFixed(2), camDist: +c.camera.distance.toFixed(1), hfov: +c.camera.hfov.toFixed(2), calls: p.calls, tris: p.tris, work: +work.toFixed(2) });
    };
    g.flight.glideSpeed = 0;
    g.audio.unlock();
  });
  await runFor(page, 1);
  const flick = (dy) => H.stamped(() => H.stroke(1, 100, 520, 0, dy, 85));
  const double = () => H.stamped(async () => { await H.stroke(1, 100, 520, 0, -74, 85); await H.stroke(1, 100, 520, 0, -74, 85, 235); });
  await flick(-74);
  await runFor(page, 0.05);
  await page.screenshot({ path: `${out}/flick-pop.png` });
  const climbed = await until(page, 'g.controls.turbo.engaged', 12);
  await page.screenshot({ path: `${out}/g1-engage.png` });
  const boomed = await until(page, 'g.flight.speed > 345', 6);
  await runFor(page, 0.15);
  await page.screenshot({ path: `${out}/g1-boom.png` });
  await until(page, 'g.flight.speed > 440', 10);
  await runFor(page, 1.5);
  await page.screenshot({ path: `${out}/g1-jet.png` });
  const speeds = { g1: (await snap(page)).flight.speed };
  for (let lv = 1; lv <= 3; lv++) {
    await double();
    await runFor(page, 4);
    speeds[`level${lv}`] = (await snap(page)).flight.speed;
    await page.screenshot({ path: `${out}/g1-turbo${lv}.png` });
  }
  await double();
  await runFor(page, 0.2);
  await page.screenshot({ path: `${out}/g1-locked.png` });
  await flick(74);
  await runFor(page, 3);
  speeds.off = (await snap(page)).flight.speed;
  await flick(74);
  await runFor(page, 5);
  const s = await snap(page);
  const ev = await events(page);
  const log = await page.evaluate(() => window.__log);
  res.turbo = { climbedToGear: climbed, boomed, speeds, end: { gear: s.turbo.gear, level: s.turbo.level, speed: s.flight.speed }, events: ev.map((e) => `${e.k}${e.a[0] > 0 ? '+' : e.a[0] < 0 ? '-' : ''}@${e.t}`), log: log.filter((_, i) => i % 8 === 0) };
  console.log('turbo:', JSON.stringify({ ...res.turbo, log: undefined }));
  writeFileSync(`${out}/turbo.json`, JSON.stringify(res.turbo, null, 1));
  await page.close();
}

if (modes.has('firstrun')) {
  // a first visit: no skipintro, no card, no hold; every cue in order, on the real clock of the game
  mkdirSync(`${out}/firstrun`, { recursive: true });
  const FR = {};
  const page = await open('?fixeddt=0.05', null, base, { ready: 'window.__game && window.__game.city.loadedRegionCount() > 0' });
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  const ui = () => page.evaluate(() => {
    const g = window.__game, s = g.controls.snapshot();
    return { t: +g.clock().toFixed(1), opening: g.controls.opening, coach: s.coach, mega: getComputedStyle(document.querySelector('[data-hud="mega"]')).display, glint: g.glintNow()?.index ?? -1, prefs: s.prefs };
  });
  await runFor(page, 0.5);
  FR.frame0 = await ui();
  await page.screenshot({ path: `${out}/firstrun/00-hero.png` });
  await until(page, '!g.controls.opening', 60);
  await runFor(page, 0.2);
  FR.fogEnd = await ui();
  await page.screenshot({ path: `${out}/firstrun/01-arrive.png` });
  // TAP: at the first glint
  await page.evaluate(() => window.__game.forceReady());
  await until(page, 'g.controls.snapshot().coach?.cue === "tap"', 120);
  FR.tap = await ui();
  await page.screenshot({ path: `${out}/firstrun/02-tap.png` });
  await H.down(1, 300, 600); await wall(90); await H.up(1);
  await runFor(page, 0.4);
  // DRAG: after the first splat, until a thumb commits
  FR.afterSplat = await ui();
  await page.screenshot({ path: `${out}/firstrun/03-drag.png` });
  await H.down(1, 300, 600); await H.move(1, 340, 600); await runFor(page, 0.5); await H.up(1);
  await runFor(page, 0.3);
  FR.afterDrag = await ui();
  res.firstrun = FR;
  for (const k in FR) console.log('firstrun', k, JSON.stringify(FR[k]));
  writeFileSync(`${out}/firstrun.json`, JSON.stringify(FR, null, 1));
  await page.close();
}

if (modes.has('opening')) {
  // the first visit's gate, on the real bridge: a gear waits for it, a flick down takes it back, a double is turbo
  mkdirSync(`${out}/opening`, { recursive: true });
  const R = {};
  const first = async () => {
    const page = await open('?fixeddt=0.05', null, base, { ready: 'window.__game && window.__game.city.loadedRegionCount() > 0' });
    const cdp = await page.context().newCDPSession(page);
    await until(page, '!g.controls.opening', 60);
    await runFor(page, 0.3);
    return { page, H: hand(page, cdp) };
  };
  const state = (page) => page.evaluate(() => {
    const g = window.__game, f = g.flight, c = g.controls, s = c.snapshot();
    return { clock: +g.clock().toFixed(2), locked: c.gearsLocked, gear: c.turbo.gear, level: c.turbo.level, armed: s.turbo.armed, gated: s.turbo.gated, y: +f.y.toFixed(1), speed: +f.speed.toFixed(0), toast: document.querySelector('[data-hud="toast"]') !== null };
  });
  {
    const { page, H } = await first();
    const locked0 = (await state(page)).locked;
    await H.stamped(() => H.stroke(1, 100, 520, 0, -74, 85));
    await runFor(page, 0.6);
    await page.screenshot({ path: `${out}/opening/armed.png` });
    const armed = await state(page);
    await H.stamped(() => H.stroke(1, 100, 520, 0, 74, 85));
    await runFor(page, 0.3);
    const back = await state(page);
    await H.stamped(() => H.stroke(1, 100, 520, 0, -74, 85));
    await runFor(page, 0.6);
    const again = await state(page);
    const cleared = await until(page, '!g.controls.gearsLocked', 60);
    await runFor(page, 0.5);
    const after = await state(page);
    R.gate = { locked0, armed, back, again, cleared, after };
    console.log('opening gate', JSON.stringify(R.gate));
    await page.close();
  }
  {
    const { page, H } = await first();
    await H.stamped(async () => { await H.stroke(1, 100, 520, 0, -74, 85); await H.stroke(1, 100, 520, 0, -74, 85, 235); });
    await runFor(page, 0.8);
    const s = await state(page);
    await until(page, '!g.controls.gearsLocked', 60);
    await runFor(page, 0.5);
    R.double = { s, after: await state(page) };
    console.log('opening double', JSON.stringify(R.double));
    await page.close();
  }
  res.opening = R;
  writeFileSync(`${out}/opening.json`, JSON.stringify(R, null, 1));
}

if (modes.has('layout')) {
  // real rects against layoutHud (hud.L), each viewport, swapped or not; a shot of each with the meter up. Chromium
  // has no safe-area insets: the insets go through the formula as 0 here, s_layout has the rest.
  const L = {};
  for (const [name, w, h] of [['393x852', 393, 852], ['393x659', 393, 659], ['320x568', 320, 568], ['852x393', 852, 393]])
    for (const swap of [false, true]) {
      const key = `${name}${swap ? '-swap' : ''}`;
      const init = `localStorage.setItem('strugglebus.controls.v1', JSON.stringify({ swap: ${swap}, taught: 31 }));`;
      const page = await open(Q, init, base, { viewport: { width: w, height: h } });
      const cdp = await page.context().newCDPSession(page);
      const H = hand(page, cdp);
      await runFor(page, 0.5);
      const rows = await page.evaluate(() => {
        const H = window.__game.controls.hud, L = H.L, out = {};
        for (const k of ['mega', 'settings']) {
          const el = document.querySelector(`[data-hud="${k}"]`);
          const r = el.getBoundingClientRect();
          const want = L[k].hit;
          out[k] = { ok: r.left === want.x && r.top === want.y && r.width === want.w && r.height === want.h, got: [r.left, r.top, r.width, r.height], want: [want.x, want.y, want.w, want.h], shown: getComputedStyle(el).display };
        }
        return out;
      });
      const bad = Object.entries(rows).filter(([, r]) => !r.ok || r.shown === 'none').map(([k]) => k);
      L[key] = { bad, rows };
      await page.screenshot({ path: `${out}/layout-${key}.png` });
      console.log('layout', key, bad.length ? `MISMATCH ${bad}` : 'all rects match', JSON.stringify(rows.mega));
      await page.evaluate(() => window.__game.forceReady());
      const mg = await rectOf(page, '[data-hud="mega"]');
      await H.down(1, mg.x, mg.y);
      await runFor(page, 1);
      await page.screenshot({ path: `${out}/layout-${key}-charge.png` });
      L[key].meter = await page.evaluate(() => { const r = document.querySelector('[data-slot="super"]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
      await H.up(1);
      await page.close();
    }
  res.layout = L;
}

if (modes.has('states')) {
  // every button state, cropped: a contact sheet is made of these by tools/hud-sheet.py
  mkdirSync(`${out}/states`, { recursive: true });
  const page = await open(Q);
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await page.evaluate(() => { window.__game.audio.unlock(); window.__game.forceReady(); });
  const crop = async (name, sel, pad = 14) => {
    const r = await page.evaluate((s) => { const el = document.querySelector(s); const b = (el.querySelector('canvas') ?? el).getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; }, sel);
    if (!r.width) return;
    const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: r.height + pad * 2 };
    await page.screenshot({ path: `${out}/states/${name}.png`, clip });
  };
  const M = '[data-hud="mega"]';
  // (the readout's and the toast's own wrappers have no data-hud: the top of the screen is the crop)
  const top = (name) => page.screenshot({ path: `${out}/states/${name}.png`, clip: { x: 0, y: 0, width: 393, height: 190 } });
  await runFor(page, 0.4);
  await crop('mega-ready', M);
  await page.screenshot({ path: `${out}/full-g0.png` });
  await H.stamped(() => H.stroke(1, 100, 520, 0, -74, 85));
  await top('readout-armed');
  await runFor(page, 0.5);
  await top('readout-lifting');
  await until(page, 'g.controls.turbo.engaged', 12);
  await runFor(page, 0.3);
  await top('readout-g1');
  await H.stamped(async () => { await H.stroke(1, 100, 520, 0, -74, 85); await H.stroke(1, 100, 520, 0, -74, 85, 235); });
  await runFor(page, 0.3);
  await top('readout-turbo1');
  await H.stamped(async () => { await H.stroke(1, 100, 520, 0, -74, 85); await H.stroke(1, 100, 520, 0, -74, 85, 235); });
  await runFor(page, 0.3);
  await H.stamped(async () => { await H.stroke(1, 100, 520, 0, -74, 85); await H.stroke(1, 100, 520, 0, -74, 85, 235); });
  await runFor(page, 0.3);
  await top('readout-turbo3');
  await H.stamped(() => H.stroke(1, 100, 520, 0, -74, 85));
  await runFor(page, 0.8);
  await top('readout-locked');
  await page.screenshot({ path: `${out}/full-locked.png` });
  await H.stamped(() => H.stroke(1, 100, 520, 0, 74, 85));
  await H.stamped(() => H.stroke(1, 100, 520, 0, 74, 85));
  await runFor(page, 4);
  // MEGA
  await page.evaluate(() => window.__game.forceReady());
  const mg = await rectOf(page, M);
  await H.down(1, mg.x, mg.y);
  await crop('mega-pressed', M);
  await runFor(page, 2);
  await crop('mega-charging', M);
  await crop('meter-charging', '[data-slot="super"]');
  await page.screenshot({ path: `${out}/full-charging.png` });
  await runFor(page, 8.3);
  await crop('mega-firehose', M);
  await crop('meter-firehose', '[data-slot="super"]');
  await page.screenshot({ path: `${out}/full-firehose.png` });
  await H.up(1);
  await until(page, 'g.superState().phase === "cooldown"', 12);
  await runFor(page, 1);
  await crop('mega-cooldown', M, 20);
  await page.screenshot({ path: `${out}/full-cooldown.png` });
  await H.down(1, mg.x, mg.y);
  await runFor(page, 0.5);
  await crop('mega-notyet', M, 20);
  await H.up(1);
  await runFor(page, 0.2);
  // ready again, and the rest
  await page.evaluate(() => window.__game.superSkip(60));
  await runFor(page, 0.25);
  await crop('mega-readyagain', M, 20);
  await wall(9000);
  await runFor(page, 0.1);
  await crop('mega-rest', M);
  await page.screenshot({ path: `${out}/full-rest.png` });
  // HOLD on the face
  await page.evaluate(() => window.__game.controls.hud.megaHoldCue());
  await runFor(page, 0.1);
  await crop('mega-hold', M);
  await page.close();
}

if (modes.has('keyboard')) {
  // a desktop page: no touch, the keyboard and the mouse
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(base + Q, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 400000 });
  await page.evaluate(LOG_INPUT);
  await page.evaluate(() => window.__game.forceReady());
  const s0 = await snap(page);
  const cog = await page.evaluate(() => getComputedStyle(document.querySelector('[data-hud="settings"]').parentElement).display);
  const mega = await page.evaluate(() => getComputedStyle(document.querySelector('[data-hud="mega"]')).display);
  await page.screenshot({ path: `${out}/flow-keyboard.png` });
  await page.keyboard.press('Escape');
  await runFor(page, 0.1);
  const open1 = (await snap(page)).hud.settings;
  await page.screenshot({ path: `${out}/flow-keyboard-settings.png` });
  await page.keyboard.press('Escape');
  await runFor(page, 0.1);
  const open2 = (await snap(page)).hud.settings;
  await events(page);
  await page.keyboard.down('Space');
  await wall(80);
  await page.keyboard.up('Space');
  await runFor(page, 0.2);
  const tap = await events(page);
  await page.keyboard.press('KeyE');
  await wall(450);
  await runFor(page, 0.2);
  const gear1 = (await snap(page)).turbo.gear;
  await page.keyboard.press('KeyE');
  await wall(100);
  await page.keyboard.press('KeyE');
  await runFor(page, 0.2);
  const turboOn = await snap(page);
  await page.keyboard.press('KeyQ');
  await runFor(page, 0.2);
  const turboOff = (await snap(page)).turbo.level;
  await page.keyboard.press('KeyQ');
  await runFor(page, 0.2);
  const gear0 = (await snap(page)).turbo.gear;
  await page.keyboard.down('ShiftLeft');
  await runFor(page, 0.2);
  const boost = (await snap(page)).turbo.boosting;
  await page.keyboard.up('ShiftLeft');
  await runFor(page, 0.2);
  const boostOff = (await snap(page)).turbo.boosting;
  await page.mouse.move(640, 400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(700, 360, { steps: 3 });
  await runFor(page, 0.2);
  const look = (await snap(page)).input.look;
  await page.mouse.up({ button: 'right' });
  await runFor(page, 0.2);
  const lookAfter = (await snap(page)).input.look;
  res.keyboard = { mode: s0.mode, cog, mega, escOpens: open1, escCloses: !open2, tap, gear1, turboOn: { gear: turboOn.turbo.gear, level: turboOn.turbo.level }, turboOff, gear0, boost, boostOff, look, lookAfter };
  console.log('keyboard', JSON.stringify(res.keyboard));
  await page.close();
}

if (modes.has('audio')) {
  // the turbo voice rendered offline through the real AudioEngine graph (classes from the live objects): a climb
  // (strain), engage, Mach 1 boom, the jet, turbo, LOCKED, a downshift, a flick's clunk; peak / NaN / clipping
  const page = await open(Q);
  res.audio = await page.evaluate(async () => {
    const g = window.__game;
    const AE = g.audio.constructor, TV = g.controls.voice.constructor;
    const sr = 48000, secs = 9;
    const ctx = new OfflineAudioContext(2, sr * secs, sr);
    const a = new AE();
    a.attachContext(ctx);
    const kit = a.voiceKit();
    const v = new TV();
    v.attach(kit, 0);
    for (let i = 0; i < secs * 10; i++) {
      const t = i * 0.1;
      v.update({ speedK: t < 2 ? 0 : Math.min(1, (t - 2) / 2.5), strain: t < 2 ? 1 : t < 4 ? 0.7 : 0, boosting: t > 5 && t < 6.2 }, t);
    }
    v.armed(0.05);
    v.shift(0.1, 1);
    v.engage(2.0);
    v.boom(3.0);
    v.engage(5.0);
    v.locked(6.6);
    v.shift(7.2, -1);
    const buf = await ctx.startRendering();
    let peak = 0, nan = 0, over = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const x = d[i];
        if (!Number.isFinite(x)) nan++;
        const m = Math.abs(x);
        if (m > peak) peak = m;
        if (m > 0.99) over++;
      }
    }
    return { peak: +peak.toFixed(3), nan, over099: over };
  });
  console.log('audio (turbo voice, offline):', JSON.stringify(res.audio));
  await page.close();
}

if (modes.has('perf') && perfOther) {
  // the same view and the same sampling for both builds (per-frame counters, median of the frames in 0.8 s)
  // (A B A B: the second pair shows how much of any gap is the order; 3 s of game time, ~60 frames each)
  res.perf = {};
  for (const [label, url] of [['before', perfOther], ['after', base], ['before2', perfOther], ['after2', base]]) {
    const page = await open('?lat=37.7762&lon=-122.4380&heading=90&skipintro&fixeddt=0.05', null, url);
    await page.evaluate(() => {
      const p = window.__game.perf;
      const orig = p.frame.bind(p);
      window.__work = [];
      p.frame = (dt, work) => {
        orig(dt, work);
        window.__work.push({ work, calls: p.calls, tris: p.tris });
      };
      window.__game.forceReady();
    });
    await runFor(page, 1);
    await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 300000 });
    await page.evaluate(() => (window.__work.length = 0));
    await runFor(page, 3);
    const rows = await page.evaluate(() => window.__work.slice(1));
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    res.perf[label] = { url, frames: rows.length, workMs: +med(rows.map((r) => r.work)).toFixed(2), calls: med(rows.map((r) => r.calls)), triangles: med(rows.map((r) => r.tris)) };
    console.log('perf', label, JSON.stringify(res.perf[label]));
    await page.close();
  }
}

writeFileSync(`${out}/controls.json`, JSON.stringify(res, null, 1));
await browser.close();
console.log('saved', out);
