import { config } from '../config';
import { inputTune, type Input, type InputMode } from '../game/Input';
import { GEAR_NAMES } from '../game/Turbo';
import { Ramp, rampColor } from '../render/palette';
import type { Cue } from './Coach';
import { isCompact, layoutHud, type Control, type HudLayout, type Insets, type Rect } from './hudLayout';
import { C, HUD_FONT, HUD_SMALL, PixelCanvas, textWidth } from './pixelUi';

// The HUD: as little as possible, pixel-styled in palette colors, safe-area
// aware, readable on a bright phone (every glyph has an ink outline). Everything
// sits where src/ui/hudLayout.ts says (a pure function, run on resize only), and
// every button redraws only when what it shows changes.
//
//  - TURBO (upper left): tap = next level, hold = boost; the down tab under it
//    exists only with something to shift down from. The level reads on the button.
//  - the tilt toggle (top left corner, small): on / off, and where the choice lives.
//  - MEGA (the middle of the right side): tap = splat, hold = charge. The meter
//    (slot('super'), src/ui/SuperMeter.ts) stands above it and docks on its face
//    for the cooldown.
//  - top right: settings and, with tilt on, recenter. They fade out after a few
//    seconds untouched; a tap in that corner brings them back.
//  - the gear readout, only for a moment: while a gear lifts and just after it
//    shifts or bites, while the boost is held, and ARMED while a shift waits for
//    the opening's gate; LOCKED: WORLD TRAVEL COMING past the last usable gear.
//  - the chip, TILT TO STEER? (its tap is the user gesture iOS needs), and the
//    first-run cues (src/ui/Coach.ts). Cues pass every touch through.
//  - a desktop has no buttons at all: Esc opens the settings (src/game/Controls.ts).
//  - setCredits(text): a tiny credits line (bottom left, and in settings).
//
// Only these catch touches: toggle, TURBO, the tab, MEGA, recenter, settings,
// chip. Everything else is pointer-events none. Hit wrappers are the rects from
// hudLayout, and the visuals inside them are pointer-events none, so the 14 px
// band at the screen's edges stays the canvas's.
//
// The HUD never decides anything: it reports to the callbacks (src/game/
// Controls.ts) and drives Input's HUD hooks.

const S = 2; // CSS px per UI pixel
/** Seconds the top-right buttons stay after the last touch on them (or a change of scheme). */
const CHROME_SECONDS = 6;
/** Seconds untouched before TURBO and MEGA go to their see-through rest. */
const REST_SECONDS = 8;
/** A finger slid this far off TURBO before its boost: no tap (px). */
const TURBO_SLOP = 34;
/** The blink step of everything that blinks (ms). */
const BLINK_MS = 220;

export type TiltUi = 'none' | 'unasked' | 'off' | 'busy' | 'on' | 'clutched' | 'refused';
export type MegaPhase = 'ready' | 'charging' | 'firehose' | 'cooldown';

export interface HudFrame {
  gear: number;
  maxGear: number;
  engaged: boolean;
  boosting: boolean;
  mph: number;
  /** a shift is waiting for the opening's gate: the next gear shows armed (dim, blinking), it fires by itself */
  armed: boolean;
  /** seconds since the last shift / LOCKED attempt (Infinity = never) */
  sinceShift: number;
  sinceLocked: number;
  /** what the toggle shows */
  tiltState: TiltUi;
  /** there is something to shift down from: a gear, or an armed shift */
  gearDown: boolean;
}

export interface HudCallbacks {
  /** the toggle's tap: called synchronously inside its touchend (iOS permission) */
  onTiltToggle(): void;
  /** the chip's tap: same */
  onChip(): void;
  onSensitivity(v: number): void;
  onRecenter(): void;
  onMute(muted: boolean): void;
  onSwap(swap: boolean): void;
  /** the settings panel opened / closed */
  onSettings(open: boolean): void;
  /** any HUD gesture (inside it: audio unlock) */
  onGesture(): void;
}

