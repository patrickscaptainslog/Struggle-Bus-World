#!/usr/bin/env node
// Controls QA in the real game (index.html), iPhone portrait viewport, touch + mobile emulation.
//   node tools/controls.mjs <baseUrl> <outDir> [touch] [turbo] [tilt] [gestures] [hybrid] [firstrun] [layout] [states] [flows] [opening] [perf=<otherBaseUrl>]
//
//   touch  the default page (Chromium: no motion sensor: the quiet probe hears nothing, no toggle): shots of the HUD and
//          the settings panel; real gestures on MEGA (tap / hold / slide) and TURBO (tap / hold to boost)  -> touch.json
//   turbo  (same page) TURBO shifts G0 -> G1 at Alamo Square: the climb to the gear's height, engagement, the sonic
//          boom, the jet over SF (shots + a per-frame log of speed, altitude, camera, draws / triangles / CPU work),
//          LOCKED (shot), the downshift on the tab                                          -> turbo.json
//   tilt   an iOS-like page: requestPermission mocked and a synthetic 60 Hz sensor (a physical phone model: W3C beta /
//          gamma with the spec's range flips); the toggle's tap -> permission -> calibration, roll and pitch sweeps end
//          to end (stretch -> Flight yaw rate, bank, climb; a banked-turn shot), recenter    -> tilt in controls.json
//   gestures  the gesture table in the real page, tilt off and on, with CDP touches dispatched while the game loop is
//          frozen (__qa.holdFrames = 0: frames are instant, so events arrive when they happen), the loop running only
//          through the holds                                                      -> gestures in controls.json
//   hybrid  thumb against tilt: a drag in a carve and its lift (flight log), a tap in a carve, TURBO in a carve, MEGA
//          held while tilted, a second finger while steering                                  -> hybrid.json
//   firstrun  a first visit: no card, no hold, the cues in order (TAP, DRAG, TURBO's blink, the chip, HOLD), the chip's
//          tap asking inside its touchend, an ignored chip reaching the corner, a lapsed and a surviving iOS grant
//                                                                                             -> firstrun.json
//   layout  real rects against layoutHud at 393 x 852, 393 x 659, 320 x 568, 852 x 393, swapped or not (shots)
//   states  every button state, cropped (states/*.png; tools/hud-sheet.py makes a sheet of them)
//   flows  every way into tilt: refused, thrown, rejected, silent, settings for 2 s, toggle off / back on / Busy, the
//          Android quiet probe, no sensor, the top-right fade, a desktop's keyboard + Esc  -> flows in controls.json
//   opening  no card, no hold; TURBO armed under the gate, cancelled, firing at the gate; the sheet holds the game; refused
//          and silent never hang it                                                           -> opening.json
//   perf=<otherBaseUrl>  CPU work ms, draw calls, triangles at the same Alamo Square view (cruising at the
//          floor, the fps meter's per-frame counters) for <otherBaseUrl> (e.g. the build before) and
//          <baseUrl>, in one browser session                                              -> perf in controls.json
// Launches through tools/browser.mjs (the GPU here, SwiftShader in the cloud): everything waits on the game
// clock (fixed 1/20 s steps), never wall time.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const [base = 'http://127.0.0.1:5101/', out = 'shots/controls', ...rest] = process.argv.slice(2);
const modes = new Set((rest.length ? rest : ['touch', 'turbo', 'tilt', 'gestures', 'hybrid', 'firstrun', 'layout', 'states', 'flows', 'opening']).map((m) => m.split('=')[0]));
const perfOther = (rest.find((m) => m.startsWith('perf=')) ?? '').slice(5);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions());

