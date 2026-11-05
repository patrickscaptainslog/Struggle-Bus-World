#!/usr/bin/env node
// Controls QA in the real game (index.html), iPhone portrait viewport, touch + mobile emulation.
//   node tools/controls.mjs <baseUrl> <outDir> [touch] [thumbs] [look] [turbo] [firstrun] [opening] [layout] [states] [keyboard] [audio] [perf=<otherBaseUrl>]
//
//   touch    shots of the HUD and the settings panel; real gestures on MEGA (tap / hold / slide)      -> touch in controls.json
//   thumbs   the gesture table through the real page: CDP multi-touch, real pointer events, the real Shifter and drive.
//            A row's events are stamped with CDP timestamps and sent while the game loop is frozen, so a stroke is
//            exactly as long as the row says on any host. tools/controls-sim/s_gesture.ts has every row; this is
//            the proof that the browser's own multi-touch reaches them              -> thumbs.json
//   look     the look with real fingers, stepped frame by frame on a fixed clock, the frames kept (look/*.png, CSS pixels): left, right,
//            back, up, down at street level, at height and in Jet low and high; in a turn; in a dive; the view coming home; a tap while
//            looking; a long look; the flick's pop. With the game clock standing (the look runs on the wall clock): does a settled
//            view come back pixel for pixel, and does the frame go still? SB_LOOK=street,tap,... runs a part -> look.json
//   turbo    flicks up the map: a lone left flick into Express (no lift, its surge heard), Nonstop, Jet (the climb, engagement, the
//            boom), the three turbo rungs, LOCKED, flicks down to Cruise, with shots and a per-frame log -> turbo.json
//   firstrun a first visit: no card, the cues in order (TAP, DRAG, HOLD)                         -> firstrun.json
//   opening  flicks under the opening's gate: answered, taken back, firing at the gate; two of them -> opening.json
//   layout   real rects against layoutHud at 393 x 852, 393 x 659, 320 x 568, 852 x 393, swapped or not (shots)
//   states   every state of MEGA and the readout, cropped (states/*.png; tools/hud-sheet.py makes a sheet of them)
//   keyboard a desktop: Esc, Space, E up the ladder, Q back down it, the right mouse's look -> keyboard in controls.json
//   audio    the turbo voice rendered offline through the real AudioEngine graph
//   perf=<otherBaseUrl>  CPU work ms, draw calls, triangles at the same Alamo Square view (cruising at the
//            floor, the fps meter's per-frame counters) for <otherBaseUrl> (e.g. the build before) and
//            <baseUrl>, in one browser session                                              -> perf in controls.json
// SB_Q=&hour=blue appends to the street page's query (thumbs, states, keyboard, audio): the same rows under a flag.
// Launches through tools/browser.mjs (the GPU here, SwiftShader in the cloud): everything waits on the game
// clock (fixed 1/20 s steps), never wall time.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const [base = 'http://127.0.0.1:5101/', out = 'shots/controls', ...rest] = process.argv.slice(2);
const modes = new Set((rest.length ? rest : ['touch', 'thumbs', 'look', 'turbo', 'firstrun', 'opening', 'layout', 'states', 'keyboard', 'audio']).map((m) => m.split('=')[0]));
const perfOther = (rest.find((m) => m.startsWith('perf=')) ?? '').slice(5);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions());
const Q = `?lat=37.77628&lon=-122.4352&heading=88&skipintro&fixeddt=0.05${process.env.SB_Q ?? ''}`;
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
/** Straight into Jet, three gears up. */
const toJet = (page) => page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 3; i++) g.controls.turbo.shift(1, g.flight);
});
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
    /** the same with the game stepped under it, inside stamped(): stroke()'s frames stand still, so the Flight never feels the stick */
    async felt(id, x0, y0, dx, dy, ms) {
      const frame = async () => {
        await page.evaluate(() => (window.__qa = { holdFrames: 1, held: false }));
        await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 60000 });
      };
      await this.down(id, x0, y0, 0);
      await this.move(id, x0 + dx / 2, y0 + dy / 2, ms / 2);
      await frame();
      await this.move(id, x0 + dx, y0 + dy, ms);
      await frame();
      await this.up(id, ms);
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
    return { gear: s.turbo.gear, level: s.turbo.level, armed: s.turbo.armed, thumb: s.input.thumb, sx: +s.input.sx.toFixed(2), look: s.input.look, view: +((g.rig.lookYaw.x * 180) / Math.PI).toFixed(1), tuner: g.tuner.visible };
  });
  /** a clean slate between rows: nothing down, Cruise, no turbo */
  const clean = async () => {
    await page.evaluate(() => {
      const g = window.__game, c = g.controls;
      c.turbo.level = 0;
      while (c.turbo.gear > 0) c.turbo.shift(-1, g.flight);
      if (g.tuner.visible) g.tuner.toggle();
      g.input.swapped = false;
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
  // (only a touch near the bus flies it, in its lane, and one anywhere else looks: the flying thumb goes under the bus, where the page says the bus is. The left one is out of the lane)
  const LX = 100, LY = 520;
  let RX = 300, RY = 600;
  const lane = await page.evaluate(() => window.__game?.input?.busZone ?? null);
  if (lane) {
    RX = Math.round(lane.x);
    RY = Math.round(Math.min(lane.y + 90, 780));
  }
  console.log('  the bus\'s lane', JSON.stringify(lane), 'the flying thumb at', RX, RY);
  const has = (r, k) => r.events.filter((e) => e === k).length;
  /** the right thumb flying, moved off its landing */
  const steer = async () => { await H.down(1, RX, RY); await H.move(1, RX + 30, RY); };
  const lift1 = () => H.up(1);
  /** a lone touch lands at x, y and drags: what did it turn out to be? */
  const dragAt = async (x, y) => { await H.down(1, x, y); await wall(150); await H.move(1, x + 50, y); await runFor(page, 0.15); const s = await state(); await H.up(1); return s; };
  /** a lone right stroke, with a touch landing at x, y as it goes: it lifts as a flick, the touch stays down */
  const flickWith = (x, y) => H.stamped(async () => { await H.down(1, RX, RY, 0); await H.move(1, RX, RY - 40, 40); await H.down(2, x, y, 50); await H.move(1, RX, RY - 74, 85); await H.up(1, 85); });
  const shiftUp = () => page.evaluate(() => window.__game.controls.turbo.shift(1, window.__game.flight));
  /** n quick flicks up by one thumb, each landing 235 ms after the last */
  const flicksUp = async (id, x, y, n) => { await H.stamped(async () => { for (let i = 0; i < n; i++) await H.stroke(id, x, y, 0, -74, 85, i * 235); }); await runFor(page, 0.3); };

  // ---- the first thumb
  await row('first thumb: tap', async () => { await H.stamped(async () => { await H.down(1, RX, RY, 0); await H.up(1, 120); }); }, (r) => has(r, 'onTap') === 1 && r.gear === 0);
  await row('first thumb: drag steers', async () => { await steer(); await runFor(page, 0.2); const s = await state(); await lift1(); return s; }, (r) => r.note.thumb && r.note.sx > 0.2 && has(r, 'onTap') === 0);
  // ---- the second thumb
  await row('second: tap fires on its lift', async () => { await steer(); await runFor(page, 0.1); let landed = -1; await H.stamped(async () => { await H.down(2, LX, LY, 0); landed = (await events(page, false)).length; await H.up(2, 120); }); await wall(30); await lift1(); return { landed }; }, (r) => r.note.landed === 0 && has(r, 'onTap') === 1);
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
  }, (r) => r.note.during.look.on && Math.round(r.note.during.look.x) === 60 && Math.round(r.note.during.look.y) === 40 && r.note.during.view > 8 && r.note.during.view < 26 && r.note.during.sx === r.note.before && !r.note.after.look.on && r.note.after.view < r.note.during.view && r.note.during.thumb && has(r, 'onTap') === 0 && has(r, 'onTurbo+') === 0);
  await row('second: flick up: a gear', async () => { await steer(); await runFor(page, 0.1); await H.stamped(async () => { await H.stroke(2, LX, LY, 0, -74, 85); }); await runFor(page, 0.4); await lift1(); }, (r) => r.gear === 1 && has(r, 'onTurbo+') === 1);
  await row('second: flick down at G1', async () => { await page.evaluate(() => window.__game.controls.turbo.shift(1, window.__game.flight)); await steer(); await runFor(page, 0.1); await H.stamped(async () => { await H.stroke(2, LX, LY, 0, 74, 85); }); await lift1(); }, (r) => r.gear === 0 && has(r, 'onTurbo-') === 1);
  await row('two quick flicks: two rungs, no turbo', async () => { await steer(); await runFor(page, 0.1); await flicksUp(2, LX, LY, 2); await lift1(); }, (r) => r.level === 0 && r.gear === 2 && has(r, 'onTurbo+') === 2);
  await row('six flicks: the top rung; a seventh changes nothing', async () => { await steer(); await runFor(page, 0.1); await flicksUp(2, LX, LY, 6); const top = await state(); await flicksUp(2, LX, LY, 1); await lift1(); return { top }; }, (r) => r.note.top.gear === 3 && r.note.top.level === 3 && r.gear === 3 && r.level === 3);
  await row('a flick down drops one rung, turbo first', async () => {
    await steer();
    await runFor(page, 0.1);
    await flicksUp(2, LX, LY, 4);
    await H.stamped(async () => { await H.stroke(2, LX, LY, 0, 74, 85); });
    await runFor(page, 0.1);
    const one = await state();
    await H.stamped(async () => { await H.stroke(2, LX, LY, 0, 74, 85); });
    await runFor(page, 0.1);
    await lift1();
    return { one };
  }, (r) => r.note.one.level === 0 && r.note.one.gear === 3 && r.gear === 2);
  await row('a flick up and a flick down: up a rung and back', async () => { await steer(); await runFor(page, 0.1); await H.stamped(async () => { await H.stroke(2, LX, LY, 0, -74, 85); await H.stroke(2, LX, LY, 0, 74, 85, 145); }); await runFor(page, 0.6); await lift1(); }, (r) => r.gear === 0 && r.level === 0 && has(r, 'onTurbo+') === 1 && has(r, 'onTurbo-') === 1);
  // ---- the lone strokes: one thumb, either hand
  await row('lone left flick: a gear', async () => { await H.stamped(async () => { await H.stroke(1, LX, LY, 0, -74, 85); }); await runFor(page, 0.4); }, (r) => r.gear === 1);
  await row('lone right flick: a gear', async () => { await H.stamped(async () => { await H.stroke(1, RX, RY, 0, -74, 85); }); await runFor(page, 0.4); }, (r) => r.gear === 1 && has(r, 'onTurbo+') === 1 && has(r, 'onTap') === 0);
  await row('lone right flick down at G1', async () => { await shiftUp(); await H.stamped(async () => { await H.stroke(1, RX, RY - 80, 0, 74, 85); }); await runFor(page, 0.1); }, (r) => r.gear === 0 && has(r, 'onTurbo-') === 1);
  await row('two lone left flicks: two rungs', async () => { await flicksUp(1, LX, LY, 2); await runFor(page, 0.1); }, (r) => r.level === 0 && r.gear === 2);
  await row('two lone right flicks: two rungs', async () => { await flicksUp(1, RX, RY, 2); await runFor(page, 0.1); }, (r) => r.level === 0 && r.gear === 2 && has(r, 'onTurbo+') === 2);
  await row('one right thumb: a soft stroke right after a flick steers: the firm rule, every time', async () => { await H.stamped(async () => { await H.stroke(1, RX, RY, 0, -74, 85); await H.stroke(1, RX, RY, 0, -30, 100, 235); }); await runFor(page, 0.4); }, (r) => r.level === 0 && r.gear === 1 && has(r, 'onTurbo+') === 1);
  await row('one right thumb: a soft first stroke: nothing', async () => { await H.stamped(async () => { await H.stroke(1, RX, RY, 0, -30, 100); }); await runFor(page, 0.4); }, (r) => r.gear === 0 && r.level === 0 && has(r, 'onTurbo+') === 0);
  await row('one right thumb: climbs to the top, a seventh is LOCKED, down a rung at a time', async () => {
    await flicksUp(1, RX, RY, 6);
    const top = await state();
    await flicksUp(1, RX, RY, 1);
    const locked = await state();
    await H.stamped(async () => { await H.stroke(1, RX, RY - 80, 0, 74, 85); });
    await runFor(page, 0.1);
    const one = await state();
    await H.stamped(async () => { await H.stroke(1, RX, RY - 80, 0, 74, 85); });
    await runFor(page, 0.1);
    return { top, locked, one };
  }, (r) => r.note.top.gear === 3 && r.note.top.level === 3 && r.note.locked.level === 3 && r.note.one.level === 2 && r.note.one.gear === 3 && r.level === 1);
  await row('one right thumb: a flick up and a flick down: up a rung and back', async () => { await H.stamped(async () => { await H.stroke(1, RX, RY, 0, -74, 85); await H.stroke(1, RX, RY - 80, 0, 74, 85, 145); }); await runFor(page, 0.6); }, (r) => r.gear === 0 && r.level === 0 && has(r, 'onTurbo-') === 1);
  await row('a lone right stroke that stays down steers, never shifts, never looks', async () => { await H.stamped(async () => { await H.down(1, RX, RY, 0); await H.move(1, RX, RY - 37, 42); await H.move(1, RX, RY - 74, 85); }); await runFor(page, 0.5); const s = await state(); await lift1(); await runFor(page, 0.1); return s; }, (r) => r.note.thumb && !r.note.look.on && r.gear === 0 && has(r, 'onTurbo+') === 0 && has(r, 'onTap') === 0);
  await row('a lone right drag ending in a fast stroke: no flick', async () => { await H.stamped(async () => { await H.down(1, RX, RY, 0); await H.move(1, RX + 40, RY, 300); await H.move(1, RX + 40, RY - 74, 385); await H.up(1, 385); }); await runFor(page, 0.4); }, (r) => r.gear === 0 && has(r, 'onTurbo+') === 0);
  await row('bottom band: no command', async () => { await H.stamped(async () => { await H.stroke(1, LX, 830, 0, -74, 85); }); await runFor(page, 0.4); }, (r) => r.gear === 0 && has(r, 'onTurbo+') === 0);
  await row('bottom band: no command on the right', async () => { await H.stamped(async () => { await H.stroke(1, RX, 830, 0, -74, 85); }); await runFor(page, 0.4); }, (r) => r.gear === 0 && has(r, 'onTurbo+') === 0);
  await row('side band: no command on the right', async () => { await H.stamped(async () => { await H.stroke(1, 383, RY, 0, -74, 85); }); await runFor(page, 0.4); }, (r) => r.gear === 0 && has(r, 'onTurbo+') === 0);
  await row('a stroke landing on MEGA is MEGA\'s: no gear', async () => { const m = await rectOf(page, '[data-hud="mega"]'); await H.stamped(async () => { await H.stroke(1, m.x, m.y, 0, -74, 85); }); await runFor(page, 0.4); }, (r) => r.gear === 0 && has(r, 'onTurbo+') === 0);
  // ---- the left zone: a touch landing there never flies, alone or not
  await row('left zone: a lone drag looks, the stick stays, the view goes home', async () => {
    await H.down(1, LX, LY);
    await wall(150);
    await H.move(1, LX + 60, LY - 40);
    await runFor(page, 0.25);
    const during = await state();
    await H.up(1);
    await runFor(page, 0.1);
    const after = await state();
    return { during, after };
  }, (r) => r.note.during.look.on && Math.round(r.note.during.look.x) === 60 && Math.round(r.note.during.look.y) === 40 && r.note.during.view > 8 && r.note.during.view < 26 && !r.note.during.thumb && r.note.during.sx === 0 && !r.note.after.look.on && r.note.after.view < r.note.during.view && has(r, 'onTap') === 0 && has(r, 'onTurbo+') === 0);
  await row('left zone: a lone tap fires on its lift', async () => { let landed = -1; await H.stamped(async () => { await H.down(1, LX, LY, 0); landed = (await events(page, false)).length; await H.up(1, 120); }); return { landed }; }, (r) => r.note.landed === 0 && has(r, 'onTap') === 1 && r.gear === 0);
  await row('left zone: a lone rest does nothing', async () => { await H.down(1, LX, LY); await wall(600); await runFor(page, 0.1); const s = await state(); await H.up(1); return s; }, (r) => !r.note.thumb && !r.note.look.on && has(r, 'onTap') === 0 && has(r, 'onTurbo+') === 0);
  await row('left zone: a soft lone flick is a gear: it has the second thumb\'s rule', async () => { await H.stamped(async () => { await H.stroke(1, LX, LY, 0, -30, 100); }); await runFor(page, 0.4); }, (r) => r.gear === 1 && has(r, 'onTurbo+') === 1);
  // (the lane's side: out of it looks, in it flies. Its half width is the page's, 0.22 of the screen)
  await row('the lane: 10 px out of its side looks, 10 px in flies', async () => { const r0 = lane ? lane.r : 86; const inside = await dragAt(RX + r0 + 10, RY); await runFor(page, 0.3); const past = await dragAt(RX + r0 - 10, RY); return { inside, past }; }, (r) => r.note.inside.look.on && !r.note.inside.thumb && r.note.past.thumb && !r.note.past.look.on && r.note.past.sx > 0.2);
  // (lookZone, the left 42 %, rules only before the game's first frame sets the lane: its tuner row is gone, and the row that moved it passed because its point was in the lane. The first review's minor)
  await row('two thumbs, left first: the left looks, the right flies', async () => {
    await H.down(1, LX, LY);
    await wall(150);
    await H.move(1, LX + 60, LY);
    await runFor(page, 0.1);
    await H.down(2, RX, RY);
    await H.move(2, RX + 30, RY);
    await runFor(page, 0.2);
    const s = await state();
    await H.up(2);
    await H.up(1);
    return s;
  }, (r) => r.note.look.on && Math.round(r.note.look.x) === 60 && r.note.thumb && r.note.sx > 0.2);
  await row('two thumbs a beat apart, both lift: the right thumb alone flies, the left alone looks', async () => {
    await H.stamped(async () => { await H.down(1, LX, LY, 0); await H.down(2, RX, RY, 30); });
    await wall(200);
    await H.up(2);
    await H.up(1);
    await runFor(page, 0.3);
    const right = await dragAt(RX, RY);
    await runFor(page, 0.3);
    const left = await dragAt(LX, LY);
    return { right, left };
  }, (r) => r.note.right.thumb && !r.note.right.look.on && r.note.right.sx > 0.2 && r.note.left.look.on && !r.note.left.thumb);
  await row('a right flick beside a resting left thumb steers and never shifts', async () => { await H.stamped(async () => { await H.down(2, LX, LY, 0); await H.stroke(1, RX, RY, 0, -74, 85, 300); await H.up(2, 700); }); await runFor(page, 0.4); }, (r) => r.gear === 0 && has(r, 'onTurbo+') === 0);
  await row('a thumb landing in the zone during a lone right flick looks, and the flick counts', async () => {
    await flickWith(LX, LY);
    await wall(150);
    await H.move(2, LX + 60, LY);
    await runFor(page, 0.15);
    const s = await state();
    await H.up(2);
    await runFor(page, 0.4);
    return s;
  }, (r) => r.gear === 1 && r.note.look.on && !r.note.thumb);
  await row('a thumb landing out of the zone during a lone right flick flies, and the flick counts', async () => {
    await flickWith(200, RY);
    await H.move(2, 240, RY);
    await runFor(page, 0.15);
    const s = await state();
    await H.up(2);
    await runFor(page, 0.4);
    return s;
  }, (r) => r.gear === 1 && r.note.thumb && !r.note.look.on && r.note.sx > 0.2);
  await row('a fingertip in the right side band during a right flick is no thumb: the next one flies', async () => {
    await flickWith(383, 500);
    await wall(60);
    await H.up(2);
    await runFor(page, 0.4);
    return dragAt(RX, RY);
  }, (r) => r.gear === 1 && r.note.thumb && !r.note.look.on);
  await row('a fingertip resting in the right side band since a right flick: the thumb lands again and flies', async () => {
    await flickWith(383, 500);
    await runFor(page, 0.4);
    await H.down(1, RX, RY);
    await wall(150);
    await H.move(1, RX + 50, RY);
    await runFor(page, 0.15);
    const s = await state();
    await H.up(1);
    await H.up(2);
    return s;
  }, (r) => r.note.thumb && !r.note.look.on && r.note.sx > 0.2);
  // ---- what a flick down leaves behind, the Flight feeling the stroke: one thumb's is a pull too
  /** on the rooftops, skimming, whatever the rows before left the bus doing: a frame runs, so the Flight knows it is what the bus was doing */
  const skimming = async () => { await page.evaluate(() => { const f = window.__game.flight; f.holdY = -Infinity; f.mode = 0; f.y = f.floorY; f.vy = 0; }); await runFor(page, 0.15); };
  const held = () => page.evaluate(() => window.__game.flight.holdY);
  await row('one right thumb: a flick down out of Express stays on the rooftops', async () => { await skimming(); await shiftUp(); await runFor(page, 0.5); await H.stamped(() => H.felt(1, RX, RY - 80, 0, 74, 85)); await runFor(page, 1.5); return { hold: await held() }; }, (r) => r.gear === 0 && r.note.hold === -Infinity);
  await row('one right thumb: Nonstop still lifting, taken back: the bus goes back to the rooftops', async () => { await skimming(); await shiftUp(); await runFor(page, 0.5); await shiftUp(); await runFor(page, 0.4); const lifting = await state(); await H.stamped(() => H.felt(1, RX, RY - 80, 0, 74, 85)); await runFor(page, 1.5); return { lifting: lifting.gear, hold: await held() }; }, (r) => r.note.lifting === 2 && r.gear === 1 && r.note.hold === -Infinity);
  await row('one right thumb: a turbo level down hands back the hold', async () => { await skimming(); await toJet(page); await runFor(page, 3); await page.evaluate(() => window.__game.controls.turbo.rung(1, window.__game.flight)); await runFor(page, 0.5); await H.stamped(() => H.felt(1, RX, RY - 80, 0, 74, 85)); await runFor(page, 1.5); return { hold: await held() }; }, (r) => r.gear === 3 && r.level === 0 && r.note.hold === -Infinity);
  await row('one right thumb: a flick up and straight back stays on the rooftops', async () => { await skimming(); await H.stamped(async () => { await H.stroke(1, RX, RY, 0, -74, 85); await H.felt(1, RX, RY - 80, 0, 74, 85); }); await runFor(page, 1.5); return { hold: await held() }; }, (r) => r.gear === 0 && has(r, 'onTurbo-') === 1 && r.note.hold === -Infinity);
  await row('one right thumb: with nothing to do a flick down is the quick pull it looks like', async () => { await skimming(); await H.stamped(() => H.felt(1, RX, RY - 80, 0, 74, 85)); await runFor(page, 1.5); return { hold: await held() }; }, (r) => Number.isFinite(r.note.hold));
  // (SWAP mirrored the left 42 %; the lane has no side, so swapped or not a touch near the bus flies and one anywhere else looks)
  await row('SWAP: the lane is the lane: the left still looks and under the bus still flies', async () => {
    await page.evaluate(() => { window.__game.input.swapped = true; });
    const left = await dragAt(LX, LY);
    await runFor(page, 0.3);
    const right = await dragAt(RX, RY);
    await runFor(page, 0.3);
    await page.evaluate(() => { window.__game.input.swapped = false; });
    return { left, right };
  }, (r) => r.note.left.look.on && !r.note.left.thumb && r.note.right.thumb && !r.note.right.look.on);
  await row('the look outlives the flying thumb', async () => { await steer(); await H.down(2, LX, LY); await wall(150); await H.move(2, LX + 50, LY); await runFor(page, 0.1); await lift1(); await runFor(page, 0.1); const s = await state(); await H.up(2); return s; }, (r) => r.note.look.on && !r.note.thumb);
  // ---- MEGA, three fingers, a lost touch
  await row('MEGA: a tap, with a thumb steering', async () => { const m = await rectOf(page, '[data-hud="mega"]'); await steer(); await runFor(page, 0.1); await H.down(2, m.x, m.y); await wall(90); await H.up(2); await wall(30); await lift1(); }, (r) => has(r, 'onTap') === 1);
  await row('three fingers: the tuner', async () => { await H.stamped(async () => { await H.down(1, RX, RY, 0); await H.down(2, LX, LY, 40); await H.down(3, 200, 300, 80); await H.up(3, 140); await H.up(2, 160); await H.up(1, 180); }); await runFor(page, 0.1); }, (r) => r.tuner && has(r, 'onTripleFinger') === 1 && has(r, 'onTap') === 0);
  await row('lost: touchcancel lets go of everything', async () => { await steer(); await H.down(2, LX, LY); await wall(150); await H.move(2, LX + 50, LY); await runFor(page, 0.1); const before = await state(); await H.cancel(); await runFor(page, 0.1); const after = await state(); return { before, after }; }, (r) => r.note.before.look.on && !r.note.after.look.on && !r.note.after.thumb);
  await row('two thumbs moving apart: the page does not zoom', async () => { const a = await page.evaluate(() => visualViewport.scale); await H.down(1, 220, 600); await H.down(2, 170, 600); for (let i = 1; i <= 6; i++) { await H.move(1, 220 + i * 20, 600); await H.move(2, 170 - i * 20, 600); } const b = await page.evaluate(() => visualViewport.scale); await H.up(2); await H.up(1); return { a, b }; }, (r) => r.note.a === r.note.b);
  res.thumbs = R;
  const bad = R.filter((r) => !r.ok);
  console.log(bad.length ? `thumbs: FAILED ${bad.length} of ${R.length}: ${bad.map((r) => r.name).join('; ')}` : `thumbs: all ${R.length} rows passed in the real page`);
  writeFileSync(`${out}/thumbs.json`, JSON.stringify(R, null, 1));
  await page.close();
}

