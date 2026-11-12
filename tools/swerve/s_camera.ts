// The camera in the quick turn (docs/specs/flight/SWERVE.md, section 6): the real Flight, TurboDrive, CameraRig and fx/Turbo's TurboLens with ?swerve's
// handling on, on a flat world, no browser: node tools/feel-sim/run.mjs ../swerve/s_camera.ts
// Each frame goes as main.ts's does: the gears, the flight's steps at 120 Hz, the lens's lead, the rig. The frame is the game's 240 x 520, the lens the
// rig's own (the street's, or the vista's it opens to on the way up to 300 m, plus the turbo's widening).
//   nose      a skid's half turn (the leash till the nose is round, then let go), its grip and 2 s on, in every gear, at 20, 30 and 60 fps, at the street's
//             height and at 300 m: the bus within 0.3 of the frame's width of its middle; where a tap goes (400 m past a second's flight down the nose) within
//             30 degrees of the view's middle at the worst and inside the frame's half width from 0.2 s after the nose is round; the view's yaw rate never over
//             1.1 x the nose's fastest; and through the slide after its first 0.3 s no lurch: the view's yaw acceleration (a 3-frame mean) under 4 rad/s^2,
//             its yaw rate changing sign at most once. The grip's and the 2 s after's accelerations are printed, not marked
//   hard      a hard half turn (124 px) at Jet and Turbo 3, 20, 30 and 60 fps, at 300 m: the aim inside the half width from 0.5 s in; the bus within 0.3
//   stage 1   the hard half turn at Turbo 3, 20 fps, with skidCam 1: the bus within 0.3, nothing over 1e3 (stage 1's spring, one step a frame, blew up)
//   off       a smooth weave with the handling on and off, Cruise and Jet, 30 and 60 fps: the rig's yaw, position and look the same to the bit
// Prints each, and exits 1 if a row fails.
import { config } from '../feel-sim/lib';
import * as THREE from 'three';
import { Flight } from '@src/game/Flight';
import { TurboDrive } from '@src/game/Turbo';
import { CameraRig } from '@src/game/CameraRig';
import { TurboLens } from '@src/fx/Turbo';
import { stickParts } from '@src/game/Input';
import { swerveTune as T } from '@src/game/Swerve';

const flat = { obstacleAt: () => 20, groundAt: () => 10 };
const DEG = Math.PI / 180;
const r2 = (v: number) => +v.toFixed(2), r1 = (v: number) => +v.toFixed(1);
// (Input.applyStretch and softSat, with inputTune's knee and leash, as tools/swerve/s_turns.ts has them)
const KNEE = 0.72, LEASH = 2.2;
function stickOf(dx: number, dy: number): { sx: number; sy: number } {
  const F = config.flight, px = F.stretchPx;
  let d = Math.hypot(dx, dy);
  const max = LEASH * px;
  if (d > max) {
    dx *= max / d;
    dy *= max / d;
    d = max;
  }
  if (d <= F.deadZonePx) return { sx: 0, sy: 0 };
  const s0 = (d - F.deadZonePx) / px, r = 1 - KNEE, s = s0 <= KNEE ? s0 : KNEE + r * Math.tanh((s0 - KNEE) / r);
  return { sx: (dx / d) * s, sy: (-dy / d) * s };
}
const GEARS: Array<[string, number]> = [['Cruise', 0], ['Express', 1], ['Nonstop', 2], ['Jet', 3], ['Turbo 1', 4], ['Turbo 2', 5], ['Turbo 3', 6]];

