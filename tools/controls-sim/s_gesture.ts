// Tap vs hold vs drag through the REAL Input (and the real TiltMix for the tilt rows), offline: synthetic pointer / key events on a
// controlled clock, one frame (input.update) every 16.7 ms like the game loop. Writes the
// disambiguation table to shots/controls/sim/gestures.json (+ a readable table on stdout).
import { installDom, Target, clock, ptr, newId, key } from './fakedom';
const { win, doc } = installDom();
import { mkdirSync, writeFileSync } from 'node:fs';

const { Input } = await import('@src/game/Input');
const { TiltMix } = await import('@src/game/Hybrid');
const { TiltCore } = await import('@src/game/Tilt');
const { config } = await import('@src/config');

type Ev = string;
/** tilt on: a real TiltCore at rest behind the real mixer, tilted 12 degrees so a live tilt shows in `stretch` */
function withTilt(input: any) {
  const core = new TiltCore();
  core.calibrate();
  let t = clock.ms / 1000;
  for (let i = 0; i < 40; i++, t += 1 / 60) core.feed(55, 0, 0, t);
  clock.ms = t * 1000;
  const src = { core, active: true, probing: false, get sx() { return core.sx; }, get sy() { return core.sy; }, update() { core.update(clock.ms / 1000); } };
  input.mix = new TiltMix(src);
  input.wakeMix();
  return core;
}
function harness(mode: 'touch' | 'keyboard', tilt = false) {
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode(mode);
  const core = tilt ? withTilt(input) : null;
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
    core?.feed(55, 12, 0, clock.ms / 1000);
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

const rows: Array<{ mode: string; gesture: string; thumb?: boolean; events: string[]; maxChargeHeld: number; dragging: boolean; turboHeld: boolean }> = [];
function row(mode: 'touch' | 'tilt' | 'keyboard', gesture: string, fn: (h: ReturnType<typeof harness>) => void) {
  const h = harness(mode === 'tilt' ? 'touch' : mode, mode === 'tilt');
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
row('touch', 'canvas: slow tap 440 ms, still', (h) => { const id = newId(); h.down(id, X, Y); h.wait(440); h.up(id, X, Y); });
row('touch', 'canvas: 460 ms, still (past stillTapMs)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(460); h.up(id, X, Y); });
row('touch', 'canvas: hold 1 s still (bungee at neutral, no charge)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(1000); h.up(id, X, Y); });
row('touch', 'canvas: drag 80 px (steer)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 80, 0, 300); h.up(id, X + 80, Y); });
row('touch', 'canvas: quick flick 20 px in 90 ms (still a tap)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 20, 0, 90); h.up(id, X + 20, Y); });
row('touch', 'canvas: steer + second finger tap', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.slide(a, X, Y, 60, 0, 300); h.down(b, 100, 300, false); h.wait(90); h.up(b, 100, 300); h.wait(200); h.up(a, X + 60, Y); });
row('touch', 'canvas: two fingers tapped together', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(90); h.up(a, X, Y); h.up(b, 120, 500); });
row('touch', 'canvas: two fingers, both lift at 400 ms', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(370); h.up(a, X, Y); h.up(b, 120, 500); });
row('touch', 'canvas: two fingers, both lift at 470 ms', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(440); h.up(a, X, Y); h.up(b, 120, 500); });
row('touch', 'canvas: second finger on a still first, past 230 ms', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(300); h.down(b, 120, 500, false); h.wait(60); h.up(b, 120, 500); h.wait(30); h.up(a, X, Y); });
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
// ---- MEGA's finger becomes the thumb (the HUD's slide rule, run here against the real adoptThumb)
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
row('touch', 'adopt: charging, pointercancel on the lift', (h) => { const id = newId(); pressMega(h, id); h.wait(800); adopt(h, MX - 30, MY, true); h.wait(100); h.cancel(id, MX - 30, MY); });
row('touch', 'adopt: charging, the pointer is dropped (repeat id)', (h) => { const id = newId(); pressMega(h, id); h.wait(800); adopt(h, MX - 30, MY, true); h.wait(100); h.down(id, 200, 500); h.wait(30); h.up(id, 200, 500); });
row('touch', 'hudBlip with no mixer and a thumb down (harmless)', (h) => { const id = newId(); h.down(id, X, Y); h.input.hudBlip(); h.input.reachDown(); h.input.reachUp(); h.wait(100); h.up(id, X, Y); });
// ---- tilt on: the screen is the bungee, the same gestures
row('tilt', 'screen: quick tap (120 ms): tilt keeps flying', (h) => { const id = newId(); h.down(id, X, Y); h.wait(120); h.up(id, X, Y); });
row('tilt', 'screen: quick tap wandering 22 px in 100 ms (still a tap)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 22, 0, 100); h.up(id, X + 22, Y); });
row('tilt', 'screen: 280 ms, still', (h) => { const id = newId(); h.down(id, X, Y); h.wait(280); h.up(id, X, Y); });
row('tilt', 'screen: 440 ms, still', (h) => { const id = newId(); h.down(id, X, Y); h.wait(440); h.up(id, X, Y); });
row('tilt', 'screen: hold 2 s (clutched, no charge, no splat)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(2000); h.up(id, X, Y); });
row('tilt', 'screen: drag 70 px (thumb replaces tilt)', (h) => { const id = newId(); h.down(id, X, Y); h.slide(id, X, Y, 70, 0, 200); h.wait(300); h.up(id, X + 70, Y); });
row('tilt', 'screen: grip at the edge, held 1 s (no clutch)', (h) => { const id = newId(); h.down(id, 6, Y); h.wait(1000); (h as any).gripThumb = h.input.state.thumb; h.up(id, 6, Y); });
row('tilt', 'screen: grip at the edge, then 30 px (a drag)', (h) => { const id = newId(); h.down(id, 6, Y); h.wait(500); h.slide(id, 6, Y, 30, 0, 120); h.up(id, 36, Y); });
row('tilt', 'screen: steer + second finger tap', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.slide(a, X, Y, 60, 0, 300); h.down(b, 100, 300, false); h.wait(90); h.up(b, 100, 300); h.wait(200); h.up(a, X + 60, Y); });
row('tilt', 'screen: two fingers tapped together', (h) => { const a = newId(), b = newId(); h.down(a, X, Y); h.wait(30); h.down(b, 120, 500, false); h.wait(90); h.up(a, X, Y); h.up(b, 120, 500); });
row('tilt', 'screen: three fingers (tuner)', (h) => { const a = newId(), b = newId(), c = newId(); h.down(a, X, Y); h.down(b, 100, 500, false); h.down(c, 300, 500, false); h.wait(100); h.up(a, X, Y); h.up(b, 100, 500); h.up(c, 300, 500); });
row('tilt', 'screen: hold 1 s, pointercancel (OS took the touch)', (h) => { const id = newId(); h.down(id, X, Y); h.wait(1000); h.cancel(id, X, Y); });
row('tilt', 'screen: hold 1 s, app loses focus', (h) => { const id = newId(); h.down(id, X, Y); h.wait(1000); win.dispatch('blur', {}); h.wait(100); h.up(id, X, Y); });
row('tilt', 'button: hold 1 s while tilted (charges, tilt flies)', (h) => { h.input.splatButton(true, false, clock.ms); h.wait(1000); h.input.splatButton(false, false, clock.ms); });
// ---- keyboard
row('keyboard', 'Space tap (100 ms)', (h) => { win.dispatch('keydown', key('Space')); h.wait(100); win.dispatch('keyup', key('Space')); });
row('keyboard', 'Space hold 1.5 s (auto-repeat keydowns)', (h) => { win.dispatch('keydown', key('Space')); for (let i = 0; i < 10; i++) { h.wait(150); win.dispatch('keydown', key('Space', true)); } win.dispatch('keyup', key('Space')); });
row('keyboard', 'E, Q, Shift held 500 ms', (h) => { win.dispatch('keydown', key('KeyE')); win.dispatch('keyup', key('KeyE')); h.wait(50); win.dispatch('keydown', key('KeyQ')); win.dispatch('keyup', key('KeyQ')); win.dispatch('keydown', key('ShiftLeft')); h.wait(500); win.dispatch('keyup', key('ShiftLeft')); });
row('keyboard', 'Space hold 1 s, window blur', (h) => { win.dispatch('keydown', key('Space')); h.wait(1000); win.dispatch('blur', {}); win.dispatch('keyup', key('Space')); });

mkdirSync('shots/controls/sim', { recursive: true });
writeFileSync('shots/controls/sim/gestures.json', JSON.stringify({ holdThreshold: config.splat.holdThreshold, rows }, null, 1));
const by = (g: string) => rows.find((r) => r.gesture.startsWith(g))!;
const taps = (g: string) => by(g).events.filter((e) => e.startsWith('tap')).length;
const count = (g: string, k: string) => by(g).events.filter((e) => e.startsWith(k)).length;
const fails: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) fails.push(m); };
ok(taps('canvas: quick tap') === 1, 'quick tap');
ok(taps('canvas: slow tap (260') === 1, 'the named exception: a 260 ms still press splats');
ok(taps('canvas: slow tap 440') === 1, '440 ms splats');
ok(taps('canvas: 460') === 0, '460 ms does not');
ok(taps('canvas: quick flick') === 1, 'row 77: the flick is still a tap');
ok(taps('canvas: drag 80') === 0, 'a drag never taps');
ok(taps('canvas: two fingers, both lift at 400') === 1, 'two together at 400 ms: one tap');
ok(taps('canvas: two fingers, both lift at 470') === 0, 'two together at 470 ms: none');
ok(taps('canvas: second finger on a still first') === 1, 'second finger past 230 ms');
ok(taps('adopt: 14 px') === 1, 'adopt in the quick window: one tap');
ok(taps('adopt: before the charge') === 0, 'adopt before charge: no tap');
ok(taps('adopt: while charging') === 0 && count('adopt: while charging', 'chargeEnd') === 1, 'adopted charge: one chargeEnd, no tap');
ok(by('adopt: while charging').dragging, 'adopted charge steers');
ok(count('adopt: refused', 'tap') === 1, 'refused: MEGA keeps its press and its lift taps');
ok(count('adopt: second finger', 'tap') === 1 && count('adopt: second finger', 'chargeEnd') === 1, 'second finger during adoption');
ok(by('adopt: charging, pointercancel').events.some((e) => e.includes('cancelled')), 'cancel ends the kept charge cancelled');
ok(by('adopt: charging, the pointer is dropped').events.filter((e) => e.startsWith('chargeEnd')).length === 1, 'drop ends the kept charge');
ok(taps('screen: quick tap (120') === 1, 'tilt: tap');
ok(taps('screen: hold 2 s') === 0, 'tilt: a long hold never splats');
ok(taps('screen: grip at the edge, held') === 0, 'grip: no splat');
for (const r of rows) if (!r.gesture.startsWith('button') && !r.gesture.startsWith('adopt') && r.mode !== 'keyboard') ok(!r.events.some((e) => e.startsWith('chargeStart')), `no charge from the canvas: ${r.gesture}`);
for (const r of rows) console.log(`${r.mode.padEnd(8)} | ${r.gesture.padEnd(62)} | ${r.events.join(', ') || '-'}${r.maxChargeHeld ? ` | chargeHeld max ${r.maxChargeHeld}` : ''}${r.dragging ? ' | steering' : ''}${r.turboHeld ? ' | turboHeld' : ''}`);
void doc;
console.log(fails.length ? `FAILED ${fails.length}:\n  ${fails.join('\n  ')}` : `gesture checks: all passed (${rows.length} rows)`);
process.exit(fails.length ? 1 : 0);
