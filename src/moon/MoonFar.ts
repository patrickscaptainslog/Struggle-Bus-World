import * as THREE from 'three';
import { FAR, type FarUpdate } from './gen';
import type { MoonFarRequest } from './moonWorker';
import { makeMoonFar } from './moonMaterial';

// The far field: from where the loaded tiles end to the horizon, at any height. Eight clip levels around the view, each twice the last in metres a texel, so one patch mesh instanced some hundreds of times draws
// all of it in one draw. No file: the worker makes each block from the generator as the window reaches it, and a level's window only ever moves by a block of the next level up, so every level's hole is a
// whole number of the next level's blocks.
//
// Heights are an atlas of 17 x 17 blocks, read by the vertices. The map is one toroidal store a level, read by the pixels, which take the finest level their size on the ground allows: a coarser level is the
// finer one's mip with a wider window. Both are texture arrays, one layer a level.

const { LEVELS, N, B, BLOCKS, QUADS, V, C0 } = FAR;
const TEXEL_MARGIN = 1.5;

interface Level {
  k: number;
  cell: number;
  /** the window, in blocks, once its blocks have landed */
  bi0: number;
  bj0: number;
  ready: boolean;
  /** asked for, on its way */
  wantI: number;
  wantJ: number;
  /** heights and tone as the atlas has them, for groundAt */
  H: Float32Array;
}

