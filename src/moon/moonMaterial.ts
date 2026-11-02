import * as THREE from 'three';
import { GLSL_COMMON, GLSL_OUT, globals } from '../render/materials';
import { GLSL_MOON_CURVE } from '../sky/flag';
import { HUE_RAMPS, Ramp } from '../render/palette';
import { blastUniforms, GLSL_BLAST_RING, GLSL_GROUND_PAINT } from '../world/GroundPaint';
import { FAR, LIT_MAX, LIT_POW, LIT_TONE0, LIT_TONE1, SHADOW_MAX, SLOPE_MAX, type MoonTileData } from './gen';

/** Texels a side of a paint window (PaintClip.ts). */
export const CLIP_N = 1024;

// The ground's two programs, near and far, and the one light they share. The near one is terrainMaterial's with the map's four bytes in place of the class texture, so paint and the shockwave land as they do
// on a street; the far one is the clip levels' (MoonFar.ts). Grey until painted: every ramp here is a cool grey, the shadows are black, and nothing is lit but by the Sun.

/** What all of the Moon's ground reads. */
export const moonGlobals = {
  // x flat ground's light at mid tone, y the shadow's floor
  uMoonLight: { value: new THREE.Vector2(0.4, 0.006) },
  // what's painted on the craters: PaintClip's windows, each x0, z0, 1 / cell, on
  tPaintClip: { value: null as THREE.Texture | null },
  uClip: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  // the crater that glints: x, z, rim, since; the stamp's squash; two of its wobble, and 1 stamped, 2 named, 0 none
  uGlint: { value: new THREE.Vector4() },
  uGlintM: { value: new THREE.Vector4(1, 0, 1, 0) },
  uGlintS: { value: new THREE.Vector4() },
  // the crewed landing sites: x, z, radius, and how many there are
  uSites: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4()) },
  uSiteN: { value: 0 },
};

/** The four bytes back, the light, the ramp. Needs GLSL_COMMON. */
export const GLSL_MOON_LIGHT = /* glsl */ `
uniform vec2 uMoonLight;
float moonDecode(float b) {
  float s = (b * 255.0 - 128.0) / 127.0;
  return s * abs(s);
}
float moonHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// One byte set to what it says: the slope's normal, the tone, and how far under the sunlight's edge this is (metres, + in shadow)
void moonRead(vec4 m, out vec3 n, out float tone, out float under) {
  n = normalize(vec3(-moonDecode(m.r) * ${SLOPE_MAX.toFixed(1)}, 1.0, -moonDecode(m.g) * ${SLOPE_MAX.toFixed(1)}));
  tone = m.b;
  under = moonDecode(m.a) * ${SHADOW_MAX.toFixed(1)};
}
// The brightest slopes keep their shape: as it was up to 0.72, and past that a long ease into the top of the ramp, or a whole sunlit wall of fresh ground is one flat white with its stones as black static (Shackleton, Aristarchus).
float moonShoulder(float l) {
  if (l <= 0.8) return l / sqrt(1.0 + 0.3 * l * l);
  return 1.0 - 0.28 * exp(-2.74 * (l - 0.8));
}
// The light on regolith: nearly no limb darkening, so what a low Sun shows is the slope against it, measured from flat ground. Anything out of the Sun is black but for this floor.
float moonLit(vec3 n, float tone, float sun) {
  float k = max(dot(n, uSunDir), 0.0) / max(uSunDir.y, 0.05);
  float lit = uMoonLight.x * pow(k, ${LIT_POW.toFixed(2)}) * (${LIT_TONE0.toFixed(2)} + ${LIT_TONE1.toFixed(2)} * tone);
  // what a sunlit wall throws back across a shadow: barely a step, and enough that a bowl full of black still has a shape from inside it
  float fill = uMoonLight.y + 0.1 * smoothstep(0.56, 0.95, dot(n, normalize(vec3(-uSunDir.x, 0.6, -uSunDir.z))));
  return fill + sun * moonShoulder(lit);
}
float moonRamp(float tone) { return tone < 0.34 ? ${Ramp.MARE}.0 : ${Ramp.REGOLITH}.0; }
// What's between this ground and the Sun of what the sun pass draws: rocks and the bus, nothing of the ground itself, so it needs next to no bias.
float moonCast(vec3 wp) {
  if (uShadowOn < 0.01) return 1.0;
  vec4 sc = uShadowMatrix * vec4(wp + vec3(0.0, 0.05, 0.0), 1.0);
  vec3 uvz = sc.xyz / sc.w;
  if (uvz.x <= 0.002 || uvz.x >= 0.998 || uvz.y <= 0.002 || uvz.y >= 0.998 || uvz.z >= 1.0) return 1.0;
  return texture(uShadowMap, vec3(uvz.xy, uvz.z - 0.00004));
}
`;

