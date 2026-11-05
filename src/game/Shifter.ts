import type { Flight } from './Flight';
import type { TurboDrive } from './Turbo';
import { inputTune } from './Input';

// What a flick means (docs/specs/flight/THUMBS.md). No DOM: the keys and the
// thumbs land here alike, and the offline harness runs it.
//
//  - One flick is one rung, at once: up the gears, then turbo's levels over the top
//    gear (TurboDrive.rung). A flick up answers the same moment (onAnswer, seen at the
//    bus and heard). Past the last rung it says LOCKED, which is an answer of its own.
//  - A flick down drops exactly one rung, turbo first. One thumb's stroke pulled the
//    stick until its lift, and that pull goes back with it (Flight.unpull).
//  - Under the opening's gate a gear would lift the bus into the deck, so a flick up
//    waits for the gate, fired by itself once it clears, and a flick down takes it
//    back. One rung waits, however many flicks: the gate says when, it isn't a queue,
//    and six flicks under it were TURBO 3 at the bridge. (Express lifts nothing, but
//    the gate's one rule stands: no gear under it, and it says so.)

export type ShiftAnswer =
  /** a flick up: a rung goes, now */
  | 'go'
  /** the same, under the opening's gate */
  | 'gated'
  /** a flick waiting for the gate has been taken back */
  | 'back';

export class Shifter {
  /** the opening's gate (main.ts, per frame) */
  locked = false;
  onAnswer: ((a: ShiftAnswer) => void) | null = null;
  /** the rung waiting for the gate: 0 or 1 */
  private queued = 0;

  constructor(
    private readonly drive: TurboDrive,
    private readonly flight: Flight,
  ) {}

  /** A rung waits for the gate (the readout's ARMED). */
  get armed(): boolean {
    return this.queued > 0;
  }

  /** A flick, or E / Q. `flew`: the stroke was on the stick. */
  flick(dir: 1 | -1, flew = false): void {
    if (dir > 0) this.up();
    else this.down(flew);
  }

  /** Once per frame, before the drive's update. */
  tick(): void {
    if (!this.locked) for (; this.queued > 0; this.queued--) this.drive.rung(1, this.flight);
  }

  private up() {
    if (this.locked) {
      // (one rung, and only if the ladder has one left: a flick under the gate never stacks gears up for later, and LOCKED is a flick's answer at the top, not the gate's)
      if (this.queued < Math.min(1, this.drive.rungsLeft)) this.queued++;
      this.onAnswer?.('gated');
      return;
    }
    if (!this.drive.topped) this.onAnswer?.('go');
    this.drive.rung(1, this.flight);
  }

  private down(flew: boolean) {
    const d = this.drive;
    const waiting = this.queued > 0;
    // (one thumb's flick down is a pull too: a flick down leaves the bus as it was, so that goes back. Out of a gear
    // that bit it holds the height anyway, and with nothing to do it was only ever a quick pull. A gear still lifting
    // that bit inside the stroke bit on the stroke's own pull: it was still lifting when the thumb meant to take it back)
    const bit = d.lifts && d.engaged && !(flew && d.time - d.engagedAt <= inputTune.loneFlickMs / 1000);
    if (flew && (waiting || d.level > 0 || (d.gear > 0 && !bit))) this.flight.unpull();
    if (waiting) {
      this.queued--;
      this.onAnswer?.('back');
    } else d.rung(-1, this.flight);
  }
}
