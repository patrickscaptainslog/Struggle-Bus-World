import * as THREE from 'three';
import { config } from '../config';
import type { Flight } from '../game/Flight';
import type { Shot } from '../game/Aim';
import type { Blast, BarfOpts } from '../game/Splat';
import type { BlastSpec } from '../game/blastLayout';
import { HUE_COUNT } from '../render/palette';
import { craterById, mix32, type Age } from './craters';
import { CRATER_FLOATS, CRATER_INTS } from './gen';
import { latLonToMap, type MapFrame, type Place, type WholeMap } from './map';
import { moonGlobals } from './moonMaterial';
import type { MoonCraterRequest, MoonCraters } from './moonWorker';
import { CLIP_LEVELS, PaintClip, type ClipMark } from './PaintClip';

// Craters are the buildings of the Moon. This is what the street's buildings get from Aim, Splat and PaintState: a pick at the aim point, a target that glints, a hit that goes up a level and blooms, and what's
// painted kept on the device under the crater's stable id (craters.ts), so it comes back on any map of the Moon. Nothing on the street changes: the bus aims as it does, and this moves the shot onto what glints.
//
// A level is what a hit does to a crater: 1 floods the bowl, 2 crowns the rim, 3 throws rainbow rays over the ground and turns the bowl to a pinwheel. Each lands where the breath came down and takes about a second.
// What it looks like is PaintClip's; what grows on it, RimBloom's.

const KEY = 'strugglebus.moon.craters.v1';
/** A blast reaches neighbours this much past the crater it hit (m), and at most this many. */
const NEIGHBOURS = 14;
/** The grid marks are kept on (m); a mark wider than this is looked at every time. */
const GRID = 2048;

/** What glints, and what a tap will hit. */
export interface Target {
  id: string;
  x: number;
  z: number;
  r: number;
  a: number;
  b: number;
  c: number;
  age: Age;
  kind: number;
  name: string | null;
  wob: Float32Array | null;
  turn: number;
  /** painted already: its record */
  rec: Rec | null;
}

/** A painted crater: the mark on the windows, and what is saved of it. */
export interface Rec extends ClipMark {
  id: string;
  name: string | null;
  order: number;
}

export interface PaintDeps {
  renderer: THREE.WebGLRenderer;
  post: (m: MoonCraterRequest) => void;
  frame: MapFrame;
  albedo: WholeMap;
  places: Place[];
  seed: number;
  groundAt: (x: number, z: number) => number;
}

const keyOf = (L: number, i: number, j: number, k: number) => mix32(Math.imul(L + 1, 0x9e3779b1) ^ Math.imul(i, 0x85ebca77) ^ Math.imul(j, 0xc2b2ae3d) ^ Math.imul(k, 0x27d4eb2f));
const keyOfId = (id: string) => {
  if (id.startsWith('p')) return mix32(Number(id.slice(1)) + 0x51ed27);
  const [L, i, j, k] = id.split('.').map(Number);
  return keyOf(L, i, j, k);
};

/** How long a level takes to land on a crater this big (s). */
const landTime = (r: number) => Math.min(2.8, 0.6 + r / 160);
/** How far a mark reaches from its centre, by level (m). */
const reachOf = (r: number, level: number) => r * (level >= 3 ? 9.4 : level >= 2 ? 1.3 : 1.12) + 8;

export class CraterPaint {
  readonly clip: PaintClip;
  /** what's glinting */
  target: Target | null = null;
  /** game time it started */
  since = 0;
  readonly recs = new Map<number, Rec>();
  private readonly grid = new Map<number, Rec[]>();
  private readonly wide: Rec[] = [];
  /** being landed now: the frame's draw */
  private live: Rec[] = [];
  private nextHue = Math.floor(Math.random() * HUE_COUNT);
  private order = 0;
  private dirty = false;
  private saveAt = 0;

  // ---- the craters around the bus, from the worker
  private n = 0;
  private ids: Int32Array = new Int32Array(0);
  private data: Float32Array = new Float32Array(0);
  private listRec: Array<Rec | undefined> = [];
  private askId = 0;
  private asking = false;
  private askedX = Infinity;
  private askedZ = 0;
  private askedHalf = 0;
  private readonly named: Target[] = [];
  private readonly tmpWin = [0, 0, 0, 0];
  private marks: ClipMark[] = [];
  private stamp = new Map<ClipMark, number>();
  private stampN = 0;

