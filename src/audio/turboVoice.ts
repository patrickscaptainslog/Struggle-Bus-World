import { clamp, disposeOnEnd, envAD, mkFilter, mkGain, mkOsc, noiseSrc, target, type Kit } from './dsp';

// The turbo's voice, synthesized like everything else (no samples), on the
// engine's sfx bus (master volume, compressor, soft clip and mute apply):
//  - continuous: a jet roar (band-passed noise rising with speed) over a low
//    rumble, the old engine's whine (a saw that climbs with speed and strain),
//    and a rattle (high noise chopped by a square LFO) while it strains;
//  - one-shots: the shift (a gearbox clunk and a rising / falling whoosh),
//    the engagement (two backfire pops), the sonic boom (an N-wave's two
//    cracks, a sub drop, a rolling rumble into the reverb), and LOCKED (a
//    clunk and two low buzzes).
// Attach once the AudioEngine is live (AudioEngine.voiceKit()).

export interface TurboSound {
  /** turbo speed, log scale (0 = surge, 1 = G1) */
  speedK: number;
  /** 0..1 straining */
  strain: number;
  boosting: boolean;
}

export class TurboVoice {
  private kit: Kit | null = null;
  private roarG!: GainNode;
  private roarBP!: BiquadFilterNode;
  private rumbleG!: GainNode;
  private whine!: OscillatorNode;
  private whineG!: GainNode;
  private whineLP!: BiquadFilterNode;
  private rattleG!: GainNode;
  private rattleLfo!: OscillatorNode;

  get attached(): boolean {
    return this.kit !== null;
  }

  /** Build the continuous voices (silent until update() opens them). */
  attach(kit: Kit, t: number): void {
    if (this.kit) return;
    this.kit = kit;
    const { ctx } = kit;
    const out = kit.sfx;
    // jet roar
    const n1 = ctx.createBufferSource();
    n1.buffer = kit.white;
    n1.loop = true;
    this.roarBP = mkFilter(ctx, 'bandpass', 300, 0.8);
    const lp = mkFilter(ctx, 'lowpass', 3200, 0.7);
    this.roarG = mkGain(ctx, 0);
    n1.connect(this.roarBP).connect(lp).connect(this.roarG).connect(out);
    n1.start(t);
    // low rumble
    const n2 = ctx.createBufferSource();
    n2.buffer = kit.pink;
    n2.loop = true;
    const lp2 = mkFilter(ctx, 'lowpass', 150, 0.9);
    this.rumbleG = mkGain(ctx, 0);
    n2.connect(lp2).connect(this.rumbleG).connect(out);
    n2.start(t);
    // engine whine
    this.whine = mkOsc(ctx, 'sawtooth', 110);
    this.whineLP = mkFilter(ctx, 'lowpass', 900, 1.2);
    this.whineG = mkGain(ctx, 0);
    this.whine.connect(this.whineLP).connect(this.whineG).connect(out);
    this.whine.start(t);
    // rattle: high noise gated by a square LFO
    const n3 = ctx.createBufferSource();
    n3.buffer = kit.white;
    n3.loop = true;
    const hp = mkFilter(ctx, 'highpass', 1900, 0.8);
    const gate = mkGain(ctx, 0.5);
    this.rattleLfo = mkOsc(ctx, 'square', 21);
    const depth = mkGain(ctx, 0.5);
    this.rattleLfo.connect(depth).connect(gate.gain);
    this.rattleG = mkGain(ctx, 0);
    n3.connect(hp).connect(gate).connect(this.rattleG).connect(out);
    n3.start(t);
    this.rattleLfo.start(t);
  }

  /** Per frame (t = the engine's start time for now). */
  update(s: TurboSound, t: number): void {
    if (!this.kit) return;
    const k = clamp(s.speedK, 0, 2);
    const k1 = Math.min(k, 1);
    const st = clamp(s.strain, 0, 1);
    const boost = s.boosting ? 1 : 0;
    target(this.roarG.gain, (0.16 * k1 + 0.04 * Math.max(0, k - 1)) * (1 + 0.35 * boost), t, 0.12);
    target(this.roarBP.frequency, 240 + 900 * k1 + 300 * boost, t, 0.2);
    target(this.rumbleG.gain, 0.22 * k1 + 0.08 * st, t, 0.15);
    target(this.whine.frequency, 95 + 360 * k1 + 210 * st + 60 * boost, t, 0.18);
    target(this.whineLP.frequency, 700 + 1400 * Math.max(k1, st), t, 0.2);
    target(this.whineG.gain, 0.035 * st + 0.02 * k1, t, 0.1);
    target(this.rattleG.gain, 0.09 * st + 0.015 * k1, t, 0.06);
    target(this.rattleLfo.frequency, 17 + 9 * st, t, 0.3);
  }

