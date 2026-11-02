// The Moon as a place the game can load: one generator, deterministic from a position and a seed, which writes what the game already reads. No three.js and no DOM: it runs in the worker
// (moonWorker.ts) and under Node (tools/moon/*). Nothing of a place is stored but the relief, one window of real heights and the names: bytes on the wire stay small.
//
// What it stacks, big to small (raster() walks them in this order, world-aligned, so two rasters over the same ground agree wherever they meet):
//   1. the relief, bicubic (MoonKit's LDEM 4 ppd, a texel every 7.6 km at the equator);
//   2. the named places, each a proper shape at its true place and size; inside the Theophilus window the real heights, blended out at its edges;
//   3. invented hills, on highlands far more than on maria (the albedo map says which);
//   4. the invented craters, a power law from 5 km down (craters.ts), stamped into the raster, with their rims and light ejecta.
//
// What a raster becomes: heights, and a map of four bytes a texel: two slopes, the tone, and the signed distance of the sunlight's edge. That last one is a sweep along the Sun's azimuth: at any texel it
// knows the highest line of sunlight that upstream ground lets through, so one number says lit or not and by how much, and a filtered read gives a clean contour at any size, the way a font's distance field does.
// The Sun is held, so it is baked. Between them they carry the whole look: a ground mesh only has to stand in the right place.

import { Age, DMAX, OCTAVES, REACH, eachCrater, mareOf, mix32, octaveD, type Crater } from './craters';
import { R_M, cubicAt, catmull, dirOf, latOf, linearAt, lonOf, mapOf, windowAt, type MapFrame, type Place, type WholeMap, type WindowMap } from './map';

export interface MoonSource {
  relief: WholeMap;
  albedo: WholeMap;
  window: WindowMap | null;
  places: Place[];
}

/** Toward the Sun in the map's frame: a unit vector along the ground, and its rise per metre. */
export interface SunLine {
  ax: number;
  az: number;
  tanE: number;
}

export const sunLine = (x: number, y: number, z: number): SunLine => {
  const l = Math.hypot(x, z) || 1;
  return { ax: x / l, az: z / l, tanE: y / l };
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- crater profiles: height in crater diameters against the distance from the centre in radii, by squared distance so a stamp needs no root

const LUT_N = 1024;
const LUT_K = (LUT_N - 1) / (REACH * REACH);

function table(fn: (r: number) => number): Float32Array {
  const t = new Float32Array(LUT_N + 2);
  for (let i = 0; i <= LUT_N + 1; i++) t[i] = fn(Math.sqrt(Math.min(i, LUT_N - 1) / LUT_K));
  return t;
}

/** depth and rim in diameters, the floor's edge and the wall's top in radii, the rim's width in radii, and where the stamp ends (radii): it is exactly nought there, or a stamp's box would show. */
const bowl = (depth: number, rim: number, r0: number, r1: number, w: number, end: number) => (r: number) => {
  if (r >= end) return 0;
  const d = (r - 1) / w, q = r <= 1 ? 1 : (r ** -3.2 - end ** -3.2) / (1 - end ** -3.2);
  const edge = smooth(end, end * 0.72, r);
  return -depth * (1 - smooth(r0, r1, r)) + rim * (Math.exp(-d * d) * 0.62 * edge + 0.38 * q);
};

const PROFILE: Float32Array[] = [
  table(bowl(0.27, 0.06, 0.1, 0.98, 0.1, REACH)), // fresh
  table(bowl(0.23, 0.045, 0.14, 1.0, 0.13, 2.3)), // plain
  table(bowl(0.16, 0.024, 0.22, 1.04, 0.2, 1.9)), // old
  table(bowl(0.07, 0.008, 0.32, 1.14, 0.38, 1.7)), // a ghost
];
/** The bright of a fresh crater, what its ejecta throws: inside it the wall is fresh too. */
const EJECTA = table((r) => (r < 1 ? 0.7 : Math.max(0, (r ** -2.4 - REACH ** -2.4) / (1 - REACH ** -2.4))));
/** How much tone each age takes from EJECTA. Old ground has weathered dark. */
const AGE_TONE = [0.46, 0.06, -0.02, -0.035];
/** A stamp's reach by age (radii): only the fresh throw far. */
const AGE_REACH = [REACH, 2.3, 1.9, 1.7];
/** Craters this much under a raster's cell are not its business (diameters in cells). */
const MIN_D_CELLS = 2.6;

/** Into a height raster at (x0, z0) with this cell. `T` is its tone, the same size. */
function stampCrater(H: Float32Array, T: Float32Array, W: number, Hh: number, x0: number, z0: number, cell: number, cx: number, cz: number, r: number, age: Age, a: number, b: number, c: number): void {
  const reach = AGE_REACH[age] * r * 1.12;
  const i0 = Math.max(0, Math.ceil((cx - reach - x0) / cell)), i1 = Math.min(W - 1, Math.floor((cx + reach - x0) / cell));
  const j0 = Math.max(0, Math.ceil((cz - reach - z0) / cell)), j1 = Math.min(Hh - 1, Math.floor((cz + reach - z0) / cell));
  if (i0 > i1 || j0 > j1) return;
  const P = PROFILE[age], D = 2 * r, inv = 1 / (r * r), lim = REACH * REACH;
  const toneK = AGE_TONE[age] * (age === Age.Fresh ? 0.7 + 0.6 * c : 1);
  // a slight squash along a hashed direction: nothing out here is a perfect circle
  const th = a * Math.PI, sq = 1 + 0.16 * (b - 0.5), cth = Math.cos(th) * sq, sth = Math.sin(th) * sq, cth2 = Math.cos(th) / sq, sth2 = Math.sin(th) / sq;
  // (and from a bus's length up its rim wanders, in the harmonics a real one does)
  const rays = age === Age.Fresh && r > 40;
  const wobbly = r > 14, p1 = 0.05 * Math.cos(c * 40), p2 = 0.05 * Math.sin(c * 40), p3 = 0.03 * Math.cos(c * 91), p4 = 0.03 * Math.sin(c * 91);
  for (let j = j0; j <= j1; j++) {
    const dz = z0 + j * cell - cz;
    let k = j * W + i0;
    for (let i = i0; i <= i1; i++, k++) {
      const dx = x0 + i * cell - cx;
      const u = dx * cth + dz * sth, v = dz * cth2 - dx * sth2;
      let d2 = (u * u + v * v) * inv;
      if (d2 >= lim) continue;
      if (wobbly && d2 > 0.05 && d2 < 2.6) {
        const rr = Math.sqrt(u * u + v * v), cs = u / rr, sn = v / rr;
        const c2 = cs * cs - sn * sn, s2 = 2 * cs * sn, c3 = c2 * cs - s2 * sn, s3 = s2 * cs + c2 * sn, c5 = c3 * c2 - s3 * s2, s5 = s3 * c2 + c3 * s2;
        const w = 1 + c3 * p1 + s3 * p2 + c5 * p3 + s5 * p4;
        d2 /= w * w;
      }
      const t = d2 * LUT_K, q = t | 0, f = t - q;
      H[k] += (P[q] + (P[q + 1] - P[q]) * f) * D;
      let e = (EJECTA[q] + (EJECTA[q + 1] - EJECTA[q]) * f) * toneK;
      // (a fresh crater of any size throws rays: thin, bright, by a stable angle)
      if (rays && d2 > 1) {
        const rr = Math.sqrt(u * u + v * v), cs = u / rr, sn = v / rr, ang = (sn < 0 ? -1 : 1) * (1.5708 - cs * (1 + 0.2146 * cs * cs)); // (an arc-cosine's quick stand-in: rays don't need the real one)
        const ray = Math.sin(ang * 7 + c * 20) + Math.sin(ang * 13 + a * 20) + 0.6 * Math.sin(ang * 29 + b * 20);
        e *= ray > 0.75 ? 2.4 : 0.55;
      }
      T[k] += e;
    }
  }
}

// ---- noise: a value noise over the 3D lattice, so it has no seams and no idea which way is north

const lat3 = (i: number, j: number, k: number, s: number) => mix32(Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791) ^ s) / 4294967296;

