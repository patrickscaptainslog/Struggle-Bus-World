import * as THREE from 'three';
import { config } from '../config';
import type { Input, InputMode } from './Input';
import { TiltControl } from './Tilt';
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
import { Hud, type HudFrame } from '../ui/Hud';

// The controls glue: which control scheme flies (tilt, touch, keyboard), the
// motion permission and its silent fallback, the settings and their
// persistence, and the turbo gears (drive, effects, voice, HUD readout).
//
// Choosing the scheme:
//  - a desktop (fine pointer, hover) flies the keyboard + mouse bungee;
//  - a phone flies TILT by default: on iOS the first-touch prompt ("TILT TO
//    FLY") asks for motion access inside its tap; elsewhere the sensor is
//    probed quietly and only a phone that really sends motion gets the prompt.
//    The prompt's tap is when the neutral pose is taken. The opening holds on
//    its first frame until that is settled (holdOpening): the Golden Gate is the
//    game's first hero shot and nobody should miss it behind a card.
//  - no sensor, permission denied, or no event within config.tilt.eventTimeout
//    (an iframe that refuses motion, like the claude.ai preview): touch, with
//    no error; that is remembered for the session only, never as the player's
//    choice. The player's own choice (settings, "use touch instead") persists.
//  - keyboard: Esc opens the settings (the only HUD on a desktop), and a first
//    visit gets one toast with the keys.
// URL: ?controls=tilt|touch|keyboard forces a scheme, ?nohud hides the HUD.
//
// main.ts calls, per frame: preFlight(dt) after input.update (the turbo drive
// sets Flight.turbo), pose(pose) before bus.update, afterPose(bus.root) after
// the bus's pose is set (the rattle), frame(dt, realDt) after the bus's matrix
// is final (effects, voice, HUD).

const ARMED = 'TURBO AFTER THE BRIDGE';
const CLIMB_GATED = 'CLIMB AFTER THE BRIDGE';

const NO_SENSOR = 'NO MOTION SENSOR HERE';
const MOTION_DENIED = 'MOTION DENIED: REOPEN SAFARI';

const PREF_KEY = 'strugglebus.controls.v1';
const SESSION_NO_TILT = 'strugglebus.notilt';

