import * as THREE from 'three';
import { config } from '../config';
import { clamp } from './springs';
import type { City, BuildingRef } from '../world/City';
import type { Flight } from './Flight';
import type { Splatter } from './Splat';
import { Comet, shotReach, stretchMid, type CometPlan } from './Comet';
import { inputTune } from './Input';
import { blastRadiusFor } from './blastLayout';

// The Lob (docs/specs/shots/SHOTS.md, "The modes"; sb-checks' lob plan): "i want a splat where if i am pointed up, i can shoot upwards into the sky and it
// will land in the distance". A tap with the bus's body as you see it (Flight.pitch) more than config.lob.from up throws the breath off the nose like a mortar:
// it climbs at the body's angle (at most config.lob.most: a tap past it is a Lob at it), tops out 90-680 m over the mouth and comes down
// config.lob.range x sin 2θ along the aim's flat way, 1.23 km at 25 degrees, 1.6 at 45, 1.03 at 70, on the nearest building there, which glints. A dotted ring
// shows where (main.ts, PixelPipeline's ring dotted), and the hit is a tap's blast with the Comet's core, ring and pillar, the full show every time.
//
// The body latches: lifted, the steering thumb lets the bus level out under the eyes (at Cruise 72 to 41 degrees in 0.2 s), so the body as it was when the
// steering thumb lifted, or when the tap's finger landed with no steering thumb down, is what a tap throws for config.lob.latch s (0.8, where the aim
// latches what glints for config.splat.aimLatch's 0.5: a tap half a second after the lift threw a plain splat); the tap's finger landing inside a latch
// keeps its body and runs it on config.lob.latch from there, as the Comet's latch is renewed at the press, but never past twice config.lob.latch from when
// the body was latched, and only with the belly ready (Aimer.press): taps mashed on an empty belly ran it on until it was full, and threw a Lob 2.7 s after
// the last, the bus level (the Lob review's M90). A finger that slides past the tap slop commits as a steering thumb, but lifted within
// inputTune.quickTapMs it's still a tap: for that long the latch it found stays the body a tap throws, with the end it had before its own finger's landing
// ran it on (a flick, a stroke as short, gave it a new 0.8 s each time, its landing a press: the review of these fixes). A second thumb's tap, the first
// still steering, reads it live.
//
// In view: by the lens moved on by the bus's travel to the impact, it must land config.lob.above of the height over the bus, the Comet's rule on its own number; where it
// doesn't it moves out along its line a stretch at a time, and past config.lob.reach the tap is today's. The landing is the middle of a stretch of its way
// config.lob.stretch m long, counted along the bus's travel (Comet.track's odometer), so a tap lands on the same building at 30 and 60 fps and what glints
// steps along, never strobes.
//
// Latched, the landing holds too: where the frame before the lift had it, so 30 and 60 fps throw onto the same stretch; and while it's ahead and on the
// screen it stays, the bus flying on under it.
//
// Its flight is a CometPlan (CometFx draws its arc true): config.lob.flight x sin θ / sin 45 s after the inhale, a parabola leaving the mouth at θ, whose
// top over its chord is (L tan θ + drop) / 4. A wall standing into it, climbing or falling, takes it there, on its face, and the ground standing into it
// anywhere (a hill). Water is a miss with its refund.
//
// From high up nothing within the reach can show over the bus, and the Lob was gone: "I want to shoot lob shots even when I'm high elevation in the sky -
// right now it seems to remove the feature" (the producer, 2026-11-12). So where the near search finds nothing, from config.lob.highFrom (1 km) over the
// ground under the bus, it's the far Lob: no in-view rule, it lands where a throw from that height would (lobRange), out to where the city is loaded
// (Comet.ts's shotReach, about 2.75 km), always config.lob.aheadMin past the bus at the impact, its flight cut short to keep it so at the gear's speed.
// Held for its stretch and latched as the near one, the near one taking over where it's found (and then no far one again in that pull). Its blast is a
// tap's from its height (config.lob.radiusHigh), and the view dips after it (main.ts, CameraRig.ts's shotTip). At the ceiling, where the gear's limit turns
// the nose level, the pull held counts as the nose (bodyOf). Never on the Moon, whose loading isn't the city's circle.
//
// Never: in School Zone's hover (its body leans 11 degrees at most, its path reads 90 on the bob), in a dive (the path under level: Belly Flop's, later),
// under a deck or through one, and while a Bomb charges (its shot skips it, Aimer.fire). Recess's comet.clamp is told it's a Lob (HOOKS.md).

