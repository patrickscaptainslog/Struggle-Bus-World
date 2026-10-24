import { config } from '../config';
import { clamp } from './springs';
import type { City, BuildingRef } from '../world/City';
import type { Flight } from './Flight';
import type { Splatter } from './Splat';

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

export interface Shot {
  /** the building it hits (the one glinting), or null */
  target: BuildingRef | null;
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
}

const F_CLEAR = 12; // the classic shot drops about this far onto the roofs (m)

export class Aimer {
  /** Where a breath fired now would land, refreshed by point() / update(). */
  readonly aim = { x: 0, y: 0, z: 0, dist: 0, travel: 0, drop: 0, wall: false };
  /** the sticky pick at the aim point */
  target: BuildingRef | null = null;
  /** game time the shown building started glinting (the glint's sweep starts there) */
  shownSince = 0;
  private latchRef: BuildingRef | null = null;
  private latchUntil = 0;
  private wasDrag = false;
  private wallRef: BuildingRef | null = null;
  private lastShown: BuildingRef | null = null;
  private t = 0;
  private ready = false;
  private x0 = 0;
  private z0 = 0;
  private fx = 0;
  private fz = 1;
  private readonly land = { x: 0, z: 0 };
  private horiz = 0;
  private classic = true;
  private y0 = 0;
  private ca = 1;
  private sa = 0;

  constructor(private readonly city: City, private readonly splatter: Splatter) {}

  /** A breath can fire right now (Flight.tryBarf's own test). */
  static loaded(f: Flight): boolean {
    return f.barfT < 0 && f.fullness >= 0.999;
  }

