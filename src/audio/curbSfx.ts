import { type Kit, disposeOnEnd, envAD, mkFilter, mkGain, mkOsc, noiseSrc } from './dsp';

// Curb, the bus on the street (src/game/CurbFlight.ts): the tyres' chirp on touching down, the boing of a hop with no street under it, two toots
// passing a car, and the indicator's ticks when the look takes the next junction. Synthesized one-shots on the sfx bus, as balloonSfx's, start
// times at kit.ctx.currentTime + LOOKAHEAD. No loop: the bus's own engine is the street's sound.

/** The tyres touching down: a short squeal falling in pitch, with the thump of the springs. `k` 0..1, how hard it came down: louder and longer. */
export function curbChirp(kit: Kit, t: number, k = 0.5): void {
  const { ctx } = kit;
  const g0 = 0.12 + 0.16 * k, len = 0.09 + 0.08 * k;
  // (the squeal: rubber on asphalt, a narrow band of noise sliding down)
  const n = noiseSrc(kit, t, len + 0.15);
  const bp = mkFilter(ctx, 'bandpass', 2600, 9);
  bp.frequency.setValueAtTime(2600 + 600 * k, t);
  bp.frequency.exponentialRampToValueAtTime(1500, t + len);
  const g = mkGain(ctx, 0);
  envAD(g.gain, t, g0, 0.004, len * 0.45);
  n.connect(bp).connect(g).connect(kit.sfx);
  // (the springs taking the weight: a low thump)
  const o = mkOsc(ctx, 'sine', 110);
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(52, t + 0.12);
  const og = mkGain(ctx, 0);
  envAD(og.gain, t, 0.22 + 0.2 * k, 0.003, 0.05);
  o.connect(og).connect(kit.sfx);
  o.start(t);
  o.stop(t + 0.3);
  disposeOnEnd(n, [n, bp, g]);
  disposeOnEnd(o, [o, og]);
}

/** No street there: a springy boing, up then wobbling down. */
export function curbBoing(kit: Kit, t: number): void {
  const { ctx } = kit;
  const o = mkOsc(ctx, 'triangle', 180);
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(420, t + 0.06);
  o.frequency.exponentialRampToValueAtTime(150, t + 0.38);
  const wob = mkOsc(ctx, 'sine', 14);
  const wg = mkGain(ctx, 26);
  wob.connect(wg).connect(o.frequency);
  const lp = mkFilter(ctx, 'lowpass', 1400, 2);
  const g = mkGain(ctx, 0);
  envAD(g.gain, t, 0.3, 0.006, 0.14);
  o.connect(lp).connect(g).connect(kit.sfx);
  o.start(t);
  wob.start(t);
  o.stop(t + 0.6);
  wob.stop(t + 0.6);
  disposeOnEnd(o, [o, wob, wg, lp, g]);
}

/** Rolling on past a car: a school bus's two toots, a fifth apart's blare through a horn's narrow throat. */
export function curbToot(kit: Kit, t: number): void {
  const { ctx } = kit;
  const nodes: AudioNode[] = [];
  let last: OscillatorNode | null = null;
  for (let i = 0; i < 2; i++) {
    const at = t + i * 0.2;
    for (const f of [392, 494]) {
      const o = mkOsc(ctx, 'sawtooth', f);
      const bp = mkFilter(ctx, 'bandpass', 900, 1.6);
      const g = mkGain(ctx, 0);
      envAD(g.gain, at, 0.08, 0.012, 0.05);
      g.gain.setTargetAtTime(0, at + 0.12, 0.02);
      o.connect(bp).connect(g).connect(kit.sfx);
      o.start(at);
      o.stop(at + 0.25);
      nodes.push(o, bp, g);
      last = o;
    }
  }
  if (last) disposeOnEnd(last, nodes);
}

/** The indicator: tick, tock, three times, as the look takes the next junction. */
export function curbTicks(kit: Kit, t: number): void {
  const { ctx } = kit;
  const nodes: AudioNode[] = [];
  let last: AudioScheduledSourceNode | null = null;
  for (let i = 0; i < 6; i++) {
    const at = t + i * 0.33;
    const n = noiseSrc(kit, at, 0.03);
    const bp = mkFilter(ctx, 'bandpass', i % 2 ? 2400 : 3200, 6);
    const g = mkGain(ctx, 0);
    envAD(g.gain, at, 0.16, 0.001, 0.008);
    n.connect(bp).connect(g).connect(kit.sfx);
    nodes.push(n, bp, g);
    last = n;
  }
  if (last) disposeOnEnd(last, nodes);
}
