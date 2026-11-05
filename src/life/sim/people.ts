import { fnv1a, mix, unit } from '../hash';
import { Col, Kind, ROW } from '../kinds';

// People (LIVING.md, "People": on sidewalks, plazas and paths near the bus, grey, heads down, walking). Worker-safe and pure: a person is a function of the tile's ground,
// its slot, the day and utcMs, so every player sees the same one. Before the world's graphs (GRAPHS.md: footways, plazas and parks) people walk what today's tiles
// have, the host's 2 m sampling of the 2 m ground classes round the bus (LIFE.md, "What today's tiles have"). Each walks one straight run of walkable cells, there and
// back, all day: a closed form of the clock, so an hour's steps end where one jump does. Never saved: `walk:` lives only while it's near (CONTRACT.md section 3).

/** A tile's ground as the host sampled it: its corner (m), its cells' side (m) and count a side, which may be walked (sidewalk, plaza, path), and the ground's height there. */
export interface WalkTile {
  tx: number;
  tz: number;
  x0: number;
  z0: number;
  cell: number;
  n: number;
  walk: Uint8Array;
  h: Float32Array;
  /** its walkable cells */
  count: number;
}

/** The host's sampling: 2 m cells, the ground classes' own, 128 a side of a 256 m tile (the first account's GPU review, m1: on 4 m cells 1 in 37 stood off a sidewalk
 *  in the browser, where a run between two walkable cells' middles crossed a kerb, up to 0.71 m off the ground) */
export const WALK_CELL = 2;
/** People a walkable cell, the most a tile, and how far a run goes each way from where one starts (cells). */
const PER_CELL = 1 / 96, MOST = 32, RUN = 20;
/** Walking speeds, m/s. */
const V = [0.9, 1.5];
/** The eight ways a run can go, along the grid and its diagonals. */
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DZ = [0, 1, 1, 1, 0, -1, -1, -1];

const walkAt = (t: WalkTile, i: number, j: number) => i >= 0 && j >= 0 && i < t.n && j < t.n && t.walk[j * t.n + i] === 1;

/** The ground's height at (x, z) in the tile, between its cells' middles. */
function heightAt(t: WalkTile, x: number, z: number): number {
  const fx = Math.min(t.n - 1.001, Math.max(0, (x - t.x0) / t.cell - 0.5)), fz = Math.min(t.n - 1.001, Math.max(0, (z - t.z0) / t.cell - 0.5));
  const i = Math.floor(fx), j = Math.floor(fz), ax = fx - i, az = fz - j, n = t.n, h = t.h;
  return (h[j * n + i] * (1 - ax) + h[j * n + i + 1] * ax) * (1 - az) + (h[(j + 1) * n + i] * (1 - ax) + h[(j + 1) * n + i + 1] * ax) * az;
}

/**
 * The people of tile `t` within `reach` of (bx, bz) at utcMs, as rows from `at` in `out`; `day` the UTC day, so a person's run is the day's. Returns the next free row, at
 * most `max`. `keys`, if given, is told each row's key.
 */
export function peopleOn(t: WalkTile, day: number, utcMs: number, bx: number, bz: number, reach: number, out: Float32Array, at: number, max: number, keys?: (hash: number, key: string) => void): number {
  const side = t.n * t.cell, cx = t.x0 + side / 2, cz = t.z0 + side / 2, far = reach + side * 0.71;
  if ((cx - bx) * (cx - bx) + (cz - bz) * (cz - bz) > far * far || !t.count) return at;
  const u32 = new Uint32Array(out.buffer, out.byteOffset, out.length), r2 = reach * reach, s0 = utcMs / 1000;
  const seed = mix(fnv1a(`walk:${t.tx},${t.tz}`), day), slots = Math.min(MOST, Math.round(t.count * PER_CELL));
  for (let s = 0; s < slots && at < max; s++) {
    const h = mix(seed, s);
    // (a walkable cell to start from, probed from hashed ones)
    let c = -1;
    for (let k = 0; k < 24 && c < 0; k++) {
      const q = Math.floor(unit(mix(h, 10 + k)) * t.n * t.n);
      if (t.walk[q] === 1) c = q;
    }
    if (c < 0) continue;
    const ci = c % t.n, cj = (c - ci) / t.n, d = Math.floor(unit(mix(h, 2)) * 8), dx = DX[d], dz = DZ[d];
    let back = 0, fwd = 0;
    while (back < RUN && walkAt(t, ci - dx * (back + 1), cj - dz * (back + 1))) back++;
    while (fwd < RUN && walkAt(t, ci + dx * (fwd + 1), cj + dz * (fwd + 1))) fwd++;
    const len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, L = (back + fwd) * t.cell * len;
    const ax = t.x0 + (ci - dx * back + 0.5) * t.cell, az = t.z0 + (cj - dz * back + 0.5) * t.cell;
    const v = V[0] + (V[1] - V[0]) * unit(mix(h, 3));
    let x = ax, z = az, vx = 0, vz = 0, heading = unit(mix(h, 4)) * Math.PI * 2;
    if (L > 1) {
      // (there and back along the run: where in it, by the clock)
      const p = (s0 * v + unit(mix(h, 5)) * 2 * L) % (2 * L), there = p < L, a = there ? p : 2 * L - p, sign = there ? 1 : -1;
      x = ax + ux * a;
      z = az + uz * a;
      vx = ux * v * sign;
      vz = uz * v * sign;
      heading = Math.atan2(vz, vx);
    }
    if ((x - bx) * (x - bx) + (z - bz) * (z - bz) > r2) continue;
    const o = at * ROW, key = `walk:${t.tx},${t.tz}:${s}:${day}`, kh = fnv1a(key);
    u32[o + Col.KEY] = kh;
    out[o + Col.KIND] = Kind.PERSON;
    out[o + Col.X] = x;
    out[o + Col.Y] = heightAt(t, x, z);
    out[o + Col.Z] = z;
    out[o + Col.VX] = vx;
    out[o + Col.VY] = 0;
    out[o + Col.VZ] = vz;
    out[o + Col.HEADING] = heading;
    out[o + Col.PITCH] = 0;
    out[o + Col.BANK] = 0;
    out[o + Col.SCALE] = 0.9 + 0.2 * unit(mix(h, 6));
    out[o + Col.FLAGS] = 0;
    // (not kept: while it's near, an hour at the most for a breath in flight to land on)
    out[o + Col.UNTIL] = 3600;
    keys?.(kh, key);
    at++;
  }
  return at;
}
