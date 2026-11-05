import { dotAt, decodeMask, encodeMask, GROUND_N, splatAt, TEXELS, type Prepared } from './groundMask';
import type { BlastSpec } from '../game/blastLayout';

// ?moon: the Moon's open-ground paint, kept by place, whatever map it was painted on (GroundPaint.useGeo). DECISIONS.md, "The third review: the pictures' blocker and majors".
//
// Pictures, PIC_DEG degrees of latitude a side (151.6 m) and as wide on the ground in longitude, GROUND_N texels a side, about 1.2 m. Within CAP_LAT of a pole they're laid flat round the pole
// instead, in metres (azimuthal, as the map is), the same size, so near a pole a blast reaches a handful, never every longitude. A picture is made where paint lands, and nowhere else.
//
// A blast that lands is queued (add) and drawn into its pictures a little each frame (work), straight from its prepared shape at each texel's place, so nothing of it runs on the frame of its
// impact; the live tiles have shown it from the first. A tile's paint is copied out of the pictures before the tile takes ground of its own (want, then onPrepared), a little each frame, so a
// painted region coming back stops no frame and pops nothing in. Pending blasts are kept by place, and drawn again on the map as it is when their turn comes.
//
// The pictures are kept in a store (PicStore): IndexedDB in the browser, by bytes, BUDGET of them, the longest untouched going first; only what's being drawn or read is in memory. What isn't
// written yet when the page is hidden goes into a small journal in localStorage, synchronously, and into the store at the next boot.

const DEG = Math.PI / 180;
const R_M = 1737400;
const N = GROUND_N;
/** A picture's side: degrees of latitude, and metres. */
export const PIC_DEG = 0.005;
const PIC_M = PIC_DEG * DEG * R_M;
/** Past this latitude, either way, the pole's own grid. */
const CAP_LAT = 88;
const CAP_R = (90 - CAP_LAT) * DEG * R_M;
/** Rows of the grid by latitude, and the last one short of the cap each way. */
const ROW_MAX = Math.round(CAP_LAT / PIC_DEG) - 1;
/**
 * The store's size, bytes of coded pictures: about four hours of painting at Jet low, flying on and breathing every 2.6 s, 15 MB an hour (tools/moon/paint-check.mjs, "hours"), more
 * at slower gears and less from high up, where a breath is bigger. Past it the longest untouched go.
 */
export const BUDGET = 64 * 1024 * 1024;
/** What's open in memory at most, beyond what a blast or a tile is drawing: 64 KB a picture. */
const OPEN = 96;
/** Closed pictures' texels kept for new ones. */
const FREE = 32;
/** Pictures evicted a write at most, the rest at the writes after (one a second while over the budget). */
const EVICT = 400;
/** ms a frame for all of it: tiles' paint copied out, blasts drawn in and what's changed coded for the store (Node's ms: a phone's page takes two or three times them). */
const WORK_MS = 2;
/** No step starts in the last of it: a step's first work (a MEGA's pictures found, a picture coded) is about this. */
const STEP_MS = 0.3;
/** s between writes to the store. */
const FLUSH_S = 1;
/** The journal: what the page hadn't written when it was hidden (localStorage, synchronous). */
const JOURNAL = 'strugglebus.moonpaint.journal.v1';

/** ?moon: the map's x, z (m) and the Moon's latitude and longitude (degrees), each into `out`, on the map as it is when asked. */
export interface GroundGeo {
  toLatLon(x: number, z: number, out: number[]): void;
  toXZ(lat: number, lon: number, out: number[]): void;
}

/** Where the pictures are kept: every picture's time and size at open, and its code by key. */
export interface PicStore {
  load(): Promise<Map<number, [number, number]>>;
  get(keys: number[]): Promise<Map<number, string>>;
  put(rows: Array<[number, number, string]>): Promise<void>;
  remove(keys: number[]): Promise<void>;
  clear(): Promise<void>;
}

/** A row's width in longitude, degrees, and its columns. */
const lonW = (i: number) => PIC_DEG / Math.cos((i + 0.5) * PIC_DEG * DEG);
const cols = (i: number) => Math.ceil(360 / lonW(i));
const lon360 = (lon: number) => (((lon + 180) % 360) + 360) % 360;
const rcKey = (i: number, j: number) => (i + 20000) * 100000 + j;
const CAP_KEY = 5e9;
const capKey = (south: boolean, pi: number, pj: number) => CAP_KEY + (south ? 1e7 : 0) + (pi + 1000) * 2000 + (pj + 1000);

/** A point's picture and texel. */
interface Spot {
  key: number;
  a: number;
  b: number;
}
function locate(lat: number, lon: number, o: Spot): void {
  if (Math.abs(lat) >= CAP_LAT) {
    const rho = (90 - Math.abs(lat)) * DEG * R_M, L = lon * DEG, px = (rho * Math.cos(L)) / PIC_M, py = (rho * Math.sin(L)) / PIC_M;
    const pi = Math.floor(px), pj = Math.floor(py);
    o.key = capKey(lat < 0, pi, pj);
    o.a = Math.min(N - 1, Math.floor((px - pi) * N));
    o.b = Math.min(N - 1, Math.floor((py - pj) * N));
    return;
  }
  const i = Math.floor(lat / PIC_DEG), w = lonW(i), L = lon360(lon) / w, j = Math.min(cols(i) - 1, Math.floor(L));
  o.key = rcKey(i, j);
  o.a = Math.min(N - 1, Math.floor((L - j) * N));
  o.b = Math.min(N - 1, Math.floor((lat / PIC_DEG - i) * N));
}

/** A picture's corner (u, v of 0..1 along its sides) as latitude and longitude. */
function cornerOf(key: number, u: number, v: number, o: number[]): void {
  if (key >= CAP_KEY) {
    const k = key - CAP_KEY, south = k >= 1e7, r = south ? k - 1e7 : k, pi = Math.floor(r / 2000) - 1000, pj = (r % 2000) - 1000;
    const px = (pi + u) * PIC_M, py = (pj + v) * PIC_M, rho = Math.hypot(px, py);
    o[0] = (south ? -1 : 1) * (90 - rho / (DEG * R_M));
    o[1] = Math.atan2(py, px) / DEG;
    return;
  }
  const i = Math.floor(key / 100000) - 20000, j = key % 100000;
  o[0] = (i + v) * PIC_DEG;
  o[1] = (j + u) * lonW(i) - 180;
}

/** Two codes of one picture, as one: at each texel the newer's paint where it has any as much as the older's, the older's elsewhere. Rows of [key, time, code]. */
function merged(x: [number, number, string], y: [number, number, string]): [number, number, string] {
  const [o, n] = x[1] <= y[1] ? [x, y] : [y, x], a = new Uint8Array(TEXELS * 4), b = new Uint8Array(TEXELS * 4);
  if (!decodeMask(o[2], a)) return n;
  if (!decodeMask(n[2], b)) return o;
  for (let t = 0; t < a.length; t += 4)
    if (b[t] && (b[t] >= 128 || b[t] >= a[t])) {
      a[t] = b[t];
      a[t + 1] = b[t + 1];
    }
  return [n[0], n[1], encodeMask(a) || n[2]];
}

