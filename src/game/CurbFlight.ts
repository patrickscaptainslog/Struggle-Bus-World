import { config } from '../config';
import { Ground } from '../world/tiles';
import type { CurbPose } from '../life/Curb';
import type { CameraRig } from './CameraRig';
import type { Flight, FlightInput, WorldQuery } from './Flight';
import { angleDelta, clamp } from './springs';
import { CURB, EXPRESS, SCHOOL_ZONE, type TurboDrive } from './Turbo';

// Curb, the rung under School Zone (docs/specs/shots/SHOTS.md, "Curb: cruising beside the cars"; CURB.md): the wheels on the street, rolling beside
// the cars with no steering. The lane and the pace are life's (src/life/Curb.ts, life.curb and life.curbRoll); this is the flight's side of it, the
// landing, the roll and getting off. ?life only: with no life none of this is made, and every frame is School Zone's branch's.
//
//   fly     flying low over a road (School Zone, Cruise or Express with no turbo, within config.curb.over of it, the road going on ahead) with
//           the stick pushed for config.curb.hold s asks to land, and meanwhile the floor comes down to the street (Flight.street): the dive. So
//           does a flick down in School Zone within config.curb.flickOver of the ground (TurboDrive.onCurb). The first time the bus is low over a
//           road, the one-time hint
//   ask     life looks for the kerb lane within 80 m, driven the bus's way. The bus flies on meanwhile; a rung changed takes it back
//   arc     a lane: the rung is Curb (TurboDrive.curbIn), the lens comes down, and the bus arcs onto the lane, its place and its speed both blended
//           from the bus's own to the lane's, so nothing jumps. Life's lane is caught up first by as far as the bus will run on while it slows
//           to the lane's pace, so the bus never slides back along it (life's curb.land takes no speed yet: docs/TODO.md's H1)
//   on      the roll (Flight.ride): the stick up rolls on to the next car, a look past config.curb.lookDeg takes the next junction its way, and the
//           lane paints itself behind the bus
//   leave   a flick up, the stick pulled back for config.curb.pullFor s, a gear forced on it, or the lane's end: the wheels up, School Zone
//           again (a pull climbs out at its 15 m/s, a flick hovers at the street's floor), and nothing lands for config.curb.quiet s
//   bounce  no street there, or no answer: the bus hops and says FIND A STREET, and nothing lands until the stick has let go
//
// The Hose (feat/shots) will pour from the window on the side the look is, on Curb: its place is the bus's flank at its middle, a metre over
// the road's side of it, `side` (the drive-by's) choosing which. PvP on the street (Recess's) will read `rolling`, `onLeave` with its reason
// ('flick' is the hop that beats the white, 'thrown' a gear forced by a hit), and want the captains to come down to streets.

/** What Curb asks life (src/life/Life.ts: life.curb and life.curbRoll). */
export interface CurbRoad {
  readonly curb: { readonly state: 'off' | 'asking' | 'on' | 'none'; readonly beside: string | null; land(x: number, z: number, heading: number): void; leave(): void };
  curbRoll(dt: number, push: number, look: number, out: CurbPose): boolean;
}

/** The street under the bus (City). */
export interface CurbWorld extends WorldQuery {
  groundClassAt(x: number, z: number): number | null;
  roofAt(x: number, z: number, fromY?: number): number | null;
  /** A bridge deck's roadway under (x, z) below fromY (m), or -Infinity. */
  roadwayAt(x: number, z: number, fromY: number): number;
}

export type CurbEvent =
  /** asked life for a lane */
  | 'ask'
  /** a lane: the arc down to it starts (k: the arc's length, s) */
  | 'land'
  /** the wheels touch down (k: how fast the bus came down onto them, m/s) */
  | 'touch'
  /** no street: the hop and FIND A STREET */
  | 'none'
  /** the wheels up (k: 0 a flick, 1 a pull, 2 a gear forced on it, 3 the lane's end) */
  | 'leave'
  /** rolled on past the car beside it */
  | 'pass'
  /** the look is taking the next junction (k: -1 left, 1 right) */
  | 'turn';

