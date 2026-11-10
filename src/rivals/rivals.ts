import { config } from '../config';

// Rival crews' buses in the open world, and what a bus does to a bus (docs/specs/factions/RAMPAGE.md, sections 2 and 3: "Buses against buses, anywhere" and
// "Bumper buses"). No match, no circle: a few of the other crews' buses, flown by the computer, are always somewhere ahead of the player's, as the cars and the
// ferries are, painting their own colour and getting on with it. This is their brain and the rules, with no page under it: the harness flies it in Node
// (tools/rivals), and rivalsBoot.ts draws it and gives it hands.
//
//  - Who's out there. `count` buses kept ahead of the player, each of a crew that isn't the player's. Most go the player's way a little slower, so the player
//    comes up behind them as on a track ("whoever is in front gets what's coming to them"); some cross ahead, and a few come the other way. Each holds a course
//    with a slow weave and splats what it passes ('paint'). One left behind, or too far off, goes, and another comes in ahead: turn round and they're in front
//    again. Near the player they come level with it, so a ram and a shell have a line.
//  - The shell. `inFront` is the rival a tap goes for: the one nearest the nose's line within `cone` either side and `reach`. The shot itself is the shot code's
//    homing shot (Holds.fire), fired by the boot. A rival may skid out of its way in its white ('skid': a real turn, seen, and whether it gets clear is the
//    shot's own geometry: no dice past the choice to try).
//  - Fair. A rival only starts on the player with a score to settle (shot at, soaked or rammed). It honks first ('honk', `honk` s), only one hunts at a time, and
//    it lets it go after `huntFor` s or one hit. Hunting, it gets the player in front of it and fires ('shell').
//  - The ram. Two buses touch when their ways come within `ramR` of each other inside a step: looked for along the whole of the step's travel, not at its ends, so
//    it holds at 1,800 m/s. How hard goes by one thing, how fast the two came together. A bus struck in its side or tail takes all of it; nose to nose, both do.
//    Under `tiers[0]` a bump, to `tiers[1]` a smash, to `tiers[2]` a wreck, over it and nose to nose the head-on. A bus that takes it is flung `flingSec` s of
//    that speed, `flingMax` at the most, in the hitter's colours ('ram', then 'land' where it comes down).
//
// Headings are compass radians, as the flight's (0 north = -z, +pi/2 east = +x).

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Live-tunable (tuner group "Rivals", registered by the boot). */
export const rivalTune = {
  /** How many are kept near the player. */
  count: 3,
  /** One comes in this far ahead (m), further the faster the player goes (x 1 + speed / `nearPer`), within `spread` degrees of the player's way. */
  near: 200,
  far: 560,
  nearPer: 160,
  spread: 12,
  /** ...and one this far off goes, or this far behind the player (m, further at speed the same way). */
  gone: 2400,
  behind: 320,
  /** Of ten that come in, this many go the player's way and this many cross ahead; the rest come the other way. Their pace is a share of the player's
   *  speed, least to most: `paceWith` for one going the player's way, slow enough that the player comes up on it fast (Express into its tail is a smash,
   *  Jet a wreck), `pace` for the rest. Never under `crawl` m/s or over Jet's. */
  withMe: 6,
  across: 2.5,
  paceWith: [0.2, 0.45],
  pace: [0.55, 0.85],
  crawl: 9,
  /** ...and their weave either side of their course (rad). */
  weave: 0.22,
  /** Their gears' speeds (m/s) and heights over the ground (m): Cruise, Express, Nonstop, Jet. */
  speeds: [30, 112, 225, 450],
  heights: [0, 0, 60, 150],
  /** Within this far of the player (m), or `levelSec` s of the speed they're closing at, a rival comes level with it, if that's no more than `levelUp` m off
   *  its own height and over the roofs. */
  level: 450,
  levelSec: 1.6,
  levelUp: 160,
  /** Nose to nose, each within this many degrees of the other's line, a rival is drawn onto the player's line. */
  line: 9,
  /** How far over the roofs they fly (m), and how much harder than the stick's old limit they turn. */
  clear: 14,
  agile: 1.6,
  /** A roaming rival splats every this many s, this far round (m): less than a tap's, and not often. The city is the player's to paint. */
  paintEvery: 13,
  paintRadius: 55,
  /** The shell: a rival within this many degrees of the nose and this far (m) is what a tap goes for. */
  cone: 25,
  reach: 400,
  /** ...and it flies at this speed over the bus's own (m/s), turning this hard (rad/s), white-hot for its last this long (s). */
  shellSpeed: 420,
  shellTurn: 2.4,
  shellWhite: 0.5,
  /** ...and a rival's at the player turns this hard and is white this long: a hard turn then gets out of its way. */
  backTurn: 1.9,
  backWhite: 0.6,
  /** A rival tries to skid out of this share of the shells that go white on it; the skid lasts this long (s) and turns it this fast (rad/s). */
  dodge: 0.45,
  skidFor: 0.55,
  skidYaw: 2.2,
  /** A rival with a score to settle honks, and this long after (s) it hunts, for this long (s) or one hit; its shells this far apart (s). */
  honk: 1,
  huntFor: 22,
  shotEvery: 4.5,
  /** Touching: their ways within this (m), no more than this apart in height (m). A pair touches again no sooner than `ramGap` s. */
  ramR: 15,
  ramUp: 14,
  ramGap: 1.4,
  /** How fast they came together (m/s): under [0] a bump, to [1] a smash, to [2] a wreck, over it and nose to nose the head-on. */
  tiers: [60, 200, 500],
  /** A nose is into the other bus within this many degrees of its way. */
  noseDeg: 50,
  /** A bus that takes it flies this many s of that speed (m), at most this far; in the air this long by tier (s); a shell or a wave throws it this far (m). */
  flingSec: 1.5,
  flingMax: 1500,
  air: [1.4, 1.8, 2.4, 3],
  soakThrow: 70,
  /** ...and wears the hitter's colours this long after (s). */
  soakFor: 6,
};

