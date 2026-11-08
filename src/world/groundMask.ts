import { bandHue, LAYOUT_BANDS, LAYOUT_RING, SHAPE_LUT, type BlastDot, type BlastSpec } from '../game/blastLayout';
import { lookOf } from '../render/factionLook';
import { FACTION_RAINBOW, ownerOf } from '../game/factions';

// A ground mask's texels and their code, and a blast's settled paint at a point: what GroundPaint.ts draws on a tile, and GeoPaint.ts into the Moon's pictures by place.

/** Texels a side of a tile's mask, and of a picture by place. */
export const GROUND_N = 128;

/**
 * A painted texel's g: its hue in the top 3 bits, and its faction in the low 5 as texelLow's 14 + 2 f, room for factions 0-7. Rainbow's is 16, what every
 * painted texel's was before factions, so a Rainbow mask is the same bytes as then; the ground's shader reads the hue alone, floor(g / 32).
 */
export const texelLow = (faction: number) => 14 + 2 * faction;
/** What a painted texel's g says is its faction (Rainbow for low bits that are none of texelLow's). */
export const texelOwner = (g: number) => ownerOf(((g & 31) - 14) >> 1);
const RAINBOW_LOW = texelLow(FACTION_RAINBOW);

/** A blast made ready to draw (GroundPaint.prepare). */
export interface Prepared {
  spec: BlastSpec;
  lut: Float32Array;
  /** per-angle boundary warp noise (-1..1) for the hue layout */
  warp: Float32Array;
  /** shockwave arrival time by distance, 0..max over WAVE_LUT steps */
  wave: Float32Array;
  /** &falls's pool: the walls' distance by angle (BlastSpec.foot), its reveal measured from them */
  foot?: Float32Array;
  max: number;
  dots: BlastDot[];
  /** world bbox of everything this blast paints */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export const TEXELS = GROUND_N * GROUND_N;
/** encoder scratch: worst case one (value, run) pair per texel; each painted pair's texelLow; the owners' (faction, run - 1) pairs */
const RLE = new Uint8Array(TEXELS * 2);
const LOWS = new Uint8Array(TEXELS);
const OWNERS = new Uint8Array(TEXELS * 2);

const base64 = (a: Uint8Array, w: number) => {
  let bin = '';
  for (let k = 0; k < w; k += 0x2000) bin += String.fromCharCode.apply(null, a.subarray(k, Math.min(w, k + 0x2000)) as unknown as number[]);
  return btoa(bin);
};

/**
 * A mask's settled paint as a short string: per texel coverage (5 bits) and
 * hue (3 bits), run-length coded ((value, run - 1) byte pairs), base64.
 * Empty string = nothing painted.
 * Whose it is: where any painted texel isn't Rainbow's, '~' and a second base64 of (faction, n - 1) byte pairs, the next n painted pairs that
 * faction's (a run ends where the faction changes too). A mask that's all Rainbow's has none, and is the code it was before factions; a build from before
 * them can't read a code that has one (atob throws on '~'), and takes it for a broken one.
 */
export function encodeMask(d: Uint8Array): string {
  let w = 0, prev = -1, run = 0, any = false, other = false, n = 0;
  for (let k = 0, o = 0; k < TEXELS; k++, o += 4) {
    const q = (d[o] * 31 + 127) / 255 | 0;
    // (the texel's byte, and its texelLow over it: one compare a texel, and the byte alone into RLE)
    const v = q > 0 ? (q << 3) | Math.min(5, d[o + 1] >> 5) | ((d[o + 1] & 31) << 8) : 0;
    if (v === prev && run < 256) {
      run++;
      continue;
    }
    if (run) {
      RLE[w++] = prev;
      RLE[w++] = run - 1;
      if (prev) LOWS[n++] = prev >> 8;
    }
    if (v) {
      any = true;
      if (v >> 8 !== RAINBOW_LOW) other = true;
    }
    prev = v;
    run = 1;
  }
  RLE[w++] = prev;
  RLE[w++] = run - 1;
  if (prev) LOWS[n++] = prev >> 8;
  if (!any) return '';
  const code = base64(RLE, w);
  if (!other) return code;
  let fw = 0;
  for (let p = 0; p < n; ) {
    const low = LOWS[p];
    let e = p + 1;
    while (e < n && e - p < 256 && LOWS[e] === low) e++;
    OWNERS[fw++] = texelOwner(low);
    OWNERS[fw++] = e - p - 1;
    p = e;
  }
  return code + '~' + base64(OWNERS, fw);
}

/**
 * Decodes encodeMask() into a mask's data (settled: no reveal, no serial). False if corrupt. Painted pairs past what its owners name are Rainbow's, and all
 * of them are if its owners' part is spoiled: a broken '~' part loses whose the paint is, never the paint.
 */
export function decodeMask(str: string, d: Uint8Array): boolean {
  let bin: string, own = '', cut: number;
  try {
    cut = str.indexOf('~');
    bin = atob(cut < 0 ? str : str.slice(0, cut));
  } catch {
    return false;
  }
  if (cut >= 0)
    try {
      own = atob(str.slice(cut + 1));
    } catch {
      /* spoiled: Rainbow's, all of it */
    }
  let k = 0, f = 0, left = 0, low = RAINBOW_LOW;
  for (let i = 0; i + 1 < bin.length; i += 2) {
    const v = bin.charCodeAt(i);
    const q = v >> 3;
    if (q) {
      if (!left) {
        if (f + 1 < own.length) {
          low = texelLow(ownerOf(own.charCodeAt(f)));
          left = own.charCodeAt(f + 1) + 1;
          f += 2;
        } else {
          low = RAINBOW_LOW;
          left = Infinity;
        }
      }
      left--;
    }
    const cov = q ? Math.round((q * 255) / 31) : 0;
    const g = q ? Math.min(5, v & 7) * 32 + low : 0;
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
  const dist = Math.sqrt(d2), banded = s.layout === LAYOUT_RING;
  // (&boom's ring, as rows() has it: its hole bare, its inner edge as soft and warped as its outer; the Moon keeps it by place, and without these its hole
  // filled in with the pinwheel when the place came back: the review's M70)
  if (banded && dist < s.ring - 3.5) return false;
  const a = Math.atan2(wz, wx), lut = p.lut, warp = p.warp;
  let f = a * (SHAPE_LUT / (Math.PI * 2));
  if (f < 0) f += SHAPE_LUT;
  const k = f | 0, t = f - k, k1 = k + 1 < SHAPE_LUT ? k + 1 : 0;
  const e = lut[k] * (1 - t) + lut[k1] * t;
  let c = (e - dist) / 2.6 + 0.5;
  if (banded) c = Math.min(c, (dist - s.ring - warp[k] * 2.2) / 2.6 + 0.5);
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
    // (and in a faction with its strongest rows named, only those slots)
    const strong = banded ? lookOf(s.faction ?? FACTION_RAINBOW).ring?.ground : undefined;
    if (strong) hue = strong[hue % strong.length];
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
