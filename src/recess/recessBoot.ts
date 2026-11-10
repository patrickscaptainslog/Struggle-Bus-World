// ?recess on screen (FACTIONS.md section 4, the bots demo; docs/specs/factions/BUILT.md): the player's real bus against two AI captains in a 1.5 km circle of
// the street, three minutes between two bells, and at the bell the camera rises to 1,500 m and the painted map is the scoreboard. The rules are the headless
// brain's (recess.ts, captain.ts), stepped at its own fixed step; the player's bus is its bus 0, placed from the real flight each step. What this adds is the
// picture: the captains as buses in their colours, their breaths, their paint on the real city (plain paint in one hue a faction, until the stages' looks land),
// Possessed on the real flight (Nonstop, NO BRAKES, the hiccups on the beat), the duel's lock, line, ring and chevron (Duel.ts has its rules), the clock and the score.
// Territory is the brain's three camps of about 36 squares (neighbourhoods.ts) until the first account's neighbourhood files land.
//
// Under the flag only, a chunk of its own; its meshes are the bus's and a toon blob, so it compiles nothing the street doesn't (the warm-up sees them first).
// Not here yet: the faction's ornate buses, the stages' looks, a Heart's look, a second phone, the real MEGA meter for Piñata's drops (the brain counts them).

import * as THREE from 'three';
import { BusModel, type BusPose } from '../bus/BusModel';
import { areaTune, Faction, squareCentre, squareKey } from '../factions/areas';
import type { Flight } from '../game/Flight';
import type { Holds } from '../game/Hold';
import { latLonToLocal } from '../game/geo';
import type { MoverAim, MoverTarget } from '../game/Aim';
import type { BarfOpts } from '../game/Splat';
import { GEAR_NAMES, JET, NONSTOP } from '../game/Turbo';
import { makeRampMaterial } from '../render/materials';
import { Ramp } from '../render/palette';
import { C, HUD_FONT, PixelCanvas, rgba, textWidth } from '../ui/pixelUi';
import { Captain } from './captain';
import { Duel, duelTune } from './Duel';
import { Recess, recessTune, type Level, type Mode } from './recess';
import { Tag } from './tag';

/** The factions on the field (decision 21): the player's Rainbow and the two captains, Atlantis and Inferno. Since factions' step 5 every paint draws in its
 *  owner's look (render/factionLook.ts), so a captain's blast only carries its faction; its bus wears its body colour, Atlantis's teal and Inferno's crimson. */
const SIDES: Record<number, { name: string; ramp: number }> = {
  [Faction.RAINBOW]: { name: 'RAINBOW', ramp: Ramp.BUS_YELLOW },
  [Faction.ATLANTIS]: { name: 'ATLANTIS', ramp: Ramp.TEAL },
  [Faction.INFERNO]: { name: 'INFERNO', ramp: Ramp.CRIMSON },
};
/** The tag a blast the player didn't fire carries (a captain's, a hiccup's, a heart's): main.ts's impact plays no flash, kick, sign or sound for it (M22). */
export const QUIET = { recess: 'quiet' } as const;

export const recessScreen = {
  /** the match's lens: this many degrees wider than the street's 24 (SHOTS.md, "Seeing them": about 40-45), and pulled back this far (m) while a rival is
   *  within `near` (m), easing over `ease` (s) */
  wider: 18,
  pull: 45,
  near: 900,
  ease: 0.8,
  /** the kickoff: the camera high behind the bus (m back, m up) with both captains in frame while the first bell rings, then down to the chase in `swoop` s */
  kickBack: 260,
  kickUp: 170,
  swoop: 2,
  /** the captains drawn this much bigger, with this long a ribbon of their paint behind them (s, sampled every `ribbonStep` s, `ribbonW` m across) */
  captainScale: 1.4,
  ribbon: 4,
  ribbonStep: 0.1,
  ribbonW: 5,
  /** the fence: chalk bubbles round the circle every `fenceStep` m, in rows this high over the ground (m), and how far a bounce pushes the bus back in (m) */
  fenceStep: 14,
  fenceRows: [35, 85, 135],
  fenceBack: 8,
  /** the most a match's hits freeze the screen (s), and only hits on or by the player: the first account's M22 */
  freezeMost: 2,
  freezeHit: 5 / 60,
  /** being hit (SHOTS.md, "Being hit"): the hitter's colours flood the bus front to back in `flood` s and drain off its back in `drain` s at the end; one
   *  barrel roll with a wobble over `fling` s while it's thrown `flingUp` m up and `flingAlong` m along the shot's line; and a roll of `beatRoll` rad on each
   *  beat of the ride */
  flood: 0.3,
  drain: 0.6,
  fling: 0.8,
  flingUp: 35,
  flingAlong: 60,
  beatRoll: 0.35,
  /** s of the first bell's words before the clock starts */
  ready: 2.5,
  /** the camera's climb at the bell (s), and how high over the arena's ground it goes (m) */
  rise: 4,
  scoreboard: 1500,
  /** a god's ring (M47): `ringBubbles` bubbles `ringSize` m round on a circle `ringR` m round its heart, `ringUp` m over the ground there, breathing out by
   *  `ringBreath` on the beat when it's closed */
  ringBubbles: 40,
  ringSize: 4,
  ringR: 56,
  ringUp: 30,
  ringBreath: 0.12,
  /** the clock and the score's row, this far under the safe area's top (px): under the words' slot (M61) */
  clockTop: 112,
  /** an edge chevron's frame (M46): this far under the safe area's top (px, clear of the clock's row), no lower than this share of the height (clear of the
   *  thumb), and this far in from the sides (px) */
  tagTop: 150,
  tagBottom: 0.74,
  tagSide: 30,
  /** the incoming shot's chevron keeps clear of a captain's tag: within `tagWide` px across and `tagTall` px up or down of one, it stands a row nearer the middle */
  tagWide: 110,
  tagTall: 48,
  /** the captains fly this high over the ground, and this over what's under them and ahead (m) */
  captainAGL: 45,
  captainClear: 22,
  /** the match's paint keeps inside the square the brain gave its shooter (the first account's M43): a blast `paintR` m round, its middle moved into the square
   *  so it stays `paintEdge` m inside its edges (a house is taken by its middle less 0.55 of its side, so 10 m keeps a 300 m² one's middle in); a heart's blast
   *  as big as fits */
  paintR: 40,
  paintEdge: 10,
  /** the duel (SHOTS.md, "The duel"). The player's lock: `lockBubbles` white bubbles `lockSize` px across on a ring round the captain, closing from `lockOpen`
   *  of its drawn size to `lockShut` as the hold fills and never shut under `lockMinPx` px of radius (the thumb is on it: a ring under a thumb isn't seen), a
   *  second ring `lockTwice` wider at the full charge. A captain that has the player: a line of
   *  `lineBeads` beads in its colour from it to the bus, each `lineSize` px across, running at the bus `lineRun` times a second, and its tag flashing
   *  `lineFlash` times a second */
  lockBubbles: 14,
  lockSize: 5,
  lockOpen: 2.6,
  lockShut: 1.15,
  lockMinPx: 36,
  lockTwice: 1.35,
  lineBeads: 28,
  lineSize: 2.6,
  lineRun: 1.6,
  lineFlash: 6,
  /** a splash for show (SHOTS.md, "Only aimed shots possess"): a rival within this many m of the player's landed paint gets a flash of it, and nothing else */
  splash: 85,
};

/** The arena (FACTIONS.md section 4: "a 1.5 km circle the game picks where any city is densest"): San Francisco's where Alamo Square, the Lower Haight and Hayes
 *  Valley meet, the three the plan names; another city's its start; ?lat&lon's there. Its middle on the squares' grid, so the brain's squares are the city's. */
export function arenaFor(manifest: { slug: string; origin: readonly number[]; start: { x: number; z: number } }, params: URLSearchParams, flight: Flight): { cx: number; cz: number } {
  // (and puts the bus at its start there)
  let x = manifest.start.x, z = manifest.start.z;
  if (params.has('lat') && params.has('lon')) [x, z] = [flight.x, flight.z];
  else if (manifest.slug.split('~')[0] === 'sf') [x, z] = latLonToLocal(37.7745, -122.43, manifest.origin);
  const s = 128, cx = Math.round(x / s) * s, cz = Math.round(z / s) * s;
  // (the player's start: the brain's own for bus 0, on the circle's east at 0.6 of its radius, facing in)
  flight.x = cx + recessTune.radius * 0.6;
  flight.z = cz;
  flight.heading = -Math.PI / 2;
  return { cx, cz };
}

