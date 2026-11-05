// The path (docs/specs/flight/NOSE.md) on a flat world, real Flight + TurboDrive + TurboLens + CameraRig, no browser:
//   node tools/feel-sim/run.mjs s_nose.ts [dt]
// The plain pull, Express on the pull, Jet to the ceiling, dives (plain, Express, Nonstop, Jet), releases, a deck, partial sticks, the frame's
// centre on the bus. Prints one line per check; two runs at 1/30 and 1/60 should agree.
import { makeCam, MODE, save, THREE } from './lib';
import { Flight } from '@src/game/Flight';
import { EXPRESS, JET, NONSTOP, TurboDrive } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
const dt = Number(process.argv[2] ?? 1 / 60);
const GROUND = 10, ROOF = 20;
const flat: any = { obstacleAt: () => ROOF, groundAt: () => GROUND };
const DEG = 180 / Math.PI;
const r1 = (x: number) => Math.round(x * 10) / 10;
const res: Record<string, unknown> = {};
const BOUNDS = [-1e6, -1e6, 1e6, 1e6];

function session(world: any = flat, y0 = ROOF + 6.5, bounds = BOUNDS) {
  const f: any = new Flight();
  f.y = y0;
  f.fullness = 1;
  f.glideSpeed = 0;
  f.groundBroad = GROUND;
  const drive = new TurboDrive(bounds);
  const lens = new TurboLens();
  const c = makeCam();
  const s = {
    f, drive, t: 0, maxJumpV: 0, maxJumpP: 0, minY: Infinity, maxY: -Infinity,
    frame(sy: number, dragging = true, sx = 0) {
      drive.update(dt, f);
      const steps = Math.max(1, Math.ceil(dt * 120));
      const x0 = f.x, y0 = f.y, z0 = f.z;
      for (let i = 0; i < steps; i++) f.step(dt / steps, { sx, sy, dragging }, world);
      lens.update(dt, drive, c.rig, f);
      c.update(f, dt);
      s.t += dt;
      s.minY = Math.min(s.minY, f.y);
      s.maxY = Math.max(s.maxY, f.y);
      const step = Math.hypot(f.x - x0, f.y - y0, f.z - z0);
      s.maxJumpP = Math.max(s.maxJumpP, step);
    },
    run(secs: number, sy: number, dragging = true, sx = 0) {
      const n = Math.round(secs / dt);
      for (let k = 0; k < n; k++) s.frame(sy, dragging, sx);
    },
    /** the whole motion right now */
    now() {
      const b = c.busBox(f);
      return { y: r1(f.y), up: r1(f.vy), fwd: r1(f.ground), speed: r1(f.speed), path: r1(Math.atan2(f.vy, f.ground) * DEG), nose: r1(f.nose * DEG), pitch: r1(f.pitch * DEG), mode: f.mode, busY: +b.cy.toFixed(2), busPx: Math.round(Math.max(b.w, b.h)) };
    },
    box: () => c.busBox(f),
    project: (x: number, y: number, z: number) => c.project(x, y, z),
    cam: c,
  };
  return s;
}
const line = (k: string, v: unknown) => { res[k] = v; console.log(`[${MODE}] ${k}: ${JSON.stringify(v)}`); };
/** straight into Jet */
const jet = (s: { drive: TurboDrive; f: Flight }) => { while (s.drive.gear < JET) s.drive.shift(1, s.f); };

