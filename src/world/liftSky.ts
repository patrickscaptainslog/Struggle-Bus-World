import * as THREE from 'three';
import { config } from '../config';
import { FACTION_ATLANTIS, FACTION_ELDERWOOD, FACTION_HYPERGLOW, FACTION_INFERNO, FACTION_RAINBOW, FACTION_ROOM } from '../game/factions';
import { FACTION_LOOKS } from '../render/factionLook';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { Ramp } from '../render/palette';
import { registerWarm } from '../render/warmup';
import { BEAM, LIFT, LIFT_TURN, liftSeed, SQUARE, squareIx, squareIz, squareKey } from './liftGlsl';

// Stage 4's sky marks in the other four factions (docs/specs/factions/LIFT.md, "Stage 4 in the other factions"; FACTIONS.md section 2): the set
// piece over a lifted neighbourhood's heart, about 300 m over its ground and over the highest floating roof under it, one draw and one program,
// made only for the faction ?lift&lifted=<key> names.
// Atlantis's Sky Sea (a lens of ocean, the canals pouring up into it, a whale breaching out of it), the Elderwood's Sky Wood (islands of earth
// carrying old trees and rune stones, trailing glowing roots), Hyperglow's Skyway (the neighbourhood's real streets copied in lanes of light) and
// Inferno's Hellmouth (a black sun fed by four columns of lava, under a black-violet ceiling of smoke). Rainbow's halo isn't here yet.
//
// Everything comes from the neighbourhood's data: its heart square and its squares (hoods.bin), its streets (the tiles' OpenStreetMap
// centrelines) and its houses (where a fall or a column may stand: on a street, clear of them), so any city gets its own. Nothing here touches a
// floating house or holds one up (the producer's ruling: they float): a fall or a column rises straight up through the houses' layer from a
// street point clear of them, and bends only over it; the islands never come down into it. The geometry is built once, when the
// neighbourhood's tiles are in; the motion is in the vertex shader, on the game clock, from uSkyT0 (the wave's start: it forms after it). No
// shadow, no paint, nothing the flight sees: the bus flies through the Sea, the islands, the Skyway and the sun.

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
  /**
   * The highest any floating house whose footprint comes within r m of (x, z) can reach (m, world y; -Infinity for none): from its own placed
   * rest height, roof, domes, overshoot and heave (Lift.roofNear)
   */
  roof(x: number, z: number, r: number): number;
}

/**
 * The set pieces' height over the heart's ground (m): the producer's pick (LIFT.md's call 5), over FACTIONS.md's sky marks' 200-250 m: the bus
 * can't touch them, so they stand over its climb's chase view, not in it. Each piece stands higher where the floating roofs under it call for it.
 */
export const SKY_Y = 300;
/**
 * QA, &skyy=<m>: the pieces' height over the heart's ground for the checks instead (clear3: lower, the floating roofs hold some of them up).
 * Read from the address in the shipped build too. Under LAYER plus 20 m it can stand the Sea, the sun or the Skyway among the floating houses
 * (skyY's roof term keeps a piece over the roofs under its own discs, not over those beside them) and bends a fall or a column in to it inside
 * their layer (riser); the Sky Wood's islands keep over the layer whatever it says (isles)
 */
const skyOver = (typeof location !== 'undefined' && Number(new URLSearchParams(location.search).get('skyy'))) || SKY_Y;
/** How far each piece stays over the highest floating roof under it (m): over Lift.roofNear's reach, which has the overshoot and the heave in it. */
const SKY_CLEAR = 12;
/**
 * How wide the piece's cut round the bus is (the tangent of its half angle from the lens): from 250 m up the chase lens stands about 230 m off,
 * where 0.11 is about 25 m, the bus's own length three times over, so the bus and a little of what's round it show through.
 */
const SKY_CUT = 0.11;
/** The cut's radius at the bus, at most (m): what 0.11 is from the chase lens at 250 m. A lens farther off cuts no wider round the bus */
const SKY_CUT_R = 25;
/**
 * How far past the bus's middle, along the line from the lens, the cut reaches (m): its nose at the most, a belly or a sun it flies into
 * crosses it there. 5.68 m at the model's scale 1, times 1.6 (BusModel), 1.55 (the hero's scale at altitude), 1.25 (Turbo's) and 1.19 (a
 * super splat's swell) is 20.9 m; 10 m left the nose under the Sea's belly at 290 m
 */
const SKY_CUT_PAST = 22;
/**
 * The height its risers' feet are picked for (m over the heart's ground): a foot's ground no higher than leaves a riser the room to rise
 * straight through the floating houses' layer under a piece this high. The pieces stood at 220 m when the feet were placed; standing higher
 * leaves them more, and the feet stay where they were.
 */
const FOOT_Y = 220;

/**
 * A piece's height (m, world y): SKY_Y over the heart's ground, or higher where a floating roof under it calls for it. `under`: the piece's
 * reach downward, each as a disc (x, z, its radius, and how far under the height its lowest part comes, m).
 */
function skyY(p: SkyPlace, under: ReadonlyArray<readonly [number, number, number, number]>): number {
  let Y = p.ground + skyOver;
  for (const [x, z, r, depth] of under) Y = Math.max(Y, p.roof(x, z, r) + depth + SKY_CLEAR);
  return Y;
}
/**
 * The top of the floating houses' layer over the ground (m): no roof rests over LIFT.topMax, then the more of the jump's overshoot (13 % of the
 * highest rest, before the swell has it) and its heave on the swell's crest, and a margin for a neighbour's ground a little higher. Nothing of a
 * set piece leans, swings or bends below it.
 */
const LAYER = LIFT.topMax + Math.max(0.13 * LIFT.hMax, LIFT.heaveSmall * (1 + LIFT.heaveSpread / 2)) + 8;

const R = (r: number) => r.toFixed(1);

/** a unit icosahedron's faces' corners a detail (Geo.blob) */
const ICO: Float32Array[] = [];

/** One mesh's buffers: a point, its normal, aK (kind and three numbers its shader reads) and aE (three more, varying). */
class Geo {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly k: number[] = [];
  readonly e: number[] = [];
  readonly idx: number[] = [];
  /** where it can be drawn as it moves, a box a part (x0, y0, z0, x1, y1, z1, m): what SkyPiece.bus holds the cut's cone to */
  readonly boxes: number[] = [];
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
  /** a box round the points from vertex `from` on, `pad` m more to the sides and up and `down` m more below (how far its shader moves them) */
  box(from: number, pad: number, down = pad) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = from * 3; i < this.pos.length; i += 3)
      for (let a = 0; a < 3; a++) {
        b[a] = Math.min(b[a], this.pos[i + a]);
        b[a + 3] = Math.max(b[a + 3], this.pos[i + a]);
      }
    this.boxes.push(b[0] - pad, b[1] - down, b[2] - pad, b[3] + pad, b[4] + pad, b[5] + pad);
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
    // (the unit one's corners once a detail: making an IcosahedronGeometry a blob was most of the Sky Wood's 120-280 ms build)
    const p = (ICO[detail] ??= new THREE.IcosahedronGeometry(1, detail).toNonIndexed().attributes.position.array as Float32Array);
    for (let f = 0; f < p.length; f += 9) {
      const ax = p[f] * r, ay = p[f + 1] * r * sy, az = p[f + 2] * r;
      const bx = p[f + 3] * r, by = p[f + 4] * r * sy, bz = p[f + 5] * r;
      const qx = p[f + 6] * r, qy = p[f + 7] * r * sy, qz = p[f + 8] * r;
      // (the face's normal: (b - a) x (c - a))
      const ux = bx - ax, uy = by - ay, uz = bz - az, wx = qx - ax, wy = qy - ay, wz = qz - az;
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const i0 = this.v(cx + ax, cy + ay, cz + az, nx, ny, nz, k, e);
      const i1 = this.v(cx + bx, cy + by, cz + bz, nx, ny, nz, k, e);
      const i2 = this.v(cx + qx, cy + qy, cz + qz, nx, ny, nz, k, e);
      this.tri(i0, i1, i2);
    }
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
  /** The triangles of these kinds (aK.x) on a geometry of their own, on `geo`'s attributes; `geo` keeps the rest. */
  split(geo: THREE.BufferGeometry, kinds: readonly number[]): THREE.BufferGeometry {
    const rest: number[] = [], own: number[] = [];
    for (let i = 0; i < this.idx.length; i += 3) (kinds.includes(this.k[this.idx[i] * 4]) ? own : rest).push(this.idx[i], this.idx[i + 1], this.idx[i + 2]);
    const big = this.pos.length / 3 > 65535;
    const index = (a: number[]) => (big ? new THREE.Uint32BufferAttribute(a, 1) : new THREE.Uint16BufferAttribute(a, 1));
    geo.setIndex(index(rest));
    const h = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'aK', 'aE']) h.setAttribute(n, geo.getAttribute(n));
    h.setIndex(index(own));
    h.boundingSphere = geo.boundingSphere;
    return h;
  }
}

