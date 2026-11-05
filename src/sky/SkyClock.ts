// The sky's clock, UTC ms (SKY.md section 2). `Date.now()`, or `?t=` to pin it (an ISO date or ms) and `?rate=` to run it at a multiple of real time; 0 holds it still. The server offset
// from a no-store HEAD at boot is S2's: a test flight doesn't share its sky with anyone.
// The real clock reads `Date.now()` every frame, never the page's own: WebKit's performance.now() stops while the phone sleeps, and a tab left open over a lock
// would wake to the hour it was locked at. One a page (docs/specs/earth/CONTRACT.md, O3): the street's live sky, the flight and life read the same. Under ?fixeddt it
// steps with the frames, fixeddt each (O2), so a tool at a fixed step sees the sky a player does: frame() steps it once for each frame drawn, whichever loop draws it.

export class SkyClock {
  private start: number;
  private wall = performance.now();
  private readonly rate: number;
  private readonly real: boolean;
  /** ?fixeddt: s a frame, and the frames it has stepped (0: not stepped) */
  private readonly stepS: number;
  private steps = 0;
  private lastFrame = NaN;

  constructor(params: URLSearchParams) {
    const t = params.get('t');
    const parsed = t === null ? NaN : /^\d+$/.test(t) ? Number(t) : Date.parse(t);
    this.start = Number.isFinite(parsed) ? parsed : Date.now();
    const r = Number(params.get('rate'));
    this.rate = params.has('rate') && Number.isFinite(r) ? r : 1;
    this.stepS = params.has('fixeddt') ? Math.max(0.001, Number(params.get('fixeddt')) || 1 / 60) : 0;
    this.real = !Number.isFinite(parsed) && this.rate === 1 && !this.stepS;
  }

  /** A frame drawn, at its rAF time: under ?fixeddt the clock steps once for it, however many loops on the page say so. */
  frame(frameMs: number): void {
    if (!this.stepS || frameMs === this.lastFrame) return;
    this.lastFrame = frameMs;
    this.steps++;
  }

  /** ?resume: the trip the page before saved goes on at `ms`, and so does this page's clock, not from the URL's ?t= again (CONTRACT.md section 6). The real clock is right as it is. */
  resumeAt(ms: number): void {
    if (this.real || !Number.isFinite(ms)) return;
    this.start = ms;
    this.wall = performance.now();
    this.steps = 0;
    this.lastFrame = NaN;
  }

  /** UTC ms now. */
  now(): number {
    if (this.stepS) return this.start + this.steps * this.stepS * this.rate * 1000;
    return this.real ? Date.now() : this.start + (performance.now() - this.wall) * this.rate;
  }
}
