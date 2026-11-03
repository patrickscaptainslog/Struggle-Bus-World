import type * as THREE from 'three';
import type { PixelPipeline } from '../render/PixelPipeline';
import { spaceResolveUniforms as U } from '../render/skyResolve';
import { R_EARTH_A, R_EARTH_B, MOON, SkyModel, SkyState, type Observer } from '../sky/SkyModel';
import { series } from '../sky/Series';
import { SkyClock } from '../sky/SkyClock';
import { SkyDraw } from '../sky/SkyDraw';
import { axesAt, sphereToFix } from '../sky/WorldFrame';

// The sky over the Moon's ground: the space code as it stands (render/skyResolve.ts, sky/SkyDraw.ts), black, real stars, the real Earth and the Sun.
//
// By default it is HELD. The first thing anyone sees must be long shadows and Earth over the horizon, and the true sky over Theophilus can't promise either: Earth stands 62 degrees up there, out of any frame the
// chase camera has, and for half of every month the Sun is down. So the whole sky is one real moment, turned as one rigid thing until the Sun stands HELD_EL up and Earth hangs just over the horizon: stars,
// Earth and Sun keep their true places against each other, and Earth shows the true phase and face of that moment. It is the sky of a real place near the limb, not of this one. ?t= (any date) drops all of
// that and gives the true sky, over the bus, at that date, with the shadows baked for its Sun.

const DEG = Math.PI / 180;
const R_MOON_KM = 1737.4;

/** The held moment: last quarter, so Earth from here is two fifths lit, the lit part on its east: North America by a Pacific still dark. */
export const HELD_MS = Date.parse('2026-08-05T15:20:00Z');
/** The Sun's height (deg) and its bearing from the bus's first heading (deg): ahead and to the right, so a bowl reads as a bowl (the eye takes light as coming from the top of a picture) and the shadows come toward the view. */
export const HELD_EL = 20;
export const HELD_SUN_OFF = 80;
/** Earth's height over the horizon (deg). */
const HELD_EARTH_EL = 10.5;

const HELD_EARTH_SCALE = 1.7;

export type V = [number, number, number];
/** A compass bearing and an elevation to a unit vector in the render frame: +X east, +Y up, +Z south. */
const dir = (az: number, el: number): V => [Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), -Math.cos(az * DEG) * Math.cos(el * DEG)];
const dot = (a: V | Float64Array, b: V | Float64Array) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

export class MoonSky {
  readonly draw: SkyDraw;
  readonly model = new SkyModel(series);
  readonly state = new SkyState();
  readonly ob: Observer;
  /** Held, or the true sky of ?t=. */
  readonly held: boolean;
  /** Toward the Sun in the render frame, or by night toward Earth: fixed for the whole map, what the ground's light was baked for. */
  readonly sun: V = [0, 1, 0];
  /** The true sky, with the Sun down at the map's centre. */
  night: boolean;
  /** What lights the ground from the map's centre (the Sun, or by night Earth), Moon fixed: a far field that reaches the horizon from 100 km up has it true over each of its blocks. */
  readonly sunFix: V = [0, 0, 1];
  /** How many times too big Earth is drawn. At its true 1.9 degrees it is 20 game pixels on the high lens: a marble with no continents. Held sky only. */
  earthScale = 1;
  private ms: number;
  private readonly clock: SkyClock;
  /** The flight's own sky, the one orbit shows (?moonland): nothing here draws it, and this only says what the ground's light is baked for. */
  private readonly shared: boolean;

  constructor(pipeline: PixelPipeline, params: URLSearchParams, lat0: number, lon0: number, heading: number, shared?: SkyDraw) {
    this.shared = !!shared;
    this.draw = shared ?? new SkyDraw(pipeline);
    if (!shared) {
      this.draw.showLines(false);
      this.draw.moonFloor = 0;
    }
    this.clock = new SkyClock(params);
    this.held = !shared && !params.has('t');
    if (this.held) this.earthScale = Number(params.get('earth')) || HELD_EARTH_SCALE;
    this.ob = { body: MOON, free: false, pos: new Float64Array(3), axes: new Float64Array(9) };
    this.ms = this.held ? HELD_MS : this.clock.now();
    this.night = this.look(lat0, lon0, heading);
  }

  /** Another place, at the true sky of this moment (UTC ms): ?moonland, as the world's made. */
  place(lat0: number, lon0: number, ms: number): void {
    this.ms = ms;
    this.night = this.look(lat0, lon0, 0);
  }

