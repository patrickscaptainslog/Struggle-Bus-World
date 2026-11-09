import type { LifeCurb, LifeCurbAnswer } from './lifeWorker';
import { Col, Kind, ROW } from './kinds';
import type { SnapView } from './snapshot';

// Curb's road side on the host (docs/specs/shots/SHOTS.md, "Curb: cruising beside the cars"), the API the first account's Curb flight, camera and landing call:
//   land(x, z, heading, speed?)  ask for the kerb's line within 80 m of the bus, driven its way (sim/curb.ts, in life's worker): `state` goes 'asking', then 'on',
//                           or 'none' when there's no street there (FIND A STREET). `waiting` while the roads round there aren't in yet. The bus rolls on from
//                           `speed` (m/s; none: the road's), easing to the pace (CURB.md's H1)
//   roll(dt, push, look, …) each frame while on: the bus's place on the line, its heading and speed. It rolls at the traffic's speed and pulls up beside the
//                           nearest car going its way, a lane to the kerb side of it (the day review's B2); `push` (0..1, the thumb pushed up) rolls on past it to
//                           the next; the next junction ahead with a choice goes straight on, or the way `look` turns (the look's yaw from the bus's heading),
//                           asked again from just before it as the look comes (M12). No steering, no lane change (the plan's push-back). Where the line ends at a
//                           dead end the bus brakes to a stop at the kerb, and asks no more (M13)
//   leave()                 the wheels up
//   onBeside(key)           told once a landing a car the bus has ridden beside for 1.5 s: the caller paints it (life.hit with the splatter's hue and faction)
//   beside, besideAt        the car beside the bus (its key) and where it is (H4); next, the nearest unpainted car ahead going its way, to glint (H8); kerb, the
//                           kerb's side (+1 right: the cars' net drives on the right everywhere for now, H7)
// The line comes in stretches of LENGTH m; the next is asked for, by place, before the bus is AHEAD m from the end, so a renumbered net can't lose it.

