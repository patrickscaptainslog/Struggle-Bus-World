import * as THREE from 'three';
import { SHADOW_LAYER, makeRampMaterial, globals } from '../render/materials';
import { Ramp } from '../render/palette';
import { makeBuildingMaterial, paintUniforms } from './buildingMaterial';
import { makeHeightGrid, makeTerrainMaterial } from './terrainMaterial';
import { PaintState } from './PaintState';
import { parseFar, type CityManifest, type FarData, type BuildingTile, type TerrainTile } from './tiles';
import type { RegionRequest, RegionResponse, TileResult } from './cityWorker';

// Streams the baked city around the bus: region bundles are fetched and
// meshed in a worker, tiles appear inside the fog, far ones are dropped.
// Also answers the questions gameplay asks: how high is the ground here,
// what's the tallest thing under this point, which buildings are near.

export interface BuildingRef {
  index: number;
  stableId: number;
  tile: BuildingTile;
  local: number; // index within tile
  cx: number;
  cz: number;
  baseY: number;
  roofY: number;
  area: number;
  hood: number;
}

interface LoadedTile {
  tx: number;
  tz: number;
  buildings: THREE.Mesh | null;
  terrain: THREE.Mesh | null;
  terrainData: TerrainTile | null;
  buildingData: BuildingTile | null;
  refs: BuildingRef[];
  classTex: THREE.DataTexture | null;
}

const LOAD_RADIUS = 1500; // m: regions whose center is within this get loaded
const DETAIL_RADIUS = 650; // m: regions nearer than this get full-detail meshes (bays, cornices, stoops)
const UNLOAD_RADIUS = 2300;
const HASH_CELL = 32;

export class City {
  readonly root = new THREE.Group();
  readonly paint: PaintState;
  readonly buildingMaterial = makeBuildingMaterial();
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { key: string; lod: 0 | 1 }>();
  private regionLod = new Map<string, 0 | 1>();
  private regionsLoaded = new Set<string>();
  private regionsRequested = new Set<string>();
  private regionAvailable = new Set<string>();
  private tiles = new Map<string, LoadedTile>();
  private hash = new Map<number, BuildingRef[]>();
  private far: FarData | null = null;
  private farGroup = new THREE.Group();
  private loadedMask: THREE.DataTexture;
  private maskW: number;
  private maskH: number;
  private regionSize: number;
  /** Called for every tile that arrives (trees, props, landmarks hook in here). */
  onTile: ((t: { tx: number; tz: number; terrain: TerrainTile | null; refs: BuildingRef[] }) => void) | null = null;
  onTileUnload: ((tx: number, tz: number) => void) | null = null;
  readonly loadedRegionCount = () => this.regionsLoaded.size;

  constructor(readonly manifest: CityManifest & { regions: Array<[number, number, number]>; regionSize: number }, readonly baseUrl: string) {
    this.paint = new PaintState(manifest.buildingCount);
    paintUniforms.uPaint.value = this.paint.texture;
    paintUniforms.uPaintW.value = this.paint.width;
    this.regionSize = manifest.regionSize;
    for (const [rx, rz] of manifest.regions) this.regionAvailable.add(`${rx},${rz}`);
    this.worker = new Worker(new URL('./cityWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<RegionResponse>) => this.onRegion(ev.data);
    const [minX, minZ, maxX, maxZ] = manifest.bounds;
    this.maskW = Math.round((maxX - minX) / manifest.tileSize);
    this.maskH = Math.round((maxZ - minZ) / manifest.tileSize);
    this.loadedMask = new THREE.DataTexture(new Uint8Array(this.maskW * this.maskH), this.maskW, this.maskH, THREE.RedFormat, THREE.UnsignedByteType);
    this.loadedMask.minFilter = this.loadedMask.magFilter = THREE.NearestFilter;
    this.loadedMask.needsUpdate = true;
    this.root.add(this.farGroup);
    // the bay / ocean: a huge still plane below everything
    const water = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), makeRampMaterial({ ramp: Ramp.WATER, lightOffset: -0.12, shadowMul: 0.6 }));
    water.position.set((minX + maxX) / 2, -0.6, (minZ + maxZ) / 2);
    water.frustumCulled = false;
    this.root.add(water);
  }

