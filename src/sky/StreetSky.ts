import * as THREE from 'three';
import { config } from '../config';
import { globals } from '../render/materials';
import { Ramp } from '../render/palette';
import type { PixelPipeline } from '../render/PixelPipeline';
import { heldResolveUniforms as U } from '../render/skyResolve';
import { gunzip, isGzip } from '../world/gunzip';
import * as gen from './series.gen.js';
import { moonDrawnKm, R_MOON, type SkyModel, type SkyState } from './SkyModel';

// The night sky from the street (docs/specs/sky/LIVE.md stage C; SKY.md 4.5, 4.6): the real stars, five planets and the Moon over the city, at the live sky's moment.
// feat/earth's SkyDraw.ts draws them for the space trip; this is the street's, on main's code.
//
// Stars and planets: one THREE.Points into the G-buffer with flags 0, so the resolve still reads their pixels as sky (render/skyResolve.ts GLSL_SKY_STARS) and the
// Moon covers them for one fetch. At the far plane with no depth write: a building, the bus or the far city covers one by depth. One pixel, five tiers, no glow, a
// dim cross on the brightest, colour on the brightest warm ones only. Sorted by magnitude, so the limit is the draw range; the extinction near the horizon and the
// planets' own limit are the vertex shader's. Twinkle: a step up or down now and then near the horizon, by a hash of the star and a 12 fps tick, faded out by
// 15 degrees up and with the air. The Moon is a disc in the resolve, no draw: this file hands it the uniforms.
//
// Nothing allocates once the files are in: update() and bodies() run every frame.

const DEG = Math.PI / 180;
const AU = 149597870.7;
/** J2000.0 as a UTC ms (TT minus 64.184 s), and a Julian century. */
const J2000 = Date.UTC(2000, 0, 1, 12) - 64184;
const CENTURY = 36525 * 86400000;

/** The bundle's Keplerian planets (Series.ts): heliocentric J2000 equatorial, AU. 0 Mercury, 1 Venus, 2 Earth-Moon, 3 Mars, 4 Jupiter, 5 Saturn. */
const planetHelio = (gen as unknown as { planetHelio: (n: number, t: number, o: Float64Array) => void }).planetHelio;
/** The five that show (Mercury, Venus, Mars, Jupiter, Saturn): their element row, magnitude at 1 AU (H) and phase law per degree, and ramp. */
const PLANETS = [
  { el: 0, h: -0.42, c1: 0.038, c2: 0, ramp: Ramp.GLOW_WHITE },
  { el: 1, h: -4.4, c1: 0.0009, c2: 0.000239, ramp: Ramp.GLOW_WHITE },
  { el: 3, h: -1.52, c1: 0.016, c2: 0, ramp: Ramp.LAMP },
  { el: 4, h: -9.4, c1: 0.005, c2: 0, ramp: Ramp.GLOW_WHITE },
  { el: 5, h: -8.88, c1: 0.044, c2: 0, ramp: Ramp.GLOW_WHITE },
];
/** A body and its cross's four arms. */
const CROSS = 5;
const P_VERTS = PLANETS.length * CROSS;
/** Brighter than this, a dim cross (SKY.md 4.6). */
const CROSS_V = 2.5;

/** The limit as the Sun goes down (deg, V): the planets from -2, V 1 by -5, V 4 by -10, all of them by -14 [SKY.md 4.6, E]. Heights fall. */
const LIMIT_SUN = new Float64Array([-2, -1.5, -5, 1, -10, 4, -14, 9]);
/** The limit by the eye's height (m, V): 5.0 at the street, 5.5 at 520 m, 6.5 from 10 km. */
const LIMIT_UP = new Float64Array([0, 5, 520, 5.5, 10000, 6.5]);
/** The planets' limit is the stars' plus this: a planet holds still and shines through a twilight that hides a star of its magnitude. */
const PLANET_BONUS = 2.5;

