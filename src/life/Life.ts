import * as THREE from 'three';
import { config } from '../config';
import type { MoverTarget } from '../game/Aim';
import { latLonToLocal, localToLatLon } from '../game/geo';
import type { SuperTag } from '../game/Splat';
import { globals } from '../render/materials';
import { HUE_RAMPS } from '../render/palette';
import type { Observer } from '../sky/SkyModel';
import { axesAt, fixToGeodetic, geodeticToFix } from '../sky/WorldFrame';
import type { LifeTick } from './lifeWorker';
import { fnv1a } from './hash';
import { Col, KINDS, Pool, ROW } from './kinds';
import type { MoverStore } from './paint';
import { GREY_RAMP, type Pools, SPECKS_MAX } from './pools';
import { MAX_ROWS, readKeys, SNAP_BYTES, view, type SnapView } from './snapshot';

// Life's host (LIFE.md): it ticks the worker at 10 Hz of the page's clock, and every frame carries each mover in the last snapshot on by its velocity to the
// frame's utcMs, picks its level of detail by its size on the screen, and fills the pools. Nothing in frame() allocates (CONTRACT.md section 2).

const TICK_MS = 100;
/** Under this many pixels a mover is a speck; a grey one under 1 px isn't drawn, a painted one keeps its 1 px to orbit (CONTRACT.md 1.4). */
const MODEL_PX = 2;
/** The street's reach (m): as far as a plane can be seen from where the bus is, the sky over the place. From the flight's loop it's the horizon. */
const REACH = 80000;
/** The flight's loop draws to 30 km (moonrun.ts, setFar): past this (m) a mover is drawn nearer the lens along its own line of sight, its size cut to match, so it's where it
 *  is on the screen and as big. A speck is a pixel at any distance. */
const SKY_NEAR = 25000;
/** SkyModel's EARTH (an import would bring the sky's model into life's chunk). The ellipsoid's radius at the equator and its flattening's stretch of z, km. */
const EARTH_ID = 0;
/** QA: how many of the movers drawn a frame are noted, by key and place (tools/life/sky.mjs: nothing jumps on the screen when the flight takes the bus) */
const DRAWN = 64;
const WGS_A = 6378.137, WGS_K = 1 / (1 - 1 / 298.257223563);

/** A mover's paint as drawn: its colour (an index into HUE_RAMPS) and level. */
export interface MoverPaint {
  hue: number;
  level: number;
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
  readonly qa = { rows: 0, models: 0, specks: 0, snaps: 0, hits: 0, sky: false, drawn: 0 };
  readonly drawn = new Float64Array(DRAWN * 4);
  /** the frame's clocks, for the aim between frames */
  private utc = 0;
  private sim = 0;
  /** the mover glinting (its key's hash, 0: none), and the aim's answer, one object reused */
  private glintHash = 0;
  private glintKey: string | null = null;
  private readonly target: MoverTarget = { mover: true, key: '', x: 0, y: 0, z: 0, arrive: 0, pickR: 0 };
  /** hits on their way: each takes at its impact's game time */
  private readonly hits: Array<{ h: number; key: string; hue: number; level: number; arrive: number; until: number }> = [];
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

  constructor(worker: Worker, pools: Pools, store: MoverStore, ns: string, origin: readonly [number, number]) {
    this.worker = worker;
    this.pools = pools;
    this.store = store;
    this.ns = ns;
    this.origin = origin;
    this.home = pools.group.parent;
    axesAt(origin[0], origin[1], 0, this.ax);
    worker.onmessage = (e: MessageEvent<{ type: string; buf: ArrayBuffer }>) => {
      if (e.data?.type === 'snap') this.took(e.data.buf);
    };
  }

  private took(buf: ArrayBuffer): void {
    if (this.snap) this.free.push(this.snap.buf);
    this.snap = view(buf);
    readKeys(this.snap, this.keys);
    this.qa.snaps++;
  }

  /** What was kept, painted again (bootLife, once the store is read). */
  restore(records: Array<{ key: string; hue: number; level: number }>): void {
    for (const r of records) this.painted.set(fnv1a(r.key), { hue: r.hue, level: r.level });
  }

  /** Once a rendered frame, by the loop that has the bus (CONTRACT.md section 6). */
  frame(_dt: number, simTime: number, utcMs: number, bus: { x: number; y: number; z: number }, camera: THREE.Camera): void {
    this.utc = utcMs;
    this.sim = simTime;
    if (this.home && this.pools.group.parent !== this.home) this.home.add(this.pools.group);
    this.land(simTime);
    const ll = localToLatLon(bus.x, bus.z, this.origin, this.ll);
    this.send(utcMs, bus.x, bus.y, bus.z, ll[0], ll[1], REACH);
    this.draw(utcMs, camera);
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
      this.commit(0, 0, 0, 0);
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
      this.painted.set(h.h, { hue: h.hue, level: h.level });
      this.store.put({ key: h.key, hue: h.hue, level: h.level, until: h.until, ns: this.ns });
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
  }

