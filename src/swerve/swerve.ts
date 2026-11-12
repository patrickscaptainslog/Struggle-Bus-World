import { config } from '../config';
import type { Flight } from '../game/Flight';

// ?swerve: the handling the producer asked for (docs/specs/flight/SWERVE.md), as a stand-in laid over the flight from outside. The flight, the stick and the
// camera are the first account's, and what's here is theirs to take into them properly: until then nothing in src/game/Flight.ts changes, and this reaches the
// flight through what it already offers (Flight.turbo's yaw, speed and rate, speedScale, heading) and two of config's springs. No DOM and no three.js: the
// harness flies it in Node (tools/swerve).
//
//  - The longer stick. The stick's own curve is linear to about 61 px and eased out by 105 (Input's knee): past that, out to its leash at 172 px, nothing more
//    happened. Sideways travel past `hardFrom` now turns the bus harder, up to `hardGain` times today's most by `hardFull`, on a stiffer spring so it bites.
//    Inside `hardFrom` nothing changes: smooth is today's.
//  - The swoop. A bus pointed steeply up or down by the stick comes round faster: its turn over the cosine of its nose's angle, at most `swoopMax` times. Only
//    for a stick held well sideways (`swoopFrom`), so a climb with a wandering thumb still climbs straight.
//  - The skid. The thumb past `skidFrom` for `skidHold`: the nose swings toward the turn at `noseRate`, faster than the bus's way can come round, and the angle
//    between them is the slip (`slip`: main.ts turns the model and the aim by it; Flight.heading stays the way the bus is going, so everything the flight does
//    for a bus going somewhere, its floor ahead, its push round a tower, the camera behind it, is still true). A slip scrubs speed (`scrub`), never under `floor`,
//    and never the gear. Eased back inside, let go, or `hold` s in with a gear driving, it grips: over `grip` s the bus's way comes round to its nose, and the
//    gear pulls the speed back. With no gear in it can be held: a doughnut.
//  - The wave. A real slide that grips with a full belly throws it off the outside as a wave ('wave': the boot paints it, and it spends the belly). A tap in
//    the slide is a shot down the nose instead, and then there's no belly to throw.
//  - The long swipe's brake is the gears' now (TurboDrive.toCruise, brakeFor here), and the gesture the boot's.

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ss = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Live-tunable (tuner group "Swerve", registered by the boot). First numbers: tools/swerve prints what they fly like, and the phone beats that. */
export const swerveTune = {
  /** The hard turn: the thumb's sideways travel from its landing (CSS px) where today's stick ends and it begins, and where it is all in. */
  hardFrom: 78,
  hardFull: 120,
  /** ...how many times today's most it is, by the speed (m/s): Cruise, Express, Nonstop, Jet, Turbo 3. In between by the speed's log. */
  hardAt: [30, 112, 225, 450, 900],
  hardGain: [1.5, 2.15, 2.35, 2.45, 2.55],
  /** ...and the steering spring at full hard (Hz; config.flight.bungeeHz inside hardFrom), and the camera's yaw spring times this, so it keeps up. */
  hardHz: 5,
  hardCam: 1.8,
  /** The swoop: at most this many times the turn; for a stick this far sideways (0..1), all in by swoopFull. It comes at swoopEase (1/s) and goes at swoopFall,
   *  slower: a pull, then a sweep across as the nose starts down, is one arc of the thumb, and the turn is still quick at its top. */
  swoopMax: 3,
  swoopFrom: 0.3,
  swoopFull: 0.75,
  swoopEase: 8,
  swoopFall: 2.5,
  /** The skid: the thumb's sideways travel (px) past which, held skidHold s, it starts; back inside by skidBack (px) it grips. Not under skidMin m/s. */
  skidFrom: 138,
  skidBack: 12,
  /** A thumb short of room to a side (`squeeze`): the smooth part is kept down to this (px), the hard part gets at least this, the skid is this short of the edge. */
  squeezeSmooth: 52,
  squeezeHard: 16,
  squeezeSkid: 10,
  skidHold: 0.08,
  skidMin: 10,
  /** ...the nose's swing (rad/s) by the speed (m/s), and what the slip grows by at the least (rad/s: the nose always leads). */
  noseAt: [112, 225, 450, 900],
  noseRate: [3.14, 2.18, 1.57, 1.05],
  slipMin: 0.5,
  /** ...the most slip (deg), the share of the speed a full slip scrubs a second, the speed it never goes under (m/s; or what it began at, if that was less), how
   *  fast the speed follows (1/s). */
  slipMax: 70,
  scrub: 0.4,
  floor: 20,
  scrubRate: 6,
  /** ...how long the grip takes (s), and how long a slide lasts with a gear driving (s). */
  grip: 0.3,
  hold: 1.5,
  /** ...and the roll it leans the bus out by at full slip (deg). */
  lean: 16,
  /** The wave: a slide at least this long (s) that reached this slip (deg), gripping with a full belly. Its middle is this far off the outside of the slide and
   *  this far behind (m), and it is this far round (m): something over half a tap's circle, beside the bus's way. */
  waveAfter: 0.25,
  waveSlip: 30,
  waveOut: 44,
  waveBack: 12,
  waveRadius: 64,
  /** The long swipe's brake: the speed is down to the classic flight's in about this long (s). */
  brakeFor: 0.7,
};

