import * as THREE from 'three';
import { config } from '../../config';
import { HUE_RAMPS, Ramp } from '../../render/palette';
import { paintUniforms } from '../buildingMaterial';
import type { BuildingRef, City } from '../City';

// Paint for the hand-built landmark props (Transamerica, Sutro Tower, and any
// prop built with LandmarkKit). A landmark is a first-class paintable
// building: paintLandmark() registers it with the City (a paint texel from
// the reserved range, every spatial index, saved paint) and binds its
// materials to that texel, so the splat, the blast wave, escalation, the aim
// glint and persistence all treat it like a baked building.
//
// The look, in the palette like the buildings (ramp + light, never RGB):
//   level 1  the color pours down from the top over config.bloom.landmarkFlood
//            (fingers of paint run ahead), while a splash spreads from where
//            the breath hit; the hue's ramp with the light kept (the saturated
//            middle, like the buildings), white trim, stained-glass window
//            bands, glowing accents (a lit spire, blinking beacons), and the
//            paint's own bands (Sutro's red and white) as a rainbow
//   level 2  a garden: vines climb from the ground (a spiral up lattice legs),
//            vertical walls in a planted band grow lush (the pyramid's wings),
//            every ledge and roof turns to turf with flowers
//   level 3  Hundertwasser: wavy six-hue bands, every window its own hue, gilt
//            trim and a golden crown
// The pop and the wobble are the buildings' (the pop scaled down: these are
// big). Fog and outlines are written exactly as every other surface's.
//
// Adopting it in a LandmarkKit prop: nothing in the prop's shader beyond what
// landmarks.ts already does (GLSL_LM_PAINT_VS / GLSL_LM_PAINT_FS + lmPaint() at
// the end); optionally pass a LandmarkLook to `k.build(look)`; then ONE call
// where the prop is placed: paintLandmark(city, 'lm:<name>', object).

/** Per-landmark accents, in the prop's local frame (meters above its origin). All optional. */
export interface LandmarkLook {
  /** surfaces above this height glow when painted (a lit spire; with `blink`, beacons) */
  glowFrom?: number;
  /** the glow blinks in rings of rainbow light (aviation beacons) instead of holding steady */
  blink?: boolean;
  /** level 2: vines climb from the ground to about this fraction of the height (0 = none) */
  vines?: number;
  /** level 2: vertical walls with window bands between these heights are planted (the pyramid's wings) */
  planted?: [number, number];
  /** level 3: height of one wavy Hundertwasser band (m) */
  band?: number;
  /** the prop's own paint bands (Sutro's red/white, m per band): painted, each band takes the next hue */
  paintBands?: number;
  /** level 3 accents (LandmarkKit builds them; drawn only from level 3 on, so they cost nothing before):
   *  golden onion domes [x, y, z, widest radius] standing on (x, y, z)... */
  domes?: Array<[number, number, number, number]>;
  /** ...and rainbow bunting: pennants on a string between two points, sagging `sag` m in the middle */
  bunting?: Array<{ from: [number, number, number]; to: [number, number, number]; sag: number }>;
}

/** Pattern ids of the level-3 accent geometry (aPat.z): golden onion domes, bunting pennants. */
export const LM_DOME = 20;
export const LM_FLAG = 21;

const HUES = HUE_RAMPS.map((r) => r.toFixed(1)).join(', ');

// live from config.bloom (getter uniforms: the tuner edits them, no per-frame code)
const floodV = new THREE.Vector4();
const fxV = new THREE.Vector2();
const floodUniform = {
  get value() {
    const B = config.bloom;
    return floodV.set(B.landmarkFlood, B.landmarkSplat, B.landmarkSplatTime, B.landmarkGlow);
  },
  set value(_v: THREE.Vector4) {
    /* read-only: edit config.bloom */
  },
} as THREE.IUniform;
const fxUniform = {
  get value() {
    return fxV.set(config.bloom.landmarkPop, config.bloom.landmarkGlassGlow);
  },
  set value(_v: THREE.Vector2) {
    /* read-only: edit config.bloom */
  },
} as THREE.IUniform;

