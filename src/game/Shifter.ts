import { inputTune } from './Input';
import type { Flight } from './Flight';
import type { TurboDrive } from './Turbo';

// What a flick means (docs/specs/flight/THUMBS.md). No DOM: the keys and the
// thumbs land here alike, and the offline harness runs it.
//
//  - A flick up answers at once (onAnswer, seen at the bus and heard) and its gear
//    waits doubleMs for a second flick. The wait hides inside the gear's own lift.
//  - A second flick landing inside that window drops the waiting gear and turns
//    turbo on, or adds a level if it is on already.
//  - A flick down never waits: it takes a waiting gear back, else ends all turbo,
//    else drops a gear.
//  - Under the opening's gate a gear would lift the bus into the deck, so it waits
//    for the gate on top: fired by itself once the gate clears. (Express lifts
//    nothing, but the gate's one rule stands: no gear under it, and it says so.)
//  - LOCKED can only come out of a gear that really bit: past the last usable gear
//    a first flick answers like any other, because the second one is turbo.

export type ShiftAnswer =
  /** a first flick up, now */
  | 'first'
  /** the same, under the opening's gate */
  | 'gated'
  /** a gear that was waiting has been taken back */
  | 'back';

export class Shifter {
  /** the opening's gate (main.ts, per frame) */
  locked = false;
  onAnswer: ((a: ShiftAnswer) => void) | null = null;
  /** when the first flick lifted (ms): its gear waits; -1: no gear is waiting out the window */
  private firstAt = -1;
  /** a gear waits for the gate */
  private queued = false;

  /** `inFlight(by, now)`: a touch that landed by `by` may still turn out to be a flick (Input.flickInFlight). */
  constructor(
    private readonly drive: TurboDrive,
    private readonly flight: Flight,
    private readonly inFlight: (by: number, now: number) => boolean,
  ) {}

  /** A gear is on its way (the readout's ARMED): past the last usable gear nothing is, whatever the window says. */
  get armed(): boolean {
    return (this.firstAt >= 0 || this.queued) && this.drive.gear < this.drive.maxGear;
  }

  /** A gear waits for the gate. */
  get gated(): boolean {
    return this.queued;
  }

  /** A flick, or E / Q. `landed`, `lifted`: ms, performance clock. */
  flick(dir: 1 | -1, landed: number, lifted: number): void {
    if (dir > 0) this.up(landed, lifted);
    else this.down();
  }

  /** Once per frame, before the drive's update (wall clock: a hit-stop doesn't stall a gear). */
  tick(now: number): void {
    if (this.firstAt >= 0 && now - this.firstAt >= inputTune.doubleMs && !this.inFlight(this.firstAt + inputTune.doubleMs, now)) this.bite();
    if (this.queued && !this.locked) {
      this.queued = false;
      this.drive.shift(1, this.flight);
    }
  }

  private up(landed: number, lifted: number) {
    if (this.firstAt >= 0) {
      if (landed - this.firstAt <= inputTune.doubleMs) {
        this.firstAt = -1;
        this.drive.boostUp();
        return;
      }
      // (the window closed and no frame has noticed yet)
      this.bite();
    }
    this.firstAt = lifted;
    this.onAnswer?.(this.locked ? 'gated' : 'first');
  }

  private down() {
    if (this.firstAt >= 0 || this.queued) {
      this.firstAt = -1;
      this.queued = false;
      this.onAnswer?.('back');
    } else if (!this.drive.boostOff()) this.drive.shift(-1, this.flight);
  }

  /** The window closed with no second flick: the gear goes, or waits on for the gate. */
  private bite() {
    this.firstAt = -1;
    if (this.locked) this.queued = true;
    else this.drive.shift(1, this.flight);
  }
}