// ---------------------------------------------------------------- the place

/** The neighbourhood's size (m): the radius of a disc of its squares' area. */
const hoodRadius = (p: SkyPlace) => Math.sqrt((p.squares.size * SQUARE * SQUARE) / Math.PI);

/**
 * Up to n points on its streets, about `r` m from the heart, spread round it (the first toward the sun's side, turned by `turn`), each at least
 * `gap` m clear of every liftable house, its ground no more than `rise` m over the heart's (so it has the height to rise through the floating
 * houses straight before it bends: riser): where a fall or a column of lava rises. Each takes
 * the best clear street point in its own share of the way round, then in anyone's not too near another, then any clear open ground on the
 * neighbourhood's squares (a park, a plaza); a point with none of those isn't placed.
 */
function streetPoints(p: SkyPlace, n: number, r: number, gap: number, turn: number, rise: number): Array<[number, number]> {
  // (x, z, distance from the heart, its way round, how clear it is: each candidate's clearance once, not once a point it's scored for)
  const cand: Array<[number, number, number, number, number]> = [];
  const [hx, hz] = p.heart;
  const inHood = (x: number, z: number) => p.squares.has(squareKey(Math.floor(x / SQUARE), Math.floor(z / SQUARE)));
  const add = (x: number, z: number) => {
    const d = Math.hypot(x - hx, z - hz);
    if (d < r * 0.4 || d > r * 1.6 || !inHood(x, z) || p.groundAt(x, z) > p.ground + rise) return;
    const c = p.clear(x, z);
    if (c >= gap) cand.push([x, z, d, Math.atan2(z - hz, x - hx), c]);
  };
  for (const { rank, xz } of p.streets)
    for (let k = 0; rank === 0 && k + 3 < xz.length; k += 2) {
      const ax = xz[k], az = xz[k + 1], bx = xz[k + 2], bz = xz[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= len; s += 6) add(ax + ((bx - ax) * s) / Math.max(len, 1e-6), az + ((bz - az) * s) / Math.max(len, 1e-6));
    }
  const nStreet = cand.length;
  // (open ground, for a neighbourhood whose streets are all too narrow: a grid of points 8 m apart on a ring round r, only once one is needed)
  const open = () => {
    for (let z = hz - r * 1.4; z <= hz + r * 1.4; z += 8)
      for (let x = hx - r * 1.4; x <= hx + r * 1.4; x += 8) {
        const d = Math.hypot(x - hx, z - hz);
        if (d > r * 0.6 && d < r * 1.4) add(x, z);
      }
  };
  let opened = false;
  const a0 = Math.atan2(p.face[1], p.face[0]) + turn;
  const out: Array<[number, number]> = [];
  const way = (a: number, b: number) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    let best: [number, number] | null = null;
    for (const pass of [0, 1, 2]) {
      if (pass === 2 && !opened) {
        opened = true;
        open();
      }
      let bs = Infinity;
      for (let c = pass === 2 ? nStreet : 0; c < (pass === 2 ? cand.length : nStreet); c++) {
        const [x, z, d, ca] = cand[c];
        const da = way(ca, a);
        if (pass === 0 && da > Math.PI / n) continue;
        // (out of its share: no nearer than half a share to another's)
        if (pass > 0 && out.some(([ox, oz]) => way(Math.atan2(oz - hz, ox - hx), ca) < Math.PI / n)) continue;
        const score = Math.abs(d - r) + da * r * 0.5;
        if (score < bs) [bs, best] = [score, [x, z]];
      }
      if (best) break;
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * A rising path from its foot on the street up to `top`: straight up through the floating houses' layer (to LAYER over the foot's ground),
 * and only over it bending in to the top. `at(t, v)` its centre at t 0..1 of its height; `over(t)` 0..1 of the
 * way from the layer's top to its own.
 */
function riser(foot: THREE.Vector3, top: THREE.Vector3) {
  const tL = LAYER / Math.max(LAYER + 20, top.y - foot.y);
  const over = (t: number) => Math.max(0, (t - tL) / (1 - tL));
  return {
    tL,
    over,
    at(t: number, v: THREE.Vector3) {
      const s = over(t), e = s * s * (3 - 2 * s);
      return v.set(foot.x + (top.x - foot.x) * e, foot.y + (top.y - foot.y) * t, foot.z + (top.z - foot.z) * e);
    },
  };
}
/** a riser's centre and reach (its radius and `move`, how far its shader moves it) at 41 heights: x, y, z, reach (m) */
function sampleRiser(path: ReturnType<typeof riser>, rad: (t: number) => number, move: (t: number) => number): number[] {
  const out: number[] = [], v = new THREE.Vector3();
  for (let k = 0; k <= 40; k++) {
    path.at(k / 40, v);
    out.push(v.x, v.y, v.z, rad(k / 40) + move(k / 40));
  }
  return out;
}
/**
 * A fall's radius through the houses (m) and how clear of every house its foot stands (m): the radius, its ripple (1.1), a floating house's
 * lean and give at its walls (4) and a margin. A column of lava's, with its throb (2.2).
 */
const FALL_R = 4.2;
const FALL_GAP = FALL_R + 1.1 + 4 + 1.5;
const COL_R = 4.6;
const COL_GAP = COL_R + 2.2 + 4 + 1.5;

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
uniform float uSkyCrack; // the heart's crack (game clock; 1e9 none): the piece shudders and stays 4 m lower
uniform vec2 uSkyFall; // the heart's fall (game clock; 1e9 none) and the heart's ground (m): it shrinks and comes down
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
  // (the take's, LIFT.md "Taking it: the looks": the heart's crack, a damped 2 m sway over 0.8 s and 4 m lower; its fall, to 15 % about its
  // centre over 0.6 s and down to the heart's ground over 1.0 s, accelerating. Vertex only: the programs with no discard keep it)
  float ck = uTime - uSkyCrack;
  if (ck > 0.0) p += vec3(2.0 * exp(-5.0 * ck) * sin(17.0 * ck) * (1.0 - smoothstep(0.0, 0.8, ck)), -4.0 * smoothstep(0.0, 0.3, ck), 0.0);
  float fk = uTime - uSkyFall.x;
  if (fk > 0.0) {
    vec3 c = uSkyC.xyz;
    p = c + (p - c) * mix(1.0, 0.15, smoothstep(0.0, 0.6, fk));
    p.y -= (c.y - uSkyFall.y) * min(1.0, fk * fk);
  }
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
uniform vec4 uSkyBus; // the bus (x, y, z, m) and the cut's reach (w: the tangent of its half angle; 0, none)
// the bus through the piece: what of it stands between the lens and the bus, in a cone round the line from the lens to the bus, isn't drawn
// (whole within two thirds of its reach, a checker of game pixels out to it), so a piece over the climb's chase view never hides the bus.
// Only in the piece's cut program (SB_CUT), drawn while the cone can reach it (SkyPiece.bus): a program that can discard loses the early depth
// test on Apple's GPUs, every fragment of every layer shaded
void sbCut() {
#ifdef SB_CUT
  vec3 b = uSkyBus.xyz - cameraPosition, q = vWorldPos - cameraPosition;
  float lb = length(b), along = dot(q, b) / max(lb, 1e-3);
  // (and on past its middle to its nose at the most: a belly or a sun it's flying into crosses it there)
  if (along <= 0.0 || along > lb + ${F(SKY_CUT_PAST)}) return;
  // (no wider than SKY_CUT_R round the bus, however far off the lens)
  float w = min(uSkyBus.w, ${F(SKY_CUT_R)} / max(lb, 1e-3));
  float a = length(q - b * (along / max(lb, 1e-3))) / along;
  if (a < w * 0.68 || (a < w && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) > 0.5)) discard;
#endif
}
// a piece's own discards (a ring, a dither, a corona's flames, the smoke's edge): HOLE, left out of the solid program (SB_SOLID) its other
// parts draw in out of the cut (PIECES' holes), so those keep the early depth test too
#ifdef SB_SOLID
#define HOLE
#else
#define HOLE discard
#endif
`;
/** a hidden vertex: behind the far plane */
const HIDE = 'gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return;';

// ---------------------------------------------------------------- Atlantis: the Sky Sea

function* atlantisGeo(p: SkyPlace, g: Geo): Steps {
  const [hx, hz] = p.heart;
  const Rl = Math.min(190, Math.max(90, hoodRadius(p) * 0.62));
  const TB = 34, TT = 14;
  // (over the roofs under it: the lens's belly (its sway and bob 4 m more), and the whale plunging out of it, its arc 0.62 of the way out on
  // its own way round: 21 m under, 58 more down, its body and fins 12, the arc and its body and its foam within 80 m of its middle)
  const aw = Math.atan2(p.face[1], p.face[0]) + 2.2;
  const Y = skyY(p, [
    [hx, hz, Rl + 3, TB + 4],
    [hx + Math.cos(aw) * Rl * 0.62, hz + Math.sin(aw) * Rl * 0.62, 80, 21 + 58 + 12],
  ]);
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
  // (its sway, swell and bob)
  g.box(o, 6);
  const belly = (r: number) => Y - TB * Math.sqrt(Math.max(0, 1 - (r / Rl) ** 2));
  // the falls: the canals pour up from the streets into it, waterspouts: a skirt of foam on the street, a narrow rope of water straight up
  // through the floating houses, and over them a funnel flaring out as it bends in to meet the Sea (aK.y their seed, aK.z the foot, aK.w the top)
  const pts = streetPoints(p, 5, Rl * 0.75, FALL_GAP, 0.35, FOOT_Y - TB - LAYER - 25);
  const cols: number[][] = [];
  yield;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const gy = p.groundAt(x, z);
    const dx = x - hx, dz = z - hz, d = Math.hypot(dx, dz) || 1;
    const top = new THREE.Vector3(hx + (dx / d) * Math.min(d, Rl) * 0.62, 0, hz + (dz / d) * Math.min(d, Rl) * 0.62);
    top.y = belly(Math.min(d, Rl) * 0.62) + 6;
    const foot = new THREE.Vector3(x, gy - 1, z);
    const path = riser(foot, top);
    const rad = (t: number) => {
      const h = (top.y - foot.y) * t, s = path.over(t);
      return FALL_R + 6 * Math.max(0, 1 - h / 4) + 24 * s * s;
    };
    const c = new THREE.Vector3(), c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
    g.tube(30, 10, (t) => {
      path.at(t, c);
      path.at(Math.min(1, t + 0.02), c2);
      path.at(Math.max(0, t - 0.02), c1);
      return { c: c.clone(), r: rad(t), up: c2.clone().sub(c1).normalize() };
    }, [1, liftSeed(i, 21), foot.y, top.y]);
    // (its centreline and its reach at 41 heights, the shader's ripple and, over the layer, its sway in: what a check holds the houses to)
    cols.push(sampleRiser(path, rad, (t) => 1.1 + (path.over(t) > 0 ? 3 : 0)));
    yield;
  }
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
    // (where its shader takes it and its foam: 45 m either way along its side and 58 up or down from its rim, its body 30 m and its fins 18
    // round that)
    const bx = hx + Math.cos(a) * Rl * (w ? 0.62 : 0.72), bz = hz + Math.sin(a) * Rl * (w ? 0.62 : 0.72), by = Y + (w ? -21 : 9);
    g.boxes.push(bx - 95, by - 98, bz - 95, bx + 95, by + 98, bz + 95);
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
  return { R: Rl, Y, feet: pts, cols };
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
    // a fall: the water climbs up it from the street (aE.x 0..1 along it), rippling; only over the houses' layer does it sway, so it rises
    // through them straight, clear of every one
    float rise = sbForm(0.0, 1.8);
    if (aE.x > rise + 0.02) { ${HIDE} }
    float w = sin(aE.y * 6.2832 * 3.0 + uTime * 6.0 + aK.y * 20.0) * 0.6 + sin(aE.x * 30.0 - uTime * 9.0) * 0.5;
    p += n * w;
    float ov = smoothstep(${F(LAYER)}, ${F(LAYER)} + 25.0, position.y - aK.z);
    p.xz += vec2(sin(aE.x * 7.0 + uTime * 1.3 + aK.y * 9.0), cos(aE.x * 6.0 + uTime * 1.1)) * 3.0 * ov;
  } else {
    // a whale (2) or its foam (3): its arc, 13 s round, the two half a round apart; out of the top (aK.y 0) or the belly (1). The first, from the
    // belly, plunges three seconds after the Sea has formed (7-11 s into the wave), the other breaches out of the top at 13.6 s
    float wh = aK.y;
    float P = 13.0;
    float u = fract((uTime - uSkyT0 - 5.6) / P + (wh > 0.5 ? 0.967 : 0.467));
    if (uTime < uSkyT0 + 4.6) { ${HIDE} }
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
  sbCut();
  float kind = vK.x;
  vec3 n = normalize(vN);
  float fog = sbFog(vWorldPos);
  float ramp = ${R(Ramp.TEAL)}, light = 0.4, glow = 0.12;
  if (kind < 0.5) {
    if (vE.x < 0.0) {
      // the belly: the sea seen from under it, deep, the sun's shafts fanning out from its middle and bands of light running out with the swell
      // (not the bellies' net of light: the houses under it have that), schools of fish turning in it, foam at the rim
      vec2 f = vWorldPos.xz - uSkyC.xz;
      float a = atan(f.y, f.x), r = length(f);
      float shaft = sbH2(vec2(floor(a * 7.0 + uTime * 0.04 + 0.6 * sin(uTime * 0.13)), 3.0));
      float band = fract(r * 0.035 - uTime * 0.18 + 0.15 * sin(a * 5.0 + uTime * 0.3));
      light = 0.2 + 0.16 * (1.0 - vE.z);
      glow = 0.16;
      if (shaft > 0.62) { light += 0.12 * (1.0 - vE.z); glow = 0.24; }
      if (band < 0.1) { light += 0.16; glow = 0.32; }
      vec2 fq = vec2(a * 18.0 - uTime * 0.35, r * 0.14 + 0.8 * sin(a * 3.0 + uTime * 0.2));
      float fish = sbH2(floor(fq * vec2(1.0, 2.0)));
      if (fish > 0.93 && fract(fq.y * 2.0) < 0.45 && r < uSkyC.w * 0.8) { ramp = ${R(Ramp.TEAL)}; light = 0.06; glow = 0.0; }
      if (vE.z > 0.93) { ramp = ${R(Ramp.PEARL)}; light = 0.74; glow = 0.3; }
      else if (vE.z > 0.86 && sbH2(floor(vWorldPos.xz / 3.0)) > 0.5) { ramp = ${R(Ramp.WHITE)}; light = 0.7; glow = 0.2; }
    } else {
      // the top: open sea in the sun, waves running across it, their crests bent by a second set, foam broken along them in streaks (not a
      // lattice of spots where two straight sets cross), glints, going deep indigo toward its rim (you look into it there), a pearl lip
      vec2 q = vWorldPos.xz;
      float w2 = sin(dot(q, vec2(-0.05, 0.11)) - uTime * 0.6);
      float w1 = sin(dot(q, vec2(0.16, 0.07)) + 1.8 * w2 + 0.9 * sin(dot(q, vec2(0.031, -0.047)) + uTime * 0.2) - uTime * 1.3);
      light = sbLit(n) * 0.6 + 0.18 + 0.05 * w1 + 0.03 * w2 - 0.2 * smoothstep(0.5, 0.92, vE.z);
      glow = 0.1;
      if (w1 > 0.9 && sbH2(floor(q / vec2(2.0, 2.0)) + floor(w2 * 3.0)) > 0.4) { ramp = ${R(Ramp.WHITE)}; light = 0.84; glow = 0.2; }
      else if (w1 > 0.7) light += 0.1;
      float wv = w1;
      if (wv > 0.2 && sbH2(floor(vWorldPos.xz / 1.5) + floor(uTime * 3.0)) > 0.985) { ramp = ${R(Ramp.WHITE)}; light = 0.95; glow = 0.5; }
      if (vE.z > 0.95) { ramp = ${R(Ramp.PEARL)}; light = 0.8; }
    }
  } else if (kind < 1.5) {
    // a fall: water running up it in streaks, lit from inside, flecks of foam racing up, a churn of foam at its foot, spray where it meets the Sea
    float col = floor(vE.y * 18.0);
    float streak = fract(vE.x * (5.0 + 3.0 * sbH2(vec2(col, vK.y))) - uTime * (0.9 + 0.5 * sbH2(vec2(col, 3.0))) + sbH2(vec2(col, 7.0)));
    light = 0.5 + 0.2 * sbLit(n);
    glow = 0.3;
    if (streak < 0.12) { light = 0.7; glow = 0.4; }
    if (streak < 0.035) { ramp = ${R(Ramp.WHITE)}; light = 0.9; glow = 0.4; }
    if ((vWorldPos.y - vK.z < 5.0 || vE.x > 0.9) && sbH2(floor(vWorldPos.xz * 0.7) + floor(vWorldPos.y * 0.7) + floor(uTime * 6.0)) > 0.3) { ramp = ${R(Ramp.WHITE)}; light = 0.88; glow = 0.4; }
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

/**
 * The Sky Wood's islands, over the squares farthest apart from the heart: each one's centre, its turf's height, its radius and its rock's
 * depth (m), the top of the floating houses' layer under it (`floor`: its ground's highest under its rim, plus LAYER) and how far it rises
 * into place (m). Its rock, its roots and its rise all stay over that floor, and its rock and its rise over the highest floating roof under it
 * by SKY_CLEAR: an island over a square higher than the heart floats higher.
 */
function isles(p: SkyPlace) {
  const Y = skyY(p, []);
  return spreadSquares(p, 7).map(([x, z], i) => {
    const r = isleR(i), depth = r * 0.55;
    let g = p.groundAt(x, z);
    for (let k = 0; k < 8; k++) g = Math.max(g, p.groundAt(x + Math.cos((k * Math.PI) / 4) * r, z + Math.sin((k * Math.PI) / 4) * r));
    // (its rim reaches 1.12 of its radius, its roots sway 4 m)
    const floor = Math.max(g + LAYER, p.roof(x, z, r * 1.15 + 4) + SKY_CLEAR);
    // (its rock's crags reach 1.15 of its depth and it breathes 3 m; it rises scaled up from small, so from at most `room` below it clears too)
    const y = Math.max(isleY(i, Y), floor + depth * 1.15 + 3 + 4);
    const room = y - floor - 3 - depth * 1.15;
    return { x, z, y, r, depth, floor, rise: Math.max(0, Math.min(40, room)) };
  });
}

function* elderwoodGeo(p: SkyPlace, g: Geo): Steps {
  const Y = skyY(p, []);
  const all = isles(p);
  for (let i = 0; i < all.length; i++) {
    const { x, z, y, r, depth, floor, rise } = all[i];
    const heart = i === 0;
    const from = g.pos.length / 3;
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
    // the rock under it: a mesa, its sides stepping in at ledges of strata down to a craggy base, not a point (aE.x its depth 0..1). The
    // profile: each ring's depth and its radius, as shares
    const prof = [[0.16, 0.95], [0.22, 0.84], [0.46, 0.79], [0.52, 0.63], [0.76, 0.56], [0.83, 0.38], [1, 0.2]];
    let ids = rim.concat([rim[0]]).map((rr, s) => {
      const a = (s / sides) * Math.PI * 2;
      return g.v(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, Math.cos(a), -0.3, Math.sin(a), k(0), [0, s / sides, 0]);
    });
    prof.forEach(([t, sh], ring) => {
      const nid: number[] = [];
      for (let s = 0; s <= sides; s++) {
        const j = s % sides, a = (j / sides) * Math.PI * 2 + 0.12 * ring;
        const rr = rim[j] * sh * (0.85 + 0.3 * liftSeed(i * 97 + j * 7 + ring, 35));
        const dd = depth * t * (0.92 + 0.16 * liftSeed(j + ring * 13 + i, 36));
        // (a ledge, where it steps in, faces down)
        const ny = ring % 2 ? -0.8 : -0.25;
        nid.push(g.v(x + Math.cos(a) * rr, y - dd, z + Math.sin(a) * rr, Math.cos(a), ny, Math.sin(a), k(0), [t, s / sides, 0]));
      }
      for (let s = 0; s < sides; s++) g.quad(ids[s], nid[s], nid[s + 1], ids[s + 1]);
      ids = nid;
    });
    const base = g.v(x, y - depth * 1.12, z, 0, -1, 0, k(0), [1, 0, 0]);
    for (let s = 0; s < sides; s++) g.tri(ids[s], base, ids[s + 1]);
    // the roots: long, thin and glowing, hanging straight from its belly and swaying, never down into the houses' layer (aE.x along 0..1)
    const nRoots = heart ? 16 : 8;
    for (let j = 0; j < nRoots; j++) {
      const a = (j / nRoots) * Math.PI * 2 + liftSeed(j + i * 20, 37);
      const r0 = r * (0.12 + 0.42 * liftSeed(j + i * 20, 38));
      const y0 = y - depth * (1 - 0.6 * (r0 / r));
      const len = Math.min(42 + 30 * liftSeed(j + i * 20, 39), y0 - 3 - floor);
      if (len < 10) continue;
      const bend = 2 + 3 * liftSeed(j, 40);
      g.tube(8, 4, (t) => ({
        c: new THREE.Vector3(x + Math.cos(a) * (r0 + bend * Math.sin(t * 3.1)), y0 - len * t, z + Math.sin(a) * (r0 + bend * Math.sin(t * 3.1))),
        r: 1.1 * (1 - t * 0.7),
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
      // (lantern fruit big enough to read gold from the climb)
      for (let f = 0; f < (heart && !j ? 34 : 14); f++) {
        const q = f * 2.399 + j;
        const rr = crown * (0.7 + 0.5 * liftSeed(f, 47));
        g.blob(cx + Math.cos(q) * rr, cy - crown * 0.55 - 2 * liftSeed(f, 48), cz + Math.sin(q) * rr, 2.1, 1.4, 0, [4, i, f, liftSeed(f + i * 30, 49)], [0, 0, 0]);
      }
    }
    // a ring of standing stones on its turf's edge: tall, tapering to a broken top, leaning, glyphs glowing on their broad faces
    const nStones = heart ? 9 : 5;
    for (let j = 0; j < nStones; j++) {
      const a = (j / nStones) * Math.PI * 2 + 0.3;
      const sx = x + Math.cos(a) * r * 0.72, sz = z + Math.sin(a) * r * 0.72, sy = y + r * 0.03;
      const w = 3.4, hgt = (heart ? 19 : 13) * (0.85 + 0.3 * liftSeed(j + i * 11, 51)), d = 1.9;
      const ca = Math.cos(a), sa = Math.sin(a), lean = 0.12 * (liftSeed(j + i * 11, 50) - 0.5);
      // (u across its thickness, v along its face, h up it: it narrows to 0.6 at the top, one shoulder broken lower)
      const pt = (u: number, v: number, h: number) => {
        const tp = 1 - 0.4 * (h / hgt), hh = v > 0 ? h : h * 0.86;
        return [sx + ca * d * u * tp - sa * w * v * tp + ca * lean * hh, sy + hh, sz + sa * d * u * tp + ca * w * v * tp + sa * lean * hh];
      };
      const face = (q: number[][], nx: number, ny: number, nz: number, rune: number) => {
        const ii = q.map((c, m) => g.v(c[0], c[1], c[2], nx, ny, nz, [5, i, j, rune], [m === 1 || m === 2 ? 1 : 0, m >= 2 ? 1 : 0, 0]));
        g.quad(ii[0], ii[1], ii[2], ii[3]);
      };
      // (its two broad faces carry the glyphs; the narrow ones and the top are plain)
      face([pt(1, -1, 0), pt(1, 1, 0), pt(1, 1, hgt), pt(1, -1, hgt)], ca, 0, sa, 1);
      face([pt(-1, 1, 0), pt(-1, -1, 0), pt(-1, -1, hgt), pt(-1, 1, hgt)], -ca, 0, -sa, 1);
      face([pt(-1, -1, 0), pt(1, -1, 0), pt(1, -1, hgt), pt(-1, -1, hgt)], sa, 0, -ca, 0);
      face([pt(1, 1, 0), pt(-1, 1, 0), pt(-1, 1, hgt), pt(1, 1, hgt)], -sa, 0, ca, 0);
      face([pt(1, -1, hgt), pt(1, 1, hgt), pt(-1, 1, hgt), pt(-1, -1, hgt)], 0, 1, 0, 0);
    }
    // (its turn, its breath, its roots' swing and its crowns', and below it its rise into place)
    g.box(from, 14, rise + 14);
    yield;
  }
  return { R: hoodRadius(p), Y, feet: [], cols: [] };
}

const ELDERWOOD_VS = /* glsl */ `
${VS_HEAD}
uniform vec4 uIsles[7]; // each island's centre x, y, z, and how far it rises into place (m: isles())
void main() {
  float kind = aK.x, isle = aK.y;
  vec3 p = position, n = normal;
  vec4 c = uIsles[int(isle + 0.5)];
  // each island rises into place over the houses, one after another, growing out of the haze as it comes (it never comes down into their
  // layer), then lets its roots down, and then breathes: a slow rise and fall, a slow turn
  float rise = sbForm(0.4 + isle * 0.35, 3.6 + isle * 0.35);
  if (rise <= 0.0) { ${HIDE} }
  if (kind > 5.5 && aE.x > sbForm(3.6 + isle * 0.35, 6.0 + isle * 0.35)) { ${HIDE} }
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
  p = c.xyz + d * (0.15 + 0.85 * e) + vec3(0.0, br - (1.0 - e) * c.w, 0.0);
  ${VS_TAIL}
}
`;

const ELDERWOOD_FS = /* glsl */ `
${FS_HEAD}
void main() {
  sbCut();
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
    // (blossom: violet in patches big enough to read from the climb, so it isn't a park's green)
    if (sbH2(floor(vWorldPos.xz / 5.0) + floor(vWorldPos.y / 5.0)) > 0.74) { ramp = ${R(Ramp.VIOLET)}; light = 0.46 + 0.26 * lit; glow = 0.1; }
  } else if (kind < 4.5) {
    // lantern fruit, glowing gold, pulsing out of step
    ramp = ${R(Ramp.YELLOW)};
    light = 0.78 + 0.14 * sin(uTime * 2.0 + vK.w * 30.0);
    glow = 0.7;
  } else if (kind < 5.5) {
    // a standing stone: weathered grey-lilac stone, darker than the bark, mottled, its broad faces cut with glyphs that glow lime, breathing
    light = 0.12 + 0.3 * lit + 0.05 * (sbH2(floor(vWorldPos.xz * 1.5 + vWorldPos.y * 1.5)) - 0.5);
    if (vK.w > 0.5) {
      vec2 g = floor(vE.xy * vec2(3.0, 5.0));
      float r = sbH2(g + vK.yz * 3.1);
      vec2 f = fract(vE.xy * vec2(3.0, 5.0));
      bool cut = r > 0.3 && (abs(f.x - 0.5) < 0.16 || (r > 0.6 && abs(f.y - 0.5) < 0.14) || (r > 0.85 && abs(f.x - f.y) < 0.12)) && vE.y > 0.08 && vE.y < 0.88 && vE.x > 0.12 && vE.x < 0.88;
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

function* hyperglowGeo(p: SkyPlace, g: Geo): Steps {
  const [hx, hz] = p.heart;
  const inHood = (x: number, z: number) => p.squares.has(squareKey(Math.floor(x / SQUARE), Math.floor(z / SQUARE)));
  // (flat, over the roofs under every lane: a segment's disc, out to its sides 3 m deep and a junction's ring at either end, 16 m)
  const under: Array<[number, number, number, number]> = [];
  for (const { xz } of p.streets)
    for (let k = 0; k + 3 < xz.length; k += 2) {
      const ax = xz[k], az = xz[k + 1], bx = xz[k + 2], bz = xz[k + 3];
      if (inHood((ax + bx) / 2, (az + bz) / 2)) under.push([(ax + bx) / 2, (az + bz) / 2, Math.hypot(bx - ax, bz - az) / 2 + 16, 3]);
    }
  const Y = skyY(p, under);
  // (the roofs under every lane are a part of their own: with the lanes they were 11-27 ms on a big hilly neighbourhood)
  yield;
  const ends = new Map<string, [number, number, number]>();
  const node = (x: number, z: number) => {
    const key = `${Math.round(x / 6)},${Math.round(z / 6)}`;
    const e = ends.get(key);
    if (e) e[2]++;
    else ends.set(key, [x, z, 1]);
  };
  // a lane a street's segment: a ribbon of light with depth, aE (across -1..1, its length along the street m, its distance from the heart m), and
  // under each edge a glowing side 3 m deep (kind 3)
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
      if (!rank)
        for (const sd of [1, -1]) {
          const kd = [3, 0, 0, 0];
          const ox = nx * W * sd, oz = nz * W * sd;
          const j0 = g.v(ax - ex + ox, Y, az - ez + oz, nx * sd, 0, nz * sd, kd, [sd, s, da]);
          const j1 = g.v(bx + ex + ox, Y, bz + ez + oz, nx * sd, 0, nz * sd, kd, [sd, s + len, db]);
          const j2 = g.v(bx + ex + ox, Y - 3, bz + ez + oz, nx * sd, 0, nz * sd, kd, [sd, s + len, db]);
          const j3 = g.v(ax - ex + ox, Y - 3, az - ez + oz, nx * sd, 0, nz * sd, kd, [sd, s, da]);
          g.quad(j0, j1, j2, j3);
        }
      // (a box a lane and its sides: one round the whole Skyway kept the cut's program in wherever the line to the bus crossed its height)
      g.box(i0, 1);
      s += len;
      if (!rank && k === 0) node(ax, az);
      if (!rank && k + 4 >= xz.length) node(bx, bz);
    }
  }
  // the junctions: a ring of light where streets meet (their ends, met by more than one), aE.xy across it -1..1
  for (const [x, z, c] of ends.values()) {
    if (c < 2) continue;
    const d = Math.hypot(x - hx, z - hz), r = 11;
    const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => g.v(x + u * r, Y + 0.3, z + v * r, 0, 1, 0, [1, 0, 0, 0], [u, v, d]));
    g.quad(ids[0], ids[3], ids[2], ids[1]);
    g.box(ids[0], 1);
  }
  // (no fence round the neighbourhood's edge: from a kilometre it framed the Skyway like a selection box)
  return { R: hoodRadius(p), Y, feet: [], cols: [] };
}

