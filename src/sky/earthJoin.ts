// The heights of the street's join with the flight under ?earth (docs/specs/earth/EARTHFLIGHT.md, E2), in a module of their own: main.ts reads them, and with no flag the street's chunk holds nothing of the flight.

/** km over the ground: the flight takes the bus climbing, and gives it to the street coming down under H_GROUND, as at the Moon. */
export const H_UP = 15;
export const H_GROUND = 14;
/** The street's sky turns space's from SKY_FROM to SKY_TOP (km over the ground), and its ground goes into the plain Earth from SKY_TOP to H_UP, from the horizon in. */
export const SKY_FROM = 8;
export const SKY_TOP = 11;
/** m: the nearest the street's ground goes to the plain Earth, past the bus (it's 270 m from the lens up there). */
export const CUT_NEAR = 1500;
/** The street's ceiling under ?earth, m over the sea: over H_UP, so a gear's soft ceiling doesn't take the climb off it first (the Moon's low game has the same, UP_CEILING). */
export const EARTH_CEILING = 24000;
