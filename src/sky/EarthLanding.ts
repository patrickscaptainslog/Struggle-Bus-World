import * as THREE from 'three';
import { latLonToLocal, localToLatLon } from '../game/geo';
import type { LandEnter } from '../moon/Landing';
import type { MoonTrip } from './MoonTrip';
import type { SkyDraw } from './SkyDraw';
import { EARTH, type Observer, type SkyModel, type SkyState } from './SkyModel';
import type { TripView } from './TripView';
import { fixToGeodetic, geodeticToFix } from './WorldFrame';

// ?earth: the street and the flight on one page, and the bus handed between them over the city (docs/specs/earth/EARTHFLIGHT.md, E2). The Moon's Landing.ts is the model, with less to do: the street has its
// own world all the way up to the hand-over, and what it draws past its far fade, and of the sky, is the flight's (the space branch of the resolve, its uniforms from here), so as the bus climbs the city goes into
// the plain Earth from the horizon in (main.ts, the sky cut), and at H_UP the two pictures are one picture. Going down it's the same the other way, from H_GROUND.
//
// The street's map is the city's transverse Mercator; the flight flies Earth fixed (MoonTrip's free leg). Between them: geo.ts and WorldFrame.ts, and the street's render axes at a place, found by stepping a few
// metres along its map, so no convention for the grid's convergence can be got the wrong way round.

import { H_GROUND } from './earthJoin';

/** s: how long the lens and the bus take to come over from where the street had them (Landing.ts's REJOIN). */
const REJOIN = 2.4;

/** What the street hands the flight, and how the flight takes it back (main.ts builds it). */
export interface StreetWorld {
  /** the city's map's origin, [lat, lon] degrees */
  readonly origin: readonly [number, number];
  /** whether (x, z), map metres, is over the city's map, where the street can have the bus */
  covers(x: number, z: number): boolean;
  /** the street has the bus from here */
  enter(s: LandEnter): void;
  /** the flight has it back: the thumb, the HUD, what the street set on the frame */
  leave(): void;
  /** the street's frame */
  frameAt(now: number): void;
  /** the street stops pumping its own frames: the flight's loop calls frameAt from now on */
  pumpOff(): void;
}

type V = Float64Array;
const v3 = () => new Float64Array(3);

export class EarthLanding {
  /** The street has the frame. It has from the first frame. */
  ground = true;
  /** The street has just handed back: moonrun.ts takes up the HUD and the label, once. */
  cameBack = false;
  /** The flight sets the frame's state it needs as it takes the frame (moonrun.ts). */
  onTake: (() => void) | null = null;
  private readonly ob: Observer = { body: EARTH, free: false, pos: v3(), axes: new Float64Array(9) };
  private readonly g = [0, 0, 0];
  private readonly ax = new Float64Array(9);
  private readonly w = new Float64Array(9);
  private readonly a = v3();
  private readonly b = v3();
  private readonly p = v3();
  private readonly e = v3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly t = new THREE.Vector3();
  private readonly qT = new THREE.Quaternion();
  /** The lens off the bus and the way the bus lay, as the street had them, in the flight's render frame (which is its lens's own), on their way to the flight's. */
  private rejoin: { t: number; off: THREE.Vector3; busQuat: THREE.Quaternion; hero: number } | null = null;

  constructor(
    private readonly trip: MoonTrip,
    private readonly view: TripView,
    private readonly model: SkyModel,
    private readonly sky: SkyState,
    private readonly draw: SkyDraw,
    readonly world: StreetWorld,
  ) {}

  /** Earth fixed, km, of map metres (x, y over the sea, z). */
  private fixOf(x: number, y: number, z: number, o: V): V {
    const [lat, lon] = localToLatLon(x, z, this.world.origin);
    return geodeticToFix(lat, lon, y / 1000, o);
  }

