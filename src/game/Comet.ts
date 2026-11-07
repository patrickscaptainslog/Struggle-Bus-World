import * as THREE from 'three';
import { config } from '../config';
import { clamp } from './springs';
import type { City, BuildingRef } from '../world/City';
import type { Flight } from './Flight';
import type { Splatter } from './Splat';
import type { Shot } from './Aim';

// The Comet (docs/specs/shots/SHOTS.md, "The modes"; BUILT.md, step 3): "when in turbo, i want the splats i shoot to go forward through the sky, in front
// of the bus, and then hit a target thats visible to me as im still in turbo". A tap while a gear drives the bus at config.comet.speed or more (Nonstop
// engaged, Jet, Turbo 1-3, on the street and on the Moon) flies ahead on a shallow arc, config.comet.flight s after the inhale, and lands where the bus
// will be config.comet.pass s after the impact: along the aim's flat way (the nose, turned by a look), as far as the bus flies by then with the breath's
// stall in it, at most config.comet.reach (how far the city loads).
//
// In view: by this frame's lens moved on by the bus's travel to the impact, it must land at least config.comet.above of the height over the bus. High
// up, where it doesn't, it moves out along its line; where it never does by the reach, the tap is the classic shot (from a km or so over the ground).
//
// A building standing into the arc takes it on its face, on the same march the aim runs, so what glints is what it hits; one nearer than
// config.comet.wallAhead of the bus's travel at the impact is lobbed over instead (a higher arc), so a tower downtown isn't hit under the bus.
//
// Its blast is a tap's (Splatter.barf: blastRadiusFor(drop), life.blast with the whole circle, one level a building), with no ribbon from the mouth
// (the streak is the jet: src/fx/CometFx.ts) and no hit-stop that far off. This file picks the tap's shot in one place (chooseShot), with the Lob's slot.
//
// For the second account: Recess sets `clamp` to keep a match's Comet inside its fence; a captain's Comet is `plan` with its own flight (lens null).

/** A Comet's flight, planned at the tap (Shot.comet) and every frame for what glints (Aimer). */
export interface CometPlan {
  /** where it leaves the mouth, after the inhale (m) */
  x0: number;
  y0: number;
  z0: number;
  /** where it lands: a roof, a wall's face standing into its arc, the ground or the water (m) */
  x: number;
  y: number;
  z: number;
  /** the building it lands on (it glints), or null */
  target: BuildingRef | null;
  /** it lands on a wall's face, standing into its arc */
  wall: boolean;
  /** its arc's top over its chord (m) */
  arc: number;
  /** its flight from the mouth (s), and the bus's height over the landing (m) */
  travel: number;
  drop: number;
  /** m from the bus at the tap; m it lands ahead of where the bus will be at the impact; s until the bus passes it after the impact (as planned) */
  reach: number;
  ahead: number;
  pass: number;
  /** the bus's speed over the ground at the plan (m/s) */
  speed: number;
  /** its tile was in at the plan: when not, its blast is planned config.comet.late s before the impact (BarfOpts.late) */
  loaded: boolean;
  /** how far over the bus it lands on the screen at the impact, by the lens moved on (share of the height; 1 without a lens) */
  above: number;
}

/** A Comet now: a gear drives the bus at config.comet.speed or more. */
export function cometOn(f: Flight): boolean {
  return f.turbo.speed >= config.comet.speed - 0.5;
}

/** The tap's shot, in one place: the Comet's when it applies, else the aim's, and when the Lob's applies too, the farther landing wins (SHOTS.md, "How they fit together"). */
export function chooseShot(f: Flight, aim: Shot, comet: Shot | null, lob: Shot | null): Shot {
  const far = (s: Shot) => Math.hypot(s.x - f.x, s.z - f.z);
  const fast = comet ?? aim;
  return lob && far(lob) > far(fast) ? lob : fast;
}

const STEP = 1 / 60;
const SPAN = 4;

export class Comet {
  /** The lens the player sees (main.ts: the render camera, as last drawn; the probe its own). Null: no in-view rule (a captain's). */
  lens: THREE.Camera | null = null;
  /** Recess (src/recess): keep a match's Comet inside its fence. Moves the landing (x, z) in place, or returns false for no Comet (the classic shot). */
  clamp: ((p: { x: number; z: number }) => boolean) | null = null;
  /** The Lob's slot (SHOTS.md, "Lob"; not built): its shot for this tap, or null. */
  lob: ((f: Flight) => Shot | null) | null = null;
  /** the bus's distance flown over the ground since the tap, every STEP s to SPAN s, at the speed `table` was made for */
  private readonly table = new Float32Array(Math.ceil(SPAN / STEP) + 1);
  private tableV = -1;
  private readonly v = new THREE.Vector3();
  private readonly land = { x: 0, z: 0 };
  private readonly pt = { x: 0, z: 0 };

