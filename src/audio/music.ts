import { clamp, disposeOnEnd, hold, Kit, kRate, mkFilter, mkGain, mkOsc, mkPan, mtof, safeStop, target } from './dsp';

// The score. Each splat advances one chord of Pachelbel's canon in D
// (I V vi iii IV I IV V — loops back to I), and every bloom in the cascade
// rings the next tone of that chord upward. Every note anywhere in the game
// comes from the current chord, so any sequence of splats is music.

export interface Chord {
  name: string;
  /** Pitch classes root, third, fifth. */
  pcs: readonly [number, number, number];
  /** Colour tone (7th / 9th / 6th) used by the hum and the sparkles. */
  color: number;
  /** Rising arpeggio (MIDI, before transpose), root first. */
  arp: readonly number[];
}

function makeChord(name: string, pcs: [number, number, number], color: number): Chord {
  // root of the arpeggio sits in F#4..F5 so leads stay in the phone-speaker sweet spot
  let root = 60 + pcs[0];
  while (root < 66) root += 12;
  while (root > 77) root -= 12;
  const off = pcs.map((pc) => (pc - pcs[0] + 12) % 12).sort((a, b) => a - b);
  const arp: number[] = [];
  for (let o = 0; o < 3; o++) for (const k of off) arp.push(root + k + 12 * o);
  return { name, pcs, color, arp };
}

export const PROGRESSION: readonly Chord[] = [
  makeChord('D', [2, 6, 9], 4), // I add9
  makeChord('A', [9, 1, 4], 11), // V add9
  makeChord('Bm', [11, 2, 6], 9), // vi7
  makeChord('F#m', [6, 9, 1], 4), // iii7
  makeChord('G', [7, 11, 2], 6), // IV maj7
  makeChord('D', [2, 6, 9], 11), // I6
  makeChord('G', [7, 11, 2], 9), // IV add9
  makeChord('A', [9, 1, 4], 7), // V7
];

/** Highest note anything in the score may play (D7, ~2.35 kHz): bright, never piercing. */
export const TOP_NOTE = 98;

/** Arpeggio tone i of a chord, shifted by `oct` octaves; wraps upward, folded below TOP_NOTE. */
export function arpNote(ch: Chord, i: number, oct = 0): number {
  const n = ch.arp.length;
  const k = Math.max(0, Math.floor(i));
  let m = ch.arp[k % n] + 12 * Math.floor(k / n) + 12 * oct;
  while (m > TOP_NOTE) m -= 12;
  return m;
}

// ------------------------------------------------------------------ bells

// Tuned-bar mallet voice (marimba/vibraphone family): a sine body, the bar's
// tuned 4th-harmonic overtone (two octaves up — consonant), a tiny 10th-
// harmonic mallet click, and an optional octave partial for escalated blooms.
// Partials decay independently: bright strike, round sine ring-out.

const PARTIALS = 4;
const P_MULT = [1, 2, 4, 10];

class Voice {
  start = -1;
  end = -1;
  readonly osc: (OscillatorNode | null)[] = [null, null, null, null];
  readonly gain: (GainNode | null)[] = [null, null, null, null];
  constructor(readonly pan: StereoPannerNode) {}
}

export class Bells {
  private readonly voices: Voice[] = [];

  constructor(private readonly kit: Kit, out: AudioNode, polyphony = 16) {
    for (let i = 0; i < polyphony; i++) {
      const p = mkPan(kit.ctx, 0);
      p.connect(out);
      this.voices.push(new Voice(p));
    }
  }

  /** Voices still ringing at time t. */
  active(t: number): number {
    let n = 0;
    for (const v of this.voices) if (v.end > t) n++;
    return n;
  }

