import { FACTION_ATLANTIS, FACTION_ELDERWOOD, FACTION_HYPERGLOW, FACTION_INFERNO } from '../game/factions';
import { Ramp } from '../render/palette';
import { C, rgba, type PixelCanvas } from './pixelUi';

// The factions' crests, for the testers' faction button (ui/Hud.ts, game/crew.ts): 22 x 22 UI px, 44 CSS px at the HUD's 2x, each in its faction's own rows
// (render/factionLook.ts's): Rainbow's arc in its six hues, Atlantis's trident in pearl over teal waves, the Elderwood's moss pine on a pearl trunk, Hyperglow's
// magenta bolt ruled in cyan, Inferno's crimson flame with the gold in its heart. Palette steps only, an ink plate under each and the faction's colour as its rim.

/** A crest's side (UI px). */
export const CREST = 22;

// 16 x 16 marks, drawn 3 px in; each letter one palette step
// prettier-ignore
const MARKS: Record<number, { rows: string[]; ink: Record<string, number>; rim: number }> = {
  [FACTION_ATLANTIS]: {
    rows: [
      '.##....##....##.',
      '.##....##....##.',
      '.##...####...##.',
      '.###...##...###.',
      '..###..##..###..',
      '...##########...',
      '....########....',
      '.......##.......',
      '.......##.......',
      '.......##.......',
      '.......##.......',
      '..ww...##...ww..',
      '.wwww..##..wwww.',
      'ww..wwwwwwww..ww',
      '.....w....w.....',
      '................',
    ],
    ink: { '#': rgba(Ramp.PEARL, 6), w: rgba(Ramp.TEAL, 5) },
    rim: rgba(Ramp.TEAL, 4),
  },
  [FACTION_ELDERWOOD]: {
    rows: [
      '.......mm.......',
      '......mmmm......',
      '.....mmMmmm.....',
      '....mmmmmMmm....',
      '...mmMmmmmmmm...',
      '....mmmmmMmm....',
      '...mmmmMmmmmm...',
      '..mmMmmmmmmMmm..',
      '.mmmmmmmmmmmmmm.',
      '....mmmmmmmm....',
      '..mmmmmMmmmmmm..',
      '.mmMmmmmmmmmMmm.',
      'mmmmmmmmmmmmmmmm',
      '......pppp......',
      '......pppp......',
      '.....pppppp.....',
    ],
    ink: { m: rgba(Ramp.MOSS, 5), M: rgba(Ramp.MOSS, 3), p: rgba(Ramp.PEARL, 4) },
    rim: rgba(Ramp.MOSS, 4),
  },
  [FACTION_HYPERGLOW]: {
    rows: [
      '..........cc....',
      '.........cmc....',
      '........cmmc....',
      '.......cmmc.....',
      '......cmmmc.....',
      '.....cmmmc......',
      '....cmmmmcccc...',
      '...cmmmmmmmmc...',
      '...ccccmmmmc....',
      '......cmmmc.....',
      '.....cmmmc......',
      '.....cmmc.......',
      '....cmmc........',
      '....cmc.........',
      '....cc..........',
      '................',
    ],
    ink: { m: rgba(Ramp.MAGENTA, 5), c: rgba(Ramp.CYAN, 6) },
    rim: rgba(Ramp.CHROME, 4),
  },
  [FACTION_INFERNO]: {
    rows: [
      '.......r........',
      '......rr........',
      '......rrr.......',
      '.....rrrr...r...',
      '.....rrorr..rr..',
      '....rrrorr.rrr..',
      '...rrroorrrrrr..',
      '...rrooooorrrr..',
      '..rrrooyyoorrrr.',
      '..rrooyyyyoorrr.',
      '..rrooyyyyyoorr.',
      '..rroyyyyyyyorr.',
      '...rooyyyyyoor..',
      '....rrooooorr...',
      '......rrrrr.....',
      '................',
    ],
    ink: { r: rgba(Ramp.CRIMSON, 5), o: rgba(Ramp.ORANGE, 5), y: rgba(Ramp.YELLOW, 6) },
    rim: rgba(Ramp.CRIMSON, 4),
  },
};

/** A faction's crest into `p` at (x, y): `picked` rims it in bus yellow, `dim` checkers it out (a match is on). */
export function drawCrest(p: PixelCanvas, faction: number, x = 0, y = 0, picked = false, dim = false) {
  const m = MARKS[faction];
  // the plate, chamfered, and the rim in the faction's colour (Rainbow's: its violet)
  const rim = picked ? C.yellowHi : m ? m.rim : C.hue[5];
  for (let j = 0; j < CREST; j++)
    for (let i = 0; i < CREST; i++) {
      const cx = Math.min(i, CREST - 1 - i), cy = Math.min(j, CREST - 1 - j);
      if (cx + cy < 3) continue;
      const edge = cx === 0 || cy === 0 || cx + cy === 3 || (picked && (cx === 1 || cy === 1 || cx + cy === 4));
      p.set(x + i, y + j, edge ? rim : C.ink);
    }
  if (m) {
    for (let j = 0; j < 16; j++)
      for (let i = 0; i < 16; i++) {
        const c = m.ink[m.rows[j][i]];
        if (c !== undefined) p.set(x + 3 + i, y + 3 + j, c);
      }
  } else {
    // Team Super Rainbow: its arc, red outside, violet in, standing on the plate's floor
    const ox = x + 11, oy = y + 16;
    for (let j = 3; j <= 16; j++)
      for (let i = 2; i < 20; i++) {
        const r = Math.hypot(i + 0.5 - 11, j + 0.5 - 16);
        const band = Math.floor((9.6 - r) / 1.15);
        if (band >= 0 && band < 6 && j < 16) p.set(x + i, y + j, C.hue[band]);
      }
    // (a cloud at each foot)
    for (const fx of [-7, 6]) {
      p.rect(ox + fx - 1, oy - 1, 4, 2, C.text);
      p.rect(ox + fx, oy - 2, 2, 1, C.text);
    }
  }
  if (dim) {
    for (let j = 0; j < CREST; j++) for (let i = (j % 2); i < CREST; i += 2) if (p.get(x + i, y + j) !== 0) p.set(x + i, y + j, C.ink);
  }
}
