import { config } from '../config';
import { registerTunables } from '../ui/tunables';

// One-thumb input: the "floating bungee".
//
// Touch anywhere: the touch-down point becomes the anchor, and the vector from
// the anchor to the finger is the bungee stretch (sideways = carve; it's also
// the yoke: down = pull back = climb, up = nose down = dive, or surge at the
// rooftops). Past ~1x stretchPx the stretch soft-saturates toward 1; past
// `leash` x stretchPx the anchor is dragged along behind the finger, so the
// thumb never runs out of room and reversing direction responds immediately.
//
// Taps (the splat):
//  - a short, still touch fires onTap on pointerup (no waiting for a
//    double-tap window), and a quick tap with slight movement also counts;
//  - while steering, any OTHER finger touching down fires onTap on that
//    pointerdown, without touching the steering finger's anchor/stretch;
//  - two fingers tapped together (nobody steering) count as one tap;
//  - anything that turned into a drag never fires a tap.
// Three fingers down together (while not steering) fire onTripleFinger and
// swallow the gesture (no tap, no steering).
//
// Desktop dev: mouse drag = thumb, click / Space = tap, arrows / WASD =
// stretch, flown like a yoke: Down / S = pull back (climb), Up / W = nose down
// (dive; surge at the rooftops), Left / Right / A / D = carve.
//
// Modes (`mode`, set by src/game/Controls.ts; read-only for gameplay code):
//  - 'touch'    the bungee above. The HUD's splat button (splatButton()) taps
//               and holds; the HUD's turbo lever shifts and boosts.
//  - 'tilt'     the phone is the yoke (src/game/Tilt.ts feeds `stick`, which
//               fills state.stretch with the bungee's exact semantics) and the
//               whole screen is the splat button: tap = splat, hold = charge,
//               swipe up / down = shift a turbo gear, swipe up and keep the
//               finger down = boost. A second finger while the first is held
//               taps. No bungee.
//  - 'keyboard' desktop: the bungee on the mouse, keys as above.
// The splat press (any source: tilt screen, HUD button, Space): released before
// config.splat.holdThreshold = onTap; held that long without becoming a steer /
// swipe = onChargeStart, then onChargeEnd(heldSeconds, cancelled) on release
// (cancelled = slid off into a drag, a third finger, or focus lost);
// state.chargeHeld = seconds held while charging, else 0.
// Turbo: onTurbo(+1 / -1) shifts a gear (swipes, the lever, E / Q, PageUp /
// PageDown); state.turboHeld = the boost is held (swipe-and-hold, the lever
// held, Shift).

export type InputMode = 'tilt' | 'touch' | 'keyboard';

/** A stick that isn't a finger (the tilt): Flight semantics, read after update(). */
export interface StickSource {
  readonly sx: number;
  readonly sy: number;
  /** deflected (outside its dead zones): Flight's `dragging` */
  readonly engaged: boolean;
  update(): void;
}

export interface InputState {
  /** A thumb (or key) is actively steering. */
  dragging: boolean;
  /** In units of config.flight.stretchPx, +x right, +y UP (screen up), soft-saturated so |stretch| <= 1. */
  stretch: { x: number; y: number };
  /** Bungee anchor, CSS px relative to the input element (null when no steering finger is down). */
  anchor: { x: number; y: number } | null;
  /** Steering finger, CSS px relative to the input element (null when no steering finger is down). */
  finger: { x: number; y: number } | null;
  /** Seconds the splat press has been held, while it charges the super splat (from the press; 0 when not charging). */
  chargeHeld: number;
  /** The turbo boost is held. */
  turboHeld: boolean;
}

