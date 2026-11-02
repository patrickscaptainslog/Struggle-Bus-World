import * as THREE from 'three';
import { config } from '../config';
import { MOON_VISTA, viewPitch } from '../game/Ascent';
import { EARTH } from './SkyModel';
import { R_E, R_M, type MoonTrip } from './MoonTrip';

// The camera on the flight is the game's: game/CameraRig.ts at full vista, as it stands over the city. The same lens, the same distance, the same angle over the bus, and nothing of its own. It goes where the bus goes and the thumb swings it. Nothing
// here decides where to look: there's no look-back, no turn to a body, no view tipping over. No camera move that the bus or the thumb didn't ask for.
//
// The rig never moves: the bus at the render origin, the camera behind and above it, no rotation. Everything the camera does is `ob.axes`: the render frame's axes in EQJ, so a turn is the world turning round the bus, in doubles, and the bus's own pose is
// just its nose read in those axes. `below` is how far under the line of sight the bus stands, and moonrun.ts puts the camera there.
//
// The chase is a way ahead and a way up, in EQJ. Ahead follows the bus on a critically damped spring: at the rig's own 1.6 Hz where the thumb steers it, and gently everywhere else, so when the bus turns for the Moon the camera comes round with it. On the
// yoke, on the way down and up it, ahead is the level heading and not the path, as the rig's is, and a dive tips the view by the rig's own law. So the join with the low game is no join: `Landing.hand` and `Landing.back` hand over the same camera.
//
// Up is carried along by that turn, so the camera adds no roll, and out in the dark nothing touches it. Over a body it's the radial wherever the radial says anything, which is wherever the flight isn't along it. A way in needs no roll for that: MoonTrip
// takes its level from this up (`roof`), so the pull-up is the bus pulling up with the camera behind it. Home is a fixed place, so there's one roll the route can't save: up comes round to home's plane slowly, through the long dark, and the disc ahead lies on
// its axis, so only the stars go with it.
//
// The angles are the city's at 1 km, all the way: the view looks ahead and a little down, so what the path points at stands over the bus, and a frame too short for that eases the pitch by the rig's own rule. The Moon's low game sits a little lower (MOON_VISTA),
// so on the last of the way down the angles come to its own, by the height alone. The lens doesn't move, so a disc grows by its own size alone and the bus stays the size it is over the city.
//
// The thumb swings the camera on every leg it doesn't steer, on top of all this. Left alone for THUMB_HOLD seconds the view goes home on a spring of its own.

