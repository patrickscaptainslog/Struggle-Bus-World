// One sky model, from a street to the Moon (SKY.md section 2, research-astro.md section 4). Pure TS, doubles, no three.js, and nothing allocates after construction: `frame()` runs every
// render frame. It knows nothing about latitude, poles, floating origin or tiles: an Observer says where it is and how the render frame lies (WorldFrame.ts, or flight).
//
//   EQJ     J2000 mean equator, km, origin Earth's centre: bodies and stars live here
//   Fixed   turns with the body (ITRF-like for Earth, IAU for the Moon), km, origin that body's centre: observer truth
//   Render  a rotation only, +X east, +Y up, +Z south in the city frame; anything flight likes out in space. Float32 from here on, uploaded by SkyDraw.ts
//
// Tested against JPL Horizons as the prototype (shots/local/sky/work/sky-scripts/sky-proto.mjs); tools/sky/fixtures.mjs runs research-astro.md's five fixtures through this file.

export const EARTH = 0;
export const MOON = 1;
export type BodyId = typeof EARTH | typeof MOON;

export const R_MOON = 1737.4;
export const R_SUN = 695700;
/** WGS84: the ellipsoid the resolve's ray test uses. */
export const R_EARTH_A = 6378.137;
export const R_EARTH_B = 6378.137 * (1 - 1 / 298.257223563);
/** Earth's shadow at the Moon uses astronomy-engine's constant: 6,371 km plus 88 km of air. */
const R_SHADOW = 6459;

const DEG = Math.PI / 180;

/** The only code that touches an ephemeris (Series.ts). */
export interface Series {
  /** km, geocentric */
  moonEqj(ms: number, o: Float64Array): void;
  /** km, apparent: -Earth(t - light time) */
  sunEqj(ms: number, o: Float64Array): void;
  /** mat3 by rows, fixed <- EQJ: Rz(GAST) * nutation * precession */
  earthFix(ms: number, o: Float64Array): void;
  /** IAU alpha0, delta0, W, degrees */
  moonAxis(ms: number, o: Float64Array): void;
}

export interface Observer {
  /** whose frame pos and axes are in */
  body: BodyId;
  /** false: that body's fixed frame. true: EQJ, from that body's centre (open-space flight) */
  free: boolean;
  /** km, float64 truth */
  pos: Float64Array;
  /** mat3 by rows: render X, Y, Z in that frame */
  axes: Float64Array;
}

/**
 * The radius the Moon is drawn at, km (SKY.md 4.5): a far Moon never goes under `floorPx` game px across, on a soft max, so the floor hands over to its true size with no kink in the disc's size on screen.
 * `elong`, the degrees from the Sun, releases the floor there: an eclipse must be exact, and it's under 0.27 % lit. Near, the floor adds nothing: 2 cm at 300 km.
 */
export function moonDrawnKm(moonKm: number, focal: number, floorPx: number, elong: number): number {
  const t = Math.min(1, Math.max(0, (elong - 6) / 6)), f = ((0.5 * floorPx * moonKm) / focal) * t * t * (3 - 2 * t);
  return Math.sqrt(Math.sqrt(R_MOON * R_MOON * R_MOON * R_MOON + f * f * f * f));
}

/** Overwritten in place by frame(), read by the uniform uploader. */
export class SkyState {
  /** unit vectors, render frame */
  readonly sun = new Float64Array(3);
  readonly moon = new Float64Array(3);
  readonly earth = new Float64Array(3);
  /** km from the observer */
  sunKm = 0;
  moonKm = 0;
  earthKm = 0;
  /** angular radius, radians */
  sunR = 0;
  moonR = 0;
  earthR = 0;
  /** render <- EQJ */
  readonly starRot = new Float64Array(9);
  /** render <- body fixed, for map lookups */
  readonly moonRot = new Float64Array(9);
  readonly earthRot = new Float64Array(9);
  /** illuminated fraction seen from here */
  moonLit = 0;
  earthLit = 0;
  /** Earth's lit fraction seen from the Moon: what earthshine follows */
  earthLitAtMoon = 0;
  /** 0..1 after Moon and Earth cover the Sun */
  sunSeen = 1;
  /** at the Moon, km: axis offset, umbra radius, penumbra radius */
  readonly shadow = new Float64Array(3);
  /** the observer from each body's centre, in its fixed frame, km: the ray tests' origins */
  readonly earthO = new Float64Array(3);
  readonly moonO = new Float64Array(3);
  /** unit, in each body's fixed frame: the Sun from it, and Earth from the Moon */
  readonly earthSun = new Float64Array(3);
  readonly moonSun = new Float64Array(3);
  readonly moonEarth = new Float64Array(3);
}

