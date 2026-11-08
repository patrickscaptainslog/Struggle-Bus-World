// Where everything on the HUD goes: one pure function, run on resize only. No DOM,
// so the tables can be tested offline.
//
// A control has a visual and a hit rect. The hit rect may be bigger, toward the
// play field; it never reaches the 14 px band at the screen's left and right
// edges, in any layout, swapped or not: that band belongs to the canvas, so a
// gripping finger cannot charge.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Control {
  /** what is drawn */
  v: Rect;
  /** what catches a touch */
  hit: Rect;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HudLayout {
  w: number;
  h: number;
  compact: boolean;
  swap: boolean;
  settings: Control;
  mega: Control;
  /** the testers' faction crest (?crew, game/crew.ts): the top left, 44 px, and its picker's five swatches in a row under it. Off the screen without crew */
  crew: Control;
  swatches: Rect[];
  readout: Rect;
  /** the one slot for a toast and LOCKED: centered */
  toast: Rect;
  /** the meter charging or pouring (above MEGA; beside it when turned), and its ring docked on the face for the cooldown */
  meterCharge: Rect;
  meterCool: Rect;
  cue: Rect;
}

/** Nothing sits lower than this above the bottom edge. */
export const BOTTOM_CLEAR = 40;
/** The canvas's band at the left and right edges. */
export const EDGE_BAND = 14;

/** A small phone: one set of canvases, decided once, so turning it never rebuilds them. */
export function isCompact(w: number, h: number): boolean {
  return Math.min(w, h) < 360;
}

export function layoutHud(w: number, h: number, insets: Insets, swap: boolean, compact: boolean, crewOn = false): HudLayout {
  const safe = (inset: number, px: number) => Math.max(px, inset + Math.round(px / 2));
  const land = w > h;
  const margin = compact ? 8 : 12;
  const T = safe(insets.top, 10);
  const L = safe(insets.left, margin);
  const R = safe(insets.right, margin);
  const minX = EDGE_BAND, maxX = w - EDGE_BAND;
  const clip = (x0: number, y0: number, x1: number, y1: number): Rect => {
    const a = Math.max(minX, x0), b = Math.min(maxX, x1);
    return { x: a, y: y0, w: b - a, h: y1 - y0 };
  };

  // top right: settings
  const settingsX = w - safe(insets.right, 10) - 40;
  // (a turned notch phone has the room on the right; everywhere else the seam gives settings its 44 px)
  const seam = settingsX - (land && insets.right > 0 ? 4 : 8);
  const settings = { v: { x: settingsX, y: T, w: 40, h: 40 }, hit: clip(seam, T - 4, settingsX + 50, T + 44) };

  // the faction crest (?crew): the top left corner, clear of the canvas's edge band and under the notch, the bus's lane far below it; its picker opens
  // as a row under it, the crest's own size each
  const CR = 44, gap = 6;
  const crewX = Math.max(L, EDGE_BAND + 2);
  const crew = crewOn ? { v: { x: crewX, y: T, w: CR, h: CR }, hit: clip(crewX - 2, T - 4, crewX + CR + 4, T + CR + 4) } : { v: { x: -999, y: -999, w: 0, h: 0 }, hit: { x: -999, y: -999, w: 0, h: 0 } };
  const swatches = crewOn ? [0, 1, 2, 3, 4].map((k) => ({ x: crewX + k * (CR + gap), y: T + CR + gap + 4, w: CR, h: CR })) : [];

  // the gear readout: the top left corner, across from settings (beside the crest when it's there)
  const readout = { x: crewOn ? crewX + CR + 8 : L, y: T + 2, w: 200, h: 48 };
  const toast = { x: 0, y: T + 54, w, h: 44 };

  // MEGA: the middle of the right side, the top of what a thumb can hold for 10 s
  const ms = compact ? 68 : 84;
  const megaX = w - R - ms;
  const megaY = Math.round(0.45 * h - ms / 2);
  const megaV = { x: megaX, y: megaY, w: ms, h: ms };
  const megaHit = clip(megaX - 12, megaY - 12, megaX + ms + 6, megaY + ms + 12);
  // the meter (68 x 86): above MEGA, the one side a thumb from below never covers; turned, there is no above
  const meterCharge = land ? { x: megaX - 6 - 68, y: Math.round(megaY + ms / 2 - 43), w: 68, h: 86 } : { x: megaX + (ms - 68) / 2, y: megaY - 6 - 86, w: 68, h: 86 };
  const meterCool = { x: megaX + (ms - 68) / 2, y: megaY + (ms - 68) / 2, w: 68, h: 86 };

  // the cue: low, centered, clear of the thumbs' rest
  const cue = { x: Math.floor((w - 96) / 2), y: Math.round(0.64 * h), w: 96, h: 64 };

  const out: HudLayout = { w, h, compact, swap, settings, mega: { v: megaV, hit: megaHit }, crew, swatches, readout, toast, meterCharge, meterCool, cue };
  if (swap) {
    // left-handed: everything a thumb works mirrors; the top row stays
    mirror(out.mega.v, w);
    mirror(out.mega.hit, w);
    mirror(out.meterCharge, w);
    mirror(out.meterCool, w);
  }
  return out;
}

function mirror(r: Rect, w: number) {
  r.x = w - r.x - r.w;
}
