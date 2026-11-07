import * as THREE from 'three';
import { config } from '../config';
import { clamp } from './springs';
import type { Flight } from './Flight';
import type { City, BuildingRef } from '../world/City';
import type { Blast, GroundBands, Splatter, SuperTag } from './Splat';
import { blastRadiusFor, blobFlight, layoutHue } from './blastLayout';
import type { Particles, GeyserLive } from '../fx/Particles';
import type { AudioEngine } from '../audio/AudioEngine';
import type { CameraRig } from './CameraRig';
import type { Hold, HoldHandler } from './Hold';
import { HUE_COUNT, Ramp } from '../render/palette';
import { registerTunables } from '../ui/tunables';

// The Hose (docs/specs/shots/SHOTS.md, "The modes"): a still hold on the city that nobody
// claims pours paint under the finger, and dragging sweeps it. Built from SuperSplat's
// firehose (its live stream, its lighter impacts, its rings on the ground, its bells), which
// stays asleep with MEGA: this is that pour aimed by the finger instead of the nose.
//
//  - It is the Holds' last handler (src/game/Hold.ts): a hold life or Recess didn't take is
//    the Hose's, and one they take while it pours (Holds.claim) stops it.
//  - The tank is the belly, shared with the tap (and the Bomb, when it comes): a full one
//    pours hoseTune.tank s, it drains only while the stream flows, and once the pour ends it
//    refills in hoseTune.refill s from empty (Flight.rechargeSeconds); a tap needs it full.
//    A hold with too little in it coughs and pours nothing. A pour that runs dry sputters and
//    gulps, and this hold is done: lift and hold again.
//  - The tank reads on the bus, no new button: the belly band drains as it pours (it is the
//    belly's band), the bus rises as it lightens, the hiss and the drone climb as it empties
//    (superSfx.pour), the stream thins over its last hoseTune.thin s, and the refill ends on
//    the belly's own ready chime.
//  - Every hold that isn't empty pours. On the city within hoseTune.reach it comes down under
//    the finger; on the sky, or on the city past the reach, it comes down as far as it
//    reaches that way, on the ground there (a hose aimed high throws its farthest). Only a bus
//    more than the reach over the ground has nothing in reach: that hold coughs.
//  - The stream arcs from the mouth onto that point (the geyser's lob, its
//    height a share of the distance), which eases after the finger, so a sweep is
//    water swinging, not a cursor. A blast of hoseTune.radius lands where it comes down
//    each time it has moved a share of that radius, or every hoseTune.every s while it
//    stays (more from up high, as every blast grows). Each is a firehose impact (Blast.hose:
//    lighter fx, no hit-stop) in the pour's one set of rings on the ground, and a pour raises
//    each building at most one level (BarfOpts.pour). Every impact calls life.blast as a
//    tap's does (main.ts), tagged as the Hose's (Blast.super, kind 'hose').
//  - The bus flies straight (nobody steers it while the one thumb aims), slows to
//    hoseTune.slow of its speed at Cruise and Express (a gear drives through it), rears a
//    little and shudders with the pressure.
//  - In the faction's colours: the stream and the impacts' particles are the breath's
//    (Particles.palette), and the paint is the hitter's (Splatter.faction).
//
// Frame order (main.ts): update() after SuperSplat.update (it writes Flight.speedScale too)
// and before Splatter.update; impact() from the Splatter's impact callback for its blasts.

export const hoseTune = {
  /** blast radius at roof height (m; more from up high, as every blast) */
  radius: 40,
  /** a full tank pours this long (s), and refills from empty in this long once the pour ends */
  tank: 3,
  refill: 3,
  /** A hold ended cancelled this soon after its pour opened (game s) gives the tank back: Input's late tap, a lift that reached the page behind slow frames
   *  after its aim began, its own time a tap's (the Lob's roofs stage: the pour drained the belly and the tap it was found it not yet full) */
  lateTap: 0.5,
  /** a hold with less than this share of the tank coughs and pours nothing */
  minTank: 0.12,
  /** a new impact once the stream has moved this share of the radius, or after `every` s where it stays; at most `rate` a second */
  spacing: 0.45,
  every: 0.3,
  rate: 10,
  /** the stream reaches this far from the bus (m): a finger on the sky or on the city past it pours as far as it reaches that way */
  reach: 1500,
  /** the lob: this many m over the chord per m of it, at most arcMax m */
  arc: 0.1,
  arcMax: 80,
  /** the landing eases after the finger's point at this rate (1/s) */
  follow: 14,
  /** the stream's flight: base s, plus distance at this speed (m/s) */
  travel: 0.2,
  speed: 650,
  /** the stream's width x the breath's (more from up high: x (1 + drop / widthDrop)), and its particle rate x */
  width: 1.9,
  widthDrop: 130,
  flow: 1.5,
  /** the flow thins over the tank's last this many s */
  thin: 0.35,
  /** the bus's speed share while it pours (not in a gear), its rear (rad) and shudder (m) */
  slow: 0.72,
  rear: 0.09,
  shudder: 0.12,
  /** the ground's rings (m wide at roof height) */
  band: 15,
  /** per impact: splash, burst, every n-th spatter blob flung, camera shake (m), flashes a second at most */
  splash: 0.4,
  burst: 0.24,
  blobEvery: 5,
  shake: 0.45,
  flashes: 2,
};

