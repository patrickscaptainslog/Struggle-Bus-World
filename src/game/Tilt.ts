import * as THREE from 'three';
import { config } from '../config';
import { clamp } from './springs';

// Tilt to fly: the phone is the yoke.
//
// Roll (tilt left / right) carves and banks; pitch relative to the neutral
// pose is the yoke (top edge toward you = pull back = climb; away = nose down
// = dive, and at the rooftops surge). The output is a stick (sx, sy) with the
// thumb's exact semantics (config.flight, Flight.step), so feel tuning stays
// shared between tilt and touch.
//
// How it stays steady:
// - Only gravity is used. The fused attitude (deviceorientation: gyro +
//   accelerometer) is turned into a quaternion (W3C Z-X'-Y'' = three's 'ZXY'),
//   and gravity is read in the device frame through it. The compass angle
//   (alpha) cancels out exactly, so turning your body, a magnetometer settling
//   or yaw drift never steers. The vector is continuous where the Euler angles
//   flip (beta through +-90, the phone pointing up).
// - Everything is relative to a neutral pose captured in the SCREEN frame
//   (device frame turned by screen.orientation.angle): portrait and landscape
//   both work and an orientation change carries the neutral across.
// - The relative tilt is the swing (shortest arc) from the neutral gravity to
//   the current one, as a rotation vector split along the neutral frame's
//   horizontal axes: the screen's right axis (pitch) and the horizontal axis
//   through the screen (roll). That split is the same whether the phone is
//   held flat, at 45 degrees or upright.
// - One-Euro filter per axis on the sample clock (smooth at rest, no lag in a
//   fast move), then a short prediction to the frame time from the filtered
//   rate (cancels what lag is left), a dead zone, and an expo curve that gives
//   fine control near center and full authority at ~30 degrees.
// - Calibration from how the player holds the phone when flying starts (the
//   mean of the first samples), recentering on demand (eased, never a jump),
//   and a gentle auto-recenter of small posture offsets while held still.

/** One-Euro filter (Casiez, Roussel, Vogel 2012) on an explicit clock (s). */
export class OneEuro {
  value = 0;
  /** filtered rate (units/s) */
  rate = 0;
  /** time constant of the last smoothing step (s): the lag a ramp sees */
  tau = 0;
  private t = -1;
  private prev = 0;

  reset(x: number, t: number) {
    this.value = x;
    this.prev = x;
    this.rate = 0;
    this.tau = 0;
    this.t = t;
  }

  get primed(): boolean {
    return this.t >= 0;
  }

  filter(x: number, t: number, minCutoff: number, beta: number, dCutoff: number): number {
    if (this.t < 0) {
      this.reset(x, t);
      return x;
    }
    const dt = t - this.t;
    if (!(dt > 1e-5)) return this.value; // same timestamp (or clock went back): keep
    this.t = t;
    // the rate from raw sample to raw sample (the paper differences against the filtered value, which reads
    // a 0.05 deg lag at 60 Hz as 3 deg/s: a biased rate breaks the prediction and the stillness test)
    const dRaw = (x - this.prev) / dt;
    this.prev = x;
    const ad = alpha(dCutoff, dt);
    this.rate += (dRaw - this.rate) * ad;
    const cutoff = minCutoff + beta * Math.abs(this.rate);
    const a = alpha(cutoff, dt);
    this.tau = 1 / (2 * Math.PI * cutoff);
    this.value += (x - this.value) * a;
    return this.value;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(1e-3, cutoff));
  return 1 / (1 + tau / dt);
}

/** Dead zone + expo: |a| (deg) -> 0..1, full at `full`. */
export function tiltCurve(a: number, dead: number, full: number, expo: number): number {
  const m = Math.abs(a);
  if (m <= dead) return 0;
  const u = clamp((m - dead) / Math.max(0.5, full - dead), 0, 1);
  const e = clamp(expo, 0, 1);
  return Math.sign(a) * ((1 - e) * u + e * u * u * u);
}

