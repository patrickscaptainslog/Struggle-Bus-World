// The gesture table (docs/specs/flight/THUMBS.md) through the REAL Input, Shifter and TurboDrive, offline: synthetic pointer
// and key events on a controlled clock, one frame every 16.7 ms like the game loop. Writes the table to
// shots/controls/sim/gestures.json (+ a readable one on stdout). Every row of the first thumb alone keeps main's name, so
// the file can be held against main's.
import { installDom, Target, clock, ptr, newId, key, runTimers } from './fakedom';
const { win, doc } = installDom();
import { mkdirSync, writeFileSync } from 'node:fs';

const { Input, inputTune, readFlick } = await import('@src/game/Input');
const { Shifter } = await import('@src/game/Shifter');
const { TurboDrive, GEAR_NAMES, EXPRESS, JET, STRATOS, WARP, gearAlt, driveSpeed } = await import('@src/game/Turbo');
const { Flight } = await import('@src/game/Flight');
const { config } = await import('@src/config');
const { migratePrefs } = await import('@src/game/controlPrefs');

type Ev = string;
const BOUNDS = [-20000, -20000, 20000, 20000];

/** `world`: the Flight really steps under the strokes (the flown rows); without one it stands */
function harness(mode: 'touch' | 'keyboard', fps = 60, world: any = null) {
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
  input.onTurbo = (d, a, b, flew) => {
    evs.push(`flick${d > 0 ? '+' : '-'}@${at()}`);
    shifter.flick(d, a, b, flew);
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
    if (world) for (let i = 0; i < 2; i++) flight.step(1 / fps / 2, { sx: input.state.stretch.x, sy: input.state.stretch.y, dragging: input.state.dragging }, world);
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
/** a row that flies: the real Flight under the strokes, skimming flat rooftops at cruise */
const ROOFS = { obstacleAt: () => 20, groundAt: () => 10 };
function flown(gesture: string, fn: (h: H) => unknown) {
  const h = harness('touch', 60, ROOFS);
  Object.assign(h.flight, { y: 26.5, groundBroad: 10, fullness: 0.5, glideSpeed: 0 });
  h.wait(1000);
  h.reset();
  const note = fn(h);
  rows.push({ mode: 'touch', gesture, ...h.result(), note });
  h.input.dispose();
}
/** where the bus got to */
const flying = (h: H) => ({ hold: h.flight.holdY, over: +(h.flight.y - 26.5).toFixed(1), mode: h.flight.mode, gear: h.drive.gear });
/** a bus holding a height, not skimming */
const holdAt = (h: H, y: number) => { Object.assign(h.flight, { y, holdY: y, mode: 1 }); };
/** the player's own hands, in the words of the table */
const X = 200, Y = 600;
const LX = 100, LY = 560; // a left thumb
const RX = 300, RY = 600; // a right thumb
/** a steering right thumb, down until the row lifts it (it has moved off its landing) */
const steer = (h: H) => { const a = newId(); h.down(a, RX, RY); h.slide(a, RX, RY, 30, 0, 300); return a; };
const flickUp = (h: H, primary = false) => h.stroke(LX, LY, 0, -74, 85, primary);
const flickDown = (h: H, primary = false) => h.stroke(LX, 500, 0, 74, 85, primary);
/** both thumbs down from a cruise, the left a beat first, the way two thumbs really land, both lifted a moment later */
const leftFirst = (h: H) => { const a = newId(), b = newId(); h.down(a, LX, LY); h.wait(30); h.down(b, RX, RY, false); h.wait(200); h.up(b, RX, RY); h.up(a, LX, LY); h.wait(600); };
/** a lone stroke from (x, y) with another touch landing at (ox, oy) as it goes; it lifts as a flick, the other stays down */
const flickWith = (h: H, x: number, y: number, ox: number, oy: number) => { const a = newId(), b = newId(); h.down(a, x, y); h.slide(a, x, y, 0, -40, 40); h.down(b, ox, oy, false); h.wait(40); h.up(a, x, y - 74); return b; };
/** a lone thumb lands and drags 60 px sideways: what did it turn out to be? */
const dragAt = (h: H, x: number, y: number) => { const c = newId(); h.down(c, x, y); h.slide(c, x, y, 60, 0, 200); h.wait(30); const s = h.input.state, v = { thumb: s.thumb, look: s.look.on, sx: +s.stretch.x.toFixed(2) }; h.up(c, x + 60, y); return v; };
/** turbo, a double flick by the second thumb */
const double = (h: H) => { flickUp(h); h.wait(150); flickUp(h); };
/** straight into the last gear, Jet */
const toJet = (h: H) => { h.drive.shift(1, h.flight); h.drive.shift(1, h.flight); h.wait(50); };

// ---- the first thumb alone (rows from main, same names)
row('touch', 'canvas: quick tap (120 ms, still)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(120); h.up(id, X, Y); });
row('touch', 'canvas: slow tap (260 ms, still)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(260); h.up(id, X, Y); });
row('touch', 'canvas: slow tap 440 ms, still', (h) => { const id = newId(); h.down(id, X, Y); h.wait(440); h.up(id, X, Y); });
row('touch', 'canvas: 460 ms, still (past stillTapMs)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(460); h.up(id, X, Y); });
row('touch', 'canvas: hold 1 s still (bungee at neutral, no charge)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(1000); h.up(id, X, Y); });
row('touch', 'canvas: drag 80 px (steer)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 80, 0, 300); h.up(id, X + 80, Y); });
row('touch', 'canvas: quick flick 20 px in 90 ms (still a tap)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 20, 0, 90); h.up(id, X + 20, Y); });
row('touch', 'canvas: quick flick 20 px up in 90 ms (still a tap)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 0, -20, 90); h.up(id, X, Y - 20); });
row('touch', 'canvas: two fingers tapped together', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(90); h.up(a, X, Y); h.up(b, 120, 500); });
row('touch', 'canvas: two fingers, both lift at 400 ms', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(370); h.up(a, X, Y); h.up(b, 120, 500); });
row('touch', 'canvas: two fingers, both lift at 470 ms', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(440); h.up(a, X, Y); h.up(b, 120, 500); });
row('touch', 'canvas: three fingers (tuner)', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, X, Y); h.down(b, 100, 500, false); h.down(c, 300, 500, false); h.wait(100); h.up(a, X, Y); h.up(b, 100, 500); h.up(c, 300, 500); });

// ---- the second thumb
row('touch', 'second: tap while steering, on the lift', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); (h as any).landed = h.evs.length; h.wait(90); h.up(b, LX, LY); h.wait(100); h.up(a, RX + 30, RY); return { firedOnLanding: (h as any).landed > 0 }; });
row('touch', 'second: tap at 220 ms', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(220); h.up(b, LX, LY); h.up(a, RX + 30, RY); });
row('touch', 'second: rests 260 ms, lifts (nothing)', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(260); h.up(b, LX, LY); h.up(a, RX + 30, RY); });
row('touch', 'second: rests 1 s (nothing)', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(1000); h.up(b, LX, LY); h.up(a, RX + 30, RY); });
row('touch', 'second: on a still first, past 230 ms, tapped', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(300); h.down(b, 120, 500, false); h.wait(60); h.up(b, 120, 500); h.wait(30); h.up(a, X, Y); });
row('touch', 'second: a tap with nobody flying, after a two-finger tap was answered', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, RX, RY); h.wait(40); h.down(b, LX, LY, false); h.wait(60); h.up(b, LX, LY); h.slide(a, RX, RY, 40, 0, 200); h.down(c, LX, LY, false); h.wait(40); h.up(a, RX + 40, RY); h.wait(40); h.up(c, LX, LY); });
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
row('touch', 'second: a tap with the first hand while the other looks', (h) => { const b = newId(); h.down(b, LX, LY); h.slide(b, LX, LY, 60, 0, 200); const a = newId(); h.down(a, RX, RY, false); h.wait(90); h.up(a, RX, RY); h.wait(30); const on = h.input.state.look.on; h.up(b, LX + 60, LY); return { on }; });
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
row('touch', 'double: the second lands past the window: a gear, then the next', (h) => { const a = steer(h); flickUp(h); h.wait(340); flickUp(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'double: past the window at Jet: LOCKED, then nothing', (h) => { const a = steer(h); toJet(h); flickUp(h); h.wait(340); flickUp(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'double: at the last gear, no LOCKED', (h) => { const a = steer(h); toJet(h); double(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'two spaced flicks: Express, then Jet', (h) => { const a = steer(h); flickUp(h); h.wait(500); const one = h.drive.gear, engaged = h.drive.engaged; flickUp(h); h.wait(500); h.up(a, RX + 30, RY); return { one, engaged }; });
row('touch', 'flick down steps Jet to Express to Cruise', (h) => { const a = steer(h); toJet(h); flickDown(h); h.wait(100); const one = h.drive.gear; flickDown(h); h.wait(100); h.up(a, RX + 30, RY); return { one }; });
row('touch', 'flick up with turbo on: a gear, turbo stays', (h) => { const a = steer(h); double(h); h.wait(500); flickUp(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'stack: a second double adds a level', (h) => { const a = steer(h); double(h); h.wait(500); double(h); h.wait(500); h.up(a, RX + 30, RY); });
row('touch', 'stack: a third double is the top level', (h) => { const a = steer(h); for (let i = 0; i < 3; i++) { double(h); h.wait(500); } h.up(a, RX + 30, RY); });
row('touch', 'stack: a fourth double is LOCKED, the level stands', (h) => { const a = steer(h); for (let i = 0; i < 4; i++) { double(h); h.wait(500); } h.up(a, RX + 30, RY); });
row('touch', 'flick down ends all turbo at once, the gear stays', (h) => { const a = steer(h); h.drive.shift(1, h.flight); h.wait(50); for (let i = 0; i < 3; i++) { double(h); h.wait(500); } flickDown(h); h.wait(50); h.up(a, RX + 30, RY); });
row('touch', 'the next flick down drops the gear', (h) => { const a = steer(h); h.drive.shift(1, h.flight); h.wait(50); double(h); h.wait(500); flickDown(h); h.wait(100); flickDown(h); h.wait(50); h.up(a, RX + 30, RY); });
row('touch', 'undo: a flick down takes the waiting gear back', (h) => { const a = steer(h); flickUp(h); h.wait(60); flickDown(h); h.wait(600); h.up(a, RX + 30, RY); });
row('touch', 'undo: with turbo on it takes the gear back and leaves turbo', (h) => { const a = steer(h); double(h); h.wait(500); flickUp(h); h.wait(60); flickDown(h); h.wait(600); h.up(a, RX + 30, RY); });
row('touch', 'undo: a flick down past the window, Express in, is a gear down and leaves the bus as it was', (h) => { const a = steer(h); flickUp(h); h.wait(500); flickDown(h); h.wait(100); h.up(a, RX + 30, RY); return { hold: h.flight.holdY }; });
row('touch', 'undo: a flick down past the window, Jet in, is a gear down that holds the height', (h) => { const a = steer(h); h.drive.shift(1, h.flight); h.wait(50); flickUp(h); h.wait(500); flickDown(h); h.wait(100); h.up(a, RX + 30, RY); return { hold: h.flight.holdY }; });
row('touch', 'undo: a gear still lifting is taken back: the bus goes back to what it was doing', (h) => { h.flight.y = 5; const a = steer(h); h.drive.shift(1, h.flight); h.wait(50); flickUp(h); h.wait(500); const lifting = h.drive.gear === JET && !h.drive.engaged; flickDown(h); h.wait(100); h.up(a, RX + 30, RY); return { lifting, hold: h.flight.holdY }; });
row('touch', 'LOCKED waits for the window', (h) => { const a = steer(h); toJet(h); flickUp(h); const at = h.evs.length; h.wait(200); const early = h.evs.slice(at); h.wait(300); h.up(a, RX + 30, RY); return { early }; });
row('touch', 'the gate: a flick is answered and waits for it', (h) => { h.shifter.locked = true; const a = steer(h); flickUp(h); h.wait(800); const armed = h.shifter.armed, gated = h.shifter.gated, g0 = h.drive.gear; h.shifter.locked = false; h.wait(50); h.up(a, RX + 30, RY); return { armed, gated, g0 }; });
row('touch', 'the gate: a flick down takes it back', (h) => { h.shifter.locked = true; const a = steer(h); flickUp(h); h.wait(800); flickDown(h); h.wait(50); h.shifter.locked = false; h.wait(100); h.up(a, RX + 30, RY); });
row('touch', 'the gate: inside the window too', (h) => { h.shifter.locked = true; const a = steer(h); flickUp(h); h.wait(60); flickDown(h); h.wait(500); h.shifter.locked = false; h.wait(100); h.up(a, RX + 30, RY); });
row('touch', 'the gate: a double is turbo, with no gear behind it', (h) => { h.shifter.locked = true; const a = steer(h); double(h); h.wait(500); h.shifter.locked = false; h.wait(100); h.up(a, RX + 30, RY); });
row('touch', 'the gate: a lone left flick is answered and waits for it', (h) => { h.shifter.locked = true; h.stroke(LX, LY, 0, -74, 85); h.wait(800); const armed = h.shifter.armed, gated = h.shifter.gated, g0 = h.drive.gear; h.shifter.locked = false; h.wait(50); return { armed, gated, g0 }; });
row('touch', 'the gate: a lone left double is turbo, with no gear behind it', (h) => { h.shifter.locked = true; h.stroke(LX, LY, 0, -74, 85); h.wait(150); h.stroke(LX, LY, 0, -74, 85); h.wait(500); h.shifter.locked = false; h.wait(100); });

// ---- the lone strokes: the left zone steers nothing, so it reads the second thumb's rule, and the flying side the firm one
row('touch', 'left zone: a lone flick up: never on the stick, then the gear', (h) => { const id = newId(); h.down(id, LX, LY); h.slide(id, LX, LY, 0, -74, 85); const steered = h.input.state.thumb; const sy = h.input.state.stretch.y; h.up(id, LX, LY - 74); h.wait(500); return { steered, sy }; });
row('touch', 'left zone: a lone flick down at G1', (h) => { h.drive.shift(1, h.flight); h.wait(50); h.stroke(LX, 500, 0, 74, 85); });
row('touch', 'left zone: 29 px is no flick', (h) => { h.stroke(LX, LY, 0, -29, 100); h.wait(400); });
row('touch', 'left zone: 30 px in 100 ms is a flick, under the firm rule', (h) => { h.stroke(LX, LY, 0, -30, 100); h.wait(400); });
row('touch', 'left zone: 90 px in 210 ms is a flick, too long for the firm rule', (h) => { h.stroke(LX, LY, 0, -90, 210); h.wait(400); });
row('touch', 'left zone: 40 px in 120 ms is a flick, too slow for the firm rule', (h) => { h.stroke(LX, LY, 0, -40, 120); h.wait(400); });
row('touch', 'left zone: 43 degrees off vertical is a flick, outside the firm rule', (h) => { h.stroke(LX, LY, 47, -50, 85); h.wait(400); });
row('touch', 'left zone: 70 px in 240 ms is too long', (h) => { h.stroke(LX, LY, 0, -70, 240); h.wait(400); });
row('touch', 'left zone: 40 px in 180 ms is too slow', (h) => { h.stroke(LX, LY, 0, -40, 180); h.wait(400); });
row('touch', 'left zone: 52 degrees off vertical is too far', (h) => { h.stroke(LX, LY, 51, -40, 85); h.wait(400); });
row('touch', 'left zone: sideways is nothing', (h) => { h.stroke(LX, LY, 74, 0, 85); h.wait(400); });
row('touch', 'left zone: a stroke that stays down looks and never shifts', (h) => { const id = newId(); h.down(id, LX, LY); h.slide(id, LX, LY, 0, -74, 85); h.wait(1000); const s = h.input.state, v = { thumb: s.thumb, sy: s.stretch.y, look: s.look.on }; h.up(id, LX, LY - 74); h.wait(400); return v; });
row('touch', 'left zone: out and back: one touch, one reading', (h) => { const id = newId(); h.down(id, LX, LY); h.slide(id, LX, LY, 0, -70, 80); h.slide(id, LX, LY - 70, 0, 70, 80); h.up(id, LX, LY); h.wait(400); });
row('touch', 'lone right flick up: steers, then the gear', (h) => { const id = newId(); h.down(id, RX, RY); h.slide(id, RX, RY, 0, -74, 85); const steered = h.input.state.thumb; const sy = h.input.state.stretch.y; h.up(id, RX, RY - 74); h.wait(20); const after = h.input.state.thumb; h.wait(500); return { steered, sy, after }; });
row('touch', 'lone right flick down at G1', (h) => { h.drive.shift(1, h.flight); h.wait(50); h.stroke(RX, 500, 0, 74, 85); });
row('touch', 'lone right: 34 px is under the firm rule', (h) => { h.stroke(RX, RY, 0, -34, 80); });
row('touch', 'lone right: 36 px in 80 ms is a flick', (h) => { h.stroke(RX, RY, 0, -36, 80); });
row('touch', 'lone right: 90 px in 210 ms is too long', (h) => { h.stroke(RX, RY, 0, -90, 210); });
row('touch', 'lone right: 40 px in 120 ms is too slow', (h) => { h.stroke(RX, RY, 0, -40, 120); });
row('touch', 'lone right: 38 degrees off vertical still counts', (h) => { h.stroke(RX, RY, 39, -50, 85); });
row('touch', 'lone right: 43 degrees off vertical does not', (h) => { h.stroke(RX, RY, 47, -50, 85); });
row('touch', 'lone right: a flick at 30 touches a second reads the same', (h) => { h.stroke(RX, RY, 0, -74, 85, true, 33); h.wait(400); }, 30);
row('touch', 'lone right: a flick with no move event at all reads the same', (h) => { const id = newId(); h.down(id, RX, RY); h.wait(85); h.up(id, RX, RY - 74); h.wait(400); });
row('touch', 'lone right: the same stroke stays down: it steers and never shifts', (h) => { const id = newId(); h.down(id, RX, RY); h.slide(id, RX, RY, 0, -74, 85); h.wait(1000); const thumb = h.input.state.thumb, sy = h.input.state.stretch.y, look = h.input.state.look.on; h.up(id, RX, RY - 74); h.wait(400); return { thumb, sy, look }; });
row('touch', 'lone right: a fast stroke mid-drag is never a flick', (h) => { const id = newId(); h.down(id, RX, RY); h.slide(id, RX, RY, 40, 0, 300); h.slide(id, RX + 40, RY, 0, -74, 85); h.up(id, RX + 40, RY - 74); h.wait(400); });
row('touch', 'lone right: out and back: one touch, one reading', (h) => { const id = newId(); h.down(id, RX, RY); h.slide(id, RX, RY, 0, -70, 80); h.slide(id, RX, RY - 70, 0, 70, 80); h.up(id, RX, RY); h.wait(400); });
row('touch', 'lone right: sideways is a carve', (h) => { h.stroke(RX, RY, 74, 0, 85); h.wait(400); });

// ---- one thumb has every command, on either side
for (const [hand, x, y, yd] of [['right', RX, RY, 500], ['left', LX, LY, 500]] as const) {
  const up = (h: H) => h.stroke(x, y, 0, -74, 85);
  const down = (h: H) => h.stroke(x, yd, 0, 74, 85);
  const twice = (h: H) => { up(h); h.wait(150); up(h); };
  row('touch', `${hand} thumb: a gear up, a gear down`, (h) => { up(h); h.wait(500); const one = h.drive.gear; down(h); h.wait(100); return { one }; });
  row('touch', `${hand} thumb: two spaced flicks: Express, then Jet`, (h) => { up(h); h.wait(500); up(h); h.wait(500); });
  row('touch', `${hand} thumb: turbo, the waiting gear dropped`, (h) => { twice(h); h.wait(500); });
  row('touch', `${hand} thumb: the second lands inside the window and lifts after it`, (h) => { up(h); h.wait(300); up(h); h.wait(500); });
  row('touch', `${hand} thumb: the second lands past the window: a gear, then the next`, (h) => { up(h); h.wait(340); up(h); h.wait(500); });
  row('touch', `${hand} thumb: a soft second stroke in the window is the second flick`, (h) => { up(h); h.wait(150); h.stroke(x, y, 0, -30, 100); h.wait(500); });
  row('touch', `${hand} thumb: the same soft stroke past the window`, (h) => { up(h); h.wait(340); h.stroke(x, y, 0, -30, 100); h.wait(500); });
  row('touch', `${hand} thumb: the same soft stroke with loneAgainMs at 0`, (h) => { const was = inputTune.loneAgainMs; inputTune.loneAgainMs = 0; up(h); h.wait(150); h.stroke(x, y, 0, -30, 100); h.wait(500); inputTune.loneAgainMs = was; });
  row('touch', `${hand} thumb: a soft first stroke`, (h) => { h.stroke(x, y, 0, -30, 100); h.wait(500); });
  row('touch', `${hand} thumb: a second double adds a level`, (h) => { twice(h); h.wait(500); twice(h); h.wait(500); });
  row('touch', `${hand} thumb: six flicks in a row are the top level`, (h) => { for (let i = 0; i < 6; i++) { up(h); h.wait(150); } h.wait(500); });
  row('touch', `${hand} thumb: a fourth double is LOCKED, the level stands`, (h) => { for (let i = 0; i < 4; i++) { twice(h); h.wait(500); } });
  row('touch', `${hand} thumb: flick down ends all turbo, the gear stays, the next drops it`, (h) => { h.drive.shift(1, h.flight); h.wait(50); for (let i = 0; i < 3; i++) { twice(h); h.wait(500); } down(h); h.wait(100); const v = { level: h.drive.level, gear: h.drive.gear }; down(h); h.wait(100); return v; });
  row('touch', `${hand} thumb: a flick down takes the waiting gear back`, (h) => { up(h); h.wait(60); down(h); h.wait(600); });
  row('touch', `${hand} thumb: a gear taken back, with turbo on, leaves turbo`, (h) => { twice(h); h.wait(500); up(h); h.wait(60); down(h); h.wait(600); });
  row('touch', `${hand} thumb: a gear still lifting is taken back`, (h) => { h.flight.y = 5; h.drive.shift(1, h.flight); h.wait(50); up(h); h.wait(500); const lifting = h.drive.gear === JET && !h.drive.engaged; down(h); h.wait(100); return { lifting, hold: h.flight.holdY }; });
}

// ---- what a flick down leaves behind, the Flight under the stroke: one thumb's stroke is a pull too, a second thumb's isn't
for (const [who, stroke] of [['right', (h: H) => h.stroke(RX, 500, 0, 74, 85)], ['left', (h: H) => h.stroke(LX, 500, 0, 74, 85)], ['second', (h: H) => { const a = newId(); h.down(a, RX, RY); h.wait(20); flickDown(h); h.up(a, RX, RY); }]] as const) {
  flown(`flown, ${who}: out of Express: still on the rooftops`, (h) => { h.drive.shift(1, h.flight); h.wait(3000); stroke(h); h.wait(8000); return flying(h); });
  flown(`flown, ${who}: turbo off at Cruise: still on the rooftops`, (h) => { h.drive.boostUp(); h.wait(3000); stroke(h); h.wait(8000); return flying(h); });
  flown(`flown, ${who}: the window's take-back: still on the rooftops`, (h) => { h.stroke(RX, RY, 0, -74, 85); h.wait(100); stroke(h); h.wait(8000); return flying(h); });
  flown(`flown, ${who}: Jet still lifting is taken back: it settles`, (h) => { h.drive.shift(1, h.flight); h.wait(2000); h.drive.shift(1, h.flight); h.wait(1000); const rose = +(h.flight.y - 26.5).toFixed(1); stroke(h); h.wait(20000); return { ...flying(h), rose }; });
  flown(`flown, ${who}: holding 400 m, out of Express: holding 400 m`, (h) => { holdAt(h, 400); h.drive.shift(1, h.flight); h.wait(3000); stroke(h); h.wait(8000); return flying(h); });
  flown(`flown, ${who}: Jet that bit: it holds the height`, (h) => { h.drive.shift(1, h.flight); h.drive.shift(1, h.flight); h.wait(9000); const y0 = h.flight.y; stroke(h); h.wait(6000); return { ...flying(h), y0, y: h.flight.y }; });
}
flown('flown: with nothing to do a quick pull is a quick pull', (h) => { h.stroke(RX, 500, 0, 74, 85); h.wait(8000); return flying(h); });
flown('flown: a stick that moves first has chosen for itself', (h) => { h.drive.shift(1, h.flight); h.wait(3000); h.stroke(RX, 500, 0, 74, 85); h.wait(40); const a = newId(); h.down(a, RX, 500); h.slide(a, RX, 500, 0, 80, 100); h.wait(1000); h.up(a, RX, 580); h.wait(4000); return flying(h); });
flown('flown: a hard dive let go, a flick down inside its arc: no rebound', (h) => { holdAt(h, 3000); h.drive.shift(1, h.flight); h.drive.shift(1, h.flight); h.wait(9000); h.drive.boostUp(); h.wait(3000); const a = newId(); h.down(a, RX, 500); h.slide(a, RX, 500, 0, -120, 200); h.wait(1500); h.up(a, RX, 380); h.wait(120); const y0 = h.flight.y; h.stroke(RX, 500, 0, 74, 85); h.wait(8000); return { ...flying(h), y0, y: h.flight.y, level: h.drive.level }; });
flown('flown: a second thumb flicks down as a long pull lets go: the climb stands', (h) => { h.drive.shift(1, h.flight); h.wait(1000); const a = newId(), b = newId(); h.down(a, RX, 500); h.slide(a, RX, 500, 0, 80, 100); h.wait(1500); h.down(b, LX, 500, false); h.slide(b, LX, 500, 0, 74, 85); h.up(a, RX, 580); h.up(b, LX, 574); h.wait(4000); return flying(h); });

row('touch', 'swapped: a lone right flick up, in the zone', (h) => { h.input.swapped = true; h.stroke(RX, RY, 0, -74, 85); });
row('touch', 'swapped: a lone left flick up, flying', (h) => { h.input.swapped = true; h.stroke(LX, LY, 0, -74, 85); h.wait(400); });
row('touch', 'swapped: a soft lone right stroke is a flick: the zone has the second thumb\'s rule', (h) => { h.input.swapped = true; h.stroke(RX, RY, 0, -30, 100); h.wait(400); });
row('touch', 'swapped: a soft lone left stroke steers: the flying side has the firm one', (h) => { h.input.swapped = true; h.stroke(LX, LY, 0, -30, 100); h.wait(400); });
row('touch', 'swapped: a tap on the right paints on its lift', (h) => { h.input.swapped = true; const id = newId(); h.down(id, RX, RY); h.wait(120); h.up(id, RX, RY); });
row('touch', 'a left flick with a thumb landing on the right: the flick counts, that thumb flies', (h) => {
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
row('touch', 'a thumb landing out of the zone during a lone right flick flies, from where it landed', (h) => {
  const a = newId(), b = newId();
  h.down(a, RX, RY);
  h.slide(a, RX, RY, 0, -40, 40);
  h.down(b, X, Y, false);
  h.slide(b, X, Y, 30, 0, 40);
  h.up(a, RX, RY - 74);
  h.wait(20);
  const thumb = h.input.state.thumb, sx = h.input.state.stretch.x, look = h.input.state.look.on;
  h.up(b, X + 30, Y);
  return { thumb, sx, look };
});
row('touch', 'a thumb landing in the zone during a lone right flick stays a look thumb', (h) => { const b = flickWith(h, RX, RY, LX, LY); h.slide(b, LX, LY, 60, 0, 200); h.wait(30); const s = h.input.state, v = { thumb: s.thumb, look: s.look.on, sx: +s.stretch.x.toFixed(2) }; h.up(b, LX + 60, LY); h.wait(400); return v; });
row('touch', 'a flying thumb that is no flick keeps the second thumb second', (h) => {
  const a = newId(), b = newId();
  h.down(a, X, Y);
  h.slide(a, X, Y, 0, -90, 300);
  h.down(b, RX, RY, false);
  h.slide(b, RX, RY, 30, 0, 200);
  h.wait(20);
  const look = h.input.state.look.on;
  h.up(a, X, Y - 90);
  h.up(b, RX + 30, RY);
  return { look };
});

// ---- the bands
row('touch', 'bottom band: a lone left stroke is never a command', (h) => { h.stroke(LX, 820, 0, -74, 85); h.wait(400); });
row('touch', 'bottom band: a lone right stroke is never a command', (h) => { h.stroke(RX, 820, 0, -74, 85); h.wait(400); });
row('touch', 'bottom band: 811 px, 41 px from the bottom, is a stroke again', (h) => { h.stroke(LX, 811, 0, -74, 85); h.wait(400); });
row('touch', 'bottom band: a second thumb never commands either', (h) => { const a = steer(h); h.stroke(LX, 820, 0, -74, 85, false); h.wait(400); h.up(a, RX + 30, RY); });
row('touch', 'bottom band: a second thumb still taps', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, 820, false); h.wait(90); h.up(b, LX, 820); h.up(a, RX + 30, RY); });
row('touch', 'bottom band: a second thumb still looks', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, 820, false); h.slide(b, LX, 820, 40, -40, 200); h.up(b, LX + 40, 780); h.up(a, RX + 30, RY); });
row('touch', 'bottom band: a lone left touch taps, as the zone does', (h) => { const id = newId(); h.down(id, LX, 820); h.wait(120); h.up(id, LX, 820); });
row('touch', 'bottom band: a lone left touch looks, as the zone does', (h) => dragAt(h, LX, 820));
row('touch', 'side band: a lone left stroke 10 px in is never a command', (h) => { h.stroke(10, LY, 0, -74, 85); h.wait(400); });
row('touch', 'side band: a lone left touch looks, as the zone does', (h) => dragAt(h, 10, LY));
row('touch', 'side band: a lone right stroke 10 px in is never a command', (h) => { h.stroke(383, RY, 0, -74, 85); h.wait(400); });
row('touch', 'side band: a lone right stroke 21 px in is a stroke again', (h) => { h.stroke(372, RY, 0, -74, 85); h.wait(400); });
row('touch', 'side band: a second thumb 10 px from the right edge', (h) => { const a = newId(); h.down(a, X, Y); h.slide(a, X, Y, 30, 0, 300); h.stroke(383, 500, 0, -74, 85, false); h.wait(400); h.up(a, X + 30, Y); });

// ---- the left zone: a touch landing there never flies, whatever else is on the glass
row('touch', 'left zone: a tap', (h) => { const id = newId(); h.down(id, LX, LY); h.wait(120); h.up(id, LX, LY); });
row('touch', 'left zone: a tap, 300 ms: nobody is flying, a first thumb\'s limit', (h) => { const id = newId(); h.down(id, LX, LY); h.wait(300); h.up(id, LX, LY); });
row('touch', 'left zone: 460 ms, still, does nothing', (h) => { const id = newId(); h.down(id, LX, LY); h.wait(460); h.up(id, LX, LY); });
row('touch', 'left zone: rests 1 s (nothing)', (h) => { const id = newId(); h.down(id, LX, LY); h.wait(1000); h.up(id, LX, LY); });
row('touch', 'left zone: a quick slight wander is still a tap', (h) => { const id = newId(); h.down(id, LX, LY); h.slide(id, LX, LY, 20, 0, 90); h.up(id, LX + 20, LY); });
row('touch', 'left zone: a drag looks, the second thumb\'s wait and all, and the lift ends it', (h) => {
  const b = newId();
  h.down(b, LX, LY);
  h.wait(40);
  const early = h.input.state.look.on;
  h.slide(b, LX, LY, 60, -40, 200);
  h.wait(20);
  const L = { ...h.input.state.look };
  h.slide(b, LX + 60, LY - 40, -20, 20, 100);
  h.wait(20);
  const back = { ...h.input.state.look };
  h.up(b, LX + 40, LY - 20);
  h.wait(20);
  return { early, L, back, after: { ...h.input.state.look } };
});
row('touch', 'left zone: a slow drag up looks, no command', (h) => { h.stroke(LX, LY, 0, -90, 400); h.wait(400); });
row('touch', 'left zone: rests 500 ms, then drags (a look at once)', (h) => { const b = newId(); h.down(b, LX, LY); h.wait(500); h.slide(b, LX, LY, 30, 0, 100); h.wait(30); const on = h.input.state.look.on; h.up(b, LX + 30, LY); return { on }; });
row('touch', 'left zone: a look dragged over the line is still a look', (h) => { const b = newId(); h.down(b, LX, LY); h.slide(b, LX, LY, 200, 0, 300); h.wait(30); const s = h.input.state, v = { thumb: s.thumb, look: s.look.on, sx: s.stretch.x, x: Math.round(s.look.x) }; h.up(b, LX + 200, LY); return v; });
row('touch', 'left zone: two touches there: neither flies, the one that drags looks', (h) => { const a = newId(), b = newId(); h.down(a, LX, LY); h.wait(300); h.down(b, 140, 500, false); h.slide(b, 140, 500, 50, 0, 200); h.wait(30); const s = h.input.state, v = { thumb: s.thumb, look: s.look.on, x: Math.round(s.look.x) }; h.up(b, 190, 500); h.up(a, LX, LY); return v; });
row('touch', 'left zone: two fingers tapped together there: one splat', (h) => { const a = newId(), b = newId(); h.down(a, LX, LY); h.wait(30); h.down(b, 140, 500, false); h.wait(80); h.up(a, LX, LY); h.up(b, 140, 500); });
row('touch', 'left zone: two fingers, both lift at 400 ms: one splat, as anywhere', (h) => { const a = newId(), b = newId(); h.down(a, LX, LY); h.wait(30); h.down(b, 140, 500, false); h.wait(370); h.up(a, LX, LY); h.up(b, 140, 500); });
row('touch', 'left zone: two fingers, both lift at 470 ms: none, as anywhere', (h) => { const a = newId(), b = newId(); h.down(a, LX, LY); h.wait(30); h.down(b, 140, 500, false); h.wait(440); h.up(a, LX, LY); h.up(b, 140, 500); });
row('touch', 'left zone: a tap there while the other looks fires on its lift', (h) => { const a = newId(), b = newId(); h.down(a, LX, LY); h.slide(a, LX, LY, 60, 0, 200); h.down(b, 140, 500, false); h.wait(90); h.up(b, 140, 500); h.wait(30); const on = h.input.state.look.on, tapped = h.evs.length; h.up(a, LX + 60, LY); return { on, tapped }; });
row('touch', 'left zone: three fingers there: the tuner', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, LX, LY); h.down(b, 140, 500, false); h.down(c, 60, 500, false); h.wait(100); h.up(a, LX, LY); h.up(b, 140, 500); h.up(c, 60, 500); });
row('touch', 'left zone: one finger there, two elsewhere: the tuner', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, LX, LY); h.down(b, X, Y, false); h.down(c, RX, RY, false); h.wait(100); h.up(a, LX, LY); h.up(b, X, Y); h.up(c, RX, RY); });
row('touch', 'left zone: two fingers there, one elsewhere: the tuner', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, LX, LY); h.down(b, 140, 500, false); h.down(c, RX, RY, false); h.wait(100); h.up(a, LX, LY); h.up(b, 140, 500); h.up(c, RX, RY); });
row('touch', 'left zone: flicks with nothing else on the glass, then a drag', (h) => { h.stroke(LX, LY, 0, -74, 85); h.wait(500); return dragAt(h, LX, LY); });
const zoned = (z: number, x: number) => (h: H) => { const was = inputTune.lookZone; inputTune.lookZone = z; const v = dragAt(h, x, RY); inputTune.lookZone = was; return v; };
row('touch', 'the line: 164 px of 393 looks', (h) => dragAt(h, 164, RY));
row('touch', 'the line: 166 px of 393 flies', (h) => dragAt(h, 166, RY));
row('touch', 'the line: the centre flies', (h) => dragAt(h, 196, RY));
row('touch', 'the line: the right flies', (h) => dragAt(h, RX, RY));
row('touch', 'the line: lookZone 0.25: 90 px looks', zoned(0.25, 90));
row('touch', 'the line: lookZone 0.25: 100 px flies', zoned(0.25, 100));
row('touch', 'the line: lookZone 0 is no zone: 30 px flies', zoned(0, 30));
row('touch', 'the line: swapped: the left flies', (h) => { h.input.swapped = true; return dragAt(h, LX, LY); });
row('touch', 'the line: swapped: the right looks', (h) => { h.input.swapped = true; return dragAt(h, RX, RY); });
row('touch', 'the line: swapped: 226 px flies', (h) => { h.input.swapped = true; return dragAt(h, 226, RY); });
row('touch', 'the line: swapped: 229 px looks', (h) => { h.input.swapped = true; return dragAt(h, 229, RY); });

