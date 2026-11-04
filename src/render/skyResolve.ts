import * as THREE from 'three';
import { heldGlobals } from './materials';
import { Ramp } from './palette';

// The resolve's sky under the held hour (?hour=blue, SKY.md 4.1): the gradient alone. No Sun, Moon, stars or clouds yet; what is drawn is 16 bands in four rows
// of the live table, far side and sun side, so any table can colour the sky. Height comes from dir.y, never a stored elevation. All of it is plain sky: alpha 0,
// and the dither is `dsk`, anchored to the screen, because the sky only turns with the view and the snap's grid would slide through its bands.

export const heldResolveUniforms = {
  uSkyRows: { value: new THREE.Vector4(-1, 0, 0, 0) }, // far side low and high, sun side low and high (x under 0: the day's sky)
  uSkySun: { value: new THREE.Vector3(1, 0, 3) }, // the sun's azimuth, a unit vector in xz; how fast the sun side falls away with it (a power)
  uSkyHaze: heldGlobals.uSkyHaze,
  uSkySunDir: heldGlobals.uSkySunDir,
  uSunDisc: { value: new THREE.Vector4(0, 0, 0, -1) }, // the live sky's Sun: its centre in buffer px (a pixel's centre), radius in px, the ring's row (under 0: no disc)
  uSkyWarm: { value: new THREE.Vector2(1, 1) }, // how much sun side there is: the day sky's warm band toward its azimuth (a low sun's, none at noon or at night), the bands' bend (gone by deep night)
  uFogLuma: { value: new THREE.Vector2(0.3955, 0.071) }, // FOG's luma: step 0, per step (the value-matched handover reads it from the live table)
  uBeamGain: { value: 2.6 }, // steps the headlight lifts at most
  uPaintCap: { value: 7 }, // the step paint stays at or under, outside a glint
};

export const GLSL_SKY_HELD_UNIFORMS = /* glsl */ `
uniform vec4 uSkyRows;
uniform vec3 uSkySun;
uniform vec4 uSunDisc;
uniform vec2 uSkyWarm;
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
  if (l > 1e-3) t = mix(t, alt, pow(max(0.5 + 0.5 * dot(dir.xz, uSkySun.xy) / l, 0.0), uSkySun.z) * uSkyWarm.y);
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

// The Sun's disc (SKY.md 4.1), a circle test on the buffer's pixels: GLOW_WHITE 7, one ring of SKY_WARM 7, TWILIGHT when low. The centre is a pixel's centre, so
// the disc holds its shape and moves a whole pixel at a time. Plain sky, alpha 0: the bus, the city and the far field cover it.
export const GLSL_SUN_DISC = /* glsl */ `
    if (uSunDisc.w >= 0.0) {
      vec2 q = gl_FragCoord.xy - uSunDisc.xy;
      float r2 = dot(q, q);
      if (r2 < uSunDisc.z * uSunDisc.z) sc = pal(${Ramp.GLOW_WHITE}.0, 7.0);
      else if (r2 < (uSunDisc.z + 1.0) * (uSunDisc.z + 1.0)) sc = pal(uSunDisc.w, 7.0);
    }`;

const discV = new THREE.Vector3();

/**
 * The disc's uniform from the camera the buffer was drawn with: `dir` the sky's Sun (world, unit), `rad` its angular radius, W x H the buffer. No disc behind
 * the lens or more than its size off the frame. A pixel's angle is the frame centre's: the disc is 9 px at most, nothing off-axis shows in that.
 */
export function sunDisc(cam: THREE.PerspectiveCamera, dir: THREE.Vector3, rad: number, ringRow: number, W: number, H: number, out: THREE.Vector4): void {
  const v = discV.copy(dir).transformDirection(cam.matrixWorldInverse);
  if (ringRow < 0 || v.z > -1e-3) {
    out.w = -1;
    return;
  }
  const r = (rad * cam.projectionMatrix.elements[5] * H) / 2;
  v.applyMatrix4(cam.projectionMatrix);
  const x = (v.x * 0.5 + 0.5) * W, y = (v.y * 0.5 + 0.5) * H;
  if (x < -r - 2 || y < -r - 2 || x > W + r + 2 || y > H + r + 2) {
    out.w = -1;
    return;
  }
  out.set(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.max(1, r), ringRow);
}
