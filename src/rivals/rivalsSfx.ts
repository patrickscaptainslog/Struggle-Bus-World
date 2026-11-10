// The rival buses' sounds (rivalsBoot.ts), stand-ins on the audio kit until the first account voices them (docs/specs/shots/HOOKS.md): a rival's honk before it
// starts on the player, a ram's clang by how hard it was, and the head-on's boom.
import { type Kit, disposeOnEnd, envAD, mkFilter, mkGain, mkOsc, noiseSrc, target } from '../audio/dsp';

/** A bus's horn at `t`: two long notes a fourth apart, `seed` (0..1) its own pitch. An old air horn, flat and a little sour. */
export function rivalHonk(kit: Kit, t: number, seed: number, gain = 0.09): void {
  const { ctx } = kit, base = 196 * 2 ** ((seed - 0.5) / 4);
  const nodes: AudioNode[] = [];
  let last: OscillatorNode | null = null;
  for (let i = 0; i < 2; i++) {
    const at = t + i * 0.24, len = i ? 0.42 : 0.16;
    for (const f of [base, base * 1.335, base * 2.01]) {
      const o = mkOsc(ctx, 'sawtooth', f), lp = mkFilter(ctx, 'lowpass', 1500, 0.9), g = mkGain(ctx, 0);
      envAD(g.gain, at, gain / 3, 0.015, 0.5);
      target(g.gain, 0, at + len, 0.03);
      o.connect(lp).connect(g).connect(kit.sfx);
      o.start(at);
      o.stop(at + len + 0.25);
      nodes.push(o, lp, g);
      last = o;
    }
  }
  if (last) disposeOnEnd(last, nodes);
}

/** Two buses meet at `t`: a bump's clang (tier 0), a smash's crunch (1), a wreck's (2), each lower and longer, with glass and a rattle after. */
export function ramClang(kit: Kit, t: number, tier: number): void {
  const { ctx } = kit, k = Math.max(0, Math.min(3, tier));
  // (the body: a struck sheet of metal, three partials that don't agree)
  const nodes: AudioNode[] = [];
  let last: OscillatorNode | null = null;
  for (const [f, a] of [[210 - 38 * k, 1], [342 - 50 * k, 0.6], [533 - 60 * k, 0.4]] as const) {
    const o = mkOsc(ctx, 'triangle', f), g = mkGain(ctx, 0);
    envAD(g.gain, t, (0.12 + 0.05 * k) * a, 0.003, 0.09 + 0.07 * k);
    target(o.frequency, f * 0.82, t, 0.2);
    o.connect(g).connect(kit.sfx);
    o.connect(g).connect(kit.sfxVerb);
    o.start(t);
    o.stop(t + 1.2 + 0.4 * k);
    nodes.push(o, g);
    last = o;
  }
  // (the crunch, and from a smash up the glass)
  const n = noiseSrc(kit, t, 0.6 + 0.3 * k), bp = mkFilter(ctx, 'bandpass', 900 - 150 * k, 0.8), ng = mkGain(ctx, 0);
  envAD(ng.gain, t, 0.1 + 0.06 * k, 0.002, 0.06 + 0.05 * k);
  n.connect(bp).connect(ng).connect(kit.sfx);
  nodes.push(n, bp, ng);
  if (k >= 1) {
    const s = noiseSrc(kit, t + 0.05, 0.7), hp = mkFilter(ctx, 'highpass', 5200, 0.7), sg = mkGain(ctx, 0);
    envAD(sg.gain, t + 0.05, 0.035 + 0.015 * k, 0.004, 0.16);
    s.connect(hp).connect(sg).connect(kit.sfx);
    nodes.push(s, hp, sg);
  }
  if (last) disposeOnEnd(last, nodes);
}

/** The head-on at `t`: everything goes quiet under one long drop, then the air comes back. */
export function headOnBoom(kit: Kit, t: number): void {
  const { ctx } = kit;
  const o = mkOsc(ctx, 'sine', 120), g = mkGain(ctx, 0), n = noiseSrc(kit, t, 2.6, true), lp = mkFilter(ctx, 'lowpass', 2400, 0.7), ng = mkGain(ctx, 0);
  envAD(g.gain, t, 0.5, 0.004, 0.55);
  target(o.frequency, 31, t, 0.22);
  o.connect(g).connect(kit.sfx);
  o.start(t);
  o.stop(t + 2.8);
  envAD(ng.gain, t, 0.3, 0.006, 0.7);
  target(lp.frequency, 260, t, 0.5);
  n.connect(lp).connect(ng).connect(kit.sfx);
  ng.connect(kit.sfxVerb);
  disposeOnEnd(o, [o, g, n, lp, ng]);
  ramClang(kit, t, 3);
}
