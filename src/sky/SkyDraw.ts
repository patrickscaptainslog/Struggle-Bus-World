import * as THREE from 'three';
import { Ramp } from '../render/palette';
import type { PixelPipeline } from '../render/PixelPipeline';
import { spaceResolveUniforms as U } from '../render/skyResolve';
import { gunzip, isGzip } from '../world/gunzip';
import { TILE } from './groundSize';
import { GROUND_H, GROUND_W, loadGround, type GroundRequest, type GroundResult } from './MoonGround';
import { moonDrawnKm, R_EARTH_A, R_EARTH_B, R_MOON, type SkyState } from './SkyModel';

// What the sky hands the frame (SKY.md section 2): the resolve's uniforms, stars and sky lines. Bodies are ray tests in the resolve (render/skyResolve.ts); this file feeds them.
//
// Stars and lines go into the G-buffer through a program of their own, with flags 0: the resolve still reads their pixels as sky, so Earth and the Moon cover them, and the bus covers
// them by depth. Star: one pixel, at the far plane, turned by uStarRot, so they work from any body and hold still with the view: no twinkle up here, no size, no glow.

const STAR_VS = /* glsl */ `
  precision highp float;
  uniform mat3 uStarRot;
  in vec2 aStar;
  flat out vec2 vStar;
  void main() {
    gl_PointSize = 1.0;
    vStar = aStar;
    vec3 v = mat3(viewMatrix) * (uStarRot * position);
    gl_Position = projectionMatrix * vec4(v, 1.0);
    gl_Position.z = gl_Position.w * 0.99999;
  }
`;
const STAR_FS = /* glsl */ `
  precision highp float;
  flat in vec2 vStar;
  layout(location = 0) out highp uvec4 gBuf;
  void main() {
    gBuf = uvec4(uint(vStar.x) | (uint(vStar.y) << 8u), 0u, 0u, 0u);
  }
`;

// A sky line (SKY.md 4.7): 1 px, 3 on 1 off, stopping short of each star. Gap pixels write the clear value, no discard. It draws before the stars: a gap can't take one out.
const LINE_VS = /* glsl */ `
  precision highp float;
  uniform mat3 uStarRot;
  uniform vec2 uLine;       // how far short of a star it stops, and one game pixel (rad)
  in vec4 aOther;           // the far end, and 0 / 1 for which end this is
  out float vPx;
  void main() {
    vec3 to = aOther.xyz - position;
    float l = length(to);
    vec3 d = position + to / max(l, 1e-6) * min(uLine.x, l * 0.45);
    vPx = aOther.w * l / uLine.y;
    vec3 v = mat3(viewMatrix) * (uStarRot * normalize(d));
    gl_Position = projectionMatrix * vec4(v, 1.0);
    gl_Position.z = gl_Position.w * 0.99999;
  }
`;
const LINE_FS = /* glsl */ `
  precision highp float;
  in float vPx;
  layout(location = 0) out highp uvec4 gBuf;
  void main() {
    gBuf = mod(vPx, 4.0) >= 3.0 ? uvec4(0u) : uvec4(${Ramp.GLOW_WHITE}u | (1u << 8u), 0u, 0u, 0u);
  }
`;

const uStarRot = { value: new THREE.Matrix3() };
const uLine = { value: new THREE.Vector2(0.005, 0.0017) };

function skyMaterial(vertexShader: string, fragmentShader: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { uStarRot, uLine }, vertexShader, fragmentShader, depthWrite: false });
}

/** An empty draw of the right shape: its program warms with the frame's, and the data lands in it. */
function drawable<T extends THREE.Points | THREE.LineSegments>(o: T, order: number): T {
  o.frustumCulled = false;
  o.matrixAutoUpdate = false;
  o.matrixWorldAutoUpdate = false;
  o.renderOrder = order;
  return o;
}

/** A gzipped file under public/sky. */
async function file(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b = await r.arrayBuffer();
  return isGzip(b) ? gunzip(b) : b;
}