// ---- two thumbs, in any order: the one in the zone looks, the other flies
const both = (h: H) => { const s = h.input.state; return { thumb: s.thumb, look: s.look.on, sx: +s.stretch.x.toFixed(2), x: Math.round(s.look.x) }; };
row('touch', 'two thumbs, left first: the left looks, the right flies', (h) => { const b = newId(), a = newId(); h.down(b, LX, LY); h.slide(b, LX, LY, 60, 0, 200); h.down(a, RX, RY, false); h.slide(a, RX, RY, 40, 0, 200); h.wait(20); const v = both(h); h.up(a, RX + 40, RY); h.up(b, LX + 60, LY); return v; });
row('touch', 'two thumbs, right first: the left looks, the right flies', (h) => { const a = newId(), b = newId(); h.down(a, RX, RY); h.slide(a, RX, RY, 40, 0, 200); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); h.wait(20); const v = both(h); h.up(b, LX + 60, LY); h.up(a, RX + 40, RY); return v; });
row('touch', 'two thumbs, left first by 30 ms: the left looks, the right flies', (h) => { const b = newId(), a = newId(); h.down(b, LX, LY); h.wait(30); h.down(a, RX, RY, false); h.slide(b, LX, LY, 60, 0, 200); h.slide(a, RX, RY, 40, 0, 200); h.wait(20); const v = both(h); h.up(a, RX + 40, RY); h.up(b, LX + 60, LY); return v; });
row('touch', 'two thumbs, swapped, left first: the right looks, the left flies', (h) => { h.input.swapped = true; const a = newId(), b = newId(); h.down(a, LX, LY); h.slide(a, LX, LY, 40, 0, 200); h.down(b, RX, RY, false); h.slide(b, RX, RY, 60, 0, 200); h.wait(20); const v = both(h); h.up(b, RX + 60, RY); h.up(a, LX + 40, LY); return v; });
row('touch', 'two thumbs, left first by 30 ms, both lift: the right thumb alone flies', (h) => { leftFirst(h); return dragAt(h, RX, RY); });
row('touch', 'two thumbs, left first by 30 ms, both lift: a lone right stroke is a flick', (h) => { leftFirst(h); h.stroke(RX, RY, 0, -74, 85); h.wait(400); });
row('touch', 'two thumbs, left first by 30 ms, both lift: two lone right strokes are turbo', (h) => { leftFirst(h); h.stroke(RX, RY, 0, -74, 85); h.wait(150); h.stroke(RX, RY, 0, -74, 85); h.wait(400); });
row('touch', 'two thumbs, left first by 30 ms, both lift: the left thumb alone looks', (h) => { leftFirst(h); return dragAt(h, LX, LY); });
row('touch', 'two thumbs: the look goes on when the flying thumb lifts', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); h.up(a, RX + 30, RY); h.wait(30); const on = h.input.state.look.on, thumb = h.input.state.thumb; h.slide(b, LX + 60, LY, 30, 0, 100); const x = h.input.state.look.x; h.up(b, LX + 90, LY); return { on, thumb, x }; });
row('touch', 'two thumbs: the bus flies on when the look lifts', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); h.up(b, LX + 60, LY); h.wait(30); const v = both(h); h.up(a, RX + 30, RY); return v; });
row('touch', 'two thumbs: the flying thumb lands again during the look: it flies, the look stays', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); h.up(a, RX + 30, RY); h.wait(200); const c = newId(); h.down(c, RX, RY, false); h.slide(c, RX, RY, 40, 0, 200); h.wait(20); const v = both(h); h.up(c, RX + 40, RY); h.up(b, LX + 60, LY); return v; });
row('touch', 'two thumbs: the look lands again beside the flying thumb: it looks', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.wait(80); h.up(b, LX, LY); h.wait(300); const c = newId(); h.down(c, LX, LY, false); h.slide(c, LX, LY, 60, 0, 200); h.wait(20); const v = both(h); h.up(c, LX + 60, LY); h.up(a, RX + 30, RY); return v; });
row('touch', 'two thumbs: a flying thumb dragged over the line still flies', (h) => { const a = newId(); h.down(a, X, Y); h.slide(a, X, Y, -120, 0, 300); h.wait(20); const v = both(h); h.up(a, X - 120, Y); return v; });
row('touch', 'two thumbs: a touch elsewhere while something flies looks', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.slide(a, X, Y, 30, 0, 200); h.down(b, RX, RY, false); h.slide(b, RX, RY, 60, 0, 200); h.wait(20); const v = both(h); h.up(b, RX + 60, RY); h.up(a, X + 30, Y); return v; });
row('touch', 'two thumbs: a touch elsewhere while something flies flicks', (h) => { const a = newId(); h.down(a, X, Y); h.slide(a, X, Y, 30, 0, 200); h.stroke(RX, RY, 0, -74, 85, false); h.wait(500); h.up(a, X + 30, Y); });
row('touch', 'two thumbs: a flick from the left beside the flying thumb', (h) => { const a = steer(h); flickUp(h); h.wait(500); const v = both(h); h.up(a, RX + 30, RY); return v; });
row('touch', 'two thumbs: a right flick beside a resting left thumb steers and never shifts', (h) => { const b = newId(); h.down(b, LX, LY); h.wait(300); h.stroke(RX, RY, 0, -74, 85, false); h.wait(500); h.up(b, LX, LY); });
row('touch', 'two thumbs: a two-finger tap, the left finger first: one splat, then the right thumb flies', (h) => { const a = newId(), b = newId(); h.down(a, LX, LY); h.wait(40); h.down(b, RX, RY, false); h.wait(60); h.up(a, LX, LY); h.up(b, RX, RY); h.wait(600); return dragAt(h, RX, RY); });
row('touch', 'two thumbs: a resting left thumb, a tap on the right: on its lift', (h) => { const b = newId(), a = newId(); h.down(b, LX, LY); h.wait(300); h.down(a, RX, RY, false); h.wait(100); h.up(a, RX, RY); h.wait(30); const fired = h.evs.length; h.wait(300); h.up(b, LX, LY); return { fired }; });
row('touch', 'a lone right flick flies until its lift', (h) => { const a = newId(); h.down(a, RX, RY); h.slide(a, RX, RY, 0, -74, 85); const thumb = h.input.state.thumb, look = h.input.state.look.on; h.up(a, RX, RY - 74); h.wait(400); return { thumb, look }; });
row('touch', 'a stray out of the zone during a lone right flick flies, and the next lone touch is a flick', (h) => { const b = flickWith(h, 250, 600, 350, 650); h.wait(100); h.up(b, 350, 650); h.wait(500); h.stroke(RX, RY, 0, -74, 85); h.wait(400); });
row('touch', 'a fingertip in the far side band during a lone right flick is no thumb: the next one flies', (h) => { const b = flickWith(h, RX, RY, 385, 500); h.wait(100); h.up(b, 385, 500); h.wait(600); return dragAt(h, RX, RY); });
row('touch', 'a palm in the bottom band during a lone right flick is no thumb: the next one flies', (h) => { const b = flickWith(h, RX, RY, 250, 835); h.wait(100); h.up(b, 250, 835); h.wait(600); return dragAt(h, RX, RY); });
row('touch', 'swapped: a fingertip in the far side band during a lone left flick is no thumb: the next one flies', (h) => { h.input.swapped = true; const b = flickWith(h, LX, LY, 8, 500); h.wait(100); h.up(b, 8, 500); h.wait(600); return dragAt(h, LX, LY); });
row('touch', 'a fingertip resting in a band since a lone flick: the thumb lands again and flies', (h) => { const b = flickWith(h, RX, RY, 385, 500); h.wait(300); const c = newId(); h.down(c, RX, RY, false); h.slide(c, RX, RY, 60, 0, 200); h.wait(30); const s = h.input.state, v = { thumb: s.thumb, look: s.look.on, sx: +s.stretch.x.toFixed(2) }; h.up(c, RX + 60, RY); h.up(b, 385, 500); return v; });

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
row('touch', 'adopt: refused while a thumb steers (MEGA keeps its press)', (h) => { const a = newId(), id = newId(); h.down(a, X, Y); h.slide(a, X, Y, 40, 0, 200); pressMega(h, id); h.wait(100); (h as any).refused = adopt(h, MX - 15, MY, false); h.wait(60); h.input.splatButton(false, false, clock.ms); h.up(a, X + 40, Y); });
row('touch', 'adopt: second finger taps during it', (h) => { const id = newId(), b = newId(); pressMega(h, id); h.wait(500); adopt(h, MX - 30, MY, true); h.wait(100); h.down(b, 100, 300, false); h.wait(60); h.up(b, 100, 300); h.wait(100); h.up(id, MX - 30, MY); });
row('touch', 'adopt: a look thumb stays one while MEGA\'s finger takes the stick', (h) => { const b = newId(); h.down(b, LX, LY); h.slide(b, LX, LY, 60, 0, 200); const id = newId(); pressMega(h, id); h.wait(100); adopt(h, MX - 15, MY, false); h.wait(30); const on = h.input.state.look.on, thumb = h.input.state.thumb; h.up(id, MX - 15, MY); h.up(b, LX + 60, LY); return { on, thumb }; });
row('touch', 'adopt: charging, pointercancel on the lift', (h) => { const id = newId(); pressMega(h, id); h.wait(800); adopt(h, MX - 30, MY, true); h.wait(100); h.cancel(id, MX - 30, MY); });
row('touch', 'adopt: charging, the pointer is dropped (repeat id)', (h) => { const id = newId(); pressMega(h, id); h.wait(800); adopt(h, MX - 30, MY, true); h.wait(100); h.down(id, 200, 500); h.wait(30); h.up(id, 200, 500); });

