import { catmull, readRelief, type WholeMap } from '../moon/map';
import { gunzip, isGzip } from '../world/gunzip';
import { SLOPE_MAX, TILE } from './groundSize';

// The Moon from orbit: what the resolve's spaceMoon reads when a pixel of the ground is smaller than the map's texel. No three.js and no DOM: a worker does this once, after the first frame, and a tool can do it under Node.
//
// Two maps. The ground: the Sky's tone map at twice its size, and the real relief's slope (public/moon/relief.bin, the same heights as ?moon's), both on bicubics, so a pixel at 300 km reads a smooth surface and not a 20 px
// bilinear block. Its second mip is the tone map as it was, to within a rounding, so a far disc is what it always was. The slope is a vector, Moon fixed, so there's no tangent frame to build and nothing happens at a pole.
//
// The craters: a square tile of invented ones, a surface saturated with them, N(>D) as D^-2 as ?moon's are, that the resolve reads at two sizes. A texel holds the height's slope, how bright the ground is, and the crater's
// rank, which is what a sea does with them: it keeps a third, as ?moon's seas do, and the third it keeps is drawn last, so it's whole. Fresh ones throw bright ejecta, which is what shows under a high Sun.

/** The ground map's size: twice the tone map's. */
export const GROUND_W = 2048;
export const GROUND_H = 1024;

const R_KM = 1737.4;

export interface GroundRequest {
  /** the page's base, for the relief */
  base: string;
  /** the tone map, as SkyDraw has it */
  tone: Uint8Array;
  toneW: number;
  toneH: number;
}

export interface GroundResult {
  /** RGBA, GROUND_W x GROUND_H: tone, then the slope, Moon fixed */
  map: Uint8Array;
  /** RGBA, TILE x TILE: the height's slope x and y, brightness, rank */
  tile: Uint8Array;
}

/** A map to a new size, longitude wrapping and the poles clamped, by Catmull-Rom each way: rows, then columns. */
function upsample(src: ArrayLike<number>, sw: number, sh: number, W: number, H: number, out: Float32Array): void {
  const rows = new Float32Array(W * sh);
  const ix = new Int32Array(W * 4), tx = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    const f = ((i + 0.5) / W) * sw - 0.5, b = Math.floor(f);
    tx[i] = f - b;
    for (let k = 0; k < 4; k++) ix[i * 4 + k] = (b - 1 + k + sw) % sw;
  }
  for (let j = 0; j < sh; j++) {
    const y = j * sw, o = j * W;
    for (let i = 0; i < W; i++) rows[o + i] = catmull(src[y + ix[i * 4]], src[y + ix[i * 4 + 1]], src[y + ix[i * 4 + 2]], src[y + ix[i * 4 + 3]], tx[i]);
  }
  for (let j = 0; j < H; j++) {
    const f = ((j + 0.5) / H) * sh - 0.5, b = Math.floor(f), t = f - b, o = j * W;
    const y0 = Math.max(0, b - 1) * W, y1 = Math.max(0, b) * W, y2 = Math.min(sh - 1, b + 1) * W, y3 = Math.min(sh - 1, b + 2) * W;
    for (let i = 0; i < W; i++) out[o + i] = catmull(rows[y0 + i], rows[y1 + i], rows[y2 + i], rows[y3 + i], t);
  }
}

