import { inputTune, type Input, type InputMode } from '../game/Input';
import { GEAR_NAMES } from '../game/Turbo';
import { Ramp, rampColor } from '../render/palette';
import type { Cue } from './Coach';
import { isCompact, layoutHud, type Control, type HudLayout, type Insets, type Rect } from './hudLayout';
import { C, HUD_FONT, HUD_SMALL, PixelCanvas, textWidth, uiText } from './pixelUi';

// The HUD: as little as possible, pixel-styled in palette colors, safe-area
// aware, readable on a bright phone (every glyph has an ink outline). Everything
// sits where src/ui/hudLayout.ts says (a pure function, run on resize only), and
// every button redraws only when what it shows changes.
//
//  - MEGA (the middle of the right side): tap = splat, hold = charge. The meter
//    (slot('super'), src/ui/SuperMeter.ts) stands above it and docks on its face
//    for the cooldown.
//  - top right: settings. It fades out after a few seconds untouched; a tap in
//    that corner brings it back.
//  - the gear readout, only for a moment: while a gear lifts and just after it
//    shifts or bites or turbo changes, while Shift holds the boost, and ARMED while
//    a gear waits (for a second flick, for the opening's gate); it never stays up
//    for a latched turbo. LOCKED: WORLD TRAVEL COMING past the last usable gear.
//  - the first-run cues (src/ui/Coach.ts). Cues pass every touch through.
//  - a desktop has no buttons at all: Esc opens the settings (src/game/Controls.ts).
//  - setCredits(lines): the data credits, one tap away in settings (MAP DATA), never on the play screen.
//
// Only these catch touches: MEGA, settings. Everything else is pointer-events
// none. Hit wrappers are the rects from hudLayout, and the visuals inside them
// are pointer-events none, so the 14 px band at the screen's edges stays the
// canvas's. There is no gear strip and no button for a gear: a flick is the
// whole of it (src/game/Input.ts, src/game/Shifter.ts).
//
// The HUD never decides anything: it reports to the callbacks (src/game/
// Controls.ts) and drives Input's HUD hooks.

const S = 2; // CSS px per UI pixel
/** Seconds the top-right buttons stay after the last touch on them (or a change of scheme). */
const CHROME_SECONDS = 6;
/** Seconds untouched before MEGA goes to its see-through rest. */
const REST_SECONDS = 8;
/** The blink step of everything that blinks (ms). */
const BLINK_MS = 220;

export type MegaPhase = 'ready' | 'charging' | 'firehose' | 'cooldown';

export interface HudFrame {
  gear: number;
  maxGear: number;
  engaged: boolean;
  /** the turbo level on (latched or held, 0: off), and whether Shift is holding it: only a held boost keeps the readout up */
  level: number;
  held: boolean;
  mph: number;
  /** a gear is waiting (a second flick's window, the opening's gate): the next gear shows armed (dim, blinking), it fires by itself */
  armed: boolean;
  /** seconds since the last shift / LOCKED attempt (Infinity = never) */
  sinceShift: number;
  sinceLocked: number;
}

export interface HudCallbacks {
  onMute(muted: boolean): void;
  onSwap(swap: boolean): void;
  /** any HUD gesture (inside it: audio unlock) */
  onGesture(): void;
}

export interface HudSettings {
  muted: boolean;
  swap: boolean;
}

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
const PHASES: readonly MegaPhase[] = ['ready', 'charging', 'firehose', 'cooldown'];

export class Hud {
  readonly root: HTMLDivElement;
  private readonly cb: HudCallbacks;
  private readonly input: Input;
  private readonly compact: boolean;
  private readonly insetProbe: HTMLDivElement;
  private mode: InputMode = 'touch';
  private settings: HudSettings = { muted: false, swap: false };
  private credits: string[] = [];
  /** the settings panel shows the credits instead of its controls */
  private creditsOpen = false;
  /** the rects in force */
  L: HudLayout;
  /** MEGA has arrived (fog end or first touch) */
  private arrived = false;

