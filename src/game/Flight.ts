import { config } from '../config';
import { clamp, spring } from './springs';

// The bus's body: a springy bungee steering model, automatic terrain-following
// altitude with hang time, and the struggle -> release rhythm of the belly.
//
// heading: compass radians (0 = north = -Z, +pi/2 = east = +X).

export interface WorldQuery {
  obstacleAt(x: number, z: number, fromY?: number): number;
  groundAt(x: number, z: number): number;
}

export interface FlightInput {
  /** bungee stretch: x right, y up (surge) / down (hover), |v| <= 1 */
  sx: number;
  sy: number;
  dragging: boolean;
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
  private t = 0;
  private targetAlt = 60;

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
        this.fullness = 0;
      }
    } else if (this.fullness < 1) {
      this.fullness = Math.min(1, this.fullness + dt / Math.max(0.05, S.recharge));
    }
    if (this.relief > 0) this.relief = Math.max(0, this.relief - dt);
    const reliefK = this.relief > 0 ? this.relief / S.reliefSeconds : 0;
    const heavy = this.barfT >= 0 ? 0 : this.fullness;

    // ---- speed
    const sy = inp.dragging ? inp.sy : 0;
    this.surge = Math.max(0, sy);
    const cruise = this.glideSpeed > 0 && !inp.dragging ? this.glideSpeed : F.cruiseSpeed;
    if (inp.dragging) this.glideSpeed = 0;
    let targetSpeed = sy >= 0 ? cruise + (F.surgeSpeed - F.cruiseSpeed) * Math.pow(sy, 1.3) : cruise + (F.hoverSpeed - cruise) * Math.min(1, -sy);
    targetSpeed *= 1 - 0.12 * heavy;
    targetSpeed *= 1 + (S.reliefBoost - 1) * reliefK * reliefK;
    if (this.barfing) targetSpeed *= S.stallSpeed;
    const sk = this.barfing ? 6 : F.speedHz * 2.2;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-sk * dt));

    // ---- steering on a springy bungee
    const sx = inp.dragging ? inp.sx : 0;
    const vScale = clamp(Math.sqrt(F.cruiseSpeed / Math.max(this.speed, 4)), 0.55, 1.35);
    let yawTarget = sx * F.maxYawRate * vScale;
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
    const clearance = F.clearance + F.lightLift * (1 - heavy) - F.fullSag * heavy;
    this.targetAlt = top + clearance;
    const hardFloor = this.obstacleUnder + 3.5;
    if (this.targetAlt > this.y) {
      // climb: a spring, so hills are anticipated and smooth
      const w = 2 * Math.PI * F.climbHz;
      const a = w * w * (this.targetAlt - this.y) - 2 * w * this.vy;
      this.vy += a * dt;
    } else {
      // descend gently with a capped sink rate (hang time over crests)
      const want = -Math.min(F.maxSink, (this.y - this.targetAlt) * 0.9);
      this.vy += (want - this.vy) * (1 - Math.exp(-1.6 * dt));
    }
    this.y += this.vy * dt;
    if (this.y < hardFloor) {
      this.y = hardFloor;
      if (this.vy < 0) this.vy = 0;
    }

    // ---- bank & pitch (visual)
    const lateral = this.speed * this.yawRate;
    let bankTarget = clamp(lateral * F.bankPerAccel, -F.maxBank, F.maxBank);
    bankTarget += Math.sin(this.t * Math.PI * 2 * F.wallowHz) * F.wallowAmp * heavy;
    [this.bank, this.bankVel] = spring(this.bank, this.bankVel, bankTarget, F.bankHz, F.bankDamping, dt);
    // breathing rainbow: the bus rears back like a dragon, nose up
    const pitchTarget = clamp(Math.atan2(this.vy, Math.max(this.speed, 8)) * 0.8, -0.35, 0.4) + (this.barfing ? 0.16 : 0);
    this.pitch += (pitchTarget - this.pitch) * (1 - Math.exp(-5 * dt));
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
