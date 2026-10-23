import * as THREE from 'three';
import { config } from '../config';
import { clamp } from './springs';
import { Aimer, type Shot } from './Aim';
import type { Flight } from './Flight';
import type { City, BuildingRef } from '../world/City';
import type { Blast, Splatter } from './Splat';
import { blastRadiusFor, blobFlight } from './blastLayout';
import type { Particles, GeyserLive } from '../fx/Particles';
import type { SuperFx } from '../fx/SuperFx';
import type { AudioEngine } from '../audio/AudioEngine';
import { heartInterval } from '../audio/superSfx';
import type { CameraRig } from './CameraRig';
import type { BusPose } from '../bus/BusModel';
import type { SuperView } from '../ui/SuperMeter';
import { HUE_COUNT, Ramp } from '../render/palette';
import { registerTunables } from '../ui/tunables';

// The super splat: hold to charge, let go for a MEGA blast, or hold the whole
// way for the FIREHOSE. Then a long cooldown, obviously shown.
//
//   ready -> charging (Input.onChargeStart; config.splat.superCharge s to full)
//     released early (onChargeEnd):  < superMin: a normal splat, no cooldown;
//                                    else a MEGA blast scaled by the charge
//                                    (radius, jet width, hit-stop, boom) and a
//                                    cooldown of superCooldown x the charge
//     cancelled (slid into a steer, lost focus): it fizzles out, no cooldown
//     full: the FIREHOSE lets go on its own
//   firehose: firehoseDuration s of colossal continuous rainbow torrent along
//     the aim (Aim.ts's ray: at altitude it pours down where the player looks),
//     steerable: as the bus turns the stream sweeps across the city. Its
//     landing point moves (Particles.geyser's `live`), and ~firehoseRate times
//     a second the point where the stream is landing right now (from a short
//     history of where it was aimed, one flight time ago) takes a full blast
//     of firehoseRadius through the normal Splatter (buildings bloom as the
//     shockwave reaches them, ground paint, trees; `hose` impacts escalate a
//     building at most every firehoseRepop s, no hit-stop, lighter particles,
//     a bell per impact climbing the chord). Heavy recoil, shake, flashes
//     (at most firehoseFlashes per second: no strobing), a roar and a closing
//     crescendo blast where the stream ends.
//   cooldown: superCooldown s (the meter drains, then refills with the seconds
//     left); after a firehose the bus is spent for superSpent s (smoke, wheeze,
//     dim belly, limping). Holding meanwhile: "not yet" (a fizzle, the meter
//     shakes); taps still splat normally. Ready: a chime and a glow pulse.
//
// The charge's look (src/fx/SuperFx.ts: energy spiralling into the mouth,
// arcs, sparks, a rainbow halo; the belly band racing to white-hot in
// BusModel; the bus swelling, throbbing with the heartbeat, shuddering; the
// camera creeping in; src/audio/superSfx.ts: riser + heartbeat) is driven
// from here. Nothing new persists.
//
// Frame order (main.ts): update() after the aim and before Splatter.update
// (so an impact due this frame lands in it, before the paint upload); pose()
// into a copy of the bus pose; pitch / shake / swell on the bus root; camera()
// after the rig; impact() from the Splatter's impact callback for hose blasts.

export type SuperPhase = 'ready' | 'charging' | 'firehose' | 'cooldown';

/** Look numbers (tuner group "SuperSplat"); the gameplay numbers live in config.splat. */
export const superTune = {
  /** Bus scale at a full charge (x), the heartbeat's throb (squash), the shudder (m of jitter). */
  swell: 0.16,
  throb: 0.08,
  shudder: 0.16,
  /** Energy motes per second at a full charge, how far out they start (m), how long they take (s). */
  motes: 950,
  moteReach: 115,
  moteLife: 1.1,
  /** Sparks per second at a full charge; halo motes per second past 50 %. */
  sparks: 70,
  halo: 110,
  /** Steam puffs from the hatch per second at a full charge; spent smoke puffs per second. */
  steam: 3.5,
  smoke: 10,
  /** Pouring: nose-up (rad) and shudder (m); camera pull-back (share of its distance). */
  hoseRear: 0.24,
  hoseShudder: 0.34,
  hosePull: 0.08,
  /** Camera dolly spring (Hz). */
  dollyHz: 2.4,
  /** Impacts land where the stream was aimed one flight time ago, this much early (s): the blast is ~1 frame ahead of the paint. */
  lead: 0.07,
  /** Particles per firehose impact: splash strength, burst strength, every n-th spatter blob flung. */
  hoseSplash: 0.45,
  hoseBurst: 0.26,
  hoseBlobEvery: 5,
};

