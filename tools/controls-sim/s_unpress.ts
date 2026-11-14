// The Lob latch's give-back (410222e: Input.onUnpress) on both of Input's paths, the plain page's and ?swerve's long swipe (swipeOn), through the REAL Input
// on a controlled clock, a frame every 16.7 ms: node tools/controls-sim/run.mjs s_unpress.ts
// A finger that lands off the lane with nobody flying is a press (onPress, its turn Input.presses), and main.ts runs the Lob's latch on with it (Aimer.press).
// If it lifts as no tap, Input gives that turn back (onUnpress, Aimer.unpress), so a look's or a flick's landing never carries the lift's body to a later tap.
// ?swerve's strokes from the top of the glass are long swipes first: one that fires, one that dies a look on its own clock (c863a1a, its events' time), and
// one whose moves come in late. Each must give back exactly its own turn, and a tap must give back none (its tap throws).
//   tap        still and short off the lane: a tap, nothing given back
//   look       a pan, and a rest held still 1.5 s: no tap, its turn given back
//   flick      up and down off the lane: a gear, its turn given back
//   top        from the top of the glass: a long stroke down (on ?swerve the long swipe), a pan held still (on ?swerve the swipe dies by its age), and a
//              240 ms stroke whose moves come in 90 ms of frames apart (on ?swerve it fires by its events): no tap, each one's turn given back
//   held       a look lands, a tap's finger lands 0.2 s on, the look lifts 0.05 s after that and the tap 0.1 s later: one tap, and only the look's turn back
// Prints a row each, and exits 1 if one fails.
import { installDom, Target, clock, ptr, newId, runTimers } from './fakedom';
installDom();
const { Input, inputTune } = await import('@src/game/Input');
const { swerveTune } = await import('@src/game/Swerve');
const { swipeTune } = await import('@src/swerve/swerveBoot');

let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(46)} ${JSON.stringify(o)}`);
};
const step = 16.7;

/** A stroke for `gesture`: lands at (x, y) `at` ms from the start, moves by (dx, dy) over `ms` in `n` moves (late: each move handled `late` ms of frames after
 *  the last, stamped where the stroke had it), and lifts `hold` ms after its last move */
interface Stroke { x: number; y: number; dx: number; dy: number; ms: number; hold: number; at?: number; late?: number }

/** Strokes on one Input (swipe: ?swerve's swipeOn), each finger its own: the turns pressed, those given back, and the taps, gears and long swipes */
function gesture(swipe: boolean, strokes: Stroke[]) {
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode('touch');
  input.busZone = { x: 196, y: 511, r: inputTune.laneHalf * 393, open: inputTune.laneOpen * 852 };
  input.swipeOn = swipe;
  input.swipeRule = swipeTune;
  const pressed: number[] = [], back: number[] = [], gears: number[] = [];
  let taps = 0, swipes = 0;
  input.onPress = () => void pressed.push(input.presses);
  input.onUnpress = (n) => void back.push(n);
  input.onTap = () => void taps++;
  input.onTurbo = (dir) => void gears.push(dir);
  input.onSwipe = () => void swipes++;
  // (every event of every stroke on one timeline, run in order with the frames between)
  type Ev = { t: number; run: () => void };
  const evs: Ev[] = [];
  const t0 = clock.ms;
  strokes.forEach((s, k) => {
    const id = newId(), at = s.at ?? 0, n = s.late ? 8 : Math.max(1, Math.round(s.ms / step));
    evs.push({ t: at, run: () => el.dispatch('pointerdown', ptr('pointerdown', id, s.x, s.y, k === 0)) });
    for (let i = 1; i <= n; i++) {
      const stamp = t0 + at + (s.ms * i) / n;
      evs.push({ t: at + (s.late ? s.late * i : (s.ms * i) / n), run: () => el.dispatch('pointermove', { ...ptr('pointermove', id, s.x + (s.dx * i) / n, s.y + (s.dy * i) / n, k === 0), ...(s.late ? { timeStamp: stamp } : {}) }) });
    }
    const end = at + (s.late ? s.late * n : s.ms) + s.hold;
    evs.push({ t: end, run: () => el.dispatch('pointerup', ptr('pointerup', id, s.x + s.dx, s.y + s.dy, k === 0)) });
  });
  evs.sort((a, b) => a.t - b.t);
  let next = clock.ms + step;
  const until = (t: number) => {
    while (next <= t) {
      clock.ms = next;
      runTimers();
      input.update(step / 1000);
      next += step;
    }
    clock.ms = t;
    runTimers();
  };
  for (const e of evs) {
    until(t0 + e.t);
    e.run();
  }
  until(clock.ms + 200);
  input.dispose();
  return { pressed, back, taps, gears, swipes };
}

const look = { x: 70, y: 330 }, top = { x: 70, y: 120 };
const down = 0.4 * 852 + 30;
for (const swipe of [false, true]) {
  const P = swipe ? '?swerve' : 'plain';
  const one = (name: string, s: Stroke, more: (r: ReturnType<typeof gesture>) => boolean) => {
    const r = gesture(swipe, [s]);
    row(r.pressed.length === 1 && r.back.length === 1 && r.back[0] === r.pressed[0] && r.taps === 0 && more(r), `${P} ${name}`, r);
  };
  const t = gesture(swipe, [{ ...look, dx: 0, dy: 0, ms: 0, hold: 80 }]);
  row(t.pressed.length === 1 && t.back.length === 0 && t.taps === 1, `${P} tap: a tap, nothing given back`, t);
  one('look: a pan', { ...look, dx: 120, dy: 0, ms: 300, hold: 100 }, (r) => r.gears.length === 0);
  one('look: a rest held 1.5 s', { ...look, dx: 0, dy: 0, ms: 0, hold: 1500 }, (r) => r.gears.length === 0);
  one('flick: up', { ...look, dx: 0, dy: -90, ms: 80, hold: 0 }, (r) => r.gears.join() === '1');
  one('flick: down', { ...look, dx: 0, dy: 90, ms: 80, hold: 0 }, (r) => r.gears.join() === '-1');
  // (from the top: on ?swerve the long swipe fires, and its lift is nothing else; on the plain page the same stroke is a gear down or a look)
  one('top: a long stroke down', { ...top, dx: 10, dy: down, ms: 220, hold: 100 }, (r) => (swipe ? r.swipes === 1 && r.gears.length === 0 : r.swipes === 0));
  one('top: a pan held still 1.5 s', { ...top, dx: 0, dy: 60, ms: 200, hold: 1500 }, (r) => r.swipes === 0 && r.gears.length === 0);
  one('top: 240 ms by its events, 720 of frames', { x: 320, y: 110, dx: 0, dy: 400, ms: 240, hold: 40, late: 90 }, (r) => (swipe ? r.swipes === 1 : r.swipes === 0));
  // (a look under a tap: the tap throws, and only the look's turn comes back, not the tap's)
  const h = gesture(swipe, [{ ...look, dx: 120, dy: 0, ms: 200, hold: 50 }, { x: 300, y: 300, dx: 0, dy: 0, ms: 0, hold: 100, at: 200 }]);
  row(h.pressed.length === 2 && h.back.join() === String(h.pressed[0]) && h.taps === 1, `${P} held: a look under a tap gives back its own`, h);
}
if (top.y > swerveTune.swipeTop * 852 || look.y <= swerveTune.swipeTop * 852) row(false, 'the strokes start where they mean to (top above swipeTop, look under it)', { swipeTop: swerveTune.swipeTop });

console.log(bad ? `${bad} FAILED` : 'all pass');
process.exit(bad ? 1 : 0);
