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
//   lobhigh  the Lob from any height (not in the default list): pinned 2, 5 and 14 km over the Western Addition and at the 15 km ceiling, Cruise and
//            Turbo 3, a real pull and a tap. Each: a Lob, its ring planned in the pull, on loaded ground; from the tap to the dip's hold after the hit
//            the bus on screen at +0.35 or lower, the star on screen, the hit at -0.3 or higher from 5 km and under, the frame's draws, triangles
//            and wall time; no program made after ready, no page error, a still at the hit                              -> lobhigh.json
//   comet    the Comet dead ahead (not in the default list): Turbo 3 and Nonstop at the floor, 300 m, 1, 5 and 14 km over the Western Addition and in a
//            45 degree dive from 5 km, SB_TAPS real taps a pose (10). Each: a Comet, never the classic shot; low ones straight ahead and the view never
//            dipped, far ones on loaded ground; the star and the bus on screen; at the floor the drops; the frame's draws, triangles and wall time; no
//            program made after ready, no page error                                                                    -> comet.json
//   chain    a far shot's dip chained (not in the default list): Nonstop level 5 km up, a tap each refill for 20 s, then a far Comet with a look during
//            it, one with the steering thumb during it, and a tap 0.3 s after one. The bus on screen at +0.35 or lower every frame, the share dipped
//            printed; the look a look and the view back within 1.5 s; the thumb flies and turns the bus; no program made after ready -> chain.json
//   swervefar ?swerve's handling under a far shot (not in the default list; docs/specs/flight/SWERVE.md, "The shots under the handling"): level 5 km over
//            the Western Addition. A far Comet with no touch after it at Nonstop, for the record, and at Jet: the view dipped at its hit. From 5 km its hit
//            lands under the frame at both (the bus held 35 % down the screen wins, config.shotView.busMax), so this row holds the swipe's mechanism and
//            the landing's place against no touch's, not the hit in the frame. Then at Jet a far Comet and, as soon as the tap is up, the long swipe by
//            real touches from the top of the glass (5 moves of 80 px stamped 150 ms, a frame each): a look for a frame or more while it may still be the
//            swipe, it answers (Cruise) under the thumb 0.3 s or more before the hit, and at the hit there's no look on, the view is still dipped, at
//            least half of no touch's, and the landing no further under the frame than no touch's, 0.25 of slack (the far shots' review F2). Then at
//            Nonstop one rival 300 m ahead under the nose, flying the bus's way at its own height over the roofs (the tap's pick by its flat reach, the
//            shell 5 km short), and a real tap: the far shot fires, no shell (F5). Each place's wait for the city and what held it. No program made
//            after ready, no page error. Exits 1 when a row fails                                                         -> swervefar.json
//   moonhigh no far shot over the Moon (not in the default list): ?moon 5 km up, a level tap at Turbo 3 and a nose-up one at Cruise; with SB_AGAINST
//            (another build's moonhigh.json) the same shots as that build's                                             -> moonhigh.json
//   stills   the stills for the producer's calls 4 and 5 (not in the default list): a far Comet's hit from 5 and 14 km three ways, the far Lob's ring
//            and beacon capped and uncapped, a low Comet's bow at Turbo 3                                               -> stills-*.png
//   boom     Sonic Boom (&boom; src/game/Boom.ts; not in the default list): at Turbo 2's 720 m/s, 150 and 300 m over the Western Addition and 150 over
//            downtown, a real flick into Turbo 3, in Rainbow, Atlantis, Hyperglow and Inferno (&paintas). Each: one crack, the hoop threaded, a ring, every
//            building it raised one level up, the bus over its hole, the frame's draws, triangles and live particles each frame through it (at most 200, 1.5 M
//            and 8,000), no program made after ready, and stills held on the Boom's clock at the crack, the hoop standing ahead, the bus at its plane, the
//            slam, the band blooming and the band behind, and the sky's ring at 0.2 s (SB_STILLS=0 leaves them out). Exits 1 when a row fails                 -> boom.json
//            SB_BOOM_X=1: the reviews' rows instead (BUILT.md, "The reviews of the Sonic Boom pass and of feat/extras"): a pull held after the flick over the
//            Western Addition, the slam heading north and south there, and downtown's tallest tower under the hoop from 150 m (SB_BOOM_XONLY=tower: that row)
//   falls    the Waterfall (&falls; src/fx/Falls.ts; not in the default list): at Cruise 60 m over a Financial District tower's roof, 300 m west of it, a
//            real tap off the lane, in Rainbow, Hyperglow and the Elderwood, the next tower if it didn't pour. Each: its drops and its pool landed round its
//            foot, the draws, triangles and particles each frame (200, 1.5 M, 8,000), nothing compiled, and stills of the runs, the drops and the pool.
//            Exits 1 when a row fails                                                                                          -> falls.json
//   curb     Curb with real touches, ?life (docs/specs/shots/CURB.md; not in the default set): two flicks down onto GEARS.md's arterial (SB_CURB=lat,lon,heading
//            moves it), a minute rolled beside the cars, the push, a look held left, a tap's drive-by, a flick up off it, School Zone's drift down onto
//            it again, a pull held off it, and over the bay FIND A STREET, with stills, the draws, triangles and frame times on the street -> curb.json
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
// SB_Q=&hour=blue appends to the street page's query (thumbs, states, keyboard, audio, firstrun): the same rows under a flag.
// The draws a frame makes follow the sun on the real clock (the sun pass keeps every caster in its window with the sun a few degrees up: at one pose 119 at
// night, 135 at noon, 188-205 at 07:15), so a row judging them pins it: SB_Q='&t=2026-11-13T15:15:00Z&rate=0', the worst minute measured (r3). SB_REPS=3
// (boom, falls) flies each page that many times and judges every run.
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
    async stamped(fn, keep = false) {
      await page.evaluate(() => (window.__qa = { holdFrames: 0 }));
      await wall(40);
      t0 = Date.now() / 1000 - 2;
      await fn();
      // (keep: the loop stays frozen after it, for a caller stepping it a frame at a time)
      if (!keep) await page.evaluate(() => (window.__qa = null));
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
        // (held there through the Bomb, so it lands on Noe's houses: let go 1 s before it at Jet, it came down 1.2 km east among a few warehouses)
        await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
        await runFor(page, 1);
      }
      // (a breath still under way first: forced full in it, its end empties the belly again as any breath does, and the Bomb's clock waits the 1.6 s
      // recharge, 0.5-0.6 s of the wall here, past the touch. The page's first row: the lane tap's breath, answered a frame or two into runFor's second)
      await page.waitForFunction(() => window.__game.flight.barfT < 0, null, { timeout: 20000, polling: 50 });
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
      // (from 600 m its shot flies about a second and its 456 m circle's rim takes its third stage 3.1 s after the impact)
      await runFor(page, rung === 'high' ? 4.6 : 2.6);
      if (rung === 'high') await page.evaluate(() => (window.__qa = null));
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
      // (each still with the loop held: run on, the pull lasted the still's 0.8-1.1 s more and the bus climbed 60-90 m past the row's, to 340-370 m over
      // downtown, where by day the city's own draws pass 200, Lob or not)
      const still = async (path) => {
        await page.evaluate(() => (window.__qa = { holdFrames: 0 }));
        await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 60000 });
        await page.screenshot({ path });
        await page.evaluate(() => (window.__qa = null));
      };
      await still(`${out}/lob-${key}-1-ring.png`);
      await page.evaluate(() => (window.__lobTrace = []));
      await H.up(1);
      await runFor(page, 0.1);
      await H.down(2, 300, 300);
      await wall(60);
      await H.up(2);
      await until(page, 'g.lastShot() && g.clock() - g.lastShot().t > g.lastShot().travel - 0.05', 6);
      await still(`${out}/lob-${key}-2-landed.png`);
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
      // (at Nonstop the Lob whenever one is planned, config.lob.wins: a Comet only where the pull planned none, its body latched as the thumb lifted)
      if (rung === 'nonstop') ok(row.kind === 'lob' || (row.kind === 'comet' && pull.plan?.kind !== 'lob'), `${key}: a Lob, or the Comet where none was planned (${row.kind}, ${row.reach} m, planned ${pull.plan?.kind ?? null})`);
      else ok(row.kind === 'lob' && row.lobs === 1, `${key}: a Lob (${row.kind}, ${row.lobs} thrown, the body ${row.body} at the lift)`);
      if (row.kind === 'lob') {
        // (at Nonstop, pulling, the Comet's landing can be the farther, or the Lob's not yet over the bus while it climbs: its ring may come only as the thumb lifts)
        if (rung !== 'nonstop' || pull.plan) ok(pull.plan?.kind === 'lob' && row.ringK > 0.9, `${key}: its ring showed while pulled (planned ${JSON.stringify(pull.plan)}, ring ${row.ringK})`);
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

if (modes.has('lobhigh')) {
  // The Lob from any height (BUILT.md, "The Lob from any height"; not in the default list): "I want to shoot lob shots even when I'm high elevation in the
  // sky" (the producer, 2026-11-12). Pinned 2, 5 and 14 km over the Western Addition heading east while the city streams, at Cruise and Turbo 3: a 2 s real
  // pull up (the vista comes in), the steering thumb lifted and a tap 0.1 s later; and at the 15 km ceiling with the pull held to a second finger's tap.
  // Each: a Lob (cometFx.stats.lobs), its ring planned in the pull, on a loaded tile at the tap and not a miss on land; from the tap to config.shotView.hold
  // after the hit, every frame: the bus on screen and at +0.35 or lower (NDC, the dip's limit), the star on screen on 90 % of its frames in the air, the hit
  // at -0.3 or higher at the impact from 5 km and under, at most 200 draws and 1.5 M triangles, no frame over 100 ms of wall time; no program made after
  // ready, no page error; and a still at the hit. Exits 1 when a row fails                                                                -> lobhigh.json
  const R = { rows: [], verdicts: [] };
  const ok = (c, m) => R.verdicts.push(`${c ? 'ok' : 'FAIL'}: ${m}`);
  const progInit = () => {
    const P = WebGL2RenderingContext.prototype, cp = P.createProgram;
    window.__progs = 0;
    P.createProgram = function () { window.__progs++; return cp.call(this); };
  };
  const page = await open(Q, progInit);
  let errors = 0;
  page.on('pageerror', () => errors++);
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  await page.evaluate(() => {
    const g = window.__game, p = g.perf, orig = p.frame.bind(p), V = g.camera.position.constructor, v = new V(), s = new V();
    g.flight.glideSpeed = 0;
    g.audio.unlock();
    // (every frame, from when __hiTrace is set: the clock, draws, triangles, the wall time since the last, the bus's NDC, the landing's, and the star's
    // while a Lob is in the air (null when none))
    const ndc = (x, y, z) => (v.set(x, y, z).applyMatrix4(g.camera.matrixWorldInverse).z >= 0 ? null : (v.set(x, y, z).project(g.camera), [+v.x.toFixed(3), +v.y.toFixed(3)]));
    let last = performance.now();
    p.frame = (dt, work) => {
      orig(dt, work);
      // (the frame after the still's freeze isn't a frame's time: __hiGap marks it)
      const now = performance.now(), ms = window.__hiGap ? 0 : now - last;
      last = now;
      window.__hiGap = false;
      const tr = window.__hiTrace;
      if (!tr) return;
      const f = g.flight, c = g.lastShot()?.comet, t = g.clock();
      const star = g.cometFx.live.find((q) => q.on && q.lob && t >= q.t0 && t <= q.t1);
      let st = null;
      if (star) {
        g.cometFx.at(star, Math.min(1, Math.max(0, (t - star.t0) / (star.t1 - star.t0))), s);
        st = ndc(s.x, s.y, s.z) ?? 'behind';
      }
      // (and how far the view looks down, its dip taken off: the dip never takes it past config.shotView.pitchMax in all, CameraRig.update)
      const down = -(Math.asin(Math.max(-1, Math.min(1, g.camera.getWorldDirection(s).y))) * 180) / Math.PI + g.rig.skyLift;
      // (and whether the dip's target is over where the landing, led as main.ts leads it, would show at config.shotView.low: a limit holds it, the bus's
      // or the swing, as s_lob --high's boundImp)
      let held = false;
      if (c) {
        const V = g.config.shotView, half = g.camera.fov / 2;
        s.set(c.x - f.fx * f.ground * V.lead, c.y - f.vy * V.lead, c.z - f.fz * f.ground * V.lead).applyMatrix4(g.camera.matrixWorldInverse);
        const want = (Math.atan2(s.y, -s.z) * 180) / Math.PI + g.rig.skyLift - (Math.atan(V.low * Math.tan((half * Math.PI) / 180)) * 180) / Math.PI;
        held = g.rig.skyLiftTarget > want + 0.5;
      }
      tr.push([+t.toFixed(3), p.calls, p.tris, +ms.toFixed(1), ndc(f.x, f.y, f.z), c ? ndc(c.x, c.y, c.z) : null, st, +g.rig.skyLift.toFixed(2), +down.toFixed(2), held]);
    };
  });
  await runFor(page, 2);
  await H.down(1, 196, 780);
  await wall(60);
  await H.up(1);
  await runFor(page, 1);
  const progs0 = await page.evaluate(() => window.__progs);
  const poses = [[2000, 'cruise'], [2000, 't3'], [5000, 'cruise'], [5000, 't3'], [14000, 'cruise'], [14000, 't3'], ['ceil', 'cruise'], ['ceil', 't3']];
  for (const [h, rung] of poses) {
    const key = h === 'ceil' ? `ceil-${rung}` : `${h / 1000}km-${rung}`;
    await page.evaluate((r) => {
      const g = window.__game;
      while (g.controls.turbo.gear > 0) g.controls.turbo.shift(-1, g.flight);
      for (let i = 0; i < (r === 't3' ? 6 : 0); i++) g.controls.turbo.shift(1, g.flight);
    }, rung);
    // (pinned over the Western Addition heading east, h over the ground there (the ceiling: 100 m under it), held while the city streams in)
    await page.evaluate((h) => {
      const g = window.__game, o = g.city.manifest.origin, r = Math.PI / 180, x = (-122.4352 - o[1]) * r * 6378137 * Math.cos(o[0] * r), z = -(37.7763 - o[0]) * r * 6378137;
      const y = h === 'ceil' ? g.config.flight.ceiling - 100 : g.city.groundAt(x, z) + h;
      window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
      Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0 });
    }, h);
    await runFor(page, 0.5);
    await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
    await page.evaluate(() => (window.__qa = null));
    await page.evaluate(() => window.__game.forceReady());
    await runFor(page, 0.3);
    await page.evaluate(() => {
      const g = window.__game;
      window.__lv0 = g.city.paint.data.slice();
      window.__lob0 = g.lobState().lobs;
    });
    // the pull: a thumb down in the lane under the bus, drawn 60 px down (most of the stick), held 2 s on the game's clock
    await H.down(1, 196, 690);
    for (let i = 1; i <= 6; i++) {
      await wall(25);
      await H.move(1, 196, 690 + i * 10);
    }
    await runFor(page, 2);
    const pull = await page.evaluate(() => {
      const g = window.__game, s = g.lobState(), f = g.flight;
      return { body: (f.pitch * 180) / Math.PI, strain: +f.strain.toFixed(2), agl: Math.round(f.y - g.city.groundAt(f.x, f.z)), plan: s.plan && { kind: s.plan.kind, far: !!s.plan.far, loaded: !!s.plan.loaded }, ringK: +s.ring.k.toFixed(2) };
    });
    await page.evaluate(() => (window.__hiTrace = []));
    if (h === 'ceil') {
      // (at the ceiling the pull held to the tap: a second finger's, then the steering thumb lifted)
      await H.down(2, 300, 300);
      await wall(60);
      await H.up(2);
      await runFor(page, 0.3);
      await H.up(1);
    } else {
      await H.up(1);
      await runFor(page, 0.1);
      await H.down(2, 300, 300);
      await wall(60);
      await H.up(2);
    }
    await until(page, 'g.lastShot() && g.clock() - g.lastShot().t > g.lastShot().travel - 0.05', 8);
    await page.evaluate(() => (window.__qa = { holdFrames: 0 }));
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 60000 });
    await page.screenshot({ path: `${out}/lobhigh-${key}-hit.png` });
    await page.evaluate(() => ((window.__hiGap = true), (window.__qa = null)));
    await until(page, 'g.lastShot() && g.clock() - g.lastShot().t > g.lastShot().travel + 0.05 + g.config.shotView.hold', 4);
    const b = await page.evaluate(() => {
      const g = window.__game, l = g.lastShot(), c = l?.comet, tr = window.__hiTrace;
      window.__hiTrace = null;
      return { t: l?.t ?? null, travel: l?.travel ?? null, kind: c?.kind ?? (c ? 'comet' : 'splat'), far: !!c?.far, loaded: !!c?.loaded, miss: !!l?.miss, lobs: g.lobState().lobs - window.__lob0, hold: g.config.shotView.hold, tr };
    });
    // (the frames from the tap to config.shotView.hold after the hit; the impact's frame the first at or past its time)
    const hold = b.hold, tImp = b.t !== null ? b.t + b.travel : Infinity, tr = b.tr.filter((q) => q[0] <= tImp + hold + 1e-6);
    const atImp = tr.find((q) => q[0] >= tImp - 1e-6) ?? null;
    const starFrames = tr.filter((q) => q[6] !== null), starIn = starFrames.filter((q) => Array.isArray(q[6]) && Math.abs(q[6][0]) <= 1 && Math.abs(q[6][1]) <= 1).length;
    const busOff = tr.filter((q) => !q[4] || Math.abs(q[4][0]) > 1 || q[4][1] < -1 || q[4][1] > 0.35).length;
    const row = {
      key, pull, kind: b.kind, far: b.far, loaded: b.loaded, miss: b.miss, lobs: b.lobs, frames: tr.length,
      busHi: tr.length ? Math.max(...tr.map((q) => (q[4] ? q[4][1] : 9))) : null, busOff, starFrames: starFrames.length, starIn,
      landAtImp: atImp?.[5] ?? null, liftAtImp: atImp?.[7] ?? null, liftLeast: tr.length ? Math.min(...tr.map((q) => q[7])) : null,
      draws: tr.length ? Math.max(...tr.map((q) => q[1])) : null, tris: tr.length ? Math.max(...tr.map((q) => q[2])) : null, worstMs: tr.length ? Math.max(...tr.slice(1).map((q) => q[3])) : null,
      // (its frames, for the record: [clock, draws, triangles, ms, the bus's NDC, the landing's, the star's, the view's lift, how far it looks down undipped])
      trace: tr,
    };
    R.rows.push(row);
    console.log('lobhigh:', JSON.stringify({ ...row, trace: undefined }));
    ok(row.kind === 'lob' && row.lobs === 1, `${key}: a Lob (${row.kind}${row.far ? ', far' : ''}, ${row.lobs} thrown, the body ${pull.body.toFixed(1)} and the strain ${pull.strain} in the pull, ${pull.agl} m up)`);
    ok(pull.plan?.kind === 'lob' && pull.ringK > 0.9, `${key}: its ring planned in the pull (${JSON.stringify(pull.plan)}, ring ${pull.ringK})`);
    ok(row.loaded && !row.miss, `${key}: on a loaded tile at the tap, the hit on a building or the ground (loaded ${row.loaded}, a miss ${row.miss})`);
    ok(row.frames > 10 && row.busOff === 0, `${key}: the bus on screen and at +0.35 or lower every frame (${row.busOff} of ${row.frames} not, at most ${row.busHi})`);
    // (at the ceiling the dip stays within config.shotView.swing of the sky's lift, about level, and the hit is under the frame: the design's, V5)
    if (h !== 'ceil') ok(row.starFrames > 0 && row.starIn >= 0.9 * row.starFrames, `${key}: the star on screen on 90 % of its frames (${row.starIn} of ${row.starFrames})`);
    // (where the view's limits let it, as s_lob --high has it: not with the bus at busMax, nor the dip at its swing under the lift at the tap, at its
    // most, or where it would look past pitchMax down. At Turbo 3 the bus is 300 m short of the landing at the impact, nearly over it)
    const V = { busMax: 0.3, swing: 25, most: 30, pitchMax: 85 }, liftTap = tr[0]?.[7] ?? 0, busImp = atImp?.[4]?.[1] ?? 0, downImp = atImp?.[8] ?? 0;
    const bound = atImp?.[9] === true || busImp >= V.busMax - 0.02 || row.liftAtImp <= liftTap - V.swing + 0.5 || row.liftAtImp <= -V.most + 0.5 || row.liftAtImp <= -(V.pitchMax - downImp) + 0.5;
    if (h !== 'ceil' && h <= 5000) ok(!!row.landAtImp && (row.landAtImp[1] >= -0.3 || bound), `${key}: the hit at -0.3 or higher at the impact where the view's limits let it (${JSON.stringify(row.landAtImp)}, the bus ${busImp}, the lift ${row.liftAtImp} from ${liftTap} at the tap, ${downImp} down undipped, the target held ${atImp?.[9]})`);
    ok(row.draws <= 200 && row.tris <= 1.5e6, `${key}: at most 200 draws and 1.5 M triangles (${row.draws}, ${(row.tris / 1e6).toFixed(3)} M)`);
    ok(row.worstMs !== null && row.worstMs <= 100, `${key}: no frame over 100 ms (${row.worstMs})`);
  }
  const made = (await page.evaluate(() => window.__progs)) - progs0;
  R.programs = { atReady: progs0, madeAfter: made };
  ok(made === 0, `nothing compiles: ${made} programs made after ready`);
  ok(errors === 0, `no page error (${errors})`);
  await page.close();
  res.lobhigh = R;
  console.log('lobhigh:', R.verdicts.join('\n  '));
  writeFileSync(`${out}/lobhigh.json`, JSON.stringify(R, null, 1));
  if (R.verdicts.some((v) => v.startsWith('FAIL'))) process.exitCode = 1;
}
if (modes.has('comet')) {
  // The Comet dead ahead at any speed (BUILT.md, "The Comet dead ahead"; not in the default list): "I want this shot to soar essentially directly in front
  // of me, even when I'm traveling very fast" (the producer, 2026-11-12). At Turbo 3 and Nonstop: at the gear's floor, and pinned 300 m, 1, 5 and 14 km
  // over the Western Addition heading east while the city streams (a gentle real pull of 1 s, the vista as a climb leaves it, then level), and in a 45
  // degree dive from 5 km (the stick held forward). SB_TAPS taps a pose (10), a real tap each time the belly refills. Each tap: a Comet, never the classic
  // shot; low ones (near the roofs, the page's lens) on the line, at the impact its screen x within 0.25 of the middle and the view never dipped; far ones
  // on loaded ground, at Turbo 3 at most 1 in 10 a miss on land; the star on screen on 90 % of its frames in the air; the bus on screen at +0.35 or lower.
  // At the floor the full show's drops on the lens. Every frame at most 200 draws and 1.5 M triangles, none over 100 ms; no program made after ready, no
  // page error. Exits 1 when a row fails                                                                                               -> comet.json
  const R = { rows: [], verdicts: [] };
  const ok = (c, m) => R.verdicts.push(`${c ? 'ok' : 'FAIL'}: ${m}`);
  const N = Number(process.env.SB_TAPS ?? 10);
  const progInit = () => {
    const P = WebGL2RenderingContext.prototype, cp = P.createProgram;
    window.__progs = 0;
    P.createProgram = function () { window.__progs++; return cp.call(this); };
  };
  const page = await open(Q, progInit);
  let errors = 0;
  page.on('pageerror', () => errors++);
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  await page.evaluate(() => {
    const g = window.__game, p = g.perf, orig = p.frame.bind(p), V = g.camera.position.constructor, v = new V(), s = new V();
    g.flight.glideSpeed = 0;
    g.audio.unlock();
    // (every frame while __coTrace is set: the clock, draws, triangles, the wall time since the last, the bus's NDC, the last shot's landing's, the newest
    // Comet star's in the air (null when none), the view's lift)
    const ndc = (x, y, z) => (v.set(x, y, z).applyMatrix4(g.camera.matrixWorldInverse).z >= 0 ? null : (v.set(x, y, z).project(g.camera), [+v.x.toFixed(3), +v.y.toFixed(3)]));
    let last = performance.now();
    p.frame = (dt, work) => {
      orig(dt, work);
      const now = performance.now(), ms = now - last;
      last = now;
      const tr = window.__coTrace;
      if (!tr) return;
      const f = g.flight, c = g.lastShot()?.comet, t = g.clock();
      let star = null;
      for (const q of g.cometFx.live) if (q.on && !q.lob && t >= q.t0 && t <= q.t1 && (!star || q.t0 > star.t0)) star = q;
      let st = null;
      if (star) {
        g.cometFx.at(star, Math.min(1, Math.max(0, (t - star.t0) / (star.t1 - star.t0))), s);
        st = ndc(s.x, s.y, s.z) ?? 'behind';
      }
      tr.push([+t.toFixed(3), p.calls, p.tris, +ms.toFixed(1), ndc(f.x, f.y, f.z), c ? ndc(c.x, c.y, c.z) : null, st, +g.rig.skyLift.toFixed(2)]);
    };
  });
  await runFor(page, 2);
  await H.down(1, 196, 780);
  await wall(60);
  await H.up(1);
  await runFor(page, 1);
  const progs0 = await page.evaluate(() => window.__progs);
  const poses = [];
  for (const rung of ['t3', 'nonstop']) for (const h of ['floor', 300, 1000, 5000, 14000, 'dive']) poses.push([h, rung]);
  for (const [h, rung] of poses) {
    const key = `${h === 'floor' || h === 'dive' ? h : `${h / 1000}km`}-${rung}`;
    await page.evaluate((r) => {
      const g = window.__game;
      while (g.controls.turbo.gear > 0) g.controls.turbo.shift(-1, g.flight);
      for (let i = 0; i < (r === 't3' ? 6 : 2); i++) g.controls.turbo.shift(1, g.flight);
    }, rung);
    // (pinned over the Western Addition heading east, 2 km short of Alamo Square, while the city streams in: at the gear's floor, h over the ground, the
    // dive 5.6 km. Each tap is flown from there again: at Turbo 3 the bus crosses the map in seconds. The view's lens stays as it was: only the yoke moves it)
    const place = (qa) => page.evaluate(([h, r, qa]) => {
      const g = window.__game, o = g.city.manifest.origin, k = Math.PI / 180, x = (-122.4352 - o[1]) * k * 6378137 * Math.cos(o[0] * k) - 2000, z = -(37.7763 - o[0]) * k * 6378137;
      const T = g.config.turbo, y = g.city.groundAt(x, z) + (h === 'floor' ? (r === 't3' ? T.jetAlt : T.nonstopAlt) : h === 'dive' ? 5600 : h);
      if (qa) window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
      Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: h === 'floor' ? -Infinity : y, targetY: y, vy: 0, ...(qa ? { mode: 0 } : {}) });
    }, [h, rung, qa]);
    await place(true);
    await runFor(page, 0.5);
    await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
    await page.evaluate(() => (window.__qa = null));
    await page.evaluate(() => window.__game.forceReady());
    await runFor(page, 0.3);
    if (h !== 'floor') {
      // (a gentle pull, 20 px for 1 s, as a climb there: the vista comes in; the dive's stick 60 px forward, held through its taps)
      await H.down(1, 196, 690);
      for (let i = 1; i <= (h === 'dive' ? 6 : 2); i++) {
        await wall(25);
        await H.move(1, 196, 690 + (h === 'dive' ? -10 : 10) * i);
      }
      await runFor(page, 1);
      if (h !== 'dive') {
        await H.up(1);
        await runFor(page, 1.5);
      }
    }
    const a = await page.evaluate(() => ({ drops: window.__game.cometFx.stats.drops, vista: +window.__game.rig.vista.toFixed(2) }));
    const taps = [];
    for (let i = 0; i < (h === 'dive' ? Math.min(N, 3) : N); i++) {
      if (i > 0) {
        await place(false);
        await runFor(page, 1);
      }
      // (the trace from 0.5 s before the tap: what the frame cost with no Comet in the air, for the record)
      await page.evaluate(() => (window.__coTrace = []));
      await runFor(page, 0.5);
      const at = await page.evaluate(() => { const g = window.__game, f = g.flight; return { agl: Math.round(f.y - g.city.groundAt(f.x, f.z)), nose: +((f.nose * 180) / Math.PI).toFixed(1), shots: g.cometFx.stats.fired, t: g.clock() }; });
      await H.down(2, 300, 300);
      await wall(60);
      await H.up(2);
      await runFor(page, 0.2);
      const fired = await page.evaluate((n) => window.__game.cometFx.stats.fired > n, at.shots);
      if (fired) await until(page, 'g.lastShot() && g.clock() - g.lastShot().t > g.lastShot().travel + 0.05 + g.config.shotView.hold', 6);
      const b = await page.evaluate(() => {
        const g = window.__game, l = g.lastShot(), c = l?.comet, f = g.flight, tr = window.__coTrace;
        window.__coTrace = null;
        const off = c ? Math.abs((c.x - c.x0) * f.fz - (c.z - c.z0) * f.fx) : null;
        return { t: l?.t ?? null, travel: l?.travel ?? null, kind: c?.kind ?? (c ? 'comet' : 'splat'), far: !!c?.far, loaded: !!c?.loaded, miss: !!l?.miss, reach: c ? Math.round(c.reach) : null, off: off === null ? null : +off.toFixed(1), tr };
      });
      const pre = b.tr.filter((q) => q[0] < at.t), tImp = b.t !== null ? b.t + b.travel : Infinity, tr = b.tr.filter((q) => q[0] >= at.t && q[0] <= tImp + 0.6 + 1e-6);
      const atImp = tr.find((q) => q[0] >= tImp - 1e-6) ?? null;
      const starFrames = tr.filter((q) => q[6] !== null), starIn = starFrames.filter((q) => Array.isArray(q[6]) && Math.abs(q[6][0]) <= 1 && Math.abs(q[6][1]) <= 1).length;
      taps.push({
        at, fired, kind: b.kind, far: b.far, loaded: b.loaded, miss: b.miss, reach: b.reach, off: b.off, frames: tr.length,
        busOff: tr.filter((q) => !q[4] || Math.abs(q[4][0]) > 1 || q[4][1] < -1 || q[4][1] > 0.35).length, starFrames: starFrames.length, starIn,
        landAtImp: atImp?.[5] ?? null, liftLeast: tr.length ? Math.min(...tr.map((q) => q[7])) : null,
        draws: tr.length ? Math.max(...tr.map((q) => q[1])) : null, tris: tr.length ? Math.max(...tr.map((q) => q[2])) : null, worstMs: tr.length > 1 ? Math.max(...tr.slice(1).map((q) => q[3])) : null,
        drawsBefore: pre.length ? Math.max(...pre.map((q) => q[1])) : null, trisBefore: pre.length ? Math.max(...pre.map((q) => q[2])) : null,
      });
      // (at the floor the bus flies on through its pillar, 1.3-1.8 s after the impact, before it's flown from the start again: the full show's drops)
      if (h === 'floor') await runFor(page, 1.5);
    }
    if (h === 'dive') await H.up(1);
    const drops = (await page.evaluate(() => window.__game.cometFx.stats.drops)) - a.drops;
    const row = { key, vista: a.vista, drops, taps };
    R.rows.push(row);
    console.log('comet:', JSON.stringify({ key, vista: a.vista, drops, taps: taps.map((q) => [q.at.agl, q.kind, q.far, q.reach, q.off, q.landAtImp, q.starIn, q.starFrames, q.liftLeast]) }));
    const comets = taps.filter((q) => q.kind === 'comet'), low = comets.filter((q) => !q.far), far = comets.filter((q) => q.far);
    ok(taps.every((q) => q.fired && q.kind === 'comet'), `${key}: a Comet each tap, never the classic shot (${taps.map((q) => (q.fired ? q.kind + (q.far ? ' far' : '') : 'none')).join(', ')})`);
    if (h === 'floor' || h === 300) console.log(`comet: ${key}: ${low.length} low and ${far.length} far on the page's lens (vista ${a.vista})`);
    if (h === 'floor') ok(far.length === 0, `${key}: at the floor every Comet a low one (${far.length} far)`);
    ok(low.every((q) => q.liftLeast >= -0.01), `${key}: a low one never dips the view (least lift ${Math.min(0, ...low.map((q) => q.liftLeast))})`);
    ok(low.every((q) => q.landAtImp && Math.abs(q.landAtImp[0]) <= 0.5), `${key}: a low one's screen x within 0.25 of the middle at the impact (${low.map((q) => q.landAtImp?.[0]).join(', ')})`);
    ok(far.every((q) => q.loaded), `${key}: a far one on loaded ground at the tap (${far.filter((q) => !q.loaded).length} not)`);
    if (rung === 't3') ok(far.filter((q) => q.miss).length <= Math.max(1, Math.floor(far.length / 10)), `${key}: at Turbo 3 at most 1 in 10 far ones a miss on land (${far.filter((q) => q.miss).length} of ${far.length})`);
    const sf = comets.reduce((n, q) => n + q.starFrames, 0), si = comets.reduce((n, q) => n + q.starIn, 0);
    ok(sf > 0 && si >= 0.9 * sf, `${key}: the star on screen on 90 % of its frames (${si} of ${sf})`);
    ok(taps.every((q) => q.busOff === 0), `${key}: the bus on screen and at +0.35 or lower every frame (${taps.map((q) => q.busOff).join(', ')} not)`);
    if (h === 'floor') ok(drops > 0, `${key}: the full show's drops on the lens (${drops})`);
    ok(taps.every((q) => q.draws === null || (q.draws <= 200 && q.tris <= 1.5e6)), `${key}: at most 200 draws and 1.5 M triangles (${Math.max(...taps.map((q) => q.draws ?? 0))}, ${(Math.max(...taps.map((q) => q.tris ?? 0)) / 1e6).toFixed(3)} M; in the 0.5 s before the taps ${Math.max(...taps.map((q) => q.drawsBefore ?? 0))}, ${(Math.max(...taps.map((q) => q.trisBefore ?? 0)) / 1e6).toFixed(3)} M)`);
    ok(taps.every((q) => q.worstMs === null || q.worstMs <= 100), `${key}: no frame over 100 ms (${Math.max(...taps.map((q) => q.worstMs ?? 0))})`);
  }
  const made = (await page.evaluate(() => window.__progs)) - progs0;
  R.programs = { atReady: progs0, madeAfter: made };
  ok(made === 0, `nothing compiles: ${made} programs made after ready`);
  ok(errors === 0, `no page error (${errors})`);
  await page.close();
  res.comet = R;
  console.log('comet:', R.verdicts.join('\n  '));
  writeFileSync(`${out}/comet.json`, JSON.stringify(R, null, 1));
  if (R.verdicts.some((v) => v.startsWith('FAIL'))) process.exitCode = 1;
}

