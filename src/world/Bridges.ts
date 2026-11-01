import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRampMaterial, setVertexRamp, SHADOW_LAYER } from '../render/materials';
import { Ramp } from '../render/palette';
import { registerWarm } from '../render/warmup';

// Hand-built pixel landmarks: the Golden Gate Bridge (art-deco towers with
// stacked portal struts) and the Bay Bridge west span (X-braced towers, the
// big center anchorage). Chunky on purpose: at gameplay distance a cable is a
// pixel or two, so everything is sized to read as a silhouette in the fog.

type P2 = [number, number];
/** x, z and the top of the roadway (m ASL): one vertex of a deck, as city.json's landmark rows hold them. */
export type DeckPoint = [number, number, number];

/**
 * One bridge's deck, from the one list its row holds: the mesh, the heights its towers and cables read and its collision
 * posts all go through this, so a deck and its collision can't part again. A station is metres along the polyline.
 */
class Deck {
  /** the station of each vertex */
  readonly s: number[] = [0];
  readonly length: number;

  constructor(readonly pts: DeckPoint[]) {
    for (let i = 1; i < pts.length; i++) this.s.push(this.s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.s[this.s.length - 1];
  }

  /** The station of the point of the deck's line nearest p. */
  stationOf(p: P2): number {
    let best = Infinity, at = 0;
    for (let i = 0; i + 1 < this.pts.length; i++) {
      const [ax, az] = this.pts[i], [bx, bz] = this.pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz)));
      const d = Math.hypot(ax + dx * t - p[0], az + dz * t - p[1]);
      if (d < best) {
        best = d;
        at = this.s[i] + (this.s[i + 1] - this.s[i]) * t;
      }
    }
    return at;
  }

  /** x, z and top at a station. */
  at(s: number): DeckPoint {
    let i = 0;
    while (i + 2 < this.pts.length && s > this.s[i + 1]) i++;
    const a = this.pts[i], b = this.pts[i + 1];
    const t = Math.min(1, Math.max(0, (s - this.s[i]) / (this.s[i + 1] - this.s[i])));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /** The local top under a point on the deck's line. */
  topAt(p: P2): number {
    return this.at(this.stationOf(p))[2];
  }
}

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

/** A parabolic cable's height at t, from y0 to y1, sagY its height at mid span. */
function cableY(y0: number, y1: number, sagY: number, t: number) {
  const lin = y0 + (y1 - y0) * t;
  const depth = (y0 + y1) / 2 - sagY;
  return lin - depth * 4 * t * (1 - t);
}

