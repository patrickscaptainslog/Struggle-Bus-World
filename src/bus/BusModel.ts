import * as THREE from 'three';
import { makeRampMaterial } from '../render/materials';
import { Ramp } from '../render/palette';
import { registerTunables } from '../ui/tunables';
import { ANCHOR, buildBusGeometry, D, designToObjectY as Y, PART } from './busShape';

// The Struggle Bus: the hero. One merged geometry, one ramp material, ONE
// draw call. Everything that moves (squash, gag heave, wheeze, wheels, door
// "mouth", stop arm, eye + lid, mirrors, pressure-valve hatch, belly fill) is
// done in the vertex shader from a handful of vec4 uniforms, so update() is
// a few springs and uniform writes — no allocations, no attribute uploads.
//
// The belly band is the game's only UI: 24 full-width rainbow slices (red at
// the rear -> violet at the front) that light up back to front as `fullness`
// rises, plus a six-hue progress bar across the rear for the chase camera.
// When full, a rainbow wave chases toward the mouth, the band sparkles, the
// roof hatch pops and bobs over a glowing hole (pot about to boil over), and
// the amber flashers wig-wag. While barfing, the red flashers wig-wag and the
// stop arm swings out. The bus never casts sun shadows (no SHADOW_LAYER).

export interface BusPose {
  /** 1 rest, <1 squashed wide+short, >1 stretched tall+thin; volume preserving. */
  squash: number;
  /** 0..1 headlight openness. */
  eye: number;
  /** 0..1 belly glow fill. */
  fullness: number;
  /** 0..1 front door open = barfing. */
  mouth: number;
  /** m/s. */
  speed: number;
  /** 0..1 shudder. */
  wheeze: number;
  /** 0..1 gag bulge. */
  heave: number;
}

/** Live-tunable look + feel numbers (read every frame). */
export const busTune = {
  /** Global light trim on the whole bus (ramp units). */
  light: 0,
  /** Fog multiplier: the hero stays crisp through the haze. */
  fogMul: 0.3,
  /** How much building shadows darken the bus (0..1). */
  shadowMul: 0.55,
  /** Belly band glow when lit, and its light offset unlit / lit. */
  bandGlow: 0.6,
  bandDark: -0.5,
  bandLit: -0.3,
  /** Band pot-belly sag at full (m, scale 1). */
  bellySag: 0.12,
  /** Ready shimmer: wave amount and sparkle probability. */
  readyWave: 0.3,
  sparkle: 0.1,
  /** Gag bulge amount at heave = 1. */
  heaveAmt: 0.18,
  /** Seconds for a gulp to travel from mid-body to the mouth. */
  gulpTime: 0.26,
  /**
   * Wheeze breathing (matches the audio's busVoice.breath rhythm: period
   * (1.3 + 0.95 * fullness) / breathRate s, inhale 0-40%, exhale 47-90%).
   * inhaleAmt = height swell at full wheeze; wheezeSag = exhale sag
   * (fraction of height); shudder = exhale rattle (m).
   */
  breathRate: 1,
  inhaleAmt: 0.075,
  wheezeSag: 0.06,
  shudder: 0.06,
  /** Snap the bus's light to ramp-step centres (0 = raw, 1 = crisp bands). */
  lightSnap: 1,
  /** Fraction of the sun's contrast removed from the bus (0 = normal toon light). */
  sunSoft: 0.42,
  /** Squash split: fraction of the volume compensation that goes into width (rest into length). */
  squashSplit: 0.62,
  /** Door leaf max swing (rad). */
  doorMax: 1.35,
  /** Doorway glow when the mouth is fully open. */
  doorGlow: 0.95,
  /** Eye glow at closed / wide. */
  eyeGlowMin: 0.5,
  eyeGlowMax: 1.0,
  /** Automatic blinks: mean interval (s), 0 = off. */
  blinkEvery: 3.8,
  /** Lean (shear) per m/s² of acceleration, max, and spring. */
  leanPerAccel: 0.006,
  leanMax: 0.12,
  leanHz: 1.6,
  leanDamp: 0.35,
  /** Jiggle (mirrors, hatch): kick per unit squash change, spring. */
  jiggleKick: 3.2,
  jiggleHz: 3.4,
  jiggleDamp: 0.22,
  /** Stop arm spring (flings out with overshoot). */
  armHz: 2.6,
  armDamp: 0.32,
  /** Pressure-valve hatch: open angle when full, rattle, spring. */
  hatchPop: 1.9,
  hatchRattle: 0.16,
  hatchHz: 4.2,
  hatchDamp: 0.28,
  holeGlow: 0.6,
  /** Warning flasher glow. */
  flashGlow: 0.85,
  /** Visible wheel spin cap (rad/s) so fast flight never strobes backwards. */
  maxWheelSpin: 16,
};

