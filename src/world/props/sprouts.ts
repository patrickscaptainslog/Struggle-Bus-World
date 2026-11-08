import * as THREE from 'three';
import { globals, GLSL_COMMON, GLSL_OUT, SHADOW_LAYER } from '../../render/materials';
import { FACTION_RAINBOW, FACTION_ROOM } from '../../game/factions';
import { Ramp } from '../../render/palette';
import { registerWarm } from '../../render/warmup';
import { GLSL_MOON_CURVE, moonLow, moonOnly } from '../../sky/flag';
import { DEPTH_FS, GLSL_PROPS, PartKit, propsTune, rng, tuneUniform, unitSphere } from './common';
import { GLSL_LIFT, lifted, liftOn } from '../liftGlsl';
import { liftUniforms, paintUniforms } from '../buildingMaterial';
import { GLSL_POGO, pogoed, pogoOn, pogoUniforms } from '../pogo';

// Rooftop sprouts: what painted buildings grow. Level 1 = flower tufts along
// the roof edge, level 2 = a rooftop garden (turf, bushes, a little tree,
// flower boxes), level 3 = full Hundertwasser (golden onion dome or ball
// spire, more trees, rainbow bunting). The layout is computed once per
// building on the CPU (cheap, deterministic, scaled with roof area); every
// element springs up in the vertex shader from its start time and then
// sways forever, so thousands of sprouts cost no per-frame CPU at all.
//
// One InstancedMesh per element type (8 draw calls for the whole city),
// plus depth twins for the few that cast sun shadows.

const enum Part {
  FOLIAGE = 0,
  BLOSSOM = 1,
  BLOSSOM2 = 2,
  WOOD = 3,
  GOLD = 4,
  WHITE = 5,
  BODY = 6,
  BODY2 = 7,
  TURF = 8,
}

const enum T {
  TUFT = 0,
  BUSH = 1,
  TREE = 2,
  PLANTER = 3,
  DOME = 4,
  SPIRE = 5,
  FLAG = 6,
  TURF = 7,
  CRYSTAL = 8,
}

/** What can be laid out by hand (RoofSprouts.place). CRYSTAL only under ?moon. */
export const SPROUT = { TUFT: T.TUFT, BUSH: T.BUSH, TREE: T.TREE, DOME: T.DOME, SPIRE: T.SPIRE, FLAG: T.FLAG, CRYSTAL: T.CRYSTAL } as const;

interface TypeDef {
  geo: () => THREE.BufferGeometry;
  cast: boolean;
  doubleSide?: boolean;
  /** sway frequency (Hz-ish), local sway direction weights, cull distance (x propsTune.sproutCull), amplitude tune key */
  freq: number;
  dir: [number, number];
  cull: number;
  tune: 'sproutSway' | 'flagFlutter';
  /** initial instances per city cell (grows) */
  capacity: number;
  /** where its small growth has shrunk away (x propsTune.sproutCull) and its far form takes over: about 2 game pixels, a head or a blossom, at 24 degrees (street only) */
  core?: number;
}

// ---------------------------------------------------------------- geometry

let _octa0: THREE.BufferGeometry | null = null;
const octa0 = () => (_octa0 ??= unitSphere('octa0'));
const swayY = (h: number) => (_x: number, y: number) => Math.max(0, Math.min(1, y / h)) ** 2;

/** A small-growth piece's part, as the vertices carry it: the part plus this (the shader takes it off) */
const EXTRA = 16;

/**
 * A kit whose pieces made in x() are a garden's small growth: past its type's core reach they shrink away into their own middles, and the
 * far form (userData.core: the triangles left, the same vertices) is drawn without them. The near form's triangles are the kit's as ever.
 */
class CoreKit extends PartKit {
  private ex: Array<[number, number, number, number]> = [];
  x(fn: () => void) {
    const v0 = this.pos.length / 3, i0 = this.idx.length;
    fn();
    this.ex.push([v0, this.pos.length / 3, i0, this.idx.length]);
  }
  build(): THREE.BufferGeometry {
    for (const [v0, v1] of this.ex) for (let v = v0; v < v1; v++) this.part[v] += EXTRA;
    const g = super.build();
    const core: number[] = [];
    for (let i = 0; i < this.idx.length; i += 3) if (!this.ex.some(([, , a, b]) => i >= a && i < b)) core.push(this.idx[i], this.idx[i + 1], this.idx[i + 2]);
    g.userData.core = core;
    return g;
  }
}

function tuftGeo(): THREE.BufferGeometry {
  const k = new CoreKit();
  const s = swayY(0.85);
  k.blob(octa0(), 0, 0.2, 0, 0.64, 0.5, 0.64, Part.FOLIAGE, s);
  const heads: Array<[number, number, number, number, number]> = [
    [0.3, 0.58, 0.12, 0.28, Part.BLOSSOM],
    [-0.28, 0.55, 0.1, 0.27, Part.BLOSSOM2],
    [0.02, 0.62, -0.3, 0.28, Part.BLOSSOM],
    [0.04, 0.76, 0.04, 0.24, Part.BLOSSOM],
  ];
  // (the far form keeps its leaves and two heads, both its hues)
  heads.forEach(([x, y, z, r, p], i) => (i === 1 || i === 3 ? k.blob(octa0(), x, y, z, r, r, r, p, s) : k.x(() => k.blob(octa0(), x, y, z, r, r, r, p, s))));
  return k.build();
}

function bushGeo(): THREE.BufferGeometry {
  const k = new CoreKit();
  const s = swayY(1.7);
  k.blob(octa0(), 0, 0.72, 0, 1.0, 0.82, 1.0, Part.FOLIAGE, s);
  k.blob(octa0(), 0.8, 0.5, 0.3, 0.72, 0.6, 0.72, Part.FOLIAGE, s);
  k.blob(octa0(), -0.62, 0.55, -0.44, 0.74, 0.62, 0.74, Part.FOLIAGE, s);
  k.x(() => k.blob(octa0(), -0.22, 0.45, 0.72, 0.62, 0.52, 0.62, Part.FOLIAGE, s));
  const b: Array<[number, number, number, number]> = [
    [0.45, 1.3, 0.2, Part.BLOSSOM],
    [-0.42, 1.24, -0.3, Part.BLOSSOM2],
    [0.08, 1.5, -0.18, Part.BLOSSOM],
    [0.95, 0.88, 0.5, Part.BLOSSOM],
    [-0.72, 0.98, 0.32, Part.BLOSSOM2],
    [-0.2, 0.8, 1.05, Part.BLOSSOM],
  ];
  // (the far form: three clumps and two blossoms, both hues)
  b.forEach(([x, y, z, p], i) => (i < 2 ? k.blob(octa0(), x, y, z, 0.24, 0.24, 0.24, p, s) : k.x(() => k.blob(octa0(), x, y, z, 0.24, 0.24, 0.24, p, s))));
  return k.build();
}

function treeGeo(): THREE.BufferGeometry {
  const k = new CoreKit();
  const s = swayY(4.4);
  k.box(0, 1.3, 0, 0.42, 2.6, 0.42, Part.WOOD, s);
  k.blob(octa0(), 0, 3.05, 0, 1.45, 1.25, 1.45, Part.FOLIAGE, s);
  k.x(() => k.blob(octa0(), 0.85, 2.72, 0.35, 1.02, 0.9, 1.02, Part.FOLIAGE, s));
  k.blob(octa0(), -0.7, 3.32, -0.48, 1.06, 0.95, 1.06, Part.FOLIAGE, s);
  k.blob(octa0(), 0.12, 3.98, 0.1, 0.92, 0.82, 0.92, Part.FOLIAGE, s);
  const b: Array<[number, number, number, number]> = [
    [0.7, 3.6, 0.6, Part.BLOSSOM],
    [-0.9, 3.75, 0.2, Part.BLOSSOM2],
    [0.3, 4.6, -0.3, Part.BLOSSOM],
    [1.45, 2.9, -0.2, Part.BLOSSOM],
    [-0.5, 2.6, 1.1, Part.BLOSSOM2],
    [0.0, 3.2, -1.35, Part.BLOSSOM],
  ];
  // (the far form: the trunk, three clumps and two blossoms, both hues)
  b.forEach(([x, y, z, p], i) => (i < 2 ? k.blob(octa0(), x, y, z, 0.26, 0.26, 0.26, p, s) : k.x(() => k.blob(octa0(), x, y, z, 0.26, 0.26, 0.26, p, s))));
  return k.build();
}

function planterGeo(): THREE.BufferGeometry {
  const k = new CoreKit();
  const s = (_x: number, y: number) => (y > 0.5 ? 0.6 : 0);
  k.box(0, 0.27, 0, 2.4, 0.56, 0.72, Part.BODY2, () => 0);
  k.box(0, 0.58, 0, 2.5, 0.08, 0.8, Part.WHITE, () => 0);
  k.blob(octa0(), 0, 0.68, 0, 1.15, 0.26, 0.33, Part.FOLIAGE, s);
  // (the far form: the box, its leaves and two flowers, both hues)
  for (let i = 0; i < 6; i++) {
    const x = -0.95 + i * 0.38;
    const put = () => k.blob(octa0(), x, 0.84 + (i % 2) * 0.06, (i % 2 ? -0.1 : 0.12), 0.22, 0.22, 0.22, i % 2 ? Part.BLOSSOM2 : Part.BLOSSOM, s);
    if (i === 2 || i === 3) put();
    else k.x(put);
  }
  return k.build();
}

function lathe(points: Array<[number, number]>, segs: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segs,
  );
  g.deleteAttribute('uv');
  return g;
}

function domeGeo(): THREE.BufferGeometry {
  const k = new PartKit();
  const s = swayY(5);
  const id = new THREE.Matrix4();
  k.add(lathe([[1.16, -0.1], [1.16, 1.28]], 10), id, Part.BODY, s);
  k.add(lathe([[1.16, 1.28], [1.34, 1.3], [1.34, 1.5], [1.18, 1.53]], 10), id, Part.WHITE, s);
  k.add(
    lathe(
      [
        [1.18, 1.53],
        [1.46, 1.86],
        [1.63, 2.3],
        [1.6, 2.76],
        [1.38, 3.2],
        [1.0, 3.6],
        [0.6, 3.95],
        [0.3, 4.3],
        [0.13, 4.62],
        [0.0, 4.72],
      ],
      10,
    ),
    id,
    Part.GOLD,
    s,
  );
  k.blob(octa0(), 0, 4.9, 0, 0.3, 0.3, 0.3, Part.GOLD, s);
  return k.build();
}

function spireGeo(): THREE.BufferGeometry {
  const k = new PartKit();
  const s = swayY(7);
  k.box(0, 0.3, 0, 0.95, 0.6, 0.95, Part.WHITE, s);
  k.box(0, 3.25, 0, 0.44, 5.6, 0.44, Part.BODY, s);
  k.blob(octa0(), 0, 4.15, 0, 0.46, 0.46, 0.46, Part.BODY2, s);
  k.blob(octa0(), 0, 6.65, 0, 0.8, 0.8, 0.8, Part.GOLD, s);
  return k.build();
}

