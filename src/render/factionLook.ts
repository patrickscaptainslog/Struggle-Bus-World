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
// body is a faction's main colour, and tools/factions/colours.ts measures those apart in all seven of the live sky's tables, under four kinds of sight.
// A window reads its own table by the same offsets (`glass`), so a spice can live in the windows alone: an accent lands on whole bands, bays and roofs too.

export interface FactionLook {
  /** a painted wall's own colour, by its slot */
  readonly body: readonly number[];
  /** what a slot's offsets read: bays, gables, the complement's trim, roof slopes, bands, flowers */
  readonly accent: readonly number[];
  /** a window's glass by the same offsets: a house's and a landmark's (its slot's +2 or +4 at levels 1-2, any at level 3). Rainbow's is its six hues */
  readonly glass: readonly number[];
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

const RAINBOW: FactionLook = { body: HUE_RAMPS, accent: HUE_RAMPS, glass: HUE_RAMPS, ground: HUE_RAMPS, spray: HUE_RAMPS, trim: Ramp.WHITE, gold: Ramp.YELLOW, leaf: Ramp.GREEN, bark: Ramp.VIOLET };

const { TEAL, PEARL, MOSS, CHROME, MAGENTA, CYAN, CRIMSON, OBSIDIAN, RED, ORANGE, YELLOW, VIOLET, WHITE } = Ramp;

/** By faction number, 0-7 (FACTION_ROOM): 0, 6 and 7 are Rainbow's. */
export const FACTION_LOOKS: readonly FactionLook[] = (() => {
  const looks: FactionLook[] = [];
  for (let f = 0; f <= FACTION_ROOM; f++) looks.push(RAINBOW);
  // Atlantis: teal walls, the deep sea's blue in shade, foam-white trim and pearl marble only as a highlight (a sixth of the accents: a band, a bay, a
  // gable or a roof on a house in three), gold domes, and coral (RED) only in windows, a third of them, as the spice
  looks[FACTION_ATLANTIS] = {
    body: [TEAL, TEAL, TEAL, TEAL, TEAL, TEAL],
    accent: [PEARL, TEAL, TEAL, TEAL, TEAL, TEAL],
    glass: [PEARL, RED, WHITE, PEARL, RED, PEARL],
    ground: [TEAL, TEAL, PEARL, TEAL, TEAL, PEARL],
    spray: [TEAL, PEARL, TEAL, WHITE, TEAL, PEARL],
    trim: WHITE,
    gold: YELLOW,
    leaf: TEAL,
    bark: PEARL,
  };
  // the Elderwood: deep moss walls, bands, bays and roofs alike, silver-lilac stone only as trim and bark, violet caps (its domes, a garden's glowing
  // bits, a flower that would be its leaves' colour), lantern gold in a sixth of the windows, and half its ground silver and violet, so a painted lawn
  // never reads as grass
  looks[FACTION_ELDERWOOD] = {
    body: [MOSS, MOSS, MOSS, MOSS, MOSS, MOSS],
    accent: [MOSS, MOSS, MOSS, MOSS, MOSS, MOSS],
    glass: [YELLOW, PEARL, MOSS, PEARL, MOSS, PEARL],
    ground: [MOSS, PEARL, MOSS, VIOLET, MOSS, PEARL],
    spray: [MOSS, YELLOW, MOSS, VIOLET, MOSS, YELLOW],
    trim: PEARL,
    gold: VIOLET,
    leaf: MOSS,
    bark: PEARL,
  };
  // Hyperglow: lavender chrome walls ruled in magenta and cyan neon, its gardens and trees magenta, so cyan is its minor colour from above, where
  // Atlantis's teal roofs are
  looks[FACTION_HYPERGLOW] = {
    body: [CHROME, CHROME, CHROME, CHROME, CHROME, CHROME],
    accent: [MAGENTA, CHROME, CYAN, CHROME, MAGENTA, CYAN],
    glass: [MAGENTA, CHROME, CYAN, CHROME, MAGENTA, CYAN],
    ground: [CHROME, MAGENTA, CHROME, CYAN, CHROME, MAGENTA],
    spray: [MAGENTA, CYAN, MAGENTA, CYAN, MAGENTA, CYAN],
    trim: MAGENTA,
    gold: CYAN,
    leaf: MAGENTA,
    bark: CHROME,
  };
  // Inferno: crimson and black glass walls, red-hot trim (RED: a Painted Lady's frames and belts are half its face, too much for the flame's gold, which
  // made gold houses), the flame's gold (YELLOW) in a sixth of the accents (level 3's zigzag bands on a house in three, a tower's veins), its windows flame
  // orange and red (a sixth black glass, none the gold a city's lit window is), black glass domes, and a sixth of its ground glowing orange where the black
  // glass, near black now, would vanish on asphalt
  looks[FACTION_INFERNO] = {
    body: [CRIMSON, OBSIDIAN, CRIMSON, CRIMSON, OBSIDIAN, CRIMSON],
    accent: [YELLOW, CRIMSON, OBSIDIAN, CRIMSON, CRIMSON, OBSIDIAN],
    glass: [ORANGE, RED, ORANGE, OBSIDIAN, RED, ORANGE],
    ground: [CRIMSON, OBSIDIAN, CRIMSON, ORANGE, CRIMSON, CRIMSON],
    spray: [CRIMSON, YELLOW, CRIMSON, OBSIDIAN, CRIMSON, YELLOW],
    trim: RED,
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
const float SB_FAC_GLASS[${N}] = float[${N}](${table((l) => l.glass)});
const float SB_FAC_GROUND[${N}] = float[${N}](${table((l) => l.ground)});
const float SB_FAC_ROLE[${(FACTION_ROOM + 1) * 4}] = float[${(FACTION_ROOM + 1) * 4}](${roles});
int sbFac(float f) { return clamp(int(f + 0.5), 0, ${FACTION_ROOM}); }
float sbFacBody(int f, int s) { return SB_FAC_BODY[f * 6 + s]; }
float sbFacAccent(int f, int s) { return SB_FAC_ACCENT[f * 6 + s]; }
float sbFacGlass(int f, int s) { return SB_FAC_GLASS[f * 6 + s]; }
float sbFacGround(int f, int s) { return SB_FAC_GROUND[f * 6 + s]; }
float sbFacTrim(int f) { return SB_FAC_ROLE[f * 4]; }
float sbFacGold(int f) { return SB_FAC_ROLE[f * 4 + 1]; }
float sbFacLeaf(int f) { return SB_FAC_ROLE[f * 4 + 2]; }
float sbFacBark(int f) { return SB_FAC_ROLE[f * 4 + 3]; }
// (slot s as a surface's own, or as an offset from another's: Rainbow's two tables are the same six, so for it either is HUE_RAMPS[s])
float sbFacHue(int f, int s, bool own) { return own ? SB_FAC_BODY[f * 6 + s] : SB_FAC_ACCENT[f * 6 + s]; }
#endif
`;
