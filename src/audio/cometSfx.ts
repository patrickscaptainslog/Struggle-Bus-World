import { type Kit, disposeOnEnd, envAD, mkFilter, mkGain, mkOsc, noiseSrc } from './dsp';

// The Comet's sounds (src/fx/CometFx.ts): its whoosh off the mouth, and the boom that comes late, when the sound of its landing reaches the bus.
// Synthesized one-shots on the sfx bus, start times at kit.ctx.currentTime + LOOKAHEAD, as the balloons' are.

/** Off the mouth: a rising, tearing whoosh, a fifth of a second. k ~1 (the full show), less for the lighter one. */
export function cometLaunch(kit: Kit, t: number, k = 1): void {
  const { ctx } = kit;
  const n = noiseSrc(kit, t, 0.4);
  const bp = mkFilter(ctx, 'bandpass', 700, 2.2);
  bp.frequency.setValueAtTime(700, t);
  bp.frequency.exponentialRampToValueAtTime(5200, t + 0.28);
  const g = mkGain(ctx, 0);
  envAD(g.gain, t, 0.3 * k, 0.03, 0.3);
  n.connect(bp).connect(g).connect(kit.sfx);
  const s = ctx.createGain();
  s.gain.value = 0.3;
  g.connect(s).connect(kit.sfxVerb);
  disposeOnEnd(n, [n, bp, g, s]);
}

/**
 * The late boom: a sharp crack over a low rumble that rolls on for a second. k: the blast's strength (its radius over the tap's); soft: the lighter
 * show's, half as loud and no crack. moon: no air, so no crack and no roll, only a short thump through the ground.
 */
export function cometBoom(kit: Kit, t: number, k = 1, soft = false, moon = false): void {
  const { ctx } = kit;
  const a = Math.min(1.4, Math.max(0.4, k)) * (soft ? 0.5 : 1);
  const nodes: AudioNode[] = [];
  if (!moon && !soft) {
    const c = noiseSrc(kit, t, 0.09);
    const hp = mkFilter(ctx, 'highpass', 900, 0.7);
    const cg = mkGain(ctx, 0);
    envAD(cg.gain, t, 0.5 * a, 0.002, 0.06);
    c.connect(hp).connect(cg).connect(kit.sfx);
    nodes.push(c, hp, cg);
  }
  const len = moon ? 0.35 : 1.4;
  const r = noiseSrc(kit, t, len);
  const lp = mkFilter(ctx, 'lowpass', moon ? 160 : 260, 0.9);
  lp.frequency.setValueAtTime(moon ? 160 : 420, t);
  lp.frequency.exponentialRampToValueAtTime(70, t + len);
  const rg = mkGain(ctx, 0);
  envAD(rg.gain, t, 0.6 * a, 0.01, len * 0.8);
  r.connect(lp).connect(rg).connect(kit.sfx);
  const o = mkOsc(ctx, 'sine', moon ? 70 : 52);
  o.frequency.setValueAtTime(moon ? 70 : 58, t);
  o.frequency.exponentialRampToValueAtTime(moon ? 38 : 31, t + len);
  const og = mkGain(ctx, 0);
  envAD(og.gain, t, 0.55 * a, 0.006, len * 0.7);
  o.connect(og).connect(kit.sfx);
  o.start(t);
  o.stop(t + len + 0.1);
  nodes.push(r, lp, rg, o, og);
  if (!moon) {
    const v = ctx.createGain();
    v.gain.value = 0.35;
    rg.connect(v).connect(kit.sfxVerb);
    nodes.push(v);
  }
  disposeOnEnd(o, nodes);
}
