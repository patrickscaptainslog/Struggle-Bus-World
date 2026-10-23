// Turns compact baked footprints into merged building meshes (runs in a worker).
// Detail by type: Victorians get bay windows, cornices, false fronts or
// front-facing gables, chimneys and stoops; flats get stacked bays; commercial
// and towers get parapets and rooftop clutter. Walls are split into a few
// segments so painted buildings can wobble.
//
// Per-vertex layout (all Float32 except where noted):
//   position  vec3   world meters
//   normal    vec3   (Int8 normalized)
//   aFacade   vec2   u = meters along the facade (front edge starts at 0), v = meters above street level
//   aMeta     vec4   (Uint8) part, arch, seed, flags (bit0 front-facing, bit1 corner)
//   aBld      vec4   building index, center x, base y, center z
//   aBld2     vec2   roof y, front width (m)

import type { BuildingTile } from './tiles';
import { Arch } from './tiles';

export const Part = {
  SIDE: 0,
  FRONT: 1,
  ROOF: 2,
  ROOF_SLOPE: 3,
  TRIM: 4,
  BAY: 5,
  GABLE: 6,
  CLUTTER: 7,
  STOOP: 8,
  GARAGE: 9,
} as const;

export interface MeshArrays {
  position: Float32Array;
  normal: Int8Array;
  facade: Float32Array;
  meta: Uint8Array;
  bld: Float32Array;
  bld2: Float32Array;
  index: Uint32Array;
  vertexCount: number;
}

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  fac: number[] = [];
  meta: number[] = [];
  bld: number[] = [];
  bld2: number[] = [];
  idx: number[] = [];
  vc = 0;
  // current building context
  cur = { index: 0, cx: 0, cz: 0, baseY: 0, roofY: 0, arch: 0, seed: 0, flags: 0, frontW: 0 };

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, part: number, flags = this.cur.flags) {
    this.pos.push(x, y, z);
    this.nrm.push(Math.round(nx * 127), Math.round(ny * 127), Math.round(nz * 127));
    this.fac.push(u, v);
    this.meta.push(part, this.cur.arch, this.cur.seed, flags);
    const c = this.cur;
    this.bld.push(c.index, c.cx, c.baseY, c.cz);
    this.bld2.push(c.roofY, c.frontW);
    return this.vc++;
  }

  /** Quad from 4 points (counter-clockwise when seen from the front), flat normal. */
  quad(
    p0: V3, p1: V3, p2: V3, p3: V3,
    uv: [number, number, number, number, number, number, number, number],
    part: number,
    flags?: number,
  ) {
    const n = faceNormal(p0, p1, p2);
    const a = this.vert(p0[0], p0[1], p0[2], n[0], n[1], n[2], uv[0], uv[1], part, flags);
    const b = this.vert(p1[0], p1[1], p1[2], n[0], n[1], n[2], uv[2], uv[3], part, flags);
    const c = this.vert(p2[0], p2[1], p2[2], n[0], n[1], n[2], uv[4], uv[5], part, flags);
    const d = this.vert(p3[0], p3[1], p3[2], n[0], n[1], n[2], uv[6], uv[7], part, flags);
    this.idx.push(a, b, c, a, c, d);
  }

  /** quad() that flips its winding if needed so the face points along `want`. */
  quadF(p0: V3, p1: V3, p2: V3, p3: V3, uv: [number, number, number, number, number, number, number, number], part: number, want: V3, flags?: number) {
    const n = faceNormal(p0, p1, p2);
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) this.quad(p3, p2, p1, p0, [uv[6], uv[7], uv[4], uv[5], uv[2], uv[3], uv[0], uv[1]], part, flags);
    else this.quad(p0, p1, p2, p3, uv, part, flags);
  }

  triF(p0: V3, p1: V3, p2: V3, uv: [number, number, number, number, number, number], part: number, want: V3, flags?: number) {
    const n = faceNormal(p0, p1, p2);
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) this.tri(p0, p2, p1, [uv[0], uv[1], uv[4], uv[5], uv[2], uv[3]], part, flags);
    else this.tri(p0, p1, p2, uv, part, flags);
  }

  tri(p0: V3, p1: V3, p2: V3, uv: [number, number, number, number, number, number], part: number, flags?: number) {
    const n = faceNormal(p0, p1, p2);
    const a = this.vert(p0[0], p0[1], p0[2], n[0], n[1], n[2], uv[0], uv[1], part, flags);
    const b = this.vert(p1[0], p1[1], p1[2], n[0], n[1], n[2], uv[2], uv[3], part, flags);
    const c = this.vert(p2[0], p2[1], p2[2], n[0], n[1], n[2], uv[4], uv[5], part, flags);
    this.idx.push(a, b, c);
  }

  /** Vertical wall from a->b (outward = right side of a->b in x,z), subdivided for wobble. */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, u0: number, vBase: number, part: number, flags?: number, segLen = 3.2) {
    const dx = bx - ax;
    const dz = bz - az;
    const L = Math.hypot(dx, dz);
    if (L < 0.05 || y1 - y0 < 0.05) return;
    const nx = dz / L;
    const nz = -dx / L;
    const cols = Math.max(1, Math.min(6, Math.round(L / segLen)));
    const h = y1 - y0;
    const rows = h > 7 && segLen < 99 ? 2 : 1;
    const base = this.vc;
    for (let r = 0; r <= rows; r++) {
      const y = y0 + (h * r) / rows;
      for (let c = 0; c <= cols; c++) {
        const t = c / cols;
        this.vert(ax + dx * t, y, az + dz * t, nx, 0, nz, u0 + L * t, y - vBase, part, flags);
      }
    }
    const w = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i0 = base + r * w + c;
        const i1 = i0 + 1;
        const i2 = i0 + w + 1;
        const i3 = i0 + w;
        // outward-facing winding (three.js front = CCW seen from outside)
        this.idx.push(i0, i2, i1, i0, i3, i2);
      }
    }
  }

  /** Axis-free box: footprint quad (CCW in x,z), y range. All 6 faces (bottom optional). */
  prism(pts: Array<[number, number]>, y0: number, y1: number, part: number, uBase = 0, vBase = 0, bottom = false, flags?: number) {
    const n = pts.length;
    let u = uBase;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.wall(a[0], a[1], b[0], b[1], y0, y1, u, vBase, part, flags, 99);
      u += L;
    }
    // top cap (fan; footprints here are convex)
    const top = this.vc;
    for (let i = 0; i < n; i++) this.vert(pts[i][0], y1, pts[i][1], 0, 1, 0, pts[i][0], pts[i][1], part, flags);
    for (let i = 1; i < n - 1; i++) this.idx.push(top, top + i + 1, top + i);
    if (bottom) {
      const bot = this.vc;
      for (let i = 0; i < n; i++) this.vert(pts[i][0], y0, pts[i][1], 0, -1, 0, pts[i][0], pts[i][1], part, flags);
      for (let i = 1; i < n - 1; i++) this.idx.push(bot, bot + i, bot + i + 1);
    }
  }

  finish(): MeshArrays {
    return {
      position: new Float32Array(this.pos),
      normal: new Int8Array(this.nrm),
      facade: new Float32Array(this.fac),
      meta: new Uint8Array(this.meta),
      bld: new Float32Array(this.bld),
      bld2: new Float32Array(this.bld2),
      index: new Uint32Array(this.idx),
      vertexCount: this.vc,
    };
  }
}