type M = Float64Array;

/** o = a * b, by rows. o is not a or b. */
function mul33(a: M, b: M, o: M): void {
  for (let i = 0; i < 9; i += 3) {
    const x = a[i], y = a[i + 1], z = a[i + 2];
    o[i] = x * b[0] + y * b[3] + z * b[6];
    o[i + 1] = x * b[1] + y * b[4] + z * b[7];
    o[i + 2] = x * b[2] + y * b[5] + z * b[8];
  }
}
/** o = a * transpose(b). o is not a or b. */
function mulT33(a: M, b: M, o: M): void {
  for (let i = 0; i < 9; i += 3) {
    const x = a[i], y = a[i + 1], z = a[i + 2];
    o[i] = x * b[0] + y * b[1] + z * b[2];
    o[i + 1] = x * b[3] + y * b[4] + z * b[5];
    o[i + 2] = x * b[6] + y * b[7] + z * b[8];
  }
}
/** o = a * v */
function rmul3(a: M, x: number, y: number, z: number, o: M): void {
  o[0] = a[0] * x + a[1] * y + a[2] * z;
  o[1] = a[3] * x + a[4] * y + a[5] * z;
  o[2] = a[6] * x + a[7] * y + a[8] * z;
}
/** o = transpose(a) * v */
function tmul3(a: M, v: M, o: M): void {
  const x = v[0], y = v[1], z = v[2];
  o[0] = a[0] * x + a[3] * y + a[6] * z;
  o[1] = a[1] * x + a[4] * y + a[7] * z;
  o[2] = a[2] * x + a[5] * y + a[8] * z;
}
const safeAsin = (x: number) => (x < 1 ? Math.asin(x) : Math.PI / 2);

/** Unit vector from `from` to (tx, ty, tz) through `rot` into `o`; returns the distance. Subtract in EQJ doubles, normalise, rotate. */
function toward(tx: number, ty: number, tz: number, from: M, rot: M, o: M): number {
  const dx = tx - from[0], dy = ty - from[1], dz = tz - from[2], km = Math.sqrt(dx * dx + dy * dy + dz * dz);
  rmul3(rot, dx / km, dy / km, dz / km, o);
  return km;
}

/** How much of disc a (angular radius ra) disc b covers, 0..1, by area. */
function cover(a: M, ra: number, b: M, rb: number): number {
  const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
  const d = Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  if (d >= ra + rb) return 0;
  if (d <= rb - ra) return 1;
  if (d <= ra - rb) return (rb * rb) / (ra * ra);
  const ka = Math.acos((d * d + ra * ra - rb * rb) / (2 * d * ra)), kb = Math.acos((d * d + rb * rb - ra * ra) / (2 * d * rb));
  const lens = ra * ra * ka + rb * rb * kb - 0.5 * Math.sqrt(Math.max(0, (-d + ra + rb) * (d + ra - rb) * (d - ra + rb) * (d + ra + rb)));
  return lens / (Math.PI * ra * ra);
}

export class SkyModel {
  private readonly series: Series;
  private readonly stepMs: number;
  private t0 = NaN;
  private t1 = NaN;
  private readonly m0 = new Float64Array(3);
  private readonly m1 = new Float64Array(3);
  private readonly s0 = new Float64Array(3);
  private readonly s1 = new Float64Array(3);
  private readonly e0 = new Float64Array(9);
  private readonly e1 = new Float64Array(9);
  private readonly a0 = new Float64Array(3);
  private readonly a1 = new Float64Array(3);
  /** this frame, EQJ km: the Moon, the Sun (both from Earth's centre), the observer */
  readonly moonEqj = new Float64Array(3);
  readonly sunEqj = new Float64Array(3);
  readonly obsEqj = new Float64Array(3);
  /** this frame, fixed <- EQJ */
  readonly earthFix = new Float64Array(9);
  readonly moonFix = new Float64Array(9);