/** A picture open in memory: its texels as a mask's (coverage, hue), changed since it was written, when it was last painted, and what's drawing it. */
interface Pic {
  data: Uint8Array;
  dirty: boolean;
  t: number;
  pins: number;
}

/** A blast waiting to be drawn into its pictures: its spec as it landed, kept by place, and where it's got to. */
interface Fold {
  spec: BlastSpec;
  lat: number;
  lon: number;
  olat: number | null;
  olon: number | null;
  /** the map it was last made ready on, and that */
  frame: number;
  p: Prepared;
  /** the pictures it reaches, found at its first step */
  keys: number[] | null;
  at: number;
  phase: 0 | 1;
  /** in the picture at `at`: the row of its splat, or the dot, to go on from */
  row: number;
  /** its stored pictures asked for, all in one read */
  asked?: boolean;
}

/** A tile whose paint is being copied out: its key on the map, its corner, and the pictures under it. */
interface Copy {
  key: string;
  ox: number;
  oz: number;
  keys: number[];
  /** once its pictures are in: them, its corners' latitudes and longitudes, its texels so far and the row it's got to */
  pics: Map<number, Uint8Array> | null;
  C: number[];
  polar: boolean;
  d: Uint8Array | null;
  j: number;
  any: boolean;
}

export class GeoPaint {
  /** every picture the store holds: when painted (Date.now()) and its code's size */
  private readonly index = new Map<number, { t: number; bytes: number }>();
  private bytes = 0;
  private readonly open = new Map<number, Pic>();
  private readonly loading = new Set<number>();
  private readonly folds: Fold[] = [];
  private readonly copies: Copy[] = [];
  private readonly copying = new Set<string>();
  /** the index read: before that nothing can say what's painted */
  ready = false;
  /**
   * The journal's blasts as the boot finds them, once they're folds: the tiles in before the store was read asked for their paint early and found no folds over
   * them, and come in under the pictures alone, so they're told. Review five, 40
   */
  onJournal: ((blasts: BlastSpec[]) => void) | null = null;
  private frame = 0;
  private flushIn = FLUSH_S;
  private writing = false;
  /** pictures changed and waiting to be coded, a few a frame; what's coded and not yet sent; what's being written */
  private coding: number[] = [];
  private coded: Array<[number, number, string]> = [];
  private sent: Array<[number, number, string]> = [];
  /** tiles that asked for their paint before the store was read */
  private readonly early = new Map<string, [number, number]>();
  /** closed pictures' texels, for the next made */
  private readonly free: Uint8Array[] = [];
  /** writes failed in a row, and the store's size, which they bring down */
  private fails = 0;
  private budget = BUDGET;
  /** a journal's been left (persist), and the page lived on */
  private journal = false;
  private readonly spot: Spot = { key: 0, a: 0, b: 0 };
  private readonly t0 = [0, 0];
  private readonly t1 = [0, 0];
  private readonly splat = { c: 0, hue: 0 };
  /** QA: the slowest frame's work, ms, and the pictures made */
  qa = { workMs: 0, made: 0 };

  /**
   * prepare: GroundPaint.prepare, a spec made ready on this map. onPrepared: a tile's paint copied out, a mask's texels. size: a tile's side (m). The store is read at once; what migrate
   * gives (the pictures and blasts of builds before this one) goes into it then.
   */
  readonly geo: GroundGeo;
  private store: PicStore;
  private readonly prepare: (s: BlastSpec) => Prepared;
  private readonly onPrepared: (key: string, data: Uint8Array) => void;
  private readonly size: number;
  // (no parameter properties here: Node's checks load this file as it is)
  constructor(
    geo: GroundGeo,
    store: PicStore,
    prepare: (s: BlastSpec) => Prepared,
    onPrepared: (key: string, data: Uint8Array) => void,
    size: number,
    migrate?: () => { pics: Array<[number, number, string]>; blasts: BlastSpec[]; done: () => void },
  ) {
    this.geo = geo;
    this.store = store;
    this.prepare = prepare;
    this.onPrepared = onPrepared;
    this.size = size;
    void this.start(migrate);
  }

  private async start(migrate?: () => { pics: Array<[number, number, string]>; blasts: BlastSpec[]; done: () => void }): Promise<void> {
    let rows: Map<number, [number, number]>;
    try {
      rows = await this.store.load();
    } catch {
      rows = new Map();
    }
    // (the index in the order its pictures were last painted, the longest untouched first: each touch moves one to the end, so an eviction walks it from the head. Review four, 17)
    for (const [k, [t, n]] of [...rows].sort((a, b) => a[1][0] - b[1][0])) this.note(k, t, n);
    // (the journal the page before left, then what builds before this one kept elsewhere)
    const put: Array<[number, number, string]> = [];
    const blasts: BlastSpec[] = [];
    let done: (() => void) | null = null;
    try {
      const raw = localStorage.getItem(JOURNAL);
      if (raw) {
        const j = JSON.parse(raw) as { pics?: Array<[number, number, string]>; blasts?: Array<[number, number, number | null, number | null, number[]]> };
        for (const r of j.pics ?? []) if (Array.isArray(r) && Number.isFinite(r[0]) && typeof r[2] === 'string') put.push(r);
        for (const b of j.blasts ?? []) {
          const sp = this.fromPlace(b);
          if (sp) blasts.push(sp);
        }
      }
    } catch {
      /* none, or blocked */
    }
    if (migrate) {
      const m = migrate();
      put.push(...m.pics);
      blasts.push(...m.blasts);
      done = m.done;
    }
    // (the newest of each: a page that came back from being hidden wrote on past its journal; and one picture from two pages' stores, before there was one name, the two together)
    for (let q = put.length - 1; q >= 0; q--) if ((this.index.get(put[q][0])?.t ?? -Infinity) > put[q][1]) put.splice(q, 1);
    const byKey = new Map<number, [number, number, string]>();
    for (const r of put) {
      const was = byKey.get(r[0]);
      byKey.set(r[0], was ? merged(was, r) : r);
    }
    const rowsIn = [...byKey.values()];
    let wrote = true;
    if (rowsIn.length) {
      // (a journal row over a stored picture is merged with it, the journal's paint over the store's, never put in its place: a picture opened blank because its read
      // failed, then painted, holds only its new paint, and put whole it would take the old for good. Review four, 2)
      const stored = rowsIn.filter((r) => this.index.has(r[0])).map((r) => r[0]);
      if (stored.length)
        try {
          const got = await this.store.get(stored);
          for (let q = 0; q < rowsIn.length; q++) {
            const r = rowsIn[q], enc = got.get(r[0]);
            if (enc) rowsIn[q] = merged([r[0], this.index.get(r[0])!.t, enc], r);
          }
        } catch {
          /* unread: the journal's rows as they are */
        }
      try {
        await this.store.put(rowsIn);
      } catch {
        wrote = false;
      }
      for (const [k, t, enc] of rowsIn) {
        if (wrote) {
          this.note(k, t, enc.length);
          continue;
        }
        // (not written: held open and changed, for the next flush to write)
        const pic = this.make(k);
        this.qa.made--;
        pic.t = t;
        pic.dirty = decodeMask(enc, pic.data);
      }
    }
    this.ready = true;
    // (the journal's blasts are older than any that landed while the store was read: they go first. Review four, 1)
    const later = this.folds.splice(0);
    for (const sp of blasts) this.add(sp);
    this.folds.push(...later);
    if (blasts.length) this.onJournal?.(blasts);
    // (the blasts not drawn in yet journalled again, before what held them goes: they're drawn in over the next frames, and the journal goes once they're written. A store
    // that refused the journal's pictures keeps them in memory, and the journal and the old build's pictures stay till a store that lasts has them. Review four, 11)
    try {
      const blastsLeft = this.folds.map((f) => [f.lat, f.lon, f.olat, f.olon, this.toArray(f.spec)]);
      if (!wrote) {
        localStorage.setItem(JOURNAL, JSON.stringify({ pics: rowsIn, blasts: blastsLeft }));
        this.journal = true;
      } else if (this.folds.length) {
        localStorage.setItem(JOURNAL, JSON.stringify({ pics: [], blasts: blastsLeft }));
        this.journal = true;
      } else localStorage.removeItem(JOURNAL);
      if (wrote) done?.();
    } catch {
      /* blocked or full: what held them stays, and comes again at the next boot */
    }
    for (const [k, [ox, oz]] of this.early) this.want(k, ox, oz);
    this.early.clear();
  }

