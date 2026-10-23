import type { AudioTune } from './tune';
import { Chord, arpNote } from './music';
import { clamp, disposeOnEnd, envAD, Kit, mkFilter, mkGain, mkOsc, mkPan, mtof, noiseSrc, target } from './dsp';

// One-shot effects. Each call builds a tiny private graph from fresh nodes,
// schedules it entirely ahead of time and lets it dispose itself when done.
// Pitched effects take their notes from the current chord so they are always
// in key with the score.

export class Sfx {
  private lastDenied = -10;

  constructor(private readonly kit: Kit) {}

  /**
   * Tap accepted (frame 0). "Hurk" (breathy onset, voiced gag, glottal stop),
   * a rising gulp that lands on the impact at +0.35 s, then the geyser: a wet
   * glugging gush with a chiptune glitter of in-key pixel sparkles riding it,
   * and the recoil whoosh as it lets go.
   */
  heave(t: number, next: Chord, transpose: number, tune: AudioTune): void {
    const { ctx } = this.kit;
    const T = tune.splat;
    const out = this.kit.sfx;
    const verb = this.kit.sfxVerb;

    // "h"
    {
      const n = noiseSrc(this.kit, t, 0.1);
      const f = mkFilter(ctx, 'bandpass', 1500, 1.2);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 0.34 * T, 0.006, 0.022);
      n.connect(f).connect(g).connect(out);
      disposeOnEnd(n, [n, f, g]);
    }
    // voiced "urk": glottal saw through two moving formants, choked off
    {
      const o = mkOsc(ctx, 'sawtooth', 130);
      o.frequency.setValueAtTime(132, t);
      target(o.frequency, 78, t + 0.02, 0.07);
      const f1 = mkFilter(ctx, 'bandpass', 760, 5);
      const f2 = mkFilter(ctx, 'bandpass', 1300, 6);
      target(f1.frequency, 430, t + 0.05, 0.06);
      target(f2.frequency, 860, t + 0.05, 0.06);
      const g2 = mkGain(ctx, 0.55);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t + 0.012);
      g.gain.linearRampToValueAtTime(0.95 * T, t + 0.034);
      target(g.gain, 0.62 * T, t + 0.06, 0.05);
      target(g.gain, 0, t + 0.165, 0.016);
      const throat = mkFilter(ctx, 'lowpass', 2200, 0.7);
      o.connect(throat);
      throat.connect(f1).connect(g);
      throat.connect(f2).connect(g2).connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.4);
      disposeOnEnd(o, [o, throat, f1, f2, g2, g]);
    }
    // "k"
    {
      const n = noiseSrc(this.kit, t + 0.17, 0.05);
      const f = mkFilter(ctx, 'bandpass', 2600, 1.1);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t + 0.17, 0.2 * T, 0.002, 0.01);
      n.connect(f).connect(g).connect(out);
      disposeOnEnd(n, [n, f, g]);
    }
    // gulp: a bubble rising up the throat, lands on the impact
    {
      const o = mkOsc(ctx, 'sine', 170);
      o.frequency.setValueAtTime(170, t + 0.17);
      o.frequency.exponentialRampToValueAtTime(560, t + 0.33);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t + 0.17);
      g.gain.linearRampToValueAtTime(0.13 * T, t + 0.27);
      target(g.gain, 0, t + 0.315, 0.012);
      o.connect(g).connect(out);
      o.start(t + 0.17);
      o.stop(t + 0.5);
      disposeOnEnd(o, [o, g]);
    }
    // the geyser: wet glugging gush (bandpassed noise, 7 Hz glug) + weight underneath
    {
      const t0 = t + 0.24;
      const n = noiseSrc(this.kit, t0, 1.5);
      const f = mkFilter(ctx, 'bandpass', 1150, 0.8);
      f.frequency.setValueAtTime(1300, t0);
      target(f.frequency, 620, t0 + 0.05, 0.45);
      const glug = mkGain(ctx, 0.7);
      const lfo = mkOsc(ctx, 'sine', 7.2);
      lfo.frequency.setValueAtTime(8.5, t0);
      target(lfo.frequency, 5.5, t0, 0.5);
      const lfoG = mkGain(ctx, 0.3);
      lfo.connect(lfoG).connect(glug.gain);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.5 * T, t0 + 0.07);
      target(g.gain, 0.34 * T, t0 + 0.12, 0.3);
      target(g.gain, 0, t0 + 0.78, 0.11);
      const low = mkFilter(ctx, 'lowpass', 420, 0.7);
      const lowG = mkGain(ctx, 0.9);
      n.connect(f).connect(glug).connect(g);
      n.connect(low).connect(lowG).connect(g);
      g.connect(out);
      g.connect(mkGain(ctx, 0.35)).connect(verb);
      lfo.start(t0);
      lfo.stop(t0 + 1.5);
      disposeOnEnd(n, [n, f, glug, lfo, lfoG, g, low, lowG]);
    }
    // pixel glitter: staccato square blips stepping through the NEXT chord, high up
    {
      const t0 = t + 0.33;
      const steps = 22;
      const step = 0.038;
      const o = mkOsc(ctx, 'square', 2000);
      const hp = mkFilter(ctx, 'bandpass', 2600, 0.6);
      const g = mkGain(ctx, 0);
      const p = mkPan(ctx, 0);
      const r = this.kit.rng;
      let idx = 3 + Math.floor(r.next() * 2);
      g.gain.setValueAtTime(0, t0);
      for (let i = 0; i < steps; i++) {
        const ts = t0 + i * step + r.range(-0.004, 0.004);
        idx = clamp(idx + (r.next() < 0.6 ? 1 : -1) * (r.next() < 0.3 ? 2 : 1), 3, 8);
        o.frequency.setValueAtTime(mtof(arpNote(next, idx) + transpose), ts);
        p.pan.setValueAtTime(r.range(-0.75, 0.75), ts);
        const fade = 1 - i / steps;
        target(g.gain, 0.03 * T * (0.55 + 0.45 * r.next()) * (0.4 + 0.6 * fade), ts + 0.001, 0.0015);
        target(g.gain, 0, ts + 0.011, 0.01);
      }
      o.connect(hp).connect(g).connect(p);
      p.connect(out);
      p.connect(mkGain(ctx, 0.7)).connect(verb);
      o.start(t0);
      o.stop(t0 + steps * step + 0.2);
      disposeOnEnd(o, [o, hp, g, p]);
    }
    // recoil: relief whoosh as the geyser lets go
    {
      const t0 = t + 0.96;
      const n = noiseSrc(this.kit, t0, 0.9);
      const f = mkFilter(ctx, 'bandpass', 500, 1.4);
      f.frequency.setValueAtTime(450, t0);
      target(f.frequency, 1900, t0 + 0.02, 0.16);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.16 * T, t0 + 0.14);
      target(g.gain, 0, t0 + 0.15, 0.12);
      n.connect(f).connect(g).connect(out);
      disposeOnEnd(n, [n, f, g]);
    }
  }

  /**
   * Geyser hits the first building: a bright wet crack sweeping down, a
   * squelchy splatter, a pitch-dropping "bwomp" body, a soft low thump, and
   * droplets pattering down around it.
   */
  splat(t: number, strength: number, tune: AudioTune): void {
    const { ctx } = this.kit;
    const s = clamp(strength, 0, 1.5);
    const a = (0.55 + 0.45 * s) * 0.72 * tune.splat;
    const out = this.kit.sfx;
    const verb = this.kit.sfxVerb;
    const r = this.kit.rng;
    // wet crack
    {
      const n = noiseSrc(this.kit, t, 0.7);
      const f = mkFilter(ctx, 'bandpass', 3000, 0.9);
      f.frequency.setValueAtTime(3200 + 900 * s, t);
      target(f.frequency, 520, t + 0.004, 0.045);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 1.05 * a, 0.0015, 0.075);
      n.connect(f).connect(g).connect(out);
      g.connect(mkGain(ctx, 0.3)).connect(verb);
      disposeOnEnd(n, [n, f, g]);
    }
    // squelch: low-passed noise chopped into a wet "splrrt"
    {
      const n = noiseSrc(this.kit, t, 0.9);
      const f = mkFilter(ctx, 'lowpass', 1500, 1.4);
      target(f.frequency, 600, t + 0.01, 0.12);
      const chop = mkGain(ctx, 0.55);
      const lfo = mkOsc(ctx, 'triangle', 31);
      const lfoG = mkGain(ctx, 0.45);
      lfo.connect(lfoG).connect(chop.gain);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t + 0.006, 0.8 * a, 0.004, 0.13);
      n.connect(f).connect(chop).connect(g).connect(out);
      lfo.start(t);
      lfo.stop(t + 0.9);
      disposeOnEnd(n, [n, f, chop, lfo, lfoG, g]);
    }
    // body: pitch-dropping bwomp
    {
      const o = mkOsc(ctx, 'sine', 420);
      o.frequency.setValueAtTime(430 + 80 * s, t);
      target(o.frequency, 88, t + 0.002, 0.032);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 0.28 * a, 0.0012, 0.085);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.8);
      disposeOnEnd(o, [o, g]);
    }
    // thump (+ an octave-up triangle so phone speakers feel it)
    {
      const o = mkOsc(ctx, 'sine', 78);
      o.frequency.setValueAtTime(80, t);
      target(o.frequency, 47, t + 0.004, 0.06);
      const o2 = mkOsc(ctx, 'triangle', 156);
      o2.frequency.setValueAtTime(160, t);
      target(o2.frequency, 94, t + 0.004, 0.05);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 0.3 * a, 0.003, 0.14);
      const g2 = mkGain(ctx, 0);
      envAD(g2.gain, t, 0.16 * a, 0.003, 0.09);
      o.connect(g).connect(out);
      o2.connect(g2).connect(out);
      o.start(t);
      o2.start(t);
      o.stop(t + 1.3);
      o2.stop(t + 1.0);
      disposeOnEnd(o, [o, o2, g, g2]);
    }
    // droplets: one oscillator, a handful of falling "plips" scattered around
    {
      const o = mkOsc(ctx, 'sine', 1800);
      const g = mkGain(ctx, 0);
      const p = mkPan(ctx, 0);
      g.gain.setValueAtTime(0, t);
      let tk = t + 0.07;
      const drops = 5 + Math.floor(r.next() * 3);
      for (let k = 0; k < drops; k++) {
        const fk = r.range(1250, 2700);
        o.frequency.setValueAtTime(fk, tk);
        target(o.frequency, fk * 0.58, tk + 0.001, 0.014);
        p.pan.setValueAtTime(r.range(-0.8, 0.8), tk);
        target(g.gain, (0.085 - k * 0.008) * a, tk + 0.001, 0.0012);
        target(g.gain, 0, tk + 0.006, 0.013);
        tk += r.range(0.045, 0.1);
      }
      o.connect(g).connect(p);
      p.connect(out);
      p.connect(mkGain(ctx, 0.4)).connect(verb);
      o.start(t);
      o.stop(tk + 0.2);
      disposeOnEnd(o, [o, g, p]);
    }
  }

  /** Belly full again: a tiny bright in-key "bloop-bip". */
  ready(t: number, ch: Chord, transpose: number, tune: AudioTune): void {
    const { ctx } = this.kit;
    const out = this.kit.sfx;
    const verb = this.kit.sfxVerb;
    const notes = [arpNote(ch, 3), arpNote(ch, 5)];
    for (let i = 0; i < 2; i++) {
      const t0 = t + i * 0.085;
      const f = mtof(notes[i] + transpose);
      const o = mkOsc(ctx, 'sine', f);
      o.frequency.setValueAtTime(f * 0.48, t0);
      target(o.frequency, f, t0 + 0.002, 0.016);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t0, (i ? 0.06 : 0.11) * tune.splat, 0.004, i ? 0.05 : 0.07);
      o.connect(g).connect(out);
      g.connect(mkGain(ctx, 0.6)).connect(verb);
      o.start(t0);
      o.stop(t0 + 0.6);
      disposeOnEnd(o, [o, g]);
    }
  }

  /** Tapped while recharging: a soft wet sputter. Rate-limited, softer when spammed. */
  denied(t: number, tune: AudioTune): void {
    if (t - this.lastDenied < 0.12) return;
    const rep = t - this.lastDenied < 0.7 ? 0.6 : 1;
    this.lastDenied = t;
    const { ctx } = this.kit;
    const out = this.kit.sfx;
    const a = rep * tune.splat;
    {
      const n = noiseSrc(this.kit, t, 0.45);
      const f = mkFilter(ctx, 'lowpass', 900, 0.9);
      target(f.frequency, 450, t + 0.02, 0.12);
      const chop = mkGain(ctx, 0.5);
      const lfo = mkOsc(ctx, 'sine', 19);
      const lfoG = mkGain(ctx, 0.5);
      lfo.connect(lfoG).connect(chop.gain);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 0.3 * a, 0.006, 0.075);
      n.connect(f).connect(chop).connect(g).connect(out);
      lfo.start(t);
      lfo.stop(t + 0.45);
      disposeOnEnd(n, [n, f, chop, lfo, lfoG, g]);
    }
    {
      const o = mkOsc(ctx, 'triangle', 220);
      o.frequency.setValueAtTime(230, t);
      target(o.frequency, 118, t + 0.005, 0.06);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 0.09 * a, 0.004, 0.065);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.5);
      disposeOnEnd(o, [o, g]);
    }
  }

  /** Street sign springs out of the ground: in-key "boinggg" + a woodblock tick as it locks. */
  signPop(t: number, ch: Chord, transpose: number, tune: AudioTune): void {
    const { ctx } = this.kit;
    const out = this.kit.sfx;
    const verb = this.kit.sfxVerb;
    const T = tune.splat;
    {
      const f = mtof(arpNote(ch, 2) - 12 + transpose);
      const o = mkOsc(ctx, 'triangle', f);
      o.frequency.setValueAtTime(f * 0.6, t);
      target(o.frequency, f, t + 0.002, 0.024);
      const vib = mkOsc(ctx, 'sine', 15);
      vib.frequency.setValueAtTime(15, t);
      target(vib.frequency, 8.5, t, 0.3);
      const depth = mkGain(ctx, 0);
      depth.gain.setValueAtTime(f * 0.11, t);
      target(depth.gain, 0, t + 0.01, 0.16);
      vib.connect(depth).connect(o.frequency);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 0.2 * T, 0.003, 0.17);
      o.connect(g).connect(out);
      g.connect(mkGain(ctx, 0.25)).connect(verb);
      o.start(t);
      vib.start(t);
      o.stop(t + 1.2);
      vib.stop(t + 1.2);
      disposeOnEnd(o, [o, vib, depth, g]);
    }
    // release "tk"
    {
      const n = noiseSrc(this.kit, t, 0.04);
      const f = mkFilter(ctx, 'highpass', 3500, 0.7);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 0.18 * T, 0.0005, 0.005);
      n.connect(f).connect(g).connect(out);
      disposeOnEnd(n, [n, f, g]);
    }
    // lock "tick": a little woodblock
    {
      const t0 = t + 0.24;
      const o = mkOsc(ctx, 'sine', 2300);
      o.frequency.setValueAtTime(2450, t0);
      target(o.frequency, 2150, t0 + 0.001, 0.01);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t0, 0.1 * T, 0.0007, 0.014);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + 0.2);
      disposeOnEnd(o, [o, g]);
    }
  }
}