/** A bus in a gear with the camera behind it, settled at its speed and height (and pulled up to `up` m if it's under), the handling on or off. */
function rigged(rungs: number, on: boolean, dt: number, up: number) {
  const f = new Flight();
  f.y = 26.5;
  f.glideSpeed = 0;
  f.swerve.on = on;
  const drive = new TurboDrive([-1e9, -1e9, 1e9, 1e9]);
  drive.edgeless = true;
  const cam = new THREE.PerspectiveCamera(50, 240 / 520, 1, 30000), rig = new CameraRig(), lens = new TurboLens(), focus = new THREE.Vector3();
  const parts = { hard: 0, skid: -Infinity, hardTop: 1 }, v = new THREE.Vector3(), d = new THREE.Vector3();
  const b = {
    f, drive, rig, cam, t: 0,
    frame(h: number, thumb: [number, number] | null) {
      const st = thumb ? stickOf(thumb[0], thumb[1]) : { sx: 0, sy: 0 };
      drive.update(h, f);
      if (thumb) stickParts(Math.abs(thumb[0]), Infinity, parts);
      const n = Math.max(1, Math.ceil(h / (1 / 120)));
      for (let i = 0; i < n; i++)
        f.step(h / n, { sx: st.sx, sy: st.sy, dragging: !!thumb, hard: thumb ? parts.hard : 0, skid: thumb ? parts.skid : -Infinity, side: thumb ? Math.sign(thumb[0]) : 0, hardTop: parts.hardTop, frame: h }, flat);
      lens.update(h, drive, rig, f);
      rig.update(cam, focus, f, h);
      const hf = (rig.hfov * Math.PI) / 180;
      cam.fov = (2 * Math.atan(Math.tan(hf / 2) / (240 / 520)) * 180) / Math.PI;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      b.t += h;
    },
    /** the bus across the frame (0..1) */
    busX() {
      v.set(f.x, f.y, f.z).project(cam);
      return v.x * 0.5 + 0.5;
    },
    /** the view's flat yaw (rad) */
    viewYaw() {
      cam.getWorldDirection(d);
      return Math.atan2(d.x, -d.z);
    },
    /** a flat point's angle off the view's middle (deg), and the view's half width (deg) */
    angle(x: number, z: number) {
      cam.getWorldDirection(d);
      d.y = 0;
      d.normalize();
      const px = x - cam.position.x, pz = z - cam.position.z;
      return { off: Math.abs(Math.atan2(d.x * pz - d.z * px, d.x * px + d.z * pz)) / DEG, half: rig.hfov / 2 };
    },
  };
  for (let i = 0; i < rungs; i++) drive.rung(1, f);
  for (let k = 0; k < 90 / dt; k++) {
    b.frame(dt, null);
    if (k * dt > 4 && (rungs === 0 || drive.engaged) && Math.abs(f.speed - (f.turbo.speed || f.speed)) < 0.5 && Math.abs(f.vy) < 0.2) break;
  }
  // (up to `up` on the yoke, as a thumb pulls it there; then let the lens and the speed settle)
  for (let k = 0; k < 60 / dt && f.y < up; k++) b.frame(dt, [0, 150]);
  for (let k = 0; k < 4 / dt; k++) b.frame(dt, null);
  b.t = 0;
  return b;
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** the rig's own yaw (rad, its private spring's state) */
const yawOf = (rig: CameraRig) => (rig as unknown as { yaw: number }).yaw;