if (modes.has('chain')) {
  // A far shot's dip, chained (BUILT.md, "The Comet dead ahead"; not in the default list): Nonstop level 5 km over the Western Addition heading east, a
  // real tap each time the belly refills for 20 s of the game's clock; then a far Comet and, while it flies, a look by a touch at the top middle of the
  // screen; then a far Comet and, while it flies, the steering thumb drawn to a side in the lane under the bus; then a far Comet and a second tap 0.3 s
  // after it (the belly isn't full again: no shot, as any tap's), and one more as soon as it is. Every frame from the first tap: the bus on screen and at
  // +0.35 or lower (NDC, the dip's limit); the share of frames dipped is printed. The look's touch is a look (Input's look) and the view's lift is back
  // within 0.02 of 0 within 1.5 s of it; the steering touch is no look and turns the bus; no program made after ready, no page error. Exits 1 when a
  // row fails                                                                                                                          -> chain.json
  const R = { rows: [], verdicts: [] };
  const ok = (c, m) => R.verdicts.push(`${c ? 'ok' : 'FAIL'}: ${m}`);
  const progInit = () => {
    const P = WebGL2RenderingContext.prototype, cp = P.createProgram;
    window.__progs = 0;
    P.createProgram = function () { window.__progs++; return cp.call(this); };
  };
  const page = await open(Q, progInit);
  let errors = 0;
  page.on('pageerror', () => errors++);
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  await page.evaluate(() => {
    const g = window.__game, p = g.perf, orig = p.frame.bind(p), V = g.camera.position.constructor, v = new V();
    g.flight.glideSpeed = 0;
    g.audio.unlock();
    // (every frame while __chTrace is set: the clock, the bus's NDC, the view's lift, a look held, a finger flying, the heading (deg), far shots in the air)
    const ndc = (x, y, z) => (v.set(x, y, z).applyMatrix4(g.camera.matrixWorldInverse).z >= 0 ? null : (v.set(x, y, z).project(g.camera), [+v.x.toFixed(3), +v.y.toFixed(3)]));
    p.frame = (dt, work) => {
      orig(dt, work);
      const tr = window.__chTrace;
      if (!tr) return;
      const f = g.flight, t = g.clock(), st = g.input.state;
      const farUp = g.cometFx.live.filter((q) => q.on && q.far && t >= q.t0 && t <= q.t1).length;
      tr.push([+t.toFixed(3), ndc(f.x, f.y, f.z), +g.rig.skyLift.toFixed(3), st.look.on, st.dragging, +((f.heading * 180) / Math.PI).toFixed(2), farUp]);
    };
  });
  await runFor(page, 2);
  await H.down(1, 196, 780);
  await wall(60);
  await H.up(1);
  await runFor(page, 1);
  const progs0 = await page.evaluate(() => window.__progs);
  await page.evaluate(() => {
    const g = window.__game;
    while (g.controls.turbo.gear > 0) g.controls.turbo.shift(-1, g.flight);
    for (let i = 0; i < 2; i++) g.controls.turbo.shift(1, g.flight);
  });
  // (pinned 5 km over the Western Addition heading east, 2 km short of Alamo Square, while the city streams in; a gentle pull of 1 s, as a climb there: the
  // vista comes in; then level, flown on from there through the whole row: at Nonstop 20 s is about 4.5 km)
  // (each part flown from there again: past 20 s at Nonstop the bus is over the bay, where nothing is loaded ahead and a tap is the classic shot)
  const place = async (qa) => {
    await page.evaluate((qa) => {
      const g = window.__game, o = g.city.manifest.origin, k = Math.PI / 180, x = (-122.4352 - o[1]) * k * 6378137 * Math.cos(o[0] * k) - 2000, z = -(37.7763 - o[0]) * k * 6378137;
      const y = g.city.groundAt(x, z) + 5000;
      // (pinned while the city streams: run on unpinned, the bus flew 23 s on to the map's east edge while it did)
      window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
      Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: y, targetY: y, vy: 0, ...(qa ? { mode: 0 } : {}) });
    }, qa);
    await runFor(page, 0.5);
    await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
    await page.evaluate(() => (window.__qa = null));
  };
  await place(true);
  await page.evaluate(() => window.__game.forceReady());
  await runFor(page, 0.3);
  await H.down(1, 196, 690);
  for (let i = 1; i <= 2; i++) {
    await wall(25);
    await H.move(1, 196, 690 + 10 * i);
  }
  await runFor(page, 1);
  await H.up(1);
  await runFor(page, 1.5);
  const fired = () => page.evaluate(() => window.__game.cometFx.stats.fired);
  // (each tap's: the belly before it, and the last shot after it, for the record)
  const tapLog = [];
  const tap = async () => {
    const n = await fired(), pre = await page.evaluate(() => { const g = window.__game, f = g.flight; const c = g.cometState(); return { t: +g.clock().toFixed(2), full: +f.fullness.toFixed(2), barfT: +f.barfT.toFixed(2), agl: Math.round(f.y - g.city.groundAt(f.x, f.z)), look: g.input.state.look.on, gear: c.gear, speed: Math.round(c.speed), plan: c.plan ? { far: !!c.plan.far, x: Math.round(c.plan.x - f.x), z: Math.round(c.plan.z - f.z) } : null, heading: +((f.heading * 180) / Math.PI).toFixed(1), x: Math.round(f.x), z: Math.round(f.z) }; });
    await H.down(2, 300, 300);
    await wall(60);
    await H.up(2);
    await runFor(page, 0.1);
    const ok = (await fired()) > n;
    tapLog.push({ ...pre, fired: ok, shot: await page.evaluate(() => { const l = window.__game.lastShot(); return l ? { t: +l.t.toFixed(2), comet: !!l.comet, far: !!l.comet?.far, kind: l.comet?.kind ?? null } : null; }) });
    return ok;
  };
  const full = () => until(page, 'g.flight.fullness >= 1 && g.flight.barfT < 0', 4);
  const far = () => page.evaluate(() => !!window.__game.lastShot()?.comet?.far);
  // 1. a tap each time the belly refills, 20 s
  await page.evaluate(() => (window.__chTrace = []));
  const t0 = await page.evaluate(() => window.__game.clock());
  const chain = [];
  while ((await page.evaluate(() => window.__game.clock())) - t0 < 20) {
    await full();
    if ((await page.evaluate(() => window.__game.clock())) - t0 >= 20) break;
    const f = await tap();
    chain.push({ fired: f, far: f && (await far()) });
  }
  await runFor(page, 2.5);
  const tr1 = await page.evaluate(() => { const t = window.__chTrace; window.__chTrace = []; return t; });
  const dipped = tr1.filter((q) => q[2] < -0.02).length, busOff1 = tr1.filter((q) => !q[1] || Math.abs(q[1][0]) > 1 || q[1][1] < -1 || q[1][1] > 0.35).length;
  R.rows.push({ key: 'chain', taps: chain.length, fired: chain.filter((q) => q.fired).length, far: chain.filter((q) => q.far).length, frames: tr1.length, dipped, busOff: busOff1, busHi: Math.max(...tr1.map((q) => (q[1] ? q[1][1] : 9))), liftLeast: Math.min(...tr1.map((q) => q[2])) });
  console.log('chain:', JSON.stringify(R.rows.at(-1)));
  console.log(`chain: a tap each refill for 20 s at Nonstop from 5 km: ${dipped} of ${tr1.length} frames dipped (${((100 * dipped) / Math.max(1, tr1.length)).toFixed(0)} %)`);
  ok(chain.length >= 5 && chain.every((q) => q.fired && q.far), `chain: a far Comet each refill (${chain.filter((q) => q.far).length} far of ${chain.filter((q) => q.fired).length} fired, ${chain.length} taps)`);
  ok(tr1.length > 100 && busOff1 === 0, `chain: the bus on screen and at +0.35 or lower every frame (${busOff1} of ${tr1.length} not, at most ${R.rows.at(-1).busHi})`);
  await place(false);
  await runFor(page, 1.5);
  await page.evaluate(() => (window.__chTrace = []));
  // 2. a far Comet, and 0.3 s on, while it flies and the view dips, a look: a touch at the top middle, drawn 30 px aside, held 0.4 s
  await full();
  const lookShot = await tap();
  await runFor(page, 0.2);
  const tl = await page.evaluate(() => window.__game.clock());
  // (a look is a drag that stays down past Input's lookDelayMs, its steps the moves that come after it: drawn 4 px each 25 ms for 0.4 s)
  await H.down(3, 196, 70);
  for (let i = 1; i <= 16; i++) {
    await wall(25);
    await H.move(3, 196 + 4 * i, 70);
  }
  const tu = await page.evaluate(() => window.__game.clock());
  await H.up(3);
  await runFor(page, 2.5);
  const tr2 = await page.evaluate(() => { const t = window.__chTrace; window.__chTrace = []; return t; });
  const during = tr2.filter((q) => q[0] >= tl && q[0] <= tu), dipAtLook = during.length ? Math.min(...during.map((q) => q[2])) : null;
  // (from the first frame Input says it's a look: lookDelayMs, and the moves after it, are the gesture's)
  const tLook = tr2.find((q) => q[0] >= tl && q[3])?.[0] ?? null, back = tLook === null ? null : tr2.find((q) => q[0] >= tLook && q[2] >= -0.02 && tr2.filter((r) => r[0] >= q[0] && r[0] <= tLook + 1.5).every((r) => r[2] >= -0.02));
  const busOff2 = tr2.filter((q) => !q[1] || Math.abs(q[1][0]) > 1 || q[1][1] < -1 || q[1][1] > 0.35).length;
  R.rows.push({ key: 'look', trace: tr2.map((q) => [q[0], q[2], q[3] ? 1 : 0]), fired: lookShot, looked: during.some((q) => q[3]), flew: during.some((q) => q[4]), dipAtLook, backAfter: back ? +(back[0] - tLook).toFixed(2) : null, busOff: busOff2 });
  console.log('chain:', JSON.stringify({ ...R.rows.at(-1), trace: undefined }));
  ok(lookShot && dipAtLook !== null && dipAtLook < -0.02, `look: a far Comet dipping the view as the look lands (fired ${lookShot}, the lift ${dipAtLook})`);
  ok(R.rows.at(-1).looked && !R.rows.at(-1).flew, `look: the touch at the top middle is a look, not a flight (look ${R.rows.at(-1).looked}, flying ${R.rows.at(-1).flew})`);
  ok(back && back[0] - tLook <= 1.5, `look: the view's lift back within 0.02 of 0 within 1.5 s of the look (${R.rows.at(-1).backAfter} s)`);
  ok(busOff2 === 0, `look: the bus on screen and at +0.35 or lower every frame (${busOff2} not)`);
  await place(false);
  await runFor(page, 1.5);
  await page.evaluate(() => (window.__chTrace = []));
  // 3. a far Comet, and 0.3 s on, while the view dips, the steering thumb in the lane under the bus, drawn 80 px right and held 1.2 s
  await full();
  const steerShot = await tap();
  await runFor(page, 0.2);
  const ts = await page.evaluate(() => window.__game.clock());
  await H.down(1, 196, 690);
  for (let i = 1; i <= 8; i++) {
    await wall(25);
    await H.move(1, 196 + 10 * i, 690);
  }
  await runFor(page, 1.2);
  const tsu = await page.evaluate(() => window.__game.clock());
  await H.up(1);
  await runFor(page, 2.5);
  const tr3 = await page.evaluate(() => { const t = window.__chTrace; window.__chTrace = []; return t; });
  const held = tr3.filter((q) => q[0] >= ts && q[0] <= tsu), h0 = held[0]?.[5] ?? 0, turned = held.length ? Math.max(...held.map((q) => Math.abs(((q[5] - h0 + 540) % 360) - 180))) : 0;
  const busOff3 = tr3.filter((q) => !q[1] || Math.abs(q[1][0]) > 1 || q[1][1] < -1 || q[1][1] > 0.35).length;
  R.rows.push({ key: 'steer', fired: steerShot, dipped: held.some((q) => q[2] < -0.02), flew: held.some((q) => q[4]), looked: held.some((q) => q[3]), turned: +turned.toFixed(2), busOff: busOff3 });
  console.log('chain:', JSON.stringify(R.rows.at(-1)));
  ok(steerShot && R.rows.at(-1).dipped, `steer: a far Comet dipping the view as the thumb lands (fired ${steerShot}, dipped ${R.rows.at(-1).dipped})`);
  ok(R.rows.at(-1).flew && !R.rows.at(-1).looked && turned >= 2, `steer: the thumb in the lane flies, no look, and turns the bus (flying ${R.rows.at(-1).flew}, look ${R.rows.at(-1).looked}, turned ${R.rows.at(-1).turned} deg)`);
  ok(busOff3 === 0, `steer: the bus on screen and at +0.35 or lower every frame (${busOff3} not)`);
  await place(false);
  await runFor(page, 1.5);
  await page.evaluate(() => (window.__chTrace = []));
  // 4. a far Comet and a tap 0.3 s after it (the belly not full: no shot), and one as soon as it is: both far ones' dips, one after the other
  await full();
  const a1 = await tap();
  await runFor(page, 0.2);
  const a2 = await tap();
  await full();
  const a3 = await tap();
  await runFor(page, 3);
  const tr4 = await page.evaluate(() => { const t = window.__chTrace; window.__chTrace = null; return t; });
  const busOff4 = tr4.filter((q) => !q[1] || Math.abs(q[1][0]) > 1 || q[1][1] < -1 || q[1][1] > 0.35).length;
  R.rows.push({ key: 'two', first: a1, at03: a2, next: a3, together: Math.max(0, ...tr4.map((q) => q[6])), busOff: busOff4, liftLeast: Math.min(...tr4.map((q) => q[2])) });
  console.log('chain:', JSON.stringify(R.rows.at(-1)));
  ok(a1 && !a2 && a3, `two: the first fires, the tap 0.3 s on finds the belly not full (no shot), the next fires when it is (${a1}, ${a2}, ${a3})`);
  ok(busOff4 === 0, `two: the bus on screen and at +0.35 or lower every frame (${busOff4} not; far ones in the air together at most ${R.rows.at(-1).together})`);
  const made = (await page.evaluate(() => window.__progs)) - progs0;
  R.programs = { atReady: progs0, madeAfter: made };
  R.taps = tapLog;
  console.log('chain: taps', JSON.stringify(tapLog));
  ok(made === 0, `nothing compiles: ${made} programs made after ready`);
  ok(errors === 0, `no page error (${errors})`);
  await page.close();
  res.chain = R;
  console.log('chain:', R.verdicts.join('\n  '));
  writeFileSync(`${out}/chain.json`, JSON.stringify(R, null, 1));
  if (R.verdicts.some((v) => v.startsWith('FAIL'))) process.exitCode = 1;
}