/** Hyperglow's beat (s): the Skyway snaps out on it and pulses on it, the houses turn on it (liftGlsl's LIFT_TURN, sbYawAt), on the same clock. */
const HYPER_BEAT = LIFT_TURN.beat;

const HYPERGLOW_VS = /* glsl */ `
${VS_HEAD}
void main() {
  vec3 p = position, n = normal;
  // it snaps out from the heart on the beat, 70 m a beat, each lane the moment the front passes its nearer end: the game clock's beats, the ones
  // the houses snap round on, from the first after the wave's start
  float beats = floor(uTime / ${F(HYPER_BEAT)}) - ceil((uSkyT0 + 0.8) / ${F(HYPER_BEAT)});
  if (beats < 0.0 || beats * 70.0 < aE.z) { ${HIDE} }
  ${VS_TAIL}
}
`;

const HYPERGLOW_FS = /* glsl */ `
${FS_HEAD}
void main() {
  sbCut();
  float kind = vK.x;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float fog = sbFog(vWorldPos);
  float ramp = ${R(Ramp.CYAN)}, light = 0.66, glow = 0.55;
  float beats = uTime / ${F(HYPER_BEAT)} - ceil((uSkyT0 + 0.8) / ${F(HYPER_BEAT)});
  // (the beat's flash as the front passes, a tick of white-hot then the lane's own light)
  float since = beats - vE.z / 70.0;
  // (and on every beat after, a pulse running out from the heart along every lane at once, 400 m a second)
  bool pulseB = abs(vE.z - fract(beats) * 200.0) < 4.0;
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
      if (pulseB) { ramp = ${R(Ramp.CHROME)}; light = 0.95; glow = 0.85; }
    }
  } else if (kind < 1.5) {
    // a junction: a ring of light, beating
    float r = length(vE.xy);
    if (r > 1.0 || r < 0.62) HOLE;
    ramp = ${R(Ramp.MAGENTA)};
    light = 0.8 + 0.12 * step(0.5, fract(uTime / ${F(HYPER_BEAT)} * 0.5));
    glow = 0.7;
  } else {
    // a lane's side: its glow falling off down it, broken up into a dither at the bottom; the beat's pulse runs along it too
    float v = (uSkyC.y - vWorldPos.y) / 3.0;
    ramp = ${R(Ramp.MAGENTA)};
    light = 0.86 - 0.36 * v;
    glow = 0.6 - 0.3 * v;
    if (v > 0.55 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) > 0.5) HOLE;
    if (pulseB) { ramp = ${R(Ramp.CHROME)}; light = 0.95; glow = 0.85; }
    n = normalize(vN);
  }
  if (since >= 0.0 && since < 1.0) { ramp = ${R(Ramp.CHROME)}; light = 0.97; glow = 0.9; }
  sbWrite(ramp, light, fog, glow, mat3(viewMatrix) * n, 0.53, 0.5);
}
`;

