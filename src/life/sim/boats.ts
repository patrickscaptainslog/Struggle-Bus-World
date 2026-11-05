import { mix, unit, fnv1a } from '../hash';
import { Col, Kind, ROW } from '../kinds';
import type { CityRoutes, RegionGraph } from '../../world/lifeData';
import { WATER_Y } from '../../world/tiles';

// Boats (LIVING.md, "Ferries" and "Sailboats"), on the world's routes and water (CONTRACT.md section 1.2: routes.bin, the graphs' OPEN_WATER). Worker-safe and pure: a
// boat is a function of the place's data, its slot and utcMs, so every player sees the same one.
//
// Ferries: on every route in routes.bin (the one way of a pair listed both ways), a timetable made from the route ("very educated guess simulated", the producer):
// from 06:00 to 22:00 local, a vessel every half hour on a short run and every hour on a long one, as many vessels as that takes, each crossing at its route's speed
// with a minute and a half to get up to it and to slow, dwelling at each end, turning round at the berth; laid up at the first terminal overnight. Keyed by vessel,
// `ferry:<route>:<vessel>`, and kept (LIVING.md: "a ferry or a cruise ship by its vessel").
//
// Sailboats: out of each marina by day, more at weekends, each sailing a loop of open water off it, heeled by the wind; a boat's loop is tried against the water
// from the graphs of the regions round its marina, so every player's is the same once those are in. Keyed `sail:<marina>:<day>:<slot>`, "only while it's near".

/** A ferry's speed (m/s) by its run's length: the bay's fast catamarans on the long runs, slower on the short; its time to get up to speed and to slow (s); its dwell at
 *  each end (s), and the turn round at the berth in the first of it (s). The day's service, local (s from midnight). */
const FERRY_V = (L: number) => (L > 15000 ? 15 : L > 5000 ? 12 : 7);
const RAMP = 90, DWELL = 480, TURN = 150, SERVICE0 = 6 * 3600, SERVICE1 = 22 * 3600;
/** A ferry's place and heading are taken on a chord of its route this long either side (m): the routes' points are hundreds of metres apart */
const FERRY_CHORD = 60;

export interface FerryLine {
  key: string;
  /** its points (map m, x and z), each one's distance along it, and its length */
  xz: Float32Array;
  at: Float32Array;
  L: number;
  /** its speed (m/s), a crossing's time (s), the headway between vessels (s), how many vessels, a round trip (s) */
  v: number;
  leg: number;
  head: number;
  vessels: number;
  cycle: number;
}

/** The ferry lines of a city's routes: one a route, but a route listed both ways only once (the first by id). */
export function ferryLines(routes: CityRoutes): FerryLine[] {
  const out: FerryLine[] = [], seen = new Set<string>();
  for (const f of [...routes.ferries].sort((p, q) => p.id - q.id)) {
    const pair = f.from < f.to ? `${f.from},${f.to}` : `${f.to},${f.from}`, n = f.xz.length / 2;
    if (seen.has(pair) || n < 2) continue;
    seen.add(pair);
    const at = new Float32Array(n);
    for (let i = 1; i < n; i++) at[i] = at[i - 1] + Math.hypot(f.xz[i * 2] - f.xz[i * 2 - 2], f.xz[i * 2 + 1] - f.xz[i * 2 - 1]);
    const L = at[n - 1], v = FERRY_V(L), leg = L / v + RAMP, cycle = 2 * (leg + DWELL), head = L < 5000 ? 1800 : 3600;
    out.push({ key: f.key, xz: f.xz, at, L, v, leg, head, vessels: Math.max(1, Math.ceil(cycle / head)), cycle });
  }
  return out;
}

/** The point s m along line f (held at its ends), into P at q as x, z. */
function onLine(f: FerryLine, s: number, P: Float64Array, q: number): void {
  const n = f.at.length;
  s = Math.min(f.L, Math.max(0, s));
  let i = 1;
  while (i < n - 1 && f.at[i] < s) i++;
  const a = f.at[i - 1], b = f.at[i], t = b > a ? (s - a) / (b - a) : 0;
  P[q] = f.xz[(i - 1) * 2] + (f.xz[i * 2] - f.xz[(i - 1) * 2]) * t;
  P[q + 1] = f.xz[(i - 1) * 2 + 1] + (f.xz[i * 2 + 1] - f.xz[(i - 1) * 2 + 1]) * t;
}
const P = new Float64Array(4);

