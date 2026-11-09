// Recess's brain, headless (FACTIONS.md section 3, "When a bus gets splatted" and "Protection", and section 4; step 7). Buses in a 1.5 km circle, the
// lock and its glint, the breath that curves after a locked bus and goes white-hot in its last third of a second, the flick that hops out of it, and what a
// hit does: Possessed (decision 2; Nonstop in the arena, decision 3), or Piñata or Bubbled by the link's switch. The stop arm after every ride, no ganging
// up, WANTED bullies, the new player's shield and its one lesson. The five rules every idea had to pass are what tools/recess/duels.mjs holds it to: nobody
// loses the steering (but Bubbled, which stops flight by design: it's the fallback), a hit costs time and never paint, what glints is what a tap hits, both
// players see it (a function of the seed and the inputs), and no new buttons (a flick is the only gesture past the steering and the tap).
//
// Flat, on the game's clock at a fixed step; the areas and the beat are factions' own (src/factions). The circle's ground is three neighbourhoods (decision
// 28): the real ones where three of 15-40 squares meet, once the world's files have them, and till then the fallback, three camps of about 36 squares, one a
// bus, its home (decision 19). Each camp starts with its god standing at its heart (FACTIONS.md section 4, "Each side holds a Heart at stage 5"; the studio's
// answer, 2026-11-06): toppled, it rises again only by the full rule. The score is a point a stage a square and 36 a god held. What it
// draws comes after, on the GPU. Not here yet: the open city's rules (Jet, the raider flung 2 km), the bells and the scoreboard's camera, a teammate in Recess
// (it's one bus a side; the wash is built and tested on its own).

import { Areas, squareKey, type Area } from '../factions/areas';
import { camps } from '../factions/neighbourhoods';
import { Beat, BEATS_A_BAR } from '../factions/beat';

export const recessTune = {
  /** the arena's radius (m) and a match (s): "Three minutes between two school bells, in a 1.5 km circle" */
  radius: 750,
  length: 180,
  /** the gears' speeds (m/s) in the arena: Cruise, Express, Nonstop (the player's: config.flight.cruiseSpeed, config.turbo's surge and nonstopSpeed; SHOTS.md, "Captains fly your ladder") */
  gears: [30, 112, 225],
  /** Possessed's gear: Nonstop (decision 3) */
  rideGear: 2,
  /** the yaw at full stretch (rad/s) at 30 m/s, config.flight.maxYawRate, falling as the square root of the speed over that */
  maxYaw: 1.35,
  speedHz: 1.4,
  /** the lock: a rival within 600 m and nearly dead ahead (rad off the nose), held a little wider once it's on */
  lockRange: 600,
  lockCone: 0.18,
  keepCone: 0.3,
  /** an AI captain glints you this long before it breathes: "so you learn the lock by being locked" */
  botGlint: 1,
  /** the belly (s), config.splat.recharge */
  recharge: 1.6,
  /** a breath's flight: a fixed part and its speed (m/s), its last third of a second white-hot and no longer curving; what it hits within hitR (m) */
  breathMin: 0.35,
  breathSpeed: 420,
  whiteHot: 1 / 3,
  hitR: 14,
  /** a flick in the white-hot hops the bus this far sideways (m) over hopTime (s) */
  hop: 30,
  hopTime: 0.25,
  /** the duel's dodge (Duel.ts): a captain that dodges lunges this far forward (m) over hopTime */
  lunge: 40,
  /** the duel: no captain locks the player's bus before this (s of the match), so the first shot at you comes at about 5 s, and it's the easiest captain's:
   *  the others leave you alone `firstGap` s longer (SHOTS.md, "First contact") */
  firstLock: 3.6,
  firstGap: 4,
  /** a breath at no bus lands this far ahead (m) and this many s of the bus's speed further */
  aheadMin: 80,
  aheadT: 0.6,
  /** Possessed: two bars of hiccups, one on each beat; the new player's lesson, one bar */
  rideBars: 2,
  lessonBars: 1,
  /** the stop arm after every ride (s) */
  shield: 4,
  /** riding it out pays: the hitter glints for you from 1.2 km for 8 s */
  avengeR: 1200,
  avengeFor: 8,
  /** no ganging up: the same pair a third time in two minutes bounces off */
  pairWindow: 120,
  pairMost: 2,
  /** bullies: three rides unanswered and they're WANTED, glinting for every rival from 1.2 km */
  wantedRides: 3,
  wantedR: 1200,
  /** Bubbled: three seconds in the hitter's bubble */
  bubble: 3,
  /** Piñata: six drops of the victim's paint, caught within dropR (m) for a tenth of a MEGA each, gone after dropLife (s) */
  drops: 6,
  dropR: 35,
  dropLife: 6,
  dropMega: 0.1,
  /** past this share of the radius the arena turns a bus home, on top of its own steering, by edgeYaw (rad/s) at the circle's edge */
  edgeFrom: 0.85,
  edgeYaw: 1.2,
};

