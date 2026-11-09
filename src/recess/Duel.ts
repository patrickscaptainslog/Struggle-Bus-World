import * as THREE from 'three';
import type { Hold, HoldHandler, Holds, HomingOpts, HomingShot } from '../game/Hold';
import { SKILLS, rng } from './captain';
import type { Level, Recess } from './recess';

// The duel (docs/specs/shots/SHOTS.md, "Recess: the duel"; HOOKS.md): Recess's side of the shots' hold, between the player's real flight and the captains.
//   The player's lock: a still hold on a captain within 900 m takes the hold from the Hose; at 0.55 s it clacks, at 1 s it is a full charge, and the lift fires
//     a blob that homes in (Holds.fire). A lift before the clack homes weakly. The lock holds 4 s after the lift, so the next taps go to the same captain. It
//     sticks to the captain until it leaves the screen, a building hides it, or it can't be locked any more (its stop arm, someone's ride).
//   A captain's shot: the brain's breath at the player's bus (Recess.duel, its 'aim') is a homing shot here, slowed so it flies at least a level's time, with a
//     level's white window at its end.
//   The dodge, by rule: in the white, a flick or a hard turn (the thumb's stretch changed by `hardTurn` since the shot went white). The shot sees the bus slide off
//     its line over the lunge's quarter second, so a dodge too late is still a hit. A flick lunges the bus 40 m on (up) or brake-hops it (down), and the gears
//     never hear it. Too early does nothing: before the white the shot leads the bus round whatever turn it holds (the chord, below), and a flick is a gear.
//   The first shot of a match at the player comes from the easiest captain (recessTune.firstLock), flies longer, is white longer, and asks less of a turn.
//   A captain's dodge: at the white of a shot of the player's, a roll by its level (30 %, 55 %, 75 %; less against a full charge): after its reaction it lunges
//     and the shot goes by; one that doesn't is hit, if the shot's line passes anywhere near it.
//   Only this possesses (Recess.aimedHit): a tap at a captain is a splash for show.
// It asks nothing of the screen but a few callbacks (DuelHost), so tools/recess/s_duel.ts flies it in Node on the real Holds and the real Flight.

export const duelTune = {
  /** the pick: the captain nearest the finger within this many px, or its drawn half-size and `sizePx` more; from this far (m) */
  pickPx: 48,
  sizePx: 16,
  reach: 900,
  /** the clack and the full charge (s the finger has been down), and how long the lock holds after the lift for taps (s; after a dodged full charge, this long from the miss) */
  lockAt: 0.55,
  full: 1,
  keep: 4,
  keepDodged: 2,
  /** the player's shot (HOOKS.md's numbers): m/s, rad/s, its white (s; a full charge's), a full charge's speed and size x, a lift before the clack's speed and turn x */
  speed: 420,
  turn: 2.2,
  white: 0.7,
  whiteFull: 0.45,
  fullSpeed: 1.2,
  fullSize: 1.5,
  weakSpeed: 0.8,
  weakTurn: 0.3,
  /** its hit radius: `hitMin` m, or the captain's speed / `hitPer`; and a captain that doesn't dodge is hit if the white shot's line passes within `assist` m of it */
  hitMin: 7,
  hitPer: 30,
  assist: 22,
  /** how often a captain dodges, by level (SHOTS.md), and a full charge's share of that */
  dodge: { learner: 0.3, rival: 0.55, veteran: 0.75 } as Record<Level, number>,
  fullDodge: 0.6,
  /** a captain's shot: its most and least speed (m/s; the least of the match's first), its turn (rad/s), its white (s) and how long it flies (s) by level, both
   *  in real seconds whatever the bus is closing at (between the two speeds), and its hit radius (m) */
  capSpeed: 560,
  capSlow: 140,
  firstSlow: 80,
  capTurn: 1.8,
  capWhite: { learner: 1, rival: 0.8, veteran: 0.7 } as Record<Level, number>,
  capFlight: { learner: 1.5, rival: 1.15, veteran: 0.95 } as Record<Level, number>,
  capHit: 5,
  /** the lead looks at most this far ahead (s) */
  leadMost: 2.5,
  /** a dodge by rule: the shot sees its target this much further off its line than its hit radius (m); the player's bus gets there over `lungeTime` */
  clear: 12,
  /** the flick's show: a lunge on (m) over `lungeTime` s, or the brake-hop: this far back (never more than the bus was going) and this high (m) */
  lunge: 40,
  lungeTime: 0.25,
  brake: 24,
  hop: 6,
  /** a hard turn: the steering thumb's stretch (-1 to 1) changed this much since the shot went white dodges it, as a flick does, at any gear. The match's
   *  first shot at the player asks less, flies longer and is white longer (SHOTS.md: "Your first duel is a dodge you win") */
  hardTurn: 0.6,
  firstTurn: 0.3,
  firstWhite: 1.2,
  firstFlight: 1.8,
};

