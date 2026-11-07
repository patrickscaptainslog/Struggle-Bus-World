import * as THREE from 'three';
import { FACTION_ATLANTIS, FACTION_ELDERWOOD, FACTION_HYPERGLOW, FACTION_INFERNO } from '../game/factions';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { Ramp } from '../render/palette';
import { registerWarm } from '../render/warmup';
import { liftSeed, SQUARE, squareIx, squareIz, squareKey } from './liftGlsl';

// Stage 4's sky marks in the other four factions (docs/specs/factions/LIFT.md, "Stage 4 in the other factions"; FACTIONS.md section 2): the set
// piece over a lifted neighbourhood's heart, 220 m over its ground, one draw and one program, made only for the faction ?lift&lifted=<key> names.
// Atlantis's Sky Sea (a lens of ocean, the canals pouring up into it, a whale breaching out of it), the Elderwood's Sky Wood (islands of earth
// carrying old trees and rune stones, trailing glowing roots), Hyperglow's Skyway (the neighbourhood's real streets copied in lanes of light) and
// Inferno's Hellmouth (a black sun fed by four columns of lava, under a black-violet ceiling of smoke). Rainbow's halo isn't here yet.
//
// Everything comes from the neighbourhood's data: its heart square and its squares (hoods.bin), its streets (the tiles' OpenStreetMap
// centrelines) and its houses (where a fall or a column may stand: on a street, clear of them), so any city gets its own. Nothing here touches a
// floating house or holds one up (the producer's ruling: they float). The geometry is built once, when the neighbourhood's tiles are in; the
// motion is in the vertex shader, on the game clock, from uSkyT0 (the wave's start: it forms after it). No shadow, no paint, nothing the flight
// sees: the bus flies through the Sea and the Skyway.

/** What a set piece is placed from. */
export interface SkyPlace {
  /** the heart square's centre (m) and its ground (m) */
  heart: [number, number];
  ground: number;
  /** the neighbourhood's squares (liftGlsl's squareKey) */
  squares: Set<number>;
  /** its streets' centrelines in it (x, z pairs, m; rank 0 a street, 1 a path or a plaza) */
  streets: ReadonlyArray<{ rank: number; xz: Float32Array }>;
  /** the sun's way on the ground (a unit x, z): the start pose's side */
  face: [number, number];
  groundAt(x: number, z: number): number;
  /** how far (x, z) is from the nearest liftable house's footprint (m) */
  clear(x: number, z: number): number;
}

/** The set pieces' height over the heart's ground (m): FACTIONS.md section 1's sky marks, at 200-250 m. */
export const SKY_Y = 220;

const R = (r: number) => r.toFixed(1);

/** One mesh's buffers: a point, its normal, aK (kind and three numbers its shader reads) and aE (three more, varying). */
class Geo {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly k: number[] = [];
  readonly e: number[] = [];
  readonly idx: number[] = [];
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, k: readonly number[], e: readonly number[]): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.k.push(k[0], k[1] ?? 0, k[2] ?? 0, k[3] ?? 0);
    this.e.push(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }
  /**
   * A tube or a lathe along a path: `ring(t)` gives the centre, the radius and the way along at t 0..1, `rings` x `sides`, kind k; aE is
   * (t, the angle round 0..1, its radius). Closed at neither end.
   */
  tube(rings: number, sides: number, ring: (t: number) => { c: THREE.Vector3; r: number; up: THREE.Vector3 }, k: readonly number[]) {
    const o = this.pos.length / 3;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i <= rings; i++) {
      const t = i / rings, { c, r, up } = ring(t);
      // (a frame round the way along: any vector not along it)
      a.set(Math.abs(up.y) < 0.9 ? 0 : 1, Math.abs(up.y) < 0.9 ? 1 : 0, 0).cross(up).normalize();
      b.copy(up).cross(a).normalize();
      for (let s = 0; s <= sides; s++) {
        const q = (s / sides) * Math.PI * 2;
        n.copy(a).multiplyScalar(Math.cos(q)).addScaledVector(b, Math.sin(q));
        this.v(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r, n.x, n.y, n.z, k, [t, s / sides, r]);
      }
    }
    for (let i = 0; i < rings; i++)
      for (let s = 0; s < sides; s++) {
        const p = o + i * (sides + 1) + s, q = p + sides + 1;
        this.quad(p, q, q + 1, p + 1);
      }
  }
  /** A low blob: an icosahedron's 20 faces (detail 0) or 80 (1), squashed by sy, its faces' own normals. */
  blob(cx: number, cy: number, cz: number, r: number, sy: number, detail: number, k: readonly number[], e: readonly number[]) {
    const g = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
    const p = g.attributes.position;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), fn = new THREE.Vector3();
    for (let f = 0; f < p.count; f += 3) {
      va.fromBufferAttribute(p, f);
      vb.fromBufferAttribute(p, f + 1);
      vc.fromBufferAttribute(p, f + 2);
      for (const v of [va, vb, vc]) v.set(v.x * r, v.y * r * sy, v.z * r);
      fn.copy(vb).sub(va).cross(vc.clone().sub(va)).normalize();
      const i0 = this.v(cx + va.x, cy + va.y, cz + va.z, fn.x, fn.y, fn.z, k, e);
      const i1 = this.v(cx + vb.x, cy + vb.y, cz + vb.z, fn.x, fn.y, fn.z, k, e);
      const i2 = this.v(cx + vc.x, cy + vc.y, cz + vc.z, fn.x, fn.y, fn.z, k, e);
      this.tri(i0, i1, i2);
    }
    g.dispose();
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(this.k, 4));
    g.setAttribute('aE', new THREE.Float32BufferAttribute(this.e, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    return g;
  }
}

// ---------------------------------------------------------------- the place

/** The neighbourhood's size (m): the radius of a disc of its squares' area. */
const hoodRadius = (p: SkyPlace) => Math.sqrt((p.squares.size * SQUARE * SQUARE) / Math.PI);

/**
 * n points on its streets, about `r` m from the heart, spread round it (the first toward the sun's side, turned by `turn`), each at least `gap` m
 * clear of every liftable house: where a fall or a column of lava rises. Falls back to the nearest street point, then to a point on the circle.
 */
function streetPoints(p: SkyPlace, n: number, r: number, gap: number, turn: number): Array<[number, number]> {
  const cand: Array<[number, number, number, number]> = [];
  const [hx, hz] = p.heart;
  for (const { rank, xz } of p.streets)
    for (let k = 0; rank === 0 && k + 3 < xz.length; k += 2) {
      const ax = xz[k], az = xz[k + 1], bx = xz[k + 2], bz = xz[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= len; s += 6) {
        const x = ax + ((bx - ax) * s) / Math.max(len, 1e-6), z = az + ((bz - az) * s) / Math.max(len, 1e-6);
        cand.push([x, z, Math.hypot(x - hx, z - hz), Math.atan2(z - hz, x - hx)]);
      }
    }
  const a0 = Math.atan2(p.face[1], p.face[0]) + turn;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    let best: [number, number] | null = null, bs = Infinity;
    for (const [x, z, d, ca] of cand) {
      const da = Math.abs(((ca - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da > Math.PI / n) continue;
      const score = Math.abs(d - r) + da * r * 0.5 + (p.clear(x, z) < gap ? 1e4 : 0);
      if (score < bs) [bs, best] = [score, [x, z]];
    }
    out.push(best ?? [hx + Math.cos(a) * r, hz + Math.sin(a) * r]);
  }
  return out;
}

/** The Sky Wood's island i: its radius and its height (m) */
const isleR = (i: number) => (i === 0 ? 72 : 32 + 16 * liftSeed(i, 31));
const isleY = (i: number, Y: number) => (i === 0 ? Y : Y - 40 + 55 * liftSeed(i, 32));

/** The squares' centres farthest apart, from the heart: where the Sky Wood's islands float. */
function spreadSquares(p: SkyPlace, n: number): Array<[number, number]> {
  const all = [...p.squares].map((k) => [(squareIx(k) + 0.5) * SQUARE, (squareIz(k) + 0.5) * SQUARE] as [number, number]);
  const out: Array<[number, number]> = [p.heart];
  const lim = hoodRadius(p) * 0.85;
  while (out.length < n) {
    let best: [number, number] | null = null, bd = -1;
    for (const c of all) {
      if (Math.hypot(c[0] - p.heart[0], c[1] - p.heart[1]) > lim) continue;
      const d = Math.min(...out.map((o) => Math.hypot(o[0] - c[0], o[1] - c[1])));
      if (d > bd) [bd, best] = [d, c];
    }
    if (!best || bd < SQUARE * 0.9) break;
    out.push(best);
  }
  return out;
}

// ---------------------------------------------------------------- the shaders' common part

const VS_HEAD = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uSkyC; // the heart x, the pieces' height, the heart z, the neighbourhood's radius
uniform float uSkyT0; // the wave's start (game clock): it forms after it
in vec4 aK;
in vec3 aE;
out vec3 vWorldPos;
out vec3 vN;
out vec3 vE;
flat out vec4 vK;
float sbForm(float a, float b) { return smoothstep(uSkyT0 + a, uSkyT0 + b, uTime); }
float sbH(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
vec3 sbYawY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.z, v.y, s * v.x + c * v.z); }
`;
const VS_TAIL = /* glsl */ `
  vWorldPos = p;
  vN = n;
  vE = aE;
  vK = aK;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