if (modes.has('look')) {
  const dir = `${out}/look`;
  mkdirSync(dir, { recursive: true });
  const DT = 1 / 30;
  const Rx = 300, Ry = 640, Lx = 100, Ly = 520;
  const log = [];
  const only = new Set((process.env.SB_LOOK ?? 'street,tap,high,g1,g1high,long,pop,proof').split(','));
  /** a page of its own for each run, the loop frozen between steps; `hud` keeps the HUD */
  const start = async (lat, lon, heading, hud = false) => {
    const page = await open(`?lat=${lat}&lon=${lon}&heading=${heading}&skipintro&fixeddt=${DT.toFixed(6)}${hud ? '' : '&nohud'}`);
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.flight.glideSpeed = 0;
      g.flight.fullness = 0.5; // (no breath, no glint: these frames are about the view)
      window.__qa = { holdFrames: 0 };
    });
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 120000 });
    return { page, H: hand(page, cdp) };
  };
  const step = async (page, secs) => {
    await page.evaluate((k) => { window.__qa = { ...window.__qa, holdFrames: k, held: false }; }, Math.max(1, Math.round(secs / DT)));
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 600000 });
  };
  const note = async (page, tag) => {
    const r = await page.evaluate((tag) => {
      const g = window.__game, f = g.flight, c = g.camera, R = g.rig, deg = 180 / Math.PI, T = g.controls.turbo;
      const V = c.position.constructor;
      const v = new V(f.x, f.y, f.z).project(c);
      const d = new V();
      c.getWorldDirection(d);
      const n = (x, k = 1) => +x.toFixed(k);
      return { tag, t: n(g.clock(), 2), speed: n(f.speed), h: n(f.y - f.groundUnder), gear: T.gear, level: T.level, lookYaw: n(R.lookYaw.x * deg), lookPitch: n(R.lookPitch.x * deg), aimYaw: n(R.aimYaw * deg), viewDown: n(Math.asin(-d.y) * deg), bus: [n(v.x * 0.5 + 0.5, 3), n(0.5 - v.y * 0.5, 3)], dist: n(c.position.distanceTo(new V(f.x, f.y, f.z))), calls: g.perf.calls, tris: g.perf.tris, regions: g.city.loadedRegionCount(), thumb: g.input.state.thumb };
    }, tag);
    log.push(r);
    console.log(JSON.stringify(r));
    return r;
  };
  const frameOf = (page, name) => page.screenshot({ path: `${dir}/${name}.png`, scale: 'css' });
  const shot = async (page, name) => {
    await frameOf(page, name);
    return note(page, name);
  };
  /** the look thumb lands, waits out the delay, goes dx right, dy up */
  const look = async (page, H, dx, dy) => {
    await H.down(2, Lx, Ly);
    await wall(130);
    await H.move(2, Lx + dx, Ly - dy);
  };
  /** left, right, back, up, down, each from home, with the flying thumb at rest */
  const fan = async (page, H, tag, settle = 1.7) => {
    await H.down(1, Rx, Ry);
    await step(page, 0.6);
    await shot(page, `${tag}-rest`);
    for (const [name, dx, dy] of [['left', -90, 0], ['right', 90, 0], ['back', 180, 0], ['up', 0, 45], ['down', 0, -50]]) {
      await look(page, H, dx, dy);
      await step(page, 0.9);
      await shot(page, `${tag}-${name}`);
      await H.up(2);
      await step(page, settle);
    }
    await H.up(1);
  };
  /** put the bus at a height, holding it, the lens set for it, and let the city land */
  const place = async (page, y) => {
    await page.evaluate((v) => {
      const g = window.__game, f = g.flight;
      f.y = v;
      f.holdY = v;
      f.mode = 1;
      f.vy = 0;
      g.rig.vista = g.rig.vistaTarget = 1;
      g.rig.lensHeight = g.rig.lensTarget = v - f.groundUnder;
    }, y);
    for (let i = 0; i < 60; i++) {
      await step(page, 0.25);
      if (await page.evaluate(() => !window.__game.city.busy)) break;
    }
  };
  const quiet = (page) => page.evaluate(() => new Promise((res) => {
    const g = window.__game;
    let n = 0;
    const tick = () => {
      n = !g.city.busy && g.city.ground.queued === 0 ? n + 1 : 0;
      if (n >= 30) res(null);
      else requestAnimationFrame(tick);
    };
    tick();
  }));
  const R = {};
  // ---- street level, at cruise
  if (only.has('street')) {
    const { page, H } = await start(37.7763, -122.4352, 88);
    await step(page, 1);
    await fan(page, H, 'street');
    // ---- a look in a turn
    await H.down(1, Rx, Ry);
    await H.move(1, Rx + 46, Ry);
    await step(page, 0.9);
    await shot(page, 'turn-rest');
    await look(page, H, -70, 0);
    await step(page, 0.8);
    await shot(page, 'turn-left');
    await H.up(2);
    await H.up(1);
    await step(page, 1.7);
    // ---- the view coming home
    await H.down(1, Rx, Ry);
    await look(page, H, 120, 20);
    await step(page, 0.9);
    await shot(page, 'home-0');
    await H.up(2);
    for (const [i, gap] of [[1, 0.1], [2, 0.2], [3, 0.2], [4, 0.25], [5, 0.25], [6, 0.4]]) {
      await step(page, gap);
      await shot(page, `home-${i}`);
    }
    await H.up(1);
    await page.close();
  }
  // ---- a tap while looking: the flying thumb lifts and taps, the look thumb holds the view
  if (only.has('tap')) {
    const { page, H } = await start(37.7825, -122.4300, 90, true);
    await step(page, 1);
    await H.down(1, Rx, Ry);
    await look(page, H, 70, 0);
    await step(page, 0.8);
    // (a breath loaded, over something that can glint)
    let glint = null;
    for (let i = 0; i < 40 && !glint; i++) {
      await page.evaluate(() => window.__game.forceReady());
      await step(page, 0.1);
      glint = await page.evaluate(() => window.__game.glintNow());
    }
    await step(page, 0.2);
    await shot(page, 'tap-glint');
    await events(page);
    await H.up(1);
    await H.down(1, Rx, Ry);
    await wall(60);
    await H.up(1);
    await step(page, 0.05);
    const ev = (await events(page)).map((e) => e.k);
    const fired = await page.evaluate(() => window.__game.lastShot());
    await step(page, 0.3);
    await shot(page, 'tap-jet');
    const hitWhatGlinted = fired?.target?.index === glint?.index;
    await step(page, 0.25);
    await shot(page, 'tap-impact');
    await step(page, 0.6);
    await shot(page, 'tap-paint');
    await H.up(2);
    await step(page, 1.6);
    await shot(page, 'tap-after');
    R.tap = { glint, ev, fired, hitWhatGlinted };
    console.log('tap while looking', JSON.stringify(R.tap));
    await page.close();
  }
  // ---- at height, holding it; a dive
  if (only.has('high')) {
    const { page, H } = await start(37.7763, -122.4352, 88);
    await step(page, 0.5);
    await place(page, 1200);
    await fan(page, H, 'high');
    await place(page, 3200);
    await H.down(1, Rx, Ry);
    await H.move(1, Rx, Ry - 90);
    await step(page, 3.5);
    await shot(page, 'dive-rest');
    await look(page, H, 70, 0);
    await step(page, 0.8);
    await shot(page, 'dive-right');
    await H.move(2, Lx, Ly - 40);
    await step(page, 0.8);
    await shot(page, 'dive-up');
    await H.move(2, Lx, Ly + 40);
    await step(page, 0.8);
    await shot(page, 'dive-down');
    await H.up(2);
    await H.up(1);
    await page.close();
  }
  // ---- Jet: from the south of the map, up the length of it
  if (only.has('g1')) {
    const { page, H } = await start(37.7150, -122.4400, 340);
    await step(page, 1);
    await toJet(page);
    for (let i = 0; i < 80; i++) {
      await step(page, 0.5);
      if (await page.evaluate(() => window.__game.flight.speed > 440)) break;
    }
    await fan(page, H, 'g1', 1.5);
    await page.close();
  }
  // ---- Jet at height
  if (only.has('g1high')) {
    const { page, H } = await start(37.7150, -122.4400, 340);
    await step(page, 0.5);
    await place(page, 2500);
    await toJet(page);
    for (let i = 0; i < 80; i++) {
      await step(page, 0.5);
      if (await page.evaluate(() => window.__game.flight.speed > 440)) break;
    }
    await fan(page, H, 'g1high', 1.5);
    await page.close();
  }
  // ---- a look held past the stream's 2 s, at height: what streams follows it, and comes home
  if (only.has('long')) {
    const { page, H } = await start(37.7763, -122.4352, 88);
    await step(page, 0.5);
    await place(page, 1200);
    await H.down(1, Rx, Ry);
    await look(page, H, 180, 0);
    await step(page, 1.5);
    await note(page, 'long-1.5s');
    await step(page, 3);
    await shot(page, 'long-4.5s');
    for (let i = 0; i < 40 && (await page.evaluate(() => window.__game.city.busy)); i++) await step(page, 0.25);
    await shot(page, 'long-landed');
    await H.up(2);
    await step(page, 3);
    for (let i = 0; i < 40 && (await page.evaluate(() => window.__game.city.busy)); i++) await step(page, 0.25);
    await shot(page, 'long-home');
    await H.up(1);
    await page.close();
  }
  // ---- the flick's pop, at street level, at height and at 450 m/s
  if (only.has('pop')) {
    for (const [tag, y] of [['street', 0], ['high', 1200], ['g1', 0]]) {
      const g1 = tag === 'g1';
      const { page, H } = await (g1 ? start(37.7150, -122.4400, 340) : start(37.7763, -122.4352, 88));
      await step(page, y ? 0.5 : 1);
      if (y) await place(page, y);
      if (g1) {
        await toJet(page);
        for (let i = 0; i < 80; i++) {
          await step(page, 0.5);
          if (await page.evaluate(() => window.__game.flight.speed > 440)) break;
        }
      }
      await H.stamped(() => H.stroke(1, Lx, Ly, 0, -74, 85));
      for (const [i, gap] of [[0, 0.033], [1, 0.1], [2, 0.133], [3, 0.2]]) {
        await step(page, gap);
        await shot(page, `pop-${tag}-${i}`);
      }
      await page.close();
    }
  }
  // ---- with the game clock standing, a look comes and goes: the same frame, pixel for pixel, and then a still one
  const proof = async (tag, y) => {
    const { page, H } = await start(37.7763, -122.4352, 88);
    await step(page, 0.5);
    if (y) await place(page, y);
    // (no breath loaded: what glints is a fresh pick after any swing of the aim, and these frames are about the view)
    await page.evaluate(() => { const g = window.__game; g.controls.frozen = true; g.flight.fullness = 0.5; window.__qa = null; });
    await quiet(page);
    const before = await page.screenshot();
    const matrix = () => page.evaluate(() => [...window.__game.camera.matrixWorld.elements]);
    const m0 = await matrix();
    const rounds = [];
    for (const [dx, dy] of [[120, 20], [-70, -40], [180, 45]]) {
      await H.down(1, Rx, Ry);
      await H.down(2, Lx, Ly);
      await wall(130);
      await H.move(2, Lx + dx, Ly - dy);
      await page.waitForFunction((x) => Math.abs(window.__game.rig.lookYaw.x * 180 / Math.PI - x) < 2, dx, { timeout: 60000 });
      const during = await page.screenshot();
      await H.up(2);
      await H.up(1);
      const frames = await page.evaluate(() => new Promise((res) => {
        const r = window.__game.rig;
        let n = 0;
        const tick = () => {
          if (r.lookYaw.x === 0 && r.lookPitch.x === 0) res(n);
          else { n++; requestAnimationFrame(tick); }
        };
        tick();
      }));
      await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res)))));
      await quiet(page);
      const after = await page.screenshot();
      await wall(400);
      const later = await page.screenshot();
      const m1 = await matrix();
      rounds.push({ dx, dy, moved: !during.equals(before), framesToHome: frames, sameFrame: after.equals(before), still: later.equals(after), sameCamera: m1.every((v, i) => v === m0[i]) });
    }
    R[tag] = rounds;
    console.log(`proof ${tag}`, JSON.stringify(rounds));
    await page.close();
  };
  if (only.has('proof')) {
    await proof('settledStreet', 0);
    await proof('settledHigh', 1200);
  }
  res.look = { ...R, log };
  writeFileSync(`${out}/look.json`, JSON.stringify(res.look, null, 1));
}

