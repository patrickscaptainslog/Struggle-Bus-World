// Sweep the One-Euro / prediction parameters: worst lag over a set of sine sweeps vs jitter at rest.
import { TiltCore } from '@src/game/Tilt';
import { config } from '@src/config';
import { attitude, w3c, gauss } from './phone';
import * as THREE from 'three';
const R = new THREE.Matrix4();
const HZ = 60;
const base = { lean: 35, roll: 0, pitch: 0, yaw: 0, screen: 0 };
function run(truth: (t: number) => number, noise: number, seed: number, frameOff: number) {
  const rnd = gauss(seed);
  const c = new TiltCore(); c.calibrate();
  let t = 0;
  for (let i = 0; i < 30; i++, t += 1 / HZ) { const e = w3c(attitude(base, R)); c.feed(e.beta, e.gamma, 0, t); }
  const T: number[] = [], V: number[] = [];
  for (let i = 0; i < 720; i++, t += 1 / HZ) {
    const tr = 0.4 * Math.sin(2 * Math.PI * 9 * t);
    const e = w3c(attitude({ ...base, roll: truth(t) + noise * rnd() + tr * (noise > 0 ? 1 : 0) }, R));
    c.feed(e.beta, e.gamma, 0, t);
    const tf = t + frameOff;
    const age = Math.min(Math.max(tf - c.lastT, 0), 0.1);
    const f: any = (c as any).fRoll;
    const v = c.roll + f.rate * Math.min(Math.max(age + f.tau, 0), config.tilt.predict);
    if (i > 120) { T.push(tf); V.push(v); }
  }
  return { T, V };
}
function lag(freq: number, amp: number) {
  const truth = (t: number) => amp * Math.sin(2 * Math.PI * freq * t);
  const { T, V } = run(truth, 0.15, 3, 0.008);
  let best = 0, bestE = Infinity;
  for (let l = -0.06; l <= 0.2; l += 0.0005) { let e = 0; for (let k = 0; k < T.length; k++) e += (V[k] - truth(T[k] - l)) ** 2; if (e < bestE) { bestE = e; best = l; } }
  return best * 1000;
}
function restStd() {
  const { V } = run(() => 0, 0.15, 5, 0.008);
  const m = V.reduce((a, b) => a + b, 0) / V.length;
  return Math.sqrt(V.reduce((a, b) => a + (b - m) ** 2, 0) / V.length);
}
function carveStd() {
  const { V } = run(() => 12, 0.15, 9, 0.008);
  const m = V.reduce((a, b) => a + b, 0) / V.length;
  return Math.sqrt(V.reduce((a, b) => a + (b - m) ** 2, 0) / V.length);
}
const rows: any[] = [];
for (const minCutoff of [1.6, 2.2, 3]) for (const beta of [0.18, 0.3, 0.5]) for (const dCutoff of [1.2, 2.5]) for (const predict of [0.02, 0.035, 0.05]) {
  Object.assign(config.tilt, { minCutoff, beta, dCutoff, predict });
  const lags = [[0.25, 8], [0.5, 25], [1, 20], [2, 12], [3, 6]].map(([f, a]) => lag(f, a));
  rows.push({ minCutoff, beta, dCutoff, predict, lagMax: +Math.max(...lags.map(Math.abs)).toFixed(1), lags: lags.map((x) => +x.toFixed(1)), rest: +restStd().toFixed(3), carve: +carveStd().toFixed(3) });
}
rows.sort((a, b) => a.lagMax - b.lagMax);
for (const r of rows.slice(0, 25)) console.log(JSON.stringify(r));
