import { bandHue, LAYOUT_BANDS, SHAPE_LUT, type BlastDot, type BlastSpec } from '../game/blastLayout';

// A ground mask's texels and their code, and a blast's settled paint at a point: what GroundPaint.ts draws on a tile, and GeoPaint.ts into the Moon's pictures by place.

/** Texels a side of a tile's mask, and of a picture by place. */
export const GROUND_N = 128;

/** A blast made ready to draw (GroundPaint.prepare). */
export interface Prepared {
  spec: BlastSpec;
  lut: Float32Array;
  /** per-angle boundary warp noise (-1..1) for the hue layout */
  warp: Float32Array;
  /** shockwave arrival time by distance, 0..max over WAVE_LUT steps */
  wave: Float32Array;
  max: number;
  dots: BlastDot[];
  /** world bbox of everything this blast paints */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export const TEXELS = GROUND_N * GROUND_N;
/** encoder scratch: worst case one (value, run) pair per texel */
const RLE = new Uint8Array(TEXELS * 2);

/**
 * A mask's settled paint as a short string: per texel coverage (5 bits) and
 * hue (3 bits), run-length coded ((value, run - 1) byte pairs), base64.
 * Empty string = nothing painted.
 */
export function encodeMask(d: Uint8Array): string {
  let w = 0, prev = -1, run = 0, any = false;
  for (let k = 0, o = 0; k < TEXELS; k++, o += 4) {
    const q = (d[o] * 31 + 127) / 255 | 0;
    const v = q > 0 ? (q << 3) | Math.min(5, d[o + 1] >> 5) : 0;
    if (v === prev && run < 256) {
      run++;
      continue;
    }
    if (run) {
      RLE[w++] = prev;
      RLE[w++] = run - 1;
    }
    if (v) any = true;
    prev = v;
    run = 1;
  }
  RLE[w++] = prev;
  RLE[w++] = run - 1;
  if (!any) return '';
  let bin = '';
  for (let k = 0; k < w; k += 0x2000) bin += String.fromCharCode.apply(null, RLE.subarray(k, Math.min(w, k + 0x2000)) as unknown as number[]);
  return btoa(bin);
}

/** Decodes encodeMask() into a mask's data (settled: no reveal, no serial). False if corrupt. */
export function decodeMask(str: string, d: Uint8Array): boolean {
  let bin: string;
  try {
    bin = atob(str);
  } catch {
    return false;
  }
  let k = 0;
  for (let i = 0; i + 1 < bin.length; i += 2) {
    const v = bin.charCodeAt(i);
    const q = v >> 3;
    const cov = q ? Math.round((q * 255) / 31) : 0;
    const g = q ? Math.min(5, v & 7) * 32 + 16 : 0;
    const e = k + bin.charCodeAt(i + 1) + 1;
    if (e > TEXELS) break;
    for (let o = k * 4; k < e; k++, o += 4) {
      d[o] = cov;
      d[o + 1] = g;
      d[o + 2] = 0;
      d[o + 3] = 0;
    }
  }
  if (k === TEXELS) return true;
  d.fill(0);
  return false;
}

/** The splat's settled paint at a point of the map: coverage 0..1 and hue into `out`, false where it paints nothing. GroundPaint.rows' texel, for a point anywhere (GeoPaint.ts). */
export function splatAt(p: Prepared, x: number, z: number, out: { c: number; hue: number }): boolean {
  const s = p.spec, R = p.max + 3, wx = x - s.x, wz = z - s.z, d2 = wx * wx + wz * wz;
  if (d2 > R * R) return false;
  const dist = Math.sqrt(d2), a = Math.atan2(wz, wx), lut = p.lut, warp = p.warp;
  let f = a * (SHAPE_LUT / (Math.PI * 2));
  if (f < 0) f += SHAPE_LUT;
  const k = f | 0, t = f - k, k1 = k + 1 < SHAPE_LUT ? k + 1 : 0;
  const e = lut[k] * (1 - t) + lut[k1] * t;
  const c = (e - dist) / 2.6 + 0.5;
  if (c <= 0.02) return false;
  let hue = s.hue;
  if (s.layout === LAYOUT_BANDS) hue = bandHue(s, x, z);
  else if (dist > 1.5) {
    const wd = warp[k] * 2.2;
    let u = (a + warp[k1] * 0.16 + s.twist * (dist + wd)) * (1 / (Math.PI * 2)) + 0.012 * Math.sin(dist * 0.21);
    u -= Math.floor(u);
    const S = s.sectors, sector = Math.floor(u * S + 0.5) % S, ring = Math.floor((dist + wd) / Math.max(1, s.ring));
    const off = s.layout === 1 ? ring : s.layout === 2 ? sector + ring : sector;
    hue = (((s.hue + off) % 6) + 6) % 6;
  }
  out.c = c > 1 ? 1 : c;
  out.hue = hue;
  return true;
}

/** A spatter dot's coverage at a point, 0 where it paints nothing (GroundPaint.dots' texel). ca, sa: its direction's cosine and sine. */
export function dotAt(dot: BlastDot, ca: number, sa: number, x: number, z: number): number {
  const wx = x - dot.x, wz = z - dot.z;
  const along = (wx * ca + wz * sa) / dot.elong, across = -wx * sa + wz * ca;
  const c = Math.min(1, Math.max(0, (dot.rad - Math.sqrt(along * along + across * across)) / 1.6 + 0.5));
  return c > 0.02 ? c : 0;
}