export type CurbLeave = 'flick' | 'pull' | 'thrown' | 'end';
const LEAVES: CurbLeave[] = ['flick', 'pull', 'thrown', 'end'];

export interface CurbHooks {
  /** The bus has been low over a road a moment: the one-time hint, if it's due (Controls). `learn`: it's learned without showing (a flick landed).
   *  False: not now (the slot is taken), ask again on another pass */
  hint(learn: boolean): boolean;
  /** What happened: the sounds, the toast, the squash (main.ts) */
  event(ev: CurbEvent, k: number): void;
  /** A dab of the lane's paint at (x, z), its rings round the landing at (ox, oz) (main.ts: GroundPaint.dab) */
  dab(x: number, z: number, ox: number, oz: number): void;
}

export interface CurbOptions {
  /** Nothing lands now: the opening's gate, ?streetcam, a Recess match, the Moon */
  off: () => boolean;
  /** &curblens=wide: the ride-along lens, not the kerb chase */
  wide: boolean;
  /** how far behind the bus's middle its rear bumper is (m) */
  rear: number;
}

export class CurbFlight {
  state: 'fly' | 'ask' | 'arc' | 'on' | 'leave' | 'bounce' = 'fly';
  /** why the wheels last went up */
  left: CurbLeave | '' = '';
  /** Recess: the wheels went up, and why */
  onLeave: ((why: CurbLeave) => void) | null = null;
  /** the side the drive-by takes (+1 right, -1 left): the look's past config.curb.sideDeg, else the kerb's */
  side = 1;
  /** QA: the band's clocks, the ask's, the arc's, what was laid and heard */
  readonly qa = { low: 0, dive: 0, asked: 0, askedFor: 0, arcT: 0, arcFor: 0, caughtUp: 0, dabs: 0, passes: 0, turns: 0, hinted: false, lane: { x: 0, y: 0, z: 0, heading: 0, speed: 0 } };
  /** where the lane has the bus (life's), and where the bus is put (its middle) */
  private readonly lane: CurbPose = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
  private readonly at: CurbPose = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
  private low = 0;
  private dive = 0;
  private gap = 0;
  /** the road under the dive, last seen (m) */
  private road0 = 0;
  private hinted = false;
  private quiet = 0;
  /** a bounce: nothing lands until the push has let go */
  private lift = false;
  private askT = 0;
  private askRung = 0;
  /** the arc: how far into it and how long (s), the bus's offset from the lane's place at its start and its rate (m, m/s), the heading it started on */
  private arcT = 0;
  private arcFor = 1;
  private readonly o0 = [0, 0, 0];
  private readonly v0 = [0, 0, 0];
  private h0 = 0;
  private vyIn = 0;
  private pullT = 0;
  private lookT = 0;
  private turned = false;
  private rolled = 0;
  private landX = 0;
  private landZ = 0;
  private wasBeside: string | null = null;
  private tootAt = -Infinity;
  private t = 0;

  constructor(
    private readonly flight: Flight,
    private readonly drive: TurboDrive,
    private readonly rig: CameraRig,
    private readonly road: CurbRoad,
    private readonly world: CurbWorld,
    private readonly hooks: CurbHooks,
    private readonly opts: CurbOptions,
  ) {
    drive.onCurb = () => this.flickDown();
    const K = config.curb;
    rig.curbLens = opts.wide ? { back: K.wideBack, eye: K.wideEye, ahead: K.wideAhead, at: K.wideAt, fov: K.wideFov } : { back: K.camBack, eye: K.camEye, ahead: K.camAhead, at: K.camAt, fov: K.camFov };
    rig.curbFloor = (x, z) => Math.max(world.groundAt(x, z), world.roadwayAt(x, z, Infinity));
  }

  /** The wheels are on the street, or coming down onto it: main.ts rolls the bus (roll()) instead of the flight's steps. */
  get rolling(): boolean {
    return this.state === 'arc' || this.state === 'on';
  }

