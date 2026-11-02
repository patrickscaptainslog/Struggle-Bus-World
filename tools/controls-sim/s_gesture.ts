// The gesture table (docs/specs/flight/THUMBS.md) through the REAL Input, Shifter and TurboDrive, offline: synthetic pointer
// and key events on a controlled clock, one frame every 16.7 ms like the game loop. Writes the table to
// shots/controls/sim/gestures.json (+ a readable one on stdout). Every row of the first thumb alone keeps main's name, so
// the file can be held against main's.
import { installDom, Target, clock, ptr, newId, key, runTimers } from './fakedom';
const { win, doc } = installDom();
import { mkdirSync, writeFileSync } from 'node:fs';

const { Input, inputTune, readFlick } = await import('@src/game/Input');
const { Shifter } = await import('@src/game/Shifter');
const { TurboDrive } = await import('@src/game/Turbo');
const { Flight } = await import('@src/game/Flight');
const { config } = await import('@src/config');
const { migratePrefs } = await import('@src/game/controlPrefs');

type Ev = string;
const BOUNDS = [-20000, -20000, 20000, 20000];

function harness(mode: 'touch' | 'keyboard', fps = 60) {
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode(mode);
  const flight = new Flight();
  flight.y = 400;
  const drive = new TurboDrive(BOUNDS);
  const shifter = new Shifter(drive, flight, (by, now) => input.flickInFlight(by, now));
  const evs: Ev[] = [];
  let t0 = clock.ms;
  const at = () => `${Math.round(clock.ms - t0)}ms`;
  input.onTap = () => evs.push(`tap@${at()}`);
  input.onChargeStart = () => evs.push(`chargeStart@${at()}`);
  input.onChargeEnd = (h, c) => evs.push(`chargeEnd(${h.toFixed(2)}s${c ? ', cancelled' : ''})@${at()}`);
  input.onTurbo = (d, a, b) => {
    evs.push(`flick${d > 0 ? '+' : '-'}@${at()}`);
    shifter.flick(d, a, b);
  };
  input.onTripleFinger = () => evs.push(`tuner@${at()}`);
  shifter.onAnswer = (a) => evs.push(`${a}@${at()}`);
  drive.onEvent = (ev, g) => evs.push(`${ev}${g}@${at()}`);
  let maxCharge = 0, sawDrag = false, sawTurboHeld = false, sawThumb = false;
  let lookFrom = -1, lookTo = -1, lookMax = 0;
  // (16.7 as main's harness had it, so a row of main's lands on the same frames)
  const step = fps === 60 ? 16.7 : 1000 / fps;
  const frame = () => {
    input.update(1 / fps);
    shifter.tick(clock.ms);
    drive.update(1 / fps, flight, input.state.turboHeld);
    maxCharge = Math.max(maxCharge, input.state.chargeHeld);
    if (input.state.dragging) sawDrag = true;
    if (input.state.thumb) sawThumb = true;
    if (input.state.turboHeld) sawTurboHeld = true;
    const L = input.state.look;
    if (L.on) {
      if (lookFrom < 0) lookFrom = Math.round(clock.ms - t0);
      lookTo = Math.round(clock.ms - t0);
      lookMax = Math.max(lookMax, Math.hypot(L.x, L.y));
    }
  };
  /** advance the clock by ms, running frames, whatever the step size of the waits */
  let nextFrame = clock.ms + step;
  const wait = (ms: number) => {
    const end = clock.ms + ms;
    while (nextFrame <= end) {
      clock.ms = nextFrame;
      runTimers();
      frame();
      nextFrame += step;
    }
    clock.ms = end;
    runTimers();
  };
  return {
    input, el, evs, drive, shifter, flight, inputTune,
    reset() { evs.length = 0; t0 = clock.ms; nextFrame = clock.ms + step; maxCharge = 0; sawDrag = false; sawThumb = false; sawTurboHeld = false; lookFrom = lookTo = -1; lookMax = 0; },
    down(id: number, x: number, y: number, primary = true, extra = {}) { el.dispatch('pointerdown', ptr('pointerdown', id, x, y, primary, extra)); },
    move(id: number, x: number, y: number, extra = {}) { el.dispatch('pointermove', ptr('pointermove', id, x, y, true, extra)); },
    up(id: number, x: number, y: number, extra = {}) { el.dispatch('pointerup', ptr('pointerup', id, x, y, true, extra)); },
    cancel(id: number, x: number, y: number) { el.dispatch('pointercancel', ptr('pointercancel', id, x, y)); },
    /** move from (x0, y0) by (dx, dy) over ms in steps of `every` ms */
    slide(id: number, x0: number, y0: number, dx: number, dy: number, ms: number, every = 16.7) {
      const n = Math.max(1, Math.round(ms / every));
      for (let i = 1; i <= n; i++) { wait(ms / n); this.move(id, x0 + (dx * i) / n, y0 + (dy * i) / n); }
    },
    /** one stroke, lifted: a flick when it is quick enough. primary = nothing else is on the glass */
    stroke(x: number, y: number, dx: number, dy: number, ms: number, primary = true, every = 16.7) {
      const id = newId();
      this.down(id, x, y, primary);
      this.slide(id, x, y, dx, dy, ms, every);
      this.up(id, x + dx, y + dy);
    },
    wait, frame,
    result() { return { events: [...evs], maxChargeHeld: +maxCharge.toFixed(2), dragging: sawDrag, thumb: sawThumb, turboHeld: sawTurboHeld, look: lookFrom < 0 ? null : { from: lookFrom, to: lookTo, max: Math.round(lookMax) }, gear: drive.gear, level: drive.level }; },
  };
}
type H = ReturnType<typeof harness>;

const rows: Array<{ mode: string; gesture: string; events: string[]; note?: unknown } & ReturnType<H['result']>> = [];
function row(mode: 'touch' | 'keyboard', gesture: string, fn: (h: H) => unknown, fps = 60) {
  const h = harness(mode, fps);
  h.wait(100);
  h.reset();
  const note = fn(h);
  h.wait(600);
  rows.push({ mode, gesture, ...h.result(), note });
  h.input.dispose();
}
/** the player's own hands, in the words of the table */
const X = 200, Y = 600;
const LX = 100, LY = 560; // a left thumb
const RX = 300, RY = 600; // a right thumb
/** a steering right thumb, down until the row lifts it (it has moved off its landing) */
const steer = (h: H) => { const a = newId(); h.down(a, RX, RY); h.slide(a, RX, RY, 30, 0, 300); return a; };
const flickUp = (h: H, primary = false) => h.stroke(LX, LY, 0, -74, 85, primary);
const flickDown = (h: H, primary = false) => h.stroke(LX, 500, 0, 74, 85, primary);
/** two thumbs together, then both lifted: the memory is on, the left thumb was the far one */
const together = (h: H) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(300); h.up(b, LX, LY); h.up(a, RX + 30, RY); h.wait(50); };
/** turbo, a double flick by the second thumb */
const double = (h: H) => { flickUp(h); h.wait(150); flickUp(h); };

