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
// via sbWrite, no free RGB), dissolves through ordered dither (no alpha), is
// one draw call, and uploads at most one buffer per frame:
//  - TurboLens: the camera pulls back and widens with the turbo speed (settling
//    exactly, so a held gear's lens is perfectly still) and kicks its fov at the
//    shift and the sonic boom. Pure (no GL): the offline harness runs it.
//  - the rainbow contrail: a camera-facing ribbon of six hue bands from the
//    bus's tail, spreading and dissolving with age (one dynamic buffer).
//  - speed lines: world-anchored streaks wrapped in a box around the view,
//    stretched along the velocity (uniforms only: no uploads).
//  - the sonic boom: a white-hot vapor cone with a rainbow rim bursting off the
//    bus, a ring of vapor and rainbow puffs (Particles), a palette flash and a
//    camera jolt.
//  - the strain: the bus rattles (a translation jitter of a game pixel or two)
//    and backfires while it claws up to a gear's height and spools.

export const turboFxTune = {
  /** contrail: life (s), width at the bus and at the end of its life (m), sample spacing (m) */
  trailLife: 1.1,
  trailW0: 3.2,
  trailW1: 15,
  trailStep: 2,
  /** speed lines: box around the view (m), motion-blur length (s of travel), width (game px) */
  lineBox: 190,
  lineBlur: 0.05,
  linePx: 1.2,
  /** vapor cone: duration (s), final radius and length (m) */
  coneTime: 0.42,
  coneRadius: 13,
  coneLength: 26,
  /** fov kick spring (Hz) */
  kickHz: 2.2,
};

const TRAIL_N = 96;
const LINES = 90;

const GLSL_BAYER = /* glsl */ `
// 4x4 ordered (Bayer) threshold, 0..1
float tbBayer4(ivec2 p) {
  const float M[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (M[(p.y & 3) * 4 + (p.x & 3)] + 0.5) / 16.0;
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
  private tHead = -1;
  private tCount = 0;
  private readonly trail: THREE.Mesh;
  private readonly trailU = { uOn: { value: 0 } };

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

  private time = 0;
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

    // ---- contrail: interleaved [x y z | dir x y z | side, age, width] per vertex, two vertices per sample
    this.trailData = new Float32Array(TRAIL_N * 2 * 9);
    this.trailBuf = new THREE.InterleavedBuffer(this.trailData, 9);
    this.trailBuf.setUsage(THREE.DynamicDrawUsage);
    const g = this.trailGeo;
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(this.trailBuf, 3, 0));
    g.setAttribute('aDir', new THREE.InterleavedBufferAttribute(this.trailBuf, 3, 3));
    g.setAttribute('aSide', new THREE.InterleavedBufferAttribute(this.trailBuf, 1, 6));
    g.setAttribute('aAge', new THREE.InterleavedBufferAttribute(this.trailBuf, 1, 7));
    g.setAttribute('aW', new THREE.InterleavedBufferAttribute(this.trailBuf, 1, 8));
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
        out float vSide;
        out float vAge;
        out vec3 vWorld;
        void main() {
          vec4 wc = modelMatrix * vec4(position, 1.0);
          vec3 toCam = normalize(cameraPosition - wc.xyz);
          vec3 sd = cross(aDir, toCam);
          float sl = length(sd);
          sd = sl > 1e-4 ? sd / sl : vec3(0.0, 1.0, 0.0);
          vec3 p = wc.xyz + sd * aSide * aW * 0.5;
          vSide = aSide;
          vAge = aAge;
          vWorld = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        ${GLSL_OUT}
        ${GLSL_BAYER}
        uniform float uOn;
        in float vSide;
        in float vAge;
        in vec3 vWorld;
        void main() {
          float u = clamp(vSide * 0.5 + 0.5, 0.0, 0.9999);
          float band = floor(u * 6.0);
          // dissolve with age (ordered dither, never alpha); the outer bands go first
          float edge = abs(vSide);
          float keep = (1.0 - vAge) * 1.25 - edge * edge * 0.35;
          if (tbBayer4(ivec2(gl_FragCoord.xy)) > keep) discard;
          float fresh = 1.0 - vAge;
          float light = 0.5 + 0.38 * fresh + 0.08 * (1.0 - edge);
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
        void main() {
          // bright head, a tail that dissolves
          float keep = vFade * (1.0 - 0.75 * vAlong);
          if (tbBayer4(ivec2(gl_FragCoord.xy)) > keep) discard;
          sbWrite(${Ramp.GLOW_WHITE}.0, 0.82 + 0.18 * (1.0 - vAlong), sbFog(vWorld), 0.2, vec3(0.0, 0.0, 1.0), 0.73, 0.5);
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
          // white-hot shock that burns away from the nose, a rainbow rim at its wide end
          float keep = (1.0 - uT) * (1.3 - 0.6 * vAlong) + 0.15 * sin(vAround * 7.0 + uT * 20.0);
          if (tbBayer4(ivec2(gl_FragCoord.xy)) > keep) discard;
          float rim = step(0.72, vAlong);
          float hue = floor(fract(vAround / 6.2831853 + 0.5) * 6.0);
          float ramp = rim > 0.5 ? ${Ramp.RED}.0 + hue : ${Ramp.GLOW_WHITE}.0;
          sbWrite(ramp, rim > 0.5 ? 0.75 : 0.95, sbFog(vWorld), 0.6 * (1.0 - uT), vec3(0.0, 0.0, 1.0), 0.83, 0.5);
        }
      `,
    });
    this.cone = new THREE.Mesh(cg, coneMat);
    this.cone.frustumCulled = false;
    this.cone.visible = false;
    this.object.add(this.cone);
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
        this.tx[h] = tail.x;
        this.ty[h] = tail.y;
        this.tz[h] = tail.z;
        this.tOn[h] = on;
        return;
      }
    }
    const n = (h + 1) % N;
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
        const o = (i * 2 + s) * 9;
        d[o] = this.tx[j];
        d[o + 1] = this.ty[j];
        d[o + 2] = this.tz[j];
        d[o + 3] = dx;
        d[o + 4] = dy;
        d[o + 5] = dz;
        d[o + 6] = s === 0 ? -1 : 1;
        d[o + 7] = ageOn;
        d[o + 8] = w;
      }
    }
    this.trailBuf.addUpdateRange(0, c * 2 * 9);
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