  private note(k: number, t: number, n: number): void {
    const was = this.index.get(k);
    if (was) {
      this.bytes -= was.bytes;
      this.index.delete(k);
    }
    this.index.set(k, { t, bytes: n });
    this.bytes += n;
  }

  /** Pictures kept, for QA. */
  get count(): number {
    return this.index.size;
  }

  /** Bytes kept, for QA. */
  get kept(): number {
    return this.bytes;
  }

  /** Blasts waiting to be drawn in, for QA. */
  get pending(): number {
    return this.folds.length;
  }

  // ---- blasts

  /** A blast landed: drawn into its pictures over the next frames. The spec is copied, and kept by place; `p`, the landing's own, made ready on this map (a MEGA's takes 3 ms). */
  add(spec: BlastSpec, p?: Prepared): void {
    const s = { ...spec }, o = this.t0;
    this.geo.toLatLon(s.x, s.z, o);
    const f: Fold = { spec: s, lat: o[0], lon: o[1], olat: null, olon: null, frame: p ? this.frame : -1, p: p ?? (null as unknown as Prepared), keys: null, at: 0, phase: 0, row: 0 };
    if (s.ox !== undefined && s.oz !== undefined) {
      this.geo.toLatLon(s.ox, s.oz, o);
      f.olat = o[0];
      f.olon = o[1];
    }
    this.folds.push(f);
  }

  /** The blasts not drawn in yet that reach the box (x0, z0)-(x1, z1) of this map, made ready on it: a tile that comes in before they're drawn in draws them itself. */
  pendingOver(x0: number, z0: number, x1: number, z1: number): Prepared[] {
    const out: Prepared[] = [];
    for (const f of this.folds) {
      this.ready_(f);
      if (f.p.maxX >= x0 && f.p.minX <= x1 && f.p.maxZ >= z0 && f.p.minZ <= z1) out.push(f.p);
    }
    return out;
  }

  /** A fold made ready on the map as it is now: its spec's places to this map's metres, and the pictures its box reaches. */
  private ready_(f: Fold): void {
    if (f.frame === this.frame) {
      f.keys ??= this.picsOver(f.p.minX, f.p.minZ, f.p.maxX, f.p.maxZ);
      return;
    }
    const o = this.t0;
    this.geo.toXZ(f.lat, f.lon, o);
    f.spec.x = o[0];
    f.spec.z = o[1];
    if (f.olat !== null && f.olon !== null) {
      this.geo.toXZ(f.olat, f.olon, o);
      f.spec.ox = o[0];
      f.spec.oz = o[1];
    }
    f.p = this.prepare(f.spec);
    f.keys ??= this.picsOver(f.p.minX, f.p.minZ, f.p.maxX, f.p.maxZ);
    f.frame = this.frame;
  }

  /** A fold's stored pictures not open yet, asked for in one read (one transaction for a MEGA's hundred, where each was a frame's wait). Review four, 1 and 28 */
  private ask(f: Fold): void {
    if (f.asked) return;
    this.ready_(f);
    f.asked = true;
    const want: number[] = [];
    for (const k of f.keys!) if (!this.open.has(k) && this.index.has(k) && !this.loading.has(k)) want.push(k);
    if (want.length) this.load(want);
  }

  /** One fold's step: its splat, or its spatter, drawn into a picture until `until` (performance.now()) or the picture's done. False while that picture is still on its way in. */
  private foldStep(f: Fold, until: number): boolean {
    this.ask(f);
    const keys = f.keys!, key = keys[f.at];
    const pic = this.pic(key);
    if (pic === undefined) return false;
    // (none yet: one's made at the first texel painted)
    if (pic) pic.pins++;
    const next = f.phase === 0 ? this.drawSplat(key, pic, f.p, f.row, until) : this.drawDots(key, pic, f.p, f.row, until);
    if (pic) pic.pins--;
    if (next >= 0) f.row = next;
    else {
      f.row = 0;
      if (++f.at >= keys.length) {
        f.at = 0;
        f.phase++;
      }
    }
    return true;
  }

  /** The map's metres of a picture's four corners, the box they make, and the texel range of a box of the map in it, two texels wide of it each way; null when the two don't meet. */
  private rangeOf(key: number, x0: number, z0: number, x1: number, z1: number, c: Float64Array): [number, number, number, number] | null {
    this.cornersOf(key, c);
    return this.rangeIn(c, x0, z0, x1, z1);
  }

  /** A picture's four corners on the map, into c. */
  private cornersOf(key: number, c: Float64Array): void {
    const o = this.t0;
    for (let q = 0; q < 4; q++) {
      cornerOf(key, q & 1, q >> 1, o);
      this.geo.toXZ(o[0], o[1], this.t1);
      c[q * 2] = this.t1[0];
      c[q * 2 + 1] = this.t1[1];
    }
  }

