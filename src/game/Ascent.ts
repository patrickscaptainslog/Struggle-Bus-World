// What height changes, as functions of the height above the nearest surface (m) and nothing else: no latitude, no flat ground, no city.
// Below config.ascent.scaleHeight every one of them is exactly 1, or the old constant. The rates are the ones that carry on to the Moon
// (docs/specs/flight/ASCENT.md): height there is the height over the nearest body, and only the ceiling stands in the way.
import { config } from '../config';

/** The yoke's climb and dive rates (x): in proportion to the height, so the view pulls back at one steady pace at any height. */
export function heightRate(h: number): number {
  return Math.max(1, h / config.ascent.scaleHeight);
}

/** The speeds (x): the ground keeps moving under the bus, and the thumb's range covers an airliner's speed at the airliner's height. */
export function heightSpeed(h: number): number {
  return Math.sqrt(heightRate(h));
}

/** How far past the map's edge the bus may fly at this height before the homing turns it (m). */
export function mapReach(h: number): number {
  const A = config.ascent;
  return Math.min(A.reachMax, 300 + A.reachPerHeight * Math.max(0, h - A.scaleHeight));
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

/** How much further down the view looks at this height (rad): as much as the fade's line has dropped since pitchFrom. */
export function pitchAdd(h: number, base: number): number {
  const from = config.ascent.pitchFrom;
  return h <= from ? 0 : Math.atan2(h, base) - Math.atan2(from, base);
}
