import * as THREE from 'three';

// The Bomb's pogo (src/game/Bomb.ts; docs/specs/shots/SHOTS.md, "The modes": "Houses pogo once for each stage they jump"). Each stage a Bomb jumps a building
// is its own write and pop (Splatter.barf's jump), and the pop starts with a hop: clamp(0.3 x its height, 2, 6) m up and down over POGO.hop s, landing in
// the pop's squash, so a house climbs by hops: its skin, its garden, its crown. Its rooftop garden rides the hop (props/sprouts.ts); its shadow stays put,
// which reads as a jump. Towers over 40 m only squash. One uniform says where the last Bomb's stages are, its circle and their bloom times, and the
// buildings' and the gardens' programs hop what's in it: no new draw or program. With &bomb off nothing here reaches a shader (as liftGlsl's lifted()): no
// source differs by a byte.

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
/** &bomb, on the street (the Moon's craters don't hop) */
export const pogoOn = !!q && q.has('bomb') && !q.has('moon') && !q.has('moonland') && !q.has('moonrun');
/** GLSL only &bomb compiles */
export const pogoed = (glsl: string): string => (pogoOn ? glsl : '');
export const pogoedOr = (glsl: string, off: string): string => (pogoOn ? glsl : off);

/** The hop: its height x the building's, between min and max m; towers over `tower` m only squash; its length (s). */
export const POGO = { k: 0.3, min: 2, max: 6, tower: 40, hop: 0.24 };

/** uBombPogo: the last Bomb's circle (centre x, z, radius m) and its impact's game time (0: none); uBombPogoT: its last stage's bloom time, and the hop's length. */
export const pogoUniforms = pogoOn ? { uBombPogo: { value: new THREE.Vector4() }, uBombPogoT: { value: new THREE.Vector2(0, POGO.hop) } } : null;

/** A Bomb landed (Splatter): the buildings in its circle blooming from `t0` to `t1` (game clock) hop. Off the flag, nothing. */
export function setPogo(x: number, z: number, r: number, t0: number, t1: number): void {
  if (!pogoUniforms) return;
  pogoUniforms.uBombPogo.value.set(x, z, r, Math.max(1e-3, t0));
  pogoUniforms.uBombPogoT.value.set(t1, POGO.hop);
}

/** The hop in m a building's pop starts with (bloom: its paint's bloom time, tb the time since it), and `rest` the pop's own clock after it (tb with none). */
export const GLSL_POGO = /* glsl */ `
uniform vec4 uBombPogo;
uniform vec2 uBombPogoT;
float sbPogo(vec2 at, float bloom, float hgt, float tb, out float rest) {
  rest = tb;
  if (uBombPogo.w <= 0.0 || bloom < uBombPogo.w - 0.01 || bloom > uBombPogoT.x + 0.01 || hgt > ${POGO.tower.toFixed(1)} || distance(at, uBombPogo.xy) > uBombPogo.z) return 0.0;
  rest = tb - uBombPogoT.y;
  if (tb >= uBombPogoT.y) return 0.0;
  float u = max(tb, 0.0) / uBombPogoT.y;
  return clamp(${POGO.k.toFixed(2)} * hgt, ${POGO.min.toFixed(1)}, ${POGO.max.toFixed(1)}) * 4.0 * u * (1.0 - u);
}
`;
