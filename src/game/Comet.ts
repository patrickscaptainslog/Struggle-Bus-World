import * as THREE from 'three';
import { config } from '../config';
import { clamp } from './springs';
import type { City, BuildingRef } from '../world/City';
import type { Flight } from './Flight';
import type { Splatter } from './Splat';
import type { Shot } from './Aim';

// The Comet (docs/specs/shots/SHOTS.md, "The modes"; BUILT.md, step 3): "when in turbo, i want the splats i shoot to go forward through the sky, in front
// of the bus, and then hit a target thats visible to me as im still in turbo". A tap while a gear drives the bus at config.comet.speed or more (Nonstop
// engaged, Jet, Turbo 1-3, on the street and on the Moon) flies ahead, config.comet.flight s after the inhale, and lands where the bus will be
// config.comet.pass s after the impact: along the aim's flat way (the nose, turned by a look), as far as the bus flies by then with the breath's stall in
// it, at most config.comet.reach (how far the city loads), and config.comet.side m off the bus's line, the side swapping with each Comet. Its arc climbs
// through the sky, topping config.comet.arc of its chord, less where its top would leave the frame: it leaves, climbs past the skyline and drops beside
// the bus. On the bus's own line, on a low arc, it read as a beam out of the bus with a mast standing on it (the outside look of step 3).
//
// In view: by this frame's lens moved on by the bus's travel to the impact, it must land at least config.comet.above of the height over the bus. High
// up, where it doesn't, it moves out along its line; where it never does by the reach, the tap is the classic shot (from a km or so over the ground).
// The ground standing between the lens and it (a ridge) takes it on the ridge, where it's seen, when that's still far enough ahead.
//
// What glints holds: the landing is the middle of a stretch of its way 2 x config.comet.hold s of the bus's travel long, counted along the bus's own
// travel (from the map's origin, a turn swept the stretches past), and it's held for its stretch, so what glints changes at most once a stretch, steering
// or not, and the same tap at 30 or 60 fps lands on the same building. A press, or the steering thumb lifting, latches it for config.splat.aimLatch s, as
// the aim latches what glints.
//
// A building standing into the arc takes it on its face, on the same march the aim runs, so what glints is what it hits; one nearer than
// config.comet.wallAhead of the bus's travel at the impact is lobbed over instead (a higher arc), so a tower downtown isn't hit under the bus. The ground
// standing into it (a hillside) is lobbed over too, and where even the highest arc doesn't clear it, it lands on the hillside.
//
// Its blast is a tap's (Splatter.barf: blastRadiusFor(drop), life.blast with the whole circle, one level a building), with no ribbon from the mouth
// (the streak is the jet: src/fx/CometFx.ts) and no hit-stop that far off. This file picks the tap's shot in one place (chooseShot): the Comet's, or the
// Lob's (src/game/Lob.ts) where that lands farther, every frame and at the tap.
//
// For the second account: Recess sets `clamp` to keep a match's Comet inside its fence (told the kind: a Lob asks it too); a captain's Comet is its own Comet, `track`ed every frame and
// `plan`ned with its own flight (lens null). HOOKS.md has both, and that a Comet takes the place of the aim's mover.

/** What a planned flight is, as Recess's clamp is told it: the Comet, the Lob (src/game/Lob.ts), the Cloudburst (later). */
export type ShotKind = 'comet' | 'lob' | 'cloud';

/** A Comet's flight, planned at the tap (Shot.comet) and every frame for what glints (Aimer). A Lob's is one too. */
export interface CometPlan {
  /** where it leaves the mouth, after the inhale (m) */
  x0: number;
  y0: number;
  z0: number;
  /** where it lands: a roof, a wall's face standing into its arc, the ground, a hillside or the water (m) */
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
  /** a Lob's (Lob.plan), and the angle it leaves the mouth at (rad); a Comet's has neither */
  kind?: ShotKind;
  angle?: number;
}

/** A Comet now: a gear drives the bus at config.comet.speed or more. */
export function cometOn(f: Flight): boolean {
  return f.turbo.speed >= config.comet.speed - 0.5;
}

/**
 * The tap's shot, in one place (Aimer.update every frame, so what glints is what a tap fires): the Lob's when it applies, the Comet's when it does, and when
 * both do the farther landing wins (SHOTS.md, "How they fit together"); else the aim's. The Lob weighs only the Comet: against today's shot, which from about
 * 450 m up lands farther than a Lob would, it always wins.
 */
