// Shared geometry of OpenStreetMap's mapped roofs ('SBB3' roofShape / roofH / roofDir, RoofShape in tiles.ts).
// BuildingMesher builds the roof meshes from it and City answers gameplay's roof heights with it (where a shot
// lands, the line of fire, rooftop gardens), so what is drawn and what is hit are one surface.
//
// A part's roof is one of three builds (roofBuild): FLAT (no shape, a rise under 0.3 m, a tapering part, or a
// footprint the shape can't cover: drawn flat at roofY with its parapet), PLANAR (gabled, hipped, skillion,
// gambrel, mansard, half-hipped, saltbox, round, a pyramid on a near-rectangular footprint: the lowest of a few
// planes in the roof frame) or REVOLVE (dome, onion, cone, a pyramid on an odd footprint: the ring scaled toward
// its area centroid, band by band). With a built shape roofY is the eave (eaveY: the mesher's minimum wall
// height applies) and the roof rises roofH above it. Rings come as a flat [x, z, ...] array and a vertex range
// [s, e) (a tile's xz and vertStart), in either orientation.

import { RoofShape } from './tiles';

/** How a part's mapped roof is built. */
export const RoofBuild = { FLAT: 0, PLANAR: 1, REVOLVE: 2 } as const;

/** Footprints under this many meters across or along the ridge get a flat roof (the bake flattens under 1.1). */
export const ROOF_MIN_SIDE = 1;
/** Planar roofs only over footprints at least this much of their rectangle in the roof frame (bake: 0.57). */
export const ROOF_MIN_RECT = 0.55;
/** Revolved roofs only over rings at least this much of their convex hull (bake: 0.85): a dome, not a tent over a notch. */
export const ROOF_MIN_HULL = 0.8;
/** A pyramid on a footprint less rectangular than this is revolved about its centroid (bake: the same). */
export const PYRAMID_REVOLVE_RECT = 0.8;

/** Profiles of the roofs of revolution: [scale of the ring toward its area centroid, fraction of the rise]. */
export const DOME: ReadonlyArray<readonly [number, number]> = [[1, 0], [0.924, 0.383], [0.707, 0.707], [0.383, 0.924], [0, 1]];
export const ONION: ReadonlyArray<readonly [number, number]> = [[1, 0], [1.14, 0.16], [1.12, 0.33], [0.86, 0.52], [0.48, 0.7], [0.18, 0.86], [0, 1]];
export const CONE: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1]];

export function profileOf(shape: number): ReadonlyArray<readonly [number, number]> {
  return shape === RoofShape.DOME ? DOME : shape === RoofShape.ONION ? ONION : CONE;
}

/** The eave the mesher builds on: the part's roofY, its walls at least 2.5 m (an upper tier 1 m). */
export function eaveY(baseY: number, roofY: number, tier: number): number {
  return Math.max(roofY, baseY + (tier > 0 ? 1.0 : 2.5));
}

/**
 * The roof frame of a ring: centered on its vertex mean, D = the way the main face looks (downhill, from the
 * direction byte), S = along the ridge (D turned a quarter); [s0, s1] x [t0, t1] its extents along S and D;
 * area its area (m^2).
 */
export interface RoofFrame {
  cx: number;
  cz: number;
  Sx: number;
  Sz: number;
  Dx: number;
  Dz: number;
  s0: number;
  s1: number;
  t0: number;
  t1: number;
  area: number;
}

export function newRoofFrame(): RoofFrame {
  return { cx: 0, cz: 0, Sx: 0, Sz: 1, Dx: 1, Dz: 0, s0: 0, s1: 0, t0: 0, t1: 0, area: 0 };
}

