import * as THREE from 'three';
import { CLIP_N } from './moonMaterial';

// Paint on the Moon's craters: a stack of four windows on the map, a layer each of one RGBA8 array, written by the GPU. A crater is a shape the stamp can say in a line (a squashed circle with a wobble), so what's
// kept is the list of what is painted, and this draws it, a quad a crater, whenever a window moves or something in it changes. That holds at any size: a bowl 20 m across on the finest window, one 100 km across on
// the coarsest, the same quad and the same contour, with no mask on any tile and no tile split out of a coarse region. Near and far ground read the same four layers (GLSL_MOON_PAINT, moonMaterial.ts).
//
// A window is 1024 texels a side:
//   r  two hues, 3 bits each, read raw: nothing here is filtered, or two hues that meet would run through the hues between
//   g  which of the two, a ramp across the boundary: filtered, so two hues meet on as smooth a contour as paint's edge (MoonPaint's trick)
//   b  lift, 4 bits: a step or two brighter than the ground's light gives (a crown, a ray). Glow, 4 bits: how white-hot, while a level lands
//   a  coverage, a ramp across the edge. The ground bilinears it by hand and thresholds it, so an edge is a smooth contour at a fraction of a texel, as GroundPaint's is
// A write takes the hue and keeps the most coverage (blendEquationAlpha MAX): a crater's soft edge must not bite a hole in the paint it lands on.
//
// Marks go on biggest first, so a small bowl in a big one stays its own colour. When one changes, every mark it touches goes on again in that order, under a scissor: a few instanced quads a frame while a level
// lands, and nothing at all after that.

export const CLIP_LEVELS = 4;
/** Metres a texel, by window: 1 km, 8 km, 64 km and past the edge of any map. */
export const CLIP_CELL = [1, 8, 64, 512];
/** How far a window's middle may lag where it's wanted, a share of its side, before it moves. */
const LAG = 0.15;
/** How far ahead of the view a window's middle stands, a share of its side. */
const LEAD = [0.2, 0.2, 0.1, 0];

/** One thing on the windows. */
export interface ClipMark {
  x: number;
  z: number;
  r: number;
  /** half the side of its quad (m): the rim, or the rays */
  reach: number;
  /** 0 a stamped crater, 1 a named one with its own rim, 2 a blast on open ground */
  kind: number;
  /** the stamp's three numbers (craters.ts) */
  a: number;
  b: number;
  c: number;
  level: number;
  hue: number;
  /** the game clock the level landed, and the seconds it takes to land */
  t0: number;
  T: number;
  seed: number;
  /** where the breath landed, from the centre */
  ix: number;
  iz: number;
  /** a named crater's rim: four harmonics (cos, sin) */
  wob: Float32Array | null;
  /** and the turn of its north off the map's */
  turn: number;
}

const FLOATS = 24;

