import { config } from '../config';
import { clamp } from './springs';
import type { Flight } from './Flight';

// Turbo gears: how the Struggle Bus will cross the Pacific (manually).
//
//   G0 "Cruise"        the classic flight: 30 m/s released, 112 m/s surging
//   G1 "Jet"           ~450 m/s, needs ~150 m above the ground
//   G2 "Stratos"       ~4.5 km/s, needs ~2 km          } behind config.turbo.worldTravel:
//   G3 "Rainbow Warp"  ~30 km/s, needs ~10 km          } SF -> Tokyo (~8,300 km) in ~5 min
//
// Shifting up low, the bus first climbs to the gear's height (straining at
// full surge, rattling: the gear's floor rises under it at the gear's climb
// rate and Flight rides it like a higher roof), then the gear engages and the
// speed spools up; passing Mach 1 it booms. Shifting down brakes smoothly to
// the lower gear and holds the altitude (the yoke dives back down). Holding
// the turbo boosts the current gear (G0: a full surge). Steering authority
// falls with speed, the yoke's climb and dive rates grow with it.
//
// The world beyond the city map doesn't exist yet: G2 / G3 are LOCKED unless
// config.turbo.worldTravel, and near the map's edge a gear's speed fades back
// to the surge so the (unchanged) map-edge homing can turn the bus around.
//
// TurboDrive writes Flight.turbo before each flight step; effects (src/fx/
// Turbo.ts), the HUD and the audio read its state and events.

export const GEAR_NAMES = ['CRUISE', 'JET', 'STRATOS', 'RAINBOW WARP'] as const;
export const SPEED_OF_SOUND = 343;

export type TurboEvent =
  /** shifted up / down (the gear is the new one) */
  | 'up'
  | 'down'
  /** tried to shift past the last usable gear */
  | 'locked'
  /** reached the gear's height: it engages and the speed spools up */
  | 'engage'
  /** passed Mach 1 */
  | 'boom';

export function gearSpeed(g: number): number {
  const T = config.turbo;
  return g >= 3 ? T.speed3 : g === 2 ? T.speed2 : g === 1 ? T.speed1 : config.flight.surgeSpeed;
}
export function gearAlt(g: number): number {
  const T = config.turbo;
  return g >= 3 ? T.alt3 : g === 2 ? T.alt2 : g === 1 ? T.alt1 : 0;
}
export function gearClimb(g: number): number {
  const T = config.turbo;
  return g >= 3 ? T.climb3 : g === 2 ? T.climb2 : g === 1 ? T.climb1 : config.flight.climbRate;
}

export class TurboDrive {
  /** the selected gear (0..3) */
  gear = 0;
  /** the selected gear has reached its height and drives the speed */
  engaged = false;
  /** 0..1, eased: lifting to the gear's height (1), spooling up, boosting */
  strain = 0;
  /** turbo speed on a log scale: 0 at the surge, 1 at G1's speed, more beyond */
  speedK = 0;
  /** the boost is held */
  boosting = false;
  /** 0..1: the edge of the map is holding the gear back (1 = free) */
  edge = 1;
  /** game times of the last shift, LOCKED attempt and sonic boom (-Infinity = never), the last shift's direction */
  shiftedAt = -Infinity;
  lockedAt = -Infinity;
  boomAt = -Infinity;
  lastDir = 0;
  onEvent: ((ev: TurboEvent, gear: number) => void) | null = null;
  private gearFloor = -Infinity;
  private braking = false;
  /** how long the current spool / brake has been running (s): its rate eases in */
  private rateT = 0;
  private rateKind = 0;
  private machArmed = true;
  private t = 0;

  /** bounds: the city map [minX, minZ, maxX, maxZ] (m) */
  constructor(private readonly bounds: readonly number[]) {}

  /** The last gear that can be used now. */
  get maxGear(): number {
    return config.turbo.worldTravel ? 3 : 1;
  }

  /** Shift up (+1) or down (-1). Returns false when nothing changed (LOCKED, or already in G0). */
  shift(dir: 1 | -1, f: Flight): boolean {
    if (dir > 0) {
      if (this.gear + 1 > this.maxGear) {
        this.lockedAt = this.t;
        this.onEvent?.('locked', this.gear + 1);
        return false;
      }
      this.gear++;
      this.engaged = false;
      this.braking = false;
      if (!Number.isFinite(this.gearFloor)) this.gearFloor = f.y; // the floor rises from where the bus is
    } else {
      if (this.gear <= 0) return false;
      this.gear--;
      this.braking = true;
      // hold the altitude it had: the yoke dives back down (a gear's floor dropping away would just sink it)
      f.holdY = f.y;
      if (this.gear === 0) this.gearFloor = -Infinity;
      else this.gearFloor = Math.min(this.gearFloor, f.y);
      this.engaged = this.gear > 0;
    }
    this.shiftedAt = this.t;
    this.lastDir = dir;
    this.onEvent?.(dir > 0 ? 'up' : 'down', this.gear);
    return true;
  }

