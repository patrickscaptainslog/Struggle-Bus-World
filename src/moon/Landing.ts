import * as THREE from 'three';
import type { Flight } from '../game/Flight';
import type { TurboDrive } from '../game/Turbo';
import { config } from '../config';
import { busRig, type BusRig } from '../game/busSize';
import type { PixelPipeline } from '../render/PixelPipeline';
import { spaceResolveUniforms as U } from '../render/skyResolve';
import { FALL_FLOOR, FALL_TAU, R_M, type MoonTrip } from '../sky/MoonTrip';
import type { SkyDraw } from '../sky/SkyDraw';
import { MOON, type Observer, type SkyModel, type SkyState } from '../sky/SkyModel';
import { axesOf, dirOf, latOf, lonOf, mapOf, type MapFrame } from './map';
import type { MoonFar } from './MoonFar';

// ?moonland: from orbit to the ground and no join in it. moonrun.ts flies the orbit and main.ts's boot() is the low game, and this is what stands between them. One page, one thumb, one way down:
//
//   - A push in orbit starts the fall (MoonTrip's leg `fall`). The world is made round where the bus will come down, in the worker, while it falls. That is seconds (tools/moon/run.mjs farcost.ts: 4 ms a block, 1.5 s for what shows at the
//     top), so it isn't made ahead, and a player who changes their mind only moves it. If it's late the fall is held back: `gov`.
//   - From H_SHOW down the flight's loop draws the world's far field. The render frame stops being the view's and becomes the world's: the lens stands where it really is on the map and turns by the view's own axes, so the mesh draws
//     with nothing changed in it and the bus and the sky keep their places. The ray-drawn Moon goes on under it in the sky branch, and the mesh comes in over it by a dither.
//   - At H_GROUND the low game takes the frame: Flight, CameraRig, City. The two pictures are the same mesh by then, so nothing is left to see but the rig's own pose, which it takes over a couple of seconds.
//
// The brief had the game's loop reach up to 100 km. The flight's loop reaches down instead, for two reasons. Every number in the low game, the rig, City, the map's edge, Flight's yoke, is proven to 15 km and not past it, where the flight's law
// and view hold at any height; and the two changes that could show, ray to mesh and one loop to the other, then happen far apart, each with the other standing still. The ceiling stays at about 15 km.

const DEG = Math.PI / 180;
/** km over the ground: the mesh comes in here. A pixel under the bus is 200 m. */
export const H_SHOW = 120;
/** km over the ground: the low game takes the bus. Its ceiling is a little over this. */
export const H_GROUND = 14;
/** s: how long the mesh takes to come in over the ray-drawn Moon. */
const DISSOLVE = 3;
/** km over the ground: the mesh's light is the ray-drawn Moon's from here up, and its own from the lower one down. */
const LIGHT_HIGH = 45;
const LIGHT_LOW = 8;
/** A way of going down this shallow or steeper is what the place is chosen for (rad). */
const SHALLOWEST = 25 * DEG;
/** km between where the bus will come down and the middle of the map before the map is made again. The map is 256 km square, and the far field neither knows nor cares. */
const MOVE_KM = 70;
/** s: the ground the height is read from is smoothed, or a crater going by would shake the speed. */
const GROUND_S = 0.8;
/** s: how fast the ray test's radius follows the ground under the bus. */
const LIFT_S = 2;
/** m a second: Jet's. */
const JET = 450;
/** The map's half side, m, and how far inside it the homing starts: down here the bus can only come back to where the world's tiles are. */
const MAP_HALF = 128000;
const HOME_IN = 16000;
/** What the low game hands back: moonrun.ts asks this of boot(). */
export interface LandWorld {
  readonly frame: MapFrame;
  readonly far: MoonFar;
  /** The place's datum (world Y = height over the sphere less this); the worker's answer. NaN till it's come. */
  datum: number;
  /** A world round this place, for this time (UTC ms): the number the far field asks by. */
  place(lat: number, lon: number, ms: number): number;
  /** The low game has the frame from here. */
  enter(s: LandEnter): void;
  /** The low game's frame. */
  frameAt(now: number): void;
}

/** What the low game takes over: where the bus is and how it's going, and the view it's being seen from. */
export interface LandEnter {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  nose: number;
  /** the lens, off the bus, and how it's turned; the bus's turn */
  camOff: THREE.Vector3;
  camQuat: THREE.Quaternion;
  busQuat: THREE.Quaternion;
}

