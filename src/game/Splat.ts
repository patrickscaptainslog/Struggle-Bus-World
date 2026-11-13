import * as THREE from 'three';
import { config } from '../config';
import { HUE_COUNT } from '../render/palette';
import type { City, BuildingRef } from '../world/City';
import { FACTION_RAINBOW } from './factions';
import { blastUniforms, ringHue, type GroundJob } from '../world/GroundPaint';
import type { CometPlan } from './Comet';
import { arrival, blastCap, blastRadiusFor, groundDeadline, LAYOUT_BANDS, LAYOUT_RING, layoutHue, makeBlastSpec, waveMax, wrapHue, type BlastDot, type BlastSpec } from './blastLayout';
import { setPogo } from '../world/pogo';
import { lookOf } from '../render/factionLook';

// The barf -> blast -> bloom pipeline. Dragon breath: the bus blasts a
// rainbow projectile forward; it snaps to the building at the aim point and
// EXPLODES: every building within the blast radius blooms as the shockwave
// reaches it (~0.3 s for the whole blast), already-painted ones escalate a
// level (bloom -> rooftop garden -> Hundertwasser), and the ground around
// them is splattered too (GroundPaint). The ground takes a rainbow pinwheel
// around the impact (blastLayout); the fresh buildings are dealt the rainbow
// in order of angle around it, so every blast of six or more shows all six
// hues and a row of houses through the impact reads as a rainbow. Touching
// neighbors never share a hue, and a house avoids the hue of the paint under it.
//
// The whole wave is written to the paint texture at impact (one upload): each
// building's bloomTime is its arrival time, and the shader holds the pop and
// the color flood until then.

export interface Blast {
  spec: BlastSpec;
  /** impact point (on the primary's roof, or on the ground) */
  pos: THREE.Vector3;
  /** game clock at impact */
  t: number;
  /** buildings blooming in this blast, and the highest level reached */
  count: number;
  maxLevel: number;
  /** blast radius relative to the base radius (1 = a level barf) */
  strength: number;
  /** spatter dots on the ground; the blob ones each get a flung paint blob */
  dots: BlastDot[];
  /** a firehose impact (BarfOpts.hose): the caller plays its lighter fx */
  hose: boolean;
  /** ?life: a breath that hit a mover in the air (BarfOpts.mover): life paints that mover itself, and the blast's circle paints nothing else */
  mover: boolean;
  /** ?life: a breath at a boat in open water (BarfOpts.moverBlock), no building in reach: its circle paints the boats in it, and no ground and no sign */
  afloat: boolean;
  /** the building it hit, or null */
  primary: BuildingRef | null;
  /** which super splat made this blast, null for a tap (the stage engine's one-hit-per-area rule reads it) */
  super: SuperTag | null;
  /** ?moon: what it was aimed at (BarfOpts.tag) */
  tag?: unknown;
  /** a Comet's blast (BarfOpts.comet): its pillar and its late boom are the caller's (src/fx/CometFx.ts) */
  comet: CometPlan | null;
  /** the stages each building it reaches climbs (BarfOpts.jump): 1, a Bomb's 2 or 3. Its trees take as many */
  jump: number;
  /** Curb's drive-by (BarfOpts.side): the side of the lane it blooms, which its flung blobs keep to */
  side?: { x: number; z: number; nx: number; nz: number };
  /** ?lift: what its line of fire crossed (BarfOpts.via: 1 the sky piece, so the heart's square takes the hit) */
  via?: number;
}

export interface SplatFx {
  geyser(targets: THREE.Vector3[], hues: number[]): void;
  /** The projectile explodes: flash, ring, kick, boom, blobs, trees. */
  impact(b: Blast): void;
  /** One building pops (at its arrival time). flags: BLOOM_HOSE = a firehose impact's (lighter fx),
   * BLOOM_REPOP = it re-pops at the level it already had (no new rooftop garden to grow). */
  bloom(ref: BuildingRef, order: number, total: number, hue: number, level: number, roof: THREE.Vector3, flags: number): void;
  primary(ref: BuildingRef, hue: number): void;
  hitStop(frames: number): void;
  /** The breath came down on nothing paintable (open water): a splash, at the moment it lands (a Comet's: its plan). */
  miss?(pos: THREE.Vector3, hue: number, comet: CometPlan | null): void;
  /** A Comet planned late (BarfOpts.late) is planned now: where it comes down, on what's loaded now (its streak bends there). */
  late?(comet: CometPlan, pos: THREE.Vector3): void;
}

/** A blast of a super splat: its kind, the charge, and the super's serial (a firehose's impacts and closer share one). */
export interface SuperTag {
  kind: 'mega' | 'hose' | 'closer' | 'bomb' | 'boom' | 'falls';
  charge: number;
  id: number;
  /** &boom's ring (src/game/Boom.ts): its hole's radius (m), where nothing is painted (life leaves the movers in it alone: HOOKS.md) */
  inner?: number;
}