/** The player's flight, as the duel moves it (the lunge). */
export interface DuelFlight {
  x: number;
  y: number;
  z: number;
  heading: number;
  readonly fx: number;
  readonly fz: number;
  readonly ground: number;
}

/** What the duel needs of the game (recessBoot.ts; a stand-in in tools/recess/s_duel.ts). */
export interface DuelHost {
  holds: Holds;
  sim: Recess;
  flight: DuelFlight;
  /** the arena's middle (world m): the brain's x and z are from it */
  cx: number;
  cz: number;
  /** a captain's height (world m), its drawn half-length (m) and its level */
  yOf(id: number): number;
  sizeOf(id: number): number;
  level(id: number): Level;
  /** the match is on */
  playing(): boolean;
  /** the steering thumb's stretch now (-1 to 1): a hard turn in the white is a dodge */
  steer(): number;
  /** the lock's clack, and the full charge's */
  clack(full: boolean): void;
  say(lines: string[], seconds: number, rank: number): void;
  count(k: string): void;
  kick(k: number): void;
  /** the dodge rolls' seed */
  seed?: number;
}

/** A captain's shot at the player, in the air. */
export interface Incoming {
  /** the captain */
  readonly from: number;
  shot: HomingShot | null;
  readonly speed: number;
  readonly at: THREE.Vector3;
  /** how long it is white for (s), and the seconds until it and the bus meet (the chord's) */
  readonly whiteFor: number;
  eta: number;
  /** what it was fired with: its `white` is set from `eta` each frame (busVel) */
  o: HomingOpts | null;
  /** dodged by rule (a flick or a hard turn in the white), and when (the duel's clock, s) */
  dodged: boolean;
  dodgedAt: number;
  /** the match's first shot at the player, and the steering thumb's stretch when it went white */
  readonly first: boolean;
  steer0: number;
}

interface Mine {
  id: number;
  shot: HomingShot | null;
  speed: number;
  r: number;
  assist: number;
  charged: boolean;
  dodged: boolean;
  dodgeAt: number;
}

const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

export class Duel implements HoldHandler {
  readonly name = 'recess-lock';
  /** the player's lock: the captain (-1: none), whether it clacked, whether it's a full charge, the finger still on it, and how long it has been (s) */
  locked = -1;
  clacked = false;
  charged = false;
  holding = false;
  held = 0;
  /** the captains' shots in the air (the incoming marker reads them) */
  readonly incoming: Incoming[] = [];
  /** the first shot at the player: when the captain locked, fired, when it went white and how it ended (game s; -1: not yet) */
  readonly first = { glint: -1, fired: -1, white: -1, ended: -1, how: '' };
  readonly qa = {
    picks: 0, clacks: 0, fulls: 0, fired: 0, weak: 0, hits: 0, misses: 0, why: '', broken: 0, capRolls: 0, capDodges: 0,
    capFired: 0, capRefused: 0, capWhite: 0, capHits: 0, capMisses: 0, capWhy: '', flicks: 0, turns: 0, early: 0,
  };
  private until = 0;
  private holdId = -1;
  private t = 0;
  private omega = 0;
  private ax = 0;
  private az = 0;
  private lastHeading = NaN;
  private lungeLeft = 0;
  private lungeWay: 1 | -1 = 1;
  private taught = false;
  private readonly mine: Mine[] = [];
  private readonly rand: () => number;
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly s = { x: 0, y: 0 };
  private readonly s2 = { x: 0, y: 0 };
  private readonly host: DuelHost;

  constructor(host: DuelHost) {
    this.host = host;
    this.rand = rng((host.seed ?? 1) ^ 0x5d0e1);
    host.holds.add(this);
  }

  // ---- the player's lock (a HoldHandler)