registerTunables('Hose', hoseTune, {
  radius: [10, 120, 1],
  tank: [0.5, 10, 0.1],
  refill: [0.5, 10, 0.1],
  minTank: [0, 0.6, 0.01],
  spacing: [0.1, 1.5, 0.01],
  every: [0.05, 1, 0.01],
  rate: [1, 20, 0.5],
  reach: [200, 4000, 10],
  arc: [0, 0.5, 0.01],
  arcMax: [0, 300, 1],
  follow: [1, 60, 0.5],
  travel: [0.05, 1, 0.01],
  speed: [100, 3000, 10],
  width: [0.3, 5, 0.05],
  widthDrop: [10, 600, 5],
  flow: [0.2, 5, 0.05],
  thin: [0, 1.5, 0.01],
  slow: [0.2, 1, 0.01],
  rear: [0, 0.4, 0.005],
  shudder: [0, 1, 0.01],
  band: [4, 60, 1],
  splash: [0, 2, 0.01],
  burst: [0, 2, 0.01],
  blobEvery: [1, 20, 1],
  shake: [0, 2, 0.01],
  flashes: [0.5, 8, 0.5],
});

/** What the Hose needs from the game (main.ts). */
export interface HoseHost {
  flight: Flight;
  city: City;
  splatter: Splatter;
  particles: Particles;
  audio: AudioEngine;
  rig: CameraRig;
  /** the bus's mouth (this frame's) and its velocity */
  mouth(): THREE.Vector3;
  busVel(): THREE.Vector3;
  /** the roof hatch (world) */
  hatch(out: THREE.Vector3): THREE.Vector3;
  /** a palette flash centred on a world point */
  flash(at: THREE.Vector3, frames: number, strength: number): void;
  /** the street sign for the neighbourhood the stream sweeps into */
  sign(ref: BuildingRef, hue: number, cx: number, cz: number, r: number): void;
}

export class Hose implements HoldHandler {
  readonly name = 'hose';
  /** the stream is on (taps wait: the mouth is busy) */
  pouring = false;
  /** a Bomb is charging on the bus (main.ts, per frame from Input.state.bomb): a hold now coughs and pours nothing, so the Hose can't drain the belly the
   *  Bomb's tiers wait for */
  bombing = false;
  /** outputs, applied by main.ts on the bus every frame: extra nose-up (rad), jitter (m) */
  pitch = 0;
  readonly shake = new THREE.Vector3();
  /** QA: what the last pour did (and how many in all) */
  readonly stats = { pours: 0, impacts: 0, blooms: 0, misses: 0, seconds: 0, dry: false, coughs: 0, startTank: 0, endTank: 0 };

  private readonly h: HoseHost;
  private serial = 0;
  private tag: SuperTag = { kind: 'hose', charge: 1, id: 0 };
  /** every pour's tag (SuperSplat's asleep firehose tags its own 'hose' too): a pour's impacts still in flight when the next opens are still the Hose's */
  private readonly tags = new WeakSet<SuperTag>();
  /** this hold coughed, or ran dry: it pours no more */
  private spent = false;
  /** the hold this is about (Hold.id): one handed to the Hose by claim(), not start(), is a fresh one */
  private holdId = 0;
  /** the stream's live controls, a new one each pour: open while it pours (Particles' GeyserLive.open), so a pour paused on the sky keeps its stream */
  private live: GeyserLive = { target: new THREE.Vector3(), travel: 0.3, rate: 0, width: 1, open: false };
  /** where the stream comes down for the finger now (reachOf) */
  private readonly goal = new THREE.Vector3();
  private readonly tgt = [new THREE.Vector3()];
  private readonly hueOne = [0];
  private readonly bands: GroundBands = { x: 0, z: 0, width: 15, hue: 0 };
  /** where the stream lands now (on the spring), its velocity, and where the last impact was */
  private readonly at = new THREE.Vector3();
  private readonly last = new THREE.Vector3();
  private sinceImpact = 0;
  private flowing = false;
  private pourT = 0;
  private t = 0;
  private lastFlash = -10;
  private lastSign = -10;
  private lastHood = -1;
  private blobN = 0;
  private up = 0;
  private readonly v0 = new THREE.Vector3();
  private readonly v1 = new THREE.Vector3();