  private commit(nm: number, nl: number, ns: number, n: number): void {
    const P = this.pools;
    P.middle.commit(Math.min(nm, P.middle.max));
    P.large.commit(Math.min(nl, P.large.max));
    P.specks.commit(ns);
    this.qa.rows = n;
    this.qa.models = nm + nl;
    this.qa.specks = ns;
  }

  private draw(utcMs: number, camera: THREE.Camera): void {
    const s = this.snap, P = this.pools, cam = camera.position, ang = Math.max(1e-6, globals.uPixelAngle.value as number);
    let nm = 0, nl = 0, ns = 0, n = 0, nd = 0;
    this.qMap.identity();
    if (s) {
      const rows = s.rows, u32 = s.rowsU32, dt = (utcMs - s.f64[0]) / 1000, sp = P.specks;
      n = s.u32[2];
      for (let i = 0; i < n; i++) {
        const o = i * ROW, info = KINDS[rows[o + Col.KIND]];
        if (!info) continue;
        const x = rows[o + Col.X] + rows[o + Col.VX] * dt, y = rows[o + Col.Y] + rows[o + Col.VY] * dt, z = rows[o + Col.Z] + rows[o + Col.VZ] * dt;
        const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const scale = rows[o + Col.SCALE], px = (info.size * scale) / Math.max(1, d * ang);
        const paint = this.painted.get(u32[o + Col.KEY]);
        const ramp = paint ? HUE_RAMPS[paint.hue] : GREY_RAMP;
        if (px >= MODEL_PX) {
          const big = info.pool === Pool.LARGE, k = big ? nl : nm;
          if (k >= P.pool(info.pool).max) continue;
          this.put(P.pool(info.pool), k, o, x, y, z, scale, ramp);
          if (big) nl++;
          else nm++;
        } else if ((paint || px >= 1) && ns < SPECKS_MAX) {
          sp.pos[ns * 3] = x;
          sp.pos[ns * 3 + 1] = y;
          sp.pos[ns * 3 + 2] = z;
          sp.ramp[ns] = ramp;
          ns++;
        } else continue;
        this.note(nd++, u32[o + Col.KEY], x, y, z);
      }
    }
    this.qa.sky = false;
    this.qa.drawn = Math.min(nd, DRAWN);
    this.commit(nm, nl, ns, n);
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
    pool.glint[k] = key === this.glintHash ? config.splat.glintLift : 0;
    pool.surf[k] = (key & 0xffff) / 65536;
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
    let nm = 0, nl = 0, ns = 0, n = 0, nd = 0;
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
        let scale = rows[o + Col.SCALE];
        const px = (info.size * scale) / Math.max(1, d * ang), paint = this.painted.get(u32[o + Col.KEY]), ramp = paint ? HUE_RAMPS[paint.hue] : GREY_RAMP;
        if (!paint && px < 1) continue;
        if (d > SKY_NEAR) {
          const k = SKY_NEAR / d;
          x = cam.x + lx * k;
          y = cam.y + ly * k;
          z = cam.z + lz * k;
          scale *= k;
        }
        if (px >= MODEL_PX) {
          const big = info.pool === Pool.LARGE, k = big ? nl : nm;
          if (k >= P.pool(info.pool).max) continue;
          this.put(P.pool(info.pool), k, o, x, y, z, scale, ramp);
          if (big) nl++;
          else nm++;
        } else if (ns < SPECKS_MAX) {
          sp.pos[ns * 3] = x;
          sp.pos[ns * 3 + 1] = y;
          sp.pos[ns * 3 + 2] = z;
          sp.ramp[ns] = ramp;
          ns++;
        } else continue;
        this.note(nd++, u32[o + Col.KEY], x, y, z);
      }
    }
    this.qa.sky = true;
    this.qa.drawn = Math.min(nd, DRAWN);
    this.commit(nm, nl, ns, n);
  }

  /**
   * The aim (CONTRACT.md section 3): the mover nearest the line from (ox, oy, oz) along (dx, dy, dz), the ray to the aim point, where it will be when a breath
   * flying the whole ray in `travel` s reaches it; within pickR of the line, widening with the distance, plus its own half size. Null: none. The answer is one
   * object, filled again each call.
   */
  aim(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pickR: number, travel: number): MoverTarget | null {
    const s = this.snap;
    if (!s) return null;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1) return null;
    const ux = dx / L, uy = dy / L, uz = dz / L, speed = L / Math.max(0.05, travel), rows = s.rows, u32 = s.rowsU32, n = s.u32[2];
    const t0 = (this.utc - s.f64[0]) / 1000;
    let best = -1, bestD = Infinity, bx = 0, by = 0, bz = 0, bt = 0, bR = 0;
    for (let i = 0; i < n; i++) {
      const o = i * ROW, info = KINDS[rows[o + Col.KIND]];
      if (!info) continue;
      const vx = rows[o + Col.VX], vy = rows[o + Col.VY], vz = rows[o + Col.VZ];
      let x = rows[o + Col.X] + vx * t0, y = rows[o + Col.Y] + vy * t0, z = rows[o + Col.Z] + vz * t0;
      let along = (x - ox) * ux + (y - oy) * uy + (z - oz) * uz;
      if (along <= 0 || along > L * 1.25) continue;
      // (where it is when the breath gets there: once round is near enough at a plane's speed against the breath's)
      const tt = along / speed;
      x += vx * tt;
      y += vy * tt;
      z += vz * tt;
      along = (x - ox) * ux + (y - oy) * uy + (z - oz) * uz;
      const px = x - ox - ux * along, py = y - oy - uy * along, pz = z - oz - uz * along, d = Math.sqrt(px * px + py * py + pz * pz);
      const R = pickR + 0.5 * info.size * rows[o + Col.SCALE] + along * 0.02;
      if (d > R || d >= bestD || !this.keys.has(u32[o + Col.KEY])) continue;
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
    return t;
  }

  /**
   * A MEGA, a super or a hose's blast (CONTRACT.md section 3): every mover within `r` of (x, y, z) when it lands, at `arrive` (game time), takes paint as a building in it
   * would, a fresh one the blast's hue at level 1 and a painted one a level up. The super's tag is the buildings' business (one hit an area): a mover takes one level a blast.
   */
  blast(x: number, y: number, z: number, r: number, hue: number, _superTag: SuperTag | undefined, arrive: number): void {
    const s = this.snap;
    if (!s) return;
    const rows = s.rows, u32 = s.rowsU32, n = s.u32[2], dt = (this.utc - s.f64[0]) / 1000 + Math.max(0, arrive - this.sim);
    for (let i = 0; i < n; i++) {
      const o = i * ROW, info = KINDS[rows[o + Col.KIND]];
      if (!info) continue;
      const dx = rows[o + Col.X] + rows[o + Col.VX] * dt - x, dy = rows[o + Col.Y] + rows[o + Col.VY] * dt - y, dz = rows[o + Col.Z] + rows[o + Col.VZ] * dt - z;
      const R = r + 0.5 * info.size * rows[o + Col.SCALE], key = this.keys.get(u32[o + Col.KEY]);
      if (dx * dx + dy * dy + dz * dz > R * R || !key) continue;
      this.hit(key, hue, this.utc, arrive);
    }
  }

  /** A key's hash, as the rows carry it (QA). */
  keyHash(key: string): number {
    return fnv1a(key);
  }

  /** The mover glinting now, or none (the aim, each frame). */
  glint(key: string | null): void {
    if (key === this.glintKey) return;
    this.glintKey = key;
    this.glintHash = key ? fnv1a(key) : 0;
  }

  /**
   * A breath fired at a mover (CONTRACT.md section 3): it takes `color` (an index into HUE_RAMPS) at level 1 if it's fresh, or goes up a level and keeps its own,
   * when the breath arrives (game time). True: a fresh mover took the colour, and the breath's hue moves on, as for a fresh building.
   */
  hit(key: string, color: number, utcMs: number, arrive: number): boolean {
    const h = fnv1a(key), was = this.painted.get(h) ?? this.hits.find((x) => x.h === h);
    const level = was ? Math.min(3, was.level + 1) : 1;
    // (how long it's kept: what the row says, its time left over the place, or for a live plane the most)
    let until = utcMs + 3600000;
    const s = this.snap;
    if (s)
      for (let i = 0, n = s.u32[2]; i < n; i++)
        if (s.rowsU32[i * ROW + Col.KEY] === h) {
          until = s.f64[0] + s.rows[i * ROW + Col.UNTIL] * 1000;
          break;
        }
    this.hits.push({ h, key, hue: was ? was.hue : color, level, arrive, until });
    this.qa.hits++;
    return !was;
  }

  /** The tuner's reset: every mover grey again. */
  resetPaint(): void {
    this.painted.clear();
    this.hits.length = 0;
    this.store.clear();
  }
}