if (modes.has('swervefar')) {
  // ?swerve's long swipe and a rival's shell under a far shot (the header's swervefar): what the far shots' review's F2 and F5 asked, flown on the page
  const R = { rows: [], verdicts: [], places: [] };
  const ok = (c, m) => R.verdicts.push(`${c ? 'ok' : 'FAIL'}: ${m}`);
  const progInit = () => {
    const P = WebGL2RenderingContext.prototype, cp = P.createProgram;
    window.__progs = 0;
    P.createProgram = function () { window.__progs++; return cp.call(this); };
  };
  const page = await open(Q + '&swerve', progInit);
  let errors = 0;
  page.on('pageerror', () => errors++);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts, timestamp) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id = 1]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })), ...(timestamp !== undefined ? { timestamp } : {}) });
  await wall(1300);
  await page.evaluate(() => {
    const g = window.__game, p = g.perf, orig = p.frame.bind(p), V = g.camera.position.constructor, v = new V();
    g.flight.glideSpeed = 0;
    g.audio.unlock();
    // (every frame while __sfTrace is set: the clock, the view's lift, a look held, the look's swipe, the gear, the last shot's landing's NDC)
    const ndc = (x, y, z) => (v.set(x, y, z).applyMatrix4(g.camera.matrixWorldInverse).z >= 0 ? null : (v.set(x, y, z).project(g.camera), [+v.x.toFixed(3), +v.y.toFixed(3)]));
    p.frame = (dt, work) => {
      orig(dt, work);
      const tr = window.__sfTrace;
      if (!tr) return;
      const st = g.input.state, l = g.lastShot(), t = g.controls.turbo;
      tr.push([+g.clock().toFixed(3), +g.rig.skyLift.toFixed(3), st.look.on, !!st.look.swipe, t.gear + t.level, l ? ndc(l.aim[0], l.aim[1], l.aim[2]) : null]);
    };
  });
  await runFor(page, 2);
  const progs0 = await page.evaluate(() => window.__progs);
  const hasRivals = await page.evaluate(() => !!window.__rivals);
  // (5 km over the Western Addition heading east, pinned while the city streams in, `up` gears over Cruise (2 Nonstop, 3 Jet), no rival out: chain's place)
  const place = async (up = 2) => {
    await page.evaluate((up) => {
      const g = window.__game, o = g.city.manifest.origin, k = Math.PI / 180, x = (-122.4352 - o[1]) * k * 6378137 * Math.cos(o[0] * k) - 2000, z = -(37.7763 - o[0]) * k * 6378137;
      const y = g.city.groundAt(x, z) + 5000;
      window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
      Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: y, targetY: y, vy: 0, mode: 0 });
      while (g.controls.turbo.gear > 0) g.controls.turbo.shift(-1, g.flight);
      for (let i = 0; i < up; i++) g.controls.turbo.shift(1, g.flight);
      if (window.__rivals) for (const r of window.__rivals.sim.list) r.live = false;
    }, up);
    await runFor(page, 0.5);
    // (the city in, or said so after 40 s: the row goes on, and its checks say what came of it. The place after the swipe waits its 40 s: the swaps to
    // finer detail asked for at Cruise wait to be taken while a gear past the surge holds the level of detail (Controls.tearing, City.detailHold), as
    // they should. Once the city has been in, only the tools read City.loading)
    const t0 = Date.now(), loaded = await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 40000, polling: 100 }).then(() => true, () => false);
    // (and what held City.loading: tiles pending, arrivals to adopt by kind, with the level of detail held (a gear that drives the bus: a swap waits for
    // the hold to end), the far field's blocks)
    const why = await page.evaluate(() => {
      const c = window.__game.city, kinds = {};
      for (const a of c.adopt) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
      return { clock: +window.__game.clock().toFixed(2), pending: c.pending.size, adopt: kinds, hold: c.detailHold, farBusy: c.farBusy, farLanding: c.farLanding.length };
    });
    R.places.push({ loaded, waited: Math.round((Date.now() - t0) / 1000), ...why });
    await page.evaluate(() => ((window.__qa = null), window.__game.forceReady()));
    await runFor(page, 1);
    await until(page, 'g.flight.fullness >= 1 && g.flight.barfT < 0', 4);
  };
  const fired = () => page.evaluate(() => window.__game.cometFx.stats.fired);
  const tap = async () => {
    const t0 = Date.now() / 1000;
    await touch('touchStart', [[300, 300, 6]], t0);
    await wall(60);
    await touch('touchEnd', [], t0 + 0.06);
  };
  const lastFar = () => page.evaluate(() => { const l = window.__game.lastShot(); return l ? { t: +l.t.toFixed(3), travel: +l.travel.toFixed(3), far: !!l.comet?.far } : null; });
  const inFrame = (n) => !!n && Math.abs(n[0]) < 1 && n[1] > -1 && n[1] < 1;
  // ---- A0 and A1. a far Comet and no touch after it, at Nonstop for the record and at Jet as the swipe's measure: the lift and the landing's NDC at its hit.
  // (from 5 km the hit lands under the frame at both, the view dipped about 10 degrees: the bus held no higher than 35 % down the screen,
  // config.shotView.busMax, wins over the landing. So the swipe's row can't ask for the hit in the frame: it asks for the dip, and the landing as near it)
  const alone = async (up) => {
    await place(up);
    await page.evaluate(() => (window.__sfTrace = []));
    await tap();
    await runFor(page, 0.4);
    const shot = await lastFar();
    if (shot) await until(page, `g.clock() > ${shot.t + shot.travel + 0.3}`, 8);
    const tr = await page.evaluate(() => { const t = window.__sfTrace; window.__sfTrace = null; return t; });
    const f = shot ? tr.find((q) => q[0] >= shot.t + shot.travel) ?? null : null;
    R.rows.push({ key: up === 3 ? 'alone-jet' : 'alone', shot, hit: f ? { lift: f[1], ndc: f[5], gear: f[4] } : null });
    console.log('swervefar:', JSON.stringify(R.rows.at(-1)));
    return R.rows.at(-1);
  };
  await alone(2);
  const a1 = await alone(3);
  ok(!!a1.shot?.far && a1.hit?.gear === 3 && a1.hit.lift < -1 && !!a1.hit.ndc, `alone: at Jet with no touch the view dipped at the far Comet's hit (far ${a1.shot?.far ?? null}, gear ${a1.hit?.gear ?? null}, the lift ${a1.hit?.lift ?? null}, NDC ${JSON.stringify(a1.hit?.ndc ?? null)}${inFrame(a1.hit?.ndc) ? ', in the frame' : ', under the frame'})`);
  // ---- A. a far Comet at Jet, and as soon as the tap is up, the long swipe: it answers well before the hit, as a thumb's does (F2's sim: the swipe at
  // 0.6 s, the hit at 1.5 s), so the hit is seen with no look on
  await place(3);
  const planA = await page.evaluate(() => !!window.__game.cometState().plan?.far);
  await page.evaluate(() => (window.__sfTrace = []));
  const n0 = await fired();
  await tap();
  const tSwipe = await page.evaluate(() => window.__game.clock());
  {
    // (a quick stroke from 110 px down the glass, off the lane: 5 moves of 80 px stamped 30 ms apart, each sent once the last is taken, with no wait between,
    // so each comes in its own frame and the stroke is a look for its first frames, the frames a let-go dip goes on. The warm row's 8 awaited moves 25 ms
    // apart took 1.45 s of the laptop's frames here, and the swipe answered after the hit)
    const t0 = Date.now() / 1000 - 0.05, x = 330, ya = 110;
    await touch('touchStart', [[x, ya, 5]], t0);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [[x, ya + i * 80, 5]], t0 + i * 0.03);
    await touch('touchEnd', [], t0 + 0.18);
  }
  const tLift = await page.evaluate(() => window.__game.clock());
  const shotA = await lastFar();
  const firedA = (await fired()) > n0;
  if (shotA) await until(page, `g.clock() > ${shotA.t + shotA.travel + 0.3}`, 8);
  const trA = await page.evaluate(() => { const t = window.__sfTrace; window.__sfTrace = null; return t; });
  const hitAt = shotA ? shotA.t + shotA.travel : Infinity, hitF = trA.find((q) => q[0] >= hitAt) ?? null;
  // (the dip under the stroke: its deepest from the landing to the lift, the swipe made with the tap; Cruise from its landing to its lift; its frames of look
  // while it may still be a swipe)
  const stroke = trA.filter((q) => q[0] >= tSwipe && q[0] <= tLift), before = stroke.length ? stroke.reduce((a, q) => (q[1] < a[1] ? q : a)) : null;
  const cruise = trA.find((q) => q[0] >= tSwipe && q[4] === 0) ?? null, gearA = stroke[0]?.[4] ?? null;
  R.rows.push({ key: 'swipe', plan: planA, fired: firedA, shot: shotA, gear: gearA, tSwipe: +tSwipe.toFixed(3), tLift: +tLift.toFixed(3), cruiseAt: cruise?.[0] ?? null, hitAt: +hitAt.toFixed(3), liftUnder: before?.[1] ?? null, liftAtHit: hitF?.[1] ?? null, lookAtHit: hitF?.[2] ?? null, hitNdc: hitF?.[5] ?? null, looks: stroke.filter((q) => q[2]).length, swipeLooks: stroke.filter((q) => q[2] && q[3]).length, trace: trA });
  console.log('swervefar:', JSON.stringify({ ...R.rows.at(-1), trace: undefined }));
  const sw = R.rows.at(-1);
  ok(planA && firedA && shotA?.far && gearA === 3, `swipe: a far Comet from 5 km at Jet by a real tap (planned far ${planA}, fired ${firedA}, far ${shotA?.far}, gear ${gearA})`);
  ok(sw.swipeLooks >= 1, `swipe: the stroke was a look while it might still be the swipe, the frames a let-go dip goes on (${sw.swipeLooks} frames)`);
  ok(!!cruise && cruise[0] <= tLift && cruise[0] <= hitAt - 0.3, `swipe: the long swipe answered under the thumb, Cruise, 0.3 s or more before the hit (at ${cruise?.[0] ?? null}, its landing at ${+tSwipe.toFixed(2)}, its lift at ${+tLift.toFixed(2)}, the hit at ${+hitAt.toFixed(2)})`);
  // (held, the lift at the hit is as deep as with no touch: F2's sim had the brake alone at 108 % of it, the dip let go at 1 %. Half of it is the line)
  ok(!!before && before[1] < -0.5 && !!hitF && a1.hit?.lift < -1 && hitF[1] <= 0.5 * a1.hit.lift, `swipe: the dip held through it to the hit, at least half of no touch's (the lift ${before?.[1] ?? null} at its deepest under the stroke, ${hitF?.[1] ?? null} at the hit; with no touch ${a1.hit?.lift ?? null})`);
  // (and the landing as near the frame as with no touch: in it if no touch's was, else no more than 0.25 of the half height lower. Ten degrees of dip let
  // go put it about 0.6 lower from 5 km, the portrait lens about 25 degrees over and under its middle)
  const nearAlone = !!hitF?.[5] && !!a1.hit?.ndc && (inFrame(a1.hit.ndc) ? inFrame(hitF[5]) : Math.abs(hitF[5][0]) < 1 && hitF[5][1] >= a1.hit.ndc[1] - 0.25);
  ok(!!hitF && hitF[2] === false && nearAlone, `swipe: at the hit no look on, and the landing no further under the frame than with no touch (look ${hitF?.[2] ?? null}, its landing's NDC ${JSON.stringify(hitF?.[5] ?? null)}, with no touch ${JSON.stringify(a1.hit?.ndc ?? null)}${inFrame(hitF?.[5]) ? ', in the frame' : ', under the frame'})`);
  // ---- B. a rival under the nose, out of the shell's reach, and a real tap
  if (hasRivals) {
    await place();
    const put = await page.evaluate(() => {
      const g = window.__game, f = g.flight, Rv = window.__rivals, S = Rv.sim, r = S.list[0];
      const fx = Math.sin(f.heading), fz = -Math.cos(f.heading), x = f.x + fx * 300, z = f.z + fz * 300, y = g.city.obstacleAt(x, z) + 150;
      for (const o of S.list) o.live = o === r;
      Object.assign(r, { live: true, x, z, y, heading: f.heading, speed: f.ground, state: 0, act: 1, tripGear: 0, tx: x + fx * 1e7, tz: z + fz * 1e7, grudge: false, oneShot: false, bold: 0.9, ramIn: 0, skidLeft: 0, slip: 0, lift: 0, mischiefIn: 1e9 });
      r.px = r.x;
      r.pz = r.z;
      r.py = r.y;
      Object.assign(Rv.tune, { weave: 0, dodge: 0 });
      Rv.tune.speeds[0] = f.ground;
      S.hunter = null;
      return { id: r.id, gap: Math.round(f.y - y) };
    });
    await runFor(page, 0.3);
    const pre = await page.evaluate((id) => {
      const g = window.__game, f = g.flight, Rv = window.__rivals, r = Rv.sim.list.find((q) => q.id === id);
      return { pick: Rv.pick?.id ?? null, plan: !!g.cometState().plan?.far, full: +f.fullness.toFixed(2), ahead: Math.round(Math.hypot(r.x - f.x, r.z - f.z)), slant: Math.round(Math.hypot(r.x - f.x, r.y - f.y, r.z - f.z)), shells: Rv.counts.shell ?? 0 };
    }, put.id);
    const n1 = await fired();
    await tap();
    await runFor(page, 0.3);
    const post = await page.evaluate(() => { const l = window.__game.lastShot(); return { shells: window.__rivals.counts.shell ?? 0, far: !!l?.comet?.far }; });
    const firedB = (await fired()) > n1;
    R.rows.push({ key: 'shell', put, pre, fired: firedB, post });
    console.log('swervefar:', JSON.stringify(R.rows.at(-1)));
    ok(pre.pick === put.id && pre.plan, `shell: the rival under the nose is the tap's pick by its flat reach, and a far shot is planned (pick ${pre.pick}, put ${put.id}; ${pre.ahead} m ahead, ${pre.slant} m slant; far ${pre.plan})`);
    ok(firedB && post.far && post.shells === pre.shells, `shell: the tap fired the far shot, no shell (fired ${firedB}, far ${post.far}, shells ${pre.shells} to ${post.shells})`);
  } else ok(false, 'shell: no rivals on the page (?swerve has them)');
  const made = (await page.evaluate(() => window.__progs)) - progs0;
  R.programs = { atReady: progs0, madeAfter: made };
  ok(made === 0, `nothing compiles: ${made} programs made after ready`);
  ok(errors === 0, `no page error (${errors})`);
  await page.close();
  res.swervefar = R;
  console.log('swervefar:', R.verdicts.join('\n  '));
  writeFileSync(`${out}/swervefar.json`, JSON.stringify(R, null, 1));
  if (R.verdicts.some((v) => v.startsWith('FAIL'))) process.exitCode = 1;
}

