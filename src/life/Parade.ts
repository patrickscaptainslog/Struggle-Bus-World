// Parade (SHOTS.md, "The shots": "A fourth, Parade, has cars you paint from the street honk and fall in behind you, up to six"), the host's side, with nothing
// in the worker: a car the player's paint lands on while the bus rolls on the street (Curb) leaves its road with a honk and a leap, and rolls nose to tail behind
// the bus along the way the bus went, bouncing in a wave, until the bus leaves the street. Then the line rolls to a stop, waits, and each car pops away and is
// back on its own road. The worker's row for a car in the line is hidden while it is (`ghost`), and the car is drawn from its row here.
//   life.paradeOn(host)     once, from main.ts's life block
//   ask(hash, faction)      Life.land: a hit's paint has landed on a mover
//   lead(pose)              Life.curbRoll: the bus on the street this frame
//   tick(dt, …)             Life.frame, after the frame's hits have landed
// Nothing here allocates after the constructor.
import type { CurbPose } from './Curb';
import { ownerOf } from '../game/factions';
import { Col, Kind, KINDS, ROW, TRUCK_LEN } from './kinds';
import type { MoverPaint } from './Life';
import type { SnapView } from './snapshot';

export const paradeTune = {
  /** cars in the line at the most (the ruling's six) */
  most: 6,
  /** a painted car this near the bus falls in (m): a tap's whole circle beside the bus, not a car a street away */
  reach: 120,
  /** between bumpers, and between the bus's tail and the first (m) */
  gap: 3,
  /** the leap into the line: its time (s, and more a metre of the way), its top over the straight way (m, and more a metre of the way), its nose up then down (rad) */
  join: 0.9,
  joinPer: 0.006,
  hop: 1.6,
  hopPer: 0.09,
  nose: 0.42,
  /** cars one breath paints leap this far apart (s), each honking as it goes */
  beat: 0.14,
  /** the line's bounce is a wave: each car this share of a beat behind the one ahead */
  wave: 0.17,
  /** the bus's way is kept a point every this many m */
  step: 2,
  /** off the street this long (s), the bus has left it: the next roll is a new landing, and paint landing after it calls no car */
  grace: 0.3,
  /** left, the line rolls on to a stop over about `coast` s and waits `linger`; then each car pops away over `out` s, `outBeat` after the one ahead, and is back on its own road, grown over `back` s */
  coast: 0.5,
  linger: 2.5,
  out: 0.5,
  outBeat: 0.12,
  back: 0.8,
  /** a seventh car only honks, low, and no oftener than this (s) */
  honkGap: 0.5,
};

/** What the Parade needs of the game (main.ts's life block). */
export interface ParadeHost {
  /** the player's faction: only its paint calls a car in */
  faction(): number;
  /** the bus's tail behind its middle (m) */
  tail: number;
  /** a car's honk as it falls in: `n` its place in the line from 0, or -1 a seventh with the line full; `seed` its key's low byte */
  honk(n: number, seed: number): void;
}

/** Slots: the line's six, and six more still popping away from a line the bus left for a new street. */
const SLOTS = 12;
/** The bus's way, kept: 256 m of it, the longest line (six semis) and room */
const CRUMBS = 128;
/** Cars asked for in one frame at the most (a tap's circle) */
const ASKS = 16;
const FREE = 0, LEAP = 1, LINE = 2, OUT = 3, BACK = 4;
/** A slot's start: x, y, z, heading, pitch, then its velocity (x, y, z) */
const F = 8;

