// Tap vs hold vs drag vs swipe through the REAL Input, offline: synthetic pointer / key events on a
// controlled clock, one frame (input.update) every 16.7 ms like the game loop. Writes the
// disambiguation table to shots/controls/sim/gestures.json (+ a readable table on stdout).
import { installDom, Target, clock, ptr, newId, key } from './fakedom';
const { win, doc } = installDom();
import { mkdirSync, writeFileSync } from 'node:fs';

const { Input } = await import('@src/game/Input');
const { config } = await import('@src/config');

type Ev = string;
function harness(mode: 'touch' | 'tilt' | 'keyboard') {
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode(mode);
  const evs: Ev[] = [];
  let t0 = clock.ms;
  const at = () => `${Math.round(clock.ms - t0)}ms`;
  input.onTap = () => evs.push(`tap@${at()}`);
  input.onChargeStart = () => evs.push(`chargeStart@${at()}`);
  input.onChargeEnd = (h, c) => evs.push(`chargeEnd(${h.toFixed(2)}s${c ? ', cancelled' : ''})@${at()}`);
  input.onTurbo = (d) => evs.push(`turbo${d > 0 ? '+1' : '-1'}@${at()}`);
  input.onTripleFinger = () => evs.push(`tuner@${at()}`);
  let maxCharge = 0, sawDrag = false, sawTurboHeld = false;
  const frame = () => {
    input.update(1 / 60);
    maxCharge = Math.max(maxCharge, input.state.chargeHeld);
    if (input.state.dragging) sawDrag = true;
    if (input.state.turboHeld) sawTurboHeld = true;
  };
  /** advance the clock by ms, running frames */
  // frames every 16.7 ms of the clock, whatever the step size of the waits
  let nextFrame = clock.ms + 16.7;
  const wait = (ms: number) => {
    const end = clock.ms + ms;
    while (nextFrame <= end) {
      clock.ms = nextFrame;
      frame();
      nextFrame += 16.7;
    }
    clock.ms = end;
  };
  return {
    input, el, evs,
    reset() { evs.length = 0; t0 = clock.ms; nextFrame = clock.ms + 16.7; maxCharge = 0; sawDrag = false; sawTurboHeld = false; },
    down(id: number, x: number, y: number, primary = true) { el.dispatch('pointerdown', ptr('pointerdown', id, x, y, primary)); },
    move(id: number, x: number, y: number) { el.dispatch('pointermove', ptr('pointermove', id, x, y)); },
    up(id: number, x: number, y: number) { el.dispatch('pointerup', ptr('pointerup', id, x, y)); },
    cancel(id: number, x: number, y: number) { el.dispatch('pointercancel', ptr('pointercancel', id, x, y)); },
    /** move from (x0, y0) by (dx, dy) over ms in steps */
    slide(id: number, x0: number, y0: number, dx: number, dy: number, ms: number) {
      const n = Math.max(1, Math.round(ms / 16.7));
      for (let i = 1; i <= n; i++) { wait(ms / n); this.move(id, x0 + (dx * i) / n, y0 + (dy * i) / n); }
    },
    wait, frame,
    result() { return { events: [...evs], maxChargeHeld: +maxCharge.toFixed(2), dragging: sawDrag, turboHeld: sawTurboHeld }; },
  };
}

const rows: Array<{ mode: string; gesture: string; events: string[]; maxChargeHeld: number; dragging: boolean; turboHeld: boolean }> = [];
function row(mode: 'touch' | 'tilt' | 'keyboard', gesture: string, fn: (h: ReturnType<typeof harness>) => void) {
  const h = harness(mode);
  h.wait(100);
  h.reset();
  fn(h);
  h.wait(100);
  rows.push({ mode, gesture, ...h.result() });
  h.input.dispose();
}
const X = 200, Y = 600;

