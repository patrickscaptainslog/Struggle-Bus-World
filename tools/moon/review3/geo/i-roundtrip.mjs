// I: the round trip. Tiles drawn live by 200 breaths over a patch (keep.mjs's heavy row) against the same place after a reload, copied out of the pictures (pictureInto),
// on the same map, on a map made again 30 km off (another grid), near a pole (each texel's own place), and on the date line. Per texel: painted (r >= 128) both ways, and the hue.
import { Store, GroundPaint, paintAt, geoAt, makeBlastSpec, uni } from './common.mjs';
const N = 128;
function run(lat0, lon0, label) {
  const store = new Store(1e9);
  const g = paintAt(lat0, lon0, store);
  for (let tx = -2; tx <= 1; tx++) for (let tz = -2; tz <= 1; tz++) g.attach(tx, tz, tx * 256, tz * 256, uni());
  let seed = 4242;
  for (let k = 0; k < 200; k++) {
    const u = (k % 20) / 19 - 0.5, v = Math.floor(k / 20) / 9 - 0.5;
    g.blast(makeBlastSpec(u * 330, v * 210, 65, k % 6, (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)), -100);
    g.dirty.length = 0;
  }
  for (let f = 0; f < 400; f++) { g.dirty.length = 0; g.flush(null, 1 / 60); }
  // the live tiles' places, kept to read back on any map
  const live = [];
  const geo = g.geo, o = [0, 0];
  for (const [key, m] of g.masks) for (let j = 0; j < N; j += 1) for (let i = 0; i < N; i += 1) {
    const q = (j * N + i) * 4;
    geo.toLatLon(m.ox + (i + 0.5) * 2, m.oz + (j + 0.5) * 2, o);
    live.push([o[0], o[1], m.data[q] >= 128, m.data[q] >= 128 ? m.data[q + 1] >> 5 : -1]);
  }
  const out = [];
  for (const [shift, name] of [[0, 'same map'], [30000, 'a map 30 km off']]) {
    const g2 = new GroundPaint(256, 'moon_probe', 'rank');
    // (the map made again with its middle 30 km east and 20 km south of the first: another grid of tiles under the same places)
    const ctr = [0, 0];
    geo.toLatLon(shift, shift * 0.66, ctr);
    const geo2 = shift ? geoAt(ctr[0], ctr[1]) : geoAt(lat0, lon0);
    g2.useGeo(geo2);
    const want = new Set();
    for (const [la, lo] of live) { geo2.toXZ(la, lo, o); want.add(`${Math.floor(o[0] / 256)},${Math.floor(o[1] / 256)}`); }
    for (const k of want) { const [tx, tz] = k.split(',').map(Number); g2.attach(tx, tz, tx * 256, tz * 256, uni()); }
    let both = 0, liveOnly = 0, backOnly = 0, hueSame = 0;
    for (const [la, lo, p, h] of live) {
      geo2.toXZ(la, lo, o);
      const s = g2.sample(o[0], o[1]);
      const b = !!s && s.cov >= 128 / 255;
      if (p && b) { both++; if (s.hue === h) hueSame++; } else if (p) liveOnly++; else if (b) backOnly++;
    }
    out.push(`${name}: painted both ways ${both}, live only ${liveOnly}, back only ${backOnly}, same hue ${(100 * hueSame / both).toFixed(1)} %`);
  }
  console.log(`${label} (${live.length} texels): ${out.join(' | ')}`);
}
run(20, 30, 'lat 20');
run(86.5, 30, 'lat 86.5, each texel its own place');
run(0, 179.99, 'the date line');