  /** stepS: sim seconds between series evaluations, linear between. 60 s: error 1e-8 degrees (research-astro.md 4). */
  constructor(series: Series, stepS = 60) {
    this.series = series;
    this.stepMs = stepS * 1000;
  }

  /** Series evaluation, off the frame path: only when ms leaves [t0, t1). */
  private advance(ms: number): void {
    const s = this.series, step = this.stepMs;
    const k = Math.floor(ms / step) * step;
    if (k === this.t1) {
      this.t0 = this.t1;
      this.m0.set(this.m1);
      this.s0.set(this.s1);
      this.e0.set(this.e1);
      this.a0.set(this.a1);
    } else if (k !== this.t0) {
      this.t0 = k;
      s.moonEqj(k, this.m0);
      s.sunEqj(k, this.s0);
      s.earthFix(k, this.e0);
      s.moonAxis(k, this.a0);
    }
    this.t1 = k + step;
    s.moonEqj(this.t1, this.m1);
    s.sunEqj(this.t1, this.s1);
    s.earthFix(this.t1, this.e1);
    s.moonAxis(this.t1, this.a1);
  }

  /** Earth's fixed <- EQJ spins fast: interpolate the spin angle, never the matrix's elements. e1 = Rz(d) * e0 to high accuracy over one step. */
  private lerpEarth(u: number): void {
    const e0 = this.e0, e1 = this.e1, t = this.earthFix;
    const d = Math.atan2(e1[0] * e0[3] + e1[1] * e0[4] + e1[2] * e0[5], e1[0] * e0[0] + e1[1] * e0[1] + e1[2] * e0[2]);
    const a = d * u, ca = Math.cos(a), sa = Math.sin(a);
    t[0] = ca * e0[0] + sa * e0[3];
    t[1] = ca * e0[1] + sa * e0[4];
    t[2] = ca * e0[2] + sa * e0[5];
    t[3] = -sa * e0[0] + ca * e0[3];
    t[4] = -sa * e0[1] + ca * e0[4];
    t[5] = -sa * e0[2] + ca * e0[5];
    t[6] = e0[6];
    t[7] = e0[7];
    t[8] = e0[8];
  }

  /** fixed <- EQJ = Rz(W) Rx(90 - d0) Rz(a0 + 90): pole p = (cd ca, cd sa, sd), node n = (-sa, ca, 0), third q = p x n. */
  private moonFixFrom(a0: number, d0: number, w: number): void {
    const ca = Math.cos(a0), sa = Math.sin(a0), cd = Math.cos(d0), sd = Math.sin(d0), cw = Math.cos(w), sw = Math.sin(w), m = this.moonFix;
    const nx = -sa, ny = ca, qx = -sd * ca, qy = -sd * sa, qz = cd;
    m[0] = cw * nx + sw * qx;
    m[1] = cw * ny + sw * qy;
    m[2] = sw * qz;
    m[3] = -sw * nx + cw * qx;
    m[4] = -sw * ny + cw * qy;
    m[5] = cw * qz;
    m[6] = cd * ca;
    m[7] = cd * sa;
    m[8] = sd;
  }

  /** Lit fraction of a sphere at b seen from the observer: (1 + cos(angle at the body between observer and Sun)) / 2. */
  private lit(bx: number, by: number, bz: number, ox: number, oy: number, oz: number): number {
    const s = this.sunEqj;
    const ax = ox - bx, ay = oy - by, az = oz - bz, cx = s[0] - bx, cy = s[1] - by, cz = s[2] - bz;
    return (1 + (ax * cx + ay * cy + az * cz) / Math.sqrt((ax * ax + ay * ay + az * az) * (cx * cx + cy * cy + cz * cz))) / 2;
  }