  /**
   * A frame on the street, instead of Flight.step: life's lane, the arc down to it, the stick (the push rolls on, a pull held gets off, a look
   * takes the next junction), the paint behind.
   */
  roll(dt: number, inp: FlightInput): void {
    const K = config.curb, F = config.flight, f = this.flight;
    this.t += dt;
    // (a flick up is School Zone already, a forced gear clears the rung: off either way)
    if (this.drive.below !== CURB) {
      this.leave(this.drive.below === SCHOOL_ZONE ? 'flick' : 'thrown');
      return;
    }
    const sy = inp.dragging ? inp.sy : 0, dz = clamp(F.yokeDead, 0, 0.9);
    const push = clamp((sy - dz) / (1 - dz), 0, 1), pull = clamp((-sy - dz) / (1 - dz), 0, 1);
    // (a pull held is the wheels up; a flick's stroke, shorter, isn't)
    this.pullT = pull >= K.pullOff ? this.pullT + dt : 0;
    if (this.pullT >= K.pullFor) {
      this.leave('pull');
      return;
    }
    // (a look held past its angle takes the next junction its way, said once a look; a glance doesn't)
    const look = this.rig.lookYawNow, lookRad = (K.lookDeg * Math.PI) / 180;
    this.lookT = Math.abs(look) >= lookRad ? this.lookT + dt : 0;
    if (this.lookT === 0) this.turned = false;
    const turning = this.lookT >= K.lookFor;
    if (turning && !this.turned) {
      this.turned = true;
      this.qa.turns++;
      this.hooks.event('turn', Math.sign(look));
    }
    this.side = Math.abs(look) >= (K.sideDeg * Math.PI) / 180 ? Math.sign(look) : 1;
    const L = this.lane;
    if (!this.road.curbRoll(dt, push, turning ? look : 0, L)) {
      this.leave('end');
      return;
    }
    this.qa.lane.x = L.x;
    this.qa.lane.y = L.y;
    this.qa.lane.z = L.z;
    this.qa.lane.heading = L.heading;
    this.qa.lane.speed = L.speed;
    const at = this.at, ride = Math.max(L.y, this.world.groundAt(L.x, L.z)) + K.ride;
    at.x = L.x;
    at.y = ride;
    at.z = L.z;
    at.heading = L.heading;
    at.speed = L.speed;
    if (this.state === 'arc') {
      // (the arc: the bus's offset from the lane, eased to nothing from its own place and rate, so neither jumps; the heading the short way)
      this.arcT = Math.min(this.arcFor, this.arcT + dt);
      const s = this.arcT / this.arcFor, T = this.arcFor;
      const h00 = 2 * s * s * s - 3 * s * s + 1, h10 = s * s * s - 2 * s * s + s;
      at.x += h00 * this.o0[0] + h10 * this.v0[0] * T;
      at.y += h00 * this.o0[1] + h10 * this.v0[1] * T;
      at.z += h00 * this.o0[2] + h10 * this.v0[2] * T;
      at.heading = this.h0 + angleDelta(this.h0, L.heading) * s * s * (3 - 2 * s);
      this.qa.arcT = this.arcT;
      if (s >= 1) {
        this.state = 'on';
        this.rolled = 0;
        this.hooks.event('touch', Math.max(0, -this.vyIn));
      }
    }
    const px = f.x, pz = f.z;
    f.ride(dt, at, push, this.world);
    if (this.state !== 'on') return;
    // (the lane behind the rear bumper paints itself, a dab every few metres rolled. Not on a bridge's deck: the ground's paint is the water's under it,
    // and the deck's own trail isn't built, CURB.md)
    this.rolled += Math.hypot(f.x - px, f.z - pz);
    if (this.rolled >= K.dabEvery) {
      this.rolled -= K.dabEvery;
      const x = f.x - f.fx * this.opts.rear, z = f.z - f.fz * this.opts.rear;
      if (this.world.roadwayAt(x, z, f.y) === -Infinity) {
        this.qa.dabs++;
        this.hooks.dab(x, z, this.landX, this.landZ);
      }
    }
    // (rolled on past the car it rode beside: two toots, not too often)
    const beside = this.road.curb.beside;
    if (this.wasBeside && !beside && push > 0.3 && this.t - this.tootAt >= K.tootEvery) {
      this.tootAt = this.t;
      this.qa.passes++;
      this.hooks.event('pass', 0);
    }
    this.wasBeside = beside;
  }