let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(32)} ${typeof o === 'string' ? o : JSON.stringify(o)}`);
};

/** A half turn to the right, skid or hard, with the camera: what C4's marks read. */
function turnWithCam(rungs: number, kind: 'skid' | 'hard', dt: number, up: number) {
  const b = rigged(rungs, true, dt, up), f = b.f, sw = f.swerve, h0 = f.heading;
  let letGo = false, done = NaN, noseRound = NaN, skidAt = NaN, gripAt = NaN;
  let busOff = 0, aimWorst = 0, aimLate = 0, half = 0, viewRateMost = 0, noseRateMost = 0, accSlide = 0, accGrip = 0, signs = 0, sinceTurn = 0, worstAny = 0;
  let lastYaw = b.viewYaw(), lastNose = f.heading + sw.slip, lastRate = NaN, lastSign = 0;
  const rates: number[] = [];
  sw.onEvent = (ev) => {
    if (ev === 'skid') skidAt = b.t;
    if (ev === 'grip') gripAt = b.t;
  };
  while (b.t < 20) {
    const nose = f.heading + sw.slip - h0;
    if (kind === 'skid' && !letGo && nose >= Math.PI) letGo = true;
    if (Number.isNaN(noseRound) && nose >= Math.PI) noseRound = b.t;
    b.frame(dt, !Number.isNaN(done) || letGo ? null : [kind === 'hard' ? 124 : 172, 0]);
    if (Number.isNaN(done) && f.heading - h0 >= Math.PI - (kind === 'skid' ? 2 * DEG : 0) && !sw.skidding) done = b.t;
    const yaw = b.viewYaw(), rate = wrap(yaw - lastYaw) / dt, nr = wrap(f.heading + sw.slip - lastNose) / dt;
    lastYaw = yaw;
    lastNose = f.heading + sw.slip;
    viewRateMost = Math.max(viewRateMost, Math.abs(rate));
    noseRateMost = Math.max(noseRateMost, Math.abs(nr));
    rates.push(rate);
    // (the yaw's acceleration, a 3-frame mean)
    const n = rates.length;
    const acc = n >= 4 ? Math.abs(rates[n - 1] - rates[n - 4]) / (3 * dt) : 0;
    const sliding = sw.sliding, slideT = Number.isNaN(skidAt) ? -1 : b.t - skidAt;
    if (kind === 'skid' && sliding && slideT > 0.3 + 3 * dt) {
      accSlide = Math.max(accSlide, acc);
      const s = Math.abs(rate) < 1e-3 ? 0 : Math.sign(rate);
      if (s !== 0 && lastSign !== 0 && s !== lastSign) signs++;
      if (s !== 0) lastSign = s;
    } else if (kind === 'skid' && !Number.isNaN(gripAt)) accGrip = Math.max(accGrip, acc);
    void lastRate;
    lastRate = rate;
    busOff = Math.max(busOff, Math.abs(b.busX() - 0.5));
    const nh = f.heading + sw.slip, dn = 400 + f.ground;
    const a = b.angle(f.x + Math.sin(nh) * dn, f.z - Math.cos(nh) * dn);
    half = a.half;
    aimWorst = Math.max(aimWorst, a.off);
    if (kind === 'skid' ? !Number.isNaN(noseRound) && b.t >= noseRound + 0.2 : b.t >= 0.5) aimLate = Math.max(aimLate, a.off);
    worstAny = Math.max(worstAny, Math.abs(b.busX() - 0.5), Math.abs(yawOf(b.rig)));
    if (!Number.isNaN(done)) sinceTurn += dt;
    if (!Number.isNaN(done) && sinceTurn >= 2) break;
  }
  return { t: done, y: f.y, busOff, aimWorst, aimLate, half, viewRateMost, noseRateMost, accSlide, accGrip, signs, worstAny };
}

// ---------------------------------------------------------------- the nose
for (const [name, rungs] of GEARS) {
  const out: Record<string, string> = {};
  let ok = true;
  for (const up of [0, 300])
    for (const fps of [60, 30, 20]) {
      const o = turnWithCam(rungs, 'skid', 1 / fps, up);
      const good = o.busOff <= 0.3 && o.aimWorst <= 30 && o.aimLate <= o.half && o.viewRateMost <= 1.1 * o.noseRateMost && o.accSlide < 4 && o.signs <= 1 && !Number.isNaN(o.t);
      if (!good) ok = false;
      out[`${up ? `${Math.round(o.y)} m` : 'street'} ${fps} fps`] =
        `bus ${r2(o.busOff)}, aim ${r1(o.aimWorst)}/${r1(o.aimLate)} of ${r1(o.half)} deg, view ${r1(o.viewRateMost / DEG)} of nose ${r1(o.noseRateMost / DEG)} deg/s, ` +
        `yaw acc ${r1(o.accSlide)} rad/s2 sliding (grip and after ${r1(o.accGrip)}), ${o.signs} sign changes${good ? '' : ' (!)'}`;
    }
  row(ok, `camera, the nose, ${name}`, out);
}

// ---------------------------------------------------------------- the hard turn
for (const [name, rungs] of [GEARS[3], GEARS[6]]) {
  const out: Record<string, string> = {};
  let ok = true;
  for (const fps of [60, 30, 20]) {
    const o = turnWithCam(rungs, 'hard', 1 / fps, 300);
    const good = o.busOff <= 0.3 && o.aimLate <= o.half && !Number.isNaN(o.t);
    if (!good) ok = false;
    out[`${Math.round(o.y)} m ${fps} fps`] = `bus ${r2(o.busOff)}, aim from 0.5 s ${r1(o.aimLate)} of ${r1(o.half)} deg, round at ${r2(o.t)} s${good ? '' : ' (!)'}`;
  }
  row(ok, `camera, the hard turn, ${name}`, out);
}

// ---------------------------------------------------------------- stage 1 at 20 fps
{
  const k = T.skidCam;
  T.skidCam = 1;
  const o = turnWithCam(6, 'hard', 1 / 20, 300);
  T.skidCam = k;
  row(o.busOff <= 0.3 && o.worstAny < 1e3, 'camera, stage 1 at 20 fps', { busOff: r2(o.busOff), worst: r2(o.worstAny), roundAt: r2(o.t) });
}

// ---------------------------------------------------------------- off is off
{
  const out: Record<string, number> = {};
  let ok = true;
  const thumbAt = (t: number): [number, number] | null => (t < 3 ? [T.hardFrom * Math.sin(t * 2.1), 8 * Math.sin(t * 3.3)] : t < 5 ? [-T.hardFrom, 0] : t < 5.5 ? null : [T.hardFrom * 0.6, -6]);
  for (const [name, rungs] of [GEARS[0], GEARS[3]])
    for (const fps of [60, 30]) {
      const a = rigged(rungs, false, 1 / fps, 0), b = rigged(rungs, true, 1 / fps, 0);
      let worst = 0;
      for (let k = 0; k < 8 * fps; k++) {
        a.frame(1 / fps, thumbAt(a.t));
        b.frame(1 / fps, thumbAt(b.t));
        const p = a.cam.position, q = b.cam.position, u = a.cam.quaternion, w = b.cam.quaternion;
        worst = Math.max(worst, Math.abs(yawOf(a.rig) - yawOf(b.rig)), Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z), Math.abs(u.x - w.x), Math.abs(u.y - w.y), Math.abs(u.z - w.z), Math.abs(u.w - w.w), Math.abs(a.cam.fov - b.cam.fov));
      }
      if (worst !== 0) ok = false;
      out[`${name} ${fps} fps`] = worst;
    }
  row(ok, 'camera, off is off', { apartAtMost: out });
}

console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
