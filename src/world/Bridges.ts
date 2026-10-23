import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRampMaterial, setVertexRamp, SHADOW_LAYER } from '../render/materials';
import { Ramp } from '../render/palette';

// Hand-built pixel landmarks: the Golden Gate Bridge (art-deco towers with
// stacked portal struts) and the Bay Bridge west span (X-braced towers, the
// big center anchorage). Chunky on purpose: at gameplay distance a cable is a
// pixel or two, so everything is sized to read as a silhouette in the fog.

type P2 = [number, number];

class Kit {
  parts: THREE.BufferGeometry[] = [];

  /** Oriented box between two 3D points (w across, h vertical-ish thickness). */
  beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, ramp: number, lo = 0) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 0.01) return;
    const g = new THREE.BoxGeometry(w, h, len);
    const m = new THREE.Matrix4();
    const z = d.clone().normalize();
    const up = Math.abs(z.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    m.makeBasis(x, y, z);
    m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    g.applyMatrix4(m);
    this.parts.push(setVertexRamp(g.toNonIndexed(), ramp, lo));
  }

  /** Axis-aligned-in-bridge-frame box: center, half extents, yaw. */
  block(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw: number, ramp: number, lo = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateY(yaw);
    g.translate(cx, cy, cz);
    this.parts.push(setVertexRamp(g.toNonIndexed(), ramp, lo));
  }

  build(): THREE.Mesh {
    const geo = mergeGeometries(this.parts, false)!;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, makeRampMaterial({ vertexRamp: true }));
    mesh.layers.enable(SHADOW_LAYER);
    return mesh;
  }
}

function frame(a: P2, b: P2) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  // across = right of travel
  return { L, ux, uz, ax: -uz, az: ux, yaw: Math.atan2(ux, uz) };
}

/** Parabolic cable between two anchor points with a given low point. */
function cable(k: Kit, a: THREE.Vector3, b: THREE.Vector3, sagY: number, segs: number, thick: number, ramp: number, lo: number) {
  let prev = a.clone();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = a.clone().lerp(b, t);
    const lin = a.y + (b.y - a.y) * t;
    const mid = (a.y + b.y) / 2;
    const depth = mid - sagY;
    p.y = lin - depth * 4 * t * (1 - t);
    k.beam(prev, p, thick, thick, ramp, lo);
    prev = p;
  }
}

function cableY(a: THREE.Vector3, b: THREE.Vector3, sagY: number, t: number) {
  const lin = a.y + (b.y - a.y) * t;
  const depth = (a.y + b.y) / 2 - sagY;
  return lin - depth * 4 * t * (1 - t);
}

export function makeGoldenGate(pts: P2[]): THREE.Object3D {
  // pts: south anchorage, south tower, north tower, north anchorage
  const k = new Kit();
  const [A0, T1, T2, A1] = pts;
  const f = frame(A0, A1);
  const deckY = 67;
  const towerH = 227;
  const half = 13.5; // deck half width
  const legOff = half + 2.5;
  const G = Ramp.GREY;
  const GL = Ramp.GREY_LIGHT;
  const at = (p: P2, along: number, across: number, y: number) => new THREE.Vector3(p[0] + f.ux * along + f.ax * across, y, p[1] + f.uz * along + f.az * across);

  // deck (stiffening truss) from anchorage to anchorage
  const d0 = at(A0, -40, 0, deckY), d1 = at(A1, 40, 0, deckY);
  const deckLen = d0.distanceTo(d1);
  k.block((d0.x + d1.x) / 2, deckY - 3.8, (d0.z + d1.z) / 2, half * 2, 7.6, deckLen, f.yaw, G, -0.06);
  k.block((d0.x + d1.x) / 2, deckY + 0.4, (d0.z + d1.z) / 2, half * 2 - 1, 0.8, deckLen, f.yaw, GL, -0.02);
  // the stiffening truss reads as a light top chord over a dark lattice band
  k.block((d0.x + d1.x) / 2, deckY - 7.4, (d0.z + d1.z) / 2, half * 2 + 0.6, 1.4, deckLen, f.yaw, G, -0.22);
  k.block((d0.x + d1.x) / 2, deckY - 0.8, (d0.z + d1.z) / 2, half * 2 + 0.8, 1.2, deckLen, f.yaw, GL, 0.04);

  for (const T of [T1, T2]) {
    // pier
    k.block(T[0], 6, T[1], 44, 18, 30, f.yaw, GL, -0.08);
    for (const side of [-1, 1]) {
      // stepped art-deco leg: four setbacks
      const levels = [
        [0, 60, 11.5, 15],
        [60, 120, 10, 13],
        [120, 175, 8.6, 11.5],
        [175, towerH, 7.4, 10],
      ];
      for (const [y0, y1, w, dd] of levels) {
        const c = at(T, 0, side * legOff, (y0 + y1) / 2);
        k.block(c.x, c.y, c.z, dd, y1 - y0, w, f.yaw + Math.PI / 2, G, 0.02);
      }
      // the cable saddle on top
      const top = at(T, 0, side * legOff, towerH + 3);
      k.block(top.x, top.y, top.z, 6, 6, 8, f.yaw, G, 0.04);
    }
    // portal struts above the deck + one below
    for (const [y, h] of [[deckY - 22, 7], [deckY + 38, 7], [deckY + 82, 6.5], [deckY + 120, 6], [towerH - 8, 8]] as Array<[number, number]>) {
      const a = at(T, 0, -legOff, y), b = at(T, 0, legOff, y);
      k.beam(a, b, 7, h, G, 0.0);
    }
  }

  // main cables + suspenders
  for (const side of [-1, 1]) {
    const a0 = at(A0, 0, side * legOff, deckY - 6);
    const t1 = at(T1, 0, side * legOff, towerH + 2);
    const t2 = at(T2, 0, side * legOff, towerH + 2);
    const a1 = at(A1, 0, side * legOff, deckY - 6);
    cable(k, a0, t1, deckY + 10, 6, 1.8, GL, 0.06);
    cable(k, t1, t2, deckY + 6, 28, 1.8, GL, 0.06);
    cable(k, t2, a1, deckY + 10, 6, 1.8, GL, 0.06);
    // suspenders every ~32 m on the main span (thin, low contrast)
    const spanL = Math.hypot(T2[0] - T1[0], T2[1] - T1[1]);
    const n = Math.floor(spanL / 32);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = t1.clone().lerp(t2, t);
      const cy = cableY(t1, t2, deckY + 6, t);
      k.beam(new THREE.Vector3(p.x, deckY + 0.5, p.z), new THREE.Vector3(p.x, cy, p.z), 0.7, 0.7, GL, 0.02);
    }
  }
  // anchorage blocks
  for (const A of [A0, A1]) k.block(A[0], deckY / 2 - 6, A[1], 40, deckY - 4, 46, f.yaw, GL, -0.05);
  const g = new THREE.Group();
  g.add(k.build());
  return g;
}

