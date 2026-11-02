import * as THREE from 'three';
import { config } from '../config';
import { chipIgnored, migratePrefs, tiltCancelled, tiltTurnedOn, type Prefs } from './controlPrefs';
import { TiltMix } from './Hybrid';
import type { Input, InputMode } from './Input';
import { TiltControl, type TiltStatus } from './Tilt';
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
import { Hud, type HudFrame, type TiltUi } from '../ui/Hud';

// The controls glue: the scheme (touch or keyboard), the tilt's permission and
// its silent fallbacks, the first run, the settings and their persistence, and
// the turbo gears (drive, effects, voice, HUD readout).
//
// There is one gesture model (docs/specs/hybrid-controls.md): the phone flies the
// bus until a thumb flies it, a tap splats, buttons do what they say.
//  - a desktop (fine pointer, hover) flies the keyboard + mouse bungee. Esc opens
//    the settings (the only HUD on a desktop) and a first visit gets one toast.
//  - a phone flies the thumb from the first touch, and tilt is on top of it if
//    the player wants. Tilt is offered, not imposed (config.tilt.defaultOn): iOS
//    cannot start motion without a tap, and no sheet may land on a splat, so only
//    the chip (TILT TO STEER?) or the toggle ever asks, inside their own touchend.
//  - a returning player: a quiet probe at load; motion flowing means the grant
//    survived and tilt starts on the first gesture. Silent iOS: the chip at fog
//    end, ignored twice and tilt goes back to undecided.
//  - no sensor, or granted and silent (an iframe that refuses motion, like the
//    claude.ai preview): the toggle isn't drawn, for this session, and no error.
// URL: ?controls=touch forces tilt off with no chip, ?controls=tilt shows the chip
// at once, ?controls=keyboard the desktop; ?nohud hides the HUD; ?nocoach, ?skipintro
// and ?nohud turn the first run off (?coach keeps it on under skipintro).
//
// main.ts calls, per frame: preFlight(dt) after input.update (the turbo drive
// sets Flight.turbo), pose(pose) before bus.update, afterPose(bus.root) after
// the bus's pose is set (the rattle), frame(dt, realDt) after the bus's matrix
// is final (effects, voice, HUD).

const ARMED = 'TURBO AFTER THE BRIDGE';
const CLIMB_GATED = 'CLIMB AFTER THE BRIDGE';

const NO_SENSOR = 'NO MOTION SENSOR HERE';
const TILT_ON = ['TILT ON', 'DRAG ANY TIME'];
const TILT_OFF = ['TILT OFF'];
const MOTION_DENIED = 'MOTION DENIED: REOPEN SAFARI';

