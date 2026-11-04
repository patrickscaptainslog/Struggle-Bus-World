// The sky's clock, UTC ms (SKY.md section 2). `Date.now()`, or `?t=` to pin it (an ISO date or ms) and `?rate=` to run it at a multiple of real time; 0 holds it still. The server offset
// from a no-store HEAD at boot is S2's: a test flight doesn't share its sky with anyone.

export class SkyClock {
  private readonly start: number;
  private readonly wall = performance.now();
  private readonly rate: number;

  constructor(params: URLSearchParams) {
    const t = params.get('t');
    const parsed = t === null ? NaN : /^\d+$/.test(t) ? Number(t) : Date.parse(t);
    this.start = Number.isFinite(parsed) ? parsed : Date.now();
    const r = Number(params.get('rate'));
    this.rate = params.has('rate') && Number.isFinite(r) ? r : 1;
  }

  /** UTC ms now. */
  now(): number {
    return this.start + (performance.now() - this.wall) * this.rate;
  }
}