function noise3(x: number, y: number, z: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = lat3(ix, iy, iz, s), b = lat3(ix + 1, iy, iz, s), c = lat3(ix, iy + 1, iz, s), d = lat3(ix + 1, iy + 1, iz, s);
  const e = lat3(ix, iy, iz + 1, s), f = lat3(ix + 1, iy, iz + 1, s), g = lat3(ix, iy + 1, iz + 1, s), h = lat3(ix + 1, iy + 1, iz + 1, s);
  const p = a + (b - a) * ux, q = c + (d - c) * ux, r = e + (f - e) * ux, t = g + (h - g) * ux;
  const m = p + (q - p) * uy, n = r + (t - r) * uy;
  return m + (n - m) * uz;
}

/** Hills: wavelengths (m) and heights (m). Highlands take all of it, maria a tenth, and inside the real window the long ones go. */
const HILLS: Array<[number, number]> = [
  [16000, 150], [8000, 110], [4000, 90], [2000, 70], [1000, 48], [500, 26], [250, 13], [125, 5],
];

// ---- the named places

const enum Kind {
  Complex,
  Massif,
  Range,
  Line,
}

interface Big {
  p: Place;
  kind: Kind;
  /** how far out it touches the ground, in its radii */
  reach: number;
  // a complex crater: the surroundings' level, its floor under that, the rim over it
  base: number;
  floorY: number;
  rimH: number;
  terraces: number;
  peakH: number;
  /** peaks: x, z (radii from the centre), radius (radii), height share */
  peaks: number[];
  ph: number[];
  /** a line: along, across, half length and half width (m), depth (m, under 0: a step down to the east of it) */
  tx: number;
  ty: number;
  tz: number;
  sx: number;
  sy: number;
  sz: number;
  L: number;
  W: number;
  d: number;
}

const blank = (p: Place, kind: Kind, reach: number): Big => ({ p, kind, reach, base: 0, floorY: 0, rimH: 0, terraces: 0, peakH: 0, peaks: [], ph: [], tx: 0, ty: 0, tz: 0, sx: 0, sy: 0, sz: 0, L: 0, W: 0, d: 0 });

const dirTmp = new Float64Array(3);
const mapTmp = new Float64Array(2);

export class MoonGen {
  readonly frame: MapFrame;
  /** World Y = height over the sphere - datum: every height on the map is over nothing the game treats as a floor or as water. */
  datum = 0;
  private readonly bigs: Big[] = [];
  /** named craters small enough to be stamped like the invented ones */
  private readonly named: Array<{ p: Place; x: number; z: number }> = [];
  private readonly win = { h: 0, w: 0 };
  private readonly d = new Float64Array(3);
  private active: Big[] = [];

  constructor(readonly src: MoonSource, frame: MapFrame, readonly sun: SunLine, readonly seed: number, bounds: readonly number[]) {
    this.frame = frame;
    for (const p of src.places) {
      if (p.type === 'crater') {
        if (p.km >= 20) this.bigs.push(this.complex(p));
        else {
          mapOf(frame, p.d[0], p.d[1], p.d[2], mapTmp);
          this.named.push({ p, x: mapTmp[0], z: mapTmp[1] });
        }
      } else if (p.type === 'mountains') {
        if (p.az !== null && p.name === 'STRAIGHT WALL') this.bigs.push(this.line(p, 1200, -320));
        else if (p.name === 'ALTAI SCARP') continue;
        else this.bigs.push(blank(p, p.km < 130 ? Kind.Massif : Kind.Range, 1));
      } else if (p.type === 'valley' && p.az !== null) {
        const wide = p.km > 150 && p.name.includes('VALLEY');
        this.bigs.push(this.line(p, wide ? 5000 : 800, wide ? 900 : 260));
      }
    }
    // (the lowest ground on the map, and room under it for what the places and the craters dig)
    let low = Infinity;
    const d = this.d;
    const [x0, z0, x1, z1] = bounds;
    for (let j = 0; j <= 32; j++)
      for (let i = 0; i <= 32; i++) {
        dirOf(frame, x0 + ((x1 - x0) * i) / 32, z0 + ((z1 - z0) * j) / 32, d);
        low = Math.min(low, cubicAt(src.relief, latOf(d), lonOf(d)));
      }
    this.datum = Math.floor(low - 2000);
  }