/** Optional aim for Splatter.barf. */
export interface BarfOpts {
  /** height of the bus above the impact (m): the blast grows with it */
  drop?: number;
  /** the projectile's flight time (s), default config.splat.impactDelay */
  travel?: number;
  /** the building to hit (the one that glinted), or null for none; undefined = pick at (x, z) */
  target?: BuildingRef | null;
  /** impact height (m; a breath that slams into a tower's wall), default: the roof at the landing point */
  y?: number;
  /** the bus's height (m ASL): a landmark seen from there (a breath from under a deck lands under it), default from above */
  from?: number;
  /** land exactly at (x, z) (a wall face), instead of on the target's footprint nearest to it */
  exact?: boolean;
  /** blast radius (m), default blastRadiusFor(drop): the super splat's mega blast and firehose */
  radius?: number;
  /** the caller draws the stream itself (the firehose): no geyser */
  stream?: boolean;
  /** a firehose impact: no hit-stop or street sign, lighter fx (Blast.hose), and a building that popped
   * less than config.splat.firehoseRepop s ago (or is still waiting for a pop) is left alone */
  hose?: boolean;
  /** one pour of the Hose (src/game/Hose.ts; its serial, > 0): a building it has raised already is left out of its later impacts, so a pour raises each
   *  building at most one level (SHOTS.md: "The Hose covers, the Bomb climbs") */
  pour?: number;
  /** hit-stop frames at the impact, default config.splat.hitStopFrames */
  hitStop?: number;
  /** a super splat's blast (Blast.super) */
  super?: SuperTag;
  /** its ground in rainbow bands around this world point, this wide, from this hue, instead of its own pinwheel (a
   * firehose: a dozen pinwheels a second is a patchwork, one set of rings under all its impacts is a picture) */
  bands?: GroundBands;
  /** ?moon: handed back on the Blast */
  tag?: unknown;
  /** a Comet's flight (src/game/Comet.ts), handed back on the Blast */
  comet?: CometPlan;
  /** the stages each building it reaches climbs, never past 3: 1 (every tap and pour), a Bomb's 2 or 3 (src/game/Bomb.ts). Over 1 it never asks the Lift: a
   *  Bomb lifts nothing, and a house up already is out of it, as a tap's is */
  jump?: number;
  /** > 0: plan the blast only this long (s) before its impact, with what's loaded then (a Comet whose landing's tile wasn't in at the tap). A miss then
   *  is told through onLateMiss */
  late?: number;
  /** ?lift: handed back on the Blast (Aim's Shot.via) */
  via?: number;
  /** ?moon: changes the blast before its ground is drawn. False: it draws no ground */
  shape?: (spec: BlastSpec) => boolean;
  /** ?recess: one hue for all of it, every building and the ground (a rival faction's plain paint, until its stages' looks land) */
  solo?: number;
  /** whose blast it is when it isn't this splatter's own `faction` (?recess: a captain's bus) */
  faction?: number;
  /** ?life: a mover it hits (src/life): the blast is in the air at (x, opts.y, z), and paints no building and no ground; `moverFresh`, it took the breath's hue */
  mover?: { x: number; y: number; z: number };
  moverFresh?: boolean;
  /** ?life: a breath at a mover on a floor, a car, a ferry, a person (Splatter.moverOnFloor): the blast is centred on it at (x, opts.y, z) and paints the
   *  block round it, as a tap's does (SHOTS.md: "A shot that hits a car or a ferry paints the block around it too"); never a miss, as the mover is there,
   *  and life paints it with the rest of the circle's (main.ts, life.blast). Called with target null and exact */
  moverBlock?: boolean;
  /** Curb's drive-by: only buildings on this side of the lane bloom (their middles past the line through (x, z), along its normal (nx, nz)) */
  side?: { x: number; z: number; nx: number; nz: number };
  /** &boom's ring (src/game/Boom.ts): a band from this radius (m) out to the blast's. Only buildings reaching into it bloom, its ground is the band alone
   *  (LAYOUT_RING), and its cap goes with the band's area */
  inner?: number;
}

/** BarfOpts.bands */
export interface GroundBands {
  x: number;
  z: number;
  width: number;
  hue: number;
}

/** SplatFx.bloom flags. BLOOM_BOMB: one of a Bomb's stages (its sparkles are shared by every stage of every building in it). */
export const BLOOM_HOSE = 1;
export const BLOOM_REPOP = 2;
export const BLOOM_BOMB = 4;

interface Scheduled {
  at: number;
  ref: BuildingRef;
  order: number;
  total: number;
  hue: number;
  level: number;
  keep: boolean;
  /** dealing: angle around the impact (swirled), preferred hue (-1 = not dealt yet) */
  ang: number;
  pref: number;
  /** where the breath hit (the primary only) */
  at0?: THREE.Vector3;
  /** SplatFx.bloom flags */
  flags: number;
  /** ?lift: 1 it lifts at its bloom, 2 it's in the sky already (its paint isn't written either way) */
  lift?: 1 | 2;
  /** a Bomb's: the levels of its later stages (its first is `level`), each a pop config.bomb.stageGap s after the last */
  more?: number;
}