/** Parabolic cable between two anchor points with a given low point. */
function cable(k: Kit, a: THREE.Vector3, b: THREE.Vector3, sagY: number, segs: number, thick: number, ramp: number, lo: number) {
  let prev = a.clone();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = a.clone().lerp(b, t);
    p.y = cableY(a.y, b.y, sagY, t);
    k.beam(prev, p, thick, thick, ramp, lo);
    prev = p;
  }
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
  // International Orange even in the grey world (it is never painted): one muted warm landmark whose
  // shadows go rose and plum; the fog turns it pale rust at range. Piers and anchorages are concrete.
  const G = Ramp.BRIDGE_ORANGE;
  const GL = Ramp.BRIDGE_ORANGE;
  const C = Ramp.GREY_LIGHT;
  const at = (p: P2, along: number, across: number, y: number) => new THREE.Vector3(p[0] + f.ux * along + f.ax * across, y, p[1] + f.uz * along + f.az * across);

  // deck (stiffening truss) from anchorage to anchorage
  const d0 = at(A0, -40, 0, deckY), d1 = at(A1, 40, 0, deckY);
  const deckLen = d0.distanceTo(d1);
  k.block((d0.x + d1.x) / 2, deckY - 3.8, (d0.z + d1.z) / 2, half * 2, 7.6, deckLen, f.yaw, G, -0.06);
  // (the roadway on top is asphalt grey; the truss and its chords are the orange)
  k.block((d0.x + d1.x) / 2, deckY + 0.4, (d0.z + d1.z) / 2, half * 2 - 1, 0.8, deckLen, f.yaw, Ramp.GREY, -0.02);
  // the stiffening truss reads as a light top chord over a dark lattice band
  k.block((d0.x + d1.x) / 2, deckY - 7.4, (d0.z + d1.z) / 2, half * 2 + 0.6, 1.4, deckLen, f.yaw, G, -0.22);
  k.block((d0.x + d1.x) / 2, deckY - 0.8, (d0.z + d1.z) / 2, half * 2 + 0.8, 1.2, deckLen, f.yaw, GL, 0.04);

  for (const T of [T1, T2]) {
    // pier
    k.block(T[0], 6, T[1], 44, 18, 30, f.yaw, C, -0.08);
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
    cable(k, a0, t1, deckY + 10, 6, 1.8, GL, 0.1);
    cable(k, t1, t2, deckY + 6, 28, 1.8, GL, 0.1);
    cable(k, t2, a1, deckY + 10, 6, 1.8, GL, 0.1);
    // suspenders every ~48 m on the main span: 1.2 m thick, so at the opening's distances they are a
    // steady 1-2 game pixels instead of 0.3-0.8 px lines that flickered in and out
    const spanL = Math.hypot(T2[0] - T1[0], T2[1] - T1[1]);
    const n = Math.floor(spanL / 48);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = t1.clone().lerp(t2, t);
      const cy = cableY(t1.y, t2.y, deckY + 6, t);
      k.beam(new THREE.Vector3(p.x, deckY + 0.5, p.z), new THREE.Vector3(p.x, cy, p.z), 1.2, 1.2, GL, 0.04);
    }
  }
  // anchorage blocks
  for (const A of [A0, A1]) k.block(A[0], deckY / 2 - 6, A[1], 40, deckY - 4, 46, f.yaw, C, -0.05);
  const g = new THREE.Group();
  g.add(k.build());
  return g;
}

/** The Bay Bridge's sizes, the mesh's and the collision's. */
const BAY = { half: 12, thick: 10, towerH: 160, anchorTop: 91, anchorY: 88, towers: [1, 2, 4, 5] };

/** One span of a suspension cable: between pts[a] and pts[b], from y0 to y1, sagY at mid span. n: its suspender bays. */
interface CableSpan {
  a: number;
  b: number;
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  sagY: number;
  n: number;
}

/**
 * The Bay Bridge's two runs of cable, end block to anchorage to end block. Each span's ends and sag read the deck under it. A
 * main span's low point rides 5 m over the deck's middle; a side span hangs in the same cable at the same tension, so its sag
 * goes with its span squared, shallow enough that it never dips to the deck.
 */
function bayCables(d: Deck, pts: P2[]): CableSpan[] {
  const s = pts.map((p) => d.stationOf(p));
  const saddle = BAY.towerH + 1;
  const end = (i: number) => (i === 3 ? BAY.anchorY : d.at(s[i])[2] + 3);
  const span = (a: number, b: number, y0: number, y1: number, sagY: number): CableSpan => ({ a, b, s0: s[a], s1: s[b], y0, y1, sagY, n: Math.floor((s[b] - s[a]) / 48) });
  const out: CableSpan[] = [];
  for (const [a, t1, t2, b] of [[0, 1, 2, 3], [3, 4, 5, 6]]) {
    const mainL = s[t2] - s[t1];
    const low = d.at((s[t1] + s[t2]) / 2)[2] + 5;
    const side = (i: number, j: number, y0: number, y1: number) => span(i, j, y0, y1, (y0 + y1) / 2 - (saddle - low) * ((s[j] - s[i]) / mainL) ** 2);
    out.push(side(a, t1, end(a), saddle), span(t1, t2, saddle, saddle, low), side(t2, b, saddle, end(b)));
  }
  return out;
}

/** What the deck stands on at W1, the cables' west end (w236373807) and W7: each the size of its OSM row, across and along the deck. */
function bayBlocks(d: Deck, pts: P2[]) {
  const w1: P2 = [d.pts[0][0], d.pts[0][1]];
  return [{ p: w1, across: 30, along: 50 }, { p: pts[0], across: 33, along: 11 }, { p: pts[6], across: 33, along: 39 }];
}

