import * as THREE from 'three';
import { globals, GLSL_COMMON, GLSL_OUT, SHADOW_LAYER } from '../../render/materials';
import { Ramp } from '../../render/palette';
import { GLSL_PROPS, hash2, propsTune, treeUniforms, tuneUniform, unitSphere } from './common';

// Trees: ONE template geometry (a trunk + five unit lobes) for every species.
// The vertex shader builds each tree from its instance data — species
// (street tree, eucalyptus, Monterey pine, cypress flame), per-tree jitter of
// every lobe, lumpy crowns, paint pop and sway — so a whole 256 m tile of
// trees is a single InstancedMesh draw call and no two trees look alike.
// A depth-only twin draws the same shapes into the sun's shadow map.
//
// Instance data: instanceMatrix = position + yaw + size,
// instanceColor = (kind * 8 + hueSlot + 0.9 * seed, level, startTime)
// where hueSlot 0 = grey, 1..6 = painted with hue (slot - 1).

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  size: number /*0.6..1.6*/;
  kind: number /*0 street tree, 1 park tree, 2 cypress*/;
}

// lobe tables, template meters at size 1: (cx, cy, cz, r) + vertical aspect
// variant 0 street tree, 1 eucalyptus, 2 Monterey pine, 3 cypress flame
const LOBES: Array<[number, number, number, number, number]> = [
  // street tree: a round, slightly lopsided crown on a short trunk
  [0.0, 5.6, 0.0, 3.0, 0.88],
  [1.7, 5.0, 0.8, 2.15, 0.84],
  [-1.5, 5.2, -1.0, 2.15, 0.86],
  [0.4, 7.2, -0.3, 2.0, 0.9],
  [-0.6, 4.6, 1.5, 1.8, 0.8],
  // eucalyptus: tall, a loose billowing column of big clumps
  [0.0, 10.6, 0.0, 4.4, 0.8],
  [3.1, 12.6, 1.2, 3.8, 0.85],
  [-2.9, 13.4, -1.4, 3.9, 0.85],
  [0.8, 16.4, 0.6, 3.5, 0.9],
  [-0.9, 19.0, -0.5, 2.5, 1.0],
  // Monterey pine: a broad umbrella of flattened clumps
  [0.0, 12.6, 0.0, 5.0, 0.5],
  [3.4, 13.2, 1.6, 3.7, 0.55],
  [-3.2, 13.6, -1.8, 3.7, 0.55],
  [0.6, 14.8, -0.6, 3.5, 0.55],
  [-1.4, 11.8, 3.0, 3.0, 0.5],
  // cypress: a dark stacked flame with a leaning tip
  [0.0, 5.0, 0.0, 3.6, 1.1],
  [0.15, 8.8, 0.05, 3.0, 1.15],
  [0.25, 12.2, 0.1, 2.3, 1.2],
  [0.45, 14.9, 0.05, 1.6, 1.3],
  [0.7, 16.9, 0.0, 0.95, 1.4],
];
// crown mass per variant: (center y, radius xz, radius y, top y)
const MASS: Array<[number, number, number, number]> = [
  [5.7, 3.5, 2.9, 9.0],
  [14.2, 5.9, 6.6, 21.5],
  [13.3, 6.6, 2.9, 16.7],
  [10.0, 3.6, 8.2, 18.3],
];
// trunk per variant: (width, height, lean, top taper)
const TRUNK: Array<[number, number, number, number]> = [
  [0.7, 4.8, 0.25, 0.6],
  [1.05, 11.0, 0.9, 0.55],
  [1.05, 12.6, 0.7, 0.6],
  [0.9, 3.4, 0.15, 0.6],
];

/** Effective model scale for a baked tree size (park trees compressed so groves stay a canopy, not a skyline). */
export function treeScale(kind: number, size: number): number {
  const s = Math.max(0.3, size);
  return kind === 0 ? s : 0.78 + 0.5 * (s - 0.75);
}

/**
 * Height of a tree's crown top above its base (m) — for the flight /
 * obstacle code so the bus skims over a grove instead of through it.
 * (Max over the species a park tree can become.)
 */
