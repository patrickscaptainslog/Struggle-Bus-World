import { type Kit, disposeOnEnd, envAD, mkFilter, mkGain, mkOsc, mtof, noiseSrc } from './dsp';

// The Waterfall's sounds (src/fx/Falls.ts, behind &falls): a trickle while the runs come down, the drops' plops, and the pool's slap with a few notes
// falling after it. Synthesized one-shots on the sfx bus, start times at kit.ctx.currentTime + LOOKAHEAD, as the Comet's are.

/** The runs pouring down the tower: a bright, gurgling trickle for `secs`, swelling in and dying away. */
export function fallsTrickle(kit: Kit, t: number, secs: number): void {
  const { ctx } = kit;
  const len = Math.max(0.6, Math.min(4, secs));
  const n = noiseSrc(kit, t, len + 0.4);
  const bp = mkFilter(ctx, 'bandpass', 2400, 3.2);
  // (the gurgle: the band wanders, as water breaking over ledges)
  for (let k = 0; k <= Math.ceil(len * 9); k++) bp.frequency.setValueAtTime(kit.rng.range(1500, 4100), t + k / 9);
  const g = mkGain(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.16, t + 0.25);
  g.gain.setTargetAtTime(0, t + len * 0.75, len * 0.18);
  n.connect(bp).connect(g).connect(kit.sfx);
  const s = ctx.createGain();
  s.gain.value = 0.4;
  g.connect(s).connect(kit.sfxVerb);
  disposeOnEnd(n, [n, bp, g, s]);
}

/** One drop landing: a short pitched plop, falling. */
export function fallsPlop(kit: Kit, t: number): void {
  const { ctx } = kit;
  const f = kit.rng.range(700, 1600);
  const o = mkOsc(ctx, 'sine', f);
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.07);
  const g = mkGain(ctx, 0);
  envAD(g.gain, t, 0.07, 0.003, 0.035);
  o.connect(g).connect(kit.sfx);
  o.start(t);
  o.stop(t + 0.2);
  disposeOnEnd(o, [o, g]);
}

/** The pool lands: a wet slap, and four notes falling down the major pentatonic after it, the bloom's bell voice by ear. */
export function fallsSlap(kit: Kit, t: number): void {
  const { ctx } = kit;
  const n = noiseSrc(kit, t, 0.3);
  const lp = mkFilter(ctx, 'lowpass', 1800, 0.8);
  lp.frequency.setValueAtTime(2600, t);
  lp.frequency.exponentialRampToValueAtTime(320, t + 0.22);
  const g = mkGain(ctx, 0);
  envAD(g.gain, t, 0.4, 0.004, 0.07);
  n.connect(lp).connect(g).connect(kit.sfx);
  const nodes: AudioNode[] = [n, lp, g];
  const notes = [88, 84, 81, 76];
  notes.forEach((m, i) => {
    const at = t + 0.12 + i * 0.11;
    const o = mkOsc(ctx, 'triangle', mtof(m));
    const og = mkGain(ctx, 0);
    envAD(og.gain, at, 0.09, 0.004, 0.22);
    o.connect(og).connect(kit.sfx);
    const v = ctx.createGain();
    v.gain.value = 0.5;
    og.connect(v).connect(kit.sfxVerb);
    o.start(at);
    o.stop(at + 0.9);
    disposeOnEnd(o, [o, og, v]);
  });
  disposeOnEnd(n, nodes);
}
