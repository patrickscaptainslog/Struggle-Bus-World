// The skid's sounds and the long swipe's (swerveBoot.ts), stand-ins on the audio kit until the first account voices them (docs/specs/shots/HOOKS.md): tyres
// squealing in mid-air while the bus slides, an air brake's hiss as it grips, and a longer one with a clunk when the long swipe brakes it.
import { type Kit, disposeOnEnd, envAD, mkFilter, mkGain, mkOsc, noiseSrc, safeStop, target } from '../audio/dsp';

/** The longest a squeal sounds (s): a doughnut held past it slides on in the wind. */
const SQUEAL_MAX = 6;

/** A squeal from `t` until the returned stop is called (`speed` 0..1: faster is higher). Two reeds a hair apart through a narrow band, wobbling, over a hiss. */
export function skidSqueal(kit: Kit, t: number, speed: number): (at: number) => void {
  const { ctx } = kit, f0 = 1150 + 650 * Math.min(1, Math.max(0, speed));
  const a = mkOsc(ctx, 'sawtooth', f0), b = mkOsc(ctx, 'sawtooth', f0 * 1.017), lfo = mkOsc(ctx, 'sine', 9.5);
  const wob = mkGain(ctx, f0 * 0.035), band = mkFilter(ctx, 'bandpass', f0 * 1.6, 7), out = mkGain(ctx, 0);
  const n = noiseSrc(kit, t, SQUEAL_MAX + 0.5), nBand = mkFilter(ctx, 'bandpass', f0 * 2.4, 2.5), nGain = mkGain(ctx, 0.35);
  lfo.connect(wob);
  wob.connect(a.frequency);
  wob.connect(b.frequency);
  a.connect(band);
  b.connect(band);
  n.connect(nBand).connect(nGain).connect(band);
  band.connect(out).connect(kit.sfx);
  out.gain.setValueAtTime(0, t);
  target(out.gain, 0.045, t, 0.03);
  // (it sags as the slide scrubs the speed off)
  target(a.frequency, f0 * 0.82, t + 0.1, 0.9);
  target(b.frequency, f0 * 0.82 * 1.017, t + 0.1, 0.9);
  for (const o of [a, b, lfo]) {
    o.start(t);
    o.stop(t + SQUEAL_MAX + 0.5);
  }
  target(out.gain, 0, t + SQUEAL_MAX, 0.12);
  disposeOnEnd(a, [a, b, lfo, wob, band, out, n, nBand, nGain]);
  return (at) => {
    target(out.gain, 0, at, 0.035);
    for (const o of [a, b, lfo, n]) safeStop(o, at + 0.3);
  };
}

/** An air brake letting go at `t`: `len` s of hiss falling away, `gain` its loudness. */
export function airHiss(kit: Kit, t: number, len: number, gain: number): void {
  const { ctx } = kit;
  const n = noiseSrc(kit, t, len + 0.4), hp = mkFilter(ctx, 'highpass', 2600, 0.7), bp = mkFilter(ctx, 'bandpass', 5200, 0.9), g = mkGain(ctx, 0);
  n.connect(hp).connect(bp).connect(g).connect(kit.sfx);
  envAD(g.gain, t, gain, 0.012, len * 0.4);
  target(bp.frequency, 3000, t, len * 0.5);
  disposeOnEnd(n, [n, hp, bp, g]);
}

/** The long swipe: a low clunk as the stop arm goes out, then the brakes' hiss. */
export function brakeClunk(kit: Kit, t: number): void {
  const { ctx } = kit;
  const o = mkOsc(ctx, 'triangle', 150), g = mkGain(ctx, 0);
  o.connect(g).connect(kit.sfx);
  envAD(g.gain, t, 0.22, 0.004, 0.05);
  target(o.frequency, 62, t, 0.035);
  o.start(t);
  o.stop(t + 0.4);
  disposeOnEnd(o, [o, g]);
  airHiss(kit, t + 0.03, 0.7, 0.07);
}