export interface RivalWorld {
  groundAt(x: number, z: number): number;
  obstacleAt(x: number, z: number, fromY?: number): number;
}

/** The player's bus, as the rivals see it. */
export interface Me {
  x: number;
  y: number;
  z: number;
  /** the way it's going, and the way it points (rad): the same but in a skid */
  heading: number;
  nose: number;
  /** over the ground (m/s) */
  speed: number;
  faction: number;
  /** flung: nothing rams it or fires at it */
  out: boolean;
}

export const enum RState {
  Roam = 0,
  Honk = 1,
  Hunt = 2,
  Flung = 3,
}

export class Rival {
  id = 0;
  live = false;
  faction = 0;
  x = 0;
  y = 0;
  z = 0;
  /** the way it's going (rad), its speed over the ground (m/s) and its gear (a place in rivalTune.speeds) */
  heading = 0;
  speed = 0;
  gear = 0;
  /** its nose off its way in a skid (rad), and its tumble while it's flung (rad) */
  slip = 0;
  roll = 0;
  state: RState = RState.Roam;
  /** s in this state */
  t = 0;
  /** whose colours it wears (0: its own), and for how long yet (s) */
  soaked = 0;
  soakLeft = 0;
  /** it has a score to settle with the player */
  grudge = false;
  /** flung: how hard (a tier, -1 a shell's or a wave's), its velocity, and s to go */
  tier = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  airLeft = 0;
  grav = 0;
  spin = 0;
  /** a skid: s left of it, and its side */
  skidLeft = 0;
  skidDir = 1;
  /** roaming: the course it holds (rad), its pace (0 the slowest of them, 1 the quickest), that it came in going the player's way, and where its weave is */
  course = 0;
  pace = 0.5;
  along = true;
  weave = 0;
  /** s it has been left behind */
  lost = 0;
  paintIn = 0;
  shotIn = 0;
  ramIn = 0;
  /** where it was a step ago */
  px = 0;
  py = 0;
  pz = 0;
}

export type RivalEvent = 'spawn' | 'gone' | 'paint' | 'honk' | 'shell' | 'skid' | 'ram' | 'land';

