// E: what a picture codes to when a place is painted a lot. keep.mjs's heavy row (200 breaths over 330 x 210 m, drop 25: r 65), spatter on its own (a small crater's
// shaped breath, CraterPaint.barf: edge 0.02, no rays or dots, 18 + 0.4 r blobs), and the coder's worst case. Then 600 of them against a 5 MB store.
import { Store, paintAt, makeBlastSpec, nextSeed, encodeMask } from './common.mjs';
const stat = (g) => {
  const s = [];
  for (const q of g.geoPics.values()) if (q.data) { const e = encodeMask(q.data); if (e) s.push(e.length); } else if (q.enc) s.push(q.enc.length);
  s.sort((a, b) => a - b);
  return { pics: s.length, median: s[s.length >> 1], max: s[s.length - 1], sum: s.reduce((a, b) => a + b, 0) };
};
{
  const g = paintAt(20, 30, new Store(1e9));
  for (let k = 0; k < 200; k++) {
    const u = (k % 20) / 19 - 0.5, v = Math.floor(k / 20) / 9 - 0.5;
    g.fold(makeBlastSpec(u * 330, v * 210, 65, k % 6, nextSeed()));
  }
  console.log('heavy (keep.mjs): ', JSON.stringify(stat(g)));
}
{
  const g = paintAt(20, 30, new Store(1e9));
  let rnd = 99;
  const R = () => ((rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 300; k++) {
    const tr = 20 + 100 * R(), s = makeBlastSpec((R() - 0.5) * 600, (R() - 0.5) * 600, tr * 1.2 + 26, k % 6, nextSeed());
    s.edge = 0.02; s.ragged = 0; s.rays = 0; s.dots = 0; s.blobs = Math.round(18 + tr * 0.4); s.reach = (tr * 2.3 + 36) / s.r;
    g.fold(s);
  }
  console.log('spatter only, 300 small-crater breaths over 600 x 600 m: ', JSON.stringify(stat(g)));
}
{
  const d = new Uint8Array(128 * 128 * 4);
  for (let k = 0; k < 128 * 128; k++) { d[k * 4] = k % 2 ? 255 : 140; d[k * 4 + 1] = ((k >> 1) % 6) * 32 + 16; }
  const e = encodeMask(d), raw = JSON.stringify({ t: Date.now(), m: e }), key = 'strugglebus.ground.v2.moon_-7.05_26.43:gpic:-1410,41722';
  console.log(`worst picture: ${e.length} chars coded, ${raw.length + key.length} with its key and JSON; 600 of them ${(600 * (raw.length + key.length) / 1048576).toFixed(1)} M chars against a 5 M store`);
}
