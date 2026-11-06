import * as THREE from 'three';
import { FACTION_RAINBOW } from '../game/factions';
import { uploadRect } from '../render/upload';
import type { BuildingRef, City } from './City';
import type { HoodsTable } from './hoods';
import type { RoofSprouts } from './props/sprouts';
import { liftUniforms } from './buildingMaterial';
import { LiftField, type FieldHouses } from './LiftField';
import { makeCapGeometry, makeCapMaterial, makeGeysers, makeLiftDepthMaterial, registerLiftWarm, type Jet } from './liftDraw';
import {
  hoodStart, liftAmp, liftAt, liftedOn, liftRest, liftSeed, LIFT, slowAt, slowmoOn, SLOW_COOLDOWN, SLOW_HIT, SLOW_WAVE, SQUARE, squareIx, squareIz, squareKey, type LiftHooks,
} from './liftGlsl';

// The Lift, the first slice of the stages (docs/specs/factions/LIFT.md; FACTIONS.md section 2, Team Super Rainbow's "4 · Liftoff"): behind ?lift,
// in one neighbourhood. A Rainbow house at level 3 that a Rainbow breath hits again crouches as the shockwave reaches it, leaps on its own rainbow
// geyser over a lake of paint and floats there, bobbing, and the bus flies under it. &lifted stages the whole neighbourhood at level 3 for the
// session and lifts it as a wave out from its heart.
//
// Where the lift lives: here, in memory only, never in the paint texel and never in a store. A reload brings every house down. The GPU computes
// the motion from each house's static (crouch start, rest height, seed) in tLift, a texture laid out like uPaint; the CPU runs the same function
// (liftGlsl.ts) for the flight and the aim. It is the seam the areas (step 4) drive later: lift.start(ref, t) when a square reaches stage 4.

/** What the Lift needs of the game (main.ts). */
export interface LiftGame {
  city: City;
  scene: THREE.Scene;
  sprouts: RoofSprouts;
  hoods: HoodsTable;
  hood: number;
  /** the rooftop garden (main's growSprouts) */
  grow(ref: BuildingRef, hue: number, level: number, start: number): void;
  /** the fog thins over paint (main's bumpPaint) */
  bump(x: number, z: number, amt: number): void;
  /** petals at a jump: a burst and sparkles in the house's hue */
  petals(x: number, y: number, z: number, hue: number, n: number): void;
  sound: { wave(): void; crouch(): void; jump(n: number, hue: number): void; note(i: number, n: number, hue: number): void };
}

const ST_GROUND = 0, ST_PENDING = 1, ST_UP = 2;
/** a house held back from jumping into the bus or the camera waits at most this long (s) */
const HOLD_MAX = 3;
const tmp: [number, number] = [0, 0];
const petalAt = new Float32Array(16);
const LENS_RING = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]] as const;

export class Lift implements LiftHooks, FieldHouses {
  readonly name: string;
  /** the heart square's centre (m) */
  readonly heart: [number, number];
  /** the squares' bounds (m): x0, z0, x1, z1 */
  readonly bounds: [number, number, number, number];
  readonly squares: Set<number>;
  private readonly tagged: Set<number>;
  private readonly heartKey: number;
  /** the hood's bounds grown 60 m: where anything lifted can be */
  readonly rect: [number, number, number, number];

  // ---- per house, by paint index
  readonly state: Uint8Array;
  readonly H: Float32Array;
  readonly margin: Float32Array;
  readonly base: Float32Array;
  readonly t0: Float32Array;
  readonly extra: Float32Array;
  private readonly seedB: Float32Array;
  private readonly held: Float32Array;
  private readonly fromHit: Uint8Array;
  private readonly slot: Int16Array;
  /** liftable houses of the loaded tiles, by index */
  readonly refs = new Map<number, BuildingRef>();
  private readonly pending = new Int32Array(LIFT.cap);
  private nPending = 0;
  private nUp = 0;
  private nSlots = 0;

