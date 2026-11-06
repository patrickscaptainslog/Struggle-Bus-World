// ?recess on screen (FACTIONS.md section 4, the bots demo; docs/specs/factions/BUILT.md): the player's real bus against two AI captains in a 1.5 km circle of
// the street, three minutes between two bells, and at the bell the camera rises to 1,500 m and the painted map is the scoreboard. The rules are the headless
// brain's (recess.ts, captain.ts), stepped at its own fixed step; the player's bus is its bus 0, placed from the real flight each step. What this adds is the
// picture: the captains as buses in their colours, their breaths, their paint on the real city (plain paint in one hue a faction, until the stages' looks land),
// Possessed on the real flight (Nonstop, NO BRAKES, the hiccups on the beat), the flick in a breath's white-hot that hops out of it, the clock and the score.
// Territory is the brain's three camps of about 36 squares (neighbourhoods.ts) until the first account's neighbourhood files land.
//
// Under the flag only, a chunk of its own; its meshes are the bus's and a toon blob, so it compiles nothing the street doesn't (the warm-up sees them first).
// Not here yet: the faction's ornate buses, the stages' looks, a Heart's look, a second phone, the real MEGA meter for Piñata's drops (the brain counts them).

import * as THREE from 'three';
import { BusModel, type BusPose } from '../bus/BusModel';
import { config } from '../config';
import { Faction } from '../factions/areas';
import type { Flight } from '../game/Flight';
import { latLonToLocal } from '../game/geo';
import type { MoverAim, MoverTarget } from '../game/Aim';
import type { BarfOpts } from '../game/Splat';
import { GEAR_NAMES } from '../game/Turbo';
import { makeRampMaterial } from '../render/materials';
import { Ramp } from '../render/palette';
import { C, HUD_FONT, PixelCanvas, rgba, textWidth } from '../ui/pixelUi';
import { Captain } from './captain';
import { Recess, recessTune, type Level, type Mode } from './recess';

/** The factions on the field: the player's Rainbow (its own dealt hues), and the two captains in one hue each, Atlantis blue and Inferno red (decision 21). */
const SIDES: Record<number, { name: string; solo?: number; ramp: number }> = {
  [Faction.RAINBOW]: { name: 'RAINBOW', ramp: Ramp.BUS_YELLOW },
  [Faction.ATLANTIS]: { name: 'ATLANTIS', solo: 4, ramp: Ramp.BLUE },
  [Faction.INFERNO]: { name: 'INFERNO', solo: 0, ramp: Ramp.RED },
};

export const recessScreen = {
  /** s of the first bell's words before the clock starts */
  ready: 2.5,
  /** the camera's climb at the bell (s), and how high over the arena's ground it goes (m) */
  rise: 4,
  scoreboard: 1500,
  /** the captains fly this high over the ground, and this over what's under them and ahead (m) */
  captainAGL: 45,
  captainClear: 22,
};

/** The arena (FACTIONS.md section 4: "a 1.5 km circle the game picks where any city is densest"): San Francisco's where Alamo Square, the Lower Haight and Hayes
 *  Valley meet, the three the plan names; another city's its start; ?lat&lon's there. Its middle on the squares' grid, so the brain's squares are the city's. */