/** A crater's paint, read back from PaintClip's windows, and the glint on the one a tap will hit. Needs GLSL_COMMON and GLSL_MOON_LIGHT. */
export const GLSL_MOON_PAINT = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray tPaintClip;
uniform vec4 uClip[4];
uniform vec4 uGlint;
uniform vec4 uGlintM;
uniform vec4 uGlintS;
uniform vec4 uSites[6];
uniform float uSiteN;
const float MOON_HUES[6] = float[6](${HUE_RAMPS.map((r) => r.toFixed(1)).join(', ')});
float moonNoise(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(moonHash(i), moonHash(i + vec2(1.0, 0.0)), f.x), mix(moonHash(i + vec2(0.0, 1.0)), moonHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// A crewed landing site: nothing lands here. 0 outside it, 1 in it, 2 on the line round it.
float moonSite(vec2 xz, float px) {
  for (int i = 0; i < 6 && float(i) < uSiteN; i++) {
    vec2 d = xz - uSites[i].xy;
    float R = uSites[i].z, dd = dot(d, d);
    if (dd < R * R) return R - sqrt(dd) < max(2.4, 0.8 * px) ? 2.0 : 1.0;
  }
  return 0.0;
}
// Which window a place reads: the finest that holds it and that a pixel's size on the ground can read. -1: none.
int moonWindow(vec2 xz, float px, out vec2 t) {
  int L = -1;
  t = vec2(0.0);
  for (int k = 3; k >= 0; k--) {
    vec4 c = uClip[k];
    vec2 q = (xz - c.xy) * c.z;
    if (c.w > 0.5 && (k == 3 || px * c.z <= 4.0) && q.x >= 3.0 && q.y >= 3.0 && q.x <= ${CLIP_N - 4}.0 && q.y <= ${CLIP_N - 4}.0) {
      L = k;
      t = q;
    }
  }
  return L;
}
// The hue one texel holds, going by its own ramp.
float moonSaid(vec4 s) {
  float h = floor(s.r * 255.0 + 0.5);
  return s.g < 0.5 ? floor(h / 8.0) : mod(h, 8.0);
}
// The paint at a place: false on bare ground.
bool moonClip(vec2 xz, float px, out float ramp, out float edge, out float lift, out float glow) {
  ramp = 0.0; edge = 0.0; lift = 0.0; glow = 0.0;
  vec2 t;
  int L = moonWindow(xz, px, t);
  if (L < 0) return false;
  // (most of the ground isn't painted: four looks, a little apart, and it's done)
  ivec2 c0 = ivec2(t);
  float round4 = texelFetch(tPaintClip, ivec3(c0 + ivec2(-1, -1), L), 0).a + texelFetch(tPaintClip, ivec3(c0 + ivec2(1, -1), L), 0).a;
  round4 += texelFetch(tPaintClip, ivec3(c0 + ivec2(-1, 1), L), 0).a + texelFetch(tPaintClip, ivec3(c0 + ivec2(1, 1), L), 0).a;
  if (round4 <= 0.0) return false;
  // organic edges, as GroundPaint's: the texels looked up through a little warp, and the contour's height broken up
  vec2 q = t * 0.11;
  vec2 g = t - 0.5 + (vec2(moonNoise(q), moonNoise(q + 31.7)) - 0.5) * 1.5;
  ivec2 i0 = ivec2(floor(g));
  vec2 f = fract(g);
  vec4 s00 = texelFetch(tPaintClip, ivec3(i0, L), 0), s10 = texelFetch(tPaintClip, ivec3(i0 + ivec2(1, 0), L), 0);
  vec4 s01 = texelFetch(tPaintClip, ivec3(i0 + ivec2(0, 1), L), 0), s11 = texelFetch(tPaintClip, ivec3(i0 + ivec2(1, 1), L), 0);
  vec4 a = vec4(s00.a, s10.a, s01.a, s11.a), w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  float cov = dot(a, w);
  float thr = 0.5 + (moonNoise(t * 0.45) - 0.5) * 0.26;
  bool on = cov > thr;
  // the strongest tap's two hues, read raw, and the ramp between them, filtered
  w *= a + 2.0 * step(0.5, a);
  vec4 s = s00;
  float m = w.x, which = s00.g * w.x, sum = w.x;
  which += s10.g * w.y + s01.g * w.z + s11.g * w.w;
  sum += w.y + w.z + w.w;
  if (w.y > m) { m = w.y; s = s10; }
  if (w.z > m) { m = w.z; s = s01; }
  if (w.w > m) s = s11;
  float h = floor(s.r * 255.0 + 0.5), b = floor(s.b * 255.0 + 0.5);
  float hA = floor(h / 8.0), hB = mod(h, 8.0);
  float pick = which / max(sum, 1e-4) < 0.5 ? hA : hB;
  // Two marks that meet have no ramp between them: coverage is full either side and the hue just changes, a texel's corner at a time, and near the lens a texel is 20 pixels. Each of the four says its own hue, and
  // the hue with the most of the four weights wins: that's the filtered contour between them, not a stair.
  vec4 said = vec4(moonSaid(s00), moonSaid(s10), moonSaid(s01), moonSaid(s11));
  if (any(greaterThan(step(0.001, w) * abs(said - hA) * abs(said - hB), vec4(0.5)))) {
    float top = -1.0;
    for (int i = 0; i < 4; i++) {
      float n = dot(w, vec4(equal(said, vec4(said[i]))));
      if (n > top) {
        top = n;
        pick = said[i];
      }
    }
  }
  ramp = MOON_HUES[int(clamp(pick, 0.0, 5.0))];
  edge = cov - thr;
  lift = floor(b / 16.0) / 15.0;
  glow = mod(b, 16.0) / 15.0;
  return on;
}
// The ground's light under paint: the crater under it still reads, on a floor of its own, and even a shadow's paint is paint.
float moonPaintLight(float ramp, float light, float edge, float lift, float wet) {
  float l = max(0.13 + 0.62 * clamp(light, 0.0, 1.0), 0.2);
  if (ramp == ${Ramp.YELLOW}.0) l = max(l + 0.1, 0.6);
  else if (ramp == ${Ramp.ORANGE}.0) l = max(l + 0.05, 0.45);
  if (edge < 0.07) l -= 0.11;
  else l += 0.1 * wet;
  return l + 0.2 * lift;
}
// 0 off it; on the rim of what glints, 1 and up to 2 where the sweep is passing.
float moonGlint(vec2 xz, float px) {
  if (uGlintS.w < 0.5) return 0.0;
  vec2 d = xz - uGlint.xy;
  float R = uGlint.z;
  if (dot(d, d) > R * R * 1.7) return 0.0;
  vec2 uv = uGlintS.w < 1.5 ? vec2(d.x * uGlintM.x + d.y * uGlintM.y, d.y * uGlintM.z - d.x * uGlintM.w) : vec2(d.x, -d.y);
  float ang = atan(uv.y, uv.x), rr = length(uv) / (1.0 + dot(uGlintS.xy, vec2(cos(3.0 * ang), sin(3.0 * ang))));
  // a run of light round the rim, a turn every second and a half, thick at its head and thinning behind it
  float s = fract(ang / 6.2832 - (uTime - uGlint.w) * 0.66);
  if (abs(rr - R) > max(min(R * 0.012, 0.5), px * 0.42) * (1.0 + 2.2 * s * s * s)) return 0.0;
  return 1.0 + step(0.76, s);
}
`;

/** The ground's small change, near the bus. Round, and offset from a grid so it never reads as one. */
const GLSL_MOON_STONES = /* glsl */ `
float moonGrain(vec2 q) {
  vec2 i = floor(q * 1.7), f = fract(q * 1.7);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(moonHash(i), moonHash(i + vec2(1.0, 0.0)), f.x), mix(moonHash(i + vec2(0.0, 1.0)), moonHash(i + vec2(1.0, 1.0)), f.x), f.y) - 0.5;
}
// +1 on a stone's sunward face, -1 in its shadow, 0 off it. A cell holds at most one, wholly inside it. (Sheared rows: a square grid's columns would show.)
float moonStones(vec2 p, float s, float seed) {
  vec2 q = vec2(p.x + 0.37 * p.y, p.y - 0.29 * p.x) / s + seed;
  vec2 c = floor(q), f = q - c;
  float h = moonHash(c + 3.1);
  if (h > 0.3) return 0.0;
  float r = 0.06 + 2.6 * h * h;
  vec2 o = vec2(moonHash(c + 17.7), moonHash(c + 41.3)) * (1.0 - 2.0 * r - 0.3) + r + 0.15;
  vec2 d = f - o;
  vec2 sunward = normalize(vec2(uSunDir.x + 0.37 * uSunDir.z, uSunDir.z - 0.29 * uSunDir.x));
  if (dot(d, d) < r * r) return dot(d, sunward) > -0.2 * r ? 1.0 : -1.0;
  // the shadow: the disc slid away from the Sun, a stone's height over the Sun's
  vec2 e = d + sunward * r * 1.2;
  if (dot(e, e) < r * r * 0.7) return -1.0;
  return 0.0;
}
`;

const NEAR_VS = /* glsl */ `
  ${GLSL_COMMON}
  ${GLSL_MOON_CURVE}
  uniform vec4 uTileRect; // originX, originZ, 1/size, 0
  uniform vec4 uMapRect;  // the map's first texel, per metre, half a texel
  out vec3 vWorldPos;
  out vec2 vClassUv;
  out vec2 vMapUv;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vClassUv = (wp.xz - uTileRect.xy) * uTileRect.z;
    vMapUv = (wp.xz - uMapRect.xy) * uMapRect.z + uMapRect.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(moonCurve(wp.xyz), 1.0);
  }
