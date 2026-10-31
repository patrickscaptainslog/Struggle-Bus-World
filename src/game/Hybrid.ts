import * as THREE from 'three';
import { registerTunables } from '../ui/tunables';
import type { TiltCore } from './Tilt';

// The hybrid: the phone flies the bus until a thumb flies it. No DOM.
//
// One gesture model whether tilt is on or off; this decides one thing: what the
// flight stick reads while tilt is running (docs/specs/hybrid-controls.md 1).
//  - An undecided finger leaves tilt flying (only the calm window runs: a press
//    shakes the phone, and a tap must not steer).
//  - A committed thumb replaces tilt on both axes: tilt's value freezes and
//    fades out under it. Held still, a thumb reads 0: dead straight.
//  - TURBO, its down tab and the tilt toggle clutch too: a reach to the upper
//    left swings the phone before the finger lands, so what they remember is
//    the pose ~0.45 s before the press. A boost stays clutched until the lift.
//  - The lift hands back only what makes sense. Phone unmoved: tilt eases in
//    with continuity. Moved 5 degrees or more: the stick rests at 0 until the
//    hand settles (the aim latch's job). Either way the neutral (`TiltCore`'s,
//    the only zero) moves so tilt reads `d`: a nudge resumes its carve, a new
//    hold becomes level, and a carve never returns larger than it was handed over.
//
// Input.update owns the single arbitration site and calls update() once per
// frame on the wall clock (a hit-stop must not stall a handover). Sensitivity
// never changes. Gain starts at 0 and only wake() raises it.

/** What the mixer needs from the tilt (TiltControl): Flight semantics, read after update(). */
export interface StickSource {
  readonly sx: number;
  readonly sy: number;
  /** calibrated, samples flowing */
  readonly active: boolean;
  /** the load-time quiet listen: never steers */
  readonly probing: boolean;
  readonly core: TiltCore;
  update(): void;
}

/** Live-tunable handover numbers (tuner group "Hybrid"): all estimates until a real phone sets them. */
export const mixTune = {
  /** After any touch-down or lift: no speed term in the filter, no prediction (s). */
  calm: 0.18,
  /** Tilt fades out under a thumb (s), and eases back in after a lift (time constant, s). */
  fadeOut: 0.16,
  fadeIn: 0.12,
  /** Moved this far (deg) between land and lift: the hand was in it, so settle before handing back. */
  settleMoved: 5,
  /** Settle: at least, at most, at most after a button reach (s), and calm under this rate (deg/s). */
  settleMin: 0.35,
  settleMax: 1.0,
  reachMax: 0.9,
  settleRate: 12,
  /** The hand-back's new-hold share: a thumb held rebaseT0..rebaseT1 s, or the phone moved rebaseA0..rebaseA1 deg. */
  rebaseT0: 0.6,
  rebaseT1: 2.0,
  rebaseA0: 5,
  rebaseA1: 12,
  /** After a rebase of more than trackMin deg the neutral follows the pose for track s... */
  track: 0.15,
  trackMin: 0.5,
  /** ...and when the neutral moved settleMoved deg or more, or the phone did, motion back toward the old neutral is absorbed for grace s (0 disables). */
  grace: 1.5,
  /** The master gain's ramps (s): up when tilt goes live, down for the toggle, the settings, an app switch. */
  gainIn: 0.5,
  gainOut: 0.2,
  /** A reach remembers the pose this long before its press (s). */
  pastAge: 0.45,
};

registerTunables('Hybrid', mixTune as unknown as Record<string, unknown>, {
  calm: [0, 0.5, 0.01],
  fadeOut: [0.02, 0.6, 0.01],
  fadeIn: [0.02, 0.6, 0.01],
  settleMoved: [1, 20, 0.5],
  settleMin: [0, 1, 0.01],
  settleMax: [0.2, 3, 0.05],
  reachMax: [0.2, 3, 0.05],
  settleRate: [2, 60, 1],
  rebaseT0: [0, 3, 0.05],
  rebaseT1: [0.2, 6, 0.05],
  rebaseA0: [0, 15, 0.5],
  rebaseA1: [1, 30, 0.5],
  track: [0, 0.6, 0.01],
  trackMin: [0, 3, 0.05],
  grace: [0, 4, 0.05],
  gainIn: [0.05, 2, 0.05],
  gainOut: [0.05, 1, 0.05],
  pastAge: [0.15, 0.6, 0.01],
});

