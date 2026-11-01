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
