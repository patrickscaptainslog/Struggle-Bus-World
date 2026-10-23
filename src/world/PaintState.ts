import * as THREE from 'three';

// Paint state, keyed by building. This is the array a Phase 2 server will own.
//
// GPU: RGBA32F texture, one texel per dense building index:
//   r = color index (0..5 within the faction palette), g = level (0 = grey, 1..3),
//   b = bloom start time (seconds, globals.uTime clock), a = faction (0 none, 1 Rainbow)
// Persistence: localStorage, keyed by the building's stable id (dataset id + lot),
//   value = [faction, color, level]. Applied as tiles stream in.

const STORE_KEY = 'strugglebus.paint.v1';
export const FACTION_RAINBOW = 1;

export interface PaintRecord {
  faction: number;
  color: number;
  level: number;
  bloomTime: number;
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

  constructor(buildingCount: number) {
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
    this.paintedCount = Object.keys(this.saved).length;
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
    return { color: this.data[o], level: this.data[o + 1], bloomTime: this.data[o + 2], faction: this.data[o + 3] };
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
    this.data[o + 3] = rec.faction;
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
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* private mode */
    }
  }

  /** Uploads changed texels (single-texel texSubImage2D; whole texture on first use). */
  flush(renderer: THREE.WebGLRenderer, dt: number) {
    if (this.saveTimer > 0) {
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) this.persist();
    }
    if (!this.dirty.size) return;
    const props = renderer.properties.get(this.texture) as { __webglTexture?: WebGLTexture };
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (!props.__webglTexture || this.texture.needsUpdate || this.dirty.size > 256) {
      this.texture.needsUpdate = true;
      this.dirty.clear();
      return;
    }
    renderer.state.activeTexture(gl.TEXTURE0);
    renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    for (const i of this.dirty) {
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.FLOAT, this.data, i * 4);
    }
    this.dirty.clear();
  }

  persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.saved));
    } catch {
      /* storage full or blocked: paint still works this session */
    }
  }
}