/** Uniforms of one landmark material (spread them into its uniforms; each material gets its own). */
export function landmarkPaintUniforms(look: LandmarkLook = {}): Record<string, THREE.IUniform> {
  return {
    uPaint: paintUniforms.uPaint,
    uPaintW: paintUniforms.uPaintW,
    uTarget: paintUniforms.uTarget,
    uBloom: paintUniforms.uBloom,
    uWobble: paintUniforms.uWobble,
    uLmFlood: floodUniform,
    uLmFx: fxUniform,
    /** paint texel (-1: not registered, grey forever) */
    uLmIdx: { value: -1 },
    /** x local top, y local bottom (m), z seed */
    uLmBox: { value: new THREE.Vector4(1, 0, 0, 0) },
    /** where the breath hit it (world) and when (game clock; the splash belongs to the bloom at that time) */
    uLmHit: { value: new THREE.Vector4(0, 0, 0, -1e9) },
    uLmLook: { value: new THREE.Vector4(look.glowFrom ?? 1e9, look.vines ?? 0.42, look.band ?? 9, look.paintBands ?? 0) },
    uLmLook2: { value: new THREE.Vector4(look.planted?.[0] ?? 1e9, look.planted?.[1] ?? -1e9, look.blink ? 1 : 0, 0) },
  };
}

/**
 * Vertex stage: reads the paint texel, pops and wobbles the prop like a
 * building. Call `vec3 p = lmVertex(position, aPat);` and use p for the position
 * (keep `position` for patterns: they must not slide with the pop).
 */
export const GLSL_LM_PAINT_VS = /* glsl */ `
precision highp sampler2D;
uniform sampler2D uPaint;
uniform float uPaintW;
uniform vec4 uBloom;
uniform vec2 uWobble;
uniform float uLmIdx;
uniform vec4 uLmBox;
uniform vec2 uLmFx;
flat out vec4 vPaint;
out vec3 vLmLocal;
vec3 lmVertex(vec3 p, vec4 pat) {
  vLmLocal = p;
  vPaint = vec4(0.0);
  if (uLmIdx < 0.0) return p;
  vec4 paint = texelFetch(uPaint, ivec2(int(mod(uLmIdx, uPaintW)), int(floor(uLmIdx / uPaintW))), 0);
  vPaint = paint;
  float tb = uTime - paint.b;
  if (paint.g < 0.5 || tb < 0.0) return p;
  // the buildings' squash & stretch pop about the base, scaled down, and their gentle wobble
  float pop = 0.0;
  if (tb < uBloom.x * 1.6) {
    float k = tb / uBloom.x;
    pop = (-uBloom.y * exp(-7.0 * k) * cos(10.5 * k) + uBloom.z * exp(-5.0 * k) * sin(10.5 * k)) * uLmFx.x;
  }
  float sy = 1.0 + pop;
  float sxz = 1.0 / sqrt(max(sy, 0.4));
  vec3 q = vec3(p.x * sxz, p.y * sy, p.z * sxz);
  float h01 = clamp(p.y / max(uLmBox.x, 1.0), 0.0, 1.0);
  float w = uWobble.x * h01 * smoothstep(0.0, 0.6, tb);
  float t = uTime * uWobble.y;
  q.x += w * sin(p.y * 0.33 + p.z * 0.21 + t);
  q.z += w * sin(p.y * 0.29 + p.x * 0.23 + t * 0.87);
  // bunting flutters (its tips)
  if (pat.z > ${LM_FLAG}.0 - 0.5 && fract(pat.x) > 0.25) {
    q.x += 0.3 * sin(uTime * 4.6 + pat.y * 0.7);
    q.z += 0.3 * cos(uTime * 3.9 + pat.y * 0.9);
    q.y += 0.12 * sin(uTime * 5.3 + pat.y);
  }
  return q;
}
`;

