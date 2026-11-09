import * as THREE from 'three';
import { config } from '../config';
import type { MoverTarget } from '../game/Aim';
import { latLonToLocal, localToLatLon } from '../game/geo';
import type { SuperTag } from '../game/Splat';
import { globals, heldGlobals } from '../render/materials';
import { FACTION_RAINBOW, ownerOf } from '../game/factions';
import { lookOf } from '../render/factionLook';
import type { Observer } from '../sky/SkyModel';
import { axesAt, fixToGeodetic, geodeticToFix } from '../sky/WorldFrame';
import type { LifeCurbAnswer, LifeLawn, LifeTick } from './lifeWorker';
import { Curb, type CurbPose } from './Curb';
import type { Holds } from '../game/Hold';
import { LifeLock, type LockHost, type LockPick, lockTune } from './Lock';
import { LifeTorpedo, type TorpedoHost, type TorpedoPick, type TorpedoRun, torpedoTune } from './Torpedo';
import { LAWN_CELL } from './sim/parks';
import { Ground } from '../world/tiles';
import { fnv1a } from './hash';
import { Col, Kind, KINDS, ROW } from './kinds';
import type { MoverStore } from './paint';
import { GREY_RAMP, MARK_POINTS, MARKS_MAX, type Pools, SPECKS_MAX, VEHICLE_TONES } from './pools';
import { MAX_ROWS, readKeys, SNAP_BYTES, view, type SnapView } from './snapshot';

// Life's host (LIFE.md): it ticks the worker at 10 Hz of the page's clock, and every frame carries each mover in the last snapshot on by its velocity to the
// frame's utcMs, picks its level of detail by its size on the screen, and fills the pools. Nothing in frame() allocates (CONTRACT.md section 2).

const TICK_MS = 100;
/** Under this many pixels a mover is a speck; a grey one under 1 px isn't drawn, a painted one keeps its 1 px to orbit (CONTRACT.md 1.4). */
const MODEL_PX = 2;
/** how far past the aim point a person on the line of fire may stand (m): the street under the rooftops' margin a 45 m drop over a 16 m one */
const ON_LINE_PAST = 60;
/** The street's reach (m): as far as a plane can be seen from where the bus is, the sky over the place. From the flight's loop it's the horizon. */
const REACH = 80000;
/** The flight's loop draws to 30 km (moonrun.ts, setFar): past this (m) a mover is drawn nearer the lens along its own line of sight, its size cut to match, so it's where it
 *  is on the screen and as big. A speck is a pixel at any distance. */
const SKY_NEAR = 25000;
/** SkyModel's EARTH (an import would bring the sky's model into life's chunk). The ellipsoid's radius at the equator and its flattening's stretch of z, km. */
const EARTH_ID = 0;
/** The supers whose movers blast() remembers (m22): a pour's dozen blasts a second, a Bomb's one. */
const SUPERS_KEPT = 8;
/** A painted mover's contrail (O6): the longest it streams, s of its flight; its width, px a level over the first, and m at the least. */
const TRAIL_S = 40;
const TRAIL_PX = 1;
const TRAIL_M = 8;
/**
 * An aimed hit's show (SHOTS.md, "Lock-on", what a hit does; a locked shot's or a Torpedo's): for SHOW_PLANE_S s a plane's contrail is a ribbon of the one colour
 * across the sky, RIBBON_M m and RIBBON_PX px wide at the least and as long as it has flown since, "seen from the whole city"; for SHOW_WAKE_S a boat's wake is
 * the one colour, twice as wide. Either eases back to the usual over its last SHOW_EASE s.
 */
const SHOW_PLANE_S = 60, SHOW_WAKE_S = 30, SHOW_EASE = 8;
const RIBBON_M = 60, RIBBON_PX = 4;
/** People's ground round the bus (LIFE.md, "People"): tiles in this far (m) are sampled for their grass, a few rows of their 2 m cells a frame (512 of the world's queries
 *  of each kind: CONTRACT.md section 6's few hundred), nearest first, and dropped past FORGET. Out to 1.6 km, where a Lob lands (HOOKS.md) */
const LAWN_REACH = 1600, LAWN_FORGET = 2400, LAWN_ROWS = 4;
/** A painted picnic's people, up and dancing: where each stands (m, the blanket's model's, pools.ts: the sitters' and the one lying's places, by their look bits), how
 *  much bigger than a person's model, and each one's beat behind the last (a share of a hop) */
const DANCE_AT = [-0.95, 0.45, 0.95, 0.45, 0, 0.95, -0.4, -0.45], DANCER = 1.25, DANCE_BEAT = 0.27;
/** QA: how many of the movers drawn a frame are noted, by key and place (tools/life/sky.mjs: nothing jumps on the screen when the flight takes the bus) */
const DRAWN = 64;
/** A car's lights at night (KindInfo's lights): under this many pixels its model's own lamps are too small to see, and a speck at its nose is them; a grey car's
 *  speck is drawn down to LIT_PX at night, where by day it's gone under 1 px */
const LAMP_PX = 14, LIT_PX = 0.3;
/** Painted cars' tyre tracks (KindInfo's track): as many cars at once, a point every TRACK_STEP m of the road behind each, the wheels' lines either side of the middle
 *  (m), each line's width at the least (m) and in px, and how far over the road it's laid (m) */
const TRACKS = 48, TRACK_STEP = 2.2, TRACK_M = 0.32, TRACK_PX = 1, TRACK_LIFT = 0.12;
/** a car's lamps over the road (m, the model's: pools.ts) */
const CAR_LAMP_Y = 0.84;
/**
 * The aim on what's on the ground (KindInfo's onLine: cars, buses, picnics): taken within 1.2 of its half size, a metre and GROUND_PX pixels of the line of fire,
 * so a near miss is a hit at any distance and the cone never grows past what the player sees (the producer couldn't hit a car, "the hit splat forces me to hit the
 * surrounding buildings"; a cone of 4.5 % of the distance then took shots meant for buildings, the first account's life review B1). And its glint, this many of a
 * building's, so a car's shows
 */
const GROUND_PX = 10, GROUND_GLINT = 2;
/** Dancers drawn a frame at the most: a MEGA over a crowded park paints thousands (the first account's life review, M5). Past it, and on a painted picnic under
 *  DANCE_PX on the screen, its people stay sitting in its paint (the day review's M15: an 85 m tap at Dolores's peak paints about 138 blankets) */
const DANCERS_MOST = 400, DANCE_PX = 12;
/** A truck's length by its look (the heavy pool's models, pools.ts): a bus, a box truck, a semi; the aim and the level of detail read it, not the kind's one size */
const TRUCK_LEN = [12, 12, 9.3, 9.3, 20.4];
/** A painted boat's wake (KindInfo's wake): its width at the stern, a share of the boat's length, spreading to three times that at its far end, and how far over the water
 *  it's laid (m) */
const WAKE_W = 0.3, WAKE_LIFT = 0.15;
/** A blast's column (blast()): how far over its height a mover is in it (m), and how far under: from a roof down to the street, and to a ferry's deck under a pier */
const BLAST_OVER = 30, BLAST_UNDER = 250;
const WGS_A = 6378.137, WGS_K = 1 / (1 - 1 / 298.257223563);

/** A mover's paint as drawn: its colour (a slot of its faction's look, factionLook.ts: Rainbow's are HUE_RAMPS), level, the page clock's UTC ms it took it (0: kept from before, its contrail whole), and whose it is. */
export interface MoverPaint {
  hue: number;
  level: number;
  at: number;
  /** whose paint it is (C15, src/game/factions.ts) */
  faction: number;
  /** the page clock's UTC ms an aimed shot last hit it (a locked shot, a Torpedo): its ribbon's or its wake's show (SHOW_PLANE_S, SHOW_WAKE_S). None: never */
  show?: number;
}

/** What life asks of the street's world (CONTRACT.md section 6, WorldForLife's first two queries): per query, a few hundred a frame at the most. */
export interface LifeWorld {
  groundAt(x: number, z: number): number;
  groundClassAt(x: number, z: number): number | null;
  readonly tileSize: number;
}