`;
const FS_HEAD = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uSkyC;
uniform float uSkyT0;
in vec3 vWorldPos;
in vec3 vN;
in vec3 vE;
flat in vec4 vK;
${GLSL_OUT}
float sbH2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sbLit(vec3 n) { return clamp(uLight.y + uLight.z * (0.5 + 0.5 * n.y) + uLight.x * max(dot(n, uSunDir), 0.0), 0.0, 1.0); }
`;
/** a hidden vertex: behind the far plane */
const HIDE = 'gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return;';

// ---------------------------------------------------------------- Atlantis: the Sky Sea

function atlantisGeo(p: SkyPlace, g: Geo): Built {
  const [hx, hz] = p.heart, Y = p.ground + SKY_Y;
  const Rl = Math.min(190, Math.max(90, hoodRadius(p) * 0.62));
  const TB = 34, TT = 14;
  // the lens: from its belly's middle to the rim, then over its top (aE.x: -1 the belly's middle .. 0 the rim .. 1 the top's middle)
  const sides = 48, rings = 14;
  const o = g.pos.length / 3;
  for (let i = 0; i <= rings * 2; i++) {
    const u = i / rings - 1;
    const r = Rl * Math.sin((Math.PI / 2) * (1 - Math.abs(u)));
    const y = u < 0 ? -TB * Math.cos((Math.PI / 2) * (1 + u)) : TT * Math.cos((Math.PI / 2) * (1 - u));
    // (the normal of the ellipse there)
    const ny = u < 0 ? -1 : 1, rr = r / Rl;
    for (let s = 0; s <= sides; s++) {
      const q = (s / sides) * Math.PI * 2, c = Math.cos(q), sn = Math.sin(q);
      const nn = new THREE.Vector3(c * rr * (u < 0 ? TB : TT), ny * Rl * Math.sqrt(Math.max(0, 1 - rr * rr)) * 0.35, sn * rr * (u < 0 ? TB : TT)).normalize();
      g.v(hx + c * r, Y + y, hz + sn * r, nn.x, nn.y, nn.z, [0], [u, s / sides, rr]);
    }
  }
  for (let i = 0; i < rings * 2; i++)
    for (let s = 0; s < sides; s++) {
      const a = o + i * (sides + 1) + s, b = a + sides + 1;
      g.quad(a, a + 1, b + 1, b);
    }
  const belly = (r: number) => Y - TB * Math.sqrt(Math.max(0, 1 - (r / Rl) ** 2));
  // the falls: the canals pour up from the streets into it, curving in as they rise, twisting (aK.y their seed)
  const pts = streetPoints(p, 5, Rl * 0.75, 10, 0.35);
  pts.forEach(([x, z], i) => {
    const gy = p.groundAt(x, z);
    const dx = x - hx, dz = z - hz, d = Math.hypot(dx, dz) || 1;
    const top = new THREE.Vector3(hx + (dx / d) * Math.min(d, Rl) * 0.62, 0, hz + (dz / d) * Math.min(d, Rl) * 0.62);
    top.y = belly(Math.min(d, Rl) * 0.62) + 6;
    const foot = new THREE.Vector3(x, gy - 1, z);
    const c = new THREE.Vector3(), up = new THREE.Vector3(), c2 = new THREE.Vector3();
    const at = (t: number, v: THREE.Vector3) => {
      // (rising straight off the street first, then bending in to the Sea)
      const e = t * t * (3 - 2 * t);
      v.set(foot.x + (top.x - foot.x) * e, foot.y + (top.y - foot.y) * t, foot.z + (top.z - foot.z) * e);
      return v;
    };
    g.tube(26, 10, (t) => {
      at(t, c);
      at(Math.min(1, t + 0.02), c2);
      up.copy(c2).sub(at(Math.max(0, t - 0.02), new THREE.Vector3())).normalize();
      const r = 5.5 - 2.8 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + (8 * Math.max(0, t - 0.85)) / 0.15 + (t < 0.05 ? (0.05 - t) * 110 : 0);
      return { c: c.clone(), r, up: up.clone() };
    }, [1, liftSeed(i, 21), foot.y, top.y]);
  });
  // two whales: one breaches out of the top, one plunges out of the belly and back, by turns (aK.y which, aK.zw its arc's way on the ground)
  for (let w = 0; w < 2; w++) {
    const a = Math.atan2(p.face[1], p.face[0]) + (w ? 2.2 : 0.5);
    const L = 60;
    const body = (t: number) => {
      // a spindle: a blunt head, the widest a third back, the tail's stock thin
      const r = 7.6 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t * 0.92 + 0.04))), 0.7) * (t > 0.6 ? 1 - 0.75 * ((t - 0.6) / 0.4) : 1);
      return { c: new THREE.Vector3(0, 0, (0.5 - t) * L), r: Math.max(r, 0.6), up: new THREE.Vector3(0, 0, -1) };
    };
    const k = [2, w, Math.cos(a), Math.sin(a)];
    g.tube(14, 10, body, k);
    // the flukes and the pectoral fins (aE.x 1: a fin)
    const fin = (pts3: number[][]) => {
      const ids = pts3.map((q) => g.v(q[0], q[1], q[2], 0, 1, 0, k, [1, 0, 0]));
      g.tri(ids[0], ids[1], ids[2]);
      g.tri(ids[0], ids[2], ids[1]);
    };
    fin([[0, 0, -L * 0.46], [-13, 0.5, -L * 0.6], [-2, 0, -L * 0.5]]);
    fin([[0, 0, -L * 0.46], [13, 0.5, -L * 0.6], [2, 0, -L * 0.5]]);
    fin([[-6, -1.4, L * 0.18], [-18, -4, L * 0.02], [-5.5, -2, L * 0.08]]);
    fin([[6, -1.4, L * 0.18], [18, -4, L * 0.02], [5.5, -2, L * 0.08]]);
    // the foam where it leaves the water and where it comes back: rings of chips
    for (let s = 0; s < 2; s++)
      for (let j = 0; j < 22; j++) {
        const q = (j / 22) * Math.PI * 2, kk = [3, w, s, liftSeed(j + 40 * w + 20 * s, 22)];
        const i0 = g.v(Math.cos(q), 0, Math.sin(q), 0, 1, 0, kk, [q, 0, 0]);
        const i1 = g.v(Math.cos(q + 0.1), 0, Math.sin(q + 0.1), 0, 1, 0, kk, [q, 1, 0]);
        const i2 = g.v(Math.cos(q + 0.05), 1, Math.sin(q + 0.05), 0, 1, 0, kk, [q, 2, 0]);
        g.tri(i0, i1, i2);
        g.tri(i0, i2, i1);
      }
  }
  return { R: Rl, Y, feet: pts };
}

