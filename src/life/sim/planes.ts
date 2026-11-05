import { fnv1a, mix, unit } from '../hash';
import { Col, Kind, ROW, RowFlag } from '../kinds';

// The planes (LIFE.md, "Planes"). Worker-safe and pure: a plane is a function of the place, its slot and utcMs, so every player sees the same one.
//
// Scripted, for when the relay has nothing: flights across the place on straight tracks (great circles, straight at this size), at cruise or a middle height, a slot or
// two a UTC minute. No airport is needed for them: once the world's airports.bin is in (CONTRACT.md O11), approaches and departures on each airport's runways take
// most of their slots. Live: the relay's reports, carried on by their speed and track.

/** The disc the scripted flights cross, round the map's origin (m): a metro area's sky and its edges. */
const R = 150000;
/** Slots a minute, and the share of them flown: about 1.4 flights a minute, some 25 in the air over the disc at once, about what adsb.lol showed over the Bay (LIVING.md). */
const SLOTS = 2;
const RATE = 0.7;
/** Cruise and middle heights (m) and speeds (m/s), and the share that's cruising. */
const CRUISE = [9500, 12000], CRUISE_V = [220, 255];
const MID = [3000, 7000], MID_V = [150, 190];
const CRUISE_SHARE = 0.6;
/** The longest a scripted flight is in the disc (s), so the buckets it can have started in. */
const LONGEST = (2 * R) / MID_V[0];

const lerp = (a: number[], t: number) => a[0] + (a[1] - a[0]) * t;

/**
 * The scripted flights within `reach` of (bx, bz) at utcMs, as rows from `at` in `out`; the place by its key (a city's slug). Returns the next free row, at most `max`.
 * `keys`, if given, is told each row's key (the host asks for one by its hash when a breath lands).
 */
export function scriptedPlanes(place: string, utcMs: number, bx: number, bz: number, reach: number, out: Float32Array, at: number, max: number, keys?: (hash: number, key: string) => void): number {
  const seed = fnv1a(place), u32 = new Uint32Array(out.buffer, out.byteOffset, out.length);
  const b1 = Math.floor(utcMs / 60000), b0 = Math.floor((utcMs - LONGEST * 1000) / 60000);
  const r2 = reach * reach;
  for (let b = b0; b <= b1 && at < max; b++)
    for (let s = 0; s < SLOTS && at < max; s++) {
      const h = mix(seed, b, s);
      if (unit(h) >= RATE) continue;
      const cruise = unit(mix(h, 5)) < CRUISE_SHARE;
      const v = lerp(cruise ? CRUISE_V : MID_V, unit(mix(h, 4)));
      const th = unit(mix(h, 1)) * Math.PI * 2, d = (unit(mix(h, 2)) * 2 - 1) * R * 0.8;
      const ux = Math.cos(th), uz = Math.sin(th), L = 2 * Math.sqrt(R * R - d * d);
      const t0 = b * 60000 + unit(mix(h, 3)) * 60000;
      const along = ((utcMs - t0) / 1000) * v;
      if (along < 0 || along > L) continue;
      const x = -uz * d - ux * (L / 2) + ux * along, z = ux * d - uz * (L / 2) + uz * along;
      const dx = x - bx, dz = z - bz;
      if (dx * dx + dz * dz > r2) continue;
      const o = at * ROW;
      const key = `plane:s:over-${place}:${b}:${s}`, kh = fnv1a(key);
      u32[o + Col.KEY] = kh;
      out[o + Col.KIND] = Kind.AIRLINER;
      out[o + Col.X] = x;
      out[o + Col.Y] = lerp(cruise ? CRUISE : MID, unit(mix(h, 6)));
      out[o + Col.Z] = z;
      out[o + Col.VX] = ux * v;
      out[o + Col.VY] = 0;
      out[o + Col.VZ] = uz * v;
      out[o + Col.HEADING] = th;
      out[o + Col.PITCH] = 0;
      out[o + Col.BANK] = 0;
      out[o + Col.SCALE] = 0.85 + 0.3 * unit(mix(h, 7));
      out[o + Col.FLAGS] = 0;
      out[o + Col.UNTIL] = (L - along) / v;
      keys?.(kh, key);
      at++;
    }
  return at;
}

/** A live plane as the relay sends it (api/planes.ts), its position put on the map by the host's frame. */
export interface LivePlane {
  hex: string;
  /** map metres at `t`, and m/s; heading rad from +X toward +Z */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  /** UTC ms of the report */
  t: number;
  /** UTC date it was first seen airborne, YYYYMMDD (its key, CONTRACT.md section 3) */
  day: string;
  small: boolean;
}

/** How long a live plane is carried on past its last report (ms), then dropped. */
export const LIVE_HOLD = 30000;

/** The live planes within `reach` of (bx, bz) at utcMs, carried on from their reports, as rows from `at`. */
export function livePlanes(planes: readonly LivePlane[], utcMs: number, bx: number, bz: number, reach: number, out: Float32Array, at: number, max: number, keys?: (hash: number, key: string) => void): number {
  const u32 = new Uint32Array(out.buffer, out.byteOffset, out.length), r2 = reach * reach;
  for (const p of planes) {
    if (at >= max) break;
    const dt = (utcMs - p.t) / 1000;
    if (dt < -5 || dt * 1000 > LIVE_HOLD) continue;
    const x = p.x + p.vx * dt, z = p.z + p.vz * dt, y = Math.max(0, p.y + p.vy * dt);
    const dx = x - bx, dz = z - bz;
    if (dx * dx + dz * dz > r2) continue;
    const o = at * ROW;
    const key = `plane:${fnv1a(p.hex + ':' + p.day).toString(36)}`, kh = fnv1a(key);
    u32[o + Col.KEY] = kh;
    out[o + Col.KIND] = p.small ? Kind.SMALL_PLANE : Kind.AIRLINER;
    out[o + Col.X] = x;
    out[o + Col.Y] = y;
    out[o + Col.Z] = z;
    out[o + Col.VX] = p.vx;
    out[o + Col.VY] = p.vy;
    out[o + Col.VZ] = p.vz;
    out[o + Col.HEADING] = p.heading;
    out[o + Col.PITCH] = Math.atan2(p.vy, Math.max(1, Math.hypot(p.vx, p.vz)));
    out[o + Col.BANK] = 0;
    out[o + Col.SCALE] = 1;
    out[o + Col.FLAGS] = RowFlag.LIVE;
    // (a live plane's paint lasts till it lands, at most 24 h on, CONTRACT.md section 3: its landing isn't known here, so the most)
    out[o + Col.UNTIL] = 24 * 3600;
    keys?.(kh, key);
    at++;
  }
  return at;
}