const DEG = 180 / Math.PI;
const Z_DOWN = new THREE.Vector3(0, 0, -1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * The tilt math with no DOM: feed it orientation samples, read the stick.
 * Allocation-free per sample and per frame.
 */
export class TiltCore {
  /** stick, Flight semantics: sx right, sy +up = nose down (dive / surge), -down = pull back (climb); |v| <= 1 */
  sx = 0;
  sy = 0;
  /** filtered relative angles (deg): roll + = right edge down, pitch + = top edge away (nose down) */
  roll = 0;
  pitch = 0;
  /** raw relative angles of the last sample (deg) */
  rawRoll = 0;
  rawPitch = 0;
  /** samples received, and the time of the last (s) */
  samples = 0;
  lastT = -1;
  /** the neutral pose is set (calibration finished) */
  calibrated = false;
  /** sensitivity multiplier (settings), 0.5..2 */
  sensitivity = config.tilt.sensitivity;
  /** how long the phone has been held still (s), and the rate that decided it (deg/s) */
  stillFor = 0;
  angRate = 0;
  /** gravity in the screen frame: the latest sample, and the neutral pose */
  readonly g = new THREE.Vector3(0, 0, -1);
  readonly neutral = new THREE.Vector3(0, -0.6, -0.8).normalize();
  private readonly fRoll = new OneEuro();
  private readonly fPitch = new OneEuro();
  private readonly q = new THREE.Quaternion();
  private readonly qs = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'ZXY');
  private readonly xh = new THREE.Vector3();
  private readonly fw = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly qRel = new THREE.Quaternion();
  private readonly calibSum = new THREE.Vector3();
  private calibT0 = -1;
  private calibN = 0;
  /** eased recenter: from -> target over recenterEase */
  private readonly recFrom = new THREE.Vector3();
  private readonly recTo = new THREE.Vector3();
  private recT = -1;
  private screenDeg = 0;
  private lastRoll = 0;
  private lastPitch = 0;
  /** when the screen orientation last changed (s), -1 = handled */
  private turnedAt = -1;

  /** Start (or restart) calibration: the neutral becomes the mean of the next config.tilt.calibrate s of samples. */
  calibrate(): void {
    this.calibrated = false;
    this.calibT0 = -1;
    this.calibN = 0;
    this.calibSum.set(0, 0, 0);
    this.recT = -1;
    this.sx = this.sy = 0;
  }

  /** Recenter on the current pose, eased over config.tilt.recenterEase s (never a jump). */
  recenter(): void {
    if (!this.calibrated) return;
    this.recFrom.copy(this.neutral);
    this.recTo.copy(this.g);
    this.recT = 0;
  }

  /**
   * One deviceorientation sample: beta / gamma (deg, W3C; alpha is not needed:
   * it cancels out of gravity), the screen orientation angle (deg) and the
   * sample time (s).
   */
  feed(beta: number, gamma: number, screenDeg: number, t: number): void {
    const T = config.tilt;
    if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return;
    // device -> earth: R = Rz(alpha) Rx(beta) Ry(gamma) = three's 'ZXY' with (x, y, z) = (beta, gamma, alpha);
    // alpha = 0 (gravity doesn't depend on it). Gravity in the device frame = R^-1 (0, 0, -1).
    const r = Math.PI / 180;
    this.q.setFromEuler(this.e.set(beta * r, gamma * r, 0, 'ZXY'));
    const g = this.tmp.copy(Z_DOWN).applyQuaternion(this.q.invert());
    // ...into the screen frame (screen x right, y up, z out of the glass)
    const sd = ((screenDeg % 360) + 360) % 360;
    // (the screen turned because the player turned the phone: they hold it about as before relative to the
    // screen, so the neutral stays in screen coordinates; an eased recenter follows once it settles)
    if (sd !== this.screenDeg && this.samples > 0) this.turnedAt = t;
    this.screenDeg = sd;
    this.qs.setFromAxisAngle(Z_AXIS, sd * r);
    g.applyQuaternion(this.qs).normalize();
    this.g.copy(g);
    this.samples++;
    const dt = this.lastT >= 0 ? clamp(t - this.lastT, 0, 0.25) : 0;
    this.lastT = t;

    if (!this.calibrated) {
      if (this.calibT0 < 0) this.calibT0 = t;
      this.calibSum.add(g);
      this.calibN++;
      if (t - this.calibT0 >= T.calibrate && this.calibN >= 2) {
        this.neutral.copy(this.calibSum).normalize();
        this.calibrated = true;
        this.fRoll.reset(0, t);
        this.fPitch.reset(0, t);
        this.stillFor = 0;
      }
      return;
    }

    // a screen turn: recenter once the phone has settled in its new hold
    if (this.turnedAt >= 0 && t - this.turnedAt > 0.35) {
      this.turnedAt = -1;
      this.recenter();
    }
    // eased recenter
    if (this.recT >= 0) {
      this.recT += dt;
      const k = clamp(this.recT / Math.max(0.01, T.recenterEase), 0, 1);
      const s = k * k * (3 - 2 * k);
      this.neutral.copy(this.recFrom).lerp(this.recTo, s).normalize();
      if (k >= 1) this.recT = -1;
    }

    this.relative(g);
    this.fRoll.filter(this.rawRoll, t, T.minCutoff, T.beta, T.dCutoff);
    this.fPitch.filter(this.rawPitch, t, T.minCutoff, T.beta, T.dCutoff);
    this.roll = this.fRoll.value;
    this.pitch = this.fPitch.value;

    // auto-recenter: held still, small posture offsets drift back to neutral (pitch more than roll:
    // a held carve is the player's, a slowly sagging wrist is not)
    // (stillness from the filtered angles' drift, smoothed over ~0.3 s: the raw rate is too noisy to trust)
    if (dt > 0) {
      const drift = Math.hypot(this.roll - this.lastRoll, this.pitch - this.lastPitch) / dt;
      this.angRate += (drift - this.angRate) * (1 - Math.exp(-dt / 0.3));
    }
    this.lastRoll = this.roll;
    this.lastPitch = this.pitch;
    this.stillFor = this.angRate < T.stillRate ? this.stillFor + dt : 0;
    if (this.recT < 0 && this.stillFor > T.stillTime && dt > 0) {
      const k = 1 - Math.exp(-dt / Math.max(0.1, T.recenterTau));
      const kp = Math.abs(this.rawPitch) < T.recenterPitchBand ? k : 0;
      const kr = Math.abs(this.rawRoll) < T.recenterRollBand ? k : 0;
      if (kp > 0 || kr > 0) {
        // rotate the neutral toward gravity by a fraction of each component of the swing
        const rv = this.tmp2.copy(this.xh).multiplyScalar((kp * this.rawPitch) / DEG).addScaledVector(this.fw, (kr * this.rawRoll) / DEG);
        const ang = rv.length();
        if (ang > 1e-7) {
          this.qRel.setFromAxisAngle(rv.multiplyScalar(1 / ang), ang);
          this.neutral.applyQuaternion(this.qRel).normalize();
        }
      }
    }
  }

  /**
   * The swing from the neutral gravity to g as a rotation vector, split along
   * the neutral frame's horizontal axes: pitch about the screen's right axis
   * (made horizontal), roll about the horizontal axis through the screen.
   */
  private relative(g: THREE.Vector3) {
    const n = this.neutral;
    // the screen's right axis made horizontal (falls back to the up axis if the phone is on its side)
    const xh = this.xh.copy(X_AXIS).addScaledVector(n, -n.x);
    if (xh.lengthSq() < 0.01) xh.copy(Y_AXIS).addScaledVector(n, -n.y).cross(n);
    xh.normalize();
    const fw = this.fw.crossVectors(n, xh).normalize();
    this.qRel.setFromUnitVectors(n, g);
    const q = this.qRel;
    const s = Math.hypot(q.x, q.y, q.z);
    if (s < 1e-9) {
      this.rawRoll = this.rawPitch = 0;
      return;
    }
    const ang = 2 * Math.atan2(s, q.w);
    const k = (ang / s) * DEG;
    this.rawPitch = (q.x * xh.x + q.y * xh.y + q.z * xh.z) * k;
    this.rawRoll = (q.x * fw.x + q.y * fw.y + q.z * fw.z) * k;
  }

  /**
   * The stick at frame time `t` (s): prediction from the filtered rate (the
   * sample's age plus the filter's own lag, capped), dead zone, expo, sensitivity.
   */
  update(t: number): void {
    const T = config.tilt;
    if (!this.calibrated || this.lastT < 0) {
      this.sx = this.sy = 0;
      return;
    }
    const age = clamp(t - this.lastT, 0, 0.1);
    const leadR = clamp(age + this.fRoll.tau, 0, T.predict);
    const leadP = clamp(age + this.fPitch.tau, 0, T.predict);
    const roll = this.roll + this.fRoll.rate * leadR;
    const pitch = this.pitch + this.fPitch.rate * leadP;
    const sens = clamp(this.sensitivity, 0.25, 4);
    // (turned far past full authority the phone is being rotated or put down: the stick lets go)
    const far = Math.max(Math.abs(roll), Math.abs(pitch));
    const away = far <= T.awayFrom ? 1 : 1 - clamp((far - T.awayFrom) / Math.max(1, T.awayTo - T.awayFrom), 0, 1);
    this.sx = tiltCurve(roll, T.rollDead, T.rollFull / sens, T.expo) * away;
    const p = tiltCurve(pitch, T.pitchDead, T.pitchFull / sens, T.expo) * away;
    // (the yoke ignores |sy| < yokeDead: start there, so tilt's own dead zone is the only one)
    const yd = clamp(config.flight.yokeDead * T.yokeComp, 0, 0.9);
    this.sy = p === 0 ? 0 : Math.sign(p) * (yd + (1 - yd) * Math.abs(p));
  }
}