// ---- three fingers
row('touch', 'three: with a steering thumb they are no tuner', (h) => { const a = steer(h); const b = newId(), c = newId(); h.down(b, LX, LY, false); h.down(c, 200, 400, false); h.wait(80); h.up(b, LX, LY); h.up(c, 200, 400); h.up(a, RX + 30, RY); });
row('touch', 'three: swallowed: no tap, no look, no stick, whatever they do after', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, X, Y); h.down(b, 100, 500, false); h.down(c, 300, 500, false); h.slide(b, 100, 500, 0, -74, 85); h.slide(a, X, Y, 40, 0, 200); const thumb = h.input.state.thumb; h.up(a, X + 40, Y); h.up(b, 100, 426); h.up(c, 300, 500); return { thumb }; });
row('touch', 'three: the next touch is a fresh one', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, X, Y); h.down(b, 100, 500, false); h.down(c, 300, 500, false); h.wait(100); h.up(a, X, Y); h.up(b, 100, 500); h.up(c, 300, 500); h.wait(100); const d = newId(); h.down(d, X, Y); h.wait(100); h.up(d, X, Y); });

// ---- a lost pointer
row('touch', 'second: a look held dead still keeps the view: a still thumb sends nothing', (h) => { const a = steer(h); const b = newId(); h.down(b, LX, LY, false); h.slide(b, LX, LY, 60, 0, 200); const L = () => ({ ...h.input.state.look }); h.wait(9000); const at9 = L(); h.wait(51000); const at60 = L(); h.up(b, LX + 60, LY); h.wait(20); const after = L(); h.up(a, RX + 30, RY); return { at9, at60, after }; });
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
row('keyboard', 'left mouse: a quick drag on the right is no flick', (h) => { const id = newId(); h.down(id, RX, RY, true, mouseL); h.slide(id, RX, RY, 0, -74, 85); h.up(id, RX, RY - 74, mouseL); h.wait(400); });
row('keyboard', 'middle mouse: nothing', (h) => { const id = newId(); h.down(id, RX, RY, true, { pointerType: 'mouse', button: 1 }); h.wait(60); h.up(id, RX, RY, mouse); });

