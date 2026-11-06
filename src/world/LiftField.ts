// The Lift's obstacle field (docs/specs/factions/LIFT.md, "Flight and aim"): the flight's 8 m cells over the lifted neighbourhood, rebuilt
// without the houses that float. A floating house is a deck: under it the floor is the ground (and whatever still stands on it), over it the
// floor is its roof. A cell no floating house reaches is never intercepted (the City's own baked cell answers, chimneys and all), so with
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
  /** 0 on the ground, 1 crouching or held, 2 up */
  readonly state: Uint8Array;
  /** rest height (m) */
  readonly H: Float32Array;
  /** the bob's reach margin (m): 1.3 * amp + 0.3 */
  readonly margin: Float32Array;
  /** the house's ground (m ASL) */
  readonly base: Float32Array;
  /** crouch start (game s) */
  readonly t0: Float32Array;
  /** gardens' and domes' tops over the house (m ASL), 0 for none */
  readonly extra: Float32Array;
  /** game clock now (s) */
  readonly now: number;
  /** the drawn lift of a house now (m) */
  dyNow(index: number): number;
}

const PAIRS = 8;
/** the first 1.2 s after the launch the overshoot (13 %) is in the conservative top */
const OVERSHOOT_FOR = 1.2;

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

  /** A tile arrived: its cells are built again on their next query (its buildings and trees are new). */
  clear(x0: number, z0: number, x1: number, z1: number) {
    const c = this.c;
    const i0 = Math.max(0, Math.floor((x0 - this.x0) / c)), i1 = Math.min(this.nx - 1, Math.ceil((x1 - this.x0) / c));
    const j0 = Math.max(0, Math.floor((z0 - this.z0) / c)), j1 = Math.min(this.nz - 1, Math.ceil((z1 - this.z0) / c));
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
   * Sets `under`, the lowest underside over fromY there (Infinity: none).
   */
  query(x: number, z: number, fromY: number, baked: number, exact: boolean): number {
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
      if (h.state[i] !== 2) {
        if (t > solid) solid = t;
        if (t > tallGround) tallGround = t;
        continue;
      }
      any = true;
      let u: number, tp: number;
      if (exact) {
        const dy = h.dyNow(i);
        u = h.base[i] + dy;
        tp = t + dy;
      } else {
        const m = h.margin[i];
        u = h.base[i] + h.H[i] - m;
        tp = t + h.H[i] * (h.now - h.t0[i] < OVERSHOOT_FOR + 0.3 ? 1.14 : 1) + m;
      }
      if (u < under) under = u;
      if (tp > top) top = tp;
    }
    if (!any) return baked;
    // (the cell's tallest still on the ground: the bake's answer holds, the detailed roofs' chimneys and parapets with it)
    if (tallGround >= tallest) solid = Math.max(solid, baked);
    if (under > fromY) this.under = under;
    return fromY >= under ? Math.max(solid, top) : solid;
  }
}