if (modes.has('turbo')) {
  // the jet: from the south of the map, up the length of it, so the map's edge has no say in what the levels reach
  const page = await open('?lat=37.7150&lon=-122.4400&heading=340&skipintro&fixeddt=0.05');
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
  const heard = () => page.evaluate(() => {
    const g = window.__game, c = g.controls, f = g.flight;
    return { gear: c.turbo.gear, engaged: c.turbo.engaged, speed: +f.speed.toFixed(1), y: +f.y.toFixed(1), lift: +f.lift.toFixed(1), mode: f.mode, surge: +c.surge.toFixed(2), voice: c.voice.attached, tearing: c.tearing, lines: c.fx.lines.visible, on: +c.fx.trailU.uOn.value.toFixed(2) };
  });
  await flick(-74);
  await runFor(page, 0.05);
  await page.screenshot({ path: `${out}/flick-pop.png` });
  // one flick: Express, the surge with no thumb on it, on the rooftops
  await runFor(page, 3);
  await page.screenshot({ path: `${out}/express.png` });
  const express = await heard();
  await runFor(page, 3);
  const expressQuiet = await heard();
  // a second: Nonstop, a low lift
  await flick(-74);
  await runFor(page, 0.4);
  await page.screenshot({ path: `${out}/nonstop-lifting.png` });
  const nonstopLifting = await heard();
  await until(page, 'g.controls.turbo.engaged', 6);
  await until(page, 'g.flight.speed > 215', 6);
  await page.screenshot({ path: `${out}/nonstop.png` });
  const nonstop = await heard();
  // a third: Jet, from there
  await flick(-74);
  await runFor(page, 0.5);
  await page.screenshot({ path: `${out}/jet-lifting.png` });
  const lifting = await heard();
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
    await flick(-74);
    await runFor(page, 4);
    speeds[`level${lv}`] = (await snap(page)).flight.speed;
    await page.screenshot({ path: `${out}/g1-turbo${lv}.png` });
  }
  await flick(-74);
  await runFor(page, 0.2);
  await page.screenshot({ path: `${out}/g1-locked.png` });
  for (let lv = 2; lv >= 0; lv--) {
    await flick(74);
    await runFor(page, 3);
    speeds[`down${lv}`] = (await snap(page)).flight.speed;
  }
  await flick(74);
  await runFor(page, 5);
  const down = await heard();
  await flick(74);
  await runFor(page, 5);
  await flick(74);
  await runFor(page, 5);
  const s = await snap(page);
  const ev = await events(page);
  const log = await page.evaluate(() => window.__log);
  res.turbo = { express, expressQuiet, nonstopLifting, nonstop, lifting, down, climbedToGear: climbed, boomed, speeds, end: { gear: s.turbo.gear, level: s.turbo.level, speed: s.flight.speed }, events: ev.map((e) => `${e.k}${e.a[0] > 0 ? '+' : e.a[0] < 0 ? '-' : ''}@${e.t}`), log: log.filter((_, i) => i % 8 === 0) };
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
  // the hint: a beat after the bridge, three lines in the toast's slot, and touches pass through it
  const hint = () => page.evaluate(() => {
    const c = document.querySelector('[data-hud="toast"] canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { lines: (c.height - 4) / 10, top: r.top, bottom: r.bottom, width: r.width, passes: getComputedStyle(c).pointerEvents === 'none' };
  });
  await until(page, '!g.controls.gearsLocked && document.querySelector(\'[data-hud="toast"]\') !== null', 60);
  FR.hint = { ...(await ui()), toast: await hint() };
  await page.screenshot({ path: `${out}/firstrun/01b-hint.png` });
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
  // it never repeats: the same device, the next visit
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__game && window.__game.city.loadedRegionCount() > 0', null, { timeout: 400000 });
  await until(page, '!g.controls.opening', 60);
  await runFor(page, 3);
  FR.nextVisit = { ...(await ui()), toast: await hint() };
  res.firstrun = FR;
  for (const k in FR) console.log('firstrun', k, JSON.stringify(FR[k]));
  writeFileSync(`${out}/firstrun.json`, JSON.stringify(FR, null, 1));
  await page.close();
}