export class LifeParade {
  /** The cars' own rows, a snapshot's row each (kinds.ts Col), slot by slot: what Life draws a car in the line from. */
  readonly rows = new Float32Array(SLOTS * ROW);
  readonly u32 = new Uint32Array(this.rows.buffer);
  readonly slots = SLOTS;
  /** slots in use: in the line, popping away, or growing back on their own road */
  busy = 0;
  /** cars in the line, the leaping ones too */
  count = 0;
  readonly qa = { joined: 0, honks: 0, full: 0, left: 0, landings: 0 };
  private readonly phase = new Uint8Array(SLOTS);
  /** s into its phase; under 0, a leap or a pop waiting its turn */
  private readonly t = new Float32Array(SLOTS);
  private readonly dur = new Float32Array(SLOTS);
  private readonly honked = new Uint8Array(SLOTS);
  private readonly place = new Uint8Array(SLOTS);
  /** its middle behind the bus's, along the bus's way (m) */
  private readonly dist = new Float32Array(SLOTS);
  /** its length before its scale (m), and its scale */
  private readonly long = new Float32Array(SLOTS);
  private readonly size = new Float32Array(SLOTS);
  private readonly from = new Float32Array(SLOTS * F);
  /** its paint as it joined: what it wears if life's record of it goes */
  private readonly paints: MoverPaint[] = [];
  private readonly asks = new Uint32Array(ASKS);
  private readonly askO = new Int32Array(ASKS);
  private readonly askD = new Float32Array(ASKS);
  private nAsks = 0;
  /** the bus's way: a point every `step` m (x, y, z) and the way's length at each, a ring, `head` the newest; then the bus itself */
  private readonly cr = new Float32Array(CRUMBS * 3);
  private readonly cs = new Float64Array(CRUMBS);
  private head = 0;
  private n = 0;
  private laid = 0;
  private hx = 0;
  private hy = 0;
  private hz = 0;
  private hs = 0;
  private hv = 0;
  private ux = 0;
  private uz = -1;
  /** the way the bus came in at its landing, and the road's grade there: where the line stands before the bus has gone its length */
  private bx = 0;
  private bz = -1;
  private bg = 0;
  private led = false;
  /** s since the bus was last on the street */
  private away = Infinity;
  /** the line's end behind the bus's middle (m) */
  private end = 0;
  private clock = 0;
  private nextAt = 0;
  private honkT = -Infinity;
  /** scratch: a point of the way, and a slot's pose in the line */
  private px = 0;
  private py = 0;
  private pz = 0;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private lh = 0;
  private lp = 0;

  private readonly host: ParadeHost;

  constructor(host: ParadeHost) {
    this.host = host;
    for (let j = 0; j < SLOTS; j++) this.paints.push({ hue: 0, level: 0, at: 0, faction: 0, show: undefined });
  }

  /** The bus on the street this frame (Curb's pose: its middle on its lane). The first after a while off it is a new landing: the old line pops away where it stands. */
  lead(p: CurbPose): void {
    if (!this.n || this.away > paradeTune.grace) this.landed(p);
    this.led = true;
    this.away = 0;
    this.ux = Math.sin(p.heading);
    this.uz = -Math.cos(p.heading);
    this.hv = p.speed;
    this.move(p.x, p.y, p.z);
  }

  /** A hit's paint has landed on mover `hash`, `faction`'s. On the street, the player's own calls it in at the next tick. */
  ask(hash: number, faction: number): void {
    if (!this.n || this.away > paradeTune.grace || this.nAsks >= ASKS || faction !== ownerOf(this.host.faction())) return;
    this.asks[this.nAsks++] = hash;
  }

