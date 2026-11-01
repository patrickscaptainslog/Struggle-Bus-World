import * as THREE from 'three';
import { heldGlobals } from './materials';
import { Ramp } from './palette';

// The resolve's sky under the held hour (?hour=blue, SKY.md 4.1): the gradient alone. No Sun, Moon, stars or clouds yet; what is drawn is 16 bands in four rows
// of the live table, far side and sun side, so any table can colour the sky. Height comes from dir.y, never a stored elevation. All of it is plain sky: alpha 0,
// and the dither is `dsk`, anchored to the screen, because the sky only turns with the view and the snap's grid would slide through its bands.

/** Where each band starts, degrees over the horizon (research-art.md's ALTS): most of them in the 6 degrees a street frame holds. */
const BAND_ALT = [0, 0.45, 0.95, 1.5, 2.15, 2.9, 3.8, 4.9, 6.2, 8, 10.5, 14, 19, 27, 40, 62];

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

const float SKY_BAND[16] = float[16](${BAND_ALT.map((a) => a.toFixed(2)).join(', ')});
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
  int i = 0;
  for (int k = 1; k < 16; k++) if (alt >= SKY_BAND[k]) i = k;
  float e1 = i < 15 ? SKY_BAND[i + 1] : 90.0;
  float f = (alt - SKY_BAND[i]) / (e1 - SKY_BAND[i]);
  int b = min(15, i + (clamp((f - 0.38) / 0.24, 0.0, 1.0) > dsk ? 1 : 0));
  bool low = b < 8;
  return pal(sun ? (low ? uSkyRows.z : uSkyRows.w) : (low ? uSkyRows.x : uSkyRows.y), float(7 - (b & 7)));
}
// (what the day's branch does after its colour, for this one: a halo or a flash over the sky is alpha 1)
vec4 skyHeld(vec3 dir, float dsk, float d2, float flashK) {
  vec3 sc = skyBands(dir, dsk);
  vec3 halo = texture(tGlow, vUv).rgb;
  float hAmt = max(halo.r, max(halo.g, halo.b));
  float skyA = 0.0;
  if (hAmt > 0.1 && hAmt > d2 * 1.1) { sc = haloTint(halo / hAmt); skyA = 1.0; }
  if (uFlash.z > 0.0) { sc = pal(${Ramp.GLOW_WHITE}.0, flashK > 0.45 ? 7.0 : 6.0 + floor(flashK * 2.0)); skyA = 1.0; }
  return vec4(sc, skyA);
}`;