const DEG = Math.PI / 180;

/** The Lob's angle a body throws at (rad): the body, at most config.lob.most; under config.lob.from, none (NaN). */
export function lobAngle(body: number): number {
  const L = config.lob;
  return body < L.from * DEG ? NaN : Math.min(body, L.most * DEG);
}

/** Its flight after the inhale at angle a (s): config.lob.flight at 45 degrees, x sin a / sin 45. */
export function lobFlight(a: number): number {
  return (config.lob.flight * Math.sin(a)) / Math.SQRT1_2;
}

/** How far a far Lob is thrown from the mouth at angle a (m), the bus `drop` m over the ground: a thrown thing landing config.lob.highFrom under it less,
 *  range x cos a x (sin a + sqrt(sin^2 a + 2 H / range)). At H 0 it's range x sin 2a, the near Lob's, so the two join with no step. */
export function lobRange(a: number, drop: number): number {
  const L = config.lob, H = Math.max(0, drop - L.highFrom), s = Math.sin(a);
  return L.range * Math.cos(a) * (s + Math.sqrt(s * s + (2 * H) / L.range));
}

/** The body a Lob reads (rad, Lob.body and Aimer's latch): Flight.pitch, but straining at the ceiling (config.lob.ceilStrain), where the gear's limit turns
 *  the nose level and the body follows it, the nose the pull asks for (Flight.noseWant), at most config.flight.pitchMax. */
export function bodyOf(f: Flight): number {
  return f.strain > config.lob.ceilStrain ? Math.max(f.pitch, Math.min(f.noseWant, config.flight.pitchMax * DEG)) : f.pitch;
}

/** Its arc's top over its chord (m) for a throw L m out leaving at angle a, landing `drop` m under the mouth: the parabola that leaves at a. */
export function lobArc(L: number, a: number, drop: number): number {
  return Math.max(0, (L * Math.tan(a) + drop) / 4);
}

export class Lob {
  /** The lens the player sees (main.ts: the render camera, as last drawn; the sims their own). Null: no in-view rule. */
  lens: THREE.Camera | null = null;
  /** the body latched (rad), and whether the path was under level then, from latchedAt (game s, when it was the body) until latchUntil */
  private latched = 0;
  private latchedDive = false;
  private latchedAt = -1;
  private latchUntil = -1;
  /** the latch's end before the last press ran it on (-1: it didn't), the end a stroke that press became parks */
  private ranFrom = -1;
  /** a latch a steering stroke found (game s it began, -1 none), with when it was latched and its end: while the stroke may still be a quick tap, it's
   *  the body a tap throws */
  private parked = 0;
  private parkedDive = false;
  private parkedFrom = -1;
  private parkedUntil = -1;
  private parkedAt = -1;
  /** as fired() found them, for unfired() */
  private firedHeld = false;
  private firedUntil = -1;
  private firedParked = -1;
  private firedFar = false;
  /** the landing held: the stretch its search began from (the throw's own), where it is, what it's on */
  private heldOk = false;
  private heldK0 = 0;
  private heldX = 0;
  private heldY = 0;
  private heldZ = 0;
  private heldT: BuildingRef | null = null;
  /** ...taken from the landing it hid (land: its own face in the climb still takes it) */
  private heldHid = false;
  private heldAngle = 0;
  /** ...and it's the far one's (its landing as below) */
  private heldFar = false;
  /** the far Lob's landing, held for its stretch (farK) apart from the near search, which runs first each frame */
  private farOk = false;
  private farK = 0;
  private farX = 0;
  private farY = 0;
  private farZ = 0;
  private farT: BuildingRef | null = null;
  private farHid = false;
  /** this pull planned a far Lob (the far branch stays open down to config.lob.highBack), and a near one was found after it (no far one again until a tap
   *  throws: fired) */
  private farOpen = false;
  private farBarred = false;
  private firedBarred = false;
  /** QA (the sims): the last far plan's stretch middle, what it aimed for, the bus's travel to its impact and the reach (m along the way), its flight (s),
   *  and whether it kept a latched stretch (picked on an earlier frame) */
  readonly farLast = { mid: 0, want: 0, atImp: 0, reach: 0, travel: 0, latched: false };
  /** the last plan's landing after its march (a wall's face, a hillside), for the landing held: a latch keeps it whole, so a grazed wall can't come and go */
  private lastOk = false;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private lastT: BuildingRef | null = null;
  private lastWall = false;
  private lastShare = 1;
  private readonly v = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly landPt = { x: 0, z: 0 };
  private readonly pt = { x: 0, z: 0 };
  /** this plan's lens moved on by the bus's travel to the impact (m), and the bus's height on it (NDC) */
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private busY = 0;
  readonly stats = { planned: 0, fired: 0 };
  /** its own table of the bus's travel (Comet.flown): the Comet's is filled for the speed it was last asked, within 0.5 m/s, and asking it at another
   *  moved a Comet's landing 0.2 m in the probe */
  private readonly travel: Comet;