  /** Measures a big crater off the relief and sets out its shape. */
  private complex(p: Place): Big {
    const b = blank(p, Kind.Complex, 1.75);
    const km = p.km, rel = this.src.relief;
    const ring = (rr: number) => {
      let s = 0;
      for (let i = 0; i < 16; i++) {
        const th = (i / 16) * Math.PI * 2, a = (rr * p.R) / R_M, ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(th), sn = Math.sin(th);
        for (let k = 0; k < 3; k++) dirTmp[k] = ca * p.d[k] + sa * (ce * p.e[k] + sn * p.n[k]);
        s += cubicAt(rel, latOf(dirTmp), lonOf(dirTmp));
      }
      return s / 16;
    };
    b.base = ring(1.65);
    const floor0 = (cubicAt(rel, p.lat, p.lon) + ring(0.3)) / 2;
    // Pike's numbers for fresh lunar craters, in km; the relief's own floor where it has seen one deeper
    const pike = km < 15 ? 0.196 * km ** 1.01 : 1.044 * km ** 0.301;
    b.rimH = 236 * km ** 0.399;
    const depth = Math.max(pike * 1000 * 0.85, b.base + b.rimH - floor0);
    b.floorY = b.base + b.rimH - depth;
    b.terraces = Math.round(2 + km / 30);
    let h = mix32(p.id + 77 + this.seed);
    const r = () => (h = mix32(h + 1)) / 4294967296;
    for (let i = 0; i < 6; i++) b.ph.push(r() * 6.283);
    if (km >= 32) {
      b.peakH = depth * 0.38;
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) b.peaks.push((r() - 0.5) * 0.24, (r() - 0.5) * 0.24, 0.05 + 0.08 * r(), 0.45 + 0.55 * r());
    }
    return b;
  }

  private line(p: Place, width: number, depth: number): Big {
    const b = blank(p, Kind.Line, 1.1);
    const a = ((p.az ?? 0) * Math.PI) / 180, sa = Math.sin(a), ca = Math.cos(a);
    b.tx = sa * p.e[0] + ca * p.n[0];
    b.ty = sa * p.e[1] + ca * p.n[1];
    b.tz = sa * p.e[2] + ca * p.n[2];
    b.sx = ca * p.e[0] - sa * p.n[0];
    b.sy = ca * p.e[1] - sa * p.n[1];
    b.sz = ca * p.e[2] - sa * p.n[2];
    b.L = p.R;
    b.W = width;
    b.d = depth;
    return b;
  }

  /** What of the big places a raster around (x, z), `radius` m out, can touch. */
  private pick(x: number, z: number, radius: number) {
    const d = this.d, out: Big[] = [];
    dirOf(this.frame, x, z, d);
    for (const b of this.bigs) {
      const p = b.p, dx = d[0] - p.d[0], dy = d[1] - p.d[1], dz = d[2] - p.d[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) * R_M < b.reach * p.R + radius * 1.02) out.push(b);
    }
    this.active = out;
  }

  /** One big place on the height h at the unit vector d. */
  private shape(b: Big, h: number, d: Float64Array, highland: number): number {
    const p = b.p, dx = d[0] - p.d[0], dy = d[1] - p.d[1], dz = d[2] - p.d[2];
    const ch = Math.sqrt(dx * dx + dy * dy + dz * dz) * R_M;
    if (b.kind === Kind.Line) {
      const along = (d[0] * b.tx + d[1] * b.ty + d[2] * b.tz) * R_M;
      if (Math.abs(along) > b.L) return h;
      const wander = b.W * 0.35 * Math.sin(along / 7000 + p.id) + b.W * 0.15 * Math.sin(along / 2300);
      const across = (d[0] * b.sx + d[1] * b.sy + d[2] * b.sz) * R_M + wander;
      const ends = smooth(b.L, b.L * 0.86, Math.abs(along));
      if (b.d < 0) return h + b.d * ends * smooth(-b.W, b.W, across); // (a step, the Straight Wall)
      return h - b.d * ends * (1 - smooth(b.W * 0.55, b.W, Math.abs(across)));
    }
    const rr = ch / p.R;
    if (rr >= b.reach) return h;
    if (b.kind === Kind.Massif) {
      const t = 1 - rr * rr;
      const n = noise3(d[0] * 900, d[1] * 900, d[2] * 900, 91) * 0.6 + noise3(d[0] * 2500, d[1] * 2500, d[2] * 2500, 92) * 0.4;
      return Math.max(h, h * (1 - t) + (h + Math.min(2500, p.km * 80)) * t * (0.45 + 0.75 * n));
    }
    if (b.kind === Kind.Range) {
      // (ridged, and only where the ground is highland: a range's circle is mostly its sea)
      let n = 0;
      for (let k = 0, w = 1, f = 520; k < 3; k++, w *= 0.55, f *= 2.3) n += w * (1 - Math.abs(2 * noise3(d[0] * f, d[1] * f, d[2] * f, 93 + k) - 1));
      return h + (1 - rr * rr) * highland * (n - 0.9) * Math.min(1100, 180 + p.km * 1.4);
    }
    // ---- a complex crater: a rim that wanders, a terraced wall, a flat floor, central peaks, a blanket of ejecta
    const ph = b.ph;
    const th = Math.atan2(d[0] * p.n[0] + d[1] * p.n[1] + d[2] * p.n[2], d[0] * p.e[0] + d[1] * p.e[1] + d[2] * p.e[2]);
    const r = rr * (1 + 0.03 * Math.sin(3 * th + ph[0]) + 0.018 * Math.sin(5 * th + ph[1]) + 0.012 * Math.sin(8 * th + ph[2]) + 0.007 * Math.sin(13 * th + ph[3]));
    const floorR = Math.min(0.72, 0.38 + p.km / 300);
    let y: number;
    if (r < floorR) {
      y = b.floorY + 40 * Math.sin(r * 31 + ph[4]) * (r / floorR);
      for (let i = 0; i < b.peaks.length; i += 4) {
        const ex = r * Math.cos(th) - b.peaks[i], ez = r * Math.sin(th) - b.peaks[i + 1], s = b.peaks[i + 2];
        const q = 1 - (ex * ex + ez * ez) / (s * s);
        if (q > 0) y = Math.max(y, b.floorY + b.peakH * b.peaks[i + 3] * q * Math.sqrt(q) * (0.75 + 0.5 * noise3(d[0] * 1800, d[1] * 1800, d[2] * 1800, 95)));
      }
    } else if (r < 1) {
      const t = (r - floorR) / (1 - floorR);
      // (slumps, not contour lines: the terraces break up round the wall, and it is the slope that carries it)
      const wob = 0.5 * Math.sin(2 * th + ph[1]) + 0.35 * Math.sin(5 * th + ph[2]) + 0.3 * Math.sin(11 * th + ph[3]) + 1.4 * (noise3(d[0] * 700, d[1] * 700, d[2] * 700, 96) - 0.5);
      const k = t * b.terraces + wob, fl = Math.floor(k), s = (fl + smooth(0.15, 0.85, k - fl) - wob) / b.terraces;
      y = b.floorY + (b.base + b.rimH - b.floorY) * (0.62 * t * Math.sqrt(t) + 0.38 * s);
    } else {
      const t = r ** -2.6;
      y = b.base + b.rimH * t * (1 + 0.12 * Math.sin(th * 23 + ph[5]) * Math.min(1, (r - 1) * 5));
    }
    const w = smooth(b.reach, 1.25, rr);
    return h + (y - h) * w;
  }

  private readonly tmpB = { h: 0, t: 0 };

  /** Heights and tone at one world-aligned point, before any stamp. `minL` is the shortest hill it may hold. */
  private basePoint(x: number, z: number, minL: number): void {
    const d = this.d, { relief, albedo, window: real } = this.src, out = this.tmpB;
    dirOf(this.frame, x, z, d);
    const lat = latOf(d), lon = lonOf(d);
    let h = cubicAt(relief, lat, lon);
    const alb = linearAt(albedo, lat, lon);
    const mare = mareOf(alb + 0.05 * (noise3(d[0] * 340, d[1] * 340, d[2] * 340, 11) - 0.5));
    const high = 1 - mare;
    const list = this.active;
    for (let i = 0; i < list.length; i++) h = this.shape(list[i], h, d, high);
    let w = 0;
    if (real) {
      windowAt(real, lat, lon, 12, this.win);
      w = this.win.w;
      if (w > 0) h += (this.win.h - h) * w;
    }
    const rough = 0.1 + 0.9 * high;
    for (let k = 0; k < HILLS.length; k++) {
      const l = HILLS[k][0];
      if (l < minL) break;
      const f = R_M / l;
      const n = noise3(d[0] * f, d[1] * f, d[2] * f, 21 + k);
      // (ridged from a kilometre down: hummocks with a crest, what a low Sun picks out. The real window holds its own long wavelengths)
      const v = l <= 1000 ? 0.55 - Math.abs(2 * n - 1) : n - 0.5;
      h += v * 2 * HILLS[k][1] * rough * (l > 1200 ? 1 - w : 1);
    }
    out.h = h - this.datum;
    // the tone: the albedo map, broken up by what it is too coarse to show
    const f1 = R_M / 3000, f2 = R_M / 450;
    out.t = alb + 0.14 * (noise3(d[0] * f1, d[1] * f1, d[2] * f1, 31) - 0.5) + 0.09 * (noise3(d[0] * f2, d[1] * f2, d[2] * f2, 32) - 0.5);
  }

  /**
   * A raster: heights H and tone T at (x0 + i cell, z0 + j cell), i < W, j < Hh. x0 and z0 are multiples of `cell`. The big shapes go on a coarse grid, world-aligned, and a cubic takes that up to the cell.
   */
  raster(x0: number, z0: number, W: number, Hh: number, cell: number, H: Float32Array, T: Float32Array): void {
    const g = Math.max(32, cell * 8);
    const gx0 = Math.floor(x0 / g) - 1, gz0 = Math.floor(z0 / g) - 1;
    const bw = Math.ceil((x0 + (W - 1) * cell) / g) + 3 - gx0, bh = Math.ceil((z0 + (Hh - 1) * cell) / g) + 3 - gz0;
    const BH = new Float32Array(bw * bh), BT = new Float32Array(bw * bh);
    const cx = x0 + ((W - 1) * cell) / 2, cz = z0 + ((Hh - 1) * cell) / 2;
    this.pick(cx, cz, Math.hypot(W, Hh) * cell * 0.5 + g * 2);
    const minL = g * 3;
    const b = this.tmpB;
    for (let j = 0; j < bh; j++)
      for (let i = 0; i < bw; i++) {
        this.basePoint((gx0 + i) * g, (gz0 + j) * g, minL);
        BH[j * bw + i] = b.h;
        BT[j * bw + i] = b.t;
      }
    // up to the raster: rows first, then along them
    const colH = new Float32Array(bw), colT = new Float32Array(bw);
    for (let j = 0; j < Hh; j++) {
      const fz = (z0 + j * cell) / g - gz0, jz = Math.floor(fz), tz = fz - jz;
      const r0 = (jz - 1) * bw, r1 = jz * bw, r2 = (jz + 1) * bw, r3 = (jz + 2) * bw;
      for (let i = 0; i < bw; i++) {
        colH[i] = catmull(BH[r0 + i], BH[r1 + i], BH[r2 + i], BH[r3 + i], tz);
        colT[i] = catmull(BT[r0 + i], BT[r1 + i], BT[r2 + i], BT[r3 + i], tz);
      }
      const row = j * W;
      for (let i = 0; i < W; i++) {
        const fx = (x0 + i * cell) / g - gx0, ix = Math.floor(fx), tx = fx - ix;
        H[row + i] = catmull(colH[ix - 1], colH[ix], colH[ix + 1], colH[ix + 2], tx);
        T[row + i] = catmull(colT[ix - 1], colT[ix], colT[ix + 1], colT[ix + 2], tx);
      }
    }
    // the craters, biggest first: small ones land on what the big ones left
    const x1 = x0 + (W - 1) * cell, z1 = z0 + (Hh - 1) * cell;
    const minD = MIN_D_CELLS * cell;
    for (const n of this.named) {
      const reach = n.p.R * REACH;
      if (n.x + reach < x0 || n.x - reach > x1 || n.z + reach < z0 || n.z - reach > z1) continue;
      stampCrater(H, T, W, Hh, x0, z0, cell, n.x, n.z, n.p.R, Age.Fresh, 0.3, 0.5, 0.5);
    }
    const put = (c: Crater) => {
      if (c.r * 2 >= minD) stampCrater(H, T, W, Hh, x0, z0, cell, c.x, c.z, c.r, c.age, c.a, c.b, c.c);
    };
    for (let L = 0; L < OCTAVES && octaveD(L) >= minD; L++) eachCrater(this.frame, this.src.albedo, this.seed, L, x0, z0, x1, z1, put);
  }

  /** The height at one place with everything big enough for `cell` on it (m, world Y). A tool's question, not a frame's: it builds a raster of its own. */
  heightAt(x: number, z: number, cell = 8): number {
    const c = Math.max(1, Math.round(cell));
    const sx = Math.round(x / c) * c, sz = Math.round(z / c) * c;
    const H = new Float32Array(1), T = new Float32Array(1);
    this.raster(sx, sz, 1, 1, c, H, T);
    return H[0];
  }
}

