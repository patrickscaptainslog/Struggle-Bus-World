import { config } from '../config';
import { registerTunables } from '../ui/tunables';

// Two thumbs, each with its own job (docs/specs/flight/THUMBS.md). One rule decides,
// on the landing alone: the look zone, which is everywhere but the bus's lane (busZone,
// set each frame from where the bus stands on the screen: round the bus and anywhere
// under it). With no bus on the screen it is the left lookZone of the screen's width
// (the right, with BUTTONS: SWAP). Until the opening's gate there is no zone (lookOff):
// its low shot has no look. A touch landing in the zone never flies. Everywhere
// else the first thumb flies, and on its own it flicks and taps too. In any order, the
// thumb in the zone looks and the other flies. A mouse has its right button instead.
//
// THE FIRST THUMB FLIES: the floating bungee, anywhere out of the zone. The
// touch-down point becomes the anchor, and the vector from the anchor to the
// finger is the stretch (sideways = carve; it's also the yoke: down = pull back
// = climb, up = nose down = dive, or surge at the rooftops). Past ~1x stretchPx
// the stretch soft-saturates toward 1; past `leash` x stretchPx the anchor is
// dragged along behind the finger, so the thumb never runs out of room and
// reversing direction responds immediately. A short, still touch is a tap
// (onTap on pointerup, no waiting for a double-tap window; a quick tap with
// slight movement also counts). Anything that turned into a drag never taps.
//
// THE SECOND THUMB is any finger landing in the zone, alone or not, or anywhere
// while the first is down, and it never touches the flight:
//  - a drag that stays down looks: after lookDelayMs, so a flick doesn't swing
//    the camera, state.look follows the thumb from where it landed, and on the
//    lift it is off (the rig eases the view home);
//  - a quick flick is a shift: onTurbo(+1 up / -1 down);
//  - a tap splats on its lift, up to secondTapMs (stillTapMs with nobody flying):
//    on the landing nobody can know yet that it isn't a look;
//  - at rest it does nothing, unless it landed off the lane (in the zone): held still for
//    aimHoldMs there it AIMS (docs/specs/shots/SHOTS.md, decision 4: a tap is up to 0.3 s, a
//    still hold from 0.35 s aims, in between counts as a tap). The aim begins aimLagMs later, on
//    a frame after one that saw it: lifted before it began, it is a tap, so a late lift's tap
//    never pours and no press does nothing. From then until its lift it is the
//    aim hold: state.aim follows it, a drag drags the aim (never the view), and its lift is the
//    hold's release (onAimEnd), never a tap or a flick. One aims at a time. What it aims is the
//    shot code's (src/game/Hold.ts): the Hose, or what life or Recess claims. Nobody flies for it,
//    so the bus flies straight; a thumb landing in the lane beside it still flies.
// Two fingers tapped together (nobody steering) count as one tap.
//
// THE BOMB (bombOn, &bomb on the link; docs/specs/shots/SHOTS.md, "The modes"): the flying thumb landing on the bus itself (busBox, set every frame by main.ts)
// and held still charges a Bomb, while it steers as any thumb does. Still is within tapSlopPx of the landing until Bomb II shows, then chargeSlopPx. The charge
// begins aimHoldMs in with a full belly (bombFull: a tier waits for one, and the charge's clock starts when it's there), Bomb II is judged at bombTwoMs and
// Bomb III at bombThreeMs from that start, and each shows aimLagMs later, on a frame after one that saw it, as the aim begins: a lift queued behind a slow frame
// is what its own time says. A still lift before II shows is a tap (no press does nothing); after, the Bomb (onBombEnd); held on, it stays III and never fires
// by itself. Each cancel is a fizzle that keeps the belly: moving past the slop, three fingers, a lost touch or lost focus, a hand-over (endPress), another
// thumb's tap. Only the flying thumb charges: it needn't be alone, and another thumb's look or flick doesn't stop it, but there's no charge while it could
// still be one of a two-finger tap, and a second thumb on the bus never charges. Only the landing counts: one under the bus is a thumb at rest.
//
// A lone fresh stroke out of the zone that lifts fast is a flick too, on the firmer
// rule. It steers until the lift decides: steering never waits for a verdict, and a
// thumb that stays down never shifts. A stroke in the zone steers nothing, so the
// second thumb's rule is all it needs.
// A flick is read from the landing and the lift alone, distance over contact
// time, so it holds at any frame rate. One touch is one reading, so the return
// stroke never counts. A stroke landing in the bottom band (iOS owns that edge)
// or the side band is never a command.
//
// Three fingers down together (while not steering) fire onTripleFinger and
// swallow the gesture (no tap, no steering).
//
// Desktop dev: mouse drag = thumb, right mouse drag = the look, click / Space =
// tap, arrows / WASD = stretch, flown like a yoke: Down / S = pull back (climb),
// Up / W = nose down (dive; surge at the rooftops), Left / Right / A / D = carve.
//
// Modes (`mode`, set by src/game/Controls.ts; read-only for gameplay code):
//  - 'touch'    the thumbs above. The HUD's MEGA (splatButton()) taps and holds.
//               A still press on the screen is a tap up to stillTapMs and steering
//               after that: it never charges.
//  - 'keyboard' desktop: the bungee on the mouse, keys as above.
// The splat press (MEGA, or Space): released before config.splat.holdThreshold =
// onTap; held that long = onChargeStart, then onChargeEnd(heldSeconds, cancelled)
// on release (cancelled = a lost touch, or focus lost); state.chargeHeld = seconds
// held while charging, else 0. All of that only with megaOn (&mega on the link):
// MEGA is off, and without it every press's lift is a tap.
// The ladder: onTurbo(dir, flew) = a flick, or E / Q, PageUp / PageDown (what it means
// is src/game/Shifter.ts's).

export type InputMode = 'touch' | 'keyboard';

