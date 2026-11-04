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

/** The live sky: on unless ?sky=off or config.sky.live says so. The held hour holds its own hour instead. */
export const skyLive = !!query && !heldHour && query.get('sky') !== 'off' && config.sky.live;

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
