import { config } from '../config';
import { clamp } from './springs';
import type { City, BuildingRef } from '../world/City';
import type { Flight } from './Flight';
import type { BarfOpts, Splatter } from './Splat';
import { chooseShot, type Comet, type CometPlan } from './Comet';
import { lobRadius, type Lob } from './Lob';
import { inputTune } from './Input';

// Dragon-breath aim. One source of truth: the building that glints is the
// building a tap hits.
//
// - The aim point: a forward-down ray from the bus (config.splat.aimDown) cast
//   against roofs, trees and terrain, so from altitude the breath lands
//   mid-screen where the player is looking; near the rooftops that ray lands
//   under the nose and the classic range ahead wins. A building standing in the
//   line of fire before the aim point (a tower's wall) takes the shot instead:
//   the jet is a straight blast, it never flies through a building.
// - The target is picked every frame (by true footprint distance: wherever you
//   aim into a tower or a warehouse, that's the one), and held while the aim
//   point stays within config.splat.aimHold of it, so it doesn't strobe from lot
//   to lot at speed. A building in the line of fire always takes over.
// - Latch: lifting the steering thumb (to tap) or touching down freezes the
//   target for config.splat.aimLatch s, while the bus straightens and slows
//   under the player's eyes: the tap hits what glinted when they committed.
// - fire() hands the glinting building itself to Splatter.barf (never a
//   centroid to re-pick from).
// - A look turns the aim with the view, sideways only (lookYaw, CameraRig's
//   aimYaw): the glint stays in its usual spot on the screen and the world turns
//   under it, because the view turns about the bus and so does this.
// - The Comet (a gear at speed) and the Lob (the body nose up) plan the tap's shot every frame where they apply, and what glints is where it lands
//   (Comet.ts's chooseShot picks between them). Lifting the steering thumb latches the Lob's body as it was with it down.

/** A mover the aim took (?life, src/life; CONTRACT.md section 3): its key, where it will be when the breath gets there, and that game time. */
export interface MoverTarget {
  readonly mover: true;
  key: string;
  x: number;
  y: number;
  z: number;
  arrive: number;
  pickR: number;
  /** taken on the line of fire alone (a car, a picnic, `KindInfo.onLine`): a building near the aim point doesn't have the shot from it, but a latched one keeps it */
  onLine: boolean;
  /** how far the line of fire passes from its middle (m), and its own half size there (m): under it, the line runs over it, which a building the line lands on yields to */
  miss: number;
  half: number;
}

/** What the aim asks life (src/life/Life.ts): the mover nearest a line of fire, and which one glints. */
export interface MoverAim {
  /** `ground` false: nothing on the line of fire alone (a car, a picnic) is taken, only what flies or sails by the pick radius (the nose's ray) */
  aim(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pickR: number, travel: number, ground?: boolean): MoverTarget | null;
  glint(key: string | null): void;
}

export interface Shot {
  /** the building it hits (the one glinting), or null */
  target: BuildingRef | null;
  /** ?life: a mover it hits instead, nearer the line of fire than any building (then target is null) */
  mover?: MoverTarget | null;
  /** where it lands (on the target: its footprint, the aim point if that is on it) */
  x: number;
  z: number;
  /** impact height when it slams into a wall (else undefined: the roof there) */
  y: number | undefined;
  /** (x, z) is exactly where it lands (a wall face), not a point to land on the target from */
  exact: boolean;
  /** bus height above the impact (m) and the projectile's flight time from launch (s) */
  drop: number;
  travel: number;
  /** ?moon: the crater it lands on (src/moon/CraterPaint.ts), which gives the shot its place and its time */
  crater?: unknown;
  /** a Comet's flight (src/game/Comet.ts): a gear at speed flies it ahead, in view */
  comet?: CometPlan | null;
}

/** The barf a tap's shot fires (main.ts's breathe, and tools/feel-sim/loop.ts's tap, so a Node tap is the page's): timed to its flight, at what glints, seen from the bus's height. */
export function tapOpts(shot: Shot, busY: number): BarfOpts {
  const o: BarfOpts = { drop: shot.drop, travel: config.splat.inhale + shot.travel, target: shot.target, y: shot.y, exact: shot.exact, from: busY };
  // (a Comet: no ribbon from the mouth, its streak is the jet, and no hit-stop that far off; its tile not in yet, it's planned just before it lands)
  const c = shot.comet;
  if (c) Object.assign(o, { stream: true, hitStop: 0, comet: c, late: c.loaded ? 0 : config.comet.late });
  // (a Lob's circle is its fall's from the arc's top, not the bus's height over where it lands)
  if (c?.kind === 'lob') o.radius = lobRadius(c);
  return o;
}

