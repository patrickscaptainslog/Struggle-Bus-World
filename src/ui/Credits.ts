// Data credits (ODbL: the baked city is a derivative of OpenStreetMap). Shown small and legible while
// the opening plays, then gone: never a permanent HUD. The tuner lists them too.
//
// main.ts starts it when the opening starts moving (the first region of the city is in, so there is
// something on screen), not at boot, and drives it on the game clock: on a slow phone the city can take
// seconds to arrive and the first frames after it can each take a second (tiles adopted, shaders
// compiled), and a credit on wall-clock timers would fade over the fog bank or a frozen frame. The game
// clock advances at most 50 ms per frame, though, so on a device that stays slow it runs behind the wall
// clock: once the credit is up, it also goes after `wallHold` s of the wall clock, whichever comes first.

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
    const el = document.createElement('div');
    el.textContent = this.text;
    el.setAttribute('role', 'note');
    el.setAttribute('data-sb-credit', '');
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:calc(14px + env(safe-area-inset-bottom, 0px))', 'transform:translateX(-50%)',
      // (max-content: one line when it fits; left:50% alone would shrink-wrap it to half the screen)
      'width:max-content', 'max-width:calc(100vw - 32px)', 'box-sizing:border-box', 'padding:3px 9px', 'border-radius:9px',
      'font:500 11px/1.35 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif',
      'letter-spacing:0.02em', 'color:#e2e4e5', 'background:rgba(46,56,67,0.55)', 'text-align:center',
      'pointer-events:none', 'opacity:0', 'transition:opacity 900ms ease', 'z-index:5',
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