registerTunables('SuperSplat', superTune, {
  swell: [0, 0.6, 0.01],
  throb: [0, 0.3, 0.005],
  shudder: [0, 1, 0.01],
  motes: [0, 1500, 10],
  moteReach: [10, 300, 1],
  moteLife: [0.2, 3, 0.05],
  sparks: [0, 300, 1],
  halo: [0, 200, 1],
  steam: [0, 40, 0.5],
  smoke: [0, 40, 0.5],
  hoseRear: [0, 0.6, 0.01],
  hoseShudder: [0, 1.5, 0.01],
  hosePull: [-0.3, 0.5, 0.01],
  dollyHz: [0.3, 8, 0.05],
  lead: [0, 0.3, 0.005],
  hoseSplash: [0, 2, 0.01],
  hoseBurst: [0, 2, 0.01],
  hoseBlobEvery: [1, 20, 1],
});

/** What SuperSplat needs from the game (main.ts). */
export interface SuperHost {
  flight: Flight;
  city: City;
  splatter: Splatter;
  aimer: Aimer;
  particles: Particles;
  fx: SuperFx;
  audio: AudioEngine;
  rig: CameraRig;
  /** the bus's mouth (this frame's) and its velocity */
  mouth(): THREE.Vector3;
  busVel(): THREE.Vector3;
  /** world points on the bus: the exhaust pipe, the roof hatch */
  exhaust(out: THREE.Vector3): THREE.Vector3;
  hatch(out: THREE.Vector3): THREE.Vector3;
  /** a normal tap splat (a release under superMin) */
  tap(): void;
  /** breathe a mega blast: the tap's breath path (anticipation, jet, blast) with a radius, a jet width x and a hit-stop */
  mega(shot: Shot, radius: number, width: number, hitStop: number): void;
  /** a palette flash centered on a world point */
  flash(at: THREE.Vector3, frames: number, strength: number): void;
  hitStop(frames: number): void;
  /** the street sign: the neighborhood the stream sweeps into */
  sign(ref: BuildingRef, hue: number): void;
}

const HIST = 96;

export class SuperSplat {
  phase: SuperPhase = 'ready';
  /** seconds since the phase began (game clock) */
  since = 0;
  /** seconds held so far while charging, and the charge (0..1) */
  held = 0;
  charge = 0;
  cooldownLeft = 0;
  cooldownTotal = 0;
  sinceDenied = Infinity;
  /** 0..1: spent after a firehose (fades over config.splat.superSpent) */
  spent = 0;
  /** the "HOLD" hint shows until the first charge */
  hint = true;

  // ---- outputs (main applies them every frame)
  /** bus scale x, extra nose-up (rad), jitter (m), camera distance x */
  swell = 1;
  pitch = 0;
  readonly shake = new THREE.Vector3();
  dolly = 1;
  /** 0..1: the rainbow circle spinning under the bus (the drop shadow) */
  circle = 0;

  /** QA: what the last super did */
  readonly stats = { kind: '', charge: 0, impacts: 0, blooms: 0, misses: 0, radius: 0, startedAt: 0, endedAt: 0 };