// ---- the table's checks
const OUT = process.env.SB_OUT ?? 'shots/controls/sim';
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/gestures.json`, JSON.stringify({ holdThreshold: config.splat.holdThreshold, inputTune, levels: config.turbo.levels, rows }, null, 1));
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
ok(taps('canvas: quick flick 20 px up') === 1, 'a small quick stroke up on the right half is a tap, not a flick');
for (const r of rows) if (r.gesture.startsWith('canvas')) ok(!r.events.some((e) => /^(flick|first)/.test(e)), `a tap, a rest or a drag never shifts: ${r.gesture}`);

// the second thumb
ok(!note('second: tap while steering').firedOnLanding, 'a second thumb does not fire on its landing');
ok(atOf('second: tap while steering', 'tap') > 380, 'the tap is on the lift');
ok(taps('second: tap at 220') === 1, 'a tap up to 230 ms');
ok(taps('second: rests 260') === 0, 'past 230 ms a second thumb is resting');
ok(taps('second: rests 1 s') === 0 && by('second: rests 1 s').look === null, 'at rest it does nothing');
quiet('second: rests 1 s');
ok(taps('second: on a still first') === 1, 'one tap on a still first, the first lifting after it');
ok(taps('second: a tap with nobody flying') === 2, 'a tap after the answered one, the flying thumb gone, still fires');
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
{
  const v = note('second: a look held dead still');
  ok(v.at9.on && v.at60.on && Math.round(v.at60.x) === 60 && !v.after.on, `a still look holds until the lift: ${JSON.stringify(v)}`);
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

// the ladder: six rungs, the sixth being the last gear with all of turbo on
{
  const T = config.turbo, surge = config.flight.surgeSpeed;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  ok(GEAR_NAMES.join() === 'CRUISE,EXPRESS,JET,STRATOS,RAINBOW WARP' && GEAR_NAMES[EXPRESS] === 'EXPRESS' && GEAR_NAMES[JET] === 'JET' && GEAR_NAMES[STRATOS] === 'STRATOS' && GEAR_NAMES[WARP] === 'RAINBOW WARP', 'the ladder, by name');
  ok(gearAlt(0) === 0 && gearAlt(EXPRESS) === 0 && gearAlt(JET) === 150 && gearAlt(STRATOS) === 2000 && gearAlt(WARP) === 10000, 'Express needs no height');
  const d = new TurboDrive(BOUNDS);
  ok(d.maxGear === JET, 'unlocked with no world travel: Cruise, Express, Jet');
  T.worldTravel = true;
  ok(d.maxGear === WARP, 'with world travel: all five');
  T.worldTravel = false;
  ok(driveSpeed(0, 0, false) === 0, 'Cruise with no turbo: nothing drives');
  ok(driveSpeed(EXPRESS, 0, true) === surge, 'Express is the surge');
  ok(driveSpeed(JET, 0, true) === 450 && driveSpeed(JET, 0, false) === surge, 'Jet, and a full surge while it lifts');
  for (const [lv, want] of [[1, 145.6], [2, 179.2], [3, 224]]) {
    ok(near(driveSpeed(0, lv, false), want), `Cruise's level ${lv} sits on the surge`);
    ok(near(driveSpeed(EXPRESS, lv, true), want), `Express's level ${lv}: the same`);
  }
  ok(near(driveSpeed(JET, 1, true), 585) && near(driveSpeed(JET, 2, true), 720) && near(driveSpeed(JET, 3, true), 900), 'Jet\'s levels stand');
  ok(driveSpeed(0, 1, false) > driveSpeed(EXPRESS, 0, true), 'from Cruise two quick flicks beat one');
}