if (modes.has('dipcost')) {
  // What a far shot's dip costs (BUILT.md, "The review, and what it came to"; not in the default list): placed 2, 5 and 14 km over the Western Addition
  // heading east, at Turbo 3 and Nonstop, the city streamed in and the lens as a climb leaves it (CameraRig.settleAt), then the view held dipped 0 to 30
  // degrees (the rig's skyDipMost and its lift's target, as main.ts sets them after a far shot): 0.6 s pinned, then 1 s flying on in the gear, the city
  // streaming. Prints each one's most draws and triangles, and what draws them at its end: the meshes in the frustum by kind. Gates nothing but the
  // page: exits 1 on a page error                                                                                                        -> dipcost.json
  const R = { rows: [] };
  const page = await open(Q);
  let errors = 0;
  page.on('pageerror', () => errors++);
  await wall(1300);
  await page.evaluate(() => {
    const g = window.__game, p = g.perf, orig = p.frame.bind(p), rig = g.rig, up = rig.update.bind(rig);
    g.flight.glideSpeed = 0;
    p.frame = (dt, work) => {
      orig(dt, work);
      if (window.__dcTrace) window.__dcTrace.push([p.calls, p.tris]);
    };
    // (the dip held as main.ts holds it after a far shot, set just before the rig steps: main.ts lets it go each frame no far shot is up)
    rig.update = (...a) => {
      const d = window.__dcDip;
      if (d != null) Object.assign(rig, { skyDipMost: d, skyLiftTarget: -d, skyLiftRate: 50 });
      return up(...a);
    };
    // (what draws: each visible mesh whose bounding sphere is in the frustum and on the camera's layers, by kind; one pass's worth)
    window.__dcWhat = () => {
      const cam = g.camera, city = g.city, a = cam.projectionMatrix.elements, b = cam.matrixWorldInverse.elements, M = new Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) M[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
      const row = (r) => [M[r], M[4 + r], M[8 + r], M[12 + r]];
      const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
      const planes = [[1, r0], [-1, r0], [1, r1], [-1, r1], [1, r2], [-1, r2]].map(([s, r]) => {
        const q = [r3[0] + s * r[0], r3[1] + s * r[1], r3[2] + s * r[2], r3[3] + s * r[3]], n = Math.hypot(q[0], q[1], q[2]);
        return q.map((v) => v / n);
      });
      const by = {};
      for (const top of g.scene.children)
        top.traverseVisible((o) => {
          if ((!o.isMesh && !o.isLine && !o.isPoints) || !o.geometry || !(o.layers.mask & cam.layers.mask)) return;
          const gm = o.geometry;
          if (o.frustumCulled !== false) {
            if (!gm.boundingSphere) gm.computeBoundingSphere();
            const c = gm.boundingSphere.center.clone().applyMatrix4(o.matrixWorld), rad = gm.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
            if (planes.some((p) => p[0] * c.x + p[1] * c.y + p[2] * c.z + p[3] < -rad)) return;
          }
          const kind = o.parent === city.farGroup ? 'far' : o.parent === city.root ? (gm.attributes.aBld ? 'buildings' : 'ground') : top.name || top.type;
          const idx = gm.index ? gm.index.count : gm.attributes.position?.count ?? 0, n = o.isInstancedMesh ? o.count : 1;
          const e = (by[kind] ??= [0, 0]);
          e[0]++;
          e[1] += Math.round((idx / 3) * n);
        });
      return by;
    };
  });
  for (const rung of ['t3', 'nonstop'])
    for (const h of [2000, 5000, 14000]) {
      await page.evaluate((r) => {
        const g = window.__game;
        while (g.controls.turbo.gear > 0) g.controls.turbo.shift(-1, g.flight);
        for (let i = 0; i < (r === 't3' ? 6 : 2); i++) g.controls.turbo.shift(1, g.flight);
      }, rung);
      const dips = [];
      for (const dip of [0, 10, 15, 20, 25, 30]) {
        await page.evaluate((h) => {
          const g = window.__game, o = g.city.manifest.origin, k = Math.PI / 180, x = (-122.4352 - o[1]) * k * 6378137 * Math.cos(o[0] * k) - 2000, z = -(37.7763 - o[0]) * k * 6378137;
          const y = g.city.groundAt(x, z) + h;
          window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
          window.__dcDip = null;
          Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: y, targetY: y, vy: 0, mode: 0 });
        }, h);
        await runFor(page, 0.5);
        await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
        await page.evaluate(([h, d]) => {
          window.__game.forceReady();
          window.__game.rig.settleAt(h);
          window.__dcDip = d;
        }, [h, dip]);
        await runFor(page, 0.4);
        await page.evaluate(() => (window.__dcTrace = []));
        await runFor(page, 0.6);
        const held = await page.evaluate(() => { const tr = window.__dcTrace; return { draws: Math.max(...tr.map((q) => q[0])), tris: Math.max(...tr.map((q) => q[1])), lift: +window.__game.rig.skyLift.toFixed(2), by: window.__dcWhat() }; });
        await page.evaluate(() => { window.__dcTrace = []; window.__qa = null; });
        await runFor(page, 1);
        const flown = await page.evaluate(() => { const tr = window.__dcTrace; window.__dcTrace = null; return { draws: Math.max(...tr.map((q) => q[0])), tris: Math.max(...tr.map((q) => q[1])), lift: +window.__game.rig.skyLift.toFixed(2), by: window.__dcWhat() }; });
        dips.push({ dip, held, flown });
        const line = (q) => `${q.draws} draws, ${(q.tris / 1e6).toFixed(3)} M (lift ${q.lift}) ${JSON.stringify(q.by)}`;
        console.log(`dipcost: ${h / 1000}km-${rung} dip ${dip}: held ${line(held)}; flown ${line(flown)}`);
      }
      R.rows.push({ key: `${h / 1000}km-${rung}`, dips });
    }
  await page.evaluate(() => (window.__qa = window.__dcDip = null));
  await page.close();
  R.errors = errors;
  res.dipcost = R;
  writeFileSync(`${out}/dipcost.json`, JSON.stringify(R, null, 1));
  if (errors) process.exitCode = 1;
}

