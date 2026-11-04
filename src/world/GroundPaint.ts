import * as THREE from 'three';
import { config } from '../config';
import { globals } from '../render/materials';
import { HUE_RAMPS, Ramp } from '../render/palette';
import { uploadRect } from '../render/upload';
import { arrival, bandHue, blastDots, blastEdge, LAYOUT_BANDS, SHAPE_LUT, specFromArray, specToArray, type BlastDot, type BlastSpec } from '../game/blastLayout';
import { resolveIdScheme, type CityData, type IdScheme } from './PaintState';

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

/**
 * Saved tiles, by the data's id scheme (PaintState's IdScheme; ground paint goes with the building paint
 * around it). Old bakes ('rank'): `strugglebus.ground.v2:` (SF, as main has it; other cities
 * `strugglebus.ground.v2.<slug>:`). OSM bakes: `strugglebus.ground.v4:` (`v4.<slug>:`), beside the
 * building paint's strugglebus.paint.v3 (v3 is skipped: feat/osm's code before "ids" wrote it beside
 * paint.v2 whatever the data was). Loading an OSM bake drops that city's v2 and v3 tiles (splats around
 * buildings that are grey there); an old bake never reads or touches the v3 / v4 tiles.
 */
export function groundStorePrefix(slug: string, scheme: IdScheme): string {
  return groundPrefix(slug, scheme === 'osm' ? 'v4' : 'v2');
}
/** Tile stores an OSM load drops for its city: the rank one, and feat/osm's pre-"ids" one. */
const GROUND_STALE_ON_OSM = ['v2', 'v3'];
function groundPrefix(slug: string, v: string): string {
  return slug === 'sf' ? `strugglebus.ground.${v}:` : `strugglebus.ground.${v}.${slug}:`;
}
/** SF's first prototype's saved blast list (feat/blast only, never shipped): dropped on load, as main does. */
const OLD_KEY = 'strugglebus.ground.v1';
/** Painted tiles kept in storage (a few KB each); the longest-untouched wash away first. */
const MAX_TILES = 160;
/** Blasts kept for a tile that wasn't loaded when they landed (oldest dropped). */
const MAX_PENDING = 6;
/**
 * ?moon: open-ground paint is kept by where it is on the Moon, in pictures of their own laid on latitude and longitude: GEO_T degrees of latitude on a side, as wide on the ground in longitude
 * (up to 50 times wider in degrees near a pole), GROUND_N texels a side, about 1.2 m, finer than a tile's 2 m. Every blast that lands is drawn once more into a scratch tile and copied into them
 * (fold), and a tile that comes in, on whatever map, copies its paint out of them in one pass (pictureInto). So a slide or a map made again round the bus finds it where it was, all of it, at
 * once. GEO_PICS are kept, the longest untouched going first, as MAX_TILES tiles are; that's about 14 km2 of painted ground. The first account's reviews, 2026-11-04: kept by tile of a map that
 * slides it came back 131 km off and a new map wiped it; kept as a list of 32 blasts a cell, a place painted a lot lost its oldest, and came back a blast at a time over seconds.
 */
const GEO_T = 0.005;
const GEO_PICS = 600;

/** ?moon: the map's x, z (m) and the Moon's latitude and longitude (degrees), each into `out`, on the map as it is when asked. */
export interface GroundGeo {
  toLatLon(x: number, z: number, out: number[]): void;
  toXZ(lat: number, lon: number, out: number[]): void;
}
/** A picture of the paint on a patch of the Moon (GEO_T): its texels as a tile mask's, coverage and hue, kept encoded and opened when it's read or drawn on. */
interface GeoPic {
  t: number;
  enc: string;
  data: Uint8Array | null;
  dirty: boolean;
}
/** A row of pictures' width in longitude, degrees. */
const geoLonW = (i: number) => GEO_T / Math.max(0.02, Math.cos(((i + 0.5) * GEO_T * Math.PI) / 180));
/** A longitude taken round to 0..360, the pictures' own grid: column j of row i runs from j * geoLonW(i), and the last column of a row is the short one before 360. */
const lon360 = (lon: number) => (((lon + 180) % 360) + 360) % 360;
const geoCols = (i: number) => Math.floor(360 / geoLonW(i)) + 1;

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
  /** ground paint tone (config.splat): light offset, sidewalk lift, curb weight, - */
  uGroundTone: { value: new THREE.Vector4(-0.14, 0.12, 0.7, 0) },
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
uniform vec4 uGroundTone;
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