function flagGeo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -0.9, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute([Part.BODY, Part.BODY, Part.BODY], 1));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute([0, 0, 1], 1));
  g.setAttribute('aBlobC', new THREE.Float32BufferAttribute(new Float32Array(12), 4));
  g.setAttribute('aBlobR', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  g.setIndex([0, 2, 1]);
  g.computeBoundingSphere();
  return g;
}

function turfGeo(): THREE.BufferGeometry {
  const k = new PartKit();
  k.box(0, 0.06, 0, 1, 0.32, 1, Part.TURF, () => 0);
  return k.build();
}

/** A shard's facets are what catch the Sun: a sharp thing, flat shaded, on a stump of its own. */
function shard(h: number, w: number): THREE.BufferGeometry {
  const g = lathe([[w * 0.75, 0], [w, h * 0.16], [w * 0.8, h * 0.72], [0, h]], 4).toNonIndexed();
  g.computeVertexNormals();
  return g;
}

function crystalGeo(): THREE.BufferGeometry {
  const k = new PartKit();
  const none = () => 0;
  const put = (h: number, w: number, x: number, z: number, tiltX: number, tiltZ: number, yaw: number, part: Part) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, -0.15, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ)), new THREE.Vector3(1, 1, 1));
    k.add(shard(h, w), m, part, none);
  };
  put(3.4, 0.62, 0, 0, 0.06, 0.05, 0.3, Part.BODY);
  put(2.3, 0.46, 0.62, 0.22, 0.12, -0.4, 1.1, Part.BODY2);
  put(1.8, 0.4, -0.55, 0.36, 0.26, 0.42, 0.2, Part.BODY);
  put(1.3, 0.34, 0.1, -0.62, -0.46, 0.08, 0.7, Part.BODY2);
  return k.build();
}

const TYPES: TypeDef[] = [
  { geo: tuftGeo, cast: false, freq: 1.9, dir: [1, 0.6], cull: 0.45, tune: 'sproutSway', capacity: 256, core: 0.25 },
  { geo: bushGeo, cast: true, freq: 1.3, dir: [1, 0.6], cull: 0.75, tune: 'sproutSway', capacity: 64, core: 0.3 },
  { geo: treeGeo, cast: true, freq: 1.05, dir: [1, 0.6], cull: 1.0, tune: 'sproutSway', capacity: 32, core: 0.35 },
  { geo: planterGeo, cast: false, freq: 1.7, dir: [0.3, 1], cull: 0.45, tune: 'sproutSway', capacity: 32, core: 0.25 },
  { geo: domeGeo, cast: true, freq: 0.8, dir: [1, 0.7], cull: 1.6, tune: 'sproutSway', capacity: 16 },
  { geo: spireGeo, cast: true, freq: 0.9, dir: [1, 0.7], cull: 1.6, tune: 'sproutSway', capacity: 32 },
  { geo: flagGeo, cast: false, doubleSide: true, freq: 4.6, dir: [0.25, 1], cull: 0.5, tune: 'flagFlutter', capacity: 128 },
  { geo: turfGeo, cast: false, freq: 0, dir: [0, 0], cull: 0.9, tune: 'sproutSway', capacity: 32 },
  ...(moonLow ? ([{ geo: crystalGeo, cast: true, freq: 0, dir: [0, 0], cull: 1.2, tune: 'sproutSway', capacity: 128 }] satisfies TypeDef[]) : []),
];

// ---------------------------------------------------------------- shaders

const SPROUT_VERTEX = /* glsl */ `${lifted(`
${GLSL_LIFT}`)}${liftOn || pogoOn ? `
in vec2 aLiftB;  // ?lift and &bomb: the building it grows on, and its roof over that building's ground (-1: none)` : ''}${pogoed(`${GLSL_POGO}
uniform sampler2D uPaint;
uniform float uPaintW;`)}
in float aPart;
in float aSway;
in vec4 aBlobC;
in vec3 aBlobR;
uniform vec4 uKind;    // freq, dirX, dirZ, cull distance factor (0 = never cull)
uniform float uAmpMul;
uniform float uCull;${moonLow ? '' : `
uniform vec3 uEye;     // the view's lens, both passes: a garden's shadow goes as it does (RoofSprouts.update)
uniform float uReach;  // the budget's hold on every reach (1: as tuned)
uniform float uCore;   // where the small growth has shrunk away (x uCull; 0: none), and the far form takes over`}${moonOnly(`
uniform vec2 uSlide;   // the map's slides so far: a plant's sway is where it stands, not where the map's middle is`)}
struct SproutV { vec4 world; vec3 normal; vec3 local; vec3 blobC; vec3 blobR; float hue; float seed; float part; bool hidden; };
SproutV sproutVertex() {
  // (every field set, one return: D3D's compiler warns of an uninitialized result on an early return of a struct)
  SproutV o = SproutV(vec4(0.0), vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), 0.0, 0.0, 0.0, false);
  vec3 ic = vec3(0.0, 0.0, 1e9);
  #ifdef USE_INSTANCING_COLOR
  ic = instanceColor;
  #endif
  o.hue = floor(ic.x);
  o.seed = clamp(fract(ic.x) / 0.9, 0.0, 1.0);
  // (a small-growth piece carries its part plus ${EXTRA}: CoreKit)
  bool extra = aPart > ${EXTRA - 0.5};
  o.part = extra ? aPart - ${EXTRA}.0 : aPart;
  o.normal = normal;
  float t = uTime - ic.z;
  vec3 ipos = instanceMatrix[3].xyz;
${
    moonLow
      ? `o.hidden = t <= 0.0 || (uKind.w > 0.0 && distance(cameraPosition, ipos) > uCull * uKind.w * max(1.0, length(instanceMatrix[1].xyz)));`
      : `// (out at its reach it has shrunk away, over the last fifth: nothing pops at the edge, and past it the CPU stops drawing it)
  float fade = 1.0, fx = 1.0;
  if (uKind.w > 0.0) {
    float R = uCull * uKind.w * uReach, dd = distance(uEye, ipos);
    fade = 1.0 - smoothstep(R * 0.8, R, dd);
    if (extra && uCore > 0.0) {
      float Rc = uCull * uCore * uReach;
      fx = 1.0 - smoothstep(Rc * 0.8, Rc, dd);
    }
  }
  o.hidden = t <= 0.0 || fade <= 0.0;`
  }
  if (!o.hidden) {
  // spring up out of the roof: grow with overshoot, stretch while growing, squash on landing
  float g = propGrow(t);${moonLow ? '' : `
  if (fade < 1.0) g *= fade;`}
  float st = 0.34 * exp(-5.0 * t) * sin(11.0 * t);
  vec3 sc = vec3(g * (1.0 - 0.5 * st), g * (1.0 + st), g * (1.0 - 0.5 * st));
  vec3 p = position * sc;
  vec3 c = aBlobC.xyz * sc;${moonLow ? '' : `
  // (a small-growth piece shrinks into its own middle, and is gone before the far form takes over)
  if (fx < 1.0) p = c + (p - c) * fx;`}
  // painted things move: gentle sway (plants), flutter (bunting), wobble (domes)
  float ph = dot(ipos.xz${moonOnly(' + uSlide')}, vec2(0.11, 0.07)) + o.seed * 6.283;
  float a = ic.y * uAmpMul * smoothstep(0.15, 0.9, t);
  vec3 sw = vec3(uKind.y * sin(uTime * uKind.x + ph), 0.0, uKind.z * sin(uTime * uKind.x * 1.37 + ph * 1.9)) * a;
  p += sw * aSway;
  c += sw * aBlobC.w;
  o.local = p;
  o.blobC = c;
  o.blobR = aBlobR * sc${moonLow ? '' : ' * fx'};
  o.world = modelMatrix * (instanceMatrix * vec4(p, 1.0));${lifted(`
  // (a garden rides its floating house: the house's lift, its stretch at the roof's height, and its lean about its belly's middle)
  if (aLiftB.x >= 0.0) {
    vec4 lT2;
    vec4 lf = sbLift(aLiftB.x, ipos.xz, lT2);
    o.world.y += lf.x + aLiftB.y * lf.y;
    vec3 piv = vec3(lT2.x, lT2.y + lf.x, lT2.z);
    o.world.xyz = piv + sbTilt(o.world.xyz - piv, lf.zw);
  }`)}${pogoed(`
  // (&bomb: a Bomb's stage hops its house, world/pogo.ts, and the garden rides the hop. Its paint is read only in the Bomb's circle while its pops last, not by
  // every garden every frame)
  if (aLiftB.x >= 0.0 && uBombPogo.w > 0.0 && uTime <= uBombPogoT.x + uBombPogoT.y + 0.05 && distance(ipos.xz, uBombPogo.xy) <= uBombPogo.z) {
    vec4 pt = texelFetch(uPaint, ivec2(int(mod(aLiftB.x, uPaintW)), int(floor(aLiftB.x / uPaintW))), 0);
    float tr;
    if (pt.g > 0.5 && uTime >= pt.b) o.world.y += sbPogo(ipos.xz, pt.b, aLiftB.y, uTime - pt.b, tr);
  }`)}
  }
  return o;
}
`;

const SPROUT_VS = /* glsl */ `
${GLSL_COMMON}
${GLSL_PROPS}
${SPROUT_VERTEX}${moonOnly(GLSL_MOON_CURVE)}
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vLocal;
flat out vec3 vInfo; // hue + 8 * (faction - 1), seed, part
flat out vec3 vBlobC;
flat out vec3 vBlobR;
flat out vec3 vCamLocal;
flat out vec4 vXf;   // instance yaw (cos, sin) + scale xz
flat out float vSy;
flat out vec3 vIPos;
void main() {
  SproutV s = sproutVertex();
  if (s.hidden) { gl_Position = vec4(0.0, 0.0, -10.0, 1.0); return; }
  vWorldPos = s.world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * s.normal));
  vInfo = vec3(s.hue, s.seed, s.part);
  vLocal = s.local;
  vBlobC = s.blobC;
  vBlobR = s.blobR;
  // camera in the element's own frame (instances are yaw + scale; the group sits at the origin)
  vec3 sx = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 rel = cameraPosition - instanceMatrix[3].xyz;
  vCamLocal = vec3(dot(rel, instanceMatrix[0].xyz / sx.x), dot(rel, instanceMatrix[1].xyz / sx.y), dot(rel, instanceMatrix[2].xyz / sx.z)) / sx;
  vXf = vec4(instanceMatrix[0].x / sx.x, -instanceMatrix[0].z / sx.x, sx.x, sx.z);
  vSy = sx.y;
  vIPos = instanceMatrix[3].xyz;
  gl_Position = projectionMatrix * viewMatrix * ${moonLow ? 'vec4(moonCurve(s.world.xyz), 1.0)' : 's.world'};
}
`;

const SPROUT_DEPTH_VS = /* glsl */ `
precision highp float;
uniform float uTime;
${GLSL_PROPS}
${SPROUT_VERTEX}
void main() {
  SproutV s = sproutVertex();
  if (s.hidden) { gl_Position = vec4(0.0, 0.0, -10.0, 1.0); return; }
  gl_Position = projectionMatrix * viewMatrix * s.world;
}
`;

const SPROUT_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_PROPS}
uniform float uLeafEdge;${moonOnly(`
uniform vec2 uSlide;`)}
in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vLocal;
flat in vec3 vInfo;
flat in vec3 vBlobC;
flat in vec3 vBlobR;
flat in vec3 vCamLocal;
flat in vec4 vXf;
flat in float vSy;
flat in vec3 vIPos;
uniform mat4 projectionMatrix;
${GLSL_OUT}
// (whose garden it is, in the hue's eights: RoofSprouts.set. A flower can't be its leaves' colour: Rainbow's green turns gold)
int gFac = 1;
float bloomRamp(float h) {
  float r = propHueRamp(gFac, h, false);
  return r == sbFacLeaf(gFac) ? sbFacGold(gFac) : r;
}
void main() {
  float hue = mod(vInfo.x, 8.0);
  gFac = sbFac(1.0 + floor(vInfo.x / 8.0));
  float seed = vInfo.y;
  int part = int(vInfo.z + 0.5);
  vec3 n;
  vec3 wp = vWorldPos;
  if (vBlobR.x > 0.001) {
    // carve the blob polygon into a true (slightly leafy) ellipsoid, per pixel
    vec3 q = (vLocal - vBlobC) / vBlobR;
    vec3 v = normalize((vLocal - vCamLocal) / vBlobR);
    float qv = dot(q, v);
    float d2 = dot(q, q) - qv * qv;
    float rc = 1.0 - uLeafEdge * (part == ${Part.FOLIAGE} ? 0.7 : 0.0) * pNoise3(normalize(q) * 2.4 + seed * 11.0 + vBlobC * 3.1);
    if (d2 > rc * rc) discard;
    vec3 hit = q - v * (qv + sqrt(max(rc * rc - d2, 0.0)));
    vec3 nl = hit / vBlobR;
    // local -> world normal: inverse-transpose of yaw * scale
    nl /= vec3(vXf.z, vSy, vXf.w);
    n = normalize(vec3(vXf.x * nl.x + vXf.y * nl.z, nl.y, -vXf.y * nl.x + vXf.x * nl.z));
    // exact depth of the carved blob (clean round intersections)
    vec3 hl = (vBlobC + hit * vBlobR) * vec3(vXf.z, vSy, vXf.w);
    wp = vIPos + vec3(vXf.x * hl.x + vXf.y * hl.z, hl.y, -vXf.y * hl.x + vXf.x * hl.z);
    vec4 clip = projectionMatrix * (viewMatrix * vec4(wp, 1.0));
    gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  } else {
    n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    gl_FragDepth = gl_FragCoord.z;
  }
  float ramp = ${Ramp.GREEN}.0;
  float lo = 0.0;
  float glow = 0.0;
  // (the grain reads the place it's at: on the Moon, past the map's slides)
  vec3 grainAt = wp${moonOnly(' + vec3(uSlide.x, 0.0, uSlide.y)')};
  float nz = pNoise3(grainAt * 1.4 + seed * 13.0) - 0.5;
  if (part == ${Part.FOLIAGE}) { ramp = sbFacLeaf(gFac); lo = -0.03 + nz * 0.12; }
  else if (part == ${Part.TURF}) {
    ramp = sbFacLeaf(gFac);
    lo = -0.1 + (pNoise3(vec3((vWorldPos.xz${moonOnly(' + uSlide')}) * 0.45, seed * 9.0)) - 0.5) * 0.18;
  }
  else if (part == ${Part.BLOSSOM}) { ramp = bloomRamp(hue); lo = 0.13; }
  else if (part == ${Part.BLOSSOM2}) {
    float h2 = hue + 1.0;
    if (propHueRamp(gFac, h2, false) == sbFacLeaf(gFac)) h2 += 1.0;
    ramp = bloomRamp(h2);
    lo = 0.13;
  }
  else if (part == ${Part.WOOD}) { ramp = sbFacBark(gFac); lo = -0.2; }
  else if (part == ${Part.GOLD}) { ramp = sbFacGold(gFac); lo = 0.1; glow = 0.16; }
  else if (part == ${Part.WHITE}) { ramp = sbFacTrim(gFac); lo = -0.03; }
  else if (part == ${Part.BODY}) { ramp = propHueRamp(gFac, hue, true); lo = 0.02; }
  else { ramp = propHueRamp(gFac, hue + 2.0, false); lo = 0.0; }
  vec3 vn = normalize(mat3(viewMatrix) * n);
  if (part == ${Part.FOLIAGE}) lo -= 0.08 * smoothstep(0.65, 0.97, 1.0 - abs(vn.z));
  float light = sbLight(wp, n, lo, 1.0);
  light = max(light, glow);
  float fog = sbFog(wp);
  sbWrite(ramp, light, fog, glow, vn, fract(seed * 0.37 + float(part) * 0.113), 1.0);
}
`;

