import { fnv1a, mix, unit } from '../hash';
import { Col, Kind, ROW, RowFlag } from '../kinds';
import type { RegionGraph } from '../../world/lifeData';

// Cars (LIVING.md, "Cars"): on the world's road graph (GRAPHS.md), by road class and the real local hour, grey. Worker-safe and pure: a car is a function of the
// graphs loaded, its slot and utcMs, so every player sees the same one. Each driven way of an edge has a stream of slots; a slot's car is born at the edge's
// start at a hashed time in it if the hour's traffic says so, lives LIFE_MIN to LIFE_MAX s, and drives a hashed path from there: mostly straight on, never back
// the way it came, never onto an edge the world hasn't drawn yet (UNDRAWN: the decks the first account is building) or cars may not use (NO_CARS), each edge
// at its own speed, in a lane on the right, round each bend rather than through its corner. Its place at utcMs is that path walked for its age: a closed form, so a
// minute's steps end where one jump does. It grows in and out over FADE s where it's born and where it ends. In a tunnel it isn't drawn. Never saved: `car:`
// lives only while it's near (CONTRACT.md section 3).

// (lifeData.ts's values: its file has const enums, which Node's checks can't load, so only its types come in)
const ROAD = 1, FORWARD = 1, BACKWARD = 2;
const BRIDGE = 1, TUNNEL = 2, UNDRAWN = 4, NO_CARS = 64;
const TRACK = 10;

/**
 * By road class (lifeData.ts RoadClass: 1 motorway, trunk, primary, secondary, tertiary, residential, unclassified, living street, service, track, 11 unknown):
 * cars a km each way at the busiest hour, the speed they keep where the edge names none (km/h, stops and lights in it), and lanes each way (the graphs have none yet).
 */
const PEAK = [0, 36, 28, 22, 16, 11, 5, 4, 1.5, 1.2, 0, 3];
const KMH = [0, 88, 60, 40, 36, 32, 26, 26, 12, 12, 0, 26];
const LANES = [0, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1];
/** The traffic by the local hour, a share of the busiest: the morning's and the evening's peaks, and the small hours' few. Read between the hours. */
const HOURS = [0.25, 0.17, 0.12, 0.1, 0.12, 0.22, 0.45, 0.8, 1, 0.86, 0.72, 0.75, 0.8, 0.78, 0.8, 0.88, 0.97, 1, 0.9, 0.72, 0.58, 0.5, 0.42, 0.33];
/** A car's life (s), its least headway at the edge's start (s), and how long it grows in and out (s). */
export const LIFE_MIN = 45, LIFE_MAX = 90;
const HEAD_MIN = 2, FADE = 1.2;
/** A lane's width (m), and the half chord a car's place and heading are taken on (m): placeOn. */
const LANE_W = 3.2, CHORD = 4;

/** The roads cars may drive, every driven way of an edge its own: built once each time the graphs loaded change. */
export interface CarNet {
  /** driven ways */
  n: number;
  graphs: RegionGraph[];
  /** each way's graph (into graphs), its edge there, and 1 if it's driven from b to a */
  g: Uint16Array;
  e: Uint32Array;
  rev: Uint8Array;
  /** the edge's id (lifeData's, the same in every region), and the way's hash, its slots' seed */
  id: Uint32Array;
  seed: Uint32Array;
  /** its length (m), speed (m/s), lanes each way, and 1 if the road is two-way (its lanes right of the line), a tunnel, or a bridge's drawn deck */
  len: Float32Array;
  v: Float32Array;
  lanes: Uint8Array;
  two: Uint8Array;
  tunnel: Uint8Array;
  deck: Uint8Array;
  /** s between its slots at the busiest hour; 0: none are born on it */
  head: Float32Array;
  /** its start, and the way it leaves its start and comes into its end (unit, x and z) */
  x0: Float32Array;
  z0: Float32Array;
  t0: Float32Array;
  t1: Float32Array;
  /** the ways on from its end: outs[outAt[i]] to outs[outAt[i + 1]], each's weight summed in outW */
  outAt: Int32Array;
  outs: Int32Array;
  outW: Float32Array;
  /** the fastest way's speed (m/s): how far a car may have come since it was born */
  vmax: number;
}