  constructor(
    private readonly city: City,
    private readonly splatter: Splatter,
  ) {}

  /**
   * How far the bus flies over the ground in t s from a tap at speed v with a gear driving it (m): the breath holds it toward 0.85 of it for its
   * second at the drive's spool rate, eased in, and the gear spools it back after (Flight.step, TurboDrive.update), stepped as they are.
   */
  flown(v: number, t: number): number {
    if (Math.abs(v - this.tableV) > 0.5) this.fill(v);
    const i = clamp(t / STEP, 0, this.table.length - 1), i0 = Math.floor(i), i1 = Math.min(this.table.length - 1, i0 + 1);
    return this.table[i0] + (this.table[i1] - this.table[i0]) * (i - i0) + (t > SPAN ? (t - SPAN) * v : 0);
  }

  /** The time the bus takes from the tap to fly d m (s), by the same table. */
  private timeTo(v: number, d: number): number {
    if (Math.abs(v - this.tableV) > 0.5) this.fill(v);
    const tb = this.table, n = tb.length;
    if (d >= tb[n - 1]) return SPAN + (d - tb[n - 1]) / Math.max(1, v);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (tb[m] < d) lo = m;
      else hi = m;
    }
    return (lo + (d - tb[lo]) / Math.max(1e-6, tb[hi] - tb[lo])) * STEP;
  }

  private fill(v: number) {
    const S = config.splat, T = config.turbo, F = config.flight;
    let s = v, d = 0, rateT = 0, kind = 0;
    this.table[0] = 0;
    for (let k = 1; k < this.table.length; k++) {
      const t = (k - 1) * STEP;
      // (TurboDrive: under the gear's speed it spools, its rate eased in; Flight: breathing, a jet's target is 0.85 of it, chased at that rate)
      const want = t < S.duration ? v * 0.85 : v;
      const kd = s < v - 1 ? 1 : 0;
      rateT = kd === kind ? rateT + STEP : 0;
      kind = kd;
      const e = clamp(rateT / Math.max(0.01, T.rateEase), 0, 1);
      const rate = kd ? (3 / Math.max(0.1, T.spool)) * (0.15 + 0.85 * e * e * (3 - 2 * e)) : F.speedHz * 2.2;
      s += (want - s) * (1 - Math.exp(-rate * STEP));
      d += s * STEP;
      this.table[k] = d;
    }
    this.tableV = v;
  }

  /** A point's height on the lens (NDC y), and whether it's in front of it. */
  private ndcY(x: number, y: number, z: number): number {
    const c = this.lens!, v = this.v.set(x, y, z).applyMatrix4(c.matrixWorldInverse);
    if (v.z >= -1) return -Infinity;
    return v.applyMatrix4(c.projectionMatrix).y;
  }

  /**
   * The Comet a tap fires now, or null (not fast enough, or nothing in view within the reach: the classic shot). fx, fz: the flat way it flies (the
   * aim's: the nose turned by a look).
   */
  plan(f: Flight, fx: number, fz: number, out: CometPlan): CometPlan | null {
    if (!cometOn(f)) return null;
    const C = config.comet, S = config.splat, city = this.city;
    const v = Math.max(1, f.ground);
    const tImp = S.inhale + C.flight;
    const atImp = this.flown(v, tImp), launch = this.flown(v, S.inhale);
    // (the lens moved on by the bus's travel to the impact: the same as moving the landing back by it)
    const ox = fx * atImp, oz = fz * atImp, oy = f.vy * tImp;
    const busY = this.lens ? this.ndcY(f.x, f.y, f.z) : 0;
    /** how far over the bus a landing d m along the way shows at the impact (share of the height; 1 without a lens) */
    const shows = (d: number) => {
      if (!this.lens) return 1;
      const lx = f.x + fx * d, lz = f.z + fz * d, q = this.ndcY(lx - ox, city.surfaceAt(lx, lz, f.y) - oy, lz - oz);
      return q === -Infinity ? -1 : (q - busY) * 0.5;
    };
    let d = Math.min(this.flown(v, tImp + C.pass), C.reach);
    while (shows(d) < C.above) {
      d += C.outStep;
      if (d > C.reach) return null;
    }
    // (the landing is the middle of a stretch of the way 2 x config.comet.hold s of the bus's travel long, anchored to the map: what glints holds while
    // the bus crosses a stretch, so it doesn't strobe at Turbo 3, and the same tap at 30 or 60 fps lands on the same building. The nearest middle, or
    // the next when the nearest doesn't show; never past the reach)
    const Ls = Math.max(24, 2 * C.hold * v), base = f.x * fx + f.z * fz;
    let dc = (Math.round((base + d) / Ls - 0.5) + 0.5) * Ls - base;
    while (shows(dc) < C.above && dc + Ls <= C.reach) dc += Ls;
    if (dc > C.reach) dc -= Ls;
    const above = shows(dc);
    if (above < C.above) return null;
    let x = f.x + fx * dc, z = f.z + fz * dc, y = city.surfaceAt(x, z, f.y);
    if (this.clamp) {
      this.pt.x = x;
      this.pt.z = z;
      if (!this.clamp(this.pt)) return null;
      x = this.pt.x;
      z = this.pt.z;
    }
    // what it lands on: the building there, as a tap picks one
    let target: BuildingRef | null = this.splatter.pick(x, z, this.splatter.pickRadius(Math.max(0, f.y - y)), f.y);
    if (target) {
      const l = city.landingOn(target, x, z, S.landInset, this.land, S.smallRad);
      x = l.x;
      z = l.z;
      y = city.roofAtPart(target, x, z, f.y) + 0.5;
    } else y = city.groundAt(x, z);
    // the arc from the mouth: a building standing into it takes it on its face; one too near the bus at the impact is lobbed over
    const x0 = f.x + fx * launch, z0 = f.z + fz * launch, y0 = f.y + f.vy * S.inhale;
    const L = Math.hypot(x - x0, z - z0), chord = Math.hypot(L, y - y0);
    const sMin = this.flown(v, tImp + C.wallAhead) - launch;
    let k = C.arc, wall: BuildingRef | null = null, ws = 0;
    for (let tries = 0; tries < 3 && L > 16; tries++) {
      let need = k;
      const last = tries === 2 || k >= C.arcMax;
      for (let s = 8; s < L - S.wallSkip; s += 8) {
        const u = s / L, bump = chord * 4 * u * (1 - u);
        const cy = y0 + (y - y0) * u, ay = cy + k * bump;
        const ref = city.buildingAbove(x0 + (x - x0) * u, z0 + (z - z0) * u, ay + S.wallClear, ay);
        if (!ref || ref === target || ref.roofY - ref.baseY < S.minTargetHeight) continue;
        if (s < sMin && !last) {
          need = Math.max(need, (ref.roofY + S.wallClear + 2 - cy) / Math.max(1, bump));
          continue;
        }
        wall = ref;
        ws = s;
        break;
      }
      if (wall || need <= k + 1e-4) break;
      k = Math.min(C.arcMax, need);
    }
    if (wall) {
      // on its face, just outside it, where the arc meets it
      const ux = (x - x0) / L, uz = (z - z0) / L;
      let lo = ws - 8, hi = ws;
      for (let i = 0; i < 5; i++) {
        const m = (lo + hi) * 0.5;
        if (city.contains(wall, x0 + ux * m, z0 + uz * m)) hi = m;
        else lo = m;
      }
      const w = Math.max(4, lo - 0.6), u = w / L;
      x = x0 + ux * w;
      z = z0 + uz * w;
      y = y0 + (y - y0) * u + k * chord * 4 * u * (1 - u);
      target = wall;
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
    out.arc = k * chord;
    out.travel = C.flight;
    out.drop = Math.max(0, f.y - y);
    out.reach = Math.hypot(x - f.x, z - f.z);
    out.ahead = along - atImp;
    out.pass = this.timeTo(v, along) - tImp;
    out.speed = v;
    out.loaded = city.terrainAt(x, z) !== null;
    out.above = above;
    return out;
  }

  /** The shot a plan fires (Aimer.fire). */
  shotOf(p: CometPlan): Shot {
    return { target: p.target, x: p.x, z: p.z, y: p.wall || !p.target ? p.y : undefined, exact: p.wall, drop: p.drop, travel: p.travel, comet: { ...p } };
  }
}
