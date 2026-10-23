import { HUE_RAMPS, Ramp, RAMP_STEPS, rampColor } from '../render/palette';
import { drawText, FONT_LARGE, measureText } from '../fx/pixelFont';

// The super splat's meter: a little pixel-art ring in the corner, the only UI
// the super has. Same palette as the 3D scene, whole pixels upscaled
// nearest-neighbor (image-rendering: pixelated), the pixel font for numbers.
//
//   ready      a full rainbow ring, a white glint running round it, "HOLD"
//   charging   the ring fills clockwise in bright hues behind a white-hot head;
//              a tick marks where a release becomes a mega blast ("MEGA");
//              the orb in the middle grows and goes white-hot; it trembles
//   firehose   the ring spins white-hot ("HOSE")
//   cooldown   the ring drains, then refills dimly over the cooldown with the
//              seconds left in the middle; a chime + a white pulse when ready
//   not yet    held during the cooldown: the ring blinks red and shakes
//
// It redraws only when what it shows changes (a canvas of 34 x 43 pixels).
// feat/controls' Hud exposes hud.slot('super'): mount(slot) puts the meter
// there; mount() with nothing builds a temporary fixed container top-right.

export interface SuperView {
  phase: 'ready' | 'charging' | 'firehose' | 'cooldown';
  /** 0..1 */
  charge: number;
  /** the share of the charge where a release becomes a mega blast */
  min: number;
  cooldownLeft: number;
  cooldownTotal: number;
  /** seconds since the phase began */
  since: number;
  /** seconds since the last "not yet" */
  sinceDenied: number;
  /** show the "HOLD" hint (until the player has charged once) */
  hint: boolean;
}

const W = 34;
const RING = 34;
const H = RING + 9;
const CX = 17;
const CY = 17;
const SCALE = 2;
const PH = { ready: 0, charging: 1, firehose: 2, cooldown: 3 } as const;

export class SuperMeter {
  readonly el: HTMLDivElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly img: ImageData | null;
  /** per pixel: angle 0..1 clockwise from 12 o'clock, distance from the center */
  private readonly ang = new Float32Array(W * RING);
  private readonly dist = new Float32Array(W * RING);
  /** palette as rgb triples, ramp * 8 + step */
  private readonly rgb = new Uint8Array(32 * RAMP_STEPS * 3);
  private readonly text = new Uint8Array(W * 9);
  private key = -1;
  private t = 0;
  private holder: HTMLDivElement | null = null;
  private shakeX = 0;
  private shakeY = 0;
  private pop = 1;

