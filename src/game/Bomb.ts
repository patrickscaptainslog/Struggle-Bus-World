import * as THREE from 'three';
import { config } from '../config';
import { clamp } from './springs';
import { Aimer, type Shot } from './Aim';
import type { Flight } from './Flight';
import { inputTune, type Input } from './Input';
import type { SuperTag } from './Splat';
import { blastRadiusFor } from './blastLayout';
import type { AudioEngine } from '../audio/AudioEngine';
import { heartInterval } from '../audio/superSfx';
import type { SuperFx } from '../fx/SuperFx';
import type { CameraRig } from './CameraRig';
import type { BusPose } from '../bus/BusModel';

// The Bomb (docs/specs/shots/SHOTS.md, "The modes"): a still hold on the bus itself charges it, and the lift lets it go. Behind &bomb on the link until the
// producer's grip test; without it nothing here runs, and every hook below does nothing.
//
// Input reads the gesture (Input.busBox, the still hold, its slops, the tiers shown aimLagMs late on a frame, the cancels and the two-finger rules) and
// says when the charge begins (0.35 s, a full belly), when a tier shows (II at 0.6 s, III at 1.2 s from the charge's start) and when it ends. This plays the
// tell and fires: MEGA's riser and an inhale at the start; at II a clunk, the bus 6 % bigger and a ring 1.4 times the tap's circle where it will land; at III a
// bigger clunk and a bell, MEGA's heartbeat and motes, 12 % and the ring at 1.8 times, pulsing. Nothing it does moves a flight or camera number: the swell is
// the bus's look alone. Let go at II or III, it is MEGA's breath (main.ts's breatheNow) where the tap would land, 1.4 or 1.8 times blastRadiusFor(drop),
// each building jumping two or three stages, never past 3, and the belly refills in 3 or 4.5 s. At Nonstop and faster that's where the Comet would land
// (Comet.ts's plan and chooseShot, through Aimer.fire): ahead, in view, with the Comet's full show every time and no hit-stop that far off. On the
// Moon's ground its craters take the jumps (CraterPaint), all with the wave. A lift before II is the tap, held on it stays III and never
// fires by itself, and a cancel fizzles with the belly kept.
//
// The hooks (holds.bomb, docs/specs/shots/HOOKS.md): gift(3), a Bomb III at 0.42 s on the next still hold on the bus (being hit, Recess's); bank(0.1), a
// caught drop bringing the next charge's tiers 0.12 s sooner; charge and tier; watch() for each tier, the release and a cancel.
//
// Frame order (main.ts): update() before input.update reads what it set (the belly, the gift, the bank), and after the aim; pose() into the bus's pose.

/** What a watcher hears of a Bomb (holds.bomb.watch): every method optional. */
export interface BombWatch {
  /** a tier showed: 1 the charge began, 2 Bomb II, 3 Bomb III */
  tier?(tier: number): void;
  /** it was let go: where it lands (world m), its circle (m), the game time it lands (the Splatter's clock, globals.uTime) and its SuperTag's id */
  release?(r: { tier: number; x: number; z: number; r: number; arrive: number; id: number }): void;
  /** it fizzled, the belly kept (moved off, three fingers, lost, a hand-over, another thumb's tap) */
  cancel?(): void;
}

/** holds.bomb: the Bomb's side for life and Recess. Without &bomb on the link all of it does nothing. */
export interface BombHook {
  /** the next still hold on the bus is a Bomb of this tier at aimHoldMs + aimLagMs, one time, whatever the belly holds (after being hit: 3) */
  gift(tier?: number): void;
  /** a caught drop: k of a charge banked, each 0.1 bringing the next charge's tiers config.bomb.bankGain x 0.1 s sooner, never before aimHoldMs */
  bank(k?: number): void;
  /** the charge now, 0-1 (1 at III), and the tier (0 none, 1 charging, 2, 3) */
  readonly charge: number;
  readonly tier: number;
  /** hear every Bomb; returns the remover */
  watch(w: BombWatch): () => void;
}

/** A Bomb's breath: MEGA's (main.ts's MegaBreath), with the stages it jumps. */
export interface BombBreath {
  radius: number;
  width: number;
  hitStop: number;
  tag: SuperTag;
  jump: number;
}

/** What the Bomb needs from the game (main.ts). */
export interface BombHost {
  input: Input;
  flight: Flight;
  aimer: Aimer;
  audio: AudioEngine;
  fx: SuperFx;
  rig: CameraRig;
  busVel(): THREE.Vector3;
  /** breathe a Bomb: the tap's breath path with MEGA's radius, jet width and hit-stop. Returns the game time it lands */
  breathe(shot: Shot, b: BombBreath): number;
  /** the belly is busy elsewhere: the Hose pours, or a breath is under way */
  busy(): boolean;
}

