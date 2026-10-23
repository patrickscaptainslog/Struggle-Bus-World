// Crisp hand-drawn bitmap fonts for diegetic text (the street sign).
//
// LARGE is a 7-px-tall condensed caps face in the spirit of the SF street-name
// blades: most glyphs are 4 px wide, the ones that need a centre stem or a
// diagonal (M N T V W X Y &) are 5, I and 1 are 3. At 1 font pixel ~ 1 game
// pixel every stroke survives the low-res framebuffer.
//
// SMALL is 5 px tall (3 px wide, M/W 5, N 4) for street-type suffixes
// ("ST", "AVE", "BLVD") which real SF signs set smaller than the name.
//
// Everything rasterizes into a plain Uint8 mask (row 0 = top, y down) so the
// caller can composite it into a DataTexture with whatever codes it likes.

export interface Glyph {
  readonly w: number;
  /** w*h bytes, row-major, y down: 1 = ink. */
  readonly bits: Uint8Array;
}

export interface PixelFont {
  readonly height: number;
  /** Columns between glyphs. */
  readonly spacing: number;
  readonly glyphs: ReadonlyMap<string, Glyph>;
  /** Font used for characters this one lacks (e.g. SMALL falls back to LARGE). */
  readonly fallback?: PixelFont;
}

function defineFont(height: number, spacing: number, src: Record<string, string>, fallback?: PixelFont): PixelFont {
  const glyphs = new Map<string, Glyph>();
  for (const ch of Object.keys(src)) {
    const rows = src[ch].trim().split(/\s+/);
    if (rows.length !== height) throw new Error(`pixelFont: glyph '${ch}' has ${rows.length} rows, expected ${height}`);
    const w = rows[0].length;
    const bits = new Uint8Array(w * height);
    rows.forEach((r, y) => {
      if (r.length !== w) throw new Error(`pixelFont: glyph '${ch}' row ${y} is ${r.length} wide, expected ${w}`);
      for (let x = 0; x < w; x++) bits[y * w + x] = r[x] === '#' ? 1 : 0;
    });
    glyphs.set(ch, { w, bits });
  }
  return { height, spacing, glyphs, fallback };
}

// prettier-ignore
export const FONT_LARGE: PixelFont = defineFont(7, 1, {
  A: '.##. #..# #..# #### #..# #..# #..#',
  B: '###. #..# #..# ###. #..# #..# ###.',
  C: '.##. #..# #... #... #... #..# .##.',
  D: '###. #..# #..# #..# #..# #..# ###.',
  E: '#### #... #... ###. #... #... ####',
  F: '#### #... #... ###. #... #... #...',
  G: '.##. #..# #... #.## #..# #..# .###',
  H: '#..# #..# #..# #### #..# #..# #..#',
  I: '### .#. .#. .#. .#. .#. ###',
  J: '...# ...# ...# ...# #..# #..# .##.',
  K: '#..# #..# #.#. ##.. #.#. #..# #..#',
  L: '#... #... #... #... #... #... ####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# ##..# ##..# #.#.# #..## #..## #...#',
  O: '.##. #..# #..# #..# #..# #..# .##.',
  P: '###. #..# #..# ###. #... #... #...',
  Q: '.##. #..# #..# #..# #..# #.#. .#.#',
  R: '###. #..# #..# ###. #.#. #..# #..#',
  S: '.##. #..# #... .##. ...# #..# .##.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#..# #..# #..# #..# #..# #..# .##.',
  V: '#...# #...# #...# .#.#. .#.#. .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '#### ...# ..#. .#.. #... #... ####',
  '0': '.##. #..# #.## ##.# #..# #..# .##.',
  '1': '.#. ##. .#. .#. .#. .#. ###',
  '2': '.##. #..# ...# ..#. .#.. #... ####',
  '3': '###. ...# ...# .##. ...# ...# ###.',
  '4': '#..# #..# #..# #### ...# ...# ...#',
  '5': '#### #... ###. ...# ...# #..# .##.',
  '6': '.##. #... #... ###. #..# #..# .##.',
  '7': '#### ...# ...# ..#. .#.. .#.. .#..',
  '8': '.##. #..# #..# .##. #..# #..# .##.',
  '9': '.##. #..# #..# .### ...# ...# .##.',
  ' ': '... ... ... ... ... ... ...',
  '.': '. . . . . . #',
  "'": '# # . . . . .',
  '-': '... ... ... ### ... ... ...',
  '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
});