if (modes.has('opening')) {
  // the first visit's gate, on the real bridge: a gear waits for it, a flick down takes it back, two flicks are two rungs
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
    return { clock: +g.clock().toFixed(2), locked: c.gearsLocked, gear: c.turbo.gear, level: c.turbo.level, armed: s.turbo.armed, y: +f.y.toFixed(1), speed: +f.speed.toFixed(0), toast: document.querySelector('[data-hud="toast"]') !== null };
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
    // one taken back: the other still waits, and its line stands
    await H.stamped(() => H.stroke(1, 100, 520, 0, 74, 85));
    await runFor(page, 0.15);
    const back = await state(page);
    await until(page, '!g.controls.gearsLocked', 60);
    await runFor(page, 0.5);
    R.two = { s, back, after: await state(page) };
    console.log('opening two flicks', JSON.stringify(R.two));
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
  const flick = (dy) => H.stamped(() => H.stroke(1, 100, 520, 0, dy, 85));
  await flick(-74);
  await runFor(page, 1);
  await top('readout-express');
  await flick(-74);
  await runFor(page, 0.3);
  await top('readout-nonstop-lifting');
  await until(page, 'g.controls.turbo.engaged', 12);
  await runFor(page, 0.3);
  await top('readout-nonstop');
  await flick(-74);
  await runFor(page, 0.5);
  await top('readout-lifting');
  await until(page, 'g.controls.turbo.engaged', 12);
  await runFor(page, 0.3);
  await top('readout-jet');
  await flick(-74);
  await runFor(page, 0.3);
  await top('readout-turbo1');
  await flick(-74);
  await runFor(page, 0.3);
  await top('readout-turbo2');
  await flick(-74);
  await runFor(page, 0.3);
  await top('readout-turbo3');
  await flick(-74);
  await runFor(page, 0.8);
  await top('readout-locked');
  await page.screenshot({ path: `${out}/full-locked.png` });
  for (let i = 0; i < 6; i++) await flick(74);
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
  await runFor(page, 0.2);
  const gear1 = (await snap(page)).turbo.gear;
  for (let i = 0; i < 3; i++) await page.keyboard.press('KeyE');
  await runFor(page, 0.2);
  const turboOn = await snap(page);
  await page.keyboard.press('KeyQ');
  await runFor(page, 0.2);
  const turboOff = (await snap(page)).turbo.level;
  for (let i = 0; i < 3; i++) await page.keyboard.press('KeyQ');
  await runFor(page, 0.2);
  const gear0 = (await snap(page)).turbo.gear;
  await page.mouse.move(640, 400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(700, 360, { steps: 3 });
  await runFor(page, 0.2);
  const look = (await snap(page)).input.look;
  const lookView = await page.evaluate(() => +((window.__game.rig.lookYaw.x * 180) / Math.PI).toFixed(1));
  await page.mouse.up({ button: 'right' });
  await runFor(page, 0.2);
  const lookAfter = (await snap(page)).input.look;
  res.keyboard = { mode: s0.mode, cog, mega, escOpens: open1, escCloses: !open2, tap, gear1, turboOn: { gear: turboOn.turbo.gear, level: turboOn.turbo.level }, turboOff, gear0, look, lookView, lookAfter };
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