export { DMAX };

// ---- light: the sweep

/**
 * Walks the raster from the Sun's side and leaves in P, at each texel, the highest line of sunlight the ground upstream lets through: over the ground there, it is in shadow, by that much. `edge(x, z)` is what
 * comes in over the raster's sun-side edges: the same number from something coarser and wider.
 */
export function sweepSun(H: Float32Array, W: number, Hh: number, x0: number, z0: number, cell: number, sun: SunLine, edge: (x: number, z: number) => number, P: Float32Array): void {
  const { ax, az, tanE } = sun;
  if (Math.abs(ax) >= Math.abs(az)) {
    const sx = ax > 0 ? 1 : -1, f = az / Math.abs(ax), drop = (cell / Math.abs(ax)) * tanE;
    const first = sx > 0 ? W - 1 : 0, step = -sx;
    for (let j = 0; j < Hh; j++) P[j * W + first] = edge(x0 + first * cell, z0 + j * cell);
    const jo = Math.floor(f), t = f - jo;
    for (let i = first + step; i >= 0 && i < W; i += step) {
      const u = i - step;
      for (let j = 0; j < Hh; j++) {
        const j0 = j + jo, j1 = j0 + 1;
        let a: number, b: number;
        if (j0 < 0 || j1 >= Hh) {
          const e = edge(x0 + i * cell, z0 + j * cell) + drop;
          a = e;
          b = e;
        } else {
          const ka = j0 * W + u, kb = j1 * W + u;
          a = H[ka] > P[ka] ? H[ka] : P[ka];
          b = H[kb] > P[kb] ? H[kb] : P[kb];
        }
        P[j * W + i] = a + (b - a) * t - drop;
      }
    }
  } else {
    const sz = az > 0 ? 1 : -1, f = ax / Math.abs(az), drop = (cell / Math.abs(az)) * tanE;
    const first = sz > 0 ? Hh - 1 : 0, step = -sz;
    for (let i = 0; i < W; i++) P[first * W + i] = edge(x0 + i * cell, z0 + first * cell);
    const io = Math.floor(f), t = f - io;
    for (let j = first + step; j >= 0 && j < Hh; j += step) {
      const u = (j - step) * W;
      for (let i = 0; i < W; i++) {
        const i0 = i + io, i1 = i0 + 1;
        let a: number, b: number;
        if (i0 < 0 || i1 >= W) {
          const e = edge(x0 + i * cell, z0 + j * cell) + drop;
          a = e;
          b = e;
        } else {
          const ka = u + i0, kb = u + i1;
          a = H[ka] > P[ka] ? H[ka] : P[ka];
          b = H[kb] > P[kb] ? H[kb] : P[kb];
        }
        P[j * W + i] = a + (b - a) * t - drop;
      }
    }
  }
}

