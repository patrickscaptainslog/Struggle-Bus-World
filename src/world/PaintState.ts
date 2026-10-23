import * as THREE from 'three';
import { uploadRect } from '../render/upload';

// Paint state, keyed by building. This is the array a Phase 2 server will own.
//
// GPU: RGBA32F texture, one texel per dense building index:
//   r = color index (0..5 within the faction palette), g = level (0 = grey, 1..3),
//   b = bloom start time (seconds, globals.uTime clock; may be in the future: a
//   blast writes its whole wave at impact and the shader times each bloom),
//   a = faction (0 none, 1 Rainbow) + 2 when the building was already painted
//   (an escalation: it stays painted until its new pop instead of going grey)
// Persistence: localStorage, keyed by the building's stable id, value = [faction, color, level]. Applied
//   as tiles stream in. Which store depends on the DATA's id scheme (see IdScheme), never on the code.

/**
 * The id scheme of the city data, from city.json "ids": 'osm' = every stable id derives from its source
 * record (OpenStreetMap ids; bake.py ID_RANGES); no "ids" = an old bake, whose ids are USA Structures
 * footprint ranks + lots. The same number names different buildings in the two schemes, so each scheme
 * has its own stores: paint saved against one is never applied to the other's buildings. (A new scheme
 * gets new store versions here and in GroundPaint.)
 */
export type IdScheme = 'osm' | 'rank';
/** What a paint store needs from city.json: the slug, "ids" (absent on an old bake), and its data credits. */
export interface CityData {
  slug: string;
  ids?: string;
  /** OpenStreetMap bakes credit OSM (ODbL); the old rank bakes carry neither field */
  attribution?: string;
  license?: string;
}
/**
 * The data's scheme, or null when neither store can trust its ids: an "ids" this code doesn't know (a
 * future scheme, a typo) or OpenStreetMap data from before city.json carried "ids" (an 'SBB3' bake whose
 * ids may predate ID_RANGES; check-stable-ids calls it OSM, so it is never taken for a rank bake).
 */
export function idSchemeOf(data: CityData): IdScheme | null {
  if (data.ids === 'osm') return 'osm';
  if (data.ids !== undefined) return null;
  const osmData = /OpenStreetMap/i.test(data.attribution ?? '') || /^ODbL/i.test(data.license ?? '');
  return osmData ? null : 'rank';
}
let registered: { slug: string; scheme: IdScheme | null } | null = null;
/** main.ts registers the city.json it loaded before the City exists (for a caller that hands a store only the slug). */
export function registerCityData(data: CityData): void {
  registered = { slug: data.slug, scheme: idSchemeOf(data) };
}
/**
 * The scheme a store keys by: the one given, else the data's own "ids" (handed city.json), else what
 * main.ts registered for that slug; null = unknown: paint lives for the session only and storage is
 * never touched.
 */
export function resolveIdScheme(city: string | CityData, scheme?: IdScheme): IdScheme | null {
  if (scheme) return scheme;
  if (typeof city !== 'string') return idSchemeOf(city);
  return registered && registered.slug === city ? registered.scheme : null;
}

/**
 * Building paint store. Old bakes ('rank'): `strugglebus.paint.v1` (SF, as main has it; other cities
 * `v1:<slug>`). OSM bakes: `strugglebus.paint.v3` (`v3:<slug>`). v2 is skipped on purpose: feat/osm's
 * code before "ids" wrote it whatever the data was (the rank SF bake included), so it may hold rank ids.
 * Loading an OSM bake drops that city's v1 and v2 saves (never applied); an old bake never reads or
 * touches v2 / v3.
 */
export function paintStoreKey(slug: string, scheme: IdScheme): string {
  return paintKey(slug, scheme === 'osm' ? 'v3' : 'v1');
}
/** Saves an OSM load drops for its city: the rank store, and feat/osm's pre-"ids" one (either scheme's ids). */
const PAINT_STALE_ON_OSM = ['v1', 'v2'];
function paintKey(slug: string, v: string): string {
  return slug === 'sf' ? `strugglebus.paint.${v}` : `strugglebus.paint.${v}:${slug}`;
}
export const FACTION_RAINBOW = 1;

export interface PaintRecord {
  faction: number;
  color: number;
  level: number;
  bloomTime: number;
  /** Already painted before this bloom (escalation): keep showing paint until bloomTime. GPU only, never saved. */
  keep?: boolean;
}

export class PaintState {
  readonly width = 1024;
  readonly height: number;
  readonly data: Float32Array;
  readonly texture: THREE.DataTexture;
  private saved: Record<string, [number, number, number]> = {};
  private dirty = new Set<number>();
  private saveTimer = 0;
  /** stable id -> dense index for buildings currently known (loaded tiles) */
  private stableToIndex = new Map<number, number>();
  /** dense index -> stable id */
  private indexToStable = new Map<number, number>();
  paintedCount = 0;