  /** The sky over the map's centre; true if the Sun's down there. */
  private look(lat0: number, lon0: number, heading: number): boolean {
    sphereToFix(R_MOON_KM, lat0, lon0, 0, this.ob.pos);
    axesAt(lat0, lon0, 0, this.ob.axes);
    this.model.frame(this.ms, this.ob, this.state);
    const s = this.state;
    if (this.held) {
      // where they really are against each other, in Moon fixed: a frame on the Sun and the plane through Earth
      const sm: V = [s.moonSun[0], s.moonSun[1], s.moonSun[2]], em: V = [s.moonEarth[0], s.moonEarth[1], s.moonEarth[2]];
      const psi = Math.acos(dot(sm, em));
      // where they are to stand, the same angle apart
      const sunAz = (heading / DEG + HELD_SUN_OFF + 360) % 360;
      const sr = dir(sunAz, HELD_EL);
      // (the far side never sees Earth: there it stands under the ground)
      const farSide = Math.cos(lat0 * DEG) * Math.cos(lon0 * DEG) < -0.05;
      const earthEl = farSide ? -35 : HELD_EARTH_EL;
      const q = (Math.cos(psi) - Math.sin(HELD_EL * DEG) * Math.sin(earthEl * DEG)) / (Math.cos(HELD_EL * DEG) * Math.cos(earthEl * DEG));
      const delta = Math.acos(Math.min(1, Math.max(-1, q))) / DEG;
      const er = dir(sunAz - delta, earthEl);
      const a1 = sm, a3 = unit(cross(sm, em)), a2 = cross(a3, a1);
      const b1 = sr, b3 = unit(cross(sr, er)), b2 = cross(b3, b1);
      // (rows: render X, Y, Z in Moon fixed)
      for (let k = 0; k < 3; k++) for (let l = 0; l < 3; l++) this.ob.axes[k * 3 + l] = b1[k] * a1[l] + b2[k] * a2[l] + b3[k] * a3[l];
      this.model.frame(this.ms, this.ob, this.state);
    }
    this.sun[0] = s.sun[0];
    this.sun[1] = s.sun[1];
    this.sun[2] = s.sun[2];
    this.sunFix[0] = s.moonSun[0];
    this.sunFix[1] = s.moonSun[1];
    this.sunFix[2] = s.moonSun[2];
    // the true sky at night: what lights the ground is Earth, if it's up, and the ground's map is baked for that instead
    const night = s.sun[1] < 0.02;
    if (night && s.earth[1] > 0.05) {
      this.sun[0] = s.earth[0];
      this.sun[1] = s.earth[1];
      this.sun[2] = s.earth[2];
      this.sunFix[0] = s.moonEarth[0];
      this.sunFix[1] = s.moonEarth[1];
      this.sunFix[2] = s.moonEarth[2];
    }
    return night;
  }

  /**
   * The map slid (moonBoot.ts): the true Sun as it stands over the new middle, in the map's own carried axes (u up, e its x, n minus its z), and at night Earth if
   * it's up, as look() has it. A held Sun is the map's and stays. True if it's night there.
   */
  slide(u: ArrayLike<number>, e: ArrayLike<number>, n: ArrayLike<number>): boolean {
    if (this.held) return this.night;
    const s = this.state;
    const inAxes = (v: ArrayLike<number>, o: V) => {
      o[0] = e[0] * v[0] + e[1] * v[1] + e[2] * v[2];
      o[1] = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      o[2] = -(n[0] * v[0] + n[1] * v[1] + n[2] * v[2]);
    };
    inAxes(s.moonSun, this.sun);
    for (let i = 0; i < 3; i++) this.sunFix[i] = s.moonSun[i];
    this.night = this.sun[1] < 0.02;
    const earth: V = [0, 0, 0];
    inAxes(s.moonEarth, earth);
    if (this.night && earth[1] > 0.05) {
      for (let i = 0; i < 3; i++) {
        this.sun[i] = earth[i];
        this.sunFix[i] = s.moonEarth[i];
      }
    }
    return this.night;
  }

  /** The sky's frame goes in the scene before the warm-up. */
  get object(): THREE.Object3D {
    return this.draw.object;
  }

  /** The maps and the stars. */
  load(): Promise<void> {
    return this.shared ? Promise.resolve() : this.draw.load('./sky');
  }

  /** Every frame, the lens set: lat, lon are where the bus is (the true sky turns over it as it goes). */
  update(lat: number, lon: number): void {
    const ob = this.ob;
    let ms = this.ms;
    if (!this.held) {
      ms = this.clock.now();
      sphereToFix(R_MOON_KM, lat, lon, 0, ob.pos);
      axesAt(lat, lon, 0, ob.axes);
    }
    this.model.frame(ms, ob, this.state);
    this.draw.update(this.state);
    // (the Moon's own ray test has nothing to do from its surface: the ground is the ground)
    U.uMoonO.value.w = -1;
    if (this.earthScale !== 1) {
      const s = this.state, k = this.earthScale;
      const ox = s.earthO[0] / (R_EARTH_A * k), oy = s.earthO[1] / (R_EARTH_A * k), oz = s.earthO[2] / (R_EARTH_B * k);
      U.uEarthO.value.set(ox, oy, oz, ox * ox + oy * oy + oz * oz - 1);
    }
  }
}