/** The link's switch (?recess=pinata): what a hit does. */
export type Mode = 'possessed' | 'pinata' | 'bubbled';
export type Level = 'learner' | 'rival' | 'veteran';
export type State = 'free' | 'ride' | 'bubble' | 'shield';

/** A driver's hands for one step: the steering (-1 to 1, full stretch), a tap (a breath), a flick (1 up, -1 down, 0 none). */
export interface Hands {
  steer: number;
  tap: boolean;
  flick: number;
}

export interface Bus {
  id: number;
  faction: number;
  /** an AI captain's level, or null for a player */
  bot: Level | null;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** the gear the driver chose */
  gear: number;
  state: State;
  /** when the state ends (game s) */
  until: number;
  /** who rode it, while it's ridden */
  by: number;
  /** a ride's hiccups: the beats from and to */
  from: number;
  to: number;
  /** the new player's shield: until their first Wonder (decision 18), and the one lesson a captain gives */
  newcomer: boolean;
  lessonDone: boolean;
  /** rides given since it was last ridden itself */
  given: number;
  wanted: boolean;
  /** the belly's ready at */
  belly: number;
  mega: number;
  /** riding it out: the super-splat back ready */
  superReady: boolean;
  /** the bus it has locked, -1 for none, and since when */
  lock: number;
  lockSince: number;
  /** the hitter it may avenge, and until when */
  avenge: number;
  avengeUntil: number;
  /** a hop under way: s left, and its way (+1 right of the nose) */
  hopLeft: number;
  hopWay: number;
  /** the duel's lunge under way (s left) */
  lungeLeft: number;
  /** its camp: the neighbourhood its start is in, -1 for none */
  home: number;
  /** driven from outside (the player's real flight, on screen): the sim steers and moves it not at all, its place set each step */
  external: boolean;
  /** this step's yaw (rad/s): the driver's, and the arena edge's on top */
  driverYaw: number;
  edgeYaw: number;
}

export interface Breath {
  id: number;
  from: number;
  /** the bus it curves after, -1 for the ground */
  target: number;
  x: number;
  z: number;
  /** where it lands, for the ground's */
  tx: number;
  tz: number;
  vx: number;
  vz: number;
  arrive: number;
  /** when it was let go (game s) */
  born: number;
  white: boolean;
}

export interface Drop {
  x: number;
  z: number;
  faction: number;
  /** for whom: the hitter */
  owner: number;
  until: number;
}

