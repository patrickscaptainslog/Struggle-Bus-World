import * as THREE from 'three';
import { makeBlastSpec, LAYOUT_POOL, type BlastSpec } from '../game/blastLayout';
import type { Blast, SuperTag } from '../game/Splat';
import type { City, BuildingRef } from '../world/City';
import type { GroundJob } from '../world/GroundPaint';
import { FALLS, fallsOn, fallTime, setFall } from '../world/falls';
import { fxTune, type Particles } from './Particles';

// The Waterfall's play (behind &falls; src/world/falls.ts has the runs on the walls): a blast whose primary is over 40 m tall and that struck it 40 m up or
// more (a roof, or a Comet on a face) runs, once a tower, never a drive-by's, a mover's, a hose's, the landmarks' or the bridges'. The tower takes a slot of
// the runs; drops fall off its edges onto its setbacks or the street, one per 1.25 m of fall, at most 160, a third of them splashing; and as the fastest
// runs reach the street a pool spreads out from its walls, ref.rad + 10 m, one hue, the tower's, drawn while they fall (GroundPaint, LAYOUT_POOL: revealed
// outward from the walls) and landed then, painting what stands in it through life.blast with SuperTag { kind: 'falls' }. A trickle runs with them, the
// drops plop, the pool lands with a slap and a few falling notes (audio/fallsSfx.ts). A Bomb pours once too: its towers squash, they don't hop.

export const fallsTune = {
  /** a drop each this many m of fall, at most `drops`, a share of them splashing where they land; their size */
  dropEvery: 1.25,
  drops: 160,
  splashShare: 1 / 3,
  dropSize: 0.85,
  /** the pool reaches this far past the footprint's radius (m), spreading at this speed (m/s) from the walls */
  pool: 10,
  poolSpeed: 6,
};

export interface FallsHooks {
  /** where a drop let go at (x, fromY, z) comes down: a setback under it, or the street */
  landing(x: number, z: number, fromY: number): number;
  /** the pool lands: life paints what stands in it */
  pool(x: number, y: number, z: number, r: number, hue: number, tag: SuperTag, arrive: number, faction: number): void;
  /** the sounds: the runs' trickle for `secs`, a drop's plop, the pool's slap */
  trickle(secs: number): void;
  plop(delay: number): void;
  slap(): void;
}

interface Run {
  ref: BuildingRef;
  y0: number;
  t0: number;
  /** the street under it, and when the fastest run reaches it */
  floor: number;
  down: number;
  hue: number;
  faction: number;
  drops: number;
  dropped: number;
  pool: GroundJob | null;
  spec: BlastSpec;
  landed: boolean;
}

export class Falls {
  on = fallsOn;
  readonly stats = { pours: 0, drops: 0, pools: 0, again: 0 };
  /** the towers that ran (stable ids): a pour once a tower */
  private readonly ran = new Set<number>();
  private readonly runs: Run[] = [];
  private slot = 0;
  private serial = 0;
  private seed = 0x5eed1234;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();

  constructor(private readonly city: City, private readonly particles: Particles | null, private readonly hooks: FallsHooks) {}

  /** Whether this blast pours: its primary over 40 m tall, struck 40 m up or more, and none of what never pours. */
  pours(b: Blast): boolean {
    const p = b.primary;
    if (!p || b.hose || b.mover || b.afloat || b.side || p.stableId < 0) return false;
    if (b.super && b.super.kind !== 'bomb' && b.super.kind !== 'mega') return false;
    return p.roofY - p.baseY > FALLS.tall && b.pos.y - p.baseY >= FALLS.up;
  }

