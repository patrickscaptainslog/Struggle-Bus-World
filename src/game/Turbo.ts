import { config } from '../config';
import { mapReach } from './Ascent';
import { clamp } from './springs';
import type { Flight } from './Flight';

// Turbo gears: how the Struggle Bus will cross the Pacific (manually).
//
//   G0 "Cruise"        the classic flight: 30 m/s released, 112 m/s surging
//   G1 "Express"       112 m/s: the surge with no thumb on it. No height, no lift: it rides the rooftops
//   G2 "Nonstop"       225 m/s, about 500 mph, needs ~60 m above the ground
//   G3 "Jet"           ~450 m/s, needs ~150 m
//   G4 "Stratos"       ~4.5 km/s, needs ~2 km          } behind config.turbo.worldTravel:
//   G5 "Rainbow Warp"  ~30 km/s, needs ~10 km          } SF -> Tokyo (~8,300 km) in ~5 min
//
// Then turbo: TURBO, TURBO 2 and TURBO 3 are the rungs over the top gear in reach,
// its speed x config.turbo.levels. One flick is one rung, up or down (rung()); the
// rungs latch, turbo with them, with no thumb held. A gear's number is its place on
// this ladder: code says JET, not 3 (docs/specs/flight/THUMBS.md, "The ladder").
//
// Express is the surge latched, and comes and goes as one: at the classic rate,
// with the bus left where it was. Shifting up low into a gear with a height, the
// bus first climbs there (straining at the rung below's speed, rattling: the
// gear's floor rises under it at the gear's climb rate and Flight rides it like a
// higher roof), then the gear engages and the speed spools up; passing Mach 1 it
// booms. Shifting down out of one brakes smoothly to the lower gear and holds the
// altitude (the yoke dives back down). Turbo lifts nothing: gears lift you and
// turbo doesn't. Steering authority falls with speed. On the yoke the speed goes where
// the nose points: pull with a gear or turbo on and the bus climbs at that speed,
// up to 85 degrees; push and it dives at it (Flight's path, docs/specs/flight/NOSE.md).
// Nothing here looks at the height but a gear's engagement: going faster up
// there is a gear's job, and climbing faster is the gear's speed pointed up.
//
// The world beyond the city map doesn't exist yet: Stratos and Rainbow Warp are
// out of reach unless config.turbo.worldTravel, and near the map's edge a gear's or
// turbo's speed over the ground fades back to the surge so the (unchanged)
// map-edge homing can turn the bus around.
//
// TurboDrive writes Flight.turbo before each flight step; effects (src/fx/
// Turbo.ts), the HUD and the audio read its state and events.

export const GEAR_NAMES = ['CRUISE', 'EXPRESS', 'NONSTOP', 'JET', 'STRATOS', 'RAINBOW WARP'] as const;
/** The gears above Cruise (0), by name: their places in GEAR_NAMES. */
export const EXPRESS = 1;
export const NONSTOP = 2;
export const JET = 3;
export const STRATOS = 4;
export const WARP = 5;
export const SPEED_OF_SOUND = 343;
/** A gear is at its height this far under it (m). */
const AT_HEIGHT = 12;

/** A rung's name on the readout: the gear's, or turbo's level over it. */
export function rungName(gear: number, level: number): string {
  return level > 1 ? `TURBO ${level}` : level === 1 ? 'TURBO' : GEAR_NAMES[Math.min(gear, GEAR_NAMES.length - 1)];
}

export type TurboEvent =
  /** shifted up / down (the gear is the new one) */
  | 'up'
  | 'down'
  /** past the last rung: the top gear with all of turbo on */
  | 'locked'
  /** turbo came on or went up a level, or down one (the number is the level) */
  | 'turbo'
  | 'turbo-down'
  /** a flick up answered, and a gear waiting for the gate taken back (Shifter's, down the same path) */
  | 'flick'
  | 'back'
  /** reached the gear's height: it engages and the speed spools up */
  | 'engage'
  /** passed Mach 1 */
  | 'boom';

export function gearSpeed(g: number): number {
  const T = config.turbo;
  return g >= WARP ? T.warpSpeed : g === STRATOS ? T.stratosSpeed : g === JET ? T.jetSpeed : g === NONSTOP ? T.nonstopSpeed : config.flight.surgeSpeed;
}
export function gearAlt(g: number): number {
  const T = config.turbo;
  return g >= WARP ? T.warpAlt : g === STRATOS ? T.stratosAlt : g === JET ? T.jetAlt : g === NONSTOP ? T.nonstopAlt : 0;
}
export function gearClimb(g: number): number {
  const T = config.turbo;
  return g >= WARP ? T.warpClimb : g === STRATOS ? T.stratosClimb : g === JET ? T.jetClimb : g === NONSTOP ? T.nonstopClimb : config.flight.climbRate;
}

/** What a gear and a turbo level drive at (m/s; 0 = nothing is driving), before the map's edge has its say. */
export function driveSpeed(g: number, level: number, engaged: boolean): number {
  if (g === 0) return 0;
  const T = config.turbo;
  const lv = Math.min(level, T.levels.length);
  // (a gear still lifting drives the rung under it: the ladder is a ramp, and a hop gives no speed back)
  return gearSpeed(engaged ? g : g - 1) * (lv > 0 ? T.levels[lv - 1] : 1);
}

