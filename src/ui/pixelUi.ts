import { FONT_LARGE, FONT_SMALL, type Glyph, type PixelFont } from '../fx/pixelFont';
import { Ramp, rampColor } from '../render/palette';

// A tiny pixel-art UI kit for the HUD: the street sign's bitmap fonts plus the
// few glyphs a HUD needs, drawn into small canvases in palette colors and
// scaled up with image-rendering: pixelated (1 UI pixel = `scale` CSS px).

function glyphs(height: number, src: Record<string, string>): Map<string, Glyph> {
  const m = new Map<string, Glyph>();
  for (const ch of Object.keys(src)) {
    const rows = src[ch].trim().split(/\s+/);
    if (rows.length !== height) throw new Error(`pixelUi: glyph '${ch}' has ${rows.length} rows`);
    const w = rows[0].length;
    const bits = new Uint8Array(w * height);
    rows.forEach((r, y) => {
      for (let x = 0; x < w; x++) bits[y * w + x] = r[x] === '#' ? 1 : 0;
    });
    m.set(ch, { w, bits });
  }
  return m;
}

// prettier-ignore
export const HUD_FONT: PixelFont = {
  height: 7,
  spacing: 1,
  fallback: FONT_LARGE,
  glyphs: glyphs(7, {
    ':': '. . # . . # .',
    '!': '# # # # # . #',
    '?': '.##. #..# ...# ..#. .#.. .... .#..',
    '/': '..# ..# .#. .#. .#. #.. #..',
    '+': '... ... .#. ### .#. ... ...',
    ',': '. . . . . # #',
    '▲': '....... ...#... ..###.. .#####. ####### ....... .......',
    '▼': '....... ....... ####### .#####. ..###.. ...#... .......',
    '·': '. . . # . . .',
  }),
};

// prettier-ignore
export const HUD_SMALL: PixelFont = {
  height: 5,
  spacing: 1,
  fallback: FONT_SMALL,
  glyphs: glyphs(5, {
    ':': '. # . # .',
    '!': '# # # . #',
    '/': '..# ..# .#. #.. #..',
    '+': '... .#. ### .#. ...',
    ',': '. . . # #',
    '·': '. . # . .',
    '-': '... ... ### ... ...',
    "'": '# # . . .',
    '?': '##. ..# .#. ... .#.',
    '(': '.# #. #. #. .#',
    ')': '#. .# .# .# #.',
    '&': '.#. #.# .#. #.# .##',
  }),
};

function glyphOf(font: PixelFont, ch: string): { g: Glyph; h: number } | null {
  let f: PixelFont | undefined = font;
  while (f) {
    const g = f.glyphs.get(ch);
    if (g) return { g, h: f.height };
    f = f.fallback;
  }
  return null;
}

export function textWidth(text: string, font: PixelFont = HUD_FONT): number {
  let w = 0, n = 0;
  for (const ch of text) {
    const r = glyphOf(font, ch);
    if (!r) continue;
    w += r.g.w;
    n++;
  }
  return n ? w + (n - 1) * font.spacing : 0;
}

