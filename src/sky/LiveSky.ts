import type * as THREE from 'three';
import { config } from '../config';
import { globals, heldGlobals } from '../render/materials';
import { Ramp } from '../render/palette';
import type { PixelPipeline } from '../render/PixelPipeline';
import { hourUp, setHourUp } from './flag';
import { HeldHour } from './HeldHour';
import { series } from './Series';
import { SkyClock } from './SkyClock';
import { EARTH, SkyModel, SkyState, type Observer } from './SkyModel';
import { axesAt, geodeticToFix } from './WorldFrame';

// The live sky (docs/specs/sky/LIVE.md, SKY.md S2): the real Sun over the city's origin at the real time, or ?t= and ?rate= (SkyClock). A player anywhere sees the
// city's sky as it is there. Four vectors (SKY.md 2): the sky's own Sun every frame, true plus refraction (uSkySunDir, the disc and the day sky's glow); the key, true,
// on the tick (pipeline.keyDir, the sun pass); the shading vector, the key with the noon knee (uSunDir, every material, as today). Light moves, tables colour: the
// day keeps today's table, and from sunset to sunrise the held hour is up (HeldHour.ts, hourUp), its blue table and its lights. Stage B blends the tables.
//
// Nothing here allocates once it's built: frame() runs every render frame.

const DEG = Math.PI / 180;

/** Sunset and sunrise: the true centre 50 arcmin down, the upper limb on the horizon through 34 arcmin of air. */
const SUNSET = -50 / 60;

/**
 * SKY.md 4's key table by the true Sun's height (deg): height, ambient, sky bounce, key. Setting and rising differ above the horizon and are one under it. From
 * 0.5 degrees down the key is the afterglow, .30 to .06 over dusk (research-render.md 2.3), and the pass has gone. Heights fall; above the first row it holds.
 */
const SETTING = new Float64Array([35, 0.3, 0.22, 0.46, 22, 0.3, 0.24, 0.52, 7, 0.31, 0.12, 0.66, 1.5, 0.34, 0.1, 0.62, 0.5, 0.34, 0.2, 0.3, -6, 0.34, 0.2, 0.06, -12, 0.3, 0.24, 0.04]);
const RISING = new Float64Array([35, 0.3, 0.22, 0.46, 16, 0.33, 0.22, 0.5, 1, 0.36, 0.12, 0.46, 0.5, 0.34, 0.2, 0.3, -6, 0.34, 0.2, 0.06, -12, 0.3, 0.24, 0.04]);

/** A row of `t` at height h into o[0..2]. */
function keyAt(t: Float64Array, h: number, o: Float64Array): void {
  let i = 0;
  if (h < t[0]) while (i + 4 < t.length && h < t[i + 4]) i += 4;
  const j = Math.min(i + 4, t.length - 4), span = t[i] - t[j];
  const u = span > 0 ? Math.min(1, Math.max(0, (t[i] - h) / span)) : 0;
  for (let k = 0; k < 3; k++) o[k] = t[i + 1 + k] + (t[j + 1 + k] - t[i + 1 + k]) * u;
}

/** A wall's shadow (m) under a key that high (deg). */
const shadowLength = (wall: number, el: number) => wall / Math.tan(Math.max(0.5, el) * DEG);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** SKY.md 4.3: the shading vector's height. Unchanged to 28 degrees, then a knee toward 42 at the zenith: render's table to 0.1 degree (true 75 shades as 41.4). */
export function knee(el: number): number {
  return el <= 28 ? el : 28 + 14 * (1 - Math.pow(Math.max(0, 1 - (el - 28) / 62), 2.2));
}

/** Refraction at a true height (deg), Saemundsson's: 34 arcmin where the Sun looks to sit on the horizon, 29 at true 0; `air` the density at the eye (1 at the sea). */
export function refraction(h: number, air: number): number {
  const hc = Math.max(h, -1.5);
  return ((1.02 / Math.tan((hc + 10.3 / (hc + 5.11)) * DEG)) / 60) * air;
}

export class LiveSky {
  readonly clock: SkyClock;
  readonly model = new SkyModel(series);
  readonly state = new SkyState();
  /** The held hour, which draws the nights. */
  readonly hour: HeldHour;
  private readonly ob: Observer = { body: EARTH, free: false, pos: new Float64Array(3), axes: new Float64Array(9) };
  private lat = NaN;
  private lon = 0;
  /** this frame: the true Sun's height and compass azimuth (deg), what the eye sees (deg) */
  sunEl = 0;
  sunAz = 0;
  seenEl = 0;
  /** the key at the last tick: height (deg; 0 for the afterglow, which casts nothing), compass azimuth of the shading vector (deg), sky time and real time of it */
  keyEl = 0;
  /** the key's own height and azimuth at the last tick (deg), the afterglow's too: what the next tick measures from */
  private keyH = 0;
  private keyAz = 0;
  private shadeAz = NaN;
  private tickSky = 0;
  private tickReal = -1e9;
  /** since when (real ms) a tick has been due and waited for the view to move */
  private dueSince = -1;
  /** ticks so far (QA) */
  ticks = 0;
  /** the view, from view(): its height (m), metres a game pixel is at the bus, game px it moved last frame */
  private camY = 0;
  private pxM = 0.17;
  private moved = 0;
  private readonly lastPos = new Float64Array([NaN, 0, 0]);
  private readonly lastFwd = new Float64Array(3);
  private readonly row = new Float64Array(3);
  private readonly row2 = new Float64Array(3);
  /** the shading vector and uLight at the last tick: written every frame, over the day's light that updateSun wrote first */
  readonly shade = new Float64Array([0, 1, 0]);
  readonly light = new Float64Array([config.light.sunStrength, config.light.ambient, config.light.skyBounce]);
  /** the city's time against UTC (min) and the sky minute it was read for; the zone, when its city.json names one */
  private tz: string | undefined;
  private tzOffset = 0;
  private tzAt = NaN;
  private tzFmt: Intl.DateTimeFormat | null = null;