  // ---- the GPU's
  private readonly data: Float32Array;
  private readonly tex: THREE.DataTexture;
  private dirty0 = Infinity;
  private dirty1 = -1;
  readonly field: LiftField;
  private readonly caps: THREE.Mesh;
  private capsDirty = false;
  private readonly geysers: THREE.InstancedMesh;
  private readonly lake: Float32Array;
  private readonly lakeTex: THREE.DataTexture;
  private readonly lakeW: number;
  private readonly lakeH: number;
  private readonly lakeCell: number;
  private lakeDirty = false;
  readonly depthMaterial: THREE.ShaderMaterial;

  // ---- the clocks
  now = 0;
  /** &lifted: the wave's start on the game clock (-1: not yet) */
  waveAt = -1;
  private staged = false;
  /** tiles under the squares still to arrive (&lifted stages once they're all in) */
  private readonly tilesWanted = new Set<string>();
  private slowT = Infinity;
  private slowP: readonly number[] = SLOW_HIT;
  private slowLast = -Infinity;
  private wall = 0;
  private waveSlowDone = false;
  private notes = 0;
  private noteT = 0;
  /** the hit lifts this frame took off, for one sound and one slow motion */
  private hitJumps = 0;
  private hitHue = 0;
  private lowK = 0;
  private lowWant = 0;
  private lowFail = 0;
  /** what the QA reads */
  readonly stats = { scheduled: 0, up: 0, held: 0, cells: 0, capsTris: 0 };

  constructor(private readonly g: LiftGame) {
    const { city, hoods, hood } = g;
    const m = city.manifest;
    this.name = hoods.names[hood];
    this.heartKey = hoods.hearts[hood];
    this.heart = [(squareIx(this.heartKey) + 0.5) * SQUARE, (squareIz(this.heartKey) + 0.5) * SQUARE];
    this.squares = new Set(hoods.squares[hood]);
    this.tagged = new Set(hoods.tagged.filter((k) => this.squares.has(k)));
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const k of this.squares) {
      x0 = Math.min(x0, squareIx(k) * SQUARE);
      z0 = Math.min(z0, squareIz(k) * SQUARE);
      x1 = Math.max(x1, (squareIx(k) + 1) * SQUARE);
      z1 = Math.max(z1, (squareIz(k) + 1) * SQUARE);
    }
    this.bounds = [x0, z0, x1, z1];
    this.rect = [x0 - 60, z0 - 60, x1 + 60, z1 + 60];
    const ts = m.tileSize;
    for (const k of this.squares) {
      const cx = (squareIx(k) + 0.5) * SQUARE, cz = (squareIz(k) + 0.5) * SQUARE;
      this.tilesWanted.add(`${Math.floor(cx / ts)},${Math.floor(cz / ts)}`);
    }

    const texels = city.paint.width * city.paint.height;
    this.state = new Uint8Array(texels);
    this.H = new Float32Array(texels);
    this.margin = new Float32Array(texels);
    this.base = new Float32Array(texels);
    this.t0 = new Float32Array(texels);
    this.extra = new Float32Array(texels);
    this.seedB = new Float32Array(texels);
    this.held = new Float32Array(texels);
    this.fromHit = new Uint8Array(texels);
    this.slot = new Int16Array(texels).fill(-1);
    this.data = new Float32Array(texels * 4);
    this.tex = new THREE.DataTexture(this.data, city.paint.width, city.paint.height, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;

    // the lake's mask over the rect, 2 m a texel (coarser past 2 km)
    const span = Math.max(this.rect[2] - this.rect[0], this.rect[3] - this.rect[1]);
    this.lakeCell = Math.max(2, Math.ceil(span / 1024));
    this.lakeW = Math.ceil((this.rect[2] - this.rect[0]) / this.lakeCell);
    this.lakeH = Math.ceil((this.rect[3] - this.rect[1]) / this.lakeCell);
    this.lake = new Float32Array(this.lakeW * this.lakeH * 2);
    for (let i = 0; i < this.lake.length; i += 2) this.lake[i + 1] = -4;
    this.lakeTex = new THREE.DataTexture(this.lake, this.lakeW, this.lakeH, THREE.RGFormat, THREE.FloatType);
    this.lakeTex.minFilter = this.lakeTex.magFilter = THREE.NearestFilter;
    this.lakeTex.generateMipmaps = false;
    this.lakeTex.needsUpdate = true;

    const u = liftUniforms!;
    u.tLift.value = this.tex;
    u.uLiftRect.value.set(this.rect[0], this.rect[1], this.rect[2], this.rect[3]);
    u.uLiftW.value = city.paint.width;
    u.tLake.value = this.lakeTex;
    u.uLakeRect.value.set(this.rect[0], this.rect[1], 1 / this.lakeCell, 0);

    const c = ts / m.obstN;
    this.field = new LiftField(Math.floor(this.rect[0] / c) * c, Math.floor(this.rect[1] / c) * c, this.rect[2], this.rect[3], c, city, this);

    this.caps = new THREE.Mesh(new THREE.BufferGeometry(), makeCapMaterial());
    this.caps.frustumCulled = false;
    this.caps.visible = false;
    this.geysers = makeGeysers(LIFT.cap);
    g.scene.add(this.caps, this.geysers);
    this.depthMaterial = makeLiftDepthMaterial();
    registerLiftWarm(this.depthMaterial);
    city.liftShadow = { rect: this.rect, material: this.depthMaterial, grow: 60 };
    city.lift = this;
  }

