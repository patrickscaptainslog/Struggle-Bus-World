// Tilt to fly, offline: synthetic deviceorientation from a physical phone (phone.ts) through the real
// TiltCore, then into the real Flight on a flat world and on the real city floor.
import { mkdirSync, writeFileSync } from 'node:fs';
import { TiltCore, OneEuro } from '@src/game/Tilt';
import { Flight } from '@src/game/Flight';
import { config } from '@src/config';
import { attitude, w3c, gauss, type Pose } from './phone';
import * as THREE from 'three';

const R = new THREE.Matrix4();
const OUT = 'shots/controls/sim';
mkdirSync(OUT, { recursive: true });
const res: Record<string, unknown> = {};
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r1 = (x: number) => Math.round(x * 10) / 10;
const HZ = 60; // iOS fires deviceorientation at the display rate

const pose = (p: Partial<Pose>): Pose => ({ lean: 35, roll: 0, pitch: 0, yaw: 0, twist: 0, screen: 0, ...p });
function sample(core: TiltCore, p: Pose, t: number, noise = 0, rnd = () => 0) {
  const e = w3c(attitude(p, R));
  core.feed(e.beta + noise * rnd(), e.gamma + noise * rnd(), p.screen, t);
  return e;
}
/** a calibrated core holding pose p (the neutral) */
function calibrated(p: Pose, t0 = 0) {
  const c = new TiltCore();
  c.calibrate();
  let t = t0;
  for (let i = 0; i < 30; i++, t += 1 / HZ) sample(c, p, t);
  return { c, t };
}
/** steady output for a held offset from the neutral */
function steady(neutral: Pose, off: Partial<Pose>) {
  const { c } = calibrated(neutral);
  let t = 0.5;
  const p = { ...neutral, ...off } as Pose;
  if (off.pitch !== undefined) p.pitch = neutral.pitch + off.pitch;
  for (let i = 0; i < 20; i++, t += 1 / HZ) sample(c, p, t);
  c.update(t);
  return { sx: r3(c.sx), sy: r3(c.sy), roll: r1(c.roll), pitch: r1(c.pitch) };
}

// ---- 1. roll and pitch sweeps from several holds (portrait, landscape, pointing up, past upright)
const holds: Record<string, Pose> = {
  'portrait-35deg': pose({ lean: 35 }),
  'portrait-flat-ish-70deg': pose({ lean: 70 }),
  'portrait-upright-0deg': pose({ lean: 0 }),
  'portrait-past-upright--12deg': pose({ lean: -12 }),
  'landscape-90-35deg': pose({ lean: 35, screen: 90 }),
  'landscape-270-35deg': pose({ lean: 35, screen: 270 }),
  'landscape-90-upright': pose({ lean: 0, screen: 90 }),
};
const sweeps: Record<string, unknown> = {};
const signErrors: string[] = [];
for (const [name, h] of Object.entries(holds)) {
  const rollRow = [-40, -30, -20, -10, -5, -2, -1, 0, 1, 2, 5, 10, 20, 30, 40].map((a) => ({ deg: a, ...steady(h, { roll: a }) }));
  const pitchRow = [-30, -20, -10, -5, -2, 0, 2, 5, 10, 20, 30].map((a) => ({ deg: a, ...steady(h, { pitch: a }) }));
  const twistRow = [-20, -10, 10, 20].map((a) => ({ deg: a, ...steady(h, { twist: a }) }));
  // signs: right edge down = +sx, top away = +sy (nose down), top toward you = -sy (climb); cross-talk small
  for (const r of rollRow) {
    if (Math.abs(r.deg) >= 5 && Math.sign(r.sx) !== Math.sign(r.deg)) signErrors.push(`${name} roll ${r.deg}: sx ${r.sx}`);
    if (Math.abs(r.sy) > 0.2) signErrors.push(`${name} roll ${r.deg}: pitch cross-talk sy ${r.sy}`);
  }
  for (const r of pitchRow) {
    if (Math.abs(r.deg) >= 5 && Math.sign(r.sy) !== Math.sign(r.deg)) signErrors.push(`${name} pitch ${r.deg}: sy ${r.sy}`);
    if (Math.abs(r.sx) > 0.05) signErrors.push(`${name} pitch ${r.deg}: roll cross-talk sx ${r.sx}`);
  }
  sweeps[name] = { roll: rollRow, pitch: pitchRow, twist: twistRow };
}
res.sweeps = sweeps;
res.signErrors = signErrors;

