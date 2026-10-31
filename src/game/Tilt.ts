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
//   mean of the first samples once it is still), recentering on demand (eased,
//   never a jump), and a gentle auto-recenter of small posture offsets while
//   held still.
// - `neutral` is the only zero. src/game/Hybrid.ts moves it when a thumb hands
//   back (rebase), and never touches the sensitivity.

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
/** Seconds between the snapshots behind TiltCore.pastG. */
const PAST_STEP = 0.15;

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
  /** how fast gravity is turning, deg/s (smoothed over 0.1 s; runs before calibration), and for how long (s) it has
   *  stayed under config.tilt.settleRate */
  gRate = 0;
  gStill = 0;
  /** the auto-recenter is suspended (a thumb has the bus: src/game/Hybrid.ts) */
  autoHold = false;
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
  private readonly stick = { x: 0, y: 0 };
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
  /** the last sample's gravity, for gRate */
  private readonly gPrev = new THREE.Vector3(0, 0, -1);
  /** the press-shake window: no speed term in the filter and no prediction before this time (s) */
  private calmUntil = -1;
  /** gravity a moment ago: four vectors, one every PAST_STEP s (pastHead = the newest) */
  private readonly past = new Float32Array(12);
  private readonly pastT = new Float64Array(4).fill(-1);
  private pastHead = 0;
  /** waiting for stillness: since when before calibration sums (s), and how long a RECENTER has waited (s, < 0: none) */
  private calibWait = -1;
  private recWait = -1;
  /** rebase: seconds the neutral still tracks the pose, at what reading; seconds of the return grace, what is left of it */
  private trackT = 0;
  private trackRoll = 0;
  private trackPitch = 0;
  private graceT = 0;
  private zRoll = 0;
  private zPitch = 0;

  /** Start (or restart) calibration: once the phone is still (config.tilt.settleHold, capped by settleMax) the
   *  neutral becomes the mean of the next config.tilt.calibrate s of samples. */
  calibrate(): void {
    this.calibrated = false;
    this.calibWait = -1;
    this.recWait = -1;
    this.graceT = this.trackT = 0;
    this.pastT.fill(-1);
    this.pastHead = 0;
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
    this.recWait = -1;
    this.graceT = this.trackT = 0;
  }

  /** RECENTER is a corner reach: armed now, it fires recenter() once the phone is still (the test calibrate() uses). */
  recenterStill(): void {
    if (this.calibrated) this.recWait = 0;
  }

  /** The press-shake window (Hybrid.ts): until `until` (s) the filter drops its speed term and the prediction its lead. */
  calm(until: number): void {
    this.calmUntil = until;
  }

  /** Gravity about `age` s ago (from the four snapshots); `g` while there is no history yet. */
  pastG(out: THREE.Vector3, age = 0.45): THREE.Vector3 {
    const now = this.lastT;
    let best = -1, oldest = -1;
    for (let i = 0; i < 4; i++) {
      const t = this.pastT[i];
      if (t < 0) continue;
      if (oldest < 0 || t < this.pastT[oldest]) oldest = i;
      if (now - t >= age && (best < 0 || t > this.pastT[best])) best = i;
    }
    const k = best >= 0 ? best : oldest;
    if (k < 0) return out.copy(this.g);
    return out.set(this.past[k * 3], this.past[k * 3 + 1], this.past[k * 3 + 2]).normalize();
  }

  /** The relative angles (deg) of a gravity vector, leaving the live readings alone. */
  anglesOf(g: THREE.Vector3, out: { r: number; p: number }): void {
    const rr = this.rawRoll, rp = this.rawPitch;
    this.relative(g);
    out.r = this.rawRoll;
    out.p = this.rawPitch;
    this.rawRoll = rr;
    this.rawPitch = rp;
  }

  /** The curve alone (no filter state): dead zone, expo, sensitivity, the far fade; angles in deg. */
  stickFor(roll: number, pitch: number, out: { x: number; y: number }): void {
    const T = config.tilt;
    const sens = clamp(this.sensitivity, 0.25, 4);
    // (turned far past full authority the phone is being rotated or put down: the stick lets go)
    const far = Math.max(Math.abs(roll), Math.abs(pitch));
    const away = far <= T.awayFrom ? 1 : 1 - clamp((far - T.awayFrom) / Math.max(1, T.awayTo - T.awayFrom), 0, 1);
    out.x = tiltCurve(roll, T.rollDead, T.rollFull / sens, T.expo) * away;
    const p = tiltCurve(pitch, T.pitchDead, T.pitchFull / sens, T.expo) * away;
    // (the yoke ignores |sy| < yokeDead: start there, so tilt's own dead zone is the only one)
    const yd = clamp(config.flight.yokeDead * T.yokeComp, 0, 0.9);
    out.y = p === 0 ? 0 : Math.sign(p) * (yd + (1 - yd) * Math.abs(p));
  }

  /**
   * Move the one zero so the pose now reads (dRoll, dPitch), sensitivity untouched. For `track` s it follows the
   * live pose (hiding the phone's rebound once a thumb's force is gone); for `grace` s, motion back toward the old
   * neutral is absorbed, up to what was just moved, instead of reading as a counter-carve.
   */
  rebase(dRoll: number, dPitch: number, track: number, grace: number): void {
    this.relative(this.g);
    const zr = this.rawRoll - dRoll, zp = this.rawPitch - dPitch;
    this.rotateNeutral(zr, zp);
    this.relative(this.g);
    this.zRoll = zr;
    this.zPitch = zp;
    this.graceT = grace;
    this.trackT = track;
    this.trackRoll = dRoll;
    this.trackPitch = dPitch;
    this.recT = -1;
    this.fRoll.reset(dRoll, this.lastT);
    this.fPitch.reset(dPitch, this.lastT);
    this.roll = this.lastRoll = dRoll;
    this.pitch = this.lastPitch = dPitch;
  }

  /** Rotate the neutral toward gravity by these deg along the axes `relative` last worked out. */
  private rotateNeutral(droll: number, dpitch: number) {
    const rv = this.tmp2.copy(this.xh).multiplyScalar(dpitch / DEG).addScaledVector(this.fw, droll / DEG);
    const ang = rv.length();
    if (ang > 1e-7) {
      this.qRel.setFromAxisAngle(rv.multiplyScalar(1 / ang), ang);
      this.neutral.applyQuaternion(this.qRel).normalize();
    }
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
    // how fast gravity turns: before the calibrated return, because that is what calibration waits on
    if (dt > 0) {
      this.gRate += ((this.gPrev.angleTo(g) * DEG) / dt - this.gRate) * (1 - Math.exp(-dt / 0.1));
      this.gStill = this.gRate < T.settleRate ? this.gStill + dt : 0;
    }
    this.gPrev.copy(g);
    const ph = this.pastHead;
    if (this.pastT[ph] < 0 || t - this.pastT[ph] >= PAST_STEP) {
      const k = this.pastT[ph] < 0 ? ph : (ph + 1) % 4;
      this.past[k * 3] = g.x;
      this.past[k * 3 + 1] = g.y;
      this.past[k * 3 + 2] = g.z;
      this.pastT[k] = t;
      this.pastHead = k;
    }

    if (!this.calibrated) {
      if (this.calibT0 < 0) {
        // the hand is still on its way back from the corner: the neutral is not this pose
        if (this.calibWait < 0) this.calibWait = t;
        if (this.gStill < T.settleHold && t - this.calibWait < T.settleMax) return;
        this.calibT0 = t;
      }
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

    if (this.recWait >= 0) {
      this.recWait += dt;
      if (this.gStill >= T.settleHold || this.recWait >= T.settleMax) this.recenter();
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
    if (this.trackT > 0) {
      // just rebased: the neutral follows the pose for a moment (the phone rebounds once a thumb's force is gone)
      this.trackT -= dt;
      this.rotateNeutral(this.rawRoll - this.trackRoll, this.rawPitch - this.trackPitch);
      this.relative(g);
      this.fRoll.reset(this.rawRoll, t);
      this.fPitch.reset(this.rawPitch, t);
      this.lastRoll = this.rawRoll;
      this.lastPitch = this.rawPitch;
      if (this.graceT > 0) this.graceT -= dt;
    } else if (this.graceT > 0) {
      // the hand relaxing back past where the zero moved from is not a counter-carve; bounded
      this.graceT -= dt;
      const sr = this.rawRoll * this.zRoll < 0 ? Math.sign(this.rawRoll) * Math.min(Math.abs(this.rawRoll), Math.abs(this.zRoll)) : 0;
      const sp = this.rawPitch * this.zPitch < 0 ? Math.sign(this.rawPitch) * Math.min(Math.abs(this.rawPitch), Math.abs(this.zPitch)) : 0;
      if (sr !== 0 || sp !== 0) {
        this.rotateNeutral(sr, sp);
        this.zRoll += sr;
        this.zPitch += sp;
        this.relative(g);
      }
    }
    const fb = t < this.calmUntil ? 0 : T.beta;
    this.fRoll.filter(this.rawRoll, t, T.minCutoff, fb, T.dCutoff);
    this.fPitch.filter(this.rawPitch, t, T.minCutoff, fb, T.dCutoff);
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
    if (!this.autoHold && this.recT < 0 && this.stillFor > T.stillTime && dt > 0) {
      const k = 1 - Math.exp(-dt / Math.max(0.1, T.recenterTau));
      const kp = Math.abs(this.rawPitch) < T.recenterPitchBand ? k : 0;
      const kr = Math.abs(this.rawRoll) < T.recenterRollBand ? k : 0;
      // rotate the neutral toward gravity by a fraction of each component of the swing
      if (kp > 0 || kr > 0) this.rotateNeutral(kr * this.rawRoll, kp * this.rawPitch);
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
    const calm = t < this.calmUntil;
    const leadR = calm ? 0 : clamp(age + this.fRoll.tau, 0, T.predict);
    const leadP = calm ? 0 : clamp(age + this.fPitch.tau, 0, T.predict);
    this.stickFor(this.roll + this.fRoll.rate * leadR, this.pitch + this.fPitch.rate * leadP, this.stick);
    this.sx = this.stick.x;
    this.sy = this.stick.y;
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
  /** the player answered the sheet: no */
  | 'denied'
  /** requestPermission threw or rejected (no sheet was shown): not an answer, the next press retries */
  | 'blocked'
  /** no sensor, or no event within config.tilt.eventTimeout (an iframe that refuses motion sensors) */
  | 'unavailable';

type DOEStatic = { requestPermission?: () => Promise<string> };

/** The DOM side: permission, listening, timeout, screen orientation. */
export class TiltControl {
  readonly core = new TiltCore();
  status: TiltStatus = 'off';
  /** a quiet listen at load: nothing steers and nothing reacts, and it ends back at 'off' */
  probing = false;
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

  /**
   * Call SYNCHRONOUSLY inside a user gesture (touchend / pointerup / click):
   * on iOS it asks for motion access there and then. Resolves with the final
   * status ('active', 'denied', 'blocked', 'unavailable', or 'off' if stopped).
   */
  request(): Promise<TiltStatus> {
    this.probing = false; // (a real request takes over a quiet listen still running)
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
        this.set('blocked');
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
          this.set('blocked');
          return this.status;
        },
      );
    }
    return this.listen();
  }

  /** A quiet listen: true if motion is really flowing here. Steers nothing and ends at 'off', listening stopped. */
  probe(): Promise<boolean> {
    if (!TiltControl.supported()) return Promise.resolve(false);
    this.probing = true;
    return this.listen().then((s) => {
      const heard = s === 'active';
      if (!this.probing) return heard; // (a request took it over: that one owns the listening now)
      this.stop();
      this.status = 'off';
      this.probing = false;
      return heard;
    });
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
      this.core.gRate = this.core.gStill = 0;
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

  /** Recapture the neutral pose (eased), once the hand is back from the corner. */
  recenter(): void {
    this.core.recenterStill();
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
      // (one stray event and then silence is no sensor either; the opening waits on this)
      this.timer = window.setTimeout(() => {
        if (this.status === 'calibrating') {
          this.set('unavailable');
          this.stop();
        }
      }, Math.max(100, (config.tilt.settleMax + config.tilt.calibrate + config.tilt.eventTimeout) * 1000));
    }
    if (this.status === 'calibrating' && this.core.calibrated) this.set('active');
  }

  private set(s: TiltStatus) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
    if (s === 'active' || s === 'unavailable' || s === 'denied' || s === 'blocked' || s === 'off') {
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