  /** After the frame's flight (or its roll): the band, the ask, and the hop's and the leave's quiet. */
  watch(dt: number, inp: FlightInput): void {
    const K = config.curb, F = config.flight, f = this.flight;
    if (!this.rolling) this.t += dt;
    this.quiet = Math.max(0, this.quiet - dt);
    if ((this.state === 'leave' || this.state === 'bounce') && this.quiet === 0) this.state = 'fly';
    const sy = inp.dragging ? inp.sy : 0, dz = clamp(F.yokeDead, 0, 0.9), push = clamp((sy - dz) / (1 - dz), 0, 1);
    if (push < 0.05) this.lift = false;
    if (this.state === 'ask') {
      this.askT += dt;
      this.qa.askedFor = this.askT;
      const s = this.road.curb.state;
      // (a rung changed while it asked: the flick meant something else)
      if (this.rung() !== this.askRung) {
        this.road.curb.leave();
        this.state = 'fly';
      } else if (s === 'on') this.arc();
      else if (s === 'none' || this.askT >= K.askFor) this.bounce();
      return;
    }
    f.street = NaN;
    if (this.state !== 'fly') return;
    const road = this.quiet > 0 ? NaN : this.roadUnder();
    // (the band: low over a road, held; a crossing's cell may break it a moment. The push held there is the dive: the floor comes down to the street)
    if (!Number.isNaN(road)) {
      this.low += dt;
      this.gap = K.grace;
      if (push >= K.push && !this.lift && (!K.diveOnly || this.drive.below === SCHOOL_ZONE || f.mode === 3)) {
        this.dive += dt;
        this.road0 = road;
      } else this.dive = 0;
    } else if (this.gap > 0) this.gap -= dt;
    else this.low = this.dive = 0;
    if (this.dive > 0) f.street = this.road0;
    this.qa.low = this.low;
    this.qa.dive = this.dive;
    if (!this.hinted && this.low >= K.hintAfter && this.low - dt < K.hintAfter) this.hinted = this.qa.hinted = this.hooks.hint(false);
    if (this.dive >= K.hold) this.ask();
  }

  /** School Zone's flick down (TurboDrive.onCurb): low enough, it asks at once, wherever the bus is (life's 80 m judge it). */
  private flickDown(): void {
    const f = this.flight;
    if (this.state !== 'fly' || this.quiet > 0 || this.opts.off() || f.y - f.groundUnder > config.curb.flickOver) return;
    this.hinted = this.hooks.hint(true) || this.hinted;
    this.ask();
  }

  private ask(): void {
    const f = this.flight;
    this.low = this.dive = this.gap = 0;
    this.askT = 0;
    this.askRung = this.rung();
    this.state = 'ask';
    this.qa.asked++;
    this.road.curb.land(f.x, f.z, f.heading);
    this.hooks.event('ask', 0);
  }

