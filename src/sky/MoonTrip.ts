import { EARTH, MOON, R_MOON, SkyModel, SkyState, rebaseBody, type Observer, type Series } from './SkyModel';
import { geodeticToFix } from './WorldFrame';

// The flight of MOONSHOT.md section 3 from stop 1's start: 300 km over San Francisco, to 300 km over the Moon, orbit, and back to 300 km over home, as often as you like.
// Pure TS and doubles, no three.js: tools/sky/route-check.mjs flies this file in Node against verdict/route.py, and every law here is that file's or trip/sim.py's unless it says otherwise.
//
// The ruling: each gear has one speed and one climb rate. Speed is a function of the gear and of the time since the last shift, never of height, and height only decides when a gear may engage.
// On this branch the game aims the bus. A tap is a shift: it may be early, in which case the gear is armed and engages at its floor, as a low shift does in Turbo.ts.
//
// What route.py doesn't fly, and is new here: both ends. It stops the Moon leg at speed 448 km short of the target and falls into the city at the other end, so the flare into orbit, the orbit itself and
// the last stop at 300 km over home are this file's. It also turns on a frame, so a joint here turns at TURN, which costs a few tenths of a second.
//
// All vectors are EQJ km. The Observer is free flight from Earth's centre and, inside SWITCH_KM of the Moon, from the Moon's: the frame carries the Moon's 1 km/s, and nothing on screen moves at the change.

const DEG = Math.PI / 180;
/** The route's spheres: heights in this file are over these (trip/sim.py). */
export const R_E = 6371;
export const R_M = R_MOON;

const G0 = 0.112;
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
const BRAKE = 3;
const EASE = 0.35;
/** The classic rate that ends a brake (Turbo.ts: 1.4 Hz's follow, times 2.2). */
const HZ = 3.08;
const SWITCH_KM = 60000;
/** How fast the path may swing at a joint, rad/s. Not route.py's, which turns on a frame. */
const TURN = 60 * DEG;
/** The flare's turn on the way into orbit, rad/s: about 600 km of radius at G4, about 3 s. */
const FLARE = 0.5;
/** Full steering, rad/s at full stick: G0's rate, which Turbo.ts's law gives a bus at surge. */
const YAW = 42.5 * DEG;
/** The last stop over home: speed is at most this much of the distance left, 1/s. */
const STOP = 2;
/** The level run ends this far short of over home, km: at TURN the bus swings down within it. */
const LEVEL_END = 400;

/** The landing site route.py aims near: Apollo 11, Moon fixed. */
const SITE_LAT = 0.67 * DEG;
const SITE_LON = 23.47 * DEG;
const SITE = [Math.cos(SITE_LAT) * Math.cos(SITE_LON), Math.cos(SITE_LAT) * Math.sin(SITE_LON), Math.sin(SITE_LAT)];
const BACK = 870 / (R_M + 150);

export type Leg = 'wait' | 'climb' | 'arc' | 'out' | 'cruise' | 'brake' | 'down' | 'flare' | 'orbit' | 'leave' | 'homeOut' | 'homeCruise' | 'homeBrake' | 'homeDown' | 'homeLevel' | 'homeDrop';