/** Point j of way w (0 its start, pointsOf(w) - 1 its end) into P at q, as x, y, z. */
function pointAt(net: CarNet, w: number, j: number, P: Float64Array, q: number): void {
  const G = net.graphs[net.g[w]], i = net.e[w], m = G.edges.shape[i + 1] - G.edges.shape[i], k = net.rev[w] ? m + 1 - j : j;
  let src: Float32Array, o: number;
  if (k === 0) {
    src = G.nodes.xyz;
    o = G.edges.a[i] * 3;
  } else if (k === m + 1) {
    src = G.nodes.xyz;
    o = G.edges.b[i] * 3;
  } else {
    src = G.pts;
    o = (G.edges.shape[i] + k - 1) * 3;
  }
  P[q] = src[o];
  P[q + 1] = src[o + 1];
  P[q + 2] = src[o + 2];
}
const pointsOf = (net: CarNet, w: number) => {
  const G = net.graphs[net.g[w]], i = net.e[w];
  return G.edges.shape[i + 1] - G.edges.shape[i] + 2;
};

/** A way's lateral place for a car in lane-hash `lh` (m, + to the right of its way). */
function laneOff(net: CarNet, w: number, lh: number): number {
  const L = net.lanes[w], lane = lh % L;
  return net.two[w] ? (lane + 0.5) * LANE_W : (lane + 0.5 - L / 2) * LANE_W;
}

const P = new Float64Array(6);

/** The roads in `graphs` cars may drive (in the order given: sort them, so every player's net is the same). */
export function buildNet(graphs: RegionGraph[]): CarNet {
  let n = 0;
  for (const G of graphs) {
    const E = G.edges;
    for (let i = 0; i < E.n; i++) if (E.kind[i] === ROAD && !(E.flags[i] & (UNDRAWN | NO_CARS)) && E.cls[i] !== TRACK) n += E.dir[i] === FORWARD || E.dir[i] === BACKWARD ? 1 : 2;
  }
  const net: CarNet = {
    n, graphs, g: new Uint16Array(n), e: new Uint32Array(n), rev: new Uint8Array(n), id: new Uint32Array(n), seed: new Uint32Array(n), len: new Float32Array(n), v: new Float32Array(n),
    lanes: new Uint8Array(n), two: new Uint8Array(n), tunnel: new Uint8Array(n), deck: new Uint8Array(n), head: new Float32Array(n), x0: new Float32Array(n), z0: new Float32Array(n),
    t0: new Float32Array(n * 2), t1: new Float32Array(n * 2), outAt: new Int32Array(n + 1), outs: new Int32Array(0), outW: new Float32Array(0), vmax: 0,
  };
  const from = new Uint32Array(n), to = new Uint32Array(n);
  let w = 0;
  graphs.forEach((G, gi) => {
    const E = G.edges, N = G.nodes;
    for (let i = 0; i < E.n; i++) {
      if (E.kind[i] !== ROAD || E.flags[i] & (UNDRAWN | NO_CARS) || E.cls[i] === TRACK) continue;
      for (let r = 0; r < 2; r++) {
        if ((r === 0 && E.dir[i] === BACKWARD) || (r === 1 && E.dir[i] === FORWARD)) continue;
        const c = E.cls[i] < PEAK.length ? E.cls[i] : 11;
        net.g[w] = gi;
        net.e[w] = i;
        net.rev[w] = r;
        net.id[w] = E.id[i];
        net.seed[w] = mix(E.id[i], r, 0x63617273);
        net.v[w] = (E.speed[i] > 0 ? E.speed[i] * (c === 1 ? 0.95 : 0.85) : KMH[c]) / 3.6;
        net.lanes[w] = Math.max(1, E.lanes[i] || LANES[c]);
        net.two[w] = E.dir[i] === FORWARD || E.dir[i] === BACKWARD ? 0 : 1;
        net.tunnel[w] = E.flags[i] & TUNNEL ? 1 : 0;
        net.deck[w] = E.flags[i] & BRIDGE ? 1 : 0;
        from[w] = N.id[r ? E.b[i] : E.a[i]];
        to[w] = N.id[r ? E.a[i] : E.b[i]];
        // (its length, and the way it leaves and comes in, from its points)
        const m = pointsOf(net, w);
        let L = 0;
        pointAt(net, w, 0, P, 0);
        net.x0[w] = P[0];
        net.z0[w] = P[2];
        for (let j = 1; j < m; j++) {
          pointAt(net, w, j, P, 3);
          const dx = P[3] - P[0], dy = P[4] - P[1], dz = P[5] - P[2], h = Math.hypot(dx, dz);
          L += Math.hypot(h, dy);
          if (h > 1e-3) {
            if (net.t0[w * 2] === 0 && net.t0[w * 2 + 1] === 0) {
              net.t0[w * 2] = dx / h;
              net.t0[w * 2 + 1] = dz / h;
            }
            net.t1[w * 2] = dx / h;
            net.t1[w * 2 + 1] = dz / h;
          }
          P[0] = P[3];
          P[1] = P[4];
          P[2] = P[5];
        }
        net.len[w] = Math.max(0.5, L);
        net.head[w] = PEAK[c] > 0 ? Math.max(HEAD_MIN, ((LIFE_MIN + LIFE_MAX) / 2) / ((PEAK[c] * net.len[w]) / 1000)) : 0;
        net.vmax = Math.max(net.vmax, net.v[w]);
        w++;
      }
    }
  });
  // (the ways from each node, by id: a portal's two copies are one node. In the edges' id order, so a pick is every player's)
  const at = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const l = at.get(from[i]);
    if (l) l.push(i);
    else at.set(from[i], [i]);
  }
  for (const l of at.values()) l.sort((p, q) => net.id[p] - net.id[q] || net.rev[p] - net.rev[q]);
  const outs: number[] = [], outW: number[] = [];
  for (let i = 0; i < n; i++) {
    net.outAt[i] = outs.length;
    let sum = 0;
    for (const j of at.get(to[i]) ?? []) {
      if (net.id[j] === net.id[i]) continue; // (never back the way it came)
      // (mostly straight on: a turn a fifth as likely, and one back past 120 degrees, into an alley behind, hardly ever unless it's the only way on)
      const c = net.t1[i * 2] * net.t0[j * 2] + net.t1[i * 2 + 1] * net.t0[j * 2 + 1];
      sum += c < -0.5 ? 0.02 : 0.5 + 2 * Math.max(0, c) ** 4;
      outs.push(j);
      outW.push(sum);
    }
  }
  net.outAt[n] = outs.length;
  net.outs = Int32Array.from(outs);
  net.outW = Float32Array.from(outW);
  return net;
}

