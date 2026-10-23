import * as THREE from 'three';
import { config } from '../config';
import { HUE_RAMPS, Ramp } from '../render/palette';
import { uploadRect } from '../render/upload';
import { arrival, blastDots, blastEdge, makeBlastSpec, SHAPE_LUT, specFromArray, specToArray, type BlastDot, type BlastSpec } from '../game/blastLayout';

// Paint on the ground: streets, sidewalks and parks splattered by blasts.
//
// One small RGBA8 mask per terrain tile (128 x 128 texels = 2 m, the same grid
// as the tile's class texture), created only once paint lands on that tile:
//   r = coverage (bilinear in the shader + noise threshold -> organic edges)
//   g = hue * 32 + 16 (nearest, looked up at a noise-warped position)
//   b = reveal delay after impact in 1/100 s, a = live blast serial (0 = settled)
// A live blast is drawn a few rows per frame while the projectile is in the
// air (begin -> work), and lands with one texSubImage2D per touched tile
// (land); the shader keeps freshly painted texels hidden until the shockwave
// (or the flung blob that makes that dot) arrives. Texels that were already
// painted change hue only at the impact (under the flash).
//
// Persistence: the settled result, not the history. Each painted tile is one
// localStorage entry under a new key prefix: its mask as coverage (5 bits) +
// hue (3 bits) per texel, run-length coded, base64 (a few KB), decoded in one
// pass (16k texels) the moment the tile streams in, so saved paint shows up
// with the tile however many blasts made it. Blasts that reach a tile that
// isn't loaded are kept on that tile's entry (a handful at most) and drawn
// when it arrives. Nothing is ever redrawn synchronously at an impact.

const STORE_PREFIX = 'strugglebus.ground.v2:';
/** The first prototype's saved blast list (feat/blast only, never shipped): dropped on load. */
const OLD_KEY = 'strugglebus.ground.v1';
/** Painted tiles kept in storage (a few KB each); the longest-untouched wash away first. */
const MAX_TILES = 160;
/** Blasts kept for a tile that wasn't loaded when they landed (oldest dropped). */
const MAX_PENDING = 6;
export const GROUND_N = 128;

/** Uniforms every material that shows the blast shares (terrain, buildings). */
export const blastUniforms = {
  /** shockwave: center x, z, impact time, blast radius */
  uBlastRing: { value: new THREE.Vector4(0, 0, -1000, 1) },
  /** shockwave: center hue, ring width (m), launch speed (m/s), max reach (m) */
  uBlastRing2: { value: new THREE.Vector4(0, 9, 300, 90) },
  /** live ground reveals, 4 slots (blasts can overlap in flight): serial, impact time, serial, impact time */
  uGroundLive: { value: new THREE.Vector4(-1, -1000, -1, -1000) },
  uGroundLive2: { value: new THREE.Vector4(-1, -1000, -1, -1000) },
};

const HUES = HUE_RAMPS.map((r) => r.toFixed(1)).join(', ');

/** GLSL: the rainbow shockwave ring racing out across up-facing surfaces. Needs GLSL_COMMON. */
export const GLSL_BLAST_RING = /* glsl */ `
uniform vec4 uBlastRing;
uniform vec4 uBlastRing2;
const float SB_RING_HUES[6] = float[6](${HUES});
float sbRingHash(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.17))) * 43758.5453); }
// true where the ring covers this point: ramp / light / glow out
bool sbRing(vec3 wp, vec3 n, out float ramp, out float light, out float glow) {
  float age = uTime - uBlastRing.z;
  float R = uBlastRing2.w;
  // (uniform early-out: before the impact and once the wave has died, ~5 time constants)
  if (age < 0.0 || age * uBlastRing2.z > 5.0 * R || n.y < 0.35) return false;
  float r = R * (1.0 - exp(-age * uBlastRing2.z / R));
  float k = r / R;
  if (k > 0.97) return false;
  float d = length(wp.xz - uBlastRing.xy);
  float w = uBlastRing2.y * (1.0 - 0.55 * k) * smoothstep(0.0, 0.08, age + 0.02);
  float x = (r - d) / w; // 0 at the leading edge
  if (x < 0.0 || x > 1.0) return false;
  // dies by dissolving into pixels (never alpha)
  if (sbRingHash(floor(wp.xz * 0.8)) < k * k * 1.15 - 0.12) return false;
  float band = floor(x * 7.0);
  ramp = band < 0.5 ? ${Ramp.GLOW_WHITE}.0 : SB_RING_HUES[int(mod(uBlastRing2.x + band - 1.0, 6.0))];
  light = band < 0.5 ? 0.95 : 0.78;
  glow = (1.0 - k) * 0.95;
  return true;
}
`;

