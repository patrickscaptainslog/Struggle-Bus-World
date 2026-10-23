import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { registerTunables } from '../../ui/tunables';
import { HUE_RAMPS } from '../../render/palette';

// Shared bits for the props module: live tunables (exposed to the shader as
// getter-backed uniforms, so the tuner edits them with zero per-frame code),
// small GLSL helpers, and a tiny geometry kit that bakes per-vertex part ids.

export const propsTune = {
  /** Painted-tree sway (radians-ish bend at the crown). Grey trees never move. */
  treeSway: 0.035,
  /** Lumpiness of canopy lobes (fraction of lobe radius). */
  treeLump: 0.24,
  /** Leaf-clump light variation inside a canopy. */
  treeClump: 0.12,
  /** How much each lobe's shading follows the whole crown (0 = clumpy, 1 = one smooth mass). */
  treeMass: 0.45,
  /** Darkening at the rim of each crown (separates crowns in a grove). */
  treeRim: 0.11,
  /** Underside darkening of crowns (canopy self-occlusion). */
  treeAO: 0.17,
  /** Painted crowns: light level below which the shadow side takes the paint hue (0 = off). */
  treeTint: 0.37,
  /** Blossom density per paint level (level 1 / 2 / 3). */
  blossom1: 0.26,
  blossom2: 0.42,
  blossom3: 0.6,
  /** Squash depth of the paint pop (trees). */
  treePop: 0.3,
  /** Rooftop sprouts: sway amplitude multiplier and bunting flutter. */
  sproutSway: 1,
  flagFlutter: 1,
  /** Seconds before a roof garden starts sprouting (lets the building's own pop settle). */
  sproutDelay: 0.3,
  /** Landmark fog multiplier (<1 lets Sutro / Transamerica read as silhouettes through the fog). */
  landmarkFog: 0.86,
  /** Distance beyond which tiny sprouts (flowers, flags) are skipped (m). */
  sproutCull: 1100,
};

registerTunables('Props', propsTune, {
  treeSway: [0, 0.12, 0.005],
  treeLump: [0, 0.8, 0.02],
  treeClump: [0, 0.5, 0.01],
  treeRim: [0, 0.4, 0.01],
  treeMass: [0, 1, 0.02],
  treeTint: [0, 0.8, 0.02],
  treeAO: [0, 0.4, 0.01],
  blossom1: [0, 1, 0.02],
  blossom2: [0, 1, 0.02],
  blossom3: [0, 1, 0.02],
  treePop: [0, 0.6, 0.02],
  sproutSway: [0, 3, 0.05],
  flagFlutter: [0, 3, 0.05],
  sproutDelay: [0, 1, 0.05],
  landmarkFog: [0.5, 1, 0.01],
  sproutCull: [200, 3000, 50],
});

/** A uniform whose value is read live from propsTune on every upload. */
export function tuneUniform(key: keyof typeof propsTune): THREE.IUniform {
  return {
    get value() {
      return propsTune[key];
    },
    set value(_v: number) {
      /* read-only: edit propsTune */
    },
  } as THREE.IUniform;
}

const v4 = new THREE.Vector4();
export const treeUniforms: Record<string, THREE.IUniform> = {
  uTreeShape: {
    get value() {
      return v4.set(propsTune.treeLump, propsTune.treeSway, propsTune.treePop, 0);
    },
    set value(_v: THREE.Vector4) {},
  } as THREE.IUniform,
};

export const HUES_GLSL = HUE_RAMPS.map((r) => r.toFixed(1)).join(', ');

/** GLSL: hashes, value noise and the paint-pop curve. */
export const GLSL_PROPS = /* glsl */ `
const float PROP_HUES[6] = float[6](${HUES_GLSL});
float propHueRamp(float h) { return PROP_HUES[int(mod(floor(h + 0.5) + 60.0, 6.0))]; }
float pHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 pHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float pHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float pNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = pHash13(i), b = pHash13(i + vec3(1, 0, 0)), c = pHash13(i + vec3(0, 1, 0)), d = pHash13(i + vec3(1, 1, 0));
  float e = pHash13(i + vec3(0, 0, 1)), g = pHash13(i + vec3(1, 0, 1)), h = pHash13(i + vec3(0, 1, 1)), k = pHash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
// vertical scale of a paint pop: squash first, then a springy stretch,
// settling at 1 (t in seconds since the pop)
float propPop(float t, float amp) {
  if (t < 0.0 || t > 2.5) return 1.0;
  return 1.0 - amp * exp(-3.2 * t) * sin(14.0 * t);
}
// growth of a sprout from nothing: overshoots then settles at 1
float propGrow(float t) {
  if (t <= 0.0) return 0.0;
  if (t > 2.5) return 1.0;
  return 1.0 - exp(-7.5 * t) * cos(11.0 * t);
}
`;