`;

const NEAR_FS = /* glsl */ `
  ${GLSL_COMMON}
  ${GLSL_MOON_LIGHT}
  ${GLSL_MOON_PAINT}
  ${GLSL_MOON_STONES}
  uniform sampler2D tMoon;
  ${GLSL_GROUND_PAINT}
  ${GLSL_BLAST_RING}
  in vec3 vWorldPos;
  in vec2 vClassUv;
  in vec2 vMapUv;
  ${GLSL_OUT}
  void main() {
    vec3 n;
    float tone, under;
    moonRead(texture(tMoon, vMapUv), n, tone, under);
    float sun = under > 0.0 ? 0.0 : 1.0;
    sun *= moonCast(vWorldPos);
    // what the map is too coarse for, only as near as it shows: stones, each with its own hard little shadow, and the grain between them
    float px = length(dFdx(vWorldPos.xz)) + length(dFdy(vWorldPos.xz));
    float grainK = 1.0 - smoothstep(0.6, 2.4, px);
    float stone = 0.0;
    if (grainK > 0.0 && sun > 0.5) {
      stone = moonStones(vWorldPos.xz, 1.9, 0.0) + moonStones(vWorldPos.xz, 0.83, 57.0);
      n = normalize(n + vec3(moonGrain(vWorldPos.xz) * 0.16 * grainK, 0.0, moonGrain(vWorldPos.zx + 40.0) * 0.16 * grainK));
    }
    float light = moonLit(n, tone, sun);
    if (stone > 0.5) light = max(light * (1.0 + 0.8 * grainK), 0.3);
    else if (stone < -0.5) light *= 1.0 - mix(0.75, 0.42, smoothstep(0.55, 0.95, light)) * grainK;
    float ramp = moonRamp(tone);
    float glow = 0.0;
    float pr, pEdge, pWet, pFresh, pLift, pGlow;
    float site = moonSite(vWorldPos.xz, px);
    // what's on a crater first: a bowl keeps its colour whatever lands round it
    // (not the long axis alone: at a grazing view that would blur what the short axis can still read)
    float pa = length(dFdx(vWorldPos.xz)), pb = length(dFdy(vWorldPos.xz));
    float pv = pow(max(pa, pb), 0.6) * pow(max(min(pa, pb), 0.001), 0.4);
    if (site > 0.5) {
      if (site > 1.5) light = max(light, 0.52);
    } else if (moonClip(vWorldPos.xz, pv, pr, pEdge, pLift, pGlow)) {
      ramp = pr;
      light = moonPaintLight(pr, light, pEdge, pLift, 0.0);
      glow = pGlow;
      light = max(light, glow);
    } else if (sbGroundPaint(vWorldPos, vClassUv, pr, pEdge, pWet, pFresh)) {
      ramp = pr;
      light = moonPaintLight(pr, light, pEdge, 0.0, pWet);
      glow = 0.55 * pFresh;
      light = max(light, glow);
    }
    float gl = moonGlint(vWorldPos.xz, px);
    if (gl > 0.5) {
      if (gl > 1.5) { ramp = ${Ramp.GLOW_WHITE}.0; light = 0.95; glow = 0.8; }
      else light = max(light + 0.22, 0.62);
    }
    float rr, rl, rg;
    if (sbRing(vWorldPos, n, rr, rl, rg)) { ramp = rr; light = rl; glow = rg; }
    sbWrite(ramp, light, 0.0, glow, mat3(viewMatrix) * n, 0.01, 1.0);
  }
