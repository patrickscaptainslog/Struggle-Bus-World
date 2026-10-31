// Turns compact baked footprints into merged building meshes (runs in a worker).
// Detail by type: Victorians get bay windows, cornices, false fronts or
// front-facing gables, chimneys and stoops; flats get stacked bays; commercial
// and towers get parapets and rooftop clutter. Walls are split into a few
// segments so painted buildings can wobble.
//
// The sun pass draws a separate caster proxy of every full-detail tile
// (meshCasterTile): the same building code run through a Builder in caster
// mode, which keeps positions only, draws every wall as one quad and drops
// the down-facing undersides (the sun never sees them). Every shape still
// casts: the proxy is the same surface as the detailed mesh, in fewer triangles.
//
// LiDAR-tiered towers arrive as several parts (consecutive records sharing a
// paint index): each part is extruded from the top of the tier below. Street
// features (stoops, bays, belt courses, gables) only go on tier 0; rooftop
// clutter only where a roof is open to the sky; window rows count from the
// building's true ground on every tier. Every part carries the whole
// building's center, ground and top, so the pop, wobble, color flood and aim
// glint move the tower as one.
//
// Per-vertex layout (all Float32 except where noted):
//   position  vec3   world meters
//   normal    vec3   (Int8 normalized)
//   aFacade   vec2   u = meters along the facade (front edge starts at 0), v = meters above street level
//   aMeta     vec4   (Uint8) part, arch (+ facade family << 4), seed, flags (bit0 front-facing,
//                    bit1 corner; towers: bit2 penthouse, bit3 crown, bits4-5 crown type, bits6-7 variant)
//   aBld      vec4   building index, center x, ground y, center z   (the whole building's)
//   aBld2     vec2   building top y, front width of this part (m; facade families: this part's top y)
//
// Facade families (towerStyles.ts) stretch every wall to a whole number of
// column modules, so corners land on piers and columns line up up the tower;
// a tapering face keeps its columns (they converge with it). Painted towers'
// setback gardens (Part.GARDEN) and onion domes (Part.DOME) are baked in but
// collapsed: every vertex of an element sits on its anchor (so it casts no
// shadow and draws nothing), with its offset in aFacade.xy (x, z) and aBld2.y
// (y); the vertex shader grows it out once the building reaches its level.

import type { BuildingTile } from './tiles';
import { Arch, RoofShape } from './tiles';
import { RoofBuild, areaCentroid, clipHalf, convexPieces, eaveY, newRoofFrame, profileOf, ringConvex, roofBuild, roofFrame, roofPlanes } from './roofGeom';
import { Fam, FacadeFlag, FAM_MODULE, styleFor, hiddenAt, type TowerStyle } from './towerStyles';

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
  /** painted towers: a bush or tree on a setback (grows in at level 2 / 3) */
  GARDEN: 10,
  /** painted towers: an onion dome on the crown (grows in at level 3) */
  DOME: 11,
} as const;

export interface MeshArrays {
  position: Float32Array;
  normal: Int8Array;
  facade: Float32Array;
  meta: Uint8Array;
  bld: Float32Array;
  bld2: Float32Array;
  /** Uint16 when the mesh has fewer than 65535 vertices (0xFFFF is the primitive restart index in WebGL2) */
  index: Uint16Array | Uint32Array;
  vertexCount: number;
  /** index count of everything but the collapsed growth (Part.GARDEN / DOME), whose triangles come last:
   * drawn with setDrawRange(0, solidIndexCount) until a building of the mesh grows them (no vertex work) */
  solidIndexCount: number;
}

/** Sun-pass caster proxy of a full-detail tile: positions only (see meshCasterTile). */
export interface CasterArrays {
  position: Float32Array;
  index: Uint16Array | Uint32Array;
  vertexCount: number;
}

/** Index array of the smallest type that holds `vertexCount` vertices. */
export function indexArray(idx: Uint32Array, vertexCount: number): Uint16Array | Uint32Array {
  return vertexCount < 65535 ? new Uint16Array(idx) : idx.slice();
}

/** Per collapsed growth element, GROWN_STRIDE floats: building index, paint level it needs, center x, z,
 * radius and grown top (m, with the growth's overshoot): what the flight's obstacle field must rise over. */
export const GROWN_STRIDE = 6;

/** A growable index list; push() takes one triangle or two. */
class IdxBuf {
  a = new Uint32Array(1 << 15);
  length = 0;
  push(p: number, q: number, r: number, s?: number, t?: number, u?: number) {
    if (this.length + 6 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    const a = this.a;
    let n = this.length;
    a[n++] = p; a[n++] = q; a[n++] = r;
    if (s !== undefined) {
      a[n++] = s; a[n++] = t as number; a[n++] = u as number;
    }
    this.length = n;
  }
}

// Vertex storage that lives as long as the worker: it grows to the biggest tile once, every later tile
// reuses it. Number arrays here were 60-70% of the meshing time, with their garbage collection (deep dive
// rank 9). Positions and facade coordinates are Float64 until finish(): remapU reads them back exact.
// (One Builder at a time: meshing is synchronous, in the worker and in the main-thread fallback.)
let cap = 0;
let sPos = new Float64Array(0), sNrm = new Int8Array(0), sFac = new Float64Array(0), sMeta = new Uint8Array(0), sBld = new Float32Array(0), sBld2 = new Float32Array(0);
function ensure(n: number) {
  if (n <= cap) return;
  let c = Math.max(1 << 14, cap * 2);
  while (c < n) c *= 2;
  const grow = <A extends Float64Array | Float32Array | Int8Array | Uint8Array>(o: A, k: number, C: { new (n: number): A }): A => {
    const b = new C(c * k);
    b.set(o as never);
    return b;
  };
  sPos = grow(sPos, 3, Float64Array);
  sNrm = grow(sNrm, 3, Int8Array);
  sFac = grow(sFac, 2, Float64Array);
  sMeta = grow(sMeta, 4, Uint8Array);
  sBld = grow(sBld, 4, Float32Array);
  sBld2 = grow(sBld2, 2, Float32Array);
  cap = c;
}
const IDX = new IdxBuf(), GIDX = new IdxBuf();

class Builder {
  idx = IDX;
  /** triangles of collapsed growth (appended after idx) */
  gidx = GIDX;
  /** GROWN_STRIDE floats per growth element */
  grown: number[] = [];
  vc = 0;
  // current building context
  cur = { index: 0, cx: 0, cz: 0, baseY: 0, roofY: 0, arch: 0, seed: 0, flags: 0, frontW: 0, ext: 0 };

