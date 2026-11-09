// The Parade's honks (Parade.ts), a stand-in on the audio kit until the first account voices them (HOOKS.md): a small car's meep-meep as it falls in, each
// car's a step up a five-note scale by its place in the line, so six joining sing up it; a seventh, with the line full, one flat low note.
import { type Kit, disposeOnEnd, envAD, mkFilter, mkGain, mkOsc } from '../audio/dsp';

/** Semitones over C5 by the place in the line. */
const STEPS = [0, 2, 4, 7, 9, 12];

/** A car's honk at `t`: `n` its place in the line from 0, or -1 the seventh's; `seed` 0..255, its own few cents off. */
export function paradeHonk(kit: Kit, t: number, n: number, seed: number): void {
  const { ctx } = kit, full = n < 0;
  const base = (full ? 330 : 523.25 * 2 ** (STEPS[n % STEPS.length] / 12)) * 2 ** ((seed / 255 - 0.5) / 30);
  const nodes: AudioNode[] = [];
  let last: OscillatorNode | null = null;
  for (let i = 0; i < (full ? 1 : 2); i++) {
    const at = t + i * 0.13, len = full ? 0.22 : 0.07;
    // (two reeds a third apart, a flat one a semitone: the low honk sours)
    for (const f of [base, base * (full ? 1.06 : 1.26)]) {
      const o = mkOsc(ctx, 'square', f);
      const bp = mkFilter(ctx, 'bandpass', full ? 700 : 1800, 1.2);
      const g = mkGain(ctx, 0);
      envAD(g.gain, at, 0.07, 0.008, 0.04);
      g.gain.setTargetAtTime(0, at + len, 0.015);
      o.connect(bp).connect(g).connect(kit.sfx);
      o.start(at);
      o.stop(at + len + 0.12);
      nodes.push(o, bp, g);
      last = o;
    }
  }
  if (last) disposeOnEnd(last, nodes);
}
