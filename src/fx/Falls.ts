import * as THREE from 'three';
import { config } from '../config';
import { makeBlastSpec, LAYOUT_POOL, SHAPE_LUT, type BlastSpec } from '../game/blastLayout';
import type { Blast, SuperTag } from '../game/Splat';
import { ringContains, type City, type BuildingRef } from '../world/City';
import type { GroundJob } from '../world/GroundPaint';
import { FALLS, fallsLast, fallsOn, fallTime, setFall } from '../world/falls';
import { fxTune, type Particles } from './Particles';

// The Waterfall's play (behind &falls; src/world/falls.ts has the runs on the walls): a blast whose primary is over 40 m tall and that struck it 40 m up or
// more (a roof, or a Comet on a face) runs, once a tower, never a drive-by's, a mover's, a hose's, the landmarks' or the bridges'. The tower takes a slot of
// the runs; drops fall off the walls standing at their height (its tiers' real rings, a little out from them) onto its setbacks or the street, one per
// 1.25 m of fall, at most 160, a third of them splashing; and as the fastest runs reach the street a pool spreads out from its walls, 10 m past them in the
// walls' shape, one hue, the tower's, drawn while they fall (GroundPaint, LAYOUT_POOL with the footprint's distance by angle: revealed outward from the
// walls) and landed then, splashing up round the foot, painting what stands in it through life.blast with SuperTag { kind: 'falls' }. A trickle runs with
// them, the drops plop, the pool lands with a slap and a few falling notes (audio/fallsSfx.ts). A Bomb pours once too: its towers squash, they don't hop.

export const fallsTune = {
  /** a drop each this many m of fall, at most `drops`, a share of them splashing where they land; their size */
  dropEvery: 1.25,
  drops: 160,
  splashShare: 1 / 3,
  dropSize: 0.85,
  /** the pool reaches this far past the footprint's radius (m), spreading at this speed (m/s) from the walls */
  pool: 10,
  poolSpeed: 6,
  /** a drop lets go this far out from its wall (m), and tries this many points before it's left out (one flush with a taller neighbour lands above itself) */
  dropOut: 0.6,
  dropTries: 6,
  /** splashes round the foot as the pool lands, and their strength (Particles.splash): the pool coming up into view where it lands on the tap's own paint */
  footSplashes: 14,
  footSplash: 1.1,
  /** the pool's ground begins this long before it lands (s): drawn hidden over those frames, its live slot held for its own reveal alone; and after a wide
   *  blast still drawing, this long past the runs' reaching the street at most (s) */
  poolLead: 0.25,
  poolWait: 1.2,
};

/** The walls' distance from (cx, cz) by angle (SHAPE_LUT steps from +x toward +z): along each ray the farthest crossing of the ground tier's rings, so the
 *  pool's edge and its reveal keep the footprint's shape (BlastSpec.foot). A ray that crosses none (a centroid outside an odd footprint) takes the angle
 *  before it's, or the radius. */
export function footLut(ref: BuildingRef, out = new Float32Array(SHAPE_LUT)): Float32Array {
  const b = ref.tile;
  for (let k = 0; k < SHAPE_LUT; k++) {
    const a = (k / SHAPE_LUT) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let far = -1;
    for (let r = ref.local; r < ref.local + ref.parts; r++) {
      if (b.tier[r] !== 0) continue;
      const s = b.vertStart[r], e = b.vertStart[r + 1];
      for (let i = s, j = e - 1; i < e; j = i++) {
        // (the ray from the centroid against the edge j-i: t along the ray, u along the edge)
        const ax = b.xz[j * 2] - ref.cx, az = b.xz[j * 2 + 1] - ref.cz, ex = b.xz[i * 2] - b.xz[j * 2], ez = b.xz[i * 2 + 1] - b.xz[j * 2 + 1];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (ax * ez - az * ex) / den, u = (ax * dz - az * dx) / den;
        if (t > 0 && u >= 0 && u <= 1 && t > far) far = t;
      }
    }
    out[k] = far;
  }
  for (let pass = 0; pass < 2; pass++) for (let k = 0; k < SHAPE_LUT; k++) if (out[k] < 0) out[k] = out[(k + SHAPE_LUT - 1) % SHAPE_LUT];
  for (let k = 0; k < SHAPE_LUT; k++) if (out[k] < 0) out[k] = ref.rad;
  return out;
}

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
  /** the street under it, when the fastest run reaches it, and when its pool lands (Infinity until its ground is begun) */
  floor: number;
  down: number;
  land: number;
  hue: number;
  faction: number;
  drops: number;
  dropped: number;
  pool: GroundJob | null;
  spec: BlastSpec;
  landed: boolean;
}

/** A drop's start (Falls.edgeAt): a point a little out from a wall, and the wall's outward normal. */
export const fallEdge = { x: 0, z: 0, nx: 0, nz: 0 };