export type MixPhase = 'live' | 'thumb' | 'settle';
type Owner = 'thumb' | 'reach';

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const sm = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
const ss = (a: number, b: number, x: number) => sm((x - a) / Math.max(1e-6, b - a));
const DEG = 180 / Math.PI;

export class TiltMix {
  phase: MixPhase = 'live';
  /** one flag per owner, never a count */
  thumbHeld = false;
  reachHeld = false;
  /** a thumb clutched since the last hand-back */
  thumbUsed = false;
  /** the master gain (0..1), where it is heading, and a toggle-off waiting for it to reach 0 */
  g = 0;
  gTarget = 0;
  offPending = false;
  /** the arbitrated stick */
  readonly out = { x: 0, y: 0 };
  private readonly src: StickSource;
  private readonly a = { x: 1, y: 1 };
  private readonly held = { x: 0, y: 0 };
  private readonly gLand = new THREE.Vector3(0, 0, -1);
  private readonly rLand = { r: 0, p: 0 };
  private readonly rNow = { r: 0, p: 0 };
  private readonly tNew = { x: 0, y: 0 };
  private fadeT = 0;
  private settleT = 0;
  private settleCap = mixTune.settleMax;
  private tClutch = 0;
  private tLift = 0;

  constructor(src: StickSource) {
    this.src = src;
  }

  /** Tilt is running (and this isn't the load-time probe). */
  get live(): boolean {
    return this.src.active && !this.src.probing;
  }

  private now(): number {
    return performance.now() / 1000;
  }

  /** Any touch-down or lift, on the screen or any button: the hand shakes the phone. */
  blip(): void {
    if (this.live) this.src.core.calm(this.now() + mixTune.calm);
  }

  /** A new primary touched down: note the pose. */
  land(): void {
    if (!this.live || this.thumbHeld || this.reachHeld || this.phase === 'settle') return;
    const c = this.src.core;
    this.gLand.copy(c.g);
    c.anglesOf(this.gLand, this.rLand);
  }

  /** The finger became a steering thumb (Input.commitDrag). */
  clutch(): void {
    if (!this.live || this.thumbHeld) return;
    // (a commit during a settle keeps that session's clock)
    if (!this.thumbUsed) {
      this.tClutch = this.now();
      this.thumbUsed = true;
    }
    this.thumbHeld = true;
    this.enter();
  }

  /** TURBO, its down tab or the toggle went down: a reach, so remember the pose from before it started. */
  reachDown(): void {
    if (!this.live || this.reachHeld) return;
    if (!this.thumbHeld && this.phase !== 'settle') {
      const c = this.src.core;
      c.pastG(this.gLand, mixTune.pastAge);
      c.anglesOf(this.gLand, this.rLand);
    }
    this.reachHeld = true;
    this.enter();
  }

  reachUp(): void {
    this.release('reach');
  }

  private enter() {
    if (this.phase !== 'thumb') {
      this.phase = 'thumb';
      this.fadeT = 0;
      // (out, not the live tilt: out is 0 in a settle and continuous in live, so no kick)
      this.held.x = this.out.x;
      this.held.y = this.out.y;
      this.src.core.autoHold = true;
    }
  }

  release(owner: Owner): void {
    if (!this.live) return;
    if (owner === 'thumb') {
      if (!this.thumbHeld) return;
      this.thumbHeld = false;
    } else {
      if (!this.reachHeld) return;
      this.reachHeld = false;
    }
    if (this.thumbHeld || this.reachHeld) return;
    this.blip();
    this.tLift = this.now();
    this.settleCap = owner === 'reach' ? mixTune.reachMax : mixTune.settleMax;
    if (this.src.core.g.angleTo(this.gLand) * DEG >= mixTune.settleMoved) {
      this.phase = 'settle';
      this.settleT = 0;
      this.out.x = this.out.y = 0;
    } else this.handBack();
  }