// ---- 2. continuous pitch sweep through upright (beta crosses 90: Euler angles flip, the stick must not)
{
  const neutral = pose({ lean: 20 });
  const { c } = calibrated(neutral);
  let t = 0.5, prev = Infinity, flips = 0, maxJump = 0;
  const rows: unknown[] = [];
  let lastE: { beta: number; gamma: number } | null = null;
  let eulerFlips = 0;
  for (let i = 0; i <= 120; i++, t += 1 / HZ) {
    const lean = 20 - i * 0.5; // 20 -> -40: past upright, top edge toward you
    const e = sample(c, { ...neutral, lean, roll: 4 }, t);
    if (lastE && Math.abs(e.gamma - lastE.gamma) > 90) eulerFlips++;
    lastE = e;
    c.update(t);
    if (prev !== Infinity) {
      maxJump = Math.max(maxJump, Math.abs(c.pitch - prev));
      if (c.pitch > prev + 0.01) flips++; // pitch must decrease monotonically (top toward you)
    }
    prev = c.pitch;
    if (i % 10 === 0) rows.push({ lean, beta: r1(e.beta), gamma: r1(e.gamma), pitch: r1(c.pitch), roll: r1(c.roll), sy: r3(c.sy), sx: r3(c.sx) });
  }
  res.throughUpright = { eulerGammaFlips: eulerFlips, nonMonotonicSteps: flips, maxPitchStepDeg: r3(maxJump), rows };
}

// ---- 3. yaw invariance: the player turns around (compass) while holding still: no output
{
  const neutral = pose({ lean: 35 });
  const { c } = calibrated(neutral);
  let t = 0.5, maxS = 0;
  for (let i = 0; i < 600; i++, t += 1 / HZ) {
    sample(c, { ...neutral, yaw: i * 0.6 }, t);
    c.update(t);
    maxS = Math.max(maxS, Math.abs(c.sx), Math.abs(c.sy));
  }
  res.yawInvariance = { yawDeg: 360, maxStick: r3(maxS) };
}

// ---- 4. jitter at rest: hand tremor + sensor noise (0.15 deg white + 0.4 deg 9 Hz tremor)
{
  const neutral = pose({ lean: 35 });
  const rnd = gauss(7);
  const { c } = calibrated(neutral);
  let t = 0.5;
  let nz = 0, n = 0, sum = 0, sum2 = 0, rawSum2 = 0;
  for (let i = 0; i < 600; i++, t += 1 / HZ) {
    const trem = 0.4 * Math.sin(2 * Math.PI * 9 * t);
    sample(c, { ...neutral, roll: trem + 0.15 * rnd(), pitch: 0.15 * rnd() }, t);
    c.update(t);
    n++;
    if (c.sx !== 0 || c.sy !== 0) nz++;
    sum += c.roll;
    sum2 += c.roll * c.roll;
    rawSum2 += c.rawRoll * c.rawRoll;
  }
  const sd = Math.sqrt(sum2 / n - (sum / n) ** 2);
  res.jitterAtRest = { frames: n, framesOutsideDeadZone: nz, rawRollStdDeg: r3(Math.sqrt(rawSum2 / n)), filteredRollStdDeg: r3(sd) };
  // the same noise around a held 12 deg carve: output steadiness
  const c2 = calibrated(neutral).c;
  t = 0.5;
  let s1 = 0, s2 = 0, m = 0;
  for (let i = 0; i < 600; i++, t += 1 / HZ) {
    const trem = 0.4 * Math.sin(2 * Math.PI * 9 * t);
    sample(c2, { ...neutral, roll: 12 + trem + 0.15 * rnd(), pitch: 0.15 * rnd() }, t);
    c2.update(t);
    if (i > 60) {
      s1 += c2.sx;
      s2 += c2.sx * c2.sx;
      m++;
    }
  }
  res.jitterHeldCarve = { roll: 12, meanSx: r3(s1 / m), sxStd: r3(Math.sqrt(s2 / m - (s1 / m) ** 2)) };
}

