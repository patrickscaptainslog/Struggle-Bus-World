import * as THREE from 'three';
import { migratePrefs, type Prefs } from './controlPrefs';
import type { Input, InputMode } from './Input';
import { Shifter, type ShiftAnswer } from './Shifter';
import { clamp } from './springs';
import { TurboDrive, type TurboEvent } from './Turbo';
import type { Flight } from './Flight';
import type { CameraRig } from './CameraRig';
import type { AudioEngine } from '../audio/AudioEngine';
import { LOOKAHEAD } from '../audio/dsp';
import { TurboVoice } from '../audio/turboVoice';
import type { Particles } from '../fx/Particles';
import { TurboFx } from '../fx/Turbo';
import type { PixelPipeline } from '../render/PixelPipeline';
import type { BusPose } from '../bus/BusModel';
import { Coach, TAUGHT, type CoachFrame } from '../ui/Coach';
import { Hud, type HudFrame } from '../ui/Hud';

// The controls glue: the scheme (touch or keyboard), the first run, the settings
// and their persistence, and the turbo gears (drive, effects, voice, HUD readout).
//
//  - a desktop (fine pointer, hover) flies the keyboard + mouse bungee. Esc opens
//    the settings (the only HUD on a desktop) and a first visit gets one toast.
//  - a phone flies the thumb from the first touch.
// URL: ?controls=touch forces the phone's scheme, ?controls=keyboard the desktop's;
// ?nohud hides the HUD; ?nocoach, ?skipintro and ?nohud turn the first run off
// (?coach keeps it on under skipintro).
//
// main.ts calls, per frame: preFlight(dt) after input.update (the turbo drive
// sets Flight.turbo), pose(pose) before bus.update, afterPose(bus.root) after
// the bus's pose is set (the rattle), frame(dt, realDt) after the bus's matrix
// is final (effects, voice, HUD).

const ARMED = 'TURBO AFTER THE BRIDGE';
const CLIMB_GATED = 'CLIMB AFTER THE BRIDGE';
/** The first run's one mention of the flicks and the look: the gestures are hidden, and this is all the teaching they get. Any thumb flicks, so that comes first; then the bus's lane (Input.busZone):
 *  only a touch near the bus flies it, and one anywhere else looks. It fits the toast at 116 of the screen's 131 px. */
const hint = () => ['FLICK UP FOR GEARS', 'STEER BY THE BUS', 'DRAG ELSEWHERE TO LOOK'];
const HINT_SECONDS = 6.5;
/** A flick's answer in the bus's own body: it hiccups, once, on the breath's squash spring. */
const FLICK_SQUASH = 0.84;

const PREF_KEY = 'strugglebus.controls.v1';

export interface ControlsDeps {
  input: Input;
  flight: Flight;
  rig: CameraRig;
  audio: AudioEngine;
  particles: Particles;
  pipeline: PixelPipeline;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  bus: { root: THREE.Object3D; length: number; exhaustLocal: THREE.Vector3 };
  /** the city map [minX, minZ, maxX, maxZ] (m) */
  bounds: readonly number[];
  params: URLSearchParams;
}

export class Controls {
  readonly turbo: TurboDrive;
  /** what a flick means */
  readonly shifter: Shifter;
  readonly fx: TurboFx;
  readonly hud: Hud;
  readonly voice = new TurboVoice();
  /** the fog is still lifting, and a building is glinting (main.ts, per frame) */
  opening = true;
  glinting = false;
  /** QA: the game holds (dt 0) while this is set: tools/shots.mjs --det stands the clock on it, tools/contextloss.mjs too */
  frozen = false;
  private readonly d: ControlsDeps;
  private prefs: Prefs;
  private readonly hf: HudFrame = { gear: 0, maxGear: 0, engaged: false, level: 0, levels: 0, mph: 0, armed: false, sinceShift: Infinity, sinceLocked: Infinity };
  private readonly flashTmp = new THREE.Vector3();
  /** seconds the turbo has been silent (the voice detaches), and until the keys' toast (<= 0: none due) */
  private voiceIdle = 0;
  private keysIn = 0;
  /** the pull-back answered once: the gate holds the yoke down for ~20 s and the first thing a player tries is climbing */
  private climbToldAt = -Infinity;
  /** seconds the hint has left: it holds the toast's slot against the gate's line, which can wait */
  private hintLeft = 0;
  /** a flick is being answered: the bus hiccups */
  private hiccup = false;
  /** the first run (null: off) */
  private readonly coach: Coach | null;
  private readonly cf: CoachFrame = { glinting: false, openingOver: false, splats: 0, thumb: false, stillPress: 0, charged: false };
  private splats = 0;
  private chargedOnce = false;
  private thumbOnce = false;
  private gestured = false;
  private readonly onFlash = (pos: THREE.Vector3, strength: number) => {
    const p = this.flashTmp.copy(pos).project(this.d.camera);
    this.d.pipeline.flash(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, 1, strength);
  };

