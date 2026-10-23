import * as THREE from 'three';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { HUE_COUNT, HUE_RAMPS, Ramp } from '../render/palette';
import { registerTunables } from '../ui/tunables';

// The super splat's own pixel effects (src/game/SuperSplat.ts drives them):
//  - energy motes: rainbow sparks pulled in from the city in a spiral, landing
//    exactly in the bus's mouth however it moves (each mote is computed
//    relative to the LIVE mouth, uMouth, so the CPU never touches it again);
//  - arcs: crackling lightning over the bus body, a static pool of points
//    whose jagged paths are re-rolled from a hash ~20 times a second (no CPU
//    work per frame; uArc.x is the share of arcs lit);
//  - sparks: white-hot bits thrown off the body (ballistic, drag);
//  - halo: rainbow motes orbiting the bus once the charge runs high.
//
// One THREE.Points draw call, drawn only while something is alive (or arcs
// are lit). Like Particles: every sprite is whole game pixels (blobs smeared
// into capsules along their screen motion), sbWrite() with flags 0.5 (no ink
// outline), never in SHADOW_LAYER. Positions go through modelMatrix, so the
// game can shift the object by the vista's snap compensation like the bus.

export const superFxTune = {
  /** Mote size (m), glow, ease of the pull (higher = lingers far out, then rushes in). */
  moteSize: 1.35,
  moteGlow: 1,
  moteEase: 1.9,
  /** Arcs: re-rolls per second, how far they reach off the body (m), jaggedness. */
  arcHz: 21,
  arcReach: 6,
  arcJag: 0.34,
  arcSize: 0.6,
  /** Sparks: size (m), gravity (m/s²). */
  sparkSize: 0.42,
  sparkGravity: 22,
  /** Motion smear (s of screen motion, cap in px). */
  stretch: 0.035,
  maxStretch: 10,
  fog: 0.35,
};

registerTunables('SuperFx', superFxTune, {
  moteSize: [0.2, 4, 0.05],
  moteGlow: [0, 1, 0.01],
  moteEase: [0.5, 4, 0.05],
  arcHz: [1, 60, 1],
  arcReach: [0.5, 12, 0.1],
  arcJag: [0, 1, 0.01],
  arcSize: [0.1, 1.5, 0.01],
  sparkSize: [0.1, 2, 0.01],
  sparkGravity: [0, 60, 0.5],
  stretch: [0, 0.12, 0.005],
  maxStretch: [0, 24, 1],
  fog: [0, 1, 0.01],
});

// slot layout (floats): aA t0, life, kind, seed | aB, aC kind params | aD ramp, size, flags, -
//   mote:  aB r0, a0, turns, h0        aC ease, -, -, -
//   arc:   aB arc id, s along, -, -    (static pool, t0 0, life 1e9)
//   spark: aB p0.xyz, -                aC v0.xyz, drag
//   halo:  aB r0, a0, rad/s, h0        aC bob, -, -, -
const STRIDE = 16;
const K_MOTE = 0;
const K_ARC = 1;
const K_SPARK = 2;
const K_HALO = 3;
const ARCS = 12;
const ARC_PTS = 30;
const STATIC = ARCS * ARC_PTS;
const REBASE_AT = 2048;
// look flags
const F_BRIGHT = 1;
const F_GLINT = 2;

