// What height changes, as functions of the height over the nearest surface (m) and nothing else: no latitude, no flat ground, no city.
// The climb and the speeds aren't here: going faster is the turbo gears' job (docs/specs/flight/ASCENT.md).
import { config } from '../config';

/** How far past the map's edge the bus may fly at this height before the homing turns it (m). */
export function mapReach(h: number): number {
  const A = config.ascent;
  return Math.min(A.reachMax, 300 + A.reachPerHeight * Math.max(0, h - A.reachFrom));
}

/** The height the bus holds this far past the map's edge (m). */
export function floorPastMap(d: number): number {
  const A = config.ascent;
  return Math.max(0, d - A.floorFrom) / A.reachPerHeight;
}

/** The near plane at this height (m): depth is spent where the ground is. `base` is the camera's own. */
export function nearPlane(h: number, base: number): number {
  const A = config.ascent;
  return Math.min(A.nearMax, Math.max(base, (h - A.nearFrom) * A.nearPerHeight));
}

/**
 * The far fade's end (m from the lens): it reaches as far along the ground at any height, and up high no further than the land does (`room`, m along the
 * ground from under the lens): past that lies open water where a real place should be. `base` is its end at the ground.
 */
export function fadeEnd(h: number, base: number, room: number): number {
  const A = config.ascent;
  const up = Math.max(0, h - A.nearFrom);
  const t = Math.min(1, up / (A.fadeLandAt - A.nearFrom));
  return Math.hypot(base + (Math.min(base, room + A.fadeLandPast) - base) * t * t * (3 - 2 * t), up);
}

/** How deep the pixel grid may snap at this height (m from the lens): the ground under the screen's center lies far past `base`, the limit near the ground. */
export function snapReach(h: number, base: number): number {
  return base * Math.max(1, h / config.ascent.nearFrom);
}

/** How much further down the view looks at this height (rad): as much as the fade's line has dropped since pitchFrom. */
export function pitchAdd(h: number, base: number): number {
  const from = config.ascent.pitchFrom;
  return h <= from ? 0 : Math.atan2(h, base) - Math.atan2(from, base);
}

/** How far the rig's view pitches down at this height (degrees), and never so far that the horizon leaves the top of a frame with this half field (degrees). vista: how far it does at the bottom of the vista. */
export function viewPitch(h: number, base: number, halfV: number, vista = config.camera.pitchVista): number {
  return Math.max(5, Math.min(60, Math.min(vista + (pitchAdd(h, base) * 180) / Math.PI, halfV - 3)));
}

/** The vista on the Moon (degrees, and the far fade's end, m): there's no fog to hide in, so the view sits lower, with more of the black over the horizon. moon/moonBoot.ts sets the rig to it, and the flight comes down to it. */
export const MOON_VISTA = { elevation: 34, pitch: 19, fade: 3e6 };
