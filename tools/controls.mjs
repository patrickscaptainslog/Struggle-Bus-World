#!/usr/bin/env node
// Controls QA in the real game (index.html), iPhone portrait viewport, touch + mobile emulation.
//   node tools/controls.mjs <baseUrl> <outDir> [touch] [turbo] [tilt]
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
//   perf=<otherBaseUrl>  CPU work ms, draw calls, triangles at the same Alamo Square view (cruising at the
//          floor, the fps meter's per-frame counters) for <otherBaseUrl> (e.g. the build before) and
//          <baseUrl>, in one browser session                                              -> perf in controls.json
// SwiftShader renders ~1.5 fps: everything waits on the game clock (fixed 1/20 s steps), never wall time.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base = 'http://127.0.0.1:5101/', out = 'shots/controls', ...rest] = process.argv.slice(2);
const modes = new Set((rest.length ? rest : ['touch', 'turbo', 'tilt']).map((m) => m.split('=')[0]));
const perfOther = (rest.find((m) => m.startsWith('perf=')) ?? '').slice(5);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});

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
  if (init) await page.addInitScript(init);
  await page.goto(at + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 400000 });
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
    const lv = await rectOf(page, '[data-hud="lever"]');
    await events(page);
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.top + 10, wait: 80 }, { type: 'touchEnd' }]);
    const climbed = await until(page, 'g.controls.turbo.engaged', 12);
    await page.screenshot({ path: `${out}/g1-engage.png` });
    const boomed = await until(page, 'g.flight.speed > 345', 6);
    await runFor(page, 0.15);
    await page.screenshot({ path: `${out}/g1-boom.png` });
    await until(page, 'g.flight.speed > 440', 10);
    await runFor(page, 1.5);
    await page.screenshot({ path: `${out}/g1-jet.png` });
    // a banked jet turn
    await page.evaluate(() => (window.__qa = { sx: 0.8, sy: 0 }));
    await runFor(page, 1.6);
    await page.screenshot({ path: `${out}/g1-turn.png` });
    await page.evaluate(() => (window.__qa = null));
    await runFor(page, 0.8);
    // LOCKED
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.top + 10, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 0.4);
    await page.screenshot({ path: `${out}/g1-locked.png` });
    // drop back to G0
    await touch(page, cdp, [{ type: 'touchStart', x: lv.x, y: lv.bottom - 10, wait: 80 }, { type: 'touchEnd' }]);
    await runFor(page, 5);
    const ev = await events(page);
    const log = await page.evaluate(() => window.__log);
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? null;
    const g0 = log.filter((r) => r.gear === 0 && r.speed < 40 && r.t < log[0].t + 1);
    const jet = log.filter((r) => r.gear === 1 && r.speed > 440);
    res.turbo = {
      climbedToGear: climbed, boomed, events: ev,
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
  const asked = await page.evaluate(() => window.__sensor.asked);
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

if (modes.has('perf') && perfOther) {
  // the same view and the same sampling for both builds (per-frame counters, median of the frames in 0.8 s)
  res.perf = {};
  for (const [label, url] of [['before', perfOther], ['after', base]]) {
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
    await runFor(page, 0.8);
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
