import { config } from '../config';
import { blastDots, blastEdge, rng, SHAPE_LUT, wrapHue, type BlastDot, type BlastSpec } from '../game/blastLayout';
import { R_MOON } from './SkyModel';

// Paint on the Moon: the map the resolve reads (skyResolve.ts, spaceMoon), and the strokes it is rebuilt from. Pure TS and no three.js: tools/sky/moon-paint-check.mjs paints in Node.
//
// A blast here is the game's blast (game/blastLayout.ts): its edge, its pinwheel and its spatter come from the same seeded code, read in km on a tangent plane at the impact, so a stroke redraws the same splat.
// There are no buildings, so a level lands on the ground: hit paint and the next blast is a level up. 1 floods, 2 spreads further with a bright crown at its edge, 3 throws rainbow rays like Tycho's. Any ground takes it.
//
// One RGBA8 map, latitude and longitude, 1024 x 512 (2 MB, a texel 10.7 km at the equator, the same as the Moon's own map), one filtered read a pixel:
//   r  coverage, a ramp across the edge: bilinear, then a threshold in the shader, so an edge is a smooth contour at a fraction of a texel (GroundPaint's scheme)
//   g  hue: (h + .5) / 6. Filtered too: next to each other two hues meet on a clean contour, and only the seam from violet to red runs through the others, in a line a pixel or two wide. It picks a ramp, it is never averaged into a colour
//   b  lift: how many ramp steps brighter, 0..1. L1 0, up to the crown's and rays' 1
//   a  reveal: seconds after the impact this texel waits, in 1/100 s, 0 once settled. Fresh ground only. Paint already there is turned over by the wave too, a different way: see over()
// Five coarser levels, 21 to 341 km a texel, are this file's own, not an average: a splash must not fade away with distance, and hues mustn't mix. See mipLevel.
//
// A tap never hitches: the raster runs in slices while the shot flies (work), and the impact sends one rectangle a level, most of it a few KB, half a MB for the first level of the widest ray system near a pole.
// Settling sends one more, on the first level only. See MoonBreath.ts.
//
// What is kept is the strokes, not a raster: latitude, longitude, level, seed. The hue is seed % 6. They're rebuilt on load in order, so a level up over an old stroke redraws as it was.

const DEG = Math.PI / 180;

export const PAINT_W = 1024;
export const PAINT_H = 512;
export const PAINT_LEVELS = 6;
/** km a texel, at the equator. */
export const TEXEL_KM = (2 * Math.PI * R_MOON) / PAINT_W;

/** The flood's edge, km from the impact, by level. 100 km across at L1 is about a third of the frame's width at 300 km. */
export const EDGE_KM = [0, 50, 80, 104];
/** Seconds the wave takes to reach the edge. */
export const BLOOM_S = 1;
/** Texels a level up may run its wave over, a frame. */
const OVER_MAX = 8000;
/** The crown's width, km, inside the flood's edge. */
const CROWN_KM = 25;
/** Longest ray, km: about Tycho's. */
const RAY_KM = 1500;
const RAYS = 14;
/** The ramp across an edge, in km: wide enough that the texels a bilinear read touches at the contour all hold a hue. */
const SOFT_KM = TEXEL_KM * 2.2;
/** Hues are written this far past the edge, with no coverage, so a hue doesn't drift toward red at the rim. */
const DILATE_KM = TEXEL_KM * 2.5;
/** The lifts in b, 0..255. */
const LIFT = [0, 0, 60, 100];
const LIFT_CROWN = 255;
const LIFT_RAY = 200;
/** A spatter drop's radius, km a game metre: a drop is about a texel, as the game's are on its 2 m grid. */
const DOT_KM = 2.4;
/** A coarse texel's coverage over the sum of its four children's: an average is 0.25. A line a texel wide keeps its coverage all the way up at 0.5, and a bare average would lose it in two levels. */
const MIP_GAIN = 0.36;
const KEY = 'strugglebus.moon.v1';
/** Strokes a saved chunk holds: a save rewrites one chunk, not the list. */
const CHUNK = 64;
/** About three hours of tapping. Past this a stroke paints, and isn't kept. */
export const MAX_STROKES = 4096;

