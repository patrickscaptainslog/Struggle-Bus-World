import * as THREE from 'three';
import { globals, GLSL_COMMON, GLSL_OUT, SHADOW_LAYER } from '../../render/materials';
import { Ramp } from '../../render/palette';
import { GLSL_PROPS, PartKit, propsTune, rng, tuneUniform, unitSphere } from './common';

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
}

interface TypeDef {
  geo: () => THREE.BufferGeometry;
  cast: boolean;
  doubleSide?: boolean;
  /** sway frequency (Hz-ish), local sway direction weights, distance-cull flag, amplitude tune key */
  freq: number;
  dir: [number, number];
  cull: boolean;
  tune: 'sproutSway' | 'flagFlutter';
  capacity: number;
}

// ---------------------------------------------------------------- geometry

let _octa: THREE.BufferGeometry | null = null;
let _octa0: THREE.BufferGeometry | null = null;
const octa = () => (_octa ??= unitSphere('octa', 1));
const octa0 = () => (_octa0 ??= unitSphere('octa0'));
const swayY = (h: number) => (_x: number, y: number) => Math.max(0, Math.min(1, y / h)) ** 2;

function tuftGeo(): THREE.BufferGeometry {
  const k = new PartKit();
  const s = swayY(0.85);
  k.blob(octa(), 0, 0.2, 0, 0.64, 0.5, 0.64, Part.FOLIAGE, s);
  const heads: Array<[number, number, number, number, number]> = [
    [0.3, 0.58, 0.12, 0.28, Part.BLOSSOM],
    [-0.28, 0.55, 0.1, 0.27, Part.BLOSSOM2],
    [0.02, 0.62, -0.3, 0.28, Part.BLOSSOM],
    [0.04, 0.76, 0.04, 0.24, Part.BLOSSOM],
  ];
  for (const [x, y, z, r, p] of heads) k.blob(octa0(), x, y, z, r, r, r, p, s);
  return k.build();
}

function bushGeo(): THREE.BufferGeometry {
  const k = new PartKit();
  const s = swayY(1.7);
  k.blob(octa(), 0, 0.72, 0, 1.0, 0.82, 1.0, Part.FOLIAGE, s);
  k.blob(octa(), 0.8, 0.5, 0.3, 0.72, 0.6, 0.72, Part.FOLIAGE, s);
  k.blob(octa(), -0.62, 0.55, -0.44, 0.74, 0.62, 0.74, Part.FOLIAGE, s);
  k.blob(octa(), -0.22, 0.45, 0.72, 0.62, 0.52, 0.62, Part.FOLIAGE, s);
  const b: Array<[number, number, number, number]> = [
    [0.45, 1.3, 0.2, Part.BLOSSOM],
    [-0.42, 1.24, -0.3, Part.BLOSSOM2],
    [0.08, 1.5, -0.18, Part.BLOSSOM],
    [0.95, 0.88, 0.5, Part.BLOSSOM],
    [-0.72, 0.98, 0.32, Part.BLOSSOM2],
    [-0.2, 0.8, 1.05, Part.BLOSSOM],
  ];
  for (const [x, y, z, p] of b) k.blob(octa0(), x, y, z, 0.24, 0.24, 0.24, p, s);
  return k.build();
}