export function treeHeight(kind: number, size: number): number {
  const k = Math.max(0, Math.min(2, Math.round(kind)));
  const top = k === 0 ? MASS[0][3] : k === 2 ? MASS[3][3] : MASS[1][3];
  return top * treeScale(k, size) * 1.06;
}

// park crowns are wide so the baked ~15 m spacing closes into a canopy
for (let i = 5; i < 15; i++) {
  LOBES[i][0] *= 1.25;
  LOBES[i][2] *= 1.25;
  LOBES[i][3] *= 1.14;
}
for (let i = 15; i < 20; i++) LOBES[i][3] *= 1.08;
MASS[1][1] *= 1.3;
MASS[2][1] *= 1.3;
MASS[3][1] *= 1.08;

const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const LOBE_GLSL = LOBES.map((l) => `vec4(${f(l[0])}, ${f(l[1])}, ${f(l[2])}, ${f(l[3])})`).join(',\n  ');
const LOBE_YS_GLSL = LOBES.map((l) => f(l[4])).join(', ');
const MASS_GLSL = MASS.map((m) => `vec4(${m.map(f).join(', ')})`).join(', ');
const TRUNK_GLSL = TRUNK.map((m) => `vec4(${m.map(f).join(', ')})`).join(', ');

/** Shared vertex code: builds the tree in template space, pops and sways it. */
const TREE_VERTEX = /* glsl */ `
in float aLobe;
in float aRand;
uniform vec4 uTreeShape; // lump, sway, pop amp, -
uniform float uCoreScale; // size of the single-solid canopy (lobe 6)
const vec4 T_LOBE[20] = vec4[20](
  ${LOBE_GLSL}
);
const float T_LOBE_YS[20] = float[20](${LOBE_YS_GLSL});
const vec4 T_MASS[4] = vec4[4](${MASS_GLSL});
const vec4 T_TRUNK[4] = vec4[4](${TRUNK_GLSL});

struct TreeV {
  vec4 world;
  vec3 normal;   // template space (trunk only)
  vec3 rest;     // template space, before pop/sway
  vec3 lobeC;    // world: center of this vertex's lobe (analytic per-pixel normals)
  vec3 lobeR;    // world radii of the lobe (0 = trunk)
  vec3 massC;    // world: center of the whole crown
  vec3 massR;
  float variant;
  float hueSlot;
  float level;
  float start;
  float seed;
  float trunk;
  float top;
  float size;
};

TreeV treeVertex() {
  TreeV o;
  vec3 ic = vec3(0.0);
  #ifdef USE_INSTANCING_COLOR
  ic = instanceColor;
  #endif
  float code = floor(ic.x);
  float seed = clamp(fract(ic.x) / 0.9, 0.0, 1.0);
  float kind = floor(code / 8.0 + 0.01);
  float hueSlot = code - kind * 8.0;
  float level = ic.y;
  float start = ic.z;
  vec3 ipos = instanceMatrix[3].xyz;
  float size = length(instanceMatrix[0].xyz);
  float variant = 0.0;
  if (kind > 1.5) variant = 3.0;
  else if (kind > 0.5) {
    // pines come in groves: a coarse world-space field biases the species
    float grove = pHash12(floor(ipos.xz / 75.0) + 17.0);
    variant = fract(seed * 13.17) < 0.06 + 0.5 * grove * grove ? 2.0 : 1.0;
  }
  int vi = int(variant + 0.5);
  int li = int(aLobe + 0.5);
  bool painted = hueSlot > 0.5;
  float tp = uTime - start;
  bool popping = painted && tp >= 0.0;
  vec4 tr = T_TRUNK[vi];
  vec4 M = T_MASS[vi];
  vec2 lean = (vec2(fract(seed * 7.3), fract(seed * 3.1)) - 0.5) * 2.0 * tr.z;
  vec3 mc = vec3(lean.x * 0.85, M.x, lean.y * 0.85);
  vec3 mr = vec3(M.y, M.z, M.y);
  vec3 p;
  vec3 c = mc;
  vec3 rr = vec3(0.0);
  if (li == 0 || li == 7) {
    // trunk (0: square prism at full detail, 7: three-sided spike for the far/shadow shapes)
    float y01 = clamp(position.y, 0.0, 1.0);
    float w = tr.x * mix(1.0, tr.w, y01) * (li == 7 ? 1.25 : 1.0);
    p = vec3(position.x * w, position.y * tr.y, position.z * w);
    p.xz += lean * y01 * y01;
  } else if (li == 6) {
    // one simple canopy: the crown's mass as a single lumpy solid (far LOD + shadow core)
    rr = mr * uCoreScale;
    if (popping) rr *= 1.0 + 0.035 * level;
    p = c + position * rr;
  } else {
    int k = vi * 5 + li - 1;
    vec4 L = T_LOBE[k];
    vec3 j = pHash33(vec3(seed * 97.0, float(li) * 7.0, variant + 1.0)) - 0.5;
    c = L.xyz + j * vec3(0.42, 0.22, 0.42) * L.w;
    // trunk lean carries the crown with it
    c.xz += lean * clamp(c.y / tr.y, 0.0, 1.3);
    float r = L.w * (0.88 + 0.24 * pHash13(vec3(seed * 41.0, float(li), 3.0)));
    if (popping) r *= 1.0 + 0.035 * level;
    rr = vec3(r, r * T_LOBE_YS[k], r);
    p = c + position * rr;
  }
  o.rest = p;
  float top = M.w;
  if (popping) {
    float sy = propPop(tp, uTreeShape.z);
    float sxz = inversesqrt(max(sy, 0.3));
    vec3 sc = vec3(sxz, sy, sxz);
    p *= sc;
    c *= sc;
    rr *= sc;
    mc *= sc;
    mr *= sc;
  }
  mat4 mi = modelMatrix * instanceMatrix;
  vec4 wp = mi * vec4(p, 1.0);
  vec3 wc = (mi * vec4(c, 1.0)).xyz;
  vec3 wm = (mi * vec4(mc, 1.0)).xyz;
  if (popping) {
    // a gentle gust that travels through painted groves (grey trees never move)
    float ph = dot(ipos.xz, vec2(0.045, 0.031)) + seed * 1.7;
    float g = smoothstep(0.2, 1.6, tp);
    float b = uTreeShape.y * g * (0.7 * sin(uTime * 1.15 - ph) + 0.3 * sin(uTime * 2.37 - ph * 1.6)) * top * size;
    vec2 wind = vec2(0.83, 0.55) * b;
    float h0 = clamp(o.rest.y / top, 0.0, 1.0);
    float h1 = clamp(c.y / top, 0.0, 1.0);
    float h2 = clamp(mc.y / top, 0.0, 1.0);
    wp.xz += wind * h0 * h0;
    wc.xz += wind * h1 * h1;
    wm.xz += wind * h2 * h2;
  }
  o.world = wp;
  o.normal = normal;
  o.lobeC = wc;
  o.lobeR = rr * size;
  o.massC = wm;
  o.massR = mr * size;
  o.variant = variant;
  o.hueSlot = hueSlot;
  o.level = level;
  o.start = start;
  o.seed = seed;
  o.trunk = (li == 0 || li == 7) ? 1.0 : 0.0;
  o.top = top;
  o.size = size;
  return o;
}
`;

