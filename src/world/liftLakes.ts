import { FACTION_ATLANTIS, FACTION_ELDERWOOD, FACTION_HYPERGLOW } from '../game/factions';
import { Ramp } from '../render/palette';

// The Lift's lake in the other four factions (docs/specs/factions/LIFT.md, "Stage 4 in the other factions"): the terrain's shader carries it
// under ?lift only (liftGlsl's lifted()), so a page without the flag draws what it drew.

const R = (r: number) => r.toFixed(1);

/**
 * GLSL: the lake under the other four factions' floating houses (liftGlsl's sbLake hands them here, Rainbow's stays its own): Atlantis's open sea,
 * deep teal over a sunlit floor, foam on the swell's crests; the Elderwood's lotus marsh, dark moss water veined with glowing roots, lily pads and
 * violet flowers; Hyperglow's black mirror under a cyan grid, magenta pulses running out along it from under each house; Inferno's lake of fire,
 * molten gold and orange between drifting floes of black glass. `shore` is the distance in from the lake's edge (m), `sw` the swell here, `hv`
 * the heave under the house above, `dj` the distance from its centre `c`. Palette rows only. Needs GLSL_FACTION and GLSL_LIFT.
 */
export const GLSL_LAKE_LOOKS = /* glsl */ `
float sbLkH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
bool sbLakeOf(int fac, vec3 wp, float flatL, float shore, float sw, float hv, float dj, float idx, vec2 c, out float ramp, out float light, out float glow) {
  float L0 = max(0.17 + uGroundTone.x + flatL * 0.5, 0.36);
  vec2 d = wp.xz - c;
  if (fac == ${FACTION_ATLANTIS}) {
    // the sea come ashore: deep teal, the sun's net of light on its floor, foam on the swell's crests and rings, a foam shore
    ramp = ${R(Ramp.TEAL)};
    light = L0 - 0.06 + 0.07 * sw;
    glow = 0.32;
    vec2 q = wp.xz * 0.33;
    float c1 = sin(q.x + 1.7 * sin(q.y * 0.71 + uTime * 0.9) + uTime * 1.1);
    float c2 = sin(q.y * 1.13 + 1.6 * sin(q.x * 0.83 - uTime * 0.8) - uTime * 0.95);
    float e = abs(c1 + c2);
    if (e < 0.14) { light += 0.22; glow = 0.5; }
    else if (e < 0.42) light += 0.08;
    float ring = fract(dj / 2.4 - 0.9 * uTime - 0.5 * hv + idx * 0.37);
    if (ring < 0.07) { ramp = ${R(Ramp.PEARL)}; light += 0.12; }
    if (sw > 0.78 && sbLkH(floor(wp.xz / 1.8)) > 0.35) { ramp = ${R(Ramp.WHITE)}; light = 0.8; glow = 0.4; }
    if (shore < 1.9) { ramp = ${R(Ramp.WHITE)}; light = shore < 0.9 ? 0.62 : 0.84; glow = 0.35; }
    return true;
  }
  if (fac == ${FACTION_ELDERWOOD}) {
    // the lotus marsh: still dark water, glowing roots running through it, lily pads riding the swell, violet flowers, a fringe of silver stones
    ramp = ${R(Ramp.MOSS)};
    light = L0 - 0.16 + 0.04 * sw;
    glow = 0.15;
    vec2 q = wp.xz * 0.16;
    float v = abs(sin(q.x + 1.3 * sin(q.y * 0.8 + 0.3)) + sin(q.y * 1.1 + 1.2 * sin(q.x * 0.7)));
    float pulse = 0.5 + 0.5 * sin(uTime * 1.6 - dj * 0.35);
    if (v < 0.07 + 0.03 * pulse) { light = 0.78 + 0.12 * pulse; glow = 0.45 + 0.2 * pulse; }
    vec2 cell = floor(wp.xz / 6.0), f = fract(wp.xz / 6.0) - 0.5;
    float h = sbLkH(cell);
    vec2 o = vec2(sbLkH(cell + 7.1), sbLkH(cell + 3.3)) * 0.3 - 0.15 + 0.02 * vec2(sin(uTime * 0.6 + h * 9.0), cos(uTime * 0.5 + h * 7.0));
    float r = length(f - o);
    float notch = abs(atan(f.y - o.y, f.x - o.x) - (h - 0.5) * 6.0);
    if (h > 0.45 && r < 0.21 + 0.1 * h && notch > 0.35) {
      ramp = ${R(Ramp.MOSS)};
      light = 0.5 + 0.08 * sw;
      glow = 0.1;
      if (h > 0.85 && r < 0.07) { ramp = ${R(Ramp.VIOLET)}; light = 0.72; glow = 0.35; }
      else if (fract(r * 22.0) < 0.15) light -= 0.1;
    }
    if (sbLkH(floor(wp.xz / 2.0) + floor(uTime * 1.5)) > 0.997) { ramp = ${R(Ramp.YELLOW)}; light = 0.92; glow = 0.8; }
    if (shore < 1.9) { ramp = ${R(Ramp.PEARL)}; light = 0.42 + 0.2 * sbLkH(floor(wp.xz / 1.2)); glow = 0.05; }
    return true;
  }
  if (fac == ${FACTION_HYPERGLOW}) {
    // the black mirror: dark chrome under a cyan grid, square ripples snapping out from under each house, magenta pulses running out along the grid
    ramp = ${R(Ramp.CHROME)};
    light = 0.06 + 0.05 * sw;
    glow = 0.08;
    vec2 g = abs(fract(wp.xz / 12.0) - 0.5);
    float line = min(g.x, g.y);
    float sq = max(abs(d.x), abs(d.y));
    float ripple = fract(sq / 6.0 - floor(uTime * 2.0) * 0.25);
    if (line < 0.03) {
      ramp = ${R(Ramp.CYAN)};
      light = 0.66;
      glow = 0.5;
      if (fract(sq / 24.0 - uTime * 0.9 + idx * 0.13) < 0.12) { ramp = ${R(Ramp.MAGENTA)}; light = 0.9; glow = 0.75; }
    } else if (ripple < 0.06 && sq < 40.0) { ramp = ${R(Ramp.CYAN)}; light = 0.4; glow = 0.3; }
    else if (sw > 0.6) light += 0.06;
    if (shore < 1.2) { ramp = ${R(Ramp.MAGENTA)}; light = 0.8; glow = 0.6; }
    return true;
  }
  // Inferno: the lake of fire, floes of black glass drifting on it with the swell, molten gold in the cracks between, the fire throbbing
  vec2 p = wp.xz / 10.0 + 0.04 * vec2(uTime, uTime * 0.7) + 0.08 * sw;
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 9.0, f2 = 9.0, open = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 k = vec2(float(i), float(j));
      vec2 r = k + vec2(sbLkH(ip + k), sbLkH(ip + k + 5.3)) - fp;
      float dd = dot(r, r);
      if (dd < f1) { f2 = f1; f1 = dd; open = sbLkH(ip + k + 9.7); }
      else if (dd < f2) f2 = dd;
    }
  float crack = sqrt(f2) - sqrt(f1);
  float beat = pow(max(0.0, sin(uTime * 2.4)), 8.0);
  ramp = ${R(Ramp.OBSIDIAN)};
  light = 0.16 + 0.1 * sw;
  glow = 0.05;
  if (open < 0.22 || crack < 0.1) { ramp = ${R(Ramp.ORANGE)}; light = 0.82 + 0.08 * beat; glow = 0.65; }
  if (crack < 0.05) { ramp = ${R(Ramp.YELLOW)}; light = 0.94; glow = 0.85; }
  else if (open < 0.22 && sbLkH(floor(wp.xz / 4.0) + floor(uTime * 2.0)) > 0.85) { ramp = ${R(Ramp.CRIMSON)}; light = 0.72; }
  float ring = fract(dj / 3.0 - 1.4 * uTime - 0.6 * hv);
  if (ring < 0.08 && open >= 0.22 && crack >= 0.1) { ramp = ${R(Ramp.CRIMSON)}; light = 0.6 + 0.2 * beat; glow = 0.35; }
  if (shore < 1.4) { ramp = ${R(Ramp.CRIMSON)}; light = 0.66; glow = 0.45; }
  return true;
}
`;