  /** Life has a lane: the rung goes, and the arc down onto it starts. */
  private arc(): void {
    const K = config.curb, f = this.flight, L = this.lane;
    if (!this.road.curbRoll(1 / 60, 0, 0, L)) {
      this.bounce();
      return;
    }
    // (the bus's way along the lane and its speed that way, and how long the arc is by how far it has to come)
    const ux = Math.sin(L.heading), uz = -Math.cos(L.heading), g = f.ground;
    const vx = f.fx * g, vz = f.fz * g, along = vx * ux + vz * uz;
    const lift = Math.max(L.y, this.world.groundAt(L.x, L.z)) + K.ride;
    const off0 = Math.hypot(f.x - L.x, f.y - lift, f.z - L.z);
    const T = clamp(K.arcBase + off0 / K.arcPer, K.arcBase, K.arcMax);
    // (life's lane rolls at the road's pace from where it was asked: caught up by as far as the bus runs on while it slows to that pace, so it
    // eases down along the lane and never back up it. The thumb counts as pushed, so no car is paced meanwhile)
    const ahead = (f.x - L.x) * ux + (f.z - L.z) * uz;
    const want = ahead + Math.max(0, along - L.speed) * T * 0.5;
    let went = 0;
    for (let i = 0; i < 120 && went < want; i++) {
      const x = L.x, z = L.z;
      if (!this.road.curbRoll(Math.min(0.1, Math.max(0.01, (want - went) / Math.max(1, L.speed))), 1, 0, L)) break;
      went += Math.hypot(L.x - x, L.z - z);
    }
    this.qa.caughtUp = went;
    const y = Math.max(L.y, this.world.groundAt(L.x, L.z)) + K.ride;
    this.o0[0] = f.x - L.x;
    this.o0[1] = f.y - y;
    this.o0[2] = f.z - L.z;
    this.v0[0] = vx - ux * L.speed;
    this.v0[1] = f.vy;
    this.v0[2] = vz - uz * L.speed;
    this.vyIn = f.vy;
    this.h0 = f.heading;
    this.arcT = 0;
    this.arcFor = T;
    this.qa.arcFor = T;
    this.landX = L.x;
    this.landZ = L.z;
    this.pullT = this.lookT = 0;
    this.turned = false;
    this.wasBeside = null;
    this.state = 'arc';
    this.drive.curbIn();
    this.rig.curb = 1;
    this.hooks.event('land', T);
  }

  /** No street: the hop, and nothing lands until the push lets go. */
  private bounce(): void {
    const K = config.curb;
    this.road.curb.leave();
    this.flight.vy += K.bounceVy;
    this.quiet = K.bounceQuiet;
    this.lift = true;
    this.state = 'bounce';
    this.hooks.event('none', 0);
  }

  /** The wheels up: School Zone again (unless a gear was forced on it), a lift off the road, the lens back up. */
  leave(why: CurbLeave): void {
    if (!this.rolling) return;
    const K = config.curb;
    this.road.curb.leave();
    this.drive.curbOut();
    this.flight.vy += K.leaveVy;
    this.rig.curb = 0;
    this.quiet = K.quiet;
    this.state = 'leave';
    this.left = why;
    this.low = this.dive = 0;
    this.hooks.event('leave', LEAVES.indexOf(why));
    this.onLeave?.(why);
  }

  /** The rung, as one number: what an ask is taken back by. */
  private rung(): number {
    const d = this.drive;
    return d.below + 4 * (d.gear + 8 * d.level);
  }

  /**
   * The road under the bus if it's in the band (a gear that lands, over a road or a deck, low enough, and the road going on ahead: a street crossed
   * square is a moment of road between two blocks, not one to come down on), else NaN.
   */
  private roadUnder(): number {
    const K = config.curb, f = this.flight, d = this.drive;
    if (d.level > 0 || d.gear > EXPRESS || (d.below !== 0 && d.below !== SCHOOL_ZONE) || this.opts.off()) return NaN;
    const road = this.roadAt(f.x, f.z, f.y);
    if (Number.isNaN(road) || f.y - road > K.over) return NaN;
    return Number.isNaN(this.roadAt(f.x + f.fx * K.ahead, f.z + f.fz * K.ahead, f.y)) ? NaN : road;
  }

  /** The road at (x, z) under y: a deck's roadway, or the ground where it's paved or a pavement with no roof over it; NaN where there's none. */
  private roadAt(x: number, z: number, y: number): number {
    const w = this.world, deck = w.roadwayAt(x, z, y);
    if (deck > -Infinity) return deck;
    const c = w.groundClassAt(x, z);
    return (c !== Ground.PAVED && c !== Ground.SIDEWALK) || w.roofAt(x, z, y) !== null ? NaN : w.groundAt(x, z);
  }
}