  private readonly h: SuperHost;
  private t = 0;
  private qaRelease = -1;
  /** leftover glow of a charge that was let go (0..1, fades) */
  private fade = 0;
  private beat = 0;
  private beatK = 0;
  private hoseT = 0;
  private hoseBorn = false;
  private acc = 0;
  private finale = false;
  private lastFlash = -10;
  private lastSign = -10;
  private lastHood = -1;
  private blobN = 0;
  private dollyV = 0;
  private moteAcc = 0;
  private sparkAcc = 0;
  private haloAcc = 0;
  private puffAcc = 0;
  private readonly live: GeyserLive = { target: new THREE.Vector3(), travel: 0.3, rate: 1, width: 1 };
  // where the stream was aimed, and when that lands (game clock): impacts follow the visible stream
  private readonly hT = new Float64Array(HIST);
  private readonly hX = new Float32Array(HIST);
  private readonly hY = new Float32Array(HIST);
  private readonly hZ = new Float32Array(HIST);
  private readonly hD = new Float32Array(HIST);
  private hHead = 0;
  private hCount = 0;
  private hUsed = -1;
  private readonly land = { x: 0, z: 0 };
  /** where the stream lands now (hoseAim) */
  private readonly aim = { x: 0, y: 0, z: 0, drop: 0, travel: 0.3 };
  private readonly v0 = new THREE.Vector3();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly viewObj: SuperView = { phase: 'ready', charge: 0, min: 0.3, cooldownLeft: 0, cooldownTotal: 0, since: 0, sinceDenied: Infinity, hint: true };
  private readonly tgt = [new THREE.Vector3()];
  private readonly hueOne = [0];

  constructor(host: SuperHost) {
    this.h = host;
  }

  /** The firehose is pouring (taps are blocked: the mouth is busy). */
  get hosing(): boolean {
    return this.phase === 'firehose';
  }

  // ------------------------------------------------------------------ input

  /** Input.onChargeStart: a hold became a charge (`heldSoFar` s already held). */
  chargeStart(heldSoFar = 0): void {
    const S = config.splat;
    if (this.phase === 'cooldown') {
      // "not yet": a fizzle, the meter shakes, a puff from the hatch
      this.sinceDenied = 0;
      this.h.audio.superFizzle();
      const p = this.h.hatch(this.v0);
      for (let i = 0; i < 3; i++) this.h.particles.puff(p, this.v1.set((Math.random() - 0.5) * 2, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 2), Ramp.GREY);
      this.h.fx.sparks(5, this.h.busVel(), 4);
      return;
    }
    if (this.phase !== 'ready') return;
    this.phase = 'charging';
    this.since = 0;
    this.held = clamp(heldSoFar, 0, S.superCharge);
    this.charge = this.held / Math.max(0.1, S.superCharge);
    this.beat = 0;
    this.beatK = 0;
    this.hint = false;
    this.h.audio.superChargeStart(Math.max(0.1, S.superCharge - this.held));
  }

  /** Input.onChargeEnd: the charging press lifted (or was cancelled: it slid into a steer, the app lost focus). */
  chargeEnd(_heldSeconds: number, cancelled: boolean): void {
    if (this.phase !== 'charging') return;
    const S = config.splat;
    this.qaRelease = -1;
    const k = this.charge;
    this.fade = k;
    if (cancelled) {
      this.phase = 'ready';
      this.since = 1;
      this.h.audio.superChargeStop(false);
      return;
    }
    if (k < S.superMin) {
      // a short hold is just a splat
      this.phase = 'ready';
      this.since = 1;
      this.h.audio.superChargeStop(true);
      this.h.tap();
      return;
    }
    this.fireMega(k);
  }

  /** QA: hold a charge until `seconds` held (starting `from` s in), then let go (>= superCharge: the firehose).
   * Returns the game time it lets go, or -1 ("not yet": cooling down). */
  qaCharge(seconds: number, from = 0): number {
    if (this.phase === 'cooldown') {
      this.chargeStart(0);
      return -1;
    }
    if (this.phase !== 'ready') return -1;
    this.chargeStart(Math.max(0, Math.min(from, seconds)));
    this.qaRelease = Math.max(0, seconds);
    return this.t + Math.min(seconds, config.splat.superCharge) - this.held;
  }

