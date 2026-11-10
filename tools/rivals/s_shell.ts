// The two shells, flown by the shot code's own homing shot (docs/specs/factions/RAMPAGE.md, "In front of you: the shell"): the REAL Holds, Flight, TurboDrive and
// particles, the rivals' brain and ?swerve's handling over a flat world, offline, and the very options the game fires (src/rivals/shell.ts):
//   node tools/controls-sim/run.mjs ../rivals/s_shell.ts
//   holds    the player's shell at a rival that holds its line, from 120, 250 and 380 m, dead ahead and 18 degrees off the nose, in Cruise, Express, Nonstop
//            and Jet, at 30 and at 60 frames a second: every one lands, and how long it took
//   skid     the same shots at a rival that always tries its skid as the shot goes white: how many it gets clear of, by gear. No dice: the skid is a real turn
//   back     a rival's shell at a player that holds its line: it lands. And at a player that turns hard, or skids, as it goes white: how many miss, by gear
// Prints a row each, and exits 1 if one fails.
import { installDom, Target } from '../controls-sim/fakedom';
installDom();
const THREE = await import('three');
const { Input } = await import('@src/game/Input');
const { Flight } = await import('@src/game/Flight');
const { TurboDrive } = await import('@src/game/Turbo');
const { Holds } = await import('@src/game/Hold');
const { Particles } = await import('@src/fx/Particles');
const { config } = await import('@src/config');
const { Rivals, rivalTune: T, RState } = await import('@src/rivals/rivals');
const { shellAt, shellBack } = await import('@src/rivals/shell');
const { Swerve } = await import('@src/swerve/swerve');

