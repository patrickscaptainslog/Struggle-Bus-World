import type * as THREE from 'three';
import { config } from '../config';
import { globals, heldGlobals } from '../render/materials';
import { dayRows, RAMP_STEPS, Ramp, writePalette } from '../render/palette';
import type { PixelPipeline } from '../render/PixelPipeline';
import { setHourUp } from './flag';
import { HeldHour } from './HeldHour';
import { series } from './Series';
import { fogLuma, fogLumaOf, TableBlend } from './SkyTable';
import { SkyClock } from './SkyClock';
import { StreetSky } from './StreetSky';
import { EARTH, SkyModel, SkyState, type Observer } from './SkyModel';
import { axesAt, geodeticToFix } from './WorldFrame';

// The live sky (docs/specs/sky/LIVE.md, SKY.md S2): the real Sun over the city's origin at the real time, or ?t= and ?rate= (SkyClock). A player anywhere sees the
// city's sky as it is there. Four vectors (SKY.md 2): the sky's own Sun every frame, true plus refraction (uSkySunDir, the disc and the day sky's glow); the key, true,
// on the tick (pipeline.keyDir, the sun pass); the shading vector, the key with the noon knee (uSunDir, every material, as today). Light moves, tables colour: the
// tables blend by the Sun's height (SkyTable.ts TableBlend), and the held hour (HeldHour.ts) comes up with them, its lights by the city's clock and the lamps' wave.
// The stars, the planets and the Moon are StreetSky.ts's; at night the Moon, when it's up, takes the key (SKY.md 4.5).
//
// Nothing here allocates once it's built: frame() runs every render frame.

const DEG = Math.PI / 180;

/** Sunset and sunrise: the true centre 50 arcmin down, the upper limb on the horizon through 34 arcmin of air. */
const SUNSET = -50 / 60;

/**
 * SKY.md 4's key table by the true Sun's height (deg): height, ambient, sky bounce, key. Setting and rising differ above the horizon and are one under it. From
 * 0.5 degrees down the key is the afterglow and the pass has gone. Night keeps the blue hour's look (LIVE.md decision 2): from -4 down it is S1's held light,
 * .34 / .20 / .20, where research-render's curve ran on to .04, a darker city than the one the producer flew. Heights fall; past either end a row holds.
 */
const SETTING = new Float64Array([35, 0.3, 0.22, 0.46, 22, 0.3, 0.24, 0.52, 7, 0.31, 0.12, 0.66, 1.5, 0.34, 0.1, 0.62, 0.5, 0.34, 0.2, 0.3, -4, 0.34, 0.2, 0.2]);
const RISING = new Float64Array([35, 0.3, 0.22, 0.46, 16, 0.33, 0.22, 0.5, 1, 0.36, 0.12, 0.46, 0.5, 0.34, 0.2, 0.3, -4, 0.34, 0.2, 0.2]);
/** The rows' last height (deg): the night's light from here down. */
const NIGHT = SETTING[SETTING.length - 4];

/** The share of the evening's windows lit by the city's clock (local hour, share): homes and offices as one, since a window has one threshold (SKY.md 4.4). */
const LIT_CLOCK = new Float64Array([0, 0.6, 2, 0.35, 4, 0.22, 5.5, 0.25, 7, 0.55, 9, 0.4, 16, 0.5, 18, 1, 21.5, 1, 23, 0.8, 24, 0.6]);