/** How far along a crossing it is φ s into it (m), and its speed then (m/s): up to speed over RAMP, at it, and slowing over RAMP to the far berth. */
function crossing(f: FerryLine, phi: number, out: Float64Array): void {
  const v = f.v, T = f.leg;
  if (phi < RAMP) {
    out[0] = (0.5 * v * phi * phi) / RAMP;
    out[1] = (v * phi) / RAMP;
  } else if (phi < T - RAMP) {
    out[0] = 0.5 * v * RAMP + v * (phi - RAMP);
    out[1] = v;
  } else {
    const r = Math.max(0, T - phi);
    out[0] = f.L - (0.5 * v * r * r) / RAMP;
    out[1] = (v * r) / RAMP;
  }
}
const X = new Float64Array(2);

/**
 * Where vessel j of line f is at t (s, UTC) on the service day starting at local midnight m0 (s, UTC): into S as s along the line, its speed along it (m/s, less than
 * 0 back toward the start), and its heading's way (1 the line's, -1 back), or false: laid up at the start, not out that day yet or any more.
 */
function vesselOn(f: FerryLine, j: number, t: number, m0: number, S: Float64Array): boolean {
  const tau = t - (m0 + SERVICE0 + j * f.head);
  if (tau < 0) return false;
  const k = Math.floor(tau / f.cycle);
  // (a round trip starts only in service hours)
  if (SERVICE0 + j * f.head + k * f.cycle > SERVICE1) return false;
  const phi = tau - k * f.cycle, T = f.leg;
  if (phi < T) {
    crossing(f, phi, X);
    S[0] = X[0];
    S[1] = X[1];
    S[2] = 1;
  } else if (phi < T + DWELL) {
    S[0] = f.L;
    S[1] = 0;
    // (turning round at the far berth over TURN: its heading's way from the line's to back, through square to it)
    S[2] = Math.cos((Math.PI * Math.min(1, (phi - T) / TURN)));
  } else if (phi < 2 * T + DWELL) {
    crossing(f, phi - T - DWELL, X);
    S[0] = f.L - X[0];
    S[1] = -X[1];
    S[2] = -1;
  } else {
    S[0] = 0;
    S[1] = 0;
    S[2] = -Math.cos(Math.PI * Math.min(1, (phi - 2 * T - DWELL) / TURN));
  }
  return true;
}
const S = new Float64Array(3);

/**
 * Every ferry of `lines` at utcMs (tzMin the place's offset from UTC, min) within `reach` of (bx, bz), as rows from `at` in `out`. Returns the next free row, at most
 * `max`. `keys`, if given, is told each row's key.
 */
export function ferriesOn(lines: FerryLine[], utcMs: number, tzMin: number, bx: number, bz: number, reach: number, out: Float32Array, at: number, max: number,
  keys?: (hash: number, key: string) => void): number {
  const u32 = new Uint32Array(out.buffer, out.byteOffset, out.length), t = utcMs / 1000, local = t + tzMin * 60, day = Math.floor(local / 86400);
  for (const f of lines)
    for (let j = 0; j < f.vessels && at < max; j++) {
      // (today's service, else yesterday's last round trip still out past midnight, else laid up at the first terminal, facing out)
      let s = 0, v = 0, way = 1;
      for (let back = 0; back < 2; back++) {
        if (!vesselOn(f, j, t, (day - back) * 86400 - tzMin * 60, S)) continue;
        s = S[0];
        v = S[1];
        way = S[2];
        break;
      }
      onLine(f, s - FERRY_CHORD, P, 0);
      onLine(f, s + FERRY_CHORD, P, 2);
      const x = (P[0] + P[2]) / 2, z = (P[1] + P[3]) / 2;
      if ((x - bx) * (x - bx) + (z - bz) * (z - bz) > reach * reach) continue;
      const dx = P[2] - P[0], dz = P[3] - P[1], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
      // (its heading: the line's way, back, or between the two as it turns at a berth, the way it turns its own: round to its right)
      const side = Math.sqrt(Math.max(0, 1 - way * way)), hx = ux * way - uz * side, hz = uz * way + ux * side;
      const o = at * ROW, key = `ferry:${f.key}:${j}`, kh = fnv1a(key);
      u32[o + Col.KEY] = kh;
      out[o + Col.KIND] = Kind.FERRY;
      out[o + Col.X] = x;
      out[o + Col.Y] = WATER_Y;
      out[o + Col.Z] = z;
      out[o + Col.VX] = ux * v;
      out[o + Col.VY] = 0;
      out[o + Col.VZ] = uz * v;
      out[o + Col.HEADING] = Math.atan2(hz, hx);
      out[o + Col.PITCH] = 0;
      out[o + Col.BANK] = 0;
      out[o + Col.SCALE] = 1;
      out[o + Col.FLAGS] = 0;
      // (a vessel is the place's for good: its paint is kept a day at a time, as long as the store keeps it)
      out[o + Col.UNTIL] = 86400;
      keys?.(kh, key);
      at++;
    }
  return at;
}

