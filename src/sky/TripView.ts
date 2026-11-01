import * as THREE from 'three';
import { EARTH, MOON, type BodyId } from './SkyModel';
import { R_E, R_M, type MoonTrip } from './MoonTrip';

// Who looks where on the flight (MOONSHOT.md section 3, trip/sheet.py's frames). On this branch the camera swings on its own; the producer rules on that after feeling it.
//
// The rig never moves: the bus at the render origin, the camera behind and above it, no rotation. Everything the camera does is `ob.axes`: the render frame's axes in EQJ, so the swing is the world turning
// round the bus, in doubles, and the bus's own pose is just its nose read in those axes.
//
// One law, no leg in it. The camera looks at whichever body is bigger, from the view the ground game has: a level heading over that body, pitched down until the horizon is pinned near the top of the frame,
// then past straight down by a little, which sets the disc above the bus (the sheet's 42 % of the frame). So climbing away the view tips over by itself, and that is the look-back; arriving, it runs backward.
// Far off, the heading turns to north, so a body reads upright. The one jump in the law is the moment the bigger body changes, near Earth = Moon: the jump goes into an offset that decays on a critically
// damped spring, which is the swing round. The lens is a function of the same body's size.
//
// The thumb swings the camera on every leg it doesn't steer, on top of the law. Left alone for THUMB_HOLD seconds the view goes home on the same spring.