const TREE_VS = /* glsl */ `
${GLSL_COMMON}
${GLSL_PROPS}
${TREE_VERTEX}
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vRest;
out float vH01;
flat out vec4 vInfo;   // hueSlot, level, trunk, seed
flat out vec4 vInfo2;  // variant, start, top (m), size
flat out vec3 vLobeC;
flat out vec3 vLobeR;
flat out vec3 vMassC;
flat out vec3 vMassR;
void main() {
  TreeV t = treeVertex();
  vWorldPos = t.world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * t.normal));
  vRest = t.rest * t.size;
  vH01 = clamp(t.rest.y / t.top, 0.0, 1.0);
  vInfo = vec4(t.hueSlot, t.level, t.trunk, t.seed);
  vInfo2 = vec4(t.variant, t.start, t.top * t.size, t.size);
  vLobeC = t.lobeC;
  vLobeR = max(t.lobeR, vec3(0.01));
  vMassC = t.massC;
  vMassR = max(t.massR, vec3(0.01));
  gl_Position = projectionMatrix * viewMatrix * t.world;
}
`;

const TREE_DEPTH_VS = /* glsl */ `
precision highp float;
uniform float uTime;
${GLSL_PROPS}
${TREE_VERTEX}
void main() {
  TreeV t = treeVertex();
  gl_Position = projectionMatrix * viewMatrix * t.world;
}
`;

