import { config } from '../config';

// Rival crews' buses in the open world, and what a bus does to a bus (docs/specs/factions/RAMPAGE.md, sections 2 and 3: "Buses against buses, anywhere" and
// "Bumper buses"). No match, no circle. Until there's a server to put people in the sky, the other crews' buses are flown by the computer, and they fly as
// players do: the producer, on flying the first build of them, which kept three placed ahead of the player's bus at a share of its speed: "Why are these bot
// buses following me around? Can't they just act like normal players?" (2026-11-10). This is their brain and the rules, with no page under it: the harness
// flies it in Node (tools/rivals), and rivalsBoot.ts draws it and gives it hands.
//
//  - Who's out there. `count` buses in the whole city, each of a crew, each about its own business: it works a patch (flying round it at Cruise, lingering,
//    a tap every few seconds: 'paint'), then makes a trip to another patch in a gear of its own choosing, climbing to that gear's height and braking as it
//    arrives, and now and then plays on the way (a doughnut, a swoop, a dash). Where it goes next is somewhere new, or back to a patch of its own, or to where
//    somebody else has just been painting, which is how they come to meet, and how they come to the player's paint. Nothing of it reads the player's bus:
//    left alone they fly the same whatever the player does (the harness holds two flights of them against each other, to the last bit).
//  - The shell. `inFront` is the rival a tap goes for: the one nearest the nose's line within `cone` either side and `reach`. The shot itself is the shot code's
//    homing shot (Holds.fire), fired by the boot. A rival may skid out of its way in its white ('skid': a real turn, seen, and whether it gets clear is the
//    shot's own geometry: no dice past the choice to try).
//  - Each its own temper (`bold`, 0..1). One shot at, soaked or rammed has a score to settle: a bold one honks ('honk'), a second later hunts the player, gets
//    it in front of it and fires ('shell'), for `huntFor` s or one hit; a timid one makes off. And as players do, one that has had another bus in front of it
//    and in reach for a moment may take a shot at it (`mischief`), the player's or one of its own kind ('shellAt'): at the player it honks first, one shot,
//    and back to its business. Never two at the player at once.
//  - The ram. Two buses touch when their ways come within `ramR` of each other inside a step (more at speed): looked for along the whole of the step's travel,
//    not at its ends, so it holds at 1,800 m/s. How hard goes by one thing, how fast the two came together. A bus struck in its side or tail takes all of it;
//    nose to nose, both do. Under `tiers[0]` a bump, to `tiers[1]` a smash, to `tiers[2]` a wreck, over it and nose to nose the head-on. A bus that takes it
//    is flung `flingSec` s of that speed, `flingMax` at the most, in the hitter's colours ('ram', then 'land' where it comes down). Nose to nose at speed, each
//    on the other's line within `line` degrees, a rival is drawn onto the player's line and its height, or nobody would ever manage the head-on: that, and a
//    hunt, are all that ever turn one toward the player.
//
// Headings are compass radians, as the flight's (0 north = -z, +pi/2 east = +x).

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Live-tunable (tuner group "Rivals", registered by the boot). */
export const rivalTune = {
  /** How many are in the city. */
  count: 20,
  /** As the page opens, this many of them are this near the player's bus, least and most (m): somebody in sight. The rest are anywhere, and after that where
   *  any of them is is its own business. */
  startNear: 3,
  startFrom: 350,
  startTo: 1400,
  /** Their gears' speeds (m/s) and heights over the ground (m): Cruise, Express, Nonstop, Jet. */
  speeds: [28, 112, 225, 450],
  heights: [0, 0, 60, 150],
  /** How far over the roofs they fly (m), how much harder than the stick's old limit they turn, and how fast they pick speed up and lose it (1/s). */
  clear: 12,
  agile: 1.4,
  spool: 0.9,
  brake: 1.3,
  /** Painting: a patch this far round (m), worked for this long (s, least and most), a tap every this many s (least and most); one leg in `linger` of ten
   *  it hangs about, nearly still. */
  patch: 230,
  paintFor: [18, 45],
  tapEvery: [2.6, 6],
  linger: 1.5,
  /** Then a trip to another patch, this far off (m, least and most): in Express under tripExpress m, Nonstop under tripNonstop, Jet beyond; with this much
   *  weave on the way (rad). */
  trip: [450, 3600],
  tripExpress: 1200,
  tripNonstop: 2400,
  weave: 0.06,
  /** Of ten trips, this many go to where somebody else has just been painting (within `hear` m of it, no older than `heardFor` s) and this many back to a
   *  patch of its own; the rest somewhere new. */
  toPaint: 3,
  toOwn: 2,
  hear: 4000,
  heardFor: 150,
  /** One arrival in this many it plays first: a doughnut, a swoop or a dash. */
  playEvery: 3,
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
  /** A rival tries to skid out of this share of the shells that go white on it (the bold more, the timid less); the skid lasts this long (s) and turns it
   *  this fast (rad/s). */
  dodge: 0.45,
  skidFor: 0.55,
  skidYaw: 2.2,
  /** A rival with a score to settle honks, and this long after (s) it hunts, for this long (s) or one hit; its shells this far apart (s). One less bold
   *  than `timid` makes off. */
  honk: 1,
  huntFor: 22,
  shotEvery: 4.5,
  timid: 0.3,
  /** Mischief: a bus that has had another in front of it and in reach for `eyeFor` s takes a shot at it this often (0..1; the bold more), then not again for
   *  `mischiefGap` s. Between two of them only within `near` m of the player, where it's seen. */
  mischief: 0.45,
  eyeFor: 1.2,
  mischiefGap: 30,
  near: 2500,
  /** Touching: their ways within this (m), no more than this apart in height (m), each more by this much for every m/s they pass at (to 40 and 45 m). A
   *  pair touches again no sooner than `ramGap` s. */
  ramR: 15,
  ramUp: 18,
  ramRPer: 0.02,
  ramUpPer: 0.03,
  ramGap: 1.4,
  /** How fast they came together (m/s): under [0] a bump, to [1] a smash, to [2] a wreck, over it and nose to nose the head-on. */
  tiers: [60, 200, 500],
  /** A nose is into the other bus within this many degrees of its way. */
  noseDeg: 50,
  /** Nose to nose and closing at a smash's speed or more, each within this many degrees of the other's line and no more than `lineUp` m apart in height, a
   *  rival is drawn onto the player's line. */
  line: 9,
  lineUp: 160,
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
  /** the city's edges (m): [minX, minZ, maxX, maxZ]. Their patches are inside them. None: no edges */
  bounds?: readonly number[];
  /** is this place land, to paint, and not open water? None: everywhere is */
  land?(x: number, z: number): boolean;
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
  /** about its own business: Rival.act says what */
  Roam = 0,
  Honk = 1,
  Hunt = 2,
  Flung = 3,
}