// ---------------------------------------------------------------- batches

/** Who holds a batch's slots: `at[k]` is the slot of its element k (-1: not drawn). A slot moves when another goes, and its holder is told. */
interface Holder {
  at: Int32Array;
}

/** One element's instance data, packed: its matrix (16), its colour (hue + seed, sway, start) and, ?lift, its building and roof height (2). */
const STRIDE = 21;
const _tmp = new Float32Array(STRIDE);

/**
 * One element type's instances in one city cell, kept dense: what's drawn is slots 0 to `live`, so an element that goes takes its triangles
 * with it (a hole drew its zeroed instance, and an element the shader hid still cost its triangles in the vertex stage). The sun pass draws
 * the first `sun` of them, the ones whose shadow can land in the sun's window: the rest are drawn in the view only.
 */
class Batch {
  mesh: THREE.InstancedMesh;
  caster: THREE.InstancedMesh | null = null;
  capacity: number;
  /** slots in use: none, and it draws nothing */
  live = 0;
  /** of them, the first this many cast (a caster type only) */
  sun = 0;
  private owner: Array<Holder | null>;
  private ownerK: Int32Array;
  /** ?lift: each slot's building and roof height over its ground (aLiftB), on a geometry of this batch's own that shares the type's buffers. Null with the flag off */
  lift: THREE.InstancedBufferAttribute | null = null;
  private liftGeo: THREE.BufferGeometry | null = null;

  constructor(
    readonly geo: THREE.BufferGeometry,
    readonly mat: THREE.ShaderMaterial,
    readonly depth: THREE.ShaderMaterial | null,
    capacity: number,
    readonly group: THREE.Group,
    readonly sphere: THREE.Sphere,
  ) {
    this.capacity = capacity;
    this.owner = new Array(capacity).fill(null);
    this.ownerK = new Int32Array(capacity);
    this.mesh = this.makeMesh(capacity, null, null);
  }

