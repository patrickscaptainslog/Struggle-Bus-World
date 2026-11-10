// The long swipe through the REAL Input, Shifter, TurboDrive and Flight with ?swerve's boot over them (src/swerve/swerveBoot.ts), offline: synthetic touches on
// a controlled clock, a frame every 16.7 ms, the frame's order main.ts's: node tools/controls-sim/run.mjs ../swerve/s_swipe.ts
// The bus's lane is where main.ts puts it on a 393 x 852 screen (the bus at 196, 511), so a landing over it looks and one under it flies.
//   swipe    one stroke down of 40 % of the screen's height from off the lane, from every rung above Cruise: Cruise before it lifts, at Cruise's speed in under
//            0.8 s, and its lift is no flick; from Cruise, from School Zone: nothing, whatever its pace (a fast one is no flick down either)
//   still    a flick down is still one rung; a slow stroke down is still a look; a stroke down the stick is still a pull (and fast, the lone flick it was); a
//            slanted one and one going up are what they were; with the other thumb steering it still brakes
// Prints a row each, and exits 1 if one fails.
import { installDom, Target, clock, ptr, newId, runTimers } from '../controls-sim/fakedom';
installDom();
const { Input, inputTune } = await import('@src/game/Input');
const { Shifter } = await import('@src/game/Shifter');
const { TurboDrive } = await import('@src/game/Turbo');
const { Flight } = await import('@src/game/Flight');
const { config } = await import('@src/config');
const { bootSwerve } = await import('@src/swerve/swerveBoot');