/** ?moon's pictures by place, after the world's prefix (useGeo), and the lists of blasts the first build kept by place, which are drawn into them once and dropped. */
const GEO_KEY = 'gpic:';
const GEO_OLD = 'geo:';

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
  /** A new blast will paint these tiles (keys "tx,tz"); called before its paint is drawn. */
  onTilesTouched: ((keys: string[]) => void) | null = null;

  /** ?moon: kept by place, not by tile (useGeo), and the blasts so kept, by cell */
  private geo: GroundGeo | null = null;
  private readonly geoPics = new Map<string, GeoPic>();
  /** pictures opened, the last read first out once there are more than 48 */
  private readonly geoOpen: string[] = [];
  private readonly geoTmp = [0, 0, 0];
  private readonly geoTmp2 = [0, 0, 0];
  /** the tiles' localStorage key prefix (null: the id scheme is unknown, nothing is read or written) */
  private readonly prefix: string | null;
  readonly scheme: IdScheme | null;
  private readonly sf: boolean;

  /** `city`: city.json (its slug + "ids"), or just the slug; `scheme` overrides (see PaintState resolveIdScheme). */
  constructor(tileSize: number, city: string | CityData = 'sf', scheme?: IdScheme) {
    const slug = typeof city === 'string' ? city : city.slug;
    this.sf = slug === 'sf';
    this.scheme = resolveIdScheme(city, scheme);
    this.prefix = this.scheme ? groundStorePrefix(slug, this.scheme) : null;
    this.tileSize = tileSize;
    this.cell = tileSize / GROUND_N;
    this.empty = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.empty.needsUpdate = true;
    // (an unknown scheme: storageOk stays false, nothing is read, written or dropped)
    const prefix = this.prefix;
    if (prefix) {
      try {
        if (this.sf) localStorage.removeItem(OLD_KEY);
        // an OSM bake: this city's rank-era (and pre-"ids") tiles are dropped, never applied
        const stale = this.scheme === 'osm' ? GROUND_STALE_ON_OSM.map((v) => groundPrefix(slug, v)) : null;
        const old: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && stale && stale.some((p) => k.startsWith(p))) old.push(k);
          if (!k || !k.startsWith(prefix) || k.startsWith(prefix + GEO_KEY) || k.startsWith(prefix + GEO_OLD)) continue;
          const rec = parseTile(localStorage.getItem(k));
          if (rec) this.store.set(k.slice(prefix.length), rec);
        }
        for (const k of old) localStorage.removeItem(k);
        this.storageOk = true;
      } catch {
        /* private mode / blocked: paint lives for this session only */
      }
    }
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.persist());
  }

  /**
   * ?moon: from here open-ground paint is kept by place on the Moon, not by tile (GEO_T). What the tile store held for this world, kept by tiles of some map before, means no place any more, and
   * is dropped; the first build's lists of blasts by place are drawn into the pictures, once.
   */
  useGeo(g: GroundGeo) {
    this.geo = g;
    const prefix = this.prefix;
    if (!this.storageOk || !prefix) return;
    try {
      for (const k of this.store.keys()) localStorage.removeItem(prefix + k);
      this.store.clear();
      const gp = prefix + GEO_KEY, op = prefix + GEO_OLD, old: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith(op)) old.push(k);
        if (!k.startsWith(gp)) continue;
        try {
          const o = JSON.parse(localStorage.getItem(k) ?? '') as { t?: number; m?: string };
          if (typeof o.m === 'string' && o.m.length) this.geoPics.set(k.slice(gp.length), { t: typeof o.t === 'number' ? o.t : 0, enc: o.m, data: null, dirty: false });
        } catch {
          /* corrupt: dropped on the next write here */
        }
      }
      for (const k of old) {
        try {
          const rows = JSON.parse(localStorage.getItem(k) ?? '[]') as unknown[];
          const o = this.geoTmp;
          for (const r of Array.isArray(rows) ? rows : []) {
            if (!Array.isArray(r) || r.length < 6 || !Array.isArray(r[5])) continue;
            const sp = specFromArray(r[5] as number[]);
            if (!sp || !Number.isFinite(r[1]) || !Number.isFinite(r[2])) continue;
            g.toXZ(r[1] as number, r[2] as number, o);
            sp.x = o[0];
            sp.z = o[1];
            if (Number.isFinite(r[3]) && Number.isFinite(r[4])) {
              g.toXZ(r[3] as number, r[4] as number, o);
              sp.ox = o[0];
              sp.oz = o[1];
            }
            this.fold(sp);
          }
        } catch {
          /* corrupt: dropped */
        }
        localStorage.removeItem(k);
      }
      this.saveGeo(Infinity);
    } catch {
      /* blocked: kept for the session */
    }
  }

  /** A new map of the same world (?moonland's, made again round the bus): what memory holds of the one before goes. What's kept by place (useGeo) stays, and comes in with the new map's tiles. */
  newMap() {
    if (!this.geo) {
      this.resetAll();
      return;
    }
    this.store.clear();
    this.saveQueue.length = 0;
    this.saveSet.clear();
  }

  /** Pictures of paint kept by place (useGeo), for QA. */
  get geoCount(): number {
    return this.geoPics.size;
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
  tileUniforms(): Record<'tGround' | 'uGroundOn' | 'uGroundLive' | 'uGroundLive2' | 'uGroundTone', THREE.IUniform> {
    const u = blastUniforms;
    return { tGround: { value: this.empty }, uGroundOn: { value: 0 }, uGroundLive: u.uGroundLive, uGroundLive2: u.uGroundLive2, uGroundTone: u.uGroundTone };
  }

  /**
   * ?moon: the map slides by (dx, dz), whole tiles (dtx, dtz) (City.slide). Every tile's key, mask and origin come over, what's being painted on them, and what's
   * saved for them: it's the place's paint, wherever the map's middle is. `moved`: what's been moved already, each once.
   */
  slide(dtx: number, dtz: number, dx: number, dz: number, moved: Set<object>) {
    const key = (k: string) => {
      const c = k.indexOf(',');
      return `${Number(k.slice(0, c)) - dtx},${Number(k.slice(c + 1)) - dtz}`;
    };
    const remap = <V>(m: Map<string, V>, f?: (v: V) => void) => {
      const all = [...m];
      m.clear();
      for (const [k, v] of all) {
        f?.(v);
        m.set(key(k), v);
      }
    };
    remap(this.masks, (t) => {
      t.ox -= dx;
      t.oz -= dz;
    });
    remap(this.loaded, (t) => {
      t.ox -= dx;
      t.oz -= dz;
    });
    remap(this.store);
    remap(this.replaying);
    this.saveQueue.splice(0, this.saveQueue.length, ...this.saveQueue.map(key));
    const saving = [...this.saveSet].map(key);
    this.saveSet.clear();
    for (const k of saving) this.saveSet.add(k);
    for (const [n, keys] of this.serialTiles) this.serialTiles.set(n, keys.map(key));
    this.ready.splice(0, this.ready.length, ...this.ready.map(key));
    // (a blast's spec is one object wherever it's held: each moves once)
    const specs = new Set<BlastSpec>();
    for (const j of this.jobs) {
      specs.add(j.spec);
      if (j.only) j.only = key(j.only);
      for (const t of j.tiles) t.key = key(t.key);
      if (j.p) {
        specs.add(j.p.spec);
        j.p.minX -= dx;
        j.p.maxX -= dx;
        j.p.minZ -= dz;
        j.p.maxZ -= dz;
        for (const d of j.p.dots) {
          d.x -= dx;
          d.z -= dz;
        }
      }
    }
    for (const rec of this.store.values()) for (const sp of rec.p) specs.add(sp);
    for (const sp of specs) {
      if (moved.has(sp)) continue;
      moved.add(sp);
      sp.x -= dx;
      sp.z -= dz;
    }
  }

  /**
   * A terrain tile streamed in: its saved mask is decoded at once (one pass
   * over 16k texels) and shown with the tile; blasts that reached it while it
   * was away are queued for work().
   */
  attach(tx: number, tz: number, ox: number, oz: number, uniforms: { tGround: THREE.IUniform; uGroundOn: THREE.IUniform }) {
    const key = `${tx},${tz}`;
    this.loaded.set(key, { ox, oz, uniforms });
    if (this.geo) {
      this.pictureInto(key, ox, oz);
      return;
    }
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

  /** True if storage holds ground paint for the tile (loaded or not). ?moon: a blast kept by place reaches it. */
  hasSaved(tx: number, tz: number): boolean {
    if (this.geo) return this.geoNear(tx * this.tileSize, tz * this.tileSize);
    return this.store.has(`${tx},${tz}`);
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
    if (this.onTilesTouched) {
      const reach = spec.r * Math.max(spec.reach, spec.edge * (1 + spec.ragged) + spec.rayLen) + 4; // (as prepare)
      this.onTilesTouched(this.tilesOf({ minX: spec.x - reach, minZ: spec.z - reach, maxX: spec.x + reach, maxZ: spec.z + reach }));
    }
    return job;
  }

  /**
   * Draws a slice of the queued jobs (call once per frame): about `budget`
   * texels' worth, more if a live blast would otherwise not be drawn by its
   * impact at 30 fps.
   */
  work(budget = 1500) {
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
      if (job.serial !== null) budget = Math.max(budget, this.left(job) / Math.max(1, (job.tImpact - globals.uTime.value) * 30));
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
      if (!this.geo) this.queueSave(t.key);
    }
    if (job.serial !== null) this.serialTiles.set(job.serial, touched);
    if (this.geo) {
      // (kept by place; a tile here that it couldn't draw has it now, and one that comes in later finds it)
      this.fold(job.spec);
      for (const key of this.tilesOf(p))
        if (touched.indexOf(key) < 0 && this.loaded.has(key) && this.mask(key)) {
          this.replaying.set(key, (this.replaying.get(key) ?? 0) + 1);
          this.jobs.push({ spec: job.spec, tImpact: 0, serial: null, p: null, tiles: [], only: key, under: false });
        }
    } else for (const key of this.tilesOf(p)) if (touched.indexOf(key) < 0) this.addPending(key, job.spec);
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
    const S = config.splat;
    blastUniforms.uGroundTone.value.set(S.groundLight, S.groundSidewalk, Math.min(1, S.groundCurb), 0);
    if (this.saveTimer > 0) this.saveTimer -= dt;
    // (?moon: a picture by place a frame, as the tiles go)
    else if (this.geo) this.saveGeo(1);
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
    this.geoPics.clear();
    this.geoOpen.length = 0;
    const prefix = this.prefix;
    if (!prefix) return;
    try {
      if (this.sf) localStorage.removeItem(OLD_KEY);
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  }

  /** Save every changed tile now (page hide). */
  persist() {
    if (this.geo) this.saveGeo(Infinity);
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
    // (kept by place, not by tile: useGeo)
    if (this.geo) return true;
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
    const prefix = this.prefix;
    if (!this.storageOk || !prefix) return;
    // the longest-untouched tiles wash away first
    while (this.store.size > MAX_TILES && this.evictOldest(key)) { /* evicted one */ }
    const raw = JSON.stringify({ t: rec.t, m: rec.m ?? '', p: rec.p.map(specToArray) });
    for (let tries = 0; tries < 6; tries++) {
      try {
        localStorage.setItem(prefix + key, raw);
        return;
      } catch {
        // storage full: make room
        if (!this.evictOldest(key)) return;
      }
    }
  }

  /** ?moon: a picture by place, opened (decoded) to read or draw on; null when there's none and `make` is false. */
  private geoPic(key: string, make: boolean): Uint8Array | null {
    let pic = this.geoPics.get(key);
    if (!pic) {
      if (!make) return null;
      this.geoPics.set(key, (pic = { t: Date.now(), enc: '', data: null, dirty: false }));
    }
    if (!pic.data) {
      pic.data = new Uint8Array(TEXELS * 4);
      if (pic.enc && !decodeMask(pic.enc, pic.data)) pic.enc = '';
      this.geoOpen.push(key);
      // (a picture open is 64 KB: only the last 48 read stay so, the rest close again, saved first)
      while (this.geoOpen.length > 48) {
        const k = this.geoOpen.shift()!, q = this.geoPics.get(k);
        if (!q || !q.data || k === key) continue;
        if (q.dirty) this.writeGeo(k, q);
        q.data = null;
      }
    }
    return pic.data;
  }

  /**
   * ?moon: a blast that landed, drawn once more into scratch tiles on this map's grid and copied from there into the pictures it reaches, by place: each picture texel takes the scratch texel
   * under it, as `put` lays settled paint over what's there.
   */
  private fold(spec: BlastSpec) {
    const g = this.geo!, ts = this.tileSize, p = this.prepare(spec);
    const scratch = new Map<string, TileMask>();
    for (const key of this.tilesOf(p)) {
      const c = key.indexOf(','), tx = Number(key.slice(0, c)), tz = Number(key.slice(c + 1));
      const m = { ox: tx * ts, oz: tz * ts, data: new Uint8Array(TEXELS * 4) } as unknown as TileMask;
      this.rows(m, p, null, 0, GROUND_N - 1, null, false);
      this.dots(m, p, null, null);
      scratch.set(key, m);
    }
    // (the pictures the blast's box reaches, in latitude and longitude)
    const box = this.boxOf(p.minX, p.minZ, p.maxX, p.maxZ);
    if (!box) return;
    const now = Date.now(), cs = this.cell;
    this.eachPic(box, (i, j, w) => {
      const key = `${i},${j}`, d = this.geoPic(key, true)!;
      // (the picture's corners on this map, and its texels between them; a picture is 150 m, and the map is smooth over it)
      const lat0 = i * GEO_T, lon0 = j * w - 180, c00 = [0, 0], c10 = [0, 0], c01 = [0, 0], c11 = [0, 0];
      g.toXZ(lat0, lon0, c00);
      g.toXZ(lat0, lon0 + w, c10);
      g.toXZ(lat0 + GEO_T, lon0, c01);
      g.toXZ(lat0 + GEO_T, lon0 + w, c11);
      let any = false;
      for (let b = 0; b < GROUND_N; b++) {
        const v = (b + 0.5) / GROUND_N;
        for (let a = 0; a < GROUND_N; a++) {
          const u = (a + 0.5) / GROUND_N;
          const x = (c00[0] * (1 - u) + c10[0] * u) * (1 - v) + (c01[0] * (1 - u) + c11[0] * u) * v;
          const z = (c00[1] * (1 - u) + c10[1] * u) * (1 - v) + (c01[1] * (1 - u) + c11[1] * u) * v;
          if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
          const tx = Math.floor(x / ts), tz = Math.floor(z / ts), m = scratch.get(`${tx},${tz}`);
          if (!m) continue;
          const i2 = Math.min(GROUND_N - 1, Math.floor((x - m.ox) / cs)), j2 = Math.min(GROUND_N - 1, Math.floor((z - m.oz) / cs));
          const q = (j2 * GROUND_N + i2) * 4, cov = m.data[q];
          if (!cov) continue;
          const t = (b * GROUND_N + a) * 4, old = d[t];
          d[t] = Math.max(old, cov);
          if (cov >= 128 || cov > old) d[t + 1] = m.data[q + 1];
          any = true;
        }
      }
      if (any) {
        const pic = this.geoPics.get(key)!;
        pic.t = now;
        pic.dirty = true;
      }
    });
    this.saveTimer = 0.8;
  }

  /**
   * ?moon: a tile comes in, and its paint is copied out of the pictures by place in one pass: each of its texels takes the picture texel at its place. What's in flight and lands later is drawn
   * live as ever.
   */
  private pictureInto(key: string, ox: number, oz: number) {
    const g = this.geo!, ts = this.tileSize;
    if (!this.geoPics.size || !this.geoNear(ox, oz)) return;
    const m = this.mask(key);
    if (!m) return;
    // (its corners' places, and its texels' between them, the longitudes taken round from the first; near a pole each texel's own)
    const c = [[ox, oz], [ox + ts, oz], [ox, oz + ts], [ox + ts, oz + ts]].map(([x, z]) => {
      g.toLatLon(x, z, this.geoTmp);
      return [this.geoTmp[0], this.geoTmp[1]];
    });
    const polar = c.some((q) => Math.abs(q[0]) > 85);
    for (let k = 1; k < 4; k++) c[k][1] = c[0][1] + ((((c[k][1] - c[0][1] + 180) % 360) + 360) % 360) - 180;
    const d = m.data, o = this.geoTmp2, cs = this.cell;
    let any = false, lastKey = '', pd: Uint8Array | null = null;
    for (let j = 0; j < GROUND_N; j++) {
      const v = (j + 0.5) / GROUND_N;
      for (let i = 0; i < GROUND_N; i++) {
        const u = (i + 0.5) / GROUND_N;
        let lat: number, lon: number;
        if (polar) {
          g.toLatLon(ox + (i + 0.5) * cs, oz + (j + 0.5) * cs, o);
          lat = o[0];
          lon = o[1];
        } else {
          lat = (c[0][0] * (1 - u) + c[1][0] * u) * (1 - v) + (c[2][0] * (1 - u) + c[3][0] * u) * v;
          lon = (c[0][1] * (1 - u) + c[1][1] * u) * (1 - v) + (c[2][1] * (1 - u) + c[3][1] * u) * v;
        }
        const pi = Math.floor(lat / GEO_T), w = geoLonW(pi), L = lon360(lon), pj = Math.floor(L / w), pk = `${pi},${pj}`;
        if (pk !== lastKey) {
          lastKey = pk;
          pd = this.geoPics.has(pk) ? this.geoPic(pk, false) : null;
        }
        if (!pd) continue;
        const a = Math.min(GROUND_N - 1, Math.floor((L / w - pj) * GROUND_N)), b = Math.min(GROUND_N - 1, Math.floor((lat / GEO_T - pi) * GROUND_N));
        const q = (b * GROUND_N + a) * 4, cov = pd[q];
        if (!cov) continue;
        const t = (j * GROUND_N + i) * 4;
        d[t] = Math.max(d[t], cov);
        d[t + 1] = pd[q + 1];
        any = true;
      }
    }
    if (!any) return;
    m.x0 = 0;
    m.z0 = 0;
    m.x1 = GROUND_N - 1;
    m.z1 = GROUND_N - 1;
    this.queueDirty(m);
    this.ready.push(key);
  }

  /** ?moon: a picture by place lies under the tile at (ox, oz). */
  private geoNear(ox: number, oz: number): boolean {
    if (!this.geoPics.size) return false;
    const box = this.boxOf(ox, oz, ox + this.tileSize, oz + this.tileSize);
    let found = false;
    if (box) this.eachPic(box, (i, j) => {
      if (this.geoPics.has(`${i},${j}`)) found = true;
    });
    return found;
  }

  /** ?moon: a box on this map, in latitude and longitude, its longitudes taken round from its first corner's so one on the date line is one span; near a pole, every longitude. */
  private boxOf(x0: number, z0: number, x1: number, z1: number): { la0: number; la1: number; lo0: number; lo1: number } | null {
    const g = this.geo!, o = this.geoTmp;
    let la0 = 90, la1 = -90, lo0 = Infinity, lo1 = -Infinity, ref = NaN;
    for (let c = 0; c < 4; c++) {
      g.toLatLon(c & 1 ? x1 : x0, c & 2 ? z1 : z0, o);
      if (Number.isNaN(ref)) ref = o[1];
      const lon = ref + ((((o[1] - ref + 180) % 360) + 360) % 360) - 180;
      la0 = Math.min(la0, o[0]);
      la1 = Math.max(la1, o[0]);
      lo0 = Math.min(lo0, lon);
      lo1 = Math.max(lo1, lon);
    }
    if (!Number.isFinite(lo0)) return null;
    if (la1 > 89) la1 = 90;
    if (la0 < -89) la0 = -90;
    if (la1 >= 90 || la0 <= -90) {
      lo0 = -180;
      lo1 = 180;
    }
    return { la0, la1, lo0, lo1 };
  }

  /** ?moon: each picture a box reaches, by row and column, on the pictures' own grid (lon360), round the date line. */
  private eachPic(box: { la0: number; la1: number; lo0: number; lo1: number }, f: (i: number, j: number, w: number) => void) {
    const i0 = Math.max(Math.floor(-90 / GEO_T), Math.floor(box.la0 / GEO_T)), i1 = Math.min(Math.floor(90 / GEO_T) - 1, Math.floor(box.la1 / GEO_T));
    const span = box.lo1 - box.lo0, L0 = lon360(box.lo0), L1 = L0 + span;
    for (let i = i0; i <= i1; i++) {
      const w = geoLonW(i), n = geoCols(i);
      const walk = (a: number, b: number) => {
        for (let j = Math.floor(a / w); j <= Math.min(n - 1, Math.floor(b / w)); j++) f(i, j, w);
      };
      // (a span past 360 goes on from 0, where column 0 starts: the last column of a row is the short one)
      if (span >= 359.999) walk(0, 360);
      else if (L1 < 360) walk(L0, L1);
      else {
        walk(L0, 360);
        walk(0, L1 - 360);
      }
    }
  }

  /** ?moon: the pictures drawn on since they were saved, one a call or all (`most`), the longest untouched going first when there are more than GEO_PICS. */
  private saveGeo(most: number) {
    let n = 0;
    for (const [k, pic] of this.geoPics) {
      if (!pic.dirty) continue;
      this.writeGeo(k, pic);
      if (++n >= most) break;
    }
  }

  private writeGeo(key: string, pic: GeoPic) {
    if (pic.data) pic.enc = encodeMask(pic.data);
    pic.dirty = false;
    const prefix = this.prefix;
    if (!this.storageOk || !prefix) return;
    while (this.geoPics.size > GEO_PICS && this.evictGeo(key)) { /* evicted one */ }
    const raw = JSON.stringify({ t: pic.t, m: pic.enc });
    for (let tries = 0; tries < 6; tries++) {
      try {
        localStorage.setItem(prefix + GEO_KEY + key, raw);
        return;
      } catch {
        if (!this.evictGeo(key)) return;
      }
    }
  }

  private evictGeo(except: string): boolean {
    let best: string | null = null, bt = Infinity;
    for (const [k, pic] of this.geoPics) if (k !== except && pic.t < bt) {
      bt = pic.t;
      best = k;
    }
    if (best === null) return false;
    this.geoPics.delete(best);
    const at = this.geoOpen.indexOf(best);
    if (at >= 0) this.geoOpen.splice(at, 1);
    try {
      if (this.prefix) localStorage.removeItem(this.prefix + GEO_KEY + best);
    } catch {
      /* blocked */
    }
    return true;
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
    if (!this.prefix) return;
    try {
      localStorage.removeItem(this.prefix + key);
    } catch {
      /* blocked */
    }
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

  /** Texels a started job still has to draw. */
  private left(job: GroundJob): number {
    let n = 0;
    for (const t of job.tiles) if (this.masks.get(t.key) === t.m) n += Math.max(0, t.j1 - t.j + 1) * (t.i1 - t.i0 + 1) + (t.dots ? 0 : 150);
    return n;
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
        if (s.layout === LAYOUT_BANDS) hue = bandHue(s, s.x + wx, s.z + wz);
        else if (dist > 1.5) {
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