/** Live-tunable gesture numbers (tuner group "Input"). */
export const inputTune = {
  /** A touch shorter than this (ms) that stays inside tapSlopPx is a tap. */
  tapMs: 230,
  tapSlopPx: 12,
  /** A very quick touch (ms) may wander a little further and still be a tap. */
  quickTapMs: 150,
  quickTapSlopPx: 26,
  /** Third finger must land within this many ms of the first for the tuner gesture. */
  tripleWindowMs: 450,
  /** The anchor follows the finger once it is this many stretchPx away. */
  leash: 2.2,
  /** Stretch is linear up to this fraction of full, then eases (tanh) into 1. */
  knee: 0.72,
  /** Keyboard: how fast the key stretch chases its target (1/s). */
  keyRate: 7,
  /** Splat press: a finger that wanders past this before holdThreshold is no tap and no hold (px)... */
  holdSlopPx: 14,
  /** ...and one that slides this far while charging cancels the charge (px). */
  chargeSlopPx: 44,
  /** Tilt mode: a swipe is this much vertical travel (px) within swipeMs of the touch-down, mostly vertical (|dy| >= ratio x |dx|). */
  swipePx: 38,
  swipeMs: 450,
  swipeRatio: 1.3,
};

registerTunables('Input', inputTune as unknown as Record<string, unknown>, {
  holdSlopPx: [4, 40, 1],
  chargeSlopPx: [10, 120, 1],
  swipePx: [12, 120, 1],
  swipeMs: [100, 1000, 10],
  swipeRatio: [0.5, 4, 0.05],
  tapMs: [80, 400, 5],
  tapSlopPx: [2, 40, 1],
  quickTapMs: [40, 300, 5],
  quickTapSlopPx: [4, 60, 1],
  tripleWindowMs: [100, 1000, 10],
  leash: [1.2, 5, 0.05],
  knee: [0.3, 1, 0.01],
  keyRate: [1, 30, 0.5],
});

const MAX_POINTERS = 10;

const enum Role {
  None = 0,
  /** The steering finger of the current gesture. */
  Primary = 1,
  /** Any other finger of the current gesture. */
  Secondary = 2,
  /** Left over from an earlier gesture: ignored until it lifts. */
  Orphan = 3,
}

interface Slot {
  id: number;
  role: Role;
  type: string;
  x0: number;
  y0: number;
  t0: number;
  /** Largest distance from the touch-down point so far (px). */
  maxDist: number;
  /** Already produced a tap (second-finger tap on down). */
  counted: boolean;
}

const enum Src {
  None = 0,
  /** the whole screen, tilt mode */
  Screen = 1,
  /** the HUD's splat button */
  Button = 2,
  Key = 3,
}

export class Input {
  readonly state: InputState = { dragging: false, stretch: { x: 0, y: 0 }, anchor: null, finger: null, chargeHeld: 0, turboHeld: false };
  onTap: (() => void) | null = null;
  /** The splat press has lasted config.splat.holdThreshold without becoming a steer / swipe: the super splat charges. */
  onChargeStart: (() => void) | null = null;
  /** The charging press ended: held seconds (from the press), cancelled = slid off into a drag / focus lost. */
  onChargeEnd: ((heldSeconds: number, cancelled: boolean) => void) | null = null;
  /** Shift a turbo gear up (+1) or down (-1). */
  onTurbo: ((dir: 1 | -1) => void) | null = null;
  /** The tilt stick, read in 'tilt' mode (src/game/Tilt.ts). */
  stick: StickSource | null = null;
  /** A new gesture touched down (it may become a tap, which fires on the lift): the game freezes its aim cue. */
  onPress: (() => void) | null = null;
  onTripleFinger: (() => void) | null = null;
  onFirstGesture: (() => void) | null = null;

  private readonly el: HTMLElement;
  private readonly slots: Slot[] = [];
  // fixed objects handed out through state.anchor / state.finger
  private readonly anchorPt = { x: 0, y: 0 };
  private readonly fingerPt = { x: 0, y: 0 };
  private rectL = 0;
  private rectT = 0;
  private firstDone = false;

  // current gesture (from the steering finger's touch-down until every member lifts)
  private primary: Slot | null = null;
  private gT0 = 0;
  private gMembers = 0;
  private gMax = 0;
  /** More than one finger took part before anyone started steering. */
  private gMulti = false;
  private gTriple = false;
  /** Every member that lifted so far was a tap-like touch. */
  private gAllQuick = true;
  /** A tap was already fired for this gesture by another finger. */
  private gAnswered = false;
  /** A finger tapped before the thumb committed: fire when it commits (or at the end). */
  private gPendingTap = false;
  /** The steering finger committed to a drag at some point. */
  private gSteered = false;
  private pointerDragging = false;

