import { config } from '../config';
import { clamp, spring } from './springs';

const ss = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// The bus's body: a springy bungee steering model, automatic terrain-following
// altitude with hang time, and the struggle -> release rhythm of the belly.
//
// The yoke rides on the same thumb: pull down = climb (trading speed for
// height, fading into a wheezy struggle under the soft ceiling), push up =
// nose down (dive back to the rooftops, gaining speed; at the floor it
// surges), release = hold the chosen altitude with a gentle bob. The
// automatic floor underneath is the classic model, untouched: released at the
// bottom, the bus skims rooftops exactly as it always did.
//
// heading: compass radians (0 = north = -Z, +pi/2 = east = +X).

export interface WorldQuery {
  obstacleAt(x: number, z: number, fromY?: number): number;
  groundAt(x: number, z: number): number;
  /** Lowest underside of anything overhead (a bridge deck) above fromY, or Infinity. */
  overheadAt?(x: number, z: number, fromY: number): number;
}

export interface FlightInput {
  /** bungee stretch: x right, y up (nose down: dive / surge) / down (pull back: climb), |v| <= 1 */
  sx: number;
  sy: number;
  dragging: boolean;
}

const enum Yoke {
  /** released at the floor: automatic rooftop skimming, exactly the classic model */
  Floor = 0,
  /** released above the floor: hold the chosen altitude with a wheezy bob */
  Hold = 1,
  Climb = 2,
  Dive = 3,
}

export class Flight {
  x = 0;
  y = 60;
  z = 0;
  heading = 0;
  speed = config.flight.cruiseSpeed;
  vy = 0;
  yawRate = 0;
  private yawAcc = 0; // spring velocity of yawRate
  bank = 0;
  private bankVel = 0;
  pitch = 0;
  /** 0..1 belly fullness (1 = ready to barf; heavy) */
  fullness = 1;
  /** time since the current barf started, or -1 */
  barfT = -1;
  /** relief boost timer (s remaining) */
  relief = 0;
  /** smoothed altitude target, for the camera */
  groundUnder = 0;
  obstacleUnder = 0;
  surge = 0;
  /** opening glide: cruise at this speed until the player first steers */
  glideSpeed = 0;
  /** the automatic rooftop floor (m ASL): where the bus skims when released at the bottom */
  floorY = 60;
  /** the altitude the player chose with the yoke (m ASL, without belly sag/lift), or -Infinity = skim the floor */
  holdY = -Infinity;
  /** what the vertical controller is chasing right now (m ASL) */
  targetY = 60;
  /** height above the rooftop floor, smoothed (m): streaming, audio */
  lift = 0;
  /** height above the broad ground (terrain averaged over a few hundred meters, slowly smoothed; m): drives the vista camera while the yoke moves */
  height = 0;
  /** the broad ground under the bus (m ASL): terrain only, no roofs, heavily low-passed */
  groundBroad = NaN;
  /** 0..1: the bus is straining against the soft ceiling (wheeze, sputter) */
  strain = 0;
  /** current yoke mode (0 floor, 1 hold, 2 climb, 3 dive) */
  mode: number = Yoke.Floor;
  /** belly left after this breath ends (a miss refunds part of it), else 0 */
  refund = 0;
  /** 0..1: how full the belly reads right now (drains over the breath: the release is visible as it pours out) */
  belly = 1;
  private t = 0;
  private vyYoke = 0;
  private floorSmooth = 60;
  /** the rooftop floor the vertical spring chases: rises eased (no lurch at every roof edge), falls at once */
  private floorRise = NaN;
  /** speed when the breath started: the stall is a recoil, it must not add steering authority */
  private preBarfSpeed = config.flight.cruiseSpeed;
  /** Turbo gears (src/game/Turbo.ts) write these before each step; the defaults are the classic flight. */
  readonly turbo = {
    /** the speed a gear (or the boost) drives at (m/s; 0 = the classic cruise / surge) */
    speed: 0,
    /** how fast the speed chases it (1/s; 0 = the classic rate) */
    rate: 0,
    /** the gear's floor (m ASL): the bus doesn't fly lower while the gear is in */
    floor: -Infinity,
    /** the soft ceiling while a high gear is in (m ASL; 0 = config.flight.ceiling) */
    ceiling: 0,
    /** steering authority and the yoke's climb / dive rates (x) */
    yaw: 1,
    climb: 1,
  };

  get fx() {
    return Math.sin(this.heading);
  }
  get fz() {
    return -Math.cos(this.heading);
  }

  /** Returns true if a barf started. */
  tryBarf(): boolean {
    if (this.barfT >= 0 || this.fullness < 0.999) return false;
    this.barfT = 0;
    this.preBarfSpeed = this.speed;
    this.refund = 0;
    return true;
  }

