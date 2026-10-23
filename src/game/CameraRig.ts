import * as THREE from 'three';
import { config } from '../config';
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

const smooth01 = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class CameraRig {
  /** 0..1 vista blend (with the bus's height above the broad ground, latched while holding) */
  vista = 0;
  private vistaTarget = 0;
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
  /** 0..1 while barfing: tilt down and pull the look point in so the splat below the bus is visible */
  barfTilt = 0;
  shake = 0;
  private readonly bus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly lookDir = new THREE.Vector3();

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
    // (settles exactly, so a held lens is perfectly still)
    if (Math.abs(dv) < 0.002) this.vista = this.vistaTarget;
    else this.vista += dv * (1 - Math.exp(-C.vistaRate * dt));
    const low = this.openingLow;
    const v = this.vista * (1 - low);
    this.hfov = C.hfovPortrait + (C.hfovVista - C.hfovPortrait) * v;
    this.heroScale = 1 + (C.heroScaleVista - 1) * v;
    const barf = this.barfTilt * (1 - v); // up high the splat lands mid-screen anyway
    const elev = this.elev + (C.elevationVista - this.elev) * v;
    const el = THREE.MathUtils.degToRad(elev + 11 * barf + (6.5 - elev) * low);
    const dist = (C.distance + (C.distanceVista - C.distance) * v + this.openingPull) * (1 - low) + 150 * low;
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const bus = this.bus.set(f.x, f.y, f.z);
    const desired = this.desired.set(bus.x - fx * Math.cos(el) * dist, bus.y + Math.sin(el) * dist, bus.z - fz * Math.cos(el) * dist);
    if (this.pos.lengthSq() === 0) this.pos.copy(desired);
    // critically damped follow (keeps the bus framed but lets motion breathe)
    const w = 2 * Math.PI * C.followHz;
    for (const k of ['x', 'y', 'z'] as const) {
      const a = w * w * (desired[k] - this.pos[k]) - 2 * C.followDamping * w * this.posVel[k];
      this.posVel[k] += a * dt;
      this.pos[k] += this.posVel[k] * dt;
    }
    let la = C.lookAhead * (0.6 + 0.4 * clamp(sp / F.cruiseSpeed, 0, 2)) * (1 - 0.65 * barf);
    let pitch = 0;
    if (v > 0) {
      // far enough ahead that the view pitches down by pitchVista, and never so far down that
      // the horizon leaves the top of the frame (3 deg of sky) while the rig is still rising
      const halfV = cam.fov / 2; // the lens as the pipeline set it (portrait or landscape)
      pitch = THREE.MathUtils.degToRad(clamp(Math.min(C.pitchVista, halfV - 3), 5, 60));
      const laV = (Math.sin(el) * dist + 4) / Math.tan(pitch) - Math.cos(el) * dist;
      la += (Math.max(la, laV) - la) * smooth01(0, 0.35, v);
    }
    const lookTarget = this.lookTarget.set(bus.x + fx * la * (1 + 2 * low), bus.y - 4 + 14 * low, bus.z + fz * la * (1 + 2 * low));
    if (this.look.lengthSq() === 0) this.look.copy(lookTarget);
    this.look.lerp(lookTarget, 1 - Math.exp(-6 * dt));
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    if (v > 0) {
      // up high the view's pitch is set outright instead of by where the bus is, so the bus's wheezy
      // bob (and the lag between the two follow springs) never rocks the whole frame: a rotation
      // can't be snapped to the pixel grid, and from up here every far roof would swim with it
      const dx = this.look.x - this.pos.x, dz = this.look.z - this.pos.z;
      const hd = Math.max(1e-3, Math.hypot(dx, dz));
      const p0 = Math.atan2(this.pos.y - this.look.y, hd);
      const p = p0 + (pitch - p0) * smooth01(0, 0.35, v);
      this.lookDir.set((dx / hd) * Math.cos(p), -Math.sin(p), (dz / hd) * Math.cos(p));
      cam.lookAt(this.lookDir.add(this.pos));
    } else cam.lookAt(this.look);
    this.distance = this.pos.distanceTo(bus);
    focusOut.copy(bus);
  }
}