  private readonly topRight: HTMLDivElement;
  private readonly settingsBtn: PixelCanvas;
  private readonly settingsWrap: HTMLElement;
  private readonly gearBox: PixelCanvas;
  private readonly gearWrap: HTMLDivElement;
  private readonly locked: PixelCanvas;
  private readonly lockedWrap: HTMLDivElement;
  private readonly mega: PixelCanvas;
  private readonly megaWrap: HTMLDivElement;
  private readonly cueCanvas: PixelCanvas;
  private readonly cueWrap: HTMLDivElement;
  private readonly superSlot: HTMLDivElement;
  private panel: HTMLDivElement | null = null;
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
  private gLevel = 0;
  private gArmed = false;
  private gBlink = false;
  private lockedOn = false;
  private lockedSh = 0;
  private megaKey = -1;
  private cueKey = -1;
  /** the settings button: shown until this time (performance.now() ms) */
  private chromeUntil = 0;
  private chromeOn = true;
  /** MEGA rests from this time */
  private restAt = 0;
  // MEGA's press
  private megaId = -1;
  private megaX0 = 0;
  private megaY0 = 0;
  private megaT0 = 0;
  private megaDown = false;
  /** the pointer MEGA handed to the canvas: if the browser keeps sending it here, it is forwarded */
  private adoptedId = -1;
  private megaPhase: MegaPhase = 'ready';
  /** the meter's on the face (the cooldown, and the pop after it) */
  private meterDocked = false;
  /** MEGA's HOLD cue: steps left, seconds in this step */
  private megaCue = 0;
  private megaCueT = 0;
  private cue: Cue = 'none';

  private readonly slots = new Map<string, HTMLDivElement>();
  private readonly onResize = () => this.layout();
  private readonly onTurned = () => {
    this.layout();
    // (iOS settles the insets a beat after the turn)
    window.setTimeout(this.onResize, 350);
  };
  private readonly onHide = () => {
    if (document.hidden) this.releaseButtons();
  };
  private readonly onBlur = () => this.releaseButtons();