  constructor(
    private readonly city: City,
    private readonly splatter: Splatter,
    private readonly comet: Comet,
  ) {
    this.travel = new Comet(city, splatter);
  }

  /** The steering thumb lifted (the body and path as they were with it down: Aimer.update), or a tap's finger landed with none down (Aimer.press): that body
   *  is what a tap throws until game time `until`. keep: a press inside a latch keeps its body, the body having dropped since the lift, and runs it on to
   *  `until` (a tap lifted 0.53 s after the steering thumb threw the dropped body, a plain splat at 60 fps and a Lob at 30), at most twice config.lob.latch
   *  past when the body was latched. quick: the steering stroke lifting was short enough to be a tap (Aimer.update): the latch it found as it began, if any,
   *  is the one, ending when it would have. */
  latch(body: number, nose: number, t: number, until: number, keep = false, quick = false): void {
    const parked = quick && this.parkedAt >= 0;
    this.parkedAt = -1;
    this.ranFrom = -1;
    if (parked) {
      this.latched = this.parked;
      this.latchedDive = this.parkedDive;
      this.latchedAt = this.parkedFrom;
      this.latchUntil = this.parkedUntil;
      return;
    }
    if (keep && t < this.latchUntil) {
      this.ranFrom = this.latchUntil;
      this.latchUntil =Math.min(Math.max(this.latchUntil, until), this.latchedAt + 2 * config.lob.latch);
      return;
    }
    this.latched = body;
    this.latchedDive = nose < -config.lob.levelSlack * DEG;
    this.latchedAt = t;
    this.latchUntil = until;
  }

  /** Steering again: the latch lets go, and a tap reads the body live, but for a stroke's first inputTune.quickTapMs (a slid tap: parked, ending where it
   *  did before the stroke's own landing ran it on). */
  unlatch(t: number): void {
    const until = this.ranFrom >= 0 ? this.ranFrom : this.latchUntil;
    if (t < until) {
      this.parked = this.latched;
      this.parkedDive = this.latchedDive;
      this.parkedFrom = this.latchedAt;
      this.parkedUntil = until;
      this.parkedAt = t;
    }
    this.latchUntil = this.ranFrom = -1;
  }

  /** A latch parked by a stroke that may still be a quick tap. */
  private parkedNow(t: number): boolean {
    return this.parkedAt >= 0 && t - this.parkedAt <= inputTune.quickTapMs / 1000;
  }

  /** The body a tap throws now (rad): latched, parked, or live. */
  body(f: Flight, t: number): number {
    return t < this.latchUntil ? this.latched : this.parkedNow(t) ? this.parked : bodyOf(f);
  }

  /** The path under level, as the body reads (a dive never lobs). */
  private diving(f: Flight, t: number): boolean {
    return t < this.latchUntil ? this.latchedDive : this.parkedNow(t) ? this.parkedDive : f.nose < -config.lob.levelSlack * DEG;
  }

  /** No Lob now: nothing held. */
  private none(): null {
    this.heldOk = this.lastOk = this.farOk = this.heldFar = false;
    return null;
  }