export interface InputState {
  /** A thumb or a key is steering. */
  dragging: boolean;
  /** A committed bungee thumb (not a key, and never the look). */
  thumb: boolean;
  /** The stick, in units of config.flight.stretchPx, +x right, +y UP (screen up), soft-saturated so |stretch| <= 1. */
  stretch: { x: number; y: number };
  /** Bungee anchor, CSS px relative to the input element (null when no steering finger is down). */
  anchor: { x: number; y: number } | null;
  /** Steering finger, CSS px relative to the input element (null when no steering finger is down). */
  finger: { x: number; y: number } | null;
  /** Seconds the splat press has been held, while it charges the super splat (from the press; 0 when not charging). */
  chargeHeld: number;
  /** The look: `on` while a second thumb (or the right mouse) has the view; x, y = its offset from where it landed, CSS px, +x right, +y UP. 0, 0 when off. */
  look: { on: boolean; x: number; y: number };
  /** Hold to aim: `on` while a finger that landed off the lane and held still for inputTune.aimHoldMs is down. x, y = where it is now, x0, y0 = where it
   *  landed (CSS px of the input element); t0 = its landing, at = when it became an aim (ms, the performance clock). Off: all as they were last. */
  aim: { on: boolean; x: number; y: number; x0: number; y0: number; t0: number; at: number };
  /** The Bomb: `on` while a still hold on the bus charges one (from the charge's start until its end); tier 1 charging, 2 Bomb II, 3 Bomb III (as shown); t0 = its
   *  landing, at = when the charge's clock began (ms, the performance clock). Off: all as they were last. */
  bomb: { on: boolean; tier: number; t0: number; at: number };
}

/** Live-tunable gesture numbers (tuner group "Input"). */
export const inputTune = {
  /** A still press up to this long (ms) splats on its lift; past it, it is a thumb at neutral. Stays inside
   *  config.splat.aimLatch (500 ms), so glint == hit holds. */
  stillTapMs: 450,
  /** The first finger, still, counts as steering after this long (ms): another finger's tap then fires on its own lift. */
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
  /** The second thumb's tap: lifted within this long (ms), inside the tap slops. */
  secondTapMs: 230,
  /** The look waits this long (ms) so a flick doesn't swing the camera, and for the thumb to leave tapSlopPx. */
  lookDelayMs: 100,
  /** A touch landing in this share of the screen's width, from the left (the right, with BUTTONS: SWAP), never flies. 0: no zone. */
  lookZone: 0.42,
  /** With the bus's zone on (Input.busZone): the half width of its lane round the bus, as a share of the screen's narrow side (its width, upright), and how far under the bus
   *  it has opened out to the screen's whole width, as a share of the screen's height (0: whole width from the bus's line down). New names, 2026-11-04:
   *  the lane grew, and a value a phone's tuner saved for the old busLane must not hold it at 0.22. */
  laneHalf: 0.27,
  laneOpen: 0.25,
  /** ...and the bus counts as standing no lower than this share of the screen's height, about its usual line: the strain at the ceiling or a look up sinks
   *  it toward the bottom edge, and the lane under it is where the thumb rests, which doesn't move with the bus. */
  laneLow: 0.6,
  /** A flick by the second thumb: at least this far (px), in at most this long (ms), at least this fast on average (px/ms), within this many degrees of vertical. */
  flickPx: 30,
  flickMs: 230,
  flickSpeed: 0.25,
  flickDeg: 50,
  /** The firmer rule of a lone stroke: it steers too, so it has more to prove. */
  loneFlickPx: 36,
  loneFlickMs: 200,
  loneFlickSpeed: 0.4,
  loneFlickDeg: 40,
  /** A stroke landing this close to the bottom (iOS owns that edge) or to a side is never a command (px). */
  flickBottomPx: 40,
  flickSidePx: 20,
  /** Hold to aim (SHOTS.md, decision 4): a finger landed off the lane and still inside tapSlopPx this long (ms) aims. Lifted before it with nobody flying, it is a tap
   *  (the ruling's tap is up to 300 ms, and 300 to 350 counts as one). Beside a flying thumb a tap is still secondTapMs, and 230 to 350 rests as before. */
  aimHoldMs: 350,
  /** ...and the aim begins this much later (ms), on a frame after one that saw it past aimHoldMs: a lift that reaches the page late (behind a slow frame, or two at
   *  30 fps: a real touch's lift can arrive 70 ms after its own time) is still the tap its own time says. Lifted still before the aim began, with nobody flying, it is
   *  a tap: nothing poured yet, so the player sees the splat they asked for, never a press that does nothing (review of step 2, 4, and the GPU flight's 337 ms tap). */
  aimLagMs: 70,
};

registerTunables('Input', inputTune as unknown as Record<string, unknown>, {
  holdSlopPx: [4, 40, 1],
  chargeSlopPx: [10, 120, 1],
  stillTapMs: [150, 500, 5],
  tapMs: [80, 400, 5],
  tapSlopPx: [2, 40, 1],
  quickTapMs: [40, 300, 5],
  quickTapSlopPx: [4, 60, 1],
  tripleWindowMs: [100, 1000, 10],
  leash: [1.2, 5, 0.05],
  knee: [0.3, 1, 0.01],
  keyRate: [1, 30, 0.5],
  secondTapMs: [80, 450, 5],
  lookDelayMs: [0, 300, 5],
  lookZone: [0, 0.8, 0.01],
  laneHalf: [0.1, 0.5, 0.01],
  laneOpen: [0, 0.6, 0.01],
  laneLow: [0.3, 1, 0.01],
  flickPx: [10, 120, 1],
  flickMs: [60, 450, 5],
  flickSpeed: [0.05, 2, 0.01],
  flickDeg: [10, 80, 1],
  loneFlickPx: [10, 120, 1],
  loneFlickMs: [60, 450, 5],
  loneFlickSpeed: [0.05, 2, 0.01],
  loneFlickDeg: [10, 80, 1],
  flickBottomPx: [0, 120, 1],
  flickSidePx: [0, 80, 1],
  aimHoldMs: [200, 900, 5],
  aimLagMs: [0, 200, 5],
});

