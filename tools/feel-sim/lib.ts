import { DATA_DIR } from './env';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { City, type BuildingRef } from '@src/world/City';
import { config } from '@src/config';
import { CameraRig } from '@src/game/CameraRig';
import { treeHeight, treeScale } from '@src/world/props/trees';
export { makeGame, type Game } from '@loop';
export { config, City, THREE, CameraRig };
export type { BuildingRef };

export const MODE = process.env.SB_MODE ?? 'new';
export const manifest = JSON.parse(readFileSync(`${DATA_DIR}/city.json`, 'utf8'));
export const fakeRenderer = { properties: { get: () => ({}) }, getContext: () => ({}), state: {} } as unknown as THREE.WebGLRenderer;
export const tick = () => new Promise((r) => setImmediate(r));
export const OUT = process.env.SB_OUT ?? 'shots/feel/sim';
export function save(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${MODE}-${name}.json`, JSON.stringify(data, null, 1));
}

// tmerc, exact (as the bake)
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2), E4 = E2 * E2, E6 = E4 * E2;
const mer = (p: number) => A * ((1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256) * p - ((3 * E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024) * Math.sin(2 * p) + ((15 * E4) / 256 + (45 * E6) / 1024) * Math.sin(4 * p) - ((35 * E6) / 3072) * Math.sin(6 * p));
export function ll(lat: number, lon: number): [number, number] {
  const r = Math.PI / 180, [la0, lo0] = manifest.origin;
  const p = lat * r, s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
  const N = A / Math.sqrt(1 - E2 * s * s), T = t * t, C = EP2 * c * c, a = (lon - lo0) * r * c, a2 = a * a;
  const x = N * (a + ((1 - T + C) * a2 * a) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a2 * a2 * a) / 120);
  const y = mer(p) - mer(la0 * r) + N * t * (a2 / 2 + ((5 - T + 9 * C + 4 * C * C) * a2 * a2) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a2 * a2 * a2) / 720);
  return [x, -y];
}

export async function newCity(): Promise<City> {
  const c = new City(manifest, '/city/sf');
  c.eager = true;
  await c.loadFar();
  return c;
}
const focusTmp = new THREE.Vector3();
/** Stream until nothing is pending around (x, z) (like main: ahead under the view when high). */
export async function pump(city: City, x: number, z: number, viewHeight = 0, fx = 0, fz = 0) {
  const hk = Math.min(1, Math.max(0, viewHeight / 450));
  focusTmp.set(x + fx * 950 * hk, 60, z + fz * 950 * hk);
  city.viewHeight = viewHeight;
  for (let i = 0; i < 100000; i++) {
    city.update(focusTmp, fakeRenderer, 1 / 60);
    if (!city.busy) return;
    await tick();
  }
}

// ---------------------------------------------------------------- ground truth
// rendered building height field (1 m raster of the tile's actual LOD0 mesh), tree crown domes, sprouts
const rasters = new Map<string, { id: string; h: Float32Array }>();
function tileRaster(city: City, tx: number, tz: number): Float32Array | null {
  const lt = (city as any).tiles.get(`${tx},${tz}`);
  const mesh: THREE.Mesh | null = lt?.buildings ?? null;
  if (!mesh) return null;
  const key = `${tx},${tz}`;
  const have = rasters.get(key);
  if (have && have.id === mesh.uuid) return have.h;
  const ts = manifest.tileSize, ox = tx * ts, oz = tz * ts, N = ts;
  const h = new Float32Array(N * N).fill(-1e9);
  const pos = mesh.geometry.getAttribute('position').array as Float32Array;
  const idx = mesh.geometry.getIndex()!.array as Uint32Array;
  const stamp = (x: number, z: number, y: number) => {
    const i = Math.floor(x - ox), j = Math.floor(z - oz);
    if (i >= 0 && j >= 0 && i < N && j < N && y > h[j * N + i]) h[j * N + i] = y;
  };
  for (let v = 0; v < pos.length / 3; v++) stamp(pos[v * 3], pos[v * 3 + 2], pos[v * 3 + 1]);
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    const ax = pos[a], az = pos[a + 2], bx = pos[b], bz = pos[b + 2], cx = pos[c], cz = pos[c + 2];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-6) continue;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - ox)), i1 = Math.min(N - 1, Math.floor(Math.max(ax, bx, cx) - ox));
    const j0 = Math.max(0, Math.floor(Math.min(az, bz, cz) - oz)), j1 = Math.min(N - 1, Math.floor(Math.max(az, bz, cz) - oz));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = ox + i + 0.5, pz = oz + j + 0.5;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
        const y = l1 * pos[a + 1] + l2 * pos[b + 1] + l3 * pos[c + 1];
        if (y > h[j * N + i]) h[j * N + i] = y;
      }
  }
  rasters.set(key, { id: mesh.uuid, h });
  return h;
}
const KR = [4.35, 9.62, 4.2], KM = [5.7, 10.8, 10.0];
/** Rendered surface height at (x, z): buildings (actual mesh), tree crowns, painted sprouts, ground. */
export function truth(city: City, x: number, z: number, sprouts?: Array<{ x: number; z: number; r: number; top: number }>): number {
  const ts = manifest.tileSize, tx = Math.floor(x / ts), tz = Math.floor(z / ts);
  let y = city.groundAt(x, z);
  const r = tileRaster(city, tx, tz);
  if (r) {
    const i = Math.floor(x - tx * ts), j = Math.floor(z - tz * ts);
    y = Math.max(y, r[j * ts + i]);
  } else {
    const rf = city.roofAt(x, z);
    if (rf !== null) y = Math.max(y, rf);
  }
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const lt = (city as any).tiles.get(`${tx + dx},${tz + dz}`);
      const trees = lt?.terrainData?.trees;
      if (!trees) continue;
      for (const t of trees) {
        const k = Math.max(0, Math.min(2, Math.round(t.kind)));
        const sc = treeScale(k, t.size);
        const R = KR[k] * sc;
        const d2 = (t.x - x) ** 2 + (t.z - z) ** 2;
        if (d2 >= R * R) continue;
        const top = treeHeight(k, t.size), mid = Math.min(KM[k] * sc, top * 0.8);
        y = Math.max(y, t.y + mid + (top - mid) * Math.sqrt(1 - d2 / (R * R)));
      }
    }
  if (sprouts) for (const s of sprouts) if ((s.x - x) ** 2 + (s.z - z) ** 2 < s.r * s.r) y = Math.max(y, s.top);
  return y;
}

// the bus: 9 points on its tyre-bottom plane (front/mid/rear x left/center/right), scale 1.6
const BUS_PTS: Array<[number, number, number]> = [];
for (const zz of [-5.68, 0, 5.54]) for (const xx of [-1.255, 0, 1.255]) BUS_PTS.push([xx * 1.6, -1.58 * 1.6, zz * 1.6]);
const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3();
/** Lowest clearance of the bus's underside over the rendered surfaces (m; < 0 = flying through something). */
export function busClearance(city: City, f: any, sprouts?: Array<{ x: number; z: number; r: number; top: number }>): number {
  e.set(f.pitch, -f.heading, -f.bank, 'YXZ');
  q.setFromEuler(e);
  let m = Infinity;
  for (const p of BUS_PTS) {
    v.set(p[0], p[1], p[2]).applyQuaternion(q);
    const wx = f.x + v.x, wy = f.y + v.y, wz = f.z + v.z;
    m = Math.min(m, wy - truth(city, wx, wz, sprouts));
  }
  return m;
}

// on-screen bus size through the real chase camera
const BOX: Array<[number, number, number]> = [];
for (const xx of [-1.255, 1.255]) for (const yy of [-1.58, 3.19 - 1.58]) for (const zz of [-5.68, 5.54]) BOX.push([xx * 1.6, yy * 1.6, zz * 1.6]);
export function makeCam() {
  const cam = new THREE.PerspectiveCamera(50, 240 / 520, 1, 30000);
  const rig = new CameraRig();
  const focus = new THREE.Vector3();
  return {
    cam, rig,
    update(f: any, dt: number) {
      rig.update(cam, focus, f, dt);
      const hf = (rig.hfov * Math.PI) / 180;
      cam.fov = (2 * Math.atan(Math.tan(hf / 2) / (240 / 520)) * 180) / Math.PI;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    },
    /** projected bus bounding box: [width, height] in game px (240 x 520 frame) and the center (0..1) */
    busBox(f: any): { w: number; h: number; area: number; cx: number; cy: number } {
      e.set(f.pitch, -f.heading, -f.bank, 'YXZ');
      q.setFromEuler(e);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of BOX) {
        v.set(p[0], p[1], p[2]).multiplyScalar(rig.heroScale).applyQuaternion(q).add(new THREE.Vector3(f.x, f.y, f.z)).project(cam);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      const w = ((x1 - x0) / 2) * 240, h = ((y1 - y0) / 2) * 520;
      return { w, h, area: w * h, cx: (x0 + x1) / 4 + 0.5, cy: 0.5 - (y0 + y1) / 4 };
    },
    project(x: number, y: number, z: number) {
      v.set(x, y, z).project(cam);
      return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, z: v.z };
    },
  };
}