registerTunables('Bus', busTune as unknown as Record<string, unknown>, {
  light: [-0.3, 0.3, 0.01],
  fogMul: [0, 1, 0.01],
  shadowMul: [0, 1, 0.01],
  bandGlow: [0, 1, 0.01],
  bandDark: [-1, 0, 0.01],
  bandLit: [-1, 0.5, 0.01],
  bellySag: [0, 0.4, 0.01],
  readyWave: [0, 1, 0.01],
  sparkle: [0, 0.5, 0.01],
  heaveAmt: [0, 0.4, 0.01],
  gulpTime: [0.05, 1.5, 0.01],
  breathRate: [0.2, 3, 0.05],
  inhaleAmt: [0, 0.25, 0.005],
  wheezeSag: [0, 0.2, 0.005],
  shudder: [0, 0.2, 0.005],
  sunSoft: [0, 1, 0.01],
  lightSnap: [0, 1, 0.01],
  squashSplit: [0, 1, 0.01],
  doorMax: [0, 1.8, 0.01],
  doorGlow: [0, 1, 0.01],
  eyeGlowMin: [0, 1, 0.01],
  eyeGlowMax: [0, 1, 0.01],
  blinkEvery: [0, 12, 0.1],
  leanPerAccel: [0, 0.03, 0.001],
  leanMax: [0, 0.4, 0.01],
  leanHz: [0.2, 6, 0.05],
  leanDamp: [0.05, 1.5, 0.01],
  jiggleKick: [0, 12, 0.1],
  jiggleHz: [0.5, 8, 0.05],
  jiggleDamp: [0.05, 1.5, 0.01],
  armHz: [0.5, 8, 0.05],
  armDamp: [0.05, 1.5, 0.01],
  hatchPop: [0, 2.4, 0.01],
  hatchRattle: [0, 0.6, 0.01],
  hatchHz: [0.5, 10, 0.05],
  hatchDamp: [0.05, 1.5, 0.01],
  holeGlow: [0, 1, 0.01],
  flashGlow: [0, 1, 0.01],
  maxWheelSpin: [0, 60, 0.5],
});

const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : v.toFixed(5));
const v3 = (a: readonly number[]) => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

const BASE_Y = Y(0);
const BODY_H = D.roofTop;
const HALF_L = (D.zRear - D.zFront) / 2;
const MID_Z = (D.zRear + D.zFront) / 2;
const EYE_C = [D.eyeX, Y(D.eyeY), D.eyeZ];
const LID_C = [D.eyeX + 0.01, Y(D.lidY), D.eyeZ - 0.06];