// ---- 5. latency: sine sweeps of roll; the frame reads the stick at 60 Hz frames offset from the samples.
// Lag = the time shift that best aligns the output angle with the true angle (pre-curve, incl. prediction).
function lagOf(freq: number, amp: number, noise: number, frameOffset: number) {
  const neutral = pose({ lean: 35 });
  const rnd = gauss(11);
  const { c } = calibrated(neutral);
  let t = 0.5;
  const outT: number[] = [], outV: number[] = [];
  const truth = (tt: number) => amp * Math.sin(2 * Math.PI * freq * (tt - 0.5));
  for (let i = 0; i < 600; i++, t += 1 / HZ) {
    sample(c, { ...neutral, roll: truth(t) + noise * rnd() }, t);
    // the frame comes frameOffset s after the sample
    const tf = t + frameOffset;
    const age = Math.min(Math.max(tf - c.lastT, 0), 0.1);
    const lead = Math.min(Math.max(age + (c as any).fRoll.tau, 0), config.tilt.predict);
    const v = c.roll + (c as any).fRoll.rate * lead;
    if (i > 120) {
      outT.push(tf);
      outV.push(v);
    }
  }
  let best = 0, bestE = Infinity;
  for (let lag = -0.05; lag <= 0.2; lag += 0.0005) {
    let e = 0;
    for (let k = 0; k < outT.length; k++) e += (outV[k] - truth(outT[k] - lag)) ** 2;
    if (e < bestE) {
      bestE = e;
      best = lag;
    }
  }
  const rms = Math.sqrt(bestE / outT.length);
  // the raw (unfiltered) signal read at the same frame: its lag is just the sample age
  return { hz: freq, ampDeg: amp, lagMs: r1(best * 1000), residualRmsDeg: r3(rms) };
}
res.latency = {
  note: 'added latency vs the true phone angle at frame time (samples 60 Hz, frames 8 ms after a sample); one 60 Hz frame = 16.7 ms',
  rows: [lagOf(0.5, 25, 0.15, 0.008), lagOf(1, 20, 0.15, 0.008), lagOf(2, 12, 0.15, 0.008), lagOf(0.25, 8, 0.15, 0.008), lagOf(1, 20, 0.15, 0.0)],
};
// filter-only reference: a plain one-pole at the rest cutoff would add this
res.latencyReference = { onePoleAtMinCutoffMs: r1(1000 / (2 * Math.PI * config.tilt.minCutoff)) };

// ---- 6. auto-recenter: a sagging wrist (6 deg of pitch held still) drifts back to neutral; a held 15 deg carve stays
function hold(off: Partial<Pose>, seconds: number) {
  const neutral = pose({ lean: 35 });
  const { c } = calibrated(neutral);
  let t = 0.5;
  const rows: unknown[] = [];
  const p = { ...neutral, ...off } as Pose;
  if (off.pitch !== undefined) p.pitch = off.pitch;
  for (let i = 0; i <= seconds * HZ; i++, t += 1 / HZ) {
    sample(c, p, t);
    c.update(t);
    if (i % HZ === 0) rows.push({ s: i / HZ, pitch: r1(c.pitch), roll: r1(c.roll), sx: r3(c.sx), sy: r3(c.sy) });
  }
  return rows;
}
res.autoRecenter = { sagPitch6: hold({ pitch: 6 }, 10), carveRoll15: hold({ roll: 15 }, 10), smallRoll2: hold({ roll: 2.5 }, 10) };

// ---- 7. manual recenter (eased) and the orientation change (portrait -> landscape mid-flight)
{
  const neutral = pose({ lean: 35 });
  const { c } = calibrated(neutral);
  let t = 0.5;
  const rows: unknown[] = [];
  for (let i = 0; i < 30; i++, t += 1 / HZ) sample(c, { ...neutral, pitch: 14 }, t);
  c.update(t);
  rows.push({ ev: 'held 14 deg nose down', sy: r3(c.sy) });
  c.recenter();
  for (let i = 0; i < 30; i++, t += 1 / HZ) {
    sample(c, { ...neutral, pitch: 14 }, t);
    c.update(t);
    if (i % 5 === 0) rows.push({ ev: `recenter +${Math.round((i * 1000) / HZ)} ms`, sy: r3(c.sy), pitch: r1(c.pitch) });
  }
  res.recenter = rows;
  // landscape: the neutral is carried into the new screen frame (the same physical pose stays neutral)
  const c2 = calibrated(neutral).c;
  t = 0.5;
  for (let i = 0; i < 30; i++, t += 1 / HZ) sample(c2, neutral, t);
  // the player turns the phone to landscape holding the same lean: screen axes change, gravity in the screen frame changes
  const rows2: unknown[] = [];
  for (let i = 0; i < 30; i++, t += 1 / HZ) sample(c2, { ...neutral, screen: 90 }, t);
  c2.update(t);
  rows2.push({ ev: 'landscape, same lean', sx: r3(c2.sx), sy: r3(c2.sy) });
  for (let i = 0; i < 20; i++, t += 1 / HZ) sample(c2, { ...neutral, screen: 90, roll: 15 }, t);
  c2.update(t);
  rows2.push({ ev: 'landscape, roll right 15', sx: r3(c2.sx), sy: r3(c2.sy) });
  res.orientationChange = rows2;
}