const VS = /* glsl */ `
  precision highp float;
  in vec4 iA, iB, iC, iD, iE, iF;
  uniform vec4 uWin; // x0, z0, 1 / side (m), cell (m)
  out vec2 vP;
  flat out float vR;
  flat out vec4 vB, vC, vD, vE, vF;
  void main() {
    // (a mark never fades away with distance: at the far windows it stays a texel or two)
    vR = max(iA.z, uWin.w * 0.8);
    vP = position.xy * max(iA.w, vR * 1.3 + uWin.w * 2.0);
    vB = iB;
    vC = iC;
    vD = iD;
    vE = iE;
    vF = iF;
    gl_Position = vec4((iA.xy + vP - uWin.xy) * uWin.z * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const FS = /* glsl */ `
  precision highp float;
  uniform vec4 uWin;
  uniform float uNow;
  in vec2 vP;
  flat in float vR;
  flat in vec4 vB, vC, vD, vE, vF;
  layout(location = 0) out highp vec4 outPaint;
  const float PI = 3.14159265, TAU = 6.2831853;
  float h1(float x) { return fract(sin(x * 91.17) * 47453.5453); }
  // How far out this is as the stamp has it: the rim is at vR, wherever it wanders to. ang is the angle round it.
  float rimDist(vec2 p, out float ang) {
    float d = length(p);
    if (vB.w < 0.5) {
      float th = vB.x * PI, sq = 1.0 + 0.16 * (vB.y - 0.5), ct = cos(th), st = sin(th);
      float u = (p.x * ct + p.y * st) * sq, v = (p.y * ct - p.x * st) / sq;
      d = length(vec2(u, v));
      ang = atan(v, u);
      if (vR > 14.0) {
        float q2 = d * d / (vR * vR);
        float k2 = q2 > 1.5 ? clamp((2.6 - q2) / 1.1, 0.0, 1.0) : q2 < 0.25 ? clamp((q2 - 0.05) / 0.2, 0.0, 1.0) : 1.0;
        float c = vB.z;
        vec2 p3 = 0.05 * vec2(cos(c * 40.0), sin(c * 40.0)), p5 = 0.03 * vec2(cos(c * 91.0), sin(c * 91.0));
        d /= 1.0 + k2 * (dot(p3, vec2(cos(3.0 * ang), sin(3.0 * ang))) + dot(p5, vec2(cos(5.0 * ang), sin(5.0 * ang))));
      }
    } else {
      ang = atan(-p.y, p.x) + vD.w;
      float s = 1.0 + dot(vE.xy, vec2(cos(3.0 * ang), sin(3.0 * ang))) + dot(vE.zw, vec2(cos(5.0 * ang), sin(5.0 * ang)));
      s += dot(vF.xy, vec2(cos(8.0 * ang), sin(8.0 * ang))) + dot(vF.zw, vec2(cos(13.0 * ang), sin(13.0 * ang)));
      d *= s;
    }
    return d;
  }
  float ease(float k) { return k * (2.0 - k); }
  float n1(float x) {
    float i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(h1(i), h1(i + 1.0), f);
  }
  // The two hues of a texel at v in a run of sectors W m wide, a hue a sector from base, and which of them: the ramp across a boundary, and past it the side it's on, so the foot of the next ramp finds what it needs.
  void sectors(float v, float W, float m, float base, out float A, out float B, out float which) {
    float i = floor(v), f = v - i, dL = f * W, dR = (1.0 - f) * W, r = 1.2 * m;
    if (dL < 0.5 * r) {
      A = base + i - 1.0;
      B = base + i;
      which = 0.5 + dL / r;
    } else if (dR < 0.5 * r) {
      A = base + i;
      B = base + i + 1.0;
      which = 0.5 - dR / r;
    } else {
      A = B = base + i;
      which = f < 0.5 ? 1.0 : 0.0;
    }
  }
  // One set of rays thrown off the rim: N a turn at most, each its own length, thin, wandering a little and frayed, coming apart into drops toward its end.
  void rays(float rr, float ang, float m, float N, float lo, float hi, float wide, float s0, float k, float base, inout float cov, inout float A, inout float B, inout float lift) {
    float s = (ang / TAU + 0.5) * N, i = floor(s);
    float a = h1(i + s0), b = h1(i + s0 + 17.0), c = h1(i + s0 + 41.0);
    float len = vR * (lo + (hi - lo) * b * b);
    float x = (rr - vR) / (len - vR);
    if (x < -0.12 || x > 1.0) return;
    float off = ((s - i - 0.5 - 0.62 * (a - 0.5)) / N * TAU + (n1(rr / vR * 1.7 + a * 37.0) - 0.5) * 0.1 * clamp(x, 0.0, 1.0)) * rr;
    float t = max(x, 0.0);
    float w = min(vR * wide, 2.5 + 0.4 * wide * vR) * (0.55 + 0.9 * c) * (1.0 - t) * (1.0 - 0.5 * t) * (0.62 + 0.76 * n1(rr / vR * 6.0 + c * 53.0));
    float q = (max(w, m * 0.42) - abs(off)) / m + 0.5;
    float gap = 0.6 * sin(rr / vR * (2.9 + 5.0 * c) + a * 19.0) + 0.4 * sin(rr / vR * (8.3 + 4.0 * b) + b * 23.0);
    if (t > 0.3 && gap < (t - 0.3) * 2.3 - 0.8) return;
    q = min(q, (vR + (len - vR) * k * 1.04 - rr) / m + 0.5);
    if (q > cov && q > 0.02) {
      cov = q;
      A = B = base + i;
      lift = 0.45;
    }
  }
  void main() {
    vec2 p = vP;
    float R = vR, m = uWin.w * 1.3, lv = vC.x, base = vC.y, T = max(vC.w, 0.05), age = uNow - vC.z, seed = vD.z;
    float cov = 0.0, A = base, B = base, which = 1.0, glow = 0.0, lift = 0.0, ang = 0.0;
    float k = clamp(age / T, 0.0, 1.0);
    if (vB.w > 1.5) {
      // a blast on open ground, as the far windows see it: a lumpy disc, the pinwheel in it
      ang = atan(p.y, p.x);
      float d = length(p);
      float e = R * (0.8 + 0.1 * sin(3.0 * ang + seed) + 0.07 * sin(5.0 * ang + seed * 1.7) + 0.05 * sin(9.0 * ang + seed * 2.3));
      cov = min((e - d) / m + 0.5, age < 0.0 ? 0.0 : 1.0);
      A = B = base + floor(fract(ang / TAU + d / R * 0.2) * 6.0);
    } else {
      float dist = rimDist(p, ang);
      // level 3 throws rays over the ground, under all the rest
      if (lv > 2.5) {
        rays(dist, ang, m, 13.0, 3.4, 9.0, 0.05, seed, ease(k), base, cov, A, B, lift);
        if (R > 30.0) rays(dist, ang, m, 31.0, 1.5, 3.2, 0.028, seed + 7.0, ease(k), base + 2.0, cov, A, B, lift);
      }
      // level 1 floods the bowl, up from where it landed
      vec2 imp = vD.xy;
      float front = lv < 1.5 ? (R + length(imp)) * 1.03 * ease(k) : 2.0 * R + length(imp);
      float toFront = front - length(p - imp);
      float cF = min((R * 0.985 - dist) / m, toFront / m) + 0.5;
      if (lv < 1.5 && age < 0.0) cF = 0.0;
      if (cF > 0.02) {
        cov = max(cov, cF);
        A = B = base;
        which = 1.0;
        lift = 0.0;
        if (lv < 1.5) glow = (1.0 - k) * 0.9 * step(toFront, 0.1 * R + 2.0);
        // level 3 turns it to a pinwheel, from the middle out
        if (lv > 2.5) {
          float f3 = (R * 1.05) * ease(k);
          if (dist < f3) {
            float u = ang / TAU + 0.34 * log(0.16 + dist / R) + seed * 0.13;
            sectors(fract(u + 1.0) * 6.0, TAU * max(dist, 0.1 * R) / 6.0, m, base, A, B, which);
            lift = 0.13;
          }
          if (abs(dist - f3) < 0.05 * R + 1.0 && k < 1.0) glow = 0.85;
        }
      }
      // level 2 crowns the rim: it runs round both ways, a rainbow of teeth
      if (lv > 1.5) {
        float bw = min(0.1 * R, 5.0 + 0.03 * R);
        float N = 6.0 * clamp(floor(TAU * R / (36.0 * bw) + 0.5), 1.0, 16.0);
        float s = (ang / TAU + 0.5) * N, tooth = 1.0 - abs(2.0 * fract(s) - 1.0);
        float cC = min((R + bw * (0.8 + 1.1 * tooth) - dist) / m, (dist - R + bw) / m) + 0.5;
        if (lv < 2.5) {
          float a0 = seed, dA = abs(mod(ang - a0 + PI, TAU) - PI) / PI;
          cC = min(cC, (ease(k) * 1.04 - dA) * PI * R / m + 0.5);
          if (age < 0.0) cC = 0.0;
          if (cC > 0.02 && k < 1.0 && ease(k) * 1.04 - dA < 0.06) glow = 0.9;
        }
        if (cC > 0.02) {
          cov = max(cov, cC);
          sectors(s, TAU * R / N, m, base + 1.0, A, B, which);
          lift = 0.7;
        }
      }
    }
    if (cov <= 0.02) discard;
    outPaint = vec4((mod(A + 60.0, 6.0) * 8.0 + mod(B + 60.0, 6.0)) / 255.0, which, (floor(lift * 15.0 + 0.5) * 16.0 + floor(glow * 15.0 + 0.5)) / 255.0, min(cov, 1.0));
  }