  /** One frame. `snap` is life's snapshot, `ageS` s old; `painted`, life's painted movers by key hash. */
  tick(dt: number, snap: SnapView | null, ageS: number, painted: ReadonlyMap<number, MoverPaint>): void {
    const T = paradeTune, R = this.rows, from = this.from;
    this.clock += dt;
    if (!this.led) this.away += dt;
    const rolled = this.led;
    this.led = false;
    if (this.nAsks) {
      if (snap) this.take(snap, ageS, painted);
      this.nAsks = 0;
    }
    if (!this.busy) return;
    // (the bus gone: the line rolls on to a stop)
    if (!rolled && this.count && this.hv > 0.05) {
      this.hv *= Math.exp(-dt / T.coast);
      this.move(this.hx + this.ux * this.hv * dt, this.hy, this.hz + this.uz * this.hv * dt);
    }
    const gone = this.away > T.linger;
    for (let j = 0; j < SLOTS; j++) {
      const ph = this.phase[j];
      if (ph === FREE) continue;
      const o = j * ROW, f = j * F, t = (this.t[j] += dt);
      if (ph === BACK) {
        if (t >= T.back) {
          this.phase[j] = FREE;
          this.u32[o + Col.KEY] = 0;
          this.busy--;
        }
        continue;
      }
      if (ph === OUT) {
        // (a twirl up and away, after the one ahead)
        if (t < 0) continue;
        const e = Math.min(1, t / T.out);
        R[o + Col.HEADING] += 10 * dt;
        R[o + Col.Y] = from[f + 1] + 1.2 * e;
        R[o + Col.SCALE] = this.size[j] * (1 - e * e);
        if (e >= 1) {
          this.phase[j] = BACK;
          this.t[j] = 0;
          this.qa.left++;
        }
        continue;
      }
      if (gone) {
        this.leave(j, this.place[j] * T.outBeat);
        continue;
      }
      if (ph === LEAP && t < 0) {
        // (waiting its turn: on its own way still)
        R[o + Col.X] = from[f] += from[f + 5] * dt;
        R[o + Col.Y] = from[f + 1] += from[f + 6] * dt;
        R[o + Col.Z] = from[f + 2] += from[f + 7] * dt;
        continue;
      }
      this.pose(j);
      if (ph === LINE) {
        R[o + Col.X] = this.lx;
        R[o + Col.Y] = this.ly;
        R[o + Col.Z] = this.lz;
        R[o + Col.HEADING] = this.lh;
        R[o + Col.PITCH] = this.lp;
        continue;
      }
      if (!this.honked[j]) {
        this.honked[j] = 1;
        this.qa.honks++;
        this.host.honk(this.place[j], this.u32[o + Col.KEY] & 255);
      }
      // (the leap: from where it was to its place in the line, wherever that has rolled to, over an arc, nose up and then down)
      const u = Math.min(1, t / this.dur[j]), e = u * u * (3 - 2 * u);
      const x0 = from[f], y0 = from[f + 1], z0 = from[f + 2], d = Math.hypot(this.lx - x0, this.lz - z0);
      let turn = (this.lh - from[f + 3]) % (2 * Math.PI);
      if (turn > Math.PI) turn -= 2 * Math.PI;
      else if (turn < -Math.PI) turn += 2 * Math.PI;
      R[o + Col.X] = x0 + (this.lx - x0) * e;
      R[o + Col.Y] = y0 + (this.ly - y0) * e + 4 * (T.hop + T.hopPer * d) * u * (1 - u);
      R[o + Col.Z] = z0 + (this.lz - z0) * e;
      R[o + Col.HEADING] = from[f + 3] + turn * e;
      R[o + Col.PITCH] = from[f + 4] + (this.lp - from[f + 4]) * e + T.nose * Math.sin(2 * Math.PI * u);
      if (u >= 1) {
        this.phase[j] = LINE;
        this.t[j] = 0;
      }
    }
  }

  /** How much of mover `hash`'s own row to draw: 1 not in the Parade, 0 in the line (the Parade draws it), between as it grows back on its road. Ask only while `busy`. */
  ghost(hash: number): number {
    const u = this.u32;
    for (let j = 0; j < SLOTS; j++) {
      if (u[j * ROW + Col.KEY] !== hash || this.phase[j] === FREE) continue;
      if (this.phase[j] !== BACK) return 0;
      const k = Math.max(0, 1 - this.t[j] / paradeTune.back);
      return 1 - k * k;
    }
    return 1;
  }

  /** Slot `j` is drawn from its row here: leaping, in the line or popping away. */
  shown(j: number): boolean {
    const ph = this.phase[j];
    return ph === LEAP || ph === LINE || ph === OUT;
  }

  /** Slot `j` rolls in the line: it bounces and leaves tracks. */
  rolling(j: number): boolean {
    return this.phase[j] === LINE;
  }

  /** Slot `j`'s share of the bounce's beat: the wave down the line. */
  beat(j: number): number {
    return 8 - this.place[j] * paradeTune.wave;
  }

  /** Slot `j`'s length before its scale (m). */
  longOf(j: number): number {
    return this.long[j];
  }

  /** Slot `j`'s paint: life's record of it `now`, or what it joined in. */
  paintOf(j: number, now: MoverPaint | undefined): MoverPaint {
    return now ?? this.paints[j];
  }

  /** Slot `j`'s phase, for the tools: 0 free, 1 leaping, 2 in the line, 3 popping away, 4 growing back on its own road. */
  phaseOf(j: number): number {
    return this.phase[j];
  }

  /** Slot `j`'s place in the line from 0, for the tools. */
  placeOf(j: number): number {
    return this.place[j];
  }