const VERT = /* glsl */ `
${GLSL_COMMON}
uniform float uNow;
uniform float uViewH;
uniform vec3 uMouth;
uniform mat4 uBusM;
uniform vec4 uBusDim;  // half width, height, half length, bottom y (bus root space, m)
uniform vec4 uArc;     // lit share, re-rolls/s, reach, jag
uniform vec4 uLook;    // stretch s, max stretch px, mote glow, fog mul
uniform vec4 uMote;    // -, spark gravity, arc size (m), -
in vec4 aA;
in vec4 aB;
in vec4 aC;
in vec4 aD;
flat out vec4 vA; // ramp, step, glow, fog
flat out vec4 vB; // N px, smear dir xy, smear half length
flat out float vR;

float h1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }

vec3 motePos(float u) {
  float q = pow(clamp(u, 0.0, 1.0), aC.x);
  float r = aB.x * (1.0 - q);
  float a = aB.y + aB.z * q;
  float k = 1.0 - q;
  return uMouth + vec3(cos(a) * r, aB.w * k * k, sin(a) * r);
}

vec3 arcPos(float id, float s, float ep) {
  float sd = id * 17.13 + ep * 3.71;
  float side = h1(sd) < 0.5 ? -1.0 : 1.0;
  vec3 A = vec3(side * uBusDim.x * (0.7 + 0.35 * h1(sd + 1.0)), uBusDim.w + uBusDim.y * (0.15 + 0.85 * h1(sd + 2.0)), uBusDim.z * (h1(sd + 3.0) * 2.0 - 1.0));
  vec3 B;
  if (h1(sd + 4.0) < 0.35) {
    // across the body: crawling over the roof to the other side
    B = vec3(-side * uBusDim.x * 0.9, uBusDim.w + uBusDim.y * (0.5 + 0.6 * h1(sd + 5.0)), A.z + (h1(sd + 6.0) - 0.5) * uBusDim.z * 0.8);
  } else {
    // off into the air
    vec3 d = normalize(vec3(side * (0.5 + h1(sd + 5.0)), h1(sd + 6.0) * 1.4 - 0.25, (h1(sd + 7.0) - 0.5) * 1.6));
    B = A + d * uArc.z * (0.35 + 0.65 * h1(sd + 8.0));
  }
  vec3 D = B - A;
  float L = length(D);
  vec3 t = D / max(L, 1e-3);
  vec3 p1 = normalize(cross(t, abs(t.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 p2 = cross(t, p1);
  // a zigzag through 7 hashed nodes, pinned at both ends
  float x = s * 7.0;
  float k0 = floor(x);
  float f = x - k0;
  vec2 n0 = vec2(h1(sd + k0 * 9.1 + 11.0), h1(sd + k0 * 5.3 + 23.0)) - 0.5;
  vec2 n1 = vec2(h1(sd + (k0 + 1.0) * 9.1 + 11.0), h1(sd + (k0 + 1.0) * 5.3 + 23.0)) - 0.5;
  if (k0 < 0.5) n0 = vec2(0.0);
  if (k0 + 1.0 > 6.5) n1 = vec2(0.0);
  vec2 n = mix(n0, n1, f) * uArc.w * L;
  return A + D * s + p1 * n.x + p2 * n.y;
}

void cull() {
  gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
  gl_PointSize = 1.0;
  vA = vec4(0.0);
  vB = vec4(1.0, 1.0, 0.0, 0.0);
  vR = 0.5;
}

void main() {
  float t0 = aA.x;
  float life = aA.y;
  float kind = aA.z;
  float seed = aA.w;
  float age = uNow - t0;
  if (age < 0.0 || age >= life) { cull(); return; }
  float x = age / life;
  float ramp = aD.x;
  float size = aD.y;
  int flags = int(aD.z + 0.5);
  float st = 5.0;
  float glow = uLook.z;
  vec3 p;
  vec3 pPrev;
  float dtv = 0.02;
  if (kind < 0.5) {
    // ---- mote: spirals in from the city, lands in the mouth
    p = motePos(x);
    pPrev = motePos(x - dtv / life);
    size *= 0.45 + 0.55 * (1.0 - pow(x, aC.x));
    if (x > 0.97) { cull(); return; }
  } else if (kind < 1.5) {
    // ---- arc point: lit or not this epoch, then where its jagged path puts it
    float id = aB.x;
    float ep = floor(uNow * uArc.y + id * 0.618);
    if (h1(id * 7.13 + ep * 1.31 + 0.5) >= uArc.x) { cull(); return; }
    vec3 lp = arcPos(id, aB.y, ep);
    p = (uBusM * vec4(lp, 1.0)).xyz;
    pPrev = p;
    size = uMote.z;
    float hc = h1(id * 3.3 + ep * 0.77);
    ramp = hc < 0.55 ? ${Ramp.GLOW_WHITE}.0 : hc < 0.8 ? ${Ramp.BLUE}.0 : ${Ramp.VIOLET}.0;
    st = hc < 0.55 ? 7.0 : 6.0;
    glow = 1.0;
    // (the tip flickers out first)
    if (aB.y > 0.55 && h1(seed * 91.0 + floor(uNow * 40.0)) < (aB.y - 0.55) * 1.4) { cull(); return; }
  } else if (kind < 2.5) {
    // ---- spark: ballistic with drag, white-hot, shrinking
    float k = max(aC.w, 0.01);
    float e = (1.0 - exp(-k * age)) / k;
    p = aB.xyz + aC.xyz * e - vec3(0.0, 0.5 * uMote.y * age * age, 0.0);
    float a2 = max(0.0, age - dtv);
    float e2 = (1.0 - exp(-k * a2)) / k;
    pPrev = aB.xyz + aC.xyz * e2 - vec3(0.0, 0.5 * uMote.y * a2 * a2, 0.0);
    size *= 1.0 - x * 0.7;
    glow = 1.0;
  } else {
    // ---- halo: orbiting the bus
    vec3 c = (uBusM * vec4(0.0, uBusDim.w + uBusDim.y * 0.5, 0.0, 1.0)).xyz;
    float a = aB.y + aB.z * age;
    p = c + vec3(cos(a) * aB.x, aB.w + aC.x * sin(age * 3.1 + seed * 6.28), sin(a) * aB.x);
    float a2 = a - aB.z * dtv;
    pPrev = c + vec3(cos(a2) * aB.x, aB.w + aC.x * sin((age - dtv) * 3.1 + seed * 6.28), sin(a2) * aB.x);
    size *= sin(3.14159 * x);
  }
  if ((flags & ${F_BRIGHT}) != 0) st = 6.0;
  if ((flags & ${F_GLINT}) != 0) { ramp = ${Ramp.GLOW_WHITE}.0; st = 7.0; glow = 1.0; }
  if (size <= 0.0) { cull(); return; }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec4 wq = modelMatrix * vec4(pPrev, 1.0);
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  float pxPerM = projectionMatrix[1][1] * 0.5 * uViewH / max(gl_Position.w, 1e-3);
  float D = max(size * pxPerM, 1.0);
  // motion smear along the screen velocity (sprite space, y down)
  vec3 vv = (mat3(viewMatrix) * (wp.xyz - wq.xyz)) / dtv;
  vec2 spx = vec2(vv.x, -vv.y) * pxPerM;
  float sl = length(spx);
  vec2 sdir = sl > 1e-3 ? spx / sl : vec2(1.0, 0.0);
  float ha = D > 1.5 ? floor(min(sl * uLook.x, uLook.y) + 0.5) * 0.5 : 0.0;
  float N = clamp(floor(D + 2.0 * ha + 0.5), 1.0, 32.0);
  gl_PointSize = N;
  vA = vec4(ramp, st, glow, sbFog(wp.xyz) * uLook.w);
  vB = vec4(N, sdir, ha);
  vR = D * 0.5;
}
`;