function treeGeo(): THREE.BufferGeometry {
  const k = new PartKit();
  const s = swayY(4.4);
  k.box(0, 1.3, 0, 0.42, 2.6, 0.42, Part.WOOD, s);
  k.blob(octa(), 0, 3.05, 0, 1.45, 1.25, 1.45, Part.FOLIAGE, s);
  k.blob(octa(), 0.85, 2.72, 0.35, 1.02, 0.9, 1.02, Part.FOLIAGE, s);
  k.blob(octa(), -0.7, 3.32, -0.48, 1.06, 0.95, 1.06, Part.FOLIAGE, s);
  k.blob(octa(), 0.12, 3.98, 0.1, 0.92, 0.82, 0.92, Part.FOLIAGE, s);
  const b: Array<[number, number, number, number]> = [
    [0.7, 3.6, 0.6, Part.BLOSSOM],
    [-0.9, 3.75, 0.2, Part.BLOSSOM2],
    [0.3, 4.6, -0.3, Part.BLOSSOM],
    [1.45, 2.9, -0.2, Part.BLOSSOM],
    [-0.5, 2.6, 1.1, Part.BLOSSOM2],
    [0.0, 3.2, -1.35, Part.BLOSSOM],
  ];
  for (const [x, y, z, p] of b) k.blob(octa0(), x, y, z, 0.26, 0.26, 0.26, p, s);
  return k.build();
}

