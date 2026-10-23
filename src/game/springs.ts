// Small, frame-rate independent spring helpers (semi-implicit, substep-safe).

/** Second-order spring toward target. Returns the new [value, velocity]. */
export function spring(x: number, v: number, target: number, hz: number, damping: number, dt: number): [number, number] {
  const w = 2 * Math.PI * hz;
  const a = w * w * (target - x) - 2 * damping * w * v;
  v += a * dt;
  x += v * dt;
  return [x, v];
}

export class Spring {
  v = 0;
  constructor(public x = 0, public hz = 1, public damping = 1) {}
  step(target: number, dt: number): number {
    [this.x, this.v] = spring(this.x, this.v, target, this.hz, this.damping, dt);
    return this.x;
  }
}

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}
