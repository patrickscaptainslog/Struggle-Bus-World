import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { globals, GLSL_COMMON, GLSL_OUT, SHADOW_LAYER } from '../render/materials';
import { Ramp } from '../render/palette';
import { registerTunables } from '../ui/tunables';
import { FONT_LARGE, drawText, measureText, normalizeText, splitLines } from './pixelFont';

// Diegetic place names (there is no HUD): when a building blooms, a classic
// green San Francisco street-name blade springs out of the sidewalk on a
// pole, wobbles, holds, flips 180 deg about the pole into a rainbow version
// (glowing white letters, chasing rainbow trim, a shine sweep, twinkling
// glints, a glowing finial bulb), holds, and slurps back into the ground.
// Re-splatting the same block while its sign stands flips it into the new hue.
//
// Readability at gameplay distance drives everything:
//  - 1 font pixel is ~1.4 game pixels at 175 m, so the blade is comically
//    oversized (~12-26 m wide); long names break onto two lines.
//  - the blade is double-sided like the real ones, so whichever face the
//    camera sees reads correctly; it turns (up to +-40 deg from `facing`) to
//    square up with the camera's view direction, which keeps the rows of
//    letters exactly horizontal on screen;
//  - it leans back by a fraction of the camera's look-down angle so rows keep
//    their height when the camera tilts toward the diorama view;
//  - when the camera is on the building's side, the pole stretches to peek
//    over the roof, and (once the bus has left) its depth is pulled toward the
//    camera a little so the building it names can't hide it.
//
// Rendering: ONE instanced draw call for every sign (pole, collar, clamp,
// blade, finial and glints are one merged geometry; a per-vertex `part` id
// picks how each piece is placed and shaded). Every sign's face is a few rows
// of one small R8 atlas (nearest) holding cell codes; the shader maps codes to
// palette ramps. A second instanced box mesh on the shadow layer only gives
// the sun pass a matching proxy, so the sign throws a long Hopper shadow.
// Everything animates from each sign's age, so dt = 0 (hit-stop) freezes it.

export const signTune = {
  /** World size of one font pixel (m): width, and height (a bit taller to undo the camera's look-down). */
  texelW: 0.45,
  texelH: 0.47,
  /** Blade thickness (m). */
  thickness: 0.36,
  /** Pole height to the bottom of the blade (m). */
  poleHeight: 6.5,
  /** Lines wider than this (font px) break in two. */
  maxLine: 44,
  /**
   * Lean the blade back toward the camera by this fraction of the camera's
   * look-down angle, so rows of letters keep their height when the camera tilts
   * toward the diorama view (0 = plumb like the real thing).
   */
  lean: 0.45,
  /** Max turn toward the camera away from `facing` (deg) and how fast it turns (1/s). */
  maxTurnDeg: 40,
  turnRate: 5,
  /** Spring-up: frequency (Hz), damping ratio, pole give at the overshoot, squash/stretch amount. */
  riseHz: 1.55,
  riseDamping: 0.34,
  poleGive: 0.45,
  stretch: 0.3,
  /** Sway after landing: amplitude (deg), frequency (Hz), decay (1/s). */
  wobbleDeg: 6,
  wobbleHz: 1.35,
  wobbleDecay: 2.6,
  /** Seconds: green hold (after the rise), flip, rainbow hold, sink. */
  riseTime: 0.5,
  holdGreen: 2.2,
  flipTime: 0.55,
  holdRainbow: 1.8,
  sinkTime: 0.6,
  /** Flip spring (Hz, damping) and squash at edge-on. */
  flipHz: 1.25,
  flipDamping: 0.62,
  flipSquash: 0.24,
  /** Shine sweeps across the rainbow face (texels/s); rainbow trim chase speed (texels/s). */
  shineSpeed: 70,
  marqueeSpeed: 9,
  /** Fog multiplier (signs should read through haze). */
  fogMul: 0.35,
  /**
   * Depth pulled toward the camera (m): the sign wins against the building it
   * names (and anything else this close in front of it) instead of hiding
   * behind its roof when the camera is on the far side. 0 = true depth.
   * It only ramps in `biasDelay` s after a show (or re-flip): during the
   * geyser the bus hovers right over that building, between camera and sign,
   * and must stay in front; by the time the bias is on it has zipped off.
   */
  depthBias: 16,
  biasDelay: 1.15,
  /**
   * Extra pole (m) when the camera is on the building's side of the sign
   * (looking over the roof at its back): the sign stretches up to peek over.
   */
  peekHeight: 6,
};
registerTunables('Signs', signTune, {
  texelW: [0.25, 0.8, 0.01],
  texelH: [0.25, 0.9, 0.01],
  thickness: [0.1, 1, 0.02],
  poleHeight: [2, 16, 0.1],
  maxLine: [24, 80, 1],
  lean: [0, 1, 0.01],
  maxTurnDeg: [0, 90, 1],
  turnRate: [0.5, 20, 0.1],
  riseHz: [0.5, 4, 0.05],
  riseDamping: [0.1, 1, 0.01],
  poleGive: [0, 1.5, 0.05],
  stretch: [0, 1, 0.01],
  wobbleDeg: [0, 20, 0.5],
  wobbleHz: [0.3, 4, 0.05],
  wobbleDecay: [0.5, 8, 0.1],
  riseTime: [0.1, 2, 0.05],
  holdGreen: [0.2, 6, 0.1],
  flipTime: [0.2, 2, 0.05],
  holdRainbow: [0.2, 6, 0.1],
  sinkTime: [0.1, 2, 0.05],
  flipHz: [0.4, 4, 0.05],
  flipDamping: [0.2, 1, 0.01],
  flipSquash: [0, 0.6, 0.01],
  shineSpeed: [5, 200, 1],
  marqueeSpeed: [0, 40, 0.5],
  fogMul: [0, 1, 0.01],
  depthBias: [0, 60, 1],
  biasDelay: [0, 4, 0.05],
  peekHeight: [0, 20, 0.5],
});

