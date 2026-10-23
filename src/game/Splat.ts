import * as THREE from 'three';
import { config } from '../config';
import { HUE_COUNT } from '../render/palette';
import type { City, BuildingRef } from '../world/City';
import { FACTION_RAINBOW } from '../world/PaintState';
import { blastUniforms, type GroundJob } from '../world/GroundPaint';
import { arrival, blastRadiusFor, layoutHue, makeBlastSpec, waveMax, wrapHue, type BlastDot, type BlastSpec } from './blastLayout';

// The barf -> blast -> bloom pipeline. Dragon breath: the bus blasts a
// rainbow projectile forward; it snaps to the building at the aim point and
// EXPLODES: every building within the blast radius blooms as the shockwave
// reaches it (~0.3 s for the whole blast), already-painted ones escalate a
// level (bloom -> rooftop garden -> Hundertwasser), and the ground around
// them is splattered too (GroundPaint). The ground takes a rainbow pinwheel
// around the impact (blastLayout); the fresh buildings are dealt the rainbow
// in order of angle around it, so every blast of six or more shows all six
// hues and a row of houses through the impact reads as a rainbow. Touching
// neighbors never share a hue, and a house avoids the hue of the paint under it.
//
// The whole wave is written to the paint texture at impact (one upload): each
// building's bloomTime is its arrival time, and the shader holds the pop and
// the color flood until then.

export interface Blast {
  spec: BlastSpec;
  /** impact point (on the primary's roof, or on the ground) */
  pos: THREE.Vector3;
  /** game clock at impact */
  t: number;
  /** buildings blooming in this blast, and the highest level reached */
  count: number;
  maxLevel: number;
  /** blast radius relative to the base radius (1 = a level barf) */
  strength: number;
  /** spatter dots on the ground; the blob ones each get a flung paint blob */
  dots: BlastDot[];
}

export interface SplatFx {
  geyser(targets: THREE.Vector3[], hues: number[]): void;
  /** The projectile explodes: flash, ring, kick, boom, blobs, trees. */
  impact(b: Blast): void;
  /** One building pops (at its arrival time). */
  bloom(ref: BuildingRef, order: number, total: number, hue: number, level: number, roof: THREE.Vector3): void;
  primary(ref: BuildingRef, hue: number): void;
  hitStop(frames: number): void;
  /** The breath came down on nothing paintable (open water): a splash, at the moment it lands. */
  miss?(pos: THREE.Vector3, hue: number): void;
}

/** Optional aim for Splatter.barf. */
export interface BarfOpts {
  /** height of the bus above the impact (m): the blast grows with it */
  drop?: number;
  /** the projectile's flight time (s), default config.splat.impactDelay */
  travel?: number;
  /** the building to hit (the one that glinted), or null for none; undefined = pick at (x, z) */
  target?: BuildingRef | null;
  /** impact height (m; a breath that slams into a tower's wall), default: the roof at the landing point */
  y?: number;
  /** land exactly at (x, z) (a wall face), instead of on the target's footprint nearest to it */
  exact?: boolean;
}

interface Scheduled {
  at: number;
  ref: BuildingRef;
  order: number;
  total: number;
  hue: number;
  level: number;
  keep: boolean;
  /** dealing: angle around the impact (swirled), preferred hue (-1 = not dealt yet) */
  ang: number;
  pref: number;
  /** where the breath hit (the primary only) */
  at0?: THREE.Vector3;
}

interface PendingBlast {
  at: number;
  blast: Blast;
  plan: Scheduled[];
  /** its ground paint, drawn while the projectile flies */
  ground: GroundJob;
}

const HUE_TRY = [0, 1, -1, 2, -2, 3];

export class Splatter {
  private nextHue = Math.floor(Math.random() * HUE_COUNT);
  private queue: Scheduled[] = [];
  private pending: PendingBlast[] = [];
  private near: Array<{ ref: BuildingRef; d: number }> = [];
  private reachList: Array<{ ref: BuildingRef; d: number; e: number }> = [];
  private fresh: Scheduled[] = [];
  private misses: Array<{ at: number; pos: THREE.Vector3; hue: number }> = [];
  private land = { x: 0, z: 0 };
  private t = 0;
  private seed = (Math.random() * 0xffffffff) >>> 0;
  /** The last barf came down on nothing paintable (the caller refunds part of the belly). */
  lastMiss = false;

  constructor(private city: City, private fx: SplatFx) {}

  /** How far from the aim point the breath snaps onto a building (m): config.splat.snapRadius, more from
   * high up (`drop` m above the impact), where a pixel is meters wide (aim stays forgiving). */
  pickRadius(drop = 0): number {
    const S = config.splat;
    return drop > 40 ? Math.max(S.snapRadius, Math.min(S.snapReachMax, S.snapRadius * (1 + drop / 150))) : S.snapRadius;
  }

