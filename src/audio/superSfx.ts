import type { Chord } from './music';
import { arpNote } from './music';
import { clamp, disposeOnEnd, envAD, hold, type Kit, mkFilter, mkGain, mkOsc, mkPan, mtof, noiseSrc, safeStop, tanhCurve, target } from './dsp';
import { registerTunables } from '../ui/tunables';

// The super splat's sounds (src/game/SuperSplat.ts drives them through
// AudioEngine): the charge's riser and heartbeat, the cancel's power-down, the
// mega blast's thunder, the firehose's roaring bed with its closing crescendo
// and the arpeggio its impacts ring, the "not yet" fizzle and the ready chime.
//
// Long sounds (the riser, the heartbeat, the roar) are a handful of nodes for
// their whole length, scheduled ahead as automation at the start (no per-frame
// work), all into one private bus that a stop fades and tears down. Pitched
// parts take the current chord, so the whole thing stays in key with the score.

export const superAudioTune = {
  /** Overall level of the super splat's sounds. */
  level: 1,
  riser: 1,
  heart: 1,
  roar: 1,
  chime: 1,
};

registerTunables('SuperAudio', superAudioTune, {
  level: [0, 2, 0.05],
  riser: [0, 2, 0.05],
  heart: [0, 2, 0.05],
  roar: [0, 2, 0.05],
  chime: [0, 2, 0.05],
});

/** Seconds between heartbeats at a charge (0..1): a slow thud that races as the charge fills (the bus throbs with it). */
export function heartInterval(charge: number): number {
  return 0.86 - 0.6 * Math.pow(clamp(charge, 0, 1), 1.25);
}

export interface SuperVoice {
  /** the score's current chord and transpose (semitones) */
  chord(): Chord;
  transpose(): number;
  /** ring a mallet bell (the score's own) */
  bell(t: number, midi: number, vel: number, pan: number): void;
}

interface Held {
  bus: GainNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

export class SuperSfx {
  private charge: Held | null = null;
  private chargeT0 = 0;
  private chargeFull = 10;
  private riserFrom = 0;
  private hose: Held | null = null;
  private hoseStep = 0;
  private lastHit = -10;
  private lastFizzle = -10;

  constructor(private readonly kit: Kit, private readonly voice: SuperVoice) {}

  private open(gain: number): Held {
    const { ctx } = this.kit;
    const bus = mkGain(ctx, gain);
    bus.connect(this.kit.sfx);
    bus.connect(mkGain(ctx, 0.35)).connect(this.kit.sfxVerb);
    return { bus, srcs: [], nodes: [bus] };
  }

  private close(h: Held, t: number, tau: number) {
    hold(h.bus.gain, t);
    target(h.bus.gain, 0, t, tau);
    const end = t + tau * 8 + 0.05;
    for (const s of h.srcs) safeStop(s, end);
    const last = h.srcs[h.srcs.length - 1];
    if (last) disposeOnEnd(last, h.nodes);
  }