  start(h: Hold): boolean {
    const id = this.pick(h.x, h.y);
    if (id < 0) return false;
    this.locked = id;
    this.holdId = h.id;
    this.holding = true;
    this.held = h.held;
    this.clacked = this.charged = false;
    this.until = 0;
    this.qa.picks++;
    return true;
  }

  move(h: Hold): void {
    if (h.owner !== this.name || this.locked < 0 || h.id !== this.holdId) return;
    // (it sticks to the captain until it leaves the screen, a building hides it or it can't be locked: then the lock breaks, and nothing pours under the finger)
    if (!this.seen(this.locked)) {
      this.qa.broken++;
      this.drop();
      this.host.holds.release(this.name);
      return;
    }
    const T = duelTune;
    this.held = h.held;
    if (!this.clacked && h.held >= T.lockAt) {
      this.clacked = true;
      this.qa.clacks++;
      this.host.clack(false);
    }
    if (!this.charged && h.held >= T.full) {
      this.charged = true;
      this.qa.fulls++;
      this.host.clack(true);
    }
  }

  lost(): void {
    this.drop();
  }

  end(h: Hold, cancelled: boolean): void {
    if (h.owner !== this.name || h.id !== this.holdId) return;
    const id = this.locked;
    this.holding = false;
    this.holdId = -1;
    if (cancelled || id < 0) {
      this.drop();
      return;
    }
    // (a lift before the clack is a plain shot that homes weakly: nothing is wasted)
    if (this.fire(id, !this.clacked, this.charged)) this.until = this.t + duelTune.keep;
    else this.drop();
    this.charged = false;
  }

  /** A tap while the lock holds: its shot homes at the same captain. */
  tap(): boolean {
    if (this.locked < 0 || this.holding || this.t >= this.until || !this.seen(this.locked)) return false;
    return this.fire(this.locked, false, false);
  }

  // ---- each frame, and after each of the brain's steps

  /** Each frame of the match (the game's clock): the bus's turn, the kept lock, the captains' dodges, the hard turn, and the lunge. */
  frame(dt: number): void {
    const T = duelTune, f = this.host.flight;
    this.t += dt;
    if (dt > 0 && this.lastHeading === this.lastHeading) this.omega += (wrap(f.heading - this.lastHeading) / dt - this.omega) * (1 - Math.exp(-20 * dt));
    this.lastHeading = f.heading;
    if (this.locked >= 0 && !this.holding && (this.t >= this.until || !this.lockable(this.locked))) this.drop();
    for (let i = this.mine.length - 1; i >= 0; i--) {
      const m = this.mine[i];
      if (!m.shot || m.shot.done) {
        this.mine.splice(i, 1);
        continue;
      }
      // (the captain's reaction is over: it lunges, and the shot goes by)
      if (!m.dodged && this.t >= m.dodgeAt && this.host.sim.buses[m.id].state === 'free') {
        m.dodged = true;
        this.qa.capDodges++;
        this.host.sim.lunge(m.id);
      }
    }
    for (let i = this.incoming.length - 1; i >= 0; i--) {
      const c = this.incoming[i];
      if (!c.shot || c.shot.done) {
        this.incoming.splice(i, 1);
        continue;
      }
      // (a hard turn in the white: the turn's change since it began, so one held from before is no dodge)
      if (c.shot.white && !c.dodged && Math.abs(this.host.steer() - c.steer0) >= (c.first ? T.firstTurn : T.hardTurn)) {
        c.dodged = true;
        c.dodgedAt = this.t;
        this.qa.turns++;
        this.host.count('turnDodge');
      }
    }
    if (this.lungeLeft > 0) {
      const step = Math.min(dt, this.lungeLeft), k0 = 1 - this.lungeLeft / T.lungeTime, k1 = 1 - (this.lungeLeft - step) / T.lungeTime;
      if (this.lungeWay > 0) {
        const d = (k1 - k0) * T.lunge;
        f.x += f.fx * d;
        f.z += f.fz * d;
      } else {
        // (the brake-hop: back, never more than it was going, and up and down again)
        const d = Math.min((k1 - k0) * T.brake, 0.9 * f.ground * step);
        f.x -= f.fx * d;
        f.z -= f.fz * d;
        f.y += T.hop * (Math.sin(Math.PI * k1) - Math.sin(Math.PI * k0));
      }
      this.lungeLeft -= step;
    }
  }