export interface RecessHost {
  params: URLSearchParams;
  scene: THREE.Scene;
  flight: Flight;
  turbo: { gear: number; shift(dir: 1 | -1, f: Flight): boolean };
  barf(x: number, z: number, opts: BarfOpts): void;
  groundAt(x: number, z: number): number;
  obstacleAt(x: number, z: number): number;
  toast(lines: string[], seconds?: number): void;
  arena: { cx: number; cz: number };
  /** the camera rig's hooks: a wider lens and a pull-back in the match (CameraRig.matchFov, matchPull), and its kick */
  rig: { matchFov: number; matchPull: number; kick(k: number): void };
  /** the player's bus: its colours flood with a hitter's, and it rolls when it's flung (main.ts sets its pose each frame before the match's frame) */
  bus: BusModel;
  /** the shots' holds: the duel is a handler on them, its shots are theirs (game/Hold.ts) */
  holds: Holds;
  /** the steering thumb, -1 to 1: a hard turn in a shot's white dodges it */
  steer(): number;
  /** the lock's clack (and its full charge's), and the rising tone while a captain has the player (s long) */
  clack(full: boolean): void;
  tone(seconds: number): void;
}

type Phase = 'ready' | 'play' | 'over';

export class RecessGame implements MoverAim {
  readonly sim: Recess;
  readonly captains: Captain[] = [];
  readonly cx: number;
  readonly cz: number;
  readonly length: number;
  phase: Phase = 'ready';
  /** the game time the first bell rang (the sim's 0), and the last bell */
  t0 = NaN;
  overAt = NaN;
  /** the aim's mover hand: life's, when ?life is on too */
  life: MoverAim | null = null;
  private readonly h: RecessHost;
  private readonly models: (BusModel | null)[] = [];
  private readonly ys: number[] = [];
  private readonly blobs: THREE.Mesh[] = [];
  private readonly blobMats: Map<number, THREE.ShaderMaterial> = new Map();
  private now = 0;
  private acc = 0;
  private readonly pending: { x: number; z: number; at: number; bomb?: { jump: number; superId: number; r: number } }[] = [];
  /** the duel: the player's lock on a captain and the captains' shots at the player (Duel.ts) */
  readonly duel: Duel;
  private lockRing: THREE.InstancedMesh | null = null;
  private readonly lines: THREE.InstancedMesh[] = [];
  private toneAt = -Infinity;
  private beadsWarm = 3;
  private readonly splashAt: number[] = [];
  private readonly camX = new THREE.Vector3();
  private readonly camY = new THREE.Vector3();
  private readonly v3b = new THREE.Vector3();
  private bubbleAt: { x: number; z: number } | null = null;
  private saidAt = -Infinity;
  private saidRank = 0;
  /** the hit-stops this match has spent (s), and how far the match's clock has run past the game's in them (s) */
  private frozen = 0;
  private lag = 0;
  private hud: HTMLDivElement | null = null;
  private hudText = '';
  /** the safe area's top (px), read once */
  private safeTop = 0;
  private readonly pose: BusPose = { squash: 1, eye: 1, fullness: 1, mouth: 0, speed: 0, wheeze: 0, heave: 0 };
  private readonly eul = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly camFrom = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private readonly camTo = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private readonly m4 = new THREE.Matrix4();
  /** the captains' ribbons, the fence, and the HUD's tags (a name and distance over a captain on screen, a chevron at the edge for one off it or a shot at you) */
  private readonly ribbons: Ribbon[] = [];
  private fence: THREE.InstancedMesh | null = null;
  private readonly tags: Tag[] = [];
  /** where each captain's tag stands this frame (px, x then y): the shot's chevron keeps clear of them */
  private readonly tagAt = new Float32Array(16);
  private readonly v3 = new THREE.Vector3();
  private readonly rigPos = new THREE.Vector3();
  private readonly rigQuat = new THREE.Quaternion();
  private pullNow = 0;
  /** the forced gear in a ride, by the link (&hit=nonstop or &hit=jet; SHOTS.md, "The forced gear, both ways on your phone") */
  readonly hitGear: number;
  /** the player's bus's own colours, where they sit along it, and the flood and fling under way */
  private readonly busRamp: Float32Array;
  private readonly busZ: Float32Array;
  private busZmin = Infinity;
  private busZmax = -Infinity;
  private flood: { at: number; ramp: number; drainAt: number; shown: number } | null = null;
  private fling: { at: number; dx: number; dz: number; e: number } | null = null;
  private readonly qRoll = new THREE.Quaternion();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private bounceAt = -Infinity;
  /** QA: the last words said */
  said = '';
  /** each heart's ring (M47) */
  private readonly rings: THREE.InstancedMesh[] = [];
  /** the camps' hearts as they were last step */
  private readonly hearts: { n: number; key: number; faction: number; stage: number; cracks: number }[] = [];
  /** QA: the captains' last paint on the city, where and whose, landing when */
  readonly painted: { x: number; z: number; faction: number; at: number; r: number; key: number }[] = [];
  /** QA: what happened, by kind */
  readonly counts: Record<string, number> = {};