  get up(): number {
    return this.nUp;
  }

  // ------------------------------------------------------------ the City's hooks

  private inRect(x: number, z: number) {
    return x >= this.rect[0] && x <= this.rect[2] && z >= this.rect[1] && z <= this.rect[3];
  }

  obstacle(x: number, z: number, fromY: number, baked: number): number {
    if (!this.nUp || !this.inRect(x, z)) return baked;
    return this.field.query(x, z, fromY, baked, false);
  }

  overhead(x: number, z: number, fromY: number): number {
    if (!this.nUp || !this.inRect(x, z)) return Infinity;
    this.field.query(x, z, fromY, 0, false);
    return this.field.under;
  }

  surface(x: number, z: number, fromY: number, baked: number): number {
    if (!this.nUp || !this.inRect(x, z)) return baked;
    return this.field.query(x, z, fromY, baked, true);
  }

  dy(index: number): number {
    if (this.state[index] === ST_GROUND) return 0;
    liftAt(this.now - this.t0[index], this.now, this.H[index], this.seedB[index], tmp);
    return tmp[0];
  }

  dyNow(index: number): number {
    return this.dy(index);
  }

  reach(index: number): number {
    return this.state[index] === ST_UP ? this.H[index] * 1.14 + this.margin[index] : 0;
  }

  over(index: number, baseY: number, fromY: number): boolean {
    return this.state[index] === ST_UP && fromY < baseY + this.dy(index) - 1;
  }

  noteTop(index: number, top: number): void {
    if (top > this.extra[index]) this.extra[index] = top;
  }

  // ------------------------------------------------------------ tiles

  /** Is this building one the Lift may lift: a baked one (no landmark), its centroid on one of the hood's squares, that square not tagged. */
  private liftable(ref: BuildingRef): boolean {
    if (ref.index >= this.g.city.manifest.buildingCount) return false;
    const k = squareKey(Math.floor(ref.cx / SQUARE), Math.floor(ref.cz / SQUARE));
    return this.squares.has(k) && !this.tagged.has(k);
  }

  /** A tile arrived (main's onTile): its liftable houses, their lakes and undersides; the field there is built again. */
  tileIn(tx: number, tz: number, refs: BuildingRef[]) {
    const ts = this.g.city.manifest.tileSize;
    if ((tx + 1) * ts < this.rect[0] || tx * ts > this.rect[2] || (tz + 1) * ts < this.rect[1] || tz * ts > this.rect[3]) return;
    let any = false;
    for (const ref of refs) {
      if (!this.liftable(ref)) continue;
      const i = ref.index;
      if (!this.refs.has(i)) {
        const H = liftRest(ref.area, ref.roofY - ref.baseY, i);
        const sb = liftSeed(i, 2);
        this.H[i] = H;
        this.seedB[i] = sb;
        this.margin[i] = 1.3 * liftAmp(H, sb) + 0.3;
      }
      // (the ref is new with each arrival: the tile's records)
      this.refs.set(i, ref);
      this.base[i] = ref.baseY;
      this.raster(ref);
      any = true;
    }
    this.field.clear(tx * ts, tz * ts, (tx + 1) * ts, (tz + 1) * ts);
    if (any) {
      this.capsDirty = true;
      this.lakeDirty = true;
    }
    this.tilesWanted.delete(`${tx},${tz}`);
  }

