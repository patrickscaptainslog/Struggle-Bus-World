// The beat (FACTIONS.md section 5, step 3; decision 14): one clock that the stage-ups, Possessed's hiccups and the music share, at 84 beats a minute, four to a bar.
// It counts on the game's clock (s), so a pause stops it with everything else; the music maps it onto its AudioContext's time with sync(). Pure and worker-safe:
// nothing here draws or plays. STAGES.md section 1.2's city-wide cap lives here too, as Slots: at most two stage changes start in any second, each on a beat,
// the extras queued onto the next beats, never more than a bar late.

/** Decision 14: the producer's ear picks 84 or 96; every timing in FACTIONS.md is at 84. */
export const BPM = 84;
export const BEATS_A_BAR = 4;

export class Beat {
  /** seconds a beat */
  period: number;
  /** the game time (s) of beat 0 */
  origin: number;
  /** audio time minus game time (s), from sync() */
  private audio = 0;

  constructor(bpm = BPM, origin = 0) {
    this.period = 60 / bpm;
    this.origin = origin;
  }

  get bpm(): number {
    return 60 / this.period;
  }

  /** Beats since beat 0 at game time t, fractional. */
  at(t: number): number {
    return (t - this.origin) / this.period;
  }

  /** The beat t is in (its index), and how far through it (0..1). */
  index(t: number): number {
    return Math.floor(this.at(t) + 1e-9);
  }
  phase(t: number): number {
    const b = this.at(t);
    return Math.max(0, b - Math.floor(b + 1e-9));
  }

  /** Beat i's game time. */
  time(i: number): number {
    return this.origin + i * this.period;
  }

  /** The first beat at or after t, of every `every` (4 is a bar's downbeat), as its index. */
  nextIndex(t: number, every = 1): number {
    return Math.ceil(this.at(t) / every - 1e-9) * every;
  }
  /** ... and its game time. */
  next(t: number, every = 1): number {
    return this.time(this.nextIndex(t, every));
  }

  /** The beats in (t0, t1], by index, into `out` (cleared first): a frame's or a tick's. */
  crossed(t0: number, t1: number, out: number[]): number[] {
    out.length = 0;
    for (let i = Math.floor(this.at(t0) + 1e-9) + 1, last = Math.floor(this.at(t1) + 1e-9); i <= last; i++) out.push(i);
    return out;
  }

  /** A new tempo from game time t, the count carried on unbroken: the beat t is in stays the beat it was. */
  setBpm(bpm: number, t: number): void {
    const b = this.at(t);
    this.period = 60 / bpm;
    this.origin = t - b * this.period;
  }

  /** The music's clock: at game time `game` its AudioContext reads `audio`. */
  sync(game: number, audio: number): void {
    this.audio = audio - game;
  }
  toAudio(t: number): number {
    return t + this.audio;
  }
  fromAudio(a: number): number {
    return a - this.audio;
  }
}

/** STAGES.md section 1.2, "City-wide cap": at most `cap` starts in any `window` s, each on a beat, the extras on the next beats that have room, none more than `late` beats past its first. */
export class Slots {
  private readonly booked = new Map<number, number>();
  readonly beat: Beat;
  readonly cap: number;
  readonly window: number;
  readonly late: number;
  constructor(beat: Beat, cap = 2, window = 1, late = BEATS_A_BAR) {
    this.beat = beat;
    this.cap = cap;
    this.window = window;
    this.late = late;
  }

  /** Book a start asked for at game time t: its beat's game time. Past the cap a bar on, it starts then anyway: late beats a full house. */
  book(t: number): number {
    const first = this.beat.nextIndex(t), span = Math.max(0, Math.floor(this.window / this.beat.period - 1e-9));
    let at = first + this.late;
    for (let b = first; b <= first + this.late; b++)
      if (this.fits(b, span)) {
        at = b;
        break;
      }
    this.booked.set(at, (this.booked.get(at) ?? 0) + 1);
    // (forget what's a bar and a window behind the asking)
    for (const k of this.booked.keys()) if (k < first - span - this.late) this.booked.delete(k);
    return this.beat.time(at);
  }

  /** Every run of span + 1 beats with b in it has room. */
  private fits(b: number, span: number): boolean {
    for (let s = b - span; s <= b; s++) {
      let n = 0;
      for (let k = s; k <= s + span; k++) n += this.booked.get(k) ?? 0;
      if (n >= this.cap) return false;
    }
    return true;
  }

  clear(): void {
    this.booked.clear();
  }
}
