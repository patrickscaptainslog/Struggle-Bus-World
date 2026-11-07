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
//   zone     School Zone with real flicks (docs/specs/shots/GEARS.md): a flick down from Cruise, the hover settling, the lens coming in 30 %, the
//            paint balloons out of the hatch, a held right thumb turning on the spot, the stick up's drift and down's climb, a flick down in
//            it (nothing yet), a flick up out (the balloons burst, Cruise again), with shots and the draws and triangles at each -> zone.json
//   bomb     the Bomb (&bomb; docs/specs/shots/SHOTS.md, "The modes"; not in the default list) by real CDP touches held still on the bus itself
//            (Input.busBox): a Bomb II and a III at Cruise, a III in School Zone, at Jet (where the Comet lands, its full show), with ?life and on ?moon's
//            ground. Each: its tier and stages, every building it raised at min(3, before + jump) and none past 3 (?moon: the craters), the frame's draws
//            and triangles each frame from the lift through its stages and the pogo (at most 200 and 1.5 M), no program made after ready, and a still
//            as it lands. Exits 1 when a row fails                                                                     -> bomb.json
//   lob      the Lob (src/game/Lob.ts; not in the default list) by real CDP touches: a pull held in the lane under the bus, the steering thumb lifted, a tap
//            0.1 s later, at Cruise, Express and Nonstop (where the Comet lands farther, the Comet), with ?life and on ?moon's ground. Each: a Lob at the body
//            as it was at the lift, every building it raised (?moon: the craters) a level and no more, and from the tap to 1.5 s after it lands the frame's
//            draws, triangles and particles (at most 200, 1.5 M and 8,000), no program made after ready, and stills of its ring and its landing -> lob.json
//   firstrun a first visit: no card, the cues in order (TAP, DRAG, HOLD)                         -> firstrun.json
//   opening  flicks under the opening's gate: answered, taken back, firing at the gate; two of them. The low shot has no look, so a drag landing over
//            the bus, out of the lane's half disc, flies until the gate and looks after it. A flick in the grey, before the first frame, waits for
//            the gate too. Once open, a carve shuts it again only under the low shot's line. A lone flick down under it, nothing
//            waiting, says CLIMB AFTER THE BRIDGE. SB_OPENING=grey,... runs a part
//                                                                                                              -> opening.json
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
const modes = new Set((rest.length ? rest : ['touch', 'thumbs', 'look', 'turbo', 'zone', 'firstrun', 'opening', 'layout', 'states', 'keyboard', 'audio']).map((m) => m.split('=')[0]));
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
  // (only a touch near the bus or under it flies it, in its lane, and one over it or beside it looks: the flying thumb goes under the bus, where the page says the bus is. The left one is over
  // the bus's line, out of the lane's half disc: low on the left would fly now)
  let LX = 100, LY = 520;
  let RX = 300, RY = 600;
  const lane = await page.evaluate(() => window.__game?.input?.busZone ?? null);
  if (lane) {
    RX = Math.round(lane.x);
    RY = Math.round(Math.min(lane.y + 90, 780));
    LY = Math.round(lane.y - 120);
  }
  console.log('  the bus\'s lane', JSON.stringify(lane), 'the flying thumb at', RX, RY, 'the look thumb at', LX, LY);
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
  // (the lane's side at the bus's height: out of it looks, in it flies. Its half width is the page's, 0.27 of the screen. Under the bus it opens out to the whole width, a quarter of the
  // screen's height down, so low on either side flies, where the thumb rests; over the bus's line, out of the half disc, looks)
  const LB = lane ? Math.round(lane.y) : 506, r0 = lane ? lane.r : 106;
  await row('the lane: beside the bus at its height, 10 px out of its side looks, 10 px in flies', async () => { const out = await dragAt(RX + r0 + 10, LB); await runFor(page, 0.3); const inside = await dragAt(RX + r0 - 10, LB); return { out, inside }; }, (r) => r.note.out.look.on && !r.note.out.thumb && r.note.inside.thumb && !r.note.inside.look.on && r.note.inside.sx > 0.2);
  await row('the lane: beside the bus at its height on the left looks', () => dragAt(Math.max(30, Math.round(RX - r0 - 30)), LB), (r) => r.note.look.on && !r.note.thumb);
  await row('the lane: above the bus looks', () => dragAt(RX, Math.round(LB - r0 - 40)), (r) => r.note.look.on && !r.note.thumb);
  await row('the lane: low on the right flies', () => dragAt(340, 780), (r) => r.note.thumb && !r.note.look.on && r.note.sx > 0.2);
  await row('the lane: low on the left flies', () => dragAt(40, 780), (r) => r.note.thumb && !r.note.look.on && r.note.sx > 0.2);
  await row('the lane is on the tuner: laneHalf 0.4, 140 px beside the bus at its height flies', async () => { await page.evaluate(() => window.__game.tuneGroup('Input', 'laneHalf', 0.4)); await runFor(page, 0.1); const s = await dragAt(RX + 140, LB); await page.evaluate(() => window.__game.tuneGroup('Input', 'laneHalf', 0.27)); await runFor(page, 0.1); return s; }, (r) => r.note.thumb && !r.note.look.on);
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
  // (Nonstop's height is over the broad ground, and wherever the rows before left the bus, on a hill, its rooftops can be over that already: Nonstop bit on its
  // first frame there, and a gear that bit holds the height, as it should. So for this row Nonstop's height is out of reach, and the gear is surely still lifting)
  await row('one right thumb: Nonstop still lifting, taken back: the bus goes back to the rooftops', async () => { const alt = await page.evaluate(() => { const T = window.__game.config.turbo, a = T.nonstopAlt; T.nonstopAlt = 400; return a; }); await skimming(); await shiftUp(); await runFor(page, 0.5); await shiftUp(); await runFor(page, 0.4); const lifting = await state(); const bitBefore = await page.evaluate(() => window.__game.controls.turbo.engaged); await H.stamped(() => H.felt(1, RX, RY - 80, 0, 74, 85)); await runFor(page, 1.5); const hold = await held(); await page.evaluate((a) => { window.__game.config.turbo.nonstopAlt = a; }, alt); return { lifting: lifting.gear, bitBefore, hold }; }, (r) => r.note.lifting === 2 && !r.note.bitBefore && r.gear === 1 && r.note.hold === -Infinity);
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
      // (the offset sets the angle on the look's curve, a x + b x^3, CameraRig's lookDeg: 120 px is about 55 degrees, not 120)
      await page.waitForFunction((x) => {
        const C = window.__game.config.camera, a = Math.max(0.01, C.lookDegPerPx), full = Math.max(1, C.lookFullPx), b = Math.max(0, 180 - a * full) / (full * full * full);
        return Math.abs(window.__game.rig.lookYaw.x * 180 / Math.PI - x * (a + b * x * x)) < 2;
      }, dx, { timeout: 60000 });
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