  /** QA: skip `seconds` of the cooldown. */
  qaSkip(seconds: number): void {
    if (this.phase === 'cooldown') this.cooldownLeft = Math.max(0.001, this.cooldownLeft - seconds);
    this.since += seconds;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const S = config.splat;
    const f = this.h.flight;
    this.t += dt;
    this.since += dt;
    this.sinceDenied += dt;
    if (this.phase === 'charging') {
      this.held += dt;
      this.charge = clamp(this.held / Math.max(0.1, S.superCharge), 0, 1);
      if (this.qaRelease >= 0 && this.held >= this.qaRelease && this.charge < 1) this.chargeEnd(this.held, false);
      else if (this.charge >= 1) this.startFirehose();
    } else if (this.phase === 'firehose') this.stepHose(dt);
    else if (this.phase === 'cooldown') {
      this.cooldownLeft -= dt;
      if (this.cooldownLeft <= 0) this.ready();
    }
    this.spent = this.phase === 'cooldown' && this.hoseBorn ? clamp(1 - this.since / Math.max(0.1, S.superSpent), 0, 1) : 0;
    this.fade = Math.max(0, this.fade - dt * 2.2);

    // the bus's speed: weighed down by the charge, held back while pouring, limping while spent
    if (this.phase === 'charging') f.speedScale = 1 - (1 - S.chargeSlow) * this.charge;
    else if (this.phase === 'firehose') f.speedScale = S.firehoseSlow;
    else if (this.spent > 0) f.speedScale = 1 - (1 - S.firehoseSlow) * this.spent * this.spent;
    else f.speedScale = 1;

    this.look(dt);
  }

  /** Writes the bus pose for this frame into `out` (a copy of `base`, the game's own pose). */
  pose(base: BusPose, out: BusPose): void {
    out.squash = base.squash;
    out.eye = base.eye;
    out.fullness = base.fullness;
    out.mouth = base.mouth;
    out.speed = base.speed;
    out.wheeze = base.wheeze;
    out.heave = base.heave;
    out.charge = Math.max(this.fade, 0);
    out.spent = this.spent;
    out.pulse = 0;
    if (this.phase === 'charging') {
      const c = this.charge;
      out.squash = base.squash * (1 - superTune.throb * this.beatK * (0.35 + 0.65 * c));
      out.wheeze = Math.max(base.wheeze, 0.3 + 0.7 * c);
      out.eye = base.eye + (Math.min(1, 0.65 + 0.4 * c) - base.eye) * Math.min(1, c * 3);
      out.charge = Math.max(c, this.fade);
      out.pulse = this.beatK;
      out.fullness = 1;
      out.heave = Math.max(base.heave, c > 0.7 ? (c - 0.7) * 1.6 * (0.5 + 0.5 * Math.sin(this.t * 7)) : 0);
    } else if (this.phase === 'firehose') {
      out.squash = 1.07 + 0.04 * Math.sin(this.t * 41);
      out.eye = 1;
      out.wheeze = 0.75;
      out.heave = 0.7 + 0.3 * Math.sin(this.t * 13);
      out.charge = 1;
      out.pulse = 0.5 + 0.5 * Math.sin(this.t * 31);
      out.fullness = 1;
    } else if (this.spent > 0) {
      const s = this.spent;
      out.wheeze = Math.max(base.wheeze, s);
      out.eye = base.eye + (0.3 - base.eye) * s;
      out.squash = base.squash * (1 - 0.05 * s);
    }
  }

  /** Camera: dolly toward / away from the bus (translation only: the pixel snap holds). After the rig, before its kick. */
  camera(cam: THREE.Camera, focus: THREE.Vector3, dt: number): void {
    const S = config.splat;
    const want = this.phase === 'charging' ? 1 - S.chargeCreep * Math.pow(this.charge, 1.5) : this.phase === 'firehose' ? 1 + superTune.hosePull : 1;
    const w = 2 * Math.PI * superTune.dollyHz;
    this.dollyV += (w * w * (want - this.dolly) - 2 * w * this.dollyV) * dt;
    this.dolly += this.dollyV * dt;
    if (Math.abs(this.dolly - 1) < 1e-4 && Math.abs(this.dollyV) < 1e-4) {
      this.dolly = 1;
      this.dollyV = 0;
      return;
    }
    cam.position.sub(focus).multiplyScalar(this.dolly).add(focus);
  }

