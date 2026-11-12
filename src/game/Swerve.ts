import { config } from '../config';
import type { Flight, FlightInput } from './Flight';
import { SPEED_OF_SOUND } from './Turbo';

// ?swerve: the handling the producer asked for (docs/specs/flight/SWERVE.md), the flight's own. Flight.step runs it inside each of its steps: pre() before the
// speed and the steering, post() at the end. Behind `on`, which only ?swerve sets: off, nothing here touches the flight, not a bit of it. What the stick asks
// comes in on FlightInput (Input's `hard` and `skid`: src/game/Input.ts, stickParts); what it does goes out as the step's own numbers (the turn's gain, the
// spring's stiffening, the speed a skid keeps), never by writing what the gears wrote (Flight.turbo) or config's springs. No DOM and no three.js: the
// harness flies it in Node (tools/swerve).
//
//  - The longer stick. The stick's own curve is linear to about 61 px and eased out by 105 (Input's knee): past that, out to its leash at 172 px, nothing more
//    happened. Sideways travel into the hard part (Input says how far) now turns the bus harder, up to `hardGain` times today's most, on a stiffer spring so
//    it bites. Short of it nothing changes: smooth is today's.
//  - The swoop. A bus pointed steeply up or down by the stick comes round faster: its turn over the cosine of its nose's angle, at most `swoopMax` times. Only
//    for a stick held well sideways (`swoopFrom`), so a climb with a wandering thumb still climbs straight.
//  - The skid. The thumb past the skid's line (Input's) for `skidHold`: the nose swings toward the turn at `noseRate`, faster than the bus's way can come
//    round, and the angle between them is the slip (`slip`: main.ts turns the model and the aim by it; Flight.heading stays the way the bus is going, so
//    everything the flight does for a bus going somewhere, its floor ahead, its push round a tower, the camera behind it, is still true). A slip scrubs the
//    speed the flight chases (`keep`), never under `floor`, and never the gear's own (Flight.turbo.speed stays the gear's: the Comet reads it). Eased back
//    `skidBack` inside, let go, or `hold` s in with a gear driving, it grips: over `grip` s the bus's way comes round to its nose, and the gear pulls the
//    speed back. With no gear in it can be held: a doughnut.
//  - The wave. A real slide that grips with a full belly throws it off the outside as a wave ('wave': the boot paints it, and it spends the belly). A tap in
//    the slide is a shot down the nose instead, and then there's no belly to throw.
// The long swipe's brake is the gears' (TurboDrive.toCruise), and its gesture the boot's (src/swerve/swerveBoot.ts).

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ss = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Live-tunable (tuner group "Swerve", registered by src/swerve/swerveBoot.ts). First numbers: tools/swerve prints what they fly like, and the phone beats that. */
export const swerveTune = {
  /** The stick's rule for a thumb short of room to a side (Input's stickParts): 0 ours, the smooth part kept whole wherever it fits; 1 the stand-in's squeeze. */
  rule: 0,
  /** The hard turn: the thumb's sideways travel from its landing (CSS px) where today's stick ends and it begins, and where it is all in. */
  hardFrom: 78,
  hardFull: 120,
  /** ...how many times today's most it is, by the speed (m/s): Cruise, Express, Nonstop, Jet, Turbo 1, 2 and 3. In between by the speed's log. One law the
   *  whole ladder up, "turn more aggressively in all gears": all in, half a turn takes 1.5 s x (speed / 26.4)^0.2, 15 % longer each time the speed doubles,
   *  where today's stick takes 2.2 times longer (the "really long turns" in turbo). Solved gear by gear on the real flight (tools/swerve/s_turns.ts holds it). */
  hardAt: [30, 112, 225, 450, 585, 720, 900],
  hardGain: [1.5, 2.15, 2.75, 3.51, 3.83, 4.12, 4.45],
  /** ...and the steering spring at full hard (Hz; config.flight.bungeeHz out of it), and the camera's yaw spring times this, so it keeps up (CameraRig). */
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
  /** A thumb short of room to a side: the smooth part is kept down to this (px), the hard part gets at least this, the skid is this short of the edge. */
  squeezeSmooth: 52,
  squeezeHard: 16,
  squeezeSkid: 10,
  /** ...and how much the hard turn shrinks with the hard part squeezed (0..1): 1, no px of thumb turns more than a px of the whole stick does; 0, the
   *  squeezed hard part still gives the whole gain, steeper (stage 1). */
  squeezeCap: 1,
  /** A thumb can be read to within this of the glass's sides (px): the room it has (Input). */
  inset: 14,
  skidHold: 0.08,
  skidMin: 10,
  /** ...the nose's swing (rad/s) by the speed (m/s): 180 degrees a second to Express, 160 at Nonstop, 140 at Jet, 120 at Turbo 3, so the skid is the quick
   *  turn in every gear ("when I'm in turbo mode I want a way to quickly turn"); and what the slip grows by at the least (rad/s: the nose always leads). */
  noseAt: [112, 225, 450, 900],
  noseRate: [3.1416, 2.7925, 2.4435, 2.0944],
  slipMin: 0.5,
  /** ...over the last this many degrees before slipMax the slip's growth eases off (0: a hard stop at the cap), so the nose never drops from its swing to the
   *  way's in one frame. */
  slipSoft: 12,
  /** ...the most slip (deg), the share of the speed a full slip scrubs a second, the speed it never goes under (m/s; or what it began at, if that was less), how
   *  fast the speed follows (1/s). */
  slipMax: 70,
  scrub: 0.4,
  floor: 20,
  scrubRate: 6,
  /** ...and a bus over the speed of sound never goes under this share of it (0..1): the gears re-arm the boom under 0.92 of it, and the boom is theirs. */
  machKeep: 0.95,
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
  /** The long swipe's brake (TurboDrive.toCruise): the speed is down to the classic flight's in about this long (s). */
  brakeFor: 0.7,
};
// (`inset` is the tuner's in "Swipe", where it was before the stick had it, so a value saved there still holds: src/swerve/swerveBoot.ts)
Object.defineProperty(swerveTune, 'inset', { enumerable: false });

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

