import * as THREE from 'three';
import { config } from '../config';
import { GLSL_FACTION, lookOf } from '../render/factionLook';
import { globals } from '../render/materials';
import { Ramp } from '../render/palette';
import { uploadRect } from '../render/upload';
import { arrival, bandHue, blastDots, blastEdge, LAYOUT_BANDS, LAYOUT_POOL, LAYOUT_RING, POOL_SPREAD, SHAPE_LUT, specFromArray, specToArray, waveAt, type BlastDot, type BlastSpec } from '../game/blastLayout';
import { resolveIdScheme, type CityData, type IdScheme } from './PaintState';
import { decodeMask, encodeMask, GROUND_N, TEXELS, texelLow, texelOwner, type Prepared } from './groundMask';
import { FACTION_RAINBOW, FACTION_ROOM, ownerOf } from '../game/factions';
import { GeoPaint, IdbStore, type GroundGeo, type PicStore } from './GeoPaint';

// Paint on the ground: streets, sidewalks and parks splattered by blasts.
//
// One small RGBA8 mask per terrain tile (128 x 128 texels = 2 m, the same grid
// as the tile's class texture), created only once paint lands on that tile:
//   r = coverage (bilinear in the shader + noise threshold -> organic edges)
//   g = hue * 32 + its faction's texelLow, 16 for Rainbow (nearest, looked up at a noise-warped position; the shader reads the hue and whose it is)
//   b = reveal delay after impact in 1/100 s, a = live blast serial (0 = settled)
// A live blast is drawn a few rows per frame while the projectile is in the
// air (begin -> work), and lands with one texSubImage2D per touched tile
// (land); the shader keeps freshly painted texels hidden until the shockwave
// (or the flung blob that makes that dot) arrives. Texels that were already
// painted change hue only at the impact (under the flash).
//
// Persistence: the settled result, not the history. Each painted tile is one
// localStorage entry under a new key prefix: its mask as coverage (5 bits) +
// hue (3 bits) per texel, run-length coded, base64 (a few KB), whose paint it is after a '~' where any of it isn't Rainbow's (encodeMask), decoded in one
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
export type { GroundGeo } from './GeoPaint';
export { decodeMask, encodeMask, GROUND_N } from './groundMask';

/** Uniforms every material that shows the blast shares (terrain, buildings). */
export const blastUniforms = {
  /** shockwave: center x, z, impact time, blast radius */
  uBlastRing: { value: new THREE.Vector4(0, 0, -1000, 1) },
  /** shockwave: center hue (and 8 for each faction past Rainbow, whose blast it is: ringHue), ring width (m), launch speed (m/s), max reach (m) */
  uBlastRing2: { value: new THREE.Vector4(0, 9, 300, 90) },
  /** live ground reveals, 4 slots (blasts can overlap in flight): serial, impact time, serial, impact time */
  uGroundLive: { value: new THREE.Vector4(-1, -1000, -1, -1000) },
  uGroundLive2: { value: new THREE.Vector4(-1, -1000, -1, -1000) },
  /** ground paint tone (config.splat): light offset, sidewalk lift, curb weight, - */
  uGroundTone: { value: new THREE.Vector4(-0.14, 0.12, 0.7, 0) },
};

/** uBlastRing2.x for a blast: its centre hue, and 8 for each faction past Rainbow's, so a Rainbow blast's is the hue it always was. */
export const ringHue = (hue: number, faction: number) => hue + 8 * Math.max(0, Math.min(FACTION_ROOM, faction) - FACTION_RAINBOW);