// ---- the first thumb alone (rows from main, same names)
row('touch', 'canvas: quick tap (120 ms, still)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(120); h.up(id, X, Y); });
row('touch', 'canvas: slow tap (260 ms, still)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(260); h.up(id, X, Y); });
row('touch', 'canvas: slow tap 440 ms, still', (h) => { const id = newId(); h.down(id, X, Y); h.wait(440); h.up(id, X, Y); });
row('touch', 'canvas: 460 ms, still (past stillTapMs)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(460); h.up(id, X, Y); });
row('touch', 'canvas: hold 1 s still (bungee at neutral, no charge)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(1000); h.up(id, X, Y); });
row('touch', 'canvas: drag 80 px (steer)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 80, 0, 300); h.up(id, X + 80, Y); });
row('touch', 'canvas: quick flick 20 px in 90 ms (still a tap)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 20, 0, 90); h.up(id, X + 20, Y); });
row('touch', 'canvas: two fingers tapped together', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(90); h.up(a, X, Y); h.up(b, 120, 500); });
row('touch', 'canvas: two fingers, both lift at 400 ms', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(370); h.up(a, X, Y); h.up(b, 120, 500); });
row('touch', 'canvas: two fingers, both lift at 470 ms', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(440); h.up(a, X, Y); h.up(b, 120, 500); });
row('touch', 'canvas: three fingers (tuner)', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, X, Y); h.down(b, 100, 500, false); h.down(c, 300, 500, false); h.wait(100); h.up(a, X, Y); h.up(b, 100, 500); h.up(c, 300, 500); });
row('touch', 'first thumb on the left: a tap', (h) => { const id = newId(); h.down(id, LX, LY); h.wait(120); h.up(id, LX, LY); });
row('touch', 'first thumb on the left: a slow drag steers, no command', (h) => { const id = newId(); h.down(id, LX, LY); h.slide(id, LX, LY, 0, -90, 400); h.up(id, LX, LY - 90); });

// ---- the second thumb
row('touch', 'second: tap while steering, on the lift', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); (h as any).landed = h.evs.length; h.wait(90); h.up(b, LX, LY); h.wait(100); h.up(a, RX + 30, RY); return { firedOnLanding: (h as any).landed > 0 }; });
row('touch', 'second: tap at 220 ms', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(220); h.up(b, LX, LY); h.up(a, RX + 30, RY); });
row('touch', 'second: rests 260 ms, lifts (nothing)', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(260); h.up(b, LX, LY); h.up(a, RX + 30, RY); });
row('touch', 'second: rests 1 s (nothing)', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(1000); h.up(b, LX, LY); h.up(a, RX + 30, RY); });
row('touch', 'second: on a still first, past 230 ms, tapped', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(300); h.down(b, 120, 500, false); h.wait(60); h.up(b, 120, 500); h.wait(30); h.up(a, X, Y); });
row('touch', 'second: two taps while steering', (h) => { const a = steer(h); for (let i = 0; i < 2; i++) { const b = newId(); h.down(b, LX, LY, false); h.wait(80); h.up(b, LX, LY); h.wait(200); } h.up(a, RX + 30, RY); });
row('touch', 'second: drag that stays down: looks, the stick untouched', (h) => {
  const a = steer(h);
  h.wait(20);
  const sx = h.input.state.stretch.x, sy = h.input.state.stretch.y;
  const b = newId();
  h.down(b, LX, LY, false);
  h.wait(40);
  const early = h.input.state.look.on;
  h.slide(b, LX, LY, 60, -40, 200);
  h.wait(20);
  const L = { ...h.input.state.look };
  const same = h.input.state.stretch.x === sx && h.input.state.stretch.y === sy;
  h.slide(b, LX + 60, LY - 40, -20, 20, 100);
  h.wait(20);
  const back = { ...h.input.state.look };
  h.up(b, LX + 40, LY - 20);
  h.wait(20);
  const after = { ...h.input.state.look };
  const stillSteering = h.input.state.thumb;
  h.up(a, RX + 30, RY);
  return { early, L, same, back, after, stillSteering };
});
row('touch', 'second: a tap with the first hand while the other looks', (h) => { together(h); h.wait(500); const b = newId(); h.down(b, LX, LY); h.slide(b, LX, LY, 60, 0, 200); const a = newId(); h.down(a, RX, RY, false); h.wait(90); h.up(a, RX, RY); h.wait(30); const on = h.input.state.look.on; h.up(b, LX + 60, LY); return { on }; });
row('touch', 'second: rests 500 ms, then drags (a look at once)', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(500); h.slide(b, LX, LY, 30, 0, 100); h.wait(30); const on = h.input.state.look.on; h.up(b, LX + 30, LY); h.up(a, RX + 30, RY); return { on }; });
row('touch', 'second: a look does not count as a thumb', (h) => { const a = newId(); h.down(a, X, Y); h.wait(40); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 40, 0, 200); const thumb = h.input.state.thumb; h.up(b, LX + 40, LY); h.up(a, X, Y); return { thumb }; });
row('touch', 'second: flick up: answered on the lift, the gear 320 ms later', (h) => { const a = steer(h); flickUp(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'second: flick down at G0 (nothing to do)', (h) => { const a = steer(h); flickDown(h); h.up(a, RX + 30, RY); });
row('touch', 'second: flick down at G1', (h) => { const a = steer(h); h.drive.shift(1, h.flight); h.wait(50); flickDown(h); h.up(a, RX + 30, RY); });
row('touch', 'second: flick sideways (nothing)', (h) => { const a = steer(h); h.stroke(LX, LY, 74, 0, 85, false); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'second: slow 60 px in 300 ms (a look, no gear)', (h) => { const a = steer(h); h.stroke(LX, LY, 0, -60, 300, false); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'second: the flick starts at 30 px in 100 ms', (h) => { const a = steer(h); h.stroke(LX, LY, 0, -30, 100, false); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'second: 29 px is not a flick', (h) => { const a = steer(h); h.stroke(LX, LY, 0, -29, 100, false); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'second: 70 px in 240 ms is too long', (h) => { const a = steer(h); h.stroke(LX, LY, 0, -70, 240, false); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'second: 40 px in 180 ms is too slow', (h) => { const a = steer(h); h.stroke(LX, LY, 0, -40, 180, false); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'second: 49 degrees off vertical still counts', (h) => { const a = steer(h); h.stroke(LX, LY, 49, -43, 85, false); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'second: 52 degrees off vertical does not', (h) => { const a = steer(h); h.stroke(LX, LY, 51, -40, 85, false); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'second: out and back: one touch, one reading, the return never counts', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 0, -70, 80); h.slide(b, LX, LY - 70, 0, 70, 80); h.up(b, LX, LY); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'second: a flick at 30 touches a second reads the same', (h) => { const a = steer(h); h.stroke(LX, LY, 0, -74, 85, false, 33); h.wait(400); h.up(a, RX + 30, RY); }, 30);
row('touch', 'second: a flick with no move event at all reads the same', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(85); h.up(b, LX, LY - 74); h.wait(400); h.up(a, RX + 30, RY); });

// ---- two flicks, and turbo
row('touch', 'double: turbo, the waiting gear dropped', (h) => { const a = steer(h); double(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'double: from no thumb at all, lone left strokes', (h) => { h.stroke(LX, LY, 0, -74, 85); h.wait(150); h.stroke(LX, LY, 0, -74, 85); });
row('touch', 'double: the second lands inside the window and lifts after it: still turbo', (h) => { const a = steer(h); flickUp(h); h.wait(300); flickUp(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'double: the second lands past the window: a gear, then another try', (h) => { const a = steer(h); flickUp(h); h.wait(340); flickUp(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'double: at G1, no LOCKED', (h) => { const a = steer(h); h.drive.shift(1, h.flight); h.wait(50); double(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'flick up with turbo on: a gear, turbo stays', (h) => { const a = steer(h); double(h); h.wait(500); flickUp(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'stack: a second double adds a level', (h) => { const a = steer(h); double(h); h.wait(500); double(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'stack: a third double is the top level', (h) => { const a = steer(h); for (let i = 0; i < 3; i++) { double(h); h.wait(500); } h.up(a, RX + 30, RY); });
row('touch', 'stack: a fourth double is LOCKED, the level stands', (h) => { const a = steer(h); for (let i = 0; i < 4; i++) { double(h); h.wait(500); } h.up(a, RX + 30, RY); });
row('touch', 'flick down ends all turbo at once, the gear stays', (h) => { const a = steer(h); h.drive.shift(1, h.flight); h.wait(50); for (let i = 0; i < 3; i++) { double(h); h.wait(500); } flickDown(h); h.wait(50); h.up(a, RX + 30, RY); });
row('touch', 'the next flick down drops the gear', (h) => { const a = steer(h); h.drive.shift(1, h.flight); h.wait(50); double(h); h.wait(500); flickDown(h); h.wait(100); flickDown(h); h.wait(50); h.up(a, RX + 30, RY); });
row('touch', 'undo: a flick down takes the waiting gear back', (h) => { const a = steer(h); flickUp(h); h.wait(60); flickDown(h); h.wait(600); h.up(a, RX + 30, RY); });
row('touch', 'undo: with turbo on it takes the gear back and leaves turbo', (h) => { const a = steer(h); double(h); h.wait(500); flickUp(h); h.wait(60); flickDown(h); h.wait(600); h.up(a, RX + 30, RY); });
row('touch', 'undo: a flick down past the window, the gear engaged, is a gear down', (h) => { const a = steer(h); flickUp(h); h.wait(500); flickDown(h); h.wait(100); h.up(a, RX + 30, RY); return { hold: h.flight.holdY }; });
row('touch', 'undo: a gear still lifting is taken back: the bus goes back to what it was doing', (h) => { h.flight.y = 5; const a = steer(h); flickUp(h); h.wait(500); const lifting = h.drive.gear === 1 && !h.drive.engaged; flickDown(h); h.wait(100); h.up(a, RX + 30, RY); return { lifting, hold: h.flight.holdY }; });
row('touch', 'LOCKED waits for the window', (h) => { const a = steer(h); h.drive.shift(1, h.flight); h.wait(50); flickUp(h); const at = h.evs.length; h.wait(200); const early = h.evs.slice(at); h.wait(300); h.up(a, RX + 30, RY); return { early }; });
row('touch', 'the gate: a flick is answered and waits for it', (h) => { h.shifter.locked = true; const a = steer(h); flickUp(h); h.wait(800); const armed = h.shifter.armed, gated = h.shifter.gated, g0 = h.drive.gear; h.shifter.locked = false; h.wait(50); h.up(a, RX + 30, RY); return { armed, gated, g0 }; });
row('touch', 'the gate: a flick down takes it back', (h) => { h.shifter.locked = true; const a = steer(h); flickUp(h); h.wait(800); flickDown(h); h.wait(50); h.shifter.locked = false; h.wait(100); h.up(a, RX + 30, RY); });
row('touch', 'the gate: inside the window too', (h) => { h.shifter.locked = true; const a = steer(h); flickUp(h); h.wait(60); flickDown(h); h.wait(500); h.shifter.locked = false; h.wait(100); h.up(a, RX + 30, RY); });
row('touch', 'the gate: a double is turbo, with no gear behind it', (h) => { h.shifter.locked = true; const a = steer(h); double(h); h.wait(500); h.shifter.locked = false; h.wait(100); h.up(a, RX + 30, RY); });

// ---- the lone strokes
row('touch', 'lone left flick up: steers, then the gear', (h) => { const id = newId(); h.down(id, LX, LY); h.slide(id, LX, LY, 0, -74, 85); const steered = h.input.state.thumb; const sy = h.input.state.stretch.y; h.up(id, LX, LY - 74); h.wait(20); const after = h.input.state.thumb; h.wait(500); return { steered, sy, after }; });
row('touch', 'lone left flick down at G1', (h) => { h.drive.shift(1, h.flight); h.wait(50); h.stroke(LX, 500, 0, 74, 85); });
row('touch', 'lone left: 34 px is under the firm rule', (h) => { h.stroke(LX, LY, 0, -34, 80); });
row('touch', 'lone left: 36 px in 80 ms is a flick', (h) => { h.stroke(LX, LY, 0, -36, 80); });
row('touch', 'lone left: 90 px in 210 ms is too long', (h) => { h.stroke(LX, LY, 0, -90, 210); });
row('touch', 'lone left: 40 px in 120 ms is too slow', (h) => { h.stroke(LX, LY, 0, -40, 120); });
row('touch', 'lone left: 38 degrees off vertical still counts', (h) => { h.stroke(LX, LY, 39, -50, 85); });
row('touch', 'lone left: 43 degrees off vertical does not', (h) => { h.stroke(LX, LY, 47, -50, 85); });
row('touch', 'lone right flick up: never a shift', (h) => { h.stroke(RX, RY, 0, -74, 85); h.wait(400); });
row('touch', 'lone right flick down: never a shift', (h) => { h.drive.shift(1, h.flight); h.wait(50); h.evs.length = 0; h.stroke(RX, 500, 0, 74, 85); h.wait(400); });
row('touch', 'lone right two flicks: nothing', (h) => { h.stroke(RX, RY, 0, -74, 85); h.wait(150); h.stroke(RX, RY, 0, -74, 85); h.wait(400); });
row('touch', 'swapped: lone right flick up is the flick', (h) => { h.input.swapped = true; h.stroke(RX, RY, 0, -74, 85); });
row('touch', 'swapped: lone left flick up is not', (h) => { h.input.swapped = true; h.stroke(LX, LY, 0, -74, 85); h.wait(400); });
row('touch', 'a thumb landing during a lone flick flies, from where it landed', (h) => {
  const a = newId(), b = newId();
  h.down(a, LX, LY);
  h.slide(a, LX, LY, 0, -40, 40);
  h.down(b, RX, RY, false);
  h.slide(b, RX, RY, 30, 0, 40);
  h.up(a, LX, LY - 74);
  h.wait(20);
  const thumb = h.input.state.thumb, sx = h.input.state.stretch.x, look = h.input.state.look.on;
  h.up(b, RX + 30, RY);
  return { thumb, sx, look };
});
row('touch', 'a steering left thumb that is not a flick keeps the second thumb second', (h) => {
  const a = newId(), b = newId();
  h.down(a, LX, LY);
  h.slide(a, LX, LY, 0, -90, 300);
  h.down(b, RX, RY, false);
  h.slide(b, RX, RY, 30, 0, 200);
  h.wait(20);
  const look = h.input.state.look.on;
  h.up(a, LX, LY - 90);
  h.up(b, RX + 30, RY);
  return { look };
});

// ---- the bands
row('touch', 'bottom band: a lone left stroke is never a command', (h) => { h.stroke(LX, 820, 0, -74, 85); h.wait(400); });
row('touch', 'bottom band: 811 px, 41 px from the bottom, is a stroke again', (h) => { h.stroke(LX, 811, 0, -74, 85); h.wait(400); });
row('touch', 'bottom band: a second thumb never commands either', (h) => { const a = steer(h); h.stroke(LX, 820, 0, -74, 85, false); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'bottom band: a second thumb still taps', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, 820, false); h.wait(90); h.up(b, LX, 820); h.up(a, RX + 30, RY); });
row('touch', 'bottom band: a second thumb still looks', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, 820, false); h.slide(b, LX, 820, 40, -40, 200); h.up(b, LX + 40, 780); h.up(a, RX + 30, RY); });
row('touch', 'side band: a lone left stroke 10 px in is never a command', (h) => { h.stroke(10, LY, 0, -74, 85); h.wait(400); });
row('touch', 'side band: a second thumb 10 px from the right edge', (h) => { const a = newId(); h.down(a, LX, LY); h.slide(a, LX, LY, 30, 0, 300); h.stroke(383, 500, 0, -74, 85, false); h.wait(400); h.up(a, LX + 30, LY); });

// ---- the memory
row('touch', 'memory: the look thumb stays one when the flying thumb lifts', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); h.up(a, RX + 30, RY); h.wait(30); const on = h.input.state.look.on, thumb = h.input.state.thumb; h.slide(b, LX + 60, LY, 30, 0, 100); const x = h.input.state.look.x; h.up(b, LX + 90, LY); return { on, thumb, x }; });
row('touch', 'memory: a lone touch on the far side looks, it does not steer', (h) => { together(h); h.wait(5000); const b = newId(); h.down(b, LX, LY); h.slide(b, LX, LY, 60, 0, 200); h.wait(30); const on = h.input.state.look.on, thumb = h.input.state.thumb; h.up(b, LX + 60, LY); return { on, thumb }; });
row('touch', 'memory: a lone tap on the far side splats on its lift', (h) => { together(h); h.wait(1000); const b = newId(); h.down(b, LX, LY); h.wait(90); h.up(b, LX, LY); });
row('touch', 'memory: a lone tap on the far side, 260 ms, does nothing', (h) => { together(h); h.wait(1000); const b = newId(); h.down(b, LX, LY); h.wait(260); h.up(b, LX, LY); });
row('touch', 'memory: a lone flick on the far side reads the second thumb\'s rule', (h) => { together(h); h.wait(1000); h.stroke(LX, LY, 0, -30, 100); });
row('touch', 'memory: a lone touch on the near side flies', (h) => { together(h); h.wait(1000); const a = newId(); h.down(a, RX, RY); h.slide(a, RX, RY, 60, 0, 200); h.wait(20); const thumb = h.input.state.thumb; h.up(a, RX + 60, RY); return { thumb }; });
row('touch', 'memory: 29 s on, still the second thumb', (h) => { together(h); h.wait(29000); const b = newId(); h.down(b, LX, LY); h.slide(b, LX, LY, 60, 0, 200); h.wait(30); const on = h.input.state.look.on; h.up(b, LX + 60, LY); return { on }; });
row('touch', 'memory: 31 s on, it steers again', (h) => { together(h); h.wait(31000); const b = newId(); h.down(b, LX, LY); h.slide(b, LX, LY, 60, 0, 200); h.wait(30); const on = h.input.state.look.on, thumb = h.input.state.thumb; h.up(b, LX + 60, LY); return { on, thumb }; });
row('touch', 'memory: the other way round: left flew, a lone right touch looks', (h) => { const a = newId(); h.down(a, LX, LY); h.slide(a, LX, LY, 30, 0, 300); const b = newId(); h.down(b, RX, RY, false); h.wait(300); h.up(b, RX, RY); h.up(a, LX + 30, LY); h.wait(1000); const c = newId(); h.down(c, RX, RY); h.slide(c, RX, RY, 40, 0, 200); h.wait(30); const on = h.input.state.look.on; h.up(c, RX + 40, RY); return { on }; });
row('touch', 'memory: the flying thumb back down during a lone look: flies, the look stays', (h) => { together(h); h.wait(1000); const b = newId(); h.down(b, LX, LY); h.slide(b, LX, LY, 60, 0, 200); const a = newId(); h.down(a, RX, RY, false); h.slide(a, RX, RY, 40, 0, 200); h.wait(20); const on = h.input.state.look.on, thumb = h.input.state.thumb; h.up(a, RX + 40, RY); h.up(b, LX + 60, LY); return { on, thumb }; });
row('touch', 'memory: two fingers tapped, one landing by memory: one splat', (h) => { together(h); h.wait(1000); const b = newId(), a = newId(); h.down(b, LX, LY); h.wait(30); h.down(a, RX, RY, false); h.wait(80); h.up(b, LX, LY); h.up(a, RX, RY); });

// ---- MEGA
row('touch', 'button: tap (150 ms)', (h) => { h.input.splatButton(true); h.wait(150); h.input.splatButton(false); });
row('touch', 'button: 280 ms (just under holdThreshold)', (h) => { h.input.splatButton(true); h.wait(280); h.input.splatButton(false); });
row('touch', 'button: hold 600 ms', (h) => { h.input.splatButton(true); h.wait(600); h.input.splatButton(false); });
row('touch', 'button: hold 10 s (full charge)', (h) => { h.input.splatButton(true); h.wait(10000); h.input.splatButton(false); });
row('touch', 'button: hold 1.5 s then slide off', (h) => { h.input.splatButton(true); h.wait(1500); h.input.splatButton(false, true); });
row('touch', 'button: 200 ms then slide off (no tap)', (h) => { h.input.splatButton(true); h.wait(200); h.input.splatButton(false, true); });
row('touch', 'button hold 1 s while steering with the other thumb', (h) => { const a = newId(); h.down(a, X, Y); h.slide(a, X, Y, 70, 0, 200); h.input.splatButton(true); h.wait(1000); h.input.splatButton(false); h.up(a, X + 70, Y); });
// (the HUD's slide rule, run here against the real adoptThumb)
const MX = 339, MY = 383;
const pressMega = (h: any, id: number) => { h.t0 = clock.ms; h.id = id; h.input.splatButton(true, false, clock.ms); };
const adopt = (h: any, x: number, y: number, keep: boolean) => {
  const e = ptr('pointermove', h.id, x, y);
  const ok = h.input.adoptThumb(e, keep, MX, MY, h.t0);
  if (ok && !keep) h.input.splatButton(false, true, clock.ms);
  return ok;
};
row('touch', 'adopt: 14 px, lift inside the quick window (one splat)', (h) => { const id = newId(); pressMega(h, id); h.wait(60); adopt(h, MX - 15, MY, false); h.wait(30); h.up(id, MX - 15, MY); });
row('touch', 'adopt: before the charge, lift later (no splat)', (h) => { const id = newId(); pressMega(h, id); h.wait(100); adopt(h, MX - 15, MY, false); h.slide(id, MX - 15, MY, -40, 0, 300); h.up(id, MX - 55, MY); });
row('touch', 'adopt: while charging, then lift (one chargeEnd, no tap)', (h) => { const id = newId(); pressMega(h, id); h.wait(1200); adopt(h, MX - 30, MY, true); h.slide(id, MX - 30, MY, -40, 0, 400); h.up(id, MX - 70, MY); });
row('touch', 'adopt: refused while a thumb steers (MEGA keeps its press)', (h) => { const a = newId(), id = newId(); h.down(a, 80, 600); h.slide(a, 80, 600, 40, 0, 200); pressMega(h, id); h.wait(100); (h as any).refused = adopt(h, MX - 15, MY, false); h.wait(60); h.input.splatButton(false, false, clock.ms); h.up(a, 120, 600); });
row('touch', 'adopt: second finger taps during it', (h) => { const id = newId(), b = newId(); pressMega(h, id); h.wait(500); adopt(h, MX - 30, MY, true); h.wait(100); h.down(b, 100, 300, false); h.wait(60); h.up(b, 100, 300); h.wait(100); h.up(id, MX - 30, MY); });
row('touch', 'adopt: a look thumb stays one while MEGA\'s finger takes the stick', (h) => { together(h); h.wait(500); const b = newId(); h.down(b, LX, LY); h.slide(b, LX, LY, 60, 0, 200); const id = newId(); pressMega(h, id); h.wait(100); adopt(h, MX - 15, MY, false); h.wait(30); const on = h.input.state.look.on, thumb = h.input.state.thumb; h.up(id, MX - 15, MY); h.up(b, LX + 60, LY); return { on, thumb }; });
row('touch', 'adopt: charging, pointercancel on the lift', (h) => { const id = newId(); pressMega(h, id); h.wait(800); adopt(h, MX - 30, MY, true); h.wait(100); h.cancel(id, MX - 30, MY); });
row('touch', 'adopt: charging, the pointer is dropped (repeat id)', (h) => { const id = newId(); pressMega(h, id); h.wait(800); adopt(h, MX - 30, MY, true); h.wait(100); h.down(id, 200, 500); h.wait(30); h.up(id, 200, 500); });

// ---- three fingers
row('touch', 'three: with a steering thumb they are no tuner', (h) => { const a = steer(h); const b = newId(), c = newId(); h.down(b, LX, LY, false); h.down(c, 200, 400, false); h.wait(80); h.up(b, LX, LY); h.up(c, 200, 400); h.up(a, RX + 30, RY); });
row('touch', 'three: swallowed: no tap, no look, no stick, whatever they do after', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, X, Y); h.down(b, 100, 500, false); h.down(c, 300, 500, false); h.slide(b, 100, 500, 0, -74, 85); h.slide(a, X, Y, 40, 0, 200); const thumb = h.input.state.thumb; h.up(a, X + 40, Y); h.up(b, 100, 426); h.up(c, 300, 500); return { thumb }; });
row('touch', 'three: the next touch is a fresh one', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, X, Y); h.down(b, 100, 500, false); h.down(c, 300, 500, false); h.wait(100); h.up(a, X, Y); h.up(b, 100, 500); h.up(c, 300, 500); h.wait(100); const d = newId(); h.down(d, X, Y); h.wait(100); h.up(d, X, Y); });

// ---- a lost pointer
row('touch', 'lost: a look thumb gone silent lets go of the view, and a move brings it back', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); h.wait(7500); const held = h.input.state.look.on; h.wait(800); const lapsed = !h.input.state.look.on; h.move(b, LX + 70, LY); h.wait(30); const back = h.input.state.look.on; h.up(b, LX + 70, LY); h.up(a, RX + 30, RY); return { held, lapsed, back }; });
row('touch', 'lost: the last touch ended with no pointerup', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); h.el.dispatch('touchend', { touches: [], cancelable: true, preventDefault() {} }); h.wait(100); const on = h.input.state.look.on, thumb = h.input.state.thumb; const c = newId(); h.down(c, RX, RY); h.wait(100); h.up(c, RX, RY); return { on, thumb }; });
row('touch', 'lost: a stroke queued behind a touchend is no leftover', (h) => {
  // (a slow frame: the first stroke's touchend is handled late, with the next landing already in the queue, stamped earlier than now)
  h.stroke(LX, LY, 0, -74, 85);
  const landed = clock.ms + 150;
  clock.ms += 200;
  h.el.dispatch('touchend', { touches: [], cancelable: true, preventDefault() {} });
  const b = newId();
  h.el.dispatch('pointerdown', { ...ptr('pointerdown', b, LX, LY, true), timeStamp: landed });
  h.wait(70);
  h.el.dispatch('pointerup', { ...ptr('pointerup', b, LX, LY - 74), timeStamp: landed + 85 });
  h.wait(50);
});
row('touch', 'lost: pointercancel on the second thumb (no tap, no flick, the view let go)', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 0, -74, 85); h.wait(50); h.cancel(b, LX, LY - 74); h.wait(30); const on = h.input.state.look.on; h.up(a, RX + 30, RY); return { on }; });
row('touch', 'lost: pointercancel on a quick second thumb', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(60); h.cancel(b, LX, LY); h.up(a, RX + 30, RY); });
row('touch', 'lost: pointercancel on a lone stroke (no flick)', (h) => { const a = newId(); h.down(a, LX, LY); h.slide(a, LX, LY, 0, -74, 85); h.cancel(a, LX, LY - 74); });
row('touch', 'lost: a primary pointer retires what was left', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); const c = newId(); h.down(c, RX, RY); h.wait(30); const on = h.input.state.look.on; h.up(c, RX, RY); void a; return { on }; });
row('touch', 'lost: a repeated id on the second thumb', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); h.down(b, LX, LY, false); h.wait(20); const on = h.input.state.look.on; h.up(b, LX, LY); h.up(a, RX + 30, RY); return { on }; });
row('touch', 'lost: the app loses focus mid-look', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); win.dispatch('blur', {}); h.wait(30); const on = h.input.state.look.on, thumb = h.input.state.thumb; h.up(b, LX + 60, LY); h.up(a, RX + 30, RY); return { on, thumb }; });
row('touch', 'lost: turbo survives the app losing focus', (h) => { const a = steer(h); double(h); h.wait(500); win.dispatch('blur', {}); h.up(a, RX + 30, RY); });