// Vertex animation. Runs inside makeRampMaterial's main() with `vec3 p` and
// `vec3 n` (object space) in scope, before the ramp/lightOffset/glow
// attributes are copied to varyings; the trailing #defines redirect those
// copies to our animated values.
const VERTEX_CHUNK = /* glsl */ `
  int bPart = int(uv.x + 0.5);
  float bPar = uv.y;
  float bRamp = ramp;
  float bLo = lightOffset;
  float bGlow = glow;
  float bT = uAnim.x;
  float bFull = clamp(uPose.w, 0.0, 1.0);
  float bReady = smoothstep(0.985, 1.0, bFull);
  float bMouth = clamp(uPose2.x, 0.0, 1.0);
  float bEye = clamp(uPose2.y, 0.0, 1.0);
  float bWide = smoothstep(0.72, 1.0, bEye);

  if (bPart == ${PART.WHEEL}) {
    float c = cos(uAnim.y), s = sin(uAnim.y);
    vec2 piv = vec2(${f(Y(D.axleY))}, bPar);
    vec2 q = p.yz - piv;
    p.yz = piv + vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    n.yz = vec2(c * n.y - s * n.z, s * n.y + c * n.z);
  } else if (bPart == ${PART.DOOR_F} || bPart == ${PART.DOOR_R}) {
    float sgn = bPart == ${PART.DOOR_F} ? 1.0 : -1.0;
    float a = sgn * bMouth * (uFx2.y + 0.08 * sin(bT * 23.0 + sgn * 1.7));
    float c = cos(a), s = sin(a);
    vec2 q = vec2(p.x - ${f(D.doorX)}, p.z - bPar);
    p.x = ${f(D.doorX)} + q.x * c + q.y * s;
    p.z = bPar - q.x * s + q.y * c;
    n.xz = vec2(n.x * c + n.z * s, -n.x * s + n.z * c);
  } else if (bPart == ${PART.DOORWAY}) {
    bGlow = uFx2.z * smoothstep(0.0, 0.35, bMouth);
    bLo += 0.6 * bMouth;
  } else if (bPart == ${PART.ARM}) {
    float a = -uPose2.z * 1.5708;
    float c = cos(a), s = sin(a);
    vec2 q = vec2(p.x - ${f(D.armX)}, p.z - bPar);
    p.x = ${f(D.armX)} + q.x * c + q.y * s;
    p.z = bPar - q.x * s + q.y * c;
    n.xz = vec2(n.x * c + n.z * s, -n.x * s + n.z * c);
  } else if (bPart == ${PART.EYE}) {
    float sy = mix(0.22, 1.0, smoothstep(0.0, 0.72, bEye)) * (1.0 + 0.32 * bWide);
    float sx = 1.0 + 0.32 * bWide;
    vec3 c0 = ${v3(EYE_C)};
    p = c0 + (p - c0) * vec3(sx, sy, 1.0);
    n = normalize(n / vec3(sx, sy, 1.0));
    bGlow = mix(uFx.z, uFx.w, bEye);
  } else if (bPart == ${PART.LID}) {
    float sq = 1.0 - bEye;
    float a = -0.26 * sq + 0.06 * bWide;
    float c = cos(a), s = sin(a);
    vec3 c0 = ${v3(LID_C)};
    vec2 d = p.xy - c0.xy;
    p.xy = c0.xy + vec2(c * d.x - s * d.y, s * d.x + c * d.y) + vec2(0.0, 0.07 * bWide - ${f(D.lidDrop)} * sq);
    n.xy = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
  } else if (bPart == ${PART.MIRROR}) {
    float a = bPar * uAnim.w;
    float c = cos(a), s = sin(a);
    vec2 piv = vec2(bPar * ${f(D.mirX)}, ${f(Y(D.mirY))});
    vec2 d = p.xy - piv;
    p.xy = piv + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    n.xy = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
  } else if (bPart == ${PART.BAND}) {
    float h = ${f(0.5 / D.bandSlices)};
    float lit = smoothstep(bPar - h, bPar + h, bFull);
    float wave = 0.5 + 0.5 * sin(bPar * 25.0 - bT * 8.0);
    float g = uBand.x * (1.0 + uFx2.w * bReady * (wave - 0.35));
    float fr = (bFull - bPar) * ${f(D.bandSlices)};
    g += 0.3 * exp(-fr * fr) * (1.0 - bReady);
    float sp = sbHash11(bPar * 131.0 + floor(bT * 9.0) * 7.31);
    if (sp > 1.0 - uFx3.x * bReady) g = 1.0;
    bGlow = g * lit;
    bLo = mix(uBand.y, uBand.z, lit);
    if (p.y < ${f(Y((D.bandY0 + D.bandY1) / 2))}) {
      float zz = (p.z - ${f(0.5 * (D.axleF + D.axleR))}) / ${f(0.5 * (D.axleR - D.axleF))};
      p.y -= uBand.w * bFull * max(1.0 - zz * zz, 0.0);
    }
  } else if (bPart == ${PART.HATCH}) {
    float a = -uPose2.w;
    float c = cos(a), s = sin(a);
    vec2 piv = vec2(${f(Y(D.roofTop + 0.04))}, bPar);
    vec2 q = p.yz - piv;
    p.yz = piv + vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    n.yz = vec2(c * n.y - s * n.z, s * n.y + c * n.z);
  } else if (bPart == ${PART.HOLE}) {
    float hue = bReady > 0.5 ? mod(floor(bT * 4.0), 6.0) : min(floor(bFull * 6.0), 5.0);
    bRamp = ${f(Ramp.RED)} + hue;
    bGlow = uFx.x * smoothstep(0.04, 0.5, bFull);
  } else if (bPart == ${PART.FLASH_AMBER}) {
    float on = step(0.0, sin(bT * 8.4 + bPar * 3.14159));
    bGlow = uFx.y * bReady * (1.0 - smoothstep(0.05, 0.3, bMouth)) * on;
    bLo += 0.35 * bGlow;
  } else if (bPart == ${PART.FLASH_RED}) {
    float on = step(0.0, sin(bT * 10.5 + bPar * 3.14159));
    bGlow = uFx.y * smoothstep(0.05, 0.3, bMouth) * on;
    bLo += 0.35 * bGlow;
  }

  // ---- whole-body deformation (all parts) ----
  float hy = clamp((p.y - ${f(BASE_Y)}) / ${f(BODY_H)}, 0.0, 1.2);
  float zl = (p.z - ${f(MID_Z)}) / ${f(HALF_L)};
  float hammock = max(1.0 - zl * zl, 0.0);
  // gag heave: a bulge that travels from mid-body toward the mouth and convulses
  float hv = clamp(uPose.y, 0.0, 1.0);
  float hc = mix(1.2, -2.4, uFx3.z);
  float dz = (p.z - hc) / 2.6;
  float gag = hv * uShape.x * exp(-dz * dz) * (1.0 + 0.35 * sin(bT * 29.0) * hv);
  p.x *= 1.0 + gag * (0.35 + 0.65 * hy);
  p.y += gag * hy * ${f(BODY_H * 0.55)};
  // wheeze: wheezy breathing, sagging, rattling on the exhale
  float wz = clamp(uPose.z, 0.0, 1.0);
  float inh = uFx4.z;
  float exh = uFx4.w;
  // gasp: swell up and puff the chest out
  p.x *= 1.0 + wz * uShape.y * 0.55 * inh * hy;
  p.y = ${f(BASE_Y)} + (p.y - ${f(BASE_Y)}) * (1.0 + wz * uShape.y * inh);
  // long wheezy exhale: deflate into a sagging hammock and rattle
  p.y -= wz * uShape.w * ${f(BODY_H)} * (0.3 + 0.7 * exh) * hammock * hy;
  float sh = wz * uShape.z * (0.2 + 0.8 * exh) * (sin(bT * 83.0) + 0.7 * sin(bT * 127.0 + p.z * 0.9));
  p.x += sh * hy;
  p.y += sh * 0.5;
  // follow-through lean (top lags behind acceleration)
  p.z += uAnim.z * (p.y - ${f(BASE_Y)});
  // squash & stretch about the base, volume preserving
  float sq = max(uPose.x, 0.3);
  vec3 scl = vec3(pow(sq, -uFx2.x), sq, pow(sq, uFx2.x - 1.0));
  p = vec3(p.x * scl.x, ${f(BASE_Y)} + (p.y - ${f(BASE_Y)}) * scl.y, p.z * scl.z);
  n = normalize(n / scl);
  // hero light: soften the sun's contrast so every face of the bus stays in
  // the vivid middle of its ramp (shade side yellow-orange, never rust)
  vec3 bWN = normalize(mat3(modelMatrix) * n);
  float bNdl = max(dot(bWN, uSunDir), 0.0);
  bLo += uFx3.w - uFx3.y * uLight.x * bNdl;
  // crisp toon bands: predict the fragment's light (incl. building shadows)
  // and nudge it to the centre of its ramp step, so the small, moving hero
  // never sits in a dither band (dither on a moving object crawls)
  vec3 bWP = (modelMatrix * vec4(p, 1.0)).xyz;
  float bSh = mix(1.0, sbShadow(bWP, bWN), uFx4.y);
  float bL = uLight.y + uLight.z * (0.5 + 0.5 * bWN.y) + uLight.x * bNdl * bSh + bLo;
  bLo += (floor(clamp(bL, 0.0, 1.0) * 7.0 + 0.5) / 7.0 - bL) * uFx4.x;
#define ramp bRamp
#define lightOffset bLo
#define glow bGlow
`;