/** A table read at the speed's log, held past its ends. */
function byLog(at: readonly number[], v: readonly number[], speed: number): number {
  const n = at.length;
  if (speed <= at[0]) return v[0];
  if (speed >= at[n - 1]) return v[n - 1];
  let i = 1;
  while (speed > at[i]) i++;
  const u = Math.log(speed / at[i - 1]) / Math.log(at[i] / at[i - 1]);
  return v[i - 1] + (v[i] - v[i - 1]) * u;
}

/**
 * A thumb that lands near a side of the glass has less room that way than the stick's parts need: `room` px from its landing to where a thumb can still be
 * read. The hard part and the skid squeeze into what there is, and this is the travel on the stick's own scale: the smooth part kept down to `squeezeSmooth`
 * px, then the hard part in at least `squeezeHard` px, and the skid `squeezeSkid` px short of the edge. With room to spare (skidFrom and a little over) it is
 * the travel itself. So a thumb pushed against the edge of the glass is always asking for all there is.
 */
export function squeeze(travel: number, room: number): number {
  const T = swerveTune, need = T.skidFrom + T.squeezeSkid;
  if (room >= need || travel <= 0) return travel;
  const skid = Math.max(T.squeezeSmooth + T.squeezeHard + 4, room - T.squeezeSkid), full = Math.min(T.hardFull, Math.max(T.squeezeSmooth + T.squeezeHard, skid - 14));
  const from = Math.min(T.hardFrom, Math.max(T.squeezeSmooth, full - (T.hardFull - T.hardFrom)));
  if (travel <= from) return (travel * T.hardFrom) / from;
  if (travel <= full) return T.hardFrom + ((travel - from) / (full - from)) * (T.hardFull - T.hardFrom);
  if (travel <= skid) return T.hardFull + ((travel - full) / (skid - full)) * (T.skidFrom - T.hardFull);
  return T.skidFrom + (travel - skid);
}

/** How many times today's most the hard turn is at this speed. */
export const hardGainAt = (speed: number) => byLog(swerveTune.hardAt, swerveTune.hardGain, speed);
/** The nose's swing in a skid at this speed (rad/s). */
export const noseRateAt = (speed: number) => byLog(swerveTune.noseAt, swerveTune.noseRate, speed);

export interface SwerveStick {
  /** a thumb (or a key) is steering */
  dragging: boolean;
  /** the thumb's sideways travel from where it landed (CSS px, + right): Input's finger less its anchor */
  dx: number;
  /** the stick's own sideways, as the flight gets it (-1..1) */
  sx: number;
}

export type SwerveEvent =
  /** a skid began (dir: +1 right, -1 left) */
  | 'skid'
  /** it gripped (`self`: by itself, its time up) */
  | 'grip'
  /** ...throwing its belly off the outside */
  | 'wave';

const enum Phase {
  Grip = 0,
  Slide = 1,
  Catch = 2,
}

