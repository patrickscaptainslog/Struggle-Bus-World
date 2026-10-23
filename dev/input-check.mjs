#!/usr/bin/env node
// Scripted checks for src/game/Input.ts + src/ui/Tuner.ts + src/ui/Perf.ts
// against dev/input.html (multi-touch via CDP Input.dispatchTouchEvent).
// usage: node dev/input-check.mjs [--base=http://127.0.0.1:5173] [--shots=shots/tmp]
import { chromium } from 'playwright-core';
import { browserOptions } from '../tools/browser.mjs';

const opt = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.join('=') || '1'];
  }),
);
const BASE = opt.base ?? 'http://127.0.0.1:5173';
const SHOTS = opt.shots ?? 'shots/tmp';

const browser = await chromium.launch({
  ...browserOptions(['--enable-webgl']),
});

let fails = 0;
let passes = 0;
let skips = 0;
/** For checks driven through CDP, whose dispatch latency we don't control: inconclusive when too slow. */
function soft(name, ok, tooSlow, info = '') {
  if (tooSlow && !ok) {
    skips++;
    console.log(`SKIP  ${name}  — CDP too slow to test this here (${info})`);
  } else check(name, ok, info);
}
function check(name, ok, info = '') {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(query, { w = 393, h = 852, dpr = 3 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
  // Other modules are being edited live; Vite would full-reload this page mid-test.
  // Stub its HMR client so the page under test stays put.
  await ctx.route('**/@vite/client', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'const h={accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}};' +
      'export const createHotContext=()=>h;export const updateStyle=()=>{};export const removeStyle=()=>{};' +
      'export const injectQuery=(u)=>u;export class ErrorOverlay{};',
  }));
  const page = await ctx.newPage();
  let navs = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame() && ++navs > 1) console.log('[note] page navigated', f.url());
  });
  page.on('pageerror', (e) => {
    fails++;
    console.log('[pageerror]', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[console.error]', m.text());
  });
  await page.goto(`${BASE}/dev/input.html${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__input && window.__shotReady === true, null, { timeout: 60000 });
  // let late module imports (Bus / Particles / Audio groups) finish so CDP input isn't stalled
  await page.waitForTimeout(2000);
  const cdp = await ctx.newCDPSession(page);
  // touch helper: pass the full set of fingers that should be down after this event
  let down = [];
  const pt = (p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 6, radiusY: 6, force: 1 });
  const touch = {
    async set(points) {
      const ids = new Set(down.map((p) => p.id));
      const type = points.length === 0 ? 'touchEnd' : points.some((p) => !ids.has(p.id)) ? 'touchStart' : 'touchMove';
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(pt) });
      down = points.map((p) => ({ ...p }));
    },
    async cancel() {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      down = [];
    },
    /** move finger `id` from its current spot to (x, y) in n steps over ms */
    async glide(id, x, y, ms, n = 8) {
      const f = down.find((p) => p.id === id);
      const x0 = f.x, y0 = f.y;
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const next = down.map((p) => (p.id === id ? { ...p, x: x0 + (x - x0) * k, y: y0 + (y - y0) * k } : p));
        await touch.set(next);
        await sleep(ms / n);
      }
    },
  };
  const S = () => page.evaluate(() => ({
    taps: __input.taps, triples: __input.triples, first: __input.first,
    tapIn: [...__input.tapIn], firstIn: [...__input.firstIn], tripleIn: [...__input.tripleIn],
    dragging: __input.state.dragging, sx: __input.state.stretch.x, sy: __input.state.stretch.y,
    anchor: __input.state.anchor && { ...__input.state.anchor }, finger: __input.state.finger && { ...__input.state.finger },
    tuner: __input.tunerVisible(),
  }));
  return { ctx, page, cdp, touch, S };
}

// ============================================================ input events
{
  const { ctx, page, touch, S } = await openPage('?bg=0');
  await page.evaluate(() => localStorage.clear());
  let s = await S();
  check('nothing fired at load', s.taps === 0 && s.first === 0 && s.triples === 0);

  const dur = () => page.evaluate(() => __input.lastDur);
  // 1) first gesture + quick still tap (no page round-trips mid-tap: CDP is slow)
  await touch.set([{ id: 1, x: 200, y: 420 }]);
  await sleep(20);
  await touch.set([]);
  s = await S();
  check('onFirstGesture fires on the very first touch, synchronously inside pointerdown', s.first === 1 && s.firstIn[0] === 'pointerdown', JSON.stringify(s.firstIn));
  let dd = await dur();
  soft('quick still tap -> onTap on pointerup', s.taps === 1 && s.tapIn[0] === 'pointerup', dd > 230, `${JSON.stringify(s.tapIn)} dur=${dd}ms`);
  check('onFirstGesture fired only once', s.first === 1);
  await touch.set([{ id: 1, x: 200, y: 420 }]);
  s = await S();
  check('touching down is not yet steering (anchor shown, no stretch)', !s.dragging && s.sx === 0 && s.sy === 0 && s.anchor && s.anchor.x === 200);
  await touch.set([]);
  await sleep(300);
  let base = (await S()).taps; // that one was slow (page round-trip) -> may or may not be a tap; re-base

  // 2) tap with slight movement: 10 px (inside tap slop), then a quick 20 px flick-tap
  await touch.set([{ id: 2, x: 150, y: 400 }]);
  await touch.set([{ id: 2, x: 157, y: 407 }]);
  await touch.set([]);
  s = await S();
  dd = await dur();
  soft('tap with slight movement (10 px) taps', s.taps === base + 1, dd > 230, `taps=${s.taps - base} dur=${dd}ms`);
  await sleep(300);
  base = s.taps;
  await touch.set([{ id: 2, x: 150, y: 400 }]);
  await touch.set([{ id: 2, x: 164, y: 414 }]);
  await touch.set([]);
  const fd = await dur();
  s = await S();
  soft('quick flick-tap (20 px, <= quickTapMs) still taps', s.taps === base + 1, fd > 150, `dur=${fd}ms taps=${s.taps - base}`);
  base = s.taps;

  // 3) a drag never taps; stretch up = +y, saturates <= 1
  await sleep(350);
  base = (await S()).taps;
  await touch.set([{ id: 3, x: 200, y: 520 }]);
  await touch.glide(3, 200, 420, 240, 8);
  s = await S();
  check('drag up -> dragging, +y stretch near full, <= 1', s.dragging && s.sy > 0.9 && s.sy <= 1 && Math.abs(s.sx) < 0.01, `sy=${s.sy.toFixed(3)}`);
  await touch.glide(3, 300, 520, 200, 6);
  s = await S();
  check('drag right -> +x stretch', s.sx > 0.9 && Math.abs(s.sy) < 0.05, `sx=${s.sx.toFixed(3)} sy=${s.sy.toFixed(3)}`);
  await touch.glide(3, 200, 600, 200, 6);
  s = await S();
  check('drag down -> -y stretch (yoke: climb)', s.sy < -0.9, `sy=${s.sy.toFixed(3)}`);
  await touch.glide(3, 203, 522, 120, 4);
  s = await S();
  check('back inside the dead zone -> zero stretch, still dragging', s.dragging && Math.hypot(s.sx, s.sy) === 0, `sx=${s.sx} sy=${s.sy}`);
  await touch.set([]);
  s = await S();
  check('releasing a drag fires no tap and stops steering', s.taps === base && !s.dragging && s.anchor === null && s.sx === 0 && s.sy === 0);

  // 4) slow small drag (30 px over 450 ms): not a tap
  await sleep(350);
  base = (await S()).taps;
  await touch.set([{ id: 4, x: 100, y: 300 }]);
  await touch.glide(4, 130, 300, 450, 9);
  await touch.set([]);
  s = await S();
  check('slow small drag is not a tap', s.taps === base, `taps=${s.taps}`);

  // 5) hold still past the tap window: steering at neutral, no tap
  await sleep(350);
  await touch.set([{ id: 5, x: 100, y: 300 }]);
  await sleep(420);
  s = await S();
  check('held still > tap window -> steering (neutral)', s.dragging && s.sx === 0 && s.sy === 0);
  await touch.set([]);
  s = await S();
  check('held still then released -> no tap', s.taps === base);

  // 6) second-finger tap while steering
  await sleep(350);
  base = (await S()).taps;
  await touch.set([{ id: 6, x: 200, y: 600 }]);
  await touch.glide(6, 170, 560, 200, 6);
  const before = await S();
  await touch.set([{ id: 6, x: 170, y: 560 }, { id: 7, x: 320, y: 300 }]);
  s = await S();
  check('second finger down while steering -> onTap inside pointerdown', s.taps === base + 1 && s.tapIn[s.tapIn.length - 1] === 'pointerdown', JSON.stringify(s.tapIn));
  check('second finger does not disturb steering', s.dragging && s.sx === before.sx && s.sy === before.sy && s.anchor.x === before.anchor.x && s.anchor.y === before.anchor.y,
    `before ${before.sx.toFixed(3)},${before.sy.toFixed(3)} after ${s.sx.toFixed(3)},${s.sy.toFixed(3)}`);
  await touch.glide(7, 330, 310, 60, 2); // tap finger wobbles: must not steer
  s = await S();
  check('second finger moving does not steer', s.sx === before.sx && s.sy === before.sy);
  await touch.set([{ id: 6, x: 170, y: 560 }]); // lift the tap finger
  s = await S();
  check('lifting the second finger fires no extra tap', s.taps === base + 1);
  await touch.glide(6, 250, 560, 150, 4);
  s = await S();
  check('steering finger keeps steering after the tap', s.dragging && s.sx > 0.5, `sx=${s.sx.toFixed(3)}`);
  await touch.set([{ id: 6, x: 250, y: 560 }, { id: 8, x: 300, y: 250 }]);
  await sleep(40);
  await touch.set([{ id: 6, x: 250, y: 560 }]);
  await touch.set([{ id: 6, x: 250, y: 560 }, { id: 9, x: 280, y: 260 }]);
  await sleep(40);
  await touch.set([{ id: 6, x: 250, y: 560 }]);
  s = await S();
  check('repeated second-finger taps each splat', s.taps === base + 3, `taps=${s.taps}`);
  // drumming two tap fingers so three are down at once must NOT open the tuner mid-flight
  await touch.set([{ id: 6, x: 250, y: 560 }, { id: 10, x: 300, y: 250 }]);
  await touch.set([{ id: 6, x: 250, y: 560 }, { id: 10, x: 300, y: 250 }, { id: 11, x: 340, y: 280 }]);
  s = await S();
  check('extra fingers while steering are taps, never the tuner gesture', s.taps === base + 5 && s.triples === 0 && !s.tuner, `taps=${s.taps} triples=${s.triples}`);
  await touch.set([]);
  s = await S();
  check('releasing everything fires nothing more', s.taps === base + 5 && !s.dragging);
  base = s.taps;

  // 7) leash: drag far, anchor follows at 2.2x stretchPx
  await sleep(350);
  const px = await page.evaluate(() => __config.flight.stretchPx);
  await touch.set([{ id: 12, x: 200, y: 700 }]);
  await touch.glide(12, 200, 150, 300, 12);
  s = await S();
  const d = Math.hypot(s.finger.x - s.anchor.x, s.finger.y - s.anchor.y);
  check('leash: anchor dragged along at 2.2x stretchPx', Math.abs(d - 2.2 * px) < 0.5 && s.anchor.y < 400, `dist=${d.toFixed(1)} want ${(2.2 * px).toFixed(1)} anchorY=${s.anchor.y.toFixed(0)}`);
  await touch.glide(12, 200, 150 + 2.2 * px + 40, 200, 6);
  s = await S();
  check('leash: reversing responds right away (no dead travel)', s.sy < -0.3, `sy=${s.sy.toFixed(3)}`);
  await touch.set([]);

  // 8) pointercancel: no tap, steering stops
  await sleep(350);
  base = (await S()).taps;
  await touch.set([{ id: 13, x: 200, y: 400 }]);
  await touch.glide(13, 230, 380, 100, 3);
  await touch.cancel();
  s = await S();
  check('pointercancel ends steering, no tap', !s.dragging && s.taps === base && s.anchor === null);
  await touch.set([{ id: 14, x: 200, y: 400 }]);
  await sleep(40);
  await touch.cancel();
  s = await S();
  check('cancelled quick touch is not a tap', s.taps === base);

  // synthetic PointerEvents for anything timing-critical (CDP dispatch is ~100 ms/event here)
  const synth = (seq) => page.evaluate(async (seq) => {
    const c = document.getElementById('game');
    const t0 = performance.now();
    const before = __input.taps;
    for (const ev of seq) {
      while (performance.now() - t0 < ev.at) await new Promise((r) => setTimeout(r, 1));
      c.dispatchEvent(new PointerEvent(ev.type, { pointerId: ev.id, pointerType: 'touch', isPrimary: ev.primary ?? true, clientX: ev.x, clientY: ev.y, bubbles: true, cancelable: true, button: 0, buttons: ev.type === 'pointerup' ? 0 : 1 }));
    }
    return { taps: __input.taps - before, dragging: __input.state.dragging, sy: __input.state.stretch.y };
  }, seq);
  const tapSeq = (id, ms, dist) => [
    { type: 'pointerdown', id, x: 100, y: 300, at: 0 },
    { type: 'pointermove', id, x: 100 + dist * 0.6, y: 300 + dist * 0.8, at: ms * 0.5 },
    { type: 'pointerup', id, x: 100 + dist * 0.6, y: 300 + dist * 0.8, at: ms },
  ];

  const P = (type, id, x, y, at, primary = false) => ({ type, id, x, y, at, primary });
  // 9) two fingers tapped together = one tap (either lift order)
  await sleep(350);
  let m = await synth([P('pointerdown', 400, 150, 400, 0, true), P('pointerdown', 401, 230, 410, 30), P('pointerup', 400, 150, 400, 110), P('pointerup', 401, 230, 410, 140)]);
  check('two-finger tap -> exactly one tap', m.taps === 1, `taps=${m.taps}`);
  await sleep(350);
  m = await synth([P('pointerdown', 402, 150, 400, 0, true), P('pointerdown', 403, 230, 410, 25), P('pointerup', 403, 230, 410, 90), P('pointerup', 402, 150, 400, 130)]);
  check('two-finger tap (other lift order) -> exactly one tap', m.taps === 1, `taps=${m.taps}`);
  // thumb lands, index taps before the thumb has committed, then the thumb steers: the tap still counts
  await sleep(350);
  m = await synth([P('pointerdown', 404, 200, 600, 0, true), P('pointerdown', 405, 300, 300, 60), P('pointerup', 405, 300, 300, 140), P('pointermove', 404, 200, 560, 200), P('pointermove', 404, 200, 520, 260)]);
  check('index tap just before the thumb commits -> one tap when it starts steering', m.taps === 1 && m.dragging, JSON.stringify(m));
  m = await synth([P('pointermove', 404, 200, 500, 0), P('pointerup', 404, 200, 500, 40)]);
  check('...and the thumb release adds no second tap', m.taps === 0);

  // 10) three-finger tap toggles the tuner, no tap, no steering
  await sleep(350);
  let tri0 = (await S()).triples;
  m = await synth([P('pointerdown', 410, 120, 200, 0, true), P('pointerdown', 411, 200, 190, 30), P('pointerdown', 412, 280, 210, 55)]);
  s = await S();
  check('three fingers -> onTripleFinger inside pointerdown (tuner opens)', s.triples === tri0 + 1 && s.tuner && s.tripleIn[s.tripleIn.length - 1] === 'pointerdown');
  check('three fingers: no steering', !s.dragging && s.sx === 0 && s.sy === 0);
  m = await synth([P('pointermove', 410, 150, 260, 0), P('pointerup', 411, 200, 190, 40), P('pointerup', 410, 150, 260, 60), P('pointerup', 412, 280, 210, 80)]);
  s = await S();
  check('three-finger tap fires no tap and never steers', m.taps === 0 && !s.dragging, JSON.stringify(m));
  await sleep(350);
  m = await synth([P('pointerdown', 413, 120, 150, 0, true), P('pointerdown', 414, 200, 140, 20), P('pointerdown', 415, 280, 160, 40), P('pointerup', 413, 120, 150, 100), P('pointerup', 414, 200, 140, 110), P('pointerup', 415, 280, 160, 120)]);
  s = await S();
  check('three fingers again closes the tuner', s.triples === tri0 + 2 && !s.tuner && m.taps === 0);
  // a slow three-finger "walk" (third finger > tripleWindowMs later, thumb still) is not the tuner gesture
  await sleep(350);
  m = await synth([P('pointerdown', 416, 120, 150, 0, true), P('pointerdown', 417, 200, 140, 60), P('pointerdown', 418, 280, 160, 600)]);
  s = await S();
  check('third finger long after the first is not the tuner gesture', s.triples === tri0 + 2 && !s.tuner);
  await synth([P('pointerup', 416, 120, 150, 0), P('pointerup', 417, 200, 140, 5), P('pointerup', 418, 280, 160, 10)]);
  // the same three fingers with CDP (real touch pipeline), loosely timed
  await sleep(350);
  await touch.set([{ id: 17, x: 120, y: 200 }]);
  await touch.set([{ id: 17, x: 120, y: 200 }, { id: 18, x: 200, y: 190 }, { id: 19, x: 280, y: 210 }]);
  s = await S();
  const gap = await page.evaluate(() => __input.downT.slice(-1)[0] - __input.downT.slice(-3)[0]);
  soft('CDP three-finger touch toggles the tuner', s.triples === tri0 + 3 && s.tuner, gap > 230, `triples=${s.triples - tri0} first->third finger ${gap}ms`);
  await touch.set([]);
  await page.evaluate(() => __tuner.visible && __tuner.toggle());
  base = (await S()).taps;

  // 11) mouse: click = tap, drag steers
  await sleep(350);
  base = (await S()).taps;
  await page.mouse.move(200, 400);
  await page.mouse.down();
  await page.mouse.up();
  s = await S();
  check('mouse click = tap', s.taps === base + 1, `taps=${s.taps}`);
  await sleep(300);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(200 - i * 15, 400);
    await sleep(25);
  }
  s = await S();
  check('mouse drag left -> -x stretch', s.dragging && s.sx < -0.9, `sx=${s.sx.toFixed(3)}`);
  await page.mouse.up();
  s = await S();
  check('mouse drag release -> no tap', s.taps === base + 1 && !s.dragging);

  // 12) keyboard
  base = (await S()).taps;
  await page.keyboard.down('ArrowUp');
  await sleep(600);
  s = await S();
  check('ArrowUp -> surge (+y), dragging', s.dragging && s.sy > 0.9, `sy=${s.sy.toFixed(3)}`);
  await page.keyboard.down('KeyA');
  await sleep(500);
  s = await S();
  check('W/up + A -> up-left diagonal, |stretch| <= 1', s.sx < -0.5 && s.sy > 0.5 && Math.hypot(s.sx, s.sy) <= 1.0001, `sx=${s.sx.toFixed(2)} sy=${s.sy.toFixed(2)}`);
  await page.keyboard.up('KeyA');
  await page.keyboard.up('ArrowUp');
  await sleep(100);
  s = await S();
  check('keys released -> not dragging', !s.dragging && s.sx === 0 && s.sy === 0);
  await page.keyboard.down('KeyS');
  await sleep(500);
  s = await S();
  check('S -> pull back (-y, climb)', s.sy < -0.9);
  await page.keyboard.up('KeyS');
  await page.keyboard.press('Space');
  s = await S();
  check('Space = tap', s.taps === base + 1, `taps=${s.taps}`);

  // 12b) exact timing rules with synthetic PointerEvents
  for (const [ms, dist, want, what] of [
    [200, 0, 1, 'still 200 ms -> tap'],
    [260, 0, 0, 'still 260 ms -> not a tap'],
    [200, 10, 1, '10 px in 200 ms -> tap'],
    [120, 20, 1, 'quick 20 px flick in 120 ms -> tap'],
    [200, 20, 0, '20 px in 200 ms -> not a tap (drag)'],
    [100, 32, 0, '32 px in 100 ms -> not a tap (drag)'],
  ]) {
    await sleep(320);
    const r = await synth(tapSeq(200 + ms + dist, ms, dist));
    check(`timing: ${what}`, r.taps === want, `taps=${r.taps}`);
  }
  // a lost pointerup must never wedge the controls
  await sleep(300);
  let r = await synth([{ type: 'pointerdown', id: 300, x: 100, y: 500, at: 0 }, { type: 'pointermove', id: 300, x: 100, y: 440, at: 30 }]);
  check('stale test: first finger steering', r.dragging && r.sy > 0.5);
  r = await synth([
    { type: 'pointerdown', id: 301, x: 200, y: 600, at: 0, primary: true },
    { type: 'pointermove', id: 301, x: 200, y: 480, at: 30 },
  ]);
  check('a new primary touch retires a pointer whose up was lost (steers, no phantom tap)', r.dragging && r.sy > 0.9 && r.taps === 0, JSON.stringify(r));
  const goneOk = await page.evaluate(async () => {
    document.getElementById('game').dispatchEvent(new TouchEvent('touchend', { cancelable: true, bubbles: true, touches: [], changedTouches: [] }));
    await new Promise((r) => setTimeout(r, 120));
    return !__input.state.dragging && __input.state.anchor === null;
  });
  check('touchend with no touches left clears a stuck steering finger', goneOk);

  // 13) iOS gesture guards
  const guards = await page.evaluate(() => {
    const c = document.getElementById('game');
    const st = getComputedStyle(c);
    const t = new TouchEvent('touchstart', { cancelable: true, bubbles: true, touches: [], targetTouches: [], changedTouches: [] });
    c.dispatchEvent(t);
    const m = new TouchEvent('touchmove', { cancelable: true, bubbles: true });
    c.dispatchEvent(m);
    const g = new Event('gesturestart', { cancelable: true });
    document.dispatchEvent(g);
    const cm = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    c.dispatchEvent(cm);
    return { ta: st.touchAction, us: st.userSelect, start: t.defaultPrevented, move: m.defaultPrevented, gest: g.defaultPrevented, ctx: cm.defaultPrevented };
  });
  check('touch-action none + no selection on the canvas', guards.ta === 'none' && guards.us === 'none', JSON.stringify(guards));
  check('touchstart/touchmove/gesturestart/contextmenu prevented (zoom, scroll, callout)', guards.start && guards.move && guards.gest && guards.ctx);
  await ctx.close();
}

// ============================================================ tuner
{
  const { ctx, page, touch } = await openPage('?bg=0&tune');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true && document.querySelectorAll('.sbt-row').length > 0);
  await page.waitForTimeout(400); // late module groups register -> rebuild
  const info = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('.sbt-sec-title')].map((e) => e.textContent);
    return { rows: document.querySelectorAll('.sbt-row').length, secs };
  });
  const cfgCount = await page.evaluate(() => {
    let n = 0;
    for (const s of Object.values(__config)) for (const v of Object.values(s)) if (typeof v === 'number') n++;
    return n;
  });
  check('tuner lists every numeric config field + module groups', info.rows > cfgCount && ['Render', 'Flight', 'Splat', 'Audio', 'Input', 'Bus', 'Particles'].every((t) => info.secs.includes(t)), `rows=${info.rows} config=${cfgCount} secs=${info.secs.join(',')}`);

  const rowBox = async (label) => page.evaluate((label) => {
    const row = [...document.querySelectorAll('.sbt-sec.open .sbt-row')].find((r) => r.querySelector('.sbt-name').textContent === label);
    if (!row) return null;
    row.scrollIntoView({ block: 'center' });
    const b = row.querySelector('.sbt-scrub').getBoundingClientRect();
    const plus = row.querySelector('.sbt-step[data-d="1"]')?.getBoundingClientRect();
    return { x: b.left + b.width * 0.5, y: b.top + b.height / 2, w: b.width, plus: plus && { x: plus.left + plus.width / 2, y: plus.top + plus.height / 2 }, val: row.querySelector('.sbt-val').textContent };
  }, label);

  // scrub flight.stretchPx sideways with a finger
  let b = await rowBox('stretchPx');
  check('Flight section open by default', !!b);
  const v0 = await page.evaluate(() => __config.flight.stretchPx);
  await touch.set([{ id: 1, x: b.x, y: b.y }]);
  await touch.glide(1, b.x + b.w * 0.1, b.y + 2, 200, 8);
  await touch.set([]);
  const v1 = await page.evaluate(() => __config.flight.stretchPx);
  check('sideways drag on a row scrubs config live', v1 > v0 + 10 && Number.isInteger(v1), `${v0} -> ${v1}`);
  const tapsAfterScrub = await page.evaluate(() => __input.taps);
  check('tuner touches never reach the game', tapsAfterScrub === 0 && !(await page.evaluate(() => __input.state.dragging)));
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sb.tuning.v1') || '{}'));
  check('changed value persisted to localStorage', saved.config && saved.config['flight.stretchPx'] === v1, JSON.stringify(saved));

  // + button nudges by one step
  b = await rowBox('bungeeHz');
  const h0 = await page.evaluate(() => __config.flight.bungeeHz);
  await touch.set([{ id: 2, x: b.plus.x, y: b.plus.y }]);
  await sleep(60);
  await touch.set([]);
  const h1 = await page.evaluate(() => __config.flight.bungeeHz);
  check('+ button nudges one step', Math.abs(h1 - (h0 + 0.01)) < 1e-9, `${h0} -> ${h1}`);
  // hold + to auto-repeat
  await touch.set([{ id: 3, x: b.plus.x, y: b.plus.y }]);
  await sleep(900);
  await touch.set([]);
  const h2 = await page.evaluate(() => __config.flight.bungeeHz);
  check('holding + auto-repeats', h2 > h1 + 0.03, `${h1} -> ${h2}`);
  // double-tap row resets
  b = await rowBox('bungeeHz');
  // synthetic: a real double-tap is ~150-250 ms up-to-up, which CDP can't hit reliably here
  const single = await page.evaluate(async ({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const fire = (type, id) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    fire('pointerdown', 900); await wait(40); fire('pointerup', 900);
    await wait(600); // too slow for a double-tap
    fire('pointerdown', 901); await wait(40); fire('pointerup', 901);
    const v = __config.flight.bungeeHz;
    await wait(500);
    fire('pointerdown', 902); await wait(40); fire('pointerup', 902); await wait(120);
    fire('pointerdown', 903); await wait(40); fire('pointerup', 903);
    return v;
  }, b);
  check('two slow taps on a row do nothing', single === h2, `${h2} -> ${single}`);
  const h3 = await page.evaluate(() => __config.flight.bungeeHz);
  check('double-tap a row resets it to default', h3 === h0, `${h2} -> ${h3} (default ${h0})`);

  // vertical drag scrolls the list (doesn't scrub)
  const sc0 = await page.evaluate(() => document.querySelector('.sbt-scroll').scrollTop);
  b = await rowBox('cruiseSpeed');
  const cs0 = await page.evaluate(() => __config.flight.cruiseSpeed);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(b.x), y: Math.round(b.y), yDistance: -220, gestureSourceType: 'touch', speed: 800 });
  const sc1 = await page.evaluate(() => document.querySelector('.sbt-scroll').scrollTop);
  const cs1 = await page.evaluate(() => __config.flight.cruiseSpeed);
  check('vertical swipe scrolls the list without changing values', Math.abs(sc1 - sc0) > 50 && cs1 === cs0, `scroll ${sc0} -> ${sc1}, cruise ${cs0} -> ${cs1}`);

  // Copy JSON: changed values only
  await page.evaluate(() => {
    window.__copied = null;
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => ((window.__copied = t), Promise.resolve()) } });
    } catch {}
  });
  await page.click('[data-act="copy"]');
  await page.waitForTimeout(100);
  const copied = await page.evaluate(() => window.__copied);
  let parsed = null;
  try {
    parsed = JSON.parse(copied);
  } catch {}
  check('Copy JSON copies only changed values, nested by section', parsed && parsed.config?.flight?.stretchPx === v1 && Object.keys(parsed.config.flight).length === 1, copied);
  const toast = await page.evaluate(() => document.querySelector('.sbt-toast').textContent);
  check('copy shows a toast', /Copied 1 value/.test(toast), toast);
  // fallback path (no async clipboard)
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  await page.click('[data-act="copy"]');
  const fb = await page.evaluate(() => ({ text: document.querySelector('.sbt-copy textarea').value, open: document.querySelector('.sbt-copy').classList.contains('open'), toast: document.querySelector('.sbt-toast').textContent }));
  check('clipboard fallback: textarea holds the JSON', fb.text.includes('"stretchPx"'), JSON.stringify(fb));

  // Reset paint needs two taps
  const acts = () => page.evaluate(() => __input.events.filter((e) => e.kind === 'reset paint').length);
  await page.click('[data-act="resetPaint"]');
  check('Reset paint: first tap only arms', (await acts()) === 0);
  await page.click('[data-act="resetPaint"]');
  check('Reset paint: second tap calls onResetPaint', (await acts()) === 1);

  // persistence across reload via applySavedTuning()
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true);
  const v2 = await page.evaluate(() => __config.flight.stretchPx);
  check('applySavedTuning re-applies saved values on load', v2 === v1, `${v2} vs ${v1}`);
  // tunable group persistence (Bus registers late via dynamic import)
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sb.tuning.v1'));
    s.groups.Input = { tapMs: 250 };
    localStorage.setItem('sb.tuning.v1', JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true);
  const tapMs = await page.evaluate(async () => (await import('/src/game/Input.ts')).inputTune.tapMs);
  check('saved module-group values re-applied on register', tapMs === 250, `tapMs=${tapMs}`);
  // close button
  await page.waitForFunction(() => document.querySelector('.sbt.open'));
  await page.click('[data-act="close"]');
  const closed = await page.evaluate(() => !__input.tunerVisible() && getComputedStyle(document.querySelector('.sbt')).display === 'none');
  check('Close hides the panel (display:none, steals nothing)', closed);
  // Reset all
  await page.evaluate(() => __tuner.toggle());
  await page.click('[data-act="resetAll"]');
  await page.click('[data-act="resetAll"]');
  const after = await page.evaluate(() => ({ s: __config.flight.stretchPx, store: localStorage.getItem('sb.tuning.v1') }));
  check('Reset all restores defaults and clears storage', after.s === v0 && after.store === '{"config":{},"groups":{}}', JSON.stringify(after));
  await ctx.close();
}

// ============================================================ perf + screenshots (real pipeline backdrop)
{
  const { ctx, page, touch } = await openPage('?fps&dist=95&elev=30&yaw=25');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('sb.tuning.v1', JSON.stringify({ config: { 'flight.stretchPx': 84, 'flight.bungeeDamping': 0.6 }, groups: { Bus: { bellySag: 0.18 } } }));
    localStorage.setItem('sb.tuner.ui.v1', JSON.stringify({ open: ['c:flight'], tall: false }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true);
  await page.waitForFunction(() => window.__stats && window.__stats.frames > 3, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => window.__stats);
  check('perf: __stats published every second', st && st.fps > 0 && st.lowRes !== '0x0', JSON.stringify(st));
  check('perf: draw calls are whole-frame totals (all pipeline passes), not the last pass', st.calls >= 8, `calls=${st.calls} tris=${st.triangles}`);
  const meter = await page.evaluate(() => getComputedStyle(document.querySelector('.sbp')).display);
  check('perf meter visible with ?fps', meter === 'block');

  // mid-drag bench shot: thumb stretched up-right, second finger just tapped
  await touch.set([{ id: 1, x: 196, y: 640 }]);
  await touch.glide(1, 250, 545, 250, 8);
  await touch.set([{ id: 1, x: 250, y: 545 }, { id: 2, x: 120, y: 430 }]);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/input_bench_drag.png` });
  await touch.set([]);
  console.log('saved', `${SHOTS}/input_bench_drag.png`);

  // tuner shots
  await page.evaluate(() => __tuner.toggle());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/input_tuner_iphone.png` });
  console.log('saved', `${SHOTS}/input_tuner_iphone.png`);
  // scrubbing state + a module group
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.sbt-chip')].find((c) => c.textContent === 'Bus');
    chip.click();
  });
  await page.waitForTimeout(900);
  await page.click('.sbt-grab');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/input_tuner_tall_bus.png` });
  console.log('saved', `${SHOTS}/input_tuner_tall_bus.png`);
  await page.click('.sbt-grab');
  await page.evaluate(() => localStorage.clear());
  await ctx.close();
}

await browser.close();
console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped (CDP latency)`);
process.exit(fails ? 1 : 0);
