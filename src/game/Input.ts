import { config } from '../config';
import { registerTunables } from '../ui/tunables';
import type { TiltMix } from './Hybrid';

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
//  - 'touch'    the bungee above, tilt or no tilt: while tilt runs `mix`
//               (src/game/Hybrid.ts) arbitrates, the same gestures everywhere.
//               The HUD's MEGA (splatButton()) taps and holds; TURBO shifts and
//               boosts. A still press on the screen is a tap up to stillTapMs and
//               steering after that: it never charges.
//  - 'keyboard' desktop: the bungee on the mouse, keys as above.
// The splat press (MEGA, or Space): released before config.splat.holdThreshold =
// onTap; held that long = onChargeStart, then onChargeEnd(heldSeconds, cancelled)
// on release (cancelled = a third finger, a lost touch, or focus lost);
// state.chargeHeld = seconds held while charging, else 0.
// Turbo: onTurbo(+1 / -1) shifts a gear (TURBO, its down tab, E / Q, PageUp /
// PageDown); state.turboHeld = the boost is held (TURBO held, Shift).

export type InputMode = 'touch' | 'keyboard';

export interface InputState {
  /** A thumb, a key or a deflected tilt is steering. */
  dragging: boolean;
  /** A committed bungee thumb (not a key, not the tilt). */
  thumb: boolean;
  /** The arbitrated stick, in units of config.flight.stretchPx, +x right, +y UP (screen up), soft-saturated so |stretch| <= 1. */
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
  /** A still press up to this long (ms) splats on its lift; past it, it is a thumb at neutral. Stays inside
   *  config.splat.aimLatch (500 ms), so glint == hit holds. */
  stillTapMs: 450,
  /** The first finger, still, counts as steering after this long (ms): another finger's touch is then a tap of its own. */
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
  /** MEGA: a finger that wanders past this before the charge becomes the steering thumb (px)... */
  holdSlopPx: 14,
  /** ...and one that slides this far while charging keeps charging and steers too (px). */
  chargeSlopPx: 28,
  /** A press landing this close to the left or right edge is a gripping finger: it never clutches the tilt by resting (px). */
  edgePx: 14,
};