if (modes.has('citycost')) {
  // What the city alone costs with no shot up (BUILT.md, "The review, and what it came to"; not in the default list), on any build: Turbo 3 over the
  // Western Addition heading east, 1, 2 and 5 km up and in a 45 degree dive from 5 km, placed as `comet` places them (the city streamed in, a real gentle
  // pull for the vista, the dive's stick held forward), then 1.5 s flown with no tap. Prints the most draws and triangles. Gates nothing but the page:
  // exits 1 on a page error                                                                                                              -> citycost.json
  const R = { rows: [] };
  const page = await open(Q);
  let errors = 0;
  page.on('pageerror', () => errors++);
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  await page.evaluate(() => {
    const g = window.__game, p = g.perf, orig = p.frame.bind(p);
    g.flight.glideSpeed = 0;
    p.frame = (dt, work) => {
      orig(dt, work);
      if (window.__ccTrace) window.__ccTrace.push([p.calls, p.tris, +g.rig.skyLift.toFixed(2)]);
    };
    while (g.controls.turbo.gear > 0) g.controls.turbo.shift(-1, g.flight);
    for (let i = 0; i < 6; i++) g.controls.turbo.shift(1, g.flight);
  });
  for (const h of [1000, 2000, 5000, 'dive']) {
    await page.evaluate((h) => {
      const g = window.__game, o = g.city.manifest.origin, k = Math.PI / 180, x = (-122.4352 - o[1]) * k * 6378137 * Math.cos(o[0] * k) - 2000, z = -(37.7763 - o[0]) * k * 6378137;
      const y = g.city.groundAt(x, z) + (h === 'dive' ? 5600 : h);
      window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
      Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: y, targetY: y, vy: 0, mode: 0 });
    }, h);
    await runFor(page, 0.5);
    await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
    await page.evaluate(() => (window.__qa = null));
    await page.evaluate(() => window.__game.forceReady());
    await runFor(page, 0.3);
    await H.down(1, 196, 690);
    for (let i = 1; i <= (h === 'dive' ? 6 : 2); i++) {
      await wall(25);
      await H.move(1, 196, 690 + (h === 'dive' ? -10 : 10) * i);
    }
    await runFor(page, 1);
    if (h !== 'dive') {
      await H.up(1);
      await runFor(page, 1.5);
    }
    await page.evaluate(() => (window.__ccTrace = []));
    await runFor(page, 1.5);
    const m = await page.evaluate(() => {
      const g = window.__game, f = g.flight, tr = window.__ccTrace;
      window.__ccTrace = null;
      return { agl: Math.round(f.y - g.city.groundAt(f.x, f.z)), nose: +((f.nose * 180) / Math.PI).toFixed(1), draws: Math.max(...tr.map((q) => q[0])), tris: Math.max(...tr.map((q) => q[1])), liftLeast: Math.min(...tr.map((q) => q[2])) };
    });
    if (h === 'dive') await H.up(1);
    R.rows.push({ key: `${h === 'dive' ? 'dive' : `${h / 1000}km`}-t3`, ...m });
    console.log(`citycost: ${h === 'dive' ? 'dive' : `${h / 1000}km`}-t3: ${m.draws} draws, ${(m.tris / 1e6).toFixed(3)} M (agl ${m.agl}, nose ${m.nose}, least lift ${m.liftLeast})`);
  }
  await page.close();
  R.errors = errors;
  res.citycost = R;
  writeFileSync(`${out}/citycost.json`, JSON.stringify(R, null, 1));
  if (errors) process.exitCode = 1;
}

