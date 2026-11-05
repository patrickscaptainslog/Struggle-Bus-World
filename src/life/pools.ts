import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { globals, GLSL_COMMON, GLSL_OUT, heldGlobals } from '../render/materials';
import { HUE_RAMPS, Ramp } from '../render/palette';
import { Kind, Pool } from './kinds';

// How movers are drawn (LIFE.md): a pool is one InstancedMesh, one draw, whose geometry holds every kind in it, each vertex marked with its kind (aPart),
// and the vertex shader folds away what isn't the instance's. Under 2 px a mover is a speck instead, one point in the specks' draw. Every material ends in
// sbWrite, palette ramps only: grey movers on the grey world's rows, painted ones on HUE_RAMPS, and nothing else saturated. Made at their largest at boot,
// drawn with `count` set to what's live and one upload each a frame.

/** Instances a pool holds at most (CONTRACT.md section 2). */
export const POOL_MAX: Record<Pool, number> = { [Pool.SMALL]: 4096, [Pool.MIDDLE]: 2048, [Pool.LARGE]: 512 };
export const SPECKS_MAX = 16384;
/** The marks (CONTRACT.md section 2, O6): vertices at most, and the points along each ribbon. */
export const MARK_VERTS = 8192;
export const MARK_POINTS = 12;
export const MARKS_MAX = Math.floor(MARK_VERTS / (MARK_POINTS * 2));

const PAINT_LO = Math.min(...HUE_RAMPS), PAINT_HI = Math.max(...HUE_RAMPS);

/** An attribute's first `count` elements go up this frame, its one range object reused: three's addUpdateRange makes one a call (as SuperFx.flush keeps its own). */
type Range = { start: number; count: number };
function upTo(a: THREE.BufferAttribute, r: Range, count: number): void {
  const rs = a.updateRanges;
  rs.length = 0;
  r.start = 0;
  r.count = count;
  rs.push(r);
  a.needsUpdate = true;
}
const range = (): Range => ({ start: 0, count: 0 });

/**
 * One box of a kind's model: its centre and size (m), the model's nose along +X, up +Y. A seventh says how it's lit: 1 a steady lamp (KindInfo's lights), 2 a
 * blinking one (its beacon), 3 gingham, 4 a step darker (a head of hair). An eighth puts it in a slot, 1 to 6, drawn only when the instance's look has that bit
 * (a picnic's who's on the blanket).
 */