// ---- the four bytes

/** A signed value to a byte, by its root: fine near nought, where the eye reads it. moonMaterial.ts's moonDecode undoes it. */
const encode = (v: number, k: number) => {
  const s = v < 0 ? -Math.sqrt(Math.min(1, -v * k)) : Math.sqrt(Math.min(1, v * k));
  return 128 + Math.round(127 * s);
};
export const SLOPE_MAX = 2;
export const SHADOW_MAX = 1000;
const K_SLOPE = 1 / SLOPE_MAX, K_SHADOW = 1 / SHADOW_MAX;
/** A shadow byte back to metres (the CPU's copy of moonDecode). */
export const decodeShadow = (b: number) => {
  const s = (b - 128) / 127;
  return s * Math.abs(s) * SHADOW_MAX;
};

/** Texel (i, j) of a raster into four bytes at M[o]. i, j must have a neighbour each way. */
function mapBytes(H: Float32Array, T: Float32Array, P: Float32Array, W: number, i: number, j: number, cell: number, M: Uint8Array, o: number): void {
  const k = j * W + i;
  M[o] = encode((H[k + 1] - H[k - 1]) / (2 * cell), K_SLOPE);
  M[o + 1] = encode((H[k + W] - H[k - W]) / (2 * cell), K_SLOPE);
  const t = T[k];
  M[o + 2] = t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * 255);
  M[o + 3] = encode(P[k] - H[k], K_SHADOW);
}

