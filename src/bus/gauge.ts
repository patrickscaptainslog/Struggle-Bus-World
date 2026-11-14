import { FACTION_ATLANTIS, FACTION_ELDERWOOD, FACTION_HYPERGLOW, FACTION_INFERNO, FACTION_RAINBOW, FACTIONS } from '../game/factions';
import { HUE_RAMPS, Ramp } from '../render/palette';

// The gauge wears the crew. The belly band's 24 slices and the rear bar's six cells are the game's only gauge (BusModel): how full the belly is. On a bus
// that wears a crew other than Rainbow they run through that crew's own paint, six stops from the rear (the bar: from the left, seen from behind), each a
// palette row and a lift: how many steps of its row a lit slice climbs over a plain one's (step 4 of 0-7; a lift of 1/7 is one step). A stop lit to step 6
// rides a step lower in the full wave's trough, so its crest stays at 6: step 7 is the sparkle's. An unlit slice is its row's plain dark, or the dark of the
// stop's own empty row where its row's dark would read as another crew's (`dark`), so empty still reads as empty, and full reads as each crew's run lit.
// Under a super's charge each stop races at a step over its lit one, to step 6 at most and never onto its body's sunlit steps (`top`), so the race keeps the
// crew's colours and the white-hot (step 7 of GLOW_WHITE) is still a change. Rainbow's run is the six hues with no lift, no empty row and a top of 1: the band it always had.
//
// Each run is the crew's paint (render/factionLook.ts: the rows its shots and gardens use), dark to bright, and it stands off its body (FACTIONS' `bus`):
// a crimson band on a crimson body says nothing. Where a crew's only paint for the run's start is its body's row (the sea and the forest are TEAL's and
// MOSS's dark steps), the gauge takes that row only at steps the body's sunlit faces never show (4 and 5): below them lit, and above them, a glint. (A
// side in deep shade is its row's step 2: there the black rub rail is what parts the band from the body.)
//   Atlantis (body TEAL): the deep sea (TEAL 2), azure (TEAL 3), then foam (TEAL 6, never white: white is the charge's white-hot).
//   The Elderwood (body MOSS): deep moss (MOSS 3), leaf (MOSS 6), then lantern gold (YELLOW 5, 6), whose empty is the moss's dark, not YELLOW's wine.
//   Hyperglow (body MAGENTA): lavender chrome and cyan neon in turn, each a step brighter, to electric cyan: away from the magenta.
//   Inferno (body CRIMSON): the black glass's violet (OBSIDIAN 5), orange-red, flame orange, then gold. Its crimson is the body's own row.

export interface GaugeStop {
  readonly ramp: number;
  readonly lift: number;
  /** the row an unlit slice shows: 0 for its own (BusModel keeps it in the band's `glow`, which the band never read) */
  readonly dark: number;
  /** the glow a slice races at under a super's charge (1 on Rainbow's: step 7) */
  readonly top: number;
}
export type GaugeRun = readonly GaugeStop[];

/** a step of lift, in glow (BusModel's band: a lit slice glows 0.6, its row's step 4 of 0-7, at 4.2 of 7) */
const STEP = 1 / 7;
/** the charge's top for a stop of `ramp` lit `steps` over step 4, on a bus whose body is `body`: a step over that, to 6 at most, but never onto the steps
 *  the body's sunlit faces show (4 and 5) in the body's own row; 0.2 into the step, as a lit slice is */
const topOf = (ramp: number, steps: number, body: number) => {
  const lit = 4 + steps, up = Math.min(6, lit + 1);
  return ((ramp === body && (up === 4 || up === 5) ? lit : up) + 0.2) / 7;
};
const run = (faction: number, ...s: [number, number, number?][]): GaugeRun => {
  const body = Ramp[FACTIONS.find((c) => c.id === faction)!.bus];
  return s.map(([ramp, steps, dark = 0]) => ({ ramp, lift: steps * STEP, dark, top: topOf(ramp, steps, body) }));
};

const { TEAL, MOSS, YELLOW, CYAN, CHROME, OBSIDIAN, ORANGE } = Ramp;

/** Rainbow's: the six hues, no lift (the band as it always was). */
export const RAINBOW_GAUGE: GaugeRun = HUE_RAMPS.map((ramp) => ({ ramp, lift: 0, dark: 0, top: 1 }));

/** By faction number (none, or a later build's, is Rainbow's). */
const GAUGES: Record<number, GaugeRun> = {
  [FACTION_RAINBOW]: RAINBOW_GAUGE,
  [FACTION_ATLANTIS]: run(FACTION_ATLANTIS, [TEAL, -2], [TEAL, -2], [TEAL, -1], [TEAL, -1], [TEAL, 2], [TEAL, 2]),
  [FACTION_ELDERWOOD]: run(FACTION_ELDERWOOD, [MOSS, -1], [MOSS, -1], [MOSS, 2], [MOSS, 2], [YELLOW, 1, MOSS], [YELLOW, 2, MOSS]),
  [FACTION_HYPERGLOW]: run(FACTION_HYPERGLOW, [CHROME, -2], [CYAN, 0], [CHROME, -1], [CYAN, 1], [CHROME, 0], [CYAN, 2]),
  [FACTION_INFERNO]: run(FACTION_INFERNO, [OBSIDIAN, 1], [ORANGE, -1], [ORANGE, 0], [ORANGE, 1], [YELLOW, 1], [YELLOW, 2]),
};

/** A crew's run: Rainbow's for none or a later build's. */
export const gaugeOf = (faction: number): GaugeRun => GAUGES[faction] ?? RAINBOW_GAUGE;

/** The run of the crew whose bus body wears this row (FACTIONS' `bus`), or null for a row no crew's body wears (a hit's flood, say). */
export function gaugeOfBody(row: number): GaugeRun | null {
  const f = FACTIONS.find((c) => Ramp[c.bus] === row);
  return f ? gaugeOf(f.id) : null;
}