export function arenaFor(manifest: { slug: string; origin: readonly number[]; start: { x: number; z: number } }, params: URLSearchParams, flight: Flight): { cx: number; cz: number } {
  // (and puts the bus at its start there)
  let x = manifest.start.x, z = manifest.start.z;
  if (params.has('lat') && params.has('lon')) [x, z] = [flight.x, flight.z];
  else if (manifest.slug === 'sf') [x, z] = latLonToLocal(37.7745, -122.43, manifest.origin);
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
  private readonly target: MoverTarget = { mover: true, key: '', x: 0, y: 0, z: 0, arrive: 0, pickR: 0, onLine: true };
  private glintKey: string | null = null;
  private now = 0;
  private acc = 0;
  private readonly pending: { x: number; z: number; at: number }[] = [];
  private hopLeft = 0;
  private hopWay = 1;
  private bubbleAt: { x: number; z: number } | null = null;
  private saidAt = -Infinity;
  private saidRank = 0;
  private outAt = -Infinity;
  private hud: HTMLDivElement | null = null;
  private hudText = '';
  private readonly pose: BusPose = { squash: 1, eye: 1, fullness: 1, mouth: 0, speed: 0, wheeze: 0, heave: 0 };
  private readonly eul = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly camFrom = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private readonly camTo = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private readonly m4 = new THREE.Matrix4();
  /** QA: the captains' last paint on the city, where and in what hue, landing when */
  readonly painted: { x: number; z: number; hue: number; at: number }[] = [];
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
    // (the player is bus 0, placed from the real flight; a new player's shield only with &newcomer: Recess is where Possessed is learned)
    this.sim = new Recess([{ faction: Faction.RAINBOW, newcomer: p.has('newcomer') }, { faction: Faction.ATLANTIS, bot: bots[0] }, { faction: Faction.INFERNO, bot: bots[1] }], { mode, log: false });
    this.sim.buses[0].external = true;
    bots.forEach((b, i) => this.captains.push(new Captain(b, 0x5eed + i * 101)));
    for (const b of this.sim.buses) {
      if (b.id === 0) {
        this.models.push(null);
        this.ys.push(h.flight.y);
        continue;
      }
      const bus = new BusModel();
      // (the captain's bus in its faction's colour: the yellow's ramp swapped)
      const ramp = bus.mesh.geometry.getAttribute('ramp') as THREE.BufferAttribute;
      for (let i = 0; i < ramp.count; i++) if (ramp.getX(i) === Ramp.BUS_YELLOW) ramp.setX(i, SIDES[b.faction].ramp);
      ramp.needsUpdate = true;
      bus.root.name = `RecessCaptain${b.id}`;
      h.scene.add(bus.root);
      this.models.push(bus);
      this.ys.push(this.altFor(b.x + this.cx, b.z + this.cz));
    }
    // (breaths in flight and Piñata's drops: toon blobs, one material a hue and a white-hot one)
    const geo = new THREE.IcosahedronGeometry(3.2, 1);
    for (const ramp of [Ramp.BUS_YELLOW, Ramp.BLUE, Ramp.RED, Ramp.GLOW_WHITE]) this.blobMats.set(ramp, makeRampMaterial({ ramp, glow: 0.7, noOutline: true, shadowMul: 0 }));
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(geo, this.blobMats.get(Ramp.BUS_YELLOW)!);
      mesh.visible = i === 0;
      mesh.position.set(h.flight.x, h.flight.y - 400, h.flight.z);
      mesh.frustumCulled = false;
      mesh.name = 'RecessBlob';
      h.scene.add(mesh);
      this.blobs.push(mesh);
    }
    if (typeof document !== 'undefined') this.makeHud();
    (globalThis as { __recess?: RecessGame }).__recess = this;
  }

  // ---- the aim (Aim.ts's mover hand): the captain bus 0's lock is on glints, and a tap goes at it ----

  ours(key: string): boolean {
    return key.startsWith('recess:');
  }

  aim(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pickR: number, travel: number): MoverTarget | null {
    const me = this.sim.buses[0];
    if (this.phase === 'play' && me.lock >= 0 && this.sim.buses[me.lock].faction !== me.faction) {
      const v = this.sim.buses[me.lock], d = Math.hypot(v.x - me.x, v.z - me.z), fly = recessTune.breathMin + d / recessTune.breathSpeed;
      const t = this.target;
      t.key = `recess:${v.id}`;
      t.x = this.cx + v.x + Math.cos(v.heading) * v.speed * fly;
      t.z = this.cz + v.z + Math.sin(v.heading) * v.speed * fly;
      t.y = this.ys[v.id];
      t.arrive = this.now + fly;
      t.pickR = pickR;
      return t;
    }
    return this.life ? this.life.aim(ox, oy, oz, dx, dy, dz, pickR, travel) : null;
  }

  glint(key: string | null): void {
    this.glintKey = key && this.ours(key) ? key : null;
    this.life?.glint(key && this.ours(key) ? null : key);
  }

  /** The player's breath at a captain, let go now, landing at game time `arrive`. */
  playerFire(key: string, arrive: number): void {
    if (this.phase !== 'play') return;
    this.sim.fireAt(0, Number(key.slice(7)), arrive - this.t0);
  }

  /** The player's breath on the city, landing at (x, z) at game time `arrive`: the square there takes Rainbow's hit then. */
  playerPaint(x: number, z: number, arrive: number): void {
    if (this.phase !== 'play') return;
    this.pending.push({ x: x - this.cx, z: z - this.cz, at: arrive - this.t0 });
  }

  /** A flick, before the gears see it: in a breath's white-hot it hops out of it; in a ride it only wheezes. True: taken. */
  flick(dir: 1 | -1): boolean {
    if (this.phase !== 'play') return false;
    const me = this.sim.buses[0];
    if (this.sim.breaths.some((s) => s.target === 0 && s.white) && this.hopLeft <= 0 && me.state !== 'bubble') {
      this.hopLeft = recessTune.hopTime;
      this.hopWay = dir > 0 ? 1 : -1;
      this.count('hop');
      return true;
    }
    if (me.state === 'ride') {
      if (dir < 0) this.say(['NO BRAKES'], 1.2, 2);
      return true;
    }
    return me.state === 'bubble';
  }

  // ---- the frame ----

  frame(dt: number, simTime: number, camera: THREE.Camera): void {
    this.now = simTime;
    const f = this.h.flight;
    if (Number.isNaN(this.t0)) {
      this.t0 = simTime + recessScreen.ready;
      this.say(['RECESS!', 'PAINT THE MOST BEFORE THE BELL'], recessScreen.ready + 1, 3);
    }
    if (this.phase === 'ready' && simTime >= this.t0) {
      this.phase = 'play';
      this.say(['DING DING DING', `${Math.round(this.length / 60) || 1} MINUTES`], 2, 3);
    }
    if (this.phase === 'play') {
      // (the brain at its own step, the player's bus placed from the flight before each)
      this.acc += dt;
      const step = this.sim.dt;
      while (this.acc >= step && this.phase === 'play') {
        this.acc -= step;
        this.place(f);
        const hands = this.sim.buses.map((b) => (b.id === 0 ? { steer: 0, tap: false, flick: 0 } : this.captains[b.id - 1].think(this.sim, b)));
        this.sim.step(hands);
        for (let i = this.pending.length - 1; i >= 0; i--) {
          const p = this.pending[i];
          if (this.sim.t < p.at) continue;
          this.sim.areas.hit(p.x, p.z, Faction.RAINBOW, this.sim.t);
          this.pending.splice(i, 1);
        }
        this.events();
        if (this.sim.t >= this.length) this.bell(simTime);
      }
      this.player(dt, f);
    }
    this.draw(dt, simTime);
    if (this.phase === 'over') this.scoreboard(simTime, camera);
    this.drawHud();
  }

  /** Bus 0 where the real flight is. */
  private place(f: Flight): void {
    const b = this.sim.buses[0];
    b.x = f.x - this.cx;
    b.z = f.z - this.cz;
    b.heading = f.heading - Math.PI / 2;
    b.speed = f.speed;
    if (b.state === 'bubble' && this.bubbleAt) {
      b.x = this.bubbleAt.x - this.cx;
      b.z = this.bubbleAt.z - this.cz;
    }
  }

  /** The player's own bus: Possessed holds Nonstop, a hop slides it, a bubble holds it still; out of the circle, a word. */
  private player(dt: number, f: Flight): void {
    const me = this.sim.buses[0], T = this.h.turbo;
    if (me.state === 'ride') {
      const want = recessTune.rideGear;
      if (T.gear < want) T.shift(1, f);
      else if (T.gear > want) T.shift(-1, f);
    }
    if (this.hopLeft > 0) {
      const k = (Math.min(dt, this.hopLeft) / recessTune.hopTime) * recessTune.hop * this.hopWay;
      f.x += Math.cos(f.heading) * k;
      f.z += Math.sin(f.heading) * k;
      this.hopLeft -= dt;
    }
    if (me.state === 'bubble') {
      this.bubbleAt ??= { x: f.x, z: f.z };
      f.x = this.bubbleAt.x;
      f.z = this.bubbleAt.z;
    } else this.bubbleAt = null;
    const r = Math.hypot(f.x - this.cx, f.z - this.cz);
    if (r > recessTune.radius * 1.05 && this.now - this.outAt > 4) {
      this.outAt = this.now;
      this.say(['BACK TO RECESS', 'THE BELL RINGS IN THERE'], 2, 1);
    }
  }

  /** The brain's events this step, onto the city and the screen. */
  private events(): void {
    const S = this.sim, sec = (id: number) => SIDES[S.buses[id].faction];
    for (const e of S.events) {
      this.count(e.kind);
      const a = e.a >= 0 ? S.buses[e.a] : null, b = e.b >= 0 ? S.buses[e.b] : null;
      switch (e.kind) {
        case 'fire':
          // (a captain's breath on the ground: its paint on the real city, in its one hue, landing when the brain's breath does)
          if (a && a.id !== 0 && e.b < 0) {
            const br = S.breathOf(a.id);
            if (br) this.paint(br.tx, br.tz, a.faction, br.arrive - S.t, this.ys[a.id]);
          }
          break;
        case 'hiccup':
          // (the ridden bus blasts its hitter's paint where it is, on the beat)
          if (a && b) this.paint(b.x, b.z, a.faction, 0.3, b.id === 0 ? this.h.flight.y : this.ys[b.id], 0.7);
          break;
        case 'hit':
        case 'lesson':
          if (b) this.flash(b.id);
          if (b?.id === 0) this.say(e.kind === 'lesson' ? ['A LESSON', 'THEY GLINT BEFORE THEY BREATHE'] : ['NO BRAKES', `${sec(e.a).name} HAS YOUR BUS`], 2.4, 3);
          else if (a?.id === 0) this.say(['GOTCHA', `${sec(e.b).name} PAINTS RAINBOW`], 2, 3);
          break;
        case 'whiteHot':
          if (e.b === 0) this.say(['FLICK!'], 0.6, 2);
          break;
        case 'glint':
          if (e.b === 0 && a && a.id !== 0) this.say([`${sec(a.id).name} HAS YOU`], 0.9, 1);
          break;
        case 'sparkle':
          if (e.b === 0) this.say(['SPARKLES', 'NEW BUSES ARE SHIELDED'], 1.2, 2);
          break;
        case 'rideEnd':
          if (e.b === 0) this.say(['STOP ARM OUT', 'NOW GET THEM BACK'], 2, 2);
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

  /** Paint on the real city at brain point (x, z), `faction`'s: Rainbow's dealt hues, a captain's one. */
  private paint(x: number, z: number, faction: number, travel: number, fromY: number, size = 1): void {
    const wx = this.cx + x, wz = this.cz + z, side = SIDES[faction];
    const drop = Math.max(0, fromY - this.h.groundAt(wx, wz));
    if (side.solo !== undefined) {
      this.painted.push({ x: wx, z: wz, hue: side.solo, at: this.now + travel });
      if (this.painted.length > 64) this.painted.shift();
    }
    this.h.barf(wx, wz, { travel: Math.max(0.05, travel), drop, from: fromY, solo: side.solo, faction, ...(size !== 1 ? { radius: config.splat.blastRadius * size, hitStop: 0 } : {}) });
  }

  /** A hit's flash on bus `id`, in the air where it is. */
  private flash(id: number): void {
    const b = this.sim.buses[id], y = id === 0 ? this.h.flight.y : this.ys[id], wx = this.cx + b.x, wz = this.cz + b.z;
    this.h.barf(wx, wz, { travel: 0.02, mover: { x: wx, y, z: wz }, moverFresh: false });
  }

  /** The last bell: the brain stops, and the camera goes up to see the map. */
  private bell(simTime: number): void {
    this.phase = 'over';
    this.overAt = simTime;
    // (recess is over: the gears back to Cruise)
    for (let k = 0; k < 8 && this.h.turbo.gear > 0; k++) this.h.turbo.shift(-1, this.h.flight);
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
      const p = this.pose, glint = this.glintKey === `recess:${b.id}`;
      p.speed = b.speed;
      p.fullness = S.t >= b.belly ? 1 : 0.3;
      p.wheeze = b.state === 'ride' ? 0.8 : 0;
      p.squash = b.state === 'ride' ? 1 + 0.12 * Math.sin(S.beat.phase(S.t) * Math.PI * 2) : glint ? 1 + 0.1 * Math.sin(simTime * 18) : 1;
      p.eye = b.state === 'shield' ? 0.2 : 1;
      m.update(dt, simTime, p);
      const hg = b.heading + Math.PI / 2, bank = Math.max(-0.5, Math.min(0.5, (b.driverYaw + b.edgeYaw) * 0.45));
      m.root.quaternion.setFromEuler(this.eul.set(0, -hg, -bank, 'YXZ'));
      m.root.position.set(wx, this.ys[b.id], wz);
      m.root.scale.setScalar(glint ? 1.12 : 1);
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

  private altFor(ax: number, az: number, x = ax, z = az): number {
    const R = recessScreen, h = this.h;
    return Math.max(h.groundAt(x, z) + R.captainAGL, h.obstacleAt(x, z) + R.captainClear, h.obstacleAt(ax, az) + R.captainClear);
  }

  /** A word for the player, the more important over the less, none over a more important one still up. */
  private say(lines: string[], seconds: number, rank: number): void {
    if (this.now < this.saidAt && rank < this.saidRank) return;
    this.saidAt = this.now + seconds;
    this.saidRank = rank;
    this.h.toast(lines, seconds);
  }

  private count(k: string): void {
    this.counts[k] = (this.counts[k] ?? 0) + 1;
  }

  // ---- the clock and the score, top middle ----

  private makeHud(): void {
    const d = document.createElement('div');
    Object.assign(d.style, { position: 'fixed', left: '50%', top: 'calc(env(safe-area-inset-top) + 64px)', transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: '21' });
    d.dataset.hud = 'recess';
    document.body.append(d);
    this.hud = d;
  }

  private drawHud(): void {
    if (!this.hud) return;
    const s = this.sim.score(), left = this.phase === 'ready' ? this.length : Math.max(0, this.length - this.sim.t);
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    const me = this.sim.buses[0];
    const gear = me.state === 'ride' ? `NO BRAKES ${GEAR_NAMES[recessTune.rideGear]}` : '';
    const big = this.phase === 'over';
    const rows: { t: string; c: number }[] = big
      ? [Faction.RAINBOW, Faction.ATLANTIS, Faction.INFERNO].sort((p, q) => s[q] - s[p]).map((f) => ({ t: `${SIDES[f].name} ${s[f]}`, c: f === Faction.RAINBOW ? C.yellowHi : rgba(SIDES[f].ramp, 6) }))
      : [{ t: `${clock}  R ${s[Faction.RAINBOW]}  A ${s[Faction.ATLANTIS]}  I ${s[Faction.INFERNO]}`, c: C.text }, ...(gear ? [{ t: gear, c: C.red }] : [])];
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
