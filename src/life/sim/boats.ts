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
// from the graphs of the regions round its marina, so every player's is the same once those are in. Keyed `sail:<marina>:<slot>:<local date, YYYYMMDD>` and kept till it's home (CONTRACT.md section 3).

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
  /** its speed (m/s), a crossing's time (s), the headway between vessels (s), how many vessels, a round trip (s: vessels x head, so its vessels keep their headway)
   *  and the dwell at each end that leaves (s, DWELL at the least); its first sailing after SERVICE0 (s, by its key: no two lines all leave at 06:00) */
  v: number;
  leg: number;
  head: number;
  vessels: number;
  cycle: number;
  dwell: number;
  first: number;
  /** its berth at each end among the lines that share that terminal (the first account's life review, M1: ferries drawn inside each other at their berths), and
   *  that terminal's axis the berths are laid along (unit x, z) */
  slotA: number;
  slotB: number;
  axisA: [number, number];
  axisB: [number, number];
  /** which way across its heading its own vessels lie at each end, outward along the axis (1 or -1), fixed once from its end's way */
  raftA: number;
  raftB: number;
}
/** Two lines' ends this near share a terminal (m); lines' berths are this far apart along its axis, either side in turn, and a line's own vessels lie side by side
 *  this far apart at its berth, outward (m); a ferry eases into its berth over EASE (s) */
const SHARED = 120, BERTH = 40, RAFT = 12, EASE = 120;
/** It slides into its berth over its last APPROACH m in, and out over its first out (m) */
const APPROACH = 500;
/** Every line's headway divides this (s): departures from one terminal are spread over it */
const PHASE = 1800;
const circ = (d: number) => {
  const m = ((d % PHASE) + PHASE) % PHASE;
  return Math.min(m, PHASE - m);
};

/**
 * The ferry lines of a city's routes: one a route, but a route listed both ways only once (the first by id). Each line's first sailing is chosen, in id order, so its
 * departures from both its terminals fall as far as they can from the lines' before it there (a line leaves its far end half a round trip after its first), so no two
 * lines sail out together; at a terminal they share, they lie at berths side by side along its axis.
 */
export function ferryLines(routes: CityRoutes): FerryLine[] {
  const out: FerryLine[] = [], seen = new Set<string>();
  const terminals: Array<{ x: number; z: number; axis: [number, number]; lines: number; phases: number[] }> = [];
  const terminalAt = (x: number, z: number, tx: number, tz: number) => {
    let t = terminals.find((q) => Math.hypot(q.x - x, q.z - z) < SHARED);
    if (!t) terminals.push((t = { x, z, axis: [-tz, tx], lines: 0, phases: [] }));
    return t;
  };
  for (const f of [...routes.ferries].sort((p, q) => p.id - q.id)) {
    const pair = f.from < f.to ? `${f.from},${f.to}` : `${f.to},${f.from}`, n = f.xz.length / 2;
    if (seen.has(pair) || n < 2) continue;
    seen.add(pair);
    const at = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const dx = f.xz[i * 2] - f.xz[i * 2 - 2], dz = f.xz[i * 2 + 1] - f.xz[i * 2 - 1];
      at[i] = at[i - 1] + Math.sqrt(dx * dx + dz * dz);
    }
    const L = at[n - 1], v = FERRY_V(L), leg = L / v + RAMP, head = L < 5000 ? 1800 : 3600;
    const vessels = Math.max(1, Math.ceil((2 * (leg + DWELL)) / head)), cycle = vessels * head;
    const unit = (dx: number, dz: number): [number, number] => {
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      return [dx / l, dz / l];
    };
    const ta = unit(f.xz[2] - f.xz[0], f.xz[3] - f.xz[1]), tb = unit(f.xz[n * 2 - 2] - f.xz[n * 2 - 4], f.xz[n * 2 - 1] - f.xz[n * 2 - 3]);
    const A = terminalAt(f.xz[0], f.xz[1], ta[0], ta[1]), B = terminalAt(f.xz[n * 2 - 2], f.xz[n * 2 - 1], tb[0], tb[1]);
    // (its first sailing, a whole minute from a hashed start: the one whose departures sit farthest from the others' at both ends; it leaves B half a round trip
    // after its first)
    const from = fnv1a(`ferry:${f.key}`) % 60, back = (cycle / 2) % PHASE;
    let first = 0, bestScore = -1;
    for (let c = 0; c < 60; c++) {
      const cand = ((from + c) % 60) * 60;
      let score = PHASE;
      for (const p of A.phases) score = Math.min(score, circ(cand - p));
      for (const p of B.phases) score = Math.min(score, circ(cand + back - p));
      if (score > bestScore) {
        bestScore = score;
        first = cand;
      }
    }
    A.phases.push(first % PHASE);
    B.phases.push((first + back) % PHASE);
    const slotA = A.lines++, slotB = B === A ? A.lines++ : B.lines++;
    const raftOf = (slot: number, ax: [number, number], t: [number, number]) => (berthOff(slot) < 0 ? -1 : 1) * (-t[1] * ax[0] + t[0] * ax[1] < 0 ? -1 : 1);
    out.push({ key: f.key, xz: f.xz, at, L, v, leg, head, vessels, cycle, dwell: cycle / 2 - leg, first, slotA, slotB, axisA: A.axis, axisB: B.axis, raftA: raftOf(slotA, A.axis, ta), raftB: raftOf(slotB, B.axis, tb) });
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
 * Where vessel j of line f is at t (s, UTC) on the service day starting at local midnight m0 (s, UTC): into S as s along the line, its speed along it (m/s, under 0
 * back toward the start), its heading's way (1 the line's, -1 back), and at a berth how far into it (0 to 1, easing in after it arrives and out before it leaves),
 * or false: not in that day's service (laid up, or its day not begun).
 */
