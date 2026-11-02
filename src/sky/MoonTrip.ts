import { EARTH, MOON, R_MOON, SkyModel, SkyState, rebaseBody, type BodyId, type Observer, type Series } from './SkyModel';
import { geodeticToFix } from './WorldFrame';

// The flight of MOONSHOT.md section 3 from stop 1's start: 300 km over San Francisco, to 300 km over the Moon, orbit, and back to 300 km over home, as often as you like.
// Pure TS and doubles, no three.js: tools/sky/route-check.mjs flies this file in Node against verdict/route.py, and every law here is that file's or trip/sim.py's unless it says otherwise.
//
// The ruling: each gear has one speed and one climb rate. Speed is a function of the gear and of the time since the last shift, never of height, and height only decides when a gear may engage.
// On this branch the game aims the bus. A tap is a shift: it may be early, in which case the gear is armed and engages at its floor, as a low shift does in Turbo.ts.
//
// What route.py doesn't fly, and is new here: both ends. It stops the Moon leg at speed 448 km short of the target and falls into the city at the other end, so the way in, the orbit itself and the last stop
// at 300 km over home are this file's. It also turns on a frame, so a joint here turns at TURN, which costs a few tenths of a second.
//
// The way in is one brake, on arrival only and driven by the distance to the destination: speed is the gear's until v = d / tau says less, so the disc on screen grows at one steady rate and there is no ring to cross.
// The ruling above holds: this law is never about climbing or leaving, which stay on gears. A body being left never slows or speeds anything.
//
// All vectors are EQJ km. The Observer is free flight from Earth's centre and, inside SWITCH_KM of the Moon, from the Moon's: the frame carries the Moon's 1 km/s, and nothing on screen moves at the change.

const DEG = Math.PI / 180;
/** The route's spheres: heights in this file are over these (trip/sim.py). */
export const R_E = 6371;
export const R_M = R_MOON;

const G0 = 0.112;
/** The orbit's gear: a lap takes 7 minutes, against 43 s at G4, so the ground under the aim crawls and a tap lands where the player saw it land (MoonBreath.ts). */
const G3 = 30;
const G4 = 300;
/** G4's floor, on both bodies, and G5's: 13,000 km, close to where Earth just fits the 38 degree lens. */
const ALT4 = 300;
const ALT5 = 13000;
/** The level run, when the target is behind the Earth (MOONSHOT.md section 3, Appendix A). */
const ARC_H = 3000;
/** Degrees of clearance over a limb before the path may leave for the far body. */
const MARGIN = 3;
const SPOOL = 2.4;
const EASE = 0.35;
/** The classic rate of a shift down (Turbo.ts: 1.4 Hz's follow, times 2.2). */
const HZ = 3.08;
const SWITCH_KM = 60000;
/** How fast the path may swing at a joint, rad/s. Not route.py's, which turns on a frame. */
const TURN = 60 * DEG;
/** The way in's time constant, s: speed is the height over the floor over this, plus the floor's own speed. 12 s meets 6,000 km/s near 72,000 km and takes about 65 s from there. */
export const TAU = 12;
/** The pull-up at the end of the way in, rad/s: from straight down to level at this one rate, about 30 s from about 1,700 km up. */
export const PULL = 3 * DEG;
/** The last stop over home, km/s2: what takes the end of the way in down to rest in a finite time, where v = d / tau alone would never get there. */
const SETTLE = 1;
/** Full steering, rad/s at full stick: G0's rate, which Turbo.ts's law gives a bus at surge. */
const YAW = 42.5 * DEG;
/** The turn to the Moon's azimuth once home, rad/s. */
const FACE = 30 * DEG;
/** G5 is worth asking for while the way in would still let it go this many times G4. */
const ROOM = 3;
/** The way in is over this far above the orbit's floor, km: under a degree of dive is left, and the orbit's own settling takes that. */
const FLOOR = 0.02;
/** The level run ends this far short of over home, km: at TURN_IN the bus swings down within it, and from here the line to the place stays well above home's horizon. */
const LEVEL_END = 4700;
/** How fast the path may swing on the way home, rad/s, at speed: a joint there is a long curve, not a corner. Once it's slow the last of the way must be free to find a place that's turning with the Earth. */
const TURN_IN = 10 * DEG;

/** The landing site route.py aims near: Apollo 11, Moon fixed. */
const SITE_LAT = 0.67 * DEG;
const SITE_LON = 23.47 * DEG;
const SITE = [Math.cos(SITE_LAT) * Math.cos(SITE_LON), Math.cos(SITE_LAT) * Math.sin(SITE_LON), Math.sin(SITE_LAT)];
const BACK = 870 / (R_M + 150);

