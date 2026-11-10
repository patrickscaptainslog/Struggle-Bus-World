import * as THREE from 'three';
import { LOOKAHEAD, type Kit } from '../audio/dsp';
import { BusModel, type BusPose } from '../bus/BusModel';
import type { Flight } from '../game/Flight';
import type { Holds } from '../game/Hold';
import type { BarfOpts } from '../game/Splat';
import { paradeHonk } from '../life/paradeSfx';
import { Tag } from '../recess/tag';
import { makeRampMaterial } from '../render/materials';
import { Ramp } from '../render/palette';
import { rgba } from '../ui/pixelUi';
import { registerTunables } from '../ui/tunables';
import { Rivals, rivalTune, RState, type Me, type Rival, type RivalWorld } from './rivals';
import { headOnBoom, ramClang, rivalHonk } from './rivalsSfx';
import { shellAt, shellBack, shellBetween } from './shell';

// The rival buses on the screen (docs/specs/factions/RAMPAGE.md, sections 2 and 3). Their brain and the rules are rivals.ts, which the harness flies in Node;
// this draws them and gives them hands. Under ?swerve, with the handling (main.ts); &norivals leaves them out.
//
//  - Their buses are the player's own model in each crew's body colour, a little bigger. The city has a score of them and each is about its own business
//    wherever it is; the nearest few are drawn, and those within `tagFar` wear a tag (its crew and how far), a chevron at the screen's edge for one off it,
//    flashing for one that has started on the player. One near enough to see paints for real, in its crew's look; further off the tiles aren't there to paint.
//  - The shell. With a full belly and a rival in front, a ring of beads stands round it: a tap then goes for it (`tap`, asked before the splat), a homing shot of
//    the shot code's (Holds.fire). It soaks the rival: thrown, tumbling, in the player's colours, and where it comes down the player's paint lands. Rivals
//    fire the same shot at each other, now and then, and at the player.
//  - Being hit, by a rival's shell or a ram: the hitter's colours flood the player's bus from the nose, it's thrown along the hit's line and rolls, over
//    whatever stands in the way (the flight's own floor is lifted under it, `pre`), and it's the player's again all the way through: the stick never lets go.
//  - The ram, by its tier: a clang, a kick, a held beat (`timeScale`), the word for it, the rammer's paint on the city under it.
//  - The head-on: in the last half second before two buses meet nose to nose at over 500 m/s time runs at a quarter and the view stands back; swerve then and
//    the screen says CHICKEN!. Neither does: a white beat, rings of both crews' paint racing out at the speed of sound, a crater of both, and both blown back.
//  - Where the player's own paint lands is told to the brain (`heard`), as a rival's is: another crew's bus may come and see about it, as a player would.
//
// main.ts: pre() before the flight's steps; frame() late in the frame, after the bus is posed and the camera set; tap() before a tap splats; quiet() for a
// blast the player didn't fire; timeScale() over the frame's step.

/** The tag a rival's own blast carries: main.ts's impact plays no flash, kick, sign or sound for it, as for a captain's. */
export const QUIET_RIVAL = { rivals: 'quiet' } as const;

const BODY: Record<number, number> = { 1: Ramp.BUS_YELLOW, 2: Ramp.TEAL, 3: Ramp.MOSS, 4: Ramp.MAGENTA, 5: Ramp.CRIMSON };
const NAME: Record<number, string> = { 1: 'RAINBOW', 2: 'ATLANTIS', 3: 'ELDERWOOD', 4: 'HYPERGLOW', 5: 'INFERNO' };
const WORD = ['BUMP!', 'SMASH!', 'WRECK!', 'HEAD-ON!'];

/** Live-tunable looks (tuner group "Rivals", with the rules'). */
export const rivalScreen = {
  /** a rival's bus against the player's */
  scale: 1.15,
  /** one is drawn out to this far (m), the nearest four of them, and wears a tag out to this far, further at speed; within `paintFar` its taps paint, and
   *  within `honkFar` its horn is heard */
  drawFar: 2600,
  tagFar: 2400,
  paintFar: 1500,
  honkFar: 900,
  /** being hit: the hitter's colours flood the bus in this long and drain in this long (s) */
  flood: 0.3,
  drain: 0.5,
  /** a ram by its tier: the beat it holds (s), the view's kick, the splash under it (m round) */
  stop: [0.04, 0.09, 0.15, 0.28],
  kick: [0.5, 1.3, 2.1, 3.2],
  splash: [0, 60, 125, 125],
  /** where a soaked rival comes down, the player's paint lands: this far round (m), by what threw it (a shell or a wave, a smash, a wreck, the head-on) */
  land: [50, 85, 125, 125],
  /** the head-on: time runs at this for its last `slowFor` s, the view stands back this far (m); its rings go out to `ring` m in bands `band` m wide */
  slow: 0.25,
  slowFor: 0.5,
  pull: 110,
  ring: 1000,
  band: 200,
  crater: 110,
};