// ---- the plain pull doesn't change
{
  const s = session();
  s.run(6, -1);
  line('plain pull', s.now());
  s.drive.shift(1, s.f);
  s.run(4, -1);
  line('...then Express', s.now());
  s.drive.shift(-1, s.f);
  s.run(3, -1);
  line('...Express let go, still pulling', s.now());
}
// ---- Express from the street, full pull: up the nose at the surge
{
  const s = session();
  s.drive.shift(1, s.f);
  s.run(6, -1);
  line('Express full pull', s.now());
  s.run(3, 0, false);
  line('...let go', s.now());
}
// ---- Jet from the street, full pull, to the ceiling
{
  const s = session();
  jet(s);
  let at = -1, peak = 0, atTop = -1;
  const rows: unknown[] = [];
  let worstBus = 0;
  for (let k = 0; k < 70 / dt; k++) {
    s.frame(-1);
    if (s.t > 8 && s.f.vy > 100) worstBus = Math.max(worstBus, s.box().cy);
    if (at < 0 && s.f.y >= 14900) at = s.t;
    if (atTop < 0 && s.f.y >= 14999) atTop = s.t;
    peak = Math.max(peak, s.f.y);
    if (Math.abs(s.t % 5) < dt) rows.push({ t: r1(s.t), ...s.now() });
  }
  line('Jet full pull', { to14900s: r1(at), to14999s: r1(atTop), peak: r1(peak), overshoot: r1(peak - 15000), end: s.now(), worstBusY: +worstBus.toFixed(2) });
  for (const r of rows) console.log('   ', JSON.stringify(r));
}
// ---- a dive from 3 km: plain, TURBO, Express, then Jet from 12 km
const dive = (label: string, y0: number, gear: number, secs: number) => {
  const s = session(flat, y0);
  s.f.holdY = y0;
  s.f.mode = 1;
  if (gear) {
    while (s.drive.gear < gear) s.drive.shift(1, s.f);
    s.run(8, 0, false);
  }
  const rows: unknown[] = [];
  let minClear = Infinity, atBottom = -1;
  for (let k = 0; k < secs / dt; k++) {
    s.frame(1);
    const fl = s.f.floorY;
    minClear = Math.min(minClear, s.f.y - fl);
    if (atBottom < 0 && s.f.y < fl + 2) { atBottom = s.t; }
    if (k % Math.round(1 / dt) === 0 || (s.f.y - fl < 300 && k % Math.round(0.25 / dt) === 0 && s.f.vy < -1)) rows.push({ t: r1(s.t), ...s.now(), overFloor: r1(s.f.y - fl) });
  }
  line(label, { bottomAt: r1(atBottom), minOverFloor: r1(minClear), overHard: r1(s.minY - ROOF - 3.5), end: s.now(), maxFrameStep: r1(s.maxJumpP) });
  for (const r of rows) console.log('   ', JSON.stringify(r));
};
dive('dive plain from 3 km', 3000, 0, 34);
dive('dive Express from 3 km', 3000, EXPRESS, 32);
dive('dive Nonstop from 3 km', 3000, NONSTOP, 32);
dive('dive Jet from 12 km', 12000, JET, 32);
// ---- release mid-climb and mid-dive: the arc, then a still hold
const release = (label: string, sy: number, y0: number, gear: boolean) => {
  const s = session(flat, y0);
  s.f.holdY = y0;
  s.f.mode = 1;
  if (gear) s.drive.shift(1, s.f);
  s.run(3, sy);
  const a = s.now();
  if (gear) s.drive.shift(-1, s.f);
  let last = { x: s.f.x, y: s.f.y, z: s.f.z, sp: s.f.ground, vy: s.f.vy };
  let maxDV = 0, maxDG = 0, maxDP = 0;
  const rows: unknown[] = [];
  for (let k = 0; k < 6 / dt; k++) {
    s.frame(0, false);
    const dG = Math.abs(s.f.ground - last.sp), dV = Math.abs(s.f.vy - last.vy);
    maxDG = Math.max(maxDG, dG);
    maxDV = Math.max(maxDV, dV);
    maxDP = Math.max(maxDP, Math.hypot(s.f.x - last.x, s.f.y - last.y, s.f.z - last.z) / Math.max(1, Math.hypot(last.sp, last.vy) * dt));
    last = { x: s.f.x, y: s.f.y, z: s.f.z, sp: s.f.ground, vy: s.f.vy };
    if (k % Math.round(0.5 / dt) === 0) rows.push({ t: r1(k * dt), ...s.now() });
  }
  const rig: any = s.cam.rig;
  line(label, { held: a, maxGroundStepPerFrame: r1(maxDG), maxVyStepPerFrame: r1(maxDV), framePathRatioMax: +maxDP.toFixed(2), rigDive: rig.dive, view: r1((Math.asin(-s.cam.cam.getWorldDirection(new THREE.Vector3()).y) * 180) / Math.PI), end: s.now() });
  for (const r of rows) console.log('   ', JSON.stringify(r));
};
release('release mid-climb, Express', -1, 800, true);
release('release mid-dive, plain', 1, 2000, false);
// ---- under a deck: the climb stops under it
{
  const deck = 70;
  const world = { ...flat, overheadAt: (x: number, z: number, fromY: number) => (fromY < deck ? deck : Infinity) };
  const s = session(world);
  s.drive.shift(1, s.f);
  s.run(6, -1);
  line('Express full pull under a deck at 70 m', { ...s.now(), maxY: r1(s.maxY) });
  jet(s);
  s.run(6, -1);
  line('Jet full pull under the same deck', { ...s.now(), maxY: r1(s.maxY), floor: r1(s.f.floorY) });
}
// ---- partial sticks: the thumb sets how steep
{
  const out: unknown[] = [];
  for (const sy of [0.25, 0.5, 0.75, 1]) {
    const a = session(flat, 6000);
    a.f.holdY = 6000;
    a.f.mode = 1;
    a.run(4, sy);
    const b = session(flat, 6000);
    b.f.holdY = 6000;
    b.f.mode = 1;
    b.drive.shift(1, b.f);
    b.run(4, -sy);
    out.push({ sy, push: a.now(), pullExpress: b.now() });
  }
  for (const o of out) console.log('   ', JSON.stringify(o));
  res.partial = out;
}
// ---- the map's edge in Jet: a level run fades back to the surge, and a pull from there gets the gear back: what fades is the speed over the ground
{
  const s = session(flat, 1000, [-30000, -30000, 30000, 2000]);
  s.f.holdY = 1000;
  s.f.mode = 1;
  s.f.heading = Math.PI; // south, +z: the edge at z = 2000
  jet(s);
  const edgeRow = () => ({ t: r1(s.t), z: r1(s.f.z), edge: +s.drive.edge.toFixed(2), tb: r1(s.f.turbo.speed), ...s.now() });
  const rows: unknown[] = [];
  for (let k = 0; k < 14 / dt; k++) {
    s.frame(0, false);
    if (k % Math.round(2 / dt) === 0) rows.push(edgeRow());
  }
  for (let k = 0; k < 6 / dt; k++) {
    s.frame(-1);
    if (k % Math.round(1 / dt) === 0) rows.push(edgeRow());
  }
  res.edge = rows;
  console.log('    the edge, level then a full pull');
  for (const r of rows) console.log('     ', JSON.stringify(r));
}
save(`nose-${dt.toFixed(4)}`, res);
process.exit(0);