export interface StreetSignOptions {
  /** e.g. 'STEINER ST', 'ALAMO SQUARE' (normalized to the font; two lines if long). */
  text: string;
  /** Ground point the pole stands on. Copied. */
  position: THREE.Vector3;
  /** Yaw the sign face points toward: face normal = (sin(facing), 0, cos(facing)). */
  facing: number;
  /** Rainbow hue 0..5 for the flipped side. */
  hue: number;
}

const MAX_SIGNS = 4;
const ATLAS_W = 128;
const SLOT_H = 32;
const ATLAS_H = SLOT_H * MAX_SIGNS;

// cell codes in the atlas
const C_EMPTY = 0; // outside the rounded blade: discarded
const C_FIELD = 1;
const C_BORDER = 2;
const C_LETTER = 3;
const C_SHADOW = 4;
const C_RIM = 5;

// face layout (font px)
const RIM = 1;
const BORDER = 1;
const PAD_X = 3;
const PAD_Y = 2;
const LINE_GAP = 2;

// geometry parts
const P_POLE = 0;
const P_BLADE = 1;
const P_FINIAL = 2;
const P_COLLAR = 3;
const P_CLAMP = 4;
const P_STAR = 5;
const STARS = 3;

const POLE_R = 0.3;
const FINIAL_H = 1.3;

interface Sign {
  active: boolean;
  age: number;
  readonly pos: THREE.Vector3;
  facing: number;
  hue: number;
  /** Current turn toward the camera (radians, world yaw without the flip spin). */
  yaw: number;
  fresh: boolean;
  /** Atlas texels used by this sign's face. */
  cellsW: number;
  cellsH: number;
  rainbow: boolean;
  switchAge: number;
  /** Seconds since the last show / re-flip request, and the depth-bias ramp 0..1. */
  sinceShow: number;
  biasK: number;
  /** 0..1: how far the pole has stretched to peek over the building (camera behind it). */
  peekK: number;
  /** Hue to take at the next edge-on moment of a re-flip (-1 = none). */
  pendingHue: number;
  wobbleDir: number;
  text: string;
}