  /**
   * Strike a bar. vel 0..1, pan -1..1, bright scales overtones, octave 0..1
   * adds the octave partial, decay scales ring-out. When every voice is busy
   * the oldest is faded out (4 ms) and reused if `steal`, else the note is skipped.
   */
  play(t: number, midi: number, vel: number, pan: number, bright: number, octave: number, decay: number, steal: boolean): boolean {
    const ctx = this.kit.ctx;
    let v: Voice | null = null;
    let oldest: Voice | null = null;
    for (const c of this.voices) {
      if (c.end <= t) {
        v = c;
        break;
      }
      if (!oldest || c.start < oldest.start) oldest = c;
    }
    if (!v) {
      if (!steal || !oldest) return false;
      v = oldest;
      this.kill(v, t);
      t += 0.014;
    }
    const f = mtof(midi) * Math.pow(2, (this.kit.rng.range(-3, 3)) / 1200);
    const a = Math.pow(clamp(vel, 0, 1.2), 1.35) * clamp(Math.pow(660 / f, 0.22), 0.62, 1.25);
    const tauBody = decay * clamp(1.05 * Math.pow(440 / f, 0.42), 0.28, 1.7);
    let end = t + 0.003 + tauBody * 6.2;
    const cap = t + 3.6;
    // overtones tilt down with pitch: high notes stay sweet, never glassy
    const tilt4 = clamp(Math.pow(900 / f, 0.7), 0.22, 1);
    const tilt10 = clamp(700 / f, 0.12, 1);
    const amps = [a * 0.2, a * 0.066 * octave, a * 0.075 * bright * tilt4, a * 0.024 * bright * tilt10];
    const taus = [tauBody, tauBody * 0.5, 0.085 * Math.pow(440 / f, 0.25), 0.017];
    const atks = [0.0028, 0.004, 0.0016, 0.0008];
    v.pan.pan.setValueAtTime(clamp(pan, -0.95, 0.95), t);
    for (let k = 0; k < PARTIALS; k++) {
      v.osc[k] = null;
      v.gain[k] = null;
      const pf = f * P_MULT[k];
      if (amps[k] < 1e-5 || pf > 11000) continue;
      const o = mkOsc(ctx, 'sine', pf);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amps[k], t + atks[k]);
      target(g.gain, 0, t + atks[k], taus[k]);
      if (end > cap) target(g.gain, 0, cap - 0.3, 0.05); // long low notes: gentle forced release
      o.connect(g).connect(v.pan);
      o.start(t);
      o.stop(Math.min(end, cap) + 0.05);
      disposeOnEnd(o, [o, g]);
      v.osc[k] = o;
      v.gain[k] = g;
    }
    if (end > cap) end = cap;
    v.start = t;
    v.end = end + 0.05;
    return true;
  }

  private kill(v: Voice, t: number): void {
    for (let k = 0; k < PARTIALS; k++) {
      const g = v.gain[k];
      const o = v.osc[k];
      if (g) {
        hold(g.gain, t);
        target(g.gain, 0, t, 0.0035);
      }
      if (o) safeStop(o, t + 0.03);
      v.gain[k] = null;
      v.osc[k] = null;
    }
    v.end = t;
  }
}

// -------------------------------------------------------------------- hum

// The painted blocks hum: four voices of a soft detuned-saw choir, voice-led
// smoothly (portamento) from chord to chord, breathing slowly. Fades in with
// the share of painted buildings near the bus.

export class Hum {
  private readonly ctx: BaseAudioContext;
  /** Oscillators exist only while the hum is audible (silent grey city costs nothing). */
  private oscA: OscillatorNode[] = [];
  private oscB: OscillatorNode[] = [];
  private readonly voiceIn: GainNode[] = [];
  private readonly midi = [50, 57, 62, 66];
  private transpose = 0;
  private readonly lp: BiquadFilterNode;
  private readonly vca: GainNode;
  private silentSince = 0;

  constructor(kit: Kit, out: AudioNode) {
    const ctx = (this.ctx = kit.ctx);
    this.lp = mkFilter(ctx, 'lowpass', 700, 0.5);
    const lp2 = mkFilter(ctx, 'lowpass', 2400, 0.5);
    const hp = mkFilter(ctx, 'highpass', 110, 0.6);
    this.vca = mkGain(ctx, 0);
    const breathe = mkGain(ctx, 1);
    const lfo = mkOsc(ctx, 'sine', 0.13);
    const lfoDepth = mkGain(ctx, 0.18);
    lfo.connect(lfoDepth).connect(breathe.gain);
    lfo.start(ctx.currentTime);
    const mix = mkGain(ctx, 1);
    for (let i = 0; i < 4; i++) {
      const vg = mkGain(ctx, i === 0 ? 0.36 : 0.32 - i * 0.03);
      vg.connect(mix);
      this.voiceIn.push(vg);
    }
    mix.connect(hp).connect(this.lp).connect(lp2).connect(breathe).connect(this.vca).connect(out);
  }