type Box = [number, number, number, number, number, number, number?, number?];

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
    // (the beacon, on the fin's top)
    [-26.5, 8.9, 0, 1.6, 0.8, 1.6, 2],
  ],
  // a ferry, 40 m, its waterline at the origin: the hull, two decks of cabin and the wheelhouse forward on top, each deck's windows a lamp along either side
  [Kind.FERRY]: [
    [0, 0.6, 0, 40, 2.4, 10.4],
    [-2, 3, 0, 30, 2.4, 9.4],
    [-5, 5.1, 0, 18, 1.8, 8.4],
    [6, 6.7, 0, 5, 1.4, 6],
    [-2, 3.2, 4.74, 28, 0.7, 0.08, 1],
    [-2, 3.2, -4.74, 28, 0.7, 0.08, 1],
    [-5, 5.2, 4.24, 16, 0.6, 0.08, 1],
    [-5, 5.2, -4.24, 16, 0.6, 0.08, 1],
  ],
  // a sailboat, 9 m on the water and 12 m to its masthead: the hull, its cabin, the mast, the mainsail aft of it and the jib forward
  [Kind.SAILBOAT]: [
    [0, 0.35, 0, 9, 0.9, 2.8],
    [-0.6, 1, 0, 3.2, 0.5, 2],
    [0.6, 6.3, 0, 0.16, 11.5, 0.16],
    [-1.3, 6, 0, 3.6, 9.4, 0.08],
    [2.6, 4.6, 0, 3.4, 7, 0.06],
  ],
  // a person, 1.7 m, standing on its feet at the origin and facing +X: legs, a body a little wider across than deep, a head
  [Kind.PERSON]: [
    [0, 0.42, 0, 0.22, 0.84, 0.34],
    [0, 1.13, 0, 0.26, 0.58, 0.44],
    [0, 1.56, 0, 0.22, 0.26, 0.22],
  ],
  // the same person with both arms straight up, the dance's up-beat (both drawn at a picnic's people's places when it's painted)
  [Kind.CHEER]: [
    [0, 0.42, 0, 0.22, 0.84, 0.34],
    [0, 1.13, 0, 0.26, 0.58, 0.44],
    [0, 1.56, 0, 0.22, 0.26, 0.22],
    [0, 1.72, 0.29, 0.1, 0.64, 0.1],
    [0, 1.72, -0.29, 0.1, 0.64, 0.1],
  ],
  // a small plane, 9 m, high wing
  [Kind.SMALL_PLANE]: [
    [0, 0, 0, 8.5, 1.4, 1.2],
    [0.6, 0.9, 0, 1.6, 0.25, 11],
    [-3.8, 0.8, 0, 1.1, 1.4, 0.2],
    [-3.8, 0.2, 0, 0.9, 0.15, 3.2],
    [-3.8, 1.6, 0, 0.4, 0.3, 0.4, 2],
  ],
  // a picnic, a blanket of gingham 2.6 by 2 m on the ground and who's on it by the look's slots, a little over life size so a group reads from the air: two sitting at
  // either end facing each other (1, 2), one at its far side facing in (3), one lying along it (4), a basket (5), an umbrella at its corner (6)
  [Kind.PICNIC]: [
    [0, 0.03, 0, 2.6, 0.06, 2, 3],
    [-0.6, 0.13, 0.45, 0.7, 0.2, 0.42, 0, 1],
    [-0.95, 0.52, 0.45, 0.38, 0.72, 0.52, 0, 1],
    [-0.95, 1.05, 0.45, 0.34, 0.34, 0.34, 4, 1],
    [0.6, 0.13, 0.45, 0.7, 0.2, 0.42, 0, 2],
    [0.95, 0.52, 0.45, 0.38, 0.72, 0.52, 0, 2],
    [0.95, 1.05, 0.45, 0.34, 0.34, 0.34, 4, 2],
    [0, 0.13, 0.6, 0.42, 0.2, 0.7, 0, 3],
    [0, 0.52, 0.95, 0.52, 0.72, 0.38, 0, 3],
    [0, 1.05, 0.95, 0.34, 0.34, 0.34, 4, 3],
    [-0.35, 0.17, -0.45, 1.3, 0.26, 0.5, 0, 4],
    [0.46, 0.2, -0.45, 0.32, 0.3, 0.32, 4, 4],
    [0.88, 0.17, -0.55, 0.42, 0.32, 0.32, 4, 5],
    [1.15, 1.15, 0.85, 0.07, 2.3, 0.07, 0, 6],
    [1.15, 2.3, 0.85, 2.2, 0.14, 2.2, 0, 6],
  ],
  // a car, 4.4 m, its wheels on the ground at the origin: an axle's pair of wheels front and back, the body, the cabin a little back, two headlights
  [Kind.CAR]: [
    [1.35, 0.33, 0, 0.66, 0.66, 1.84],
    [-1.35, 0.33, 0, 0.66, 0.66, 1.84],
    [0, 0.74, 0, 4.4, 0.64, 1.76],
    [-0.3, 1.3, 0, 2.3, 0.5, 1.56],
    [2.22, 0.84, 0.56, 0.08, 0.24, 0.44, 1],
    [2.22, 0.84, -0.56, 0.08, 0.24, 0.44, 1],
  ],
};

/** How a box's light is marked over its kind in aPart (under the half the fold reads): a blinking lamp, a steady one, gingham, a step darker. */
const LIT_MARK = [0, 0.25, 0.45, 0.15, 0.08];

/** The models of the kinds in a pool, one geometry, each vertex marked with its kind and its light (aPart) and its slot (aSlot). */
function poolGeometry(kinds: Kind[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const k of kinds)
    for (const [x, y, z, sx, sy, sz, lit, slot] of MODELS[k] ?? []) {
      const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z).toNonIndexed();
      g.deleteAttribute('uv');
      const count = g.getAttribute('position').count;
      g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(count).fill(k + LIT_MARK[lit ?? 0]), 1));
      g.setAttribute('aSlot', new THREE.BufferAttribute(new Float32Array(count).fill(slot ?? 0), 1));
      parts.push(g);
    }
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

