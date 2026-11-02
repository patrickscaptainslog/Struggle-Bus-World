import * as THREE from 'three';
import { LOW_MARK } from '../sky/flag';
import { SLOPE_MAX, TILE, TILE_KM_A, TILE_KM_B } from '../sky/groundSize';
import { heldGlobals } from './materials';
import { Ramp } from './palette';

// The resolve's sky under the held hour (?hour=blue, SKY.md 4.1): the gradient alone. No Sun, Moon, stars or clouds yet; what is drawn is 16 bands in four rows
// of the live table, far side and sun side, so any table can colour the sky. Height comes from dir.y, never a stored elevation. All of it is plain sky: alpha 0,
// and the dither is `dsk`, anchored to the screen, because the sky only turns with the view and the snap's grid would slide through its bands.

export const heldResolveUniforms = {
  uSkyRows: { value: new THREE.Vector4(-1, 0, 0, 0) }, // far side low and high, sun side low and high (x under 0: the day's sky)
  uSkySun: { value: new THREE.Vector3(1, 0, 3) }, // the sun's azimuth, a unit vector in xz; how fast the sun side falls away with it (a power)
  uSkyHaze: heldGlobals.uSkyHaze,
  uFogLuma: { value: new THREE.Vector2(0.3955, 0.071) }, // FOG's luma: step 0, per step (the value-matched handover reads it from the live table)
  uBeamGain: { value: 2.6 }, // steps the headlight lifts at most
  uPaintCap: { value: 7 }, // the step paint stays at or under, outside a glint
};

export const GLSL_SKY_HELD_UNIFORMS = /* glsl */ `
uniform vec4 uSkyRows;
uniform vec3 uSkySun;
uniform vec2 uFogLuma;
uniform float uBeamGain;
uniform float uPaintCap;`;

export const GLSL_SKY_HELD = /* glsl */ `

// The far side's rows and the sun side's are one sky. Art's two gradients read against each other, the far side at height a is the sun side's colour at 8.2 + 8.2 sqrt(a + .5),
// so t, a height on the sun side's scale, slides between the two with the azimuth: under the sun it is the height, opposite it the far side's. The sky's own bands
// bend down toward the sun, and that bend is the glow, with nothing laid over them (SKY.md 4.1). Under 14 t reads the sun side's rows; from there, back on the far side's
// scale, the far side's, where the colours meet, so the rows hand over with no seam. (Near the zenith dir.xz is 0: a guard, the far side.)
vec3 skyBands(vec3 dir, float dsk) {
  float alt = max(dir.y, 0.0) * 57.3;
  float l = length(dir.xz);
  float t = 8.2 + 8.2 * sqrt(alt + 0.5);
  if (l > 1e-3) t = mix(t, alt, pow(max(0.5 + 0.5 * dot(dir.xz, uSkySun.xy) / l, 0.0), uSkySun.z));
  bool sun = t < 14.0;
  if (sun) alt = t;
  else {
    alt = (t - 8.2) / 8.2;
    alt = max(alt * alt - 0.5, 0.0);
  }
  // (the band: research-art.md's ALTS to within 0.2 degrees up to its tenth band, most of them in the 6 degrees a street frame holds, and tighter over that: a formula, no loop)
  float p = 6.31 * log(1.0 + alt / 2.43);
  float i = floor(p);
  float b = min(15.0, i + (clamp((p - i - 0.38) / 0.24, 0.0, 1.0) > dsk ? 1.0 : 0.0));
  bool low = b < 7.5;
  return pal(sun ? (low ? uSkyRows.z : uSkyRows.w) : (low ? uSkyRows.x : uSkyRows.y), low ? 7.0 - b : 15.0 - b);
}
`;