  /** The meter's view of it (one reused object). */
  view(): SuperView {
    const v = this.viewObj;
    v.phase = this.phase;
    v.charge = this.charge;
    v.min = config.splat.superMin;
    v.cooldownLeft = Math.max(0, this.cooldownLeft);
    v.cooldownTotal = this.cooldownTotal;
    v.since = this.since;
    v.sinceDenied = this.sinceDenied;
    v.hint = this.hint;
    return v;
  }

  // ------------------------------------------------------------------ mega

  /** The shot a super fires now: at the glinting building when the belly is loaded, else picked at the aim point. */
  private shotNow(): Shot {
    const h = this.h;
    const f = h.flight;
    if (Aimer.loaded(f) && h.aimer.shown()) return h.aimer.fire(f);
    const S = config.splat;
    h.aimer.point(f);
    const aim = h.aimer.aim;
    const target = h.splatter.pick(aim.x, aim.z, h.splatter.pickRadius(aim.drop));
    let x = aim.x, z = aim.z;
    if (target) {
      const l = h.city.landingOn(target, x, z, S.landInset, this.land, S.smallRad);
      x = l.x;
      z = l.z;
    }
    const iy = target ? h.city.roofAtPart(target, x, z) + 0.5 : h.city.groundAt(x, z);
    return { target, x, z, y: undefined, exact: false, drop: Math.max(0, f.y - iy), travel: aim.travel };
  }

  private fireMega(k: number) {
    const S = config.splat;
    const u = clamp((k - S.superMin) / Math.max(0.01, 1 - S.superMin), 0, 1);
    const shot = this.shotNow();
    const radius = blastRadiusFor(shot.drop) * (1 + (S.megaGain - 1) * u);
    const width = 1 + (S.megaWidth - 1) * u;
    const hitStop = Math.round(S.hitStopFrames + (S.megaHitStop - S.hitStopFrames) * u);
    this.h.audio.superChargeStop(true);
    this.h.mega(shot, radius, width, hitStop);
    this.h.audio.superMega(k);
    this.h.rig.kick(1.5 + 2 * u);
    this.h.fx.sparks(Math.round(20 + 40 * u), this.h.busVel(), 14);
    this.phase = 'cooldown';
    this.hoseBorn = false;
    this.since = 0;
    this.cooldownTotal = this.cooldownLeft = Math.max(1, S.superCooldown * k);
    Object.assign(this.stats, { kind: 'mega', charge: k, impacts: 1, blooms: 0, misses: 0, radius, startedAt: this.t, endedAt: this.t });
  }

  // ------------------------------------------------------------------ firehose

  private startFirehose() {
    const S = config.splat;
    const h = this.h;
    const f = h.flight;
    this.phase = 'firehose';
    this.since = 0;
    this.hoseT = 0;
    this.acc = 0;
    this.finale = false;
    this.hCount = 0;
    this.hUsed = -1;
    this.lastHood = -1;
    this.lastSign = -10;
    this.charge = 1;
    // the belly pours out into the hose; the recoil knocks the bus back
    f.barfT = -1;
    f.fullness = 0;
    f.speed *= S.firehoseKick;
    f.vy += 5;
    const aim = this.hoseAim();
    this.live.target.set(aim.x, aim.y, aim.z);
    this.live.travel = aim.travel;
    this.live.rate = S.firehoseFlow * Math.min(1, 0.5 / this.live.travel);
    this.live.width = S.firehoseWidth * (1 + aim.drop / Math.max(10, S.firehoseWidthDrop));
    this.tgt[0].copy(this.live.target);
    this.hueOne[0] = Math.floor(Math.random() * HUE_COUNT);
    h.particles.geyser({
      source: h.mouth, sourceVel: h.busVel, targets: this.tgt, hues: this.hueOne,
      duration: S.firehoseDuration, travelTime: this.live.travel, width: S.firehoseWidth, live: this.live, taper: 0.94,
    });
    h.audio.superFirehose(S.firehoseDuration);
    h.flash(h.mouth(), 2, 0.9);
    h.rig.kick(3.2);
    h.fx.sparks(50, h.busVel(), 16);
    Object.assign(this.stats, { kind: 'firehose', charge: 1, impacts: 0, blooms: 0, misses: 0, radius: S.firehoseRadius, startedAt: this.t, endedAt: 0 });
  }