  /** Once per frame before the flight steps. `held` = the boost (Input.state.turboHeld). */
  update(dt: number, f: Flight, held: boolean): void {
    const T = config.turbo;
    const F = config.flight;
    this.t += dt;
    const Tb = f.turbo;
    const g = this.gear;
    const ground = Number.isFinite(f.groundBroad) ? f.groundBroad : f.groundUnder;
    this.edge = T.worldTravel ? 1 : this.edgeRoom(f);
    if (g > 0) {
      const want = ground + gearAlt(g);
      if (!Number.isFinite(this.gearFloor)) this.gearFloor = Math.min(want, f.y);
      // rises at the gear's climb rate (the bus lifts, straining); follows the ground down at once
      this.gearFloor = this.gearFloor < want ? Math.min(want, this.gearFloor + gearClimb(g) * dt) : want;
      Tb.floor = this.gearFloor;
      if (!this.engaged && f.y >= want - 12) {
        this.engaged = true;
        this.onEvent?.('engage', g);
      }
      // lifting: a full surge while it claws its way up; engaged: the gear's speed
      let v = this.engaged ? gearSpeed(g) : F.surgeSpeed;
      if (held) v *= T.boost;
      if (v > F.surgeSpeed) v = F.surgeSpeed + (v - F.surgeSpeed) * this.edge;
      Tb.speed = v;
      Tb.ceiling = g >= 2 ? want + gearAlt(g) * 0.6 : 0;
    } else {
      this.gearFloor = -Infinity;
      Tb.floor = -Infinity;
      Tb.ceiling = 0;
      Tb.speed = held ? F.surgeSpeed : 0;
    }
    this.boosting = held;

    // speed: spool up into a gear; brake smoothly out of one (until the classic flight can take over); either
    // rate eases in over rateEase, so a shift never starts with a jolt
    let kind = 0;
    let rate = 0;
    if (Tb.speed > 0 && f.speed < Tb.speed - 1) {
      kind = 1;
      rate = 3 / Math.max(0.1, T.spool);
      this.braking = false;
    } else if (this.braking || f.speed > Math.max(Tb.speed, F.surgeSpeed) * 1.02) {
      const classic = F.cruiseSpeed + (F.surgeSpeed - F.cruiseSpeed) * Math.pow(clamp(f.surge, 0, 1), 1.3);
      if (f.speed > Math.max(Tb.speed, classic) * 1.25) {
        kind = 2;
        rate = 3 / Math.max(0.1, T.brake);
        this.braking = true;
      } else this.braking = false;
    }
    this.rateT = kind === this.rateKind ? this.rateT + dt : 0;
    this.rateKind = kind;
    const ease = clamp(this.rateT / Math.max(0.01, T.rateEase), 0, 1);
    // (while it eases in, the classic rate's share fades out: the hand-over is continuous both ways)
    Tb.rate = kind === 0 ? 0 : rate * (0.15 + 0.85 * ease * ease * (3 - 2 * ease));

    // steering authority falls with speed, the yoke's climb and dive grow with it
    const sp = Math.max(1, f.speed);
    Tb.yaw = sp > F.surgeSpeed ? Math.pow(F.surgeSpeed / sp, T.turnExp) : 1;
    Tb.climb = sp > F.surgeSpeed ? Math.pow(sp / F.surgeSpeed, T.climbExp) : 1;

    if (this.machArmed && f.speed > SPEED_OF_SOUND) {
      this.machArmed = false;
      this.boomAt = this.t;
      this.onEvent?.('boom', g);
    } else if (f.speed < SPEED_OF_SOUND * 0.92) this.machArmed = true;

    const lifting = g > 0 && !this.engaged;
    const spooling = Tb.speed > F.surgeSpeed && f.speed < Tb.speed * 0.9;
    const s = lifting ? 1 : spooling ? 0.7 : held ? 0.45 : 0;
    this.strain += (s - this.strain) * (1 - Math.exp(-4 * dt));
    this.speedK = f.speed <= F.surgeSpeed ? 0 : Math.log(f.speed / F.surgeSpeed) / Math.log(Math.max(F.surgeSpeed * 1.01, T.speed1) / F.surgeSpeed);
  }

  /** Game time (the drive's own clock, advanced by update()). */
  get time(): number {
    return this.t;
  }

  /**
   * 0..1: room left before the map ends along the heading. A gear fades back to the surge over the
   * distance its brake needs, reaching it config.turbo.edgeFade past the edge (where the homing
   * starts turning the bus around); outside the map, heading back in frees it again.
   */
  private edgeRoom(f: Flight): number {
    const T = config.turbo;
    const [x0, z0, x1, z1] = this.bounds;
    const fx = f.fx, fz = f.fz;
    const inside = f.x > x0 && f.x < x1 && f.z > z0 && f.z < z1;
    if (!inside) {
      const tx = (x0 + x1) / 2 - f.x, tz = (z0 + z1) / 2 - f.z;
      const l = Math.hypot(tx, tz) || 1;
      return (fx * tx + fz * tz) / l > 0.5 ? 1 : 0;
    }
    let dist = Infinity;
    if (fx > 1e-6) dist = Math.min(dist, (x1 - f.x) / fx);
    else if (fx < -1e-6) dist = Math.min(dist, (x0 - f.x) / fx);
    if (fz > 1e-6) dist = Math.min(dist, (z1 - f.z) / fz);
    else if (fz < -1e-6) dist = Math.min(dist, (z0 - f.z) / fz);
    const reach = Math.max(200, (gearSpeed(Math.max(1, this.gear)) - config.flight.surgeSpeed) * T.brake) + T.edgeFade;
    return clamp((dist + T.edgeFade) / reach, 0, 1);
  }
}