  private makeMesh(cap: number, oldM: Float32Array | null, oldC: Float32Array | null): THREE.InstancedMesh {
    let geo = this.geo;
    // (the building each garden grows on: the Lift's, and the Bomb's pogo, which it rides)
    if (liftOn || pogoOn) {
      // (a per-instance attribute lives on the geometry, and the type's geometry is every cell's: this batch's own shares its buffers, never disposed
      // as it would take them with it)
      const old = this.lift?.array as Float32Array | undefined;
      const a = new Float32Array(cap * 2).fill(-1);
      if (old) a.set(old);
      this.lift = new THREE.InstancedBufferAttribute(a, 2);
      this.lift.setUsage(THREE.DynamicDrawUsage);
      // (a new one each growth: the last one's own buffer and its vertex arrays go with it)
      this.dropLiftGeo();
      this.liftGeo = new THREE.BufferGeometry();
      for (const k in this.geo.attributes) this.liftGeo.setAttribute(k, this.geo.attributes[k]);
      this.liftGeo.setIndex(this.geo.index);
      this.liftGeo.boundingBox = this.geo.boundingBox;
      this.liftGeo.boundingSphere = this.geo.boundingSphere;
      this.liftGeo.setAttribute('aLiftB', this.lift);
      geo = this.liftGeo;
    }
    const mesh = new THREE.InstancedMesh(geo, this.mat, 0);
    const m = new Float32Array(cap * 16);
    const c = new Float32Array(cap * 3);
    if (oldM) m.set(oldM);
    if (oldC) c.set(oldC);
    for (let i = oldC ? oldC.length / 3 : 0; i < cap; i++) c[i * 3 + 2] = 1e9; // never sprouts
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(m, 16);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(c, 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = this.live;
    mesh.boundingSphere = this.sphere; // one city cell: frustum culled as a whole
    mesh.visible = this.live > 0; // no empty draws
    this.group.add(mesh);
    if (this.depth) {
      const cs = new THREE.InstancedMesh(geo, this.depth, 0);
      cs.instanceMatrix = mesh.instanceMatrix;
      cs.instanceColor = mesh.instanceColor;
      cs.count = this.sun;
      cs.boundingSphere = this.sphere;
      cs.visible = this.sun > 0;
      cs.layers.set(SHADOW_LAYER);
      this.group.add(cs);
      this.caster = cs;
    }
    return mesh;
  }

  private grow() {
    const old = this.mesh;
    const oldCaster = this.caster;
    this.capacity *= 2;
    const owner: Array<Holder | null> = new Array(this.capacity).fill(null);
    for (let i = 0; i < this.live; i++) owner[i] = this.owner[i];
    this.owner = owner;
    const k = new Int32Array(this.capacity);
    k.set(this.ownerK);
    this.ownerK = k;
    this.mesh = this.makeMesh(this.capacity, old.instanceMatrix.array as Float32Array, old.instanceColor!.array as Float32Array);
    old.removeFromParent();
    old.dispose();
    if (oldCaster) {
      oldCaster.removeFromParent();
      oldCaster.dispose();
    }
  }

  private counts() {
    this.mesh.count = this.live;
    this.mesh.visible = this.live > 0;
    if (this.caster) {
      this.caster.count = this.sun;
      this.caster.visible = this.sun > 0;
    }
  }

  private touch(s: number) {
    const im = this.mesh.instanceMatrix;
    im.addUpdateRange(s * 16, 16);
    im.needsUpdate = true;
    const ic = this.mesh.instanceColor!;
    ic.addUpdateRange(s * 3, 3);
    ic.needsUpdate = true;
    if (this.lift) {
      this.lift.addUpdateRange(s * 2, 2);
      this.lift.needsUpdate = true;
    }
  }

  /** Slot `from`'s instance goes to `to`, and its holder is told. */
  private move(from: number, to: number) {
    if (from === to) return;
    (this.mesh.instanceMatrix.array as Float32Array).copyWithin(to * 16, from * 16, from * 16 + 16);
    (this.mesh.instanceColor!.array as Float32Array).copyWithin(to * 3, from * 3, from * 3 + 3);
    if (this.lift) (this.lift.array as Float32Array).copyWithin(to * 2, from * 2, from * 2 + 2);
    const h = this.owner[from], k = this.ownerK[from];
    this.owner[to] = h;
    this.ownerK[to] = k;
    if (h) h.at[k] = to;
    this.owner[from] = null;
    this.touch(to);
  }

  /** A slot's whole instance, packed as a record. */
  read(s: number, out: Float32Array, o = 0) {
    out.set((this.mesh.instanceMatrix.array as Float32Array).subarray(s * 16, s * 16 + 16), o);
    out.set((this.mesh.instanceColor!.array as Float32Array).subarray(s * 3, s * 3 + 3), o + 16);
    if (this.lift) out.set((this.lift.array as Float32Array).subarray(s * 2, s * 2 + 2), o + 19);
    else out.fill(-1, o + 19, o + 21);
  }

  private swap(a: number, b: number) {
    if (a === b) return;
    const h = this.owner[a], k = this.ownerK[a];
    this.read(a, _tmp);
    this.move(b, a);
    this.owner[b] = h;
    this.ownerK[b] = k;
    if (h) h.at[k] = b;
    this.put(b, _tmp, 0);
  }

  /** A slot for element `k` of `h`, casting when `sun` (a caster type only): the end of the drawn ones, or of the casting ones. */
  alloc(h: Holder, k: number, sun = true): number {
    if (this.live >= this.capacity) this.grow();
    let s = this.live++;
    if (this.caster && sun) {
      // (the first that doesn't cast steps to the end: its place is the casting ones' new last)
      this.move(this.sun, s);
      s = this.sun++;
    }
    this.owner[s] = h;
    this.ownerK[s] = k;
    h.at[k] = s;
    this.counts();
    return s;
  }

  /** Slot `s` goes: the casting ones' last and then the drawn ones' last fill it, so both stay whole. */
  release(s: number) {
    const h = this.owner[s];
    if (h) h.at[this.ownerK[s]] = -1;
    this.owner[s] = null;
    if (this.caster && s < this.sun) {
      const ls = --this.sun;
      this.move(ls, s);
      s = ls;
    }
    this.move(--this.live, s);
    this.owner[this.live] = null;
    this.counts();
  }

  /** Slot `s` casts, or stops (a caster type only): it crosses into the casting ones, or out of them. */
  setSun(s: number, on: boolean) {
    if (!this.caster) return;
    if (on && s >= this.sun) this.swap(s, this.sun++);
    else if (!on && s < this.sun) this.swap(s, --this.sun);
    else return;
    this.counts();
  }

  /** Its holder's element `k` is now the one in slot `s` (a holder renumbered its elements). */
  rekey(s: number, k: number) {
    this.ownerK[s] = k;
  }

  write(slot: number, m: THREE.Matrix4, hue: number, seed: number, amp: number, start: number) {
    (this.mesh.instanceMatrix.array as Float32Array).set(m.elements, slot * 16);
    const c = this.mesh.instanceColor!.array as Float32Array;
    c[slot * 3] = hue + 0.9 * seed;
    c[slot * 3 + 1] = amp;
    c[slot * 3 + 2] = start;
    if (this.lift) (this.lift.array as Float32Array).fill(-1, slot * 2, slot * 2 + 1);
    this.touch(slot);
  }

  /** A slot's whole instance from a packed record (STRIDE floats at `o`). */
  put(slot: number, d: Float32Array, o: number) {
    (this.mesh.instanceMatrix.array as Float32Array).set(d.subarray(o, o + 16), slot * 16);
    (this.mesh.instanceColor!.array as Float32Array).set(d.subarray(o + 16, o + 19), slot * 3);
    if (this.lift) (this.lift.array as Float32Array).set(d.subarray(o + 19, o + 21), slot * 2);
    this.touch(slot);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    if (this.caster) {
      this.caster.removeFromParent();
      this.caster.dispose();
    }
    this.dropLiftGeo();
  }

  /** ?lift: this batch's geometry goes, its aLiftB buffer and vertex arrays with it, and never the type's buffers it shares (taken off it first). */
  private dropLiftGeo() {
    const g = this.liftGeo;
    if (!g) return;
    for (const k in this.geo.attributes) g.deleteAttribute(k);
    g.setIndex(null);
    g.dispose();
    this.liftGeo = null;
  }
}

// ---------------------------------------------------------------- layout

interface Elem {
  type: T;
  u: number;
  v: number;
  y: number;
  rot: number; // local yaw (radians, roof frame)
  sx: number;
  sy: number;
  sz: number;
  hue: number;
  amp: number;
  level: number; // minimum paint level that shows it
  delay: number;
  /** string direction in the roof frame (u, y, v) for bunting flags */
  dir?: [number, number, number];
}

export interface RoofRect {
  cx: number;
  cz: number;
  y: number;
  w: number;
  d: number;
  yaw: number;
  /** its building's ground (world y): a low sun throws its garden's shadow from the roof down to it */
  foot?: number;
}

const AMP: Record<T, number> = {
  [T.TUFT]: 0.1,
  [T.BUSH]: 0.13,
  [T.TREE]: 0.2,
  [T.PLANTER]: 0.06,
  [T.DOME]: 0.07,
  [T.SPIRE]: 0.11,
  [T.FLAG]: 0.26,
  [T.TURF]: 0,
  [T.CRYSTAL]: 0,
};

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Deterministic garden for one roof: every level's elements (filter by .level). */
function layoutRoof(seed: number, roof: RoofRect, hue: number): Elem[] {
  let hs = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  hs = Math.imul(hs ^ (hs >>> 13), 0xc2b2ae35);
  const R = rng((hs ^ (hs >>> 16)) >>> 0);
  const out: Elem[] = [];
  const w = Math.max(roof.w, 1.2);
  const d = Math.max(roof.d, 1.2);
  const hw = w / 2, hd = d / 2;
  const A = w * d;
  const minDim = Math.min(w, d);
  const discs: Array<[number, number, number]> = [];
  const free = (u: number, v: number, r: number) => discs.every(([du, dv, dr]) => (u - du) ** 2 + (v - dv) ** 2 > (r + dr) ** 2);
  const sample = (inset: number, r: number, tries = 14, vBias = 0): [number, number] | null => {
    const iu = Math.max(0, hw - inset), iv = Math.max(0, hd - inset);
    for (let i = 0; i < tries; i++) {
      const u = (R() * 2 - 1) * iu;
      let v = (R() * 2 - 1) * iv;
      if (vBias) v = v * (1 - Math.abs(vBias)) + vBias * iv * R();
      if (free(u, v, r)) return [u, v];
    }
    return null;
  };
  const push = (e: Omit<Elem, 'amp' | 'hue'> & { hue?: number; amp?: number }) => {
    out.push({ ...e, hue: e.hue ?? hue, amp: e.amp ?? AMP[e.type] });
  };
  const bigK = Math.min(1.8, 1 + Math.max(0, A - 150) / 900);
  const deck = 0.14; // things that sit on the turf

  // ---- level 3 centerpiece: a golden onion dome or a ball spire
  let anchorTop: THREE.Vector3 | null = null;
  let cu = 0, cv = 0, cScale = 1;
  if (minDim >= 2.6) {
    const dome = R() < 0.62;
    cScale = Math.max(0.6, Math.min(2.8, minDim * (dome ? 0.15 : 0.17)));
    cu = (R() - 0.5) * 0.25 * w;
    cv = -0.14 * d;
    push({ type: dome ? T.DOME : T.SPIRE, u: cu, v: cv, y: deck, rot: R() * 6.283, sx: cScale, sy: cScale, sz: cScale, level: 3, delay: 0.05 });
    discs.push([cu, cv, (dome ? 1.45 : 0.6) * cScale + 0.3]);
    anchorTop = new THREE.Vector3(cu, deck + (dome ? 5.1 : 6.9) * cScale, cv);
    if (A > 420) {
      // big roofs get a pair of ball spires on the back corners
      for (const s of [-1, 1]) {
        const u = s * (hw - 1.4), v = -hd + 1.4;
        const sc = Math.min(1.6, 0.8 + A / 2000);
        push({ type: T.SPIRE, u, v, y: deck, rot: R() * 6.283, sx: sc, sy: sc, sz: sc, level: 3, delay: 0.12 });
        discs.push([u, v, 0.8 * sc]);
      }
    }
  }

  // ---- level 2: the turf mat
  if (w > 2.2 && d > 2.2) push({ type: T.TURF, u: 0, v: 0, y: 0, rot: 0, sx: w - 0.9, sy: 1, sz: d - 0.9, level: 2, delay: 0 });

  // ---- trees: one or two in a garden, more for Hundertwasser
  const n2 = Math.max(1, Math.min(3, Math.round(A / 190)));
  const n3 = Math.max(1, Math.min(5, Math.round(A / 120)));
  for (let i = 0; i < n2 + n3; i++) {
    const sc = (0.75 + R() * 0.4) * Math.min(1.45, Math.sqrt(bigK)) * (minDim < 4 ? 0.7 : 1);
    const p = sample(1.2 * sc + 0.3, 1.25 * sc, 16, -0.4);
    if (!p) continue;
    push({ type: T.TREE, u: p[0], v: p[1], y: deck, rot: R() * 6.283, sx: sc, sy: sc * (0.9 + R() * 0.25), sz: sc, level: i < n2 ? 2 : 3, delay: 0 });
    discs.push([p[0], p[1], 1.25 * sc]);
  }
  // ---- bushes
  const nb = Math.max(1, Math.min(10, Math.round(A / 42)));
  for (let i = 0; i < nb; i++) {
    const sc = (0.7 + R() * 0.45) * Math.min(1.5, bigK);
    const p = sample(1.0 * sc + 0.2, 1.05 * sc, 12);
    if (!p) continue;
    push({ type: T.BUSH, u: p[0], v: p[1], y: deck, rot: R() * 6.283, sx: sc, sy: sc * (0.85 + R() * 0.3), sz: sc, level: i < Math.ceil(nb * 0.6) ? 2 : 3, delay: 0 });
    discs.push([p[0], p[1], 1.05 * sc]);
  }
  // ---- flower boxes along the back edge (and the sides of deep roofs)
  if (d > 3) {
    const np = Math.max(0, Math.min(6, Math.floor((w - 0.8) / 2.9)));
    for (let i = 0; i < np; i++) {
      const u = -hw + 0.4 + ((w - 0.8) * (i + 0.5)) / np;
      const v = -hd + 0.45;
      if (!free(u, v, 1.0)) continue;
      push({ type: T.PLANTER, u, v, y: 0, rot: 0, sx: 0.9 + R() * 0.2, sy: 1, sz: 1, level: 2, delay: 0 });
      discs.push([u, v, 1.1]);
    }
  }
  // ---- level 1: flower tufts along the street edge + the corners
  const nf = Math.max(2, Math.min(16, Math.round(w / 1.55)));
  for (let i = 0; i < nf; i++) {
    const u = -hw + 0.55 + ((w - 1.1) * (i + 0.5)) / nf + (R() - 0.5) * 0.35;
    const v = hd - 0.5 - R() * 0.25;
    const sc = 0.85 + R() * 0.35;
    push({ type: T.TUFT, u, v, y: 0, rot: R() * 6.283, sx: sc, sy: sc * (0.85 + R() * 0.35), sz: sc, level: 1, delay: 0 });
    discs.push([u, v, 0.55]);
  }
  if (d > 3) {
    for (const s of [-1, 1]) {
      const u = s * (hw - 0.55), v = -hd + 0.55;
      if (free(u, v, 0.5)) {
        push({ type: T.TUFT, u, v, y: 0, rot: R() * 6.283, sx: 1, sy: 1, sz: 1, level: 1, delay: 0 });
        discs.push([u, v, 0.55]);
      }
      const ns = Math.max(0, Math.min(6, Math.round(d / 5.5)));
      for (let i = 0; i < ns; i++) {
        const v2 = -hd + 1.4 + (d - 2.8) * ((i + 0.5) / ns) + (R() - 0.5) * 0.8;
        const u2 = s * (hw - 0.5);
        if (!free(u2, v2, 0.5)) continue;
        const sc = 0.8 + R() * 0.3;
        push({ type: T.TUFT, u: u2, v: v2, y: 0, rot: R() * 6.283, sx: sc, sy: sc, sz: sc, level: 1, delay: 0 });
        discs.push([u2, v2, 0.55]);
      }
    }
  }
  // ---- level 2: flowers scattered through the garden
  const ni = Math.max(1, Math.min(12, Math.round(A / 50)));
  for (let i = 0; i < ni; i++) {
    const p = sample(0.9, 0.5, 8);
    if (!p) continue;
    const sc = 0.8 + R() * 0.4;
    push({ type: T.TUFT, u: p[0], v: p[1], y: deck, rot: R() * 6.283, sx: sc, sy: sc, sz: sc, level: 2, delay: 0 });
    discs.push([p[0], p[1], 0.5]);
  }
  // ---- level 3: a ring of flowers around the centerpiece
  if (anchorTop) {
    const nr = 5 + Math.floor(R() * 3);
    const rr = 1.75 * cScale + 0.4;
    for (let i = 0; i < nr; i++) {
      const a = (i / nr) * 6.283 + R() * 0.4;
      const u = cu + Math.cos(a) * rr, v = cv + Math.sin(a) * rr;
      if (Math.abs(u) > hw - 0.4 || Math.abs(v) > hd - 0.4) continue;
      push({ type: T.TUFT, u, v, y: deck, rot: R() * 6.283, sx: 1, sy: 1, sz: 1, level: 3, delay: 0, hue: (hue + (i % 2 ? 1 : 5)) % 6 });
    }
  }

  // delays: a ripple outward from the roof center
  const maxR = Math.hypot(hw, hd) || 1;
  for (const e of out) e.delay += 0.45 * (Math.hypot(e.u - cu, e.v - cv) / maxR) + R() * 0.08 + (e.level === 3 ? 0.12 : 0);

  // ---- level 3: rainbow bunting from the centerpiece to little posts at the corners
  if (anchorTop && minDim >= 3) {
    const corners: Array<[number, number]> = [
      [-hw + 0.35, hd - 0.35],
      [hw - 0.35, hd - 0.35],
    ];
    if (A > 300) corners.push([-hw + 0.35, -hd + 0.35], [hw - 0.35, -hd + 0.35]);
    let hk = hue;
    for (const [u, v] of corners) {
      const ps = 0.34;
      push({ type: T.SPIRE, u, v, y: 0, rot: 0, sx: ps, sy: ps, sz: ps, level: 3, delay: 0.5 });
      const postTop = new THREE.Vector3(u, 6.65 * ps, v);
      const dx = postTop.x - anchorTop.x, dy = postTop.y - anchorTop.y, dz = postTop.z - anchorTop.z;
      const len = Math.hypot(dx, dy, dz);
      const nflags = Math.max(4, Math.min(16, Math.round(len / 1.2)));
      const sag = 0.08 * len + 0.25;
      for (let i = 0; i < nflags; i++) {
        const t = (i + 0.5) / nflags;
        // parabolic sag (local roof frame, y up)
        const pu = anchorTop.x + dx * t;
        const pv = anchorTop.z + dz * t;
        const py = anchorTop.y + dy * t - 4 * sag * t * (1 - t);
        out.push({
          type: T.FLAG,
          u: pu,
          v: pv,
          y: py,
          rot: 0,
          sx: len / nflags,
          sy: Math.min(1.3, 0.75 + len * 0.02),
          sz: 1,
          hue: hk % 6,
          amp: AMP[T.FLAG],
          level: 3,
          delay: 0.7 + i * 0.045,
          // direction of the string at this flag (roof frame): d/dt of the parabola
          dir: [dx, dy - 4 * sag * (1 - 2 * t), dz],
        });
        hk++;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- RoofSprouts

interface Rec extends Holder {
  level: number;
  hue: number;
  times: [number, number, number];
  cell: number;
  /** its elements, the farthest-reaching first (so what's drawn is always the first `drawn`): each one's type, and its packed instance (STRIDE floats) */
  type: Uint8Array;
  data: Float32Array;
  /** of them, the first this many are in the batches */
  drawn: number;
  /** its casters are in the sun pass */
  sun: boolean;
  /** the element types drawn in their far form (bits by type), and this frame's want */
  cm: number;
  wantCm: number;
  /** the garden's bounds: its middle (world), its radius and how high it stands over the roof (m) */
  x: number;
  y: number;
  z: number;
  r: number;
  top: number;
  /** this frame's want (RoofSprouts.update) */
  want: number;
  far: number;
  /** ?lift: its house has leapt, and its bounds stand LIFT_TALL taller (makeTall) */
  tall: boolean;
  /** how high its roof stands over its ground (m): its shadow can fall that much farther, to the street */
  fall: number;
}

/** One element of a garden laid out by hand: where it stands (world), its turn, size and hue; when it springs up (game clock). */
export interface SproutItem {
  type: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  sx: number;
  sy: number;
  sz: number;
  hue: number;
  amp: number;
  start: number;
  /** a flag: which way its string runs */
  dir?: [number, number, number];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _vp = new THREE.Matrix4();
const _frustum = new THREE.Frustum();

interface TypeRes {
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  depth: THREE.ShaderMaterial | null;
  capacity: number;
  /** triangles per instance, and its reach (x propsTune.sproutCull) */
  tris: number;
  cull: number;
  /** its far form (the near one's vertices, fewer triangles), their count, and where it takes over (x propsTune.sproutCull; 0: none) */
  coreGeo: THREE.BufferGeometry | null;
  coreTris: number;
  core: number;
}

/** Sprouts are bucketed into city cells so off-screen gardens are frustum culled. */
const CELL = 768;
/** How far a cell's bounds reach over its height (m): a city's roofs, or (given a height) what a garden on a crater wall can span. */
const CELL_TALL = 220;
const CELL_TALL_PLACED = 1000;

/**
 * The gardens' budget (docs/specs/gardens/BUDGET.md). Every frame each garden is drawn as far as the view can see it and no farther: an
 * element its reach has shrunk away, or a garden whose body and shadow are both out of the view, isn't in the batches at all; a caster whose
 * shadow can't land in the sun's window draws in the view only. Nothing changes on the screen for it: the shader shrinks an element over
 * the last fifth of its reach before it goes, and one comes back already shrunk. Over `tris` (both passes) every reach is held in a little,
 * the farthest going first, until it's under.
 */
export const GARDEN_BUDGET = {
  /** triangles, the view's and the sun's: the floor's 1.5 M, less the city's own ~0.85 M and some room */
  tris: 450_000,
  /** the least the reaches are held to (of what's tuned) */
  hold: 0.35,
  /** (m) a reach's hysteresis, and the view's slack past its edges (of the distance, and metres): the lens is this frame's, so only a frame's
   * moves running out on a look behind need it */
  hyst: 12,
  slack: 0.03,
  slackM: 4,
  /** elements in per frame at most, and out: each its own, so what goes never holds up what comes (a look behind adds the nearest first) */
  moves: 12000,
  outs: 6000,
  /** the hold lets out (half a hundredth a frame) when what this much more reach would add still fits, and not for this many frames after it held in */
  probe: 1.01,
  calm: 30,
};
/** a lifted house's garden rides up to ~125 m over its roof (LIFT.md's highest rest and its heave): its bounds stand that tall, from its leap
 * on (shed()). One on its ground only crouches (0.35 m): its bounds are a roof's, so ?lift draws no more than the street does */
const LIFT_TALL = 130;
/** A garden's bounds made tall: its middle up half of LIFT_TALL, and its radius over the same roof that much taller. */
function makeTall(rec: Rec) {
  if (rec.tall) return;
  const flat = Math.max(0, (2 * (rec.r - 1)) ** 2 - rec.top ** 2);
  rec.y += LIFT_TALL / 2;
  rec.r = 0.5 * Math.sqrt(flat + (rec.top + LIFT_TALL) ** 2) + 1;
  rec.tall = true;
}

export class RoofSprouts {
  readonly object: THREE.Object3D;
  private readonly types: TypeRes[];
  private readonly cells = new Map<number, Batch[]>();
  private readonly recs = new Map<number, Rec>();
  private readonly maxBuildings: number;
  /** gardens laid out by hand: the batch of each element, and its slot */
  private readonly placed = new Map<number, { h: Holder; b: Batch[] }>();
  /** top of each element type's template geometry (m at scale 1): what the flight must clear */
  private readonly typeTop: number[] = [];
  /** the view's lens (both passes read it: an element's shadow shrinks as it does) and the budget's hold on the reaches */
  private readonly uEye = { value: new THREE.Vector3() };
  private readonly uReach = { value: 1 };
  /** the street: drawn by the budget. The Moon draws every element, as before */
  private readonly lod = !moonLow;
  /** a lens has been seen (before the first, every garden is drawn whole) */
  private seen = false;
  private readonly last = { tris: 0, sunTris: 0, moved: 0, outed: 0, elements: 0, pending: 0, grow: 0 };
  // (update()'s own, kept from frame to frame: the gardens coming in, going and changing their sun; what more reach would add; the hold's rest)
  private readonly ins: Rec[] = [];
  private readonly outs: Rec[] = [];
  private readonly suns: Rec[] = [];
  private grow = 0;
  private probe = false;
  private calm = 0;
  /** QA: the budget (tools/gardens/budget.mjs sets it) */
  readonly budget = GARDEN_BUDGET;
  private readonly coreAt: number[] = [];
  private readonly batchTris: number[] = [];
  /** the types that have a far form */
  private readonly coreTypes: number[] = [];

  constructor(maxBuildings = 4096, private readonly cell = CELL) {
    this.maxBuildings = Math.max(1, maxBuildings);
    const group = new THREE.Group();
    group.name = 'RoofSprouts';
    group.matrixAutoUpdate = false; // the sprout shader assumes the group sits at the origin
    this.object = group;
    const noCull = new THREE.Vector4();
    this.types = TYPES.map((def) => {
      const geo = def.geo();
      if (!geo.boundingBox) geo.computeBoundingBox();
      this.typeTop.push(geo.boundingBox ? geo.boundingBox.max.y : 1);
      const kind = new THREE.Vector4(def.freq, def.dir[0], def.dir[1], def.cull);
      const reach = { uEye: this.uEye, uReach: this.uReach, uCore: { value: moonLow ? 0 : (def.core ?? 0) } };
      const uniforms: Record<string, THREE.IUniform> = {
        ...globals,
        uKind: { value: kind },
        uAmpMul: tuneUniform(def.tune),
        uCull: tuneUniform('sproutCull'),
        uLeafEdge: tuneUniform('treeLump'),
        ...reach,
        ...(liftUniforms ?? {}),
        ...(pogoUniforms ? { uPaint: paintUniforms.uPaint, uPaintW: paintUniforms.uPaintW, ...pogoUniforms } : {}),
      };
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms,
        vertexShader: SPROUT_VS,
        fragmentShader: SPROUT_FS,
        side: def.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      });
      let depth: THREE.ShaderMaterial | null = null;
      if (def.cast) {
        // (the sun pass shrinks an element by its distance from the view's lens, as the view does: its shadow goes with it. The Moon's never
        // culls in the sun pass, whose camera is far away by design)
        noCull.set(def.freq, def.dir[0], def.dir[1], 0);
        depth = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          uniforms: { uTime: globals.uTime, uSlide: globals.uSlide, uKind: moonLow ? { value: noCull.clone() } : uniforms.uKind, uAmpMul: uniforms.uAmpMul, uCull: uniforms.uCull, ...reach, ...(liftUniforms ?? {}), ...(pogoUniforms ? { uPaint: paintUniforms.uPaint, uPaintW: paintUniforms.uPaintW, ...pogoUniforms } : {}) },
          vertexShader: SPROUT_DEPTH_VS,
          fragmentShader: DEPTH_FS,
        });
        depth.allowOverride = false;
      }
      const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      // the far form: the same vertices (so the same programs), the small growth's triangles left out
      let coreGeo: THREE.BufferGeometry | null = null;
      if (!moonLow && def.core && geo.userData.core) {
        coreGeo = new THREE.BufferGeometry();
        for (const k in geo.attributes) coreGeo.setAttribute(k, geo.attributes[k]);
        coreGeo.setIndex(geo.userData.core as number[]);
        coreGeo.boundingBox = geo.boundingBox;
        coreGeo.boundingSphere = geo.boundingSphere;
      }
      return { geo, mat, depth, capacity: def.capacity, tris, cull: def.cull, coreGeo, coreTris: coreGeo ? coreGeo.index!.count / 3 : 0, core: coreGeo ? def.core! : 0 };
    });
    // a cell's batches: every type's, then the far forms' (coreAt: a type's far form's place in them, -1 none)
    let nb = this.types.length;
    this.types.forEach((t, i) => {
      this.coreAt.push(t.coreGeo ? nb++ : -1);
      this.batchTris.push(t.tris);
      if (t.coreGeo) this.coreTypes.push(i);
    });
    for (const t of this.types) if (t.coreGeo) this.batchTris.push(t.coreTris);
    // shader warm-up (render/warmup.ts): every element type's batch and its sun-pass twin, made by
    // the same code as a garden's (gardens only grow in flight, at the first escalation)
    registerWarm('roof sprouts', () => {
      const g = new THREE.Group();
      const sphere = new THREE.Sphere();
      for (const t of this.types) {
        new Batch(t.geo, t.mat, t.depth, 1, g, sphere);
        if (t.coreGeo) new Batch(t.coreGeo, t.mat, t.depth, 1, g, sphere);
      }
      return g;
    });
  }

  private cellBatches(key: number, cx: number, cz: number, y?: number): Batch[] {
    let b = this.cells.get(key);
    if (!b) {
      const S = this.cell;
      const sphere = new THREE.Sphere(new THREE.Vector3((cx + 0.5) * S, y ?? 120, (cz + 0.5) * S), S * 0.71 + (y === undefined ? CELL_TALL : CELL_TALL_PLACED));
      const group = this.object as THREE.Group;
      b = this.types.map((t) => new Batch(t.geo, t.mat, t.depth, t.capacity, group, sphere));
      for (const t of this.types) if (t.coreGeo) b.push(new Batch(t.coreGeo, t.mat, t.depth, t.capacity, group, sphere));
      this.cells.set(key, b);
    }
    return b;
  }

  /** ?lift: buildings whose small growth has gone (shed): set() leaves it out for them */
  shedSet: Set<number> | null = liftOn ? new Set() : null;

  /**
   * ?lift: a house leaps: its garden's small growth (tufts, bushes, trees, planters) goes, and its dome or spire, bunting and turf ride up with it.
   * Under 2 game pixels from 250 m and unseen from below, and most of a level-3 garden's triangles: the Lift's bound (docs/specs/factions/LIFT.md).
   * Returns the roof points it shed from (x, z pairs, at most 8) for the petals, in `out`; the count.
   */
  shed(buildingIndex: number, out?: Float32Array): number {
    this.shedSet?.add(buildingIndex);
    const rec = this.recs.get(buildingIndex);
    const cell = rec ? this.cells.get(rec.cell) : undefined;
    if (!rec || !cell) return 0;
    // (it rides up from now: its bounds stand tall)
    makeTall(rec);
    let n = 0, kept = 0, drawn = 0;
    const N = rec.type.length;
    const type = new Uint8Array(N), data = new Float32Array(N * STRIDE), at = new Int32Array(N);
    for (let k = 0; k < N; k++) {
      const t = rec.type[k], s = rec.at[k];
      if (t > T.PLANTER) {
        type[kept] = t;
        data.set(rec.data.subarray(k * STRIDE, (k + 1) * STRIDE), kept * STRIDE);
        at[kept] = s;
        if (s >= 0) {
          this.batchOf(cell, rec, t).rekey(s, kept);
          drawn++;
        }
        kept++;
        continue;
      }
      if (out && n < out.length / 2) {
        out[n * 2] = rec.data[k * STRIDE + 12];
        out[n * 2 + 1] = rec.data[k * STRIDE + 14];
        n++;
      }
      if (s >= 0) this.batchOf(cell, rec, t).release(s);
    }
    rec.type = type.slice(0, kept);
    rec.data = data.slice(0, kept * STRIDE);
    rec.at = at.slice(0, kept);
    rec.drawn = drawn;
    return n;
  }

  /** Painted buildings currently carrying sprouts. */
  get size(): number {
    return this.recs.size;
  }

  /**
   * Grow (or regrow at a new level) the roof garden of one building. Elements
   * the building already had keep their timing (no re-pop); startTime < now
   * (e.g. -100 when restoring saved paint) means already grown. Returns how
   * high the garden stands above the roof (m, with its growth overshoot): the
   * flight's obstacle field rises to it (domes, spires and garden trees). `faction`: whose paint the building is (game/factions.ts), which its
   * garden draws in (the hue's eights, as the shader reads them: Rainbow's leaves the hue as it was).
   */
  set(buildingIndex: number, roof: RoofRect, hue: number, level: number, startTime: number, faction = FACTION_RAINBOW, ground?: number): number {
    const shed = this.shedSet?.has(buildingIndex) ?? false;
    const lvl = Math.max(1, Math.min(3, Math.round(level)));
    const h = ((Math.round(hue) % 6) + 6) % 6;
    const owner = 8 * (Math.max(FACTION_RAINBOW, Math.min(FACTION_ROOM, Math.round(faction))) - FACTION_RAINBOW);
    const prev = this.recs.get(buildingIndex);
    const times: [number, number, number] = [startTime, startTime, startTime];
    if (prev) {
      for (let l = 1; l <= prev.level; l++) times[l - 1] = prev.times[l - 1];
      this.release(prev);
      this.recs.delete(buildingIndex);
    } else if (this.recs.size >= this.maxBuildings) {
      const oldest = this.recs.keys().next().value as number;
      this.clear(oldest);
    }
    const ccx = Math.floor(roof.cx / CELL), ccz = Math.floor(roof.cz / CELL);
    const cellKey = (ccx + 4096) * 8192 + (ccz + 4096);
    const batches = this.cellBatches(cellKey, ccx, ccz);
    const elems = layoutRoof(buildingIndex + 1, roof, h);
    const sinY = Math.sin(roof.yaw), cosY = Math.cos(roof.yaw);
    // roof frame: U along the street (w), N toward the street (d)
    const ux = sinY, uz = cosY, nx = cosY, nz = -sinY;
    const delay0 = propsTune.sproutDelay;
    const showLevel = Math.max(lvl, prev?.level ?? 0);
    const list: Array<[number, number]> = [];
    const data = new Float32Array(elems.length * STRIDE);
    let top = 0;
    for (let i = 0; i < elems.length; i++) {
      const e = elems[i];
      if (e.level > showLevel) continue;
      // (?lift: a floating house's small growth went up as petals at its jump: a tile streaming back in doesn't grow it again)
      if (shed && e.type <= T.PLANTER) continue;
      top = Math.max(top, e.y + (e.type === T.FLAG ? 0.4 : this.typeTop[e.type]) * e.sy);
      const wx = roof.cx + e.u * ux + e.v * nx;
      const wz = roof.cz + e.u * uz + e.v * nz;
      const wy = roof.y + e.y - (e.type === T.TURF ? 0 : 0.06);
      if (e.type === T.FLAG && e.dir) {
        // string direction in world space -> flag basis (x along the string, y up-ish)
        const [du, dy, dv] = e.dir;
        _x.set(du * ux + dv * nx, dy, du * uz + dv * nz).normalize();
        _y.copy(_up).addScaledVector(_x, -_up.dot(_x)).normalize();
        _z.crossVectors(_x, _y);
        _m.makeBasis(_x.multiplyScalar(e.sx), _y.multiplyScalar(e.sy), _z.multiplyScalar(e.sz));
        _m.setPosition(wx, wy, wz);
      } else {
        // local rot is relative to the roof's U axis (rot = 0 -> local x along U)
        _q.setFromAxisAngle(_up, roof.yaw - Math.PI / 2 + e.rot);
        _p.set(wx, wy, wz);
        _s.set(e.sx, e.sy, e.sz);
        _m.compose(_p, _q, _s);
      }
      const o = list.length * STRIDE;
      const seed = fract(Math.sin((buildingIndex + 1) * 12.9898 + i * 78.233) * 43758.5453);
      data.set(_m.elements, o);
      data[o + 16] = e.hue + owner + 0.9 * seed;
      data[o + 17] = e.amp;
      data[o + 18] = times[e.level - 1] + delay0 + e.delay;
      data[o + 19] = ground !== undefined ? buildingIndex : -1;
      data[o + 20] = ground !== undefined ? roof.y - ground : 0;
      list.push([e.type, o]);
    }
    // (the farthest-reaching first: what a garden draws is always its first so many)
    list.sort((a, b) => this.types[b[0]].cull - this.types[a[0]].cull || a[1] - b[1]);
    const n = list.length;
    const rec: Rec = {
      level: showLevel,
      hue: h,
      times,
      cell: cellKey,
      type: new Uint8Array(n),
      data: new Float32Array(n * STRIDE),
      at: new Int32Array(n).fill(-1),
      drawn: 0,
      sun: true,
      cm: 0,
      wantCm: 0,
      x: roof.cx,
      y: roof.y + top / 2,
      z: roof.cz,
      r: 0.5 * Math.hypot(Math.max(roof.w, 1.2), Math.max(roof.d, 1.2), top) + 1,
      tall: false,
      fall: Math.max(0, roof.y - (roof.foot ?? ground ?? roof.y)),
      top,
      want: 0,
      far: 0,
    };
    for (let k = 0; k < n; k++) {
      rec.type[k] = list[k][0];
      rec.data.set(data.subarray(list[k][1], list[k][1] + STRIDE), k * STRIDE);
    }
    if (shed) makeTall(rec);
    this.recs.set(buildingIndex, rec);
    // (drawn as the last frame's lens sees it: before the first, whole)
    if (this.lod && this.seen) {
      this.judge(rec);
      rec.cm = rec.wantCm;
      rec.sun = rec.far === 1;
      this.fit(rec, batches, rec.want);
    } else this.fit(rec, batches, n);
    // (the pop overshoots ~15% while it grows, and the sway leans it a little)
    return top > 0 ? top * 1.15 + 0.4 : 0;
  }

  /** The batch element type `t` of a garden is drawn in: its far form's, or its own. */
  private batchOf(cell: Batch[], rec: Rec, t: number): Batch {
    return (rec.cm >> t) & 1 ? cell[this.coreAt[t]] : cell[t];
  }

  /** Draw the first `want` of a garden's elements, and no more. */
  private fit(rec: Rec, cell: Batch[], want: number) {
    while (rec.drawn < want) {
      const k = rec.drawn++, b = this.batchOf(cell, rec, rec.type[k]);
      b.put(b.alloc(rec, k, rec.sun), rec.data, k * STRIDE);
    }
    while (rec.drawn > want) {
      const k = --rec.drawn;
      this.batchOf(cell, rec, rec.type[k]).release(rec.at[k]);
    }
  }

  /** The garden's types in their far form or not, as it wants (rec.wantCm): each drawn element of a type that changes goes over. Its moves. */
  private reform(rec: Rec, cell: Batch[]): number {
    const diff = rec.wantCm ^ rec.cm;
    if (!diff) return 0;
    let n = 0;
    for (let k = 0; k < rec.drawn; k++) if ((diff >> rec.type[k]) & 1) this.batchOf(cell, rec, rec.type[k]).release(rec.at[k]);
    rec.cm = rec.wantCm;
    for (let k = 0; k < rec.drawn; k++)
      if ((diff >> rec.type[k]) & 1) {
        const b = this.batchOf(cell, rec, rec.type[k]);
        b.put(b.alloc(rec, k, rec.sun), rec.data, k * STRIDE);
        n++;
      }
    return n;
  }

  // (this frame's lens, for judge())
  private eye = new THREE.Vector3();
  private sunDir = new THREE.Vector3(0, 1, 0);
  private sunScale = 0;
  private sunOn = false;

  /** What one element of type `t` costs drawn, both passes: in its far form or not (`cm`), casting or not. */
  private cost(t: number, cm: number, sun: boolean): number {
    const ty = this.types[t];
    return ((cm >> t) & 1 ? ty.coreTris : ty.tris) * (sun && ty.depth && this.sunOn ? 2 : 1);
  }

  /** How far a shadow from `h` m over its roof can fall: the pipeline's sun goes as low as 0.02 over the horizon, and none lands past its window. */
  private shadowLen(h: number): number {
    return this.sunOn ? Math.min(1 / Math.max(this.sunScale, 1e-6), h / Math.max(0.02, this.sunDir.y)) : 0;
  }

  /**
   * How many of its elements a garden wants drawn this frame (rec.want), and whether its casters cast (rec.sun's want, in rec.far: 1 cast, 0 not).
   * While the hold is in, what letting it out would add goes on `grow`.
   */
  private judge(rec: Rec) {
    const dx = rec.x - this.eye.x, dy = rec.y - this.eye.y, dz = rec.z - this.eye.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const B = GARDEN_BUDGET;
    // its shadow: from its middle down the sun's way, as far as its top's can fall. The view sees a garden whose body or shadow it sees: a
    // capsule from the one to the other, so a low sun's long shadow is in, and a garden it doesn't fall from isn't. It can fall past its roof to
    // the street, and a leapt house's falls from as high as it rides
    const L = this.shadowLen(rec.top + rec.fall + (rec.tall ? LIFT_TALL : 0));
    const ox = -this.sunDir.x * L, oy = -this.sunDir.y * L, oz = -this.sunDir.z * L;
    // (in the view: and the slack round the edges; once in, a little more slack to go out)
    const slack = rec.r + B.slackM + B.slack * dist + (rec.drawn > 0 ? B.hyst + 0.05 * dist : 0);
    const planes = _frustum.planes;
    let seen = true;
    for (let i = 0; i < 6; i++) {
      const n = planes[i].normal, a = n.x * rec.x + n.y * rec.y + n.z * rec.z + planes[i].constant;
      if (a < -slack && a + n.x * ox + n.y * oy + n.z * oz < -slack) {
        seen = false;
        break;
      }
    }
    let want = 0;
    const lo = Math.max(0, dist - rec.r), reach = propsTune.sproutCull * this.uReach.value;
    const N = rec.type.length;
    if (seen) {
      want = rec.drawn;
      while (want < N && this.types[rec.type[want]].cull * reach > lo) want++;
      while (want > 0 && this.types[rec.type[want - 1]].cull * reach < lo - B.hyst) want--;
    }
    rec.want = want;
    // the far forms: one takes over once the garden's nearest point is past where the small growth has shrunk away, and gives back before it's
    // in again (a garden drawn by none of it can take either)
    let cm = rec.cm;
    for (const t of this.coreTypes) {
      const Rc = this.types[t].core * reach;
      const far = (cm >> t) & 1 ? lo >= Rc : lo > Rc + B.hyst;
      cm = far ? cm | (1 << t) : cm & ~(1 << t);
    }
    rec.wantCm = cm;
    // the sun's window, last frame's (globals.uShadowMatrix: the window as 0..1), and a tenth of it round
    rec.far = rec.sun ? 1 : 0;
    if (this.sunOn) {
      const e = globals.uShadowMatrix.value.elements;
      const u = e[0] * rec.x + e[4] * rec.y + e[8] * rec.z + e[12], v = e[1] * rec.x + e[5] * rec.y + e[9] * rec.z + e[13];
      const mg = 0.1 + (rec.r + L + 20) * this.sunScale;
      rec.far = u > -mg && u < 1 + mg && v > -mg && v < 1 + mg ? 1 : 0;
    }
    // what letting the hold out would add: the elements the probe's longer reach takes in, and the far forms it gives back
    if (seen && this.probe) {
      const r2 = reach * B.probe, sun = rec.far === 1;
      let g = 0;
      for (let w = want; w < N && this.types[rec.type[w]].cull * r2 > lo; w++) g += this.cost(rec.type[w], cm, sun);
      for (const t of this.coreTypes)
        if ((cm >> t) & 1 && lo < this.types[t].core * r2) {
          const more = this.cost(t, 0, sun) - this.cost(t, 1 << t, sun);
          for (let k = 0; k < want; k++) if (rec.type[k] === t) g += more;
        }
      this.grow += g;
    }
  }

  /** A garden's casters into the sun pass, or out of it. */
  private resun(rec: Rec, on: boolean) {
    rec.sun = on;
    const cell = this.cells.get(rec.cell)!;
    for (let k = 0; k < rec.drawn; k++) this.batchOf(cell, rec, rec.type[k]).setSun(rec.at[k], on);
  }

  /**
   * Once a frame, before the render: the view's lens. Each garden is drawn as far as it's seen (the budget, above), the nearest first when
   * more come in than a frame takes, and the reaches held in while the gardens' triangles are over the budget. What comes in goes first, from
   * its own moves; what goes, from its own: until it's gone it only costs, and on a look behind it never holds up what's coming.
   */
  update(camera: THREE.Camera): void {
    this.uEye.value.copy(camera.position);
    if (!this.lod) return;
    this.seen = true;
    this.eye.copy(camera.position);
    camera.updateMatrixWorld();
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_vp);
    // the sun: its way (from the window's own matrix: its depth row runs along the sun), the window's scale (0..1 a metre), and whether it draws
    const e = globals.uShadowMatrix.value.elements;
    this.sunOn = globals.uShadowOn.value > 0;
    if (this.sunOn) {
      this.sunDir.set(-e[2], -e[6], -e[10]).normalize();
      if (this.sunDir.y < 0) this.sunDir.negate();
      this.sunScale = Math.sqrt(e[0] * e[0] + e[4] * e[4] + e[8] * e[8]);
    }
    const B = GARDEN_BUDGET;
    let moves = B.moves, outs = B.outs;
    const ins = this.ins, gone = this.outs, suns = this.suns;
    ins.length = gone.length = suns.length = 0;
    this.grow = 0;
    this.probe = this.uReach.value < 1;
    for (const rec of this.recs.values()) {
      this.judge(rec);
      if (rec.drawn === 0) {
        // (none of it drawn: it takes its far forms and its sun as it wants them, and nothing moves)
        rec.cm = rec.wantCm;
        rec.sun = rec.far === 1;
      }
      if (rec.want < rec.drawn) {
        gone.push(rec);
        continue;
      }
      // (a far form gives back first of all: past its edge the small growth would be missing)
      if (rec.wantCm !== rec.cm) moves -= this.reform(rec, this.cells.get(rec.cell)!);
      if ((rec.far === 1) !== rec.sun) suns.push(rec);
      if (rec.want > rec.drawn) ins.push(rec);
    }
    // 1. what comes in, the nearest first when there's more than a frame takes (a look behind)
    let need = 0;
    for (const r of ins) need += r.want - r.drawn;
    if (need > moves) ins.sort(this.nearer);
    for (const rec of ins) {
      if (moves <= 0) break;
      const to = Math.min(rec.want, rec.drawn + moves);
      moves -= to - rec.drawn;
      this.fit(rec, this.cells.get(rec.cell)!, to);
    }
    // 2. what goes, from its own moves, and then its far forms and its sun as it wants them
    for (const rec of gone) {
      const cell = this.cells.get(rec.cell)!;
      if (outs > 0) {
        const to = Math.max(rec.want, rec.drawn - outs);
        outs -= rec.drawn - to;
        this.fit(rec, cell, to);
      }
      if (rec.wantCm !== rec.cm) outs -= this.reform(rec, cell);
      if ((rec.far === 1) !== rec.sun) suns.push(rec);
    }
    // 3. the sun pass: a caster coming into its window from what's left of the moves in, one leaving it from what's left of the moves out
    for (const rec of suns) {
      const on = rec.far === 1;
      if (on ? moves <= 0 : outs <= 0) continue;
      this.resun(rec, on);
      if (on) moves -= rec.drawn;
      else outs -= rec.drawn;
    }
    // what's drawn now, both passes, and what's still to come in or go (a frame's moves ran out): the hold goes by what it comes to
    let tris = 0, sunTris = 0, elements = 0;
    for (const cell of this.cells.values())
      for (let i = 0; i < cell.length; i++) {
        const b = cell[i];
        if (!b.live) continue;
        elements += b.live;
        tris += b.live * this.batchTris[i];
        if (b.caster) sunTris += b.sun * this.batchTris[i];
      }
    let pending = 0;
    for (const rec of ins) for (let k = rec.drawn; k < rec.want; k++) pending += this.cost(rec.type[k], rec.cm, rec.sun);
    for (const rec of gone) for (let k = rec.want; k < rec.drawn; k++) pending -= this.cost(rec.type[k], rec.cm, rec.sun);
    // the hold: in by a hundredth a frame while it's over; out by half that once it's been under for a second and what the longer reach
    // would add still fits (so it lets out wherever there's room, at the street after a climb too)
    const all = tris + (this.sunOn ? sunTris : 0) + pending;
    const k = this.uReach.value;
    if (all > B.tris) {
      this.uReach.value = Math.max(B.hold, k * 0.99);
      this.calm = B.calm;
    } else if (k < 1 && --this.calm <= 0 && all + this.grow <= B.tris) this.uReach.value = Math.min(1, k * 1.005);
    const last = this.last;
    last.tris = tris;
    last.sunTris = sunTris;
    last.moved = B.moves - moves;
    last.outed = B.outs - outs;
    last.elements = elements;
    last.pending = pending;
    last.grow = this.grow;
  }

  /** (the nearer garden first, on the ground) */
  private readonly nearer = (a: Rec, b: Rec) => {
    const e = this.eye;
    return (a.x - e.x) ** 2 + (a.z - e.z) ** 2 - ((b.x - e.x) ** 2 + (b.z - e.z) ** 2);
  };

  /**
   * QA (tools/gardens/budget.mjs): against this lens, each element one by one. `missing`: not drawn, though it stands in the view and inside the
   * part of its reach where it's whole (it would have popped in). `early`: drawn in its far form while its own distance is inside the core reach
   * (its small growth would have popped out). `shadow`: a caster inside the sun's window whose shadow falls in the view, not drawn or not in
   * the sun pass, its body in the view or not. A garden whose house has leapt (?lift) rides where the CPU doesn't follow it: it's taken as
   * anywhere up to LIFT_TALL over its rest, as its bounds stand, and its far forms aren't judged (`lifted`: how many of those were checked).
   * One on its ground is judged as any (its crouch sinks it 0.35 m).
   */
  audit(camera: THREE.Camera): { missing: number; early: number; shadow: number; checked: number; lifted: number } {
    const out = { missing: 0, early: 0, shadow: 0, checked: 0, lifted: 0 };
    if (!this.lod) return out;
    camera.updateMatrixWorld();
    const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const eye = camera.position, reach = propsTune.sproutCull * this.uReach.value, sd = this.sunDir;
    // (the hull of n points, r round: in the view unless it's all past one plane)
    const P = new Float32Array(12);
    const hull = (n: number, r: number) => {
      for (const p of f.planes) {
        let i = 0;
        while (i < n && p.normal.x * P[i * 3] + p.normal.y * P[i * 3 + 1] + p.normal.z * P[i * 3 + 2] + p.constant < -r) i++;
        if (i === n) return false;
      }
      return true;
    };
    for (const rec of this.recs.values()) {
      for (let k = 0; k < rec.type.length; k++) {
        const t = rec.type[k], o = k * STRIDE, d = rec.data;
        // (a lifted one: anywhere on the column from its rest up LIFT_TALL, and its shadow anywhere its height on that column throws it)
        const lifted = rec.tall;
        const up = lifted ? LIFT_TALL : 0;
        const x = d[o + 12], y = d[o + 13], z = d[o + 14];
        const top = this.typeTop[t] * Math.hypot(d[o + 4], d[o + 5], d[o + 6]), rad = top + 1;
        // its distance: the column's nearest point
        const cy = Math.max(y, Math.min(y + up, eye.y));
        const dist = Math.hypot(x - eye.x, cy - eye.y, z - eye.z);
        const cast = !!this.types[t].depth && this.sunOn && rec.far === 1;
        P.set([x, y, z, x, y + up, z]);
        const body = hull(2, rad);
        let shade = false;
        if (cast && !body) {
          const roof = rec.y - rec.top / 2 - up / 2, h = y - roof + top + rec.fall, L0 = this.shadowLen(h), L1 = this.shadowLen(h + up);
          P.set([x - sd.x * L0, y - sd.y * L0, z - sd.z * L0, x - sd.x * L1, y + up - sd.y * L1, z - sd.z * L1], 6);
          shade = hull(4, rad);
        }
        if (!body && !shade) continue;
        out.checked++;
        if (lifted) out.lifted++;
        if (rec.at[k] < 0) {
          if (dist < 0.8 * this.types[t].cull * reach) {
            if (body) out.missing++;
            else out.shadow++;
          }
          continue;
        }
        if (!lifted && (rec.cm >> t) & 1 && dist < this.types[t].core * reach) out.early++;
        if (cast && !rec.sun) out.shadow++;
      }
    }
    return out;
  }

  /** QA: what the gardens drew last frame: triangles in the view and the sun pass, elements, gardens drawn, the reaches' hold, the frame's moves in and out, what was still to come or go, and what letting the hold out would add. */
  stats() {
    let drawn = 0;
    for (const r of this.recs.values()) if (r.drawn > 0) drawn++;
    return { ...this.last, gardens: this.recs.size, drawn, hold: this.uReach.value };
  }

  /**
   * A garden its caller has laid out, in the world, with no roof under it (?moon: a crater's rim, src/moon/RimBloom.ts). Replaces what `index` had in this way; it shares nothing with a roof's. Each element goes in the
   * cell it stands in, so a rim kilometres round is culled a piece at a time.
   */
  place(index: number, items: SproutItem[]): void {
    this.unplace(index);
    const h: Holder = { at: new Int32Array(items.length).fill(-1) };
    const held: Batch[] = [];
    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      const ccx = Math.floor(e.x / this.cell), ccz = Math.floor(e.z / this.cell);
      const b = this.cellBatches((ccx + 4096) * 8192 + (ccz + 4096), ccx, ccz, e.y)[e.type];
      if (e.dir) {
        const [dx, dy, dz] = e.dir;
        _x.set(dx, dy, dz).normalize();
        _y.copy(_up).addScaledVector(_x, -_up.dot(_x)).normalize();
        _z.crossVectors(_x, _y);
        _m.makeBasis(_x.multiplyScalar(e.sx), _y.multiplyScalar(e.sy), _z.multiplyScalar(e.sz));
        _m.setPosition(e.x, e.y, e.z);
      } else {
        _q.setFromAxisAngle(_up, e.rot);
        _p.set(e.x, e.y, e.z);
        _s.set(e.sx, e.sy, e.sz);
        _m.compose(_p, _q, _s);
      }
      const slot = b.alloc(h, i);
      b.write(slot, _m, e.hue, fract(Math.sin((index + 1) * 12.9898 + i * 78.233) * 43758.5453), e.amp, e.start);
      held.push(b);
    }
    this.placed.set(index, { h, b: held });
  }

