import * as THREE from 'three';
import { globals } from '../render/materials';
import { HUE_RAMPS } from '../render/palette';
import type { LifeTick } from './lifeWorker';
import { Col, KINDS, Pool, ROW } from './kinds';
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
  readonly qa = { rows: 0, models: 0, specks: 0, snaps: 0 };

  constructor(
    private readonly worker: Worker,
    readonly pools: Pools,
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

  /** Once a rendered frame, by the loop that has the bus (CONTRACT.md section 6). */
  frame(_dt: number, _simTime: number, utcMs: number, bus: { x: number; y: number; z: number }, camera: THREE.Camera): void {
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
          pool.glint[k] = 0;
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

  /** The tuner's reset: every mover grey again. */
  resetPaint(): void {
    this.painted.clear();
  }
}
