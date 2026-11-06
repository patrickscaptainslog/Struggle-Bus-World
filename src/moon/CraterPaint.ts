import * as THREE from 'three';
import { config } from '../config';
import { MOON_LOW_KEY } from '../sky/flag';
import { blastUniforms } from '../world/GroundPaint';
import type { Flight } from '../game/Flight';
import type { Shot } from '../game/Aim';
import type { Blast, BarfOpts } from '../game/Splat';
import type { BlastSpec } from '../game/blastLayout';
import { HUE_COUNT } from '../render/palette';
import { FACTION_RAINBOW, ownerOf } from '../game/factions';
import { craterById, cratersNear, mix32, type Age } from './craters';
import { CRATER_FLOATS, CRATER_INTS } from './gen';
import { dirOf, latLonToMap, latOf, lonOf, mapOf, type MapFrame, type Place, type WholeMap } from './map';
/** From up high (?moonland, the flight's loop, VOYAGE.md V2c), a tap's crater is chosen as the aim's would be from this far off (m) at most, and is never wider than HIGH_R (m of radius):
 *  one tap from orbit is a crater a few km across, never a region. First picks. It's never narrower than ORBIT_R either, or nothing of it would show from up there. */
const HIGH_AIM = 20000;
const HIGH_R = 8000;
/** m: how far off its rim the place it came down may be, from up high: about the glint's size (MoonBreath's CRATER_GLINT_KM). A 3 km reach found a crater on a tenth of the Moon's places. */
const HIGH_SNAP = 8000;
import { moonGlobals } from './moonMaterial';
import type { RoofSprouts } from '../world/props/sprouts';
import type { PaintStroke } from '../sky/MoonPaint';
import { RimBloom } from './RimBloom';
import type { MoonCraterRequest, MoonCraters } from './moonWorker';
import { CLIP_LEVELS, PaintClip, type ClipMark } from './PaintClip';

// Craters are the buildings of the Moon. This is what the street's buildings get from Aim, Splat and PaintState: a pick at the aim point, a target that glints, a hit that goes up a level and blooms, and what's
// painted kept on the device under the crater's stable id (craters.ts), so it comes back on any map of the Moon. Nothing on the street changes: the bus aims as it does, and this moves the shot onto what glints.
//
// A level is what a hit does to a crater: 1 floods the bowl, 2 crowns the rim, 3 throws rainbow rays over the ground and turns the bowl to a pinwheel. Each lands where the breath came down and takes about a second.
// What it looks like is PaintClip's; what grows on it, RimBloom's.

const KEY = 'strugglebus.moon.craters.v1';
const STROKES_KEY = 'strugglebus.moon.strokes.v1';
/** A blast on open ground is kept this many times over, for the far windows. Past that the oldest goes. */
const MAX_STROKES = 600;
/** Crewed landing sites stay unpainted: a grey circle this wide (m) with its name. */
export const SITE_R = 1200;
/** A crater this wide (m of radius) is seen from orbit, on its global map, at its true size or a dot of this many km, a texel of that map. */
const ORBIT_R = 500;
const ORBIT_KM = 6;
/** A blast reaches neighbours this much past the crater it hit (m), and at most this many. */
const NEIGHBOURS = 14;
/** What a splash can do to a neighbour: rays are for a direct hit, or the ground under a few blasts is nothing but rays. */
const NEIGHBOUR_TOP = 2;
/** A blast names the place it came down in at most this often (s). */
const BLAST_SIGN_EVERY = 25;
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
  /** a hash of the id, and this session's number for it */
  key: number;
  order: number;
  /** whose paint it is (game/factions.ts): its last hitter's. Saved after the rest of its row only if it isn't Rainbow's, so a Rainbow row is as before factions */
  faction: number;
}

export interface PaintDeps {
  renderer: THREE.WebGLRenderer;
  post: (m: MoonCraterRequest) => void;
  frame: MapFrame;
  albedo: WholeMap;
  places: Place[];
  /** every other named crater, for its sign */
  names: NameRow[];
  seed: number;
  /** the boulders in a box: each takes the paint it stands in, at this time */
  paintRocks: (x0: number, z0: number, x1: number, z1: number, at: number) => void;
}

/** A row of names.json: name, latitude, longitude, km across. */
export type NameRow = [string, number, number, number];

/** What the frame hands in once the props and the particles exist. */
export interface PaintFx {
  sprouts: RoofSprouts;
  /** the ground: the tile's where there is one, else the far field's */
  groundAt: (x: number, z: number) => number;
  tileAt: (x: number, z: number) => boolean;
  /** stars over a rim, from the ground up */
  sparkles: (x: number, y: number, z: number, r: number, hue: number, n: number) => void;
  /** one twinkle */
  twinkle: (x: number, y: number, z: number, hue: number) => void;
  /** a splash where the flood reaches the rim */
  splash: (x: number, y: number, z: number, hue: number, k: number) => void;
  /** a fountain, for the top level */
  fountain: (x: number, y: number, z: number, hue: number, k: number) => void;
}

interface Spot {
  name: string;
  x: number;
  z: number;
  /** how near counts as here (m) */
  R: number;
  crewed: boolean;
}