const POOL_VS = /* glsl */ `
  ${GLSL_COMMON}
  in float aPart;
  in float aSlot;
  in float aKind;
  in float aRamp;
  in float aGlint;
  in float aSurf;
  in float aLook;
  flat out float vRamp;
  flat out float vGlint;
  flat out float vSurf;
  flat out float vLamp;
  out vec3 vLocal;
  out vec3 vWorldPos;
  out vec3 vWorldNormal;
  out vec3 vViewNormal;
  void main() {
    // (the instance's own kind only: every other part folds to a point, and draws nothing. A lamp: steady, 1, a car's or a ferry's; blinking, 2, a plane's beacon)
    float on = 1.0 - step(0.5, abs(aPart - aKind));
    // (and a slotted box only if the instance's look has its bit)
    if (aSlot > 0.5) on *= mod(floor(aLook / exp2(aSlot - 1.0) + 0.001), 2.0);
    float lamp = fract(aPart + 0.001);
    vLamp = lamp > 0.35 ? 2.0 : lamp > 0.2 ? 1.0 : lamp > 0.11 ? 3.0 : lamp > 0.04 ? 4.0 : 0.0;
    vLocal = position;
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
  uniform float uLit;
  flat in float vRamp;
  flat in float vGlint;
  flat in float vSurf;
  flat in float vLamp;
  in vec3 vLocal;
  in vec3 vWorldPos;
  in vec3 vWorldNormal;
  in vec3 vViewNormal;
  ${GLSL_OUT}
  void main() {
    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    float ramp = floor(vRamp + 0.5);
    bool painted = ramp >= ${PAINT_LO}.0 && ramp <= ${PAINT_HI}.0;
    float fog0 = sbFog(vWorldPos);
    // (at night, when the windows light: a car's headlights and a ferry's windows on, painted or grey, and a grey plane's beacon an eighth of each 1.2 s, as its speck's,
    // on its own phase)
    if (uLit > 0.0 && (vLamp == 1.0 || (vLamp == 2.0 && !painted && fract(uTime / 1.2 + vSurf) < 0.125))) {
      sbWrite(${Ramp.LAMP}.0, 1.0, fog0 * 0.5, 0.0, gl_FrontFacing ? vViewNormal : -vViewNormal, vSurf, 1.0);
      return;
    }
    float light = sbLight(vWorldPos, n, 0.0, 1.0);
    // (paint lives in the saturated middle of its ramp, as on the buildings)
    if (painted) light = 0.2 + light * 0.52;
    // (a blanket's gingham, 0.43 m squares a step apart; a head a step darker than its body)
    if (vLamp == 3.0) light += mod(floor(vLocal.x / 0.43) + floor(vLocal.z / 0.43), 2.0) > 0.5 ? 0.1 : -0.14;
    else if (vLamp == 4.0) light -= 0.2;
    // (the aim's glint: a full ramp step, as on the buildings)
    light += vGlint;
    sbWrite(ramp, light, fog0, 0.0, gl_FrontFacing ? vViewNormal : -vViewNormal, vSurf, 1.0);
  }
`;

const SPECK_VS = /* glsl */ `
  ${GLSL_COMMON}
  in float aRamp;
  in float aPhase;
  flat out float vRamp;
  flat out float vPhase;
  out vec3 vWorldPos;
  void main() {
    vRamp = aRamp;
    vPhase = aPhase;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_PointSize = 1.0;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SPECK_FS = /* glsl */ `
  ${GLSL_COMMON}
  uniform float uLit;
  flat in float vRamp;
  flat in float vPhase;
  in vec3 vWorldPos;
  ${GLSL_OUT}
  void main() {
    float ramp = floor(vRamp + 0.5);
    bool painted = ramp >= ${PAINT_LO}.0 && ramp <= ${PAINT_HI}.0;
    // (a painted speck holds its colour through the haze: it's the player's mark on the sky, to orbit)
    float fog = sbFog(vWorldPos) * (painted ? 0.35 : 1.0);
    // (at night, when the windows light, a car's speck is its headlights, steady, phase 2; and a grey plane is its lights: a beacon on the lamps' ramp an eighth of each
    // 1.2 s, each plane its own phase. uLit is the live sky's and the held hour's, 0 by day and with ?sky=off)
    if (uLit > 0.0 && vPhase >= 2.0) {
      sbWrite(${Ramp.LAMP}.0, 1.0, fog * 0.5, 0.0, vec3(0.0, 0.0, 1.0), 0.5, 0.5);
      return;
    }
    if (!painted && uLit > 0.0 && vPhase >= 0.0 && fract(uTime / 1.2 + vPhase) < 0.125) {
      sbWrite(${Ramp.LAMP}.0, 1.0, fog * 0.5, 0.0, vec3(0.0, 0.0, 1.0), 0.5, 0.5);
      return;
    }
    sbWrite(ramp, painted ? 0.62 : 0.55, fog, 0.0, vec3(0.0, 0.0, 1.0), 0.5, 0.5);
  }