export interface PaintStroke {
  /** degrees, to 0.01: what is saved is what is drawn */
  lat: number;
  lon: number;
  level: number;
  /** the blast's seed; its hue is seed % 6 */
  seed: number;
}

export interface PaintMip {
  data: Uint8Array;
  width: number;
  height: number;
}

/** A rectangle of the first level. x1 may run past the map's right edge, and wraps. */
export interface PaintRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Where saved strokes live. Both calls may throw (a blocked store): that only means they don't persist. */
export interface PaintStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

interface Ray {
  a: number;
  len: number;
  w: number;
  hue: number;
  rand: number;
}

/** A blast being drawn. Fires at the tap, lands at the impact: its cursor runs in between. */
export interface PaintJob {
  stroke: PaintStroke;
  spec: BlastSpec;
  /** the impact and a tangent frame at it, Moon fixed */
  c: Float64Array;
  e: Float64Array;
  n: Float64Array;
  /** map bytes are written with reveal times (false: a rebuild, settled at once) */
  live: boolean;
  lut: Float32Array;
  warp: Float32Array;
  /** how far out the flood reaches, km */
  max: number;
  dots: BlastDot[];
  rays: Ray[];
  /** cursor: rows of the flood, then dots, then rays, then the coarser levels */
  j: number;
  j1: number;
  i0: number;
  iSpan: number;
  dot: number;
  ray: number;
  /** km along this ray so far */
  rayS: number;
  mip: number;
  /** what it wrote */
  rect: PaintRect;
  /** A hit on paint: the flood's rectangle as it stood, what is shown until the wave gets there (over()). Null on bare ground. */
  over: PaintOver | null;
}

/** See MoonPaint.over(). */
export interface PaintOver {
  x: number;
  y: number;
  w: number;
  h: number;
  /** the bytes before the blast, and when the wave reaches each texel */
  before: Uint8Array;
  at: Float32Array;
  last: number;
  /** what goes up this frame */
  frame: Uint8Array;
}

/** Unit vector, Moon fixed, of a place in degrees. */
export function placeOf(lat: number, lon: number, o = new Float64Array(3)): Float64Array {
  const p = lat * DEG, l = lon * DEG, c = Math.cos(p);
  o[0] = c * Math.cos(l);
  o[1] = c * Math.sin(l);
  o[2] = Math.sin(p);
  return o;
}

export class MoonPaint {
  /** coarsest last; [0] is the map the resolve reads at orbit */
  readonly mips: PaintMip[] = [];
  readonly strokes: PaintStroke[] = [];
  /** the share of the Moon's surface painted, 0..1 */
  painted = 0;
  /** written since the last save */
  private savedTo = 0;
  private readonly store: PaintStore | null;
  private nextHue = 0;
  private seed = 0;
  /** floods over the first level, 5 numbers each: where, cos of its radius, level */
  private readonly floods: number[] = [];
  /** saved strokes not drawn yet, and how many of them are */
  private queue: PaintStroke[] = [];
  private drawn = 0;
  private readonly cosLat = new Float64Array(PAINT_H);
  private readonly sinLat = new Float64Array(PAINT_H);
  private readonly cosLon = new Float64Array(PAINT_W);
  private readonly sinLon = new Float64Array(PAINT_W);
  /** a texel's share of the surface, by row */
  private readonly area = new Float64Array(PAINT_H);
  /** scratch for one blast's reach */
  private readonly p = new Float64Array(3);

  constructor(store: PaintStore | null = null, seed = 1) {
    this.store = store;
    this.seed = seed >>> 0;
    this.nextHue = seed % 6;
    for (let l = 0, w = PAINT_W, h = PAINT_H; l < PAINT_LEVELS; l++, w >>= 1, h >>= 1) this.mips.push({ data: new Uint8Array(w * h * 4), width: w, height: h });
    let sum = 0;
    for (let j = 0; j < PAINT_H; j++) {
      const lat = (0.5 - (j + 0.5) / PAINT_H) * Math.PI;
      this.cosLat[j] = Math.cos(lat);
      this.sinLat[j] = Math.sin(lat);
      sum += this.cosLat[j];
    }
    for (let j = 0; j < PAINT_H; j++) this.area[j] = this.cosLat[j] / (sum * PAINT_W);
    for (let i = 0; i < PAINT_W; i++) {
      const lon = ((i + 0.5) / PAINT_W - 0.5) * 2 * Math.PI;
      this.cosLon[i] = Math.cos(lon);
      this.sinLon[i] = Math.sin(lon);
    }
  }

