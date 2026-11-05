// L: at the cap, how much of the 600 pictures' 13.8 km2 is paint (r >= 128, each texel 0.005 deg / 128 = 1.18 m a side here at the equator)
import { Store, paintAt, makeBlastSpec, nextSeed } from './common.mjs';
for (const [name, v, r] of [['Express r 60', 112, 60], ['Jet r 90', 450, 90]]) {
  const g = paintAt(0, 30, new Store(5 * 1024 * 1024));
  for (let n = 0; g.geoPics.size < 600; n++) g.fold(makeBlastSpec(-60000 + n * v * 2.6, (n % 2 ? 1 : -1) * 30, r, n % 6, nextSeed()));
  for (let f = 0; f < 2000; f++) g.flush(null, 1 / 60);
  let tex = 0;
  const d = new Uint8Array(128 * 128 * 4);
  const { decodeMask } = await import(new URL('../../../../src/world/GroundPaint.ts', import.meta.url).href);
  for (const q of g.geoPics.values()) { if (!q.enc) continue; decodeMask(q.enc, d); for (let k = 0; k < d.length; k += 4) if (d[k] >= 128) tex++; }
  const m = 151.6 / 128;
  console.log(`${name}: 600 pictures = ${(600 * 151.6 * 151.6 / 1e6).toFixed(1)} km2; painted in them ${(tex * m * m / 1e6).toFixed(2)} km2`);
}
