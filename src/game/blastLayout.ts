import { config } from '../config';
import { HUE_COUNT } from '../render/palette';

// The shape of one dragon-breath explosion, shared by the gameplay (which
// buildings bloom in which hue, when), the ground paint rasterizer and the
// particles (where the flung blobs land). Everything that ends up painted on
// the ground derives from a BlastSpec through a seeded RNG, so a saved list of
// specs redraws the exact same splats after a reload.
//
// Timing: the shockwave leaves the impact at config.splat.waveSpeed and
// decelerates exponentially toward ringReach x radius, so a building d meters
// out blooms at arrival(d): the whole base blast lands in ~0.3 s, fastest at
// the center (it reads as an explosion, not a cascade).

/** Everything needed to redraw one blast's ground paint (persisted as a flat number array). */
export interface BlastSpec {
  x: number;
  z: number;
  /** blast radius (m) */
  r: number;
  /** center hue 0..5 */
  hue: number;
  seed: number;
  layout: number;
  sectors: number;
  ring: number;
  twist: number;
  edge: number;
  ragged: number;
  rays: number;
  rayLen: number;
  reach: number;
  dots: number;
  blobs: number;
}

/** A spatter dot beyond the edge (a flung blob lands on it, or it sits still). */
export interface BlastDot {
  x: number;
  z: number;
  /** distance from the impact (m) */
  d: number;
  /** radius across / along the flight direction (m) and the flight direction */
  rad: number;
  elong: number;
  ang: number;
  hue: number;
  /** flung blob (true) or static spatter (false) */
  blob: boolean;
}

const SPEC_FIELDS = ['x', 'z', 'r', 'hue', 'seed', 'layout', 'sectors', 'ring', 'twist', 'edge', 'ragged', 'rays', 'rayLen', 'reach', 'dots', 'blobs'] as const;

export function specToArray(s: BlastSpec): number[] {
  return SPEC_FIELDS.map((k) => (k === 'x' || k === 'z' || k === 'r' ? Math.round(s[k] * 10) / 10 : Math.round(s[k] * 1000) / 1000));
}

export function specFromArray(a: number[]): BlastSpec | null {
  if (!Array.isArray(a) || a.length < SPEC_FIELDS.length || !a.every((v) => Number.isFinite(v))) return null;
  const s = {} as Record<string, number>;
  SPEC_FIELDS.forEach((k, i) => (s[k] = a[i]));
  return s as unknown as BlastSpec;
}

/** Radius of a blast dropped from `drop` meters above the impact. */
export function blastRadiusFor(drop = 0): number {
  const S = config.splat;
  const d = Math.max(0, Math.min(S.dropMax, drop));
  return S.blastRadius * (1 + ((S.dropGain300 - 1) * d) / 300);
}

export function makeBlastSpec(x: number, z: number, r: number, hue: number, seed: number): BlastSpec {
  const S = config.splat;
  return {
    x, z, r, hue, seed: seed >>> 0,
    layout: S.hueLayout, sectors: Math.max(1, Math.round(S.hueSectors)), ring: S.hueRing, twist: S.hueTwist,
    edge: S.groundRadius, ragged: S.groundRagged, rays: Math.round(S.groundRays), rayLen: S.rayLength,
    reach: S.spatterReach, dots: Math.round(S.spatterDots), blobs: Math.round(S.blobs),
  };
}

/** Outer reach of the shockwave (m). */
export function waveMax(r: number): number {
  return r * config.splat.ringReach;
}

/** Seconds after impact at which the decelerating shockwave reaches distance d. */
export function arrival(d: number, r: number): number {
  const R = waveMax(r);
  const v0 = Math.max(1, config.splat.waveSpeed);
  return -(R / v0) * Math.log(1 - Math.min(Math.max(d, 0), 0.985 * R) / R);
}