  /** caster mode: positions only, one quad per wall, no undersides */
  constructor(readonly caster = false) {
    IDX.length = 0;
    GIDX.length = 0;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, part: number, flags = this.cur.flags) {
    const i = this.vc;
    if (i >= cap) ensure(i + 1);
    sPos[i * 3] = x;
    sPos[i * 3 + 1] = y;
    sPos[i * 3 + 2] = z;
    if (this.caster) return this.vc++;
    const c = this.cur;
    sNrm[i * 3] = Math.round(nx * 127);
    sNrm[i * 3 + 1] = Math.round(ny * 127);
    sNrm[i * 3 + 2] = Math.round(nz * 127);
    sFac[i * 2] = u;
    sFac[i * 2 + 1] = v;
    sMeta[i * 4] = part;
    sMeta[i * 4 + 1] = c.arch;
    sMeta[i * 4 + 2] = c.seed;
    sMeta[i * 4 + 3] = flags | c.ext;
    sBld[i * 4] = c.index;
    sBld[i * 4 + 1] = c.cx;
    sBld[i * 4 + 2] = c.baseY;
    sBld[i * 4 + 3] = c.cz;
    sBld2[i * 2] = c.roofY;
    sBld2[i * 2 + 1] = c.frontW;
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
    // (an underside never shows in the sun pass: whatever it could shadow, the face above it already does)
    if (this.caster && want[1] < -0.5) return;
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
    const cols = this.caster ? 1 : Math.max(1, Math.min(6, Math.round(L / segLen)));
    const h = y1 - y0;
    const rows = !this.caster && h > 7 && segLen < 99 ? 2 : 1;
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

  /** Wall a->b leaning in to a'->b' at the top (a tapering tower face), subdivided like wall(). */
  slantWall(ax: number, az: number, bx: number, bz: number, tax: number, taz: number, tbx: number, tbz: number, y0: number, y1: number, u0: number, uTop0: number, uTop1: number, vBase: number, part: number, flags?: number, segLen = 3.2) {
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz);
    if (L < 0.05 || y1 - y0 < 0.05) return;
    // face normal: along-edge x up-the-slant
    const ex = dx / L, ez = dz / L;
    const mx = (tax + tbx - ax - bx) / 2, my = y1 - y0, mz = (taz + tbz - az - bz) / 2;
    let nx = ez * my, ny = ex * mz - ez * mx, nz = -ex * my;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const cols = this.caster ? 1 : Math.max(1, Math.min(6, Math.round(L / segLen)));
    const rows = !this.caster && y1 - y0 > 7 && segLen < 99 ? 2 : 1;
    const base = this.vc;
    for (let r = 0; r <= rows; r++) {
      const k = r / rows;
      const y = y0 + (y1 - y0) * k;
      const pax = ax + (tax - ax) * k, paz = az + (taz - az) * k, pbx = bx + (tbx - bx) * k, pbz = bz + (tbz - bz) * k;
      const ua = u0 + (uTop0 - u0) * k, ub = u0 + L + (uTop1 - u0 - L) * k;
      for (let c = 0; c <= cols; c++) {
        const t = c / cols;
        this.vert(pax + (pbx - pax) * t, y, paz + (pbz - paz) * t, nx, ny, nz, ua + (ub - ua) * t, y - vBase, part, flags);
      }
    }
    const w = cols + 1;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i0 = base + r * w + c;
        this.idx.push(i0, i0 + w + 1, i0 + 1, i0, i0 + w, i0 + w + 1);
      }
  }