  constructor(private readonly pipeline: PixelPipeline, params: URLSearchParams) {
    this.clock = new SkyClock(params);
    this.hour = new HeldHour(pipeline, true);
  }

  /** The city's origin [lat, lon] (deg), and its zone if its city.json names one. Until then the sky stands at the day's. */
  place(origin: readonly number[], tz?: string): void {
    this.lat = origin[0];
    this.lon = origin[1];
    this.tz = tz;
    // (the city's frame is a transverse Mercator about its origin: no grid convergence there)
    geodeticToFix(this.lat, this.lon, 0, this.ob.pos);
    axesAt(this.lat, this.lon, 0, this.ob.axes);
    this.ticks = 0;
    this.shadeAz = NaN;
  }

  /** Once a frame, after the camera is placed: what the tick reads of the view. `focusDist` the lens's distance to the bus (m). */
  view(camera: THREE.PerspectiveCamera, focusDist: number): void {
    const e = camera.matrixWorld.elements, px = Math.max(1e-6, globals.uPixelAngle.value), p = this.lastPos, f = this.lastFwd;
    const x = e[12], y = e[13], z = e[14], fx = -e[8], fy = -e[9], fz = -e[10];
    this.pxM = px * Math.max(1, focusDist);
    this.camY = y;
    if (Number.isNaN(p[0])) this.moved = 0;
    else {
      const dot = Math.min(1, Math.max(-1, fx * f[0] + fy * f[1] + fz * f[2]));
      this.moved = Math.max(Math.hypot(x - p[0], y - p[1], z - p[2]) / this.pxM, Math.acos(dot) / px);
    }
    p[0] = x;
    p[1] = y;
    p[2] = z;
    f[0] = fx;
    f[1] = fy;
    f[2] = fz;
  }

  /** The sun pass's strength by the key's height (SKY.md 4.2): today's from 12 degrees, the street's alone under it, fading out from 3 to none under 0.5. */
  passK(vista: number): number {
    const h = this.keyEl;
    return smooth(0.5, 3, h) * (1 - (1 - smooth(10, 12, h)) * smooth(0.25, 0.35, vista));
  }

  /** UTC now, ISO (QA: allocates). */
  get utc(): string {
    return new Date(this.clock.now()).toISOString();
  }

  /** Every frame, before the light is read: the model, the sky's Sun, the tick, the hour. */
  update(): void {
    if (Number.isNaN(this.lat)) {
      this.hour.update(this.sunAz);
      return;
    }
    const ms = this.clock.now(), s = this.state, S = config.sky;
    this.model.frame(ms, this.ob, s);
    const sx = s.sun[0], sy = s.sun[1], sz = s.sun[2];
    const h = Math.asin(Math.max(-1, Math.min(1, sy))) / DEG, flat = Math.hypot(sx, sz);
    // (render +X east, +Z south: the compass azimuth from north, east of it)
    const az = flat > 1e-9 ? ((Math.atan2(sx, -sz) / DEG + 360) % 360) : this.sunAz;
    this.sunEl = h;
    this.sunAz = az;

    // the sky's own Sun: lifted by the air, the azimuth true
    const air = Math.exp(-Math.max(0, this.camY) / 8434);
    const seen = h + refraction(h, air);
    this.seenEl = seen;
    const ca = Math.sin(az * DEG), cz = -Math.cos(az * DEG), ce = Math.cos(seen * DEG);
    heldGlobals.uSkySunDir.value.set(ca * ce, Math.sin(seen * DEG), cz * ce);
    // (the disc where the eye can see it: down to the horizon's dip at this height)
    const dip = Math.acos(6371000 / (6371000 + Math.max(0, this.camY))) / DEG;
    const up = h < SUNSET;
    this.pipeline.sunRad = s.sunR;
    this.pipeline.sunRing = seen + s.sunR / DEG > -dip ? (up && S.table ? Ramp.TWILIGHT : Ramp.SKY_WARM) : -1;
    // (the day sky's warm band is a low sun's; under the hour the bands bend toward the Sun until it's deep down: S1 held it at -5.9)
    this.pipeline.heldUniforms.uSkyWarm.value.set((1 - smooth(25, 45, h)) * smooth(-6, 0, h), smooth(-18, -8, h));

    const changed = up !== hourUp();
    setHourUp(up);
    this.tick(ms, h, az, changed);
    const d = this.shade, l = this.light;
    globals.uSunDir.value.set(d[0], d[1], d[2]);
    globals.uLight.value.set(l[0], l[1], l[2]);
    this.hour.update(az);
    this.clockHands(ms);
  }