  /**
   * The charge begins (it will be full `full` s after t): a two-octave riser (detuned saws through a
   * resonant sweep, and a hiss climbing above it) and a heartbeat that races as it fills.
   */
  chargeStart(t: number, full: number): void {
    if (this.charge) this.close(this.charge, t, 0.02);
    const { ctx } = this.kit;
    const A = superAudioTune;
    const h = this.open(0.9 * A.level);
    this.charge = h;
    this.chargeT0 = t;
    this.chargeFull = Math.max(0.5, full);
    const end = t + this.chargeFull;
    const tr = this.voice.transpose();
    const root = arpNote(this.voice.chord(), 0) + tr;
    this.riserFrom = root - 24;
    // riser: two detuned saws, two octaves up over the charge, through a resonant lowpass opening up
    {
      const lp = mkFilter(ctx, 'lowpass', 300, 6);
      lp.frequency.setValueAtTime(260, t);
      lp.frequency.exponentialRampToValueAtTime(5200, end);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 * A.riser, t + 0.6);
      g.gain.linearRampToValueAtTime(0.2 * A.riser, end);
      for (const det of [-9, 11]) {
        const o = mkOsc(ctx, 'sawtooth', mtof(this.riserFrom));
        o.detune.value = det;
        o.frequency.setValueAtTime(mtof(this.riserFrom), t);
        o.frequency.exponentialRampToValueAtTime(mtof(this.riserFrom + 24), end);
        o.connect(lp);
        o.start(t);
        h.srcs.push(o);
        h.nodes.push(o);
      }
      // a fast tremolo that tightens with the charge: the engine straining
      const trem = mkOsc(ctx, 'triangle', 5);
      trem.frequency.setValueAtTime(5, t);
      trem.frequency.linearRampToValueAtTime(19, end);
      const tg = mkGain(ctx, 0.35);
      const depth = mkGain(ctx, 0);
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(0.3, end);
      trem.connect(depth).connect(tg.gain);
      lp.connect(tg).connect(g).connect(h.bus);
      trem.start(t);
      h.srcs.push(trem);
      h.nodes.push(lp, g, tg, depth, trem);
    }
    // hiss: white noise through a highpass sweeping up, swelling to the end
    {
      const n = noiseSrc(this.kit, t, this.chargeFull + 1.5);
      const hp = mkFilter(ctx, 'bandpass', 400, 1.2);
      hp.frequency.setValueAtTime(380, t);
      hp.frequency.exponentialRampToValueAtTime(7400, end);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.13 * A.riser, end);
      n.connect(hp).connect(g).connect(h.bus);
      h.srcs.push(n);
      h.nodes.push(n, hp, g);
    }
    // heartbeat: lub-dub, one sine thump (+ an octave-up triangle a phone can play) automated per beat
    {
      const o = mkOsc(ctx, 'sine', 58);
      const o2 = mkOsc(ctx, 'triangle', 116);
      const g = mkGain(ctx, 0);
      const g2 = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t);
      g2.gain.setValueAtTime(0, t);
      let tb = t + 0.05;
      while (tb < end - 0.05) {
        const c = (tb - t) / this.chargeFull;
        const a = (0.5 + 0.5 * c) * 0.55 * A.heart;
        for (let k = 0; k < 2; k++) {
          const tk = tb + k * (0.13 - 0.04 * c);
          const ak = a * (k ? 0.62 : 1);
          o.frequency.setValueAtTime(66 + 10 * c, tk);
          o.frequency.setTargetAtTime(41, tk + 0.003, 0.05);
          o2.frequency.setValueAtTime(132 + 20 * c, tk);
          o2.frequency.setTargetAtTime(84, tk + 0.003, 0.04);
          g.gain.setValueAtTime(0, tk);
          g.gain.linearRampToValueAtTime(ak, tk + 0.006);
          g.gain.setTargetAtTime(0, tk + 0.006, 0.07);
          g2.gain.setValueAtTime(0, tk);
          g2.gain.linearRampToValueAtTime(ak * 0.45, tk + 0.005);
          g2.gain.setTargetAtTime(0, tk + 0.005, 0.045);
        }
        tb += heartInterval(c);
      }
      o.connect(g).connect(h.bus);
      o2.connect(g2).connect(h.bus);
      o.start(t);
      o2.start(t);
      h.srcs.push(o, o2);
      h.nodes.push(o, o2, g, g2);
    }
    // the last stretch: chord tones shimmering above it all (tremolo bells), tightening
    {
      const ch = this.voice.chord();
      const t0 = t + this.chargeFull * 0.62;
      for (let i = 0, tk = t0; tk < end - 0.05; i++) {
        const c = (tk - t) / this.chargeFull;
        this.voice.bell(tk, arpNote(ch, 4 + (i % 4)) + tr, (0.12 + 0.18 * c) * A.level, (i % 2 ? 0.45 : -0.45));
        tk += 0.34 - 0.24 * c;
      }
    }
  }

  /** The charge ends: fired (cut straight into the blast) or cancelled (a sad power-down from wherever the riser got to). */
  chargeStop(t: number, fired: boolean): void {
    const h = this.charge;
    if (!h) return;
    this.charge = null;
    this.close(h, t, fired ? 0.015 : 0.06);
    if (fired) return;
    const { ctx } = this.kit;
    const c = clamp((t - this.chargeT0) / this.chargeFull, 0, 1);
    const from = mtof(this.riserFrom + 24 * c);
    const o = mkOsc(ctx, 'sawtooth', from);
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, from * 0.18), t + 0.55);
    const lp = mkFilter(ctx, 'lowpass', 2400, 3);
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.55);
    const g = mkGain(ctx, 0);
    envAD(g.gain, t, (0.08 + 0.1 * c) * superAudioTune.level, 0.01, 0.2);
    o.connect(lp).connect(g).connect(this.kit.sfx);
    o.start(t);
    o.stop(t + 0.9);
    disposeOnEnd(o, [o, lp, g]);
  }

  /** The mega blast (released early at charge k): thunder under the blast's own boom (the impact plays that). */
  mega(t: number, k: number): void {
    const { ctx } = this.kit;
    const a = (0.5 + 0.5 * k) * superAudioTune.level;
    // crack: a bright noise snap falling into a rolling rumble
    const n = noiseSrc(this.kit, t, 2.6);
    const bp = mkFilter(ctx, 'bandpass', 5200, 0.7);
    bp.frequency.setValueAtTime(5200, t);
    bp.frequency.exponentialRampToValueAtTime(180, t + 1.4);
    const g = mkGain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * a, t + 0.004);
    target(g.gain, 0.16 * a, t + 0.03, 0.08);
    target(g.gain, 0, t + 0.5, 0.55);
    n.connect(bp).connect(g).connect(this.kit.sfx);
    g.connect(mkGain(ctx, 0.8)).connect(this.kit.sfxVerb);
    // a deep "WHOOM": a pitch drop an octave under the boom
    const o = mkOsc(ctx, 'sine', 90);
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 1.1);
    const og = mkGain(ctx, 0);
    envAD(og.gain, t, 0.5 * a, 0.01, 0.45);
    o.connect(og).connect(this.kit.sfx);
    o.start(t);
    o.stop(t + 2.2);
    disposeOnEnd(n, [n, bp, g]);
    disposeOnEnd(o, [o, og]);
  }

  /**
   * The firehose pours for `dur` s: a roaring bed (a distorted chord drone under rushing noise with a
   * gushing tremolo) that swells into a crescendo over its last second; its end cuts into the finale blast.
   */
  firehose(t: number, dur: number): void {
    this.chargeStop(t, true);
    if (this.hose) this.close(this.hose, t, 0.02);
    const { ctx } = this.kit;
    const A = superAudioTune;
    const h = this.open(A.level * A.roar);
    this.hose = h;
    this.hoseStep = 0;
    const end = t + Math.max(0.3, dur);
    const cres = Math.max(t + 0.2, end - 1.1);
    const ch = this.voice.chord();
    const tr = this.voice.transpose();
    // the drone: chord root, fifth and an octave, three saws through a soft clipper and a lowpass
    {
      const shaper = ctx.createWaveShaper();
      shaper.curve = tanhCurve(3.2);
      const lp = mkFilter(ctx, 'lowpass', 900, 1.1);
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.linearRampToValueAtTime(1300, cres);
      lp.frequency.exponentialRampToValueAtTime(4200, end);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.05);
      g.gain.setValueAtTime(0.16, cres);
      g.gain.linearRampToValueAtTime(0.26, end);
      const notes = [arpNote(ch, 0) - 24, arpNote(ch, 2) - 24, arpNote(ch, 0) - 12];
      for (const m of notes) {
        const f0 = mtof(m + tr);
        const o = mkOsc(ctx, 'sawtooth', f0);
        o.frequency.setValueAtTime(f0, cres);
        o.frequency.exponentialRampToValueAtTime(f0 * Math.pow(2, 7 / 12), end);
        o.connect(shaper);
        o.start(t);
        h.srcs.push(o);
        h.nodes.push(o);
      }
      shaper.connect(lp).connect(g).connect(h.bus);
      h.nodes.push(shaper, lp, g);
    }
    // the rush: pink noise, a gushing 7 Hz tremolo, the band opening up at the crescendo
    {
      const n = noiseSrc(this.kit, t, dur + 1.2, true);
      const bp = mkFilter(ctx, 'bandpass', 700, 0.6);
      bp.frequency.setValueAtTime(600, t);
      bp.frequency.setValueAtTime(600, cres);
      bp.frequency.exponentialRampToValueAtTime(3000, end);
      const gush = mkGain(ctx, 0.7);
      const lfo = mkOsc(ctx, 'sine', 7);
      const lg = mkGain(ctx, 0.3);
      lfo.connect(lg).connect(gush.gain);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.75, t + 0.04);
      g.gain.setValueAtTime(0.6, cres);
      g.gain.linearRampToValueAtTime(0.95, end);
      n.connect(bp).connect(gush).connect(g).connect(h.bus);
      lfo.start(t);
      h.srcs.push(n, lfo);
      h.nodes.push(n, bp, gush, lfo, lg, g);
    }
    // sub: the ground shaking under it
    {
      const o = mkOsc(ctx, 'sine', 40);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.32, t + 0.08);
      g.gain.linearRampToValueAtTime(0.42, end);
      o.connect(g).connect(h.bus);
      o.start(t);
      h.srcs.push(o);
      h.nodes.push(o, g);
    }
    // it stops dead at the end (the finale's boom takes over)
    this.close(h, end, 0.03);
    this.hose = null;
  }

  /** One impact of the firehose: a bell climbing the chord, a little faster than the ear can count, capped. */
  hoseHit(t: number): void {
    if (t - this.lastHit < 0.1) return;
    this.lastHit = t;
    const i = this.hoseStep++;
    const ch = this.voice.chord();
    const idx = 2 + (i % 9);
    this.voice.bell(t, arpNote(ch, idx) + this.voice.transpose(), 0.22 * superAudioTune.level, ((i * 0.37) % 1.4) - 0.7);
  }

  /** "Not yet": a damp firework that won't light (a falling buzz, a crackle, a pfft). Rate-limited. */
  fizzle(t: number): void {
    if (t - this.lastFizzle < 0.25) return;
    this.lastFizzle = t;
    const { ctx } = this.kit;
    const a = superAudioTune.level;
    {
      const o = mkOsc(ctx, 'square', 320);
      o.frequency.setValueAtTime(330, t);
      o.frequency.exponentialRampToValueAtTime(92, t + 0.32);
      const lp = mkFilter(ctx, 'lowpass', 1400, 2);
      target(lp.frequency, 300, t + 0.02, 0.12);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t, 0.07 * a, 0.005, 0.11);
      o.connect(lp).connect(g).connect(this.kit.sfx);
      o.start(t);
      o.stop(t + 0.6);
      disposeOnEnd(o, [o, lp, g]);
    }
    {
      const n = noiseSrc(this.kit, t + 0.04, 0.5);
      const hp = mkFilter(ctx, 'highpass', 2600, 0.8);
      const chop = mkGain(ctx, 0.5);
      const lfo = mkOsc(ctx, 'square', 23);
      const lg = mkGain(ctx, 0.5);
      lfo.connect(lg).connect(chop.gain);
      const g = mkGain(ctx, 0);
      envAD(g.gain, t + 0.04, 0.12 * a, 0.004, 0.09);
      const p = mkPan(ctx, 0.2);
      n.connect(hp).connect(chop).connect(g).connect(p).connect(this.kit.sfx);
      lfo.start(t + 0.04);
      lfo.stop(t + 0.6);
      disposeOnEnd(n, [n, hp, chop, lfo, lg, g, p]);
    }
  }

  /** Ready again: a rising in-key chime (three bells and a sparkle on top). */
  ready(t: number): void {
    const ch = this.voice.chord();
    const tr = this.voice.transpose();
    const a = superAudioTune.chime * superAudioTune.level;
    const idx = [2, 4, 7, 9];
    for (let i = 0; i < idx.length; i++) this.voice.bell(t + i * 0.075, arpNote(ch, idx[i]) + tr, (0.42 - 0.05 * i) * a, -0.5 + i * 0.33);
    const { ctx } = this.kit;
    const o = mkOsc(ctx, 'sine', 3000);
    const g = mkGain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    for (let k = 0; k < 6; k++) {
      const tk = t + 0.3 + k * 0.05;
      o.frequency.setValueAtTime(mtof(arpNote(ch, 9 + (k % 3)) + 12 + tr), tk);
      g.gain.setValueAtTime(0, tk);
      g.gain.linearRampToValueAtTime(0.03 * a, tk + 0.002);
      g.gain.setTargetAtTime(0, tk + 0.002, 0.012);
    }
    o.connect(g).connect(this.kit.sfx);
    g.connect(mkGain(ctx, 0.8)).connect(this.kit.sfxVerb);
    o.start(t);
    o.stop(t + 0.9);
    disposeOnEnd(o, [o, g]);
  }
}
