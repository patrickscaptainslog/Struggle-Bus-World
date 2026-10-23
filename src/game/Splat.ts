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
// them is splattered too (GroundPaint). Hues fan out around the impact
// (blastLayout: pinwheel by default) and neighbors never share a hue.
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
}

interface Scheduled {
  at: number;
  ref: BuildingRef;
  order: number;
  total: number;
  hue: number;
  level: number;
  keep: boolean;
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
  private t = 0;
  private seed = (Math.random() * 0xffffffff) >>> 0;

  constructor(private city: City, private fx: SplatFx) {}

  /** The building a projectile aimed at (x, z) would hit (snaps, so aim is forgiving). */
  pick(x: number, z: number): BuildingRef | null {
    const S = config.splat;
    const city = this.city;
    const near = city.buildingsNear(x, z, S.snapRadius + 12, this.near);
    for (const n of near) if (city.contains(n.ref, x, z)) return n.ref;
    for (const n of near) if (n.d <= S.snapRadius) return n.ref;
    return null;
  }

  /** Blast radius for a barf from `drop` meters above the impact (m). */
  radius(drop = 0): number {
    return blastRadiusFor(drop);
  }

  /**
   * Launch a projectile at (x, z): it explodes config.splat.impactDelay s
   * later. `drop` = meters the bus is above the impact; the blast grows with
   * it (about x2 at 300 m). Returns the game-clock time of the impact.
   */
  barf(x: number, z: number, opts?: { drop?: number }): number {
    const S = config.splat;
    const city = this.city;
    const paint = city.paint;
    const primary = this.pick(x, z);
    const tImpact = this.t + S.impactDelay;
    const r = blastRadiusFor(opts?.drop ?? 0);
    const cx = primary ? primary.cx : x;
    const cz = primary ? primary.cz : z;
    // the blast's center hue: an escalating primary keeps its color, a fresh one takes the next hue
    const pRec = primary ? paint.get(primary.index) : null;
    const hue = pRec && pRec.level > 0.5 ? wrapHue(pRec.color) : this.nextHue;
    if (!pRec || pRec.level < 0.5) this.nextHue = (this.nextHue + 1) % HUE_COUNT;
    this.seed = (Math.imul(this.seed ^ 0x2545f491, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
    const spec = makeBlastSpec(cx, cz, r, hue, this.seed);

    // every building the blast reaches (footprint, not centroid: a big block
    // half inside the radius blooms too), nearest edge first, capped
    const cap = Math.min(S.maxBuildingsCap, Math.max(1, Math.round((S.maxBuildings * r) / S.blastRadius)));
    const near = city.buildingsNear(cx, cz, r + 45, this.near);
    const reach = this.reachList;
    reach.length = 0;
    for (const n of near) {
      const e = n.d - 0.55 * Math.sqrt(n.ref.area);
      if (e <= r) reach.push({ ref: n.ref, d: n.d, e: n.ref === primary ? -1e9 : e });
    }
    reach.sort((a, b) => a.e - b.e);
    const plan: Scheduled[] = [];
    let maxLevel = 1;
    for (const n of reach) {
      if (plan.length >= cap) break;
      const ref = n.ref;
      const lv = paint.level(ref.index);
      const was = lv > 0.5;
      const level = was ? Math.min(3, Math.round(lv) + 1) : 1;
      let h: number;
      if (was) h = wrapHue(paint.get(ref.index).color);
      else if (ref === primary) h = hue;
      else h = this.freeHue(layoutHue(spec, ref.cx - cx, ref.cz - cz) + Math.round(S.roofHueShift), ref, plan);
      maxLevel = Math.max(maxLevel, level);
      // it pops when the shockwave reaches its near edge
      plan.push({ at: tImpact + arrival(ref === primary ? 0 : Math.max(0, n.e), r), ref, order: plan.length, total: 0, hue: h, level, keep: was });
    }
    for (const p of plan) p.total = plan.length;
    const pos = primary ? new THREE.Vector3(cx, primary.roofY + 0.5, cz) : new THREE.Vector3(x, city.groundAt(x, z), z);
    const ground = city.ground.begin(spec, tImpact);
    this.pending.push({ at: tImpact, plan, ground, blast: { spec, pos, t: tImpact, count: plan.length, maxLevel, strength: r / S.blastRadius, dots: [] } });
    this.fx.geyser([pos.clone()], [hue]);
    return tImpact;
  }

  /** The layout's hue unless a touching neighbor already has it: then the nearest free hue. */
  private freeHue(pref: number, ref: BuildingRef, plan: Scheduled[]): number {
    const ra = Math.sqrt(ref.area) * 0.5;
    for (const off of HUE_TRY) {
      const h = wrapHue(pref + off);
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
        this.fx.bloom(s.ref, s.order, s.total, s.hue, s.level, new THREE.Vector3(s.ref.cx, s.ref.roofY, s.ref.cz));
        if (s.order === 0) this.fx.primary(s.ref, s.hue);
      } else i++;
    }
  }

  /** Game clock (s), the same clock as globals.uTime. */
  get clock(): number {
    return this.t;
  }
}