`;

const MARK_VS = /* glsl */ `
  ${GLSL_COMMON}
  in float aRamp;
  in float aAge;
  flat out float vRamp;
  out float vAge;
  out vec3 vWorldPos;
  void main() {
    vRamp = aRamp;
    vAge = aAge;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const MARK_FS = /* glsl */ `
  ${GLSL_COMMON}
  flat in float vRamp;
  in float vAge;
  in vec3 vWorldPos;
  ${GLSL_OUT}
  const int BAYER[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  void main() {
    // (a mark fades as paint can in an indexed G-buffer: pixels drop out by a 4 x 4 ordered dither, the oldest end first, the first third solid)
    ivec2 c = ivec2(gl_FragCoord.xy) & 3;
    if ((float(BAYER[c.y * 4 + c.x]) + 0.5) / 16.0 < smoothstep(0.33, 1.0, vAge)) discard;
    float fog = sbFog(vWorldPos) * 0.35;
    sbWrite(floor(vRamp + 0.5), 0.62, fog, 0.0, vec3(0.0, 0.0, 1.0), 0.5, 0.5);
  }
`;

/**
 * The marks (CONTRACT.md O6): one draw of ribbons, each a strip of MARK_POINTS points the host lays along a painted mover's path, two vertices a point, turned to face the
 * lens, or flat on the road (a painted car's tyre tracks). Paint ramps only, flags 0.5, no shadow. Wakes, on the water, will be the same ribbons laid on its height.
 */
export class Marks {
  readonly object: THREE.Mesh;
  readonly pos: Float32Array;
  readonly ramp: Float32Array;
  readonly age: Float32Array;
  private readonly posA: THREE.BufferAttribute;
  private readonly rampA: THREE.BufferAttribute;
  private readonly ageA: THREE.BufferAttribute;
  private readonly ranges = [range(), range(), range()];

  constructor() {
    const g = new THREE.BufferGeometry(), n = MARKS_MAX * MARK_POINTS * 2;
    this.posA = new THREE.BufferAttribute((this.pos = new Float32Array(n * 3)), 3);
    this.rampA = new THREE.BufferAttribute((this.ramp = new Float32Array(n)), 1);
    this.ageA = new THREE.BufferAttribute((this.age = new Float32Array(n)), 1);
    for (const a of [this.posA, this.rampA, this.ageA]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posA);
    g.setAttribute('aRamp', this.rampA);
    g.setAttribute('aAge', this.ageA);
    // (the strips' triangles, made once: ribbon r, segment j, its two points' left and right)
    const idx = new Uint16Array(MARKS_MAX * (MARK_POINTS - 1) * 6);
    let k = 0;
    for (let r = 0; r < MARKS_MAX; r++)
      for (let j = 0; j < MARK_POINTS - 1; j++) {
        const a = (r * MARK_POINTS + j) * 2;
        idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k);
        k += 6;
      }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { ...globals }, vertexShader: MARK_VS, fragmentShader: MARK_FS, side: THREE.DoubleSide });
    this.object = new THREE.Mesh(g, m);
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  /** `n` ribbons are written: their vertices go up, the live range only. */
  commit(n: number): void {
    const v = n * MARK_POINTS * 2;
    this.object.geometry.setDrawRange(0, n * (MARK_POINTS - 1) * 6);
    this.object.visible = n > 0;
    if (!n) return;
    upTo(this.posA, this.ranges[0], v * 3);
    upTo(this.rampA, this.ranges[1], v);
    upTo(this.ageA, this.ranges[2], v);
  }
}