/** Fills f with the roof frame of ring [s, e) of xz (no allocation). */
export function roofFrame(xz: ArrayLike<number>, s: number, e: number, dirByte: number, f: RoofFrame): RoofFrame {
  const n = e - s;
  const th = (dirByte / 256) * Math.PI * 2;
  const Dx = Math.cos(th), Dz = Math.sin(th);
  const Sx = -Dz, Sz = Dx;
  let cx = 0, cz = 0;
  for (let k = s; k < e; k++) {
    cx += xz[k * 2];
    cz += xz[k * 2 + 1];
  }
  cx /= Math.max(1, n);
  cz /= Math.max(1, n);
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity, a2 = 0;
  for (let k = s; k < e; k++) {
    const k2 = k + 1 < e ? k + 1 : s;
    const x = xz[k * 2] - cx, z = xz[k * 2 + 1] - cz;
    a2 += x * (xz[k2 * 2 + 1] - cz) - (xz[k2 * 2] - cx) * z;
    const ss = x * Sx + z * Sz, tt = x * Dx + z * Dz;
    if (ss < s0) s0 = ss;
    if (ss > s1) s1 = ss;
    if (tt < t0) t0 = tt;
    if (tt > t1) t1 = tt;
  }
  f.cx = cx; f.cz = cz; f.Sx = Sx; f.Sz = Sz; f.Dx = Dx; f.Dz = Dz;
  f.s0 = s0; f.s1 = s1; f.t0 = t0; f.t1 = t1;
  f.area = Math.abs(a2) / 2;
  return f;
}

/** Area of the convex hull of ring [s, e) (gift wrapping: no allocation). */
export function hullArea(xz: ArrayLike<number>, s: number, e: number): number {
  const n = e - s;
  if (n < 3) return 0;
  let l = s;
  for (let k = s + 1; k < e; k++) {
    const x = xz[k * 2], z = xz[k * 2 + 1];
    if (x < xz[l * 2] || (x === xz[l * 2] && z < xz[l * 2 + 1])) l = k;
  }
  const ox = xz[l * 2], oz = xz[l * 2 + 1]; // (relative coordinates: precision)
  let p = l, a2 = 0;
  for (let guard = 0; guard <= n; guard++) {
    const px = xz[p * 2], pz = xz[p * 2 + 1];
    // the next hull point: no point lies to the right of p -> q (collinear: the farthest)
    let q = -1;
    for (let r = s; r < e; r++) {
      const rx = xz[r * 2] - px, rz = xz[r * 2 + 1] - pz;
      if (rx * rx + rz * rz < 1e-12) continue;
      if (q < 0) {
        q = r;
        continue;
      }
      const qx = xz[q * 2] - px, qz = xz[q * 2 + 1] - pz;
      const cr = qx * rz - qz * rx;
      if (cr < 0 || (cr === 0 && rx * rx + rz * rz > qx * qx + qz * qz)) q = r;
    }
    if (q < 0) return 0;
    a2 += (px - ox) * (xz[q * 2 + 1] - oz) - (xz[q * 2] - ox) * (pz - oz);
    p = q;
    if (xz[p * 2] === ox && xz[p * 2 + 1] === oz) return Math.abs(a2) / 2;
  }
  // (didn't close: numerically degenerate ring) its bounds
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = s; k < e; k++) {
    x0 = Math.min(x0, xz[k * 2]); x1 = Math.max(x1, xz[k * 2]);
    z0 = Math.min(z0, xz[k * 2 + 1]); z1 = Math.max(z1, xz[k * 2 + 1]);
  }
  return (x1 - x0) * (z1 - z0);
}

/** True if the shape is built by revolving its ring (rect: footprint area / its rectangle in the roof frame). */
export function revolves(shape: number, rect: number): boolean {
  return shape === RoofShape.DOME || shape === RoofShape.ONION || shape === RoofShape.CONE || (shape === RoofShape.PYRAMIDAL && rect < PYRAMID_REVOLVE_RECT);
}

const _bf = newRoofFrame();
const _bp = new Float64Array(8 * 3);
const _bc = { x: 0, z: 0 };