const STAR_VS = /* glsl */ `
  precision highp float;
  uniform mat3 uStarRot;
  uniform vec4 uStarSky;  // the stars' limit (V), the planets', the twinkle's tick, its chance at the top of the air (0 over 30 km)
  uniform vec4 uStarView; // one buffer pixel in clip space (x, y), the extinction a unit of air (V)
  in vec4 aStar;          // ramp, step, (V + 5) x 20, kind: 0 a star, 1-4 its cross's arms, 5 a planet, 6-9 its arms
  flat out uvec2 vStar;
  void main() {
    gl_PointSize = 1.0;
    vec3 w = uStarRot * position;
    float kind = aStar.w, arm = mod(kind, 5.0);
    bool planet = kind > 4.5;
    float s = w.y;
    float X = 1.0 / max(s, 0.035);
    float v = aStar.z / 20.0 - 5.0 + uStarView.z * X;
    if (s <= 0.0 || v > (planet ? uStarSky.y : uStarSky.x)) {
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      vStar = uvec2(0u);
      return;
    }
    // (a step up or down: the chance by the air it looks through, none from about 15 degrees up, a planet's a tenth)
    float p = min(0.25, 0.05 * pow(X, 1.75) * uStarSky.w) * (1.0 - smoothstep(0.17, 0.26, s)) * (planet ? 0.1 : 1.0);
    uint h = uint(gl_VertexID - int(arm)) * 747796405u + uint(uStarSky.z) * 2891336453u;
    h ^= h >> 16u;
    h *= 2246822519u;
    h ^= h >> 13u;
    float st = aStar.y;
    if (float(h & 65535u) < p * 65536.0) st = clamp(st + ((h & 65536u) != 0u ? 1.0 : -1.0), 1.0, 7.0);
    vStar = uvec2(uint(aStar.x), uint(st));
    vec4 c = projectionMatrix * vec4(mat3(viewMatrix) * w, 1.0);
    if (arm > 0.5) c.xy += vec2(arm < 2.5 ? (arm < 1.5 ? 1.0 : -1.0) : 0.0, arm > 2.5 ? (arm < 3.5 ? 1.0 : -1.0) : 0.0) * uStarView.xy * c.w;
    // (the far plane: only where nothing drew)
    c.z = c.w;
    gl_Position = c;
  }
`;
const STAR_FS = /* glsl */ `
  precision highp float;
  flat in uvec2 vStar;
  layout(location = 0) out highp uvec4 gBuf;
  void main() {
    gBuf = uvec4(vStar.x | (vStar.y << 8u), 0u, 0u, 0u);
  }
`;

/** A star's tier: ramp and step. One pixel, five tiers, colour only on the brightest (SKY.md 4.6). `cc`, the colour class 0-7, is B-V: 5 and up is warm. */
function tier(v: number, cc: number, o: Uint8Array, i: number): void {
  o[i] = v < 2.2 && cc >= 5 ? Ramp.LAMP : Ramp.GLOW_WHITE;
  o[i + 1] = v < 1.5 ? 7 : v < 3 ? 6 : v < 4.2 ? 4 : v < 5.4 ? 2 : 1;
}

/** A cross's arms are this many steps under their star. */
const ARM_DROP = 4;

