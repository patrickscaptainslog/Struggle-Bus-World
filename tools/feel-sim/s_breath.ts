// Anticipation (squash, inhale, jet launch, impact, hit-stop) at 30/60/120 fps, and the jet's speed profile.
import { newCity, pump, ll, makeGame, MODE, config, save } from './lib';
import { fxTune } from '@src/fx/Particles';
const city = await newCity();
const [x0, z0] = ll(37.7762, -122.438);
await pump(city, x0, z0);
const res: any = {};
for (const d of [1 / 30, 1 / 60, 1 / 120]) {
  const g = makeGame(city);
  const f = g.flight;
  f.x = x0; f.z = z0; f.heading = Math.PI / 2; f.y = city.obstacleAt(x0, z0) + 9;
  for (let k = 0; k < 1.5 / d; k++) g.frame(d, { sx: 0, sy: 0, dragging: false });
  f.fullness = 1;
  for (let k = 0; k < 0.3 / d; k++) g.frame(d, { sx: 0, sy: 0, dragging: false });
  const t0 = g.t;
  const e0 = g.events.length;
  g.tap();
  const sq0 = g.squash; // what the very next rendered frame shows (set on the tap)
  let sqMin = 9, sqMinT = 0, sq01 = 0, sq02 = 0;
  const frames: any[] = [];
  for (let k = 0; k < 1.0 / d; k++) {
    g.frame(d, { sx: 0, sy: 0, dragging: false });
    const t = g.t - t0;
    if (g.squash < sqMin) { sqMin = g.squash; sqMinT = t; }
    if (Math.abs(t - 0.1) < d / 2 + 1e-9) sq01 = g.squash;
    if (Math.abs(t - 0.2) < d / 2 + 1e-9) sq02 = g.squash;
    frames.push(+t.toFixed(4));
  }
  const ev = g.events.slice(e0).map((e) => [e.ev, +(e.t - t0).toFixed(3)]);
  res[(1 / d).toFixed(0)] = { tapFrameSquash: +sq0.toFixed(3), squashMin: +sqMin.toFixed(3), squashMinAt: +sqMinT.toFixed(3), squashAt01: +sq01.toFixed(3), squashAt02: +sq02.toFixed(3), events: ev };
}
console.log(`[${MODE}] anticipation`, JSON.stringify(res));
// jet speed along the ribbon's Hermite centerline: |dC/ds| / T at s = 0, 0.25, 0.5, 0.75, 1 (m/s)
const T = fxTune as any;
const prof = (busV: number, chordH: number, dy: number, tt: number) => {
  // mouth at origin moving +x at busV; target at (chordH, dy)
  const C = [chordH, dy];
  let D0: number[], D1: number[];
  if (MODE === 'base') {
    D0 = [(busV * T.inherit + T.forwardOut) * tt, (T.doorUp - T.blast) * tt];
    D1 = [busV * T.inherit * 0.25 * tt, -T.arrive * tt];
  } else {
    D0 = [T.jetOut * chordH, (T.jetOut * dy) + T.doorUp * tt];
    D1 = [T.jetIn * chordH, T.jetIn * dy - T.jetDrop * tt];
  }
  const sp = (s: number) => {
    const a = 6 * s * s - 6 * s, b = 3 * s * s - 4 * s + 1, c = 6 * s - 6 * s * s, e = 3 * s * s - 2 * s;
    const vx = b * D0[0] + c * C[0] + e * D1[0], vy = b * D0[1] + c * C[1] + e * D1[1];
    return +(Math.hypot(vx, vy) / tt).toFixed(0);
  };
  let apex = 0;
  for (let s = 0; s <= 1; s += 0.01) { const h00 = 2 * s ** 3 - 3 * s * s + 1, h10 = s ** 3 - 2 * s * s + s, h01 = -2 * s ** 3 + 3 * s * s, h11 = s ** 3 - s * s; const y = h10 * D0[1] + h01 * C[1] + h11 * D1[1]; apex = Math.max(apex, y - (C[1] * h01)); void h00; }
  return { speed: [0, 0.25, 0.5, 0.75, 1].map(sp), bulgeM: +apex.toFixed(1) };
};
const tt = MODE === 'base' ? config.splat.impactDelay : config.splat.impactDelay - config.splat.inhale;
const jet = { cruise: prof(30, 87, -9, tt), surge: prof(112, 128, -9, tt), hover: prof(15, 79, -9, tt), altitude250: prof(30, 690, -250, tt + 0.5) };
console.log(`[${MODE}] jet profile (m/s at s=0,.25,.5,.75,1)`, JSON.stringify(jet));
save('breath', { anticipation: res, jet });
process.exit(0);