  /** No Lob, the pull over (the body down, a dive, the hover): the far branch shuts. */
  private ended(): null {
    this.farOpen = this.farBarred = false;
    return this.none();
  }

  private ndcY(x: number, y: number, z: number): number {
    const c = this.lens!, v = this.v.set(x, y, z).applyMatrix4(c.matrixWorldInverse);
    if (v.z >= -1) return -Infinity;
    return v.applyMatrix4(c.projectionMatrix).y;
  }

  /** How far over the bus a point shows at the impact, by this plan's lens moved on (share of the height; 1 without a lens, -1 behind it). */
  private showsAt(x: number, y: number, z: number): number {
    if (!this.lens) return 1;
    const q = this.ndcY(x - this.ox, y - this.oy, z - this.oz);
    return q === -Infinity ? -1 : (q - this.busY) * 0.5;
  }

  /** Where it lands for the stretch whose middle is d m along the way (held*): the nearest building to there (its landing as Splatter.barf lands on it), or
   *  the ground. False: Recess's clamp says no. */
  private land(f: Flight, fx: number, fz: number, d: number): boolean {
    let x = f.x + fx * d, z = f.z + fz * d;
    if (this.comet.clamp) {
      this.pt.x = x;
      this.pt.z = z;
      if (!this.comet.clamp(this.pt, 'lob')) return false;
      x = this.pt.x;
      z = this.pt.z;
    }
    const drop = Math.max(0, f.y - this.city.surfaceAt(x, z, f.y));
    const r = this.splatter.pick(x, z, this.splatter.pickRadius(drop), f.y);
    let y: number;
    if (r) {
      const l = this.city.landingOn(r, x, z, config.splat.landInset, this.landPt, config.splat.smallRad);
      x = l.x;
      z = l.z;
      y = this.city.roofAtPart(r, x, z, f.y) + 0.5;
    } else y = this.city.groundAt(x, z);
    this.heldHid = false;
    this.heldOk = true;
    this.heldX = x;
    this.heldY = y;
    this.heldZ = z;
    this.heldT = r;
    return true;
  }

  /** The building that hides (x, y, z) from the lens, the nearest the lens of those standing over its line of sight from config.lob.hideFrom m past the
   *  bus to config.lob.hideClear m short of it (nearer, the blast reaches it), or null. */
  private hider(f: Flight, x: number, y: number, z: number, target: BuildingRef | null): BuildingRef | null {
    if (!this.lens) return null;
    const L = config.lob, c = this.eye.setFromMatrixPosition(this.lens.matrixWorld);
    const s0 = Math.hypot(f.x - c.x, f.z - c.z) + L.hideFrom;
    // (from the lens moved on to the impact, as showsAt judges the landing: by then the bus is 100-250 m nearer it, and what hides it is judged from there)
    c.x += this.ox;
    c.y += this.oy;
    c.z += this.oz;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z, D = Math.hypot(dx, dz);
    for (let s = s0; s < D - L.hideClear; s += L.hideStep) {
      const u = s / D, px = c.x + dx * u, pz = c.z + dz * u;
      const ref = this.city.buildingAbove(px, pz, c.y + dy * u);
      if (ref && ref !== target && ref.roofY - ref.baseY >= config.splat.minTargetHeight) return ref;
    }
    return null;
  }

