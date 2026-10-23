import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { HUE_COUNT, HUE_RAMPS, Ramp } from '../render/palette';
import { registerTunables } from '../ui/tunables';

// Pixel particles: the barf geyser (THE money shot), wet impact splashes,
// bloom sparkles, ambient twinkles and grey exhaust puffs.
//
// One THREE.Points draw call over a fixed-capacity ring buffer. Particles are
// simulated analytically in the vertex shader from their spawn parameters
// (Hermite homing path, ballistic drop with one bounce, drag + rise), so the
// CPU only writes a slot when a particle is born and uploads just those slots
// (reused update ranges, no per-frame allocation, no full re-upload).
//
// Every particle is a crisp square of whole game pixels: gl_PointSize is the
// world size projected into the low-res G-buffer and rounded to an integer
// (min 1 px). Bigger sprites are shaped in the fragment shader into pixel-art
// shapes: round candy blobs with a lit edge, 4-point twinkle stars, puffs.
// Output goes through sbWrite() with flags 0.5 (no ink outlines) and writes
// depth (the resolve pass treats depth == 1 as sky).
//
// The geyser: a rainbow ribbon (7 bands: the center = the splat's hue, the
// rest in rainbow order, edges = the complementary hue split in half) pours
// from the moving mouth and homes onto the primary roof, with the bands laid
// out so that each neighbor's hue sits on the side its building is on. Every
// neighbor also gets its own single-hue arc that peels off the ribbon and
// lands exactly when that building blooms (travelTime + i * cascadeStep).

/** Live-tunable look + feel numbers (read every spawn / frame). */
export const fxTune = {
  // --- geyser ribbon
  /** Ribbon particles per second at full flow. */
  ribbonRate: 900,
  /** Ribbon half-width at the mouth / at the landing (m). */
  halfWidth0: 1.15,
  halfWidth1: 2.4,
  /** Depth (toward-camera) thickness relative to the width; the center bulges forward. */
  depth: 0.5,
  /** Blob size (m). ~3 game px at gameplay distance. */
  blobSize: 0.95,
  /** Width of the center (primary hue) band relative to the others. */
  centerWeight: 1.7,
  /** Fraction of ribbon particles that are small spray droplets. */
  sprayFrac: 0.24,
  /** Extra landing scatter of spray droplets (m). */
  sprayScatter: 2.2,
  /** Initial downward blast and arrival speed (m/s) — shapes the Hermite path. */
  blast: 15,
  arrive: 24,
  /** Fraction of the bus velocity the barf inherits (curls the ribbon behind a moving bus). */
  inherit: 0.75,
  /** Sideways spurt out of the door (m/s, toward the bus's right). */
  doorOut: 3.5,
  /** Coherent ribbon flutter: amplitude (m) and frequency (Hz). */
  wobbleAmp: 0.38,
  wobbleHz: 1.7,
  /** Glow of the ribbon body, glint particles and bright-step share. */
  ribbonGlow: 0.42,
  glintFrac: 0.05,
  brightFrac: 0.16,
  /** Fraction of ribbon particles that hop off the roof on landing. */
  landBounce: 0.4,
  /** Hop speed off the roof (m/s). */
  hopUp: 5.5,
  hopOut: 3.2,
  // --- arcs to neighbors
  /** Arc particles per second per neighbor. */
  arcRate: 210,
  /** Upward launch per 18 m of reach (m/s) — farther neighbors get higher arcs (nested rainbows). */
  arcLift: 46,
  arcSize: 0.85,
  /** Arc strand thickness (m). */
  arcSpread: 0.32,
  // --- drops / splash
  gravity: 34,
  splashCount: 120,
  splashUp: 11,
  splashOut: 6,
  splashSize: 0.62,
  /** Share of splash drops that bounce once, and how hard. */
  splashBounce: 0.32,
  restitution: 0.38,
  /** Drops landing farther than this from the impact fall past the roof edge (m). */
  roofRadius: 4.2,
  // --- sparkles
  sparkSize: 1.9,
  sparkLife: 1.2,
  sparkRise: 2.6,
  sparkGlow: 1,
  /** Share of sparkles that are GLOW_WHITE (the rest take the bloom hues). */
  sparkWhite: 0.4,
  // --- puffs
  puffSize: 1.1,
  puffGrow: 1.5,
  puffLife: 0.95,
  /** Puff light offset (ramp units) and how much they take the sun shadow. */
  puffLight: 0.02,
  puffShadow: 0.7,
  // --- look
  /** Ramp step of each rainbow hue's body color (R, O, Y, G, B, V). */
  stepRed: 4,
  stepOrange: 4,
  stepYellow: 5,
  stepGreen: 4,
  stepBlue: 4,
  stepViolet: 4,
  /** Fog multiplier for paint / for puffs. */
  fogPaint: 0.6,
  fogPuff: 1,
  /** Largest sprite (game px). */
  maxPx: 24,
};