  constructor(input: Input, cb: HudCallbacks) {
    this.input = input;
    this.cb = cb;
    const w0 = window.innerWidth, h0 = window.innerHeight;
    this.compact = isCompact(w0, h0);
    const root = div({ position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', pointerEvents: 'none', zIndex: '20', userSelect: 'none', webkitUserSelect: 'none', touchAction: 'none' });
    root.setAttribute('data-sb-ui', '');
    root.id = 'sb-hud';
    this.root = root;
    this.insetProbe = div({ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', paddingTop: 'env(safe-area-inset-top)', paddingRight: 'env(safe-area-inset-right)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)' });
    root.append(this.insetProbe);

    // ---- top right: settings
    this.topRight = div({ position: 'absolute', left: '0', top: '0', width: '0', height: '0', transition: 'opacity 0.3s steps(3)' });
    this.settingsBtn = new PixelCanvas(20, 20, S);
    this.drawIconButton(this.settingsBtn);
    // (faded out they still catch the tap, which only brings them back)
    const chrome = (fn: () => void) => () => {
      const was = this.chromeOn;
      this.wakeChrome();
      if (was) fn();
    };
    this.settingsWrap = this.hit(this.settingsBtn.el, chrome(() => this.openSettings()), 'settings');
    css(this.settingsWrap, { position: 'absolute' });
    this.topRight.append(this.settingsWrap);
    root.append(this.topRight);

    // ---- the gear readout + the LOCKED banner
    this.gearWrap = div({ position: 'absolute', display: 'none' });
    this.gearBox = new PixelCanvas(100, 24, S);
    this.gearWrap.append(this.gearBox.el);
    root.append(this.gearWrap);
    this.lockedWrap = div({ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'none' });
    this.locked = new PixelCanvas(120, 22, S);
    this.lockedWrap.append(this.locked.el);
    root.append(this.lockedWrap);

    // ---- the buttons: a hit wrapper, the visual inside it
    const ms = this.compact ? 34 : 42;
    this.mega = new PixelCanvas(ms, ms, S);
    this.megaWrap = this.button2(this.mega, 'mega');
    root.append(this.megaWrap);
    this.wireMega();

    // ---- the first-run cue (passes everything through)
    this.cueWrap = div({ position: 'absolute', display: 'none' });
    this.cueCanvas = new PixelCanvas(48, 32, S);
    this.cueWrap.append(this.cueCanvas.el);
    this.cueWrap.dataset.hud = 'cue';
    root.append(this.cueWrap);

    // ---- the super splat's slot: the meter (68 x 86) mounts here; where it stands depends on the phase
    this.superSlot = div({ position: 'absolute', width: '68px', height: '86px', pointerEvents: 'none' });
    this.superSlot.setAttribute('data-slot', 'super');
    this.slots.set('super', this.superSlot);
    root.append(this.superSlot);

    document.body.append(root);
    this.L = layoutHud(w0, h0, this.readInsets(), false, this.compact);
    this.layout();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onTurned);
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('blur', this.onBlur);
    this.setMode('touch');
  }

  /** A container another module mounts its UI into ('super': the super splat meter, 68 x 86 CSS px, above MEGA). */
  slot(name: 'super'): HTMLElement {
    return this.slots.get(name)!;
  }

  /** The data credits, one entry each (the map's attribution first): settings' MAP DATA shows them; [] hides that button. */
  setCredits(lines: string[]) {
    this.credits = lines.map(uiText);
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
  }

  setSettings(s: Partial<HudSettings>) {
    const swapped = s.swap !== undefined && s.swap !== this.settings.swap;
    Object.assign(this.settings, s);
    if (swapped) this.layout();
    if (this.panel) this.renderSettings();
  }

  /** Touch shows the buttons, keyboard none (Esc). */
  setMode(m: InputMode) {
    this.mode = m;
    this.showChrome();
    if (m !== 'touch') this.releaseButtons();
    this.wakeChrome();
    if (this.panel) this.renderSettings();
  }

  /** MEGA arrives (fog end, or the first touch). */
  arrive() {
    if (this.arrived) return;
    this.arrived = true;
    this.wakeButtons();
    this.wakeChrome();
    this.showChrome();
  }

  private readonly shown = new Map<HTMLElement, boolean>();
  private show(el: HTMLElement, on: boolean) {
    if (this.shown.get(el) === on) return;
    this.shown.set(el, on);
    el.style.display = on ? 'block' : 'none';
  }

  private showChrome() {
    const on = this.arrived && this.mode === 'touch';
    this.show(this.topRight, on);
    this.show(this.megaWrap, on);
  }

  /** The settings button shows for a few seconds more. */
  private wakeChrome() {
    this.chromeUntil = performance.now() + CHROME_SECONDS * 1000;
  }

  /** MEGA comes back from its rest. */
  private wakeButtons() {
    this.restAt = performance.now() + REST_SECONDS * 1000;
  }

  // ------------------------------------------------------------------ layout (resize only)

  private readInsets(): Insets {
    const s = getComputedStyle(this.insetProbe);
    const n = (v: string) => parseFloat(v) || 0;
    return { top: n(s.paddingTop), right: n(s.paddingRight), bottom: n(s.paddingBottom), left: n(s.paddingLeft) };
  }

  private layout() {
    const L = layoutHud(window.innerWidth, window.innerHeight, this.readInsets(), this.settings.swap, this.compact);
    this.L = L;
    this.place(this.settingsWrap, this.settingsBtn, L.settings);
    this.place(this.megaWrap, this.mega, L.mega);
    this.box(this.gearWrap, L.readout);
    this.lockedWrap.style.top = `${L.toast.y}px`;
    if (this.toastEl) this.toastEl.style.top = `${L.toast.y}px`;
    this.box(this.cueWrap, L.cue);
    this.placeMeter();
  }

  private box(el: HTMLElement, r: Rect) {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
  }

  private place(wrap: HTMLElement, c: PixelCanvas, r: Control) {
    this.box(wrap, r.hit);
    wrap.style.width = `${r.hit.w}px`;
    wrap.style.height = `${r.hit.h}px`;
    c.el.style.left = `${r.v.x - r.hit.x}px`;
    c.el.style.top = `${r.v.y - r.hit.y}px`;
  }

  private placeMeter() {
    this.box(this.superSlot, this.meterDocked ? this.L.meterCool : this.L.meterCharge);
  }

  // ------------------------------------------------------------------ per frame

  update(_dt: number, f: HudFrame) {
    const now = performance.now();
    const dt = this.lastNow ? Math.min(0.25, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    // the settings button fades out while it isn't being used
    const chromeOn = now < this.chromeUntil || this.panel !== null;
    if (chromeOn !== this.chromeOn) {
      this.chromeOn = chromeOn;
      this.topRight.style.opacity = chromeOn ? '1' : '0';
    }
    // gear readout: only for a moment, when something just changed (the contrail and the wind say the rest)
    const showGear = f.armed || f.held || (f.gear > 0 && !f.engaged) || f.sinceShift < 2.5 || f.sinceLocked < 2.5;
    const blinkOn = Math.floor(now / BLINK_MS) % 2 === 0;
    const blink = f.armed && blinkOn;
    if (showGear !== this.gearOn) {
      this.gearOn = showGear;
      this.gearWrap.style.display = showGear ? 'block' : 'none';
    }
    if (showGear) {
      const mph = f.mph >= 100 ? Math.round(f.mph / 10) * 10 : Math.round(f.mph);
      if (f.gear !== this.gGear || f.maxGear !== this.gMax || f.engaged !== this.gEngaged || f.level !== this.gLevel || mph !== this.gMph || f.armed !== this.gArmed || blink !== this.gBlink) {
        this.gArmed = f.armed;
        this.gBlink = blink;
        this.gGear = f.gear;
        this.gMax = f.maxGear;
        this.gEngaged = f.engaged;
        this.gLevel = f.level;
        this.gMph = mph;
        this.drawGear(f, mph, blink);
      }
    }
    // LOCKED (it takes the toast's slot)
    const lockedOn = f.sinceLocked < 2.2;
    if (lockedOn !== this.lockedOn) {
      this.lockedOn = lockedOn;
      this.lockedWrap.style.display = lockedOn ? 'block' : 'none';
      if (lockedOn) {
        this.drawLocked();
        this.clearToast();
        this.wakeButtons();
      }
    }
    const shaking = f.sinceLocked < 0.3;
    const sh = shaking ? (Math.floor(f.sinceLocked * 30) % 2 ? 2 : -2) : 0;
    if (lockedOn && sh !== this.lockedSh) {
      this.lockedSh = sh;
      this.lockedWrap.style.transform = `translateX(calc(-50% + ${sh}px))`;
    }
    if (f.armed || f.sinceShift < 0.3) this.wakeButtons();
    const rest = now >= this.restAt && this.megaId < 0 && !f.armed;
    if (this.mode === 'touch' && this.arrived) this.frameMega(dt, now, rest);
    this.frameCue(now);
    if (this.toastEl && now >= this.toastUntil) this.clearToast();
  }

  private frameMega(dt: number, now: number, rest: boolean) {
    if (this.megaCue > 0) {
      this.megaCueT += dt;
      if (this.megaCueT >= 0.6) {
        this.megaCueT = 0;
        this.megaCue--;
      }
    }
    const fire = this.megaPhase === 'firehose' ? Math.floor(now / 125) % 2 : 0;
    // (HOLD first: steps 4 and 2)
    const hold = this.megaCue > 0 && this.megaCue % 2 === 0;
    const key = (((PHASES.indexOf(this.megaPhase) * 2 + (this.megaDown ? 1 : 0)) * 2 + (rest ? 1 : 0)) * 2 + fire) * 2 + (hold ? 1 : 0);
    if (key !== this.megaKey) {
      this.megaKey = key;
      this.drawMega(rest, fire === 1, hold);
    }
  }

  private frameCue(now: number) {
    if (this.cue === 'none') return;
    const step = Math.floor(now / 300) % 3;
    const key = (this.cue === 'tap' ? 0 : 3) + step;
    if (key !== this.cueKey) {
      this.cueKey = key;
      this.drawCue(this.cue, step);
    }
  }

  /** A short message (a line or two; the first run's hint has four) in the slot under the top row. */
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
    const wrap = div({ position: 'absolute', left: '50%', top: `${this.L.toast.y}px`, transform: 'translateX(-50%)' });
    wrap.dataset.hud = 'toast';
    wrap.append(c.el);
    this.root.append(wrap);
    this.toastEl = wrap;
    this.toastUntil = performance.now() + seconds * 1000;
  }

  clearToast() {
    this.toastEl?.remove();
    this.toastEl = null;
  }

  // ------------------------------------------------------------------ the coach's outputs

  /** MEGA's face alternates HOLD and MEGA twice (it ends when a charge starts). */
  megaHoldCue() {
    this.megaCue = 4;
    this.megaCueT = 0;
    this.wakeButtons();
  }

  setCue(c: Cue) {
    if (c === this.cue) return;
    this.cue = c;
    this.cueKey = -1;
    this.show(this.cueWrap, c !== 'none');
  }

  /** The MEGA's phase (main.ts, per frame). */
  setMega(phase: MegaPhase) {
    if (phase === this.megaPhase) return;
    const was = this.megaPhase;
    this.megaPhase = phase;
    if (phase === 'charging') this.megaCue = 0;
    if (was === 'cooldown' && phase === 'ready') this.wakeButtons(); // (ready again: the meter's pop stays on the face)
    const dock = phase === 'cooldown' || (phase === 'ready' && was === 'cooldown');
    if (dock !== this.meterDocked) {
      this.meterDocked = dock;
      this.placeMeter();
    }
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
    this.creditsOpen = false;
    this.renderSettings();
  }

  closeSettings() {
    if (!this.panel) return;
    this.panel.remove();
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
    const heading = this.creditsOpen ? 'MAP DATA' : 'SETTINGS';
    title.textOutlined(heading, Math.round((W - textWidth(heading)) / 2), 3, C.yellow, C.ink);
    title.flush();
    col.append(title.el);

    if (this.creditsOpen) {
      // the ODbL credit and the others, wrapped to the panel
      for (const entry of this.credits) {
        let line = '';
        for (const word of entry.split(' ')) {
          const next = line ? `${line} ${word}` : word;
          if (line && textWidth(next, HUD_SMALL) > W - 2) {
            col.append(label(line, C.cream));
            line = word;
          } else line = next;
        }
        if (line) col.append(label(line, C.cream));
      }
      col.append(this.button('BACK', W, false, true, () => {
        this.creditsOpen = false;
        this.renderSettings();
      }));
      return;
    }

    if (this.mode === 'keyboard') {
      // the desktop's whole manual
      col.append(label('CONTROLS'));
      col.append(this.button('KEYBOARD + MOUSE', W, true, false, () => {}));
      for (const t of ['ARROWS / WASD: FLY', 'DOWN CLIMBS, UP DIVES', 'SPACE: SPLAT', 'E / Q: GEARS', 'E TWICE: TURBO, Q ENDS IT', 'SHIFT: BOOST', 'RIGHT MOUSE: LOOK']) col.append(label(t, C.cream));
    } else {
      col.append(this.button('BUTTONS: SWAP', W, this.settings.swap, true, () => this.cb.onSwap(!this.settings.swap)));
    }

    // sound
    col.append(label('SOUND'));
    const arow = div({ display: 'flex', gap: '6px' });
    arow.append(
      this.button('ON', 72, !this.settings.muted, true, () => this.cb.onMute(false)),
      this.button('OFF', 72, this.settings.muted, true, () => this.cb.onMute(true)),
    );
    col.append(arow);
    if (this.credits.length)
      col.append(this.button('MAP DATA', W, false, true, () => {
        this.creditsOpen = true;
        this.renderSettings();
      }));
    col.append(this.button('CLOSE', W, false, true, () => this.closeSettings()));
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

  /** A hit wrapper with its visual inside: the visual never catches a touch, so the wrapper's rect is the whole truth. */
  private button2(c: PixelCanvas, qa: string): HTMLDivElement {
    const wrap = div({ position: 'absolute', display: 'none', pointerEvents: 'auto', touchAction: 'none', cursor: 'pointer' });
    wrap.dataset.hud = qa;
    css(c.el, { position: 'absolute', pointerEvents: 'none' });
    wrap.append(c.el);
    // (Safari's back swipe starts at the left edge; the canvas already does this for itself)
    const stop = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    wrap.addEventListener('touchstart', stop, { passive: false });
    wrap.addEventListener('touchmove', stop, { passive: false });
    return wrap;
  }

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
    wrap.addEventListener(
      'touchstart',
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

  /** The app went away, the settings opened: no button stays held. */
  private releaseButtons() {
    if (this.megaId >= 0) {
      this.megaId = -1;
      this.megaDown = false;
      this.input.splatButton(false, true);
    }
    this.adoptedId = -1;
  }

  /** `touchend` is the canonical iOS user-activation event, and a button can be the very first touch. */
  private unlockOnLift(el: HTMLElement) {
    el.addEventListener('touchend', () => this.cb.onGesture());
  }

  private wireMega() {
    const el = this.megaWrap;
    this.unlockOnLift(el);
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (this.megaId >= 0) return;
      this.adoptedId = -1;
      this.cb.onGesture();
      this.wakeButtons();
      this.megaDown = true;
      this.megaId = e.pointerId;
      this.megaX0 = e.clientX;
      this.megaY0 = e.clientY;
      this.megaT0 = evMs(e);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* gone */
      }
      this.input.splatButton(true, false, this.megaT0);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.adoptedId) {
        this.input.adoptedMove(e);
        return;
      }
      if (e.pointerId !== this.megaId) return;
      // MEGA sits in the thumb's rest zone: a drag starting here must steer. Before the charge the press is over; while
      // charging it keeps charging and steers, unless another thumb already steers: then it just stays MEGA's.
      const charging = this.input.charging;
      if (Math.hypot(e.clientX - this.megaX0, e.clientY - this.megaY0) <= (charging ? inputTune.chargeSlopPx : inputTune.holdSlopPx)) return;
      if (!this.input.canAdopt || !this.input.adoptThumb(e, charging, this.megaX0, this.megaY0, this.megaT0)) return;
      this.megaId = -1;
      this.megaDown = false;
      this.adoptedId = e.pointerId;
      if (!charging) this.input.splatButton(false, true, evMs(e));
    });
    const up = (e: PointerEvent, cancel: boolean) => {
      e.stopPropagation();
      if (e.pointerId === this.adoptedId) {
        this.adoptedId = -1;
        this.input.adoptedUp(e, cancel);
        return;
      }
      if (e.pointerId !== this.megaId) return;
      this.megaId = -1;
      this.megaDown = false;
      this.input.splatButton(false, cancel, evMs(e));
    };
    el.addEventListener('pointerup', (e) => up(e, false));
    el.addEventListener('pointercancel', (e) => up(e, true));
  }

