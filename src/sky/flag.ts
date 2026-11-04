// The held hour: docs/specs/sky/SKY.md, slice S1. ?hour=blue puts the whole game under one held blue hour; there is no clock behind it.
//
// Flag off is the law: no new fetch, no new program, no shader source that differs by a byte from what it was. So everything GLSL the hour adds
// goes through held() or heldOr(), read once as the modules load. A material never asks at run time, because there is nothing to ask: without the
// flag its source doesn't hold the question. What the flag decides is fixed for the page: config.sky's switches, in the tuner, only ever turn
// parts of the hour back to the day's.

/** ?hour=blue. (No `location` where a tool runs a game module in node: no flag there.) */
export const heldHour = typeof location !== 'undefined' && new URLSearchParams(location.search).get('hour') === 'blue';

/** GLSL only the held hour compiles. Put it at the end of a line: without the flag it is nothing, and the line is the line it always was. */
export const held = (glsl: string): string => (heldHour ? glsl : '');

/** One word of GLSL or the other: a number that becomes a uniform under the hour, say. */
export const heldOr = (glsl: string, day: string): string => (heldHour ? glsl : day);

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