// ---- the far field: clip levels around the view

export const FAR = {
  /** Levels, each twice the cell of the last. Texels a side of a level's window, and of its blocks. */
  LEVELS: 8,
  N: 1024,
  B: 128,
  /** Metres a texel at level 0: a coarse region's own, so the two meet at one sharpness. */
  C0: 4,
  /** Blocks a side of a window; quads a side of a block's mesh; so vertices a side of its heights. */
  BLOCKS: 8,
  QUADS: 16,
  V: 17,
  /** The worker keeps every second texel of a level, for the Sun's long lines. */
  STORE: 512,
  /** How far past a block its raster runs (texels), so the small shadows that cross into it come with it. */
  MARGIN: 8,
} as const;

/**
 * A far texel's light, baked: the Sun is held, so two bytes do what four do near the bus, and a far pixel has no normal to filter. What moonLit does in the shaders, less its gain: keep the two together.
 * Returns the byte; moonMaterial.ts reads it back as byte^2 * LIT_MAX.
 */
export const LIT_MAX = 4;
export const LIT_POW = 1.12;
function litByte(sx: number, sz: number, tone: number, sun: SunLine, cosE: number, sinE: number): number {
  const ndl = (sinE - cosE * (sx * sun.ax + sz * sun.az)) / Math.sqrt(sx * sx + sz * sz + 1);
  const k = ndl <= 0 ? 0 : ndl / Math.max(sinE, 0.05);
  const lit = k ** LIT_POW * (0.42 + 1.16 * tone);
  return Math.min(255, Math.round(255 * Math.sqrt(lit / LIT_MAX)));
}

export interface FarUpdate {
  type: 'far';
  k: number;
  /** the level's window, in blocks */
  bi0: number;
  bj0: number;
  /** what's new: bi, bj for each */
  blocks: Int32Array;
  /** B * B * 2 bytes a block: light, and the sunlight's edge */
  map: Uint8Array;
  /** V * V * 2 floats a block: height, tone */
  heights: Float32Array;
}

interface FarLevel {
  k: number;
  cell: number;
  bi0: number;
  bj0: number;
  ready: boolean;
  /** every second texel of the window, its heights and sunlight */
  H: Float32Array;
  P: Float32Array;
}

/** Each level's window, in the worker: heights and sunlight at half the map's texels, so a finer level and a near region both start from the right light. */
export class FarStore {
  readonly levels: FarLevel[] = [];
  private readonly S = FAR.STORE;

  constructor(private readonly gen: MoonGen) {
    const n = this.S * this.S;
    for (let k = 0; k < FAR.LEVELS; k++) this.levels.push({ k, cell: FAR.C0 * 2 ** k, bi0: 0, bj0: 0, ready: false, H: new Float32Array(n), P: new Float32Array(n) });
  }

  /** The top of what stands at (x, z): the ground or the sunlight over it, from the finest level that holds the place. */
  planeAt = (x: number, z: number): number => {
    const S = this.S, step = FAR.N / S;
    for (let k = 0; k < FAR.LEVELS; k++) {
      const l = this.levels[k];
      if (!l.ready) continue;
      const c = l.cell * step, o = (FAR.B * l.bi0) / step, q = (FAR.B * l.bj0) / step;
      const fx = x / c - o, fz = z / c - q;
      if (fx < 0 || fz < 0 || fx >= S - 1 || fz >= S - 1) continue;
      const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, a = iz * S + ix;
      const u = (m: number) => (l.H[m] > l.P[m] ? l.H[m] : l.P[m]);
      return (u(a) * (1 - tx) + u(a + 1) * tx) * (1 - tz) + (u(a + S) * (1 - tx) + u(a + S + 1) * tx) * tz;
    }
    return -1e9;
  };