export interface HudSettings {
  tiltOn: boolean;
  /** why tilt isn't flying ('' = nothing to say) */
  tiltNote: string;
  sensitivity: number;
  muted: boolean;
  swap: boolean;
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
const PHASES: readonly MegaPhase[] = ['ready', 'charging', 'firehose', 'cooldown'];
const TILT_UI: readonly TiltUi[] = ['none', 'unasked', 'off', 'busy', 'on', 'clutched', 'refused'];

export class Hud {
  readonly root: HTMLDivElement;
  private readonly cb: HudCallbacks;
  private readonly input: Input;
  private readonly compact: boolean;
  private readonly insetProbe: HTMLDivElement;
  private mode: InputMode = 'touch';
  private settings: HudSettings = { tiltOn: false, tiltNote: '', sensitivity: 1, muted: false, swap: false };
  private credits = '';
  /** the rects in force */
  L: HudLayout;
  /** TURBO, MEGA and the toggle have arrived (fog end or first touch) */
  private arrived = false;

  private readonly topRight: HTMLDivElement;
  private readonly settingsBtn: PixelCanvas;
  private readonly recenterBtn: PixelCanvas;
  private readonly settingsWrap: HTMLElement;
  private readonly recenterWrap: HTMLElement;
  private readonly gearBox: PixelCanvas;
  private readonly gearWrap: HTMLDivElement;
  private readonly locked: PixelCanvas;
  private readonly lockedWrap: HTMLDivElement;
  private readonly turbo: PixelCanvas;
  private readonly turboWrap: HTMLDivElement;
  private readonly down: PixelCanvas;
  private readonly downWrap: HTMLDivElement;
  private readonly mega: PixelCanvas;
  private readonly megaWrap: HTMLDivElement;
  private readonly toggle: PixelCanvas;
  private readonly toggleWrap: HTMLDivElement;
  private readonly chipCanvas: PixelCanvas;
  private readonly chipWrap: HTMLDivElement;
  private readonly cueCanvas: PixelCanvas;
  private readonly cueWrap: HTMLDivElement;
  private readonly superSlot: HTMLDivElement;
  private readonly creditsWrap: HTMLDivElement;
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
  private gBoost = false;
  private gArmed = false;
  private gBlink = false;
  private lockedOn = false;
  private lockedSh = 0;
  private turboKey = -1;
  private turboTf = 0;
  private megaKey = -1;
  private toggleKey = -1;
  private cueKey = -1;
  private tiltUi: TiltUi = 'none';
  private downOn = false;
  private downStep = 0;
  /** the top-right buttons: shown until this time (performance.now() ms) */
  private chromeUntil = 0;
  private chromeOn = true;
  /** TURBO and MEGA rest from this time */
  private restAt = 0;
  // TURBO's press
  private turboId = -1;
  private turboX0 = 0;
  private turboY0 = 0;
  private turboT0 = 0;
  private turboArmed = false;
  private turboHolding = false;
  private turboOff = false;
  /** the gate's three blinks: steps left */
  private turboBlink = 0;
  private turboBlinkT = 0;
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
  private downId = -1;
  private togglePressed = false;
  // the chip
  private chipOn = false;
  private chipBorn = 0;
  private chipArmed = false;
  private chipRock = -1;
  private chipFly = -1;
  private chipFlyT = 0;
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

