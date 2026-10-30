import { config } from '../config';
import type { Input, InputMode } from '../game/Input';
import { GEAR_NAMES } from '../game/Turbo';
import { Ramp, rampColor } from '../render/palette';
import { C, HUD_FONT, HUD_SMALL, PixelCanvas, textWidth } from './pixelUi';

// The HUD: as little as possible, pixel-styled in palette colors, out of the
// way of the thumb zone and the bus, safe-area aware, readable on a bright
// phone (every glyph has an ink outline).
//
//  - top right, phones only: settings (tilt / touch, tilt sensitivity, recenter,
//    sound) and, in tilt mode, a recenter button. They fade out after a few
//    seconds untouched; a tap in that corner brings them back. A desktop has no
//    buttons at all: Esc opens the settings (src/game/Controls.ts);
//  - top left: the turbo gear readout (gear, name, mph), only for a moment:
//    while a gear lifts and just after it shifts or bites, and while the boost
//    is held; "LOCKED: WORLD TRAVEL COMING" when shifting past the last usable
//    gear;
//  - touch mode: the splat button (tap = splat, hold = charge, slide off =
//    cancel) and the turbo lever (tap the top / bottom = shift, swipe = shift,
//    hold = boost) in the right thumb zone;
//  - slot('super'): a box at the bottom center where the super splat's meter
//    (src/ui/SuperMeter.ts, 68 x 86 CSS px) mounts, centered, sitting on its floor;
//  - setCredits(text): a tiny credits line (bottom left, and in settings);
//  - the first-touch prompt "TILT TO FLY" (its tap is the user gesture iOS
//    needs for the motion permission, and the moment the neutral pose is taken).
//
// The HUD never decides anything: it reports to the callbacks (src/game/
// Controls.ts) and drives Input's HUD hooks (splatButton, turboShift, turboHold).

const S = 2; // CSS px per UI pixel
/** Seconds the top-right buttons stay after the last touch on them (or a change of scheme). */
const CHROME_SECONDS = 6;

export interface HudFrame {
  gear: number;
  maxGear: number;
  engaged: boolean;
  boosting: boolean;
  mph: number;
  /** seconds since the last shift / LOCKED attempt (Infinity = never) */
  sinceShift: number;
  sinceLocked: number;
}

export interface HudCallbacks {
  onMode(m: 'tilt' | 'touch'): void;
  onSensitivity(v: number): void;
  onRecenter(): void;
  onMute(muted: boolean): void;
  /** the prompt's tap: called synchronously inside the gesture (iOS permission) */
  onPromptTilt(): void;
  onPromptTouch(): void;
  /** any HUD gesture (inside it: audio unlock) */
  onGesture(): void;
}

export interface HudSettings {
  tiltAvailable: boolean;
  /** why tilt isn't flying, under the TILT / TOUCH buttons ('' = nothing to say) */
  tiltNote: string;
  sensitivity: number;
  muted: boolean;
}

export const SENS_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2] as const;

type Css = Partial<Record<string, string>>;
function css(el: HTMLElement, s: Css) {
  for (const k in s) (el.style as unknown as Record<string, string>)[k] = s[k]!;
  return el;
}
function div(s: Css = {}): HTMLDivElement {
  return css(document.createElement('div'), s) as HTMLDivElement;
}
/** An event's time on the performance clock (a slow frame must not turn a tap into a hold). */
function evMs(e: Event): number {
  const now = performance.now();
  const t = e.timeStamp;
  // (the upper bound rejects a clock that isn't performance.now(); a very slow frame may deliver events seconds late)
  return t > 0 && t <= now + 50 && now - t < 30000 ? t : now;
}
const safe = (side: 'top' | 'right' | 'bottom' | 'left', px: number) => `max(${px}px, calc(env(safe-area-inset-${side}) + ${Math.round(px * 0.5)}px))`;

export class Hud {
  readonly root: HTMLDivElement;
  private readonly cb: HudCallbacks;
  private readonly input: Input;
  private mode: InputMode = 'touch';
  private settings: HudSettings = { tiltAvailable: false, tiltNote: '', sensitivity: 1, muted: false };
  private credits = '';

  private readonly topRight: HTMLDivElement;
  private readonly settingsBtn: PixelCanvas;
  private readonly recenterBtn: PixelCanvas;
  private readonly gearBox: PixelCanvas;
  private readonly gearWrap: HTMLDivElement;
  private readonly locked: PixelCanvas;
  private readonly lockedWrap: HTMLDivElement;
  private readonly touchPad: HTMLDivElement;
  private readonly splatBtn: PixelCanvas;
  private readonly lever: PixelCanvas;
  private readonly leverLabel: PixelCanvas;
  private readonly superSlot: HTMLDivElement;
  private readonly creditsWrap: HTMLDivElement;
  private panel: HTMLDivElement | null = null;
  private prompt: HTMLDivElement | null = null;
  private promptCard: PixelCanvas | null = null;
  private promptT = 0;
  private toastEl: HTMLDivElement | null = null;
  /** wall-clock ms when the toast goes (UI time: a slow frame rate must not stretch it) */
  private toastUntil = 0;
  private lastNow = 0;