`;

/** The texture of a map, tile or region. Its mips are what keeps a distant tile from crawling. */
export function moonMapTexture(data: Uint8Array, N: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data as Uint8Array<ArrayBuffer>, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** A coarse region's tile on its own (paint split it out): that tile's square of the region's map. */
export function moonTileMap(m: MoonTileData, ox: number, oz: number, size: number): { tex: THREE.DataTexture; x: number; z: number } {
  const N = Math.round(size / m.mapCell) + 3, x = ox - m.mapCell, z = oz - m.mapCell;
  const out = new Uint8Array(N * N * 4), i0 = Math.round((x - m.mapX) / m.mapCell), j0 = Math.round((z - m.mapZ) / m.mapCell);
  for (let j = 0; j < N; j++) out.set(m.map.subarray((j0 + j) * m.mapN * 4 + i0 * 4, (j0 + j) * m.mapN * 4 + (i0 + N) * 4), j * N * 4);
  return { tex: moonMapTexture(out, N), x, z };
}

export function makeMoonGround(tex: THREE.Texture, mapX: number, mapZ: number, mapCell: number, mapN: number, originX: number, originZ: number, size: number, ground?: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...globals,
      ...moonGlobals,
      uBlastRing: blastUniforms.uBlastRing,
      uBlastRing2: blastUniforms.uBlastRing2,
      tGround: { value: null },
      uGroundOn: { value: 0 },
      uGroundLive: blastUniforms.uGroundLive,
      uGroundLive2: blastUniforms.uGroundLive2,
      uGroundTone: blastUniforms.uGroundTone,
      ...(ground ?? {}),
      tMoon: { value: tex },
      uTileRect: { value: new THREE.Vector4(originX, originZ, 1 / size, 0) },
      uMapRect: { value: new THREE.Vector4(mapX, mapZ, 1 / (mapCell * mapN), 0.5 / mapN) },
    },
    vertexShader: NEAR_VS,
    fragmentShader: NEAR_FS,
  });
}

// ---- the far field: clip levels (MoonFar.ts). A block's vertices read their height from the level's atlas, so the mesh is one patch, instanced; a pixel reads its map from the finest level its size on the ground allows.

const FAR_VS = /* glsl */ `
  ${GLSL_COMMON}
  ${GLSL_MOON_CURVE}
  precision highp sampler2DArray;
  uniform sampler2DArray tFarH;
  uniform vec4 uFarGrid; // metres a texel at level 0, texels a block, quads a block, vertices a block
  uniform sampler2D tMask;
  uniform vec4 uMaskRect; // the map's corner, per tile
  uniform vec2 uMaskSize;
  in vec3 aPatch;        // block i, j, level
  out vec3 vWorldPos;
  out vec3 vRound;
  out float vTone;
  flat out float vLevel;
  bool farCovered(vec2 p) {
    ivec2 mc = ivec2(floor((p - uMaskRect.xy) * uMaskRect.z));
    return all(greaterThanEqual(mc, ivec2(0))) && all(lessThan(mc, ivec2(uMaskSize))) && texelFetch(tMask, mc, 0).r > 0.5;
  }
  void main() {
    float L = aPatch.z, cell = uFarGrid.x * pow(2.0, L), quad = cell * uFarGrid.y / uFarGrid.z;
    // (a block's slot in the atlas: blocks wrap, eight a side)
    ivec2 slot = ivec2(mod(aPatch.xy, 8.0));
    ivec2 t = slot * int(uFarGrid.w) + ivec2(position.xz);
    vec2 ht = texelFetch(tFarH, ivec3(t, int(L)), 0).rg;
    float y = ht.r;
    vTone = ht.g;
    // (a skirt: every block's edge hangs a little wall, for where a coarser level's edge stands off a finer's)
    y -= position.y * cell * 1.5;
    vec3 wp = vec3((aPatch.x * uFarGrid.z + position.x) * quad, y, (aPatch.y * uFarGrid.z + position.z) * quad);
    // Under the tiles the bus has loaded this ground sinks out of the way: a vertex with loaded tiles on every side of it goes down, so the slope to it runs under them, and wherever a tile's edge stands a
    // little lower than this ground there is ground behind it, not the sky through a crack.
    if (L < 3.5 && farCovered(wp.xz + vec2(1.0)) && farCovered(wp.xz - vec2(1.0)) && farCovered(wp.xz + vec2(1.0, -1.0)) && farCovered(wp.xz + vec2(-1.0, 1.0))) wp.y -= 24.0;
    vWorldPos = wp;
    vLevel = L;
    vec3 rolled = moonCurve(wp);
    // (from the sphere's middle, on the sphere that's drawn: what's up here, in the lens's axes)
    vRound = rolled - vec3(cameraPosition.x, -MOON_R, cameraPosition.z);
    gl_Position = projectionMatrix * viewMatrix * vec4(rolled, 1.0);
  }
