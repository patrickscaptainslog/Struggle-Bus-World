import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { Ramp, HUE_RAMPS } from '../render/palette';
import { clamp } from '../game/springs';
import type { Flight } from '../game/Flight';
import type { TurboDrive } from '../game/Turbo';
import type { CameraRig } from '../game/CameraRig';
import type { Particles } from './Particles';

// Turbo gear effects. Everything 3D writes the indexed G-buffer (palette ramps
// via sbWrite, no free RGB), dissolves by hard thresholds (no alpha), is one
// draw call, and uploads at most one buffer per frame:
//  - TurboLens: the camera pulls back and widens with the turbo speed (settling
//    exactly, so a held gear's lens is perfectly still) and kicks its fov at the
//    shift and the sonic boom. Pure (no GL): the offline harness runs it.
//  - the rainbow contrail: a camera-facing ribbon of six hue bands from the
//    bus's tail. Fresh it is a clean flag; with age it swells into cel-shaded
//    vapor: the outline billows, the ribbon wanders, and it breaks up into
//    clumps anchored to the air it was laid in, so they hold still while the
//    bus leaves them (one dynamic buffer).
//  - speed lines: world-anchored streaks wrapped in a box around the view,
//    stretched along the velocity, solid pixels, one in five a hue (uniforms
//    only: no uploads).
//  - the sonic boom: a shock of white vapor off the nose, a rainbow hoop that
//    leaves the bus and sweeps back around the camera, a ring of vapor and
//    rainbow puffs (Particles), a palette flash and a camera jolt.
//  - the strain: the bus rattles (a translation jitter of a game pixel or two)
//    and backfires while it claws up to a gear's height and spools.

export const turboFxTune = {
  /** contrail: life (s), width at the bus and at the end of its life (m), sample spacing (m) */
  trailLife: 1.1,
  trailW0: 3.2,
  trailW1: 15,
  trailStep: 2,
  /** contrail vapor: size of a billow along the trail (m), how far an old trail wanders (m) */
  trailBillow: 9,
  trailWander: 5,
  /** speed lines: box around the view (m), motion-blur length (s of travel), width (game px) */
  lineBox: 190,
  lineBlur: 0.07,
  linePx: 1.7,
  /** vapor cone: duration (s), final radius and length (m) */
  coneTime: 0.36,
  coneRadius: 12,
  coneLength: 24,
  /** rainbow hoop: duration (s), radius from / to (m), how far behind the bus it ends up (m) */
  hoopTime: 0.95,
  hoopR0: 9,
  hoopR1: 92,
  hoopBack: 150,
  /** fov kick spring (Hz) */
  kickHz: 2.2,
};

const TRAIL_N = 96;
const TRAIL_STRIDE = 10;
const LINES = 90;

const GLSL_BAYER = /* glsl */ `
// 4x4 ordered (Bayer) threshold, 0..1
float tbBayer4(ivec2 p) {
  const float M[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (M[(p.y & 3) * 4 + (p.x & 3)] + 0.5) / 16.0;
}
// value noise, 0..1, periodic every 256 cells in x (a long flight's distance never runs out of precision)
float tbHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float tbNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, 256.0), x1 = mod(i.x + 1.0, 256.0);
  return mix(mix(tbHash(vec2(x0, i.y)), tbHash(vec2(x1, i.y)), f.x), mix(tbHash(vec2(x0, i.y + 1.0)), tbHash(vec2(x1, i.y + 1.0)), f.x), f.y);
}
`;

/** Camera: pull-back and lens with the turbo speed, fov kicks at the shift and the boom. */
export class TurboLens {
  pull = 0;
  fov = 0;
  private kick = 0;
  private kickV = 0;
  private k = 0;

  /** A fov punch of `deg` (rings down on a damped spring). */
  punch(deg: number) {
    this.kickV += deg * 2 * Math.PI * turboFxTune.kickHz * 2.2;
  }