// ---- 8. tilt -> Flight: yaw rate and climb at the floor and at altitude (flat world, real Flight)
{
  const flat = { obstacleAt: () => 20, groundAt: () => 10 };
  const run = (stick: { sx: number; sy: number }, alt: boolean) => {
    const f = new Flight();
    f.y = 26.5;
    f.fullness = 0;
    f.glideSpeed = 0;
    const st = (inp: { sx: number; sy: number; dragging: boolean }, n: number) => {
      for (let k = 0; k < n; k++) for (let i = 0; i < 2; i++) f.step(1 / 120, inp, flat);
    };
    if (alt) {
      st({ sx: 0, sy: -1, dragging: true }, 300);
      st({ sx: 0, sy: 0, dragging: false }, 240);
    }
    const y0 = f.y;
    st({ ...stick, dragging: stick.sx !== 0 || stick.sy !== 0 }, 180);
    return { yawRate: r3(f.yawRate), bank: r3(f.bank), speed: r1(f.speed), vy: r1(f.vy), climbed3s: r1(f.y - y0), mode: f.mode };
  };
  const rows: Record<string, unknown>[] = [];
  const neutral = pose({ lean: 35 });
  for (const [label, off] of [
    ['roll 5', { roll: 5 }], ['roll 15', { roll: 15 }], ['roll 30', { roll: 30 }],
    ['pitch toward 5 (climb)', { pitch: -5 }], ['pitch toward 15', { pitch: -15 }], ['pitch toward 26', { pitch: -26 }],
    ['pitch away 5 (dive / surge)', { pitch: 5 }], ['pitch away 15', { pitch: 15 }], ['pitch away 26', { pitch: 26 }],
    ['roll 15 + toward 10', { roll: 15, pitch: -10 }],
  ] as Array<[string, Partial<Pose>]>) {
    const s = steady(neutral, off);
    rows.push({ tilt: label, sx: s.sx, sy: s.sy, floor: run(s, false), altitude: run(s, true) });
  }
  res.flight = rows;
}

// ---- 9. the One-Euro filter on its own (step response at the sample clock)
{
  const f = new OneEuro();
  let t = 0;
  f.reset(0, 0);
  const rows: unknown[] = [];
  for (let i = 1; i <= 12; i++) {
    t += 1 / HZ;
    f.filter(10, t, config.tilt.minCutoff, config.tilt.beta, config.tilt.dCutoff);
    rows.push(r3(f.value));
  }
  res.oneEuroStep10 = rows;
}

writeFileSync(`${OUT}/tilt.json`, JSON.stringify(res, null, 1));
const lat = (res.latency as { rows: Array<{ hz: number; lagMs: number; residualRmsDeg: number }> }).rows;
console.log('sign errors:', signErrors.length ? signErrors : 'none');
console.log('through upright:', JSON.stringify({ ...(res.throughUpright as object), rows: undefined }));
console.log('yaw invariance:', JSON.stringify(res.yawInvariance));
console.log('jitter at rest:', JSON.stringify(res.jitterAtRest), 'held carve:', JSON.stringify(res.jitterHeldCarve));
console.log('latency:', lat.map((r) => `${r.hz} Hz: ${r.lagMs} ms (rms ${r.residualRmsDeg} deg)`).join('; '));
console.log('portrait 35 roll:', JSON.stringify((sweeps['portrait-35deg'] as any).roll.map((r: any) => [r.deg, r.sx])));
console.log('portrait 35 pitch:', JSON.stringify((sweeps['portrait-35deg'] as any).pitch.map((r: any) => [r.deg, r.sy])));
console.log('upright roll:', JSON.stringify((sweeps['portrait-upright-0deg'] as any).roll.map((r: any) => [r.deg, r.sx])));
console.log('landscape 90 roll/pitch:', JSON.stringify((sweeps['landscape-90-35deg'] as any).roll.map((r: any) => [r.deg, r.sx])), JSON.stringify((sweeps['landscape-90-35deg'] as any).pitch.map((r: any) => [r.deg, r.sy])));
console.log('auto recenter sag 6:', JSON.stringify((res.autoRecenter as any).sagPitch6.map((r: any) => r.sy)));
console.log('auto recenter carve 15:', JSON.stringify((res.autoRecenter as any).carveRoll15.map((r: any) => r.sx)));
console.log('recenter:', JSON.stringify(res.recenter));
console.log('orientation change:', JSON.stringify(res.orientationChange));
console.log('flight:', JSON.stringify(res.flight, null, 0));