  /** After each of the brain's steps: a captain's breath at the player's bus is the duel's shot (Recess.duel, 'aim'). */
  heard(): void {
    for (const e of this.host.sim.events) {
      if (e.kind === 'aim' && e.b === 0) this.captainFire(e.a);
      else if (e.kind === 'glint' && e.b === 0 && e.a > 0 && this.first.glint < 0) this.first.glint = e.t;
    }
  }

  /**
   * A flick (controls.flickGate, through RecessGame.flick): in the white of a shot at the bus it dodges, by rule, and the gears don't hear it (true). The bus
   * lunges on, or brake-hops if it's down. Too early, or with nothing coming, it's a gear's (false).
   */
  flick(dir: 1 | -1): boolean {
    if (!this.host.playing()) return false;
    let white = false, fresh = false, coming = false;
    for (const c of this.incoming) {
      if (!c.shot || c.shot.done) continue;
      coming = true;
      if (!c.shot.white) continue;
      white = true;
      if (!c.dodged) {
        c.dodged = true;
        c.dodgedAt = this.t;
        fresh = true;
      }
    }
    if (!white) {
      if (coming) this.qa.early++;
      return false;
    }
    if (fresh) {
      this.lungeLeft = duelTune.lungeTime;
      this.lungeWay = dir > 0 ? 1 : -1;
      this.qa.flicks++;
      this.host.count('flickDodge');
      this.host.kick(0.6);
    }
    return true;
  }

  /** The match is over, or a new one starts: the lock goes, and the shots in the air end. */
  reset(): void {
    this.drop();
    for (const m of this.mine) m.shot?.cancel();
    for (const c of this.incoming) c.shot?.cancel();
    this.mine.length = this.incoming.length = 0;
    this.lungeLeft = 0;
    const F = this.first;
    F.glint = F.fired = F.white = F.ended = -1;
    F.how = '';
  }

  /** A captain is aiming at the player's bus: it has it locked, and may breathe. */
  aimedBy(id: number): boolean {
    const b = this.host.sim.buses[id];
    return !!b && b.lock === 0 && b.state !== 'shield' && b.state !== 'bubble';
  }

  /** Where captain `id` is (world m, into `out`). */
  at(id: number, out: THREE.Vector3): THREE.Vector3 {
    const H = this.host, b = H.sim.buses[id];
    return out.set(H.cx + b.x, H.yOf(id), H.cz + b.z);
  }

  // ---- the shots

  /** The player's shot at captain `id`: false if none flew (the belly too low, a breath under way, too many in the air: the bus coughs). */
  private fire(id: number, weak: boolean, charged: boolean): boolean {
    const T = duelTune, H = this.host, b = H.sim.buses[id];
    const m: Mine = {
      id, shot: null, charged, dodged: false, dodgeAt: Infinity,
      speed: T.speed * (charged ? T.fullSpeed : weak ? T.weakSpeed : 1),
      r: Math.max(T.hitMin, b.speed / T.hitPer),
      assist: weak ? T.assist * T.weakTurn : T.assist,
    };
    m.shot = H.holds.fire({
      target: (out) => this.captainAt(m, out),
      vel: (out) => this.captainVel(m, out),
      speed: m.speed,
      turn: T.turn * (weak ? T.weakTurn : 1),
      white: charged ? T.whiteFull : T.white,
      hitRadius: m.r,
      size: charged ? T.fullSize : 1,
      onWhite: () => {
        // (the captain's roll, by its level: it sees a full charge later, and so dodges it less)
        const lv = H.level(id);
        this.qa.capRolls++;
        if (b.state === 'free' && this.rand() < T.dodge[lv] * (charged ? T.fullDodge : 1)) m.dodgeAt = this.t + SKILLS[lv].react * (0.7 + 0.6 * this.rand());
      },
      onHit: () => {
        this.qa.hits++;
        H.sim.aimedHit(0, id);
      },
      onMiss: (_at, _s, why) => {
        this.qa.misses++;
        this.qa.why = why;
        if (why !== 'dodged') return;
        H.count('theyDodged');
        // (SHOTS.md: after a dodged full charge the lock stays 2 s)
        if (charged && this.locked === id) this.until = Math.max(this.until, this.t + T.keepDodged);
      },
    });
    if (!m.shot) return false;
    this.mine.push(m);
    this.qa.fired++;
    if (weak) this.qa.weak++;
    return true;
  }