/** The way a car of seed `s` takes on from way w, its `step`th choice; -1: none (a dead end, or the graphs loaded end there). */
function next(net: CarNet, w: number, s: number, step: number): number {
  const a = net.outAt[w], b = net.outAt[w + 1];
  if (a === b) return -1;
  const u = unit(mix(s, step, 7)) * net.outW[b - 1];
  for (let k = a; k < b - 1; k++) if (u < net.outW[k]) return net.outs[k];
  return net.outs[b - 1];
}

/** Where a car is: x, y, z, its way (unit x, y, z). */
const C = { x: 0, y: 0, z: 0, ux: 0, uy: 0, uz: 0 };
/** The path round a car: up to REACH_WAYS ways before the one it's on (a chord's length of them, at regions' lines and short links too), that one at MID, and as many
 *  after (-1: none past the path's ends) */
const REACH_WAYS = 8, MID = REACH_WAYS;
const chain = new Int32Array(REACH_WAYS * 2 + 1);
/** the last ways a car's walk passed, newest at back % REACH_WAYS */
const behind = new Int32Array(REACH_WAYS);
const A = new Float64Array(5), B = new Float64Array(5), Q = new Float64Array(6);

/** The point s m along the chain's middle way (less than 0: back into the ways before it, past its length: on into those after, held at the chain's ends), and the lane's
 *  offset there, into out as x, y, z, offset, and how far it was held (m). */
function along(net: CarNet, s: number, lh: number, out: Float64Array): void {
  let i = MID;
  while (s < 0 && i > 0 && chain[i - 1] >= 0) s += net.len[chain[--i]];
  while (s > net.len[chain[i]] && i < chain.length - 1 && chain[i + 1] >= 0) s -= net.len[chain[i++]];
  const w = chain[i], m = pointsOf(net, w), held = Math.min(net.len[w], Math.max(0, s));
  out[4] = Math.abs(held - s);
  s = held;
  pointAt(net, w, 0, Q, 0);
  for (let k = 1; k < m; k++) {
    pointAt(net, w, k, Q, 3);
    const seg = Math.sqrt((Q[3] - Q[0]) ** 2 + (Q[4] - Q[1]) ** 2 + (Q[5] - Q[2]) ** 2);
    if (s <= seg || k === m - 1) {
      const f = seg > 1e-6 ? Math.min(1, s / seg) : 0;
      out[0] = Q[0] + (Q[3] - Q[0]) * f;
      out[1] = Q[1] + (Q[4] - Q[1]) * f;
      out[2] = Q[2] + (Q[5] - Q[2]) * f;
      break;
    }
    s -= seg;
    Q[0] = Q[3];
    Q[1] = Q[4];
    Q[2] = Q[5];
  }
  out[3] = laneOff(net, w, lh);
}