/** The tone at twice its size and the relief's slope, one RGBA map. */
export function groundMap(relief: WholeMap, tone: ArrayLike<number>, toneW: number, toneH: number): Uint8Array {
  const W = GROUND_W, H = GROUND_H;
  const out = new Uint8Array(W * H * 4);
  // ---- tone: a smooth surface, then each 2 x 2 back on the texel it came from, so the mip over it is that texel
  const t = new Float32Array(W * H);
  upsample(tone, toneW, toneH, W, H, t);
  const kx = W / toneW, ky = H / toneH, n = kx * ky, kids = new Float32Array(n);
  for (let j = 0; j < toneH; j++)
    for (let i = 0; i < toneW; i++) {
      const want = tone[j * toneW + i];
      for (let b = 0; b < ky; b++) for (let a = 0; a < kx; a++) kids[b * kx + a] = Math.max(0, Math.min(255, t[(j * ky + b) * W + i * kx + a]));
      // (a few rounds: a texel the smooth surface overshot is held at the end of the range, and the others make up for it)
      for (let r = 0; r < 3; r++) {
        let sum = 0, free = 0;
        for (let k = 0; k < n; k++) sum += kids[k];
        const off = want * n - sum;
        for (let k = 0; k < n; k++) if ((off > 0 && kids[k] < 255) || (off < 0 && kids[k] > 0)) free++;
        if (!free) break;
        for (let k = 0; k < n; k++) if ((off > 0 && kids[k] < 255) || (off < 0 && kids[k] > 0)) kids[k] = Math.max(0, Math.min(255, kids[k] + off / free));
      }
      for (let b = 0; b < ky; b++) for (let a = 0; a < kx; a++) out[((j * ky + b) * W + i * kx + a) * 4] = Math.round(kids[b * kx + a]);
    }
  // ---- the slope: the heights on the same grid, then their gradient as a vector, east and north at each texel
  upsample(relief.data, relief.w, relief.h, W, H, t);
  // (toward a pole the columns crowd: a row is smoothed out to the width of a texel at the equator, or its noise comes back as rings round the pole, the east slope being a small step over a small distance)
  const row = new Float32Array(W);
  for (let j = 0; j < H; j++) {
    const w = Math.floor(0.5 / Math.max(Math.cos((0.5 - (j + 0.5) / H) * Math.PI), 0.005));
    if (w < 1) continue;
    const o = j * W, k = 1 / (2 * w + 1);
    let sum = 0;
    for (let i = -w; i <= w; i++) sum += t[o + ((i + W) % W)];
    for (let i = 0; i < W; i++) {
      row[i] = sum * k;
      sum += t[o + (i + w + 1) % W] - t[o + ((i - w + W) % W)];
    }
    t.set(row, o);
  }
  const dy = (Math.PI * R_KM * 1000) / H, dx = (2 * Math.PI * R_KM * 1000) / W, S = 127 / SLOPE_MAX;
  const clamp = (v: number) => Math.round(128 + Math.max(-127, Math.min(127, v * S)));
  const sl = new Float64Array(W), cl = new Float64Array(W);
  for (let i = 0; i < W; i++) {
    const lon = ((i + 0.5) / W - 0.5) * 2 * Math.PI;
    sl[i] = Math.sin(lon);
    cl[i] = Math.cos(lon);
  }
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI, cp = Math.cos(lat), sp = Math.sin(lat), ex = 0.5 / (dx * Math.max(cp, 0.03));
    const o = j * W, up = Math.max(0, j - 1) * W, dn = Math.min(H - 1, j + 1) * W;
    for (let i = 0; i < W; i++) {
      const ge = (t[o + (i + 1) % W] - t[o + (i + W - 1) % W]) * ex, gn = (t[up + i] - t[dn + i]) / (dy * (dn - up === 2 * W ? 2 : 1));
      const q = (o + i) * 4;
      out[q + 1] = clamp(ge * sl[i] + gn * sp * cl[i]);
      out[q + 2] = clamp(-ge * cl[i] + gn * sp * sl[i]);
      out[q + 3] = clamp(-gn * cp);
    }
  }
  return out;
}

const mix = (h: number) => {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

interface Stamp {
  x: number;
  y: number;
  r: number;
  /** its squash, and which way */
  sq: number;
  a: number;
  /** how much of a fresh crater's shape is left */
  amp: number;
  fresh: boolean;
  rank: number;
  seed: number;
}

/** Radii an octave: 12 to 6, 6 to 3 and 3 to 1.5 texels. Each covers about this share of the tile: the count goes up four times an octave, which is a surface in saturation. */
const OCTAVES: Array<[number, number]> = [
  [12, 0.34],
  [6, 0.42],
  [3, 0.5],
];
/** The mottle: cells across the tile, and how much of the brightness. */
const MOTTLE: Array<[number, number]> = [
  [8, 0.1],
  [17, 0.08],
  [37, 0.06],
];
/** A stamp reaches this many radii. */
const REACH = 2.3;
const REACH_FRESH = 3;

/** The tile, once: a Poisson field of craters, deterministic from the seed, wrapping both ways. */
export function craterTile(seed = 0x5eed): Uint8Array {
  const n = TILE, H = new Float32Array(n * n), L = new Float32Array(n * n), Q = new Float32Array(n * n).fill(1);
  let s = seed >>> 0;
  const rnd = () => (s = mix(s + 0x9e3779b1)) / 4294967296;
  const stamps: Stamp[] = [];
  for (const [rMax, cover] of OCTAVES) {
    const count = Math.round((cover * n * n) / (Math.PI * rMax * rMax * 0.5));
    for (let i = 0; i < count; i++) {
      const age = rnd(), rank = rnd();
      stamps.push({
        x: rnd() * n,
        y: rnd() * n,
        // (a power law inside the octave too: the small end is the common one)
        r: rMax * 2 ** -Math.sqrt(rnd()),
        sq: 0.08 + rnd() * 0.16,
        a: rnd() * Math.PI,
        amp: age < 0.09 ? 1.15 : age < 0.42 ? 0.9 : age < 0.76 ? 0.55 : 0.3,
        fresh: age < 0.09,
        rank,
        seed: Math.floor(rnd() * 4294967296),
      });
    }
  }
  // the ones a sea keeps go on last, so what it keeps is whole
  stamps.sort((a, b) => b.rank - a.rank);
  for (const c of stamps) stamp(c, H, L, Q, n);
  // the ground's own mottle, three octaves that wrap: the map's tone is 3 bits, so a sea is a plate of one value, which either side of a step is one flat colour or a whole plate of dither
  for (const [cells, amp] of MOTTLE) {
    const g = new Float32Array(cells * cells), k = cells / n;
    for (let i = 0; i < g.length; i++) g[i] = rnd() * 2 - 1;
    for (let j = 0; j < n; j++) {
      const fy = j * k, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), a0 = y0 * cells, a1 = ((y0 + 1) % cells) * cells;
      for (let i = 0; i < n; i++) {
        const fx = i * k, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % cells;
        const top = g[a0 + x0] * (1 - sx) + g[a0 + x1] * sx, bot = g[a1 + x0] * (1 - sx) + g[a1 + x1] * sx;
        L[j * n + i] += amp * (top * (1 - sy) + bot * sy);
      }
    }
  }
  const out = new Uint8Array(n * n * 4);
  const byte = (v: number) => Math.round(128 + Math.max(-127, Math.min(127, v * 127)));
  for (let j = 0; j < n; j++) {
    const up = ((j + n - 1) % n) * n, dn = ((j + 1) % n) * n, o = j * n;
    for (let i = 0; i < n; i++) {
      const q = (o + i) * 4;
      out[q] = byte((H[o + (i + 1) % n] - H[o + (i + n - 1) % n]) * 0.5);
      out[q + 1] = byte((H[dn + i] - H[up + i]) * 0.5);
      out[q + 2] = byte(L[o + i]);
      out[q + 3] = Math.round(Q[o + i] * 255);
    }
  }
  return out;
}