  /** The street's render axes at (x, z), Earth fixed by rows: +X along the map's x, +Y up, +Z along its z, by steps of 10 m on the map. */
  private axesAt(x: number, y: number, z: number, o: V): V {
    const p = this.fixOf(x, y, z, this.p), a = this.fixOf(x + 10, y, z, this.a), b = this.fixOf(x, y, z + 10, this.b);
    const ex = [a[0] - p[0], a[1] - p[1], a[2] - p[2]], ez = [b[0] - p[0], b[1] - p[1], b[2] - p[2]];
    const lx = Math.hypot(ex[0], ex[1], ex[2]), lz = Math.hypot(ez[0], ez[1], ez[2]);
    for (let i = 0; i < 3; i++) {
      ex[i] /= lx;
      ez[i] /= lz;
    }
    // up, square to both; then z made square to x, so the rows are a frame
    const up = [ez[1] * ex[2] - ez[2] * ex[1], ez[2] * ex[0] - ez[0] * ex[2], ez[0] * ex[1] - ez[1] * ex[0]], lu = Math.hypot(up[0], up[1], up[2]);
    for (let i = 0; i < 3; i++) up[i] /= lu;
    const zz = [ex[1] * up[2] - ex[2] * up[1], ex[2] * up[0] - ex[0] * up[2], ex[0] * up[1] - ex[1] * up[0]];
    o.set([ex[0], ex[1], ex[2], up[0], up[1], up[2], zz[0], zz[1], zz[2]]);
    return o;
  }

  /** A frame of the street's: the trip's clock, and the sky over its lens, so what its resolve draws of space is where it is. cam: the lens, map metres. */
  over(dt: number, cam: THREE.Vector3): void {
    this.trip.tick(dt);
    const ob = this.ob;
    this.fixOf(cam.x, cam.y, cam.z, ob.pos as V);
    this.axesAt(cam.x, cam.y, cam.z, ob.axes as V);
    this.model.frame(this.trip.ms, ob, this.sky);
    this.draw.update(this.sky, dt);
  }