/** The last ram, for the 'ram' event's listener. */
export interface Ram {
  /** 0 a bump, 1 a smash, 2 a wreck, 3 the head-on */
  tier: number;
  /** how fast the two came together (m/s) */
  closing: number;
  /** who takes it */
  me: boolean;
  it: boolean;
  /** where they met */
  x: number;
  y: number;
  z: number;
  /** the way each is thrown (unit, over the ground), and how far (m) */
  meX: number;
  meZ: number;
  itX: number;
  itZ: number;
  far: number;
}

/** The gear a bus at this speed is in (a place in rivalTune.speeds): what height it flies at. */
function gearFor(speed: number): number {
  return speed < 70 ? 0 : speed < 170 ? 1 : speed < 340 ? 2 : 3;
}

/** The stick's old limit at this speed (rad/s): Flight's yaw at full stretch, with the gears' authority. */
function yawAt(speed: number): number {
  const F = config.flight, v = Math.max(speed, 4);
  return F.maxYawRate * clamp(Math.sqrt(F.cruiseSpeed / v), 0.55, 1.35) * (v > F.surgeSpeed ? Math.pow(F.surgeSpeed / v, config.turbo.turnExp) : 1);
}

export class Rivals {
  readonly list: Rival[] = [];
  /** the one hunting the player, if any */
  hunter: Rival | null = null;
  /** false: none come in (the opening, the street's own moments), and those there fly on */
  on = true;
  readonly ram: Ram = { tier: 0, closing: 0, me: false, it: false, x: 0, y: 0, z: 0, meX: 0, meZ: 0, itX: 0, itZ: 0, far: 0 };
  onEvent: ((ev: RivalEvent, r: Rival) => void) | null = null;
  private seed: number;
  private nextFaction = 0;
  private spawnIn = 0;
  private mx = NaN;
  private my = 0;
  private mz = 0;

  constructor(seed = 0x5eed) {
    this.seed = seed >>> 0 || 1;
    for (let i = 0; i < 6; i++) {
      const r = new Rival();
      r.id = i;
      this.list.push(r);
    }
  }