// ---- Space (?moonrun, MOONSHOT.md stop 1; SKY.md 2 and 4.5-4.7). Earth and Moon are ray tests in the sky branch: nothing at 384,400 km enters the render frame, no geometry, no draw.
// All alpha 0, dither `dsk` only: the sky only turns with the view. Every colour is pal(ramp, step); light is carried by steps, and the rows are SkyTable.ts's SPACE_ROWS.
//
// The ray tests are the stable form (ENGINE's float32 test): each body at unit radius, so nothing in the shader is in km, with the near root as c / (-b + sqrt D) and c = |o|^2 - 1 from
// the CPU, in double: that subtraction is the one float32 can't do near a surface. Earth is the WGS84 ellipsoid by one scale on z (A/B), since a plain sphere is 5-7 px off near the limb.

/** WGS84's a / b: the one scale on z that makes the ellipsoid a sphere. */
const EARTH_K = (1 / (1 - 1 / 298.257223563)).toFixed(8);

export const spaceResolveUniforms = {
  tEarthMap: { value: null as THREE.Texture | null }, // land, tone, class (0 green, .5 dry, 1 ice), lights
  tMoonMap: { value: null as THREE.Texture | null }, // tone; then the ground: tone, and the real relief's slope, Moon fixed (MoonGround.ts)
  tMoonCraters: { value: null as THREE.Texture | null }, // the invented craters' tile: the height's slope, brightness, rank
  tMoonPaint: { value: null as THREE.Texture | null }, // coverage, mix and two hues, lift, reveal (MoonPaint.ts)
  uEarthRot: { value: new THREE.Matrix3() }, // render <- Earth fixed
  uEarthO: { value: new THREE.Vector4(0, 0, 3, 8) }, // the observer in Earth fixed at unit radius, z over the ellipsoid; w: |o|^2 - 1
  uEarthSun: { value: new THREE.Vector3(1, 0, 0) }, // Earth fixed
  uEarthView: { value: new THREE.Vector4(0, 11, 1, 0.1) }, // the map's lod, the air's scale height (km), the lights' share cap, degrees a pixel at one radius
  uMoonRot: { value: new THREE.Matrix3() }, // render <- Moon fixed
  uMoonO: { value: new THREE.Vector4(0, 0, 200, 40000) }, // the observer in Moon fixed at unit radius; w as above
  uMoonSun: { value: new THREE.Vector3(1, 0, 0) }, // Moon fixed
  uMoonEarth: { value: new THREE.Vector4(1, 0, 0, 0) }, // Earth from the Moon, Moon fixed; w: earthshine's strength, in steps
  uMoonLod: { value: 0 },
  uMoonNear: { value: new THREE.Vector4(0, 0, 0, 0) }, // km a pixel at one radius (0: the tone map alone, nothing near), the relief, the craters, how far they push the map's read
  uMoonLook: { value: new THREE.Vector4(0, 0, 0, 0) }, // the craters' brightness, what they make of a high Sun, the tiles' lod bias, how sharply the seas drop them
  uMoonClose: { value: 0 }, // 1 from the orbit, 0 from about 9,000 km: how much of what's invented is shown
  uMoonAhead: { value: new THREE.Vector4(0, 0, 1, 0) }, // the top of the frame, Moon fixed, a little behind the view: where a crater's own low light comes from; how much of the real relief it lights
  uSunDisc: { value: new THREE.Vector4(1, 0, 0, 1) }, // direction, render frame; cos of its radius
  uSunRing: { value: 1 }, // cos of the radius of its one ring of pixels
  uMoonFirst: { value: 0 }, // 1: the Moon is the nearer: the CPU sorts, so an occultation needs no logic
  uPaintView: { value: new THREE.Vector4(0, 0.5, 0.14, 0.001) }, // the map's lod, the edge's threshold, how far it wobbles, the warp in turns of longitude
  uPaintOn: { value: 0 }, // 1: the map has anything on it, so the ground reads it
  uPaintLive: { value: new THREE.Vector4(-1, 0, 1, 0) }, // this blast: s since its impact (under 0: none), the wave's reach and width (chord at unit radius), its hue
  uPaintAt: { value: new THREE.Vector4(1, 0, 0, 0) }, // where it landed, Moon fixed; w: how far the wave has died, 0..1
  uPaintAim: { value: new THREE.Vector4(1, 0, 0, 0) }, // what a tap hits: Moon fixed; w: its radius (chord), 0: not loaded
  uPaintGlint: { value: new THREE.Vector2(0, 0) }, // loaded: the sweep's place across it, 0..1. On its way (y 1): how much of the flight is left, 1..0
};