    // ---- top right: [recenter] [settings]
    this.topRight = div({ position: 'absolute', left: '0', top: '0', width: '0', height: '0', transition: 'opacity 0.3s steps(3)' });
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
    this.recenterWrap = this.hit(this.recenterBtn.el, chrome(() => this.cb.onRecenter()), 'recenter');
    this.settingsWrap = this.hit(this.settingsBtn.el, chrome(() => this.openSettings()), 'settings');
    css(this.recenterWrap, { position: 'absolute' });
    css(this.settingsWrap, { position: 'absolute' });
    this.topRight.append(this.recenterWrap, this.settingsWrap);
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
    const ts = this.compact ? 30 : 36;
    const ms = this.compact ? 34 : 42;
    this.turbo = new PixelCanvas(ts, ts, S);
    this.turboWrap = this.button2(this.turbo, 'turbo');
    this.down = new PixelCanvas(ts, this.compact ? 14 : 16, S);
    this.downWrap = this.button2(this.down, 'gear-down');
    this.mega = new PixelCanvas(ms, ms, S);
    this.megaWrap = this.button2(this.mega, 'mega');
    this.toggle = new PixelCanvas(16, 16, S);
    this.toggleWrap = this.button2(this.toggle, 'tilt-toggle');
    this.chipCanvas = new PixelCanvas(100, 24, S);
    this.chipWrap = this.button2(this.chipCanvas, 'tilt-chip');
    root.append(this.downWrap, this.turboWrap, this.megaWrap, this.toggleWrap, this.chipWrap);
    this.wireTurbo();
    this.wireDown();
    this.wireMega();
    this.hitTouch(this.toggleWrap, () => this.cb.onTiltToggle(), (on) => {
      this.togglePressed = on;
      if (on) this.input.reachDown();
      else this.input.reachUp();
    });
    this.hitTouch(this.chipWrap, () => {
      this.cb.onChip();
      this.hideChip();
    });
    this.drawDown(false);

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

    // ---- credits (tiny, bottom left)
    this.creditsWrap = div({ position: 'absolute', left: safe('left', 8), bottom: safe('bottom', 4), display: 'none' });
    root.append(this.creditsWrap);

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

  /** A tiny credits line (e.g. map data attribution): bottom left and in the settings panel; '' hides it. */
  setCredits(text: string) {
    // (the bitmap fonts have no copyright sign or accents: (C), and accents stripped)
    this.credits = text.replace(/©/g, '(C)').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
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

  /** TURBO, MEGA and the toggle arrive (fog end, or the first touch). */
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
    this.show(this.turboWrap, on);
    this.show(this.megaWrap, on);
    this.show(this.toggleWrap, on && this.tiltUi !== 'none');
    this.show(this.downWrap, on && this.downOn);
    this.show(this.recenterWrap, this.tiltUi === 'on' || this.tiltUi === 'clutched');
  }

  /** The top-right buttons show for a few seconds more. */
  private wakeChrome() {
    this.chromeUntil = performance.now() + CHROME_SECONDS * 1000;
  }