  private stepHose(dt: number) {
    const S = config.splat;
    this.hoseT += dt;
    const D = S.firehoseDuration;
    // the stream's landing point now: the aim ray (from altitude it pours down mid-screen)
    const aim = this.hoseAim();
    this.live.target.set(aim.x, aim.y, aim.z);
    this.live.travel = aim.travel;
    // (as many particles alive however long the stream; wider from up high, where it lands meters per pixel away)
    this.live.rate = S.firehoseFlow * Math.min(1, 0.5 / this.live.travel);
    this.live.width = S.firehoseWidth * (1 + aim.drop / Math.max(10, S.firehoseWidthDrop));
    if (this.hoseT <= D && dt > 0) {
      const i = this.hHead;
      this.hT[i] = this.t + this.live.travel;
      this.hX[i] = aim.x;
      this.hY[i] = aim.y;
      this.hZ[i] = aim.z;
      this.hD[i] = aim.drop;
      this.hHead = (i + 1) % HIST;
      if (this.hCount < HIST) this.hCount++;
    }
    // impacts: firehoseRate a second (at most one per frame) where the stream comes down now
    if (dt > 0) {
      this.acc = Math.min(1.5, this.acc + dt * S.firehoseRate);
      if (this.acc >= 1 && this.impactNow(false)) this.acc -= 1;
    }
    // the stream has run dry and its last drops are down: the closing blast
    if (this.hoseT > D && !this.finale) {
      const last = this.hCount ? (this.hHead - 1 + HIST) % HIST : -1;
      if (last < 0 || this.hT[last] <= this.t + superTune.lead || this.hoseT > D + 3) {
        this.finale = true;
        this.impactNow(true);
        this.phase = 'cooldown';
        this.hoseBorn = true;
        this.since = 0;
        this.cooldownTotal = this.cooldownLeft = Math.max(1, S.superCooldown);
        this.stats.endedAt = this.t;
      }
    }
  }

  /**
   * Where the stream lands now: the breath's aim (Aim.ts: from up high the forward-down ray, where the player
   * looks), reaching firehoseReach x the breath's range near the rooftops; its flight time as the breath's up
   * to the classic range, firehoseSpeed x faster past it.
   */
  private hoseAim() {
    const S = config.splat;
    const h = this.h;
    const f = h.flight;
    h.aimer.point(f);
    const a = h.aimer.aim;
    const out = this.aim;
    out.x = a.x;
    out.y = a.y;
    out.z = a.z;
    const r0 = S.range + S.rangePerSpeed * f.speed;
    const want = r0 * S.firehoseReach;
    if (Math.hypot(a.x - f.x, a.z - f.z) < want) {
      out.x = f.x + f.fx * want;
      out.z = f.z + f.fz * want;
      out.y = h.city.surfaceAt(out.x, out.z);
    }
    out.drop = Math.max(0, f.y - out.y);
    const dist = Math.hypot(out.x - f.x, out.z - f.z, out.drop);
    out.travel = Math.max(0.05, S.impactDelay - S.inhale) + Math.max(0, dist - Math.hypot(r0, 12)) / Math.max(20, S.projectileSpeed * S.firehoseSpeed);
    return out;
  }

