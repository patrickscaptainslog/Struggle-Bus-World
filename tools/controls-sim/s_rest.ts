// The Lob latch beside a flying thumb that's back down and not yet committed, through the REAL Input on a controlled clock, a frame every 16.7 ms:
//   node tools/controls-sim/run.mjs s_rest.ts
// A pull lifts and the same thumb lands again, resting on the lane under the bus or charging a Bomb on the bus itself. Its landing is a press (onPress),
// and main.ts runs the lift's latch on with it (Aimer.press), since the Aimer's thumb (state.thumb) turns true only when the thumb commits, at stillTapMs.
// The other thumb then taps in the look zone. Its landing is no press (a thumb is flying), and once the flying thumb is past tapMs its tap is answered
// at once (Input.answer). Lob.ts's rule: "A second thumb's tap, the first still steering, reads it live". So the tap must fire with state.thumb true, or
// with the flying thumb's press given back first (onUnpress): else it throws the lift's body with the bus level.
//   lane   resting on the lane, the other thumb tapping at 300 and at 380 ms (before the rest commits at 450)
//   bomb   charging on the bus, the other thumb tapping at 250 and 300 ms (before tier 1, aimHoldMs + aimLagMs: from it the Aimer bombs and plans no Lob)
// Prints a row each, and exits 1 if one fails.
import { installDom, Target, clock, ptr, newId, runTimers } from './fakedom';
installDom();
const { Input, inputTune } = await import('@src/game/Input');

let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(46)} ${JSON.stringify(o)}`);
};
const step = 16.7;

function run(bomb: boolean, restMs: number, tapAt: number, tapMs: number) {
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode('touch');
  input.busZone = { x: 196, y: 511, r: inputTune.laneHalf * 393, open: inputTune.laneOpen * 852 };
  if (bomb) {
    input.bombOn = true;
    input.bombFull = true;
  }
  const pressed: Array<[number, number]> = [], back: number[] = [], taps: Array<{ ms: number; thumb: boolean }> = [];
  const t0 = clock.ms;
  input.onPress = () => void pressed.push([input.presses, Math.round(clock.ms - t0)]);
  input.onUnpress = (n) => void back.push(n);
  input.onTap = () => void taps.push({ ms: Math.round(clock.ms - t0), thumb: input.state.thumb });
  // (the flying thumb on the bus itself for the Bomb, else on the lane under it; the other thumb in the look zone)
  const fly = bomb ? { x: 196, y: 511 } : { x: 196, y: 700 }, look = { x: 70, y: 330 };
  const a = newId(), b = newId();
  const evs: Array<{ t: number; run: () => void }> = [
    { t: 0, run: () => el.dispatch('pointerdown', ptr('pointerdown', a, fly.x, fly.y, true)) },
    { t: tapAt, run: () => el.dispatch('pointerdown', ptr('pointerdown', b, look.x, look.y, false)) },
    { t: tapAt + tapMs, run: () => el.dispatch('pointerup', ptr('pointerup', b, look.x, look.y, false)) },
    { t: restMs, run: () => el.dispatch('pointerup', ptr('pointerup', a, fly.x, fly.y, true)) },
  ].sort((p, q) => p.t - q.t);
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
  return { pressed, back, taps };
}

for (const bomb of [false, true])
  for (const [tapAt, tapMs] of (bomb ? [[250, 60], [300, 70]] : [[300, 70], [380, 60]]) as Array<[number, number]>) {
    const r = run(bomb, 1200, tapAt, tapMs);
    const t = r.taps[0];
    const flyPress = r.pressed.find((p) => p[1] === 0)?.[0] ?? 0;
    row(r.taps.length === 1 && flyPress > 0 && (t.thumb || r.back.includes(flyPress)), `${bomb ? 'bomb: charging on the bus' : 'lane: resting'}, the other thumb ${tapAt}-${tapAt + tapMs} ms`, r);
  }
console.log(bad ? `FAILED ${bad} (a tap fired with the Aimer's thumb up and the flying thumb's press still out)` : 'all pass');
process.exit(bad ? 1 : 0);
