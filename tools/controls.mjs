#!/usr/bin/env node
// Controls QA in the real game (index.html), iPhone portrait viewport, touch + mobile emulation.
//   node tools/controls.mjs <baseUrl> <outDir> [touch] [turbo] [tilt] [gestures] [flows] [perf=<otherBaseUrl>]
//
//   touch  the default page (Chromium: no motion sensor): the quiet probe falls back to touch;
//          shots of the touch HUD and the settings panel; real gestures on the HUD's splat button
//          (tap / hold / slide off) and turbo lever (tap up / hold to boost)        -> touch.json
//   turbo  (same page) the turbo lever shifts G0 -> G1 at Alamo Square: the climb to the gear's
//          height, engagement, the sonic boom, the jet over SF (shots + a per-frame log of speed,
//          altitude, camera, draws / triangles / CPU work), LOCKED (shot), the downshift -> turbo.json
//   tilt   an iOS-like page: DeviceOrientationEvent.requestPermission mocked ('granted') and a
//          synthetic 60 Hz sensor (a physical phone model: W3C beta / gamma with the spec's range
//          flips); the "TILT TO FLY" prompt (shot), its tap -> permission -> calibration -> tilt mode
//          (HUD shot), roll and pitch sweeps end to end (input.state.stretch -> Flight yaw rate,
//          bank, climb; a banked-turn shot), tilt-mode gestures through CDP touch events (tap, hold,
//          swipe up / down, swipe-and-hold boost), the recenter button                  -> tilt.json
//   gestures  the tap / hold / slide / swipe table in the real page (touch mode: the HUD's splat button
//          and turbo lever; tilt mode: the whole screen) with CDP touches dispatched while the game loop is
//          frozen (__qa.holdFrames = 0: frames are instant, so events arrive when they happen), the loop
//          running only through the holds                                               -> gestures in controls.json
//   flows  every way into a scheme, in the real page: iOS refused / throwing / granted but silent / "use touch
//          instead", settings retry, reload in the same tab, the Android quiet probe, the top-right buttons'
//          fade and wake, the super slot's geometry, and a desktop's keyboard + Esc (shots)  -> flows in controls.json
//   perf=<otherBaseUrl>  CPU work ms, draw calls, triangles at the same Alamo Square view (cruising at the
//          floor, the fps meter's per-frame counters) for <otherBaseUrl> (e.g. the build before) and
//          <baseUrl>, in one browser session                                              -> perf in controls.json
// Launches through tools/browser.mjs (the GPU here, SwiftShader in the cloud): everything waits on the game
// clock (fixed 1/20 s steps), never wall time.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const [base = 'http://127.0.0.1:5101/', out = 'shots/controls', ...rest] = process.argv.slice(2);
const modes = new Set((rest.length ? rest : ['touch', 'turbo', 'tilt']).map((m) => m.split('=')[0]));
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