export type EventKind =
  | 'glint' // a locks b: b glints on a's screen, and flashes a's colour on b's
  | 'fire' // a breathes at b (-1: the ground)
  | 'aim' // a captain a's breath at the player's bus b is the duel's to fly (Recess.duel)
  | 'whiteHot' // a's breath at b, its last third of a second
  | 'hop' // a hops
  | 'hit' // a rides b: GOTCHA and NO BRAKES
  | 'lesson' // a captain gives the new player b their one short ride
  | 'miss' // a's breath at b misses
  | 'bounce' // a's breath on b does nothing: a stop arm, someone else's ride, a third of a pair, a teammate
  | 'sparkle' // a's breath bursts on a new player b as sparkles
  | 'wash' // a teammate a washes b's ride off early
  | 'hiccup' // b, ridden by a, hiccups a's paint
  | 'wheeze' // b flicks down in a ride: NO BRAKES
  | 'rideEnd' // b's ride by a ends
  | 'shieldEnd'
  | 'wanted' // a is WANTED
  | 'catch' // a catches a drop of b's
  | 'paint'; // a's breath lands on the ground

export interface Event {
  t: number;
  kind: EventKind;
  a: number;
  b: number;
  /** what the ground did, for paint and hiccup */
  outcome?: string;
  /** where a breath landed, for paint */
  x?: number;
  z?: number;
}