const F_CLEAR = 12; // the classic shot drops about this far onto the roofs (m)
const LM_GROUND = 2; // a landmark's line of fire stays this far above the ground (m)

export class Aimer {
  /** Where a breath fired now would land, refreshed by point() / update(). */
  readonly aim = { x: 0, y: 0, z: 0, dist: 0, travel: 0, drop: 0, wall: false };
  /** the sticky pick at the aim point */
  target: BuildingRef | null = null;
  /** ?life: the movers (main.ts sets it under the flag; with none the aim is the street's as it was) */
  life: MoverAim | null = null;
  /** The Comet (src/game/Comet.ts; main.ts and the probe make it): with a gear at speed it plans the tap's shot, and what glints is its landing */
  comet: Comet | null = null;
  /** The Lob (src/game/Lob.ts; main.ts and the sims make it, on the Comet's odometer): with the body nose up a tap throws it into the distance, and what glints is
   *  where it lands */
  lob: Lob | null = null;
  /** A Bomb charging (src/game/Bomb.ts): the Lob is out of it, its shot the Comet's or the tap's */
  bombing = false;
  /** this frame's plan (the Comet's or the Lob's, chooseShot's pick), and whether it's the Lob's; the Comet's own, and the aim's own point under them */
  private cometPlan: CometPlan | null = null;
  private lobbing = false;
  private cometOnly: CometPlan | null = null;
  /** the last fire() was the Comet's shotOf (unfire puts its side back) */
  private cometFired = false;
  private readonly cometOut = {} as CometPlan;
  private readonly lobOut = {} as CometPlan;
  private readonly aimOwnPt = { x: 0, y: 0, z: 0, dist: 0, travel: 0, drop: 0, wall: false };
  /** the steering thumb was down last frame, and the body and the path as they were then: what the Lob latches when it lifts */
  private wasThumb = false;
  private bodyWas = 0;
  private noseWas = 0;
  /** when the steering thumb went down (game s): a stroke lifted within inputTune.quickTapMs may be a slid tap, and keeps the Lob's latch it found */
  private thumbAt = 0;
  /** the mover this frame's aim takes, and one held by a press, as the building latch is */
  private mover: MoverTarget | null = null;
  private moverLatch: MoverTarget | null = null;
  private moverLatchUntil = 0;
  private readonly moverHeld: MoverTarget = { mover: true, key: '', x: 0, y: 0, z: 0, arrive: 0, pickR: 0, onLine: false, miss: 0, half: 0 };
  /** the shown building's distance from the bus, squared, for `nearer` */
  private shownD2 = Infinity;
  /** game time the shown building started glinting (the glint's sweep starts there) */
  shownSince = 0;
  /** how far off the nose the breath goes (rad, +right): the look's, per frame (main.ts) */
  lookYaw = 0;
  /** Curb (main.ts, per frame): the side of the lane a tap's drive-by takes, +1 right, -1 left, 0 off the street. There the front that way glints, and no mover */
  street = 0;
  /** the way the breath goes, flat: the nose, turned by the look */
  fx = 0;
  fz = 1;
  private latchRef: BuildingRef | null = null;
  /** what the aim's own pick glinted last frame (the latch freezes it; the Comet's glint is the Comet's) */
  private lastAim: BuildingRef | null = null;
  private latchUntil = 0;
  private wasDrag = false;
  private wallRef: BuildingRef | null = null;
  private lastShown: BuildingRef | null = null;
  private t = 0;
  private ready = false;
  /** A gifted Bomb charging (src/game/Bomb.ts): the aim runs as with a full belly, whatever it holds, so its ring and its shot are where a full one's would be.
   *  Aimed only with a full belly, a gift let go while the belly refilled came down at the aim's last point, 128-279 m behind the bus at Nonstop and Jet (the
   *  Bomb's play review, 1) */
  primed = false;
  private x0 = 0;
  private z0 = 0;
  private readonly land = { x: 0, z: 0 };
  private horiz = 0;
  private classic = true;
  private y0 = 0;
  private ca = 1;
  private sa = 0;

