import { config } from '../config';
import { angleDelta, clamp, spring } from './springs';
import { Swerve, swerveTune } from './Swerve';

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
// The path: on any dive, and on a pull with a gear or the boost, the speed goes
// where the nose points. `speed` is then the speed along the way the bus is
// going, `nose` is that way's angle, and what the climb or the dive leaves goes
// over the ground (`ground`). Whatever limits the climb or the dive turns the
// nose, so the flare is a swoop and the ceiling a level-off (docs/specs/flight/NOSE.md).
//
// School Zone (turbo.hover, docs/specs/shots/GEARS.md): the hover. Let go, the speed eases to nothing in about
// 1.5 s and the bus holds its height, bobbing like a blimp. The stick works as in every gear: sideways turns on
// the spot, up noses down and drifts forward (and down) slowly, down climbs at config.zone.climb. The rooftop
// floor, the ceiling and a deck overhead hold as anywhere; no tower pushes the yaw, since nothing is going anywhere:
// a wall it can't take in a step stops the drift short of it instead (wallAhead), and a pull climbs it. A tap's
// breath halves the turn as in every gear, and a lone flick's stroke gives its pull back as at Cruise.
//
// Curb (src/game/CurbFlight.ts, ?life): on the street ride() has the bus instead of step(), where life's lane puts it,
// and leaves everything as if it skimmed there, so step() takes it back with nothing jumping.
//
// ?swerve (src/game/Swerve.ts, docs/specs/flight/SWERVE.md): the longer stick's hard turn, the swoop and the skid, inside
// each step behind `swerve.on`. A skid's slip is the nose off `heading`, which stays the way the bus is going.
//
// shove(): a hit throws the bus (src/rivals), flown through the flight's own floors, so it can't end in a wall.
//
// heading: compass radians (0 = north = -Z, +pi/2 = east = +X).

export interface WorldQuery {
  obstacleAt(x: number, z: number, fromY?: number): number;
  groundAt(x: number, z: number): number;
  /** Lowest underside of anything overhead (a bridge deck) above fromY, or Infinity. */
  overheadAt?(x: number, z: number, fromY: number): number;
  /** What the hard floor stands on, if that differs from obstacleAt (a bridge's cable is the soft floor's alone). */
  hardAt?(x: number, z: number, fromY: number): number;
  /** Is this point inside a landmark post solid to the ground (a tower, an anchorage, a block)? */
  solidAt?(x: number, z: number): boolean;
}

export interface FlightInput {
  /** bungee stretch: x right, y up (nose down: dive / surge) / down (pull back: climb), |v| <= 1 */
  sx: number;
  sy: number;
  dragging: boolean;
  /** ?swerve (Flight.swerve): how far into the stick's hard part the thumb is (0..1), and how far past the skid's line (px of the stick's own scale: 0 and
   *  over is past), as Input says them (InputState.hard, .skid). hard NaN or left out: none of it this step */
  hard?: number;
  skid?: number;
}