const FRAG = /* glsl */ `
${GLSL_COMMON}
flat in vec4 vA;
flat in vec4 vB;
flat in float vR;
${GLSL_OUT}
void main() {
  float N = vB.x;
  vec2 c = floor(gl_PointCoord * N) - (N - 1.0) * 0.5;
  vec2 d = c - vB.yz * clamp(dot(c, vB.yz), -vB.w, vB.w);
  if (N > 2.5 && dot(d, d) > vR * vR - 0.3) discard;
  float st = vA.y;
  // a white-hot heart on the bigger motes
  if (vR > 1.6 && dot(d, d) < 0.6) st = 7.0;
  sbWrite(vA.x, (st + 0.15) / 7.0, vA.w, vA.z, vec3(0.0, 0.0, 1.0), 0.5, 0.5);
}
`;

const rnd = Math.random;

export class SuperFx {
  readonly object: THREE.Points;
  /** 0..1: share of the arcs lit (set by the game every frame) */
  arcs = 0;
  private readonly cap: number;
  private readonly data: Float32Array;
  private readonly buf: THREE.InterleavedBuffer;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly s = new Float32Array(STRIDE);
  private head = STATIC;
  private time = 0;
  private lastDeath = -1;
  /** dirty run of ring slots (ring order, wrapping from cap back to STATIC) not yet uploaded */
  private dirtyStart = STATIC;
  private dirtyCount = 0;
  private uploadQueued = false;
  private readonly rangeA = { start: 0, count: 0 };
  private readonly rangeB = { start: 0, count: 0 };
  private viewH = 520;
  private readonly uNow = { value: 0 };
  private readonly uViewH = { value: 520 };
  private readonly uMouth = { value: new THREE.Vector3() };
  private readonly uBusM = { value: new THREE.Matrix4() };
  private readonly uBusDim = { value: new THREE.Vector4(2, 5, 9, -2.5) };
  private readonly uArc = { value: new THREE.Vector4() };
  private readonly uLook = { value: new THREE.Vector4() };
  private readonly uMote = { value: new THREE.Vector4() };
  private readonly tmp = new THREE.Vector3();
  private hue = 0;