/**
 * Fragment stage: `LmPaint lp = lmPaint(ramp, lo, type, pat, y, worldPos, n, mpp);`
 * with the grey surface (its ramp and light offset, pattern detail included),
 * the prop's pattern id (0 plain trim, 1 paint bands, 2 lattice, 3 window
 * bands, others: plain walls), aPat (u 0..1 across the face, v, type, face
 * width m), the local height, the world position and normal, meters per game
 * pixel. Then light = lp.mode > 1.5 ? lp.light : sbLight(worldPos, n, lp.lo, 1.0),
 * mapped to the saturated middle when lp.mode is 1 (see landmarks.ts).
 */
export const GLSL_LM_PAINT_FS = /* glsl */ `
uniform float uLmIdx;
uniform vec4 uLmBox;
uniform vec4 uLmHit;
uniform vec4 uLmLook;
uniform vec4 uLmLook2;
uniform vec4 uLmFlood;
uniform vec2 uLmFx;
uniform float uTarget;
flat in vec4 vPaint;
in vec3 vLmLocal;
const float LM_HUES[6] = float[6](${HUES});
float lmHue(float h) { return LM_HUES[int(mod(floor(h + 0.5) + 60.0, 6.0))]; }
// a flower's hue: never the leaves' green
float lmBloomHue(float h) { float r = lmHue(h); return r == ${Ramp.GREEN}.0 ? ${Ramp.YELLOW}.0 : r; }
float lmH21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lmNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lmH21(i), lmH21(i + vec2(1.0, 0.0)), f.x), mix(lmH21(i + vec2(0.0, 1.0)), lmH21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// mode: 0 grey (toon light from lo), 1 painted wall (toon light, mapped to the ramp's saturated middle),
// 2 lit (light given: stained glass, glowing accents)
struct LmPaint { float ramp; float lo; float glow; float light; float mode; };

LmPaint lmPaint(float ramp0, float lo, float type, vec4 pat, float y, vec3 wp, vec3 n, float mpp) {
  LmPaint o = LmPaint(ramp0, lo, 0.0, 0.0, 0.0);
  float level = vPaint.g;
  float top = uLmBox.x;
  float bot = uLmBox.y;
  float H = max(top - bot, 1.0);
  float tb = uTime - vPaint.b;
  bool painted = uLmIdx >= 0.0 && level > 0.5;
  // an escalation (already painted) stays painted while the blast wave travels to it
  if (painted && vPaint.a < 1.5) {
    bool on = false;
    if (tb >= 0.0) {
      // the flood pours down from the top, fingers of paint running ahead of it
      float k = clamp(tb / max(uLmFlood.x, 0.05), 0.0, 1.0);
      float ang = atan(vLmLocal.z, vLmLocal.x);
      float drip = (lmH21(vec2(floor(ang * 7.0), 3.1)) * 0.08 + lmH21(vec2(floor(ang * 19.0), 7.7)) * 0.05) * H * (1.0 - k);
      on = top - y < (H + 2.0) * pow(k, 1.3) + drip;
      // and a splash spreads from where the breath hit (only the bloom it belongs to)
      if (!on && abs(uLmHit.w - vPaint.b) < 0.3) {
        vec3 d = wp - uLmHit.xyz;
        float ks = 1.0 - exp(-3.0 * tb / max(uLmFlood.z, 0.05));
        float rr = uLmFlood.y * ks * (0.7 + 0.55 * lmNoise(wp.xz * 0.11 + wp.y * 0.07));
        on = dot(d, d) < rr * rr;
      }
    }
    painted = on;
  }
  if (type > ${LM_DOME}.0 - 0.5) {
    // level-3 accents (only drawn from level 3 on): they grow in after its pop, domes rising from their
    // base, pennants running along their strings
    if (!painted || tb < 0.0) discard;
    if (type < ${LM_FLAG}.0 - 0.5) {
      if (pat.y > clamp((tb - 0.15) / 0.8, 0.0, 1.0) * pat.w) discard;
      o.ramp = ${Ramp.YELLOW}.0;
      o.lo = lo + 0.12;
      o.glow = 0.16;
    } else {
      if (pat.y > (tb - 0.35) * 24.0) discard;
      o.ramp = lmHue(vPaint.r + floor(pat.x));
      o.lo = lo + 0.1;
    }
    o.mode = 1.0;
    painted = false;
  }
  if (painted) {
    float hue = vPaint.r;
    float L = floor(level + 0.5);
    float seed = uLmBox.z;
    float u = pat.x * pat.w; // meters across the face
    bool up = n.y > 0.7; // a ledge or a roof
    bool lit = y > uLmLook.x;
    o.mode = 1.0;
    o.ramp = lmHue(hue);
    o.lo = lo * 0.8 + 0.03; // the pattern's detail stays, as steps of the hue
    if (ramp0 == ${Ramp.GREY}.0) {
      // a dark recess (the pyramid's lobby): its hue in deep shadow (warm hues shadow toward rose and violet)
      // (yellow and orange keep a floor: their deepest steps are brick, which would read muddy)
      o.mode = 2.0;
      o.light = (o.ramp == ${Ramp.YELLOW}.0 || o.ramp == ${Ramp.ORANGE}.0 ? 0.3 : 0.17) + 0.04 * (1.0 - smoothstep(0.0, 6.0, y - bot));
    } else if (type == 0.0) {
      // plain trim: white, like the Painted Ladies' (gilt at level 3)
      o.ramp = L >= 3.0 ? ${Ramp.YELLOW}.0 : ${Ramp.WHITE}.0;
      o.lo = L >= 3.0 ? lo + 0.1 : lo - 0.02;
      if (L >= 3.0) o.glow = 0.16;
    }
    // the prop's own paint bands (Sutro's red and white) become a rainbow
    if (uLmLook.w > 0.0 && (type == 1.0 || type == 2.0)) o.ramp = lmHue(hue + floor(y / uLmLook.w));
    // level 3: Hundertwasser's wavy bands, all six hues, on every wall
    if (L >= 3.0 && type != 0.0 && ramp0 != ${Ramp.GREY}.0) {
      float bh = uLmLook.z;
      float wave = 0.3 * bh * sin(u * 0.19 + seed) + 0.17 * bh * sin(u * 0.47 + seed * 3.0) + 0.12 * bh * sin(y * 0.05 + u * 0.08);
      o.ramp = lmHue(hue + floor((y + wave) / bh));
    }
    // window bands: stained glass, one accent hue (levels 1-2), every window its own (level 3)
    if (type == 3.0 && !lit) {
      float fy = fract(y / 3.95);
      float row = step(0.42, fy) * step(fy, 0.8);
      float cx = (pat.x - 0.5) * pat.w / 1.65 + 0.5;
      float fx = fract(cx);
      float colm = step(0.18, fx) * step(fx, 0.82);
      vec2 cell = vec2(floor(cx), floor(y / 3.95));
      // (they melt into the wall window by window as they shrink under ~2 pixels: no visible ring)
      if (row > 0.5 && mpp < 0.75 * (0.75 + 0.5 * lmH21(cell + 5.3)) && (colm > 0.5 || mpp > 0.3)) {
        float acc = mod(seed, 2.0) < 1.0 ? 2.0 : 4.0;
        float wh = L >= 3.0 ? floor(lmH21(cell + seed * 1.7) * 6.0) : 0.0;
        o.ramp = lmHue(hue + acc + wh);
        o.mode = 2.0;
        o.light = 0.56 + 0.1 * lmH21(cell + 11.0);
        o.glow = uLmFx.y;
      }
    }
    if (L >= 2.0) {
      // a garden: every ledge and roof turns to turf with flowers (flowers only where they are 2+ pixels)
      vec2 fc = floor(vec2(u, y) / 2.2);
      float fl = mpp < 0.8 ? 1.0 : 0.0;
      if (up && type != 3.0) {
        o.ramp = ${Ramp.GREEN}.0;
        o.mode = 1.0;
        o.lo = -0.06 + (lmNoise(wp.xz * 0.45) - 0.5) * 0.18;
        if (fl > 0.5 && lmH21(floor(wp.xz / 2.0) + seed) > 0.8) { o.ramp = lmBloomHue(hue + 1.0); o.lo = 0.14; }
      }
      // vertical walls in the planted band (the pyramid's wings) grow lush
      if (type == 3.0 && abs(n.y) < 0.03 && y > uLmLook2.x && y < uLmLook2.y) {
        float lf = lmNoise(vec2(u, y) * 0.32 + seed);
        o.ramp = ${Ramp.GREEN}.0;
        o.mode = 1.0;
        o.lo = -0.08 + (lf - 0.5) * 0.24;
        float b = lmH21(fc + seed * 3.0);
        if (b > (fl > 0.5 ? 0.74 : 0.9)) { o.ramp = lmBloomHue(hue + (b > 0.87 ? 1.0 : 5.0)); o.lo = 0.12; }
      }
      // vines climb from the ground (a spiral up narrow beams), growing in after the level-2 pop
      if (uLmLook.y > 0.0 && !lit) {
        float grow = L < 2.5 ? clamp(tb / 1.8, 0.0, 1.0) : 1.0;
        float slant = pat.w < 10.0 ? 0.42 : 0.0;
        float cu = u + y * slant + 1.6 * sin(y * 0.07 + seed) + 0.8 * sin(y * 0.21 + seed * 2.0);
        float sp = 8.5;
        float ci = floor(cu / sp);
        float fx = abs(fract(cu / sp) - 0.5) * sp;
        float h = y - bot;
        float tip = uLmLook.y * H * (0.4 + 0.6 * lmH21(vec2(ci, seed + 4.0))) * grow;
        float leaf = lmNoise(vec2(u, y) * 0.3 + seed);
        // (big leafy lobes, never under ~2 pixels: thin vines would crawl)
        float wv = max(1.3 + 1.8 * leaf * (1.0 - smoothstep(0.0, tip + 1.0, h) * 0.6), mpp * 1.6);
        if (h < tip - leaf * 4.0 && fx < wv) {
          o.ramp = ${Ramp.GREEN}.0;
          o.mode = 1.0;
          o.lo = -0.05 + (leaf - 0.5) * 0.2;
          if (fl > 0.5 && lmH21(fc + seed * 5.0) > 0.84) { o.ramp = lmBloomHue(hue + 5.0); o.lo = 0.14; }
        }
      }
    }
    // glowing accents: a lit spire, blinking rainbow beacons
    if (lit) {
      float s = smoothstep(uLmLook.x, top, y);
      float pulse = 1.0;
      o.ramp = L >= 3.0 ? ${Ramp.YELLOW}.0 : lmHue(hue + 2.0);
      if (uLmLook2.z > 0.5) {
        float ring = floor(y / 3.5);
        pulse = 0.25 + 0.75 * step(0.55, fract(uTime * 0.6 + ring * 0.21));
        o.ramp = lmHue(hue + ring);
      }
      o.mode = 2.0;
      o.light = 0.56 + 0.22 * s * pulse;
      o.glow = uLmFlood.w * (0.45 + 0.55 * s) * pulse;
    }
  }
  // aim glint: the landmark a tap would hit shimmers (a slow sweep of light), grey or painted
  if (uLmIdx >= 0.0 && abs(uLmIdx - uTarget) < 0.5) {
    float sweep = fract(uTime * 0.9 - (y - bot) * 0.035);
    float g = 0.06 + 0.12 * smoothstep(0.75, 1.0, sweep);
    if (o.mode > 1.5) o.light += g;
    else o.lo += g;
  }
  return o;
}
`;