/** Where a wave lands (its middle, into `out`), for a bus whose slide turned `dir` (+1 right, -1 left): off the outside of the slide, a little behind. */
export function wavePlace(f: Flight, dir: number, out: { x: number; z: number }): { x: number; z: number } {
  const T = swerveTune, side = -dir, rx = Math.cos(f.heading), rz = Math.sin(f.heading);
  out.x = f.x + rx * side * T.waveOut - f.fx * T.waveBack;
  out.z = f.z + rz * side * T.waveOut - f.fz * T.waveBack;
  return out;
}

export class Swerve {
  /** The nose off the bus's way (rad, + right): the model and the aim turn by it. 0 out of a skid. */
  slip = 0;
  /** The roll a skid leans the bus by, out of its turn (rad, + right, added to Flight.bank). */
  roll = 0;
  /** 0..1: how far into the hard part the stick is. */
  hard = 0;
  /** The skid's side (+1 right, -1 left), and how long this one has slid (s). */
  dir = 1;
  slideT = 0;
  /** What the skid has left of the speed (0..1], 1 out of one. */
  keep = 1;
  onEvent: ((ev: SwerveEvent, self: boolean) => void) | null = null;
  private phase: Phase = Phase.Grip;
  /** the thumb has been back inside since the last skid: the next may start */
  private armed = true;
  private heldFor = 0;
  private catchT = 0;
  private slip0 = 0;
  private peak = 0;
  private steep = 1;
  private h0 = 0;
  /** the least speed this skid leaves (m/s), and that it has Flight.speedScale (no gear in) */
  private least = 0;
  private scaled = false;
  private rollV = 0;
  /** the springs as config has them, and what was last written over them: a tuner moving one is taken as the new base */
  private baseHz = NaN;
  private wroteHz = NaN;
  private baseCam = NaN;
  private wroteCam = NaN;

  /** A skid is on: sliding, or gripping. */
  get skidding(): boolean {
    return this.phase !== Phase.Grip;
  }
  /** ...and still sliding. */
  get sliding(): boolean {
    return this.phase === Phase.Slide;
  }
  /** The springs go back to config's own (the harness, between a flight with it and one without). */
  release(): void {
    if (!Number.isNaN(this.baseHz)) config.flight.bungeeHz = this.baseHz;
    if (!Number.isNaN(this.baseCam)) config.camera.yawHz = this.baseCam;
    this.wroteHz = this.wroteCam = NaN;
  }