interface Prefs {
  mode?: 'tilt' | 'touch';
  sens?: number;
  muted?: boolean;
  /** a desktop has seen the keys once */
  keysShown?: boolean;
}

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
  readonly turbo: TurboDrive;
  readonly fx: TurboFx;
  readonly hud: Hud;
  readonly voice = new TurboVoice();
  /** the opening's gate (main.ts): a gear would lift the bus over the deck, so a shift waits until it clears */
  gearsLocked = false;
  private readonly d: ControlsDeps;
  private prefs: Prefs;
  private readonly hf: HudFrame = { gear: 0, maxGear: 1, engaged: false, boosting: false, mph: 0, armed: false, sinceShift: Infinity, sinceLocked: Infinity };
  private readonly flashTmp = new THREE.Vector3();
  /** seconds the turbo has been silent (the voice detaches), and until the keys' toast (<= 0: none due) */
  private voiceIdle = 0;
  private keysIn = 0;
  /** a shift made while gearsLocked, and the turbo line of the post-card toast: both wait for the gate */
  private queuedShift: 1 | -1 | 0 = 0;
  private turboHintDue = false;
  /** the pull-back answered once: the gate holds the yoke down for ~20 s and the first thing a tilt player tries is climbing */
  private climbToldAt = -Infinity;
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
    d.input.stick = this.tilt;
    this.tilt.core.sensitivity = this.prefs.sens ?? config.tilt.sensitivity;
    this.hud = new Hud(d.input, {
      onMode: (m) => this.chooseMode(m),
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
      onPromptTilt: () => this.promptTilt(),
      onPromptTouch: () => {
        this.prefs.mode = 'touch';
        savePrefs(this.prefs);
        this.tilt.stop();
        this.setMode('touch');
      },
      onGesture: () => d.audio.unlock(),
    });
    d.input.onTurbo = (dir) => this.pressTurbo(dir);
    this.turbo.onEvent = (ev, g) => this.onTurbo(ev, g);
    if (this.prefs.muted) d.audio.setMuted(true);
    this.hud.setSettings({ tiltAvailable: TiltControl.supported(), tiltNote: TiltControl.supported() ? '' : NO_SENSOR, sensitivity: this.tilt.core.sensitivity, muted: !!this.prefs.muted });
    const nohud = d.params.has('nohud');
    if (nohud) this.hud.setVisible(false);
    this.start();
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

  /** The player hasn't answered yet: the TILT TO FLY card, the motion sheet, or the sensor still settling. */
  get holdOpening(): boolean {
    if (this.d.params.has('nohud')) return false;
    const s = this.tilt.status;
    return this.hud.promptOpen || s === 'requesting' || s === 'waiting' || s === 'calibrating';
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
      this.turboHintDue = false; // (they already know)
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
    if (this.turboHintDue && !this.gearsLocked && !this.queuedShift) {
      this.turboHintDue = false;
      this.hud.toast(['SWIPE UP FOR TURBO'], 2.6);
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
    h.mph = f.speed * 2.23694;
    h.armed = this.queuedShift > 0;
    h.sinceShift = T.time - Math.max(T.shiftedAt, T.engagedAt);
    h.sinceLocked = T.time - T.lockedAt;
    this.hud.update(realDt, h);
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
    // touch until the tilt is really flying
    this.setMode('touch');
    if (forced === 'touch') return;
    if (forced !== 'tilt' && (this.prefs.mode === 'touch' || !TiltControl.supported() || sessionGet(SESSION_NO_TILT))) return;
    if (TiltControl.needsPermission()) {
      // iOS: only a tap may ask for motion access
      this.hud.showPrompt();
      return;
    }
    // no permission needed: probe quietly; only a phone that really sends motion gets the prompt
    void this.tilt.listen().then((s) => {
      if (s === 'active') this.hud.showPrompt();
      else this.noTilt();
    });
  }

  /** The prompt's tap (synchronously inside the gesture). */
  private promptTilt() {
    const st = this.tilt.status;
    if (st === 'active' || st === 'calibrating') {
      // already flowing: the tap takes the neutral pose (how the player holds the phone now)
      this.tilt.core.calibrate();
      this.enterTilt();
      return;
    }
    // (the card closes now, the answer comes later: the touch controls stay away while iOS's sheet is up)
    this.hud.setChromeHeld(true);
    void this.tilt.request().then((s) => {
      this.hud.setChromeHeld(false);
      if (s === 'active') this.enterTilt();
      else this.noTilt();
    });
  }

  /** Settings: the player's own choice (persisted). */
  private chooseMode(m: 'tilt' | 'touch') {
    if (m === 'touch') {
      this.tilt.stop();
      this.prefs.mode = 'touch';
      savePrefs(this.prefs);
      this.setMode('touch');
      return;
    }
    if (this.tilt.active) {
      this.tilt.core.calibrate();
      this.enterTilt();
      return;
    }
    if (TiltControl.needsPermission()) {
      // iOS asks from the prompt's touchend, the event it is known to honor (the settings buttons fire on
      // pointerup); the prompt's tap also takes the neutral pose
      this.hud.closeSettings();
      this.hud.showPrompt();
      return;
    }
    void this.tilt.request().then((s) => (s === 'active' ? this.enterTilt() : this.noTilt()));
  }

  private enterTilt() {
    sessionSet(SESSION_NO_TILT, null);
    this.prefs.mode = 'tilt';
    savePrefs(this.prefs);
    this.hud.setSettings({ tiltAvailable: true, tiltNote: '' });
    this.setMode('tilt');
    // (no turbo tip over the Golden Gate: it comes when a gear can actually do something)
    this.turboHintDue = this.gearsLocked;
    this.hud.toast(this.gearsLocked ? ['TILT TO STEER'] : ['TILT TO STEER', 'SWIPE UP FOR TURBO'], 2.6);
  }

  /** No motion here (no sensor, refused, or silent): touch, remembered for this session only. A refusal says so
   *  and how to undo it (iOS won't ask again until Safari restarts); no sensor just says how to fly. */
  private noTilt() {
    const refused = this.tilt.status === 'denied';
    this.tilt.stop();
    sessionSet(SESSION_NO_TILT, '1');
    this.hud.setSettings({ tiltAvailable: refused, tiltNote: refused ? MOTION_DENIED : NO_SENSOR });
    this.hud.toast(refused ? ['MOTION ACCESS OFF', 'DRAG TO STEER'] : ['DRAG TO STEER', 'TAP TO SPLAT'], 2.4);
    this.setMode('touch');
  }

  private setMode(m: InputMode) {
    this.d.input.setMode(m);
    this.hud.setMode(m);
  }

  // ------------------------------------------------------------------ turbo events

  /**
   * The lever, a swipe, E / Q. Under the opening's gate a gear would lift the bus into the deck, so a shift up
   * waits for it: answered on this very frame (the toast, the ARMED readout and lever, the clunk) and fired by
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
      this.turboHintDue = false; // (they already know)
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
      tilt: { status: this.tilt.status, sx: c.sx, sy: c.sy, roll: c.roll, pitch: c.pitch, calibrated: c.calibrated, samples: c.samples, sensitivity: c.sensitivity },
      turbo: { gear: T.gear, engaged: T.engaged, strain: T.strain, speedK: T.speedK, boosting: T.boosting, edge: T.edge },
      flight: { speed: f.speed, y: f.y, agl: f.y - f.groundBroad, mode: f.mode },
      camera: { pull: this.fx.lens.pull, fov: this.fx.lens.fov, hfov: this.d.rig.hfov, distance: this.d.rig.distance },
      hud: { prompt: this.hud.promptOpen, settings: this.hud.settingsOpen },
      input: { chargeHeld: this.d.input.state.chargeHeld, turboHeld: this.d.input.state.turboHeld },
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
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Prefs;
    return v && typeof v === 'object' ? v : {};
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
