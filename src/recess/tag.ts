// A captain's tag on the HUD (recessBoot.ts), in a file of its own so the open world's rivals wear it too (src/rivals/rivalsBoot.ts) without the match's chunk.
import { C, HUD_FONT, PixelCanvas, textWidth } from '../ui/pixelUi';

/** A tag on the HUD: a name and distance over a bus, or a chevron at the screen's edge pointing to it, the name level beside it. */
export class Tag {
  readonly id: number;
  private readonly el: HTMLDivElement;
  private readonly arrow: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly name: string;
  private readonly colour: number;
  private text = '';
  private dim = false;

  constructor(name: string, colour: number, id: number) {
    this.name = name;
    this.colour = colour;
    this.id = id;
    const d = document.createElement('div');
    Object.assign(d.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', zIndex: '21', display: 'none', flexDirection: 'column', alignItems: 'center' });
    d.dataset.hud = 'recess-tag';
    const a = document.createElement('div'), l = document.createElement('div'), c = new PixelCanvas(12, 12, 2);
    c.clear();
    c.textOutlined('▲', 3, 2, colour, C.ink, HUD_FONT);
    c.flush();
    a.append(c.el);
    d.append(a, l);
    document.body.append(d);
    this.el = d;
    this.arrow = a;
    this.label = l;
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  /** Dimmed for this frame (a flash is every other one of these). */
  flash(dim: boolean): void {
    if (dim === this.dim) return;
    this.dim = dim;
    this.el.style.opacity = dim ? '0.25' : '1';
  }

  /** At (x, y) CSS px: over the bus (`angle` null), or at the edge with its arrow pointing `angle` (rad, 0 to the right, up positive) and its name level. */
  show(x: number, y: number, angle: number | null, d: number): void {
    const t = `${this.name}${this.name ? ' ' : ''}${Math.round(d / 10) * 10}M`;
    if (t !== this.text) {
      this.text = t;
      const w = textWidth(t, HUD_FONT) + 6, c = new PixelCanvas(w, 12, 2);
      c.clear();
      c.textOutlined(t, 3, 2, this.colour, C.ink, HUD_FONT);
      c.flush();
      this.label.replaceChildren(c.el);
    }
    this.el.style.display = 'flex';
    this.arrow.style.display = angle === null ? 'none' : 'block';
    // (the name on the side away from the edge it points past: under the arrow, but over it when it points down)
    this.el.style.flexDirection = angle !== null && Math.sin(angle) < -0.3 ? 'column-reverse' : 'column';
    if (angle !== null) this.arrow.style.transform = `rotate(${(Math.PI / 2 - angle).toFixed(3)}rad)`;
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, ${angle === null ? '-100%' : '-50%'})`;
  }
}