  private start(t: number): void {
    const ctx = this.ctx;
    for (let i = 0; i < 4; i++) {
      const f = mtof(this.midi[i] + this.transpose);
      const a = mkOsc(ctx, 'sawtooth', f);
      const b = mkOsc(ctx, i === 0 ? 'triangle' : 'sawtooth', f);
      a.detune.value = -6 - i;
      b.detune.value = 6 + i;
      kRate(a.frequency);
      kRate(b.frequency);
      a.connect(this.voiceIn[i]);
      b.connect(this.voiceIn[i]);
      a.start(t);
      b.start(t);
      disposeOnEnd(a, [a, b]);
      this.oscA.push(a);
      this.oscB.push(b);
    }
  }

  private stop(t: number): void {
    for (const o of this.oscA) safeStop(o, t);
    for (const o of this.oscB) safeStop(o, t);
    this.oscA = [];
    this.oscB = [];
  }

  /** Glide to a new chord with smooth voice leading. */
  setChord(ch: Chord, t: number, transpose: number): void {
    this.transpose = transpose;
    // bass: chord root in A2..G#3
    let bass = 45 + ((ch.pcs[0] - 9 + 12) % 12);
    if (bass > 56) bass -= 12;
    this.midi[0] = bass;
    // upper three voices: choose 3 distinct tones from {3rd, 5th, colour, root}
    // minimizing total motion; the third must be present.
    const cand = [ch.pcs[1], ch.pcs[2], ch.color, ch.pcs[0]];
    let best = Infinity;
    let bi = 0, bj = 1, bk = 2;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < 4; k++) {
          if (i === j || j === k || i === k) continue;
          if (i !== 0 && j !== 0 && k !== 0) continue; // keep the third
          const cost =
            Math.abs(nearest(cand[i], this.midi[1]) - this.midi[1]) +
            Math.abs(nearest(cand[j], this.midi[2]) - this.midi[2]) +
            Math.abs(nearest(cand[k], this.midi[3]) - this.midi[3]) +
            (i === 3 || j === 3 || k === 3 ? 1.5 : 0);
          if (cost < best) {
            best = cost;
            bi = i;
            bj = j;
            bk = k;
          }
        }
    this.midi[1] = fold(nearest(cand[bi], this.midi[1]));
    this.midi[2] = fold(nearest(cand[bj], this.midi[2]));
    this.midi[3] = fold(nearest(cand[bk], this.midi[3]));
    for (let v = 0; v < this.oscA.length; v++) {
      const f = mtof(this.midi[v] + transpose);
      hold(this.oscA[v].frequency, t);
      hold(this.oscB[v].frequency, t);
      target(this.oscA[v].frequency, f, t, 0.11 + v * 0.02);
      target(this.oscB[v].frequency, f, t, 0.11 + v * 0.02);
    }
  }

  /** Continuous level (0..~0.1) and brightness (0..1). */
  set(t: number, level: number, bright: number): void {
    if (level > 1e-4) {
      if (!this.oscA.length) this.start(t); // vca is at ~0 here: fades in from silence
      this.silentSince = t;
    } else if (this.oscA.length && t - this.silentSince > 3) this.stop(t); // 3 s >> the 0.45 s fade
    target(this.vca.gain, level, t, 0.45);
    target(this.lp.frequency, 380 + 900 * bright, t, 0.4);
  }
}

function nearest(pc: number, around: number): number {
  const base = around - ((((around - pc) % 12) + 12) % 12);
  return around - base > 6 ? base + 12 : base;
}

function fold(m: number): number {
  while (m < 55) m += 12;
  while (m > 72) m -= 12;
  return m;
}