export interface BusSetup {
  faction: number;
  bot?: Level | null;
  newcomer?: boolean;
  x?: number;
  z?: number;
  heading?: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class Recess {
  readonly beat: Beat;
  readonly areas: Areas;
  readonly buses: Bus[] = [];
  readonly breaths: Breath[] = [];
  readonly drops: Drop[] = [];
  /** this step's events; `log` keeps them all if it's on */
  readonly events: Event[] = [];
  readonly log: Event[] | null;
  readonly mode: Mode;
  readonly dt: number;
  t = 0;
  /** The screen's duel (Duel.ts) flies the shots at and from the player's bus: a captain's breath at an external bus is only said ('aim'), and what such a shot
   *  does comes back through aimedHit. Off, as in the headless duels, the brain flies every breath itself. */
  duel = false;
  private readonly aimed: number[] = [];
  /** the easiest captain (the first of them): the duel's first lock on the player's bus is its */
  private easiest = -1;
  private nextBreath = 1;
  /** rides by pair: "a>b" to their times */
  private readonly pairs = new Map<string, number[]>();
  private readonly crossed: number[] = [];

  constructor(setup: BusSetup[], o: { mode?: Mode; dt?: number; log?: boolean; beat?: Beat; areas?: Areas; gods?: boolean } = {}) {
    this.mode = o.mode ?? 'possessed';
    this.dt = o.dt ?? 1 / 30;
    this.beat = o.beat ?? new Beat();
    this.areas = o.areas ?? new Areas(this.beat, camps(recessTune.radius, 0, 0, ['camp 1', 'camp 2', 'camp 3'], -Math.PI / 3));
    this.log = o.log ? [] : null;
    const n = setup.length;
    setup.forEach((s, i) => {
      // (round the circle, facing in, unless placed)
      const a = (i / n) * Math.PI * 2, r = recessTune.radius * 0.6;
      this.buses.push({
        id: i, faction: s.faction, bot: s.bot ?? null, x: s.x ?? Math.cos(a) * r, z: s.z ?? Math.sin(a) * r, heading: s.heading ?? wrap(a + Math.PI), speed: recessTune.gears[0],
        gear: 0, state: 'free', until: 0, by: -1, from: 0, to: 0, newcomer: !!s.newcomer, lessonDone: false, given: 0, wanted: false, belly: 0, mega: 0, superReady: false,
        lock: -1, lockSince: 0, avenge: -1, avengeUntil: 0, hopLeft: 0, hopWay: 1, lungeLeft: 0, home: -1, external: false, driverYaw: 0, edgeYaw: 0,
      });
      const b = this.buses[i];
      b.home = this.areas.realm ? this.areas.realm.of(squareKey(b.x, b.z)) : -1;
      // (the studio's answer, 2026-11-06: each camp starts with its god standing, so three minutes are for defending yours, toppling theirs and painting the rest)
      if (o.gods !== false && b.home >= 0 && !this.areas.realm!.godless(b.home)) this.areas.setGod(b.home, b.faction);
    });
    const rank = (l: Level | null) => (l === 'learner' ? 0 : l === 'rival' ? 1 : 2);
    for (const b of this.buses) if (b.bot && (this.easiest < 0 || rank(b.bot) < rank(this.buses[this.easiest].bot))) this.easiest = b.id;
  }

  /** The yaw a driver's full stretch gives at a speed (rad/s): never nothing, at any gear. */
  static yawAt(speed: number): number {
    return recessTune.maxYaw * Math.sqrt(30 / Math.max(30, speed));
  }

  /** The first Wonder ends the new player's shield (decision 18). */
  firstWonder(id: number): void {
    this.buses[id].newcomer = false;
  }

  /** One step, every bus's hands in its order. */
  step(hands: Hands[]): void {
    const T = recessTune, dt = this.dt, t0 = this.t, t = (this.t = t0 + dt);
    this.events.length = 0;
    // (the duel's hits since the last step: only these possess, as a brain's own breath does)
    for (let i = 0; i < this.aimed.length; i += 2) this.land(this.buses[this.aimed[i]], this.buses[this.aimed[i + 1]]);
    this.aimed.length = 0;
    for (const b of this.buses) this.drive(b, hands[b.id] ?? { steer: 0, tap: false, flick: 0 }, dt);
    for (const b of this.buses) this.lockFor(b);
    for (const b of this.buses) if (hands[b.id]?.tap) this.fire(b);
    this.fly(t);
    // (the hiccups, one a beat, and the rides' ends)
    const beats = this.beat.crossed(t0, t, this.crossed);
    for (const b of this.buses) {
      if (b.state === 'ride') {
        for (const i of beats) {
          if (i < b.from || i > b.to) continue;
          const by = this.buses[b.by], r = this.areas.spill(b.x, b.z, by.faction, t);
          this.emit('hiccup', by.id, b.id, r.outcome);
          if (i === b.to) this.endRide(b, true);
        }
      } else if (b.state === 'bubble' && t >= b.until) {
        const by = this.buses[b.by];
        this.emit('hiccup', by.id, b.id, this.areas.spill(b.x, b.z, by.faction, t).outcome);
        this.endRide(b, true);
      } else if (b.state === 'shield' && t >= b.until) {
        b.state = 'free';
        this.emit('shieldEnd', b.id, -1);
      }
    }
    // (Piñata's drops: the hitter's to catch)
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i], o = this.buses[d.owner];
      if (Math.hypot(o.x - d.x, o.z - d.z) <= T.dropR) {
        o.mega = Math.min(1, o.mega + T.dropMega);
        this.emit('catch', o.id, d.faction);
        this.drops.splice(i, 1);
      } else if (t >= d.until) this.drops.splice(i, 1);
    }
  }

  private emit(kind: EventKind, a: number, b: number, outcome?: string, x?: number, z?: number): void {
    const e: Event = { t: this.t, kind, a, b };
    if (outcome !== undefined) e.outcome = outcome;
    if (x !== undefined) {
      e.x = x;
      e.z = z;
    }
    this.events.push(e);
    this.log?.push(e);
  }

  /** The hands on the bus: the steering always, but in a bubble; a flick hops in the white-hot, wheezes in a ride, or shifts. */
  private drive(b: Bus, h: Hands, dt: number): void {
    const T = recessTune;
    if (b.external) {
      b.driverYaw = b.edgeYaw = 0;
      return;
    }
    if (h.flick) {
      if (this.whiteAt(b.id) && b.hopLeft <= 0 && b.state !== 'bubble') {
        b.hopLeft = T.hopTime;
        b.hopWay = h.steer < 0 ? -1 : 1;
        this.emit('hop', b.id, -1);
      } else if (b.state === 'ride') {
        if (h.flick < 0) this.emit('wheeze', -1, b.id);
      } else b.gear = Math.max(0, Math.min(T.gears.length - 1, b.gear + Math.sign(h.flick)));
    }
    if (b.state === 'bubble') {
      b.driverYaw = b.edgeYaw = 0;
      b.speed = 0;
      return;
    }
    const steer = Math.max(-1, Math.min(1, h.steer || 0));
    b.driverYaw = steer * Recess.yawAt(b.speed);
    // (the arena's edge turns it home, on top: never instead)
    const r = Math.hypot(b.x, b.z), over = r / T.radius - T.edgeFrom;
    b.edgeYaw = 0;
    if (over > 0 && r > 1) {
      const home = wrap(Math.atan2(-b.z, -b.x) - b.heading);
      b.edgeYaw = Math.sign(home) * Math.min(1, over / (1 - T.edgeFrom)) * T.edgeYaw * Math.min(1, Math.abs(home) * 2);
    }
    b.heading = wrap(b.heading + (b.driverYaw + b.edgeYaw) * dt);
    const want = T.gears[b.state === 'ride' ? T.rideGear : b.gear];
    b.speed += (want - b.speed) * (1 - Math.exp(-T.speedHz * dt));
    const fx = Math.cos(b.heading), fz = Math.sin(b.heading);
    b.x += fx * b.speed * dt;
    b.z += fz * b.speed * dt;
    if (b.hopLeft > 0) {
      const s = (Math.min(dt, b.hopLeft) / T.hopTime) * T.hop * b.hopWay;
      b.x += -fz * s;
      b.z += fx * s;
      b.hopLeft -= dt;
    }
    if (b.lungeLeft > 0) {
      const s = (Math.min(dt, b.lungeLeft) / T.hopTime) * T.lunge;
      b.x += fx * s;
      b.z += fz * s;
      b.lungeLeft -= dt;
    }
  }

  /** The duel's shot from bus `a` reached bus `v`: it lands at the next step, by the rules a breath lands by. */
  aimedHit(a: number, v: number): void {
    this.aimed.push(a, v);
  }

  /** The duel: captain `id` dodges, a lunge forward. */
  lunge(id: number): void {
    this.buses[id].lungeLeft = recessTune.hopTime;
  }

  /** A breath at bus `id` is white-hot. */
  private whiteAt(id: number): boolean {
    for (const s of this.breaths) if (s.target === id && s.white) return true;
    return false;
  }

  /** Whether `a` may lock `b`: a rival (or a teammate in a ride, to wash it), not behind a stop arm, not someone else's ride, not in a bubble. */
  canLock(a: Bus, b: Bus): boolean {
    if (a === b) return false;
    if (a.faction === b.faction) return b.state === 'ride';
    return b.state === 'free';
  }

  /** How far `a` can lock `b` from: 600 m, or 1.2 km for its hitter to avenge, or for a WANTED bus. */
  reach(a: Bus, b: Bus): number {
    const T = recessTune;
    return (a.avenge === b.id && this.t < a.avengeUntil) || (b.wanted && a.faction !== b.faction) ? Math.max(T.avengeR, T.wantedR) : T.lockRange;
  }

  private lockFor(a: Bus): void {
    const T = recessTune;
    // (a stop arm and a bubble lock nothing; a ride can still lock, it just can't help where it goes)
    if (a.state === 'shield' || a.state === 'bubble') {
      a.lock = -1;
      return;
    }
    const off = (b: Bus) => Math.abs(wrap(Math.atan2(b.z - a.z, b.x - a.x) - a.heading));
    const held = a.lock >= 0 ? this.buses[a.lock] : null;
    if (held && this.canLock(a, held) && Math.hypot(held.x - a.x, held.z - a.z) <= this.reach(a, held) * 1.1 && off(held) <= T.keepCone) return;
    let best = -1, score = Infinity;
    for (const b of this.buses) {
      if (!this.canLock(a, b)) continue;
      // (the duel's first contact: the player gets their first seconds to themselves)
      if (this.duel && a.bot && b.external && this.t < T.firstLock + (a.id === this.easiest ? 0 : T.firstGap)) continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z), o = off(b);
      if (d > this.reach(a, b) || o > T.lockCone) continue;
      const s = o * 1000 + d;
      if (s < score) {
        score = s;
        best = b.id;
      }
    }
    if (best !== a.lock) {
      a.lock = best;
      a.lockSince = this.t;
      if (best >= 0) this.emit('glint', a.id, best);
    }
  }

  /** A breath from `a` at bus `target`, landing at `arrive` (game s): the player's, whose breath the game has already let go and timed. */
  fireAt(a: number, target: number, arrive: number): void {
    const b = this.buses[a], v = this.buses[target], fly = Math.max(this.dt, arrive - this.t);
    b.belly = this.t + recessTune.recharge;
    this.breaths.push({ id: this.nextBreath++, from: a, target, x: b.x, z: b.z, tx: v.x, tz: v.z, vx: (v.x - b.x) / fly, vz: (v.z - b.z) / fly, arrive: this.t + fly, born: this.t, white: false });
    this.emit('fire', a, target);
  }

  /** The newest breath of bus `a`, the one its 'fire' this step let go. */
  breathOf(a: number): Breath | undefined {
    for (let i = this.breaths.length - 1; i >= 0; i--) if (this.breaths[i].from === a) return this.breaths[i];
    return undefined;
  }

  /** A tap: at the locked bus, or the ground ahead. An AI captain's goes at a bus only after its full second of glint. A stop arm's mouth is shut. */
  private fire(a: Bus): void {
    const T = recessTune;
    if (a.state === 'shield' || a.state === 'bubble' || this.t < a.belly) return;
    a.belly = this.t + T.recharge;
    const target = a.lock >= 0 && (!a.bot || this.t - a.lockSince >= T.botGlint - 1e-9) ? a.lock : -1;
    if (this.duel && target >= 0 && this.buses[target].external) return this.emit('aim', a.id, target);
    const fx = Math.cos(a.heading), fz = Math.sin(a.heading);
    let tx: number, tz: number;
    if (target >= 0) {
      tx = this.buses[target].x;
      tz = this.buses[target].z;
    } else {
      const d = T.aheadMin + a.speed * T.aheadT;
      tx = a.x + fx * d;
      tz = a.z + fz * d;
    }
    const d = Math.hypot(tx - a.x, tz - a.z), fly = T.breathMin + d / T.breathSpeed;
    this.breaths.push({ id: this.nextBreath++, from: a.id, target, x: a.x, z: a.z, tx, tz, vx: (tx - a.x) / fly, vz: (tz - a.z) / fly, arrive: this.t + fly, born: this.t, white: false });
    this.emit('fire', a.id, target);
  }

  private fly(t: number): void {
    const T = recessTune, dt = this.dt;
    for (let i = this.breaths.length - 1; i >= 0; i--) {
      const s = this.breaths[i], left = s.arrive - t;
      if (s.target >= 0) {
        const v = this.buses[s.target];
        // (it curves after the bus until its last third of a second, then it's committed)
        if (!s.white && left <= T.whiteHot) {
          s.white = true;
          this.emit('whiteHot', s.from, s.target);
        }
        // (at where the bus will be when it gets there, on its way now)
        if (!s.white && left > 0) {
          const lead = left + dt, px = v.x + Math.cos(v.heading) * v.speed * lead, pz = v.z + Math.sin(v.heading) * v.speed * lead;
          s.vx = (px - s.x) / lead;
          s.vz = (pz - s.z) / lead;
        }
      }
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      if (left > 1e-9) continue;
      this.breaths.splice(i, 1);
      if (s.target >= 0) {
        const v = this.buses[s.target];
        if (Math.hypot(v.x - s.x, v.z - s.z) <= T.hitR) {
          this.land(this.buses[s.from], v);
          continue;
        }
        this.emit('miss', s.from, s.target);
      }
      // (a breath that hits no bus paints where it lands: a hit costs time, never paint)
      const r = this.areas.hit(s.x, s.z, this.buses[s.from].faction, t);
      this.emit('paint', s.from, -1, r.outcome, s.x, s.z);
    }
  }

  /** A breath from `a` reaches bus `v`. */
  private land(a: Bus, v: Bus): void {
    const T = recessTune;
    if (v.state === 'shield') return this.emit('bounce', a.id, v.id);
    if (a.faction === v.faction) {
      if (v.state === 'ride') {
        this.emit('wash', a.id, v.id);
        return this.endRide(v, false);
      }
      return this.emit('bounce', a.id, v.id);
    }
    // (no ganging up: only a ridden bus's own crew can hit it)
    if (v.state !== 'free') return this.emit('bounce', a.id, v.id);
    if (v.newcomer) {
      if (a.bot && !v.lessonDone) {
        v.lessonDone = true;
        this.emit('lesson', a.id, v.id);
        return this.ride(a, v, T.lessonBars, true);
      }
      return this.emit('sparkle', a.id, v.id);
    }
    const key = `${a.id}>${v.id}`, times = (this.pairs.get(key) ?? []).filter((x) => this.t - x < T.pairWindow);
    if (times.length >= T.pairMost) {
      this.pairs.set(key, times);
      return this.emit('bounce', a.id, v.id);
    }
    times.push(this.t);
    this.pairs.set(key, times);
    this.emit('hit', a.id, v.id);
    a.given++;
    if (a.given >= T.wantedRides && !a.wanted) {
      a.wanted = true;
      this.emit('wanted', a.id, -1);
    }
    v.given = 0;
    v.wanted = false;
    this.ride(a, v, T.rideBars, false);
  }

  private ride(a: Bus, v: Bus, bars: number, lesson: boolean): void {
    const T = recessTune, mode = lesson ? 'possessed' : this.mode;
    v.by = a.id;
    v.lock = -1;
    if (mode === 'possessed') {
      v.state = 'ride';
      v.from = this.beat.nextIndex(this.t + 1e-6);
      v.to = v.from + bars * BEATS_A_BAR - 1;
      v.until = this.beat.time(v.to);
    } else if (mode === 'bubbled') {
      v.state = 'bubble';
      v.until = this.t + T.bubble;
    } else {
      // (Piñata: the belly bursts into six drops of the victim's paint round it, the hitter's to catch; the ride is the burst)
      for (let k = 0; k < T.drops; k++) {
        const ang = (k / T.drops) * Math.PI * 2 + v.heading;
        this.drops.push({ x: v.x + Math.cos(ang) * 40, z: v.z + Math.sin(ang) * 40, faction: v.faction, owner: a.id, until: this.t + T.dropLife });
      }
      this.endRide(v, true);
    }
  }

  /** A ride's end: four seconds of the stop arm; ridden out, the hitter glints for it from 1.2 km and its super's back. */
  private endRide(v: Bus, out: boolean): void {
    const T = recessTune;
    this.emit('rideEnd', v.by, v.id);
    if (out) {
      v.avenge = v.by;
      v.avengeUntil = this.t + T.avengeFor;
      v.superReady = true;
    }
    v.state = 'shield';
    v.until = this.t + T.shield;
    v.lock = -1;
  }

  /** The score: a point a stage a square in the circle, and 36 a god held. */
  score(): number[] {
    return this.areas.score((a: Area) => this.areas.realm?.of(a.key) !== -1);
  }

  /** Inside the circle. */
  static inside(x: number, z: number): boolean {
    return x * x + z * z <= recessTune.radius * recessTune.radius;
  }
}