async function open(query, init, at = base) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  // (recent Chromium desktop builds expose requestPermission too: a page that doesn't mock it is a phone with no such API)
  await page.addInitScript(() => {
    if (window.DeviceOrientationEvent) window.DeviceOrientationEvent.requestPermission = undefined;
  });
  if (init) await page.addInitScript(init);
  await page.goto(at + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 400000 });
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
  const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro&fixeddt=0.05');
  const cdp = await page.context().newCDPSession(page);
  const s0 = await snap(page);
  const noTilt = await page.evaluate(() => sessionStorage.getItem('strugglebus.notilt'));
  res.fallback = { mode: s0.mode, tiltStatus: s0.tilt.status, prompt: s0.hud.prompt, sessionFlag: noTilt };
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
    // splat button: tap, hold 1.4 s, hold 0.8 s then slide off
    const sb = await rectOf(page, '[data-hud="splat"]');
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
    // lever: tap the top (shift up), tap the bottom (down), hold (boost)
    const lv = await rectOf(page, '[data-hud="lever"]');
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.top + 10, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const upEv = await events(page);
    const gearAfterUp = (await snap(page)).turbo.gear;
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.bottom - 10, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const downEv = await events(page);
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.y, wait: 900 }]);
    await runFor(page, 0.3);
    const boosting = (await snap(page)).input.turboHeld;
    await touch(page, cdp, [{ type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const afterBoost = (await snap(page)).input.turboHeld;
    res.touch = { panelOpen, splatTap: tapEv, splatHold: holdEv, splatSlideOff: slideEv, leverUp: upEv, gearAfterUp, leverDown: downEv, leverHoldBoost: boosting, boostAfterRelease: afterBoost };
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
    const lv = await rectOf(page, '[data-hud="lever"]');
    await events(page);
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.top + 10, wait: 80 }, { type: 'touchEnd' }]);
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
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.top + 10, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const lockMiss = !(await page.evaluate(() => window.__ev.some((e) => e.k === 'onTurbo' && e.a[0] === 1 && window.__game.controls.turbo.time - window.__game.controls.turbo.lockedAt < 1)));
    if (lockMiss) await page.evaluate(() => window.__game.input.onTurbo(1));
    await runFor(page, 0.2);
    await page.screenshot({ path: `${out}/g1-locked.png` });
    // drop back to G0
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.bottom - 10, wait: 80 }, { type: 'touchEnd' }]);
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
  const init = () => {
    window.__sensor = { beta: 55, gamma: 0, alpha: 0, on: false, sent: 0 };
    const D = window.DeviceOrientationEvent;
    D.requestPermission = () => {
      window.__sensor.asked = (window.__sensor.asked || 0) + 1;
      window.__sensor.askedIn = window.event ? window.event.type : 'no event'; // (must be a touchend)
      window.__sensor.on = true;
      return Promise.resolve('granted');
    };
    setInterval(() => {
      const s = window.__sensor;
      if (!s.on) return;
      s.sent++;
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: s.alpha, beta: s.beta, gamma: s.gamma, absolute: false }));
    }, 16);
  };
  const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro&fixeddt=0.05', init);
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
    const rms = [];
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
    const d0 = buf.getChannelData(0);
    for (let s = 0; s < secs; s++) {
      let e = 0;
      for (let i = s * sr; i < (s + 1) * sr; i++) e += d0[i] * d0[i];
      rms.push(+Math.sqrt(e / sr).toFixed(3));
    }
    return { peak: +peak.toFixed(3), nan, over099: over, rmsPerSecond: rms };
  });
  console.log('audio (turbo voice, offline):', JSON.stringify(res.audio));
  const setPose = (p) => page.evaluate((e) => Object.assign(window.__sensor, e), w3cFor(p));
  await setPose({ lean: 35 });
  const s0 = await snap(page);
  await page.evaluate(() => (window.__game.flight.glideSpeed = 19.2));
  await runFor(page, 0.5);
  await page.screenshot({ path: `${out}/prompt.png` });
  // the tap: permission (inside the gesture), events, calibration, tilt mode
  await touch(page, cdp, [{ type: 'touchStart', x: 196, y: 380, wait: 60 }, { type: 'touchEnd' }]);
  await page.waitForFunction(() => window.__game.controls.snapshot().mode === 'tilt', null, { timeout: 60000 });
  const s1 = await snap(page);
  const asked = await page.evaluate(() => ({ count: window.__sensor.asked, inEvent: window.__sensor.askedIn }));
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
  // ---- tilt-mode gestures (CDP touches: real pointer + touch events)
  await setPose({ lean: 35 });
  await page.evaluate(() => window.__game.forceReady());
  await runFor(page, 0.3);
  await events(page);
  const G = {};
  await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 520, wait: 90 }, { type: 'touchEnd' }]);
  await runFor(page, 0.3);
  G.tap = await events(page);
  await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 520, wait: 1500 }, { type: 'touchEnd' }]);
  await runFor(page, 0.3);
  G.hold = await events(page);
  await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 560, wait: 30 }, { type: 'touchMove', x: 202, y: 535, wait: 30 }, { type: 'touchMove', x: 204, y: 505, wait: 30 }, { type: 'touchMove', x: 205, y: 480 }]);
  await runFor(page, 0.4);
  const boostHeld = (await snap(page)).input.turboHeld;
  await touch(page, cdp, [{ type: 'touchEnd' }]);
  await runFor(page, 0.3);
  G.swipeUpHold = { events: await events(page), turboHeldWhileDown: boostHeld, gear: (await snap(page)).turbo.gear };
  await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 480, wait: 30 }, { type: 'touchMove', x: 199, y: 510, wait: 30 }, { type: 'touchMove', x: 198, y: 545, wait: 30 }, { type: 'touchEnd' }]);
  await runFor(page, 0.3);
  G.swipeDown = { events: await events(page), gear: (await snap(page)).turbo.gear };
  await touch(page, cdp, [{ type: 'touchStart', x: 200, y: 520, wait: 300 }, { type: 'touchMove', x: 270, y: 530, wait: 50 }, { type: 'touchEnd' }]);
  await runFor(page, 0.3);
  G.slowSideDrag = await events(page);
  // recenter: hold a 10 deg pitch, press recenter, the stick goes back to 0
  await setPose({ lean: 35, pitch: 10 });
  await new Promise((r) => setTimeout(r, 150));
  await runFor(page, 0.3);
  const before = (await snap(page)).tilt.sy;
  const rc = await rectOf(page, '[data-hud="recenter"]');
  await page.touchscreen.tap(rc.x, rc.y); // (the buttons have faded out: this one brings them back)
  await new Promise((r) => setTimeout(r, 450));
  await page.touchscreen.tap(rc.x, rc.y);
  await new Promise((r) => setTimeout(r, 500));
  await runFor(page, 0.3);
  const after = (await snap(page)).tilt.sy;
  res.tilt = { before: s0, promptShown: s0.hud.prompt, permissionAsked: asked, after: s1, roll, pitch, upright, gestures: G, recenter: { syBefore: before, syAfter: after } };
  console.log('tilt prompt / permission:', JSON.stringify({ promptShown: s0.hud.prompt, modeBefore: s0.mode, asked, modeAfter: s1.mode, status: s1.tilt.status }));
  console.log('roll:', JSON.stringify(roll));
  console.log('pitch:', JSON.stringify(pitch));
  console.log('upright:', JSON.stringify(upright));
  console.log('gestures:', JSON.stringify(G));
  console.log('recenter:', JSON.stringify(res.tilt.recenter));
  await page.close();
}