const ATLANTIS_VS = /* glsl */ `
${VS_HEAD}
void main() {
  float kind = aK.x;
  vec3 p = position, n = normal;
  float R = uSkyC.w;
  vec2 hc = uSkyC.xz;
  if (kind < 0.5) {
    // the lens grows out from its middle after the falls reach it, and sways (Atlantis sways); its top runs with a swell
    float g = sbForm(1.4, 4.0);
    if (g <= 0.0) { ${HIDE} }
    vec2 d = p.xz - hc;
    p.xz = hc + d * g;
    p.y = uSkyC.y + (p.y - uSkyC.y) * g;
    float sw = sin(dot(p.xz, vec2(0.031, 0.018)) - uTime * 0.7) + 0.6 * sin(dot(p.xz, vec2(-0.022, 0.035)) - uTime * 0.9);
    p.y += aE.x > 0.0 ? 2.2 * sw * aE.z : 0.0;
    p.y += aE.x < 0.0 ? 1.4 * sin(dot(p.xz, vec2(0.05, 0.03)) + uTime * 0.8) * (1.0 - aE.z * 0.6) : 0.0;
    p.y += 2.0 * sin(uTime * 0.45);
    p.xz += 1.5 * vec2(sin(uTime * 0.3), cos(uTime * 0.37));
  } else if (kind < 1.5) {
    // a fall: the water climbs up it from the street (aE.x 0..1 along it), and once it's in the Sea it thins to a steady pour
    float rise = sbForm(0.0, 1.8);
    if (aE.x > rise + 0.02) { ${HIDE} }
    float w = sin(aE.y * 6.2832 * 3.0 + uTime * 6.0 + aK.y * 20.0) * 0.6 + sin(aE.x * 30.0 - uTime * 9.0) * 0.5;
    p += n * w;
    p.xz += vec2(sin(aE.x * 7.0 + uTime * 1.3 + aK.y * 9.0), cos(aE.x * 6.0 + uTime * 1.1)) * 3.0 * sin(3.1416 * aE.x);
  } else {
    // a whale (2) or its foam (3): its arc, 13 s round, the two out of step; out of the top (aK.y 0) or the belly (1)
    float wh = aK.y;
    float P = 13.0;
    float u = fract((uTime - uSkyT0 - 5.6) / P + (wh > 0.5 ? 0.0 : 0.3));
    if (uTime < uSkyT0 + 5.6) { ${HIDE} }
    vec2 dir = aK.zw;
    vec2 side = vec2(-dir.y, dir.x);
    float sgn = wh > 0.5 ? -1.0 : 1.0;
    float r0 = R * (wh > 0.5 ? 0.62 : 0.72);
    // (out of the water over 0.28 of the round: along its side, up 48 m and back)
    float a = clamp((u - 0.1) / 0.28, 0.0, 1.0);
    float rim = sgn > 0.0 ? 9.0 : -21.0;
    vec3 base = vec3(hc.x + dir.x * r0, uSkyC.y + rim, hc.y + dir.y * r0);
    vec3 at = base + vec3(side.x, 0.0, side.y) * (a - 0.5) * 90.0 + vec3(0.0, sgn * 58.0 * sin(3.1416 * a), 0.0);
    if (kind < 2.5) {
      if (u < 0.08 || u > 0.4) { ${HIDE} }
      // (nose along its way, rolled a little as it twists, the flukes beating)
      vec3 fw = normalize(vec3(side.x, 0.0, side.y) * 90.0 + vec3(0.0, sgn * 58.0 * 3.1416 * cos(3.1416 * a), 0.0));
      vec3 lp = p;
      lp.y += lp.z < 0.0 ? sin(uTime * 4.0) * 2.0 * (-lp.z / 22.0) : 0.0;
      if (sgn < 0.0) lp.y = -lp.y;
      vec3 up0 = vec3(0.0, sgn, 0.0);
      vec3 rt = normalize(cross(fw, up0));
      vec3 up = cross(rt, fw);
      float roll = 0.6 * (a - 0.5);
      vec3 rt2 = rt * cos(roll) + up * sin(roll);
      vec3 up2 = cross(rt2, fw);
      p = at + rt2 * lp.x + up2 * lp.y - fw * lp.z;
      n = normalize(rt2 * n.x + up2 * (sgn * n.y) - fw * n.z);
    } else {
      // foam: a ring of chips thrown out where it leaves the water (aK.z 0) and where it comes back (1), for a second each
      float t0 = aK.z < 0.5 ? 0.1 : 0.38;
      float s = (u - t0) * P;
      if (s < 0.0 || s > 1.6) { ${HIDE} }
      vec3 c0 = base + vec3(side.x, 0.0, side.y) * (aK.z < 0.5 ? -45.0 : 45.0);
      float rr = 4.0 + s * 16.0 * (0.6 + 0.4 * aK.w);
      float hh = sgn * (s * 22.0 - s * s * 11.0) * (0.5 + aK.w);
      p = c0 + vec3(position.x * rr, hh + position.y * 3.5 * sgn, position.z * rr);
    }
  }
  ${VS_TAIL}
}
`;

const ATLANTIS_FS = /* glsl */ `
${FS_HEAD}
void main() {
  float kind = vK.x;
  vec3 n = normalize(vN);
  float fog = sbFog(vWorldPos);
  float ramp = ${R(Ramp.TEAL)}, light = 0.4, glow = 0.12;
  if (kind < 0.5) {
    if (vE.x < 0.0) {
      // the belly: the sea seen from under it, deep, a net of light wandering over it, schools of fish turning in it, foam at the rim
      vec2 q = vWorldPos.xz * 0.09;
      float c1 = sin(q.x + 1.7 * sin(q.y * 0.71 + uTime * 0.6) + uTime * 0.7);
      float c2 = sin(q.y * 1.13 + 1.6 * sin(q.x * 0.83 - uTime * 0.5) - uTime * 0.65);
      float e = abs(c1 + c2);
      light = 0.3 + 0.18 * vE.z;
      glow = 0.18;
      if (e < 0.12) { light = 0.66; glow = 0.4; }
      else if (e < 0.4) light += 0.1;
      vec2 f = vWorldPos.xz - uSkyC.xz;
      float a = atan(f.y, f.x), r = length(f);
      vec2 fq = vec2(a * 18.0 - uTime * 0.35, r * 0.14 + 0.8 * sin(a * 3.0 + uTime * 0.2));
      float fish = sbH2(floor(fq * vec2(1.0, 2.0)));
      if (fish > 0.93 && fract(fq.y * 2.0) < 0.45 && r < uSkyC.w * 0.8) { ramp = ${R(Ramp.TEAL)}; light = 0.08; glow = 0.0; }
      if (vE.z > 0.93) { ramp = ${R(Ramp.PEARL)}; light = 0.74; glow = 0.3; }
      else if (vE.z > 0.86 && sbH2(floor(vWorldPos.xz / 3.0)) > 0.5) { ramp = ${R(Ramp.WHITE)}; light = 0.7; glow = 0.2; }
    } else {
      // the top: open sea in the sun, foam on its crests and at its rim
      light = sbLit(n) * 0.75 + 0.12;
      glow = 0.1;
      float cr = sin(dot(vWorldPos.xz, vec2(0.031, 0.018)) - uTime * 0.7);
      if (cr > 0.85 && sbH2(floor(vWorldPos.xz / 2.5)) > 0.4) { ramp = ${R(Ramp.WHITE)}; light = 0.82; }
      if (vE.z > 0.92) { ramp = ${R(Ramp.PEARL)}; light = 0.8; }
    }
  } else if (kind < 1.5) {
    // a fall: water running up it in streaks, lit from inside, flecks of foam racing up, a churn of foam at its foot
    float col = floor(vE.y * 18.0);
    float streak = fract(vE.x * (5.0 + 3.0 * sbH2(vec2(col, vK.y))) - uTime * (0.9 + 0.5 * sbH2(vec2(col, 3.0))) + sbH2(vec2(col, 7.0)));
    light = 0.5 + 0.2 * sbLit(n);
    glow = 0.3;
    if (streak < 0.12) { light = 0.7; glow = 0.4; }
    if (streak < 0.035) { ramp = ${R(Ramp.WHITE)}; light = 0.9; glow = 0.4; }
    if (vE.x < 0.06 && sbH2(floor(vWorldPos.xz * 0.7) + floor(uTime * 6.0)) > 0.3) { ramp = ${R(Ramp.WHITE)}; light = 0.88; }
  } else if (kind < 2.5) {
    // the whale: a deep back, a pearl belly and fins, barnacle flecks
    float under = vE.x > 0.5 ? 1.0 : smoothstep(0.1, -0.4, sin(vE.y * 6.2832 + 1.57));
    ramp = under > 0.5 ? ${R(Ramp.PEARL)} : ${R(Ramp.TEAL)};
    light = under > 0.5 ? 0.35 + 0.4 * sbLit(n) : 0.06 + 0.22 * sbLit(n);
    if (under < 0.5 && sbH2(floor(vE.xy * vec2(40.0, 18.0))) > 0.94) { ramp = ${R(Ramp.PEARL)}; light = 0.5; }
    glow = 0.02;
  } else {
    ramp = ${R(Ramp.WHITE)};
    light = 0.92;
    glow = 0.3;
  }
  sbWrite(ramp, light, fog, glow, mat3(viewMatrix) * n, fract(vK.x * 0.13 + vK.y * 0.31 + 0.71), kind > 2.5 ? 0.5 : 1.0);
}
`;