  // last rendered state (re-render only on change; numbers, not string keys: this runs every frame)
  private gearOn = false;
  private gGear = -1;
  private gMax = -1;
  private gMph = -1;
  private gEngaged = false;
  private gBoost = false;
  private lockedOn = false;
  private lockedSh = 0;
  private lvGear = -1;
  private lvMax = -1;
  private lvBoost = false;
  private lvHold = false;
  /** the top-right buttons: shown until this time (performance.now() ms) */
  private chromeUntil = 0;
  private chromeOn = true;
  private splatDown = false;
  private splatId = -1;
  private leverId = -1;
  private leverY0 = 0;
  private leverT0 = 0;
  private leverTop = true;
  private leverUsed = false;
  private leverArmed = false;
  private leverHolding = false;

  constructor(input: Input, cb: HudCallbacks) {
    this.input = input;
    this.cb = cb;
    const root = div({ position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', pointerEvents: 'none', zIndex: '20', userSelect: 'none', webkitUserSelect: 'none', touchAction: 'none' });
    root.setAttribute('data-sb-ui', '');
    root.id = 'sb-hud';
    this.root = root;

    // ---- top right: [recenter] [settings]
    this.topRight = div({ position: 'absolute', top: safe('top', 10), right: safe('right', 10), display: 'flex', flexDirection: 'row', gap: '8px', transition: 'opacity 0.3s steps(3)' });
    this.recenterBtn = new PixelCanvas(20, 20, S);
    this.drawIconButton(this.recenterBtn, 'recenter');
    this.settingsBtn = new PixelCanvas(20, 20, S);
    this.drawIconButton(this.settingsBtn, 'gear');
    // (faded out they still catch the tap, which only brings them back)
    const chrome = (fn: () => void) => () => {
      const was = this.chromeOn;
      this.wakeChrome();
      if (was) fn();
    };
    this.topRight.append(this.hit(this.recenterBtn.el, chrome(() => this.cb.onRecenter()), 'recenter'), this.hit(this.settingsBtn.el, chrome(() => this.openSettings()), 'settings'));
    root.append(this.topRight);

    // ---- top left: gear readout + LOCKED
    this.gearWrap = div({ position: 'absolute', top: safe('top', 12), left: safe('left', 10), display: 'none' });
    this.gearBox = new PixelCanvas(100, 24, S);
    this.gearWrap.append(this.gearBox.el);
    root.append(this.gearWrap);
    this.lockedWrap = div({ position: 'absolute', top: `calc(${safe('top', 12)} + 54px)`, left: '50%', transform: 'translateX(-50%)', display: 'none' });
    this.locked = new PixelCanvas(120, 22, S);
    this.lockedWrap.append(this.locked.el);
    root.append(this.lockedWrap);

    // ---- touch mode: splat button + turbo lever (right thumb zone)
    this.touchPad = div({ position: 'absolute', right: safe('right', 16), bottom: safe('bottom', 22), width: '96px', height: '220px', display: 'none' });
    this.splatBtn = new PixelCanvas(42, 42, S);
    css(this.splatBtn.el, { position: 'absolute', right: '0', bottom: '0', pointerEvents: 'auto', touchAction: 'none' });
    this.splatBtn.el.dataset.hud = 'splat';
    this.lever = new PixelCanvas(24, 46, S);
    css(this.lever.el, { position: 'absolute', right: '18px', bottom: '100px', pointerEvents: 'auto', touchAction: 'none' });
    this.lever.el.dataset.hud = 'lever';
    this.leverLabel = new PixelCanvas(30, 9, S);
    css(this.leverLabel.el, { position: 'absolute', right: '12px', bottom: '196px' });
    this.leverLabel.clear();
    this.leverLabel.textOutlined('TURBO', 3, 2, C.cream, C.ink, HUD_SMALL);
    this.leverLabel.flush();
    this.touchPad.append(this.splatBtn.el, this.lever.el, this.leverLabel.el);
    root.append(this.touchPad);
    this.wireSplat();
    this.wireLever();
    this.drawSplat();

    // ---- the super splat's slot (bottom center): the meter mounts here
    this.superSlot = div({ position: 'absolute', left: '50%', bottom: safe('bottom', 20), width: '176px', height: '86px', transform: 'translateX(-50%)', pointerEvents: 'none', display: 'flex', justifyContent: 'center', alignItems: 'flex-end' });
    this.superSlot.setAttribute('data-slot', 'super');
    this.slots.set('super', this.superSlot);
    root.append(this.superSlot);

    // ---- credits (tiny, bottom left)
    this.creditsWrap = div({ position: 'absolute', left: safe('left', 8), bottom: safe('bottom', 4), display: 'none' });
    root.append(this.creditsWrap);

    document.body.append(root);
    this.setMode('touch');
  }

  private readonly slots = new Map<string, HTMLDivElement>();

  /** A container another module mounts its UI into ('super': the super splat meter, 176 x 86 CSS px, bottom center, its child centered on the floor). */
  slot(name: 'super'): HTMLElement {
    return this.slots.get(name)!;
  }

  /** A tiny credits line (e.g. map data attribution): bottom left and in the settings panel; '' hides it. */
  setCredits(text: string) {
    // (the bitmap fonts have no copyright sign or accents: (C), and accents stripped)
    this.credits = text.replace(/\u00a9/g, '(C)').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    this.creditsWrap.replaceChildren();
    if (!this.credits) {
      this.creditsWrap.style.display = 'none';
      return;
    }
    const w = textWidth(this.credits, HUD_SMALL) + 4;
    const c = new PixelCanvas(w, 9, S);
    c.clear();
    c.textOutlined(this.credits, 2, 2, C.dim, C.ink, HUD_SMALL);
    c.flush();
    this.creditsWrap.append(c.el);
    this.creditsWrap.style.display = 'block';
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
  }

  setSettings(s: Partial<HudSettings>) {
    Object.assign(this.settings, s);
    if (this.panel) this.renderSettings();
  }

  /** Which controls show: tilt (recenter + settings), touch (settings, splat button + turbo lever), keyboard (none: Esc). */
  setMode(m: InputMode) {
    this.mode = m;
    this.touchPad.style.display = m === 'touch' ? 'block' : 'none';
    this.topRight.style.display = m === 'keyboard' ? 'none' : 'flex';
    (this.recenterBtn.el.parentElement as HTMLElement).style.display = m === 'tilt' ? 'block' : 'none';
    if (m !== 'touch') this.releaseButtons();
    this.wakeChrome();
    if (this.panel) this.renderSettings();
  }

  /** The top-right buttons show for a few seconds more. */
  private wakeChrome() {
    this.chromeUntil = performance.now() + CHROME_SECONDS * 1000;
  }

  // ------------------------------------------------------------------ per frame

  update(_dt: number, f: HudFrame) {
    const now = performance.now();
    const dt = this.lastNow ? Math.min(0.25, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    // the top-right buttons fade out while they aren't being used
    const chromeOn = now < this.chromeUntil || this.panel !== null;
    if (chromeOn !== this.chromeOn) {
      this.chromeOn = chromeOn;
      this.topRight.style.opacity = chromeOn ? '1' : '0';
    }
    // gear readout: only for a moment, when something just changed (the contrail and the wind say the rest)
    const showGear = f.boosting || (f.gear > 0 && !f.engaged) || f.sinceShift < 2.5 || f.sinceLocked < 2.5;
    if (showGear !== this.gearOn) {
      this.gearOn = showGear;
      this.gearWrap.style.display = showGear ? 'block' : 'none';
    }
    if (showGear) {
      const mph = f.mph >= 100 ? Math.round(f.mph / 10) * 10 : Math.round(f.mph);
      if (f.gear !== this.gGear || f.maxGear !== this.gMax || f.engaged !== this.gEngaged || f.boosting !== this.gBoost || mph !== this.gMph) {
        this.gGear = f.gear;
        this.gMax = f.maxGear;
        this.gEngaged = f.engaged;
        this.gBoost = f.boosting;
        this.gMph = mph;
        this.drawGear(f, mph);
      }
    }
    // LOCKED
    const lockedOn = f.sinceLocked < 2.2;
    if (lockedOn !== this.lockedOn) {
      this.lockedOn = lockedOn;
      this.lockedWrap.style.display = lockedOn ? 'block' : 'none';
      if (lockedOn) this.drawLocked();
    }
    if (lockedOn) {
      // a short shake, whole CSS pixels (2 = one UI pixel)
      const sh = f.sinceLocked < 0.3 ? (Math.floor(f.sinceLocked * 30) % 2 ? 2 : -2) : 0;
      if (sh !== this.lockedSh) {
        this.lockedSh = sh;
        this.lockedWrap.style.transform = `translateX(calc(-50% + ${sh}px))`;
      }
    }
    // lever: holding it boosts
    // (confirmed on a second frame: a release queued behind one slow frame is still a tap)
    if (this.leverId >= 0 && !this.leverUsed && !this.leverHolding && now - this.leverT0 >= config.splat.holdThreshold * 1000) {
      if (this.leverArmed) {
        this.leverHolding = true;
        this.input.turboHold(true);
      } else this.leverArmed = true;
    }
    if (this.mode === 'touch' && (f.gear !== this.lvGear || f.maxGear !== this.lvMax || f.boosting !== this.lvBoost || this.leverHolding !== this.lvHold)) {
      this.lvGear = f.gear;
      this.lvMax = f.maxGear;
      this.lvBoost = f.boosting;
      this.lvHold = this.leverHolding;
      this.drawLever(f);
    }
    // prompt: the phone rocks
    if (this.prompt && this.promptCard) {
      const before = Math.floor(this.promptT / 0.5);
      this.promptT += dt;
      if (Math.floor(this.promptT / 0.5) !== before) this.drawPrompt();
    }
    if (this.toastEl) {
      if (now >= this.toastUntil) {
        this.toastEl.remove();
        this.toastEl = null;
      }
    }
  }

  /** A short message (one or two lines) under the top of the screen. */
  toast(lines: string[], seconds = 2.2) {
    this.toastEl?.remove();
    const w = Math.max(...lines.map((l) => textWidth(l.toUpperCase(), HUD_FONT))) + 8;
    const c = new PixelCanvas(w, lines.length * 10 + 4, S);
    c.clear();
    lines.forEach((l, i) => {
      const t = l.toUpperCase();
      c.textOutlined(t, Math.round((w - textWidth(t, HUD_FONT)) / 2), 2 + i * 10, i === 0 ? C.text : C.cream, C.ink, HUD_FONT);
    });
    c.flush();
    const wrap = div({ position: 'absolute', left: '50%', top: '27%', transform: 'translateX(-50%)' });
    wrap.append(c.el);
    this.root.append(wrap);
    this.toastEl = wrap;
    this.toastUntil = performance.now() + seconds * 1000;
  }

  // ------------------------------------------------------------------ the first-touch prompt

  /** "TILT TO FLY": its tap requests motion access (iOS) and takes the neutral pose. */
  showPrompt() {
    if (this.prompt) return;
    const ov = div({ position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', pointerEvents: 'auto', touchAction: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px' });
    ov.append(this.ditherLayer(0.25));
    const card = new PixelCanvas(178, 118, S);
    css(card.el, { position: 'relative' });
    this.promptCard = card;
    this.promptT = 0;
    this.drawPrompt();
    const alt = new PixelCanvas(textWidth('USE TOUCH INSTEAD', HUD_SMALL) + 14, 13, S);
    alt.clear();
    alt.box(0, 0, alt.w, alt.h, C.panel, C.edge, 2);
    alt.text('USE TOUCH INSTEAD', 7, 4, C.cream, HUD_SMALL);
    alt.flush();
    css(alt.el, { position: 'relative', marginTop: '10px' });
    alt.el.dataset.hud = 'prompt-touch';
    ov.dataset.hud = 'prompt';
    ov.append(card.el, alt.el);
    let done = false;
    const go = (e: Event, touch: boolean) => {
      if (done) return;
      done = true;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      // (synchronously, inside the gesture, before anything else touches it: iOS shows its motion permission sheet now)
      if (touch) this.cb.onPromptTouch();
      else this.cb.onPromptTilt();
      this.cb.onGesture();
      this.hidePrompt();
    };
    const onAlt = (e: Event) => go(e, true);
    alt.el.addEventListener('touchend', onAlt, { passive: false });
    alt.el.addEventListener('click', onAlt);
    const onTap = (e: Event) => go(e, false);
    ov.addEventListener('touchend', onTap, { passive: false });
    // (the click that follows the tap that opened this card is no answer to it)
    const opened = performance.now();
    ov.addEventListener('click', (e) => {
      if (performance.now() - opened > 450) onTap(e);
    });
    // (block the pointer stream from the game under it)
    ov.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.append(ov);
    this.prompt = ov;
  }

  hidePrompt() {
    this.prompt?.remove();
    this.prompt = null;
    this.promptCard = null;
  }

  get promptOpen(): boolean {
    return this.prompt !== null;
  }

  // ------------------------------------------------------------------ settings

  openSettings() {
    if (this.panel) return;
    this.releaseButtons();
    const ov = div({ position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', pointerEvents: 'auto', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' });
    ov.append(this.ditherLayer(0.5));
    ov.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target === ov || (e.target as HTMLElement).dataset.dither !== undefined) this.closeSettings();
    });
    const col = div({ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '12px 14px 16px', pointerEvents: 'auto', background: rampColor(Ramp.INK, 1), border: `2px solid ${rampColor(Ramp.GREY_LIGHT, 3)}`, boxShadow: `0 0 0 2px ${rampColor(Ramp.INK, 0)}`, imageRendering: 'pixelated' });
    col.addEventListener('pointerdown', (e) => e.stopPropagation());
    ov.append(col);
    ov.dataset.hud = 'panel';
    this.panel = ov;
    this.root.append(ov);
    this.renderSettings();
  }