  /**
   * The Lob a tap throws now, or null (the body under config.lob.from, School Zone, a dive, a deck overhead, nothing in view within the reach: the tap is
   * today's). fx, fz: the aim's flat way (the nose turned by a look). t: game time (the latch's clock). Every frame past config.lob.from (Aimer.update).
   */
  plan(f: Flight, fx: number, fz: number, out: CometPlan, t: number): CometPlan | null {
    const a = lobAngle(this.body(f, t));
    if (Number.isNaN(a) || f.turbo.hover > 0 || f.hovering || this.diving(f, t)) return this.ended();
    const city = this.city;
    // (under a deck: the Golden Gate's low shot, the Bay Bridge's lower deck)
    if (city.overheadAt(f.x, f.z, f.y) !== Infinity) return this.none();
    const L = config.lob, S = config.splat;
    this.stats.planned++;
    const latched = t < this.latchUntil;
    const v = Math.max(1, f.ground);
    let travel = lobFlight(a), tImp = S.inhale + travel;
    // (the bus's travel to the impact at the speed it flies once the nose is down: up steep its speed over the ground is a fraction of it, 64 of Nonstop's 225
    // m/s at 73 degrees, and the lens moved on that little put a landing on the screen that came down under the bus)
    const vt = Math.max(v, f.turbo.speed > 0 ? f.turbo.speed : f.speed);
    let atImp = this.travel.flown(vt, tImp);
    const launch = this.travel.flown(v, S.inhale);
    // (the lens moved on by the bus's travel to the impact, a climb in it: the Comet's)
    this.ox = fx * atImp;
    this.oz = fz * atImp;
    // (a lifted thumb levels the bus out in about config.lob.climbFor; one still pulling climbs on, a second thumb tapping)
    this.oy = Math.max(0, f.vy) * Math.min(tImp, latched ? L.climbFor : L.climbLive);
    this.busY = this.lens ? this.ndcY(f.x, f.y, f.z) : 0;
    // the throw from the mouth, then the stretch it's in (counted along the bus's travel: Comet.track's odometer), moved out a stretch at a time to show
    const odo = this.comet.odometer, Ls = L.stretch;
    const d0 = launch + L.range * Math.sin(2 * a);
    let k = Math.round((odo + d0) / Ls - 0.5);
    const hold = this.heldOk && !this.heldFar && Math.abs(this.heldAngle - a) < 1e-6;
    let frozen = false, far = false;
    // (the far one latched: as it was, while it's still inside the reach and aheadMin past the bus at the impact. Its own flight's numbers, below)
    const farHeld = this.heldFar && latched && Math.abs(this.heldAngle - a) < 1e-6 ? this.farPlan(f, fx, fz, a, vt, launch, true) : NaN;
    if (farHeld >= 0) {
      far = true;
      frozen = this.lastOk;
      travel = farHeld;
    } else if (hold && latched && (this.heldX - f.x) * fx + (this.heldZ - f.z) * fz > atImp && this.showsAt(this.heldX, this.heldY, this.heldZ) >= L.above) {
      // (latched: the landing as it was, while it's ahead of the bus at the impact and shows over it, its march's too)
      frozen = this.lastOk;
    } else if (this.heldOk && !this.heldFar && this.heldK0 === k && this.showsAt(this.heldX, this.heldY, this.heldZ) >= L.above) {
      // (the throw's own stretch the same: the same landing, nothing picked again, while it shows `above`, a pull's body changing or not. One moved out a
      // stretch or more to show is held by the stretch its search began from. Held by where it ended, and only for the same body to 1e-6, every frame of a
      // pull searched afresh against aboveNew)
      this.heldAngle = a;
    } else {
      let found = false;
      for (let dc = (k + 0.5) * Ls - odo; dc <= L.reach; dc += Ls, k++) {
        if (!this.land(f, fx, fz, dc)) return this.none();
        if (this.showsAt(this.heldX, this.heldY, this.heldZ) >= L.aboveNew) {
          found = true;
          break;
        }
      }
      if (found) {
        // (a near one found: it takes over, and no far one again in this pull, so no ring jumping back and forth)
        if (this.farOpen) this.farBarred = true;
        this.heldFar = this.farOk = false;
        this.heldK0 = Math.round((odo + d0) / Ls - 0.5);
        this.heldAngle = a;
      } else {
        const fp = this.farPlan(f, fx, fz, a, vt, launch, false);
        if (!(fp >= 0)) return this.none();
        far = true;
        travel = fp;
        this.heldAngle = a;
      }
    }
    if (far) {
      // (its own flight: the lens moved on to its impact, for the tower that hides it)
      tImp = S.inhale + travel;
      atImp = this.travel.flown(vt, tImp);
      this.ox = fx * atImp;
      this.oz = fz * atImp;
      this.oy = Math.max(0, f.vy) * Math.min(tImp, latched ? L.climbFor : L.climbLive);
    }
    let x = this.heldX, y = this.heldY, z = this.heldZ, target = this.heldT;
    // its arc from the mouth: a wall or the ground standing into it takes it on its face, where it meets it
    const x0 = f.x + fx * launch, z0 = f.z + fz * launch, y0 = f.y + f.vy * S.inhale;
    let Lh = 0, arc = 0, wall: BuildingRef | null = null, hill = false, ws = 0, wstep = 8;
    for (let pass = 0; pass < 2; pass++) {
      Lh = Math.hypot(x - x0, z - z0);
      arc = lobArc(Lh, a, y0 - y);
      wall = null;
      hill = false;
      ws = frozen ? Lh : 0;
      wstep = 8;
      let prevY = y0;
      for (let s = 8, ds = 8; !frozen && s < Lh - S.wallSkip; s += ds) {
        const u = s / Lh, ay = y0 + (y - y0) * u + arc * 4 * u * (1 - u), px = x0 + (x - x0) * u, pz = z0 + (z - z0) * u;
        // (a far one's next step: 8 m along the ground while it's marchFine over it, then at most 8 m of height: its plunge from high up is as steep as 12 to 1)
        const step = ds;
        if (far) ds = ay - city.groundAt(px, pz) > L.marchFine ? 8 : Math.max(0.5, Math.min(8, (8 * Lh) / Math.max(1e-6, Math.abs(y - y0 + arc * 4 * (1 - 2 * u)))));
        if (ay < city.groundAt(px, pz) + S.wallClear) {
          hill = true;
          ws = s;
          wstep = step;
          break;
        }
        // (a deck it would pass through, climbing or falling: no Lob, as under one. Asked at the bus alone, a throw just short of the Golden Gate climbed
        // through its deck)
        if (city.overheadAt(px, pz, Math.min(prevY, ay)) <= Math.max(prevY, ay) + S.wallClear) return this.none();
        prevY = ay;
        // (a wall standing into it, climbing or falling, takes it on its face: asked in its fall alone, a tower 200-400 m out downtown was flown through on
        // the way up. The tower that hid the landing, taken on its roof, still takes it on its face where it stands in the climb)
        const ref = city.buildingAbove(px, pz, ay + S.wallClear, ay);
        if (!ref || (ref === target && !this.heldHid) || ref.roofY - ref.baseY < S.minTargetHeight) continue;
        wall = ref;
        ws = s;
        wstep = step;
        break;
      }
      // (clear all the way, but a tower standing in front of it on the screen takes it, on its roof at its middle, while that shows, and its arc is asked
      // again: from the roofs a landing 1.5 km off is seen 3-5 degrees under the eye, a tower 250-400 m nearer stood over its ring, and the blast came down
      // out of sight behind it, the tower bare. Its middle, as where the eye's line met it moved with the lens, 12 m apart at 30 and 60 fps)
      if (pass > 0 || frozen || wall || hill || this.heldHid) break;
      const h = this.hider(f, x, y, z, target);
      if (!h) break;
      const l = city.landingOn(h, h.cx, h.cz, S.landInset, this.landPt, S.smallRad), hy = city.roofAtPart(h, l.x, l.z) + 0.5;
      if (!far && this.showsAt(l.x, hy, l.z) < L.aboveNew) break;
      x = this.heldX = l.x;
      y = this.heldY = hy;
      z = this.heldZ = l.z;
      target = this.heldT = h;
      this.heldHid = true;
      if (far) this.keepFar();
    }
    let lt = Lh, larc = arc;
    if (frozen && this.lastShare < 1) {
      // (the held march: where it met a wall's face or a hillside, the flight as far along its parabola as then)
      x = this.lastX;
      y = this.lastY;
      z = this.lastZ;
      target = this.lastT;
      lt = Lh * this.lastShare;
      larc = lobArc(Math.hypot(x - x0, z - z0), a, y0 - y);
      wall = this.lastWall ? target : null;
    } else if (wall || hill) {
      let lo = ws - wstep, hi = ws;
      for (let i = 0; i < 6; i++) {
        const m = (lo + hi) * 0.5;
        if (this.into(m, wall, x0, y0, z0, x, y, z, Lh, arc)) hi = m;
        else lo = m;
      }
      const w = Math.max(4, lo - 0.6), u = w / Lh;
      const ux = (x - x0) / Lh, uz = (z - z0) / Lh;
      const wy = y0 + (y - y0) * u + arc * 4 * u * (1 - u);
      x = x0 + ux * w;
      z = z0 + uz * w;
      y = wall ? wy : city.groundAt(x, z);
      target = wall;
      // (the same parabola cut short where it meets the face: its top over the new chord, the flight as far along it)
      lt = w;
      larc = lobArc(w, a, y0 - y);
    }
    if (!frozen) {
      this.lastOk = true;
      this.lastX = x;
      this.lastY = y;
      this.lastZ = z;
      this.lastT = target;
      this.lastWall = !!wall;
      this.lastShare = lt / Math.max(1, Lh);
    }
    const along = (x - f.x) * fx + (z - f.z) * fz;
    out.x0 = x0;
    out.y0 = y0;
    out.z0 = z0;
    out.x = x;
    out.y = y;
    out.z = z;
    out.target = target;
    out.wall = !!wall;
    out.arc = larc;
    out.travel = travel * (lt / Math.max(1, Lh));
    out.drop = Math.max(0, f.y - y);
    out.reach = Math.hypot(x - f.x, z - f.z);
    out.ahead = along - atImp;
    out.pass = (along - atImp) / vt;
    out.speed = v;
    out.loaded = city.terrainAt(x, z) !== null;
    out.above = this.showsAt(x, y, z);
    out.kind = 'lob';
    out.angle = a;
    out.far = far;
    return out;
  }