interface PendingBlast {
  at: number;
  blast: Blast;
  plan: Scheduled[];
  /** its ground paint, drawn while the projectile flies */
  ground: GroundJob | null;
  hitStop: number;
}

const HUE_TRY = [0, 1, -1, 2, -2, 3];

/** deal's neighbours from a grid of the plan past this many buildings (a Bomb's), in cells this wide (m) */
const DEAL_GRID = 256;
const DEAL_CELL = 24;

/** A plan's buildings in every cell their touching reach (half their footprint's side and 1.25 m) covers: two that touch share a cell. */
interface DealGrid {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  cells: Array<Scheduled[] | undefined>;
}

function dealGrid(plan: Scheduled[]): DealGrid {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of plan) {
    const r = Math.sqrt(p.ref.area) * 0.5 + 1.25;
    x0 = Math.min(x0, p.ref.cx - r);
    z0 = Math.min(z0, p.ref.cz - r);
    x1 = Math.max(x1, p.ref.cx + r);
    z1 = Math.max(z1, p.ref.cz + r);
  }
  const nx = Math.floor((x1 - x0) / DEAL_CELL) + 1, nz = Math.floor((z1 - z0) / DEAL_CELL) + 1;
  const g: DealGrid = { x0, z0, nx, nz, cells: new Array(nx * nz) };
  for (const p of plan) {
    const r = Math.sqrt(p.ref.area) * 0.5 + 1.25;
    const i0 = Math.floor((p.ref.cx - r - x0) / DEAL_CELL), i1 = Math.min(nx - 1, Math.floor((p.ref.cx + r - x0) / DEAL_CELL));
    const j0 = Math.floor((p.ref.cz - r - z0) / DEAL_CELL), j1 = Math.min(nz - 1, Math.floor((p.ref.cz + r - z0) / DEAL_CELL));
    for (let j = Math.max(0, j0); j <= j1; j++)
      for (let i = Math.max(0, i0); i <= i1; i++) {
        const a = g.cells[j * nx + i];
        if (a) a.push(p);
        else g.cells[j * nx + i] = [p];
      }
  }
  return g;
}

/** The plan's buildings touching ref, from the grid (as the plan's scan reaches them), into `out`: freeHue tries their hues as they are then. */
function gridNear(g: DealGrid, ref: BuildingRef, ra: number, out: Scheduled[]): Scheduled[] {
  out.length = 0;
  const r = ra + 1.25;
  const i0 = Math.max(0, Math.floor((ref.cx - r - g.x0) / DEAL_CELL)), i1 = Math.min(g.nx - 1, Math.floor((ref.cx + r - g.x0) / DEAL_CELL));
  const j0 = Math.max(0, Math.floor((ref.cz - r - g.z0) / DEAL_CELL)), j1 = Math.min(g.nz - 1, Math.floor((ref.cz + r - g.z0) / DEAL_CELL));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const a = g.cells[j * g.nx + i];
      if (!a) continue;
      for (const p of a) {
        // (squared: Math.hypot was most of it)
        const dx = p.ref.cx - ref.cx, dz = p.ref.cz - ref.cz, reach = ra + Math.sqrt(p.ref.area) * 0.5 + 2.5;
        if (p.ref !== ref && dx * dx + dz * dz < reach * reach) out.push(p);
      }
    }
  return out;
}

export class Splatter {
  /**
   * The hitter's faction (game/factions.ts): every blast this splatter fires carries it (BlastSpec.faction), and every building and ground texel it
   * paints is saved as that faction's, an escalation's included. Rainbow, until a player can join another (FACTIONS.md, decision 15).
   */
  faction = FACTION_RAINBOW;
  private nextHue = Math.floor(Math.random() * HUE_COUNT);
  /** The hue the next fresh hit takes (?life: a mover hit takes it, main.ts). */
  get hueNext(): number {
    return this.nextHue;
  }
  /** ?life, Curb: a car took hueNext fresh with no breath of this splatter's (painted riding beside it, or the drive-by's): the next one moves on. */
  dealHue(): void {
    this.nextHue = (this.nextHue + 1) % HUE_COUNT;
  }
  private queue: Scheduled[] = [];
  private pending: PendingBlast[] = [];
  /** a Bomb's later stages, waiting for their band (config.bomb.stageBand) to be written; and when the next band is */
  private staged: Array<Scheduled & { faction: number }> = [];
  private nextBand = 0;
  /** barfs held to be planned later (BarfOpts.late) */
  private held: Array<{ at: number; x: number; z: number; opts: BarfOpts }> = [];
  /** A held barf (BarfOpts.late) came down on nothing paintable when it was planned: the caller refunds part of the belly, as for lastMiss. */
  onLateMiss: (() => void) | null = null;

