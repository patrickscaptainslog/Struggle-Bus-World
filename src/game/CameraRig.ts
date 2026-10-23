import * as THREE from 'three';
import { config } from '../config';
import { angleDelta, clamp, spring } from './springs';
import type { Flight } from './Flight';

// Telephoto chase camera: behind and above, lagging so turns sweep. It tilts
// toward a diorama view when the bus slows to aim and levels toward the
// horizon when it surges. The bus sits just above the thumb zone.

export class CameraRig {
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
    if (sp < F.cruiseSpeed) e = C.elevationSlow + (C.elevationCruise - C.elevationSlow) * clamp((sp - F.hoverSpeed) / (F.cruiseSpeed - F.hoverSpeed), 0, 1);
    else e = C.elevationCruise + (C.elevationSurge - C.elevationCruise) * clamp((sp - F.cruiseSpeed) / (F.surgeSpeed - F.cruiseSpeed), 0, 1);
    this.elev += (e - this.elev) * (1 - Math.exp(-1.8 * dt));

    const low = this.openingLow;
    const el = THREE.MathUtils.degToRad(this.elev + 11 * this.barfTilt + (6.5 - this.elev) * low);
    const dist = (C.distance + this.openingPull) * (1 - low) + 150 * low;
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
    const la = C.lookAhead * (0.6 + 0.4 * clamp(sp / F.cruiseSpeed, 0, 2)) * (1 - 0.65 * this.barfTilt);
    const lookTarget = this.lookTarget.set(bus.x + fx * la * (1 + 2 * low), bus.y - 4 + 14 * low, bus.z + fz * la * (1 + 2 * low));
    if (this.look.lengthSq() === 0) this.look.copy(lookTarget);
    this.look.lerp(lookTarget, 1 - Math.exp(-6 * dt));
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    focusOut.copy(bus);
  }
}