  /** Level k's window moves to (bi0, bj0), blocks: what it hadn't, it makes, and the Sun sweeps it again. Coarser levels first: the sweep starts from the next one up. */
  move(k: number, bi0: number, bj0: number): FarUpdate {
    const l = this.levels[k], { B, BLOCKS, V, QUADS, MARGIN, N } = FAR, S = this.S, step = N / S, SB = B / step;
    const was = l.ready, obi = l.bi0, obj = l.bj0, dbi = bi0 - obi, dbj = bj0 - obj;
    const keep = was && Math.abs(dbi) < BLOCKS && Math.abs(dbj) < BLOCKS;
    if (keep && (dbi || dbj)) {
      // (arrays stay put: rows slide over, the way the window slid)
      const sh = SB * dbi, sv = SB * dbj;
      const slide = (a: Float32Array) => {
        if (sv > 0) a.copyWithin(0, sv * S, S * S);
        else if (sv < 0) a.copyWithin(-sv * S, 0, (S + sv) * S);
        if (sh)
          for (let j = 0; j < S; j++) {
            const r = j * S;
            if (sh > 0) a.copyWithin(r, r + sh, r + S);
            else a.copyWithin(r - sh, r, r + S + sh);
          }
      };
      slide(l.H);
      slide(l.P);
    }
    l.bi0 = bi0;
    l.bj0 = bj0;
    const fresh: number[] = [];
    for (let bj = bj0; bj < bj0 + BLOCKS; bj++)
      for (let bi = bi0; bi < bi0 + BLOCKS; bi++) if (!keep || bi < obi || bi >= obi + BLOCKS || bj < obj || bj >= obj + BLOCKS) fresh.push(bi, bj);
    const n = fresh.length / 2;
    const heights = new Float32Array(n * V * V * 2), map = new Uint8Array(n * B * B * 2);
    const W = B + 2 * MARGIN + 1, cell = l.cell, m = MARGIN, dv = B / QUADS;
    const rasters: Array<[Float32Array, Float32Array]> = [];
    for (let q = 0; q < n; q++) {
      const bi = fresh[q * 2], bj = fresh[q * 2 + 1];
      const ox = (bi - bi0) * SB, oz = (bj - bj0) * SB;
      const rh = new Float32Array(W * W), rt = new Float32Array(W * W);
      this.gen.raster((bi * B - m) * cell, (bj * B - m) * cell, W, W, cell, rh, rt);
      rasters.push([rh, rt]);
      for (let j = 0; j < SB; j++) for (let i = 0; i < SB; i++) l.H[(oz + j) * S + ox + i] = rh[(j * step + m) * W + i * step + m];
      for (let j = 0; j < V; j++)
        for (let i = 0; i < V; i++) {
          const a = (j * dv + m) * W + i * dv + m, o = (q * V * V + j * V + i) * 2;
          heights[o] = rh[a];
          heights[o + 1] = rt[a];
        }
    }
    // the long lines, over the whole window, from the level over it
    const coarser = this.levels[k + 1];
    l.ready = false;
    sweepSun(l.H, S, S, bi0 * B * cell, bj0 * B * cell, cell * step, this.gen.sun, coarser?.ready ? this.planeAt : () => -1e9, l.P);
    l.ready = true;
    // then each new block's own short ones, starting from those, and its two bytes
    const sun = this.gen.sun, cosE = 1 / Math.sqrt(1 + sun.tanE * sun.tanE), sinE = sun.tanE * cosE;
    const P = new Float32Array(W * W);
    for (let q = 0; q < n; q++) {
      const [rh, rt] = rasters[q], bi = fresh[q * 2], bj = fresh[q * 2 + 1];
      sweepSun(rh, W, W, (bi * B - m) * cell, (bj * B - m) * cell, cell, sun, this.planeAt, P);
      for (let j = 0; j < B; j++)
        for (let i = 0; i < B; i++) {
          const a = (j + m) * W + i + m, o = (q * B * B + j * B + i) * 2;
          map[o] = litByte((rh[a + 1] - rh[a - 1]) / (2 * cell), (rh[a + W] - rh[a - W]) / (2 * cell), rt[a], sun, cosE, sinE);
          map[o + 1] = encode(P[a] - rh[a], K_SHADOW);
        }
    }
    return { type: 'far', k, bi0, bj0, blocks: Int32Array.from(fresh), map, heights };
  }
}

// ---- a region: what City reads, one bundle

export const MOON_TILE = 256;
export const MOON_REGION = 4;
/** Near raster: metres a texel at each level of detail, and how far past the region it runs (m), for the sun's sweep and the slopes. */
const NEAR_CELL = [2, 4];
const NEAR_MARGIN = 128;

export interface MoonTileData {
  /** the tile's own map, or its region's (a coarse region draws as one) */
  map: Uint8Array;
  mapN: number;
  /** the map's first texel's place (m) and its cell */
  mapX: number;
  mapZ: number;
  mapCell: number;
}

/** A detailed region's boulders: x, y, z, size, turn, lit, tone, for each. rocks.ts draws them. */
const ROCK_STRIDE = 7;
const ROCK_MAX = 1400;

function rocksOf(gen: MoonGen, H: Float32Array, T: Float32Array, P: Float32Array, W: number, x0: number, z0: number, cell: number, rx: number, rz: number): Float32Array {
  const side = MOON_REGION * MOON_TILE, ox = rx * side, oz = rz * side;
  const out = new Float32Array(ROCK_MAX * ROCK_STRIDE);
  let n = 0;
  const put = (x: number, z: number, size: number, turn: number) => {
    if (n >= ROCK_MAX || x < ox || z < oz || x >= ox + side || z >= oz + side) return;
    const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell), k = j * W + i, o = n * ROCK_STRIDE;
    out[o] = x;
    out[o + 1] = H[k] - 0.15 * size;
    out[o + 2] = z;
    out[o + 3] = size;
    out[o + 4] = turn;
    out[o + 5] = P[k] > H[k] ? 0 : 1;
    out[o + 6] = T[k];
    n++;
  };
  let h = mix32(gen.seed ^ Math.imul(rx, 0x85ebca77) ^ Math.imul(rz, 0xc2b2ae3d));
  const r = () => (h = mix32(h + 1)) / 4294967296;
  // a few loose everywhere
  for (let i = 0; i < 260; i++) put(ox + r() * side, oz + r() * side, 0.35 + 1.5 * r() ** 4, r() * 6.283);
  // most of them where a young crater threw them: out over its rim, and bigger the bigger it is
  const ring = (c: Crater) => {
    if (c.age > Age.Plain) return;
    const count = Math.min(70, 6 + c.r / (c.age === Age.Fresh ? 1.4 : 5));
    let q = mix32(Math.imul(c.i, 7) ^ Math.imul(c.j, 13) ^ Math.imul(c.k, 29));
    const u = () => (q = mix32(q + 1)) / 4294967296;
    for (let i = 0; i < count; i++) {
      const a = u() * 6.283, d = c.r * (1 + 0.9 * u() ** 2);
      put(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, (0.3 + 0.045 * c.r ** 0.75 * u() ** 3) * (0.7 + u()), u() * 6.283);
    }
  };
  for (let L = 2; L < 8; L++) eachCrater(gen.frame, gen.src.albedo, gen.seed, L, ox, oz, ox + side, oz + side, ring);
  return out.slice(0, n * ROCK_STRIDE);
}

