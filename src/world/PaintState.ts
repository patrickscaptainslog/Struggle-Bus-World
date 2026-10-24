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
// Persistence: localStorage, keyed by the building's stable id (dataset id + lot),
//   value = [faction, color, level]. Applied as tiles stream in. Hand-built
//   landmark props (City.addLandmarkBuilding) take texels past the baked
//   buildings and save under a name key ('lm:transamerica') in a store of
//   their own (landmarkStoreKey), never among the buildings' ids: a re-bake that
//   renumbers the buildings (and drops their store) keeps the landmarks' paint,
//   and no key can collide with a stable id in any building store.

const STORE_KEY = 'strugglebus.paint.v1';
/** Every landmark paint key starts with this ('lm:coit'). */
export const LANDMARK_KEY_PREFIX = 'lm:';
/** The landmark paint store of a city (by its manifest slug): keyed by landmark names, independent of any bake. */
export function landmarkStoreKey(slug: string): string {
  return slug === 'sf' ? 'strugglebus.landmarks.v1' : `strugglebus.landmarks.v1:${slug}`;
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
  /** the landmarks' saved paint, by name key (its own store: see landmarkStoreKey) */
  private savedLm: Record<string, [number, number, number]> = {};
  private readonly lmStore: string;
  private dirty = new Set<number>();
  private saveTimer = 0;
  /** stable id (or a landmark's 'lm:' key) -> dense index for buildings currently known (loaded tiles, landmarks) */
  private stableToIndex = new Map<number | string, number>();
  /** dense index -> stable id (or landmark key) */
  private indexToStable = new Map<number, number | string>();
  paintedCount = 0;

  constructor(buildingCount: number, slug = 'sf') {
    this.lmStore = landmarkStoreKey(slug);
    this.height = Math.max(1, Math.ceil(buildingCount / this.width));
    this.data = new Float32Array(this.width * this.height * 4);
    this.texture = new THREE.DataTexture(this.data, this.width, this.height, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.saved = JSON.parse(raw) ?? {};
    } catch {
      this.saved = {};
    }
    try {
      const raw = localStorage.getItem(this.lmStore);
      if (raw) this.savedLm = JSON.parse(raw) ?? {};
    } catch {
      this.savedLm = {};
    }
    // (pre-merge fix/landmarks builds kept SF's landmark paint among the building ids: it moves to its own store)
    let moved = false;
    for (const k in this.saved)
      if (k.startsWith(LANDMARK_KEY_PREFIX)) {
        if (slug === 'sf' && !(k in this.savedLm)) this.savedLm[k] = this.saved[k];
        delete this.saved[k];
        moved = true;
      }
    if (moved) this.persist();
    this.paintedCount = Object.keys(this.saved).length + Object.keys(this.savedLm).length;
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

  /** Register a streamed-in building (or a landmark, by its string key); applies any saved paint (no pop animation). */
  register(index: number, stableId: number | string): boolean {
    this.stableToIndex.set(stableId, index);
    this.indexToStable.set(index, stableId);
    const s = typeof stableId === 'string' ? this.savedLm[stableId] : this.saved[stableId];
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
      const store = typeof sid === 'string' ? this.savedLm : this.saved;
      if (rec.level > 0) store[sid] = [rec.faction, rec.color, rec.level];
      else delete store[sid];
      this.saveTimer = 0.8;
    }
    if (!was && rec.level > 0.5) this.paintedCount++;
    if (was && rec.level < 0.5) this.paintedCount--;
  }

  resetAll() {
    this.data.fill(0);
    this.saved = {};
    this.savedLm = {};
    this.paintedCount = 0;
    this.texture.needsUpdate = true;
    this.dirty.clear();
    try {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(this.lmStore);
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
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.saved));
      localStorage.setItem(this.lmStore, JSON.stringify(this.savedLm));
    } catch {
      /* storage full or blocked: paint still works this session */
    }
  }
}
