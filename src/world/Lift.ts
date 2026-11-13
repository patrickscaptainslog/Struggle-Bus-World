import * as THREE from 'three';
import { FACTION_HYPERGLOW } from '../game/factions';
import { uploadRect } from '../render/upload';
import type { BuildingRef, City } from './City';
import type { HoodsTable } from './hoods';
import type { RoofSprouts } from './props/sprouts';
import { liftUniforms } from './buildingMaterial';
import { LiftField, type FieldHouses } from './LiftField';
import { makeCapGeometry, makeCapMaterial, makeLiftDepthMaterial, registerLiftWarm, type Centre } from './liftDraw';
import { type Beam, makeBeam, makeSkyPiece, registerBeamWarm, registerSkyWarm, type SkyPiece } from './liftSky';
import {
  hoodStart, LAKE_FLOOD, liftAt, liftWakes, waveSlow, liftFaction, liftTurnCode, liftLow, LIFT_NEAR, liftPlace, type LiftNear, liftedOn, liftHeave, liftReach, liftRest, liftSeed, liftTiltReach, LIFT, slowAt, slowmoOn, SLOW_COOLDOWN, SLOW_HIT, SLOW_WAVE, SQUARE, squareIx, squareIz, squareKey, type LiftHooks,
} from './liftGlsl';

// The Lift, the first slice of the stages (docs/specs/factions/LIFT.md; FACTIONS.md section 2, Team Super Rainbow's "4 · Liftoff"): behind ?lift,
// in one neighbourhood. A Rainbow house at level 3 that a Rainbow breath hits again crouches as the shockwave reaches it, leaps and floats over
// a lake of paint, nothing under it, riding a swell across the neighbourhood like a boat on water, and the bus flies under it. &lifted stages the whole neighbourhood at level 3 for the
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
  /** petals at a jump: a burst and sparkles in the house's hue, in its owner's colours */
  petals(x: number, y: number, z: number, hue: number, n: number, faction: number): void;
  sound: { wave(): void; crouch(): void; jump(n: number, hue: number): void; note(i: number, n: number, hue: number): void };
  /** the sun's way on the ground (x, z) at boot: the side the sky piece faces */
  sun: [number, number];
  /** the scene's camera: the wake asks whether the heart is in its frame (as last drawn) */
  camera: THREE.Camera;
}

const ST_GROUND = 0, ST_PENDING = 1, ST_UP = 2;
/** a house held back from jumping into the bus or the camera waits at most this long (s) */
const HOLD_MAX = 3;
const tmp = [0, 0, 0, 0];
const heartAt = new THREE.Vector3();
const petalAt = new Float32Array(16);
const LENS_RING = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]] as const;
const OVER_RING = [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]] as const;
/** fromHit: a wave's house, a tap's or MEGA's (its slow motion), the firehose's (none: a hose held over level-3 rows never stutters) */
const BY_WAVE = 0, BY_HIT = 1, BY_HOSE = 2;
/** &lifted stages this many houses a frame */
const STAGE_STEP = 50;
/** nearPlaced's index: its cells (m) */
const NEAR_CELL = 32;
/** roofNear's cells (m) */
const ROOF_CELL = 16;
const NONE: readonly number[] = [];

/** How far (x, z) is from a house's footprint bounds (m; 0 over it). */
function nearRef(ref: BuildingRef, x: number, z: number): number {
  return Math.hypot(Math.max(ref.x0 - x, 0, x - ref.x1), Math.max(ref.z0 - z, 0, z - ref.z1));
}

export class Lift implements LiftHooks, FieldHouses {
  readonly name: string;
  /** whose the staged block is (&lifted=<faction>; Rainbow without): its staging, its sky piece and its light only. Who hits it is the blast's own faction, never this */
  readonly block = liftFaction;
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
  /** its centre (m): the swell under it, its lean's pivot, the lake's rings; and its reach from it */
  readonly cx: Float32Array;
  readonly cz: Float32Array;
  readonly rad: Float32Array;
  /** its heave with the swell (m, liftHeave) */
  private readonly heave: Float32Array;
  /** how far its lean takes a point of it off its centre's height (m) */
  readonly tiltM: Float32Array;
  /** 1: it floats too low for the bus to pass under (its lowest belly under LIFT_PASS): an obstacle from the ground up, to fly over or round */
  readonly solid: Uint8Array;
  /** the motion's last answer and the game time it's for (the flight asks many times a frame) */
  private readonly memT: Float64Array;
  private readonly mem: Float32Array;
  private readonly held: Float32Array;
  private readonly fromHit: Uint8Array;
  /** tLift's first texel's w: a Hyperglow house's turn (liftTurnCode), 0 for none */
  private readonly turn: Float32Array;
  /** &lifted: the hue a house was staged in (-1: not staged); a tile streaming back in stages it again over the save */
  private readonly stagedHue: Int8Array;
  /** liftable houses of the loaded tiles, by index */
  readonly refs = new Map<number, BuildingRef>();
  /** the liftable houses by the NEAR_CELL m cell of their centre, and the widest reach among them (m): nearPlaced's index */
  private readonly nearGrid = new Map<number, number[]>();
  private nearRad = 0;
  private readonly pending = new Int32Array(LIFT.cap);
  private nPending = 0;
  private nUp = 0;
  /**
   * &lifted: the wave's houses whose rest heights are placed already, before it (plan()): the wave lifts each at its placed height. Never
   * cleared, and plan() runs once: a Lift stages one neighbourhood once (`staged` never goes back) and a page makes one Lift. Whatever stages
   * again clears this and planDone first, or its wave lifts the first plan's houses at their old heights
   */
  private readonly planned = new Set<number>();
  private planDone = false;

