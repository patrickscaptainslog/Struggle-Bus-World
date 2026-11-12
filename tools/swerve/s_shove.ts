// A hit's throw on a flat world (Flight.shove, src/rivals/rivalsBoot.ts's hurtMe): the real Flight and TurboDrive with ?swerve's handling on, no browser:
//   node tools/feel-sim/run.mjs ../swerve/s_shove.ts
//   drive    a throw holds the gear's drive only as far as it goes against the bus's way: a shell's from behind or across at Jet and Turbo 3 leaves the gear
//            driving (never under 90 % of its speed, and no second sonic boom on the way back up), and a head-on's, straight back, takes it all (under half
//            its speed as the throw ends, and the bus behind where it was hit, on any heading)
// Prints each, and exits 1 if a row fails.
import { Flight } from '@src/game/Flight';
import { TurboDrive, type TurboEvent } from '@src/game/Turbo';
import { rivalTune } from '@src/rivals/rivals';

const flat = { obstacleAt: () => 20, groundAt: () => 10 };
const r1 = (v: number) => +v.toFixed(1), r2 = (v: number) => +v.toFixed(2);

/** A bus in a gear on the flat world, settled at its speed and height, the handling on; each frame as main.ts's: the gears, then the flight's steps at 120 Hz. */
function bus(rungs: number, dt: number, heading = 0) {
  const f = new Flight();
  f.heading = heading;
  f.y = 26.5;
  f.glideSpeed = 0;
  f.swerve.on = true;
  const drive = new TurboDrive([-1e9, -1e9, 1e9, 1e9]);
  drive.edgeless = true;
  const events: TurboEvent[] = [];
  drive.onEvent = (e) => events.push(e);
  const frame = (sx = 0, sy = 0, dragging = false) => {
    drive.update(dt, f);
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < n; i++) f.step(dt / n, { sx, sy, dragging, hard: 0, skid: -Infinity }, flat);
  };
  for (let i = 0; i < rungs; i++) drive.rung(1, f);
  for (let k = 0; k < 40 / dt; k++) frame();
  events.length = 0;
  return { f, drive, events, frame };
}

let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(30)} ${JSON.stringify(o)}`);
};

// ---------------------------------------------------------------- the drive
for (const [gear, rungs] of [['Jet', 3], ['Turbo 3', 6]] as Array<[string, number]>) {
  for (const dt of [1 / 30, 1 / 60]) {
    // (a shell's throw, as hurtMe throws it: from behind, and across the bus's way)
    for (const [from, a] of [['behind', 0], ['across', Math.PI / 2]] as Array<[string, number]>) {
      const b = bus(rungs, dt), f = b.f, v0 = f.speed;
      f.shove(rivalTune.soakThrow, Math.sin(f.heading + a), -Math.cos(f.heading + a), rivalTune.air[0]);
      let least = v0;
      for (let k = 0; k < 8 / dt; k++) {
        b.frame();
        least = Math.min(least, f.speed);
      }
      row(least >= v0 * 0.9 && !b.events.includes('boom'), `drive, ${gear}, a shell from ${from}, ${Math.round(1 / dt)} fps`, { gear: Math.round(v0), slowest: r1(least), events: b.events.join(',') });
    }
    // (a head-on's, straight back the way it came: on a heading that isn't round, so straight back is a hair off it)
    const b = bus(rungs, dt, 1.7), f = b.f, v0 = f.speed, x0 = f.x, z0 = f.z, ux = -f.fx, uz = -f.fz, far = 1350;
    f.shove(far, ux, uz, rivalTune.air[3]);
    let k = 0;
    for (; f.shoving && k < 10 / dt; k++) b.frame();
    const back = ((f.x - x0) * ux + (f.z - z0) * uz) / far;
    row(f.speed < v0 * 0.5 && back > 0.5, `drive, ${gear}, a head-on, ${Math.round(1 / dt)} fps`, { gear: Math.round(v0), atItsEnd: r1(f.speed), backShare: r2(back), after: r2(k * dt) });
  }
}

console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