/**
 * True if ring [s, e) is star-shaped about its area centroid: every edge turns the ring's way around it (a radial
 * edge, cross 0, is allowed), so the bands of a roof revolved about the centroid never fold over each other or
 * past the footprint. No allocation.
 */
export function starAboutCentroid(xz: ArrayLike<number>, s: number, e: number): boolean {
  const c = areaCentroid(xz, s, e, _bc);
  let a2 = 0;
  for (let k = s; k < e; k++) {
    const k2 = k + 1 < e ? k + 1 : s;
    a2 += (xz[k * 2] - c.x) * (xz[k2 * 2 + 1] - c.z) - (xz[k2 * 2] - c.x) * (xz[k * 2 + 1] - c.z);
  }
  const sg = a2 >= 0 ? 1 : -1;
  for (let k = s; k < e; k++) {
    const k2 = k + 1 < e ? k + 1 : s;
    const ax = xz[k * 2] - c.x, az = xz[k * 2 + 1] - c.z, bx = xz[k2 * 2] - c.x, bz = xz[k2 * 2 + 1] - c.z;
    if ((ax * bz - bx * az) * sg < -1e-6 * (ax * ax + az * az + bx * bx + bz * bz)) return false;
  }
  return true;
}

/**
 * How the mapped roof of a part with ring [s, e) is built (RoofBuild): FLAT when there is no shape (or a
 * rise <= 0.3 m, a tapering part), when the footprint is under ROOF_MIN_SIDE across or along the ridge, when a
 * planar roof's footprint is under ROOF_MIN_RECT of its rectangle (it would cross courtyards) or a revolved one's
 * ring is under ROOF_MIN_HULL of its hull or not star-shaped about its centroid (its bands would fold and reach
 * past a notch). BuildingMesher draws exactly this; City's heights follow it.
 */
export function roofBuild(xz: ArrayLike<number>, s: number, e: number, shape: number, R: number, dirByte: number, taper: number): number {
  if (e - s < 3 || shape < RoofShape.GABLED || !(R > 0.3) || taper !== 0) return RoofBuild.FLAT;
  const f = roofFrame(xz, s, e, dirByte, _bf);
  const W = f.t1 - f.t0, L = f.s1 - f.s0;
  if (W < ROOF_MIN_SIDE || L < ROOF_MIN_SIDE) return RoofBuild.FLAT;
  const rect = f.area / (W * L);
  if (revolves(shape, rect)) return f.area >= ROOF_MIN_HULL * hullArea(xz, s, e) && starAboutCentroid(xz, s, e) ? RoofBuild.REVOLVE : RoofBuild.FLAT;
  if (rect < ROOF_MIN_RECT) return RoofBuild.FLAT;
  return roofPlanes(shape, f.s0, f.s1, f.t0, f.t1, R, _bp) > 0 ? RoofBuild.PLANAR : RoofBuild.FLAT;
}

function put(P: { [i: number]: number }, n: number, a: number, b: number, c: number): number {
  P[n * 3] = a;
  P[n * 3 + 1] = b;
  P[n * 3 + 2] = c;
  return n + 1;
}

/**
 * The planes h = a * s + b * t + c (m above the eave) of a planar roof shape over the frame extents
 * [s0, s1] x [t0, t1], rising R: written into P as (a, b, c) triples (room for 8). Returns how many (0: not a
 * planar shape). The roof is the lowest of them (never below the eave: every plane is >= 0 over the extents),
 * and its top is R above the eave for every shape (City's ridge / apex heights rely on it).
 */