  /** A blast landed (main.ts's impact, the Splatter's clock `now`): true when it started a pour. */
  impact(b: Blast, now: number): boolean {
    if (!this.on || !this.pours(b)) return false;
    const p = b.primary!;
    if (this.ran.has(p.stableId)) {
      this.stats.again++;
      return false;
    }
    this.ran.add(p.stableId);
    const rec = this.city.paint.get(p.index);
    const y0 = Math.min(b.pos.y, p.roofY);
    const floor = this.city.groundAt(p.cx, p.cz);
    const down = now + fallTime(y0 - floor);
    const T = fallsTune;
    // (a slot each, the oldest given up first: four run at once)
    const slot = this.slot;
    this.slot = (this.slot + 1) % FALLS.slots;
    setFall(slot, p.index, y0, now);
    this.seed = (Math.imul(this.seed ^ 0x2545f491, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
    const spec = makeBlastSpec(p.cx, p.cz, p.rad + T.pool, rec.color, this.seed);
    // (out to its radius, its rim wobbling 3 m or so: a tap's 0.8 of its circle, lobed by a quarter, would leave the walls dry)
    Object.assign(spec, { layout: LAYOUT_POOL, sectors: 1, ring: p.rad, edge: 1, ragged: Math.min(0.15, 3 / spec.r), rays: 0, blobs: 0, dots: 6, faction: rec.faction });
    const pool = this.city.ground.begin(spec, down);
    this.runs.push({ ref: p, y0, t0: now, floor, down, hue: rec.color, faction: rec.faction, drops: Math.min(T.drops, Math.floor((y0 - floor) / T.dropEvery)), dropped: 0, pool, spec, landed: false });
    this.stats.pours++;
    this.hooks.trickle(down - now + 0.8);
    return true;
  }

  /** Once a frame on the game clock: the drops as the runs come down, the pool as they reach the street. */
  update(now: number) {
    for (let i = 0; i < this.runs.length; ) {
      const r = this.runs[i];
      const span = Math.max(0.05, r.down - r.t0);
      const due = Math.min(r.drops, Math.floor((r.drops * (now - r.t0)) / span));
      for (; r.dropped < due; r.dropped++) this.drop(r, r.dropped / Math.max(1, r.drops));
      if (!r.landed && now >= r.down) {
        r.landed = true;
        if (r.pool) this.city.ground.land(r.pool);
        this.stats.pools++;
        this.hooks.pool(r.ref.cx, r.floor, r.ref.cz, r.spec.r, r.hue, { kind: 'falls', charge: 0, id: ++this.serial }, r.down, r.faction);
        this.hooks.slap();
      }
      if (r.landed && r.dropped >= r.drops) this.runs.splice(i, 1);
      else i++;
    }
  }

  /** One drop off the tower's edge, as far down as the runs are (k: 0 at the impact, 1 at the street). */
  private drop(r: Run, k: number) {
    this.stats.drops++;
    const P = this.particles;
    if (!P) return;
    const T = fallsTune, ref = r.ref;
    const half = Math.sqrt(ref.area) * 0.5;
    // (off one of the footprint's four sides, a little out from it, wherever along it)
    const side = Math.floor(Math.random() * 4), along = (Math.random() - 0.5) * 2 * half, out = half + 0.6;
    const dx = side === 0 ? out : side === 1 ? -out : along, dz = side === 2 ? out : side === 3 ? -out : along;
    const y = r.y0 - (r.y0 - r.floor) * Math.min(0.92, k);
    this.from.set(ref.cx + dx, y, ref.cz + dz);
    const ty = this.hooks.landing(this.from.x + dx * 0.04, this.from.z + dz * 0.04, y - 1);
    this.to.set(this.from.x + dx * 0.04, ty + 0.15, this.from.z + dz * 0.04);
    const g = fxTune.gravity * fxTune.flingGravity;
    const flight = Math.sqrt((2 * Math.max(1, y - ty)) / g);
    // (two in three land without a splash of their own)
    const keep = fxTune.flingSplash;
    if (Math.random() >= T.splashShare) fxTune.flingSplash = 0;
    P.fling(this.from, this.to, flight, r.hue, T.dropSize * (0.7 + 0.6 * Math.random()));
    fxTune.flingSplash = keep;
    if (Math.random() < 0.25) this.hooks.plop(flight);
  }
}