`;

interface Win {
  cell: number;
  /** its first corner, and where it wants its middle */
  x0: number;
  z0: number;
  /** a mark or a move since it was last drawn: the whole of it goes again */
  dirty: boolean;
}

export class PaintClip {
  readonly rt: THREE.WebGLArrayRenderTarget;
  /** x0, z0, 1 / cell, on: the ground's uClip */
  readonly rects: THREE.Vector4[] = [];
  private readonly wins: Win[] = [];
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.Camera();
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly mesh: THREE.Mesh;
  private readonly uWin = { value: new THREE.Vector4() };
  private readonly uNow = { value: 0 };
  private cap = 0;
  private buf = new Float32Array(0);
  private ib: THREE.InstancedInterleavedBuffer | null = null;
  private readonly clear = new THREE.Color();
  private primed = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.rt = new THREE.WebGLArrayRenderTarget(CLIP_N, CLIP_N, CLIP_LEVELS, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    this.rt.texture.colorSpace = THREE.NoColorSpace;
    this.rt.scissorTest = true;
    for (let k = 0; k < CLIP_LEVELS; k++) {
      this.rects.push(new THREE.Vector4(0, 0, 1 / CLIP_CELL[k], 0));
      this.wins.push({ cell: CLIP_CELL[k], x0: Infinity, z0: Infinity, dirty: true });
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.grow(256);
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uWin: this.uWin, uNow: this.uNow },
      vertexShader: VS,
      fragmentShader: FS,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.ZeroFactor,
      blendEquationAlpha: THREE.MaxEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);
    this.scene.matrixAutoUpdate = false;
  }

  private grow(n: number) {
    this.cap = Math.max(n, this.cap * 2);
    this.buf = new Float32Array(this.cap * FLOATS);
    const ib = new THREE.InstancedInterleavedBuffer(this.buf, FLOATS);
    ib.setUsage(THREE.DynamicDrawUsage);
    this.geo.dispose();
    this.ib = ib;
    for (let i = 0; i < 6; i++) this.geo.setAttribute(`i${'ABCDEF'[i]}`, new THREE.InterleavedBufferAttribute(ib, 4, i * 4));
  }

  /** Nothing on any window holds: they go down again wherever they're wanted next. */
  rebase() {
    for (let k = 0; k < CLIP_LEVELS; k++) {
      this.wins[k].x0 = this.wins[k].z0 = Infinity;
      this.wins[k].dirty = true;
      this.rects[k].w = 0;
    }
  }

  /** Compiles the program. */
  prime() {
    this.draw(0, 0, 0, 1, 1, [], 0, 0);
  }

  /** Where a window's middle wants to be, for a view at (x, z) along (fx, fz). A window that moves is dirty, and on: so `from` says the ones the caller will draw. */
  follow(x: number, z: number, fx: number, fz: number, from = 0) {
    for (let k = from; k < CLIP_LEVELS; k++) {
      const w = this.wins[k], side = CLIP_N * w.cell, cx = x + fx * side * LEAD[k], cz = z + fz * side * LEAD[k];
      if (Math.abs(cx - (w.x0 + side / 2)) < side * LAG && Math.abs(cz - (w.z0 + side / 2)) < side * LAG) continue;
      // (on a grid of its own, so a contour doesn't crawl when it moves)
      const g = w.cell * 16;
      w.x0 = Math.round((cx - side / 2) / g) * g;
      w.z0 = Math.round((cz - side / 2) / g) * g;
      w.dirty = true;
      this.rects[k].set(w.x0, w.z0, 1 / w.cell, 1);
    }
  }

  /** Did a window move, and which: the caller hands its marks to draw(). */
  dirty(k: number): boolean {
    return this.wins[k].dirty;
  }

  window(k: number, out: number[]): number[] {
    const w = this.wins[k], s = CLIP_N * w.cell;
    out[0] = w.x0;
    out[1] = w.z0;
    out[2] = w.x0 + s;
    out[3] = w.z0 + s;
    return out;
  }

  /** Window k's rectangle (m), cleared, and the marks on it in the order given. Keep the render state as it found it. */
  draw(k: number, x0: number, z0: number, x1: number, z1: number, marks: ClipMark[], n: number, now: number) {
    const w = this.wins[k], cell = w.cell, r = this.renderer;
    const i0 = Math.max(0, Math.floor((x0 - w.x0) / cell)), j0 = Math.max(0, Math.floor((z0 - w.z0) / cell));
    const i1 = Math.min(CLIP_N, Math.ceil((x1 - w.x0) / cell)), j1 = Math.min(CLIP_N, Math.ceil((z1 - w.z0) / cell));
    if (this.primed && (i1 <= i0 || j1 <= j0)) return;
    if (n > this.cap) this.grow(n);
    const b = this.buf;
    for (let q = 0, o = 0; q < n; q++, o += FLOATS) {
      const m = marks[q];
      b[o] = m.x;
      b[o + 1] = m.z;
      b[o + 2] = m.r;
      b[o + 3] = m.reach;
      b[o + 4] = m.a;
      b[o + 5] = m.b;
      b[o + 6] = m.c;
      b[o + 7] = m.kind;
      b[o + 8] = m.level;
      b[o + 9] = m.hue;
      b[o + 10] = m.t0;
      b[o + 11] = m.T;
      b[o + 12] = m.ix;
      b[o + 13] = m.iz;
      b[o + 14] = m.seed;
      b[o + 15] = m.turn;
      const wob = m.wob;
      for (let i = 0; i < 8; i++) b[o + 16 + i] = wob ? wob[i] : 0;
    }
    const ib = this.ib!;
    ib.clearUpdateRanges();
    ib.addUpdateRange(0, n * FLOATS);
    ib.needsUpdate = true;
    this.geo.instanceCount = n;
    this.uWin.value.set(w.x0, w.z0, 1 / (CLIP_N * cell), cell);
    this.uNow.value = now;
    this.rt.scissor.set(i0 || 0, j0 || 0, Math.max(0, i1 - i0) || 0, Math.max(0, j1 - j0) || 0);
    r.setRenderTarget(this.rt, k);
    const a = r.getClearAlpha();
    r.getClearColor(this.clear);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setClearColor(this.clear, a);
    // (the first draw compiles its program: before the first frame, with or without anything to draw)
    this.mesh.visible = n > 0 || !this.primed;
    if (!this.primed) {
      this.geo.instanceCount = Math.max(1, n);
      this.primed = true;
    }
    if (this.mesh.visible) r.render(this.scene, this.cam);
    r.setRenderTarget(null);
    if (i1 - i0 === CLIP_N && j1 - j0 === CLIP_N) w.dirty = false;
  }
}
