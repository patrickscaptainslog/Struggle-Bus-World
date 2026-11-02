// First run: one cue at a time, each ended by doing it (docs/specs/hybrid-controls.md 5).
// Everything here passes touches through; a `taught` bitmask in the controls prefs
// means each cue shows once ever. Off with ?nohud, ?skipintro, ?nocoach (?coach keeps
// it on under skipintro, for QA).
//
//   0 to fog end         nothing on screen, the thumb is live
//   fog end / first touch   MEGA arrives
//   a beat after the fog    the hint: what the second thumb does, in one toast, once
//   a glint, no splat yet   TAP: a fingertip ring at the cue slot
//   first splat             DRAG: two chevrons sway, until a thumb commits or 8 s
//   third splat, or a still press of 0.6 s   MEGA's face says HOLD
//
// The second thumb's gestures are hidden on purpose: the hint is all the teaching
// there is, it asks for nothing, and nothing ends it but its own time
// (docs/specs/flight/THUMBS.md).
//
// No DOM: it reads a frame's facts and leaves what is due in its fields.

export const TAUGHT = { tap: 1, drag: 2, mega: 8, thumbs: 32 } as const;

/** The hint, a beat after the fog has lifted (s). */
const HINT_AFTER = 0.7;

export type Cue = 'none' | 'tap' | 'drag';

export interface CoachFrame {
  glinting: boolean;
  openingOver: boolean;
  splats: number;
  /** a thumb committed this session */
  thumb: boolean;
  /** seconds a finger has rested still (0: none) */
  stillPress: number;
  /** the charge has started this session */
  charged: boolean;
}

export class Coach {
  taught: number;
  /** the cue showing */
  cue: Cue = 'none';
  /** true for the one frame it is due: Controls consumes it */
  megaDue = false;
  /** the same, the second thumb's hint */
  hintDue = false;
  /** a bit changed: Controls saves */
  dirty = false;
  private dragT = 0;
  private glintT = 0;
  private hintT = 0;

  constructor(taught: number) {
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
    if (f.thumb) this.learn(TAUGHT.drag);
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

    if (f.openingOver && !this.has(TAUGHT.thumbs)) {
      this.hintT += dt;
      if (this.hintT >= HINT_AFTER) {
        this.learn(TAUGHT.thumbs);
        this.hintDue = true;
      }
    }

    if (!this.has(TAUGHT.mega) && (f.splats >= 3 || f.stillPress >= 0.6) && f.openingOver) {
      this.learn(TAUGHT.mega);
      this.megaDue = true;
    }
  }
}
