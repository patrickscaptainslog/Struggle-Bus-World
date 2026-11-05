import * as THREE from 'three';
import { config } from '../config';
import type { MoverTarget } from '../game/Aim';
import { globals } from '../render/materials';
import { HUE_RAMPS } from '../render/palette';
import type { LifeTick } from './lifeWorker';
import { fnv1a } from './hash';
import { Col, KINDS, Pool, ROW } from './kinds';
import type { MoverStore } from './paint';
import { GREY_RAMP, type Pools, SPECKS_MAX } from './pools';
import { readKeys, SNAP_BYTES, view, type SnapView } from './snapshot';

// Life's host (LIFE.md): it ticks the worker at 10 Hz of the page's clock, and every frame carries each mover in the last snapshot on by its velocity to the
// frame's utcMs, picks its level of detail by its size on the screen, and fills the pools. Nothing in frame() allocates (CONTRACT.md section 2).

const TICK_MS = 100;
/** Under this many pixels a mover is a speck; a grey one under 1 px isn't drawn, a painted one keeps its 1 px to orbit (CONTRACT.md 1.4). */
const MODEL_PX = 2;

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
  private readonly tick: LifeTick = { type: 'tick', utcMs: 0, x: 0, y: 0, z: 0, reach: 0, buf: null as unknown as ArrayBuffer };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YZX');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  /** QA: the last frame's rows, models and specks, and the snapshots taken */
  readonly qa = { rows: 0, models: 0, specks: 0, snaps: 0, hits: 0 };
  /** the frame's clocks, for the aim between frames */
  private utc = 0;
  private sim = 0;
  /** the mover glinting (its key's hash, 0: none), and the aim's answer, one object reused */
  private glintHash = 0;
  private glintKey: string | null = null;
  private readonly target: MoverTarget = { mover: true, key: '', x: 0, y: 0, z: 0, arrive: 0, pickR: 0 };
  /** hits on their way: each takes at its impact's game time */
  private readonly hits: Array<{ h: number; key: string; hue: number; level: number; arrive: number; until: number }> = [];

  constructor(
    private readonly worker: Worker,
    readonly pools: Pools,
    private readonly store: MoverStore,
    private readonly ns: string,
  ) {
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
    // (hits whose breath has arrived take now, and are kept)
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (simTime < h.arrive) continue;
      this.painted.set(h.h, { hue: h.hue, level: h.level });
      this.store.put({ key: h.key, hue: h.hue, level: h.level, until: h.until, ns: this.ns });
      this.hits.splice(i, 1);
    }
    if (utcMs - this.sentAt >= TICK_MS && this.free.length) {
      const t = this.tick;
      t.utcMs = this.sentAt = utcMs;
      t.x = bus.x;
      t.y = bus.y;
      t.z = bus.z;
      // (as far as a plane can be seen from where the bus is: the sky over the place)
      t.reach = 80000;
      t.buf = this.free.pop()!;
      this.worker.postMessage(t, [t.buf]);
    }
    this.draw(utcMs, camera);
  }

  private draw(utcMs: number, camera: THREE.Camera): void {
    const s = this.snap, P = this.pools, cam = camera.position, ang = Math.max(1e-6, globals.uPixelAngle.value as number);
    let nm = 0, nl = 0, ns = 0, n = 0;
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
          const pool = P.pool(info.pool), k = info.pool === Pool.LARGE ? nl++ : nm++;
          if (k >= pool.max) continue;
          this.e.set(rows[o + Col.BANK], -rows[o + Col.HEADING], rows[o + Col.PITCH]);
          this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s.set(scale, scale, scale));
          this.m.toArray(pool.mesh.instanceMatrix.array as Float32Array, k * 16);
          pool.kind[k] = rows[o + Col.KIND];
          pool.ramp[k] = ramp;
          pool.glint[k] = u32[o + Col.KEY] === this.glintHash ? config.splat.glintLift : 0;
          pool.surf[k] = (u32[o + Col.KEY] & 0xffff) / 65536;
        } else if ((paint || px >= 1) && ns < SPECKS_MAX) {
          sp.pos[ns * 3] = x;
          sp.pos[ns * 3 + 1] = y;
          sp.pos[ns * 3 + 2] = z;
          sp.ramp[ns] = ramp;
          ns++;
        }
      }
    }
    P.middle.commit(Math.min(nm, P.middle.max));
    P.large.commit(Math.min(nl, P.large.max));
    P.specks.commit(ns);
    this.qa.rows = n;
    this.qa.models = nm + nl;
    this.qa.specks = ns;
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