function vesselOn(f: FerryLine, j: number, t: number, m0: number, S: Float64Array): boolean {
  const start = SERVICE0 + f.first + j * f.head, tau = t - (m0 + start);
  if (tau < 0) return false;
  const k = Math.floor(tau / f.cycle);
  // (a round trip starts only in service hours)
  if (start + k * f.cycle > SERVICE1) return false;
  const phi = tau - k * f.cycle, T = f.leg, D = f.dwell, last = start + (k + 1) * f.cycle > SERVICE1;
  S[3] = 0;
  if (phi < T) {
    crossing(f, phi, X);
    S[0] = X[0];
    S[1] = X[1];
    S[2] = 1;
  } else if (phi < T + D) {
    S[0] = f.L;
    S[1] = 0;
    // (turning round at the far berth over TURN: its heading's way from the line's to back, through square to it)
    S[2] = Math.cos(Math.PI * Math.min(1, (phi - T) / TURN));
    S[3] = Math.min(1, (phi - T) / EASE, (T + D - phi) / EASE);
  } else if (phi < 2 * T + D) {
    crossing(f, phi - T - D, X);
    S[0] = f.L - X[0];
    S[1] = -X[1];
    S[2] = -1;
  } else {
    S[0] = 0;
    S[1] = 0;
    S[2] = -Math.cos(Math.PI * Math.min(1, (phi - 2 * T - D) / TURN));
    // (into its berth after it comes in; out of it before it sails again, unless that was the day's last)
    S[3] = Math.min(1, (phi - 2 * T - D) / EASE, last ? 1 : (f.cycle - phi) / EASE);
  }
  return true;
}
const S = new Float64Array(4);

/** A local day (days since 1970) as the contract's service day, YYYYMMDD. */
const ymd = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10).replace(/-/g, '');

/** Berth k's place across a line's end (m): the line's own spot, then BERTH either side in turn. */
const berthOff = (k: number) => (k ? BERTH * Math.ceil(k / 2) * (k % 2 ? 1 : -1) : 0);

/**
 * Every ferry of `lines` at utcMs (tzMin the place's offset from UTC, min) within `reach` of (bx, bz), as rows from `at` in `out`. Returns the next free row, at most
 * `max`. `keys`, if given, is told each row's key: `ferry:<route>:<vessel>:<service day>` (CONTRACT.md section 3), its paint kept to that day's last crossing.
 */