  // ------------------------------------------------------------------ strokes

  /** The strokes saved on this device, queued for drawing. rebuild() draws them, in order. */
  load(): number {
    const list: PaintStroke[] = [];
    try {
      if (this.store) {
        for (let k = 0; k * CHUNK < MAX_STROKES; k++) {
          const raw = this.store.get(`${KEY}.${k}`);
          if (!raw) break;
          const a = JSON.parse(raw) as number[];
          if (!Array.isArray(a)) break;
          for (let i = 0; i + 3 < a.length; i += 4) {
            const [lat, lon, level, seed] = [a[i], a[i + 1], a[i + 2], a[i + 3]];
            if (Number.isFinite(lat) && Number.isFinite(lon) && (level === 1 || level === 2 || level === 3) && Number.isFinite(seed)) list.push({ lat, lon, level, seed: seed >>> 0 });
          }
          if (a.length < CHUNK * 4) break;
        }
      }
    } catch {
      /* blocked or spoiled: what was read is drawn, and nothing more */
    }
    this.queue = list;
    this.savedTo = list.length;
    return list.length;
  }

  /** Saved strokes still to draw. */
  get rebuilding(): boolean {
    return this.queue.length > 0;
  }

  /** Draws saved strokes for up to `ms` of the clock. True the moment the last one is done, and the coarser levels with it: the map then goes up whole, once. */
  rebuild(ms: number, now: () => number): boolean {
    if (!this.queue.length) return false;
    const end = now() + ms;
    do {
      const s = this.queue[this.drawn++];
      const job = this.begin(s, false);
      job.mip = PAINT_LEVELS;
      this.work(job, Infinity);
    } while (this.drawn < this.queue.length && now() < end);
    if (this.drawn < this.queue.length) return false;
    this.queue = [];
    this.drawn = 0;
    for (let l = 1; l < PAINT_LEVELS; l++) this.mipLevel({ x0: 0, x1: PAINT_W - 1, y0: 0, y1: PAINT_H - 1 }, l);
    return true;
  }

  /** Writes what isn't saved yet: the last chunk or two, never the list. */
  save(): void {
    if (!this.store) return;
    const n = Math.min(MAX_STROKES, this.strokes.length);
    if (this.savedTo >= n) return;
    const from = Math.floor(this.savedTo / CHUNK), to = Math.floor((n - 1) / CHUNK);
    try {
      for (let k = from; k <= to; k++) {
        const a: number[] = [];
        for (const s of this.strokes.slice(k * CHUNK, Math.min(n, (k + 1) * CHUNK))) a.push(s.lat, s.lon, s.level, s.seed);
        this.store.set(`${KEY}.${k}`, JSON.stringify(a));
      }
      this.savedTo = n;
    } catch {
      /* a blocked or full store: the paint lives for this flight */
    }
  }

  /** The hue a hit at this place starts from, and what level it makes, for the stroke to come. */
  private texelAt(lat: number, lon: number): number {
    const j = Math.max(0, Math.min(PAINT_H - 1, Math.floor((0.5 - lat / 180) * PAINT_H)));
    const i = (((Math.floor((lon / 360 + 0.5) * PAINT_W)) % PAINT_W) + PAINT_W) % PAINT_W;
    return (j * PAINT_W + i) * 4;
  }

  /** What a hit here makes: bare ground 1; paint, a level over the flood under it. Rays and spatter are paint too, and count as a first level. The glint asks every frame: no trig past the first line. */
  levelAt(lat: number, lon: number): number {
    if (this.mips[0].data[this.texelAt(lat, lon)] < 128) return 1;
    const v = placeOf(lat, lon, this.p), f = this.floods;
    let top = 1;
    for (let i = 0; i < f.length; i += 5) {
      if (f[i + 4] > top && v[0] * f[i] + v[1] * f[i + 1] + v[2] * f[i + 2] > f[i + 3]) top = f[i + 4];
    }
    return Math.min(3, top + 1);
  }