  private rand(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** How many are out there. */
  get live(): number {
    let n = 0;
    for (const r of this.list) if (r.live) n++;
    return n;
  }

  /** The rival a tap goes for: nearest the nose's line, within the cone and the reach. Null: nobody in front, and the tap is the splat it always was. */
  inFront(me: Me): Rival | null {
    const T = rivalTune, cone = T.cone * DEG;
    let best: Rival | null = null, score = Infinity;
    for (const r of this.list) {
      if (!r.live || r.state === RState.Flung) continue;
      const dx = r.x - me.x, dz = r.z - me.z, d = Math.hypot(dx, dz);
      if (d > T.reach || d < 1) continue;
      const off = Math.abs(wrap(Math.atan2(dx, -dz) - me.nose));
      if (off > cone) continue;
      // (the nearest the nose's line, and of two on it the nearer)
      const s = off / cone + (0.5 * d) / T.reach;
      if (s < score) {
        score = s;
        best = r;
      }
    }
    return best;
  }

  /** The player's shell has gone white on this rival: it may try to skid out of its way. `side`: the shot comes from its left (-1) or its right (+1). */
  threat(r: Rival, side: number): void {
    const T = rivalTune;
    if (!r.live || r.state === RState.Flung || r.skidLeft > 0 || this.rand() >= T.dodge) return;
    r.skidLeft = T.skidFor;
    // (away from the shot)
    r.skidDir = side < 0 ? 1 : -1;
    this.onEvent?.('skid', r);
  }

  /** The player started on this one (a shell fired at it): it has a score to settle. */
  provoke(r: Rival): void {
    if (r.live) r.grudge = true;
  }

  /** A shell or a wave of `faction`'s lands on this rival, thrown along (dx, dz): soaked, a short throw, and a score to settle. */
  soak(r: Rival, dx: number, dz: number, faction: number): void {
    if (!r.live || r.state === RState.Flung) return;
    const l = Math.hypot(dx, dz) || 1;
    this.fling(r, dx / l, dz / l, rivalTune.soakThrow, -1, faction);
    r.grudge = true;
  }

  /** A wave of `faction`'s lands at (x, z), this far round: every rival in it is soaked. Returns how many. */
  wave(x: number, z: number, radius: number, faction: number): number {
    let n = 0;
    for (const r of this.list) {
      if (!r.live || r.state === RState.Flung) continue;
      const dx = r.x - x, dz = r.z - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      this.soak(r, dx, dz, faction);
      n++;
    }
    return n;
  }

  /** Its shell landed on the player: the score is settled. */
  settled(r: Rival): void {
    r.grudge = false;
    if (this.hunter === r) this.hunter = null;
    if (r.live && r.state === RState.Hunt) this.to(r, RState.Roam);
  }

  private to(r: Rival, s: RState): void {
    r.state = s;
    r.t = 0;
  }

  private fling(r: Rival, ux: number, uz: number, far: number, tier: number, faction: number): void {
    const T = rivalTune, air = T.air[Math.max(0, tier)], apex = clamp(far * 0.2, 14, 320);
    this.to(r, RState.Flung);
    r.tier = tier;
    r.vx = (ux * far) / air;
    r.vz = (uz * far) / air;
    r.vy = (4 * apex) / air;
    r.grav = (8 * apex) / (air * air);
    r.airLeft = air;
    // (a roll and a half for a shell, more the harder it's hit)
    r.spin = ((tier < 0 ? 1.5 : 2 + tier) * Math.PI * 2) / air;
    r.soaked = faction;
    r.soakLeft = air + T.soakFor;
    r.skidLeft = 0;
    r.slip = 0;
    if (this.hunter === r) this.hunter = null;
  }

  /** A rival's speed for a player at this speed: its pace's share (`pace` is where it stands between the least and the most), never a crawl, never over Jet's. */
  private paceSpeed(r: Rival, me: Me): number {
    const T = rivalTune, P = r.along ? T.paceWith : T.pace;
    return clamp(me.speed * (P[0] + (P[1] - P[0]) * r.pace), T.crawl, T.speeds[3]);
  }

  private spawn(me: Me, world: RivalWorld): void {
    const T = rivalTune, r = this.list.find((x) => !x.live);
    if (!r) return;
    const k = 1 + me.speed / T.nearPer, coin = this.rand() * 10, side = this.rand() < 0.5 ? -1 : 1;
    let d = (T.near + this.rand() * (T.far - T.near)) * k, b = me.heading + (this.rand() - 0.5) * 2 * T.spread * DEG;
    r.live = true;
    // (a crew that isn't the player's, each in its turn)
    do r.faction = 1 + (this.nextFaction++ % 5);
    while (r.faction === me.faction);
    r.pace = this.rand();
    r.along = coin < T.withMe;
    if (r.along) r.course = me.heading + (this.rand() - 0.5) * 2 * 10 * DEG;
    else if (coin < T.withMe + T.across) {
      // (crossing ahead: from one side of the player's way to the other)
      r.course = me.heading - side * (70 + this.rand() * 40) * DEG;
      b = me.heading + side * (12 + this.rand() * 14) * DEG;
    } else {
      // (the other way, from further off: it's here soon enough)
      r.course = me.heading + Math.PI + (this.rand() - 0.5) * 2 * 10 * DEG;
      r.pace = Math.max(r.pace, 0.6);
      d *= 1.7;
    }
    r.x = me.x + Math.sin(b) * d;
    r.z = me.z - Math.cos(b) * d;
    r.heading = r.course;
    r.weave = this.rand() * Math.PI * 2;
    r.speed = this.paceSpeed(r, me);
    r.gear = gearFor(r.speed);
    r.y = this.floor(r, world);
    r.px = r.x;
    r.py = r.y;
    r.pz = r.z;
    r.slip = r.roll = 0;
    r.soaked = 0;
    r.soakLeft = 0;
    r.grudge = false;
    r.skidLeft = 0;
    r.ramIn = 0;
    r.lost = 0;
    r.paintIn = 2 + this.rand() * T.paintEvery;
    r.shotIn = 1;
    this.to(r, RState.Roam);
    this.onEvent?.('spawn', r);
  }

  /** The lowest a rival flies here (m ASL): clear of the roofs under it and ahead of it. */
  private roofs(r: Rival, world: RivalWorld): number {
    const fx = Math.sin(r.heading), fz = -Math.cos(r.heading);
    let top = world.obstacleAt(r.x, r.z, r.y);
    for (let i = 1; i <= 3; i++) {
      const d = (i / 3) * Math.max(30, r.speed * 1.4);
      top = Math.max(top, world.obstacleAt(r.x + fx * d, r.z + fz * d, r.y));
    }
    return top + rivalTune.clear;
  }

  /** Where a rival flies (m ASL): over the roofs, and at its gear's height over the ground. */
  private floor(r: Rival, world: RivalWorld): number {
    return Math.max(this.roofs(r, world), world.groundAt(r.x, r.z) + rivalTune.heights[r.gear]);
  }

  /** One step. The player's bus as it is now (after its own step). */
  step(dt: number, me: Me, world: RivalWorld): void {
    const T = rivalTune;
    if (dt <= 0) return;
    if (Number.isNaN(this.mx)) {
      this.mx = me.x;
      this.my = me.y;
      this.mz = me.z;
    }
    // ---- who's out there
    const k = 1 + me.speed / T.nearPer, far = T.gone * k;
    let live = 0;
    for (const r of this.list) {
      if (!r.live) continue;
      const dx = r.x - me.x, dz = r.z - me.z, d = Math.hypot(dx, dz);
      // (left behind: past the player's shoulder and falling back, for a couple of seconds. One hunting the player is coming back by itself)
      const back = r.state === RState.Roam && d > T.behind * k && Math.abs(wrap(Math.atan2(dx, -dz) - me.heading)) > 100 * DEG;
      r.lost = back ? r.lost + dt : 0;
      if ((d > far || r.lost > 2) && r.state !== RState.Flung) {
        r.live = false;
        if (this.hunter === r) this.hunter = null;
        this.onEvent?.('gone', r);
        continue;
      }
      live++;
    }
    this.spawnIn -= dt;
    if (this.on && live < T.count && this.spawnIn <= 0) {
      this.spawn(me, world);
      // (the first few at once, then one at a time)
      this.spawnIn = 0.4;
    }
    // ---- the one with a score to settle honks, then hunts: one at a time
    if (this.hunter && (!this.hunter.live || this.hunter.state === RState.Flung)) this.hunter = null;
    if (!this.hunter && !me.out) {
      for (const r of this.list) {
        if (!r.live || !r.grudge || r.state !== RState.Roam) continue;
        this.hunter = r;
        this.to(r, RState.Honk);
        this.onEvent?.('honk', r);
        break;
      }
    }
    for (const r of this.list) {
      if (!r.live) continue;
      r.px = r.x;
      r.py = r.y;
      r.pz = r.z;
      r.t += dt;
      r.ramIn -= dt;
      if (r.soakLeft > 0 && (r.soakLeft -= dt) <= 0) r.soaked = 0;
      if (r.state === RState.Flung) this.fly(r, dt, me, world);
      else this.drive(r, dt, me, world);
    }
    // ---- the ram: along the whole of the step's travel
    if (!me.out) for (const r of this.list) if (r.live && r.state !== RState.Flung && r.ramIn <= 0) this.touch(r, dt, me);
    this.mx = me.x;
    this.my = me.y;
    this.mz = me.z;
  }

  /** A flung rival: thrown, tumbling, over whatever stands under it, until it comes down. */
  private fly(r: Rival, dt: number, me: Me, world: RivalWorld): void {
    r.x += r.vx * dt;
    r.z += r.vz * dt;
    r.vy -= r.grav * dt;
    r.y += r.vy * dt;
    r.roll += r.spin * dt;
    r.airLeft -= dt;
    const under = world.obstacleAt(r.x, r.z, r.y) + 4;
    if (r.y < under) {
      r.y = under;
      if (r.vy < 0) r.vy = 0;
    }
    if (r.airLeft > 0) return;
    // (down: on its way again, the way it was thrown, and it remembers)
    r.roll = 0;
    r.along = false;
    r.heading = r.course = Math.atan2(r.vx, -r.vz);
    r.speed = this.paceSpeed(r, me) * 0.5;
    r.gear = gearFor(r.speed);
    this.to(r, RState.Roam);
    r.paintIn = rivalTune.paintEvery;
    this.onEvent?.('land', r);
  }

  /** A rival flying: where it wants to go by its state, the turn it has, its speed and its height over the roofs. */
  private drive(r: Rival, dt: number, me: Me, world: RivalWorld): void {
    const T = rivalTune;
    const dxm = me.x - r.x, dzm = me.z - r.z, dm = Math.hypot(dxm, dzm), toMe = Math.atan2(dxm, -dzm);
    let want: number, speed: number;
    if (r.state === RState.Honk && r.t >= T.honk) this.to(r, RState.Hunt);
    if (r.state === RState.Hunt && r.t >= T.huntFor) {
      // (it lets it go, on the way it was going)
      r.grudge = false;
      this.hunter = null;
      r.course = r.heading;
      this.to(r, RState.Roam);
    }
    if (r.state === RState.Hunt) {
      // (at where the player will be when a shell from here gets there; as fast as the player, and faster while it's far off)
      const lead = dm / (T.shellSpeed + r.speed);
      want = Math.atan2(me.x + Math.sin(me.heading) * me.speed * lead - r.x, -(me.z - Math.cos(me.heading) * me.speed * lead - r.z));
      speed = clamp(me.speed * (dm > 350 ? 1.35 : 0.95), T.speeds[0], T.speeds[3]);
      r.shotIn -= dt;
      if (r.shotIn <= 0 && !me.out && dm < T.reach && Math.abs(wrap(toMe - r.heading)) < T.cone * DEG) {
        r.shotIn = T.shotEvery;
        this.onEvent?.('shell', r);
      }
    } else {
      // (its course, with a slow weave: a line a shell can be put on)
      r.weave += dt * 0.5;
      want = r.course + T.weave * Math.sin(r.weave);
      speed = this.paceSpeed(r, me);
      // (nose to nose with the player, each on the other's line within a few degrees: drawn onto it, or nobody would ever meet)
      const line = T.line * DEG;
      if (!me.out && dm < 2500 && Math.abs(wrap(toMe - r.heading)) < line && Math.abs(wrap(toMe + Math.PI - me.heading)) < line) want = toMe;
      if (r.state === RState.Roam && r.soaked === 0 && (r.paintIn -= dt) <= 0) {
        r.paintIn = T.paintEvery * (0.7 + 0.6 * this.rand());
        this.onEvent?.('paint', r);
      }
    }
    // ---- the turn
    let yaw: number;
    if (r.skidLeft > 0) {
      // (a skid: its way turns hard to a side and its nose leads it, as the player's does)
      r.skidLeft -= dt;
      yaw = r.skidDir * T.skidYaw;
      r.slip = r.skidLeft > 0 ? r.skidDir * 50 * DEG * Math.sin(Math.PI * clamp(1 - r.skidLeft / T.skidFor, 0, 1)) : 0;
      // (and it holds the way it comes out on)
      if (r.skidLeft <= 0) r.course = r.heading;
    } else {
      const most = yawAt(r.speed) * T.agile;
      yaw = clamp(wrap(want - r.heading) * 2.5, -most, most);
    }
    r.heading += yaw * dt;
    r.speed += (speed * (r.skidLeft > 0 ? 0.8 : 1) - r.speed) * (1 - Math.exp(-1.2 * dt));
    r.gear = gearFor(r.speed);
    r.x += Math.sin(r.heading) * r.speed * dt;
    r.z -= Math.cos(r.heading) * r.speed * dt;
    // ---- its height: over the roofs ahead at its gear's height, up at once and down slowly, never in a roof. Near the player, or closing on it fast, it
    // comes level with it, as low as the roofs allow: a ram and a shell have a line
    const roofs = this.roofs(r, world);
    let floor = Math.max(roofs, world.groundAt(r.x, r.z) + T.heights[r.gear]), rate = floor > r.y ? 4 : 1.1;
    const closing = me.speed * Math.cos(wrap(toMe + Math.PI - me.heading)) + r.speed * Math.cos(wrap(toMe - r.heading));
    if (!me.out && dm < Math.max(T.level, T.levelSec * closing) && me.y >= roofs && Math.abs(me.y - floor) < T.levelUp) {
      floor = me.y;
      rate = 4;
    }
    r.y += (floor - r.y) * (1 - Math.exp(-rate * dt));
    const hard = world.obstacleAt(r.x, r.z, r.y) + 3;
    if (r.y < hard) r.y = hard;
  }

  /** Did this rival and the player touch in the step just flown? The closest their ways came, in the rival's place relative to the player's. */
  private touch(r: Rival, dt: number, me: Me): void {
    const T = rivalTune;
    const ax = r.px - this.mx, az = r.pz - this.mz, bx = r.x - me.x, bz = r.z - me.z, sx = bx - ax, sz = bz - az, l2 = sx * sx + sz * sz;
    const uc = l2 > 1e-9 ? clamp(-(ax * sx + az * sz) / l2, 0, 1) : 0;
    if (Math.hypot(ax + sx * uc, az + sz * uc) > T.ramR) return;
    // (where they first touched, not where they came closest: two that pass nose to nose are closest side by side, and it's the first touch that says whose
    // nose was into whom)
    let u = 0;
    const a2 = ax * ax + az * az;
    if (a2 > T.ramR * T.ramR && l2 > 1e-9) {
      const bq = ax * sx + az * sz, disc = bq * bq - l2 * (a2 - T.ramR * T.ramR);
      u = disc > 0 ? clamp((-bq - Math.sqrt(disc)) / l2, 0, 1) : uc;
    }
    const cx = ax + sx * u, cz = az + sz * u, d = Math.hypot(cx, cz);
    const dy = r.py - this.my + (r.y - me.y - (r.py - this.my)) * u;
    if (Math.abs(dy) > T.ramUp) return;
    // (from the player to the rival where they met; dead centre, the way the rival came)
    let nx: number, nz: number;
    if (d > 0.5) {
      nx = cx / d;
      nz = cz / d;
    } else {
      const l = Math.sqrt(l2) || 1;
      nx = -sx / l;
      nz = -sz / l;
    }
    const closing = -((sx / dt) * nx + (sz / dt) * nz);
    // (flying along beside each other is no ram)
    if (closing < 4) return;
    const mfx = Math.sin(me.heading), mfz = -Math.cos(me.heading), rfx = Math.sin(r.heading), rfz = -Math.cos(r.heading), nose = Math.cos(T.noseDeg * DEG);
    const noseMe = me.speed > 1 && mfx * nx + mfz * nz >= nose, noseIt = r.speed > 1 && -(rfx * nx + rfz * nz) >= nose;
    const R = this.ram;
    R.closing = closing;
    R.tier = closing < T.tiers[0] ? 0 : closing < T.tiers[1] ? 1 : closing < T.tiers[2] ? 2 : noseMe && noseIt ? 3 : 2;
    // (a nose into a side or a tail: the one struck takes all of it. Nose to nose, or a brush side to side, both)
    R.me = noseIt || !noseMe;
    R.it = noseMe || !noseIt;
    if (!noseMe && !noseIt) R.tier = 0;
    R.x = this.mx + (me.x - this.mx) * u + nx * d * 0.5;
    R.z = this.mz + (me.z - this.mz) * u + nz * d * 0.5;
    R.y = this.my + (me.y - this.my) * u + dy * 0.5;
    R.far = R.tier === 0 ? 0 : Math.min(T.flingMax, T.flingSec * closing);
    // (thrown the way the bus that struck it was going; nose to nose, each back the way it came)
    if (noseMe && noseIt) {
      R.meX = -mfx;
      R.meZ = -mfz;
      R.itX = -rfx;
      R.itZ = -rfz;
    } else {
      R.meX = noseIt ? rfx : -nx;
      R.meZ = noseIt ? rfz : -nz;
      R.itX = noseMe ? mfx : nx;
      R.itZ = noseMe ? mfz : nz;
    }
    r.ramIn = T.ramGap;
    r.grudge = true;
    if (R.it) {
      if (R.tier > 0) this.fling(r, R.itX, R.itZ, R.far, R.tier, me.faction);
      else {
        // (a bump: shoved a few metres, and it wobbles)
        r.x += nx * 5;
        r.z += nz * 5;
      }
    }
    this.onEvent?.('ram', r);
  }
}