export function makeBayBridgeWest(pts: P2[]): THREE.Object3D {
  // pts: Rincon anchorage, W1, W2, center anchorage, W3, W4, Yerba Buena anchorage
  const k = new Kit();
  const f = frame(pts[0], pts[pts.length - 1]);
  const deckY = 58;
  const towerH = 160;
  const half = 12;
  const legOff = half + 2;
  const G = Ramp.GREY;
  const GL = Ramp.GREY_LIGHT;
  const at = (p: P2, along: number, across: number, y: number) => new THREE.Vector3(p[0] + f.ux * along + f.ax * across, y, p[1] + f.uz * along + f.az * across);
  const A0 = pts[0], A1 = pts[6];
  const d0 = at(A0, -60, 0, deckY), d1 = at(A1, 60, 0, deckY);
  const len = d0.distanceTo(d1);
  // double-deck truss
  k.block((d0.x + d1.x) / 2, deckY - 5, (d0.z + d1.z) / 2, half * 2, 10, len, f.yaw, G, -0.08);
  k.block((d0.x + d1.x) / 2, deckY + 0.5, (d0.z + d1.z) / 2, half * 2 - 1, 1, len, f.yaw, GL, -0.02);
  for (const ti of [1, 2, 4, 5]) {
    const T = pts[ti];
    k.block(T[0], 5, T[1], 36, 16, 26, f.yaw, GL, -0.08);
    for (const side of [-1, 1]) {
      const a = at(T, 0, side * legOff, 0), b = at(T, 0, side * legOff * 0.82, towerH);
      k.beam(a, b, 6.5, 6.5, G, 0.02);
    }
    // X bracing between the legs at three levels
    const levels = [deckY + 10, deckY + 45, deckY + 78, towerH - 4];
    for (let i = 0; i < levels.length - 1; i++) {
      const y0 = levels[i], y1 = levels[i + 1];
      const w0 = legOff * (1 - 0.18 * (y0 / towerH)), w1 = legOff * (1 - 0.18 * (y1 / towerH));
      k.beam(at(T, 0, -w0, y0), at(T, 0, w1, y1), 2.6, 2.6, G, -0.02);
      k.beam(at(T, 0, w0, y0), at(T, 0, -w1, y1), 2.6, 2.6, G, -0.02);
      k.beam(at(T, 0, -w1, y1), at(T, 0, w1, y1), 3.2, 3.2, G, 0.0);
    }
  }
  // center anchorage: a massive concrete block rising above the deck
  const C = pts[3];
  k.block(C[0], 45, C[1], 52, 90, 60, f.yaw, GL, -0.04);
  k.block(C[0], 93, C[1], 40, 6, 48, f.yaw, GL, 0.02);
  // cables for both suspension sections
  for (const side of [-1, 1]) {
    for (const [a, t1, t2, b] of [[0, 1, 2, 3], [3, 4, 5, 6]]) {
      const pa = at(pts[a], 0, side * legOff, a === 3 ? 90 : deckY - 4);
      const p1 = at(pts[t1], 0, side * legOff * 0.84, towerH + 1);
      const p2 = at(pts[t2], 0, side * legOff * 0.84, towerH + 1);
      const pb = at(pts[b], 0, side * legOff, b === 3 ? 90 : deckY - 4);
      cable(k, pa, p1, deckY + 8, 5, 1.6, GL, 0.05);
      cable(k, p1, p2, deckY + 5, 16, 1.6, GL, 0.05);
      cable(k, p2, pb, deckY + 8, 5, 1.6, GL, 0.05);
    }
  }
  const g = new THREE.Group();
  g.add(k.build());
  return g;
}