// ---------------------------------------------------------------- Inferno: the Hellmouth

/** The black sun's radius (m) and how far out its corona's square reaches (in its radii) */
const RS_ = 60;
const HALO = 1.85;
/** When the columns have poured up into the sun and are gone (s from the piece's start) */
const COLS_GONE = 6.4;

function* infernoGeo(p: SkyPlace, g: Geo): Steps {
  const [hx, hz] = p.heart;
  const RS = RS_;
  // (over the roofs under it: the sun, throbbing, and the corona's square, which faces the eye: seen from the street it hangs its half width
  // under the sun's middle, and turned it reaches its half diagonal out)
  const Y = skyY(p, [[hx, hz, HALO * RS * Math.SQRT2 + 2, HALO * RS + 2]]);
  // the black sun (aE: its latitude 0..1, its longitude 0..1)
  g.tube(18, 28, (t) => {
    const lat = Math.PI * t;
    return { c: new THREE.Vector3(hx, Y - RS * Math.cos(lat), hz), r: Math.max(0.01, RS * Math.sin(lat)), up: new THREE.Vector3(0, 1, 0) };
  }, [0]);
  // (its throb; the corona, turned to the eye, within its half diagonal and 6 m of its middle)
  g.box(0, RS * 0.03 + 1);
  const hr = HALO * RS * Math.SQRT2 + 7;
  g.boxes.push(hx - hr, Y - hr, hz - hr, hx + hr, Y + hr, hz + hr);
  // the corona: one square facing the eye, behind the sun, drawn as an eclipse's ring: a thin gold rim, tongues of flame licking off it, and
  // stepped crimson halos fading out (aE.xy across it -1..1; its half width is HALO suns' radii)
  {
    const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => g.v(hx, Y, hz, 0, 0, 1, [1, 0, 0, 0], [u, v, 0]));
    g.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  // the four columns: lava rising from the lake at the street, flaring there, straight up through the floating houses and over them twisting in
  // to the sun's belly; once the sun has formed they pour up into it and are gone (aE.x along 0..1)
  const pts = streetPoints(p, 4, 120, COL_GAP, 0.8, FOOT_Y - RS * 0.85 - LAYER - 25);
  const cols: number[][] = [];
  yield;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const gy = p.groundAt(x, z);
    const dx = x - hx, dz = z - hz, d = Math.hypot(dx, dz) || 1;
    const top = new THREE.Vector3(hx + (dx / d) * 22, Y - RS * 0.85, hz + (dz / d) * 22);
    const foot = new THREE.Vector3(x, gy - 1, z);
    const path = riser(foot, top);
    const sw = (i % 2 ? 1 : -1) * 0.9, ox = -dz / d, oz = dx / d;
    const at = (t: number, v: THREE.Vector3) => {
      path.at(t, v);
      // (its twist, over the layer only)
      const tw = Math.sin(path.over(t) * Math.PI) * 18 * sw;
      return v.set(v.x + ox * tw, v.y, v.z + oz * tw);
    };
    const rad = (t: number) => {
      const h = (top.y - foot.y) * t;
      return COL_R + 9 * Math.max(0, 1 - h / 4) + (t > 0.9 ? (t - 0.9) * 60 : 0);
    };
    g.tube(30, 10, (t) => {
      const c = at(t, new THREE.Vector3()), c2 = at(Math.min(1, t + 0.02), new THREE.Vector3()), c1 = at(Math.max(0, t - 0.02), new THREE.Vector3());
      return { c, r: rad(t), up: c2.sub(c1).normalize() };
    }, [2, liftSeed(i, 65), foot.y, top.y]);
    cols.push(sampleRiser({ ...path, at }, rad, () => 2.2));
    yield;
  }
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
  // (170 m over the sun's middle, at least, and over the roofs under all of it: it billows and rolls 10 m under its height)
  const CR = Math.max(520, hoodRadius(p) * 1.9), CY = Math.max(p.ground + 470, Y + 170, p.roof(hx, hz, CR) + 10 + SKY_CLEAR);
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
  // (it turns round the heart within its own disc and billows 8 m. The embers have no box: a chip 2 m across over the bus is a spark, not
  // a piece standing between it and the lens, and with them the cut would be in from the ground to 240 m over the whole neighbourhood)
  g.box(o, 9);
  return { R: hoodRadius(p), Y, feet: pts, cols, colsGone: COLS_GONE };
}