// ---- the physical phone (same model as tools/controls-sim/phone.ts), plain 3x3 math
const D = Math.PI / 180;
const mul = (a, b) => a.map((r, i) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const Rx = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const Ry = (t) => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const Rz = (t) => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
function w3cFor({ lean = 35, roll = 0, pitch = 0, yaw = 0, screen = 0 }) {
  let R = mul(Rx(90 * D), Rx(-(lean + pitch) * D));
  R = mul(R, Rz(screen * D));
  R = mul(Ry(roll * D), R);
  R = mul(Rz(yaw * D), R);
  let b = Math.asin(Math.max(-1, Math.min(1, R[2][1])));
  let g = Math.atan2(-R[2][0], R[2][2]);
  let a = Math.atan2(-R[0][1], R[1][1]);
  if (g >= Math.PI / 2 || g < -Math.PI / 2) {
    g = g >= 0 ? g - Math.PI : g + Math.PI;
    b = (b >= 0 ? Math.PI : -Math.PI) - b;
    a += Math.PI;
  }
  return { alpha: ((a / D) % 360 + 360) % 360, beta: b / D, gamma: g / D };
}

const Q = '?lat=37.77628&lon=-122.4352&heading=88&skipintro&fixeddt=0.05';
// an iOS-like page: `answer` is what requestPermission does ('granted' | 'denied' | 'throw' | 'reject'); `flow`: the
// sensor starts once it is granted; __sensor.hold stops it (Busy stays up). It records the event and the user activation.
const ios = (answer, flow) => `(() => {
  window.__sensor = { beta: 55, gamma: 0, alpha: 0, on: false, asked: 0, askedIn: [], activation: [], hold: false };
  window.DeviceOrientationEvent.requestPermission = () => {
    const s = window.__sensor;
    s.asked++;
    s.askedIn.push(window.event ? window.event.type : 'no event');
    s.activation.push(navigator.userActivation ? navigator.userActivation.isActive : null);
    if (${JSON.stringify(answer)} === 'throw') throw new Error('NotAllowedError');
    if (${JSON.stringify(answer)} === 'reject') return Promise.reject(new Error('NotAllowedError'));
    if (${JSON.stringify(answer)} === 'granted' && ${flow}) s.on = true;
    return Promise.resolve(${JSON.stringify(answer)});
  };
  setInterval(() => {
    const s = window.__sensor;
    if (s.on && !s.hold) window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: s.alpha, beta: s.beta, gamma: s.gamma, absolute: false }));
  }, 16);
})()`;

async function open(query, init, at = base, opt = {}) {
  const page = await browser.newPage({ viewport: opt.viewport ?? { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  // (recent Chromium desktop builds expose requestPermission too: a page that doesn't mock it is a phone with no such API)
  await page.addInitScript(() => {
    if (window.DeviceOrientationEvent) window.DeviceOrientationEvent.requestPermission = undefined;
  });
  if (init) await page.addInitScript(init);
  await page.goto(at + query, { waitUntil: 'load' });
  await page.waitForFunction(opt.ready ?? (() => window.__shotReady === true && window.__game), null, { timeout: 400000 });
  // (a fresh page per open: Controls saw the page's storage empty)
  // log the input contract's callbacks (wrapping what main / Controls installed)
  await page.evaluate(() => {
    const g = window.__game, inp = g.input;
    window.__ev = [];
    for (const k of ['onTap', 'onChargeStart', 'onChargeEnd', 'onTurbo']) {
      const orig = inp[k];
      inp[k] = (...a) => {
        window.__ev.push({ k, a, t: +g.clock().toFixed(2) });
        return orig?.(...a);
      };
    }
  });
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
async function touch(page, cdp, pts) {
  // pts: [{type, x, y, wait}] real CDP touches (pointer + touch events, like a finger)
  for (const p of pts) {
    if (p.type === 'touchEnd') await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await cdp.send('Input.dispatchTouchEvent', { type: p.type, touchPoints: [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    if (p.wait) await new Promise((r) => setTimeout(r, p.wait));
  }
}
const res = {};
/** Turn tilt on through the toggle (`noWait`: a page that already has the chip up is fine: the toggle works beside it). */
async function enterTilt(page, cdp) {
  const r = await rectOf(page, '[data-hud="tilt-toggle"]');
  await touch(page, cdp, [{ type: 'touchStart', x: r.x, y: r.y, wait: 60 }, { type: 'touchEnd' }]);
  await page.waitForFunction(() => window.__game.controls.tilt.active, null, { timeout: 60000 });
}

/**
 * A gesture with the game loop frozen except where it says `run` (a hold): CDP waits for the renderer to
 * acknowledge every touch, which on a slow host is a whole multi-second frame; frozen, frames are instant
 * and the page sees the touches when they happen. steps: {type, x, y, wait} | {run: seconds of game time}
 */
async function gesture(page, cdp, steps) {
  const freeze = () => page.evaluate(() => (window.__qa = { holdFrames: 0 }));
  const thaw = () => page.evaluate(() => (window.__qa = null));
  await freeze();
  for (const st of steps) {
    if (st.run !== undefined) {
      await thaw();
      await runFor(page, st.run);
      await freeze();
      continue;
    }
    if (st.type === 'touchEnd') await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await cdp.send('Input.dispatchTouchEvent', { type: st.type, touchPoints: [{ x: st.x, y: st.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    if (st.wait) await new Promise((r) => setTimeout(r, st.wait));
  }
  await thaw();
  await runFor(page, 0.1);
}

if (modes.has('touch') || modes.has('turbo')) {
  // fixeddt: every rendered frame is exactly 1/20 s of game time (deterministic on a slow host)
  const page = await open(Q);
  const cdp = await page.context().newCDPSession(page);
  await new Promise((r) => setTimeout(r, 1300));
  await runFor(page, 0.1);
  const s0 = await snap(page);
  const noTilt = await page.evaluate(() => sessionStorage.getItem('strugglebus.notilt'));
  res.fallback = { mode: s0.mode, tiltStatus: s0.tilt.status, tiltState: s0.hud.tiltState, sessionFlag: noTilt };
  console.log('fallback:', JSON.stringify(res.fallback));
  if (modes.has('touch')) {
    await page.evaluate(() => (window.__game.flight.glideSpeed = 19.2));
    await runFor(page, 2);
    await page.screenshot({ path: `${out}/hud-touch.png` });
    // settings
    const st = await rectOf(page, '[data-hud="settings"]');
    await page.touchscreen.tap(st.x, st.y);
    await runFor(page, 0.3);
    await page.screenshot({ path: `${out}/hud-settings.png` });
    const panelOpen = (await snap(page)).hud.settings;
    const close = await rectOf(page, '[data-hud="close"]');
    await page.touchscreen.tap(close.x, close.y);
    await runFor(page, 0.2);
    // MEGA: tap, hold 1.4 s, hold 0.8 s then slide off (it keeps charging and steers; the lift ends it)
    const sb = await rectOf(page, '[data-hud="mega"]');
    await page.evaluate(() => window.__game.forceReady());
    await events(page);
    await touch(page, cdp, [{ type: 'touchStart', x: sb.x, y: sb.y, wait: 90 }, { type: 'touchEnd' }]);
    await runFor(page, 0.3);
    const tapEv = await events(page);
    await touch(page, cdp, [{ type: 'touchStart', x: sb.x, y: sb.y, wait: 1400 }, { type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const holdEv = await events(page);
    await touch(page, cdp, [{ type: 'touchStart', x: sb.x, y: sb.y, wait: 800 }, { type: 'touchMove', x: sb.x - 90, y: sb.y - 40, wait: 100 }, { type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const slideEv = await events(page);
    // TURBO: tap (shift up), the tab (down), hold (boost)
    const lv = await rectOf(page, '[data-hud="turbo"]');
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.y, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const upEv = await events(page);
    const gearAfterUp = (await snap(page)).turbo.gear;
    const dn = await rectOf(page, '[data-hud="gear-down"]');
    await touch(page, cdp, [{ type: 'touchStart', x: dn.x, y: dn.y, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const downEv = await events(page);
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.y, wait: 900 }]);
    await runFor(page, 0.3);
    const boosting = (await snap(page)).input.turboHeld;
    await touch(page, cdp, [{ type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const afterBoost = (await snap(page)).input.turboHeld;
    res.touch = { panelOpen, megaTap: tapEv, megaHold: holdEv, megaSlideOff: slideEv, turboUp: upEv, gearAfterUp, tabDown: downEv, turboHoldBoost: boosting, boostAfterRelease: afterBoost };
    console.log('touch:', JSON.stringify(res.touch));
  }
  if (modes.has('turbo')) {
    // the jet: over the Western Addition heading east toward downtown
    await page.evaluate(() => {
      const g = window.__game;
      window.__log = [];
      const p = g.perf;
      const orig = p.frame.bind(p);
      p.frame = (dt, work) => {
        orig(dt, work);
        const c = g.controls.snapshot();
        window.__log.push({ t: +g.clock().toFixed(2), gear: c.turbo.gear, engaged: c.turbo.engaged, speed: +c.flight.speed.toFixed(1), agl: +c.flight.agl.toFixed(1), mode: c.flight.mode, strain: +c.turbo.strain.toFixed(2), camDist: +c.camera.distance.toFixed(1), hfov: +c.camera.hfov.toFixed(2), calls: p.calls, tris: p.tris, work: +work.toFixed(2) });
      };
    });
    await page.evaluate(() => { window.__game.flight.glideSpeed = 0; window.__qa = null; });
    await runFor(page, 1);
    // (the first gesture builds the sound graph, ~200 ms inside the handler; CDP acks after it, so a scripted
    // 80 ms tap would measure 300+ ms and read as a hold. A real finger's event times don't have this problem.)
    await page.evaluate(() => window.__game.audio.unlock());
    const lv = await rectOf(page, '[data-hud="turbo"]');
    await events(page);
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.y, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.1);
    // (if this host dropped the lever tap, shift through the same Input path the lever uses, and say so)
    const shiftMiss = (await snap(page)).turbo.gear !== 1;
    if (shiftMiss) {
      console.log('lever tap missed: shifting through input.onTurbo');
      await page.evaluate(() => window.__game.input.onTurbo(1));
    }
    const climbed = await until(page, 'g.controls.turbo.engaged', 12);
    await page.screenshot({ path: `${out}/g1-engage.png` });
    const boomed = await until(page, 'g.flight.speed > 345', 6);
    await runFor(page, 0.15);
    await page.screenshot({ path: `${out}/g1-boom.png` });
    await until(page, 'g.flight.speed > 440', 10);
    await runFor(page, 1.5);
    await page.screenshot({ path: `${out}/g1-jet.png` });
    // what the effects cost: alternate frames with them off, same place, same frame budget
    res.fxCost = await page.evaluate(() => new Promise((done) => {
      const g = window.__game, p = g.perf, fx = g.controls.fx.object, orig = p.frame;
      const on = [], off = [];
      p.frame = (dt, work) => {
        orig(dt, work);
        (fx.visible ? on : off).push({ calls: p.calls, tris: p.tris, work });
        fx.visible = !fx.visible;
        if (on.length >= 24) {
          p.frame = orig;
          fx.visible = true;
          const med = (a, k) => [...a.map((r) => r[k])].sort((x, y) => x - y)[Math.floor(a.length / 2)];
          done({ frames: on.length, on: { calls: med(on, 'calls'), tris: med(on, 'tris'), workMs: +med(on, 'work').toFixed(2) }, off: { calls: med(off, 'calls'), tris: med(off, 'tris'), workMs: +med(off, 'work').toFixed(2) } });
        }
      };
    }));
    console.log('fx cost at G1:', JSON.stringify(res.fxCost));
    // a splat at jet speed
    await page.evaluate(() => {
      window.__game.forceReady();
      window.__game.input.onTap();
    });
    await runFor(page, 0.5);
    await page.screenshot({ path: `${out}/g1-splat.png` });
    // a banked jet turn
    await page.evaluate(() => (window.__qa = { sx: 0.8, sy: 0 }));
    await runFor(page, 1.6);
    await page.screenshot({ path: `${out}/g1-turn.png` });
    await page.evaluate(() => (window.__qa = null));
    await runFor(page, 0.8);
    // LOCKED
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.y, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const lockMiss = !(await page.evaluate(() => window.__ev.some((e) => e.k === 'onTurbo' && e.a[0] === 1 && window.__game.controls.turbo.time - window.__game.controls.turbo.lockedAt < 1)));
    if (lockMiss) await page.evaluate(() => window.__game.input.onTurbo(1));
    await runFor(page, 0.2);
    await page.screenshot({ path: `${out}/g1-locked.png` });
    // drop back to G0
    const dn2 = await rectOf(page, '[data-hud="gear-down"]');
    await touch(page, cdp, [{ type: 'touchStart', x: dn2.x, y: dn2.y, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const downMiss = (await snap(page)).turbo.gear !== 0;
    if (downMiss) await page.evaluate(() => window.__game.input.onTurbo(-1));
    await runFor(page, 5);
    const ev = await events(page);
    const log = await page.evaluate(() => window.__log);
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? null;
    const g0 = log.filter((r) => r.gear === 0 && r.speed < 40 && r.t < log[0].t + 1);
    const jet = log.filter((r) => r.gear === 1 && r.speed > 440);
    res.turbo = {
      climbedToGear: climbed, boomed, events: ev, leverMissed: { up: shiftMiss, locked: lockMiss, down: downMiss },
      perf: { g0: { frames: g0.length, calls: med(g0.map((r) => r.calls)), tris: med(g0.map((r) => r.tris)), workMs: med(g0.map((r) => r.work)) }, g1: { frames: jet.length, calls: med(jet.map((r) => r.calls)), tris: med(jet.map((r) => r.tris)), workMs: med(jet.map((r) => r.work)) } },
      log: log.filter((_, i) => i % 4 === 0),
    };
    console.log('turbo:', JSON.stringify({ ...res.turbo, log: undefined }));
    for (const r of res.turbo.log.filter((_, i) => i % 2 === 0)) console.log('  ', JSON.stringify(r));
  }
  await page.close();
}

if (modes.has('tilt')) {
  // an iOS-like page: requestPermission mocked, and a sensor that only starts once it is granted
  const page = await open(Q, ios('granted', true));
  const cdp = await page.context().newCDPSession(page);
  // ---- the turbo voice rendered offline through the real AudioEngine graph (classes from the live objects):
  // a climb (strain), engage, Mach 1 boom, the jet, a boost, LOCKED, a downshift; peak / NaN / clipping
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
    v.shift(0.1, 1);
    v.engage(2.0);
    v.boom(3.0);
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
  const setPose = (p) => page.evaluate((e) => Object.assign(window.__sensor, e), w3cFor(p));
  await setPose({ lean: 35 });
  const s0 = await snap(page);
  await page.evaluate(() => (window.__game.flight.glideSpeed = 19.2));
  await runFor(page, 0.5);
  // the toggle: permission (inside the gesture), events, calibration
  await enterTilt(page, cdp);
  const s1 = await snap(page);
  const asked = await page.evaluate(() => ({ count: window.__sensor.asked, inEvent: window.__sensor.askedIn, active: window.__sensor.activation }));
  await runFor(page, 0.4);
  await page.screenshot({ path: `${out}/hud-tilt-toast.png` });
  await runFor(page, 3);
  await page.screenshot({ path: `${out}/hud-tilt.png` });
  // ---- sweeps, end to end (each pose held 0.6 s of game time; real-time sensor at 60 Hz)
  const sweep = async (label, poses) => {
    const rows = [];
    for (const p of poses) {
      await setPose({ lean: 35, ...p });
      await new Promise((r) => setTimeout(r, 120)); // a few real sensor samples
      await runFor(page, 0.6);
      const r = await page.evaluate(() => {
        const g = window.__game, st = g.input.state, f = g.flight;
        return { sx: +st.stretch.x.toFixed(3), sy: +st.stretch.y.toFixed(3), dragging: st.dragging, yawRate: +f.yawRate.toFixed(3), bank: +f.bank.toFixed(3), vy: +f.vy.toFixed(1), mode: f.mode, speed: +f.speed.toFixed(1), lift: +f.lift.toFixed(1) };
      });
      rows.push({ ...p, ...r });
    }
    return rows;
  };
  const roll = await sweep('roll', [0, 5, 12, 20, 30, 0, -8, -20, -30, 0].map((roll) => ({ roll })));
  await setPose({ lean: 35, roll: 22 });
  await new Promise((r) => setTimeout(r, 150));
  await runFor(page, 1.2);
  await page.screenshot({ path: `${out}/tilt-bank.png` });
  const pitch = await sweep('pitch', [0, -6, -15, -26, 0, 0, 8, 18, 0].map((pitch) => ({ pitch })));
  const upright = await sweep('upright', [{ lean: 0 }, { lean: -10 }, { lean: 0, roll: 15 }, { lean: 35 }]);
  // recenter: hold a 10 deg pitch, press recenter, the stick goes back to 0 once the phone is still
  await setPose({ lean: 35, pitch: 10 });
  await new Promise((r) => setTimeout(r, 150));
  await runFor(page, 0.3);
  const before = (await snap(page)).tilt.sy;
  const rc = await rectOf(page, '[data-hud="recenter"]');
  await page.touchscreen.tap(rc.x, rc.y); // (the buttons have faded out: this one brings them back)
  await new Promise((r) => setTimeout(r, 450));
  await page.touchscreen.tap(rc.x, rc.y);
  await new Promise((r) => setTimeout(r, 900));
  await runFor(page, 0.3);
  const after = (await snap(page)).tilt.sy;
  res.tilt = { before: s0, permissionAsked: asked, after: s1, roll, pitch, upright, recenter: { syBefore: before, syAfter: after } };
  console.log('tilt permission:', JSON.stringify({ asked, active: s1.tilt.active, status: s1.tilt.status }));
  console.log('roll:', JSON.stringify(roll));
  console.log('pitch:', JSON.stringify(pitch));
  console.log('upright:', JSON.stringify(upright));
  console.log('recenter:', JSON.stringify(res.tilt.recenter));
  await page.close();
}

if (modes.has('gestures')) {
  const G = {};
  for (const tiltOn of [false, true]) {
    const tag = tiltOn ? 'tilt' : 'touch';
    const page = await open(Q, tiltOn ? ios('granted', true) : null);
    const cdp = await page.context().newCDPSession(page);
    if (tiltOn) await enterTilt(page, cdp);
    else await new Promise((r) => setTimeout(r, 1300));
    await page.evaluate(() => window.__game.audio.unlock());
    await page.evaluate(() => window.__game.forceReady());
    const mg = await rectOf(page, '[data-hud="mega"]');
    const tb = await rectOf(page, '[data-hud="turbo"]');
    const row = async (name, steps, extra) => {
      await events(page);
      await gesture(page, cdp, steps);
      const r = { events: await events(page) };
      if (extra) Object.assign(r, await extra());
      G[`${tag}: ${name}`] = r;
      console.log('gesture', `${tag}: ${name}`, JSON.stringify(r));
    };
    const gear = async () => ({ gear: (await snap(page)).turbo.gear });
    const dn = async () => {
      const d = await rectOf(page, '[data-hud="gear-down"]');
      await row('down tab tap', [{ type: 'touchStart', x: d.x, y: d.y, wait: 80 }, { type: 'touchEnd' }], gear);
    };
    await row('MEGA tap (90 ms)', [{ type: 'touchStart', x: mg.x, y: mg.y, wait: 90 }, { type: 'touchEnd' }]);
    await row('MEGA 250 ms (under holdThreshold)', [{ type: 'touchStart', x: mg.x, y: mg.y, wait: 250 }, { type: 'touchEnd' }]);
    await row('MEGA hold (1.5 s of game time)', [{ type: 'touchStart', x: mg.x, y: mg.y }, { run: 1.5 }, { type: 'touchEnd' }]);
    await row('MEGA slide 20 px quick (adopted, inside the quick window: one splat)', [{ type: 'touchStart', x: mg.x, y: mg.y, wait: 30 }, { type: 'touchMove', x: mg.x - 20, y: mg.y, wait: 30 }, { type: 'touchEnd' }]);
    await row('MEGA hold then slide: keeps charging and steers, lift ends it', [{ type: 'touchStart', x: mg.x, y: mg.y }, { run: 1.0 }, { type: 'touchMove', x: mg.x - 60, y: mg.y - 10, wait: 30 }, { type: 'touchMove', x: mg.x - 110, y: mg.y - 20, wait: 30 }, { run: 0.5 }, { type: 'touchEnd' }], async () => ({ chargeHeldAfter: (await snap(page)).input.chargeHeld }));
    await row('MEGA 200 ms then slide off (steers, no splat)', [{ type: 'touchStart', x: mg.x, y: mg.y, wait: 200 }, { type: 'touchMove', x: mg.x - 60, y: mg.y, wait: 30 }, { type: 'touchEnd' }]);
    await row('TURBO tap (shift up)', [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 80 }, { type: 'touchEnd' }], gear);
    await row('TURBO tap again (LOCKED)', [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 80 }, { type: 'touchEnd' }], gear);
    await dn();
    await row('TURBO lifted at 400 ms (boosts briefly, shifts once)', [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 400 }, { type: 'touchEnd' }], gear);
    await dn();
    await row('TURBO lifted at 500 ms (no shift)', [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 500 }, { type: 'touchEnd' }], gear);
    await row('TURBO hold (boost)', [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 450 }, { run: 0.6 }], async () => ({ turboHeldWhileDown: (await snap(page)).input.turboHeld }));
    await gesture(page, cdp, [{ type: 'touchEnd' }]);
    G[`${tag}: TURBO released`] = { turboHeld: (await snap(page)).input.turboHeld, gear: (await snap(page)).turbo.gear };
    await row('TURBO drag: stays the button, slid 40 px before 300 ms = no shift', [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 30 }, { type: 'touchMove', x: tb.x + 45, y: tb.y + 10, wait: 30 }, { type: 'touchEnd' }], gear);
    await row('canvas quick tap (100 ms)', [{ type: 'touchStart', x: 150, y: 560, wait: 100 }, { type: 'touchEnd' }]);
    await row('canvas 400 ms still (splats)', [{ type: 'touchStart', x: 150, y: 560, wait: 400 }, { type: 'touchEnd' }]);
    await row('canvas hold (no charge, no splat)', [{ type: 'touchStart', x: 150, y: 560, wait: 520 }, { run: 0.3 }, { type: 'touchEnd' }]);
    await row('canvas drag 80 px (steer, no tap)', [{ type: 'touchStart', x: 150, y: 560, wait: 20 }, { type: 'touchMove', x: 190, y: 560, wait: 20 }, { type: 'touchMove', x: 230, y: 560 }, { run: 0.5 }, { type: 'touchEnd' }]);
    await row('canvas swipe up 90 px (a drag: no shift)', [{ type: 'touchStart', x: 150, y: 600, wait: 20 }, { type: 'touchMove', x: 150, y: 560, wait: 20 }, { type: 'touchMove', x: 150, y: 510, wait: 20 }, { type: 'touchEnd' }], gear);
    await page.close();
  }
  res.gestures = G;
}

if (modes.has('hybrid')) {
  // real CDP touches over a synthetic sensor: what the arbitration does in the real game
  const page = await open(Q, ios('granted', true));
  const cdp = await page.context().newCDPSession(page);
  const setPose = (p) => page.evaluate((e) => Object.assign(window.__sensor, e), w3cFor(p));
  await setPose({ lean: 35 });
  await page.evaluate(() => (window.__game.audio.unlock(), (window.__game.flight.glideSpeed = 19.2)));
  await enterTilt(page, cdp);
  await runFor(page, 1);
  const log = () => page.evaluate(() => new Promise((done) => {
    // a flight log until stopped
    const g = window.__game, l = [];
    window.__stopLog = () => done(l);
    const tick = () => {
      const m = g.controls.mix, st = g.input.state;
      l.push([+g.clock().toFixed(2), +st.stretch.x.toFixed(3), +st.stretch.y.toFixed(3), m.phase, st.thumb ? 1 : 0, +g.flight.yawRate.toFixed(3), +g.flight.heading.toFixed(3)]);
      if (window.__stopLog) requestAnimationFrame(tick);
    };
    tick();
  }));
  const H = {};
  // a drag during a carve, lift: the thumb replaces, the carve resumes
  await setPose({ lean: 35, roll: 14 });
  await new Promise((r) => setTimeout(r, 200));
  await runFor(page, 1.5);
  const stickCarve = (await snap(page)).input.sx;
  let p = log();
  await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 560, wait: 30 }, { type: 'touchMove', x: 170, y: 560, wait: 30 }, { type: 'touchMove', x: 140, y: 560 }]);
  await runFor(page, 0.3);
  const during = await snap(page);
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await runFor(page, 1.2);
  const after = await snap(page);
  await page.evaluate(() => { const s = window.__stopLog; window.__stopLog = null; s(); });
  const l1 = await p;
  H.dragInCarve = { stickCarve, during: { sx: during.input.sx, thumb: during.input.thumb, phase: during.mix.phase }, after: { sx: after.input.sx, phase: after.mix.phase, flags: [after.mix.thumbHeld, after.mix.reachHeld] }, maxStep: Math.max(...l1.slice(1).map((r, i) => Math.abs(r[1] - l1[i][1]))), frames: l1.length };
  console.log('hybrid drag in a carve', JSON.stringify(H.dragInCarve));
  // a tap in a carve: tilt never stops
  await events(page);
  p = log();
  await page.evaluate(() => window.__game.forceReady());
  await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 560, wait: 90 }, { type: 'touchEnd' }]);
  await runFor(page, 0.4);
  await page.evaluate(() => { const s = window.__stopLog; window.__stopLog = null; s(); });
  const l2 = await p;
  H.tapInCarve = { events: await events(page), phases: [...new Set(l2.map((r) => r[3]))], minSx: Math.min(...l2.map((r) => r[1])) };
  console.log('hybrid tap in a carve', JSON.stringify(H.tapInCarve));
  // TURBO in a carve: tap (two-handed: no swing) and a 1 s boost
  const tb = await rectOf(page, '[data-hud="turbo"]');
  await touch(page, cdp, [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 80 }, { type: 'touchEnd' }]);
  await runFor(page, 0.5);
  const a1 = await snap(page);
  await page.evaluate(() => window.__game.input.onTurbo(-1));
  await runFor(page, 0.3);
  await touch(page, cdp, [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 500 }]);
  await runFor(page, 0.8);
  const b1 = await snap(page);
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await runFor(page, 0.8);
  const b2 = await snap(page);
  H.turboInCarve = { afterTap: { gear: a1.turbo.gear, sx: a1.input.sx, phase: a1.mix.phase }, boostHeld: { turboHeld: b1.input.turboHeld, phase: b1.mix.phase, reachHeld: b1.mix.reachHeld, sx: b1.input.sx }, afterBoost: { phase: b2.mix.phase, sx: b2.input.sx, reachHeld: b2.mix.reachHeld } };
  console.log('hybrid turbo in a carve', JSON.stringify(H.turboInCarve));
  // MEGA held while tilted: it never clutches
  await page.evaluate(() => window.__game.forceReady());
  const mg = await rectOf(page, '[data-hud="mega"]');
  await events(page);
  await touch(page, cdp, [{ type: 'touchStart', x: mg.x, y: mg.y }]);
  await runFor(page, 1.2);
  const m1 = await snap(page);
  await page.screenshot({ path: `${out}/hybrid-mega-tilted.png` });
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await runFor(page, 0.5);
  H.megaTilted = { phase: m1.mix.phase, sx: m1.input.sx, chargeHeld: m1.input.chargeHeld, events: await events(page) };
  console.log('hybrid mega while tilted', JSON.stringify(H.megaTilted));
  // second finger while steering
  await page.evaluate(() => window.__game.forceReady());
  await events(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 600, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 600, id: 1 }] });
  await runFor(page, 0.2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 600, id: 1 }, { x: 300, y: 500, id: 2 }] });
  await new Promise((r) => setTimeout(r, 60));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: 150, y: 600, id: 1 }] });
  await runFor(page, 0.2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await runFor(page, 0.2);
  H.secondFinger = await events(page);
  console.log('hybrid second finger', JSON.stringify(H.secondFinger));
  res.hybrid = H;
  writeFileSync(`${out}/hybrid.json`, JSON.stringify({ H, l1, l2 }, null, 1));
  await page.close();
}

