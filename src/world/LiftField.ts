// The Lift's obstacle field (docs/specs/factions/LIFT.md, "Flight and aim"): the flight's 8 m cells over the lifted neighbourhood, rebuilt
// without the houses that float. A floating house is a deck: under it the floor is the ground (and whatever still stands on it), over it the
// floor is its roof, both where the swell has it now; one floating too low to pass under is a wall from the ground to its roof. A cell no floating house reaches is never intercepted (the City's own baked cell answers, chimneys and all), so with
// nothing up the field is exactly today's grid. Cells are built lazily, the first time a query needs one, the way the bake builds a cell
// (City.stampLift: the highest ground of a 3 x 3 sample, tree crowns, every building's parts grown 3 m, 6 m over 40 m), and kept until a
// tile under them arrives again. No three.js, no allocation in a query.

/** What a cell is built from: the City (or a Node check's own world). */
export interface FieldWorld {
  /**
   * Cell centred on (x, z), `c` m a side: its pairs (building index, its parts' highest top) from slot o, at most `max` (more: -1, and the cell is
   * left to the bake), and what stands without the buildings: the ground and the tree crowns, into rest[0].
   */
  stampLift(x: number, z: number, c: number, idx: Int32Array, top: Float32Array, o: number, max: number, rest: Float32Array): number;
}

/** The Lift's per-house state, by paint index (Lift.ts owns the arrays). */
export interface FieldHouses {
  /** 0 on the ground, 1 crouching or held, 2 up, 3 falling (a wall from the ground to its drawn top, from any side, until it lands) */
  readonly state: Uint8Array;
  /** rest height (m) */
  readonly H: Float32Array;
  /** how far the swell, the drift and the lean take any point of it off its centre's rest (m, liftReach): the launch's slab */
  readonly margin: Float32Array;
  /** how far the lean alone takes a point of it off its centre's height (m, liftTiltReach) */
  readonly tiltM: Float32Array;
  /** 1: it floats too low to pass under (LIFT_PASS): a wall from the ground up */
  readonly solid: Uint8Array;
  /** its centre (m) and its reach from it */
  readonly cx: Float32Array;
  readonly cz: Float32Array;
  readonly rad: Float32Array;
  /** the house's ground (m ASL) */
  readonly base: Float32Array;
  /** crouch start (game s) */
  readonly t0: Float32Array;
  /** gardens' and domes' tops over the house (m ASL), 0 for none */
  readonly extra: Float32Array;
  /** the flight's extra look ahead on its slab (m): a cracked square's while it sinks (absent: none) */
  readonly look?: Float32Array;
  /** game clock now (s) */
  readonly now: number;
  /** the drawn lift of a house's centre now (m) */
  dyNow(index: number): number;
  /** the drawn lift of a house at (x, z) now, its lean in it (m) */
  dyAt(index: number, x: number, z: number): number;
}

const PAIRS = 8;
/** the first 1.2 s after the launch the flight sees the launch's whole slab (the overshoot's 13 %, the swell's whole reach); after it the swell as it is */
const OVERSHOOT_FOR = 1.2;
/** the flight's look ahead on the heave (m): at most 3 m/s up or down, a frame behind the GPU and a little more */
const LOOK = 0.5;
/** the bellies counted near the bus's point, in cells each way (24 m: a belly 36 m under the bus is counted over it as its cell comes in, so the ceiling never steps), a belly d m off counted SLOPE * d m higher */
const NEAR = 3;
const SLOPE = 2;
/** the bus's body over its origin (m), less the 1 m the flight's hard clamp leaves: busShape's roof is 3.19 at 1.6 */
const BODY = 4;
/** half the bus's length (m) */
const HALF = 6;
/** a floating house is over the bus (a deck) or under it (a roof); the bus may turn to go over it until it is this near (m past HALF) */
const UNDER = 1, OVER = 2, COMMIT = 6;
/**
 * how much nearer the bus than its reach (m past HALF) the overhead can count one of a house's cells: a cell holds a house its centre is within
 * 6 m of (stampLift), and the cell's own edge is 5.66 m off its centre. The bus may turn to go under it only while its nearest cell still counts
 * its belly over the bus
 */