export function roofPlanes(shape: number, s0: number, s1: number, t0: number, t1: number, R: number, P: { [i: number]: number }): number {
  const W = t1 - t0, L = s1 - s0;
  const kt = (2 * R) / W; // pitch of a face rising from the long side to the ridge
  let n = 0;
  // front(k, off): rises from t0, back: from t1, left: from s0, right: from s1
  switch (shape) {
    case RoofShape.GABLED:
      n = put(P, n, 0, kt, -kt * t0);
      n = put(P, n, 0, -kt, kt * t1);
      break;
    case RoofShape.HIPPED: {
      // one pitch on all four faces, steep enough that the faces of the narrower way meet at R (a footprint
      // shorter along the ridge than across it has its ridge across)
      const k = (2 * R) / Math.min(W, L);
      n = put(P, n, 0, k, -k * t0);
      n = put(P, n, 0, -k, k * t1);
      n = put(P, n, k, 0, -k * s0);
      n = put(P, n, -k, 0, k * s1);
      break;
    }
    case RoofShape.PYRAMIDAL: {
      const kl = (2 * R) / L;
      n = put(P, n, 0, kt, -kt * t0);
      n = put(P, n, 0, -kt, kt * t1);
      n = put(P, n, kl, 0, -kl * s0);
      n = put(P, n, -kl, 0, kl * s1);
      break;
    }
    case RoofShape.SKILLION: {
      const k = R / W;
      n = put(P, n, 0, -k, k * t1);
      break;
    }
    case RoofShape.HALF_HIPPED: {
      // the hips clip the top 40 % of the gables (steeper on a footprint short along the ridge, so the ridge stays at R)
      const kh = Math.max(kt, (0.8 * R) / L);
      n = put(P, n, 0, kt, -kt * t0);
      n = put(P, n, 0, -kt, kt * t1);
      n = put(P, n, kh, 0, 0.6 * R - kh * s0);
      n = put(P, n, -kh, 0, 0.6 * R + kh * s1);
      break;
    }
    case RoofShape.SALTBOX: {
      const kf = R / (0.62 * W), kb = R / (0.38 * W);
      n = put(P, n, 0, kf, -kf * t0);
      n = put(P, n, 0, -kb, kb * t1);
      break;
    }
    case RoofShape.GAMBREL: {
      // a steep lower slope to 3/4 of the rise over the outer 18 % of the width, a gentle one above
      const ks = (0.75 * R) / (0.18 * W), kg = (0.25 * R) / (0.32 * W);
      const og = 0.75 * R - kg * 0.18 * W;
      n = put(P, n, 0, ks, -ks * t0);
      n = put(P, n, 0, -ks, ks * t1);
      n = put(P, n, 0, kg, og - kg * t0);
      n = put(P, n, 0, -kg, og + kg * t1);
      break;
    }
    case RoofShape.MANSARD: {
      const k = R / (0.18 * Math.min(W, L));
      n = put(P, n, 0, k, -k * t0);
      n = put(P, n, 0, -k, k * t1);
      n = put(P, n, k, 0, -k * s0);
      n = put(P, n, -k, 0, k * s1);
      n = put(P, n, 0, 0, R);
      break;
    }
    case RoofShape.ROUND: {
      // a barrel vault: tangents of a half-ellipse across the width, scaled so the crown is at R exactly
      const tm = (t0 + t1) / 2, hw = W / 2;
      const Rr = R * Math.sin((2.5 / 6) * Math.PI);
      for (let j = 0; j < 6; j++) {
        const ph = ((j + 0.5) / 6) * Math.PI;
        const sn = Math.sin(ph), cs = Math.cos(ph);
        // y = (Rr / sin) (1 - (t - tm) cos / hw)
        n = put(P, n, 0, (-Rr * cs) / (sn * hw), (Rr / sn) * (1 + (tm * cs) / hw));
      }
      break;
    }
    default:
      return 0;
  }
  return n;
}