export class Falls {
  on = fallsOn;
  /** dropsLeft: drops left out, no point out from a wall at their height landing under it */
  readonly stats = { pours: 0, drops: 0, pools: 0, again: 0, dropsLeft: 0 };
  /** the towers that ran (stable ids): a pour once a tower */
  private readonly ran = new Set<number>();
  private readonly runs: Run[] = [];
  /** per slot: the game time its runs are all dry (FALLS.dry's longest, from the street up), when it's given back (setFall -1) so its tower's pixels stop
   *  paying for the test; -Infinity free */
  private readonly dryAt = new Float64Array(FALLS.slots).fill(-Infinity);
  /** per slot: its tower's height (m), how far its coat floods */
  private readonly tall = new Float64Array(FALLS.slots);
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
    // (a slot each: a free one, or the one drying soonest given up: four run at once. A fifth tower struck while all four still run takes the oldest's,
    // whose runs go in a frame, the farthest behind the bus)
    let slot = 0;
    for (let i = 1; i < FALLS.slots; i++) if (this.dryAt[i] < this.dryAt[slot]) slot = i;
    if (this.dryAt[slot] > -Infinity) this.release(slot, now);
    setFall(slot, p.index, y0, now);
    this.tall[slot] = p.roofY - p.baseY;
    this.dryAt[slot] = now + (y0 - floor) / FALLS.speed + FALLS.dry * 1.3 + 0.5;
    this.seed = (Math.imul(this.seed ^ 0x2545f491, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
    const spec = makeBlastSpec(p.cx, p.cz, p.rad + T.pool, rec.color, this.seed);
    // (10 m past the walls in their shape (foot), its rim wobbling 3 m or so: a tap's 0.8 of its circle, lobed by a quarter, would leave the walls dry, and a
    // circle round a long slab's farthest corner runs 50 m out past its long sides)
    Object.assign(spec, { layout: LAYOUT_POOL, sectors: 1, ring: p.rad, edge: 1, ragged: Math.min(0.15, 3 / spec.r), rays: 0, blobs: 0, dots: 6, faction: rec.faction, foot: footLut(p) });
    // (its ground begun later, update(): here, inside the impact, it finished a Bomb's own wide ground in the frame it landed, GroundPaint.begin)
    this.runs.push({ ref: p, y0, t0: now, floor, down, land: Infinity, hue: rec.color, faction: rec.faction, drops: Math.min(T.drops, Math.floor((y0 - floor) / T.dropEvery)), dropped: 0, pool: null, spec, landed: false });
    this.stats.pours++;
    this.hooks.trickle(down - now + 0.8);
    return true;
  }

  /** Once a frame on the game clock: the drops as the runs come down, the pool as they reach the street, the slots of runs gone dry given back. */
  update(now: number) {
    const T = fallsTune;
    for (let i = 0; i < FALLS.slots; i++) if (this.dryAt[i] > -Infinity && now >= this.dryAt[i]) this.release(i, now);
    for (let i = 0; i < this.runs.length; ) {
      const r = this.runs[i];
      const span = Math.max(0.05, r.down - r.t0);
      const due = Math.min(r.drops, Math.floor((r.drops * (now - r.t0)) / span));
      for (; r.dropped < due; r.dropped++) this.drop(r, r.dropped / Math.max(1, r.drops));
      // (the pool's ground poolLead s before it lands: begun at the impact it held a live slot for seconds, and four more blasts took it, its slow reveal
      // lost; and not while a wide blast still draws, a Bomb's that pours among them, its deadline kept, unless the runs have waited poolWait for it)
      if (!r.pool && now >= r.down - T.poolLead && (!this.city.ground.wideBusy() || now >= r.down + T.poolWait)) {
        r.land = Math.max(r.down, now + T.poolLead);
        r.pool = this.city.ground.begin(r.spec, r.land);
      }
      if (!r.landed && now >= r.land) {
        r.landed = true;
        if (r.pool) this.city.ground.land(r.pool);
        this.stats.pools++;
        this.hooks.pool(r.ref.cx, r.floor, r.ref.cz, r.spec.r, r.hue, { kind: 'falls', charge: 0, id: ++this.serial }, r.land, r.faction);
        this.hooks.slap();
        this.splashFoot(r);
      }
      if (r.landed && r.dropped >= r.drops) this.runs.splice(i, 1);
      else i++;
    }
  }

  /**
   * Slot i given back (its runs dry) or given up (a fifth tower's): its tower's own coat, still flooding down its walls, takes the FALLS.hold the building
   * program held it back by in a slot into its bloom time, so it floods on as it was; given up mid-flood it jumped on 27 m down a 300 m tower in a frame.
   */
  private release(i: number, now: number) {
    const idx = fallsLast[i].index;
    if (idx >= 0) {
      const rec = this.city.paint.get(idx);
      if (rec.level > 0.5 && now < rec.bloomTime + FALLS.hold + this.tall[i] / config.bloom.floodSpeed + 1) this.city.paint.delay(idx, FALLS.hold);
    }
    setFall(i, -1, 0, -1e3);
    this.dryAt[i] = -Infinity;
  }

  /** One drop as far down as the runs are (k: 0 at the impact, 1 at the street): off a wall standing at that height, onto what's under it. */
  private drop(r: Run, k: number) {
    this.stats.drops++;
    const P = this.particles;
    if (!P) return;
    const T = fallsTune, ref = r.ref, E = fallEdge;
    const y = r.y0 - (r.y0 - r.floor) * Math.min(0.92, k);
    // (a point out from a wall that lands under it: one in or flush with a taller neighbour is tried again, and the drop left out after dropTries)
    let ty = 0, drift = 0, found = false;
    for (let n = 0; n < T.dropTries && !found; n++) {
      if (!this.edgeAt(ref, y)) break;
      drift = 0.3 + 0.9 * Math.random();
      ty = this.hooks.landing(E.x + E.nx * drift, E.z + E.nz * drift, y - 1);
      found = ty < y - 1;
    }
    if (!found) {
      this.stats.dropsLeft++;
      return;
    }
    this.from.set(E.x, y, E.z);
    this.to.set(E.x + E.nx * drift, ty + 0.15, E.z + E.nz * drift);
    const g = fxTune.gravity * fxTune.flingGravity;
    const flight = Math.sqrt((2 * Math.max(1, y - ty)) / g);
    // (two in three land without a splash of their own)
    const keep = fxTune.flingSplash;
    if (Math.random() >= T.splashShare) fxTune.flingSplash = 0;
    P.fling(this.from, this.to, flight, r.hue, T.dropSize * (0.7 + 0.6 * Math.random()));
    fxTune.flingSplash = keep;
    if (Math.random() < 0.25) this.hooks.plop(flight);
  }

  /**
   * A point dropOut m out from one of the tower's walls standing at height y (its records whose span holds y: the tower above a podium, the podium under
   * it), anywhere along them by length, in none of its records standing there: into fallEdge. False when no wall stands at y or four tries found none.
   */
  edgeAt(ref: BuildingRef, y: number): boolean {
    const b = ref.tile, T = fallsTune, E = fallEdge, end = ref.local + ref.parts;
    let total = 0;
    for (let k = ref.local; k < end; k++) {
      if (b.baseY[k] > y || b.roofY[k] <= y) continue;
      for (let i = b.vertStart[k], j = b.vertStart[k + 1] - 1; i < b.vertStart[k + 1]; j = i++) total += Math.hypot(b.xz[i * 2] - b.xz[j * 2], b.xz[i * 2 + 1] - b.xz[j * 2 + 1]);
    }
    if (total <= 0) return false;
    for (let tries = 0; tries < 4; tries++) {
      let at = Math.random() * total;
      for (let k = ref.local; k < end && at >= 0; k++) {
        if (b.baseY[k] > y || b.roofY[k] <= y) continue;
        for (let i = b.vertStart[k], j = b.vertStart[k + 1] - 1; i < b.vertStart[k + 1]; j = i++) {
          const ax = b.xz[j * 2], az = b.xz[j * 2 + 1], ex = b.xz[i * 2] - ax, ez = b.xz[i * 2 + 1] - az, len = Math.max(1e-6, Math.hypot(ex, ez));
          if (at > len) {
            at -= len;
            continue;
          }
          // (out from the wall: the side its own ring doesn't hold)
          const mx = ax + (ex * at) / len, mz = az + (ez * at) / len;
          let nx = ez / len, nz = -ex / len;
          if (ringContains(b, k, mx + nx * 0.05, mz + nz * 0.05)) {
            nx = -nx;
            nz = -nz;
          }
          E.x = mx + nx * T.dropOut;
          E.z = mz + nz * T.dropOut;
          E.nx = nx;
          E.nz = nz;
          // (and in none of its walls standing there: the corner between two of its parts is inside)
          let inside = false;
          for (let q = ref.local; q < end && !inside; q++) inside = b.baseY[q] <= y && b.roofY[q] > y && ringContains(b, q, E.x, E.z);
          if (!inside) return true;
          at = -1;
          break;
        }
      }
    }
    return false;
  }

  /** The pool lands: splashes come up round the foot, just out from its walls (its footprint's shape), so it reads where it lands on the tap's own paint. */
  private splashFoot(r: Run) {
    const P = this.particles, foot = r.spec.foot;
    if (!P || !foot) return;
    const T = fallsTune;
    for (let i = 0; i < T.footSplashes; i++) {
      const k = Math.floor(((i + Math.random() * 0.7) / T.footSplashes) * SHAPE_LUT) % SHAPE_LUT, a = (k / SHAPE_LUT) * Math.PI * 2, d = foot[k] + 1.5 + Math.random() * 3;
      const x = r.ref.cx + Math.cos(a) * d, z = r.ref.cz + Math.sin(a) * d;
      this.from.set(x, this.hooks.landing(x, z, r.floor + 3) + 0.2, z);
      P.splash(this.from, r.hue, T.footSplash, Math.random() * 0.25);
    }
  }
}