  /** Recompute the aim point for the bus as it is now (no target logic). */
  point(f: Flight): void {
    const S = config.splat;
    const city = this.city;
    const aim = this.aim;
    const r0 = S.range + S.rangePerSpeed * f.speed;
    const a = (clamp(S.aimDown, 2, 80) * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const x0 = f.x, y0 = f.y, z0 = f.z, fx = f.fx, fz = f.fz;
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
    aim.y = city.surfaceAt(aim.x, aim.z);
    aim.wall = false;
    const hx = aim.x - x0, hz = aim.z - z0;
    aim.dist = Math.hypot(hx, hz, y0 - aim.y);
    aim.travel = this.travelFor(aim.dist, f.speed);
    aim.drop = Math.max(0, y0 - aim.y);
  }

  /** The ray t m from the bus along the aim is at or under a roof, a tree or the ground (a landmark's collision
   * post or a bridge deck isn't what the breath lands on). A bound arrow: no allocation per frame. */
  private readonly below = (t: number): boolean => this.y0 - t * this.sa <= this.city.surfaceAt(this.x0 + this.fx * t * this.ca, this.z0 + this.fz * t * this.ca);

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
    let ex = aim.x, ez = aim.z, ey = aim.y + 0.5;
    if (target) {
      const l = city.landingOn(target, aim.x, aim.z, S.landInset, this.land, S.smallRad);
      ex = l.x;
      ez = l.z;
      ey = city.roofAtPart(target, ex, ez) + 0.5;
      // a landmark's surface at the aim point can be 100 m above the bus (the pyramid's slope, Coit's
      // column): the classic shot flies level onto it and slams into its face at about the bus's height
      if (city.isLandmark(target)) ey = Math.min(ey, this.y0 - F_CLEAR);
    }
    const x0 = this.x0, z0 = this.z0, y0 = this.y0;
    const dx = ex - x0, dz = ez - z0;
    const L = Math.hypot(dx, dz);
    if (L < 12) return false;
    const ux = dx / L, uz = dz / L;
    // a landmark target's own face can stand right at the landing (the hull's edge, when the aim point is near
    // its base): the march goes on to it there, where only that face, never a neighbor, stops the shot
    const tLm = target !== null && city.isLandmark(target);
    const sEnd = tLm ? L : L - S.wallSkip;
    for (let s = 10; s < sEnd; s += 2) {
      const px = x0 + ux * s, pz = z0 + uz * s;
      const chordY = y0 + (ey - y0) * (s / L);
      const ref = city.buildingAbove(px, pz, chordY + S.wallClear);
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
        if (city.contains(ref, qx, qz) && (!lm || city.landmarkSurfaceAt(qx, qz) > y0 + (ey - y0) * (m / L))) hi = m;
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
    if (!r || !this.ahead(r)) return false;
    const n = along > 0 ? 3 : 0;
    for (let i = 0; i <= n; i++) {
      const h = this.horiz - (along * i) / Math.max(1, n);
      if (h < 10) break;
      if (this.city.edgeDistance(r, this.x0 + this.fx * h, this.z0 + this.fz * h) <= reach) return true;
    }
    return false;
  }

  /**
   * Once per frame: the aim point, the target, the latch. `dragging` = the steering thumb is down.
   * Returns the building that glints (the one a tap now hits), or null.
   */
  update(f: Flight, t: number, dragging: boolean): BuildingRef | null {
    const S = config.splat;
    this.t = t;
    this.ready = Aimer.loaded(f);
    // thumb lifted (to tap): freeze what glints while the bus straightens out under it
    if (this.wasDrag && !dragging && this.ready && this.lastShown) {
      this.latchRef = this.lastShown;
      this.latchUntil = t + S.aimLatch;
    }
    if (dragging) this.latchRef = null;
    this.wasDrag = dragging;
    if (!this.ready) {
      this.target = this.latchRef = this.wallRef = null;
      return this.noteShown(null);
    }
    this.point(f);
    const r = this.splatter.pickRadius(this.aim.drop);
    const k = this.aim.drop > 40 ? 1 + this.aim.drop / 150 : 1;
    const hold = Math.min(r, S.aimHold * k);
    if (!this.holds(this.target, hold, S.aimHoldAlong)) this.target = this.splatter.pick(this.aim.x, this.aim.z, r);
    // (a latch is a commitment: it holds while the building stays within a narrow cone of the nose, which
    // from altitude is wider than the pick radius: the bungee settles a few degrees after the thumb lifts)
    if (this.latchRef && (t >= this.latchUntil || !this.holds(this.latchRef, Math.max(r, S.aimLatchCone * this.horiz), S.aimHoldAlong))) this.latchRef = null;
    this.occlude(this.latchRef ?? this.target);
    return this.noteShown(this.shown());
  }

  /** A touch went down that may become a tap: freeze what glints (taps fire on the lift). */
  press(): void {
    if (!this.ready || this.latchRef) return;
    const s = this.shown();
    if (!s) return;
    this.latchRef = s;
    this.latchUntil = this.t + config.splat.aimLatch;
  }

  /** The building glinting right now (the latch while it holds, else the live target). */
  shown(): BuildingRef | null {
    if (!this.ready) return null;
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

  /** The shot a tap fires now: at the glinting building (call before Flight.tryBarf, between frames). */
  fire(f: Flight): Shot {
    const target = this.shown();
    const aim = this.aim;
    const wall = aim.wall && target === this.wallRef;
    let x = aim.x, z = aim.z;
    const y: number | undefined = wall ? aim.y : undefined;
    if (target && !wall) {
      const l = this.city.landingOn(target, aim.x, aim.z, config.splat.landInset, this.land, config.splat.smallRad);
      x = l.x;
      z = l.z;
    }
    const iy = y ?? (target ? this.city.roofAtPart(target, x, z) + 0.5 : this.city.groundAt(x, z));
    const dist = Math.hypot(x - f.x, z - f.z, f.y - iy);
    this.latchRef = null;
    return { target, x, z, y, exact: wall, drop: Math.max(0, f.y - iy), travel: this.travelFor(dist, f.speed) };
  }
}