  private handBack() {
    const c = this.src.core;
    const r = this.rNow, L = this.rLand;
    c.anglesOf(c.g, r);
    const moved = c.g.angleTo(this.gLand) * DEG;
    // time only means "new hold" for a thumb: a boost is long because the player wants speed
    const heldT = this.thumbUsed ? this.tLift - this.tClutch : 0;
    const f = Math.max(ss(mixTune.rebaseT0, mixTune.rebaseT1, heldT), ss(mixTune.rebaseA0, mixTune.rebaseA1, moved));
    // tilt may hand back at most what it handed over, same sign
    const capR = r.r * L.r > 0 ? Math.sign(r.r) * Math.min(Math.abs(r.r), Math.abs(L.r)) : 0;
    const capP = r.p * L.p > 0 ? Math.sign(r.p) * Math.min(Math.abs(r.p), Math.abs(L.p)) : 0;
    const dR = (1 - f) * capR, dP = (1 - f) * capP;
    // (grace goes by how far the neutral really moves too: a long hold with the phone still moves it the whole carve)
    const shift = Math.max(Math.abs(r.r - dR), Math.abs(r.p - dP));
    if (shift > mixTune.trackMin) c.rebase(dR, dP, mixTune.track, Math.max(moved, shift) >= mixTune.settleMoved ? mixTune.grace : 0);
    const t = this.tNew;
    c.stickFor(dR, dP, t);
    this.a.x = this.out.x * t.x > 0 ? clamp(this.out.x / t.x, 0, 1) : 0;
    this.a.y = this.out.y * t.y > 0 ? clamp(this.out.y / t.y, 0, 1) : 0;
    this.phase = 'live';
    this.thumbUsed = false;
    c.autoHold = false;
  }

  /** Once per frame (wall clock). (bx, by) = the thumb's stretch. */
  update(dt: number, bx: number, by: number): void {
    const src = this.src;
    src.update(); // (the filters always run)
    this.g += clamp(this.gTarget - this.g, -dt / mixTune.gainOut, dt / mixTune.gainIn);
    const o = this.out;
    if (this.phase === 'thumb') {
      this.fadeT += dt;
      const k = 1 - sm(this.fadeT / mixTune.fadeOut);
      o.x = bx + k * this.held.x;
      o.y = by + k * this.held.y;
      const m = Math.hypot(o.x, o.y);
      if (m > 1) {
        o.x /= m;
        o.y /= m;
      }
    } else if (this.phase === 'settle') {
      this.settleT += dt;
      o.x = o.y = 0;
      if ((this.settleT >= mixTune.settleMin && src.core.angRate < mixTune.settleRate) || this.settleT >= this.settleCap) this.handBack();
    } else {
      const gs = sm(this.g);
      const ka = 1 - Math.exp(-dt / Math.max(1e-3, mixTune.fadeIn));
      this.a.x += (1 - this.a.x) * ka;
      this.a.y += (1 - this.a.y) * ka;
      o.x = gs * this.a.x * src.sx;
      o.y = gs * this.a.y * src.sy;
    }
  }

  /** Settings open, app hidden. Never touches the tilt's status. */
  sleep(): void {
    this.gTarget = 0;
  }

  /** The toggle went off: Controls stops the tilt once the gain is 0. */
  turnOff(): void {
    this.gTarget = 0;
    this.offPending = true;
  }

  /** Toggled back on inside the fade: no calibration. */
  cancelOff(): void {
    this.offPending = false;
    this.gTarget = 1;
  }

  /** Tilt going live, settings closed, app back. `thumbDown`: a steering thumb outlived the change: it clutches once. */
  wake(thumbDown: boolean): void {
    if (!this.live || this.offPending) return;
    this.phase = 'live';
    this.fadeT = this.settleT = 0;
    this.reachHeld = false;
    this.thumbHeld = this.thumbUsed = thumbDown;
    this.a.x = this.a.y = 1;
    // (g is not written: a quick close or re-toggle eases from where it is)
    if (this.g === 0 || thumbDown) this.out.x = this.out.y = 0;
    const c = this.src.core;
    // (nothing was handed over: the cap is 0, and any earlier land() is stale)
    this.gLand.copy(c.g);
    this.rLand.r = this.rLand.p = 0;
    this.tClutch = this.now();
    c.autoHold = false;
    if (thumbDown) this.enter();
    this.gTarget = 1;
  }
}