function patchGeometry(): THREE.InstancedBufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const n = QUADS + 1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(i, 0, j);
  const at = (i: number, j: number) => j * n + i;
  for (let j = 0; j < QUADS; j++)
    for (let i = 0; i < QUADS; i++) {
      const a = at(i, j), b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  // the skirts: every edge hangs a wall, facing out
  const wall = (i0: number, j0: number, di: number, dj: number, flip: boolean) => {
    const base = pos.length / 3;
    for (let q = 0; q < n; q++) pos.push(i0 + di * q, 1, j0 + dj * q);
    for (let q = 0; q < QUADS; q++) {
      const a = at(i0 + di * q, j0 + dj * q), b = at(i0 + di * (q + 1), j0 + dj * (q + 1)), a2 = base + q, b2 = base + q + 1;
      if (flip) idx.push(b, a, a2, b, a2, b2);
      else idx.push(a, b, a2, b, b2, a2);
    }
  };
  wall(0, 0, 1, 0, false); // north
  wall(0, QUADS, 1, 0, true); // south
  wall(0, 0, 0, 1, true); // west
  wall(QUADS, 0, 0, 1, false); // east
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

export class MoonFar {
  readonly object: THREE.Mesh;
  private readonly levels: Level[] = [];
  private readonly geo = patchGeometry();
  private readonly patches: THREE.InstancedBufferAttribute;
  private readonly texH: THREE.DataArrayTexture;
  private readonly texM: THREE.DataArrayTexture;
  /** each level's window on the map (m), a texel and a half in: past that a filtered read would wrap */
  private readonly rects: THREE.Vector4[] = [];
  /** updates landed, waiting for a frame: one a frame, whole */
  private landed: FarUpdate[] = [];
  private inFlight = 0;
  private started = false;
  private ready0: () => void = () => {};
  /** Every level has landed and gone up. */
  readonly ready = new Promise<void>((done) => (this.ready0 = done));

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly post: (m: MoonFarRequest) => void, mask: THREE.Texture, maskRect: THREE.Vector4, maskSize: THREE.Vector2) {
    const AT = BLOCKS * V;
    for (let k = 0; k < LEVELS; k++) this.levels.push({ k, cell: C0 * 2 ** k, bi0: 0, bj0: 0, ready: false, wantI: NaN, wantJ: NaN, H: new Float32Array(AT * AT * 2) });
    // (the heights never filter: a vertex fetches its own texel. The map does, and wraps: a window is a torus in it)
    this.texH = new THREE.DataArrayTexture(new Float32Array(AT * AT * LEVELS * 2), AT, AT, LEVELS);
    this.texH.format = THREE.RGFormat;
    this.texH.type = THREE.FloatType;
    this.texH.internalFormat = 'RG32F';
    this.texH.minFilter = this.texH.magFilter = THREE.NearestFilter;
    this.texH.generateMipmaps = false;
    this.texH.needsUpdate = true;
    this.texM = new THREE.DataArrayTexture(new Uint8Array(N * N * LEVELS * 2), N, N, LEVELS);
    this.texM.format = THREE.RGFormat;
    this.texM.type = THREE.UnsignedByteType;
    this.texM.colorSpace = THREE.NoColorSpace;
    this.texM.minFilter = this.texM.magFilter = THREE.LinearFilter;
    this.texM.wrapS = this.texM.wrapT = THREE.RepeatWrapping;
    this.texM.generateMipmaps = false;
    this.texM.needsUpdate = true;
    const max = LEVELS * BLOCKS * BLOCKS;
    this.patches = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.patches.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aPatch', this.patches);
    this.geo.instanceCount = 0;
    const grid = new THREE.Vector4(C0, B, QUADS, V);
    for (let k = 0; k < LEVELS; k++) this.rects.push(new THREE.Vector4());
    const mat = makeMoonFar(this.texH, this.texM, mask, maskRect, maskSize, grid, LEVELS, this.rects);
    this.object = new THREE.Mesh(this.geo, mat);
    this.object.frustumCulled = false;
    this.object.matrixAutoUpdate = false;
    this.object.matrixWorldAutoUpdate = false;
  }

  /** The windows around a point, coarsest first: a level moves when the point is more than a block from its centre, by two of its blocks, so its edge is on the next level's blocks. */
  private wanted(x: number, z: number): Array<[number, number, number]> {
    const moves: Array<[number, number, number]> = [];
    let upI = NaN, upJ = NaN;
    for (let k = LEVELS - 1; k >= 0; k--) {
      const l = this.levels[k], b = B * l.cell;
      const fit = (p: number, was: number) => {
        if (Number.isFinite(was) && Math.abs(p / b - (was + BLOCKS / 2)) <= 1) return was;
        return 2 * Math.round(p / (2 * b)) - BLOCKS / 2;
      };
      let wi = fit(x, l.wantI), wj = fit(z, l.wantJ);
      // (inside the level over it, always: that level's hole is this window)
      if (Number.isFinite(upI)) {
        wi = Math.min(Math.max(wi, 2 * upI), 2 * upI + BLOCKS);
        wj = Math.min(Math.max(wj, 2 * upJ), 2 * upJ + BLOCKS);
      }
      if (wi !== l.wantI || wj !== l.wantJ) {
        l.wantI = wi;
        l.wantJ = wj;
        moves.push([k, wi, wj]);
      }
      upI = wi;
      upJ = wj;
    }
    return moves;
  }

  /** Before the first frame: every level around the start, the first thing the worker does. */
  start(x: number, z: number) {
    this.started = true;
    this.renderer.initTexture(this.texH);
    this.renderer.initTexture(this.texM);
    // (three has its first upload: only blocks go up from here on, and these arrays were all zeros)
    (this.texH.image as { data: unknown }).data = new Float32Array(0);
    (this.texM.image as { data: unknown }).data = new Uint8Array(0);
    const moves = this.wanted(x, z);
    this.inFlight = moves.length;
    this.post({ type: 'far', moves });
  }

  /** A level's blocks from the worker. */
  land(u: FarUpdate) {
    this.landed.push(u);
    this.inFlight--;
  }

  /** Every frame, from the view's place on the map. */
  update(x: number, z: number) {
    if (!this.started) return;
    // at most one level's blocks a frame, all of them at once: a window doesn't move by halves
    const u = this.landed.shift();
    if (u) this.upload(u);
    if (this.inFlight === 0 && !this.landed.length) {
      const moves = this.wanted(x, z);
      if (moves.length) {
        this.inFlight = moves.length;
        this.post({ type: 'far', moves });
      }
    }
  }

  private upload(u: FarUpdate) {
    const l = this.levels[u.k], r = this.renderer, gl = r.getContext() as WebGL2RenderingContext, st = r.state;
    const n = u.blocks.length / 2;
    const propsH = r.properties.get(this.texH) as { __webglTexture?: WebGLTexture };
    const propsM = r.properties.get(this.texM) as { __webglTexture?: WebGLTexture };
    st.activeTexture(gl.TEXTURE0);
    st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    st.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    st.bindTexture(gl.TEXTURE_2D_ARRAY, propsM.__webglTexture!);
    for (let q = 0; q < n; q++) {
      const si = ((u.blocks[q * 2] % BLOCKS) + BLOCKS) % BLOCKS, sj = ((u.blocks[q * 2 + 1] % BLOCKS) + BLOCKS) % BLOCKS;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, si * B, sj * B, u.k, B, B, 1, gl.RG, gl.UNSIGNED_BYTE, u.map, q * B * B * 2);
    }
    st.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    st.bindTexture(gl.TEXTURE_2D_ARRAY, propsH.__webglTexture!);
    const AT = BLOCKS * V;
    for (let q = 0; q < n; q++) {
      const si = ((u.blocks[q * 2] % BLOCKS) + BLOCKS) % BLOCKS, sj = ((u.blocks[q * 2 + 1] % BLOCKS) + BLOCKS) % BLOCKS;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, si * V, sj * V, u.k, V, V, 1, gl.RG, gl.FLOAT, u.heights, q * V * V * 2);
      for (let j = 0; j < V; j++) l.H.set(u.heights.subarray((q * V + j) * V * 2, (q * V + j + 1) * V * 2), ((sj * V + j) * AT + si * V) * 2);
    }

    l.bi0 = u.bi0;
    l.bj0 = u.bj0;
    l.ready = true;
    const b = B * l.cell, m = TEXEL_MARGIN * l.cell;
    this.rects[l.k].set(l.bi0 * b + m, l.bj0 * b + m, (l.bi0 + BLOCKS) * b - m, (l.bj0 + BLOCKS) * b - m);
    this.instances();
    if (this.levels.every((v) => v.ready)) this.ready0();
  }

  /** Which blocks draw: each level's window, less the window of the level inside it. */
  private instances() {
    const a = this.patches.array as Float32Array;
    let n = 0;
    for (const l of this.levels) {
      if (!l.ready) continue;
      const fine = l.k > 0 ? this.levels[l.k - 1] : null;
      for (let bj = l.bj0; bj < l.bj0 + BLOCKS; bj++)
        for (let bi = l.bi0; bi < l.bi0 + BLOCKS; bi++) {
          if (fine?.ready && 2 * bi >= fine.bi0 && 2 * bi + 2 <= fine.bi0 + BLOCKS && 2 * bj >= fine.bj0 && 2 * bj + 2 <= fine.bj0 + BLOCKS) continue;
          a[n++] = bi;
          a[n++] = bj;
          a[n++] = l.k;
        }
    }
    this.patches.needsUpdate = true;
    this.geo.instanceCount = n / 3;
  }

  /** The ground as the far field has it (world Y), where no tile is loaded. */
  heightAt(x: number, z: number): number {
    const AT = BLOCKS * V, dv = B / QUADS;
    for (const l of this.levels) {
      if (!l.ready) continue;
      const fx = x / (l.cell * dv), fz = z / (l.cell * dv);
      const qi = Math.floor(fx / QUADS), qj = Math.floor(fz / QUADS);
      if (qi < l.bi0 || qj < l.bj0 || qi >= l.bi0 + BLOCKS || qj >= l.bj0 + BLOCKS) continue;
      const si = ((qi % BLOCKS) + BLOCKS) % BLOCKS, sj = ((qj % BLOCKS) + BLOCKS) % BLOCKS;
      const vx = fx - qi * QUADS, vz = fz - qj * QUADS, ix = Math.floor(vx), iz = Math.floor(vz), tx = vx - ix, tz = vz - iz;
      const k = ((sj * V + iz) * AT + si * V + ix) * 2, H = l.H;
      return (H[k] * (1 - tx) + H[k + 2] * tx) * (1 - tz) + (H[k + AT * 2] * (1 - tx) + H[k + AT * 2 + 2] * tx) * tz;
    }
    return 0;
  }

  get patchCount(): number {
    return this.geo.instanceCount;
  }
}