const FLAT = { obstacleAt: () => 20, groundAt: () => 10 };
const DEG = Math.PI / 180;
const GEARS = [['Cruise', 0], ['Express', 1], ['Nonstop', 2], ['Jet', 3]] as const;
let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(30)} ${JSON.stringify(o)}`);
};
// (the stick's own curve, as tools/swerve/s_turns.ts has it)
function stickOf(dx: number): number {
  const F = config.flight, d = Math.min(Math.abs(dx), 2.2 * F.stretchPx);
  if (d <= F.deadZonePx) return 0;
  const s0 = (d - F.deadZonePx) / F.stretchPx, s = s0 <= 0.72 ? s0 : 0.72 + 0.28 * Math.tanh((s0 - 0.72) / 0.28);
  return Math.sign(dx) * s;
}

/** The player's bus in a gear, the shot code's holds on it, the rivals' brain, and the handling. */
function harness(rungs: number, dt: number) {
  const el = new Target(), input = new Input(el as unknown as HTMLElement);
  const flight = new Flight();
  Object.assign(flight, { y: 26.5, glideSpeed: 0 });
  const drive = new TurboDrive([-1e9, -1e9, 1e9, 1e9]);
  drive.edgeless = true;
  const sw = new Swerve();
  const camera = new THREE.PerspectiveCamera(60, 393 / 852, 1, 20000);
  const city = { surfaceAt: () => 10, groundAt: () => 10, buildingAt: () => null, roofAt: () => null } as never;
  const audio = { hosePour() {}, hoseLevel() {}, hoseStop() {}, denied() {}, superHoseHit() {}, homingWhistle() {}, homingHit() {}, homingMiss() {} } as never;
  const mouth = new THREE.Vector3();
  const holds = new Holds({ input, camera, city, flight, particles: new Particles(2000) as never, audio, mouth: () => mouth.set(flight.x + flight.fx * 6, flight.y, flight.z + flight.fz * 6), view: () => ({ w: 393, h: 852 }), faction: () => 1, breath: () => {} });
  const R = new Rivals(11);
  R.on = false;
  let thumb: number | null = null, t = 0;
  const frame = () => {
    const sx = thumb === null ? 0 : stickOf(thumb);
    drive.update(dt, flight);
    sw.pre(dt, { dragging: thumb !== null, dx: thumb ?? 0, sx }, flight);
    const n = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < n; i++) flight.step(dt / n, { sx, sy: 0, dragging: thumb !== null }, FLAT);
    sw.post(dt, flight);
    camera.position.set(flight.x, flight.y + 60, flight.z + 150);
    camera.updateMatrixWorld();
    R.step(dt, { x: flight.x, y: flight.y, z: flight.z, heading: flight.heading, nose: flight.heading + sw.slip, speed: flight.ground, faction: 1, out: false }, FLAT);
    holds.frame(dt);
    t += dt;
  };
  for (let i = 0; i < rungs; i++) drive.rung(1, flight);
  for (let k = 0; k < 90 / dt && (k * dt < 4 || (rungs > 0 && !drive.engaged) || Math.abs(flight.speed - (flight.turbo.speed || flight.speed)) > 0.5); k++) frame();
  /** A rival `d` m off at `bearing` degrees from the nose, going `turn` degrees off the player's way, level with it. */
  const put = (d: number, bearing: number, turn: number, pace = 0.5) => {
    const r = R.list[0], b = flight.heading + bearing * DEG;
    Object.assign(r, { live: true, faction: 2, state: RState.Roam, x: flight.x + Math.sin(b) * d, z: flight.z - Math.cos(b) * d, y: flight.y, heading: flight.heading + turn * DEG, course: flight.heading + turn * DEG, pace, weave: 0, grudge: false, skidLeft: 0, slip: 0, ramIn: 1e9, paintIn: 1e9, lost: 0, shotIn: 1e9 });
    r.px = r.x;
    r.py = r.y;
    r.pz = r.z;
    // (at its pace's speed already)
    frame();
    r.along = bearing > -90 && bearing < 90;
    const P = r.along ? T.paceWith : T.pace;
    r.speed = Math.max(T.crawl, flight.ground * (P[0] + (P[1] - P[0]) * pace));
    return r;
  };
  return { flight, holds, R, sw, frame, put, setThumb: (v: number | null) => (thumb = v), get t() { return t; }, done: () => { sw.release(); input.dispose(); } };
}

// ---------------------------------------------------------------- the player's shell
for (const always of [false, true]) {
  const dodge = T.dodge, weave = T.weave;
  T.dodge = always ? 1 : 0;
  T.weave = 0;
  for (const [name, rungs] of GEARS) {
    let shots = 0, hits = 0, slowest = 0;
    for (const dt of [1 / 60, 1 / 30])
      for (const d of [120, 250, 380])
        for (const bearing of [0, 18, -18]) {
          const h = harness(rungs, dt), r = h.put(d, bearing, 0);
          h.flight.fullness = 1;
          let result = '';
          const t0 = h.t;
          const shot = h.holds.fire(shellAt(h.R, r, h.flight.speed, () => (result = 'hit'), () => (result = 'miss')));
          for (let k = 0; k < 8 / dt && !result; k++) h.frame();
          shots++;
          if (shot && result === 'hit') {
            hits++;
            slowest = Math.max(slowest, h.t - t0);
          }
          h.done();
        }
    if (always) row(true, `skid, ${name}`, { shots, landed: hits, gotClearOf: shots - hits });
    else row(hits === shots, `holds its line, ${name}`, { shots, landed: hits, slowestS: +slowest.toFixed(2) });
  }
  T.dodge = dodge;
  T.weave = weave;
}

// ---------------------------------------------------------------- a rival's shell back
for (const [what, thumb] of [['holds its line', null], ['turns hard', 124], ['skids', 172]] as const) {
  for (const [name, rungs] of GEARS) {
    let shots = 0, hits = 0;
    for (const dt of [1 / 60, 1 / 30])
      for (const d of [150, 260, 380])
        for (const bearing of [180, 150, -150, 90]) {
          // (the rival behind or beside the player, its nose on it)
          const h = harness(rungs, dt), r = h.put(d, bearing, 0, 1), f = h.flight;
          r.heading = Math.atan2(f.x - r.x, -(f.z - r.z));
          const from = new THREE.Vector3(r.x, r.y, r.z);
          let result = '';
          const shot = h.holds.fire(shellBack(r, from, (o) => void h.holds.bus(o), (o) => void h.holds.busVel(o), f.speed, () => (result = 'hit'), () => (result = 'miss')));
          for (let k = 0; k < 8 / dt && !result; k++) {
            // (the player answers as it goes white: the thumb out to the hard part, or the skid's, away from the side it comes from)
            if (shot?.white && thumb !== null) h.setThumb(thumb * (bearing < 0 ? 1 : -1));
            h.frame();
          }
          shots++;
          if (result === 'hit') hits++;
          h.done();
        }
    if (thumb === null) row(hits === shots, `back, the player ${what}, ${name}`, { shots, landed: hits });
    else row(true, `back, the player ${what}, ${name}`, { shots, landed: hits, gotClearOf: shots - hits });
  }
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