  /** ?moon: the map slid by (dx, dz) (main.ts): a breath on its way lands where it was going, by the new map, on the crater it was for. `moved`: what's been moved already, each once. */
  slide(dx: number, dz: number, moved: Set<object>) {
    for (const h of this.held) {
      h.x -= dx;
      h.z -= dz;
    }
    for (const p of this.pending) {
      const b = p.blast;
      b.pos.x -= dx;
      b.pos.z -= dz;
      if (!moved.has(b.spec)) {
        b.spec.x -= dx;
        b.spec.z -= dz;
        moved.add(b.spec);
      }
      const t = b.tag as { x?: unknown; z?: unknown } | null | undefined;
      if (t && typeof t.x === 'number' && typeof t.z === 'number' && !moved.has(t)) {
        t.x -= dx;
        t.z -= dz;
        moved.add(t);
      }
      for (const d of b.dots) {
        d.x -= dx;
        d.z -= dz;
      }
      for (const s of p.plan) s.at0?.set(s.at0.x - dx, s.at0.y, s.at0.z - dz);
    }
    for (const s of this.queue) s.at0?.set(s.at0.x - dx, s.at0.y, s.at0.z - dz);
  }
  private near: Array<{ ref: BuildingRef; d: number }> = [];
  private reachList: Array<{ ref: BuildingRef; d: number; e: number }> = [];
  private fresh: Scheduled[] = [];
  /** freeHue's neighbours of one building from deal's grid */
  private readonly dealNear: Scheduled[] = [];
  private misses: Array<{ at: number; pos: THREE.Vector3; hue: number; comet: CometPlan | null }> = [];
  /** where the last barf comes down (its blast's or its miss's), for a late plan's SplatFx.late */
  private lastPos: THREE.Vector3 | null = null;
  private land = { x: 0, z: 0 };
  /** where a bloom's sparkles start (SplatFx.bloom reads it, never keeps it) */
  private readonly roofTmp = new THREE.Vector3();
  private t = 0;
  private seed = (Math.random() * 0xffffffff) >>> 0;
  /** The last barf came down on nothing paintable (the caller refunds part of the belly). */
  lastMiss = false;
  /** The last barf's blast's spec, when it planned one (&boom's crown reads its hues by angle) */
  lastSpec: BlastSpec | null = null;
  /** per building (dense index): game time until which firehose impacts leave it alone */
  private hoseUntil: Float32Array | null = null;
  /** per building (dense index): the last pour (BarfOpts.pour) that raised it */
  private pourOf: Int32Array | null = null;

  constructor(private city: City, private fx: SplatFx) {}

  /** How far from the aim point the breath snaps onto a building (m): config.splat.snapRadius, more from
   * high up (`drop` m above the impact), where a pixel is meters wide (aim stays forgiving). */
  pickRadius(drop = 0): number {
    const S = config.splat;
    return drop > 40 ? Math.max(S.snapRadius, Math.min(S.snapReachMax, S.snapRadius * (1 + drop / 150))) : S.snapRadius;
  }

  /**
   * The building a projectile aimed at (x, z) would hit: the one under the aim point (the tallest of
   * overlapping footprints), else the nearest by true footprint distance within `radius` (so a tower or a
   * warehouse is hit wherever you aim into it, and a shot into the street snaps to the nearest wall). Seen
   * from fromY, the bus's height: a deck over it is no target.
   */
  pick(x: number, z: number, radius = config.splat.snapRadius, fromY = Infinity): BuildingRef | null {
    // (?lift: a house on a square that won't take a counted hit now counts farther, so the glint pulls to one that will. Without the flag the City has no Lift)
    return this.city.nearestBuilding(x, z, radius, config.splat.minTargetHeight, fromY, true);
  }

  /** Blast radius for a barf from `drop` meters above the impact (m). */
  radius(drop = 0): number {
    return blastRadiusFor(drop);
  }

