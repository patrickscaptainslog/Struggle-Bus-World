import * as THREE from 'three';
import { signBladeWidth, signTune, StreetSigns } from '../fx/StreetSign';
import { readPlaces, type Place, type PlaceRow, type PlaceType } from '../moon/map';
import { R_MOON, type SkyState } from './SkyModel';

// Names from orbit: pass near a place in public/moon/places.json and its street sign springs out of the ground, the plain green one ?moon has for a place the bus has come to. It's the real sign (fx/StreetSign.ts), one draw,
// and the Moon is only a ray test, so it stands in the render frame on the line from the lens to the place, past the bus, and is moved along that line every frame: on screen it rides the ground. Its letters are a fixed size, as
// a sign's are: a name is for reading, and a sign to scale would be a billionth of a pixel.
//
// One at a time, every few seconds, and each place once a lap. A place is in reach when it's somewhere in the middle of the frame, and either big enough to see or close: a sea from a long way off, a landing site only from nearby.
// What's bigger than the view is named when the view is over it, and its sign stands under the view, not at its middle, which may be over the horizon. The more a name is worth, the sooner it goes up: the first steps on the Moon
// first, then the seas and the basins, then the craters, mountains and valleys, then the other landers.

/** Live, the tuner moves them. */
export const nameTune = {
  /** Seconds between one sign and the next. */
  every: 8,
  /** A font pixel of a sign, game px. */
  font: 1.5,
  /** Names start at this height, km. */
  high: 2000,
  /** Over this speed, km/s, the ground goes by too fast to read. */
  fast: 130,
};

/** What a name is worth. */
const WORTH: Record<PlaceType, number> = { site: 2, mare: 5, basin: 5, crater: 4, mountains: 3, valley: 3 };
const APOLLO = 6;
/** A place is in reach this big on screen, px, or this close, km. */
const SEEN_PX = 14;
const CLOSE_KM = 650;
/** The part of the frame a sign may start in: all of its blade in the frame, by this many px, and up and down as shares of the height, about the middle. Under it is the bus; over it, the horizon and the buttons. */
const EDGE = 6;
const LOW = -0.17;
const HIGH = 0.16;
/** A sign this close to one that's up is on top of it, px. */
const CLEAR = 130;
/** How far in from a big place's edge its sign may stand, as a share of its radius. */
const INSIDE = 0.75;
/** Metres from the lens to where a sign stands: past the bus, which flies in front of it. */
const DEPTH = 2600;
/** A place comes round again after this long, s. */
const AGAIN = 300;

interface Standing {
  place: Place;
  text: string;
  /** where it stands on the Moon, unit, Moon fixed */
  at: [number, number, number];
  age: number;
}

export interface NameSeen {
  name: string;
  /** s of the trip's clock */
  at: number;
  /** km over the Moon, and on screen from the frame's middle, px, y up */
  h: number;
  x: number;
  y: number;
}

type V = [number, number, number];

export class MoonNames {
  readonly signs = new StreetSigns();
  /** every sign so far: the tools read this */
  readonly log: NameSeen[] = [];
  private places: Place[] = [];
  private readonly up: Standing[] = [];
  private readonly shown = new Map<number, number>();
  private wait = 0;
  private check = 0;
  private clock = 0;
  private readonly p = { x: 0, y: 0, z: 0, km: 0 };
  private readonly at = new THREE.Vector3();

  get object(): THREE.Object3D {
    return this.signs.object;
  }

  /** The list, after the first frame. No names file, no names: the Moon is the same Moon. */
  load(base: string): void {
    fetch(`${base}/moon/places.json`)
      .then((r) => (r.ok ? (r.json() as Promise<PlaceRow[]>) : []))
      .then((rows) => (this.places = readPlaces(rows)))
      .catch(() => {});
  }

  /** Where a place stands in the render frame, as a unit vector into this.p, and how far it is. False: it's under the horizon. */
  private seen(a: ArrayLike<number>, s: SkyState): boolean {
    const O = s.moonO, x = a[0] * R_MOON - O[0], y = a[1] * R_MOON - O[1], z = a[2] * R_MOON - O[2];
    if (a[0] * O[0] + a[1] * O[1] + a[2] * O[2] <= R_MOON) return false;
    const km = Math.sqrt(x * x + y * y + z * z), m = s.moonRot;
    this.p.x = (m[0] * x + m[1] * y + m[2] * z) / km;
    this.p.y = (m[3] * x + m[4] * y + m[5] * z) / km;
    this.p.z = (m[6] * x + m[7] * y + m[8] * z) / km;
    this.p.km = km;
    return true;
  }

  /** The ground in the middle of the frame, unit, Moon fixed, or null if the frame's middle misses the Moon. */
  private middle(s: SkyState): V | null {
    const O = s.moonO, m = s.moonRot, d: V = [-m[6], -m[7], -m[8]];
    const r = R_MOON / s.moonKm, ox = O[0] / s.moonKm, oy = O[1] / s.moonKm, oz = O[2] / s.moonKm;
    const b = (ox * d[0] + oy * d[1] + oz * d[2]) / r, c = 1 / (r * r) - 1, D = b * b - c;
    if (b >= 0 || D <= 0) return null;
    const t = c / (-b + Math.sqrt(D)), x = ox / r + d[0] * t, y = oy / r + d[1] * t, z = oz / r + d[2] * t, l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  }