const TREE_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_PROPS}
uniform float uClump;
uniform float uRim;
uniform float uAO;
uniform float uMassBlend;
uniform float uCarve;
uniform float uTint;
uniform float uLeafEdge;
uniform vec3 uBlossom;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vRest;
in float vH01;
flat in vec4 vInfo;
flat in vec4 vInfo2;
flat in vec3 vLobeC;
flat in vec3 vLobeR;
flat in vec3 vMassC;
flat in vec3 vMassR;
${GLSL_OUT}
const float VAR_LO[4] = float[4](0.0, 0.035, -0.05, -0.075);
void main() {
  float hueSlot = vInfo.x;
  float level = vInfo.y;
  bool trunk = vInfo.z > 0.5;
  float seed = vInfo.w;
  int vi = int(vInfo2.x + 0.5);
  float tp = uTime - vInfo2.y;
  bool painted = hueSlot > 0.5 && tp >= 0.0;
  // paint floods down the tree from the crown
  if (painted && (vInfo2.z - vRest.y) > tp * 55.0) painted = false;
  vec3 n;
  if (trunk) {
    n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
  } else {
    // every lobe is carved to a true (slightly leafy) ellipsoid: a per-pixel
    // ray test against the lobe gives round pixel-crisp clumps whatever the
    // tessellation, and the hit point gives a smooth analytic normal
    vec3 q = (vWorldPos - vLobeC) / vLobeR;
    vec3 v = normalize((vWorldPos - cameraPosition) / vLobeR);
    float qv = dot(q, v);
    float d2 = dot(q, q) - qv * qv;
    float sl = fract(dot(vLobeC, vec3(0.131, 0.071, 0.173)));
    float rc = uCarve * (1.0 - uLeafEdge * pNoise3(normalize(q) * 2.4 + sl * 17.0));
    if (d2 > rc * rc) discard;
    vec3 hit = q - v * (qv + sqrt(max(rc * rc - d2, 0.0)));
    vec3 nl = normalize(hit / vLobeR);
    vec3 hw = vLobeC + hit * vLobeR;
    vec3 nm = normalize((hw - vMassC) / (vMassR * vMassR));
    n = normalize(mix(nl, nm, uMassBlend));
  }
  vec3 vn = normalize(mat3(viewMatrix) * n);
  float ramp;
  float lo;
  float glow = 0.0;
  bool blossom = false;
  if (trunk) {
    ramp = painted ? ${Ramp.VIOLET}.0 : ${Ramp.GREY}.0;
    lo = painted ? -0.16 : (vi == 1 ? -0.02 : -0.13);
  } else {
    ramp = painted ? ${Ramp.GREEN}.0 : ${Ramp.GREEN_GREY}.0;
    lo = VAR_LO[vi] + (painted ? -0.02 : 0.0);
    // crown self-occlusion: darker underneath, a touch brighter on top
    lo += mix(-uAO, uAO * 0.25, smoothstep(0.25, 0.95, vH01));
    #ifndef TREE_LOD1
    // leaf clumps (far trees are a few pixels: skip)
    float cl = pNoise3(vRest * 0.5 + seed * 23.0);
    lo += (cl - 0.5) * uClump * 2.0;
    // finer leaf texture only when a pixel is small enough to hold it (no crawl)
    float fw = length(fwidth(vRest));
    float fine = 1.0 - smoothstep(0.1, 0.22, fw);
    if (fine > 0.0) lo += (pNoise3(vRest * 1.7 + seed * 5.0) - 0.5) * 0.2 * fine;
    #endif
    // crown rim darkens so neighbouring crowns separate in a grove
    float rim = 1.0 - abs(vn.z);
    lo -= uRim * smoothstep(0.62, 0.97, rim);
    if (painted) {
      #ifdef TREE_LOD1
      vec3 bq = vRest * 0.36 + seed * 31.0; // coarser blossoms far away: never single crawling pixels
      #else
      vec3 bq = vRest * 0.6 + seed * 31.0;
      #endif
      vec3 cell = floor(bq);
      vec3 fr = fract(bq);
      float h = pHash13(cell);
      vec3 cc = 0.32 + 0.36 * pHash33(cell + 5.0);
      float dens = level > 2.5 ? uBlossom.z : (level > 1.5 ? uBlossom.y : uBlossom.x);
      if (h < dens && length(fr - cc) < 0.36) {
        float hue = hueSlot - 1.0;
        if (level > 1.5 && fract(h * 7.31) < 0.3) hue += (fract(h * 3.7) < 0.5 ? 1.0 : -1.0);
        float br = propHueRamp(hue);
        // a green tree can't blossom green: pear-white blossoms instead
        ramp = br == ${Ramp.GREEN}.0 ? ${Ramp.WHITE}.0 : br;
        lo = 0.1 + 0.08 * vH01;
        blossom = true;
        if (level > 2.5) glow = 0.22;
      }
    }
  }
  float light = sbLight(vWorldPos, n, lo, 1.0);
  // painted crowns are rainbow-tinted: their shadow side turns to the paint's hue
  ivec2 fc = ivec2(gl_FragCoord.xy);
  float dz = float((fc.x + fc.y) & 1) * 0.03 + float(fc.y & 1) * 0.015;
  if (painted && !trunk && !blossom && light + dz < uTint) {
    float tr = propHueRamp(hueSlot - 1.0);
    ramp = tr == ${Ramp.GREEN}.0 ? ${Ramp.BLUE}.0 : tr;
  }
  light = max(light, glow);
  float fog = sbFog(vWorldPos);
  sbWrite(ramp, light, fog, glow, vn, fract(seed * 0.731 + 0.13), 1.0);
}
`;

// ---------------------------------------------------------------- shared GPU resources
//
// Triangles per tree:  LOD 0 = 108 (square trunk + five 20-face lobes),
//                      LOD 1 = 11  (one 8-face canopy + a 3-face trunk spike),
//                      shadow caster = 23 (one 20-face canopy core + spike), any LOD.

interface TreeRes {
  geo0: THREE.BufferGeometry;
  geo1: THREE.BufferGeometry;
  geoShadow: THREE.BufferGeometry;
  mat0: THREE.ShaderMaterial;
  mat1: THREE.ShaderMaterial;
  depth: THREE.ShaderMaterial;
}
let res: TreeRes | null = null;

class TemplateBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  lobe: number[] = [];
  rnd: number[] = [];
  idx: number[] = [];
  private s = 12345;
  r() {
    this.s = (this.s * 16807) % 2147483647;
    return this.s / 2147483647;
  }
  /** Square prism trunk, flat faces, y -0.25..1 (sunk into the ground). */
  trunkPrism() {
    for (const [nx, nz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const tx = -nz, tz = nx;
      const b = this.pos.length / 3;
      for (const [sd, y] of [
        [-1, -0.25],
        [1, -0.25],
        [1, 1],
        [-1, 1],
      ]) {
        this.pos.push(nx * 0.5 + tx * 0.5 * sd, y, nz * 0.5 + tz * 0.5 * sd);
        this.nrm.push(nx, 0, nz);
        this.lobe.push(0);
        this.rnd.push(0);
      }
      this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  }
  /** Three-sided spike trunk (3 triangles), apex at y = 1. */
  trunkSpike() {
    const b = this.pos.length / 3;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      this.pos.push(Math.cos(a) * 0.5, -0.25, Math.sin(a) * 0.5);
      this.nrm.push(Math.cos(a), 0.2, Math.sin(a));
      this.lobe.push(7);
      this.rnd.push(0);
    }
    this.pos.push(0, 1, 0);
    this.nrm.push(0, 1, 0);
    this.lobe.push(7);
    this.rnd.push(0);
    for (let i = 0; i < 3; i++) this.idx.push(b + i, b + 3, b + ((i + 1) % 3));
  }
  sphere(g: THREE.BufferGeometry, lobe: number) {
    const sp = g.getAttribute('position');
    const si = g.getIndex()!;
    const b = this.pos.length / 3;
    for (let i = 0; i < sp.count; i++) {
      this.pos.push(sp.getX(i), sp.getY(i), sp.getZ(i));
      this.nrm.push(sp.getX(i), sp.getY(i), sp.getZ(i));
      this.lobe.push(lobe);
      this.rnd.push(this.r());
    }
    for (let i = 0; i < si.count; i++) this.idx.push(b + si.getX(i));
  }
  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('aLobe', new THREE.Float32BufferAttribute(this.lobe, 1));
    geo.setAttribute('aRand', new THREE.Float32BufferAttribute(this.rnd, 1));
    geo.setIndex(this.idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 9, 0), 14);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-6, -0.5, -6), new THREE.Vector3(6, 19, 6));
    return geo;
  }
}

const blossomV = new THREE.Vector3();
const DEPTH_FS = /* glsl */ `
  precision highp float;
  layout(location = 0) out highp vec4 outDepthColor;
  void main() { outDepthColor = vec4(1.0); }