  /** Captain `id`'s shot at the player's bus (the brain's 'aim'). */
  private captainFire(id: number): void {
    const T = duelTune, H = this.host, b = H.sim.buses[id], lv = H.level(id);
    const first = this.first.fired < 0;
    const at = this.at(id, new THREE.Vector3()), bus = H.holds.bus(this.p), flight = first ? T.firstFlight : T.capFlight[lv];
    // (where the bus will be when the shot's seconds are up, on the turn it's in: the shot's speed takes it there in a level's time, whatever the bus's gear)
    const v = H.holds.busVel(this.v);
    this.sweep(v.x, v.z, this.omega, flight);
    const speed = Math.min(T.capSpeed, Math.max(first ? T.firstSlow : T.capSlow, Math.hypot(bus.x + this.ax - at.x, bus.y + v.y * flight - at.y, bus.z + this.az - at.z) / flight));
    const c: Incoming = { from: id, shot: null, at, speed, whiteFor: first ? T.firstWhite : T.capWhite[lv], eta: Infinity, o: null, dodged: false, dodgedAt: 0, steer0: 0, first };
    c.o = {
      from: at,
      faction: b.faction,
      belly: false,
      whistle: true,
      target: (out) => this.busAt(c, out),
      vel: (out) => this.busVel(c, out),
      speed: c.speed,
      turn: T.capTurn,
      // (set each frame from the seconds left: busVel)
      white: 0,
      hitRadius: T.capHit,
      maxTime: 6,
      onWhite: () => {
        c.steer0 = H.steer();
        this.qa.capWhite++;
        if (c.first) this.first.white = H.sim.t;
        H.say(['FLICK!'], 0.6, 2);
      },
      onHit: () => {
        this.qa.capHits++;
        if (c.first) this.ended('hit');
        H.sim.aimedHit(id, 0);
      },
      onMiss: (_at, _s, why) => {
        this.qa.capMisses++;
        this.qa.capWhy = why;
        if (c.first) this.ended(why);
        if (why !== 'dodged') return;
        H.count('dodged');
        // (the first dodge teaches the other half)
        H.say(this.taught ? ['DODGED!'] : ['DODGED!', 'HOLD ON A BUS TO LOCK IT'], this.taught ? 0.9 : 2.4, 2);
        this.taught = true;
      },
    };
    c.shot = H.holds.fire(c.o);
    if (!c.shot) {
      this.qa.capRefused++;
      return;
    }
    this.incoming.push(c);
    this.qa.capFired++;
    if (this.first.fired < 0) this.first.fired = H.sim.t;
  }

  private ended(how: string): void {
    this.first.ended = this.host.sim.t;
    this.first.how = how;
  }

  /** The captain a shot of the player's is after: where it is, pulled onto a white shot's line if that passes near it, or pushed off it once it has dodged. */
  private captainAt(m: Mine, out: THREE.Vector3): boolean {
    if (!this.host.playing()) return false;
    this.at(m.id, out);
    const s = m.shot;
    if (s && s.white) this.offLine(s, out, m.dodged ? m.r + duelTune.clear : 0, m.dodged ? 0 : m.assist);
    return true;
  }

  private captainVel(m: Mine, out: THREE.Vector3): void {
    const H = this.host, b = H.sim.buses[m.id];
    out.set(Math.cos(b.heading) * b.speed, 0, Math.sin(b.heading) * b.speed);
    this.chord(this.at(m.id, this.q), out, b.driverYaw + b.edgeYaw, m.shot ? m.shot.pos : H.holds.bus(this.p), m.speed);
  }

  /** The player's bus, for a captain's shot: where it is, or sliding off the white shot's line once a flick or a hard turn has dodged it. */
  private busAt(c: Incoming, out: THREE.Vector3): boolean {
    const T = duelTune;
    if (!this.host.playing()) return false;
    this.host.holds.bus(out);
    const s = c.shot;
    if (s && s.white && c.dodged) this.offLine(s, out, (T.capHit + T.clear) * Math.min(1, (this.t - c.dodgedAt) / T.lungeTime), 0);
    return true;
  }

  private busVel(c: Incoming, out: THREE.Vector3): void {
    const H = this.host;
    H.holds.busVel(out);
    c.eta = this.chord(H.holds.bus(this.q), out, this.omega, c.shot ? c.shot.pos : c.at, c.speed);
    // (Hold.ts's white is by the distance left over the shot's speed, which is no measure of time for a bus coming at the shot or flying from it: set from the
    //  seconds until they meet, the white is a level's real seconds whatever the bus's gear. Hold.ts reads `white` each frame: HOOKS.md)
    if (c.o) c.o.white = c.eta <= c.whiteFor ? 1e9 : 0;
  }

