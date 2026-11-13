// The long swipe and a far shot's dip (docs/specs/flight/SWERVE.md, "The shots under the handling"), through the REAL Input on a controlled clock, a frame every
// 16.7 ms: node tools/controls-sim/run.mjs ../swerve/s_swipelook.ts
// main.ts lets a far shot's dip go for good on a frame with a look (CameraRig's looksAway, which this imports: the game's own line). Every long swipe from
// the top of the glass starts as a look before it fires (3 frames of 150 ms, 19 of 450: the far shots' review, F2), and from 5 km up those frames put the hit
// under the frame.
//   fired    strokes of 150 to 450 ms down 0.4 of the height plus 30 px from three landings at the top: each fires, and no frame before it is a look that lets
//            the dip go
//   look     a slow stroke from the top (it dies a look) and one from under the swipe's top: each is a look that lets the dip go
// Prints a row each, and exits 1 if one fails.
import { installDom, Target, clock, ptr, newId, runTimers } from '../controls-sim/fakedom';
installDom();
const { Input, inputTune } = await import('@src/game/Input');
const { swerveTune } = await import('@src/game/Swerve');
const { swipeTune } = await import('@src/swerve/swerveBoot');
const { looksAway } = await import('@src/game/CameraRig');

let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(44)} ${JSON.stringify(o)}`);
};
const step = 16.7;

/** One stroke from (x, y) by (dx, dy) px over ms, held still `hold` ms before its lift: when it fired (ms from its landing, null never), its frames of look,
 *  and those that would let a dip go */
function stroke(x: number, y: number, dx: number, dy: number, ms: number, hold = 200) {
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode('touch');
  input.busZone = { x: 196, y: 511, r: inputTune.laneHalf * 393, open: inputTune.laneOpen * 852 };
  input.swipeOn = true;
  input.swipeRule = swipeTune;
  let swipedAt = -1;
  input.onSwipe = () => {
    if (swipedAt < 0) swipedAt = clock.ms;
  };
  const t0 = clock.ms;
  let looks = 0, lets = 0, firstLet = -1;
  let next = clock.ms + step;
  const wait = (w: number) => {
    const end = clock.ms + w;
    while (next <= end) {
      clock.ms = next;
      runTimers();
      input.update(step / 1000);
      const L = input.state.look;
      if (L.on) looks++;
      // (main.ts's test, its own function)
      if (looksAway(L)) {
        lets++;
        if (firstLet < 0) firstLet = clock.ms - t0;
      }
      next += step;
    }
    clock.ms = end;
    runTimers();
  };
  const id = newId(), n = Math.max(1, Math.round(ms / step));
  el.dispatch('pointerdown', ptr('pointerdown', id, x, y, true));
  for (let i = 1; i <= n; i++) {
    wait(ms / n);
    el.dispatch('pointermove', ptr('pointermove', id, x + (dx * i) / n, y + (dy * i) / n));
  }
  wait(hold);
  el.dispatch('pointerup', ptr('pointerup', id, x + dx, y + dy));
  wait(100);
  input.dispose();
  return { from: [x, y], ms, fired: swipedAt < 0 ? null : Math.round(swipedAt - t0), looks, lets, firstLet: firstLet < 0 ? null : Math.round(firstLet) };
}

const down = 0.4 * 852 + 30, top = swerveTune.swipeTop * 852;
for (const [x, y] of [[70, 90], [70, 200], [320, 120]] as const)
  for (const ms of [150, 220, 350, 450]) {
    const s = stroke(x, y, 10, down, ms);
    row(s.fired !== null && s.lets === 0, `fired: from ${x}, ${y} in ${ms} ms`, s);
  }
const slow = stroke(70, 120, 10, down, 1500);
row(slow.fired === null && slow.lets > 0, 'look: a slow stroke from the top', slow);
const under = stroke(70, top + 60, 10, 200, 300);
row(under.fired === null && under.lets > 0, 'look: a stroke from under the swipe\'s top', under);

console.log(bad ? `${bad} FAILED` : 'all pass');
process.exit(bad ? 1 : 0);
