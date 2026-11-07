import * as THREE from 'three';

// The Waterfall (docs/specs/shots/BUILT.md, "Step 8"; the extras' plan), behind &falls: a tower hit 40 m up or more runs with paint. Under the flag the struck
// tower's 1.5 m columns run down its walls from the impact, each up to 1.6 times the flood's 55 m/s and a step brighter (wet), over whatever paint it had,
// drying from the top in about 6 s; the drops falling off its edges and the pool at its foot are the caller's (fx/Falls.ts). Four towers run at once, one
// uniform slot each: the building program finds a vertex's slot with four compares (a flat varying), so only those towers' pixels pay for the runs. With
// &falls off nothing here reaches a shader (as pogo.ts's pogoed()): no source differs by a byte.

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
/** &falls, on the street (the Moon has no towers) */
export const fallsOn = !!q && q.has('falls') && !q.has('moon') && !q.has('moonland') && !q.has('moonrun');
/** GLSL only &falls compiles */
export const fallsed = (glsl: string): string => (fallsOn ? glsl : '');

/** The runs: a tower over `tall` m hit `up` m up or more runs; their speed (m/s, the flood's), up to `fast` times it a column, a column's width (m) and the
 *  share of columns that run, how long a wet run takes to dry (s), and the slots. */
export const FALLS = { tall: 40, up: 40, speed: 55, fast: 1.6, col: 1.5, share: 0.62, dry: 6, slots: 4 };

/** uFalls[i]: (the tower's building index, -1 none; the impact's height, m; the game time it struck; the runs' speed, m/s). */
export const fallsUniforms = fallsOn ? { uFalls: { value: Array.from({ length: FALLS.slots }, () => new THREE.Vector4(-1, 0, -1e3, FALLS.speed)) } } : null;

/** The slots as set (QA, tools/feel-sim/s_falls.ts), flag or none. */
export const fallsLast = Array.from({ length: FALLS.slots }, () => ({ index: -1, y: 0, t0: -1e3 }));

/** How long a run from `h` m takes to reach the street at the fastest column (s). */
export const fallTime = (h: number): number => Math.max(0, h) / (FALLS.speed * FALLS.fast);

/** A tower struck at height y (m) at game time t0 runs in slot i. Off the flag, only fallsLast. */
export function setFall(i: number, index: number, y: number, t0: number): void {
  Object.assign(fallsLast[i], { index, y, t0 });
  fallsUniforms?.uFalls.value[i].set(index, y, t0, FALLS.speed);
}

/** Vertex: the slot this building runs in (-1: none). Needs aBld. */
export const GLSL_FALLS_V = /* glsl */ `
uniform vec4 uFalls[${FALLS.slots}];
flat out float vFall;
float sbFallSlot(float idx) {
  float s = -1.0;
  for (int i = 0; i < ${FALLS.slots}; i++) if (abs(idx - uFalls[i].x) < 0.5) s = float(i);
  return s;
}
`;

/** Fragment: a run at facade u (m) and rest height y on a wall: 0 dry, 1 wet, 2 its head. */
export const GLSL_FALLS_F = /* glsl */ `
uniform vec4 uFalls[${FALLS.slots}];
flat in float vFall;
float sbFallH(vec2 p) { return fract(sin(dot(p, vec2(91.7, 263.3))) * 43758.5453); }
float sbFall(float slot, float u, float y, float bIdx) {
  vec4 F = uFalls[int(slot + 0.5)];
  float age = uTime - F.z;
  if (age < 0.0 || y > F.y + 0.5) return 0.0;
  float col = floor(u / ${FALLS.col.toFixed(2)});
  float hc = sbFallH(vec2(col, bIdx));
  if (hc > ${FALLS.share.toFixed(2)}) return 0.0;
  // each column its own speed and a ragged start under the impact; it dries from the top, ${FALLS.dry} s or so after it was wet there
  float v = F.w * (1.0 + ${(FALLS.fast - 1).toFixed(2)} * fract(hc * 7.31));
  float head = F.y - 2.0 * sbFallH(vec2(col, bIdx + 3.0)) - v * age;
  if (y < head) return 0.0;
  if (age - (F.y - y) / v > ${FALLS.dry.toFixed(1)} * (0.7 + 0.6 * sbFallH(vec2(col, bIdx + 5.0)))) return 0.0;
  return y < head + 2.5 ? 2.0 : 1.0;
}
`;