const DEG = Math.PI / 180;
/** Game px per unit tan on the 24 degree lens: the size the lens law is read in, whatever the lens is doing. */
const F24 = 393 / 2 / Math.tan(12 * DEG);
/** The spring's rate, 1/s: a swing of 180 degrees peaks near 53 deg/s and is over in about 6 s. */
const SWING = 0.8;
/** deg/s at full stretch */
const THUMB_RATE = 70 * DEG;
const THUMB_HOLD = 6;
/** The nose's fastest swing, rad/s: the tip-up reads as a move, and the first frame of it isn't a kick. */
const NOSE_RATE = 75 * DEG;
/** The disc's centre over the frame's, game px: the sheet's cy = 0.42 of 852. */
const DISC_LIFT = 68;
/** Degrees from the view's axis up to the horizon: Earth holds it 3 degrees under the frame's top, as the ground game does. The Moon leaves a band of black sky over the rim for Earth to rise into. */
const HORIZON_EARTH = 33.87;
const HORIZON_MOON = 20.5;

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class TripView {
  /** the lens this frame */
  hfov = 38;
  /** the bus's pose in the render frame */
  readonly busQuat = new THREE.Quaternion();
  /** the way it flies and the way its nose points, render frame */
  readonly flying = new THREE.Vector3(0, 0, -1);
  readonly nosing = new THREE.Vector3(0, 0, -1);
  /** the body the law is looking at */
  target: BodyId = EARTH;

  /** the view in EQJ: the law's, the spring's offset, the thumb's, and all of them */
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
  /** heading to north, unwrapped, and how far the view has gone over to it */
  private h = 0;
  private k = 0;
  /** the view's lag behind a hard turn */
  private lag = 0;
  private bank = 0;
  private started = false;

  private readonly u = new THREE.Vector3();
  private readonly level = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
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

  /** One frame, after trip.step(). stick: the thumb, -1..1; thumb: it is down. lens: a fixed lens, 0 for the law's. */
  update(dt: number, trip: MoonTrip, stickX: number, stickY: number, thumb: boolean, lens: number): void {
    const r = trip.r, rm = trip.rm;
    const dE = Math.hypot(r[0], r[1], r[2]), dM = Math.hypot(rm[0], rm[1], rm[2]);
    const aE = Math.asin(Math.min(1, R_E / dE)), aM = Math.asin(Math.min(1, R_M / dM));
    const was = this.target;
    if (was === EARTH ? aM > aE * 1.02 : aE > aM * 1.02) this.target = was === EARTH ? MOON : EARTH;
    const moon = this.target === MOON;
    const p = moon ? rm : r, d = moon ? dM : dE, R = moon ? R_M : R_E, a = moon ? aM : aE;

    // the lens: 24 degrees once the body is small, 38 once it would overfill that (trip/sheet.py's picks); a function of the body's size, so it can't step
    const px24 = 2 * F24 * Math.tan(a);
    this.hfov = lens || 24 + 14 * smooth01(250, 500, px24);

    // ---- the law
    const u = this.u.set(p[0] / d, p[1] / d, p[2] / d);
    const lv = this.level.set(trip.heading[0], trip.heading[1], trip.heading[2]);
    lv.addScaledVector(u, -lv.dot(u)).normalize();
    const n = this.n.set(0, 0, 1);
    n.addScaledVector(u, -n.dot(u)).normalize();
    const side = this.t.crossVectors(u, lv);
    const toNorth = Math.atan2(n.dot(side), n.dot(lv));
    // (a steered leg faces the way the bus does; the wide-out ones turn to north with height. Unwrapped only while the turn is under way: left to run it collects whole turns, and those would play out on arrival)
    const far = trip.steering ? 0 : smooth01(0.16 * R, 0.95 * R, d - R);
    this.k += (far - this.k) * (1 - Math.exp(-2 * dt));
    this.h = this.started && this.k > 0.001 && this.k < 0.999 ? this.h + wrap(toNorth - this.h) : toNorth;
    if (trip.steering) this.lag += (stickX * trip.yawRate - this.lag) * (1 - Math.exp(-3 * dt));
    else this.lag *= Math.exp(-3 * dt);
    const turn = this.h * this.k + this.lag / 3;
    const ct = Math.cos(turn), st = Math.sin(turn);
    lv.multiplyScalar(ct).addScaledVector(side, st);
    const focal = 393 / 2 / Math.tan((this.hfov * DEG) / 2);
    const pinned = Math.acos(Math.min(1, R / d)) / DEG + (moon ? HORIZON_MOON : HORIZON_EARTH);
    const pitch = Math.min(pinned, 90 + Math.atan(DISC_LIFT / focal) / DEG) * DEG;
    const fwd = this.fwd.copy(lv).multiplyScalar(Math.cos(pitch)).addScaledVector(u, -Math.sin(pitch));
    const right = this.right.crossVectors(lv, u).normalize();
    const up = this.up.crossVectors(right, fwd);
    this.back.copy(fwd).negate();
    this.want.setFromRotationMatrix(this.m.makeBasis(right, up, this.back));

    if (!this.started) {
      this.started = true;
      this.q.copy(this.want);
      this.nose.set(trip.dir[0], trip.dir[1], trip.dir[2]);
      this.busUp.copy(u);
    }

    // ---- the swing: the law jumped, so the view stays where it was and that gap decays. Anything the thumb had goes with it.
    if (this.target !== was) this.takeBack();

    // ---- the thumb
    if (!trip.steering && thumb) {
      this.yaw -= stickX * THUMB_RATE * dt;
      this.tilt = Math.max(-1.4, Math.min(1.4, this.tilt + stickY * THUMB_RATE * dt));
      this.idle = 0;
    } else this.idle += dt;
    if ((this.yaw !== 0 || this.tilt !== 0) && (trip.steering || this.idle > THUMB_HOLD)) this.takeBack();
    this.thumbQ.setFromEuler(this.euler.set(this.tilt, this.yaw, 0, 'YXZ'));

    this.oV.addScaledVector(this.o, -SWING * SWING * dt).multiplyScalar(Math.max(0, 1 - 2 * SWING * dt));
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

    // ---- the bus: its nose follows the path, and a level heading at rest; its roof the radial near a body and the camera's up far off
    const nw = this.t.set(trip.dir[0], trip.dir[1], trip.dir[2]);
    if (trip.v < 20) nw.set(trip.heading[0], trip.heading[1], trip.heading[2]);
    const nose = this.nose;
    if (nose.dot(nw) < -0.98) nose.addScaledVector(this.busUp, 0.2);
    const off = Math.acos(Math.max(-1, Math.min(1, nose.dot(nw))));
    nose.lerp(nw, Math.min(1 - Math.exp(-6 * dt), (NOSE_RATE * dt) / Math.max(off, 1e-6))).normalize();
    const camUp = this.t2.set(e[4], e[5], e[6]);
    const roof = this.busUp;
    roof.lerp(camUp.multiplyScalar(this.k).addScaledVector(u, 1 - this.k), 1 - Math.exp(-3 * dt));
    roof.addScaledVector(nose, -roof.dot(nose)).normalize();
    this.bank += ((trip.steering ? stickX : 0) * 0.45 - this.bank) * (1 - Math.exp(-6 * dt));
    if (this.bank !== 0) {
      const sb = Math.sin(this.bank), cb = Math.cos(this.bank), rt = this.t.crossVectors(nose, roof);
      this.busUpTurned(rt, cb, sb);
    } else this.t2.copy(roof);
    this.inRender(nose, ax, this.nosing);
    this.inRender(this.t2, ax, this.y);
    this.inRender(this.t.set(trip.dir[0], trip.dir[1], trip.dir[2]), ax, this.flying);
    const z = this.z.copy(this.nosing).negate();
    const x = this.x.crossVectors(this.y, z).normalize();
    this.y.crossVectors(z, x);
    this.busQuat.setFromRotationMatrix(this.m.makeBasis(x, this.y, z));
  }

  private busUpTurned(rt: THREE.Vector3, cb: number, sb: number): void {
    this.t2.copy(this.busUp).multiplyScalar(cb).addScaledVector(rt, sb);
  }

  private inRender(v: THREE.Vector3, a: Float64Array, o: THREE.Vector3): void {
    const { x, y, z } = v;
    o.set(a[0] * x + a[1] * y + a[2] * z, a[3] * x + a[4] * y + a[5] * z, a[6] * x + a[7] * y + a[8] * z);
  }

  /** The view stays exactly where it is and the spring takes it from there: to the law's view, thumb gone. */
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