type V = Float64Array;
const v3 = () => new Float64Array(3);

export class Landing {
  /** the low game, once its boot has run */
  world: LandWorld | null = null;
  /** The lens stands in the world: the render frame is the world's. */
  near = false;
  /** The low game has the frame. */
  ground = false;
  /** The mesh over the ray-drawn Moon, 0..1. */
  show = 0;
  /** A thumb has pushed, this flight. */
  pushed = false;
  /** The bus is still arriving: the law has the speed. */
  arriving = false;
  /** What the sky's drawn from: the lens. In the flight it's the observer it always was, with the camera's offset in it; near the ground it's in the world's axes. */
  readonly ob: Observer = { body: MOON, free: true, pos: v3(), axes: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
  /** render -> world, and where the bus is in the world */
  readonly q = new THREE.Quaternion();
  readonly bus = new THREE.Vector3();
  /** the world's axes in EQJ, by rows */
  readonly axes = new Float64Array(9);

  private placed = false;
  private readonly at = v3();
  private readonly toLand = v3();
  private readonly toShow = v3();
  private lastNose = 0;
  private groundKm = NaN;
  private lawV = 0;
  private downT = 0;
  private readonly u = v3();
  private readonly f = v3();
  private readonly ax = new Float64Array(9);
  private readonly mt = new Float64Array(2);
  private readonly viewFix = new Float64Array(6);
  private readonly m = new THREE.Matrix4();
  private readonly t1 = new THREE.Vector3();
  private readonly dirT = new THREE.Vector3();
  private readonly groundOb: Observer = { body: MOON, free: false, pos: v3(), axes: new Float64Array(9) };
  /** the view's path and nose, in the world */
  readonly flying = new THREE.Vector3();
  readonly nosing = new THREE.Vector3();

  constructor(private readonly trip: MoonTrip, private readonly pipeline: PixelPipeline, private readonly space: THREE.Scene, readonly draw: SkyDraw, private readonly model: SkyModel, private readonly sky: SkyState) {}

  private readonly rig: BusRig = { px: 0, hero: 1, distance: config.camera.distanceVista };
  /** One curve from orbit to the rooftops, for both loops: game/busSize.ts. */
  size(h: number, focal: number, frameW: number, busLength: number): BusRig {
    return busRig(h / 1000, focal, frameW, busLength, this.rig);
  }

  /** km over the ground, as near as anything knows it. */
  get height(): number {
    return this.trip.hMoon - this.trip.ground;
  }

  /** A frame of the flight's loop, after the trip and the view have stepped. */
  update(dt: number): void {
    const t = this.trip, w = this.world;
    // (the figures between the stars are the flight's: the low game has none, and they go with the push, not with a change of loop)
    this.draw.showLines(t.leg !== 'fall');
    if (t.leg !== 'fall') {
      if (this.near) this.leave();
      this.placed = false;
      this.draw.moonLift *= Math.exp(-dt / LIFT_S);
      return;
    }
    this.pushed = true;
    if (!w) {
      t.gov = this.hold(dt, t.gov, false);
      return;
    }
    const F = this.model.moonFix, h = this.height, rm = t.rm, hd = t.heading, u = this.u, f = this.f;
    // Moon fixed: the way up here, and level ahead
    const r = Math.hypot(rm[0], rm[1], rm[2]);
    for (let i = 0; i < 3; i++) {
      u[i] = (F[i * 3] * rm[0] + F[i * 3 + 1] * rm[1] + F[i * 3 + 2] * rm[2]) / r;
      f[i] = F[i * 3] * hd[0] + F[i * 3 + 1] * hd[1] + F[i * 3 + 2] * hd[2];
    }
    if (!this.near) {
      // where this way of going comes down, and where it passes the height the mesh shows at
      const dive = Math.tan(Math.max(-t.nose, SHALLOWEST));
      this.arc(u, f, h / dive, this.toLand);
      this.arc(u, f, Math.max(h - H_SHOW, 0) / dive, this.toShow);
      const settled = Math.abs(t.nose - this.lastNose) < 0.15 * dt || h < 250;
      this.lastNose = t.nose;
      const off = this.placed ? 2 * R_M * Math.asin(Math.min(1, 0.5 * this.chord(this.toLand, this.at))) : 0;
      if ((!this.placed && settled) || (this.placed && off > MOVE_KM && h > H_SHOW + 20)) this.goTo();
    }
    if (!this.placed) {
      t.gov = this.hold(dt, t.gov, false);
      return;
    }
    const far = w.far, fr = w.frame, mt = this.mt;
    if (!this.near) {
      mapOf(fr, this.toShow[0], this.toShow[1], this.toShow[2], mt);
      far.update(mt[0], mt[1], H_SHOW * 1000);
      const ready = Number.isFinite(w.datum) && far.readyAt(mt[0], mt[1], H_SHOW * 1000);
      t.gov = this.hold(dt, t.gov, ready);
      if (ready) this.lift(dt, u, f, h);
      if (ready && h <= H_SHOW) this.come();
      return;
    }
    // ---- down in the world
    mapOf(fr, u[0], u[1], u[2], mt);
    const x = mt[0], z = mt[1], hm = Math.max(h, 0) * 1000;
    far.update(x, z, hm);
    const ground = (far.heightAt(x, z) + w.datum) / 1000;
    this.groundKm = Number.isNaN(this.groundKm) ? ground : this.groundKm + (ground - this.groundKm) * (1 - Math.exp(-dt / GROUND_S));
    t.ground = this.groundKm;
    this.lift(dt, u, f, h);
    mapOf(fr, u[0], u[1], u[2], mt);
    // (the map's edge turns it back, as it does in the low game: bearing to the middle, off the heading)
    const edge = Math.max(0, Math.min(1, (Math.max(Math.abs(x), Math.abs(z)) - MAP_HALF + HOME_IN) / HOME_IN)), A = this.axes;
    if (edge > 0) {
      const hx = hd[0] * A[0] + hd[1] * A[1] + hd[2] * A[2], hz = hd[0] * A[6] + hd[1] * A[7] + hd[2] * A[8];
      t.home = edge * Math.max(-1, Math.min(1, Math.atan2(-x * -hz + -z * hx, -x * hx + -z * hz)));
    } else t.home = 0;
    const want = h < H_SHOW ? 1 : h > H_SHOW + 15 ? 0 : this.show;
    this.show += Math.max(-dt / DISSOLVE, Math.min(dt / DISSOLVE, want - this.show));
    far.show.value = this.show;
    far.high.value = this.lightAt(h);
    far.object.visible = this.show > 0;
    if (this.show <= 0 && h > H_SHOW + 15) {
      this.leave();
      return;
    }
    // (late, under the mesh: the ground is a level coarser than it should be for a moment. That's a blur and no hole, so it slows the fall and doesn't hold it)
    const gov = far.readyAt(x, z, hm) ? 1 : 0.3;
    t.gov += (gov - t.gov) * (1 - Math.exp(-4 * dt));
  }

  /** Seen at a slant from up here a sea 2 km under the sphere is 10 px off where the ray test has it: the sphere goes down onto the ground in the middle of the view, a height ahead of the bus, while it's still too far off to show. */
  private lift(dt: number, u: V, f: V, h: number): void {
    const w = this.world!, mt = this.mt, p = this.toShow;
    this.arc(u, f, h, p);
    mapOf(w.frame, p[0], p[1], p[2], mt);
    this.draw.moonLift += ((w.far.heightAt(mt[0], mt[1]) + w.datum) / 1000 - this.draw.moonLift) * (1 - Math.exp(-dt / LIFT_S));
  }

  /** How much of the mesh's light is the ray-drawn Moon's at h km. */
  private lightAt(h: number): number {
    const k = Math.max(0, Math.min(1, (h - LIGHT_LOW) / (LIGHT_HIGH - LIGHT_LOW)));
    return k * k * (3 - 2 * k);
  }

  /** The fall held back at the height the mesh should show at, smoothly, by what's left to go. */
  private hold(dt: number, gov: number, ready: boolean): number {
    const want = ready ? 1 : Math.max(0, Math.min(1, (this.height - H_SHOW) / 60));
    return gov + (Math.min(want, 1) - gov) * (1 - Math.exp(-5 * dt));
  }

  /** From the unit vector u, along the unit tangent f, km over the ground, into o. */
  private arc(u: V, f: V, km: number, o: V): void {
    const a = km / R_M, c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < 3; i++) o[i] = u[i] * c + f[i] * s;
  }