  async loadFar(): Promise<void> {
    const [res, hz] = await Promise.all([fetch(`${this.baseUrl}/far.bin`), fetch(`${this.baseUrl}/horizon.bin`).catch(() => null)]);
    this.far = parseFar(await res.arrayBuffer());
    this.buildFar();
    if (hz && hz.ok) this.buildHorizon(await hz.arrayBuffer());
  }

  /** The hills around the city (Marin, East Bay, San Bruno Mtn) as a coarse fogged ring. */
  private buildHorizon(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    const W = dv.getUint32(4, true), H = dv.getUint32(8, true);
    const minX = dv.getFloat32(12, true), minZ = dv.getFloat32(16, true), cell = dv.getFloat32(20, true);
    const hq = new Int16Array(buf.slice(24, 24 + W * H * 2));
    const step = 2;
    const w = Math.floor((W - 1) / step) + 1, h = Math.floor((H - 1) / step) + 1;
    const hAt = (i: number, j: number) => hq[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))] / 10;
    const pos = new Float32Array(w * h * 3);
    const nrm = new Float32Array(w * h * 3);
    const ramp = new Float32Array(w * h);
    const lo = new Float32Array(w * h);
    const gl = new Float32Array(w * h);
    const land = new Uint8Array(w * h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const gi = i * step, gj = j * step, k = j * w + i;
        const y = hAt(gi, gj);
        pos[k * 3] = minX + gi * cell;
        pos[k * 3 + 1] = y > 0.5 ? y - 3 : -1.5;
        pos[k * 3 + 2] = minZ + gj * cell;
        const dx = (hAt(gi + 2, gj) - hAt(gi - 2, gj)) / (4 * cell), dz = (hAt(gi, gj + 2) - hAt(gi, gj - 2)) / (4 * cell);
        const l = Math.hypot(dx, 1, dz);
        nrm[k * 3] = -dx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = -dz / l;
        ramp[k] = y > 40 ? Ramp.GREEN_GREY : Ramp.GREY_LIGHT;
        lo[k] = 0.02;
        land[k] = y > 0.5 ? 1 : 0;
      }
    const [bx0, bz0, bx1, bz1] = this.manifest.bounds;
    const idx: number[] = [];
    for (let j = 0; j < h - 1; j++)
      for (let i = 0; i < w - 1; i++) {
        const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
        if (!(land[a] || land[b] || land[c] || land[d])) continue;
        const x = pos[a * 3], z = pos[a * 3 + 2];
        // the city's own far grid covers its frame
        if (x >= bx0 && x + step * cell <= bx1 && z >= bz0 && z + step * cell <= bz1) continue;
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('ramp', new THREE.BufferAttribute(ramp, 1));
    g.setAttribute('lightOffset', new THREE.BufferAttribute(lo, 1));
    g.setAttribute('glow', new THREE.BufferAttribute(gl, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, makeRampMaterial({ vertexRamp: true, shadowMul: 0 }));
    mesh.frustumCulled = false;
    this.farGroup.add(mesh);
  }

  private buildFar() {
    const f = this.far!;
    // far terrain: 64 m grid over the whole city, sunk a little under the near tiles
    const step = 2;
    const W = Math.floor((f.gridW - 1) / step) + 1;
    const H = Math.floor((f.gridH - 1) / step) + 1;
    const pos = new Float32Array(W * H * 3);
    const nrm = new Float32Array(W * H * 3);
    const ramp = new Float32Array(W * H);
    const lo = new Float32Array(W * H);
    const gl = new Float32Array(W * H);
    const hAt = (i: number, j: number) => f.heights[Math.min(f.gridH - 1, Math.max(0, j)) * f.gridW + Math.min(f.gridW - 1, Math.max(0, i))];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const gi = i * step, gj = j * step;
        const k = j * W + i;
        const water = f.cls[Math.min(f.gridH - 1, gj) * f.gridW + Math.min(f.gridW - 1, gi)] === 2;
        pos[k * 3] = f.minX + gi * f.cell;
        pos[k * 3 + 1] = water ? -0.8 : hAt(gi, gj) - 2.2;
        pos[k * 3 + 2] = f.minZ + gj * f.cell;
        const dx = (hAt(gi + 1, gj) - hAt(gi - 1, gj)) / (2 * f.cell);
        const dz = (hAt(gi, gj + 1) - hAt(gi, gj - 1)) / (2 * f.cell);
        const l = Math.hypot(dx, 1, dz);
        nrm[k * 3] = -dx / l;
        nrm[k * 3 + 1] = 1 / l;
        nrm[k * 3 + 2] = -dz / l;
        ramp[k] = water ? Ramp.WATER : Ramp.GREY_LIGHT;
        lo[k] = water ? -0.1 : -0.06;
      }
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let q = 0;
    for (let j = 0; j < H - 1; j++)
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('ramp', new THREE.BufferAttribute(ramp, 1));
    g.setAttribute('lightOffset', new THREE.BufferAttribute(lo, 1));
    g.setAttribute('glow', new THREE.BufferAttribute(gl, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const farTerrain = new THREE.Mesh(g, makeRampMaterial({ vertexRamp: true, shadowMul: 1 }));
    farTerrain.frustumCulled = false;
    this.farGroup.add(farTerrain);

    // far skyline: tall buildings as boxes, hidden where real tiles are loaded
    const n = f.index.length;
    if (n) {
      const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const mat = makeRampMaterial({
        ramp: Ramp.GREY,
        lightOffset: 0.02,
        uniforms: {
          uMask: { value: this.loadedMask },
          uMaskRect: { value: new THREE.Vector4(this.manifest.bounds[0], this.manifest.bounds[1], 1 / this.manifest.tileSize, 0) },
          uMaskSize: { value: new THREE.Vector2(this.maskW, this.maskH) },
        },
        vertexChunk: /* glsl */ `
          {
            vec3 wc = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            ivec2 mc = ivec2(floor((wc.xz - uMaskRect.xy) * uMaskRect.z));
            mc = clamp(mc, ivec2(0), ivec2(uMaskSize) - 1);
            if (texelFetch(uMask, mc, 0).r > 0.5) p *= 0.0;
          }
        `,
      });
      // declare the mask uniforms in the vertex shader
      mat.vertexShader = mat.vertexShader.replace('void main() {', 'uniform sampler2D uMask;\nuniform vec4 uMaskRect;\nuniform vec2 uMaskSize;\nvoid main() {');
      const inst = new THREE.InstancedMesh(box, mat, n);
      const m4 = new THREE.Matrix4();
      const qn = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const ps = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const o = i * 7;
        const [cx, cz, hw, hd, yaw, baseY, roofY] = [f.boxes[o], f.boxes[o + 1], f.boxes[o + 2], f.boxes[o + 3], f.boxes[o + 4], f.boxes[o + 5], f.boxes[o + 6]];
        qn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
        sc.set(hw * 2, Math.max(1, roofY - baseY + 2), hd * 2);
        ps.set(cx, baseY - 2, cz);
        m4.compose(ps, qn, sc);
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      inst.layers.enable(SHADOW_LAYER);
      this.farGroup.add(inst);
    }
  }

  /** Stream regions around a point. */
  update(focus: THREE.Vector3, renderer: THREE.WebGLRenderer, dt: number) {
    const R = this.regionSize * this.manifest.tileSize;
    const rx0 = Math.floor((focus.x - LOAD_RADIUS) / R);
    const rx1 = Math.floor((focus.x + LOAD_RADIUS) / R);
    const rz0 = Math.floor((focus.z - LOAD_RADIUS) / R);
    const rz1 = Math.floor((focus.z + LOAD_RADIUS) / R);
    const want: Array<[number, number, number]> = [];
    for (let rz = rz0; rz <= rz1; rz++)
      for (let rx = rx0; rx <= rx1; rx++) {
        const key = `${rx},${rz}`;
        if (!this.regionAvailable.has(key) || this.regionsRequested.has(key)) continue;
        const cx = (rx + 0.5) * R, cz = (rz + 0.5) * R;
        // distance from focus to the region rectangle
        const dx = Math.max(Math.abs(focus.x - cx) - R / 2, 0);
        const dz = Math.max(Math.abs(focus.z - cz) - R / 2, 0);
        const d = Math.hypot(dx, dz);
        if (d < LOAD_RADIUS) want.push([rx, rz, d]);
      }
    // upgrade already-loaded coarse regions that are now close
    for (const key of this.regionsLoaded) {
      if (this.regionLod.get(key) !== 1 || this.isPending(key)) continue;
      const [rx, rz] = key.split(',').map(Number);
      const cx = (rx + 0.5) * R, cz = (rz + 0.5) * R;
      const d = Math.hypot(Math.max(Math.abs(focus.x - cx) - R / 2, 0), Math.max(Math.abs(focus.z - cz) - R / 2, 0));
      if (d < DETAIL_RADIUS * 0.8) want.push([rx, rz, d - 10000]);
    }
    want.sort((a, b) => a[2] - b[2]);
    for (const [rx, rz, d] of want) {
      if (this.pending.size >= 2) break;
      const key = `${rx},${rz}`;
      const lod: 0 | 1 = d < DETAIL_RADIUS ? 0 : 1;
      this.regionsRequested.add(key);
      const id = this.nextId++;
      this.pending.set(id, { key, lod });
      const msg: RegionRequest = { type: 'region', id, url: new URL(`${this.baseUrl}/r_${rx}_${rz}.bin`, location.href).href, classN: this.manifest.classN, lod };
      this.worker.postMessage(msg);
    }
    // unload far regions
    for (const key of this.regionsLoaded) {
      const [rx, rz] = key.split(',').map(Number);
      const cx = (rx + 0.5) * R, cz = (rz + 0.5) * R;
      const dx = Math.max(Math.abs(focus.x - cx) - R / 2, 0);
      const dz = Math.max(Math.abs(focus.z - cz) - R / 2, 0);
      if (Math.hypot(dx, dz) > UNLOAD_RADIUS) this.unloadRegion(rx, rz);
    }
    this.paint.flush(renderer, dt);
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  private isPending(key: string): boolean {
    for (const p of this.pending.values()) if (p.key === key) return true;
    return false;
  }

  private onRegion(msg: RegionResponse) {
    const p = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    if (!p) return;
    const key = p.key;
    if (msg.error) {
      console.warn('region failed', key, msg.error);
      if (!this.regionsLoaded.has(key)) this.regionsRequested.delete(key);
      return;
    }
    if (!this.regionsRequested.has(key)) return; // unloaded while in flight
    const upgrade = this.regionsLoaded.has(key);
    if (upgrade) {
      // swap coarse building meshes for detailed ones in place
      for (const t of msg.tiles) {
        const lt = this.tiles.get(`${t.tx},${t.tz}`);
        if (!lt || !t.mesh) continue;
        if (lt.buildings) {
          this.root.remove(lt.buildings);
          lt.buildings.geometry.dispose();
        }
        lt.buildings = this.makeBuildingMesh(t.mesh);
      }
    } else {
      this.regionsLoaded.add(key);
      for (const t of msg.tiles) this.addTile(t);
      this.loadedMask.needsUpdate = true;
    }
    this.regionLod.set(key, msg.lod);
  }

  private makeBuildingMesh(m: NonNullable<TileResult['mesh']>): THREE.Mesh | null {
    if (m.vertexCount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3, true));
    g.setAttribute('aFacade', new THREE.BufferAttribute(m.facade, 2));
    g.setAttribute('aMeta', new THREE.BufferAttribute(m.meta, 4));
    g.setAttribute('aBld', new THREE.BufferAttribute(m.bld, 4));
    g.setAttribute('aBld2', new THREE.BufferAttribute(m.bld2, 2));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    g.computeBoundingSphere();
    // generous bounds: painted buildings pop and wobble a little outside their rest pose
    if (g.boundingSphere) g.boundingSphere.radius += 6;
    const mesh = new THREE.Mesh(g, this.buildingMaterial);
    mesh.layers.enable(SHADOW_LAYER);
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    return mesh;
  }

  private addTile(t: TileResult) {
    const key = `${t.tx},${t.tz}`;
    if (this.tiles.has(key)) return;
    const lt: LoadedTile = { tx: t.tx, tz: t.tz, buildings: null, terrain: null, terrainData: t.terrain, buildingData: t.building, refs: [], classTex: null };
    const ts = this.manifest.tileSize;
    if (t.mesh) lt.buildings = this.makeBuildingMesh(t.mesh);
    if (t.building) {
      const b = t.building;
      for (let i = 0; i < b.count; i++) {
        const s = b.vertStart[i], e = b.vertStart[i + 1];
        let cx = 0, cz = 0, area = 0;
        for (let k = s; k < e; k++) {
          cx += b.xz[k * 2];
          cz += b.xz[k * 2 + 1];
          const k2 = k + 1 < e ? k + 1 : s;
          area += b.xz[k * 2] * b.xz[k2 * 2 + 1] - b.xz[k2 * 2] * b.xz[k * 2 + 1];
        }
        cx /= e - s;
        cz /= e - s;
        const ref: BuildingRef = { index: b.index[i], stableId: b.stableId[i], tile: b, local: i, cx, cz, baseY: b.baseY[i], roofY: b.roofY[i], area: Math.abs(area) / 2, hood: b.hood[i] };
        lt.refs.push(ref);
        const hk = this.hashKey(cx, cz);
        let list = this.hash.get(hk);
        if (!list) this.hash.set(hk, (list = []));
        list.push(ref);
        this.paint.register(ref.index, ref.stableId);
      }
    }
    if (t.terrain) {
      const tr = t.terrain;
      const tex = new THREE.DataTexture(tr.cls, tr.classN, tr.classN, THREE.RedFormat, THREE.UnsignedByteType);
      tex.minFilter = tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      lt.classTex = tex;
      const geo = makeHeightGrid(tr.heights, tr.n, tr.cell, tr.originX, tr.originZ, 2);
      const mesh = new THREE.Mesh(geo, makeTerrainMaterial(tex, tr.originX, tr.originZ, ts, tr.classN));
      mesh.layers.enable(SHADOW_LAYER);
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      lt.terrain = mesh;
      const [minX, minZ] = this.manifest.bounds;
      const mx = Math.round((tr.originX - minX) / ts);
      const mz = Math.round((tr.originZ - minZ) / ts);
      if (mx >= 0 && mz >= 0 && mx < this.maskW && mz < this.maskH) (this.loadedMask.image.data as Uint8Array)[mz * this.maskW + mx] = 255;
    }
    this.tiles.set(key, lt);
    this.onTile?.({ tx: t.tx, tz: t.tz, terrain: t.terrain, refs: lt.refs });
  }

  private unloadRegion(rx: number, rz: number) {
    const key = `${rx},${rz}`;
    this.regionsLoaded.delete(key);
    this.regionsRequested.delete(key);
    this.regionLod.delete(key);
    const rs = this.regionSize;
    const [minX, minZ] = this.manifest.bounds;
    const ts = this.manifest.tileSize;
    for (let tz = rz * rs; tz < (rz + 1) * rs; tz++)
      for (let tx = rx * rs; tx < (rx + 1) * rs; tx++) {
        const k = `${tx},${tz}`;
        const lt = this.tiles.get(k);
        if (!lt) continue;
        if (lt.buildings) {
          this.root.remove(lt.buildings);
          lt.buildings.geometry.dispose();
        }
        if (lt.terrain) {
          this.root.remove(lt.terrain);
          lt.terrain.geometry.dispose();
          (lt.terrain.material as THREE.Material).dispose();
        }
        lt.classTex?.dispose();
        for (const ref of lt.refs) {
          const hk = this.hashKey(ref.cx, ref.cz);
          const list = this.hash.get(hk);
          if (list) {
            const i = list.indexOf(ref);
            if (i >= 0) list.splice(i, 1);
          }
        }
        const mx = Math.round((tx * ts - minX) / ts);
        const mz = Math.round((tz * ts - minZ) / ts);
        if (mx >= 0 && mz >= 0 && mx < this.maskW && mz < this.maskH) (this.loadedMask.image.data as Uint8Array)[mz * this.maskW + mx] = 0;
        this.tiles.delete(k);
        this.onTileUnload?.(tx, tz);
      }
    this.loadedMask.needsUpdate = true;
  }

  private hashKey(x: number, z: number) {
    return (Math.floor(x / HASH_CELL) + 4096) * 8192 + (Math.floor(z / HASH_CELL) + 4096);
  }

  private tileAt(x: number, z: number): LoadedTile | undefined {
    const ts = this.manifest.tileSize;
    return this.tiles.get(`${Math.floor(x / ts)},${Math.floor(z / ts)}`);
  }

  /** Ground height (m). Falls back to the far grid where tiles aren't loaded. */
  groundAt(x: number, z: number): number {
    const lt = this.tileAt(x, z);
    if (lt?.terrainData) {
      const t = lt.terrainData;
      const fx = Math.min(t.n - 1.001, Math.max(0, (x - t.originX) / t.cell));
      const fz = Math.min(t.n - 1.001, Math.max(0, (z - t.originZ) / t.cell));
      const ix = Math.floor(fx), iz = Math.floor(fz);
      const ax = fx - ix, az = fz - iz;
      const h = t.heights;
      const n = t.n;
      const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
      return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
    }
    const f = this.far;
    if (!f) return 0;
    const fx = Math.min(f.gridW - 1.001, Math.max(0, (x - f.minX) / f.cell));
    const fz = Math.min(f.gridH - 1.001, Math.max(0, (z - f.minZ) / f.cell));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const ax = fx - ix, az = fz - iz;
    const w = f.gridW;
    const a = f.heights[iz * w + ix], b = f.heights[iz * w + ix + 1], c = f.heights[(iz + 1) * w + ix], d = f.heights[(iz + 1) * w + ix + 1];
    return Math.max(0, (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az);
  }

  /** Tallest thing (roof or ground) at a point, in meters. */
  obstacleAt(x: number, z: number): number {
    const lt = this.tileAt(x, z);
    if (lt?.terrainData) {
      const t = lt.terrainData;
      const c = this.manifest.tileSize / t.obstN;
      const ix = Math.min(t.obstN - 1, Math.max(0, Math.floor((x - t.originX) / c)));
      const iz = Math.min(t.obstN - 1, Math.max(0, Math.floor((z - t.originZ) / c)));
      return t.obst[iz * t.obstN + ix];
    }
    return this.groundAt(x, z) + 18; // unknown: assume rooftops
  }

  /** Buildings whose centroid is within r of (x, z), nearest first. */
  buildingsNear(x: number, z: number, r: number, out: Array<{ ref: BuildingRef; d: number }> = []): Array<{ ref: BuildingRef; d: number }> {
    out.length = 0;
    const c0x = Math.floor((x - r) / HASH_CELL), c1x = Math.floor((x + r) / HASH_CELL);
    const c0z = Math.floor((z - r) / HASH_CELL), c1z = Math.floor((z + r) / HASH_CELL);
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = this.hash.get((cx + 4096) * 8192 + (cz + 4096));
        if (!list) continue;
        for (const ref of list) {
          const d = Math.hypot(ref.cx - x, ref.cz - z);
          if (d <= r) out.push({ ref, d });
        }
      }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  /** True if (x, z) is inside the footprint of ref. */
  contains(ref: BuildingRef, x: number, z: number): boolean {
    const b = ref.tile;
    const s = b.vertStart[ref.local], e = b.vertStart[ref.local + 1];
    let inside = false;
    for (let i = s, j = e - 1; i < e; j = i++) {
      const xi = b.xz[i * 2], zi = b.xz[i * 2 + 1], xj = b.xz[j * 2], zj = b.xz[j * 2 + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Street-facing edge of a building: midpoint, outward normal, length. */
  frontOf(ref: BuildingRef): { x: number; z: number; nx: number; nz: number; len: number } {
    const b = ref.tile;
    const s = b.vertStart[ref.local], e = b.vertStart[ref.local + 1];
    const n = e - s;
    let k = b.front[ref.local];
    if (k === 255 || k >= n) {
      // fallback: longest edge
      let best = 0;
      for (let i = 0; i < n; i++) {
        const a = s + i, c = s + ((i + 1) % n);
        const L = Math.hypot(b.xz[c * 2] - b.xz[a * 2], b.xz[c * 2 + 1] - b.xz[a * 2 + 1]);
        if (L > best) { best = L; k = i; }
      }
    }
    const a = s + k, c = s + ((k + 1) % n);
    const ax = b.xz[a * 2], az = b.xz[a * 2 + 1], cx = b.xz[c * 2], cz = b.xz[c * 2 + 1];
    const len = Math.hypot(cx - ax, cz - az) || 1;
    let nx = (cz - az) / len, nz = -(cx - ax) / len;
    // make sure the normal points away from the centroid
    const mx = (ax + cx) / 2, mz = (az + cz) / 2;
    if ((mx - ref.cx) * nx + (mz - ref.cz) * nz < 0) { nx = -nx; nz = -nz; }
    return { x: mx, z: mz, nx, nz, len };
  }

  /** Oriented roof rectangle (for rooftop sprouts). */
  roofRect(ref: BuildingRef): { cx: number; cz: number; y: number; w: number; d: number; yaw: number } {
    const f = this.frontOf(ref);
    const ux = -f.nz, uz = f.nx;
    const b = ref.tile;
    const s = b.vertStart[ref.local], e = b.vertStart[ref.local + 1];
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (let k = s; k < e; k++) {
      const x = b.xz[k * 2] - ref.cx, z = b.xz[k * 2 + 1] - ref.cz;
      const ss = x * ux + z * uz;
      const tt = x * f.nx + z * f.nz;
      s0 = Math.min(s0, ss); s1 = Math.max(s1, ss); t0 = Math.min(t0, tt); t1 = Math.max(t1, tt);
    }
    const cs = (s0 + s1) / 2, ct = (t0 + t1) / 2;
    return { cx: ref.cx + ux * cs + f.nx * ct, cz: ref.cz + uz * cs + f.nz * ct, y: ref.roofY, w: (s1 - s0) * 0.86, d: (t1 - t0) * 0.86, yaw: Math.atan2(ux, uz) };
  }

  neighborhoodName(hood: number): string {
    return this.manifest.neighborhoods[hood]?.name ?? this.manifest.name;
  }

  /** Every currently loaded building ref (for ambient sparkles etc.). */
  *loadedRefs(): IterableIterator<BuildingRef> {
    for (const t of this.tiles.values()) yield* t.refs;
  }

  get time() {
    return globals.uTime.value;
  }
}