if (modes.has('moonhigh')) {
  // No far shot over the Moon (BUILT.md, "The Comet dead ahead"; not in the default list): ?moon at Tycho, 5 km over its ground, a level tap at Turbo 3
  // and, after a 2 s real pull up, a tap at Cruise. Each: its kind, far or not, and where it landed from the bus at the tap. Written to moonhigh.json; with
  // SB_AGAINST (another build's moonhigh.json, 4f33648's), each the same kind, never far, and its landing within 10 % or 60 m of that one's. No page error.
  // Exits 1 when a row fails                                                                                                          -> moonhigh.json
  const R = { rows: [], verdicts: [] };
  const ok = (c, m) => R.verdicts.push(`${c ? 'ok' : 'FAIL'}: ${m}`);
  const page = await open('?moon&site=TYCHO&skipintro&fixeddt=0.05');
  let errors = 0;
  page.on('pageerror', () => errors++);
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  await page.evaluate(() => {
    window.__game.flight.glideSpeed = 0;
    window.__game.audio.unlock();
  });
  await runFor(page, 2);
  await H.down(1, 196, 780);
  await wall(60);
  await H.up(1);
  await runFor(page, 1);
  for (const [key, rung] of [['level-t3', 't3'], ['noseup-cruise', 'cruise']]) {
    await page.evaluate((r) => {
      const g = window.__game;
      while (g.controls.turbo.gear > 0) g.controls.turbo.shift(-1, g.flight);
      for (let i = 0; i < (r === 't3' ? 6 : 0); i++) g.controls.turbo.shift(1, g.flight);
    }, rung);
    // (5 km over the ground where the bus is, heading as it was, held while the ground streams in)
    const at = await page.evaluate(() => {
      const g = window.__game, f = g.flight, y = g.city.groundAt(f.x, f.z) + 5000;
      window.__qa = { pin: { x: f.x, z: f.z, heading: f.heading, y } };
      Object.assign(f, { y, holdY: y, targetY: y, vy: 0, mode: 0 });
      return { x: f.x, z: f.z };
    });
    await runFor(page, 0.5);
    await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
    await page.evaluate(() => (window.__qa = null));
    await page.evaluate(() => window.__game.forceReady());
    await runFor(page, 0.3);
    if (rung === 'cruise') {
      await H.down(1, 196, 690);
      for (let i = 1; i <= 6; i++) {
        await wall(25);
        await H.move(1, 196, 690 + i * 10);
      }
      await runFor(page, 2);
      await H.up(1);
      await runFor(page, 0.1);
    } else await runFor(page, 1);
    const tap = await page.evaluate(() => { const g = window.__game, f = g.flight; return { x: f.x, z: f.z, agl: Math.round(f.y - g.city.groundAt(f.x, f.z)), body: +((f.pitch * 180) / Math.PI).toFixed(1), shots: g.cometFx.stats.fired, lobs: g.lobState().lobs }; });
    await H.down(2, 300, 300);
    await wall(60);
    await H.up(2);
    await until(page, 'g.lastShot() && g.clock() - g.lastShot().t > g.lastShot().travel + 0.1', 6);
    const b = await page.evaluate((tap) => {
      const g = window.__game, l = g.lastShot(), c = l?.comet;
      return { kind: c?.kind ?? (c ? 'comet' : l ? 'splat' : null), far: !!c?.far, from: l ? Math.round(Math.hypot(l.aim[0] - tap.x, l.aim[2] - tap.z)) : null, lobs: g.lobState().lobs - tap.lobs };
    }, tap);
    const row = { key, agl: tap.agl, body: tap.body, ...b };
    R.rows.push(row);
    console.log('moonhigh:', JSON.stringify(row));
    ok(!row.far, `${key}: no far shot over the Moon (${row.kind}, far ${row.far}, ${row.from} m out, ${row.agl} m up, the body ${row.body})`);
  }
  if (process.env.SB_AGAINST) {
    const A = JSON.parse((await import('node:fs')).readFileSync(process.env.SB_AGAINST, 'utf8'));
    for (const row of R.rows) {
      const a = A.rows.find((q) => q.key === row.key);
      ok(a && a.kind === row.kind && row.from !== null && a.from !== null && Math.abs(row.from - a.from) <= Math.max(60, 0.1 * a.from), `${row.key}: the same shot as the other build's (${row.kind}, ${row.from} m; then ${a?.kind}, ${a?.from} m)`);
    }
  }
  ok(errors === 0, `no page error (${errors})`);
  await page.close();
  res.moonhigh = R;
  console.log('moonhigh:', R.verdicts.join('\n  '));
  writeFileSync(`${out}/moonhigh.json`, JSON.stringify(R, null, 1));
  if (R.verdicts.some((v) => v.startsWith('FAIL'))) process.exitCode = 1;
}

if (modes.has('stills')) {
  // The stills for the producer's calls 4 and 5 (BUILT.md, "The Comet dead ahead"; not in the default list), over the Western Addition heading east: at
  // Nonstop level 5 and 14 km up, a far Comet's hit with the bus held at most 0.3 of the half height over the middle (config.shotView.busMax, the pick),
  // at 0.78, and with no dip (config.shotView.most 0); at Cruise 14 km up after a 2 s pull, the far Lob's ring and beacon before the tap, the beacon capped
  // at 2 km (config.lob.beaconMost, the pick) and uncapped; and at Turbo 3 at the floor a low Comet at its flight's middle, from behind. Each with the loop
  // held. 9 stills; exits 1 when one isn't written or the page errs                                                                -> stills-*.png
  const page = await open(Q);
  let errors = 0;
  page.on('pageerror', () => errors++);
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  await page.evaluate(() => {
    window.__game.flight.glideSpeed = 0;
    window.__game.audio.unlock();
  });
  await runFor(page, 2);
  await H.down(1, 196, 780);
  await wall(60);
  await H.up(1);
  await runFor(page, 1);
  const still = async (name) => {
    await page.evaluate(() => (window.__qa = { holdFrames: 0 }));
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 60000 });
    await page.screenshot({ path: `${out}/stills-${name}.png` });
    await page.evaluate(() => (window.__qa = null));
    return `${out}/stills-${name}.png`;
  };
  const gear = (r) => page.evaluate((r) => {
    const g = window.__game;
    while (g.controls.turbo.gear > 0) g.controls.turbo.shift(-1, g.flight);
    for (let i = 0; i < (r === 't3' ? 6 : r === 'nonstop' ? 2 : 0); i++) g.controls.turbo.shift(1, g.flight);
  }, r);
  const place = async (h, r) => {
    await page.evaluate(([h, r]) => {
      const g = window.__game, o = g.city.manifest.origin, k = Math.PI / 180, x = (-122.4352 - o[1]) * k * 6378137 * Math.cos(o[0] * k) - 2000, z = -(37.7763 - o[0]) * k * 6378137;
      const y = g.city.groundAt(x, z) + (h === 'floor' ? g.config.turbo.jetAlt : h);
      window.__qa = { pin: { x, z, heading: Math.PI / 2, y } };
      Object.assign(g.flight, { x, z, heading: Math.PI / 2, y, holdY: h === 'floor' ? -Infinity : y, targetY: y, vy: 0, mode: 0 });
    }, [h, r]);
    await runFor(page, 0.5);
    await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
    await page.evaluate(() => (window.__qa = null));
    await page.evaluate(() => window.__game.forceReady());
    await runFor(page, 0.3);
  };
  const pull = async (s) => {
    await H.down(1, 196, 690);
    for (let i = 1; i <= 6; i++) {
      await wall(25);
      await H.move(1, 196, 690 + i * 10);
    }
    await runFor(page, s);
  };
  const tapNow = async () => {
    await H.down(2, 300, 300);
    await wall(60);
    await H.up(2);
  };
  const written = [];
  const V0 = await page.evaluate(() => ({ busMax: window.__game.config.shotView.busMax, most: window.__game.config.shotView.most, beaconMost: window.__game.config.lob.beaconMost }));
  // calls 5: the far Comet's hit, three ways, from 5 and 14 km
  await gear('nonstop');
  for (const h of [5000, 14000]) {
    for (const [way, busMax, most] of [['pick', V0.busMax, V0.most], ['078', 0.78, V0.most], ['nodip', V0.busMax, 0]]) {
      await page.evaluate(([b, m]) => Object.assign(window.__game.config.shotView, { busMax: b, most: m }), [busMax, most]);
      await place(h, 'nonstop');
      await runFor(page, 1);
      await tapNow();
      await until(page, 'g.lastShot() && g.clock() - g.lastShot().t > g.lastShot().travel - 0.02', 6);
      written.push(await still(`call5-${h / 1000}km-${way}`));
      await runFor(page, 2);
    }
  }
  await page.evaluate((V) => Object.assign(window.__game.config.shotView, { busMax: V.busMax, most: V.most }), V0);
  // calls 4: the far Lob's ring and beacon before the tap, 14 km up at Cruise, capped and uncapped
  await gear('cruise');
  for (const [way, most] of [['capped', V0.beaconMost], ['uncapped', 20000]]) {
    await page.evaluate((m) => (window.__game.config.lob.beaconMost = m), most);
    await place(14000, 'cruise');
    await pull(2);
    written.push(await still(`call4-14km-${way}`));
    await H.up(1);
    await runFor(page, 1);
  }
  await page.evaluate((m) => (window.__game.config.lob.beaconMost = m), V0.beaconMost);
  // the bow: a low Comet at Turbo 3 at the floor, at its flight's middle, from behind
  await gear('t3');
  await place('floor', 't3');
  await runFor(page, 1);
  await tapNow();
  await until(page, 'g.lastShot() && g.clock() - g.lastShot().t > 0.5 * (g.config.splat.inhale + g.lastShot().travel)', 4);
  written.push(await still('bow-t3-floor'));
  const kinds = await page.evaluate(() => { const c = window.__game.lastShot()?.comet; return { far: !!c?.far, travel: c?.travel ?? null }; });
  console.log('stills:', JSON.stringify({ written, bow: kinds }));
  const { existsSync } = await import('node:fs');
  const all = written.length === 9 && written.every((p) => existsSync(p));
  console.log(`stills: ${written.filter((p) => existsSync(p)).length} of 9 written; page errors ${errors}`);
  await page.close();
  if (!all || errors > 0) process.exitCode = 1;
}

