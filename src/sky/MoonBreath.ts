import * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import type { BusModel, BusPose } from '../bus/BusModel';
import { config } from '../config';
import { fxTune, Particles, type GeyserLive } from '../fx/Particles';
import type { BlastDot } from '../game/blastLayout';
import type { PixelPipeline } from '../render/PixelPipeline';
import { spaceResolveUniforms as U } from '../render/skyResolve';
import { browserStore, EDGE_KM, MoonPaint, PAINT_W, placeOf, TEXEL_KM, type PaintJob, type PaintOver, type PaintRect, type PaintStroke } from './MoonPaint';
import { R_MOON, type SkyState } from './SkyModel';

// A breath in orbit: the game's tap, flown from a bus that never leaves the render origin (moonrun.ts) at a Moon that is never in the render frame.
//
// Nothing here is new to the game but where it lands. The breath is the real Particles geyser on the real timings of config.splat: the inhale, the squash, the heave, the belly's refill, so a shot goes when the
// glint says it's loaded. Its target is a stand-in: the true point is 400 km off, past any depth the frame has, so the ribbon flies to a point on the same line of sight PROXY metres out, and lands on the pixel of the
// true place. The impact is the game's too: flash, hit-stop, kick, splash, fountain, the 64 flung blobs, each landing on a spatter drop the map holds back for it, and sparkles where the wave has been. Those fly in
// stand-in metres, at a gravity that gives clean slow arcs over a blast 100 km wide, and the place they land on is led by how fast that part of the ground is sliding down the frame.
//
// The aim is one source of truth, as Aim.ts's is. A tap on the ground ahead of the bus lands there; any other tap (the sky, under the bus, Space on a keyboard) lands where the glint is, on the ground just ahead of its
// nose. It is a fixed place on the Moon from the tap on. Hitting paint again is what levels it up, and paint slides down the frame slowly enough to be tapped again (G3: MoonTrip.ts).

const DEG = Math.PI / 180;
/** The stand-in's distance from the camera, m. */
const PROXY = 1000;
/** The jet's flight, s. With the inhale a shot lands about a second after the tap: a long breath, as one from high over the city is. */
const TRAVEL = 0.92;
/** ms of drawing a frame while a shot flies. */
const SLICE_MS = 1.5;
/** km: a crater shot's glint, about the crater it will take (CraterPaint's HIGH_AIM and HIGH_R). */
const CRATER_GLINT_KM = 4;
/** A settled blast's reveal is cleared this long after its impact: the last blob is down. */
const SETTLE_S = 1.7;
/** How far the glint stands over the bus's middle, a share of the focal length: just clear of its nose. */
const AIM_OVER = 0.075;
/** The wave's band, km: the game's 12 m, read as km, and half as much again so seven bands hold on this grid of pixels. */
const RING_KM = 18;
/** How far the edge's lookup wobbles, texels. */
const WARP_TEXELS = 0.85;
/** ms of drawing saved strokes before the first frame, and in a frame after it. */
const REBUILD_BOOT_MS = 40;
const REBUILD_FRAME_MS = 3;
/** Seconds after the impact that sparkles go up. */
const SPARK_AT = [0.15, 0.45, 0.8];
/** The breath goes on pouring into the splash this long past the impact, s. */
const POUR_S = 0.3;

/** A breath 400 km long, by the frame's pixels rather than by the street's: 1.75 m of stand-in is a pixel, so the blobs and speeds are a few times the game's and fall at a slow, clean rate. */
const TUNE = {
  ribbonRate: 3400, halfWidth0: 5.2, halfWidth1: 4.4, blobSize: 1.7, blobMouth: 0.62, sprayFrac: 0.03, sprayScatter: 4, flickRate: 120, flickOut: 12, wobbleAmp: 1.2, stretch: 0.08, maxStretch: 18, glintFrac: 0.02,
  gravity: 170, burstUp: 150, burstOut: 56, burstSize: 3.6, splashUp: 84, splashOut: 46, splashSize: 2.2, roofRadius: 1e4, hopUp: 18, hopOut: 14,
  flingSplash: 5, sparkSize: 7, sparkLife: 1.1, sparkRise: 9,
};

