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
// The left of the screen pans the camera on top of all this, on every leg. It turns as far as the finger goes, the screen's width half way round, and stays where it's left (the producer: "just forget auto re-alignment. where the
// user pans - it goes"). The right flies: where it doesn't steer the path, the bus carves about it as the street's turns, and comes back to it when let go, while the path goes on as it was. A flick is a stroke too and only its lift says
// so, so what a flick panned or carved goes back, quickly and not at a jump. Over all of it goes the look, the rig's own (game/CameraRig.ts setLook), which only the low game's handover leaves on: the whole view turns about the bus.

const DEG = Math.PI / 180;
const RIGHT = new THREE.Vector3(1, 0, 0);
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
/** How fast what a flick panned goes back, 1/s. */
const FLICK_BACK = 14;
/**
 * The carve, where the thumb doesn't steer: the bus turns off the path as the street's turns, at this rate at full stretch (rad/s), as far as this either way, and back to the path when let go at this rate (1/s).
 * The path doesn't move: the producer, "even though the path is set and straight, I want to have the players be able to carve and turn and… move through the sky".
 */
const CARVE_RATE = 55 * DEG;
const CARVE_YAW = 40 * DEG;
const CARVE_PITCH = 25 * DEG;
const CARVE_BACK = 0.7;
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
  /** the look as the rig has it, rad, +right and +up: 0, 0 at home */
  lookYaw = 0;
  lookPitch = 0;

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
  /** the pan as it stood when this stroke began to pan, and a flick that's just lifted: what it panned goes back */
  private stroke = false;
  private yaw0 = 0;
  private tilt0 = 0;
  private flickedNow = false;
  private goingBack = false;
  /** The steering thumb's stick, -1..1, where it steers (moonrun.ts): the bus leans into the turn. */
  steerX = 0;
  /** The right thumb's stick, -1..1, +y up, on the legs it doesn't steer (moonrun.ts): the bus carves about the path. */
  carveX = 0;
  carveY = 0;
  /** the carve off the path, rad: yaw (+ left) and pitch (+ up), and as it stood when this stroke began, for a flick */
  private cy = 0;
  private cp = 0;
  private cy0 = 0;
  private cp0 = 0;
  private carveStroke = false;
  private carveBack = false;
  private readonly carved = new THREE.Vector3();
  private readonly viewQ = new THREE.Quaternion();
  private readonly lookQ = new THREE.Quaternion();
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

  /** One frame, after trip.step(). panYaw, panTilt: what the thumb turned the view this frame, rad (moonrun.ts); thumb: one is panning. lens: a fixed lens, 0 for the game's. */
  update(dt: number, trip: MoonTrip, panYaw: number, panTilt: number, thumb: boolean, lens: number): void {
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
      // (a trip that starts climbing, off the street, starts on its heading and looking down)
      const v = trip.leg === 'rise' ? hd : dir;
      ahead.set(v[0], v[1], v[2]);
      top.copy(u).addScaledVector(ahead, -u.dot(ahead)).normalize();
      nose.copy(ahead);
      this.busUp.copy(top);
      if (trip.leg === 'rise') this.dive = 1;
    }

    // ---- the bus's nose: the path, and a level heading at rest. And straight up to a button or straight back down from it, the heading too, and the view looks down at the world going away or coming
    // back, as it does held there: it never looks up the climb into the stars. Off the street, that's San Francisco under the bus. (The bus itself points up the climb: that's the path's, below)
    const upDown = trip.leg === 'rise' || trip.leg === 'sink' || trip.leg === 'moonRise' || trip.leg === 'moonSink';
    const nw = this.t.set(dir[0], dir[1], dir[2]);
    if ((trip.v < 20 && trip.leg !== 'fall') || upDown) nw.set(hd[0], hd[1], hd[2]);
    if (nose.dot(nw) < -0.98) nose.addScaledVector(this.busUp, 0.02);
    const off = Math.acos(Math.max(-1, Math.min(1, nose.dot(nw))));
    nose.lerp(nw, Math.min(1 - Math.exp(-6 * dt), (NOSE_RATE * dt) / Math.max(off, 1e-6))).normalize();

    // ---- the carve about the path, where the thumb doesn't steer: it turns as the street's does, up to a limit, and comes back on the lift. The path is what it was
    const cx = trip.steering ? 0 : this.carveX, cyStick = trip.steering ? 0 : this.carveY;
    if (cx !== 0 || cyStick !== 0) {
      if (!this.carveStroke) {
        this.carveStroke = true;
        this.cy0 = this.cy;
        this.cp0 = this.cp;
      }
    } else this.carveStroke = false;
    // (a flick's stroke carved too, before its lift said it was a flick: that goes back quickly, to where the stroke found it)
    if (cx !== 0 || cyStick !== 0) this.carveBack = false;
    const back = this.carveBack, k = 1 - Math.exp(-FLICK_BACK * dt);
    const drive = (off: number, stick: number, most: number, was: number) => {
      if (back) return off + (was - off) * k;
      if (stick === 0) return off * Math.exp(-CARVE_BACK * (trip.steering ? 3 : 1) * dt);
      const out = Math.sign(stick) === Math.sign(off) ? Math.max(0, 1 - Math.abs(off) / most) : 1;
      return off + stick * CARVE_RATE * out * dt;
    };
    this.cy = drive(this.cy, -cx, CARVE_YAW, this.cy0);
    this.cp = drive(this.cp, -cyStick, CARVE_PITCH, this.cp0);
    if (back && Math.abs(this.cy - this.cy0) + Math.abs(this.cp - this.cp0) < 1e-4) this.carveBack = false;
    // (about the bus's own roof, square to its nose, and not the view's top: on a climb straight up the nose and the top are one line, and a turn about it is any turn)
    const carved = this.carved.copy(nose), roof0 = this.busUp;
    if (this.cy !== 0 || this.cp !== 0) {
      carved.applyAxisAngle(roof0, this.cy);
      const side = this.t2.crossVectors(carved, roof0);
      if (side.lengthSq() > 1e-6) carved.applyAxisAngle(side.normalize(), this.cp);
    }
    const carving = Math.abs(this.cy) + Math.abs(this.cp) > 1e-3;

    // ---- the chase comes after it
    const steered = trip.steering || carving, spring = steered ? 2 * Math.PI * C.yawHz : FOLLOW;
    this.rate += (spring - this.rate) * (1 - Math.exp(-(steered ? FOLLOW_ON : FOLLOW_OFF) * dt));
    this.follow(trip.leg === 'fall' ? this.t.set(hd[0], hd[1], hd[2]) : carved, dt);
    this.level(u, homeward, dt);

    // ---- the rig's angles
    const h = hM - trip.ground, low = 1 - smooth01(LOW_AT, LOW_FROM, h), city = viewPitch(0, 1, this.halfV, CITY.pitch);
    this.pitch = city + (viewPitch(Math.max(h, 0) * 1000, MOON_VISTA.fade, this.halfV, MOON_VISTA.pitch) - city) * low;
    const elevation = CITY.elevation + (MOON_VISTA.elevation - CITY.elevation) * low;
    // (and held high over a body for the easter egg, the view tips down over the bus as a full dive's does, so the whole of the world under it is in the frame with the button)
    const yoke = trip.leg === 'fall' && trip.nose < 0 ? Math.max(0, Math.min(1, (-trip.nose / DEG - C.diveFrom) / Math.max(1, config.flight.noseDown - C.diveFrom))) : trip.egg || upDown ? 1 : 0;
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
      // (the rig's lens has the look on it, and here the look goes on over q: the spring takes back the view without it)
      this.unlook(this.q, top);
      this.takeBack();
    }

    // ---- the thumb (a flick's stroke panned before its lift said it was a flick, unless another thumb is still panning)
    if (this.flickedNow) {
      this.flickedNow = false;
      if (!thumb && this.stroke) this.goingBack = true;
      // (and what its stroke carved goes too)
      this.carveBack = true;
    }
    if (thumb) {
      this.goingBack = false;
      if (!this.stroke) {
        this.stroke = true;
        this.yaw0 = this.yaw;
        this.tilt0 = this.tilt;
      }
      this.yaw += panYaw;
      this.tilt = Math.max(-1.4, Math.min(1.4, this.tilt + panTilt));
    } else this.stroke = false;
    if (this.goingBack) {
      const k = 1 - Math.exp(-FLICK_BACK * dt);
      this.yaw += (this.yaw0 - this.yaw) * k;
      this.tilt += (this.tilt0 - this.tilt) * k;
      if (Math.abs(this.yaw - this.yaw0) + Math.abs(this.tilt - this.tilt0) < 1e-4) {
        this.yaw = this.yaw0;
        this.tilt = this.tilt0;
        this.goingBack = false;
      }
    }
    this.thumbQ.setFromEuler(this.euler.set(this.tilt, this.yaw, 0, 'YXZ'));

    this.oV.addScaledVector(this.o, -this.swing * this.swing * dt).multiplyScalar(Math.max(0, 1 - 2 * this.swing * dt));
    this.o.addScaledVector(this.oV, dt);
    const ang = this.o.length();
    if (ang > 1e-9) this.offset.setFromAxisAngle(this.t.copy(this.o).divideScalar(ang), ang);
    else this.offset.identity();
    this.q.copy(this.want).multiply(this.offset).multiply(this.thumbQ);
    // (and the look over all of it, as the rig lays it over its pose: no part of q, which the spring takes back)
    const view = this.look(this.q, top);

    // ---- into the Observer: rows are the render axes in EQJ
    const e = this.m.makeRotationFromQuaternion(view).elements, ax = trip.ob.axes;
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
    const roof = this.busUp, flat = this.t.copy(top).addScaledVector(carved, -top.dot(carved));
    if (flat.lengthSq() > 1e-6) roof.copy(flat).normalize();
    this.bank += ((trip.steering ? this.steerX : cx) * 0.45 - this.bank) * (1 - Math.exp(-6 * dt));
    // (a carve leans the roof into the turn)
    this.t2.copy(roof).multiplyScalar(Math.cos(this.bank)).addScaledVector(this.t.crossVectors(carved, roof), Math.sin(this.bank));
    this.inRender(carved, ax, this.nosing);
    this.inRender(this.t2, ax, this.y);
    // (carving, it goes the way it's carved, the streaks and the trail with it)
    this.inRender(carving ? carved : this.t.set(dir[0], dir[1], dir[2]), ax, this.flying);
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

  /**
   * The look over the view, as the rig lays it over its pose: round the way up through the bus, then over it, never past straight down. Up, it goes under the bus, where the rig tilts the lens where it stands: out here there's nothing for a
   * lens to stand in. At home it's q itself.
   */
  private look(q: THREE.Quaternion, top: THREE.Vector3): THREE.Quaternion {
    const yaw = this.lookYaw, pitch = this.lookPitch;
    if (yaw === 0 && pitch === 0) return q;
    const v = this.viewQ.copy(q).premultiply(this.lookQ.setFromAxisAngle(top, -yaw));
    let a = pitch;
    if (pitch < 0) {
      // (how far down the view already looks, a dive's tilt and all)
      const fwd = this.t2.set(0, 0, -1).applyQuaternion(v);
      a = -Math.min(-pitch, Math.max(0, config.camera.lookViewMax * DEG - Math.asin(Math.max(-1, Math.min(1, -fwd.dot(top))))));
    }
    return a === 0 ? v : v.multiply(this.lookQ.setFromAxisAngle(RIGHT, a));
  }

  /** A flick just lifted (moonrun.ts): what its stroke panned goes back, from the next frame, and what it carved. */
  flicked(): void {
    this.flickedNow = true;
  }

  /** QA: the carve off the path, degrees: yaw (+ left) and pitch (+ up). */
  get carve(): { yaw: number; pitch: number } {
    return { yaw: (this.cy * 180) / Math.PI, pitch: (this.cp * 180) / Math.PI };
  }

  /** What look() puts on a view, taken off it: the low game's lens comes back with the rig's look on it. */
  private unlook(q: THREE.Quaternion, top: THREE.Vector3): void {
    if (this.lookPitch !== 0) q.multiply(this.lookQ.setFromAxisAngle(RIGHT, -this.lookPitch));
    if (this.lookYaw !== 0) q.premultiply(this.lookQ.setFromAxisAngle(top, this.lookYaw));
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