  /** The jet under a house: at its centroid when that is inside it, else a landing 2.5 m in; its radius from its size. */
  private jetOf(ref: BuildingRef): Jet {
    const city = this.g.city;
    const at = city.contains(ref, ref.cx, ref.cz) ? { x: ref.cx, z: ref.cz } : city.landingOn(ref, ref.cx, ref.cz, 2.5, { x: 0, z: 0 });
    return { x: at.x, z: at.z, r: Math.min(3.2, Math.max(1.1, 0.11 * Math.sqrt(ref.area))) };
  }

  /** One house's footprint into the lake's mask: its index and the signed distance to its edge (m, + inside), within 4 m outside. */
  private raster(ref: BuildingRef) {
    const b = ref.tile, c = this.lakeCell, W = this.lakeW, Hh = this.lakeH, ox = this.rect[0], oz = this.rect[1];
    for (let k = ref.local; k < ref.local + ref.parts; k++) {
      if (b.tier[k] !== 0) continue;
      const s = b.vertStart[k], e = b.vertStart[k + 1];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let v = s; v < e; v++) {
        x0 = Math.min(x0, b.xz[v * 2]);
        x1 = Math.max(x1, b.xz[v * 2]);
        z0 = Math.min(z0, b.xz[v * 2 + 1]);
        z1 = Math.max(z1, b.xz[v * 2 + 1]);
      }
      const i0 = Math.max(0, Math.floor((x0 - 4 - ox) / c)), i1 = Math.min(W - 1, Math.floor((x1 + 4 - ox) / c));
      const j0 = Math.max(0, Math.floor((z0 - 4 - oz) / c)), j1 = Math.min(Hh - 1, Math.floor((z1 + 4 - oz) / c));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const px = ox + (i + 0.5) * c, pz = oz + (j + 0.5) * c;
          let inside = false, d = Infinity;
          for (let v = s, w = e - 1; v < e; w = v++) {
            const ax = b.xz[w * 2], az = b.xz[w * 2 + 1], bx = b.xz[v * 2], bz = b.xz[v * 2 + 1];
            if (bz > pz !== az > pz && px < ((ax - bx) * (pz - bz)) / (az - bz) + bx) inside = !inside;
            const ex = ax - bx, ez = az - bz, l2 = ex * ex + ez * ez;
            const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - bx) * ex + (pz - bz) * ez) / l2)) : 0;
            d = Math.min(d, Math.hypot(px - bx - ex * t, pz - bz - ez * t));
          }
          const sd = inside ? Math.min(d, 40) : -Math.min(d, 4);
          const o = (j * W + i) * 2;
          if (sd > this.lake[o + 1]) {
            this.lake[o] = ref.index + 1;
            this.lake[o + 1] = sd;
          }
        }
    }
  }

  // ------------------------------------------------------------ lifting

  /** Splat's question for a building a blast reaches (0 no, 1 it lifts now, 2 it's lifting or up already): Rainbow on Rainbow, level 3 before the blast. */
  wants(ref: BuildingRef, level: number, faction: number): 0 | 1 | 2 {
    const i = ref.index;
    if (!this.refs.has(i)) return 0;
    if (this.state[i] !== ST_GROUND) return 2;
    if (Math.round(level) < 3 || faction !== FACTION_RAINBOW || this.g.city.paint.get(i).faction !== FACTION_RAINBOW) return 0;
    return this.nUp + this.nPending < LIFT.cap ? 1 : 0;
  }

  /** A hit lifts a house: it crouches at `at` (its bloom's arrival, game clock), as the shockwave reaches it. */
  start(ref: BuildingRef, at: number) {
    if (this.state[ref.index] !== ST_GROUND) return;
    if (!this.nPending) this.g.sound.crouch();
    this.schedule(ref.index, at, true);
  }

  private schedule(i: number, at: number, hit: boolean) {
    const ref = this.refs.get(i);
    if (!ref || this.nPending >= LIFT.cap) return;
    this.state[i] = ST_PENDING;
    this.t0[i] = at;
    this.held[i] = 0;
    this.fromHit[i] = hit ? 1 : 0;
    this.pending[this.nPending++] = i;
    this.writeTexel(i);
    if (this.slot[i] < 0 && this.nSlots < LIFT.cap) {
      const s = (this.slot[i] = this.nSlots++);
      const jet = this.jetOf(ref);
      const gy = this.g.city.groundAt(jet.x, jet.z);
      const m = this.geysers.instanceMatrix.array as Float32Array;
      m.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, jet.x, gy, jet.z, 1], s * 16);
      this.geysers.instanceMatrix.needsUpdate = true;
      const ga = this.geysers.geometry.getAttribute('aGey') as THREE.InstancedBufferAttribute;
      (ga.array as Float32Array).set([i, jet.r, ref.baseY - gy], s * 3);
      ga.needsUpdate = true;
      this.geysers.count = this.nSlots;
    }
    this.stats.scheduled++;
  }

  private writeTexel(i: number) {
    const o = i * 4;
    this.data[o] = this.t0[i];
    this.data[o + 1] = this.H[i];
    this.data[o + 2] = this.seedB[i];
    if (i < this.dirty0) this.dirty0 = i;
    if (i > this.dirty1) this.dirty1 = i;
  }

  /** &lifted: the neighbourhood's houses (the 600 nearest its heart) at level 3, Rainbow, for this session only, and the wave scheduled. */
  private stage() {
    this.staged = true;
    const city = this.g.city;
    const [hx, hz] = this.heart;
    const list = [...this.refs.values()].map((ref) => ({ ref, d: Math.hypot(ref.cx - hx, ref.cz - hz) })).sort((a, b) => a.d - b.d).slice(0, LIFT.cap);
    const hue = new Map<number, number>();
    for (const { ref } of list) {
      // its 60-degree wedge round the heart, then the nearest hue no touching neighbour has (Splatter.freeHue's rule)
      const a = Math.atan2(ref.cz - hz, ref.cx - hx);
      const pref = ((Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6) % 6) + 6) % 6;
      let pick = pref;
      for (const off of [0, 1, -1, 2, -2, 3]) {
        const h = (pref + off + 6) % 6;
        let clash = false;
        for (const { ref: o } of city.buildingsWithin(ref.cx, ref.cz, ref.rad + 30)) {
          const oh = hue.get(o.index);
          if (oh !== h || o === ref) continue;
          if (o.x0 - 2.5 <= ref.x1 && o.x1 + 2.5 >= ref.x0 && o.z0 - 2.5 <= ref.z1 && o.z1 + 2.5 >= ref.z0) {
            clash = true;
            break;
          }
        }
        if (!clash) {
          pick = h;
          break;
        }
      }
      hue.set(ref.index, pick);
      city.paint.stage(ref.index, { faction: FACTION_RAINBOW, color: pick, level: 3, bloomTime: -1000 });
      this.g.grow(ref, pick, 3, -100);
      this.g.bump(ref.cx, ref.cz, 40);
    }
    this.waveList = list;
  }
  private waveList: Array<{ ref: BuildingRef; d: number }> = [];

  /**
   * Once a frame, after the flight. `now` the game clock, dt its step, realDt the wall clock's; the bus and the camera, the opening's fog (0..1
   * gone). Schedules &lifted's wave, holds a house that would jump into the bus or the camera, takes houses up, uploads what changed.
   */
  frame(renderer: THREE.WebGLRenderer, now: number, dt: number, realDt: number, bus: { x: number; y: number; z: number; ground: number }, cam: THREE.Vector3, fogGone: number) {
    this.now = now;
    this.wall += realDt;
    if (liftedOn && !this.staged && this.tilesWanted.size === 0) this.stage();
    if (liftedOn && this.staged && this.waveAt < 0 && fogGone >= 0.5) {
      this.waveAt = now + 0.6;
      for (const { ref, d } of this.waveList) this.schedule(ref.index, this.waveAt + d / LIFT.wave + LIFT.waveJitter * liftSeed(ref.index, 3), false);
      this.g.sound.wave();
    }
    // the wave's slow motion, as its front comes within 150 m of the bus
    if (liftedOn && this.waveAt >= 0 && !this.waveSlowDone) {
      const front = Math.max(0, (now - this.waveAt) * LIFT.wave);
      const db = Math.hypot(bus.x - this.heart[0], bus.z - this.heart[1]);
      if (now >= this.waveAt + LIFT.crouch && front >= db - 150) {
        this.waveSlowDone = true;
        this.slow(SLOW_WAVE);
      }
    }
    this.hitJumps = 0;
    for (let p = 0; p < this.nPending; ) {
      const i = this.pending[p];
      if (now < this.t0[i] + LIFT.crouch) {
        p++;
        continue;
      }
      const ref = this.refs.get(i);
      if (ref && this.held[i] < HOLD_MAX && this.blocks(ref, i, bus, cam)) {
        // held in its crouch: the clock it jumps by waits with it
        this.t0[i] += dt;
        this.held[i] += dt;
        this.writeTexel(i);
        this.stats.held++;
        p++;
        continue;
      }
      this.pending[p] = this.pending[--this.nPending];
      this.jump(i, ref);
    }
    if (this.hitJumps) {
      this.g.sound.jump(this.hitJumps, this.hitHue);
      this.slow(SLOW_HIT);
    }
    this.stats.up = this.nUp;
    this.stats.cells = this.field.builtCount;
    // uploads: at most one texSubImage2D a texture a frame
    if (this.dirty1 >= 0) {
      const w = this.g.city.paint.width;
      const y0 = Math.floor(this.dirty0 / w), y1 = Math.floor(this.dirty1 / w);
      if (!uploadRect(renderer, this.tex, 0, y0, w, y1 - y0 + 1, WebGL2RenderingContext.RGBA, WebGL2RenderingContext.FLOAT, 4)) this.tex.needsUpdate = true;
      this.dirty0 = Infinity;
      this.dirty1 = -1;
    }
    if (this.lakeDirty) {
      this.lakeDirty = false;
      this.lakeTex.needsUpdate = true;
    }
    if (this.capsDirty) {
      this.capsDirty = false;
      this.caps.geometry.dispose();
      this.caps.geometry = makeCapGeometry(this.refs.values(), (r) => this.jetOf(r));
      this.stats.capsTris = (this.caps.geometry.index?.count ?? 0) / 3;
      this.caps.visible = true;
    }
  }

  /** Would this house, jumping now, rise into the bus or the camera? */
  private blocks(ref: BuildingRef, i: number, bus: { x: number; y: number; z: number }, cam: THREE.Vector3): boolean {
    const top = ref.roofY + this.H[i];
    const near = (x: number, z: number) => Math.hypot(Math.max(ref.x0 - x, 0, x - ref.x1), Math.max(ref.z0 - z, 0, z - ref.z1));
    if (bus.y < top + 8 && near(bus.x, bus.z) < Math.max(8, 0.4 * this.busSpeed)) return true;
    return cam.y < top + 3 && near(cam.x, cam.z) < 8;
  }
  /** the bus's ground speed (m/s), main's each frame */
  busSpeed = 0;

  private jump(i: number, ref: BuildingRef | undefined) {
    this.state[i] = ST_UP;
    this.nUp++;
    if (!ref) return;
    this.field.reach(ref.x0, ref.z0, ref.x1, ref.z1);
    const hue = Math.round(this.g.city.paint.get(i).color);
    // its small growth goes up as petals: the triangle bound
    const n = this.g.sprouts.shed(i, petalAt);
    const hit = this.fromHit[i] === 1;
    for (let k = 0; k < Math.max(1, n); k++) {
      const x = n ? petalAt[k * 2] : ref.cx, z = n ? petalAt[k * 2 + 1] : ref.cz;
      this.g.petals(x, ref.roofY + 0.5, z, hue, hit ? 24 / Math.max(1, n) : 8 / Math.max(1, n));
    }
    if (hit) {
      this.hitJumps++;
      this.hitHue = hue;
    } else if (this.wall - this.noteT > 1 / 12) {
      this.noteT = this.wall;
      this.g.sound.note(this.notes++, this.waveList.length, hue);
    }
  }

  // ------------------------------------------------------------ slow motion

  private slow(p: readonly number[]) {
    if (!slowmoOn || this.wall - this.slowLast < SLOW_COOLDOWN) return;
    this.slowLast = this.wall;
    this.slowT = 0;
    this.slowP = p;
  }

  /** The game clock's factor this frame (main's dt is multiplied by it). Runs on the wall clock. */
  timeScale(realDt: number): number {
    if (this.slowT === Infinity) return 1;
    this.slowT += realDt;
    const [k, a, h, b] = this.slowP;
    const s = slowAt(this.slowT, k, a, h, b);
    if (this.slowT >= a + h + b) this.slowT = Infinity;
    return s;
  }

  // ------------------------------------------------------------ the low camera

  /**
   * The camera's low shot (CameraRig.openingLow, the Golden Gate's): eased in while a floating house is over the bus or near it and the low lens's
   * line back to the bus is clear; out once it has failed for half a second.
   */
  lowTarget(bus: { x: number; y: number; z: number; fx: number; fz: number }, realDt: number, back: number, lift: number): number {
    let want = 0;
    if (this.nUp) {
      let over = false;
      for (const [ox, oz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]] as const) if (this.overhead(bus.x + ox, bus.z + oz, bus.y) < Infinity) over = true;
      if (over) {
        let clear = true;
        for (let k = 1; k <= 5 && clear; k++) {
          const d = (k / 5) * back;
          const x = bus.x - bus.fx * d, z = bus.z - bus.fz * d;
          // (the houses and the ground, not the trees: the low shot looks through a canopy as it does under the Golden Gate)
          if (this.g.city.groundAt(x, z) + 2 > bus.y + lift * (k / 5) || this.solidAt(x, z, bus.y + lift * (k / 5))) clear = false;
        }
        want = clear ? 1 : 0;
      }
    }
    // (it must fail for half a second before it leaves: the camera doesn't pump between houses)
    if (want) {
      this.lowFail = 0;
      this.lowWant = 1;
    } else if ((this.lowFail += realDt) >= 0.5) this.lowWant = 0;
    const t = this.lowWant;
    this.lowK = t > this.lowK ? Math.min(t, this.lowK + realDt * 1.5) : Math.max(t, this.lowK - realDt * 0.6);
    return this.lowK;
  }

  /** a grounded building stands above y at (x, z) */
  private solidAt(x: number, z: number, y: number): boolean {
    const r = this.g.city.buildingAt(x, z, y);
    return !!r && this.state[r.index] !== ST_UP && r.roofY > y;
  }

  /**
   * The lens kept out of the floating layer (CameraRig.liftClamp): in the low shot 3 m under any house overhead, else out over its top.
   * Never under the ground's 4 m.
   */
  clampLens(x: number, z: number, y: number, low: number): number {
    if (!this.nUp || !this.inRect(x, z)) return y;
    // (the cell under the lens and four 6 m round it: a house beside the lens is no nearer than one over it)
    let under = Infinity, top = -Infinity;
    for (const [ox, oz] of LENS_RING) {
      const t = this.field.query(x + ox, z + oz, 1e9, 0, false);
      this.field.query(x + ox, z + oz, -1e9, 0, false);
      if (this.field.under === Infinity) continue;
      under = Math.min(under, this.field.under);
      top = Math.max(top, t);
    }
    if (under === Infinity) return y;
    if (y < under - 3 || y > top + 3) return y;
    const floor = this.g.city.groundAt(x, z) + 4;
    return low > 0.5 && under - 3 > floor ? under - 3 : top + 3;
  }

  /** Where the bus starts: the hood's edge on the sun's side, facing in (`out`: that far from the heart instead). */
  startFor(sunX: number, sunZ: number, out?: number) {
    return hoodStart(this.squares, this.heartKey, sunX, sunZ, out);
  }
}