  reset(): void {
    this.phase.fill(FREE);
    this.u32.fill(0);
    this.busy = this.count = this.nAsks = this.n = 0;
    this.away = Infinity;
    this.led = false;
  }

  /** A new landing: the old line pops away where it stands, and the way starts again under the bus. */
  private landed(p: CurbPose): void {
    for (let j = 0; j < SLOTS; j++) if (this.phase[j] === LEAP || this.phase[j] === LINE) this.leave(j, this.place[j] * paradeTune.outBeat);
    this.count = 0;
    this.end = this.host.tail;
    this.nextAt = 0;
    this.head = 0;
    this.n = this.laid = 1;
    this.hx = this.cr[0] = p.x;
    this.hy = this.cr[1] = p.y;
    this.hz = this.cr[2] = p.z;
    this.hs = this.cs[0] = 0;
    this.bx = Math.sin(p.heading);
    this.bz = -Math.cos(p.heading);
    this.bg = 0;
    this.qa.landings++;
  }

  /** The bus to (x, y, z): its way grows by the step, a point laid every `step` m. */
  private move(x: number, y: number, z: number): void {
    const dx = x - this.hx, dz = z - this.hz;
    this.hs += Math.sqrt(dx * dx + dz * dz);
    this.hx = x;
    this.hy = y;
    this.hz = z;
    if (this.hs - this.cs[this.head] < paradeTune.step) return;
    const was = this.head;
    this.head = (was + 1) % CRUMBS;
    if (this.n < CRUMBS) this.n++;
    const q = this.head * 3;
    this.cr[q] = x;
    this.cr[q + 1] = y;
    this.cr[q + 2] = z;
    this.cs[this.head] = this.hs;
    // (the road's grade where the bus landed, from its first step: the line behind the landing stands on it)
    if (this.laid++ === 1) this.bg = (y - this.cr[was * 3 + 1]) / (this.hs - this.cs[was]);
  }

  /** The point `d` m behind the bus along its way, into px, py, pz: past the oldest point kept, straight on back the way it came in, on the grade there. */
  private at(d: number): void {
    const s = this.hs - d, C = this.cr, S = this.cs;
    let i = this.head, x1 = this.hx, y1 = this.hy, z1 = this.hz, s1 = this.hs;
    for (let k = 0; k < this.n; k++) {
      const q = i * 3, s0 = S[i];
      if (s >= s0) {
        const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
        this.px = C[q] + (x1 - C[q]) * f;
        this.py = C[q + 1] + (y1 - C[q + 1]) * f;
        this.pz = C[q + 2] + (z1 - C[q + 2]) * f;
        return;
      }
      x1 = C[q];
      y1 = C[q + 1];
      z1 = C[q + 2];
      s1 = s0;
      i = (i + CRUMBS - 1) % CRUMBS;
    }
    const back = s1 - s;
    this.px = x1 - this.bx * back;
    this.py = y1 - this.bg * back;
    this.pz = z1 - this.bz * back;
  }

  /** Slot `j`'s pose in the line, into lx, ly, lz, lh (a row's heading) and lp: its middle between two points of the way, a wheelbase apart, so it turns as the way does. */
  private pose(j: number): void {
    const a = 0.3 * this.long[j] * this.size[j], d = this.dist[j];
    this.at(d - a);
    const fx = this.px, fy = this.py, fz = this.pz;
    this.at(d + a);
    const dx = fx - this.px, dy = fy - this.py, dz = fz - this.pz, run = Math.sqrt(dx * dx + dz * dz);
    this.lx = (fx + this.px) / 2;
    this.ly = (fy + this.py) / 2;
    this.lz = (fz + this.pz) / 2;
    this.lh = run > 1e-3 ? Math.atan2(dz, dx) : Math.atan2(this.uz, this.ux);
    this.lp = run > 1e-3 ? Math.atan2(dy, run) : 0;
  }

  /** Slot `j` out of the line: it pops away after `wait` s, from where it is. */
  private leave(j: number, wait: number): void {
    this.phase[j] = OUT;
    this.t[j] = -wait;
    this.from[j * F + 1] = this.rows[j * ROW + Col.Y];
    if (--this.count <= 0) {
      this.count = 0;
      this.end = this.host.tail;
    }
  }