// two flicks, and turbo
ok(by('double: turbo').level === 1 && by('double: turbo').gear === 0 && n('double: turbo', 'up') === 0, 'a double is turbo, with the gear dropped');
ok(atOf('double: turbo', 'turbo') > 0 && taps('double: turbo') === 0, 'turbo at the second lift');
ok(by('double: from no thumb').level === 1 && by('double: from no thumb').gear === 0, 'a double from nothing on the glass');
ok(by('double: the second lands inside').level === 1 && by('double: the second lands inside').gear === 0 && n('double: the second lands inside', 'locked') === 0, 'the gear waits for a stroke that landed in the window');
{
  const r = by('double: the second lands past');
  ok(r.level === 0 && r.gear === JET && n('double: the second lands past', 'locked') === 0, `past the window: a gear, then the next: ${r.events}`);
  const j = by('double: past the window at Jet');
  ok(j.level === 0 && j.gear === JET && n('double: past the window at Jet', 'locked') === 2, `past the last gear: LOCKED: ${j.events}`);
}
ok(by('double: at the last').level === 1 && n('double: at the last', 'locked') === 0, 'at the last gear a double is turbo, with no LOCKED');
{
  const r = by('two spaced flicks'), v = note('two spaced flicks');
  ok(v.one === EXPRESS && v.engaged && r.gear === JET && r.level === 0 && n('two spaced flicks', 'up') === 2 && n('two spaced flicks', 'turbo') === 0, `one flick is Express, in on the shift; a second after the window is Jet: ${r.events}`);
  ok(n('two spaced flicks', 'engage1') === 0, 'Express has no height to reach: no engage of its own');
}
ok(note('flick down steps').one === EXPRESS && by('flick down steps').gear === 0 && n('flick down steps', 'down') === 2, 'a flick down steps Jet to Express to Cruise');
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
ok(by('undo: a flick down past the window, Express').gear === 0 && n('undo: a flick down past the window, Express', 'down') === 1 && n('undo: a flick down past the window, Express', 'back') === 0 && note('undo: a flick down past the window, Express').hold === -Infinity, 'out of Express, past the window, it is a gear down and the hold is left alone');
ok(by('undo: a flick down past the window, Jet').gear === EXPRESS && n('undo: a flick down past the window, Jet', 'down') === 1 && note('undo: a flick down past the window, Jet').hold === 400, 'past the window, Jet in, it is a gear down that holds the height');
ok(note('undo: a gear still').lifting && by('undo: a gear still').gear === EXPRESS && note('undo: a gear still').hold === -Infinity, 'a gear still lifting leaves the bus\'s hold as it was');
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
{
  const v = note('the gate: a lone left flick');
  ok(n('the gate: a lone left flick', 'gated') === 1 && v.armed && v.gated && v.g0 === 0 && by('the gate: a lone left flick').gear === 1, `a lone left flick under the gate is the same flick: ${JSON.stringify(v)}`);
  ok(by('the gate: a lone left double').level === 1 && by('the gate: a lone left double').gear === 0, 'and so is a lone left double');
}

