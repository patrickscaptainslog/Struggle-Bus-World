import * as THREE from 'three';
import { config } from '../config';
import { HUE_COUNT } from '../render/palette';
import type { City, BuildingRef } from '../world/City';
import { FACTION_RAINBOW } from '../world/PaintState';

// The barf -> bloom pipeline. Dragon breath: the bus blasts a rainbow
// projectile forward; it snaps to the building at the aim point ahead; paint spills only onto unpainted neighbors ("smart
// spill", so nobody's art gets overwritten); a painted primary escalates.
// Colors fan Painted-Ladies style: the primary takes the next hue, neighbors
// take adjacent hues by which side of it they're on.

export interface SplatFx {
  geyser(targets: THREE.Vector3[], hues: number[]): void;
  impact(pos: THREE.Vector3, hue: number, strength: number): void;
  bloom(ref: BuildingRef, order: number, total: number, hue: number, level: number, roof: THREE.Vector3): void;
  primary(ref: BuildingRef, hue: number): void;
  hitStop(frames: number): void;
  miss(pos: THREE.Vector3): void;
}

interface Scheduled {
  at: number;
  ref: BuildingRef;
  order: number;
  total: number;
  hue: number;
  level: number;
}

export class Splatter {
  private nextHue = Math.floor(Math.random() * HUE_COUNT);
  private queue: Scheduled[] = [];
  private impactAt = -1;
  private impactPos = new THREE.Vector3();
  private impactHue = 0;
  private near: Array<{ ref: BuildingRef; d: number }> = [];
  private t = 0;
  /** paint-density bookkeeping for fog clearing */
  onPainted: ((ref: BuildingRef) => void) | null = null;

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

  /** Choose targets for a projectile landing at (x, z) and schedule the cascade. */
  barf(x: number, z: number) {
    const S = config.splat;
    const city = this.city;
    const primary = this.pick(x, z);
    const tImpact = this.t + S.impactDelay;
    if (!primary) {
      this.impactAt = tImpact;
      this.impactPos.set(x, city.groundAt(x, z), z);
      this.fx.geyser([this.impactPos.clone()], [this.nextHue]);
      this.fx.miss(this.impactPos.clone());
      return;
    }
    const paint = city.paint;
    const pRec = paint.get(primary.index);
    const hue = pRec.level > 0.5 ? pRec.color : this.nextHue;
    const level = pRec.level > 0.5 ? Math.min(3, pRec.level + 1) : 1;
    if (pRec.level < 0.5) this.nextHue = (this.nextHue + 1) % HUE_COUNT;
    const plan: Scheduled[] = [{ at: tImpact, ref: primary, order: 0, total: 1, hue, level }];

    // smart spill onto unpainted neighbors, fanned by side
    const front = city.frontOf(primary);
    const sx = -front.nz, sz = front.nx; // along the street
    const spill = city.buildingsNear(primary.cx, primary.cz, S.spillRadius, []);
    let left = 0, right = 0;
    for (const n of spill) {
      if (plan.length >= S.maxBuildings) break;
      if (n.ref === primary || paint.level(n.ref.index) > 0.5) continue;
      if (n.ref.roofY - n.ref.baseY < 2.5) continue;
      const side = (n.ref.cx - primary.cx) * sx + (n.ref.cz - primary.cz) * sz;
      let off: number;
      if (side >= 0) off = ++right;
      else off = -++left;
      plan.push({ at: 0, ref: n.ref, order: plan.length, total: 0, hue: (((hue + off) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT, level: 1 });
    }
    plan.forEach((p, i) => {
      p.total = plan.length;
      p.at = tImpact + i * S.cascadeStep;
    });
    this.queue.push(...plan);
    this.impactAt = tImpact;
    this.impactHue = hue;
    this.impactPos.set(primary.cx, primary.roofY + 0.5, primary.cz);
    this.fx.geyser(
      plan.map((p) => new THREE.Vector3(p.ref.cx, p.ref.roofY + 0.3, p.ref.cz)),
      plan.map((p) => p.hue),
    );
  }

  update(dt: number, now: number) {
    this.t += dt;
    if (this.impactAt >= 0 && this.t >= this.impactAt) {
      this.impactAt = -1;
      this.fx.impact(this.impactPos, this.impactHue, 1);
      this.fx.hitStop(config.splat.hitStopFrames);
    }
    for (let i = 0; i < this.queue.length; ) {
      const s = this.queue[i];
      if (this.t >= s.at) {
        this.queue.splice(i, 1);
        this.city.paint.set(s.ref.index, { faction: FACTION_RAINBOW, color: s.hue, level: s.level, bloomTime: now });
        const roof = new THREE.Vector3(s.ref.cx, s.ref.roofY, s.ref.cz);
        this.fx.bloom(s.ref, s.order, s.total, s.hue, s.level, roof);
        if (s.order === 0) this.fx.primary(s.ref, s.hue);
        this.onPainted?.(s.ref);
      } else i++;
    }
  }
}