/** GLSL: ground paint lookup for terrain tiles. Needs GLSL_COMMON. */
export const GLSL_GROUND_PAINT = /* glsl */ `
uniform sampler2D tGround;
uniform float uGroundOn;
uniform vec4 uGroundLive;
uniform vec4 uGroundLive2;
const float SB_GROUND_HUES[6] = float[6](${HUES});
float sbgHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sbgNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sbgHash(i), sbgHash(i + vec2(1.0, 0.0)), f.x), mix(sbgHash(i + vec2(0.0, 1.0)), sbgHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec4 sbgTap(ivec2 p) { return texelFetch(tGround, clamp(p, ivec2(0), ivec2(${GROUND_N - 1})), 0); }
// coverage of one texel, 0 while a live blast hasn't reached it yet; age since it was revealed out
float sbgCov(vec4 s, out float age) {
  age = 100.0;
  float ser = floor(s.a * 255.0 + 0.5);
  if (ser > 0.5) {
    float rv = s.b * 2.55;
    float t = ser == uGroundLive.x ? uGroundLive.y : ser == uGroundLive.z ? uGroundLive.w
      : ser == uGroundLive2.x ? uGroundLive2.y : ser == uGroundLive2.z ? uGroundLive2.w : -1000.0;
    age = uTime - t - rv;
    if (age < 0.0) return 0.0;
  }
  return s.r;
}
// paint on the ground at a world position (uv over the tile 0..1): false = bare ground
bool sbGroundPaint(vec3 wp, vec2 uv, out float ramp, out float edge, out float wet, out float fresh) {
  if (uGroundOn < 0.5) return false;
  // organic edges: look the mask up through a smooth ~1.5 m warp
  vec2 wv = vec2(sbgNoise(wp.xz * 0.23), sbgNoise(wp.xz * 0.23 + 31.7)) - 0.5;
  vec2 g = uv * ${GROUND_N}.0 - 0.5 + wv * 1.5;
  ivec2 i0 = ivec2(floor(g));
  vec2 f = fract(g);
  vec4 s00 = sbgTap(i0), s10 = sbgTap(i0 + ivec2(1, 0)), s01 = sbgTap(i0 + ivec2(0, 1)), s11 = sbgTap(i0 + ivec2(1, 1));
  float a00, a10, a01, a11;
  float c00 = sbgCov(s00, a00), c10 = sbgCov(s10, a10), c01 = sbgCov(s01, a01), c11 = sbgCov(s11, a11);
  float cov = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
  float thr = 0.5 + (sbgNoise(wp.xz * 0.9) - 0.5) * 0.28;
  if (cov <= thr) return false;
  // hue: the strongest tap
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y) * c00, f.x * (1.0 - f.y) * c10, (1.0 - f.x) * f.y * c01, f.x * f.y * c11);
  vec4 s = s00; float age = a00; float m = w.x;
  if (w.y > m) { m = w.y; s = s10; age = a10; }
  if (w.z > m) { m = w.z; s = s01; age = a01; }
  if (w.w > m) { s = s11; age = a11; }
  ramp = SB_GROUND_HUES[int(clamp(floor(s.g * 255.0 / 32.0), 0.0, 5.0))];
  edge = cov - thr;
  // wet blotches: big soft spots a step brighter
  wet = smoothstep(0.62, 0.7, sbgNoise(wp.xz * 0.31 + 7.3));
  fresh = exp(-age * 5.0);
  return true;
}
`;

interface TileMask {
  /** world origin of the tile (its class texture's corner) */
  ox: number;
  oz: number;
  data: Uint8Array;
  tex: THREE.DataTexture;
  /** dirty rect in texels (x0 > x1 = clean); queued in GroundPaint.dirty */
  dirty: boolean;
  /** its tile streamed out (texture disposed) */
  gone: boolean;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  uniforms: { tGround: THREE.IUniform; uGroundOn: THREE.IUniform } | null;
}

/** One tile's saved paint: its encoded mask, and blasts that reached it while it wasn't loaded. */
interface SavedTile {
  /** last painted (Date.now()): the longest-untouched tiles are evicted first */
  t: number;
  m: string | null;
  p: BlastSpec[];
}

const WAVE_LUT = 64;

interface JobTile {
  key: string;
  m: TileMask;
  /** next row to draw, last row, column span */
  j: number;
  j1: number;
  i0: number;
  i1: number;
  dots: boolean;
  /** over-paint held back until impact: (offset, coverage, hue) triples */
  deferred: number[];
}