`;

const FAR_FS = /* glsl */ `
  ${GLSL_COMMON}
  ${GLSL_MOON_LIGHT}
  ${GLSL_MOON_PAINT}
  ${GLSL_BLAST_RING}
  uniform sampler2DArray tFarM;
  uniform vec4 uFarGrid;
  uniform float uFarLevels;
  uniform float uFarBias;
  uniform vec4 uFarRects[${FAR.HIGH_LEVELS}]; // each level's window, in from its edge
  uniform float uFarShow; // the dissolve from the ray-drawn Moon: 0 none of this, 1 all of it
  uniform float uFarHigh; // how much of the light is the ray-drawn Moon's, 1 up there, 0 by the ground
  uniform vec4 uFarEarth; // Earth, in the lens's axes; earthshine's strength in steps
  in vec3 vWorldPos;
  in vec3 vRound;
  in float vTone;
  flat in float vLevel;
  ${GLSL_OUT}
  vec2 farMap(float L) {
    float cell = uFarGrid.x * pow(2.0, L);
    return texture(tFarM, vec3((vWorldPos.xz / cell + 0.5) / (8.0 * uFarGrid.y), L)).rg;
  }
  // (a level's last texels would filter into its other side: it is a torus in the store)
  float farInside(float L) {
    for (int i = 0; i < 3; i++) {
      vec4 r = uFarRects[int(L)];
      if (all(greaterThanEqual(vWorldPos.xz, r.xy)) && all(lessThanEqual(vWorldPos.xz, r.zw))) break;
      if (L >= uFarLevels - 1.0) break;
      L += 1.0;
    }
    return L;
  }
  void main() {
    // Coming down from orbit the ray-drawn Moon stands under this in the sky branch, and the mesh comes in over it by a dither, a pixel at a time. A pixel it leaves out says "sky", with no discard: nothing here costs a tile GPU its early depth.
    if (uFarShow < 1.0) {
      const float M[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
      ivec2 c = ivec2(gl_FragCoord.xy) & 3;
      if ((M[c.y * 4 + c.x] + 0.5) / 16.0 >= uFarShow) {
        gBuf = uvec4(0u);
        return;
      }
    }
    // the finest level a pixel's size on the ground can read without crawling
    // (not the long axis alone: at a grazing view that would blur what the short axis can still read)
    float pa = length(dFdx(vWorldPos.xz)), pb = length(dFdy(vWorldPos.xz));
    float px = pow(max(pa, pb), 0.65) * pow(max(min(pa, pb), 0.001), 0.35);
    float want = clamp(log2(max(px, 0.001) / uFarGrid.x) + uFarBias, vLevel, uFarLevels - 1.0);
    float L0 = farInside(floor(want)), f = max(want - L0, 0.0);
    vec2 m = farMap(L0);
    if (f > 0.02 && L0 < uFarLevels - 1.0) m = mix(m, farMap(L0 + 1.0), f);
    float under = moonDecode(m.g);
    // (out of the Sun the byte is the fill, as the near ground has it: gen.ts, fillByte. Or the lee of a mountain is a flat black hole in the picture)
    float light = uMoonLight.y + 0.03 + (under > 0.0 ? 0.1 * m.r * m.r : moonShoulder(uMoonLight.x * m.r * m.r * ${LIT_MAX.toFixed(1)}));
    float ramp = moonRamp(vTone), glow = 0.0;
    // Up where the two meet this is the same light as the resolve's spaceMoon, on the same ramp, with the shape of the ground as what the map has baked of it: the two pictures are the same tone wherever the Sun stands, and the terminator comes
    // where it comes. It goes over to the ground's own on the way down.
    if (uFarHigh > 0.0) {
      vec3 nr = normalize(vRound);
      vec3 vv = normalize(vec3(0.0, cameraPosition.y + 1737400.0, 0.0) - vRound);
      float mu = dot(nr, uSunDir), t = vTone;
      float shape = under > 0.0 ? 0.3 * m.r * m.r : m.r * m.r * ${LIT_MAX.toFixed(1)} / (${LIT_TONE0.toFixed(2)} + ${LIT_TONE1.toFixed(2)} * t);
      float level = max(dot(nr, uFarEarth.xyz), 0.0) * uFarEarth.w * (0.2 + 1.1 * t) + 0.25;
      if (mu > 0.0) level = max(level, (0.35 + 0.65 * t) * min(2.0 * mu / (mu + max(dot(nr, vv), 0.0) + 0.001), 1.05) * 7.0 * shape);
      level -= max(level - 5.2, 0.0) * 0.45;
      light = mix(light, level / 7.0, uFarHigh);
      const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
      ivec2 c = ivec2(gl_FragCoord.xy) & 3;
      if ((B[c.y * 4 + c.x] + 0.5) / 16.0 < uFarHigh) ramp = ${Ramp.MOON}.0;
    }
    float pr, pEdge, pLift, pGlow;
    float site = moonSite(vWorldPos.xz, pa + pb);
    if (site > 0.5) {
      if (site > 1.5) light = max(light, 0.52);
    } else if (moonClip(vWorldPos.xz, pow(max(pa, pb), 0.6) * pow(max(min(pa, pb), 0.001), 0.4), pr, pEdge, pLift, pGlow)) {
      ramp = pr;
      light = moonPaintLight(pr, light, pEdge, pLift, 0.0);
      glow = pGlow;
      light = max(light, glow);
    }
    float gl = moonGlint(vWorldPos.xz, pa + pb);
    if (gl > 0.5) {
      if (gl > 1.5) { ramp = ${Ramp.GLOW_WHITE}.0; light = 0.95; glow = 0.8; }
      else light = max(light + 0.22, 0.62);
    }
    float rr, rl, rg;
    if (sbRing(vWorldPos, vec3(0.0, 1.0, 0.0), rr, rl, rg)) { ramp = rr; light = rl; glow = rg; }
    sbWrite(ramp, light, 0.0, glow, mat3(viewMatrix) * vec3(0.0, 1.0, 0.0), 0.01, 1.0);
  }
`;

export function makeMoonFar(tFarH: THREE.Texture, tFarM: THREE.Texture, mask: THREE.Texture, maskRect: THREE.Vector4, maskSize: THREE.Vector2, grid: THREE.Vector4, levels: number, rects: THREE.Vector4[]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...globals,
      ...moonGlobals,
      uBlastRing: blastUniforms.uBlastRing,
      uBlastRing2: blastUniforms.uBlastRing2,
      tFarH: { value: tFarH },
      tFarM: { value: tFarM },
      tMask: { value: mask },
      uMaskRect: { value: maskRect },
      uMaskSize: { value: maskSize },
      uFarGrid: { value: grid },
      uFarLevels: { value: levels },
      uFarRects: { value: rects },
      uFarBias: { value: -0.5 },
      uFarShow: { value: 1 },
      uFarHigh: { value: 0 },
      uFarEarth: { value: new THREE.Vector4() },
    },
    vertexShader: FAR_VS,
    fragmentShader: FAR_FS,
  });
}