export type TiltStatus =
  /** not listening */
  | 'off'
  /** asking the OS (iOS permission sheet) */
  | 'requesting'
  /** listening, no sample yet */
  | 'waiting'
  /** samples arriving, capturing the neutral pose */
  | 'calibrating'
  | 'active'
  /** the player (or the browser) said no */
  | 'denied'
  /** no sensor, or no event within config.tilt.eventTimeout (an iframe that refuses motion sensors) */
  | 'unavailable';

type DOEStatic = { requestPermission?: () => Promise<string> };

/** The DOM side: permission, listening, timeout, screen orientation. */
export class TiltControl {
  readonly core = new TiltCore();
  status: TiltStatus = 'off';
  onStatus: ((s: TiltStatus) => void) | null = null;
  private timer = 0;
  private listening = false;
  private readonly waiters: Array<(s: TiltStatus) => void> = [];
  private readonly onOrient = (e: DeviceOrientationEvent) => this.sample(e);
  // back from another app: the player holds the phone anew; recenter (eased) on the first samples
  private readonly onVisible = () => {
    if (!document.hidden && this.status === 'active') this.recenterOnNext = true;
  };
  private recenterOnNext = false;

  /** Motion sensors might exist here (the API is present). */
  static supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /** iOS 13+: events only flow after DeviceOrientationEvent.requestPermission() in a user gesture. */
  static needsPermission(): boolean {
    if (!TiltControl.supported()) return false;
    const D = (window as unknown as { DeviceOrientationEvent: DOEStatic }).DeviceOrientationEvent;
    return typeof D.requestPermission === 'function';
  }