export function chooseShot<A, T extends { x: number; z: number }>(f: Flight, aim: A, comet: T | null, lob: T | null): A | T {
  if (!lob) return comet ?? aim;
  if (!comet) return lob;
  return far(f, lob) > far(f, comet) ? lob : comet;
}

/** How far a landing is from the bus over the ground (m). */
function far(f: Flight, s: { x: number; z: number }): number {
  return Math.hypot(s.x - f.x, s.z - f.z);
}

const STEP = 1 / 60;
const SPAN = 4;

export class Comet {
  /** The lens the player sees (main.ts: the render camera, as last drawn; the probe its own). Null: no in-view rule (a captain's). */
  lens: THREE.Camera | null = null;
  /** Recess (src/recess): keep a match's Comet inside its fence. Moves the landing's point on the line (x, z) in place, or returns false for no Comet (the classic
   *  shot). `kind` says whose landing it is: a Comet's, or a Lob's (src/game/Lob.ts asks it the same way). */
  clamp: ((p: { x: number; z: number }, kind: ShotKind) => boolean) | null = null;
  /** the bus's distance flown over the ground since the tap, every STEP s to SPAN s, at the speed `table` was made for */
  private readonly table = new Float32Array(Math.ceil(SPAN / STEP) + 1);
  private tableV = -1;
  private readonly v = new THREE.Vector3();
  private readonly landPt = { x: 0, z: 0 };
  private readonly pt = { x: 0, z: 0 };
  /** the side of the bus's line it lands on (+1 its right), swapped with each Comet fired */
  private side = 1;
  /** the odometer: the bus's travel over the ground (m), the stretches counted along it, and where it was last frame */
  private odo = NaN;
  private odoX = 0;
  private odoZ = 0;
  /** the landing held for its stretch (index heldK), or latched until latchUntil (game s) */
  private heldOk = false;
  private heldK = 0;
  private heldX = 0;
  private heldY = 0;
  private heldZ = 0;
  private heldT: BuildingRef | null = null;
  private latchUntil = -1;
  /** what the last shotOf changed, for unshot: the side, and the held landing it dropped */
  private wasSide = 1;
  private wasHeld = false;
  private wasLatch = -1;
  /** this plan's lens moved on by the bus's travel to the impact (m), and the bus's height on it (NDC) */
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private busY = 0;

  constructor(
    private readonly city: City,
    private readonly splatter: Splatter,
  ) {}

  /** The bus's travel this frame, every frame, a Comet planned or not (Aimer.update; a captain's caller): the odometer the stretches are counted along. */
  track(f: Flight): void {
    const step = Math.hypot(f.x - this.odoX, f.z - this.odoZ);
    // (the first frame, or a jump the bus didn't fly: counted again from where it is along its way)
    if (Number.isNaN(this.odo) || step > 60 + 0.25 * f.ground) this.odo = f.x * f.fx + f.z * f.fz;
    else this.odo += step;
    this.odoX = f.x;
    this.odoZ = f.z;
  }

  /** The odometer (m): the bus's travel over the ground, counted along it, that the stretches are counted along (the Lob's too). */
  get odometer(): number {
    return this.odo;
  }

  /** ?moon: the map slid by (dx, dz) (main.ts): the held landing and the odometer's last point slide with it. */
  slide(dx: number, dz: number): void {
    this.odoX -= dx;
    this.odoZ -= dz;
    this.heldX -= dx;
    this.heldZ -= dz;
  }

  /** The landing glinting now stays until game time `until` (a press, the steering thumb lifting: Aimer.update and press), whatever the stretch. */
  latch(until: number): void {
    if (this.heldOk) this.latchUntil = Math.max(this.latchUntil, until);
  }

  /** Steering again: the latch lets go. */
  unlatch(): void {
    this.latchUntil = -1;
  }

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

  /** How far over the bus a point shows at the impact, by this plan's lens moved on (share of the height; 1 without a lens, -1 behind it). */
  private showsAt(x: number, y: number, z: number): number {
    if (!this.lens) return 1;
    const q = this.ndcY(x - this.ox, y - this.oy, z - this.oz);
    return q === -Infinity ? -1 : (q - this.busY) * 0.5;
  }

  /** The same for a landing d m along the way, on what's there. */
  private showsAlong(f: Flight, fx: number, fz: number, d: number): number {
    if (!this.lens) return 1;
    const x = f.x + fx * d, z = f.z + fz * d;
    return this.showsAt(x, this.city.surfaceAt(x, z, f.y), z);
  }