// ------------------------------------------------------------------ registration

interface Bound {
  ref: BuildingRef;
  mats: THREE.ShaderMaterial[];
  /** sparkle slices up the landmark (center, radius, height): a bloom's sparkles hug its shape */
  sparkles: Array<{ center: THREE.Vector3; radius: number; height: number }>;
}
const bound: Bound[] = [];

/**
 * Make a placed landmark prop a first-class paintable building: its base ring
 * (the convex hull of the prop in plan), its top, and a height field of its
 * real surface (what a breath lands on: the pyramid's slope, between Sutro's
 * legs the ground) go to City.addLandmarkBuilding under `key` (paint is saved
 * under it: use 'lm:<name>'), and its materials are bound to the paint texel.
 * Call once, after positioning the object. `name` is what the street sign
 * says when it is hit. Returns the ref (null if the reserve is full).
 */
export function paintLandmark(city: City, key: string, obj: THREE.Object3D, opts: { name?: string; arch?: number; cell?: number } = {}): BuildingRef | null {
  obj.updateMatrixWorld(true);
  const pts: number[] = [];
  const tris: number[] = [];
  const v = new THREE.Vector3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    const idx = m.geometry.getIndex();
    const base = pts.length / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      pts.push(v.x, v.y, v.z);
    }
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) tris.push(base + (idx ? idx.getX(i) : i));
  });
  if (pts.length < 9) return null;
  let top = -Infinity;
  for (let i = 1; i < pts.length; i += 3) top = Math.max(top, pts[i]);
  const baseY = obj.getWorldPosition(v).y;
  const ring = hullXZ(pts);
  const grid = heightGrid(pts, tris, opts.cell ?? 2);
  // (-Infinity where nothing stands: between Sutro's legs a breath comes down on the ground)
  const heightAt = (x: number, z: number) => grid.at(x, z, -Infinity);
  const ref = city.addLandmarkBuilding({ key, ring, baseY, roofY: top, name: opts.name, arch: opts.arch, heightAt });
  if (!ref) return null;
  const mats = bindLandmarkPaint(obj, ref);
  // sparkles hug the shape: four slices up its height, each as wide as the landmark there
  const sparkles: Bound['sparkles'] = [];
  const H = top - baseY;
  for (let k = 0; k < 4; k++) {
    const y1 = baseY + (H * (k + 1)) / 4;
    const r = grid.radiusAbove(ref.cx, ref.cz, baseY + (H * (k + 0.5)) / 4);
    if (r > 0) sparkles.push({ center: new THREE.Vector3(ref.cx, y1, ref.cz), radius: r + 2, height: H / 4 });
  }
  bound.push({ ref, mats, sparkles });
  return ref;
}