// the lone strokes
{
  const v = note('left zone: a lone flick up');
  ok(!v.steered && v.sy === 0, `a left flick never touches the stick: ${JSON.stringify(v)}`);
  ok(by('left zone: a lone flick up').gear === 1 && taps('left zone: a lone flick up') === 0, 'the gear, no tap');
}
ok(by('left zone: a lone flick down').gear === 0 && n('left zone: a lone flick down', 'down') === 1, 'a lone left flick down');
quiet('left zone: 29 px');
for (const g of ['left zone: 30 px', 'left zone: 90 px', 'left zone: 40 px in 120', 'left zone: 43 degrees']) ok(by(g).gear === 1, `the second thumb's rule, on its own: ${g}`);
for (const g of ['left zone: 70 px', 'left zone: 40 px in 180', 'left zone: 52 degrees', 'left zone: sideways', 'left zone: out and back']) quiet(g);
{
  const v = note('left zone: a stroke that stays down');
  ok(v.look && !v.thumb && v.sy === 0, `a stroke that stays down looks and steers nothing: ${JSON.stringify(v)}`);
  quiet('left zone: a stroke that stays down');
}
{
  const v = note('lone right flick up');
  ok(v.steered && v.sy > 0.5, `the right thumb steers until the lift: ${JSON.stringify(v)}`);
  ok(!v.after, 'and stops');
  ok(by('lone right flick up').gear === 1 && taps('lone right flick up') === 0, 'then the gear, no tap');
}
ok(by('lone right flick down').gear === 0 && n('lone right flick down', 'down') === 1, 'a lone right flick down');
for (const g of ['lone right: 34 px', 'lone right: 90 px', 'lone right: 40 px in 120', 'lone right: 43 degrees']) quiet(g);
ok(by('lone right: 36 px').gear === 1, 'the firm rule\'s start, on the right');
ok(by('lone right: 38 degrees').gear === 1, 'within 40 degrees, on the right');
ok(by('lone right: a flick at 30').gear === 1, 'a right flick holds at 30 touches a second');
ok(by('lone right: a flick with no move').gear === 1, 'and with no move event at all');
{
  const v = note('lone right: the same stroke stays down');
  ok(v.thumb && v.sy > 0.5 && !v.look, `a thumb that stays down steers, and never looks: ${JSON.stringify(v)}`);
  quiet('lone right: the same stroke stays down');
}
quiet('lone right: a fast stroke mid-drag');
ok(by('lone right: a fast stroke mid-drag').thumb, 'a flick only counts from a fresh touch');
quiet('lone right: out and back');
quiet('lone right: sideways');
ok(by('lone right: sideways').thumb, 'sideways it carves');