  /** The texel range of a box of the map in the picture whose corners are c (rangeOf's second half). */
  private rangeIn(c: Float64Array, x0: number, z0: number, x1: number, z1: number): [number, number, number, number] | null {
    const bx0 = Math.min(c[0], c[2], c[4], c[6]), bx1 = Math.max(c[0], c[2], c[4], c[6]), bz0 = Math.min(c[1], c[3], c[5], c[7]), bz1 = Math.max(c[1], c[3], c[5], c[7]);
    if (bx1 < x0 || bx0 > x1 || bz1 < z0 || bz0 > z1) return null;
    // (the picture's sides as a parallelogram from its first corner: its texels are near enough to it over 150 m to find a range by, and each is drawn at its own place)
    const ux = c[2] - c[0], uz = c[3] - c[1], vx = c[4] - c[0], vz = c[5] - c[1], det = ux * vz - uz * vx;
    if (Math.abs(det) < 1e-9) return null;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let q = 0; q < 4; q++) {
      const px = (q & 1 ? x1 : x0) - c[0], pz = (q & 2 ? z1 : z0) - c[1];
      const u = (px * vz - pz * vx) / det, v = (ux * pz - uz * px) / det;
      a0 = Math.min(a0, u);
      a1 = Math.max(a1, u);
      b0 = Math.min(b0, v);
      b1 = Math.max(b1, v);
    }
    const i0 = Math.max(0, Math.floor(a0 * N) - 2), i1 = Math.min(N - 1, Math.ceil(a1 * N) + 2), j0 = Math.max(0, Math.floor(b0 * N) - 2), j1 = Math.min(N - 1, Math.ceil(b1 * N) + 2);
    if (i0 > i1 || j0 > j1) return null;
    // (one array, filled again each call: a MEGA asks this for each of its dots in each of its pictures, and a new one each time was what Node's collector stopped frames for)
    const r = this.range;
    r[0] = i0;
    r[1] = i1;
    r[2] = j0;
    r[3] = j1;
    return r;
  }

  private readonly range: [number, number, number, number] = [0, 0, 0, 0];

  private readonly corners = new Float64Array(8);

  /** A texel's place on the map, from its picture's corners (bilinear: a picture is 150 m, and the map is smooth over it). */
  private at(c: Float64Array, a: number, b: number, o: number[]): void {
    const u = (a + 0.5) / N, v = (b + 0.5) / N;
    o[0] = (c[0] * (1 - u) + c[2] * u) * (1 - v) + (c[4] * (1 - u) + c[6] * u) * v;
    o[1] = (c[1] * (1 - u) + c[3] * u) * (1 - v) + (c[5] * (1 - u) + c[7] * u) * v;
  }

  /** In the pole's grid a picture's corner can lie past the cap's edge: those texels are the rows' and columns', and aren't drawn here. */
  private inside(key: number, a: number, b: number): boolean {
    if (key < CAP_KEY) return true;
    const k = key - CAP_KEY, r = k >= 1e7 ? k - 1e7 : k, pi = Math.floor(r / 2000) - 1000, pj = (r % 2000) - 1000;
    // (any of it in the cap, not only its middle: a point just inside 88 degrees reads the cap texel it falls in, which was never drawn when its middle lay outside, a 2 m
    // hole every 27 m along the circle. Review four, 14)
    return Math.hypot((pi + (a + 0.5) / N) * PIC_M, (pj + (b + 0.5) / N) * PIC_M) <= CAP_R + (PIC_M / N) * Math.SQRT1_2;
  }

  /** The splat drawn into a picture from its row `from`, a row at a time until `until`: the row to go on from, or -1 when it's done. */
  private drawSplat(key: number, pic: Pic | null, p: Prepared, from: number, until: number): number {
    const c = this.corners, R = p.max + 3, s = p.spec, r = this.rangeOf(key, s.x - R, s.z - R, s.x + R, s.z + R, c);
    if (!r) return -1;
    const o = this.t1, out = this.splat;
    let d = pic?.data ?? null, b = Math.max(r[2], from);
    for (; b <= r[3]; b++) {
      for (let a = r[0]; a <= r[1]; a++) {
        this.at(c, a, b, o);
        if (!splatAt(p, o[0], o[1], out) || !this.inside(key, a, b)) continue;
        if (!d) d = this.make(key).data;
        const t = (b * N + a) * 4, cov = Math.round(out.c * 255), old = d[t];
        d[t] = Math.max(old, cov);
        if (cov >= 128 || cov > old) d[t + 1] = out.hue * 32 + 16;
      }
      if (b < r[3] && performance.now() >= until) break;
    }
    if (d) this.touched(key);
    return b < r[3] ? b + 1 : -1;
  }

  /** The spatter drawn into a picture from its dot `from`, a dot at a time until `until`: the dot to go on from, or -1 when it's done. */
  private drawDots(key: number, pic: Pic | null, p: Prepared, from: number, until: number): number {
    const c = this.corners, dots = p.dots;
    let d = pic?.data ?? null, any = false, q = from;
    // (the picture's corners once a step, not once a dot: four trig-heavy places a dot were a sixth of a breath's fold. Review four, 27)
    this.cornersOf(key, c);
    for (; q < dots.length; q++) {
      if (q > from && performance.now() >= until) break;
      const dot = dots[q], rr = dot.rad * dot.elong + 1.5, r = this.rangeIn(c, dot.x - rr, dot.z - rr, dot.x + rr, dot.z + rr);
      if (!r) continue;
      const ca = Math.cos(dot.ang), sa = Math.sin(dot.ang), o = this.t1;
      for (let b = r[2]; b <= r[3]; b++)
        for (let a = r[0]; a <= r[1]; a++) {
          this.at(c, a, b, o);
          const cv = dotAt(dot, ca, sa, o[0], o[1]);
          if (!cv || !this.inside(key, a, b)) continue;
          // (spatter only lands on bare ground, as on a tile)
          if (d && d[(b * N + a) * 4] >= 128) continue;
          if (!d) d = this.make(key).data;
          const t = (b * N + a) * 4, cov = Math.round(cv * 255), old = d[t];
          d[t] = Math.max(old, cov);
          if (cov >= 128 || cov > old) d[t + 1] = dot.hue * 32 + 16;
          any = true;
        }
    }
    if (any) this.touched(key);
    return q < dots.length ? q : -1;
  }

  private touched(key: number): void {
    const pic = this.open.get(key)!;
    pic.dirty = true;
    pic.t = Date.now();
  }

  /**
   * The pictures a box of this map reaches, from nine places over it, padded for the bow of its edges: by rows and columns, and round a pole in its own grid. Where a box reaches the pole,
   * it's the pole's grid that has every longitude, a few pictures of it.
   */
  picsOver(x0: number, z0: number, x1: number, z1: number): number[] {
    const g = this.geo, o = this.t0, lats: number[] = [], lons: number[] = [];
    for (let q = 0; q < 9; q++) {
      g.toLatLon(q % 3 === 0 ? x0 : q % 3 === 1 ? (x0 + x1) / 2 : x1, q < 3 ? z0 : q < 6 ? (z0 + z1) / 2 : z1, o);
      lats.push(o[0]);
      lons.push(o[1]);
    }
    const out: number[] = [];
    // (an edge bows from the straight line its places make, by its length squared over eight times its distance to the pole; the rows never come nearer the pole than the cap's edge, and
    // round the pole its own grid wants only a little)
    const span = Math.hypot(x1 - x0, z1 - z0), dPole = (90 - Math.max(...lats.map(Math.abs))) * DEG * R_M;
    const padM = 10 + (span * span) / (8 * Math.max(CAP_R, dPole)), padCap = 20;
    const la0 = Math.min(...lats) - padM / (DEG * R_M), la1 = Math.max(...lats) + padM / (DEG * R_M);
    // (rows and columns, short of either cap)
    if (la0 < CAP_LAT && la1 > -CAP_LAT) {
      const ref = lons[0], un = lons.map((l) => ref + ((((l - ref + 180) % 360) + 360) % 360) - 180);
      const i0 = Math.max(-ROW_MAX - 1, Math.floor(la0 / PIC_DEG)), i1 = Math.min(ROW_MAX, Math.floor(la1 / PIC_DEG));
      for (let i = i0; i <= i1; i++) {
        const w = lonW(i), n = cols(i), padL = padM / (DEG * R_M * Math.cos((i + 0.5) * PIC_DEG * DEG));
        const L0 = lon360(Math.min(...un) - padL), L1 = L0 + (Math.max(...un) - Math.min(...un)) + 2 * padL;
        const walk = (a: number, b: number) => {
          for (let j = Math.floor(a / w); j <= Math.min(n - 1, Math.floor(b / w)); j++) out.push(rcKey(i, j));
        };
        if (L1 < 360) walk(L0, L1);
        else {
          walk(L0, 360);
          walk(0, L1 - 360);
        }
      }
    }
    // (and round either pole, its own grid)
    for (const south of [false, true]) {
      if (south ? la0 > -CAP_LAT : la1 < CAP_LAT) continue;
      let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity;
      for (let q = 0; q < 9; q++) {
        const rho = (90 - (south ? -lats[q] : lats[q])) * DEG * R_M, L = lons[q] * DEG;
        px0 = Math.min(px0, rho * Math.cos(L));
        px1 = Math.max(px1, rho * Math.cos(L));
        py0 = Math.min(py0, rho * Math.sin(L));
        py1 = Math.max(py1, rho * Math.sin(L));
      }
      const lim = CAP_R + PIC_M;
      for (let pi = Math.floor(Math.max(-lim, px0 - padCap) / PIC_M); pi <= Math.floor(Math.min(lim, px1 + padCap) / PIC_M); pi++)
        for (let pj = Math.floor(Math.max(-lim, py0 - padCap) / PIC_M); pj <= Math.floor(Math.min(lim, py1 + padCap) / PIC_M); pj++) out.push(capKey(south, pi, pj));
    }
    return out;
  }

  // ---- tiles

  /**
   * A tile of the map at (ox, oz) comes, its key `key`: true when its paint is copied out and waiting for it (the city gives it its own ground then, and GroundPaint copies it in). Otherwise
   * its copy is queued if there's any paint under it, and onPrepared says when it's done.
   */
  want(key: string, ox: number, oz: number): void {
    // (before the store's read, kept, and asked again once it's in)
    if (!this.ready) {
      this.early.set(key, [ox, oz]);
      return;
    }
    if (this.copying.has(key)) return;
    const keys = this.picsOver(ox, oz, ox + this.size, oz + this.size).filter((k) => this.index.has(k) || this.open.has(k));
    if (!keys.length) return;
    this.copying.add(key);
    this.copies.push({ key, ox, oz, keys, pics: null, C: [0, 0, 0, 0, 0, 0, 0, 0], polar: false, d: null, j: 0, any: false });
  }

  /** A tile's 64 KB, done with: kept for the next copy or picture (review four, 18). A fresh one for every copy and every painted tile let go was ~5 MB a second for the collector, flying over painted ground. */
  recycle(d: Uint8Array): void {
    if (d.length === TEXELS * 4 && this.free.length < FREE) this.free.push(d);
  }

  /** One of the pool's arrays, zeroed, or a new one. */
  take(): Uint8Array {
    return this.free.pop()?.fill(0) ?? new Uint8Array(TEXELS * 4);
  }

  /** The tile is gone (unloaded, or its ground made again): its copy, if one's queued, goes with it; it's asked for again if the tile comes back without its paint. */
  dropCopy(key: string): void {
    // (and one asked for before the store was read, which would be queued then: review five, 41)
    this.early.delete(key);
    if (!this.copying.delete(key)) return;
    const k = this.copies.findIndex((c) => c.key === key);
    if (k < 0) return;
    const c = this.copies[k];
    this.copies.splice(k, 1);
    if (c.d) this.recycle(c.d);
  }

  /** The tile's paint is being copied out. */
  copyingTile(key: string): boolean {
    return this.copying.has(key);
  }

  /** There's paint kept under the tile at (ox, oz). */
  has(ox: number, oz: number): boolean {
    if (!this.index.size && !this.open.size) return false;
    return this.picsOver(ox, oz, ox + this.size, oz + this.size).some((k) => this.index.has(k) || this.open.has(k));
  }

  /** One tile's paint copied out of its pictures, every texel from the picture at its place, a row at a time until `until`: true when it's done, false while one of them is on its way in or it's out of time. */
  private copyStep(c: Copy, until: number): boolean {
    const g = this.geo, ts = this.size, cs = ts / N, o = this.t0, sp = this.spot;
    if (!c.pics) {
      const pics = new Map<number, Uint8Array>();
      for (const k of c.keys) {
        const pic = this.pic(k);
        if (pic === undefined) return false;
        if (pic) pics.set(k, pic.data);
      }
      // (its corners' places, and its texels' between them, the longitudes taken round from the first; near a pole each texel's own)
      const C = c.C;
      for (let q = 0; q < 4; q++) {
        g.toLatLon(c.ox + (q & 1 ? ts : 0), c.oz + (q & 2 ? ts : 0), o);
        C[q * 2] = o[0];
        C[q * 2 + 1] = q ? C[1] + ((((o[1] - C[1] + 180) % 360) + 360) % 360) - 180 : o[1];
      }
      c.polar = Math.max(Math.abs(C[0]), Math.abs(C[2]), Math.abs(C[4]), Math.abs(C[6])) > 85;
      c.pics = pics;
      c.d = this.free.pop()?.fill(0) ?? new Uint8Array(TEXELS * 4);
    }
    const C = c.C, pics = c.pics, d = c.d!;
    let last = -1, pd: Uint8Array | undefined;
    for (; c.j < N; c.j++) {
      if (performance.now() >= until) return false;
      const j = c.j, v = (j + 0.5) / N;
      for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N;
        if (c.polar) g.toLatLon(c.ox + (i + 0.5) * cs, c.oz + (j + 0.5) * cs, o);
        else {
          o[0] = (C[0] * (1 - u) + C[2] * u) * (1 - v) + (C[4] * (1 - u) + C[6] * u) * v;
          o[1] = (C[1] * (1 - u) + C[3] * u) * (1 - v) + (C[5] * (1 - u) + C[7] * u) * v;
        }
        locate(o[0], o[1], sp);
        if (sp.key !== last) {
          last = sp.key;
          pd = pics.get(sp.key);
        }
        if (!pd) continue;
        const q = (sp.b * N + sp.a) * 4, cov = pd[q];
        if (!cov) continue;
        const t = (j * N + i) * 4;
        d[t] = cov;
        d[t + 1] = pd[q + 1];
        c.any = true;
      }
    }
    this.copying.delete(c.key);
    if (c.any) this.onPrepared(c.key, d);
    return true;
  }

  // ---- the pictures in memory

  /** A picture open, null when there's none (one is made at the first texel painted), undefined while it's on its way in from the store. */
  private pic(key: number): Pic | null | undefined {
    const pic = this.open.get(key);
    if (pic) return pic;
    if (this.index.has(key)) {
      if (!this.loading.has(key)) this.load([key]);
      return undefined;
    }
    return null;
  }

  private make(key: number): Pic {
    const pic: Pic = { data: this.free.pop()?.fill(0) ?? new Uint8Array(TEXELS * 4), dirty: false, t: Date.now(), pins: 0 };
    this.open.set(key, pic);
    this.qa.made++;
    return pic;
  }

  private load(keys: number[]): void {
    for (const k of keys) this.loading.add(k);
    this.store
      .get(keys)
      .then((got) => {
        for (const k of keys) {
          this.loading.delete(k);
          // (nor one cleared while it was read: the tuner's reset)
          if (this.open.has(k) || !this.index.has(k)) continue;
          const enc = got.get(k);
          const pic = this.make(k);
          this.qa.made--;
          pic.t = this.index.get(k)?.t ?? pic.t;
          if (enc && !decodeMask(enc, pic.data)) pic.data.fill(0);
        }
      })
      .catch(() => {
        for (const k of keys) this.loading.delete(k);
        // (a store that won't read after opening again counts toward the memory fallback as one that won't write: folds in strict order would wait on its picture for the
        // session, drawing nothing, so writing nothing, so never failing a write. The fallback's reads give a blank for what it can't. Review five, 43)
        this.failed();
      });
  }

  /** A call the store refused, after opening it again once: three running, and what's written from then on is kept in memory (Fallback), 16 MB more of it. */
  private failed(): void {
    if (++this.fails < 3 || this.store instanceof Fallback) return;
    this.store = new Fallback(this.store);
    this.budget = Math.max(this.budget, this.bytes + BUDGET / 4);
    this.fails = 0;
  }

  // ---- each frame

  /** A frame's share, WORK_MS of it: tiles' paint copied out first, as a tile waits on it, then blasts drawn in, then what's changed coded; and every FLUSH_S what's coded written. */
  work(dt: number): void {
    if (!this.ready) return;
    const t0 = performance.now(), end = t0 + WORK_MS, last = end - STEP_MS;
    // (every FLUSH_S, what's changed is queued to be coded, and what's open past OPEN closed: first, inside the frame's share)
    this.flushIn -= dt;
    if (this.flushIn <= 0 && !this.coding.length && !this.writing) {
      this.flushIn = FLUSH_S;
      for (const [k, pic] of this.open) if (pic.dirty) this.coding.push(k);
      this.close();
    }
    // (copies first, as a tile waits on one, but with blasts or coding waiting, not past six tenths of the share: at Jet over painted ground they took all of it. Review four, 15)
    const copyEnd = this.folds.length || this.coding.length ? t0 + WORK_MS * 0.6 : end, copyLast = Math.min(last, copyEnd);
    for (let k = 0; k < this.copies.length && performance.now() < copyLast; ) {
      if (this.copyStep(this.copies[k], copyEnd)) this.copies.splice(k, 1);
      else k++;
    }
    // (in order, the next one's stored pictures asked for as this one's drawn: a fold waiting on its pictures holds the ones after it, or a later blast drawn first
    // would be kept under an older one, as the live tiles never show it. Review four, 1)
    if (this.folds.length > 1) this.ask(this.folds[1]);
    while (this.folds.length && performance.now() < last) {
      const f = this.folds[0];
      if (!this.foldStep(f, end)) break;
      if (f.phase > 1) this.folds.shift();
    }
    while (this.coding.length && performance.now() < last) {
      const k = this.coding.pop()!, pic = this.open.get(k);
      if (!pic?.dirty) continue;
      const enc = encodeMask(pic.data);
      pic.dirty = false;
      if (!enc) continue;
      this.coded.push([k, pic.t, enc]);
      this.note(k, pic.t, enc.length);
    }
    if (!this.coding.length && !this.writing && (this.coded.length || this.bytes > this.budget)) this.write();
    this.qa.workMs = Math.max(this.qa.workMs, performance.now() - t0);
  }

  /** A picture closed, its texels kept for the next one made (a picture's 64 KB, made and dropped as the bus flies, is what the page's collector would stop a frame for). */
  private shut(k: number): void {
    const pic = this.open.get(k);
    if (!pic) return;
    this.open.delete(k);
    if (this.free.length < FREE) this.free.push(pic.data);
  }

  /** What folds and copies are drawing, or the store is being sent: kept open, and in the store. */
  private busy(): Set<number> {
    const busy = new Set<number>();
    for (const f of this.folds) {
      this.ready_(f);
      for (const k of f.keys!) busy.add(k);
    }
    for (const c of this.copies) for (const k of c.keys) busy.add(k);
    for (const r of this.sent) busy.add(r[0]);
    return busy;
  }

  /** Pictures nothing's drawing closed past OPEN, once written, the longest untouched first. */
  private close(): void {
    if (this.open.size <= OPEN) return;
    const busy = this.busy();
    const shut = [...this.open].filter(([k, p]) => !p.dirty && !p.pins && !busy.has(k)).sort((a, b) => a[1].t - b[1].t);
    for (let n = this.open.size - OPEN, q = 0; n > 0 && q < shut.length; n--, q++) this.shut(shut[q][0]);
  }

  /** What's coded, written to the store; and past BUDGET, the longest untouched go, down to nine tenths of it so that it's seldom. */
  private write(): void {
    const drop: number[] = [];
    if (this.bytes > this.budget) {
      const busy = this.busy();
      for (const r of this.coded) busy.add(r[0]);
      // (from the index's head, the longest untouched, EVICT a write at most: the whole index sorted and thousands of deletes in one frame was tens of ms. Review four, 17)
      for (const [k, m] of this.index) {
        if (this.bytes <= this.budget * 0.9 || drop.length >= EVICT) break;
        if (busy.has(k) || this.open.get(k)?.pins || this.open.get(k)?.dirty) continue;
        drop.push(k);
        this.bytes -= m.bytes;
        this.index.delete(k);
        this.shut(k);
      }
    }
    if (!this.coded.length && !drop.length) return;
    this.writing = true;
    const rows = this.coded;
    this.coded = [];
    this.sent = rows;
    // (the room first, then what takes it: put and remove sent together ran the put first, which a store at its quota refused before anything was freed. Review five, 44)
    (drop.length ? this.store.remove(drop) : Promise.resolve())
      .then(() => (rows.length ? this.store.put(rows) : undefined))
      .then(
        () => {
          this.fails = 0;
          // (all of it in the store, the page having come back from being hidden: the journal it left is old. Not in memory: there the journal's the store that lasts)
          if (this.journal && !(this.store instanceof Fallback) && !this.folds.length && !this.coded.length && !this.coding.length && ![...this.open.values()].some((p) => p.dirty)) {
            this.journal = false;
            try {
              localStorage.removeItem(JOURNAL);
            } catch {
              /* blocked */
            }
          }
        },
        (e: unknown) => {
          // (not written: changed again, so the next flush tries them again; a picture closed since comes back to be written. A store full before its budget, as a browser's quota
          // can be, has its budget brought down under what it holds, and the longest untouched go: on a full store only, never on a lost connection, which the store opened
          // again once already (review four, 2). One that takes nothing three times running, IndexedDB blocked as in some private windows or gone, keeps what's written from
          // then on in memory, 16 MB more of it, and journals it at each hide, as far as localStorage takes it; what IndexedDB held is still read from it and never deleted)
          const full = (e as { name?: string } | null)?.name === 'QuotaExceededError';
          if (full) this.budget = Math.max(BUDGET / 64, Math.min(this.budget, this.bytes * 0.8));
          this.failed();
          for (const [k, t, enc] of rows) {
            const pic = this.open.get(k);
            if (pic) pic.dirty = true;
            else this.coded.push([k, t, enc]);
          }
        },
      )
      .finally(() => {
        this.sent = [];
        this.writing = false;
      });
  }

  /**
   * The page is going (pagehide) or hidden: the blasts not drawn in yet, whole, and every picture not yet written go into the journal, synchronously, for the next boot to write.
   */
  persist(): void {
    // (every blast not drawn in yet goes into the journal whole, in order, and none is drawn now: on a hide that was the whole backlog in the handler, up to a second on a
    // phone after a firehose, and a fold that waited sent the rest out of order. The page that comes back goes on drawing them; the next boot draws what's left. Review four, 1, 13)
    const keep: Array<[number, number, number | null, number | null, number[]]> = this.folds.map((f) => [f.lat, f.lon, f.olat, f.olon, this.toArray(f.spec)]);
    // (what's being written and what's coded for it, then what's changed: a page that comes back from being hidden goes on writing them, and its next boot takes the newest of each)
    const pics: Array<[number, number, string]> = [...this.sent, ...this.coded];
    for (const [k, pic] of this.open) {
      if (!pic.dirty) continue;
      const enc = encodeMask(pic.data);
      if (enc) pics.push([k, pic.t, enc]);
    }
    // (in memory, with IndexedDB gone: what's in memory goes into the journal too, the newest first, as much as localStorage takes; it's the store that lasts then)
    let mem: Array<[number, number, string]> = [];
    if (this.store instanceof Fallback) {
      const has = new Set(pics.map((r) => r[0]));
      mem = [...this.store.mem.rows].filter(([k]) => !has.has(k)).map(([k, [t, enc]]): [number, number, string] => [k, t, enc]).sort((a, b) => b[1] - a[1]);
    }
    if (!pics.length && !keep.length && !mem.length) return;
    try {
      // (a hide before the store's read: the last session's journal isn't read yet, and is kept, this session's blasts after its own. Review four, 11)
      if (!this.ready) {
        const raw = localStorage.getItem(JOURNAL), j = raw ? (JSON.parse(raw) as { pics?: Array<[number, number, string]>; blasts?: typeof keep }) : null;
        if (j?.pics) pics.unshift(...j.pics);
        if (j?.blasts) keep.unshift(...j.blasts);
      }
      for (;;)
        try {
          localStorage.setItem(JOURNAL, JSON.stringify({ pics: mem.length ? [...pics, ...mem] : pics, blasts: keep }));
          break;
        } catch (e) {
          if (!mem.length) throw e;
          mem = mem.slice(0, mem.length >> 1);
        }
      this.journal = true;
    } catch {
      /* full or blocked: the next flush, if the page lives on, writes them */
    }
  }

  private toArray(s: BlastSpec): number[] {
    return [s.x, s.z, s.r, s.hue, s.seed, s.layout, s.sectors, s.ring, s.twist, s.edge, s.ragged, s.rays, s.rayLen, s.reach, s.dots, s.blobs];
  }

  private fromPlace(b: [number, number, number | null, number | null, number[]]): BlastSpec | null {
    if (!Array.isArray(b) || !Array.isArray(b[4]) || b[4].length < 16 || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) return null;
    const a = b[4], o = this.t0;
    this.geo.toXZ(b[0], b[1], o);
    const s: BlastSpec = { x: o[0], z: o[1], r: a[2], hue: a[3], seed: a[4], layout: a[5], sectors: a[6], ring: a[7], twist: a[8], edge: a[9], ragged: a[10], rays: a[11], rayLen: a[12], reach: a[13], dots: a[14], blobs: a[15] };
    if (b[2] !== null && b[3] !== null && Number.isFinite(b[2]) && Number.isFinite(b[3])) {
      this.geo.toXZ(b[2], b[3], o);
      s.ox = o[0];
      s.oz = o[1];
    }
    return s;
  }

  /** The map slid by whole tiles (dtx, dtz), (dx, dz) m: what's pending is made ready again on it, by place, and copies under way go on with the tile's new key and corner. */
  slid(dtx: number, dtz: number, dx: number, dz: number): void {
    this.frame++;
    const early = [...this.early];
    this.early.clear();
    for (const [key, [ox, oz]] of early) {
      const k = key.indexOf(',');
      this.early.set(`${Number(key.slice(0, k)) - dtx},${Number(key.slice(k + 1)) - dtz}`, [ox - dx, oz - dz]);
    }
    this.copying.clear();
    for (const c of this.copies) {
      const k = c.key.indexOf(',');
      c.key = `${Number(c.key.slice(0, k)) - dtx},${Number(c.key.slice(k + 1)) - dtz}`;
      c.ox -= dx;
      c.oz -= dz;
      this.copying.add(c.key);
    }
  }

  /** The map made again round the bus: what's pending is made ready again on it, by place; copies under way are dropped, as the new map's tiles ask again. */
  moved(): void {
    this.frame++;
    this.early.clear();
    for (const c of this.copies) this.copying.delete(c.key);
    this.copies.length = 0;
  }

  /** Every picture gone, from memory and the store. */
  clear(): void {
    this.index.clear();
    this.open.clear();
    this.folds.length = 0;
    this.copies.length = 0;
    this.copying.clear();
    // (and what was being coded, written or read: the reload's pagehide journalled the rows mid-write, and the next boot put them back. Review five, 49)
    this.coding = [];
    this.coded = [];
    this.sent = [];
    this.loading.clear();
    this.early.clear();
    this.bytes = 0;
    void this.store.clear().catch(() => undefined);
    try {
      localStorage.removeItem(JOURNAL);
    } catch {
      /* blocked */
    }
  }
}