  constructor(h: RecessHost) {
    this.h = h;
    this.cx = h.arena.cx;
    this.cz = h.arena.cz;
    const p = h.params, m = p.get('recess'), mode: Mode = m === 'pinata' || m === 'bubbled' ? m : 'possessed';
    const lv = (v: string | null, d: Level): Level => (v === 'learner' || v === 'rival' || v === 'veteran' ? v : d);
    const bots: [Level, Level] = [lv(p.get('bots'), 'rival'), lv(p.get('bots'), 'learner')];
    this.length = Math.max(5, Number(p.get('recesslen')) || recessTune.length);
    this.hitGear = p.get('hit') === 'jet' ? JET : NONSTOP;
    const bg = h.bus.mesh.geometry, ra = bg.getAttribute('ramp') as THREE.BufferAttribute, pa = bg.getAttribute('position') as THREE.BufferAttribute;
    this.busRamp = Float32Array.from({ length: ra.count }, (_, i) => ra.getX(i));
    this.busZ = Float32Array.from({ length: pa.count }, (_, i) => pa.getZ(i));
    for (const z of this.busZ) {
      this.busZmin = Math.min(this.busZmin, z);
      this.busZmax = Math.max(this.busZmax, z);
    }
    // (the player is bus 0, placed from the real flight; a new player's shield only with &newcomer: Recess is where Possessed is learned)
    // (the captains start ahead of the player, inside 10 degrees of its nose and about 500 m away, facing it: SHOTS.md, "A closer start". The player starts on
    // the circle's east at 0.6 of its radius facing west, so ahead is 500 m west of it, 84 m either side, each captain in its own camp)
    const r0 = recessTune.radius * 0.6, ahead = r0 - 500;
    this.sim = new Recess(
      [{ faction: Faction.RAINBOW, newcomer: p.has('newcomer'), x: r0, z: 0, heading: Math.PI }, { faction: Faction.ATLANTIS, bot: bots[0], x: ahead, z: 84, heading: -0.17 }, { faction: Faction.INFERNO, bot: bots[1], x: ahead, z: -84, heading: 0.17 }],
      { mode, log: false },
    );
    this.sim.buses[0].external = true;
    // (the duel: a captain's lock on the player comes out of the brain as its 'aim', and its shot is Duel.ts's on the shots' holds; nothing is rolled)
    this.sim.duel = true;
    // (each camp's heart, where its god stands from the start: watched each step for its cracks, its fall, a god rising again)
    const R = this.sim.areas.realm!;
    for (let n = 0; n < R.count; n++) {
      const a = this.sim.areas.all.get(R.heart(n));
      this.hearts.push({ n, key: R.heart(n), faction: a?.faction ?? 0, stage: a?.stage ?? 0, cracks: 0 });
      const ring = makeRing();
      h.scene.add(ring);
      this.rings.push(ring);
    }
    bots.forEach((b, i) => this.captains.push(new Captain(b, 0x5eed + i * 101)));
    for (const b of this.sim.buses) {
      if (b.id === 0) {
        this.models.push(null);
        this.ys.push(h.flight.y);
        continue;
      }
      const bus = new BusModel(1.6 * recessScreen.captainScale);
      // (the captain's bus in its faction's colour: the yellow's ramp swapped)
      const ramp = bus.mesh.geometry.getAttribute('ramp') as THREE.BufferAttribute;
      for (let i = 0; i < ramp.count; i++) if (ramp.getX(i) === Ramp.BUS_YELLOW) ramp.setX(i, SIDES[b.faction].ramp);
      ramp.needsUpdate = true;
      bus.root.name = `RecessCaptain${b.id}`;
      h.scene.add(bus.root);
      this.models.push(bus);
      this.ys.push(this.altFor(b.x + this.cx, b.z + this.cz));
      const rib = new Ribbon(SIDES[b.faction].ramp);
      h.scene.add(rib.mesh);
      this.ribbons[b.id] = rib;
    }
    this.fence = makeFence(this.cx, this.cz, (x, z) => h.groundAt(x, z));
    h.scene.add(this.fence);
    this.duel = new Duel({
      holds: h.holds,
      sim: this.sim,
      flight: h.flight,
      cx: this.cx,
      cz: this.cz,
      yOf: (id) => this.ys[id],
      sizeOf: (id) => (this.models[id]?.length ?? 16) * 0.5,
      level: (id) => this.captains[id - 1].level,
      playing: () => this.phase === 'play',
      steer: () => h.steer(),
      clack: (full) => h.clack(full),
      say: (lines, seconds, rank) => this.say(lines, seconds, rank),
      count: (k) => this.count(k),
      kick: (k) => h.rig.kick(k),
      seed: 0x5eed,
    });
    // (the lock's ring and each captain's line at the player: bubbles as the fence's and the hearts' rings, so nothing new compiles)
    this.lockRing = makeBeads(Ramp.GLOW_WHITE, recessScreen.lockBubbles * 2, 'RecessLock');
    h.scene.add(this.lockRing);
    for (const b of this.sim.buses) {
      if (b.id === 0) continue;
      const line = makeBeads(SIDES[b.faction].ramp, recessScreen.lineBeads, `RecessLine${b.id}`);
      h.scene.add(line);
      this.lines[b.id] = line;
    }
    // (breaths in flight and Piñata's drops: toon blobs, one material a hue and a white-hot one)
    const geo = new THREE.IcosahedronGeometry(3.2, 1);
    for (const ramp of [...new Set(Object.values(SIDES).map((x) => x.ramp)), Ramp.GLOW_WHITE]) this.blobMats.set(ramp, makeRampMaterial({ ramp, glow: 0.7, noOutline: true, shadowMul: 0 }));
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(geo, this.blobMats.get(Ramp.BUS_YELLOW)!);
      mesh.visible = i === 0;
      mesh.position.set(h.flight.x, h.flight.y - 400, h.flight.z);
      mesh.frustumCulled = false;
      mesh.name = 'RecessBlob';
      h.scene.add(mesh);
      this.blobs.push(mesh);
    }
    if (typeof document !== 'undefined') {
      this.makeHud();
      for (const b of this.sim.buses) if (b.id !== 0) this.tags.push(new Tag(SIDES[b.faction].name, rgba(SIDES[b.faction].ramp, 6), b.id));
      this.tags.push(new Tag('', C.cream, -1));
    }
    (globalThis as { __recess?: RecessGame }).__recess = this;
  }

  // ---- the aim (Aim.ts's mover hand): life's movers only. A captain is locked by a hold (Duel.ts), and a tap near one is a splash for show ----

  ours(key: string): boolean {
    return key.startsWith('recess:');
  }

  aim(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pickR: number, travel: number, ground?: boolean, past?: number): MoverTarget | null {
    // (`ground` passed on: without it the aim's second ask, along the nose for a plane, took cars too in a match; and `past`, life's M10)
    return this.life ? this.life.aim(ox, oy, oz, dx, dy, dz, pickR, travel, ground, past) : null;
  }

  glint(key: string | null): void {
    this.life?.glint(key && this.ours(key) ? null : key);
  }

  /** A breath the aim sent at a captain (none does since the duel: the aim hands out life's movers only). Kept for main.ts's call: a splash for show. */
  playerFire(key: string, _arrive: number): void {
    if (this.phase !== 'play') return;
    this.splash(Number(key.slice(7)));
  }

  /**
   * The player's breath on the city, landing at (x, z) at game time `arrive`: the square there takes Rainbow's hit then, inside the circle (as a captain's). A
   * Bomb's (`bomb`: its jump, its SuperTag's id, its circle) jumps the square it's aimed at, its own or grey, `jump` stages at once to 3 at most, a rival's taking
   * its one hit, and the grey squares in its circle spill Rainbow's at stage 1 (HOOKS.md, the producer's fourth call).
   */
  playerPaint(x: number, z: number, arrive: number, bomb?: { jump: number; superId: number; r: number }): void {
    if (this.phase !== 'play' || !Recess.inside(x - this.cx, z - this.cz)) return;
    this.pending.push({ x: x - this.cx, z: z - this.cz, at: this.simAt(arrive), bomb });
  }

  /** The match is on: between the first bell's words and the last bell (main.ts: no Comet meanwhile). */
  get playing(): boolean {
    return this.phase === 'play';
  }

  /**
   * Whether the player's breath landing at (x, z) at game time `arrive` should paint the city (M23: the screen agrees with the brain): not where the brain will
   * leave the square someone else's, a parry, a crack or a knock-down, and not from inside the stop arm or a bubble, whose mouth is shut as a captain's is. Those
   * breaths still count; they land as a flash in the air.
   */
  blocks(x: number, z: number, arrive: number): boolean {
    if (this.phase !== 'play') return false;
    const sx = x - this.cx, sz = z - this.cz, me = this.sim.buses[0];
    if (me.state === 'shield' || me.state === 'bubble') return true;
    if (!Recess.inside(sx, sz)) return false;
    const o = this.sim.areas.peek(sx, sz, Faction.RAINBOW, this.simAt(arrive));
    return o === 'parry' || o === 'crack' || o === 'down';
  }

  /** A blast the match tagged quiet (main.ts's impact): no flash, kick, sign or sound. */
  quiet(tag: unknown): boolean {
    return tag === QUIET;
  }

  /** A game time as the match's clock reads it: from the first bell, plus what the hit-stops froze of the game's and not of the match's. */
  private simAt(game: number): number {
    return game - this.t0 + this.lag;
  }

  /** A flick, before the gears see it: in the white of a shot at the bus it dodges it (Duel.flick: a lunge or a brake-hop, no gear); in a ride it only
   *  wheezes. True: taken. */
  flick(dir: 1 | -1): boolean {
    if (this.phase !== 'play') return false;
    const me = this.sim.buses[0];
    if (me.state !== 'bubble' && this.duel.flick(dir)) return true;
    if (me.state === 'ride') {
      if (dir < 0) this.say(['NO BRAKES'], 1.2, 2);
      return true;
    }
    return me.state === 'bubble';
  }

  // ---- the frame ----

  /** `clock`: the frame's real time, which runs on through a hit-stop's frozen frames (dt 0) so the match's never stops; 0 while the game is held. */
  frame(dt: number, simTime: number, camera: THREE.Camera, clock = dt): void {
    this.now = simTime;
    const f = this.h.flight;
    if (Number.isNaN(this.t0)) {
      this.t0 = simTime + recessScreen.ready;
      this.say(['RECESS!', 'PAINT THE MOST BEFORE THE BELL'], recessScreen.ready + 1, 3);
    }
    if (this.phase === 'ready' && simTime >= this.t0) {
      this.phase = 'play';
      // (the easiest captain hunts the player from the bell; the other paints its first 10 s, so the first duel is the easy one: m52)
      const order: Level[] = ['learner', 'rival', 'veteran'], easiest = this.captains.reduce((e, c) => (order.indexOf(c.level) < order.indexOf(e.level) ? c : e), this.captains[0]);
      for (const c of this.captains) c.kickoff(0, c === easiest ? 0 : -1);
      this.say(['DING DING DING', `${Math.round(this.length / 60) || 1} MINUTES`], 2, 3);
      // (each god's heart in its colour, a big blast, so the field shows whose camp is whose)
      for (const h of this.hearts) if (h.stage === 5) this.heartBlast(h.key, h.faction);
    }
    if (this.phase === 'play') {
      // (the brain at its own step, the player's bus placed from the flight before each)
      this.acc += clock;
      this.lag += clock - dt;
      const step = this.sim.dt;
      while (this.acc >= step && this.phase === 'play') {
        this.acc -= step;
        this.place(f);
        const hands = this.sim.buses.map((b) => (b.id === 0 ? { steer: 0, tap: false, flick: 0 } : this.captains[b.id - 1].think(this.sim, b)));
        this.sim.step(hands);
        // (a captain's lock on the player is ready: its shot, on the shots' holds)
        this.duel.heard();
        for (let i = this.pending.length - 1; i >= 0; i--) {
          const p = this.pending[i];
          if (this.sim.t < p.at) continue;
          const A = this.sim.areas, b = p.bomb;
          // (a rival inside the splat: a splash of paint for show, no Possessed and no lost time. Only an aimed shot possesses)
          for (const v of this.sim.buses) if (v.id !== 0 && v.faction !== Faction.RAINBOW && Math.hypot(v.x - p.x, v.z - p.z) <= Math.max(recessScreen.splash, b?.r ?? 0)) this.splash(v.id);
          const o = A.hit(p.x, p.z, Faction.RAINBOW, this.sim.t, b ? { superId: b.superId, jump: b.jump, cap: 3 } : {}).outcome, a = A.get(p.x, p.z);
          this.pending.splice(i, 1);
          if (b) {
            this.count('bomb');
            // (the grey squares its circle reaches, inside the arena: Rainbow's at stage 1, nobody else's ground changed)
            const s = areaTune.size, n = Math.ceil(b.r / s);
            for (let dz = -n; dz <= n; dz++)
              for (let dx = -n; dx <= n; dx++) {
                const c = squareCentre(squareKey(p.x + dx * s, p.z + dz * s)), ex = Math.max(0, Math.abs(c.x - p.x) - s / 2), ez = Math.max(0, Math.abs(c.z - p.z) - s / 2);
                if ((dx || dz) && Math.hypot(ex, ez) <= b.r && Recess.inside(c.x, c.z)) A.spill(c.x, c.z, Faction.RAINBOW, this.sim.t);
              }
          }
          // (on a god: a tap before its ring closes is wasted, and says so; a whole god's ring only starts again. The seal is said with the heart's watch)
          if (a?.stage === 5) {
            if (o === 'encore' || o === 'parry') this.count('tooSoon');
            if (o === 'encore' || o === 'parry') this.say([o === 'encore' ? 'TOO SOON' : 'PARRIED', 'WAIT FOR THE RING'], 1.2, 2);
            else if (o === 'guard') this.say(['GUARDED', 'THE RING STARTS AGAIN'], 1.2, 1);
          }
        }
        this.events();
        this.watchHearts();
        if (this.sim.t >= this.length) this.bell(simTime);
      }
      // (not after the bell: a ride going then would shift the gears back up and hold its flood, the day review's n57)
      if (this.phase === 'play') this.player(clock, f);
    }
    // (the duel on the game's own step, as the shots are: Holds.frame ran on it just before)
    this.duel.frame(dt);
    this.drawDuel(camera, simTime);
    this.draw(dt, simTime);
    this.drawRings();
    this.hitFx(simTime);
    this.lens(clock);
    if (this.phase !== 'over') this.kickoff(simTime, camera);
    if (this.phase === 'over') this.scoreboard(simTime, camera);
    this.drawHud();
    this.drawTags(camera);
  }

  /** Hit (SHOTS.md, "Being hit"): NO BRAKES, the hitter's colours flood in from the front, and the bus is flung along the shot's line with a barrel roll. */
  private beHit(by: number): void {
    const S = this.sim, a = S.buses[by], me = S.buses[0], dx = me.x - a.x, dz = me.z - a.z, l = Math.hypot(dx, dz) || 1;
    this.flood = { at: this.now, ramp: SIDES[a.faction].ramp, drainAt: Infinity, shown: -1 };
    this.fling = { at: this.now, dx: dx / l, dz: dz / l, e: 0 };
    this.h.rig.kick(1.4);
    this.count('flung');
  }

  /** The flood's colours on the player's bus, the fling's throw and roll, and the ride's roll on each beat: after main.ts has posed the bus this frame. */
  private hitFx(simTime: number): void {
    const R = recessScreen, f = this.h.flight, root = this.h.bus.root, me = this.sim.buses[0];
    const fl = this.flood;
    if (fl) {
      const k = Math.min(1, (simTime - fl.at) / R.flood), kd = Math.max(0, Math.min(1, (simTime - fl.drainAt) / R.drain));
      // (front to back: the bus's nose is its -z; the drain leaves from its back, +z. Redone only while it moves, in 30 steps)
      const shown = Math.round(k * 30) + Math.round(kd * 30) * 31;
      if (shown !== fl.shown) {
        fl.shown = shown;
        const ra = this.h.bus.mesh.geometry.getAttribute('ramp') as THREE.BufferAttribute, span = this.busZmax - this.busZmin;
        const reach = this.busZmin + k * span, gone = this.busZmax - kd * span;
        for (let i = 0; i < this.busRamp.length; i++) {
          if (this.busRamp[i] !== Ramp.BUS_YELLOW) continue;
          const z = this.busZ[i];
          ra.setX(i, z <= reach && z < gone ? fl.ramp : Ramp.BUS_YELLOW);
        }
        ra.needsUpdate = true;
      }
      if (kd >= 1) this.flood = null;
    }
    let roll = 0;
    const fg = this.fling;
    if (fg) {
      const k = Math.min(1, (simTime - fg.at) / R.fling), e = k * k * (3 - 2 * k), de = e - fg.e;
      fg.e = e;
      f.x += fg.dx * R.flingAlong * de;
      f.z += fg.dz * R.flingAlong * de;
      f.y += R.flingUp * de;
      roll = Math.PI * 2 * e + 0.3 * Math.sin(k * Math.PI * 3) * (1 - k);
      if (k >= 1) this.fling = null;
    } else if (me.state === 'ride') {
      // (on each beat of the hitter's music, a quick roll and back)
      const ph = this.sim.beat.phase(this.sim.t);
      roll = R.beatRoll * Math.sin(ph * Math.PI * 2) * Math.exp(-ph * 3);
    }
    if (roll) root.quaternion.multiply(this.qRoll.setFromAxisAngle(this.zAxis, roll));
  }

  /** The match's lens (SHOTS.md, "Seeing them"): wider, and pulled back while a rival is near, through the rig's hook; the street's again at the bell. */
  private lens(dt: number): void {
    const R = recessScreen, me = this.sim.buses[0];
    let near = false;
    for (const b of this.sim.buses) if (b.id !== 0 && Math.hypot(b.x - me.x, b.z - me.z) < R.near) near = true;
    const k = 1 - Math.exp(-dt / R.ease), on = this.phase === 'over' ? 0 : 1;
    this.pullNow += ((near ? R.pull : 0) * on - this.pullNow) * k;
    // (the wider lens stays at the bell, so the scoreboard from 1,500 m holds all three hearts: the day review's m54)
    this.h.rig.matchFov += (R.wider - this.h.rig.matchFov) * k;
    this.h.rig.matchPull = this.pullNow;
  }

  /** The kickoff: while the first bell rings the camera is high behind the bus with both captains in frame, then it swoops down to the chase in 2 s. */
  private kickoff(simTime: number, camera: THREE.Camera): void {
    const R = recessScreen, since = simTime - this.t0;
    if (since >= R.swoop) return;
    const f = this.h.flight, fx = Math.sin(f.heading), fz = -Math.cos(f.heading);
    this.rigPos.copy(camera.position);
    this.rigQuat.copy(camera.quaternion);
    // (the middle of the captains, where the camera looks)
    let mx = 0, mz = 0, my = 0, n = 0;
    for (const b of this.sim.buses) {
      if (b.id === 0) continue;
      mx += this.cx + b.x;
      mz += this.cz + b.z;
      my += this.ys[b.id];
      n++;
    }
    this.camTo.p.set(f.x - fx * R.kickBack, f.y + R.kickUp, f.z - fz * R.kickBack);
    this.m4.lookAt(this.camTo.p, this.v3.set(mx / n, my / n, mz / n), THREE.Object3D.DEFAULT_UP);
    this.camTo.q.setFromRotationMatrix(this.m4);
    const k = since <= 0 ? 0 : Math.min(1, since / R.swoop), e = k * k * (3 - 2 * k);
    camera.position.lerpVectors(this.camTo.p, this.rigPos, e);
    camera.quaternion.slerpQuaternions(this.camTo.q, this.rigQuat, e);
    camera.updateMatrixWorld();
  }

  /** Bus 0 where the real flight is. */
  private place(f: Flight): void {
    const b = this.sim.buses[0];
    b.x = f.x - this.cx;
    b.z = f.z - this.cz;
    b.heading = f.heading - Math.PI / 2;
    b.speed = f.ground;
    if (b.state === 'bubble' && this.bubbleAt) {
      b.x = this.bubbleAt.x - this.cx;
      b.z = this.bubbleAt.z - this.cz;
    }
  }

  /** The player's own bus: Possessed holds Nonstop, a bubble holds it still; out of the circle, a word. (A dodge's lunge is the duel's: Duel.frame.) */
  private player(dt: number, f: Flight): void {
    const me = this.sim.buses[0], T = this.h.turbo;
    if (me.state === 'ride') {
      const want = this.hitGear;
      if (T.gear < want) T.shift(1, f);
      else if (T.gear > want) T.shift(-1, f);
    }
    if (me.state === 'bubble') {
      this.bubbleAt ??= { x: f.x, z: f.z };
      f.x = this.bubbleAt.x;
      f.z = this.bubbleAt.z;
    } else this.bubbleAt = null;
    // (the fence: at the circle's edge the bus bounces back in, its heading mirrored off the fence, with a boing. SHOTS.md: "the 750 m edge shows as chalk
    // bubbles and bounces you back in". The steering stays the player's: only where it's pointed is turned, once)
    const R = recessTune.radius, dx = f.x - this.cx, dz = f.z - this.cz, r = Math.hypot(dx, dz);
    if (r > R) {
      const nx = dx / r, nz = dz / r, fx = Math.sin(f.heading), fz = -Math.cos(f.heading), out = fx * nx + fz * nz;
      if (out > 0) f.heading = Math.atan2(fx - 2 * out * nx, -(fz - 2 * out * nz));
      f.x = this.cx + nx * (R - recessScreen.fenceBack);
      f.z = this.cz + nz * (R - recessScreen.fenceBack);
      if (this.now - this.bounceAt > 0.5) {
        this.bounceAt = this.now;
        this.count('bounce');
        this.say(['BOING!'], 0.8, 1);
        this.h.rig.kick(0.6);
      }
    }
  }

  /** The brain's events this step, onto the city and the screen. */
  private events(): void {
    const S = this.sim, sec = (id: number) => SIDES[S.buses[id].faction];
    for (const e of S.events) {
      this.count(e.kind);
      const a = e.a >= 0 ? S.buses[e.a] : null, b = e.b >= 0 ? S.buses[e.b] : null;
      switch (e.kind) {
        case 'paint':
          // (a breath that landed on the ground, a captain's or a missed one at a bus: the city takes its paint where the brain left the square its shooter's,
          // and nowhere it parried, cracked or knocked down, so the map from 1,500 m is the score. M23)
          if (a && e.x !== undefined && S.areas.get(e.x, e.z!)?.faction === a.faction) this.paint(e.x, e.z!, a.faction, 0.05, a.id === 0 ? this.h.flight.y : this.ys[a.id]);
          break;
        case 'hiccup':
          // (the ridden bus blasts its hitter's paint where it is, on the beat, where the brain claimed grey for it: nobody else's ground changes)
          if (a && b && e.outcome === 'claim') this.paint(b.x, b.z, a.faction, 0.3, b.id === 0 ? this.h.flight.y : this.ys[b.id], 0.7);
          break;
        case 'hit':
        case 'lesson':
          if (b) this.flash(b.id, a?.id === 0 || b.id === 0);
          if (b?.id === 0 && a) this.beHit(a.id);
          if (b?.id === 0) this.say(e.kind === 'lesson' ? ['A LESSON', 'THEY GLINT BEFORE THEY BREATHE'] : ['NO BRAKES', `${sec(e.a).name} HAS YOUR BUS`], 2.4, 3);
          else if (a?.id === 0) this.say(['GOTCHA', `${sec(e.b).name} PAINTS RAINBOW`], 2, 3);
          break;
        case 'whiteHot':
          if (e.b === 0) this.say(['FLICK!'], 0.6, 2);
          break;
        case 'glint':
          // (they see it coming, as the player's rivals do: the words, a rising tone, and the line and the flashing tag while the lock holds, drawDuel's)
          if (e.b === 0 && a && a.id !== 0) {
            this.say([`${sec(a.id).name} HAS YOU`], 0.9, 1);
            if (this.now - this.toneAt > 1) this.h.tone(recessTune.botGlint + 0.4);
            this.toneAt = this.now;
          }
          break;
        case 'sparkle':
          if (e.b === 0) this.say(['SPARKLES', 'NEW BUSES ARE SHIELDED'], 1.2, 2);
          break;
        case 'rideEnd':
          if (e.b === 0) {
            this.say(['DING DING', 'STOP ARM OUT'], 2, 2);
            if (this.flood) this.flood.drainAt = this.now;
            // (SHOTS.md, "End": the next hold on the bus arms a Bomb III at once, one time)
            this.h.holds.bomb.gift(3);
          }
          break;
        case 'wanted':
          this.say([e.a === 0 ? 'YOU ARE WANTED' : `${sec(e.a).name} IS WANTED`], 1.8, 2);
          break;
        case 'wash':
          if (e.b === 0) this.say(['WASHED OFF'], 1.2, 2);
          break;
      }
    }
  }

  /** The hearts: a god cracked, healed, fallen or risen again, in words, and a fall or a rise in a big blast of the new owner's paint. */
  private watchHearts(): void {
    const A = this.sim.areas, R = A.realm!;
    for (const h of this.hearts) {
      const a = A.all.get(h.key);
      if (!a) continue;
      const name = SIDES[h.faction]?.name ?? '', mine = h.faction === Faction.RAINBOW;
      if (h.stage === 5 && a.stage !== 5) {
        this.count('topple');
        this.say([mine ? 'YOUR GOD FALLS' : `${name}'S GOD FALLS`, `${SIDES[a.faction]?.name ?? ''} TAKES THE HEART`], 3, 4);
        this.heartBlast(h.key, a.faction);
      } else if (h.stage !== 5 && a.stage === 5) {
        this.count('raise');
        this.say(['A GOD RISES', SIDES[a.faction]?.name ?? ''], 3, 4);
        this.heartBlast(h.key, a.faction);
      } else if (a.stage === 5 && a.cracks > h.cracks) {
        const need = A.toppleHits(h.n, a.faction);
        this.say([mine ? 'YOUR GOD IS CRACKED' : `${name}'S GOD CRACKED`, `${a.cracks} OF ${need}`], 1.6, mine ? 2 : 1);
      } else if (a.stage === 5 && a.cracks < h.cracks) {
        // (seal two: a ready owner's hit seals two cracks, or the one there is)
        const k = h.cracks - a.cracks, what = k >= 2 ? 'TWO CRACKS' : 'A CRACK';
        this.say(mine ? ['SEALED', what] : [`${name} SEALS`, what], 1.4, mine ? 2 : 1);
      }
      h.faction = a.faction;
      h.stage = a.stage;
      h.cracks = a.cracks;
    }
    void R;
  }

  /**
   * The gods' rings (decision 16, "seal two"; the day review's M47): round each standing god's heart, bubbles in its owner's colour that close over the five
   * seconds after a hit, and whole, breathing on the beat, when the next hit counts: a seal of two from its owner, a crack from a raider.
   */
  private drawRings(): void {
    const A = this.sim.areas, R = recessScreen;
    this.hearts.forEach((h, i) => {
      const ring = this.rings[i], a = A.all.get(h.key);
      if (!a || a.stage !== 5) {
        ring.visible = false;
        return;
      }
      const c = squareCentre(h.key), x = this.cx + c.x, z = this.cz + c.z, s = Math.min(1, Math.max(0, (this.sim.t - a.last) / areaTune.cooldown));
      ring.position.set(x, this.h.groundAt(x, z) + R.ringUp, z);
      ring.visible = true;
      ring.count = s >= 1 ? R.ringBubbles : Math.floor(s * R.ringBubbles);
      (ring.material as THREE.ShaderMaterial).uniforms.uRamp.value = SIDES[a.faction]?.ramp ?? Ramp.GLOW_WHITE;
      ring.scale.setScalar(s >= 1 ? 1 + R.ringBreath * Math.max(0, Math.sin(this.now * Math.PI * 2 * (84 / 60))) : 1);
    });
  }

  /** A big blast of `faction`'s paint on heart square `key`. */
  private heartBlast(key: number, faction: number): void {
    const c = squareCentre(key), wx = this.cx + c.x, wz = this.cz + c.z;
    this.paint(c.x, c.z, faction, 0.4, this.h.groundAt(wx, wz) + 80, 1.5);
  }

  /**
   * Paint on the real city at brain point (x, z), `faction`'s: Rainbow's dealt hues, a captain's one. Inside the square (x, z) is in, as the brain takes only
   * that square: the blast `paintR` m round (`size` times, as much as fits), its middle moved in from the edges so it stays `paintEdge` m inside them (M43).
   * The match's paint draws no stream from the player's bus (M44).
   */
  private paint(x: number, z: number, faction: number, travel: number, fromY: number, size = 1): void {
    const R = recessScreen, c = squareCentre(squareKey(x, z)), half = areaTune.size / 2 - R.paintEdge, r = Math.min(R.paintR * size, half), room = half - r;
    const wx = this.cx + Math.max(c.x - room, Math.min(c.x + room, x)), wz = this.cz + Math.max(c.z - room, Math.min(c.z + room, z));
    const drop = Math.max(0, fromY - this.h.groundAt(wx, wz));
    if (faction !== Faction.RAINBOW) {
      this.painted.push({ x: wx, z: wz, faction, at: this.now + travel, r, key: squareKey(wx - this.cx, wz - this.cz) });
      if (this.painted.length > 64) this.painted.shift();
    }
    // (no building picked to land on: the game's own pick could be the next square's, and it's always painted, wherever it stands)
    this.h.barf(wx, wz, { travel: Math.max(0.05, travel), drop, from: fromY, faction, hitStop: 0, tag: QUIET, stream: true, radius: r, target: null });
  }

  /** A hit's flash on bus `id`, in the air where it is: a hit on or by the player freezes the screen, at most 2 s a match; one between captains is quiet. */
  private flash(id: number, player: boolean): void {
    const b = this.sim.buses[id], y = id === 0 ? this.h.flight.y : this.ys[id], wx = this.cx + b.x, wz = this.cz + b.z, R = recessScreen;
    const freeze = player && this.frozen + R.freezeHit <= R.freezeMost;
    if (freeze) this.frozen += R.freezeHit;
    this.h.barf(wx, wz, { travel: 0.02, mover: { x: wx, y, z: wz }, moverFresh: false, ...(freeze ? {} : { hitStop: 0 }), ...(player ? {} : { tag: QUIET }) });
  }

  /** A splash for show on captain `id`, caught in the player's splat: a quiet flash of the paint on it, at most one every half second. Nothing in the brain. */
  private splash(id: number): void {
    if (this.now - (this.splashAt[id] ?? -Infinity) < 0.5) return;
    this.splashAt[id] = this.now;
    this.count('splash');
    this.flash(id, false);
  }

  /** The last bell: the brain stops, and the camera goes up to see the map. */
  private bell(simTime: number): void {
    this.phase = 'over';
    this.overAt = simTime;
    this.duel.reset();
    // (recess is over: the gears back to Cruise, a ride ended and its flood drained)
    for (let k = 0; k < 8 && this.h.turbo.gear > 0; k++) this.h.turbo.shift(-1, this.h.flight);
    if (this.flood) this.flood.drainAt = Math.min(this.flood.drainAt, this.now);
    const s = this.sim.score(), order = [Faction.RAINBOW, Faction.ATLANTIS, Faction.INFERNO].sort((p, q) => s[q] - s[p]);
    const tie = s[order[0]] === s[order[1]];
    this.say(['THE BELL!', tie ? 'A TIE' : order[0] === Faction.RAINBOW ? 'RAINBOW WINS' : `${SIDES[order[0]].name} WINS`], 4, 4);
  }

  private scoreboard(simTime: number, camera: THREE.Camera): void {
    const k = Math.min(1, (simTime - this.overAt) / recessScreen.rise), e = k * k * (3 - 2 * k);
    // (the bus held over the arena's middle: the city streams its detail, and its paint, round the bus, so the map under the camera stays the painted one)
    const f = this.h.flight;
    f.x = this.cx;
    f.z = this.cz;
    f.speed = Math.min(f.speed, 30);
    if (k === 0 || simTime - this.overAt < 1e-6) {
      this.camFrom.p.copy(camera.position);
      this.camFrom.q.copy(camera.quaternion);
      const g = this.h.groundAt(this.cx, this.cz);
      this.camTo.p.set(this.cx, g + recessScreen.scoreboard, this.cz + recessScreen.scoreboard * 0.35);
      this.m4.lookAt(this.camTo.p, new THREE.Vector3(this.cx, g, this.cz), new THREE.Vector3(0, 1, 0));
      this.camTo.q.setFromRotationMatrix(this.m4);
    }
    camera.position.lerpVectors(this.camFrom.p, this.camTo.p, e);
    camera.quaternion.slerpQuaternions(this.camFrom.q, this.camTo.q, e);
    camera.updateMatrixWorld();
  }

  /** The captains' buses, the breaths and the drops. */
  private draw(dt: number, simTime: number): void {
    const S = this.sim;
    for (const b of S.buses) {
      const m = this.models[b.id];
      if (!m) continue;
      const wx = this.cx + b.x, wz = this.cz + b.z;
      // (their height: over the ground and what's under them and ahead, eased)
      const want = this.altFor(wx + Math.cos(b.heading) * 40, wz + Math.sin(b.heading) * 40, wx, wz);
      this.ys[b.id] += (want - this.ys[b.id]) * (1 - Math.exp(-1.8 * dt));
      // (a captain that has the player glints: SHOTS.md, "They see it coming")
      const p = this.pose, glint = this.phase === 'play' && this.duel.aimedBy(b.id);
      p.speed = b.speed;
      p.fullness = S.t >= b.belly ? 1 : 0.3;
      p.wheeze = b.state === 'ride' ? 0.8 : 0;
      p.squash = b.state === 'ride' ? 1 + 0.12 * Math.sin(S.beat.phase(S.t) * Math.PI * 2) : glint ? 1 + 0.1 * Math.sin(simTime * 18) : 1;
      p.eye = b.state === 'shield' ? 0.2 : 1;
      m.update(dt, simTime, p);
      const hg = b.heading + Math.PI / 2, bank = Math.max(-0.5, Math.min(0.5, (b.driverYaw + b.edgeYaw) * 0.45));
      m.root.quaternion.setFromEuler(this.eul.set(0, -hg, -bank, 'YXZ'));
      if (b.state === 'ride') {
        const ph = S.beat.phase(S.t);
        m.root.quaternion.multiply(this.qRoll.setFromAxisAngle(this.zAxis, recessScreen.beatRoll * Math.sin(ph * Math.PI * 2) * Math.exp(-ph * 3)));
      }
      m.root.position.set(wx, this.ys[b.id], wz);
      m.root.scale.setScalar(glint ? 1.12 : 1);
      this.ribbons[b.id]?.update(wx, this.ys[b.id], wz, simTime);
    }
    let n = 0;
    for (const s of S.breaths) {
      if (n >= this.blobs.length) break;
      const from = S.buses[s.from], fy = s.from === 0 ? this.h.flight.y : this.ys[s.from];
      const ty = s.target >= 0 ? (s.target === 0 ? this.h.flight.y : this.ys[s.target]) : this.h.groundAt(this.cx + s.tx, this.cz + s.tz);
      const k = Math.min(1, Math.max(0, (S.t - s.born) / Math.max(1e-3, s.arrive - s.born)));
      const blob = this.blobs[n++];
      blob.visible = true;
      blob.material = this.blobMats.get(s.white ? Ramp.GLOW_WHITE : s.from === 0 ? Ramp.BUS_YELLOW : SIDES[from.faction].ramp)!;
      blob.position.set(this.cx + s.x, fy + (ty - fy) * k, this.cz + s.z);
      blob.scale.setScalar(s.white ? 1.6 : 1);
    }
    for (const d of S.drops) {
      if (n >= this.blobs.length) break;
      const blob = this.blobs[n++];
      blob.visible = true;
      blob.material = this.blobMats.get(SIDES[d.faction].ramp)!;
      blob.position.set(this.cx + d.x, this.h.groundAt(this.cx + d.x, this.cz + d.z) + 40 + 3 * Math.sin(simTime * 4 + d.x), this.cz + d.z);
      blob.scale.setScalar(1.3);
    }
    for (; n < this.blobs.length; n++) this.blobs[n].visible = false;
  }

  /**
   * The duel's marks. The player's lock: a ring of white bubbles round the captain, facing the camera, closing as the hold fills, shut at the clack and doubled
   * at the full charge (the Bomb's ring's language). A captain that has the player: a line of beads in its colour running from it to the bus, each bead sized by
   * how far it is so the line is a few pixels wide near and far, and spaced evenly on the screen.
   */
  private drawDuel(camera: THREE.Camera, simTime: number): void {
    const R = recessScreen, D = this.duel, f = this.h.flight, m = this.m4, v = this.v3, play = this.phase === 'play';
    const cam = camera as THREE.PerspectiveCamera, e = cam.matrixWorld.elements;
    // (m a CSS pixel at 1 m from the camera, and how far ahead of it a point is)
    const px = (2 * Math.tan(((cam.fov ?? 42) * Math.PI) / 360)) / (typeof innerHeight === 'number' ? innerHeight : 852);
    const depth = (p: THREE.Vector3) => -((p.x - e[12]) * e[8] + (p.y - e[13]) * e[9] + (p.z - e[14]) * e[10]);
    const ring = this.lockRing;
    // (nothing compiles in flight: each is drawn once, one bead of no size, in the page's first frames)
    if (this.beadsWarm > 0) {
      this.beadsWarm--;
      for (const b of [ring, ...this.lines]) {
        if (!b) continue;
        b.setMatrixAt(0, m.makeScale(0, 0, 0));
        b.count = 1;
        b.visible = true;
        b.instanceMatrix.needsUpdate = true;
      }
      return;
    }
    if (ring) {
      const id = D.locked, fill = D.clacked ? 1 : D.holding ? Math.min(1, D.held / duelTune.lockAt) : 0;
      ring.visible = play && id > 0 && fill > 0;
      if (ring.visible) {
        const c = D.at(id, this.v3b), d = Math.max(1, depth(c)), n = R.lockBubbles, twice = D.charged;
        const r = Math.max(((this.models[id]?.length ?? 16) / 2) * (R.lockOpen + (R.lockShut - R.lockOpen) * fill * fill), R.lockMinPx * px * d * (R.lockOpen + (R.lockShut - R.lockOpen) * fill) / R.lockShut);
        // (it turns as it closes, and stands still once it's shut; a pulse at the clack is the scale's)
        const spin = (1 - fill) * 2.4, size = R.lockSize * 0.5 * px * d * (D.clacked ? 1.25 : 1);
        this.camX.set(e[0], e[1], e[2]);
        this.camY.set(e[4], e[5], e[6]);
        for (let k = 0; k < n * 2; k++) {
          const a = spin + (k / n) * Math.PI * 2, rr = k < n ? r : r * R.lockTwice;
          v.copy(c).addScaledVector(this.camX, Math.cos(a) * rr).addScaledVector(this.camY, Math.sin(a) * rr);
          ring.setMatrixAt(k, m.makeScale(size, size, size).setPosition(v));
        }
        ring.count = twice ? n * 2 : n;
        ring.instanceMatrix.needsUpdate = true;
      }
    }
    for (const b of this.sim.buses) {
      const line = this.lines[b.id];
      if (!line) continue;
      line.visible = play && D.aimedBy(b.id);
      if (!line.visible) continue;
      const from = D.at(b.id, this.v3b), n = R.lineBeads, da = Math.max(2, depth(from));
      v.set(f.x, f.y, f.z);
      const db = Math.max(2, depth(v)), len = from.distanceTo(v), run = (simTime * R.lineRun) % 1;
      let c = 0;
      for (let k = 0; k < n; k++) {
        // (even on the screen: the share of the way there in the world that's this share of the way on the screen; and none inside the bus)
        const s = (k + run) / n, u = (s * da) / ((1 - s) * db + s * da);
        if ((1 - u) * len < 14) continue;
        v.set(from.x + (f.x - from.x) * u, from.y + (f.y - from.y) * u, from.z + (f.z - from.z) * u);
        const d = depth(v);
        if (d < 1) continue;
        const size = R.lineSize * 0.5 * px * d;
        line.setMatrixAt(c++, m.makeScale(size, size, size).setPosition(v));
      }
      line.count = c;
      line.instanceMatrix.needsUpdate = true;
    }
  }

  private altFor(ax: number, az: number, x = ax, z = az): number {
    const R = recessScreen, h = this.h;
    return Math.max(h.groundAt(x, z) + R.captainAGL, h.obstacleAt(x, z) + R.captainClear, h.obstacleAt(ax, az) + R.captainClear);
  }

  /** A word for the player, the more important over the less, none over a more important one still up. */
  private say(lines: string[], seconds: number, rank: number): void {
    if (this.now < this.saidAt && rank < this.saidRank) return;
    this.said = lines.join(' / ');
    this.saidAt = this.now + seconds;
    this.saidRank = rank;
    this.h.toast(lines, seconds);
  }

  private count(k: string): void {
    this.counts[k] = (this.counts[k] ?? 0) + 1;
  }

  // ---- the clock and the score, top middle ----

  private makeHud(): void {
    // (the safe area's top, px: a chevron keeps under it, and under the clock)
    const probe = document.createElement('div');
    Object.assign(probe.style, { position: 'fixed', top: '0', height: 'env(safe-area-inset-top)', visibility: 'hidden' });
    document.body.append(probe);
    this.safeTop = probe.offsetHeight || 0;
    probe.remove();
    const d = document.createElement('div');
    // (under the words' slot, which ends at most 103 px under the safe area's top (hudLayout.ts: the toast at T + 54, 44 high): the day review's M61)
    Object.assign(d.style, { position: 'fixed', left: '50%', top: `calc(env(safe-area-inset-top) + ${recessScreen.clockTop}px)`, transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: '21' });
    d.dataset.hud = 'recess';
    document.body.append(d);
    this.hud = d;
  }

  /** '+' after a faction's score while a god of its stands. */
  private godOf(f: number): string {
    return this.hearts.some((h) => h.stage === 5 && h.faction === f) ? '+' : '';
  }

  /** The captains' tags: over one on screen its name and distance in its colour; for one off it, a chevron at the screen's edge pointing to it, with its
   *  distance; and a white chevron for a breath coming at the player from off screen (SHOTS.md, "Edge markers"). */
  private drawTags(camera: THREE.Camera): void {
    if (!this.tags.length) return;
    const W = window.innerWidth, H = window.innerHeight, me = this.sim.buses[0], over = this.phase === 'over', at = this.tagAt;
    let shown = 0;
    for (const tag of this.tags) {
      let wx: number, wy: number, wz: number, d: number;
      if (tag.id >= 0) {
        const b = this.sim.buses[tag.id];
        wx = this.cx + b.x;
        wz = this.cz + b.z;
        wy = this.ys[b.id] + 14;
        d = Math.hypot(b.x - me.x, b.z - me.z);
      } else {
        // (a shot coming at the bus from off the screen: the white chevron, with how far)
        const s = this.duel.incoming.find((x) => x.shot && !x.shot.done)?.shot;
        if (!s || over) {
          tag.hide();
          continue;
        }
        wx = s.pos.x;
        wz = s.pos.z;
        wy = s.pos.y;
        d = Math.hypot(wx - this.cx - me.x, wz - this.cz - me.z);
      }
      if (over) {
        tag.hide();
        continue;
      }
      const v = this.v3.set(wx, wy, wz).project(camera), behind = v.z > 1;
      let x = v.x, y = v.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.92;
      if (onScreen && tag.id < 0) {
        tag.hide();
        continue;
      }
      // (a captain that has the player: its tag flashes)
      tag.flash(tag.id > 0 && this.duel.aimedBy(tag.id) && Math.floor(this.now * recessScreen.lineFlash * 2) % 2 === 1);
      let sx = (x * 0.5 + 0.5) * W, sy = (0.5 - y * 0.5) * H, angle: number | null = null;
      if (!onScreen) {
        // (to the edge, along the way it lies from the middle, inside a frame clear of the status bar and the clock above and the thumb below: the day review's
        // M46. The arrow points at it, angle up positive; the name stays level)
        const R = recessScreen, top = this.safeTop + R.tagTop, bot = H * R.tagBottom, cx = W / 2, cy = H / 2, dx = x * W, dy = -y * H;
        const k = Math.min(dx > 0 ? (W - R.tagSide - cx) / dx : dx < 0 ? (R.tagSide - cx) / dx : Infinity, dy > 0 ? (bot - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity);
        sx = cx + dx * k;
        sy = cy + dy * k;
        angle = Math.atan2(y * H, x * W);
        // (the shot's chevron on its captain's, both behind the bus: a row nearer the middle, so each is read. The captains' tags come first)
        if (tag.id < 0) for (let j = 0; j < shown; j++) if (Math.abs(sx - at[j * 2]) < R.tagWide && Math.abs(sy - at[j * 2 + 1]) < R.tagTall) sy += sy > cy ? -R.tagTall : R.tagTall;
      }
      if (tag.id >= 0 && shown * 2 < at.length) {
        at[shown * 2] = sx;
        at[shown * 2 + 1] = sy;
        shown++;
      }
      tag.show(sx, sy, angle, d);
    }
  }

  private drawHud(): void {
    if (!this.hud) return;
    const s = this.sim.score(), left = this.phase === 'ready' ? this.length : Math.max(0, this.length - this.sim.t);
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    const me = this.sim.buses[0];
    const gear = me.state === 'ride' ? `NO BRAKES ${GEAR_NAMES[this.hitGear]}` : '';
    const big = this.phase === 'over';
    const rows: { t: string; c: number }[] = big
      ? [Faction.RAINBOW, Faction.ATLANTIS, Faction.INFERNO].sort((p, q) => s[q] - s[p]).map((f) => ({ t: `${SIDES[f].name} ${s[f]}`, c: f === Faction.RAINBOW ? C.yellowHi : rgba(SIDES[f].ramp, 6) }))
      : [{ t: `${clock}  R ${s[Faction.RAINBOW]}${this.godOf(Faction.RAINBOW)}  A ${s[Faction.ATLANTIS]}${this.godOf(Faction.ATLANTIS)}  I ${s[Faction.INFERNO]}${this.godOf(Faction.INFERNO)}`, c: C.text }, ...(gear ? [{ t: gear, c: C.red }] : [])];
    const key = rows.map((r) => r.t).join('|');
    if (key === this.hudText) return;
    this.hudText = key;
    const w = Math.max(...rows.map((r) => textWidth(r.t, HUD_FONT))) + 8, c = new PixelCanvas(w, rows.length * 10 + 4, 2);
    c.clear();
    rows.forEach((r, i) => c.textOutlined(r.t, Math.round((w - textWidth(r.t, HUD_FONT)) / 2), 2 + i * 10, r.c, C.ink, HUD_FONT));
    c.flush();
    this.hud.replaceChildren(c.el);
  }
}