export class TurboDrive {
  /** the selected gear (a place in GEAR_NAMES) */
  gear = 0;
  /** the selected gear has reached its height and drives the speed */
  engaged = false;
  /** 0..1, eased: lifting to the gear's height (1), spooling up, boosting */
  strain = 0;
  /** turbo speed on a log scale: 0 at the surge, 1 at Jet's speed, more beyond */
  speedK = 0;
  /** the latched turbo's level (0: off) */
  level = 0;
  /** turbo is on */
  boosting = false;
  /** 0..1: the edge of the map is holding the gear back (1 = free) */
  edge = 1;
  /** game times of the last shift, engagement, LOCKED attempt and sonic boom (-Infinity = never), the last shift's direction */
  shiftedAt = -Infinity;
  engagedAt = -Infinity;
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

  /** The bus comes in from a height already going faster than sound (?moonland): Jet is in, and there's nothing to boom through. */
  arrive(): void {
    this.gear = JET;
    this.level = 0;
    this.engaged = true;
    this.machArmed = false;
    this.braking = false;
    this.gearFloor = -Infinity;
  }

  /** The last gear this world has, when that isn't worldTravel's to say (?moonland: the way out). The map's edge still holds them back. */
  top = 0;

  /** The last gear that can be used now. */
  get maxGear(): number {
    return this.top || (config.turbo.worldTravel ? WARP : JET);
  }

  /** The gear in has a height: a floor under the bus, a lift to it, a spool. Cruise and Express ride the rooftops. */
  get lifts(): boolean {
    return gearAlt(this.gear) > 0;
  }

  /** Turbo's levels over the top gear: none over a world's own last gear, which is its way out. */
  get levels(): number {
    return this.top ? 0 : config.turbo.levels.length;
  }

  /** The rungs above this one: the gears in reach, then turbo's levels. */
  get rungsLeft(): number {
    return this.maxGear + this.levels - this.gear - this.level;
  }

  /** The top of the ladder: the last gear in reach, with all of turbo on. */
  get topped(): boolean {
    return this.rungsLeft <= 0;
  }

  /** One rung, up or down: up the gears, then turbo's levels over the top gear; down, turbo first. False when nothing changed: LOCKED, or already Cruise. */
  rung(dir: 1 | -1, f: Flight): boolean {
    if (dir < 0) return this.boostDown() || this.shift(-1, f);
    if (this.topped) {
      // (a world's own last gear isn't locked, it's the last)
      if (this.top) return false;
      this.lockedAt = this.t;
      this.onEvent?.('locked', this.gear);
      return false;
    }
    return this.gear < this.maxGear ? this.shift(1, f) : this.boostUp();
  }

  private boostUp(): boolean {
    this.level++;
    this.shiftedAt = this.t;
    this.lastDir = 1;
    this.onEvent?.('turbo', this.level);
    return true;
  }

  private boostDown(): boolean {
    if (this.level === 0) return false;
    this.level--;
    this.shiftedAt = this.t;
    this.lastDir = -1;
    this.onEvent?.('turbo-down', this.level);
    return true;
  }

  /** Where the gear in wants the bus (m above the sea). */
  private want(f: Flight): number {
    return (Number.isFinite(f.groundBroad) ? f.groundBroad : f.groundUnder) + gearAlt(this.gear);
  }

  /** A gear up (+1) or down (-1). False when nothing changed: the top gear, or already in Cruise. */
  shift(dir: 1 | -1, f: Flight): boolean {
    if (dir > 0) {
      if (this.gear >= this.maxGear) return false;
      this.gear++;
      // (Express has no height to reach: it is in on the shift, and 'engage' stays the sound of a height reached)
      this.engaged = !this.lifts;
      this.braking = false;
      if (!Number.isFinite(this.gearFloor)) this.gearFloor = f.y; // the floor rises from where the bus is
    } else {
      if (this.gear <= 0) return false;
      // (out of Express nothing is held or braked: the surge let go, and a bus skimming the rooftops goes on skimming them)
      if (this.lifts) {
        this.braking = true;
        // hold the altitude it had: the yoke dives back down (a gear's floor dropping away would just sink it); but a gear
        // still lifting never bit: it's taken back, and with the hold untouched the bus settles to where it was, by its own sink
        if (this.engaged) f.holdY = f.y;
      }
      this.gear--;
      if (this.lifts) this.gearFloor = Math.min(this.gearFloor, f.y);
      else this.gearFloor = -Infinity;
      // (a gear the bus isn't up to yet goes on lifting, and says so when it gets there)
      this.engaged = this.gear > 0 && (!this.lifts || f.y >= this.want(f) - AT_HEIGHT);
    }
    this.shiftedAt = this.t;
    this.lastDir = dir;
    this.onEvent?.(dir > 0 ? 'up' : 'down', this.gear);
    return true;
  }