// ---- sailboats

/** A marina's water: its open water (the graphs' OPEN_WATER) on a grid of WATER_CELL m round it, WATER_R each way, 1 water; and each slot's loop on it. */
export interface Harbour {
  key: string;
  x: number;
  z: number;
  berths: number;
  water: Uint8Array;
  /** per slot: its loop's middle (x, z), half lengths along and across, its turn (rad), or a 0 half length: none on the water */
  loops: Float32Array;
}
export const WATER_R = 1400;
const WATER_CELL = 20, WATER_N = Math.ceil((2 * WATER_R) / WATER_CELL);
/** Slots a berth, boats out on a weekday afternoon (a share of the slots), sailing hours (local, s), and their speed (m/s). */
const PER_BERTH = 0.1, WEEKDAY = 0.45, SAIL0 = 9.5 * 3600, SAIL1 = 19 * 3600, SAIL_V = [2.8, 4.2];
/** The wind's way (rad, from +X toward +Z as headings are): the bay's westerly, blowing to the east-north-east; and the most a boat heels (rad). */
const WIND = -0.35, HEEL = 0.3;
const OPEN_WATER = 8;

/** The open water round (x, z) from the graphs' OPEN_WATER areas: their triangles laid on the grid, a cell water if its middle is in one. */
export function harbourOf(m: { key: string; x: number; z: number; berths: number }, graphs: RegionGraph[]): Harbour {
  const water = new Uint8Array(WATER_N * WATER_N), x0 = m.x - WATER_R, z0 = m.z - WATER_R;
  for (const G of graphs) {
    const A = G.areas;
    for (let a = 0; a < A.n; a++) {
      if (A.kind[a] !== OPEN_WATER) continue;
      for (let tr = A.tri[a]; tr < A.tri[a + 1]; tr++) {
        const o = tr * 9, ax = A.xyz[o], az = A.xyz[o + 2], bx = A.xyz[o + 3], bz = A.xyz[o + 5], cx = A.xyz[o + 6], cz = A.xyz[o + 8];
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / WATER_CELL)), i1 = Math.min(WATER_N - 1, Math.floor((Math.max(ax, bx, cx) - x0) / WATER_CELL));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / WATER_CELL)), j1 = Math.min(WATER_N - 1, Math.floor((Math.max(az, bz, cz) - z0) / WATER_CELL));
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const px = x0 + (i + 0.5) * WATER_CELL, pz = z0 + (j + 0.5) * WATER_CELL;
            const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
            if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) water[j * WATER_N + i] = 1;
          }
      }
    }
  }
  const h: Harbour = { key: m.key, x: m.x, z: m.z, berths: m.berths, water, loops: new Float32Array(Math.max(1, Math.ceil(m.berths * PER_BERTH)) * 5) };
  // (water there, and in every cell round it: a cell's middle in the water says nothing of its corners)
  const wet = (x: number, z: number) => {
    const i = Math.floor((x - x0) / WATER_CELL), j = Math.floor((z - z0) / WATER_CELL);
    if (i < 1 || j < 1 || i >= WATER_N - 1 || j >= WATER_N - 1) return false;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (water[(j + dj) * WATER_N + i + di] !== 1) return false;
    return true;
  };
  // (each slot's loop: tried from hashed ones off the marina, the first whose every point, and a margin either side of it, is water)
  const seed = fnv1a(`sail:${m.key}`);
  for (let b = 0; b < h.loops.length / 5; b++)
    for (let k = 0; k < 12; k++) {
      const s = mix(seed, b, k), ang = unit(mix(s, 1)) * Math.PI * 2, dist = 250 + 800 * unit(mix(s, 2));
      const A = 120 + 380 * unit(mix(s, 3)), B = A * (0.35 + 0.4 * unit(mix(s, 4))), rot = unit(mix(s, 5)) * Math.PI, cx = m.x + Math.cos(ang) * dist, cz = m.z + Math.sin(ang) * dist;
      let ok = true;
      for (let q = 0; q < 48 && ok; q++) {
        const th = (q / 48) * Math.PI * 2;
        for (const grow of [0.8, 1, 1.25]) {
          const ex = Math.cos(th) * A * grow, ez = Math.sin(th) * B * grow;
          if (!wet(cx + ex * Math.cos(rot) - ez * Math.sin(rot), cz + ex * Math.sin(rot) + ez * Math.cos(rot))) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      h.loops.set([cx, cz, A, B, rot], b * 5);
      break;
    }
  return h;
}

/**
 * The sailboats of harbour h out at utcMs (tzMin the place's offset, min) within `reach` of (bx, bz), as rows from `at` in `out`; returns the next free row, at most
 * `max`. A slot's boat is out on a day if its hash says so, every one at a weekend and WEEKDAY of them else, from a hashed time after SAIL0 for two to five hours,
 * till SAIL1 at the latest, growing in and out over a minute at each end.
 */
export function sailsOn(h: Harbour, utcMs: number, tzMin: number, bx: number, bz: number, reach: number, out: Float32Array, at: number, max: number,
  keys?: (hash: number, key: string) => void): number {
  if ((h.x - bx) * (h.x - bx) + (h.z - bz) * (h.z - bz) > (reach + 2 * WATER_R) ** 2) return at;
  const u32 = new Uint32Array(out.buffer, out.byteOffset, out.length), t = utcMs / 1000, local = t + tzMin * 60, day = Math.floor(local / 86400), sec = local - day * 86400;
  // (1970-01-01 was a Thursday: Saturday and Sunday are 2 and 3)
  const wd = ((day % 7) + 7) % 7, weekend = wd === 2 || wd === 3, seed = mix(fnv1a(`sail:${h.key}`), day);
  for (let b = 0; b < h.loops.length / 5 && at < max; b++) {
    const A = h.loops[b * 5 + 2];
    if (!A) continue;
    const s = mix(seed, b);
    if (unit(s) >= (weekend ? 1 : WEEKDAY)) continue;
    const t0 = SAIL0 + unit(mix(s, 1)) * 4 * 3600, t1 = Math.min(SAIL1, t0 + (2 + 3 * unit(mix(s, 2))) * 3600);
    if (sec < t0 || sec > t1) continue;
    const B = h.loops[b * 5 + 3], rot = h.loops[b * 5 + 4], v = SAIL_V[0] + (SAIL_V[1] - SAIL_V[0]) * unit(mix(s, 3)), dir = unit(mix(s, 4)) < 0.5 ? 1 : -1;
    // (round its loop at about its speed, from a hashed place on it)
    const th = unit(mix(s, 5)) * Math.PI * 2 + dir * ((sec - t0) * v) / ((A + B) / 2);
    const ex = Math.cos(th) * A, ez = Math.sin(th) * B, cr = Math.cos(rot), sr = Math.sin(rot);
    const x = h.loops[b * 5] + ex * cr - ez * sr, z = h.loops[b * 5 + 1] + ex * sr + ez * cr;
    if ((x - bx) * (x - bx) + (z - bz) * (z - bz) > reach * reach) continue;
    // (its way: the loop's tangent, the way it goes round)
    const tx = -Math.sin(th) * A * dir, tz = Math.cos(th) * B * dir, wx = tx * cr - tz * sr, wz = tx * sr + tz * cr, l = Math.hypot(wx, wz) || 1;
    const heading = Math.atan2(wz / l, wx / l);
    const o = at * ROW, key = `sail:${h.key}:${day}:${b}`, kh = fnv1a(key);
    u32[o + Col.KEY] = kh;
    out[o + Col.KIND] = Kind.SAILBOAT;
    out[o + Col.X] = x;
    out[o + Col.Y] = WATER_Y;
    out[o + Col.Z] = z;
    out[o + Col.VX] = (wx / l) * v;
    out[o + Col.VY] = 0;
    out[o + Col.VZ] = (wz / l) * v;
    out[o + Col.HEADING] = heading;
    out[o + Col.PITCH] = 0;
    // (heeled away from the wind, the most with it on her beam, none running before it)
    out[o + Col.BANK] = HEEL * Math.sin(heading - WIND);
    out[o + Col.SCALE] = Math.max(0.05, Math.min(1, (sec - t0) / 60, (t1 - sec) / 60)) * (0.9 + 0.2 * unit(mix(s, 6)));
    out[o + Col.FLAGS] = 0;
    out[o + Col.UNTIL] = t1 - sec;
    keys?.(kh, key);
    at++;
  }
  return at;
}