  // ------------------------------------------------------------------ drawing

  /** The settings button: a cog, ring + 8 teeth. */
  private drawIconButton(p: PixelCanvas) {
    p.clear();
    p.box(0, 0, 20, 20, C.panel, C.edge, 3);
    for (let j = 0; j < 20; j++)
      for (let i = 0; i < 20; i++) {
        const dx = i + 0.5 - 10, dy = j + 0.5 - 10;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const tooth = Math.cos(a * 8) > 0.35 ? 1.6 : 0;
        if (r <= 5.2 + tooth && r >= 2.3) p.set(i, j, C.cream);
      }
    p.flush();
  }

  /** The face is the button; the meter stays the only charge display. */
  private drawMega(rest: boolean, flip: boolean, hold: boolean) {
    const p = this.mega;
    const n = p.w;
    const k = n / 42;
    p.clear();
    const cx = n / 2, cy = n / 2;
    const ph = this.megaPhase;
    const bright = this.megaDown || ph === 'charging';
    p.disc(cx, cy, 20.5 * k, C.ink);
    // a rainbow pinwheel ring (the blast's own layout)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const dx = i + 0.5 - cx, dy = j + 0.5 - cy;
        const r = Math.hypot(dx, dy);
        if (r > 19.2 * k || r < 12.5 * k) continue;
        const a = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2) + r * 0.012;
        const h = Math.floor(((a % 1) + 1) * 6) % 6;
        if (ph === 'firehose') p.set(i, j, (h % 2 === 0) === flip ? C.text : C.cream);
        else if (ph === 'cooldown') p.set(i, j, C.hueLo[h]);
        else p.set(i, j, bright ? C.hueHi[h] : r > 17.5 * k ? C.hueLo[h] : C.hue[h]);
      }
    const hotCentre = bright || ph === 'firehose';
    p.disc(cx, cy, 12 * k, hotCentre ? C.yellow : C.panel);
    if (rest && ph === 'ready') p.punch(0.25);
    const t = hold ? 'HOLD' : 'MEGA';
    p.text(t, Math.round(cx - textWidth(t, HUD_SMALL) / 2), Math.round(cy) - 3, hotCentre ? C.ink : ph === 'cooldown' ? C.dim : hold ? C.yellowHi : C.cream, HUD_SMALL);
    p.flush();
  }

  private drawCue(c: Cue, step: number) {
    const p = this.cueCanvas;
    p.clear();
    const cx = p.w / 2;
    if (c === 'tap') {
      // a fingertip's ring, pulsing
      const r = 5 + step * 2;
      for (let j = 0; j < 24; j++)
        for (let i = 0; i < p.w; i++) {
          const d = Math.hypot(i + 0.5 - cx, j + 0.5 - 11);
          if (d <= r + 1.8 && d >= r - 1.2) p.set(i, j, d <= r + 0.6 && d >= r ? C.text : C.ink);
        }
      p.disc(cx, 11, 2.5, C.yellowHi);
    } else {
      // two chevrons swaying: left and right of the thumb
      const sway = step === 0 ? -1 : step === 2 ? 1 : 0;
      for (let k = -1; k <= 1; k += 2)
        for (let i = 0; i < 7; i++) {
          const y = 11 + (i - 3), off = 3 - Math.abs(i - 3);
          const x = Math.round(cx + k * (8 + off) + sway * 2);
          p.rect(x - 2, y - 1, 5, 3, C.ink);
        }
      for (let k = -1; k <= 1; k += 2)
        for (let i = 0; i < 7; i++) {
          const y = 11 + (i - 3), off = 3 - Math.abs(i - 3);
          const x = Math.round(cx + k * (8 + off) + sway * 2);
          p.rect(x - 1, y, 3, 1, C.yellowHi);
        }
    }
    const t = c === 'tap' ? 'TAP' : 'DRAG';
    this.outlineOver(p, t, Math.round(cx - textWidth(t) / 2), 23, C.text);
    p.flush();
  }

  private drawGear(f: HudFrame, mph: number, blink: boolean) {
    const p = this.gearBox;
    p.clear();
    const shown = f.gear + (f.armed ? 1 : 0);
    const g = `G${shown}`;
    this.outlineOver(p, g, 2, 2, f.armed ? (blink ? C.yellow : C.dim) : C.yellow);
    const x = 2 + textWidth(g) + 5;
    const last = GEAR_NAMES.length - 1;
    const name = GEAR_NAMES[Math.min(last, shown)] + (f.level > 0 ? ' ' + '+'.repeat(f.level) : '');
    this.outlineOver(p, name, x, 2, !f.armed && (f.engaged || f.gear === 0) ? C.cream : C.dim);
    // pips: one per gear; lit up to the gear, dim if usable, dark if locked
    for (let i = 1; i <= last; i++) {
      const px = 2 + (i - 1) * 8;
      const lit = i <= f.gear;
      const usable = i <= f.maxGear;
      p.box(px, 13, 7, 6, lit ? C.yellow : f.armed && i === shown && blink ? C.yellowLo : usable ? C.panel2 : C.ink, C.ink, 1);
      if (!usable) {
        p.set(px + 2, 15, C.redLo);
        p.set(px + 3, 16, C.redLo);
        p.set(px + 4, 17, C.redLo);
      }
    }
    const sp = f.armed ? 'ARMED' : `${mph} MPH`;
    this.outlineOver(p, sp, 2 + last * 8 + 4, 14, f.armed ? C.yellow : C.text, HUD_SMALL);
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
}