/** What's painted on the Moon's map (sky/MoonPaint.ts), as the resolve reads it from orbit and the ground reads it from there all the way down (moon/moonMaterial.ts). */
export const GLSL_MOON_PAINTED_UNIFORMS = /* glsl */ `
uniform highp sampler2D tMoonPaint;
uniform vec4 uPaintView;
uniform vec4 uPaintLive;
uniform float uPaintOn;`;

/** What the Moon's light reads: the resolve, and the mesh where it takes over from the resolve (moon/moonMaterial.ts). */
export const GLSL_MOON_SHADE_UNIFORMS = /* glsl */ `${GLSL_MOON_PAINTED_UNIFORMS}
uniform highp sampler2D tMoonMap;
uniform highp sampler2D tMoonCraters;
uniform mat3 uMoonRot;
uniform vec3 uMoonSun;
uniform vec4 uMoonEarth;
uniform float uMoonLod;
uniform vec4 uMoonNear;
uniform vec4 uMoonLook;
uniform float uMoonClose;
uniform vec4 uMoonAhead;`;

export const GLSL_SPACE_UNIFORMS = /* glsl */ `
uniform highp sampler2D tEarthMap;
uniform mat3 uEarthRot;
uniform vec4 uEarthO;
uniform vec3 uEarthSun;
uniform vec4 uEarthView;
uniform vec4 uMoonO;${GLSL_MOON_SHADE_UNIFORMS}
uniform vec4 uSunDisc;
uniform float uSunRing;
uniform float uMoonFirst;
uniform vec4 uPaintAt;
uniform vec4 uPaintAim;
uniform vec2 uPaintGlint;`;

// Paint on the Moon: MoonPaint.ts's map, read filtered on every Moon pixel and once more, raw, on a painted one: the nearest texel's own bytes, its two hues, the filtered mix picking one, so hues meet on a clean contour and never run through the ones
// between. A crater painted from low down stands on this map at a size orbit can see (a texel or so), more than the place holds: a ground that knows better leaves those marks out.
export const GLSL_MOON_PAINTED = /* glsl */ `

vec2 moonMapUv(vec3 n) { return vec2(atan(n.y, n.x) / 6.28318531 + 0.5, 0.5 - asin(clamp(n.z, -1.0, 1.0)) / 3.14159265); }

// What's painted at a place, false on bare ground. n: unit, Moon fixed. marks: the marks from low down count. Out: its ramp, and the filtered read: r coverage, b lift.
bool moonPainted(vec3 n, vec2 uv, bool marks, out float ramp, out vec4 p) {
  // the edge's wobble: a warp of the lookup, as the ground's is, here by sines of the place: no read. In texels, so a place doesn't wobble more for being near a pole
  vec2 w = vec2(sin(n.y * 37.0 + 1.9 * sin(n.z * 23.0)), sin(n.x * 41.0 + 1.7 * sin(n.y * 29.0)));
  // (and a fine one, a few texels long, as the street's is: the grid the map is read on never shows as a straight line. Each way is pushed by the other, at every longitude: pushed by itself a line only moves, and doesn't bend)
  vec2 f = vec2(sin((n.x + n.z) * 263.0 + 2.1 * sin((n.y - n.z) * 197.0)), sin((n.x + n.y) * 241.0 + 2.3 * sin((n.z - n.x) * 211.0)));
  vec2 at = uv + (w + 0.5 * f) * uPaintView.w * vec2(1.0 / max(length(n.xy), 0.08), 2.0);
  p = textureLod(tMoonPaint, at, uPaintView.x);
  float thr = uPaintView.y + uPaintView.z * sin(n.x * 141.0 + n.y * 117.0 + 2.1 * w.y);
  ramp = 0.0;
  if (p.r <= thr) return false;
  int l = int(uPaintView.x + 0.5);
  vec2 size = vec2(textureSize(tMoonPaint, l));
  ivec4 q = ivec4(texelFetch(tMoonPaint, ivec2(fract(at.x) * size.x, clamp(at.y, 0.0, 0.9999) * size.y), l) * 255.0 + 0.5);
  // (a texel that was settled shows, whatever waits next to it: only fresh ground waits for the wave)
  if (q.a == ${LOW_MARK} ? !marks : q.a != 0 && uPaintLive.x <= p.a * 2.55) return false;
  ramp = ${Ramp.RED}.0 + float((p.g > thr ? q.b : q.g) & 7);
  return true;
}

// The step paint stands on: it keeps the Moon's light and tone and takes them through its own ramp, so craters and maria read through it, and it never goes under a low glow, which keeps the tone too, so it shows on the night side as paint does at dusk, relief and all.
float moonPaintLevel(float ramp, float level, float t, float lift, float art) {
  // (the Moon's steps through the paint's own best stretch: yellow's body sits a step up its ramp, as fxTune has it)
  float y = ramp == ${Ramp.YELLOW}.0 ? 0.7 : 0.0;
  float l = max(1.6 + level * 0.5 + lift * 1.2 + y, 1.3 + 1.9 * t + lift * 1.6 + y);
  // (the craters read through it at full strength: a coat of paint doesn't fill a bowl)
  l *= 1.0 + art;
  // (the crown: where the lift is highest, a bright rim)
  return lift > 0.86 ? l + 1.5 : l;
}
`;

