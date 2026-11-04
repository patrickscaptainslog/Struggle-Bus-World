import { C, HUD_FONT, PixelCanvas, textWidth } from '../ui/pixelUi';

// The trip's easter egg (docs/specs/moon/VOYAGE.md, V2): extremely high over home a button pops up, TO THE MOON?, and high over the Moon TO PLANET EARTH?. It's the one button the
// controls have (CLAUDE.md): it pops in with a bounce, sways a little while it waits, and goes if the bus goes back down. A tap on it is the trip's, and never the game's: nothing under it
// hears the touch.

const PAD = 5;
/** s: the pop, and the gone */
const POP = 0.45;

export class EasterEgg {
  readonly el: HTMLDivElement;
  private on = false;
  private t = 0;
  private id = -1;

  constructor(text: string, qa: string, onTap: () => void) {
    const w = textWidth(text, HUD_FONT) + 2 * PAD + 2, h = 7 + 2 * PAD + 2;
    const c = new PixelCanvas(w, h, 3);
    c.box(0, 0, w, h, C.yellow, C.ink, 3);
    c.textOutlined(text, PAD + 1, PAD + 1, C.text, C.ink, HUD_FONT);
    c.flush();
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'fixed', left: '50%', top: '30%', zIndex: '22', display: 'none', pointerEvents: 'auto', touchAction: 'none', cursor: 'pointer', transformOrigin: '50% 50%' });
    el.dataset.hud = qa;
    el.append(c.el);
    // (a tap on it: down on it and up on it, and the game under it hears none of it)
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      this.id = e.pointerId;
    });
    el.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      if (e.pointerId !== this.id) return;
      this.id = -1;
      const r = el.getBoundingClientRect();
      if (this.on && e.clientX >= r.left - 12 && e.clientX <= r.right + 12 && e.clientY >= r.top - 12 && e.clientY <= r.bottom + 12) onTap();
    });
    el.addEventListener('pointercancel', () => (this.id = -1));
    for (const type of ['touchstart', 'touchmove', 'touchend'] as const)
      el.addEventListener(
        type,
        (e) => {
          e.stopPropagation();
          if (e.cancelable) e.preventDefault();
        },
        { passive: false },
      );
    document.body.append(el);
    this.el = el;
  }

  /** Every frame: up or not, and its pop and its sway. dt: the screen's, s. */
  update(dt: number, up: boolean): void {
    if (up !== this.on) {
      this.on = up;
      this.t = 0;
      if (up) this.el.style.display = 'block';
    }
    this.t += dt;
    const k = Math.min(1, this.t / POP);
    if (!up && k >= 1) {
      this.el.style.display = 'none';
      return;
    }
    // (in: past its size and back, a bounce; out: down to nothing. Waiting, a little sway, so it's seen)
    const s = up ? 1 + 0.25 * Math.sin(k * Math.PI) * (1 - k) * 2 - (1 - k) * (1 - k) : 1 - k * k;
    const sway = up && k >= 1 ? Math.sin(this.t * 2.6) * 3 : 0;
    this.el.style.transform = `translate(-50%, -50%) scale(${Math.max(0, s).toFixed(3)}) rotate(${sway.toFixed(2)}deg)`;
    this.el.dataset.up = up ? '1' : '0';
  }
}