/** The lane's offset for lane-hash lh, its mean over the path from s0 to s1 m along the chain's middle way (what of it the chain has): a step between two ways' is a ramp. */
function meanOff(net: CarNet, s0: number, s1: number, lh: number): number {
  let sum = 0, got = 0, start = 0;
  for (let i = MID; i >= 0 && chain[i] >= 0; i--) {
    const w = chain[i];
    if (i < MID) start -= net.len[w];
    const lo = Math.max(s0, start), hi = Math.min(s1, start + net.len[w]);
    if (hi > lo) {
      sum += laneOff(net, w, lh) * (hi - lo);
      got += hi - lo;
    }
    if (start <= s0) break;
  }
  start = net.len[chain[MID]];
  for (let i = MID + 1; i < chain.length && chain[i] >= 0 && start < s1; i++) {
    const w = chain[i], lo = Math.max(s0, start), hi = Math.min(s1, start + net.len[w]);
    if (hi > lo) {
      sum += laneOff(net, w, lh) * (hi - lo);
      got += hi - lo;
    }
    start += net.len[w];
  }
  return got > 0 ? sum / got : laneOff(net, chain[MID], lh);
}

/**
 * A car s m along the chain's middle way, in lane-hash lh: on the chord between the points CHORD behind it and CHORD ahead on its path, at its middle, facing along it,
 * in the lane the mean along it. So it takes a bend round, not through its corner, a short stretch of the way's line changes nothing, and a lane's change between two
 * ways is a slide over 2 x CHORD: neither its place nor its heading jumps. Its lane's offset is as much of itself as the chord is straight (the chord's length over the
 * path's between its ends), so round a hairpin it keeps to the line rather than swinging out across it.
 */
function placeOn(net: CarNet, s: number, lh: number): void {
  along(net, s - CHORD, lh, A);
  along(net, s + CHORD, lh, B);
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], h = Math.sqrt(dx * dx + dz * dz), w = chain[MID];
  const arc = 2 * CHORD - A[4] - B[4], straight = arc > 1e-3 ? Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / arc) : 1;
  const tx = h > 1e-3 ? dx / h : net.t0[w * 2], tz = h > 1e-3 ? dz / h : net.t0[w * 2 + 1], slope = h > 1e-3 ? dy / h : 0, off = meanOff(net, s - CHORD, s + CHORD, lh) * straight * straight;
  C.x = (A[0] + B[0]) / 2 - tz * off;
  C.y = (A[1] + B[1]) / 2;
  C.z = (A[2] + B[2]) / 2 + tx * off;
  const l = Math.sqrt(1 + slope * slope);
  C.ux = tx / l;
  C.uz = tz / l;
  C.uy = slope / l;
}

/** The local hour's traffic, a share of the busiest. */
export function traffic(localHour: number): number {
  const h = ((localHour % 24) + 24) % 24, i = Math.floor(h), f = h - i;
  return HOURS[i] * (1 - f) + HOURS[(i + 1) % 24] * f;
}

/**
 * The cars of `net` round (bx, bz) at utcMs, as rows from `at` in `out`: every one within `full`, fewer on out to none at `reach`, so the traffic thins into the
 * distance rather than stopping at an edge; `tzMin` the place's offset from UTC (min) for its hour, `keep` the share of them kept (1 low over the streets, less as
 * the bus climbs away). A car's share is its own hash's, so as the bus comes on they appear one by one. Returns the next free row, at most `max`. `keys`, if given,
 * is told each row's key; `ways`, if given, each row's way (QA).
 */