  /**
   * The far Lob's flight (s; NaN: none, a number and not an object, nothing made a frame), where the near search found nothing: the bus config.lob.highFrom over the ground under it (down to highBack once this pull
   * has had one), off the Moon. Its flight is lobFlight's, longer from high up, at most flightHigh, and cut so its impact is aheadMin and a stretch short of
   * the reach at the gear's speed vt (under flightMin, none); it lands on the stretch whose middle is nearest where a throw from that height would land
   * (lobRange, from the mouth), at least aheadMin past the bus at the impact and inside the reach. Held for its stretch, or `latched` while that stretch is
   * still inside both. Leaves the landing in held*.
   */
  private farPlan(f: Flight, fx: number, fz: number, a: number, vt: number, launch: number, latched: boolean): number {
    const L = config.lob, S = config.splat, city = this.city, Ls = L.stretch, odo = this.comet.odometer;
    const H = f.y - city.groundAt(f.x, f.z);
    if (H < L.highBack) this.farOpen = false;
    if (city.isMoon || this.farBarred || !(H >= L.highFrom || (this.farOpen && H >= L.highBack))) return NaN;
    // (cut a stretch short of the reach, so a stretch's middle is always both aheadMin past the bus at the impact and inside it)
    const reach = shotReach(city, f, fx, fz), room = reach - L.aheadMin - Ls;
    if (room <= 0) return NaN;
    const travel = Math.min(L.flightHigh, lobFlight(a) + (L.fallPerKm * Math.max(0, H - L.highFrom)) / 1000, this.travel.timeTo(vt, room) - S.inhale);
    if (!(travel >= L.flightMin)) return NaN;
    const atImp = this.travel.flown(vt, S.inhale + travel), lo = atImp + L.aheadMin;
    const want = Math.min(reach, Math.max(launch + lobRange(a, H), lo));
    const q = this.farLast;
    q.want = want;
    q.atImp = atImp;
    q.reach = reach;
    q.travel = travel;
    q.latched = latched;
    if (latched) {
      const m = stretchMid(this.farK, Ls, odo);
      if (!this.farOk || m < lo || m > reach) return NaN;
      q.mid = m;
      this.useFar();
      return travel;
    }
    let k = Math.round((odo + want) / Ls - 0.5);
    while (stretchMid(k, Ls, odo) > reach) k--;
    while (stretchMid(k, Ls, odo) < lo) k++;
    q.mid = stretchMid(k, Ls, odo);
    if (this.farOk && this.farK === k) this.useFar();
    else {
      if (!this.land(f, fx, fz, q.mid)) return NaN;
      this.farK = k;
      this.keepFar();
    }
    this.farOpen = true;
    return travel;
  }