  constructor(maxParticles = 2400) {
    const cap = Math.max(STATIC + 64, Math.floor(maxParticles));
    this.cap = cap;
    this.data = new Float32Array(cap * STRIDE);
    for (let i = 0; i < cap; i++) this.data[i * STRIDE] = 1e9; // never born
    // the static arc pool: always "alive", lit by uArc
    for (let a = 0; a < ARCS; a++)
      for (let k = 0; k < ARC_PTS; k++) {
        const o = (a * ARC_PTS + k) * STRIDE;
        this.data[o] = 0;
        this.data[o + 1] = 1e9;
        this.data[o + 2] = K_ARC;
        this.data[o + 3] = Math.random();
        this.data[o + 4] = a;
        this.data[o + 5] = k / (ARC_PTS - 1);
        this.data[o + 12] = Ramp.GLOW_WHITE;
        this.data[o + 13] = superFxTune.arcSize;
      }
    this.buf = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    geo.setAttribute('aA', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    geo.setAttribute('aB', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    geo.setAttribute('aC', new THREE.InterleavedBufferAttribute(this.buf, 4, 8));
    geo.setAttribute('aD', new THREE.InterleavedBufferAttribute(this.buf, 4, 12));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    geo.setDrawRange(0, cap);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...globals,
        uNow: this.uNow,
        uViewH: this.uViewH,
        uMouth: this.uMouth,
        uBusM: this.uBusM,
        uBusDim: this.uBusDim,
        uArc: this.uArc,
        uLook: this.uLook,
        uMote: this.uMote,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: true,
      depthWrite: true,
      transparent: false,
    });
    const points = new THREE.Points(geo, this.mat);
    points.name = 'SuperFx';
    points.frustumCulled = false;
    points.visible = false;
    points.onBeforeRender = (renderer) => {
      const rt = renderer.getRenderTarget();
      this.uViewH.value = rt ? rt.height : this.viewH;
    };
    this.object = points;
  }

  setViewportHeight(px: number): void {
    this.viewH = Math.max(1, px);
  }

  /** Bus body extents in its root's local space (m): half width, height, half length, the bottom's y. */
  setBusSize(halfWidth: number, height: number, halfLength: number, bottom: number): void {
    this.uBusDim.value.set(halfWidth, height, halfLength, bottom);
  }

  /**
   * `count` energy motes pulled in from up to `reach` m around the mouth, mostly from the city below,
   * each taking `life` s (+-30%) to spiral into it.
   */
  motes(count: number, reach: number, life: number): void {
    const s = this.s;
    const T = superFxTune;
    for (let i = 0; i < count; i++) {
      const L = life * (0.7 + 0.6 * rnd());
      const below = rnd() < 0.82;
      s[0] = this.time;
      s[1] = L;
      s[2] = K_MOTE;
      s[3] = rnd();
      s[4] = reach * (0.25 + 0.75 * Math.sqrt(rnd()));
      s[5] = rnd() * Math.PI * 2;
      s[6] = 1.6 + 2.2 * rnd(); // one way round: a vortex, not a swarm
      s[7] = below ? -(8 + 55 * rnd()) : 4 + 14 * rnd();
      s[8] = T.moteEase * (0.85 + 0.3 * rnd());
      s[9] = s[10] = s[11] = 0;
      this.hue = (this.hue + 1 + (rnd() < 0.3 ? 1 : 0)) % HUE_COUNT;
      const r = rnd();
      s[12] = HUE_RAMPS[this.hue];
      s[13] = T.moteSize * (0.75 + 0.5 * rnd());
      s[14] = r < 0.1 ? F_GLINT : r < 0.45 ? F_BRIGHT : 0;
      s[15] = 0;
      this.commit(this.time + L);
    }
  }