/** How many times today's most the hard turn is at this speed. */
export const hardGainAt = (speed: number) => byLog(swerveTune.hardAt, swerveTune.hardGain, speed);
/** The nose's swing in a skid at this speed (rad/s). */
export const noseRateAt = (speed: number) => byLog(swerveTune.noseAt, swerveTune.noseRate, speed);

export type SwerveEvent =
  /** a skid began (Swerve.dir: +1 right, -1 left) */
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
  /** ?swerve: the handling is on (main.ts). Off, nothing of it, and a skid under way grips. */
  on = false;
  /** The nose off the bus's way (rad, + right): the model and the aim turn by it. 0 out of a skid. */
  slip = 0;
  /** The roll a skid leans the bus by, out of its turn (rad, + right, added to Flight.bank). */
  roll = 0;
  /** 0..1: how far into the hard part the stick is, eased (the steering spring and the camera's stiffen by it). */
  hard = 0;
  /** This step's turn over today's: the hard part, and the swoop over it. */
  gain = 1;
  /** The swoop's share, eased: 1 flat, up to swoopMax steep. */
  steep = 1;
  /** The skid's side (+1 right, -1 left), and how long this one has slid (s). */
  dir = 1;
  slideT = 0;
  /** What the skid has left of the speed (0..1], 1 out of one, and the least it leaves (m/s). */
  keep = 1;
  least = 0;
  onEvent: ((ev: SwerveEvent, self: boolean) => void) | null = null;
  private phase: Phase = Phase.Grip;
  /** the thumb has been back inside since the last skid: the next may start */
  private armed = true;
  private heldFor = 0;
  private catchT = 0;
  private slip0 = 0;
  private peak = 0;
  private rollV = 0;

  /** A skid is on: sliding, or gripping. */
  get skidding(): boolean {
    return this.phase !== Phase.Grip;
  }
  /** ...and still sliding. */
  get sliding(): boolean {
    return this.phase === Phase.Slide;
  }

  /**
   * Each step, before the flight's speed and steering. `yoked`: the stick has the nose up or down (the flight's climb or dive). The stick's `hard` NaN or left out:
   * nothing of it this step (the opening's gate, the Moon's way in and out), and a skid under way grips.
   */
  pre(dt: number, inp: FlightInput, f: Flight, yoked: boolean): void {
    // (off, and nothing left over from when it was on: the flight is exactly as without it)
    if (!this.on && this.phase === Phase.Grip && this.hard === 0 && this.steep === 1 && this.gain === 1) return;
    const T = swerveTune, Tb = f.turbo;
    const hard = inp.hard ?? NaN;
    const on = this.on && !Number.isNaN(hard) && Tb.hover === 0;
    const held = on && inp.dragging;
    const sx = inp.dragging ? inp.sx : 0;

    // ---- the hard turn, and the swoop over it
    const u = held ? ss(0, 1, hard) : 0;
    this.hard = u;
    // (a hard part squeezed near the glass's side gives its share of the gain, Input's hardTop: never steeper per px than the whole stick)
    let gain = 1 + (hardGainAt(f.speed) - 1) * u * (inp.hardTop ?? 1);
    // (only a nose the stick has put there: skimming the roofs the bus rises and sinks by itself, and its turn mustn't breathe with them)
    const steep = on && yoked ? 1 / Math.max(Math.cos(f.nose), 1 / Math.max(1, T.swoopMax)) : 1;
    this.steep += (steep - this.steep) * (1 - Math.exp(-(steep > this.steep ? T.swoopEase : T.swoopFall) * dt));
    // (back to flat for good once it's within a hair: off, the step is exactly the flight's own again)
    if (!on && Math.abs(this.steep - 1) < 1e-6) this.steep = 1;
    gain *= 1 + (this.steep - 1) * ss(T.swoopFrom, T.swoopFull, Math.abs(sx));
    this.gain = gain;

    // ---- the skid
    const past = held && (inp.skid ?? -Infinity) >= 0;
    // (the thumb's side, not sx's: past the map's edge main.ts adds its homing to sx, and that mustn't swing a skid the other way or grip it)
    const side = inp.side ? (inp.side < 0 ? -1 : 1) : sx < 0 ? -1 : 1;
    if (past) this.heldFor += dt;
    else {
      this.heldFor = 0;
      this.armed = true;
    }
    // (the step that reaches the hold is held through: the slide begins with it, as the stand-in's began with the frame that reached it, at 30 fps and 60)
    if (this.phase !== Phase.Slide && past && this.armed && this.heldFor + dt >= T.skidHold && f.speed >= T.skidMin) {
      this.phase = Phase.Slide;
      this.dir = side;
      this.slideT = 0;
      this.peak = Math.abs(this.slip);
      // (and a bus over the speed of sound stays over the gears' boom line: a skid never takes it back through, and booms it again on the way up)
      this.least = Math.max(Math.min(T.floor, f.speed), f.speed > SPEED_OF_SOUND ? clamp(T.machKeep, 0, 1) * SPEED_OF_SOUND : 0);
      this.armed = false;
      this.onEvent?.('skid', false);
    } else if (this.phase === Phase.Slide) {
      // (eased back inside, the other way, let go, off; or its time up with a gear driving: with none it can be held, a doughnut)
      const timeUp = this.slideT >= T.hold && Tb.speed > 0;
      if (!held || (inp.skid ?? -Infinity) < -T.skidBack || side !== this.dir || timeUp) this.grip(f, timeUp);
    }
    if (this.phase === Phase.Slide) {
      // (the share of the speed it keeps, of the gear's own or the classic flight's: the flight chases that, as it chases any speed)
      const base = Tb.speed > 0 ? Tb.speed : config.flight.cruiseSpeed;
      this.keep = Math.max(Math.min(1, this.least / base), this.keep * Math.exp(((-T.scrub * Math.abs(this.slip)) / (T.slipMax * DEG)) * dt));
    }
  }

  /** The steering spring this step (Hz): config's, stiffened in the hard part. */
  springHz(hz: number): number {
    return this.hard > 0 ? hz + (Math.max(hz, swerveTune.hardHz) - hz) * this.hard : hz;
  }

  /** Each step, at its end. */
  post(dt: number, f: Flight): void {
    if (this.phase === Phase.Grip && this.roll === 0 && this.rollV === 0) return;
    const T = swerveTune, cap = T.slipMax * DEG;
    if (this.phase === Phase.Slide) {
      this.slideT += dt;
      // (the nose swings at its own rate, the bus's way at the flight's: the slip is what the nose has over it, and it always has some)
      // (easing off over the last slipSoft degrees to the cap: the nose comes off its swing smoothly, and the camera behind it with it)
      const w = f.yawRate * this.dir;
      let grow = Math.max(noseRateAt(f.speed) - w, T.slipMin);
      if (T.slipSoft > 0) grow *= ss(0, T.slipSoft * DEG, cap - this.slip * this.dir);
      this.slip = clamp(this.slip + this.dir * grow * dt, -cap, cap);
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
    // (leaning out of the turn while it slides, on a spring so the grip rocks it back; settled, it's 0 again)
    const want = this.phase === Phase.Grip ? 0 : -Math.sign(this.slip) * T.lean * DEG * Math.min(1, Math.abs(this.slip) / cap);
    const k = 2 * Math.PI * 3;
    this.rollV += (k * k * (want - this.roll) - 2 * 0.6 * k * this.rollV) * dt;
    this.roll += this.rollV * dt;
    if (this.phase === Phase.Grip && Math.abs(this.roll) < 1e-5 && Math.abs(this.rollV) < 1e-4) this.roll = this.rollV = 0;
  }

  /** On the street (Flight.ride) there's no skid and no hard turn: whatever was left of them is over, and a slide grips (no wave), so its squeal stops. */
  stop(): void {
    const sliding = this.phase === Phase.Slide;
    this.phase = Phase.Grip;
    this.slip = this.roll = this.rollV = 0;
    this.keep = 1;
    this.hard = 0;
    this.gain = this.steep = 1;
    this.heldFor = 0;
    if (sliding) this.onEvent?.('grip', false);
  }

  /** The slide grips: the catch begins, the speed is the gear's again, and a full belly goes off the outside. */
  private grip(f: Flight, self: boolean): void {
    const T = swerveTune;
    this.phase = Phase.Catch;
    this.catchT = 0;
    this.slip0 = this.slip;
    this.keep = 1;
    this.onEvent?.('grip', self);
    if (this.slideT >= T.waveAfter && this.peak >= T.waveSlip * DEG && f.fullness >= 0.999 && f.barfT < 0) this.onEvent?.('wave', self);
  }
}