if (modes.has('zone')) {
  // (every WebGL program made, counted: none may be made in School Zone, the balloons' included)
  const page = await open(Q + '&nohud', () => {
    const P = WebGL2RenderingContext.prototype, cp = P.createProgram;
    window.__progs = 0;
    P.createProgram = function () { window.__progs++; return cp.call(this); };
  });
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  const progs0 = await page.evaluate(() => window.__progs);
  await page.evaluate(() => {
    const g = window.__game;
    g.flight.glideSpeed = 0;
    g.audio.unlock();
  });
  await runFor(page, 2);
  const flick = (dy) => H.stamped(() => H.stroke(1, 100, 520, 0, dy, 85));
  const st = () => page.evaluate(() => {
    const g = window.__game, c = g.controls.snapshot(), f = g.flight, p = g.perf;
    return { below: c.turbo.below, name: c.turbo.name, gear: c.turbo.gear, balloons: c.turbo.balloons, speed: +f.speed.toFixed(2), ground: +f.ground.toFixed(2), y: +f.y.toFixed(1), overFloor: +(f.y - f.floorY).toFixed(1), vy: +f.vy.toFixed(2), mode: f.mode, heading: +((f.heading * 180) / Math.PI).toFixed(1), cam: +c.camera.distance.toFixed(1), zoneIn: +g.rig.zoneIn.toFixed(3), pitch: +((f.pitch * 180) / Math.PI).toFixed(1), calls: p.calls, tris: p.tris };
  });
  const R = { cruise: await st() };
  await page.screenshot({ path: `${out}/zone-0-cruise.png` });
  await flick(74);
  await runFor(page, 0.05);
  R.flicked = await st();
  await runFor(page, 1.5);
  R.at15s = await st();
  await runFor(page, 1.5);
  await page.screenshot({ path: `${out}/zone-1-hover.png` });
  R.hover = await st();
  await runFor(page, 6);
  await page.screenshot({ path: `${out}/zone-2-balloons.png` });
  R.balloons = await st();
  // their draw: the same frame with them held hidden (Balloons.update sets visible every frame), then shown again
  await page.evaluate(() => { const b = window.__game.controls.balloons; b.__upd = b.update; b.update = (...a) => { b.__upd(...a); b.object.visible = false; }; });
  await runFor(page, 0.2);
  R.balloonsHidden = await st();
  await page.evaluate(() => { const b = window.__game.controls.balloons; b.update = b.__upd; delete b.__upd; });
  await runFor(page, 0.2);
  R.balloonsShown = await st();
  // a held right thumb, sideways: on the spot
  const h0 = R.balloons.heading;
  await H.down(2, 300, 640);
  for (let i = 1; i <= 6; i++) { await H.move(2, 300 + i * 14, 640); await runFor(page, 0.05); }
  await runFor(page, 2.2);
  R.turning = await st();
  await page.screenshot({ path: `${out}/zone-3-turn.png` });
  await H.up(2);
  // (the heading is never wrapped: what it turned, whole)
  R.turnDegPerS = +((R.turning.heading - h0) / 2.5).toFixed(1);
  await runFor(page, 2);
  // the stick up: the drift
  await H.down(2, 300, 640);
  for (let i = 1; i <= 6; i++) { await H.move(2, 300, 640 - i * 22); await runFor(page, 0.05); }
  await runFor(page, 3);
  R.drift = await st();
  await page.screenshot({ path: `${out}/zone-4-drift.png` });
  await H.up(2);
  await runFor(page, 2);
  // the stick down: the climb
  await H.down(2, 300, 640);
  for (let i = 1; i <= 6; i++) { await H.move(2, 300, 640 + i * 22); await runFor(page, 0.05); }
  await runFor(page, 3);
  R.climb = await st();
  await H.up(2);
  await runFor(page, 4);
  R.climbHeld = await st();
  await page.screenshot({ path: `${out}/zone-5-high.png` });
  // a flick down in it: nothing yet
  await flick(74);
  await runFor(page, 0.3);
  R.downInZone = await st();
  await runFor(page, 3);
  R.beforeOut = await st();
  // a flick up: Cruise, the balloons burst
  await flick(-74);
  await runFor(page, 0.1);
  await page.screenshot({ path: `${out}/zone-6-burst.png` });
  R.out = await st();
  await runFor(page, 4);
  R.cruiseAgain = await st();
  R.events = (await events(page)).map((e) => `${e.k}${e.a[0] > 0 ? '+' : e.a[0] < 0 ? '-' : ''}@${e.t}`);
  R.programs = { atReady: progs0, madeAfter: (await page.evaluate(() => window.__progs)) - progs0 };
  const ok = (c, m) => (R.verdicts ??= []).push(`${c ? 'ok' : 'FAIL'}: ${m}`);
  ok(R.programs.madeAfter === 0, `nothing compiles in School Zone: ${R.programs.madeAfter} programs made after ready`);
  ok(R.flicked.below === 1 && R.flicked.name === 'SCHOOL ZONE', 'a real flick down from Cruise is School Zone');
  ok(R.at15s.speed < 2.5 && R.hover.speed < 0.6, `it eases to a hover in about 1.5 s: ${R.at15s.speed}, ${R.hover.speed} m/s`);
  ok(Math.abs(R.hover.cam / R.cruise.cam - 0.7) < 0.06, `the lens comes in 30 %: ${R.cruise.cam} to ${R.hover.cam} m`);
  ok(R.balloons.balloons >= 4 && R.balloonsShown.calls - R.balloonsHidden.calls === 1, `balloons out of the hatch (${R.balloons.balloons}), one draw: ${R.balloonsHidden.calls} hidden, ${R.balloonsShown.calls} shown`);
  ok(R.turnDegPerS > 50 && R.turning.ground < 1, `a held right thumb sideways turns on the spot: ${R.turnDegPerS} deg/s at ${R.turning.ground} m/s`);
  ok(R.drift.ground > 4 && R.drift.ground <= 8.05 && R.drift.pitch < -3, `the stick up drifts forward, nose down: ${R.drift.ground} m/s, ${R.drift.pitch} deg`);
  ok(R.climb.vy > 10 && R.climb.vy <= 15.5 && R.climb.ground < 1, `the stick down climbs at about 15 m/s: ${R.climb.vy}`);
  ok(R.downInZone.below === 1, 'a flick down in School Zone is nothing yet');
  ok(R.out.below === 0 && R.out.balloons === 0 && R.beforeOut.balloons > 0, `a flick up is Cruise and the balloons burst: ${R.beforeOut.balloons} to ${R.out.balloons}`);
  ok(R.cruiseAgain.speed > 25 && R.cruiseAgain.zoneIn < 0.05, `Cruise again, the lens back out: ${R.cruiseAgain.speed} m/s, ${R.cruiseAgain.zoneIn}`);
  res.zone = R;
  console.log('zone:', JSON.stringify(R));
  writeFileSync(`${out}/zone.json`, JSON.stringify(R, null, 1));
  await page.close();
}