/**
 * The Moon's light at a place: its step on the ramp, and what paint needs. The resolve's ray test ends here, and so does the mesh, up where it takes over from the ray test, so the two are one picture.
 * n: the place, unit, Moon fixed. d: the way the ray goes there, unit. hit: how far, in radii. Out: the map's coordinates, the tone, and how much a crater's own light has made of it.
 */
export const GLSL_MOON_SHADE = /* glsl */ `${GLSL_MOON_PAINTED}

// A level on a ramp to a step, with a narrow ordered dither at the step's edge.
float spStep(float s, float dsk) { return clamp(floor(s + 0.5 + (dsk - 0.5) * 0.44), 0.0, 7.0); }

// One size of the crater tile at a place: its slope in the face's axes, and its brightness and rank. Each size turns on the face, so the two never line up, and a face's tiles start somewhere of their own.
vec4 spaceTile(vec2 p, float km, float cs, float sn, float lod, float face, out vec2 s) {
  vec2 q = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y) * ${(1737.4 / TILE).toFixed(5)} / km + face * vec2(0.37, 0.61);
  vec4 c = textureLod(tMoonCraters, q, lod);
  vec2 g = (c.rg - 0.50196) * 2.00787;
  s = vec2(cs * g.x + sn * g.y, cs * g.y - sn * g.x);
  return c;
}

float spaceMoonLight(vec3 n, vec3 d, float hit, float dsk, out vec2 uv, out float t, out float art) {
  uv = moonMapUv(n);
  // ---- near, a pixel of ground is smaller than the map's texel, and what it can't show is invented: the tile at two sizes, on the six faces of a cube, the seam between two a band of dither. km: what a pixel covers here,
  // between across the ray and along it. The sizes go out by that, each by the mip and then by a fade, so a far disc reads none of this and pays for none of it. Two reads, on near Moon pixels alone.
  vec3 lit = n, slope = vec3(0.0), fU = lit, fV = lit;
  vec2 sA = vec2(0.0), sB = sA, at = uv;
  vec4 cA = vec4(0.5, 0.5, 0.5, 1.0), cB = cA;
  float kA = 0.0, kB = 0.0;
  art = 0.0;
  if (uMoonNear.x > 0.0) {
    float lod = log2(hit * uMoonNear.x / sqrt(max(-dot(n, d), 0.05)) / ${TILE_KM_A.toFixed(3)}) + uMoonLook.z;
    kA = 1.0 - smoothstep(1.2, 3.2, lod);
    kB = 1.0 - smoothstep(3.0, 5.0, lod);
    if (kB > 0.0) {
      vec3 an = abs(n);
      float e = (dsk - 0.5) * 0.03, w = 0.0, face = 0.0;
      if (an.z + e > max(an.x, an.y)) { fU = vec3(1.0, 0.0, 0.0); fV = vec3(0.0, 1.0, 0.0); w = n.z; }
      else if (an.y + e > an.x) { fU = vec3(0.0, 0.0, 1.0); fV = vec3(1.0, 0.0, 0.0); w = n.y; face = 2.0; }
      else { fU = vec3(0.0, 1.0, 0.0); fV = vec3(0.0, 0.0, 1.0); w = n.x; face = 4.0; }
      if (w < 0.0) face += 1.0;
      vec2 p = atan(vec2(dot(n, fU), dot(n, fV)), vec2(abs(w)));
      cB = spaceTile(p, ${TILE_KM_B.toFixed(3)}, 0.6967, -0.7174, lod - 2.0, face, sB);
      // (the map's read is pushed about by the big ones, so a sea's shore wanders round craters and a contour of the map's 20 px texels never shows as one)
      at += sB * kB * uMoonNear.w * 0.001;
      if (kA > 0.0) cA = spaceTile(p, ${TILE_KM_A.toFixed(3)}, 0.9323, 0.3616, lod, face, sA);
    }
  }
  vec4 m = textureLod(tMoonMap, at, uMoonLod);
  t = m.r;
  if (uMoonNear.x > 0.0) {
    // the real relief, which comes in as the map's texel passes a pixel or two: it's the terminator's roughness, and the big craters' walls
    vec3 hill = (m.gba - 0.50196) * ${(SLOPE_MAX * 2.00787).toFixed(5)} * uMoonNear.y * (1.0 - smoothstep(1.5, 4.5, log2(hit * uMoonNear.x)));
    lit += hill;
    if (kB > 0.0) {
      // a sea keeps a third of the craters, and of the rest there's only the mark they leave in the tone: a ghost, as a flooded crater is
      float sea = 0.33 + 0.67 * smoothstep(0.2, 0.5, t);
      vec2 s = (sA * kA * smoothstep(cA.a - uMoonLook.w, cA.a + uMoonLook.w, sea) + sB * kB * smoothstep(cB.a - uMoonLook.w, cB.a + uMoonLook.w, sea)) * uMoonNear.z;
      // (the slope points up the hill: a surface leans the other way)
      slope = -(s.x * (fU - n * dot(n, fU)) + s.y * (fV - n * dot(n, fV)));
      t = clamp(t + ((cA.b - 0.50196) * kA + (cB.b - 0.50196) * kB) * uMoonLook.x, 0.0, 1.0);
      // the real Sun lights a crater only while it's low, when the shadows are the point. Higher up, and in earthshine, a slope hardly shows in lunar-Lambert: a crater keeps a low light of its own, from the top of the frame, or
      // with the Sun behind the view every bowl would read as a dome.
      float high = dot(n, uMoonSun), real = (1.0 - smoothstep(0.15, 0.55, high)) * smoothstep(-0.12, -0.02, high);
      art = (1.0 - real) * uMoonLook.y * dot(slope + hill * uMoonAhead.w, uMoonAhead.xyz - n * dot(n, uMoonAhead.xyz));
      // (earthshine leaves two or three steps to work in)
      if (high < 0.0) art *= 1.6;
      lit += slope * real;
    }
  }
  // earthshine, one or two steps over the dark, maria a step under the highlands so a night pass has ground to read, and the floor under the lit side too or the terminator's last steps fall below the night past it. None on the far side.
  // lunar-Lambert: flat at full, falling only near the terminator
  float mu = dot(lit, uMoonSun);
  float level = max(dot(lit, uMoonEarth.xyz), 0.0) * uMoonEarth.w * (0.2 + 1.1 * t) + 0.25;
  if (mu > 0.0) level = max(level, (0.35 + 0.65 * t) * min(2.0 * mu / (mu - dot(n, d) + 0.001), 1.05) * 7.0);
  // (near, the bright highlands come down off the top of the ramp, where a crater has nowhere to go: a slope can lift dark ground a long way, and bright ground only to where it isn't snow)
  level -= kB * uMoonClose * max(level - 5.2, 0.0) * 0.45;
  return min(level * (1.0 + art), max(level, 6.0));
}
`;

