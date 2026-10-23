// Small DSP + WebAudio helpers shared by the audio module. Everything here
// works on any BaseAudioContext (realtime or offline), allocates only when an
// event is triggered (never per frame), and never schedules a discontinuous
// gain change: every envelope starts from 0 with a ramp and ends with an
// exponential approach to 0 well below audibility before its source stops.

/** Scheduling lookahead for one-shot events (s). Keeps starts click-free on coarse realtime clocks. */
export const LOOKAHEAD = 0.012;

export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Finite or fallback (game inputs are sanitized before they touch an AudioParam). */
export function fin(x: number, fallback = 0): number {
  return Number.isFinite(x) ? x : fallback;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Deterministic PRNG (mulberry32) so offline renders are reproducible. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Approximately normal, mean 0, sd 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }
}

/** Shared resources every instrument needs. */
export interface Kit {
  ctx: BaseAudioContext;
  rng: Rng;
  /** 3 s looped white noise (RMS ~0.3). */
  white: AudioBuffer;
  /** 4 s looped pink noise (RMS ~0.25). */
  pink: AudioBuffer;
  /** Music bus input (chorus + reverb applied downstream). */
  music: AudioNode;
  /** SFX bus input (dry). */
  sfx: AudioNode;
  /** SFX reverb send. */
  sfxVerb: AudioNode;
  /** Ambience bus input. */
  amb: AudioNode;
}

// ---------------------------------------------------------------- automation

const MIN_TAU = 0.0006;

/** Exponential approach — always continuous from whatever the param is doing now. */
export function target(p: AudioParam, v: number, t: number, tau: number): void {
  p.setTargetAtTime(v, t, tau > MIN_TAU ? tau : MIN_TAU);
}

/** Cancel future automation while holding the current value (continuous). */
export function hold(p: AudioParam, t: number): void {
  const q = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof q.cancelAndHoldAtTime === 'function') q.cancelAndHoldAtTime(t);
  else p.cancelScheduledValues(t);
}

/** Attack (linear from 0) then exponential decay toward 0. Use on fresh nodes only. */
export function envAD(p: AudioParam, t: number, peak: number, attack: number, tau: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  target(p, 0, t + attack, tau);
}

// -------------------------------------------------------------- node helpers

export function mkGain(ctx: BaseAudioContext, v = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

/**
 * k-rate automation: coefficients update once per 128-sample block instead of
 * every sample while a param moves (~2.5x cheaper for swept/tracked filters,
 * measured in Chrome). Nothing here needs sample-accurate filter sweeps.
 * Engines without `automationRate` simply ignore the assignment.
 */
export function kRate(p: AudioParam): AudioParam {
  try {
    (p as AudioParam & { automationRate?: string }).automationRate = 'k-rate';
  } catch {
    /* not supported for this param */
  }
  return p;
}

export function mkFilter(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  kRate(b.frequency);
  kRate(b.Q);
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

export function mkOsc(ctx: BaseAudioContext, type: OscillatorType, f: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  return o;
}

export function mkPan(ctx: BaseAudioContext, pan = 0): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  return p;
}

/** One-shot looped-noise source starting at a random point in the buffer. */
export function noiseSrc(kit: Kit, t: number, dur: number, pink = false): AudioBufferSourceNode {
  const s = kit.ctx.createBufferSource();
  const b = pink ? kit.pink : kit.white;
  s.buffer = b;
  s.loop = true;
  s.start(t, kit.rng.range(0, b.duration - 0.05));
  s.stop(t + dur);
  return s;
}

/** Disconnect an event's private nodes once its last source has finished. */
export function disposeOnEnd(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  src.onended = () => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
  };
}

/** Stop a source early (safe to call more than once on every engine). */
export function safeStop(src: AudioScheduledSourceNode, t: number): void {
  try {
    src.stop(t);
  } catch {
    /* already stopped / older WebKit throwing on a second stop() */
  }
}

// ------------------------------------------------------------------ buffers