type V3 = [number, number, number];

function faceNormal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  return [nx, ny, nz];
}

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Ear-clipping triangulation of a simple polygon given as flat [x,z,...] (CCW in x,z). */
function triangulate(xz: number[]): number[] {
  const n = xz.length / 2;
  const idx: number[] = [];
  const V: number[] = [];
  for (let i = 0; i < n; i++) V.push(i);
  // ensure orientation: signed area in (x,z)
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += xz[i * 2] * xz[j * 2 + 1] - xz[j * 2] * xz[i * 2 + 1];
  }
  const sign = area > 0 ? 1 : -1;
  let guard = 0;
  while (V.length > 3 && guard++ < 5000) {
    let clipped = false;
    for (let k = 0; k < V.length; k++) {
      const i0 = V[(k + V.length - 1) % V.length];
      const i1 = V[k];
      const i2 = V[(k + 1) % V.length];
      const ax = xz[i0 * 2], az = xz[i0 * 2 + 1];
      const bx = xz[i1 * 2], bz = xz[i1 * 2 + 1];
      const cx = xz[i2 * 2], cz = xz[i2 * 2 + 1];
      const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      if (cross * sign <= 1e-9) continue;
      let inside = false;
      for (const j of V) {
        if (j === i0 || j === i1 || j === i2) continue;
        const px = xz[j * 2], pz = xz[j * 2 + 1];
        const d1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
        const d2 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx);
        const d3 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
        if (d1 * sign >= 0 && d2 * sign >= 0 && d3 * sign >= 0) { inside = true; break; }
      }
      if (inside) continue;
      idx.push(i0, i1, i2);
      V.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (V.length === 3) idx.push(V[0], V[1], V[2]);
  return idx;
}