/** The pictures in IndexedDB: a store of their codes by key, and one of each one's time and size, read whole at boot. */
export class IdbStore implements PicStore {
  private db: Promise<IDBDatabase> | null = null;

  private readonly name: string;
  constructor(name = 'strugglebus.moonpaint') {
    this.name = name;
  }

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    const p = new Promise<IDBDatabase>((ok, no) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('pics');
        r.result.createObjectStore('meta');
      };
      r.onsuccess = () => {
        const db = r.result;
        // (a connection the browser closes, or another tab's upgrade, is let go of: the next call opens a new one)
        db.onclose = () => this.drop(p);
        db.onversionchange = () => {
          db.close();
          this.drop(p);
        };
        ok(db);
      };
      r.onerror = () => {
        this.drop(p);
        no(r.error);
      };
    });
    this.db = p;
    return p;
  }

  private drop(p: Promise<IDBDatabase> | null): void {
    if (this.db !== p) return;
    this.db = null;
    void p?.then((db) => db.close()).catch(() => undefined);
  }

  /** One transaction, on a connection opened again once if it fails: iOS can drop a page's connection after a while in the background ("Connection to Indexed
   *  Database server lost"), and every call on the old one fails. Review four, 2 */
  private async tx<T>(mode: IDBTransactionMode, f: (pics: IDBObjectStore, meta: IDBObjectStore) => T): Promise<T> {
    try {
      return await this.once(mode, f);
    } catch {
      this.drop(this.db);
      return await this.once(mode, f);
    }
  }

  private async once<T>(mode: IDBTransactionMode, f: (pics: IDBObjectStore, meta: IDBObjectStore) => T): Promise<T> {
    const db = await this.open();
    return new Promise((ok, no) => {
      let t: IDBTransaction;
      try {
        t = db.transaction(['pics', 'meta'], mode);
      } catch (e) {
        no(e);
        return;
      }
      const out = f(t.objectStore('pics'), t.objectStore('meta'));
      t.oncomplete = () => ok(out);
      t.onerror = () => no(t.error);
      t.onabort = () => no(t.error);
    });
  }

  async load(): Promise<Map<number, [number, number]>> {
    const out = new Map<number, [number, number]>();
    await this.tx('readonly', (_p, meta) => {
      const c = meta.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return;
        const v = cur.value as [number, number];
        if (Array.isArray(v)) out.set(Number(cur.key), v);
        cur.continue();
      };
    });
    return out;
  }

  async get(keys: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    await this.tx('readonly', (pics) => {
      for (const k of keys) {
        const r = pics.get(k);
        r.onsuccess = () => {
          if (typeof r.result === 'string') out.set(k, r.result);
        };
      }
    });
    return out;
  }

  async put(rows: Array<[number, number, string]>): Promise<void> {
    await this.tx('readwrite', (pics, meta) => {
      for (const [k, t, enc] of rows) {
        pics.put(enc, k);
        meta.put([t, enc.length], k);
      }
    });
  }

  async remove(keys: number[]): Promise<void> {
    await this.tx('readwrite', (pics, meta) => {
      for (const k of keys) {
        pics.delete(k);
        meta.delete(k);
      }
    });
  }

  async clear(): Promise<void> {
    await this.tx('readwrite', (pics, meta) => {
      pics.clear();
      meta.clear();
    });
  }
}