  /**
   * Launch a projectile at (x, z): it explodes opts.travel (default config.splat.impactDelay) s
   * later. `drop` = meters the bus is above the impact; the blast grows with
   * it (about x2 at 300 m). Returns the game-clock time of the impact.
   */
  barf(x: number, z: number, opts?: BarfOpts): number {
    const S = config.splat;
    if (opts?.late && opts.late > 0 && (opts.travel ?? S.impactDelay) > opts.late + 0.02) {
      // (planned later, when what it lands on has loaded: the building is picked then, and its height with it, but a wall's face stays the wall's. The
      // height the tap had is the far grid's, which put a late Comet's splash and pillar inside the building it found: the review of step 3, 4)
      const travel = opts.travel ?? S.impactDelay;
      this.held.push({ at: this.t + travel - opts.late, x, z, opts: { ...opts, travel: opts.late, late: 0, target: opts.exact ? opts.target : undefined, y: opts.exact ? opts.y : undefined } });
      this.lastMiss = false;
      return this.t + travel;
    }
    const city = this.city;
    const paint = city.paint;
    const drop = opts?.drop ?? 0;
    const from = opts?.from ?? Infinity;
    const primary = opts?.target !== undefined ? opts.target : this.pick(x, z, this.pickRadius(drop), from);
    const tImpact = this.t + (opts?.travel ?? S.impactDelay);
    const r = opts?.radius ?? blastRadiusFor(drop);
    const hose = !!opts?.hose;
    const stream = hose || !!opts?.stream;
    if (opts?.mover) return this.barfMover(opts.mover, tImpact, r, hose, !!opts.moverFresh, opts);
    // where it lands: the aim point if it is on the building, else the building's nearest edge, a few
    // meters in (a big block is hit where you aimed, not at a centroid 100 m away)
    const land = primary && !opts?.exact ? city.landingOn(primary, x, z, S.landInset, this.land, S.smallRad) : null;
    const cx = land ? land.x : x;
    const cz = land ? land.z : z;
    const pos = new THREE.Vector3(cx, opts?.y ?? (land && primary ? city.roofAtPart(primary, cx, cz, from) + 0.5 : city.groundAt(x, z)), cz);
    // the blast's center hue: an escalating primary keeps its color, a fresh one takes the next hue
    const pRec = primary ? paint.get(primary.index) : null;
    const bands = opts?.bands;
    const solo = opts?.solo;
    const hue = solo !== undefined ? solo : bands ? bands.hue : pRec && pRec.level > 0.5 ? wrapHue(pRec.color) : this.nextHue;

    // every building the blast reaches (its footprint, not its centroid: a big block half inside the radius
    // blooms too), nearest edge first, capped: a house by its centroid less its half-size (as the approved
    // blast), a big footprint by its true edge distance (its centroid may lie 100 m away). Every blast is
    // capped by its area, not its radius: over dense housing it must not leave grey blocks in a rainbow street
    // grid (a tap's 85 m paints every building in it, SHOTS.md; a super's up to megaBuildingsCap, a tap's or a hose's up to maxBuildingsCap)
    const jump = Math.max(1, Math.min(3, Math.round(opts?.jump ?? 1)));
    const inner = opts?.inner ?? 0;
    // (&boom's ring: its band's area, not its disc's)
    const cap = inner > 0 ? blastCap(Math.sqrt(Math.max(0, r * r - inner * inner)), config.bomb.cap) : blastCap(r, jump > 1 ? config.bomb.cap : opts?.super && !hose ? S.megaBuildingsCap : S.maxBuildingsCap);
    const near = city.buildingsWithin(cx, cz, r + S.smallRad, this.near);
    const reach = this.reachList;
    reach.length = 0;
    const side = opts?.side;
    for (const n of near) {
      // (a landmark standing wholly over the bus where the breath comes down, a deck seen from under, is out of its reach, as `from` keeps the landing off it: a
      // breath from under the Golden Gate into the water no longer takes the bridge up a level. Seen from its height or above, it's in reach as it always was)
      if (n.ref !== primary && city.lmOverhead(n.ref, cx, cz, from)) continue;
      // (Curb's drive-by: the fronts on the side it looks, not the street's other side)
      if (side && n.ref !== primary && (n.ref.cx - side.x) * side.nx + (n.ref.cz - side.z) * side.nz < 0) continue;
      const e = n.ref.rad <= S.smallRad ? Math.hypot(n.ref.cx - cx, n.ref.cz - cz) - 0.55 * Math.sqrt(n.ref.area) : n.d;
      // (&boom's ring: a building wholly in its hole is out of it)
      if (inner > 0 && Math.hypot(n.ref.cx - cx, n.ref.cz - cz) + (n.ref.rad <= S.smallRad ? 0.55 * Math.sqrt(n.ref.area) : n.ref.rad) < inner) continue;
      if (e <= r) reach.push({ ref: n.ref, d: n.d, e: n.ref === primary ? -1e9 : e });
    }
    if (primary && !near.some((n) => n.ref === primary)) reach.push({ ref: primary, d: 0, e: -1e9 });
    reach.sort((a, b) => a.e - b.e);
    // nothing to paint (open water, no building in reach): a miss. It doesn't fake a hit: no flash, boom
    // or hit-stop, just a splash when it comes down (the caller refunds part of the belly)
    const open = reach.length === 0 && city.groundAt(x, z) < S.missWaterY;
    this.lastMiss = open && !opts?.moverBlock;
    this.lastPos = pos;
    this.lastSpec = null;
    if (this.lastMiss) {
      this.misses.push({ at: tImpact, pos, hue: solo ?? this.nextHue, comet: opts?.comet ?? null });
      if (!stream) this.fx.geyser([pos.clone()], [solo ?? this.nextHue]);
      return tImpact;
    }
    if (solo === undefined && !bands && (!pRec || pRec.level < 0.5)) this.nextHue = (this.nextHue + 1) % HUE_COUNT;
    this.seed = (Math.imul(this.seed ^ 0x2545f491, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
    const spec = makeBlastSpec(cx, cz, r, hue, this.seed);
    spec.faction = opts?.faction ?? this.faction;
    if (solo !== undefined) {
      spec.layout = 0;
      spec.sectors = 1;
    } else if (bands) {
      spec.layout = LAYOUT_BANDS;
      spec.ring = bands.width;
      spec.ox = bands.x;
      spec.oz = bands.z;
    }
    if (inner > 0) {
      // (its ground out to its radius, a little ragged, with a few short splashes over the rim: a tap's 0.8 of its circle, lobed by a quarter, would leave
      // a 30 m band broken)
      spec.layout = LAYOUT_RING;
      spec.ring = inner;
      spec.edge = 1;
      spec.ragged = 0.08;
      spec.rays = 8;
      spec.rayLen = 0.25;
    }
    this.lastSpec = spec;
    // (a boat in open water: the boats in its circle take it, and the water none)
    const afloat = open && !!opts?.moverBlock;
    const groundless = opts?.shape?.(spec) === false || afloat;
    const plan: Scheduled[] = [];
    let maxLevel = 1;
    const busy = hose ? this.hoseBusy(paint.data.length >> 2) : null;
    const pour = opts?.pour ?? 0;
    const poured = pour > 0 ? this.pourBusy(paint.data.length >> 2) : null;
    for (const n of reach) {
      if (plan.length >= cap) break;
      const ref = n.ref;
      // (the stream hits the same block a dozen times a second: each building pops, and escalates, at most
      // every firehoseRepop s, and never while an earlier impact's pop is still on its way to it)
      if (busy && busy[ref.index] > this.t) continue;
      if (poured && poured[ref.index] === pour) continue;
      const lv = paint.level(ref.index);
      // (?lift: a floating house is in the sky, and takes no part of a blast unless it was the aim; a Rainbow house at level 3 hit by Rainbow lifts. A Bomb asks
      // only whether it's up: it lifts none, and one up is out of it, the aim too)
      if (jump > 1 && city.lift?.aloft(ref)) continue;
      // (and a house the Lift keeps on the ground, a square of the take's or one staged, is the Lift's to paint: asked of every blast, or a Bomb's blooms grew
      // gardens on a rival's square. A Bomb asks with no faction, so it lifts none)
      const lift = city.lift ? city.lift.wants(ref, lv, jump === 1 ? this.faction : -1) : 0;
      if (lift === 2 && ref !== primary) continue;
      const was = lv > 0.5;
      // (a Bomb's jump is a stage at a time, each its own pop: the first with the wave, as a tap's level, the rest after it)
      const base = was ? Math.round(lv) : 0;
      const level = Math.min(3, base + 1), last = Math.min(3, base + jump);
      // escalating buildings keep their hue, the primary takes the blast's; the rest are dealt below
      const h = solo !== undefined ? solo : was ? wrapHue(paint.get(ref.index).color) : ref === primary ? hue : -1;
      maxLevel = Math.max(maxLevel, last);
      // it pops when the shockwave reaches its near edge
      const flags = (hose ? BLOOM_HOSE : 0) | (jump > 1 ? BLOOM_BOMB : 0) | (lift || (was && level <= Math.round(lv)) ? BLOOM_REPOP : 0);
      plan.push({ at: tImpact + arrival(ref === primary ? 0 : Math.max(0, n.e), r), ref, order: plan.length, total: 0, hue: h, level, keep: was, ang: 0, pref: 0, at0: ref === primary ? pos : undefined, flags, lift: lift || undefined, more: last > level ? last - level : undefined });
    }
    this.deal(plan, spec);
    for (const p of plan) {
      p.total = plan.length;
      if (busy) busy[p.ref.index] = p.at + S.firehoseRepop;
      if (poured) poured[p.ref.index] = pour;
    }
    // (a Bomb's ground is drawn by when its wave reaches its rim, not by its impact: groundDeadline; a tap's as before)
    const ground = groundless ? null : city.ground.begin(spec, tImpact, jump > 1 ? groundDeadline(r) : 0);
    this.pending.push({
      at: tImpact, plan, ground, hitStop: hose ? 0 : opts?.hitStop ?? S.hitStopFrames,
      blast: { spec, pos, t: tImpact, count: plan.length, maxLevel, strength: r / S.blastRadius, dots: [], hose, mover: false, afloat, primary, super: opts?.super ?? null, tag: opts?.tag, comet: opts?.comet ?? null, jump, ...(side ? { side: { ...side } } : {}), ...(opts?.via ? { via: opts.via } : {}) },
    });
    if (!stream) this.fx.geyser([pos.clone()], [hue]);
    return tImpact;
  }

  /** ?life: a mover on a floor (the ground, the water, a bridge's deck, a roof), within moverFloor of it: a car, a ferry, a person, not a plane overhead. A breath at
   *  one is a blast of the block round it (BarfOpts.moverBlock); one at a mover in the air is its own hit alone (barfMover). */
  moverOnFloor(m: { x: number; y: number; z: number }): boolean {
    return m.y - this.city.surfaceAt(m.x, m.z, m.y + 2) < config.splat.moverFloor;
  }

  /**
   * ?life: a breath that hits a mover in the air (CONTRACT.md section 3, O5): a hit's flash and hit-stop at its impact, in the air where the mover will be, and no building or
   * ground under it painted. Life paints the mover; a fresh one took this breath's hue, so the next breath's moves on, as after a fresh building.
   */
  private barfMover(m: { x: number; y: number; z: number }, tImpact: number, r: number, hose: boolean, fresh: boolean, opts: BarfOpts): number {
    const S = config.splat, hue = this.nextHue, pos = new THREE.Vector3(m.x, m.y, m.z);
    if (fresh) this.nextHue = (this.nextHue + 1) % HUE_COUNT;
    this.seed = (Math.imul(this.seed ^ 0x2545f491, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
    const spec = makeBlastSpec(m.x, m.z, r, hue, this.seed);
    spec.faction = opts.faction ?? this.faction;
    this.pending.push({
      at: tImpact, plan: [], ground: null, hitStop: hose ? 0 : opts.hitStop ?? S.hitStopFrames,
      blast: { spec, pos, t: tImpact, count: 1, maxLevel: 1, strength: r / S.blastRadius, dots: [], hose, mover: true, afloat: false, primary: null, super: opts.super ?? null, tag: opts.tag, comet: opts.comet ?? null, jump: 1 },
    });
    this.lastMiss = false;
    return tImpact;
  }

  /**
   * Hues for the fresh buildings. Dealt (hueDeal 1): sorted by swirled angle
   * around the impact, they take the rainbow in turn after the center hue, so
   * a blast shows every hue in equal shares; 2 = equal contiguous wedges;
   * 0 = the layout hue at the building (shifted). Then, nearest first, each
   * takes the nearest hue no touching neighbor has and the ground under it hasn't.
   */
  private deal(plan: Scheduled[], spec: BlastSpec) {
    const S = config.splat;
    const mode = Math.round(S.hueDeal);
    const shift = Math.round(S.roofHueShift);
    const fresh = this.fresh;
    fresh.length = 0;
    for (const p of plan) {
      if (p.hue >= 0) continue;
      const dx = p.ref.cx - spec.x, dz = p.ref.cz - spec.z;
      const a = Math.atan2(dz, dx) + spec.twist * Math.hypot(dx, dz);
      p.ang = a - Math.floor(a / (Math.PI * 2)) * Math.PI * 2;
      p.pref = wrapHue(layoutHue(spec, dx, dz) + shift);
      fresh.push(p);
    }
    if (mode > 0) {
      fresh.sort((a, b) => a.ang - b.ang);
      const n = fresh.length;
      for (let k = 0; k < n; k++) fresh[k].pref = wrapHue(spec.hue + shift + (mode === 1 ? k : Math.floor((k * HUE_COUNT) / n)));
    }
    // (a Bomb's plan, up to config.bomb.cap: each building's neighbours from a grid of it, where each against the whole plan was 21-27 ms of the lift's frame
    // over fresh housing from 300 m: the Bomb's world review. The same neighbours; a tap's plan stays the scan it was)
    const grid = plan.length > DEAL_GRID ? dealGrid(plan) : null;
    // (&boom's ring in a faction with its strongest rows named: its walls are dealt from those slots alone, touching neighbours kept apart in them and off
    // the ground's (its strongest too), where a remap after the deal put two neighbours on one slot)
    const look = spec.layout === LAYOUT_RING ? lookOf(spec.faction ?? FACTION_RAINBOW).ring : undefined;
    for (const p of plan)
      if (p.hue < 0) {
        const g = layoutHue(spec, p.ref.cx - spec.x, p.ref.cz - spec.z);
        p.hue = this.freeHue(p.pref, p.ref, plan, look ? look.ground[g % look.ground.length] : g, grid, look?.walls);
      }
  }

  /** The preferred hue unless a touching neighbor already has it (or it's the ground's): then the nearest free hue. `slots`: only those, from pref's on. */
  private freeHue(pref: number, ref: BuildingRef, plan: Scheduled[], ground: number, grid: DealGrid | null = null, slots?: readonly number[]): number {
    const ra = Math.sqrt(ref.area) * 0.5;
    const near = grid ? gridNear(grid, ref, ra, this.dealNear) : null;
    const n = slots ? slots.length : HUE_TRY.length;
    for (let o = 0; o < n; o++) {
      const h = slots ? slots[(pref + o) % n] : wrapHue(pref + HUE_TRY[o]);
      if (h === ground) continue;
      let clash = false;
      if (near) clash = near.some((p) => p.hue === h);
      else
        for (const p of plan) {
          if (p.hue !== h) continue;
          const reach = ra + Math.sqrt(p.ref.area) * 0.5 + 2.5;
          if (Math.hypot(p.ref.cx - ref.cx, p.ref.cz - ref.cz) < reach) {
            clash = true;
            break;
          }
        }
      if (!clash) return h;
    }
    return slots ? slots[pref % n] : pref;
  }

  update(dt: number) {
    this.t += dt;
    const S = config.splat;
    for (let i = 0; i < this.held.length; ) {
      const h = this.held[i];
      if (this.t < h.at) {
        i++;
        continue;
      }
      this.held.splice(i, 1);
      this.lastPos = null;
      this.barf(h.x, h.z, h.opts);
      if (h.opts.comet && this.lastPos) this.fx.late?.(h.opts.comet, this.lastPos);
      if (this.lastMiss) this.onLateMiss?.();
    }
    for (let i = 0; i < this.misses.length; ) {
      const m = this.misses[i];
      if (this.t < m.at) {
        i++;
        continue;
      }
      this.misses.splice(i, 1);
      this.fx.miss?.(m.pos, m.hue, m.comet);
    }
    for (let i = 0; i < this.pending.length; ) {
      const p = this.pending[i];
      if (this.t < p.at) {
        i++;
        continue;
      }
      this.pending.splice(i, 1);
      const b = p.blast;
      // the whole wave goes to the GPU now (one upload): the shader times each pop. Its buildings are the hitter's, as it was when it fired
      const faction = b.spec.faction ?? FACTION_RAINBOW;
      // (a Bomb's pogo: until the last pop of any of its buildings, the first stages' too, over a circle round every one of them and the gardens on them. Set
      // only when some building had a later stage, a block at level 2 hopped not at all, and the houses at the rim of one half at 2 missed theirs: the Bomb's
      // world review)
      let pogoUntil = 0, pogoR = 0;
      for (const s of p.plan) {
        // (?lift: a lifting house's record isn't rewritten: no second pop on its crouch, and its saved paint is untouched)
        if (s.lift) {
          if (s.lift === 1) this.city.lift!.start(s.ref, s.at, b.hose);
          continue;
        }
        this.city.paint.set(s.ref.index, { faction, color: s.hue, level: s.level, bloomTime: s.at, keep: s.keep });
        if (b.jump > 1) {
          pogoUntil = Math.max(pogoUntil, s.at + config.bomb.stageGap * (s.more ?? 0));
          pogoR = Math.max(pogoR, Math.hypot(s.ref.cx - b.spec.x, s.ref.cz - b.spec.z) + s.ref.rad);
        }
        // (a Bomb's later stages, each its own write and pop, config.bomb.stageGap s apart: written in their bands, update())
        for (let k = 1; k <= (s.more ?? 0); k++) {
          const at = s.at + config.bomb.stageGap * k;
          this.staged.push({ ...s, at, level: s.level + k, keep: true, flags: s.flags & ~BLOOM_REPOP, at0: undefined, more: undefined, faction });
        }
      }
      // (the pogo: the buildings in its circle hop as each stage pops them, world/pogo.ts)
      if (pogoUntil > 0) setPogo(b.spec.x, b.spec.z, pogoR + 2, b.t, pogoUntil);
      b.dots = p.ground ? this.city.ground.land(p.ground) : [];
      blastUniforms.uBlastRing.value.set(b.spec.x, b.spec.z, b.t, b.spec.r);
      blastUniforms.uBlastRing2.value.set(ringHue(b.spec.hue, faction), S.ringWidth * Math.sqrt(b.strength), S.waveSpeed, waveMax(b.spec.r));
      this.fx.impact(b);
      // (?lift: the Lift hears every blast land; without the flag the City has none)
      this.city.lift?.landed(b);
      if (p.hitStop > 0) this.fx.hitStop(p.hitStop);
      for (const s of p.plan) this.queue.push(s);
    }
    // a Bomb's later stages: written a band ahead of their pops (one paint upload a band), each then blooming as its own
    if (this.staged.length && this.t >= this.nextBand) {
      const until = this.t + config.bomb.stageBand;
      // (what's left kept in its order, not spliced out one at a time: a Bomb's thousands of stages)
      let k = 0;
      for (const s of this.staged) {
        if (s.at >= until) {
          this.staged[k++] = s;
          continue;
        }
        this.city.paint.set(s.ref.index, { faction: s.faction, color: s.hue, level: s.level, bloomTime: s.at, keep: true });
        this.queue.push(s);
      }
      this.staged.length = k;
      this.nextBand = until;
    }
    // (blooming in the queue's order, what's left kept in it: the same as splicing each out, without the Bomb's thousands of moves a frame)
    let k = 0;
    for (const s of this.queue) {
      if (this.t < s.at) {
        this.queue[k++] = s;
        continue;
      }
      // (the primary's sparkles start where the breath hit it)
      this.fx.bloom(s.ref, s.order, s.total, s.hue, s.level, s.at0 ? this.roofTmp.copy(s.at0) : this.roofTmp.set(s.ref.cx, s.ref.roofY + (this.city.lift ? this.city.lift.dy(s.ref.index) : 0), s.ref.cz), s.flags);
      if (s.order === 0 && !(s.flags & BLOOM_HOSE)) this.fx.primary(s.ref, s.hue);
    }
    this.queue.length = k;
  }

  private hoseBusy(n: number): Float32Array {
    if (!this.hoseUntil || this.hoseUntil.length < n) this.hoseUntil = new Float32Array(n);
    return this.hoseUntil;
  }

  private pourBusy(n: number): Int32Array {
    if (!this.pourOf || this.pourOf.length < n) this.pourOf = new Int32Array(n);
    return this.pourOf;
  }

  /** Blasts still in flight (their paint isn't applied yet). */
  get inFlight(): number {
    return this.pending.length + this.held.length;
  }

  /** A Bomb's stages still to be written (QA: tools/feel-sim/s_bomb.ts). */
  get stagesLeft(): number {
    return this.staged.length;
  }

  /** Game clock (s), the same clock as globals.uTime. */
  get clock(): number {
    return this.t;
  }
}