  /** No Comet now: nothing held. */
  private none(): null {
    this.heldOk = false;
    this.latchUntil = -1;
    return null;
  }

  /**
   * The Comet a tap fires now, or null (not fast enough, or nothing in view within the reach: the classic shot). fx, fz: the flat way it flies (the
   * aim's: the nose turned by a look). t: game time (the latch's clock).
   */
  plan(f: Flight, fx: number, fz: number, out: CometPlan, t = 0): CometPlan | null {
    if (!cometOn(f)) return this.none();
    const C = config.comet, S = config.splat, city = this.city;
    const v = Math.max(1, f.ground);
    const tImp = S.inhale + C.flight;
    const atImp = this.flown(v, tImp), launch = this.flown(v, S.inhale);
    // (the lens moved on by the bus's travel to the impact: the same as moving the landing back by it. A climb is in it, a descent isn't: a gear's floor
    // levels the bus out, and a descent carried on put the landing higher on the screen than it came down. The review of step 3, 6)
    this.ox = fx * atImp;
    this.oz = fz * atImp;
    this.oy = Math.max(0, f.vy) * tImp;
    this.busY = this.lens ? this.ndcY(f.x, f.y, f.z) : 0;
    let d = Math.min(this.flown(v, tImp + C.pass), C.reach);
    while (this.showsAlong(f, fx, fz, d) < C.above) {
      d += C.outStep;
      if (d > C.reach) return this.none();
    }
    // (the stretch: counted along the bus's travel, the nearest middle, short of the reach. Its length is the gear's, not the speed it has now, which a
    // dive, a climb or the breath's stall moves, and with it every middle: 30 and 60 fps landed 39 m apart in a dive)
    const Ls = Math.max(24, 2 * C.hold * f.turbo.speed);
    let k = Math.round((this.odo + d) / Ls - 0.5);
    if ((k + 0.5) * Ls - this.odo > C.reach) k--;
    // held while the nearest middle hasn't passed its stretch and it shows; latched, while it's ahead of the bus at the impact and on the screen
    const latched = this.heldOk && t < this.latchUntil;
    let keep = false;
    if (this.heldOk && (latched || this.heldK >= k)) {
      const sh = this.showsAt(this.heldX, this.heldY, this.heldZ);
      keep = latched ? sh > 0 && (this.heldX - f.x) * fx + (this.heldZ - f.z) * fz > atImp : sh >= C.above;
      // (a nearer stretch that shows now is a fresh plan's: a dive or a climb draws the reach in, and the farther one held put 30 and 60 fps a stretch apart)
      if (keep && !latched) for (let j = k; j < this.heldK; j++) if (this.showsAlong(f, fx, fz, (j + 0.5) * Ls - this.odo) >= C.above) keep = false;
    }
    if (!keep) {
      // (the one held, while it's on the screen over the bus and ahead of it at the impact: where nothing nearer the reach shows, it stays, where the
      // classic shot under the bus for a frame was a flicker at Turbo 3)
      const hx = this.heldX, hy = this.heldY, hz = this.heldZ, ht = this.heldT, hk = this.heldK;
      const had = this.heldOk && this.showsAt(hx, hy, hz) > 0 && (hx - f.x) * fx + (hz - f.z) * fz > atImp;
      // (the nearest middle whose landing shows, never past the reach: by where it comes down, its side and what it's on, where the line's point the
      // reach was found by stood on what the far grid has there, 20 m over the water off Fort Mason. The review of step 3, 6)
      let dc = (k + 0.5) * Ls - this.odo, found = false;
      for (; dc <= C.reach; dc += Ls, k++) {
        if (this.showsAlong(f, fx, fz, dc) < C.above) continue;
        if (!this.land(f, fx, fz, dc, v, tImp)) return this.none();
        if (this.showsAt(this.heldX, this.heldY, this.heldZ) >= C.above) {
          found = true;
          break;
        }
      }
      if (found) {
        this.heldK = k;
        this.latchUntil = -1;
      } else if (had) {
        this.heldOk = true;
        this.heldX = hx;
        this.heldY = hy;
        this.heldZ = hz;
        this.heldT = ht;
        this.heldK = hk;
      } else return this.none();
    }
    let x = this.heldX, y = this.heldY, z = this.heldZ;
    let target = this.heldT;
    // the arc from the mouth, its top in frame: a building standing into it takes it on its face, one too near the bus at the impact is lobbed over; the
    // ground standing into it is lobbed over, and where the top arc doesn't clear it either, it lands on the hillside
    const x0 = f.x + fx * launch, z0 = f.z + fz * launch, y0 = f.y + f.vy * S.inhale;
    const L = Math.hypot(x - x0, z - z0), chord = Math.hypot(L, y - y0);
    const sMin = this.flown(v, tImp + C.wallAhead) - launch;
    let kArc = this.arcTop(f, fx, fz, v, x0, y0, z0, x, y, z, chord);
    let wall: BuildingRef | null = null, hill = false, ws = 0;
    for (let tries = 0; tries < 3 && L > 16; tries++) {
      let need = kArc;
      const last = tries === 2 || kArc >= C.arcMax;
      for (let s = 8; s < L - S.wallSkip; s += 8) {
        const u = s / L, bump = chord * 4 * u * (1 - u);
        const cy = y0 + (y - y0) * u, ay = cy + kArc * bump;
        const px = x0 + (x - x0) * u, pz = z0 + (z - z0) * u;
        const gy = city.groundAt(px, pz);
        if (ay < gy + S.wallClear) {
          if (!last) {
            need = Math.max(need, (gy + S.wallClear + 2 - cy) / Math.max(1, bump));
            continue;
          }
          hill = true;
          ws = s;
          break;
        }
        const ref = city.buildingAbove(px, pz, ay + S.wallClear, ay);
        if (!ref || ref === target || ref.roofY - ref.baseY < S.minTargetHeight) continue;
        if (s < sMin && !last) {
          need = Math.max(need, (ref.roofY + S.wallClear + 2 - cy) / Math.max(1, bump));
          continue;
        }
        wall = ref;
        ws = s;
        break;
      }
      if (wall || hill || need <= kArc + 1e-4) break;
      kArc = Math.min(C.arcMax, need);
    }
    if (wall || hill) {
      // on its face (the wall's, the hillside's), just outside it, where the arc meets it
      const ux = (x - x0) / L, uz = (z - z0) / L;
      let lo = ws - 8, hi = ws;
      for (let i = 0; i < 5; i++) {
        const m = (lo + hi) * 0.5, mx = x0 + ux * m, mz = z0 + uz * m, u = m / L;
        const into = wall ? city.contains(wall, mx, mz) : y0 + (y - y0) * u + kArc * chord * 4 * u * (1 - u) < city.groundAt(mx, mz) + S.wallClear;
        if (into) hi = m;
        else lo = m;
      }
      const w = Math.max(4, lo - 0.6), u = w / L;
      x = x0 + ux * w;
      z = z0 + uz * w;
      y = wall ? y0 + (y - y0) * u + kArc * chord * 4 * u * (1 - u) : city.groundAt(x, z);
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
    out.arc = kArc * chord;
    out.travel = C.flight;
    out.drop = Math.max(0, f.y - y);
    out.reach = Math.hypot(x - f.x, z - f.z);
    out.ahead = along - atImp;
    out.pass = this.timeTo(v, along) - tImp;
    out.speed = v;
    out.loaded = city.terrainAt(x, z) !== null;
    out.above = this.showsAt(x, y, z);
    return out;
  }

  /**
   * The landing for the stretch whose middle is dc m along the way, held: config.comet.side m off the line on this Comet's side, on a building near there
   * (or the other side's, or the line's); the ground hiding it from the lens takes it on the ridge. False: Recess's clamp says no.
   */
  private land(f: Flight, fx: number, fz: number, dc: number, v: number, tImp: number): boolean {
    const C = config.comet, city = this.city;
    let lx = f.x + fx * dc, lz = f.z + fz * dc;
    if (this.clamp) {
      this.pt.x = lx;
      this.pt.z = lz;
      if (!this.clamp(this.pt, 'comet')) return false;
      lx = this.pt.x;
      lz = this.pt.z;
    }
    // (this side's, the other's, the line's own: a building within config.comet.sidePick whose landing, as Splatter.barf lands on it (a house's middle),
    // is inside the drops' reach of the line; with none, the ground on this side, which glints nothing, as a tap into a park)
    const sx = -fz * C.side * this.side, sz = fx * C.side * this.side;
    let target: BuildingRef | null = null, x = lx + sx, z = lz + sz, y = 0;
    for (let i = 0; i < 3 && !target; i++) {
      const s = i === 0 ? 1 : i === 1 ? -1 : 0, ax = lx + sx * s, az = lz + sz * s;
      const r = this.splatter.pick(ax, az, C.sidePick, f.y);
      if (!r) continue;
      y = this.on(r, ax, az, f.y);
      if (Math.abs((this.landPt.x - f.x) * fz - (this.landPt.z - f.z) * fx) > C.lensReach - 4) continue;
      target = r;
      x = this.landPt.x;
      z = this.landPt.z;
    }
    if (!target) y = this.city.groundAt(x, z);
    // (the ground standing over the lens's line to it by more than config.comet.hide m, a ridge between: it lands on a building on the ridge, where it's
    // seen, when that's still config.comet.wallAhead of the bus's travel ahead of it at the impact; nearer, or on the ridge's open ground, which paints
    // nothing, it stays, and its pillar stands over the ridge)
    if (this.lens) {
      // (marched back from the landing in 10 m steps, so the ridge it finds is where it is on the map, whatever frame planned it)
      const m = this.lens.matrixWorld.elements;
      const cx = m[12] + this.ox, cy = m[13] + this.oy, cz = m[14] + this.oz;
      const L = Math.hypot(x - cx, z - cz), ux = (x - cx) / Math.max(1, L), uz = (z - cz) / Math.max(1, L);
      let worst = C.hide, ws = -1;
      for (let s = 10; s < L - 10; s += 10) {
        const over = city.groundAt(x - ux * s, z - uz * s) - (y + (cy - y) * (s / L));
        if (over > worst) {
          worst = over;
          ws = s;
        }
      }
      if (ws > 0) {
        const hx = x - ux * ws, hz = z - uz * ws;
        const r = (hx - f.x) * fx + (hz - f.z) * fz >= this.flown(v, tImp + C.wallAhead) ? this.splatter.pick(hx, hz, C.sidePick, f.y) : null;
        if (r) {
          target = r;
          y = this.on(r, hx, hz, f.y);
          x = this.landPt.x;
          z = this.landPt.z;
        }
      }
    }
    this.heldOk = true;
    this.heldX = x;
    this.heldY = y;
    this.heldZ = z;
    this.heldT = target;
    return true;
  }

  /** Where a landing aimed at (x, z) comes down on its building (into landPt; its roof's height), or the ground there with none. */
  private on(target: BuildingRef | null, x: number, z: number, fromY: number): number {
    if (!target) return this.city.groundAt(x, z);
    const l = this.city.landingOn(target, x, z, config.splat.landInset, this.landPt, config.splat.smallRad);
    return this.city.roofAtPart(target, l.x, l.z, fromY) + 0.5;
  }

  /** Its arc's top over its chord: config.comet.arc, less where the top would leave the frame by the lens moved on to its flight's middle, to config.comet.arcMin. */
  private arcTop(f: Flight, fx: number, fz: number, v: number, x0: number, y0: number, z0: number, x: number, y: number, z: number, chord: number): number {
    const C = config.comet, S = config.splat;
    if (!this.lens) return C.arc;
    const tm = S.inhale + C.flight * 0.5, at = this.flown(v, tm);
    const mx = (x0 + x) * 0.5 - fx * at, mz = (z0 + z) * 0.5 - fz * at, my = (y0 + y) * 0.5 - Math.max(0, f.vy) * tm;
    let k = C.arc;
    while (k > C.arcMin && this.ndcY(mx, my + k * chord, mz) > C.apexTop) k = Math.max(C.arcMin, k - 0.02);
    return k;
  }

  /** The shot a plan fires (Aimer.fire): the next Comet lands on the other side. */
  shotOf(p: CometPlan): Shot {
    this.wasSide = this.side;
    this.wasHeld = this.heldOk;
    this.wasLatch = this.latchUntil;
    this.side = -this.side;
    this.heldOk = false;
    this.latchUntil = -1;
    return { target: p.target, x: p.x, z: p.z, y: p.wall || !p.target ? p.y : undefined, exact: p.wall, drop: p.drop, travel: p.travel, comet: { ...p } };
  }

  /** The shot the last shotOf gave didn't leave (the belly said no, a Bomb fizzled): its side and its held landing as they were (the review of fd6d413, n82). */
  unshot(): void {
    this.side = this.wasSide;
    this.heldOk = this.wasHeld;
    this.latchUntil = this.wasLatch;
  }
}
