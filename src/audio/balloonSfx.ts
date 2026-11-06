import { type Kit, disposeOnEnd, envAD, mkFilter, mkGain, mkOsc, noiseSrc } from './dsp';

// School Zone's paint balloons (src/fx/Balloons.ts): the squeak of one out of the roof hatch, and the pop of one
// bursting. Synthesized one-shots on the sfx bus, start times at kit.ctx.currentTime + LOOKAHEAD.

/** A rubbery squeak: a quick upward glide with a wobble, through a narrow band, like a balloon pushed through a hole. */
export function balloonSqueak(kit: Kit, t: number, pitch = 1): void {
  const { ctx } = kit;
  const f0 = 720 * pitch;
  const o = mkOsc(ctx, 'triangle', f0);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * 2.1, t + 0.07);
  o.frequency.exponentialRampToValueAtTime(f0 * 1.55, t + 0.16);
  const wob = mkOsc(ctx, 'sine', 38);
  const wg = mkGain(ctx, f0 * 0.06);
  wob.connect(wg).connect(o.frequency);
  const bp = mkFilter(ctx, 'bandpass', f0 * 1.8, 4);
  const g = mkGain(ctx, 0);
  envAD(g.gain, t, 0.16, 0.008, 0.06);
  o.connect(bp).connect(g).connect(kit.sfx);
  o.start(t);
  wob.start(t);
  o.stop(t + 0.3);
  wob.stop(t + 0.3);
  disposeOnEnd(o, [o, wob, wg, bp, g]);
}

/** A balloon bursting: a bright crack and a little wet tail. */
export function balloonPop(kit: Kit, t: number): void {
  const { ctx } = kit;
  const n = noiseSrc(kit, t, 0.12);
  const hp = mkFilter(ctx, 'highpass', 1800, 0.8);
  const g = mkGain(ctx, 0);
  envAD(g.gain, t, 0.34, 0.001, 0.018);
  n.connect(hp).connect(g).connect(kit.sfx);
  const s = kit.ctx.createGain();
  s.gain.value = 0.25;
  g.connect(s).connect(kit.sfxVerb);
  disposeOnEnd(n, [n, hp, g, s]);
}