if (modes.has('boom') || modes.has('falls')) {
  const progInit = () => {
    const P = WebGL2RenderingContext.prototype, cp = P.createProgram;
    window.__progs = 0;
    P.createProgram = function () { window.__progs++; return cp.call(this); };
  };
  const stills = process.env.SB_STILLS !== '0';
  // (a still with the game loop frozen: a 3x screenshot takes long enough for a second of game to pass under it at fixeddt)
  const still = async (page, path) => {
    await page.evaluate(() => (window.__qa = { holdFrames: 0 }));
    await wall(60);
    await page.screenshot({ path });
    await page.evaluate(() => (window.__qa = null));
  };
  // (a still of the first frame at or after the Boom's game time tb, the loop frozen there; it stays frozen after)
  const stillAt = async (page, tb, path) => {
    await page.evaluate((tb) => {
      const g = window.__game;
      window.__qa = { holdAt: g.clock() + (tb - g.boom.time) - 1e-4 };
    }, tb);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 120000, polling: 50 });
    await page.screenshot({ path });
  };
  // (the bus against the Boom's plan, logged by the stills: where it is along the path from the hoop's plane, its height and the hoop's, the floors, its
  // speeds and the plan's clock; the bloom still waits on it, Infinity until the ring's barf)
  const xState = async (page, key, what) => {
    const st = await page.evaluate((what) => {
      const g = window.__game, f = g.flight, p = g.boom.plan, r = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : String(v));
      return { what, flick: what === 'flick' ? window.__xFlick : undefined, age: r(g.boom.time - p.t0), along: r((f.x - p.hx) * p.nx + (f.z - p.hz) * p.nz), y: r(f.y), hy: r(p.hy), floor: r(p.floor), hoopFloor: r(f.hoopFloor), floorY: r(f.floorY), speed: r(f.speed), ground: r(f.ground), vy: r(f.vy), noseTo: r(f.noseTo), land: r(p.land - p.t0), thread: r(p.thread - p.t0), threaded: p.threaded };
    }, what);
    console.log(`boomx ${key}:`, JSON.stringify(st));
    return st;
  };
  // (every frame's draws, triangles and live particles, the fps meter's counters, from when __xTrace is set; and the bus's least distance to __xAt)
  const traceInit = () => {
    const g = window.__game, p = g.perf, orig = p.frame.bind(p), R = g.pipeline.renderer, c = g.city;
    g.audio.unlock();
    // (each frame's draws split three ways: the sun pass's, first draws (City.firstDraw's meshes, culling off) and the rest, so a pass near the bound
    // shows which moved it, r3's review)
    let sun = 0, first = 0, firsts = new Set(), firstsOf = null;
    const rbd = R.renderBufferDirect.bind(R);
    R.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      if (window.__xTrace) {
        if (firstsOf !== c.firsts) (firstsOf = c.firsts), (firsts = new Set(c.firsts));
        if (R.getRenderTarget() === g.pipeline.shadowRT) sun++;
        else if (firsts.has(object)) first++;
      }
      return rbd(camera, scene, geometry, material, object, group);
    };
    p.frame = (dt, work) => {
      orig(dt, work);
      const T = window.__xTrace;
      firstsOf = null;
      if (!T) return (sun = first = 0);
      T.push([p.calls, p.tris, g.particles.alive, sun, first]);
      sun = first = 0;
      if (window.__xAt) window.__xMin = Math.min(window.__xMin ?? Infinity, Math.hypot(g.flight.x - window.__xAt[0], g.flight.z - window.__xAt[1]));
    };
  };
  const traced = (page) => page.evaluate(() => {
    const tr = window.__xTrace;
    window.__xTrace = null;
    const worst = tr.reduce((a, t) => (t[0] > a[0] ? t : a), tr[0] ?? [0, 0, 0, 0, 0]);
    // (the worst frame's draws: the sun pass's, first draws outside it, the rest)
    return { frames: tr.length, draws: Math.max(...tr.map((t) => t[0])), tris: Math.max(...tr.map((t) => t[1])), particles: Math.max(...tr.map((t) => t[2])), split: [worst[3], worst[4], worst[0] - worst[3] - worst[4]] };
  });
  const limits = (ok, key, t) => ok(t.frames > 10 && t.draws <= 200 && t.tris <= 1.5e6 && t.particles <= 8000, `${key}: at most 200 draws, 1.5 M triangles and 8,000 particles (${t.frames} frames, ${t.draws} draws (the sun pass ${t.split[0]}, first draws ${t.split[1]}, the rest ${t.split[2]}), ${(t.tris / 1e6).toFixed(3)} M, ${t.particles} particles)`);
  const raisedBy = (page) => page.evaluate(() => {
    const d = window.__game.city.paint.data, d0 = window.__lv0;
    let raised = 0, wrong = 0;
    for (let i = 1; i < d.length; i += 4) {
      if (d[i] === d0[i]) continue;
      raised++;
      if (d[i] !== Math.min(3, d0[i] + 1)) wrong++;
    }
    return { raised, wrong };
  });
  // (world m from lat, lon on the page: its manifest's origin, as bomb's rows place the bus)
  const FACTIONS = { boom: [['rainbow', ''], ['atlantis', '&paintas=atlantis'], ['hyperglow', '&paintas=hyperglow'], ['inferno', '&paintas=inferno']], falls: [['rainbow', ''], ['hyperglow', '&paintas=hyperglow'], ['elderwood', '&paintas=elderwood']] };
  for (const mode of ['boom', 'falls']) {
    if (!modes.has(mode)) continue;
    const R = { rows: [], verdicts: [] };
    const ok = (c, m) => R.verdicts.push(`${c ? 'ok' : 'FAIL'}: ${m}`);
    // (SB_ONLY=rainbow,inferno: those factions' pages alone; SB_REPS=3: each page that many times, fresh, its rows as rainbow-run2 and on, every one judged,
    // so a frame's cost isn't one run's luck: what streamed in by the flick and was drawn for the first time in its frames moved the worst 10 draws, r3)
    const reps = Math.max(1, Number(process.env.SB_REPS ?? 1));
    const pages = FACTIONS[mode].filter(([k]) => !process.env.SB_ONLY || process.env.SB_ONLY.split(',').includes(k)).flatMap(([k, q]) => Array.from({ length: reps }, (_, i) => [i ? `${k}-run${i + 1}` : k, q]));
    for (const [fk, fq] of pages) {
      // (the Waterfall's page starts over the Financial District: pinned there from the Western Addition, its towers weren't in yet)
      const page = await open((mode === 'falls' ? `?lat=37.7946&lon=-122.4030&heading=88&skipintro&fixeddt=0.05${process.env.SB_Q ?? ''}` : Q) + `&${mode}` + fq, progInit);
      const cdp = await page.context().newCDPSession(page);
      const H = hand(page, cdp);
      await wall(1300);
      await page.evaluate(traceInit);
      await runFor(page, 2);
      // (the page's first touch runs a long task in its touchstart: one in the lane first)
      await H.down(1, 196, 780);
      await wall(60);
      await H.up(1);
      await runFor(page, 1);
      // (what that first touch hit: over the Financial District it can pour too, and its pool landed in the measured tap's window, a second pool, in 5 of
      // 18 runs (r3: its run still going when the window opened). So the Waterfall's page lets every run of it finish on the game clock first)
      const warm = await page.evaluate(() => ({ target: window.__game.lastShot()?.target?.index ?? null, pours: window.__game.falls?.stats.pours ?? 0, c: +window.__game.clock().toFixed(2) }));
      if (mode === 'falls') {
        await page.waitForFunction(() => window.__game.falls.runs.length === 0, null, { timeout: 120000, polling: 100 });
        warm.done = +(await page.evaluate(() => window.__game.clock())).toFixed(2);
      }
      const progs0 = await page.evaluate(() => window.__progs);
      if (mode === 'boom') {
        const E = Math.PI / 2;
        const ROWS = process.env.SB_BOOM_X === '1'
          ? [['pull-western-addition', 37.7795, -122.4335, 150, E, 1400, true], ['north-western-addition', 37.7795, -122.4335, 150, 0, 1400], ['south-western-addition', 37.7795, -122.4335, 150, Math.PI, 1400], ['tower-downtown', 37.78975, -122.39686, 150, -E, 775, false, true]].filter(([k]) => !process.env.SB_BOOM_XONLY || k.startsWith(process.env.SB_BOOM_XONLY))
          : [['western-addition', 37.7795, -122.4335, 150, E], ['western-addition', 37.7795, -122.4335, 300, E], ['downtown', 37.7905, -122.4035, 150, E]];
        for (const [where, lat, lon, over, heading, backAt, pull, pinned] of ROWS) {
          const key = `${fk}-${where}-${over}`;
          // (held short of the place at Turbo 2 while the city streams in, heading east (or `heading`), `over` m over the ground there, by about where the ring
          // lands from there (Boom's boomLead: 1,400 m short from 150, 2,050 from 300); let go, a flick 0.2 s on. `pinned`: held there through the frames
          // stepped to the flick too (they carried it 400-700 m) and put there as the flick fires, 775 m short (Boom.flick's hoopAhead at Turbo 2's 720 m/s and a
          // share of Turbo 3's spool, as s_boom's row), so the hoop stands on the place; heading west, the ring lands on SoMa)
          const back = backAt ?? (over > 200 ? 2050 : 1400);
          const at = await page.evaluate(([lat, lon, over, back, heading, pinned]) => {
            const g = window.__game, o = g.city.manifest.origin, r = Math.PI / 180, px = (lon - o[1]) * r * 6378137 * Math.cos(o[0] * r), pz = -(lat - o[0]) * r * 6378137;
            const bx = px - Math.sin(heading) * (back - 950), bz = pz + Math.cos(heading) * (back - 950), x = bx - Math.sin(heading) * 950, z = bz + Math.cos(heading) * 950;
            const y = g.city.groundAt(x, z) + over;
            window.__qa = { pin: { x, z, heading, y } };
            window.__xPin = pinned ? window.__qa.pin : null;
            Object.assign(g.flight, { x, z, heading, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0, speed: 720 });
            g.controls.turbo.arrive(3, 2);
            g.boom.last = -Infinity;
            return [bx, bz];
          }, [lat, lon, over, back, heading, pinned]);
          await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
          await page.evaluate(() => ((window.__qa = null), (window.__lv0 = window.__game.city.paint.data.slice())));
          await runFor(page, 0.2);
          const a = await page.evaluate(() => ({ ...window.__game.boomState().stats, level: window.__game.controls.turbo.level }));
          await page.evaluate(() => ((window.__xTrace = []), (window.__xMin = Infinity), (window.__xAt = null)));
          let plan = null;
          if (stills) {
            // (the loop kept frozen from the stroke and stepped a frame at a time to the flick's; then each still held at its game time on the Boom's clock: the
            // crack, the hoop standing ahead, the bus at its plane, the slam, the band blooming, the band behind)
            // (what the flick saw: the speed it was handed, the bus's, how far ahead it stood the hoop, and how far the bus was from its pin. `pinned`: the
            // bus put at its pin as the flick fires: the frames of the stroke had carried it 360 m on, and the pin applied after the flick put it back
            // there, 1,134 m short of a hoop 774 m ahead of the flick, so it crossed the plane at 1.5 s and the bloom's still waited past its time)
            await page.evaluate(() => {
              const b = window.__game.boom;
              if (b.__xWrapped) return;
              const o = b.flick.bind(b);
              b.flick = (f, want) => {
                const pin = window.__xPin, off = pin ? Math.hypot(f.x - pin.x, f.z - pin.z) : null;
                if (pin) Object.assign(f, pin);
                const p = o(f, want);
                window.__xFlick = { want, speed: f.speed, ground: f.ground, y: f.y, hd: p ? Math.hypot(p.hx - f.x, p.hz - f.z) : null, pin: off };
                return p;
              };
              b.__xWrapped = true;
            });
            await H.stamped(() => H.stroke(1, 100, 520, 0, -74, 85), true);
            for (let k = 0; k < 40 && !plan; k++) {
              await page.evaluate(() => (window.__qa = window.__xPin ? { holdFrames: 1, pin: window.__xPin } : { holdFrames: 1 }));
              await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 60000, polling: 20 });
              plan = await page.evaluate((n) => (window.__game.boomState().stats.flicks > n ? window.__game.boomState().plan : null), a.flicks);
            }
            if (plan) {
              await page.evaluate((p) => (window.__xAt = [p.x, p.z]), plan);
              const t0 = plan.t0;
              // (a pull held after the flick: a thumb down in the lane under the bus and drawn down, held through the stills)
              if (pull) {
                await H.down(2, 196, 700);
                await H.move(2, 196, 740);
              }
              await xState(page, key, 'flick');
              await stillAt(page, t0 + 0.05, `${out}/boom-${key}-1-crack.png`);
              // (the sky's pressure ring rolling up through the sky, the hoop on its way; then the hoop standing, the ring rolling on down the city)
              await stillAt(page, t0 + 0.2, `${out}/boom-${key}-2-sky.png`);
              await stillAt(page, t0 + 0.45, `${out}/boom-${key}-2-hoop.png`);
              await xState(page, key, 'hoop');
              // (the frame before the bus's crossing: its plane hoopAhead s on, a frame early at fixeddt's 0.05 s)
              await stillAt(page, t0 + 0.92, `${out}/boom-${key}-3-thread.png`);
              await xState(page, key, 'thread');
              const p2 = await page.evaluate(() => window.__game.boomState().plan);
              const th = Number.isFinite(p2.thread) ? p2.thread : t0 + 1;
              await stillAt(page, th + 0.2, `${out}/boom-${key}-4-slam.png`);
              await xState(page, key, 'slam');
              // (boomState hands Infinity over as null: no bloom yet, the bus short of the plane; the still then waits for the Boom's 2.4 s)
              const p3 = await page.evaluate(() => window.__game.boomState().plan);
              const bloom = Number.isFinite(p3.bloom) ? p3.bloom : t0 + 2.6;
              await stillAt(page, bloom + 0.05, `${out}/boom-${key}-5-bloom.png`);
              await xState(page, key, 'bloom');
              // (the band spreading under the bus and behind it: a second on, it's out of the chase's frame)
              await stillAt(page, bloom + 0.35, `${out}/boom-${key}-6-behind.png`);
              if (pull) await H.up(2);
              await page.evaluate(() => (window.__qa = null));
              await runFor(page, 1);
            } else await page.evaluate(() => (window.__qa = null));
          } else {
            await H.stamped(() => H.stroke(1, 100, 520, 0, -74, 85));
            plan = await page.evaluate(() => {
              const p = window.__game.boomState().plan;
              if (p) window.__xAt = [p.x, p.z];
              return p;
            });
            await runFor(page, 4);
          }
          const t = await traced(page);
          const b = await page.evaluate(() => ({ ...window.__game.boomState(), level: window.__game.controls.turbo.level, min: window.__xMin }));
          const rz = await raisedBy(page);
          const row = { key, level: [a.level, b.level], kind: plan?.kind ?? null, threaded: b.plan?.threaded ?? null, hoop: b.plan && { hy: Math.round(b.plan.hy), floor: Math.round(b.plan.floor), drift: Math.round(b.plan.drift) }, cracks: b.stats.cracks - a.cracks, r: plan && Math.round(plan.r), inner: plan && Math.round(plan.inner), off: plan && Math.round(Math.hypot(plan.x - at[0], plan.z - at[1])), rings: b.stats.rings - a.rings, busMin: Math.round(b.min), ...rz, ...t };
          R.rows.push(row);
          console.log('boom:', JSON.stringify(row));
          ok(row.level[0] === 2 && row.level[1] === 3 && row.kind === 'ring' && row.rings === 1, `${key}: the flick into Turbo 3 rang (levels ${row.level.join(' to ')}, ${row.kind}, ${row.rings} ring)`);
          ok(row.raised > 0 && row.wrong === 0, `${key}: every building it raised one level up (${row.raised}, ${row.wrong} not)`);
          ok(!!plan && row.busMin < plan.inner, `${key}: the bus flew over its hole (${row.busMin} m from its middle at the nearest, the hole ${row.inner} m)`);
          ok(row.threaded === true && row.cracks === 1, `${key}: one crack, and the bus threaded the hoop (${row.cracks}, ${row.threaded})`);
          limits(ok, key, t);
        }
      } else {
        // (a tower's roof: the bus 300 m west of it, 60 m over it, at Cruise; a real tap off the lane, and the next tower if it didn't pour)
        let poured = false;
        await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
        for (let k = 0; k < 4 && !poured; k++) {
          const key = `${fk}-tower${k}`;
          // (an earlier pour's runs all down first: the page's first touch is a tap, and where it lands on a tower it pours; its pool landing after the
          // baseline below was counted as this tower's, a second pool and its last drops, the table's run of 5480c79)
          const earlier = await until(page, 'g.falls.runs.length === 0', 12);
          const r = await page.evaluate((k) => {
            const g = window.__game, o = g.city.manifest.origin, rr = Math.PI / 180, cx = (-122.3999 - o[1]) * rr * 6378137 * Math.cos(o[0] * rr), cz = -(37.7946 - o[0]) * rr * 6378137;
            const all = g.city.buildingsWithin(cx, cz, 700, []).map((n) => n.ref).filter((r) => r.stableId >= 0 && r.roofY - r.baseY > 60 && g.city.roofAtPart(r, r.cx, r.cz, Infinity) - r.baseY > 45);
            const t = all[k * 3];
            if (!t) return null;
            const y = t.roofY + 60;
            window.__qa = { pin: { x: t.cx - 300, z: t.cz, heading: Math.PI / 2, y } };
            Object.assign(g.flight, { x: t.cx - 300, z: t.cz, heading: Math.PI / 2, y, holdY: y, targetY: y, vy: 0, mode: 0 });
            return { index: t.index, h: Math.round(t.roofY - t.baseY), cx: t.cx, cz: t.cz, rad: t.rad };
          }, k);
          if (!r) break;
          await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 120000, polling: 100 });
          await page.evaluate(() => ((window.__qa = null), (window.__lv0 = window.__game.city.paint.data.slice())));
          await page.evaluate(() => window.__game.forceReady());
          await runFor(page, 0.3);
          const a = await page.evaluate(() => ({ ...window.__game.falls.stats, c: +window.__game.clock().toFixed(2), running: window.__game.falls.runs.map((r) => [r.ref.index, +r.t0.toFixed(2), +r.land.toFixed(2), r.landed, r.dropped, r.drops]) }));
          await page.evaluate(() => ((window.__xTrace = []), (window.__xAt = null)));
          await H.down(1, 300, 260);
          await wall(90);
          await H.up(1);
          await runFor(page, 0.6);
          const hit = await page.evaluate(() => ({ target: window.__game.lastShot()?.target?.index ?? null, pours: window.__game.falls.stats.pours }));
          poured = hit.pours > a.pours;
          if (stills && poured) {
            await still(page, `${out}/falls-${key}-1-runs.png`);
            await runFor(page, 0.9);
            await still(page, `${out}/falls-${key}-2-drops.png`);
            await runFor(page, 1.4);
            await still(page, `${out}/falls-${key}-3-pool.png`);
            await runFor(page, 1);
          } else await runFor(page, 3.3);
          const t = await traced(page);
          const b = await page.evaluate(([r0, hit]) => {
            const g = window.__game;
            // (round the tower that poured: what the tap hit, which may not be the one it was aimed at)
            const r = g.city.buildingsWithin(r0.cx, r0.cz, 800, []).map((n) => n.ref).find((q) => q.index === hit) ?? r0;
            let wet = 0;
            for (let i = 0; i < 16; i++) {
              const q = (i / 16) * Math.PI * 2, s = g.city.ground.sample(r.cx + Math.cos(q) * (r.rad + 4), r.cz + Math.sin(q) * (r.rad + 4));
              if (s && s.cov >= 0.5) wet++;
            }
            return { ...g.falls.stats, wet };
          }, [r, hit.target]);
          const row = { key, tower: r, target: hit.target, pours: b.pours - a.pours, drops: b.drops - a.drops, pools: b.pools - a.pools, wet: b.wet, earlierDown: earlier, warm, at: a.c, running: a.running, ...t };
          R.rows.push(row);
          console.log('falls:', JSON.stringify(row));
          if (!poured) continue;
          ok(row.running.length === 0, `${key}: nothing poured before its tap still running as it came (${JSON.stringify(row.running)}; the page's first touch hit ${warm.target}, ${warm.pours} pours)`);
          ok(row.pools === 1 && row.drops > 0, `${key}: it poured, its drops and its pool (${row.drops} drops, ${row.pools} pool; tower ${r.index}, ${r.h} m)`);
          ok(row.wet >= 8, `${key}: its pool round its foot (${row.wet} of 16)`);
          limits(ok, key, t);
        }
        ok(poured, `${fk}: a tap off the lane at a tower poured (${R.rows.filter((q) => q.key.startsWith(fk)).map((q) => `${q.tower?.index} aimed, ${q.target} hit`).join('; ')})`);
      }
      const made = (await page.evaluate(() => window.__progs)) - progs0;
      R[fk] = { programsAtReady: progs0, madeAfter: made };
      ok(made === 0, `${mode} ${fk}: nothing compiles: ${made} programs made after ready`);
      await page.close();
    }
    res[mode] = R;
    console.log(`${mode}:`, R.verdicts.join('\n  '));
    writeFileSync(`${out}/${mode}.json`, JSON.stringify(R, null, 1));
    if (R.verdicts.some((v) => v.startsWith('FAIL'))) process.exitCode = 1;
  }
}