const INFERNO_VS = /* glsl */ `
${VS_HEAD}
void main() {
  float kind = aK.x;
  vec3 p = position, n = normal;
  vec3 sc = vec3(uSkyC.x, uSkyC.y, uSkyC.z);
  // the columns rise first (0-2.4 s), the sun swells out of where they meet (1.8-4.2 s), its corona flares (2.2-4.6 s) and the columns pour up
  // into it and are gone (4.4-6.4 s: FACTIONS.md's "fuses into a black sun"); it throbs (Inferno throbs) on a slow heartbeat
  float beat = pow(max(0.0, sin(uTime * 2.4)), 8.0);
  if (kind < 0.5) {
    float g = sbForm(1.8, 4.2);
    if (g <= 0.0) { ${HIDE} }
    p = sc + (p - sc) * g * (1.0 + 0.025 * beat);
  } else if (kind < 1.5) {
    // the corona's square: facing the eye, a little behind the sun's middle, growing with it
    float g = sbForm(2.2, 4.6);
    if (g <= 0.0) { ${HIDE} }
    vec3 v = normalize(cameraPosition - sc);
    vec3 rt = normalize(cross(abs(v.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), v));
    vec3 up = cross(v, rt);
    p = sc - v * 6.0 + (rt * aE.x + up * aE.y) * ${F(HALO * RS_)} * g;
    n = v;
  } else if (kind < 2.5) {
    // a column: it rises (0-2.4 s), and once the sun has swollen out of where they meet it pours up into it, its foot rising after it
    float rise = sbForm(0.0, 2.4);
    if (aE.x > rise + 0.02 || aE.x < sbForm(4.4, ${F(COLS_GONE)}) * 1.02 - 0.02) { ${HIDE} }
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
  sbCut();
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
    // the corona, an eclipse's: out from the sun's limb (r in its radii) a thin gold rim, then tongues of flame licking out of it (gold, orange,
    // crimson), then crimson halos stepping down in light, broken into a dither as they fade
    float r = length(vE.xy) * ${F(HALO)};
    float a = atan(vE.y, vE.x);
    float lick = 0.5 + 0.5 * sin(a * 9.0 + 2.0 * sin(a * 4.0 - uTime * 1.3) + uTime * 2.1) * sin(a * 5.0 - uTime * 1.7 + 1.3);
    float tip = 1.05 + 0.32 * lick * (0.85 + 0.15 * beat);
    if (r < 0.98) HOLE;
    float dith = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0);
    if (r < 1.05) { ramp = ${R(Ramp.YELLOW)}; light = 0.96; glow = 0.9; }
    else if (r < tip) {
      float u = (r - 1.05) / max(tip - 1.05, 1e-3);
      ramp = u < 0.3 ? ${R(Ramp.YELLOW)} : ${R(Ramp.CRIMSON)};
      light = u < 0.3 ? 0.92 : 0.74 - 0.2 * (u - 0.3);
      glow = 0.8 - 0.35 * u;
    } else {
      float ring = floor((r - 1.05) / 0.14);
      if (ring > 4.0 || (ring > 2.0 && dith > 0.5) || (ring > 3.0 && mod(floor(gl_FragCoord.x * 0.5) + floor(gl_FragCoord.y), 2.0) > 0.5)) HOLE;
      ramp = ${R(Ramp.CRIMSON)};
      light = 0.66 - 0.1 * ring + 0.08 * beat;
      glow = 0.42 - 0.08 * ring;
    }
  } else if (kind < 2.5) {
    // a column: molten scarlet, rushing up, gold in its brightest bands, under a broken black crust
    float b = fract(vE.x * 10.0 - uTime * 1.2 + vK.y);
    float crust = sbH2(floor(vec2(vE.y * 7.0 + floor(vE.x * 16.0 - uTime * 1.9) * 0.37, vE.x * 16.0 - uTime * 1.9)));
    ramp = ${R(Ramp.CRIMSON)};
    light = 0.7 + 0.06 * beat;
    glow = 0.6;
    if (b < 0.18) { ramp = ${R(Ramp.YELLOW)}; light = 0.92; glow = 0.8; }
    else if (crust > 0.84) { ramp = ${R(Ramp.OBSIDIAN)}; light = 0.22; glow = 0.0; }
    else if (crust > 0.62) { ramp = ${R(Ramp.CRIMSON)}; light = 0.5; glow = 0.35; }
  } else if (kind < 3.5) {
    ramp = vK.w > 0.5 ? ${R(Ramp.YELLOW)} : ${R(Ramp.CRIMSON)};
    light = vK.w > 0.5 ? 0.9 : 0.74;
    glow = 0.7;
  } else {
    // the smoke: from under it only; black-violet, lit red from the fire under it, more toward its middle; its edge breaks up into the sky
    if (!gl_FrontFacing) HOLE;
    float t = vE.x;
    if (sbH2(floor(vWorldPos.xz / 6.0)) < smoothstep(0.72, 1.0, t)) HOLE;
    vec2 q = vWorldPos.xz * 0.012;
    float bil = sin(q.x * 1.3 + sin(q.y * 1.7 + uTime * 0.05) * 1.6) + sin(q.y * 1.1 + sin(q.x * 0.9 - uTime * 0.04) * 1.4);
    ramp = ${R(Ramp.OBSIDIAN)};
    light = 0.18 + 0.12 * bil * 0.5 + 0.1 * (1.0 - t);
    float red = (1.0 - t) * (0.6 + 0.4 * bil);
    if (red > 0.75) { ramp = ${R(Ramp.CRIMSON)}; light = 0.42 + 0.1 * beat; glow = 0.15; }
    else if (red > 0.55) { ramp = ${R(Ramp.CRIMSON)}; light = 0.3; }
  }
  sbWrite(ramp, light, fog, glow, mat3(viewMatrix) * n, fract(vK.x * 0.19 + vK.y * 0.5 + 0.13), kind > 2.5 && kind < 3.5 ? 0.5 : 1.0);
}
`;