  /** TURBO and MEGA come back from their rest. */
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
    this.place(this.recenterWrap, this.recenterBtn, L.recenter);
    this.place(this.settingsWrap, this.settingsBtn, L.settings);
    this.place(this.turboWrap, this.turbo, L.turbo);
    this.place(this.downWrap, this.down, L.down);
    this.place(this.megaWrap, this.mega, L.mega);
    this.place(this.toggleWrap, this.toggle, L.toggle);
    this.place(this.chipWrap, this.chipCanvas, L.chip);
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
    if (f.tiltState !== this.tiltUi || f.gearDown !== this.downOn) {
      this.tiltUi = f.tiltState;
      if (f.gearDown !== this.downOn) {
        this.downOn = f.gearDown;
        this.downStep = f.gearDown ? 2 : 0;
      }
      this.showChrome();
    }
    // the top-right buttons fade out while they aren't being used
    const chromeOn = now < this.chromeUntil || this.panel !== null;
    if (chromeOn !== this.chromeOn) {
      this.chromeOn = chromeOn;
      this.topRight.style.opacity = chromeOn ? '1' : '0';
    }
    // gear readout: only for a moment, when something just changed (the contrail and the wind say the rest)
    const showGear = f.armed || f.boosting || (f.gear > 0 && !f.engaged) || f.sinceShift < 2.5 || f.sinceLocked < 2.5;
    const blinkOn = Math.floor(now / BLINK_MS) % 2 === 0;
    const blink = f.armed && blinkOn;
    if (showGear !== this.gearOn) {
      this.gearOn = showGear;
      this.gearWrap.style.display = showGear ? 'block' : 'none';
    }
    if (showGear) {
      const mph = f.mph >= 100 ? Math.round(f.mph / 10) * 10 : Math.round(f.mph);
      if (f.gear !== this.gGear || f.maxGear !== this.gMax || f.engaged !== this.gEngaged || f.boosting !== this.gBoost || mph !== this.gMph || f.armed !== this.gArmed || blink !== this.gBlink) {
        this.gArmed = f.armed;
        this.gBlink = blink;
        this.gGear = f.gear;
        this.gMax = f.maxGear;
        this.gEngaged = f.engaged;
        this.gBoost = f.boosting;
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
    // TURBO: holding it boosts
    // (confirmed on a second frame: a release queued behind one slow frame is still a tap)
    if (this.turboId >= 0 && !this.turboOff && !this.turboHolding && now - this.turboT0 >= config.splat.holdThreshold * 1000) {
      if (this.turboArmed) {
        this.turboHolding = true;
        this.input.turboHold(true);
      } else this.turboArmed = true;
    }
    if (f.armed || f.sinceShift < 0.3) this.wakeButtons();
    if (this.turboBlink > 0) {
      this.turboBlinkT += dt;
      if (this.turboBlinkT >= BLINK_MS / 1000) {
        this.turboBlinkT = 0;
        this.turboBlink--;
      }
    }
    const rest = now >= this.restAt && this.turboId < 0 && this.megaId < 0 && !f.armed && !f.boosting && this.turboBlink === 0;
    if (this.mode === 'touch' && this.arrived) this.frameTurbo(f, now, blinkOn, rest, shaking, sh);
    if (this.mode === 'touch' && this.arrived) this.frameMega(dt, now, rest);
    if (this.mode === 'touch') this.frameToggle(f, now, blinkOn);
    if (this.downStep > 0) {
      // slides out from under TURBO in two CSS steps
      this.downStep--;
      this.down.el.style.transform = this.downStep > 0 ? 'translateY(-16px)' : '';
    }
    this.frameChip(dt, now);
    this.frameCue(now);
    if (this.toastEl && now >= this.toastUntil) this.clearToast();
  }

  private frameTurbo(f: HudFrame, now: number, blinkOn: boolean, rest: boolean, shaking: boolean, sh: number) {
    const pressed = this.turboId >= 0;
    const hot = f.boosting || this.turboHolding;
    const lifting = f.gear > 0 && !f.engaged;
    const hue = f.gear >= 3 && f.engaged && config.turbo.worldTravel ? Math.floor(now / BLINK_MS) % 6 : 0;
    const blink = (lifting || f.armed || shaking) && blinkOn;
    const cueOn = this.turboBlink % 2 === 1;
    const key = (((((f.gear * 4 + f.maxGear) * 2 + (f.engaged ? 1 : 0)) * 2 + (pressed ? 1 : 0)) * 2 + (hot ? 1 : 0)) * 2 + (f.armed ? 1 : 0)) * 2 + (blink ? 1 : 0);
    const k2 = ((((key * 2 + (rest ? 1 : 0)) * 2 + (cueOn ? 1 : 0)) * 2 + (shaking ? 1 : 0)) * 6 + hue);
    if (k2 !== this.turboKey) {
      this.turboKey = k2;
      this.drawTurbo(f, pressed, hot, blink, cueOn, rest, shaking, hue);
    }
    const tf = (pressed ? 1000 : 0) + sh;
    if (tf !== this.turboTf) {
      this.turboTf = tf;
      this.turbo.el.style.transform = tf ? `translate(${sh}px, ${pressed ? 2 : 0}px)` : '';
    }
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

  private frameToggle(f: HudFrame, now: number, blinkOn: boolean) {
    const rock = f.tiltState === 'unasked' ? Math.floor(now / 500) % 2 : 0;
    const blink = f.tiltState === 'busy' && blinkOn ? 1 : 0;
    const key = ((TILT_UI.indexOf(f.tiltState) * 2 + rock) * 2 + blink) * 2 + (this.togglePressed ? 1 : 0);
    if (key !== this.toggleKey) {
      this.toggleKey = key;
      this.drawToggle(f.tiltState, rock === 1, blink === 1);
    }
  }

  private frameChip(dt: number, now: number) {
    if (this.chipFly >= 0) {
      // up to the corner in six steps: it becomes the toggle
      this.chipFlyT += dt;
      if (this.chipFlyT >= 0.07) {
        this.chipFlyT = 0;
        this.chipFly++;
        const L = this.L, a = L.chip.v, b = L.toggle.v, k = this.chipFly / 6;
        const x = Math.round((b.x + b.w / 2 - (a.x + a.w / 2)) * k), y = Math.round((b.y + b.h / 2 - (a.y + a.h / 2)) * k);
        this.chipCanvas.el.style.transform = `translate(${x}px, ${y}px) scale(${(1 - 0.84 * k).toFixed(2)})`;
        if (this.chipFly >= 6) {
          this.chipFly = -1;
          this.hideChip();
        }
      }
      return;
    }
    if (!this.chipOn) return;
    if (!this.chipArmed && now - this.chipBorn >= 250) {
      this.chipArmed = true;
      this.chipWrap.style.pointerEvents = 'auto';
    }
    const rock = Math.floor(now / 500) % 2;
    if (rock !== this.chipRock) {
      this.chipRock = rock;
      this.drawChip(rock === 1);
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

  /** A short message (one or two lines) in the slot under the top row. */
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

  /** The gate cleared: TURBO blinks three times. */
  turboCue() {
    this.turboBlink = 6;
    this.turboBlinkT = 0;
    this.wakeButtons();
  }

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

  // ------------------------------------------------------------------ the chip

  /** TILT TO STEER?: its hit area arms 250 ms after it appears, so a tap already in flight still splats. */
  showChip() {
    if (this.chipOn) return;
    this.chipOn = true;
    this.chipFly = -1;
    this.chipBorn = performance.now();
    this.chipArmed = false;
    this.chipRock = -1;
    this.chipCanvas.el.style.transform = '';
    this.chipWrap.style.pointerEvents = 'none';
    this.show(this.chipWrap, true);
  }

  hideChip() {
    this.chipOn = false;
    this.chipFly = -1;
    this.show(this.chipWrap, false);
    this.chipWrap.style.pointerEvents = 'none';
  }

  /** Ignored: it flies up to the corner and becomes the toggle. */
  flyChip() {
    this.chipOn = false;
    this.chipFly = 0;
    this.chipFlyT = 0;
    this.chipWrap.style.pointerEvents = 'none';
  }

  get chipOpen(): boolean {
    return this.chipOn;
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
    this.cb.onSettings(true);
  }

  closeSettings() {
    if (!this.panel) return;
    this.panel.remove();
    this.panel = null;
    this.wakeChrome();
    this.cb.onSettings(false);
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

    if (this.mode === 'keyboard') {
      // the desktop's whole manual
      col.append(label('CONTROLS'));
      col.append(this.button('KEYBOARD + MOUSE', W, true, false, () => {}));
      for (const t of ['ARROWS / WASD: FLY', 'DOWN CLIMBS, UP DIVES', 'SPACE: SPLAT', 'E / Q: TURBO GEARS', 'SHIFT: BOOST']) col.append(label(t, C.cream));
    } else {
      if (this.settings.tiltNote) col.append(label(this.settings.tiltNote, C.cream));

      // sensitivity
      const tiltOn = this.settings.tiltOn;
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
    // (the canonical iOS user-activation event: a button can be the very first touch)
    wrap.addEventListener('touchend', () => this.cb.onGesture());
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
      this.input.hudBlip();
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
      this.input.hudBlip();
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

  /**
   * A tap target that may ask iOS for motion access: the callback runs synchronously inside the `touchend` (that is
   * the event iOS honors), first thing, before the audio unlock; pointerup only for a mouse or a pen. `press` reports
   * the finger's down and up.
   */
  private hitTouch(wrap: HTMLElement, fn: () => void, press?: (down: boolean) => void) {
    let down = false;
    const begin = () => {
      if (down) return;
      down = true;
      this.input.hudBlip();
      press?.(true);
    };
    const end = () => {
      if (!down) return;
      down = false;
      this.input.hudBlip();
      press?.(false);
    };
    const inside = (x: number, y: number) => {
      const r = wrap.getBoundingClientRect();
      return x >= r.left - 10 && x <= r.right + 10 && y >= r.top - 10 && y <= r.bottom + 10;
    };
    wrap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      begin();
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
        /* gone */
      }
    });
    wrap.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      if (e.pointerType === 'touch') return; // (the touchend does it)
      if (inside(e.clientX, e.clientY) && down) {
        fn();
        this.cb.onGesture();
      }
      end();
    });
    wrap.addEventListener('pointercancel', (e) => {
      if (e.pointerType !== 'touch') end();
    });
    wrap.addEventListener(
      'touchend',
      (e) => {
        const t = e.changedTouches[0];
        if (down && t && inside(t.clientX, t.clientY)) {
          fn();
          this.cb.onGesture();
        }
        if (e.cancelable) e.preventDefault();
        end();
      },
      { passive: false },
    );
    wrap.addEventListener('touchcancel', end);
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
    if (this.turboId >= 0) {
      this.turboId = -1;
      if (this.turboHolding) this.input.turboHold(false);
      this.turboHolding = false;
      this.input.reachUp();
    }
    if (this.downId >= 0) {
      this.downId = -1;
      this.input.reachUp();
      this.drawDown(false);
    }
  }

  private wireMega() {
    const el = this.megaWrap;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (this.megaId >= 0) return;
      this.adoptedId = -1;
      this.cb.onGesture();
      this.wakeButtons();
      this.input.hudBlip();
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
      this.input.hudBlip();
      this.input.splatButton(false, cancel, evMs(e));
    };
    el.addEventListener('pointerup', (e) => up(e, false));
    el.addEventListener('pointercancel', (e) => up(e, true));
  }