export interface MeshOptions {
  /** 0 = full detail, 1 = simple extrusion (far tiles). */
  lod: 0 | 1;
}

export function meshBuildingTile(t: BuildingTile, opts: MeshOptions): MeshArrays {
  const B = new Builder();
  for (let i = 0; i < t.count; i++) meshBuilding(B, t, i, opts.lod);
  return B.finish();
}

function meshBuilding(B: Builder, t: BuildingTile, i: number, lod: 0 | 1) {
  const s = t.vertStart[i];
  const e = t.vertStart[i + 1];
  const n = e - s;
  if (n < 3) return;
  const pts: Array<[number, number]> = [];
  for (let k = s; k < e; k++) pts.push([t.xz[k * 2], t.xz[k * 2 + 1]]);
  // ring orientation: we need outward = right side of a->b in (x, z) i.e. CCW with positive shoelace
  let area = 0;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  let front = t.front[i];
  let front2 = t.front2[i];
  if (area < 0) {
    pts.reverse();
    if (front !== 255) front = (n - 2 - front + n) % n;
    if (front2 !== 255) front2 = (n - 2 - front2 + n) % n;
  }
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= n; cz /= n;
  const baseY = t.baseY[i];
  const roofY = Math.max(t.roofY[i], baseY + 2.5);
  const arch = t.arch[i];
  const seed = t.seed[i];
  const r = rng(t.stableId[i] ^ 0x9e3779b9);
  const streetY = baseY + 0.4; // street level reference for window rows
  let frontW = 0;
  let fa: [number, number] = pts[0], fb: [number, number] = pts[1 % n];
  if (front !== 255 && front < n) {
    fa = pts[front];
    fb = pts[(front + 1) % n];
    frontW = Math.hypot(fb[0] - fa[0], fb[1] - fa[1]);
  }
  const corner = front2 !== 255 ? 2 : 0;
  B.cur = { index: t.index[i], cx, cz, baseY, roofY, arch, seed, flags: corner, frontW };

  const isVic = arch === Arch.VICTORIAN;
  const isFlats = arch === Arch.FLATS;
  const isRes = isVic || isFlats || arch === Arch.STUCCO || arch === Arch.MARINA;
  const H = roofY - baseY;

  // ---- roof type
  // front frame: s along front edge, t inward
  const ux = frontW > 0 ? (fb[0] - fa[0]) / frontW : 1;
  const uz = frontW > 0 ? (fb[1] - fa[1]) / frontW : 0;
  // inward normal = left side of a->b for CCW ring: (-uz, ux)
  const inx = -uz, inz = ux;
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const p of pts) {
    const ds = (p[0] - fa[0]) * ux + (p[1] - fa[1]) * uz;
    const dt = (p[0] - fa[0]) * inx + (p[1] - fa[1]) * inz;
    s0 = Math.min(s0, ds); s1 = Math.max(s1, ds);
    t0 = Math.min(t0, dt); t1 = Math.max(t1, dt);
  }
  const rectArea = (s1 - s0) * (t1 - t0);
  const rectangularity = rectArea > 0 ? Math.abs(area) / 2 / rectArea : 0;
  const gable = lod === 0 && isVic && frontW > 4.5 && frontW < 11 && rectangularity > 0.82 && (seed % 100) < 38 && H < 15;
  const parapet = lod === 0 && !gable && front !== 255 ? (isVic ? 1.3 : isFlats ? 0.9 : arch === Arch.COMMERCIAL || arch === Arch.CIVIC ? 0.7 : arch === Arch.TOWER ? 1.2 : 0.5) : 0;

  // ---- walls
  // perimeter u starts at the front edge so the facade pattern lines up with it
  const startK = front !== 255 ? front : 0;
  let u = 0;
  for (let j = 0; j < n; j++) {
    const k = (startK + j) % n;
    const a = pts[k];
    const b = pts[(k + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const isFront = k === front || k === front2;
    const top = isFront ? roofY + parapet : roofY;
    B.wall(a[0], a[1], b[0], b[1], baseY, top, u, streetY, isFront ? Part.FRONT : Part.SIDE, (isFront ? 1 : 0) | corner, lod === 1 ? 999 : 3.2);
    u += L;
  }

  // ---- roof
  if (gable) {
    const over = 0.35;
    const rise = Math.min(4.5, (s1 - s0) * 0.5 * 0.78);
    const sm = (s0 + s1) / 2;
    const P = (ss: number, tt: number, y: number): V3 => [fa[0] + ux * ss + inx * tt, y, fa[1] + uz * ss + inz * tt];
    const ta = t0 - over, tb = t1 + over;
    const sa = s0 - over, sb = s1 + over;
    const ridge = roofY + rise;
    const eave = roofY - over * 0.78;
    // two slopes (left: from sa up to ridge; right: ridge down to sb)
    const L: V3 = [-ux, 1, -uz], R: V3 = [ux, 1, uz], DOWN: V3 = [0, -1, 0];
    B.quadF(P(sa, ta, eave), P(sm, ta, ridge), P(sm, tb, ridge), P(sa, tb, eave), [sa, 0, sm, rise, sm, rise, sa, 0], Part.ROOF_SLOPE, L);
    B.quadF(P(sm, ta, ridge), P(sb, ta, eave), P(sb, tb, eave), P(sm, tb, ridge), [sm, rise, sb, 0, sb, 0, sm, rise], Part.ROOF_SLOPE, R);
    // undersides of the overhang so the roof never looks paper-thin from below
    B.quadF(P(sa, ta, eave - 0.02), P(sm, ta, ridge - 0.25), P(sm, tb, ridge - 0.25), P(sa, tb, eave - 0.02), [0, 0, 0, 0, 0, 0, 0, 0], Part.TRIM, DOWN);
    B.quadF(P(sm, ta, ridge - 0.25), P(sb, ta, eave - 0.02), P(sb, tb, eave - 0.02), P(sm, tb, ridge - 0.25), [0, 0, 0, 0, 0, 0, 0, 0], Part.TRIM, DOWN);
    // gable ends (the front one is the facade's pediment)
    const g0 = t0 + 0.02, g1 = t1 - 0.02;
    B.triF(P(s0, g0, roofY), P(s1, g0, roofY), P(sm, g0, ridge - 0.1), [s0, roofY - streetY, s1, roofY - streetY, sm, ridge - streetY], Part.GABLE, [-inx, 0, -inz], 1 | corner);
    B.triF(P(s1, g1, roofY), P(s0, g1, roofY), P(sm, g1, ridge - 0.1), [0, 0, 0, 0, 0, 0], Part.SIDE, [inx, 0, inz]);
    // flat fill under the gable for any footprint area outside the rectangle edges
    const xz: number[] = [];
    for (const p of pts) xz.push(p[0], p[1]);
    const tris = triangulate(xz);
    const base = B.vc;
    for (const p of pts) B.vert(p[0], roofY - 0.05, p[1], 0, 1, 0, p[0], p[1], Part.ROOF);
    for (let k = 0; k < tris.length; k += 3) B.idx.push(base + tris[k], base + tris[k + 2], base + tris[k + 1]);
  } else {
    const xz: number[] = [];
    for (const p of pts) xz.push(p[0], p[1]);
    const tris = triangulate(xz);
    const base = B.vc;
    for (const p of pts) B.vert(p[0], roofY, p[1], 0, 1, 0, p[0], p[1], Part.ROOF);
    // CCW in (x,z) with +z south: viewed from above (+Y), need reversed winding to face up
    for (let k = 0; k < tris.length; k += 3) B.idx.push(base + tris[k], base + tris[k + 2], base + tris[k + 1]);
  }

  if (lod === 1 || front === 255) {
    if (lod === 0) clutter(B, pts, cx, cz, roofY, arch, r);
    return;
  }

  const outx = -inx, outz = -inz;
  const F = (ss: number, oo: number): [number, number] => [fa[0] + ux * ss + outx * oo, fa[1] + uz * ss + outz * oo];

  // ---- parapet thickness + cornice on the false front
  if (parapet > 0) {
    // back face of the false front (so it isn't see-through from behind) + cap
    const th = 0.32;
    const bA = F(-0.02, -th), bB = F(frontW + 0.02, -th);
    B.wall(bB[0], bB[1], bA[0], bA[1], roofY - 0.05, roofY + parapet, 0, streetY, Part.TRIM, 0, 99);
    const cap: Array<[number, number]> = [F(-0.02, 0.02), F(frontW + 0.02, 0.02), F(frontW + 0.02, -th), F(-0.02, -th)];
    B.prism(cap.slice().reverse() as Array<[number, number]>, roofY + parapet - 0.01, roofY + parapet + 0.05, Part.TRIM);
  }
  const topY = roofY + parapet;
  if (isRes || arch === Arch.COMMERCIAL || arch === Arch.CIVIC) {
    // cornice: a chunky projecting band at the top of the facade
    const cd = isVic ? 0.65 : 0.5;
    const ch = isVic ? 0.55 : 0.4;
    const ext = 0.12;
    const yc = gable ? roofY - 0.1 : topY;
    const quadC: Array<[number, number]> = [F(-ext, 0), F(frontW + ext, 0), F(frontW + ext, cd), F(-ext, cd)];
    // ring must be CCW (positive shoelace) for outward walls
    B.prism(ccw(quadC), yc - ch, yc + 0.08, Part.TRIM, 0, streetY, true);
    if (isFlats && H > 9) {
      // belt course between ground floor and upper floors
      const yb = baseY + 3.6;
      B.prism(ccw([F(-0.05, 0), F(frontW + 0.05, 0), F(frontW + 0.05, 0.3), F(-0.05, 0.3)]), yb, yb + 0.35, Part.TRIM, 0, streetY, true);
    }
  }

  // ---- bay windows
  if ((isVic || isFlats || arch === Arch.MARINA) && frontW >= 4.2) {
    const bays = isVic ? (frontW > 11 ? 2 : 1) : Math.max(1, Math.floor(frontW / 6.5));
    const bw = isVic ? 2.3 : 2.6; // front face width
    const bd = isVic ? 0.95 : 0.85; // projection
    const y0 = isVic ? baseY + Math.min(3.0, H * 0.28) : baseY + 3.7;
    const y1 = (gable ? roofY - 0.5 : topY - (isVic ? 0.75 : 0.5));
    if (y1 - y0 > 2.2) {
      for (let k = 0; k < bays; k++) {
        let sc: number;
        if (bays === 1) sc = isVic ? (seed & 1 ? frontW * 0.66 : frontW * 0.34) : frontW / 2;
        else sc = ((k + 0.5) / bays) * frontW;
        sc = Math.min(frontW - bw / 2 - bd - 0.2, Math.max(bw / 2 + bd + 0.2, sc));
        const ring: Array<[number, number]> = [
          F(sc - bw / 2 - bd * 0.8, -0.05),
          F(sc + bw / 2 + bd * 0.8, -0.05),
          F(sc + bw / 2, bd),
          F(sc - bw / 2, bd),
        ];
        B.prism(ccw(ring), y0, y1, Part.BAY, sc - bw / 2 - bd, streetY, true, 1);
        // bay cap: a little hat that overhangs
        const capR: Array<[number, number]> = [
          F(sc - bw / 2 - bd * 0.8 - 0.15, -0.05),
          F(sc + bw / 2 + bd * 0.8 + 0.15, -0.05),
          F(sc + bw / 2 + 0.12, bd + 0.18),
          F(sc - bw / 2 - 0.12, bd + 0.18),
        ];
        B.prism(ccw(capR), y1, y1 + 0.28, Part.TRIM, 0, streetY, true);
      }
    }
  }

  // ---- stoop (Victorian front stairs) or garage
  if (isVic && frontW > 4.8 && (seed % 7) !== 0) {
    const ss = seed & 1 ? frontW * 0.18 + 0.6 : frontW * 0.82 - 0.6;
    const w = 1.5;
    const d = 1.7;
    const hgt = Math.min(2.4, H * 0.22);
    // a ramp-ish wedge: high at the wall, low at the sidewalk
    const A0 = F(ss - w / 2, 0), A1 = F(ss + w / 2, 0), D0 = F(ss - w / 2, d), D1 = F(ss + w / 2, d);
    const yTop = baseY + 0.4 + hgt, yLow = baseY + 0.55;
    const OUT: V3 = [outx, 0, outz];
    B.quadF([D0[0], yLow, D0[1]], [D1[0], yLow, D1[1]], [A1[0], yTop, A1[1]], [A0[0], yTop, A0[1]], [0, 0, 1, 0, 1, 1, 0, 1], Part.STOOP, [outx, 1, outz]);
    B.quadF([D1[0], yLow, D1[1]], [D1[0], baseY, D1[1]], [A1[0], baseY, A1[1]], [A1[0], yTop, A1[1]], [0, 0, 0, 0, 0, 0, 0, 0], Part.STOOP, [ux, 0, uz]);
    B.quadF([A0[0], yTop, A0[1]], [A0[0], baseY, A0[1]], [D0[0], baseY, D0[1]], [D0[0], yLow, D0[1]], [0, 0, 0, 0, 0, 0, 0, 0], Part.STOOP, [-ux, 0, -uz]);
    B.quadF([D0[0], yLow, D0[1]], [D0[0], baseY, D0[1]], [D1[0], baseY, D1[1]], [D1[0], yLow, D1[1]], [0, 0, 0, 0, 0, 0, 0, 0], Part.STOOP, OUT);
  }

  // ---- chimney (Victorians) + rooftop clutter
  if (isVic && (seed % 5) < 2) {
    const side = seed & 2 ? 0.25 : 0.75;
    const depth = 0.45 + 0.3 * r();
    const px = fa[0] + ux * (s0 + (s1 - s0) * side) + inx * (t0 + (t1 - t0) * depth);
    const pz = fa[1] + uz * (s0 + (s1 - s0) * side) + inz * (t0 + (t1 - t0) * depth);
    const hw = 0.45;
    const chTop = (gable ? roofY + 2.6 : roofY + 1.7) + r() * 0.6;
    B.prism(ccw([[px - hw, pz - hw], [px + hw, pz - hw], [px + hw, pz + hw], [px - hw, pz + hw]]), roofY - 0.2, chTop, Part.CLUTTER);
  }
  if (!gable) clutter(B, pts, cx, cz, roofY, arch, r);
}

function clutter(B: Builder, pts: Array<[number, number]>, cx: number, cz: number, roofY: number, arch: number, r: () => number) {
  if (arch === Arch.VICTORIAN || arch === Arch.STUCCO || arch === Arch.MARINA) {
    // small-house roofs: a skylight or a roof hatch + a vent stack (texture from above)
    let rad = Infinity;
    for (const p of pts) rad = Math.min(rad, Math.hypot(p[0] - cx, p[1] - cz));
    if (rad < 2.2) return;
    const n = r() < 0.55 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const ang = r() * Math.PI * 2;
      const d = rad * 0.45 * r();
      const px = cx + Math.cos(ang) * d, pz = cz + Math.sin(ang) * d;
      const w = 0.9 + r() * 0.9, dd = 0.9 + r() * 1.1, h = 0.35 + r() * 0.5;
      B.prism(ccw([[px - w / 2, pz - dd / 2], [px + w / 2, pz - dd / 2], [px + w / 2, pz + dd / 2], [px - w / 2, pz + dd / 2]]), roofY - 0.05, roofY + h, Part.CLUTTER);
    }
    return;
  }
  if (!(arch === Arch.FLATS || arch === Arch.COMMERCIAL || arch === Arch.TOWER || arch === Arch.CIVIC)) return;
  // rough inscribed extent: distance from center to nearest vertex
  let rad = Infinity;
  for (const p of pts) rad = Math.min(rad, Math.hypot(p[0] - cx, p[1] - cz));
  if (rad < 3) return;
  const count = arch === Arch.TOWER ? 2 : 1 + Math.floor(r() * 2.2);
  for (let k = 0; k < count; k++) {
    const ang = r() * Math.PI * 2;
    const d = rad * 0.35 * r();
    const px = cx + Math.cos(ang) * d;
    const pz = cz + Math.sin(ang) * d;
    const w = Math.min(rad * 0.55, (arch === Arch.TOWER ? 4 : 1.4) + r() * 2.4);
    const dd = Math.min(rad * 0.55, (arch === Arch.TOWER ? 4 : 1.2) + r() * 2.0);
    const h = (arch === Arch.TOWER ? 3.5 : 1.0) + r() * 2.2;
    const a = r() * 0.6;
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = (x: number, z: number): [number, number] => [px + x * ca - z * sa, pz + x * sa + z * ca];
    if (k === 1 && arch === Arch.FLATS && r() < 0.6) {
      // a wooden water tank on legs (octagonal) — very old-SF rooftop
      const ring: Array<[number, number]> = [];
      const rr = 1.3;
      for (let q = 0; q < 8; q++) ring.push([px + Math.cos((q / 8) * Math.PI * 2) * rr, pz + Math.sin((q / 8) * Math.PI * 2) * rr]);
      B.prism(ccw(ring), roofY + 1.4, roofY + 4.2, Part.CLUTTER, 0, 0, true);
      const legs: Array<[number, number]> = [[px - 0.15, pz - 0.15], [px + 0.15, pz - 0.15], [px + 0.15, pz + 0.15], [px - 0.15, pz + 0.15]];
      B.prism(ccw(legs), roofY, roofY + 1.45, Part.CLUTTER);
      continue;
    }
    B.prism(ccw([P(-w / 2, -dd / 2), P(w / 2, -dd / 2), P(w / 2, dd / 2), P(-w / 2, dd / 2)]), roofY - 0.1, roofY + h, Part.CLUTTER);
  }
}

/** Returns the ring in positive-shoelace order (outward walls = right side of a->b). */
function ccw(ring: Array<[number, number]>): Array<[number, number]> {
  let a = 0;
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k], q = ring[(k + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? ring.slice().reverse() : ring;
}