function F(x: number) {
  return Number.isInteger(x) ? `${x}.0` : `${x}`;
}

// ---------------------------------------------------------------- the piece

/** A piece's builder: it yields between its parts (an island, a fall, a column), so it's built a part a frame, and returns what Built says. */
type Steps = Generator<undefined, Built, undefined>;

/** what a piece's builder gives back: its size (m, the shader's uSkyC.w), its height and where anything of it stands on the ground */
interface Built {
  R: number;
  Y: number;
  feet: Array<[number, number]>;
  /** each fall's or column's centre and reach at 41 heights (x, y, z, m: sampleRiser), for the checks */
  cols: number[][];
  /** when its risers are gone (s from its start), if they go */
  colsGone?: number;
}

/** Each faction's piece: its build, its shaders, and the kinds of its parts that HOLE (drawn apart, the rest in the solid program) */
const PIECES: Record<number, { geo: (p: SkyPlace, g: Geo) => Steps; vs: string; fs: string; holes?: readonly number[] }> = {
  [FACTION_ATLANTIS]: { geo: atlantisGeo, vs: ATLANTIS_VS, fs: ATLANTIS_FS },
  [FACTION_ELDERWOOD]: { geo: elderwoodGeo, vs: ELDERWOOD_VS, fs: ELDERWOOD_FS },
  // (the junctions' rings and the lanes' sides)
  [FACTION_HYPERGLOW]: { geo: hyperglowGeo, vs: HYPERGLOW_VS, fs: HYPERGLOW_FS, holes: [1, 3] },
  // (the corona and the smoke)
  [FACTION_INFERNO]: { geo: infernoGeo, vs: INFERNO_VS, fs: INFERNO_FS, holes: [1, 4] },
};