registerTunables('Input', inputTune as unknown as Record<string, unknown>, {
  holdSlopPx: [4, 40, 1],
  chargeSlopPx: [10, 120, 1],
  edgePx: [0, 40, 1],
  stillTapMs: [150, 500, 5],
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
  /** Landed in the edge band: a resting grip never clutches. */
  edge: boolean;
  /** Adopted from MEGA with its press still held: the lift ends that press and nothing else. */
  ownsPress: boolean;
}

const enum Src {
  None = 0,
  /** the HUD's MEGA */
  Button = 2,
  Key = 3,
}

export class Input {
  readonly state: InputState = { dragging: false, thumb: false, stretch: { x: 0, y: 0 }, anchor: null, finger: null, chargeHeld: 0, turboHeld: false };
  onTap: (() => void) | null = null;
  /** The splat press has lasted config.splat.holdThreshold: the super splat charges. */
  onChargeStart: (() => void) | null = null;
  /** The charging press ended: held seconds (from the press), cancelled = a lost touch / focus lost. */
  onChargeEnd: ((heldSeconds: number, cancelled: boolean) => void) | null = null;
  /** Shift a turbo gear up (+1) or down (-1). */
  onTurbo: ((dir: 1 | -1) => void) | null = null;
  /** The tilt's mixer (src/game/Hybrid.ts); while it is live it arbitrates the stick. */
  mix: TiltMix | null = null;
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
  private rectW = 0;
  private firstDone = false;
  /** the thumb's stretch (applyStretch), arbitrated in update() */
  private readonly b = { x: 0, y: 0 };
  private lastUpdate = -1;

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
  // the splat press, one at a time (MEGA or Space): source, start (ms), charging
  private prSrc: Src = Src.None;
  private prT0 = 0;
  private prCharging = false;
  /** a frame saw the press past the threshold: the next frame that still sees it starts the charge (a release
   *  queued behind one slow frame is still a tap: its timestamp says how long it really was) */
  private prArmed = false;
  // the boost held by TURBO, by Shift
  private hudHold = false;
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
    if (document.hidden) {
      this.releaseAll();
      this.mix?.sleep();
    } else this.wakeMix();
  };

  constructor(el: HTMLElement) {
    this.el = el;
    for (let i = 0; i < MAX_POINTERS; i++) this.slots.push({ id: -1, role: Role.None, type: '', x0: 0, y0: 0, t0: 0, maxDist: 0, counted: false, edge: false, ownsPress: false });

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

  /** 'touch' | 'keyboard' (read-only for gameplay code; src/game/Controls.ts sets it). */
  get mode(): InputMode {
    return this.modeV;
  }

  setMode(m: InputMode): void {
    if (m === this.modeV) return;
    this.releaseAll();
    this.modeV = m;
  }

  /** The HUD's MEGA: pressed / released; `cancelled` = no tap (the finger became the steering thumb, or was lost);
   *  `at` = the event's timeStamp (ms, performance clock), so a slow frame can't stretch a tap into a hold. */
  splatButton(down: boolean, cancelled = false, at?: number): void {
    const t = performance.now();
    const now = at !== undefined && at > 0 && at <= t + 50 && t - at < 30000 ? at : t;
    if (down) {
      this.fireFirstGesture();
      if (this.pressBegin(Src.Button, now)) this.onPress?.();
      else this.onTap?.(); // another press is held (Space): this one is a tap of its own
    } else this.pressEnd(Src.Button, now, cancelled);
  }

  /** The HUD's TURBO / down tab: a tap shifts a gear. */
  turboShift(dir: 1 | -1): void {
    this.fireFirstGesture();
    this.onTurbo?.(dir);
  }

  /** The HUD's TURBO held: boost. */
  turboHold(down: boolean): void {
    this.hudHold = down;
    this.state.turboHeld = this.hudHold || this.keyBoost;
  }

  /** Any HUD press or lift: the hand shakes the phone (the calm window). */
  hudBlip(): void {
    this.mix?.blip();
  }

  /** TURBO, its down tab or the tilt toggle pressed: a reach that clutches the tilt... */
  reachDown(): void {
    this.mix?.reachDown();
  }

  /** ...until the finger lifts. */
  reachUp(): void {
    this.mix?.reachUp();
  }

  /** Tilt went live, the settings closed, the app came back: the mixer eases in (a thumb down stays clutched). */
  wakeMix(): void {
    this.mix?.wake(this.pointerDragging);
  }

  /** The MEGA press is charging (the HUD's slide rule). */
  get charging(): boolean {
    return this.prCharging;
  }

  /** Seconds the steering finger has rested without moving past the tap slop (0: no such finger). */
  stillFor(now: number): number {
    const p = this.primary;
    return p && p.maxDist <= inputTune.tapSlopPx && !this.gTriple ? (now - p.t0) / 1000 : 0;
  }

  /** A finger is on the screen or a splat press is held. */
  get anyHeld(): boolean {
    return this.primary !== null || this.prSrc !== Src.None;
  }

  /** Is there room for MEGA's finger to steer? */
  get canAdopt(): boolean {
    return this.primary === null;
  }

  /**
   * A HUD finger (MEGA's) becomes the steering thumb: the pointer moves over to the canvas and the gesture starts here,
   * from where the finger is now (no stretch step), while its slot remembers the press's own point and time (client
   * px, ms), so one lift ends in exactly one result. keepPress = a held charge stays alive and ends on this lift.
   * False if a thumb already steers. (The tilt chip's finger comes here too.)
   */
  adoptThumb(e: PointerEvent, keepPress: boolean, x0: number, y0: number, t0: number): boolean {
    if (this.primary) return false;
    const slot = this.alloc(e.pointerId);
    if (!slot) return false;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    for (const s of this.slots) if (s !== slot && (s.role === Role.Secondary || s.role === Role.Primary)) s.role = Role.Orphan;
    const r = this.el.getBoundingClientRect();
    this.rectL = r.left;
    this.rectT = r.top;
    this.rectW = r.width;
    this.setSlot(slot, e, t0, Role.Primary);
    const x = slot.x0, y = slot.y0;
    slot.x0 = x0 - this.rectL;
    slot.y0 = y0 - this.rectT;
    slot.maxDist = Math.hypot(x - slot.x0, y - slot.y0);
    slot.edge = false;
    slot.ownsPress = keepPress;
    this.beginGesture(slot, t0);
    this.anchorPt.x = this.fingerPt.x = x;
    this.anchorPt.y = this.fingerPt.y = y;
    // (a HUD press never reached pointerDown's land(), and the stick was tilt's until now: this is what it hands over)
    this.mix?.land();
    this.commitDrag();
    return true;
  }

  /** Pointer events of an adopted finger that still reach the HUD (capture is not promised to move on every browser). */
  adoptedMove(e: PointerEvent): void {
    this.pointerMove(e);
  }
  adoptedUp(e: PointerEvent, cancelled: boolean): void {
    this.pointerUp(e, cancelled);
  }

  /** Call once per frame before reading `state` (keyboard easing, hold-to-steer, the splat hold, the arbitration). */
  update(dt: number): void {
    const now = performance.now();
    this.pressTick(now);
    const st = this.state;
    st.turboHeld = this.hudHold || this.keyBoost;
    const mix = this.mix;
    const mixLive = mix !== null && mix.live;
    const p = this.primary;
    // A thumb resting still past the tap window is steering (at neutral); a resting grip on the edge doesn't kill the tilt.
    if (p && !this.gTriple && !this.pointerDragging && now - p.t0 >= inputTune.stillTapMs && !(mixLive && p.edge)) this.commitDrag();
    st.thumb = this.pointerDragging;
    if (mixLive) {
      // (wall clock: a hit-stop must not stall a handover)
      const wall = this.lastUpdate >= 0 ? Math.min(0.1, (now - this.lastUpdate) / 1000) : 0;
      mix.update(wall, this.b.x, this.b.y);
    }
    this.lastUpdate = now;
    const tx = (this.kR ? 1 : 0) - (this.kL ? 1 : 0);
    const ty = (this.kU ? 1 : 0) - (this.kD ? 1 : 0);
    if ((tx !== 0 || ty !== 0) && !this.pointerDragging) {
      // the keys win over the tilt, the thumb wins over the keys
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
    if (mixLive) {
      st.stretch.x = mix.out.x;
      st.stretch.y = mix.out.y;
      st.dragging = this.pointerDragging || mix.out.x !== 0 || mix.out.y !== 0;
    } else {
      st.stretch.x = this.b.x;
      st.stretch.y = this.b.y;
      st.dragging = this.pointerDragging;
    }
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

  /** A press that fires on its lift is down (MEGA or Space; not the bungee). */
  get pressHeld(): boolean {
    return this.prSrc !== Src.None;
  }

  /** A press starts (false: another one is already held). */
  private pressBegin(src: Src, now: number): boolean {
    if (this.prSrc !== Src.None) return false;
    this.prSrc = src;
    this.prT0 = now;
    this.prCharging = false;
    this.prArmed = false;
    return true;
  }

  /** Held long enough: the charge starts; while charging, chargeHeld counts. */
  private pressTick(now: number) {
    if (this.prSrc === Src.None) return;
    const held = (now - this.prT0) / 1000;
    if (!this.prCharging && held >= config.splat.holdThreshold) {
      if (!this.prArmed) {
        this.prArmed = true;
        return;
      }
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
        // released after the threshold but before a frame noticed: still a hold, and it reads as one
        this.state.chargeHeld = held;
        this.onChargeStart?.();
        this.state.chargeHeld = 0;
        this.onChargeEnd?.(held, false);
      } else this.onTap?.();
    }
  }

  /** Cancel whatever press is held (no tap; a charge ends cancelled). */
  private pressCancel(now: number) {
    if (this.prSrc !== Src.None) this.pressEnd(this.prSrc, now, true);
  }

  // ---------------------------------------------------------------- pointers

  private pointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // First thing, synchronously inside the event: iOS audio unlock.
    this.fireFirstGesture();
    if (e.cancelable) e.preventDefault();
    this.mix?.blip();
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
      this.rectW = r.width;
      this.setSlot(slot, e, now, Role.Primary);
      this.beginGesture(slot, now);
      this.mix?.land();
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
    this.mix?.blip();
    slot.role = Role.None;
    slot.id = -1;
    if (role === Role.Orphan) return;

    this.gMembers--;
    if (!quick) this.gAllQuick = false;
    if (role === Role.Primary) {
      this.primary = null;
      this.endSteering();
      // A charge MEGA's finger carried off ends here, and only here.
      if (slot.ownsPress) this.pressEnd(Src.Button, now, cancelled || this.gTriple);
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
      const together = this.gMulti && this.gAllQuick && !this.gSteered && this.gMax === 2 && now - this.gT0 <= inputTune.stillTapMs + 150;
      if (!this.gTriple && !this.gAnswered && (together || this.gPendingTap)) this.answer();
      this.gMembers = 0;
      this.gMulti = false;
      this.gPendingTap = false;
    }
  }

  // ---------------------------------------------------------------- helpers

  /** A new gesture: the steering finger touched down. */
  private beginGesture(slot: Slot, now: number) {
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
  }

  private setSlot(slot: Slot, e: PointerEvent, now: number, role: Role) {
    slot.id = e.pointerId;
    slot.role = role;
    slot.type = e.pointerType;
    slot.x0 = e.clientX - this.rectL;
    slot.y0 = e.clientY - this.rectT;
    slot.t0 = now;
    slot.maxDist = 0;
    slot.counted = false;
    slot.edge = slot.x0 < inputTune.edgePx || slot.x0 > this.rectW - inputTune.edgePx;
    slot.ownsPress = false;
  }

  /** Forget a pointer without any tap (stale / lost). */
  private drop(s: Slot) {
    const role = s.role;
    s.role = Role.None;
    s.id = -1;
    if (role === Role.Primary) {
      this.primary = null;
      this.endSteering();
      // (a lost touch never leaves a charge running)
      if (s.ownsPress) this.pressEnd(Src.Button, performance.now(), true);
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
    return (dur <= inputTune.stillTapMs && s.maxDist <= inputTune.tapSlopPx) || (dur <= inputTune.quickTapMs && s.maxDist <= inputTune.quickTapSlopPx);
  }

  /** The steering finger has committed: moved past the tap slop or held past the tap window. */
  private primarySteering(now: number): boolean {
    const p = this.primary;
    if (!p) return false;
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
    this.kx = this.ky = 0;
    this.mix?.clutch();
    this.applyStretch();
  }

  private endSteering() {
    const was = this.pointerDragging;
    this.pointerDragging = false;
    this.b.x = this.b.y = 0;
    if (was) this.mix?.release('thumb');
    const st = this.state;
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
    const st = this.b;
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
        this.state.turboHeld = this.hudHold || this.keyBoost;
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
    this.hudHold = this.keyBoost = false;
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
  // (a very slow frame can deliver an event seconds late: its own time still says how long a touch was)
  return t > 0 && t <= now + 50 && now - t < 30000 ? t : now;
}

/** Linear up to `knee`, then eases asymptotically into 1 (tanh), C1-continuous. */
function softSat(s: number, knee: number): number {
  const k = Math.min(0.999, Math.max(0, knee));
  if (s <= k) return s;
  const r = 1 - k;
  return k + r * Math.tanh((s - k) / r);
}