export interface MoonRegionTile {
  tx: number;
  tz: number;
  n: number;
  cell: number;
  heights: Float32Array;
  obst: Float32Array;
  moon: MoonTileData;
  grid: { step: number; position: Float32Array; normal: Float32Array; index: Uint16Array | Uint32Array; sphere: Float32Array };
}

/** The one thing that can go wrong with shading a mesh by a map: the mesh's own bounds are all three needs. */
function sphereOf(p: Float32Array): Float32Array {
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < p.length; i += 3) {
    if (p[i] < lo) lo = p[i];
    if (p[i] > hi) hi = p[i];
  }
  const cx = (p[0] + p[p.length - 3]) / 2, cz = (p[2] + p[p.length - 1]) / 2, cy = (lo + hi) / 2;
  const dx = p[p.length - 3] - p[0], dz = p[p.length - 1] - p[2];
  return new Float32Array([cx, cy, cz, 0.5 * Math.sqrt(dx * dx + dz * dz + (hi - lo) * (hi - lo))]);
}

/** A tile's ground mesh from its heights: every `step` samples. No normals: the map has them per pixel. */
function grid(H: Float32Array, n: number, cell: number, ox: number, oz: number, step: number, label: number): MoonRegionTile['grid'] {
  const m = Math.floor((n - 1) / step) + 1;
  const pos = new Float32Array(m * m * 3);
  for (let j = 0; j < m; j++)
    for (let i = 0; i < m; i++) {
      const k = (j * m + i) * 3;
      pos[k] = ox + i * step * cell;
      pos[k + 1] = H[j * step * n + i * step];
      pos[k + 2] = oz + j * step * cell;
    }
  const idx = m * m < 65535 ? new Uint16Array((m - 1) * (m - 1) * 6) : new Uint32Array((m - 1) * (m - 1) * 6);
  let q = 0;
  for (let j = 0; j < m - 1; j++)
    for (let i = 0; i < m - 1; i++) {
      const a = j * m + i, b = a + 1, c = a + m, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  return { step: label, position: pos, normal: new Float32Array(0), index: idx, sphere: sphereOf(pos) };
}

/** Region (rx, rz) at a level of detail, the shape City's tiles take. `edge`: the far field's light (FarStore.planeAt). Its arrays are its own: hand them over. */
export function makeRegion(gen: MoonGen, rx: number, rz: number, lod: 0 | 1, edge: (x: number, z: number) => number): { tiles: MoonRegionTile[]; rocks: Float32Array | null; transfer: ArrayBuffer[]; ms: number } {
  const t0 = performance.now();
  const cell = NEAR_CELL[lod], ts = MOON_TILE, rs = MOON_REGION, side = rs * ts;
  const mar = NEAR_MARGIN / cell;
  const W = side / cell + 2 * mar + 1;
  const x0 = rx * side - mar * cell, z0 = rz * side - mar * cell;
  const H = new Float32Array(W * W), T = new Float32Array(W * W), P = new Float32Array(W * W);
  gen.raster(x0, z0, W, W, cell, H, T);
  sweepSun(H, W, W, x0, z0, cell, gen.sun, edge, P);
  const tiles: MoonRegionTile[] = [];
  const transfer: ArrayBuffer[] = [];
  const n = ts / cell + 1, N8 = 32, tc = ts / N8 / cell;
  // a coarse region's one map: a texel past its edge each way, so a filtered read never clamps
  let regionMap: Uint8Array | null = null;
  const RN = side / cell + 3;
  if (lod === 1) {
    regionMap = new Uint8Array(RN * RN * 4);
    for (let j = 0; j < RN; j++) for (let i = 0; i < RN; i++) mapBytes(H, T, P, W, mar + i - 1, mar + j - 1, cell, regionMap, (j * RN + i) * 4);
    transfer.push(regionMap.buffer as ArrayBuffer);
  }
  const TN = ts / cell + 3;
  for (let tj = 0; tj < rs; tj++)
    for (let ti = 0; ti < rs; ti++) {
      const tx = rx * rs + ti, tz = rz * rs + tj, ox = tx * ts, oz = tz * ts;
      const i0 = mar + ti * (ts / cell), j0 = mar + tj * (ts / cell);
      const hts = new Float32Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hts[j * n + i] = H[(j0 + j) * W + i0 + i];
      const obst = new Float32Array(N8 * N8);
      for (let cj = 0; cj < N8; cj++)
        for (let ci = 0; ci < N8; ci++) {
          let top = -Infinity;
          for (let j = 0; j <= tc; j++) for (let i = 0; i <= tc; i++) top = Math.max(top, H[(j0 + cj * tc + j) * W + i0 + ci * tc + i]);
          obst[cj * N8 + ci] = top;
        }
      let moon: MoonTileData;
      if (regionMap) moon = { map: regionMap, mapN: RN, mapX: rx * side - cell, mapZ: rz * side - cell, mapCell: cell };
      else {
        const map = new Uint8Array(TN * TN * 4);
        for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) mapBytes(H, T, P, W, i0 + i - 1, j0 + j - 1, cell, map, (j * TN + i) * 4);
        moon = { map, mapN: TN, mapX: ox - cell, mapZ: oz - cell, mapCell: cell };
        transfer.push(map.buffer as ArrayBuffer);
      }
      // (a 4 m mesh in a detailed region, 8 m in a coarse one; City calls those steps 2 and 4)
      const g = grid(hts, n, cell, ox, oz, 2, lod === 0 ? 2 : 4);
      transfer.push(hts.buffer as ArrayBuffer, obst.buffer as ArrayBuffer, g.position.buffer as ArrayBuffer, g.index.buffer as ArrayBuffer);
      tiles.push({ tx, tz, n, cell, heights: hts, obst, moon, grid: g });
    }
  const rocks = lod === 0 ? rocksOf(gen, H, T, P, W, x0, z0, cell, rx, rz) : null;
  if (rocks) transfer.push(rocks.buffer as ArrayBuffer);
  return { tiles, rocks, transfer, ms: performance.now() - t0 };
}