export function bootRecess(h: RecessHost): RecessGame {
  return new RecessGame(h);
}

/** A captain's ribbon of its paint (SHOTS.md, "Easier to see"): the last 4 s of where it flew, a flat band behind it in its colour. One draw a captain. */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly pts: Float32Array;
  private readonly pos: Float32Array;
  private n = 0;
  private lastT = -Infinity;

  constructor(ramp: number) {
    const R = recessScreen, N = Math.round(R.ribbon / R.ribbonStep) + 1;
    this.pts = new Float32Array(N * 3);
    this.pos = new Float32Array(N * 2 * 3);
    const geo = new THREE.BufferGeometry(), idx: number[] = [];
    for (let i = 0; i < N - 1; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 2 * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    this.mesh = new THREE.Mesh(geo, makeRampMaterial({ ramp, glow: 0.45, noOutline: true, shadowMul: 0, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.name = 'RecessRibbon';
  }

  /** The captain is at (x, y, z) at game time t: a point every ribbonStep s, the newest first, and the band laid along them. */
  update(x: number, y: number, z: number, t: number): void {
    const R = recessScreen, P = this.pts, N = P.length / 3;
    if (t - this.lastT >= R.ribbonStep) {
      this.lastT = t;
      P.copyWithin(3, 0, (N - 1) * 3);
      this.n = Math.min(N, this.n + 1);
    }
    P[0] = x;
    P[1] = y;
    P[2] = z;
    const V = this.pos, w = R.ribbonW / 2;
    for (let i = 0; i < N; i++) {
      const j = Math.min(i, this.n - 1), a = Math.max(0, j - 1), b = Math.min(this.n - 1, j + 1);
      let dx = P[a * 3] - P[b * 3], dz = P[a * 3 + 2] - P[b * 3 + 2];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      // (narrowing to nothing at its oldest end)
      const k = w * (1 - j / Math.max(1, N - 1));
      V[i * 6] = P[j * 3] - dz * k;
      V[i * 6 + 1] = P[j * 3 + 1] - 1.5;
      V[i * 6 + 2] = P[j * 3 + 2] + dx * k;
      V[i * 6 + 3] = P[j * 3] + dz * k;
      V[i * 6 + 4] = P[j * 3 + 1] - 1.5;
      V[i * 6 + 5] = P[j * 3 + 2] - dx * k;
    }
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** The fence (SHOTS.md): chalk bubbles round the arena's edge, in rows over the ground there. One draw. */
/** A god's ring: `ringBubbles` bubbles round its heart, from the north clockwise, drawn as many as have closed (InstancedMesh.count). */
function makeRing(): THREE.InstancedMesh {
  const R = recessScreen, n = R.ringBubbles;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(R.ringSize, 0), makeRampMaterial({ ramp: Ramp.GLOW_WHITE, glow: 0.6, noOutline: true, shadowMul: 0 }), n);
  const m = new THREE.Matrix4();
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (k / n) * Math.PI * 2;
    mesh.setMatrixAt(k, m.makeTranslation(Math.cos(a) * R.ringR, 0, Math.sin(a) * R.ringR));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.name = 'RecessRing';
  return mesh;
}

/** A pool of bubbles placed each frame (the lock's ring, a captain's line at the player): 1 m round, scaled to a few pixels where they are. */
function makeBeads(ramp: number, n: number, name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), makeRampMaterial({ ramp, glow: 0.6, noOutline: true, shadowMul: 0 }), n);
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.name = name;
  return mesh;
}
function makeFence(cx: number, cz: number, groundAt: (x: number, z: number) => number): THREE.InstancedMesh {
  const R = recessScreen, r = recessTune.radius, per = Math.round((Math.PI * 2 * r) / R.fenceStep), rows = R.fenceRows;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0), makeRampMaterial({ ramp: Ramp.GLOW_WHITE, glow: 0.35, noOutline: true, shadowMul: 0 }), per * rows.length);
  const m = new THREE.Matrix4();
  let i = 0;
  for (let k = 0; k < per; k++) {
    const a = (k / per) * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, g = groundAt(x, z);
    rows.forEach((h, row) => m.makeTranslation(x, g + h + ((k * 7 + row * 3) % 5) * 1.5, z) && mesh.setMatrixAt(i++, m));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.name = 'RecessFence';
  return mesh;
}