  get barfing() {
    return this.barfT >= 0 && this.barfT < config.splat.duration;
  }

  step(dt: number, inp: FlightInput, world: WorldQuery) {
    const F = config.flight;
    const S = config.splat;
    this.t += dt;

    // ---- belly + barf rhythm
    if (this.barfT >= 0) {
      this.barfT += dt;
      if (this.barfT >= S.duration) {
        // release: recoil up, zip off lighter
        this.barfT = -1;
        this.vy += S.recoilUp;
        this.relief = S.reliefSeconds;
        this.fullness = clamp(this.refund, 0, 1);
        this.refund = 0;
      }
    } else if (this.fullness < 1) {
      this.fullness = Math.min(1, this.fullness + dt / Math.max(0.05, S.recharge));
    }
    if (this.relief > 0) this.relief = Math.max(0, this.relief - dt);
    const reliefK = this.relief > 0 ? this.relief / S.reliefSeconds : 0;
    // the belly drains over the breath (the sag lifts as it pours out, no 6 m hop on the tap frame)
    const drain = this.barfT >= 0 ? 1 - ss(S.inhale, S.duration, this.barfT) : 1;
    const heavy = this.fullness * drain;
    this.belly = heavy;
    // (the wallow still cuts on the tap frame)
    const wallowK = this.barfT >= 0 ? 0 : this.fullness;

    // ---- the yoke: thumb down = pull back (climb), thumb up = nose down (dive / surge)
    const sy = inp.dragging ? inp.sy : 0;
    const dz = clamp(F.yokeDead, 0, 0.9);
    const pull = clamp((-sy - dz) / (1 - dz), 0, 1);
    // at the floor any push surges (as ever); up high the push is the yoke's nose-down and gets the same
    // dead band as the pull, so a carving thumb's upward drift doesn't dive and speed up a held altitude
    const push = this.holdY > -1e8 ? clamp((sy - dz) / (1 - dz), 0, 1) : Math.max(0, sy);
    this.surge = push;

    // ---- speed
    const cruise = this.glideSpeed > 0 && !inp.dragging ? this.glideSpeed : F.cruiseSpeed;
    if (inp.dragging) this.glideSpeed = 0;
    // climbing trades speed for height; nose down gains it (and surges at the floor, as ever)
    let targetSpeed = push > 0 ? cruise + (F.surgeSpeed - F.cruiseSpeed) * Math.pow(push, 1.3) : cruise + (F.climbSpeed - cruise) * pull;
    targetSpeed *= 1 - 0.12 * heavy;
    targetSpeed *= 1 + (S.reliefBoost - 1) * reliefK * reliefK;
    const Tb = this.turbo;
    if (Tb.speed > 0) targetSpeed = Math.max(targetSpeed, Tb.speed);
    // (a jet breathing fire barely flinches: the recoil stall is the classic bus's)
    const jet = Tb.speed > F.surgeSpeed;
    if (this.barfing) targetSpeed *= jet ? 0.85 : S.stallSpeed;
    const sk = this.barfing && !jet ? 6 : Tb.rate > 0 ? Tb.rate : F.speedHz * 2.2;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-sk * dt));

    // ---- steering on a springy bungee
    const sx = inp.dragging ? inp.sx : 0;
    const vScale = clamp(Math.sqrt(F.cruiseSpeed / Math.max(this.barfing ? this.preBarfSpeed : this.speed, 4)), 0.55, 1.35);
    let yawTarget = sx * F.maxYawRate * vScale * Tb.yaw;
    if (this.barfing) {
      // the dragon plants itself to breathe: half the carve until the impact, then it eases back
      const u = clamp((this.barfT - S.impactDelay) / Math.max(0.01, S.breathSteerEase), 0, 1);
      yawTarget *= S.breathSteer + (1 - S.breathSteer) * u * u * (3 - 2 * u);
    }
    // soft push away from towers taller than we're willing to climb
    yawTarget += this.avoid(world);
    [this.yawRate, this.yawAcc] = spring(this.yawRate, this.yawAcc, yawTarget, F.bungeeHz, F.bungeeDamping, dt);
    this.heading += this.yawRate * dt;

    // ---- move
    this.x += this.fx * this.speed * dt;
    this.z += this.fz * this.speed * dt;

    // ---- altitude: look ahead along the path, rise early, hang after crests
    const look = F.altitudeLookAhead;
    let top = -1e9;
    for (let i = 0; i <= 6; i++) {
      const d = (i / 6) * this.speed * look + 6;
      // sample a little to each side so we clear wide roofs while turning
      const px = this.x + this.fx * d;
      const pz = this.z + this.fz * d;
      const ox = -this.fz * 6, oz = this.fx * 6;
      const h = Math.max(world.obstacleAt(px, pz, this.y), world.obstacleAt(px + ox, pz + oz, this.y), world.obstacleAt(px - ox, pz - oz, this.y));
      // nearer samples matter more for hard clearance
      top = Math.max(top, h - i * 0.6);
    }
    this.obstacleUnder = world.obstacleAt(this.x, this.z, this.y);
    this.groundUnder = world.groundAt(this.x, this.z);
    top = Math.max(top, this.obstacleUnder);
    const belly = F.lightLift * (1 - heavy) - F.fullSag * heavy;
    const clearance = F.clearance + belly;
    const roofFloor = top + clearance;
    // the soft ceiling's input: anything overhead (a bridge deck)
    const over = world.overheadAt ? world.overheadAt(this.x, this.z, this.y) : Infinity;
    // (a turbo gear's floor sits above the rooftops: the bus rides it like a higher roof, never into a deck)
    const floor = Math.max(roofFloor, Math.min(Tb.floor, over - 8));
    this.floorY = floor;
    // the vertical spring chases a floor whose rises are eased (a roof edge entering the look-ahead
    // steps it by whole storeys; chased raw, that kicked vy by up to 30 m/s in one frame); it falls at once
    if (Number.isNaN(this.floorRise) || floor <= this.floorRise || F.climbSmoothHz <= 0) this.floorRise = floor;
    else this.floorRise += (floor - this.floorRise) * (1 - Math.exp(-2 * Math.PI * F.climbSmoothHz * dt));
    const floorV = this.floorRise;
    const hardFloor = this.obstacleUnder + 3.5;

    // soft ceiling, lowered under a bridge deck so a climb never punches through it
    const ceil = Math.min(Tb.ceiling > F.ceiling ? Tb.ceiling : F.ceiling, over - 5);
    // the classic floor-following vertical speed (rise early, hang after crests)
    const vyFloor = (v: number) => {
      if (floorV > this.y) {
        const w = 2 * Math.PI * F.climbHz;
        return v + (w * w * (floorV - this.y) - 2 * w * v) * dt;
      }
      const want = -Math.min(F.maxSink, (this.y - floorV) * 0.9);
      return v + (want - v) * (1 - Math.exp(-1.6 * dt));
    };

    const kYoke = 1 - Math.exp(-F.yokeResponse * dt);
    let strain = 0;
    if (pull > 0 && ceil > floor + 2) {
      // ---- climb: harder pull = faster climb, fading into a struggle near the ceiling
      this.mode = Yoke.Climb;
      const room = clamp((ceil - this.y) / Math.max(1, F.ceilingSoft), 0, 1);
      strain = pull * (1 - room) * (1 - room);
      let rate = (F.climbRateMin + (F.climbRate - F.climbRateMin) * Math.pow(pull, F.climbCurve)) * Math.pow(room, 0.65) * Tb.climb;
      // the old engine sputters as the air thins: lurch, stall, lurch
      rate *= 1 - 0.55 * strain * (0.5 + 0.5 * Math.sin(this.t * Math.PI * 2 * 1.4));
      if (this.y > ceil) rate = -(this.y - ceil) * 0.8;
      this.vyYoke += (rate - this.vyYoke) * kYoke;
      this.vy = this.vyYoke;
      if (floor > this.y) this.vy = Math.max(this.vy, vyFloor(this.vy));
      this.holdY = this.y - belly;
      this.targetY = Math.max(floor, ceil);
    } else if (push > 0 && this.holdY > -1e8 && this.y > floor + 0.5) {
      // ---- dive: nose down toward the floor, fast, flaring out so it never digs into the roofs
      this.mode = Yoke.Dive;
      let rate = -F.diveRate * Math.pow(push, 1.2) * Tb.climb;
      rate = Math.max(rate, -Math.sqrt(2 * F.diveFlare * Math.max(0, this.y - floor)));
      this.vyYoke += (rate - this.vyYoke) * kYoke;
      this.vy = Math.max(this.vyYoke, -Math.sqrt(2 * F.diveFlare * Math.max(0, this.y - floor)) - 1);
      this.holdY = this.y - belly;
      this.targetY = floor;
    } else {
      if (this.mode === Yoke.Climb || this.mode === Yoke.Dive) {
        // released: coast to a stop (critically damped, no bounce back) and hold there
        const w = 2 * F.holdGain;
        this.holdY = this.y - belly + this.vy / Math.max(0.1, w);
      }
      // a dive that reached the floor (or a hold buried by rising ground for good) hands back to the floor
      if (this.holdY + belly < floor - 0.5 && (this.mode === Yoke.Dive || push > 0)) this.holdY = -Infinity;
      const hold = this.holdY + belly;
      if (hold > floor) {
        // ---- hold: the chosen altitude, with a gentle wheezy bob (fades in above the floor)
        this.mode = Yoke.Hold;
        const bob = F.bobAmp * clamp((hold - floor) / 20, 0, 1) * (Math.sin(this.t * Math.PI * 2 * F.bobHz) + 0.3 * Math.sin(this.t * Math.PI * 2 * F.bobHz * 2.7 + 1.3));
        const tgt = Math.min(hold, Math.max(ceil, floor)) + bob;
        const g = F.holdGain;
        const want = clamp((tgt - this.y) * g, -F.maxSink, F.climbRate);
        this.vy += (want - this.vy) * (1 - Math.exp(-4 * g * dt));
        if (floor > this.y) this.vy = Math.max(this.vy, vyFloor(this.vy));
        this.targetY = tgt;
      } else {
        // ---- the floor: the classic automatic rooftop skimming
        this.mode = Yoke.Floor;
        this.vy = vyFloor(this.vy);
        // (a dive released right above the roofs still flares out; the classic sink never gets this fast)
        if (this.vy < -F.maxSink) this.vy = Math.max(this.vy, -Math.sqrt(2 * F.diveFlare * Math.max(0, this.y - floor)) - F.maxSink);
        this.targetY = floor;
      }
      this.vyYoke = this.vy;
    }
    this.strain += (strain - this.strain) * (1 - Math.exp(-3 * dt));
    this.y += this.vy * dt;
    if (this.y < hardFloor) {
      this.y = hardFloor;
      if (this.vy < 0) this.vy = 0;
    }
    // height above the (smoothed) floor, for the vista camera: rooftop noise mustn't breathe the lens
    // (above the rooftops, not above a turbo gear's floor: streaming and audio read it as height)
    this.floorSmooth += (roofFloor - this.floorSmooth) * (1 - Math.exp(-0.7 * dt));
    this.lift = Math.max(0, this.y - Math.max(this.floorSmooth, this.groundUnder + clearance));
    // the broad ground: terrain around the bus (not roofs), slowly smoothed, so hills and towers don't breathe the lens
    const B = 220;
    const gb = (this.groundUnder + world.groundAt(this.x + B, this.z) + world.groundAt(this.x - B, this.z) + world.groundAt(this.x, this.z + B) + world.groundAt(this.x, this.z - B)) / 5;
    this.groundBroad = Number.isNaN(this.groundBroad) ? gb : this.groundBroad + (gb - this.groundBroad) * (1 - Math.exp(-0.5 * dt));
    this.height = Math.max(0, this.y - this.groundBroad);

    // ---- bank & pitch (visual)
    // bank: proportional to the carve, bounded (tanh), so the stretch you hold shows on the bus
    const lateral = this.speed * this.yawRate;
    const mb = Math.max(0.05, F.maxBank);
    let bankTarget = mb * Math.tanh((lateral * F.bankPerAccel + this.yawRate * F.bankPerYaw) / mb);
    // (the full-belly wallow fades as the carve takes over, so a gentle nudge still reads as a nudge)
    bankTarget += Math.sin(this.t * Math.PI * 2 * F.wallowHz) * F.wallowAmp * wallowK * (1 - Math.abs(bankTarget) / mb);
    [this.bank, this.bankVel] = spring(this.bank, this.bankVel, bankTarget, F.bankHz, F.bankDamping, dt);
    // pitch follows the climb (floored at 24 m/s: a slow bus mustn't stand on its nose); breathing rainbow,
    // the bus rears back like a dragon on an authored envelope (its own lift during the breath adds nothing)
    const climb = clamp(Math.atan2(this.vy, Math.max(this.speed, 24)) * 0.8, -0.35, 0.4);
    const rear = this.barfing ? S.rearUp * ss(0, 0.1, this.barfT) * (1 - ss(0.6, S.duration, this.barfT)) : 0;
    const pitchTarget = (this.barfing ? Math.min(climb, 0.06) : climb) + rear;
    this.pitch += (pitchTarget - this.pitch) * (1 - Math.exp(-(this.barfing ? 10 : 5) * dt));
  }

  private avoid(world: WorldQuery): number {
    const F = config.flight;
    let push = 0;
    const limit = this.y + F.avoidTallerThan;
    for (const side of [-1, 1]) {
      for (let i = 1; i <= 3; i++) {
        const d = i * Math.max(25, this.speed * 0.6);
        const ang = this.heading + side * 0.35;
        const px = this.x + Math.sin(ang) * d;
        const pz = this.z - Math.cos(ang) * d;
        const h = world.obstacleAt(px, pz, this.y);
        if (h > limit) push -= side * F.avoidStrength * (1 / i) * clamp((h - limit) / 40, 0, 1);
      }
    }
    return push;
  }
}