  constructor(host: HoseHost) {
    this.h = host;
  }

  /** This blast is one of the Hose's (main.ts routes its impact here). */
  owns(b: Blast): boolean {
    return b.super !== null && this.tags.has(b.super);
  }

  // ------------------------------------------------------------------ the hold (Holds)

  start(h: Hold): boolean {
    this.holdId = h.id;
    this.spent = false;
    // (a breath under way, or too little in the tank: a cough, and this hold pours nothing)
    if (!this.tankOk()) this.refuse();
    return true;
  }

  move(h: Hold, dt: number): void {
    // (a hold another handler let go of and handed here: as new, the tank asked again before it pours. Review of step 2: a 5 % tank poured)
    if (h.id !== this.holdId) {
      this.holdId = h.id;
      this.spent = false;
    }
    if (this.spent) return;
    const can = this.reachOf(h);
    if (!this.pouring) {
      // (nothing in reach, the bus too high over the ground, or the tank gone low since: a cough, never a hold that silently does nothing)
      if (!can || !this.tankOk()) this.refuse();
      else this.open();
      return;
    }
    if (!can) {
      // (the bus has climbed past the reach over the ground: it stops flowing, and the tank waits)
      this.flowing = false;
      return;
    }
    this.flowing = true;
    // the landing follows the finger's point, easing in (water swinging, not a cursor), and comes down on what is there
    if (dt > 0) {
      this.at.lerp(this.goal, 1 - Math.exp(-hoseTune.follow * dt));
      this.at.y = this.h.city.surfaceAt(this.at.x, this.at.z, Math.max(this.goal.y, this.at.y) + 3);
    }
  }

  private tankOk(): boolean {
    const f = this.h.flight;
    return !this.bombing && f.barfT < 0 && f.fullness >= hoseTune.minTank;
  }

  private refuse() {
    this.cough();
    this.spent = true;
  }

  /**
   * Where the stream comes down for this hold, into `goal`: the finger's point on the city within the reach, or else, the way the finger points (toward the point
   * past the reach, or along the ray on the sky), as far as the reach goes, on the ground there. False: nothing is in reach (the bus is more than the reach over it).
   */
  private reachOf(h: Hold): boolean {
    const f = this.h.flight, city = this.h.city, R = hoseTune.reach, g = this.goal;
    if (h.hit && h.range <= R) {
      g.copy(h.point);
      return true;
    }
    let dx = h.hit ? h.point.x - f.x : h.ray.dx, dz = h.hit ? h.point.z - f.z : h.ray.dz;
    let l = Math.hypot(dx, dz);
    if (l < 1e-4) {
      // (straight up or down: ahead)
      dx = f.fx;
      dz = f.fz;
      l = Math.hypot(dx, dz) || 1;
    }
    dx /= l;
    dz /= l;
    // (out along that way until the stream's length from the bus is the reach: three passes settle it over hills)
    let s = R;
    for (let i = 0; i < 3; i++) {
      const drop = f.y - city.surfaceAt(f.x + dx * s, f.z + dz * s, f.y);
      if (drop >= R * 0.98) return false;
      s = Math.sqrt(R * R - drop * drop) * 0.98;
    }
    g.set(f.x + dx * s, city.surfaceAt(f.x + dx * s, f.z + dz * s, f.y), f.z + dz * s);
    return true;
  }

  lost(_h: Hold): void {
    this.close(false);
  }

  end(_h: Hold, cancelled: boolean): void {
    if (cancelled && this.pouring && this.pourT <= hoseTune.lateTap) this.h.flight.fullness = Math.max(this.h.flight.fullness, this.stats.startTank);
    this.close(false);
  }