  frame(ms: number, ob: Observer, s: SkyState): void {
    if (!(ms >= this.t0 && ms < this.t1)) this.advance(ms);
    const u = (ms - this.t0) / this.stepMs, v = 1 - u;
    const me = this.moonEqj, se = this.sunEqj, o = this.obsEqj;
    for (let i = 0; i < 3; i++) {
      me[i] = v * this.m0[i] + u * this.m1[i];
      se[i] = v * this.s0[i] + u * this.s1[i];
    }
    this.lerpEarth(u);
    this.moonFixFrom((v * this.a0[0] + u * this.a1[0]) * DEG, (v * this.a0[1] + u * this.a1[1]) * DEG, (v * this.a0[2] + u * this.a1[2]) * DEG);

    const fix = ob.body === EARTH ? this.earthFix : this.moonFix;
    if (ob.free) {
      o.set(ob.pos);
      s.starRot.set(ob.axes);
    } else {
      tmul3(fix, ob.pos, o);
      mul33(ob.axes, fix, s.starRot);
    }
    if (ob.body === MOON) {
      o[0] += me[0];
      o[1] += me[1];
      o[2] += me[2];
    }

    const rot = s.starRot;
    s.sunKm = toward(se[0], se[1], se[2], o, rot, s.sun);
    s.moonKm = toward(me[0], me[1], me[2], o, rot, s.moon);
    s.earthKm = toward(0, 0, 0, o, rot, s.earth);
    s.sunR = Math.asin(R_SUN / s.sunKm);
    s.moonR = safeAsin(R_MOON / s.moonKm);
    s.earthR = safeAsin(R_EARTH_A / s.earthKm);

    s.moonLit = this.lit(me[0], me[1], me[2], o[0], o[1], o[2]);
    s.earthLit = this.lit(0, 0, 0, o[0], o[1], o[2]);
    s.earthLitAtMoon = this.lit(0, 0, 0, me[0], me[1], me[2]);
    s.sunSeen = 1 - Math.max(cover(s.sun, s.sunR, s.moon, s.moonR), cover(s.sun, s.sunR, s.earth, s.earthR));

    mulT33(rot, this.moonFix, s.moonRot);
    mulT33(rot, this.earthFix, s.earthRot);

    // the ray tests' origins, and the light in each body's own frame
    rmul3(this.earthFix, o[0], o[1], o[2], s.earthO);
    rmul3(this.moonFix, o[0] - me[0], o[1] - me[1], o[2] - me[2], s.moonO);
    const sl = Math.sqrt(se[0] * se[0] + se[1] * se[1] + se[2] * se[2]);
    rmul3(this.earthFix, se[0] / sl, se[1] / sl, se[2] / sl, s.earthSun);
    const dx = se[0] - me[0], dy = se[1] - me[1], dz = se[2] - me[2], dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    rmul3(this.moonFix, dx / dl, dy / dl, dz / dl, s.moonSun);
    const ml = Math.sqrt(me[0] * me[0] + me[1] * me[1] + me[2] * me[2]);
    rmul3(this.moonFix, -me[0] / ml, -me[1] / ml, -me[2] / ml, s.moonEarth);
    this.shadowAtMoon(ml, sl, s.shadow);
  }

  /** Earth's shadow where the Moon crosses it: the axis's offset from the Moon's centre, and the umbra's and penumbra's radii there (km). */
  private shadowAtMoon(ml: number, sl: number, o: Float64Array): void {
    const me = this.moonEqj, se = this.sunEqj;
    // the anti-solar axis, from Earth's centre
    const ax = -se[0] / sl, ay = -se[1] / sl, az = -se[2] / sl;
    const along = me[0] * ax + me[1] * ay + me[2] * az;
    o[0] = Math.sqrt(Math.max(0, ml * ml - along * along));
    const slope = (R_SUN - R_SHADOW) / sl, slopeP = (R_SUN + R_SHADOW) / sl;
    o[1] = R_SHADOW - along * slope;
    o[2] = R_SHADOW + along * slopeP;
  }
}

/** Handover from one body to the other: the same point in space, a new home. Nothing on screen changes. Reads the last frame(). */
export function rebaseBody(ob: Observer, to: BodyId, m: SkyModel): void {
  if (ob.body === to) return;
  const p = ob.pos, o = m.obsEqj;
  for (let i = 0; i < 3; i++) p[i] = o[i] - (to === MOON ? m.moonEqj[i] : 0);
  if (!ob.free) {
    const from = ob.body === EARTH ? m.earthFix : m.moonFix, into = to === EARTH ? m.earthFix : m.moonFix;
    const ax = new Float64Array(9);
    mul33(ob.axes, from, ax);
    mulT33(ax, into, ob.axes);
    rmul3(into, p[0], p[1], p[2], p);
  }
  ob.body = to;
}