/** Loopable noise buffer: DC removed, RMS normalized, seam crossfaded. */
export function makeNoise(ctx: BaseAudioContext, seconds: number, seed: number, pink: boolean): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const fade = Math.floor(0.08 * sr);
  const g = new Float32Array(n + fade);
  const r = new Rng(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < g.length; i++) {
    const w = r.next() * 2 - 1;
    if (!pink) {
      g[i] = w;
      continue;
    }
    // Paul Kellet's refined pink filter
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    g[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    if (i < fade) {
      // equal-power blend of the overrun tail into the head: the loop seam is seamless
      const a = i / fade;
      d[i] = g[i] * Math.sqrt(a) + g[n + i] * Math.sqrt(1 - a);
    } else d[i] = g[i];
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += d[i];
  mean /= n;
  let e = 0;
  for (let i = 0; i < n; i++) {
    d[i] -= mean;
    e += d[i] * d[i];
  }
  const rms = Math.sqrt(e / n) || 1;
  const k = (pink ? 0.25 : 0.3) / rms;
  for (let i = 0; i < n; i++) d[i] *= k;
  return buf;
}

/**
 * Synthesized stereo room: decorrelated noise with an exponential decay whose
 * brightness falls over time (highs die first), a short pre-delay, and the
 * lows trimmed so the tail stays airy. Energy-normalized per channel.
 */
export function makeReverbIR(ctx: BaseAudioContext, seconds: number, rt60: number, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(0.016 * sr);
  const hpR = Math.exp((-2 * Math.PI * 170) / sr);
  // incremental envelopes (no per-sample exp): this runs inside the unlock gesture
  const decay = Math.exp(-6.9 / rt60 / sr);
  const brightDecay = Math.exp(-1 / 0.45 / sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = new Rng(seed + ch * 7919);
    let lp = 0;
    let hpPrev = 0;
    let hp = 0;
    let e = 0;
    let env = 1;
    let bright = 1;
    let a = 0;
    for (let i = 0; i < n; i++) {
      if (i < pre) {
        d[i] = 0;
        continue;
      }
      const k = i - pre;
      if ((k & 31) === 0) a = 1 - Math.exp((-2 * Math.PI * (1400 + 6500 * bright)) / sr);
      lp += a * (r.next() * 2 - 1 - lp);
      hp = hpR * (hp + lp - hpPrev);
      hpPrev = lp;
      let g = env;
      const te = k / sr;
      if (te < 0.012) g *= te / 0.012; // soft onset
      const tail = (n - i) / sr;
      if (tail < 0.15) g *= tail / 0.15; // end of buffer fades out, never truncates
      d[i] = hp * g;
      e += d[i] * d[i];
      env *= decay;
      bright *= brightDecay;
    }
    const k = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < n; i++) d[i] *= k;
  }
  return buf;
}

/**
 * Soft-clip curve for the final WaveShaper, fed at half gain so its domain is
 * [-2, 2]: identity up to `knee`, then an exponential shoulder that never
 * exceeds `ceiling`. Odd point count so 0 maps exactly to 0 (no DC).
 */
export function softClipCurve(knee = 0.72, ceiling = 0.93, n = 4097): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : ceiling - span * Math.exp(-(ax - knee) / span);
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

/**
 * Band-limited pulse wave: each cycle is a "pop" that excites exhaust
 * resonances. Lanczos-tapered so the truncated series doesn't ring (Gibbs).
 */
export function makePulseWave(ctx: BaseAudioContext, harmonics = 160, tilt = 0.3): PeriodicWave {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let k = 1; k <= harmonics; k++) {
    const x = (Math.PI * k) / (harmonics + 1);
    real[k] = (1 / Math.pow(k, tilt)) * (Math.sin(x) / x);
  }
  return ctx.createPeriodicWave(real, imag);
}

/** Symmetric tanh saturation curve (unity small-signal gain after normalization). */
export function tanhCurve(drive: number, n = 1025): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / k;
  }
  return c;
}