  /** The gearbox: a clunk, then a whoosh up (dir > 0) or down. */
  shift(t: number, dir: number): void {
    const kit = this.kit;
    if (!kit) return;
    this.clunk(t, 0.5);
    const { ctx } = kit;
    const n = noiseSrc(kit, t, 0.8);
    const bp = mkFilter(ctx, 'bandpass', dir > 0 ? 300 : 2200, 1.4);
    target(bp.frequency, dir > 0 ? 2400 : 260, t + 0.02, 0.22);
    const g = mkGain(ctx, 0);
    envAD(g.gain, t, 0.24, 0.08, 0.22);
    n.connect(bp).connect(g).connect(kit.sfx);
    disposeOnEnd(n, [n, bp, g]);
  }

  /** The gear bites: two backfire pops. */
  engage(t: number): void {
    const kit = this.kit;
    if (!kit) return;
    for (let i = 0; i < 2; i++) {
      const t0 = t + i * 0.085;
      const n = noiseSrc(kit, t0, 0.2);
      const lp = mkFilter(kit.ctx, 'lowpass', 1300, 1);
      const g = mkGain(kit.ctx, 0);
      envAD(g.gain, t0, i ? 0.32 : 0.42, 0.002, 0.035);
      n.connect(lp).connect(g).connect(kit.sfx);
      disposeOnEnd(n, [n, lp, g]);
    }
  }

  /** Mach 1: the N-wave's two cracks, a sub drop, a long rumble into the reverb. */
  boom(t: number): void {
    const kit = this.kit;
    if (!kit) return;
    const { ctx } = kit;
    for (let i = 0; i < 2; i++) {
      const t0 = t + i * 0.11;
      const n = noiseSrc(kit, t0, 0.15);
      const hp = mkFilter(ctx, 'highpass', 500, 0.7);
      const lp = mkFilter(ctx, 'lowpass', 7000, 0.7);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t0, i ? 0.5 : 0.62, 0.001, 0.022);
      n.connect(hp).connect(lp).connect(g).connect(kit.sfx);
      g.connect(mkGain(ctx, 0.5)).connect(kit.sfxVerb);
      disposeOnEnd(n, [n, hp, lp, g]);
    }
    {
      const o = mkOsc(ctx, 'sine', 60);
      o.frequency.setValueAtTime(62, t);
      target(o.frequency, 27, t + 0.01, 0.25);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 0.5, 0.005, 0.45);
      o.connect(g).connect(kit.sfx);
      o.start(t);
      o.stop(t + 2);
      disposeOnEnd(o, [o, g]);
    }
    {
      const o = mkOsc(ctx, 'triangle', 120);
      o.frequency.setValueAtTime(128, t);
      target(o.frequency, 52, t + 0.006, 0.1);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 0.3, 0.003, 0.18);
      o.connect(g).connect(kit.sfx);
      o.start(t);
      o.stop(t + 1);
      disposeOnEnd(o, [o, g]);
    }
    {
      const n = noiseSrc(kit, t, 2.6, true);
      const lp = mkFilter(ctx, 'lowpass', 520, 0.9);
      target(lp.frequency, 90, t + 0.05, 0.6);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.015);
      target(g.gain, 0, t + 0.06, 0.55);
      n.connect(lp).connect(g).connect(kit.sfx);
      g.connect(mkGain(ctx, 0.8)).connect(kit.sfxVerb);
      disposeOnEnd(n, [n, lp, g]);
    }
  }

  /** Shifting past the last usable gear: a clunk and two low buzzes. */
  locked(t: number): void {
    const kit = this.kit;
    if (!kit) return;
    this.clunk(t, 0.4);
    for (let i = 0; i < 2; i++) {
      const t0 = t + 0.06 + i * 0.13;
      const o = mkOsc(kit.ctx, 'square', i ? 92 : 110);
      const lp = mkFilter(kit.ctx, 'lowpass', 600, 1);
      const g = mkGain(kit.ctx, 0);
      envAD(g.gain, t0, 0.09, 0.004, 0.05);
      o.connect(lp).connect(g).connect(kit.sfx);
      o.start(t0);
      o.stop(t0 + 0.3);
      disposeOnEnd(o, [o, lp, g]);
    }
  }

  private clunk(t: number, a: number) {
    const kit = this.kit!;
    const n = noiseSrc(kit, t, 0.12);
    const bp = mkFilter(kit.ctx, 'bandpass', 850, 2.2);
    const g = mkGain(kit.ctx, 0);
    envAD(g.gain, t, 0.5 * a, 0.002, 0.025);
    n.connect(bp).connect(g).connect(kit.sfx);
    disposeOnEnd(n, [n, bp, g]);
    const o = mkOsc(kit.ctx, 'triangle', 140);
    target(o.frequency, 70, t + 0.005, 0.03);
    const g2 = mkGain(kit.ctx, 0);
    envAD(g2.gain, t, 0.35 * a, 0.002, 0.04);
    o.connect(g2).connect(kit.sfx);
    o.start(t);
    o.stop(t + 0.25);
    disposeOnEnd(o, [o, g2]);
  }
}