export const GLSL_SPACE = /* glsl */ `

// This frame's flash at this pixel, 0..1 (uFlash). The main loop sets it.
float spFlash = 0.0;
${GLSL_MOON_SHADE}

// An integer hash: the same on every GPU. Ground-anchored: it takes cell numbers.
float spHash(vec2 c) {
  uvec2 q = uvec2(ivec2(c) + 1048576);
  uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u);
  h *= 1597334677u;
  return float(h >> 8u) / 16777216.0;
}

// One octave of city lights. A cell lights one pixel, at its corner, so a light stays put on the ground; its chance goes with its area, so the share of pixels lit stays the same as the cell shrinks on screen.
bool spLights(vec2 deg, float size, float px, float share, float want0, inout float st) {
  vec2 q = deg / size;
  vec2 cell = floor(q);
  float w = size / px;
  if (spHash(cell) >= share * w * w || any(greaterThanEqual(q - cell, vec2(1.0 / w)))) return false;
  st = clamp(floor(3.2 + 7.0 * want0 * (0.55 + 0.45 * spHash(cell + vec2(7.0, 0.0)))), 2.0, 7.0);
  return true;
}

bool spaceEarth(vec3 dir, float dsk, out vec3 col) {
  vec3 e = dir * uEarthRot;
  vec3 ds = vec3(e.xy, e.z * ${EARTH_K});
  float A = dot(ds, ds), B = dot(ds, uEarthO.xyz), C = uEarthO.w;
  if (B >= 0.0) return false;
  float D = B * B - A * C;
  if (D <= 0.0) {
    // the air: how high the ray passes over the limb, from D, the stable way, and over what. Lit where the Sun is up at that point of the limb, rose along the terminator.
    float r = sqrt(1.0 - D / A);
    float glow = exp(-(r - 1.0) * 6378.137 / uEarthView.y);
    if (glow < 0.035) return false;
    float mut = dot((uEarthO.xyz - ds * (B / A)) / r, uEarthSun);
    float lit = clamp((mut + 0.12) / 0.24, 0.0, 1.0);
    if (glow * lit <= 0.035) return false;
    col = abs(mut) < 0.07 ? pal(${Ramp.TWILIGHT}.0, spStep(glow * 7.0 * lit + 1.0, dsk)) : pal(${Ramp.LIMB}.0, spStep(glow * 7.2 * (0.35 + 0.65 * lit), dsk));
    return true;
  }
  float t = C / (-B + sqrt(D));
  vec3 P = uEarthO.xyz + ds * t;
  // (the ellipsoid's normal, whose z is the geodetic latitude the maps are in)
  vec3 n = normalize(vec3(P.xy, P.z * ${EARTH_K}));
  float lat = asin(clamp(n.z, -1.0, 1.0));
  float lon = atan(n.y, n.x);
  vec4 m = textureLod(tEarthMap, vec2(lon / 6.28318531 + 0.5, 0.5 - lat / 3.14159265), uEarthView.x);
  float mu = dot(n, uEarthSun);
  float cosi = -dot(n, e);
  float bx = dsk - 0.5;
  bool land = m.r > 0.5;
  bool ice = land && m.b > 0.75;
  bool dry = land && m.b > 0.25;
  // the light falling off toward the terminator; the sea stays dark and the land carries the frame
  float fall = sqrt(clamp((mu + 0.03) / 0.33, 0.0, 1.0));
  float sea = min(0.3 + 3.9 * fall, 4.2);
  float ls = clamp(0.9 + 5.4 * fall * (0.82 + 0.18 * clamp(cosi * 3.0, 0.0, 1.0)) + (m.g - 0.45) * 1.6, 0.0, 7.0);
  float ramp = ${Ramp.OPEN_SEA}.0;
  float st = spStep(sea, dsk);
  if (mu < -0.03) {
    // the night side: everything falls to the dark rows
    ramp = ${Ramp.INK}.0;
    st = 1.0;
    if (ice) { ramp = ${Ramp.GREY}.0; st = 2.0; }
    else if (land) st = clamp(floor(m.g * 1.2 + 3.2 + bx * 0.6), 0.0, 7.0);
  }
  else if (ice) { ramp = ${Ramp.WHITE}.0; st = spStep(clamp((ls - 1.6) * 1.2, 0.0, 7.0), dsk); }
  else if (dry) { ramp = ${Ramp.DRY_LAND}.0; st = spStep(ls, dsk); }
  else if (land) { ramp = ${Ramp.GREEN_GREY}.0; st = spStep(ls, dsk); }
  // the terminator: a dithered veil of rose over what lies under it, strongest just on the night side of the line, gone by 6 degrees
  float veil = pow(clamp(1.0 - abs(mu - 0.015) / (mu > 0.015 ? 0.075 : 0.105), 0.0, 1.0), 1.3);
  if (veil * 0.92 + bx > 0.5) { ramp = ${Ramp.TWILIGHT}.0; st = spStep(clamp((mu + 0.105) / 0.165, 0.0, 1.0) * 6.2 + 0.4, dsk); }
  // haze toward the limb, on the lit side
  float grz = 1.0 - clamp(cosi, 0.0, 1.0);
  grz *= grz;
  grz *= grz * grz;
  if (grz * clamp((mu + 0.05) / 0.3, 0.0, 1.0) + bx * 0.25 > 0.42) { ramp = ${Ramp.LIMB}.0; st = spStep(3.5 + 3.0 * clamp(mu * 2.0, 0.0, 1.0), dsk); }
  if (!land && mu > 0.03) {
    // the Sun on the water
    float glk = clamp((dot(e + 2.0 * cosi * n, uEarthSun) - 0.9965) / 0.0035, 0.0, 1.0);
    if (glk > 0.0) {
      ramp = ${Ramp.OPEN_SEA}.0;
      st = spStep(min(sea + glk * 3.6, 7.0), dsk);
      if (spHash(floor(vec2(lat, lon) * 630.25)) < pow(glk, 2.2) * 0.5) { ramp = ${Ramp.GLOW_WHITE}.0; st = 5.0; }
    }
  }
  if (land && mu < -0.035) {
    // city lights: a texel scattered to single pixels by a hash on the ground, so a lit texel reads as points and never as a block (SKY.md: share x glow stays low on far surfaces)
    // (their own, finer mip: a city is a texel, and averaged into the land around it at the map's mip it would fall under the threshold from 20,000 km up)
    float la = textureLod(tEarthMap, vec2(lon / 6.28318531 + 0.5, 0.5 - lat / 3.14159265), max(uEarthView.x - 1.5, 0.0)).a;
    float nl = la * la;
    float want0 = clamp((nl - 0.17) * 3.4, 0.0, 1.0);
    float want = pow(want0, 1.4) * uEarthView.z;
    // a cell one to two pixels wide where this ray lands, and the octave over it, in whole octaves so both stay on the ground through a climb, and one pixel of a cell lights: a light is a pixel.
    // The share runs from one octave to the next across the climb, so a doubling of the height never shows as the lights dropping or changing all at once
    float px = t * uEarthView.w;
    float oct = log2(px), octF = fract(oct);
    float size = exp2(oct - octF + 1.0);
    vec2 deg = vec2(lat, lon) * 57.2957795;
    if (want0 > 0.25 && bx > 0.1 + 0.42 * smoothstep(0.6, 0.9, uEarthView.z)) { ramp = ${Ramp.LAMP}.0; st = 1.0; }
    if (spLights(deg, size, px, 0.5 * want * (1.0 - octF), want0, st) || spLights(deg, size * 2.0, px, 0.5 * want * octF, want0, st)) ramp = ${Ramp.LAMP}.0;
  }
  col = pal(ramp, st);
  return true;
}

// The paint at a place, as the resolve has it, and on it the glint and the wave. Nothing is ever mixed: the ramp changes, and the step is the same dithered step. The wave is the game's shockwave ring (GroundPaint's sbRing), on the true surface, in chords of
// the unit sphere: only while a blast is blooming.
void spacePaint(vec3 n, vec2 uv, float t, float art, float dsk, inout float ramp, inout float level) {
  float hue;
  vec4 p;
  if (moonPainted(n, uv, true, hue, p)) {
    ramp = hue;
    level = moonPaintLevel(hue, level, t, p.b, art);
  }
  // the glint: what a tap hits. Loaded, its disc a step up, as a glinting roof is, with the sweep going over it and a thin bright rim. A shot on its way: the rim closes on the place it will land
  if (uPaintAim.w > 0.0) {
    float g = length(n - uPaintAim.xyz) / uPaintAim.w;
    if (uPaintGlint.y > 0.5) {
      if (abs(g - uPaintGlint.x) < 0.022 + 0.03 * uPaintGlint.x) { ramp = ${Ramp.GLOW_WHITE}.0; level = 7.0; }
    } else if (g < 1.03) {
      if (g > 0.97) { if (fract((n.x - n.y + n.z) * 70.0) < 0.62) { ramp = ${Ramp.GLOW_WHITE}.0; level = 6.0; } }
      else {
        level += 0.95;
        if (abs(fract((n.x + n.y - n.z) * 26.0) - uPaintGlint.x) < 0.05) level += 1.0;
      }
    }
  }
  if (uPaintLive.x >= 0.0) {
    float x = (uPaintLive.y - length(n - uPaintAt.xyz)) / uPaintLive.z;
    // (it dies by dissolving into pixels, never by fading: sbRing's law)
    if (x >= 0.0 && x < 1.0 && spHash(floor(n.xy * 900.0)) >= uPaintAt.w * uPaintAt.w * 1.15 - 0.15) {
      float band = floor(x * 7.0);
      ramp = band < 0.5 ? ${Ramp.GLOW_WHITE}.0 : ${Ramp.RED}.0 + mod(uPaintLive.w + band - 1.0, 6.0);
      level = band < 0.5 ? 7.0 : 4.5;
    }
  }
}

bool spaceMoon(vec3 dir, float dsk, out vec3 col) {
  vec3 d = dir * uMoonRot;
  float b = dot(uMoonO.xyz, d), c = uMoonO.w;
  // (c under 0: inside it, the ground of ?moon, which draws itself)
  if (b >= 0.0 || c < 0.0) return false;
  float D = b * b - c;
  if (D <= 0.0) return false;
  float hit = c / (-b + sqrt(D));
  vec3 n = normalize(uMoonO.xyz + d * hit);
  vec2 uv;
  float t, art;
  float level = spaceMoonLight(n, d, hit, dsk, uv, t, art);
  float ramp = ${Ramp.MOON}.0;
  spacePaint(n, uv, t, art, dsk, ramp, level);
  // (a blast's flash, as on the street: white-hot at the impact, and everything near it some steps up its own ramp)
  if (spFlash > 0.0) {
    if (spFlash > 0.5 + 0.3 * dsk) ramp = ${Ramp.GLOW_WHITE}.0;
    level += 1.0 + 4.0 * spFlash;
  }
  col = pal(ramp, spStep(level, dsk));
  return true;
}

// The sky at this pixel, nearest first. Stars and sky lines are in the G-buffer with flags 0, so a pixel of theirs is still sky, and the bodies cover them for one fetch.
vec3 spaceSky(ivec2 p, vec3 dir, float dsk) {
  vec3 c;
  if (uMoonFirst > 0.5) {
    if (spaceMoon(dir, dsk, c) || spaceEarth(dir, dsk, c)) return c;
  } else if (spaceEarth(dir, dsk, c) || spaceMoon(dir, dsk, c)) return c;
  float s = dot(dir, uSunDisc.xyz);
  if (s > uSunRing) return pal(s > uSunDisc.w ? ${Ramp.GLOW_WHITE}.0 : ${Ramp.SKY_WARM}.0, 7.0);
  uint g = texelFetch(tG, p, 0).r;
  if ((g & 255u) != 0u) return pal(float(g & 255u), float(g >> 8u));
  return pal(${Ramp.NIGHT_SKY}.0, 1.0);
}
`;
