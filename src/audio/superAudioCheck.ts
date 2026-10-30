import { AudioEngine, type AudioFrame } from './AudioEngine';
import { config } from '../config';

// QA (window.__game.superAudioCheck(), loaded on demand, never in play): renders a scripted super splat
// session through the real AudioEngine graph on an OfflineAudioContext and reports its levels:
//   0.5 s   a full charge (riser + heartbeat over config.splat.superCharge s)
//   10.5 s  the firehose (roar + crescendo), an impact bell 12 times a second, the finale blast + its arpeggio
//   16 s    "not yet" (x2), 17 s a charge cancelled at 2.5 s (power-down), 20.5 s ready (chime)
//   21.5 s  a charge released at 50 % (26.5 s): the mega blast (heave, thunder, its boom 0.42 s later)
// Pass = peak < 0.95, nothing over 0.99, no NaN.

export interface SuperAudioReport {
  seconds: number;
  peak: number;
  peakAt: number;
  over099: number;
  nan: number;
  rmsDb: number[];
  pass: boolean;
}

export async function superAudioCheck(seconds = 29): Promise<SuperAudioReport> {
  const SR = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const eng = new AudioEngine();
  eng.attachContext(ctx, 5);
  const full = config.splat.superCharge;
  const ev: Array<[number, () => void]> = [];
  const at = (t: number, f: () => void) => ev.push([t, f]);
  at(0.5, () => eng.superChargeStart(full));
  at(0.5 + full, () => eng.superFirehose(config.splat.firehoseDuration));
  for (let t = 0.85 + full; t < 0.5 + full + config.splat.firehoseDuration; t += 1 / 12) at(t, () => eng.superHoseHit());
  const fin = 0.85 + full + config.splat.firehoseDuration;
  at(fin, () => {
    eng.splatImpact(2);
    eng.bloomBurst(30, 2, 3);
  });
  at(16, () => eng.superFizzle());
  at(16.4, () => eng.superFizzle());
  at(17, () => eng.superChargeStart(full));
  at(19.5, () => eng.superChargeStop(false));
  at(20.5, () => eng.superReady());
  at(21.5, () => eng.superChargeStart(full));
  at(21.5 + full * 0.5, () => {
    eng.superChargeStop(true);
    eng.heave();
    eng.superMega(0.5);
  });
  at(21.5 + full * 0.5 + 0.42, () => {
    eng.splatImpact(1.46);
    eng.bloomBurst(40, 4, 1);
  });
  ev.sort((a, b) => a[0] - b[0]);
  const frame: AudioFrame = { speed: 28, surge: 0, fullness: 1, altitude: 30, paintNearby: 0.3, fogBank: 0 };
  const step = 512 / SR;
  let k = 1, ei = 0;
  const tick = (t: number, dt: number) => {
    frame.fullness = t > 10.5 && t < 16 ? 0 : 1;
    frame.speed = t > 10.5 && t < 15 ? 11 : 28;
    eng.update(dt, frame);
    while (ei < ev.length && ev[ei][0] <= t + step * 0.5) ev[ei++][1]();
  };
  tick(0, 0);
  const next = () => {
    const t = k * step;
    if (t >= seconds - step) return;
    ctx.suspend(t).then(() => {
      tick(t, step);
      k++;
      next();
      ctx.resume();
    });
  };
  next();
  const buf = await ctx.startRendering();
  let peak = 0, peakAt = 0, over = 0, nan = 0;
  const rms: number[] = [];
  const n = buf.length;
  const sums = new Float64Array(Math.ceil(seconds));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) {
        nan++;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) {
        peak = a;
        peakAt = i / SR;
      }
      if (a > 0.99) over++;
      sums[Math.floor(i / SR)] += v * v;
    }
  }
  for (let s = 0; s < sums.length; s++) rms.push(+(10 * Math.log10(sums[s] / (SR * buf.numberOfChannels) + 1e-12)).toFixed(1));
  return { seconds, peak: +peak.toFixed(3), peakAt: +peakAt.toFixed(2), over099: over, nan, rmsDb: rms, pass: peak < 0.95 && over === 0 && nan === 0 };
}