  /**
   * The key and the shading vector move only here (SKY.md 2, research-render.md 2.4): when a wall's shadow tip would have moved tickPx game px, at most once a
   * second, on a frame where the view moved; held still, after tickHold at 20 degrees and up, sooner to 10, at once under it. Between ticks the sun pass's
   * texel lattice stands still and no shadow crawls.
   */
  private tick(ms: number, h: number, az: number, force: boolean): void {
    const S = config.sky, now = performance.now();
    const sun = h >= 0.5;
    const kEl = sun ? h : S.keyHeight;
    if (!force && this.ticks > 0) {
      const dAz = Math.abs(((az - this.keyAz + 540) % 360) - 180) * DEG;
      const l0 = shadowLength(S.tickWall, this.keyH), l1 = shadowLength(S.tickWall, kEl);
      const px = Math.hypot(l1 - l0, l1 * dAz) / this.pxM;
      if (px < S.tickPx || now - this.tickReal < 1000) {
        this.dueSince = -1;
        return;
      }
      if (this.dueSince < 0) this.dueSince = now;
      const hold = S.tickHold * smooth(10, 20, h) * 1000;
      if (this.moved < S.tickMove && now - this.dueSince < hold) return;
    }
    // the key: the Sun, or under 0.5 degrees the afterglow at its azimuth (no shadow, so the vector crosses over unseen)
    const kc = Math.cos(kEl * DEG), ks = Math.sin(kEl * DEG), ka = Math.sin(az * DEG), kz = -Math.cos(az * DEG);
    this.pipeline.keyDir.set(ka * kc, ks, kz * kc);
    this.keyEl = sun ? h : 0;
    this.keyH = kEl;
    this.keyAz = az;
    // the shading vector: the knee, and an azimuth that turns no faster than `slew`
    const step = S.slew * (Math.abs(ms - this.tickSky) / 3.6e6);
    const turn = ((az - this.shadeAz + 540) % 360) - 180;
    this.shadeAz = Number.isNaN(this.shadeAz) ? az : (this.shadeAz + Math.max(-step, Math.min(step, turn)) + 360) % 360;
    const e = knee(kEl) * DEG, ec = Math.cos(e), d = this.shade;
    d[0] = Math.sin(this.shadeAz * DEG) * ec;
    d[1] = Math.sin(e);
    d[2] = -Math.cos(this.shadeAz * DEG) * ec;
    // the light, by the true height: setting after solar noon, rising before it, crossing over three hours round noon and midnight
    keyAt(SETTING, h, this.row);
    keyAt(RISING, h, this.row2);
    const w = this.setting(), r = this.row, q = this.row2, l = this.light;
    l[0] = q[2] + (r[2] - q[2]) * w;
    l[1] = q[0] + (r[0] - q[0]) * w;
    l[2] = q[1] + (r[1] - q[1]) * w;
    this.tickSky = ms;
    this.tickReal = now;
    this.dueSince = -1;
    this.ticks++;
  }

  /** How much of the light is the setting Sun's, 0..1, by its hour angle: 1 from 1.5 h after solar noon to 1.5 h before midnight. */
  private setting(): number {
    const s = this.state.sun, p = this.lat * DEG;
    // (east, north, up: the hour angle against the local meridian, westward)
    const H = Math.atan2(-s[0], s[1] * Math.cos(p) + s[2] * Math.sin(p)) / DEG / 15;
    return H > 6 ? 1 - smooth(10.5, 13.5, H) : H < -6 ? 1 - smooth(10.5, 13.5, H + 24) : smooth(-1.5, 1.5, H);
  }

  /** A landmark clock's hands: the city's time, from its zone when its city.json names one (stage B), else the mean Sun's at its longitude. */
  private clockHands(ms: number): void {
    const minute = Math.floor(ms / 60000);
    if (minute !== this.tzAt) {
      this.tzAt = minute;
      this.tzOffset = this.tz ? this.zoneOffset(minute * 60000) : Math.round(this.lon * 4);
    }
    const t = (((ms / 60000 + this.tzOffset) % 1440) + 1440) % 1440;
    heldGlobals.uClockHands.value.set(((t % 720) / 720) * 2 * Math.PI, ((t % 60) / 60) * 2 * Math.PI);
  }

  /** The zone's offset from UTC at that minute (min): once a sky minute, so Intl's few objects are no frame's. */
  private zoneOffset(ms: number): number {
    try {
      this.tzFmt ??= new Intl.DateTimeFormat('en-US', { timeZone: this.tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
      const p: Record<string, number> = {};
      for (const x of this.tzFmt.formatToParts(ms)) p[x.type] = Number(x.value);
      return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms) / 60000);
    } catch {
      return Math.round(this.lon * 4);
    }
  }
}