/**
 * A blast being drawn: live (in flight, serial > 0, drawn while the
 * projectile flies, landed at impact) or a replay of a blast that reached a
 * tile while it wasn't loaded (serial null, settled, one tile). Replays draw
 * in order; once a newer live blast starts on their tile they go `under` it
 * (they only fill bare ground), so paint always stacks chronologically
 * without anything being finished synchronously.
 */
export interface GroundJob {
  spec: BlastSpec;
  tImpact: number;
  serial: number | null;
  p: Prepared | null;
  tiles: JobTile[];
  /** replay: the one tile it redraws */
  only: string | null;
  under: boolean;
}

interface Prepared {
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

const TEXELS = GROUND_N * GROUND_N;
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

function parseTile(raw: string | null): SavedTile | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { t?: number; m?: string; p?: number[][] };
    const p: BlastSpec[] = [];
    if (Array.isArray(o.p)) for (const a of o.p) {
      const s = specFromArray(a);
      if (s) p.push(s);
    }
    const m = typeof o.m === 'string' && o.m.length ? o.m : null;
    if (!m && !p.length) return null;
    return { t: typeof o.t === 'number' && Number.isFinite(o.t) ? o.t : 0, m, p };
  } catch {
    return null;
  }
}

export class GroundPaint {
  private readonly tileSize: number;
  private readonly cell: number;
  private readonly masks = new Map<string, TileMask>();
  /** loaded terrain tiles: key -> origin + material uniforms (masks are created lazily) */
  private readonly loaded = new Map<string, { ox: number; oz: number; uniforms: TileMask['uniforms'] }>();
  /** what storage holds, by tile key (mirrored in memory so a tile decodes with no storage read) */
  private readonly store = new Map<string, SavedTile>();
  private storageOk = false;
  /** tiles whose mask changed since it was saved: written one per frame once saveTimer runs out */
  private readonly saveQueue: string[] = [];
  private readonly saveSet = new Set<string>();
  private readonly empty: THREE.DataTexture;
  private saveTimer = 0;
  private serial = 0;
  /** serial -> tile keys it stamped (cleared when the serial comes around again) */
  private readonly serialTiles = new Map<number, string[]>();
  private liveSlot = 0;
  private readonly jobs: GroundJob[] = [];
  /** masks with a dirty rect to upload (no Map iteration per frame) */
  private readonly dirty: TileMask[] = [];
  /** tile key -> replays still queued for it */
  private readonly replaying = new Map<string, number>();
  /** tiles whose saved paint just went on screen: onTileReady fires for them on the next work() */
  private readonly ready: string[] = [];
  private landed = 0;
  /** A tile's saved paint is on screen (trees standing in it can be painted now). */
  onTileReady: ((tx: number, tz: number) => void) | null = null;

