import type { AudioTune } from './tune';
import { clamp, hold, Kit, makePulseWave, mkFilter, mkGain, mkOsc, tanhCurve, target } from './dsp';

// The bus: a lovable, wheezy old engine.
//
// Engine: a band-limited pulse train at the firing rate (8..30 Hz) plus a
// half-rate copy so every other putt is fatter ("puh-PUTT puh-PUTT"). The
// pulses ring a fixed exhaust body and pipe resonance — so the timbre stays
// the same bus while the rate follows speed — with a little buzz on top. A
// full belly lowers and lumps the rpm in time with the wallow, and makes it
// misfire now and then.
//
// Breath: event-scheduled inhale/exhale cycles of band-passed noise. With a
// full belly they slow and deepen, a squeaky whistle rides the inhale and the
// exhale rattles. Empty belly: barely-there contented puffs.

const ENGINE_GAIN = 0.15;
const BREATH_GAIN = 0.55;
const WHISTLE_GAIN = 0.95;

export class BusVoice {
  private readonly o1: OscillatorNode;
  private readonly o2: OscillatorNode;
  private readonly pipeF: BiquadFilterNode;
  private readonly buzzF: BiquadFilterNode;
  private readonly vca: GainNode;
  /** Event-owned engine gain (misfires, heave stall). */
  private readonly stall: GainNode;
  private readonly breathF: BiquadFilterNode;
  private readonly breathG: GainNode;
  private readonly whistleF: BiquadFilterNode;
  private readonly whistleG: GainNode;
  private readonly rattleDepth: GainNode;
  private wobble = 0;
  private wallow = 0;
  /** No misfires before this time (heave owns the stall gain). */
  quietUntil = 0;

  constructor(private readonly kit: Kit, out: AudioNode) {
    const ctx = kit.ctx;
    const t = ctx.currentTime;
    const wave = makePulseWave(ctx, 120, 0.95);
    this.o1 = mkOsc(ctx, 'sine', 10);
    this.o2 = mkOsc(ctx, 'sine', 5);
    this.o1.setPeriodicWave(wave);
    this.o2.setPeriodicWave(wave);
    const pre = mkGain(ctx, 1);
    const o2g = mkGain(ctx, 0.6);
    this.o1.connect(pre);
    this.o2.connect(o2g).connect(pre);
    const sum = mkGain(ctx, 1);
    const bodyF = mkFilter(ctx, 'bandpass', 140, 3.2);
    this.pipeF = mkFilter(ctx, 'bandpass', 380, 4.5);
    this.buzzF = mkFilter(ctx, 'lowpass', 800, 0.6);
    pre.connect(bodyF).connect(mkGain(ctx, 2.5)).connect(sum);
    pre.connect(this.pipeF).connect(mkGain(ctx, 3.0)).connect(sum);
    pre.connect(this.buzzF).connect(mkGain(ctx, 0.18)).connect(sum);
    // round the putts off: gentle tanh saturation fattens them and tames the crest
    const sat = ctx.createWaveShaper();
    sat.curve = tanhCurve(2.2);
    const tame = mkFilter(ctx, 'lowpass', 1600, 0.6);
    this.vca = mkGain(ctx, 0);
    this.stall = mkGain(ctx, 1);
    sum.connect(sat).connect(tame).connect(mkFilter(ctx, 'highpass', 75, 0.7)).connect(this.vca).connect(this.stall).connect(out);
    this.o1.start(t);
    this.o2.start(t);

    // breath
    const air = ctx.createBufferSource();
    air.buffer = kit.white;
    air.loop = true;
    air.start(t, 0.7);
    this.breathF = mkFilter(ctx, 'bandpass', 700, 1.1);
    this.breathG = mkGain(ctx, 0);
    this.whistleF = mkFilter(ctx, 'bandpass', 1700, 22);
    this.whistleG = mkGain(ctx, 0);
    const rattle = mkGain(ctx, 1);
    this.rattleDepth = mkGain(ctx, 0);
    const rattleLfo = mkOsc(ctx, 'sine', 23);
    rattleLfo.connect(this.rattleDepth).connect(rattle.gain);
    rattleLfo.start(t);
    const breathOut = mkGain(ctx, 1);
    air.connect(this.breathF).connect(this.breathG).connect(rattle);
    air.connect(this.whistleF).connect(this.whistleG).connect(rattle);
    rattle.connect(breathOut).connect(out);
  }

