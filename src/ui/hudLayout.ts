// Where everything on the HUD goes: one pure function, run on resize only
// (docs/specs/hybrid-controls.md 3). No DOM, so the tables can be tested offline.
//
// A control has a visual and a hit rect. The hit rect may be bigger, toward the
// play field; it never reaches the 14 px band at the screen's left and right
// edges, in any layout, swapped or not: that band belongs to the canvas, so a
// gripping finger gets the edge-rest rule and cannot boost, shift or charge.

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
  toggle: Control;
  recenter: Control;
  settings: Control;
  turbo: Control;
  down: Control;
  mega: Control;
  chip: Control;
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

export function layoutHud(w: number, h: number, insets: Insets, swap: boolean, compact: boolean): HudLayout {
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

  // top left: the tilt toggle (it stays there when the buttons swap: "as asked")
  const toggleV = { x: L, y: T, w: 32, h: 32 };
  const toggleL = Math.max(minX, L - 12);
  const toggle = { v: toggleV, hit: clip(toggleL, T - 6, Math.max(toggleL + 44, L + 40), T + 40) };

  // top right: settings and, with tilt on, recenter
  const settingsX = w - safe(insets.right, 10) - 40;
  const recenterX = settingsX - 48;
  // (a turned notch phone has the room on the right; everywhere else the seam gives settings its 44 px)
  const seam = settingsX - (land && insets.right > 0 ? 4 : 8);
  const settings = { v: { x: settingsX, y: T, w: 40, h: 40 }, hit: clip(seam, T - 4, settingsX + 50, T + 44) };
  const recenter = { v: { x: recenterX, y: T, w: 40, h: 40 }, hit: clip(seam - 48, T - 4, seam, T + 44) };

  // the gear readout sits above TURBO (a right thumb reaching for TURBO covers what is right of and below it);
  // on a small portrait phone it takes a row of its own under the top row
  const readout = compact && !land ? { x: 52, y: T + 42, w: 200, h: 48 } : { x: L + 40, y: T + 2, w: 200, h: 48 };
  const toast = { x: 0, y: compact && !land ? T + 94 : T + 54, w, h: 44 };

  // TURBO, the down tab under it
  const ts = compact ? 60 : 72;
  const pad = compact ? 8 : 10;
  const Yt = Math.round(Math.max(T + (land ? 42 : 76), 0.22 * h));
  const turboV = { x: L, y: Yt, w: ts, h: ts };
  const downY = Yt + ts + 4;
  const downH = compact ? 28 : 32;
  const seamY = compact ? downY : downY - 2;
  const turboHit = clip(L - 12, Yt - pad, L + ts + 12, seamY);
  const downV = { x: L, y: downY, w: ts, h: downH };
  const downHit = clip(L - 12, seamY, L + ts + 12, seamY + (compact ? 44 : 46));

  // MEGA: the middle of the right side, the top of what a thumb can hold for 10 s
  const ms = compact ? 68 : 84;
  const megaX = w - R - ms;
  const megaY = Math.round(0.45 * h - ms / 2);
  const megaV = { x: megaX, y: megaY, w: ms, h: ms };
  const megaHit = clip(megaX - 12, megaY - 12, megaX + ms + 6, megaY + ms + 12);
  // the meter (68 x 86): above MEGA, the one side a thumb from below never covers; turned, there is no above
  const meterCharge = land ? { x: megaX - 6 - 68, y: Math.round(megaY + ms / 2 - 43), w: 68, h: 86 } : { x: megaX + (ms - 68) / 2, y: megaY - 6 - 86, w: 68, h: 86 };
  const meterCool = { x: megaX + (ms - 68) / 2, y: megaY + (ms - 68) / 2, w: 68, h: 86 };

  // the chip and the cue: low, centered, clear of the thumbs' rest
  const chipX = Math.floor((w - 200) / 2), chipY = Math.floor(0.78 * h);
  const chip = { v: { x: chipX, y: chipY, w: 200, h: 48 }, hit: { x: chipX - 20, y: chipY - 12, w: 240, h: 72 } };
  const cue = { x: Math.floor((w - 96) / 2), y: Math.round(0.64 * h), w: 96, h: 64 };

  const out: HudLayout = { w, h, compact, swap, toggle, recenter, settings, turbo: { v: turboV, hit: turboHit }, down: { v: downV, hit: downHit }, mega: { v: megaV, hit: megaHit }, chip, readout, toast, meterCharge, meterCool, cue };
  if (swap) {
    // left-handed: everything a thumb works mirrors; the toggle and the top row stay
    for (const c of [out.turbo, out.down, out.mega]) {
      mirror(c.v, w);
      mirror(c.hit, w);
    }
    mirror(out.meterCharge, w);
    mirror(out.meterCool, w);
  }
  return out;
}

function mirror(r: Rect, w: number) {
  r.x = w - r.x - r.w;
}
