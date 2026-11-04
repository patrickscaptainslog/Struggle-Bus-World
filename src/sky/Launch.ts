// The launch from the street (docs/specs/moon/VOYAGE.md). At the top of the sky a bus that goes on pulling up leaves the air: the sky over it goes dark and the stars come out, and when the dark has the
// whole screen the page is ?moonland's, climbing over the same place the way the bus was flying (MoonTrip's `launch`). The producer: "I want to fly up high from San Francisco surface and eventually get
// so so high, extremely high, that an "Easter egg" button appears "to the moon?"". Let go short of it and the dark goes again, as the egg goes when the bus goes back down.
//
// It's a page of its own up there, and the dark is what stands between the two while space loads. Paint is saved on the way out, as on any page that's left (GroundPaint, PaintState: pagehide).

/** s of straining at the top before the dark has the whole screen, and how fast it goes again when the pull stops. */
const RISE_S = 3.2;
const FALL_S = 1.2;
/** s the screen stands black before the page goes. */
const HOLD_S = 0.25;
/** Game px a star, on average: about 120 of them on a phone. */
const STAR_PX = 300;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Launch {
  private c = 0;
  private black = 0;
  private gone = false;
  private readonly root: HTMLDivElement;
  private readonly shade: HTMLDivElement;
  private readonly stars: HTMLCanvasElement;
  private readonly dark: HTMLDivElement;

  /** where: the page to go to, asked once, as it goes. */
  constructor(private readonly where: () => string) {
    const div = (style: Partial<CSSStyleDeclaration>) => {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'fixed', inset: '0', pointerEvents: 'none', opacity: '0' }, style);
      return d;
    };
    this.root = div({ zIndex: '40', display: 'none', opacity: '1' });
    this.root.dataset.hud = 'launch';
    // (the sky over the bus goes first: from the top of the screen down)
    this.shade = div({ background: 'linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.85) 30%, rgba(0,0,0,0) 72%)' });
    // the stars, in game pixels, where the sky has gone dark
    const W = Math.max(1, Math.ceil(window.innerWidth / 3)), H = Math.max(1, Math.ceil(window.innerHeight / 3));
    this.stars = document.createElement('canvas');
    this.stars.width = W;
    this.stars.height = H;
    const mask = 'linear-gradient(to bottom, #000 0%, #000 25%, transparent 62%)';
    Object.assign(this.stars.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', imageRendering: 'pixelated', opacity: '0', webkitMaskImage: mask, maskImage: mask });
    const g = this.stars.getContext('2d');
    if (g) {
      const tint = ['#ffffff', '#dfe8ff', '#fff3d6', '#c9d4e8'];
      for (let i = 0, n = Math.round((W * H) / STAR_PX); i < n; i++) {
        g.fillStyle = tint[i % tint.length];
        g.globalAlpha = 0.45 + 0.55 * Math.random();
        const big = Math.random() < 0.08 ? 2 : 1;
        g.fillRect(Math.floor(Math.random() * W), Math.floor(Math.random() * H * 0.7), big, big);
      }
    }
    this.dark = div({ background: '#000' });
    this.root.append(this.shade, this.stars, this.dark);
    document.body.append(this.root);
  }

  /** 0..1: how far into the dark it is. */
  get charge(): number {
    return this.c;
  }

  /** Every frame. dt: the screen's, s. straining: the bus is at the top of the sky and pulling up. */
  update(dt: number, straining: boolean): void {
    if (this.gone) return;
    this.c = straining ? Math.min(1, this.c + dt / RISE_S) : Math.max(0, this.c - dt / FALL_S);
    this.root.style.display = this.c > 0 ? 'block' : 'none';
    if (this.c <= 0) return;
    this.shade.style.opacity = smooth(0, 0.6, this.c).toFixed(3);
    this.stars.style.opacity = smooth(0.15, 0.6, this.c).toFixed(3);
    this.dark.style.opacity = smooth(0.6, 1, this.c).toFixed(3);
    this.black = this.c >= 1 ? this.black + dt : 0;
    if (this.black >= HOLD_S) {
      this.gone = true;
      location.assign(this.where());
    }
  }
}