  /** The flight takes the bus, climbing past H_UP: where it is and how it's going, and the view as the street's rig had it. */
  back(camera: THREE.PerspectiveCamera, bus: THREE.Object3D, f: { x: number; y: number; z: number; heading: number; speed: number; vy: number; ground: number }, gear: number, hfov: number, dive: number): void {
    const t = this.trip, A = this.axesAt(f.x, f.y, f.z, this.ax), ef = this.fixOf(f.x, f.y, f.z, this.e);
    // (the heading, from the map's (sin, -cos) to Earth fixed along the street's axes)
    const fx = Math.sin(f.heading), fz = -Math.cos(f.heading), eh = this.b;
    for (let i = 0; i < 3; i++) eh[i] = fx * A[i] + fz * A[6 + i];
    t.fromStreet(ef, eh, Math.atan2(f.vy, Math.max(1, f.ground)), Math.hypot(f.ground, f.vy) / 1000, gear);
    // (the lens's axes into EQJ, what the view is made of: the street's axes, Earth fixed, then EQJ <- fixed)
    const F = this.model.earthFix, W = this.w;
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) W[k * 3 + j] = F[j] * A[k * 3] + F[3 + j] * A[k * 3 + 1] + F[6 + j] * A[k * 3 + 2];
    const inEqj = (v: THREE.Vector3) => v.set(v.x * W[0] + v.y * W[3] + v.z * W[6], v.x * W[1] + v.y * W[4] + v.z * W[7], v.x * W[2] + v.y * W[5] + v.z * W[8]);
    const x = inEqj(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)), y = inEqj(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)), z = inEqj(new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion));
    this.view.takeOver(this.q.setFromRotationMatrix(this.m.makeBasis(x, y, z)), t.dir, t.heading, t.r, hfov, dive);
    // (the flight's render frame is its lens's, and the lens is handed over as the street had it: so the street's lens's own axes are the frame the offset and the bus's turn go into)
    const qi = camera.quaternion.clone().invert();
    this.rejoin = { t: 0, off: camera.position.clone().sub(bus.position).applyQuaternion(qi), busQuat: qi.clone().multiply(bus.quaternion), hero: bus.scale.x };
    this.ground = false;
    this.cameBack = true;
    this.world.leave();
    this.onTake?.();
  }

  /** The flight's frame, once its lens and bus are placed: they come over from where the street had them, as Landing's rejoin does. dt: the screen's, s. */
  ease(camera: THREE.PerspectiveCamera, bus: THREE.Object3D, dt: number): void {
    const j = this.rejoin;
    if (!j) return;
    j.t = Math.min(1, j.t + dt / REJOIN);
    const e = j.t * j.t * (3 - 2 * j.t);
    camera.position.sub(bus.position).lerp(j.off, 1 - e).add(bus.position);
    bus.quaternion.slerpQuaternions(j.busQuat, this.qT.copy(bus.quaternion), e);
    bus.scale.setScalar(j.hero + (bus.scale.x - j.hero) * e);
    if (j.t >= 1) this.rejoin = null;
  }

  /** In the flight's frame: under H_GROUND over the city, coming down, the street takes the bus. True if it did. camera and bus: the flight's, in its render frame. */
  update(camera: THREE.PerspectiveCamera, bus: THREE.Object3D): boolean {
    const t = this.trip;
    if (this.ground || t.leg !== 'wait' || t.hGround > H_GROUND || t.nose > 0.02) return false;
    // where it is on the city's map
    const F = this.model.earthFix, r = t.r, ef = this.e;
    for (let i = 0; i < 3; i++) ef[i] = F[i * 3] * r[0] + F[i * 3 + 1] * r[1] + F[i * 3 + 2] * r[2];
    fixToGeodetic(ef, this.g);
    const [x, z] = latLonToLocal(this.g[0], this.g[1], this.world.origin);
    if (!this.world.covers(x, z)) return false;
    const y = this.g[2] * 1000, A = this.axesAt(x, y, z, this.ax);
    // the heading into the map: Earth fixed, from EQJ, then along the street's axes
    const hd = t.heading, he = this.b;
    for (let i = 0; i < 3; i++) he[i] = F[i * 3] * hd[0] + F[i * 3 + 1] * hd[1] + F[i * 3 + 2] * hd[2];
    const hx = he[0] * A[0] + he[1] * A[1] + he[2] * A[2], hz = he[0] * A[6] + he[1] * A[7] + he[2] * A[8];
    // the lens and the bus, from the flight's render frame (its rows are its axes in EQJ) into the street's: render -> EQJ -> fixed -> map
    const R = t.ob.axes, M = this.w;
    for (let k = 0; k < 3; k++)
      for (let j = 0; j < 3; j++) {
        // (map axis k, in render coordinates: the street's axis k, Earth fixed, into EQJ, then onto the render axes)
        let s = 0;
        for (let i = 0; i < 3; i++) {
          let eq = 0;
          for (let l = 0; l < 3; l++) eq += F[l * 3 + i] * A[k * 3 + l];
          s += eq * R[j * 3 + i];
        }
        M[k * 3 + j] = s;
      }
    const toMap = (v: THREE.Vector3) => v.set(M[0] * v.x + M[1] * v.y + M[2] * v.z, M[3] * v.x + M[4] * v.y + M[5] * v.z, M[6] * v.x + M[7] * v.y + M[8] * v.z);
    const qx = toMap(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)), qy = toMap(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)), qz = toMap(new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion));
    const camQuat = new THREE.Quaternion().setFromRotationMatrix(this.m.makeBasis(qx, qy, qz));
    const bx = toMap(new THREE.Vector3(1, 0, 0).applyQuaternion(bus.quaternion)), by = toMap(new THREE.Vector3(0, 1, 0).applyQuaternion(bus.quaternion)), bz = toMap(new THREE.Vector3(0, 0, 1).applyQuaternion(bus.quaternion));
    const busQuat = new THREE.Quaternion().setFromRotationMatrix(this.m.makeBasis(bx, by, bz));
    const camOff = toMap(this.t.copy(camera.position).sub(bus.position)).clone();
    this.ground = true;
    t.toStreet();
    this.world.enter({ x, y, z, heading: Math.atan2(hx, -hz), speed: t.v * 1000, nose: t.nose, camOff, camQuat, busQuat, dive: this.view.dive, gear: t.rung });
    return true;
  }
}

/**
 * ?earth&resume (docs/specs/earth/EARTHFLIGHT.md, E3): the flight boots first and the street behind it, so the join is made before there's a street to join. This stands in for the street until main.ts attaches it,
 * and nothing is under the bus till then. origin: home until then, for what's made before (the resumed trip has its own).
 */
export function laterStreet(origin: readonly [number, number] = [37.7749, -122.4194]): { world: StreetWorld; attach(w: StreetWorld): void } {
  let s: StreetWorld | null = null;
  return {
    world: {
      get origin() {
        return s?.origin ?? origin;
      },
      covers: (x, z) => !!s && s.covers(x, z),
      enter: (e) => s?.enter(e),
      leave: () => s?.leave(),
      frameAt: (now) => s?.frameAt(now),
      pumpOff: () => s?.pumpOff(),
    },
    attach(w) {
      s = w;
    },
  };
}