export interface RivalsDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  flight: Flight;
  /** the player's bus: its colours flood with a hitter's, and it rolls when it's flung */
  bus: BusModel;
  holds: Holds;
  /** the nose off the bus's way (rad): ?swerve's skid */
  slip(): number;
  /** the city: its ground and roofs, its edges, and what of it is land */
  world: RivalWorld;
  barf(x: number, z: number, o: BarfOpts): void;
  /** the player's crew, and its next hue */
  faction(): number;
  hue(): number;
  particles: {
    palette: readonly number[];
    puff(pos: THREE.Vector3, vel: THREE.Vector3, ramp?: number, sizeK?: number, paint?: boolean): void;
    splash(pos: THREE.Vector3, hue: number, strength: number, delay?: number, count?: number): void;
  };
  kick(k: number): void;
  /** a white beat over the whole frame */
  flash(): void;
  /** the view stands back this far (m): CameraRig.matchPull */
  pull(m: number): void;
  kit(): Kit | null;
  toast(lines: string[], seconds: number): void;
  /** the hero's scale at this height (CameraRig.heroScale) */
  heroScale(): number;
  /** the player's bus's stop arm out for this long (s): a bump */
  arm(seconds: number): void;
}

interface Slot {
  bus: BusModel;
  orig: Float32Array;
  rival: Rival | null;
  /** the body's ramp as drawn */
  ramp: number;
  heading: number;
  bank: number;
  /** s its stop arm stays out (a bump) */
  arm: number;
}

/** How many of the city's buses are drawn at once: the nearest. */
const DRAWN = 4;

export class RivalsGame {
  readonly sim = new Rivals();
  /** the rules' numbers, and what happened, by name (tools read both) */
  readonly tune = rivalTune;
  readonly counts: Record<string, number> = {};
  private readonly slots: Slot[] = [];
  private readonly tags = new Map<number, Tag>();
  private readonly ring: THREE.InstancedMesh;
  private readonly me: Me = { x: 0, y: 0, z: 0, heading: 0, nose: 0, speed: 0, faction: 1, out: false };
  private readonly pose: BusPose = { squash: 1, eye: 0.8, fullness: 1, mouth: 0, speed: 0, wheeze: 0, heave: 0 };
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();
  private readonly eul = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly q = new THREE.Quaternion();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private now = 0;
  private pick: Rival | null = null;
  /** the nearest few, and how far each is, this frame */
  private readonly nearest: (Rival | null)[] = new Array<Rival | null>(DRAWN).fill(null);
  private readonly nearestD = new Float64Array(DRAWN);
  private breathing = false;
  /** the player's bus's own colours and where they sit along it, for the flood */
  private readonly busRamp: Float32Array;
  private readonly busZ: Float32Array;
  private busZmin = Infinity;
  private busZmax = -Infinity;
  private flood: { at: number; ramp: number; drainAt: number; shown: number } | null = null;
  /** the player flung: how far along (ux, uz), over how long, with how many rolls, how high */
  private readonly hurt = { on: false, t: 0, air: 1, far: 0, ux: 0, uz: 0, e: 0, rolls: 1, apex: 0, y0: 0 };
  private wobble = 0;
  private stopLeft = 0;
  /** the head-on coming: the rival, and the player's heading when time slowed */
  private slowWith: Rival | null = null;
  private slowHeading = 0;
  private pullNow = 0;
  /** the head-on's rings and crater still to land: when, how far out, and the line between the two crews' halves */
  private readonly rings: Array<{ at: number; inner: number; r: number; x: number; z: number; nx: number; nz: number; faction: number; jump: number }> = [];
  private honks = 0;
  private honkIn = 0;

