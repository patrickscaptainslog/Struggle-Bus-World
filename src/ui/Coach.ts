// First run: one cue at a time, each ended by doing it (the hint: docs/specs/flight/THUMBS.md).
// Everything here passes touches through; a `taught` bitmask in the controls prefs
// means each cue shows once ever. Off with ?nohud, ?skipintro, ?nocoach (?coach keeps
// it on under skipintro, for QA).
//
//   0 to fog end         nothing on screen, the thumb is live
//   fog end / first touch   MEGA arrives
//   a beat after the fog    the hint: the flicks, the lane, the look and hold to aim, in one toast, once
//                           (a save that saw it before HOLD TO AIM was in it gets that line alone, once)
//   a glint, no splat yet   TAP: a fingertip ring at the cue slot
//   first splat             DRAG: two chevrons sway, until a thumb commits or 8 s
//   third splat, or a still press of 0.6 s   MEGA's face says HOLD (only with MEGA awake, &mega)
//   third splat, then the first painted building glinting with a full belly under 300 m   HOLD THE BUS STILL / LIFT TO BOMB,
//                           once (only with the Bomb on, &bomb; a Bomb let go first teaches it)
//   third splat, then the first Lob's ring with a full belly, the nose up   TAP TO LOB IT / INTO THE RING, once (a Lob thrown first teaches it)
//
// The flicks and the look are hidden on purpose: the hint is all the teaching
// there is, it asks for nothing, and nothing ends it but its own time
// (docs/specs/flight/THUMBS.md).
//
// No DOM: it reads a frame's facts and leaves what is due in its fields.

export const TAUGHT = { tap: 1, drag: 2, mega: 8, thumbs: 32, aim: 64, bomb: 256, lob: 1024 } as const;

/** The first run's one mention of the flicks and the look: the gestures are hidden, and this is all the teaching they get. Any thumb flicks, so that comes first; then the bus's lane (Input.busZone):
 *  a touch near the bus or anywhere under it flies it, and one high over it looks (or beside it, which the hint leaves to the thumb to find): just over
 *  the bus is the lane's half disc, and a drag up there is the yoke's nose-down, so the hint says HIGH UP, not ABOVE IT. It fits the toast at 116 of the screen's 131 px.
 *  Hold to aim is the same place held still (SHOTS.md: "The first-run hint adds HOLD TO AIM"), and its line is the fourth: four lines fill the toast's 44 px slot. */
export const hintLines = (aim: boolean): string[] => (aim ? ['FLICK UP FOR GEARS', 'STEER BELOW THE BUS', 'DRAG HIGH UP TO LOOK', AIM_LINE] : ['FLICK UP FOR GEARS', 'STEER BELOW THE BUS', 'DRAG HIGH UP TO LOOK']);
export const AIM_LINE = 'HOLD HIGH UP TO AIM';
/** The Bomb's one hint (SHOTS.md: "before the first Bomb"), in the toast's slot, when a painted building glints, where a Bomb's jump means most. */
export const BOMB_LINES = ['HOLD THE BUS STILL', 'LIFT TO BOMB'];
/** The Lob's one hint (src/game/Lob.ts), when its dotted ring first shows: the nose is up already, and a tap now throws it there. */
export const LOB_LINES = ['TAP TO LOB IT', 'INTO THE RING'];

/** The hint, a beat after the fog has lifted (s). */
const HINT_AFTER = 0.7;

export type Cue = 'none' | 'tap' | 'drag';

export interface CoachFrame {
  glinting: boolean;
  openingOver: boolean;
  /** the opening's gate is down: the look and the gears the hint teaches are waiting for the bridge */
  gated?: boolean;
  splats: number;
  /** a thumb committed this session */
  thumb: boolean;
  /** seconds a finger has rested still (0: none) */
  stillPress: number;
  /** the charge has started this session */
  charged: boolean;
  /** the Bomb (&bomb): a painted building glints with a full belly, the bus under 300 m over the ground; and a Bomb has been let go this session */
  bombGlint?: boolean;
  bombed?: boolean;
  /** the Lob's ring shows (the body nose up, a full belly); and a Lob has been thrown this session */
  lobRing?: boolean;
  lobbed?: boolean;
}