  /** The far landing back into held* (the near search ran over them)... */
  private useFar(): void {
    this.heldX = this.farX;
    this.heldY = this.farY;
    this.heldZ = this.farZ;
    this.heldT = this.farT;
    this.heldHid = this.farHid;
    this.heldOk = this.heldFar = true;
  }

  /** ...or held* kept as the far one's. */
  private keepFar(): void {
    this.farX = this.heldX;
    this.farY = this.heldY;
    this.farZ = this.heldZ;
    this.farT = this.heldT;
    this.farHid = this.heldHid;
    this.farOk = this.heldOk = this.heldFar = true;
  }

  /** Is the arc from (x0, y0, z0) to (x, y, z), Lh m long and `arc` over its chord, into `ref` (a wall's) or the ground s m along? */
  private into(s: number, ref: BuildingRef | null, x0: number, y0: number, z0: number, x: number, y: number, z: number, Lh: number, arc: number): boolean {
    const u = s / Lh, ay = y0 + (y - y0) * u + arc * 4 * u * (1 - u), px = x0 + (x - x0) * u, pz = z0 + (z - z0) * u;
    if (ref) return this.city.contains(ref, px, pz);
    return ay < this.city.groundAt(px, pz) + config.splat.wallClear;
  }

  /** ?moon: the map slid by (dx, dz). The march's landing slides with the landing held: a latch hands it back whole. */
  slide(dx: number, dz: number): void {
    this.heldX -= dx;
    this.heldZ -= dz;
    this.farX -= dx;
    this.farZ -= dz;
    this.lastX -= dx;
    this.lastZ -= dz;
  }