  /** `count` white-hot sparks thrown off random points of the bus body (bus matrix from the last update), inheriting `vel`. */
  sparks(count: number, vel: THREE.Vector3, speed = 9): void {
    const s = this.s;
    const T = superFxTune;
    const dim = this.uBusDim.value;
    const m = this.uBusM.value;
    for (let i = 0; i < count; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const p = this.tmp.set(side * dim.x * (0.6 + 0.4 * rnd()), dim.w + dim.y * (0.2 + 0.9 * rnd()), dim.z * (rnd() * 2 - 1)).applyMatrix4(m);
      const L = 0.25 + 0.4 * rnd();
      const a = rnd() * Math.PI * 2;
      const up = 0.3 + rnd();
      s[0] = this.time;
      s[1] = L;
      s[2] = K_SPARK;
      s[3] = rnd();
      s[4] = p.x;
      s[5] = p.y;
      s[6] = p.z;
      s[7] = 0;
      s[8] = vel.x + Math.cos(a) * speed;
      s[9] = vel.y * 0.5 + up * speed;
      s[10] = vel.z + Math.sin(a) * speed;
      s[11] = 2.5;
      const r = rnd();
      s[12] = r < 0.55 ? Ramp.GLOW_WHITE : r < 0.8 ? Ramp.YELLOW : HUE_RAMPS[Math.floor(rnd() * HUE_COUNT)];
      s[13] = T.sparkSize * (0.7 + 0.6 * rnd());
      s[14] = F_BRIGHT;
      s[15] = 0;
      this.commit(this.time + L);
    }
  }

  /** `count` rainbow motes orbiting the bus for about `life` s. */
  halo(count: number, life: number, radius = 6): void {
    const s = this.s;
    const T = superFxTune;
    for (let i = 0; i < count; i++) {
      const L = life * (0.7 + 0.6 * rnd());
      s[0] = this.time;
      s[1] = L;
      s[2] = K_HALO;
      s[3] = rnd();
      s[4] = radius * (0.75 + 0.5 * rnd());
      s[5] = rnd() * Math.PI * 2;
      s[6] = (2.4 + 2 * rnd()) * (rnd() < 0.85 ? 1 : -1);
      s[7] = (rnd() - 0.4) * 3;
      s[8] = 0.6 + rnd();
      s[9] = s[10] = s[11] = 0;
      this.hue = (this.hue + 1) % HUE_COUNT;
      s[12] = HUE_RAMPS[this.hue];
      s[13] = T.moteSize * 0.8 * (0.7 + 0.6 * rnd());
      s[14] = rnd() < 0.2 ? F_GLINT : F_BRIGHT;
      s[15] = 0;
      this.commit(this.time + L);
    }
  }

  /**
   * Once per frame (dt may be 0: the hit-stop freezes it): the live mouth and the bus's world matrix
   * (this frame's, before any snap compensation; shift `object.position` by that like the bus).
   */
  update(dt: number, mouth: THREE.Vector3, busMatrix: THREE.Matrix4): void {
    const T = superFxTune;
    this.syncUpload();
    this.time += Math.max(0, dt);
    if (this.time > REBASE_AT) this.rebase();
    this.uNow.value = this.time;
    this.uMouth.value.copy(mouth);
    this.uBusM.value.copy(busMatrix);
    this.uArc.value.set(Math.max(0, Math.min(1, this.arcs)), T.arcHz, T.arcReach, T.arcJag);
    this.uLook.value.set(T.stretch, T.maxStretch, T.moteGlow, T.fog);
    this.uMote.value.set(0, T.sparkGravity, T.arcSize, 0);
    this.flush();
    this.object.visible = this.arcs > 0.001 || this.time < this.lastDeath;
  }

  private commit(death: number) {
    this.syncUpload();
    const slot = this.head;
    this.data.set(this.s, slot * STRIDE);
    if (death > this.lastDeath) this.lastDeath = death;
    this.head = slot + 1 >= this.cap ? STATIC : slot + 1;
    if (this.dirtyCount === 0) this.dirtyStart = slot;
    if (this.dirtyCount < this.cap - STATIC) this.dirtyCount++;
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
    if (this.dirtyCount === 0) return;
    const ranges = this.buf.updateRanges;
    ranges.length = 0;
    const end = this.dirtyStart + this.dirtyCount;
    this.rangeA.start = this.dirtyStart * STRIDE;
    if (end <= this.cap) {
      this.rangeA.count = this.dirtyCount * STRIDE;
      ranges.push(this.rangeA);
    } else {
      this.rangeA.count = (this.cap - this.dirtyStart) * STRIDE;
      this.rangeB.start = STATIC * STRIDE;
      this.rangeB.count = (end - this.cap) * STRIDE;
      ranges.push(this.rangeA, this.rangeB);
    }
    this.buf.needsUpdate = true;
    this.uploadQueued = true;
  }

  private rebase() {
    const shift = Math.floor(this.time);
    this.time -= shift;
    this.lastDeath -= shift;
    const d = this.data;
    for (let i = STATIC; i < this.cap; i++) d[i * STRIDE] -= shift;
    this.uploadQueued = false;
    this.dirtyStart = STATIC;
    this.dirtyCount = this.cap - STATIC;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