// ---- touch mode: the canvas (bungee)
row('touch', 'canvas: quick tap (120 ms, still)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(120); h.up(id, X, Y); });
row('touch', 'canvas: slow tap (260 ms, still)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(260); h.up(id, X, Y); });
row('touch', 'canvas: hold 1 s still (bungee at neutral, no charge)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(1000); h.up(id, X, Y); });
row('touch', 'canvas: drag 80 px (steer)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 80, 0, 300); h.up(id, X + 80, Y); });
row('touch', 'canvas: quick flick 20 px in 90 ms (still a tap)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 20, 0, 90); h.up(id, X + 20, Y); });
row('touch', 'canvas: steer + second finger tap', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.slide(a, X, Y, 60, 0, 300); h.down(b, 100, 300, false); h.wait(90); h.up(b, 100, 300); h.wait(200); h.up(a, X + 60, Y); });
row('touch', 'canvas: two fingers tapped together', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(90); h.up(a, X, Y); h.up(b, 120, 500); });
row('touch', 'canvas: three fingers (tuner)', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, X, Y); h.down(b, 100, 500, false); h.down(c, 300, 500, false); h.wait(100); h.up(a, X, Y); h.up(b, 100, 500); h.up(c, 300, 500); });
// ---- touch mode: the HUD splat button
row('touch', 'button: tap (150 ms)', (h) => { h.input.splatButton(true); h.wait(150); h.input.splatButton(false); });
row('touch', 'button: 280 ms (just under holdThreshold)', (h) => { h.input.splatButton(true); h.wait(280); h.input.splatButton(false); });
row('touch', 'button: hold 600 ms', (h) => { h.input.splatButton(true); h.wait(600); h.input.splatButton(false); });
row('touch', 'button: hold 10 s (full charge)', (h) => { h.input.splatButton(true); h.wait(10000); h.input.splatButton(false); });
row('touch', 'button: hold 1.5 s then slide off', (h) => { h.input.splatButton(true); h.wait(1500); h.input.splatButton(false, true); });
row('touch', 'button: 200 ms then slide off (no tap)', (h) => { h.input.splatButton(true); h.wait(200); h.input.splatButton(false, true); });
row('touch', 'button hold 1 s while steering with the other thumb', (h) => { const a = newId(); h.down(a, X, Y); h.slide(a, X, Y, 70, 0, 200); h.input.splatButton(true); h.wait(1000); h.input.splatButton(false); h.up(a, X + 70, Y); });
row('touch', 'lever: tap up / tap down / hold', (h) => { h.input.turboShift(1); h.wait(200); h.input.turboShift(-1); h.wait(200); h.input.turboHold(true); h.wait(500); h.input.turboHold(false); });
// ---- tilt mode: the whole screen
row('tilt', 'screen: quick tap (120 ms)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(120); h.up(id, X, Y); });
row('tilt', 'screen: 280 ms (just under holdThreshold)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(280); h.up(id, X, Y); });
row('tilt', 'screen: hold 320 ms (just over)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(320); h.up(id, X, Y); });
row('tilt', 'screen: hold 2 s', (h) => { const id = newId(); h.down(id, X, Y); h.wait(2000); h.up(id, X, Y); });
row('tilt', 'screen: hold 2 s with an 8 px wobble', (h) => { const id = newId(); h.down(id, X, Y); for (let i = 0; i < 20; i++) { h.wait(100); h.move(id, X + (i % 2 ? 8 : -6), Y + (i % 3) * 3); } h.up(id, X, Y); });
row('tilt', 'screen: swipe up 70 px in 160 ms, lift', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 6, -70, 160); h.up(id, X + 6, Y - 70); });
row('tilt', 'screen: swipe up and keep holding 1 s (boost)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 0, -70, 160); h.wait(1000); h.up(id, X, Y - 70); });
row('tilt', 'screen: swipe down 70 px', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, -5, 70, 160); h.up(id, X - 5, Y + 70); });
row('tilt', 'screen: sideways drag 60 px (nothing)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 60, 8, 250); h.up(id, X + 60, Y + 8); });
row('tilt', 'screen: slow vertical drag 70 px over 900 ms (not a swipe)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 0, -70, 900); h.up(id, X, Y - 70); });
row('tilt', 'screen: hold 1 s then slide 60 px (charge cancelled)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(1000); h.slide(id, X, Y, 60, 0, 150); h.wait(200); h.up(id, X + 60, Y); });
row('tilt', 'screen: hold 1 s then swipe up (charge cancelled, no shift)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(1000); h.slide(id, X, Y, 0, -80, 120); h.up(id, X, Y - 80); });
row('tilt', 'screen: charging + second finger tap', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(800); h.down(b, 120, 300, false); h.wait(90); h.up(b, 120, 300); h.wait(400); h.up(a, X, Y); });
row('tilt', 'screen: two fingers tapped together', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(90); h.up(a, X, Y); h.up(b, 120, 500); });
row('tilt', 'screen: three fingers (tuner)', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, X, Y); h.down(b, 100, 500, false); h.down(c, 300, 500, false); h.wait(100); h.up(a, X, Y); h.up(b, 100, 500); h.up(c, 300, 500); });
row('tilt', 'screen: hold 1 s, pointercancel (OS took the touch)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(1000); h.cancel(id, X, Y); });
row('tilt', 'screen: hold 1 s, app loses focus', (h) => { const id = newId(); h.down(id, X, Y); h.wait(1000); win.dispatch('blur', {}); h.wait(100); h.up(id, X, Y); });
// ---- keyboard
row('keyboard', 'Space tap (100 ms)', (h) => { win.dispatch('keydown', key('Space')); h.wait(100); win.dispatch('keyup', key('Space')); });
row('keyboard', 'Space hold 1.5 s (auto-repeat keydowns)', (h) => { win.dispatch('keydown', key('Space')); for (let i = 0; i < 10; i++) { h.wait(150); win.dispatch('keydown', key('Space', true)); } win.dispatch('keyup', key('Space')); });
row('keyboard', 'E, Q, Shift held 500 ms', (h) => { win.dispatch('keydown', key('KeyE')); win.dispatch('keyup', key('KeyE')); h.wait(50); win.dispatch('keydown', key('KeyQ')); win.dispatch('keyup', key('KeyQ')); win.dispatch('keydown', key('ShiftLeft')); h.wait(500); win.dispatch('keyup', key('ShiftLeft')); });
row('keyboard', 'Space hold 1 s, window blur', (h) => { win.dispatch('keydown', key('Space')); h.wait(1000); win.dispatch('blur', {}); win.dispatch('keyup', key('Space')); });

mkdirSync('shots/controls/sim', { recursive: true });
writeFileSync('shots/controls/sim/gestures.json', JSON.stringify({ holdThreshold: config.splat.holdThreshold, rows }, null, 1));
for (const r of rows) console.log(`${r.mode.padEnd(8)} | ${r.gesture.padEnd(62)} | ${r.events.join(', ') || '-'}${r.maxChargeHeld ? ` | chargeHeld max ${r.maxChargeHeld}` : ''}${r.dragging ? ' | steering' : ''}${r.turboHeld ? ' | turboHeld' : ''}`);
void doc;
