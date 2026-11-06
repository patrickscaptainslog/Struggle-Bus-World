import { type CarNet, laneOff, pointAt, pointsOf } from './cars';

// Curb's road side (docs/specs/shots/SHOTS.md, "Curb: cruising beside the cars"; the second account's half, the first account's flight, camera and landing call
// it): the lane the bus lands on and rolls along, on the road map the cars already drive. Worker-safe and pure, on the cars' own net (cars.ts), so the bus's
// lane is a lane a car would drive: never a tunnel, never a way cars may not take, a one-way's own way only.
//   curbLand: the kerb lane (the right-most) of the nearest way driven the bus's way within 80 m of it, or none ("FIND A STREET").
//   curbPath: that lane ahead, a point every 4 m with the road's speed there, on through the ways after it: at a junction straight on, or the way the player is
//             looking. No lane changes: the plan's push-back ("too close to no left or right swipes"), so the bus keeps the kerb.

export const curbTune = {
  /** how far from the bus a lane may be to land on (m), and how much of its way must be the bus's (the cosine of their angle at least) */
  reach: 80,
  along: 0.3,
  /** the path's points (m apart), and at a junction how far a look must turn from straight on to take another way (cosine) */
  step: 4,
  look: 0.5,
  /** a way on that turns back further than this (cosine) is a U-turn, never taken */
  uturn: -0.5,
};

/** Where the bus lands: its way, how far along it (m), the lane's point there (x, y, z) and its way (unit x, z), and how far that was from the bus (m). */
export interface CurbSpot {
  w: number;
  s: number;
  x: number;
  y: number;
  z: number;
  ux: number;
  uz: number;
  d: number;
}

const P = new Float64Array(6);

/** The kerb lane nearest (x, z) of a way driven along (fx, fz), within `reach`: none in a tunnel. Null: no street there. */
export function curbLand(net: CarNet, x: number, z: number, fx: number, fz: number, reach = curbTune.reach): CurbSpot | null {
  let best: CurbSpot | null = null;
  for (let w = 0; w < net.n; w++) {
    if (net.tunnel[w]) continue;
    // (a way is no longer than its length from its start)
    if (Math.hypot(x - net.x0[w], z - net.z0[w]) > net.len[w] + reach + 10) continue;
    const m = pointsOf(net, w), off = laneOff(net, w, -1);
    let s0 = 0;
    pointAt(net, w, 0, P, 0);
    for (let j = 1; j < m; j++) {
      pointAt(net, w, j, P, 3);
      const sx = P[3] - P[0], sz = P[5] - P[2], L = Math.hypot(sx, sz);
      if (L > 1e-3) {
        const ux = sx / L, uz = sz / L;
        if (ux * fx + uz * fz >= curbTune.along) {
          // (the lane's line: the way's, moved right by the kerb lane's offset; the bus's foot on it)
          const ax = P[0] - uz * off, az = P[2] + ux * off, t = Math.max(0, Math.min(L, (x - ax) * ux + (z - az) * uz));
          const px = ax + ux * t, pz = az + uz * t, d = Math.hypot(x - px, z - pz);
          if (d <= reach && (!best || d < best.d)) best = { w, s: s0 + t, x: px, y: P[1] + ((P[4] - P[1]) * t) / L, z: pz, ux, uz, d };
        }
      }
      s0 += L;
      P[0] = P[3];
      P[1] = P[4];
      P[2] = P[5];
    }
  }
  return best;
}

/**
 * The kerb lane ahead of (way w, s m along it), `length` m of it, a point every curbTune.step m into `out` as x, y, z and the road's speed (m/s): on through the
 * ways after w, at each junction the one straight on, or with `look` (unit x, z; null: none) the one nearest it when it turns from straight on. It ends early at a
 * dead end or where only a tunnel goes on. Returns the points written, and leaves the way and s it reached in `end`.
 */
export function curbPath(net: CarNet, w: number, s: number, length: number, look: [number, number] | null, out: Float32Array, end: { w: number; s: number }): number {
  const max = Math.min(Math.floor(out.length / 4), Math.ceil(length / curbTune.step) + 1);
  let n = 0;
  while (n < max) {
    while (s > net.len[w]) {
      s -= net.len[w];
      const nw = onFrom(net, w, look);
      if (nw < 0) {
        end.w = w;
        end.s = net.len[w];
        return n;
      }
      w = nw;
    }
    if (!placeOn(net, w, s, out, n * 4)) break;
    // (at a sharp corner the kerb's offset steps back a little where two ways meet: a point just behind the one before it is dropped; a hairpin's are kept)
    const o = n * 4;
    const back = n >= 2 && (out[o] - out[o - 4]) * (out[o - 4] - out[o - 8]) + (out[o + 2] - out[o - 2]) * (out[o - 2] - out[o - 6]) < 0;
    if (!back || Math.hypot(out[o] - out[o - 4], out[o + 2] - out[o - 2]) > curbTune.step * 0.75) n++;
    s += curbTune.step;
  }
  end.w = w;
  end.s = s;
  return n;
}

/** The way on from w's end: straight on, or the one nearest `look` when it turns enough; -1 for none (a dead end, only tunnels, or only the way back). */
function onFrom(net: CarNet, w: number, look: [number, number] | null): number {
  const a = net.outAt[w], b = net.outAt[w + 1], ex = net.t1[w * 2], ez = net.t1[w * 2 + 1];
  let best = -1, bestStraight = -Infinity, toLook = -1, bestLook = -Infinity;
  for (let k = a; k < b; k++) {
    const o = net.outs[k];
    if (net.tunnel[o]) continue;
    const sx = net.t0[o * 2], sz = net.t0[o * 2 + 1], straight = sx * ex + sz * ez;
    // (never back the way it came: at a dead end the lane ends, and the bus stops at the kerb)
    if (straight < curbTune.uturn) continue;
    if (straight > bestStraight) {
      bestStraight = straight;
      best = o;
    }
    if (look) {
      const l = sx * look[0] + sz * look[1];
      if (l > bestLook) {
        bestLook = l;
        toLook = o;
      }
    }
  }
  // (the look takes another way only when it turns from straight on: a glance ahead goes straight)
  if (look && toLook >= 0 && toLook !== best && look[0] * ex + look[1] * ez < curbTune.look) return toLook;
  return best;
}

/** The kerb lane's point s m along way w into out at o: x, y, z, the road's speed. */
function placeOn(net: CarNet, w: number, s: number, out: Float32Array, o: number): boolean {
  const m = pointsOf(net, w), off = laneOff(net, w, -1);
  let s0 = 0;
  pointAt(net, w, 0, P, 0);
  for (let j = 1; j < m; j++) {
    pointAt(net, w, j, P, 3);
    const sx = P[3] - P[0], sz = P[5] - P[2], L = Math.hypot(sx, sz);
    if (L > 1e-3 && (s <= s0 + L || j === m - 1)) {
      const t = Math.max(0, Math.min(L, s - s0)) / L, ux = sx / L, uz = sz / L;
      out[o] = P[0] + sx * t - uz * off;
      out[o + 1] = P[1] + (P[4] - P[1]) * t;
      out[o + 2] = P[2] + sz * t + ux * off;
      out[o + 3] = net.v[w];
      return true;
    }
    s0 += L;
    P[0] = P[3];
    P[1] = P[4];
    P[2] = P[5];
  }
  return false;
}