  update(t: number, dt: number, speedN: number, surge: number, fullness: number, tune: AudioTune, push: boolean): void {
    const r = this.kit.rng;
    this.wobble += (-this.wobble / 0.8) * dt + (0.04 + 0.09 * fullness) * Math.sqrt(dt) * r.gauss();
    this.wobble = clamp(this.wobble, -0.2, 0.2);
    this.wallow += dt * Math.PI * 2 * 0.55;
    if (this.wallow > 1000) this.wallow -= Math.PI * 2 * 100;
    if (!push) return;
    const lump = 1 + this.wobble * 0.5 + 0.06 * fullness * Math.sin(this.wallow);
    const fF = tune.putterRate * (8.5 + 15 * speedN + 6 * surge) * (1 - 0.14 * fullness) * lump;
    target(this.o1.frequency, fF, t, 0.07);
    target(this.o2.frequency, fF * 0.5, t, 0.07);
    // more putts per second already make it louder at speed: keep the gain curve gentle
    const lvl = tune.engine * (0.55 + 0.15 * speedN + 0.1 * surge) * (1 + 0.12 * fullness);
    target(this.vca.gain, lvl * ENGINE_GAIN, t, 0.12);
    target(this.pipeF.frequency, 360 + 160 * speedN + 220 * surge, t, 0.15);
    target(this.buzzF.frequency, 650 + 900 * speedN + 900 * surge, t, 0.15);
  }

  /** Schedule one breath starting at t; returns its period (s). */
  breath(t: number, fullness: number, surge: number, tune: AudioTune): number {
    const P = (1.3 + 0.95 * fullness) / Math.max(0.2, tune.breathRate);
    const I = tune.wheeze * BREATH_GAIN * (0.05 + 0.95 * Math.pow(fullness, 1.6)) * (1 + 0.35 * surge);
    const W = tune.wheeze * WHISTLE_GAIN * Math.pow(fullness, 2.2);
    const dIn = 0.4 * P;
    const tEx = t + 0.47 * P;
    const dEx = 0.43 * P;
    const k = this.kit.rng.range(0.94, 1.06);
    const bf = this.breathF.frequency;
    const bg = this.breathG.gain;
    // inhale: hollow, rising
    target(bf, 650 * k, t, 0.02);
    target(bf, 1350 * k, t + 0.03, dIn * 0.45);
    target(bg, I * 0.5, t + 0.01, dIn * 0.3);
    target(bg, I * 0.08, t + dIn * 0.85, 0.05);
    // the wheeze: a squeaky whistle riding the inhale
    if (W > 0.01) {
      target(this.whistleF.frequency, 1500 * k, t, 0.02);
      target(this.whistleF.frequency, 1950 * k, t + dIn * 0.2, dIn * 0.4);
      target(this.whistleG.gain, W, t + dIn * 0.22, dIn * 0.22);
      target(this.whistleG.gain, 0, t + dIn * 0.8, 0.05);
    }
    // exhale: falling "haaa" with a chesty rattle
    target(bf, 950 * k, tEx - 0.03, 0.015);
    target(bf, 480 * k, tEx, dEx * 0.4);
    target(bg, I * 0.75, tEx + 0.005, 0.05);
    target(bg, 0, tEx + 0.12, dEx * 0.32);
    target(this.rattleDepth.gain, 0.65 * fullness, tEx, 0.04);
    target(this.rattleDepth.gain, 0, tEx + dEx * 0.6, 0.08);
    if (W > 0.01) {
      target(this.whistleF.frequency, 1350 * k, tEx, 0.03);
      target(this.whistleG.gain, W * 0.3, tEx + 0.04, 0.06);
      target(this.whistleG.gain, 0, tEx + dEx * 0.5, 0.08);
    }
    return P;
  }

  /** Cut any scheduled breath (continuous fade). */
  hush(t: number): void {
    for (const p of [this.breathG.gain, this.whistleG.gain, this.rattleDepth.gain, this.breathF.frequency, this.whistleF.frequency]) hold(p, t);
    target(this.breathG.gain, 0, t, 0.03);
    target(this.whistleG.gain, 0, t, 0.02);
    target(this.rattleDepth.gain, 0, t, 0.03);
  }

  /** Relief: one long, easy exhale ("haaaah"). Returns its duration. */
  sigh(t: number, tune: AudioTune): number {
    const bf = this.breathF.frequency;
    const bg = this.breathG.gain;
    target(bf, 1050, t, 0.03);
    target(bf, 420, t + 0.08, 0.34);
    target(bg, tune.wheeze * BREATH_GAIN * 0.95, t + 0.01, 0.07);
    target(bg, 0, t + 0.32, 0.3);
    return 1.4;
  }

  /** A sputtering misfire (or a double "cough"). */
  misfire(t: number, double: boolean): void {
    const g = this.stall.gain;
    target(g, 0.28, t, 0.008);
    target(g, 1, t + 0.07, 0.03);
    if (double) {
      target(g, 0.35, t + 0.19, 0.008);
      target(g, 1, t + 0.25, 0.04);
    }
  }

  /** The heave: engine chokes down for `dur`, then catches again. */
  stallFor(t: number, dur: number): void {
    const g = this.stall.gain;
    hold(g, t);
    target(g, 0.3, t, 0.025);
    target(g, 1, t + dur, 0.18);
    this.quietUntil = t + dur + 0.8;
  }
}