// ---- keyboard, and the mouse
row('keyboard', 'Space tap (100 ms)', (h) => { win.dispatch('keydown', key('Space')); h.wait(100); win.dispatch('keyup', key('Space')); });
row('keyboard', 'Space hold 1.5 s (auto-repeat keydowns)', (h) => { win.dispatch('keydown', key('Space')); for (let i = 0; i < 10; i++) { h.wait(150); win.dispatch('keydown', key('Space', true)); } win.dispatch('keyup', key('Space')); });
row('keyboard', 'Space hold 1 s, window blur', (h) => { win.dispatch('keydown', key('Space')); h.wait(1000); win.dispatch('blur', {}); win.dispatch('keyup', key('Space')); });
row('keyboard', 'E: a gear, after the window', (h) => { win.dispatch('keydown', key('KeyE')); win.dispatch('keyup', key('KeyE')); });
row('keyboard', 'E twice: turbo', (h) => { win.dispatch('keydown', key('KeyE')); win.dispatch('keyup', key('KeyE')); h.wait(200); win.dispatch('keydown', key('KeyE')); win.dispatch('keyup', key('KeyE')); });
row('keyboard', 'E twice, four times: top level, then LOCKED', (h) => { for (let i = 0; i < 4; i++) { win.dispatch('keydown', key('KeyE')); win.dispatch('keyup', key('KeyE')); h.wait(200); win.dispatch('keydown', key('KeyE')); win.dispatch('keyup', key('KeyE')); h.wait(500); } });
row('keyboard', 'E held: auto-repeat is one press', (h) => { win.dispatch('keydown', key('KeyE')); for (let i = 0; i < 5; i++) { h.wait(100); win.dispatch('keydown', key('KeyE', true)); } win.dispatch('keyup', key('KeyE')); });
row('keyboard', 'Q: takes back, ends turbo, drops a gear', (h) => { h.drive.shift(1, h.flight); win.dispatch('keydown', key('KeyE')); h.wait(50); win.dispatch('keydown', key('KeyQ')); h.wait(500); win.dispatch('keydown', key('KeyE')); h.wait(100); win.dispatch('keydown', key('KeyE')); h.wait(500); win.dispatch('keydown', key('KeyQ')); h.wait(100); win.dispatch('keydown', key('KeyQ')); h.wait(100); });
row('keyboard', 'Shift held 500 ms: the boost while held', (h) => { win.dispatch('keydown', key('ShiftLeft')); h.wait(500); const lv = h.drive.boosting; win.dispatch('keyup', key('ShiftLeft')); h.wait(100); return { boosting: lv, after: h.drive.boosting }; });
row('keyboard', 'Shift on top of turbo: nothing to add, and letting go ends nothing', (h) => { win.dispatch('keydown', key('KeyE')); h.wait(100); win.dispatch('keydown', key('KeyE')); h.wait(500); win.dispatch('keydown', key('ShiftLeft')); h.wait(300); win.dispatch('keyup', key('ShiftLeft')); h.wait(100); return { boosting: h.drive.boosting }; });
const mouse = { pointerType: 'mouse', button: 2 };
const mouseL = { pointerType: 'mouse', button: 0 };
row('keyboard', 'right mouse drag: looks, lets go on the lift', (h) => { const id = newId(); h.down(id, RX, RY, true, mouse); h.wait(20); const on = h.input.state.look.on; h.move(id, RX + 50, RY - 30, mouse); h.wait(20); const L = { ...h.input.state.look }; h.up(id, RX + 50, RY - 30, mouse); h.wait(20); return { on, L, after: h.input.state.look.on, thumb: h.input.state.thumb }; });
row('keyboard', 'right mouse click: no tap', (h) => { const id = newId(); h.down(id, RX, RY, true, mouse); h.wait(60); h.up(id, RX, RY, mouse); });
row('keyboard', 'left mouse: a quick drag on the left is no flick', (h) => { const id = newId(); h.down(id, LX, LY, true, mouseL); h.slide(id, LX, LY, 0, -74, 85); h.up(id, LX, LY - 74, mouseL); h.wait(400); });
row('keyboard', 'middle mouse: nothing', (h) => { const id = newId(); h.down(id, RX, RY, true, { pointerType: 'mouse', button: 1 }); h.wait(60); h.up(id, RX, RY, mouse); });