const TAU = Math.PI * 2;

/** Critically-or-under-damped spring step (semi-implicit Euler, substepped). */
function springStep(s: { x: number; v: number }, target: number, hz: number, zeta: number, dt: number) {
  const w = TAU * hz;
  const n = Math.max(1, Math.ceil(dt * 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-w * w * (s.x - target) - 2 * zeta * w * s.v) * h;
    s.x += s.v * h;
  }
}

export class BusModel {
  /** Caller sets root.position / root.quaternion; local forward = -Z, up = +Y. */
  readonly root = new THREE.Group();
  /** Where the barf emerges (the front door, right side), root-local. */
  readonly mouthLocal: THREE.Vector3;
  /** Underside center, root-local. */
  readonly bellyLocal: THREE.Vector3;
  /** Bumper-to-bumper length (m). */
  readonly length: number;
  /** Extra anchors for game glue (root-local): the eye, the roof hatch, the exhaust pipe. */
  readonly eyeLocal: THREE.Vector3;
  readonly hatchLocal: THREE.Vector3;
  readonly exhaustLocal: THREE.Vector3;
  /** The single mesh (one draw call). */
  readonly mesh: THREE.Mesh;
  readonly scale: number;

  private readonly mat: THREE.ShaderMaterial;
  private readonly uPose = new THREE.Vector4(1, 0, 0, 0); // squash, heave, wheeze, full
  private readonly uPose2 = new THREE.Vector4(0, 1, 0, 0); // mouth, eye, arm, hatch lid
  private readonly uAnim = new THREE.Vector4(); // time, wheel angle, lean, jiggle
  private readonly uBand = new THREE.Vector4(); // glow, dark lo, lit lo, belly sag
  private readonly uShape = new THREE.Vector4(); // heave amt, inhale amt, shudder, wheeze sag
  private readonly uFx = new THREE.Vector4(); // hole glow, flash glow, eye glow min, max
  private readonly uFx2 = new THREE.Vector4(); // squash split, door max, doorway glow, ready wave
  private readonly uFx3 = new THREE.Vector4(); // sparkle, sun soften, gulp, light trim
  private readonly uFx4 = new THREE.Vector4(); // light snap, shadow mul, inhale, exhale

