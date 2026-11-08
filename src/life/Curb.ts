import type { LifeCurb, LifeCurbAnswer } from './lifeWorker';
import { Col, Kind, ROW } from './kinds';
import type { SnapView } from './snapshot';

// Curb's road side on the host (docs/specs/shots/SHOTS.md, "Curb: cruising beside the cars"), the API the first account's Curb flight, camera and landing call:
//   land(x, z, heading)     ask for the kerb lane within 80 m of the bus, driven its way (sim/curb.ts, in life's worker): `state` goes 'asking', then 'on', or
//                           'none' when there's no street there (FIND A STREET)
//   roll(dt, push, look, …) each frame while on: the bus's place on the lane, its heading and speed. It rolls at the traffic's speed and pulls up beside the
//                           nearest car going its way; `push` (0..1, the thumb pushed up) rolls on past it to the next; at a junction it goes straight on, or the
//                           way `look` turns (the look's yaw from the bus's heading). No steering, no lane change (the plan's push-back)
//   leave()                 the wheels up
//   onBeside(key)           told once a car the bus has ridden beside for 1.5 s: the caller paints it (life.hit with the splatter's hue and faction)
// The lane comes in stretches of LENGTH m; the next is asked for, by place, before the bus is AHEAD m from the end, so a renumbered net can't lose it. At a dead
// end the bus slows to a stop at the kerb.

export const curbHost = {
  reach: 80,
  length: 600,
  ahead: 220,
  /** pacing: how far either side of the lane a car may be (m) and ahead or behind it (m), how hard the bus closes on being beside it (1/s), the push's speed over
   *  the road's (x), how fast speed eases (1/s), and how long beside a car paints it (s) */
  side: 12,
  reach2: 70,
  close: 0.8,
  pushOver: 1.5,
  ease: 1.6,
  paintAfter: 1.5,
  catchUp: 8,
  /** the most points the lane holds, and the slowest a bus rolls with nothing to pace (m/s) */
  most: 1200,
  crawl: 6,
};

export interface CurbPose {
  x: number;
  y: number;
  z: number;
  /** the game's heading (rad, 0 north, as Flight's) */
  heading: number;
  speed: number;
}

export class Curb {
  state: 'off' | 'asking' | 'on' | 'none' = 'off';
  /** the car the bus is pacing (its key), and how long it has been beside it (s) */
  beside: string | null = null;
  besideFor = 0;
  onBeside: ((key: string) => void) | null = null;
  /** QA: the last car the pacing looked at, along the lane from the bus and to its side (m) */
  readonly qa = { along: 0, side: 0 };
  private readonly post: (m: LifeCurb) => void;
  private readonly pts = new Float32Array(curbHost.most * 4);
  private n = 0;
  /** where the bus is along the lane: point i and how far past it (m), and its speed */
  private i = 0;
  private t = 0;
  private speed = 0;
  private id = 0;
  private asked = -1;
  private extending = false;
  /** no more lane past this stretch: a dead end, or only tunnels on */
  private ended = false;
  private readonly painted = new Set<string>();

  constructor(post: (m: LifeCurb) => void) {
    this.post = post;
  }

  land(x: number, z: number, heading: number): void {
    this.state = 'asking';
    this.n = this.i = this.t = 0;
    this.ended = this.extending = false;
    this.beside = null;
    this.besideFor = 0;
    this.ask(x, z, Math.sin(heading), -Math.cos(heading), curbHost.reach, null);
  }

  leave(): void {
    this.state = 'off';
    this.n = 0;
    this.beside = null;
    this.extending = false;
  }

  /** The worker's answer (Life.ts passes it on). */
  answer(a: LifeCurbAnswer): void {
    if (a.id !== this.asked) return;
    if (this.state === 'asking') {
      if (!a.n) {
        this.state = 'none';
        return;
      }
      this.pts.set(a.pts.subarray(0, a.n * 4));
      this.n = a.n;
      this.state = 'on';
      this.speed = a.pts[3];
      return;
    }
    if (this.state !== 'on' || !this.extending) return;
    this.extending = false;
    if (!a.n) {
      this.ended = true;
      return;
    }
    // (the stretch from where the bus is on: what's behind it dropped, the new stretch joined where it's nearest the old one's end)
    const keep = this.n - this.i, P = this.pts;
    P.copyWithin(0, this.i * 4, this.n * 4);
    this.n = keep;
    this.i = 0;
    let j0 = 0, best = Infinity;
    const lx = P[(keep - 1) * 4], lz = P[(keep - 1) * 4 + 2];
    for (let j = 0; j < Math.min(a.n, 20); j++) {
      const d = Math.hypot(a.pts[j * 4] - lx, a.pts[j * 4 + 2] - lz);
      if (d < best) {
        best = d;
        j0 = j;
      }
    }
    const add = Math.min(a.n - j0 - 1, curbHost.most - keep);
    if (add > 0) {
      P.set(a.pts.subarray((j0 + 1) * 4, (j0 + 1 + add) * 4), keep * 4);
      this.n = keep + add;
    }
  }