// ---- the table's checks
const OUT = process.env.SB_OUT ?? 'shots/controls/sim';
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/gestures.json`, JSON.stringify({ holdThreshold: config.splat.holdThreshold, inputTune, levels: config.turbo.levels, levelsG0: config.turbo.levelsG0, rows }, null, 1));
const by = (g: string) => { const r = rows.find((x) => x.gesture.startsWith(g)); if (!r) throw new Error(`no row: ${g}`); return r; };
const n = (g: string, k: string) => by(g).events.filter((e) => e.startsWith(k)).length;
const taps = (g: string) => n(g, 'tap');
const note = (g: string) => by(g).note as any;
const atOf = (g: string, k: string) => { const e = by(g).events.find((x) => x.startsWith(k)); return e ? Number(e.slice(e.indexOf('@') + 1, -2)) : NaN; };
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const quiet = (g: string) => ok(!by(g).events.some((e) => /^(flick|first|gated|back|up|down|turbo|locked|engage)/.test(e)), `no command: ${g}`);

// the first thumb alone
ok(taps('canvas: quick tap') === 1, 'quick tap');
ok(taps('canvas: slow tap (260') === 1, 'the named exception: a 260 ms still press splats');
ok(taps('canvas: slow tap 440') === 1, '440 ms splats');
ok(taps('canvas: 460') === 0, '460 ms does not');
ok(taps('canvas: quick flick') === 1, 'the quick slight wander is still a tap');
ok(taps('canvas: drag 80') === 0, 'a drag never taps');
ok(by('canvas: drag 80').thumb, 'a drag steers');
ok(taps('canvas: two fingers tapped') === 1, 'two together: one tap');
ok(taps('canvas: two fingers, both lift at 400') === 1, 'two together at 400 ms: one tap');
ok(taps('canvas: two fingers, both lift at 470') === 0, 'two together at 470 ms: none');
ok(n('canvas: three fingers', 'tuner') === 1 && taps('canvas: three fingers') === 0, 'three fingers: the tuner, no tap');
ok(taps('first thumb on the left: a tap') === 1, 'a left first thumb taps');
quiet('first thumb on the left: a slow drag');
ok(by('first thumb on the left: a slow drag').thumb, 'a left first thumb flies');
for (const r of rows) if (r.gesture.startsWith('canvas')) ok(!r.events.some((e) => /^(flick|first)/.test(e)), `the first thumb never shifts: ${r.gesture}`);

// the second thumb
ok(!note('second: tap while steering').firedOnLanding, 'a second thumb does not fire on its landing');
ok(atOf('second: tap while steering', 'tap') > 380, 'the tap is on the lift');
ok(taps('second: tap at 220') === 1, 'a tap up to 230 ms');
ok(taps('second: rests 260') === 0, 'past 230 ms a second thumb is resting');
ok(taps('second: rests 1 s') === 0 && by('second: rests 1 s').look === null, 'at rest it does nothing');
quiet('second: rests 1 s');
ok(taps('second: on a still first') === 1, 'one tap on a still first, the first lifting after it');
ok(taps('second: two taps') === 2, 'each tap while steering is a tap');
{
  const v = note('second: drag that stays');
  ok(!v.early, 'the look waits 100 ms');
  ok(v.L.on && Math.round(v.L.x) === 60 && Math.round(v.L.y) === 40, `the look reads the offset from the landing, +y up: ${JSON.stringify(v.L)}`);
  ok(v.same, 'the stick is untouched by a look');
  ok(v.back.on && Math.round(v.back.x) === 40 && Math.round(v.back.y) === 20, `the look reverses at once: ${JSON.stringify(v.back)}`);
  ok(!v.after.on && v.after.x === 0 && v.after.y === 0, 'the lift ends the look at 0, 0');
  ok(v.stillSteering, 'the flying thumb flies on');
  ok(by('second: drag that stays').look!.from >= 400, 'and not before the delay');
}
ok(note('second: rests 500').on, 'a rest, then a drag: a look at once');
ok(taps('second: a tap with the first hand') === 1 && note('second: a tap with the first hand').on, 'a tap while the other thumb looks, and the look holds');
ok(!note('second: a look does not count').thumb, 'a look is never st.thumb');
ok(atOf('second: flick up', 'first') === atOf('second: flick up', 'flick+'), 'the first flick answers on its lift');
ok(atOf('second: flick up', 'up') - atOf('second: flick up', 'first') >= 320 && atOf('second: flick up', 'up') - atOf('second: flick up', 'first') < 340, 'its gear bites 320 ms later');
ok(by('second: flick up').gear === 1 && taps('second: flick up') === 0, 'a gear, no tap');
ok(by('second: flick up').look === null, 'a flick inside the look\'s delay never swings the view');
ok(by('second: flick down at G0').gear === 0 && n('second: flick down at G0', 'down') === 0, 'nothing to drop');
ok(by('second: flick down at G1').gear === 0 && n('second: flick down at G1', 'down') === 1, 'a gear down');
quiet('second: flick sideways');
ok(by('second: slow 60').gear === 0 && by('second: slow 60').look !== null, 'slow is a look');
quiet('second: slow 60');
ok(by('second: the flick starts').gear === 1, 'the start of the second thumb\'s rule');
for (const g of ['second: 29 px', 'second: 70 px in 240', 'second: 40 px in 180', 'second: 52 degrees']) quiet(g);
ok(by('second: 49 degrees').gear === 1, 'within 50 degrees');
quiet('second: out and back');
ok(by('second: a flick at 30').gear === 1, 'a flick holds at 30 touches a second');
ok(by('second: a flick with no move').gear === 1, 'a flick holds with no move event at all');

// two flicks, and turbo
ok(by('double: turbo').level === 1 && by('double: turbo').gear === 0 && n('double: turbo', 'up') === 0, 'a double is turbo, with the gear dropped');
ok(atOf('double: turbo', 'turbo') > 0 && taps('double: turbo') === 0, 'turbo at the second lift');
ok(by('double: from no thumb').level === 1 && by('double: from no thumb').gear === 0, 'a double from nothing on the glass');
ok(by('double: the second lands inside').level === 1 && by('double: the second lands inside').gear === 0 && n('double: the second lands inside', 'locked') === 0, 'the gear waits for a stroke that landed in the window');
{
  const r = by('double: the second lands past');
  ok(r.level === 0 && r.gear === 1 && n('double: the second lands past', 'locked') === 1, `past the window: a gear, then LOCKED past the last: ${r.events}`);
}
ok(by('double: at G1').level === 1 && n('double: at G1', 'locked') === 0, 'at the last gear a double is turbo, with no LOCKED');
{
  const r = by('flick up with turbo on');
  ok(r.level === 1 && r.gear === 1, 'a flick with turbo on is a gear, turbo stays');
}
ok(by('stack: a second').level === 2, 'a second double: level 2');
ok(by('stack: a third').level === 3, 'a third double: level 3');
ok(by('stack: a fourth').level === 3 && n('stack: a fourth', 'locked') === 1, 'a fourth: LOCKED, the level stands');
ok(by('flick down ends').level === 0 && by('flick down ends').gear === 1, 'one flick down ends all turbo, the gear stays');
ok(by('the next flick down').level === 0 && by('the next flick down').gear === 0, 'the next drops the gear');
ok(by('undo: a flick down').gear === 0 && n('undo: a flick down', 'up') === 0 && n('undo: a flick down', 'back') === 1, 'undo');
ok(by('undo: with turbo on').gear === 0 && by('undo: with turbo on').level === 1, 'undo leaves turbo on');
ok(by('undo: a flick down past').gear === 0 && n('undo: a flick down past', 'down') === 1 && n('undo: a flick down past', 'back') === 0 && note('undo: a flick down past').hold === 400, 'past the window, the gear in, it is a gear down that holds the height');
ok(note('undo: a gear still').lifting && by('undo: a gear still').gear === 0 && note('undo: a gear still').hold === -Infinity, 'a gear still lifting leaves the bus\'s hold as it was');
ok(note('LOCKED waits').early.length === 0 && n('LOCKED waits', 'locked') === 1, 'LOCKED only once the window has closed');
{
  const v = note('the gate: a flick is answered');
  ok(n('the gate: a flick is answered', 'gated') === 1, 'the gate answers at once');
  ok(v.armed && v.gated && v.g0 === 0, 'it waits behind the gate');
  ok(by('the gate: a flick is answered').gear === 1, 'and fires when the gate clears');
}
ok(by('the gate: a flick down').gear === 0 && n('the gate: a flick down', 'back') === 1, 'taken back behind the gate');
ok(by('the gate: inside the window').gear === 0, 'taken back inside the window');
ok(by('the gate: a double').level === 1 && by('the gate: a double').gear === 0, 'a double under the gate: turbo, no gear behind it');

// the lone strokes
{
  const v = note('lone left flick up');
  ok(v.steered && v.sy > 0.5, `it steers until the lift: ${JSON.stringify(v)}`);
  ok(!v.after, 'and stops');
  ok(by('lone left flick up').gear === 1 && taps('lone left flick up') === 0, 'then the gear, no tap');
}
ok(by('lone left flick down').gear === 0, 'a lone flick down');
for (const g of ['lone left: 34 px', 'lone left: 90 px', 'lone left: 40 px in 120', 'lone left: 43 degrees']) quiet(g);
ok(by('lone left: 36 px').gear === 1, 'the firm rule\'s start');
ok(by('lone left: 38 degrees').gear === 1, 'within 40 degrees');
quiet('lone right flick up');
quiet('lone right flick down');
quiet('lone right two flicks');
ok(by('lone right flick down').gear === 1, 'no right thumb flicks: the gear stays');
ok(by('swapped: lone right').gear === 1, 'BUTTONS: SWAP mirrors it');
quiet('swapped: lone left');
{
  const v = note('a thumb landing during');
  ok(v.thumb && v.sx > 0.2 && !v.look, `a lone flick is no flying thumb: the other one flies: ${JSON.stringify(v)}`);
  ok(by('a thumb landing during').gear === 1, 'and the flick still counts');
}
ok(note('a steering left thumb').look, 'a real flying thumb keeps the other one second');

// the bands
quiet('bottom band: a lone left');
ok(by('bottom band: 811').gear === 1, 'just above the band');
quiet('bottom band: a second thumb never');
ok(taps('bottom band: a second thumb still taps') === 1, 'a tap in the band');
ok(by('bottom band: a second thumb still looks').look !== null, 'a look in the band');
quiet('side band: a lone');
quiet('side band: a second');

// the memory
{
  const v = note('memory: the look thumb stays');
  ok(v.on && !v.thumb && Math.round(v.x) === 90, `lifting the flying thumb leaves the look: ${JSON.stringify(v)}`);
}
ok(note('memory: a lone touch on the far').on && !note('memory: a lone touch on the far').thumb, 'the far side looks');
ok(taps('memory: a lone tap on the far side splats') === 1, 'a lone tap by memory');
ok(taps('memory: a lone tap on the far side, 260') === 0, 'the second thumb\'s tap limit');
ok(by('memory: a lone flick').gear === 1, 'the second thumb\'s rule by memory');
ok(note('memory: a lone touch on the near').thumb, 'the near side flies');
ok(note('memory: 29 s').on, 'inside 30 s');
ok(!note('memory: 31 s').on && note('memory: 31 s').thumb, 'past 30 s it steers again');
ok(note('memory: the other way round').on, 'the far side goes by which way round they were');
ok(note('memory: the flying thumb back').on && note('memory: the flying thumb back').thumb, 'both jobs at once, the landings the other way round');
ok(taps('memory: two fingers tapped') === 1, 'one splat');

// MEGA
ok(taps('adopt: 14 px') === 1, 'adopt in the quick window: one tap');
ok(taps('adopt: before the charge') === 0, 'adopt before charge: no tap');
ok(taps('adopt: while charging') === 0 && n('adopt: while charging', 'chargeEnd') === 1, 'adopted charge: one chargeEnd, no tap');
ok(by('adopt: while charging').dragging, 'adopted charge steers');
ok(n('adopt: refused', 'tap') === 1, 'refused: MEGA keeps its press and its lift taps');
ok(n('adopt: second finger', 'tap') === 1 && n('adopt: second finger', 'chargeEnd') === 1, 'second finger during adoption');
ok(note('adopt: a look thumb').on && note('adopt: a look thumb').thumb, 'MEGA\'s finger flies, the look thumb looks');
ok(by('adopt: charging, pointercancel').events.some((e) => e.includes('cancelled')), 'cancel ends the kept charge cancelled');
ok(n('adopt: charging, the pointer is dropped', 'chargeEnd') === 1, 'drop ends the kept charge');
ok(taps('button: tap') === 1, 'MEGA tap');
ok(taps('button: 280') === 1, 'just under the threshold');
ok(n('button: hold 600', 'chargeEnd') === 1 && taps('button: hold 600') === 0, 'MEGA hold');
ok(taps('button: 200 ms then slide') === 0, 'slide off: no tap');
ok(n('button hold 1 s while steering', 'chargeEnd') === 1, 'charging while steering');

// three fingers
ok(n('three: with a steering', 'tuner') === 0, 'a steering thumb: no tuner');
ok(n('three: swallowed', 'tuner') === 1 && !note('three: swallowed').thumb && taps('three: swallowed') === 0 && by('three: swallowed').look === null, 'three fingers swallow everything after');
quiet('three: swallowed');
ok(taps('three: the next touch') === 1, 'the next touch is fresh');

// a lost pointer
{
  const v = note('lost: a look thumb gone silent');
  ok(v.held && v.lapsed && v.back, `the timeout: ${JSON.stringify(v)}`);
}
ok(!note('lost: the last touch ended').on && !note('lost: the last touch ended').thumb, 'no touches left: everything lets go');
ok(taps('lost: the last touch ended') === 1, 'and the next touch is a fresh one');
ok(by('lost: a stroke queued').level === 1, 'a stroke queued behind a touchend is the second flick');
ok(!note('lost: pointercancel on the second').on, 'cancel ends the look');
quiet('lost: pointercancel on the second');
ok(taps('lost: pointercancel on a quick') === 0, 'a cancelled second thumb never taps');
quiet('lost: pointercancel on a lone');
ok(!note('lost: a primary').on, 'a primary pointer retires a lost look');
ok(!note('lost: a repeated').on, 'a repeated id retires a lost look');
ok(!note('lost: the app').on && !note('lost: the app').thumb, 'focus lost: everything lets go');
ok(by('lost: turbo survives').level === 1, 'turbo is latched, it doesn\'t need a hand');

// keyboard and mouse
ok(by('E: a gear').gear === 1, 'E is a gear');
ok(by('E twice:').level === 1 && by('E twice:').gear === 0, 'E twice is turbo');
ok(by('E twice, four').level === 3 && n('E twice, four', 'locked') === 1, 'E stacks too');
ok(n('E held', 'flick+') === 1, 'auto-repeat is one press');
{
  const e = by('Q: takes back').events.map((x) => x.split('@')[0]);
  ok(e.includes('back') && e.indexOf('turbo-off0') > e.indexOf('back') && e.indexOf('down0') > e.indexOf('turbo-off0'), `Q undoes, ends turbo, drops a gear: ${e}`);
  ok(by('Q: takes back').gear === 0 && by('Q: takes back').level === 0, 'and leaves nothing on');
}
ok(note('Shift held').boosting && !note('Shift held').after, 'Shift holds the boost');
ok(note('Shift on top').boosting && by('Shift on top').level === 1, 'Shift ends nothing');
{
  const v = note('right mouse drag');
  ok(v.on && Math.round(v.L.x) === 50 && Math.round(v.L.y) === 30 && !v.after && !v.thumb, `the right mouse looks: ${JSON.stringify(v)}`);
}
ok(taps('right mouse click') === 0, 'a right click is no tap');
quiet('left mouse');
ok(by('left mouse').thumb, 'the left mouse still flies');
ok(by('middle mouse').look === null && taps('middle mouse') === 0, 'the middle button does nothing');

// charge only from the press, and the pure parts
for (const r of rows) if (!/^(button|adopt|Space)/.test(r.gesture)) ok(!r.events.some((e) => e.startsWith('chargeStart')), `no charge from the canvas: ${r.gesture}`);
ok(readFlick(0, -36, 0, 36, 200, 0.4, 40) === 1, 'a flick delivered in one instant still counts');
ok(readFlick(0, 36, 80, 36, 200, 0.4, 40) === -1, 'down is -1');
ok(readFlick(36, 0, 80, 36, 200, 0.4, 40) === 0, 'sideways is none');
{
  const v = migratePrefs({ mode: 'tilt', tilt: true, chipIgnored: 1, sens: 1.5, taught: 21, swap: true, muted: true, keysShown: true });
  ok(v.changed && JSON.stringify(v.prefs) === JSON.stringify({ taught: 21, swap: true, muted: true, keysShown: true }), `an old save loses the tilt and keeps the rest: ${JSON.stringify(v)}`);
  const w = migratePrefs({ taught: 3 });
  ok(!w.changed && w.prefs.taught === 3, 'a new save is left alone');
  // the first run's hint: a beat after the fog, once ever, whatever an old save holds, and it asks for nothing
  const { Coach, TAUGHT } = await import('@src/ui/Coach');
  const hints = (taught: number, seconds: number, over: boolean) => {
    const c = new Coach(taught);
    let due = 0;
    for (let i = 0; i < seconds * 60; i++) {
      c.frame(1 / 60, { glinting: false, openingOver: over, splats: 0, thumb: false, stillPress: 0, charged: false });
      if (c.hintDue) due++;
    }
    return { due, taught: c.taught };
  };
  ok(hints(0, 30, false).due === 0, 'no hint under the fog');
  const first = hints(0, 30, true);
  ok(first.due === 1 && (first.taught & TAUGHT.thumbs) !== 0, `the hint, once, and it is saved: ${JSON.stringify(first)}`);
  ok(hints(first.taught, 30, true).due === 0, 'it never repeats');
  ok(hints(31, 30, true).due === 1, "an old save, TURBO's blink and all, gets it once");
  ok(migratePrefs(null).prefs !== null && !migratePrefs('x').changed && !migratePrefs([1]).changed, 'junk in the save is no save');
}

for (const r of rows) console.log(`${r.mode.padEnd(8)} | ${r.gesture.padEnd(76)} | ${r.events.join(', ') || '-'}${r.maxChargeHeld ? ` | chargeHeld max ${r.maxChargeHeld}` : ''}${r.thumb ? ' | steering' : ''}${r.look ? ` | look ${r.look.from}-${r.look.to} ms, ${r.look.max} px` : ''}${r.gear ? ` | G${r.gear}` : ''}${r.level ? ` | turbo ${r.level}` : ''}${r.turboHeld ? ' | turboHeld' : ''}`);
void doc;
console.log(fails.length ? `FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `gesture checks: all ${checks} passed (${rows.length} rows)`);
process.exit(fails.length ? 1 : 0);