const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** Step response of a damped spring (0 -> 1, overshooting when damping < 1). */
function springStep(t: number, hz: number, zeta: number): number {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * hz;
  const z = Math.min(zeta, 0.999);
  const wd = w * Math.sqrt(1 - z * z);
  const e = Math.exp(-z * w * t);
  return 1 - e * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

/** Time at which the spring step first reaches 1. */
function springCross(hz: number, zeta: number): number {
  const w = 2 * Math.PI * hz;
  const z = Math.min(zeta, 0.999);
  const wd = w * Math.sqrt(1 - z * z);
  return (Math.PI - Math.atan(wd / (z * w))) / wd;
}

function easeInBack(u: number): number {
  const c1 = 1.3;
  return (c1 + 1) * u * u * u - c1 * u * u;
}

function kick(tau: number, amp: number, hz: number, decay: number): number {
  return tau > 0 ? amp * Math.exp(-tau * decay) * Math.sin(2 * Math.PI * hz * tau) : 0;
}

export class StreetSigns {
  readonly object: THREE.Object3D;
  private readonly signs: Sign[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly shadowMesh: THREE.InstancedMesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly atlas: THREE.DataTexture;
  private readonly atlasData = new Uint8Array(ATLAS_W * ATLAS_H);
  private readonly scratch = new Uint8Array(ATLAS_W * SLOT_H);
  private readonly aTex: THREE.InstancedBufferAttribute;
  private readonly aDim: THREE.InstancedBufferAttribute;
  private readonly aAnim: THREE.InstancedBufferAttribute;
  private readonly aFx: THREE.InstancedBufferAttribute;
  private readonly aTilt: THREE.InstancedBufferAttribute;
  private activeCount = 0;
  private lastWant = 0;

  constructor() {
    this.object = new THREE.Group();
    this.object.name = 'StreetSigns';

    this.atlas = new THREE.DataTexture(this.atlasData, ATLAS_W, ATLAS_H, THREE.RedFormat, THREE.UnsignedByteType);
    this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.minFilter = THREE.NearestFilter;
    this.atlas.generateMipmaps = false;
    this.atlas.colorSpace = THREE.NoColorSpace;
    this.atlas.needsUpdate = true;

    const geo = buildSignGeometry();
    this.aTex = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SIGNS * 4), 4);
    this.aDim = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SIGNS * 4), 4);
    this.aAnim = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SIGNS * 4), 4);
    this.aFx = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SIGNS * 4), 4);
    for (let i = 0; i < MAX_SIGNS; i++) (this.aFx.array as Float32Array)[i * 4 + 3] = -1;
    this.aTilt = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SIGNS * 2), 2);
    for (const a of [this.aDim, this.aAnim, this.aFx, this.aTilt]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTex', this.aTex);
    geo.setAttribute('aDim', this.aDim);
    geo.setAttribute('aAnim', this.aAnim);
    geo.setAttribute('aFx', this.aFx);
    geo.setAttribute('aTilt', this.aTilt);

    this.mat = makeSignMaterial(this.atlas);
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX_SIGNS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
    this.object.add(this.mesh);

    // sun-pass proxy: blade box + pole box per sign, with its own instanced depth program (the
    // pipeline's shared override would switch programs between it and the buildings every frame,
    // and the boot prewarm can only link a program a material owns)
    const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const shadowMat = new THREE.MeshDepthMaterial();
    shadowMat.allowOverride = false;
    this.shadowMesh = new THREE.InstancedMesh(boxGeo, shadowMat, MAX_SIGNS * 2);
    this.shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.layers.set(SHADOW_LAYER);
    this.shadowMesh.visible = false;
    this.object.add(this.shadowMesh);

    for (let i = 0; i < MAX_SIGNS; i++) {
      this.signs.push({
        active: false,
        age: 0,
        pos: new THREE.Vector3(),
        facing: 0,
        hue: 0,
        yaw: 0,
        fresh: true,
        cellsW: 1,
        cellsH: 1,
        rainbow: false,
        switchAge: 0,
        pendingHue: -1,
        sinceShow: 0,
        biasK: 0,
        peekK: 0,
        wobbleDir: i % 2 ? 1 : -1,
        text: '',
      });
      this.mesh.setMatrixAt(i, ZERO_M);
      this.shadowMesh.setMatrixAt(i * 2, ZERO_M);
      this.shadowMesh.setMatrixAt(i * 2 + 1, ZERO_M);
    }
  }

  /** Number of signs currently on screen (0..4). */
  get active(): number {
    return this.activeCount;
  }

  show(opts: StreetSignOptions): void {
    const text = normalizeText(opts.text);
    if (!text) return;
    // a sign already standing here pops again with the new paint instead of stacking
    let slot = -1;
    for (let i = 0; i < MAX_SIGNS; i++) {
      const s = this.signs[i];
      if (s.active && s.pos.distanceToSquared(opts.position) < 100) slot = i;
    }
    if (slot < 0) slot = this.signs.findIndex((s) => !s.active);
    if (slot < 0) {
      let oldest = 0;
      for (let i = 1; i < MAX_SIGNS; i++) if (this.signs[i].age > this.signs[oldest].age) oldest = i;
      slot = oldest;
    }
    const s = this.signs[slot];
    const wasActive = s.active;
    const hue = ((Math.round(opts.hue) % 6) + 6) % 6;
    const T = signTune;
    const tFlip = T.riseTime + T.holdGreen;
    const tSink = tFlip + T.flipTime + T.holdRainbow;
    s.sinceShow = 0;
    if (wasActive && s.text === text && s.age > T.riseTime * 0.6 && s.age < tSink) {
      // re-splat of the same block while its sign stands: no re-pop, it flips (again) into the new paint.
      // A double-sided blade at spin 180 deg looks the same as at 0, so rewinding into the flip is seamless.
      if (s.rainbow) {
        s.pendingHue = hue;
        s.age = tFlip - 0.2;
        s.switchAge = s.age - 10; // keep the old face settled (no flash/shine) until the new edge-on
      } else {
        this.setHue(slot, hue);
        s.age = Math.min(s.age, tFlip - 0.2);
      }
      return;
    }
    s.active = true;
    s.age = 0;
    s.text = text;
    s.pendingHue = -1;
    if (!wasActive) s.biasK = 0;
    s.pos.copy(opts.position);
    s.facing = opts.facing;
    s.hue = hue;
    if (!wasActive) s.fresh = true;
    s.rainbow = false;
    s.switchAge = 0;
    s.wobbleDir = -s.wobbleDir;
    this.rasterize(slot, text);
    if (!wasActive) this.activeCount++;
  }

  private setHue(slot: number, hue: number) {
    this.signs[slot].hue = hue;
    (this.aTex.array as Float32Array)[slot * 4 + 3] = hue;
    this.aTex.needsUpdate = true;
  }

  /** Lays the face out (rim, rounded white border, green field, letters + drop shadow) into the slot. */
  private rasterize(slot: number, text: string) {
    const lines = splitLines(text, signTune.maxLine, FONT_LARGE);
    let textW = 1;
    for (const l of lines) textW = Math.max(textW, measureText(l, FONT_LARGE));
    const fh = FONT_LARGE.height;
    const inset = RIM + BORDER;
    const W = Math.min(ATLAS_W, textW + 2 * (inset + PAD_X));
    const textH = lines.length * fh + (lines.length - 1) * LINE_GAP;
    const H = Math.min(SLOT_H, textH + 2 * (inset + PAD_Y));
    const m = this.scratch;
    m.fill(C_EMPTY, 0, W * H);
    // rim + field, then the white border inset by the rim; corners rounded by one cell
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ex = x === 0 || x === W - 1;
        const ey = y === 0 || y === H - 1;
        if (ex && ey) continue;
        const bx = x === 1 || x === W - 2;
        const by = y === 1 || y === H - 2;
        let c = C_FIELD;
        if (ex || ey) c = C_RIM;
        else if (bx && by) c = C_RIM; // rounded inner corner of the border
        else if (bx || by) c = C_BORDER;
        m[y * W + x] = c;
      }
    let ty = inset + PAD_Y;
    for (const l of lines) {
      const lw = measureText(l, FONT_LARGE);
      const tx = Math.floor((W - lw) / 2);
      drawText(m, W, H, l, tx + 1, ty + 1, C_SHADOW, FONT_LARGE);
      drawText(m, W, H, l, tx, ty, C_LETTER, FONT_LARGE);
      ty += fh + LINE_GAP;
    }
    // atlas rows run bottom-up (v = 0 at the bottom of the blade)
    const a = this.atlasData;
    const row0 = slot * SLOT_H;
    a.fill(0, row0 * ATLAS_W, (row0 + SLOT_H) * ATLAS_W);
    for (let y = 0; y < H; y++) {
      const dst = (row0 + (H - 1 - y)) * ATLAS_W;
      for (let x = 0; x < W; x++) a[dst + x] = m[y * W + x];
    }
    this.atlas.needsUpdate = true;
    const s = this.signs[slot];
    s.cellsW = W;
    s.cellsH = H;
    const t = this.aTex.array as Float32Array;
    t[slot * 4] = W;
    t[slot * 4 + 1] = H;
    t[slot * 4 + 2] = row0;
    t[slot * 4 + 3] = s.hue;
    this.aTex.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera): void {
    if (this.activeCount === 0 && !this.mesh.visible) return;
    const T = signTune;
    const tFlip = T.riseTime + T.holdGreen;
    const tFlipEnd = tFlip + T.flipTime;
    const tSink = tFlipEnd + T.holdRainbow;
    const tEnd = tSink + T.sinkTime;
    const t1 = springCross(T.riseHz, T.riseDamping);
    const wRise = 2 * Math.PI * T.riseHz;
    const maxTurn = THREE.MathUtils.degToRad(T.maxTurnDeg);
    const wob = THREE.MathUtils.degToRad(T.wobbleDeg);
    // Face against the camera's view direction (not toward its position): rows of
    // letters then stay parallel to the camera's right axis, i.e. exactly
    // horizontal on screen, wherever the sign sits in the frame.
    const look = camera.getWorldDirection(tmpLook); // refreshes matrixWorld first
    const flat = Math.hypot(look.x, look.z);
    if (flat > 1e-3) this.lastWant = Math.atan2(-look.x, -look.z); // (straight down: keep the last heading)
    const want = this.lastWant;
    const pitch = Math.atan2(-look.y, Math.max(flat, 1e-3));
    const dim = this.aDim.array as Float32Array;
    const anim = this.aAnim.array as Float32Array;
    const fx = this.aFx.array as Float32Array;
    const tilts = this.aTilt.array as Float32Array;
    let count = 0;

    for (let i = 0; i < MAX_SIGNS; i++) {
      const s = this.signs[i];
      if (s.active) {
        s.age += dt;
        if (s.age >= tEnd) {
          s.active = false;
          this.activeCount--;
        }
      }
      if (!s.active) {
        fx[i * 4 + 3] = -1; // no sparkles on parked instances
        this.mesh.setMatrixAt(i, ZERO_M);
        this.shadowMesh.setMatrixAt(i * 2, ZERO_M);
        this.shadowMesh.setMatrixAt(i * 2 + 1, ZERO_M);
        continue;
      }
      count++;
      const age = s.age;
      const bladeW = s.cellsW * T.texelW;
      const bladeH = s.cellsH * T.texelH;
      // camera on the building's side of the sign? stretch the pole to peek over the roof
      const behind = Math.cos(want - s.facing) < -0.2 ? 1 : 0;
      if (s.fresh) s.peekK = behind;
      else s.peekK += (behind - s.peekK) * (1 - Math.exp(-2.5 * dt));
      const poleH = T.poleHeight + T.peekHeight * s.peekK * s.peekK * (3 - 2 * s.peekK);
      const totalH = poleH + bladeH + FINIAL_H + 0.4;

      // ---- vertical: spring up out of the sidewalk, then the pole is the spring
      let sv: number;
      let vel: number; // ds/dt
      const eps = 1 / 120;
      if (age < tSink) {
        sv = springStep(age, T.riseHz, T.riseDamping);
        vel = (sv - springStep(age - eps, T.riseHz, T.riseDamping)) / eps;
      } else {
        const u = Math.min(1, (age - tSink) / T.sinkTime);
        const u0 = Math.max(0, (age - eps - tSink) / T.sinkTime);
        sv = 1 - easeInBack(u);
        vel = (sv - (1 - easeInBack(u0))) / eps;
      }
      let rootY = 0;
      let poleLen = poleH;
      const outOfGround = age < tSink ? age >= t1 : sv >= 1;
      if (outOfGround) poleLen = poleH * (1 + (sv - 1) * T.poleGive);
      else rootY = (sv - 1) * totalH;
      const vn = vel / wRise; // dimensionless speed
      let sy = 1 + T.stretch * THREE.MathUtils.clamp(age >= tSink ? Math.abs(vn) * 0.5 : vn, -0.45, 1);
      let sx = 1 - (sy - 1) * 0.55;

      // ---- sway: kicks on landing, after the flip and as it leaves
      let roll = s.wobbleDir * (kick(age - t1, wob, T.wobbleHz, T.wobbleDecay) - kick(age - tFlipEnd + 0.05, wob * 0.55, T.wobbleHz, T.wobbleDecay));
      roll += s.wobbleDir * kick(age - tSink, wob * 0.35, T.wobbleHz * 1.4, T.wobbleDecay);

      // ---- flip about the pole, squashing at edge-on; swap to rainbow when edge-on
      const tf = age - tFlip;
      let spin = Math.PI * springStep(tf, T.flipHz, T.flipDamping);
      if (tf > -0.2 && tf < 0.05) {
        const b = Math.sin((Math.PI * (tf + 0.2)) / 0.25);
        spin -= 0.22 * b; // anticipation wind-up
        sy *= 1 - 0.07 * b;
        sx *= 1 + 0.04 * b;
      }
      const edge = Math.sin(Math.PI * THREE.MathUtils.clamp(spin / Math.PI, 0, 1));
      sy *= 1 - T.flipSquash * edge;
      sx *= 1 + T.flipSquash * 0.35 * edge;
      if (spin >= Math.PI / 2 && (!s.rainbow || s.pendingHue >= 0)) {
        if (s.pendingHue >= 0) this.setHue(i, s.pendingHue);
        s.pendingHue = -1;
        s.rainbow = true;
        s.switchAge = age;
      }
      const flash = s.rainbow ? Math.exp(-(age - s.switchAge) * 5.5) : 0;

      // ---- shine sweeps across the rainbow face (diagonal texel units)
      let shine = -1000;
      if (s.rainbow) {
        const ts = age - s.switchAge - 0.12;
        const period = (s.cellsW + s.cellsH + 10) / T.shineSpeed + 0.45;
        if (ts > 0 && ts < period * 2) shine = (ts % period) * T.shineSpeed - 5;
      }

      // ---- turn toward the camera (double-sided: the nearer face counts), within +-maxTurn of facing
      let side = s.facing;
      if (Math.abs(wrapAngle(want - side)) > Math.PI / 2) side += Math.PI;
      const target = side + THREE.MathUtils.clamp(wrapAngle(want - side), -maxTurn, maxTurn);
      if (s.fresh) {
        s.yaw = target;
        s.fresh = false;
      }
      let diff = wrapAngle(target - s.yaw);
      if (Math.abs(diff) > Math.PI / 2) {
        // the camera crossed to the other face: a double-sided blade turned 180 deg looks identical
        s.yaw = wrapAngle(s.yaw + Math.PI);
        diff = wrapAngle(target - s.yaw);
      }
      s.yaw = wrapAngle(s.yaw + diff * (1 - Math.exp(-T.turnRate * dt)));

      // ---- lean back toward the camera: whichever face looks at it tips its top away (0 when edge-on)
      const tilt = -T.lean * Math.max(0, pitch) * Math.cos(s.yaw + spin - want);
      s.sinceShow += dt;
      s.biasK += ((s.sinceShow >= T.biasDelay ? 1 : 0) - s.biasK) * (1 - Math.exp(-5 * dt));
      tilts[i * 2] = tilt;
      tilts[i * 2 + 1] = T.depthBias * s.biasK * s.biasK * (3 - 2 * s.biasK);

      // ---- write instance data
      tmpQ.setFromAxisAngle(UP, s.yaw + spin);
      tmpS.set(1, 1, 1);
      tmpM.compose(tmpV.set(s.pos.x, s.pos.y + rootY, s.pos.z), tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
      const o = i * 4;
      dim[o] = bladeW;
      dim[o + 1] = bladeH;
      dim[o + 2] = poleLen;
      dim[o + 3] = roll;
      anim[o] = sx;
      anim[o + 1] = sy;
      anim[o + 2] = s.rainbow ? 1 : 0;
      anim[o + 3] = flash;
      fx[o] = shine;
      fx[o + 1] = age * T.marqueeSpeed;
      fx[o + 2] = s.pos.y - 0.05;
      fx[o + 3] = s.rainbow ? age - s.switchAge : -1;

      // shadow proxy: blade (rigid on the bent pole top) and a straight pole
      tmpM2.makeRotationAxis(ZAXIS, -roll);
      tmpM2.multiply(tiltM.makeRotationX(tilt));
      tmpM2.setPosition(roll * poleLen * 0.5, poleLen, 0);
      tmpM2.multiply(scaleM(bladeW * sx, bladeH * sy, T.thickness));
      this.shadowMesh.setMatrixAt(i * 2, tmpM2.premultiply(tmpM));
      this.shadowMesh.setMatrixAt(i * 2 + 1, scaleM(POLE_R * 2, poleLen, POLE_R * 2).premultiply(tmpM));
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.shadowMesh.instanceMatrix.needsUpdate = true;
    this.aDim.needsUpdate = true;
    this.aAnim.needsUpdate = true;
    this.aFx.needsUpdate = true;
    this.aTilt.needsUpdate = true;
    const u = this.mat.uniforms;
    u.uThick.value = T.thickness;
    u.uFogMul.value = T.fogMul;
    this.mesh.visible = count > 0;
    this.shadowMesh.visible = count > 0;
  }
}

const scaleTmp = new THREE.Matrix4();
const tiltM = new THREE.Matrix4();
function scaleM(x: number, y: number, z: number): THREE.Matrix4 {
  return scaleTmp.makeScale(x, y, z);
}

/** Pole, base collar, blade clamp, blade (unit box) and finial in one indexed geometry with a `part` attribute. */
function buildSignGeometry(): THREE.BufferGeometry {
  const tag = (g: THREE.BufferGeometry, part: number) => {
    const n = g.getAttribute('position').count;
    g.setAttribute('part', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    g.deleteAttribute('uv');
    return g;
  };
  const pole = tag(new THREE.CylinderGeometry(POLE_R, POLE_R, 1, 8, 6, true).translate(0, 0.5, 0), P_POLE);
  const collar = tag(new THREE.CylinderGeometry(0.5, 0.6, 0.8, 8, 1).translate(0, 0.4, 0), P_COLLAR);
  const clamp = tag(new THREE.BoxGeometry(1.1, 1.0, 0.62).translate(0, -0.35, 0), P_CLAMP);
  const blade = tag(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), P_BLADE);
  const neck = tag(new THREE.CylinderGeometry(0.16, 0.24, 0.45, 6, 1).translate(0, 0.22, 0), P_FINIAL);
  const ball = tag(new THREE.SphereGeometry(0.52, 8, 6).translate(0, 0.45 + 0.42, 0), P_FINIAL);
  const merged = mergeGeometries([pole, collar, clamp, blade, neck, ball, buildStars()], false);
  if (!merged) throw new Error('StreetSigns: geometry merge failed');
  return merged;
}

/**
 * Sparkle glints: a pixel "plus" per star (long arms, ~1 game px thick at
 * gameplay distance), expanded camera-facing in the vertex shader. normal.x
 * carries the star index; the shader picks its anchor and twinkle phase.
 */
function buildStars(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const arm = 1.0;
  const th = 0.2;
  for (let k = 0; k < STARS; k++) {
    for (const [hw, hh] of [
      [arm, th],
      [th, arm],
    ]) {
      const b = pos.length / 3;
      pos.push(-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0);
      for (let v = 0; v < 4; v++) nor.push(k, 0, 0);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(P_STAR), 1));
  g.setIndex(idx);
  return g;
}

function makeSignMaterial(atlas: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...globals,
      uAtlas: { value: atlas },
      uThick: { value: signTune.thickness },
      uFogMul: { value: signTune.fogMul },
    },
    vertexShader: /* glsl */ `
      ${GLSL_COMMON}
      in float part;
      in vec4 aTex;   // cellsW, cellsH, atlas row, hue
      in vec4 aDim;   // blade width m, blade height m, pole length m, roll
      in vec4 aAnim;  // blade scale x, scale y, rainbow, flash
      in vec4 aFx;    // shine position, marquee offset, ground y, seconds since the flip (-1 before)
      in vec2 aTilt;  // blade lean about its bottom edge (radians), depth bias (m)
      uniform float uThick;
      out vec3 vWorldPos;
      out vec3 vWorldNormal;
      out vec3 vViewNormal;
      out vec3 vObj;
      flat out vec3 vObjN;
      flat out float vPart;
      flat out vec4 vTex;
      flat out vec4 vAnim;
      flat out vec4 vFx;
      void main() {
        vec3 p = position;
        vec3 n = normal;
        float L = aDim.z;
        float th = aDim.w;
        int pt = int(part + 0.5);
        vec2 starOff = vec2(0.0);
        if (pt == ${P_STAR}) {
          // anchor in the blade frame (top-left corner, right edge, beside the finial)
          int k = int(normal.x + 0.5);
          float W = aDim.x * aAnim.x, H = aDim.y * aAnim.y;
          vec3 anchor = k == 0 ? vec3(-0.5 * W - 0.1, H + 0.15, 0.0)
                      : k == 1 ? vec3(0.5 * W + 0.25, H * 0.32, 0.0)
                      : vec3(0.95, H + 1.55, 0.0);
          float ts = aFx.w;
          float tw = 0.0;
          if (ts >= 0.0) {
            // each star blinks small -> big -> small about once a second, in pixel-art size steps
            float ph = fract(ts * 1.15 + float(k) * 0.41);
            tw = max(sin(6.2831853 * ph), 0.0);
            tw = floor(tw * tw * 3.0 + 0.35) / 3.0;
            tw = max(tw, exp(-ts * 7.0) * 1.2); // all pop together on the flip
          }
          starOff = position.xy * tw * (k == 2 ? 0.8 : 1.15);
          p = anchor;
          n = vec3(0.0, 0.0, 1.0);
        }
        if (pt == ${P_POLE}) {
          // cantilever bend: dx = th * y^2 / 2L, slope th at the top
          float y = p.y * L;
          float k = th / (2.0 * max(L, 0.01));
          p = vec3(p.x + k * y * y, y, p.z);
          float sl = 2.0 * k * y;
          n = normalize(vec3(n.x - n.y * sl, n.y + n.x * sl, n.z));
        } else if (pt != ${P_COLLAR}) {
          vec3 q = p;
          // (stars arrive here with p = their anchor in the blade frame)
          if (pt == ${P_BLADE}) q = vec3(p.x * aDim.x * aAnim.x, p.y * aDim.y * aAnim.y, p.z * uThick);
          else if (pt == ${P_FINIAL}) q = vec3(p.x, p.y + aDim.y * aAnim.y, p.z);
          if (pt != ${P_CLAMP}) {
            float ct = cos(aTilt.x), st = sin(aTilt.x);
            q = vec3(q.x, q.y * ct - q.z * st, q.y * st + q.z * ct);
            n = vec3(n.x, n.y * ct - n.z * st, n.y * st + n.z * ct);
          }
          float c = cos(th), s = sin(th);
          q = vec3(q.x * c + q.y * s, -q.x * s + q.y * c, q.z);
          n = vec3(n.x * c + n.y * s, -n.x * s + n.y * c, n.z);
          p = q + vec3(th * L * 0.5, L, 0.0);
        }
        vObj = position;
        vObjN = normal;
        vPart = part;
        vTex = aTex;
        vAnim = aAnim;
        vFx = aFx;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
        vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
        // slide along the view ray: same pixel, nearer depth
        vec4 vp = viewMatrix * wp;
        float d = length(vp.xyz);
        float pull = max(d - aTilt.y, d * 0.25) / max(d, 1e-3);
        vp.xyz *= pull;
        if (pt == ${P_STAR}) vp.xyz += vec3(starOff, 1.0) * pull;
        gl_Position = projectionMatrix * vp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      uniform sampler2D uAtlas;
      uniform float uFogMul;
      in vec3 vWorldPos;
      in vec3 vWorldNormal;
      in vec3 vViewNormal;
      in vec3 vObj;
      flat in vec3 vObjN;
      flat in float vPart;
      flat in vec4 vTex;
      flat in vec4 vAnim;
      flat in vec4 vFx;
      ${GLSL_OUT}

      // ramp step -> a light level that lands squarely on that step
      float onStep(float s) { return (clamp(s, 0.0, 7.0) + 0.12) / 7.0; }
      // per-hue field step: bright and saturated, dark enough that white letters read
      float hueStep(int h) {
        if (h == 0) return 4.0; // red
        if (h == 1) return 4.0; // orange
        if (h == 2) return 5.0; // yellow (step 4 is golden: too close to orange)
        if (h == 3) return 4.0; // green
        if (h == 4) return 3.0; // blue
        return 3.0;             // violet
      }

      void main() {
        // the depth bias would let the buried part show through the sidewalk: clip it by hand
        if (vWorldPos.y < vFx.z) discard;
        vec3 n = normalize(vWorldNormal);
        float fog = sbFog(vWorldPos) * uFogMul;
        int pt = int(vPart + 0.5);
        bool rainbow = vAnim.z > 0.5;
        float flash = vAnim.w;
        int hue = int(vTex.w + 0.5);
        float hueRamp = float(${Ramp.RED} + hue);

        if (pt == ${P_STAR}) {
          sbWrite(float(${Ramp.GLOW_WHITE}), 1.0, fog * 0.5, 1.0, vViewNormal, 0.5, 0.5);
          return;
        }
        if (pt != ${P_BLADE}) {
          float ramp = float(${Ramp.GREY_LIGHT});
          float glow = 0.0;
          // a notch darker than the sidewalk (same grey family) so the pole reads against it
          float light = sbLight(vWorldPos, n, pt == ${P_COLLAR} ? -0.2 : -0.12, 1.0);
          if (pt == ${P_FINIAL} && rainbow) {
            ramp = float(${Ramp.GLOW_WHITE});
            glow = 0.85;
            light = max(light, 0.9);
          }
          sbWrite(ramp, light, fog, glow, vViewNormal, 0.311, 1.0);
          return;
        }

        // blade: which atlas cell is this fragment on? (the back face mirrors x so it reads too)
        vec2 cells = vTex.xy;
        float u = vObjN.z < -0.5 ? 0.5 - vObj.x : vObj.x + 0.5;
        vec2 tc = vec2(u, vObj.y) * cells;
        ivec2 ci = ivec2(clamp(floor(tc), vec2(0.0), cells - 1.0));
        float code = floor(texelFetch(uAtlas, ci + ivec2(0, int(vTex.z)), 0).r * 255.0 + 0.5);
        if (code < 0.5) discard;

        float sun = smoothstep(-0.05, 0.35, dot(n, uSunDir)); // face toward the sun: one step brighter
        float ramp;
        float st;
        float glow = 0.0;
        bool isFace = abs(vObjN.z) > 0.5;
        if (!isFace) {
          // blade edges: same as the rim
          ramp = rainbow ? hueRamp : float(${Ramp.SIGN_GREEN});
          st = sun + max(vObjN.y, 0.0);
          if (rainbow) glow = 0.08;
        } else if (!rainbow) {
          ramp = float(${Ramp.SIGN_GREEN});
          if (code == ${C_FIELD}.0) st = 3.0 + sun * 0.9;
          else if (code == ${C_SHADOW}.0) st = 2.0 + sun * 0.9;
          else if (code == ${C_RIM}.0) st = 0.0 + sun * 0.9;
          else {
            ramp = float(${Ramp.WHITE});
            st = code == ${C_LETTER}.0 ? 6.0 + sun : 5.0 + sun;
          }
        } else {
          float hs = hueStep(hue);
          ramp = hueRamp;
          glow = 0.12;
          // diagonal shine band
          float sd = tc.x + tc.y * 0.7 - vFx.x;
          float shine = (sd >= 0.0 && sd < 3.0) ? 1.0 : 0.0;
          if (code == ${C_FIELD}.0) {
            st = hs + 2.0 * shine;
          } else if (code == ${C_SHADOW}.0) {
            st = 1.0 + shine;
          } else if (code == ${C_RIM}.0) {
            st = 0.0;
          } else if (code == ${C_LETTER}.0) {
            ramp = float(${Ramp.WHITE});
            st = 7.0;
            glow = 0.8 + 0.2 * shine;
          } else {
            // rainbow trim chasing around the border
            float W = cells.x, H = cells.y;
            float x0 = 1.0, y0 = 1.0, x1 = W - 2.0, y1 = H - 2.0;
            float cx = float(ci.x), cy = float(ci.y);
            float per;
            if (cy == y1) per = cx - x0;
            else if (cx == x1) per = (x1 - x0) + (y1 - cy);
            else if (cy == y0) per = (x1 - x0) + (y1 - y0) + (x1 - cx);
            else per = 2.0 * (x1 - x0) + (y1 - y0) + (cy - y0);
            int seg = int(floor((per - vFx.y) / 3.0));
            int h2 = ((hue + seg) % 6 + 6) % 6;
            ramp = float(${Ramp.RED} + h2);
            st = 6.0;
            glow = 0.55;
          }
          st += 3.0 * flash;
          glow = max(glow, flash * 0.9);
        }
        sbWrite(ramp, onStep(st), fog, glow, vViewNormal, 0.373, 1.0);
      }
    `,
  });
}