  // ---- the GPU's
  private readonly data: Float32Array;
  private readonly tex: THREE.DataTexture;
  private dirty0 = Infinity;
  private dirty1 = -1;
  readonly field: LiftField;
  private readonly caps: THREE.Mesh;
  private capsDirty = false;
  private readonly lake: Float32Array;
  private readonly lakeTex: THREE.DataTexture;
  private readonly lakeW: number;
  private readonly lakeH: number;
  private readonly lakeCell: number;
  /** the lake's texels on the neighbourhood's squares (it floods them only) */
  private readonly lakeIn: Uint8Array;
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
  /** &lifted, once staged: the squares with a staged house (x0, z0, x1, z1 each, m), the farthest staged house from the heart (m) and the heart's ground (m) */
  private stagedRects: number[] = [];
  private readonly stagedSq = new Set<number>();
  private stagedFar = 0;
  private heartY = 0;
  /** the hit lifts this frame took off, for one sound and one slow motion */
  private hitJumps = 0;
  private hoseJumps = 0;
  private hitHue = 0;
  private lowK = 0;
  private lowWant = 0;
  private lowFail = 0;
  /** what the QA reads */
  readonly stats = { scheduled: 0, up: 0, held: 0, cells: 0, capsTris: 0, skyTris: 0, skyMs: 0, skySteps: 0, planMs: 0, turning: 0 };
  /** the neighbourhood's streets (its tiles' OpenStreetMap centrelines through its squares), for the sky piece; the tiles they came from */
  private readonly streets: Array<{ rank: number; xz: Float32Array }> = [];
  private readonly streetTiles = new Set<string>();
  /** the faction's sky piece over the heart (liftSky.ts), once its tiles are in; null for Rainbow (its halo isn't built) */
  private sky: SkyPiece | null = null;
  /** the sky piece being built, a part a frame (frame()), from the frame after staging's last */
  private skyBuild: ReturnType<typeof makeSkyPiece> = null;
  /** &lifted's far sign: the block's light over the heart (liftSky.ts), from the Lift's construction */
  readonly beam: Beam | null = null;
  /** the bus as frame() had it, for lens() (the caller's own object) */
  private busAt: { x: number; y: number; z: number } | null = null;

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
    this.stagedHue = new Int8Array(texels).fill(-1);
    this.state = new Uint8Array(texels);
    this.H = new Float32Array(texels);
    this.margin = new Float32Array(texels);
    this.base = new Float32Array(texels);
    this.t0 = new Float32Array(texels);
    this.extra = new Float32Array(texels);
    this.seedB = new Float32Array(texels);
    this.cx = new Float32Array(texels);
    this.cz = new Float32Array(texels);
    this.rad = new Float32Array(texels);
    this.heave = new Float32Array(texels);
    this.tiltM = new Float32Array(texels);
    this.solid = new Uint8Array(texels);
    this.memT = new Float64Array(texels).fill(NaN);
    this.mem = new Float32Array(texels * 3);
    this.held = new Float32Array(texels);
    this.fromHit = new Uint8Array(texels);
    this.turn = new Float32Array(texels);
    // (two texels a house, the second uLiftRows rows down: its crouch start, rest and seed; its centre, ground and heave)
    this.data = new Float32Array(texels * 8);
    this.tex = new THREE.DataTexture(this.data, city.paint.width, city.paint.height * 2, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;

    // the lake's mask over the rect, 2 m a texel (coarser past 2 km): the nearest liftable house, its edge's signed distance and its centre
    const span = Math.max(this.rect[2] - this.rect[0], this.rect[3] - this.rect[1]);
    this.lakeCell = Math.max(2, Math.ceil(span / 1024));
    this.lakeW = Math.ceil((this.rect[2] - this.rect[0]) / this.lakeCell);
    this.lakeH = Math.ceil((this.rect[3] - this.rect[1]) / this.lakeCell);
    this.lake = new Float32Array(this.lakeW * this.lakeH * 4);
    for (let i = 0; i < this.lake.length; i += 4) this.lake[i + 1] = -LAKE_FLOOD;
    this.lakeIn = new Uint8Array(this.lakeW * this.lakeH);
    for (let j = 0; j < this.lakeH; j++)
      for (let i = 0; i < this.lakeW; i++) {
        const px = this.rect[0] + (i + 0.5) * this.lakeCell, pz = this.rect[1] + (j + 0.5) * this.lakeCell;
        const k = squareKey(Math.floor(px / SQUARE), Math.floor(pz / SQUARE));
        if (this.squares.has(k) && !this.tagged.has(k)) this.lakeIn[j * this.lakeW + i] = 1;
      }
    this.lakeTex = new THREE.DataTexture(this.lake, this.lakeW, this.lakeH, THREE.RGBAFormat, THREE.FloatType);
    this.lakeTex.minFilter = this.lakeTex.magFilter = THREE.NearestFilter;
    this.lakeTex.generateMipmaps = false;
    this.lakeTex.needsUpdate = true;

    const u = liftUniforms!;
    u.tLift.value = this.tex;
    u.uLiftRect.value.set(this.rect[0], this.rect[1], this.rect[2], this.rect[3]);
    u.uLiftW.value = city.paint.width;
    u.uLiftRows.value = city.paint.height;
    u.tLake.value = this.lakeTex;
    u.uLakeRect.value.set(this.rect[0], this.rect[1], 1 / this.lakeCell, 0);

    const c = ts / m.obstN;
    this.field = new LiftField(Math.floor(this.rect[0] / c) * c, Math.floor(this.rect[1] / c) * c, this.rect[2], this.rect[3], c, city, this);

    this.caps = new THREE.Mesh(new THREE.BufferGeometry(), makeCapMaterial());
    this.caps.frustumCulled = false;
    this.caps.visible = false;
    g.scene.add(this.caps);
    this.depthMaterial = makeLiftDepthMaterial();
    registerLiftWarm(this.depthMaterial);
    registerSkyWarm(this.block);
    if (liftedOn) {
      // (from hoods.bin alone: no tile needed. Its ground is the heart's as known now, and again once staging has the tiles)
      this.beam = makeBeam(this.block, this.heart, city.groundAt(this.heart[0], this.heart[1]));
      g.scene.add(this.beam.mesh);
      registerBeamWarm();
    }
    // (bounds grown past the highest flyer's overshoot and heave: a house 100 m up is never culled)
    city.liftShadow = { rect: this.rect, material: this.depthMaterial, grow: Math.ceil(LIFT.hMax * 1.14 + LIFT.heaveSmall * 1.2 + 2) };
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
    return this.field.overhead(x, z, fromY);
  }