if (modes.has('firstrun')) {
  // a first visit: no skipintro, no card, no hold; every cue in order, on the real clock of the game
  mkdirSync(`${out}/firstrun`, { recursive: true });
  const FR = {};
  const page = await open('?fixeddt=0.05', ios('granted', true), base, { ready: 'window.__game && window.__game.city.loadedRegionCount() > 0' });
  const cdp = await page.context().newCDPSession(page);
  const ui = () => page.evaluate(() => {
    const g = window.__game, s = g.controls.snapshot();
    return { t: +g.clock().toFixed(1), opening: g.controls.opening, locked: g.controls.gearsLocked, coach: s.coach, chip: s.hud.chip, tiltState: s.hud.tiltState, turbo: getComputedStyle(document.querySelector('[data-hud="turbo"]')).display, mega: getComputedStyle(document.querySelector('[data-hud="mega"]')).display, glint: g.glintNow()?.index ?? -1, prefs: s.prefs };
  });
  await runFor(page, 0.5);
  FR.frame0 = await ui();
  await page.screenshot({ path: `${out}/firstrun/00-hero.png` });
  await until(page, '!g.controls.opening', 60);
  await runFor(page, 0.2);
  FR.fogEnd = await ui();
  await page.screenshot({ path: `${out}/firstrun/01-arrive.png` });
  // the gate: TURBO blinks three times (with no splat yet the chip comes 10 s after the fog, or 2 s after the gate)
  await until(page, '!g.controls.gearsLocked', 120);
  await runFor(page, 0.3);
  FR.gate = await ui();
  await page.screenshot({ path: `${out}/firstrun/02-turbo-blink.png` });
  await until(page, 'g.controls.snapshot().hud.chip', 20);
  FR.chip = await ui();
  await new Promise((r) => setTimeout(r, 320));
  await runFor(page, 0.05);
  await page.screenshot({ path: `${out}/firstrun/03-chip.png` });
  // the chip's tap asks inside its touchend
  const c = await rectOf(page, '[data-hud="tilt-chip"]');
  await touch(page, cdp, [{ type: 'touchStart', x: c.x, y: c.y, wait: 60 }, { type: 'touchEnd' }]);
  await page.waitForFunction(() => window.__game.controls.tilt.active, null, { timeout: 30000 });
  await runFor(page, 0.3);
  FR.asked = await page.evaluate(() => ({ asked: window.__sensor.asked, inEvent: window.__sensor.askedIn, activation: window.__sensor.activation }));
  FR.afterChip = await ui();
  await page.screenshot({ path: `${out}/firstrun/04-tilt-on.png` });
  // the first glint (the opening's bay has none): TAP
  await page.evaluate(() => window.__game.forceReady());
  await until(page, 'g.controls.snapshot().coach.cue === "tap"', 90);
  await runFor(page, 0.3);
  FR.tap = await ui();
  await page.screenshot({ path: `${out}/firstrun/05-tap.png` });
  // a real tap: the first splat, DRAG
  await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 520, wait: 60 }, { type: 'touchEnd' }]);
  await until(page, 'g.controls.snapshot().coach.cue === "drag"', 5);
  await runFor(page, 0.3);
  FR.drag = await ui();
  await page.screenshot({ path: `${out}/firstrun/06-drag.png` });
  // a thumb commit ends it
  await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 600, wait: 20 }, { type: 'touchMove', x: 160, y: 600, wait: 200 }, { type: 'touchEnd' }]);
  await runFor(page, 0.3);
  FR.dragDone = await ui();
  // the third splat: MEGA says HOLD
  for (let i = 0; i < 2; i++) {
    await runFor(page, 1.6); // (the last breath has to end)
    await page.evaluate(() => window.__game.forceReady());
    await runFor(page, 0.1);
    await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 520, wait: 60 }, { type: 'touchEnd' }]);
    await runFor(page, 0.3);
  }
  FR.splatting = await page.evaluate(() => window.__game.controls.snapshot().coach);
  FR.mega = await ui();
  await page.screenshot({ path: `${out}/firstrun/07-hold-cue.png` });
  await page.close();

  // ignored: it flies to the corner; stays unasked; ignored twice clears a lapsed grant
  const p2 = await open('?fixeddt=0.05', ios('granted', true), base, { ready: 'window.__game && window.__game.city.loadedRegionCount() > 0' });
  await until(p2, 'g.controls.snapshot().hud.chip', 120);
  await until(p2, '!g.controls.snapshot().hud.chip', 12);
  await new Promise((r) => setTimeout(r, 120));
  await p2.screenshot({ path: `${out}/firstrun/08-chip-flying.png` });
  await new Promise((r) => setTimeout(r, 600));
  await runFor(p2, 0.1);
  await p2.screenshot({ path: `${out}/firstrun/09-chip-corner.png` });
  FR.ignored = await p2.evaluate(() => { const s = window.__game.controls.snapshot(); return { tiltState: s.hud.tiltState, prefs: s.prefs, asked: window.__sensor.asked }; });
  await p2.close();

  // a lapsed iOS grant: prefs say tilt, the probe hears nothing: the chip at fog end with no gate wait
  const lapsed = `(() => { localStorage.setItem('strugglebus.controls.v1', JSON.stringify({ tilt: true, taught: 31 })); ${ios('granted', true)} })()`;
  const p3 = await open('?fixeddt=0.05', lapsed, base, { ready: 'window.__game && window.__game.city.loadedRegionCount() > 0' });
  await until(p3, '!g.controls.opening', 60);
  await runFor(p3, 0.2);
  FR.lapsed = await p3.evaluate(() => { const g = window.__game, s = g.controls.snapshot(); return { chip: s.hud.chip, locked: g.controls.gearsLocked, prefs: s.prefs }; });
  await p3.close();
  // a surviving grant: the probe hears motion, tilt starts on the first gesture, no chip
  const survive = `(() => { localStorage.setItem('strugglebus.controls.v1', JSON.stringify({ tilt: true, taught: 31 })); ${ios('granted', true)}; window.__sensor.on = true; })()`;
  const p4 = await open(Q, survive);
  const c4 = await p4.context().newCDPSession(p4);
  await new Promise((r) => setTimeout(r, 1500));
  const before4 = await snap(p4);
  await touch(p4, c4, [{ type: 'touchStart', x: 200, y: 560, wait: 60 }, { type: 'touchEnd' }]);
  await p4.waitForFunction(() => window.__game.controls.tilt.active, null, { timeout: 15000 });
  FR.survives = { before: before4.tilt.status, asked: await p4.evaluate(() => window.__sensor.asked), after: (await snap(p4)).tilt.status };
  await p4.close();
  for (const k in FR) console.log('firstrun', k, JSON.stringify(FR[k]));
  res.firstrun = FR;
  writeFileSync(`${out}/firstrun.json`, JSON.stringify(FR, null, 1));
}