/** Area centroid of ring [s, e) into out (the vertex mean for a degenerate ring). No allocation. */
export function areaCentroid(xz: ArrayLike<number>, s: number, e: number, out: { x: number; z: number }): { x: number; z: number } {
  const n = e - s;
  let mx = 0, mz = 0;
  for (let k = s; k < e; k++) {
    mx += xz[k * 2];
    mz += xz[k * 2 + 1];
  }
  mx /= Math.max(1, n);
  mz /= Math.max(1, n);
  let ac = 0, acx = 0, acz = 0;
  for (let k = s; k < e; k++) {
    const k2 = k + 1 < e ? k + 1 : s;
    const ax = xz[k * 2] - mx, az = xz[k * 2 + 1] - mz, bx = xz[k2 * 2] - mx, bz = xz[k2 * 2 + 1] - mz;
    const cr = ax * bz - bx * az;
    ac += cr;
    acx += (ax + bx) * cr;
    acz += (az + bz) * cr;
  }
  if (Math.abs(ac) > 1e-6) {
    out.x = mx + acx / (3 * ac);
    out.z = mz + acz / (3 * ac);
  } else {
    out.x = mx;
    out.z = mz;
  }
  return out;
}

/** Rise fraction of a profile at ring scale sg: the highest band through it (an onion's upper side), or -1. */
function profileRise(prof: ReadonlyArray<readonly [number, number]>, sg: number): number {
  let best = -1;
  for (let j = 0; j + 1 < prof.length; j++) {
    const a = prof[j][0], b = prof[j + 1][0];
    if (sg < Math.min(a, b) - 1e-9 || sg > Math.max(a, b) + 1e-9 || a === b) continue;
    const u = Math.min(1, Math.max(0, (sg - a) / (b - a)));
    const h = prof[j][1] + (prof[j + 1][1] - prof[j][1]) * u;
    if (h > best) best = h;
  }
  return best;
}

const _rc = { x: 0, z: 0 };

/**
 * Rise fraction (0..1) of a revolved roof over ring [s, e) at (x, z): the point's scale toward the area
 * centroid along the ray through it (against the ring edge in its wedge), on the profile. Each band of the
 * mesh is planar per edge, so this is the drawn surface exactly; where wedges overlap (a ring not star-shaped
 * about its centroid) the highest. 0 outside the roof.
 */
export function revolvedRise(xz: ArrayLike<number>, s: number, e: number, shape: number, x: number, z: number): number {
  const c = areaCentroid(xz, s, e, _rc);
  const prof = profileOf(shape);
  const dx = x - c.x, dz = z - c.z;
  let best = -1;
  for (let k = s; k < e; k++) {
    const k2 = k + 1 < e ? k + 1 : s;
    const ax = xz[k * 2] - c.x, az = xz[k * 2 + 1] - c.z, bx = xz[k2 * 2] - c.x, bz = xz[k2 * 2 + 1] - c.z;
    const den = ax * bz - az * bx;
    if (Math.abs(den) < 1e-9) continue;
    // p = sg * a + v * (b - a): sg = cross(p, b - a) / den, v = cross(a, p) / den, inside the wedge for 0 <= v <= sg
    const ex = bx - ax, ez = bz - az;
    const sg = (dx * ez - dz * ex) / den;
    const v = (ax * dz - az * dx) / den;
    if (sg < -1e-9 || v < -1e-7 || v > sg + 1e-7) continue;
    const h = profileRise(prof, Math.max(0, sg));
    if (h > best) best = h;
  }
  return best < 0 ? 0 : best;
}

const _sf = newRoofFrame();
const _sp = new Float64Array(8 * 3);

/**
 * Height (m) of the mapped roof of a part with ring [s, e) at (x, z) inside it, as BuildingMesher draws it:
 * eave + the lowest plane at the point's (s, t) in the roof frame (never below the eave) for a planar roof,
 * eave + the profile at its scale toward the area centroid for a revolved one. Only for parts whose
 * roofBuild is not FLAT (those are flat at roofY). No allocation: the aim calls it every frame.
 */
