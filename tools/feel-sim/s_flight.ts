// Flight feel on a flat world (real Flight + CameraRig): bank table, release counter-roll, breath while
// turning, release envelope (pitch, belly, on-screen size), frame-rate independence of the breath pose.
import { config, makeCam, MODE, save } from './lib';
import { Flight } from '@src/game/Flight';
const flat = { obstacleAt: () => 20, groundAt: () => 10 };
const steps = (f: any, dt: number, inp: any, n: number, w: any = flat) => { for (let k = 0; k < n; k++) { const s = Math.max(1, Math.ceil(dt * 120)); for (let i = 0; i < s; i++) f.step(dt / s, inp, w); } };
const mk = (full = 1) => { const f: any = new Flight(); f.y = 20 + 6.5; f.fullness = full; f.glideSpeed = 0; return f; };
const res: any = {};
const dt = 1 / 60;
// ---- (a) steady bank vs stick
const bankAt = (sx: number, sy: number, full: number, preClimb = false) => {
  const f = mk(full);
  if (preClimb) { steps(f, dt, { sx: 0, sy: -1, dragging: true }, 300); }
  steps(f, dt, { sx, sy, dragging: true }, 240);
  let lo = 1e9, hi = -1e9;
  for (let k = 0; k < 120; k++) { steps(f, dt, { sx, sy, dragging: true }, 1); lo = Math.min(lo, f.bank); hi = Math.max(hi, f.bank); }
  return { mean: +((lo + hi) / 2).toFixed(3), yaw: +f.yawRate.toFixed(2), speed: +f.speed.toFixed(0), mode: f.mode };
};
const table: any = {};
for (const full of [1, 0]) {
  const tag = full ? 'full' : 'light';
  table[`cruise-${tag}`] = [0.1, 0.3, 0.6, 1].map((sx) => bankAt(sx, 0, full));
  table[`surge-${tag}`] = [0.1, 0.3, 0.5, 0.7].map((sx) => bankAt(sx, Math.sqrt(1 - sx * sx), full));
  table[`climb-${tag}`] = [0.1, 0.3, 0.5, 0.7].map((sx) => bankAt(sx, -Math.sqrt(1 - sx * sx), full));
  table[`dive-${tag}`] = [0.1, 0.3, 0.5, 0.7].map((sx) => bankAt(sx, Math.sqrt(1 - sx * sx), full, true));
}
res.bank = table;
// ---- release counter-roll: steady full stick, then let go
const release = (sx: number, sy: number) => {
  const f = mk(0);
  steps(f, dt, { sx, sy, dragging: true }, 240);
  const b0 = f.bank;
  let opp = 0, peak = b0;
  for (let k = 0; k < 180; k++) { steps(f, dt, { sx: 0, sy: 0, dragging: false }, 1); opp = Math.min(opp, f.bank * Math.sign(b0)); peak = Math.max(peak, f.bank * Math.sign(b0)); }
  return { steady: +b0.toFixed(3), counterRoll: +opp.toFixed(3), pct: +((100 * -opp) / Math.abs(b0)).toFixed(0) };
};
res.release = { cruiseFull: release(1, 0), diagonal: release(0.7, 0.71), surge: release(0.5, 0.86) };
// slalom peak
{ const f = mk(1); let pk = 0; for (let k = 0; k < 600; k++) { steps(f, dt, { sx: Math.sign(Math.sin(k * dt * 2.2)), sy: 0, dragging: true }, 1); pk = Math.max(pk, Math.abs(f.bank)); } res.slalomPeak = +pk.toFixed(3); }
// ---- (c) breath while turning (second finger tap, full right held)
const turnBreath = () => {
  const f = mk(1);
  steps(f, dt, { sx: 1, sy: 0, dragging: true }, 120);
  const h0 = f.heading;
  f.tryBarf();
  let atImpact = 0;
  for (let k = 0; k < 60; k++) { steps(f, dt, { sx: 1, sy: 0, dragging: true }, 1); if (Math.abs((k + 1) * dt - config.splat.impactDelay) < dt / 2) atImpact = f.heading - h0; }
  return { headingAtImpactDeg: +((atImpact * 180) / Math.PI).toFixed(1), headingOverBreathDeg: +(((f.heading - h0) * 180) / Math.PI).toFixed(1) };
};
res.turnBreath = turnBreath();
// tap, re-grab 0.25 s later and carve the other way: time to reach 0.8 rad/s
{
  const f = mk(1);
  steps(f, dt, { sx: 0.6, sy: 0, dragging: true }, 120);
  steps(f, dt, { sx: 0, sy: 0, dragging: false }, 15);
  f.tryBarf();
  steps(f, dt, { sx: 0, sy: 0, dragging: false }, 15);
  let t = 0;
  while (t < 2 && f.yawRate > -0.8) { steps(f, dt, { sx: -1, sy: 0, dragging: true }, 1); t += dt; }
  res.regrabTo08 = +t.toFixed(2);
}
// ---- (b) release envelope through the chase camera: tap at cruise straight / turning / surge
const envelope = (sx: number, sy: number, dragging: boolean, dts = dt) => {
  const f = mk(1);
  const c = makeCam();
  for (let k = 0; k < 4 / dts; k++) { steps(f, dts, { sx, sy, dragging }, 1); c.update(f, dts); }
  const b0 = c.busBox(f);
  const y0 = f.y;
  f.tryBarf();
  const tl: any[] = [];
  let hi = 1, lo = 1, pmax = -1, ymax = 0, vyJump = 0, lastVy = f.vy;
  for (let k = 0; k <= 1.6 / dts; k++) {
    steps(f, dts, { sx, sy, dragging }, 1);
    c.update(f, dts);
    const b = c.busBox(f);
    const r = Math.sqrt(b.area / b0.area);
    hi = Math.max(hi, r); lo = Math.min(lo, r);
    pmax = Math.max(pmax, f.pitch); ymax = Math.max(ymax, f.y - y0);
    vyJump = Math.max(vyJump, Math.abs(f.vy - lastVy) / dts); lastVy = f.vy;
    const t = (k + 1) * dts;
    if (Math.abs(t * 20 - Math.round(t * 20)) < dts * 10 + 1e-9 && Math.round(t * 20) % 2 === 0) tl.push({ t: +t.toFixed(2), pitch: +f.pitch.toFixed(3), dy: +(f.y - y0).toFixed(2), vy: +f.vy.toFixed(1), belly: +(f.barfT >= 0 ? (f.belly ?? f.fullness) : f.fullness).toFixed(2), size: +r.toFixed(2), len: +(b.h / b0.h).toFixed(2) });
  }
  return { sizeRange: [+lo.toFixed(2), +hi.toFixed(2)], pitchMax: +pmax.toFixed(3), riseMax: +ymax.toFixed(2), peakVyAccel: +vyJump.toFixed(0), timeline: tl };
};
res.envelope = { cruise: envelope(0, 0, false), turning: envelope(0.6, 0, true), surge: envelope(0, 1, true) };
// ---- (f) frame-rate independence of one straight breath
const fr: any = {};
for (const d of [1 / 30, 1 / 60, 1 / 120]) {
  const f = mk(1);
  steps(f, d, { sx: 0.3, sy: 0, dragging: true }, Math.round(2 / d));
  f.tryBarf();
  const samp: any[] = [];
  for (let k = 1; k <= Math.round(1.5 / d); k++) { steps(f, d, { sx: 0.3, sy: 0, dragging: true }, 1); const t = k * d; if (Math.abs(t - 0.5) < d / 2 || Math.abs(t - 1.0) < d / 2 || Math.abs(t - 1.5) < d / 2) samp.push([+t.toFixed(2), +f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2), +f.pitch.toFixed(3), +f.bank.toFixed(3)]); }
  fr[(1 / d).toFixed(0)] = samp;
}
res.framerate = fr;
console.log(`[${MODE}] bank cruise-full`, JSON.stringify(table['cruise-full'].map((b: any) => b.mean)), 'surge-full', JSON.stringify(table['surge-full'].map((b: any) => b.mean)), 'climb', JSON.stringify(table['climb-full'].map((b: any) => b.mean)), 'dive', JSON.stringify(table['dive-full'].map((b: any) => b.mean)));
console.log(`[${MODE}] release`, JSON.stringify(res.release), 'slalom', res.slalomPeak);
console.log(`[${MODE}] turnBreath`, JSON.stringify(res.turnBreath), 'regrab->0.8', res.regrabTo08);
for (const k of Object.keys(res.envelope)) { const e = res.envelope[k]; console.log(`[${MODE}] envelope ${k}: size ${e.sizeRange} pitchMax ${e.pitchMax} rise ${e.riseMax} m peak dvy/dt ${e.peakVyAccel}`); }
console.log(`[${MODE}] framerate`, JSON.stringify(fr));
save('flight', res);
process.exit(0);