  constructor(private readonly h: RivalsDeps) {
    const R = rivalScreen;
    registerTunables('Rivals', rivalTune as unknown as Record<string, unknown>, {
      count: [0, 32, 1], startNear: [0, 8, 1], startFrom: [100, 2000, 10], startTo: [300, 6000, 10], clear: [4, 60, 1], agile: [0.5, 4, 0.1], spool: [0.2, 4, 0.1], brake: [0.2, 4, 0.1],
      patch: [60, 800, 10], linger: [0, 10, 0.5], tripExpress: [300, 4000, 50], tripNonstop: [600, 8000, 50], weave: [0, 0.8, 0.01], toPaint: [0, 10, 0.5], toOwn: [0, 10, 0.5],
      hear: [500, 12000, 100], heardFor: [10, 600, 10], playEvery: [1, 12, 1], cone: [5, 60, 1], reach: [100, 1200, 10], shellSpeed: [150, 900, 10], shellTurn: [0.5, 6, 0.1],
      shellWhite: [0.1, 1.5, 0.05], backTurn: [0.5, 6, 0.1], backWhite: [0.1, 1.5, 0.05], dodge: [0, 1, 0.05], skidFor: [0.2, 1.5, 0.05], skidYaw: [0.5, 5, 0.1], honk: [0.2, 3, 0.1],
      huntFor: [5, 60, 1], shotEvery: [1.5, 12, 0.5], timid: [0, 1, 0.05], mischief: [0, 1, 0.05], eyeFor: [0.3, 5, 0.1], mischiefGap: [5, 120, 1], near: [500, 6000, 100],
      ramR: [6, 40, 1], ramUp: [4, 40, 1], ramRPer: [0, 0.1, 0.005], ramUpPer: [0, 0.1, 0.005], noseDeg: [20, 80, 1], line: [0, 30, 1], lineUp: [20, 600, 10], flingSec: [0.3, 3, 0.1], flingMax: [200, 3000, 50],
      soakThrow: [10, 300, 5], soakFor: [0, 20, 0.5],
    });
    registerTunables('Rivals on screen', rivalScreen as unknown as Record<string, unknown>, { scale: [0.6, 2.5, 0.05], drawFar: [500, 6000, 100], tagFar: [300, 6000, 50], paintFar: [300, 3000, 50], honkFar: [100, 3000, 50], slow: [0.05, 1, 0.05], slowFor: [0.1, 1.5, 0.05], pull: [0, 300, 5], ring: [200, 2000, 50], band: [60, 400, 10], crater: [40, 200, 5] });
    // (the buses: the player's own model, made before the warm-up reads the scene; a crew's colour goes on as one comes near enough to draw)
    for (let i = 0; i < DRAWN; i++) {
      const bus = new BusModel(1.6 * R.scale);
      const ra = bus.mesh.geometry.getAttribute('ramp') as THREE.BufferAttribute;
      bus.root.name = `Rival${i}`;
      bus.root.visible = false;
      h.scene.add(bus.root);
      this.slots.push({ bus, orig: Float32Array.from({ length: ra.count }, (_, k) => ra.getX(k)), rival: null, ramp: Ramp.BUS_YELLOW, heading: 0, bank: 0, arm: 0 });
    }
    // (the ring round what a tap goes for: a dozen white beads, a toon blob as a shot's is)
    this.ring = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), makeRampMaterial({ ramp: Ramp.GLOW_WHITE, glow: 0.6, noOutline: true, shadowMul: 0 }), 12);
    this.ring.count = 0;
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    this.ring.name = 'RivalRing';
    h.scene.add(this.ring);
    const ra = h.bus.mesh.geometry.getAttribute('ramp') as THREE.BufferAttribute, pa = h.bus.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.busRamp = Float32Array.from({ length: ra.count }, (_, i) => ra.getX(i));
    this.busZ = Float32Array.from({ length: pa.count }, (_, i) => pa.getZ(i));
    for (const z of this.busZ) {
      this.busZmin = Math.min(this.busZmin, z);
      this.busZmax = Math.max(this.busZmax, z);
    }
    this.sim.onEvent = (ev, r) => this.on(ev, r);
  }

  private count(k: string): void {
    this.counts[k] = (this.counts[k] ?? 0) + 1;
  }

  private kitNow(): [Kit, number] | null {
    const kit = this.h.kit();
    return kit ? [kit, kit.ctx.currentTime + LOOKAHEAD] : null;
  }

  /** The player's flight is out of it this frame (flung): nothing rams it or fires at it. */
  get out(): boolean {
    return this.hurt.on;
  }

  /** A blast of a rival's own: no flash, kick, sign or sound for it. */
  quiet(tag: unknown): boolean {
    return tag === QUIET_RIVAL;
  }

  /** Over the frame's step: 0 for a ram's held beat, a quarter in the head-on's last half second, else 1. On the wall clock. */
  timeScale(realDt: number): number {
    if (this.stopLeft > 0) {
      this.stopLeft -= realDt;
      return 0;
    }
    return this.slowWith ? rivalScreen.slow : 1;
  }

  /** A tap: with a full belly and a rival in front, the shell goes for it and the tap is spent. False: nobody in front, and it's the splat it always was. */
  tap(): boolean {
    const f = this.h.flight, r = this.pick;
    if (!r || !r.live || r.state === RState.Flung || f.fullness < 0.999 || f.barfT >= 0) return false;
    const faction = this.h.faction();
    const shot = this.h.holds.fire(
      shellAt(
        this.sim, r, f.speed,
        (at, s) => {
          this.sim.soak(r, s.dir.x, s.dir.z, faction);
          this.h.particles.splash(at, this.h.hue(), 2.2);
          this.h.kick(0.9);
          this.count('shellHit');
        },
        () => this.count('shellMiss'),
      ),
    );
    if (!shot) return false;
    this.sim.provoke(r);
    this.count('shell');
    return true;
  }

  /** ?swerve's wave landed at (x, z), this far round: every rival in it is soaked. */
  wave(x: number, z: number, radius: number): void {
    const n = this.sim.wave(x, z, radius, this.h.faction());
    if (n) this.count('waveHit');
  }

  /** Before the flight's steps: a flung bus flies over whatever stands in its way, on the flight's own floor lifted under it. */
  pre(): void {
    const H = this.hurt, f = this.h.flight;
    if (!H.on || H.apex <= 0) return;
    const u = Math.min(1, H.t / H.air);
    f.turbo.floor = Math.max(f.turbo.floor, H.y0 + H.apex * 4 * u * (1 - u));
  }

  /** Late in the frame, after main.ts has posed the bus and set the camera. `off`: the city's buses aren't out yet (the opening): once out they fly on. */
  frame(dt: number, simTime: number, realDt: number, off: boolean): void {
    const f = this.h.flight, me = this.me, S = rivalScreen;
    this.now = simTime;
    me.x = f.x;
    me.y = f.y;
    me.z = f.z;
    me.heading = f.heading;
    me.nose = f.heading + this.h.slip();
    me.speed = f.ground;
    me.faction = this.h.faction();
    me.out = this.hurt.on;
    this.sim.on = !off;
    // (where the player's own paint is landing: a breath has just begun, and it lands a little ahead)
    const breath = f.barfT >= 0;
    if (breath && !this.breathing) this.sim.heard(f.x + f.fx * 70, f.z + f.fz * 70, me.faction);
    this.breathing = breath;
    if (dt > 0) this.sim.step(dt, me, this.h.world);
    this.pick = !off && !me.out && f.fullness >= 0.999 && f.barfT < 0 ? this.sim.inFront(me) : null;
    this.headOnWatch(me);
    this.hitFx(dt, simTime);
    this.land(simTime);
    this.draw(dt, simTime);
    // (the cars' horns after a head-on, a few at a time)
    if (this.honks > 0 && (this.honkIn -= realDt) <= 0) {
      const a = this.kitNow();
      if (a) paradeHonk(a[0], a[1], this.honks % 6, (this.honks * 37) & 255);
      this.honks--;
      this.honkIn = 0.11 + 0.1 * Math.random();
    }
    // (the view stands back for the head-on, and comes in again)
    this.pullNow += ((this.slowWith ? S.pull : 0) - this.pullNow) * (1 - Math.exp(-realDt * (this.slowWith ? 9 : 2.5)));
    this.h.pull(this.pullNow < 0.5 ? 0 : this.pullNow);
  }

  // ---------------------------------------------------------------- what the brain says

  private on(ev: string, r: Rival): void {
    const T = rivalTune, S = rivalScreen, h = this.h;
    this.count(ev);
    const f = h.flight, far = Math.hypot(r.x - f.x, r.z - f.z);
    if (ev === 'spawn') {
      // (its tag, made once: its crew's name and colour are drawn into it)
      if (!this.tags.has(r.id)) this.tags.set(r.id, new Tag(NAME[r.faction] ?? '', rgba(BODY[r.faction] ?? Ramp.GLOW_WHITE, 6), r.id));
    } else if (ev === 'paint') {
      // (what it's passing over, a little ahead of it, in its crew's look, as a tap paints. Too far off to see, the city isn't there to paint)
      if (far > S.paintFar) return;
      this.count('painted');
      const x = r.x + Math.sin(r.heading) * 30, z = r.z - Math.cos(r.heading) * 30;
      h.barf(x, z, { drop: Math.max(0, r.y - h.world.groundAt(x, z)), travel: 0.4, stream: true, hitStop: 0, faction: r.faction, tag: QUIET_RIVAL });
    } else if (ev === 'honk') {
      const a = far < S.honkFar ? this.kitNow() : null;
      if (a) rivalHonk(a[0], a[1], (r.id % 7) / 6);
    } else if (ev === 'shellAt') {
      // (one of them at another: the same shot, in its crew's colours)
      const at = this.sim.aim;
      if (!at || far > T.near * 1.2) return;
      const from = this.v.set(r.x + Math.sin(r.heading) * 8, r.y, r.z - Math.cos(r.heading) * 8);
      h.holds.fire(shellBetween(this.sim, r, at, from, (_w, s) => {
        this.sim.soak(at, s.dir.x, s.dir.z, r.faction, false);
        this.count('skirmish');
      }));
    } else if (ev === 'shell') {
      const from = this.v.set(r.x + Math.sin(r.heading) * 8, r.y, r.z - Math.cos(r.heading) * 8);
      h.holds.fire(
        shellBack(
          r, from, (out) => void h.holds.bus(out), (out) => void h.holds.busVel(out), h.flight.speed,
          (_at, s) => {
            if (this.hurt.on) return;
            this.hurtMe(-1, s.dir.x, s.dir.z, T.soakThrow, r.faction);
            this.sim.settled(r);
            this.count('hitByShell');
          },
          (why) => {
            if (why === 'dodged') this.count('dodged');
          },
        ),
      );
    } else if (ev === 'ram') this.ram(r);
    else if (ev === 'land') {
      // (where a soaked rival comes down, the paint of whoever soaked it lands: the player's with all a tap's show, another rival's quietly)
      const o: BarfOpts = { drop: Math.max(0, r.y - h.world.groundAt(r.x, r.z)), travel: 0.05, stream: true, radius: S.land[r.tier < 0 ? 0 : Math.min(3, r.tier)] };
      if (r.soaked === this.h.faction()) h.barf(r.x, r.z, o);
      else if (r.soaked && far < S.paintFar) h.barf(r.x, r.z, { ...o, hitStop: 0, faction: r.soaked, tag: QUIET_RIVAL });
    }
  }

  private ram(r: Rival): void {
    const R = this.sim.ram, S = rivalScreen, h = this.h, tier = R.tier, a = this.kitNow();
    this.count(`ram${tier}`);
    this.stopLeft = Math.max(this.stopLeft, S.stop[tier]);
    h.kick(S.kick[tier]);
    h.toast([WORD[tier]], tier === 3 ? 1.8 : 1.1);
    if (a) (tier === 3 ? headOnBoom : ramClang)(a[0], a[1], tier);
    const drop = Math.max(0, R.y - h.world.groundAt(R.x, R.z));
    h.particles.splash(this.v.set(R.x, R.y, R.z), h.hue(), 1 + 0.6 * tier);
    if (tier === 0) {
      // (a bump: both wobble, and both stop arms swing out)
      this.wobble = R.me ? 1 : 0.5;
      this.h.arm(0.6);
      const s = this.slotOf(r);
      if (s) s.arm = 0.6;
      return;
    }
    // (the paint of whoever struck, on the city under it: nose to nose both crews', a half each side of where they met)
    const f = h.flight, nx = -Math.sin(f.heading), nz = Math.cos(f.heading);
    if (tier < 3) {
      if (R.it) h.barf(R.x, R.z, { drop, travel: 0.06, stream: true, hitStop: 0, radius: S.splash[tier], ...(R.me ? { side: { x: R.x, z: R.z, nx, nz } } : {}) });
      if (R.me) h.barf(R.x, R.z, { drop, travel: 0.06, stream: true, hitStop: 0, radius: S.splash[tier], faction: r.faction, tag: QUIET_RIVAL, ...(R.it ? { side: { x: R.x, z: R.z, nx: -nx, nz: -nz } } : {}) });
    } else this.headOn(r, nx, nz);
    if (R.me) this.hurtMe(tier, R.meX, R.meZ, R.far, r.faction);
    this.slowWith = null;
  }

  /** The head-on: a white beat, a crater of both crews' paint, rings of it racing out at the speed of sound, and every horn in the neighbourhood. */
  private headOn(r: Rival, nx: number, nz: number): void {
    const R = this.sim.ram, S = rivalScreen, mine = this.h.faction();
    this.h.flash();
    this.honks = 9;
    this.honkIn = 0.5;
    for (const [faction, sx, sz] of [[mine, nx, nz], [r.faction, -nx, -nz]] as const) {
      this.rings.push({ at: this.now + 0.05, inner: 0, r: S.crater, x: R.x, z: R.z, nx: sx, nz: sz, faction, jump: 2 });
      for (let out = S.crater + S.band; out <= S.ring; out += S.band) this.rings.push({ at: this.now + out / 343, inner: out - S.band, r: out, x: R.x, z: R.z, nx: sx, nz: sz, faction, jump: 1 });
    }
  }

  /** The head-on's crater and rings, as each is due. */
  private land(simTime: number): void {
    const mine = this.h.faction();
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const g = this.rings[i];
      if (g.at > simTime) continue;
      this.rings.splice(i, 1);
      const o: BarfOpts = { drop: 0, travel: 0.03, stream: true, hitStop: 0, radius: g.r, target: null, exact: true, y: this.h.world.groundAt(g.x, g.z) + 0.5, side: { x: g.x, z: g.z, nx: g.nx, nz: g.nz }, tag: QUIET_RIVAL };
      if (g.inner > 0) o.inner = g.inner;
      if (g.jump > 1) o.jump = g.jump;
      if (g.faction !== mine) o.faction = g.faction;
      this.h.barf(g.x, g.z, o);
    }
  }

  /** The head-on coming: nose to nose with a rival, each on the other's line, closing at over the wreck's speed, half a second out. Time slows (timeScale), and
   *  whoever turns away then is the chicken. */
  private headOnWatch(me: Me): void {
    const T = rivalTune, S = rivalScreen, line = T.line * 1.6 * (Math.PI / 180);
    let found: Rival | null = null;
    if (!me.out && me.speed > 100)
      for (const r of this.sim.list) {
        if (!r.live || r.state === RState.Flung) continue;
        const dx = r.x - me.x, dz = r.z - me.z, d = Math.hypot(dx, dz), to = Math.atan2(dx, -dz);
        const offMe = Math.abs(Math.atan2(Math.sin(to - me.heading), Math.cos(to - me.heading))), offIt = Math.abs(Math.atan2(Math.sin(to + Math.PI - r.heading), Math.cos(to + Math.PI - r.heading)));
        const closing = me.speed * Math.cos(offMe) + r.speed * Math.cos(offIt);
        if (offMe < line && offIt < line && closing >= T.tiers[2] && d < closing * S.slowFor && Math.abs(r.y - me.y) < T.ramUp * 2) found = r;
      }
    if (found && !this.slowWith) {
      this.slowWith = found;
      this.slowHeading = me.heading;
      this.count('slow');
    } else if (!found && this.slowWith) {
      // (it didn't come to it: somebody turned away. The player, if its way has swung; else the rival flinched)
      const r = this.slowWith;
      this.slowWith = null;
      if (r.live && r.state !== RState.Flung && !this.hurt.on) {
        const swung = Math.abs(Math.atan2(Math.sin(me.heading - this.slowHeading), Math.cos(me.heading - this.slowHeading)));
        this.h.toast([swung > 0.05 ? 'CHICKEN!' : `${NAME[r.faction] ?? 'IT'} FLINCHED!`], 1.4);
        this.count(swung > 0.05 ? 'chicken' : 'flinched');
      }
    }
  }

  // ---------------------------------------------------------------- the player's bus, hit

  /** Hit: the hitter's colours flood in from the nose, and the bus is thrown `far` m along (ux, uz) with a roll. tier -1: a shell's. */
  private hurtMe(tier: number, ux: number, uz: number, far: number, faction: number): void {
    const T = rivalTune, H = this.hurt, f = this.h.flight, air = T.air[Math.max(0, tier)], w = this.h.world;
    H.on = true;
    H.t = 0;
    H.e = 0;
    H.air = air;
    H.far = far;
    H.ux = ux;
    H.uz = uz;
    H.rolls = tier < 0 ? 1 : 1 + tier;
    H.y0 = f.y;
    // (over whatever stands along the throw, with room: the tallest roof on its line, and an arc of its own for a hard one)
    let top = f.y;
    for (let d = 0; d <= far; d += 25) top = Math.max(top, w.obstacleAt(f.x + ux * d, f.z + uz * d, 1e9) + 12);
    H.apex = far > 90 ? Math.max(top - f.y, Math.min(260, far * 0.12)) : 0;
    this.flood = { at: this.now, ramp: BODY[faction] ?? Ramp.GLOW_WHITE, drainAt: Infinity, shown: -1 };
    this.h.kick(1.4);
    this.count('flung');
  }

  /** The flood's colours on the player's bus, the throw and its roll, a bump's wobble: after main.ts has posed the bus this frame. */
  private hitFx(dt: number, simTime: number): void {
    const S = rivalScreen, f = this.h.flight, root = this.h.bus.root, H = this.hurt;
    const fl = this.flood;
    if (fl) {
      const k = Math.min(1, (simTime - fl.at) / S.flood), kd = Math.max(0, Math.min(1, (simTime - fl.drainAt) / S.drain));
      // (front to back: the bus's nose is its -z; the drain leaves from its back. Redone only while it moves, in 30 steps)
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
    if (H.on) {
      H.t += dt;
      const k = Math.min(1, H.t / H.air), e = k * k * (3 - 2 * k), de = e - H.e;
      H.e = e;
      f.x += H.ux * H.far * de;
      f.z += H.uz * H.far * de;
      // (a short throw hops; a long one rides the floor pre() lifts under it)
      if (H.apex <= 0) f.y += 9 * de * (k < 0.5 ? 1 : -0.4);
      roll = Math.PI * 2 * H.rolls * e + 0.3 * Math.sin(k * Math.PI * 3) * (1 - k);
      if (k >= 1) {
        H.on = false;
        if (fl) fl.drainAt = simTime + 0.4;
      }
    } else if (this.wobble > 0) {
      this.wobble = Math.max(0, this.wobble - dt * 1.6);
      roll = 0.22 * this.wobble * Math.sin(this.wobble * 22);
    }
    if (roll) root.quaternion.multiply(this.q.setFromAxisAngle(this.zAxis, roll));
  }

  // ---------------------------------------------------------------- drawing

  private slotOf(r: Rival): Slot | null {
    for (const s of this.slots) if (s.rival === r) return s;
    return null;
  }

  private paintBody(s: Slot, ramp: number): void {
    if (s.ramp === ramp) return;
    s.ramp = ramp;
    const ra = s.bus.mesh.geometry.getAttribute('ramp') as THREE.BufferAttribute;
    for (let i = 0; i < s.orig.length; i++) if (s.orig[i] === Ramp.BUS_YELLOW) ra.setX(i, ramp);
    ra.needsUpdate = true;
  }

  private draw(dt: number, simTime: number): void {
    const S = rivalScreen, h = this.h, cam = h.camera, f = h.flight, W = window.innerWidth, H = window.innerHeight, hero = h.heroScale();
    const tagFar = S.tagFar * (1 + f.ground / 300), near = this.nearest, nearD = this.nearestD;
    // ---- the nearest few are drawn; each within the tags' reach wears one: over it on the screen, a chevron at the edge off it, flashing while it's
    // after the player
    near.fill(null);
    for (const r of this.sim.list) {
      const tag = this.tags.get(r.id);
      if (!r.live) {
        tag?.hide();
        continue;
      }
      const d = Math.hypot(r.x - f.x, r.z - f.z);
      if (d < S.drawFar) {
        let k = DRAWN - 1;
        if (!near[k] || d < nearD[k]) {
          for (; k > 0 && (!near[k - 1] || d < nearD[k - 1]); k--) {
            near[k] = near[k - 1];
            nearD[k] = nearD[k - 1];
          }
          near[k] = r;
          nearD[k] = d;
        }
      }
      if (!tag) continue;
      if (d > tagFar || r.state === RState.Flung) {
        tag.hide();
        continue;
      }
      const v = this.v.set(r.x, r.y + 14 * hero, r.z).project(cam), behind = v.z > 1;
      let x = v.x, y = v.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.92;
      tag.flash((r.state === RState.Hunt || r.state === RState.Honk) && Math.floor(simTime * 6) % 2 === 1);
      if (onScreen) tag.show(Math.max(78, Math.min(W - 78, (x * 0.5 + 0.5) * W)), (0.5 - y * 0.5) * H, null, d);
      else {
        // (to the edge, along the way it lies from the middle, inside a frame clear of the top's readouts and the thumb's ground)
        const dx = x * W, dy = -y * H, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
        // (its name is drawn middled on it: room for half a name at each side)
        const hw = W / 2 - 78, top = H / 2 - 110, bot = H * 0.3;
        const t = Math.min(ux !== 0 ? hw / Math.abs(ux) : Infinity, uy < 0 ? top / -uy : uy > 0 ? bot / uy : Infinity);
        tag.show(W / 2 + ux * t, H / 2 + uy * t, Math.atan2(-uy, ux), d);
      }
    }
    // (a model stays with its bus while that's one of the nearest; one that isn't any more gives its model up, and a newcomer takes a free one)
    for (const s of this.slots) {
      if (s.rival && !near.includes(s.rival)) {
        s.rival = null;
        s.bus.root.visible = false;
      }
    }
    for (const r of near) {
      if (!r || this.slotOf(r)) continue;
      const s = this.slots.find((x) => !x.rival);
      if (!s) break;
      s.rival = r;
      s.heading = r.heading;
      s.bank = 0;
      s.arm = 0;
    }
    for (const s of this.slots) {
      const r = s.rival;
      if (!r) continue;
      const root = s.bus.root;
      root.visible = true;
      root.position.set(r.x, r.y, r.z);
      // (it banks into its turn and noses up and down, as the player's does; flung it tumbles; soaked it wears the hitter's colours)
      const yaw = dt > 0 ? Math.atan2(Math.sin(r.heading - s.heading), Math.cos(r.heading - s.heading)) / dt : 0;
      s.heading = r.heading;
      s.bank += (Math.max(-0.6, Math.min(0.6, yaw * 0.3)) - s.bank) * (1 - Math.exp(-6 * dt));
      const flung = r.state === RState.Flung;
      this.eul.set(flung ? 0.5 * Math.sin(r.roll * 0.6) : r.pitch, -(r.heading + r.slip), -(s.bank - 0.25 * r.slip) - r.roll, 'YXZ');
      root.quaternion.setFromEuler(this.eul);
      root.scale.setScalar(hero);
      this.paintBody(s, BODY[r.soaked || r.faction] ?? Ramp.BUS_YELLOW);
      const p = this.pose;
      p.speed = r.speed;
      p.eye = flung ? 1 : r.state === RState.Hunt ? 0.35 : 0.8;
      p.wheeze = flung ? 0.6 : 0;
      p.fullness = r.soaked ? 0 : 1;
      s.arm = Math.max(0, s.arm - dt);
      p.mouth = s.arm > 0 ? 0.13 : 0;
      s.bus.update(dt, simTime, p);
    }
    // ---- the ring round what a tap goes for
    const r = this.pick, ring = this.ring;
    if (r && r.live) {
      const n = 12, d = Math.hypot(r.x - f.x, r.y - f.y, r.z - f.z), R = 15 * hero, size = Math.max(0.9, d * 0.006);
      this.right.setFromMatrixColumn(cam.matrixWorld, 0);
      this.up.setFromMatrixColumn(cam.matrixWorld, 1);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + simTime * 1.8;
        this.v2.set(r.x, r.y, r.z).addScaledVector(this.right, Math.cos(a) * R).addScaledVector(this.up, Math.sin(a) * R);
        ring.setMatrixAt(k, this.m4.makeScale(size, size, size).setPosition(this.v2));
      }
      ring.count = n;
      ring.visible = true;
      ring.instanceMatrix.needsUpdate = true;
    } else {
      ring.count = 0;
      ring.visible = false;
    }
  }
}

export function bootRivals(h: RivalsDeps): RivalsGame {
  return new RivalsGame(h);
}