function planterGeo(): THREE.BufferGeometry {
  const k = new PartKit();
  const s = (_x: number, y: number) => (y > 0.5 ? 0.6 : 0);
  k.box(0, 0.27, 0, 2.4, 0.56, 0.72, Part.BODY2, () => 0);
  k.box(0, 0.58, 0, 2.5, 0.08, 0.8, Part.WHITE, () => 0);
  k.blob(octa(), 0, 0.68, 0, 1.15, 0.26, 0.33, Part.FOLIAGE, s);
  for (let i = 0; i < 6; i++) {
    const x = -0.95 + i * 0.38;
    k.blob(octa0(), x, 0.84 + (i % 2) * 0.06, (i % 2 ? -0.1 : 0.12), 0.22, 0.22, 0.22, i % 2 ? Part.BLOSSOM2 : Part.BLOSSOM, s);
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
  k.blob(octa(), 0, 4.9, 0, 0.3, 0.3, 0.3, Part.GOLD, s);
  return k.build();
}

function spireGeo(): THREE.BufferGeometry {
  const k = new PartKit();
  const s = swayY(7);
  k.box(0, 0.3, 0, 0.95, 0.6, 0.95, Part.WHITE, s);
  k.box(0, 3.25, 0, 0.44, 5.6, 0.44, Part.BODY, s);
  k.blob(octa(), 0, 4.15, 0, 0.46, 0.46, 0.46, Part.BODY2, s);
  k.blob(octa(), 0, 6.65, 0, 0.8, 0.8, 0.8, Part.GOLD, s);
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

const TYPES: TypeDef[] = [
  { geo: tuftGeo, cast: false, freq: 1.9, dir: [1, 0.6], cull: true, tune: 'sproutSway', capacity: 1024 },
  { geo: bushGeo, cast: true, freq: 1.3, dir: [1, 0.6], cull: false, tune: 'sproutSway', capacity: 512 },
  { geo: treeGeo, cast: true, freq: 1.05, dir: [1, 0.6], cull: false, tune: 'sproutSway', capacity: 256 },
  { geo: planterGeo, cast: false, freq: 1.7, dir: [0.3, 1], cull: true, tune: 'sproutSway', capacity: 256 },
  { geo: domeGeo, cast: true, freq: 0.8, dir: [1, 0.7], cull: false, tune: 'sproutSway', capacity: 128 },
  { geo: spireGeo, cast: true, freq: 0.9, dir: [1, 0.7], cull: false, tune: 'sproutSway', capacity: 128 },
  { geo: flagGeo, cast: false, doubleSide: true, freq: 4.6, dir: [0.25, 1], cull: true, tune: 'flagFlutter', capacity: 1024 },
  { geo: turfGeo, cast: false, freq: 0, dir: [0, 0], cull: false, tune: 'sproutSway', capacity: 256 },
];

// ---------------------------------------------------------------- shaders

const SPROUT_VERTEX = /* glsl */ `
in float aPart;
in float aSway;
in vec4 aBlobC;
in vec3 aBlobR;
uniform vec4 uKind;    // freq, dirX, dirZ, cull flag
uniform float uAmpMul;
uniform float uCull;
struct SproutV { vec4 world; vec3 normal; vec3 local; vec3 blobC; vec3 blobR; float hue; float seed; float part; bool hidden; };
SproutV sproutVertex() {
  SproutV o;
  vec3 ic = vec3(0.0, 0.0, 1e9);
  #ifdef USE_INSTANCING_COLOR
  ic = instanceColor;
  #endif
  o.hue = floor(ic.x);
  o.seed = clamp(fract(ic.x) / 0.9, 0.0, 1.0);
  o.part = aPart;
  o.normal = normal;
  float t = uTime - ic.z;
  vec3 ipos = instanceMatrix[3].xyz;
  o.hidden = t <= 0.0 || (uKind.w > 0.5 && distance(cameraPosition, ipos) > uCull);
  if (o.hidden) { o.world = vec4(0.0); return o; }
  // spring up out of the roof: grow with overshoot, stretch while growing, squash on landing
  float g = propGrow(t);
  float st = 0.34 * exp(-5.0 * t) * sin(11.0 * t);
  vec3 sc = vec3(g * (1.0 - 0.5 * st), g * (1.0 + st), g * (1.0 - 0.5 * st));
  vec3 p = position * sc;
  vec3 c = aBlobC.xyz * sc;
  // painted things move: gentle sway (plants), flutter (bunting), wobble (domes)
  float ph = dot(ipos.xz, vec2(0.11, 0.07)) + o.seed * 6.283;
  float a = ic.y * uAmpMul * smoothstep(0.15, 0.9, t);
  vec3 sw = vec3(uKind.y * sin(uTime * uKind.x + ph), 0.0, uKind.z * sin(uTime * uKind.x * 1.37 + ph * 1.9)) * a;
  p += sw * aSway;
  c += sw * aBlobC.w;
  o.local = p;
  o.blobC = c;
  o.blobR = aBlobR * sc;
  o.world = modelMatrix * (instanceMatrix * vec4(p, 1.0));
  return o;
}
`;

const SPROUT_VS = /* glsl */ `
${GLSL_COMMON}
${GLSL_PROPS}
${SPROUT_VERTEX}
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vLocal;
flat out vec3 vInfo; // hue, seed, part
flat out vec3 vBlobC;
flat out vec3 vBlobR;
flat out vec3 vCamLocal;
flat out vec4 vXf;   // instance yaw (cos, sin) + scale xz
flat out float vSy;
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
  gl_Position = projectionMatrix * viewMatrix * s.world;
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
uniform float uLeafEdge;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vLocal;
flat in vec3 vInfo;
flat in vec3 vBlobC;
flat in vec3 vBlobR;
flat in vec3 vCamLocal;
flat in vec4 vXf;
flat in float vSy;
${GLSL_OUT}
float bloomRamp(float h) {
  float r = propHueRamp(h);
  return r == ${Ramp.GREEN}.0 ? ${Ramp.YELLOW}.0 : r;
}
void main() {
  float hue = vInfo.x;
  float seed = vInfo.y;
  int part = int(vInfo.z + 0.5);
  vec3 n;
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
  } else {
    n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
  }
  float ramp = ${Ramp.GREEN}.0;
  float lo = 0.0;
  float glow = 0.0;
  float nz = pNoise3(vWorldPos * 1.4 + seed * 13.0) - 0.5;
  if (part == ${Part.FOLIAGE}) { ramp = ${Ramp.GREEN}.0; lo = -0.03 + nz * 0.12; }
  else if (part == ${Part.TURF}) {
    ramp = ${Ramp.GREEN}.0;
    lo = -0.1 + (pNoise3(vec3(vWorldPos.xz * 0.45, seed * 9.0)) - 0.5) * 0.18;
  }
  else if (part == ${Part.BLOSSOM}) { ramp = bloomRamp(hue); lo = 0.13; }
  else if (part == ${Part.BLOSSOM2}) {
    float h2 = hue + 1.0;
    if (propHueRamp(h2) == ${Ramp.GREEN}.0) h2 += 1.0;
    ramp = bloomRamp(h2);
    lo = 0.13;
  }
  else if (part == ${Part.WOOD}) { ramp = ${Ramp.VIOLET}.0; lo = -0.2; }
  else if (part == ${Part.GOLD}) { ramp = ${Ramp.YELLOW}.0; lo = 0.1; glow = 0.16; }
  else if (part == ${Part.WHITE}) { ramp = ${Ramp.WHITE}.0; lo = -0.03; }
  else if (part == ${Part.BODY}) { ramp = propHueRamp(hue); lo = 0.02; }
  else { ramp = propHueRamp(hue + 2.0); lo = 0.0; }
  vec3 vn = normalize(mat3(viewMatrix) * n);
  if (part == ${Part.FOLIAGE}) lo -= 0.08 * smoothstep(0.65, 0.97, 1.0 - abs(vn.z));
  float light = sbLight(vWorldPos, n, lo, 1.0);
  light = max(light, glow);
  float fog = sbFog(vWorldPos);
  sbWrite(ramp, light, fog, glow, vn, fract(seed * 0.37 + float(part) * 0.113), 1.0);
}
`;

// ---------------------------------------------------------------- batches

const ZERO16 = new Float32Array(16);

class Batch {
  mesh: THREE.InstancedMesh;
  caster: THREE.InstancedMesh | null = null;
  capacity: number;
  hwm = 0;
  private free: number[] = [];

  constructor(
    readonly geo: THREE.BufferGeometry,
    readonly mat: THREE.ShaderMaterial,
    readonly depth: THREE.ShaderMaterial | null,
    capacity: number,
    readonly group: THREE.Group,
  ) {
    this.capacity = capacity;
    this.mesh = this.makeMesh(capacity, null, null);
  }

  private makeMesh(cap: number, oldM: Float32Array | null, oldC: Float32Array | null): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, 0);
    const m = new Float32Array(cap * 16);
    const c = new Float32Array(cap * 3);
    if (oldM) m.set(oldM);
    if (oldC) c.set(oldC);
    for (let i = oldC ? oldC.length / 3 : 0; i < cap; i++) c[i * 3 + 2] = 1e9; // never sprouts
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(m, 16);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(c, 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = this.hwm;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    if (this.depth) {
      const cs = new THREE.InstancedMesh(this.geo, this.depth, 0);
      cs.instanceMatrix = mesh.instanceMatrix;
      cs.instanceColor = mesh.instanceColor;
      cs.count = this.hwm;
      cs.frustumCulled = false;
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
    this.mesh = this.makeMesh(this.capacity, old.instanceMatrix.array as Float32Array, old.instanceColor!.array as Float32Array);
    old.removeFromParent();
    old.dispose();
    if (oldCaster) {
      oldCaster.removeFromParent();
      oldCaster.dispose();
    }
  }

  alloc(): number {
    if (this.free.length) return this.free.pop()!;
    if (this.hwm >= this.capacity) this.grow();
    const s = this.hwm++;
    this.mesh.count = this.hwm;
    if (this.caster) this.caster.count = this.hwm;
    return s;
  }

  write(slot: number, m: THREE.Matrix4, hue: number, seed: number, amp: number, start: number) {
    const im = this.mesh.instanceMatrix;
    (im.array as Float32Array).set(m.elements, slot * 16);
    im.addUpdateRange(slot * 16, 16);
    im.needsUpdate = true;
    const ic = this.mesh.instanceColor!;
    const c = ic.array as Float32Array;
    c[slot * 3] = hue + 0.9 * seed;
    c[slot * 3 + 1] = amp;
    c[slot * 3 + 2] = start;
    ic.addUpdateRange(slot * 3, 3);
    ic.needsUpdate = true;
  }

  release(slot: number) {
    const im = this.mesh.instanceMatrix;
    (im.array as Float32Array).set(ZERO16, slot * 16);
    im.addUpdateRange(slot * 16, 16);
    im.needsUpdate = true;
    const ic = this.mesh.instanceColor!;
    (ic.array as Float32Array)[slot * 3 + 2] = 1e9;
    ic.addUpdateRange(slot * 3, 3);
    ic.needsUpdate = true;
    this.free.push(slot);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    if (this.caster) {
      this.caster.removeFromParent();
      this.caster.dispose();
    }
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

interface Rec {
  level: number;
  hue: number;
  times: [number, number, number];
  slots: number[]; // type, slot pairs
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class RoofSprouts {
  readonly object: THREE.Object3D;
  private readonly batches: Batch[];
  private readonly recs = new Map<number, Rec>();
  private readonly maxBuildings: number;

  constructor(maxBuildings = 4096) {
    this.maxBuildings = Math.max(1, maxBuildings);
    const group = new THREE.Group();
    group.name = 'RoofSprouts';
    this.object = group;
    this.batches = TYPES.map((def) => {
      const geo = def.geo();
      const kind = new THREE.Vector4(def.freq, def.dir[0], def.dir[1], def.cull ? 1 : 0);
      const uniforms: Record<string, THREE.IUniform> = {
        ...globals,
        uKind: { value: kind },
        uAmpMul: tuneUniform(def.tune),
        uCull: tuneUniform('sproutCull'),
        uLeafEdge: tuneUniform('treeLump'),
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
        depth = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          uniforms: { uTime: globals.uTime, uKind: uniforms.uKind, uAmpMul: uniforms.uAmpMul, uCull: uniforms.uCull },
          vertexShader: SPROUT_DEPTH_VS,
          fragmentShader: /* glsl */ `
            precision highp float;
            layout(location = 0) out highp vec4 outDepthColor;
            void main() { outDepthColor = vec4(1.0); }
          `,
        });
        depth.allowOverride = false;
      }
      return new Batch(geo, mat, depth, def.capacity, group);
    });
  }

  /** Painted buildings currently carrying sprouts. */
  get size(): number {
    return this.recs.size;
  }

  /**
   * Grow (or regrow at a new level) the roof garden of one building. Elements
   * the building already had keep their timing (no re-pop); startTime < now
   * (e.g. -100 when restoring saved paint) means already grown.
   */
  set(buildingIndex: number, roof: RoofRect, hue: number, level: number, startTime: number): void {
    const lvl = Math.max(1, Math.min(3, Math.round(level)));
    const h = ((Math.round(hue) % 6) + 6) % 6;
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
    const rec: Rec = { level: Math.max(lvl, prev?.level ?? 0), hue: h, times, slots: [] };
    const elems = layoutRoof(buildingIndex + 1, roof, h);
    const sinY = Math.sin(roof.yaw), cosY = Math.cos(roof.yaw);
    // roof frame: U along the street (w), N toward the street (d)
    const ux = sinY, uz = cosY, nx = cosY, nz = -sinY;
    const delay0 = propsTune.sproutDelay;
    const showLevel = rec.level;
    for (let i = 0; i < elems.length; i++) {
      const e = elems[i];
      if (e.level > showLevel) continue;
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
      const b = this.batches[e.type];
      const slot = b.alloc();
      const seed = fract(Math.sin((buildingIndex + 1) * 12.9898 + i * 78.233) * 43758.5453);
      const start = times[e.level - 1] + delay0 + e.delay;
      b.write(slot, _m, e.hue, seed, e.amp, start);
      rec.slots.push(e.type, slot);
    }
    this.recs.set(buildingIndex, rec);
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
    for (const b of this.batches) b.dispose();
    this.recs.clear();
  }

  private release(rec: Rec) {
    for (let i = 0; i < rec.slots.length; i += 2) this.batches[rec.slots[i]].release(rec.slots[i + 1]);
    rec.slots.length = 0;
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}