/** A store that wouldn't take writes: what's written from then on is kept in memory, and what it held is still read from it. */
class Fallback implements PicStore {
  readonly mem = new MemoryStore();
  private readonly was: PicStore;
  constructor(was: PicStore) {
    this.was = was;
  }

  load(): Promise<Map<number, [number, number]>> {
    return this.mem.load();
  }

  async get(keys: number[]): Promise<Map<number, string>> {
    const out = await this.mem.get(keys), rest = keys.filter((k) => !out.has(k));
    if (rest.length)
      try {
        for (const [k, v] of await this.was.get(rest)) out.set(k, v);
      } catch {
        /* none */
      }
    return out;
  }

  put(rows: Array<[number, number, string]>): Promise<void> {
    return this.mem.put(rows);
  }

  /** What's evicted goes from memory only: what IndexedDB held stays there for the next boot (review four, 2 and 10). */
  remove(keys: number[]): Promise<void> {
    return this.mem.remove(keys);
  }

  clear(): Promise<void> {
    void this.was.clear().catch(() => undefined);
    return this.mem.clear();
  }
}

/** The pictures in memory, for Node: `rows` outlives a GeoPaint, as a store outlives a page. */
export class MemoryStore implements PicStore {
  readonly rows: Map<number, [number, string]>;
  constructor(rows = new Map<number, [number, string]>()) {
    this.rows = rows;
  }

  async load(): Promise<Map<number, [number, number]>> {
    return new Map([...this.rows].map(([k, [t, enc]]) => [k, [t, enc.length] as [number, number]]));
  }

  async get(keys: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    for (const k of keys) {
      const r = this.rows.get(k);
      if (r) out.set(k, r[1]);
    }
    return out;
  }

  async put(rows: Array<[number, number, string]>): Promise<void> {
    for (const [k, t, enc] of rows) this.rows.set(k, [t, enc]);
  }

  async remove(keys: number[]): Promise<void> {
    for (const k of keys) this.rows.delete(k);
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }
}

/** Exported for the tools: a point's picture key and texel (`locate`), and a picture's corner (`cornerOf`). */
export const geoGrid = { locate, cornerOf, PIC_M, CAP_LAT };