/** One pool: its mesh and the per-instance arrays the host fills. */
export class MoverPool {
  readonly mesh: THREE.InstancedMesh;
  readonly kind: Float32Array;
  readonly ramp: Float32Array;
  readonly glint: Float32Array;
  readonly surf: Float32Array;
  /** its look: which of its model's slotted boxes it draws (a picnic's who's on the blanket) */
  readonly look: Float32Array;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly ranges = [range(), range(), range(), range(), range(), range()];
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
    this.attrs = [add('aKind'), add('aRamp'), add('aGlint'), add('aSurf'), add('aLook')];
    [this.kind, this.ramp, this.glint, this.surf, this.look] = this.attrs.map((a) => a.array as Float32Array);
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { ...globals, uLit: heldGlobals.uLit }, vertexShader: POOL_VS, fragmentShader: POOL_FS });
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
    upTo(m.instanceMatrix, this.ranges[5], n * 16);
    for (let i = 0; i < 5; i++) upTo(this.attrs[i], this.ranges[i], n);
  }
}

/** The specks: every mover under 2 px, one point each, one draw. */
export class Specks {
  readonly object: THREE.Points;
  readonly pos: Float32Array;
  readonly ramp: Float32Array;
  /** each speck's beacon's phase at night, 0..1, from its key; 2, a car's headlights, steady; under 0, no lights (a person) */
  readonly phase: Float32Array;
  private readonly posA: THREE.BufferAttribute;
  private readonly rampA: THREE.BufferAttribute;
  private readonly phaseA: THREE.BufferAttribute;
  private readonly ranges = [range(), range(), range()];

  constructor() {
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute((this.pos = new Float32Array(SPECKS_MAX * 3)), 3);
    this.rampA = new THREE.BufferAttribute((this.ramp = new Float32Array(SPECKS_MAX)), 1);
    this.phaseA = new THREE.BufferAttribute((this.phase = new Float32Array(SPECKS_MAX)), 1);
    this.posA.setUsage(THREE.DynamicDrawUsage);
    this.rampA.setUsage(THREE.DynamicDrawUsage);
    this.phaseA.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posA);
    g.setAttribute('aRamp', this.rampA);
    g.setAttribute('aPhase', this.phaseA);
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { ...globals, uLit: heldGlobals.uLit }, vertexShader: SPECK_VS, fragmentShader: SPECK_FS });
    this.object = new THREE.Points(g, m);
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  commit(n: number): void {
    this.object.geometry.setDrawRange(0, n);
    this.object.visible = n > 0;
    if (!n) return;
    upTo(this.posA, this.ranges[0], n * 3);
    upTo(this.rampA, this.ranges[1], n);
    upTo(this.phaseA, this.ranges[2], n);
  }
}

/** Every pool, the specks and the marks: what the scene holds, and what the warm-up draws once each. */
export class Pools {
  readonly small = new MoverPool([Kind.PERSON, Kind.CHEER, Kind.PICNIC], POOL_MAX[Pool.SMALL]);
  readonly middle = new MoverPool([Kind.SMALL_PLANE, Kind.CAR], POOL_MAX[Pool.MIDDLE]);
  readonly large = new MoverPool([Kind.AIRLINER, Kind.FERRY, Kind.SAILBOAT], POOL_MAX[Pool.LARGE]);
  readonly specks = new Specks();
  readonly marks = new Marks();
  readonly group = new THREE.Group();

  constructor() {
    this.group.add(this.small.mesh, this.middle.mesh, this.large.mesh, this.specks.object, this.marks.object);
  }

  pool(p: Pool): MoverPool {
    return p === Pool.LARGE ? this.large : p === Pool.SMALL ? this.small : this.middle;
  }

  /** One of each, as drawn (render/warmup.ts registerWarm): a pool with one instance, the specks with one point. */
  warmObjects(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const p of [this.small, this.middle, this.large]) {
      const m = new THREE.InstancedMesh(p.mesh.geometry, p.mesh.material, 1);
      m.frustumCulled = false;
      out.push(m);
    }
    const s = new THREE.Points(this.specks.object.geometry.clone(), this.specks.object.material);
    s.geometry.setDrawRange(0, 1);
    s.frustumCulled = false;
    out.push(s);
    const k = new THREE.Mesh(this.marks.object.geometry.clone(), this.marks.object.material);
    k.geometry.setDrawRange(0, 6);
    k.frustumCulled = false;
    out.push(k);
    return out;
  }
}

/** The grey a grey mover draws in, from the grey world's rows. */
export const GREY_RAMP = Ramp.GREY_LIGHT;