export const wrapHue = (h: number) => ((Math.round(h) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT;

/**
 * Hue at an offset from the impact. Pinwheel: rainbow sectors by angle (with
 * a twist, so they swirl); rings: rainbow bands by distance; spiral: both.
 * `warp` (radians / meters of noise) roughens the boundaries on the ground.
 */
export function layoutHue(s: BlastSpec, dx: number, dz: number, warpA = 0, warpD = 0): number {
  const d = Math.hypot(dx, dz) + warpD;
  if (d < 1e-3) return s.hue;
  let a = Math.atan2(dz, dx) + warpA + s.twist * d;
  a = a / (Math.PI * 2);
  a -= Math.floor(a);
  const sector = Math.floor(a * s.sectors + 0.5) % s.sectors;
  const ring = Math.floor(d / Math.max(1, s.ring));
  const off = s.layout === 1 ? ring : s.layout === 2 ? sector + ring : sector;
  return wrapHue(s.hue + off);
}

/** Tiny seeded RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SHAPE_LUT = 256;

/** The splat's edge radius around the impact as an angular lookup table (m), and its maximum. */
export function blastEdge(s: BlastSpec): { lut: Float32Array; max: number } {
  const rand = rng(s.seed ^ 0x9e3779b9);
  const base = s.r * s.edge;
  // lobes: a few low harmonics make a lumpy blob, higher ones a ragged rim
  const harm = [2, 3, 5, 7, 11, 17];
  const amp = [0.35, 0.3, 0.22, 0.16, 0.1, 0.07];
  const ph = harm.map(() => rand() * Math.PI * 2);
  const lut = new Float32Array(SHAPE_LUT);
  for (let k = 0; k < SHAPE_LUT; k++) {
    const a = (k / SHAPE_LUT) * Math.PI * 2;
    let n = 0;
    for (let h = 0; h < harm.length; h++) n += amp[h] * Math.sin(harm[h] * a + ph[h]);
    lut[k] = base * (1 + s.ragged * n);
  }
  // splash rays: each only touches the few LUT entries within its half-width
  // (this runs once per blast, cold: keep it to a few hundred steps)
  const step = (Math.PI * 2) / SHAPE_LUT;
  for (let i = 0; i < s.rays; i++) {
    const ra = rand() * Math.PI * 2, len = s.rayLen * (0.35 + 0.65 * rand()) * s.r, w = 0.05 + 0.07 * rand();
    const kc = Math.round(ra / step), kw = Math.ceil(w / step);
    for (let q = kc - kw; q <= kc + kw; q++) {
      const da = Math.abs(q * step - ra);
      if (da >= w) continue;
      const k = ((q % SHAPE_LUT) + SHAPE_LUT) % SHAPE_LUT;
      const rr = base + len * Math.pow(1 - da / w, 1.6);
      if (rr > lut[k]) lut[k] = rr;
    }
  }
  let max = 0;
  for (let k = 0; k < SHAPE_LUT; k++) if (lut[k] > max) max = lut[k];
  return { lut, max };
}

/** Edge radius at angle a (radians) from the LUT. */
export function edgeAt(lut: Float32Array, a: number): number {
  let f = (a / (Math.PI * 2)) * SHAPE_LUT;
  f -= Math.floor(f / SHAPE_LUT) * SHAPE_LUT;
  const i = Math.floor(f);
  const t = f - i;
  return lut[i % SHAPE_LUT] * (1 - t) + lut[(i + 1) % SHAPE_LUT] * t;
}

/** Spatter dots beyond (and just inside) the edge: flung blobs first, then still drops. */
export function blastDots(s: BlastSpec, edge: { lut: Float32Array }): BlastDot[] {
  const rand = rng(s.seed ^ 0x51ed27);
  const out: BlastDot[] = [];
  const n = s.blobs + s.dots;
  for (let i = 0; i < n; i++) {
    const blob = i < s.blobs;
    const a = rand() * Math.PI * 2;
    const e = edgeAt(edge.lut, a);
    // blobs fly far (they are the big ones); still spatter hugs the edge
    const u = rand();
    const reachOut = s.r * s.reach;
    const d = blob ? e * 0.85 + (reachOut - e * 0.85) * Math.sqrt(u) : e * (0.95 + 0.35 * u * u);
    const rad = blob ? 1.3 + 1.6 * rand() * (1 - 0.4 * (d / reachOut)) : 0.7 + 1.1 * rand();
    const dx = Math.cos(a) * d, dz = Math.sin(a) * d;
    out.push({ x: s.x + dx, z: s.z + dz, d, rad, elong: 1 + (blob ? 1.4 : 0.8) * rand(), ang: a, hue: wrapHue(layoutHue(s, dx, dz) + (rand() < 0.2 ? (rand() < 0.5 ? 1 : -1) : 0)), blob });
  }
  return out;
}

/** Flight time of the flung blob landing on dot (s). */
export function blobFlight(dot: BlastDot): number {
  return config.splat.blobTime + config.splat.blobTimePerM * dot.d;
}