/** A row of LIT_CLOCK at that hour. */
function litAt(hr: number): number {
  let i = 0;
  while (i + 2 < LIT_CLOCK.length - 2 && hr >= LIT_CLOCK[i + 2]) i += 2;
  const u = Math.min(1, Math.max(0, (hr - LIT_CLOCK[i]) / (LIT_CLOCK[i + 2] - LIT_CLOCK[i])));
  return LIT_CLOCK[i + 1] + (LIT_CLOCK[i + 3] - LIT_CLOCK[i + 1]) * u;
}

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
  /** The stars, the planets and the Moon. */
  readonly street: StreetSky;
  private readonly ob: Observer = { body: EARTH, free: false, pos: new Float64Array(3), axes: new Float64Array(9) };
  private lat = NaN;
  private lon = 0;
  /** this frame: the true Sun's height and compass azimuth (deg), what the eye sees (deg) */
  sunEl = 0;
  sunAz = 0;
  seenEl = 0;
  /** the key's height at the last tick (deg; 0 for the afterglow, which casts nothing): what the sun pass reads */
  keyEl = 0;
  /** the key's own height and azimuth at the last tick (deg), the afterglow's too: what the next tick measures from */
  private keyH = 0;
  private keyAz = 0;
  /** the shading vector's compass azimuth (deg), and the sky time and real time of the last tick */
  private shadeAz = NaN;
  private tickSky = 0;
  private tickReal = -1e9;
  /** since when (real ms) a tick has been due and waited for the view to move */
  private dueSince = -1;
  /** ticks so far (QA) */
  ticks = 0;
  /** the moonlight's weight at the last tick: a tick is due when it has moved */
  private tickMoon = 0;
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
  /** the tables, and the Sun's height, the setting share and the switches they were last written for */
  readonly tables = new TableBlend();
  private tableH = NaN;
  private tableW = 0;
  private tableKey = -1;
  /** the Sun was under SUNSET at the last frame: crossing it the key leaves the Sun or comes back to it at once */
  private down = false;
  /** the city's time against UTC (min) and the sky minute it was read for; the zone, when its city.json names one */
  private tz: string | undefined;
  private tzOffset = 0;
  private tzAt = NaN;
  private tzFmt: Intl.DateTimeFormat | null = null;
  /** the page's colour as last written (0xRRGGBB), and the status bar's tag */
  private pageRgb = -1;
  private themeTag: Element | null = null;

  constructor(private readonly pipeline: PixelPipeline, params: URLSearchParams) {
    this.clock = new SkyClock(params);
    this.hour = new HeldHour(pipeline, true);
    this.street = new StreetSky(pipeline);
    // (none of the hour until the city is placed: the day's)
    this.hour.bands = this.hour.lit = this.hour.wave = 0;
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
    // (the moment's table and light now, not at the first frame: the warm-up runs in between, and a night page reads its table before it)
    this.update();
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
    // the tables, and the hour as far as they have come to it
    const w = this.setting(), T = this.tables;
    T.place(h, w);
    this.table(h, w);
    this.pipeline.sunRad = s.sunR;
    this.pipeline.sunRing = seen + s.sunR / DEG > -dip ? (T.bands > 0.5 && S.table ? Ramp.TWILIGHT : Ramp.SKY_WARM) : -1;
    // (the day sky's warm band is a low sun's; under the hour the bands bend toward the Sun until it's deep down: S1 held it at -5.9)
    this.pipeline.heldUniforms.uSkyWarm.value.set((1 - smooth(25, 45, h)) * smooth(-6, 0, h), smooth(-18, -8, h));
    const mh = Math.asin(Math.max(-1, Math.min(1, s.moon[1]))) / DEG;
    this.street.update(ms, s, this.model, h, T.hour, this.camY, mh + refraction(mh, air));

    const down = h < SUNSET, changed = down !== this.down;
    this.down = down;
    setHourUp(T.hour);
    this.tick(ms, h, az, changed);
    const d = this.shade, l = this.light;
    globals.uSunDir.value.set(d[0], d[1], d[2]);
    globals.uLight.value.set(l[0], l[1], l[2]);
    this.clockHands(ms);
    // windows by the city's clock as the dark comes (the hour's own blend); lamps in a wave from -2 to -4 degrees, by a threshold each (Lamps.ts)
    const local = ((((ms / 60000 + this.tzOffset) % 1440) + 1440) % 1440) / 60;
    this.hour.bands = T.bands;
    this.hour.lit = litAt(local) * T.hour;
    this.hour.wave = Math.min(1, Math.max(0, (-2 - h) / 2));
    this.hour.update(az);
  }

  /** The palette takes the moment's table when the Sun has moved 0.05 degrees (12 s or so at San Francisco's sunset) or a switch moved: never a frame of its own. */
  private table(h: number, w: number): void {
    const S = config.sky, key = (S.table ? 1 : 0) + (S.paint ? 2 : 0);
    if (key === this.tableKey && Math.abs(h - this.tableH) < 0.05 && Math.abs(w - this.tableW) < 0.01) return;
    this.tableKey = key;
    this.tableH = h;
    this.tableW = w;
    const tex = this.pipeline.paletteTexture, data = tex.image.data as unknown as Uint8Array, fog = this.pipeline.heldUniforms.uFogLuma.value;
    if (S.table) {
      this.tables.write(data, !!S.paint);
      fogLumaOf(data, fog);
    } else {
      writePalette(data, dayRows);
      fogLuma(false, fog);
    }
    tex.needsUpdate = true;
    this.page(data, !!S.table && this.tables.bands >= 0.5);
  }

  /**
   * The status bar (theme-color) and the page under the canvas follow the sky, from the table just written: the day's sky is FOG 2, the grey the page was, and
   * under the bands it's SKY_LOW 3, the band most of a frame's sky is, as index.html's first paint took them. Written only when the colour changes, and from then
   * on the first paint's own write, if city.json lands for it later, leaves it alone (__sbPage).
   */
  private page(data: Uint8Array, bands: boolean): void {
    const i = ((bands ? Ramp.SKY_LOW : Ramp.FOG) * RAMP_STEPS + (bands ? 3 : 2)) * 4;
    const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (rgb === this.pageRgb || typeof document === 'undefined') return;
    this.pageRgb = rgb;
    (globalThis as { __sbPage?: boolean }).__sbPage = true;
    const c = `#${rgb.toString(16).padStart(6, '0')}`;
    this.themeTag ??= document.querySelector('meta[name=theme-color]');
    this.themeTag?.setAttribute('content', c);
    document.documentElement.style.backgroundColor = c;
    document.body.style.backgroundColor = c;
  }

  /**
   * The key and the shading vector move only here (SKY.md 2, research-render.md 2.4): when a wall's shadow tip would have moved tickPx game px, at most once a
   * second, on a frame where the view moved; held still, after tickHold at 20 degrees and up, sooner to 10, at once under it. Between ticks the sun pass's
   * texel lattice stands still and no shadow crawls.
   */
  private tick(ms: number, h: number, az: number, force: boolean): void {
    const S = config.sky, now = performance.now();
    const sun = h >= 0.5;
    // (under 0.5 the key's height goes over to keyHeight's as the light's rows go over to the night's, so no roof steps at the crossing)
    const kEl = sun ? h : 0.5 + (S.keyHeight - 0.5) * Math.min(1, (0.5 - h) / (0.5 - NIGHT));
    if (!force && this.ticks > 0) {
      const dAz = Math.abs(((az - this.keyAz + 540) % 360) - 180) * DEG;
      const l0 = shadowLength(S.tickWall, this.keyH), l1 = shadowLength(S.tickWall, kEl);
      const px = Math.hypot(l1 - l0, l1 * dAz) / this.pxM;
      if ((px < S.tickPx && Math.abs(this.street.moonKey - this.tickMoon) < 0.02) || now - this.tickReal < 1000) {
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
    // moonlight: the shading vector goes over to the Moon's as its weight comes, with the knee, while there's no sun pass to swing a shadow (StreetSky.moonKey)
    const mk = this.street.moonKey, m = this.state.moon, mf = Math.hypot(m[0], m[2]);
    this.tickMoon = mk;
    if (mk > 0 && mf > 1e-9) {
      const me = knee(this.street.moonEl) * DEG, mc = Math.cos(me) / mf;
      d[0] += (m[0] * mc - d[0]) * mk;
      d[1] += (Math.sin(me) - d[1]) * mk;
      d[2] += (m[2] * mc - d[2]) * mk;
      const dl = Math.hypot(d[0], d[1], d[2]);
      d[0] /= dl;
      d[1] /= dl;
      d[2] /= dl;
    }
    // the light, by the true height: setting after solar noon, rising before it, crossing over three hours round noon and midnight
    keyAt(SETTING, h, this.row);
    keyAt(RISING, h, this.row2);
    const w = this.setting(), r = this.row, q = this.row2, l = this.light;
    l[0] = q[2] + (r[2] - q[2]) * w;
    l[1] = q[0] + (r[0] - q[0]) * w;
    l[2] = q[1] + (r[1] - q[1]) * w;
    // (and its strength: the night's key times 1 + k, k = min(max, 0.22 x lit / max(sin el, 0.15)))
    if (mk > 0) l[0] *= 1 + mk * Math.min(S.moonKeyMax, (S.moonKey * this.street.moonLit) / Math.max(Math.sin(this.street.moonEl * DEG), 0.15));
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

  /** A landmark clock's hands, and the windows' clock: the city's time, from its zone (city.json's tz), else the mean Sun's at its longitude. */
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