  update(dt: number, drive: TurboDrive, rig: CameraRig, f: Flight) {
    const T = config.turbo;
    const C = config.camera;
    // the turbo speed on a log scale (0 surge, 1 at G1), eased; it snaps exactly once close, so a held
    // gear's lens holds perfectly still (a lens that breathes rescales the snapped pixel grid)
    const want = clamp(drive.speedK, 0, 2.5);
    const d = want - this.k;
    if (Math.abs(d) < 0.004) this.k = want;
    else this.k += d * (1 - Math.exp(-2.2 * dt));
    const w = 2 * Math.PI * turboFxTune.kickHz;
    this.kickV += (-w * w * this.kick - 2 * 0.55 * w * this.kickV) * dt;
    this.kick += this.kickV * dt;
    if (Math.abs(this.kick) < 0.01 && Math.abs(this.kickV) < 0.05) this.kick = this.kickV = 0;
    const k = Math.min(this.k, 1) + 0.25 * Math.max(0, this.k - 1);
    this.pull = T.camPull * k;
    this.fov = T.camFov * k + this.kick;
    rig.turboPull = this.pull;
    rig.turboFov = this.fov;
    rig.turboHero = 1 + (T.heroScale - 1) * Math.min(this.k, 1);
    // cancel part of the follow springs' lag (all of it from G2 on): position spring 2 zeta / omega, look 1/6 s
    const lead = clamp(T.camLead * Math.min(this.k, 1) + (1 - T.camLead) * clamp((this.k - 1) / 1.5, 0, 1), 0, 1);
    const lagT = (2 * C.followDamping) / (2 * Math.PI * Math.max(0.05, C.followHz));
    const vx = f.fx * f.speed, vz = f.fz * f.speed;
    // (a gear's climb is fast too: the vertical lag goes with the climb rate, or the camera ends up under the bus)
    const leadV = Math.max(lead, clamp((Math.abs(f.vy) - 30) / 120, 0, 1));
    rig.turboLead.set(vx * lead, f.vy * leadV, vz * lead).multiplyScalar(lagT);
    rig.turboLookLead.set(vx * lead, f.vy * leadV, vz * lead).multiplyScalar(1 / 6);
  }
}

export class TurboFx {
  readonly object = new THREE.Group();
  readonly lens = new TurboLens();
  /** rattle offset for the bus this frame (m, world) and roll jitter (rad) */
  readonly rattle = new THREE.Vector3();
  rattleRoll = 0;

  private readonly trailGeo = new THREE.BufferGeometry();
  private readonly trailData: Float32Array;
  private readonly trailBuf: THREE.InterleavedBuffer;
  private readonly tx = new Float32Array(TRAIL_N);
  private readonly ty = new Float32Array(TRAIL_N);
  private readonly tz = new Float32Array(TRAIL_N);
  private readonly tBorn = new Float32Array(TRAIL_N);
  private readonly tOn = new Float32Array(TRAIL_N);
  /** distance along the trail (m): the vapor is anchored to it */
  private readonly tDist = new Float32Array(TRAIL_N);
  private tHead = -1;
  private tCount = 0;
  private readonly trail: THREE.Mesh;
  private readonly trailU = { uOn: { value: 0 }, uBillow: { value: 9 }, uWander: { value: 5 } };

  private readonly lines: THREE.Mesh;
  private readonly lineU = {
    uCenter: { value: new THREE.Vector3() },
    uVel: { value: new THREE.Vector3() },
    uBox: { value: 190 },
    uLen: { value: 0.05 },
    uPix: { value: 0.002 },
    uOn: { value: 0 },
  };

  private readonly cone: THREE.Mesh;
  private readonly coneU = { uT: { value: 0 }, uR: { value: 13 }, uL: { value: 26 } };
  private coneT = -1;

  private readonly hoop: THREE.Mesh;
  private readonly hoopU = { uT: { value: 1 }, uSeed: { value: 0 } };
  private hoopT = -1;

  private time = 0;
  /** the first frames draw every effect invisibly, so its shader compiles behind the loading fog, not at the shift */
  private warm = 3;
  private rattleT = 0;
  private puffT = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly tailLocal: THREE.Vector3;
  private readonly noseLocal: THREE.Vector3;
  private readonly exhaustLocal: THREE.Vector3;