  /**
   * ?moon: the map slid by (dx, dz) (main.ts, by way of RimBloom): every garden laid out by hand comes over as it stands, each element into the cell it stands in now. Nothing is
   * laid out again, so nothing moves on the screen: not its height, not its growing.
   */
  slide(dx: number, dz: number): void {
    const e = _m.elements;
    for (const { h, b: held } of this.placed.values()) {
      for (let i = 0; i < held.length; i++) {
        const b = held[i], slot = h.at[i];
        if (slot < 0) continue;
        const type = this.types.findIndex((t) => t.geo === b.geo);
        const c = b.mesh.instanceColor!.array as Float32Array, hue = c[slot * 3], amp = c[slot * 3 + 1], start = c[slot * 3 + 2];
        _m.fromArray(b.mesh.instanceMatrix.array as Float32Array, slot * 16);
        b.release(slot);
        e[12] -= dx;
        e[14] -= dz;
        const ccx = Math.floor(e[12] / this.cell), ccz = Math.floor(e[14] / this.cell);
        const nb = this.cellBatches((ccx + 4096) * 8192 + (ccz + 4096), ccx, ccz, e[13])[type];
        // (hue and seed are one number in the colour: it goes as it was)
        nb.write(nb.alloc(h, i), _m, hue, 0, amp, start);
        held[i] = nb;
      }
    }
    // (and the cells left with nothing in them go)
    for (const [key, bs] of this.cells)
      if (bs.every((b) => b.live === 0)) {
        for (const b of bs) b.dispose();
        this.cells.delete(key);
      }
  }

  unplace(index: number): void {
    const p = this.placed.get(index);
    if (!p) return;
    for (let i = 0; i < p.b.length; i++) if (p.h.at[i] >= 0) p.b[i].release(p.h.at[i]);
    this.placed.delete(index);
  }

  /** Remove a building's sprouts (e.g. paint reset). */
  clear(buildingIndex: number): void {
    const rec = this.recs.get(buildingIndex);
    if (!rec) return;
    this.release(rec);
    this.recs.delete(buildingIndex);
  }

  /** Remove everything. */
  clearAll(): void {
    for (const rec of this.recs.values()) this.release(rec);
    this.recs.clear();
  }

  dispose(): void {
    for (const cell of this.cells.values()) for (const b of cell) b.dispose();
    this.cells.clear();
    this.recs.clear();
    for (const t of this.types) {
      t.geo.dispose();
      t.mat.dispose();
      t.depth?.dispose();
    }
  }

  private release(rec: Rec) {
    const cell = this.cells.get(rec.cell);
    if (cell) this.fit(rec, cell, 0);
    rec.drawn = 0;
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}