  /**
   * The building a projectile aimed at (x, z) would hit: the one under the aim point (the tallest of
   * overlapping footprints), else the nearest by true footprint distance within `radius` (so a tower or a
   * warehouse is hit wherever you aim into it, and a shot into the street snaps to the nearest wall).
   */
  pick(x: number, z: number, radius = config.splat.snapRadius): BuildingRef | null {
    return this.city.nearestBuilding(x, z, radius, config.splat.minTargetHeight);
  }

  /** Blast radius for a barf from `drop` meters above the impact (m). */
  radius(drop = 0): number {
    return blastRadiusFor(drop);
  }

  /**
   * Launch a projectile at (x, z): it explodes opts.travel (default config.splat.impactDelay) s
   * later. `drop` = meters the bus is above the impact; the blast grows with
   * it (about x2 at 300 m). Returns the game-clock time of the impact.
   */
  barf(x: number, z: number, opts?: BarfOpts): number {
    const S = config.splat;
    const city = this.city;
    const paint = city.paint;
    const drop = opts?.drop ?? 0;
    const primary = opts?.target !== undefined ? opts.target : this.pick(x, z, this.pickRadius(drop));
    const tImpact = this.t + (opts?.travel ?? S.impactDelay);
    const r = blastRadiusFor(drop);
    // where it lands: the aim point if it is on the building, else the building's nearest edge, a few
    // meters in (a big block is hit where you aimed, not at a centroid 100 m away)
    const land = primary && !opts?.exact ? city.landingOn(primary, x, z, S.landInset, this.land) : null;
    const cx = land ? land.x : x;
    const cz = land ? land.z : z;
    const pos = new THREE.Vector3(cx, opts?.y ?? (land && primary ? city.roofAtPart(primary, cx, cz) + 0.5 : city.groundAt(x, z)), cz);
    // the blast's center hue: an escalating primary keeps its color, a fresh one takes the next hue
    const pRec = primary ? paint.get(primary.index) : null;
    const hue = pRec && pRec.level > 0.5 ? wrapHue(pRec.color) : this.nextHue;

    // every building the blast reaches (its footprint by true edge distance: a big block half inside the
    // radius blooms too, wherever its centroid is), nearest edge first, capped
    const cap = Math.min(S.maxBuildingsCap, Math.max(1, Math.round((S.maxBuildings * r) / S.blastRadius)));
    const near = city.buildingsWithin(cx, cz, r, this.near);
    const reach = this.reachList;
    reach.length = 0;
    for (const n of near) reach.push({ ref: n.ref, d: n.d, e: n.ref === primary ? -1e9 : n.d });
    if (primary && !near.some((n) => n.ref === primary)) reach.push({ ref: primary, d: 0, e: -1e9 });
    reach.sort((a, b) => a.e - b.e);
    // nothing to paint (open water, no building in reach): a miss. It doesn't fake a hit: no flash, boom
    // or hit-stop, just a splash when it comes down (the caller refunds part of the belly)
    this.lastMiss = reach.length === 0 && city.groundAt(x, z) < S.missWaterY;
    if (this.lastMiss) {
      this.misses.push({ at: tImpact, pos, hue: this.nextHue });
      this.fx.geyser([pos.clone()], [this.nextHue]);
      return tImpact;
    }
    if (!pRec || pRec.level < 0.5) this.nextHue = (this.nextHue + 1) % HUE_COUNT;
    this.seed = (Math.imul(this.seed ^ 0x2545f491, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
    const spec = makeBlastSpec(cx, cz, r, hue, this.seed);
    const plan: Scheduled[] = [];
    let maxLevel = 1;
    for (const n of reach) {
      if (plan.length >= cap) break;
      const ref = n.ref;
      const lv = paint.level(ref.index);
      const was = lv > 0.5;
      const level = was ? Math.min(3, Math.round(lv) + 1) : 1;
      // escalating buildings keep their hue, the primary takes the blast's; the rest are dealt below
      const h = was ? wrapHue(paint.get(ref.index).color) : ref === primary ? hue : -1;
      maxLevel = Math.max(maxLevel, level);
      // it pops when the shockwave reaches its near edge
      plan.push({ at: tImpact + arrival(ref === primary ? 0 : Math.max(0, n.e), r), ref, order: plan.length, total: 0, hue: h, level, keep: was, ang: 0, pref: 0, at0: ref === primary ? pos : undefined });
    }
    this.deal(plan, spec);
    for (const p of plan) p.total = plan.length;
    const ground = city.ground.begin(spec, tImpact);
    this.pending.push({ at: tImpact, plan, ground, blast: { spec, pos, t: tImpact, count: plan.length, maxLevel, strength: r / S.blastRadius, dots: [] } });
    this.fx.geyser([pos.clone()], [hue]);
    return tImpact;
  }

  /**
   * Hues for the fresh buildings. Dealt (hueDeal 1): sorted by swirled angle
   * around the impact, they take the rainbow in turn after the center hue, so
   * a blast shows every hue in equal shares; 2 = equal contiguous wedges;
   * 0 = the layout hue at the building (shifted). Then, nearest first, each
   * takes the nearest hue no touching neighbor has and the ground under it hasn't.
   */
  private deal(plan: Scheduled[], spec: BlastSpec) {
    const S = config.splat;
    const mode = Math.round(S.hueDeal);
    const shift = Math.round(S.roofHueShift);
    const fresh = this.fresh;
    fresh.length = 0;
    for (const p of plan) {
      if (p.hue >= 0) continue;
      const dx = p.ref.cx - spec.x, dz = p.ref.cz - spec.z;
      const a = Math.atan2(dz, dx) + spec.twist * Math.hypot(dx, dz);
      p.ang = a - Math.floor(a / (Math.PI * 2)) * Math.PI * 2;
      p.pref = wrapHue(layoutHue(spec, dx, dz) + shift);
      fresh.push(p);
    }
    if (mode > 0) {
      fresh.sort((a, b) => a.ang - b.ang);
      const n = fresh.length;
      for (let k = 0; k < n; k++) fresh[k].pref = wrapHue(spec.hue + shift + (mode === 1 ? k : Math.floor((k * HUE_COUNT) / n)));
    }
    for (const p of plan) if (p.hue < 0) p.hue = this.freeHue(p.pref, p.ref, plan, layoutHue(spec, p.ref.cx - spec.x, p.ref.cz - spec.z));
  }

  /** The preferred hue unless a touching neighbor already has it (or it's the ground's): then the nearest free hue. */
  private freeHue(pref: number, ref: BuildingRef, plan: Scheduled[], ground: number): number {
    const ra = Math.sqrt(ref.area) * 0.5;
    for (const off of HUE_TRY) {
      const h = wrapHue(pref + off);
      if (h === ground) continue;
      let clash = false;
      for (const p of plan) {
        if (p.hue !== h) continue;
        const reach = ra + Math.sqrt(p.ref.area) * 0.5 + 2.5;
        if (Math.hypot(p.ref.cx - ref.cx, p.ref.cz - ref.cz) < reach) {
          clash = true;
          break;
        }
      }
      if (!clash) return h;
    }
    return pref;
  }

  update(dt: number) {
    this.t += dt;
    const S = config.splat;
    for (let i = 0; i < this.misses.length; ) {
      const m = this.misses[i];
      if (this.t < m.at) {
        i++;
        continue;
      }
      this.misses.splice(i, 1);
      this.fx.miss?.(m.pos, m.hue);
    }
    for (let i = 0; i < this.pending.length; ) {
      const p = this.pending[i];
      if (this.t < p.at) {
        i++;
        continue;
      }
      this.pending.splice(i, 1);
      const b = p.blast;
      // the whole wave goes to the GPU now (one upload): the shader times each pop
      for (const s of p.plan) this.city.paint.set(s.ref.index, { faction: FACTION_RAINBOW, color: s.hue, level: s.level, bloomTime: s.at, keep: s.keep });
      b.dots = this.city.ground.land(p.ground);
      blastUniforms.uBlastRing.value.set(b.spec.x, b.spec.z, b.t, b.spec.r);
      blastUniforms.uBlastRing2.value.set(b.spec.hue, S.ringWidth * Math.sqrt(b.strength), S.waveSpeed, waveMax(b.spec.r));
      this.fx.impact(b);
      this.fx.hitStop(S.hitStopFrames);
      for (const s of p.plan) this.queue.push(s);
    }
    for (let i = 0; i < this.queue.length; ) {
      const s = this.queue[i];
      if (this.t >= s.at) {
        this.queue.splice(i, 1);
        // (the primary's sparkles start where the breath hit it)
        this.fx.bloom(s.ref, s.order, s.total, s.hue, s.level, s.at0 ? s.at0.clone() : new THREE.Vector3(s.ref.cx, s.ref.roofY, s.ref.cz));
        if (s.order === 0) this.fx.primary(s.ref, s.hue);
      } else i++;
    }
  }

  /** Game clock (s), the same clock as globals.uTime. */
  get clock(): number {
    return this.t;
  }
}