/** The way down from the orbit (?moonland): the same law as the way in, on from it, to Jet's speed at this height over the ground, km. Its time constant is what leaves the orbit's speed where it is at the orbit's height, so nothing jumps at the push. */
export const FALL_FLOOR = 2;
const G1 = 0.45;
export const FALL_TAU = (ALT4 - FALL_FLOOR) / (G3 - G1);
/** The yoke, as Flight's: the dead band, the path's angle at full pull and full push (rad), the stick's curve, and how fast the path follows it (1/s). config.flight has the same numbers: moonrun.ts hands them over, so this file stays free of the game. */
export const YOKE = { dead: 0.14, up: 85 * DEG, down: 85 * DEG, curve: 1.3, rate: 2.6 };
/** A push held this long leaves the orbit (s): a carving thumb's drift doesn't. */
const PUSH_HOLD = 0.15;

export type Leg = 'wait' | 'climb' | 'arc' | 'out' | 'cruise' | 'in' | 'orbit' | 'fall' | 'ground' | 'leave' | 'homeOut' | 'homeCruise' | 'homeIn' | 'homeLevel' | 'homeDrop';

/** What the small label calls each leg (MOONSHOT.md's table). */
export const LEG_NAMES: Record<Leg, string> = {
  wait: 'OVER HOME',
  climb: 'CLIMBING CLEAR',
  arc: 'LEVEL RUN',
  out: 'LEAVING',
  cruise: 'THE LONG DARK',
  in: 'COMING IN',
  orbit: 'IN ORBIT',
  fall: 'GOING DOWN',
  ground: 'ON THE MOON',
  leave: 'ROUND THE MOON',
  homeOut: 'HEADING HOME',
  homeCruise: 'THE LONG DARK',
  homeIn: 'COMING HOME',
  homeLevel: 'LEVEL RUN',
  homeDrop: 'COMING HOME',
};

export interface LegLog {
  leg: Leg;
  /** s from this trip's launch */
  at: number;
  s: number;
  km: number;
}

export interface TripOptions {
  /** G5's speed, km/s: 3,000, 6,000 or 10,000 (?g5=) */
  g5: number;
  /** the way in's time constant, s (?tau=) */
  tau?: number;
  /** home, degrees */
  lat?: number;
  lon?: number;
  /** a push in orbit goes down (?moonland) */
  land?: boolean;
}

type V = Float64Array;
const v3 = () => new Float64Array(3);
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.sqrt(dot(a, a));
function sub(a: V, b: V, o: V): V {
  o[0] = a[0] - b[0];
  o[1] = a[1] - b[1];
  o[2] = a[2] - b[2];
  return o;
}
function setUnit(a: V, o: V): V {
  const k = 1 / len(a);
  o[0] = a[0] * k;
  o[1] = a[1] * k;
  o[2] = a[2] * k;
  return o;
}
/** o is not a or b. */
function cross(a: V, b: V, o: V): V {
  o[0] = a[1] * b[2] - a[2] * b[1];
  o[1] = a[2] * b[0] - a[0] * b[2];
  o[2] = a[0] * b[1] - a[1] * b[0];
  return o;
}
function angle(a: V, b: V): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b)))));
}
/** o = a less its part along unit u, unit. Safe to pass o = a. */
function tangent(a: V, u: V, o: V): V {
  const k = dot(a, u);
  o[0] = a[0] - u[0] * k;
  o[1] = a[1] - u[1] * k;
  o[2] = a[2] - u[2] * k;
  return setUnit(o, o);
}

const chaseV = (v: number, target: number, rate: number, tIn: number, dt: number) => {
  const e = Math.min(1, tIn / EASE);
  return v + (target - v) * (1 - Math.exp(-rate * (0.15 + 0.85 * e * e * (3 - 2 * e)) * dt));
};