  constructor(private readonly city: City, private readonly splatter: Splatter) {}

  /** The Comet or the Lob a tap now fires (planned this frame; a Lob's has kind 'lob'), or null: the classic shot. */
  get planned(): CometPlan | null {
    return this.cometPlan;
  }

  /** The Lob a tap now throws (planned this frame), or null: its ring shows where it lands (main.ts). */
  get lobPlan(): CometPlan | null {
    return this.lobbing ? this.cometPlan : null;
  }

  /** QA: this frame's Lob, chosen or not (the Comet's landing farther), or null. */
  lobLast: CometPlan | null = null;

  /** A breath can fire right now (Flight.tryBarf's own test). */
  static loaded(f: Flight): boolean {
    return f.barfT < 0 && f.fullness >= 0.999;
  }

  /** Recompute the aim point for the bus as it is now (no target logic). */
  point(f: Flight): void {
    const S = config.splat;
    const city = this.city;
    const aim = this.aim;
    const r0 = S.range + S.rangePerSpeed * f.ground;
    const a = (clamp(S.aimDown, 2, 80) * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const x0 = f.x, y0 = f.y, z0 = f.z;
    let fx = f.fx, fz = f.fz;
    if (this.lookYaw !== 0) {
      const c = Math.cos(this.lookYaw), s = Math.sin(this.lookYaw);
      const nx = fx;
      fx = nx * c - fz * s;
      fz = fz * c + nx * s;
    }
    this.x0 = x0;
    this.y0 = y0;
    this.z0 = z0;
    this.fx = fx;
    this.fz = fz;
    this.ca = ca;
    this.sa = sa;
    const below = this.below;
    const maxT = Math.max(r0, S.maxRange) / ca;
    let t = 0, prev = 0, hit = -1;
    while (t < maxT) {
      t = Math.min(maxT, t + Math.max(3, t * 0.02));
      if (below(t)) {
        hit = t;
        break;
      }
      prev = t;
    }
    if (hit > 0)
      for (let i = 0; i < 6; i++) {
        const m = (prev + hit) * 0.5;
        if (below(m)) hit = m;
        else prev = m;
      }
    const horiz = Math.max(r0, hit > 0 ? hit * ca : S.maxRange);
    this.horiz = horiz;
    // the classic short shot (the ray came down under the nose): a straight blast from the mouth onto
    // the roof ahead, which a building standing in between may take instead (see occlude)
    this.classic = hit < 0 || hit * ca < r0;
    aim.x = x0 + fx * horiz;
    aim.z = z0 + fz * horiz;
    aim.y = city.surfaceAt(aim.x, aim.z, y0);
    aim.wall = false;
    const hx = aim.x - x0, hz = aim.z - z0;
    aim.dist = Math.hypot(hx, hz, y0 - aim.y);
    aim.travel = this.travelFor(aim.dist, f.ground);
    aim.drop = Math.max(0, y0 - aim.y);
  }

  /** The ray t m from the bus along the aim is at or under a roof, a tree, the ground or a landmark's surface (a
   * landmark's collision post isn't what the breath lands on; a deck over the bus is overhead). A bound arrow: no
   * allocation per frame. */
  private readonly below = (t: number): boolean => this.y0 - t * this.sa <= this.city.surfaceAt(this.x0 + this.fx * t * this.ca, this.z0 + this.fz * t * this.ca, this.y0);

  /**
   * The blast flies straight from the mouth to where it lands on `target` (or the aim point): a
   * building standing in that line of fire, clearly above it (a grazed roof edge doesn't stop a 15 m
   * wide jet, nor does a neighbor right at the landing), takes it on its wall instead. Sets wallRef
   * and the aim point on that wall's face; returns whether it found one.
   */
  private occlude(target: BuildingRef | null): boolean {
    const S = config.splat;
    const city = this.city;
    const aim = this.aim;
    this.wallRef = null;
    if (!this.classic) return false;
    const x0 = this.x0, z0 = this.z0, y0 = this.y0;
    let ex = aim.x, ez = aim.z, ey = aim.y + 0.5;
    const tLm = target !== null && city.isLandmark(target);
    let top = ey;
    if (target) {
      const l = city.landingOn(target, aim.x, aim.z, S.landInset, this.land, S.smallRad);
      ex = l.x;
      ez = l.z;
      ey = top = city.roofAtPart(target, ex, ez, y0) + 0.5;
      // a landmark's surface at the aim point can be 100 m above the bus (the pyramid's slope, Coit's
      // column): the classic shot flies level onto it and slams into its face at about the bus's height,
      // never under the ground it stands on (Coit's hilltop over a bus at the floor down the slope)
      if (tLm) ey = Math.min(top, Math.max(this.y0 - F_CLEAR, city.groundAt(ex, ez) + LM_GROUND));
    }
    const dx = ex - x0, dz = ez - z0;
    const L = Math.hypot(dx, dz);
    if (L < 12) return false;
    const ux = dx / L, uz = dz / L;
    if (tLm) {
      // nor through a hill crest on the way (Coit from below Telegraph Hill's north cliff): the line of fire
      // rises just enough to clear the ground all along it, at most onto the landmark's top at the landing (the
      // baked buildings' chord). (Raising its end lifts every point of it, so one pass finds the lowest.)
      for (let s = 10; s < L; s += 4) {
        const need = city.groundAt(x0 + ux * s, z0 + uz * s) + LM_GROUND;
        if (need > y0 + (ey - y0) * (s / L)) ey = Math.min(top, y0 + (need - y0) * (L / s));
      }
    }
    // a landmark target's own face can stand right at the landing (the hull's edge, when the aim point is near
    // its base): the march goes on to it there, where only that face, never a neighbor, stops the shot
    const sEnd = tLm ? L : L - S.wallSkip;
    for (let s = 10; s < sEnd; s += 2) {
      const px = x0 + ux * s, pz = z0 + uz * s;
      const chordY = y0 + (ey - y0) * (s / L);
      // (a landmark by its surface seen from the line: under a deck the line passes under it)
      const ref = city.buildingAbove(px, pz, chordY + S.wallClear, chordY);
      // (the target itself is no wall in its own way, unless it is a landmark: its face is what the shot meets)
      if (!ref || (ref === target && !tLm) || ref.roofY - ref.baseY < S.minTargetHeight) continue;
      if (s >= L - S.wallSkip && ref !== target) continue;
      // it lands on the wall face, just outside it (a splash inside the walls would be hidden); a landmark's
      // face is where its real surface rises over the line of fire (the pyramid's slope is inside its hull)
      const lm = city.isLandmark(ref);
      let lo = s - 2, hi = s;
      for (let i = 0; i < 5; i++) {
        const m = (lo + hi) * 0.5;
        const qx = x0 + ux * m, qz = z0 + uz * m;
        const my = y0 + (ey - y0) * (m / L);
        if (city.contains(ref, qx, qz) && (!lm || city.landmarkSurfaceAt(qx, qz, my) > my)) hi = m;
        else lo = m;
      }
      const w = Math.max(4, lo - 0.6);
      aim.x = x0 + ux * w;
      aim.z = z0 + uz * w;
      aim.y = y0 + (ey - y0) * (w / L);
      aim.wall = true;
      aim.dist = Math.hypot(w, y0 - aim.y);
      aim.drop = Math.max(0, y0 - aim.y);
      this.wallRef = ref;
      return true;
    }
    return false;
  }

  /**
   * The projectile's flight time from launch (s): the classic short shot takes impactDelay - inhale
   * (the first impact is impactDelay after the tap); past the classic range it flies on at
   * projectileSpeed, so a long shot from altitude takes longer and matches the visible jet.
   */
  private travelFor(dist: number, speed: number): number {
    const S = config.splat;
    const r0 = S.range + S.rangePerSpeed * speed;
    return Math.max(0.05, S.impactDelay - S.inhale) + Math.max(0, dist - Math.hypot(r0, F_CLEAR)) / Math.max(20, S.projectileSpeed);
  }

  /** In front of the nose (the bus never holds a target it is passing over). */
  private ahead(r: BuildingRef): boolean {
    // the farthest corner of its bounds along the heading
    const far = Math.max((r.x0 - this.x0) * this.fx, (r.x1 - this.x0) * this.fx) + Math.max((r.z0 - this.z0) * this.fz, (r.z1 - this.z0) * this.fz);
    return far > 20;
  }

  /** Is r still a fair target: ahead, and within `reach` m of the line of fire over its last `along` m
   * up to the aim point (a target the aim point has just slid past stays, one beside the line goes)? */
  private holds(r: BuildingRef | null, reach: number, along: number): boolean {
    // (nor one overhead: a bus that dived under a deck aims at what is under it)
    if (!r || !this.ahead(r) || this.city.lmOverhead(r, this.aim.x, this.aim.z, this.y0)) return false;
    const n = along > 0 ? 3 : 0;
    for (let i = 0; i <= n; i++) {
      const h = this.horiz - (along * i) / Math.max(1, n);
      if (h < 10) break;
      if (this.city.edgeDistance(r, this.x0 + this.fx * h, this.z0 + this.fz * h) <= reach) return true;
    }
    return false;
  }

  /**
   * Once per frame: the aim point, the target, the latch. `dragging` = the steering thumb is down (and no press holds what glints); `thumb` = it is down,
   * whatever a press holds: a second thumb's tap reads the Lob's body live, and its lift latches the body as it was.
   * Returns the building that glints (the one a tap now hits), or null.
   */
  update(f: Flight, t: number, dragging: boolean, thumb = dragging): BuildingRef | null {
    const S = config.splat;
    this.t = t;
    this.ready = Aimer.loaded(f) || (this.primed && f.barfT < 0);
    this.cometPlan = this.cometOnly = this.lobLast = null;
    this.lobbing = false;
    // (the Lob's body: as it was last frame, with the thumb down, when it lifts; live while it's down. The body drops as soon as the thumb lifts, at Cruise
    // 72 to 41 degrees in 0.2 s, and a frame's drop at 30 fps put a throw tens of metres from 60's). On Curb's street it latches nothing: there's no Lob there
    if (this.lob && this.street === 0) {
      if (this.wasThumb && !thumb) this.lob.latch(this.bodyWas, this.noseWas, t, t + config.lob.latch, false, t - this.thumbAt <= inputTune.quickTapMs / 1000);
      if (thumb) this.lob.unlatch(t);
    }
    if (thumb && !this.wasThumb) this.thumbAt = t;
    this.wasThumb = thumb;
    this.bodyWas = f.pitch;
    this.noseWas = f.nose;
    // (the Comet's odometer runs every frame: its stretches are counted along the bus's travel)
    this.comet?.track(f);
    // thumb lifted (to tap): freeze what glints while the bus straightens out under it (the Comet's landing as the aim's own pick)
    if (this.wasDrag && !dragging && this.ready) {
      if (this.lastAim) {
        this.latchRef = this.lastAim;
        this.latchUntil = t + S.aimLatch;
      }
      this.comet?.latch(t + S.aimLatch);
    }
    if (dragging) {
      this.latchRef = null;
      this.comet?.unlatch();
    }
    this.wasDrag = dragging;
    if (!this.ready) {
      this.target = this.latchRef = this.wallRef = this.lastAim = null;
      return this.noteShown(null);
    }
    if (this.street !== 0) return this.noteShown(this.streetFront(f));
    this.point(f);
    const own = this.aimOwn(f, t);
    this.lastAim = own;
    // the Comet: a gear at speed lands the tap ahead of the bus, in view, and what glints is where it lands. (The aim's own pick above runs on under
    // it as it always has, so where the Comet stops applying, high up or slowing, the tap is exactly the classic one. Where it applies it takes the place
    // of ?life's mover, as of the building: HOOKS.md, "The Comet")
    const c = this.comet ? this.comet.plan(f, this.fx, this.fz, this.cometOut, t) : null;
    // the Lob, nose up (never while a Bomb charges, nor on Curb's street, whose front has returned above): the farther of it and the Comet, never weighed
    // against the aim's own (chooseShot)
    const l = this.lob && this.comet && !this.bombing && this.street === 0 ? this.lob.plan(f, this.fx, this.fz, this.lobOut, t) : null;
    this.lobLast = l;
    const p = chooseShot(f, null, c, l);
    if (!p) return this.noteShown(own);
    this.cometPlan = p;
    this.cometOnly = c;
    this.lobbing = p === l;
    const aim = this.aim;
    Object.assign(this.aimOwnPt, aim);
    aim.x = p.x;
    aim.y = p.y;
    aim.z = p.z;
    aim.wall = p.wall;
    aim.drop = p.drop;
    aim.travel = p.travel;
    aim.dist = Math.hypot(p.x - f.x, p.z - f.z, f.y - p.y);
    if (this.life) {
      this.mover = null;
      this.life.glint(null);
    }
    return this.noteShown(p.target);
  }

  /** The aim's own pick this frame (update's): the target, held; the latch; a wall in the line of fire; ?life's mover. Returns what it would glint. */
  private aimOwn(f: Flight, t: number): BuildingRef | null {
    const S = config.splat;
    const r = this.splatter.pickRadius(this.aim.drop);
    const k = this.aim.drop > 40 ? 1 + this.aim.drop / 150 : 1;
    const hold = Math.min(r, S.aimHold * k);
    if (!this.holds(this.target, hold, S.aimHoldAlong)) this.target = this.splatter.pick(this.aim.x, this.aim.z, r, f.y);
    // (a latch is a commitment: it holds while the building stays within a narrow cone of the nose, which
    // from altitude is wider than the pick radius: the bungee settles a few degrees after the thumb lifts)
    if (this.latchRef && (t >= this.latchUntil || !this.holds(this.latchRef, Math.max(r, S.aimLatchCone * this.horiz), S.aimHoldAlong))) this.latchRef = null;
    this.occlude(this.latchRef ?? this.target);
    if (this.life) return this.pickMover(f, t, r);
    return this.shown();
  }

  /**
   * ?life: a mover on the line of fire, nearer than the building, takes the shot and the glint; past the aim's ray the nose's, so a plane flown alongside can be
   * painted, but nothing on the ground (the first account's life review, B1: a car 1.7 km down the road took the shot along the nose). Something on the ground takes
   * it from the building only where the line of fire lands in the street, or runs right over it: the line landing on a building, a car beside it in the street
   * doesn't steal it (B1 again: aimed at a house by a busy street, the bus painted the cars). Returns the building that glints now (none while a mover does).
   */
  private pickMover(f: Flight, t: number, r: number): BuildingRef | null {
    const life = this.life!, aim = this.aim, shown = this.shown();
    if (this.moverLatch && t >= this.moverLatchUntil) this.moverLatch = null;
    let m: MoverTarget | null = this.moverLatch;
    if (!m) {
      const dx = aim.x - f.x, dy = aim.y - f.y, dz = aim.z - f.z;
      // (the building's distance: a mover nearer the bus than it takes the shot, one past it doesn't: the jet couldn't get through)
      this.shownD2 = shown ? (shown.cx - f.x) ** 2 + (shown.roofY - f.y) ** 2 + (shown.cz - f.z) ** 2 : Infinity;
      m = life.aim(f.x, f.y, f.z, dx, dy, dz, r, aim.travel, true);
      if (m?.onLine && (!this.clearTo(m) || (shown && m.miss > m.half && this.landsOnBuilding()))) m = null;
      if (!this.nearer(m, f)) {
        // (along the nose, as far as a breath's reach: a plane alongside or ahead, which from high up is nearer than any roof under the aim)
        const reach = config.splat.moverReach, c = Math.cos(f.nose), speed = aim.dist / Math.max(0.05, aim.travel);
        m = life.aim(f.x, f.y, f.z, this.fx * c * reach, Math.sin(f.nose) * reach, this.fz * c * reach, r, reach / Math.max(1, speed), false);
        if (!this.nearer(m, f)) m = null;
      }
    }
    this.mover = m;
    life.glint(m ? m.key : null);
    return m ? null : shown;
  }

  /** ?life: the mover takes the shot over the shown building: one on the ground unless a building is latched, else one nearer the bus than the building. */
  private nearer(q: MoverTarget | null, f: Flight): boolean {
    return !!q && ((q.onLine && !this.latchRef) || (q.x - f.x) ** 2 + (q.y - f.y) ** 2 + (q.z - f.z) ** 2 < this.shownD2);
  }

  /** ?life: the line of fire ends on a building: its aim point is on a roof or in a wall, not the street. */
  private landsOnBuilding(): boolean {
    // (a roof there within a few metres under the aim point, which the obstacle grid holds 3 m over a roof, or over it: a wall the line ends in)
    const a = this.aim, ref = this.city.buildingAbove(a.x, a.z, a.y - 6);
    return !!ref && ref.roofY - ref.baseY >= config.splat.minTargetHeight;
  }

  /**
   * ?life: no building stands between the mouth and a person on the line of fire (their middle), marched as `occlude` marches a shot: one clearly over the
   * line stops it, a grazed roof edge doesn't, and the last metres are the street they stand in. No allocation.
   */
  private clearTo(q: MoverTarget): boolean {
    const S = config.splat, city = this.city, x0 = this.x0, y0 = this.y0, z0 = this.z0;
    const dx = q.x - x0, dz = q.z - z0, ey = q.y + 0.9, L = Math.hypot(dx, dz);
    if (L < 6) return true;
    const ux = dx / L, uz = dz / L;
    for (let s = 4; s < L - 2; s += 2) {
      const chordY = y0 + (ey - y0) * (s / L);
      const ref = city.buildingAbove(x0 + ux * s, z0 + uz * s, chordY + S.wallClear, chordY);
      if (ref && ref.roofY - ref.baseY >= S.minTargetHeight) return false;
    }
    return true;
  }

  /**
   * Curb: the house front a drive-by takes, config.curb.front m to the street side and within frontR of there, the breath going that way. On the
   * street there's no wall in the line of fire to find (every front is one), no latch and no mover: the car beside is the drive-by's own (main.ts).
   */
  private streetFront(f: Flight): BuildingRef | null {
    const K = config.curb, s = this.street, aim = this.aim;
    this.wallRef = this.latchRef = null;
    this.mover = this.moverLatch = null;
    this.life?.glint(null);
    // (a little on along the street, so the front blooms in the kerb chase's view and not past its edge, beside the bus)
    const sx = -f.fz * s, sz = f.fx * s, ax = f.fx * K.frontAhead, az = f.fz * K.frontAhead;
    let x = f.x + sx * K.front + ax, z = f.z + sz * K.front + az;
    this.target = this.city.nearestBuilding(x, z, K.frontR, config.splat.minTargetHeight, f.y);
    // (a wide street, or fronts set back: once more, twice as far out, as far again round it)
    if (!this.target) {
      x = f.x + sx * K.front * 2.5 + ax;
      z = f.z + sz * K.front * 2.5 + az;
      this.target = this.city.nearestBuilding(x, z, K.frontR * 1.5, config.splat.minTargetHeight, f.y);
    }
    this.x0 = f.x;
    this.y0 = f.y;
    this.z0 = f.z;
    aim.dist = Math.hypot(x - f.x, z - f.z);
    this.fx = (x - f.x) / Math.max(1e-3, aim.dist);
    this.fz = (z - f.z) / Math.max(1e-3, aim.dist);
    aim.x = x;
    aim.z = z;
    aim.y = this.city.groundAt(x, z);
    aim.drop = 0;
    aim.wall = false;
    aim.travel = this.travelFor(aim.dist, f.ground);
    return this.target;
  }

  /** Before a tap fires: an aim this frame found not ready, the belly full again since (a pour given back by Input's late tap, Hose.end), plans again,
   *  as it stood, so the tap throws what it would have (the Lob's roofs stage: the late tap found no plan and threw a plain splat). */
  refresh(f: Flight): void {
    if (!this.ready && Aimer.loaded(f)) this.update(f, this.t, this.wasDrag, this.wasThumb);
  }

  /** A touch went down that may become a tap: freeze what glints (taps fire on the lift). */
  press(): void {
    // (the Lob's body, the steering thumb up: as it is now, or as it was when the thumb lifted if that's latched still. With the steering thumb down a second
    // thumb's tap reads it live. On Curb's street, none; nor with the belly not ready, whose taps ran a latch on until it was full: M90)
    if (this.lob && this.ready && !this.wasThumb && this.street === 0) this.lob.latch(this.bodyWas, this.noseWas, this.t, this.t + config.lob.latch, true);
    if (this.mover && !this.moverLatch) {
      // (a mover held as it glinted: a copy, since the aim's answer is filled again next frame)
      Object.assign(this.moverHeld, this.mover);
      this.moverLatch = this.moverHeld;
      this.moverLatchUntil = this.t + config.splat.aimLatch;
      return;
    }
    if (!this.ready) return;
    // (a Comet's landing is latched as it glints, its flight planned again at the tap from where the bus is)
    if (this.cometPlan) this.comet?.latch(this.t + config.splat.aimLatch);
    if (this.latchRef) return;
    const s = this.wallRef ?? this.target;
    if (!s) return;
    this.latchRef = s;
    this.latchUntil = this.t + config.splat.aimLatch;
  }

  /** ?life: a mover glints now. */
  get moverGlinting(): boolean {
    return this.mover !== null;
  }

  /** The building glinting right now (the latch while it holds, else the live target). */
  shown(): BuildingRef | null {
    if (!this.ready) return null;
    if (this.cometPlan) return this.cometPlan.target;
    // a wall in the line of fire always wins: the jet couldn't get past it
    return this.wallRef ?? this.latchRef ?? this.target;
  }

  private noteShown(s: BuildingRef | null): BuildingRef | null {
    if (s !== this.lastShown) {
      this.lastShown = s;
      this.shownSince = this.t;
    }
    return s;
  }

  /** The shot a tap fires now: at the glinting building (call before Flight.tryBarf, between frames), or ?life's glinting mover. `bomb`: a Bomb's, which takes no
   *  mover off a floor (a plane glinting): the building, as its ring showed. */
  fire(f: Flight, bomb = false): Shot {
    // (the tap's shot is chosen in one place, Comet.ts's chooseShot, every frame: what this frame planned and glints. A Bomb never lobs: where the Lob won,
    // its shot is the Comet's, or the aim's own under them)
    this.cometFired = false;
    if (this.comet && this.cometPlan) {
      if (!this.lobbing) {
        this.cometFired = true;
        return this.comet.shotOf(this.cometPlan);
      }
      if (!bomb) return this.lobShot(this.cometPlan);
      if (this.cometOnly) {
        this.cometFired = true;
        return this.comet.shotOf(this.cometOnly);
      }
      Object.assign(this.aim, this.aimOwnPt);
      this.cometPlan = null;
      this.lobbing = false;
    }
    return this.fireAim(f, bomb);
  }

  /** The shot fire() gave didn't leave (Flight.tryBarf said no, or the Bomb fizzled): a Comet's next one stays on the side this one would have taken (n82). */
  unfire(): void {
    if (this.cometFired) this.comet?.unshot();
    this.cometFired = false;
  }

  /** The shot a Lob's plan throws: at what glints, its flight the plan's. */
  private lobShot(p: CometPlan): Shot {
    this.lob!.fired();
    this.latchRef = null;
    return { target: p.target, x: p.x, z: p.z, y: p.wall || !p.target ? p.y : undefined, exact: p.wall, drop: p.drop, travel: p.travel, comet: { ...p } };
  }

  /** The aim's own shot: at the glinting building, or ?life's glinting mover (a Bomb's, one on a floor only: one at a plane painted the plane alone, at one
   *  level, the Bomb's play review, 6). */
  private fireAim(f: Flight, bomb = false): Shot {
    if (this.mover && (!bomb || this.splatter.moverOnFloor(this.mover))) {
      const m = this.mover, shot = this.shotAt(f, null);
      shot.mover = m;
      shot.x = m.x;
      shot.z = m.z;
      shot.y = m.y;
      shot.exact = true;
      // (the breath's flight is to the mover, and it lands at its height)
      shot.travel = Math.max(0.05, m.arrive - this.t);
      shot.drop = Math.max(0, f.y - m.y);
      this.moverLatch = null;
      return shot;
    }
    return this.shotAt(f, this.shown());
  }

  /**
   * The shot a super's mega fires with whatever the belly holds, when nothing is glinting: update() keeps no target
   * while the belly refills, so this finds one as update() would, and a wall in the line of fire still takes the shot.
   */
  aimShot(f: Flight): Shot {
    this.point(f);
    const aim = this.aim;
    const pick = this.splatter.pick(aim.x, aim.z, this.splatter.pickRadius(aim.drop), f.y);
    this.occlude(pick);
    return this.shotAt(f, this.wallRef ?? pick);
  }

  private shotAt(f: Flight, target: BuildingRef | null): Shot {
    const aim = this.aim;
    const wall = aim.wall && target === this.wallRef;
    let x = aim.x, z = aim.z;
    const y: number | undefined = wall ? aim.y : undefined;
    if (target && !wall) {
      const l = this.city.landingOn(target, aim.x, aim.z, config.splat.landInset, this.land, config.splat.smallRad);
      x = l.x;
      z = l.z;
    }
    const iy = y ?? (target ? this.city.roofAtPart(target, x, z, f.y) + 0.5 : this.city.groundAt(x, z));
    const dist = Math.hypot(x - f.x, z - f.z, f.y - iy);
    this.latchRef = null;
    return { target, x, z, y, exact: wall, drop: Math.max(0, f.y - iy), travel: this.travelFor(dist, f.ground) };
  }
}