function mapTexture(data: Uint8Array, w: number, h: number, format: THREE.PixelFormat): THREE.DataTexture {
  const t = new THREE.DataTexture(data as Uint8Array<ArrayBuffer>, w, h, format, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** earth.bin's three planes into one RGBA map: land, tone, class, lights. One fetch a pixel, filtered, so a coast is a threshold of a bilinear mask. */
function earthMap(buf: ArrayBuffer): THREE.DataTexture {
  const dv = new DataView(buf);
  const w = dv.getUint16(0, true), h = dv.getUint16(2, true), n = w * h;
  const b = new Uint8Array(buf, 4);
  const o = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = b[i];
    o[i * 4] = c ? 255 : 0;
    o[i * 4 + 1] = b[n + i] * 17;
    o[i * 4 + 2] = c === 3 ? 255 : c === 2 ? 128 : 0;
    o[i * 4 + 3] = Math.round(b[2 * n + i] * 36.43);
  }
  return mapTexture(o, w, h, THREE.RGBAFormat);
}

function moonMap(buf: ArrayBuffer): THREE.DataTexture {
  const dv = new DataView(buf);
  const w = dv.getUint16(0, true), h = dv.getUint16(2, true);
  const o = new Uint8Array(buf, 4, w * h);
  for (let i = 0; i < o.length; i++) o[i] = Math.round(o[i] * 36.43);
  return mapTexture(o, w, h, THREE.RedFormat);
}

/** A star's tier: which ramp and step. One pixel, five tiers, colour only on the brightest (SKY.md 4.6). Colour class 0-7 is B-V. */
function tier(v: number, cc: number, o: Uint8Array, i: number): void {
  o[i] = v < 2.2 && cc >= 5 ? Ramp.LAMP : Ramp.GLOW_WHITE;
  o[i + 1] = v < 1.5 ? 7 : v < 3 ? 6 : v < 4.2 ? 4 : v < 5.4 ? 2 : 1;
}

/** stars.bin (tools/sky/bake-space.py): declination deltas as varints, RA in two planes, a byte of magnitude and colour. Returns the stars' unit vectors in EQJ. */
function readStars(buf: ArrayBuffer): { pos: Float32Array; star: Uint8Array } {
  const b = new Uint8Array(buf);
  const n = new DataView(buf).getUint32(0, true);
  const dec = new Float64Array(n);
  let i = 4, sum = 0;
  for (let k = 0; k < n; k++) {
    let d = 0, sh = 0, c = 0;
    do {
      c = b[i++];
      d |= (c & 127) << sh;
      sh += 7;
    } while (c & 128);
    sum += d;
    dec[k] = (sum / 65535 - 0.5) * Math.PI;
  }
  const hi = i, lo = hi + n, mc = lo + n;
  const pos = new Float32Array(n * 3), star = new Uint8Array(n * 2);
  for (let k = 0; k < n; k++) {
    const ra = (((b[hi + k] << 8) | b[lo + k]) / 65536) * 2 * Math.PI, cd = Math.cos(dec[k]);
    pos[k * 3] = cd * Math.cos(ra);
    pos[k * 3 + 1] = cd * Math.sin(ra);
    pos[k * 3 + 2] = Math.sin(dec[k]);
    tier(((b[mc + k] >> 3) / 31) * 8 - 1.5, b[mc + k] & 7, star, k * 2);
  }
  return { pos, star };
}

const EARTH_TEXEL_KM = (2 * Math.PI * R_EARTH_A) / 2048;
const MOON_TEXEL_KM = (2 * Math.PI * R_MOON) / 1024;

/** How long a crater's own light takes to follow the top of the frame, s: a carve shouldn't swing the light over every crater at the rate of the turn. */
const AHEAD_S = 2;
const CLOSE_LOW = Math.log(300);
const CLOSE_HIGH = Math.log(9000);
const smooth01 = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** The Moon's ground, what a pixel near it gets that the map can't give: live, the tuner moves them. See MoonGround.ts and the resolve's spaceMoon. */
export const groundTune = {
  /** The real relief's slope, times this: a true slope at 10 km is a degree or two. */
  relief: 2.5,
  /** The invented craters' slope, times this. */
  craters: 0.6,
  /** How bright a fresh crater's ejecta and a rim are, in the map's tone. */
  bright: 0.7,
  /** How much of its shape a crater keeps under a high Sun. */
  flat: 1.2,
  /** How much of that the real relief gets. */
  hill: 0.5,
  /** How far the big craters push the map's read, in thousandths of a turn. */
  wander: 0.5,
  /** The tiles' mip: under 0 is sharper, and shimmers. */
  sharp: -0.4,
  /** How hard a sea drops the craters it doesn't keep. */
  keep: 0.05,
};

export class SkyDraw {
  readonly object = new THREE.Group();
  private readonly stars: THREE.Points;
  private readonly lines: THREE.LineSegments;
  private readonly pipeline: PixelPipeline;
  /** ms the files took to fetch and inflate, to read, and to reach the GPU */
  readonly timing = { fetchMs: 0, readMs: 0, uploadMs: 0 };
  /** the Moon's floor, game px across (SKY.md 4.5); released within 12 degrees of the Sun. 0: true size. */
  moonFloor = 15;
  /** Earth's air at the limb (false: the bare disc, to measure it). */
  air = true;
  /** The air's scale height never goes under this many game pixels (the true air is 0.3 px at 100,000 km). */
  airPx = 1.2;
  /** The Moon's ground, once the worker has it: until then, and for good if it never comes, the tone map alone. */
  ground: { ready: boolean; ms: number } = { ready: false, ms: 0 };
  private moonTexelKm = MOON_TEXEL_KM;
  private readonly ahead = new THREE.Vector3(0, 0, 1);
  private readonly tmpAhead = new THREE.Vector3();
  private aheadSet = false;
  /** The view's up and back, Moon fixed, when the render frame isn't the view's (on the way down it's the world's: moon/Landing.ts). */
  view: Float64Array | null = null;
  /** km on the Moon's radius: the ray test on the ground it's over, not on a sphere that can be kilometres above a sea (moon/Landing.ts). */
  moonLift = 0;

  constructor(pipeline: PixelPipeline) {
    this.pipeline = pipeline;
    this.object.matrixAutoUpdate = false;
    const star = new THREE.BufferGeometry();
    star.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    star.setAttribute('aStar', new THREE.BufferAttribute(new Uint8Array(2), 2));
    this.stars = drawable(new THREE.Points(star, skyMaterial(STAR_VS, STAR_FS)), 1);
    const line = new THREE.BufferGeometry();
    line.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    line.setAttribute('aOther', new THREE.BufferAttribute(new Float32Array(8), 4));
    this.lines = drawable(new THREE.LineSegments(line, skyMaterial(LINE_VS, LINE_FS)), 0);
    this.object.add(this.lines, this.stars);
  }

  /** The sky lines on or off. */
  showLines(on: boolean): void {
    this.lines.visible = on;
  }

  /** The maps, stars and figures, fetched at once, read, and uploaded here, before the first frame. */
  async load(base: string): Promise<void> {
    const t0 = performance.now();
    const [earth, moon, stars, lines] = await Promise.all(['earth', 'moon', 'stars', 'lines'].map((f) => file(`${base}/${f}.bin`)));
    const t1 = performance.now();
    const em = earthMap(earth), mm = moonMap(moon);
    const { pos, star } = readStars(stars);
    const sg = this.stars.geometry;
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aStar', new THREE.BufferAttribute(star, 2));
    // the figures: both ends on each vertex, so a line can stop short of its stars
    const nSeg = new DataView(lines).getUint32(0, true) >> 1;
    const seg = new Uint16Array(lines.slice(4, 4 + nSeg * 4));
    const lp = new Float32Array(nSeg * 6), lo = new Float32Array(nSeg * 8);
    for (let i = 0; i < nSeg; i++) {
      const a = seg[i * 2] * 3, b = seg[i * 2 + 1] * 3;
      for (let k = 0; k < 3; k++) {
        lp[i * 6 + k] = pos[a + k];
        lp[i * 6 + 3 + k] = pos[b + k];
        lo[i * 8 + k] = pos[b + k];
        lo[i * 8 + 4 + k] = pos[a + k];
      }
      lo[i * 8 + 3] = 0;
      lo[i * 8 + 7] = 1;
    }
    const lg = this.lines.geometry;
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('aOther', new THREE.BufferAttribute(lo, 4));
    const t2 = performance.now();
    const r = this.pipeline.renderer;
    r.initTexture(em);
    r.initTexture(mm);
    U.tEarthMap.value = em;
    U.tMoonMap.value = mm;
    const t3 = performance.now();
    this.timing.fetchMs = Math.round(t1 - t0);
    this.timing.readMs = Math.round(t2 - t1);
    this.timing.uploadMs = Math.round(t3 - t2);
  }

  /**
   * The Moon's ground, on a worker: nothing waits for it. The flight is two minutes from needing it, and till it lands the Moon is the tone map it always was. tMoonMap changes under the resolve, which needs no new program.
   * The upload is one frame's, over home.
   */
  loadGround(base: string): void {
    const m = U.tMoonMap.value as THREE.DataTexture | null;
    const img = m?.image as { data: Uint8Array; width: number; height: number } | undefined;
    if (!m || !img) return;
    const req: GroundRequest = { base, tone: img.data, toneW: img.width, toneH: img.height };
    const t0 = performance.now();
    const landed = (res: GroundResult | null) => {
      if (res) this.landGround(res, m, performance.now() - t0);
    };
    const onThread = () => void loadGround(req).then(landed);
    try {
      const worker = new Worker(new URL('./moonGroundWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<GroundResult | null>) => {
        worker.terminate();
        landed(ev.data);
      };
      // (a sandboxed host can refuse a module worker)
      worker.onerror = () => {
        worker.terminate();
        onThread();
      };
      worker.postMessage(req);
    } catch {
      onThread();
    }
  }

  private landGround(res: GroundResult, old: THREE.Texture, ms: number): void {
    const r = this.pipeline.renderer;
    const map = mapTexture(res.map, GROUND_W, GROUND_H, THREE.RGBAFormat);
    const tile = mapTexture(res.tile, TILE, TILE, THREE.RGBAFormat);
    tile.wrapT = THREE.RepeatWrapping;
    r.initTexture(map);
    r.initTexture(tile);
    U.tMoonMap.value = map;
    U.tMoonCraters.value = tile;
    old.dispose();
    this.moonTexelKm = (2 * Math.PI * R_MOON) / GROUND_W;
    this.ground.ready = true;
    this.ground.ms = Math.round(ms);
  }

  /** Every frame: the sky into the resolve's uniforms and the stars' rotation. No allocation. dt: the screen's, s. */
  update(s: SkyState, dt = 1 / 60): void {
    const focal = 1 / this.pipeline.pixelWorldSize(1);
    const r = s.earthRot, m = s.moonRot, q = s.starRot;
    U.uEarthRot.value.set(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]);
    U.uMoonRot.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    uStarRot.value.set(q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8]);

    // Earth at unit radius, its z squashed to a sphere, and c in double
    const ox = s.earthO[0] / R_EARTH_A, oy = s.earthO[1] / R_EARTH_A, oz = s.earthO[2] / R_EARTH_B;
    U.uEarthO.value.set(ox, oy, oz, ox * ox + oy * oy + oz * oz - 1);
    U.uEarthSun.value.set(s.earthSun[0], s.earthSun[1], s.earthSun[2]);
    const rE = Math.max(R_EARTH_A + 1e-3, s.earthKm);
    const hE = rE - R_EARTH_A;
    // km a pixel at the ground under the view and at the limb: the map's mip, the air's scale height (a pixel's floor past 20,000 km)
    const pxGround = Math.max(hE, 1) / focal;
    const pxLimb = Math.sqrt(rE * rE - R_EARTH_A * R_EARTH_A) / focal;
    const lod = Math.max(0, Math.log2(pxGround / EARTH_TEXEL_KM));
    U.uEarthView.value.set(lod, this.air ? Math.max(11, this.airPx * pxLimb) : 1e-3, Math.min(1, Math.max(0.14, pxLimb / 11)), 180 / Math.PI / focal);

    // the Moon at unit radius: the floor is a bigger radius
    const dot = s.sun[0] * s.moon[0] + s.sun[1] * s.moon[1] + s.sun[2] * s.moon[2];
    const rM = moonDrawnKm(s.moonKm, focal, this.moonFloor, Math.acos(Math.min(1, Math.max(-1, dot))) * (180 / Math.PI)) + this.moonLift;
    const mx = s.moonO[0] / rM, my = s.moonO[1] / rM, mz = s.moonO[2] / rM;
    U.uMoonO.value.set(mx, my, mz, mx * mx + my * my + mz * mz - 1);
    U.uMoonSun.value.set(s.moonSun[0], s.moonSun[1], s.moonSun[2]);
    // (by the root of Earth's phase: a half Earth still shows the ground. The landing site is in the dark for two weeks of every month)
    U.uMoonEarth.value.set(s.moonEarth[0], s.moonEarth[1], s.moonEarth[2], 2.05 * Math.sqrt(s.earthLitAtMoon));
    U.uMoonLod.value = Math.max(0, Math.log2((rM / R_MOON) * (Math.max(s.moonKm - R_MOON, 1) / focal / this.moonTexelKm)));
    const g = groundTune;
    // (what's invented comes in over the whole way down, in the log of the height: 25 % of it at 3,000 km, 70 % at 1,000 km)
    const close = 1 - smooth01((Math.log(Math.max(s.moonKm - R_MOON, 1)) - CLOSE_LOW) / (CLOSE_HIGH - CLOSE_LOW));
    U.uMoonClose.value = close;
    U.uMoonNear.value.set(this.ground.ready ? rM / focal : 0, g.relief, g.craters * close, g.wander * close);
    U.uMoonLook.value.set(g.bright * close, g.flat, g.sharp, g.keep);
    // the top of the frame, on the ground under the view: m's rows are the render frame's axes in Moon fixed, so this is up less back
    const ox2 = s.moonO[0] / s.moonKm, oy2 = s.moonO[1] / s.moonKm, oz2 = s.moonO[2] / s.moonKm;
    const v = this.view;
    let ax = v ? v[0] - v[3] : m[3] - m[6], ay = v ? v[1] - v[4] : m[4] - m[7], az = v ? v[2] - v[5] : m[5] - m[8];
    const on = ax * ox2 + ay * oy2 + az * oz2;
    ax -= ox2 * on;
    ay -= oy2 * on;
    az -= oz2 * on;
    const al = Math.hypot(ax, ay, az) || 1, A = this.ahead;
    A.lerp(this.tmpAhead.set(ax / al, ay / al, az / al), this.aheadSet ? 1 - Math.exp(-dt / AHEAD_S) : 1).normalize();
    U.uMoonAhead.value.set(A.x, A.y, A.z, g.hill);
    this.aheadSet = true;

    U.uSunDisc.value.set(s.sun[0], s.sun[1], s.sun[2], Math.cos(s.sunR));
    U.uSunRing.value = Math.cos(s.sunR + 1 / focal);
    U.uMoonFirst.value = s.moonKm < s.earthKm ? 1 : 0;
    uLine.value.set(3 / focal, 1 / focal);
  }
}