const DEG = Math.PI / 180;
/** The thumb's spring, 1/s: a swing of 180 degrees peaks near 36 deg/s and is nine tenths over in about 7 s. */
export const SWING = 0.55;
/** How fast the chase comes round after a bus nothing is steering, 1/s: nine tenths of a turn in about 2.6 s. */
const FOLLOW = 1.5;
/** How fast it changes spring, 1/s: the rig's stiff one goes at once, and comes back slowly, so a chase that's behind isn't snatched. */
const FOLLOW_OFF = 4;
const FOLLOW_ON = 1;
/** Up comes to the radial at this rate, 1/s, where the flight lies across it. */
const ROLL = 1.5;
/** ...and to home's plane at this rate, 1/s, all through the long dark. */
const ROLL_HOME = 0.25;
/** The most either may turn it, rad/s. */
const ROLL_MOST = 12 * DEG;
/** The lens's rate, 1/s, back from where the low game left it. */
const LENS_RATE = 1.2;
/** deg/s at full stretch */
const THUMB_RATE = 70 * DEG;
const THUMB_HOLD = 6;
/** The nose's fastest swing, rad/s: the tip-up reads as a move, and the first frame of it isn't a kick. */
const NOSE_RATE = 75 * DEG;
/** The share of its length the bus shows the camera in a full dive, the sine of the angle between its nose and the line of sight. The rig tips over a dive until it's looking down the bus's back, and end on a bus is its tail, a third of its size: it lifts its nose up the screen by what's short. moon/Landing.ts holds the low game to the same. */
export const SHOW = 0.7;
/** The city's angles, degrees, read as this module loads: on ?moonland moonBoot.ts gives config the Moon's a moment later. */
const CITY = { elevation: config.camera.elevationVista, pitch: config.camera.pitchVista };
/** km over the ground: the angles start for the low game's at the one, and are its own by the other, the height the two loops change hands. */
const LOW_FROM = 100;
const LOW_AT = 15;

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class TripView {
  /** the lens this frame */
  hfov = config.camera.hfovVista;
  /** Half the lens's vertical field, degrees: moonrun.ts reads it off the real lens, as the rig does. */
  halfV = 36.87;
  /** the bus's pose in the render frame */
  readonly busQuat = new THREE.Quaternion();
  /** the way it flies and the way its nose points, render frame */
  readonly flying = new THREE.Vector3(0, 0, -1);
  readonly nosing = new THREE.Vector3(0, 0, -1);
  /** the chase, EQJ: the way ahead and the way up, before pitch and thumb */
  readonly ahead = new THREE.Vector3(0, 0, -1);
  readonly top = new THREE.Vector3(0, 1, 0);
  /** how far the view has tipped over a dive, 0..1: the rig's */
  dive = 0;
  /** degrees down from the chase's way ahead, before a dive */
  pitch: number = CITY.pitch;
  /** how far under the line of sight the bus stands, radians: where the rig stands */
  below = 18 * DEG;
  /** the thumb's spring's rate, 1/s: live, the tuner moves it */
  swing = SWING;

  /** the view in EQJ: the chase's, the spring's offset, the thumb's, and all of them */
  private readonly want = new THREE.Quaternion();
  private readonly offset = new THREE.Quaternion();
  private readonly thumbQ = new THREE.Quaternion();
  private readonly q = new THREE.Quaternion();
  /** the offset as a rotation vector, and its rate */
  private readonly o = new THREE.Vector3();
  private readonly oV = new THREE.Vector3();
  private yaw = 0;
  private tilt = 0;
  private idle = 0;
  /** the chase's turn, rad/s, and the rate of its spring, 1/s */
  private readonly spin = new THREE.Vector3();
  private rate = 2 * Math.PI * config.camera.yawHz;
  private bank = 0;
  private started = false;
  private readonly handed = new THREE.Quaternion();
  private isHanded = false;

  private readonly u = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();
  private readonly nose = new THREE.Vector3();
  private readonly busUp = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly qt = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly x = new THREE.Vector3();
  private readonly y = new THREE.Vector3();
  private readonly z = new THREE.Vector3();

  /** One frame, after trip.step(). stick: the thumb, -1..1; thumb: it is down. lens: a fixed lens, 0 for the game's. */
  update(dt: number, trip: MoonTrip, stickX: number, stickY: number, thumb: boolean, lens: number): void {
    const r = trip.r, rm = trip.rm, C = config.camera, dir = trip.dir, hd = trip.heading;
    const dE = Math.hypot(r[0], r[1], r[2]), dM = Math.hypot(rm[0], rm[1], rm[2]), hE = dE - R_E, hM = dM - R_M;

    // the lens is the game's, and it doesn't move: only the low game can hand it over from anywhere else
    const hfov = lens || C.hfovVista, gap = hfov - this.hfov;
    this.hfov = Math.abs(gap) < 0.02 ? hfov : this.hfov + gap * (1 - Math.exp(-LENS_RATE * dt));

    // the radial that counts: the nearer body's, and home's once the bus is well clear of the Moon on the way there
    const homeward = trip.bound === EARTH ? smooth01(0.5 * R_M, 3 * R_M, hM) : 0;
    const u = homeward > 0 || hE < hM ? this.u.set(r[0] / dE, r[1] / dE, r[2] / dE) : this.u.set(rm[0] / dM, rm[1] / dM, rm[2] / dM);
    const ahead = this.ahead, top = this.top, nose = this.nose;
    if (!this.started) {
      this.started = true;
      ahead.set(dir[0], dir[1], dir[2]);
      top.copy(u).addScaledVector(ahead, -u.dot(ahead)).normalize();
      nose.copy(ahead);
      this.busUp.copy(top);
    }

    // ---- the bus's nose: the path, and a level heading at rest
    const nw = this.t.set(dir[0], dir[1], dir[2]);
    if (trip.v < 20 && trip.leg !== 'fall') nw.set(hd[0], hd[1], hd[2]);
    if (nose.dot(nw) < -0.98) nose.addScaledVector(this.busUp, 0.02);
    const off = Math.acos(Math.max(-1, Math.min(1, nose.dot(nw))));
    nose.lerp(nw, Math.min(1 - Math.exp(-6 * dt), (NOSE_RATE * dt) / Math.max(off, 1e-6))).normalize();

    // ---- the chase comes after it
    const steered = trip.steering, spring = steered ? 2 * Math.PI * C.yawHz : FOLLOW;
    this.rate += (spring - this.rate) * (1 - Math.exp(-(steered ? FOLLOW_ON : FOLLOW_OFF) * dt));
    this.follow(trip.leg === 'fall' ? this.t.set(hd[0], hd[1], hd[2]) : nose, dt);
    this.level(u, homeward, dt);

    // ---- the rig's angles
    const h = hM - trip.ground, low = 1 - smooth01(LOW_AT, LOW_FROM, h), city = viewPitch(0, 1, this.halfV, CITY.pitch);
    this.pitch = city + (viewPitch(Math.max(h, 0) * 1000, MOON_VISTA.fade, this.halfV, MOON_VISTA.pitch) - city) * low;
    const elevation = CITY.elevation + (MOON_VISTA.elevation - CITY.elevation) * low;
    const yoke = trip.leg === 'fall' && trip.nose < 0 ? Math.max(0, Math.min(1, (-trip.nose / DEG - C.diveFrom) / Math.max(1, config.flight.noseDown - C.diveFrom))) : 0;
    const dd = yoke - this.dive, ds = Math.max(Math.abs(dd) * (1 - Math.exp(-C.diveRate * dt)), 0.04 * dt);
    this.dive = Math.abs(dd) <= ds ? yoke : this.dive + Math.sign(dd) * ds;
    const p = (this.pitch + (C.divePitch - this.pitch) * this.dive) * DEG;
    this.below = (elevation + (C.diveElevation - elevation) * this.dive) * DEG - p;

    // ---- the view
    const cp = Math.cos(p), sp = Math.sin(p);
    const fwd = this.fwd.copy(ahead).multiplyScalar(cp).addScaledVector(top, -sp);
    const up = this.up.copy(top).multiplyScalar(cp).addScaledVector(ahead, sp);
    const right = this.right.crossVectors(fwd, up);
    this.back.copy(fwd).negate();
    this.want.setFromRotationMatrix(this.m.makeBasis(right, up, this.back));

    // (handed over by the low game the view stays where the rig had it, and the spring takes it from there: this.want is this frame's by now)
    if (this.isHanded) {
      this.isHanded = false;
      this.q.copy(this.handed);
      this.takeBack();
    }

    // ---- the thumb
    if (!trip.steering && thumb) {
      this.yaw -= stickX * THUMB_RATE * dt;
      this.tilt = Math.max(-1.4, Math.min(1.4, this.tilt + stickY * THUMB_RATE * dt));
      this.idle = 0;
    } else this.idle += dt;
    if ((this.yaw !== 0 || this.tilt !== 0) && (trip.steering || this.idle > THUMB_HOLD)) this.takeBack();
    this.thumbQ.setFromEuler(this.euler.set(this.tilt, this.yaw, 0, 'YXZ'));

    this.oV.addScaledVector(this.o, -this.swing * this.swing * dt).multiplyScalar(Math.max(0, 1 - 2 * this.swing * dt));
    this.o.addScaledVector(this.oV, dt);
    const ang = this.o.length();
    if (ang > 1e-9) this.offset.setFromAxisAngle(this.t.copy(this.o).divideScalar(ang), ang);
    else this.offset.identity();
    this.q.copy(this.want).multiply(this.offset).multiply(this.thumbQ);

    // ---- into the Observer: rows are the render axes in EQJ
    const e = this.m.makeRotationFromQuaternion(this.q).elements, ax = trip.ob.axes;
    ax[0] = e[0];
    ax[1] = e[1];
    ax[2] = e[2];
    ax[3] = e[4];
    ax[4] = e[5];
    ax[5] = e[6];
    ax[6] = e[8];
    ax[7] = e[9];
    ax[8] = e[10];

    // ---- the bus: its nose, and its roof the chase's way up
    const roof = this.busUp, flat = this.t.copy(top).addScaledVector(nose, -top.dot(nose));
    if (flat.lengthSq() > 1e-6) roof.copy(flat).normalize();
    this.bank += ((trip.steering ? stickX : 0) * 0.45 - this.bank) * (1 - Math.exp(-6 * dt));
    // (a carve leans the roof into the turn)
    this.t2.copy(roof).multiplyScalar(Math.cos(this.bank)).addScaledVector(this.t.crossVectors(nose, roof), Math.sin(this.bank));
    this.inRender(nose, ax, this.nosing);
    this.inRender(this.t2, ax, this.y);
    this.inRender(this.t.set(dir[0], dir[1], dir[2]), ax, this.flying);
    const sb = Math.sin(this.below), cb = Math.cos(this.below), along = -(this.nosing.y * sb + this.nosing.z * cb), short = SHOW * this.dive - Math.sqrt(Math.max(0, 1 - along * along));
    if (short > 0) this.nosing.addScaledVector(this.t.set(0, cb, -sb), along > 0 ? short : -short).normalize();
    const z = this.z.copy(this.nosing).negate();
    const x = this.x.crossVectors(this.y, z).normalize();
    this.y.crossVectors(z, x);
    this.busQuat.setFromRotationMatrix(this.m.makeBasis(x, this.y, z));

    // (the way in reads this: it levels out the way the view's top already points)
    trip.roof[0] = top.x;
    trip.roof[1] = top.y;
    trip.roof[2] = top.z;
  }

  /** One step of a critically damped spring from the way ahead to `to`, exact at any dt. It turns the short way round, so what's carried along has no roll in it. */
  private follow(to: THREE.Vector3, dt: number): void {
    const a = this.ahead, top = this.top, v = this.spin, w = this.rate;
    // (x: the turn from where it should be to where it is)
    const x = this.x.crossVectors(to, a), s = x.length();
    if (s > 1e-9) x.multiplyScalar(Math.atan2(s, to.dot(a)) / s);
    else x.set(0, 0, 0);
    const e = Math.exp(-w * dt), k = this.y.copy(v).addScaledVector(x, w);
    const step = this.z.copy(x).addScaledVector(k, dt).multiplyScalar(e).sub(x);
    v.addScaledVector(k, -w * dt).multiplyScalar(e);
    const ang = step.length();
    if (ang > 1e-12) {
      this.qt.setFromAxisAngle(step.divideScalar(ang), ang);
      a.applyQuaternion(this.qt).normalize();
      top.applyQuaternion(this.qt);
    }
    top.addScaledVector(a, -top.dot(a)).normalize();
    v.addScaledVector(a, -v.dot(a));
  }

  /** Up comes round the way ahead to the radial, as far as the radial lies across the flight. homeward: 0..1, how far the bus is into the way home, where it goes on coming round when the radial is nearly along the flight. */
  private level(u: THREE.Vector3, homeward: number, dt: number): void {
    const a = this.ahead, top = this.top, p = this.t.copy(u).addScaledVector(a, -u.dot(a)), s = p.length();
    if (s < 1e-4) return;
    p.divideScalar(s);
    const off = Math.atan2(a.dot(this.x.crossVectors(top, p)), top.dot(p));
    const most = ROLL_MOST * dt, by = off * (1 - Math.exp(-Math.max(ROLL * smooth01(0.35, 0.9, s), ROLL_HOME * homeward) * dt));
    top.applyAxisAngle(a, Math.max(-most, Math.min(most, by))).normalize();
  }

  private inRender(v: THREE.Vector3, a: Float64Array, o: THREE.Vector3): void {
    const { x, y, z } = v;
    o.set(a[0] * x + a[1] * y + a[2] * z, a[3] * x + a[4] * y + a[5] * z, a[6] * x + a[7] * y + a[8] * z);
  }

  /** The low game hands the bus back (?moonland): the view stands where the rig had it, in EQJ, the chase is the rig's, and what's left between them goes on the spring. nose: the way the bus goes; heading: level, the way it faces; up: out from the Moon, all EQJ; hfov and dive: the rig's. */
  takeOver(q: THREE.Quaternion, nose: Float64Array, heading: Float64Array, up: Float64Array, hfov: number, dive: number): void {
    this.handed.copy(q);
    this.isHanded = true;
    this.nose.set(nose[0], nose[1], nose[2]);
    this.ahead.set(heading[0], heading[1], heading[2]);
    this.top.set(up[0], up[1], up[2]);
    this.top.addScaledVector(this.ahead, -this.top.dot(this.ahead)).normalize();
    this.busUp.copy(this.top);
    this.spin.set(0, 0, 0);
    this.rate = 2 * Math.PI * config.camera.yawHz;
    this.dive = dive;
    this.hfov = hfov;
  }

  /** The view stays exactly where it is and the spring takes it from there, thumb gone. */
  private takeBack(): void {
    this.offset.copy(this.qt.copy(this.want).invert()).multiply(this.q);
    const w = this.offset.w < 0 ? -1 : 1;
    const c = Math.min(1, Math.abs(this.offset.w));
    const ang = 2 * Math.acos(c), s = Math.sqrt(1 - c * c);
    if (s < 1e-9) this.o.set(0, 0, 0);
    else this.o.set(this.offset.x, this.offset.y, this.offset.z).multiplyScalar((w * ang) / s);
    this.oV.set(0, 0, 0);
    this.yaw = this.tilt = 0;
  }
}
