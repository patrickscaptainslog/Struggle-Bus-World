import { config } from '../config';

// The held hour: docs/specs/sky/SKY.md, slice S1. ?hour=blue puts the whole game under one held blue hour; there is no clock behind it.
// The live sky: docs/specs/sky/LIVE.md, S2. The real Sun over the city now, on by default; its nights are the held hour's, raised at sunset (LiveSky.ts).
//
// Flag off is the law: no new fetch, no new program, no shader source that differs by a byte from what it was. So everything GLSL the hour adds
// goes through held() or heldOr(), read once as the modules load. A material never asks at run time, because there is nothing to ask: without the
// flag its source doesn't hold the question. What the flag decides is fixed for the page: config.sky's switches, in the tuner, only ever turn
// parts of the hour back to the day's. ?sky=off, or config.sky.live off before the page loads, is the flag off: today's day exactly.

/** (No `location` where a tool runs a game module in node: no flag there.) */
const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;

/** ?hour=blue. */
export const heldHour = query?.get('hour') === 'blue';

/**
 * ?moonrun: the test flight of MOONSHOT.md, stop 1. Space only: no city, the real pipeline and resolve, the real sky. The same law as the held hour: flag off, no fetch and no shader
 * byte differs. Its module (src/sky/moonrun.ts) is a chunk of its own, and index.html starts no city downloads under it.
 */
export const moonrun = typeof location !== 'undefined' && new URLSearchParams(location.search).has('moonrun');

/**
 * ?moon: the Moon as a place the real game loads, low over its ground (src/moon/). The same law: flag off, no fetch and no shader byte differs. What it has of the sky is ?moonrun's, so the space code's GLSL
 * compiles for either; the ground's programs are its own, in a chunk of their own, and index.html starts no city downloads under it.
 */
export const moonLow = typeof location !== 'undefined' && (new URLSearchParams(location.search).has('moon') || new URLSearchParams(location.search).has('moonland'));

/**
 * ?moonland: the one link. Earth orbit to Moon orbit as ?moonrun flies it, and a thumb's push takes the bus down from there to the ground ?moon flies over, on one page, with no reload and no fade. It's ?moon to everything that asks
 * (its programs, its files), and the flight's own loop starts first, so the page is up as fast as ?moonrun's; src/moon/Landing.ts is what joins them.
 */
export const moonLand = typeof location !== 'undefined' && new URLSearchParams(location.search).has('moonland');

/**
 * ?earth: the street with the flight booted behind it, one page from the ground up past satellite height, and the whole Earth flown freely (docs/specs/earth/EARTHFLIGHT.md, E2). The same law as the others: flag off,
 * no fetch and no shader byte differs. Under it the space branch is compiled into the street's resolve, and a uniform (uSpaceOn) keeps it off until height brings it in.
 */
export const earthFly = typeof location !== 'undefined' && new URLSearchParams(location.search).has('earth') && !moonLow && !moonrun;

/** The page change in the long dark between Earth's page and the Moon's (docs/specs/earth/EARTHFLIGHT.md, E3): the trip and its view, and the frame held on the screen (index.html reads that key by its own name). */
export const SWAP_KEY = 'strugglebus.swap.v1';
export const SWAP_FRAME = 'strugglebus.swap.frame.v1';

/** ?earth&resume with a trip saved by the Moon's page: the flight boots first, and the street behind it (main.ts, bootEarthResumed). */
export const earthResume =
  earthFly &&
  new URLSearchParams(location.search).has('resume') &&
  (() => {
    try {
      return !!sessionStorage.getItem(SWAP_KEY);
    } catch {
      return false;
    }
  })();

/** The live sky: on unless ?sky=off or config.sky.live says so. The held hour holds its own hour instead. It's the street's: the Moon's pages (?moon, ?moonland, ?moonrun) have their own sky, and no San Francisco Sun. */
export const skyLive = !!query && !heldHour && !moonLow && !moonrun && query.get('sky') !== 'off' && config.sky.live;

/** What the hour's GLSL compiles for: the held hour, or the live sky, whose nights are that hour. */
export const skyOn = heldHour || skyLive;

let up = heldHour ? 1 : 0;
/** How far the hour is up, 0..1: always 1 under ?hour=blue; the live sky's blend, from 0 at sunset (the Sun 1.5 degrees up) to 1 at blue hour (-5), and back at dawn. */
export const hourK = (): number => up;
/** The hour is up at all. */
export const hourUp = (): boolean => up > 0;
/** (LiveSky's, once a frame) */
export const setHourUp = (v: number): void => {
  up = v;
};
/** The day's number, or the hour's as far as the hour is up. `on`: the tuner's switch, off the day's. What reads config.sky's numbers asks this. */
export const byHour = (day: number, hour: number, on: unknown = true): number => (on ? day + (hour - day) * up : day);

/** GLSL only the hour compiles. Put it at the end of a line: without the flag it is nothing, and the line is the line it always was. */
export const held = (glsl: string): string => (skyOn ? glsl : '');

/** One word of GLSL or the other: a number that becomes a uniform under the hour, say. */
export const heldOr = (glsl: string, day: string): string => (skyOn ? glsl : day);

/** ?life: the living Earth's movers (docs/specs/earth/LIVING.md, LIFE.md; CONTRACT.md O13): on Earth's pages only, and the default only on the producer's word. Flag off, nothing
 *  of it is fetched or compiled: its chunk is imported under the flag alone (main.ts). */
export const lifeOn = !!query?.has('life') && !moonLow && !moonrun;

/** GLSL only ?moonrun, ?moon and ?earth compile. */
export const space = (glsl: string): string => (moonrun || moonLow || earthFly ? glsl : '');

/**
 * The flat map rolled onto its sphere around the lens, so the ground falls away and has a horizon. Bearings and distances from the lens hold, which is all a horizon asks. Written so that float32 keeps it near the
 * lens: no radius minus a radius. Only clip positions take this: everything that asks where a pixel is on the ground reads the flat map. (The radius is map.ts's R_M.)
 */
export const GLSL_MOON_CURVE = /* glsl */ `
const float MOON_R = 1737400.0;
vec3 moonCurve(vec3 wp) {
  vec2 d = wp.xz - cameraPosition.xz;
  float s = length(d);
  float th = s / MOON_R;
  float sh = sin(0.5 * th);
  // (height y over the sphere, so the true radius is MOON_R + y)
  float y = wp.y * cos(th) - 2.0 * MOON_R * sh * sh;
  float pull = th > 1e-6 ? (wp.y * sin(th) + MOON_R * (-th * th * th / 6.0 + th * th * th * th * th / 120.0)) / s : 0.0;
  return vec3(wp.x + d.x * pull, y, wp.z + d.y * pull);
}
`;

/** What ?moon painted from low down that's big enough to see from orbit: [lat, lon, level, seed, km]. src/moon/CraterPaint.ts writes it, src/sky/MoonPaint.ts reads it. */
export const MOON_LOW_KEY = 'strugglebus.moon.low.v1';
/** The byte on the orbit's map that says one of those stands on this texel: MoonPaint.ts writes it, the map's readers (render/skyResolve.ts) leave it out on the ground. */
export const LOW_MARK = 255;

/** GLSL only ?moon compiles. */
export const moonOnly = (glsl: string): string => (moonLow ? glsl : '');

/** GLSL only ?moonland compiles. */
export const landOnly = (glsl: string): string => (moonLand ? glsl : '');