  private chord(a: V, b: V): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  /** Makes the world round where the bus will come down. */
  private goTo(): void {
    const w = this.world!, p = this.toLand;
    this.at.set(p);
    this.placed = true;
    const id = w.place(latOf(p), lonOf(p), this.trip.ms);
    mapOf(w.frame, this.toShow[0], this.toShow[1], this.toShow[2], this.mt);
    w.far.place(id, this.mt[0], this.mt[1], H_SHOW * 1000);
  }

  /** The mesh comes into the flight's scene. */
  private come(): void {
    const far = this.world!.far;
    this.near = true;
    this.groundKm = NaN;
    this.show = 0;
    far.show.value = 0;
    far.high.value = 1;
    far.object.visible = false;
    this.space.add(far.object);
    this.pipeline.steadySnap = true;
  }

  private leave(): void {
    const far = this.world!.far, t = this.trip;
    this.near = false;
    this.show = 0;
    far.object.visible = false;
    t.ground = 0;
    t.gov = 1;
    t.home = 0;
    this.draw.view = null;
    this.pipeline.steadySnap = false;
    this.bus.set(0, 0, 0);
  }

  /** After the rig has set the lens, in the render frame: the sky's observer, and near the ground the lens and the bus in the world. */
  pose(camera: THREE.PerspectiveCamera, bus: THREE.Object3D): void {
    const t = this.trip, a = t.ob.axes, ob = this.ob, cx = camera.position.x / 1000, cy = camera.position.y / 1000, cz = camera.position.z / 1000;
    ob.body = t.ob.body;
    // (the lens, a kilometre behind the bus at most: the ground under it doesn't stand still for that, when the mesh does)
    for (let i = 0; i < 3; i++) ob.pos[i] = t.ob.pos[i] + a[i] * cx + a[3 + i] * cy + a[6 + i] * cz;
    if (!this.near) {
      ob.axes.set(a);
      bus.position.set(0, 0, 0);
      return;
    }
    const w = this.world!, fr = w.frame, F = this.model.moonFix, rm = t.rm, ax = this.ax, mt = this.mt, A = this.axes;
    const r = Math.hypot(rm[0], rm[1], rm[2]), ux = (F[0] * rm[0] + F[1] * rm[1] + F[2] * rm[2]) / r, uy = (F[3] * rm[0] + F[4] * rm[1] + F[5] * rm[2]) / r, uz = (F[6] * rm[0] + F[7] * rm[1] + F[8] * rm[2]) / r;
    mapOf(fr, ux, uy, uz, mt);
    this.bus.set(mt[0], (r - R_M) * 1000 - w.datum, mt[1]);
    axesOf(fr, mt[0], mt[1], ax);
    // (the world's axes in EQJ: fixed <- EQJ by rows, so its transpose on each)
    for (let k = 0; k < 3; k++) {
      const x = ax[k * 3], y = ax[k * 3 + 1], z = ax[k * 3 + 2];
      A[k * 3] = F[0] * x + F[3] * y + F[6] * z;
      A[k * 3 + 1] = F[1] * x + F[4] * y + F[7] * z;
      A[k * 3 + 2] = F[2] * x + F[5] * y + F[8] * z;
    }
    ob.axes.set(A);
    // render -> world: a render axis's parts along the world's
    const dot = (i: number, j: number) => a[i * 3] * A[j * 3] + a[i * 3 + 1] * A[j * 3 + 1] + a[i * 3 + 2] * A[j * 3 + 2];
    this.m.set(dot(0, 0), dot(1, 0), dot(2, 0), 0, dot(0, 1), dot(1, 1), dot(2, 1), 0, dot(0, 2), dot(1, 2), dot(2, 2), 0, 0, 0, 0, 1);
    this.q.setFromRotationMatrix(this.m);
    camera.position.applyQuaternion(this.q).add(this.bus);
    camera.quaternion.premultiply(this.q);
    bus.position.copy(this.bus);
    bus.quaternion.premultiply(this.q);
    // (the top of the frame, for the craters' own light: it's the view's, whatever frame this is)
    const v = this.viewFix;
    for (let i = 0; i < 3; i++) {
      v[i] = F[i * 3] * a[3] + F[i * 3 + 1] * a[4] + F[i * 3 + 2] * a[5];
      v[3 + i] = F[i * 3] * a[6] + F[i * 3 + 1] * a[7] + F[i * 3 + 2] * a[8];
    }
    this.draw.view = v;
  }