/** Does this faction have a sky piece here (Rainbow's halo isn't built). */
export const hasSkyPiece = (faction: number) => faction in PIECES;

/**
 * The faction's programs, on the one set of uniforms: `cut` with the cut round the bus (SB_CUT), `plain` without it, and `solid` without its
 * own HOLEs either, for the parts that have none (the plain one where the piece has no holes)
 */
function materials(faction: number): { cut: THREE.ShaderMaterial; plain: THREE.ShaderMaterial; solid: THREE.ShaderMaterial } {
  const P = PIECES[faction];
  const uniforms: Record<string, THREE.IUniform> = {
    ...globals,
    uSkyC: { value: new THREE.Vector4() },
    uSkyT0: { value: 1e9 },
    uSkyBus: { value: new THREE.Vector4(0, -1e6, 0, SKY_CUT) },
    uSkyCrack: { value: 1e9 },
    uSkyFall: { value: new THREE.Vector2(1e9, 0) },
  };
  if (faction === FACTION_ELDERWOOD) uniforms.uIsles = { value: Array.from({ length: 7 }, () => new THREE.Vector4()) };
  const make = (defines: Record<string, string>) =>
    new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, defines, side: THREE.DoubleSide, vertexShader: P.vs, fragmentShader: P.fs });
  const plain = make({});
  return { cut: make({ SB_CUT: '' }), plain, solid: P.holes ? make({ SB_SOLID: '' }) : plain };
}

/**
 * Can the cut's cone (sbCut) reach any of the boxes in `box`'s first n numbers (x0, y0, z0, x1, y1, z1 each): every point it cuts is within
 * its radius at its far end (SKY_CUT_PAST past the bus) of the line from the lens there, so a box that line misses, grown by that and by
 * `slack`, has nothing in it.
 */
function cutReaches(box: Float32Array, n: number, cx: number, cy: number, cz: number, bx: number, by: number, bz: number, w: number, slack: number): boolean {
  const lb = Math.hypot(bx - cx, by - cy, bz - cz);
  if (!(w > 0) || lb < 1e-3) return false;
  const L = lb + SKY_CUT_PAST, s = L / lb;
  const d0 = (bx - cx) * s, d1 = (by - cy) * s, d2 = (bz - cz) * s;
  const r = L * Math.min(w, SKY_CUT_R / lb) + slack;
  for (let i = 0; i < n; i += 6) {
    // (the line from the lens, t 0..1, clipped to the grown box axis by axis)
    let t0 = 0, t1 = 1;
    for (let a = 0; a < 3 && t0 <= t1; a++) {
      const c = a === 0 ? cx : a === 1 ? cy : cz, d = a === 0 ? d0 : a === 1 ? d1 : d2;
      const lo = box[i + a] - r, hi = box[i + a + 3] + r;
      if (Math.abs(d) < 1e-9) {
        if (c < lo || c > hi) t1 = -1;
        continue;
      }
      const u = (lo - c) / d, v = (hi - c) / d;
      t0 = Math.max(t0, Math.min(u, v));
      t1 = Math.min(t1, Math.max(u, v));
    }
    if (t0 <= t1) return true;
  }
  return false;
}

/**
 * A built set piece: its mesh (hidden until `start`; the parts that HOLE in a mesh of their own in it), its triangles, where it stands on the
 * ground and its risers (Built).
 */
export interface SkyPiece {
  mesh: THREE.Mesh;
  tris: number;
  /** its highest point (m, world y): its parts' boxes, smoke and corona included, and its risers' */
  top: number;
  /** its parts' boxes (x0, y0, z0, x1, y1, z1 each, m), formed: the aim's line of fire through the piece takes the heart (Lift.skyHit) */
  boxes: Float32Array;
  feet: Array<[number, number]>;
  cols: number[][];
  start(t: number): void;
  /** the heart's crack at t (game s): it shudders and stays 4 m lower; a heal (`t` 1e9) puts it back */
  crack(t: number): void;
  /** the heart's fall at t, down to `ground` (m): it draws in its cut program from then (its parts leave the boxes the cut was tried on) */
  fall(t: number, ground: number): void;
  /**
   * where the bus and the lens are as the frame is drawn (m): the piece isn't drawn between the lens and it (the shaders' sbCut), and draws in
   * its cut program only while the cut's cone can reach it
   */
  bus(x: number, y: number, z: number, cam: THREE.Vector3): void;
}

/**
 * The faction's set piece over the place, built a part a frame: `step()` builds the next (an island, a fall or a column: a few ms, where the
 * whole was 120-280 ms in one frame for the Sky Wood) and gives the piece once it's whole. Null for a faction with none.
 */
export function makeSkyPiece(faction: number, place: SkyPlace): { step(): SkyPiece | null } | null {
  const P = PIECES[faction];
  if (!P) return null;
  const g = new Geo();
  const it = P.geo(place, g);
  return {
    step: () => {
      const r = it.next();
      return r.done ? finish(faction, place, g, r.value) : null;
    },
  };
}

function finish(faction: number, place: SkyPlace, g: Geo, { R: size, Y, feet, cols, colsGone = Infinity }: Built): SkyPiece {
  const { cut, plain, solid } = materials(faction);
  (cut.uniforms.uSkyC.value as THREE.Vector4).set(place.heart[0], Y, place.heart[1], size);
  if (faction === FACTION_ELDERWOOD) {
    // (each island's centre, its pieces moved about it, and its rise: the same isles() elderwoodGeo built them from)
    const v = cut.uniforms.uIsles.value as THREE.Vector4[];
    isles(place).forEach(({ x, y, z, rise }, i) => v[i].set(x, y, z, rise));
  }
  // where it can be drawn: its parts' boxes, and each riser's between each two of its heights, grown by their reach (and 1 m: its bend between)
  // (the risers' after the parts': once they're gone only the parts' are tried)
  const boxes = g.boxes.slice(), parts = boxes.length;
  for (const c of cols)
    for (let k = 0; k + 7 < c.length; k += 4) {
      const r = Math.max(c[k + 3], c[k + 7]) + 1;
      boxes.push(Math.min(c[k], c[k + 4]) - r, Math.min(c[k + 1], c[k + 5]) - r, Math.min(c[k + 2], c[k + 6]) - r);
      boxes.push(Math.max(c[k], c[k + 4]) + r, Math.max(c[k + 1], c[k + 5]) + r, Math.max(c[k + 2], c[k + 6]) + r);
    }
  const reach = new Float32Array(boxes);
  let top = -Infinity;
  for (let i = 4; i < reach.length; i += 6) top = Math.max(top, reach[i]);
  const geo = g.build(), holes = PIECES[faction].holes;
  const mesh = new THREE.Mesh(geo, solid);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  // (the parts that HOLE: one more draw, so the rest draw in the solid program out of the cut)
  const apart = holes ? new THREE.Mesh(g.split(geo, holes), plain) : null;
  if (apart) {
    apart.frustumCulled = false;
    // (after the rest whatever their programs, as they were in one draw: where a lane's side meets its lane, the side)
    apart.renderOrder = 2;
    mesh.add(apart);
  }
  const b = cut.uniforms.uSkyBus.value as THREE.Vector4;
  return {
    mesh,
    tris: g.idx.length / 3,
    top,
    boxes: reach.subarray(0, parts),
    feet,
    cols,
    start: (t: number) => {
      cut.uniforms.uSkyT0.value = t;
    },
    crack: (t: number) => {
      cut.uniforms.uSkyCrack.value = t;
    },
    fall: (t: number, ground: number) => {
      (cut.uniforms.uSkyFall.value as THREE.Vector2).set(t, ground);
    },
    bus: (x: number, y: number, z: number, cam: THREE.Vector3) => {
      b.x = x;
      b.y = y;
      b.z = z;
      // (the lens as the frame is drawn, Lift.lens: 4 m of slack for the pipeline's snapped copy of it, a pixel off)
      const n = (cut.uniforms.uTime.value as number) - (cut.uniforms.uSkyT0.value as number) >= colsGone ? parts : reach.length;
      // (through the heart's fall, the cut program whatever the boxes say: they're where it stood formed, and the solid one would draw it over the bus)
      const cuts = (cut.uniforms.uSkyFall.value as THREE.Vector2).x < 1e8 || cutReaches(reach, n, cam.x, cam.y, cam.z, x, y, z, b.w, 4);
      mesh.material = cuts ? cut : solid;
      if (apart) apart.material = cuts ? cut : plain;
    },
  };
}