const MAX_POINTERS = 10;

const enum Role {
  None = 0,
  /** The flying thumb. */
  Fly = 1,
  /** A thumb in the look zone, or any other: looks, flicks, taps on its lift. */
  Second = 2,
  /** Swallowed with a three-finger gesture: ignored until it lifts. */
  Orphan = 3,
}

/** What a touch may turn out to be on its lift. */
const enum Flick {
  /** never a command */
  No = 0,
  /** the second thumb's rule */
  Easy = 1,
  /** a lone stroke's rule */
  Firm = 2,
}

interface Slot {
  id: number;
  role: Role;
  type: string;
  x0: number;
  y0: number;
  t0: number;
  /** Landing order: what touched down after a touchend can't be what that touchend left behind. */
  seq: number;
  /** Where it is now. */
  x: number;
  y: number;
  /** Largest distance from the touch-down point so far (px). */
  maxDist: number;
  flick: Flick;
  /** This thumb has the view. */
  looking: boolean;
  /** The mouse's right button: a look from the first pixel, and nothing else. */
  right: boolean;
  /** Adopted from MEGA with its press still held: the lift ends that press and nothing else. */
  ownsPress: boolean;
  /** It landed in the look zone, as the zone was then (the bus's lane moves with the bus). */
  inLook: boolean;
  /** It is the aim hold (state.aim): held still off the lane for aimHoldMs. armed: a frame has seen it past aimHoldMs (the next one starts it). */
  aiming: boolean;
  aimArmed: boolean;
  /** The Bomb: the flying thumb landed on the bus with bombOn, and may still charge (moving past the slop ends that, for the touch); bombFrom = the charge's
   *  clock start (ms; -1: the belly isn't full yet); bombTier = the tier shown (0 none, 1 charging, 2, 3); bombArm = the tier a frame has seen it reach */
  onBus: boolean;
  bombFrom: number;
  bombTier: number;
  bombArm: number;
}

const enum Src {
  None = 0,
  /** the HUD's MEGA */
  Button = 2,
  Key = 3,
}

/**
 * A stroke read from its landing and its lift alone: +1 up, -1 down, 0 not a flick. dx, dy = px from the landing (screen
 * y, so up is negative), ms = contact time. Distance over contact time, not peak speed: it holds at any touch rate.
 */
export function readFlick(dx: number, dy: number, ms: number, px: number, maxMs: number, speed: number, deg: number): 1 | -1 | 0 {
  if (ms > maxMs) return 0;
  const d = Math.hypot(dx, dy);
  if (d < px || d / Math.max(1, ms) < speed) return 0;
  if (Math.abs(dx) > Math.abs(dy) * Math.tan((Math.min(89, deg) * Math.PI) / 180)) return 0;
  return dy < 0 ? 1 : -1;
}