  /** The bus's light, on the way from what the flight gives it to what the low game does, by the height where the one hands over to the other. */
  busLight(u: THREE.Vector3, L: { sunStrength: number; ambient: number; skyBounce: number }, tune: { sunSoft: number }, soft: number): void {
    const k = 1 - Math.max(0, Math.min(1, (this.height - H_GROUND) / 16));
    u.x += (L.sunStrength - u.x) * k;
    u.y += (L.ambient - u.y) * k;
    u.z += (L.skyBounce - u.z) * k;
    tune.sunSoft = soft + (0.42 - soft) * k;
  }

  /** The pixel grid stands on the ground under the middle of the frame, and the bus takes what's left over, as it does up high in the low game. */
  snap(camera: THREE.PerspectiveCamera, bus: THREE.Object3D): void {
    const d = this.dirT, P = this.pipeline;
    camera.updateMatrixWorld();
    camera.getWorldDirection(d);
    const tC = Math.min(2e6, Math.max(50, (camera.position.y - (this.trip.ground * 1000 - this.world!.datum)) / Math.max(0.06, -d.y)));
    P.focus.copy(camera.position).addScaledVector(d, tC);
    P.steadySnap = true;
    P.snap();
    bus.position.add(P.snapCompensation(bus.position, this.t1));
  }