if (modes.has('layout')) {
  // real rects against layoutHud (hud.L), each viewport, swapped or not; a shot of each with the down tab, the meter
  // and the chip up. Chromium has no safe-area insets: the insets go through the formula as 0 here, s_layout has the rest.
  const L = {};
  for (const [name, w, h] of [['393x852', 393, 852], ['393x659', 393, 659], ['320x568', 320, 568], ['852x393', 852, 393]])
    for (const swap of [false, true]) {
      const key = `${name}${swap ? '-swap' : ''}`;
      const init = `(() => { localStorage.setItem('strugglebus.controls.v1', JSON.stringify({ swap: ${swap}, taught: 31 })); ${ios('granted', true)} })()`;
      const page = await open(Q + '&controls=tilt', init, base, { viewport: { width: w, height: h } });
      const cdp = await page.context().newCDPSession(page);
      await runFor(page, 0.5);
      await enterTilt(page, cdp);
      await page.evaluate(() => { window.__game.input.onTurbo(1); });
      await runFor(page, 0.4);
      const rows = await page.evaluate(() => {
        const H = window.__game.controls.hud, L = H.L, out = {};
        for (const [q, k] of [['tilt-toggle', 'toggle'], ['turbo', 'turbo'], ['gear-down', 'down'], ['mega', 'mega'], ['recenter', 'recenter'], ['settings', 'settings']]) {
          const el = document.querySelector(`[data-hud="${q}"]`);
          const r = el.getBoundingClientRect();
          const want = L[k].hit;
          out[k] = { ok: r.left === want.x && r.top === want.y && r.width === want.w && r.height === want.h, got: [r.left, r.top, r.width, r.height], want: [want.x, want.y, want.w, want.h], shown: getComputedStyle(el).display };
          const c = el.querySelector('canvas').getBoundingClientRect();
          out[k].visual = [c.left, c.top, c.width, c.height];
          out[k].wantV = [L[k].v.x, L[k].v.y, L[k].v.w, L[k].v.h];
        }
        return out;
      });
      const bad = Object.entries(rows).filter(([, r]) => !r.ok || r.shown === 'none').map(([k]) => k);
      L[key] = { bad, rows };
      await page.screenshot({ path: `${out}/layout-${key}.png` });
      console.log('layout', key, bad.length ? `MISMATCH ${bad}` : 'all rects match', JSON.stringify(rows.mega));
      // the meter charging, on the same frame
      await page.evaluate(() => window.__game.forceReady());
      const mg = await rectOf(page, '[data-hud="mega"]');
      await touch(page, cdp, [{ type: 'touchStart', x: mg.x, y: mg.y }]);
      await runFor(page, 1);
      await page.screenshot({ path: `${out}/layout-${key}-charge.png` });
      L[key].meter = await page.evaluate(() => { const r = document.querySelector('[data-slot="super"]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
      await touch(page, cdp, [{ type: 'touchEnd' }]);
      await page.close();
    }
  res.layout = L;
}

if (modes.has('states')) {
  // every button state, cropped: a contact sheet is made of these by tools/hud-sheet.py
  mkdirSync(`${out}/states`, { recursive: true });
  const page = await open(Q + '&controls=tilt', ios('granted', true));
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => { window.__game.audio.unlock(); window.__game.forceReady(); });
  const crop = async (name, sel, pad = 14) => {
    const r = await page.evaluate((s) => { const el = document.querySelector(s); const b = (el.querySelector('canvas') ?? el).getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; }, sel);
    const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: r.height + pad * 2 };
    await page.screenshot({ path: `${out}/states/${name}.png`, clip });
  };
  const T = '[data-hud="turbo"]', M = '[data-hud="mega"]', Tg = '[data-hud="tilt-toggle"]', D = '[data-hud="gear-down"]';
  const freeze = () => page.evaluate(() => (window.__qa = { holdFrames: 0 }));
  const thaw = () => page.evaluate(() => (window.__qa = null));
  await runFor(page, 0.4);
  await crop('toggle-unasked', Tg);
  await crop('turbo-g0', T);
  await crop('mega-ready', M);
  await page.screenshot({ path: `${out}/full-unasked.png` });
  // the chip (?controls=tilt)
  await new Promise((r) => setTimeout(r, 320));
  await runFor(page, 0.05);
  await crop('chip', '[data-hud="tilt-chip"]', 24);
  // toggle: busy (held in calibration by a phone that never settles... a sensor that hasn't started)
  await page.evaluate(() => { window.__sensor.hold = true; });
  const tg = await rectOf(page, Tg);
  await touch(page, cdp, [{ type: 'touchStart', x: tg.x, y: tg.y, wait: 40 }]);
  await runFor(page, 0.05);
  await crop('toggle-pressed', Tg);
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await runFor(page, 0.1);
  await crop('toggle-busy', Tg);
  await page.evaluate(() => { window.__sensor.hold = false; });
  await page.waitForFunction(() => window.__game.controls.tilt.active, null, { timeout: 30000 });
  await runFor(page, 0.8);
  await crop('toggle-on', Tg);
  await page.screenshot({ path: `${out}/full-on.png` });
  await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 600, wait: 30 }, { type: 'touchMove', x: 160, y: 600, wait: 30 }]);
  await runFor(page, 0.2);
  await crop('toggle-clutched', Tg);
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await runFor(page, 0.8);
  // TURBO
  const tb = await rectOf(page, T);
  await touch(page, cdp, [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 60 }]);
  await runFor(page, 0.05);
  await crop('turbo-pressed', T);
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await runFor(page, 0.6);
  await crop('turbo-lifting', T);
  await crop('down', D, 8);
  const dn = await rectOf(page, D);
  await page.screenshot({ path: `${out}/full-lifting.png` });
  await until(page, 'g.controls.turbo.engaged', 12);
  await runFor(page, 0.3);
  await crop('turbo-engaged', T);
  await touch(page, cdp, [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 80 }, { type: 'touchEnd' }]);
  await runFor(page, 0.05);
  await crop('turbo-locked', T);
  await page.screenshot({ path: `${out}/full-locked.png` });
  await touch(page, cdp, [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 450 }]);
  await runFor(page, 0.3);
  await crop('turbo-boost', T);
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await touch(page, cdp, [{ type: 'touchStart', x: dn.x, y: dn.y, wait: 40 }]);
  await runFor(page, 0.05);
  await crop('down-pressed', D, 8);
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await runFor(page, 3);
  // MEGA
  await page.evaluate(() => { window.__game.flight.y = window.__game.flight.y; window.__game.forceReady(); });
  const mg = await rectOf(page, M);
  await touch(page, cdp, [{ type: 'touchStart', x: mg.x, y: mg.y, wait: 30 }]);
  await crop('mega-pressed', M);
  await runFor(page, 2);
  await crop('mega-charging', M);
  await crop('meter-charging', '[data-slot="super"]');
  await page.screenshot({ path: `${out}/full-charging.png` });
  await runFor(page, 8.3);
  await crop('mega-firehose', M);
  await crop('meter-firehose', '[data-slot="super"]');
  await page.screenshot({ path: `${out}/full-firehose.png` });
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await until(page, 'g.superState().phase === "cooldown"', 12);
  await runFor(page, 1);
  await crop('mega-cooldown', M, 20);
  await page.screenshot({ path: `${out}/full-cooldown.png` });
  await touch(page, cdp, [{ type: 'touchStart', x: mg.x, y: mg.y }]);
  await runFor(page, 0.5);
  await crop('mega-notyet', M, 20);
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await runFor(page, 0.2);
  // ready again, and the rest
  await page.evaluate(() => window.__game.superSkip(60));
  await runFor(page, 0.25);
  await crop('mega-readyagain', M, 20);
  await page.evaluate(() => window.__game.controls.hud.turboCue());
  await new Promise((r) => setTimeout(r, 9000));
  await runFor(page, 0.1);
  await crop('turbo-rest', T);
  await crop('mega-rest', M);
  await page.screenshot({ path: `${out}/full-rest.png` });
  // HOLD on the face
  await page.evaluate(() => window.__game.controls.hud.megaHoldCue());
  await runFor(page, 0.1);
  await crop('mega-hold', M);
  // off and refused
  await touch(page, cdp, [{ type: 'touchStart', x: tg.x, y: tg.y, wait: 40 }, { type: 'touchEnd' }]);
  await new Promise((r) => setTimeout(r, 400));
  await runFor(page, 0.2);
  await crop('toggle-off', Tg);
  await page.screenshot({ path: `${out}/full-off.png` });
  void freeze; void thaw;
  await page.close();
  const pr = await open(Q, ios('denied', false));
  const c2 = await pr.context().newCDPSession(pr);
  const t2 = await rectOf(pr, Tg);
  await touch(pr, c2, [{ type: 'touchStart', x: t2.x, y: t2.y, wait: 40 }, { type: 'touchEnd' }]);
  await new Promise((r) => setTimeout(r, 300));
  await runFor(pr, 0.2);
  const r = await pr.evaluate((s) => { const b = document.querySelector(s).querySelector('canvas').getBoundingClientRect(); return { x: b.left - 14, y: b.top - 14, width: b.width + 28, height: b.height + 28 }; }, Tg);
  await pr.screenshot({ path: `${out}/states/toggle-refused.png`, clip: { ...r, x: Math.max(0, r.x), y: Math.max(0, r.y) } });
  await pr.close();
}