  /** the localStorage key (null: the id scheme is unknown, nothing is read or written) */
  private readonly key: string | null;
  readonly scheme: IdScheme | null;

  /** `city`: city.json (its slug + "ids"), or just the slug; `scheme` overrides (see resolveIdScheme). */
  constructor(buildingCount: number, city: string | CityData = 'sf', scheme?: IdScheme) {
    const slug = typeof city === 'string' ? city : city.slug;
    this.scheme = resolveIdScheme(city, scheme);
    this.key = this.scheme ? paintStoreKey(slug, this.scheme) : null;
    this.height = Math.max(1, Math.ceil(buildingCount / this.width));
    this.data = new Float32Array(this.width * this.height * 4);
    this.texture = new THREE.DataTexture(this.data, this.width, this.height, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    try {
      // an OSM bake: this city's rank-keyed (or maybe rank-keyed) saves can never map onto these ids (dropped, never applied)
      if (this.scheme === 'osm') for (const v of PAINT_STALE_ON_OSM) localStorage.removeItem(paintKey(slug, v));
      const raw = this.key ? localStorage.getItem(this.key) : null;
      if (raw) this.saved = JSON.parse(raw) ?? {};
    } catch {
      this.saved = {};
    }
    this.paintedCount = Object.keys(this.saved).length;
    // saves are debounced inside the frame loop, which stops when the page is hidden (and iOS may then kill
    // a backgrounded Home Screen app): a splat right before swiping home is written out on the way out
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const flushSave = () => {
        if (this.saveTimer > 0) {
          this.saveTimer = 0;
          this.persist();
        }
      };
      window.addEventListener('pagehide', flushSave);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) flushSave();
      });
    }
  }

  /** Register a streamed-in building; applies any saved paint (no pop animation). */
  register(index: number, stableId: number): boolean {
    this.stableToIndex.set(stableId, index);
    this.indexToStable.set(index, stableId);
    const s = this.saved[stableId];
    if (s) {
      const o = index * 4;
      this.data[o] = s[1];
      this.data[o + 1] = s[2];
      this.data[o + 2] = -1000;
      this.data[o + 3] = s[0];
      this.dirty.add(index);
      return true;
    }
    return false;
  }

  get(index: number): PaintRecord {
    const o = index * 4;
    return { color: this.data[o], level: this.data[o + 1], bloomTime: this.data[o + 2], faction: this.data[o + 3] % 2 };
  }

  level(index: number): number {
    return this.data[index * 4 + 1];
  }

  set(index: number, rec: PaintRecord) {
    const o = index * 4;
    const was = this.data[o + 1] > 0.5;
    this.data[o] = rec.color;
    this.data[o + 1] = rec.level;
    this.data[o + 2] = rec.bloomTime;
    this.data[o + 3] = rec.faction + (rec.keep ? 2 : 0);
    this.dirty.add(index);
    const sid = this.indexToStable.get(index);
    if (sid !== undefined) {
      if (rec.level > 0) this.saved[sid] = [rec.faction, rec.color, rec.level];
      else delete this.saved[sid];
      this.saveTimer = 0.8;
    }
    if (!was && rec.level > 0.5) this.paintedCount++;
    if (was && rec.level < 0.5) this.paintedCount--;
  }

  resetAll() {
    this.data.fill(0);
    this.saved = {};
    this.paintedCount = 0;
    this.texture.needsUpdate = true;
    this.dirty.clear();
    try {
      if (this.key) localStorage.removeItem(this.key);
    } catch {
      /* private mode */
    }
  }

  /** Uploads changed texels: one texSubImage2D of their bounding rectangle (whole texture on first use). */
  flush(renderer: THREE.WebGLRenderer, dt: number) {
    if (this.saveTimer > 0) {
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) this.persist();
    }
    if (!this.dirty.size) return;
    let x0 = this.width, y0 = this.height, x1 = -1, y1 = -1;
    for (const i of this.dirty) {
      const x = i % this.width;
      const y = (i - x) / this.width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    this.dirty.clear();
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (!uploadRect(renderer, this.texture, x0, y0, x1 - x0 + 1, y1 - y0 + 1, gl.RGBA, gl.FLOAT, 4)) this.texture.needsUpdate = true;
  }

  persist() {
    if (!this.key) return;
    try {
      localStorage.setItem(this.key, JSON.stringify(this.saved));
    } catch {
      /* storage full or blocked: paint still works this session */
    }
  }
}