const CELL_SLACK = 11.7;

export class LiftField {
  readonly nx: number;
  readonly nz: number;
  private readonly built: Uint8Array;
  /** cells a floating house's bounds (grown 6 m) reach: only these are intercepted */
  private readonly reached: Uint8Array;
  private readonly rest: Float32Array;
  /** pairs a cell holds; -1: too many, the bake answers */
  private readonly cnt: Int8Array;
  private readonly pIdx: Int32Array;
  private readonly pTop: Float32Array;
  private readonly restTmp = new Float32Array(1);
  /** what the last query found: the lowest underside overhead (Infinity: none) */
  under = Infinity;

  /** cells built so far (the QA's count) */
  builtCount = 0;

  constructor(
    readonly x0: number,
    readonly z0: number,
    x1: number,
    z1: number,
    readonly c: number,
    private readonly world: FieldWorld,
    private readonly houses: FieldHouses,
  ) {
    this.nx = Math.max(1, Math.ceil((x1 - x0) / c));
    this.nz = Math.max(1, Math.ceil((z1 - z0) / c));
    const n = this.nx * this.nz;
    this.built = new Uint8Array(n);
    this.reached = new Uint8Array(n);
    this.rest = new Float32Array(n);
    this.cnt = new Int8Array(n);
    this.pIdx = new Int32Array(n * PAIRS);
    this.pTop = new Float32Array(n * PAIRS);
  }

  cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.c), j = Math.floor((z - this.z0) / this.c);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }

  /** A house went up: every cell its bounds (grown 6 m, the bake's widest reach) touch is intercepted from now on. */
  reach(x0: number, z0: number, x1: number, z1: number) {
    const c = this.c;
    const i0 = Math.max(0, Math.floor((x0 - 6 - this.x0) / c)), i1 = Math.min(this.nx - 1, Math.floor((x1 + 6 - this.x0) / c));
    const j0 = Math.max(0, Math.floor((z0 - 6 - this.z0) / c)), j1 = Math.min(this.nz - 1, Math.floor((z1 + 6 - this.z0) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.reached[j * this.nx + i] = 1;
  }

  /** A tile arrived: its cells are built again on their next query (its buildings and trees are new), and two cells round it on every side, where its buildings reach across its edges. */
  clear(x0: number, z0: number, x1: number, z1: number) {
    const c = this.c;
    const i0 = Math.max(0, Math.floor((x0 - this.x0) / c) - 2), i1 = Math.min(this.nx - 1, Math.ceil((x1 - this.x0) / c) + 2);
    const j0 = Math.max(0, Math.floor((z0 - this.z0) / c) - 2), j1 = Math.min(this.nz - 1, Math.ceil((z1 - this.z0) / c) + 2);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.built[j * this.nx + i] = 0;
  }

  /** Back to nothing up (a test's reset). */
  reset() {
    this.reached.fill(0);
    this.built.fill(0);
  }

  private ensure(k: number) {
    if (this.built[k]) return;
    const i = k % this.nx, j = (k - i) / this.nx;
    const x = this.x0 + (i + 0.5) * this.c, z = this.z0 + (j + 0.5) * this.c;
    const n = this.world.stampLift(x, z, this.c, this.pIdx, this.pTop, k * PAIRS, PAIRS, this.restTmp);
    this.cnt[k] = n;
    this.rest[k] = this.restTmp[0];
    this.built[k] = 1;
    this.builtCount++;
  }

  /**
   * Is a floating house over the bus (UNDER: a deck) or under it (OVER: a roof)? Out past its top or under its belly with the body the side is
   * plain. Between them (the bus at the height of its walls) it is decided by its middle as it first comes into the overhead's reach (24 m), and
   * kept as it comes in (`fromBus`: the overhead's, from the bus's point; any other query only reads it). The bus may still turn the way its
   * middle says while that never jolts it: over the house until it is COMMIT m past its half length off its reach (its top is then no cell under
   * the bus, so the floor eases up to it), under it only while every cell of it still counts its belly over the bus (CELL_SLACK). A side turned
   * nearer was the review's 7.85 m let-down in one step: a house heaving past the bus's height beside it, its counted belly put under the bus.
   * Forgotten 0.4 s after the overhead last looked at it.
   */
  private side(i: number, fromY: number, u: number, tp: number, fromBus: boolean): number {
    const h = this.houses;
    if (!this.sides) {
      this.sides = new Uint8Array(h.state.length);
      this.sideT = new Float32Array(h.state.length).fill(-1e9);
    }
    const mid = fromY < (u + tp) * 0.5 ? UNDER : OVER;
    const off = fromBus ? Math.max(0, Math.hypot(this.qx - h.cx[i], this.qz - h.cz[i]) - h.rad[i] - HALF) : -1;
    if (fromY > tp + 1) return this.commit(i, OVER, off);
    if (fromY + BODY + 1 < u) return this.commit(i, UNDER, off);
    const fresh = h.now - this.sideT![i] < 0.4 && this.sides[i] !== 0;
    if (!fresh) return this.commit(i, mid, off);
    if (off < 0) return this.sides[i];
    if (mid !== this.sides[i] && (mid === OVER ? off >= COMMIT : u + SLOPE * Math.max(0, off - CELL_SLACK) - BODY - 1 >= fromY)) return this.commit(i, mid, off);
    this.sideT![i] = h.now;
    return this.sides[i];
  }
  private commit(i: number, side: number, off: number): number {
    if (off >= 0) {
      this.sides![i] = side;
      this.sideT![i] = this.houses.now;
    }
    return side;
  }
  private sides: Uint8Array | null = null;
  /** the bus's point, for the overhead's queries */
  private qx = 0;
  private qz = 0;
  private sideT: Float32Array | null = null;

  /** The cell's rebuilt answer with every house on the ground (NaN: too many pairs, or off the field): the check holds it to the bake's rule. */
  rebuilt(x: number, z: number): number {
    const k = this.cellOf(x, z);
    if (k < 0) return NaN;
    this.ensure(k);
    if (this.cnt[k] < 0) return NaN;
    let solid = this.rest[k];
    for (let p = k * PAIRS, e = p + this.cnt[k]; p < e; p++) solid = Math.max(solid, this.pTop[p], this.houses.extra[this.pIdx[p]]);
    return solid;
  }

  /**
   * The obstacle at (x, z) seen from fromY (Infinity: from above), the bake's answer `baked` where nothing floats. `exact`: the house where it is
   * drawn now (the aim); else the flight's conservative slab (its rest height, the bob's whole reach, the overshoot just after the launch).
   * A floating house is seen from below by anything under its middle (a deck: its underside goes in `under`), from above by anything over it
   * (a roof: its top is the obstacle), and by the side the bus kept as it came in (side()). Sets `under`, the lowest underside of the houses seen
   * from below there (Infinity: none). `fromBus`: the overhead's, from the bus's point (qx, qz).
   */
  query(x: number, z: number, fromY: number, baked: number, exact: boolean, fromBus = false): number {
    this.under = Infinity;
    const k = this.cellOf(x, z);
    if (k < 0 || !this.reached[k]) return baked;
    this.ensure(k);
    const n = this.cnt[k];
    if (n < 0) return baked;
    const h = this.houses;
    let solid = this.rest[k], under = Infinity, top = -Infinity, any = false, tallest = -Infinity, tallGround = -Infinity;
    for (let p = k * PAIRS, e = p + n; p < e; p++) {
      const i = this.pIdx[p];
      const t = Math.max(this.pTop[p], h.extra[i]);
      if (t > tallest) tallest = t;
      if (h.state[i] === 3) {
        // (falling: a wall from the ground to its drawn top and the look ahead, from any side; its top only comes down)
        any = true;
        const tp = t + h.dyNow(i) + h.tiltM[i] + LOOK;
        if (tp > top) top = tp;
        continue;
      }
      if (h.state[i] !== 2) {
        if (t > solid) solid = t;
        if (t > tallGround) tallGround = t;
        continue;
      }
      any = true;
      let u: number, tp: number;
      if (exact) {
        const dy = h.dyAt(i, x, z);
        u = h.base[i] + dy;
        tp = t + dy;
      } else if (h.now - h.t0[i] < OVERSHOOT_FOR + 0.3) {
        // (the launch: its whole slab, the overshoot and the swell's reach)
        const m = h.margin[i];
        u = h.base[i] + h.H[i] - m;
        tp = t + h.H[i] * 1.14 + m;
      } else {
        // (riding the swell: where its centre is now, the lean's reach and a look ahead either side)
        const dy = h.dyNow(i), m = h.tiltM[i] + LOOK + (h.look ? h.look[i] : 0);
        u = h.base[i] + dy - m;
        tp = t + dy + m;
      }
      if (h.solid[i]) {
        // (too low to pass under: a wall from the ground to its roof, from any side, as a grounded house is)
        if (tp > top) top = tp;
        continue;
      }
      // (by its middle: a bus pulled up under one house and come to a lower one is under that one too, never put on its roof through it. And by
      // the side the bus chose while it was still far: see side())
      if (this.side(i, fromY, u, tp, fromBus) === UNDER) {
        if (u < under) under = u;
      } else if (tp > top) top = tp;
    }
    if (!any) return baked;
    // (the cell's tallest still on the ground: the bake's answer holds, the detailed roofs' chimneys and parapets with it. Where a floating house
    // is the tallest, the bake's answer is its, but its grounded neighbours' chimneys and parapets stand up to 6 m over the rebuild's tops)
    solid = tallGround >= tallest ? Math.max(solid, baked) : Math.max(solid, Math.min(baked, tallGround + 6));
    this.under = under;
    return Math.max(solid, top);
  }

  /**
   * The flight's underside over (x, z) seen from fromY: the lowest belly over the bus (its point, its nose or its tail) or near, a belly d m past those counted 2d m higher (so the bus under one
   * house is let down to a lower one ahead before it gets there, at no step), less the bus's body (it is clamped 1 m under this, its roof 5 m up).
   */
  overhead(x: number, z: number, fromY: number): number {
    const c = this.c, i0 = Math.floor((x - this.x0) / c), j0 = Math.floor((z - this.z0) / c);
    let best = Infinity;
    this.qx = x;
    this.qz = z;
    for (let dj = -NEAR; dj <= NEAR; dj++) {
      const j = j0 + dj;
      if (j < 0 || j >= this.nz) continue;
      const cz0 = this.z0 + j * c, dz = Math.max(cz0 - z, 0, z - cz0 - c);
      for (let di = -NEAR; di <= NEAR; di++) {
        const i = i0 + di;
        if (i < 0 || i >= this.nx || !this.reached[j * this.nx + i]) continue;
        const cx0 = this.x0 + i * c, dd = Math.hypot(Math.max(cx0 - x, 0, x - cx0 - c), dz);
        if (dd >= NEAR * c) continue;
        // (the bus's nose and tail are 6 m off its point: a belly over either is over the bus)
        const d = Math.max(0, dd - HALF);
        this.query(cx0 + c * 0.5, cz0 + c * 0.5, fromY, 0, false, true);
        if (this.under + SLOPE * d < best) best = this.under + SLOPE * d;
      }
    }
    this.under = best === Infinity ? Infinity : best - BODY;
    return this.under;
  }

}