`;

function treeResources(): TreeRes {
  if (res) return res;
  const ico0 = unitSphere('ico', 0);
  const b0 = new TemplateBuilder();
  b0.trunkPrism();
  for (let l = 1; l <= 5; l++) b0.sphere(ico0, l);
  const b1 = new TemplateBuilder();
  b1.sphere(unitSphere('octa0'), 6);
  b1.trunkSpike();
  const bs = new TemplateBuilder();
  bs.sphere(ico0, 6);
  bs.trunkSpike();

  const uniforms: Record<string, THREE.IUniform> = {
    ...globals,
    ...treeUniforms,
    uCoreScale: { value: 1.0 },
    uClump: tuneUniform('treeClump'),
    uRim: tuneUniform('treeRim'),
    uAO: tuneUniform('treeAO'),
    uMassBlend: tuneUniform('treeMass'),
    uLeafEdge: tuneUniform('treeLump'),
    uCarve: { value: 0.785 },
    uTint: tuneUniform('treeTint'),
    uBlossom: {
      get value() {
        return blossomV.set(propsTune.blossom1, propsTune.blossom2, propsTune.blossom3);
      },
      set value(_v: THREE.Vector3) {},
    } as THREE.IUniform,
  };
  const mat0 = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: TREE_VS, fragmentShader: TREE_FS });
  // the far canopy is a diamond-ish solid: a little bigger than the crown's mass so it covers the same pixels
  const mat1 = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines: { TREE_LOD1: 1 },
    uniforms: { ...uniforms, uCoreScale: { value: 1.45 }, uCarve: { value: 0.565 } },
    vertexShader: TREE_VS,
    fragmentShader: TREE_FS,
  });
  // shadow core sits just inside the crown, so lit lobes are never shadowed by it
  const depth = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uTime: globals.uTime, ...treeUniforms, uCoreScale: { value: 0.8 } },
    vertexShader: TREE_DEPTH_VS,
    fragmentShader: DEPTH_FS,
  });
  depth.allowOverride = false; // keep our shapes in the sun's depth pass
  res = { geo0: b0.build(), geo1: b1.build(), geoShadow: bs.build(), mat0, mat1, depth };
  return res;
}

// ---------------------------------------------------------------- TreeField

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export type TreeLod = 0 | 1 | 2;

/** All the trees of one city tile: one instanced draw (+ its shadow twin). */
export class TreeField {
  readonly object: THREE.Object3D;
  private readonly mesh: THREE.InstancedMesh;
  private readonly caster: THREE.InstancedMesh;
  private readonly data: Float32Array;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly res: TreeRes;
  private lod: TreeLod = 0;
  private cast = true;
  private disposed = false;

  constructor(trees: TreeInstance[]) {
    const r = treeResources();
    this.res = r;
    const n = trees.length;
    const mesh = new THREE.InstancedMesh(r.geo0, r.mat0, n);
    const data = new Float32Array(Math.max(1, n) * 3);
    const color = new THREE.InstancedBufferAttribute(data, 3);
    mesh.instanceColor = color;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const t = trees[i];
      const seed = hash2(t.x, t.z);
      const kind = Math.max(0, Math.min(2, Math.round(t.kind)));
      const size = treeScale(kind, t.size);
      _q.setFromAxisAngle(_up, seed * Math.PI * 2 * 7.0);
      _p.set(t.x, t.y - 0.15, t.z);
      _s.setScalar(size);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      data[i * 3] = kind * 8 + 0.9 * seed;
      data[i * 3 + 1] = 0;
      data[i * 3 + 2] = -1e4;
      minX = Math.min(minX, t.x);
      maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y);
      maxY = Math.max(maxY, t.y + 23 * size);
      minZ = Math.min(minZ, t.z);
      maxZ = Math.max(maxZ, t.z);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // frustum culling: the shader builds the crowns, so the bounds are ours
    const sphere = new THREE.Sphere();
    if (n > 0) {
      const c = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      sphere.set(c, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 12);
    }
    mesh.boundingSphere = sphere;
    mesh.visible = n > 0;

    // shadow twin: same instance buffers, cheap core shape, depth-only material, sun layer only
    const caster = new THREE.InstancedMesh(r.geoShadow, r.depth, 0);
    caster.instanceMatrix = mesh.instanceMatrix;
    caster.instanceColor = color;
    caster.count = n;
    caster.boundingSphere = sphere;
    caster.layers.set(SHADOW_LAYER);
    caster.visible = n > 0;

    const g = new THREE.Group();
    g.name = 'TreeField';
    g.add(mesh, caster);
    this.object = g;
    this.mesh = mesh;
    this.caster = caster;
    this.data = data;
    this.color = color;
  }

  /** Number of trees in this field. */
  get count(): number {
    return this.mesh.count;
  }

  /** Current level of detail. */
  get level(): TreeLod {
    return this.lod;
  }

  /**
   * Distance LOD, cheap enough to call per tile per frame (no allocation,
   * early-out when unchanged): 0 = full crowns (+ shadows), 1 = one simple
   * canopy per tree (no shadows), 2 = hidden (the fog has it).
   */
  setLod(level: TreeLod): void {
    if (level === this.lod || this.disposed) return;
    this.lod = level;
    const on = this.mesh.count > 0;
    if (level === 2) {
      this.mesh.visible = false;
    } else {
      this.mesh.visible = on;
      this.mesh.geometry = level === 0 ? this.res.geo0 : this.res.geo1;
      this.mesh.material = level === 0 ? this.res.mat0 : this.res.mat1;
    }
    this.castShadow = level === 0;
  }

  /** Whether this field draws into the sun's shadow map (on at LOD 0, off at LOD 1 by default). */
  get castShadow(): boolean {
    return this.cast;
  }
  set castShadow(v: boolean) {
    this.cast = v;
    this.caster.visible = v && this.lod < 2 && this.mesh.count > 0 && !this.disposed;
  }

  /**
   * A painted tree pops (squash & stretch) at startTime and turns into a lush
   * rainbow-blossomed tree that sways forever. Re-painting at the same or a
   * lower level is ignored (no re-pop while a cascade washes over it).
   */
  setPaint(index: number, hue: number, level: number, startTime: number): void {
    if (this.disposed || index < 0 || index >= this.mesh.count) return;
    const d = this.data;
    const o = index * 3;
    const code = Math.floor(d[o]);
    const seedPart = d[o] - code;
    const kind = Math.floor(code / 8 + 0.01);
    const prevSlot = code - kind * 8;
    const lv = Math.max(1, Math.min(3, Math.round(level)));
    if (prevSlot > 0 && lv <= d[o + 1]) return;
    const h = ((Math.round(hue) % 6) + 6) % 6;
    d[o] = kind * 8 + (h + 1) + seedPart;
    d[o + 1] = lv;
    d[o + 2] = startTime;
    this.color.needsUpdate = true;
  }

  /** Back to grey (e.g. paint reset). */
  clearPaint(index: number): void {
    if (this.disposed || index < 0 || index >= this.mesh.count) return;
    const d = this.data;
    const o = index * 3;
    const code = Math.floor(d[o]);
    const kind = Math.floor(code / 8 + 0.01);
    d[o] = kind * 8 + (d[o] - code);
    d[o + 1] = 0;
    d[o + 2] = -1e4;
    this.color.needsUpdate = true;
  }

  /** Frees this field's instance buffers (shared geometry/material stay alive). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    this.mesh.dispose();
    this.caster.dispose();
  }
}