export function carsOn(net: CarNet, utcMs: number, tzMin: number, bx: number, bz: number, full: number, reach: number, keep: number, out: Float32Array, at: number,
  max: number, keys?: (hash: number, key: string) => void, ways?: Int32Array): number {
  if (!net.n || keep <= 0) return at;
  const u32 = new Uint32Array(out.buffer, out.byteOffset, out.length), t = utcMs / 1000, vmax = net.vmax;
  for (let w0 = 0; w0 < net.n && at < max; w0++) {
    const H = net.head[w0];
    if (!H) continue;
    const d0 = Math.hypot(net.x0[w0] - bx, net.z0[w0] - bz);
    if (d0 - vmax * LIFE_MAX > reach) continue;
    const seed = net.seed[w0];
    for (let k = Math.floor((t - LIFE_MAX) / H), k1 = Math.floor(t / H); k <= k1 && at < max; k++) {
      // (born in its slot's first half: two from one edge's start are half a headway apart at the least)
      const tb = (k + 0.5 * unit(mix(seed, k))) * H, a = t - tb;
      if (a < 0 || a > LIFE_MAX || d0 - vmax * a > reach) continue;
      const s = mix(seed, k, 1);
      if (unit(s) >= traffic(tb / 3600 + tzMin / 60)) continue;
      const T = LIFE_MIN + (LIFE_MAX - LIFE_MIN) * unit(mix(s, 2));
      const share = unit(mix(s, 3));
      if (a > T || share >= keep) continue;
      // (its path walked for its age, each way at its own speed)
      let w = w0, tau = a, step = 0, gone = false;
      for (;;) {
        const te = net.len[w] / net.v[w];
        if (tau < te) break;
        tau -= te;
        const nx = next(net, w, s, step);
        if (nx < 0 || step > 96) {
          gone = true;
          break;
        }
        behind[step % REACH_WAYS] = w;
        w = nx;
        step++;
      }
      if (gone || net.tunnel[w]) continue;
      // (and how soon its path ends, if within the fade)
      const nxt = next(net, w, s, step);
      let left = net.len[w] / net.v[w] - tau, endIn = Infinity;
      for (let ahead = nxt, st = step + 1; left < FADE; st++) {
        if (ahead < 0) {
          endIn = left;
          break;
        }
        left += net.len[ahead] / net.v[ahead];
        ahead = next(net, ahead, s, st);
      }
      // (the path a chord's length either side of it: the ways it came by, and those it will take)
      const at0 = tau * net.v[w];
      chain[MID] = w;
      for (let i = 1, got = at0; i <= REACH_WAYS; i++) {
        chain[MID - i] = got < CHORD && step - i >= 0 ? behind[(step - i) % REACH_WAYS] : -1;
        if (chain[MID - i] >= 0) got += net.len[chain[MID - i]];
      }
      chain[MID + 1] = nxt;
      for (let i = 1, got = net.len[w] - at0, x = nxt, st = step + 1; i <= REACH_WAYS; i++) {
        chain[MID + i] = got < CHORD ? x : -1;
        if (x < 0 || got >= CHORD) {
          for (let j = i + 1; j <= REACH_WAYS; j++) chain[MID + j] = -1;
          break;
        }
        got += net.len[x];
        x = next(net, x, s, st++);
      }
      placeOn(net, at0, mix(s, 4));
      const d = Math.sqrt((C.x - bx) * (C.x - bx) + (C.z - bz) * (C.z - bz));
      if (d > full && share >= keep * Math.max(0, (reach - d) / (reach - full))) continue;
      const fade = Math.min(1, a / FADE, (T - a) / FADE, endIn / FADE), v = net.v[w];
      const o = at * ROW, key = `car:${net.id[w0]}:${net.rev[w0]}:${k}`, kh = fnv1a(key);
      u32[o + Col.KEY] = kh;
      out[o + Col.KIND] = Kind.CAR;
      out[o + Col.X] = C.x;
      out[o + Col.Y] = C.y;
      out[o + Col.Z] = C.z;
      out[o + Col.VX] = C.ux * v;
      out[o + Col.VY] = C.uy * v;
      out[o + Col.VZ] = C.uz * v;
      out[o + Col.HEADING] = Math.atan2(C.uz, C.ux);
      out[o + Col.PITCH] = Math.asin(Math.max(-1, Math.min(1, C.uy)));
      out[o + Col.BANK] = 0;
      out[o + Col.SCALE] = Math.max(0.05, fade) * (0.94 + 0.12 * unit(mix(s, 5)));
      out[o + Col.FLAGS] = net.deck[w] ? RowFlag.DECK : 0;
      out[o + Col.UNTIL] = T - a;
      if (ways) ways[at] = w;
      keys?.(kh, key);
      at++;
    }
  }
  return at;
}