if (modes.has('flows')) {
  // every way into tilt, end to end in the real page (synthetic sensors, real CDP touches)
  const F = {};
  const tapToggle = async (page, cdp) => {
    const r = await rectOf(page, '[data-hud="tilt-toggle"]');
    await touch(page, cdp, [{ type: 'touchStart', x: r.x, y: r.y, wait: 60 }, { type: 'touchEnd' }]);
  };
  const settle = async (page, s = 0.4) => {
    await new Promise((r) => setTimeout(r, 1300)); // (past the sensor timeout, in real time)
    await runFor(page, s);
  };
  const panelOpen = (page) => page.evaluate(() => !!document.querySelector('[data-hud="panel"]'));
  const openSettings = async (page) => {
    // (the buttons may have faded out: a first tap brings them back)
    const st = await rectOf(page, '[data-hud="settings"]');
    await page.touchscreen.tap(st.x, st.y);
    await runFor(page, 0.2);
    if (!(await panelOpen(page))) {
      await page.touchscreen.tap(st.x, st.y);
      await runFor(page, 0.2);
    }
  };
  const pick = (s) => ({ status: s.tilt.status, tiltState: s.hud.tiltState, tilt: s.prefs.tilt, chip: s.hud.chip });
  // ---- iOS: refused, then refused again
  {
    const page = await open(Q, ios('denied', false));
    const cdp = await page.context().newCDPSession(page);
    const s0 = await snap(page);
    await tapToggle(page, cdp);
    await settle(page, 0.2);
    await page.screenshot({ path: `${out}/flow-denied-toast.png` });
    const s1 = await snap(page);
    await tapToggle(page, cdp);
    await settle(page, 0.2);
    await page.screenshot({ path: `${out}/flow-denied-again.png` });
    const s2 = await snap(page);
    const sensor = await page.evaluate(() => window.__sensor);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 400000 });
    const s3 = await snap(page);
    F.iosDenied = { before: pick(s0), afterTap: pick(s1), again: pick(s2), asked: sensor.asked, askedIn: sensor.askedIn, reload: pick(s3) };
    console.log('iosDenied', JSON.stringify(F.iosDenied));
    await page.close();
  }
  // ---- iOS: requestPermission throws / rejects: blocked, not an answer
  for (const [name, answer] of [['iosThrows', 'throw'], ['iosRejects', 'reject']]) {
    const page = await open(Q, ios(answer, false));
    const cdp = await page.context().newCDPSession(page);
    await tapToggle(page, cdp);
    await settle(page, 0.1);
    const s1 = await snap(page);
    await tapToggle(page, cdp);
    await settle(page, 0.1);
    await page.screenshot({ path: `${out}/flow-${name}.png` });
    const s2 = await snap(page);
    F[name] = { first: pick(s1), second: pick(s2), asked: await page.evaluate(() => window.__sensor.asked) };
    console.log(name, JSON.stringify(F[name]));
    await page.close();
  }
  // ---- iOS: granted but silent (an iframe): the toggle goes, no error, session only
  {
    const page = await open(Q, ios('granted', false));
    const cdp = await page.context().newCDPSession(page);
    await tapToggle(page, cdp);
    await settle(page);
    await new Promise((r) => setTimeout(r, 400));
    await runFor(page, 0.1);
    const s = await snap(page);
    await page.screenshot({ path: `${out}/flow-silent.png` });
    await openSettings(page);
    await page.screenshot({ path: `${out}/flow-silent-settings.png` });
    F.iosSilent = { ...pick(s), sessionFlag: await page.evaluate(() => sessionStorage.getItem('strugglebus.notilt')), toggleShown: await page.evaluate(() => getComputedStyle(document.querySelector('[data-hud="tilt-toggle"]')).display) };
    console.log('iosSilent', JSON.stringify(F.iosSilent));
    await page.close();
  }
  // ---- on, settings for 2 s, closed: still on; off; back on inside the fade; a Busy tap cancels
  {
    const page = await open(Q, ios('granted', true));
    const cdp = await page.context().newCDPSession(page);
    await enterTilt(page, cdp);
    await runFor(page, 0.8);
    await openSettings(page);
    await page.screenshot({ path: `${out}/flow-tilt-settings.png` });
    await new Promise((r) => setTimeout(r, 2000));
    const during = await snap(page);
    const close = await rectOf(page, '[data-hud="close"]');
    await page.touchscreen.tap(close.x, close.y);
    await new Promise((r) => setTimeout(r, 900));
    await runFor(page, 0.2);
    const after = await snap(page);
    await tapToggle(page, cdp);
    await runFor(page, 0.05);
    const pending = await snap(page);
    await tapToggle(page, cdp);
    await new Promise((r) => setTimeout(r, 600));
    await runFor(page, 0.1);
    const back = await snap(page);
    await tapToggle(page, cdp);
    await new Promise((r) => setTimeout(r, 600));
    await runFor(page, 0.2);
    const off = await snap(page);
    const pref = await page.evaluate(() => localStorage.getItem('strugglebus.controls.v1'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 400000 });
    await runFor(page, 0.2);
    const reload = await snap(page);
    F.onOff = { during: { active: during.tilt.active, state: during.hud.tiltState, g: during.mix.g }, after: { active: after.tilt.active, state: after.hud.tiltState, g: after.mix.g }, pending: { state: pending.hud.tiltState, active: pending.tilt.active }, backOn: { active: back.tilt.active, g: back.mix.g, pending: back.mix.offPending, samples: back.tilt.samples }, off: { status: off.tilt.status, state: off.hud.tiltState }, pref, reload: pick(reload) };
    console.log('onOff', JSON.stringify(F.onOff));
    await page.close();
  }
  {
    // a Busy tap: the sensor is held silent past the tap, a second tap cancels to undecided
    const page = await open(Q, ios('granted', true));
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => (window.__sensor.hold = true));
    await tapToggle(page, cdp);
    await new Promise((r) => setTimeout(r, 200));
    await runFor(page, 0.05);
    const busy = await snap(page);
    await tapToggle(page, cdp);
    await new Promise((r) => setTimeout(r, 200));
    await runFor(page, 0.05);
    F.busy = { busy: pick(busy), cancelled: pick(await snap(page)) };
    console.log('busy', JSON.stringify(F.busy));
    await page.close();
  }
  // ---- Android: no permission API, the sensor flows from the start: the quiet probe; no sensor: no toggle
  {
    const init = `(() => {
      setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 55, gamma: 0, absolute: false })), 16);
    })()`;
    const page = await open(Q, init);
    const cdp = await page.context().newCDPSession(page);
    await new Promise((r) => setTimeout(r, 1200));
    await runFor(page, 0.2);
    const s0 = await snap(page);
    await tapToggle(page, cdp);
    await new Promise((r) => setTimeout(r, 900));
    await runFor(page, 0.3);
    const s1 = await snap(page);
    // the top-right buttons fade out, a tap in that corner only brings them back, the next one works
    const op = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-hud="settings"]').parentElement).opacity);
    const shown = await op();
    await new Promise((r) => setTimeout(r, 6800));
    await runFor(page, 0.1);
    const faded = await op();
    await page.screenshot({ path: `${out}/flow-tilt-faded.png` });
    const st = await rectOf(page, '[data-hud="settings"]');
    await events(page);
    await page.touchscreen.tap(st.x, st.y);
    await new Promise((r) => setTimeout(r, 500));
    await runFor(page, 0.1);
    const woke = { opacity: await op(), panel: await panelOpen(page), splats: (await events(page)).length };
    await page.touchscreen.tap(st.x, st.y);
    await runFor(page, 0.2);
    const second = await panelOpen(page);
    F.android = { probed: pick(s0), afterTap: pick(s1), chrome: { shown, faded, woke, secondTapOpens: second } };
    console.log('android', JSON.stringify(F.android));
    await page.close();
    const p2 = await open(Q, null);
    await new Promise((r) => setTimeout(r, 1300));
    await runFor(p2, 0.2);
    F.noSensor = { ...pick(await snap(p2)), toggle: await p2.evaluate(() => getComputedStyle(document.querySelector('[data-hud="tilt-toggle"]')).display), sessionFlag: await p2.evaluate(() => sessionStorage.getItem('strugglebus.notilt')) };
    await p2.screenshot({ path: `${out}/flow-no-sensor.png` });
    console.log('noSensor', JSON.stringify(F.noSensor));
    await p2.close();
  }
  // ---- a desktop: keyboard, no chrome, Esc for settings
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(base + Q, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 400000 });
    await page.evaluate(() => {
      const g = window.__game, inp = g.input;
      window.__ev = [];
      for (const k of ['onTap', 'onChargeStart', 'onChargeEnd', 'onTurbo']) {
        const orig = inp[k];
        inp[k] = (...a) => {
          window.__ev.push({ k, a, t: +g.clock().toFixed(2) });
          return orig?.(...a);
        };
      }
      g.forceReady();
    });
    const s0 = await snap(page);
    const cog = await page.evaluate(() => getComputedStyle(document.querySelector('[data-hud="settings"]').parentElement).display);
    const buttons = await page.evaluate(() => ['turbo', 'mega', 'tilt-toggle'].map((q) => getComputedStyle(document.querySelector(`[data-hud="${q}"]`)).display));
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
    await new Promise((r) => setTimeout(r, 80));
    await page.keyboard.up('Space');
    await runFor(page, 0.2);
    const tap = await events(page);
    await page.keyboard.down('Space');
    await runFor(page, 0.8);
    const held = (await snap(page)).input.chargeHeld;
    await page.keyboard.up('Space');
    await runFor(page, 0.2);
    const hold = await events(page);
    await page.keyboard.press('KeyE');
    await runFor(page, 0.2);
    const gear1 = (await snap(page)).turbo.gear;
    await page.keyboard.press('KeyQ');
    await runFor(page, 0.2);
    const gear0 = (await snap(page)).turbo.gear;
    await page.keyboard.down('ShiftLeft');
    await runFor(page, 0.2);
    const boost = (await snap(page)).input.turboHeld;
    await page.keyboard.up('ShiftLeft');
    await runFor(page, 0.2);
    const boostOff = (await snap(page)).input.turboHeld;
    F.keyboard = { mode: s0.mode, cog, buttons, escOpens: open1, escCloses: !open2, tap, hold, heldWhileDown: held, gear1, gear0, boost, boostOff };
    console.log('keyboard', JSON.stringify(F.keyboard));
    await page.close();
  }
  res.flows = F;
}