/** What a rival about its own business is doing. */
export const enum Act {
  Paint = 0,
  Travel = 1,
  Play = 2,
}

export class Rival {
  id = 0;
  live = false;
  faction = 0;
  /** its temper, 0 timid to 1 bold: how readily it starts on another bus, tries a skid, plays, and whether it fights back or makes off */
  bold = 0.5;
  x = 0;
  y = 0;
  z = 0;
  /** the way it's going (rad), its speed over the ground (m/s) and its gear (a place in rivalTune.speeds) */
  heading = 0;
  speed = 0;
  gear = 0;
  /** its nose off its way in a skid (rad), its tumble while it's flung (rad), and its nose up or down (rad) */
  slip = 0;
  roll = 0;
  pitch = 0;
  state: RState = RState.Roam;
  /** s in this state */
  t = 0;
  /** about its own business: what, its patch's middle, where it's making for now, s left of this patch or this play, s to its next tap and its next leg */
  act: Act = Act.Paint;
  cx = 0;
  cz = 0;
  tx = 0;
  tz = 0;
  actLeft = 0;
  tapIn = 0;
  legIn = 0;
  /** ...the gear a trip is flown in, how many it has made, where its weave is, and that this leg it hangs about */
  tripGear = 1;
  trips = 0;
  weave = 0;
  lingering = false;
  /** ...its play (0 a doughnut, 1 a swoop, 2 a dash), how long it is in all, its side, and how far over its own height a swoop has it (m) */
  play = 0;
  playFor = 1;
  playDir = 1;
  lift = 0;
  /** its last patches, to go back to: x then z, three of them, and how many are set */
  readonly own = new Float64Array(6);
  owns = 0;
  /** whose colours it wears (0: its own), and for how long yet (s) */
  soaked = 0;
  soakLeft = 0;
  /** it has a score to settle with the player; and its honk is for one shot of mischief, not a hunt */
  grudge = false;
  oneShot = false;
  /** who it has in front of it (-1 the player, a rival's id, -2 nobody), for how long, and s until it may take a shot at somebody again */
  eye = -2;
  eyeT = 0;
  mischiefIn = 0;
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
  shotIn = 0;
  ramIn = 0;
  /** where it was a step ago */
  px = 0;
  py = 0;
  pz = 0;
}