export function roofSurfaceY(xz: ArrayLike<number>, s: number, e: number, eave: number, R: number, shape: number, dirByte: number, x: number, z: number): number {
  const f = roofFrame(xz, s, e, dirByte, _sf);
  const W = f.t1 - f.t0, L = f.s1 - f.s0;
  if (revolves(shape, W > 0 && L > 0 ? f.area / (W * L) : 0)) return eave + R * revolvedRise(xz, s, e, shape, x, z);
  const n = roofPlanes(shape, f.s0, f.s1, f.t0, f.t1, R, _sp);
  if (n === 0) return eave;
  const px = x - f.cx, pz = z - f.cz;
  const ss = px * f.Sx + pz * f.Sz, tt = px * f.Dx + pz * f.Dz;
  let h = Infinity;
  for (let k = 0; k < n; k++) h = Math.min(h, _sp[k * 3] * ss + _sp[k * 3 + 1] * tt + _sp[k * 3 + 2]);
  return eave + Math.max(0, h);
}

/** Sutherland-Hodgman: the part of polygon (flat s, t pairs) where a * s + b * t + c <= 0 (exact for convex input). */
export function clipHalf(poly: number[], a: number, b: number, c: number): number[] {
  const out: number[] = [];
  const m = poly.length / 2;
  for (let k = 0; k < m; k++) {
    const s1 = poly[k * 2], t1 = poly[k * 2 + 1];
    const k2 = (k + 1) % m;
    const s2 = poly[k2 * 2], t2 = poly[k2 * 2 + 1];
    const f1 = a * s1 + b * t1 + c, f2 = a * s2 + b * t2 + c;
    if (f1 <= 1e-9) out.push(s1, t1);
    if ((f1 < -1e-9 && f2 > 1e-9) || (f1 > 1e-9 && f2 < -1e-9)) {
      const u = f1 / (f1 - f2);
      out.push(s1 + (s2 - s1) * u, t1 + (t2 - t1) * u);
    }
  }
  return out;
}

/** True if the ring (flat x, z pairs, positive shoelace) is convex and winds once (duplicate / collinear points allowed). */
export function ringConvex(xz: number[]): boolean {
  const n = xz.length / 2;
  // the edges that have a length, in order; every turn between them left (or straight), one full turn in all
  const E: number[] = [];
  for (let a = 0; a < n; a++) {
    const b = (a + 1) % n;
    const ex = xz[b * 2] - xz[a * 2], ez = xz[b * 2 + 1] - xz[a * 2 + 1];
    if (Math.hypot(ex, ez) >= 1e-6) E.push(ex, ez);
  }
  const m = E.length / 2;
  if (m < 3) return false;
  let turn = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const px = E[i * 2], pz = E[i * 2 + 1], ex = E[j * 2], ez = E[j * 2 + 1];
    const cr = px * ez - pz * ex, dt = px * ex + pz * ez;
    if (cr < -1e-3 * Math.hypot(px, pz) * Math.hypot(ex, ez)) return false;
    turn += Math.atan2(cr, dt);
  }
  return Math.abs(turn - Math.PI * 2) < 0.05;
}

/**
 * Triangles (index triples into the ring's vertices) covering a ring exactly, for concave footprints: the ring
 * is cut at pinch points (a vertex it passes twice) into simple loops, each ear-clipped in its own orientation
 * (an ear may not hold another vertex, on its edges included, unless it coincides with one of its corners).
 * xz: flat x, z pairs. Unlike the mesher's flat-roof triangulate, duplicates and pinches don't stop it.
 */