  /**
   * `v` (world m/s) made the chord of a turn: a bus at `p` going `v` and yawing `w` rad/s, met by a shot from `from` at `speed`: its mean velocity until they
   * meet, and the seconds until they do. Hold.ts leads a straight line; with this a bus circling is led as surely, so only a change of turn inside the white takes it off the shot's line.
   */
  private chord(p: THREE.Vector3, v: THREE.Vector3, w: number, from: THREE.Vector3, speed: number): number {
    const most = duelTune.leadMost, vx = v.x, vz = v.z;
    let t = Math.min(most, Math.max(1e-3, p.distanceTo(from) / speed));
    for (let i = 0; i < 16; i++) {
      this.sweep(vx, vz, w, t);
      const next = Math.min(most, Math.max(1e-3, Math.hypot(p.x + this.ax - from.x, p.y + v.y * t - from.y, p.z + this.az - from.z) / speed));
      if (Math.abs(next - t) < 1e-3) break;
      t = next;
    }
    this.sweep(vx, vz, w, t);
    v.x = this.ax / t;
    v.z = this.az / t;
    return t;
  }

  /** How far a bus going (vx, vz) m/s and yawing `w` rad/s goes in `t` s, into (ax, az): the velocity turns with the nose, so it sweeps an arc. */
  private sweep(vx: number, vz: number, w: number, t: number): void {
    const a = w * t, sn = Math.abs(a) > 1e-4 ? Math.sin(a) / w : t, cs = Math.abs(a) > 1e-4 ? (1 - Math.cos(a)) / w : 0;
    this.ax = vx * sn - vz * cs;
    this.az = vz * sn + vx * cs;
  }

  /**
   * `p` against shot `s`'s line: pushed `push` m further off it, on the side it's on (up, from dead on it); or, with `pull`, set on it if it's within that of it,
   * which is a hit as the shot goes by.
   */
  private offLine(s: HomingShot, p: THREE.Vector3, push: number, pull: number): void {
    const n = this.v.copy(p).sub(s.pos);
    n.addScaledVector(s.dir, -n.dot(s.dir));
    const off = n.length();
    if (pull > 0) {
      if (off <= pull) p.sub(n);
      return;
    }
    if (off < 0.5) {
      n.set(0, 1, 0).addScaledVector(s.dir, -s.dir.y);
      if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
    }
    p.addScaledVector(n.normalize(), push);
  }

  // ---- the pick

  /** The captain nearest screen point (sx, sy) that may be locked: -1 for none. */
  private pick(sx: number, sy: number): number {
    const T = duelTune, H = this.host, me = H.sim.buses[0];
    if (!H.playing() || me.state === 'shield' || me.state === 'bubble') return -1;
    let best = -1, near = Infinity;
    for (const b of H.sim.buses) {
      if (b.id === 0 || !this.seen(b.id)) continue;
      // (its drawn half-size, from a point that far up it: SHOTS.md, "or its drawn size + 16 px")
      const s = this.s, s2 = this.s2;
      H.holds.screenOf(this.p.copy(this.q).setY(this.q.y + H.sizeOf(b.id)), s2);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d <= Math.max(T.pickPx, Math.hypot(s2.x - s.x, s2.y - s.y) + T.sizePx) && d < near) {
        near = d;
        best = b.id;
      }
    }
    return best;
  }

  /** Captain `id` may be locked by the player: a rival, free, in reach. */
  private lockable(id: number): boolean {
    const H = this.host, b = H.sim.buses[id], me = H.sim.buses[0];
    return H.playing() && !!b && H.sim.canLock(me, b) && this.at(id, this.q).distanceTo(H.holds.bus(this.p)) <= duelTune.reach;
  }

  /** Captain `id` may be locked, and is on the screen and in sight (its point left in `q`, its screen point in `s`). */
  private seen(id: number): boolean {
    return this.lockable(id) && this.host.holds.screenOf(this.q, this.s) && this.host.holds.inSight(this.q);
  }

  private drop(): void {
    this.locked = -1;
    this.until = 0;
    this.clacked = this.charged = this.holding = false;
    this.holdId = -1;
    this.held = 0;
  }
}