// prettier-ignore
export const FONT_SMALL: PixelFont = defineFont(5, 1, {
  A: '.#. #.# ### #.# #.#',
  B: '##. #.# ##. #.# ##.',
  C: '.## #.. #.. #.. .##',
  D: '##. #.# #.# #.# ##.',
  E: '### #.. ##. #.. ###',
  F: '### #.. ##. #.. #..',
  G: '.## #.. #.# #.# .##',
  H: '#.# #.# ### #.# #.#',
  I: '### .#. .#. .#. ###',
  J: '..# ..# ..# #.# .#.',
  K: '#.# #.# ##. #.# #.#',
  L: '#.. #.. #.. #.. ###',
  M: '#...# ##.## #.#.# #...# #...#',
  N: '#..# ##.# #.## #..# #..#',
  O: '.#. #.# #.# #.# .#.',
  P: '##. #.# ##. #.. #..',
  Q: '.#. #.# #.# ##. .##',
  R: '##. #.# ##. #.# #.#',
  S: '.## #.. .#. ..# ##.',
  T: '### .#. .#. .#. .#.',
  U: '#.# #.# #.# #.# ###',
  V: '#.# #.# #.# #.# .#.',
  W: '#...# #...# #.#.# ##.## #...#',
  X: '#.# #.# .#. #.# #.#',
  Y: '#.# #.# .#. .#. .#.',
  Z: '### ..# .#. #.. ###',
  '0': '.#. #.# #.# #.# .#.',
  '1': '.#. ##. .#. .#. ###',
  '2': '##. ..# .#. #.. ###',
  '3': '##. ..# .#. ..# ##.',
  '4': '#.# #.# ### ..# ..#',
  '5': '### #.. ##. ..# ##.',
  '6': '.## #.. ### #.# ###',
  '7': '### ..# .#. .#. .#.',
  '8': '### #.# ### #.# ###',
  '9': '### #.# ### ..# ##.',
  ' ': '.. .. .. .. ..',
  '.': '. . . . #',
  "'": '# # . . .',
  '-': '... ... ### ... ...',
}, FONT_LARGE);

/** Width of a word space in the large font (it reads better a hair wider than a glyph gap). */
const UNKNOWN = '';

/**
 * Uppercases, strips accents, maps curly quotes / en dashes / slashes to what
 * the fonts have, drops anything else, and collapses whitespace.
 */
export function normalizeText(s: string): string {
  const t = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[–—/_]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  let out = '';
  for (const ch of t) out += FONT_LARGE.glyphs.has(ch) ? ch : UNKNOWN;
  return out.replace(/ {2,}/g, ' ');
}

function glyphOf(font: PixelFont, ch: string): { g: Glyph; font: PixelFont } | null {
  let f: PixelFont | undefined = font;
  while (f) {
    const g = f.glyphs.get(ch);
    if (g) return { g, font: f };
    f = f.fallback;
  }
  return null;
}

/** Width in pixels of `text` set in `font` (no trailing gap). */
export function measureText(text: string, font: PixelFont = FONT_LARGE): number {
  let w = 0;
  let n = 0;
  for (const ch of text) {
    const r = glyphOf(font, ch);
    if (!r) continue;
    w += r.g.w;
    n++;
  }
  return n > 0 ? w + (n - 1) * font.spacing : 0;
}

/**
 * Draws `text` into `mask` (row-major, y down) with its top-left at (x, y).
 * Only ink pixels are written (value `value`); the rest is left untouched.
 * Glyphs from a taller fallback font are bottom-aligned to this font's baseline.
 * Returns the x just past the last glyph.
 */
export function drawText(
  mask: Uint8Array,
  maskW: number,
  maskH: number,
  text: string,
  x: number,
  y: number,
  value: number,
  font: PixelFont = FONT_LARGE,
): number {
  let cx = x;
  let first = true;
  for (const ch of text) {
    const r = glyphOf(font, ch);
    if (!r) continue;
    if (!first) cx += font.spacing;
    first = false;
    const { g } = r;
    const gh = r.font.height;
    const oy = y + font.height - gh; // bottom-align fallbacks
    for (let gy = 0; gy < gh; gy++) {
      const py = oy + gy;
      if (py < 0 || py >= maskH) continue;
      for (let gx = 0; gx < g.w; gx++) {
        if (!g.bits[gy * g.w + gx]) continue;
        const px = cx + gx;
        if (px < 0 || px >= maskW) continue;
        mask[py * maskW + px] = value;
      }
    }
    cx += g.w;
  }
  return cx;
}

export interface TextMask {
  width: number;
  height: number;
  /** width*height bytes, y down: 1 = ink, 0 = empty. */
  data: Uint8Array;
}

/** Rasterizes a single line into a tight mask (allocates; not for per-frame use). */
export function rasterizeText(text: string, font: PixelFont = FONT_LARGE): TextMask {
  const width = Math.max(1, measureText(text, font));
  const height = font.height;
  const data = new Uint8Array(width * height);
  drawText(data, width, height, text, 0, 0, 1, font);
  return { width, height, data };
}