  constructor(private readonly d: PaintDeps) {
    this.clip = new PaintClip(d.renderer);
    moonGlobals.tPaintClip.value = this.clip.rt.texture;
    moonGlobals.uClip.value = this.clip.rects;
    const t = new Float64Array(2);
    for (const p of d.places) {
      if (p.type !== 'crater') continue;
      latLonToMap(d.frame, p.lat, p.lon, t);
      this.named.push({ id: `p${p.id}`, x: t[0], z: t[1], r: p.R, a: 0.3, b: 0.5, c: 0.5, age: 0, kind: p.km >= 20 ? 1 : 0, name: p.name, wob: p.km >= 20 ? rimOf(p, d.seed) : null, turn: 0, rec: null });
    }
    this.load();
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.save());
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.hidden && this.save());
  }

  // ------------------------------------------------------------------ the list

  /** The worker's answer. */
  land(m: MoonCraters) {
    if (m.id !== this.askId) return;
    this.asking = false;
    this.n = m.n;
    this.ids = m.ids;
    this.data = m.data;
    const l = this.listRec;
    l.length = m.n;
    const I = m.ids;
    for (let i = 0; i < m.n; i++) {
      const o = i * CRATER_INTS;
      l[i] = this.recs.size ? this.recs.get(keyOf(I[o], I[o + 1], I[o + 2], I[o + 3])) : undefined;
    }
  }

  private ask(f: Flight, reach: number) {
    if (this.asking) return;
    const half = reach * 0.8 + 320, cx = f.x + f.fx * reach * 0.6, cz = f.z + f.fz * reach * 0.6;
    if (Math.abs(cx - this.askedX) + Math.abs(cz - this.askedZ) < half * 0.3 && half < this.askedHalf * 1.5 && half > this.askedHalf * 0.6) return;
    this.askedX = cx;
    this.askedZ = cz;
    this.askedHalf = half;
    this.asking = true;
    this.d.post({ type: 'craters', id: ++this.askId, cx, cz, half, minR: Math.max(5, 0.006 * reach) });
  }

  /** QA: how many are in the list, how many landing. */
  get listed(): number {
    return this.n;
  }
  get liveCount(): number {
    return this.live.length;
  }

  // ------------------------------------------------------------------ the pick

  /** What a crater scores as the thing under the aim: lower is better, -1 not a target. */
  private score(x: number, z: number, r: number, level: number, ax: number, az: number, dist: number, f: Flight): number {
    const d = Math.hypot(x - ax, z - az), e = d - r, snap = 14 + 0.07 * dist;
    if (e > snap || r < Math.max(5, 0.008 * dist)) return -1;
    // (a bowl wider than the view isn't a thing to aim at: its floor is where the targets are)
    if (r > 2.5 * dist) return -1;
    if ((x - f.x) * f.fx + (z - f.z) * f.fz + r < 20) return -1;
    const pref = Math.max(18, 0.12 * dist);
    return (e > 0 ? e / snap + 0.2 : (0.2 * d) / r) + 0.3 * Math.abs(Math.log(r / pref)) + (level >= 3 ? 2 : 0.25 * level);
  }

  private pick(ax: number, az: number, dist: number, f: Flight, now: number) {
    const D = this.data;
    let best = Infinity, at = -1, atN: Target | null = null;
    const t0 = this.target;
    for (let i = 0; i < this.n; i++) {
      const o = i * CRATER_FLOATS, x = D[o], z = D[o + 1];
      // (the box first: thousands of these, every frame)
      const b = D[o + 2] + 14 + 0.07 * dist;
      if (x - ax > b || ax - x > b || z - az > b || az - z > b) continue;
      const s = this.score(x, z, D[o + 2], this.listRec[i]?.level ?? 0, ax, az, dist, f);
      if (s >= 0 && s < best) {
        best = s;
        at = i;
      }
    }
    for (const c of this.named) {
      const s = this.score(c.x, c.z, c.r, this.recs.get(keyOfId(c.id))?.level ?? 0, ax, az, dist, f);
      if (s >= 0 && s < best) {
        best = s;
        at = -1;
        atN = c;
      }
    }
    // (sticky: it takes a clearly better crater to take the glint away)
    if (t0) {
      const s = this.score(t0.x, t0.z, t0.r, t0.rec?.level ?? 0, ax, az, dist, f);
      if (s >= 0 && s < best + 0.3) return;
    }
    if (at < 0 && !atN) {
      if (t0) this.since = now;
      this.target = null;
      return;
    }
    this.since = now;
    if (atN) {
      atN.rec = this.recs.get(keyOfId(atN.id)) ?? null;
      this.target = atN;
      return;
    }
    const o = at * CRATER_FLOATS, I = at * CRATER_INTS;
    this.target = { id: `${this.ids[I]}.${this.ids[I + 1]}.${this.ids[I + 2]}.${this.ids[I + 3]}`, x: D[o], z: D[o + 1], r: D[o + 2], age: D[o + 3] as Age, a: D[o + 4], b: D[o + 5], c: D[o + 6], kind: 0, name: null, wob: null, turn: 0, rec: this.listRec[at] ?? null };
  }

  private glint() {
    const g = moonGlobals, t = this.target;
    if (!t) {
      g.uGlintS.value.w = 0;
      return;
    }
    g.uGlint.value.set(t.x, t.z, t.r, this.since);
    const th = t.a * Math.PI, sq = 1 + 0.16 * (t.b - 0.5), ct = Math.cos(th), st = Math.sin(th);
    g.uGlintM.value.set(ct * sq, st * sq, ct / sq, st / sq);
    g.uGlintS.value.set(0.05 * Math.cos(t.c * 40), 0.05 * Math.sin(t.c * 40), 0, t.kind === 0 ? 1 : 2);
  }

  // ------------------------------------------------------------------ a breath

  /** A shot leaves: if a crater glints it lands on that, on the floor, at the aim point if that's on it. The rest of the way is the street's. */
  aim(shot: Shot, f: Flight, ax: number, az: number) {
    const t = this.target;
    if (!t) return;
    const q = Math.hypot(ax - t.x, az - t.z) / t.r;
    const x = t.r > 120 && q < 0.8 ? ax : t.x, z = t.r > 120 && q < 0.8 ? az : t.z, y = this.d.groundAt(x, z);
    shot.x = x;
    shot.z = z;
    shot.y = y + 0.5;
    shot.exact = true;
    shot.drop = Math.max(0, f.y - y);
    shot.travel = this.travelFor(Math.hypot(x - f.x, z - f.z, f.y - y));
    shot.crater = t;
  }

  /** The breath's flight (s) over `d` m: it arcs, it doesn't shoot. */
  travelFor(d: number): number {
    return Math.min(2.6, 0.5 + d / 340);
  }

  /** What a crater hit changes of a blast: no pinwheel on the ground: the grey between bowls is the contrast. Its spatter flies out over the rim. */
  barf(shot: Shot): Pick<BarfOpts, 'tag' | 'shape'> {
    const t = shot.crater as Target | undefined;
    if (!t) return {};
    return {
      tag: t,
      shape: (s: BlastSpec) => {
        if (t.r > 150) return false;
        s.r = t.r * 1.2 + 26;
        s.edge = 0.02;
        s.ragged = 0;
        s.rays = 0;
        s.dots = 0;
        s.reach = (t.r * 2.3 + 36) / s.r;
        return true;
      },
    };
  }

  /** The blast lands: its crater and those around it go up a level. Returns the crater it hit. */
  impact(b: Blast): Target | null {
    const S = config.splat, t = (b.tag as Target | null) ?? null;
    const cx = b.spec.x, cz = b.spec.z, base = t ? t.r + 40 : b.spec.r * 0.8;
    const v = Math.max(S.waveSpeed, (b.spec.r * S.ringReach) / 0.5);
    const hits: Array<{ i: number; d: number; ang: number }> = [];
    const D = this.data;
    const maxR = t ? Math.max(30, t.r * 1.4) : base;
    for (let i = 0; i < this.n; i++) {
      const o = i * CRATER_FLOATS, r = D[o + 2];
      if (r > maxR || r < 5) continue;
      const dx = D[o] - cx, dz = D[o + 1] - cz, d = Math.hypot(dx, dz);
      if (d - r > base) continue;
      if (t && Math.abs(D[o] - t.x) < 0.5 && Math.abs(D[o + 1] - t.z) < 0.5) continue;
      hits.push({ i, d, ang: Math.atan2(dz, dx) });
    }
    hits.sort((p, q) => p.d - q.d);
    if (hits.length > NEIGHBOURS) hits.length = NEIGHBOURS;
    hits.sort((p, q) => p.ang - q.ang);
    const was = t ? this.recs.get(keyOfId(t.id)) : undefined;
    const hue = was ? was.hue : this.nextHue;
    if (!was) this.nextHue = (this.nextHue + 1) % HUE_COUNT;
    if (t) this.paint(t, hue, b.t, cx - t.x, cz - t.z);
    for (let k = 0; k < hits.length; k++) {
      const { i, d } = hits[k], o = i * CRATER_FLOATS, I = i * CRATER_INTS;
      const c: Target = { id: `${this.ids[I]}.${this.ids[I + 1]}.${this.ids[I + 2]}.${this.ids[I + 3]}`, x: D[o], z: D[o + 1], r: D[o + 2], age: D[o + 3] as Age, a: D[o + 4], b: D[o + 5], c: D[o + 6], kind: 0, name: null, wob: null, turn: 0, rec: null };
      const rec = this.paint(c, (hue + k + 1) % HUE_COUNT, b.t + d / v, 0, 0);
      this.listRec[i] = rec;
    }
    if (t) t.rec = this.recs.get(keyOfId(t.id)) ?? null;
    return t;
  }

  /** A crater goes up a level, or takes its first. */
  private paint(c: Target, hue: number, t0: number, ix: number, iz: number): Rec {
    const key = keyOfId(c.id);
    let rec = this.recs.get(key);
    if (rec) {
      rec.level = Math.min(3, rec.level + 1);
      rec.t0 = t0;
      rec.ix = ix;
      rec.iz = iz;
      const reach = reachOf(rec.r, rec.level);
      if (reach !== rec.reach) {
        this.unfile(rec);
        rec.reach = reach;
        this.file(rec);
      }
    } else {
      rec = { id: c.id, name: c.name, x: c.x, z: c.z, r: c.r, reach: reachOf(c.r, 1), kind: c.kind, a: c.a, b: c.b, c: c.c, level: 1, hue, t0, T: landTime(c.r), seed: (mix32(key) % 6283) / 1000, ix, iz, wob: c.wob, turn: c.turn, order: this.order++ };
      this.recs.set(key, rec);
      this.file(rec);
    }
    if (!this.live.includes(rec)) this.live.push(rec);
    this.dirty = true;
    this.saveAt = 1;
    return rec;
  }

  private file(rec: Rec) {
    if (rec.reach > GRID / 2) {
      this.wide.push(rec);
      return;
    }
    const i0 = Math.floor((rec.x - rec.reach) / GRID), i1 = Math.floor((rec.x + rec.reach) / GRID), j0 = Math.floor((rec.z - rec.reach) / GRID), j1 = Math.floor((rec.z + rec.reach) / GRID);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = (j + 32768) * 65536 + i + 32768;
        let l = this.grid.get(k);
        if (!l) this.grid.set(k, (l = []));
        l.push(rec);
      }
  }

  private unfile(rec: Rec) {
    const a = this.wide.indexOf(rec);
    if (a >= 0) {
      this.wide.splice(a, 1);
      return;
    }
    const i0 = Math.floor((rec.x - rec.reach) / GRID), i1 = Math.floor((rec.x + rec.reach) / GRID), j0 = Math.floor((rec.z - rec.reach) / GRID), j1 = Math.floor((rec.z + rec.reach) / GRID);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const l = this.grid.get((j + 32768) * 65536 + i + 32768);
        const q = l ? l.indexOf(rec) : -1;
        if (q >= 0) l!.splice(q, 1);
      }
  }

  /** Every mark on a rectangle, biggest first. */
  private marksIn(x0: number, z0: number, x1: number, z1: number): number {
    const m = this.marks, stamp = ++this.stampN, seen = this.stamp;
    let n = 0;
    const take = (r: ClipMark) => {
      if (seen.get(r) === stamp || r.x + r.reach < x0 || r.x - r.reach > x1 || r.z + r.reach < z0 || r.z - r.reach > z1) return;
      seen.set(r, stamp);
      m[n++] = r;
    };
    for (const r of this.wide) take(r);
    const i0 = Math.floor(x0 / GRID), i1 = Math.floor(x1 / GRID), j0 = Math.floor(z0 / GRID), j1 = Math.floor(z1 / GRID);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > this.grid.size) {
      for (const l of this.grid.values()) for (const r of l) take(r);
    } else
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const l = this.grid.get((j + 32768) * 65536 + i + 32768);
          if (l) for (const r of l) take(r);
        }
    m.length = n;
    m.sort(biggestFirst);
    return n;
  }

  // ------------------------------------------------------------------ a frame

  /** After the splats, before the frame's draw. */
  update(dt: number, now: number, f: Flight, ax: number, az: number, loaded: boolean, height: number) {
    const reach = Math.max(120, Math.min(26000, height * 3)) + 60;
    this.ask(f, reach);
    if (loaded) this.pick(ax, az, Math.max(40, Math.hypot(ax - f.x, az - f.z, height)), f, now);
    else if (this.target) {
      this.target = null;
      this.since = now;
    }
    this.glint();
    const c = this.clip;
    c.follow(f.x, f.z, f.fx, f.fz);
    const win = this.tmpWin;
    const live = this.live;
    let lx0 = Infinity, lz0 = Infinity, lx1 = -Infinity, lz1 = -Infinity;
    for (const r of live) {
      lx0 = Math.min(lx0, r.x - r.reach);
      lz0 = Math.min(lz0, r.z - r.reach);
      lx1 = Math.max(lx1, r.x + r.reach);
      lz1 = Math.max(lz1, r.z + r.reach);
    }
    for (let k = 0; k < CLIP_LEVELS; k++) {
      c.window(k, win);
      if (c.dirty(k)) c.draw(k, win[0], win[1], win[2], win[3], this.marks, this.marksIn(win[0], win[1], win[2], win[3]), now);
      else if (live.length) {
        const x0 = Math.max(win[0], lx0), z0 = Math.max(win[1], lz0), x1 = Math.min(win[2], lx1), z1 = Math.min(win[3], lz1);
        if (x1 > x0 && z1 > z0) c.draw(k, x0, z0, x1, z1, this.marks, this.marksIn(x0, z0, x1, z1), now);
      }
    }
    for (let i = live.length - 1; i >= 0; i--) if (now >= live[i].t0 + live[i].T) live.splice(i, 1);
    if (this.saveAt > 0) {
      this.saveAt -= dt;
      if (this.saveAt <= 0) this.save();
    }
  }

  // ------------------------------------------------------------------ the device

  private load() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let list: Array<[string, number, number]>;
    try {
      list = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;
    const { frame, albedo, seed } = this.d;
    for (const row of list) {
      const [id, level, hue] = row;
      if (typeof id !== 'string') continue;
      let c: Target | null = null;
      if (id.startsWith('p')) c = this.named.find((n) => n.id === id) ?? null;
      else {
        const k = craterById(frame, albedo, seed, id);
        if (k) c = { id, x: k.x, z: k.z, r: k.r, a: k.a, b: k.b, c: k.c, age: k.age, kind: 0, name: null, wob: null, turn: 0, rec: null };
      }
      if (!c) continue;
      const rec = this.paint(c, wrap(hue), -1000, 0, 0);
      rec.level = Math.min(3, Math.max(1, level | 0));
      this.unfile(rec);
      rec.reach = reachOf(rec.r, rec.level);
      this.file(rec);
    }
    this.live.length = 0;
    this.saveAt = 0;
  }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    const list: Array<[string, number, number]> = [];
    for (const r of this.recs.values()) list.push([r.id, r.level, r.hue]);
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* a full or blocked store: the paint lives for this flight */
    }
  }

  reset() {
    this.recs.clear();
    this.grid.clear();
    this.wide.length = 0;
    this.live.length = 0;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* blocked */
    }
  }
}

const wrap = (h: number) => ((Math.round(h) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT;
const biggestFirst = (a: ClipMark, b: ClipMark) => b.r - a.r;

/** A named crater's wandering rim, as MoonGen.complex rolls it: the same hash, the same harmonics. */
function rimOf(p: Place, seed: number): Float32Array {
  let h = mix32(p.id + 77 + seed);
  const r = () => (h = mix32(h + 1)) / 4294967296;
  const ph = [r() * 6.283, r() * 6.283, r() * 6.283, r() * 6.283];
  // a sin (k th + ph) is (a sin ph) cos k th + (a cos ph) sin k th
  const A = [0.03, 0.018, 0.012, 0.007], w = new Float32Array(8);
  for (let i = 0; i < 4; i++) {
    w[i * 2] = A[i] * Math.sin(ph[i]);
    w[i * 2 + 1] = A[i] * Math.cos(ph[i]);
  }
  return w;
}