/** One crater into the height (texels), the brightness (-1..1) and the rank. Heights add: a young crater on an old one is both. */
function stamp(c: Stamp, H: Float32Array, L: Float32Array, Q: Float32Array, n: number): void {
  const reach = c.r * (c.fresh ? REACH_FRESH : REACH), x0 = Math.floor(c.x - reach), x1 = Math.ceil(c.x + reach), y0 = Math.floor(c.y - reach), y1 = Math.ceil(c.y + reach);
  const ca = Math.cos(c.a), sa = Math.sin(c.a), ir = 1 / c.r, k = 1 + c.sq, ik = 1 / k;
  // a big one has a flat floor and a soft rim; a small one is a bowl
  const big = Math.min(1, Math.max(0, (c.r - 3.5) / 3)), flat = 0.5 * big, peak = c.r > 8 ? 0.12 : 0;
  const depth = 0.42 * c.r * c.amp, rim = 0.09 * c.r * c.amp, edge = REACH ** -3;
  const spokes = 5 + (c.seed & 7), phase = ((c.seed >>> 3) & 255) / 40;
  for (let py = y0; py <= y1; py++)
    for (let px = x0; px <= x1; px++) {
      const dx = px - c.x, dy = py - c.y;
      const u = (dx * ca + dy * sa) * ir * k, v = (dy * ca - dx * sa) * ir * ik;
      const p = Math.sqrt(u * u + v * v);
      const q = (((py % n) + n) % n) * n + ((px % n) + n) % n;
      if (p < REACH) {
        let h: number;
        if (p < 1) {
          const f = p <= flat ? 0 : (p - flat) / (1 - flat);
          h = rim - depth * (1 - f * f);
          if (peak && p < 0.22) h += depth * peak * 4 * (1 - p / 0.22);
        } else h = (rim * (p ** -3 - edge)) / (1 - edge);
        H[q] += h;
        if (p < 1.2) Q[q] = c.rank;
      }
      if (c.fresh) {
        if (p < 1) L[q] += 0.3;
        else if (p < REACH_FRESH) {
          const f = 1 - (p - 1) / (REACH_FRESH - 1), ray = 0.5 + 0.5 * Math.sin(Math.atan2(v, u) * spokes + phase);
          L[q] += 0.42 * f * f * (0.35 + 0.65 * ray);
        }
      }
      // a bowl is darker than its rim, whatever is lighting it: it's what says bowl and not dome
      if (p < 1) L[q] -= 0.24 * c.amp * (1 - p * p);
      else if (p < 1.3) L[q] += 0.16 * c.amp * (1 - Math.abs(p - 1.08) / 0.22);
    }
}

/** The relief fetched and inflated, and both maps made: on a worker, or on the main thread if the page can't have one. Null: it never arrived, and the Moon keeps the tone map it has. */
export async function loadGround(req: GroundRequest): Promise<GroundResult | null> {
  try {
    const r = await fetch(`${req.base}/moon/relief.bin`);
    if (!r.ok) return null;
    const b = await r.arrayBuffer();
    return { map: groundMap(readRelief(isGzip(b) ? await gunzip(b) : b), req.tone, req.toneW, req.toneH), tile: craterTile() };
  } catch {
    return null;
  }
}
