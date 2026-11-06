import { FACTION_ATLANTIS, FACTION_ELDERWOOD, FACTION_HYPERGLOW, FACTION_INFERNO, FACTION_RAINBOW, FACTION_ROOM } from '../game/factions';
import { HUE_RAMPS, Ramp } from './palette';

// Whose paint draws on which rows (docs/specs/factions/FACTIONS.md, step 5, and section 2's "Colours."): every painted surface reads its owner, which every
// store keeps since step 1 (PaintState's alpha, a ground texel's low bits), and draws that faction's rows. Rainbow's look is today's paint exactly: its six
// hues for everything, WHITE trim, YELLOW gold, GREEN leaves, VIOLET bark. No owner (0) or a later build's 6-7 draws as Rainbow's.
//
// A look has six slots, as Rainbow's six hues: a blast deals them round its impact as it always has (Splatter), a surface's own slot reads `body`, and its
// offsets from it (a bay's +1, a gable's and a window's +2, the complement's +3, a roof slope's +5) read `accent`. Rainbow's two are the same six, so its
// offsets are its own hues; the others keep one or two body rows, the one a faction reads by from far off, and their accents mostly in their own family
// (an accent can be the body's row), so a house's every offset, level 3's bands included, still reads as its faction, with one spice in six.
//
// Rows 24-31 are the factions' own (palette.ts), and a faction's accents may share a row with another's or with Rainbow's (gold, coral, violet caps): only a
// body is a faction's main colour, and tools/factions/colours.py measures those apart in all seven of the live sky's tables, under four kinds of sight.

export interface FactionLook {
  /** a painted wall's own colour, by its slot */
  readonly body: readonly number[];
  /** what a slot's offsets read: bays, gables, windows, the complement's trim, roof slopes, flowers */
  readonly accent: readonly number[];
  /** the ground's splats, by slot */
  readonly ground: readonly number[];
  /** the breath and its blast's particles, by slot (Particles.palette) */
  readonly spray: readonly number[];
  /** where Rainbow has WHITE: a calm house's frames and belts, two towers in three's trim, a hanging garden's rail, a blossom its leaves' colour */
  readonly trim: number;
  /** where Rainbow has YELLOW: onion domes, a tower's crown, a garden's gold, a flower that can't be its leaf */
  readonly gold: number;
  /** where Rainbow has GREEN: roof turf, gardens and vines, a painted tree's crown */
  readonly leaf: number;
  /** where Rainbow has VIOLET: a painted tree's trunk, a garden's wood */
  readonly bark: number;
}

const RAINBOW: FactionLook = { body: HUE_RAMPS, accent: HUE_RAMPS, ground: HUE_RAMPS, spray: HUE_RAMPS, trim: Ramp.WHITE, gold: Ramp.YELLOW, leaf: Ramp.GREEN, bark: Ramp.VIOLET };

const { TEAL, PEARL, MOSS, CHROME, MAGENTA, CYAN, CRIMSON, OBSIDIAN, RED, YELLOW, VIOLET, WHITE } = Ramp;