// ---------------------------------------------------------------- the Elderwood: the Sky Wood

function elderwoodGeo(p: SkyPlace, g: Geo): Built {
  const cs = spreadSquares(p, 7);
  const Y = p.ground + SKY_Y;
  cs.forEach(([x, z], i) => {
    const heart = i === 0;
    const r = isleR(i);
    const y = isleY(i, Y);
    const k = (part: number, a = 0) => [part, i, a, liftSeed(i, 33)];
    // the turf: a domed top with a jagged rim (aE.z its distance out, 0..1)
    const sides = heart ? 22 : 14;
    const rim: number[] = [];
    for (let s = 0; s < sides; s++) rim.push(r * (0.82 + 0.3 * liftSeed(i * 50 + s, 34)));
    const top = g.v(x, y + r * 0.12, z, 0, 1, 0, k(1), [0, 0, 0]);
    const ring1: number[] = [], ring2: number[] = [];
    for (let s = 0; s <= sides; s++) {
      const q = (s / sides) * Math.PI * 2, rr = rim[s % sides];
      ring1.push(g.v(x + Math.cos(q) * rr * 0.55, y + r * 0.08, z + Math.sin(q) * rr * 0.55, 0, 1, 0, k(1), [0.55, s / sides, 0.55]));
      ring2.push(g.v(x + Math.cos(q) * rr, y, z + Math.sin(q) * rr, Math.cos(q) * 0.3, 0.9, Math.sin(q) * 0.3, k(1), [1, s / sides, 1]));
    }
    for (let s = 0; s < sides; s++) {
      g.tri(top, ring1[s + 1], ring1[s]);
      g.quad(ring1[s], ring1[s + 1], ring2[s + 1], ring2[s]);
    }
    // the rock under it: an inverted crag, rings narrowing to a point 1.3 radii down, knobbly (aE.x its depth 0..1)
    const depth = r * 0.95;
    let prev = rim.map((rr, s) => [Math.cos((s / sides) * Math.PI * 2) * rr, 0, Math.sin((s / sides) * Math.PI * 2) * rr]);
    const prevIds = (pts: number[][], t: number) =>
      pts.concat([pts[0]]).map((q, s) => {
        const l = Math.hypot(q[0], q[2]) || 1;
        return g.v(x + q[0], y + q[1], z + q[2], q[0] / l, -0.5, q[2] / l, k(0), [t, s / sides, 0]);
      });
    let ids = prevIds(prev, 0);
    for (let ring = 1; ring <= 4; ring++) {
      const t = ring / 4;
      const pts = prev.map((q, s) => {
        const sh = (1 - t) ** 1.4 * (0.75 + 0.5 * liftSeed(i * 97 + s * 7 + ring, 35));
        const a = (s / sides) * Math.PI * 2 + 0.2 * ring;
        return [Math.cos(a) * r * sh, -depth * t * (0.85 + 0.3 * liftSeed(s + ring * 13 + i, 36)), Math.sin(a) * r * sh];
      });
      const nid = prevIds(pts, t);
      for (let s = 0; s < sides; s++) g.quad(ids[s], nid[s], nid[s + 1], ids[s + 1]);
      ids = nid;
      prev = pts;
    }
    // the roots: glowing, hanging from its belly 30-60 m, swaying (aE.x along 0..1)
    const nRoots = heart ? 12 : 6;
    for (let j = 0; j < nRoots; j++) {
      const a = (j / nRoots) * Math.PI * 2 + liftSeed(j + i * 20, 37);
      const r0 = r * (0.25 + 0.45 * liftSeed(j + i * 20, 38));
      const y0 = y - depth * (1 - r0 / r) * 0.9;
      const len = (heart ? 30 : 22) + 14 * liftSeed(j + i * 20, 39);
      const hook = 4 + 6 * liftSeed(j, 40);
      g.tube(9, 4, (t) => ({
        c: new THREE.Vector3(x + Math.cos(a) * (r0 + hook * Math.sin(t * 2.2)), y0 - len * t, z + Math.sin(a) * (r0 + hook * Math.sin(t * 2.2))),
        r: 2.2 * (1 - t * 0.8),
        up: new THREE.Vector3(0, -1, 0),
      }), [6, i, j, liftSeed(j + i * 20, 41)]);
    }
    // the old trees: a silver trunk that leans and twists, a crown of moss blobs, lantern fruit hanging
    const nTrees = heart ? 3 : 1 + Math.floor(liftSeed(i, 42) * 2);
    for (let j = 0; j < nTrees; j++) {
      const a = j * 2.3 + liftSeed(i, 43) * 6;
      const tx = x + (j ? Math.cos(a) * r * 0.45 : 0), tz = z + (j ? Math.sin(a) * r * 0.45 : 0);
      const th = heart && !j ? 84 : 34 + 22 * liftSeed(i * 3 + j, 44);
      const lean = 0.12 * (liftSeed(i * 3 + j, 45) - 0.5);
      const base = y + r * 0.1;
      g.tube(6, 7, (t) => ({
        c: new THREE.Vector3(tx + lean * th * t * t, base + th * t, tz + lean * th * t * t * 0.6),
        r: (th / 14) * (1.25 - 0.75 * t) + (t < 0.12 ? (0.12 - t) * th * 0.45 : 0),
        up: new THREE.Vector3(lean * 2 * t, 1, lean * 1.2 * t).normalize(),
      }), [2, i, j, 0]);
      const cx = tx + lean * th, cz = tz + lean * th * 0.6, cy = base + th;
      const crown = th * 0.5;
      for (let b = 0; b < 5; b++) {
        const q = b * 1.7 + j;
        const off = b ? crown * 0.62 : 0;
        g.blob(cx + Math.cos(q) * off, cy + (b ? -crown * 0.25 : crown * 0.15), cz + Math.sin(q) * off, crown * (b ? 0.62 : 0.85), 0.72, 1, [3, i, b, liftSeed(i * 9 + j * 5 + b, 46)], [0, 0, 0]);
      }
      for (let f = 0; f < (heart && !j ? 26 : 9); f++) {
        const q = f * 2.399 + j;
        const rr = crown * (0.7 + 0.5 * liftSeed(f, 47));
        g.blob(cx + Math.cos(q) * rr, cy - crown * 0.55 - 2 * liftSeed(f, 48), cz + Math.sin(q) * rr, 1.3, 1.4, 0, [4, i, f, liftSeed(f + i * 30, 49)], [0, 0, 0]);
      }
    }
    // a ring of rune stones on its turf's edge, leaning, runes glowing on their faces
    const nStones = heart ? 9 : 5;
    for (let j = 0; j < nStones; j++) {
      const a = (j / nStones) * Math.PI * 2 + 0.3;
      const sx = x + Math.cos(a) * r * 0.72, sz = z + Math.sin(a) * r * 0.72, sy = y + r * 0.03;
      const w = 3.2, hgt = heart ? 15 : 10, d = 1.8;
      const ca = Math.cos(a), sa = Math.sin(a), lean = 0.12 * (liftSeed(j + i * 11, 50) - 0.5);
      const pt = (u: number, v: number, h: number) => [sx + ca * d * u - sa * w * v + ca * lean * h, sy + h, sz + sa * d * u + ca * w * v + sa * lean * h];
      const face = (q: number[][], nx: number, nz: number, rune: number) => {
        const ii = q.map((c, m) => g.v(c[0], c[1], c[2], nx, 0, nz, [5, i, j, rune], [m === 1 || m === 2 ? 1 : 0, m >= 2 ? 1 : 0, 0]));
        g.quad(ii[0], ii[1], ii[2], ii[3]);
      };
      // (its two broad faces carry the runes; the narrow ones and the top are plain)
      face([pt(1, -1, 0), pt(1, 1, 0), pt(1, 1, hgt), pt(1, -1, hgt * 0.92)], ca, sa, 1);
      face([pt(-1, 1, 0), pt(-1, -1, 0), pt(-1, -1, hgt * 0.92), pt(-1, 1, hgt)], -ca, -sa, 1);
      face([pt(-1, -1, 0), pt(1, -1, 0), pt(1, -1, hgt * 0.92), pt(-1, -1, hgt * 0.92)], sa, -ca, 0);
      face([pt(1, 1, 0), pt(-1, 1, 0), pt(-1, 1, hgt), pt(1, 1, hgt)], -sa, ca, 0);
    }
  });
  return { R: hoodRadius(p), Y, feet: [] };
}

