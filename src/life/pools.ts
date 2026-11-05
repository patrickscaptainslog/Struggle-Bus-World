import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { HUE_RAMPS, Ramp } from '../render/palette';
import { Kind, Pool } from './kinds';

// How movers are drawn (LIFE.md): a pool is one InstancedMesh, one draw, whose geometry holds every kind in it, each vertex marked with its kind (aPart),
// and the vertex shader folds away what isn't the instance's. Under 2 px a mover is a speck instead, one point in the specks' draw. Every material ends in
// sbWrite, palette ramps only: grey movers on the grey world's rows, painted ones on HUE_RAMPS, and nothing else saturated. Made at their largest at boot,
// drawn with `count` set to what's live and one upload each a frame.

/** Instances a pool holds at most (CONTRACT.md section 2). */
export const POOL_MAX: Record<Pool, number> = { [Pool.SMALL]: 4096, [Pool.MIDDLE]: 2048, [Pool.LARGE]: 512 };
export const SPECKS_MAX = 16384;

const PAINT_LO = Math.min(...HUE_RAMPS), PAINT_HI = Math.max(...HUE_RAMPS);

/** One box of a kind's model: its centre and size (m), the model's nose along +X, up +Y. */
type Box = [number, number, number, number, number, number];

/** The kinds' models, pixel art at 6-40 px: a few boxes, as the bridges' kit is made. */
const MODELS: Record<number, Box[]> = {
  // an airliner, 60 m: the fuselage, the wings swept a little by their place, the tail's fin and its stabilisers, two engines under the wings
  [Kind.AIRLINER]: [
    [0, 0, 0, 60, 5.6, 5.6],
    [2, -0.8, 0, 9, 1, 58],
    [-26, 4.5, 0, 7, 8, 1],
    [-26, 1.4, 0, 5, 0.8, 20],
    [5, -2.8, 10, 5, 2.6, 2.6],
    [5, -2.8, -10, 5, 2.6, 2.6],
  ],
  // a small plane, 9 m, high wing
  [Kind.SMALL_PLANE]: [
    [0, 0, 0, 8.5, 1.4, 1.2],
    [0.6, 0.9, 0, 1.6, 0.25, 11],
    [-3.8, 0.8, 0, 1.1, 1.4, 0.2],
    [-3.8, 0.2, 0, 0.9, 0.15, 3.2],
  ],
};

/** The models of the kinds in a pool, one geometry, each vertex marked with its kind. */
function poolGeometry(kinds: Kind[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const k of kinds)
    for (const [x, y, z, sx, sy, sz] of MODELS[k] ?? []) {
      const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z).toNonIndexed();
      g.deleteAttribute('uv');
      g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(k), 1));
      parts.push(g);
    }
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

const POOL_VS = /* glsl */ `
  ${GLSL_COMMON}
  in float aPart;
  in float aKind;
  in float aRamp;
  in float aGlint;
  in float aSurf;
  flat out float vRamp;
  flat out float vGlint;
  flat out float vSurf;
  out vec3 vWorldPos;
  out vec3 vWorldNormal;
  out vec3 vViewNormal;
  void main() {
    // (the instance's own kind only: every other part folds to a point, and draws nothing)
    float on = 1.0 - step(0.5, abs(aPart - aKind));
    vec4 wp = modelMatrix * instanceMatrix * vec4(position * on, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
    vRamp = aRamp;
    vGlint = aGlint;
    vSurf = aSurf;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const POOL_FS = /* glsl */ `
  ${GLSL_COMMON}
  flat in float vRamp;
  flat in float vGlint;
  flat in float vSurf;
  in vec3 vWorldPos;
  in vec3 vWorldNormal;
  in vec3 vViewNormal;
  ${GLSL_OUT}
  void main() {
    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    float ramp = floor(vRamp + 0.5);
    float light = sbLight(vWorldPos, n, 0.0, 1.0);
    // (paint lives in the saturated middle of its ramp, as on the buildings)
    if (ramp >= ${PAINT_LO}.0 && ramp <= ${PAINT_HI}.0) light = 0.2 + light * 0.52;
    // (the aim's glint: a full ramp step, as on the buildings)
    light += vGlint;
    float fog = sbFog(vWorldPos);
    sbWrite(ramp, light, fog, 0.0, gl_FrontFacing ? vViewNormal : -vViewNormal, vSurf, 1.0);
  }
