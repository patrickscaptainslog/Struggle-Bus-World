// Data credits (ODbL: the baked city is a derivative of OpenStreetMap). Shown small and legible on every
// load, then gone: never a permanent HUD. Settings' MAP DATA and the tuner keep them reachable.
//
// main.ts starts it when the first region of the city is in, so there is something on screen, not at
// boot, whichever way the game started (the opening, a tap past it, ?skipintro: this clock is not the
// opening's), and drives it on the game clock: on a slow phone the city can take
// seconds to arrive and the first frames after it can each take a second (tiles adopted, shaders
// compiled), and a credit on wall-clock timers would fade over the fog bank or a frozen frame. The game
// clock advances at most 50 ms per frame, though, so on a device that stays slow it runs behind the wall
// clock: once the credit is up, it also goes after `wallHold` s of the wall clock, whichever comes first.
//
// It is pixel art like everything else on screen: the HUD's small bitmap face in palette colors with an ink outline, at
// the HUD's 2 CSS px per UI pixel, on a canvas placed on whole CSS pixels (a half pixel would make its columns uneven),
// fading in steps like the HUD's own chrome. Two lines on a phone, split where they balance.

import { splitLines } from '../fx/pixelFont';
import { C, HUD_SMALL, PixelCanvas, textWidth, uiText } from './pixelUi';

/** CSS px per UI pixel (the HUD's). */
const S = 2;
/** UI px a line takes: 5 of glyph, an outline above and below, 1 between lines. */
const LINE_H = 8;
/** CSS px kept clear at each side of the screen. */
const SIDE = 16;

export class Credit {
  private el: HTMLDivElement | null = null;
  /** game clock (s) at start() / when it began fading out */
  private t0 = 0;
  private tOut = 0;
  /** wall clock (ms, performance.now()) when it began fading in / out */
  private wall = 0;
  /** 0 waiting, 1 fading in / shown, 2 fading out, 3 gone */
  private stage = 0;

  /**
   * `delay`: game s after start() it fades in; `hold`: game s it stays; then it fades out (0.9 s) and is
   * removed. `wallHold`: wall s after it began fading in that it fades out anyway (0 = the game clock only).
   */
  constructor(
    private readonly text: string,
    private readonly delay = 0.3,
    private readonly hold = 5.8,
    private readonly wallHold = 6.4,
  ) {}

  /** Put it up (game clock `t`, s). Once. */
  start(t: number): void {
    if (this.el || !this.text || typeof document === 'undefined') return;
    const text = uiText(this.text);
    const lines = splitLines(text, Math.floor((window.innerWidth - 2 * SIDE) / S) - 2, HUD_SMALL);
    const w = Math.max(...lines.map((l) => textWidth(l, HUD_SMALL))) + 2;
    const c = new PixelCanvas(w, lines.length * LINE_H, S);
    c.clear();
    lines.forEach((l, i) => c.textOutlined(l, Math.round((w - textWidth(l, HUD_SMALL)) / 2), 1 + i * LINE_H, C.cream, C.ink, HUD_SMALL));
    c.flush();
    // (a canvas's content is its fallback: what a screen reader, and a QA tool's textContent, get)
    c.el.textContent = this.text;
    const el = document.createElement('div');
    el.setAttribute('role', 'note');
    el.setAttribute('data-sb-credit', '');
    el.append(c.el);
    el.style.cssText = [
      'position:fixed', `left:${Math.max(0, Math.round((window.innerWidth - c.w * S) / 2))}px`, 'bottom:calc(14px + env(safe-area-inset-bottom, 0px))',
      'pointer-events:none', 'opacity:0', 'transition:opacity 900ms steps(4)', 'z-index:5',
    ].join(';');
    document.body.appendChild(el);
    this.el = el;
    this.t0 = t;
  }

  /**
   * Every frame with the game clock `t` (s) and the frame's wall clock `now` (ms, performance.now()):
   * fades it in, holds, fades it out, removes it (no allocation).
   */
  update(t: number, now: number): void {
    const el = this.el;
    if (!el || this.stage === 3) return;
    const age = t - this.t0;
    if (this.stage === 0) {
      if (age < this.delay) return;
      this.stage = 1;
      this.wall = now;
      el.style.opacity = '1';
    } else if (this.stage === 1) {
      if (age < this.delay + this.hold && !(this.wallHold > 0 && now - this.wall >= this.wallHold * 1000)) return;
      this.stage = 2;
      this.wall = now;
      this.tOut = t;
      el.style.opacity = '0';
    } else if (t - this.tOut >= 1.2 || (this.wallHold > 0 && now - this.wall >= 1200)) {
      // (the CSS fade runs on the wall clock: 900 ms)
      this.stage = 3;
      el.remove();
    }
  }
}