export class Coach {
  taught: number;
  /** the cue showing */
  cue: Cue = 'none';
  /** true for the one frame it is due: Controls consumes it */
  megaDue = false;
  /** the same, the hint */
  hintDue = false;
  /** the same, the hint's HOLD TO AIM line alone, once, for a save that had the hint before it had that line (SHOTS.md, 2026-11-06) */
  aimHintDue = false;
  /** the same, the Bomb's hint (BOMB_LINES), once ever */
  bombHintDue = false;
  /** the same, the Lob's (LOB_LINES), once ever */
  lobHintDue = false;
  /** a bit changed: Controls saves */
  dirty = false;
  private dragT = 0;
  private glintT = 0;
  private hintT = 0;

  /** `mega`: MEGA is awake (&mega). Asleep, its lesson is never due, and never marked learned either, so it still comes the day MEGA does */
  constructor(taught: number, private readonly mega = true, private readonly aim = false, private readonly bomb = false) {
    this.taught = taught | 0;
  }

  private learn(bit: number) {
    if (this.taught & bit) return;
    this.taught |= bit;
    this.dirty = true;
  }

  has(bit: number): boolean {
    return (this.taught & bit) !== 0;
  }

  /** The player used MEGA...: a lesson they no longer need. */
  done(bit: number) {
    this.learn(bit);
  }

  frame(dt: number, f: CoachFrame) {
    this.megaDue = false;
    this.hintDue = false;
    this.aimHintDue = false;
    this.bombHintDue = false;
    this.lobHintDue = false;
    if (f.lobbed) this.learn(TAUGHT.lob);
    if (f.thumb) this.learn(TAUGHT.drag);
    if (f.bombed) this.learn(TAUGHT.bomb);
    if (f.splats > 0) this.learn(TAUGHT.tap);
    if (f.charged) this.learn(TAUGHT.mega);

    // the text cues
    let cue: Cue = 'none';
    if (f.openingOver) {
      if (!this.has(TAUGHT.tap)) {
        // (a glint flickering between buildings shouldn't blink the cue)
        this.glintT = f.glinting ? 0.6 : Math.max(0, this.glintT - dt);
        if (this.glintT > 0) cue = 'tap';
      } else if (!this.has(TAUGHT.drag) && f.splats > 0) {
        this.dragT += dt;
        if (this.dragT >= 8) this.learn(TAUGHT.drag);
        else cue = 'drag';
      }
    }
    this.cue = cue;

    if (f.openingOver && !f.gated && (!this.has(TAUGHT.thumbs) || (this.aim && !this.has(TAUGHT.aim)))) {
      this.hintT += dt;
      if (this.hintT >= HINT_AFTER) {
        // (the whole hint, its HOLD TO AIM line in it; a save that saw the hint before that line gets the line alone, once)
        if (this.has(TAUGHT.thumbs)) this.aimHintDue = true;
        else this.hintDue = true;
        this.learn(TAUGHT.thumbs);
        if (this.aim) this.learn(TAUGHT.aim);
      }
    }

    if (this.mega && !this.has(TAUGHT.mega) && (f.splats >= 3 || f.stillPress >= 0.6) && f.openingOver) {
      this.learn(TAUGHT.mega);
      this.megaDue = true;
    }
    // (after three taps, the first time a painted building glints with a full belly under 300 m: a Bomb there jumps it two or three stages)
    if (this.bomb && !this.has(TAUGHT.bomb) && f.openingOver && !f.gated && f.splats >= 3 && f.bombGlint) {
      this.learn(TAUGHT.bomb);
      this.bombHintDue = true;
    }
    // (after three taps, the first time its ring shows: the nose is up, and a tap now lobs it there)
    if (!this.has(TAUGHT.lob) && f.openingOver && !f.gated && f.splats >= 3 && f.lobRing) {
      this.learn(TAUGHT.lob);
      this.lobHintDue = true;
    }
  }
}