`;

const SPECK_VS = /* glsl */ `
  ${GLSL_COMMON}
  in float aRamp;
  flat out float vRamp;
  out vec3 vWorldPos;
  void main() {
    vRamp = aRamp;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_PointSize = 1.0;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SPECK_FS = /* glsl */ `
  ${GLSL_COMMON}
  flat in float vRamp;
  in vec3 vWorldPos;
  ${GLSL_OUT}
  void main() {
    float ramp = floor(vRamp + 0.5);
    bool painted = ramp >= ${PAINT_LO}.0 && ramp <= ${PAINT_HI}.0;
    // (a painted speck holds its colour through the haze: it's the player's mark on the sky, to orbit)
    float fog = sbFog(vWorldPos) * (painted ? 0.35 : 1.0);
    sbWrite(ramp, painted ? 0.62 : 0.55, fog, 0.0, vec3(0.0, 0.0, 1.0), 0.5, 0.5);
  }
`;

/** One pool: its mesh and the per-instance arrays the host fills. */
export class MoverPool {
  readonly mesh: THREE.InstancedMesh;
  readonly kind: Float32Array;
  readonly ramp: Float32Array;
  readonly glint: Float32Array;
  readonly surf: Float32Array;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  readonly max: number;

  constructor(kinds: Kind[], max: number) {
    this.max = max;
    const geo = poolGeometry(kinds);
    const add = (name: string) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.attrs = [add('aKind'), add('aRamp'), add('aGlint'), add('aSurf')];
    [this.kind, this.ramp, this.glint, this.surf] = this.attrs.map((a) => a.array as Float32Array);
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { ...globals }, vertexShader: POOL_VS, fragmentShader: POOL_FS });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // (a pool spans the sky: its geometry's bounds say nothing of where its instances are)
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** The frame's instances are written: `n` of them go up, the live range only. */
  commit(n: number): void {
    const m = this.mesh;
    m.count = n;
    m.visible = n > 0;
    if (!n) return;
    m.instanceMatrix.clearUpdateRanges();
    m.instanceMatrix.addUpdateRange(0, n * 16);
    m.instanceMatrix.needsUpdate = true;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n);
      a.needsUpdate = true;
    }
  }
}

/** The specks: every mover under 2 px, one point each, one draw. */
export class Specks {
  readonly object: THREE.Points;
  readonly pos: Float32Array;
  readonly ramp: Float32Array;
  private readonly posA: THREE.BufferAttribute;
  private readonly rampA: THREE.BufferAttribute;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute((this.pos = new Float32Array(SPECKS_MAX * 3)), 3);
    this.rampA = new THREE.BufferAttribute((this.ramp = new Float32Array(SPECKS_MAX)), 1);
    this.posA.setUsage(THREE.DynamicDrawUsage);
    this.rampA.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posA);
    g.setAttribute('aRamp', this.rampA);
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { ...globals }, vertexShader: SPECK_VS, fragmentShader: SPECK_FS });
    this.object = new THREE.Points(g, m);
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  commit(n: number): void {
    this.object.geometry.setDrawRange(0, n);
    this.object.visible = n > 0;
    if (!n) return;
    this.posA.clearUpdateRanges();
    this.posA.addUpdateRange(0, n * 3);
    this.posA.needsUpdate = true;
    this.rampA.clearUpdateRanges();
    this.rampA.addUpdateRange(0, n);
    this.rampA.needsUpdate = true;
  }
}

/** Every pool and the specks: what the scene holds, and what the warm-up draws once each. */
export class Pools {
  readonly middle = new MoverPool([Kind.SMALL_PLANE], POOL_MAX[Pool.MIDDLE]);
  readonly large = new MoverPool([Kind.AIRLINER], POOL_MAX[Pool.LARGE]);
  readonly specks = new Specks();
  readonly group = new THREE.Group();

  constructor() {
    this.group.add(this.middle.mesh, this.large.mesh, this.specks.object);
  }

  pool(p: Pool): MoverPool {
    return p === Pool.LARGE ? this.large : this.middle;
  }

  /** One of each, as drawn (render/warmup.ts registerWarm): a pool with one instance, the specks with one point. */
  warmObjects(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const p of [this.middle, this.large]) {
      const m = new THREE.InstancedMesh(p.mesh.geometry, p.mesh.material, 1);
      m.frustumCulled = false;
      out.push(m);
    }
    const s = new THREE.Points(this.specks.object.geometry.clone(), this.specks.object.material);
    s.geometry.setDrawRange(0, 1);
    s.frustumCulled = false;
    out.push(s);
    return out;
  }
}

/** The grey a grey mover draws in, from the grey world's rows. */
export const GREY_RAMP = Ramp.GREY_LIGHT;