if (modes.has('gestures')) {
  const G = {};
  // ---- touch mode (no sensor): the HUD's splat button and turbo lever
  {
    const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro&fixeddt=0.05');
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => window.__game.forceReady());
    const sb = await rectOf(page, '[data-hud="splat"]');
    const lv = await rectOf(page, '[data-hud="lever"]');
    const row = async (name, steps, extra) => {
      await events(page);
      await gesture(page, cdp, steps);
      const r = { events: await events(page) };
      if (extra) Object.assign(r, await extra());
      G[`touch: ${name}`] = r;
      console.log('gesture', `touch: ${name}`, JSON.stringify(r));
    };
    const gear = async () => ({ gear: (await snap(page)).turbo.gear });
    await row('splat button tap (90 ms)', [{ type: 'touchStart', x: sb.x, y: sb.y, wait: 90 }, { type: 'touchEnd' }]);
    await row('splat button 250 ms (under holdThreshold)', [{ type: 'touchStart', x: sb.x, y: sb.y, wait: 250 }, { type: 'touchEnd' }]);
    await row('splat button hold (1.5 s of game time)', [{ type: 'touchStart', x: sb.x, y: sb.y }, { run: 1.5 }, { type: 'touchEnd' }]);
    await row('splat button hold then slide off', [{ type: 'touchStart', x: sb.x, y: sb.y }, { run: 1.0 }, { type: 'touchMove', x: sb.x - 110, y: sb.y - 50, wait: 30 }, { type: 'touchEnd' }]);
    await row('splat button 150 ms then slide off (nothing)', [{ type: 'touchStart', x: sb.x, y: sb.y, wait: 150 }, { type: 'touchMove', x: sb.x - 110, y: sb.y - 50, wait: 30 }, { type: 'touchEnd' }]);
    await row('lever tap top (shift up)', [{ type: 'touchStart', x: lv.x, y: lv.top + 10, wait: 80 }, { type: 'touchEnd' }], gear);
    await row('lever tap top again (LOCKED)', [{ type: 'touchStart', x: lv.x, y: lv.top + 10, wait: 80 }, { type: 'touchEnd' }], gear);
    await row('lever tap bottom (shift down)', [{ type: 'touchStart', x: lv.x, y: lv.bottom - 10, wait: 80 }, { type: 'touchEnd' }], gear);
    await row('lever swipe up', [{ type: 'touchStart', x: lv.x, y: lv.y + 20, wait: 20 }, { type: 'touchMove', x: lv.x, y: lv.y - 10, wait: 20 }, { type: 'touchMove', x: lv.x, y: lv.y - 30, wait: 20 }, { type: 'touchEnd' }], gear);
    await row('lever swipe down', [{ type: 'touchStart', x: lv.x, y: lv.y - 20, wait: 20 }, { type: 'touchMove', x: lv.x, y: lv.y + 10, wait: 20 }, { type: 'touchMove', x: lv.x, y: lv.y + 30, wait: 20 }, { type: 'touchEnd' }], gear);
    await row('lever hold (boost)', [{ type: 'touchStart', x: lv.x, y: lv.y, wait: 450 }, { run: 0.6 }], async () => ({ turboHeldWhileDown: (await snap(page)).input.turboHeld }));
    await gesture(page, cdp, [{ type: 'touchEnd' }]);
    G['touch: lever released'] = { turboHeld: (await snap(page)).input.turboHeld };
    await row('canvas quick tap (bungee, 100 ms)', [{ type: 'touchStart', x: 150, y: 500, wait: 100 }, { type: 'touchEnd' }]);
    await row('canvas drag 80 px (steer, no tap)', [{ type: 'touchStart', x: 150, y: 500, wait: 20 }, { type: 'touchMove', x: 190, y: 500, wait: 20 }, { type: 'touchMove', x: 230, y: 500 }, { run: 0.5 }, { type: 'touchEnd' }]);
    await page.close();
  }
  // ---- tilt mode (the iOS-like page): the whole screen
  {
    const init = () => {
      window.__sensor = { beta: 55, gamma: 0, alpha: 0, on: false };
      window.DeviceOrientationEvent.requestPermission = () => ((window.__sensor.on = true), Promise.resolve('granted'));
      setInterval(() => {
        const s = window.__sensor;
        if (s.on) window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: s.beta, gamma: s.gamma, absolute: false }));
      }, 16);
    };
    const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro&fixeddt=0.05', init);
    const cdp = await page.context().newCDPSession(page);
    await gesture(page, cdp, [{ type: 'touchStart', x: 196, y: 380, wait: 60 }, { type: 'touchEnd' }]);
    await page.waitForFunction(() => window.__game.controls.snapshot().mode === 'tilt', null, { timeout: 60000 });
    await page.evaluate(() => window.__game.forceReady());
    const row = async (name, steps, extra) => {
      await events(page);
      await gesture(page, cdp, steps);
      const r = { events: await events(page) };
      if (extra) Object.assign(r, await extra());
      G[`tilt: ${name}`] = r;
      console.log('gesture', `tilt: ${name}`, JSON.stringify(r));
    };
    const X = 200, Y = 520;
    await row('tap (90 ms)', [{ type: 'touchStart', x: X, y: Y, wait: 90 }, { type: 'touchEnd' }]);
    await row('250 ms (under holdThreshold)', [{ type: 'touchStart', x: X, y: Y, wait: 250 }, { type: 'touchEnd' }]);
    await row('hold (1.5 s of game time)', [{ type: 'touchStart', x: X, y: Y }, { run: 1.5 }, { type: 'touchEnd' }], async () => ({ chargeHeldAfter: (await snap(page)).input.chargeHeld }));
    await row('hold with an 8 px wobble', [{ type: 'touchStart', x: X, y: Y }, { run: 0.6 }, { type: 'touchMove', x: X + 8, y: Y + 3, wait: 20 }, { run: 0.6 }, { type: 'touchMove', x: X - 5, y: Y - 2, wait: 20 }, { type: 'touchEnd' }]);
    await row('hold then slide 70 px (cancelled)', [{ type: 'touchStart', x: X, y: Y }, { run: 1.0 }, { type: 'touchMove', x: X + 40, y: Y, wait: 20 }, { type: 'touchMove', x: X + 70, y: Y, wait: 20 }, { type: 'touchEnd' }]);
    await row('swipe up and lift', [{ type: 'touchStart', x: X, y: Y + 40, wait: 20 }, { type: 'touchMove', x: X + 2, y: Y + 10, wait: 20 }, { type: 'touchMove', x: X + 4, y: Y - 20, wait: 20 }, { type: 'touchMove', x: X + 5, y: Y - 40, wait: 20 }, { type: 'touchEnd' }], async () => ({ gear: (await snap(page)).turbo.gear }));
    await row('swipe down', [{ type: 'touchStart', x: X, y: Y - 40, wait: 20 }, { type: 'touchMove', x: X, y: Y - 10, wait: 20 }, { type: 'touchMove', x: X, y: Y + 20, wait: 20 }, { type: 'touchMove', x: X, y: Y + 40, wait: 20 }, { type: 'touchEnd' }], async () => ({ gear: (await snap(page)).turbo.gear }));
    await row('swipe up and keep holding (boost)', [{ type: 'touchStart', x: X, y: Y + 40, wait: 20 }, { type: 'touchMove', x: X, y: Y + 10, wait: 20 }, { type: 'touchMove', x: X, y: Y - 20, wait: 20 }, { type: 'touchMove', x: X, y: Y - 40, wait: 20 }, { run: 0.5 }], async () => ({ turboHeldWhileDown: (await snap(page)).input.turboHeld, gear: (await snap(page)).turbo.gear }));
    await gesture(page, cdp, [{ type: 'touchEnd' }]);
    G['tilt: boost released'] = { turboHeld: (await snap(page)).input.turboHeld };
    await row('slow sideways drag 70 px (nothing)', [{ type: 'touchStart', x: X, y: Y, wait: 100 }, { type: 'touchMove', x: X + 35, y: Y + 4, wait: 200 }, { type: 'touchMove', x: X + 70, y: Y + 6, wait: 200 }, { type: 'touchEnd' }]);
    await page.close();
  }
  res.gestures = G;
}

