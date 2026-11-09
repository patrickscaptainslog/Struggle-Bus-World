import { type Kit, disposeOnEnd, envAD, mkFilter, mkGain, mkOsc, noiseSrc } from './dsp';

// The Lob's sounds (src/game/Lob.ts, its looks in src/fx/CometFx.ts): a mortar's thunk off the mouth and a whistle that climbs with it and falls with it over
// its whole flight, then the whump where it lands, at most config.lob.boomLate s late. Synthesized one-shots on the sfx bus, as the Comet's are.

/** Off the mouth: the thunk of a mortar tube, and the whistle up over the climb and down over the fall, `travel` s long. k ~1 (the full show). */
export function lobLaunch(kit: Kit, t: number, travel: number, k = 1): void {
  const { ctx } = kit;
  const nodes: AudioNode[] = [];
  // the thunk: a low sine dropping fast under a short puff of noise
  const o = mkOsc(ctx, 'sine', 120);
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
  const og = mkGain(ctx, 0);
  envAD(og.gain, t, 0.7 * k, 0.003, 0.09);
  o.connect(og).connect(kit.sfx);
  o.start(t);
  o.stop(t + 0.4);
  const n = noiseSrc(kit, t, 0.12);
  const lp = mkFilter(ctx, 'lowpass', 900, 0.8);
  const ng = mkGain(ctx, 0);
  envAD(ng.gain, t, 0.35 * k, 0.002, 0.04);
  n.connect(lp).connect(ng).connect(kit.sfx);
  nodes.push(o, og, n, lp, ng);
  // the whistle: up to its top as it climbs, then the long fall down to where it lands, fading in and out so neither end clicks
  const T = Math.max(0.6, travel), top = t + 0.08 + T * 0.45, end = t + 0.08 + T;
  const w = mkOsc(ctx, 'triangle', 700);
  w.frequency.setValueAtTime(700, t + 0.08);
  w.frequency.exponentialRampToValueAtTime(1500, top);
  w.frequency.exponentialRampToValueAtTime(420, end);
  const bp = mkFilter(ctx, 'bandpass', 1100, 1.4);
  const wg = mkGain(ctx, 0);
  wg.gain.setValueAtTime(0, t + 0.08);
  wg.gain.linearRampToValueAtTime(0.07 * k, t + 0.3);
  wg.gain.linearRampToValueAtTime(0.05 * k, top);
  wg.gain.linearRampToValueAtTime(0.1 * k, end - 0.12);
  wg.gain.linearRampToValueAtTime(0, end);
  w.connect(bp).connect(wg).connect(kit.sfx);
  const v = ctx.createGain();
  v.gain.value = 0.25;
  wg.connect(v).connect(kit.sfxVerb);
  w.start(t + 0.08);
  w.stop(end + 0.05);
  nodes.push(w, bp, wg, v);
  disposeOnEnd(w, nodes);
}

/** Where it lands: a big soft whump, a low thud under a wet slap, rolling on half a second. k: the blast's strength; moon: no air, only the thud. */
export function lobWhump(kit: Kit, t: number, k = 1, moon = false): void {
  const { ctx } = kit;
  const a = Math.min(1.4, Math.max(0.4, k));
  const nodes: AudioNode[] = [];
  const o = mkOsc(ctx, 'sine', 64);
  o.frequency.setValueAtTime(moon ? 80 : 64, t);
  o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
  const og = mkGain(ctx, 0);
  envAD(og.gain, t, 0.75 * a, 0.004, 0.35);
  o.connect(og).connect(kit.sfx);
  o.start(t);
  o.stop(t + 0.9);
  nodes.push(o, og);
  if (!moon) {
    const n = noiseSrc(kit, t, 0.7);
    const lp = mkFilter(ctx, 'lowpass', 1400, 0.9);
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.6);
    const ng = mkGain(ctx, 0);
    envAD(ng.gain, t, 0.5 * a, 0.006, 0.22);
    n.connect(lp).connect(ng).connect(kit.sfx);
    const vg = ctx.createGain();
    vg.gain.value = 0.4;
    ng.connect(vg).connect(kit.sfxVerb);
    nodes.push(n, lp, ng, vg);
  }
  disposeOnEnd(o, nodes);
}