if (modes.has('curb')) {
  // Curb with real touches (docs/specs/shots/CURB.md), ?life: over GEARS.md's arterial (SB_CURB=lat,lon,heading moves it), a real flick down to School
  // Zone and another onto the street; a minute rolled beside the cars, read every 5 s; the push on; a look held left at the next junction; a tap's
  // drive-by; a real flick up off it; School Zone's drift down onto it again; a pull held off it; and a flick down over the bay, FIND A STREET. Stills
  // at each (1179 x 2556), the draws, triangles and frame times on the street, and every WebGL program made after ready (none may be)
  const [lat, lon, hdg] = (process.env.SB_CURB ?? '37.736181,-122.426973,227').split(',').map(Number);
  const page = await open(`?lat=${lat}&lon=${lon}&heading=${hdg}&skipintro&fixeddt=0.05&life${process.env.SB_Q ?? ''}`, () => {
    const P = WebGL2RenderingContext.prototype, cp = P.createProgram;
    window.__progs = 0;
    P.createProgram = function () { window.__progs++; return cp.call(this); };
  });
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  await wall(1300);
  const progs0 = await page.evaluate(() => window.__progs);
  await page.evaluate(() => {
    const g = window.__game, c = g.curb, ev = c.hooks.event, ob = g.life.curb.onBeside;
    window.__curb = { ev: [], painted: [], frames: [] };
    c.hooks.event = (e, k) => { window.__curb.ev.push(`${e}${k ? ':' + (+k).toFixed(2) : ''}@${g.clock().toFixed(2)}`); ev(e, k); };
    g.life.curb.onBeside = (k) => { window.__curb.painted.push(k); ob(k); };
    // (the wall clock's frames on the street: what a player's phone would feel, here on the laptop's GPU)
    let last = 0;
    const tick = (t) => { if (last && g.curb.rolling) window.__curb.frames.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    g.flight.glideSpeed = 0;
    g.audio.unlock();
  });
  await runFor(page, 2);
  const flick = (dy) => H.stamped(() => H.stroke(1, 100, 520, 0, dy, 85));
  const st = () => page.evaluate(() => {
    const g = window.__game, c = g.curb, f = g.flight, p = g.perf.snapshot(), T = g.controls.turbo;
    return { state: c.state, left: c.left, below: T.below, name: T.name, gear: T.gear, speed: +f.speed.toFixed(2), overRoad: +(f.y - g.city.groundAt(f.x, f.z)).toFixed(2), beside: g.life.curb.beside, besideFor: +g.life.curb.besideFor.toFixed(2), side: c.side, dabs: c.qa.dabs, passes: c.qa.passes, turns: c.qa.turns, asked: c.qa.asked, hits: g.life.qa.hits, cam: +g.rig.distance.toFixed(1), curbIn: +g.rig.curbIn.toFixed(3), hfov: +g.rig.hfov.toFixed(1), toast: !!document.querySelector('[data-hud="toast"]'), calls: p.calls, tris: p.triangles, frameMs: p.frameMs, workMs: p.workMs };
  });
  const R = { cruise: await st() };
  await page.screenshot({ path: `${out}/curb-0-cruise.png` });
  await flick(74);
  await runFor(page, 3);
  R.zone = await st();
  await flick(74);
  await runFor(page, 0.4);
  R.arc = await st();
  await page.screenshot({ path: `${out}/curb-1-arc.png` });
  await runFor(page, 2.5);
  R.on = await st();
  await page.screenshot({ path: `${out}/curb-2-on.png` });
  // a minute rolled, read every 5 s
  R.roll = [];
  for (let i = 0; i < 12; i++) {
    await runFor(page, 5);
    R.roll.push(await st());
    if (i === 5) await page.screenshot({ path: `${out}/curb-3-roll.png` });
  }
  R.painted = await page.evaluate(() => window.__curb.painted.slice());
  // the push on, a held right thumb up. Asked once the bus is back at the road's pace: life's Parade takes each car painted beside the bus into the line and
  // the bus goes for the next one ahead by itself at that car's speed and 8 m/s more (src/life/Curb.ts), which is the push's own top speed, so a push asked
  // mid-chase adds nothing to read. Waits up to 60 s of the game's clock for the bus at the lane's pace or under it, no car ahead to go for and none beside
  const PACED = '(() => { const c = g.life.curb, i = Math.max(0, Math.min(c.i, c.n - 2)); return g.curb.state === "on" && !c.next && !c.beside && g.flight.speed <= Math.max(6.5, c.pts[i * 4 + 3] * 1.07); })()';
  if (!(await until(page, PACED, 0))) {
    R.pushWaited = { from: R.roll.at(-1).speed, paced: !!(await until(page, PACED, 60)) };
    R.beforePush = await st();
    R.pushWaited.at = R.beforePush.speed;
  }
  await H.down(2, 300, 640);
  for (let i = 1; i <= 6; i++) { await H.move(2, 300, 640 - i * 22); await runFor(page, 0.05); }
  await runFor(page, 4);
  R.push = await st();
  await page.screenshot({ path: `${out}/curb-4-push.png` });
  await H.up(2);
  await runFor(page, 1);
  // a look held left, high over the bus, for the next junction
  await H.down(3, 200, 210);
  for (let i = 1; i <= 6; i++) { await H.move(3, 200 - i * 20, 210); await runFor(page, 0.05); }
  await runFor(page, 1.5);
  R.look = await st();
  await page.screenshot({ path: `${out}/curb-5-look.png` });
  // a tap's drive-by while looking: the fronts on that side
  const hits0 = R.look.hits;
  await page.waitForFunction(() => window.__game.flight.fullness >= 0.999, null, { timeout: 20000, polling: 50 }).catch(() => {});
  await H.stamped(async () => { await H.down(4, 300, 380, 0); await H.up(4, 90); });
  await runFor(page, 0.6);
  await page.screenshot({ path: `${out}/curb-6-driveby.png` });
  R.driveBy = { ...(await st()), shot: await page.evaluate(() => window.__game.lastShot()), hitsTaken: 0 };
  R.driveBy.hitsTaken = R.driveBy.hits - hits0;
  await H.up(3);
  await runFor(page, 2);
  // a real flick up: off, School Zone
  await flick(-74);
  await runFor(page, 0.2);
  R.flickUp = await st();
  await runFor(page, 3);
  R.flickUpAfter = await st();
  await page.screenshot({ path: `${out}/curb-7-off.png` });
  // School Zone's drift down onto it again: the stick held up
  await H.down(2, 300, 640);
  for (let i = 1; i <= 6; i++) { await H.move(2, 300, 640 - i * 22); await runFor(page, 0.05); }
  await until(page, 'g.curb.state === "arc" || g.curb.state === "on"', 15);
  R.driftLand = await st();
  await H.up(2);
  await runFor(page, 3);
  // a pull held: off, climbing out
  await H.down(2, 300, 640);
  for (let i = 1; i <= 6; i++) { await H.move(2, 300, 640 + i * 22); await runFor(page, 0.05); }
  await runFor(page, 1.5);
  R.pullOff = await st();
  await H.up(2);
  await runFor(page, 3);
  R.pullOffAfter = await st();
  R.events = await page.evaluate(() => window.__curb.ev.slice());
  R.frames = await page.evaluate(() => {
    const a = window.__curb.frames.slice().sort((p, q) => p - q);
    return a.length ? { n: a.length, median: +a[Math.floor(a.length / 2)].toFixed(1), p95: +a[Math.floor(a.length * 0.95)].toFixed(1), max: +a[a.length - 1].toFixed(1) } : null;
  });
  R.programs = { atReady: progs0, madeAfter: (await page.evaluate(() => window.__progs)) - progs0 };
  const street = [R.on, ...R.roll, R.push, R.look, R.driveBy];
  R.onStreet = { callsMax: Math.max(...street.map((s) => s.calls)), callsMin: Math.min(...street.map((s) => s.calls)), trisMax: Math.max(...street.map((s) => s.tris)), frameMsMax: Math.max(...street.map((s) => s.frameMs)) };
  const ok = (c, m) => (R.verdicts ??= []).push(`${c ? 'ok' : 'FAIL'}: ${m}`);
  ok(R.programs.madeAfter === 0, `nothing compiles on the street: ${R.programs.madeAfter} programs made after ready`);
  ok(R.zone.below === 1 && R.arc.state !== 'fly' && R.on.state === 'on' && R.on.name === 'CURB', `a real flick down in School Zone lands: ${R.arc.state}, then ${R.on.state} (${R.on.name})`);
  ok(R.on.overRoad > 1.5 && R.on.overRoad < 4, `the tyres on the road: the bus's middle ${R.on.overRoad} m over it`);
  ok(R.roll.every((s) => s.state === 'on'), `a minute on the street: ${R.roll.map((s) => s.state).join(',')}`);
  ok(R.painted.length > 0, `a car ridden beside is painted: ${R.painted.length} (${R.painted.join(', ')})`);
  ok(R.roll.at(-1).dabs > R.on.dabs + 20, `the lane paints itself: ${R.on.dabs} to ${R.roll.at(-1).dabs} dabs`);
  ok(R.on.cam < 40 && R.cruise.cam > 100, `the lens down at the kerb: ${R.cruise.cam} to ${R.on.cam} m, ${R.on.hfov} degrees`);
  ok(R.onStreet.callsMax <= 200 && R.onStreet.trisMax <= 1.5e6, `the budget on the street: ${R.onStreet.callsMin}-${R.onStreet.callsMax} draws, ${(R.onStreet.trisMax / 1e6).toFixed(2)} M triangles at most`);
  ok(R.push.state === 'on' && R.push.speed > (R.beforePush ?? R.roll.at(-1)).speed, `the push rolls on: ${(R.beforePush ?? R.roll.at(-1)).speed} to ${R.push.speed} m/s`);
  ok(R.look.turns > R.push.turns && R.look.side === -1, `a look held left: the indicator, the drive-by's side left (${R.look.turns} turns, side ${R.look.side})`);
  ok(!!R.driveBy.shot?.target, `a tap's drive-by took a front: ${JSON.stringify(R.driveBy.shot?.target ?? null)}, the car beside ${R.look.beside ?? 'none'} (${R.driveBy.hitsTaken} hits on movers)`);
  ok(R.flickUp.below === 1 && R.flickUp.left === 'flick' && R.flickUpAfter.speed < 1, `a real flick up gets off to School Zone: ${R.flickUp.left}, ${R.flickUpAfter.speed} m/s`);
  ok(R.driftLand.state === 'arc' || R.driftLand.state === 'on', `School Zone's drift down lands again: ${R.driftLand.state}`);
  ok(R.pullOff.left === 'pull' && R.pullOff.below === 1, `a pull held gets off: ${R.pullOff.left}, ${R.pullOffAfter.overRoad} m over the road after`);
  await page.close();
  // over the bay off the Marina, no road within 80 m: a flick down in School Zone hops and says FIND A STREET
  const bay = await open(`?lat=37.8105&lon=-122.44&heading=0&skipintro&fixeddt=0.05&life${process.env.SB_Q ?? ''}`);
  const cdp2 = await bay.context().newCDPSession(bay);
  const H2 = hand(bay, cdp2);
  await bay.evaluate(() => { window.__game.flight.glideSpeed = 0; window.__game.audio.unlock(); });
  await runFor(bay, 2);
  await H2.stamped(() => H2.stroke(1, 100, 520, 0, 74, 85));
  await runFor(bay, 3);
  const vy0 = await bay.evaluate(() => window.__game.flight.vy);
  await H2.stamped(() => H2.stroke(1, 100, 520, 0, 74, 85));
  await until(bay, 'g.curb.state === "bounce"', 3);
  await runFor(bay, 0.1);
  await bay.screenshot({ path: `${out}/curb-8-findastreet.png` });
  R.findAStreet = await bay.evaluate((vy0) => { const g = window.__game; return { state: g.curb.state, below: g.controls.turbo.below, vyGain: +(g.flight.vy - vy0).toFixed(2), toast: !!document.querySelector('[data-hud="toast"]') }; }, vy0);
  await runFor(bay, 2.2);
  R.findAStreet.after = await bay.evaluate(() => window.__game.curb.state);
  ok(R.findAStreet.state === 'bounce' && R.findAStreet.toast && R.findAStreet.after === 'fly', `no street: the hop and FIND A STREET, then flying again: ${JSON.stringify(R.findAStreet)}`);
  await bay.close();
  res.curb = R;
  console.log('curb:', JSON.stringify(R));
  writeFileSync(`${out}/curb.json`, JSON.stringify(R, null, 1));
}

if (modes.has('firstrun')) {
  // a first visit: no skipintro, no card, no hold; every cue in order, on the real clock of the game
  mkdirSync(`${out}/firstrun`, { recursive: true });
  const FR = {};
  // (&noreturn: the next visit below is the Golden Gate's, not a return start over this visit's splat: src/game/Return.ts)
  const page = await open(`?fixeddt=0.05&noreturn${process.env.SB_Q ?? ''}`, null, base, { ready: 'window.__game && window.__game.city.loadedRegionCount() > 0' });
  const cdp = await page.context().newCDPSession(page);
  const H = hand(page, cdp);
  const ui = () => page.evaluate(() => {
    const g = window.__game, s = g.controls.snapshot();
    return { t: +g.clock().toFixed(1), opening: g.controls.opening, coach: s.coach, mega: getComputedStyle(document.querySelector('[data-hud="mega"]')).display, glint: g.glintNow()?.index ?? -1, prefs: s.prefs, bridge: g.openingBridge ? g.openingBridge() !== null : null };
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