  closeSettings() {
    this.panel?.remove();
    this.panel = null;
    this.wakeChrome();
  }

  get settingsOpen(): boolean {
    return this.panel !== null;
  }

  private renderSettings() {
    const col = this.panel?.lastElementChild as HTMLDivElement | null;
    if (!col) return;
    col.replaceChildren();
    const W = 150;
    const label = (t: string, c = C.dim) => {
      const p = new PixelCanvas(W, 10, S);
      p.clear();
      p.textOutlined(t, 1, 2, c, C.ink, HUD_SMALL);
      p.flush();
      return p.el;
    };
    const title = new PixelCanvas(W, 13, S);
    title.clear();
    title.textOutlined('SETTINGS', Math.round((W - textWidth('SETTINGS')) / 2), 3, C.yellow, C.ink);
    title.flush();
    col.append(title.el);

    // controls
    col.append(label('CONTROLS'));
    const row = div({ display: 'flex', gap: '6px' });
    if (this.mode === 'keyboard') {
      row.append(this.button('KEYBOARD + MOUSE', W, true, false, () => {}));
    } else {
      row.append(
        this.button('TILT', 72, this.mode === 'tilt', this.settings.tiltAvailable, () => this.cb.onMode('tilt')),
        this.button('TOUCH', 72, this.mode === 'touch', true, () => this.cb.onMode('touch')),
      );
    }
    col.append(row);
    if (this.mode === 'keyboard') {
      // the desktop's whole manual
      for (const t of ['ARROWS / WASD: FLY', 'DOWN CLIMBS, UP DIVES', 'SPACE: SPLAT', 'E / Q: TURBO GEARS', 'SHIFT: BOOST']) col.append(label(t, C.cream));
    } else {
      if (this.settings.tiltNote) col.append(label(this.settings.tiltNote, C.cream));

      // sensitivity
      const tiltOn = this.mode === 'tilt';
      col.append(label('TILT SENSITIVITY', tiltOn ? C.dim : C.edge));
      const srow = div({ display: 'flex', gap: '6px', alignItems: 'center' });
      const si = this.sensIndex();
      const pips = new PixelCanvas(84, 16, S);
      pips.clear();
      for (let i = 0; i < SENS_STEPS.length; i++) {
        const x = 4 + i * 11;
        pips.box(x, 3, 9, 10, i <= si ? (tiltOn ? C.yellow : C.dim) : C.panel, C.ink, 1);
      }
      pips.flush();
      srow.append(
        this.button('-', 28, false, tiltOn && si > 0, () => this.cb.onSensitivity(SENS_STEPS[Math.max(0, si - 1)])),
        pips.el,
        this.button('+', 28, false, tiltOn && si < SENS_STEPS.length - 1, () => this.cb.onSensitivity(SENS_STEPS[Math.min(SENS_STEPS.length - 1, si + 1)])),
      );
      col.append(srow);
      col.append(this.button('RECENTER TILT', W, false, tiltOn, () => this.cb.onRecenter()));
    }

    // sound
    col.append(label('SOUND'));
    const arow = div({ display: 'flex', gap: '6px' });
    arow.append(
      this.button('ON', 72, !this.settings.muted, true, () => this.cb.onMute(false)),
      this.button('OFF', 72, this.settings.muted, true, () => this.cb.onMute(true)),
    );
    col.append(arow);
    if (this.credits) col.append(label(this.credits));
    col.append(this.button('CLOSE', W, false, true, () => this.closeSettings()));
  }