if (modes.has('bomb')) {
  const R = { rows: [], verdicts: [] };
  const ok = (c, m) => R.verdicts.push(`${c ? 'ok' : 'FAIL'}: ${m}`);
  const progInit = () => {
    const P = WebGL2RenderingContext.prototype, cp = P.createProgram;
    window.__progs = 0;
    P.createProgram = function () { window.__progs++; return cp.call(this); };
  };
  // (one page each: the street at Cruise, School Zone and Jet; ?life; ?moon's ground at Tycho)
  const pages = [
    ['street', Q + '&bomb', [['cruise', 'II', 1000], ['cruise', 'III', 1700], ['zone', 'III', 1700], ['jet', 'III', 1700], ['high', 'III', 1700]]],
    ['life', Q + '&bomb&life', [['cruise', 'III', 1700]]],
    ['moon', '?moon&site=TYCHO&skipintro&fixeddt=0.05&bomb', [['cruise', 'III', 1700]]],
  ];
  for (const [where, query, rows] of pages) {
    const page = await open(query, progInit);
    const cdp = await page.context().newCDPSession(page);
    const H = hand(page, cdp);
    await wall(1300);
    await page.evaluate(() => {
      const g = window.__game, p = g.perf, orig = p.frame.bind(p);
      g.flight.glideSpeed = 0;
      g.audio.unlock();
      // (every frame's draws and triangles, the fps meter's counters, from when __bombTrace is set)
      p.frame = (dt, work) => {
        orig(dt, work);
        if (window.__bombTrace) window.__bombTrace.push([p.calls, p.tris]);
      };
      // (when each tier showed, as a watcher hears it: holds.bomb.watch)
      window.__bombTiers = [];
      g.bomb.watch({ tier: (t) => window.__bombTiers.push([t, performance.now()]) });
    });
    await runFor(page, 2);
    // (the page's first touch runs a long task in its touchstart: one in the lane first)
    await H.down(1, 196, 780);
    await wall(60);
    await H.up(1);
    await runFor(page, 1);
    const progs0 = await page.evaluate(() => window.__progs);
    for (const [rung, tier, ms] of rows) {
      const key = `${where}-${rung}-${tier}`;
      if (rung === 'zone') {
        await H.stamped(() => H.stroke(1, 100, 520, 0, 74, 85));
        await runFor(page, 3.5);
      }
      if (rung === 'jet') {
        // (a flick up out of School Zone first: Cruise again, then three gears up)
        await H.stamped(() => H.stroke(1, 100, 520, 0, -74, 85));
        await runFor(page, 2);
        await toJet(page);
        // (held over the Richmond heading east, 150 m up, while the city streams in, as warmcheck --comet does: flown on from Alamo Square, Jet's Comet
        // came down in the bay, a splash with nothing to raise)
        await page.evaluate(() => {
          const g = window.__game, o = g.city.manifest.origin, r = Math.PI / 180, x = (-122.4655 - o[1]) * r * 6378137 * Math.cos(o[0] * r), z = -(37.7756 - o[0]) * r * 6378137;
          const y = g.city.groundAt(x, z) + 150;
          window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
          Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0 });
        });
        await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
        await page.evaluate(() => (window.__qa = null));
        await runFor(page, 2.5);
      }
      if (rung === 'high') {
        // (600 m over Noe Valley, the world review's: the coarse regions' tiles there split out after its ground has started, three a frame, where they stayed bare)
        await page.evaluate(() => {
          const g = window.__game, o = g.city.manifest.origin, r = Math.PI / 180, x = (-122.4337 - o[1]) * r * 6378137 * Math.cos(o[0] * r), z = -(37.7502 - o[0]) * r * 6378137;
          const y = g.city.groundAt(x, z) + 600;
          window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
          Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0 });
        });
        await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
        await page.evaluate(() => (window.__qa = null));
        await runFor(page, 1);
      }
      await page.evaluate(() => window.__game.forceReady());
      await runFor(page, 0.5);
      const a = await page.evaluate(() => {
        const g = window.__game, s = g.bombState(), m = g.moon?.paint;
        window.__lv0 = g.city.paint.data.slice();
        window.__cr0 = m ? new Map([...m.recs].map(([k, r]) => [k, r.level])) : null;
        return { stats: s.stats, box: s.box, gear: g.controls.turbo.name, full: g.cometState().full };
      });
      if (!a.box) { ok(false, `${key}: the bus's box is set`); continue; }
      const x = Math.round((a.box.x0 + a.box.x1) / 2), y = Math.round((a.box.y0 + a.box.y1) / 2);
      const pt0 = await page.evaluate(() => ((window.__bombTiers.length = 0), performance.now()));
      await H.down(1, x, y);
      await wall(ms - 60);
      // (no still while it's held: a 3x screenshot takes long enough to carry a Bomb II past III's 1.29 s. Its tier just before the lift, and when each showed:
      // read 150 ms before, ?life's III came after it once on a loaded laptop, and the row failed on a Bomb III fired as III)
      const charging = await page.evaluate((t0) => ({ tier: window.__game.bomb.tier, ring: { ...window.__game.bomb.ring }, shown: window.__bombTiers.map(([t, at]) => [t, Math.round(at - t0)]) }), pt0);
      await wall(60);
      await page.evaluate(() => (window.__bombTrace = []));
      await H.up(1);
      await runFor(page, 1.2);
      await page.screenshot({ path: `${out}/bomb-${key}-2-landed.png` });
      await runFor(page, 2.6);
      const b = await page.evaluate(() => {
        const g = window.__game, s = g.bombState(), l = g.lastShot(), d = g.city.paint.data, d0 = window.__lv0, m = g.moon?.paint;
        const jump = s.stats.jump;
        let raised = 0, wrong = 0, past3 = 0;
        for (let i = 1; i < d.length; i += 4) {
          if (d[i] === d0[i]) continue;
          raised++;
          if (d[i] > 3) past3++;
          if (d[i] !== Math.min(3, d0[i] + jump)) wrong++;
        }
        let craters = 0, craterTop = 0, craterJump = 0;
        if (m) for (const [k, r] of m.recs) {
          const was = window.__cr0.get(k) ?? 0;
          if (r.level === was) continue;
          craters++;
          craterTop = Math.max(craterTop, r.level);
          craterJump = Math.max(craterJump, r.level - was);
        }
        const tr = window.__bombTrace;
        window.__bombTrace = null;
        // (its ground and trees in 0.8 of its circle: on the page most of a wide Bomb's tiles came in after its ground started and stayed bare, and its outer trees grey)
        const near = m ? null : g.paintedAt(l.aim[0], l.aim[2], 0.8 * s.stats.radius);
        return { stats: s.stats, comet: !!l?.comet, full: g.cometState().full, raised, wrong, past3, craters, craterTop, craterJump, frames: tr.length, draws: Math.max(...tr.map((t) => t[0])), tris: Math.max(...tr.map((t) => t[1])), ground: near && +near.groundShare.toFixed(3), treesOnPaint: near?.treesOnPaint, treesGrey: near?.treesGrey };
      });
      const row = { key, gear: a.gear, at: [x, y], held: ms, charging, fired: b.stats.fired - a.stats.fired, fizzles: b.stats.fizzles - a.stats.fizzles, tier: b.stats.tier, radius: Math.round(b.stats.radius), jump: b.stats.jump, comet: b.comet, full: b.full - a.full, raised: b.raised, wrong: b.wrong, past3: b.past3, craters: b.craters, craterTop: b.craterTop, craterJump: b.craterJump, frames: b.frames, draws: b.draws, tris: b.tris, ground: b.ground, treesOnPaint: b.treesOnPaint, treesGrey: b.treesGrey };
      R.rows.push(row);
      console.log('bomb:', JSON.stringify(row));
      const want = tier === 'III' ? 3 : 2;
      ok(row.fired === 1 && row.fizzles === 0 && row.tier === want && charging.tier === want, `${key}: held ${ms} ms on the bus, a Bomb ${tier} (fired ${row.fired}, tier ${row.tier}, charging ${charging.tier}, fizzles ${row.fizzles})`);
      ok(charging.ring.k > 0.5 && charging.ring.r > 0, `${key}: its ring shows while it charges (k ${charging.ring.k.toFixed(2)}, ${Math.round(charging.ring.r)} m)`);
      if (where === 'moon') ok(row.craters > 0 && row.craterTop <= 3 && row.craterJump >= 2, `${key}: craters take its jump, none past 3 (${row.craters}, top ${row.craterTop}, jump ${row.craterJump})`);
      else {
        ok(row.raised > 0 && row.wrong === 0 && row.past3 === 0, `${key}: every building it raised at min(3, before + ${row.jump}), none past 3 (${row.raised}, ${row.wrong} not, ${row.past3} past)`);
        ok(row.ground >= 0.5 && row.treesGrey === 0, `${key}: its ground painted in 0.8 of its circle, and every tree standing on it (${row.ground} of the ground, ${row.treesGrey} of ${row.treesOnPaint} trees grey)`);
      }
      if (rung === 'jet') ok(row.comet && row.full === 1, `${key}: at Jet the Comet's landing, with its full show (comet ${row.comet}, full ${row.full})`);
      ok(row.frames > 10 && row.draws <= 200 && row.tris <= 1.5e6, `${key}: through its stages and the pogo at most 200 draws and 1.5 M triangles (${row.frames} frames, ${row.draws} draws, ${(row.tris / 1e6).toFixed(3)} M)`);
    }
    const made = (await page.evaluate(() => window.__progs)) - progs0;
    R[where] = { programsAtReady: progs0, madeAfter: made };
    ok(made === 0, `${where}: nothing compiles: ${made} programs made after ready`);
    await page.close();
  }
  res.bomb = R;
  console.log('bomb:', R.verdicts.join('\n  '));
  writeFileSync(`${out}/bomb.json`, JSON.stringify(R, null, 1));
  if (R.verdicts.some((v) => v.startsWith('FAIL'))) process.exitCode = 1;
}