  /** The stick is live (calibrated, samples flowing). */
  get active(): boolean {
    return this.status === 'active';
  }

  get sx(): number {
    return this.core.sx;
  }
  get sy(): number {
    return this.core.sy;
  }
  /** Outside the dead zones: the yoke is deflected (Flight's `dragging`). */
  get engaged(): boolean {
    return this.active && (this.core.sx !== 0 || this.core.sy !== 0);
  }

  /**
   * Call SYNCHRONOUSLY inside a user gesture (touchend / pointerup / click):
   * on iOS it asks for motion access there and then. Resolves with the final
   * status ('active', 'denied' or 'unavailable').
   */
  request(): Promise<TiltStatus> {
    if (!TiltControl.supported()) {
      this.set('unavailable');
      return Promise.resolve(this.status);
    }
    const D = (window as unknown as { DeviceOrientationEvent: DOEStatic }).DeviceOrientationEvent;
    if (typeof D.requestPermission === 'function') {
      this.set('requesting');
      let p: Promise<string>;
      try {
        p = D.requestPermission(); // must be the first thing in the gesture
      } catch {
        this.set('denied');
        return Promise.resolve(this.status);
      }
      return p.then(
        (r) => {
          if (r !== 'granted') {
            this.set('denied');
            return this.status;
          }
          return this.listen();
        },
        () => {
          this.set('denied');
          return this.status;
        },
      );
    }
    return this.listen();
  }

