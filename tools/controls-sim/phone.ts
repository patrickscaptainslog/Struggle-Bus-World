// A physical phone for synthetic deviceorientation events. The phone's attitude is a rotation
// matrix (device -> earth, W3C: earth X east, Y north, Z up; device x right, y up the screen,
// z out of the glass); events carry the W3C Z-X'-Y'' angles with the spec's ranges
// (beta [-180, 180), gamma [-90, 90)), so holding it upright and past upright makes beta / gamma
// flip exactly as a real phone's do.
import * as THREE from 'three';
const D = Math.PI / 180;
export const deg = (r: number) => r / D;

export interface Pose {
  /** how far the screen leans back from upright (deg): 0 = upright facing you, 90 = flat face up, < 0 = top edge toward you past upright */
  lean: number;
  /** left / right tilt about the horizontal axis pointing away from you (deg, + = right edge down) */
  roll: number;
  /** extra pitch about the horizontal right axis (deg, + = top edge away = nose down) */
  pitch: number;
  /** the player turning around (deg about the vertical) */
  yaw: number;
  /** steering-wheel twist about the screen normal (deg, + = clockwise as seen by the player) */
  twist?: number;
  /** screen orientation angle (deg): 0 portrait, 90 landscape (device turned counter-clockwise), 270 the other way */
  screen: number;
}

const M = new THREE.Matrix4();
const A = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** device -> earth rotation for a pose. The player faces north. */
export function attitude(p: Pose, out = new THREE.Matrix4()): THREE.Matrix4 {
  // upright portrait facing the player (beta = 90): device x = east, y = up, z = south (toward the player)
  out.makeRotationX(90 * D);
  // the hold: screen axes vs device axes (landscape = the device turned about its own z)
  M.makeRotationZ(p.screen * D);
  // in the player's frame: lean back about the (screen-)right axis, then twist about the screen normal
  const lean = A.makeRotationX(-(p.lean + p.pitch) * D);
  out.multiply(lean);
  if (p.twist) out.multiply(A.makeRotationZ(-p.twist * D));
  out.multiply(M);
  // world-frame tilts: roll about north (+ = right/east edge down), yaw about up
  out.premultiply(A.makeRotationY(p.roll * D));
  out.premultiply(A.makeRotationZ(p.yaw * D));
  return out;
}

/** W3C deviceorientation angles (deg) for a device -> earth matrix, in the spec's ranges. */
export function w3c(R: THREE.Matrix4): { alpha: number; beta: number; gamma: number } {
  const m = R.elements; // column-major: m[col*4+row]
  const r = (row: number, col: number) => m[col * 4 + row];
  // R = Rz(a) Rx(b) Ry(g): R32 = sin b, R31 = -cos b sin g, R33 = cos b cos g, R12 = -cos b sin a, R22 = cos b cos a
  let b = Math.asin(Math.max(-1, Math.min(1, r(2, 1))));
  let g = Math.atan2(-r(2, 0), r(2, 2));
  let a = Math.atan2(-r(0, 1), r(1, 1));
  if (g >= Math.PI / 2 || g < -Math.PI / 2) {
    // the spec keeps gamma in [-90, 90): the same attitude with beta past +-90
    g = g >= 0 ? g - Math.PI : g + Math.PI;
    b = (b >= 0 ? Math.PI : -Math.PI) - b;
    a += Math.PI;
  }
  if (b >= Math.PI) b -= 2 * Math.PI;
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return { alpha: deg(a), beta: deg(b), gamma: deg(g) };
}

/** Gaussian noise (Box-Muller), seeded. */
export function gauss(seed = 1) {
  let s = seed >>> 0 || 1;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
export { X, Y, Z };