export const curbHost = {
  reach: 80,
  length: 600,
  ahead: 220,
  /** pacing: how far to the traffic's side of the bus's line a car may be (m), at the least and the most, and ahead or behind it (m), how hard the bus closes on
   *  being beside it (1/s), the push's speed over the road's (x), how fast speed eases (1/s), and how long beside a car paints it (s) */
  sideMin: 1.6,
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
  /** a dead end: how hard the bus brakes for it (m/s²), and how far short of the line's last point it stops (m) */
  brake: 3,
  stopShort: 2,
  /** a look past this (rad from the heading) picks the next junction's way, and the cut it's asked from stands this many points before the junction */
  look: 0.2,
  cut: 2,
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
  /** asking, and the worker is waiting for the roads round there: not yet, rather than no street (the day review's m21) */
  waiting = false;
  /** the kerb's side of the line, +1 right, -1 left (H7): the cars' net drives on the right everywhere for now */
  readonly kerb = 1;
  /** the car the bus is pacing (its key), how long it has been beside it (s), and where it is while beside (H4; null otherwise) */
  beside: string | null = null;
  besideFor = 0;
  besideAt: { x: number; y: number; z: number } | null = null;
  /** the nearest car ahead going the bus's way that isn't painted, for its glint (H8) */
  next: string | null = null;
  onBeside: ((key: string) => void) | null = null;
  /** QA: the last car the pacing looked at, along the lane from the bus and to the traffic's side of its line (m); the asks made, and the turns asked */
  readonly qa = { along: 0, side: 0, asks: 0, turns: 0 };
  private readonly post: (m: LifeCurb) => void;
  private readonly pts = new Float32Array(curbHost.most * 4);
  private n = 0;
  /** where the bus is along the lane: point i and how far past it (m), and its speed */
  private i = 0;
  private t = 0;
  private speed = 0;
  private landSpeed = NaN;
  private id = 0;
  private asked = -1;
  /** the ask on its way: none, the next stretch, or a turn at a junction; the point it joins after, the look it was asked with (-1, 0, 1), and the junction's slot */
  private pending: 'none' | 'extend' | 'turn' = 'none';
  private from = 0;
  private askLook = 0;
  /** no more lane past this stretch: a dead end, or only tunnels on */
  private ended = false;
  /** the junctions with a choice ahead: the index of each one's first point past it, and the look its way was picked with (-1, 0, 1) */
  private readonly jn = new Int32Array(128);
  private readonly jl = new Int8Array(128);
  private nj = 0;
  /** the cars painted by riding beside them, this landing */
  private readonly painted = new Set<string>();
  private readonly at = { x: 0, y: 0, z: 0 };

  constructor(post: (m: LifeCurb) => void) {
    this.post = post;
  }

  land(x: number, z: number, heading: number, speed?: number): void {
    this.state = 'asking';
    this.waiting = false;
    this.n = this.i = this.t = this.nj = 0;
    this.ended = false;
    this.pending = 'none';
    this.landSpeed = speed ?? NaN;
    this.beside = this.next = this.besideAt = null;
    this.besideFor = 0;
    this.painted.clear();
    this.ask(x, z, Math.sin(heading), -Math.cos(heading), curbHost.reach, null);
  }

  leave(): void {
    this.state = 'off';
    this.waiting = false;
    this.n = 0;
    this.beside = this.next = this.besideAt = null;
    this.pending = 'none';
  }

  /** The worker's answer (Life.ts passes it on). */
  answer(a: LifeCurbAnswer): void {
    if (a.id !== this.asked) return;
    if (a.wait) {
      if (this.state === 'asking') this.waiting = true;
      return;
    }
    if (this.state === 'asking') {
      this.waiting = false;
      if (!a.n) {
        this.state = 'none';
        return;
      }
      const n = Math.min(a.n, curbHost.most);
      this.pts.set(a.pts.subarray(0, n * 4));
      this.n = n;
      this.nj = 0;
      for (let k = 0; k < a.nj && this.nj < this.jn.length; k++) if (a.js[k] < n) this.addJunction(a.js[k], 0);
      this.ended = a.dead && n === a.n;
      this.state = 'on';
      this.speed = Number.isNaN(this.landSpeed) ? a.pts[3] : this.landSpeed;
      return;
    }
    if (this.state !== 'on' || this.pending === 'none') return;
    const kind = this.pending, from = this.from, P = this.pts;
    this.pending = 'none';
    // (the bus already past the cut: the lane as it was)
    if (from < this.i + 1 || from >= this.n) return;
    let j0 = 0, best = Infinity;
    const lx = P[from * 4], lz = P[from * 4 + 2], keep = from - this.i + 1;
    for (let j = 0; j < Math.min(a.n, 20); j++) {
      const d = Math.hypot(a.pts[j * 4] - lx, a.pts[j * 4 + 2] - lz);
      if (d < best) {
        best = d;
        j0 = j;
      }
    }
    const add = a.n ? Math.min(a.n - j0 - 1, curbHost.most - keep) : 0;
    if (add <= 0) {
      // (an answer that adds nothing past the end is the end, the day review's M13; a turn that finds nothing leaves the lane as it was)
      if (kind === 'extend') this.ended = true;
      return;
    }
    // (the stretch from where the bus is on: what's behind it dropped, and from the cut on the new one, joined after its point nearest the cut's)
    const i = this.i;
    P.copyWithin(0, i * 4, (from + 1) * 4);
    P.set(a.pts.subarray((j0 + 1) * 4, (j0 + 1 + add) * 4), keep * 4);
    this.n = keep + add;
    this.i = 0;
    let m = 0;
    for (let k = 0; k < this.nj; k++) {
      if (this.jn[k] <= i || this.jn[k] > from) continue;
      this.jn[m] = this.jn[k] - i;
      this.jl[m++] = this.jl[k];
    }
    this.nj = m;
    for (let k = 0; k < a.nj; k++) if (a.js[k] > j0 && a.js[k] <= j0 + add) this.addJunction(keep + a.js[k] - j0 - 1, this.askLook);
    this.ended = a.dead && add === a.n - j0 - 1;
  }

  /**
   * One frame on the lane: the bus's pose into `out`. `push` 0..1 rolls on past the car beside it; `look` (rad from the heading, + right) picks the way at the
   * next junction. `snap` is life's snapshot (the cars, where they were at its utcMs, `ageS` s ago); `painted`, life's painted movers by key hash. False when it
   * isn't on a lane.
   */
  roll(dt: number, push: number, look: number, snap: SnapView | null, ageS: number, keys: Map<number, string>, out: CurbPose, painted: ReadonlyMap<number, unknown> | null = null, hidden: { busy: number; ghost(hash: number): number } | null = null): boolean {
    if (this.state !== 'on' || this.n < 2) return false;
    const P = this.pts, H = curbHost;
    let i = Math.min(this.i, this.n - 2);
    const road = P[i * 4 + 3];
    // (the car to pace: going the bus's way, a lane or more to the traffic's side of its line, nearest along it; with the thumb pushed, only one ahead of it.
    // And the nearest unpainted one ahead, for the glint)
    let want = road, pace: string | null = null, paceAlong = Infinity, paceV = 0, nextAlong = Infinity;
    this.next = null;
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
        const ox = px - P[bj * 4], oz = pz - P[bj * 4 + 2];
        const along = (bj - i) * 4 + (ox * sx + oz * sz) / sl - this.t, side = (-(-ox * sz + oz * sx) / sl) * this.kerb;
        this.qa.along = along;
        this.qa.side = side;
        if (side < H.sideMin || side > H.side || Math.abs(along) > H.reach2) continue;
        const hash = u32[o + Col.KEY];
        // (a car in the Parade is behind the bus, not on its row: Parade.ts)
        if (hidden && hidden.busy && hidden.ghost(hash) < 1) continue;
        if (along > 6 && along < nextAlong && !painted?.has(hash)) {
          const key = keys.get(hash) ?? null;
          if (key && !this.painted.has(key)) {
            nextAlong = along;
            this.next = key;
          }
        }
        if (push > 0.3 && along < 8) continue;
        if (Math.abs(along) < Math.abs(paceAlong)) {
          paceAlong = along;
          pace = keys.get(hash) ?? null;
          paceV = Math.hypot(vx, vz);
          want = paceV + along * H.close;
          this.at.x = px;
          this.at.y = rows[o + Col.Y];
          this.at.z = pz;
        }
      }
    }
    if (push > 0.3) want = Math.max(want, road * H.pushOver);
    // (as fast as the push, or catching up with the car to pace, up to `catchUp` m/s on it)
    want = Math.max(H.crawl, Math.min(want, Math.max(road * H.pushOver * 1.2, pace ? paceV + H.catchUp : 0)));
    this.speed += (want - this.speed) * (1 - Math.exp(-H.ease * dt));
    // (a dead end: braking to a stop at the kerb, `stopShort` m before the line's last point)
    if (this.ended) {
      let rem = -this.t;
      for (let j = i; j < this.n - 1; j++) rem += Math.hypot(P[j * 4 + 4] - P[j * 4], P[j * 4 + 6] - P[j * 4 + 2]);
      this.speed = Math.min(this.speed, Math.sqrt(2 * H.brake * Math.max(0, rem - H.stopShort)));
    }
    // (beside a car: riding with it 1.5 s paints it, once a landing)
    if (pace && Math.abs(paceAlong) < 6) {
      if (pace !== this.beside) {
        this.beside = pace;
        this.besideFor = 0;
      }
      this.besideAt = this.at;
      this.besideFor += dt;
      if (this.besideFor >= H.paintAfter && !this.painted.has(pace)) {
        this.painted.add(pace);
        this.onBeside?.(pace);
      }
    } else {
      this.beside = this.besideAt = null;
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
    if (this.pending !== 'none') return true;
    // (the look on the next junction ahead with a choice: asked again from just before it when the look turns another way than it was picked with)
    const way = Math.abs(look) > H.look ? Math.sign(look) : 0;
    if (way !== 0) {
      for (let k = 0; k < this.nj; k++) {
        const J = this.jn[k];
        if (J - H.cut < i + 2) continue;
        if (this.jl[k] !== way) {
          this.jl[k] = way;
          this.qa.turns++;
          this.askFrom(J - H.cut, look, 'turn');
        }
        break;
      }
      if (this.pending !== 'none') return true;
    }
    // (the next stretch, asked for by place before this one runs out; the look picks its first junction)
    if (!this.ended && (this.n - 1 - i) * 4 < H.ahead) this.askFrom(this.n - 1, way !== 0 ? look : 0, 'extend');
    return true;
  }

  /** Ask for the lane on from point `from` (by place: from two points before it, its way), the look turned `look` from it; joined after `from` when it comes. */
  private askFrom(from: number, look: number, kind: 'extend' | 'turn'): void {
    const P = this.pts, j = Math.max(0, from - 2), lx = P[j * 4], lz = P[j * 4 + 2], ex = P[from * 4] - lx, ez = P[from * 4 + 2] - lz, el = Math.hypot(ex, ez) || 1;
    const lh = Math.atan2(ex, -ez) + look;
    this.pending = kind;
    this.from = from;
    this.askLook = Math.abs(look) > curbHost.look ? Math.sign(look) : 0;
    this.ask(lx, lz, ex / el, ez / el, 12, this.askLook ? [Math.sin(lh), -Math.cos(lh)] : null);
  }

  private addJunction(at: number, look: number): void {
    if (this.nj >= this.jn.length) return;
    this.jn[this.nj] = at;
    this.jl[this.nj++] = look;
  }

  private ask(x: number, z: number, fx: number, fz: number, reach: number, look: [number, number] | null): void {
    this.asked = ++this.id;
    this.qa.asks++;
    this.post({ type: 'curb', id: this.asked, x, z, fx, fz, reach, length: curbHost.length, look });
  }
}