  /** The shot a plan throws (Aimer.fire): the next one is picked afresh, and the next tap reads the body anew. */
  fired(): void {
    this.firedHeld = this.heldOk;
    this.firedFar = this.farOk;
    this.firedBarred = this.farBarred;
    this.firedUntil = this.latchUntil;
    this.firedParked = this.parkedAt;
    // (and the bar on the far one goes: a near Lob thrown, the tower behind, the pull still held, the next tap was the plain splat. The review, 5)
    this.heldOk = this.farOk = this.farBarred = false;
    this.latchUntil = this.ranFrom = -1;
    this.parkedAt = -1;
    this.stats.fired++;
  }

  /** The shot fired() gave didn't leave (Aimer.unfire): its landing, its latch and the count as they were. */
  unfired(): void {
    this.heldOk = this.firedHeld;
    this.farOk = this.firedFar;
    this.farBarred = this.firedBarred;
    this.latchUntil = this.firedUntil;
    this.parkedAt = this.firedParked;
    this.stats.fired--;
  }
}

/** Where along its flight a Lob tops its arc (0 the mouth, 1 the landing: it flies its chord at an even pace, CometFx.at). */
export function lobTop(p: CometPlan): number {
  const rise = p.y - p.y0;
  return p.arc > 0 ? clamp(0.5 + rise / (8 * p.arc), 0, 1) : rise > 0 ? 1 : 0;
}

/** How far a Lob falls from its arc's top onto where it lands (m): the parabola's highest point over its landing. */
export function lobFall(p: CometPlan): number {
  const rise = p.y - p.y0, u = lobTop(p);
  return Math.max(0, p.y0 + rise * u + p.arc * 4 * u * (1 - u) - p.y);
}

/** Its blast's radius (m): a tap's for the fall from its top (blastRadiusFor(lobFall)), at most config.lob.radius. Sized by the bus's height over the
 *  landing (a tap's), a throw from the roofs onto a roof as high came down 85-89 m wide, where the plan has it falling hundreds of metres. */
export function lobRadius(p: CometPlan): number {
  // (a far one's is a tap's from its height, 255 m from about 1 km up, at most config.lob.radiusHigh: the producer's call)
  if (p.far) return Math.min(config.lob.radiusHigh, blastRadiusFor(p.drop));
  return Math.min(config.lob.radius, blastRadiusFor(lobFall(p)));
}

/** A Lob's arc onto a point it was moved to (CraterPaint.aim: the crater in its ring): the same throw's parabola, from its mouth to there. */
export function relob(p: CometPlan): void {
  if (p.kind !== 'lob' || p.angle === undefined) return;
  p.arc = lobArc(Math.hypot(p.x - p.x0, p.z - p.z0), p.angle, p.y0 - p.y);
}