/** GLSL: the rainbow shockwave ring racing out across up-facing surfaces, in its blast's faction's ground colours. Needs GLSL_COMMON. */
export const GLSL_BLAST_RING = /* glsl */ `
uniform vec4 uBlastRing;
uniform vec4 uBlastRing2;
${GLSL_FACTION}
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
  float rf = floor(uBlastRing2.x / 8.0);
  ramp = band < 0.5 ? ${Ramp.GLOW_WHITE}.0 : sbFacGround(sbFac(1.0 + rf), int(mod(uBlastRing2.x - 8.0 * rf + band - 1.0, 6.0)));
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
${GLSL_FACTION}
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
  // (whose it is in g's low bits, texelLow's 14 + 2 f: groundMask.ts)
  float gb = floor(s.g * 255.0 + 0.5);
  ramp = sbFacGround(sbFac(floor((mod(gb, 32.0) - 14.0) * 0.5)), int(clamp(floor(s.g * 255.0 / 32.0), 0.0, 5.0)));
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
/** A wide blast (GroundJob.wide) draws what its wave reaches this long ahead (s), and this far past it (m: the reveal LUT's step, a dot's length, a texel). */
const WIDE_LEAD = 0.1;
const WIDE_MARGIN = 16;

interface JobTile {
  key: string;
  m: TileMask;
  /** next row to draw, last row, column span */
  j: number;
  j1: number;
  i0: number;
  i1: number;
  dots: boolean;
  /** over-paint held back until impact: (offset, coverage, g) triples */
  deferred: number[];
  /** a wide blast's: rows lo..hi drawn (nearest first, so one run), upLo..upHi of them uploaded; and what its dots drew before it landed, as one rect */
  lo: number;
  hi: number;
  upLo: number;
  upHi: number;
  dx0: number;
  dz0: number;
  dx1: number;
  dz1: number;
}

/**
 * A wide blast's ground (begin's deadline: a Bomb's, groundDeadline), drawn by when its wave reaches its rim rather than by its impact: drawn whole in flight, a
 * Bomb III's 306 m circle is a 24-37 ms frame. Its rows go nearest first, each tile's row by its nearest texel, so the wave never meets a texel not drawn yet;
 * each dot once the rows under it are. It lands with what's drawn, its over-paint so far under the flash, and the rest goes up as it's drawn (flush's bands).
 */
interface WideJob {
  /** game time it's all drawn by */
  due: number;
  /** its rows nearest first (tile index * 256 + row), each one's nearest texel (m from the centre), the texels from each on; the next to draw */
  order: Int32Array;
  near: Float32Array;
  rest: Float64Array;
  at: number;
  /** its dots (into Prepared.dots) by their farthest texel, and that (m); the next to draw */
  dots: Uint16Array;
  far: Float32Array;
  dotAt: number;
  landed: boolean;
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
  /** drawn by when its wave reaches its rim, nearest first (begin's deadline) */
  wide?: WideJob;
}



/** What builds before GeoPaint kept of the Moon's paint by place, in localStorage after a Moon page's prefix: pictures, and before them lists of blasts. They move to its store once. */
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
  /** a landed wide blast's rows and dots drawn since the last frame: each its own upload (flush) */
  private readonly bands: Array<{ m: TileMask; x0: number; z0: number; x1: number; z1: number }> = [];
  /** a dot's texel rect on the tile it was drawn on (dot) */
  private readonly rect = new Int32Array(4);
  /** QA: a wide blast's rows or dots drawn after its wave had reached them (0: the wave never met a hole), when the last one was due and when it was all down;
   *  the tiles that joined it after it was ordered (widen) and the rows of theirs drawn at once as they did, behind what was drawn */
  readonly wideQa = { late: 0, due: 0, done: 0, joined: 0, caught: 0 };
  /** A tile's saved paint is on screen (trees standing in it can be painted now). */
  onTileReady: ((tx: number, tz: number) => void) | null = null;
  /** A new blast will paint these tiles (keys "tx,tz"); called before its paint is drawn. */
  onTilesTouched: ((keys: string[]) => void) | null = null;

  /** ?moon: kept by place, not by tile (useGeo), and the blasts so kept, by cell */
  /** ?moon: the map's places, and the paint kept by them (GeoPaint) */
  geo: GroundGeo | null = null;
  private pics: GeoPaint | null = null;
  /** ?moon: tiles' paint copied out of the pictures, waiting for each tile to come in (onPaintReady tells the city) */
  private readonly prepared = new Map<string, Uint8Array>();
  /** ?moon: a tile's paint is copied out and waiting: the city gives it ground of its own, and attach copies it in */
  onPaintReady: ((tx: number, tz: number) => void) | null = null;
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
   * ?moon: from here open-ground paint is kept by place on the Moon, not by tile (GeoPaint.ts). What the tile store held for this world, kept by tiles of some map before, means no place any
   * more, and is dropped. The pictures and lists of blasts builds before this one kept in localStorage, under any Moon page's prefix, move to the pictures' store once. `store`: theirs (tools).
   */
  useGeo(g: GroundGeo, store: PicStore = new IdbStore()) {
    this.geo = g;
    const prefix = this.prefix;
    if (this.storageOk && prefix) {
      try {
        for (const k of this.store.keys()) localStorage.removeItem(prefix + k);
      } catch {
        /* blocked */
      }
    }
    this.store.clear();
    this.pics = new GeoPaint(g, store, (sp) => this.prepare(sp), (key, data) => this.paintCopied(key, data), this.tileSize, () => this.oldGeo());
    this.pics.onJournal = (blasts) => this.replayIn(blasts);
  }

  /**
   * ?moon: the journal's blasts, folds again once the store is read: each tile already in that one reaches replays it, as a tile that comes in later draws it
   * itself (attachGeo's pendingOver). A tile in before the read found no folds over it, and showed the pictures alone, under them. Review five, 40
   */
  private replayIn(blasts: BlastSpec[]) {
    for (const spec of blasts) {
      const p = this.prepare(spec);
      for (const key of this.tilesOf(p)) {
        if (!this.loaded.has(key) || !this.mask(key)) continue;
        this.replaying.set(key, (this.replaying.get(key) ?? 0) + 1);
        this.jobs.push({ spec, tImpact: 0, serial: null, p: null, tiles: [], only: key, under: false });
      }
    }
  }

  /** What builds before this one kept by place in localStorage, as pictures and blasts for GeoPaint, and a way to drop it once they're in its store. */
  private oldGeo(): { pics: Array<[number, number, string]>; blasts: BlastSpec[]; done: () => void } {
    const pics: Array<[number, number, string]> = [], blasts: BlastSpec[] = [], keys: string[] = [], g = this.geo!, o = [0, 0];
    try {
      for (let n = 0; n < localStorage.length; n++) {
        const k = localStorage.key(n);
        if (!k || !/^strugglebus\.ground\.v\d+\.moon_/.test(k)) continue;
        const at = k.indexOf(':' + GEO_KEY), ot = k.indexOf(':' + GEO_OLD);
        if (at >= 0) {
          keys.push(k);
          const [i, j] = k.slice(at + 1 + GEO_KEY.length).split(',').map(Number);
          const v = JSON.parse(localStorage.getItem(k) ?? '{}') as { t?: number; m?: string };
          // (its rows and columns are the pictures' own short of the caps; past them they were drawn on a grid that's gone, and are left)
          if (Number.isInteger(i) && Number.isInteger(j) && Math.abs((i + 0.5) * 0.005) < 88 && typeof v.m === 'string' && v.m.length) pics.push([(i + 20000) * 100000 + j, typeof v.t === 'number' ? v.t : 0, v.m]);
        } else if (ot >= 0) {
          keys.push(k);
          const rows = JSON.parse(localStorage.getItem(k) ?? '[]') as unknown[];
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
            blasts.push(sp);
          }
        }
      }
    } catch {
      /* blocked, or corrupt: left */
    }
    return {
      pics,
      blasts,
      done: () => {
        try {
          for (const k of keys) localStorage.removeItem(k);
        } catch {
          /* blocked */
        }
      },
    };
  }

  /** A new map of the same world (?moonland's, made again round the bus): what memory holds of the one before goes. What's kept by place (useGeo) stays, and comes in with the new map's tiles. */
  newMap() {
    if (!this.pics) {
      this.resetAll();
      return;
    }
    this.store.clear();
    this.saveQueue.length = 0;
    this.saveSet.clear();
    this.prepared.clear();
    this.pics.moved();
  }

  /** ?moon: the pictures by place, for QA. */
  get geoPaint(): GeoPaint | null {
    return this.pics;
  }

  /** Pictures of paint kept by place (useGeo), for QA. */
  get geoCount(): number {
    return this.pics?.count ?? 0;
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
    remap(this.prepared);
    this.pics?.slid(dtx, dtz, dx, dz);
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
    if (this.pics) {
      this.attachGeo(key, ox, oz);
      this.joinLive(key, ox, oz);
      return;
    }
    const rec = this.store.get(key);
    if (!rec) {
      this.joinLive(key, ox, oz);
      return;
    }
    const m = this.mask(key)!;
    if (rec.m && !decodeMask(rec.m, m.data)) rec.m = null; // corrupt entry: dropped on its next save
    if (rec.p.length) {
      this.replaying.set(key, rec.p.length);
      for (const s of rec.p) this.jobs.push({ spec: s, tImpact: 0, serial: null, p: null, tiles: [], only: key, under: false });
    }
    this.joinLive(key, ox, oz);
    this.ready.push(key);
  }

  /**
   * A tile come in while a blast is in flight over it joins that blast, so it's drawn by the impact, not replayed after it: City splits a MEGA's tiles out of their
   * regions' ground three a frame, after its job has started (review five's 33). Its replays, queued above, are older and go under it; a kept copy that lands later
   * goes under what the mask shows (paintCopied).
   */
  private joinLive(key: string, ox: number, oz: number) {
    const S = this.tileSize;
    for (const job of this.jobs) {
      const p = job.p;
      if (job.serial === null || !p || ox > p.maxX || ox + S < p.minX || oz > p.maxZ || oz + S < p.minZ) continue;
      // (an entry for it on a mask that's gone, a change of detail under the blast, is taken out and the tile joins again: its rows from the first. Review six, 53.
      // A wide blast's stays, its mask gone, so no other tile's rows move in its order, which holds each by its place in the list: the Bomb's world review, B)
      let had = false;
      for (let i = job.tiles.length - 1; i >= 0; i--) {
        const t = job.tiles[i];
        if (t.key !== key) continue;
        if (this.masks.get(key) === t.m) had = true;
        else if (!job.wide) job.tiles.splice(i, 1);
      }
      if (had) continue;
      const n = job.tiles.length;
      this.joinTile(job, key);
      if (job.wide && job.tiles.length > n) this.widen(job);
    }
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
      // (?moon: what it shows, settled, kept for it coming back, as a region's change of detail makes its tiles' ground again; not while its copy's on its way, which comes then)
      if (this.pics && !this.pics.copyingTile(key)) this.keepShown(key, m.data);
      m.gone = true;
      m.tex.dispose();
      this.masks.delete(key);
    }
    // (and a copy on its way for a tile that's gone is dropped, mask or none: they were never, and read their pictures and made 64 KB for nothing. Review four, 15;
    // review five, 41)
    this.pics?.dropCopy(key);
    // queued replays of this tile are dropped (its entry still holds them: they redraw when it comes back)
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].only === key) this.jobs.splice(i, 1);
  }

  /**
   * ?moon: a tile's region unloaded. One with ground of its own detached already; a merged one, never attached, may have a copy asked for it (hasSaved, as its
   * region's ground was made) and waiting: dropped, so it doesn't read pictures, take the share, push out copies for tiles that come, and give ground to a region
   * that's gone. Review five, 41
   */
  forget(tx: number, tz: number) {
    const key = `${tx},${tz}`;
    if (!this.pics || this.loaded.has(key)) return;
    this.pics.dropCopy(key);
    const d = this.prepared.get(key);
    if (d) {
      this.prepared.delete(key);
      this.pics.recycle(d);
    }
  }

  /** True if storage holds ground paint for the tile (loaded or not). ?moon: a blast kept by place reaches it. */
  hasSaved(tx: number, tz: number): boolean {
    if (this.pics) {
      // (its paint copied out first, a little each frame, and only then ground of its own: onPaintReady says when)
      // (and a blast that reaches it and isn't in the pictures yet gives it ground of its own at once: the city asks as it makes a region's ground, and needn't ask again)
      const key = `${tx},${tz}`, ox = tx * this.tileSize, oz = tz * this.tileSize;
      if (this.prepared.has(key)) return true;
      // (in, with a mask: what it shows is on it, its kept paint copied in or on its way under it. A region made again for another tile's copy asked every painted
      // tile for its copy again, 2n - 1 for n, and a tile whose copy was queued again lost what it showed at a change of detail: review four, 3. And not only a tile
      // that took a kept copy, which left one painted this session, or any after a slide: review five, 37)
      if (this.masks.has(key)) return true;
      this.pics.want(key, ox, oz);
      return this.pics.pendingOver(ox, oz, ox + this.tileSize, oz + this.tileSize).length > 0;
    }
    return this.store.has(`${tx},${tz}`);
  }

  /** True if the tile has any ground paint. */
  has(tx: number, tz: number): boolean {
    return this.masks.has(`${tx},${tz}`);
  }

  /** Paint at a world point (CPU, e.g. for trees): coverage 0..1, hue and its faction (where there's coverage), or null. */
  sample(x: number, z: number): { cov: number; hue: number; faction: number } | null {
    const tx = Math.floor(x / this.tileSize), tz = Math.floor(z / this.tileSize);
    const m = this.masks.get(`${tx},${tz}`);
    if (!m) return null;
    const ox = m.ox, oz = m.oz;
    const i = Math.min(GROUND_N - 1, Math.max(0, Math.floor((x - ox) / this.cell)));
    const j = Math.min(GROUND_N - 1, Math.max(0, Math.floor((z - oz) / this.cell)));
    const o = (j * GROUND_N + i) * 4;
    return { cov: m.data[o] / 255, hue: Math.min(5, Math.floor(m.data[o + 1] / 32)), faction: m.data[o] ? texelOwner(m.data[o + 1]) : 0 };
  }

  /**
   * A projectile is in the air and will explode on spec at tImpact (game
   * clock): its paint is drawn by work() over the next frames, hidden.
   * deadline > 0 (s after the impact, groundDeadline): a wide blast, drawn
   * nearest first until then, so its impact needn't wait for the whole of it.
   */
  begin(spec: BlastSpec, tImpact: number, deadline = 0): GroundJob {
    // (a wide blast still drawing is finished first, so paint stacks in order: a Bomb's own refill outlasts its wave, so only another's blast comes this soon)
    for (let k = this.jobs.length - 1; k >= 0; k--) {
      const o = this.jobs[k];
      if (!o.wide) continue;
      if (!o.p) this.start(o);
      this.stepWide(o, Infinity);
      if (!o.wide.landed) continue;
      this.shipWide(o);
      this.jobs.splice(k, 1);
      this.settle(o, false);
    }
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
    if (deadline > 0) {
      job.wide = { due: tImpact + deadline, order: new Int32Array(0), near: new Float32Array(0), rest: new Float64Array(1), at: 0, dots: new Uint16Array(0), far: new Float32Array(0), dotAt: 0, landed: false };
      this.wideQa.due = job.wide.due;
      this.wideQa.done = 0;
    }
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
    // (a landed wide blast draws what its wave reaches by the next frame first, whatever else the queue holds)
    for (const job of this.jobs) if (job.wide?.landed) this.stepWide(job, 0);
    for (let n = 0; n < this.jobs.length && budget > 0; ) {
      const job = this.jobs[n];
      if (!job.p) {
        // setting a blast up (shape, dots, tiles) is a slice of its own
        this.start(job);
        return;
      }
      if (job.serial !== null) budget = Math.max(budget, this.left(job) / Math.max(1, ((job.wide ? job.wide.due : job.tImpact) - globals.uTime.value) * 30));
      budget = this.step(job, budget);
      if (job.serial === null && this.finished(job)) {
        // a replay is done: off the queue, its tile shows it and saves
        this.jobs.splice(n, 1);
        this.replayed(job);
      } else if (job.wide?.landed && this.finished(job)) {
        // a wide blast is all down: its last rows go up, and it settles
        this.shipWide(job);
        this.jobs.splice(n, 1);
        this.settle(job, false);
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
    const w = job.wide;
    if (w) {
      // (a wide blast: what its wave reaches first is drawn now, its over-paint so far goes on under the flash, and what's drawn goes up, a rect a tile; the
      // rest is drawn ahead of the wave and goes up as it's drawn, and it settles once it's all down: work)
      w.landed = true;
      this.stepWide(job, 0);
      for (const t of job.tiles) {
        if (this.masks.get(t.key) !== t.m) continue;
        const d = t.m.data, q = t.deferred;
        for (let k = 0; k < q.length; k += 3) this.put(d, q[k], q[k + 1], q[k + 2], 0, null, false, null);
        q.length = 0;
        const rows = t.lo <= t.hi;
        if (rows || t.dx0 <= t.dx1)
          this.bands.push({ m: t.m, x0: rows ? Math.min(t.i0, t.dx0) : t.dx0, z0: rows ? Math.min(t.lo, t.dz0) : t.dz0, x1: rows ? Math.max(t.i1, t.dx1) : t.dx1, z1: rows ? Math.max(t.hi, t.dz1) : t.dz1 });
        t.upLo = t.lo;
        t.upHi = t.hi;
      }
      this.landed++;
      if (this.finished(job)) {
        const i = this.jobs.indexOf(job);
        if (i >= 0) this.jobs.splice(i, 1);
        this.settle(job, false);
      }
      return job.p!.dots;
    }
    const i = this.jobs.indexOf(job);
    if (i >= 0) this.jobs.splice(i, 1);
    this.step(job, Infinity);
    this.settle(job, true);
    this.landed++;
    return job.p!.dots;
  }

  /**
   * A blast's paint is all down: its over-paint on, its tiles marked for an upload each (`upload`: a wide blast's went up as it was drawn) and for saving,
   * and the tiles it reaches that it couldn't draw get it as a replay.
   */
  private settle(job: GroundJob, upload: boolean) {
    const p = job.p!;
    const touched: string[] = [];
    for (const t of job.tiles) {
      if (this.masks.get(t.key) !== t.m) continue;
      const d = t.m.data, q = t.deferred;
      for (let k = 0; k < q.length; k += 3) this.put(d, q[k], q[k + 1], q[k + 2], 0, null, false, null);
      q.length = 0;
      if (upload) this.markDirty(t.m, p);
      touched.push(t.key);
      if (!this.pics) this.queueSave(t.key);
    }
    if (job.wide) this.wideQa.done = globals.uTime.value;
    if (job.serial !== null) this.serialTiles.set(job.serial, touched);
    if (this.pics) {
      // (kept by place, drawn into the pictures over the frames after this; a tile here that it couldn't draw has it now, and one that comes in before it's drawn in draws it itself)
      this.pics.add(job.spec, p);
      for (const key of this.tilesOf(p))
        if (!this.loaded.has(key)) {
          // (a copy waiting for a tile, made before this: copied again when the tile comes, with it)
          this.prepared.delete(key);
        } else if (touched.indexOf(key) < 0 && this.mask(key)) {
          this.replaying.set(key, (this.replaying.get(key) ?? 0) + 1);
          this.jobs.push({ spec: job.spec, tImpact: 0, serial: null, p: null, tiles: [], only: key, under: false });
        }
    } else for (const key of this.tilesOf(p)) if (touched.indexOf(key) < 0) this.addPending(key, job.spec);
    this.saveTimer = 0.8;
  }

  /** Paint a blast immediately, with no reveal (tests / tools). */
  blast(spec: BlastSpec, tImpact: number): BlastDot[] {
    return this.land(this.begin(spec, tImpact));
  }

  /**
   * A small blast painted settled, now (Curb's lane behind the bus, a dab every few metres): no reveal and no live slot, so a breath on its way
   * keeps its own and shows nothing early. Kept as any blast is.
   */
  dab(spec: BlastSpec): void {
    if (this.onTilesTouched) {
      const reach = spec.r * Math.max(spec.reach, spec.edge * (1 + spec.ragged) + spec.rayLen) + 4; // (as prepare)
      this.onTilesTouched(this.tilesOf({ minX: spec.x - reach, minZ: spec.z - reach, maxX: spec.x + reach, maxZ: spec.z + reach }));
    }
    this.land({ spec, tImpact: 0, serial: null, p: null, tiles: [], only: null, under: false });
  }

  /** Upload dirty masks (one texSubImage2D each); save changed tiles, one per frame, on a debounce. */
  flush(renderer: THREE.WebGLRenderer, dt: number) {
    const S = config.splat;
    blastUniforms.uGroundTone.value.set(S.groundLight, S.groundSidewalk, Math.min(1, S.groundCurb), 0);
    // (?moon: the pictures by place, a few ms a frame)
    this.pics?.work(dt);
    if (this.saveTimer > 0) this.saveTimer -= dt;
    else if (this.pics) {
      /* the pictures write themselves */
    } else if (this.saveQueue.length) {
      // a tile still drawing replays saves once they're done
      for (let k = 0; k < this.saveQueue.length; k++) {
        const key = this.saveQueue[k];
        if (!this.saveTile(key, false)) continue;
        this.saveQueue.splice(k, 1);
        this.saveSet.delete(key);
        break;
      }
    }
    // (a landed wide blast's rows and dots drawn since the last frame, a band each: what's up already isn't sent again. A tile's bands go up in its one upload
    // this frame, with whatever else it has: paint uploads stay at one call a texture a frame, upload.ts, where they were up to 7 on a tile, 35 in a frame)
    for (const job of this.jobs) if (job.wide?.landed) this.shipWide(job);
    for (const b of this.bands) {
      const m = b.m;
      if (m.gone) continue;
      m.x0 = Math.min(m.x0, b.x0);
      m.z0 = Math.min(m.z0, b.z0);
      m.x1 = Math.max(m.x1, b.x1);
      m.z1 = Math.max(m.z1, b.z1);
      this.queueDirty(m);
    }
    this.bands.length = 0;
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
    this.prepared.clear();
    this.pics?.clear();
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
    this.pics?.persist();
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

  /**
   * ?moon: a tile comes in: the paint copied out of the pictures for it goes onto its mask in one go, and the blasts that landed and aren't in the pictures yet are drawn on it as replays.
   */
  private attachGeo(key: string, ox: number, oz: number) {
    const d = this.prepared.get(key);
    // (none waiting for it: copied now, if there's paint under it, and put under what it shows when it's done)
    if (!d) this.pics!.want(key, ox, oz);
    else {
      this.prepared.delete(key);
      const m = this.mask(key);
      if (m) {
        m.data.set(d);
        m.x0 = 0;
        m.z0 = 0;
        m.x1 = GROUND_N - 1;
        m.z1 = GROUND_N - 1;
        this.queueDirty(m);
        this.ready.push(key);
      }
      this.pics!.recycle(d);
    }
    const pend = this.pics!.pendingOver(ox, oz, ox + this.tileSize, oz + this.tileSize);
    if (pend.length && this.mask(key)) {
      this.replaying.set(key, (this.replaying.get(key) ?? 0) + pend.length);
      for (const p of pend) this.jobs.push({ spec: p.spec, tImpact: 0, serial: null, p: null, tiles: [], only: key, under: false });
    }
  }

  /**
   * ?moon: a tile's paint copied out of the pictures. If the tile's here already (painted this session, so it took ground of its own), it goes under what's on its mask; otherwise it waits
   * for the tile, and the city is told to give it ground of its own (onPaintReady), so the tile comes in with its paint on.
   */
  private paintCopied(key: string, d: Uint8Array) {
    const m = this.loaded.has(key) ? this.mask(key) : null;
    if (m) {
      const md = m.data;
      for (let t = 0; t < md.length; t += 4) {
        const c = d[t];
        if (!c || c <= md[t]) continue;
        if (md[t] < 128) md[t + 1] = d[t + 1];
        md[t] = c;
      }
      m.x0 = 0;
      m.z0 = 0;
      m.x1 = GROUND_N - 1;
      m.z1 = GROUND_N - 1;
      this.queueDirty(m);
      // (and what stands in its paint, the boulders, takes it now, as when the copy came first. Review four, 8)
      this.ready.push(key);
      this.pics!.recycle(d);
      return;
    }
    this.prepared.set(key, d);
    // (copies waiting for tiles that don't come: the oldest go, and are copied again if they do)
    if (this.prepared.size > 64) this.dropPrepared();
    const c = key.indexOf(',');
    this.onPaintReady?.(Number(key.slice(0, c)), Number(key.slice(c + 1)));
  }

  /** ?moon: a tile's mask as its paint waiting for it, settled (no reveal), if it shows any. */
  private keepShown(key: string, md: Uint8Array) {
    let d: Uint8Array | null = null;
    for (let t = 0; t < md.length; t += 4) {
      if (!md[t]) continue;
      d ??= this.pics ? this.pics.take() : new Uint8Array(TEXELS * 4);
      d[t] = md[t];
      d[t + 1] = md[t + 1];
    }
    if (!d) return;
    const was = this.prepared.get(key);
    if (was) this.pics?.recycle(was);
    this.prepared.delete(key);
    this.prepared.set(key, d);
    if (this.prepared.size > 64) this.dropPrepared();
  }

  /** The oldest copy waiting for its tile goes, its array back to the pool. */
  private dropPrepared() {
    const k = this.prepared.keys().next().value!, d = this.prepared.get(k);
    this.prepared.delete(k);
    if (d) this.pics?.recycle(d);
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
    // (&falls's pool spreads out from the tower's walls, slower than any wave; with its footprint's shape (spec.foot) its edge keeps the walls' shape, as far
    // past each as the circle reaches past the farthest, and each texel's reveal is its distance past the wall at its angle, rows())
    let foot: Float32Array | undefined;
    if (spec.layout === LAYOUT_POOL) {
      for (let k = 0; k < WAVE_LUT; k++) wave[k] = Math.max(0, (k / (WAVE_LUT - 1)) * (e.max + 3) - spec.ring) / POOL_SPREAD;
      if (spec.foot && spec.foot.length === SHAPE_LUT) {
        foot = spec.foot;
        let far = 0;
        for (let k = 0; k < SHAPE_LUT; k++) far = Math.max(far, foot[k]);
        for (let k = 0; k < SHAPE_LUT; k++) e.lut[k] -= far - foot[k];
      }
    }
    return { spec, lut: e.lut, warp, wave, foot, max: e.max, dots: blastDots(spec, e), minX: spec.x - reach, minZ: spec.z - reach, maxX: spec.x + reach, maxZ: spec.z + reach };
  }

  private start(job: GroundJob) {
    const p = this.prepare(job.spec);
    job.p = p;
    for (const key of job.only ? [job.only] : this.tilesOf(p)) if (this.loaded.has(key)) this.joinTile(job, key);
    if (job.wide) this.orderWide(job);
  }

  /** A wide blast's rows nearest first, each tile's row by its nearest texel, and its dots by their farthest (stepWide). */
  private orderWide(job: GroundJob) {
    const w = job.wide!, p = job.p!, s = p.spec, cs = this.cell;
    let n = 0;
    for (const t of job.tiles) n += Math.max(0, t.j1 - t.j + 1);
    const key = new Int32Array(n), near = new Float32Array(n);
    let k = 0;
    job.tiles.forEach((t, ti) => {
      const xa = t.m.ox + (t.i0 + 0.5) * cs - s.x, xb = t.m.ox + (t.i1 + 0.5) * cs - s.x;
      const dx = xa > 0 ? xa : xb < 0 ? -xb : 0;
      for (let j = t.j; j <= t.j1; j++, k++) {
        key[k] = ti * 256 + j;
        near[k] = Math.hypot(dx, t.m.oz + (j + 0.5) * cs - s.z);
      }
    });
    const by = Array.from({ length: n }, (_, i) => i).sort((a, b) => near[a] - near[b]);
    w.order = Int32Array.from(by, (i) => key[i]);
    w.near = Float32Array.from(by, (i) => near[i]);
    w.rest = new Float64Array(n + 1);
    for (let i = n - 1; i >= 0; i--) {
      const t = job.tiles[w.order[i] >> 8];
      w.rest[i] = w.rest[i + 1] + t.i1 - t.i0 + 1;
    }
    const far = p.dots.map((d) => Math.hypot(d.x - s.x, d.z - s.z) + d.rad * d.elong + 1.5 + cs);
    const dots = Array.from({ length: far.length }, (_, i) => i).sort((a, b) => far[a] - far[b]);
    w.dots = Uint16Array.from(dots);
    w.far = Float32Array.from(dots, (i) => far[i]);
  }

  /**
   * A tile come in after its wide blast was ordered (City splits a region's tiles out of its ground three a frame, from up high or ahead of the bus: on the page
   * most of a Bomb's tiles, which it never drew, and saved bare: the world review's B). Its rows nearer than what's drawn are drawn now, then the dots drawn
   * already, as on the rest; the others go into what's still to draw by their nearest texel, so the wave meets them drawn.
   */
  private widen(job: GroundJob) {
    const w = job.wide!, p = job.p!, s = p.spec, cs = this.cell, ti = job.tiles.length - 1, t = job.tiles[ti];
    const xa = t.m.ox + (t.i0 + 0.5) * cs - s.x, xb = t.m.ox + (t.i1 + 0.5) * cs - s.x;
    const dx = xa > 0 ? xa : xb < 0 ? -xb : 0;
    const front = w.at > 0 ? w.near[w.at - 1] : -1;
    const add: Array<[number, number]> = [];
    for (let j = t.j; j <= t.j1; j++) {
      const near = Math.hypot(dx, t.m.oz + (j + 0.5) * cs - s.z);
      if (near > front) {
        add.push([near, j]);
        continue;
      }
      this.rows(t.m, p, job.serial, j, j, w.landed ? null : t.deferred, job.under);
      if (j < t.lo) t.lo = j;
      if (j > t.hi) t.hi = j;
      this.wideQa.caught++;
    }
    for (let k = 0; k < w.dotAt; k++) this.wideDot(job, t, p.dots[w.dots[k]]);
    this.wideQa.joined++;
    if (!add.length) return;
    add.sort((a, b) => a[0] - b[0]);
    const n0 = w.order.length, n = n0 + add.length;
    const order = new Int32Array(n), near = new Float32Array(n);
    order.set(w.order.subarray(0, w.at));
    near.set(w.near.subarray(0, w.at));
    for (let a = w.at, b = 0, k = w.at; k < n; k++) {
      if (b >= add.length || (a < n0 && w.near[a] <= add[b][0])) {
        order[k] = w.order[a];
        near[k] = w.near[a++];
      } else {
        order[k] = ti * 256 + add[b][1];
        near[k] = add[b++][0];
      }
    }
    w.order = order;
    w.near = near;
    w.rest = new Float64Array(n + 1);
    for (let i = n - 1; i >= 0; i--) {
      const u = job.tiles[order[i] >> 8];
      w.rest[i] = w.rest[i + 1] + u.i1 - u.i0 + 1;
    }
  }

  /** A started job takes a loaded tile: the rows and columns of its mask the blast reaches. */
  private joinTile(job: GroundJob, key: string) {
    const m = this.mask(key);
    if (!m) return;
    // replays still queued here are older: they go under this blast
    if (job.serial !== null) for (const r of this.jobs) if (r.only === key) r.under = true;
    const s = job.spec, cs = this.cell, R = job.p!.max + 3;
    const i0 = Math.max(0, Math.floor((s.x - R - m.ox) / cs)), i1 = Math.min(GROUND_N - 1, Math.floor((s.x + R - m.ox) / cs));
    const j0 = Math.max(0, Math.floor((s.z - R - m.oz) / cs)), j1 = Math.min(GROUND_N - 1, Math.floor((s.z + R - m.oz) / cs));
    job.tiles.push({ key, m, j: j0, j1: i0 > i1 ? j0 - 1 : j1, i0, i1, dots: false, deferred: [], lo: GROUND_N, hi: -1, upLo: GROUND_N, upHi: -1, dx0: GROUND_N, dz0: GROUND_N, dx1: -1, dz1: -1 });
  }

  /** Draw up to `budget` texels of a started job; returns the budget left. */
  private step(job: GroundJob, budget: number): number {
    if (job.wide) return this.stepWide(job, budget);
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

  /**
   * A wide blast's slice: its rows nearest first, up to `budget` texels and, once it's landed, at least those its wave reaches by the next frame, whatever
   * the budget; each dot once every row under it is drawn. Over old paint it changes the hue at the impact (the over-paint so far) and as it's drawn after.
   */
  private stepWide(job: GroundJob, budget: number): number {
    const w = job.wide!, p = job.p!, r = p.spec.r;
    const since = globals.uTime.value - job.tImpact;
    const need = w.landed ? waveAt(since + WIDE_LEAD, r) + WIDE_MARGIN : -1;
    // (QA: the wave's reach now, less half a step of the reveal's LUT)
    const met = w.landed ? waveAt(since, r) - (p.max + 3) / (WAVE_LUT - 1) / 2 : -1;
    const n = w.order.length;
    while (w.at < n && (budget > 0 || w.near[w.at] <= need)) {
      const e = w.order[w.at], t = job.tiles[e >> 8];
      if (this.masks.get(t.key) === t.m) {
        const j = e & 255;
        if (w.near[w.at] < met) this.wideQa.late++;
        this.rows(t.m, p, job.serial, j, j, w.landed ? null : t.deferred, job.under);
        if (j < t.lo) t.lo = j;
        if (j > t.hi) t.hi = j;
        budget -= t.i1 - t.i0 + 1;
      }
      w.at++;
      budget -= this.wideDots(job, w.at < n ? w.near[w.at] : Infinity, since);
    }
    if (w.at >= n) budget -= this.wideDots(job, Infinity, since);
    return budget;
  }

  /** A wide blast's dots whose farthest texel is nearer than every row still to draw (`front`); returns their cost. Landed, each goes up as its own band. */
  private wideDots(job: GroundJob, front: number, since: number): number {
    const w = job.wide!, p = job.p!, s = p.spec;
    let used = 0;
    while (w.dotAt < w.dots.length && w.far[w.dotAt] < front) {
      const dot = p.dots[w.dots[w.dotAt++]];
      if (w.landed && (dot.blob ? config.splat.blobTime + config.splat.blobTimePerM * dot.d : arrival(dot.d, s.r)) < since) this.wideQa.late++;
      for (const t of job.tiles) this.wideDot(job, t, dot);
      used += 4;
    }
    return used;
  }

  /** One of a wide blast's dots on one of its tiles: landed, it goes up as its own band; before, into the tile's rect of them. */
  private wideDot(job: GroundJob, t: JobTile, dot: BlastDot) {
    if (this.masks.get(t.key) !== t.m || !this.dot(t.m, job.p!, dot, job.serial)) return;
    const q = this.rect;
    if (job.wide!.landed) this.bands.push({ m: t.m, x0: q[0], z0: q[1], x1: q[2], z1: q[3] });
    else {
      t.dx0 = Math.min(t.dx0, q[0]);
      t.dz0 = Math.min(t.dz0, q[1]);
      t.dx1 = Math.max(t.dx1, q[2]);
      t.dz1 = Math.max(t.dz1, q[3]);
    }
  }

  /** A landed wide blast's rows drawn since its last upload go up (flush): on a tile, those nearer the centre than what's up and those farther, a band each. */
  private shipWide(job: GroundJob) {
    for (const t of job.tiles) {
      if (this.masks.get(t.key) !== t.m || t.lo > t.hi) continue;
      if (t.upLo > t.upHi) this.bands.push({ m: t.m, x0: t.i0, z0: t.lo, x1: t.i1, z1: t.hi });
      else {
        if (t.lo < t.upLo) this.bands.push({ m: t.m, x0: t.i0, z0: t.lo, x1: t.i1, z1: t.upLo - 1 });
        if (t.hi > t.upHi) this.bands.push({ m: t.m, x0: t.i0, z0: t.upHi + 1, x1: t.i1, z1: t.hi });
      }
      t.upLo = t.lo;
      t.upHi = t.hi;
    }
  }

  /** Texels a started job still has to draw. */
  private left(job: GroundJob): number {
    const w = job.wide;
    if (w) return w.rest[Math.min(w.at, w.rest.length - 1)] + (w.dots.length - w.dotAt) * 4;
    let n = 0;
    for (const t of job.tiles) if (this.masks.get(t.key) === t.m) n += Math.max(0, t.j1 - t.j + 1) * (t.i1 - t.i0 + 1) + (t.dots ? 0 : 150);
    return n;
  }

  /** Every tile of the job drawn (or gone). */
  private finished(job: GroundJob): boolean {
    const w = job.wide;
    if (w) return w.at >= w.order.length && w.dotAt >= w.dots.length;
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
    // (&boom's ring in a faction with its strongest rows named: only those slots)
    const strong = s.layout === LAYOUT_RING ? lookOf(s.faction ?? FACTION_RAINBOW).ring?.ground : undefined;
    const lut = p.lut, warp = p.warp, wave = p.wave, foot = p.foot;
    const lutK = SHAPE_LUT / (Math.PI * 2);
    const R2 = R * R;
    const waveK = (WAVE_LUT - 1) / Math.max(1, R);
    const low = texelLow(ownerOf(s.faction));
    // main splat: soft-edged blob, rainbow layout with a warped (hand-painted)
    // boundary. Hot loop (thousands of texels at impact): LUTs, no hypot/log.
    for (let j = j0; j <= j1; j++) {
      const wz = oz + (j + 0.5) * cs - s.z;
      for (let i = i0; i <= i1; i++) {
        const wx = ox + (i + 0.5) * cs - s.x;
        const d2 = wx * wx + wz * wz;
        if (d2 > R2) continue;
        const dist = Math.sqrt(d2);
        // (&boom's ring: its hole, more than its edge's warp in, is bare, and over half its texels: the soft edge reaches 2.2 + 1.25 m in where the warp is -1)
        if (s.layout === LAYOUT_RING && dist < s.ring - 3.5) continue;
        const a = Math.atan2(wz, wx);
        let f = a * lutK;
        if (f < 0) f += SHAPE_LUT;
        const k = f | 0;
        const t = f - k;
        const k1 = k + 1 < SHAPE_LUT ? k + 1 : 0;
        const e = lut[k] * (1 - t) + lut[k1] * t;
        let c = (e - dist) / 2.6 + 0.5;
        // (&boom's ring: its inner edge, as soft and as warped as its outer)
        if (s.layout === LAYOUT_RING) c = Math.min(c, (dist - s.ring - warp[k] * 2.2) / 2.6 + 0.5);
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
          if (strong) hue = strong[hue % strong.length];
        }
        // (&falls's pool with its footprint: revealed by the distance past the wall at its angle)
        const rv = !live ? 0 : foot ? Math.max(0, dist - (foot[k] * (1 - t) + foot[k1] * t)) / POOL_SPREAD : wave[Math.min(WAVE_LUT - 1, Math.round(dist * waveK))];
        this.put(d, (j * GROUND_N + i) * 4, c > 1 ? 1 : c, hue * 32 + low, rv, serial, under, deferred);
      }
    }
  }

  /** Spatter dots stretched along their flight direction, on one tile. */
  private dots(m: TileMask, p: Prepared, serial: number | null, deferred: number[] | null) {
    for (const dot of p.dots) this.dot(m, p, dot, serial, deferred);
  }

  /** One spatter dot on one tile: false if it misses the tile, else the texels it may cover are this.rect (x0, z0, x1, z1). */
  private dot(m: TileMask, p: Prepared, dot: BlastDot, serial: number | null, deferred: number[] | null = null): boolean {
    const s = p.spec;
    const cs = this.cell;
    const ox = m.ox, oz = m.oz;
    const d = m.data;
    const live = serial !== null;
    const low = texelLow(ownerOf(s.faction));
    const rr = dot.rad * dot.elong + 1.5;
    const di0 = Math.max(0, Math.floor((dot.x - rr - ox) / cs)), di1 = Math.min(GROUND_N - 1, Math.floor((dot.x + rr - ox) / cs));
    const dj0 = Math.max(0, Math.floor((dot.z - rr - oz) / cs)), dj1 = Math.min(GROUND_N - 1, Math.floor((dot.z + rr - oz) / cs));
    if (di0 > di1 || dj0 > dj1) return false;
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
        this.put(d, (j * GROUND_N + i) * 4, c, dot.hue * 32 + low, rv, serial, true, deferred);
      }
    }
    const q = this.rect;
    q[0] = di0;
    q[1] = dj0;
    q[2] = di1;
    q[3] = dj1;
    return true;
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

  /** Write one texel of new paint over whatever is there (bareOnly: only onto bare ground). g: its hue and faction (groundMask's texelLow). */
  private put(d: Uint8Array, o: number, c: number, g: number, reveal: number, serial: number | null, bareOnly: boolean, deferred: number[] | null) {
    const old = d[o] / 255;
    // spatter only lands on bare ground (no confetti inside a splat); a replay under a newer blast likewise
    if (bareOnly && old >= 0.5) return;
    // over old paint, a live blast changes the hue (and whose it is) only at impact
    if (deferred && old >= 0.5) {
      deferred.push(o, c, g);
      return;
    }
    const nc = Math.max(old, c);
    d[o] = Math.round(nc * 255);
    if (c >= 0.5 || c > old) d[o + 1] = g;
    if (serial !== null && old < 0.5 && c > 0.2) {
      // freshly painted ground waits for the shockwave; old paint just changes hue under the flash
      const rv = Math.round(Math.min(2.55, reveal) * 100);
      if (d[o + 3] !== serial || rv < d[o + 2]) d[o + 2] = rv;
      d[o + 3] = serial;
    }
  }
}