// one thumb has every command, on either side: the right the whole game but the look, the left all but the flying
for (const hand of ['right', 'left']) {
  const g = (rest: string) => `${hand} thumb: ${rest}`;
  ok(note(g('a gear up')).one === EXPRESS && by(g('a gear up')).gear === 0, `${hand}: up a gear, down a gear`);
  ok(by(g('two spaced')).gear === JET && by(g('two spaced')).level === 0, `${hand}: two spaced flicks are Jet`);
  ok(by(g('turbo, the waiting')).level === 1 && by(g('turbo, the waiting')).gear === 0 && n(g('turbo, the waiting'), 'up') === 0, `${hand}: two quick flicks are turbo`);
  ok(by(g('the second lands inside')).level === 1 && by(g('the second lands inside')).gear === 0, `${hand}: the gear waits for a stroke that landed in the window`);
  ok(by(g('the second lands past')).level === 0 && by(g('the second lands past')).gear === JET, `${hand}: past the window, a gear and the next`);
  ok(by(g('a soft second stroke')).level === 1 && by(g('a soft second stroke')).gear === 0, `${hand}: the second stroke of a pair reads the second thumb's rule`);
  if (hand === 'right') {
    ok(by(g('the same soft stroke past')).level === 0 && by(g('the same soft stroke past')).gear === EXPRESS && n(g('the same soft stroke past'), 'flick') === 1, 'right: past the window the same stroke is steering');
    ok(by(g('the same soft stroke with')).level === 0 && by(g('the same soft stroke with')).gear === EXPRESS && n(g('the same soft stroke with'), 'flick') === 1, 'right: loneAgainMs 0 is the firm rule');
    quiet(g('a soft first stroke'));
  } else {
    // (the zone steers nothing, so it has the easy rule all the time)
    ok(n(g('the same soft stroke past'), 'flick') === 2 && by(g('the same soft stroke past')).gear === JET, 'left: past the window it is a flick all the same');
    ok(by(g('the same soft stroke with')).level === 1, 'left: loneAgainMs has nothing to say');
    ok(by(g('a soft first stroke')).gear === EXPRESS, 'left: a soft first stroke is a flick');
  }
  ok(by(g('a second double')).level === 2, `${hand}: a second double, level 2`);
  ok(by(g('six flicks')).level === 3 && by(g('six flicks')).gear === 0, `${hand}: six flicks in a row, the top level, no gear`);
  ok(by(g('a fourth double')).level === 3 && n(g('a fourth double'), 'locked') === 1, `${hand}: a fourth double is LOCKED`);
  ok(note(g('flick down ends')).level === 0 && note(g('flick down ends')).gear === 1 && by(g('flick down ends')).gear === 0, `${hand}: down ends all turbo, the next a gear`);
  ok(by(g('a flick down takes')).gear === 0 && n(g('a flick down takes'), 'back') === 1 && n(g('a flick down takes'), 'up') === 0, `${hand}: a flick down before the gear bites takes it back`);
  ok(by(g('a gear taken back')).gear === 0 && by(g('a gear taken back')).level === 1, `${hand}: a take-back leaves turbo`);
  ok(note(g('a gear still lifting')).lifting && by(g('a gear still lifting')).gear === EXPRESS && note(g('a gear still lifting')).hold === -Infinity, `${hand}: a gear still lifting is taken back, the hold as it was`);
  for (const r of rows) if (r.gesture.startsWith(`${hand} thumb:`)) ok(hand === 'right' ? r.look === null : !r.thumb && !r.dragging, `${hand === 'right' ? 'one thumb never looks' : 'the left zone never flies'}: ${r.gesture}`);
}

// what a flick down leaves behind: either hand and the second thumb alike
for (const who of ['right', 'left', 'second']) {
  const g = (rest: string) => `flown, ${who}: ${rest}`;
  const skims = (name: string) => { const v = note(g(name)); ok(v.hold === -Infinity && v.mode === 0 && Math.abs(v.over) < 1, `${who}: ${name}: ${JSON.stringify(v)}`); };
  skims('out of Express');
  skims('turbo off at Cruise');
  skims("the window's take-back");
  skims('Jet still lifting');
  ok(note(g('Jet still lifting')).rose > 30 && note(g('Jet still lifting')).gear === EXPRESS, `${who}: it had really lifted, and the gear went back`);
  ok(note(g('holding 400 m')).hold === 400, `${who}: holding stays holding, where it was: ${JSON.stringify(note(g('holding 400 m')))}`);
  { const v = note(g('Jet that bit')); ok(Number.isFinite(v.hold) && Math.abs(v.y - v.y0) < 40 && v.gear === EXPRESS, `${who}: out of a gear that bit it holds the height: ${JSON.stringify(v)}`); }
}
{
  const v = note('flown: with nothing to do');
  ok(Number.isFinite(v.hold) && v.mode === 1, `a flick down with nothing to do is the quick pull it looks like: ${JSON.stringify(v)}`);
  const w = note('flown: a stick that moves first');
  ok(Number.isFinite(w.hold) && w.over > 20, `a pull after the flick stands: ${JSON.stringify(w)}`);
  const d = note('flown: a hard dive let go');
  ok(d.level === 0 && Number.isFinite(d.hold) && d.hold < d.y0 - 100, `a flick down in a dive's arc has nothing to go back to: ${JSON.stringify(d)}`);
  const c = note('flown: a second thumb flicks down as');
  ok(c.gear === 0 && Number.isFinite(c.hold) && c.over > 20, `only the stroke's own pull goes back: ${JSON.stringify(c)}`);
}

ok(by('swapped: a lone right flick').gear === 1 && !by('swapped: a lone right flick').thumb, 'BUTTONS: SWAP: a lone right flick, on the stick no longer');
ok(by('swapped: a lone left flick').gear === 1 && by('swapped: a lone left flick').thumb, 'and a lone left flick, on it');
ok(by('swapped: a soft lone right').gear === 1, 'the second thumb\'s rule goes with the zone');
quiet('swapped: a soft lone left');
ok(by('swapped: a soft lone left').thumb, 'and the firm one with the flying side');
ok(taps('swapped: a tap on the right') === 1, 'a tap in the mirrored zone');
{
  const v = note('a left flick with a thumb landing');
  ok(v.thumb && v.sx > 0.2 && !v.look, `a left flick and the thumb that flies: ${JSON.stringify(v)}`);
  ok(by('a left flick with a thumb landing').gear === 1, 'and the flick counts');
  const w = note('a thumb landing out of the zone during');
  ok(w.thumb && w.sx > 0.2 && !w.look, `a lone right flick is no flying thumb: ${JSON.stringify(w)}`);
  ok(by('a thumb landing out of the zone during').gear === 1, 'and that flick counts');
}
ok(note('a flying thumb that is no flick').look, 'a real flying thumb keeps the other one second');