if (modes.has('lob')) {
  const R = { rows: [], verdicts: [] };
  const ok = (c, m) => R.verdicts.push(`${c ? 'ok' : 'FAIL'}: ${m}`);
  const progInit = () => {
    const P = WebGL2RenderingContext.prototype, cp = P.createProgram;
    window.__progs = 0;
    P.createProgram = function () { window.__progs++; return cp.call(this); };
  };
  const pages = [
    ['street', Q, ['cruise', 'express', 'nonstop']],
    ['life', Q + '&life', ['cruise']],
    ['moon', '?moon&site=TYCHO&skipintro&fixeddt=0.05', ['cruise']],
  ];
  for (const [where, query, rungs] of pages) {
    const page = await open(query, progInit);
    const cdp = await page.context().newCDPSession(page);
    const H = hand(page, cdp);
    await wall(1300);
    await page.evaluate(() => {
      const g = window.__game, p = g.perf, orig = p.frame.bind(p);
      g.flight.glideSpeed = 0;
      g.audio.unlock();
      // (every frame's draws, triangles and live particles, from when __lobTrace is set)
      p.frame = (dt, work) => {
        orig(dt, work);
        if (window.__lobTrace) window.__lobTrace.push([p.calls, p.tris, g.particles.alive]);
      };
    });
    await runFor(page, 2);
    await H.down(1, 196, 780);
    await wall(60);
    await H.up(1);
    await runFor(page, 1);
    const progs0 = await page.evaluate(() => window.__progs);
    for (const rung of rungs) {
      const key = `${where}-${rung}`;
      await page.evaluate((r) => {
        const g = window.__game;
        while (g.controls.turbo.gear > 0) g.controls.turbo.shift(-1, g.flight);
        for (let i = 0; i < (r === 'express' ? 1 : r === 'nonstop' ? 2 : 0); i++) g.controls.turbo.shift(1, g.flight);
      }, rung);
      if (where !== 'moon') {
        // (back over the Western Addition heading east at the roofs, held while the city streams in: flown on, a row ended over the bay)
        await page.evaluate(() => {
          const g = window.__game, o = g.city.manifest.origin, r = Math.PI / 180, x = (-122.4352 - o[1]) * r * 6378137 * Math.cos(o[0] * r), z = -(37.7763 - o[0]) * r * 6378137;
          const y = g.city.obstacleAt(x, z) + 12;
          window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
          Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0 });
        });
        await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
        await page.evaluate(() => (window.__qa = null));
      }
      await runFor(page, rung === 'nonstop' ? 2.5 : 1.2);
      await page.evaluate(() => window.__game.forceReady());
      await runFor(page, 0.3);
      await page.evaluate(() => {
        const g = window.__game, m = g.moon?.paint;
        window.__lv0 = g.city.paint.data.slice();
        window.__cr0 = m ? new Map([...m.recs].map(([k, r]) => [k, r.level])) : null;
        window.__lob0 = { lobs: g.lobState().lobs, fired: g.cometState().fired };
      });
      // the pull: a thumb down in the lane under the bus, drawn 60 px down (most of the stick), held 1.8 s on the game's clock
      await H.down(1, 196, 690);
      for (let i = 1; i <= 6; i++) {
        await wall(25);
        await H.move(1, 196, 690 + i * 10);
      }
      await runFor(page, 1.8);
      const pull = await page.evaluate(() => { const g = window.__game, s = g.lobState(); return { body: (g.flight.pitch * 180) / Math.PI, plan: s.plan && { x: s.plan.x, z: s.plan.z, reach: s.plan.reach, kind: s.plan.kind }, ring: s.ring }; });
      await page.screenshot({ path: `${out}/lob-${key}-1-ring.png` });
      await page.evaluate(() => (window.__lobTrace = []));
      await H.up(1);
      await runFor(page, 0.1);
      await H.down(2, 300, 300);
      await wall(60);
      await H.up(2);
      await until(page, 'g.lastShot() && g.clock() - g.lastShot().t > g.lastShot().travel - 0.05', 6);
      await page.screenshot({ path: `${out}/lob-${key}-2-landed.png` });
      await runFor(page, 1.5);
      const b = await page.evaluate(() => {
        const g = window.__game, l = g.lastShot(), c = l?.comet, d = g.city.paint.data, d0 = window.__lv0, m = g.moon?.paint;
        let raised = 0, two = 0;
        for (let i = 1; i < d.length; i += 4) {
          if (d[i] === d0[i]) continue;
          raised++;
          if (d[i] - d0[i] > 1) two++;
        }
        let craters = 0, craterTwo = 0;
        if (m) for (const [k, r] of m.recs) {
          const was = window.__cr0.get(k) ?? 0;
          if (r.level === was) continue;
          craters++;
          if (r.level - was > 1) craterTwo++;
        }
        const tr = window.__lobTrace;
        window.__lobTrace = null;
        return { kind: c?.kind ?? (c ? 'comet' : 'splat'), angle: c?.angle !== undefined ? (c.angle * 180) / Math.PI : null, reach: c ? c.reach : null, crater: !!l?.crater, miss: !!l?.miss, lobs: g.lobState().lobs - window.__lob0.lobs, raised, two, craters, craterTwo, frames: tr.length, draws: Math.max(...tr.map((t) => t[0])), tris: Math.max(...tr.map((t) => t[1])), particles: Math.max(...tr.map((t) => t[2])) };
      });
      const row = { key, body: +pull.body.toFixed(1), planned: pull.plan, ringK: +pull.ring.k.toFixed(2), ...b, angle: b.angle === null ? null : +b.angle.toFixed(1), reach: b.reach === null ? null : Math.round(b.reach) };
      R.rows.push(row);
      console.log('lob:', JSON.stringify(row));
      if (rung === 'nonstop') ok(row.kind === 'lob' || row.kind === 'comet', `${key}: a Lob, or the Comet where it lands farther (${row.kind}, ${row.reach} m)`);
      else ok(row.kind === 'lob' && row.lobs === 1, `${key}: a Lob (${row.kind}, ${row.lobs} thrown, the body ${row.body} at the lift)`);
      if (row.kind === 'lob') {
        ok(pull.plan?.kind === 'lob' && row.ringK > 0.9, `${key}: its ring showed while pulled (planned ${JSON.stringify(pull.plan)}, ring ${row.ringK})`);
        ok(Math.abs(row.angle - Math.min(70, row.body)) <= 1.5, `${key}: thrown at the body as the thumb lifted (${row.angle} for ${row.body})`);
      }
      if (where === 'moon') ok(row.craters > 0 && row.craterTwo === 0, `${key}: craters a level each (${row.craters}, ${row.craterTwo} two)`);
      else ok(row.raised > 0 && row.two === 0, `${key}: every building it raised a level, none two (${row.raised}, ${row.two} two)`);
      ok(row.frames > 10 && row.draws <= 200 && row.tris <= 1.5e6 && row.particles <= 8000, `${key}: through its flight and landing at most 200 draws, 1.5 M triangles and 8,000 particles (${row.frames} frames, ${row.draws} draws, ${(row.tris / 1e6).toFixed(3)} M, ${row.particles} particles)`);
    }
    const made = (await page.evaluate(() => window.__progs)) - progs0;
    R[where] = { programsAtReady: progs0, madeAfter: made };
    ok(made === 0, `${where}: nothing compiles: ${made} programs made after ready`);
    await page.close();
  }
  res.lob = R;
  console.log('lob:', R.verdicts.join('\n  '));
  writeFileSync(`${out}/lob.json`, JSON.stringify(R, null, 1));
  if (R.verdicts.some((v) => v.startsWith('FAIL'))) process.exitCode = 1;
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
  // (a drag that flies lands in the bus's lane, under the bus; one anywhere else looks and teaches nothing)
  const fl = await page.evaluate(() => window.__game?.input?.busZone ?? null);
  const fx = fl ? Math.round(fl.x) : 300, fy = fl ? Math.round(Math.min(fl.y + 90, 780)) : 600;
  await H.down(1, fx, fy); await H.move(1, fx + 40, fy); await runFor(page, 0.5); await H.up(1);
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
  // the first visit's gate, on the real bridge: a gear waits for it, a flick down takes it back, and one rung waits however many flicks: two are one, six are Express at the bridge, not TURBO 3
  mkdirSync(`${out}/opening`, { recursive: true });
  const R = {};
  // (SB_OPENING=grey,low,... runs a part: gate, two, six, low, grey, carve, pull)
  const parts = new Set((process.env.SB_OPENING ?? 'gate,two,six,low,grey,carve,pull').split(','));
  /** every line the toast is given from now, with the game clock: the toast is a canvas, its words aren't in the page */
  const logToasts = (page) => page.evaluate(() => {
    const g = window.__game, hud = g.controls.hud, toast = hud.toast.bind(hud);
    window.__toasts = [];
    hud.toast = (lines, s) => {
      window.__toasts.push({ t: +g.clock().toFixed(2), lines: lines.join(' / ') });
      return toast(lines, s);
    };
  });
  const toasts = (page) => page.evaluate(() => window.__toasts.map((x) => x.lines));
  const first = async () => {
    const page = await open('?fixeddt=0.05', null, base, { ready: 'window.__game && window.__game.city.loadedRegionCount() > 0' });
    const cdp = await page.context().newCDPSession(page);
    await logToasts(page);
    await until(page, '!g.controls.opening', 60);
    await runFor(page, 0.3);
    return { page, H: hand(page, cdp) };
  };
  const state = (page) => page.evaluate(() => {
    const g = window.__game, f = g.flight, c = g.controls, s = c.snapshot();
    return { clock: +g.clock().toFixed(2), locked: c.gearsLocked, gear: c.turbo.gear, level: c.turbo.level, armed: s.turbo.armed, y: +f.y.toFixed(1), speed: +f.speed.toFixed(0), toast: document.querySelector('[data-hud="toast"]') !== null };
  });
  if (parts.has('gate')) {
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
  if (parts.has('two')) {
    const { page, H } = await first();
    await H.stamped(async () => { await H.stroke(1, 100, 520, 0, -74, 85); await H.stroke(1, 100, 520, 0, -74, 85, 235); });
    await runFor(page, 0.8);
    const s = await state(page);
    // taken back: one waited, so none does now
    await H.stamped(() => H.stroke(1, 100, 520, 0, 74, 85));
    await runFor(page, 0.15);
    const back = await state(page);
    await until(page, '!g.controls.gearsLocked', 60);
    await runFor(page, 0.5);
    R.two = { s, back, after: await state(page) };
    console.log('opening two flicks', JSON.stringify(R.two));
    await page.close();
  }
  if (parts.has('six')) {
    const { page, H } = await first();
    await H.stamped(async () => { for (let i = 0; i < 6; i++) await H.stroke(1, 100, 520, 0, -74, 85, i * 235); });
    await runFor(page, 0.8);
    const s = await state(page);
    await until(page, '!g.controls.gearsLocked', 60);
    await runFor(page, 0.5);
    R.six = { s, after: await state(page) };
    console.log('opening six flicks', JSON.stringify(R.six));
    await page.close();
  }
  if (parts.has('low')) {
    // the low shot has no look, so until the gate a lone touch anywhere flies (Input.lookOff, set with the gears' lock), even one landing where the lane would give it the look
    const { page, H } = await first();
    /** a lone touch lands straight over the bus, 40 px out of the lane's half disc, and drags 50 px right: what it was, whether the lane's rule alone would have looked there, how far the bus turned */
    const overBus = async () => {
      const at = await page.evaluate(() => {
        const g = window.__game, i = g.input, L = i.busZone;
        // (where the lane counts the bus: no nearer a side or the bottom than its half width, nor lower than its usual line, inputTune.laneLow)
        const x = Math.round(Math.max(L.r, Math.min(innerWidth - L.r, L.x))), y = Math.round(Math.min(L.y, innerHeight - L.r, innerHeight * 0.6) - L.r - 40);
        const off = i.lookOff;
        i.lookOff = false;
        const laneLooks = i.inLookZone(x, y);
        i.lookOff = off;
        return { x, y, laneLooks, lookOff: off, locked: g.controls.gearsLocked, lane: { x: Math.round(L.x), y: Math.round(L.y), r: Math.round(L.r) }, clock: +g.clock().toFixed(2), h0: g.flight.heading };
      });
      await H.down(1, at.x, at.y);
      await wall(150);
      await H.move(1, at.x + 50, at.y);
      await runFor(page, 0.3);
      const s = await page.evaluate((h0) => {
        const g = window.__game, s = g.controls.snapshot();
        return { thumb: s.input.thumb, sx: +s.input.sx.toFixed(2), look: s.input.look.on, turned: +(((g.flight.heading - h0) * 180) / Math.PI).toFixed(2), lookOffAfter: g.input.lookOff, lockedAfter: g.controls.gearsLocked };
      }, at.h0);
      await H.up(1);
      await runFor(page, 0.2);
      const { h0, ...where } = at;
      return { ...where, ...s };
    };
    const low = await overBus();
    await until(page, '!g.controls.gearsLocked', 60);
    await runFor(page, 0.3);
    const after = await overBus();
    R.low = { low, after };
    console.log('opening low shot', JSON.stringify(R.low));
    await page.close();
  }
  if (parts.has('grey')) {
    // a flick in the grey, before the first frame: the page takes touches while the warm-up compiles, and the gate used to shut only with the first frame (main.ts),
    // so a flick there was a gear at once, under the low shot. The loop is held from the page's first script (__qa.holdFrames 0), so the flick lands before any
    // frame has run however soon the warm-up ends: frame() returns before the gate's line until the loop is let go
    const page = await open('?fixeddt=0.05', 'window.__qa = { holdFrames: 0 };', base, { ready: 'window.__game && window.__game.controls' });
    const cdp = await page.context().newCDPSession(page);
    const H = hand(page, cdp);
    await logToasts(page);
    // (stamped() dates a stroke from 2 s back on the page's clock: the page must be that old)
    await page.waitForFunction(() => performance.now() > 2500, null, { timeout: 60000 });
    const now = () => page.evaluate(() => {
      const g = window.__game, c = g.controls;
      return { clock: g.clock(), warming: g.warm.busy, locked: c.gearsLocked, lookOff: g.input.lookOff, gear: c.turbo.gear, armed: c.shifter.armed };
    });
    const pre = await now();
    let grey = null;
    await H.stamped(async () => {
      await H.stroke(1, 100, 520, 0, -74, 85);
      grey = { ...(await now()), toasts: await toasts(page) };
    });
    // (let go: the city streams in, the fog lifts, the low shot glides to the bridge)
    await page.waitForFunction(() => window.__game.city.loadedRegionCount() > 0, null, { timeout: 400000 });
    await until(page, '!g.controls.opening', 60);
    await runFor(page, 0.5);
    const low = await state(page);
    const cleared = await until(page, '!g.controls.gearsLocked', 60);
    await runFor(page, 0.5);
    R.grey = { pre, grey, low, cleared, after: await state(page) };
    console.log('opening grey', JSON.stringify(R.grey));
    await page.close();
  }
  if (parts.has('carve')) {
    // past the gate a hard carve takes the bus back under 230 m along, the gate being along the heading: it shut again there, the gears, the climb and the lane, with the
    // view rising, the look answering and the bridge passed. Once open it shuts again only under the low shot's line, 180 m, where a lone landing brings the low shot back.
    // The carve is the QA stick, full right
    const { page, H } = await first();
    await until(page, '!g.controls.gearsLocked', 60);
    await page.evaluate(() => (window.__qa = { holdFrames: 0 }));
    // (the gap the gate is measured from, as main.ts finds it, and along the heading from it where each frame measured it: before the frame's first step)
    await page.evaluate(async () => {
      const g = window.__game, f = g.flight;
      const m = await (await fetch(`./city/sf/city.json?v=${window.__sbDataV}`)).json();
      const [, t1, t2] = m.landmarks.find((l) => l.kind === 'ggb').points;
      const sx = t2[0] - t1[0], sz = t2[1] - t1[1], sl = Math.hypot(sx, sz);
      const gap = [t1[0] + (sx / sl) * 85, t1[1] + (sz / sl) * 85];
      const step = f.step.bind(f);
      let c = NaN;
      window.__gate = { along: NaN };
      f.step = (...a) => {
        if (g.clock() !== c) {
          c = g.clock();
          window.__gate.along = (f.x - gap[0]) * f.fx + (f.z - gap[1]) * f.fz;
        }
        return step(...a);
      };
    });
    /** carve until cond holds of a frame ({ along, locked, lookOff, low }), then hold the loop on that frame; every frame logged */
    const carve = (cond) => page.evaluate((cond) => new Promise((res) => {
      const g = window.__game, f = g.flight, log = [], t0 = g.clock();
      const test = new Function('s', `return (${cond});`);
      let seen = g.clock();
      window.__qa = { sx: 1, sy: 0 };
      const tick = () => {
        if (g.clock() !== seen) {
          seen = g.clock();
          const s = { t: +seen.toFixed(2), along: window.__gate.along, locked: g.controls.gearsLocked, lookOff: g.input.lookOff, low: +g.rig.openingLow.toFixed(2), deg: Math.round((f.heading * 180) / Math.PI) };
          log.push(s);
          if (test(s)) return (window.__qa = { holdFrames: 0 }), res(log);
        }
        if (g.clock() - t0 > 6) return (window.__qa = { holdFrames: 0 }), res(log);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), cond);
    /** with the loop held, a lone touch lands where the lane alone gives the look, straight over the bus 40 px out of its half disc: did it fly? It is cancelled */
    const landing = async () => {
      const at = await page.evaluate(() => {
        const g = window.__game, i = g.input, L = i.busZone;
        const x = Math.round(Math.max(L.r, Math.min(innerWidth - L.r, L.x))), y = Math.round(Math.min(L.y, innerHeight - L.r, innerHeight * 0.6) - L.r - 40);
        const off = i.lookOff;
        i.lookOff = false;
        const laneLooks = i.inLookZone(x, y);
        i.lookOff = off;
        return { x, y, laneLooks, lookOff: off, locked: g.controls.gearsLocked };
      });
      await H.down(1, at.x, at.y);
      const flew = await page.evaluate(() => !window.__game.input.canAdopt);
      await H.cancel();
      await wall(100);
      return { ...at, flew };
    };
    const clear = await carve('s.along >= 185 && s.along <= 225');
    const lane = await landing();
    // (and a flick up there is a gear at once: under the gate it would say GEARS AFTER THE BRIDGE and wait)
    await H.stamped(() => H.stroke(1, 100, 520, 0, -74, 85));
    const flick = { gear: (await state(page)).gear, toasts: await toasts(page) };
    const back = await carve('s.along < 175');
    const low = await landing();
    await page.evaluate(() => (window.__qa = null));
    const log = [...clear, ...back].map((s) => ({ ...s, along: +s.along.toFixed(1) }));
    R.carve = { gate: log[0], clear: log[clear.length - 1], lane, flick, back: log.at(-1), low, log };
    // (the rule on the frames themselves, at full precision: once open, the gate shuts again under 180 m along, the gears and the lane together)
    R.carve.rule = [...clear, ...back].every((s) => s.locked === s.along < 180 && s.lookOff === s.locked);
    console.log('opening carve', JSON.stringify({ ...R.carve, log: `${log.length} frames` }));
    console.log('opening carve frames', log.map((s) => `${s.t} ${s.along} ${s.deg}deg ${s.locked ? 'L' : '-'}${s.lookOff ? 'O' : '-'} ${s.low}`).join(' | '));
    await page.close();
  }
  if (parts.has('pull')) {
    // a lone flick down under the gate with nothing waiting: the stroke pulls the stick until it lifts and the climb is held, so it says CLIMB AFTER THE BRIDGE, as every
    // pull there did on main. It lands over the bus, out of the half disc, where the lane alone made it the second thumb, which never pulls. The studio's call (DECISIONS)
    const { page, H } = await first();
    await events(page);
    const at = await page.evaluate(() => {
      const L = window.__game.input.busZone;
      return { x: Math.round(L.x), y: Math.round(Math.min(L.y, innerHeight * 0.6) - L.r - 40) };
    });
    await H.stamped(() => H.felt(1, at.x, at.y, 0, 74, 85));
    await runFor(page, 0.3);
    R.pull = { at, ...(await state(page)), flicks: (await events(page)).filter((e) => e.k === 'onTurbo').map((e) => e.a), toasts: await toasts(page) };
    console.log('opening pull', JSON.stringify(R.pull));
    await page.close();
  }
  const G = R.gate, T = R.two, S = R.six, L = R.low, Y = R.grey, C = R.carve, P = R.pull;
  const checks = [];
  if (G)
    checks.push(
      ['the gate is shut at first', G.locked0],
      ['a flick under it waits, said', G.armed.armed && G.armed.gear === 0 && G.armed.toast],
      ['a flick down takes it back', !G.back.armed && G.back.gear === 0],
      ['a flick again waits again', G.again.armed && G.again.gear === 0],
      ['and goes at the gate', G.cleared && !G.after.armed && G.after.gear === 1 && G.after.level === 0],
    );
  if (T)
    checks.push(
      ['two flicks: one waits', T.s.armed && T.s.gear === 0],
      ['a flick down takes it back, and none is left', !T.back.armed && T.back.gear === 0 && T.after.gear === 0],
    );
  if (S)
    checks.push(
      ['six flicks: one waits', S.s.armed && S.s.gear === 0],
      ['six flicks are Express at the bridge, not TURBO 3', S.after.gear === 1 && S.after.level === 0 && !S.after.armed],
    );
  if (L)
    checks.push(
      ['under the low shot the lane is off, with the gears', L.low.lookOff && L.low.locked && L.low.lookOffAfter && L.low.lockedAfter],
      ['the drags land where the lane alone gives the look, over the bus out of its half disc', L.low.laneLooks && L.after.laneLooks],
      ['under the low shot that drag flies: the stick and the heading move', L.low.thumb && !L.low.look && L.low.sx > 0.2 && L.low.turned > 0],
      ['past the gate the lane is back, with the gears', !L.after.lookOff && !L.after.locked && !L.after.lookOffAfter],
      ['and the same landing looks', L.after.look && !L.after.thumb && L.after.sx === 0],
    );
  if (Y)
    checks.push(
      ['in the grey, before any frame has run, the gate and the lane are shut', Y.pre.clock === 0 && Y.pre.locked && Y.pre.lookOff],
      ['a flick there waits for the gate, said', Y.grey.clock === 0 && Y.grey.gear === 0 && Y.grey.armed && Y.grey.toasts.includes('GEARS AFTER THE BRIDGE')],
      ['under the low shot it still waits, and the bus glides low', Y.low.gear === 0 && Y.low.armed && Y.low.y < 30 && Y.low.speed < 60],
      ['and it goes at the gate', Y.cleared && Y.after.gear === 1 && Y.after.level === 0 && !Y.after.armed],
    );
  if (C)
    checks.push(
      ['a hard carve past the gate takes the bus back under 230 m along, and the gate stays open there', !C.gate.locked && C.clear.along >= 185 && C.clear.along <= 225 && !C.clear.locked && !C.clear.lookOff],
      ['there the view is rising, and the lane stays: a landing the lane gives the look looks', !C.lane.locked && !C.lane.lookOff && C.lane.laneLooks && !C.lane.flew],
      ['and a flick up there is a gear at once, not GEARS AFTER THE BRIDGE', C.flick.gear === 1 && !C.flick.toasts.includes('GEARS AFTER THE BRIDGE')],
      ["under the low shot's line the gate shuts again, the lane with the gears: that landing flies", C.back.along < 180 && C.low.locked && C.low.lookOff && C.low.laneLooks && C.low.flew],
      ['every frame of the carve: the gears and the lane shut under 180 m along, together', C.log.length > 2 && C.rule],
    );
  if (P)
    checks.push([
      "a lone flick down under the gate with nothing waiting says CLIMB AFTER THE BRIDGE, its pull's answer, as on main (the studio's call)",
      P.flicks.length === 1 && P.flicks[0][0] === -1 && P.toasts.includes('CLIMB AFTER THE BRIDGE') && P.gear === 0 && !P.armed,
    ]);
  const badO = checks.filter(([, v]) => !v).map(([k]) => k);
  console.log(badO.length ? `opening: FAILED ${badO.length} of ${checks.length}: ${badO.join('; ')}` : `opening: all ${checks.length} checks passed`);
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