  /** The frame's asks: each one's car in the snapshot, within reach of the bus, the nearest first. */
  private take(s: SnapView, ageS: number, painted: ReadonlyMap<number, MoverPaint>): void {
    const rows = s.rows, u32 = s.rowsU32, n = s.u32[2], A = this.asks, O = this.askO, D = this.askD, m = this.nAsks, reach = paradeTune.reach;
    for (let k = 0; k < m; k++) O[k] = -1;
    for (let i = 0; i < n; i++) {
      const o = i * ROW, kind = rows[o + Col.KIND];
      if (kind !== Kind.CAR && kind !== Kind.TRUCK) continue;
      const h = u32[o + Col.KEY];
      for (let k = 0; k < m; k++) {
        if (A[k] !== h || O[k] >= 0) continue;
        const dx = rows[o + Col.X] + rows[o + Col.VX] * ageS - this.hx, dz = rows[o + Col.Z] + rows[o + Col.VZ] * ageS - this.hz;
        O[k] = o;
        D[k] = dx * dx + dz * dz;
        break;
      }
    }
    for (;;) {
      let k = -1;
      for (let i = 0; i < m; i++) if (O[i] >= 0 && (k < 0 || D[i] < D[k])) k = i;
      if (k < 0 || D[k] > reach * reach) return;
      const paint = painted.get(A[k]);
      if (paint) this.join(rows, u32, O[k], ageS, Math.sqrt(D[k]), paint);
      O[k] = -1;
    }
  }

  /** The car at row `o`, `d` m from the bus, falls in: the line's next place, or with the line full only a honk. */
  private join(rows: Float32Array, u32: Uint32Array, o: number, ageS: number, d: number, paint: MoverPaint): void {
    const T = paradeTune, h = u32[o + Col.KEY], R = this.rows;
    for (let j = 0; j < SLOTS; j++) if (this.phase[j] !== FREE && this.u32[j * ROW + Col.KEY] === h) return;
    if (this.count >= T.most) {
      this.qa.full++;
      if (this.clock - this.honkT >= T.honkGap) {
        this.honkT = this.clock;
        this.host.honk(-1, h & 255);
      }
      return;
    }
    let j = 0;
    while (j < SLOTS && this.phase[j] !== FREE) j++;
    if (j === SLOTS) return;
    // (its row, bit for bit: a key copied as a float can change)
    const q = j * ROW, f = j * F, from = this.from, kind = rows[o + Col.KIND];
    for (let c = 0; c < ROW; c++) this.u32[q + c] = u32[o + c];
    from[f] = R[q + Col.X] = rows[o + Col.X] + rows[o + Col.VX] * ageS;
    from[f + 1] = R[q + Col.Y] = rows[o + Col.Y] + rows[o + Col.VY] * ageS;
    from[f + 2] = R[q + Col.Z] = rows[o + Col.Z] + rows[o + Col.VZ] * ageS;
    from[f + 3] = rows[o + Col.HEADING];
    from[f + 4] = rows[o + Col.PITCH];
    from[f + 5] = rows[o + Col.VX];
    from[f + 6] = rows[o + Col.VY];
    from[f + 7] = rows[o + Col.VZ];
    R[q + Col.VX] = R[q + Col.VY] = R[q + Col.VZ] = R[q + Col.BANK] = 0;
    this.long[j] = kind === Kind.TRUCK ? TRUCK_LEN[(rows[o + Col.LOOK] & 7) % 5] : KINDS[kind].size;
    this.size[j] = rows[o + Col.SCALE];
    const L = this.long[j] * this.size[j], P = this.paints[j];
    P.hue = paint.hue;
    P.level = paint.level;
    P.at = paint.at;
    P.faction = paint.faction;
    P.show = paint.show;
    this.dist[j] = this.end + T.gap + L / 2;
    this.end = this.dist[j] + L / 2;
    this.place[j] = this.count++;
    this.busy++;
    this.phase[j] = LEAP;
    this.honked[j] = 0;
    this.dur[j] = T.join + T.joinPer * d;
    // (after the one before it, a beat on)
    const start = Math.max(this.clock, this.nextAt);
    this.nextAt = start + T.beat;
    this.t[j] = this.clock - start;
    this.qa.joined++;
  }
}