export function triangulateRing(xz: number[], out: number[] = []): number[] {
  const n = xz.length / 2;
  const same = (i: number, j: number) => Math.abs(xz[i * 2] - xz[j * 2]) < 1e-4 && Math.abs(xz[i * 2 + 1] - xz[j * 2 + 1]) < 1e-4;
  // drop consecutive duplicates (and the closing one)
  const V: number[] = [];
  for (let i = 0; i < n; i++) if (!V.length || !same(V[V.length - 1], i)) V.push(i);
  while (V.length > 1 && same(V[0], V[V.length - 1])) V.pop();
  const loops: number[][] = [];
  const split = (L: number[]) => {
    for (let a = 0; a < L.length; a++)
      for (let b = a + 2; b < L.length; b++) {
        if (a === 0 && b === L.length - 1) continue;
        if (!same(L[a], L[b])) continue;
        split(L.slice(a, b));
        split(L.slice(b).concat(L.slice(0, a)));
        return;
      }
    if (L.length >= 3) loops.push(L);
  };
  split(V);
  for (const L of loops) earClip(xz, L, out);
  return out;
}

/**
 * Convex pieces covering a ring exactly (index loops into its vertices, each in its triangles' orientation):
 * triangulateRing's triangles, merged across their shared edges while the union stays convex (Hertel-Mehlhorn),
 * so an L-shaped house is two pieces, not four triangles. Each diagonal is looked at once (a piece's angles only
 * grow as it merges, so a diagonal that must stay never stops having to): about linear in the ring's size.
 */
export function convexPieces(xz: number[]): number[][] {
  const tri = triangulateRing(xz);
  const nv = xz.length / 2;
  const polys: Array<number[] | null> = [];
  const sign: number[] = [];
  /** directed edge u -> v (key u * nv + v): the piece that holds it */
  const owner = new Map<number, number>();
  for (let q = 0; q < tri.length; q += 3) {
    const a = tri[q], b = tri[q + 1], c = tri[q + 2];
    const id = polys.length;
    polys.push([a, b, c]);
    const cr = (xz[b * 2] - xz[a * 2]) * (xz[c * 2 + 1] - xz[a * 2 + 1]) - (xz[b * 2 + 1] - xz[a * 2 + 1]) * (xz[c * 2] - xz[a * 2]);
    sign.push(cr >= 0 ? 1 : -1);
    owner.set(a * nv + b, id);
    owner.set(b * nv + c, id);
    owner.set(c * nv + a, id);
  }
  // the turn at b (a -> b -> c) in a piece of orientation sg is not reflex
  const turnOk = (a: number, b: number, c: number, sg: number) =>
    ((xz[b * 2] - xz[a * 2]) * (xz[c * 2 + 1] - xz[a * 2 + 1]) - (xz[b * 2 + 1] - xz[a * 2 + 1]) * (xz[c * 2] - xz[a * 2])) * sg >= -1e-9;
  for (let q = 0; q < tri.length; q++) {
    // every edge u -> v of the triangulation whose reverse is in another piece: a diagonal
    const u = tri[q], v = tri[q % 3 === 2 ? q - 2 : q + 1];
    const i = owner.get(u * nv + v), j = owner.get(v * nv + u);
    if (i === undefined || j === undefined || i === j) continue;
    const A = polys[i]!, B = polys[j]!;
    if (sign[i] !== sign[j]) continue;
    const sg = sign[i];
    const ia = A.indexOf(u), jb = B.indexOf(v);
    if (A[(ia + 1) % A.length] !== v || B[(jb + 1) % B.length] !== u) continue;
    // without u -> v the corners at u and v join A's and B's sides: both must stay convex, and not fold back
    // (two convex pieces sharing a second, collinear edge through u or v: the loop would pass a vertex twice)
    const aPrevU = A[(ia + A.length - 1) % A.length], aNextV = A[(ia + 2) % A.length];
    const bPrevV = B[(jb + B.length - 1) % B.length], bNextU = B[(jb + 2) % B.length];
    if (aPrevU === bNextU || bPrevV === aNextV || !turnOk(aPrevU, u, bNextU, sg) || !turnOk(bPrevV, v, aNextV, sg)) continue;
    // A from v around to u, then B from u around to v (each shared end once)
    const M: number[] = [];
    for (let k = 0; k < A.length; k++) M.push(A[(ia + 1 + k) % A.length]);
    for (let k = 2; k < B.length; k++) M.push(B[(jb + k) % B.length]);
    // M keeps the larger piece's id: only the smaller one's edges change hands
    const keep = A.length >= B.length ? i : j, gone = keep === i ? B : A;
    polys[keep] = M;
    polys[keep === i ? j : i] = null;
    owner.delete(u * nv + v);
    owner.delete(v * nv + u);
    for (let k = 0; k < gone.length; k++) {
      const key = gone[k] * nv + gone[(k + 1) % gone.length];
      if (owner.has(key)) owner.set(key, keep);
    }
  }
  const out: number[][] = [];
  for (const p of polys) if (p) out.push(p);
  return out;
}