const ELDERWOOD_VS = /* glsl */ `
${VS_HEAD}
uniform vec4 uIsles[7]; // each island's centre x, y, z, and 1 when it's there
void main() {
  float kind = aK.x, isle = aK.y;
  vec3 p = position, n = normal;
  vec4 c = uIsles[int(isle + 0.5)];
  // each island rises out of the haze over the houses, one after another, and then breathes: a slow rise and fall, a slow turn
  float rise = sbForm(0.4 + isle * 0.35, 3.6 + isle * 0.35);
  if (rise <= 0.0) { ${HIDE} }
  float e = 1.0 - pow(1.0 - rise, 3.0);
  float br = sin(uTime * 0.52 + isle * 1.9) * 3.0;
  vec3 d = p - c.xyz;
  float yaw = 0.05 * sin(uTime * 0.21 + isle);
  d = sbYawY(d, yaw);
  n = sbYawY(n, yaw);
  if (kind > 5.5) {
    // a root: it swings and curls more the farther down it is
    float t = aE.x;
    d.x += sin(uTime * 0.9 + aK.z * 2.0 + isle) * 4.0 * t * t;
    d.z += cos(uTime * 0.7 + aK.z * 1.3) * 4.0 * t * t;
  } else if (kind > 2.5 && kind < 3.5) {
    // a crown breathes (the Elderwood breathes)
    d *= 1.0 + 0.025 * sin(uTime * 1.1 + aK.z);
  } else if (kind > 3.5 && kind < 4.5) {
    d.x += sin(uTime * 1.7 + aK.w * 20.0) * 0.5;
  }
  p = c.xyz + d + vec3(0.0, br - (1.0 - e) * 140.0, 0.0);
  ${VS_TAIL}
}
`;

const ELDERWOOD_FS = /* glsl */ `
${FS_HEAD}
void main() {
  float kind = vK.x;
  vec3 n = normalize(vN);
  float fog = sbFog(vWorldPos);
  float lit = sbLit(n);
  float ramp = ${R(Ramp.PEARL)}, light = 0.3 + 0.4 * lit, glow = 0.0;
  if (kind < 0.5) {
    // the rock: silver-lilac stone in strata, moss hanging off its top edge, lime veins of root glowing in it deeper down
    float st = floor(vWorldPos.y / 2.6 + sbH2(floor(vWorldPos.xz / 9.0)) * 2.0);
    light = 0.16 + 0.34 * lit + 0.06 * (sbH2(vec2(st, vK.y)) - 0.5);
    if (vE.x < 0.14 && sbH2(floor(vWorldPos.xz / 1.6) + floor(vWorldPos.y)) > vE.x * 6.0) { ramp = ${R(Ramp.MOSS)}; light = 0.32 + 0.3 * lit; }
    float vein = abs(sin(vE.y * 6.2832 * 5.0 + vE.x * 9.0 + sin(vE.x * 23.0) * 1.2));
    if (vein < 0.07 && vE.x > 0.3) { ramp = ${R(Ramp.MOSS)}; light = 0.88; glow = 0.5; }
  } else if (kind < 1.5) {
    // the turf: deep moss, lighter tufts, violet caps, lime sparks
    ramp = ${R(Ramp.MOSS)};
    float h = sbH2(floor(vWorldPos.xz / 1.4));
    light = 0.28 + 0.4 * lit + (h - 0.5) * 0.1;
    if (h > 0.96) { ramp = ${R(Ramp.VIOLET)}; light = 0.62; glow = 0.2; }
    else if (h > 0.93) { light = 0.86; glow = 0.3; }
  } else if (kind < 2.5) {
    // the trunk: silver bark in furrows, a lime glow in its cracks
    float f = fract(vE.y * 9.0 + vE.x * 2.0 + sin(vE.x * 14.0) * 0.2);
    light = 0.34 + 0.4 * lit - (f < 0.2 ? 0.14 : 0.0);
    if (f < 0.05 && vE.x < 0.6) { ramp = ${R(Ramp.MOSS)}; light = 0.82; glow = 0.4; }
  } else if (kind < 3.5) {
    ramp = ${R(Ramp.MOSS)};
    light = 0.2 + 0.5 * lit + 0.08 * (vK.w - 0.5);
    if (sbH2(floor(vWorldPos.xz / 1.8) + floor(vWorldPos.y / 1.8)) > 0.9) { ramp = ${R(Ramp.VIOLET)}; light = 0.5 + 0.2 * lit; }
  } else if (kind < 4.5) {
    // lantern fruit, glowing gold, pulsing out of step
    ramp = ${R(Ramp.YELLOW)};
    light = 0.78 + 0.14 * sin(uTime * 2.0 + vK.w * 30.0);
    glow = 0.7;
  } else if (kind < 5.5) {
    // a rune stone: silver stone, its broad faces cut with runes that glow lime, breathing
    light = 0.24 + 0.42 * lit;
    if (vK.w > 0.5) {
      vec2 g = floor(vE.xy * vec2(4.0, 7.0));
      float r = sbH2(g + vK.yz * 3.1);
      vec2 f = fract(vE.xy * vec2(4.0, 7.0));
      bool cut = r > 0.45 && (abs(f.x - 0.5) < 0.14 || (r > 0.75 && abs(f.y - 0.5) < 0.12)) && vE.y > 0.08 && vE.y < 0.9 && vE.x > 0.1 && vE.x < 0.9;
      if (cut) { ramp = ${R(Ramp.MOSS)}; light = 0.8 + 0.12 * sin(uTime * 1.3 + vK.z); glow = 0.55; }
    }
  } else {
    // a root: lime glow running down it in beads
    ramp = ${R(Ramp.MOSS)};
    float b = fract(vE.x * 5.0 - uTime * 0.6 + vK.w * 3.0);
    light = 0.6 + 0.24 * (1.0 - vE.x) + (b < 0.25 ? 0.16 : 0.0);
    glow = 0.45 + (b < 0.25 ? 0.25 : 0.0);
  }
  sbWrite(ramp, light, fog, glow, mat3(viewMatrix) * n, fract(vK.y * 0.37 + vK.x * 0.11 + vK.z * 0.07 + 0.2), kind > 3.5 && kind < 4.5 ? 0.5 : 1.0);
}
`;