registerTunables('Particles', fxTune, {
  ribbonRate: [100, 2000, 10],
  halfWidth0: [0.2, 4, 0.05],
  halfWidth1: [0.2, 6, 0.05],
  depth: [0, 1.5, 0.05],
  blobSize: [0.2, 2.5, 0.05],
  centerWeight: [0.5, 4, 0.1],
  sprayFrac: [0, 1, 0.01],
  sprayScatter: [0, 6, 0.1],
  blast: [0, 60, 0.5],
  arrive: [0, 80, 0.5],
  inherit: [0, 1.5, 0.05],
  doorOut: [0, 15, 0.5],
  wobbleAmp: [0, 2, 0.02],
  wobbleHz: [0, 6, 0.1],
  ribbonGlow: [0, 1, 0.01],
  glintFrac: [0, 0.5, 0.01],
  brightFrac: [0, 1, 0.01],
  landBounce: [0, 1, 0.01],
  hopUp: [0, 15, 0.1],
  hopOut: [0, 10, 0.1],
  arcRate: [0, 800, 10],
  arcLift: [0, 150, 1],
  arcSize: [0.2, 2.5, 0.05],
  arcSpread: [0, 2, 0.02],
  gravity: [5, 80, 0.5],
  splashCount: [0, 400, 1],
  splashUp: [0, 30, 0.5],
  splashOut: [0, 20, 0.5],
  splashSize: [0.1, 2, 0.02],
  splashBounce: [0, 1, 0.01],
  restitution: [0, 0.9, 0.01],
  roofRadius: [0, 20, 0.1],
  sparkSize: [0.3, 5, 0.05],
  sparkLife: [0.2, 4, 0.05],
  sparkRise: [0, 10, 0.1],
  sparkGlow: [0, 1, 0.01],
  sparkWhite: [0, 1, 0.01],
  puffSize: [0.2, 5, 0.05],
  puffGrow: [0, 5, 0.05],
  puffLife: [0.1, 4, 0.05],
  puffLight: [-0.5, 0.5, 0.01],
  puffShadow: [0, 1, 0.01],
  stepRed: [0, 7, 1],
  stepOrange: [0, 7, 1],
  stepYellow: [0, 7, 1],
  stepGreen: [0, 7, 1],
  stepBlue: [0, 7, 1],
  stepViolet: [0, 7, 1],
  fogPaint: [0, 1, 0.01],
  fogPuff: [0, 1, 0.01],
  maxPx: [2, 64, 1],
});

// slot layout (floats)
//  0..3  aP0   p0.xyz, t0
//  4..7  aV0   v0.xyz, life
//  8..11 aP1   kind-specific (ribbon: target.xyz, travel time)
// 12..15 aV1   kind-specific xyz, kind
// 16..19 aLook ramp, size (m), seed, look flags
const STRIDE = 20;
const MAX_EMITTERS = 4;
const MAX_TARGETS = 8;
/** The particle clock is rebased (all t0 shifted) past this, to keep float32 precision. */
const REBASE_AT = 2048;
/** Hop time of ribbon blobs that bounce off the roof (s). */
const HOP_LIFE = 0.36;
/** How long a landed drop lingers (shrinking) on the roof (s). */
const LINGER = 0.2;

const K_RIBBON = 0;
const K_DROP = 1;
const K_SPARK = 2;
const K_TWINKLE = 3;
const K_PUFF = 4;

// look flags
const F_SHADED = 1; // per-blob lit edge + shadow edge
const F_BRIGHT = 2; // one step brighter
const F_GLINT = 4; // brightest step + full glow

interface Emitter {
  active: boolean;
  start: number;
  duration: number;
  travel: number;
  source: () => THREE.Vector3;
  sourceVel: () => THREE.Vector3;
  targets: THREE.Vector3[];
  hues: Int32Array;
  side: Float32Array;
  carryArc: Float32Array;
  n: number;
  hue0: number;
  bandSign: number;
  carry: number;
  last: THREE.Vector3;
  lastT: number;
  right: THREE.Vector3;
  back: THREE.Vector3;
}