  constructor(tileSize: number) {
    this.tileSize = tileSize;
    this.cell = tileSize / GROUND_N;
    this.empty = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.empty.needsUpdate = true;
    try {
      localStorage.removeItem(OLD_KEY);
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(STORE_PREFIX)) continue;
        const rec = parseTile(localStorage.getItem(k));
        if (rec) this.store.set(k.slice(STORE_PREFIX.length), rec);
      }
      this.storageOk = true;
    } catch {
      /* private mode / blocked: paint lives for this session only */
    }
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.persist());
    this.warm();
  }

  /** Painted tiles in storage. */
  get tileCount(): number {
    return this.store.size;
  }

  /** Blasts landed this session. */
  get landedCount(): number {
    return this.landed;
  }

  /** Jobs still queued (live blasts in flight + replays), for QA. */
  get queued(): number {
    return this.jobs.length;
  }

  /** Uniforms a terrain tile material needs (call before creating it). */
  tileUniforms(): { tGround: THREE.IUniform; uGroundOn: THREE.IUniform; uGroundLive: THREE.IUniform; uGroundLive2: THREE.IUniform } {
    return { tGround: { value: this.empty }, uGroundOn: { value: 0 }, uGroundLive: blastUniforms.uGroundLive, uGroundLive2: blastUniforms.uGroundLive2 };
  }

  /**
   * A terrain tile streamed in: its saved mask is decoded at once (one pass
   * over 16k texels) and shown with the tile; blasts that reached it while it
   * was away are queued for work().
   */
  attach(tx: number, tz: number, ox: number, oz: number, uniforms: { tGround: THREE.IUniform; uGroundOn: THREE.IUniform }) {
    const key = `${tx},${tz}`;
    this.loaded.set(key, { ox, oz, uniforms });
    const rec = this.store.get(key);
    if (!rec) return;
    const m = this.mask(key)!;
    if (rec.m && !decodeMask(rec.m, m.data)) rec.m = null; // corrupt entry: dropped on its next save
    if (rec.p.length) {
      this.replaying.set(key, rec.p.length);
      for (const s of rec.p) this.jobs.push({ spec: s, tImpact: 0, serial: null, p: null, tiles: [], only: key, under: false });
    }
    this.ready.push(key);
  }

  detach(tx: number, tz: number) {
    const key = `${tx},${tz}`;
    // unsaved paint goes to storage before the mask is dropped
    if (this.saveSet.has(key)) {
      this.saveTile(key, true);
      this.saveSet.delete(key);
      this.saveQueue.splice(this.saveQueue.indexOf(key), 1);
    }
    this.loaded.delete(key);
    this.replaying.delete(key);
    const m = this.masks.get(key);
    if (m) {
      m.gone = true;
      m.tex.dispose();
      this.masks.delete(key);
    }
    // queued replays of this tile are dropped (its entry still holds them: they redraw when it comes back)
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].only === key) this.jobs.splice(i, 1);
  }

  /** True if the tile has any ground paint. */
  has(tx: number, tz: number): boolean {
    return this.masks.has(`${tx},${tz}`);
  }

  /** Paint at a world point (CPU, e.g. for trees): coverage 0..1 and hue, or null. */
  sample(x: number, z: number): { cov: number; hue: number } | null {
    const tx = Math.floor(x / this.tileSize), tz = Math.floor(z / this.tileSize);
    const m = this.masks.get(`${tx},${tz}`);
    if (!m) return null;
    const ox = m.ox, oz = m.oz;
    const i = Math.min(GROUND_N - 1, Math.max(0, Math.floor((x - ox) / this.cell)));
    const j = Math.min(GROUND_N - 1, Math.max(0, Math.floor((z - oz) / this.cell)));
    const o = (j * GROUND_N + i) * 4;
    return { cov: m.data[o] / 255, hue: Math.min(5, Math.floor(m.data[o + 1] / 32)) };
  }

  /**
   * A projectile is in the air and will explode on spec at tImpact (game
   * clock): its paint is drawn by work() over the next frames, hidden.
   */
  begin(spec: BlastSpec, tImpact: number): GroundJob {
    // live serial (1..255) in one of four uniform slots
    this.serial = (this.serial % 255) + 1;
    const ser = this.serial;
    const stale = this.serialTiles.get(ser);
    if (stale) for (const key of stale) this.clearSerial(key, ser);
    this.serialTiles.delete(ser);
    const L = this.liveSlot < 2 ? blastUniforms.uGroundLive.value : blastUniforms.uGroundLive2.value;
    if (this.liveSlot % 2 === 0) L.set(ser, tImpact, L.z, L.w);
    else L.set(L.x, L.y, ser, tImpact);
    this.liveSlot = (this.liveSlot + 1) % 4;
    const job: GroundJob = { spec, tImpact, serial: ser, p: null, tiles: [], only: null, under: false };
    this.jobs.push(job);
    return job;
  }

  /** Draws a slice of the queued jobs (call once per frame): about `budget` texels' worth. */
  work(budget = 2400) {
    if (this.ready.length) {
      for (const key of this.ready) {
        if (!this.loaded.has(key)) continue;
        const c = key.indexOf(',');
        this.onTileReady?.(Number(key.slice(0, c)), Number(key.slice(c + 1)));
      }
      this.ready.length = 0;
    }
    for (let n = 0; n < this.jobs.length && budget > 0; ) {
      const job = this.jobs[n];
      if (!job.p) {
        // setting a blast up (shape, dots, tiles) is a slice of its own
        this.start(job);
        return;
      }
      budget = this.step(job, budget);
      if (job.serial === null && this.finished(job)) {
        // a replay is done: off the queue, its tile shows it and saves
        this.jobs.splice(n, 1);
        this.replayed(job);
      } else n++;
    }
  }

  /**
   * The blast lands: finish its own rows (normally all drawn in flight),
   * apply the over-paint, mark the touched tiles for one upload each and for
   * saving. Tiles it reaches that it couldn't draw (not loaded at the tap, or
   * streamed out and back since) get it as a replay. Returns its spatter dots
   * so the particles can fling blobs onto exactly those spots.
   */
  land(job: GroundJob): BlastDot[] {
    if (!job.p) this.start(job);
    const i = this.jobs.indexOf(job);
    if (i >= 0) this.jobs.splice(i, 1);
    this.step(job, Infinity);
    const p = job.p!;
    const touched: string[] = [];
    for (const t of job.tiles) {
      if (this.masks.get(t.key) !== t.m) continue;
      const d = t.m.data, q = t.deferred;
      for (let k = 0; k < q.length; k += 3) this.put(d, q[k], q[k + 1], q[k + 2], 0, null, false, null);
      q.length = 0;
      this.markDirty(t.m, p);
      touched.push(t.key);
      this.queueSave(t.key);
    }
    if (job.serial !== null) this.serialTiles.set(job.serial, touched);
    for (const key of this.tilesOf(p)) if (touched.indexOf(key) < 0) this.addPending(key, job.spec);
    this.saveTimer = 0.8;
    this.landed++;
    return p.dots;
  }

  /** Paint a blast immediately, with no reveal (tests / tools). */
  blast(spec: BlastSpec, tImpact: number): BlastDot[] {
    return this.land(this.begin(spec, tImpact));
  }

  /** Upload dirty masks (one texSubImage2D each); save changed tiles, one per frame, on a debounce. */
  flush(renderer: THREE.WebGLRenderer, dt: number) {
    if (this.saveTimer > 0) this.saveTimer -= dt;
    else if (this.saveQueue.length) {
      // a tile still drawing replays saves once they're done
      for (let k = 0; k < this.saveQueue.length; k++) {
        const key = this.saveQueue[k];
        if (!this.saveTile(key, false)) continue;
        this.saveQueue.splice(k, 1);
        this.saveSet.delete(key);
        break;
      }
    }
    if (!this.dirty.length) return;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    for (let k = 0; k < this.dirty.length; k++) {
      const m = this.dirty[k];
      m.dirty = false;
      if (m.x0 > m.x1 || m.gone) continue;
      if (!uploadRect(renderer, m.tex, m.x0, m.z0, m.x1 - m.x0 + 1, m.z1 - m.z0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, 4)) m.tex.needsUpdate = true;
      m.x0 = GROUND_N;
      m.z0 = GROUND_N;
      m.x1 = -1;
      m.z1 = -1;
    }
    this.dirty.length = 0;
  }

  resetAll() {
    this.store.clear();
    this.saveQueue.length = 0;
    this.saveSet.clear();
    try {
      localStorage.removeItem(OLD_KEY);
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORE_PREFIX)) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  }

  /** Save every changed tile now (page hide). */
  persist() {
    for (const key of this.saveQueue) this.saveTile(key, true);
    this.saveQueue.length = 0;
    this.saveSet.clear();
  }

  // ------------------------------------------------------------------ internals

  private queueSave(key: string) {
    if (this.saveSet.has(key)) return;
    this.saveSet.add(key);
    this.saveQueue.push(key);
  }

  /**
   * Write one tile's entry. A loaded tile saves its mask (and drops the blasts
   * it has drawn); one still drawing replays waits (false) unless forced, and
   * then keeps them. An unloaded tile writes its entry as it stands.
   */
  private saveTile(key: string, force: boolean): boolean {
    const m = this.masks.get(key);
    let rec = this.store.get(key) ?? null;
    if (m) {
      const busy = this.replaying.has(key);
      if (busy && !force) return false;
      const enc = encodeMask(m.data);
      const p = busy && rec ? rec.p : [];
      if (!enc && !p.length) {
        this.dropTile(key);
        return true;
      }
      rec = { t: Date.now(), m: enc || null, p };
      this.store.set(key, rec);
    }
    if (rec) this.writeTile(key, rec);
    return true;
  }

  /** A blast reached a tile it couldn't draw: keep it on that tile's entry (and draw it now if the tile is here). */
  private addPending(key: string, spec: BlastSpec) {
    let rec = this.store.get(key);
    if (!rec) this.store.set(key, (rec = { t: 0, m: null, p: [] }));
    rec.t = Date.now();
    rec.p.push(spec);
    if (rec.p.length > MAX_PENDING) rec.p.shift();
    if (this.loaded.has(key) && this.mask(key)) {
      this.replaying.set(key, (this.replaying.get(key) ?? 0) + 1);
      this.jobs.push({ spec, tImpact: 0, serial: null, p: null, tiles: [], only: key, under: false });
    }
    this.writeTile(key, rec);
  }

  private writeTile(key: string, rec: SavedTile) {
    if (!this.storageOk) return;
    // the longest-untouched tiles wash away first
    while (this.store.size > MAX_TILES && this.evictOldest(key)) { /* evicted one */ }
    const raw = JSON.stringify({ t: rec.t, m: rec.m ?? '', p: rec.p.map(specToArray) });
    for (let tries = 0; tries < 6; tries++) {
      try {
        localStorage.setItem(STORE_PREFIX + key, raw);
        return;
      } catch {
        // storage full: make room
        if (!this.evictOldest(key)) return;
      }
    }
  }

  private evictOldest(except: string): boolean {
    let best: string | null = null, bt = Infinity;
    for (const [k, r] of this.store) if (k !== except && r.t < bt) {
      bt = r.t;
      best = k;
    }
    if (best === null) return false;
    this.dropTile(best);
    return true;
  }

  private dropTile(key: string) {
    this.store.delete(key);
    try {
      localStorage.removeItem(STORE_PREFIX + key);
    } catch {
      /* blocked */
    }
  }

  /** Run the rasterizer and codec once on a scratch mask, so the first real blast doesn't pay for cold code. */
  private warm() {
    const p = this.prepare(makeBlastSpec(0, 0, config.splat.blastRadius, 0, 0x5eed));
    const h = this.tileSize / 2;
    const m: TileMask = { ox: -h, oz: -h, data: new Uint8Array(TEXELS * 4), tex: this.empty, dirty: false, gone: true, x0: 0, z0: 0, x1: -1, z1: -1, uniforms: null };
    const q: number[] = [];
    this.rows(m, p, 1, 0, GROUND_N - 1, q, false);
    this.rows(m, p, 1, 0, GROUND_N - 1, q, false); // over its own paint: the deferred path
    this.rows(m, p, null, 0, GROUND_N - 1, null, true);
    this.dots(m, p, 1, q);
    decodeMask(encodeMask(m.data), m.data);
  }

  private tilesOf(p: { minX: number; minZ: number; maxX: number; maxZ: number }): string[] {
    const ts = this.tileSize;
    const out: string[] = [];
    for (let tz = Math.floor(p.minZ / ts); tz <= Math.floor(p.maxZ / ts); tz++)
      for (let tx = Math.floor(p.minX / ts); tx <= Math.floor(p.maxX / ts); tx++) out.push(`${tx},${tz}`);
    return out;
  }

  private prepare(spec: BlastSpec): Prepared {
    const reach = spec.r * Math.max(spec.reach, spec.edge * (1 + spec.ragged) + spec.rayLen) + 4;
    const e = blastEdge(spec);
    const warp = new Float32Array(SHAPE_LUT);
    const ph = (spec.seed % 1000) * 0.01;
    for (let k = 0; k < SHAPE_LUT; k++) {
      const a = (k / SHAPE_LUT) * Math.PI * 2;
      warp[k] = 0.65 * Math.sin(a * 3 + ph) + 0.35 * Math.sin(a * 7 - ph * 1.7);
    }
    const wave = new Float32Array(WAVE_LUT);
    for (let k = 0; k < WAVE_LUT; k++) wave[k] = arrival((k / (WAVE_LUT - 1)) * (e.max + 3), spec.r);
    return { spec, lut: e.lut, warp, wave, max: e.max, dots: blastDots(spec, e), minX: spec.x - reach, minZ: spec.z - reach, maxX: spec.x + reach, maxZ: spec.z + reach };
  }

  private start(job: GroundJob) {
    const p = this.prepare(job.spec);
    job.p = p;
    const cs = this.cell;
    const R = p.max + 3;
    for (const key of job.only ? [job.only] : this.tilesOf(p)) {
      if (!this.loaded.has(key)) continue;
      const m = this.mask(key);
      if (!m) continue;
      // replays still queued here are older: they go under this blast
      if (job.serial !== null) for (const r of this.jobs) if (r.only === key) r.under = true;
      const s = job.spec;
      const i0 = Math.max(0, Math.floor((s.x - R - m.ox) / cs)), i1 = Math.min(GROUND_N - 1, Math.floor((s.x + R - m.ox) / cs));
      const j0 = Math.max(0, Math.floor((s.z - R - m.oz) / cs)), j1 = Math.min(GROUND_N - 1, Math.floor((s.z + R - m.oz) / cs));
      job.tiles.push({ key, m, j: j0, j1: i0 > i1 ? j0 - 1 : j1, i0, i1, dots: false, deferred: [] });
    }
  }

  /** Draw up to `budget` texels of a started job; returns the budget left. */
  private step(job: GroundJob, budget: number): number {
    const p = job.p!;
    const live = job.serial !== null;
    for (const t of job.tiles) {
      if (this.masks.get(t.key) !== t.m) continue; // tile streamed out
      while (t.j <= t.j1 && budget > 0) {
        this.rows(t.m, p, job.serial, t.j, t.j, live ? t.deferred : null, job.under);
        budget -= t.i1 - t.i0 + 1;
        t.j++;
      }
      if (t.j <= t.j1) return budget;
      if (!t.dots) {
        this.dots(t.m, p, job.serial, live ? t.deferred : null);
        t.dots = true;
        budget -= 150;
      }
    }
    return budget;
  }

  /** Every tile of the job drawn (or gone). */
  private finished(job: GroundJob): boolean {
    for (const t of job.tiles) if (this.masks.get(t.key) === t.m && (t.j <= t.j1 || !t.dots)) return false;
    return true;
  }

  /** A replay finished: upload its rect, save the tile once nothing more is queued for it. */
  private replayed(job: GroundJob) {
    const key = job.only;
    if (!key) return;
    for (const t of job.tiles) if (this.masks.get(t.key) === t.m) this.markDirty(t.m, job.p!);
    const left = (this.replaying.get(key) ?? 1) - 1;
    if (left > 0) {
      this.replaying.set(key, left);
      return;
    }
    this.replaying.delete(key);
    if (!this.masks.has(key)) return;
    this.queueSave(key);
    this.ready.push(key);
  }

  private mask(key: string): TileMask | null {
    let m = this.masks.get(key);
    if (m) return m;
    const t = this.loaded.get(key);
    if (!t) return null;
    const data = new Uint8Array(TEXELS * 4);
    const tex = new THREE.DataTexture(data, GROUND_N, GROUND_N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    m = { ox: t.ox, oz: t.oz, data, tex, dirty: false, gone: false, x0: GROUND_N, z0: GROUND_N, x1: -1, z1: -1, uniforms: t.uniforms };
    this.masks.set(key, m);
    if (t.uniforms) {
      t.uniforms.tGround.value = tex;
      t.uniforms.uGroundOn.value = 1;
    }
    return m;
  }

  private clearSerial(key: string, ser: number) {
    const m = this.masks.get(key);
    if (!m) return;
    const d = m.data;
    for (let o = 3; o < d.length; o += 4) if (d[o] === ser) d[o] = 0;
    m.x0 = 0;
    m.z0 = 0;
    m.x1 = GROUND_N - 1;
    m.z1 = GROUND_N - 1;
    this.queueDirty(m);
  }

  /** Main splat, rows ja..jb of one tile. serial = null: settled. deferred: hold over-paint back (live). under: bare ground only. */
  private rows(m: TileMask, p: Prepared, serial: number | null, ja: number, jb: number, deferred: number[] | null, under: boolean) {
    const s = p.spec;
    const cs = this.cell;
    const ox = m.ox, oz = m.oz;
    const d = m.data;
    const R = p.max + 3;
    const i0 = Math.max(0, Math.floor((s.x - R - ox) / cs)), i1 = Math.min(GROUND_N - 1, Math.floor((s.x + R - ox) / cs));
    const j0 = Math.max(ja, Math.floor((s.z - R - oz) / cs)), j1 = Math.min(jb, Math.floor((s.z + R - oz) / cs));
    const live = serial !== null;
    const S = s.sectors;
    const ringW = 1 / Math.max(1, s.ring);
    const lut = p.lut, warp = p.warp, wave = p.wave;
    const lutK = SHAPE_LUT / (Math.PI * 2);
    const R2 = R * R;
    const waveK = (WAVE_LUT - 1) / Math.max(1, R);
    // main splat: soft-edged blob, rainbow layout with a warped (hand-painted)
    // boundary. Hot loop (thousands of texels at impact): LUTs, no hypot/log.
    for (let j = j0; j <= j1; j++) {
      const wz = oz + (j + 0.5) * cs - s.z;
      for (let i = i0; i <= i1; i++) {
        const wx = ox + (i + 0.5) * cs - s.x;
        const d2 = wx * wx + wz * wz;
        if (d2 > R2) continue;
        const dist = Math.sqrt(d2);
        const a = Math.atan2(wz, wx);
        let f = a * lutK;
        if (f < 0) f += SHAPE_LUT;
        const k = f | 0;
        const t = f - k;
        const k1 = k + 1 < SHAPE_LUT ? k + 1 : 0;
        const e = lut[k] * (1 - t) + lut[k1] * t;
        const c = (e - dist) / 2.6 + 0.5;
        if (c <= 0.02) continue;
        let hue = s.hue;
        if (dist > 1.5) {
          const wd = warp[k] * 2.2;
          let u = (a + warp[k1] * 0.16 + s.twist * (dist + wd)) * (1 / (Math.PI * 2)) + 0.012 * Math.sin(dist * 0.21);
          u -= Math.floor(u);
          const sector = Math.floor(u * S + 0.5) % S;
          const ring = Math.floor((dist + wd) * ringW);
          const off = s.layout === 1 ? ring : s.layout === 2 ? sector + ring : sector;
          hue = (((s.hue + off) % 6) + 6) % 6;
        }
        this.put(d, (j * GROUND_N + i) * 4, c > 1 ? 1 : c, hue, live ? wave[Math.min(WAVE_LUT - 1, Math.round(dist * waveK))] : 0, serial, under, deferred);
      }
    }
  }

  /** Spatter dots stretched along their flight direction, on one tile. */
  private dots(m: TileMask, p: Prepared, serial: number | null, deferred: number[] | null) {
    const s = p.spec;
    const cs = this.cell;
    const ox = m.ox, oz = m.oz;
    const d = m.data;
    const live = serial !== null;
    for (const dot of p.dots) {
      const rr = dot.rad * dot.elong + 1.5;
      const di0 = Math.max(0, Math.floor((dot.x - rr - ox) / cs)), di1 = Math.min(GROUND_N - 1, Math.floor((dot.x + rr - ox) / cs));
      const dj0 = Math.max(0, Math.floor((dot.z - rr - oz) / cs)), dj1 = Math.min(GROUND_N - 1, Math.floor((dot.z + rr - oz) / cs));
      if (di0 > di1 || dj0 > dj1) continue;
      const ca = Math.cos(dot.ang), sa = Math.sin(dot.ang);
      const rv = live ? (dot.blob ? config.splat.blobTime + config.splat.blobTimePerM * dot.d : arrival(dot.d, s.r)) : 0;
      for (let j = dj0; j <= dj1; j++) {
        const wz = oz + (j + 0.5) * cs - dot.z;
        for (let i = di0; i <= di1; i++) {
          const wx = ox + (i + 0.5) * cs - dot.x;
          const along = (wx * ca + wz * sa) / dot.elong;
          const across = -wx * sa + wz * ca;
          const q = Math.sqrt(along * along + across * across);
          const c = Math.min(1, Math.max(0, (dot.rad - q) / 1.6 + 0.5));
          if (c <= 0.02) continue;
          this.put(d, (j * GROUND_N + i) * 4, c, dot.hue, rv, serial, true, deferred);
        }
      }
    }
  }

  /** Grow the tile's dirty rect by everything this blast can touch on it (dots fly past the splat). */
  private markDirty(m: TileMask, p: Prepared) {
    const cs = this.cell;
    const x0 = Math.max(0, Math.floor((p.minX - m.ox) / cs)), x1 = Math.min(GROUND_N - 1, Math.floor((p.maxX - m.ox) / cs));
    const z0 = Math.max(0, Math.floor((p.minZ - m.oz) / cs)), z1 = Math.min(GROUND_N - 1, Math.floor((p.maxZ - m.oz) / cs));
    if (x0 > x1 || z0 > z1) return;
    m.x0 = Math.min(m.x0, x0);
    m.x1 = Math.max(m.x1, x1);
    m.z0 = Math.min(m.z0, z0);
    m.z1 = Math.max(m.z1, z1);
    this.queueDirty(m);
  }

  private queueDirty(m: TileMask) {
    if (m.dirty) return;
    m.dirty = true;
    this.dirty.push(m);
  }

  /** Write one texel of new paint over whatever is there (bareOnly: only onto bare ground). */
  private put(d: Uint8Array, o: number, c: number, hue: number, reveal: number, serial: number | null, bareOnly: boolean, deferred: number[] | null) {
    const old = d[o] / 255;
    // spatter only lands on bare ground (no confetti inside a splat); a replay under a newer blast likewise
    if (bareOnly && old >= 0.5) return;
    // over old paint, a live blast changes the hue only at impact
    if (deferred && old >= 0.5) {
      deferred.push(o, c, hue);
      return;
    }
    const nc = Math.max(old, c);
    d[o] = Math.round(nc * 255);
    if (c >= 0.5 || c > old) d[o + 1] = hue * 32 + 16;
    if (serial !== null && old < 0.5 && c > 0.2) {
      // freshly painted ground waits for the shockwave; old paint just changes hue under the flash
      const rv = Math.round(Math.min(2.55, reveal) * 100);
      if (d[o + 3] !== serial || rv < d[o + 2]) d[o + 2] = rv;
      d[o + 3] = serial;
    }
  }
}