  private modeV: InputMode = 'touch';
  // the splat press, one at a time (tilt screen, HUD button or Space): source, start (ms), charging
  private prSrc: Src = Src.None;
  private prT0 = 0;
  private prCharging = false;
  // tilt mode: this gesture swiped (a gear shift); the boost held by a swipe up, the HUD lever, Shift
  private gSwiped = false;
  private swipeHold = false;
  private leverHold = false;
  private keyBoost = false;

  // keyboard
  private kL = false;
  private kR = false;
  private kU = false;
  private kD = false;
  private kx = 0;
  private ky = 0;

  private readonly onDown = (e: PointerEvent) => this.pointerDown(e);
  private readonly onMove = (e: PointerEvent) => this.pointerMove(e);
  private readonly onUp = (e: PointerEvent) => this.pointerUp(e, false);
  private readonly onCancel = (e: PointerEvent) => this.pointerUp(e, true);
  private readonly onTouchStart = (e: TouchEvent) => {
    // Blocks iOS scroll, rubber-band, pinch, long-press callout and text selection.
    if (e.cancelable) e.preventDefault();
  };
  private readonly onTouchMove = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
  };
  private readonly onTouchEnd = (e: TouchEvent) => {
    // Blocks double-tap zoom and the synthetic click. Also the canonical iOS
    // user-activation event, so it doubles as a first-gesture fallback.
    this.fireFirstGesture();
    if (e.cancelable) e.preventDefault();
    this.touchesGone(e);
  };
  private readonly onTouchCancel = (e: TouchEvent) => this.touchesGone(e);
  private staleTimer = 0;
  private readonly onPrevent = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  private readonly onKeyDown = (e: KeyboardEvent) => this.key(e, true);
  private readonly onKeyUp = (e: KeyboardEvent) => this.key(e, false);
  private readonly onBlur = () => this.releaseAll();
  private readonly onVisibility = () => {
    if (document.hidden) this.releaseAll();
  };

  constructor(el: HTMLElement) {
    this.el = el;
    for (let i = 0; i < MAX_POINTERS; i++) this.slots.push({ id: -1, role: Role.None, type: '', x0: 0, y0: 0, t0: 0, maxDist: 0, counted: false });

    const s = el.style as CSSStyleDeclaration & { webkitUserSelect?: string; webkitTouchCallout?: string; webkitTapHighlightColor?: string };
    s.touchAction = 'none';
    s.userSelect = 'none';
    s.webkitUserSelect = 'none';
    s.webkitTouchCallout = 'none';
    s.webkitTapHighlightColor = 'transparent';

    const active = { passive: false } as AddEventListenerOptions;
    el.addEventListener('pointerdown', this.onDown, active);
    el.addEventListener('pointermove', this.onMove, { passive: true });
    el.addEventListener('pointerup', this.onUp, { passive: true });
    el.addEventListener('pointercancel', this.onCancel, { passive: true });
    el.addEventListener('touchstart', this.onTouchStart, active);
    el.addEventListener('touchmove', this.onTouchMove, active);
    el.addEventListener('touchend', this.onTouchEnd, active);
    el.addEventListener('touchcancel', this.onTouchCancel, { passive: true });
    el.addEventListener('dblclick', this.onPrevent, active);
    el.addEventListener('contextmenu', this.onPrevent, active);
    el.addEventListener('selectstart', this.onPrevent, active);
    // Safari's proprietary pinch events fire on the document.
    document.addEventListener('gesturestart', this.onPrevent, active);
    document.addEventListener('gesturechange', this.onPrevent, active);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** 'tilt' | 'touch' | 'keyboard' (read-only for gameplay code; src/game/Controls.ts sets it). */
  get mode(): InputMode {
    return this.modeV;
  }

  setMode(m: InputMode): void {
    if (m === this.modeV) return;
    this.releaseAll();
    this.modeV = m;
  }

  /** The HUD's splat button (touch mode): pressed / released; `cancelled` = the finger slid off it. */
  splatButton(down: boolean, cancelled = false): void {
    const now = performance.now();
    if (down) {
      this.fireFirstGesture();
      if (this.pressBegin(Src.Button, now)) this.onPress?.();
      else this.onTap?.(); // another press is held (Space): this one is a tap of its own
    } else this.pressEnd(Src.Button, now, cancelled);
  }

  /** The HUD's turbo lever: a tap shifts a gear. */
  turboShift(dir: 1 | -1): void {
    this.fireFirstGesture();
    this.onTurbo?.(dir);
  }

  /** The HUD's turbo lever held: boost. */
  turboHold(down: boolean): void {
    this.leverHold = down;
    this.state.turboHeld = this.swipeHold || this.leverHold || this.keyBoost;
  }

  /** Call once per frame before reading `state` (keyboard easing, hold-to-steer, the splat hold, the tilt). */
  update(dt: number): void {
    this.pressTick(performance.now());
    const st0 = this.state;
    st0.turboHeld = this.swipeHold || this.leverHold || this.keyBoost;
    if (this.modeV === 'tilt') {
      this.updateTilt(dt);
      return;
    }
    const p = this.primary;
    if (p && !this.gTriple) {
      // A thumb resting still past the tap window is steering (at neutral).
      if (!this.pointerDragging && performance.now() - p.t0 >= inputTune.tapMs) this.commitDrag();
      if (this.pointerDragging) return; // the thumb wins over the keys
    }
    if (p) return; // a gesture that hasn't committed yet: keys stay out of it
    const tx = (this.kR ? 1 : 0) - (this.kL ? 1 : 0);
    const ty = (this.kU ? 1 : 0) - (this.kD ? 1 : 0);
    const st = this.state;
    if (tx === 0 && ty === 0) {
      this.kx = this.ky = 0;
      if (st.dragging && !this.pointerDragging) {
        st.dragging = false;
        st.stretch.x = st.stretch.y = 0;
      }
      return;
    }
    const len = Math.hypot(tx, ty);
    const k = 1 - Math.exp(-inputTune.keyRate * Math.max(0, dt));
    this.kx += (tx / len - this.kx) * k;
    this.ky += (ty / len - this.ky) * k;
    st.dragging = true;
    st.stretch.x = this.kx;
    st.stretch.y = this.ky;
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('touchstart', this.onTouchStart);
    el.removeEventListener('touchmove', this.onTouchMove);
    el.removeEventListener('touchend', this.onTouchEnd);
    el.removeEventListener('touchcancel', this.onTouchCancel);
    window.clearTimeout(this.staleTimer);
    el.removeEventListener('dblclick', this.onPrevent);
    el.removeEventListener('contextmenu', this.onPrevent);
    el.removeEventListener('selectstart', this.onPrevent);
    document.removeEventListener('gesturestart', this.onPrevent);
    document.removeEventListener('gesturechange', this.onPrevent);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.releaseAll();
    this.onTap = this.onTripleFinger = this.onFirstGesture = this.onPress = this.onChargeStart = null;
    this.onChargeEnd = null;
    this.onTurbo = null;
  }

  // ---------------------------------------------------------------- the splat press (tap / hold)

  /** A press starts (false: another one is already held). */
  private pressBegin(src: Src, now: number): boolean {
    if (this.prSrc !== Src.None) return false;
    this.prSrc = src;
    this.prT0 = now;
    this.prCharging = false;
    return true;
  }

  /** Held long enough: the charge starts; while charging, chargeHeld counts. */
  private pressTick(now: number) {
    if (this.prSrc === Src.None) return;
    const held = (now - this.prT0) / 1000;
    if (!this.prCharging && held >= config.splat.holdThreshold) {
      this.prCharging = true;
      this.state.chargeHeld = held;
      this.onChargeStart?.();
    }
    if (this.prCharging) this.state.chargeHeld = Math.max(this.state.chargeHeld, held);
  }

  /** The press ends: a tap (short), the charge's end (long), or nothing (cancelled before the hold). */
  private pressEnd(src: Src, now: number, cancelled: boolean) {
    if (this.prSrc === Src.None || this.prSrc !== src) return;
    const held = Math.max(0, (now - this.prT0) / 1000);
    const charging = this.prCharging;
    this.prSrc = Src.None;
    this.prCharging = false;
    this.state.chargeHeld = 0;
    if (charging) this.onChargeEnd?.(held, cancelled);
    else if (!cancelled) {
      if (held >= config.splat.holdThreshold) {
        // released after the threshold but before a frame noticed: still a hold
        this.onChargeStart?.();
        this.onChargeEnd?.(held, false);
      } else this.onTap?.();
    }
  }

  /** Cancel whatever press is held (no tap; a charge ends cancelled). */
  private pressCancel(now: number) {
    if (this.prSrc !== Src.None) this.pressEnd(this.prSrc, now, true);
  }

  // ---------------------------------------------------------------- tilt mode

  /** The tilt stick fills the stretch (keys still fly it on a desktop with a sensor). */
  private updateTilt(dt: number) {
    const st = this.state;
    const tx = (this.kR ? 1 : 0) - (this.kL ? 1 : 0);
    const ty = (this.kU ? 1 : 0) - (this.kD ? 1 : 0);
    if (tx !== 0 || ty !== 0) {
      const len = Math.hypot(tx, ty);
      const k = 1 - Math.exp(-inputTune.keyRate * Math.max(0, dt));
      this.kx += (tx / len - this.kx) * k;
      this.ky += (ty / len - this.ky) * k;
      st.dragging = true;
      st.stretch.x = this.kx;
      st.stretch.y = this.ky;
      return;
    }
    this.kx = this.ky = 0;
    const s = this.stick;
    if (s) {
      s.update();
      st.stretch.x = s.sx;
      st.stretch.y = s.sy;
      st.dragging = s.engaged;
    } else {
      st.stretch.x = st.stretch.y = 0;
      st.dragging = false;
    }
  }

  /** Tilt mode, the gesture's first finger moved: a swipe shifts a gear; wandering off ends the press. */
  private tiltMove(slot: Slot, x: number, y: number, now: number) {
    const dx = x - slot.x0, dy = y - slot.y0;
    if (!this.gSwiped && !this.prCharging && now - slot.t0 <= inputTune.swipeMs && Math.abs(dy) >= inputTune.swipePx && Math.abs(dy) >= inputTune.swipeRatio * Math.abs(dx)) {
      this.gSwiped = true;
      if (this.prSrc === Src.Screen) this.pressEnd(Src.Screen, now, true);
      const up = dy < 0;
      this.swipeHold = up; // swipe up and keep the finger down: boost
      this.state.turboHeld = this.swipeHold || this.leverHold || this.keyBoost;
      this.onTurbo?.(up ? 1 : -1);
      return;
    }
    if (this.prSrc !== Src.Screen) return;
    if (this.prCharging ? slot.maxDist > inputTune.chargeSlopPx : slot.maxDist > inputTune.holdSlopPx) this.pressEnd(Src.Screen, now, true);
  }


  // ---------------------------------------------------------------- pointers

  private pointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // First thing, synchronously inside the event: iOS audio unlock.
    this.fireFirstGesture();
    if (e.cancelable) e.preventDefault();
    // Never get stuck on a pointer whose up was lost: a repeated id, or a
    // "primary" pointer (the browser says no other touch is down), retires leftovers.
    const dup = this.find(e.pointerId);
    if (dup) this.drop(dup);
    if (e.isPrimary) for (const s of this.slots) if (s.role !== Role.None && s.type === e.pointerType) this.drop(s);
    const slot = this.alloc(e.pointerId);
    if (!slot) return;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    const now = evTime(e);

    if (!this.primary) {
      // A new gesture: anything still down from an earlier one is ignored.
      for (const s of this.slots) if (s.role === Role.Secondary || s.role === Role.Primary) s.role = Role.Orphan;
      const r = this.el.getBoundingClientRect();
      this.rectL = r.left;
      this.rectT = r.top;
      this.setSlot(slot, e, now, Role.Primary);
      this.primary = slot;
      this.gT0 = now;
      this.gMembers = 1;
      this.gMax = 1;
      this.gMulti = false;
      this.gTriple = false;
      this.gAllQuick = true;
      this.gAnswered = false;
      this.gPendingTap = false;
      this.gSteered = false;
      this.pointerDragging = false;
      // Show where the bungee is pinned right away; it only steers once committed.
      this.anchorPt.x = this.fingerPt.x = slot.x0;
      this.anchorPt.y = this.fingerPt.y = slot.y0;
      this.state.anchor = this.anchorPt;
      this.state.finger = this.fingerPt;
      this.gSwiped = false;
      if (this.modeV === 'tilt') {
        // no bungee: the whole screen is the splat button (tap / hold) and swipes shift gears
        this.state.anchor = this.state.finger = null;
        this.pressBegin(Src.Screen, now);
      }
      this.onPress?.();
      return;
    }

    // Another finger joins the gesture. It never moves the steering anchor.
    this.setSlot(slot, e, now, Role.Secondary);
    this.gMembers++;
    if (this.gMembers > this.gMax) this.gMax = this.gMembers;
    if (this.gTriple) return;
    if (this.primarySteering(now)) {
      // Second-finger tap while steering: fire right now, on the down.
      slot.counted = true;
      this.gAnswered = true; // the steering finger's own release can't also tap
      this.onTap?.();
      return;
    }
    this.gMulti = true;
    // (tilt: two fingers before the first is held is no hold: one tap at the end, or the tuner)
    if (this.modeV === 'tilt') this.pressEnd(Src.Screen, now, true);
    if (this.gMembers >= 3 && now - this.gT0 <= inputTune.tripleWindowMs) {
      this.gTriple = true;
      this.gPendingTap = false;
      this.endSteering();
      this.onTripleFinger?.();
    }
  }

  private pointerMove(e: PointerEvent) {
    const slot = this.find(e.pointerId);
    if (!slot) return;
    const x = e.clientX - this.rectL;
    const y = e.clientY - this.rectT;
    const d = Math.hypot(x - slot.x0, y - slot.y0);
    if (d > slot.maxDist) slot.maxDist = d;
    if (slot !== this.primary || this.gTriple) return;
    if (this.modeV === 'tilt') {
      this.tiltMove(slot, x, y, evTime(e));
      return;
    }
    this.fingerPt.x = x;
    this.fingerPt.y = y;
    if (!this.pointerDragging && slot.maxDist > inputTune.tapSlopPx) this.commitDrag();
    if (this.pointerDragging) this.applyStretch();
  }

  private pointerUp(e: PointerEvent, cancelled: boolean) {
    const slot = this.find(e.pointerId);
    if (!slot) return;
    const now = evTime(e);
    const role = slot.role;
    const quick = !cancelled && this.isQuick(slot, now);
    slot.role = Role.None;
    slot.id = -1;
    if (role === Role.Orphan) return;

    this.gMembers--;
    if (!quick) this.gAllQuick = false;
    if (role === Role.Primary) {
      this.primary = null;
      this.endSteering();
      if (this.modeV === 'tilt') {
        // the screen press ends: a tap, the end of a charge, or nothing (swiped / slid / multi-finger)
        this.swipeHold = false;
        this.state.turboHeld = this.leverHold || this.keyBoost;
        this.pressEnd(Src.Screen, now, cancelled || this.gTriple);
      }
      // The everyday tap: one finger, short and still -> fire on the up.
      else if (quick && !this.gMulti && !this.gTriple && !this.gAnswered) this.onTap?.();
    } else if (!slot.counted && quick && !this.gTriple && !this.gAnswered && this.primary) {
      // A finger that landed before the thumb committed to steering and
      // tapped: still the player's tap. Fire now if the thumb is steering,
      // else as soon as it commits (or when the gesture ends).
      slot.counted = true;
      if (this.primarySteering(now)) this.answer();
      else this.gPendingTap = true;
    }

    if (this.gMembers <= 0) {
      // Two fingers tapped together, nobody steering: one tap at the last lift.
      const together = this.gMulti && this.gAllQuick && !this.gSteered && this.gMax === 2 && now - this.gT0 <= inputTune.tapMs + 150;
      if (!this.gTriple && !this.gAnswered && (together || this.gPendingTap)) this.answer();
      this.gMembers = 0;
      this.gMulti = false;
      this.gPendingTap = false;
    }
  }

  // ---------------------------------------------------------------- helpers

  private setSlot(slot: Slot, e: PointerEvent, now: number, role: Role) {
    slot.id = e.pointerId;
    slot.role = role;
    slot.type = e.pointerType;
    slot.x0 = e.clientX - this.rectL;
    slot.y0 = e.clientY - this.rectT;
    slot.t0 = now;
    slot.maxDist = 0;
    slot.counted = false;
  }

  /** Forget a pointer without any tap (stale / lost). */
  private drop(s: Slot) {
    const role = s.role;
    s.role = Role.None;
    s.id = -1;
    if (role === Role.Primary) {
      this.primary = null;
      this.endSteering();
      // (a lost touch never leaves a charge or a boost running)
      this.pressEnd(Src.Screen, performance.now(), true);
      this.swipeHold = false;
    }
    if (role === Role.Primary || role === Role.Secondary) {
      this.gMembers = Math.max(0, this.gMembers - 1);
      this.gAllQuick = false;
    }
  }

  /**
   * touchend/touchcancel with no fingers left: any touch pointer still held
   * lost its pointerup. Checked a beat later so a pointerup dispatched after
   * the touch event (engine order varies) still lands first.
   */
  private touchesGone(e: TouchEvent) {
    if (e.touches.length > 0) return;
    const at = performance.now();
    window.clearTimeout(this.staleTimer);
    this.staleTimer = window.setTimeout(() => {
      for (const s of this.slots) if (s.role !== Role.None && s.type === 'touch' && s.t0 < at) this.drop(s);
    }, 60);
  }

  private find(id: number): Slot | null {
    for (const s of this.slots) if (s.role !== Role.None && s.id === id) return s;
    return null;
  }

  private alloc(id: number): Slot | null {
    for (const s of this.slots) {
      if (s.role === Role.None) {
        s.id = id;
        return s;
      }
    }
    return null;
  }

  private isQuick(s: Slot, now: number): boolean {
    const dur = now - s.t0;
    return (dur <= inputTune.tapMs && s.maxDist <= inputTune.tapSlopPx) || (dur <= inputTune.quickTapMs && s.maxDist <= inputTune.quickTapSlopPx);
  }

  /** The steering finger has committed: moved past the tap slop or held past the tap window. */
  private primarySteering(now: number): boolean {
    const p = this.primary;
    if (!p) return false;
    // (tilt: the first finger is held, or swiped: another finger's touch is a tap of its own)
    if (this.modeV === 'tilt') return this.prCharging || this.gSwiped || now - p.t0 > config.splat.holdThreshold * 1000;
    return this.pointerDragging || p.maxDist > inputTune.tapSlopPx || now - p.t0 > inputTune.tapMs;
  }

  /** The one tap a multi-finger gesture is allowed. */
  private answer() {
    this.gAnswered = true;
    this.gPendingTap = false;
    this.onTap?.();
  }

  private commitDrag() {
    if (this.gTriple || !this.primary) return;
    this.pointerDragging = true;
    this.gSteered = true;
    if (this.gPendingTap && !this.gAnswered) this.answer();
    const st = this.state;
    st.dragging = true;
    this.kx = this.ky = 0;
    this.applyStretch();
  }

  private endSteering() {
    this.pointerDragging = false;
    const st = this.state;
    st.dragging = false;
    st.stretch.x = st.stretch.y = 0;
    st.anchor = null;
    st.finger = null;
  }

  /** Leash the anchor behind the finger, then dead zone + soft saturation. */
  private applyStretch() {
    const F = config.flight;
    const px = Math.max(1, F.stretchPx);
    const a = this.anchorPt;
    const f = this.fingerPt;
    let dx = f.x - a.x;
    let dy = f.y - a.y;
    let d = Math.hypot(dx, dy);
    const maxD = Math.max(F.deadZonePx + 1, inputTune.leash * px);
    if (d > maxD) {
      const k = maxD / d;
      a.x = f.x - dx * k;
      a.y = f.y - dy * k;
      dx *= k;
      dy *= k;
      d = maxD;
    }
    const st = this.state.stretch;
    const dz = Math.max(0, F.deadZonePx);
    if (d <= dz) {
      st.x = st.y = 0;
      return;
    }
    const s = softSat((d - dz) / px, inputTune.knee);
    st.x = (dx / d) * s;
    st.y = (-dy / d) * s; // screen up = +y
  }

  private fireFirstGesture() {
    if (this.firstDone) return;
    const cb = this.onFirstGesture;
    if (!cb) return; // nobody listening yet: try again on the next gesture
    this.firstDone = true;
    cb();
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (down && (e.metaKey || e.ctrlKey || e.altKey)) return;
    const t = e.target as HTMLElement | null;
    // Typing into UI (tuner filter, buttons) never steers; key-ups always land so keys can't stick.
    if (down && t && t !== document.body && t !== document.documentElement) {
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || t.isContentEditable) return;
      if (t.closest?.('[data-sb-ui]')) return;
    }
    let used = true;
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.kL = down;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.kR = down;
        break;
      case 'ArrowUp':
      case 'KeyW':
        this.kU = down; // nose down: dive / surge
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.kD = down; // pull back: climb
        break;
      case 'Space':
        // tap = a short press, hold = charge (the tap fires on the release)
        if (down) {
          this.fireFirstGesture();
          if (!e.repeat) {
            if (this.pressBegin(Src.Key, evTime(e))) this.onPress?.();
            else this.onTap?.();
          }
        } else this.pressEnd(Src.Key, evTime(e), false);
        break;
      case 'KeyE':
      case 'PageUp':
        if (down && !e.repeat) this.onTurbo?.(1);
        break;
      case 'KeyQ':
      case 'PageDown':
        if (down && !e.repeat) this.onTurbo?.(-1);
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keyBoost = down;
        this.state.turboHeld = this.swipeHold || this.leverHold || this.keyBoost;
        break;
      default:
        used = false;
    }
    if (used) {
      if (down) this.fireFirstGesture();
      e.preventDefault();
    }
  }

  private releaseAll() {
    // (focus lost mid-hold: the charge ends cancelled; no stuck boost)
    this.pressCancel(performance.now());
    this.swipeHold = this.leverHold = this.keyBoost = false;
    this.gSwiped = false;
    this.state.turboHeld = false;
    for (const s of this.slots) {
      s.role = Role.None;
      s.id = -1;
    }
    this.primary = null;
    this.gMembers = 0;
    this.gMulti = false;
    this.gTriple = false;
    this.gPendingTap = false;
    this.kL = this.kR = this.kU = this.kD = false;
    this.kx = this.ky = 0;
    this.endSteering();
  }
}

/**
 * When the input happened (not when we got to handle it): a janky frame on the
 * phone must not turn a quick tap into a "long" touch. Falls back to now if the
 * browser's event clock isn't the performance.now() clock.
 */
function evTime(e: Event): number {
  const now = performance.now();
  const t = e.timeStamp;
  return t > 0 && t <= now + 50 && now - t < 1000 ? t : now;
}

/** Linear up to `knee`, then eases asymptotically into 1 (tanh), C1-continuous. */
function softSat(s: number, knee: number): number {
  const k = Math.min(0.999, Math.max(0, knee));
  if (s <= k) return s;
  const r = 1 - k;
  return k + r * Math.tanh((s - k) / r);
}
