// Whose paint it is (docs/specs/factions/FACTIONS.md, decision 23): the five factions, named and numbered here and nowhere else. The number is what every
// paint store saves and what the GPU's paint carries, so a faction keeps its number for good, and a new one takes the next. 0 is no one's: grey.
//
// Every splat writes its hitter's faction, and every saved paint record keeps it. A record saved before factions names none, or names Rainbow (the
// buildings' [faction, color, level] has said 1 since the first commit): either way it's Rainbow's (ownerOf), so no old save loses a thing. Where a store
// packs paint, a Rainbow record is packed as it was before factions, and room is left for eight (0-7): a number past the five, a later build's faction, is
// kept as it is through this one (ownerOf), so a rollback or a stale build never turns it Rainbow's. What a faction's paint draws in is render/factionLook.ts's
// (step 5), and a later build's 6-7 draws as Rainbow's there.
//
// The player's faction is set in two places, each a painter's own so a bot's bus can paint its own: Splatter.faction, which the street's blasts carry, and
// with them the Moon's ground and its craters, from up high too (main.ts's paintAt); and MoonPaint.faction, the Moon from orbit's strokes (MoonBreath's, in
// the flight, which has no Splatter). Rainbow in both until a player can join another (decision 15): whoever builds that sets both, or gives them one
// source then, with the player's faction saved.
//
// No three.js and no DOM: the stores' Node checks and life's worker can read it.

export const FACTION_NONE = 0;
export const FACTION_RAINBOW = 1;
export const FACTION_ATLANTIS = 2;
export const FACTION_ELDERWOOD = 3;
export const FACTION_HYPERGLOW = 4;
export const FACTION_INFERNO = 5;

/** The five, by number (FACTIONS[id - 1]): a short key for code and files, and the name a player reads. */
export const FACTIONS: ReadonlyArray<{ readonly id: number; readonly key: string; readonly name: string }> = [
  { id: FACTION_RAINBOW, key: 'rainbow', name: 'Team Super Rainbow' },
  { id: FACTION_ATLANTIS, key: 'atlantis', name: 'Atlantis' },
  { id: FACTION_ELDERWOOD, key: 'elderwood', name: 'The Elderwood' },
  { id: FACTION_HYPERGLOW, key: 'hyperglow', name: 'Hyperglow' },
  { id: FACTION_INFERNO, key: 'inferno', name: 'Inferno' },
];

/** The highest faction's number. */
export const FACTION_MAX = FACTION_INFERNO;
/**
 * The highest number every paint store has room for: the buildings' texture keeps it under PAINT_KEPT's 8, a ground texel's low bits as 14 + 2 f, 28 under
 * 32. Past FACTION_MAX it's a later build's faction, which this one has no name or look for, but keeps.
 */
export const FACTION_ROOM = 7;

/**
 * A painted record's owner, as a store reads it back: the faction it names, a later build's (past FACTION_MAX, up to FACTION_ROOM) as it is, so it's saved
 * again as it was; or Rainbow where it names none, or a number no store has room for.
 */
export function ownerOf(f: unknown): number {
  return typeof f === 'number' && Number.isInteger(f) && f >= FACTION_RAINBOW && f <= FACTION_ROOM ? f : FACTION_RAINBOW;
}

/**
 * &paintas=<key>: the faction the bus paints as (FACTIONS.md step 5), or undefined for Rainbow's. Only &paintas names it: ?lift&lifted=<faction> names whose
 * the staged block is, never the bus's ("I started as rainbow team but I am only shooting inferno paint", the producer, 2026-11-12).
 */
export function paintAsOf(q: { get(key: string): string | null }): (typeof FACTIONS)[number] | undefined {
  return FACTIONS.find((f) => f.key === q.get('paintas'));
}