function earClip(xz: number[], L: number[], out: number[]) {
  let area = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length];
    area += xz[a * 2] * xz[b * 2 + 1] - xz[b * 2] * xz[a * 2 + 1];
  }
  const sign = area >= 0 ? 1 : -1;
  const V = L.slice();
  const near = (i: number, j: number) => Math.abs(xz[i * 2] - xz[j * 2]) < 1e-4 && Math.abs(xz[i * 2 + 1] - xz[j * 2 + 1]) < 1e-4;
  for (let guard = 0; V.length > 3 && guard < 10000; guard++) {
    let done = false;
    for (let pass = 0; pass < 2 && !done; pass++) {
      for (let k = 0; k < V.length; k++) {
        const i0 = V[(k + V.length - 1) % V.length], i1 = V[k], i2 = V[(k + 1) % V.length];
        const ax = xz[i0 * 2], az = xz[i0 * 2 + 1], bx = xz[i1 * 2], bz = xz[i1 * 2 + 1], cx = xz[i2 * 2], cz = xz[i2 * 2 + 1];
        const cross = ((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) * sign;
        if (cross <= 1e-9) continue;
        let blocked = false;
        for (const j of V) {
          if (j === i0 || j === i1 || j === i2 || near(j, i0) || near(j, i1) || near(j, i2)) continue;
          const px = xz[j * 2], pz = xz[j * 2 + 1];
          const d1 = ((bx - ax) * (pz - az) - (bz - az) * (px - ax)) * sign;
          const d2 = ((cx - bx) * (pz - bz) - (cz - bz) * (px - bx)) * sign;
          const d3 = ((ax - cx) * (pz - cz) - (az - cz) * (px - cx)) * sign;
          // pass 0: nothing inside or on the ear's edges; pass 1: nothing strictly inside
          if (pass === 0 ? d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9 : d1 > 1e-9 && d2 > 1e-9 && d3 > 1e-9) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        out.push(i0, i1, i2);
        V.splice(k, 1);
        done = true;
        break;
      }
    }
    if (!done) {
      // degenerate: drop the flattest vertex (a sliver of no area) and go on
      let best = 0, bc = Infinity;
      for (let k = 0; k < V.length; k++) {
        const i0 = V[(k + V.length - 1) % V.length], i1 = V[k], i2 = V[(k + 1) % V.length];
        const c = Math.abs((xz[i1 * 2] - xz[i0 * 2]) * (xz[i2 * 2 + 1] - xz[i0 * 2 + 1]) - (xz[i1 * 2 + 1] - xz[i0 * 2 + 1]) * (xz[i2 * 2] - xz[i0 * 2]));
        if (c < bc) { bc = c; best = k; }
      }
      V.splice(best, 1);
    }
  }
  if (V.length === 3) {
    const [i0, i1, i2] = V;
    const c = ((xz[i1 * 2] - xz[i0 * 2]) * (xz[i2 * 2 + 1] - xz[i0 * 2 + 1]) - (xz[i1 * 2 + 1] - xz[i0 * 2 + 1]) * (xz[i2 * 2] - xz[i0 * 2])) * sign;
    if (c > 1e-9) out.push(i0, i1, i2);
  }
}