export class MoonTrip {
  /** Moves here; TripView writes its axes. */
  readonly ob: Observer = { body: EARTH, free: true, pos: v3(), axes: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
  leg: Leg = 'wait';
  /** The gear in force: 3 at rest over home and in orbit, 4, 5. */
  gear = 3;
  /** km/s */
  v = G0;
  /** G5 is asked for and engages at its floor. */
  armed = false;
  /** There's still room on this leg for G5: past that the way in has the speed, and a tap would ask for nothing. */
  g5Room = true;
  /** s since boot, and of the last launch. The sky's clock is ms0 + t. */
  t = 0;
  launchedAt = 0;
  /** launches so far, and how long the last one took, home to home */
  trips = 0;
  tripSeconds = 0;
  /** this frame: the bus from Earth's and from the Moon's centre; the way it flies; level, the way it faces over a body */
  readonly r = v3();
  readonly rm = v3();
  readonly dir = v3();
  readonly heading = v3();
  /** every leg of every trip so far */
  readonly log: LegLog[] = [];

  readonly g5: number;
  /** The way in's time constant, s, and the pull-up's turn, rad/s: live, the tuner moves them. */
  tau: number;
  pull = PULL;
  /** The way the bus goes on the way down, rad, + up. */
  nose = 0;
  /** What's left of the fall's speed while the ground isn't made yet: 1 free, 0 held where it is (moon/Landing.ts). */
  gov = 1;
  /** The ground under the bus over the sphere, km, once it's known (moon/Landing.ts). */
  ground = 0;
  /** A stick the map's edge adds to the thumb's, as the low game's homing does (moon/Landing.ts). */
  home = 0;
  private pushT = 0;
  private readonly land: boolean;
  private readonly ms0: number;
  private readonly now: SkyModel;
  private readonly later: SkyModel;
  private readonly nowS = new SkyState();
  private readonly laterS = new SkyState();
  private readonly probe: Observer = { body: EARTH, free: true, pos: Float64Array.from([7000, 0, 0]), axes: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
  private readonly fx = v3();
  /** home's direction this frame */
  private readonly hc = v3();
  private ti = 0;
  private eta = 280;
  private legAt = 0;
  private km = 0;
  private rLevel = 0;
  private rOrbit = R_M + ALT4;
  private tapped = false;
  private downTapped = false;
  private started = false;
  private atRest = false;
  /** Just home: the bus turns to face the Moon's azimuth, so the next launch reads as the first one did. A thumb on the stick ends it. */
  private facing = false;
  // (scratch: nothing here allocates per frame)
  private readonly a = v3();
  private readonly d = v3();
  private readonly u = v3();
  private readonly w = v3();
  private readonly w2 = v3();
  private readonly w3 = v3();
  private readonly s = v3();

  constructor(series: Series, ms0: number, opts: TripOptions) {
    this.ms0 = ms0;
    this.g5 = opts.g5;
    this.tau = opts.tau ?? TAU;
    this.land = !!opts.land;
    this.now = new SkyModel(series);
    this.later = new SkyModel(series);
    geodeticToFix(opts.lat ?? 37.7749, opts.lon ?? -122.4194, 0, this.fx);
  }

  /** UTC ms: what the sky must be drawn at, once step() has run. */
  get ms(): number {
    return this.ms0 + this.t * 1000;
  }

  /** s since this trip's launch; home, what the whole trip took; 0 before the first. */
  get clock(): number {
    return !this.trips ? 0 : this.leg === 'wait' ? this.tripSeconds : this.t - this.launchedAt;
  }

  get hEarth(): number {
    return len(this.r) - R_E;
  }

  get hMoon(): number {
    return len(this.rm) - R_M;
  }

  /** The thumb steers the bus on these legs. Everywhere else it swings the camera. */
  get steering(): boolean {
    return this.leg === 'wait' || this.leg === 'orbit' || this.leg === 'fall';
  }

  /** The body this leg is going to: the view turns to it once the one behind has had its moment (TripView.ts). */
  get bound(): BodyId {
    return this.leg === 'wait' || this.leg === 'leave' || this.leg === 'homeOut' || this.leg === 'homeCruise' || this.leg === 'homeIn' || this.leg === 'homeLevel' || this.leg === 'homeDrop' ? EARTH : MOON;
  }

  /** Full stick's turn, rad/s. */
  get yawRate(): number {
    return YAW;
  }

  /** There is something for the down tab to do. */
  get canShiftDown(): boolean {
    return this.armed;
  }

  /** TURBO: a tap shifts up. It lands at the next step, which reads the sky. */
  tap(): void {
    this.tapped = true;
  }

  /** The down tab: G5 not asked for after all. */
  shiftDown(): void {
    this.downTapped = true;
  }

  /** The ground game has the frame: the sky's clock still runs. */
  tick(dt: number): void {
    this.t += dt;
  }

  /** One frame. stick: the thumb's x, -1..1, used only where the thumb steers. yoke: its y, + up, nose down, in orbit and on the way down. */
  step(dt: number, stick: number, yoke = 0): void {
    const now = this.now;
    now.frame(this.ms, this.ob, this.nowS);
    const r = this.r, rm = this.rm, m = now.moonEqj;
    r.set(now.obsEqj);
    sub(r, m, rm);
    // fixed <- EQJ by rows, so home in EQJ is its transpose on the fixed vector
    const f = now.earthFix, x = this.fx, hc = this.hc;
    hc[0] = f[0] * x[0] + f[3] * x[1] + f[6] * x[2];
    hc[1] = f[1] * x[0] + f[4] * x[1] + f[7] * x[2];
    hc[2] = f[2] * x[0] + f[5] * x[1] + f[8] * x[2];
    setUnit(hc, hc);
    const dM = len(rm);
    if (this.ob.body === EARTH && dM < SWITCH_KM) rebaseBody(this.ob, MOON, now);
    else if (this.ob.body === MOON && dM > SWITCH_KM * 1.05) rebaseBody(this.ob, EARTH, now);
    if (!this.started) this.begin();
    this.shifts();
    // (a leg that ends hands the same frame to the next one, so no frame stands still)
    for (let i = 0; i < 4 && !this.fly(dt, stick, yoke); i++);
    this.t += dt;
    // where it is now, on this frame's Moon: 1 km/s stale at most, a few metres
    const p = this.ob.pos;
    if (this.ob.body === MOON) {
      rm.set(p);
      r[0] = p[0] + m[0];
      r[1] = p[1] + m[1];
      r[2] = p[2] + m[2];
    } else {
      r.set(p);
      sub(r, m, rm);
    }
    // level stays level, carried along with the radial of the nearer body
    tangent(this.heading, setUnit(len(r) < dM ? r : rm, this.u), this.heading);
  }

  /** The first frame: over home, facing the Moon's azimuth, as if the thumb had turned to the MOON sign. */
  private begin(): void {
    this.started = true;
    const u = this.u, hc = this.hc;
    u.set(hc);
    for (let i = 0; i < 3; i++) this.ob.pos[i] = hc[i] * (R_E + ALT4);
    this.r.set(this.ob.pos);
    sub(this.r, this.now.moonEqj, this.rm);
    sub(this.now.moonEqj, this.r, this.w);
    tangent(this.w, u, this.heading);
    this.dir.set(this.heading);
  }

  private shifts(): void {
    if (this.tapped) {
      this.tapped = false;
      switch (this.leg) {
        case 'wait':
          this.launch();
          break;
        case 'climb':
        case 'arc':
        case 'out':
        case 'leave':
        case 'homeOut':
          if (this.g5Room) this.armed = true;
          break;
        case 'orbit':
          this.leaveMoon();
          break;
        case 'fall':
          // (still in the sky: below that the gears are the ground's)
          if (this.hMoon > 150) this.leaveMoon();
          break;
      }
    }
    if (this.downTapped) {
      this.downTapped = false;
      this.armed = false;
    }
  }

  private launch(): void {
    this.launchedAt = this.t;
    this.trips++;
    this.gear = 4;
    this.ti = 0;
    this.v = G0;
    this.eta = 280;
    this.armed = false;
    this.g5Room = true;
    this.facing = false;
    // (from rest the path is free: only the nose has to swing, and TripView eases that)
    this.atRest = true;
    this.enter('climb');
  }

  /** Always by way of the level leg: a bus flying away from Earth has to carve round on the floor first, or the short way to Earth is through the Moon. */
  private leaveMoon(): void {
    this.nose = 0;
    this.gear = 4;
    this.ti = 0;
    this.armed = false;
    this.g5Room = true;
    this.rLevel = len(this.ob.pos);
    this.enter('leave');
  }

  private enter(leg: Leg): void {
    if (this.leg !== 'wait' && this.leg !== 'orbit' && this.leg !== 'fall' && this.leg !== 'ground' && this.km > 0) this.log.push({ leg: this.leg, at: this.legAt - this.launchedAt, s: this.t - this.legAt, km: this.km });
    this.leg = leg;
    this.legAt = this.t;
    this.km = 0;
  }

  /** The far body stands clear of the near one's limb, seen from a radial p, with `to` the way to it. */
  private clearOf(p: V, to: V, R: number): boolean {
    const dip = Math.acos(R / len(p)) / DEG;
    return angle(p, to) / DEG < 90 + dip - MARGIN;
  }

  private moonClear(): boolean {
    return this.clearOf(this.r, sub(this.now.moonEqj, this.r, this.w), R_E);
  }

  private earthClear(): boolean {
    this.w[0] = -this.r[0];
    this.w[1] = -this.r[1];
    this.w[2] = -this.r[2];
    return this.clearOf(this.rm, this.w, R_M);
  }

  /** route.py's aim(): where to arrive, eta seconds on, into this.a. Re-solved every frame, from a model of its own, so the Moon's place at arrival costs one lerp and no series. */
  private aim(eta: number): void {
    const later = this.later;
    later.frame(this.ms + eta * 1000, this.probe, this.laterS);
    const m2 = later.moonEqj, F = later.moonFix, a = this.a, b = this.w, s = this.s;
    s[0] = F[0] * SITE[0] + F[3] * SITE[1] + F[6] * SITE[2];
    s[1] = F[1] * SITE[0] + F[4] * SITE[1] + F[7] * SITE[2];
    s[2] = F[2] * SITE[0] + F[5] * SITE[1] + F[8] * SITE[2];
    setUnit(sub(this.r, m2, b), b);
    const R = R_M + ALT4;
    if (angle(s, b) <= BACK) {
      for (let i = 0; i < 3; i++) a[i] = m2[i] + b[i] * R;
      return;
    }
    tangent(b, s, this.w2);
    const c = Math.cos(BACK), sn = Math.sin(BACK);
    for (let i = 0; i < 3; i++) a[i] = m2[i] + (s[i] * c + this.w2[i] * sn) * R;
  }

  /** route.py's to_target(), into this.d: over home on the 3,000 km sphere, or the tangent of that sphere on home's side. */
  private toHome(): void {
    const r = this.r, hc = this.hc, d = this.d, u = this.u, rr = R_E + ARC_H, dist = len(r);
    setUnit(r, u);
    if (angle(hc, r) > Math.acos(rr / dist)) {
      tangent(hc, u, this.w);
      const a = Math.acos(rr / dist), c = Math.cos(a), s = Math.sin(a);
      for (let i = 0; i < 3; i++) d[i] = (u[i] * c + this.w[i] * s) * rr - r[i];
    } else for (let i = 0; i < 3; i++) d[i] = hc[i] * rr - r[i];
    setUnit(d, d);
  }

  private spool(target: number, dt: number): void {
    this.v = chaseV(this.v, target, 3 / SPOOL, this.ti, dt);
    this.ti += dt;
  }

  /** The way in to the Moon, km/s at x km over the orbit's floor: on the floor, the orbit's own speed. */
  private lawMoon(x: number): number {
    return G3 + Math.max(x, 0) / this.tau;
  }

  /**
   * The way in to home, km/s, at height h: the same law, and the last of it comes to rest over home, at a steady deceleration, in a finite time. It reads the straight line to the place, so a level run round the limb
   * isn't braked for a home that lies close by through the Earth; and it is on G4 at the level run's sphere, wherever home is, so a run round the limb starts at the speed that sphere was made for.
   */
  private lawHome(h: number): number {
    const p = this.w2, r = this.r, hc = this.hc;
    for (let i = 0; i < 3; i++) p[i] = hc[i] * (R_E + ALT4) - r[i];
    const d = len(p), k = d / this.tau;
    return Math.min(Math.sqrt(k * k + 2 * SETTLE * d), G4 + (h - ARC_H) / this.tau);
  }

  /** On the way in the gear says what the law's speed is in. */
  private inGear(): void {
    this.gear = this.v > G4 * 1.01 ? 5 : 4;
  }

  /** Swing the path toward a unit vector, at `rate` at most. */
  private swing(want: V, rate: number, dt: number): void {
    const dir = this.dir, a = angle(dir, want);
    if (a < 1e-7) return;
    if (this.atRest) {
      this.atRest = false;
      dir.set(want);
      return;
    }
    if (a > 3.13) {
      // (dead astern: to one side, level, then the rest is an ordinary turn)
      setUnit(cross(this.ob.pos, dir, this.w3), this.w3);
      for (let i = 0; i < 3; i++) dir[i] += this.w3[i] * 0.02;
      setUnit(dir, dir);
      return;
    }
    const s = Math.min(1, (rate * dt) / a), k = 1 / Math.sin(a), p = Math.sin((1 - s) * a) * k, q = Math.sin(s * a) * k;
    for (let i = 0; i < 3; i++) dir[i] = dir[i] * p + want[i] * q;
    setUnit(dir, dir);
  }

  /** Swing, and go. */
  private go(want: V, dt: number, rate = TURN): void {
    this.swing(want, rate, dt);
    this.move(dt);
  }

  /** The rate for the way home at this speed. */
  private get turnIn(): number {
    return Math.min(TURN, TURN_IN * (1 + 60 / this.v));
  }

  private move(dt: number): void {
    const p = this.ob.pos, s = this.v * dt;
    p[0] += this.dir[0] * s;
    p[1] += this.dir[1] * s;
    p[2] += this.dir[2] * s;
    this.km += s;
  }

  /** go(), along a level tangent, at the height it has once it has swung round. */
  private goLevel(want: V, dt: number, rate = TURN): void {
    const aligned = dot(this.dir, want) > 0.9995;
    this.go(want, dt, rate);
    const p = this.ob.pos;
    if (!aligned) this.rLevel = len(p);
    else {
      const k = this.rLevel / len(p);
      p[0] *= k;
      p[1] *= k;
      p[2] *= k;
    }
  }

  /** North at this radial: both bodies arrive north up, which is how far views are framed, and it's the way the pull-up leaves. */
  private headNorth(u: V): void {
    const n = this.w3;
    n[0] = 0;
    n[1] = 0;
    n[2] = 1;
    tangent(n, u, this.heading);
  }

  /** The carve round to the Moon's azimuth, over home. */
  private faceMoon(dt: number): void {
    const hc = this.hc, h = this.heading, w = this.w, right = this.w2;
    tangent(sub(this.now.moonEqj, this.r, w), hc, w);
    cross(h, hc, right);
    const a = Math.atan2(dot(w, right), dot(w, h)), most = FACE * dt;
    if (Math.abs(a) < 0.3 * DEG) this.facing = false;
    this.turn(Math.max(-most, Math.min(most, a * (1 - Math.exp(-1.5 * dt)))), hc);
  }

  private yaw(stick: number, dt: number, u: V): void {
    if (stick !== 0) this.turn(stick * YAW * dt, u);
  }

  /** The heading, a radians to the right, over the radial u. */
  private turn(a: number, u: V): void {
    const c = Math.cos(a), s = Math.sin(a), h = this.heading, right = cross(h, u, this.w);
    for (let i = 0; i < 3; i++) h[i] = h[i] * c + right[i] * s;
    tangent(h, u, h);
  }

  /** The way down, km/s at h km over the ground. A brake on arrival only, as the way in is: this is a limit, and climbing leaves the speed where it was. */
  private lawFall(h: number): number {
    return G1 + Math.max(h - FALL_FLOOR, 0) / FALL_TAU;
  }

  /** The thumb's nose down, 0..1, as Flight's yoke reads it up high. */
  private pushOf(yoke: number): number {
    return Math.max(0, Math.min(1, (yoke - YOKE.dead) / (1 - YOKE.dead)));
  }

  /** One leg's frame. False: the leg ended here and the next one flies this frame. */
  private fly(dt: number, stick: number, yoke: number): boolean {
    const r = this.r, rm = this.rm, a = this.a, d = this.d, u = this.u;
    const dE = len(r), hE = dE - R_E, hM = len(rm) - R_M;
    switch (this.leg) {
      case 'wait': {
        const p = this.ob.pos, hc = this.hc;
        if (stick !== 0) this.facing = false;
        if (this.facing) this.faceMoon(dt);
        this.yaw(stick, dt, hc);
        this.v = G0;
        for (let i = 0; i < 3; i++) p[i] = hc[i] * (R_E + ALT4);
        this.dir.set(this.heading);
        return true;
      }
      // ---- out
      case 'climb':
        if (this.moonClear()) {
          this.enter('out');
          return false;
        }
        if (hE >= ARC_H) {
          this.enter('arc');
          return false;
        }
        this.spool(G4, dt);
        this.go(setUnit(r, u), dt);
        return true;
      case 'arc': {
        if (this.moonClear()) {
          this.enter('out');
          return false;
        }
        setUnit(r, u);
        cross(cross(r, this.now.moonEqj, this.w), u, d);
        setUnit(d, d);
        this.spool(G4, dt);
        this.goLevel(d, dt);
        return true;
      }
      case 'out': {
        this.aim(this.eta);
        sub(a, r, d);
        const rem = len(d);
        setUnit(d, d);
        this.eta = rem / (this.g5 * 0.95);
        const law = this.lawMoon(hM - ALT4);
        if (law <= this.v) {
          this.arrive();
          return false;
        }
        this.g5Room = law > G4 * ROOM;
        if (!this.g5Room) this.armed = false;
        if (this.armed && hE >= ALT5) {
          this.armed = false;
          this.gear = 5;
          this.ti = 0;
          this.enter('cruise');
          return false;
        }
        this.spool(G4, dt);
        this.go(d, dt);
        return true;
      }
      case 'cruise': {
        this.aim(this.eta);
        sub(a, r, d);
        const rem = len(d);
        setUnit(d, d);
        this.eta = rem / Math.max(this.v, 1);
        if (this.lawMoon(hM - ALT4) <= this.v) {
          this.arrive();
          return false;
        }
        this.spool(this.g5, dt);
        this.go(d, dt);
        return true;
      }
      case 'in': {
        // one line from the disc's far floor to the orbit's: straight down, speed the law's. The pull-up is the same law: a constant turn lands level on the floor at G3 when 1 - cos(dive) = PULL tau ln(v / G3), so the dive is
        // solved from the height every frame, and it can't miss. (The aim's few degrees off the disc's middle end here: the path goes to the middle, where the view is.)
        const x = hM - ALT4;
        setUnit(rm, u);
        tangent(this.heading, u, this.w2);
        if (x <= FLOOR) {
          this.heading.set(this.w2);
          this.dir.set(this.w2);
          this.rOrbit = len(rm);
          this.gear = 3;
          this.enter('orbit');
          return false;
        }
        this.v = Math.min(this.v, this.lawMoon(x));
        this.inGear();
        const cosDive = Math.max(0, 1 - this.pull * this.tau * Math.log(this.lawMoon(x) / G3)), sinDive = Math.sqrt(1 - cosDive * cosDive);
        for (let i = 0; i < 3; i++) d[i] = this.w2[i] * cosDive - u[i] * sinDive;
        this.go(d, dt);
        return true;
      }
      case 'orbit': {
        // level on the floor, a great circle round the Moon, the thumb turning it. The way in arrives at G3 and it stays
        const p = this.ob.pos, h = this.heading;
        setUnit(p, u);
        this.pushT = this.land && this.pushOf(yoke) > 0 ? this.pushT + dt : 0;
        if (this.pushT > PUSH_HOLD) {
          this.pushT = 0;
          this.nose = 0;
          this.gov = 1;
          this.enter('fall');
          return false;
        }
        this.yaw(stick, dt, u);
        this.v += (G3 - this.v) * (1 - Math.exp(-HZ * dt));
        this.rOrbit += (R_M + ALT4 - this.rOrbit) * (1 - Math.exp(-2 * dt));
        const th = (this.v * dt) / this.rOrbit, c = Math.cos(th), s = Math.sin(th);
        for (let i = 0; i < 3; i++) {
          const ui = u[i], hi = h[i];
          p[i] = (ui * c + hi * s) * this.rOrbit;
          h[i] = hi * c - ui * s;
        }
        this.dir.set(h);
        return true;
      }
      case 'fall': {
        // The yoke as the low game has it: the thumb sets the way the bus goes, and the speed goes that way. Speed is the law's at this height, the most it may be; it never goes back up. Curved as the orbit is, so level is level: the thumb lets go
        // and the bus flies on round the Moon at that height. moon/Landing.ts makes the ground under it, and holds this back by `gov` if the ground isn't there yet.
        const p = this.ob.pos, h = this.heading, Y = YOKE;
        setUnit(p, u);
        this.yaw(Math.max(-1, Math.min(1, stick + this.home)), dt, u);
        const pull = Math.max(0, Math.min(1, (-yoke - Y.dead) / (1 - Y.dead))), push = this.pushOf(yoke);
        const want = pull > 0 ? Y.up * pull ** Y.curve : push > 0 ? -Y.down * push ** Y.curve : 0;
        this.nose += (want - this.nose) * (1 - Math.exp(-Y.rate * dt));
        this.v = Math.min(this.v, this.lawFall(hM - this.ground));
        this.gear = this.v > G4 * 1.01 ? 5 : 3;
        const s = this.v * this.gov * dt, cn = Math.cos(this.nose), sn = Math.sin(this.nose), R = len(p), th = (s * cn) / R, c = Math.cos(th), sa = Math.sin(th), up = R + s * sn;
        for (let i = 0; i < 3; i++) {
          const ui = u[i], hi = h[i];
          p[i] = (ui * c + hi * sa) * up;
          h[i] = hi * c - ui * sa;
          this.dir[i] = h[i] * cn + (ui * c + hi * sa) * sn;
        }
        this.km += s;
        // (pulled all the way back up: it's the orbit again, and that takes the speed back)
        if (up >= R_M + ALT4 && this.nose > 0) {
          this.nose = 0;
          this.rOrbit = up;
          tangent(this.dir, setUnit(p, u), this.dir);
          this.gear = 3;
          this.enter('orbit');
        }
        return true;
      }
      // (the ground game has the frame: nothing here moves)
      case 'ground':
        return true;
      // ---- home
      case 'leave': {
        // level on the floor, carving round to Earth and then on until it stands over the limb: trip/sim.py's arc_moon, from wherever the lap has got to. It's done once Earth is no longer behind the bus
        // (straight overhead is 90 degrees off a level nose, and fine: the turn goes up)
        this.toHome();
        if (this.earthClear() && dot(this.dir, d) > -0.17) {
          this.enter('homeOut');
          return false;
        }
        setUnit(rm, u);
        this.w2[0] = -r[0];
        this.w2[1] = -r[1];
        this.w2[2] = -r[2];
        cross(cross(rm, this.w2, this.w), u, d);
        setUnit(d, d);
        this.spool(G4, dt);
        this.swing(d, YAW, dt);
        this.move(dt);
        // (it faces the way it carves, so the view goes with it)
        tangent(this.dir, setUnit(this.ob.pos, u), this.dir);
        this.heading.set(this.dir);
        const p = this.ob.pos, k = this.rLevel / len(p);
        p[0] *= k;
        p[1] *= k;
        p[2] *= k;
        return true;
      }
      case 'homeOut':
        if (hE <= ALT5) {
          this.homeIn();
          return false;
        }
        this.g5Room = this.lawHome(hE) > G4 * ROOM;
        if (!this.g5Room) this.armed = false;
        if (this.armed && hM >= ALT5) {
          this.armed = false;
          this.gear = 5;
          this.ti = 0;
          this.enter('homeCruise');
          return false;
        }
        this.toHome();
        this.spool(G4, dt);
        this.swing(d, TURN, dt);
        // G4's floor holds it: Earth low over the limb is reached by flying on level, which is how the limb drops away
        if (hM <= ALT4 + 2 && dot(this.dir, setUnit(rm, u)) < 0) tangent(this.dir, u, this.dir);
        this.move(dt);
        return true;
      case 'homeCruise':
        if (this.lawHome(hE) <= this.v) {
          this.homeIn();
          return false;
        }
        this.toHome();
        this.spool(this.g5, dt);
        this.go(d, dt);
        return true;
      case 'homeIn': {
        const rr = R_E + ARC_H, over = angle(this.hc, r) * rr < LEVEL_END;
        if (dE > rr + 1 && !over) {
          this.v = Math.min(this.v, this.lawHome(hE));
          this.inGear();
          this.toHome();
          if (dot(d, setUnit(r, u)) <= -0.03) {
            this.go(d, dt, this.turnIn);
            return true;
          }
        }
        this.rLevel = len(this.ob.pos);
        this.enter(over ? 'homeDrop' : 'homeLevel');
        return false;
      }
      case 'homeLevel':
        if (angle(this.hc, r) * dE <= LEVEL_END) {
          this.enter('homeDrop');
          return false;
        }
        this.v = Math.min(this.v, this.lawHome(hE));
        this.inGear();
        setUnit(r, u);
        cross(cross(r, this.hc, this.w), u, d);
        setUnit(d, d);
        this.goLevel(d, dt, this.turnIn);
        return true;
      case 'homeDrop': {
        const t = this.w2;
        for (let i = 0; i < 3; i++) t[i] = this.hc[i] * (R_E + ALT4);
        sub(t, r, d);
        const rem = len(d);
        if (rem < 0.3) {
          this.gear = 3;
          this.tripSeconds = this.t - this.launchedAt;
          this.facing = true;
          this.enter('wait');
          return false;
        }
        setUnit(d, d);
        this.v = Math.min(this.v, this.lawHome(hE));
        this.inGear();
        this.go(d, dt, this.turnIn);
        return true;
      }
    }
  }

  /** The ground game takes the bus (moon/Landing.ts). */
  land2ground(): void {
    this.enter('ground');
  }

  /** The law has the speed from here. Level turns north for the pull-up, unseen: a far view is framed north up. */
  private arrive(): void {
    this.headNorth(setUnit(this.rm, this.u));
    this.enter('in');
  }

  private homeIn(): void {
    this.headNorth(setUnit(this.r, this.u));
    this.enter('homeIn');
  }
}
