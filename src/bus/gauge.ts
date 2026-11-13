import { FACTION_ATLANTIS, FACTION_ELDERWOOD, FACTION_HYPERGLOW, FACTION_INFERNO, FACTION_RAINBOW, FACTIONS } from '../game/factions';
import { HUE_RAMPS, Ramp } from '../render/palette';

// The gauge wears the crew. The belly band's 24 slices and the rear bar's six cells are the game's only gauge (BusModel): how full the belly is. On a bus
// that wears a crew other than Rainbow they run through that crew's own paint, six stops from the rear (the bar: from the left, seen from behind), each a
// palette row and a lift: how many steps of its row a lit slice climbs over a plain one's (a lift of 0.15 is one step). An unlit slice is its row's plain
// dark, so empty still reads as empty, and full reads as each crew's run lit. Rainbow's run is the six hues with no lift: the band it always had.
//
// Each run is the crew's paint (render/factionLook.ts: the rows its shots and gardens use), dark to bright, and it never starts on its body's row (FACTIONS'
// `bus`), so the band stands off the body from the first slice: a crimson band on a crimson body says nothing. Where a body's row comes back further up a
// run, it's at a glint step the body never shows.
//   Atlantis (body TEAL): the marble's lilac shadow up to pearl white, then the sea's foam and white foam (never WHITE: lit, it is the white-hot of a
//   super's charge). Its deep sea is TEAL's own dark steps, the body's row.
//   The Elderwood (body MOSS): violet caps at dusk, then firefly lime and lantern gold. Its deep moss is the body's own row.
//   Hyperglow (body MAGENTA): cyan neon, lavender chrome, then silver: away from the magenta.
//   Inferno (body CRIMSON): the black glass's violet sheen, red-hot, flame orange, then gold. Its crimson is the body's own row.

export interface GaugeStop {
  readonly ramp: number;
  readonly lift: number;
}
export type GaugeRun = readonly GaugeStop[];

/** a step of lift, in glow (BusModel's band: a lit slice glows 0.6, its row's step 4 of 0-7) */
const STEP = 0.15;
const run = (...s: [number, number][]): GaugeRun => s.map(([ramp, steps]) => ({ ramp, lift: steps * STEP }));

const { PEARL, TEAL, VIOLET, MOSS, YELLOW, CYAN, CHROME, OBSIDIAN, RED, ORANGE } = Ramp;

/** Rainbow's: the six hues, no lift (the band as it always was). */
export const RAINBOW_GAUGE: GaugeRun = HUE_RAMPS.map((ramp) => ({ ramp, lift: 0 }));

/** By faction number (none, or a later build's, is Rainbow's). */
const GAUGES: Record<number, GaugeRun> = {
  [FACTION_RAINBOW]: RAINBOW_GAUGE,
  [FACTION_ATLANTIS]: run([PEARL, -1], [PEARL, 0], [PEARL, 1], [PEARL, 2], [TEAL, 2], [TEAL, 3]),
  [FACTION_ELDERWOOD]: run([VIOLET, -1], [VIOLET, 0], [MOSS, 2], [MOSS, 3], [YELLOW, 1], [YELLOW, 2]),
  [FACTION_HYPERGLOW]: run([CYAN, -1], [CYAN, 0], [CYAN, 1], [CHROME, 0], [CHROME, 1], [CHROME, 2]),
  [FACTION_INFERNO]: run([OBSIDIAN, 2], [RED, 0], [ORANGE, -1], [ORANGE, 0], [YELLOW, 0], [YELLOW, 2]),
};

/** A crew's run: Rainbow's for none or a later build's. */
export const gaugeOf = (faction: number): GaugeRun => GAUGES[faction] ?? RAINBOW_GAUGE;

/** The run of the crew whose bus body wears this row (FACTIONS' `bus`), or null for a row no crew's body wears (a hit's flood, say). */
export function gaugeOfBody(row: number): GaugeRun | null {
  const f = FACTIONS.find((c) => Ramp[c.bus] === row);
  return f ? gaugeOf(f.id) : null;
}