  /** Where a sign for this place would stand: the place, or for one wider than the view, the ground in the view, or the nearest of the place to that. */
  private anchor(p: Place, g: V): V {
    const c = Math.min(1, Math.max(-1, p.d[0] * g[0] + p.d[1] * g[1] + p.d[2] * g[2])), ang = Math.acos(c), r = ((p.R / 1000) / R_MOON) * INSIDE;
    if (r < 1e-3 || ang < 1e-5) return [p.d[0], p.d[1], p.d[2]];
    if (ang <= r) return g;
    const k = Math.sin(r) / Math.sin(ang), q = Math.sin(ang - r) / Math.sin(ang);
    return [p.d[0] * q + g[0] * k, p.d[1] * q + g[1] * k, p.d[2] * q + g[2] * k];
  }

  /** The sign most worth putting up now. */
  private pick(s: SkyState, focal: number, w: number, h: number): Standing | null {
    const g = this.middle(s), T = signTune;
    if (!g) return null;
    let best: Standing | null = null, score = -Infinity;
    for (const p of this.places) {
      if (this.clock < (this.shown.get(p.id) ?? -1e9) + AGAIN) continue;
      const at = this.anchor(p, g);
      if (!this.seen(at, s) || this.p.z >= 0) continue;
      const k = focal / -this.p.z, x = this.p.x * k, y = this.p.y * k;
      if (Math.abs(x) > w / 2 - (signBladeWidth(p.name) / T.texelW) * nameTune.font * 0.5 - EDGE || y < LOW * h || y > HIGH * h) continue;
      if ((p.km * focal) / this.p.km < SEEN_PX && this.p.km > CLOSE_KM) continue;
      if (this.crowded(s, focal, x, y)) continue;
      const worth = p.type === 'site' && p.name.startsWith('APOLLO') ? APOLLO : WORTH[p.type];
      const v = worth * 1000 - Math.hypot(x, y);
      if (v > score) {
        score = v;
        best = { place: p, text: p.name, at, age: 0 };
      }
    }
    return best;
  }

  private crowded(s: SkyState, focal: number, x: number, y: number): boolean {
    const px = this.p.x, py = this.p.y, pz = this.p.z, km = this.p.km;
    let near = false;
    for (const u of this.up) {
      if (!this.seen(u.at, s) || this.p.z >= 0) continue;
      const k = focal / -this.p.z;
      if (Math.hypot(this.p.x * k - x, this.p.y * k - y) < CLEAR) near = true;
    }
    this.p.x = px;
    this.p.y = py;
    this.p.z = pz;
    this.p.km = km;
    return near;
  }

  /** One frame, once the sky and the camera are this frame's. `here`: this leg names places at all. */
  update(dt: number, s: SkyState, here: boolean, v: number, clock: number, camera: THREE.Camera, focal: number, w: number, h: number, pop: () => void): void {
    this.clock = clock;
    const T = signTune, life = T.riseTime + T.holdGreen + T.flipTime + T.holdRainbow + T.sinkTime;
    const on = here && v < nameTune.fast && s.moonKm - R_MOON < nameTune.high;
    const c = camera.position;
    for (let i = this.up.length - 1; i >= 0; i--) {
      const u = this.up[i];
      u.age += dt;
      if (u.age >= life) {
        this.up.splice(i, 1);
        continue;
      }
      // (it sinks where it stands, when the place has gone behind or the ground's going by too fast)
      if (!this.seen(u.at, s) || this.p.z >= 0) this.signs.sink(u.text);
      else {
        this.signs.moveTo(u.text, c.x + this.p.x * DEPTH, c.y + this.p.y * DEPTH, c.z + this.p.z * DEPTH);
        if (!on) this.signs.sink(u.text);
      }
    }
    this.wait -= dt;
    this.check -= dt;
    if (on && this.places.length && this.wait <= 0 && this.check <= 0) {
      this.check = 0.25;
      const n = this.pick(s, focal, w, h);
      if (n) {
        this.seen(n.at, s);
        const k = focal / -this.p.z;
        this.log.push({ name: n.text, at: clock, h: s.moonKm - R_MOON, x: Math.round(this.p.x * k), y: Math.round(this.p.y * k) });
        this.shown.set(n.place.id, clock);
        this.up.push(n);
        this.wait = nameTune.every;
        this.signs.show({ text: n.text, position: this.at.set(c.x + this.p.x * DEPTH, c.y + this.p.y * DEPTH, c.z + this.p.z * DEPTH), facing: 0, hue: 0, scale: (nameTune.font * DEPTH) / (T.texelW * focal), biasNow: true, depthBias: 0, plain: true });
        pop();
      }
    }
    this.signs.update(dt, camera);
  }
}