const rnd = Math.random;
const wrapHue = (h: number) => ((Math.round(h) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT;

/** Time until a drop launched with vertical speed vy from dy above the floor hits it. */
function hitTime(vy: number, dy: number, g: number): number {
  return (vy + Math.sqrt(vy * vy + 2 * g * Math.max(dy, 0))) / g;
}

const VERT = /* glsl */ `
${GLSL_COMMON}
uniform float uNow;
uniform float uViewH;
uniform float uMaxPx;
uniform vec4 uRib;    // ribbon glow, wobble amp, wobble hz, hop speed up
uniform vec4 uLand;   // gravity, hop out, fog paint, fog puff
uniform vec4 uSpk;    // spark glow, -, -, -
uniform vec4 uPuff;   // light offset, shadow mul, -, -
uniform float uHueStep[6];
in vec4 aP0;
in vec4 aV0;
in vec4 aP1;
in vec4 aV1;
in vec4 aLook;
flat out vec4 vA;  // ramp, step, glow, shape (0 blob, 1 star, 2 puff)
flat out vec4 vB;  // N px, keep (dissolve), arm px, fog
flat out vec4 vC;  // sprite light dir xy, sun shadow, flags

float hueStep(float ramp) {
  int i = int(ramp + 0.5) - ${Ramp.RED};
  if (i < 0 || i > 5) return 6.0;
  return uHueStep[i];
}

// Ballistic drop with one optional bounce. e > 0 bounce, e == 0 stick, e < 0 fall past.
// restT: time since the drop stopped flying (or fell past the floor); -1 while flying.
vec3 dropPath(vec3 p0, vec3 v0, float t, float floorY, float e, float G, out float restT) {
  restT = -1.0;
  float disc = v0.y * v0.y + 2.0 * G * max(p0.y - floorY, 0.0);
  float sq = sqrt(disc);
  float th = (v0.y + sq) / G;
  if (t < th || e < 0.0) {
    if (t >= th) restT = t - th;
    return p0 + v0 * t - vec3(0.0, 0.5 * G * t * t, 0.0);
  }
  vec3 ph = p0 + v0 * th;
  ph.y = floorY;
  float tt = t - th;
  if (e <= 0.0) { restT = tt; return ph; }
  float vyb = sq * e;
  float tb = 2.0 * vyb / G;
  vec2 vh = v0.xz * 0.55;
  if (tt < tb) return ph + vec3(vh.x * tt, vyb * tt - 0.5 * G * tt * tt, vh.y * tt);
  restT = tt - tb;
  return ph + vec3(vh.x * tb, 0.0, vh.y * tb);
}

void cull() {
  gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
  gl_PointSize = 1.0;
  vA = vec4(0.0);
  vB = vec4(1.0, 0.0, 0.0, 0.0);
  vC = vec4(0.0);
}

void main() {
  float t0 = aP0.w;
  float life = aV0.w;
  float kind = aV1.w;
  float age = uNow - t0;
  if (age < 0.0 || age >= life) { cull(); return; }
  float ramp = aLook.x;
  float size = aLook.y;
  float seed = aLook.z;
  int flags = int(aLook.w + 0.5);
  float x = age / life;
  vec3 p;
  float st = hueStep(ramp);
  float glow = uRib.x;
  float shape = 0.0;
  float keep = 1.0;
  float arm = 0.0;
  float fogMul = uLand.z;
  float G = uLand.x;

  if (kind < 0.5) {
    // ---- geyser ribbon: Hermite homing from the mouth onto the target
    float T = aP1.w;
    if (age < T) {
      float s = age / T;
      float s2 = s * s;
      float s3 = s2 * s;
      p = (2.0 * s3 - 3.0 * s2 + 1.0) * aP0.xyz + (s3 - 2.0 * s2 + s) * T * aV0.xyz
        + (-2.0 * s3 + 3.0 * s2) * aP1.xyz + (s3 - s2) * T * aV1.xyz;
      // coherent flutter: everything emitted at the same instant shares it,
      // so the bands wave together like a ribbon instead of smearing
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      p += right * (uRib.y * sin(t0 * uRib.z * 6.2832 + s * 2.6) * sin(3.14159 * s));
    } else {
      // landed: hop off the roof as a little droplet, then shrink away
      float tau = age - T;
      float post = max(life - T, 1e-3);
      float a = seed * 61.0;
      float out_ = uLand.y * (0.4 + 0.6 * fract(seed * 7.31));
      vec3 vo = vec3(cos(a) * out_, uRib.w * (0.45 + 0.55 * fract(seed * 13.7)), sin(a) * out_);
      p = aP1.xyz + vo * tau;
      p.y = max(aP1.y, p.y - 0.5 * G * tau * tau);
      size *= 0.6 * (1.0 - tau / post);
      flags |= ${F_SHADED};
    }
  } else if (kind < 1.5) {
    // ---- drop: ballistic, maybe one bounce, lingers or falls past the edge
    float restT;
    p = dropPath(aP0.xyz, aV0.xyz, age, aP1.x, aP1.y, G * aP1.z, restT);
    if (restT >= 0.0) size *= max(0.0, 1.0 - restT / ${LINGER.toFixed(3)}) * 0.85;
    glow = uRib.x * 0.8;
  } else if (kind < 3.5) {
    // ---- sparkle / ambient twinkle: rise with drag, twinkle as a 4-point star
    float k = aP1.x;
    p = aP0.xyz + aV0.xyz * ((1.0 - exp(-k * age)) / k) + vec3(0.0, aP1.y * age, 0.0);
    shape = 1.0;
    glow = uSpk.x;
    fogMul = uLand.z;
    float tw;
    if (kind < 2.5) {
      // burst flash, then twinkle, then blink out
      float flash = 1.0 - smoothstep(0.0, 0.14, age);
      float pulse = 0.5 + 0.5 * sin(age * aP1.z + seed * 40.0);
      tw = max(flash, pulse * pulse) * (1.0 - smoothstep(0.55, 1.0, x) * 0.5);
      float blinkStart = aV1.x;
      if (x > blinkStart) {
        float k2 = (x - blinkStart) / max(1.0 - blinkStart, 1e-3);
        if (sbHash11(floor(age * 15.0) + seed * 731.0) < k2) { cull(); return; }
      }
    } else {
      // one slow twinkle: grow, hold, shrink
      tw = sin(3.14159 * x);
      tw *= tw;
    }
    arm = tw; // scaled to px below
    st = 6.0;
  } else {
    // ---- puff: drag + buoyancy, grows, dithers away
    float k = aP1.x;
    p = aP0.xyz + aV0.xyz * ((1.0 - exp(-k * age)) / k) + vec3(0.0, aP1.y * age, 0.0);
    size *= 1.0 + aP1.z * (1.0 - (1.0 - x) * (1.0 - x));
    keep = 1.0 - smoothstep(0.3, 1.0, x);
    shape = 2.0;
    glow = 0.0;
    fogMul = uLand.w;
  }

  if ((flags & ${F_BRIGHT}) != 0) st += 1.0;
  if ((flags & ${F_GLINT}) != 0) { st = 7.0; glow = 1.0; }

  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = size * projectionMatrix[1][1] * 0.5 * uViewH / max(gl_Position.w, 1e-3);
  float N = clamp(floor(px + 0.5), 1.0, uMaxPx);
  if (size <= 0.0) { cull(); return; }
  if (shape > 0.5 && shape < 1.5) {
    // stars: odd sprite, arm length follows the twinkle
    float armMax = floor((N - 1.0) * 0.5);
    float a = floor(armMax * arm + 0.5);
    arm = a;
    N = 2.0 * a + 1.0;
  }
  gl_PointSize = N;

  // sprite-space light direction (x right, y down) from the sun, biased to the top
  vec3 sv = mat3(viewMatrix) * uSunDir;
  vec2 L = normalize(vec2(sv.x, -sv.y) * 0.8 + vec2(-0.2, -0.75));
  float sh = shape > 1.5 ? sbShadow(p, vec3(0.0, 1.0, 0.0)) : 1.0;

  vA = vec4(ramp, st, glow, shape);
  vB = vec4(N, keep, arm, sbFog(p) * fogMul);
  vC = vec4(L, sh, float(flags));
}
`;

const FRAG = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uPuff;
flat in vec4 vA;
flat in vec4 vB;
flat in vec4 vC;
${GLSL_OUT}

float bayer4(ivec2 p) {
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0;
}

void main() {
  float N = vB.x;
  vec2 c = floor(gl_PointCoord * N) - (N - 1.0) * 0.5; // centered pixel offset in the sprite
  float r2 = dot(c, c);
  float R = N * 0.5;
  float ramp = vA.x;
  float st = vA.y;
  float glow = vA.z;
  float shape = vA.w;
  int flags = int(vC.w + 0.5);
  float light;
  if (shape < 0.5) {
    // candy blob: pixel-art circle (plus at 3 px, rounded square at 4)
    if (N > 2.5 && r2 > R * R - 0.3) discard;
    if ((flags & ${F_SHADED}) != 0 && N > 2.5) {
      float dl = dot(c, vC.xy) / max(R - 0.5, 0.5);
      if (dl < -0.62) st -= 1.0;
      else if (dl > 0.55) st += 1.0;
      if (N > 4.5) {
        vec2 hc = -vC.xy * (R - 1.6);
        vec2 d = c + hc;
        if (dot(d, d) < 0.55) st = 7.0;
      }
    }
    light = (clamp(st, 0.0, 7.0) + 0.15) / 7.0;
  } else if (shape < 1.5) {
    // 4-point twinkle star, white heart
    float ax = abs(c.x);
    float ay = abs(c.y);
    float m = max(ax, ay);
    bool axis = min(ax, ay) < 0.5;
    bool diag = vB.z > 2.5 && abs(ax - 1.0) < 0.1 && abs(ay - 1.0) < 0.1;
    if (!axis && !diag) discard;
    if (m < 0.5) {
      ramp = ${Ramp.GLOW_WHITE}.0;
      st = 7.0;
    } else if (diag) {
      st = 5.0;
    } else {
      st = 7.0 - min(m, 3.0) * 0.67;
      st = floor(st + 0.5);
    }
    light = (st + 0.15) / 7.0;
  } else {
    // puff: grey ball lit by the low sun, dissolves through ordered dither
    if (N > 2.5 && r2 > R * R - 0.3) discard;
    if (bayer4(ivec2(gl_FragCoord.xy)) > vB.y) discard;
    vec2 nn = c / max(R, 1.0);
    vec3 nv = vec3(nn.x, -nn.y, sqrt(max(0.0, 1.0 - dot(nn, nn))));
    vec3 nw = normalize(nv * mat3(viewMatrix));
    float ndl = max(dot(nw, uSunDir), 0.0);
    float sky = 0.5 + 0.5 * nw.y;
    light = uLight.y + uLight.z * sky + uLight.x * ndl * mix(1.0, vC.z, uPuff.y) + uPuff.x;
  }
  sbWrite(ramp, light, vB.w, glow, vec3(0.0, 0.0, 1.0), 0.5, 0.5);
}
`;

export class Particles {
  readonly object: THREE.Object3D;
  private readonly cap: number;
  private readonly data: Float32Array;
  private readonly buf: THREE.InterleavedBuffer;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly death: Float32Array;
  private readonly s = new Float32Array(STRIDE);
  private head = 0;
  private used = 0;
  private time = 0;
  private lastDeath = -1;
  // dirty run of slots (ring order) not yet uploaded
  private dirtyStart = 0;
  private dirtyCount = 0;
  private uploadQueued = false;
  private readonly rangeA = { start: 0, count: 0 };
  private readonly rangeB = { start: 0, count: 0 };
  private viewH = 520;
  private readonly hueSteps = new Float32Array(6);
  private readonly uNow = { value: 0 };
  private readonly uViewH = { value: 520 };
  private readonly uMaxPx = { value: 24 };
  private readonly uRib = { value: new THREE.Vector4() };
  private readonly uLand = { value: new THREE.Vector4() };
  private readonly uSpk = { value: new THREE.Vector4() };
  private readonly uPuff = { value: new THREE.Vector4() };
  private readonly emitters: Emitter[] = [];
  // camera axes captured at render time (horizontal)
  private readonly camRight = new THREE.Vector3(1, 0, 0);
  private readonly camBack = new THREE.Vector3(0, 0, 1);
  private readonly tS = new THREE.Vector3();
  private readonly tV = new THREE.Vector3();
  private readonly tA = new THREE.Vector3();
  private readonly tB = new THREE.Vector3();

  constructor(maxParticles = 6000) {
    const cap = Math.max(16, Math.floor(maxParticles));
    this.cap = cap;
    this.data = new Float32Array(cap * STRIDE);
    this.death = new Float32Array(cap).fill(-1);
    // never born: t0 far in the future, life 0
    for (let i = 0; i < cap; i++) this.data[i * STRIDE + 3] = 1e9;
    this.buf = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    // `position` only gives three.js the vertex count; the shader reads aP0
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    geo.setAttribute('aP0', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    geo.setAttribute('aV0', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    geo.setAttribute('aP1', new THREE.InterleavedBufferAttribute(this.buf, 4, 8));
    geo.setAttribute('aV1', new THREE.InterleavedBufferAttribute(this.buf, 4, 12));
    geo.setAttribute('aLook', new THREE.InterleavedBufferAttribute(this.buf, 4, 16));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    geo.setDrawRange(0, 0);
    this.geo = geo;

    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...globals,
        uNow: this.uNow,
        uViewH: this.uViewH,
        uMaxPx: this.uMaxPx,
        uRib: this.uRib,
        uLand: this.uLand,
        uSpk: this.uSpk,
        uPuff: this.uPuff,
        uHueStep: { value: this.hueSteps },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: true,
      depthWrite: true,
      transparent: false,
    });

    const points = new THREE.Points(geo, this.mat);
    points.name = 'Particles';
    points.frustumCulled = false;
    points.visible = false;
    // not in SHADOW_LAYER: particles never cast sun shadows
    points.onBeforeRender = (renderer, _scene, camera) => {
      const rt = renderer.getRenderTarget();
      this.uViewH.value = rt ? rt.height : this.viewH;
      const m = camera.matrixWorld.elements;
      const rx = m[0], rz = m[2];
      const rl = Math.hypot(rx, rz);
      if (rl > 1e-4) this.camRight.set(rx / rl, 0, rz / rl);
      const bx = m[8], bz = m[10];
      const bl = Math.hypot(bx, bz);
      if (bl > 1e-4) this.camBack.set(bx / bl, 0, bz / bl);
      else this.camBack.set(-this.camRight.z, 0, this.camRight.x);
    };
    this.object = points;

    for (let i = 0; i < MAX_EMITTERS; i++) {
      const targets: THREE.Vector3[] = [];
      for (let k = 0; k < MAX_TARGETS; k++) targets.push(new THREE.Vector3());
      this.emitters.push({
        active: false,
        start: 0,
        duration: 1,
        travel: 0.35,
        source: () => this.tS,
        sourceVel: () => this.tV,
        targets,
        hues: new Int32Array(MAX_TARGETS),
        side: new Float32Array(MAX_TARGETS),
        carryArc: new Float32Array(MAX_TARGETS),
        n: 0,
        hue0: 0,
        bandSign: 1,
        carry: 0,
        last: new THREE.Vector3(),
        lastT: 0,
        right: new THREE.Vector3(1, 0, 0),
        back: new THREE.Vector3(0, 0, 1),
      });
    }
    this.syncUniforms();
  }

  /** Height of the low-res render target in game pixels (sizes are computed in these pixels). */
  setViewportHeight(px: number): void {
    // the pipeline renders a 2 px margin around the visible image; when the
    // particles are drawn into a render target its exact height is used instead
    this.viewH = Math.max(1, px);
  }

  /** Number of live particles. */
  get alive(): number {
    let n = 0;
    const t = this.time;
    const d = this.death;
    for (let i = 0; i < this.used; i++) if (d[i] > t) n++;
    return n;
  }

  // ------------------------------------------------------------------ geyser

  geyser(opts: {
    source: () => THREE.Vector3;
    sourceVel: () => THREE.Vector3;
    targets: THREE.Vector3[];
    duration: number;
    travelTime: number;
    hues: number[];
  }): void {
    let e = this.emitters.find((x) => !x.active);
    if (!e) {
      e = this.emitters[0];
      for (const x of this.emitters) if (x.start < e.start) e = x;
    }
    e.active = true;
    e.start = this.time;
    e.duration = Math.max(0.05, opts.duration);
    e.travel = Math.max(0.05, opts.travelTime);
    e.source = opts.source;
    e.sourceVel = opts.sourceVel;
    e.last.copy(opts.source());
    e.lastT = this.time;
    e.carry = 0;
    e.right.copy(this.camRight);
    e.back.copy(this.camBack);
    const n = Math.min(MAX_TARGETS, opts.targets.length);
    if (n === 0) {
      e.n = 1;
      e.targets[0].copy(e.last).y -= 9;
    } else {
      e.n = n;
      for (let i = 0; i < n; i++) e.targets[i].copy(opts.targets[i]);
    }
    for (let i = 0; i < e.n; i++) {
      e.hues[i] = wrapHue(opts.hues[Math.min(i, opts.hues.length - 1)] ?? 0);
      e.carryArc[i] = 0;
    }
    e.hue0 = e.hues[0];
    // lay the rainbow out so each neighbor's hue sits on the side its building is on
    const P1 = e.targets[0];
    let corr = 0;
    for (let i = 1; i < e.n; i++) {
      const lat = (e.targets[i].x - P1.x) * e.right.x + (e.targets[i].z - P1.z) * e.right.z;
      e.side[i] = lat >= 0 ? 1 : -1;
      const off = ((e.hues[i] - e.hue0 + HUE_COUNT + 3) % HUE_COUNT) - 3; // -3..2
      corr += off * lat;
    }
    e.bandSign = corr < 0 ? -1 : 1;
  }

  private updateEmitter(e: Emitter, t1: number, dt: number) {
    const T = fxTune;
    const end = e.start + e.duration;
    const a = Math.max(e.start, t1 - dt);
    const b = Math.min(end, t1);
    const S = this.tA.copy(e.source());
    const V = this.tB.copy(e.sourceVel());
    if (b > a) {
      const span = t1 - e.lastT;
      const xm = ((a + b) * 0.5 - e.start) / e.duration;
      // gush at the start, thinning dribble at the end
      const gush = xm < 0.12 ? 1 - xm / 0.12 : 0;
      const tail = xm > 0.7 ? (xm - 0.7) / 0.3 : 0;
      const rate = T.ribbonRate * (1 + 0.9 * gush - 0.72 * tail);
      let nf = rate * (b - a) + e.carry;
      let count = Math.floor(nf);
      e.carry = nf - count;
      for (let j = 0; j < count; j++) {
        const tj = a + ((j + rnd()) / count) * (b - a);
        const f = span > 1e-6 ? (tj - e.lastT) / span : 1;
        const x = (tj - e.start) / e.duration;
        this.emitRibbon(e, tj, f, S, V, x);
      }
      // arcs to neighbors (stop a little before the ribbon does)
      if (xm < 0.8) {
        for (let i = 1; i < e.n; i++) {
          nf = T.arcRate * (b - a) * (1 + 0.6 * gush) + e.carryArc[i];
          count = Math.floor(nf);
          e.carryArc[i] = nf - count;
          for (let j = 0; j < count; j++) {
            const tj = a + ((j + rnd()) / count) * (b - a);
            const f = span > 1e-6 ? (tj - e.lastT) / span : 1;
            this.emitArc(e, i, tj, f, S, V);
          }
        }
      }
    }
    e.last.copy(S);
    e.lastT = t1;
    if (t1 >= end) e.active = false;
  }

  private emitRibbon(e: Emitter, tj: number, f: number, S: THREE.Vector3, V: THREE.Vector3, x: number) {
    const T = fxTune;
    const s = this.s;
    const gush = x < 0.12 ? 1 - x / 0.12 : 0;
    const tail = x > 0.7 ? (x - 0.7) / 0.3 : 0;
    const wMul = 1 + 0.25 * gush - 0.45 * tail;
    const sMul = 1 + 0.4 * gush - 0.3 * tail;
    const P1 = e.targets[0];
    // mouth position at tj (sub-frame interpolated) and the frame
    const mx = e.last.x + (S.x - e.last.x) * f;
    const my = e.last.y + (S.y - e.last.y) * f;
    const mz = e.last.z + (S.z - e.last.z) * f;
    const R = e.right;
    const B = e.back;

    // dribble: near the end some drops just fall from the mouth onto the roof
    if (tail > 0 && rnd() < 0.45 * tail) {
      const vx = V.x * 0.55 + (rnd() - 0.5) * 1.2;
      const vy = Math.min(V.y, 0) * 0.5 - 1.5 - rnd() * 2;
      const vz = V.z * 0.55 + (rnd() - 0.5) * 1.2;
      const ramp = HUE_RAMPS[wrapHue(e.hue0 + Math.round((rnd() - 0.5) * 2.4))];
      this.writeDrop(mx, my, mz, tj, vx, vy, vz, P1.y, 0, 1, ramp, T.splashSize * (0.7 + 0.6 * rnd()), F_SHADED);
      return;
    }

    // band: -3..3 with widths .5, 1, 1, cw, 1, 1, .5 (rainbow order, primary in the middle)
    const cw = T.centerWeight;
    const W = 5 + cw;
    const q = rnd() * W;
    let k: number;
    if (q < 0.5) k = -3;
    else if (q < 1.5) k = -2;
    else if (q < 2.5) k = -1;
    else if (q < 2.5 + cw) k = 0;
    else if (q < 3.5 + cw) k = 1;
    else if (q < 4.5 + cw) k = 2;
    else k = 3;
    const u = (q / W) * 2 - 1;
    const hue = wrapHue(e.hue0 + e.bandSign * k);
    // the front of the ribbon bulges toward the camera: inner bands overlap outer ones cleanly
    const v = Math.sqrt(Math.max(0, 1 - u * u)) * 0.8 + (rnd() - 0.5) * 0.35;
    const w0 = T.halfWidth0 * wMul;
    const w1 = T.halfWidth1 * wMul;
    const spray = rnd() < T.sprayFrac;
    const jit = 0.12;

    s[0] = mx + R.x * u * w0 + B.x * v * w0 * T.depth + (rnd() - 0.5) * jit;
    s[1] = my + (rnd() - 0.5) * jit;
    s[2] = mz + R.z * u * w0 + B.z * v * w0 * T.depth + (rnd() - 0.5) * jit;
    s[3] = tj;
    // door direction: the bus's right side, from its velocity
    const sp = Math.hypot(V.x, V.z);
    const dx = sp > 0.5 ? -V.z / sp : 0;
    const dz = sp > 0.5 ? V.x / sp : 0;
    s[4] = V.x * T.inherit + R.x * u * 1.6 + dx * T.doorOut;
    s[5] = V.y * T.inherit * 0.5 - T.blast;
    s[6] = V.z * T.inherit + R.z * u * 1.6 + dz * T.doorOut;
    let tt = e.travel;
    let px = P1.x + R.x * u * w1 + B.x * v * w1 * T.depth;
    let py = P1.y;
    let pz = P1.z + R.z * u * w1 + B.z * v * w1 * T.depth;
    let size = T.blobSize * (0.82 + 0.4 * rnd()) * sMul;
    let flags = 0;
    if (spray) {
      const ang = rnd() * Math.PI * 2;
      const rr = T.sprayScatter * (0.4 + 0.6 * rnd());
      px += Math.cos(ang) * rr;
      pz += Math.sin(ang) * rr;
      tt *= 0.92 + 0.2 * rnd();
      size *= 0.42 + 0.15 * rnd();
      flags |= F_SHADED;
    }
    const roll = rnd();
    if (roll < T.glintFrac) flags |= F_GLINT;
    else if (roll < T.glintFrac + T.brightFrac) flags |= F_BRIGHT;
    s[8] = px;
    s[9] = py;
    s[10] = pz;
    s[11] = tt;
    s[12] = R.x * u * 4;
    s[13] = -T.arrive;
    s[14] = R.z * u * 4;
    s[15] = K_RIBBON;
    s[16] = HUE_RAMPS[hue];
    s[17] = size;
    s[18] = rnd();
    s[19] = flags;
    const life = tt + (rnd() < T.landBounce ? HOP_LIFE : 0);
    this.commit(tj, life);
  }

  private emitArc(e: Emitter, i: number, tj: number, f: number, S: THREE.Vector3, V: THREE.Vector3) {
    const T = fxTune;
    const s = this.s;
    const R = e.right;
    const tgt = e.targets[i];
    const side = e.side[i];
    const mx = e.last.x + (S.x - e.last.x) * f + R.x * side * T.halfWidth0 * 0.75;
    const my = e.last.y + (S.y - e.last.y) * f;
    const mz = e.last.z + (S.z - e.last.z) * f + R.z * side * T.halfWidth0 * 0.75;
    const j = T.arcSpread;
    s[0] = mx + (rnd() - 0.5) * j;
    s[1] = my + (rnd() - 0.5) * j;
    s[2] = mz + (rnd() - 0.5) * j;
    s[3] = tj;
    const tt = e.travel + i * config.splat.cascadeStep;
    const hx = tgt.x - mx;
    const hz = tgt.z - mz;
    const dH = Math.max(0.5, Math.hypot(hx, hz));
    const ux = hx / dH;
    const uz = hz / dH;
    const chord = dH / tt;
    const lift = T.arcLift * Math.min(1.8, Math.max(0.35, dH / 18));
    s[4] = V.x * T.inherit * 0.5 + ux * chord * 0.85;
    s[5] = lift;
    s[6] = V.z * T.inherit * 0.5 + uz * chord * 0.85;
    s[7] = tt;
    const ang = rnd() * Math.PI * 2;
    const rr = 1.5 * Math.sqrt(rnd());
    s[8] = tgt.x + Math.cos(ang) * rr;
    s[9] = tgt.y;
    s[10] = tgt.z + Math.sin(ang) * rr;
    s[11] = tt;
    s[12] = ux * chord * 0.3;
    s[13] = -T.arrive;
    s[14] = uz * chord * 0.3;
    s[15] = K_RIBBON;
    s[16] = HUE_RAMPS[e.hues[i]];
    s[17] = T.arcSize * (0.85 + 0.35 * rnd());
    s[18] = rnd();
    const roll = rnd();
    s[19] = roll < T.glintFrac ? F_GLINT : roll < T.glintFrac + T.brightFrac * 1.5 ? F_BRIGHT : 0;
    this.commit(tj, tt + (rnd() < T.landBounce ? HOP_LIFE : 0));
  }

  // ------------------------------------------------------------------ drops

  /** Writes one ballistic drop. e > 0 bounce, 0 stick, < 0 fall past the floor. */
  private writeDrop(
    x: number, y: number, z: number, t0: number,
    vx: number, vy: number, vz: number,
    floorY: number, e: number, gMul: number, ramp: number, size: number, flags: number,
  ) {
    const s = this.s;
    const g = fxTune.gravity * gMul;
    const th = hitTime(vy, y - floorY, g);
    let life: number;
    if (e < 0) life = th + 0.45;
    else if (e === 0) life = th + LINGER;
    else {
      const vyb = Math.sqrt(vy * vy + 2 * g * Math.max(y - floorY, 0)) * e;
      life = th + (2 * vyb) / g + LINGER;
    }
    s[0] = x;
    s[1] = y;
    s[2] = z;
    s[3] = t0;
    s[4] = vx;
    s[5] = vy;
    s[6] = vz;
    s[7] = life;
    s[8] = floorY;
    s[9] = e;
    s[10] = gMul;
    s[11] = 0;
    s[12] = 0;
    s[13] = 0;
    s[14] = 0;
    s[15] = K_DROP;
    s[16] = ramp;
    s[17] = size;
    s[18] = rnd();
    s[19] = flags;
    this.commit(t0, life);
  }

  splash(pos: THREE.Vector3, hue: number, strength: number): void {
    const T = fxTune;
    const k = Math.max(0, Math.min(2.5, strength));
    const n = Math.round(T.splashCount * k);
    const h0 = wrapHue(hue);
    const g = T.gravity;
    for (let i = 0; i < n; i++) {
      // a few fat blobs skid out low; the rest is a crown of droplets
      const big = i < n * 0.14;
      const ang = rnd() * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const out = T.splashOut * (big ? 0.9 + 0.5 * rnd() : 0.3 + 0.7 * rnd());
      const up = T.splashUp * (big ? 0.22 + 0.2 * rnd() : 0.4 + 0.6 * rnd()) * (0.75 + 0.25 * k);
      const r0 = 0.7 * rnd();
      const x0 = pos.x + ca * r0;
      const y0 = pos.y + 0.15;
      const z0 = pos.z + sa * r0;
      const th = hitTime(up, y0 - pos.y, g);
      const reach = r0 + out * th;
      let e: number;
      if (reach > T.roofRadius) e = -1;
      else e = !big && rnd() < T.splashBounce ? T.restitution : 0;
      const roll = rnd();
      const hh = roll < 0.7 ? h0 : wrapHue(h0 + (roll < 0.8 ? 1 : roll < 0.9 ? -1 : roll < 0.95 ? 2 : -2));
      let flags = F_SHADED;
      const r2 = rnd();
      if (r2 < 0.05) flags |= F_GLINT;
      else if (r2 < 0.25) flags |= F_BRIGHT;
      const size = T.splashSize * (big ? 1.7 + 0.6 * rnd() : 0.6 + 0.8 * rnd());
      this.writeDrop(x0, y0, z0, this.time, ca * out, up, sa * out, pos.y, e, 1, HUE_RAMPS[hh], size, flags);
    }
    this.flush();
  }

  // ------------------------------------------------------------------ sparkles

  sparkles(center: THREE.Vector3, radius: number, height: number, hues: number[], count: number): void {
    const T = fxTune;
    const s = this.s;
    const n = Math.max(0, Math.floor(count));
    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const above = rnd() < 0.4;
      let rr: number;
      let y: number;
      if (above) {
        rr = radius * 0.75 * Math.sqrt(rnd());
        y = center.y + 0.4 + rnd() * 2.4;
      } else {
        // around the facade (outside the walls, so they aren't hidden inside)
        rr = radius * (0.85 + 0.2 * rnd());
        y = center.y + 0.5 - Math.max(0, height) * Math.pow(rnd(), 0.8);
      }
      const delay = rnd() * rnd() * 0.32;
      const t0 = this.time + delay;
      const life = T.sparkLife * (0.6 + 0.8 * rnd());
      const out = 0.6 + 2.2 * rnd();
      s[0] = center.x + ca * rr;
      s[1] = y;
      s[2] = center.z + sa * rr;
      s[3] = t0;
      s[4] = ca * out;
      s[5] = 1.2 + 2.4 * rnd();
      s[6] = sa * out;
      s[7] = life;
      s[8] = 2.6; // drag
      s[9] = T.sparkRise * (0.6 + 0.8 * rnd());
      s[10] = 8 + 7 * rnd(); // twinkle rad/s
      s[11] = 0;
      s[12] = 0.55 + 0.2 * rnd(); // blink-out start
      s[13] = 0;
      s[14] = 0;
      s[15] = K_SPARK;
      s[16] = rnd() < T.sparkWhite || hues.length === 0 ? Ramp.GLOW_WHITE : HUE_RAMPS[wrapHue(hues[Math.floor(rnd() * hues.length)])];
      s[17] = T.sparkSize * (0.7 + 0.6 * rnd());
      s[18] = rnd();
      s[19] = 0;
      this.commit(t0, life);
    }
    this.flush();
  }

  ambientSparkle(pos: THREE.Vector3, hue: number): void {
    const T = fxTune;
    const s = this.s;
    const life = 1.3 + 0.8 * rnd();
    s[0] = pos.x;
    s[1] = pos.y;
    s[2] = pos.z;
    s[3] = this.time;
    s[4] = (rnd() - 0.5) * 0.3;
    s[5] = 0.2;
    s[6] = (rnd() - 0.5) * 0.3;
    s[7] = life;
    s[8] = 1.5;
    s[9] = 0.35 + 0.3 * rnd();
    s[10] = 0;
    s[11] = 0;
    s[12] = 1;
    s[13] = 0;
    s[14] = 0;
    s[15] = K_TWINKLE;
    s[16] = rnd() < 0.3 ? Ramp.GLOW_WHITE : HUE_RAMPS[wrapHue(hue)];
    s[17] = T.sparkSize * (0.65 + 0.3 * rnd());
    s[18] = rnd();
    s[19] = 0;
    this.commit(this.time, life);
    this.flush();
  }

  // ------------------------------------------------------------------ puffs

  puff(pos: THREE.Vector3, vel: THREE.Vector3, ramp: number = Ramp.FOG): void {
    const T = fxTune;
    const s = this.s;
    const life = T.puffLife * (0.8 + 0.4 * rnd());
    s[0] = pos.x + (rnd() - 0.5) * 0.3;
    s[1] = pos.y + (rnd() - 0.5) * 0.3;
    s[2] = pos.z + (rnd() - 0.5) * 0.3;
    s[3] = this.time;
    s[4] = vel.x + (rnd() - 0.5) * 0.8;
    s[5] = vel.y + (rnd() - 0.5) * 0.8;
    s[6] = vel.z + (rnd() - 0.5) * 0.8;
    s[7] = life;
    s[8] = 2.4; // drag
    s[9] = 0.9 + 0.5 * rnd(); // buoyancy
    s[10] = T.puffGrow;
    s[11] = 0;
    s[12] = 0;
    s[13] = 0;
    s[14] = 0;
    s[15] = K_PUFF;
    s[16] = ramp;
    s[17] = T.puffSize * (0.8 + 0.4 * rnd());
    s[18] = rnd();
    s[19] = 0;
    this.commit(this.time, life);
    this.flush();
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    this.syncUpload();
    const step = Math.max(0, dt);
    this.time += step;
    if (this.time > REBASE_AT) this.rebase();
    const t = this.time;
    for (const e of this.emitters) if (e.active) this.updateEmitter(e, t, step);
    this.flush();
    this.syncUniforms();
    this.object.visible = t < this.lastDeath;
  }

  private syncUniforms() {
    const T = fxTune;
    this.uNow.value = this.time;
    this.uMaxPx.value = T.maxPx;
    this.uRib.value.set(T.ribbonGlow, T.wobbleAmp, T.wobbleHz, T.hopUp);
    this.uLand.value.set(T.gravity, T.hopOut, T.fogPaint, T.fogPuff);
    this.uSpk.value.set(T.sparkGlow, 0, 0, 0);
    this.uPuff.value.set(T.puffLight, T.puffShadow, 0, 0);
    const hs = this.hueSteps;
    hs[0] = T.stepRed;
    hs[1] = T.stepOrange;
    hs[2] = T.stepYellow;
    hs[3] = T.stepGreen;
    hs[4] = T.stepBlue;
    hs[5] = T.stepViolet;
  }

  // ------------------------------------------------------------------ ring buffer

  /** Copies the scratch slot into the ring. */
  private commit(t0: number, life: number) {
    this.syncUpload();
    const slot = this.head;
    this.s[3] = t0;
    this.s[7] = life;
    this.data.set(this.s, slot * STRIDE);
    const d = t0 + life;
    this.death[slot] = d;
    if (d > this.lastDeath) this.lastDeath = d;
    this.head = (slot + 1) % this.cap;
    if (this.used < this.cap) this.used++;
    if (this.dirtyCount === 0) this.dirtyStart = slot;
    if (this.dirtyCount < this.cap) this.dirtyCount++;
  }

  /** Once three.js has uploaded the queued ranges, start a fresh dirty run. */
  private syncUpload() {
    if (this.uploadQueued && this.buf.updateRanges.length === 0) {
      this.uploadQueued = false;
      this.dirtyCount = 0;
    }
  }

  /** Publishes the dirty run as (at most two) update ranges, reusing the range objects. */
  private flush() {
    this.geo.setDrawRange(0, this.used);
    if (this.dirtyCount === 0) return;
    const ranges = this.buf.updateRanges;
    ranges.length = 0;
    const end = this.dirtyStart + this.dirtyCount;
    if (end <= this.cap) {
      this.rangeA.start = this.dirtyStart * STRIDE;
      this.rangeA.count = this.dirtyCount * STRIDE;
      ranges.push(this.rangeA);
    } else {
      this.rangeA.start = this.dirtyStart * STRIDE;
      this.rangeA.count = (this.cap - this.dirtyStart) * STRIDE;
      this.rangeB.start = 0;
      this.rangeB.count = (end - this.cap) * STRIDE;
      ranges.push(this.rangeA, this.rangeB);
    }
    this.buf.needsUpdate = true;
    this.uploadQueued = true;
    if (this.time < this.lastDeath) this.object.visible = true;
  }

  /** Shifts the clock back so float32 ages stay precise on long sessions. */
  private rebase() {
    const shift = Math.floor(this.time);
    this.time -= shift;
    this.lastDeath -= shift;
    const d = this.data;
    for (let i = 0; i < this.used; i++) {
      d[i * STRIDE + 3] -= shift;
      this.death[i] -= shift;
    }
    for (const e of this.emitters) {
      e.start -= shift;
      e.lastT -= shift;
    }
    this.dirtyStart = 0;
    this.dirtyCount = this.used;
  }
}