export type RivalEvent = 'spawn' | 'paint' | 'honk' | 'shell' | 'shellAt' | 'skid' | 'ram' | 'land';

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

/** How many places fresh paint is remembered at: a patch each for the city's buses and the player's, and some over. */
const HEARD = 48;

export class Rivals {
  readonly list: Rival[] = [];
  /** the one that has started on the player (honking, hunting), if any */
  hunter: Rival | null = null;
  /** false: the city's buses aren't out yet (the opening's gate): once they are, they fly on whatever this says */
  on = true;
  readonly ram: Ram = { tier: 0, closing: 0, me: false, it: false, x: 0, y: 0, z: 0, meX: 0, meZ: 0, itX: 0, itZ: 0, far: 0 };
  /** a 'shellAt': the rival it's fired at */
  aim: Rival | null = null;
  onEvent: ((ev: RivalEvent, r: Rival) => void) | null = null;
  private seed: number;
  private seed2: number;
  private started = false;
  private clock = 0;
  private mx = NaN;
  private my = 0;
  private mz = 0;
  /** where paint has lately landed, whose, and when: x, z, the sim's clock; and the crew */
  private readonly heardAt = new Float64Array(HEARD * 3);
  private readonly heardBy = new Int8Array(HEARD);
  private heardN = 0;

  constructor(seed = 0x5eed) {
    this.seed = seed >>> 0 || 1;
    this.seed2 = (this.seed ^ 0x9e3779b9) >>> 0 || 1;
    for (let i = 0; i < 32; i++) {
      const r = new Rival();
      r.id = i;
      this.list.push(r);
    }
  }