  constructor() {
    for (let r = 0; r < 32; r++)
      for (let s = 0; s < RAMP_STEPS; s++) {
        const hex = rampColor(r, s);
        const o = (r * RAMP_STEPS + s) * 3;
        this.rgb[o] = parseInt(hex.slice(1, 3), 16);
        this.rgb[o + 1] = parseInt(hex.slice(3, 5), 16);
        this.rgb[o + 2] = parseInt(hex.slice(5, 7), 16);
      }
    for (let y = 0; y < RING; y++)
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - CX, dy = y + 0.5 - CY;
        let a = Math.atan2(dx, -dy) / (Math.PI * 2);
        if (a < 0) a += 1;
        this.ang[y * W + x] = a;
        this.dist[y * W + x] = Math.hypot(dx, dy);
      }
    const el = document.createElement('div');
    el.dataset.sbUi = 'super';
    el.style.cssText = `width:${W * SCALE}px;height:${H * SCALE}px;pointer-events:none;will-change:transform`;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.style.cssText = `display:block;width:${W * SCALE}px;height:${H * SCALE}px;image-rendering:pixelated;image-rendering:crisp-edges`;
    el.appendChild(c);
    this.el = el;
    this.g = c.getContext('2d');
    this.img = this.g ? this.g.createImageData(W, H) : null;
  }

  /** Mount into a container (feat/controls' hud.slot('super')), or with none into a temporary fixed one top-right. */
  mount(parent?: HTMLElement): void {
    if (parent) {
      this.holder?.remove();
      this.holder = null;
      parent.appendChild(this.el);
      return;
    }
    if (!this.holder) {
      const h = document.createElement('div');
      h.dataset.sbUi = 'super-slot';
      h.style.cssText = 'position:fixed;z-index:980;pointer-events:none;top:calc(env(safe-area-inset-top, 0px) + 10px);right:calc(env(safe-area-inset-right, 0px) + 10px)';
      document.body.appendChild(h);
      this.holder = h;
    }
    this.holder.appendChild(this.el);
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
  }

  update(dt: number, v: SuperView): void {
    this.t += dt;
    const t = this.t;
    const ph = PH[v.phase];
    // what it shows, quantized: redraw only when that changes
    let fill = 1;
    let digits = -1;
    let label = 0; // 0 none, 1 HOLD, 2 MEGA, 3 HOSE
    let glint = -1;
    let orb = 0;
    let blink = 0;
    let flash = 0;
    if (v.phase === 'ready') {
      glint = Math.floor(((t * 0.42) % 1) * 64);
      label = v.hint ? 1 : 0;
      flash = v.since < 0.18 ? 2 : v.since < 0.7 ? 1 : 0;
    } else if (v.phase === 'charging') {
      fill = v.charge;
      orb = Math.round(v.charge * 9);
      label = v.charge >= 1 ? 3 : v.charge >= v.min ? 2 : 0;
      flash = v.charge > 0.85 ? (Math.floor(t * 20) & 1) + 1 : 0;
    } else if (v.phase === 'firehose') {
      glint = Math.floor(((t * 2.2) % 1) * 48);
      label = 3;
      flash = Math.floor(t * 15) & 1;
      orb = 9;
    } else {
      fill = v.since < 0.5 ? 1 - v.since / 0.5 : 1 - v.cooldownLeft / Math.max(0.01, v.cooldownTotal);
      digits = v.since < 0.5 ? -1 : Math.max(0, Math.ceil(v.cooldownLeft));
    }
    if (v.sinceDenied < 0.45) blink = (Math.floor(v.sinceDenied / 0.07) & 1) + 1;
    const fq = Math.round(Math.max(0, Math.min(1, fill)) * 128);
    const key = ((((((ph * 129 + fq) * 101 + (digits + 1)) * 4 + label) * 65 + (glint + 1)) * 10 + orb) * 3 + blink) * 3 + flash;
    if (key !== this.key) {
      this.key = key;
      this.draw(v, fill, digits, label, glint, orb, blink, flash);
    }
    // tremble while charging, shake on "not yet", pop when ready: CSS transforms (no redraw)
    let sx = 0, sy = 0;
    if (v.phase === 'charging' && v.charge > 0.25) {
      const a = (v.charge - 0.25) * 2;
      sx = Math.round((Math.random() - 0.5) * a * 2);
      sy = Math.round((Math.random() - 0.5) * a * 2);
    }
    if (v.sinceDenied < 0.45) sx += Math.round(Math.sin(v.sinceDenied * 70) * 4 * (1 - v.sinceDenied / 0.45));
    const pop = v.phase === 'ready' && v.since < 0.5 ? 1 + 0.25 * (1 - v.since / 0.5) : 1;
    if (sx !== this.shakeX || sy !== this.shakeY || pop !== this.pop) {
      this.shakeX = sx;
      this.shakeY = sy;
      this.pop = pop;
      this.el.style.transform = sx || sy || pop !== 1 ? `translate(${sx * SCALE}px,${sy * SCALE}px) scale(${pop.toFixed(3)})` : '';
    }
  }

  private draw(v: SuperView, fill: number, digits: number, label: number, glint: number, orb: number, blink: number, flash: number) {
    const img = this.img;
    const g = this.g;
    if (!img || !g) return;
    const px = img.data;
    px.fill(0);
    const rgb = this.rgb;
    const put = (i: number, ramp: number, step: number) => {
      const o = (ramp * RAMP_STEPS + Math.max(0, Math.min(7, step))) * 3;
      const q = i * 4;
      px[q] = rgb[o];
      px[q + 1] = rgb[o + 1];
      px[q + 2] = rgb[o + 2];
      px[q + 3] = 255;
    };
    const t = this.t;
    const ph = v.phase;
    const minA = v.min;
    for (let i = 0; i < W * RING; i++) {
      const d = this.dist[i];
      if (d >= 16.6) continue;
      const a = this.ang[i];
      if (d >= 15.6 || (d >= 10.6 && d < 11.6)) {
        // ink outlines (the outer one carries the mega tick and the ready pulse)
        const tick = ph === 'charging' && d >= 15.6 && Math.abs(a - minA) < 0.018;
        put(i, tick ? Ramp.GLOW_WHITE : ph === 'ready' && flash > 0 && d >= 15.6 ? Ramp.GLOW_WHITE : Ramp.INK, tick ? 7 : ph === 'ready' && flash > 0 && d >= 15.6 ? 6 : 0);
        continue;
      }
      if (d < 10.6) {
        // the middle: a dark disc, the charge orb
        const r = 1.2 + orb;
        if (orb > 0 && d < r) {
          const hot = ph === 'firehose' || v.charge > 0.85;
          if (hot) put(i, Ramp.GLOW_WHITE, d < r - 1.5 ? 7 : 6);
          else put(i, HUE_RAMPS[Math.floor(((a + t * 0.7) % 1) * 6)], d < r - 1.5 ? 7 : 5);
        } else put(i, Ramp.INK, 2);
        continue;
      }
      const seg = Math.floor(a * 6) % 6;
      if (ph === 'ready') {
        const gq = glint >= 0 ? glint / 64 : -1;
        const near = gq >= 0 && Math.abs(a - gq) < 0.035;
        if (flash === 2) put(i, Ramp.GLOW_WHITE, 7);
        else put(i, near ? Ramp.GLOW_WHITE : HUE_RAMPS[seg], near ? 7 : flash ? 6 : 5);
      } else if (ph === 'charging') {
        if (a < fill) {
          const head = fill - a < 0.04;
          const white = head || (flash > 0 && ((i * 7 + flash * 13) % 5 === 0));
          put(i, white ? Ramp.GLOW_WHITE : HUE_RAMPS[seg], white ? 7 : a < minA ? 5 : 6);
        } else put(i, Ramp.GREY, 2);
      } else if (ph === 'firehose') {
        const s2 = Math.floor((a + glint / 48) * 6) % 6;
        put(i, flash ? Ramp.GLOW_WHITE : HUE_RAMPS[s2], flash ? 7 : 6);
      } else {
        // cooldown: drains bright, then refills dim with a pale head
        if (a < fill) {
          const head = v.since >= 0.5 && fill - a < 0.025;
          put(i, head ? Ramp.WHITE : HUE_RAMPS[seg], head ? 6 : v.since < 0.5 ? 6 : 3);
        } else put(i, Ramp.INK, 3);
      }
      if (blink === 1) put(i, Ramp.RED, 4);
    }
    // seconds left, in the middle
    if (digits >= 0) this.textAt(String(digits), CY - 4, digits <= 5 ? Ramp.GLOW_WHITE : Ramp.WHITE, 7);
    // the label under the ring
    const words = ['', 'HOLD', 'MEGA', 'HOSE'];
    if (label > 0) this.textAt(words[label], RING + 1, label === 1 ? Ramp.WHITE : Ramp.GLOW_WHITE, label === 1 ? 6 : 7);
    g.putImageData(img, 0, 0);
  }

  /** Centered pixel-font text with a 1-px ink shadow, top row y. */
  private textAt(s: string, y: number, ramp: number, step: number) {
    const img = this.img!;
    const m = this.text;
    m.fill(0);
    const w = measureText(s, FONT_LARGE);
    const x0 = Math.floor((W - w) / 2);
    drawText(m, W, 9, s, x0, 1, 1, FONT_LARGE);
    const px = img.data;
    const ink = (Ramp.INK * RAMP_STEPS + 0) * 3;
    const col = (ramp * RAMP_STEPS + step) * 3;
    for (let pass = 0; pass < 2; pass++)
      for (let j = 0; j < 9; j++)
        for (let x = 0; x < W; x++) {
          if (!m[j * W + x]) continue;
          const tx = pass === 0 ? x + 1 : x;
          const ty = y + j - 1 + (pass === 0 ? 1 : 0);
          if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
          const q = (ty * W + tx) * 4;
          const o = pass === 0 ? ink : col;
          px[q] = this.rgb[o];
          px[q + 1] = this.rgb[o + 1];
          px[q + 2] = this.rgb[o + 2];
          px[q + 3] = 255;
        }
  }
}