/** By faction number, 0-7 (FACTION_ROOM): 0, 6 and 7 are Rainbow's. */
export const FACTION_LOOKS: readonly FactionLook[] = (() => {
  const looks: FactionLook[] = [];
  for (let f = 0; f <= FACTION_ROOM; f++) looks.push(RAINBOW);
  // Atlantis: teal walls from deep indigo to foam, pearl marble and foam-white trim, gold domes, and coral (RED) as the spice
  looks[FACTION_ATLANTIS] = {
    body: [TEAL, TEAL, TEAL, TEAL, TEAL, TEAL],
    accent: [PEARL, TEAL, PEARL, TEAL, PEARL, RED],
    ground: [TEAL, TEAL, PEARL, TEAL, TEAL, PEARL],
    spray: [TEAL, PEARL, TEAL, WHITE, TEAL, PEARL],
    trim: WHITE,
    gold: YELLOW,
    leaf: TEAL,
    bark: PEARL,
  };
  // the Elderwood: moss walls, silver-lilac stone and bark, violet caps, lantern gold
  looks[FACTION_ELDERWOOD] = {
    body: [MOSS, MOSS, MOSS, MOSS, MOSS, MOSS],
    accent: [MOSS, PEARL, MOSS, YELLOW, MOSS, VIOLET],
    ground: [MOSS, MOSS, VIOLET, MOSS, MOSS, PEARL],
    spray: [MOSS, YELLOW, MOSS, VIOLET, MOSS, YELLOW],
    trim: PEARL,
    gold: YELLOW,
    leaf: MOSS,
    bark: PEARL,
  };
  // Hyperglow: lavender chrome walls ruled in magenta and cyan neon
  looks[FACTION_HYPERGLOW] = {
    body: [CHROME, CHROME, CHROME, CHROME, CHROME, CHROME],
    accent: [MAGENTA, CHROME, CYAN, CHROME, MAGENTA, CYAN],
    ground: [CHROME, MAGENTA, CHROME, CYAN, CHROME, MAGENTA],
    spray: [MAGENTA, CYAN, MAGENTA, CYAN, MAGENTA, CYAN],
    trim: MAGENTA,
    gold: CYAN,
    leaf: CYAN,
    bark: CHROME,
  };
  // Inferno: crimson and black glass walls and trim, and gold (YELLOW) as the spice, the flame's
  looks[FACTION_INFERNO] = {
    body: [CRIMSON, OBSIDIAN, CRIMSON, CRIMSON, OBSIDIAN, CRIMSON],
    accent: [OBSIDIAN, CRIMSON, OBSIDIAN, CRIMSON, YELLOW, OBSIDIAN],
    ground: [CRIMSON, OBSIDIAN, CRIMSON, CRIMSON, OBSIDIAN, CRIMSON],
    spray: [CRIMSON, YELLOW, CRIMSON, OBSIDIAN, CRIMSON, YELLOW],
    trim: OBSIDIAN,
    gold: OBSIDIAN,
    leaf: CRIMSON,
    bark: OBSIDIAN,
  };
  looks[FACTION_RAINBOW] = RAINBOW;
  return looks;
})();

/** A faction's look, by its number (FACTION_LOOKS: none or a later build's is Rainbow's). */
export const lookOf = (faction: number): FactionLook => FACTION_LOOKS[Number.isInteger(faction) && faction >= 0 && faction <= FACTION_ROOM ? faction : FACTION_RAINBOW];

const table = (pick: (l: FactionLook) => readonly number[]) => FACTION_LOOKS.flatMap(pick).map((r) => r.toFixed(1)).join(', ');
const roles = FACTION_LOOKS.flatMap((l) => [l.trim, l.gold, l.leaf, l.bark]).map((r) => r.toFixed(1)).join(', ');
const N = (FACTION_ROOM + 1) * 6;

/**
 * GLSL: a painted surface's rows by its owner (FACTION_LOOKS). `f` is the owner as a store keeps it, `s` a slot 0-5 (each caller rounds and wraps it as it
 * always has). Constant tables, no uniform and no texture read: Rainbow's entries are its hues, so its every pixel is the one it was before factions. Every
 * chunk that draws paint carries it, once a shader however many of them it holds (the guard).
 */
export const GLSL_FACTION = /* glsl */ `
#ifndef SB_FACTION
#define SB_FACTION
const float SB_FAC_BODY[${N}] = float[${N}](${table((l) => l.body)});
const float SB_FAC_ACCENT[${N}] = float[${N}](${table((l) => l.accent)});
const float SB_FAC_GROUND[${N}] = float[${N}](${table((l) => l.ground)});
const float SB_FAC_ROLE[${(FACTION_ROOM + 1) * 4}] = float[${(FACTION_ROOM + 1) * 4}](${roles});
int sbFac(float f) { return clamp(int(f + 0.5), 0, ${FACTION_ROOM}); }
float sbFacBody(int f, int s) { return SB_FAC_BODY[f * 6 + s]; }
float sbFacAccent(int f, int s) { return SB_FAC_ACCENT[f * 6 + s]; }
float sbFacGround(int f, int s) { return SB_FAC_GROUND[f * 6 + s]; }
float sbFacTrim(int f) { return SB_FAC_ROLE[f * 4]; }
float sbFacGold(int f) { return SB_FAC_ROLE[f * 4 + 1]; }
float sbFacLeaf(int f) { return SB_FAC_ROLE[f * 4 + 2]; }
float sbFacBark(int f) { return SB_FAC_ROLE[f * 4 + 3]; }
// (slot s as a surface's own, or as an offset from another's: Rainbow's two tables are the same six, so for it either is HUE_RAMPS[s])
float sbFacHue(int f, int s, bool own) { return own ? SB_FAC_BODY[f * 6 + s] : SB_FAC_ACCENT[f * 6 + s]; }
#endif
`;