/** A row of a falling table (x, y pairs) at x; past either end a row holds. */
function rowAt(t: Float64Array, x: number, rising = false): number {
  const n = t.length;
  if (rising ? x <= t[0] : x >= t[0]) return t[1];
  for (let i = 2; i < n; i += 2) {
    if (rising ? x <= t[i] : x >= t[i]) {
      const u = (x - t[i - 2]) / (t[i] - t[i - 2]);
      return t[i - 1] + (t[i + 1] - t[i - 1]) * u;
    }
  }
  return t[n - 1];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A gzipped file under public/sky. */
async function file(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b = await r.arrayBuffer();
  return isGzip(b) ? gunzip(b) : b;
}

/** moon.bin's tone, 0-7, box-filtered by 4 to a map 4 times the floor's disc wide or more (SKY.md 4.5): R, filtered, mipmapped. */
function moonMap(buf: ArrayBuffer): THREE.DataTexture {
  const dv = new DataView(buf);
  const w = dv.getUint16(0, true), h = dv.getUint16(2, true), b = new Uint8Array(buf, 4, w * h);
  const W = w >> 2, H = h >> 2, o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) sum += b[(y * 4 + j) * w + x * 4 + i];
      o[y * W + x] = Math.round((sum / 16) * 36.43);
    }
  const t = new THREE.DataTexture(o as Uint8Array<ArrayBuffer>, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** stars.bin (feat/earth's tools/sky/bake-space.py): declination deltas as varints, RA in two planes, a byte of magnitude and colour. Unit vectors in EQJ, V, class. */
function readStars(buf: ArrayBuffer): { pos: Float64Array; v: Float64Array; cc: Uint8Array } {
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
  const pos = new Float64Array(n * 3), v = new Float64Array(n), cc = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const ra = (((b[hi + k] << 8) | b[lo + k]) / 65536) * 2 * Math.PI, cd = Math.cos(dec[k]);
    pos[k * 3] = cd * Math.cos(ra);
    pos[k * 3 + 1] = cd * Math.sin(ra);
    pos[k * 3 + 2] = Math.sin(dec[k]);
    v[k] = ((b[mc + k] >> 3) / 31) * 8 - 1.5;
    cc[k] = b[mc + k] & 7;
  }
  return { pos, v, cc };
}

const vByte = (v: number) => Math.max(0, Math.min(255, Math.round((v + 5) * 20)));

export class StreetSky {
  readonly object: THREE.Points;
  private readonly uStarRot = { value: new THREE.Matrix3() };
  private readonly uStarSky = { value: new THREE.Vector4(-10, -10, 0, 0) };
  private readonly uStarView = { value: new THREE.Vector4(0.01, 0.01, 0.05, 0) };
  /** the vertices' magnitudes past the planets, rising: the draw range's search */
  private mags = new Float32Array(0);
  private pos: THREE.BufferAttribute;
  private star: THREE.BufferAttribute;
  /** ms the files took to fetch and inflate, and to read (QA) */
  readonly timing = { fetchMs: 0, readMs: 0 };
  /** this frame (QA): the stars' limit, the planets', how many vertices draw, the Moon's height and lit share (deg, 0..1), its disc's radius (game px) and the moonlight's weight */
  limit = -10;
  planetLimit = -10;
  drawn = 0;
  moonEl = -90;
  moonLit = 0;
  moonPx = 0;
  moonKey = 0;
  /** Earth's umbra's cover of the Moon, 0..1: the moonlight falls with it */
  umbra = 0;
  private planetMinute = NaN;
  private readonly helio = new Float64Array(3);
  private readonly earth = new Float64Array(3);
  /** the Moon as the eye sees it, render frame (lifted by the air), its drawn angular radius (rad), and whether it's over the eye's horizon */
  private readonly moonSeen = new THREE.Vector3();
  private moonRad = 0;
  private moonUp = false;
  private readonly shadowAxis = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly back = new THREE.Vector3();

  constructor(private readonly pipeline: PixelPipeline) {
    // (an empty draw of the right shape: its program warms with the frame's, and the data lands in it)
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(3), 3);
    this.star = new THREE.BufferAttribute(new Uint8Array(4), 4);
    g.setAttribute('position', this.pos);
    g.setAttribute('aStar', this.star);
    const m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uStarRot: this.uStarRot, uStarSky: this.uStarSky, uStarView: this.uStarView },
      vertexShader: STAR_VS,
      fragmentShader: STAR_FS,
      depthWrite: false,
    });
    const o = (this.object = new THREE.Points(g, m));
    o.frustumCulled = false;
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false;
    o.renderOrder = 1;
    o.name = 'stars';
    const t = new THREE.DataTexture(new Uint8Array([128]) as Uint8Array<ArrayBuffer>, 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    t.needsUpdate = true;
    U.tMoonMap.value = t;
    pipeline.skyBodies = (cam, W, H) => this.bodies(cam, W, H);
  }

  /** The stars and the Moon's map, fetched and read once, after the city: until then there are none, and the Moon is one tone. */
  async load(base: string): Promise<void> {
    const t0 = performance.now();
    const [stars, moon] = await Promise.all([file(`${base}/stars.bin`), file(`${base}/moon.bin`)]);
    const t1 = performance.now();
    const { pos, v, cc } = readStars(stars);
    const n = v.length, order = Array.from({ length: n }, (_, i) => i).sort((a, b) => v[a] - v[b]);
    let arms = 0;
    for (let k = 0; k < n; k++) if (v[k] < CROSS_V) arms += 4;
    const N = P_VERTS + n + arms;
    const P = new Float32Array(N * 3), S = new Uint8Array(N * 4), M = new Float32Array(N - P_VERTS);
    for (let k = 0; k < PLANETS.length; k++)
      for (let a = 0; a < CROSS; a++) {
        const i = k * CROSS + a;
        S[i * 4] = PLANETS[k].ramp;
        S[i * 4 + 3] = 5 + a;
        // (none till the first update places them)
        S[i * 4 + 2] = 255;
        P[i * 3 + 2] = 1;
      }
    let i = P_VERTS;
    for (const k of order) {
      const put = (arm: number) => {
        P[i * 3] = pos[k * 3];
        P[i * 3 + 1] = pos[k * 3 + 1];
        P[i * 3 + 2] = pos[k * 3 + 2];
        tier(v[k], cc[k], S, i * 4);
        if (arm) S[i * 4 + 1] = Math.max(1, S[i * 4 + 1] - ARM_DROP);
        S[i * 4 + 2] = vByte(v[k]);
        S[i * 4 + 3] = arm;
        M[i - P_VERTS] = v[k];
        i++;
      };
      put(0);
      if (v[k] < CROSS_V) for (let a = 1; a <= 4; a++) put(a);
    }
    const g = this.object.geometry;
    this.pos = new THREE.BufferAttribute(P, 3);
    this.star = new THREE.BufferAttribute(S, 4);
    g.setAttribute('position', this.pos);
    g.setAttribute('aStar', this.star);
    g.setDrawRange(0, 0);
    this.mags = M;
    this.planetMinute = NaN;
    const map = moonMap(moon);
    this.pipeline.renderer.initTexture(map);
    U.tMoonMap.value?.dispose();
    U.tMoonMap.value = map;
    this.timing.fetchMs = Math.round(t1 - t0);
    this.timing.readMs = Math.round(performance.now() - t1);
  }

  /**
   * Every frame, after the model: the stars' limit and turn, the planets once a sky minute, the Moon. `sunEl` the true Sun's height (deg), `hour` how far the hour
   * is up (0..1), `camY` the eye's height (m), `moonSeen` the Moon's height as the eye sees it, through the air (deg).
   */
  update(ms: number, s: SkyState, model: SkyModel, sunEl: number, hour: number, camY: number, moonSeen: number): void {
    const S = config.sky, q = s.starRot;
    this.uStarRot.value.set(q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8]);

    // the Moon
    const mx = s.moon[0], my = s.moon[1], mz = s.moon[2];
    const el = Math.asin(Math.max(-1, Math.min(1, my))) / DEG, flat = Math.hypot(mx, mz);
    const seen = moonSeen * DEG;
    const dip = Math.acos(6371000 / (6371000 + Math.max(0, camY)));
    this.moonEl = el;
    this.moonLit = s.moonLit;
    const elong = Math.acos(Math.max(-1, Math.min(1, s.sun[0] * mx + s.sun[1] * my + s.sun[2] * mz))) / DEG;
    const focal = 1 / this.pipeline.pixelWorldSize(1);
    const rM = moonDrawnKm(s.moonKm, focal, S.moonFloor, elong);
    this.moonRad = Math.asin(Math.min(1, rM / s.moonKm));
    this.moonPx = 2 * this.moonRad * focal;
    this.moonUp = S.moon && seen + this.moonRad > -dip;
    const ce = Math.cos(seen);
    if (flat > 1e-9) this.moonSeen.set((mx / flat) * ce, Math.sin(seen), (mz / flat) * ce);
    else this.moonSeen.set(0, 1, 0);
    U.uMoonRot.value.set(s.moonRot[0], s.moonRot[1], s.moonRot[2], s.moonRot[3], s.moonRot[4], s.moonRot[5], s.moonRot[6], s.moonRot[7], s.moonRot[8]);
    const sx = s.sun[0] * s.sunKm - mx * s.moonKm, sy = s.sun[1] * s.sunKm - my * s.moonKm, sz = s.sun[2] * s.sunKm - mz * s.moonKm, sl = Math.hypot(sx, sy, sz);
    U.uMoonSun.value.set(sx / sl, sy / sl, sz / sl, 1 - hour);
    this.shadow(s, model);
    // (earthshine as Earth is lit from the Moon, at night: by day the dark side is sky)
    U.uMoonDisc.value.w = S.earthshine * Math.sqrt(s.earthLitAtMoon) * hour;
    // moonlight takes the key above 8 degrees and a quarter lit (SKY.md 4.5), once the Sun's key is the afterglow; it falls with the umbra
    this.moonKey = S.moon ? smooth(8, 12, el) * smooth(0.25, 0.35, s.moonLit) * (1 - smooth(-4, 0.5, sunEl)) * (1 - 0.9 * this.umbra) : 0;

    // the stars' limit: as the Sun goes down, by the eye's height, less what the Moon washes out
    const moonWash = 1.5 * s.moonLit * smooth(-2, 5, el) * (1 - this.umbra);
    const open = sunEl >= LIMIT_SUN[0] ? -10 : rowAt(LIMIT_SUN, sunEl);
    this.limit = S.stars ? Math.min(open, rowAt(LIMIT_UP, camY, true)) - moonWash : -10;
    this.planetLimit = S.stars && sunEl < LIMIT_SUN[0] ? this.limit + moonWash + PLANET_BONUS : -10;
    // (the twinkle: a 12 fps tick of the game's clock, its chance thinning with the air over the eye, none past 30 km)
    this.uStarSky.value.set(this.limit, this.planetLimit, Math.floor(globals.uTime.value * 12), camY < 30000 ? Math.exp(-Math.max(0, camY) / 8000) : 0);
    this.uStarView.value.z = S.starExtinction;
    const minute = Math.floor(ms / 60000);
    if (minute !== this.planetMinute && this.mags.length) this.planets(ms, model);
    this.planetMinute = minute;
    // (the draw range: the planets, and the stars to the limit; their extinction near the horizon is the vertex shader's)
    const M = this.mags;
    let lo = 0, hi = M.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (M[mid] <= this.limit) lo = mid + 1;
      else hi = mid;
    }
    const on = this.planetLimit > -5 && M.length > 0;
    this.drawn = on ? P_VERTS + lo : 0;
    this.object.geometry.setDrawRange(0, this.drawn);
    this.object.visible = this.drawn > 0;
  }

  /** The planets where they are this minute (geocentric: the Sun's place plus the planet's from it), their magnitudes and tiers into the first vertices. */
  private planets(ms: number, model: SkyModel): void {
    const t = (ms - J2000) / CENTURY, h = this.helio, e = this.earth, se = model.sunEqj;
    const P = this.pos.array as Float32Array, S = this.star.array as Uint8Array;
    // (Earth from the Sun: what the phase angle needs)
    e[0] = -se[0] / AU;
    e[1] = -se[1] / AU;
    e[2] = -se[2] / AU;
    const R = Math.hypot(e[0], e[1], e[2]);
    for (let k = 0; k < PLANETS.length; k++) {
      const p = PLANETS[k];
      planetHelio(p.el, t, h);
      const gx = h[0] - e[0], gy = h[1] - e[1], gz = h[2] - e[2], d = Math.hypot(gx, gy, gz), r = Math.hypot(h[0], h[1], h[2]);
      const i = Math.acos(Math.max(-1, Math.min(1, (r * r + d * d - R * R) / (2 * r * d)))) / DEG;
      const V = p.h + 5 * Math.log10(r * d) + p.c1 * i + p.c2 * i * i;
      for (let a = 0; a < CROSS; a++) {
        const j = k * CROSS + a;
        P[j * 3] = gx / d;
        P[j * 3 + 1] = gy / d;
        P[j * 3 + 2] = gz / d;
        tier(V, 0, S, j * 4);
        // (an arm only on one brighter than the crosses' limit: the others' write ramp 0, which the resolve reads as no star)
        S[j * 4] = a > 0 && V >= CROSS_V ? 0 : p.ramp;
        if (a) S[j * 4 + 1] = Math.max(1, S[j * 4 + 1] - ARM_DROP);
        S[j * 4 + 2] = vByte(V);
      }
    }
    this.pos.clearUpdateRanges();
    this.pos.addUpdateRange(0, P_VERTS * 3);
    this.pos.needsUpdate = true;
    this.star.clearUpdateRanges();
    this.star.addUpdateRange(0, P_VERTS * 4);
    this.star.needsUpdate = true;
  }

  /** Earth's shadow on the disc, in the Moon's radii (SKY.md 4.5: 6,459 km at the Moon), and how much of the Moon the umbra covers. */
  private shadow(s: SkyState, model: SkyModel): void {
    const me = model.moonEqj, se = model.sunEqj, sl = Math.hypot(se[0], se[1], se[2]);
    const ax = -se[0] / sl, ay = -se[1] / sl, az = -se[2] / sl, along = me[0] * ax + me[1] * ay + me[2] * az;
    const out = U.uMoonShadow.value, umbra = s.shadow[1] / R_MOON, pen = s.shadow[2] / R_MOON, off = s.shadow[0] / R_MOON;
    this.umbra = Math.min(1, Math.max(0, (umbra + 1 - off) / 2));
    if (along < 0 || off > pen + 1) {
      out.set(0, 0, -2, -1);
      this.umbra = 0;
      return;
    }
    // (the axis from the Moon's centre, EQJ km, into the render frame; the disc's axes come in bodies(), so the axis waits here)
    const px = -(me[0] - ax * along), py = -(me[1] - ay * along), pz = -(me[2] - az * along), q = s.starRot;
    this.shadowAxis.set(q[0] * px + q[1] * py + q[2] * pz, q[3] * px + q[4] * py + q[5] * pz, q[6] * px + q[7] * py + q[8] * pz).divideScalar(R_MOON);
    out.z = umbra;
    out.w = pen;
  }

  /** From the camera the buffer is drawn with (the pipeline calls it once a frame): the Moon's disc in buffer px and its axes, and the crosses' pixel. */
  private bodies(cam: THREE.PerspectiveCamera, W: number, H: number): void {
    this.uStarView.value.x = 2 / W;
    this.uStarView.value.y = 2 / H;
    const disc = U.uMoonDisc.value, d = this.moonSeen;
    const v = this.right.copy(d).transformDirection(cam.matrixWorldInverse);
    if (!this.moonUp || v.z > -1e-3) {
      disc.z = 0;
      return;
    }
    const r = (this.moonRad * cam.projectionMatrix.elements[5] * H) / 2;
    v.applyMatrix4(cam.projectionMatrix);
    const x = (v.x * 0.5 + 0.5) * W, y = (v.y * 0.5 + 0.5) * H;
    if (x < -r - 2 || y < -r - 2 || x > W + r + 2 || y > H + r + 2) {
      disc.z = 0;
      return;
    }
    disc.x = Math.floor(x) + 0.5;
    disc.y = Math.floor(y) + 0.5;
    disc.z = Math.max(1, r);
    // the disc's axes: the lens's right made square to the Moon's direction, up, and back toward the eye
    const e = cam.matrixWorld.elements, R = this.right.set(e[0], e[1], e[2]);
    R.addScaledVector(d, -R.dot(d)).normalize();
    const B = this.back.copy(d).negate();
    const ux = B.y * R.z - B.z * R.y, uy = B.z * R.x - B.x * R.z, uz = B.x * R.y - B.y * R.x;
    U.uMoonView.value.set(R.x, ux, B.x, R.y, uy, B.y, R.z, uz, B.z);
    // (the map's texels across a pixel at the disc's middle)
    const map = U.tMoonMap.value as THREE.DataTexture | null, mw = (map?.image as { width: number } | undefined)?.width ?? 1;
    U.uMoonLod.value = Math.max(0, Math.log2(mw / (2 * Math.PI * disc.z)));
    // Earth's shadow on the disc's axes
    const sh = U.uMoonShadow.value;
    if (sh.z > 0) sh.set(this.shadowAxis.dot(R), this.shadowAxis.x * ux + this.shadowAxis.y * uy + this.shadowAxis.z * uz, sh.z, sh.w);
  }
}
