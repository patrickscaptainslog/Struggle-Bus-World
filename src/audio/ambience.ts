import type { AudioTune } from './tune';
import { clamp, clamp01, disposeOnEnd, Kit, mkFilter, mkGain, mkOsc, mkPan, target } from './dsp';

// The grey city's sound: muffled wind and a distant foghorn. Nothing else.
// Lonely, hushed, never empty.

// ------------------------------------------------------------------- wind

// Pink + white noise through a sub "rumble", two slowly wandering "howl"
// bands panned wide (independent gusts per side), and a high "rush" that only
// opens with speed. Everything passes a master muffle low-pass: grey and fog
// close it, paint opens it a little.

export class Wind {
  private readonly rumble: GainNode;
  private readonly howlF: BiquadFilterNode[] = [];
  private readonly howlG: GainNode[] = [];
  private readonly rushF: BiquadFilterNode;
  private readonly rushG: GainNode;
  private readonly muffle: BiquadFilterNode;
  private readonly gust = [0.1, -0.2];
  private swell = 0;

  constructor(private readonly kit: Kit, out: AudioNode) {
    const ctx = kit.ctx;
    const t = ctx.currentTime;
    const pink = ctx.createBufferSource();
    pink.buffer = kit.pink;
    pink.loop = true;
    pink.start(t);
    const white = ctx.createBufferSource();
    white.buffer = kit.white;
    white.loop = true;
    white.start(t, 1.3);

    const mix = mkGain(ctx, 1);
    this.muffle = mkFilter(ctx, 'lowpass', 1400, 0.5);
    mix.connect(this.muffle).connect(out);

    this.rumble = mkGain(ctx, 0);
    pink.connect(mkFilter(ctx, 'lowpass', 170, 0.6)).connect(this.rumble).connect(mix);

    for (let i = 0; i < 2; i++) {
      const f = mkFilter(ctx, 'bandpass', i ? 760 : 520, 1.7);
      const g = mkGain(ctx, 0);
      (i ? white : pink).connect(f).connect(g).connect(mkPan(ctx, i ? 0.62 : -0.62)).connect(mix);
      this.howlF.push(f);
      this.howlG.push(g);
    }

    this.rushF = mkFilter(ctx, 'highpass', 1200, 0.6);
    this.rushG = mkGain(ctx, 0);
    white.connect(this.rushF).connect(mkFilter(ctx, 'lowpass', 5200, 0.5)).connect(this.rushG).connect(mix);
  }

  /** Advance gusts (every frame); push params when `push`. Inputs 0..1. */
  update(t: number, dt: number, speedN: number, altN: number, surge: number, paint: number, fog: number, tune: AudioTune, push: boolean): void {
    // Ornstein-Uhlenbeck gusts: slow, organic, independent per side.
    const r = this.kit.rng;
    const sq = Math.sqrt(dt);
    for (let i = 0; i < 2; i++) {
      this.gust[i] += (-this.gust[i] / 2.6) * dt + 0.42 * sq * r.gauss();
      this.gust[i] = clamp(this.gust[i], -1, 1.2);
    }
    this.swell += (-this.swell / 9) * dt + 0.22 * sq * r.gauss();
    this.swell = clamp(this.swell, -0.6, 0.8);
    if (!push) return;

    const w = tune.wind;
    const hush = 1 - 0.45 * fog; // the opening fog bank is still air
    const base = w * hush * (0.32 + 0.6 * speedN + 0.4 * altN + 0.25 * this.swell) * (1 - 0.25 * paint);
    target(this.rumble.gain, Math.max(0, base * 0.12), t, 0.25);
    for (let i = 0; i < 2; i++) {
      const g = clamp01(0.5 + 0.5 * this.gust[i]);
      target(this.howlG[i].gain, Math.max(0, base * (0.2 + 0.5 * g * g)), t, 0.18);
      target(this.howlF[i].frequency, (i ? 430 : 330) + 520 * g + 380 * speedN, t, 0.3);
    }
    const rush = w * hush * (0.55 * speedN * speedN + 0.35 * surge * speedN);
    target(this.rushG.gain, rush * 0.11, t, 0.2);
    target(this.rushF.frequency, 900 + 1700 * speedN, t, 0.3);
    target(this.muffle.frequency, (900 + 2300 * speedN + 1200 * paint) * (1 - 0.4 * fog), t, 0.3);
  }
}