// the bands
quiet('bottom band: a lone left');
quiet('bottom band: a lone right');
ok(by('bottom band: a lone right').thumb, 'it still steers');
ok(by('bottom band: 811').gear === 1, 'just above the band');
quiet('bottom band: a second thumb never');
ok(taps('bottom band: a second thumb still taps') === 1, 'a tap in the band');
ok(by('bottom band: a second thumb still looks').look !== null, 'a look in the band');
quiet('side band: a lone left');
quiet('side band: a lone right stroke 10');
ok(by('side band: a lone right stroke 10').thumb, 'it still steers');
ok(by('side band: a lone right stroke 21').gear === 1, 'just inside the band');
quiet('side band: a second');

// the left zone
const flies = (g: string) => { const v = note(g); ok(v.thumb && !v.look && v.sx > 0.2, `it flies: ${g}: ${JSON.stringify(v)}`); };
const looks = (g: string) => { const v = note(g); ok(v.look && !v.thumb && v.sx === 0, `it looks: ${g}: ${JSON.stringify(v)}`); };
for (const r of rows) if (r.gesture.startsWith('left zone:')) ok(!r.thumb && !r.dragging, `the left zone never flies: ${r.gesture}`);
ok(taps('left zone: a tap') === 1, 'a lone left tap paints on its lift');
ok(atOf('left zone: a tap', 'tap') >= 120, 'on its lift');
ok(taps('left zone: a tap, 300') === 1, 'with nobody flying a tap is as long as a first thumb\'s');
ok(taps('left zone: 460') === 0, 'and no longer');
ok(taps('left zone: rests 1 s') === 0 && by('left zone: rests 1 s').look === null, 'resting does nothing');
quiet('left zone: rests 1 s');
ok(taps('left zone: a quick slight wander') === 1, 'the same quick wander as the flying side');
{
  const v = note('left zone: a drag looks');
  ok(!v.early, 'the look waits 100 ms, alone too');
  ok(by('left zone: a drag looks').look!.from >= 100, 'and not before the delay');
  ok(v.L.on && Math.round(v.L.x) === 60 && Math.round(v.L.y) === 40, `the same offset from the landing, +y up: ${JSON.stringify(v.L)}`);
  ok(v.back.on && Math.round(v.back.x) === 40 && Math.round(v.back.y) === 20, `it reverses at once: ${JSON.stringify(v.back)}`);
  ok(!v.after.on && v.after.x === 0 && v.after.y === 0, 'the lift ends it at 0, 0');
}
quiet('left zone: a slow drag up');
ok(by('left zone: a slow drag up').look !== null, 'slow is a look');
ok(note('left zone: rests 500').on, 'a rest, then a drag: a look at once');
{
  const v = note('left zone: a look dragged over');
  ok(v.look && !v.thumb && v.sx === 0 && v.x === 200, `only the landing counts: ${JSON.stringify(v)}`);
  const w = note('left zone: two touches there');
  ok(w.look && !w.thumb && w.x === 50, `two touches in the zone, and neither flies: ${JSON.stringify(w)}`);
}
ok(taps('left zone: two fingers tapped') === 1, 'two fingers tapped there: one splat');
ok(taps('left zone: two fingers, both lift at 400') === 1, 'at 400 ms: one splat, as anywhere');
ok(taps('left zone: two fingers, both lift at 470') === 0, 'at 470 ms: none, as anywhere');
ok(note('left zone: a tap there while the other').on && note('left zone: a tap there while the other').tapped === 1 && taps('left zone: a tap there while the other') === 1, 'a tap beside a look fires on its own lift, and once');
for (const g of ['left zone: three fingers', 'left zone: one finger there', 'left zone: two fingers there']) ok(n(g, 'tuner') === 1 && taps(g) === 0, `three fingers are the tuner in any order: ${g}`);
ok(by('left zone: flicks with nothing else').gear === 1, 'a flick from the zone, alone');
looks('left zone: flicks with nothing else');
looks('the line: 164');
flies('the line: 166');
flies('the line: the centre');
flies('the line: the right');
looks('the line: lookZone 0.25: 90');
flies('the line: lookZone 0.25: 100');
flies('the line: lookZone 0 is');
flies('the line: swapped: the left');
looks('the line: swapped: the right');
flies('the line: swapped: 226');
looks('the line: swapped: 229');
looks('bottom band: a lone left touch looks');
looks('side band: a lone left touch');
ok(taps('bottom band: a lone left touch taps') === 1, 'a tap in the band, alone');
ok(!by('bottom band: a lone left touch taps').thumb && !by('side band: a lone left stroke').thumb, 'the bands of the zone are the zone');
{
  // nothing in the zone touches the flight: the real Flight, step for step against a twin with nothing on the glass
  const fly = (hand: boolean) => {
    clock.ms = 5e7;
    const h = harness('touch', 60, ROOFS);
    Object.assign(h.flight, { y: 26.5, groundBroad: 10, fullness: 0.5, glideSpeed: 0 });
    h.wait(1000);
    const stroke = (dx: number, dy: number, steps: number) => {
      const id = newId();
      if (hand) h.down(id, LX, LY);
      for (let i = 1; i <= steps; i++) {
        h.wait(20);
        if (hand) h.move(id, LX + (dx * i) / steps, LY + (dy * i) / steps);
      }
      if (hand) h.up(id, LX + dx, LY + dy);
      h.wait(300);
    };
    stroke(180, -60, 60); // a look, over the line
    stroke(74, 0, 5); // a flick sideways
    stroke(0, 0, 5); // a tap
    stroke(0, 0, 40); // a rest
    h.input.dispose();
    return JSON.stringify(Object.entries(h.flight).filter(([, v]) => typeof v === 'number'));
  };
  ok(fly(true) === fly(false), 'a hand in the zone leaves every number of the Flight as a twin\'s');
}

// two thumbs, in any order
for (const g of ['two thumbs, left first:', 'two thumbs, right first:', 'two thumbs, left first by 30 ms: the left looks', 'two thumbs, swapped']) {
  const v = note(g);
  ok(v.thumb && v.look && v.sx > 0.2 && v.x === 60, `the one in the zone looks and the other flies: ${g}: ${JSON.stringify(v)}`);
}
flies('two thumbs, left first by 30 ms, both lift: the right');
ok(by('two thumbs, left first by 30 ms, both lift: a lone right').gear === 1 && by('two thumbs, left first by 30 ms, both lift: two lone right').level === 1, 'a lone right stroke commands, whatever landed first');
looks('two thumbs, left first by 30 ms, both lift: the left');
{
  const v = note('two thumbs: the look goes on');
  ok(v.on && !v.thumb && Math.round(v.x) === 90, `lifting the flying thumb leaves the look: ${JSON.stringify(v)}`);
  const w = note('two thumbs: the bus flies on');
  ok(w.thumb && !w.look && w.sx > 0.2, `lifting the look leaves the flying thumb: ${JSON.stringify(w)}`);
  const c = note('two thumbs: the flying thumb lands again');
  ok(c.thumb && c.look && c.sx > 0.2 && c.x === 60, `both jobs at once, whatever went before: ${JSON.stringify(c)}`);
  const d = note('two thumbs: the look lands again');
  ok(d.thumb && d.look && d.sx > 0.2 && d.x === 60, `the left thumb comes back to the look: ${JSON.stringify(d)}`);
  const e = note('two thumbs: a flying thumb dragged over');
  ok(e.thumb && !e.look && e.sx < -0.2, `only the landing counts for the flying thumb too: ${JSON.stringify(e)}`);
  const f = note('two thumbs: a touch elsewhere while something flies looks');
  ok(f.thumb && f.look && f.sx > 0.2, `a touch elsewhere with something flying is the second thumb, as ever: ${JSON.stringify(f)}`);
  const g = note('two thumbs: a flick from the left');
  ok(g.thumb && !g.look && by('two thumbs: a flick from the left').gear === 1, `a left flick beside the flying thumb: ${JSON.stringify(g)}`);
}
ok(by('two thumbs: a touch elsewhere while something flies flicks').gear === 1, 'and it flicks');
quiet('two thumbs: a right flick beside a resting');
ok(by('two thumbs: a right flick beside a resting').thumb, 'not alone, so it flies and doesn\'t shift');
flies('two thumbs: a two-finger tap, the left finger first');
ok(taps('two thumbs: a two-finger tap, the left finger first') === 1, 'that two-finger tap is one splat');
ok(note('two thumbs: a resting left thumb').fired === 1 && taps('two thumbs: a resting left thumb') === 1, 'a tap on the right beside a resting left thumb fires on its own lift');
ok(note('a lone right flick flies').thumb && !note('a lone right flick flies').look && by('a lone right flick flies').gear === 1, 'it flies until the lift, then it was a flick');
looks('a thumb landing in the zone during');
ok(by('a thumb landing in the zone during').gear === 1, 'a look thumb stays a look thumb, and the flick counts');
ok(n('a stray out of the zone during', 'flick+') === 2, 'a thumb promoted from a lone flick is a lone thumb after');
flies('a fingertip in the far side band');
flies('a palm in the bottom band');
flies('swapped: a fingertip in the far side band');
flies('a fingertip resting in a band since');

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
quiet('left mouse: a quick drag on the left');
quiet('left mouse: a quick drag on the right');
ok(by('left mouse: a quick drag on the left').thumb, 'the left mouse still flies');
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
