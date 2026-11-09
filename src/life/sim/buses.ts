import { fnv1a, mix, unit } from '../hash';
import { Col, Kind, ROW } from '../kinds';
import { VehicleLook } from './cars';

// Buses on the city's real routes (LIFE.md, "Bus routes"): each line is a route from OpenStreetMap, baked by tools/life/busbake.mjs into the city's buses.bin, on
// the kerb lane of the map's own roads at their height. Worker-safe and pure: a bus is a function of its line, its departure and utcMs, so every player sees
// the same one. A line's buses leave its first stop by the local hour, every 8 minutes at the rush to 20 late (a night line every 30, from midnight to 5; a coach,
// its stops over a km apart, a quarter as often), and each drives the line stop to stop: away at `accel`, on at `cruise`, in to the next and `dwell` s at it, a
// closed form, so a minute's steps end where one jump does. It grows in at its first stop and out at its last, and isn't drawn in a tunnel. A bus is a
// Kind.TRUCK with the bus's look, white, as the cars' own were (sim/cars.ts): those give way where a city has lines (carMix). Never saved: its paint is the session's.

export const busTune = {
  /** between stops (m/s), away from one and in to the next (m/s2), and the wait at a stop (s): about 4.5 m/s with the stops in it */
  cruise: 9,
  accel: 1.1,
  dwell: 18,
  /** its scale over its model, the cars' own bus's, and how long it grows in and out (s) */
  scale: 1.15,
  fade: 2.5,
  /** the share of the reach it grows in over, coming into it */
  edge: 0.12,
  /** the half chord its place and heading are taken on (m), so it takes a bend round */
  chord: 5,
  /** a line with fewer stops than this a km is a coach: it leaves this many times less often */
  coachStops: 0.8,
  coachEvery: 4,
};
/** Minutes between a day line's buses by the local hour (0: none, the small hours are the night lines'), and a night line's. */
const DAY = [20, 0, 0, 0, 0, 20, 12, 8, 8, 10, 10, 10, 10, 10, 10, 8, 8, 8, 8, 12, 12, 12, 20, 20];
const NIGHT = [30, 30, 30, 30, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export interface BusLine {
  ref: string;
  /** the route relation's id and its piece: its buses' keys' seed */
  id: number;
  night: boolean;
  /** each point's x, y, z (the map's metres: the kerb lane's middle, at the road's height), and the line's length to it (m) */
  pts: Float32Array;
  cum: Float32Array;
  len: number;
  /** each stop, m along, the first at 0 and the last at the end; and when a bus that left the first at 0 comes to it (s) */
  stopS: Float32Array;
  stopT: Float32Array;
  /** the whole trip (s) */
  trip: number;
  /** the stretches it isn't drawn on (a tunnel), from and to, m along */
  hidden: Float32Array;
  /** its departures: a share of the gap into each hour, and how many times less often than a city bus */
  phase: number;
  every: number;
  /** its box on the map: x and z, least and most */
  box: [number, number, number, number];
}

/** How long a bus takes from a stop to the next, d m on (s): away, on and in, or away and in where there's no room to reach its speed. */
function legTime(d: number): number {
  const v = busTune.cruise, a = busTune.accel;
  return d >= (v * v) / a ? d / v + v / a : 2 * Math.sqrt(d / a);
}

/** How far along such a leg it is u s after leaving (m), and its speed there into `sp` (m/s). */
const sp = { v: 0 };
function legAt(d: number, u: number): number {
  const v = busTune.cruise, a = busTune.accel;
  if (d >= (v * v) / a) {
    const t1 = v / a, T = d / v + t1;
    if (u < t1) {
      sp.v = a * u;
      return 0.5 * a * u * u;
    }
    if (u < d / v) {
      sp.v = v;
      return (v * v) / (2 * a) + v * (u - t1);
    }
    const w = Math.max(0, T - u);
    sp.v = a * w;
    return d - 0.5 * a * w * w;
  }
  const th = Math.sqrt(d / a);
  if (u < th) {
    sp.v = a * u;
    return 0.5 * a * u * u;
  }
  const w = Math.max(0, 2 * th - u);
  sp.v = a * w;
  return d - 0.5 * a * w * w;
}

/** The city's lines from its inflated buses.bin (tools/life/busbake.mjs has its layout), or null. */
export function parseBusLines(buf: ArrayBuffer): BusLine[] | null {
  const dv = new DataView(buf);
  if (buf.byteLength < 8 || dv.getUint32(0, true) !== 0x31424253 || dv.getUint16(4, true) !== 1) return null;
  const n = dv.getUint16(6, true), out: BusLine[] = [], text = new TextDecoder();
  let o = 8;
  try {
    for (let i = 0; i < n; i++) {
      const rl = dv.getUint8(o), ref = text.decode(new Uint8Array(buf, o + 1, rl));
      o += 1 + rl;
      const flags = dv.getUint8(o), id = dv.getUint32(o + 1, true), np = dv.getUint16(o + 5, true), ns = dv.getUint16(o + 7, true), nh = dv.getUint16(o + 9, true);
      o += 11;
      if (np < 2 || ns < 2) return null;
      const pts = new Float32Array(np * 3), cum = new Float32Array(np), box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      let x = dv.getInt32(o, true), y = dv.getInt32(o + 4, true), z = dv.getInt32(o + 8, true);
      o += 12;
      for (let k = 0; k < np; k++) {
        if (k) {
          x += dv.getInt16(o, true);
          y += dv.getInt16(o + 2, true);
          z += dv.getInt16(o + 4, true);
          o += 6;
        }
        pts[k * 3] = x / 10;
        pts[k * 3 + 1] = y / 10;
        pts[k * 3 + 2] = z / 10;
        if (k) cum[k] = cum[k - 1] + Math.hypot(pts[k * 3] - pts[k * 3 - 3], pts[k * 3 + 2] - pts[k * 3 - 1]);
        box[0] = Math.min(box[0], x / 10);
        box[1] = Math.min(box[1], z / 10);
        box[2] = Math.max(box[2], x / 10);
        box[3] = Math.max(box[3], z / 10);
      }
      const len = cum[np - 1], stopS = new Float32Array(ns), stopT = new Float32Array(ns), hidden = new Float32Array(nh * 2);
      for (let k = 0; k < ns; k++, o += 2) stopS[k] = Math.min(len, dv.getUint16(o, true) * 2);
      for (let k = 0; k < nh * 2; k++, o += 2) hidden[k] = dv.getUint16(o, true) * 2;
      stopS[0] = 0;
      stopS[ns - 1] = len;
      // (when it comes to each stop: the wait at every stop between, then the leg)
      for (let k = 1; k < ns; k++) stopT[k] = stopT[k - 1] + (k > 1 ? busTune.dwell : 0) + legTime(Math.max(0, stopS[k] - stopS[k - 1]));
      out.push({
        ref, id, night: !!(flags & 1), pts, cum, len, stopS, stopT, trip: stopT[ns - 1], hidden, phase: unit(mix(id, 3)),
        every: (ns - 2) / Math.max(0.1, len / 1000) < busTune.coachStops ? busTune.coachEvery : 1, box,
      });
    }
  } catch {
    return null;
  }
  return out;
}

/** How far along its line a bus is tau s after it left its first stop (m); its speed there in `sp`. */
function busAt(l: BusLine, tau: number): number {
  const T = l.stopT, n = T.length;
  if (tau >= l.trip) {
    sp.v = 0;
    return l.len;
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (T[mid] <= tau) lo = mid;
    else hi = mid;
  }
  const u = tau - T[lo] - (lo > 0 ? busTune.dwell : 0);
  if (u <= 0) {
    sp.v = 0;
    return l.stopS[lo];
  }
  return l.stopS[lo] + legAt(l.stopS[lo + 1] - l.stopS[lo], u);
}

/** The point s m along the line into P at q: x, y, z; held at its ends. */
const P = new Float64Array(6);
function onLine(l: BusLine, s: number, q: number): void {
  const C = l.cum, n = C.length;
  s = Math.max(0, Math.min(l.len, s));
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (C[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = C[hi] - C[lo], f = seg > 1e-6 ? (s - C[lo]) / seg : 0, a = lo * 3, b = hi * 3, p = l.pts;
  P[q] = p[a] + (p[b] - p[a]) * f;
  P[q + 1] = p[a + 1] + (p[b + 1] - p[a + 1]) * f;
  P[q + 2] = p[a + 2] + (p[b + 2] - p[a + 2]) * f;
}

/** Minutes between line l's buses in local hour h of the day, 0 for none. */
export function busEvery(l: BusLine, h: number): number {
  const m = (l.night ? NIGHT : DAY)[h];
  return m ? Math.min(60, m * l.every) : 0;
}

/**
 * Every bus of `lines` at utcMs (tzMin the place's offset from UTC, min) within `reach` of (bx, bz), as rows from `at` in `out`. Returns the next free row, at most
 * `max`. `keys`, if given, is told each row's key: `bus:<ref>:<line>:<its departure, local s>`.
 */
export function busesOn(lines: BusLine[], utcMs: number, tzMin: number, bx: number, bz: number, reach: number, out: Float32Array, at: number, max: number,
  keys?: (hash: number, key: string) => void): number {
  const u32 = new Uint32Array(out.buffer, out.byteOffset, out.length), local = utcMs / 1000 + tzMin * 60, B = busTune;
  for (const l of lines) {
    if (bx < l.box[0] - reach || bx > l.box[2] + reach || bz < l.box[1] - reach || bz > l.box[3] + reach) continue;
    // (each hour a bus now out could have left in: its departures a gap apart from its line's own offset into the hour)
    for (let H = Math.floor((local - l.trip) / 3600), H1 = Math.floor(local / 3600); H <= H1; H++) {
      const gap = busEvery(l, ((H % 24) + 24) % 24) * 60;
      if (!gap) continue;
      for (let dep = H * 3600 + Math.floor(l.phase * gap); dep < (H + 1) * 3600 && at < max; dep += gap) {
        const tau = local - dep;
        if (tau < 0 || tau >= l.trip) continue;
        const s = busAt(l, tau), v = sp.v;
        // (in a tunnel it isn't drawn)
        let hid = false;
        for (let k = 0; k < l.hidden.length && !hid; k += 2) hid = s >= l.hidden[k] && s <= l.hidden[k + 1];
        if (hid) continue;
        onLine(l, s - B.chord, 0);
        onLine(l, s + B.chord, 3);
        const x = (P[0] + P[3]) / 2, y = (P[1] + P[4]) / 2, z = (P[2] + P[5]) / 2;
        const far = Math.sqrt((x - bx) * (x - bx) + (z - bz) * (z - bz));
        if (far > reach) continue;
        const dx = P[3] - P[0], dy = P[4] - P[1], dz = P[5] - P[2], run = Math.sqrt(dx * dx + dz * dz) || 1, d3 = Math.sqrt(run * run + dy * dy);
        const o = at * ROW, key = `bus:${l.ref}:${l.id}:${dep}`, kh = fnv1a(key);
        u32[o + Col.KEY] = kh;
        out[o + Col.KIND] = Kind.TRUCK;
        out[o + Col.X] = x;
        out[o + Col.Y] = y;
        out[o + Col.Z] = z;
        out[o + Col.VX] = (dx / d3) * v;
        out[o + Col.VY] = (dy / d3) * v;
        out[o + Col.VZ] = (dz / d3) * v;
        out[o + Col.HEADING] = Math.atan2(dz, dx);
        out[o + Col.PITCH] = Math.asin(dy / d3);
        out[o + Col.BANK] = 0;
        // (it grows in at its first stop and out at its last, and over the last `edge` of the reach, so none pops in at 1.2 km)
        out[o + Col.SCALE] = B.scale * Math.max(0.02, Math.min(1, tau / B.fade, (l.trip - tau) / B.fade, (reach - far) / (B.edge * reach)));
        out[o + Col.FLAGS] = 0;
        out[o + Col.UNTIL] = l.trip - tau;
        out[o + Col.LOOK] = VehicleLook.BUS;
        keys?.(kh, key);
        at++;
      }
    }
  }
  return at;
}