// ---------------------------------------------------------------- foghorn

// SF diaphone, very far away: "BEEEE-oh". A buzzy saw+square pair that slides
// up into pitch as pressure builds, holds, then drops a fourth for the grunt.
// In the key (D3 -> A2, the far station A2 -> E2). Heavily low-passed, with a
// long tail from a 4-line Householder feedback-delay network (no convolution):
// sparse, dark echoes off the hills that smear into a bay-sized room.

const FDN_DELAYS = [0.173, 0.247, 0.331, 0.419];
const FDN_RT60 = 6.5;

export class Foghorn {
  private readonly input: GainNode;

  constructor(private readonly kit: Kit, out: AudioNode) {
    const ctx = kit.ctx;
    this.input = mkGain(ctx, 1);
    const lp1 = mkFilter(ctx, 'lowpass', 440, 0.6);
    const lp2 = mkFilter(ctx, 'lowpass', 820, 0.5);
    const hp = mkFilter(ctx, 'highpass', 55, 0.6);
    this.input.connect(hp).connect(lp1).connect(lp2);
    const dry = mkGain(ctx, 0.5);
    lp2.connect(dry).connect(out);

    const injP = mkGain(ctx, 0.5);
    const injN = mkGain(ctx, -0.5);
    lp2.connect(injP);
    lp2.connect(injN);
    const mixS = mkGain(ctx, -0.5); // Householder: in_i = y_i - 0.5 * sum(y)
    const merger = ctx.createChannelMerger(2);
    const delays: DelayNode[] = [];
    for (let i = 0; i < 4; i++) {
      const d = ctx.createDelay(1);
      d.delayTime.value = FDN_DELAYS[i];
      const damp = mkFilter(ctx, 'lowpass', 380, 0.5);
      const fb = mkGain(ctx, Math.pow(10, (-3 * FDN_DELAYS[i]) / FDN_RT60));
      d.connect(damp).connect(fb);
      fb.connect(d);
      fb.connect(mixS);
      d.connect(merger, 0, i & 1);
      (i & 1 ? injN : injP).connect(d);
      delays.push(d);
    }
    for (const d of delays) mixS.connect(d);
    const wet = mkGain(ctx, 0.62);
    merger.connect(wet).connect(out);
  }

  /** One blast. level ~0..1 (already scaled by paint/fog), pan -1..1. Lasts ~3 s (+ tail). */
  blast(t: number, fHi: number, fLo: number, level: number, pan: number): void {
    const ctx = this.kit.ctx;
    if (level <= 0.001) return;
    const A = level * 0.2;
    const env = mkGain(ctx, 0);
    const am = mkGain(ctx, 1);
    const p = mkPan(ctx, pan);
    const o1 = mkOsc(ctx, 'sawtooth', fHi);
    const o2 = mkOsc(ctx, 'square', fHi);
    const o2g = mkGain(ctx, 0.45);
    o2.detune.value = 9;
    for (const o of [o1, o2]) {
      o.frequency.setValueAtTime(fHi * 0.93, t);
      target(o.frequency, fHi, t + 0.02, 0.14);
      target(o.frequency, fLo, t + 2.05, 0.05);
    }
    // amplitude: growl in, hold with a slight sag, dip on the drop, "oh", fade
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(A * 0.5, t + 0.28);
    target(env.gain, A, t + 0.28, 0.22);
    target(env.gain, A * 0.86, t + 1.3, 0.5);
    target(env.gain, A * 0.62, t + 2.05, 0.04);
    target(env.gain, A * 0.8, t + 2.16, 0.07);
    target(env.gain, 0, t + 2.42, 0.2);
    // distance: the air wavers
    const lfo = mkOsc(ctx, 'sine', 0.7 + this.kit.rng.next() * 0.5);
    const lfoG = mkGain(ctx, 0.14);
    lfo.connect(lfoG).connect(am.gain);
    o1.connect(env);
    o2.connect(o2g).connect(env);
    env.connect(am).connect(p).connect(this.input);
    const end = t + 4.4;
    for (const o of [o1, o2, lfo]) {
      o.start(t);
      o.stop(end);
    }
    disposeOnEnd(o1, [o1, o2, o2g, lfo, lfoG, env, am, p]);
  }
}