export class LifeHost {
  private readonly free: ArrayBuffer[] = [new ArrayBuffer(SNAP_BYTES), new ArrayBuffer(SNAP_BYTES)];
  private snap: SnapView | null = null;
  private sentAt = -Infinity;
  /** every key the worker has named, by its hash */
  readonly keys = new Map<number, string>();
  /** the painted movers, by key hash */
  readonly painted = new Map<number, MoverPaint>();
  private readonly tick: LifeTick = { type: 'tick', utcMs: 0, x: 0, y: 0, z: 0, lat: 0, lon: 0, reach: 0, buf: null as unknown as ArrayBuffer };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YZX');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  /** QA: the last frame's rows, models and specks, the snapshots taken, the loop that drew it; and the first DRAWN movers drawn, each its key's hash and where (the loop's frame) */
  /** Curb's road side: the lane the bus lands on and rolls along (Curb.ts) */
  readonly curb: Curb;
  readonly qa = { rows: 0, models: 0, people: 0, specks: 0, marks: 0, sent: 0, snaps: 0, hits: 0, sky: false, drawn: 0, dancers: 0, cars: 0, heavy: 0, tris: 0, boats: 0, lights: 0, tracks: 0, bouncers: 0 };
  readonly drawn = new Float64Array(DRAWN * 4);
  /** QA: the last painted picnic's dancer drawn this frame: its group's key's hash, where (the hop in it), and its pose (Kind.PERSON or Kind.CHEER) */
  readonly danced = new Float64Array(5);
  private dancers = 0;
  /** QA: the last painted car drawn bouncing this frame: its key's hash, where (the hop in it), and its height's scale (the squash) */
  readonly bounced = new Float64Array(5);
  private bouncers = 0;
  private cars = 0;
  private boats = 0;
  private lights = 0;
  private trackRibbons = 0;
  /** painted cars' tyre tracks: each ring's car (its key's hash, 0 none), the frame it was last drawn, its points (x, y, z), the newest's index, how many it has, and
   *  how many it has ever had (a point's hue is its own: the rainbow stays where it was laid) */
  private readonly trackOf = new Uint32Array(TRACKS);
  private readonly trackSeen = new Int32Array(TRACKS);
  private readonly trackPts = new Float32Array(TRACKS * (MARK_POINTS - 1) * 3);
  private readonly trackHead = new Int32Array(TRACKS);
  private readonly trackN = new Int32Array(TRACKS);
  private readonly trackAll = new Int32Array(TRACKS);
  /** one car's track's points as laid, the axle first */
  private readonly trackLay = new Float64Array(MARK_POINTS * 3);
  private drawFrames = 0;
  private dancing = 0;
  private readonly frustum = new THREE.Frustum();
  private readonly sphere = new THREE.Sphere();
  private readonly vp = new THREE.Matrix4();
  /** each pool's triangles an instance, for qa.tris (L3's count: what's sent, the folded boxes in it) */
  private readonly trisOf: number[];
  /** the frame's clocks, for the aim between frames */
  private utc = 0;
  private sim = 0;
  /** the mover glinting (its key's hash, 0: none), and the aim's answer, one object reused */
  private glintHash = 0;
  /** lock-on (Lock.ts): its target's glint, over the aim's; the target's row last found, by its key's hash; the lock itself */
  private lockHash = 0;
  private lockRow = -1;
  lock: LifeLock | null = null;
  torpedoes: LifeTorpedo | null = null;
  private readonly lockS = { x: 0, y: 0 };
  private readonly lockV = new THREE.Vector3();
  private glintKey: string | null = null;
  private readonly target: MoverTarget = { mover: true, key: '', x: 0, y: 0, z: 0, arrive: 0, pickR: 0, onLine: false, miss: 0, half: 0 };
  /** hits on their way: each takes at its impact's game time */
  private readonly hits: Array<{ h: number; key: string; hue: number; level: number; arrive: number; until: number; kept: boolean; faction: number; show: boolean }> = [];
  private readonly worker: Worker;
  readonly pools: Pools;
  private readonly store: MoverStore;
  private readonly ns: string;
  private readonly origin: readonly [number, number];
  /** the street's scene, where the pools draw; the flight's, where they draw while its loop has the bus (attachSky) */
  private readonly home: THREE.Object3D | null;
  private sky: THREE.Object3D | null = null;
  private skyCam: THREE.Camera | null = null;
  /** the flight's loop: the snapshot's rows Earth fixed, km, and their velocities, km/s, made once a snapshot; the map's axes at its origin, Earth fixed by rows */
  private readonly fix = new Float64Array(MAX_ROWS * 6);
  private fixFor: SnapView | null = null;
  private readonly ax = new Float64Array(9);
  private readonly mapRot = new THREE.Matrix4();
  private readonly qMap = new THREE.Quaternion();
  private readonly ll: [number, number] = [0, 0];
  private readonly f3 = new Float64Array(3);
  private readonly g3 = [0, 0, 0];

  /** the street's ground, for people; the tile being sampled now, the tiles sent (by a number), and those that weren't in yet, when to try them again (a frame count) */
  private readonly world: LifeWorld | null;
  private walking: { key: number; tx: number; tz: number; j: number; grass: Uint8Array; h: Float32Array; count: number } | null = null;
  private readonly walked = new Set<number>();
  private readonly walkLater = new Map<number, number>();
  private frames = 0;
  private readonly walkMsg: LifeLawn = { type: 'lawn', tile: null, tx: 0, tz: 0 };

  constructor(worker: Worker, pools: Pools, store: MoverStore, ns: string, origin: readonly [number, number], world: LifeWorld | null = null) {
    this.world = world;
    this.worker = worker;
    this.pools = pools;
    this.store = store;
    this.ns = ns;
    this.origin = origin;
    this.home = pools.group.parent;
    this.trisOf = [pools.small, pools.middle, pools.large, pools.heavy].map((q) => q.mesh.geometry.getAttribute('position').count / 3);
    axesAt(origin[0], origin[1], 0, this.ax);
    this.curb = new Curb((m) => worker.postMessage(m));
    worker.onmessage = (e: MessageEvent<{ type: string; buf: ArrayBuffer } | LifeCurbAnswer>) => {
      if (e.data?.type === 'snap') this.took((e.data as { buf: ArrayBuffer }).buf);
      else if (e.data?.type === 'curb') this.curb.answer(e.data as LifeCurbAnswer);
    };
  }

  private took(buf: ArrayBuffer): void {
    if (this.snap) this.free.push(this.snap.buf);
    this.snap = view(buf);
    readKeys(this.snap, this.keys);
    this.qa.snaps++;
  }

  /** What was kept, painted again (bootLife, once the store is read). */
  restore(records: Array<{ key: string; hue: number; level: number; faction?: number }>): void {
    // (a hit that landed before the store's read came back is newer: it stays. A record naming no faction is Rainbow's, C15)
    for (const r of records) {
      const h = fnv1a(r.key);
      if (!this.painted.has(h)) this.painted.set(h, { hue: r.hue, level: r.level, at: 0, faction: ownerOf(r.faction) });
    }
  }

  /** Once a rendered frame, by the loop that has the bus (CONTRACT.md section 6). */
  frame(_dt: number, simTime: number, utcMs: number, bus: { x: number; y: number; z: number }, camera: THREE.Camera): void {
    this.utc = utcMs;
    this.sim = simTime;
    this.lock?.tick(_dt);
    this.torpedoes?.tick(_dt);
    if (this.home && this.pools.group.parent !== this.home) this.home.add(this.pools.group);
    this.land(simTime);
    const ll = localToLatLon(bus.x, bus.z, this.origin, this.ll);
    this.send(utcMs, bus.x, bus.y, bus.z, ll[0], ll[1], REACH);
    if (bus.y < 1500) this.sampleGround(bus.x, bus.z);
    this.draw(utcMs, camera);
  }

  /**
   * People's ground (LIFE.md, "People"): the nearest tile in LAWN_REACH not sent yet, LAWN_ROWS rows of its 2 m cells a frame through the world's own queries, which
   * are grass and the ground's height there; sent to the worker whole, its arrays transferred, where the parks' areas say which grass is a park's. A tile not in yet
   * is tried again a second on; tiles past LAWN_FORGET are dropped. Two arrays a tile sampled, not a frame.
   */
  private sampleGround(bx: number, bz: number): void {
    const w = this.world;
    if (!w) return;
    this.frames++;
    const ts = w.tileSize, n = Math.round(ts / LAWN_CELL);
    if (!this.walking) {
      const ctx = Math.floor(bx / ts), ctz = Math.floor(bz / ts), R = Math.ceil(LAWN_REACH / ts);
      let bd = Infinity, btx = 0, btz = 0;
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++) {
          // (a key small enough to stay an integer in the engine, tiles within 4,096 of the origin: a bigger one is a boxed double each lookup in V8)
          const tx = ctx + dx, tz = ctz + dz, key = (tx + 4096) * 8192 + (tz + 4096);
          if (this.walked.has(key) || (this.walkLater.get(key) ?? 0) > this.frames) continue;
          const cx = (tx + 0.5) * ts - bx, cz = (tz + 0.5) * ts - bz, d = cx * cx + cz * cz;
          if (d < bd && d < (LAWN_REACH + ts * 0.71) ** 2) {
            bd = d;
            btx = tx;
            btz = tz;
          }
        }
      if (bd === Infinity) return;
      // (and the far ones dropped, here, where a tile's picked: not every frame)
      for (const k of this.walked) {
        const tx = Math.floor(k / 8192) - 4096, tz = (k % 8192) - 4096, cx = (tx + 0.5) * ts - bx, cz = (tz + 0.5) * ts - bz;
        if (cx * cx + cz * cz < LAWN_FORGET * LAWN_FORGET) continue;
        this.walked.delete(k);
        const m = this.walkMsg;
        m.tile = null;
        m.tx = tx;
        m.tz = tz;
        this.worker.postMessage(m);
      }
      this.walking = { key: (btx + 4096) * 8192 + (btz + 4096), tx: btx, tz: btz, j: 0, grass: new Uint8Array(n * n), h: new Float32Array(n * n), count: 0 };
    }
    const t = this.walking, x0 = t.tx * ts, z0 = t.tz * ts;
    for (let r = 0; r < LAWN_ROWS && t.j < n; r++, t.j++) {
      const z = z0 + (t.j + 0.5) * LAWN_CELL;
      for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.5) * LAWN_CELL, c = w.groundClassAt(x, z);
        if (c === null) {
          // (not in yet: again in a second or so)
          this.walkLater.set(t.key, this.frames + 30);
          this.walking = null;
          return;
        }
        const q = t.j * n + i, ok = c === Ground.GRASS;
        t.grass[q] = ok ? 1 : 0;
        if (ok) t.count++;
        t.h[q] = w.groundAt(x, z);
      }
    }
    if (t.j < n) return;
    this.walked.add(t.key);
    this.walkLater.delete(t.key);
    this.walking = null;
    if (!t.count) return;
    const m = this.walkMsg;
    m.tile = { tx: t.tx, tz: t.tz, x0, z0, cell: LAWN_CELL, n, grass: t.grass, h: t.h, count: t.count };
    m.tx = t.tx;
    m.tz = t.tz;
    this.worker.postMessage(m, [t.grass.buffer, t.h.buffer]);
    m.tile = null;
  }

  /** The flight's scene and lens, where the pools draw while its loop has the bus (moonrun.ts, once). */
  attachSky(scene: THREE.Object3D, camera: THREE.Camera): void {
    this.sky = scene;
    this.skyCam = camera;
  }

  /**
   * The same, from the flight's loop while it has the bus (CONTRACT.md section 6, O4). `ob`: the bus, Earth fixed (km), with the flight's render axes in that frame by rows;
   * the bus is at the render frame's origin, and a render unit is a metre. Over the Moon, or before attachSky, nothing draws.
   */
  frameSky(_dt: number, utcMs: number, ob: Observer): void {
    this.utc = utcMs;
    // (a breath on its way when the flight took the bus lands now: the street's game time stands while the flight has it)
    this.land(Infinity);
    const sky = this.sky;
    if (!sky || ob.body !== EARTH_ID || ob.free) {
      this.qa.sky = true;
      this.qa.drawn = 0;
      this.pc[0] = this.pc[1] = this.pc[2] = this.pc[3] = 0;
      this.commit(this.pc, 0, 0);
      return;
    }
    if (this.pools.group.parent !== sky) sky.add(this.pools.group);
    // (where the bus is on the map, for the worker: the sky over it, as far as the horizon)
    const g = this.g3;
    fixToGeodetic(ob.pos, g);
    const xz = latLonToLocal(g[0], g[1], this.origin, this.ll), h = Math.max(0, g[2] * 1000);
    this.send(utcMs, xz[0], h, xz[1], g[0], g[1], Math.max(REACH, Math.sqrt((2 * WGS_A * 1000 + h) * h)));
    this.drawSky(utcMs, ob);
  }

  /** Hits whose breath has arrived by `simTime` take, and are kept. */
  private land(simTime: number): void {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (simTime < h.arrive) continue;
      // (a level up keeps its contrail going from when it was first painted)
      const was = this.painted.get(h.h);
      this.painted.set(h.h, { hue: h.hue, level: h.level, at: was?.at ?? this.utc, faction: h.faction, show: h.show ? this.utc : was?.show });
      // (its kind says whether it's kept, KindInfo's kept: a picnic's paint and a car's are the session's, `picnic:` and `car:` live only while they're near,
      // CONTRACT.md section 3; a plane's namespace is `earth`, every other the place's)
      if (h.kept) this.store.put({ key: h.key, hue: h.hue, level: h.level, until: h.until, ns: h.key.startsWith('plane:') ? 'earth' : this.ns, ...(h.faction !== FACTION_RAINBOW ? { faction: h.faction } : {}) });
      this.hits.splice(i, 1);
    }
  }

  /** The worker's tick, at 10 Hz of the page's clock: the bus on the map (m) and where that is (degrees), for the relay. */
  private send(utcMs: number, x: number, y: number, z: number, lat: number, lon: number, reach: number): void {
    if (utcMs - this.sentAt < TICK_MS || !this.free.length) return;
    const t = this.tick;
    t.utcMs = this.sentAt = utcMs;
    t.x = x;
    t.y = y;
    t.z = z;
    t.lat = lat;
    t.lon = lon;
    t.reach = reach;
    t.buf = this.free.pop()!;
    this.worker.postMessage(t, [t.buf]);
    this.qa.sent++;
  }

  /** The models a pool drew this frame: small, middle, large. */
  private readonly pc = [0, 0, 0, 0];

  private commit(pc: number[], ns: number, n: number, nk = 0): void {
    const P = this.pools;
    P.small.commit(Math.min(pc[0], P.small.max));
    P.middle.commit(Math.min(pc[1], P.middle.max));
    P.large.commit(Math.min(pc[2], P.large.max));
    P.heavy.commit(Math.min(pc[3], P.heavy.max));
    P.specks.commit(ns);
    P.marks.commit(nk);
    this.qa.rows = n;
    this.qa.people = pc[0];
    this.qa.models = pc[0] + pc[1] + pc[2] + pc[3];
    this.qa.heavy = pc[3];
    this.qa.tris = pc[0] * this.trisOf[0] + pc[1] * this.trisOf[1] + pc[2] * this.trisOf[2] + pc[3] * this.trisOf[3];
    this.qa.specks = ns;
    this.qa.marks = nk;
    this.qa.dancers = this.dancers;
    this.dancers = 0;
    this.qa.bouncers = this.bouncers;
    this.bouncers = 0;
    this.qa.cars = this.cars;
    this.cars = 0;
    this.qa.boats = this.boats;
    this.boats = 0;
    this.qa.lights = this.lights;
    this.lights = 0;
    this.qa.tracks = this.trackRibbons;
    this.trackRibbons = 0;
  }

  /**
   * A painted mover's contrail (CONTRACT.md O6), ribbon `r`: back along its path from its tail, as far as it has flown since it took the paint and TRAIL_S s of it at
   * most, turned to the lens, wider a level up; at level 3 it runs through the paint's hues. In the drawing loop's frame: (ux, uy, uz) the way it's going, `half` its
   * half length (m), `near` the distance past which the loop draws a point nearer its lens (0: none). `wake`, a boat's length (m): a wake instead, flat on the water,
   * WAKE_W of that wide at the stern and spreading to three times it, in every hue at any level. False: nothing to draw yet.
   */
  private trail(r: number, x: number, y: number, z: number, ux: number, uy: number, uz: number, speed: number, half: number, paint: MoverPaint, cam: THREE.Vector3, ang: number, near: number, wake = 0): boolean {
    const bold = this.show(paint, wake ? SHOW_WAKE_S : SHOW_PLANE_S), flown = Math.min(TRAIL_S, Math.max(0, (this.utc - paint.at) / 1000));
    // (the show's ribbon is as long as the plane has flown since the hit, the whole minute of it)
    const L = speed * (wake || bold <= 0 ? flown : flown + (Math.max(flown, Math.min(SHOW_PLANE_S, (this.utc - paint.show!) / 1000)) - flown) * bold);
    if (L < 1) return false;
    const K = this.pools.marks, wpx0 = TRAIL_PX * (paint.level + 1), wpx = wake ? wpx0 : wpx0 + (Math.max(wpx0, RIBBON_PX) - wpx0) * bold;
    const wm = wake ? wake * WAKE_W * (1 + bold) : TRAIL_M + (RIBBON_M - TRAIL_M) * bold;
    for (let j = 0; j < MARK_POINTS; j++) {
      const t = j / (MARK_POINTS - 1), back = half + L * t;
      let px = x - ux * back, py = y - uy * back, pz = z - uz * back;
      if (wake) py += WAKE_LIFT;
      const tx = cam.x - px, ty = cam.y - py, tz = cam.z - pz, d = Math.sqrt(tx * tx + ty * ty + tz * tz);
      // (across its way: to the lens for a contrail, level across the water for a wake)
      let sx = wake ? -uz : uy * tz - uz * ty, sy = wake ? 0 : uz * tx - ux * tz, sz = wake ? ux : ux * ty - uy * tx;
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (sl < 1e-9) {
        sx = 0;
        sy = 1;
        sz = 0;
      } else {
        sx /= sl;
        sy /= sl;
        sz /= sl;
      }
      let w = 0.5 * Math.max(wake ? wm * (1 + 2 * t) : wm, wpx * d * ang);
      if (near > 0 && d > near) {
        const k = near / d;
        px = cam.x - tx * k;
        py = cam.y - ty * k;
        pz = cam.z - tz * k;
        w *= k;
      }
      const v = (r * MARK_POINTS + j) * 2, ramp = lookOf(paint.faction).spray[bold <= 0 && (paint.level >= 3 || wake) ? (paint.hue + Math.floor(t * 5.999)) % 6 : paint.hue];
      K.pos[v * 3] = px - sx * w;
      K.pos[v * 3 + 1] = py - sy * w;
      K.pos[v * 3 + 2] = pz - sz * w;
      K.pos[v * 3 + 3] = px + sx * w;
      K.pos[v * 3 + 4] = py + sy * w;
      K.pos[v * 3 + 5] = pz + sz * w;
      K.ramp[v] = K.ramp[v + 1] = ramp;
      K.age[v] = K.age[v + 1] = t;
    }
    return true;
  }

  /** How much of an aimed hit's show `paint` is in (0: none, 1: all of it), over `span` s from the hit and easing out over the last SHOW_EASE. */
  private show(paint: MoverPaint, span: number): number {
    if (!paint.show) return 0;
    const since = (this.utc - paint.show) / 1000;
    return since < 0 || since >= span ? 0 : Math.min(1, (span - since) / SHOW_EASE);
  }

  /**
   * A Torpedo's wake (Torpedo.ts), ribbon `r`: flat on the water from its head back to where it went in, torpedoTune.wakeW m wide at the head and spreading behind,
   * in its one colour; once it has ended the whole of it ages out over wakeFade s.
   */
  private torpedoWake(r: number, run: TorpedoRun, cam: THREE.Vector3, ang: number): boolean {
    const T = torpedoTune, dx = run.x0 - run.x, dz = run.z0 - run.z, len = Math.sqrt(dx * dx + dz * dz);
    if (len < 2) return false;
    const K = this.pools.marks, sx = -dz / len, sz = dx / len, py = run.y + WAKE_LIFT, fade = run.done < 0 ? 0 : run.done / T.wakeFade;
    const ramp = lookOf(ownerOf(run.faction)).spray[run.hue % 6];
    for (let j = 0; j < MARK_POINTS; j++) {
      const t = j / (MARK_POINTS - 1), px = run.x + dx * t, pz = run.z + dz * t;
      const d = Math.sqrt((cam.x - px) ** 2 + (cam.y - py) ** 2 + (cam.z - pz) ** 2);
      const w = 0.5 * Math.max(T.wakeW * (1 + (T.wakeSpread - 1) * t), T.wakePx * d * ang), v = (r * MARK_POINTS + j) * 2;
      K.pos[v * 3] = px - sx * w;
      K.pos[v * 3 + 1] = py;
      K.pos[v * 3 + 2] = pz - sz * w;
      K.pos[v * 3 + 3] = px + sx * w;
      K.pos[v * 3 + 4] = py;
      K.pos[v * 3 + 5] = pz + sz * w;
      K.ramp[v] = K.ramp[v + 1] = ramp;
      K.age[v] = K.age[v + 1] = Math.min(1, t * 0.85 + fade);
    }
    return true;
  }

  private draw(utcMs: number, camera: THREE.Camera): void {
    const s = this.snap, P = this.pools, cam = camera.position, ang = Math.max(1e-6, globals.uPixelAngle.value as number);
    // (the street's lens draws to 36 km and the sky is filled to 80: past nine tenths of its reach a mover is drawn nearer on its own line of sight, as the flight's are,
    // so a painted plane keeps its pixel out there; the haze has the rest by then)
    const near = 0.9 * ((camera as THREE.PerspectiveCamera).far || SKY_NEAR);
    let ns = 0, n = 0, nd = 0, nk = 0;
    const pc = this.pc, lit = (heldGlobals.uLit.value as number) > 0;
    pc[0] = pc[1] = pc[2] = pc[3] = 0;
    this.qMap.identity();
    this.drawFrames++;
    this.dancing = 0;
    // (the lens's view: what's outside it isn't drawn or uploaded, the first account's life review M5: every instance went up wherever it was)
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (s) {
      const rows = s.rows, u32 = s.rowsU32, dt = (utcMs - s.f64[0]) / 1000, sp = P.specks;
      n = s.u32[2];
      for (let i = 0; i < n; i++) {
        const o = i * ROW, info = KINDS[rows[o + Col.KIND]];
        if (!info) continue;
        const x0 = rows[o + Col.X] + rows[o + Col.VX] * dt, y0 = rows[o + Col.Y] + rows[o + Col.VY] * dt, z0 = rows[o + Col.Z] + rows[o + Col.VZ] * dt;
        const paint = this.painted.get(u32[o + Col.KEY]);
        // (painted life comes alive, LIVING.md: a painted picnic's people get up off the blanket, turn to the bus and dance)
        const alive = paint !== undefined && rows[o + Col.KIND] === Kind.PICNIC;
        const dx = x0 - cam.x, dy = y0 - cam.y, dz = z0 - cam.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let scale = rows[o + Col.SCALE], x = x0, y = y0, z = z0;
        const size = this.sizeOf(o, info), px = (size * scale) / (Math.max(1, d) * ang);
        if (d < near) {
          this.sphere.center.set(x0, y0, z0);
          this.sphere.radius = size * scale + 2;
          if (!this.frustum.intersectsSphere(this.sphere)) continue;
        }
        // (a grey vehicle in its own tone, white, silver, grey or black)
        const ramp = paint ? lookOf(paint.faction).body[paint.hue] : info.track ? VEHICLE_TONES[(rows[o + Col.LOOK] >> 6) & 3] : GREY_RAMP;
        if (d > near) {
          const k = near / d;
          x = cam.x + dx * k;
          y = cam.y + dy * k;
          z = cam.z + dz * k;
          scale *= k;
        }
        if (px >= MODEL_PX) {
          const k = pc[info.pool];
          if (k >= P.pool(info.pool).max) continue;
          this.put(P.pool(info.pool), k, o, x, y, z, scale, ramp);
          if (alive && px >= DANCE_PX) this.party(k, o, x, y, z, scale, cam, utcMs);
          else if (paint && (info.track || info.wake)) y += this.bounce(P.pool(info.pool), k, o, x, y, z, scale, utcMs, !!info.wake);
          pc[info.pool]++;
          // (a car's lights at night while its model's lamps are too small to see: a speck at its nose, which its body hides from behind)
          if (lit && info.nose && px < LAMP_PX && ns < SPECKS_MAX) {
            const h = rows[o + Col.HEADING], pt = rows[o + Col.PITCH], cp = Math.cos(pt) * info.nose * scale;
            sp.pos[ns * 3] = x + Math.cos(h) * cp;
            sp.pos[ns * 3 + 1] = y + Math.sin(pt) * info.nose * scale + CAR_LAMP_Y * scale;
            sp.pos[ns * 3 + 2] = z + Math.sin(h) * cp;
            sp.ramp[ns] = ramp;
            sp.phase[ns] = 2;
            ns++;
            this.lights++;
          }
        } else if ((paint || px >= (lit && info.lights ? LIT_PX : 1)) && ns < SPECKS_MAX) {
          sp.pos[ns * 3] = x;
          sp.pos[ns * 3 + 1] = y;
          sp.pos[ns * 3 + 2] = z;
          sp.ramp[ns] = ramp;
          sp.phase[ns] = info.beacon ? (u32[o + Col.KEY] & 1023) / 1024 : info.lights ? 2 : -1;
          ns++;
          if (lit && info.lights) this.lights++;
        } else continue;
        if (info.track) this.cars++;
        else if (info.wake) this.boats++;
        this.note(nd++, u32[o + Col.KEY], x, y, z);
        if (paint && info.track && nk + 2 <= MARKS_MAX) nk += this.tracks(nk, u32[o + Col.KEY], o, x0, y0, z0, rows[o + Col.SCALE], paint, cam, ang);
        if (paint && info.wake && nk < MARKS_MAX) nk += this.tracks(nk, u32[o + Col.KEY], o, x0, y0, z0, rows[o + Col.SCALE], paint, cam, ang, info.size * rows[o + Col.SCALE]);
        if (paint && info.mark && nk < MARKS_MAX) {
          const vx = rows[o + Col.VX], vy = rows[o + Col.VY], vz = rows[o + Col.VZ], v = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (v > 1 && this.trail(nk, x0, y0, z0, vx / v, vy / v, vz / v, v, 0.5 * info.size * rows[o + Col.SCALE], paint, cam, ang, near)) nk++;
        }
      }
    }
    // (the Torpedoes' wakes, with what ribbons are left)
    if (this.torpedoes) for (const run of this.torpedoes.runs) if (run.live && run.key && nk < MARKS_MAX && this.torpedoWake(nk, run, cam, ang)) nk++;
    this.qa.sky = false;
    this.qa.drawn = Math.min(nd, DRAWN);
    this.commit(pc, ns, n, nk);
  }

  private note(i: number, hash: number, x: number, y: number, z: number): void {
    if (i >= DRAWN) return;
    const d = this.drawn;
    d[i * 4] = hash;
    d[i * 4 + 1] = x;
    d[i * 4 + 2] = y;
    d[i * 4 + 3] = z;
  }

  /** A model's instance: row `o` of the snapshot at (x, y, z) in the drawing loop's frame, its map heading turned into that frame by qMap. */
  private put(pool: Pools['large'], k: number, o: number, x: number, y: number, z: number, scale: number, ramp: number): void {
    const rows = this.snap!.rows, key = this.snap!.rowsU32[o + Col.KEY];
    this.e.set(rows[o + Col.BANK], -rows[o + Col.HEADING], rows[o + Col.PITCH]);
    this.q.setFromEuler(this.e).premultiply(this.qMap);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(scale, scale, scale));
    this.m.toArray(pool.mesh.instanceMatrix.array as Float32Array, k * 16);
    pool.kind[k] = rows[o + Col.KIND];
    pool.ramp[k] = ramp;
    pool.glint[k] = key === this.glintHash || key === this.lockHash ? config.splat.glintLift * (KINDS[rows[o + Col.KIND]]?.onLine ? GROUND_GLINT : 1) : 0;
    pool.surf[k] = (key & 0xffff) / 65536;
    pool.look[k] = rows[o + Col.LOOK];
  }

  /**
   * A painted picnic, `put` already at small-pool instance k: its people up off the blanket, which keeps its basket and umbrella, each dancing where they sat or lay,
   * a little bigger than they were and a beat behind the last, as instances of their own after the group's.
   */
  private party(k: number, o: number, x: number, y: number, z: number, scale: number, cam: THREE.Vector3, utcMs: number): void {
    const P = this.pools.small, rows = this.snap!.rows, look = rows[o + Col.LOOK], h = rows[o + Col.HEADING], c = Math.cos(h), sn = Math.sin(h);
    // (one past the frame's dancers stays sitting on the blanket, in its paint: never an empty blanket, the day review's M15)
    let sat = look;
    for (let j = 0, b = 1; j < 4; j++, b <<= 1) {
      if (!(look & b) || this.pc[0] + 1 >= P.max || this.dancing >= DANCERS_MOST) continue;
      sat &= ~b;
      P.look[k] = sat;
      this.dancing++;
      const ox = DANCE_AT[j * 2] * scale, oz = DANCE_AT[j * 2 + 1] * scale;
      this.dance(P, ++this.pc[0], o, x + ox * c - oz * sn, y, z + ox * sn + oz * c, scale * DANCER, cam, utcMs, j * DANCE_BEAT);
    }
  }

  /**
   * A dancer, small-pool instance k, for row o's painted picnic: turned to the lens, a hop on its group's beat (its key's) and `beat` behind it, about 1.7 a second
   * and 0.3 m high, both arms up over the top half of it. Returns the hop's lift (m).
   */
  private dance(pool: Pools['small'], k: number, o: number, x: number, y: number, z: number, scale: number, cam: THREE.Vector3, utcMs: number, beat = 0): number {
    const key = this.snap!.rowsU32[o + Col.KEY], up = Math.abs(Math.sin(Math.PI * ((utcMs / 1000) * 1.7 + (key & 255) / 256 + beat))), lift = 0.3 * up * scale;
    // (the model faces +X, a heading turned as the worker's: atan2 of the way it faces)
    this.e.set(0, -Math.atan2(cam.z - z, cam.x - x), 0);
    this.q.setFromEuler(this.e).premultiply(this.qMap);
    this.m.compose(this.p.set(x, y + lift, z), this.q, this.s.set(scale, scale, scale));
    this.m.toArray(pool.mesh.instanceMatrix.array as Float32Array, k * 16);
    pool.kind[k] = up > 0.5 ? Kind.CHEER : Kind.PERSON;
    // (its group's paint, the instance before it or the dancer before that)
    pool.ramp[k] = pool.ramp[k - 1];
    pool.glint[k] = 0;
    pool.surf[k] = pool.surf[k - 1];
    pool.look[k] = 0;
    const D = this.danced;
    D[0] = key;
    D[1] = x;
    D[2] = y + lift;
    D[3] = z;
    D[4] = pool.kind[k];
    this.dancers++;
    return lift;
  }

  /**
   * A painted car's instance, `put` already, made to bounce (LIVING.md: painted life comes alive): a hop on its own beat (its key's), about 2.2 a second and 0.3 m
   * high, squashed as it lands and stretched as it leaves, its nose nodding and its body rocking. A boat (`rock`) rides a swell instead, about once in 1.6 s, its bow
   * and its sides rising and falling in turn, a metre a 40 m of it. Returns the lift (m).
   */
  private bounce(pool: Pools['middle'], k: number, o: number, x: number, y: number, z: number, scale: number, utcMs: number, rock = false): number {
    const rows = this.snap!.rows, key = this.snap!.rowsU32[o + Col.KEY], beat = (utcMs / 1000) * (rock ? 0.62 : 2.2) + (key & 255) / 256;
    const up = rock ? 0.5 + 0.5 * Math.sin(2 * Math.PI * beat) : Math.abs(Math.sin(Math.PI * beat)), lift = (rock ? 0.025 * KINDS[rows[o + Col.KIND]].size : 0.3) * up * scale;
    const sq = rock ? 0 : (1 - up) ** 3, a = rock ? 1.6 : 1;
    this.e.set(rows[o + Col.BANK] + 0.05 * a * Math.sin(Math.PI * beat * (rock ? 2 : 1) + (rock ? 1.3 : 0)), -rows[o + Col.HEADING], rows[o + Col.PITCH] + 0.07 * (rock ? 0.6 : 1) * Math.sin(2 * Math.PI * beat));
    this.q.setFromEuler(this.e).premultiply(this.qMap);
    const sy = rock ? 1 : 1.06 - 0.22 * sq, sxz = rock ? 1 : 0.97 + 0.11 * sq;
    this.m.compose(this.p.set(x, y + lift, z), this.q, this.s.set(scale * sxz, scale * sy, scale * sxz));
    this.m.toArray(pool.mesh.instanceMatrix.array as Float32Array, k * 16);
    const B = this.bounced;
    B[0] = key;
    B[1] = x;
    B[2] = y + lift;
    B[3] = z;
    B[4] = sy;
    this.bouncers++;
    return lift;
  }

  /**
   * A painted car's tyre tracks (KindInfo's track), ribbons `r` and `r + 1`: two lines flat on the road from its rear axle back along where it has been, a point every
   * TRACK_STEP m to MARK_POINTS of them, each stretch its own hue round all six where it was laid, the oldest end fading first. Row `o` at (x, y, z), the street's frame.
   * False: it has no road behind it yet, or no ring is free.
   */
  private tracks(r: number, hash: number, o: number, x: number, y: number, z: number, scale: number, paint: MoverPaint, cam: THREE.Vector3, ang: number, wake = 0): number {
    // (a wake, `wake` the boat's length: one ribbon from its stern, a point every 0.3 of its length, its width spreading with age, laid on the water where the boat
    // went, not a bar swung with it: the first account's life review, M6. Its heading is its line either way for a ferry, so its stern is behind its going)
    const R = MARK_POINTS - 1, rows = this.snap!.rows, vx = rows[o + Col.VX], vz = rows[o + Col.VZ], vv = Math.sqrt(vx * vx + vz * vz);
    const bold = wake ? this.show(paint, SHOW_WAKE_S) : 0;
    const h = rows[o + Col.HEADING], fx = wake && vv > 0.3 ? vx / vv : Math.cos(h), fz = wake && vv > 0.3 ? vz / vv : Math.sin(h);
    const kAxle = KINDS[rows[o + Col.KIND]].axle, rear = wake ? wake / (2 * scale) : (kAxle ? kAxle[0] : 1.35), wheel = wake ? 0 : (kAxle ? kAxle[1] : 0.72);
    const ax = x - fx * rear * scale, az = z - fz * rear * scale;
    const STEP = wake ? Math.max(4, wake * 0.3) : TRACK_STEP, sides = wake ? 1 : 2;
    // (its ring, or a free one: else the one not drawn longest, if it's a second gone)
    let t = -1, old = -1;
    for (let i = 0; i < TRACKS; i++) {
      if (this.trackOf[i] === hash) {
        t = i;
        break;
      }
      if (old < 0 || this.trackSeen[i] < this.trackSeen[old]) old = i;
    }
    if (t < 0) {
      if (this.trackOf[old] !== 0 && this.trackSeen[old] > this.drawFrames - 60) return 0;
      t = old;
      this.trackOf[t] = hash;
      this.trackN[t] = this.trackAll[t] = this.trackHead[t] = 0;
    }
    this.trackSeen[t] = this.drawFrames;
    const T = this.trackPts, base = t * R * 3;
    let q = base + this.trackHead[t] * 3;
    const moved = (ax - T[q]) ** 2 + (az - T[q + 2]) ** 2;
    // (a jump, a car not drawn for a while: its track starts again where it is)
    if (moved > 9 * STEP * STEP) this.trackN[t] = 0;
    if (!this.trackN[t] || moved >= STEP * STEP) {
      this.trackHead[t] = (this.trackHead[t] + 1) % R;
      q = base + this.trackHead[t] * 3;
      T[q] = ax;
      T[q + 1] = y;
      T[q + 2] = az;
      this.trackN[t] = Math.min(R, this.trackN[t] + 1);
      this.trackAll[t]++;
    }
    const n = this.trackN[t];
    if (n < 2) return 0;
    const K = this.pools.marks, head = this.trackHead[t], all = this.trackAll[t], L = this.trackLay;
    // (point j: the axle now, then the ring newest first; past its oldest, the oldest again, a stretch of nothing)
    L[0] = ax;
    L[1] = y;
    L[2] = az;
    for (let j = 1; j < MARK_POINTS; j++) {
      const p = base + ((head - Math.min(j, n) + 1 + R) % R) * 3;
      L[j * 3] = T[p];
      L[j * 3 + 1] = T[p + 1];
      L[j * 3 + 2] = T[p + 2];
    }
    for (let j = 0; j < MARK_POINTS; j++) {
      const px = L[j * 3], py = L[j * 3 + 1] + (wake ? WAKE_LIFT : TRACK_LIFT), pz = L[j * 3 + 2], a = Math.max(0, j - 1) * 3, b = Math.min(MARK_POINTS - 1, j + 1) * 3;
      // (across the road there: square to the way between its neighbours, else the car's)
      let dx = L[a] - L[b], dz = L[a + 2] - L[b + 2];
      const dl = Math.sqrt(dx * dx + dz * dz);
      if (dl < 1e-3) {
        dx = fx;
        dz = fz;
      } else {
        dx /= dl;
        dz /= dl;
      }
      const age = j / (MARK_POINTS - 1), sx = -dz, sz = dx, d = Math.sqrt((cam.x - px) ** 2 + (cam.y - py) ** 2 + (cam.z - pz) ** 2);
      const w = 0.5 * Math.max(wake ? wake * WAKE_W * (1 + bold) * (1 + 2 * age) : TRACK_M, TRACK_PX * d * ang);
      // (an aimed hit's show: the wake in the one colour)
      const ramp = lookOf(paint.faction).spray[bold > 0 ? paint.hue : (paint.hue + all - Math.min(j, n) + 600) % 6];
      for (let side = 0; side < sides; side++) {
        const off = (side ? -wheel : wheel) * scale, cx = px + sx * off, cz = pz + sz * off, v = ((r + side) * MARK_POINTS + j) * 2;
        K.pos[v * 3] = cx - sx * w;
        K.pos[v * 3 + 1] = py;
        K.pos[v * 3 + 2] = cz - sz * w;
        K.pos[v * 3 + 3] = cx + sx * w;
        K.pos[v * 3 + 4] = py;
        K.pos[v * 3 + 5] = cz + sz * w;
        K.ramp[v] = K.ramp[v + 1] = ramp;
        K.age[v] = K.age[v + 1] = age;
      }
    }
    this.trackRibbons++;
    return sides;
  }

  /** The snapshot's rows Earth fixed, once a snapshot: each place exactly (the map's projection, then the ellipsoid), each velocity along the map's axes at its origin. */
  private toFix(s: SnapView): void {
    const rows = s.rows, n = s.u32[2], F = this.fix, A = this.ax, ll = this.ll, f = this.f3;
    for (let i = 0; i < n; i++) {
      const o = i * ROW, q = i * 6;
      localToLatLon(rows[o + Col.X], rows[o + Col.Z], this.origin, ll);
      geodeticToFix(ll[0], ll[1], rows[o + Col.Y] / 1000, f);
      F[q] = f[0];
      F[q + 1] = f[1];
      F[q + 2] = f[2];
      const vx = rows[o + Col.VX] / 1000, vy = rows[o + Col.VY] / 1000, vz = rows[o + Col.VZ] / 1000;
      for (let j = 0; j < 3; j++) F[q + 3 + j] = vx * A[j] + vy * A[3 + j] + vz * A[6 + j];
    }
    this.fixFor = s;
  }

  /** The flight's loop: each mover from Earth fixed into the render frame, none behind the Earth, the far ones drawn nearer the lens as big as they are. */
  private drawSky(utcMs: number, ob: Observer): void {
    const s = this.snap, P = this.pools, cam = this.skyCam!.position, ang = Math.max(1e-6, globals.uPixelAngle.value as number);
    let ns = 0, n = 0, nd = 0, nk = 0;
    const pc = this.pc;
    pc[0] = pc[1] = pc[2] = pc[3] = 0;
    if (s) {
      if (this.fixFor !== s) this.toFix(s);
      const R = ob.axes, b = ob.pos, F = this.fix, A = this.ax, rows = s.rows, u32 = s.rowsU32, dt = (utcMs - s.f64[0]) / 1000, sp = P.specks;
      // (the map's axes in the render frame, for the models' headings: render <- fixed <- map, at the map's origin, near enough over the place's sky. Column k is map axis k)
      const me = this.mapRot.elements;
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) me[k * 4 + j] = R[j * 3] * A[k * 3] + R[j * 3 + 1] * A[k * 3 + 1] + R[j * 3 + 2] * A[k * 3 + 2];
      this.qMap.setFromRotationMatrix(this.mapRot);
      // (the bus with the ellipsoid stretched to a sphere: a mover is behind the Earth if the line to it passes inside)
      const ox = b[0], oy = b[1], oz = b[2] * WGS_K, a2 = WGS_A * WGS_A;
      n = s.u32[2];
      for (let i = 0; i < n; i++) {
        const o = i * ROW, q = i * 6, info = KINDS[rows[o + Col.KIND]];
        if (!info) continue;
        const ex = F[q] + F[q + 3] * dt - b[0], ey = F[q + 1] + F[q + 4] * dt - b[1], ez = F[q + 2] + F[q + 5] * dt - b[2];
        const sz = ez * WGS_K, dd = ex * ex + ey * ey + sz * sz, t = dd > 0 ? -(ox * ex + oy * ey + oz * sz) / dd : 0;
        if (t > 0 && t < 1) {
          const cx = ox + ex * t, cy = oy + ey * t, cz = oz + sz * t;
          if (cx * cx + cy * cy + cz * cz < a2) continue;
        }
        let x = (R[0] * ex + R[1] * ey + R[2] * ez) * 1000, y = (R[3] * ex + R[4] * ey + R[5] * ez) * 1000, z = (R[6] * ex + R[7] * ey + R[8] * ez) * 1000;
        const lx = x - cam.x, ly = y - cam.y, lz = z - cam.z, d = Math.sqrt(lx * lx + ly * ly + lz * lz);
        const x0 = x, y0 = y, z0 = z;
        let scale = rows[o + Col.SCALE];
        const px = (this.sizeOf(o, info) * scale) / (Math.max(1, d) * ang), paint = this.painted.get(u32[o + Col.KEY]);
        const ramp = paint ? lookOf(paint.faction).body[paint.hue] : info.track ? VEHICLE_TONES[(rows[o + Col.LOOK] >> 6) & 3] : GREY_RAMP;
        if (!paint && px < 1) continue;
        if (d > SKY_NEAR) {
          const k = SKY_NEAR / d;
          x = cam.x + lx * k;
          y = cam.y + ly * k;
          z = cam.z + lz * k;
          scale *= k;
        }
        if (px >= MODEL_PX) {
          const k = pc[info.pool];
          if (k >= P.pool(info.pool).max) continue;
          this.put(P.pool(info.pool), k, o, x, y, z, scale, ramp);
          pc[info.pool]++;
        } else if (ns < SPECKS_MAX) {
          sp.pos[ns * 3] = x;
          sp.pos[ns * 3 + 1] = y;
          sp.pos[ns * 3 + 2] = z;
          sp.ramp[ns] = ramp;
          sp.phase[ns] = info.beacon ? (u32[o + Col.KEY] & 1023) / 1024 : -1;
          ns++;
        } else continue;
        this.note(nd++, u32[o + Col.KEY], x, y, z);
        if (paint && info.mark && nk < MARKS_MAX) {
          // (its velocity into the render frame, and the ribbon laid from where it truly is, each point nearer the lens on its own line of sight if it's far)
          const wx = F[q + 3], wy = F[q + 4], wz = F[q + 5], vx = R[0] * wx + R[1] * wy + R[2] * wz, vy = R[3] * wx + R[4] * wy + R[5] * wz, vz = R[6] * wx + R[7] * wy + R[8] * wz;
          const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (v > 1e-3 && this.trail(nk, x0, y0, z0, vx / v, vy / v, vz / v, v * 1000, 0.5 * info.size * rows[o + Col.SCALE], paint, cam, ang, SKY_NEAR)) nk++;
        }
      }
    }
    this.qa.sky = true;
    this.qa.drawn = Math.min(nd, DRAWN);
    this.commit(pc, ns, n, nk);
  }

  /**
   * The aim (CONTRACT.md section 3): the mover nearest the line from (ox, oy, oz) along (dx, dy, dz), the ray to the aim point, where it will be when a breath
   * flying the whole ray in `travel` s reaches it; within pickR of the line, widening with the distance, plus its own half size. Null: none. The answer is one
   * object, filled again each call.
   */
  aim(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pickR: number, travel: number, ground = true): MoverTarget | null {
    const s = this.snap;
    if (!s) return null;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1) return null;
    const ux = dx / L, uy = dy / L, uz = dz / L, speed = L / Math.max(0.05, travel), rows = s.rows, u32 = s.rowsU32, n = s.u32[2];
    const ang = Math.max(1e-6, globals.uPixelAngle.value as number);
    const t0 = (this.utc - s.f64[0]) / 1000;
    let best = -1, bestD = Infinity, bx = 0, by = 0, bz = 0, bt = 0, bR = 0, bHalf = 0;
    for (let i = 0; i < n; i++) {
      const o = i * ROW, info = KINDS[rows[o + Col.KIND]];
      if (!info || (info.onLine && !ground)) continue;
      const vx = rows[o + Col.VX], vy = rows[o + Col.VY], vz = rows[o + Col.VZ];
      let x = rows[o + Col.X] + vx * t0, y = rows[o + Col.Y] + vy * t0, z = rows[o + Col.Z] + vz * t0;
      let along = (x - ox) * ux + (y - oy) * uy + (z - oz) * uz;
      // (one on the line alone may stand past its end, ON_LINE_PAST at most: the line ends on the obstacle grid, roofs plus 3 m, which stands over the
      // sidewalk by a building, so the street under it is on the line too; whether a wall stands between is the aim's, Aim.clearTo)
      if (along <= 0 || along > (info.onLine ? L + ON_LINE_PAST : L * 1.25)) continue;
      // (where it is when the breath gets there: once round is near enough at a plane's speed against the breath's)
      const tt = along / speed;
      x += vx * tt;
      y += vy * tt;
      z += vz * tt;
      along = (x - ox) * ux + (y - oy) * uy + (z - oz) * uz;
      const px = x - ox - ux * along, py = y - oy - uy * along, pz = z - oz - uz * along, d = Math.sqrt(px * px + py * py + pz * pz);
      const half = 0.5 * this.sizeOf(o, info) * rows[o + Col.SCALE];
      const R = info.onLine ? 1 + 1.2 * half + along * ang * GROUND_PX : pickR + half + along * 0.02;
      if (d > R || d >= bestD || !this.keys.has(u32[o + Col.KEY])) continue;
      bHalf = half;
      best = i;
      bestD = d;
      bx = x;
      by = y;
      bz = z;
      bt = tt;
      bR = R;
    }
    if (best < 0) return null;
    const t = this.target;
    t.key = this.keys.get(u32[best * ROW + Col.KEY])!;
    t.x = bx;
    t.y = by;
    t.z = bz;
    t.arrive = this.sim + bt;
    t.pickR = bR;
    t.onLine = KINDS[rows[best * ROW + Col.KIND]]?.onLine === true;
    t.miss = bestD;
    t.half = bHalf;
    return t;
  }

  /** Row o's long size before its scale (m): its kind's, a truck's by its look (the first account's life review, n4: a semi read as 12 m). */
  private sizeOf(o: number, info: (typeof KINDS)[number]): number {
    const rows = this.snap!.rows;
    return rows[o + Col.KIND] === Kind.TRUCK ? TRUCK_LEN[(rows[o + Col.LOOK] & 7) % 5] : info.size;
  }

  /**
   * A splat's blast (CONTRACT.md section 3; the shots' plan, SHOTS.md: "the splat is 85 m across at roof height and paints every car, person, picnic and boat inside
   * it, each tap still one level"): every mover inside the blast's circle when it lands, at `arrive` (game time), takes paint as a building in it would, a fresh
   * one the blast's hue at level 1 and a painted one a level up, each the blast's `faction` (C15). The circle is (x, z) and `r` round it on the ground, a column
   * from under the street to BLAST_OVER m over the blast's height (y), so a splat on a roof paints the cars in the street below it and never a plane overhead. A
   * mover the same breath already hit (its pending hit lands at this `arrive`) isn't hit twice. A super's blasts (a Hose's pour, a Bomb, MEGA) take a mover one
   * level in all, as a pour takes a building (the day review's m22: a dozen a second took a car from 1 to 3 in a quarter second); a ring's (`superTag.inner`,
   * Sonic Boom's) leaves the movers in its hole alone, so only those under its band take paint (HOOKS.md, "The extras").
   */
  blast(x: number, y: number, z: number, r: number, hue: number, superTag: SuperTag | undefined, arrive: number, faction: number): void {
    const s = this.snap;
    if (!s) return;
    const rows = s.rows, u32 = s.rowsU32, n = s.u32[2], dt = (this.utc - s.f64[0]) / 1000 + Math.max(0, arrive - this.sim), hole = superTag?.inner ?? 0;
    let took: Set<number> | null = null;
    if (superTag) {
      took = this.superTook.get(superTag.id) ?? null;
      if (!took) {
        took = new Set();
        this.superTook.set(superTag.id, took);
        // (the last few supers only: a pour's blasts come within its 3 s)
        if (this.superTook.size > SUPERS_KEPT) this.superTook.delete(this.superTook.keys().next().value!);
      }
    }
    for (let i = 0; i < n; i++) {
      const o = i * ROW, info = KINDS[rows[o + Col.KIND]];
      if (!info) continue;
      const my = rows[o + Col.Y] + rows[o + Col.VY] * dt;
      if (my > y + BLAST_OVER || my < y - BLAST_UNDER) continue;
      const dx = rows[o + Col.X] + rows[o + Col.VX] * dt - x, dz = rows[o + Col.Z] + rows[o + Col.VZ] * dt - z;
      const R = r + 0.5 * info.size * rows[o + Col.SCALE], h = u32[o + Col.KEY];
      if (dx * dx + dz * dz > R * R || (hole > 0 && dx * dx + dz * dz < hole * hole) || took?.has(h)) continue;
      const key = this.keys.get(h);
      if (!key || this.pendingAt(h, arrive)) continue;
      took?.add(h);
      this.hit(key, hue, this.utc, arrive, faction);
    }
  }

  /** The movers each recent super's blasts took (its SuperTag's id: the hashes), so each takes one level a super. */
  private readonly superTook = new Map<number, Set<number>>();

  /** A hit on mover `h` already on its way, landing at `arrive`. */
  private pendingAt(h: number, arrive: number): boolean {
    for (const q of this.hits) if (q.h === h && Math.abs(q.arrive - arrive) < 0.05) return true;
    return false;
  }

  /**
   * Curb's road side (Curb.ts; SHOTS.md, "Curb"): one frame of the bus rolling on its lane, pacing the car beside it, into `out`. The first account's Curb flight
   * calls it after `curb.land(...)` has the lane; false when there's none.
   */
  curbRoll(dt: number, push: number, look: number, out: CurbPose): boolean {
    const s = this.snap;
    return this.curb.roll(dt, push, look, s, s ? (this.utc - s.f64[0]) / 1000 : 0, this.keys, out, this.painted);
  }

  /** A key's hash, as the rows carry it (QA). */
  keyHash(key: string): number {
    return fnv1a(key);
  }

  /** Lock-on for boats and planes (Lock.ts; SHOTS.md, "Lock-on"): its handler on the shots' holds. main.ts's life block calls it once. */
  lockOn(host: LockHost): LifeLock {
    this.lock = new LifeLock(this, host);
    return this.lock;
  }

  /**
   * Lock-on's pick: the ferry or sailboat within 1.5 km of the bus, or the plane out to 12 km (`planes`: planes only), on the screen, in sight, nearest screen
   * point (sx, sy) within 48 px or its drawn size's half and 16 px more. Its key and where it is into `out`.
   */
  pickLock(sx: number, sy: number, holds: Holds, planes: boolean, out: LockPick): boolean {
    const s = this.snap;
    if (!s) return false;
    const rows = s.rows, u32 = s.rowsU32, n = s.u32[2], dt = (this.utc - s.f64[0]) / 1000, ang = Math.max(1e-6, globals.uPixelAngle.value as number), T = lockTune;
    const bus = holds.bus(this.lockV.set(0, 0, 0)), bx = bus.x, by = bus.y, bz = bus.z;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * ROW, kind = rows[o + Col.KIND], plane = kind === Kind.AIRLINER || kind === Kind.SMALL_PLANE;
      if (!plane && (planes || (kind !== Kind.FERRY && kind !== Kind.SAILBOAT))) continue;
      const v = this.lockV.set(rows[o + Col.X] + rows[o + Col.VX] * dt, rows[o + Col.Y] + rows[o + Col.VY] * dt, rows[o + Col.Z] + rows[o + Col.VZ] * dt);
      const range = Math.hypot(v.x - bx, v.y - by, v.z - bz);
      if (range > (plane ? T.planeReach : T.boatReach) || !holds.screenOf(v, this.lockS)) continue;
      const info = KINDS[kind]!, cam = Math.max(1, range), size = (this.sizeOf(o, info) * rows[o + Col.SCALE]) / (cam * ang);
      const d = Math.hypot(this.lockS.x - sx, this.lockS.y - sy);
      if (d > Math.max(T.pickPx, size / 2 + T.sizePx) || d >= bestD || !holds.inSight(v)) continue;
      best = i;
      bestD = d;
    }
    if (best < 0) return false;
    const o = best * ROW, key = this.keys.get(u32[o + Col.KEY]);
    if (!key) return false;
    out.key = key;
    out.plane = rows[o + Col.KIND] === Kind.AIRLINER || rows[o + Col.KIND] === Kind.SMALL_PLANE;
    out.at.set(rows[o + Col.X] + rows[o + Col.VX] * dt, rows[o + Col.Y] + rows[o + Col.VY] * dt, rows[o + Col.Z] + rows[o + Col.VZ] * dt);
    this.lockRow = best;
    return true;
  }

  /** Where the mover keyed `key` is now (world m into `out`), from the snapshot as it moves; false: it's gone from it. */
  moverAt(key: string, out: THREE.Vector3): boolean {
    const s = this.snap;
    if (!s) return false;
    const rows = s.rows, u32 = s.rowsU32, n = s.u32[2], h = fnv1a(key);
    let r = this.lockRow;
    if (r < 0 || r >= n || u32[r * ROW + Col.KEY] !== h) {
      r = -1;
      for (let i = 0; i < n; i++)
        if (u32[i * ROW + Col.KEY] === h) {
          r = i;
          break;
        }
      this.lockRow = r;
    }
    if (r < 0) return false;
    const o = r * ROW, dt = (this.utc - s.f64[0]) / 1000;
    out.set(rows[o + Col.X] + rows[o + Col.VX] * dt, rows[o + Col.Y] + rows[o + Col.VY] * dt, rows[o + Col.Z] + rows[o + Col.VZ] * dt);
    return true;
  }

  /** The velocity of the mover moverAt last found (world m/s into `out`): a homing shot's lead (HomingOpts.vel). Ask moverAt first. */
  moverVel(out: THREE.Vector3): void {
    const s = this.snap, r = this.lockRow;
    if (!s || r < 0 || r >= s.u32[2]) {
      out.set(0, 0, 0);
      return;
    }
    const rows = s.rows, o = r * ROW;
    out.set(rows[o + Col.VX], rows[o + Col.VY], rows[o + Col.VZ]);
  }

  /** The lock's glint on `key`, or none: it shows over whatever the aim glints. */
  lockGlint(key: string | null): void {
    this.lockHash = key ? fnv1a(key) : 0;
  }

  /** A lock's homing shot reached `key`: its paint at once, as a breath's (hit), and its show (a plane's ribbon, a boat's wake). True if it was fresh. */
  lockHit(key: string, hue: number, faction: number): boolean {
    return this.hit(key, hue, this.utc, this.sim, faction, true);
  }

  /** The Torpedo (Torpedo.ts; SHOTS.md, "The shots"): main.ts's life block calls it once. */
  torpedoOn(host: TorpedoHost): LifeTorpedo {
    this.torpedoes = new LifeTorpedo(this, host);
    return this.torpedoes;
  }

  /** The shot code's hook (HOOKS.md, "The Torpedo"; main.ts's `miss:`): a breath of `hue` came down on open water at `pos`. Nothing before torpedoOn. */
  torpedo(pos: THREE.Vector3, hue: number): void {
    this.torpedoes?.launch(pos, hue);
  }

  /** The Torpedo's pick: the ferry or sailboat nearest (x, z) within `reach` m that `clear` lets through. Its key, where it is and its length (m) into `out`. */
  boatNear(x: number, z: number, reach: number, clear: (bx: number, bz: number) => boolean, out: TorpedoPick): boolean {
    const s = this.snap;
    if (!s) return false;
    const rows = s.rows, n = s.u32[2], dt = (this.utc - s.f64[0]) / 1000;
    let best = -1, bestD = reach;
    for (let i = 0; i < n; i++) {
      const o = i * ROW, kind = rows[o + Col.KIND];
      if (kind !== Kind.FERRY && kind !== Kind.SAILBOAT) continue;
      const bx = rows[o + Col.X] + rows[o + Col.VX] * dt, bz = rows[o + Col.Z] + rows[o + Col.VZ] * dt, d = Math.hypot(bx - x, bz - z);
      if (d > bestD || !clear(bx, bz)) continue;
      best = i;
      bestD = d;
    }
    if (best < 0) return false;
    const o = best * ROW, key = this.keys.get(s.rowsU32[o + Col.KEY]);
    if (!key) return false;
    out.key = key;
    out.size = (KINDS[rows[o + Col.KIND]]?.size ?? 0) * rows[o + Col.SCALE];
    out.at.set(rows[o + Col.X] + rows[o + Col.VX] * dt, rows[o + Col.Y] + rows[o + Col.VY] * dt, rows[o + Col.Z] + rows[o + Col.VZ] * dt);
    return true;
  }

  /** A Torpedo reached `key`: its paint at once and its wake's show, as a locked shot's. True if it was fresh. */
  torpedoHit(key: string, hue: number, faction: number): boolean {
    return this.hit(key, hue, this.utc, this.sim, faction, true);
  }

  /** A ferry or sailboat within 1.5 km of the bus, on the screen (the HOLD TO LOCK hint). */
  boatInReach(holds: Holds): boolean {
    const s = this.snap;
    if (!s) return false;
    const rows = s.rows, n = s.u32[2], bus = holds.bus(this.lockV.set(0, 0, 0)), bx = bus.x, bz = bus.z;
    for (let i = 0; i < n; i++) {
      const o = i * ROW, kind = rows[o + Col.KIND];
      if (kind !== Kind.FERRY && kind !== Kind.SAILBOAT) continue;
      if (Math.hypot(rows[o + Col.X] - bx, rows[o + Col.Z] - bz) > lockTune.boatReach) continue;
      if (holds.screenOf(this.lockV.set(rows[o + Col.X], rows[o + Col.Y], rows[o + Col.Z]), this.lockS)) return true;
    }
    return false;
  }

  /** The mover glinting now, or none (the aim, each frame). */
  glint(key: string | null): void {
    if (key === this.glintKey) return;
    this.glintKey = key;
    this.glintHash = key ? fnv1a(key) : 0;
  }

  /**
   * A breath fired at a mover (CONTRACT.md section 3): it takes `color` (an index into HUE_RAMPS) at level 1 if it's fresh, or goes up a level and keeps its own,
   * when the breath arrives (game time); either way it takes the hitter's `faction` (C15, src/game/factions.ts), at level 3 too, as a building does. True: a fresh mover took the colour, and the breath's hue moves on, as for a fresh building.
   */
  hit(key: string, color: number, utcMs: number, arrive: number, faction: number, show = false): boolean {
    // (`show`: an aimed hit, a locked shot's or a Torpedo's, and its ribbon's or its wake's show from when it lands)
    const h = fnv1a(key), was = this.painted.get(h) ?? this.hits.find((x) => x.h === h);
    const level = was ? Math.min(3, was.level + 1) : 1;
    // (how long it's kept: what the row says, its time left over the place, or for a live plane the most)
    let until = utcMs + 3600000, kept = !key.startsWith('picnic:') && !key.startsWith('car:');
    const s = this.snap;
    if (s)
      for (let i = 0, n = s.u32[2]; i < n; i++)
        if (s.rowsU32[i * ROW + Col.KEY] === h) {
          until = s.f64[0] + s.rows[i * ROW + Col.UNTIL] * 1000;
          kept = KINDS[s.rows[i * ROW + Col.KIND]]?.kept ?? kept;
          break;
        }
    this.hits.push({ h, key, hue: was ? was.hue : color, level, arrive, until, kept, faction: ownerOf(faction), show });
    this.qa.hits++;
    return !was;
  }

  /** The tuner's reset: every mover grey again. */
  resetPaint(): void {
    this.painted.clear();
    this.trackOf.fill(0);
    this.hits.length = 0;
    this.torpedoes?.reset();
    this.store.clear();
  }
}