  /** Listen (no permission needed, or already granted): resolves once active, or 'unavailable' after the timeout. */
  listen(): Promise<TiltStatus> {
    return new Promise((resolve) => {
      if (!TiltControl.supported()) {
        this.set('unavailable');
        resolve(this.status);
        return;
      }
      this.waiters.push(resolve);
      this.core.calibrate();
      this.core.samples = 0;
      this.core.lastT = -1;
      if (!this.listening) {
        window.addEventListener('deviceorientation', this.onOrient);
        document.addEventListener('visibilitychange', this.onVisible);
        this.listening = true;
      }
      this.set('waiting');
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        if (this.status === 'waiting') {
          this.set('unavailable');
          this.stop();
        }
      }, Math.max(100, config.tilt.eventTimeout * 1000));
    });
  }

  stop(): void {
    window.clearTimeout(this.timer);
    if (this.listening) {
      window.removeEventListener('deviceorientation', this.onOrient);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    this.listening = false;
    this.core.sx = this.core.sy = 0;
    if (this.status !== 'denied' && this.status !== 'unavailable') this.set('off');
  }

  /** Recapture the neutral pose (eased). */
  recenter(): void {
    this.core.recenter();
  }

  /** Once per frame before reading sx / sy. */
  update(): void {
    this.core.update(performance.now() / 1000);
  }

  private sample(e: DeviceOrientationEvent) {
    // a sensorless desktop may fire one event of nulls: that's not a sensor
    if (e.beta === null || e.gamma === null || e.beta === undefined || e.gamma === undefined) return;
    const t = evSeconds(e);
    this.core.feed(e.beta, e.gamma, screenAngle(), t);
    if (this.recenterOnNext && this.core.calibrated) {
      this.recenterOnNext = false;
      this.core.recenter();
    }
    if (this.status === 'waiting') {
      window.clearTimeout(this.timer);
      this.set('calibrating');
    }
    if (this.status === 'calibrating' && this.core.calibrated) this.set('active');
  }

  private set(s: TiltStatus) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
    if (s === 'active' || s === 'unavailable' || s === 'denied' || s === 'off') {
      const w = this.waiters.splice(0);
      for (const r of w) r(s);
    }
  }
}

/** Screen orientation angle (deg): screen.orientation, else the old iOS window.orientation. */
export function screenAngle(): number {
  const so = (screen as Screen & { orientation?: { angle?: number } }).orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  const wo = (window as unknown as { orientation?: number }).orientation;
  return typeof wo === 'number' ? wo : 0;
}

function evSeconds(e: Event): number {
  const now = performance.now();
  const t = e.timeStamp;
  return (t > 0 && t <= now + 50 && now - t < 1000 ? t : now) / 1000;
}