  /**
   * Once a frame, after the gears have written Flight.turbo and before the flight steps. `off`: nothing of it this frame (the street, the opening's gate, a
   * flight that isn't the stick's): a skid under way grips.
   */
  pre(dt: number, stick: SwerveStick, f: Flight, off = false): void {
    const T = swerveTune, F = config.flight, C = config.camera, Tb = f.turbo;
    const on = !off && Tb.hover === 0;
    const X = on && stick.dragging ? Math.abs(stick.dx) : 0;
    const side = stick.dx < 0 ? -1 : 1;

    // ---- the hard turn, and the swoop over it
    const u = ss(T.hardFrom, T.hardFull, X);
    this.hard = u;
    let gain = 1 + (hardGainAt(f.speed) - 1) * u;
    // (only a nose the stick has put there: skimming the roofs the bus rises and sinks by itself, and its turn mustn't breathe with them)
    const steep = on && (f.mode === 2 || f.mode === 3) ? 1 / Math.max(Math.cos(f.nose), 1 / Math.max(1, T.swoopMax)) : 1;
    this.steep += (steep - this.steep) * (1 - Math.exp(-(steep > this.steep ? T.swoopEase : T.swoopFall) * dt));
    gain *= 1 + (this.steep - 1) * ss(T.swoopFrom, T.swoopFull, Math.abs(stick.sx));
    Tb.yaw *= gain;
    // (the springs: a value that isn't what was last written here is somebody's new base, the tuner's)
    if (F.bungeeHz !== this.wroteHz) this.baseHz = F.bungeeHz;
    this.wroteHz = F.bungeeHz = this.baseHz + (Math.max(this.baseHz, T.hardHz) - this.baseHz) * u;
    if (C.yawHz !== this.wroteCam) this.baseCam = C.yawHz;
    this.wroteCam = C.yawHz = this.baseCam * (1 + (Math.max(1, T.hardCam) - 1) * u);

    // ---- the skid
    const past = X >= T.skidFrom;
    if (past) this.heldFor += dt;
    else {
      this.heldFor = 0;
      this.armed = true;
    }
    if (this.phase !== Phase.Slide && past && this.armed && this.heldFor >= T.skidHold && f.speed >= T.skidMin) {
      this.phase = Phase.Slide;
      this.dir = side;
      this.slideT = 0;
      this.peak = Math.abs(this.slip);
      this.least = Math.min(T.floor, f.speed);
      this.armed = false;
      this.onEvent?.('skid', false);
    } else if (this.phase === Phase.Slide) {
      // (eased back inside, the other way, let go, off; or its time up with a gear driving: with none it can be held, a doughnut)
      const timeUp = this.slideT >= T.hold && Tb.speed > 0;
      if (X < T.skidFrom - T.skidBack || side !== this.dir || timeUp) this.grip(f, timeUp);
    }
    if (this.phase === Phase.Slide) {
      // (the speed it keeps: the gear's own, or the classic flight's, scaled; the flight chases it as it chases any speed)
      const base = Tb.speed > 0 ? Tb.speed : F.cruiseSpeed;
      this.keep = Math.max(Math.min(1, this.least / base), this.keep * Math.exp(((-T.scrub * Math.abs(this.slip)) / (T.slipMax * DEG)) * dt));
      if (Tb.speed > 0) {
        Tb.speed = Math.max(this.least, Tb.speed * this.keep);
        Tb.rate = Math.max(Tb.rate, T.scrubRate);
      } else if (!(Tb.rate > 0)) {
        f.speedScale = Math.min(f.speedScale, this.keep);
        this.scaled = true;
      }
    }
    this.h0 = f.heading;
  }

  /** Once a frame, after the flight has stepped (or the street has rolled it). */
  post(dt: number, f: Flight): void {
    const T = swerveTune, cap = T.slipMax * DEG;
    if (this.phase === Phase.Slide) {
      this.slideT += dt;
      // (the nose swings at its own rate, the bus's way at the flight's: the slip is what the nose has over it, and it always has some)
      const w = dt > 0 ? ((f.heading - this.h0) * this.dir) / dt : 0;
      this.slip = clamp(this.slip + this.dir * Math.max(noseRateAt(f.speed) - w, T.slipMin) * dt, -cap, cap);
      this.peak = Math.max(this.peak, this.slip * this.dir);
      // (a full belly's weight, or a push let go, can leave the classic flight's own speed under the least: the skid never takes it there)
      if (f.speed < this.least) f.speed = this.least;
    } else if (this.phase === Phase.Catch) {
      // (the grip: the bus's way comes round to its nose, which stays where it points)
      this.catchT += dt;
      const to = this.slip0 * (1 - ss(0, Math.max(0.01, T.grip), this.catchT));
      f.heading += this.slip - to;
      this.slip = to;
      if (this.catchT >= T.grip) {
        this.phase = Phase.Grip;
        this.slip = 0;
      }
    }
    // (leaning out of the turn while it slides, on a spring so the grip rocks it back)
    const want = this.phase === Phase.Grip ? 0 : -Math.sign(this.slip) * T.lean * DEG * Math.min(1, Math.abs(this.slip) / cap);
    const k = 2 * Math.PI * 3;
    this.rollV += (k * k * (want - this.roll) - 2 * 0.6 * k * this.rollV) * dt;
    this.roll += this.rollV * dt;
  }

  /** The slide grips: the catch begins, the speed is the gear's again, and a full belly goes off the outside. */
  private grip(f: Flight, self: boolean): void {
    const T = swerveTune;
    this.phase = Phase.Catch;
    this.catchT = 0;
    this.slip0 = this.slip;
    this.keep = 1;
    if (this.scaled) f.speedScale = 1;
    this.scaled = false;
    this.onEvent?.('grip', self);
    if (this.slideT >= T.waveAfter && this.peak >= T.waveSlip * DEG && f.fullness >= 0.999 && f.barfT < 0) this.onEvent?.('wave', self);
  }
}