  /** The dice of their own business: where to next, how long, which play. */
  private rand(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** The dice of what passes between buses (a shot of mischief, a skid out of a shell's way): a stream of its own, so that who happens to be near never
   *  changes what any of them does about its own business. */
  private chance(): number {
    let t = (this.seed2 = (this.seed2 + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private between(p: readonly number[]): number {
    return p[0] + this.rand() * (p[1] - p[0]);
  }

  /** How many are out there. */
  get live(): number {
    let n = 0;
    for (const r of this.list) if (r.live) n++;
    return n;
  }

  /** The rival a tap goes for: nearest the nose's line, within the cone and the reach, and not of the player's own crew. Null: nobody in front, and the tap
   *  is the splat it always was. */
  inFront(me: Me): Rival | null {
    const T = rivalTune, cone = T.cone * DEG;
    let best: Rival | null = null, score = Infinity;
    for (const r of this.list) {
      if (!r.live || r.state === RState.Flung || r.faction === me.faction) continue;
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

  /** Paint has just landed at (x, z), this crew's (the player's own taps, from the boot; a rival's, from here): another crew's bus may come and see about it. */
  heard(x: number, z: number, faction: number): void {
    // (more of the same crew's within a patch's width is the same news, fresher; else it takes a free place, or the oldest's)
    let i = -1, same = false, oldest = Infinity;
    for (let k = 0; k < this.heardN && !same; k++) {
      if (this.heardBy[k] === faction && Math.hypot(this.heardAt[k * 3] - x, this.heardAt[k * 3 + 1] - z) < 200) {
        i = k;
        same = true;
      } else if (this.heardAt[k * 3 + 2] < oldest) {
        oldest = this.heardAt[k * 3 + 2];
        i = k;
      }
    }
    if (!same && this.heardN < HEARD) i = this.heardN++;
    this.heardAt[i * 3] = x;
    this.heardAt[i * 3 + 1] = z;
    this.heardAt[i * 3 + 2] = this.clock;
    this.heardBy[i] = faction;
  }

  /** A shell has gone white on this rival: it may try to skid out of its way. `side`: the shot comes from its left (-1) or its right (+1). */
  threat(r: Rival, side: number): void {
    const T = rivalTune;
    if (!r.live || r.state === RState.Flung || r.skidLeft > 0 || this.chance() >= T.dodge * (0.5 + r.bold)) return;
    r.skidLeft = T.skidFor;
    // (away from the shot)
    r.skidDir = side < 0 ? 1 : -1;
    this.onEvent?.('skid', r);
  }

  /** The player started on this one (a shell fired at it): it has a score to settle. */
  provoke(r: Rival): void {
    if (r.live) r.grudge = true;
  }

  /** A shell or a wave of `faction`'s lands on this rival, thrown along (dx, dz): soaked, and a short throw. The player's (`mine`), and it has a score to
   *  settle. */
  soak(r: Rival, dx: number, dz: number, faction: number, mine = true): void {
    if (!r.live || r.state === RState.Flung) return;
    const l = Math.hypot(dx, dz) || 1;
    this.fling(r, dx / l, dz / l, rivalTune.soakThrow, -1, faction);
    if (mine) r.grudge = true;
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

  /** Its shell landed on the player: the score is settled, and it goes back to what it was about. */
  settled(r: Rival): void {
    r.grudge = false;
    if (this.hunter === r) this.hunter = null;
    if (r.live && r.state === RState.Hunt) this.home(r);
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
    r.lift = 0;
    r.oneShot = false;
    if (this.hunter === r) this.hunter = null;
  }

  // ---------------------------------------------------------------- their own business

  /** Is (x, z) a place to paint: inside the city's edges, and land? */
  private fine(x: number, z: number, world: RivalWorld): boolean {
    const b = world.bounds;
    if (b && (x < b[0] + 200 || z < b[1] + 200 || x > b[2] - 200 || z > b[3] - 200)) return false;
    return world.land ? world.land(x, z) : true;
  }

  /** A patch begins where the bus is making for: it works it for a while. */
  private settle(r: Rival, x: number, z: number): void {
    const T = rivalTune;
    r.act = Act.Paint;
    r.cx = r.tx = x;
    r.cz = r.tz = z;
    r.actLeft = this.between(T.paintFor);
    r.tapIn = this.between(T.tapEvery) * 0.5;
    r.legIn = 0;
    r.lingering = false;
    // (and remembers it, the last three)
    const i = r.owns % 3;
    r.own[i * 2] = x;
    r.own[i * 2 + 1] = z;
    r.owns++;
  }

  /** A trip to (x, z), in the gear its length asks. */
  private trip(r: Rival, x: number, z: number): void {
    const T = rivalTune, d = Math.hypot(x - r.x, z - r.z);
    r.act = Act.Travel;
    r.tx = x;
    r.tz = z;
    r.tripGear = d < T.tripExpress ? 1 : d < T.tripNonstop ? 2 : 3;
    r.lingering = false;
  }

  /** Back to what it was about, after a fight or a throw: to its patch, if it has gone far from it. */
  private home(r: Rival): void {
    this.to(r, RState.Roam);
    r.oneShot = false;
    if (Math.hypot(r.cx - r.x, r.cz - r.z) > rivalTune.patch * 1.5) this.trip(r, r.cx, r.cz);
    else {
      r.act = Act.Paint;
      r.actLeft = Math.max(r.actLeft, 8);
      r.legIn = 0;
    }
  }

  /** Its patch is done: where next? Where somebody else has just been painting, a patch of its own, or somewhere new. */
  private depart(r: Rival, world: RivalWorld): void {
    const T = rivalTune, coin = this.rand() * 10;
    if (coin < T.toPaint) {
      // (fresh paint of another crew's that it can hear of: any of it, one as likely as another)
      let best = -1, n = 0;
      for (let i = 0; i < this.heardN; i++) {
        if (this.heardBy[i] === r.faction || this.clock - this.heardAt[i * 3 + 2] > T.heardFor) continue;
        const d = Math.hypot(this.heardAt[i * 3] - r.x, this.heardAt[i * 3 + 1] - r.z);
        if (d > T.hear || d < T.patch) continue;
        if (this.rand() * ++n < 1) best = i;
      }
      if (best >= 0) {
        const a = this.rand() * Math.PI * 2, o = 120 * Math.sqrt(this.rand());
        return this.trip(r, this.heardAt[best * 3] + Math.sin(a) * o, this.heardAt[best * 3 + 1] - Math.cos(a) * o);
      }
    } else if (coin < T.toPaint + T.toOwn && r.owns > 1) {
      // (one of its own, not the one it's on)
      const n = Math.min(3, r.owns), i = (r.owns - 1 + 1 + Math.floor(this.rand() * (n - 1))) % n;
      return this.trip(r, r.own[i * 2], r.own[i * 2 + 1]);
    }
    for (let k = 0; k < 10; k++) {
      const a = this.rand() * Math.PI * 2, d = this.between(T.trip), x = r.x + Math.sin(a) * d, z = r.z - Math.cos(a) * d;
      if (this.fine(x, z, world)) return this.trip(r, x, z);
    }
    // (nowhere found, at the city's edge or over the water: back toward the middle of the map, or on with this patch)
    const b = world.bounds;
    if (b) this.trip(r, r.x + ((b[0] + b[2]) / 2 - r.x) * 0.3, r.z + ((b[1] + b[3]) / 2 - r.z) * 0.3);
    else r.actLeft = this.between(T.paintFor);
  }

  /** The city's buses, as the page opens: anywhere in it, each at a patch it's part way through, and a few near the player's bus. */
  private start(me: Me, world: RivalWorld): void {
    const T = rivalTune, b = world.bounds;
    let f = 0;
    for (let i = 0; i < Math.min(T.count, this.list.length); i++) {
      const r = this.list[i];
      let x = me.x, z = me.z;
      for (let k = 0; k < 12; k++) {
        if (i < T.startNear || !b) {
          const a = this.rand() * Math.PI * 2, d = i < T.startNear ? T.startFrom + this.rand() * (T.startTo - T.startFrom) : 600 + this.rand() * 6000;
          x = me.x + Math.sin(a) * d;
          z = me.z - Math.cos(a) * d;
        } else {
          x = b[0] + this.rand() * (b[2] - b[0]);
          z = b[1] + this.rand() * (b[3] - b[1]);
        }
        if (this.fine(x, z, world)) break;
      }
      r.live = true;
      // (the crews in turn, the player's own left out)
      do r.faction = 1 + (f++ % 5);
      while (r.faction === me.faction);
      r.bold = this.rand();
      r.x = x;
      r.z = z;
      r.heading = this.rand() * Math.PI * 2;
      r.speed = T.speeds[0];
      r.gear = 0;
      r.slip = r.roll = r.pitch = r.lift = 0;
      r.soaked = 0;
      r.soakLeft = 0;
      r.grudge = r.oneShot = false;
      r.skidLeft = 0;
      r.ramIn = 0;
      r.shotIn = 1;
      r.eye = -2;
      r.eyeT = 0;
      r.mischiefIn = this.rand() * T.mischiefGap;
      r.trips = Math.floor(this.rand() * 3);
      r.weave = this.rand() * Math.PI * 2;
      r.owns = 0;
      this.to(r, RState.Roam);
      this.settle(r, x, z);
      r.actLeft *= this.rand();
      r.y = world.obstacleAt(x, z, 1e9) + T.clear;
      r.px = r.x;
      r.py = r.y;
      r.pz = r.z;
      this.onEvent?.('spawn', r);
    }
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

  /** One step. The player's bus as it is now (after its own step). */
  step(dt: number, me: Me, world: RivalWorld): void {
    if (dt <= 0) return;
    if (!this.started) {
      if (!this.on) return;
      this.started = true;
      this.start(me, world);
    }
    this.clock += dt;
    if (Number.isNaN(this.mx)) {
      this.mx = me.x;
      this.my = me.y;
      this.mz = me.z;
    }
    // ---- the one with a score to settle starts on the player, or makes off: one at a time
    if (this.hunter && (!this.hunter.live || this.hunter.state === RState.Flung || this.hunter.state === RState.Roam)) this.hunter = null;
    for (const r of this.list) {
      if (!r.live || !r.grudge || r.state !== RState.Roam) continue;
      if (r.bold < rivalTune.timid) {
        // (a timid one: off, the way that's away from the player, in a hurry)
        r.grudge = false;
        const dx = r.x - me.x, dz = r.z - me.z, l = Math.hypot(dx, dz) || 1;
        this.trip(r, r.x + (dx / l) * 1500, r.z + (dz / l) * 1500);
        r.tripGear = 2;
      } else if (!this.hunter && !me.out) {
        this.hunter = r;
        r.oneShot = false;
        this.to(r, RState.Honk);
        this.onEvent?.('honk', r);
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
      if (r.state === RState.Flung) this.fly(r, dt, world);
      else this.drive(r, dt, me, world);
    }
    // ---- the ram: along the whole of the step's travel
    if (!me.out) for (const r of this.list) if (r.live && r.state !== RState.Flung && r.ramIn <= 0) this.touch(r, dt, me);
    this.mx = me.x;
    this.my = me.y;
    this.mz = me.z;
  }

  /** A flung rival: thrown, tumbling, over whatever stands under it, until it comes down, and goes back to what it was about. */
  private fly(r: Rival, dt: number, world: RivalWorld): void {
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
    r.roll = 0;
    r.heading = Math.atan2(r.vx, -r.vz);
    r.speed = rivalTune.speeds[0] * 0.5;
    r.gear = 0;
    this.home(r);
    this.onEvent?.('land', r);
  }

  /** Who a rival has in front of it and in reach: the player (-1), another crew's bus (its id), or nobody (-2). Its own crew's it leaves alone. */
  private ahead(r: Rival, me: Me): number {
    const T = rivalTune, cone = T.cone * DEG;
    let best = -2, score = Infinity;
    const near = Math.hypot(me.x - r.x, me.z - r.z);
    if (!me.out && me.faction !== r.faction && near < T.reach && near > 1 && !this.hunter) {
      const off = Math.abs(wrap(Math.atan2(me.x - r.x, -(me.z - r.z)) - r.heading));
      if (off < cone) {
        best = -1;
        score = off / cone + (0.5 * near) / T.reach;
      }
    }
    // (between two of them, only where the player would see it)
    if (near < T.near)
      for (const o of this.list) {
        if (o === r || !o.live || o.state === RState.Flung || o.faction === r.faction) continue;
        const dx = o.x - r.x, dz = o.z - r.z, d = Math.hypot(dx, dz);
        if (d > T.reach || d < 1) continue;
        const off = Math.abs(wrap(Math.atan2(dx, -dz) - r.heading));
        if (off > cone) continue;
        const s = off / cone + (0.5 * d) / T.reach;
        if (s < score) {
          score = s;
          best = o.id;
        }
      }
    return best;
  }

  /** A rival flying: where it wants to go by what it's about, the turn it has, its speed and its height over the roofs. */
  private drive(r: Rival, dt: number, me: Me, world: RivalWorld): void {
    const T = rivalTune;
    const dxm = me.x - r.x, dzm = me.z - r.z, dm = Math.hypot(dxm, dzm), toMe = Math.atan2(dxm, -dzm);
    let want = r.heading, speed = T.speeds[0], yawPlay = NaN;
    if (r.state === RState.Honk && r.t >= T.honk) {
      if (r.oneShot) {
        // (its one shot of mischief, if the player is still in front of it; then back to what it was about)
        if (!me.out && dm < T.reach && Math.abs(wrap(toMe - r.heading)) < T.cone * DEG) this.onEvent?.('shell', r);
        this.hunter = null;
        this.home(r);
      } else this.to(r, RState.Hunt);
    }
    if (r.state === RState.Hunt && r.t >= T.huntFor) {
      // (it lets it go)
      r.grudge = false;
      this.hunter = null;
      this.home(r);
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
    } else if (r.state === RState.Honk) {
      // (honking, on the way it was going)
    } else if (r.act === Act.Paint) {
      // ---- its patch: round it in legs, lingering on some, a tap every few seconds
      r.actLeft -= dt;
      r.legIn -= dt;
      if (r.actLeft <= 0) this.depart(r, world);
      else {
        if (r.legIn <= 0 || Math.hypot(r.tx - r.x, r.tz - r.z) < 35) {
          const a = this.rand() * Math.PI * 2, d = T.patch * Math.sqrt(this.rand());
          r.tx = r.cx + Math.sin(a) * d;
          r.tz = r.cz - Math.cos(a) * d;
          r.legIn = 4 + this.rand() * 5;
          r.lingering = this.rand() * 10 < T.linger;
        }
        want = Math.atan2(r.tx - r.x, -(r.tz - r.z));
        speed = r.lingering ? 7 : T.speeds[0];
        if (r.soaked === 0 && (r.tapIn -= dt) <= 0) {
          r.tapIn = this.between(T.tapEvery);
          this.heard(r.x + Math.sin(r.heading) * 30, r.z - Math.cos(r.heading) * 30, r.faction);
          this.onEvent?.('paint', r);
        }
      }
    }
    if (r.state === RState.Roam && r.act === Act.Travel) {
      // ---- a trip: in its gear until it's time to brake, then its patch, or a moment's play first
      const d = Math.hypot(r.tx - r.x, r.tz - r.z);
      r.weave += dt * 0.6;
      want = Math.atan2(r.tx - r.x, -(r.tz - r.z)) + T.weave * Math.sin(r.weave);
      speed = d < (r.speed - T.speeds[0]) / T.brake + 90 ? T.speeds[0] : T.speeds[r.tripGear];
      if (d < 90) {
        r.trips++;
        if (r.trips % Math.max(1, Math.round(T.playEvery / (0.5 + r.bold))) === 0) {
          r.act = Act.Play;
          r.play = Math.floor(this.rand() * 3);
          r.playFor = r.actLeft = r.play === 0 ? 2.6 : r.play === 1 ? 3.6 : 5;
          r.playDir = this.rand() < 0.5 ? -1 : 1;
          r.cx = r.tx;
          r.cz = r.tz;
        } else this.settle(r, r.tx, r.tz);
      }
    } else if (r.state === RState.Roam && r.act === Act.Play) {
      // ---- play: a doughnut on the spot, a swoop up and over, or a dash down the street; then its patch
      r.actLeft -= dt;
      const u = clamp(1 - r.actLeft / r.playFor, 0, 1);
      if (r.play === 0) {
        yawPlay = r.playDir * 2.4;
        r.slip = r.playDir * 55 * DEG * Math.sin(Math.PI * u);
        speed = 18;
      } else if (r.play === 1) {
        r.lift = 90 * Math.sin(Math.PI * u);
        yawPlay = u > 0.3 && u < 0.7 ? (r.playDir * Math.PI) / (0.4 * r.playFor) : 0;
      } else {
        speed = T.speeds[1];
        // (a dash stops short of the city's edge)
        const b = world.bounds, ax = r.x + Math.sin(r.heading) * 250, az = r.z - Math.cos(r.heading) * 250;
        if (b && (ax < b[0] || az < b[1] || ax > b[2] || az > b[3])) r.actLeft = 0;
      }
      if (r.actLeft <= 0) {
        r.slip = 0;
        r.lift = 0;
        this.settle(r, r.cx, r.cz);
      }
    }
    // ---- mischief: somebody in front of it and in reach, for a moment
    if (r.state === RState.Roam && r.soaked === 0 && (r.mischiefIn -= dt) <= 0) {
      const who = this.ahead(r, me);
      if (who !== r.eye) {
        r.eye = who;
        r.eyeT = 0;
      } else if (who !== -2 && (r.eyeT += dt) >= T.eyeFor) {
        r.eyeT = 0;
        if (this.chance() < T.mischief * (0.4 + 1.2 * r.bold)) {
          r.mischiefIn = T.mischiefGap;
          if (who === -1) {
            // (at the player: its honk first, one shot, and back to its business)
            this.hunter = r;
            r.oneShot = true;
            this.to(r, RState.Honk);
            this.onEvent?.('honk', r);
          } else {
            this.aim = this.list[who];
            this.onEvent?.('shellAt', r);
          }
        } else r.mischiefIn = 6;
      }
    }
    // ---- nose to nose with the player at speed, each on the other's line within a few degrees: drawn onto it, or nobody would ever meet
    const line = T.line * DEG, offIt = wrap(toMe - r.heading), offMe = wrap(toMe + Math.PI - me.heading);
    const jousting = !me.out && dm < 2500 && Math.abs(me.y - r.y) < T.lineUp && Math.abs(offIt) < line && Math.abs(offMe) < line && me.speed * Math.cos(offMe) + r.speed * Math.cos(offIt) >= T.tiers[1];
    if (jousting) want = toMe;
    // ---- the turn
    let yaw: number;
    if (r.skidLeft > 0) {
      // (a skid: its way turns hard to a side and its nose leads it, as the player's does)
      r.skidLeft -= dt;
      yaw = r.skidDir * T.skidYaw;
      r.slip = r.skidLeft > 0 ? r.skidDir * 50 * DEG * Math.sin(Math.PI * clamp(1 - r.skidLeft / T.skidFor, 0, 1)) : 0;
    } else if (!Number.isNaN(yawPlay) && !jousting) yaw = yawPlay;
    else {
      const most = yawAt(r.speed) * T.agile;
      yaw = clamp(wrap(want - r.heading) * 2.5, -most, most);
    }
    r.heading += yaw * dt;
    r.speed += (speed * (r.skidLeft > 0 ? 0.8 : 1) - r.speed) * (1 - Math.exp(-(speed > r.speed ? T.spool : T.brake) * dt));
    r.gear = gearFor(r.speed);
    r.x += Math.sin(r.heading) * r.speed * dt;
    r.z -= Math.cos(r.heading) * r.speed * dt;
    // ---- its height: over the roofs ahead at its gear's height, up at once and down slowly, never in a roof; jousting, level with the player
    const roofs = this.roofs(r, world), was = r.y;
    let floor = Math.max(roofs, world.groundAt(r.x, r.z) + T.heights[r.gear]) + r.lift, rate = floor > r.y ? 3 : 1.1;
    if (jousting && me.y >= roofs) {
      floor = me.y;
      rate = 4;
    }
    r.y += (floor - r.y) * (1 - Math.exp(-rate * dt));
    const hard = world.obstacleAt(r.x, r.z, r.y) + 3;
    if (r.y < hard) r.y = hard;
    r.pitch += (clamp(Math.atan2((r.y - was) / dt, Math.max(r.speed, 20)), -0.6, 0.6) - r.pitch) * (1 - Math.exp(-5 * dt));
  }

  /** Did this rival and the player touch in the step just flown? The closest their ways came, in the rival's place relative to the player's. */
  private touch(r: Rival, dt: number, me: Me): void {
    const T = rivalTune;
    const ax = r.px - this.mx, az = r.pz - this.mz, bx = r.x - me.x, bz = r.z - me.z, sx = bx - ax, sz = bz - az, l2 = sx * sx + sz * sz;
    // (within reach of each other, more at speed: at 900 m/s a bus is 30 m on in a frame)
    const pass = Math.sqrt(l2) / dt, reach = Math.min(40, T.ramR + pass * T.ramRPer), up = Math.min(45, T.ramUp + pass * T.ramUpPer);
    const uc = l2 > 1e-9 ? clamp(-(ax * sx + az * sz) / l2, 0, 1) : 0;
    if (Math.hypot(ax + sx * uc, az + sz * uc) > reach) return;
    // (where they first touched, not where they came closest: two that pass nose to nose are closest side by side, and it's the first touch that says whose
    // nose was into whom)
    let u = 0;
    const a2 = ax * ax + az * az;
    if (a2 > reach * reach && l2 > 1e-9) {
      const bq = ax * sx + az * sz, disc = bq * bq - l2 * (a2 - reach * reach);
      u = disc > 0 ? clamp((-bq - Math.sqrt(disc)) / l2, 0, 1) : uc;
    }
    const cx = ax + sx * u, cz = az + sz * u, d = Math.hypot(cx, cz);
    const dy = r.py - this.my + (r.y - me.y - (r.py - this.my)) * u;
    if (Math.abs(dy) > up) return;
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
    // (rammed by the player, it has a score to settle; one that rammed the player has had its say)
    if (noseMe) r.grudge = true;
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