  private wheelAngle = 0;
  private lastSpeed = NaN;
  private lastSquash = NaN;
  private accF = 0;
  private readonly lean = { x: 0, v: 0 };
  private readonly jig = { x: 0, v: 0 };
  private readonly arm = { x: 0, v: 0 };
  private readonly lid = { x: 0, v: 0 };
  private lastT = NaN;
  private blinkAt = -1;
  private nextBlink = 2;
  private seed = 12345;
  /** 0..1 progress of the gag bulge travelling from mid-body to the mouth. */
  private gulp = 0;
  /** Breath cycle: phase 0..1, period (s), and when glue last synced it. */
  private breathPh = 0;
  private breathP = 1.3;
  private breathSyncT = -1e9;
  private inhale = 0;
  private exhale = 0;

  constructor(scale = 1.6) {
    this.scale = scale;
    const geo = buildBusGeometry();
    // the vertex shader swings parts outside the rest bounds: pad the sphere
    if (geo.boundingSphere) geo.boundingSphere.radius *= 1.3;
    this.mat = makeRampMaterial({
      vertexRamp: true,
      fogMul: busTune.fogMul,
      shadowMul: busTune.shadowMul,
      surfaceId: 0.731,
      vertexChunk: VERTEX_CHUNK,
      uniforms: {
        uPose: { value: this.uPose },
        uPose2: { value: this.uPose2 },
        uAnim: { value: this.uAnim },
        uBand: { value: this.uBand },
        uShape: { value: this.uShape },
        uFx: { value: this.uFx },
        uFx2: { value: this.uFx2 },
        uFx3: { value: this.uFx3 },
        uFx4: { value: this.uFx4 },
      },
    });
    // declare the custom uniforms in the vertex stage
    this.mat.vertexShader = 'uniform vec4 uPose, uPose2, uAnim, uBand, uShape, uFx, uFx2, uFx3, uFx4;\n' + this.mat.vertexShader;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.scale.setScalar(scale);
    this.mesh.name = 'StruggleBus';
    this.root.name = 'BusRoot';
    this.root.add(this.mesh);
    // never in SHADOW_LAYER: the bus has its own drop shadow (game glue)

    const s = scale;
    this.mouthLocal = new THREE.Vector3(...ANCHOR.mouth).multiplyScalar(s);
    this.bellyLocal = new THREE.Vector3(...ANCHOR.belly).multiplyScalar(s);
    this.eyeLocal = new THREE.Vector3(...ANCHOR.eye).multiplyScalar(s);
    this.hatchLocal = new THREE.Vector3(...ANCHOR.hatch).multiplyScalar(s);
    this.exhaustLocal = new THREE.Vector3(...ANCHOR.exhaust).multiplyScalar(s);
    this.length = (D.zRear - D.zFront) * s;
    this.applyTunables();
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private applyTunables() {
    const T = busTune;
    const u = this.mat.uniforms;
    u.uLightOffset.value = 0; // folded into the vertex light (uFx3.w) so the snap sees it
    u.uFogMul.value = T.fogMul;
    u.uShadowMul.value = T.shadowMul;
    this.uBand.set(T.bandGlow, T.bandDark, T.bandLit, T.bellySag);
    this.uShape.set(T.heaveAmt, T.inhaleAmt, T.shudder, T.wheezeSag);
    this.uFx.set(T.holeGlow, T.flashGlow, T.eyeGlowMin, T.eyeGlowMax);
    this.uFx2.set(T.squashSplit, T.doorMax, T.doorGlow, T.readyWave);
    this.uFx3.set(T.sparkle, T.sunSoft, this.gulp, T.light);
    this.uFx4.set(T.lightSnap, T.shadowMul, this.inhale, this.exhale);
  }

  update(dt: number, t: number, pose: BusPose): void {
    const T = busTune;
    if (!(dt > 0) || dt > 0.25) dt = Number.isFinite(this.lastT) && t > this.lastT ? Math.min(t - this.lastT, 0.05) : 0;
    this.lastT = t;

    const squash = Number.isFinite(pose.squash) ? pose.squash : 1;
    const full = clamp01(pose.fullness);
    const mouth = clamp01(pose.mouth);

    // wheels: spin with speed, capped so they never strobe
    const r = D.wheelR * this.scale;
    const w = Math.max(-T.maxWheelSpin, Math.min(T.maxWheelSpin, pose.speed / r));
    this.wheelAngle = (this.wheelAngle - w * dt) % TAU;

    if (dt > 0) {
      // lean: top lags behind acceleration (zip off after a barf, lurch on a stall)
      if (!Number.isFinite(this.lastSpeed)) this.lastSpeed = pose.speed;
      const acc = (pose.speed - this.lastSpeed) / dt;
      this.lastSpeed = pose.speed;
      this.accF += (acc - this.accF) * (1 - Math.exp(-dt * 10));
      const leanTarget = Math.max(-T.leanMax, Math.min(T.leanMax, this.accF * T.leanPerAccel));
      springStep(this.lean, leanTarget, T.leanHz, T.leanDamp, dt);

      // jiggle: kicked by sudden squash changes, rattled by wheezing
      if (!Number.isFinite(this.lastSquash)) this.lastSquash = squash;
      this.jig.v += (squash - this.lastSquash) * -T.jiggleKick * TAU;
      this.lastSquash = squash;
      this.jig.v += pose.wheeze * Math.sin(t * 37) * 0.6 * dt * TAU;
      springStep(this.jig, 0, T.jiggleHz, T.jiggleDamp, dt);
      this.jig.x = Math.max(-0.7, Math.min(0.7, this.jig.x));

      // stop arm: flings out when the mouth opens, slaps back after
      springStep(this.arm, mouth > 0.12 ? 1 : 0, T.armHz, T.armDamp, dt);
      if (this.arm.x < 0) {
        this.arm.x = 0;
        this.arm.v = Math.abs(this.arm.v) * 0.3;
      }

      // pressure-valve hatch: pops when full, slams (and bounces) when emptied
      const ready = smoothstep(0.985, 1, full);
      springStep(this.lid, ready > 0.5 ? T.hatchPop : full * 0.06, T.hatchHz, T.hatchDamp, dt);
      if (this.lid.x < 0) {
        this.lid.x = 0;
        this.lid.v = Math.abs(this.lid.v) * 0.45;
      }
    }

    // breathing: gasp (0-40%), hold, wheezy exhale (47-90%)
    this.breathPh += dt / this.breathP;
    if (this.breathPh >= 1) {
      const synced = t - this.breathSyncT < this.breathP * 1.6 + 0.4;
      if (synced) this.breathPh = 1; // wait for the next breathe() from the audio
      else {
        this.breathPh %= 1;
        this.breathP = (1.3 + 0.95 * full) / Math.max(0.2, T.breathRate);
      }
    }
    const ph = this.breathPh;
    this.inhale = ph < 0.4 ? Math.sin((Math.PI * ph) / 0.4) : 0;
    this.exhale = ph >= 0.47 && ph < 0.9 ? Math.sin((Math.PI * (ph - 0.47)) / 0.43) : 0;

    // gag: each heave onset sends one gulp from mid-body toward the mouth
    if (pose.heave > 0.02) this.gulp = Math.min(1, this.gulp + dt / Math.max(0.05, T.gulpTime));
    else this.gulp = 0;

    // pot-lid rattle as the belly fills, and a boiling bob when popped open
    const ready = smoothstep(0.985, 1, full);
    const rattle = T.hatchRattle * smoothstep(0.35, 0.98, full) * (1 - ready) * Math.pow(Math.max(0, Math.sin(t * 19)), 6) * (0.35 + 0.65 * this.exhale);
    const bob = ready * 0.09 * Math.sin(t * 11);
    const lidAngle = Math.max(0, this.lid.x + rattle + bob);

    // blinks
    let eye = clamp01(pose.eye);
    if (T.blinkEvery > 0) {
      if (t < this.blinkAt - 1 || t > this.nextBlink + 30) this.nextBlink = t + 1; // time jumped
      if (t >= this.nextBlink) {
        this.blinkAt = t;
        this.nextBlink = t + T.blinkEvery * (0.55 + 0.9 * this.rand());
        if (this.rand() < 0.2) this.nextBlink = t + 0.28; // double blink
      }
      const k = (t - this.blinkAt) / 0.15;
      if (k >= 0 && k < 1) eye *= 1 - 0.94 * Math.sin(Math.PI * k);
    }

    this.applyTunables();
    this.uPose.set(squash, clamp01(pose.heave), clamp01(pose.wheeze), full);
    this.uPose2.set(mouth, eye, Math.max(0, this.arm.x), lidAngle);
    this.uAnim.set(t % 600, this.wheelAngle, this.lean.x, this.jig.x + 0.03 * Math.sin(t * 2.1) * pose.wheeze);
  }

  /**
   * Optional audio sync: start a breath now with this period (s) — e.g. pass
   * the value AudioEngine's bus voice returns from breath(). Without calls
   * the bus breathes on its own with the same rhythm.
   */
  breathe(period: number): void {
    this.breathPh = 0;
    this.breathP = Math.max(0.3, period);
    this.breathSyncT = this.lastT;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