/**
 * Bind a landmark prop's materials (made with landmarkPaintUniforms) to a
 * building's paint texel: the prop paints, glints and pops with that building
 * (also a baked one, e.g. a spire that belongs to the tower it stands on).
 */
export function bindLandmarkPaint(obj: THREE.Object3D, ref: BuildingRef): THREE.ShaderMaterial[] {
  const mats: THREE.ShaderMaterial[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    const mat = m.isMesh ? (m.material as THREE.ShaderMaterial) : null;
    if (!mat?.uniforms?.uLmIdx) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    mat.uniforms.uLmIdx.value = ref.index;
    (mat.uniforms.uLmBox.value as THREE.Vector4).set(bb.max.y, bb.min.y, ref.index % 7, 0);
    mats.push(mat);
    // level-3 accents (the geometry after lmAccentStart) are drawn only while it is painted that far
    const start = m.geometry.userData.lmAccentStart as number | undefined;
    if (start !== undefined) {
      const geo = m.geometry;
      const idx = ref.index * 4 + 1;
      m.onBeforeRender = () => {
        const d = (paintUniforms.uPaint.value as THREE.DataTexture | null)?.image.data as Float32Array | undefined;
        geo.drawRange.count = d && d[idx] > 2.5 ? Infinity : start;
      };
    }
  });
  return mats;
}