const PREF_KEY = 'strugglebus.controls.v1';
const SESSION_NO_TILT = 'strugglebus.notilt';

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
  readonly tilt = new TiltControl();
  /** the arbitration between the thumb and the phone (src/game/Hybrid.ts) */
  readonly mix = new TiltMix(this.tilt);
  readonly turbo: TurboDrive;
  readonly fx: TurboFx;
  readonly hud: Hud;
  readonly voice = new TurboVoice();
  /** the opening's gate (main.ts): a gear would lift the bus over the deck, so a shift waits until it clears */
  gearsLocked = false;
  /** the fog is still lifting, and a building is glinting (main.ts, per frame) */
  opening = true;
  glinting = false;
  private readonly d: ControlsDeps;
  private prefs: Prefs;
  private readonly hf: HudFrame = { gear: 0, maxGear: 1, engaged: false, boosting: false, mph: 0, armed: false, sinceShift: Infinity, sinceLocked: Infinity, tiltState: 'none', gearDown: false };
  private readonly flashTmp = new THREE.Vector3();
  /** seconds the turbo has been silent (the voice detaches), and until the keys' toast (<= 0: none due) */
  private voiceIdle = 0;
  private keysIn = 0;
  /** a shift made while gearsLocked waits for the gate */
  private queuedShift: 1 | -1 | 0 = 0;
  /** the pull-back answered once: the gate holds the yoke down for ~20 s and the first thing a player tries is climbing */
  private climbToldAt = -Infinity;
  /** the first run (null: off) */
  private readonly coach: Coach | null;
  private readonly cf: CoachFrame = { glinting: false, openingOver: false, gearsLocked: false, armed: false, splats: 0, thumb: false, stillPress: 0, held: false, charged: false };
  private splats = 0;
  private chargedOnce = false;
  private thumbOnce = false;
  private gestured = false;
  /** no sensor here, this session: the toggle isn't drawn */
  private noSensor = false;
  /** a quiet listen heard motion (no permission API: otherwise there is nothing to offer) */
  private sensorHeard = false;
  /** a real "no" from the sheet, this session; and how many asks threw */
  private refused = false;
  private blocks = 0;
  /** tilt waits for the first gesture (a returning player) */
  private startOnGesture = false;
  /** the chip: a lapsed iOS grant (fog end, no gate wait); ?controls=tilt; how long it has been up */
  private chipLapsed = false;
  private chipForced = false;
  private chipT = 0;
  private forcedTouch = false;
  private tiltOnShown = false;
  private readonly onFlash = (pos: THREE.Vector3, strength: number) => {
    const p = this.flashTmp.copy(pos).project(this.d.camera);
    this.d.pipeline.flash(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, 1, strength);
  };

  constructor(d: ControlsDeps) {
    this.d = d;
    this.prefs = loadPrefs();
    this.turbo = new TurboDrive(d.bounds);
    this.fx = new TurboFx(d.particles, d.bus.length, d.bus.exhaustLocal);
    d.scene.add(this.fx.object);
    d.input.mix = this.mix;
    this.tilt.core.sensitivity = this.prefs.sens ?? config.tilt.sensitivity;
    this.hud = new Hud(d.input, {
      onTiltToggle: () => this.pressToggle(),
      onChip: () => this.setTilt(true),
      onSensitivity: (v) => {
        this.tilt.core.sensitivity = v;
        this.prefs.sens = v;
        savePrefs(this.prefs);
        this.hud.setSettings({ sensitivity: v });
      },
      onRecenter: () => {
        this.tilt.recenter();
        this.hud.toast(['RECENTERED'], 1.1);
      },
      onMute: (m) => {
        d.audio.setMuted(m);
        this.prefs.muted = m;
        savePrefs(this.prefs);
        this.hud.setSettings({ muted: m });
      },
      onSwap: (v) => {
        this.prefs.swap = v;
        savePrefs(this.prefs);
        this.hud.setSettings({ swap: v });
      },
      onSettings: (open) => {
        if (open) {
          // (tilt keeps listening and stays on, however long this stays open)
          this.mix.sleep();
          return;
        }
        if (this.tilt.active) this.tilt.recenter();
        d.input.wakeMix();
      },
      onGesture: () => {
        d.audio.unlock();
        this.firstGesture();
      },
    });
    d.input.onTurbo = (dir) => this.pressTurbo(dir);
    this.turbo.onEvent = (ev, g) => this.onTurbo(ev, g);
    if (this.prefs.muted) d.audio.setMuted(true);
    this.hud.setSettings({ tiltNote: TiltControl.supported() ? '' : NO_SENSOR, sensitivity: this.tilt.core.sensitivity, muted: !!this.prefs.muted, swap: !!this.prefs.swap });
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

  /** iOS's motion sheet is up: the game holds under it, any time. */
  get sheetUp(): boolean {
    return this.tilt.status === 'requesting';
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
    this.startIfDue();
  }

  /** The yoke is being pulled back under the opening's gate (main.ts, per frame): say why nothing happens, once. */
  climbGated() {
    if (this.queuedShift || this.turbo.time - this.climbToldAt < 30) return;
    this.climbToldAt = this.turbo.time;
    this.hud.toast([CLIMB_GATED], 2.2);
  }

  /** A gear is lifting or driving the bus, or it is still braking out of one: the city holds its level of detail. */
  get tearing(): boolean {
    return this.turbo.gear > 0 || this.turbo.speedK > 0;
  }

  // ------------------------------------------------------------------ per frame (main.ts)

  /** After input.update, before the flight steps: the turbo drive writes Flight.turbo. */
  preFlight(dt: number) {
    if (!this.gearsLocked && this.queuedShift) {
      this.turbo.shift(this.queuedShift, this.d.flight);
      this.queuedShift = 0;
    }
    this.turbo.update(dt, this.d.flight, this.d.input.state.turboHeld);
  }

  /** Before bus.update: the bus strains (wheeze, squint) and goes wide-eyed at speed. */
  pose(p: BusPose) {
    const T = this.turbo;
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
      const busy = T.gear > 0 || T.boosting || T.speedK > 0 || T.strain > 0.02;
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
        this.hud.toast(['ARROWS FLY  -  SPACE SPLATS', 'E TURBO  -  ESC SETTINGS'], 5);
      }
    }
    const h = this.hf;
    h.gear = T.gear;
    h.maxGear = T.maxGear;
    h.engaged = T.engaged;
    h.boosting = T.boosting;
    // (?moonland: the way out is a gear's floor lifting the bus, and that's no part of `speed`)
    h.mph = (T.top && f.turbo.floor > f.y ? Math.hypot(f.ground, f.vy) : f.speed) * 2.23694;
    h.armed = this.queuedShift > 0;
    h.sinceShift = T.time - Math.max(T.shiftedAt, T.engagedAt);
    h.sinceLocked = T.time - T.lockedAt;
    h.tiltState = this.tiltUi();
    h.gearDown = T.gear > 0 || this.queuedShift > 0;
    if (this.mix.offPending && this.mix.g === 0) {
      // (gain alone never stops the tilt: the settings take it to 0 too)
      this.mix.offPending = false;
      this.tilt.stop();
    }
    const on = h.tiltState === 'on' || h.tiltState === 'clutched';
    if (on !== this.tiltOnShown) {
      this.tiltOnShown = on;
      this.hud.setSettings({ tiltOn: on });
    }
    this.firstRun(realDt);
    this.hud.update(realDt, h);
  }

  /** The first run: the cues, the chip. */
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
      cf.gearsLocked = this.gearsLocked;
      cf.armed = this.queuedShift > 0;
      cf.splats = this.splats;
      cf.thumb = this.thumbOnce;
      cf.stillPress = input.stillFor(performance.now());
      cf.held = input.anyHeld;
      cf.charged = this.chargedOnce;
      c.frame(dt, cf);
      hud.setCue(c.cue);
      if (c.turboDue) hud.turboCue();
      if (c.megaDue) hud.megaHoldCue();
    }
    if (hud.chipOpen) {
      this.chipT += dt;
      if (this.tiltUi() === 'on' || this.tiltUi() === 'busy') hud.hideChip();
      else if (this.chipT >= 8) {
        // ignored: it flies to the corner and becomes the toggle
        hud.flyChip();
        chipIgnored(this.prefs);
        savePrefs(this.prefs);
      }
    } else if ((this.chipForced || (this.chipLapsed && !this.opening) || (c?.chipDue && this.mayOffer())) && !input.anyHeld) {
      this.chipForced = this.chipLapsed = false;
      this.chipT = 0;
      hud.showChip();
      c?.done(TAUGHT.chip);
      this.prefs.taught = (this.prefs.taught ?? 0) | TAUGHT.chip;
    }
    if (c?.dirty) {
      c.dirty = false;
      this.prefs.taught = c.taught;
      savePrefs(this.prefs);
    }
  }

  /** The chip may ask this player. */
  private mayOffer(): boolean {
    const ui = this.tiltUi();
    return this.prefs.tilt === undefined && ui === 'unasked' && !this.forcedTouch;
  }

  /** What the toggle shows. */
  private tiltUi(): TiltUi {
    const t = this.tilt;
    if (this.mode !== 'touch' || this.noSensor) return 'none';
    const needs = TiltControl.needsPermission();
    if (t.probing) return needs ? 'unasked' : 'none';
    const s = t.status;
    if (s === 'active') return this.mix.offPending ? 'off' : this.mix.phase === 'live' ? 'on' : 'clutched';
    if (s === 'requesting' || s === 'waiting' || s === 'calibrating') return 'busy';
    if (this.refused) return 'refused';
    if (!needs && !this.sensorHeard) return 'none';
    return this.prefs.tilt === false ? 'off' : 'unasked';
  }

  // ------------------------------------------------------------------ the scheme

  private start() {
    const p = this.d.params;
    const forced = p.get('controls');
    const phone = isPhone();
    if (forced === 'keyboard' || (!phone && forced !== 'tilt' && forced !== 'touch')) {
      this.setMode('keyboard');
      return;
    }
    this.setMode('touch');
    if (forced === 'touch') {
      this.forcedTouch = true;
      return;
    }
    if (!TiltControl.supported() || sessionGet(SESSION_NO_TILT)) {
      this.noSensor = forced !== 'tilt';
      if (this.noSensor) return;
    }
    if (forced === 'tilt') {
      this.chipForced = true;
      this.sensorHeard = true;
      return;
    }
    const taught = this.prefs.taught ?? 0;
    const wants = this.prefs.tilt ?? (config.tilt.defaultOn && !(taught & TAUGHT.chip) ? true : undefined);
    const ios = TiltControl.needsPermission();
    // (iOS, undecided or off: nothing to learn, only a tap can open it)
    if (ios && wants !== true) return;
    void this.tilt.probe().then((heard) => {
      if (this.tilt.status !== 'off') return; // (the player's press took over)
      if (heard) {
        this.sensorHeard = true;
        if (wants === true) {
          this.startOnGesture = true;
          this.startIfDue();
        }
      } else if (ios) this.chipLapsed = true;
      else this.noTilt();
    });
  }

  /** A returning player's tilt starts on the first gesture. */
  private startIfDue() {
    if (!this.startOnGesture || !this.gestured) return;
    this.startOnGesture = false;
    void this.tilt.listen().then((s) => this.tiltResult(s, true));
  }

  /** The toggle's tap (synchronously inside the gesture). */
  private pressToggle() {
    const ui = this.tiltUi();
    if (ui === 'busy') {
      // cancels: back to undecided
      this.tilt.stop();
      tiltCancelled(this.prefs);
      savePrefs(this.prefs);
    } else this.setTilt(ui !== 'on' && ui !== 'clutched');
  }

  /** The toggle or the chip (synchronously inside the gesture: iOS asks in this very touchend). */
  setTilt(on: boolean) {
    const m = this.mix;
    if (!on) {
      // (saved at once, stopped once the gain is down: closing the page inside 0.2 s still counts)
      this.prefs.tilt = false;
      savePrefs(this.prefs);
      m.turnOff();
      this.hud.toast(TILT_OFF, 1.1);
      return;
    }
    if (m.offPending) {
      m.cancelOff();
      tiltTurnedOn(this.prefs);
      savePrefs(this.prefs);
      return;
    }
    this.startOnGesture = false;
    void this.tilt.request().then((s) => this.tiltResult(s, false));
  }

  /** Where a turn-on ended. */
  private tiltResult(s: TiltStatus, quiet: boolean) {
    if (this.tilt.probing) return;
    const hud = this.hud;
    if (s === 'active') {
      sessionSet(SESSION_NO_TILT, null);
      tiltTurnedOn(this.prefs);
      savePrefs(this.prefs);
      this.noSensor = this.refused = false;
      this.blocks = 0;
      hud.setSettings({ tiltNote: '' });
      this.d.input.wakeMix();
      if (!quiet) hud.toast(TILT_ON, 1.6);
    } else if (s === 'denied') {
      // a real answer: saved, never asked again unless the toggle is pressed
      const again = this.refused;
      this.refused = true;
      this.prefs.tilt = false;
      savePrefs(this.prefs);
      hud.setSettings({ tiltNote: MOTION_DENIED });
      hud.toast(again ? [MOTION_DENIED] : ['MOTION ACCESS OFF', 'DRAG TO STEER'], 2.4);
    } else if (s === 'blocked') {
      // no sheet was shown: no answer, nothing saved, the next press retries
      this.tilt.status = 'off';
      if (++this.blocks >= 2) hud.toast([MOTION_DENIED], 2.4);
    } else if (s === 'unavailable') this.noTilt();
  }

  /** No motion here (no sensor, or silent): the toggle goes, for this session, with no error. */
  private noTilt() {
    this.tilt.stop();
    this.tilt.status = 'off';
    sessionSet(SESSION_NO_TILT, '1');
    this.noSensor = true;
    this.hud.setSettings({ tiltNote: '' });
  }

  private setMode(m: InputMode) {
    this.d.input.setMode(m);
    this.hud.setMode(m);
  }

  // ------------------------------------------------------------------ turbo events

  /**
   * TURBO, its down tab, E / Q. Under the opening's gate a gear would lift the bus into the deck, so a shift up
   * waits for it: answered on this very frame (the toast, the ARMED readout and button, the clunk) and fired by
   * itself when the gate clears. A shift down cancels it. (A shift down of a real gear is always safe.)
   */
  private pressTurbo(dir: 1 | -1) {
    const d = this.d;
    if (!this.gearsLocked || (dir < 0 && this.turbo.gear > 0)) {
      this.turbo.shift(dir, d.flight);
      return;
    }
    const kit = d.audio.voiceKit();
    if (kit) {
      const t = kit.ctx.currentTime + LOOKAHEAD;
      if (!this.voice.attached) this.voice.attach(kit, t);
      this.voice.armed(t);
    }
    if (dir > 0) {
      this.queuedShift = 1;
      this.hud.toast([ARMED], 2.6);
    } else if (this.queuedShift) {
      this.queuedShift = 0;
      this.hud.toast(['TURBO OFF'], 1.2);
    }
  }

  private onTurbo(ev: TurboEvent, gear: number) {
    const d = this.d;
    this.fx.event(ev, d.bus.root, d.flight, d.rig, this.onFlash);
    const kit = d.audio.voiceKit();
    if (kit) {
      const t = kit.ctx.currentTime + LOOKAHEAD;
      if (!this.voice.attached) this.voice.attach(kit, t);
      if (ev === 'up' || ev === 'down') this.voice.shift(t, ev === 'up' ? 1 : -1);
      else if (ev === 'engage') this.voice.engage(t);
      else if (ev === 'boom') this.voice.boom(t);
      else if (ev === 'locked') this.voice.locked(t);
    }
    void gear;
  }

  /** QA: everything about the controls right now. */
  snapshot() {
    const c = this.tilt.core, T = this.turbo, f = this.d.flight;
    return {
      mode: this.mode,
      mix: { phase: this.mix.phase, g: this.mix.g, thumbHeld: this.mix.thumbHeld, reachHeld: this.mix.reachHeld, offPending: this.mix.offPending },
      tilt: { status: this.tilt.status, active: this.tilt.active, sx: c.sx, sy: c.sy, roll: c.roll, pitch: c.pitch, calibrated: c.calibrated, samples: c.samples, sensitivity: c.sensitivity },
      turbo: { gear: T.gear, engaged: T.engaged, strain: T.strain, speedK: T.speedK, boosting: T.boosting, edge: T.edge },
      flight: { speed: f.speed, y: f.y, agl: f.y - f.groundBroad, mode: f.mode },
      camera: { pull: this.fx.lens.pull, fov: this.fx.lens.fov, hfov: this.d.rig.hfov, distance: this.d.rig.distance },
      hud: { settings: this.hud.settingsOpen, tiltState: this.hf.tiltState, chip: this.hud.chipOpen, gearDown: this.hf.gearDown },
      coach: this.coach ? { taught: this.coach.taught, cue: this.coach.cue } : null,
      prefs: { ...this.prefs },
      input: { chargeHeld: this.d.input.state.chargeHeld, turboHeld: this.d.input.state.turboHeld, thumb: this.d.input.state.thumb, sx: this.d.input.state.stretch.x, sy: this.d.input.state.stretch.y },
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
    const raw = localStorage.getItem(PREF_KEY);
    const p = migratePrefs(JSON.parse(raw ?? '{}'));
    if (raw && raw.includes('"mode"')) savePrefs(p);
    return p;
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

function sessionGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}

function sessionSet(k: string, v: string | null) {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {
    /* fine */
  }
}