const ss =(a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Shot {
  stroke: PaintStroke;
  /** null: a crater shot (?moonland), which paints the crater it lands on, through onCrater, and not the map */
  job: PaintJob | null;
  /** Moon fixed */
  n: Float64Array;
  jetAt: number;
  impact: number;
  jetOut: boolean;
}

export class MoonBreath {
  readonly paint: MoonPaint;
  readonly particles = new Particles(10000);
  readonly tex: THREE.DataTexture;
  /** a shot has been fired this flight: the label stops asking */
  fired = false;
  /** The game's synthesized sound, set by moonrun.ts: the hurk, the splat, the canon's next chord on the bells. */
  audio: AudioEngine | null = null;
  /** seconds of hit-stop left: moonrun.ts holds the flight for them */
  hitStop = 0;
  /** the camera's jolt this frame, radians of pitch */
  kick = 0;
  /** where the last tap went, game px from the frame's middle, +y up: tools read it */
  readonly lastTap = { x: 0, y: 0, ground: false };
  /** counters a tool can read */
  readonly stats = { shots: 0, denied: 0, uploads: 0, bytes: 0, overs: 0, overBytes: 0 };

  private readonly pipeline: PixelPipeline;
  private readonly bus: BusModel;
  /** What fxTune held before this frame's numbers went in. */
  private readonly kept = { ...TUNE };
  private t = 0;
  private barfT = -1;
  private fullness = 1;
  private squashV = 0;
  private shot: Shot | null = null;
  private live: { job: PaintJob; at: number; n: Float64Array; sparks: number } | null = null;
  private kickT = 1e3;
  private kickA = 0;
  /** where the jet is still pouring, past its impact */
  private pour: { n: Float64Array; until: number } | null = null;
  /** the frame's aim: Moon fixed, or none */
  private readonly aim = new Float64Array(3);
  private aimOn = false;
  private readonly hit = new Float64Array(3);
  private readonly mouth = new THREE.Vector3();
  private readonly frontLocal: THREE.Vector3;
  private readonly busVel = new THREE.Vector3();
  private readonly tA = new THREE.Vector3();
  private readonly tB = new THREE.Vector3();
  private readonly dirNow = new THREE.Vector3();
  private readonly dirWas = new THREE.Vector3();
  private readonly dirRate = new THREE.Vector3();
  private dirKnown = false;
  private readonly sparkHues = [0, 0, 0];
  private readonly jet: GeyserLive = { target: new THREE.Vector3(), travel: TRAVEL, rate: 1, width: 1 };
  /** set by the frame: the sky it's reading */
  private sky: SkyState | null = null;
  private focal = 570;
  private frameW = 393;
  private frameH = 852;
  /** craters painted down there, for this map */
  private readonly lows: PaintStroke[] = [];
  private lowJob: PaintJob | null = null;
  /** the bus's row on the frame, game px from the middle, +y up: taps under it are on or behind its nose */
  private busPy = -61;
  /** where a press last touched, css px, and when: a tap with no press near it is a key */
  private touchX = 0;
  private touchY = 0;
  private touchAt = -1e9;

  constructor(pipeline: PixelPipeline, bus: BusModel) {
    this.pipeline = pipeline;
    this.bus = bus;
    this.frontLocal = new THREE.Vector3(0, 0.4, -bus.length * 0.5 - 0.6);
    // the seed of the hues: a fresh Moon doesn't always start at red
    this.paint = new MoonPaint(browserStore(), (Math.random() * 0xffffffff) >>> 0);
    const m = this.paint.mips;
    const t = new THREE.DataTexture(m[0].data as Uint8Array<ArrayBuffer>, m[0].width, m[0].height, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.mipmaps = m as unknown as THREE.DataTexture['mipmaps'];
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = false;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    this.tex = t;
  }

  /** fxTune is one object, and ?moonland's page has two breaths: this one's numbers go in for the flight's frame and come out at the end of it, so the low game's are the low game's, Moon gravity and all. */
  numbersIn(): void {
    const kept = this.kept as Record<string, number>, f = fxTune as unknown as Record<string, number>;
    for (const k of Object.keys(TUNE)) {
      kept[k] = f[k];
      f[k] = (TUNE as Record<string, number>)[k];
    }
  }

  numbersOut(): void {
    Object.assign(fxTune, this.kept);
  }

  /** The saved strokes into the map and the map to the GPU, before the first frame. A long list goes on in slices once the game is running: the Moon is a far disc for minutes yet. */
  load(): void {
    this.paint.load();
    this.paint.rebuild(REBUILD_BOOT_MS, () => performance.now());
    this.pipeline.renderer.initTexture(this.tex);
    U.tMoonPaint.value = this.tex;
    U.uPaintView.value.w = WARP_TEXELS / PAINT_W;
  }

  /** Where a place on the Moon is on the screen right now, css px, or null behind the limb. For the tools, which tap on what the player would. */
  screenOf(lat: number, lon: number): { x: number; y: number } | null {
    const n = placeOf(lat, lon), O = this.sky?.moonO;
    if (!O || n[0] * O[0] + n[1] * O[1] + n[2] * O[2] <= R_MOON) return null;
    const d = this.at(n, this.dirNow);
    if (d.z >= 0) return null;
    const k = this.focal / -d.z;
    return { x: (0.5 + (d.x * k) / this.frameW) * window.innerWidth, y: (0.5 - (d.y * k) / this.frameH) * window.innerHeight };
  }

  /** A press: where it touched. Listens before Input does, so a tap finds it. */
  touched(x: number, y: number): void {
    this.touchX = x;
    this.touchY = y;
    this.touchAt = performance.now();
  }

  /** A crater painted from low down that's big enough to see from here (?moonland): it goes on the map once the flight's loop has the frame. */
  lowStroke(s: PaintStroke): void {
    this.lows.push(s);
  }

  /** Loaded: the belly is full and nothing is pouring. */
  get loaded(): boolean {
    return this.barfT < 0 && this.fullness >= 0.999;
  }

  /**
   * ?moonland, a crater shot landing: the place it came down, degrees, and its hue. What it hit is the low game's to say (CraterPaint.hitAt), and it paints that crater, the street's way, a crater at a time:
   * the producer, "once in orbit, i want exact functionality of our san francisco movement and paint splat mechanics". Returns the crater's radius, km, or null for open ground.
   */
  onCrater: ((lat: number, lon: number, hue: number) => number | null) | null = null;
  /** A tap now would be a crater shot: the glint is a crater's size, not a blast's. */
  craters = false;

  /** A tap. False if there was nothing to fire, or nothing to fire at. crater: it paints the crater it lands on (onCrater), not a splat on the map. */
  tap(inOrbit: boolean, crater = false): boolean {
    if (!inOrbit || !this.loaded || !this.sky) {
      this.stats.denied++;
      if (inOrbit) this.audio?.denied();
      return false;
    }
    const S = config.splat, n = this.hit;
    // the ground under the finger, if that is ahead of the bus, else the glint
    let px = 0, py = 0, ground = false;
    if (performance.now() - this.touchAt < 700) {
      px = (this.touchX / window.innerWidth - 0.5) * this.frameW;
      py = (0.5 - this.touchY / window.innerHeight) * this.frameH;
      ground = py > this.busPy && this.ray(px, py, n);
    }
    if (!ground) {
      if (!this.aimOn) return false;
      n.set(this.aim);
      px = py = 0;
    }
    this.lastTap.x = Math.round(px);
    this.lastTap.y = Math.round(py);
    this.lastTap.ground = ground;
    this.touchAt = -1e9;
    this.settleNow();
    const lat = Math.asin(Math.max(-1, Math.min(1, n[2]))) / DEG, lon = Math.atan2(n[1], n[0]) / DEG;
    // (a crater shot: the place and a hue, and nothing on the map until it's down)
    if (crater) {
      const stroke: PaintStroke = { lat, lon, level: 1, seed: Math.floor(Math.random() * 6000), km: 0 };
      this.shot = { stroke, job: null, n: Float64Array.from(n), jetAt: this.t + S.inhale, impact: this.t + S.inhale + TRAVEL, jetOut: false };
      this.barfT = 0;
      this.fired = true;
      this.stats.shots++;
      this.audio?.heave();
      return true;
    }
    // (the saved list must be down first: a stroke goes on the end of it)
    if (this.paint.rebuilding && this.paint.rebuild(1e9, () => performance.now())) this.tex.needsUpdate = true;
    const stroke = this.paint.strike(lat, lon);
    const job = this.paint.begin(stroke, true);
    // (where the stroke says: rounded to 0.01 degrees, 300 m)
    this.shot = { stroke, job, n: placeOf(stroke.lat, stroke.lon), jetAt: this.t + S.inhale, impact: this.t + S.inhale + TRAVEL, jetOut: false };
    this.barfT = 0;
    this.fired = true;
    this.stats.shots++;
    this.audio?.heave();
    return true;
  }

  /** The bus's pose while it breathes: the squash spring substepped as main.ts's is, the same at 30 and 60 fps. */
  pose(p: BusPose, dt: number): void {
    const S = config.splat;
    const barfing = this.barfT >= 0 && this.barfT < S.duration;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < steps; i++) {
      const h = dt / steps;
      const bt = this.barfT - (steps - 1 - i) * h;
      const target = barfing && bt >= 0 ? (bt < S.inhale + 0.03 ? 0.78 : 1.06) : 1;
      this.squashV += ((target - p.squash) * 260 - this.squashV * 16) * h;
      p.squash += this.squashV * h;
    }
    p.heave = barfing ? Math.max(0, 1 - this.barfT / S.duration) : 0;
    p.fullness = this.barfT >= 0 ? this.fullness * (1 - ss(S.inhale, S.duration, this.barfT)) : this.fullness;
    p.eye = barfing ? 0.25 : 0.55 + 0.45 * (1 - this.fullness * 0.6);
  }

  /** How far it rears, radians, nose up, while it breathes. */
  get rear(): number {
    const S = config.splat;
    return this.barfT >= 0 && this.barfT < S.duration ? S.rearUp * ss(0, 0.1, this.barfT) * (1 - ss(0.6, S.duration, this.barfT)) : 0;
  }

  /** One frame, after the sky's and the view's. dt: the game's (0 in a hit-stop); real: the screen's. */
  update(dt: number, real: number, sky: SkyState, orbiting: boolean, camera: THREE.Camera): void {
    const S = config.splat;
    this.sky = sky;
    this.t += dt;
    this.focal = 1 / this.pipeline.pixelWorldSize(1);
    this.frameW = this.pipeline.info.width;
    this.frameH = this.pipeline.info.height;
    if (this.hitStop > 0) this.hitStop -= real;
    // ---- the belly (Flight.step's rhythm)
    if (this.barfT >= 0) {
      this.barfT += dt;
      if (this.barfT >= S.duration) {
        this.barfT = -1;
        this.fullness = 0;
      }
    } else if (this.fullness < 1) {
      this.fullness = Math.min(1, this.fullness + dt / Math.max(0.05, S.recharge));
      if (this.fullness >= 1 && orbiting) this.audio?.ready();
    }

    if (this.paint.rebuilding && this.paint.rebuild(REBUILD_FRAME_MS, () => performance.now())) this.tex.needsUpdate = true;
    U.uPaintOn.value = this.paint.painted > 0 ? 1 : 0;
    // (what's been painted down there and is big enough to see from here: a slice a frame, between shots)
    if (!this.shot && !this.paint.rebuilding) {
      if (!this.lowJob && this.lows.length) this.lowJob = this.paint.begin(this.lows.shift()!, false);
      if (this.lowJob) {
        const end = performance.now() + SLICE_MS;
        let done = false;
        while (!(done = this.paint.work(this.lowJob, 1500)) && performance.now() < end);
        if (done) {
          this.upload(this.lowJob.rect, true);
          this.lowJob = null;
        }
      }
    }

    // ---- the aim: the ground just ahead of the bus. (The rig stands off it with no turn of its own, up here: moonrun.ts)
    this.busPy = (-this.focal * camera.position.y) / camera.position.z;
    this.aimOn = orbiting && this.ray(0, this.busPy + AIM_OVER * this.focal, this.aim);
    const shot = this.shot;
    const n = shot ? shot.n : this.pour ? this.pour.n : null;
    if (n) {
      if (shot) {
        // (by the clock: a stamp costs more near a pole, and a phone is not this laptop. Most of a blast is done in a frame or two; the worst is done in the flight, whatever the frame rate)
        const end = performance.now() + SLICE_MS;
        while (shot.job && !this.paint.work(shot.job, 1500) && performance.now() < end);
      }
      this.at(n, this.dirNow);
      if (this.dirKnown && dt > 0) this.dirRate.copy(this.dirNow).sub(this.dirWas).divideScalar(dt);
      this.dirWas.copy(this.dirNow);
      this.dirKnown = true;
      const left = shot ? Math.max(0.1, shot.impact - this.t) : 0.1;
      this.proxy(this.dirNow, left, camera, this.jet.target);
      this.jet.travel = left;
      if (shot && !shot.jetOut && this.t >= shot.jetAt) {
        shot.jetOut = true;
        const nose = this.busVel.set(0, 0, -1).applyQuaternion(this.bus.root.quaternion).multiplyScalar(100);
        this.particles.geyser({
          source: () => this.bus.root.localToWorld(this.mouth.copy(this.frontLocal)),
          sourceVel: () => nose,
          targets: [this.jet.target],
          duration: TRAVEL + POUR_S,
          travelTime: left,
          hues: [shot.stroke.seed % 6],
          width: 1,
          live: this.jet,
          taper: 0.8,
        });
      }
      if (shot && this.t >= shot.impact) this.land(shot, camera);
      if (this.pour && this.t >= this.pour.until) this.pour = null;
    } else this.dirKnown = false;
    this.particles.update(dt);

    // ---- the wave
    const live = this.live;
    const L = U.uPaintLive.value;
    if (live) {
      const age = this.t - live.at, level = live.job.stroke.level;
      const reach = this.paint.waveReach(level), r = reach * (1 - Math.exp(-age / this.paint.waveTau(level))), k = r / reach;
      const width = RING_KM * Math.sqrt(EDGE_KM[level] / EDGE_KM[1]) * (1 - 0.55 * k) * ss(0, 0.08, age + 0.02);
      L.set(age, r / R_MOON, Math.max(width, 1) / R_MOON, live.job.stroke.seed % 6);
      // (the game's wave has died by the time it stops, 5 of its time constants on. This one is slowed five times over, so it dissolves on the clock, gone when the blast settles)
      U.uPaintAt.value.set(live.n[0], live.n[1], live.n[2], age / SETTLE_S);
      // sparkles as the wave goes by, where the game has them on each building that blooms
      if (live.sparks < SPARK_AT.length && age >= SPARK_AT[live.sparks]) {
        this.sparkle(live, r, camera);
        live.sparks++;
      }
      const over = live.job.over;
      if (over) {
        if (!this.paint.over(over, age)) live.job.over = null;
        this.sendOver(over);
      }
      if (age > SETTLE_S) this.settleNow();
    } else L.x = -1;

    // ---- the glint: only while a breath is loaded (Aim.ts). While a shot flies it's on the place it will land, and closes in
    const A = U.uPaintAim.value, G = U.uPaintGlint.value;
    if (shot && this.shot) {
      const n = shot.n, level = shot.stroke.level;
      A.set(n[0], n[1], n[2], ((shot.job ? EDGE_KM[level] * 0.8 : CRATER_GLINT_KM)) / R_MOON);
      G.set(Math.max(0, (shot.impact - this.t) / (TRAVEL + S.inhale)), 1);
    } else if (this.aimOn && this.loaded) {
      const n = this.aim, level = this.paint.levelAt(Math.asin(Math.max(-1, Math.min(1, n[2]))) / DEG, Math.atan2(n[1], n[0]) / DEG);
      A.set(n[0], n[1], n[2], (this.craters ? CRATER_GLINT_KM : EDGE_KM[level] * 0.8) / R_MOON);
      G.set((this.t * S.glintRate) % 1, 0);
    } else A.w = 0;

    // ---- the map's lod, as the Moon's, and how fine its edge can wobble
    const O = U.uMoonO.value, grown = sky.moonKm / Math.hypot(O.x, O.y, O.z) / R_MOON;
    const px = Math.max(sky.moonKm - R_MOON, 1) / this.focal / grown;
    const lod = Math.max(0, Math.log2(Math.max(px, 1e-3) / TEXEL_KM));
    const V = U.uPaintView.value;
    V.x = Math.min(lod, 5);
    V.y = 0.5 - 0.26 * ss(0, 3, lod);
    V.z = 0.1 * (1 - ss(0.5, 2, lod));

    // ---- the jolt: the game's kick, read as a little pitch, so the Moon and the bus take it together
    if (this.kickT < config.splat.kickDecay * 1.5) {
      const D = Math.max(0.05, config.splat.kickDecay), t = this.kickT;
      this.kickT += real;
      this.kick = this.kickA * Math.exp((-3 * t) / D) * Math.cos(((2 * Math.PI * 2.2) / D) * t);
    } else this.kick = 0;
  }

  /** The blast lands: the map goes up, and everything the game does at an impact. */
  private land(shot: Shot, camera: THREE.Camera): void {
    const S = config.splat, job = shot.job, hue = shot.stroke.seed % 6, level = shot.stroke.level;
    if (!job) {
      this.landCrater(shot, camera);
      return;
    }
    this.paint.work(job, Infinity);
    this.upload(job.rect, true);
    this.shot = null;
    this.pour = { n: shot.n, until: this.t + POUR_S };
    this.live = { job, at: this.t, n: shot.n, sparks: 0 };
    this.paint.save();
    const pos = this.proxy(this.dirNow, 0, camera, this.tA).clone();
    const k = EDGE_KM[level] / EDGE_KM[1];
    this.particles.splash(pos, hue, 2.2 * Math.sqrt(k));
    this.particles.burst(pos, hue, k, pos.y - 30);
    const to = this.tB, from = new THREE.Vector3(), dir = new THREE.Vector3();
    for (const dot of job.dots) {
      if (!dot.blob) continue;
      this.dotDir(job, dot, dir);
      const ft = this.paint.blobTime(dot, level);
      this.proxy(dir, ft, camera, to);
      from.set(pos.x + (Math.random() - 0.5) * 8, pos.y + 2 + Math.random() * 4, pos.z + (Math.random() - 0.5) * 8);
      this.particles.fling(from, to, ft, dot.hue, 2.4 + dot.rad * 0.9);
    }
    const p = pos.clone().project(camera);
    this.pipeline.flash(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, S.flashFrames + 1, S.flashStrength);
    this.audio?.splatImpact(k);
    this.audio?.bloomBurst(2 + level * 2, hue, level);
    this.hitStop = S.hitStopFrames / 60;
    this.kickA = ((S.kick * Math.sqrt(k)) / config.camera.distanceVista) * 0.6;
    this.kickT = 0;
  }

  /** A crater shot lands: the crater under it is painted (onCrater), and the impact is the game's, sized to that crater, with the splash, a burst, the flash and the kick. Open ground: a small splash and the denied sound. */
  private landCrater(shot: Shot, camera: THREE.Camera): void {
    const S = config.splat, hue = shot.stroke.seed % 6;
    this.shot = null;
    this.pour = { n: shot.n, until: this.t + POUR_S };
    const km = this.onCrater?.(shot.stroke.lat, shot.stroke.lon, hue) ?? null;
    const pos = this.proxy(this.dirNow, 0, camera, this.tA).clone();
    // (a crater a few km across is a level-one blast from here: the size of the impact goes with it, never past a big one's)
    const k = km === null ? 0.3 : Math.min(2, Math.max(0.4, km / 3));
    this.particles.splash(pos, hue, 2.2 * Math.sqrt(k));
    if (km === null) {
      this.audio?.denied();
      return;
    }
    this.particles.burst(pos, hue, k, pos.y - 30);
    const p = pos.clone().project(camera);
    this.pipeline.flash(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, S.flashFrames + 1, S.flashStrength);
    this.audio?.splatImpact(k);
    this.audio?.bloomBurst(4, hue, 1);
    this.hitStop = S.hitStopFrames / 60;
    this.kickA = ((S.kick * Math.sqrt(k)) / config.camera.distanceVista) * 0.6;
    this.kickT = 0;
  }

  /** A handful of twinkles over the ground the wave has reached, r km out. */
  private sparkle(live: { job: PaintJob; n: Float64Array }, r: number, camera: THREE.Camera): void {
    const hue = live.job.stroke.seed % 6, c = this.tA;
    this.at(live.n, this.dirNow);
    this.proxy(this.dirNow, 0, camera, c);
    this.sparkHues[0] = hue;
    this.sparkHues[1] = (hue + 2) % 6;
    this.sparkHues[2] = (hue + 4) % 6;
    // (r km on the ground is about 2.5 m of stand-in, 400 km off and 1,000 m out)
    this.particles.sparkles(c, r * 2.5, 12, this.sparkHues, 16 + live.job.stroke.level * 8);
  }

  /** Reveal done: every texel of the last blast shows. The next tap brings it on if it hasn't come. */
  private settleNow(): void {
    const live = this.live;
    if (!live) return;
    this.live = null;
    this.paint.settle(live.job);
    this.upload(live.job.rect, false);
  }

  /** The line of sight from the frame's pixel (px, py) to the Moon, into o, unit, Moon fixed. False: it misses. */
  private ray(px: number, py: number, o: Float64Array): boolean {
    const s = this.sky;
    if (!s) return false;
    const l = 1 / Math.hypot(px, py, this.focal), dx = px * l, dy = py * l, dz = -this.focal * l, m = s.moonRot, O = s.moonO;
    const fx = m[0] * dx + m[3] * dy + m[6] * dz, fy = m[1] * dx + m[4] * dy + m[7] * dz, fz = m[2] * dx + m[5] * dy + m[8] * dz;
    const b = O[0] * fx + O[1] * fy + O[2] * fz, c = O[0] * O[0] + O[1] * O[1] + O[2] * O[2] - R_MOON * R_MOON, D = b * b - c;
    if (b >= 0 || D <= 0) return false;
    const t = c / (-b + Math.sqrt(D));
    o[0] = (O[0] + fx * t) / R_MOON;
    o[1] = (O[1] + fy * t) / R_MOON;
    o[2] = (O[2] + fz * t) / R_MOON;
    return true;
  }

  /** The line of sight to a place on the Moon, render frame, unit. */
  private at(n: Float64Array, o: THREE.Vector3): THREE.Vector3 {
    const s = this.sky!, m = s.moonRot, O = s.moonO;
    const x = n[0] * R_MOON - O[0], y = n[1] * R_MOON - O[1], z = n[2] * R_MOON - O[2];
    return o.set(m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z).normalize();
  }

  /** Where a spatter drop lies, line of sight. */
  private dotDir(job: PaintJob, dot: BlastDot, o: THREE.Vector3): THREE.Vector3 {
    const th = dot.d / R_MOON, ct = Math.cos(th), st = Math.sin(th), ca = Math.cos(dot.ang), sa = Math.sin(dot.ang), n = this.hit;
    for (let i = 0; i < 3; i++) n[i] = job.c[i] * ct + (job.e[i] * ca + job.n[i] * sa) * st;
    return this.at(n, o);
  }

  /** The stand-in for a line of sight, `ahead` seconds on at the rate the ground is sliding. */
  private proxy(dir: THREE.Vector3, ahead: number, camera: THREE.Camera, o: THREE.Vector3): THREE.Vector3 {
    return o.copy(dir).addScaledVector(this.dirRate, ahead).normalize().multiplyScalar(PROXY).add(camera.position);
  }

  /** A level up's frame: one rectangle of the first level, two across the seam. */
  private sendOver(p: PaintOver): void {
    const r = this.pipeline.renderer;
    const props = r.properties.get(this.tex) as { __webglTexture?: WebGLTexture };
    if (!props.__webglTexture) return;
    const gl = r.getContext() as WebGL2RenderingContext, st = r.state;
    st.activeTexture(gl.TEXTURE0);
    st.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    st.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    st.pixelStorei(gl.UNPACK_ROW_LENGTH, p.w);
    const x0 = ((p.x % PAINT_W) + PAINT_W) % PAINT_W;
    const first = Math.min(p.w, PAINT_W - x0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, p.y, first, p.h, gl.RGBA, gl.UNSIGNED_BYTE, p.frame, 0);
    if (first < p.w) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, p.y, p.w - first, p.h, gl.RGBA, gl.UNSIGNED_BYTE, p.frame, first * 4);
    st.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    this.stats.overs++;
    this.stats.overBytes += p.w * p.h * 4;
  }

  /** The map's rectangle up, at every level, one texSubImage2D each, two where it crosses the seam. A settle is the first level's alone: the others hold no reveal. */
  private upload(rect: PaintRect, all: boolean): void {
    const r = this.pipeline.renderer;
    const props = r.properties.get(this.tex) as { __webglTexture?: WebGLTexture };
    if (!props.__webglTexture) return;
    const gl = r.getContext() as WebGL2RenderingContext, st = r.state;
    st.activeTexture(gl.TEXTURE0);
    st.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    st.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const n = all ? this.paint.mips.length : 1;
    for (let l = 0; l < n; l++) {
      const m = this.paint.mips[l];
      const y0 = rect.y0 >> l, y1 = rect.y1 >> l, h = y1 - y0 + 1;
      let x0 = rect.x0 >> l, x1 = rect.x1 >> l;
      st.pixelStorei(gl.UNPACK_ROW_LENGTH, m.width);
      const send = (x: number, w: number) => {
        gl.texSubImage2D(gl.TEXTURE_2D, l, x, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, m.data, (y0 * m.width + x) * 4);
        this.stats.uploads++;
        this.stats.bytes += w * h * 4;
      };
      if (x1 - x0 + 1 >= m.width) send(0, m.width);
      else {
        if (x0 < 0) {
          x0 += m.width;
          x1 += m.width;
        }
        if (x1 < m.width) send(x0, x1 - x0 + 1);
        else {
          send(x0, m.width - x0);
          send(0, x1 - m.width + 1);
        }
      }
    }
    st.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  }
}