export class Bomb implements BombHook {
  /** &bomb is on the link (Controls): off, nothing here runs */
  on = false;
  /** outputs, applied by main.ts every frame: the bus's scale x (its look alone), and the ring where it will land (k 0 = none; pulse 0-1) */
  swell = 1;
  readonly ring = { x: 0, z: 0, r: 0, k: 0, pulse: 0 };
  /** QA: what the last Bomb did */
  readonly stats = { charges: 0, fired: 0, fizzles: 0, taps: 0, tier: 0, radius: 0, jump: 0, at: [0, 0] as [number, number], recharge: 0, gift: 0, sooner: 0 };

  private readonly h: BombHost;
  private tierV = 0;
  private serial = 0;
  private giftTier = 0;
  private banked = 0;
  private readonly watchers: BombWatch[] = [];
  /** the look: the swell's spring, the ring's glow, the heartbeat, the motes */
  private swellTo = 1;
  private swellV = 0;
  private ringK = 0;
  private beat = 0;
  private beatK = 0;
  private moteAcc = 0;
  private haloAcc = 0;
  private sparkAcc = 0;
  private t = 0;

  constructor(host: BombHost) {
    this.h = host;
    const I = host.input;
    I.onBombCharge = () => this.charged();
    I.onBombTier = (tier) => this.tiered(tier);
    I.onBombEnd = (tier, cancelled) => this.ended(tier, cancelled);
  }

  // ------------------------------------------------------------------ the hooks

  gift(tier = 3): void {
    if (this.on) this.giftTier = Math.max(this.giftTier, tier >= 3 ? 3 : 2);
  }

  bank(k = 0.1): void {
    if (this.on) this.banked = clamp(this.banked + k, 0, 1);
  }

  get charge(): number {
    const B = this.h.input.state.bomb;
    if (!this.on || !B.on) return 0;
    return this.tierV >= 3 ? 1 : clamp((performance.now() - B.at) / 1000 / config.bomb.three, 0, 0.99);
  }

  get tier(): number {
    return this.on ? this.tierV : 0;
  }

  watch(w: BombWatch): () => void {
    this.watchers.push(w);
    return () => {
      const i = this.watchers.indexOf(w);
      if (i >= 0) this.watchers.splice(i, 1);
    };
  }

  private tell(fn: (w: BombWatch) => void) {
    for (const w of this.watchers) {
      try {
        fn(w);
      } catch (err) {
        console.error('Bomb: a watcher threw', err);
      }
    }
  }

  // ------------------------------------------------------------------ Input's callbacks

  /** The charge began: MEGA's riser and an inhale, toward III. */
  private charged() {
    this.tierV = 1;
    this.stats.charges++;
    this.h.audio.bombCharge(Math.max(0.1, this.threeAt() - inputTune.aimHoldMs / 1000));
    this.tell((w) => w.tier?.(1));
  }

  /** A tier showed: its clunk, the swell, the ring. */
  private tiered(tier: number) {
    this.tierV = tier;
    this.stats.tier = tier;
    this.h.audio.bombTier(tier);
    this.tell((w) => w.tier?.(tier));
  }

  /** The hold ended: let go at II or III it fires; before II a tap follows (Input's); cancelled, a fizzle with the belly kept. */
  private ended(tier: number, cancelled: boolean) {
    this.tierV = 0;
    if (cancelled) {
      this.stats.fizzles++;
      this.h.audio.bombStop(false);
      this.tell((w) => w.cancel?.());
      return;
    }
    if (tier < 2) {
      // (the tap's own breath follows, from Input)
      this.stats.taps++;
      this.h.audio.bombStop(true);
      return;
    }
    this.fire(tier >= 3 ? 3 : 2);
  }

  /** The tiers' times (s from the charge's start), the bank's taken off, never before the riser's; a gift's straight to its tier at the riser. */
  private twoAt(): number {
    const riser = inputTune.aimHoldMs / 1000;
    return this.giftTier ? riser : Math.max(riser, config.bomb.two - config.bomb.bankGain * this.banked);
  }
  private threeAt(): number {
    const riser = inputTune.aimHoldMs / 1000;
    return this.giftTier ? riser : Math.max(riser, config.bomb.three - config.bomb.bankGain * this.banked);
  }

  private fire(tier: 2 | 3) {
    const H = this.h, f = H.flight, B = config.bomb, three = tier === 3;
    // (where the tap would land: what glints, the tap's own shot)
    const shot = H.aimer.fire(f);
    if (this.giftTier) {
      // (a gift is a Bomb whatever the belly holds, as MEGA's blast was)
      f.barfT = -1;
      f.fullness = 1;
    }
    if (!f.tryBarf()) {
      // (a tier shows only with a full belly, so this is a breath that started under the thumb: it fizzles, nothing spent)
      this.stats.fizzles++;
      H.audio.bombStop(false);
      this.tell((w) => w.cancel?.());
      return;
    }
    const r = blastRadiusFor(shot.drop) * (three ? B.radius3 : B.radius2);
    const tag: SuperTag = { kind: 'bomb', charge: three ? 1 : 0.5, id: ++this.serial };
    const jump = three ? B.jump3 : B.jump2;
    H.audio.bombStop(true);
    const arrive = H.breathe(shot, { radius: r, width: three ? B.width3 : B.width2, hitStop: shot.comet ? 0 : three ? B.hitStop3 : B.hitStop2, tag, jump });
    f.rechargeSeconds = three ? B.recharge3 : B.recharge2;
    H.audio.superMega(three ? 1 : 0.55);
    H.rig.kick(three ? 4 : 2.8);
    H.fx.sparks(three ? 60 : 36, H.busVel(), 14);
    Object.assign(this.stats, { fired: this.stats.fired + 1, tier, radius: r, jump, at: [shot.x, shot.z], recharge: f.rechargeSeconds, gift: this.giftTier, sooner: B.bankGain * this.banked });
    this.giftTier = 0;
    this.banked = 0;
    this.tell((w) => w.release?.({ tier, x: shot.x, z: shot.z, r, arrive, id: tag.id }));
  }