  /** A blast where the stream is landing now (the newest aim sample due by now): a hose impact, or the finale. */
  private impactNow(finale: boolean): boolean {
    const S = config.splat;
    const h = this.h;
    let best = -1;
    for (let k = 0; k < this.hCount; k++) {
      const i = (this.hHead - 1 - k + HIST * 2) % HIST;
      if (this.hT[i] <= this.t + superTune.lead) {
        best = i;
        break;
      }
    }
    if (best < 0 && finale && this.hCount) best = (this.hHead - 1 + HIST) % HIST;
    if (best < 0 || (!finale && this.hT[best] <= this.hUsed)) return false;
    this.hUsed = this.hT[best];
    const x = this.hX[best], z = this.hZ[best], y = this.hY[best], drop = this.hD[best];
    const grow = blastRadiusFor(drop) / S.blastRadius;
    const target = h.city.buildingAt(x, z);
    const travel = Math.max(0.02, this.hT[best] - this.t);
    if (finale) {
      h.splatter.barf(x, z, { radius: S.firehoseRadius * S.firehoseFinale * grow, travel, drop, target, y: y + 0.3, exact: true, stream: true, hitStop: S.firehoseFinaleHitStop });
    } else {
      h.splatter.barf(x, z, { radius: S.firehoseRadius * grow, travel, drop, target, y: y + 0.3, exact: true, hose: true });
      this.stats.impacts++;
      if (h.splatter.lastMiss) this.stats.misses++;
    }
    return true;
  }

  /** A firehose impact lands (Splatter's impact callback, Blast.hose): its lighter fx. */
  impact(b: Blast): void {
    const S = config.splat;
    const T = superTune;
    const h = this.h;
    const P = h.particles;
    P.splash(b.pos, b.spec.hue, T.hoseSplash);
    P.burst(b.pos, b.spec.hue, T.hoseBurst, h.city.groundAt(b.pos.x, b.pos.z));
    // a few flung blobs, each landing on a spatter dot the ground paint already holds
    const every = Math.max(1, Math.round(T.hoseBlobEvery));
    for (const dot of b.dots) {
      if (!dot.blob || this.blobN++ % every !== 0) continue;
      const from = this.v0.set(b.pos.x + (Math.random() - 0.5) * 4, b.pos.y + 1 + Math.random() * 2, b.pos.z + (Math.random() - 0.5) * 4);
      const to = this.v1.set(dot.x, (h.city.roofAt(dot.x, dot.z) ?? h.city.groundAt(dot.x, dot.z)) + 0.15, dot.z);
      P.fling(from, to, blobFlight(dot), dot.hue, 0.7 + dot.rad * 0.5);
    }
    h.rig.kick(S.firehoseShake * Math.sqrt(b.strength));
    if (this.t - this.lastFlash >= 1 / Math.max(0.5, S.firehoseFlashes)) {
      this.lastFlash = this.t;
      h.flash(b.pos, 1, 0.6);
    }
    h.audio.superHoseHit();
    this.stats.blooms += b.count;
    const p = b.primary;
    if (p && p.hood !== this.lastHood && this.t - this.lastSign > 1.2) {
      this.lastHood = p.hood;
      this.lastSign = this.t;
      h.sign(p, b.spec.hue);
    }
  }

  // ------------------------------------------------------------------ cooldown

  private ready() {
    this.phase = 'ready';
    this.since = 0;
    this.cooldownLeft = 0;
    this.h.audio.superReady();
    this.h.fx.halo(36, 0.9, 5);
    this.h.fx.sparks(16, this.h.busVel(), 6);
  }

  // ------------------------------------------------------------------ look