  /** busLength (m) and the exhaust pipe in the bus's local frame (BusModel.length / exhaustLocal). */
  constructor(private readonly particles: Particles, busLength: number, exhaustLocal?: THREE.Vector3) {
    this.object.name = 'TurboFx';
    this.tailLocal = new THREE.Vector3(0, 0.9, busLength * 0.5 + 0.4);
    this.exhaustLocal = exhaustLocal ? exhaustLocal.clone() : this.tailLocal.clone();
    this.noseLocal = new THREE.Vector3(0, 0.6, -busLength * 0.5 - 0.5);

    // ---- contrail: interleaved [x y z | dir x y z | side, age, width, dist] per vertex, two vertices per sample
    this.trailData = new Float32Array(TRAIL_N * 2 * TRAIL_STRIDE);
    this.trailBuf = new THREE.InterleavedBuffer(this.trailData, TRAIL_STRIDE);
    this.trailBuf.setUsage(THREE.DynamicDrawUsage);
    const g = this.trailGeo;
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(this.trailBuf, 3, 0));
    g.setAttribute('aDir', new THREE.InterleavedBufferAttribute(this.trailBuf, 3, 3));
    g.setAttribute('aSide', new THREE.InterleavedBufferAttribute(this.trailBuf, 1, 6));
    g.setAttribute('aAge', new THREE.InterleavedBufferAttribute(this.trailBuf, 1, 7));
    g.setAttribute('aW', new THREE.InterleavedBufferAttribute(this.trailBuf, 1, 8));
    g.setAttribute('aDist', new THREE.InterleavedBufferAttribute(this.trailBuf, 1, 9));
    const idx = new Uint16Array((TRAIL_N - 1) * 6);
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2, o = i * 6;
      idx[o] = a;
      idx[o + 1] = a + 1;
      idx[o + 2] = a + 2;
      idx[o + 3] = a + 1;
      idx[o + 4] = a + 3;
      idx[o + 5] = a + 2;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    g.setDrawRange(0, 0);
    const trailMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...globals, ...this.trailU },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        in vec3 aDir;
        in float aSide;
        in float aAge;
        in float aW;
        in float aDist;
        uniform float uWander;
        out float vSide;
        out float vAge;
        out float vDist;
        out vec3 vWorld;
        void main() {
          vec4 wc = modelMatrix * vec4(position, 1.0);
          vec3 toCam = normalize(cameraPosition - wc.xyz);
          vec3 sd = cross(aDir, toCam);
          float sl = length(sd);
          sd = sl > 1e-4 ? sd / sl : vec3(0.0, 1.0, 0.0);
          // with age the ribbon stops being a ruler: it wanders on the air it was left in, and sags a little
          float drift = (sin(aDist * 0.019) + 0.6 * sin(aDist * 0.047 + 1.7)) * uWander * aAge;
          vec3 p = wc.xyz + sd * (aSide * aW * 0.5 + drift);
          p.y += (sin(aDist * 0.031 + 0.6) - 0.8) * uWander * 0.5 * aAge;
          vSide = aSide;
          vAge = aAge;
          vDist = aDist;
          vWorld = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        ${GLSL_OUT}
        ${GLSL_BAYER}
        uniform float uOn;
        uniform float uBillow;
        in float vSide;
        in float vAge;
        in float vDist;
        in vec3 vWorld;
        void main() {
          float along = vDist / uBillow;
          float set = smoothstep(0.04, 0.4, vAge); // fresh it is a flag; set, it is vapor
          // the outline billows: each side swells on its own, and the hue bands follow it
          float swell = tbNoise(vec2(along, vSide < 0.0 ? 3.0 : 11.0));
          float reach = mix(1.0, 0.62 + 0.38 * swell, set);
          float side = vSide / reach;
          float edge = abs(side);
          if (edge > 1.0) discard;
          // it breaks up into clumps of air (anchored to the trail, so they hold still as the bus leaves them);
          // the outer bands go first, a pixel of dither on each clump's edge; and it thins out as it nears the
          // camera (perspective would make its tail a wall of color over the thumb zone)
          float clump = 0.66 * tbNoise(vec2(along * 0.9, side * 1.3 + 5.0)) + 0.34 * tbNoise(vec2(along * 2.3, side * 3.1 + 9.0));
          float near = smoothstep(55.0, 175.0, length(vWorld - cameraPosition));
          float keep = ((1.0 - vAge) * 1.55 - edge * edge * 0.3) * near;
          if (clump + (tbBayer4(ivec2(gl_FragCoord.xy)) - 0.5) * 0.1 > keep) discard;
          float band = floor(clamp(side * 0.5 + 0.5, 0.0, 0.9999) * 6.0);
          float fresh = 1.0 - vAge;
          // cel-shaded: lit crests and shaded folds on the set vapor, the saturated middle of each hue ramp
          float fold = 0.65 * tbNoise(vec2(along * 1.3 + 2.0, side * 1.4)) + 0.35 * (0.5 - side * 0.5);
          float cel = (fold > 0.56 ? 0.1 : fold < 0.4 ? -0.09 : 0.0) * set;
          float light = 0.52 + 0.16 * fresh + 0.1 * (1.0 - edge) + cel;
          sbWrite(${Ramp.RED}.0 + band, light, sbFog(vWorld), 0.55 * fresh * uOn, vec3(0.0, 0.0, 1.0), 0.61, 0.5);
        }
      `,
    });
    this.trail = new THREE.Mesh(g, trailMat);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.trail.renderOrder = 1;
    this.object.add(this.trail);

    // ---- speed lines: one instanced quad per streak, everything in the vertex shader
    const lg = new THREE.InstancedBufferGeometry();
    lg.setAttribute('aQuad', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    lg.setIndex([0, 2, 1, 1, 2, 3]);
    const seeds = new Float32Array(LINES * 4);
    let s = 12345;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < LINES; i++) {
      seeds[i * 4] = rnd();
      seeds[i * 4 + 1] = rnd();
      seeds[i * 4 + 2] = rnd();
      seeds[i * 4 + 3] = (i + 0.5) / LINES; // instance threshold: lines appear in order as uOn rises
    }
    lg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    lg.instanceCount = LINES;
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const lineMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...globals, ...this.lineU },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        uniform vec3 uCenter;
        uniform vec3 uVel;
        uniform float uBox;
        uniform float uLen;
        uniform float uPix;
        uniform float uOn;
        in vec2 aQuad;
        in vec4 aSeed;
        out float vFade;
        out float vAlong;
        out vec3 vWorld;
        flat out float vRamp;
        void main() {
          // a world-anchored lattice of streaks, wrapped into the box around the view: they stay put
          // in the world while the bus tears through them
          vec3 w = uCenter + (fract(aSeed.xyz - uCenter / uBox) - 0.5) * uBox;
          float sp = length(uVel);
          vec3 dir = sp > 1e-3 ? uVel / sp : vec3(0.0, 0.0, -1.0);
          vec3 p = w - dir * sp * uLen * aQuad.x;
          vec3 toCam = cameraPosition - p;
          float dist = length(toCam);
          vec3 sd = cross(dir, toCam / max(dist, 1e-3));
          float sl = length(sd);
          sd = sl > 1e-4 ? sd / sl : vec3(0.0, 1.0, 0.0);
          p += sd * aQuad.y * uPix * dist * 0.5;
          float r = length(w - uCenter) / (0.5 * uBox);
          vFade = (1.0 - smoothstep(0.55, 0.95, r)) * smoothstep(30.0, 70.0, length(w - cameraPosition));
          vFade *= step(aSeed.w, uOn);
          // one streak in five carries a hue
          float pick = floor(aSeed.w * ${LINES}.0 + 0.5);
          vRamp = mod(pick, 5.0) < 0.5 ? ${Ramp.RED}.0 + mod(pick / 5.0, 6.0) : ${Ramp.GLOW_WHITE}.0;
          vAlong = aQuad.x;
          vWorld = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          if (vFade <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        ${GLSL_OUT}
        ${GLSL_BAYER}
        in float vFade;
        in float vAlong;
        in vec3 vWorld;
        flat in float vRamp;
        void main() {
          // solid pixels: a fading streak gets shorter, it never turns into dots; a bright head, a step dimmer behind
          if (vAlong > vFade) discard;
          float white = step(${Ramp.GLOW_WHITE}.0 - 0.5, vRamp);
          float light = mix(0.66, 0.82, white) + (vAlong < 0.4 ? 0.14 : 0.0);
          sbWrite(vRamp, light, sbFog(vWorld), 0.2, vec3(0.0, 0.0, 1.0), 0.73, 0.5);
        }
      `,
    });
    this.lines = new THREE.Mesh(lg, lineMat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.object.add(this.lines);

    // ---- vapor cone: an open cone off the nose, axis along -Z (the bus's forward)
    const cg = new THREE.CylinderGeometry(1, 0.15, 1, 28, 3, true);
    cg.translate(0, -0.5, 0);
    cg.rotateX(Math.PI / 2); // narrow end at the nose (z = 0), wide end behind (z = +1)
    const coneMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...globals, ...this.coneU },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        uniform float uT;
        uniform float uR;
        uniform float uL;
        out float vAlong;
        out float vAround;
        out vec3 vWorld;
        void main() {
          float grow = 1.0 - (1.0 - uT) * (1.0 - uT);
          vec3 p = position;
          float along = clamp(p.z, 0.0, 1.0);
          p.xy *= uR * (0.25 + 0.75 * grow);
          p.z *= uL * (0.3 + 0.7 * grow);
          vAlong = along;
          vAround = atan(position.y, position.x);
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        ${GLSL_OUT}
        ${GLSL_BAYER}
        uniform float uT;
        in float vAlong;
        in float vAround;
        in vec3 vWorld;
        void main() {
          // the shock's white vapor: fluted along the cone, torn away from the nose in clumps
          float flute = tbNoise(vec2(fract(vAround / 6.2831853 + 0.5) * 18.0, vAlong * 2.0 + uT * 3.0));
          float keep = (1.0 - uT) * (1.5 - 0.7 * vAlong);
          if (flute + (tbBayer4(ivec2(gl_FragCoord.xy)) - 0.5) * 0.12 > keep) discard;
          float light = flute > 0.55 ? 0.82 : 0.97;
          sbWrite(${Ramp.GLOW_WHITE}.0, light, sbFog(vWorld), 0.6 * (1.0 - uT), vec3(0.0, 0.0, 1.0), 0.83, 0.5);
        }
      `,
    });
    this.cone = new THREE.Mesh(cg, coneMat);
    this.cone.frustumCulled = false;
    this.cone.visible = false;
    this.object.add(this.cone);

    // ---- rainbow hoop: an annulus facing along the bus's path; the shader draws the band inside its outer edge
    const hg = new THREE.RingGeometry(0.42, 1, 96, 1);
    const hoopMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...globals, ...this.hoopU },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        out vec2 vP;
        out vec3 vWorld;
        void main() {
          vP = position.xy;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        ${GLSL_OUT}
        ${GLSL_BAYER}
        uniform float uT;
        uniform float uSeed;
        in vec2 vP;
        in vec3 vWorld;
        void main() {
          float rho = length(vP);
          float a = fract(atan(vP.y, vP.x) / 6.2831853 + 0.5);
          // the front is scalloped, and the band thins as it stretches
          float scallop = 0.05 * tbNoise(vec2(a * 40.0, uSeed));
          float w = 0.5 - 0.2 * uT;
          float b = (1.0 - scallop - rho) / w; // 0 at the crest, 1 at the inner edge
          if (b < 0.0 || b >= 1.0) discard;
          // it tears from the inside out, clumps first, the crest last
          float clump = 0.7 * tbNoise(vec2(a * 44.0, b * 3.0 + uSeed)) + 0.3 * tbNoise(vec2(a * 110.0, b * 6.0 + uSeed));
          float keep = 2.1 * (1.0 - uT * uT) - 0.8 * b;
          if (clump + (tbBayer4(ivec2(gl_FragCoord.xy)) - 0.5) * 0.1 > keep) discard;
          // a white crest, then the six hues, red outside
          float k = floor(b * 7.0);
          float ramp = k < 0.5 ? ${Ramp.GLOW_WHITE}.0 : ${Ramp.RED}.0 + (k - 1.0);
          // each hue is two palette steps, the lit one on its outer side: a body, not a flat stripe
          float lit = fract(b * 7.0) < 0.42 ? 0.08 : -0.03;
          sbWrite(ramp, k < 0.5 ? 0.97 : 0.7 + lit, sbFog(vWorld), 0.75 * (1.0 - uT), vec3(0.0, 0.0, 1.0), 0.87, 0.5);
        }
      `,
    });
    this.hoop = new THREE.Mesh(hg, hoopMat);
    this.hoop.frustumCulled = false;
    this.hoop.visible = false;
    this.object.add(this.hoop);
  }

  /** Turbo events: the shift, the engagement, the sonic boom, LOCKED. */
  event(ev: string, bus: THREE.Object3D, f: Flight, rig: CameraRig, flash: (pos: THREE.Vector3, strength: number) => void) {
    const T = config.turbo;
    if (ev === 'up') {
      this.lens.punch(T.fovKick * 0.4);
      rig.kick(1.1);
      this.backfire(bus, f, 7);
    } else if (ev === 'engage') {
      this.lens.punch(T.fovKick * 0.5);
      rig.kick(1.6);
      this.backfire(bus, f, 10);
    } else if (ev === 'boom') {
      this.lens.punch(T.fovKick);
      rig.kick(T.boomKick);
      this.coneT = 0;
      this.cone.visible = true;
      this.hoopT = 0;
      this.hoop.visible = true;
      this.hoopU.uSeed.value = Math.floor(Math.random() * 64);
      this.vaporRing(bus, f);
      bus.localToWorld(this.tmp.copy(this.noseLocal));
      flash(this.tmp, T.boomFlash);
    } else if (ev === 'down') {
      rig.kick(0.8);
      this.backfire(bus, f, 4);
    } else if (ev === 'locked') {
      this.backfire(bus, f, 2);
    }
  }

  /**
   * Once per frame after the bus's matrix is final (main.ts: right after
   * bus.root.updateMatrixWorld). realDt keeps the lens kick ringing through hit-stop.
   */
  update(dt: number, realDt: number, drive: TurboDrive, f: Flight, bus: THREE.Object3D, camera: THREE.PerspectiveCamera, rig: CameraRig, pixelK: number) {
    const X = turboFxTune;
    this.time += dt;
    this.lens.update(realDt, drive, rig, f);
    const on = clamp(Math.max(drive.speedK, drive.boosting && drive.gear > 0 ? 0.5 : 0), 0, 1);

    // ---- the strain: rattle + backfire puffs while lifting, spooling, boosting, and a buzz at speed
    const shake = clamp(drive.strain + 0.35 * on, 0, 1.2);
    this.rattleT -= dt;
    if (dt > 0 && this.rattleT <= 0) {
      this.rattleT = 1 / 30;
      const a = config.turbo.rattle * shake;
      this.rattle.set((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a);
      this.rattleRoll = (Math.random() - 0.5) * 0.08 * shake;
    }
    if (shake < 0.02) {
      this.rattle.set(0, 0, 0);
      this.rattleRoll = 0;
    }
    this.puffT -= dt;
    if (dt > 0 && drive.strain > 0.3 && this.puffT <= 0) {
      this.puffT = 0.05 + 0.1 * (1 - drive.strain);
      this.backfire(bus, f, 1);
    }

    // ---- contrail
    bus.localToWorld(this.tmp.copy(this.tailLocal));
    this.trailU.uOn.value = on;
    this.trailU.uBillow.value = X.trailBillow;
    this.trailU.uWander.value = X.trailWander;
    if (dt > 0) this.trailStep(this.tmp, on);
    this.trailWrite();

    // ---- speed lines: around the view between the camera and the bus, a little ahead
    const vis = clamp((f.speed - config.flight.surgeSpeed * 0.9) / 140, 0, 1) * clamp(on + 0.25, 0, 1);
    this.lines.visible = vis > 0.01;
    if (this.lines.visible) {
      const U = this.lineU;
      U.uOn.value = vis;
      U.uBox.value = X.lineBox;
      U.uLen.value = X.lineBlur;
      U.uPix.value = pixelK * X.linePx;
      this.vel.set(f.fx * f.speed, f.vy, f.fz * f.speed);
      U.uVel.value.copy(this.vel);
      U.uCenter.value.copy(camera.position).lerp(bus.position, 0.55).addScaledVector(this.vel, 0.08);
    }

    // ---- warm-up: every program really draws now, not just compiles (drivers build a pipeline at its first draw call,
    // and that was a 50-80 ms stall the moment the trail first appeared). Nothing shows: the trail's first triangles
    // are degenerate, the lines are off-screen, the cone and the hoop parked and dissolved
    if (this.warm > 0) {
      this.warm--;
      const w = this.warm > 0;
      if (!this.trail.visible) {
        this.trail.visible = w;
        this.trailGeo.setDrawRange(0, w ? 6 : 0);
        this.trailBuf.needsUpdate = w;
      }
      if (!this.lines.visible) {
        this.lines.visible = w;
        this.lineU.uOn.value = 0;
      }
      if (this.coneT < 0) {
        this.cone.visible = w;
        this.coneU.uT.value = 1;
        this.cone.position.set(0, -1e5, 0); // (parked far below the city: not a pixel shows)
      }
      if (this.hoopT < 0) {
        this.hoop.visible = w;
        this.hoopU.uT.value = 1;
        this.hoop.position.set(0, -1e5, 0);
      }
    }
    // ---- the boom's vapor cone rides the bus
    if (this.coneT >= 0) {
      this.coneT += dt / Math.max(0.05, X.coneTime);
      if (this.coneT >= 1) {
        this.coneT = -1;
        this.cone.visible = false;
      } else {
        this.coneU.uT.value = this.coneT;
        this.coneU.uR.value = X.coneRadius;
        this.coneU.uL.value = X.coneLength;
        bus.localToWorld(this.tmp2.copy(this.noseLocal));
        this.cone.position.copy(this.tmp2);
        this.cone.quaternion.copy(bus.quaternion);
      }
    }
    // ---- the rainbow hoop: it opens around the bus and falls back along its path, past the camera
    if (this.hoopT >= 0) {
      this.hoopT += dt / Math.max(0.05, X.hoopTime);
      if (this.hoopT >= 1) {
        this.hoopT = -1;
        this.hoop.visible = false;
      } else {
        const t = this.hoopT;
        this.hoopU.uT.value = t;
        const open = 1 - (1 - t) * (1 - t) * (1 - t);
        this.hoop.scale.setScalar(X.hoopR0 + (X.hoopR1 - X.hoopR0) * open);
        bus.localToWorld(this.tmp2.copy(this.noseLocal));
        this.hoop.position.set(this.tmp2.x - f.fx * X.hoopBack * t * t, this.tmp2.y, this.tmp2.z - f.fz * X.hoopBack * t * t);
        this.hoop.quaternion.copy(bus.quaternion);
      }
    }
  }

  /** Bus rattle: call after the bus's pose is set (adds a jitter of a game pixel or two). */
  applyRattle(root: THREE.Object3D) {
    if (this.rattle.x === 0 && this.rattle.y === 0 && this.rattle.z === 0) return;
    root.position.add(this.rattle);
    if (this.rattleRoll !== 0) root.rotateZ(this.rattleRoll);
  }

  // ------------------------------------------------------------------ internals

  private trailStep(tail: THREE.Vector3, on: number) {
    const X = turboFxTune;
    const N = TRAIL_N;
    // drop samples older than the trail's life
    while (this.tCount > 0) {
      const oldest = (this.tHead - this.tCount + 1 + N) % N;
      if (this.time - this.tBorn[oldest] > X.trailLife) this.tCount--;
      else break;
    }
    if (on <= 0.02) return;
    const h = this.tHead;
    if (h >= 0 && this.tCount > 1) {
      const p = (h - 1 + N) % N;
      const dx = this.tx[h] - this.tx[p], dy = this.ty[h] - this.ty[p], dz = this.tz[h] - this.tz[p];
      if (dx * dx + dy * dy + dz * dz < X.trailStep * X.trailStep) {
        // the head rides the bus's tail until it is a sample's spacing from the one before
        const q = (this.tHead - 1 + N) % N;
        this.tx[h] = tail.x;
        this.ty[h] = tail.y;
        this.tz[h] = tail.z;
        this.tOn[h] = on;
        this.tDist[h] = this.tDist[q] + Math.hypot(tail.x - this.tx[q], tail.y - this.ty[q], tail.z - this.tz[q]);
        return;
      }
    }
    const n = (h + 1) % N;
    // (a new trail starts its vapor at 0: nothing else ever needs the distance to stay small)
    this.tDist[n] = this.tCount > 0 ? this.tDist[h] + Math.hypot(tail.x - this.tx[h], tail.y - this.ty[h], tail.z - this.tz[h]) : 0;
    this.tHead = n;
    this.tx[n] = tail.x;
    this.ty[n] = tail.y;
    this.tz[n] = tail.z;
    this.tBorn[n] = this.time;
    this.tOn[n] = on;
    this.tCount = Math.min(N, this.tCount + 1);
  }

  private trailWrite() {
    const X = turboFxTune;
    const N = TRAIL_N;
    const c = this.tCount;
    this.trail.visible = c >= 2;
    if (c < 2) return;
    const d = this.trailData;
    for (let i = 0; i < c; i++) {
      const j = (this.tHead - i + N) % N;
      // tangent toward the newer neighbor (the head: from the one behind it)
      const jn = i === 0 ? (this.tHead - 1 + N) % N : (j + 1) % N;
      let dx = i === 0 ? this.tx[j] - this.tx[jn] : this.tx[jn] - this.tx[j];
      let dy = i === 0 ? this.ty[j] - this.ty[jn] : this.ty[jn] - this.ty[j];
      let dz = i === 0 ? this.tz[j] - this.tz[jn] : this.tz[jn] - this.tz[j];
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      const age = clamp((this.time - this.tBorn[j]) / X.trailLife, 0, 1);
      // a trail laid down at low intensity is thinner (and dissolves sooner)
      const ageOn = 1 - (1 - age) * clamp(this.tOn[j] * 1.2, 0, 1);
      const w = (X.trailW0 + (X.trailW1 - X.trailW0) * Math.sqrt(age)) * (0.5 + 0.5 * this.tOn[j]);
      for (let s = 0; s < 2; s++) {
        const o = (i * 2 + s) * TRAIL_STRIDE;
        d[o] = this.tx[j];
        d[o + 1] = this.ty[j];
        d[o + 2] = this.tz[j];
        d[o + 3] = dx;
        d[o + 4] = dy;
        d[o + 5] = dz;
        d[o + 6] = s === 0 ? -1 : 1;
        d[o + 7] = ageOn;
        d[o + 8] = w;
        d[o + 9] = this.tDist[j];
      }
    }
    this.trailBuf.addUpdateRange(0, c * 2 * TRAIL_STRIDE);
    this.trailBuf.needsUpdate = true;
    this.trailGeo.setDrawRange(0, (c - 1) * 6);
  }

  private backfire(bus: THREE.Object3D, f: Flight, n: number) {
    bus.localToWorld(this.tmp.copy(this.exhaustLocal));
    for (let i = 0; i < n; i++) {
      this.vel.set(-f.fx * (6 + Math.random() * 6) + (Math.random() - 0.5) * 4, 1 + Math.random() * 2, -f.fz * (6 + Math.random() * 6) + (Math.random() - 0.5) * 4);
      this.particles.puff(this.tmp, this.vel, i % 3 === 0 ? Ramp.ORANGE : i % 3 === 1 ? Ramp.RED : Ramp.FOG);
    }
  }

  /** The boom: a ring of vapor and rainbow puffs blasted out around the bus, perpendicular to its path. */
  private vaporRing(bus: THREE.Object3D, f: Flight) {
    bus.localToWorld(this.tmp.copy(this.noseLocal));
    const fx = f.fx, fz = f.fz;
    // ring plane: the bus's right (-fz, fx) and up
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const cr = Math.cos(a), sr = Math.sin(a);
      const out = 16 + Math.random() * 8;
      this.vel.set(-fz * cr * out - fx * 10, sr * out, fx * cr * out - fz * 10);
      this.tmp2.copy(this.tmp).addScaledVector(this.vel, 0.08);
      this.particles.puff(this.tmp2, this.vel, i % 2 === 0 ? Ramp.FOG : HUE_RAMPS[(i >> 1) % 6]);
    }
    this.particles.sparkles(this.tmp, 7, 5, [0, 2, 4], 26);
  }
}