  // ------------------------------------------------------------------ frame

  /** Before input.update: what Input's tiers wait on. Then the look. */
  update(dt: number): void {
    const I = this.h.input;
    this.t += dt;
    I.bombOn = this.on;
    if (!this.on) return;
    const f = this.h.flight;
    // (a tier waits for a full belly; a gift for no breath under way)
    I.bombFull = !this.h.busy() && (this.giftTier ? f.barfT < 0 : Aimer.loaded(f));
    I.bombGift = this.giftTier;
    I.bombTwoMs = this.twoAt() * 1000;
    I.bombThreeMs = this.threeAt() * 1000;
    this.look(dt);
  }

  /** The bus's pose with the charge on it: the band racing, the heartbeat's throb at III. */
  pose(out: BusPose): void {
    if (!this.on || this.tierV === 0) return;
    const c = this.charge;
    out.charge = Math.max(out.charge ?? 0, c);
    out.fullness = 1;
    if (this.tierV >= 3) out.pulse = Math.max(out.pulse ?? 0, this.beatK);
    out.wheeze = Math.max(out.wheeze, 0.3 + 0.5 * c);
  }

  private look(dt: number) {
    const T = this.tierV, B = config.bomb, A = this.h.aimer;
    this.swellTo = T >= 3 ? 1 + B.swell3 : T >= 2 ? 1 + B.swell2 : 1;
    // (a stiff spring: the clunk is the bus snapping bigger, a little past, and settling. Stepped at 1/120 s at most: in one step of a 30 fps frame it
    // grew by a quarter a frame, and the bus with it, off the screen in a second)
    const w = 2 * Math.PI * 6, steps = Math.max(1, Math.ceil(dt * 120 - 1e-9)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.swellV += (w * w * (this.swellTo - this.swell) - 2 * 0.55 * w * this.swellV) * h;
      this.swell += this.swellV * h;
    }
    if (T === 0 && Math.abs(this.swell - 1) < 1e-4 && Math.abs(this.swellV) < 1e-4) {
      this.swell = 1;
      this.swellV = 0;
    }
    // the ring where it will land: the tap's circle, x 1.4 at II, 1.8 pulsing at III
    this.ringK = T >= 2 ? Math.min(1, this.ringK + dt * 8) : Math.max(0, this.ringK - dt * 4);
    const R = this.ring;
    R.k = this.ringK;
    if (T >= 2) {
      // (at Nonstop and faster where the Comet would land, ahead in view: Comet.ts's plan this frame, the shot Aimer.fire hands over)
      const P = A.planned;
      R.x = P ? P.x : A.aim.x;
      R.z = P ? P.z : A.aim.z;
      R.r = blastRadiusFor(P ? P.drop : A.aim.drop) * (T >= 3 ? B.radius3 : B.radius2);
    }
    this.beatK *= Math.exp(-dt * 9);
    R.pulse = T >= 3 ? this.beatK : 0;
    if (T >= 3) {
      // MEGA's heartbeat at a full charge, for as long as it's held
      this.beat += dt / heartInterval(1);
      if (this.beat >= 1) {
        this.beat -= Math.floor(this.beat);
        this.beatK = 1;
        this.h.audio.bombBeat();
      }
    } else this.beat = 0.6;
    if (T === 0) return;
    // MEGA's built look, in the bus's faction's spray (SuperFx.palette, main.ts): its motes pulled in from the charge's start, a fifth of III's before II and
    // half at II (MEGA's floor, no halo), and at III all of them, with its halo orbiting the bus and its sparks
    const fx = this.h.fx;
    this.moteAcc += dt * B.motes * (T >= 3 ? 1 : T >= 2 ? 0.5 : 0.2);
    const n = Math.floor(this.moteAcc);
    if (n > 0) {
      this.moteAcc -= n;
      fx.motes(n, 115 * 0.8, 0.9);
    }
    if (T < 3) return;
    this.haloAcc += dt * B.halo;
    const nh = Math.floor(this.haloAcc);
    if (nh > 0) {
      this.haloAcc -= nh;
      fx.halo(nh, 1.1, 7);
    }
    this.sparkAcc += dt * B.sparks;
    const ns = Math.floor(this.sparkAcc);
    if (ns > 0) {
      this.sparkAcc -= ns;
      fx.sparks(ns, this.h.busVel(), 12);
    }
  }
}