  /** Axis-free box: footprint quad (CCW in x,z), y range. All 6 faces (bottom optional). */
  prism(pts: Array<[number, number]>, y0: number, y1: number, part: number, uBase = 0, vBase = 0, bottom = false, flags?: number) {
    if (this.caster) bottom = false;
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

  /**
   * Facade families: re-measure u on the vertices [v0, vc) of one wall a->b so
   * the wall spans exactly `span` meters from u0 (a whole number of modules).
   * A tapering face (top edge ta->tb) keeps the same u range at every height.
   * Works on whatever vertices wall() / slantWall() emitted (any subdivision).
   */
  remapU(v0: number, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, u0: number, span: number, ta?: [number, number], tb?: [number, number]) {
    if (this.caster) return;
    for (let k = v0; k < this.vc; k++) {
      const x = sPos[k * 3], y = sPos[k * 3 + 1], z = sPos[k * 3 + 2];
      let pax = ax, paz = az, pbx = bx, pbz = bz;
      if (ta && tb) {
        const f = y1 > y0 ? Math.min(1, Math.max(0, (y - y0) / (y1 - y0))) : 0;
        pax = ax + (ta[0] - ax) * f; paz = az + (ta[1] - az) * f;
        pbx = bx + (tb[0] - bx) * f; pbz = bz + (tb[1] - bz) * f;
      }
      const ex = pbx - pax, ez = pbz - paz;
      const l2 = ex * ex + ez * ez;
      const t = l2 > 1e-6 ? Math.min(1, Math.max(0, ((x - pax) * ex + (z - paz) * ez) / l2)) : 0;
      sFac[k * 2] = u0 + t * span;
    }
  }

  /**
   * One vertex of a collapsed element (garden blob, onion dome): it sits on its
   * anchor; the offset rides in aFacade.xy (x, z) and aBld2.y (y). `flags`
   * carries the paint level the element needs in bits 2-3.
   */
  grownVert(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, nx: number, ny: number, nz: number, part: number, flags: number) {
    const c = this.cur;
    const i = this.vc;
    if (i >= cap) ensure(i + 1);
    sPos[i * 3] = ax;
    sPos[i * 3 + 1] = ay;
    sPos[i * 3 + 2] = az;
    sNrm[i * 3] = Math.round(nx * 127);
    sNrm[i * 3 + 1] = Math.round(ny * 127);
    sNrm[i * 3 + 2] = Math.round(nz * 127);
    sFac[i * 2] = dx;
    sFac[i * 2 + 1] = dz;
    sMeta[i * 4] = part;
    sMeta[i * 4 + 1] = c.arch;
    sMeta[i * 4 + 2] = c.seed;
    sMeta[i * 4 + 3] = flags;
    sBld[i * 4] = c.index;
    sBld[i * 4 + 1] = c.cx;
    sBld[i * 4 + 2] = c.baseY;
    sBld[i * 4 + 3] = c.cz;
    sBld2[i * 2] = c.roofY;
    sBld2[i * 2 + 1] = dy;
    return this.vc++;
  }

  /** A flat-shaded triangle of a collapsed element (offsets from the anchor; counter-clockwise seen from outside). */
  grownTri(ax: number, ay: number, az: number, p0: V3, p1: V3, p2: V3, part: number, flags: number) {
    const n = faceNormal(p0, p1, p2);
    const a = this.grownVert(ax, ay, az, p0[0], p0[1], p0[2], n[0], n[1], n[2], part, flags);
    const b = this.grownVert(ax, ay, az, p1[0], p1[1], p1[2], n[0], n[1], n[2], part, flags);
    const d = this.grownVert(ax, ay, az, p2[0], p2[1], p2[2], n[0], n[1], n[2], part, flags);
    this.gidx.push(a, b, d);
  }

  /** Record a growth element for the flight's obstacle field (see GROWN_STRIDE). The vertex shader's growth
   * overshoots by up to ~12 % (1 - e^-5k cos 7.5k peaks at 1.123). */
  grownElement(x: number, z: number, r: number, anchorY: number, height: number, flags: number) {
    this.grown.push(this.cur.index, (flags >> 2) & 3, x, z, r, anchorY + height * 1.13);
  }

  finish(): { mesh: MeshArrays; grown: Float32Array } {
    const ic = this.idx.length + this.gidx.length, vc = this.vc;
    const index = vc < 65535 ? new Uint16Array(ic) : new Uint32Array(ic);
    index.set(this.idx.a.subarray(0, this.idx.length));
    index.set(this.gidx.a.subarray(0, this.gidx.length), this.idx.length);
    return {
      mesh: {
        position: new Float32Array(sPos.subarray(0, vc * 3)),
        normal: sNrm.slice(0, vc * 3),
        facade: new Float32Array(sFac.subarray(0, vc * 2)),
        meta: sMeta.slice(0, vc * 4),
        bld: sBld.slice(0, vc * 4),
        bld2: sBld2.slice(0, vc * 2),
        index,
        vertexCount: this.vc,
        solidIndexCount: this.idx.length,
      },
      grown: new Float32Array(this.grown),
    };
  }

  finishCaster(): CasterArrays {
    const vc = this.vc;
    return { position: new Float32Array(sPos.subarray(0, vc * 3)), index: indexArray(this.idx.a.subarray(0, this.idx.length), vc), vertexCount: vc };
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
  /** the city is San Francisco (the icons and HIDDEN tables are written in its local meters) */
  sf: boolean;
  /** roofKinds(t) */
  kinds: Uint8Array;
}

/** The building a part belongs to: records [first, end) of the tile. */
interface Group {
  first: number;
  end: number;
  cx: number;
  cz: number;
  top: number;
  /** per record of the tile: how its mapped roof is built (RoofBuild; FLAT = flat roof + parapet) */
  kinds: Uint8Array;
  /** facade style of the whole building (null = the classic archetype look) */
  style: TowerStyle | null;
  /** per part (k - first): facade family and the extra flag bits (penthouse, crown, crown type, variant) */
  fam: number[];
  ext: number[];
  /** what's left of the building's budget of onion domes and garden blobs (painted towers) */
  domes: number;
  garden: number;
}

/** Signed-free area of record k's ring (m^2). */
function ringArea(t: BuildingTile, k: number): number {
  const s = t.vertStart[k], e = t.vertStart[k + 1];
  let a = 0;
  for (let m = s; m < e; m++) {
    const m2 = m + 1 < e ? m + 1 : s;
    a += t.xz[m * 2] * t.xz[m2 * 2 + 1] - t.xz[m2 * 2] * t.xz[m * 2 + 1];
  }
  return Math.abs(a) / 2;
}

/**
 * Roles of a styled building's parts: small rooftop boxes are mechanical
 * penthouses (no windows), the tallest other parts carry the crown, and parts
 * under half the building's height are podium (they may wear the podium family).
 */
function partRoles(t: BuildingTile, g: Group, st: TowerStyle) {
  const n = g.end - g.first;
  g.fam.length = n;
  g.ext.length = n;
  const ground = t.groundY[g.first];
  const H = g.top - ground;
  let maxA = 0;
  const area: number[] = [];
  for (let k = g.first; k < g.end; k++) {
    area.push(ringArea(t, k));
    maxA = Math.max(maxA, area[k - g.first]);
  }
  const pent = (k: number) => n > 1 && H >= 30 && t.tier[k] > 0 && t.roofY[k] - t.baseY[k] < 14 && area[k - g.first] < 0.45 * maxA && t.roofY[k] >= g.top - 15;
  let crownTop = -Infinity;
  for (let k = g.first; k < g.end; k++) if (!pent(k)) crownTop = Math.max(crownTop, t.roofY[k]);
  for (let k = g.first; k < g.end; k++) {
    const isPent = pent(k);
    const isCrown = !isPent && t.roofY[k] >= crownTop - 4;
    const towerPart = n === 1 || isPent || isCrown || t.roofY[k] - ground >= 0.5 * H;
    const fam = towerPart ? st.fam : st.podium;
    const variant = fam === st.fam ? st.variant : 0;
    g.fam[k - g.first] = fam;
    g.ext[k - g.first] = (isPent ? FacadeFlag.PENTHOUSE : 0) | (isCrown ? FacadeFlag.CROWN : 0) | (st.crown << 4) | (variant << 6);
  }
}

/** How every part's mapped roof is built (RoofBuild), first: a shape that falls back adds no rise to the flood / pop top. */
export function roofKinds(t: BuildingTile): Uint8Array {
  const kinds = new Uint8Array(t.count);
  for (let k = 0; k < t.count; k++) kinds[k] = roofBuild(t.xz, t.vertStart[k], t.vertStart[k + 1], t.roofShape[k], t.roofH[k], t.roofDir[k], t.taper[k]);
  return kinds;
}

export function meshBuildingTile(t: BuildingTile, opts: MeshOptions): { mesh: MeshArrays; grown: Float32Array } {
  const B = new Builder();
  meshTile(B, t, opts.lod, opts.sf, opts.kinds);
  return B.finish();
}

/**
 * The sun pass's stand-in for a full-detail tile: the LOD 0 buildings, every
 * shape of them, with flat walls and no undersides. Positions only. (Hidden
 * footprints stay hidden: same `sf` as the visible mesh.)
 */
export function meshCasterTile(t: BuildingTile, sf: boolean, kinds: Uint8Array): CasterArrays {
  const B = new Builder(true);
  meshTile(B, t, 0, sf, kinds);
  return B.finishCaster();
}

function meshTile(B: Builder, t: BuildingTile, lod: 0 | 1, sf: boolean, kinds: Uint8Array) {
  const g: Group = { first: 0, end: 0, cx: 0, cz: 0, top: 0, kinds, style: null, fam: [], ext: [], domes: 0, garden: 0 };
  for (let i = 0; i < t.count; ) {
    let j = i + 1;
    while (j < t.count && t.index[j] === t.index[i]) j++;
    // center of the footprint (tier 0) and the top of the whole building
    const s = t.vertStart[i], e = t.vertStart[i + 1];
    let cx = 0, cz = 0;
    for (let k = s; k < e; k++) { cx += t.xz[k * 2]; cz += t.xz[k * 2 + 1]; }
    g.first = i;
    g.end = j;
    g.cx = cx / Math.max(1, e - s);
    g.cz = cz / Math.max(1, e - s);
    g.top = 0;
    for (let k = i; k < j; k++) g.top = Math.max(g.top, kinds[k] ? eaveY(t.baseY[k], t.roofY[k], t.tier[k]) + t.roofH[k] : t.roofY[k], t.baseY[k] + 2.5);
    const H = g.top - t.groundY[i];
    // footprints a hand-built prop draws instead (the Ferry Building's row of "Victorian" lots)
    if (sf && hiddenAt(g.cx, g.cz, H)) { i = j; continue; }
    const first = i, end = j;
    g.style = styleFor(t.arch[i], H, ringArea(t, i), g.cx, g.cz, t.stableId[i], (x, z) => {
      for (let k = first; k < end; k++) if (ringContains(t, k, x, z)) return true;
      return false;
    }, sf);
    if (g.style) partRoles(t, g, g.style);
    // (baked collapsed, they still cost triangles: a few per tower)
    g.domes = 3;
    g.garden = 14;
    for (let k = i; k < j; k++) meshBuilding(B, t, k, lod, g);
    i = j;
  }
}

/** LOD 1 rings keep what shows there: a footprint's outline survives to within this (m). The nearest LOD 1 wall stands
 * 500+ m from the lens (DETAIL_RADIUS x 0.8), where a game pixel is 0.6-0.75 m, up high 1-2.5 m. */
const RING_EPS = 1;

/** Squared distance from point p to the segment a-b. */
function dist2(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  const u = L2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  const ex = a[0] + dx * u - p[0], ez = a[1] + dz * u - p[1];
  return ex * ex + ez * ez;
}

/**
 * Which vertices of a ring (positive shoelace) the coarse mesh keeps, ascending, or null for all of them: Douglas-Peucker
 * around the ring at RING_EPS, with the front edges kept whole (the facade starts there). OpenStreetMap's footprints
 * carry every jog of a parcel (9.9 vertices a ring in SF, against USA Structures' 5.7), and each costs three triangles at
 * LOD 1, twice with the sun pass, on regions that show a building as a few pixels.
 */
function ringKeep(pts: Array<[number, number]>, area: number, front: number, front2: number): number[] | null {
  const n = pts.length;
  const on = new Uint8Array(n);
  let first = 0;
  if (front !== 255 && front < n) {
    on[front] = on[(front + 1) % n] = 1;
    first = front;
  }
  if (front2 !== 255 && front2 < n) on[front2] = on[(front2 + 1) % n] = 1;
  on[first] = 1;
  // (and the vertex farthest from it: a closed ring needs two anchors)
  let far = first, fd = -1;
  for (let k = 0; k < n; k++) {
    const d = (pts[k][0] - pts[first][0]) ** 2 + (pts[k][1] - pts[first][1]) ** 2;
    if (d > fd) {
      fd = d;
      far = k;
    }
  }
  on[far] = 1;
  const anchors: number[] = [];
  for (let k = 0; k < n; k++) if (on[k]) anchors.push(k);
  const eps2 = RING_EPS * RING_EPS;
  const span = (i: number, j: number) => {
    let m = -1, dm = eps2;
    for (let k = (i + 1) % n; k !== j; k = (k + 1) % n) {
      const d = dist2(pts[k], pts[i], pts[j]);
      if (d > dm) {
        dm = d;
        m = k;
      }
    }
    if (m < 0) return;
    on[m] = 1;
    span(i, m);
    span(m, j);
  };
  for (let a = 0; a < anchors.length; a++) span(anchors[a], anchors[(a + 1) % anchors.length]);
  const keep: number[] = [];
  for (let k = 0; k < n; k++) if (on[k]) keep.push(k);
  if (keep.length === n || keep.length < 3) return null;
  // (a sliver a straight line would collapse keeps its ring)
  let a2 = 0;
  for (let q = 0; q < keep.length; q++) {
    const p = pts[keep[q]], r = pts[keep[(q + 1) % keep.length]];
    a2 += p[0] * r[1] - r[0] * p[1];
  }
  return a2 / 2 > 0.85 * area && a2 / 2 < 1.15 * area ? keep : null;
}

/** True if (x, z) is inside the ring of record k. */
function ringContains(t: BuildingTile, k: number, x: number, z: number): boolean {
  const s = t.vertStart[k], e = t.vertStart[k + 1];
  let inside = false;
  for (let a = s, b = e - 1; a < e; b = a++) {
    const xa = t.xz[a * 2], za = t.xz[a * 2 + 1], xb = t.xz[b * 2], zb = t.xz[b * 2 + 1];
    if (za > z !== zb > z && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside;
  }
  return inside;
}

/** True if a higher tier of the same building covers (x, z) (its roof isn't open to the sky there). */
function covered(t: BuildingTile, g: Group, i: number, x: number, z: number): boolean {
  for (let k = g.first; k < g.end; k++) if (t.tier[k] > t.tier[i] && ringContains(t, k, x, z)) return true;
  return false;
}

/** True if a higher tier of the same building has a wall flush with edge a->b (a parapet there would z-fight it). */
function flushAbove(t: BuildingTile, g: Group, i: number, ax: number, az: number, bx: number, bz: number): boolean {
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 0.1) return false;
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  for (let k = g.first; k < g.end; k++) {
    if (t.tier[k] <= t.tier[i]) continue;
    const s = t.vertStart[k], e = t.vertStart[k + 1];
    for (let m = s; m < e; m++) {
      const m2 = m + 1 < e ? m + 1 : s;
      const px = t.xz[m * 2] - ax, pz = t.xz[m * 2 + 1] - az, qx = t.xz[m2 * 2] - ax, qz = t.xz[m2 * 2 + 1] - az;
      // both ends on the line through a->b, overlapping it by more than half a meter
      if (Math.abs(px * uz - pz * ux) > 0.35 || Math.abs(qx * uz - qz * ux) > 0.35) continue;
      const s0 = px * ux + pz * uz, s1 = qx * ux + qz * uz;
      if (Math.min(Math.max(s0, s1), L) - Math.max(Math.min(s0, s1), 0) > 0.5) return true;
    }
  }
  return false;
}

function meshBuilding(B: Builder, t: BuildingTile, i: number, lod: 0 | 1, g: Group) {
  const s = t.vertStart[i];
  const e = t.vertStart[i + 1];
  let n = e - s;
  if (n < 3) return;
  const tier = t.tier[i];
  const single = g.end - g.first === 1;
  let pts: Array<[number, number]> = [];
  for (let k = s; k < e; k++) pts.push([t.xz[k * 2], t.xz[k * 2 + 1]]);
  // a tapering part: its top ring is its base scaled about the area centroid
  const topScale = 1 - t.taper[i] / 255;
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
  // (a facade family's columns land on its walls' corners: a tower keeps its ring)
  if (lod === 1 && n > 4 && !g.style) {
    const keep = ringKeep(pts, Math.abs(area) / 2, front, front2);
    if (keep) {
      pts = keep.map((k) => pts[k]);
      n = pts.length;
      if (front !== 255) front = keep.indexOf(front);
      if (front2 !== 255) front2 = keep.indexOf(front2);
    }
  }
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= n; cz /= n;
  const baseY = t.baseY[i];
  const roofY = Math.max(t.roofY[i], baseY + (tier > 0 ? 1.0 : 2.5));
  const arch = t.arch[i];
  const seed = t.seed[i];
  const r = rng((t.stableId[i] ^ 0x9e3779b9) + tier * 7919);
  const streetY = t.groundY[i] + 0.4; // street level reference for window rows (shared by every tier)
  let frontW = 0;
  let fa: [number, number] = pts[0], fb: [number, number] = pts[1 % n];
  if (front !== 255 && front < n) {
    fa = pts[front];
    fb = pts[(front + 1) % n];
    frontW = Math.hypot(fb[0] - fa[0], fb[1] - fa[1]);
  }
  const corner = front2 !== 255 ? 2 : 0;
  // facade family of this part (0 = the classic look) and its penthouse / crown bits
  const fam = g.style ? g.fam[i - g.first] : 0;
  const ext = g.style ? g.ext[i - g.first] : 0;
  const mod = FAM_MODULE[fam] ?? 0;
  // the whole building's center, ground and top: tiers pop, wobble and flood as one
  // (families: aBld2.y carries this part's top instead of the front width, which only houses use)
  B.cur = { index: t.index[i], cx: g.cx, cz: g.cz, baseY: t.groundY[i], roofY: g.top, arch: arch | (fam << 4), seed, flags: corner, frontW: fam ? roofY : frontW, ext };

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
  // a mapped roof shape (OSM roof:shape): its own roof; untagged Victorians keep the procedural front gables
  const shape = t.roofShape[i];
  const builtShape = g.kinds[i] !== RoofBuild.FLAT;
  const gable = lod === 0 && single && isVic && shape === RoofShape.NONE && frontW > 4.5 && frontW < 11 && rectangularity > 0.82 && (seed % 100) < 38 && H < 15;
  // no parapet where the tier above rises flush from this edge
  const flush = !single && front !== 255 && flushAbove(t, g, i, fa[0], fa[1], fb[0], fb[1]);
  // (roofBuild said whether it's built: a footprint it can't roof keeps its parapet and flat roof)
  if (builtShape) shapedRoof(B, t, i, g.kinds[i], pts, roofY, front !== 255 ? front : 0, front, front2, streetY, corner);
  // (a curtain wall or a concrete tower ends flush: its top band is drawn by the shader)
  const parapet = lod === 0 && !gable && !builtShape && !flush && front !== 255 && topScale >= 1 && (fam === 0 || fam === Fam.MASONRY) ? (isVic ? 1.3 : isFlats ? 0.9 : arch === Arch.COMMERCIAL || arch === Arch.CIVIC ? 0.7 : arch === Arch.TOWER ? 1.2 : 0.5) : 0;

  // ---- walls
  // perimeter u starts at the front edge so the facade pattern lines up with it
  const startK = front !== 255 ? front : 0;
  // wall columns only serve the painted wobble: towers' upper tiers (high, narrow faces) need fewer
  const segLen = tier > 0 ? 6.4 : 3.2;
  let u = 0;
  let uF = 0; // facade families: u in whole modules
  if (topScale < 1) {
    // tapering tower: faces lean in to the scaled top ring; the roof below is that ring
    let ac = 0, acx = 0, acz = 0;
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      const cr = a[0] * b[1] - b[0] * a[1];
      ac += cr; acx += (a[0] + b[0]) * cr; acz += (a[1] + b[1]) * cr;
    }
    const ccx = Math.abs(ac) > 1e-6 ? acx / (3 * ac) : cx, ccz = Math.abs(ac) > 1e-6 ? acz / (3 * ac) : cz;
    const top: Array<[number, number]> = pts.map((p) => [ccx + (p[0] - ccx) * topScale, ccz + (p[1] - ccz) * topScale]);
    for (let j = 0; j < n; j++) {
      const k = (startK + j) % n;
      const a = pts[k], b = pts[(k + 1) % n], ta = top[k], tb = top[(k + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const isFront = k === front || k === front2;
      // a face leaning more than ~35 degrees reads as a roof (no window grid on a sloped crown)
      const mx = (ta[0] + tb[0] - a[0] - b[0]) / 2, mz = (ta[1] + tb[1] - a[1] - b[1]) / 2;
      const roofish = Math.hypot(mx, mz) > 0.7 * (roofY - baseY);
      const part = roofish ? Part.ROOF_SLOPE : isFront ? Part.FRONT : Part.SIDE;
      const v0 = B.vc;
      B.slantWall(a[0], a[1], b[0], b[1], ta[0], ta[1], tb[0], tb[1], baseY, roofY, u, u * topScale, (u + L) * topScale, streetY, part, (isFront && !roofish ? 1 : 0) | corner, lod === 1 ? 999 : segLen);
      if (mod > 0) {
        // a whole number of modules, the same columns at every height: they converge with the face
        const span = Math.max(1, Math.round(L / mod)) * mod;
        B.remapU(v0, a[0], a[1], b[0], b[1], baseY, roofY, uF, span, ta, tb);
        uF += span;
      }
      u += L;
    }
    const xz: number[] = [];
    for (const p of top) xz.push(p[0], p[1]);
    const tris = triangulate(xz);
    const base = B.vc;
    for (const p of top) B.vert(p[0], roofY, p[1], 0, 1, 0, p[0], p[1], Part.ROOF);
    for (let k = 0; k < tris.length; k += 3) B.idx.push(base + tris[k], base + tris[k + 2], base + tris[k + 1]);
    if (lod === 0) {
      let tcx = 0, tcz = 0;
      for (const p of top) { tcx += p[0]; tcz += p[1]; }
      clutter(B, top, tcx / n, tcz / n, roofY, arch, r, single ? null : (x: number, z: number) => !covered(t, g, i, x, z));
    }
    if (fam) towerGrowth(B, t, g, i, top, roofY, lod);
    return;
  }
  for (let j = 0; j < n; j++) {
    const k = (startK + j) % n;
    const a = pts[k];
    const b = pts[(k + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const isFront = k === front || k === front2;
    const top = isFront && (k === front || single || !flushAbove(t, g, i, a[0], a[1], b[0], b[1])) ? roofY + parapet : roofY;
    const v0 = B.vc;
    B.wall(a[0], a[1], b[0], b[1], baseY, top, u, streetY, isFront ? Part.FRONT : Part.SIDE, (isFront ? 1 : 0) | corner, lod === 1 ? 999 : segLen);
    if (mod > 0) {
      // a whole number of modules per wall: corners land on piers, columns line up up the tower
      const span = Math.max(1, Math.round(L / mod)) * mod;
      B.remapU(v0, a[0], a[1], b[0], b[1], baseY, top, uF, span);
      uF += span;
    }
    u += L;
  }

  // ---- roof
  if (builtShape) {
    // (the roof covers the footprint)
  } else if (gable) {
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

  // rooftop clutter: only on roof that is open to the sky
  const open = single ? null : (x: number, z: number) => !covered(t, g, i, x, z);
  // (a mapped roof stands where a setback garden or a crown's onions would: they'd hang inside it)
  if (fam && !builtShape) towerGrowth(B, t, g, i, pts, roofY, lod);
  if (lod === 1 || front === 255) {
    if (lod === 0 && !builtShape) clutter(B, pts, cx, cz, roofY, arch, r, open);
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
  if ((isRes || arch === Arch.COMMERCIAL || arch === Arch.CIVIC) && !flush && (fam === 0 || fam === Fam.MASONRY)) {
    // cornice: a chunky projecting band at the top of the facade
    const cd = isVic ? 0.65 : 0.5;
    const ch = isVic ? 0.55 : 0.4;
    const ext = 0.12;
    const yc = gable ? roofY - 0.1 : topY;
    const quadC: Array<[number, number]> = [F(-ext, 0), F(frontW + ext, 0), F(frontW + ext, cd), F(-ext, cd)];
    // ring must be CCW (positive shoelace) for outward walls
    B.prism(ccw(quadC), yc - ch, yc + 0.08, Part.TRIM, 0, streetY, true);
    if (isFlats && H > 9 && tier === 0) {
      // belt course between ground floor and upper floors
      const yb = baseY + 3.6;
      B.prism(ccw([F(-0.05, 0), F(frontW + 0.05, 0), F(frontW + 0.05, 0.3), F(-0.05, 0.3)]), yb, yb + 0.35, Part.TRIM, 0, streetY, true);
    }
  }

  // ---- bay windows (street level up: ground tier only)
  if ((isVic || isFlats || arch === Arch.MARINA) && frontW >= 4.2 && tier === 0) {
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
  if (isVic && frontW > 4.8 && (seed % 7) !== 0 && tier === 0) {
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

  // ---- chimney (Victorians) + rooftop clutter (both stand on a flat roof at roofY: none on a mapped roof)
  if (isVic && single && !builtShape && (seed % 5) < 2) {
    const side = seed & 2 ? 0.25 : 0.75;
    const depth = 0.45 + 0.3 * r();
    const px = fa[0] + ux * (s0 + (s1 - s0) * side) + inx * (t0 + (t1 - t0) * depth);
    const pz = fa[1] + uz * (s0 + (s1 - s0) * side) + inz * (t0 + (t1 - t0) * depth);
    const hw = 0.45;
    const chTop = (gable ? roofY + 2.6 : roofY + 1.7) + r() * 0.6;
    B.prism(ccw([[px - hw, pz - hw], [px + hw, pz - hw], [px + hw, pz + hw], [px - hw, pz + hw]]), roofY - 0.2, chTop, Part.CLUTTER);
  }
  if (!gable && !builtShape) clutter(B, pts, cx, cz, roofY, arch, r, open);
}

// ---- painted towers: setback gardens (level 2 bushes, level 3 trees spilling
// over the edge) and an onion-dome crown (level 3), baked collapsed (see the header)

/** Octahedron blob (8 flat faces) centered at c (offsets from the anchor), radii rx/ry/rz, turned by yaw. */
function blob(B: Builder, ax: number, ay: number, az: number, c: V3, rx: number, ry: number, rz: number, yaw: number, part: number, flags: number) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const P = (x: number, y: number, z: number): V3 => [c[0] + x * ca - z * sa, c[1] + y, c[2] + x * sa + z * ca];
  const X = P(rx, 0, 0), NX = P(-rx, 0, 0), Y = P(0, ry, 0), NY = P(0, -ry, 0), Z = P(0, 0, rz), NZ = P(0, 0, -rz);
  B.grownElement(ax + c[0] * 1.13, az + c[2] * 1.13, Math.max(rx, rz) * 1.13, ay, c[1] + ry, flags);
  B.grownTri(ax, ay, az, X, Y, Z, part, flags);
  B.grownTri(ax, ay, az, Z, Y, NX, part, flags);
  B.grownTri(ax, ay, az, NX, Y, NZ, part, flags);
  B.grownTri(ax, ay, az, NZ, Y, X, part, flags);
  B.grownTri(ax, ay, az, Z, NY, X, part, flags);
  B.grownTri(ax, ay, az, NX, NY, Z, part, flags);
  B.grownTri(ax, ay, az, NZ, NY, NX, part, flags);
  B.grownTri(ax, ay, az, X, NY, NZ, part, flags);
}

/** Onion dome profile (radius, height) in units of its radius: a drum, the bulb, the point. */
const ONION: Array<[number, number]> = [[0.8, 0], [0.8, 0.5], [1.1, 1.05], [0.5, 1.8], [0, 2.55]];

function onionDome(B: Builder, ax: number, ay: number, az: number, rd: number, flags: number) {
  const seg = 6;
  B.grownElement(ax, az, 1.1 * rd * 1.13, ay, ONION[ONION.length - 1][1] * rd, flags);
  for (let q = 0; q < ONION.length - 1; q++) {
    const [r0, h0] = ONION[q], [r1, h1] = ONION[q + 1];
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
      const p00: V3 = [Math.cos(a0) * r0 * rd, h0 * rd, Math.sin(a0) * r0 * rd];
      const p01: V3 = [Math.cos(a1) * r0 * rd, h0 * rd, Math.sin(a1) * r0 * rd];
      const p10: V3 = [Math.cos(a0) * r1 * rd, h1 * rd, Math.sin(a0) * r1 * rd];
      const p11: V3 = [Math.cos(a1) * r1 * rd, h1 * rd, Math.sin(a1) * r1 * rd];
      // outward = away from the axis: pick the winding that faces it
      const am = (a0 + a1) / 2;
      const want: V3 = [Math.cos(am), 0.4, Math.sin(am)];
      const tri = (p: V3, q2: V3, w: V3) => {
        const n = faceNormal(p, q2, w);
        if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) B.grownTri(ax, ay, az, p, w, q2, Part.DOME, flags);
        else B.grownTri(ax, ay, az, p, q2, w, Part.DOME, flags);
      };
      tri(p00, p01, p11);
      if (r1 > 0.001) tri(p00, p11, p10);
    }
  }
}

/** Needed paint level for a collapsed element, in flag bits 2-3 (+ bit 4: a tree, not a bush). */
const NEED2 = 2 << 2, NEED3 = 3 << 2, TREE = 16;

/**
 * Gardens on a styled tower's open setback roofs and onion domes on its
 * crown. `ring` is this part's roof outline (positive shoelace), at roofY.
 */
function towerGrowth(B: Builder, t: BuildingTile, g: Group, i: number, ring: Array<[number, number]>, roofY: number, lod: 0 | 1) {
  const H = g.top - t.groundY[i];
  if (H < 40 || !g.style || B.caster) return;
  const ext = g.ext[i - g.first];
  const isPent = (ext & FacadeFlag.PENTHOUSE) !== 0;
  const isCrown = (ext & FacadeFlag.CROWN) !== 0;
  if (isPent) return;
  const single = g.end - g.first === 1;
  const open = (x: number, z: number) => single || !covered(t, g, i, x, z);
  const R = rng((t.stableId[i] ^ 0x5bd1e995) + t.tier[i] * 104729);
  const n = ring.length;
  let rcx = 0, rcz = 0;
  for (const p of ring) { rcx += p[0]; rcz += p[1]; }
  rcx /= n; rcz /= n;
  if (isCrown) {
    // level 3: onion domes on the crown's corners (the rooftop sprouts put their own centerpiece in the middle)
    // (the coarse mesh far away / up high: only the tallest towers keep a pair)
    if (lod === 1 && (H < 150 || g.domes < 2)) return;
    if (lod === 1) g.domes = 2;
    if (g.domes <= 0) return;
    let area = 0;
    for (let k = 0; k < n; k++) area += ring[k][0] * ring[(k + 1) % n][1] - ring[(k + 1) % n][0] * ring[k][1];
    area = Math.abs(area) / 2;
    const rd = Math.min(9, Math.max(3, 0.16 * Math.sqrt(area)));
    const placed: Array<[number, number]> = [];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      let best = ring[0], bv = -Infinity;
      for (const p of ring) {
        const v = p[0] * sx + p[1] * sz;
        if (v > bv) { bv = v; best = p; }
      }
      const dx = rcx - best[0], dz = rcz - best[1];
      const dl = Math.hypot(dx, dz);
      if (dl < rd * 2.2) continue;
      const k = (rd + 1.2) / dl;
      const x = best[0] + dx * k, z = best[1] + dz * k;
      if (g.domes <= 0 || placed.some((q) => Math.hypot(q[0] - x, q[1] - z) < rd * 2.4) || !open(x, z)) continue;
      placed.push([x, z]);
      g.domes--;
      onionDome(B, x, roofY, z, rd * (0.85 + 0.3 * R()), NEED3);
    }
    return;
  }
  // a setback: bushes along its edges (level 2), trees leaning out over the edge between them (level 3)
  if (lod === 1 || roofY > g.top - 3) return;
  for (let k = 0; k < n && g.garden > 0; k++) {
    const a = ring[k], b = ring[(k + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const L = Math.hypot(ex, ez);
    if (L < 5) continue;
    const ix = -ez / L, iz = ex / L; // inward (left of a->b)
    const count = Math.floor(L / 8);
    for (let j = 0; j < count && g.garden > 0; j++) {
      const f = (j + 0.5 + (R() - 0.5) * 0.3) / count;
      const px = a[0] + ex * f, pz = a[1] + ez * f;
      const tree = j % 2 === 1 || R() < 0.25;
      const inset = tree ? 1.1 : 1.6;
      const x = px + ix * inset, z = pz + iz * inset;
      if (!open(x, z) || !open(x + ix * 2, z + iz * 2)) continue;
      g.garden--;
      const yaw = R() * 6.283;
      if (tree) {
        const rt = 1.8 + 1.1 * R();
        // the crown hangs out over the edge of the setback
        const out = -0.9 - 0.6 * R();
        blob(B, x, roofY, z, [ix * out, 1.1 + rt * 0.75, iz * out], rt, rt * 0.82, rt, yaw, Part.GARDEN, NEED3 | TREE);
      } else {
        const rb = 1.0 + 0.55 * R();
        const hb = 1.3 + 0.8 * R();
        blob(B, x, roofY, z, [0, hb * 0.5, 0], rb, hb * 0.5, rb, yaw, Part.GARDEN, NEED2);
      }
    }
  }
}

function clutter(B: Builder, pts: Array<[number, number]>, cx: number, cz: number, roofY: number, arch: number, r: () => number, open: ((x: number, z: number) => boolean) | null) {
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
      if (open && !open(px, pz)) continue;
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
    if (open && !(open(px, pz) && open(...P(-w / 2, -dd / 2)) && open(...P(w / 2, dd / 2)) && open(...P(w / 2, -dd / 2)) && open(...P(-w / 2, dd / 2)))) continue;
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

// ---- shaped roofs (OpenStreetMap roof:shape, 'SBB3'; the geometry is roofGeom's, which City's gameplay heights share)
// A planar roof is a height field over the footprint: the lowest of a few planes in the roof's frame (s along the
// ridge, t across it, the direction byte says which way the main face looks). Each plane's face is the footprint
// where that plane is the lowest: every convex piece of the footprint (the ring itself when it is convex, else
// roofGeom's convexPieces: its triangles merged while convex) clipped to the plane's convex region (the half-planes where it is under each other plane), so
// the faces cover the footprint exactly, concave or not. The walls rise above the eave where the roof does
// (gable ends, a skillion's high side). Domes, onions, cones and pyramids on odd footprints are revolved: the
// ring scaled toward its area centroid, band by band. roofBuild (roofGeom) decided which, before Group.top.

const _cen = { x: 0, z: 0 };

/**
 * The mapped roof of record i (kind: its RoofBuild, not FLAT) on its ring pts (positive shoelace in x, z), eave
 * at y. startK / front / front2: the walls' facade layout (u along the facade from the front edge), so gable-end
 * walls continue the windows below.
 */
function shapedRoof(B: Builder, t: BuildingTile, i: number, kind: number, pts: Array<[number, number]>, y: number,
  startK: number, front: number, front2: number, streetY: number, corner: number) {
  const s = t.vertStart[i], e = t.vertStart[i + 1];
  const R = t.roofH[i], shape = t.roofShape[i];
  if (kind === RoofBuild.REVOLVE) {
    const c = areaCentroid(t.xz, s, e, _cen);
    revolve(B, pts, c.x, c.z, y, R, profileOf(shape));
    return;
  }
  const n = pts.length;
  const f = roofFrame(t.xz, s, e, t.roofDir[i], newRoofFrame());
  const P: number[] = [];
  const np = roofPlanes(shape, f.s0, f.s1, f.t0, f.t1, R, P);
  if (np === 0) return;
  const { cx, cz, Sx, Sz, Dx, Dz } = f;
  const st: number[] = [];
  const ring: number[] = [];
  for (const p of pts) {
    st.push((p[0] - cx) * Sx + (p[1] - cz) * Sz, (p[0] - cx) * Dx + (p[1] - cz) * Dz);
    ring.push(p[0], p[1]);
  }
  const H = (ss: number, tt: number) => {
    let h = Infinity;
    for (let k = 0; k < np; k++) h = Math.min(h, P[k * 3] * ss + P[k * 3 + 1] * tt + P[k * 3 + 2]);
    return Math.max(0, h);
  };
  // the footprint's convex pieces, in (s, t)
  const pieces: number[][] = [];
  if (ringConvex(ring)) pieces.push(st);
  else {
    for (const loop of convexPieces(ring)) {
      const piece: number[] = [];
      for (const v of loop) piece.push(st[v * 2], st[v * 2 + 1]);
      pieces.push(piece);
    }
  }
  // the faces: each plane where it is the lowest (a plane equal to an earlier one has no face of its own)
  const X: number[] = [], V: number[] = [];
  for (let k = 0; k < np; k++) {
    const a = P[k * 3], b = P[k * 3 + 1], c0 = P[k * 3 + 2];
    let dup = false;
    for (let j = 0; j < k; j++) if (Math.abs(a - P[j * 3]) < 1e-9 && Math.abs(b - P[j * 3 + 1]) < 1e-9 && Math.abs(c0 - P[j * 3 + 2]) < 1e-9) dup = true;
    if (dup) continue;
    const hx = a * Sx + b * Dx, hz = a * Sz + b * Dz;
    const nl = Math.hypot(hx, 1, hz);
    const part = Math.hypot(hx, hz) > 0.12 ? Part.ROOF_SLOPE : Part.ROOF;
    // (one face's pieces share their vertices where they meet)
    const at = new Map<number, number>();
    for (const piece of pieces) {
      let poly = piece;
      for (let j = 0; j < np && poly.length >= 6; j++) {
        if (j !== k) poly = clipHalf(poly, a - P[j * 3], b - P[j * 3 + 1], c0 - P[j * 3 + 2]);
      }
      const m = poly.length / 2;
      if (m < 3) continue;
      X.length = 0;
      for (let q = 0; q < m; q++) X.push(cx + poly[q * 2] * Sx + poly[q * 2 + 1] * Dx, cz + poly[q * 2] * Sz + poly[q * 2 + 1] * Dz);
      let a2 = 0;
      for (let q = 0; q < m; q++) {
        const q2 = (q + 1) % m;
        a2 += (X[q * 2] - cx) * (X[q2 * 2 + 1] - cz) - (X[q2 * 2] - cx) * (X[q * 2 + 1] - cz);
      }
      if (Math.abs(a2) < 1e-6) continue;
      V.length = 0;
      for (let q = 0; q < m; q++) {
        const key = Math.round((X[q * 2] - cx) * 1e4) * 1e8 + Math.round((X[q * 2 + 1] - cz) * 1e4);
        let vi = at.get(key);
        if (vi === undefined) {
          const h = Math.max(0, a * poly[q * 2] + b * poly[q * 2 + 1] + c0);
          vi = B.vert(X[q * 2], y + h, X[q * 2 + 1], -hx / nl, 1 / nl, -hz / nl, X[q * 2], X[q * 2 + 1], part);
          at.set(key, vi);
        }
        V.push(vi);
      }
      // (a convex piece: a fan; CCW in (x, z) with +z south faces up with the winding reversed)
      for (let q = 1; q + 1 < m; q++) {
        if (V[q] === V[0] || V[q + 1] === V[0] || V[q] === V[q + 1]) continue;
        if (a2 > 0) B.idx.push(V[0], V[q + 1], V[q]);
        else B.idx.push(V[0], V[q], V[q + 1]);
      }
    }
  }
  // the walls above the eave: wherever the roof meets an outer wall above the eave (gable ends). The roof's
  // height along an edge is the same min of planes whatever the ring's shape, so concave rings close too.
  let u = 0;
  const us: number[] = [];
  for (let j = 0; j < n; j++) {
    const k = (startK + j) % n, k2 = (k + 1) % n;
    const ax = pts[k][0], az = pts[k][1], bx = pts[k2][0], bz = pts[k2][1];
    const L2 = Math.hypot(bx - ax, bz - az);
    if (L2 < 0.05) {
      u += L2;
      continue;
    }
    const sa = st[k * 2], ta = st[k * 2 + 1], sb = st[k2 * 2], tb = st[k2 * 2 + 1];
    us.length = 0;
    us.push(0, 1);
    for (let p = 0; p < np; p++)
      for (let q = p + 1; q < np; q++) {
        const da = (P[p * 3] - P[q * 3]) * sa + (P[p * 3 + 1] - P[q * 3 + 1]) * ta + (P[p * 3 + 2] - P[q * 3 + 2]);
        const db = (P[p * 3] - P[q * 3]) * sb + (P[p * 3 + 1] - P[q * 3 + 1]) * tb + (P[p * 3 + 2] - P[q * 3 + 2]);
        if (da * db < 0) us.push(da / (da - db));
      }
    // (and where the roof leaves the eave: a plane crossing zero)
    for (let p = 0; p < np; p++) {
      const da = P[p * 3] * sa + P[p * 3 + 1] * ta + P[p * 3 + 2], db = P[p * 3] * sb + P[p * 3 + 1] * tb + P[p * 3 + 2];
      if (da * db < 0) us.push(da / (da - db));
    }
    us.sort((x, z) => x - z);
    const isFront = k === front || k === front2;
    const part = isFront ? Part.FRONT : Part.SIDE;
    const flags = (isFront ? 1 : 0) | corner;
    const want: V3 = [(bz - az) / L2, 0, -(bx - ax) / L2];
    for (let q = 0; q + 1 < us.length; q++) {
      const u0 = us[q], u1 = us[q + 1];
      if (u1 - u0 < 1e-4) continue;
      const h0 = H(sa + (sb - sa) * u0, ta + (tb - ta) * u0), h1 = H(sa + (sb - sa) * u1, ta + (tb - ta) * u1);
      if (Math.max(h0, h1) < 0.03) continue;
      const p0x = ax + (bx - ax) * u0, p0z = az + (bz - az) * u0, p1x = ax + (bx - ax) * u1, p1z = az + (bz - az) * u1;
      const fu0 = u + L2 * u0, fu1 = u + L2 * u1, v0 = y - streetY;
      if (h0 > 0.03 && h1 > 0.03) {
        B.quadF([p0x, y, p0z], [p1x, y, p1z], [p1x, y + h1, p1z], [p0x, y + h0, p0z], [fu0, v0, fu1, v0, fu1, v0 + h1, fu0, v0 + h0], part, want, flags);
      } else if (h1 > 0.03) {
        B.triF([p0x, y, p0z], [p1x, y, p1z], [p1x, y + h1, p1z], [fu0, v0, fu1, v0, fu1, v0 + h1], part, want, flags);
      } else {
        B.triF([p0x, y, p0z], [p1x, y, p1z], [p0x, y + h0, p0z], [fu0, v0, fu1, v0, fu0, v0 + h0], part, want, flags);
      }
    }
    u += L2;
  }
}

/** A roof of revolution: the ring scaled toward (cx, cz) (its area centroid) by profile[j][0] at y + R * profile[j][1]. */
function revolve(B: Builder, pts: Array<[number, number]>, cx: number, cz: number, y: number, R: number, profile: ReadonlyArray<readonly [number, number]>) {
  const n = pts.length;
  const P = (k: number, j: number): V3 => {
    const sg = profile[j][0];
    return [cx + (pts[k % n][0] - cx) * sg, y + R * profile[j][1], cz + (pts[k % n][1] - cz) * sg];
  };
  for (let j = 0; j + 1 < profile.length; j++) {
    for (let k = 0; k < n; k++) {
      const mx = (pts[k][0] + pts[(k + 1) % n][0]) / 2 - cx, mz = (pts[k][1] + pts[(k + 1) % n][1]) / 2 - cz;
      const ml = Math.hypot(mx, mz) || 1;
      const want: V3 = [mx / ml, 0.35, mz / ml];
      const a = P(k, j), b = P(k + 1, j), c = P(k + 1, j + 1), d = P(k, j + 1);
      if (profile[j + 1][0] <= 1e-6) B.triF(a, b, c, [0, 0, 1, 0, 0.5, 1], Part.ROOF_SLOPE, want);
      else B.quadF(a, b, c, d, [0, 0, 1, 0, 1, 1, 0, 1], Part.ROOF_SLOPE, want);
    }
  }
}