export function ferriesOn(lines: FerryLine[], utcMs: number, tzMin: number, bx: number, bz: number, reach: number, out: Float32Array, at: number, max: number,
  keys?: (hash: number, key: string) => void): number {
  const u32 = new Uint32Array(out.buffer, out.byteOffset, out.length), t = utcMs / 1000;
  for (const f of lines)
    for (let j = 0; j < f.vessels && at < max; j++) {
      // (where it is now and a second on: its velocity the difference, berths and moorings in it, so the host carries it on as it goes)
      placeVessel(f, j, t + 1, tzMin);
      const x1 = V.x, z1 = V.z;
      placeVessel(f, j, t, tzMin);
      const x = V.x, z = V.z;
      if ((x - bx) * (x - bx) + (z - bz) * (z - bz) > reach * reach) continue;
      const o = at * ROW, key = `ferry:${f.key}:${j}:${ymd(V.service)}`, kh = fnv1a(key);
      u32[o + Col.KEY] = kh;
      out[o + Col.KIND] = Kind.FERRY;
      out[o + Col.X] = x;
      out[o + Col.Y] = WATER_Y;
      out[o + Col.Z] = z;
      out[o + Col.VX] = x1 - x;
      out[o + Col.VY] = 0;
      out[o + Col.VZ] = z1 - z;
      out[o + Col.HEADING] = V.heading;
      out[o + Col.PITCH] = 0;
      out[o + Col.BANK] = 0;
      out[o + Col.SCALE] = 1;
      out[o + Col.FLAGS] = 0;
      // (kept to the end of its service day's last crossing, CONTRACT.md section 3: the last round trip starts by SERVICE1)
      out[o + Col.UNTIL] = Math.max(60, V.service * 86400 - tzMin * 60 + SERVICE1 + f.cycle - t);
      keys?.(kh, key);
      at++;
    }
  return at;
}

/** Where vessel j of line f is at t (s, UTC): x, z, heading, and the local day of the service it belongs to. */
const V = { x: 0, z: 0, heading: 0, service: 0 };
function placeVessel(f: FerryLine, j: number, t: number, tzMin: number): void {
  const local = t + tzMin * 60, day = Math.floor(local / 86400);
  // (today's service, else yesterday's last round trip still out past midnight, else laid up at the first terminal in its berth, facing out: before the day's
  // first sailing it belongs to today's service; after the last, to tomorrow's)
  let s = 0, service = day, on = false;
  for (let back = 0; back < 2 && !on; back++) {
    if (!vesselOn(f, j, t, (day - back) * 86400 - tzMin * 60, S)) continue;
    on = true;
    s = S[0];
    service = day - back;
  }
  if (!on && local - day * 86400 >= SERVICE0 + f.first + j * f.head) service = day + 1;
  // (at a berth, its own: the line's along the terminal's axis by its slot there, its vessels side by side at it, outward, slid into over its last APPROACH m in
  // and out of over its first out, so two lines on one approach keep apart too)
  const atB = s > f.L / 2;
  let berth = Math.max(0, Math.min(1, 1 - (atB ? f.L - s : s) / APPROACH));
  berth = berth * berth * (3 - 2 * berth);
  onLine(f, s - FERRY_CHORD, P, 0);
  onLine(f, s + FERRY_CHORD, P, 2);
  let x = (P[0] + P[2]) / 2, z = (P[1] + P[3]) / 2;
  const dx = P[2] - P[0], dz = P[3] - P[1], l = Math.sqrt(dx * dx + dz * dz) || 1, ux = dx / l, uz = dz / l;
  if (berth > 0) {
    // (its own vessels across its heading, outward along the terminal's axis on its slot's side, away from the berths nearer its middle)
    const off = berthOff(atB ? f.slotB : f.slotA) * berth, ax = atB ? f.axisB : f.axisA, raft = RAFT * j * berth * (atB ? f.raftB : f.raftA);
    x += ax[0] * off - uz * raft;
    z += ax[1] * off + ux * raft;
  }
  // (a double-ended ferry, as many on the bay are: it never turns round, so it never sweeps the one beside it at a berth; its heading is the line's either way)
  V.x = x;
  V.z = z;
  V.heading = Math.atan2(uz, ux);
  V.service = service;
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
    const o = at * ROW, key = `sail:${h.key}:${b}:${ymd(day)}`, kh = fnv1a(key);
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