/** Palette colors as 0xAABBGGRR (little-endian ImageData words). */
export function rgba(ramp: number, step: number): number {
  const hex = rampColor(ramp, step);
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** The HUD's colors: palette steps only. */
export const C = {
  clear: 0,
  ink: rgba(Ramp.INK, 0),
  panel: rgba(Ramp.INK, 2),
  panel2: rgba(Ramp.INK, 4),
  edge: rgba(Ramp.GREY_LIGHT, 3),
  dim: rgba(Ramp.GREY_LIGHT, 5),
  text: rgba(Ramp.WHITE, 7),
  cream: rgba(Ramp.GLOW_WHITE, 6),
  yellow: rgba(Ramp.BUS_YELLOW, 5),
  yellowHi: rgba(Ramp.BUS_YELLOW, 7),
  yellowLo: rgba(Ramp.BUS_YELLOW, 3),
  red: rgba(Ramp.RED, 4),
  redLo: rgba(Ramp.RED, 2),
  hue: [rgba(Ramp.RED, 4), rgba(Ramp.ORANGE, 4), rgba(Ramp.YELLOW, 5), rgba(Ramp.GREEN, 4), rgba(Ramp.BLUE, 4), rgba(Ramp.VIOLET, 4)],
  hueHi: [rgba(Ramp.RED, 6), rgba(Ramp.ORANGE, 6), rgba(Ramp.YELLOW, 6), rgba(Ramp.GREEN, 6), rgba(Ramp.BLUE, 6), rgba(Ramp.VIOLET, 6)],
  hueLo: [rgba(Ramp.RED, 2), rgba(Ramp.ORANGE, 2), rgba(Ramp.YELLOW, 2), rgba(Ramp.GREEN, 2), rgba(Ramp.BLUE, 2), rgba(Ramp.VIOLET, 2)],
};

/** A small canvas of UI pixels, scaled up crisply. Draw, then flush(). */
export class PixelCanvas {
  readonly el: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly img: ImageData | null;
  private readonly px: Uint32Array;
  private readonly mask: Uint8Array;

  constructor(w: number, h: number, scale: number) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    const el = document.createElement('canvas');
    el.width = this.w;
    el.height = this.h;
    el.style.width = `${this.w * scale}px`;
    el.style.height = `${this.h * scale}px`;
    el.style.imageRendering = 'pixelated';
    el.style.display = 'block';
    this.el = el;
    this.ctx = el.getContext('2d');
    this.img = this.ctx ? this.ctx.createImageData(this.w, this.h) : null;
    this.px = this.img ? new Uint32Array(this.img.data.buffer) : new Uint32Array(this.w * this.h);
    this.mask = new Uint8Array(this.w * this.h);
  }

  clear(c = 0) {
    this.px.fill(c);
  }

  set(x: number, y: number, c: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[y * this.w + x];
  }

  rect(x: number, y: number, w: number, h: number, c: number) {
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) this.px[j * this.w + i] = c;
  }

  /** A filled box with chamfered (pixel-rounded) corners of r px and a 1 px border. */
  box(x: number, y: number, w: number, h: number, fill: number, border: number, r = 2) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const dx = i < r ? r - i : i > w - 1 - r ? i - (w - 1 - r) : 0;
        const dy = j < r ? r - j : j > h - 1 - r ? j - (h - 1 - r) : 0;
        const d = dx + dy;
        if (d > r) continue;
        const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1 || d === r;
        this.set(x + i, y + j, edge ? border : fill);
      }
  }

  /** A filled disc (pixel circle) of radius r centered at (cx, cy) (half-pixel centers). */
  disc(cx: number, cy: number, r: number, c: number) {
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++)
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        const dx = i + 0.5 - cx, dy = j + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.set(i, j, c);
      }
  }

  /** Text with its top-left at (x, y); returns the x past it. */
  text(s: string, x: number, y: number, c: number, font: PixelFont = HUD_FONT): number {
    let cx = x, first = true;
    for (const ch of s) {
      const r = glyphOf(font, ch);
      if (!r) continue;
      if (!first) cx += font.spacing;
      first = false;
      const oy = y + font.height - r.h;
      for (let gy = 0; gy < r.h; gy++) for (let gx = 0; gx < r.g.w; gx++) if (r.g.bits[gy * r.g.w + gx]) this.set(cx + gx, oy + gy, c);
      cx += r.g.w;
    }
    return cx;
  }

  /** Text with a 1 px outline all around (readable on a bright sky or a painted city). */
  textOutlined(s: string, x: number, y: number, c: number, outline: number, font: PixelFont = HUD_FONT) {
    const m = this.mask;
    m.fill(0);
    const w = this.w;
    let cx = x, first = true;
    for (const ch of s) {
      const r = glyphOf(font, ch);
      if (!r) continue;
      if (!first) cx += font.spacing;
      first = false;
      const oy = y + font.height - r.h;
      for (let gy = 0; gy < r.h; gy++)
        for (let gx = 0; gx < r.g.w; gx++) {
          if (!r.g.bits[gy * r.g.w + gx]) continue;
          const px = cx + gx, py = oy + gy;
          if (px >= 0 && py >= 0 && px < w && py < this.h) m[py * w + px] = 1;
        }
      cx += r.g.w;
    }
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < w; i++) {
        if (m[j * w + i]) continue;
        let near = false;
        for (let dj = -1; dj <= 1 && !near; dj++)
          for (let di = -1; di <= 1; di++) {
            const a = i + di, b = j + dj;
            if (a >= 0 && b >= 0 && a < w && b < this.h && m[b * w + a]) {
              near = true;
              break;
            }
          }
        if (near) this.px[j * w + i] = outline;
      }
    for (let k = 0; k < m.length; k++) if (m[k]) this.px[k] = c;
  }

  /** A checkerboard dither of one color (a pixel-art dimmer: no alpha blending). */
  dither(c: number, density: 0.25 | 0.5) {
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const on = density === 0.5 ? (i + j) % 2 === 0 : i % 2 === 0 && j % 2 === 0;
        if (on) this.px[j * this.w + i] = c;
      }
  }

  flush() {
    if (this.ctx && this.img) this.ctx.putImageData(this.img, 0, 0);
  }
}