/** What the small label calls each leg (MOONSHOT.md's table). */
export const LEG_NAMES: Record<Leg, string> = {
  wait: 'OVER HOME',
  climb: 'CLIMBING CLEAR',
  arc: 'LEVEL RUN',
  out: 'LEAVING',
  cruise: 'THE LONG DARK',
  brake: 'THE RING',
  down: 'COMING IN',
  flare: 'COMING IN',
  orbit: 'IN ORBIT',
  leave: 'ROUND THE MOON',
  homeOut: 'HEADING HOME',
  homeCruise: 'THE LONG DARK',
  homeBrake: 'THE RING',
  homeDown: 'COMING HOME',
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
  /** home, degrees */
  lat?: number;
  lon?: number;
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

/** km covered from hi to within 1 % of lo, on the brake below, at route.py's step. */
function brakeDist(hi: number, lo: number): number {
  const DT = 1 / 30;
  let v = hi, d = 0, ti = 0, on = true;
  while (v > lo * 1.01) {
    if (on && v > lo * 1.25) v = chaseV(v, lo, 3 / BRAKE, ti, DT);
    else {
      on = false;
      v += (lo - v) * (1 - Math.exp(-HZ * DT));
    }
    d += v * DT;
    ti += DT;
  }
  return d;
}

export class MoonTrip {
  /** Moves here; TripView writes its axes. */
  readonly ob: Observer = { body: EARTH, free: true, pos: v3(), axes: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
  leg: Leg = 'wait';
  /** The gear in force: 3 at rest over home, 4, 5, and 3 or 4 in orbit. */
  gear = 3;
  /** km/s */
  v = G0;
  /** G5 is asked for and engages at its floor. */
  armed = false;
  /** s since boot, and of the last launch. The sky's clock is ms0 + t. */
  t = 0;
  launchedAt = 0;
  /** launches so far */
  trips = 0;
  /** this frame: the bus from Earth's and from the Moon's centre; the way it flies; level, the way it faces over a body */
  readonly r = v3();
  readonly rm = v3();
  readonly dir = v3();
  readonly heading = v3();
  /** every leg of every trip so far */
  readonly log: LegLog[] = [];

  readonly g5: number;
  private readonly ms0: number;
  private readonly now: SkyModel;
  private readonly later: SkyModel;
  private readonly nowS = new SkyState();
  private readonly laterS = new SkyState();
  private readonly probe: Observer = { body: EARTH, free: true, pos: Float64Array.from([7000, 0, 0]), axes: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
  private readonly dBrake: number;
  private readonly fx = v3();
  /** home's direction this frame */
  private readonly hc = v3();
  private ti = 0;
  private braking = true;
  private eta = 280;
  private legAt = 0;
  private km = 0;
  private rLevel = 0;
  private rOrbit = R_M + ALT4;
  private orbitGear = 4;
  private tapped = false;
  private downTapped = false;
  private started = false;
  private atRest = false;
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
    this.now = new SkyModel(series);
    this.later = new SkyModel(series);
    this.dBrake = brakeDist(opts.g5, G4);
    geodeticToFix(opts.lat ?? 37.7749, opts.lon ?? -122.4194, 0, this.fx);
  }

  /** UTC ms: what the sky must be drawn at, once step() has run. */
  get ms(): number {
    return this.ms0 + this.t * 1000;
  }

  /** s since this trip's launch (0 before the first). */
  get clock(): number {
    return this.trips ? this.t - this.launchedAt : 0;
  }

  get hEarth(): number {
    return len(this.r) - R_E;
  }

  get hMoon(): number {
    return len(this.rm) - R_M;
  }

  /** The thumb steers the bus on these legs. Everywhere else it swings the camera. */
  get steering(): boolean {
    return this.leg === 'wait' || this.leg === 'orbit';
  }

  /** Full stick's turn, rad/s. */
  get yawRate(): number {
    return YAW;
  }

  /** There is something for the down tab to do. */
  get canShiftDown(): boolean {
    return this.armed || (this.leg === 'orbit' && this.gear === 4);
  }

  /** TURBO: a tap shifts up. It lands at the next step, which reads the sky. */
  tap(): void {
    this.tapped = true;
  }

  /** The down tab: G3 in orbit, a lap in about 7 minutes; or G5 not asked for after all. */
  shiftDown(): void {
    this.downTapped = true;
  }

  /** One frame. stick: the thumb's x, -1..1, used only where the thumb steers. */
  step(dt: number, stick: number): void {
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
    for (let i = 0; i < 4 && !this.fly(dt, stick); i++);
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
          this.armed = true;
          break;
        case 'orbit':
          if (this.orbitGear === 3) this.orbitGear = this.gear = 4;
          else this.leaveMoon();
          break;
      }
    }
    if (this.downTapped) {
      this.downTapped = false;
      if (this.armed) this.armed = false;
      else if (this.leg === 'orbit') this.orbitGear = this.gear = 3;
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
    // (from rest the path is free: only the nose has to swing, and TripView eases that)
    this.atRest = true;
    this.enter('climb');
  }

  /** Always by way of the level leg: a bus flying away from Earth has to carve round on the floor first, or the short way to Earth is through the Moon. */
  private leaveMoon(): void {
    this.gear = 4;
    this.ti = 0;
    this.armed = false;
    this.rLevel = len(this.ob.pos);
    this.enter('leave');
  }

  private enter(leg: Leg): void {
    if (this.leg !== 'wait' && this.leg !== 'orbit' && this.km > 0) this.log.push({ leg: this.leg, at: this.legAt - this.launchedAt, s: this.t - this.legAt, km: this.km });
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

  /** route.py's brake: the rate eased in, then the classic rate. */
  private brake(dt: number): void {
    if (this.braking && this.v > G4 * 1.25) this.v = chaseV(this.v, G4, 3 / BRAKE, this.ti, dt);
    else {
      this.braking = false;
      this.v += (G4 - this.v) * (1 - Math.exp(-HZ * dt));
    }
    this.ti += dt;
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
  private go(want: V, dt: number): void {
    this.swing(want, TURN, dt);
    this.move(dt);
  }

  private move(dt: number): void {
    const p = this.ob.pos, s = this.v * dt;
    p[0] += this.dir[0] * s;
    p[1] += this.dir[1] * s;
    p[2] += this.dir[2] * s;
    this.km += s;
  }

  /** go(), along a level tangent, at the height it has once it has swung round. */
  private goLevel(want: V, dt: number): void {
    const aligned = dot(this.dir, want) > 0.9995;
    this.go(want, dt);
    const p = this.ob.pos;
    if (!aligned) this.rLevel = len(p);
    else {
      const k = this.rLevel / len(p);
      p[0] *= k;
      p[1] *= k;
      p[2] *= k;
    }
  }

  /** North at this radial: both bodies arrive north up, which is how far views are framed, and it's the way the flare leaves. */
  private headNorth(u: V): void {
    const n = this.w3;
    n[0] = 0;
    n[1] = 0;
    n[2] = 1;
    tangent(n, u, this.heading);
  }

  private yaw(stick: number, dt: number, u: V): void {
    if (stick === 0) return;
    const a = stick * YAW * dt, c = Math.cos(a), s = Math.sin(a), h = this.heading, right = cross(h, u, this.w);
    for (let i = 0; i < 3; i++) h[i] = h[i] * c + right[i] * s;
    tangent(h, u, h);
  }

  /** One leg's frame. False: the leg ended here and the next one flies this frame. */
  private fly(dt: number, stick: number): boolean {
    const r = this.r, rm = this.rm, a = this.a, d = this.d, u = this.u;
    const dE = len(r), hE = dE - R_E, hM = len(rm) - R_M;
    switch (this.leg) {
      case 'wait': {
        const p = this.ob.pos, hc = this.hc;
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
        if (rem <= ALT5 - ALT4) {
          this.arrive();
          return false;
        }
        if (this.armed && hE >= ALT5 && rem > this.dBrake + ALT5 - ALT4) {
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
        if (rem <= this.dBrake + ALT5 - ALT4) {
          this.gear = 4;
          this.ti = 0;
          this.braking = true;
          this.enter('brake');
          return false;
        }
        this.spool(this.g5, dt);
        this.go(d, dt);
        return true;
      }
      case 'brake':
        if (this.v <= G4 * 1.01) {
          this.arrive();
          return false;
        }
        this.aim(0);
        setUnit(sub(a, r, d), d);
        this.brake(dt);
        this.go(d, dt);
        return true;
      case 'down': {
        setUnit(rm, u);
        const sinDive = -dot(this.dir, u), cosDive = Math.sqrt(Math.max(0, 1 - sinDive * sinDive));
        if (hM - ALT4 <= (this.v / FLARE) * (1 - cosDive)) {
          this.enter('flare');
          return false;
        }
        this.aim(0);
        setUnit(sub(a, r, d), d);
        this.go(d, dt);
        return true;
      }
      case 'flare': {
        // an arc that lands level on G4's floor: its radius is solved from where it is, every frame, so it can't miss
        setUnit(rm, u);
        const sinDive = -dot(this.dir, u), cosDive = Math.sqrt(Math.max(0, 1 - sinDive * sinDive));
        tangent(this.heading, u, this.w2);
        if (sinDive <= 0.01 || hM <= ALT4) {
          this.heading.set(this.w2);
          this.dir.set(this.w2);
          this.rOrbit = len(rm);
          this.orbitGear = 4;
          this.enter('orbit');
          return false;
        }
        const radius = Math.max(50, (hM - ALT4) / Math.max(1e-4, 1 - cosDive));
        const dir = this.dir, ang = angle(dir, this.w2), s = Math.min(1, ((this.v / radius) * dt) / Math.max(ang, 1e-6));
        const k = 1 / Math.sin(ang), p = Math.sin((1 - s) * ang) * k, q = Math.sin(s * ang) * k;
        for (let i = 0; i < 3; i++) dir[i] = dir[i] * p + this.w2[i] * q;
        setUnit(dir, dir);
        this.move(dt);
        return true;
      }
      case 'orbit': {
        // level on the floor, a great circle round the Moon, the thumb turning it
        const p = this.ob.pos, h = this.heading;
        setUnit(p, u);
        this.yaw(stick, dt, u);
        const speed = this.orbitGear === 3 ? G3 : G4;
        this.v += (speed - this.v) * (1 - Math.exp(-HZ * dt));
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
          this.homeDown();
          return false;
        }
        if (this.armed && hM >= ALT5 && hE > ALT5 + this.dBrake) {
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
        if (hE <= ALT5 + this.dBrake) {
          this.gear = 4;
          this.ti = 0;
          this.braking = true;
          this.enter('homeBrake');
          return false;
        }
        this.toHome();
        this.spool(this.g5, dt);
        this.go(d, dt);
        return true;
      case 'homeBrake':
        if (this.v <= G4 * 1.01) {
          this.homeDown();
          return false;
        }
        this.toHome();
        this.brake(dt);
        this.go(d, dt);
        return true;
      case 'homeDown': {
        const rr = R_E + ARC_H, over = angle(this.hc, r) * rr < LEVEL_END;
        if (dE > rr + 1 && !over) {
          this.toHome();
          if (dot(d, setUnit(r, u)) <= -0.03) {
            this.go(d, dt);
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
        setUnit(r, u);
        cross(cross(r, this.hc, this.w), u, d);
        setUnit(d, d);
        this.goLevel(d, dt);
        return true;
      case 'homeDrop': {
        const t = this.w2;
        for (let i = 0; i < 3; i++) t[i] = this.hc[i] * (R_E + ALT4);
        sub(t, r, d);
        const rem = len(d);
        if (rem < 0.3) {
          this.gear = 3;
          this.enter('wait');
          return false;
        }
        setUnit(d, d);
        this.v = Math.min(this.v, rem * STOP);
        this.go(d, dt);
        return true;
      }
    }
  }

  /** The ring is behind: G4 down to the Moon. Level turns north for the flare, unseen: a far view is framed north up. */
  private arrive(): void {
    this.gear = 4;
    this.headNorth(setUnit(this.rm, this.u));
    this.enter('down');
  }

  private homeDown(): void {
    this.gear = 4;
    this.headNorth(setUnit(this.r, this.u));
    this.enter('homeDown');
  }
}
