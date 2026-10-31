// Per-frame CPU cost of the aim (Aimer.update: ray, pick, hold, line of fire) vs the ray alone (what the old
// 0.1 s aim timer ran) and the flight step; desktop node, a fixed pose stepped forward, median of 5 runs.
import { newCity, pump, ll, makeGame, MODE } from './lib';
const city = await newCity();
const rows: string[] = [];
const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
for (const [name, lat, lon, hdg, climb] of [['fidi-floor', 37.7925, -122.401, 0, 0], ['soma-floor', 37.779, -122.405, 135, 0], ['alamo-floor', 37.7762, -122.438, 90, 0], ['downtown-250', 37.77, -122.43, 45, 250], ['downtown-ceiling', 37.77, -122.43, 45, 999]] as Array<[string, number, number, number, number]>) {
  const [x0, z0] = ll(lat, lon);
  await pump(city, x0, z0);
  const g = makeGame(city) as any;
  const f = g.flight;
  f.x = x0; f.z = z0; f.heading = (hdg * Math.PI) / 180; f.y = city.obstacleAt(x0, z0) + 9;
  for (let k = 0; climb && k < 3600 && !(f.lift >= climb || f.y > 510); k++) { if (k % 30 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz); g.frame(1 / 60, { sx: 0, sy: -1, dragging: true }); }
  await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
  const sx0 = f.x, sz0 = f.z, h0 = f.heading;
  const aimR: number[] = [], rayR: number[] = [], stepR: number[] = [];
  for (let rep = 0; rep < 6; rep++) {
    f.x = sx0; f.z = sz0; f.heading = h0;
    let aimT = 0, rayT = 0, stepT = 0;
    const N = 300;
    for (let k = 0; k < N; k++) {
      f.fullness = 1;
      const inp = { sx: 0.3 * Math.sin(k / 40), sy: 0, dragging: true };
      const t0 = performance.now();
      for (let i = 0; i < 2; i++) f.step(1 / 120, inp, city);
      const t1 = performance.now();
      g.aimer.update(f, k / 60, true);
      const t2 = performance.now();
      g.aimer.point(f);
      const t3 = performance.now();
      stepT += t1 - t0; aimT += t2 - t1; rayT += t3 - t2;
    }
    if (rep) { aimR.push((aimT / N) * 1000); rayR.push((rayT / N) * 1000); stepR.push((stepT / N) * 1000); }
  }
  rows.push(`${name}: aim update ${med(aimR).toFixed(1)} us/frame (of which the ray ${med(rayR).toFixed(1)}), flight ${med(stepR).toFixed(1)} us/frame`);
}
console.log(`[${MODE}]\n` + rows.join('\n'));
process.exit(0);