// ---------------------------------------------------------------- geometry kit

/** Unit sphere (merged, smooth) of a given style: 'ico' (42 v) or 'octa' (18 v). */
export function unitSphere(style: 'ico' | 'octa' | 'octa0', detail = 1): THREE.BufferGeometry {
  let g: THREE.BufferGeometry =
    style === 'ico' ? new THREE.IcosahedronGeometry(1, detail) : new THREE.OctahedronGeometry(1, style === 'octa0' ? 0 : detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const l = Math.hypot(x, y, z) || 1;
    pos.setXYZ(i, x / l, y / l, z / l);
    nrm[i * 3] = x / l;
    nrm[i * 3 + 1] = y / l;
    nrm[i * 3 + 2] = z / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  // radius of the largest sphere the polygon fully contains (for per-pixel carving)
  g.userData.insc = style === 'ico' ? (detail === 0 ? 0.794 : 0.91) : style === 'octa0' ? 0.577 : 0.815;
  return g;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, z: number): number {
  let h = Math.imul(Math.round(x * 10) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 10) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Accumulates indexed parts with per-vertex attributes:
 *   position, normal, aPart (material part id), aSway (0 at the base -> 1 at the tip),
 *   aBlobC (blob center + sway weight at the center), aBlobR (blob radii; 0 = not a blob).
 * Blobs are carved per pixel into true ellipsoids by the sprout shader, so
 * their polygon is scaled up to circumscribe the visible blob.
 */
export class PartKit {
  pos: number[] = [];
  nrm: number[] = [];
  part: number[] = [];
  sway: number[] = [];
  blobC: number[] = [];
  blobR: number[] = [];
  idx: number[] = [];

  /** Adds an indexed geometry transformed by m, tagging every vertex. */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, part: number, swayFn: (x: number, y: number, z: number) => number, blob: [number, number, number, number, number, number, number] | null = null) {
    const base = this.pos.length / 3;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    const vn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      vn.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(vn.x, vn.y, vn.z);
      this.part.push(part);
      this.sway.push(swayFn(v.x, v.y, v.z));
      if (blob) {
        this.blobC.push(blob[0], blob[1], blob[2], blob[3]);
        this.blobR.push(blob[4], blob[5], blob[6]);
      } else {
        this.blobC.push(0, 0, 0, 0);
        this.blobR.push(0, 0, 0);
      }
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  /** An ellipsoid blob (visible radii rx, ry, rz) carved from a unit sphere polygon. */
  blob(sphere: THREE.BufferGeometry, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, part: number, swayFn: (x: number, y: number, z: number) => number) {
    const k = 1 / ((sphere.userData.insc as number) ?? 1);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion(), new THREE.Vector3(rx * k, ry * k, rz * k));
    this.add(sphere, m, part, swayFn, [cx, cy, cz, swayFn(cx, cy, cz), rx, ry, rz]);
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, part: number, swayFn: (x: number, y: number, z: number) => number, rotY = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1));
    this.add(g, m, part, swayFn);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setAttribute('aBlobC', new THREE.Float32BufferAttribute(this.blobC, 4));
    g.setAttribute('aBlobR', new THREE.Float32BufferAttribute(this.blobR, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Depth-only twin material for shadow casting with the same vertex deformation. */
export function makeDepthMaterial(vertexShader: string, uniforms: Record<string, THREE.IUniform>, side: THREE.Side = THREE.FrontSide): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    side,
    vertexShader,
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location = 0) out highp vec4 outDepthColor;
      void main() { outDepthColor = vec4(1.0); }
    `,
  });
  // the pipeline's sun pass sets scene.overrideMaterial; keep ours so the
  // shadow matches the shader-built shape (lobes, pops, sway)
  m.allowOverride = false;
  return m;
}