/** How far under a deck's underside the floor stops (m). */
const DECK_GAP = 8;
const DEG = Math.PI / 180;
/** A throw (shove) climbs at most this fast (m/s) over what's in its way: 12 m in a frame at main.ts's slowest, 20 a second. */
const SHOVE_CLIMB = 240;
/** Under this the path counts as level (rad): nothing asking for it any more, it hands back to the classic branches here. */
const NOSE_LEVEL = 2 * DEG;

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
  /** the way the bus is going (rad, + up): on the path it flies the bus; off it, it follows where the bus really goes */
  nose = 0;
  /** on the path, the way the stick has the nose going (rad, + up; it follows at noseRate): where &boom's hoop reads the bus will be (src/game/Boom.ts).
   *  NaN off the path */
  noseTo = NaN;
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
  /** The belly refills in this many s from empty instead of config.splat.recharge, until it is full (the Hose's 3 s refill, src/game/Hose.ts); 0: the tap's. And
   *  while `pouring` it doesn't refill at all: the Hose drains it. */
  rechargeSeconds = 0;
  pouring = false;
  /** 0..1: how full the belly reads right now (drains over the breath: the release is visible as it pours out) */
  belly = 1;
  /** speed multiplier set from outside (the super splat: a charge weighs the bus down, the firehose's recoil) */
  speedScale = 1;
  /** A gear or the boost is driving the speed, or a gear is still braking out: speedScale and the firehose's kick stand aside. */
  get driven(): boolean {
    return this.turbo.speed > 0 || this.turbo.rate > 0;
  }
  private t = 0;
  private vyYoke = 0;
  /** on the path: `speed` is along it and `nose` steers it */
  private onPath = false;
  /** the path's own vertical speed (m/s): the rest of `speed` goes over the ground (a floor lifting the bus takes nothing from it) */
  private pathVy = 0;
  /** the hold before the stick last moved it (NaN: the bus was on the path, nothing to go back to), and that it goes back when the bus lets go: unpull() */
  private holdBefore = -Infinity;
  private unpulled = false;
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
    /** steering authority (x) */
    yaw: 1,
    /** 1: School Zone's hover (0: the gears) */
    hover: 0,
  };
  /** School Zone's hover is flying the bus (it was last step) */
  hovering = false;
  /** Curb's dive (CurbFlight, ?life): the road under the bus while the stick is held pushed low over it (m ASL), and the floor comes down to it,
   *  config.curb.dip over it, whatever holds it up ahead. NaN: none, the floor as ever */
  street = NaN;
  /** &boom's hoop standing over a tower in its way (src/game/Boom.ts): the floor it lifts the bus to as it closes on it (m ASL), as a turbo gear's floor
   *  does. -Infinity: none */
  hoopFloor = -Infinity;
  /** ?swerve's handling (src/game/Swerve.ts): `swerve.on` off unless the page has ?swerve; its slip, lean and hard are read by the bus's pose and the camera */
  readonly swerve = new Swerve();
  /** A hit's throw (shove()): its clock and time (s), how far (m) along (ux, uz) and how far it has gone, where it began, its arc's height (m), and the height
   *  the bus must be at this step to clear what's ahead on the rest of it in time (m ASL; -Infinity: no throw), and how much of the gear's drive it holds (0..1) */
  private readonly sh = { on: false, t: 0, air: 1, far: 0, ux: 0, uz: 0, done: 0, y0: 0, arc: 0, need: -Infinity, hold: 0 };

  /** A hit is throwing the bus (shove()). */
  get shoving(): boolean {
    return this.sh.on;
  }

  /**
   * A hit throws the bus `far` m along (ux, uz), a unit vector over the ground, in `air` s, eased in and out (src/rivals: a shell's, a ram's, a head-on's).
   * It's flown through the flight's own floors: each step looks along what's left of the throw from where the bus is, and climbs in time, at most SHOVE_CLIMB;
   * where it can't climb in time the throw waits for it. So it never puts the bus in a roof, a wall or a tree, nor lifts it more than 12 m in a frame. One
   * over 90 m arcs over the city as it goes, as the stand-in's did (12 % of its length, at most 260 m). While it lasts the gear's drive is held as far as the
   * throw goes against the bus's way, so a head-on really blows the bus back, and then the gear pulls the speed back; one from behind or across leaves the gear
   * driving. `bounds` [minX, minZ, maxX, maxZ]: it ends inside them.
   */
  shove(far: number, ux: number, uz: number, air: number, bounds?: readonly number[]) {
    const S = this.sh;
    let reach = Math.max(0, far);
    if (bounds) {
      // (no farther than where its line leaves the map, a little inside it; a bus already out there isn't thrown further out)
      const m = 50;
      if (ux > 1e-9) reach = Math.min(reach, (bounds[2] - m - this.x) / ux);
      else if (ux < -1e-9) reach = Math.min(reach, (bounds[0] + m - this.x) / ux);
      if (uz > 1e-9) reach = Math.min(reach, (bounds[3] - m - this.z) / uz);
      else if (uz < -1e-9) reach = Math.min(reach, (bounds[1] + m - this.z) / uz);
      reach = Math.max(0, reach);
    }
    S.on = reach > 0;
    S.t = 0;
    S.air = Math.max(0.05, air);
    S.far = reach;
    S.ux = ux;
    S.uz = uz;
    S.done = 0;
    S.y0 = this.y;
    S.arc = reach > 90 ? Math.min(260, reach * 0.12) : 0;
    S.need = -Infinity;
    S.hold = clamp(-(ux * this.fx + uz * this.fz), 0, 1);
  }

  get fx() {
    return Math.sin(this.heading);
  }
  get fz() {
    return -Math.cos(this.heading);
  }
  /** The speed over the ground (m/s): all of `speed`, but on the path only what the climb or the dive leaves of it. */
  get ground(): number {
    return this.onPath ? Math.sqrt(Math.max(this.speed * this.speed - this.pathVy * this.pathVy, 0)) : this.speed;
  }
  /** The bus's true velocity (m/s) into `out`. */
  velocity<T extends { set(x: number, y: number, z: number): T }>(out: T): T {
    const g = this.ground;
    return out.set(this.fx * g, this.vy, this.fz * g);
  }

  /** ?moon: the map slid by (dx, dz) under the bus (main.ts): it's where it was, by the new map. */
  slide(dx: number, dz: number) {
    this.x -= dx;
    this.z -= dz;
  }

  /** The bus comes in from a height, flying (?moonland): on the path, at this speed along this way, with the yoke's altitude where it is. */
  takeOver(x: number, y: number, z: number, heading: number, speed: number, nose: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.heading = heading;
    this.speed = speed;
    this.nose = nose;
    this.vy = this.vyYoke = this.pathVy = speed * Math.sin(nose);
    this.onPath = true;
    this.holdY = this.targetY = y;
    this.mode = Yoke.Dive;
    this.groundBroad = NaN;
    this.floorRise = NaN;
    this.pitch = nose;
    this.height = y - this.groundUnder;
  }

  /**
   * Returns true if a barf started. `min`: what the belly must hold (a tap: full; a lock's homing shot takes what the Hose left, Holds.fire). The belly then
   * refills as after a tap, whatever a pour before it set (a lock that took a hold mid-pour: the review of fd6d413, m83); a breath with its own refill sets it
   * after (the Bomb).
   */
  tryBarf(min = 0.999): boolean {
    if (this.barfT >= 0 || this.fullness < min) return false;
    this.barfT = 0;
    this.preBarfSpeed = this.speed;
    this.refund = 0;
    this.rechargeSeconds = 0;
    return true;
  }

  get barfing() {
    return this.barfT >= 0 && this.barfT < config.splat.duration;
  }

  /**
   * The stroke on the stick lifted as a flick down: a command, and it pulled until its lift said so, because steering never waits. What
   * that pull chose goes back when the bus lets go of it, so the bus goes on as it was, skimming or holding (Shifter). A stick that moves
   * first has chosen for itself.
   */
  unpull() {
    if ((this.mode === Yoke.Climb || this.mode === Yoke.Dive) && !Number.isNaN(this.holdBefore)) this.unpulled = true;
  }

  step(dt: number, inp: FlightInput, world: WorldQuery) {
    const F = config.flight;
    const S = config.splat;
    this.t += dt;
    // (?swerve: the hard turn, the swoop and the skid, from what the stick asks, before anything reads them)
    const sw = this.swerve;
    sw.pre(dt, inp, this, this.mode === Yoke.Climb || this.mode === Yoke.Dive);

    // ---- belly + barf rhythm
    this.breathClock(dt);
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
    if (pull > 0 || push > 0) this.unpulled = false;
    else if (!this.unpulled) this.holdBefore = this.onPath ? NaN : this.holdY;

    // ---- speed
    const cruise = this.glideSpeed > 0 && !inp.dragging ? this.glideSpeed : F.cruiseSpeed;
    if (inp.dragging) this.glideSpeed = 0;
    // climbing trades speed for height; nose down gains it (and surges at the floor, as ever)
    let targetSpeed = push > 0 ? cruise + (F.surgeSpeed - F.cruiseSpeed) * Math.pow(push, 1.3) : cruise + (F.climbSpeed - cruise) * pull;
    targetSpeed *= 1 - 0.12 * heavy;
    targetSpeed *= 1 + (S.reliefBoost - 1) * reliefK * reliefK;
    const Tb = this.turbo;
    // the way the stick asks for, on the path; and the plain pull is a path too (this rate up, targetSpeed forward): a pull with
    // nothing driving it flies that one there, so the boost let go comes down to the plain climb's numbers, with nothing jumping
    const noseUp = Math.min(F.noseUp, 89) * DEG, noseDown = Math.min(F.noseDown, 89) * DEG;
    let noseWant = pull > 0 ? noseUp * Math.pow(pull, F.noseCurve) : push > 0 ? -noseDown * Math.pow(push, F.noseCurve) : 0;
    const plainRate = F.climbRateMin + (F.climbRate - F.climbRateMin) * Math.pow(pull, F.climbCurve);
    if (this.onPath && pull > 0 && Tb.speed <= 0) {
      noseWant = Math.atan2(plainRate, targetSpeed);
      targetSpeed = Math.hypot(plainRate, targetSpeed);
    }
    // (?swerve: a skid scrubs the speed the flight chases, a share of the gear's or of the classic flight's, and never the gear's own)
    // (and a hit's throw holds the gear's drive while it lasts, as far as it goes against the bus's way: shove())
    const scrub = sw.sliding, kept = this.sh.on ? 1 - this.sh.hold : 1;
    const drive = (scrub && Tb.speed > 0 ? Math.max(sw.least, Tb.speed * sw.keep) : Tb.speed) * kept;
    const gearRate = scrub && Tb.speed > 0 ? Math.max(Tb.rate, swerveTune.scrubRate) : Tb.rate;
    // (all held, the speed follows at the classic flight's own rate; part held, at what lies between)
    const driveRate = kept === 1 ? gearRate : kept === 0 || !(gearRate > 0) ? 0 : F.speedHz * 2.2 + (gearRate - F.speedHz * 2.2) * kept;
    const speedScale = scrub && !(Tb.speed > 0) && !(Tb.rate > 0) ? Math.min(this.speedScale, sw.keep) : this.speedScale;
    if (drive > 0) targetSpeed = Math.max(targetSpeed, drive);
    // (a jet breathing fire barely flinches: the recoil stall is the classic bus's)
    const jet = drive > F.surgeSpeed;
    if (this.barfing) targetSpeed *= jet ? 0.85 : S.stallSpeed;
    // (the super splat's weight, recoil and limp are the classic bus's too: a gear drives through all three)
    const scaled = !this.driven && speedScale < 0.98;
    if (!this.driven) targetSpeed *= speedScale;
    // (letting go arcs the bus level with its speed kept: the classic chase takes it from there)
    if (this.onPath && pull === 0 && push === 0 && !this.driven && !this.barfing && !scaled) targetSpeed = Math.max(targetSpeed, this.speed);
    const Z = config.zone;
    const hover = Tb.hover > 0;
    if (hover) {
      // (a drift at 8 m/s is no surge: the engine hears a fifth of the push)
      this.surge = push * 0.2;
      // (the hover: the push drifts it forward, nothing else moves it; ~95 % of the way there in `settle`)
      if (this.onPath) {
        this.speed = this.ground;
        this.onPath = false;
      }
      targetSpeed = Z.drift * push * (this.barfing ? S.stallSpeed : 1);
      // (a wall ahead it can't take in a step stops the drift short of it, nose to it, as a blimp would: a pull climbs it. Without
      // this the floor's look-ahead found the tower and threw the bus up its face, 150 m in half a second at Salesforce Tower)
      if (this.speed > 0.01 || targetSpeed > 0) {
        const wall = this.wallAhead(world, Z.wallGap + Math.max(this.speed, targetSpeed) * Z.wallEase + 4);
        if (wall < Infinity) {
          const cap = Math.max(0, wall - Z.wallGap) / Math.max(0.1, Z.wallEase);
          targetSpeed = Math.min(targetSpeed, cap);
          if (this.speed > cap) this.speed += (cap - this.speed) * (1 - Math.exp(-8 * dt));
        }
      }
    }
    const sk = hover ? 3 / Math.max(0.1, Z.settle) : (this.barfing && !jet) || scaled ? 6 : driveRate > 0 ? driveRate : F.speedHz * 2.2;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-sk * dt));

    // ---- steering on a springy bungee
    const sx = inp.dragging ? inp.sx : 0;
    const vScale = clamp(Math.sqrt(F.cruiseSpeed / Math.max(this.barfing ? this.preBarfSpeed : this.speed, 4)), 0.55, 1.35);
    // (the hover turns on the spot: a full turn in config.zone.turn; a gear's authority and the breath's plant hold there too)
    let yawTarget = hover ? (sx * 2 * Math.PI) / Math.max(0.5, Z.turn) : sx * F.maxYawRate * vScale;
    // (?swerve: the hard part of the stick and the swoop over it turn harder than the gear's authority alone)
    yawTarget *= Tb.yaw * sw.gain;
    if (this.barfing) {
      // the dragon plants itself to breathe: half the carve until the impact, then it eases back
      const u = clamp((this.barfT - S.impactDelay) / Math.max(0.01, S.breathSteerEase), 0, 1);
      yawTarget *= S.breathSteer + (1 - S.breathSteer) * u * u * (3 - 2 * u);
    }
    // soft push away from towers taller than we're willing to climb (not in the hover: it stops at them, wallAhead)
    if (!hover) yawTarget += this.avoid(world);
    // (and the bungee stiffens in the hard part, so it bites at once)
    [this.yawRate, this.yawAcc] = spring(this.yawRate, this.yawAcc, yawTarget, sw.springHz(F.bungeeHz), F.bungeeDamping, dt);
    this.heading += this.yawRate * dt;

    // ---- move
    const ground = this.ground;
    this.x += this.fx * ground * dt;
    this.z += this.fz * ground * dt;
    // (a hit's throw on top, as far along it as the bus clears in time)
    const Sh = this.sh;
    if (Sh.on) this.shoveStep(dt, world);

    // ---- altitude: look ahead along the path, rise early, hang after crests
    // (`speed`, not `ground`: a swoop turns all of it forward, and the floor must already know what lies out there)
    const look = F.altitudeLookAhead;
    let top = -1e9;
    // (the hover leaves a wall out: it stops short of one, and a turn on the spot beside one mustn't throw the bus up its face)
    const wallY = hover ? this.y - F.clearance + Z.wall : Infinity;
    for (let i = 0; i <= 6; i++) {
      const d = (i / 6) * this.speed * look + 6;
      // sample a little to each side so we clear wide roofs while turning
      const px = this.x + this.fx * d;
      const pz = this.z + this.fz * d;
      const ox = -this.fz * 6, oz = this.fx * 6;
      let ha = world.obstacleAt(px, pz, this.y), hb = world.obstacleAt(px + ox, pz + oz, this.y), hc = world.obstacleAt(px - ox, pz - oz, this.y);
      if (ha > wallY) ha = -1e9;
      if (hb > wallY) hb = -1e9;
      if (hc > wallY) hc = -1e9;
      const h = Math.max(ha, hb, hc);
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
    // (a turbo gear's floor sits above the rooftops: the bus rides it like a higher roof; nothing, not a gear and not a tower
    // in the look-ahead, lifts it into a deck: what it can't climb under one, underDeck() steers it around)
    // (and Curb's dive held over a road takes it down to the street)
    // (and a hit's throw rides its arc, a long one's, and whatever it must clear in time on the rest of it: a short one has no arc, and a dive goes on down)
    const u = Sh.on ? Math.min(1, Sh.t / Sh.air) : 0, shoveFloor = Sh.on ? Math.max(Sh.arc > 0 ? Sh.y0 + Sh.arc * 4 * u * (1 - u) : -Infinity, Sh.need) : -Infinity;
    const floor = Math.min(Math.max(roofFloor, Tb.floor, this.hoopFloor, shoveFloor), over - DECK_GAP, Number.isNaN(this.street) ? Infinity : this.street + config.curb.dip);
    this.floorY = floor;
    // the vertical spring chases a floor whose rises are eased (a roof edge entering the look-ahead
    // steps it by whole storeys; chased raw, that kicked vy by up to 30 m/s in one frame); it falls at once
    if (Number.isNaN(this.floorRise) || floor <= this.floorRise || F.climbSmoothHz <= 0) this.floorRise = floor;
    else this.floorRise += (floor - this.floorRise) * (1 - Math.exp(-2 * Math.PI * F.climbSmoothHz * dt));
    const floorV = this.floorRise;
    const hardFloor = (world.hardAt ? world.hardAt(this.x, this.z, this.y) : this.obstacleUnder) + 3.5;

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
    // (a pull-out takes about the same time at any speed)
    const flare = Math.max(F.diveFlare, this.speed / Math.max(0.1, F.diveFlareT));
    const climbing = pull > 0 && ceil > floor + 2;
    const diving = push > 0 && this.holdY > -1e8 && this.y > floor + 0.5;
    const wantPath = !hover && ((climbing && Tb.speed > 0) || diving);
    if (hover && !this.hovering) {
      // into the hover: it holds the height the bus had, before a flick's own pull lifted it (Shifter: a flick down is a pull too)
      this.holdY = this.unpulled ? (Number.isNaN(this.holdBefore) ? this.y - belly : this.holdBefore > -1e8 ? this.holdBefore : floorV - belly) : this.y - belly;
      this.unpulled = false;
      // (and a pull or a dive it came in on is over: nothing coasts the hold on from here)
      if (pull === 0 && push === 0) this.mode = Yoke.Hold;
    } else if (!hover && this.hovering) {
      // out of it: holding a height, or back on the rooftops if it was riding them
      if (this.holdY + belly <= floor + 1) this.holdY = -Infinity;
      this.mode = this.holdY > -1e8 ? Yoke.Hold : Yoke.Floor;
      this.vyYoke = this.vy;
    }
    this.hovering = hover;
    if (hover) {
      // ---- School Zone: climb on the pull, sink a little on the push, else hold with the blimp's bob
      const room = clamp((ceil - this.y) / Math.max(1, F.ceilingSoft), 0, 1);
      if (pull > 0) {
        this.mode = Yoke.Climb;
        strain = pull * (1 - room) * (1 - room);
        const rate = this.y > ceil ? -(this.y - ceil) * 0.8 : Z.climb * Math.pow(pull, F.climbCurve) * Math.pow(room, 0.65);
        this.vy += (rate - this.vy) * kYoke;
        this.holdY = this.y - belly;
      } else if (push > 0) {
        this.mode = Yoke.Dive;
        this.vy += (-Z.sink * push * push - this.vy) * kYoke;
        this.holdY = this.y - belly;
      } else {
        // (a lone flick's stroke gives its pull back, here as at Cruise: Shifter.down)
        if (this.mode === Yoke.Climb || this.mode === Yoke.Dive)
          this.holdY = this.unpulled && this.holdBefore > -1e8 ? this.holdBefore : this.y - belly + this.vy / Math.max(0.1, 2 * F.holdGain);
        this.unpulled = false;
        this.mode = Yoke.Hold;
        const bob = Z.bobAmp * (Math.sin(this.t * Math.PI * 2 * Z.bobHz) + 0.35 * Math.sin(this.t * Math.PI * 2 * Z.bobHz * 2.3 + 0.9));
        const tgt = Math.min(Math.max(this.holdY + belly, floor), Math.max(ceil, floor)) + bob;
        const g = F.holdGain;
        const want = clamp((tgt - this.y) * g, -F.maxSink, Z.climb);
        this.vy += (want - this.vy) * (1 - Math.exp(-4 * g * dt));
        this.targetY = tgt;
      }
      if (floor > this.y) this.vy = Math.max(this.vy, vyFloor(this.vy));
      this.vyYoke = this.vy;
    } else if (wantPath && !this.onPath) {
      // on to the path, from the way the bus is actually going: nothing jumps
      this.nose = Math.atan2(this.vy, this.speed);
      this.speed = Math.hypot(this.speed, this.vy);
      this.pathVy = this.vy;
      this.onPath = true;
    }
    this.noseTo = this.onPath ? noseWant : NaN;
    if (this.onPath) {
      // ---- the path: the speed goes where the nose points. The nose is the only lag, so nothing lurches forward on the way
      this.nose += (noseWant - this.nose) * (1 - Math.exp(-Math.max(0.1, F.noseRate) * dt));
      const soft = Math.max(F.ceilingSoft, this.speed * F.ceilingSoftT);
      const room = clamp((ceil - this.y) / Math.max(1, soft), 0, 1);
      strain = pull * (1 - room) * (1 - room);
      const free = this.speed * Math.sin(this.nose);
      // flaring out above the floor, levelling off under the ceiling or a deck (that one wins: it can't be flown through)
      const top = this.y > ceil ? -(this.y - ceil) * 0.8 : this.speed * Math.pow(room, 0.65);
      const vy = Math.min(Math.max(free, -Math.sqrt(2 * flare * Math.max(0, this.y - floor))), top);
      // (the limit turns the nose: the bus is really going that way now, and when it lifts the nose comes back at its own pace)
      if (vy !== free) this.nose = Math.asin(clamp(vy / Math.max(this.speed, 1e-3), -1, 1));
      const was = this.vy;
      this.pathVy = this.vy = vy;
      if (floor > this.y) this.vy = Math.max(vy, vyFloor(was));
      this.vyYoke = this.vy;
      this.holdY = this.y - belly;
      this.mode = this.nose >= 0 ? Yoke.Climb : Yoke.Dive;
      this.targetY = this.nose >= 0 ? Math.max(floor, ceil) : floor;
      // level again, or down at the floor: the classic branches take over with the motion it has. (After the cap, never before it:
      // a floor that arrives all at once under a steep dive has just turned the speed forward, and the nose it found would keep a sliver.)
      if (!wantPath && (Math.abs(this.nose) < NOSE_LEVEL || (this.nose < 0 && this.y <= floor + 0.5))) {
        this.speed = this.ground;
        this.onPath = false;
      }
    } else if (hover) {
      // (the hover's, above)
    } else if (climbing) {
      // ---- climb: harder pull = faster climb, fading into a struggle near the ceiling
      this.mode = Yoke.Climb;
      const room = clamp((ceil - this.y) / Math.max(1, F.ceilingSoft), 0, 1);
      strain = pull * (1 - room) * (1 - room);
      let rate = plainRate * Math.pow(room, 0.65);
      // the old engine sputters as the air thins: lurch, stall, lurch
      rate *= 1 - 0.55 * strain * (0.5 + 0.5 * Math.sin(this.t * Math.PI * 2 * 1.4));
      if (this.y > ceil) rate = -(this.y - ceil) * 0.8;
      this.vyYoke += (rate - this.vyYoke) * kYoke;
      this.vy = this.vyYoke;
      if (floor > this.y) this.vy = Math.max(this.vy, vyFloor(this.vy));
      this.holdY = this.y - belly;
      this.targetY = Math.max(floor, ceil);
    } else {
      if (this.mode === Yoke.Climb || this.mode === Yoke.Dive) {
        // released: coast to a stop (critically damped, no bounce back) and hold there
        const w = 2 * F.holdGain;
        this.holdY = this.unpulled ? this.holdBefore : this.y - belly + this.vy / Math.max(0.1, w);
        this.unpulled = false;
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
        if (this.vy < -F.maxSink) this.vy = Math.max(this.vy, -Math.sqrt(2 * flare * Math.max(0, this.y - floor)) - F.maxSink);
        this.targetY = floor;
      }
      this.vyYoke = this.vy;
    }
    this.strain += (strain - this.strain) * (1 - Math.exp(-3 * dt));
    this.y += this.vy * dt;
    // (the underside stops a bus rising fast as it flies in under a deck; only the ground can carry it up there)
    if (this.y > over - 1) {
      this.y = over - 1;
      if (this.vy > 0) this.vy = 0;
    }
    if (this.y < hardFloor) {
      this.y = hardFloor;
      if (this.vy < 0) this.vy = 0;
    }
    // (a throw climbs over what it must clear, in time and no faster than SHOVE_CLIMB; under a deck the deck wins)
    if (Sh.on && this.y < Sh.need) {
      this.y = Math.min(Sh.need, this.y + SHOVE_CLIMB * dt, over - 1);
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

    if (!this.onPath) this.nose = Math.atan2(this.vy, this.speed);

    // ---- bank & pitch (visual)
    // bank: proportional to the carve, bounded (tanh), so the stretch you hold shows on the bus
    const lateral = this.ground * this.yawRate;
    const mb = Math.max(0.05, F.maxBank);
    let bankTarget = mb * Math.tanh((lateral * F.bankPerAccel + this.yawRate * F.bankPerYaw) / mb);
    // (the full-belly wallow fades as the carve takes over, so a gentle nudge still reads as a nudge)
    bankTarget += Math.sin(this.t * Math.PI * 2 * F.wallowHz) * F.wallowAmp * wallowK * (1 - Math.abs(bankTarget) / mb);
    // (the blimp's slow roll, out of step with its bob)
    if (hover) bankTarget += Z.swayRoll * DEG * Math.sin(this.t * Math.PI * 2 * Z.bobHz * 0.7 + 2.1);
    [this.bank, this.bankVel] = spring(this.bank, this.bankVel, bankTarget, F.bankHz, F.bankDamping, dt);
    // pitch follows the climb gently (floored at 24 m/s: a roof or a hill mustn't stand a slow bus on its nose), but on the yoke it
    // shows the way the bus is really going: all of it on the path, and on the plain pull as much as the stick is held. Breathing
    // rainbow, the bus rears back like a dragon on an authored envelope, from where it is (its own lift during the breath adds nothing)
    const gentle = clamp(Math.atan2(this.vy, Math.max(this.speed, 24)) * 0.8, -0.35, 0.4);
    const calm = this.barfing ? Math.min(gentle, 0.06) : gentle;
    const yoke = this.onPath ? 1 : this.mode === Yoke.Climb ? ss(0.1, 0.9, pull) : 0;
    const pitchMax = F.pitchMax * DEG;
    const climb = calm + (clamp(this.nose, -pitchMax, pitchMax) - calm) * yoke;
    const rear = this.barfing ? S.rearUp * ss(0, 0.1, this.barfT) * (1 - ss(0.6, S.duration, this.barfT)) : 0;
    // (the hover leans on the stick, nose down to drift and up to climb, and rocks slowly with its bob)
    const lean = hover ? (Z.leanUp * pull - Z.leanDown * push + Z.swayPitch * Math.sin(this.t * Math.PI * 2 * Z.bobHz + 1.2)) * DEG : 0;
    const pitchTarget = Math.min((hover ? lean : climb) + rear, pitchMax);
    this.pitch += (pitchTarget - this.pitch) * (1 - Math.exp(-(this.barfing ? 10 : 5) * dt));

    // (?swerve: a skid's slip grows, or its grip brings the way round to the nose)
    sw.post(dt, this);
    // (a throw is over once all of it is flown, or 2 s past its time: what's left is let go)
    if (Sh.on && (Sh.done >= Sh.far - 1e-6 || Sh.t > Sh.air + 2)) {
      Sh.on = false;
      Sh.need = -Infinity;
    }
  }

  /** One step of a hit's throw: as far along it as the bus clears by the step's end, and the height it must be at to clear the rest of it in time. */
  private shoveStep(dt: number, world: WorldQuery) {
    const S = this.sh, F = config.flight;
    S.t += dt;
    const k = Math.min(1, S.t / S.air);
    // (where the eased throw would have it by now; one held up goes on at the throw's quickest once its time is up)
    let adv = S.far * k * k * (3 - 2 * k) - S.done;
    if (S.t > S.air) adv = Math.max(adv, Math.min(S.far - S.done, ((1.5 * S.far) / S.air) * dt));
    const can = this.y + SHOVE_CLIMB * dt;
    let go = 0;
    for (let s = Math.min(3, adv); adv > 0; s = Math.min(s + 3, adv)) {
      if (this.footTop(world, this.x + S.ux * s, this.z + S.uz * s) + F.clearance > can) break;
      go = s;
      if (s >= adv) break;
    }
    this.x += S.ux * go;
    this.z += S.uz * go;
    S.done += go;
    // (what's ahead, as far as the throw goes in half a second and a bit: each at the height it must be at now to climb over it by the time it's there)
    const v = Math.max(20, S.t < S.air ? (6 * S.far * k * (1 - k)) / S.air : (1.5 * S.far) / S.air);
    const reach = Math.min(S.far - S.done, v * 0.5 + 40);
    let need = this.footTop(world, this.x, this.z) + F.clearance;
    for (let s = 6; s <= reach; s += 6) need = Math.max(need, this.footTop(world, this.x + S.ux * s, this.z + S.uz * s) + F.clearance - (SHOVE_CLIMB * s) / v);
    S.need = need;
  }

  /** The tallest thing under the bus's footprint if its middle were at (x, z): its middle and its four corners, as it heads. */
  private footTop(world: WorldQuery, x: number, z: number): number {
    const ax = this.fx * 9, az = this.fz * 9, bx = -this.fz * 2.2, bz = this.fx * 2.2, y = this.y;
    return Math.max(
      world.obstacleAt(x, z, y),
      world.obstacleAt(x + ax + bx, z + az + bz, y),
      world.obstacleAt(x + ax - bx, z + az - bz, y),
      world.obstacleAt(x - ax + bx, z - az + bz, y),
      world.obstacleAt(x - ax - bx, z - az - bz, y),
    );
  }

  /** The belly's clock: a breath runs out (its recoil up, the relief), and an empty belly fills (in rechargeSeconds after the Hose, never while it pours). */
  private breathClock(dt: number) {
    const S = config.splat;
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
    } else if (this.fullness < 1 && !this.pouring) {
      this.fullness = Math.min(1, this.fullness + dt / Math.max(0.05, this.rechargeSeconds > 0 ? this.rechargeSeconds : S.recharge));
      if (this.fullness >= 1) this.rechargeSeconds = 0;
    }
    if (this.relief > 0) this.relief = Math.max(0, this.relief - dt);
  }

  /**
   * Curb (CurbFlight): one frame on the street, instead of step(). `p` is where the bus's middle is to be (on the lane, or the arc down to it), its
   * heading and its speed along the lane; `push` is the stick's, for the engine. The heading follows on a spring, since the lane turns in 4 m steps;
   * the bus banks into a turn, pitches with the road and rears on a breath (a wheelie), and the belly's clock runs as in flight. Everything step()
   * reads is left as if the bus skimmed here (the floor, no hold, off the path, out of the hover), so step() takes it back with nothing jumping.
   */
  ride(dt: number, p: { x: number; y: number; z: number; heading: number; speed: number }, push: number, world: WorldQuery) {
    const F = config.flight, S = config.splat, C = config.curb;
    this.t += dt;
    this.breathClock(dt);
    const drain = this.barfT >= 0 ? 1 - ss(S.inhale, S.duration, this.barfT) : 1;
    this.belly = this.fullness * drain;
    const y0 = this.y;
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.vy = dt > 0 ? (p.y - y0) / dt : 0;
    const dh = angleDelta(this.heading, p.heading), k = 1 - Math.exp(-C.turnRate * dt);
    this.yawRate = dt > 0 ? (dh * k) / dt : 0;
    this.yawAcc = 0;
    this.heading += dh * k;
    this.speed = p.speed;
    this.surge = push;
    this.glideSpeed = 0;
    // (as if it skimmed here: step() finds the floor under it and no hold, off the path and out of the hover, and its floor's rise starts again)
    this.onPath = false;
    this.pathVy = 0;
    this.holdY = -Infinity;
    this.holdBefore = -Infinity;
    this.unpulled = false;
    this.hovering = false;
    this.mode = Yoke.Floor;
    this.vyYoke = this.vy;
    this.targetY = this.y;
    this.floorRise = NaN;
    this.groundUnder = world.groundAt(this.x, this.z);
    this.obstacleUnder = world.obstacleAt(this.x, this.z, this.y);
    this.street = NaN;
    this.swerve.stop();
    this.sh.on = false;
    this.sh.need = -Infinity;
    const belly = F.lightLift * (1 - this.belly) - F.fullSag * this.belly;
    this.floorY = this.obstacleUnder + F.clearance + belly;
    this.floorSmooth = this.floorY;
    this.lift = 0;
    const B = 220;
    const gb = (this.groundUnder + world.groundAt(this.x + B, this.z) + world.groundAt(this.x - B, this.z) + world.groundAt(this.x, this.z + B) + world.groundAt(this.x, this.z - B)) / 5;
    this.groundBroad = Number.isNaN(this.groundBroad) ? gb : this.groundBroad + (gb - this.groundBroad) * (1 - Math.exp(-0.5 * dt));
    this.height = Math.max(0, this.y - this.groundBroad);
    this.strain += (0 - this.strain) * (1 - Math.exp(-3 * dt));
    this.nose = Math.atan2(this.vy, Math.max(this.speed, 1));
    // (a bus on its wheels leans into a turn a little, and rides the road's grade; a breath rears it onto its back wheels)
    const mb = Math.max(0.01, C.bankMax * DEG);
    [this.bank, this.bankVel] = spring(this.bank, this.bankVel, mb * Math.tanh((this.speed * this.yawRate * C.bankPer) / mb), F.bankHz, F.bankDamping, dt);
    const grade = Math.atan2(this.vy, Math.max(this.speed, 4));
    const rear = this.barfing ? S.rearUp * ss(0, 0.1, this.barfT) * (1 - ss(0.6, S.duration, this.barfT)) : 0;
    this.pitch += (Math.min(grade + rear, F.pitchMax * DEG) - this.pitch) * (1 - Math.exp(-(this.barfing ? 10 : 5) * dt));
  }

  /** The hover's wall: how far ahead (m, out to `reach`) a roof stands that would lift the bus more than config.zone.wall, along its
   *  middle and 4 m to each side; Infinity if none. */
  private wallAhead(world: WorldQuery, reach: number): number {
    const wallY = this.y - config.flight.clearance + config.zone.wall;
    const ox = -this.fz * 4, oz = this.fx * 4;
    for (let d = 2; d <= reach; d += 2) {
      const px = this.x + this.fx * d, pz = this.z + this.fz * d;
      if (world.obstacleAt(px, pz, this.y) > wallY || world.obstacleAt(px + ox, pz + oz, this.y) > wallY || world.obstacleAt(px - ox, pz - oz, this.y) > wallY) return d;
    }
    return Infinity;
  }

  private avoid(world: WorldQuery): number {
    const F = config.flight;
    let push = 0;
    const limit = this.y + F.avoidTallerThan;
    for (const side of [-1, 1]) {
      for (let i = 1; i <= 3; i++) {
        const d = i * Math.max(25, this.ground * 0.6);
        const ang = this.heading + side * 0.35;
        const px = this.x + Math.sin(ang) * d;
        const pz = this.z - Math.cos(ang) * d;
        const h = world.obstacleAt(px, pz, this.y);
        if (h > limit) push -= side * F.avoidStrength * (1 / i) * clamp((h - limit) / 40, 0, 1);
      }
    }
    return push + this.underDeck(world);
  }

  /** Under a deck nothing can be climbed, so whatever stands up to it dead ahead is a wall: turn out for the clearer side. */
  private underDeck(world: WorldQuery): number {
    const over = world.overheadAt ? world.overheadAt(this.x, this.z, this.y) : Infinity;
    if (over === Infinity) return 0;
    const wall = over - DECK_GAP;
    // (a wall stands under the deck, or is a solid post at its edge: past the edge the air is open, and the floor climbs whatever is there)
    const ahead = (ang: number, d: number) => {
      const x = this.x + Math.sin(this.heading + ang) * d, z = this.z - Math.cos(this.heading + ang) * d;
      return (world.overheadAt!(x, z, this.y) !== Infinity || world.solidAt?.(x, z) === true) && world.obstacleAt(x, z, this.y) > wall;
    };
    for (let i = 1; i <= 3; i++) {
      const d = i * Math.max(25, this.ground * 0.6);
      if (!ahead(0, d)) continue;
      const left = ahead(-0.35, d), right = ahead(0.35, d);
      // (both ways shut, or both open: on with the turn it is in)
      return (left !== right ? (left ? 1 : -1) : this.yawRate < 0 ? -1 : 1) * config.flight.avoidStrength;
    }
    return 0;
  }
}