const ROOFS = { obstacleAt: () => 20, groundAt: () => 10 };
const NAMES = ['Cruise', 'Express', 'Nonstop', 'Jet', 'Turbo 1', 'Turbo 2', 'Turbo 3'];
let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(38)} ${JSON.stringify(o)}`);
};

function harness(rungs: number) {
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode('touch');
  // (the bus's lane, as main.ts sets it every frame from where the bus stands)
  input.busZone = { x: 196, y: 511, r: inputTune.laneHalf * 393, open: inputTune.laneOpen * 852 };
  const flight = new Flight();
  Object.assign(flight, { y: 26.5, glideSpeed: 0 });
  const drive = new TurboDrive([-1e9, -1e9, 1e9, 1e9]);
  drive.edgeless = true;
  const shifter = new Shifter(drive, flight);
  const evs: string[] = [];
  const nothing = () => {};
  const swerve = bootSwerve({
    el: el as unknown as HTMLElement, flight, turbo: drive, offLane: (x, y) => input.inLookZone(x, y), barf: nothing, groundAt: () => 10,
    particles: { palette: [8, 9, 10, 11, 12, 13], puff: nothing, fling: nothing }, hue: () => 0, kick: nothing, kit: () => null,
  });
  input.onTurbo = (d, flew) => {
    // (Controls' gate)
    if (swerve.flick(d)) return void evs.push('gated');
    evs.push(d > 0 ? 'flick+' : 'flick-');
    shifter.flick(d, flew);
  };
  input.onTap = () => evs.push('tap');
  let looked = false, pulled = 0;
  const step = 16.7;
  const frame = () => {
    const dt = step / 1000;
    input.update(dt);
    shifter.tick();
    drive.update(dt, flight);
    const st = input.state;
    swerve.pre(dt, st, false);
    for (let i = 0; i < 2; i++) flight.step(dt / 2, { sx: st.stretch.x, sy: st.stretch.y, dragging: st.dragging }, ROOFS);
    swerve.post(dt);
    if (st.look.on && !swerve.swiped) looked = true;
    pulled = Math.max(pulled, st.dragging ? -st.stretch.y : 0);
  };
  let next = clock.ms + step;
  const wait = (ms: number) => {
    const end = clock.ms + ms;
    while (next <= end) {
      clock.ms = next;
      runTimers();
      frame();
      next += step;
    }
    clock.ms = end;
    runTimers();
  };
  for (let i = 0; i < rungs; i++) drive.rung(1, flight);
  for (let k = 0; k < 5400 && (k < 240 || (rungs > 0 && !drive.engaged) || Math.abs(flight.speed - (flight.turbo.speed || flight.speed)) > 0.5); k++) wait(step);
  const h = {
    input, drive, flight, swerve, evs, wait,
    get looked() { return looked; },
    get pulled() { return pulled; },
    get rung() { return drive.below > 0 ? -drive.below : drive.gear + drive.level; },
    down(id: number, x: number, y: number, primary = true) { el.dispatch('pointerdown', ptr('pointerdown', id, x, y, primary)); },
    move(id: number, x: number, y: number) { el.dispatch('pointermove', ptr('pointermove', id, x, y)); },
    up(id: number, x: number, y: number) { el.dispatch('pointerup', ptr('pointerup', id, x, y)); },
    /** One stroke from (x, y) by (dx, dy) over ms, lifted. Returns the rung it had just before its lift, and when it first read Cruise (ms into it). */
    stroke(x: number, y: number, dx: number, dy: number, ms: number, primary = true) {
      const id = newId(), n = Math.max(1, Math.round(ms / step));
      let cruiseAt = NaN;
      h.down(id, x, y, primary);
      for (let i = 1; i <= n; i++) {
        wait(ms / n);
        h.move(id, x + (dx * i) / n, y + (dy * i) / n);
        if (Number.isNaN(cruiseAt) && h.rung === 0) cruiseAt = (ms * i) / n;
      }
      const before = h.rung;
      h.up(id, x + dx, y + dy);
      return { before, cruiseAt };
    },
  };
  return h;
}

// ---- the swipe, from every rung above Cruise, quick (220 ms: a flick's pace) and unhurried (450 ms)
for (let rungs = 1; rungs <= 6; rungs++) {
  for (const ms of [220, 450]) {
    const h = harness(rungs), v0 = h.flight.speed;
    const s = h.stroke(70, 90, 10, 0.4 * 852 + 30, ms);
    let at = NaN;
    for (let k = 0; k < 120; k++) {
      h.wait(16.7);
      if (Number.isNaN(at) && h.flight.speed <= config.flight.cruiseSpeed * 1.15) at = (k + 1) * 16.7;
    }
    // (the brake began as the stroke passed its length, a little before its lift)
    row(s.before === 0 && h.rung === 0 && !h.evs.includes('flick-') && !h.evs.includes('flick+') && !h.evs.includes('tap') && at + (ms - s.cruiseAt) <= 800, `swipe from ${NAMES[rungs]}, ${ms} ms`, { from: Math.round(v0), cruiseBeforeLift: s.before === 0, atCruiseSpeedMs: Math.round(at + (ms - s.cruiseAt)), events: h.evs });
    h.input.dispose();
  }
}
// ---- from Cruise and from School Zone it is nothing, and a fast one is no flick down either
for (const [name, below] of [['Cruise', 0], ['School Zone', 1]] as const) {
  for (const ms of [200, 450]) {
    const h = harness(0);
    if (below) h.drive.rung(-1, h.flight);
    h.wait(600);
    const r0 = h.rung;
    h.stroke(70, 90, 0, 0.4 * 852 + 30, ms);
    h.wait(600);
    row(h.rung === r0 && !h.evs.includes('flick-'), `swipe from ${name}, ${ms} ms`, { rung: h.rung, was: r0, events: h.evs });
    h.input.dispose();
  }
}
// ---- what it must not take
{
  const h = harness(3);
  h.stroke(100, 300, 0, 74, 85);
  h.wait(600);
  row(h.rung === 2 && h.evs.join() === 'flick-', 'a flick down at Jet', { rung: NAMES[h.rung], events: h.evs });
  h.input.dispose();
}
{
  const h = harness(3);
  h.stroke(70, 90, 0, 0.4 * 852 + 30, 950);
  h.wait(600);
  row(h.rung === 3 && h.looked && h.evs.length === 0, 'a slow stroke down, 950 ms', { rung: NAMES[h.rung], looked: h.looked, events: h.evs });
  h.input.dispose();
}
{
  // (short of its length: 30 % of the height, quick. A flick down, as it always was)
  const h = harness(3);
  h.stroke(70, 90, 0, 0.3 * 852, 200);
  h.wait(600);
  row(h.rung === 2 && h.evs.join() === 'flick-', 'a stroke of 30 %, 200 ms', { rung: NAMES[h.rung], events: h.evs });
  h.input.dispose();
}
{
  // (down the stick: it lands in the lane, under the bus, and pulls)
  const h = harness(3);
  h.stroke(196, 470, 0, 0.4 * 852 + 30, 450);
  h.wait(600);
  row(h.rung === 3 && h.pulled > 0.9 && !h.looked, 'a stroke down the stick, 450 ms', { rung: NAMES[h.rung], pulled: +h.pulled.toFixed(2), events: h.evs });
  h.input.dispose();
}
{
  // (slanted: 45 degrees. A look)
  const h = harness(3);
  h.stroke(20, 90, 372, 372, 450);
  h.wait(600);
  row(h.rung === 3 && h.looked, 'a slanted stroke, 450 ms', { rung: NAMES[h.rung], looked: h.looked, events: h.evs });
  h.input.dispose();
}
{
  const h = harness(3);
  h.stroke(70, 500, 0, -(0.4 * 852 + 30), 300);
  h.wait(600);
  row(h.rung === 3 && h.evs.length === 0, 'a long stroke up, 300 ms', { rung: NAMES[h.rung], events: h.evs });
  h.input.dispose();
}
{
  // (the other thumb steering: the swipe is the second thumb's)
  const h = harness(3), a = newId();
  h.down(a, 300, 640);
  for (let i = 1; i <= 18; i++) {
    h.wait(16.7);
    h.move(a, 300 + (40 * i) / 18, 640);
  }
  const s = h.stroke(70, 90, 0, 0.4 * 852 + 30, 400, false);
  h.wait(300);
  const steering = h.input.state.dragging;
  h.up(a, 340, 640);
  h.wait(300);
  row(s.before === 0 && h.rung === 0 && steering && !h.evs.includes('flick-'), 'a swipe beside a steering thumb', { rung: NAMES[h.rung], steeringThrough: steering, events: h.evs });
  h.input.dispose();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