if (modes.has('flows')) {
  // every way into a control scheme, end to end in the real page (synthetic sensors, real CDP touches)
  const Q = '?lat=37.77628&lon=-122.4352&heading=88&skipintro&fixeddt=0.05';
  const F = {};
  // an iOS-like page: `answer` is what requestPermission does; `flow`: the sensor starts once it is granted
  const ios = (answer, flow) => `(() => {
    window.__sensor = { beta: 55, gamma: 0, on: false, asked: 0, askedIn: [] };
    window.DeviceOrientationEvent.requestPermission = () => {
      const s = window.__sensor;
      s.asked++;
      s.askedIn.push(window.event ? window.event.type : 'no event');
      if (${JSON.stringify(answer)} === 'throw') throw new Error('NotAllowedError');
      if (${JSON.stringify(answer)} === 'granted' && ${flow}) s.on = true;
      return Promise.resolve(${JSON.stringify(answer)});
    };
    setInterval(() => {
      const s = window.__sensor;
      if (s.on) window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: s.beta, gamma: s.gamma, absolute: false }));
    }, 16);
  })()`;
  const tapCard = async (page, cdp) => {
    await touch(page, cdp, [{ type: 'touchStart', x: 196, y: 380, wait: 60 }, { type: 'touchEnd' }]);
  };
  const settle = async (page, s = 0.4) => {
    await new Promise((r) => setTimeout(r, 1300)); // (past the sensor timeout, in real time)
    await runFor(page, s);
  };
  const panelText = (page) => page.evaluate(() => !!document.querySelector('[data-hud="panel"]'));
  const openSettings = async (page) => {
    // (the buttons may have faded out: a first tap brings them back)
    const st = await rectOf(page, '[data-hud="settings"]');
    await page.touchscreen.tap(st.x, st.y);
    await runFor(page, 0.2);
    if (!(await panelText(page))) {
      await page.touchscreen.tap(st.x, st.y);
      await runFor(page, 0.2);
    }
  };
  // ---- iOS: refused
  {
    const page = await open(Q, ios('denied', false));
    const cdp = await page.context().newCDPSession(page);
    const s0 = await snap(page);
    await tapCard(page, cdp);
    await settle(page, 0.2);
    await page.screenshot({ path: `${out}/flow-denied-toast.png` });
    const s1 = await snap(page);
    await openSettings(page);
    await page.screenshot({ path: `${out}/flow-denied-settings.png` });
    // the TILT button goes back through the card (iOS's touchend), it doesn't call requestPermission from a pointerup
    const tiltBtn = await rectOf(page, '[data-hud="tilt"]');
    await page.touchscreen.tap(tiltBtn.x, tiltBtn.y);
    await runFor(page, 0.3);
    const s2 = await snap(page);
    const askedBefore = await page.evaluate(() => window.__sensor.asked);
    await tapCard(page, cdp);
    await settle(page, 0.2);
    const s3 = await snap(page);
    const sensor = await page.evaluate(() => window.__sensor);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 400000 });
    const s4 = await snap(page);
    F.iosDenied = { promptFirst: s0.hud.prompt, modeBefore: s0.mode, afterTap: { mode: s1.mode, status: s1.tilt.status }, settingsTilt: { prompt: s2.hud.prompt, settings: s2.hud.settings, askedBefore }, retry: { mode: s3.mode, status: s3.tilt.status }, asked: sensor.asked, askedIn: sensor.askedIn, reloadSameTab: { mode: s4.mode, prompt: s4.hud.prompt } };
    console.log('iosDenied', JSON.stringify(F.iosDenied));
    await page.close();
  }
  // ---- iOS: requestPermission throws (no gesture), granted but silent (an iframe), use touch instead, granted
  for (const [name, answer, flow] of [['iosThrows', 'throw', false], ['iosSilent', 'granted', false]]) {
    const page = await open(Q, ios(answer, flow));
    const cdp = await page.context().newCDPSession(page);
    await tapCard(page, cdp);
    await settle(page);
    const s = await snap(page);
    await openSettings(page);
    await page.screenshot({ path: `${out}/flow-${name}-settings.png` });
    F[name] = { mode: s.mode, status: s.tilt.status, sessionFlag: await page.evaluate(() => sessionStorage.getItem('strugglebus.notilt')), tiltButton: !!(await rectOf(page, '[data-hud="tilt"]')) };
    console.log(name, JSON.stringify(F[name]));
    await page.close();
  }
  {
    const page = await open(Q, ios('granted', true));
    const cdp = await page.context().newCDPSession(page);
    const alt = await rectOf(page, '[data-hud="prompt-touch"]');
    await touch(page, cdp, [{ type: 'touchStart', x: alt.x, y: alt.y, wait: 60 }, { type: 'touchEnd' }]);
    await runFor(page, 0.2);
    const s = await snap(page);
    const asked = await page.evaluate(() => window.__sensor.asked);
    const pref = await page.evaluate(() => localStorage.getItem('strugglebus.controls.v1'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 400000 });
    const s2 = await snap(page);
    F.iosUseTouch = { mode: s.mode, asked, pref, afterReload: { mode: s2.mode, prompt: s2.hud.prompt } };
    console.log('iosUseTouch', JSON.stringify(F.iosUseTouch));
    await page.close();
  }
  // ---- Android: no permission API, the sensor flows from the start: the quiet probe, then the card
  {
    const init = `(() => {
      setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 55, gamma: 0, absolute: false })), 16);
    })()`;
    const page = await open(Q, init);
    const cdp = await page.context().newCDPSession(page);
    await page.waitForFunction(() => window.__game.controls.snapshot().hud.prompt, null, { timeout: 30000 });
    const s0 = await snap(page);
    await tapCard(page, cdp);
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
    const woke = { opacity: await op(), panel: await panelText(page), splats: (await events(page)).length };
    await page.touchscreen.tap(st.x, st.y);
    await runFor(page, 0.2);
    const second = await panelText(page);
    await page.screenshot({ path: `${out}/flow-tilt-settings.png` });
    // the super splat's slot takes the meter's real size: centered, on screen
    const slot = await page.evaluate(() => {
      const s = document.querySelector('[data-slot="super"]');
      const m = document.createElement('div');
      m.style.cssText = 'width:68px;height:86px';
      s.append(m);
      const r = m.getBoundingClientRect();
      m.remove();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
    });
    F.android = { probed: { mode: s0.mode, status: s0.tilt.status, prompt: s0.hud.prompt }, afterTap: { mode: s1.mode, status: s1.tilt.status }, chrome: { shown, faded, woke, secondTapOpens: second }, superSlot: slot };
    console.log('android', JSON.stringify(F.android));
    await page.close();
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
    F.keyboard = { mode: s0.mode, cog, escOpens: open1, escCloses: !open2, tap, hold, heldWhileDown: held, gear1, gear0, boost, boostOff };
    console.log('keyboard', JSON.stringify(F.keyboard));
    await page.close();
  }
  res.flows = F;
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