  /** The bus's body language and the charge's particles. */
  private look(dt: number) {
    const T = superTune;
    const h = this.h;
    const fx = h.fx;
    const rnd = Math.random;
    this.shake.set(0, 0, 0);
    this.pitch = 0;
    this.swell = 1;
    this.circle = this.phase === 'charging' ? Math.pow(this.charge, 0.7) : this.phase === 'firehose' ? Math.max(0, 1 - this.hoseT / 0.6) : this.fade;
    this.beatK *= Math.exp(-dt * 9);
    if (this.phase === 'charging') {
      const c = this.charge;
      // the heartbeat (the audio's own rhythm): each beat throbs the bus
      this.beat += dt / heartInterval(c);
      if (this.beat >= 1) {
        this.beat -= Math.floor(this.beat);
        this.beatK = 1;
      }
      this.swell = 1 + T.swell * Math.pow(c, 1.4) + 0.025 * this.beatK * (0.3 + c);
      const sh = T.shudder * c * c;
      this.shake.set((rnd() - 0.5) * sh, (rnd() - 0.5) * sh * 0.6, (rnd() - 0.5) * sh);
      this.pitch = -0.05 * c + 0.012 * Math.sin(this.t * 33) * c;
      // energy pulled in from the city, faster and thicker as it fills
      this.moteAcc += dt * T.motes * (0.1 + 0.9 * c * c);
      const nm = Math.floor(this.moteAcc);
      if (nm > 0) {
        this.moteAcc -= nm;
        fx.motes(nm, T.moteReach * (0.55 + 0.45 * c), T.moteLife * (1 - 0.35 * c));
      }
      fx.arcs = c < 0.18 ? 0 : 0.12 + 0.88 * Math.pow((c - 0.18) / 0.82, 1.3);
      this.sparkAcc += dt * T.sparks * Math.max(0, c - 0.25) * 1.33;
      const ns = Math.floor(this.sparkAcc);
      if (ns > 0) {
        this.sparkAcc -= ns;
        fx.sparks(ns, h.busVel(), 5 + 7 * c);
      }
      this.haloAcc += dt * T.halo * Math.max(0, c - 0.35) / 0.65;
      const nh = Math.floor(this.haloAcc);
      if (nh > 0) {
        this.haloAcc -= nh;
        fx.halo(nh, 1.1, 5 + 2 * c);
      }
      // the pot about to boil over: steam out of the hatch
      this.puffAcc += dt * T.steam * Math.max(0, c - 0.4) * 1.67;
      if (this.puffAcc >= 1) {
        this.puffAcc -= 1;
        const p = h.hatch(this.v0);
        h.particles.puff(p, this.v1.set((rnd() - 0.5) * 2, 4 + rnd() * 3, (rnd() - 0.5) * 2).add(this.v2.copy(h.busVel()).multiplyScalar(0.6)), Ramp.WHITE);
      }
    } else if (this.phase === 'firehose') {
      const sh = T.hoseShudder;
      this.shake.set((rnd() - 0.5) * sh, (rnd() - 0.5) * sh * 0.6, (rnd() - 0.5) * sh);
      const up = Math.min(1, this.hoseT / 0.15);
      this.pitch = T.hoseRear * up * up * (3 - 2 * up) + 0.03 * Math.sin(this.t * 27);
      this.swell = 1 + T.swell * 0.6 * Math.max(0, 1 - this.hoseT / 1.5);
      fx.arcs = 0.7 + 0.3 * Math.sin(this.t * 9);
      this.sparkAcc += dt * T.sparks;
      const ns = Math.floor(this.sparkAcc);
      if (ns > 0) {
        this.sparkAcc -= ns;
        fx.sparks(ns, h.busVel(), 12);
      }
    } else {
      fx.arcs = this.fade > 0.2 ? this.fade * 0.5 : this.spent > 0.5 ? 0.06 : 0;
      if (this.spent > 0) {
        const s = this.spent;
        this.pitch = -0.07 * s;
        this.swell = 1 - 0.05 * s;
        // spent: dark smoke out of the exhaust and the hatch
        this.puffAcc += dt * T.smoke * s;
        if (this.puffAcc >= 1) {
          this.puffAcc -= 1;
          const fromHatch = rnd() < 0.4;
          const p = fromHatch ? h.hatch(this.v0) : h.exhaust(this.v0);
          const bv = h.busVel();
          h.particles.puff(p, this.v1.set(-bv.x * 0.15 + (rnd() - 0.5) * 2, 1.5 + rnd() * 2, -bv.z * 0.15 + (rnd() - 0.5) * 2), fromHatch ? Ramp.GREY : Ramp.INK);
        }
      } else if (this.phase === 'ready' && this.since < 0.5) this.swell = 1 + 0.06 * Math.sin(Math.PI * (this.since / 0.5));
    }
  }
}