  constructor(d: ControlsDeps) {
    this.d = d;
    this.prefs = loadPrefs();
    this.turbo = new TurboDrive(d.bounds);
    this.shifter = new Shifter(this.turbo, d.flight);
    this.fx = new TurboFx(d.particles, d.bus.length, d.bus.exhaustLocal);
    d.scene.add(this.fx.object);
    this.hud = new Hud(d.input, {
      onMute: (m) => {
        d.audio.setMuted(m);
        this.prefs.muted = m;
        savePrefs(this.prefs);
        this.hud.setSettings({ muted: m });
      },
      onSwap: (v) => {
        this.prefs.swap = v;
        d.input.swapped = v;
        savePrefs(this.prefs);
        this.hud.setSettings({ swap: v });
      },
      onGesture: () => {
        d.audio.unlock();
        this.firstGesture();
      },
    });
    d.input.swapped = !!this.prefs.swap;
    d.input.onTurbo = (dir, flew) => this.shifter.flick(dir, flew);
    this.shifter.onAnswer = (a) => this.answer(a);
    this.turbo.onEvent = (ev, g) => this.onTurbo(ev, g);
    if (this.prefs.muted) d.audio.setMuted(true);
    this.hud.setSettings({ muted: !!this.prefs.muted, swap: !!this.prefs.swap });
    const nohud = d.params.has('nohud');
    if (nohud) this.hud.setVisible(false);
    const off = nohud || d.params.has('nocoach') || (d.params.has('skipintro') && !d.params.has('coach'));
    this.coach = off ? null : new Coach(this.prefs.taught ?? 0);
    this.start();
    if (!this.coach) this.hud.arrive();
    if (this.mode === 'keyboard' && !this.prefs.keysShown && !nohud && !d.params.has('skipintro')) this.keysIn = 2.5;
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || e.repeat || this.mode !== 'keyboard' || nohud) return;
      if (this.hud.settingsOpen) this.hud.closeSettings();
      else this.hud.openSettings();
    });
  }

  get mode(): InputMode {
    return this.d.input.mode;
  }

  /** The bus has gone up out of this game's hands (?moonland): what's still sounding stops. */
  leftGround() {
    const kit = this.d.audio.voiceKit();
    if (kit && this.voice.attached) this.voice.detach(kit.ctx.currentTime + LOOKAHEAD + 0.3);
  }

  /** A breath left (main.ts). */
  splatted() {
    this.splats++;
  }

  /** The super charged: the HOLD cue (and the keyboard's line) are over. */
  charged() {
    this.chargedOnce = true;
    this.hud.setMega('charging');
    if (this.holdToast) {
      this.holdToast = false;
      this.hud.clearToast();
    }
  }
  private holdToast = false;

  /** The opening's gate (main.ts): a gear would lift the bus into the deck, so a gear waits until it clears. */
  get gearsLocked(): boolean {
    return this.shifter.locked;
  }
  set gearsLocked(v: boolean) {
    this.shifter.locked = v;
  }

  /** A desktop's one line that teaches the hold. */
  holdHint() {
    this.holdToast = true;
    this.hud.toast(['HOLD SPACE TO CHARGE'], 3.4);
  }

  /** The hold is known (a mega or a firehose fired, on any earlier visit too): no cue. */
  learnedMega() {
    this.coach?.done(TAUGHT.mega);
  }

  /** The first touch anywhere (inside the gesture). */
  firstGesture() {
    if (this.gestured) return;
    this.gestured = true;
    if (this.mode === 'touch') this.hud.arrive();
  }

  /** The yoke is being pulled back under the opening's gate (main.ts, per frame): say why nothing happens, once. */
  climbGated() {
    if (this.shifter.armed || this.hintLeft > 0 || this.turbo.time - this.climbToldAt < 30) return;
    this.climbToldAt = this.turbo.time;
    this.hud.toast([CLIMB_GATED], 2.2);
  }

  /** A gear with a height is lifting or driving the bus, or it is past the surge, boosted or braking: the city holds its level of detail. */
  get tearing(): boolean {
    return this.turbo.lifts || this.turbo.speedK > 0;
  }

  /** The surge the bus's engine hears (main.ts): the stick's, or the drive's in any gear, the same surge with no thumb on it. */
  get surge(): number {
    const T = this.turbo;
    // (all of it up to Nonstop's 225 m/s, speedK 0.5; from there to Jet's speed it gives way to the turbo voice, so a gear down from Jet doesn't swell the wind, and a lift doesn't drop it)
    const drive = T.gear > 0 ? 1 - clamp(2 * T.speedK - 1, 0, 1) : 0;
    return Math.max(this.d.flight.surge, drive);
  }

  // ------------------------------------------------------------------ per frame (main.ts)

  /** After input.update, before the flight steps: the turbo drive writes Flight.turbo. */
  preFlight(dt: number) {
    const waited = this.shifter.armed;
    this.shifter.tick();
    // (the rung went: the line that said it must wait is no longer true)
    if (waited && !this.shifter.armed) this.hud.clearToast();
    this.turbo.update(dt, this.d.flight);
  }

  /** Before bus.update: the bus strains (wheeze, squint) and goes wide-eyed at speed. */
  pose(p: BusPose) {
    const T = this.turbo;
    if (this.hiccup) {
      this.hiccup = false;
      p.squash = Math.min(p.squash, FLICK_SQUASH);
    }
    if (T.strain > 0.05) {
      p.wheeze = Math.max(p.wheeze, T.strain);
      p.eye = Math.min(p.eye, 1 - 0.5 * T.strain);
    } else if (T.speedK > 0.3) p.eye = Math.max(p.eye, 1);
  }

  /** After the bus's pose is set: the rattle. */
  afterPose(root: THREE.Object3D) {
    this.fx.applyRattle(root);
  }

  /** After the bus's matrix is final: effects, the voice, the HUD. */
  frame(dt: number, realDt: number) {
    const d = this.d, T = this.turbo, f = d.flight;
    this.fx.update(dt, realDt, T, f, d.bus.root, d.camera, d.rig, d.pipeline.pixelWorldSize(1));
    const kit = d.audio.voiceKit();
    if (kit) {
      const t = kit.ctx.currentTime + LOOKAHEAD;
      // (Express is the bus's own engine: nothing here sounds, and these loops are constant work on a phone)
      const busy = T.lifts || T.boosting || T.speedK > 0 || T.strain > 0.02;
      this.voiceIdle = busy ? 0 : this.voiceIdle + realDt;
      if (busy && !this.voice.attached) this.voice.attach(kit, t);
      if (this.voice.attached) {
        this.voice.update(T, t);
        if (this.voiceIdle > 2) this.voice.detach(t + 0.3);
      }
    }
    if (this.keysIn > 0) {
      this.keysIn -= realDt;
      if (this.keysIn <= 0) {
        this.prefs.keysShown = true;
        savePrefs(this.prefs);
        this.hud.toast(['ARROWS FLY  -  SPACE SPLATS', 'E GEAR UP  -  Q GEAR DOWN', 'RIGHT MOUSE LOOKS  -  ESC SETTINGS'], 5);
      }
    }
    const h = this.hf;
    h.gear = T.gear;
    h.maxGear = T.maxGear;
    h.engaged = T.engaged;
    h.level = T.level;
    h.levels = T.levels;
    // (?moonland: the way out is a gear's floor lifting the bus, and that's no part of `speed`)
    h.mph = (T.top && f.turbo.floor > f.y ? Math.hypot(f.ground, f.vy) : f.speed) * 2.23694;
    h.armed = this.shifter.armed;
    h.sinceShift = T.time - Math.max(T.shiftedAt, T.engagedAt);
    h.sinceLocked = T.time - T.lockedAt;
    this.firstRun(realDt);
    this.hud.update(realDt, h);
  }

  /** The first run: the cues. */
  private firstRun(dt: number) {
    const hud = this.hud, input = this.d.input;
    if (this.mode !== 'touch') return;
    const c = this.coach;
    if (input.state.thumb) this.thumbOnce = true;
    if (c) {
      if (!this.opening) hud.arrive();
      const cf = this.cf;
      cf.glinting = this.glinting;
      cf.openingOver = !this.opening;
      cf.gated = this.gearsLocked;
      cf.splats = this.splats;
      cf.thumb = this.thumbOnce;
      cf.stillPress = input.stillFor(performance.now());
      cf.charged = this.chargedOnce;
      c.frame(dt, cf);
      hud.setCue(c.cue);
      if (c.megaDue) hud.megaHoldCue();
      this.hintLeft = Math.max(0, this.hintLeft - dt);
      if (c.hintDue) {
        this.hintLeft = HINT_SECONDS;
        hud.toast(hint(), HINT_SECONDS);
      }
    }
    if (c?.dirty) {
      c.dirty = false;
      this.prefs.taught = c.taught;
      savePrefs(this.prefs);
    }
  }

  // ------------------------------------------------------------------ the scheme

  private start() {
    const forced = this.d.params.get('controls');
    this.setMode(forced === 'keyboard' || (!isPhone() && forced !== 'touch') ? 'keyboard' : 'touch');
  }

  private setMode(m: InputMode) {
    this.d.input.setMode(m);
    this.hud.setMode(m);
  }

  // ------------------------------------------------------------------ turbo events

  /** A flick's answer, this very frame: seen at the bus (a silenced iPhone hears nothing) and heard. */
  private answer(a: ShiftAnswer) {
    this.onTurbo(a === 'back' ? 'back' : 'flick', this.turbo.gear);
    if (a === 'gated') this.hud.toast([ARMED], 2.6);
    // (with another flick still waiting the line stands)
    else if (a === 'back' && this.gearsLocked && !this.shifter.armed) this.hud.toast(['TURBO OFF'], 1.2);
  }

  private onTurbo(ev: TurboEvent, gear: number) {
    const d = this.d;
    this.fx.event(ev, d.bus.root, d.flight, d.rig, this.onFlash);
    if (ev === 'flick' || ev === 'back' || ev === 'turbo') this.hiccup = true;
    const kit = d.audio.voiceKit();
    if (kit) {
      const t = kit.ctx.currentTime + LOOKAHEAD;
      if (!this.voice.attached) this.voice.attach(kit, t);
      if (ev === 'up' || ev === 'down') this.voice.shift(t, ev === 'up' ? 1 : -1);
      else if (ev === 'engage' || ev === 'turbo') this.voice.engage(t);
      else if (ev === 'turbo-down') this.voice.shift(t, -1);
      else if (ev === 'flick' || ev === 'back') this.voice.armed(t);
      else if (ev === 'boom') this.voice.boom(t);
      else if (ev === 'locked') this.voice.locked(t);
    }
    void gear;
  }

  /** QA: everything about the controls right now. */
  snapshot() {
    const T = this.turbo, f = this.d.flight;
    return {
      mode: this.mode,
      turbo: { gear: T.gear, level: T.level, engaged: T.engaged, strain: T.strain, speedK: T.speedK, boosting: T.boosting, edge: T.edge, armed: this.shifter.armed },
      flight: { speed: f.speed, y: f.y, agl: f.y - f.groundBroad, mode: f.mode },
      camera: { pull: this.fx.lens.pull, fov: this.fx.lens.fov, hfov: this.d.rig.hfov, distance: this.d.rig.distance },
      hud: { settings: this.hud.settingsOpen },
      coach: this.coach ? { taught: this.coach.taught, cue: this.coach.cue } : null,
      prefs: { ...this.prefs },
      input: { chargeHeld: this.d.input.state.chargeHeld, thumb: this.d.input.state.thumb, sx: this.d.input.state.stretch.x, sy: this.d.input.state.stretch.y, look: { ...this.d.input.state.look } },
    };
  }
}

function isPhone(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches;
  } catch {
    return false;
  }
}

function loadPrefs(): Prefs {
  try {
    const { prefs, changed } = migratePrefs(JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}'));
    if (changed) savePrefs(prefs);
    return prefs;
  } catch {
    return {};
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* private mode / full: the choice lasts this session */
  }
}