  surface(x: number, z: number, fromY: number, baked: number): number {
    if (!this.nUp || !this.inRect(x, z)) return baked;
    return this.field.query(x, z, fromY, baked, true);
  }

  /** the motion now, once a frame a house: mem's dy, lean x, lean z (the offset of its three) */
  private motion(i: number): number {
    if (this.memT[i] !== this.now) {
      liftAt(this.now - this.t0[i], this.now, this.H[i], this.seedB[i], this.cx[i], this.cz[i], this.heave[i], tmp);
      this.memT[i] = this.now;
      this.mem[i * 3] = tmp[0];
      this.mem[i * 3 + 1] = tmp[2];
      this.mem[i * 3 + 2] = tmp[3];
    }
    return i * 3;
  }

  dy(index: number): number {
    if (this.state[index] === ST_GROUND) return 0;
    return this.mem[this.motion(index)];
  }

  dyNow(index: number): number {
    return this.dy(index);
  }

  /** the drawn lift of the house at (x, z), its lean in it (m): what the aim and the exact field see */
  dyAt(index: number, x: number, z: number): number {
    if (this.state[index] === ST_GROUND) return 0;
    const o = this.motion(index);
    return this.mem[o] + (x - this.cx[index]) * this.mem[o + 1] + (z - this.cz[index]) * this.mem[o + 2];
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
  tileIn(tx: number, tz: number, refs: BuildingRef[], streets?: ReadonlyArray<{ rank: number; xz: Float32Array }>, trees?: ReadonlyArray<{ x: number; z: number }>) {
    const ts = this.g.city.manifest.tileSize;
    if ((tx + 1) * ts < this.rect[0] || tx * ts > this.rect[2] || (tz + 1) * ts < this.rect[1] || tz * ts > this.rect[3]) return;
    // (its streets through the squares, once a tile: the sky piece's)
    if (streets && !this.streetTiles.has(`${tx},${tz}`)) {
      this.streetTiles.add(`${tx},${tz}`);
      for (const t of trees ?? []) if (this.inRect(t.x, t.z)) this.trees.push(t.x, t.z);
      for (const ln of streets)
        for (let k = 0; k + 1 < ln.xz.length; k += 2)
          if (this.squares.has(squareKey(Math.floor(ln.xz[k] / SQUARE), Math.floor(ln.xz[k + 1] / SQUARE)))) {
            this.streets.push({ rank: ln.rank, xz: ln.xz });
            break;
          }
    }
    let any = false;
    for (const ref of refs) {
      if (!this.liftable(ref)) continue;
      const i = ref.index;
      const fresh = !this.refs.has(i);
      if (fresh) {
        // (its rest is its hash's until it's scheduled, and then pushed clear of its floating neighbours': liftApart)
        this.H[i] = liftRest(ref.area, ref.roofY - ref.baseY, i);
        this.seedB[i] = liftSeed(i, 2);
        this.heave[i] = liftHeave(ref.area, ref.roofY - ref.baseY, i);
        this.cx[i] = ref.cx;
        this.cz[i] = ref.cz;
        this.rad[i] = ref.rad;
        this.margin[i] = liftReach(this.heave[i], ref.rad);
        this.tiltM[i] = liftTiltReach(ref.rad);
        const k = squareKey(Math.floor(ref.cx / NEAR_CELL), Math.floor(ref.cz / NEAR_CELL));
        let cell = this.nearGrid.get(k);
        if (!cell) this.nearGrid.set(k, (cell = []));
        cell.push(i);
        this.nearRad = Math.max(this.nearRad, ref.rad);
      }
      // (the ref is new with each arrival: the tile's records)
      this.refs.set(i, ref);
      this.base[i] = ref.baseY;
      // (the save's record came in with the tile over the staging: a staged house keeps its level, hue and faction in the sky)
      if (this.stagedHue[i] >= 0) this.g.city.paint.stage(i, { faction: this.block, color: this.stagedHue[i], level: 3, bloomTime: -1000 });
      // (its lake and its underside are its footprint's, the same at every arrival: a tile streaming back in, as a climb's level of detail
      // swaps them, rasters and rebuilds nothing. The first warmcheck after the lake flooded wider had frames of 100-134 ms in the climb)
      if (fresh) {
        this.raster(ref);
        any = true;
      }
    }
    this.field.clear(tx * ts, tz * ts, (tx + 1) * ts, (tz + 1) * ts);
    if (any) {
      this.capsDirty = true;
      this.lakeDirty = true;
    }
    this.tilesWanted.delete(`${tx},${tz}`);
  }

  /** A house's centre and reach: the swell's, the lean's pivot, the lake's rings and the drips run from it. */
  private centreOf(ref: BuildingRef): Centre {
    return { x: ref.cx, z: ref.cz, r: ref.rad };
  }

  /** One house's footprint into the lake's mask: where it is the nearest, its index, the signed distance to its edge (m, + inside, within LAKE_FLOOD outside) and its centre. */
  private raster(ref: BuildingRef) {
    const b = ref.tile, c = this.lakeCell, W = this.lakeW, Hh = this.lakeH, ox = this.rect[0], oz = this.rect[1], F = LAKE_FLOOD;
    const ctr = this.centreOf(ref);
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
      const i0 = Math.max(0, Math.floor((x0 - F - ox) / c)), i1 = Math.min(W - 1, Math.floor((x1 + F - ox) / c));
      const j0 = Math.max(0, Math.floor((z0 - F - oz) / c)), j1 = Math.min(Hh - 1, Math.floor((z1 + F - oz) / c));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          if (!this.lakeIn[j * W + i]) continue;
          const px = ox + (i + 0.5) * c, pz = oz + (j + 0.5) * c;
          let inside = false, d = Infinity;
          for (let v = s, w = e - 1; v < e; w = v++) {
            const ax = b.xz[w * 2], az = b.xz[w * 2 + 1], bx = b.xz[v * 2], bz = b.xz[v * 2 + 1];
            if (bz > pz !== az > pz && px < ((ax - bx) * (pz - bz)) / (az - bz) + bx) inside = !inside;
            const ex = ax - bx, ez = az - bz, l2 = ex * ex + ez * ez;
            const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - bx) * ex + (pz - bz) * ez) / l2)) : 0;
            d = Math.min(d, Math.hypot(px - bx - ex * t, pz - bz - ez * t));
          }
          const sd = inside ? Math.min(d, 40) : -Math.min(d, F);
          const o = (j * W + i) * 4;
          if (sd > this.lake[o + 1]) {
            this.lake[o] = ref.index + 1;
            this.lake[o + 1] = sd;
            this.lake[o + 2] = ctr.x;
            this.lake[o + 3] = ctr.z;
          }
        }
    }
  }

  // ------------------------------------------------------------ lifting

  /** Splat's question for a building a blast reaches (0 no, 1 it lifts now, 2 it's lifting or up already): the Lift's faction on its own, level 3 before the blast. */
  wants(ref: BuildingRef, level: number, faction: number): 0 | 1 | 2 {
    const i = ref.index;
    if (!this.refs.has(i)) return 0;
    if (this.state[i] !== ST_GROUND) return 2;
    const can = Math.round(level) >= 3 && faction === this.block && this.g.city.paint.get(i).faction === this.block && this.nUp + this.nPending + this.asked < LIFT.cap;
    if (can) {
      // (one blast asks for each of its houses before any starts: the cap counts them as they're asked)
      this.asked++;
      return 1;
    }
    // (a staged house waiting for its wave is the session's, never the save's: a breath leaves its paint alone, as one does a floating house)
    return this.stagedHue[i] >= 0 ? 2 : 0;
  }

  /**
   * &lifted: the lift-off wave from the heart, `now` + 0.6 s, with its boom. It starts once staging is done, as the bus comes to the block (wakes),
   * or at a knock (landed)
   */
  private wave(now: number) {
    this.waveAt = now + 0.6;
    // (placed low ones first, out from the heart, then the rest: waveOrder, plan(). The crouches go by distance whatever the order)
    for (const { ref, d } of this.waveOrder()) this.schedule(ref.index, this.waveAt + d / LIFT.wave + LIFT.waveJitter * liftSeed(ref.index, 3), BY_WAVE);
    if (this.block === FACTION_HYPERGLOW) this.turns();
    this.sky?.start(this.waveAt);
    if (this.sky) this.beam?.foot(this.sky.top, this.waveAt);
    this.g.sound.wave();
  }

  /** Does the bus wake the block now (liftWakes): its distance to the nearest staged square, its height over the heart's ground, its heading, the lens's frame. */
  private wakes(bus: { x: number; y: number; z: number; fx: number; fz: number }): boolean {
    let dh = Infinity;
    const r = this.stagedRects;
    for (let k = 0; k < r.length; k += 4) dh = Math.min(dh, Math.hypot(Math.max(r[k] - bus.x, 0, bus.x - r[k + 2]), Math.max(r[k + 1] - bus.z, 0, bus.z - r[k + 3])));
    const h = bus.y - this.heartY, d = Math.hypot(dh, Math.max(0, h));
    const hx = this.heart[0] - bus.x, hz = this.heart[1] - bus.z, hl = Math.hypot(hx, hz);
    const ahead = hl > 1e-6 ? (hx * bus.fx + hz * bus.fz) / (hl * (Math.hypot(bus.fx, bus.fz) || 1)) : 1;
    // (the heart's ground in the frame as last drawn)
    heartAt.set(this.heart[0], this.heartY, this.heart[1]).project(this.g.camera);
    const seen = heartAt.z < 1 && Math.abs(heartAt.x) <= 1 && Math.abs(heartAt.y) <= 1;
    return liftWakes(d, dh, h, this.busSpeed, ahead, seen);
  }

  /** A blast has landed (Splat): one on a staged square before the wave wakes the block to the knock, the wave's own boom with it. Nothing while staging waits on its tiles. */
  landed(b: { primary: { index: number; cx: number; cz: number } | null; pos: { x: number; z: number }; t: number }) {
    if (!liftedOn || !this.staged || this.waveAt >= 0) return;
    const x = b.primary ? b.primary.cx : b.pos.x, z = b.primary ? b.primary.cz : b.pos.z;
    if (this.stagedSq.has(squareKey(Math.floor(x / SQUARE), Math.floor(z / SQUARE))) || this.stagedSq.has(squareKey(Math.floor(b.pos.x / SQUARE), Math.floor(b.pos.z / SQUARE)))) this.wave(b.t);
  }

  /** houses a blast asked to lift (wants) that haven't started yet */
  private asked = 0;

  /** A hit lifts a house: it crouches at `at` (its bloom's arrival, game clock), as the shockwave reaches it. `hose`: a firehose impact's (no slow motion). */
  start(ref: BuildingRef, at: number, hose = false) {
    this.asked = Math.max(0, this.asked - 1);
    if (this.state[ref.index] !== ST_GROUND) return;
    if (!this.nPending) this.g.sound.crouch();
    this.schedule(ref.index, at, hose ? BY_HOSE : BY_HIT);
  }

  private schedule(i: number, at: number, by: number) {
    const ref = this.refs.get(i);
    // (a house already lifting or up stays as it is: a hit before the wave lifted it, and the wave mustn't drop it to the ground and launch it again)
    if (!ref || this.state[i] !== ST_GROUND || this.nUp + this.nPending >= LIFT.cap) return;
    // (its height among its neighbours that went before it: never two touching alike, a low one only with room over it: liftPlace. A wave's
    // house placed already by plan() keeps that height)
    if (!this.planned.has(i)) this.H[i] = liftPlace(liftRest(ref.area, ref.roofY - ref.baseY, i), ref.roofY - ref.baseY, this.margin[i], this.nearPlaced(ref));
    this.solid[i] = liftLow(this.H[i], this.margin[i]) ? 1 : 0;
    this.state[i] = ST_PENDING;
    this.t0[i] = at;
    this.held[i] = 0;
    this.fromHit[i] = by;
    this.pending[this.nPending++] = i;
    this.writeTexel(i);
    this.stats.scheduled++;
  }

  /**
   * &lifted: the wave's rest heights, placed before it (once, from the sky piece's first part: it stands over them), in its own order with the
   * same liftPlace, so they come out as the wave would have placed them; the wave, or a hit before it, then lifts each at its placed height.
   */
  private plan() {
    if (this.planDone || !this.staged) return;
    this.planDone = true;
    for (const { ref } of this.waveOrder()) {
      const i = ref.index;
      if (this.state[i] !== ST_GROUND) continue;
      this.H[i] = liftPlace(liftRest(ref.area, ref.roofY - ref.baseY, i), ref.roofY - ref.baseY, this.margin[i], this.nearPlaced(ref));
      this.planned.add(i);
    }
  }
  /** the wave's houses in the order it places them: the low ones first, out from the heart, then the rest (a low house keeps its room by its neighbours rising round it, liftPlace) */
  private *waveOrder() {
    const low = (r: BuildingRef) => liftLow(liftRest(r.area, r.roofY - r.baseY, r.index), this.margin[r.index]);
    for (const pass of [true, false]) for (const w of this.waveList) if (low(w.ref) === pass) yield w;
  }

  /**
   * The highest any floating house whose footprint's bounds come within r m of (x, z) can reach (m, world y; -Infinity for none), the sky
   * piece's (liftSky's SkyPlace.roof): the wave's houses at their placed heights (plan()) and any up already, each its roof or its domes (6 m,
   * or its garden's noted top), its rest with the overshoot (14 %) and its heave and lean (its margin), as the flight's slab counts it.
   */
  roofNear(x: number, z: number, r: number): number {
    let top = -Infinity;
    // (a wide one, as the Hellmouth's smoke, looks at every house; a narrow one at the ROOF_CELL cells under the square round it, a little more
    // than it asked: the Skyway asks once a lane, and by the houses' own cells that was up to 50 ms on a big neighbourhood)
    if (r > 300) {
      this.plan();
      for (const [i, o] of this.refs) if (this.floats(i) && nearRef(o, x, z) <= r) top = Math.max(top, this.topOf(i, o));
    } else {
      const g = this.roofGrid();
      for (let qz = Math.floor((z - r) / ROOF_CELL); qz <= Math.floor((z + r) / ROOF_CELL); qz++)
        for (let qx = Math.floor((x - r) / ROOF_CELL); qx <= Math.floor((x + r) / ROOF_CELL); qx++) top = Math.max(top, g.get(squareKey(qx, qz)) ?? -Infinity);
    }
    return top;
  }
  /** a house up, lifting, or placed for the wave (plan()) */
  private floats(i: number) {
    return this.state[i] !== ST_GROUND || this.planned.has(i);
  }
  /** the highest a floating house can reach (roofNear) */
  private topOf(i: number, o: BuildingRef) {
    return Math.max(o.roofY + 6, this.extra[i]) + this.H[i] * 1.14 + this.margin[i];
  }
  /** roofNear's cells: each ROOF_CELL m cell's highest reach among the floating houses whose footprints' bounds touch it, after the plan (once a sky piece's build) */
  private roofGrid(): Map<number, number> {
    if (this.roofCells) return this.roofCells;
    this.plan();
    const g = (this.roofCells = new Map<number, number>());
    for (const [i, o] of this.refs) {
      if (!this.floats(i)) continue;
      const t = this.topOf(i, o);
      for (let qz = Math.floor(o.z0 / ROOF_CELL); qz <= Math.floor(o.z1 / ROOF_CELL); qz++)
        for (let qx = Math.floor(o.x0 / ROOF_CELL); qx <= Math.floor(o.x1 / ROOF_CELL); qx++) {
          const k = squareKey(qx, qz);
          if (!(t <= (g.get(k) ?? -Infinity))) g.set(k, t);
        }
    }
    return g;
  }
  private roofCells: Map<number, number> | null = null;

  /**
   * the house's near neighbours (their footprints' bounds within LIFT_NEAR m) already lifting or up, as liftPlace reads them. From the Lift's own
   * index of its houses, by bounds alone: the City's buildingsWithin measured every building's edge round it, 56-73 ms for the wave's 400 in its
   * first frame (the review's hitch)
   */
  private nearPlaced(ref: BuildingRef): LiftNear[] {
    const out: LiftNear[] = [];
    this.nearEach(ref, LIFT_NEAR, (o) => {
      const i = o.index;
      if (this.state[i] === ST_GROUND && !this.planned.has(i)) return;
      const dist = Math.hypot(Math.max(o.x0 - ref.x1, 0, ref.x0 - o.x1), Math.max(o.z0 - ref.z1, 0, ref.z0 - o.z1));
      out.push({ H: this.H[i], height: o.roofY - o.baseY, reach: this.margin[i], dist, touching: dist <= 3 * Math.SQRT2 && o.x0 - 3 <= ref.x1 && o.x1 + 3 >= ref.x0 && o.z0 - 3 <= ref.z1 && o.z1 + 3 >= ref.z0 });
    });
    return out;
  }

  /** Each other liftable house whose footprint's bounds come within g m of ref's, from the Lift's own index. */
  private nearEach(ref: BuildingRef, g: number, fn: (o: BuildingRef) => void) {
    const r = g + this.nearRad;
    const c0x = Math.floor((ref.x0 - r) / NEAR_CELL), c1x = Math.floor((ref.x1 + r) / NEAR_CELL);
    const c0z = Math.floor((ref.z0 - r) / NEAR_CELL), c1z = Math.floor((ref.z1 + r) / NEAR_CELL);
    for (let qz = c0z; qz <= c1z; qz++)
      for (let qx = c0x; qx <= c1x; qx++)
        for (const i of this.nearGrid.get(squareKey(qx, qz)) ?? NONE) {
          const o = this.refs.get(i);
          if (!o || i === ref.index) continue;
          if (o.x0 - g > ref.x1 || o.x1 + g < ref.x0 || o.z0 - g > ref.z1 || o.z1 + g < ref.z0) continue;
          fn(o);
        }
  }

  private writeTexel(i: number) {
    const o = i * 4, o2 = (this.state.length + i) * 4;
    this.data[o] = this.t0[i];
    this.data[o + 1] = this.H[i];
    this.data[o + 2] = this.seedB[i];
    this.data[o + 3] = this.turn[i];
    this.data[o2] = this.cx[i];
    this.data[o2 + 1] = this.base[i];
    this.data[o2 + 2] = this.cz[i];
    this.data[o2 + 3] = this.heave[i];
    this.memT[i] = NaN;
    if (i < this.dirty0) this.dirty0 = i;
    if (i > this.dirty1) this.dirty1 = i;
  }

  /**
   * &lifted: the neighbourhood's houses (the 600 nearest its heart) at level 3, Rainbow, for this session only, STAGE_STEP a frame out from the
   * heart (all 400 in one frame, their gardens grown, were 38-54 ms of it, the frame the wave could start in); the wave waits for the last.
   */
  private stage() {
    const city = this.g.city;
    const [hx, hz] = this.heart;
    const list = (this.stageList ??= [...this.refs.values()].map((ref) => ({ ref, d: Math.hypot(ref.cx - hx, ref.cz - hz) })).sort((a, b) => a.d - b.d).slice(0, LIFT.cap));
    for (const end = Math.min(list.length, this.stageN + STAGE_STEP); this.stageN < end; this.stageN++) {
      const { ref } = list[this.stageN];
      // its 60-degree wedge round the heart, then the nearest hue no touching neighbour has (Splatter.freeHue's rule)
      const a = Math.atan2(ref.cz - hz, ref.cx - hx);
      const pref = ((Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6) % 6) + 6) % 6;
      // (the hues its touching neighbours already have, from the Lift's own index: the City's buildingsWithin, six times a house, was most of
      // the 50 ms this frame took for the wave's 400)
      let taken = 0;
      this.nearEach(ref, 2.5, (o) => {
        const oh = this.stagedHue[o.index];
        if (oh >= 0) taken |= 1 << oh;
      });
      let pick = pref;
      for (const off of [0, 1, -1, 2, -2, 3]) {
        const h = (pref + off + 6) % 6;
        if (!(taken & (1 << h))) {
          pick = h;
          break;
        }
      }
      this.stagedHue[ref.index] = pick;
      city.paint.stage(ref.index, { faction: this.block, color: pick, level: 3, bloomTime: -1000 });
      // (its garden grows already shed: 400 level-3 gardens in full were 2.06 M triangles in the frame before the wave on this laptop, over the
      // floor's 1.5 M. The dome or spire, bunting and turf stand; the petals still burst at the jump)
      this.g.sprouts.shedSet?.add(ref.index);
      this.g.grow(ref, pick, 3, -100);
      this.g.bump(ref.cx, ref.cz, 40);
    }
    if (this.stageN < list.length) return;
    this.staged = true;
    this.waveList = list;
    // (what the wake measures from: the squares a staged house stands on, the farthest of them, the heart's ground)
    for (const { ref, d } of list) {
      const ix = Math.floor(ref.cx / SQUARE), iz = Math.floor(ref.cz / SQUARE), k = squareKey(ix, iz);
      this.stagedFar = Math.max(this.stagedFar, d);
      if (this.stagedSq.has(k)) continue;
      this.stagedSq.add(k);
      this.stagedRects.push(ix * SQUARE, iz * SQUARE, (ix + 1) * SQUARE, (iz + 1) * SQUARE);
    }
    this.heartY = city.groundAt(hx, hz);
    this.beam?.ground(this.heartY);
    // (the sky piece from the next frame on, a part a frame: not on top of this one's 50 houses, nor the wave's)
    this.buildSky();
  }

  /** Starts the faction's sky piece over the heart, from the neighbourhood's squares, its streets and its houses (liftSky.ts): skyStep builds it. */
  private buildSky() {
    const city = this.g.city;
    // (the houses up and placed as they are now: roofNear's cells again)
    this.roofCells = null;
    const [hx, hz] = this.heart;
    const l = Math.hypot(this.g.sun[0], this.g.sun[1]) || 1;
    this.skyBuild = makeSkyPiece(this.block, {
      heart: [hx, hz],
      ground: city.groundAt(hx, hz),
      squares: this.squares,
      streets: this.streets,
      face: [this.g.sun[0] / l, this.g.sun[1] / l],
      groundAt: (x, z) => city.groundAt(x, z),
      clear: (x, z) => this.clearOf(x, z),
      roof: (x, z, r) => this.roofNear(x, z, r),
    });
  }
  /**
   * One part of the sky piece (a frame's share); once it's whole, it goes in the scene. The first is the wave's heights, placed in a frame of
   * their own with roofNear's cells (plan(), roofGrid(): the piece stands over them). stats.skyMs is the longest part's ms, the plan's included; stats.planMs the plan's.
   */
  private skyStep() {
    const t0 = performance.now();
    let piece: SkyPiece | null = null;
    if (!this.planDone && this.staged) {
      this.plan();
      this.roofGrid();
      this.stats.planMs = +(performance.now() - t0).toFixed(1);
    } else piece = this.skyBuild!.step();
    this.stats.skyMs = Math.max(this.stats.skyMs, +(performance.now() - t0).toFixed(1));
    this.stats.skySteps++;
    if (!piece) return;
    this.skyBuild = null;
    this.sky = piece;
    this.g.scene.add(piece.mesh);
    this.stats.skyTris = piece.tris;
    // (the wave can start the frame staging ends, before the piece is whole: it forms from the wave's start all the same, and the beam's foot
    // rises over it from then)
    if (this.waveAt >= 0) {
      piece.start(this.waveAt);
      this.beam?.foot(piece.top, this.waveAt);
    }
  }

  /**
   * QA: where to stand to look up at the sky piece, about `d` m from the heart (the stills' street view): a point on one of the neighbourhood's
   * streets, the nearest to `d` m out on the sun's side, with no fall or column within 60 m, no grounded building within 30 and no tree within 32.
   */
  skyEye(d: number): [number, number] {
    const [hx, hz] = this.heart, a0 = Math.atan2(this.g.sun[1], this.g.sun[0]);
    const feet = this.sky?.feet ?? [];
    const city = this.g.city;
    const cand: Array<[number, number, number]> = [];
    for (const { rank, xz } of this.streets)
      for (let k = 0; rank === 0 && k + 3 < xz.length; k += 2) {
        const len = Math.hypot(xz[k + 2] - xz[k], xz[k + 3] - xz[k + 1]);
        for (let t = 0; t <= len; t += 8) {
          const x = xz[k] + ((xz[k + 2] - xz[k]) * t) / Math.max(len, 1e-6), z = xz[k + 1] + ((xz[k + 3] - xz[k + 1]) * t) / Math.max(len, 1e-6);
          const da = Math.abs(((Math.atan2(z - hz, x - hx) - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          cand.push([x, z, Math.abs(Math.hypot(x - hx, z - hz) - d) + da * 120]);
        }
      }
    cand.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of cand) {
      if (!this.squares.has(squareKey(Math.floor(x / SQUARE), Math.floor(z / SQUARE)))) continue;
      if (!feet.every(([fx, fz]) => Math.hypot(fx - x, fz - z) > 60)) continue;
      let tree = false;
      for (let t = 0; t < this.trees.length && !tree; t += 2) tree = Math.hypot(this.trees[t] - x, this.trees[t + 1] - z) < 32;
      if (tree) continue;
      let open = true;
      for (let q = 0; q < 17 && open; q++) {
        const r = q ? (q < 9 ? 15 : 30) : 0, b = (q * Math.PI) / 4;
        const px = x + Math.cos(b) * r, pz = z + Math.sin(b) * r;
        if (this.solidAt(px, pz, city.groundAt(px, pz) + 3)) open = false;
      }
      if (open) return [x, z];
    }
    return [hx + Math.cos(a0) * d, hz + Math.sin(a0) * d];
  }
  /** the trees round the neighbourhood (x, z pairs, from its tiles): skyEye stands clear of them */
  private readonly trees: number[] = [];

  /** How far (x, z) is from the nearest liftable house's footprint bounds (m; 30 when none is that near). */
  private clearOf(x: number, z: number): number {
    let d = 30;
    const r = 30 + this.nearRad;
    for (let qz = Math.floor((z - r) / NEAR_CELL); qz <= Math.floor((z + r) / NEAR_CELL); qz++)
      for (let qx = Math.floor((x - r) / NEAR_CELL); qx <= Math.floor((x + r) / NEAR_CELL); qx++)
        for (const i of this.nearGrid.get(squareKey(qx, qz)) ?? NONE) {
          const o = this.refs.get(i);
          if (o) d = Math.min(d, nearRef(o, x, z));
        }
    return d;
  }

  /**
   * Hyperglow's turns (liftGlsl's LIFT_TURN): each house of the wave turns on the beat, where its turn can't cut a neighbour at its height (any
   * part of its height and reach) within its own reach of it: one floating, or one on the ground from its base to its roof, lifted by the Lift
   * or not. Drawn only: the flight sees it unturned.
   */
  private turns() {
    const city = this.g.city, near: Array<{ ref: BuildingRef; d: number }> = [];
    for (const { ref } of this.waveList) {
      const i = ref.index;
      if (this.state[i] === ST_GROUND) continue;
      const lo = ref.baseY + this.H[i] - this.margin[i], hi = ref.roofY + this.H[i] + this.margin[i];
      let ok = true;
      this.nearEach(ref, ref.rad, (o) => {
        const j = o.index;
        if (!ok) return;
        const down = this.state[j] === ST_GROUND;
        if ((down ? o.baseY : o.baseY + this.H[j] - this.margin[j]) < hi && (down ? o.roofY : o.roofY + this.H[j] + this.margin[j]) > lo) ok = false;
      });
      // (the buildings it doesn't lift, from the City's index: only for a house still turning, a few dozen once at the wave)
      if (ok)
        for (const { ref: o } of city.buildingsWithin(ref.cx, ref.cz, ref.rad + 40, near)) {
          if (o.index === ref.index || this.refs.has(o.index) || o.baseY >= hi || o.roofY <= lo) continue;
          if (Math.hypot(Math.max(o.x0 - ref.cx, 0, ref.cx - o.x1), Math.max(o.z0 - ref.cz, 0, ref.cz - o.z1)) < ref.rad) {
            ok = false;
            break;
          }
        }
      if (!ok) continue;
      this.turn[i] = liftTurnCode(i, ref.area > 700 || ref.roofY - ref.baseY > 24);
      this.writeTexel(i);
      this.stats.turning++;
    }
  }
  private waveList: Array<{ ref: BuildingRef; d: number }> = [];
  private stageList: Array<{ ref: BuildingRef; d: number }> | null = null;
  private stageN = 0;

  /**
   * Once a frame, after the camera and before the frame is drawn: the sky piece's cut round the bus from where the lens is now (frame() has
   * last frame's: a punch or a look behind can move it further in a frame than the cut's slack)
   */
  lens(cam: THREE.Vector3) {
    if (this.busAt) this.sky?.bus(this.busAt.x, this.busAt.y, this.busAt.z, cam);
  }

  /**
   * Once a frame, after the flight. `now` the game clock, dt its step, realDt the wall clock's; the bus and the camera, the opening's fog (0..1
   * gone). Schedules &lifted's wave, holds a house that would jump into the bus or the camera, takes houses up, uploads what changed.
   */
  frame(renderer: THREE.WebGLRenderer, now: number, dt: number, realDt: number, bus: { x: number; y: number; z: number; ground: number; fx: number; fz: number }, cam: THREE.Vector3, fogGone: number) {
    this.now = now;
    this.wall += realDt;
    let busy = false;
    // (the beam's foot on the heart's ground as the far field and the tiles bring it in, until staging has it)
    if (!this.staged) this.beam?.ground(this.g.city.groundAt(this.heart[0], this.heart[1]));
    if (liftedOn && !this.staged && this.tilesWanted.size === 0) this.stage();
    else if (this.skyBuild) {
      this.skyStep();
      busy = true;
    }
    // (the bus for the sky piece's cut, handed over in lens() once the lens is where the frame is drawn from: after skyStep, so a piece
    // finished this frame, after the wave began, is drawn this frame round the bus already)
    this.busAt = bus;
    if (!busy && liftedOn && this.staged && this.waveAt < 0 && fogGone >= 0.5 && this.wakes(bus)) this.wave(now);
    // the wave's slow motion, as its front comes within 150 m of the bus while it still crosses the block (else never: waveSlow)
    if (liftedOn && this.waveAt >= 0 && !this.waveSlowDone && now >= this.waveAt + LIFT.crouch) {
      const ws = waveSlow(Math.max(0, (now - this.waveAt) * LIFT.wave), this.stagedFar, Math.hypot(bus.x - this.heart[0], bus.z - this.heart[1]), bus.y - this.heartY);
      if (ws) this.waveSlowDone = true;
      if (ws > 0) this.slow(SLOW_WAVE);
    }
    this.hitJumps = 0;
    this.hoseJumps = 0;
    // (a blast's asks are all started in its own update: none carry past a frame)
    this.asked = 0;
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
    } else if (this.hoseJumps) this.g.sound.jump(this.hoseJumps, this.hitHue);
    this.stats.up = this.nUp;
    this.stats.cells = this.field.builtCount;
    // uploads: the house texels' changed rows once a frame (two texSubImage2D, a row band of each of its two halves), the lake's whole when it changed
    if (this.dirty1 >= 0) {
      const w = this.g.city.paint.width;
      const y0 = Math.floor(this.dirty0 / w), y1 = Math.floor(this.dirty1 / w), rows = this.g.city.paint.height;
      // (the rows of both texels: two calls; either refused, the whole texture goes up instead)
      if (
        !uploadRect(renderer, this.tex, 0, y0, w, y1 - y0 + 1, WebGL2RenderingContext.RGBA, WebGL2RenderingContext.FLOAT, 4) ||
        !uploadRect(renderer, this.tex, 0, rows + y0, w, y1 - y0 + 1, WebGL2RenderingContext.RGBA, WebGL2RenderingContext.FLOAT, 4)
      )
        this.tex.needsUpdate = true;
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
      this.caps.geometry = makeCapGeometry(this.refs.values(), (r) => this.centreOf(r));
      this.stats.capsTris = (this.caps.geometry.index?.count ?? 0) / 3;
      this.caps.visible = true;
    }
  }

  /**
   * Would this house, jumping now, rise into the bus or the camera? It rises straight up its own footprint, overshoot and bob included: only what
   * is over it, or over its roof and about to be (the bus's next 0.4 s), is in the way. Beside it and under its roof nothing is: it rises past.
   */
  private blocks(ref: BuildingRef, i: number, bus: { x: number; y: number; z: number }, cam: THREE.Vector3): boolean {
    const top = ref.roofY + this.H[i] * 1.14 + this.margin[i];
    if (bus.y < top + 8 && bus.y > ref.roofY - 6 && nearRef(ref, bus.x, bus.z) < Math.max(6, 0.4 * this.busSpeed)) return true;
    return cam.y < top + 3 && cam.y > ref.roofY - 2 && nearRef(ref, cam.x, cam.z) < 6;
  }
  /** the bus's ground speed (m/s), main's each frame */
  busSpeed = 0;

  private jump(i: number, ref: BuildingRef | undefined) {
    this.state[i] = ST_UP;
    this.nUp++;
    if (!ref) return;
    this.field.reach(ref.x0, ref.z0, ref.x1, ref.z1);
    const rec = this.g.city.paint.get(i), hue = Math.round(rec.color), owner = rec.faction;
    // its small growth goes up as petals: the triangle bound
    const n = this.g.sprouts.shed(i, petalAt);
    const by = this.fromHit[i];
    // (what it noted over its roof was the whole garden's: what's left, the dome or spire, bunting and turf, notes its own again)
    if (n) {
      this.extra[i] = 0;
      this.g.grow(ref, hue, 3, -100);
    }
    for (let k = 0; k < Math.max(1, n); k++) {
      const x = n ? petalAt[k * 2] : ref.cx, z = n ? petalAt[k * 2 + 1] : ref.cz;
      this.g.petals(x, ref.roofY + 0.5, z, hue, (by === BY_WAVE ? 8 : by === BY_HOSE ? 12 : 24) / Math.max(1, n), owner);
    }
    if (by === BY_HIT) {
      this.hitJumps++;
      this.hitHue = hue;
    } else if (by === BY_HOSE) {
      this.hoseJumps++;
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
      for (const [ox, oz] of OVER_RING) if (this.overhead(bus.x + ox, bus.z + oz, bus.y) < Infinity) over = true;
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
   * The lens kept out of the floating layer (CameraRig.liftClamp): in the low shot 9 m under any house overhead (3 where the ground leaves no
   * more), else out over its top.
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
    if (y < under - (low > 0.5 ? 9 : 3) || y > top + 3) return y;
    // (in the low shot well under them, 9 m: a belly 3 m over the lens filled the top third of the frame, the first outside look)
    const floor = this.g.city.groundAt(x, z) + 4;
    if (low > 0.5 && under - 3 > floor) return Math.max(floor, under - 9);
    return top + 3;
  }

  /** Where the bus starts: the hood's edge on the sun's side, facing in (`out`: that far from the heart instead). */
  startFor(sunX: number, sunZ: number, out?: number) {
    return hoodStart(this.squares, this.heartKey, sunX, sunZ, out);
  }
}