  /** A stroke for a blast landing here: an escalating hit keeps the hue it lands on, a fresh one takes the next. */
  strike(latIn: number, lonIn: number): PaintStroke {
    const lat = Math.round(latIn * 100) / 100, lon = Math.round(lonIn * 100) / 100;
    const level = this.levelAt(lat, lon);
    this.seed = (Math.imul(this.seed ^ 0x2545f491, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
    let hue = this.nextHue;
    if (level > 1) hue = Math.min(5, Math.floor((this.mips[0].data[this.texelAt(lat, lon) + 1] / 255) * 6));
    else this.nextHue = (this.nextHue + 1) % 6;
    return { lat, lon, level, seed: Math.floor(this.seed / 12) * 6 + hue };
  }

  // ------------------------------------------------------------------ a blast

  /** Everything a stroke needs before it is drawn. */
  begin(stroke: PaintStroke, live: boolean): PaintJob {
    const S = config.splat, level = stroke.level;
    const r = EDGE_KM[level] / S.groundRadius;
    // (the game's blast, its metres read as km: r is 70 to 160 here against 60 to 120, and everything in it scales with r)
    const spec: BlastSpec = {
      x: 0, z: 0, r, hue: stroke.seed % 6, seed: stroke.seed,
      layout: S.hueLayout, sectors: Math.max(1, Math.round(S.hueSectors)), ring: S.hueRing * (r / 60), twist: (S.hueTwist * 60) / r,
      edge: S.groundRadius, ragged: S.groundRagged, rays: Math.round(S.groundRays), rayLen: S.rayLength,
      reach: S.spatterReach, dots: Math.round(S.spatterDots), blobs: Math.round(S.blobs),
    };
    const e = blastEdge(spec);
    const warp = new Float32Array(SHAPE_LUT);
    const ph = (spec.seed % 1000) * 0.01;
    for (let k = 0; k < SHAPE_LUT; k++) {
      const a = (k / SHAPE_LUT) * Math.PI * 2;
      warp[k] = 0.65 * Math.sin(a * 3 + ph) + 0.35 * Math.sin(a * 7 - ph * 1.7);
    }
    const c = placeOf(stroke.lat, stroke.lon);
    const east = new Float64Array(3), north = new Float64Array(3);
    const cl = Math.cos(stroke.lon * DEG), sl = Math.sin(stroke.lon * DEG), sp = Math.sin(stroke.lat * DEG), cp = Math.cos(stroke.lat * DEG);
    east[0] = -sl;
    east[1] = cl;
    north[0] = -sp * cl;
    north[1] = -sp * sl;
    north[2] = cp;
    const rays: Ray[] = [];
    if (level >= 3) {
      const rand = rng(stroke.seed ^ 0x7a3c51);
      for (let i = 0; i < RAYS; i++) rays.push({ a: ((i + 0.7 * (rand() - 0.5)) / RAYS) * Math.PI * 2, len: RAY_KM * (0.45 + 0.55 * rand()), w: 5.5 + 5 * rand(), hue: wrapHue(spec.hue + i), rand: rand() * 1000 });
    }
    const reach = e.max + DILATE_KM + SOFT_KM;
    const rows = Math.ceil(reach / TEXEL_KM) + 1;
    const cy = Math.floor((0.5 - stroke.lat / 180) * PAINT_H), cx = Math.floor((stroke.lon / 360 + 0.5) * PAINT_W);
    const job: PaintJob = {
      stroke, spec, c, e: east, n: north, live, lut: e.lut, warp, max: e.max, dots: blastDots(spec, e), rays,
      j: Math.max(0, cy - rows), j1: Math.min(PAINT_H - 1, cy + rows), i0: 0, iSpan: 0, dot: 0, ray: 0, rayS: 0, mip: 1,
      rect: { x0: cx, x1: cx, y0: cy, y1: cy },
      over: null,
    };
    // the columns the cap covers: the widest row's, or all of them round a pole
    const ang = reach / R_MOON, pole = Math.abs(stroke.lat) * DEG + ang;
    const dLon = pole >= Math.PI / 2 - 0.02 ? Math.PI : Math.asin(Math.min(1, Math.sin(ang) / Math.max(1e-6, cp)));
    const span = Math.ceil((dLon / Math.PI) * (PAINT_W / 2)) + 1;
    job.i0 = cx - span;
    job.iSpan = Math.min(PAINT_W, span * 2 + 1);
    if (live && level > 1) job.over = this.keepOver(job);
    this.strokes.push(stroke);
    if (level > 1) this.floods.push(c[0], c[1], c[2], Math.cos((EDGE_KM[level] * 0.9) / R_MOON), level);
    return job;
  }

  /** Paint is under this blast: keep what it looks like now, for the wave to run over. */
  private keepOver(job: PaintJob): PaintOver | null {
    const w = job.iSpan, y = job.j, h = job.j1 - job.j + 1, d = this.mips[0].data;
    // (round a pole a flood's rectangle is the whole width of the map: there it turns over at the impact, as the ground's does)
    if (w * h > OVER_MAX) return null;
    const before = new Uint8Array(w * h * 4), at = new Float32Array(w * h), level = job.stroke.level;
    let any = false, last = 0;
    for (let j = 0, k = 0; j < h; j++) {
      const row = y + j, cp = this.cosLat[row], sp = this.sinLat[row];
      for (let q = 0; q < w; q++, k++) {
        const i = (((job.i0 + q) % PAINT_W) + PAINT_W) % PAINT_W, o = (row * PAINT_W + i) * 4;
        if (d[o] < 128) continue;
        any = true;
        before[k * 4] = d[o];
        before[k * 4 + 1] = d[o + 1];
        before[k * 4 + 2] = d[o + 2];
        before[k * 4 + 3] = d[o + 3];
        const c = job.c, dotc = cp * this.cosLon[i] * c[0] + cp * this.sinLon[i] * c[1] + sp * c[2];
        at[k] = this.waveAt(Math.acos(Math.min(1, dotc)) * R_MOON, level);
        if (at[k] > last) last = at[k];
      }
    }
    return any ? { x: job.i0, y, w, h, before, at, last, frame: new Uint8Array(w * h * 4) } : null;
  }

  /**
   * A level up runs out with the wave. The map holds the new paint from the impact, and the rectangle of the flood goes up each frame with what stood there before wherever the wave hasn't reached, so a hit on paint
   * turns it over at the ring, not all at once. A thousand texels or so, and only for the second it takes. Returns false once the wave has passed: the map as it stands is on the GPU.
   */
  over(p: PaintOver, age: number): boolean {
    const d = this.mips[0].data, f = p.frame, b = p.before;
    for (let j = 0, k = 0; j < p.h; j++) {
      const row = (p.y + j) * PAINT_W;
      for (let q = 0; q < p.w; q++, k++) {
        const k4 = k * 4;
        if (b[k4] && age < p.at[k]) {
          f[k4] = b[k4];
          f[k4 + 1] = b[k4 + 1];
          f[k4 + 2] = b[k4 + 2];
          f[k4 + 3] = b[k4 + 3];
        } else {
          const o = (row + (((p.x + q) % PAINT_W) + PAINT_W) % PAINT_W) * 4;
          f[k4] = d[o];
          f[k4 + 1] = d[o + 1];
          f[k4 + 2] = d[o + 2];
          f[k4 + 3] = d[o + 3];
        }
      }
    }
    return age < p.last;
  }

  /** The seconds after the impact a wave reaches `d` km out: the game's arrival(), the same exponential slowing, stretched so the flood's edge takes BLOOM_S at any level. */
  waveAt(d: number, level: number): number {
    const R = (EDGE_KM[level] * config.splat.ringReach) / config.splat.groundRadius;
    return this.waveTau(level) * -Math.log(1 - Math.min(Math.max(d, 0), 0.985 * R) / R);
  }

  /** The wave's time constant, s, by level. */
  waveTau(level: number): number {
    const R = (EDGE_KM[level] * config.splat.ringReach) / config.splat.groundRadius;
    return BLOOM_S / -Math.log(1 - EDGE_KM[level] / R);
  }

  /** How far the wave reaches, km, by level. */
  waveReach(level: number): number {
    return (EDGE_KM[level] * config.splat.ringReach) / config.splat.groundRadius;
  }

  /** The seconds a flung blob flies before it lands on `dot`: the game's law, on the wave's stretch, so a blob comes down after the wave has gone by. */
  blobTime(dot: BlastDot, level: number): number {
    return config.splat.blobTime + 0.75 * BLOOM_S * (dot.d / EDGE_KM[level]);
  }

  /** Draws up to `budget` texels of a job; true when it's done: map and coarser levels. */
  work(job: PaintJob, budget: number): boolean {
    while (job.j <= job.j1 && budget > 0) {
      this.floodRow(job, job.j++);
      budget -= job.iSpan;
    }
    if (job.j <= job.j1) return false;
    while (job.dot < job.dots.length && budget > 0) {
      this.spatter(job, job.dots[job.dot++]);
      budget -= 60;
    }
    if (job.dot < job.dots.length) return false;
    while (job.ray < job.rays.length && budget > 0) budget -= this.ray(job, job.rays[job.ray], budget);
    if (job.ray < job.rays.length) return false;
    // the coarser levels of what it wrote, a level a slice
    while (job.mip < PAINT_LEVELS && budget > 0) budget -= this.mipLevel(job.rect, job.mip++);
    return job.mip >= PAINT_LEVELS;
  }

  /** Every texel of the job's own reveal goes to 0: the bloom is over. */
  settle(job: PaintJob): void {
    const { y0, y1, x0, x1 } = job.rect, d = this.mips[0].data;
    for (let j = y0; j <= y1; j++) {
      for (let x = x0; x <= x1; x++) d[(j * PAINT_W + (x & (PAINT_W - 1))) * 4 + 3] = 0;
    }
  }

  // ------------------------------------------------------------------ the raster

  /** One texel of new paint over what is there. reveal in s; bare: only onto bare ground. Any new coverage is added to `painted`. */
  private put(job: PaintJob, o: number, row: number, c: number, hue: number, lift: number, reveal: number, bare: boolean): void {
    const d = this.mips[0].data;
    const old = d[o] / 255;
    if (bare && old >= 0.5) return;
    if (c > old) {
      d[o] = Math.round(c * 255);
      if (old < 0.5 && c >= 0.5) this.painted += this.area[row];
    }
    if (c >= 0.5 || c > old) {
      d[o + 1] = Math.round(((hue + 0.5) / 6) * 255);
      // (the soft rim keeps its own: paint that lands here later mustn't find a lift it never had)
      if (c >= 0.4 && lift > d[o + 2]) d[o + 2] = lift;
    }
    // fresh ground waits for the wave; paint that was there changes at the impact, under the flash
    if (job.live && old < 0.5 && c > 0.02) {
      const rv = Math.max(1, Math.min(255, Math.round(reveal * 100)));
      if (!d[o + 3] || rv < d[o + 3]) d[o + 3] = rv;
    }
  }

  private touch(job: PaintJob, i: number, j: number): void {
    const r = job.rect;
    if (j < r.y0) r.y0 = j;
    if (j > r.y1) r.y1 = j;
    // (columns as a run from the impact's, so one past the seam is just a bigger x)
    const cx = (r.x0 + r.x1) >> 1;
    const di = ((i - cx + 1.5 * PAINT_W) % PAINT_W) - PAINT_W / 2;
    const x = cx + di;
    if (x < r.x0) r.x0 = x;
    if (x > r.x1) r.x1 = x;
  }

  /** The game's main splat (GroundPaint.rows): a soft-edged blob, the pinwheel inside it with a warped hand-painted boundary. */
  private floodRow(job: PaintJob, j: number): void {
    const { c, e, n, spec: s, lut, warp, stroke } = job;
    const d = this.mips[0].data, level = stroke.level;
    const cp = this.cosLat[j], sp = this.sinLat[j];
    const cosMax = Math.cos((job.max + DILATE_KM) / R_MOON);
    const S = s.sectors, lutK = SHAPE_LUT / (Math.PI * 2), scale = s.r / 60;
    const crown = level >= 2 ? CROWN_KM : 0;
    const lift = LIFT[level];
    for (let q = 0; q < job.iSpan; q++) {
      const i = (((job.i0 + q) % PAINT_W) + PAINT_W) % PAINT_W;
      const vx = cp * this.cosLon[i], vy = cp * this.sinLon[i];
      const dotc = vx * c[0] + vy * c[1] + sp * c[2];
      if (dotc < cosMax) continue;
      const dist = Math.acos(Math.min(1, dotc)) * R_MOON;
      const x = vx * e[0] + vy * e[1] + sp * e[2], z = vx * n[0] + vy * n[1] + sp * n[2];
      const a = Math.atan2(z, x);
      let f = a * lutK;
      if (f < 0) f += SHAPE_LUT;
      const k = f | 0, t = f - k, k1 = k + 1 < SHAPE_LUT ? k + 1 : 0;
      const edge = lut[k] * (1 - t) + lut[k1] * t;
      const cov = (edge - dist) / SOFT_KM + 0.5;
      const o = (j * PAINT_W + i) * 4;
      let hue = s.hue;
      if (dist > 1.5 * scale) {
        const wd = warp[k] * 2.2 * scale;
        let u = (a + warp[k1] * 0.16 + s.twist * (dist + wd)) * (1 / (Math.PI * 2)) + 0.012 * Math.sin((dist * 0.21) / scale);
        u -= Math.floor(u);
        const sector = Math.floor(u * S + 0.5) % S;
        hue = (((s.hue + sector) % 6) + 6) % 6;
      }
      if (cov <= 0.02) {
        // past the edge nothing lands, but a bilinear read at the contour reaches here
        if (d[o] < 6 && dist < edge + DILATE_KM) {
          d[o + 1] = Math.round(((hue + 0.5) / 6) * 255);
          this.touch(job, i, j);
        }
        continue;
      }
      const inCrown = crown > 0 && edge - dist < crown;
      this.put(job, o, j, cov > 1 ? 1 : cov, hue, inCrown ? LIFT_CROWN : lift, this.waveAt(dist, level), false);
      this.touch(job, i, j);
    }
  }

  /** A soft disc, stretched `elong` times along `ang` (a bearing from east, at the blast), `rad` km across its short side. */
  private stamp(job: PaintJob, p: Float64Array, rad: number, elong: number, ang: number, hue: number, lift: number, reveal: number, bare: boolean): number {
    const lat = Math.asin(Math.max(-1, Math.min(1, p[2])));
    const cp = Math.max(0.04, Math.cos(lat));
    const v = (0.5 - lat / Math.PI) * PAINT_H - 0.5, u = (Math.atan2(p[1], p[0]) / (2 * Math.PI) + 0.5) * PAINT_W - 0.5;
    const reach = rad * elong + SOFT_KM * 0.5 + TEXEL_KM;
    const rj = Math.ceil(reach / TEXEL_KM), ri = Math.min(128, Math.ceil(reach / (TEXEL_KM * cp)));
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const j0 = Math.max(0, Math.round(v) - rj), j1 = Math.min(PAINT_H - 1, Math.round(v) + rj), iu = Math.round(u);
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      const dn = (v - j) * TEXEL_KM;
      for (let q = -ri; q <= ri; q++) {
        const de = (iu + q - u) * TEXEL_KM * cp;
        const along = (de * ca + dn * sa) / elong, across = -de * sa + dn * ca;
        const c = (rad - Math.sqrt(along * along + across * across)) / SOFT_KM + 0.5;
        n++;
        const i = (((iu + q) % PAINT_W) + PAINT_W) % PAINT_W, o = (j * PAINT_W + i) * 4, d = this.mips[0].data;
        if (c <= 0.02) {
          // (as the flood's rim: a hue for the bilinear read to find)
          if (d[o] < 6) {
            d[o + 1] = Math.round(((hue + 0.5) / 6) * 255);
            this.touch(job, i, j);
          }
          continue;
        }
        this.put(job, o, j, c > 1 ? 1 : c, hue, lift, reveal, bare);
        this.touch(job, i, j);
      }
    }
    return n;
  }

  /** The point `km` from the impact along bearing `a` (from east), into this.p. */
  private along(job: PaintJob, km: number, a: number): Float64Array {
    const th = km / R_MOON, ct = Math.cos(th), st = Math.sin(th), ca = Math.cos(a), sa = Math.sin(a), p = this.p;
    for (let i = 0; i < 3; i++) p[i] = job.c[i] * ct + (job.e[i] * ca + job.n[i] * sa) * st;
    return p;
  }

  /** One of the blast's spatter drops (GroundPaint.dots): on bare ground only, and a flung blob's waits for its blob. */
  private spatter(job: PaintJob, dot: BlastDot): void {
    const p = this.along(job, dot.d, dot.ang);
    const level = job.stroke.level;
    const rv = dot.blob ? this.blobTime(dot, level) : this.waveAt(dot.d, level);
    this.stamp(job, p, dot.rad * DOT_KM, dot.elong, dot.ang, dot.hue, LIFT[level], rv, true);
  }

  /** A ray, or as much of it as the budget allows: thrown out along a great circle from the flood, tapering, wandering a little, and breaking up toward its end. Over everything it crosses: it's the newest paint there. */
  private ray(job: PaintJob, r: Ray, budget: number): number {
    const step = TEXEL_KM * 0.7, level = job.stroke.level, from = EDGE_KM[level] * 0.55;
    let n = 0;
    for (let s = Math.max(from, job.rayS); ; s += step) {
      if (s >= r.len) {
        job.ray++;
        job.rayS = 0;
        return n + 1;
      }
      if (n > budget) {
        job.rayS = s;
        return n;
      }
      const x = (s - from) / (r.len - from);
      // (it comes apart past a third of the way: gaps that grow, so the end is a line of drops)
      const gap = Math.sin(s * 0.019 + r.rand) * 0.6 + Math.sin(s * 0.047 + r.rand * 1.7) * 0.4;
      if (x > 0.45 && gap < (x - 0.45) * 1.6 - 0.62) continue;
      const a = r.a + 0.035 * Math.sin(x * 4.2 + r.rand) * x;
      const w = r.w * Math.pow(1 - x, 0.55) + 2.5;
      n += this.stamp(job, this.along(job, s, a), w, 1, a, r.hue, LIFT_RAY, 0.06 + 0.85 * x * Math.sqrt(x), false);
    }
  }

  /**
   * The coarser levels over a rectangle of the first. A far view has to see what was painted, and hues never mix, so a coarse texel isn't an average: coverage is the children's, boosted, so a thin thing keeps
   * about the same coverage all the way up; hue and lift are its strongest child's. Reveal is always 0: nobody sees a bloom from up here.
   */
  private mipLevel(rect: PaintRect, l: number): number {
    const a = this.mips[l - 1], b = this.mips[l], aw = a.width, bw = b.width, ad = a.data, bd = b.data;
    const x0 = rect.x0 >> l, x1 = Math.min(rect.x1 >> l, x0 + bw - 1), y0 = rect.y0 >> l, y1 = rect.y1 >> l;
    for (let j = y0; j <= y1; j++) {
      for (let x = x0; x <= x1; x++) {
        const i = x & (bw - 1), ci = i * 2, cj = j * 2;
        let sum = 0, best = -1, g = 0, top = 0;
        for (let q = 0; q < 4; q++) {
          const o = ((cj + (q >> 1)) * aw + ci + (q & 1)) * 4;
          const r = ad[o];
          sum += r;
          const w = r * (1 + ad[o + 2] / 64);
          if (w > best) {
            best = w;
            g = ad[o + 1];
          }
          if (r >= 64 && ad[o + 2] > top) top = ad[o + 2];
        }
        const o = (j * bw + i) * 4;
        bd[o] = Math.min(255, Math.round(sum * MIP_GAIN));
        bd[o + 1] = g;
        bd[o + 2] = top;
        bd[o + 3] = 0;
      }
    }
    return (y1 - y0 + 1) * (x1 - x0 + 1) * 4;
  }

}

/** localStorage, or nothing if the browser says no. */
export function browserStore(): PaintStore | null {
  try {
    const s = globalThis.localStorage;
    return s ? { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v) } : null;
  } catch {
    return null;
  }
}