// ---------------------------------------------------------------- Hyperglow: the Skyway

function hyperglowGeo(p: SkyPlace, g: Geo): Built {
  const [hx, hz] = p.heart, Y = p.ground + SKY_Y;
  const inHood = (x: number, z: number) => p.squares.has(squareKey(Math.floor(x / SQUARE), Math.floor(z / SQUARE)));
  const ends = new Map<string, [number, number, number]>();
  const node = (x: number, z: number) => {
    const key = `${Math.round(x / 6)},${Math.round(z / 6)}`;
    const e = ends.get(key);
    if (e) e[2]++;
    else ends.set(key, [x, z, 1]);
  };
  // a lane a street's segment: a flat ribbon, aE (across -1..1, its length along the street m, its distance from the heart m)
  for (const { rank, xz } of p.streets) {
    // (a street's lanes 16 m across, a path's 5)
    const W = rank ? 2.5 : 8;
    let s = 0;
    for (let k = 0; k + 3 < xz.length; k += 2) {
      const ax = xz[k], az = xz[k + 1], bx = xz[k + 2], bz = xz[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5 || !inHood((ax + bx) / 2, (az + bz) / 2)) {
        s += len;
        continue;
      }
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      // (a hair over its overlap with the next, so the joints close)
      const ex = ((bx - ax) / len) * 1.5, ez = ((bz - az) / len) * 1.5;
      const da = Math.hypot(ax - hx, az - hz), db = Math.hypot(bx - hx, bz - hz);
      const kk = [0, rank, 0, 0];
      const i0 = g.v(ax - ex + nx * W, Y, az - ez + nz * W, 0, 1, 0, kk, [1, s, da]);
      const i1 = g.v(ax - ex - nx * W, Y, az - ez - nz * W, 0, 1, 0, kk, [-1, s, da]);
      const i2 = g.v(bx + ex - nx * W, Y, bz + ez - nz * W, 0, 1, 0, kk, [-1, s + len, db]);
      const i3 = g.v(bx + ex + nx * W, Y, bz + ez + nz * W, 0, 1, 0, kk, [1, s + len, db]);
      g.quad(i0, i1, i2, i3);
      s += len;
      if (!rank && k === 0) node(ax, az);
      if (!rank && k + 4 >= xz.length) node(bx, bz);
    }
  }
  // the junctions: a diamond of light where streets meet (their ends, met by more than one)
  for (const [x, z, c] of ends.values()) {
    if (c < 2) continue;
    const d = Math.hypot(x - hx, z - hz), r = 14;
    const ids = [0, 1, 2, 3].map((q) => g.v(x + Math.cos((q * Math.PI) / 2) * r, Y + 0.3, z + Math.sin((q * Math.PI) / 2) * r, 0, 1, 0, [1, 0, 0, 0], [q === 0 || q === 2 ? 1 : -1, 0, d]));
    g.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  // the neighbourhood's edge, a fence of light along every square side it shares with the outside (aE.x across, aE.y along)
  for (const key of p.squares) {
    const ix = squareIx(key), iz = squareIz(key);
    for (const [ox, oz, x0, z0, x1, z1] of [
      [1, 0, 1, 0, 1, 1], [-1, 0, 0, 0, 0, 1], [0, 1, 0, 1, 1, 1], [0, -1, 0, 0, 1, 0],
    ] as const) {
      if (p.squares.has(squareKey(ix + ox, iz + oz))) continue;
      const ax = (ix + x0) * SQUARE, az = (iz + z0) * SQUARE, bx = (ix + x1) * SQUARE, bz = (iz + z1) * SQUARE;
      const d = Math.hypot((ax + bx) / 2 - hx, (az + bz) / 2 - hz);
      const ids = [
        g.v(ax, Y - 0.2, az, ox, 0, oz, [2, 0, 0, 0], [0, 0, d]),
        g.v(bx, Y - 0.2, bz, ox, 0, oz, [2, 0, 0, 0], [0, SQUARE, d]),
        g.v(bx, Y + 16, bz, ox, 0, oz, [2, 0, 0, 0], [1, SQUARE, d]),
        g.v(ax, Y + 16, az, ox, 0, oz, [2, 0, 0, 0], [1, 0, d]),
      ];
      g.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  return { R: hoodRadius(p), Y, feet: [] };
}

/** Hyperglow's beat (s): the Skyway snaps out on it, the houses turn on it (Lift.ts, liftGlsl's sbYawAt). */
export const HYPER_BEAT = 0.5;

const HYPERGLOW_VS = /* glsl */ `
${VS_HEAD}
void main() {
  vec3 p = position, n = normal;
  // it snaps out from the heart on the beat, 70 m a beat, each lane the moment the front passes its nearer end
  float beats = floor((uTime - uSkyT0 - 0.8) / ${F(HYPER_BEAT)});
  if (beats < 0.0 || beats * 70.0 < aE.z) { ${HIDE} }
  ${VS_TAIL}
}
`;

const HYPERGLOW_FS = /* glsl */ `
${FS_HEAD}
void main() {
  float kind = vK.x;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float fog = sbFog(vWorldPos);
  float ramp = ${R(Ramp.CYAN)}, light = 0.66, glow = 0.55;
  float beats = (uTime - uSkyT0 - 0.8) / ${F(HYPER_BEAT)};
  // (the beat's flash as the front passes, a tick of white-hot then the lane's own light)
  float since = beats - vE.z / 70.0;
  if (kind < 0.5) {
    float ac = abs(vE.x);
    if (vK.y > 0.5) { ramp = ${R(Ramp.MAGENTA)}; light = 0.7; glow = 0.5; }
    else if (ac > 0.78) { ramp = ${R(Ramp.MAGENTA)}; light = 0.82; glow = 0.65; }
    else {
      // three lanes a way, dashed between them, and pulses of light running along them both ways, a car of light each
      float dash = fract(vE.y / 9.0);
      bool mark = (abs(ac - 0.27) < 0.06 || ac < 0.04) && dash < 0.5;
      light = mark ? 0.9 : 0.56;
      glow = mark ? 0.65 : 0.4;
      float pulse = fract((vE.y + (vE.x > 0.0 ? -1.0 : 1.0) * uTime * 45.0) / 70.0);
      if (pulse < 0.12 && ac > 0.33) { ramp = vE.x > 0.0 ? ${R(Ramp.CYAN)} : ${R(Ramp.MAGENTA)}; light = 0.95; glow = 0.8; }
    }
  } else if (kind < 1.5) {
    ramp = ${R(Ramp.MAGENTA)};
    light = 0.8 + 0.12 * step(0.5, fract(uTime / ${F(HYPER_BEAT)} * 0.5));
    glow = 0.7;
  } else {
    // the fence: scanlines rising, a glitch now and then
    ramp = ${R(Ramp.MAGENTA)};
    float sl = fract(vE.x * 6.0 - uTime * 1.5);
    light = 0.5 + (sl < 0.3 ? 0.35 : 0.0) * (1.0 - vE.x);
    glow = 0.45 * (1.0 - vE.x * 0.6);
    if (vE.x > 0.55 && sl > 0.3) discard;
    if (sbH2(vec2(floor(vE.y / 8.0), floor(uTime * 8.0))) > 0.985) { ramp = ${R(Ramp.CYAN)}; light = 0.9; }
  }
  if (since >= 0.0 && since < 1.0) { ramp = ${R(Ramp.CHROME)}; light = 0.97; glow = 0.9; }
  sbWrite(ramp, light, fog, glow, mat3(viewMatrix) * n, 0.53, 0.5);
}
`;

// ---------------------------------------------------------------- Inferno: the Hellmouth

function infernoGeo(p: SkyPlace, g: Geo): Built {
  const [hx, hz] = p.heart, Y = p.ground + SKY_Y;
  const RS = 60;
  // the black sun (aE: its latitude 0..1, its longitude 0..1)
  g.tube(18, 28, (t) => {
    const lat = Math.PI * t;
    return { c: new THREE.Vector3(hx, Y - RS * Math.cos(lat), hz), r: Math.max(0.01, RS * Math.sin(lat)), up: new THREE.Vector3(0, 1, 0) };
  }, [0]);
  // the corona: tongues of flame off its limb, each two crossed blades (aK.y its seed; aE.x 0 at its root, 1 at its tip)
  const n = 90;
  for (let j = 0; j < n; j++) {
    const u = liftSeed(j, 61), v = liftSeed(j, 62);
    const th = Math.acos(1 - 2 * u), ph = v * Math.PI * 2;
    const d = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    const a = new THREE.Vector3(0, 1, 0).cross(d);
    if (a.lengthSq() < 1e-4) a.set(1, 0, 0);
    a.normalize();
    const b = d.clone().cross(a).normalize();
    for (const side of [a, b]) {
      const w = 5 + 4 * liftSeed(j, 63);
      const r0 = new THREE.Vector3(hx, Y, hz).addScaledVector(d, RS * 0.96);
      const k = [1, liftSeed(j, 64), d.x, d.z];
      const i0 = g.v(r0.x + side.x * w, r0.y + side.y * w, r0.z + side.z * w, d.x, d.y, d.z, k, [0, 0, d.y]);
      const i1 = g.v(r0.x - side.x * w, r0.y - side.y * w, r0.z - side.z * w, d.x, d.y, d.z, k, [0, 1, d.y]);
      const i2 = g.v(r0.x, r0.y, r0.z, d.x, d.y, d.z, k, [1, 0.5, d.y]);
      g.tri(i0, i1, i2);
    }
  }
  // the four columns: lava rising from the lake at the street, twisting up into the sun's belly (aE.x along 0..1)
  const pts = streetPoints(p, 4, 120, 9, 0.8);
  pts.forEach(([x, z], i) => {
    const gy = p.groundAt(x, z);
    const dx = x - hx, dz = z - hz, d = Math.hypot(dx, dz) || 1;
    const top = new THREE.Vector3(hx + (dx / d) * 22, Y - RS * 0.85, hz + (dz / d) * 22);
    const foot = new THREE.Vector3(x, gy - 1, z);
    const sw = (i % 2 ? 1 : -1) * 0.9;
    const at = (t: number) => {
      const e = Math.pow(t, 1.6);
      const tw = Math.sin(t * Math.PI) * 18;
      const ox = -dz / d, oz = dx / d;
      return new THREE.Vector3(
        foot.x + (top.x - foot.x) * e + ox * tw * sw,
        foot.y + (top.y - foot.y) * t,
        foot.z + (top.z - foot.z) * e + oz * tw * sw,
      );
    };
    g.tube(30, 10, (t) => {
      const c = at(t), c2 = at(Math.min(1, t + 0.02)), c1 = at(Math.max(0, t - 0.02));
      const r = 7 - 3 * Math.sin(Math.PI * t) + (t < 0.05 ? (0.05 - t) * 160 : 0) + (t > 0.9 ? (t - 0.9) * 60 : 0);
      return { c, r, up: c2.sub(c1).normalize() };
    }, [2, liftSeed(i, 65), foot.y, top.y]);
  });
  // embers: chips rising from the lake round the heart and up the columns, and drifting off the sun (aK.y their seed)
  const R0 = hoodRadius(p) * 0.8;
  for (let j = 0; j < 260; j++) {
    const a = liftSeed(j, 66) * Math.PI * 2, r = Math.sqrt(liftSeed(j, 67)) * R0;
    const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
    const gy = p.groundAt(x, z);
    const k = [3, liftSeed(j, 68), gy, liftSeed(j, 69)];
    const s = 0.9 + liftSeed(j, 70) * 0.9;
    const i0 = g.v(x - s, gy, z, 0, 0, 1, k, [0, 0, 0]);
    const i1 = g.v(x + s, gy, z, 0, 0, 1, k, [1, 0, 0]);
    const i2 = g.v(x, gy + s * 2.2, z, 0, 0, 1, k, [0.5, 1, 0]);
    const i3 = g.v(x, gy, z - s, 1, 0, 0, k, [0, 0, 0]);
    const i4 = g.v(x, gy, z + s, 1, 0, 0, k, [1, 0, 0]);
    g.tri(i0, i1, i2);
    g.tri(i3, i4, i2);
  }
  // the ceiling of smoke: a billowing disc over the neighbourhood, facing down only (from over it, it isn't there), thinning out at its edge
  const CR = Math.max(520, hoodRadius(p) * 1.9), CY = p.ground + 470;
  const rings = 9, sides = 56, o = g.pos.length / 3;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, r = CR * t;
    for (let s = 0; s <= sides; s++) {
      const q = (s / sides) * Math.PI * 2;
      const bil = 35 * (liftSeed(i * 97 + (s % sides), 71) - 0.5) * t + 60 * t * t;
      g.v(hx + Math.cos(q) * r, CY + bil, hz + Math.sin(q) * r, 0, -1, 0, [4, 0, 0, 0], [t, s / sides, 0]);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let s = 0; s < sides; s++) {
      const a = o + i * (sides + 1) + s, b = a + sides + 1;
      // (wound to face down)
      g.quad(a, b, b + 1, a + 1);
    }
  return { R: hoodRadius(p), Y, feet: pts };
}

const INFERNO_VS = /* glsl */ `
${VS_HEAD}
void main() {
  float kind = aK.x;
  vec3 p = position, n = normal;
  vec3 sc = vec3(uSkyC.x, uSkyC.y, uSkyC.z);
  // the columns rise first (0-2.4 s), the sun swells out of where they meet (1.8-4 s); it throbs (Inferno throbs) on a slow heartbeat
  float beat = pow(max(0.0, sin(uTime * 2.4)), 8.0);
  if (kind < 0.5 || (kind > 0.5 && kind < 1.5)) {
    float g = sbForm(1.8, 4.2);
    if (g <= 0.0) { ${HIDE} }
    float s = g * (1.0 + 0.025 * beat);
    if (kind > 0.5) {
      // a tongue: it licks out and back, its tip flickering
      float fl = 0.55 + 0.45 * sin(uTime * (4.0 + aK.y * 5.0) + aK.y * 40.0) * sin(uTime * 1.7 + aK.y * 13.0);
      float len = (14.0 + 30.0 * aK.y) * fl * g;
      vec3 d = normalize(p - sc);
      p += d * len * aE.x;
      p += vec3(aK.w, 0.0, -aK.z) * sin(uTime * 3.0 + aK.y * 9.0) * 3.0 * aE.x;
    }
    p = sc + (p - sc) * s;
  } else if (kind < 2.5) {
    float rise = sbForm(0.0, 2.4);
    if (aE.x > rise + 0.02) { ${HIDE} }
    float w = sin(aE.y * 6.2832 * 2.0 + uTime * 5.0 + aK.y * 20.0) * 0.5 + sin(aE.x * 25.0 - uTime * 6.0) * 0.6;
    p += n * w * (1.0 + beat);
  } else if (kind < 3.5) {
    // an ember: it rises and drifts, round and round (its own period), and goes out
    float per = 5.0 + 4.0 * aK.w;
    float u = fract(uTime / per + aK.y);
    if (uTime < uSkyT0 + 1.0) { ${HIDE} }
    float h = u * (120.0 + 120.0 * aK.w);
    p.y += h;
    p.x += sin(u * 9.0 + aK.y * 30.0) * 10.0 * u;
    p.z += cos(u * 7.0 + aK.y * 20.0) * 10.0 * u;
  } else {
    // the smoke: it rolls in once the sun has formed, turning slowly
    float g = sbForm(2.6, 5.5);
    if (g <= 0.0) { ${HIDE} }
    vec2 d = p.xz - sc.xz;
    float a = uTime * 0.012;
    d = vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
    p.xz = sc.xz + d * (0.35 + 0.65 * g);
    p.y += 8.0 * sin(dot(p.xz, vec2(0.012, 0.009)) + uTime * 0.25);
  }
  ${VS_TAIL}
}
`;

const INFERNO_FS = /* glsl */ `
${FS_HEAD}
void main() {
  float kind = vK.x;
  vec3 n = normalize(vN);
  float fog = sbFog(vWorldPos);
  float ramp = ${R(Ramp.OBSIDIAN)}, light = 0.2, glow = 0.0;
  float beat = pow(max(0.0, sin(uTime * 2.4)), 8.0);
  if (kind < 0.5) {
    // the black sun: black glass, a violet sheen at its limb, cracks of crimson fire that throb, its belly lit by the lake
    vec3 v = normalize(cameraPosition - vWorldPos);
    float rim = 1.0 - abs(dot(n, v));
    light = 0.08 + 0.55 * pow(rim, 2.5) + 0.12 * max(dot(n, uSunDir), 0.0);
    vec2 q = vec2(vE.y * 22.0, vE.x * 11.0);
    float c = abs(sin(q.x + 1.3 * sin(q.y * 1.7 + uTime * 0.3)) + sin(q.y * 1.9 + 1.1 * sin(q.x * 0.8)));
    if (c < 0.12) { ramp = ${R(Ramp.CRIMSON)}; light = 0.62 + 0.3 * beat; glow = 0.5 + 0.3 * beat; }
    if (n.y < -0.55) { ramp = ${R(Ramp.CRIMSON)}; light = max(light, 0.3 + 0.2 * beat); glow = max(glow, 0.2); }
  } else if (kind < 1.5) {
    // a tongue: gold at its root, through orange, to crimson at the tip
    float t = vE.x;
    ramp = t < 0.3 ? ${R(Ramp.YELLOW)} : t < 0.65 ? ${R(Ramp.ORANGE)} : ${R(Ramp.CRIMSON)};
    light = 0.9 - 0.25 * t;
    glow = 0.8 - 0.4 * t;
  } else if (kind < 2.5) {
    // a column: molten, rushing up, under a broken black crust
    float b = fract(vE.x * 10.0 - uTime * 1.2 + vK.y);
    float crust = sbH2(floor(vec2(vE.y * 7.0 + floor(vE.x * 16.0 - uTime * 1.9) * 0.37, vE.x * 16.0 - uTime * 1.9)));
    ramp = ${R(Ramp.ORANGE)};
    light = 0.78 + 0.1 * beat;
    glow = 0.6;
    if (b < 0.18) { ramp = ${R(Ramp.YELLOW)}; light = 0.92; glow = 0.8; }
    else if (crust > 0.84) { ramp = ${R(Ramp.OBSIDIAN)}; light = 0.22; glow = 0.0; }
    else if (crust > 0.62) { ramp = ${R(Ramp.CRIMSON)}; light = 0.66; glow = 0.45; }
  } else if (kind < 3.5) {
    ramp = vK.w > 0.5 ? ${R(Ramp.YELLOW)} : ${R(Ramp.ORANGE)};
    light = 0.9;
    glow = 0.7;
  } else {
    // the smoke: from under it only; black-violet, lit red from the fire under it, more toward its middle; its edge breaks up into the sky
    if (!gl_FrontFacing) discard;
    float t = vE.x;
    if (sbH2(floor(vWorldPos.xz / 6.0)) < smoothstep(0.72, 1.0, t)) discard;
    vec2 q = vWorldPos.xz * 0.012;
    float bil = sin(q.x * 1.3 + sin(q.y * 1.7 + uTime * 0.05) * 1.6) + sin(q.y * 1.1 + sin(q.x * 0.9 - uTime * 0.04) * 1.4);
    ramp = ${R(Ramp.OBSIDIAN)};
    light = 0.18 + 0.12 * bil * 0.5 + 0.1 * (1.0 - t);
    float red = (1.0 - t) * (0.6 + 0.4 * bil);
    if (red > 0.75) { ramp = ${R(Ramp.CRIMSON)}; light = 0.42 + 0.1 * beat; glow = 0.15; }
    else if (red > 0.55) { ramp = ${R(Ramp.CRIMSON)}; light = 0.3; }
  }
  sbWrite(ramp, light, fog, glow, mat3(viewMatrix) * n, fract(vK.x * 0.19 + vK.y * 0.5 + 0.13), kind > 0.5 && kind < 1.5 || kind > 2.5 && kind < 3.5 ? 0.5 : 1.0);
}
`;

function F(x: number) {
  return Number.isInteger(x) ? `${x}.0` : `${x}`;
}

// ---------------------------------------------------------------- the piece

/** what a piece's builder gives back: its size (m, the shader's uSkyC.w), its height and where anything of it stands on the ground */
interface Built {
  R: number;
  Y: number;
  feet: Array<[number, number]>;
}

const PIECES: Record<number, { geo: (p: SkyPlace, g: Geo) => Built; vs: string; fs: string }> = {
  [FACTION_ATLANTIS]: { geo: atlantisGeo, vs: ATLANTIS_VS, fs: ATLANTIS_FS },
  [FACTION_ELDERWOOD]: { geo: elderwoodGeo, vs: ELDERWOOD_VS, fs: ELDERWOOD_FS },
  [FACTION_HYPERGLOW]: { geo: hyperglowGeo, vs: HYPERGLOW_VS, fs: HYPERGLOW_FS },
  [FACTION_INFERNO]: { geo: infernoGeo, vs: INFERNO_VS, fs: INFERNO_FS },
};

/** Does this faction have a sky piece here (Rainbow's halo isn't built). */
export const hasSkyPiece = (faction: number) => faction in PIECES;

function material(faction: number): THREE.ShaderMaterial {
  const P = PIECES[faction];
  const uniforms: Record<string, THREE.IUniform> = {
    ...globals,
    uSkyC: { value: new THREE.Vector4() },
    uSkyT0: { value: 1e9 },
  };
  if (faction === FACTION_ELDERWOOD) uniforms.uIsles = { value: Array.from({ length: 7 }, () => new THREE.Vector4()) };
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, side: THREE.DoubleSide, vertexShader: P.vs, fragmentShader: P.fs });
}

/** The faction's set piece over the place (one mesh, hidden until `start`), or null for a faction with none. */
export function makeSkyPiece(faction: number, place: SkyPlace): { mesh: THREE.Mesh; tris: number; feet: Array<[number, number]>; start(t: number): void } | null {
  const P = PIECES[faction];
  if (!P) return null;
  const g = new Geo();
  const { R: size, Y, feet } = P.geo(place, g);
  const mat = material(faction);
  (mat.uniforms.uSkyC.value as THREE.Vector4).set(place.heart[0], Y, place.heart[1], size);
  if (faction === FACTION_ELDERWOOD) {
    // (each island's centre, its pieces moved about it: the same order elderwoodGeo built them in)
    const cs = spreadSquares(place, 7);
    const v = mat.uniforms.uIsles.value as THREE.Vector4[];
    cs.forEach(([x, z], i) => v[i].set(x, isleY(i, Y), z, 1));
  }
  const mesh = new THREE.Mesh(g.build(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return {
    mesh,
    tris: g.idx.length / 3,
    feet,
    start: (t: number) => {
      mat.uniforms.uSkyT0.value = t;
    },
  };
}

/** Shader warm-up (render/warmup.ts): the faction's piece in its layout, one triangle. */
export function registerSkyWarm(faction: number) {
  if (!PIECES[faction]) return;
  registerWarm('liftsky', () => {
    const g = new Geo();
    for (let i = 0; i < 3; i++) g.v(i, 0, 0, 0, 1, 0, [0], [0]);
    g.tri(0, 1, 2);
    return [new THREE.Mesh(g.build(), material(faction))];
  });
}