  /** The street gives the bus to the flight (?earth's hand-up), or a page change: it stops where it is. */
  stop(): void {
    this.close(false);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const f = this.h.flight, T = hoseTune;
    this.t += dt;
    this.shake.set(0, 0, 0);
    if (!this.pouring) {
      this.up = Math.max(0, this.up - dt * 6);
      this.pitch = T.rear * this.up * this.up;
      return;
    }
    this.pourT += dt;
    // the tank drains only while it flows
    if (this.flowing) {
      f.fullness = Math.max(0, f.fullness - dt / Math.max(0.1, T.tank));
      this.stats.seconds += dt;
    }
    const left = f.fullness * T.tank;
    const aim = this.aimNow();
    this.live.target.copy(aim.p);
    this.live.travel = aim.travel;
    this.live.width = T.width * (1 + aim.drop / Math.max(10, T.widthDrop));
    // (the flow thins over the tank's last seconds: it's running out, and it shows)
    this.live.rate = this.flowing ? T.flow * Math.min(1, 0.5 / aim.travel) * clamp(left / Math.max(0.01, T.thin), 0.25, 1) : 0;
    this.h.audio.hoseLevel(f.fullness);
    // impacts: where it comes down, once it has moved enough, or every so often where it stays
    this.sinceImpact += dt;
    if (this.flowing && dt > 0) {
      const r = T.radius * (blastRadiusFor(aim.drop) / config.splat.blastRadius);
      const moved = Math.hypot(aim.p.x - this.last.x, aim.p.z - this.last.z);
      if (this.sinceImpact >= 1 / Math.max(1, T.rate) && (moved >= T.spacing * r || this.sinceImpact >= T.every)) this.impactNow(aim, r);
    }
    if (f.fullness <= 0) {
      this.close(true);
      return;
    }
    // the bus: slowed (not in a gear), rearing on the pressure, shuddering
    if (!f.driven) f.speedScale = T.slow;
    this.up = Math.min(1, this.up + dt * 6);
    this.pitch = T.rear * this.up * this.up + 0.02 * Math.sin(this.t * 27);
    const sh = T.shudder * (this.flowing ? 1 : 0.3);
    this.shake.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh * 0.6, (Math.random() - 0.5) * sh);
  }

  /** QA: a pour held at a world point for `seconds` (no finger): the hold a finger would make, aimed there. */
  qaPour(x: number, y: number, z: number): Hold {
    const fake = { id: --this.qaId, down: true, x: 0, y: 0, x0: 0, y0: 0, dragX: 0, dragY: 0, held: 0.35, aimed: 0, ray: { ox: 0, oy: 0, oz: 0, dx: 0, dy: -1, dz: 0 }, hit: true, point: new THREE.Vector3(x, y, z), range: 0, owner: 'hose' };
    fake.range = Math.hypot(x - this.h.flight.x, y - this.h.flight.y, z - this.h.flight.z);
    this.start(fake);
    this.move(fake, 0);
    return fake;
  }

  private qaId = 0;

  // ------------------------------------------------------------------ the pour

  private open() {
    const H = this.h, f = H.flight, T = hoseTune;
    this.pouring = true;
    this.flowing = true;
    f.pouring = true;
    this.pourT = 0;
    this.lastHood = -1;
    this.lastSign = -10;
    this.at.copy(this.goal);
    this.last.set(Infinity, 0, Infinity);
    this.sinceImpact = Infinity;
    this.tag = { kind: 'hose', charge: 1, id: ++this.serial };
    this.tags.add(this.tag);
    // (a new stream's controls: the last pour's emitter, if it is still finishing, keeps its own, closed)
    this.live = { target: new THREE.Vector3(), travel: 0.3, rate: 0, width: 1, open: true };
    this.hueOne[0] = H.splatter.hueNext % HUE_COUNT;
    const aim = this.aimNow();
    this.tgt[0].copy(aim.p);
    this.live.target.copy(aim.p);
    this.live.travel = aim.travel;
    this.live.width = T.width * (1 + aim.drop / Math.max(10, T.widthDrop));
    this.live.rate = T.flow * Math.min(1, 0.5 / aim.travel);
    this.bands.x = aim.p.x;
    this.bands.z = aim.p.z;
    this.bands.width = T.band * (blastRadiusFor(aim.drop) / config.splat.blastRadius);
    this.bands.hue = this.hueOne[0];
    const chord = Math.hypot(aim.p.x - f.x, aim.p.z - f.z);
    H.particles.geyser({
      source: H.mouth, sourceVel: H.busVel, targets: this.tgt, hues: this.hueOne,
      duration: f.fullness * T.tank + 0.4, travelTime: aim.travel, width: T.width, live: this.live, taper: 0.97, arc: Math.min(T.arcMax, T.arc * chord),
    });
    H.audio.hosePour();
    H.audio.hoseLevel(f.fullness);
    H.rig.kick(1.2);
    Object.assign(this.stats, { pours: this.stats.pours + 1, impacts: 0, blooms: 0, misses: 0, seconds: 0, dry: false, startTank: f.fullness, endTank: f.fullness });
  }

  private close(dry: boolean) {
    if (!this.pouring) return;
    const H = this.h, f = H.flight;
    this.pouring = false;
    this.flowing = false;
    f.pouring = false;
    f.rechargeSeconds = hoseTune.refill;
    f.speedScale = 1;
    this.live.rate = 0;
    this.live.open = false;
    this.spent = this.spent || dry;
    this.stats.dry = dry;
    this.stats.endTank = f.fullness;
    H.audio.hoseStop(dry);
    if (dry) {
      // (dry: a cough of steam out of the hatch, and the bus lightens)
      const p = H.hatch(this.v0);
      for (let i = 0; i < 4; i++) H.particles.puff(p, this.v1.set((Math.random() - 0.5) * 2.5, 3 + Math.random() * 2.5, (Math.random() - 0.5) * 2.5), Ramp.WHITE);
    }
  }

  private cough() {
    const H = this.h;
    this.stats.coughs++;
    H.audio.denied();
    const p = H.hatch(this.v0);
    for (let i = 0; i < 2; i++) H.particles.puff(p, this.v1.set((Math.random() - 0.5) * 2, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 2), Ramp.GREY);
  }

  private readonly aimOut = { p: new THREE.Vector3(), drop: 0, travel: 0.3 };
  /** Where the stream lands now (the spring's point), how far under the bus, and its flight time. */
  private aimNow() {
    const f = this.h.flight, o = this.aimOut, T = hoseTune;
    o.p.copy(this.at);
    o.drop = Math.max(0, f.y - o.p.y);
    const dist = Math.hypot(o.p.x - f.x, o.p.z - f.z, o.drop);
    o.travel = Math.max(0.12, T.travel + dist / Math.max(50, T.speed));
    return o;
  }

  private impactNow(aim: { p: THREE.Vector3; drop: number; travel: number }, r: number) {
    const H = this.h;
    this.sinceImpact = 0;
    this.last.copy(aim.p);
    const x = aim.p.x, z = aim.p.z, y = aim.p.y;
    // (seen from just over where it lands: a stream under a deck lands under it; the bus's height is the blast's `from`)
    const target = H.city.buildingAt(x, z, y + 2);
    H.splatter.barf(x, z, { radius: r, travel: aim.travel, drop: aim.drop, target, y: y + 0.3, from: H.flight.y, exact: true, hose: true, pour: this.tag.id, super: this.tag, bands: this.bands });
    this.stats.impacts++;
    if (H.splatter.lastMiss) this.stats.misses++;
  }

  /** One of its blasts lands (the Splatter's impact callback): the firehose's lighter fx. */
  impact(b: Blast): void {
    const T = hoseTune, H = this.h, P = H.particles;
    const hue = layoutHue(b.spec, 0, 0);
    P.splash(b.pos, hue, T.splash);
    P.burst(b.pos, hue, T.burst, H.city.groundAt(b.pos.x, b.pos.z));
    const every = Math.max(1, Math.round(T.blobEvery));
    for (const dot of b.dots) {
      if (!dot.blob || this.blobN++ % every !== 0) continue;
      const from = this.v0.set(b.pos.x + (Math.random() - 0.5) * 4, b.pos.y + 1 + Math.random() * 2, b.pos.z + (Math.random() - 0.5) * 4);
      const to = this.v1.set(dot.x, (H.city.roofAt(dot.x, dot.z, from.y) ?? H.city.groundAt(dot.x, dot.z)) + 0.15, dot.z);
      P.fling(from, to, blobFlight(dot), dot.hue, 0.6 + dot.rad * 0.5);
    }
    H.rig.kick(T.shake * Math.sqrt(b.strength));
    if (this.t - this.lastFlash >= 1 / Math.max(0.5, T.flashes)) {
      this.lastFlash = this.t;
      H.flash(b.pos, 1, 0.4);
    }
    H.audio.superHoseHit();
    this.stats.blooms += b.count;
    const p = b.primary;
    if (p && p.hood !== this.lastHood && this.t - this.lastSign > 1.2) {
      this.lastHood = p.hood;
      this.lastSign = this.t;
      H.sign(p, hue, b.spec.x, b.spec.z, b.spec.r);
    }
  }
}