if (modes.has('opening')) {
  mkdirSync(`${out}/opening`, { recursive: true });
  const R = {};
  const first = async (init) => {
    const page = await open('?fixeddt=0.05', init ?? ios('granted', true), base, { ready: 'window.__game && window.__game.city.loadedRegionCount() > 0' });
    const cdp = await page.context().newCDPSession(page);
    return { page, cdp };
  };
  const state = (page) => page.evaluate(() => {
    const g = window.__game, f = g.flight, c = g.controls;
    return { clock: +g.clock().toFixed(2), mode: c.mode, status: c.tilt.status, sheet: c.sheetUp, locked: c.gearsLocked, gear: c.turbo.gear, y: +f.y.toFixed(1), speed: +f.speed.toFixed(0), low: +g.rig.openingLow.toFixed(2) };
  });
  const log = (page, s) => page.evaluate((s) => new Promise((done) => {
    const g = window.__game, f = g.flight, c = g.controls, l = [], t0 = g.clock();
    let nf = 0;
    const tick = () => {
      if (nf++ % 10 === 0) l.push([+(g.clock() - t0).toFixed(1), Math.round(f.x), Math.round(f.z), +f.y.toFixed(1), +f.speed.toFixed(0), c.turbo.gear, c.gearsLocked ? 1 : 0, +g.rig.openingLow.toFixed(2), Math.round(g.camera.position.y)]);
      if (g.clock() - t0 >= s) done(l); else requestAnimationFrame(tick);
    };
    tick();
  }), s);
  // ---- no card, no hold: the opening just runs
  {
    const { page } = await first();
    const a = await state(page);
    await runFor(page, 2);
    const b = await state(page);
    const shots = [];
    let prev = 2;
    for (const t of [4, 8, 12, 16, 20]) {
      await runFor(page, t - prev);
      prev = t;
      await page.screenshot({ path: `${out}/opening/t${String(t).padStart(2, '0')}.png` });
      shots.push({ t, ...(await state(page)) });
    }
    R.free = { a, b, shots };
    console.log('opening free', JSON.stringify({ a, b }));
    for (const s of shots) console.log(' ', JSON.stringify(s));
    await page.close();
  }
  // ---- TURBO in the opening: ARMED, under the deck first, then the gear; the tab cancels
  {
    const { page, cdp } = await first();
    await until(page, '!g.controls.opening', 60);
    await runFor(page, 0.3);
    const tb = await rectOf(page, '[data-hud="turbo"]');
    const locked0 = (await state(page)).locked;
    await touch(page, cdp, [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.3);
    await page.screenshot({ path: `${out}/opening/armed.png` });
    const armed = await snap(page);
    const dn = await rectOf(page, '[data-hud="gear-down"]');
    await touch(page, cdp, [{ type: 'touchStart', x: dn.x, y: dn.y, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.3);
    const cancelled = await snap(page);
    await touch(page, cdp, [{ type: 'touchStart', x: tb.x, y: tb.y, wait: 80 }, { type: 'touchEnd' }]);
    const l = await log(page, 40);
    R.armed = { locked0, armed: { gearDown: armed.hud.gearDown }, cancelled: { gearDown: cancelled.hud.gearDown }, log: l.filter((_, i) => i % 6 === 0) };
    console.log('armed', JSON.stringify(R.armed));
    await page.close();
  }
  // ---- the sheet holds the game; nothing may hang it
  for (const [name, answer, flow] of [['refused', 'denied', false], ['silent', 'granted', false]]) {
    const { page, cdp } = await first(ios(answer, flow));
    await until(page, '!g.controls.opening', 60);
    const r = await rectOf(page, '[data-hud="tilt-toggle"]');
    await touch(page, cdp, [{ type: 'touchStart', x: r.x, y: r.y, wait: 60 }, { type: 'touchEnd' }]);
    const t0 = (await state(page)).clock;
    await new Promise((res) => setTimeout(res, 2500));
    const s = await state(page);
    R[name] = { ...s, advanced: +(s.clock - t0).toFixed(1) };
    console.log(name, JSON.stringify(R[name]));
    await page.close();
  }
  {
    // the sheet up: dt = 0, at any time
    const { page, cdp } = await first(`(() => { ${ios('granted', true)}; const a = window.DeviceOrientationEvent.requestPermission; window.DeviceOrientationEvent.requestPermission = () => new Promise((res) => { window.__release = () => res(a()); }); })()`);
    await until(page, '!g.controls.opening', 60);
    const r = await rectOf(page, '[data-hud="tilt-toggle"]');
    await touch(page, cdp, [{ type: 'touchStart', x: r.x, y: r.y, wait: 60 }, { type: 'touchEnd' }]);
    await new Promise((res) => setTimeout(res, 200));
    const a = await state(page);
    await new Promise((res) => setTimeout(res, 1000));
    const b = await state(page);
    await page.evaluate(() => window.__release());
    await new Promise((res) => setTimeout(res, 800));
    const c = await state(page);
    R.sheet = { up: a.sheet, held: a.clock === b.clock, released: c.clock > b.clock };
    console.log('sheet', JSON.stringify(R.sheet));
    await page.close();
  }
  writeFileSync(`${out}/opening.json`, JSON.stringify(R, null, 1));
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