  private sensIndex(): number {
    let best = 0;
    for (let i = 0; i < SENS_STEPS.length; i++) if (Math.abs(SENS_STEPS[i] - this.settings.sensitivity) < Math.abs(SENS_STEPS[best] - this.settings.sensitivity)) best = i;
    return best;
  }

  /** A pixel button (selected = bus yellow, disabled = dim); fires on a tap that ends on it. */
  private button(text: string, w: number, selected: boolean, enabled: boolean, fn: () => void): HTMLElement {
    const h = 16;
    const p = new PixelCanvas(w, h, S);
    p.clear();
    p.box(0, 0, w, h, selected ? C.yellow : enabled ? C.panel2 : C.panel, selected ? C.yellowHi : enabled ? C.edge : C.panel2, 2);
    const tw = textWidth(text);
    p.text(text, Math.round((w - tw) / 2), 5, selected ? C.ink : enabled ? C.text : C.edge);
    p.flush();
    if (!enabled) return p.el;
    return this.hit(
      p.el,
      () => {
        fn();
        if (this.panel) this.renderSettings();
      },
      text.toLowerCase(),
    );
  }

  // ------------------------------------------------------------------ widgets

  /** Pointer-safe tap target: fires on a release over it, never leaks to the game. */
  private hit(el: HTMLElement, fn: () => void, qa = ''): HTMLElement {
    const wrap = div({ pointerEvents: 'auto', touchAction: 'none', cursor: 'pointer' });
    if (qa) wrap.dataset.hud = qa;
    wrap.append(el);
    let id = -1;
    wrap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      id = e.pointerId;
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
        /* gone */
      }
    });
    wrap.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      if (e.pointerId !== id) return;
      id = -1;
      const r = wrap.getBoundingClientRect();
      if (e.clientX < r.left - 10 || e.clientX > r.right + 10 || e.clientY < r.top - 10 || e.clientY > r.bottom + 10) return;
      this.cb.onGesture();
      fn();
    });
    wrap.addEventListener('pointercancel', () => (id = -1));
    // (no ghost click after the tap: it would land on whatever the tap just opened)
    wrap.addEventListener(
      'touchend',
      (e) => {
        if (e.cancelable) e.preventDefault();
      },
      { passive: false },
    );
    return wrap;
  }

  private ditherLayer(density: 0.25 | 0.5): HTMLElement {
    // (square: a turned phone keeps it covered)
    const w = Math.ceil(Math.max(window.innerWidth, window.innerHeight) / S) + 1, h = w;
    const d = new PixelCanvas(w, h, S);
    d.clear();
    d.dither(C.ink, density);
    d.flush();
    css(d.el, { position: 'absolute', left: '0', top: '0' });
    d.el.dataset.dither = '';
    return d.el;
  }

  private releaseButtons() {
    if (this.splatDown) {
      this.splatDown = false;
      this.splatId = -1;
      this.input.splatButton(false, true);
      this.drawSplat();
    }
    if (this.leverId >= 0) {
      this.leverId = -1;
      if (this.leverHolding) this.input.turboHold(false);
      this.leverHolding = false;
    }
  }

  private wireSplat() {
    const el = this.splatBtn.el;
    const inside = (e: PointerEvent, m: number) => {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left - m && e.clientX <= r.right + m && e.clientY >= r.top - m && e.clientY <= r.bottom + m;
    };
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (this.splatDown) return;
      this.cb.onGesture();
      this.splatDown = true;
      this.splatId = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* gone */
      }
      this.input.splatButton(true, false, evMs(e));
      this.drawSplat();
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.splatDown || e.pointerId !== this.splatId) return;
      // slid off the button into a steer: the press is cancelled (a charge ends cancelled)
      if (!inside(e, 34)) {
        this.splatDown = false;
        this.splatId = -1;
        this.input.splatButton(false, true, evMs(e));
        this.drawSplat();
      }
    });
    const up = (e: PointerEvent, cancel: boolean) => {
      e.stopPropagation();
      if (!this.splatDown || e.pointerId !== this.splatId) return;
      this.splatDown = false;
      this.splatId = -1;
      this.input.splatButton(false, cancel || !inside(e, 34), evMs(e));
      this.drawSplat();
    };
    el.addEventListener('pointerup', (e) => up(e, false));
    el.addEventListener('pointercancel', (e) => up(e, true));
  }

  private wireLever() {
    const el = this.lever.el;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (this.leverId >= 0) return;
      this.cb.onGesture();
      this.leverId = e.pointerId;
      this.leverY0 = e.clientY;
      this.leverT0 = evMs(e);
      this.leverArmed = false;
      this.leverUsed = false;
      this.leverHolding = false;
      const r = el.getBoundingClientRect();
      this.leverTop = e.clientY < r.top + r.height / 2;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* gone */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.leverId || this.leverUsed || this.leverHolding) return;
      const dy = e.clientY - this.leverY0;
      if (Math.abs(dy) > 26) {
        // a swipe on the lever shifts too
        this.leverUsed = true;
        this.input.turboShift(dy < 0 ? 1 : -1);
      }
    });
    const up = (e: PointerEvent, cancel: boolean) => {
      e.stopPropagation();
      if (e.pointerId !== this.leverId) return;
      this.leverId = -1;
      const quick = evMs(e) - this.leverT0 < config.splat.holdThreshold * 1000;
      if (this.leverHolding) this.input.turboHold(false);
      else if (!this.leverUsed && !cancel && quick) this.input.turboShift(this.leverTop ? 1 : -1);
      this.leverHolding = false;
    };
    el.addEventListener('pointerup', (e) => up(e, false));
    el.addEventListener('pointercancel', (e) => up(e, true));
  }

  // ------------------------------------------------------------------ drawing

  private drawIconButton(p: PixelCanvas, icon: 'gear' | 'recenter') {
    p.clear();
    p.box(0, 0, 20, 20, C.panel, C.edge, 3);
    const c = C.cream;
    if (icon === 'gear') {
      // a cog: ring + 8 teeth
      for (let j = 0; j < 20; j++)
        for (let i = 0; i < 20; i++) {
          const dx = i + 0.5 - 10, dy = j + 0.5 - 10;
          const r = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx);
          const tooth = Math.cos(a * 8) > 0.35 ? 1.6 : 0;
          if (r <= 5.2 + tooth && r >= 2.3) p.set(i, j, c);
        }
    } else {
      // a crosshair: ring + ticks + center dot
      for (let j = 0; j < 20; j++)
        for (let i = 0; i < 20; i++) {
          const dx = i + 0.5 - 10, dy = j + 0.5 - 10;
          const r = Math.hypot(dx, dy);
          if (r <= 5.6 && r >= 4.4) p.set(i, j, c);
        }
      p.rect(9, 3, 2, 4, c);
      p.rect(9, 13, 2, 4, c);
      p.rect(3, 9, 4, 2, c);
      p.rect(13, 9, 4, 2, c);
      p.rect(9, 9, 2, 2, C.yellow);
    }
    p.flush();
  }

  private drawSplat() {
    const p = this.splatBtn;
    p.clear();
    const cx = 21, cy = 21;
    p.disc(cx, cy, 20.5, C.ink);
    // a rainbow pinwheel ring (the blast's own layout)
    for (let j = 0; j < 42; j++)
      for (let i = 0; i < 42; i++) {
        const dx = i + 0.5 - cx, dy = j + 0.5 - cy;
        const r = Math.hypot(dx, dy);
        if (r > 19.2 || r < 12.5) continue;
        const a = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2) + r * 0.012;
        const h = Math.floor(((a % 1) + 1) * 6) % 6;
        p.set(i, j, this.splatDown ? C.hueHi[h] : r > 17.5 ? C.hueLo[h] : C.hue[h]);
      }
    p.disc(cx, cy, 12, this.splatDown ? C.yellow : C.panel);
    const t = 'SPLAT';
    p.text(t, Math.round(cx - textWidth(t, HUD_SMALL) / 2), cy - 3, this.splatDown ? C.ink : C.cream, HUD_SMALL);
    p.flush();
  }

  private drawLever(f: HudFrame) {
    const p = this.lever;
    p.clear();
    const hot = f.boosting || this.leverHolding;
    p.box(0, 0, 24, 46, C.panel, hot ? C.yellowHi : C.edge, 3);
    if (hot) {
      p.rect(2, 2, 20, 1, C.yellowLo);
      p.rect(2, 43, 20, 1, C.yellowLo);
    }
    const canUp = f.gear < 3; // (shifting past the last usable gear still answers: LOCKED)
    const upC = f.gear < f.maxGear ? C.text : C.dim;
    p.text('▲', 9 - 1, 4, canUp ? upC : C.panel2, HUD_FONT);
    p.rect(3, 14, 18, 1, C.panel2);
    const g = `G${f.gear}`;
    p.textOutlined(g, Math.round(12 - textWidth(g) / 2), 19, f.gear > 0 ? C.yellow : C.cream, C.ink);
    p.rect(3, 31, 18, 1, C.panel2);
    p.text('▼', 8, 35, f.gear > 0 ? C.text : C.panel2, HUD_FONT);
    p.flush();
  }

  private drawGear(f: HudFrame, mph: number) {
    const p = this.gearBox;
    p.clear();
    const g = `G${f.gear}`;
    this.outlineOver(p, g, 2, 2, C.yellow);
    const x = 2 + textWidth(g) + 5;
    const name = GEAR_NAMES[Math.min(3, f.gear)] + (f.boosting ? ' +' : '');
    this.outlineOver(p, name, x, 2, f.engaged || f.gear === 0 ? C.cream : C.dim);
    // pips: one per gear; lit up to the gear, dim if usable, dark if locked
    for (let i = 1; i <= 3; i++) {
      const px = 2 + (i - 1) * 8;
      const lit = i <= f.gear;
      const usable = i <= f.maxGear;
      p.box(px, 13, 7, 6, lit ? C.yellow : usable ? C.panel2 : C.ink, C.ink, 1);
      if (!usable) {
        p.set(px + 2, 15, C.redLo);
        p.set(px + 3, 16, C.redLo);
        p.set(px + 4, 17, C.redLo);
      }
    }
    const sp = `${mph} MPH`;
    this.outlineOver(p, sp, 30, 14, C.text, HUD_SMALL);
    p.flush();
  }

  /** Outlined text drawn over what's already in the canvas (textOutlined works on a fresh mask per call). */
  private outlineOver(p: PixelCanvas, t: string, x: number, y: number, c: number, font = HUD_FONT) {
    // outline: the text stamped in ink at the 8 neighbors, then the text itself
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj) p.text(t, x + di, y + dj, C.ink, font);
    p.text(t, x, y, c, font);
  }

  private drawLocked() {
    const p = this.locked;
    p.clear();
    const a = 'LOCKED:';
    const b = 'WORLD TRAVEL COMING';
    this.outlineOver(p, a, Math.round((p.w - textWidth(a)) / 2), 2, C.red);
    this.outlineOver(p, b, Math.round((p.w - textWidth(b, HUD_SMALL)) / 2), 13, C.cream, HUD_SMALL);
    p.flush();
  }

  private drawPrompt() {
    const p = this.promptCard;
    if (!p) return;
    p.clear();
    p.box(0, 0, p.w, p.h, C.panel, C.edge, 4);
    const W = p.w;
    const title = 'TILT TO FLY';
    // the title at 2x UI pixels: drawn big by stamping each glyph pixel as 2 x 2
    const tw = textWidth(title) * 2;
    this.bigText(p, title, Math.round((W - tw) / 2), 8, C.yellow);
    // a phone rocking left / right
    const phase = Math.floor(this.promptT / 0.5) % 4;
    const ang = phase === 0 ? -0.22 : phase === 2 ? 0.22 : 0;
    this.phone(p, W / 2, 46, ang);
    const lines = ['HOLD IT THE WAY YOU LIKE: THAT IS LEVEL', 'TILT TO STEER  -  TOP TOWARD YOU CLIMBS', 'TAP TO SPLAT  -  SWIPE UP FOR TURBO'];
    lines.forEach((l, i) => p.text(l, Math.round((W - textWidth(l, HUD_SMALL)) / 2), 70 + i * 9, i === 0 ? C.text : C.cream, HUD_SMALL));
    if (Math.floor(this.promptT / 0.5) % 2 === 0) {
      const t = 'TAP TO FLY';
      this.outlineOver(p, t, Math.round((W - textWidth(t)) / 2), 101, C.yellowHi);
    }
    p.flush();
  }

  private bigTmp: PixelCanvas | null = null;

  private bigText(p: PixelCanvas, t: string, x: number, y: number, c: number) {
    const tmp = this.bigTmp && this.bigTmp.w === textWidth(t) + 2 ? this.bigTmp : (this.bigTmp = new PixelCanvas(textWidth(t) + 2, 9, 1));
    tmp.clear();
    tmp.text(t, 1, 1, 1);
    for (let j = 0; j < tmp.h; j++)
      for (let i = 0; i < tmp.w; i++) {
        if (!tmp.get(i, j)) continue;
        for (let dj = -1; dj <= 2; dj++) for (let di = -1; di <= 2; di++) if (!p.get(x + (i - 1) * 2 + di, y + (j - 1) * 2 + dj) || p.get(x + (i - 1) * 2 + di, y + (j - 1) * 2 + dj) === C.panel) p.set(x + (i - 1) * 2 + di, y + (j - 1) * 2 + dj, C.ink);
      }
    for (let j = 0; j < tmp.h; j++)
      for (let i = 0; i < tmp.w; i++) {
        if (!tmp.get(i, j)) continue;
        p.rect(x + (i - 1) * 2, y + (j - 1) * 2, 2, 2, c);
      }
  }

  /** A little phone (screen + bezel) rotated by `ang`, centered at (cx, cy). */
  private phone(p: PixelCanvas, cx: number, cy: number, ang: number) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let j = -16; j <= 16; j++)
      for (let i = -16; i <= 16; i++) {
        // rotate back into the phone's frame
        const x = (i + 0.5) * ca + (j + 0.5) * sa, y = -(i + 0.5) * sa + (j + 0.5) * ca;
        if (Math.abs(x) > 8 || Math.abs(y) > 13) continue;
        const bezel = Math.abs(x) > 6.5 || Math.abs(y) > 11;
        const notch = !bezel && y < -9.5 && Math.abs(x) < 2;
        // the screen shows a tiny yellow bus over grey
        const bus = !bezel && Math.abs(x) < 3 && y > -2 && y < 2;
        p.set(Math.floor(cx + i), Math.floor(cy + j), bezel || notch ? C.edge : bus ? C.yellow : C.panel2);
      }
  }
}