const keyOf = (L: number, i: number, j: number, k: number) => mix32(Math.imul(L + 1, 0x9e3779b1) ^ Math.imul(i, 0x85ebca77) ^ Math.imul(j, 0xc2b2ae3d) ^ Math.imul(k, 0x27d4eb2f));
const keyOfId = (id: string) => {
  if (id.startsWith('p')) return mix32(Number(id.slice(1)) + 0x51ed27);
  const [L, i, j, k] = id.split('.').map(Number);
  return keyOf(L, i, j, k);
};

/** How far off a crater's rim the aim can be and it still glints (m), from this far. */
const snapOf = (dist: number) => 14 + 0.09 * dist;
/** How long a level takes to land on a crater this big (s). */
const landTime = (r: number) => Math.min(2.6, 0.6 + r / 160) + Math.min(1.6, r / 30000);
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
  private readonly v3 = new Float64Array(3);
  private readonly tmpWin = [0, 0, 0, 0];
  private readonly tmpDir = new Float64Array(3);
  private marks: ClipMark[] = [];
  private stamp = new Map<ClipMark, number>();
  private stampN = 0;
  /** what grows on them (main.ts hands it the props) */
  rim: RimBloom | null = null;
  private fx: PaintFx | null = null;
  private groundAt: (x: number, z: number) => number = () => 0;
  private busX = 0;
  private busZ = 0;
  /** levels landing: when each reaches its rim */
  private landing: Array<{ at: number; rec: Rec; level: number }> = [];
  /** blasts on open ground, oldest first */
  private readonly strokes: Rec[] = [];
  private strokesDirty = false;
  /** the named: where they are */
  private readonly spots: Spot[] = [];
  readonly sites: Spot[] = [];
  private lastHere: Spot | null = null;
  private readonly signed = new Map<string, number>();
  private readonly blastSigned = new Map<string, number>();
  private hereTimer = 0;
  private hitName: string | null = null;
  private latchTo = 0;
  private wasDrag = false;
  /** how much of what's around the bus is painted, 0..1, for the hum */
  nearShare = 0;
  /** ?moonland: a crater big enough to see from orbit took a level, and the orbit's map is on this page */
  onBig: ((s: PaintStroke) => void) | null = null;

  constructor(private readonly d: PaintDeps) {
    this.clip = new PaintClip(d.renderer);
    moonGlobals.tPaintClip.value = this.clip.rt.texture;
    moonGlobals.uClip.value = this.clip.rects;
    this.lay();
    this.load();
    this.loadStrokes();
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.save());
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.hidden && this.save());
  }

  /** Where everything with a name stands on this map. */
  private lay() {
    const d = this.d, t = new Float64Array(2), u = new Float64Array(2);
    for (const p of d.places) {
      if (p.type !== 'crater') continue;
      latLonToMap(d.frame, p.lat, p.lon, t);
      // (its own north, on this map)
      latLonToMap(d.frame, p.lat + 0.05, p.lon, u);
      const turn = Math.atan2(u[0] - t[0], t[1] - u[1]);
      this.named.push({ id: `p${p.id}`, x: t[0], z: t[1], r: p.R, a: 0.3, b: 0.5, c: 0.5, age: 0, kind: p.km >= 20 ? 1 : 0, name: p.name, wob: p.km >= 20 ? rimOf(p, d.seed) : null, turn, rec: null });
    }
    for (const p of d.places) {
      latLonToMap(d.frame, p.lat, p.lon, t);
      const crewed = p.type === 'site' && p.name.startsWith('APOLLO');
      const R = p.type === 'site' ? 2600 : p.type === 'crater' || p.type === 'basin' ? p.R * 1.12 : p.type === 'valley' ? p.R * 0.7 : p.R;
      const spot = { name: p.name, x: t[0], z: t[1], R, crewed };
      this.spots.push(spot);
      if (crewed) this.sites.push(spot);
    }
    for (const [name, lat, lon, km] of d.names) {
      latLonToMap(d.frame, lat, lon, t);
      this.spots.push({ name, x: t[0], z: t[1], R: km * 560, crewed: false });
    }
    // (the map's grey circles: only those it can reach)
    const near = this.sites.filter((c) => Math.abs(c.x) < 2e5 && Math.abs(c.z) < 2e5).slice(0, 6);
    moonGlobals.uSiteN.value = near.length;
    near.forEach((c, i) => moonGlobals.uSites.value[i].set(c.x, c.z, SITE_R, 0));
  }

  /** The map is round another place now (?moonland): what's kept is by id and by latitude, so it all comes back where it belongs on this one. */
  rebase() {
    this.save();
    this.named.length = this.spots.length = this.sites.length = this.wide.length = this.strokes.length = this.live.length = this.landing.length = 0;
    this.recs.clear();
    this.grid.clear();
    this.marks = [];
    this.stamp.clear();
    this.target = null;
    this.lastHere = null;
    this.n = 0;
    this.askedX = Infinity;
    this.rim?.clear();
    this.clip.rebase();
    this.lay();
    this.load();
    this.loadStrokes();
  }

  /**
   * ?moon: the map slid by (dx, dz) under the bus, and `from` is the frame it had (main.ts, moonBoot's slide). Every painted crater and every blast on open ground goes where
   * it stands on the new map, worked out from the Moon itself, so it's where it belongs however far off it is, and the names are laid out again. What's blooming, landing or
   * glinting goes on as it was, and so do the gardens. The list moves with the ground until the worker has the new map's, and the windows keep what's on them. `moved`: what
   * main.ts' other holders share, each moved once.
   */
  slide(from: MapFrame, dx: number, dz: number, moved: Set<object>) {
    const to = this.d.frame, dir = this.tmpDir, t = new Float64Array(2);
    const over = (r: { x: number; z: number }) => {
      dirOf(from, r.x, r.z, dir);
      mapOf(to, dir[0], dir[1], dir[2], t);
      r.x = t[0];
      r.z = t[1];
    };
    // the names and places, each with its own north on this map
    const here = this.lastHere?.name;
    this.named.length = this.spots.length = this.sites.length = 0;
    this.lay();
    this.lastHere = here === undefined ? null : (this.spots.find((s) => s.name === here) ?? null);
    const byId = new Map(this.named.map((c) => [c.id, c]));
    for (const r of this.recs.values()) {
      const c = r.id.startsWith('p') ? byId.get(r.id) : undefined;
      if (c) {
        r.x = c.x;
        r.z = c.z;
        r.turn = c.turn;
      } else over(r);
    }
    for (const r of this.strokes) over(r);
    this.grid.clear();
    this.wide.length = 0;
    for (const r of this.recs.values()) this.file(r);
    for (const r of this.strokes) this.file(r);
    // (the list and what glints go with the ground; a list asked for on the old map is no use, and is asked for again)
    const D = this.data;
    for (let i = 0; i < this.n; i++) {
      D[i * CRATER_FLOATS] -= dx;
      D[i * CRATER_FLOATS + 1] -= dz;
    }
    if (this.asking) {
      this.askId++;
      this.asking = false;
    }
    this.askedX = Infinity;
    const g = this.target;
    if (g && !moved.has(g)) {
      moved.add(g);
      if (g.id.startsWith('p')) over(g);
      else {
        g.x -= dx;
        g.z -= dz;
      }
    }
    this.busX -= dx;
    this.busZ -= dz;
    this.clip.slide(dx, dz);
    this.rim?.slide(dx, dz);
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

  /** Before the first frame: the program that draws the windows compiles now. */
  prime() {
    this.clip.prime();
  }

  /** The props and the particles are made after this is. */
  bind(fx: PaintFx) {
    this.fx = fx;
    this.groundAt = fx.groundAt;
    this.rim = new RimBloom({ sprouts: fx.sprouts, groundAt: fx.groundAt, tileAt: fx.tileAt });
  }

  /** What a blast's sign says: the named crater it hit, else where it came down. */
  signFor(x: number, z: number): string {
    return this.hitName ?? this.nameAt(x, z);
  }

  /** Does this blast raise a sign? A crater with a name always does. Everything inside Theophilus is in Theophilus, and a word that comes up every few seconds stops being read: a place says so again after a while. */
  signDue(x: number, z: number, now: number): boolean {
    if (this.hitName) return true;
    const name = this.nameAt(x, z);
    if (now < (this.blastSigned.get(name) ?? -1e9) + BLAST_SIGN_EVERY) return false;
    this.blastSigned.set(name, now);
    return true;
  }

  /** The smallest named place that holds (x, z), or the nearest there is. */
  nameAt(x: number, z: number): string {
    return (this.spotAt(x, z) ?? this.nearestSpot(x, z))?.name ?? 'THE MOON';
  }

  private spotAt(x: number, z: number): Spot | null {
    let best: Spot | null = null;
    for (const s of this.spots) {
      const dx = s.x - x, dz = s.z - z, R = s.R;
      if (dx * dx + dz * dz < R * R && (!best || R < best.R)) best = s;
    }
    return best;
  }

  private nearestSpot(x: number, z: number): Spot | null {
    let best: Spot | null = null, bd = Infinity;
    for (const s of this.spots) {
      const d = Math.hypot(s.x - x, s.z - z) - s.R;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Is this inside a crewed site's circle? */
  inSite(x: number, z: number): boolean {
    for (const c of this.sites) if (Math.hypot(c.x - x, c.z - z) < SITE_R) return true;
    return false;
  }

  /** Twice a second: a place the bus has just come to, for its sign. Stands where it stands if that's small enough to be a place, else where the bus is going. */
  passing(dt: number, now: number, f: Flight, height: number): { text: string; x: number; z: number; r: number } | null {
    this.hereTimer -= dt;
    if (this.hereTimer > 0) return null;
    this.hereTimer = 0.5;
    const here = this.spotAt(f.x, f.z);
    if (here === this.lastHere) return null;
    this.lastHere = here;
    if (!here || now < (this.signed.get(here.name) ?? -1e9) + 70) return null;
    this.signed.set(here.name, now);
    const ahead = 150 + 3 * f.ground + 2.2 * height;
    if (here.crewed) return { text: here.name, x: here.x, z: here.z, r: 40 };
    return { text: here.name, x: f.x + f.fx * ahead, z: f.z + f.fz * ahead, r: 26 + 0.25 * height };
  }

  /** QA: a crater takes a level, as a hit would: an id from `cratersNear`, or a `p` one. */
  qaHit(id: string, now: number, hue = 0, faction = FACTION_RAINBOW): Rec | null {
    let c: Target | null = null;
    if (id.startsWith('p')) c = this.named.find((n) => n.id === id) ?? null;
    else {
      const k = craterById(this.d.frame, this.d.albedo, this.d.seed, id);
      if (k) c = { id, x: k.x, z: k.z, r: k.r, a: k.a, b: k.b, c: k.c, age: k.age, kind: 0, name: null, wob: null, turn: 0, rec: null };
    }
    return c ? this.paint(c, hue, now, 0, 0, 3, faction) : null;
  }

  /**
   * From up high (?moonland, the flight's loop): a breath that came down at (lat, lon) hits the crater there, a level, as one from the low game would, chosen as the aim chooses from HIGH_AIM off.
   * now: the low game's clock; faction: the hitter's. Null: open ground, or a landing site.
   */
  hitAt(lat: number, lon: number, now: number, hue: number, faction = FACTION_RAINBOW): Rec | null {
    const p = this.v3;
    latLonToMap(this.d.frame, lat, lon, p);
    const x = p[0], z = p[1], d = HIGH_AIM, pref = Math.max(24, 0.14 * d);
    if (this.inSite(x, z)) return null;
    // (within the glint, and if there's nothing there, twice as far: a tap from up there paints something, near where it came down, about five times in six at the first reach and nearly always at the second)
    for (const snap of [HIGH_SNAP, 2 * HIGH_SNAP]) {
      const t = this.highPick(x, z, snap, pref);
      if (t) return this.paint(t, hue, Math.max(now, 1e-3), x, z, 3, faction);
    }
    return null;
  }

  /** hitAt's crater: a bowl (x, z) is in, the nearer its own size to what a breath from up there takes the better, or a rim it's just off; and a finished bowl is no target. */
  private highPick(x: number, z: number, snap: number, pref: number): Target | null {
    const score = (cx: number, cz: number, r: number, level: number) => {
      const e = Math.hypot(cx - x, cz - z) - r;
      if (e > snap || r < ORBIT_R || r > HIGH_R) return -1;
      return (e > 0 ? e / snap + 0.2 : (0.2 * (e + r)) / r) + 0.3 * Math.abs(Math.log(r / pref)) + (level >= 3 ? 2 : 0);
    };
    let best = Infinity, id = '';
    for (const c of cratersNear(this.d.frame, this.d.albedo, this.d.seed, x, z, snap, 2 * ORBIT_R)) {
      const s = score(c.x, c.z, c.r, this.recs.get(keyOfId(c.id))?.level ?? 0);
      if (s >= 0 && s < best) {
        best = s;
        id = c.id;
      }
    }
    let t: Target | null = null;
    for (const c of this.named) {
      const s = score(c.x, c.z, c.r, this.recs.get(keyOfId(c.id))?.level ?? 0);
      if (s >= 0 && s < best) {
        best = s;
        t = c;
      }
    }
    if (!t && id) {
      const k = craterById(this.d.frame, this.d.albedo, this.d.seed, id);
      if (k) t = { id, x: k.x, z: k.z, r: k.r, a: k.a, b: k.b, c: k.c, age: k.age, kind: 0, name: null, wob: null, turn: 0, rec: null };
    }
    return t;
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
    const d = Math.hypot(x - ax, z - az), e = d - r, snap = snapOf(dist);
    if (e > snap || r < Math.max(8.5, 0.01 * dist)) return -1;
    // (a bowl much wider than the view isn't a thing to aim at: its floor is where the targets are)
    if (r > 4 * dist) return -1;
    if ((x - f.x) * f.fx + (z - f.z) * f.fz + r < 20) return -1;
    if (this.sites.length && this.inSite(x, z)) return -1;
    const pref = Math.max(24, 0.14 * dist);
    // (a bowl that's finished is no target. One that isn't is as good as any: a player who turns back for it means it, and the street's aim has no opinion about paint either)
    return (e > 0 ? e / snap + 0.2 : (0.2 * d) / r) + 0.3 * Math.abs(Math.log(r / pref)) + (level >= 3 ? 2 : 0);
  }

  private pick(ax: number, az: number, dist: number, f: Flight, now: number) {
    const D = this.data;
    let best = Infinity, at = -1, atN: Target | null = null;
    const t0 = this.target;
    for (let i = 0; i < this.n; i++) {
      const o = i * CRATER_FLOATS, x = D[o], z = D[o + 1];
      // (the box first: thousands of these, every frame)
      const b = D[o + 2] + snapOf(dist);
      if (x - ax > b || ax - x > b || z - az > b || az - z > b) continue;
      const s = this.score(x, z, D[o + 2], this.listRec[i]?.level ?? 0, ax, az, dist, f);
      if (s >= 0 && s < best) {
        best = s;
        at = i;
      }
    }
    for (const c of this.named) {
      if (Math.hypot(c.x - ax, c.z - az) - c.r > snapOf(dist)) continue;
      const lv = this.recs.get(keyOfId(c.id))?.level ?? 0;
      // (a name is worth aiming at: from high enough, the whole of Theophilus)
      const s = this.score(c.x, c.z, c.r, lv, ax, az, dist, f) * (lv < 3 ? 0.25 : 1);
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
    // (a named rim's first harmonic, the other way up: it's a divide there and a multiply in the writer)
    if (t.wob) g.uGlintS.value.set(-t.wob[0], -t.wob[1], 0, 2);
    else g.uGlintS.value.set(0.05 * Math.cos(t.c * 40), 0.05 * Math.sin(t.c * 40), 0, 1);
  }

  // ------------------------------------------------------------------ a breath

  /** A touch went down that may be a tap, or the steering thumb came up to make one: what glints holds while the bus settles, as Aim's latch does. */
  latch(now: number) {
    if (this.target) this.latchTo = now + config.splat.aimLatch;
  }

  /** A shot leaves: if a crater glints it lands on that, on the floor, at the aim point if that's on it. The rest of the way is the street's. A mega doesn't wait for a full belly, so it looks for itself. */
  aim(shot: Shot, f: Flight, ax: number, az: number, now: number, mega: boolean) {
    if (mega && !this.target) this.pick(ax, az, Math.max(40, Math.hypot(ax - f.x, az - f.z, shot.drop)), f, now);
    const t = this.target;
    if (!t) return;
    const q = Math.hypot(ax - t.x, az - t.z) / t.r;
    const x = t.r > 120 && q < 0.8 ? ax : t.x, z = t.r > 120 && q < 0.8 ? az : t.z, y = this.groundAt(x, z);
    shot.x = x;
    shot.z = z;
    shot.y = y + 0.5;
    shot.exact = true;
    shot.drop = Math.max(0, f.y - y);
    shot.travel = this.travelFor(Math.hypot(x - f.x, z - f.z, f.y - y));
    shot.crater = t;
  }

  /** How high a breath lobs (m over its chord): a hill of a thing, in proportion to the throw. */
  arc(from: THREE.Vector3, to: THREE.Vector3): number {
    return 3 + 0.13 * Math.hypot(to.x - from.x, to.z - from.z);
  }

  /** How wide a breath is, for a shot from this far: it stays a rainbow, not a thread. */
  width(shot: Shot, f: Flight): number {
    return Math.min(11, Math.max(1, Math.hypot(shot.x - f.x, shot.z - f.z, shot.drop) / 420));
  }

  /** The breath's flight (s) over `d` m: it arcs, it doesn't shoot. */
  travelFor(d: number): number {
    return Math.min(2.6, 0.5 + d / 340);
  }

  /** What a crater hit changes of a blast: no pinwheel on the ground: the grey between bowls is the contrast. Its spatter flies out over the rim. */
  barf(shot: Shot, mega: boolean): Pick<BarfOpts, 'tag' | 'shape'> {
    const t = shot.crater as Target | undefined;
    if (!t) return {};
    if (mega) return { tag: t };
    return {
      tag: t,
      shape: (s: BlastSpec) => {
        if (t.r > 150) return false;
        s.r = t.r * 1.2 + 26;
        s.edge = 0.02;
        s.ragged = 0;
        s.rays = 0;
        s.dots = 0;
        s.blobs = Math.round(18 + t.r * 0.4);
        s.reach = (t.r * 2.3 + 36) / s.r;
        return true;
      },
    };
  }

  /** The blast lands: its crater and those around it go up a level. On open ground it stays as a mark on the far windows. Returns the crater it hit. */
  impact(b: Blast): Target | null {
    const S = config.splat, t = (b.tag as Target | null) ?? null, now = b.t;
    this.hitName = t?.name ?? null;
    const cx = b.spec.x, cz = b.spec.z, big = !!b.super, base = t ? t.r + (big ? b.spec.r * 0.9 : 40) : b.spec.r * 0.8;
    // the wave a crater's size: it crosses the bowl in half a second, whatever the bowl
    const R = (t && !big ? t.r * 1.25 + 30 : Math.max(b.spec.r, t?.r ?? 0)) * S.ringReach, v = Math.max(S.waveSpeed, R / 0.5);
    blastUniforms.uBlastRing2.value.set(b.spec.hue, S.ringWidth * Math.sqrt(Math.max(1, R / 100)), v, R);
    const hits: Array<{ i: number; d: number; ang: number }> = [];
    const D = this.data;
    const maxR = t ? Math.max(30, t.r * 1.4) : base;
    for (let i = 0; i < this.n; i++) {
      const o = i * CRATER_FLOATS, r = D[o + 2];
      if (r > maxR || r < 8) continue;
      const dx = D[o] - cx, dz = D[o + 1] - cz, d = Math.hypot(dx, dz);
      if (d - r > base) continue;
      if (t && Math.abs(D[o] - t.x) < 0.5 && Math.abs(D[o + 1] - t.z) < 0.5) continue;
      if (this.sites.length && this.inSite(D[o], D[o + 1])) continue;
      // (a firehose lands a dozen times a second: a crater goes up once a second at most)
      const was = this.listRec[i];
      if (was && now < was.t0 + 0.9) continue;
      hits.push({ i, d, ang: Math.atan2(dz, dx) });
    }
    hits.sort((p, q) => p.d - q.d);
    if (hits.length > NEIGHBOURS) hits.length = NEIGHBOURS;
    hits.sort((p, q) => p.ang - q.ang);
    const was = t ? this.recs.get(keyOfId(t.id)) : undefined;
    const hue = was ? was.hue : this.nextHue;
    if (!was) this.nextHue = (this.nextHue + 1) % HUE_COUNT;
    // (what it paints is its hitter's: the blast carries it)
    const faction = ownerOf(b.spec.faction);
    if (t) {
      this.paint(t, hue, now, cx - t.x, cz - t.z, 3, faction);
      // (a super's worth: two levels at a blow)
      if (big) this.paint(t, hue, now, cx - t.x, cz - t.z, 3, faction);
    } else if (!b.hose) this.stroke(b);
    for (let k = 0; k < hits.length; k++) {
      const { i, d } = hits[k], o = i * CRATER_FLOATS, I = i * CRATER_INTS;
      const c: Target = { id: `${this.ids[I]}.${this.ids[I + 1]}.${this.ids[I + 2]}.${this.ids[I + 3]}`, x: D[o], z: D[o + 1], r: D[o + 2], age: D[o + 3] as Age, a: D[o + 4], b: D[o + 5], c: D[o + 6], kind: 0, name: null, wob: null, turn: 0, rec: null };
      const rec = this.paint(c, this.listRec[i]?.hue ?? (hue + k + 1) % HUE_COUNT, now + d / v, 0, 0, NEIGHBOUR_TOP, faction);
      this.listRec[i] = rec;
    }
    if (t) {
      t.rec = this.recs.get(keyOfId(t.id)) ?? null;
      for (let i = 0; i < this.n; i++) if (Math.abs(D[i * CRATER_FLOATS] - t.x) < 0.5 && Math.abs(D[i * CRATER_FLOATS + 1] - t.z) < 0.5) this.listRec[i] = t.rec ?? undefined;
    }
    const reach = base + 30;
    this.d.paintRocks(cx - reach, cz - reach, cx + reach, cz + reach, now + 0.25);
    // (what the bloom's sound and the rest read)
    b.count = hits.length + (t ? 1 : 0);
    b.maxLevel = t?.rec?.level ?? 1;
    return t;
  }

  /** A blast on open ground: GroundPaint has it near the bus, and this is what the far windows show of it. */
  private stroke(b: Blast) {
    const sp = b.spec;
    // (nothing stays on a crewed site, nor grows there)
    if (this.inSite(sp.x, sp.z)) return;
    this.markStroke(sp.x, sp.z, sp.r, sp.hue, (sp.seed % 6283) / 1000, b.t, ownerOf(sp.faction));
    this.strokesDirty = true;
    this.saveAt = 1;
  }

  private markStroke(x: number, z: number, r: number, hue: number, seed: number, t0: number, faction: number) {
    const rec: Rec = { id: '', name: null, key: 0, x, z, r, reach: r * 1.1, kind: 2, a: 0, b: 0, c: 0, level: 1, hue, t0, T: 0.1, seed, ix: 0, iz: 0, wob: null, turn: 0, order: -1, faction };
    this.strokes.push(rec);
    this.file(rec);
    if (this.strokes.length > MAX_STROKES) this.unfile(this.strokes.shift()!);
    if (t0 > 0) this.live.push(rec);
  }

  /** A crater goes up a level, or takes its first: either way it's the hitter's (faction), at its top too, as a house at level 3 is (Splatter.update). */
  private paint(c: Target, hue: number, t0: number, ix: number, iz: number, top = 3, faction = FACTION_RAINBOW): Rec {
    const key = keyOfId(c.id);
    let rec = this.recs.get(key);
    if (rec) {
      if (rec.level >= top) {
        // (no higher, and nothing to draw: only whose it is, kept)
        if (rec.faction !== faction) {
          rec.faction = faction;
          this.dirty = true;
          this.saveAt = 1;
        }
        return rec;
      }
      rec.level = Math.min(top, rec.level + 1);
      rec.faction = faction;
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
      rec = { id: c.id, name: c.name, key, x: c.x, z: c.z, r: c.r, reach: reachOf(c.r, 1), kind: c.kind, a: c.a, b: c.b, c: c.c, level: 1, hue, t0, T: landTime(c.r), seed: (mix32(key) % 6283) / 1000, ix, iz, wob: c.wob, turn: c.turn, order: this.order++, faction };
      this.recs.set(key, rec);
      this.file(rec);
    }
    if (!this.live.includes(rec)) this.live.push(rec);
    this.dirty = true;
    this.saveAt = 1;
    if (t0 > 0 && rec.r >= ORBIT_R && this.onBig) {
      const a = this.lowRow(rec);
      this.onBig({ lat: a[0], lon: a[1], level: a[2], seed: a[3], km: a[4], faction: rec.faction });
    }
    this.rim?.hit(rec, this.busX, this.busZ);
    if (t0 > 0) this.landing.push({ at: t0 + rec.T * (rec.level === 1 ? 0.85 : 0.6), rec, level: rec.level });
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
  private marksIn(x0: number, z0: number, x1: number, z1: number, strokes = true): number {
    const m = this.marks, stamp = ++this.stampN, seen = this.stamp;
    let n = 0;
    const take = (r: ClipMark) => {
      if (seen.get(r) === stamp || r.x + r.reach < x0 || r.x - r.reach > x1 || r.z + r.reach < z0 || r.z - r.reach > z1 || (!strokes && r.kind === 2)) return;
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
  update(dt: number, now: number, f: Flight, ax: number, az: number, loaded: boolean, dragging: boolean, height: number) {
    this.busX = f.x;
    this.busZ = f.z;
    // (up high the aim tips down: what it picks is under the view, a throw it can make, not at the horizon)
    const up = Math.min(1, Math.max(0, (height - 300) / 2700));
    config.splat.aimDown = 20 + 16 * up * up * (3 - 2 * up);
    const reach = Math.max(120, Math.min(26000, height * 3)) + 60;
    this.ask(f, reach);
    if (dragging) this.latchTo = 0;
    else if (this.wasDrag) this.latch(now);
    this.wasDrag = dragging;
    if (loaded) {
      if (now >= this.latchTo) this.pick(ax, az, Math.max(40, Math.hypot(ax - f.x, az - f.z, height)), f, now);
    } else if (this.target) {
      this.target = null;
      this.since = now;
    }
    this.glint();
    this.clip.follow(f.x, f.z, f.fx, f.fz);
    this.drawWindows(now, 0);
    this.landings(now);
    this.twinkle(dt, f);
    const live = this.live;
    for (let i = live.length - 1; i >= 0; i--) if (now >= live[i].t0 + live[i].T) live.splice(i, 1);
    this.rim?.sync(dt, now, f.x, f.z, this.nearBus);
    if (this.saveAt > 0) {
      this.saveAt -= dt;
      if (this.saveAt <= 0) this.save();
    }
  }

  /** The bus has gone up out of reach (?moonland): nothing glints. */
  letGo() {
    this.target = null;
    this.glint();
  }

  /** ?moonland, over the ground in the flight's loop: the wide windows go where the view is, so what's painted is on the far field before the low game has the frame. The fine ones are for a bus that's nearly down. */
  fly(x: number, z: number, fx: number, fz: number, now: number) {
    this.clip.follow(x, z, fx, fz, 2);
    this.drawWindows(now, 2);
  }

  /** What's moved or landing goes on the windows, from window `from` up. */
  private drawWindows(now: number, from: number) {
    const c = this.clip, win = this.tmpWin, live = this.live;
    let lx0 = Infinity, lz0 = Infinity, lx1 = -Infinity, lz1 = -Infinity;
    for (const r of live) {
      lx0 = Math.min(lx0, r.x - r.reach);
      lz0 = Math.min(lz0, r.z - r.reach);
      lx1 = Math.max(lx1, r.x + r.reach);
      lz1 = Math.max(lz1, r.z + r.reach);
    }
    for (let k = from; k < CLIP_LEVELS; k++) {
      c.window(k, win);
      // (the finest window leaves a blast on open ground to GroundPaint: that's sharper, and it's the same place)
      if (c.dirty(k)) c.draw(k, win[0], win[1], win[2], win[3], this.marks, this.marksIn(win[0], win[1], win[2], win[3], k > 0), now);
      else if (live.length) {
        const x0 = Math.max(win[0], lx0), z0 = Math.max(win[1], lz0), x1 = Math.min(win[2], lx1), z1 = Math.min(win[3], lz1);
        if (x1 > x0 && z1 > z0) c.draw(k, x0, z0, x1, z1, this.marks, this.marksIn(x0, z0, x1, z1, k > 0), now);
      }
    }
  }

  /** A level reaches its rim: stars, and a crown of splashes. */
  private landings(now: number) {
    const l = this.landing, fx = this.fx;
    for (let i = l.length - 1; i >= 0; i--) {
      if (now < l[i].at) continue;
      const { rec, level } = l[i];
      l.splice(i, 1);
      if (!fx) continue;
      const y = this.groundAt(rec.x + rec.r, rec.z);
      fx.sparkles(rec.x, y, rec.z, rec.r * 1.05, rec.hue, Math.min(60, 12 + level * 8 + rec.r * 0.2));
      const n = Math.min(10, 3 + Math.round(rec.r / 16)), a0 = rec.seed;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2, x = rec.x + Math.cos(a) * rec.r, z = rec.z + Math.sin(a) * rec.r;
        fx.splash(x, this.groundAt(x, z), z, (rec.hue + k) % HUE_COUNT, Math.min(0.6, 0.2 + rec.r / 300));
        // (the top level: the whole rim goes up)
        if (level === 3) fx.fountain(x, this.groundAt(x, z), z, (rec.hue + k) % HUE_COUNT, 0.3);
      }
    }
  }

  /** Painted craters near the bus twinkle, and hum. */
  private twinkle(dt: number, f: Flight) {
    if (!this.fx || !this.recs.size || Math.random() > dt * 7) return;
    const n = this.nearBus().filter((r) => r.kind !== 2 && Math.hypot(r.x - f.x, r.z - f.z) - r.r < 260);
    this.nearShare = Math.min(1, n.length / 8);
    if (!n.length) return;
    const r = n[Math.floor(Math.random() * n.length)], a = Math.random() * Math.PI * 2, q = 0.5 + 0.6 * Math.random();
    const x = r.x + Math.cos(a) * r.r * q, z = r.z + Math.sin(a) * r.r * q;
    this.fx.twinkle(x, this.groundAt(x, z) + 0.6 + Math.random() * 2.5, z, r.hue);
  }

  /** The hue a boulder here takes, or -1. In a bowl, the hue across the wheel from its flood, or it couldn't be seen. Thrown round a rim, the rainbow by which way it lies. */
  hueAt(x: number, z: number): number {
    if (this.sites.length && this.inSite(x, z)) return -1;
    const at = (r: Rec): number => {
      if (r.kind === 2) return -1;
      const dx = x - r.x, dz = z - r.z, q = Math.hypot(dx, dz) / r.r;
      if (q >= 1.3 + 0.3 * r.level) return -1;
      return q < 1 ? (r.hue + 3) % HUE_COUNT : wrap(r.hue + Math.floor((Math.atan2(dz, dx) / (2 * Math.PI) + 0.5) * HUE_COUNT));
    };
    const l = this.grid.get((Math.floor(z / GRID) + 32768) * 65536 + Math.floor(x / GRID) + 32768);
    if (l)
      for (const r of l) {
        const h = at(r);
        if (h >= 0) return h;
      }
    for (const r of this.wide) {
      const h = at(r);
      if (h >= 0) return h;
    }
    return -1;
  }

  /** The painted craters around the bus. */
  private readonly nearBus = (): Rec[] => {
    const R = 2600, n = this.marksIn(this.busX - R, this.busZ - R, this.busX + R, this.busZ + R);
    return this.marks.slice(0, n) as Rec[];
  };

  // ------------------------------------------------------------------ the device

  private load() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let list: Array<[string, number, number, number?]>;
    try {
      list = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;
    const { frame, albedo, seed } = this.d;
    for (const row of list) {
      // (a fourth number is its faction, if it isn't Rainbow's; a row from before factions has three, and is Rainbow's)
      const [id, level, hue, faction] = row;
      if (typeof id !== 'string') continue;
      let c: Target | null = null;
      if (id.startsWith('p')) c = this.named.find((n) => n.id === id) ?? null;
      else {
        const k = craterById(frame, albedo, seed, id);
        if (k) c = { id, x: k.x, z: k.z, r: k.r, a: k.a, b: k.b, c: k.c, age: k.age, kind: 0, name: null, wob: null, turn: 0, rec: null };
      }
      if (!c) continue;
      const rec = this.paint(c, wrap(hue), -1000, 0, 0, 3, ownerOf(faction));
      rec.level = Math.min(3, Math.max(1, level | 0));
      this.unfile(rec);
      rec.reach = reachOf(rec.r, rec.level);
      this.file(rec);
    }
    this.live.length = 0;
    this.saveAt = 0;
  }

  private loadStrokes() {
    try {
      const raw = localStorage.getItem(STROKES_KEY);
      const list = raw ? (JSON.parse(raw) as number[][]) : null;
      if (!Array.isArray(list)) return;
      const t = new Float64Array(2);
      for (const a of list) {
        if (!Array.isArray(a) || a.length < 5 || !a.every(Number.isFinite)) continue;
        latLonToMap(this.d.frame, a[0], a[1], t);
        // (a sixth number is its faction, as a crater's row has a fourth)
        this.markStroke(t[0], t[1], a[2], wrap(a[3]), a[4], -1000, ownerOf(a[5]));
      }
    } catch {
      /* spoiled or blocked: the far windows go without */
    }
  }

  /** A crater on the orbit's map: [lat, lon, level, seed, km], and its faction after them if it isn't Rainbow's. */
  private lowRow(r: Rec): number[] {
    const d = this.tmpDir;
    dirOf(this.d.frame, r.x, r.z, d);
    return mine([Math.round(latOf(d) * 100) / 100, Math.round(lonOf(d) * 100) / 100, r.level, Math.floor((r.key >>> 0) / 12) * 6 + r.hue, Math.max(ORBIT_KM, Math.round(r.r / 100) / 10)], r.faction);
  }

  save() {
    try {
      if (this.dirty) {
        this.dirty = false;
        const list: Array<Array<string | number>> = [];
        const low: number[][] = [];
        for (const r of this.recs.values()) {
          list.push(mine([r.id, r.level, r.hue], r.faction));
          if (r.r >= ORBIT_R) low.push(this.lowRow(r));
        }
        localStorage.setItem(KEY, JSON.stringify(list));
        localStorage.setItem(MOON_LOW_KEY, JSON.stringify(low));
      }
      if (this.strokesDirty) {
        this.strokesDirty = false;
        const d = new Float64Array(3);
        const list = this.strokes.map((r) => {
          dirOf(this.d.frame, r.x, r.z, d);
          return mine([Math.round(latOf(d) * 1e4) / 1e4, Math.round(lonOf(d) * 1e4) / 1e4, Math.round(r.r), r.hue, Math.round(r.seed * 100) / 100], r.faction);
        });
        localStorage.setItem(STROKES_KEY, JSON.stringify(list));
      }
    } catch {
      /* a full or blocked store: the paint lives for this flight */
    }
  }

  reset() {
    this.recs.clear();
    this.grid.clear();
    this.wide.length = 0;
    this.live.length = 0;
    this.strokes.length = 0;
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(STROKES_KEY);
      localStorage.removeItem(MOON_LOW_KEY);
    } catch {
      /* blocked */
    }
  }
}

const wrap = (h: number) => ((Math.round(h) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT;
/** A saved row, with its faction on the end if it isn't Rainbow's: a Rainbow row is what it was before factions, and a build from before them reads past it. */
function mine<T extends Array<string | number>>(row: T, faction: number): T {
  if (faction !== FACTION_RAINBOW) row.push(faction);
  return row;
}
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