  /** Under the height the low game takes over, and the way it's going is down. */
  get time(): boolean {
    return this.near && this.show >= 1 && this.height <= H_GROUND && this.trip.nose < 0;
  }

  /** The low game takes the frame, from the end of this one. */
  hand(camera: THREE.PerspectiveCamera, bus: THREE.Object3D): void {
    const t = this.trip, w = this.world!, A = this.axes, hd = t.heading;
    const hx = hd[0] * A[0] + hd[1] * A[1] + hd[2] * A[2], hz = hd[0] * A[6] + hd[1] * A[7] + hd[2] * A[8];
    this.ground = true;
    this.arriving = true;
    this.lawV = t.v * t.gov * 1000;
    this.downT = 0;
    this.draw.view = null;
    t.land2ground();
    w.enter({
      x: this.bus.x, y: this.bus.y, z: this.bus.z,
      heading: Math.atan2(hx, -hz),
      speed: this.lawV,
      nose: t.nose,
      camOff: camera.position.clone().sub(bus.position),
      camQuat: camera.quaternion.clone(),
      busQuat: bus.quaternion.clone(),
    });
  }

  /** A frame of the low game: the clock, and the sky over the lens. */
  over(dt: number, cam: THREE.Vector3): void {
    const w = this.world!, ob = this.groundOb, d = this.u;
    this.trip.tick(dt);
    dirOf(w.frame, cam.x, cam.z, d);
    axesOf(w.frame, cam.x, cam.z, ob.axes);
    const r = R_M + (cam.y + w.datum) / 1000;
    for (let i = 0; i < 3; i++) ob.pos[i] = d[i] * r;
    this.model.frame(this.trip.ms, ob, this.sky);
    this.draw.update(this.sky, dt);
    // (the ground is the ground)
    U.uMoonO.value.w = -1;
    w.far.high.value = this.lightAt((cam.y - w.far.heightAt(cam.x, cam.z)) / 1000);
  }

  /**
   * A frame of the low game, once the gears have written Flight.turbo: the end of the same law, down to Jet's speed at the end of the way down. The gear is Jet, so that's what the bus has when the law lets go, and from there it's the plain
   * flight. The floor under Jet is 150 m, so a thumb still pushing there has only one thing to ask for: the gear goes down, and the bus goes on down to the rooftops.
   */
  drive(f: Flight, T: TurboDrive, push: number, dt: number): void {
    if (this.arriving) {
      const h = f.height / 1000, Tb = f.turbo;
      this.lawV = Math.min(this.lawV, JET + (Math.max(h - FALL_FLOOR, 0) / FALL_TAU) * 1000);
      // (the map's edge fades a gear; it fades this)
      Tb.speed = config.flight.surgeSpeed + (this.lawV - config.flight.surgeSpeed) * T.edge;
      Tb.rate = 30;
      if (this.lawV <= JET + 1) this.arriving = false;
      return;
    }
    if (T.gear === 1 && this.downT >= 0) {
      this.downT = push > 0 ? 0 : this.downT + dt;
      // (a thumb gone for a while means it's staying up here)
      if (this.downT > 1.5) this.downT = -1;
      else if (push > 0 && f.y < f.groundBroad + 200) {
        T.shift(-1, f);
        this.downT = -1;
      }
    }
  }
}