  private wireTurbo() {
    const el = this.turboWrap;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (this.turboId >= 0) return;
      this.cb.onGesture();
      this.wakeButtons();
      this.input.hudBlip();
      this.input.reachDown();
      this.turboId = e.pointerId;
      this.turboX0 = e.clientX;
      this.turboY0 = e.clientY;
      this.turboT0 = evMs(e);
      this.turboArmed = false;
      this.turboOff = false;
      this.turboHolding = false;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* gone */
      }
    });
    const far = (e: PointerEvent) => Math.hypot(e.clientX - this.turboX0, e.clientY - this.turboY0) > TURBO_SLOP;
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.turboId || this.turboOff || this.turboHolding) return;
      if (far(e)) this.turboOff = true; // (a drag begun here stays the button's: it just stops being a tap)
    });
    const up = (e: PointerEvent, cancel: boolean) => {
      e.stopPropagation();
      if (e.pointerId !== this.turboId) return;
      this.turboId = -1;
      const quick = evMs(e) - this.turboT0 < inputTune.stillTapMs;
      if (this.turboHolding) this.input.turboHold(false);
      this.turboHolding = false;
      this.input.hudBlip();
      // (no press is dead: 300 to 450 ms boosts briefly and still shifts; past that it was a boost and nothing else)
      if (!cancel && !this.turboOff && quick && !far(e)) this.input.turboShift(1);
      this.input.reachUp();
    };
    el.addEventListener('pointerup', (e) => up(e, false));
    el.addEventListener('pointercancel', (e) => up(e, true));
  }

  private wireDown() {
    const el = this.downWrap;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (this.downId >= 0) return;
      this.cb.onGesture();
      this.wakeButtons();
      this.input.hudBlip();
      this.input.reachDown();
      this.downId = e.pointerId;
      this.drawDown(true);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* gone */
      }
    });
    const up = (e: PointerEvent, cancel: boolean) => {
      e.stopPropagation();
      if (e.pointerId !== this.downId) return;
      this.downId = -1;
      this.drawDown(false);
      this.input.hudBlip();
      const r = el.getBoundingClientRect();
      if (!cancel && e.clientX >= r.left - 10 && e.clientX <= r.right + 10 && e.clientY >= r.top - 10 && e.clientY <= r.bottom + 10) this.input.turboShift(-1);
      this.input.reachUp();
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

  /** An upward chevron, w wide, its point at y. */
  private chevron(p: PixelCanvas, x: number, y: number, w: number, c: number) {
    const half = (w - 1) / 2;
    for (let i = 0; i < w; i++) {
      const off = Math.round((Math.abs(i - half) / half) * 3);
      p.rect(x + i, y + off, 1, 3, c);
    }
  }

  /** Three stacked chevrons (G1 bottom, G3 top): the level reads on the button, with no digits. */
  private drawTurbo(f: HudFrame, pressed: boolean, hot: boolean, blink: boolean, cueOn: boolean, rest: boolean, shaking: boolean, hue: number) {
    const p = this.turbo;
    const n = p.w;
    p.clear();
    const edge = hot ? C.yellowHi : cueOn ? C.yellowHi : f.engaged && f.gear > 0 ? C.yellow : f.armed ? C.yellowLo : C.edge;
    const face = pressed ? C.yellowLo : C.panel;
    p.box(0, 0, n, n, face, edge, 3);
    // (at rest the panel goes see-through; the chevrons and the label stay solid: the thumb still reads them)
    if (rest) p.punch(0.25);
    if (hot || cueOn) {
      // the inner rule, as the lever's hot state
      p.rect(3, 2, n - 6, 1, C.yellowLo);
      p.rect(3, n - 3, n - 6, 1, C.yellowLo);
    }
    const w = this.compact ? 19 : 23;
    const x = Math.round((n - w) / 2);
    const step = this.compact ? 6 : 7;
    const y0 = this.compact ? 3 : 4;
    const dark = pressed ? C.ink : C.panel2;
    const open = pressed ? C.ink : C.edge;
    for (let i = 3; i >= 1; i--) {
      const y = y0 + (3 - i) * step;
      const lit = i < f.gear || (i === f.gear && f.engaged);
      const lifting = i === f.gear && !f.engaged;
      const next = f.armed && i === f.gear + 1;
      const locked = i > f.maxGear;
      let c = locked ? dark : open;
      if (lit) c = f.gear >= 3 && f.engaged && config.turbo.worldTravel ? C.hue[(hue + i) % 6] : C.yellow;
      else if (lifting) c = blink ? C.yellowHi : open;
      else if (next) c = blink ? C.yellowLo : open;
      this.chevron(p, x, y, w, c);
      if (locked) {
        // the red tick; shifting past the last gear flashes the next one's
        const hit = shaking && i === f.maxGear + 1;
        const t = hit ? (blink ? C.text : C.red) : C.redLo;
        const cx = Math.floor(n / 2);
        p.set(cx - 1, y + 1, t);
        p.set(cx, y + 2, t);
        p.set(cx + 1, y + 3, t);
        p.set(cx + 1, y + 1, t);
        p.set(cx - 1, y + 3, t);
      }
    }
    const t = 'TURBO';
    p.text(t, Math.round((n - textWidth(t, HUD_SMALL)) / 2), n - (this.compact ? 7 : 8), pressed ? C.ink : hot ? C.yellowHi : C.cream, HUD_SMALL);
    p.flush();
  }

  /** A panel and a cream triangle. */
  private drawDown(pressed: boolean) {
    const p = this.down;
    p.clear();
    p.box(0, 0, p.w, p.h, pressed ? C.yellowLo : C.panel, C.edge, 3);
    const t = '▼';
    p.text(t, Math.round((p.w - textWidth(t)) / 2), Math.round((p.h - 7) / 2) - 1, pressed ? C.ink : C.cream, HUD_FONT);
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

  /** The tiny phone: 6 x 12, its top leaning with `rock`. */
  private glyphPhone(p: PixelCanvas, c: number, rock: boolean, screen: number) {
    for (let j = 2; j <= 13; j++) {
      const off = j < 8 && rock ? 1 : 0;
      p.set(5 + off, j, c);
      p.set(10 + off, j, c);
      if (screen && j > 2 && j < 13) p.rect(6 + off, j, 4, 1, screen);
    }
    p.rect(5 + (rock ? 1 : 0), 2, 6, 1, c);
    p.rect(5, 13, 6, 1, c);
  }

  private drawToggle(state: TiltUi, rock: boolean, blink: boolean) {
    const p = this.toggle;
    p.clear();
    const pressed = this.togglePressed;
    p.box(0, 0, 16, 16, pressed ? C.yellow : C.panel, pressed ? C.yellowHi : C.ink, 3);
    if (!pressed && state !== 'busy') p.punch(0.5);
    const on = state === 'on' || state === 'clutched';
    const main = pressed ? C.ink : on ? C.yellow : state === 'busy' ? (blink ? C.yellow : C.dim) : state === 'refused' ? C.red : C.dim;
    this.glyphPhone(p, main, rock, on && !pressed ? C.yellowLo : pressed ? 0 : C.panel);
    if (on) {
      // two arcs: it is listening (dark while a thumb has the bus)
      const a = pressed ? C.ink : state === 'clutched' ? C.panel2 : C.yellowHi;
      for (const [x, y] of [[3, 5], [2, 6], [2, 7], [2, 8], [2, 9], [3, 10]]) {
        p.set(x, y, a);
        p.set(15 - x, y, a);
        p.set(x + 1, y, C.ink);
        p.set(14 - x, y, C.ink);
      }
    }
    if (state === 'off' || state === 'refused') {
      for (let i = 0; i < 12; i++) {
        p.set(2 + i, 13 - i, C.red);
        p.set(3 + i, 13 - i, C.redLo);
      }
    }
    p.flush();
  }

  private drawChip(rock: boolean) {
    const p = this.chipCanvas;
    p.clear();
    p.box(0, 0, p.w, p.h, C.panel, C.yellow, 3);
    this.phone(p, 14, 12, rock ? 0.24 : -0.24, 0.72);
    const t = 'TILT TO STEER?';
    const font = textWidth(t) <= p.w - 30 ? HUD_FONT : HUD_SMALL;
    p.text(t, 25 + Math.round((p.w - 27 - textWidth(t, font)) / 2), font === HUD_FONT ? 8 : 9, C.text, font);
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
    const name = GEAR_NAMES[Math.min(3, shown)] + (f.boosting ? ' +' : '');
    this.outlineOver(p, name, x, 2, !f.armed && (f.engaged || f.gear === 0) ? C.cream : C.dim);
    // pips: one per gear; lit up to the gear, dim if usable, dark if locked
    for (let i = 1; i <= 3; i++) {
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
    this.outlineOver(p, sp, 30, 14, f.armed ? C.yellow : C.text, HUD_SMALL);
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

  /** A little phone (screen + bezel) rotated by `ang`, centered at (cx, cy), `k` x its full size. */
  private phone(p: PixelCanvas, cx: number, cy: number, ang: number, k = 1) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let j = -16; j <= 16; j++)
      for (let i = -16; i <= 16; i++) {
        // rotate back into the phone's frame
        const x = ((i + 0.5) * ca + (j + 0.5) * sa) / k, y = (-(i + 0.5) * sa + (j + 0.5) * ca) / k;
        if (Math.abs(x) > 8 || Math.abs(y) > 13) continue;
        const bezel = Math.abs(x) > 6.5 || Math.abs(y) > 11;
        const notch = !bezel && y < -9.5 && Math.abs(x) < 2;
        // the screen shows a tiny yellow bus over grey
        const bus = !bezel && Math.abs(x) < 3 && y > -2 && y < 2;
        p.set(Math.floor(cx + i), Math.floor(cy + j), bezel || notch ? C.edge : bus ? C.yellow : C.panel2);
      }
  }
}