/** Shader warm-up (render/warmup.ts): the faction's piece in its layout, one triangle, in each of its programs. */
export function registerSkyWarm(faction: number) {
  if (!PIECES[faction]) return;
  registerWarm('liftsky', () => {
    const g = new Geo();
    for (let i = 0; i < 3; i++) g.v(i, 0, 0, 0, 1, 0, [0], [0]);
    g.tri(0, 1, 2);
    const geo = g.build(), { cut, plain, solid } = materials(faction);
    return [cut, plain, solid].filter((m, i, all) => all.indexOf(m) === i).map((m) => new THREE.Mesh(geo, m));
  });
}

// ---------------------------------------------------------------- the far sign: the block's light over the heart

// &lifted (LIFT.md, "Taking the block"): a column of the block's faction's light over the heart, seen from across the city, so the block is
// something to fly to from the Golden Gate. One draw, one program for all five (the faction is a uniform), two triangles turned to the lens
// about the vertical, at least BEAM.wMin m and BEAM.px game pixels wide. It writes the G-buffer as the pieces do, no blending, with no
// outline (a line three pixels wide would be all ink). Its foot stands over the sky piece's top once the piece forms, so it never stands out
// of the piece as its stalk.

/** each faction's six bands up the beam: its breath's colours (FACTION_LOOKS' spray), its black glass as its trim (a light can't be black) */
const BEAM_BANDS = FACTION_LOOKS.flatMap((l) => l.spray.map((r) => (r === Ramp.OBSIDIAN ? l.trim : r)));

const BEAM_VS = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uBeamC; // the heart x, its ground, the heart z, the top (m over the ground)
uniform vec3 uBeamLo; // the foot (m over the ground): from x to y over BEAM.ease s from z
uniform vec2 uBeamT; // its rise from the foot up (x) and its drain from the top down (y), each over BEAM.drain s (game clock)
out vec3 vWorldPos;
out vec2 vB; // across (-1..1), how far up the whole column (0..1)
out float vY; // m over the ground
void main() {
  float lo = mix(uBeamLo.x, uBeamLo.y, smoothstep(uBeamLo.z, uBeamLo.z + ${F(BEAM.ease)}, uTime));
  float hi = uBeamC.w;
  float top = lo + (hi - lo) * clamp((uTime - uBeamT.x) / ${F(BEAM.drain)}, 0.0, 1.0) * (1.0 - clamp((uTime - uBeamT.y) / ${F(BEAM.drain)}, 0.0, 1.0));
  if (top < lo + 0.5) { ${HIDE} }
  float y = lo + (top - lo) * position.y;
  vec2 to = cameraPosition.xz - uBeamC.xz;
  float d = max(length(to), 1.0);
  // (BEAM.px game pixels at its distance across the lens: projectionMatrix[0][0] is 1 / tan of half the horizontal lens; liftGlsl's beamWidth)
  float w = max(${F(BEAM.wMin)}, ${F(BEAM.px * 2)} * d / (projectionMatrix[0][0] * ${F(config.render.pixelWidth)}));
  vec3 p = vec3(uBeamC.x - to.y / d * position.x * w * 0.5, uBeamC.y + y, uBeamC.z + to.x / d * position.x * w * 0.5);
  vWorldPos = p;
  vB = vec2(position.x, (y - lo) / max(hi - lo, 1.0));
  vY = y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const BEAM_FS = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uBeamC;
uniform float uBeamFac; // whose light (game/factions.ts)
in vec3 vWorldPos;
in vec2 vB;
in float vY;
${GLSL_OUT}
const float SB_BEAM[${BEAM_BANDS.length}] = float[${BEAM_BANDS.length}](${BEAM_BANDS.map((r) => r.toFixed(1)).join(', ')});
void main() {
  float h = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  // (gone by a dither as the lens nears the heart, and over its top's share)
  float keep = smoothstep(${F(BEAM.fadeNear)}, ${F(BEAM.fadeFar)}, length(cameraPosition.xz - uBeamC.xz)) * (1.0 - smoothstep(${F(1 - BEAM.top)}, 1.0, vB.y));
  if (h >= keep) discard;
  int f = clamp(int(uBeamFac + 0.5), 0, ${FACTION_ROOM});
  // its hues in bands drifting up; a core of its brightest step, its edges a step lower; one pulse of a step running up it
  int b = int(mod(floor((vY - uTime * ${F(BEAM.drift)}) / ${F(BEAM.band)}), 6.0));
  bool core = abs(vB.x) < 0.34;
  float light = core ? 0.92 : 0.78;
  float glow = core ? 0.85 : 0.6;
  if (abs(vY - mod(uTime, ${F(BEAM.pulse)}) / ${F(BEAM.pulse)} * uBeamC.w) < 24.0) light = min(1.0, light + 0.143);
  sbWrite(SB_BEAM[f * 6 + b], light, sbFog(vWorldPos), glow, vec3(0.0, 0.0, 1.0), 0.71, 0.5);
}
`;

function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...globals,
      uBeamC: { value: new THREE.Vector4(0, 0, 0, BEAM.hi) },
      uBeamLo: { value: new THREE.Vector3(BEAM.lo, BEAM.lo, -1e9) },
      uBeamT: { value: new THREE.Vector2(-1e9, 1e9) },
      uBeamFac: { value: FACTION_RAINBOW },
    },
    side: THREE.DoubleSide,
    vertexShader: BEAM_VS,
    fragmentShader: BEAM_FS,
  });
}

function beamGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** The block's light over the heart (a mesh for the scene) and what moves it. */
export interface Beam {
  mesh: THREE.Mesh;
  /** the heart's ground (m), once its tiles are in */
  ground(y: number): void;
  /** the sky piece's top (m, world y): from `t` the foot eases up to it plus BEAM.over */
  foot(top: number, t: number): void;
  /** it drains from the top down from `t` (the heart's fall) */
  drain(t: number): void;
  /** it rises again from BEAM.lo in `faction`'s colours from `t` (the heart's flip: nothing compiles, the faction is a uniform) */
  relight(faction: number, t: number): void;
}

/** The far sign for `faction`'s block over `heart` (x, z), its ground `groundY` as known now. */
export function makeBeam(faction: number, heart: [number, number], groundY: number): Beam {
  const m = beamMaterial(), u = m.uniforms;
  const c = u.uBeamC.value as THREE.Vector4, lo = u.uBeamLo.value as THREE.Vector3, tt = u.uBeamT.value as THREE.Vector2;
  c.set(heart[0], groundY, heart[1], BEAM.hi);
  u.uBeamFac.value = faction;
  const mesh = new THREE.Mesh(beamGeometry(), m);
  mesh.frustumCulled = false;
  return {
    mesh,
    ground: (y) => {
      c.y = y;
    },
    foot: (top, t) => {
      lo.set(BEAM.lo, Math.max(BEAM.lo, top - c.y + BEAM.over), t);
    },
    drain: (t) => {
      tt.y = t;
    },
    relight: (f, t) => {
      u.uBeamFac.value = f;
      lo.set(BEAM.lo, BEAM.lo, -1e9);
      tt.set(t, 1e9);
    },
  };
}

/** Shader warm-up (render/warmup.ts): the beam's one program, on every ?lift&lifted page. */
export function registerBeamWarm() {
  registerWarm('liftbeam', () => [new THREE.Mesh(beamGeometry(), beamMaterial())]);
}