export function makeBayBridgeWest(pts: P2[], deck: DeckPoint[]): THREE.Object3D {
  // pts, as OSM refs them: the cables' west end, W2, W3, center anchorage W4, W5, W6, W7; deck: from W1 through them all to the island
  const k = new Kit();
  const d = new Deck(deck);
  const f = frame(pts[0], pts[pts.length - 1]);
  const { half, thick, towerH } = BAY;
  const legOff = half + 2;
  const G = Ramp.GREY;
  const GL = Ramp.GREY_LIGHT;
  const at = (p: P2, along: number, across: number, y: number) => new THREE.Vector3(p[0] + f.ux * along + f.ax * across, y, p[1] + f.uz * along + f.az * across);
  // double-deck truss, span by span along the deck's own line (each span runs on half a metre past a joint between two: a
  // slope change leaves no crack in the frames)
  for (let i = 0; i + 1 < deck.length; i++) {
    const a = new THREE.Vector3(deck[i][0], deck[i][2], deck[i][1]), b = new THREE.Vector3(deck[i + 1][0], deck[i + 1][2], deck[i + 1][1]);
    const on = b.clone().sub(a).setLength(0.5);
    if (i > 0) a.sub(on);
    if (i + 2 < deck.length) b.add(on);
    const down = (p: THREE.Vector3, y: number) => new THREE.Vector3(p.x, p.y - y, p.z);
    k.beam(down(a, (thick + 1) / 2), down(b, (thick + 1) / 2), half * 2, thick - 1, G, -0.08);
    k.beam(down(a, 0.5), down(b, 0.5), half * 2 - 1, 1, GL, -0.02);
  }
  for (const ti of BAY.towers) {
    const T = pts[ti];
    k.block(T[0], 5, T[1], 36, 16, 26, f.yaw, GL, -0.08);
    for (const side of [-1, 1]) {
      const a = at(T, 0, side * legOff, 0), b = at(T, 0, side * legOff * 0.82, towerH);
      k.beam(a, b, 6.5, 6.5, G, 0.02);
    }
    // X bracing between the legs at three levels, from over the deck here to the top
    const low = d.topAt(T) + 10, high = towerH - 4;
    const levels = [low, low + (high - low) * 0.4, low + (high - low) * 0.77, high];
    for (let i = 0; i < levels.length - 1; i++) {
      const y0 = levels[i], y1 = levels[i + 1];
      const w0 = legOff * (1 - 0.18 * (y0 / towerH)), w1 = legOff * (1 - 0.18 * (y1 / towerH));
      k.beam(at(T, 0, -w0, y0), at(T, 0, w1, y1), 2.6, 2.6, G, -0.02);
      k.beam(at(T, 0, w0, y0), at(T, 0, -w1, y1), 2.6, 2.6, G, -0.02);
      k.beam(at(T, 0, -w1, y1), at(T, 0, w1, y1), 3.2, 3.2, G, 0.0);
    }
  }
  // center anchorage: a massive concrete block rising above the deck, as long and wide as OSM's W4
  const C = pts[3];
  k.block(C[0], 42.5, C[1], 40, 85, 69, f.yaw, GL, -0.04);
  k.block(C[0], (85 + BAY.anchorTop) / 2, C[1], 30, BAY.anchorTop - 85, 55, f.yaw, GL, 0.02);
  for (const { p, across, along } of bayBlocks(d, pts)) {
    const top = d.topAt(p) - 0.3;
    k.block(p[0], top / 2, p[1], across, top, along, f.yaw, GL, -0.04);
  }
  // the two runs of cable, straight over the deck's edges, with suspenders by the Golden Gate's rule (every ~48 m, 1.2 m
  // thick) on every span: each bay is a segment of the cable, so a suspender always meets it
  const off = legOff * 0.84;
  for (const side of [-1, 1]) {
    for (const i of [0, 6]) {
      // the saddles the cables land on at the two ends
      const c = at(pts[i], 0, side * off, d.topAt(pts[i]) + 1.75);
      k.block(c.x, c.y, c.z, 4, 4.5, 6, f.yaw, GL, 0.02);
    }
    for (const c of bayCables(d, pts)) {
      const pa = at(pts[c.a], 0, side * off, c.y0), pb = at(pts[c.b], 0, side * off, c.y1);
      cable(k, pa, pb, c.sagY, c.n, 1.6, GL, 0.05);
      for (let i = 1; i < c.n; i++) {
        const t = i / c.n;
        const p = pa.clone().lerp(pb, t);
        const foot = d.at(c.s0 + (c.s1 - c.s0) * t)[2] - 0.5;
        k.beam(new THREE.Vector3(p.x, foot, p.z), new THREE.Vector3(p.x, cableY(c.y0, c.y1, c.sagY, t), p.z), 1.2, 1.2, GL, 0.04);
      }
    }
  }
  const g = new THREE.Group();
  g.add(k.build());
  return g;
}

