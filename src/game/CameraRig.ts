import * as THREE from 'three';
import { config } from '../config';
import { pitchAdd } from './Ascent';
import { angleDelta, clamp, spring } from './springs';
import type { Flight } from './Flight';

// Telephoto chase camera: behind and above, lagging so turns sweep. It tilts
// toward a diorama view when the bus slows to aim and levels toward the
// horizon when it surges. The bus sits just above the thumb zone.
//
// Vista: as the bus climbs above the city the rig pulls back, widens
// the lens and looks down more, but the look point moves ahead so the view
// pitch stays shallow (pitchVista): the horizon and the sky stay at the top of
// the frame, it never becomes a top-down map. The bus grows a little
// (heroScale) so it stays the hero at that distance.
//
// A dive is the one exception to the sky at the top of the frame: the view
// tips over the bus until the place it is heading for is on screen, driven by
// the yoke alone, and it leaves nothing behind when it eases out.

const smooth01 = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class CameraRig {
  /** 0..1 vista blend (with the bus's height above the broad ground, latched while holding) */
  vista = 0;
  private vistaTarget = 0;
  /** the height the lens is set for (m): like the vista, only the yoke moves it, so a held view is perfectly still */
  private lensHeight = 0;
  private lensTarget = 0;
  /** 0..1: how far the view has tipped over a dive (eases after the nose; exactly 0 once it has settled back) */
  private dive = 0;
  /** where the far fade ends at the ground (m, main.ts): the view looks down past it as it drops */
  fadeBase = 34000;
  /** horizontal portrait fov the pipeline should use (deg) */
  hfov = config.camera.hfovPortrait;
  /** scale for the bus model (hero readability at altitude) */
  heroScale = 1;
  /** current distance from the camera to the bus (m) */
  distance = config.camera.distance;
  private yaw = 0;
  private yawVel = 0;
  private pos = new THREE.Vector3();
  private posVel = new THREE.Vector3();
  private elev = config.camera.elevationCruise;
  private look = new THREE.Vector3();
  private initialized = false;
  /** extra pull-back for the opening shot (m) */
  openingPull = 0;
  /** 0..1: low, level cinematic camera for the Golden Gate opening (passes under the deck) */
  openingLow = 0;
  /** Turbo gears (src/fx/Turbo.ts): extra pull-back (m), lens widening (deg), hero scale (x), and leads (m)
   *  added to the follow / look targets that cancel part of the springs' lag at turbo speeds */
  turboPull = 0;
  turboFov = 0;
  turboHero = 1;
  readonly turboLead = new THREE.Vector3();
  readonly turboLookLead = new THREE.Vector3();
  /** 0..1 while barfing: tilt down and pull the look point in so the splat below the bus is visible */
  barfTilt = 0;
  shake = 0;
  private kickT = 1e3;
  private kickA = 0;
  private readonly kickUp = new THREE.Vector3();
  private readonly kickRight = new THREE.Vector3();
  private readonly bus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly lookDir = new THREE.Vector3();

  /** ?moon: the ground under the lens. A street has no slope to speak of; a hill behind the bus would have the lens inside it, looking out through the back of the ground. */
  floorAt: ((x: number, z: number) => number) | null = null;
  /** 0..1, ?moonland: the follow stands where it should, with no lag: a bus coming down at kilometres a second would run out from under the springs. */
  stiff = 0;

  /** The bus comes in from a height with the view at its height: the rig is where it would have got to by itself. */
  place(cam: THREE.PerspectiveCamera, f: Flight) {
    this.initialized = true;
    this.yaw = f.heading;
    this.yawVel = 0;
    this.vista = this.vistaTarget = 1;
    this.lensHeight = this.lensTarget = f.height;
    this.pos.copy(cam.position);
    this.posVel.set(0, 0, 0);
    this.look.set(f.x + f.fx, f.y - 4, f.z + f.fz);
    this.elev = config.camera.elevationCruise;
  }

  update(cam: THREE.PerspectiveCamera, focusOut: THREE.Vector3, f: Flight, dt: number) {
    const C = config.camera;
    const F = config.flight;
    if (!this.initialized) {
      this.yaw = f.heading;
      this.initialized = true;
    }
    // yaw lags the bus heading (springy)
    const target = this.yaw + angleDelta(this.yaw, f.heading);
    [this.yaw, this.yawVel] = spring(this.yaw, this.yawVel, target, C.yawHz, C.yawDamping, dt);

    // elevation from speed: slow -> diorama, fast -> vista
    const sp = f.speed;
    let e: number;
    if (sp < F.cruiseSpeed) e = C.elevationSlow + (C.elevationCruise - C.elevationSlow) * clamp((sp - C.slowSpeed) / Math.max(1, F.cruiseSpeed - C.slowSpeed), 0, 1);
    else e = C.elevationCruise + (C.elevationSurge - C.elevationCruise) * clamp((sp - F.cruiseSpeed) / (F.surgeSpeed - F.cruiseSpeed), 0, 1);
    this.elev += (e - this.elev) * (1 - Math.exp(-1.8 * dt));

    // vista blend. Only the yoke moves it: while climbing or diving it follows the height above the
    // broad ground (terrain, not roofs); holding an altitude freezes the lens where it is (a lens that
    // breathes with every roof and hill rescales the pixel grid and swims the whole frame); skimming
    // the floor it goes home to the classic chase camera.
    if (f.holdY < -1e8) this.vistaTarget = 0;
    else if (f.mode === 2 || f.mode === 3) this.vistaTarget = smooth01(C.vistaStart, Math.max(C.vistaStart + 1, C.vistaFull), f.height);
    const dv = this.vistaTarget - this.vista;
    // (once the yoke lets go it settles briskly and exactly, so a held lens is perfectly still within ~2 s)
    const moving = f.mode === 2 || f.mode === 3;
    if (Math.abs(dv) < 0.003) this.vista = this.vistaTarget;
    else this.vista += dv * (1 - Math.exp(-(moving ? C.vistaRate : Math.max(C.vistaRate, C.vistaSettle)) * dt));
    if (f.holdY < -1e8) this.lensTarget = 0;
    else if (moving) this.lensTarget = f.height;
    const dl = this.lensTarget - this.lensHeight;
    if (Math.abs(dl) < 1) this.lensHeight = this.lensTarget;
    else this.lensHeight += dl * (1 - Math.exp(-(moving ? C.vistaRate : Math.max(C.vistaRate, C.vistaSettle)) * dt));
    const low = this.openingLow;
    const v = this.vista * (1 - low);
    // a dive tips the view over the bus, and only a dive: it follows the nose on the yoke, and goes home on its own
    const diveWant = f.mode === 3 ? clamp((THREE.MathUtils.radToDeg(-f.nose) - C.diveFrom) / Math.max(1, F.noseDown - C.diveFrom), 0, 1) : 0;
    // (it arrives exactly, at a crawl: a last step would tilt the whole frame by a pixel)
    const dd = diveWant - this.dive;
    const ds = Math.max(Math.abs(dd) * (1 - Math.exp(-C.diveRate * dt)), 0.04 * dt);
    this.dive = Math.abs(dd) <= ds ? diveWant : this.dive + Math.sign(dd) * ds;
    const dive = this.dive * (1 - low);
    this.hfov = C.hfovPortrait + (C.hfovVista - C.hfovPortrait) * v + this.turboFov;
    this.heroScale = (1 + (C.heroScaleVista - 1) * v) * this.turboHero;
    const barf = this.barfTilt * (1 - v) * (1 - dive); // up high the splat lands mid-screen anyway
    let elev = this.elev + (C.elevationVista - this.elev) * v;
    elev += (C.diveElevation - elev) * dive;
    const el = THREE.MathUtils.degToRad(elev + 11 * barf + (6.5 - elev) * low);
    const dist = (C.distance + (C.distanceVista - C.distance) * v + this.openingPull + this.turboPull) * (1 - low) + 150 * low;
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const bus = this.bus.set(f.x, f.y, f.z);
    const desired = this.desired.set(bus.x - fx * Math.cos(el) * dist, bus.y + Math.sin(el) * dist, bus.z - fz * Math.cos(el) * dist).addScaledVector(this.turboLead, 1 - this.stiff);
    if (this.pos.lengthSq() === 0) this.pos.copy(desired);
    // critically damped follow (keeps the bus framed but lets motion breathe)
    const w = 2 * Math.PI * C.followHz;
    for (const k of ['x', 'y', 'z'] as const) {
      const a = w * w * (desired[k] - this.pos[k]) - 2 * C.followDamping * w * this.posVel[k];
      this.posVel[k] += a * dt;
      this.pos[k] += this.posVel[k] * dt;
      if (this.stiff > 0) this.pos[k] += (desired[k] - this.pos[k]) * this.stiff;
    }
    if (this.floorAt) {
      const y = this.floorAt(this.pos.x, this.pos.z) + 4;
      if (this.pos.y < y) {
        this.pos.y = y;
        this.posVel.y = Math.max(0, this.posVel.y);
      }
    }
    const spk = sp / F.cruiseSpeed;
    let la = C.lookAhead * (C.lookAheadSlow + (1 - C.lookAheadSlow) * clamp(spk, 0, 1) + 0.4 * clamp(spk - 1, 0, 1)) * (1 - 0.65 * barf) * (1 - dive);
    let pitch = 0;
    const divePitch = THREE.MathUtils.degToRad(C.divePitch);
    if (v > 0) {
      // far enough ahead that the view pitches down by pitchVista, and never so far down that
      // the horizon leaves the top of the frame (3 deg of sky) while the rig is still rising
      const halfV = cam.fov / 2; // the lens as the pipeline set it (portrait or landscape)
      pitch = THREE.MathUtils.degToRad(clamp(Math.min(C.pitchVista + THREE.MathUtils.radToDeg(pitchAdd(this.lensHeight, this.fadeBase)), halfV - 3), 5, 60));
      const laV = (Math.sin(el) * dist + 4) / Math.tan(pitch + (divePitch - pitch) * dive) - Math.cos(el) * dist;
      la += (Math.max(la, laV) - la) * smooth01(0, 0.35, v);
    }
    const lookTarget = this.lookTarget.set(bus.x + fx * la * (1 + 2 * low), bus.y - 4 + 14 * low, bus.z + fz * la * (1 + 2 * low)).addScaledVector(this.turboLookLead, 1 - this.stiff);
    if (this.look.lengthSq() === 0) this.look.copy(lookTarget);
    this.look.lerp(lookTarget, 1 - Math.exp(-6 * dt));
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    if (v > 0 || dive > 0) {
      // up high the view's pitch is set outright instead of by where the bus is, so the bus's wheezy
      // bob (and the lag between the two follow springs) never rocks the whole frame: a rotation
      // can't be snapped to the pixel grid, and from up here every far roof would swim with it
      const dx = this.look.x - this.pos.x, dz = this.look.z - this.pos.z;
      const hd = Math.max(1e-3, Math.hypot(dx, dz));
      const p0 = Math.atan2(this.pos.y - this.look.y, hd);
      const p = p0 + (pitch - p0) * smooth01(0, 0.35, v);
      let ax = dx / hd, az = dz / hd;
      if (dive > 0) {
        // (tipped over the bus the look point stands nearly under the lens: the view's bearing comes from the heading instead)
        ax += (fx - ax) * dive;
        az += (fz - az) * dive;
        const al = Math.max(1e-3, Math.hypot(ax, az));
        ax /= al;
        az /= al;
      }
      const dp = p + (divePitch - p) * dive;
      this.lookDir.set(ax * Math.cos(dp), -Math.sin(dp), az * Math.cos(dp));
      cam.lookAt(this.lookDir.add(this.pos));
    } else cam.lookAt(this.look);
    this.distance = this.pos.distanceTo(bus);
    focusOut.copy(bus);
  }

  /** Blast kick: a jolt of `amount` m that rings down within config.splat.kickDecay. */
  kick(amount: number) {
    this.kickA = amount;
    this.kickT = 0;
  }

  /**
   * Applies the kick after update(), on REAL time (it keeps shaking through
   * the hit-stop freeze). Translation only, along the camera's own up/right
   * axes: the pixel pipeline snaps that to whole game pixels (the sub-pixel
   * rest goes to the upscale shift), so a kick never shimmers. No rotation.
   */
  applyKick(cam: THREE.PerspectiveCamera, realDt: number) {
    const D = Math.max(0.05, config.splat.kickDecay);
    if (this.kickT > D * 1.5) return;
    const t = this.kickT;
    this.kickT += realDt;
    const env = this.kickA * Math.exp((-3 * t) / D);
    const w = (2 * Math.PI * 2.2) / D;
    this.kickUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.kickRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
    cam.position.addScaledVector(this.kickUp, -env * Math.cos(w * t)).addScaledVector(this.kickRight, env * 0.35 * Math.sin(w * 1.3 * t));
  }
}