  /** Once per frame before the flight steps. */
  update(dt: number, f: Flight): void {
    const T = config.turbo;
    const F = config.flight;
    this.t += dt;
    const Tb = f.turbo;
    const g = this.gear;
    const lv = this.level;
    this.edge = T.worldTravel ? 1 : this.edgeRoom(f, lv);
    const alt = gearAlt(g);
    if (alt > 0) {
      const want = this.want(f);
      if (!Number.isFinite(this.gearFloor)) this.gearFloor = Math.min(want, f.y);
      // rises at the gear's climb rate (the bus lifts, straining); follows the ground down at once
      this.gearFloor = this.gearFloor < want ? Math.min(want, this.gearFloor + gearClimb(g) * dt) : want;
      Tb.floor = this.gearFloor;
      if (!this.engaged && f.y >= want - AT_HEIGHT) {
        this.engaged = true;
        this.engagedAt = this.t;
        this.onEvent?.('engage', g);
      }
      Tb.ceiling = g >= STRATOS ? want + alt * 0.6 : 0;
    } else {
      this.gearFloor = -Infinity;
      Tb.floor = -Infinity;
      Tb.ceiling = 0;
    }
    // lifting: the rung below's speed while it claws its way up; engaged: the gear's speed; Cruise: nothing
    let v = driveSpeed(g, lv, this.engaged);
    // (what fades is the speed over the ground: a bus going straight up keeps its gear)
    if (v > F.surgeSpeed) v = Math.min(v, (F.surgeSpeed + (v - F.surgeSpeed) * this.edge) / Math.max(0.01, f.ground / Math.max(1, f.speed)));
    Tb.speed = v;
    this.boosting = lv > 0;

    // speed: spool up into a gear; brake smoothly out of one (until the classic flight can take over); either
    // rate eases in over rateEase, so a shift never starts with a jolt (Express is the classic surge, at the classic
    // rate: the gear spool is slower, and a surge must never feel like a brake)
    let kind = 0;
    let rate = 0;
    if (alt > 0 && Tb.speed > 0 && f.speed < Tb.speed - 1) {
      kind = 1;
      rate = 3 / Math.max(0.1, T.spool);
      this.braking = false;
    } else if (this.braking || f.speed > Math.max(Tb.speed, F.surgeSpeed) * 1.02) {
      // (on a climb the classic flight settles at the plain pull's own speed, which never comes down to the level flight's)
      const classic = f.mode === 2 ? Math.hypot(F.climbRate, F.climbSpeed) : F.cruiseSpeed + (F.surgeSpeed - F.cruiseSpeed) * Math.pow(clamp(f.surge, 0, 1), 1.3);
      // (onto a rung with a height it brakes all the way there: a flick down a level has less than the 1.25 to go, and at the classic rate that's a wall)
      if (f.speed > (alt > 0 && this.edge >= 1 ? Tb.speed + 1 : Math.max(Tb.speed, classic) * 1.25)) {
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

    // steering authority falls with speed
    const sp = Math.max(1, f.speed);
    Tb.yaw = sp > F.surgeSpeed ? Math.pow(F.surgeSpeed / sp, T.turnExp) : 1;

    if (this.machArmed && f.speed > SPEED_OF_SOUND) {
      this.machArmed = false;
      this.boomAt = this.t;
      this.onEvent?.('boom', g);
    } else if (f.speed < SPEED_OF_SOUND * 0.92) this.machArmed = true;

    const lifting = g > 0 && !this.engaged;
    const spooling = Tb.speed > F.surgeSpeed && f.speed < Tb.speed * 0.9;
    const s = lifting ? 1 : spooling ? 0.7 : lv > 0 ? 0.45 : 0;
    this.strain += (s - this.strain) * (1 - Math.exp(-4 * dt));
    // (a hair over the surge is the surge: the speed settles on Express's from above for seconds, and the detail hold and the voice shouldn't wait on it)
    this.speedK = f.speed <= F.surgeSpeed * 1.005 ? 0 : Math.log(f.speed / F.surgeSpeed) / Math.log(Math.max(F.surgeSpeed * 1.01, T.jetSpeed) / F.surgeSpeed);
  }

  /** Game time (the drive's own clock, advanced by update()). */
  get time(): number {
    return this.t;
  }

  /**
   * 0..1: room left before the map ends along the heading. A gear or turbo fades back to the surge over
   * the distance its brake needs from what it is driving at, reaching it config.turbo.edgeFade past the
   * edge (where the homing starts turning the bus around); outside the map, heading back in frees it again.
   */
  private edgeRoom(f: Flight, level: number): number {
    const T = config.turbo;
    // (the edge gives way with the height, as the homing's does: main.ts, mapReach)
    const out = mapReach(f.height) - 300;
    const x0 = this.bounds[0] - out, z0 = this.bounds[1] - out, x1 = this.bounds[2] + out, z1 = this.bounds[3] + out;
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
    const reach = Math.max(200, (driveSpeed(this.gear, level, true) - config.flight.surgeSpeed) * T.brake) + T.edgeFade;
    return clamp((dist + T.edgeFade) / reach, 0, 1);
  }
}
