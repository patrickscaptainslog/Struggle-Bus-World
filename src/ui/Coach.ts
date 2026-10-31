// First run: one cue at a time, each ended by doing it (docs/specs/hybrid-controls.md 5).
// Everything here passes touches through; a `taught` bitmask in the controls prefs
// means each cue shows once ever. Off with ?nohud, ?skipintro, ?nocoach (?coach keeps
// it on under skipintro, for QA).
//
//   0 to fog end         nothing on screen, the thumb is live
//   fog end / first touch   TURBO, MEGA and the toggle arrive
//   a glint, no splat yet   TAP: a fingertip ring at the cue slot
//   first splat             DRAG: two chevrons sway, until a thumb commits or 8 s
//   gate cleared            TURBO blinks three times (its label says what it is)
//   2 s after the gate      the chip, TILT TO STEER? (Controls decides whether it may show)
//   third splat, or a still press of 0.6 s   MEGA's face says HOLD
//
// No DOM: it reads a frame's facts and leaves what is due in its fields.

export const TAUGHT = { tap: 1, drag: 2, turbo: 4, mega: 8, chip: 16 } as const;

export type Cue = 'none' | 'tap' | 'drag';

export interface CoachFrame {
  glinting: boolean;
  openingOver: boolean;
  gearsLocked: boolean;
  /** a shift is waiting for the gate */
  armed: boolean;
  splats: number;
  /** a thumb committed this session */
  thumb: boolean;
  /** seconds a finger has rested still (0: none) */
  stillPress: number;
  /** a finger on the screen or a splat press held */
  held: boolean;
  /** the charge has started this session */
  charged: boolean;
}

export class Coach {
  taught: number;
  /** the cue showing */
  cue: Cue = 'none';
  /** true for the one frame something is due: Controls consumes them */
  turboDue = false;
  megaDue = false;
  chipDue = false;
  /** a bit changed: Controls saves */
  dirty = false;
  private dragT = 0;
  private sinceFog = 0;
  private sinceGate = 0;
  private gateSeen = false;
  private glintT = 0;

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

  /** The player tapped TURBO, MEGA...: a lesson they no longer need. */
  done(bit: number) {
    this.learn(bit);
  }

  frame(dt: number, f: CoachFrame) {
    this.turboDue = this.megaDue = this.chipDue = false;
    if (f.thumb) this.learn(TAUGHT.drag);
    if (f.splats > 0) this.learn(TAUGHT.tap);
    if (f.charged) this.learn(TAUGHT.mega);
    if (f.openingOver) this.sinceFog += dt;

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

    // the gate (in a city with no bridge it clears when the fog ends)
    const gate = f.openingOver && !f.gearsLocked;
    if (gate && !this.gateSeen) {
      this.gateSeen = true;
      if (!this.has(TAUGHT.turbo)) {
        if (!f.armed) this.turboDue = true;
        this.learn(TAUGHT.turbo);
      }
    }
    if (gate) this.sinceGate += dt;

    if (!this.has(TAUGHT.chip) && gate && this.sinceGate >= 2 && !f.held && cue === 'none' && (f.splats > 0 || this.sinceFog >= 10)) this.chipDue = true;

    if (!this.has(TAUGHT.mega) && (f.splats >= 3 || f.stillPress >= 0.6) && f.openingOver) {
      this.learn(TAUGHT.mega);
      this.megaDue = true;
    }
  }
}