/** The breath hit at p (game clock t): a landmark there starts its splash of paint from that point. */
export function landmarkHit(city: City, p: THREE.Vector3, t: number): void {
  for (const b of bound) {
    if (!city.contains(b.ref, p.x, p.z)) continue;
    for (const m of b.mats) (m.uniforms.uLmHit.value as THREE.Vector4).set(p.x, p.y, p.z, t);
  }
}

/** Sparkle slices for a landmark's bloom (center, radius, height each), or null for a baked building. */
export function landmarkSparkles(ref: BuildingRef): ReadonlyArray<{ center: THREE.Vector3; radius: number; height: number }> | null {
  for (const b of bound) if (b.ref === ref) return b.sparkles;
  return null;
}

// ------------------------------------------------------------------ geometry helpers

/** Convex hull of the points' (x, z) (Andrew's monotone chain), counter-clockwise. */
function hullXZ(pts: number[]): Array<[number, number]> {
  const P: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (let i = 0; i < pts.length; i += 3) {
    const x = Math.round(pts[i] * 10) / 10, z = Math.round(pts[i + 2] * 10) / 10;
    const k = `${x},${z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    P.push([x, z]);
  }
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [];
  for (const p of P) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  const hi: Array<[number, number]> = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
    hi.push(p);
  }
  lo.pop();
  hi.pop();
  return lo.concat(hi);
}

/**
 * The prop's surface as a height field: the highest point of its triangles
 * over each `cell` m square (sampled at half-cell spacing), -Infinity where
 * nothing stands (between Sutro's legs).
 */
function heightGrid(pts: number[], tris: number[], cell: number) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    z0 = Math.min(z0, pts[i + 2]);
    z1 = Math.max(z1, pts[i + 2]);
  }
  const W = Math.max(1, Math.ceil((x1 - x0) / cell) + 1);
  const D = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);
  const h = new Float32Array(W * D).fill(-Infinity);
  const put = (x: number, y: number, z: number) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    if (i < 0 || j < 0 || i >= W || j >= D) return;
    const k = j * W + i;
    if (y > h[k]) h[k] = y;
  };
  const step = cell * 0.5;
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ax = pts[a], ay = pts[a + 1], az = pts[a + 2];
    const e1x = pts[b] - ax, e1y = pts[b + 1] - ay, e1z = pts[b + 2] - az;
    const e2x = pts[c] - ax, e2y = pts[c + 1] - ay, e2z = pts[c + 2] - az;
    const n1 = Math.max(1, Math.ceil(Math.hypot(e1x, e1z) / step));
    const n2 = Math.max(1, Math.ceil(Math.hypot(e2x, e2z) / step));
    for (let i = 0; i <= n1; i++)
      for (let j = 0; j <= n2; j++) {
        const s = i / n1, r = j / n2;
        if (s + r > 1) break;
        put(ax + e1x * s + e2x * r, ay + e1y * s + e2y * r, az + e1z * s + e2z * r);
      }
  }
  return {
    /** surface height over (x, z), `floor` where nothing stands */
    at(x: number, z: number, floor: number): number {
      const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
      if (i < 0 || j < 0 || i >= W || j >= D) return floor;
      const y = h[j * W + i];
      return y > floor ? y : floor;
    },
    /** how far from (cx, cz) the surface still stands at least y high (m), 0 = nowhere */
    radiusAbove(cx: number, cz: number, y: number): number {
      let r = 0;
      for (let j = 0; j < D; j++)
        for (let i = 0; i < W; i++) {
          if (h[j * W + i] < y) continue;
          r = Math.max(r, Math.hypot(x0 + (i + 0.5) * cell - cx, z0 + (j + 0.5) * cell - cz));
        }
      return r;
    },
  };
}