  /**
   * One frame on the lane: the bus's pose into `out`. `push` 0..1 rolls on past the car beside it; `look` (rad from the heading, + right) picks the way at the
   * next junction. `snap` is life's snapshot (the cars, where they were at its utcMs, `ageS` s ago). False when it isn't on a lane.
   */
  roll(dt: number, push: number, look: number, snap: SnapView | null, ageS: number, keys: Map<number, string>, out: CurbPose): boolean {
    if (this.state !== 'on' || this.n < 2) return false;
    const P = this.pts, H = curbHost;
    let i = Math.min(this.i, this.n - 2);
    const road = P[i * 4 + 3];
    // (the car to pace: going the bus's way, beside its lane, nearest along it; with the thumb pushed, only one ahead of it)
    let want = road, pace: string | null = null, paceAlong = Infinity, paceV = 0;
    if (snap) {
      // (each car measured along the lane itself, its nearest point within reach2 m either way of the bus, so one just round a bend is still ahead of it)
      const rows = snap.rows, u32 = snap.rowsU32, span = Math.ceil(H.reach2 / 4), j0 = Math.max(0, i - span), j1 = Math.min(this.n - 2, i + span);
      for (let r = 0, m = snap.u32[2]; r < m; r++) {
        const o = r * ROW, kind = rows[o + Col.KIND];
        if (kind !== Kind.CAR && kind !== Kind.TRUCK) continue;
        const vx = rows[o + Col.VX], vz = rows[o + Col.VZ], px = rows[o + Col.X] + vx * ageS, pz = rows[o + Col.Z] + vz * ageS;
        let bj = -1, bd = Infinity;
        for (let j = j0; j <= j1; j++) {
          const d = (P[j * 4] - px) ** 2 + (P[j * 4 + 2] - pz) ** 2;
          if (d < bd) {
            bd = d;
            bj = j;
          }
        }
        if (bj < 0) continue;
        const sx = P[bj * 4 + 4] - P[bj * 4], sz = P[bj * 4 + 6] - P[bj * 4 + 2], sl = Math.hypot(sx, sz) || 1;
        if ((vx * sx + vz * sz) / sl <= 0) continue;
        const along = (bj - i) * 4 + ((px - P[bj * 4]) * sx + (pz - P[bj * 4 + 2]) * sz) / sl - this.t, side = Math.sqrt(bd);
        this.qa.along = along;
        this.qa.side = side;
        if (side > H.side || Math.abs(along) > H.reach2 || (push > 0.3 && along < 8)) continue;
        if (Math.abs(along) < Math.abs(paceAlong)) {
          paceAlong = along;
          pace = keys.get(u32[o + Col.KEY]) ?? null;
          paceV = Math.hypot(vx, vz);
          want = paceV + along * H.close;
        }
      }
    }
    if (push > 0.3) want = Math.max(want, road * H.pushOver);
    // (a dead end: slowing to a stop at the kerb over the lane's last 40 m)
    // (as fast as the push, or catching up with the car to pace, up to `catchUp` m/s on it)
    want = Math.max(H.crawl, Math.min(want, Math.max(road * H.pushOver * 1.2, pace ? paceV + H.catchUp : 0)));
    if (this.ended) want = Math.min(want, Math.max(0, (this.n - 1 - i) * 4 - this.t - 4) * 0.5);
    this.speed += (want - this.speed) * (1 - Math.exp(-H.ease * dt));
    // (beside a car: riding with it 1.5 s paints it, once)
    if (pace && Math.abs(paceAlong) < 6) {
      if (pace !== this.beside) {
        this.beside = pace;
        this.besideFor = 0;
      }
      this.besideFor += dt;
      if (this.besideFor >= H.paintAfter && !this.painted.has(pace)) {
        this.painted.add(pace);
        this.onBeside?.(pace);
      }
    } else {
      this.beside = null;
      this.besideFor = 0;
    }
    // (on along the lane)
    this.t += this.speed * dt;
    while (i < this.n - 2) {
      const sl = Math.hypot(P[i * 4 + 4] - P[i * 4], P[i * 4 + 6] - P[i * 4 + 2]);
      if (this.t < sl) break;
      this.t -= sl;
      i++;
    }
    this.i = i;
    const cx = P[i * 4], cz = P[i * 4 + 2], dx = P[i * 4 + 4] - cx, dz = P[i * 4 + 6] - cz, sl = Math.hypot(dx, dz) || 1, f = Math.min(1, this.t / sl);
    out.x = cx + dx * f;
    out.y = P[i * 4 + 1] + (P[i * 4 + 5] - P[i * 4 + 1]) * f;
    out.z = cz + dz * f;
    out.heading = Math.atan2(dx, -dz);
    out.speed = this.speed;
    // (the next stretch, asked for by place before this one runs out; the look picks its first junction)
    if (!this.extending && !this.ended && (this.n - 1 - i) * 4 < H.ahead) {
      const j = Math.max(0, this.n - 3), lx = P[j * 4], lz = P[j * 4 + 2], ex = P[(this.n - 1) * 4] - lx, ez = P[(this.n - 1) * 4 + 2] - lz, el = Math.hypot(ex, ez) || 1;
      const lh = out.heading + look, lk: [number, number] | null = Math.abs(look) > 0.2 ? [Math.sin(lh), -Math.cos(lh)] : null;
      this.extending = true;
      this.ask(lx, lz, ex / el, ez / el, 12, lk);
    }
    return true;
  }

  private ask(x: number, z: number, fx: number, fz: number, reach: number, look: [number, number] | null): void {
    this.asked = ++this.id;
    this.post({ type: 'curb', id: this.asked, x, z, fx, fz, reach, length: curbHost.length, look });
  }
}