/** Collision volumes for the flight model: vertical "posts" along the deck
 * (cable height + margin above, deck underside below, so the bus can still
 * glide UNDER a deck but never through cables or towers). */
export interface ObstaclePost {
  x: number;
  z: number;
  r: number;
  top: number;
  /** below this altitude the post doesn't apply (the open air under a deck); -Infinity = solid to the ground */
  under: number;
}

/**
 * A post every 12 m or less along a whole deck, each as wide as the deck plus 6 m. `over(s)`: the height of a cable running over
 * station s, else -Infinity. Its top stands over that cable, or just over the roadway; below `under`, the open air under the deck.
 */
function deckPosts(d: Deck, half: number, thick: number, over: (s: number) => number): ObstaclePost[] {
  const out: ObstaclePost[] = [];
  const n = Math.ceil(d.length / 12);
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * d.length;
    const [x, z, top] = d.at(s);
    out.push({ x, z, r: half + 6, top: Math.max(top + 1.5, over(s) + 5), under: top - thick - 1 });
  }
  return out;
}

export function bridgeObstacles(kind: 'ggb' | 'baybridge', pts: P2[], deck: DeckPoint[] = []): ObstaclePost[] {
  if (kind === 'baybridge') {
    const d = new Deck(deck);
    const cables = bayCables(d, pts);
    const out = deckPosts(d, BAY.half, BAY.thick, (s) => {
      const c = cables.find((q) => s >= q.s0 && s <= q.s1);
      return c ? cableY(c.y0, c.y1, c.sagY, (s - c.s0) / (c.s1 - c.s0)) : -Infinity;
    });
    for (const ti of BAY.towers) out.push({ x: pts[ti][0], z: pts[ti][1], r: 30, top: BAY.towerH + 8, under: -Infinity });
    out.push({ x: pts[3][0], z: pts[3][1], r: 40, top: BAY.anchorTop + 4, under: -Infinity });
    // (the open air under the deck stops at the blocks it stands on)
    for (const { p, across, along } of bayBlocks(d, pts)) out.push({ x: p[0], z: p[1], r: Math.hypot(across, along) / 2, top: d.topAt(p) + 1.5, under: -Infinity });
    return out;
  }
  const out: ObstaclePost[] = [];
  const deckY = 67;
  const towerH = 227;
  const towers = [1, 2];
  const segs: Array<[number, number, number, number]> = []; // [i, j, yA, yB] cable anchor heights
  segs.push([0, 1, deckY - 6, towerH + 2], [1, 2, towerH + 2, towerH + 2], [2, 3, towerH + 2, deckY - 6]);
  for (const [i, j, ya, yb] of segs) {
    const a = pts[i], b = pts[j];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(2, Math.ceil(L / 12));
    const main = ya > deckY + 20 && yb > deckY + 20;
    const sag = main ? deckY + 6 : deckY + 10;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const lin = ya + (yb - ya) * t;
      const depth = (ya + yb) / 2 - sag;
      const cy = lin - depth * 4 * t * (1 - t);
      out.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, r: 22, top: Math.max(cy, deckY + 1) + 5, under: deckY - 10 });
    }
  }
  for (const ti of towers) out.push({ x: pts[ti][0], z: pts[ti][1], r: 30, top: towerH + 8, under: -Infinity });
  return out;
}

// Shader warm-up (render/warmup.ts): a bridge as the kit builds one (the Bay Bridge is built after
// the first frame, see main.ts)
registerWarm('bridges', () => {
  const k = new Kit();
  k.block(0, 0, 0, 1, 1, 1, 0, Ramp.GREY);
  return k.build();
});
