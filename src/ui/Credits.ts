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
// fading in steps like the HUD's own chrome. Two lines on a phone, split where they balance; more if a longer credit needs
// them, and laid out again when the window turns. A licence credit can't lose a word: none of it runs off the screen, and a
// letter the bitmap fonts don't have sends the whole line to the system face.

import { splitLines } from '../fx/pixelFont';
import { C, HUD_SMALL, PixelCanvas, textWidth, uiText } from './pixelUi';

/** CSS px per UI pixel (the HUD's). */
const S = 2;
/** UI px a line takes: 5 of glyph, an outline above and below, 1 between lines. */
const LINE_H = 8;
/** CSS px kept clear at each side of the screen. */
const SIDE = 16;
/** The credit in the system face (not a bitmap one: see the top of the file). */
const PLAIN = [
  'left:50%', 'transform:translateX(-50%)', 'width:max-content', 'max-width:calc(100vw - 32px)', 'box-sizing:border-box', 'padding:3px 9px', 'border-radius:9px',
  'font:500 11px/1.35 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif', 'color:#e2e4e5', 'background:rgba(46,56,67,0.55)', 'text-align:center',
].join(';');

/** At most `max` UI px wide: two lines where they balance, else as many as it takes (Hud's MAP DATA wraps the same way). */
function creditLines(text: string, max: number): string[] {
  const two = splitLines(text, max, HUD_SMALL);
  if (two.every((l) => textWidth(l, HUD_SMALL) <= max)) return two;
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, HUD_SMALL) > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export class Credit {
  private el: HTMLDivElement | null = null;
  /** the window width the canvas was laid out for; -1: no canvas (the system face follows the window itself) */
  private iw = -1;
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
    const el = document.createElement('div');
    el.setAttribute('role', 'note');
    el.setAttribute('data-sb-credit', '');
    el.style.cssText = [
      'position:fixed', 'bottom:calc(14px + env(safe-area-inset-bottom, 0px))',
      'pointer-events:none', 'opacity:0', 'transition:opacity 900ms steps(4)', 'z-index:5',
    ].join(';');
    if ([...uiText(this.text)].some((ch) => ch !== ' ' && textWidth(ch, HUD_SMALL) === 0)) {
      el.textContent = this.text;
      el.style.cssText += `;${PLAIN}`;
    } else this.fit(el);
    document.body.appendChild(el);
    this.el = el;
    this.t0 = t;
  }

  /** Lay it out for this window. */
  private fit(el: HTMLDivElement): void {
    this.iw = window.innerWidth;
    const lines = creditLines(uiText(this.text), Math.floor((this.iw - 2 * SIDE) / S) - 2);
    const w = Math.max(...lines.map((l) => textWidth(l, HUD_SMALL))) + 2;
    const c = new PixelCanvas(w, lines.length * LINE_H, S);
    c.clear();
    lines.forEach((l, i) => c.textOutlined(l, Math.round((w - textWidth(l, HUD_SMALL)) / 2), 1 + i * LINE_H, C.cream, C.ink, HUD_SMALL));
    c.flush();
    // (a canvas's content is its fallback: what a screen reader, and a QA tool's textContent, get)
    c.el.textContent = this.text;
    el.replaceChildren(c.el);
    el.style.left = `${Math.max(0, Math.round((this.iw - c.w * S) / 2))}px`;
  }

  /**
   * Every frame with the game clock `t` (s) and the frame's wall clock `now` (ms, performance.now()):
   * fades it in, holds, fades it out, removes it (no allocation, but for a window that turned).
   */
  update(t: number, now: number): void {
    const el = this.el;
    if (!el || this.stage === 3) return;
    if (this.iw >= 0 && window.innerWidth !== this.iw) this.fit(el);
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