export class Input {
  readonly state: InputState = { dragging: false, thumb: false, stretch: { x: 0, y: 0 }, anchor: null, finger: null, chargeHeld: 0, look: { on: false, x: 0, y: 0 }, aim: { on: false, x: 0, y: 0, x0: 0, y0: 0, t0: 0, at: 0 }, bomb: { on: false, tier: 0, t0: 0, at: 0 } };
  onTap: (() => void) | null = null;
  /** Hold to aim (state.aim): a still finger off the lane became an aim, and its lift (cancelled = lost, three fingers, focus gone). src/game/Hold.ts takes both. */
  onAimStart: (() => void) | null = null;
  onAimEnd: ((cancelled: boolean) => void) | null = null;
  /** Hold to aim is on (main.ts: off on ?moon and in the flight, which have no Hose; off, a still finger off the lane rests as it always did). */
  aimOn = true;
  /** MEGA is asleep unless this is set (main.ts, from &mega on the link; the producer, 2026-11-06: "lets just remove the mega splat for now"). Off, the
   *  splat press never charges: however long it's held, its lift is a tap, and onChargeStart / onChargeEnd never fire. */
  megaOn = false;
  /** The splat press has lasted config.splat.holdThreshold: the super splat charges. */
  onChargeStart: (() => void) | null = null;
  /** The charging press ended: held seconds (from the press), cancelled = a lost touch / focus lost. */
  onChargeEnd: ((heldSeconds: number, cancelled: boolean) => void) | null = null;
  /** A flick (or E / Q): +1 up, -1 down; flew = it was on the stick. */
  onTurbo: ((dir: 1 | -1, flew: boolean) => void) | null = null;
  /** A new gesture touched down (it may become a tap, which fires on the lift): the game freezes its aim cue. */
  onPress: (() => void) | null = null;
  onTripleFinger: (() => void) | null = null;
  onFirstGesture: (() => void) | null = null;
  /** The Bomb (&bomb on the link, src/game/Bomb.ts sets it): off, a thumb on the bus is the flying thumb as it always was, and the onBomb* callbacks never fire. */
  bombOn = false;
  /** The bus's own box, CSS px of the input element, set every frame by main.ts: its eight corners through this frame's camera, grown a little, at least a thumb's size.
   *  Only a flying thumb landing in it charges a Bomb. Null: nowhere. */
  busBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Per frame from the Bomb: a tier may show (the belly is full; a gift's, no breath under way), the gift's tier (0 none: the next still hold on the bus is that
   *  tier at aimHoldMs + aimLagMs), and when II and III are judged (ms from the charge's start, the bank's taken off). */
  bombFull = false;
  bombGift = 0;
  bombTwoMs = 600;
  bombThreeMs = 1200;
  /** The Bomb's charge began (aimHoldMs into a still hold on the bus with a full belly), a tier showed (2, 3), and it ended: the tier it had (a lift under 2 is a
   *  tap, which onTap fires after this), or cancelled (a fizzle). */
  onBombCharge: (() => void) | null = null;
  onBombTier: ((tier: number) => void) | null = null;
  onBombEnd: ((tier: number, cancelled: boolean) => void) | null = null;
  /** BUTTONS: SWAP: the look zone is on the right instead of the left. */
  swapped = false;
  /**
   * The bus's zone, CSS px of the input element, set every frame by whoever draws the bus (main.ts, from where the bus stands on the screen): only a touch landing in its lane flies, and one landing anywhere
   * else looks. The producer: "what if we reserve the control the struggle bus movement space on the screen to the area directly near the struggle bus itself, and then touching anywhere but that
   * area pans the camera?" And on going live, 2026-11-04: "anywhere a player touches in the general vicinity below the bus belongs to control of bus - not pan- as that's where the thumb naturally lies".
   * Null: the look zone's rule. r: the lane's half width round the bus (inputTune.laneHalf of the screen's narrow side); open: how far under the bus it covers the screen's whole width (inputTune.laneOpen of its height).
   */
  busZone: { x: number; y: number; r: number; open: number } | null = null;
  /** The opening's low shot, while its gate is shut (main.ts, with the gears' lock): it has no look, so a landing anywhere flies, as every touch there always did. */
  lookOff = false;

  private readonly el: HTMLElement;
  private readonly slots: Slot[] = [];
  // fixed objects handed out through state.anchor / state.finger
  private readonly anchorPt = { x: 0, y: 0 };
  private readonly fingerPt = { x: 0, y: 0 };
  private rectL = 0;
  private rectT = 0;
  private rectW = 0;
  private rectH = 0;
  private firstDone = false;
  private landings = 0;
  /** the thumb's stretch (applyStretch) */
  private readonly b = { x: 0, y: 0 };

  /** the flying thumb, and the thumb that has the view */
  private fly: Slot | null = null;
  private looker: Slot | null = null;
  /** the finger holding to aim (state.aim) */
  private aimSlot: Slot | null = null;

  // the current gesture (from the flying thumb's landing, or a lone second thumb's)
  private gT0 = 0;
  /** The most fingers on the glass at once. */
  private gMax = 0;
  /** A second finger landed before anyone started steering. */
  private gMulti = false;
  /** Every member that lifted so far was a tap-like touch. */
  private gAllQuick = true;
  /** A tap was already fired for this gesture by another finger. */
  private gAnswered = false;
  /** A finger tapped before the thumb committed: fire when it commits (or at the end). */
  private gPendingTap = false;
  /** The flying thumb committed to a drag at some point. */
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
    for (let i = 0; i < MAX_POINTERS; i++) this.slots.push({ id: -1, role: Role.None, type: '', x0: 0, y0: 0, t0: 0, seq: 0, x: 0, y: 0, maxDist: 0, flick: Flick.No, looking: false, right: false, ownsPress: false, inLook: false, aiming: false, aimArmed: false, onBus: false, bombFrom: -1, bombTier: 0, bombArm: 0 });

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

  /** The MEGA press is charging (the HUD's slide rule). */
  get charging(): boolean {
    return this.prCharging;
  }

  /** Seconds the flying thumb has rested without moving past the tap slop (0: no such finger). */
  stillFor(now: number): number {
    const p = this.fly;
    return p && p.maxDist <= inputTune.tapSlopPx ? (now - p.t0) / 1000 : 0;
  }

  /** Is there room for MEGA's finger to steer? */
  get canAdopt(): boolean {
    return this.fly === null;
  }

  /**
   * A HUD finger (MEGA's) becomes the flying thumb: the pointer moves over to the canvas and the gesture starts here,
   * from where the finger is now (no stretch step), while its slot remembers the press's own point and time (client
   * px, ms), so one lift ends in exactly one result. keepPress = a held charge stays alive and ends on this lift.
   * False if a thumb already flies.
   */
  adoptThumb(e: PointerEvent, keepPress: boolean, x0: number, y0: number, t0: number): boolean {
    if (this.fly) return false;
    const slot = this.alloc(e.pointerId);
    if (!slot) return false;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    this.readRect();
    this.setSlot(slot, e, t0, Role.Fly);
    const x = slot.x0, y = slot.y0;
    slot.x0 = x0 - this.rectL;
    slot.y0 = y0 - this.rectT;
    slot.maxDist = Math.hypot(x - slot.x0, y - slot.y0);
    slot.ownsPress = keepPress;
    this.beginFly(slot, t0);
    this.anchorPt.x = this.fingerPt.x = x;
    this.anchorPt.y = this.fingerPt.y = y;
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

  /** Call once per frame before reading `state` (keyboard easing, hold-to-steer, the look's clock, the splat hold). */
  update(dt: number): void {
    const now = performance.now();
    this.pressTick(now);
    const st = this.state;
    const p = this.fly;
    // (the Bomb: a still hold on the bus charges, while the thumb steers as any thumb does)
    if (p && p.onBus) this.bombStep(p, now);
    // A thumb resting still past the tap window is steering (at neutral).
    if (p && !this.pointerDragging && now - p.t0 >= inputTune.stillTapMs) this.commitDrag();
    // A tap waiting on two fingers together, with nobody flying: once no finger still down can be the other half of one, it was a tap of its own
    // (a tap landing just after a thumb that then stayed down to look was lost, before).
    if (!p && this.gPendingTap && !this.gAnswered && !this.tapStillDown(now)) this.answer();
    st.thumb = this.pointerDragging;
    // the look starts on the clock too: a thumb can stop moving inside the delay
    for (let i = 0; i < MAX_POINTERS; i++) {
      const s = this.slots[i];
      if (s.role === Role.Second && !s.looking) this.lookStep(s, now);
      // (armed on the first frame that sees it, started on a later one that still does, aimLagMs past the hold: a lift queued behind a slow frame or two is still a
      // tap, its own time says so)
      if (this.canAim(s, now)) {
        if (s.aimArmed && now - s.t0 >= inputTune.aimHoldMs + inputTune.aimLagMs) this.startAim(s, now);
        else s.aimArmed = true;
      } else s.aimArmed = false;
    }
    const tx = (this.kR ? 1 : 0) - (this.kL ? 1 : 0);
    const ty = (this.kU ? 1 : 0) - (this.kD ? 1 : 0);
    if ((tx !== 0 || ty !== 0) && !this.pointerDragging) {
      // the thumb wins over the keys
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
    st.stretch.x = this.b.x;
    st.stretch.y = this.b.y;
    st.dragging = this.pointerDragging;
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
    this.onTap = this.onTripleFinger = this.onFirstGesture = this.onPress = this.onChargeStart = this.onAimStart = null;
    this.onAimEnd = null;
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
    if (!this.prCharging && this.megaOn && held >= config.splat.holdThreshold) {
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
      if (this.megaOn && held >= config.splat.holdThreshold) {
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

  /** A press held as the hands change (?earth's and ?moonland's hand-overs) ends cancelled with the hands that took it, so its owner's charge goes back to ready
   *  and its sound stops: a MEGA held through the hand-up drones on in space and fired by itself at the hand-down. Review four, 20 */
  endPress(): void {
    this.pressCancel(performance.now());
    // (and a Bomb charging: a hand-over is a fizzle)
    if (this.fly) this.bombEnd(this.fly, true);
    // (and no finger owns it after: a MEGA finger carried off the button into steering, on through the hand-overs, would end the next MEGA held when it lifts. Review five, 51)
    for (const s of this.slots) s.ownsPress = false;
  }

  // ---------------------------------------------------------------- pointers

  private pointerDown(e: PointerEvent) {
    const mouse = e.pointerType === 'mouse';
    if (mouse && e.button !== 0 && e.button !== 2) return;
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
    this.readRect();

    if (mouse && e.button === 2) {
      // (the right mouse: one job, and it never joins a gesture)
      this.setSlot(slot, e, now, Role.Second);
      slot.right = true;
      this.lookStep(slot, now);
      return;
    }

    const others = this.onGlass();
    // A second thumb that only just landed, and hasn't gone anywhere, makes this two fingers together.
    let recent = false;
    for (const s of this.slots) if (s.role === Role.Second && !s.right && now - s.t0 <= inputTune.tapMs && s.maxDist <= inputTune.tapSlopPx) recent = true;

    const inLook = !mouse && this.inLookZone(e.clientX - this.rectL, e.clientY - this.rectT);
    if (this.fly || inLook) {
      // Another finger joins, or a thumb lands in the look zone. It never moves the flying anchor, and with nobody flying the bus flies itself.
      this.setSlot(slot, e, now, Role.Second);
      slot.inLook = inLook;
      slot.flick = this.commands(slot) ? Flick.Easy : Flick.No;
      if (others === 0) this.beginGesture(now);
      else if (others + 1 > this.gMax) this.gMax = others + 1;
      if (this.fly ? !this.primarySteering(now) : recent) {
        this.gMulti = true;
        if (others + 1 >= 3 && now - this.gT0 <= inputTune.tripleWindowMs) {
          this.triple();
          return;
        }
      }
      if (!this.fly) this.onPress?.();
      return;
    }

    // The flying thumb.
    this.setSlot(slot, e, now, Role.Fly);
    if (others === 0 && !mouse && this.commands(slot)) slot.flick = Flick.Firm;
    // (on the bus itself it may charge a Bomb: only the landing counts. Its clock starts now if the belly is full already)
    if (this.bombOn && !mouse && this.onBusBox(slot.x0, slot.y0)) {
      slot.onBus = true;
      slot.bombFrom = this.bombFull ? now : -1;
    }
    this.beginFly(slot, now);
    this.gMax = others + 1;
    this.gMulti = recent;
    if (others + 1 >= 3 && recent) this.triple();
    else this.onPress?.();
  }

  private pointerMove(e: PointerEvent) {
    const slot = this.find(e.pointerId);
    if (!slot) return;
    const x = e.clientX - this.rectL;
    const y = e.clientY - this.rectT;
    slot.x = x;
    slot.y = y;
    const d = Math.hypot(x - slot.x0, y - slot.y0);
    if (d > slot.maxDist) slot.maxDist = d;
    if (slot === this.fly) {
      this.fingerPt.x = x;
      this.fingerPt.y = y;
      if (slot.onBus && slot.maxDist > this.bombSlop(slot)) this.bombOff(slot);
      if (!this.pointerDragging && slot.maxDist > inputTune.tapSlopPx) this.commitDrag();
      if (this.pointerDragging) this.applyStretch();
    } else if (slot === this.aimSlot) {
      // (an aim's drag drags the aim, never the view)
      this.state.aim.x = x;
      this.state.aim.y = y;
    } else if (slot.role === Role.Second) {
      this.lookStep(slot, evTime(e));
    }
  }

  private pointerUp(e: PointerEvent, cancelled: boolean) {
    const slot = this.find(e.pointerId);
    if (!slot) return;
    const now = evTime(e);
    const role = slot.role;
    if (role === Role.Orphan || slot.right) {
      this.free(slot);
      return;
    }
    // (an aim's lift is its release, and nothing else: no tap, no flick. One that lifts still before its aim began is a tap: secondTap)
    const aimed = slot.aiming;
    if (aimed) this.endAim(slot, cancelled);
    // (the Bomb's: let go at II or III it fires, and is nothing else; a still lift on the bus before II shows is a tap, however long it was held)
    const bombed = !cancelled && slot.bombTier >= 2;
    const bombTap = !cancelled && slot.onBus && !bombed && slot.maxDist <= inputTune.tapSlopPx;
    if (slot.bombTier > 0) this.bombEnd(slot, cancelled);
    const dir = cancelled || aimed || bombed ? 0 : this.flickOf(slot, e.clientX - this.rectL, e.clientY - this.rectT, now);
    const quick = !cancelled && !aimed && !bombed && (this.isQuick(slot, now) || bombTap);
    if (!quick) this.gAllQuick = false;
    const tap = !cancelled && !aimed && this.secondTap(slot, now);
    const ownsPress = slot.ownsPress, t0 = slot.t0;
    this.free(slot);

    if (role === Role.Fly) {
      this.fly = null;
      this.endSteering();
      // A charge MEGA's finger carried off ends here, and only here.
      if (ownsPress) this.pressEnd(Src.Button, now, cancelled);
      else if (dir) {
        this.onTurbo?.(dir, true);
        this.promote(t0);
      }
      // The everyday tap: one finger, short and still -> fire on the up. Beside a finger that landed with it, it waits: two fingers tapped together
      // are one tap at the last lift, and if the other turns out to be no tap (it looks, rests or flicks), this one was a tap of its own (update).
      else if (quick && !this.gAnswered) {
        if (this.gMulti) this.gPendingTap = true;
        else this.onTap?.();
      }
    } else if (dir) this.onTurbo?.(dir, false);
    else if (tap) {
      if (this.primarySteering(now)) this.answer();
      // Landed before the thumb committed to steering: still the player's tap, as soon as it commits (or when the gesture ends).
      else if (this.fly || (this.gMulti && !this.gAnswered)) this.gPendingTap = true;
      else this.onTap?.();
    }

    if (this.onGlass() === 0) {
      // Two fingers tapped together, nobody steering: one tap at the last lift.
      const together = this.gMulti && this.gAllQuick && !this.gSteered && this.gMax === 2 && now - this.gT0 <= inputTune.stillTapMs + 150;
      if (!this.gAnswered && (together || this.gPendingTap)) this.answer();
      this.gMulti = false;
      this.gPendingTap = false;
    }
  }

  // ---------------------------------------------------------------- helpers

  private readRect() {
    const r = this.el.getBoundingClientRect();
    this.rectL = r.left;
    this.rectT = r.top;
    this.rectW = r.width;
    this.rectH = r.height;
  }

  /** A new gesture's bookkeeping. */
  private beginGesture(now: number) {
    this.gT0 = now;
    this.gMax = 1;
    this.gMulti = false;
    this.gAllQuick = true;
    this.gAnswered = false;
    this.gPendingTap = false;
    this.gSteered = false;
  }

  /** The flying thumb touched down. */
  private beginFly(slot: Slot, now: number) {
    // (a tap still waiting on a finger that landed with it, the other half of two fingers tapped together if it lifts as fast, was the player's tap: a thumb landing
    // to fly starts a new gesture, which forgot it, so a tap and the same thumb back down to steer beside a resting or looking thumb splatted nothing)
    if (this.gPendingTap && !this.gAnswered) this.answer();
    this.fly = slot;
    this.beginGesture(now);
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
    slot.x0 = slot.x = e.clientX - this.rectL;
    slot.y0 = slot.y = e.clientY - this.rectT;
    slot.t0 = now;
    slot.seq = ++this.landings;
    slot.maxDist = 0;
    slot.flick = Flick.No;
    slot.looking = false;
    slot.right = false;
    slot.ownsPress = false;
    slot.inLook = false;
    slot.aiming = false;
    slot.aimArmed = false;
    slot.onBus = false;
    slot.bombFrom = -1;
    slot.bombTier = 0;
    slot.bombArm = 0;
  }

  private free(s: Slot) {
    if (s.looking) this.endLook(s);
    // (a lost, swallowed or dropped finger ends its aim cancelled; a lift has ended it already. Its Bomb fizzles)
    if (s.aiming) this.endAim(s, true);
    this.bombEnd(s, true);
    s.role = Role.None;
    s.id = -1;
  }

  /** Forget a pointer without any tap (stale / lost). */
  private drop(s: Slot) {
    const role = s.role;
    this.free(s);
    if (role === Role.Fly) {
      this.fly = null;
      this.endSteering();
      // (a lost touch never leaves a charge running)
      if (s.ownsPress) this.pressEnd(Src.Button, performance.now(), true);
    }
    if (role === Role.Fly || role === Role.Second) this.gAllQuick = false;
  }

  /**
   * touchend/touchcancel with no fingers left: any touch pointer still held
   * lost its pointerup. Checked a beat later so a pointerup dispatched after
   * the touch event (engine order varies) still lands first. What landed
   * since is a new touch, whatever its timestamp says: the next of two quick
   * flicks can be queued behind this touchend on a slow frame.
   */
  private touchesGone(e: TouchEvent) {
    if (e.touches.length > 0) return;
    const seq = this.landings;
    window.clearTimeout(this.staleTimer);
    this.staleTimer = window.setTimeout(() => {
      for (const s of this.slots) if (s.role !== Role.None && s.type === 'touch' && s.seq <= seq) this.drop(s);
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

  /** Thumbs on the glass (not the mouse's right button, not what a three-finger gesture swallowed). */
  private onGlass(): number {
    let n = 0;
    for (const s of this.slots) if ((s.role === Role.Fly || s.role === Role.Second) && !s.right) n++;
    return n;
  }

  private isQuick(s: Slot, now: number): boolean {
    if (s.aiming) return false;
    const dur = now - s.t0;
    return (dur <= inputTune.stillTapMs && s.maxDist <= inputTune.tapSlopPx) || (dur <= inputTune.quickTapMs && s.maxDist <= inputTune.quickTapSlopPx);
  }

  /** The second thumb's tap: shorter than the first's, because past it the thumb is resting. With nobody flying, as long as the first's. */
  private secondTap(s: Slot, now: number): boolean {
    const dur = now - s.t0;
    // (off the lane with nobody flying, a still finger aims from aimHoldMs: up to it, it was a tap, and one that could aim but whose aim hadn't begun is one too)
    const limit = this.fly || this.gMulti ? inputTune.secondTapMs : s.inLook && this.aimOn ? (s.aimArmed || this.canAim(s, now) ? Infinity : inputTune.aimHoldMs) : inputTune.stillTapMs;
    return (dur <= limit && s.maxDist <= inputTune.tapSlopPx) || (dur <= inputTune.quickTapMs && s.maxDist <= inputTune.quickTapSlopPx);
  }

  /** A second thumb still down could yet lift as a tap. */
  private tapStillDown(now: number): boolean {
    for (const s of this.slots) if (s.role === Role.Second && !s.right && this.isQuick(s, now)) return true;
    return false;
  }

  /** The flying thumb has committed: moved past the tap slop or held past the tap window. */
  private primarySteering(now: number): boolean {
    const p = this.fly;
    if (!p) return false;
    return this.pointerDragging || p.maxDist > inputTune.tapSlopPx || now - p.t0 > inputTune.tapMs;
  }

  /** The one tap a multi-finger gesture is allowed. */
  private answer() {
    // (another thumb's tap: a Bomb charging fizzles, and the tap is the tap)
    if (this.fly) this.bombEnd(this.fly, true);
    this.gAnswered = true;
    this.gPendingTap = false;
    this.onTap?.();
  }

  /** Three fingers: the tuner. Everything down is swallowed until it lifts. */
  private triple() {
    this.gPendingTap = false;
    this.fly = null;
    this.endSteering();
    for (const s of this.slots) {
      if ((s.role !== Role.Fly && s.role !== Role.Second) || s.right) continue;
      if (s.looking) this.endLook(s);
      if (s.aiming) this.endAim(s, true);
      this.bombEnd(s, true);
      s.role = Role.Orphan;
    }
    this.onTripleFinger?.();
  }

  /** May this touch be a command at all? Not by a mouse, and not landing where iOS owns the edge or a hand grips the phone. */
  private commands(s: Slot): boolean {
    return s.type !== 'mouse' && s.y0 <= this.rectH - inputTune.flickBottomPx && s.x0 >= inputTune.flickSidePx && s.x0 <= this.rectW - inputTune.flickSidePx;
  }

  /** A touch landing here never flies: the look zone, or with the bus's zone on everywhere but that, and nowhere while lookOff. Only the landing counts: a look that wanders out of it is still a look. */
  private inLookZone(x: number, y: number): boolean {
    if (this.lookOff) return false;
    const b = this.busZone;
    if (b) {
      // (the lane: a half disc over the bus, and from the bus's line down a funnel that opens out to the screen's whole width `open` under it, and stays that wide down to the
      // bottom, where the thumb that flies it rests: so a look is a touch over the bus's line, or out to a side beside it. Kept on the screen: a look up past about 20 degrees
      // puts the bus under its bottom edge, and the lane went with it, so no touch could fly. So the bus stands no lower than its usual line (laneLow) or r over the bottom
      // edge: the strain at the ceiling tips the view up and sinks the bus to the edge too, and a thumb landing again where it rests must still fly. A bus sitting low opens
      // out sooner, so that last r is always the whole width; and it stands no higher than the top edge, which would have made the whole screen the lane)
      const r = b.r, W = this.rectW, H = this.rectH;
      const bx = Math.max(r, Math.min(W - r, b.x)), by = Math.max(0, Math.min(H - r, H * inputTune.laneLow, b.y));
      const dx = x - bx, dy = y - by;
      if (dy < 0) return dx * dx + dy * dy > r * r;
      const open = Math.min(b.open, H - r - by);
      const k = open > 0 ? Math.min(1, dy / open) : 1;
      return x < (bx - r) * (1 - k) || x > bx + r + (W - bx - r) * k;
    }
    const w = this.rectW * inputTune.lookZone;
    return this.swapped ? x > this.rectW - w : x < w;
  }

  private flickOf(s: Slot, x: number, y: number, now: number): 1 | -1 | 0 {
    const T = inputTune;
    if (s.flick === Flick.No) return 0;
    const dx = x - s.x0, dy = y - s.y0, ms = now - s.t0;
    return s.flick === Flick.Firm ? readFlick(dx, dy, ms, T.loneFlickPx, T.loneFlickMs, T.loneFlickSpeed, T.loneFlickDeg) : readFlick(dx, dy, ms, T.flickPx, T.flickMs, T.flickSpeed, T.flickDeg);
  }

  /** The stroke that just lifted was a command, not a flying thumb, so a thumb that landed during it is a lone touch: it flies, from where it landed, unless it landed in the look zone. A grip in a band isn't one: the next thumb to land flies. */
  private promote(t0: number) {
    for (const s of this.slots) {
      // (where it landed as the lane was then, not as it is at this lift: the bus moves on the screen. feat/earth's c11baeb, the first review's minor)
      if (s.role !== Role.Second || s.right || s.t0 < t0 || !this.commands(s) || s.inLook) continue;
      if (s.looking) this.endLook(s);
      s.role = Role.Fly;
      s.flick = Flick.No;
      this.beginFly(s, s.t0);
      this.fingerPt.x = s.x;
      this.fingerPt.y = s.y;
      if (s.maxDist > inputTune.tapSlopPx) this.commitDrag();
      return;
    }
  }

  /** Should this thumb have the view? Then it does, from where it landed. Only one thumb looks at a time. */
  private lookStep(s: Slot, now: number) {
    if (s.aiming) return;
    if (!s.looking) {
      if (this.looker) return;
      if (!s.right && (now - s.t0 < inputTune.lookDelayMs || s.maxDist <= inputTune.tapSlopPx)) return;
      s.looking = true;
      this.looker = s;
      this.state.look.on = true;
    }
    this.state.look.x = s.x - s.x0;
    this.state.look.y = s.y0 - s.y;
  }

  /**
   * Hold to aim: a finger off the lane that stayed still aimHoldMs (one that moved first looks, and one looking never aims), with no other aiming. Not one of two fingers
   * that landed together while the other could still be the rest of a two-finger tap: that's a tap's gesture, and it waits for the other to lift or commit.
   */
  private canAim(s: Slot, now: number): boolean {
    if (s.role !== Role.Second || this.aimSlot || !this.aimOn || !s.inLook || s.right || s.looking || s.maxDist > inputTune.tapSlopPx || now - s.t0 < inputTune.aimHoldMs) return false;
    return !this.twoTapOpen(s, now);
  }

  /** `s` could still be one of two fingers tapped together: another landed with it and could yet lift as the rest of that tap. */
  private twoTapOpen(s: Slot, now: number): boolean {
    if (this.gMulti && !this.gSteered && now - this.gT0 <= inputTune.stillTapMs + 150) {
      if (this.gAllQuick && this.gMax === 2) return true;
      for (const o of this.slots) if (o !== s && (o.role === Role.Fly || o.role === Role.Second) && !o.right && this.isQuick(o, now)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- the Bomb

  /** A landing on the bus's own box. */
  private onBusBox(x: number, y: number): boolean {
    const b = this.busBox;
    return !!b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  }

  /** How far a thumb on the bus may move from its landing and still charge: the tap's slop until Bomb II shows, MEGA's charge slop after. */
  private bombSlop(s: Slot): number {
    return s.bombTier >= 2 ? inputTune.chargeSlopPx : inputTune.tapSlopPx;
  }

  /** The thumb on the bus moved past its slop: a charge fizzles, and for the rest of the touch it's the flying thumb as any. */
  private bombOff(s: Slot) {
    this.bombEnd(s, true);
    s.onBus = false;
  }

  /** Once a frame for the flying thumb on the bus: the charge's start and its tiers. */
  private bombStep(s: Slot, now: number) {
    if (s.maxDist > this.bombSlop(s)) return this.bombOff(s);
    if (!this.bombFull) {
      // (a tier waits for a full belly: one gone mid-charge, a lock's shot that spent it, fizzles, and the clock starts again when it's back)
      this.bombEnd(s, true);
      s.bombFrom = -1;
      return;
    }
    if (s.bombFrom < 0) s.bombFrom = now;
    const T = inputTune, k = now - s.bombFrom;
    if (s.bombTier === 0) {
      // (not while it could still be one of a two-finger tap: that waits for the other to lift or commit)
      if (k < T.aimHoldMs || this.twoTapOpen(s, now)) return;
      s.bombTier = 1;
      const B = this.state.bomb;
      B.on = true;
      B.tier = 1;
      B.t0 = s.t0;
      B.at = s.bombFrom;
      this.onBombCharge?.();
    }
    // (armed on the first frame that sees it, shown on a later one that still does, aimLagMs past its time: a lift queued behind a slow frame is what its own time says)
    const gift = this.bombGift >= 2 ? this.bombGift : 0;
    const two = gift ? T.aimHoldMs : this.bombTwoMs, three = gift ? T.aimHoldMs : this.bombThreeMs;
    const reached = gift || (k >= three ? 3 : k >= two ? 2 : 1);
    if (reached > s.bombArm) {
      s.bombArm = reached;
      return;
    }
    if (s.bombArm > s.bombTier && k >= (s.bombArm >= 3 ? three : two) + T.aimLagMs) {
      s.bombTier = s.bombArm;
      this.state.bomb.tier = s.bombTier;
      this.onBombTier?.(s.bombTier);
    }
  }

  /** The charge ends, if it began: with the tier it had, or cancelled. */
  private bombEnd(s: Slot, cancelled: boolean) {
    const tier = s.bombTier;
    s.bombArm = 0;
    if (tier === 0) return;
    s.bombTier = 0;
    this.state.bomb.on = false;
    this.state.bomb.tier = 0;
    this.onBombEnd?.(tier, cancelled);
  }

  /** A still finger off the lane holds to aim (state.aim), from now until its lift. */
  private startAim(s: Slot, now: number) {
    s.aiming = true;
    this.aimSlot = s;
    const A = this.state.aim;
    A.on = true;
    A.x = s.x;
    A.y = s.y;
    A.x0 = s.x0;
    A.y0 = s.y0;
    A.t0 = s.t0;
    A.at = now;
    this.gAllQuick = false;
    this.onAimStart?.();
  }

  private endAim(s: Slot, cancelled: boolean) {
    s.aiming = false;
    if (this.aimSlot === s) this.aimSlot = null;
    this.state.aim.on = false;
    this.onAimEnd?.(cancelled);
  }

  private endLook(s: Slot) {
    s.looking = false;
    this.looker = null;
    const L = this.state.look;
    L.on = false;
    L.x = L.y = 0;
  }

  private commitDrag() {
    if (!this.fly) return;
    this.pointerDragging = true;
    this.gSteered = true;
    if (this.gPendingTap && !this.gAnswered) this.answer();
    this.kx = this.ky = 0;
    this.applyStretch();
  }

  private endSteering() {
    this.pointerDragging = false;
    this.b.x = this.b.y = 0;
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
        if (down && !e.repeat) this.onTurbo?.(1, false);
        break;
      case 'KeyQ':
      case 'PageDown':
        if (down && !e.repeat) this.onTurbo?.(-1, false);
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
    // (focus lost mid-hold: the charge ends cancelled)
    this.pressCancel(performance.now());
    for (const s of this.slots) {
      if (s.looking) this.endLook(s);
      if (s.aiming) this.endAim(s, true);
      this.bombEnd(s, true);
      s.role = Role.None;
      s.id = -1;
    }
    this.fly = null;
    this.gMulti = false;
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
