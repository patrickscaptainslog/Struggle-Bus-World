// The key a point gets (pictureInto's arithmetic, copied from GroundPaint.ts lines 985-986) against the pictures eachPic visits (the real method),
// row by row: equator, negative rows, rows where the 0.02 clamp starts, the rows at and next to each pole, the narrow last column of a row, longitudes
// given as -180..180, 0..360 and many turns off, spans of 360 and more. Also fold's corner for (i, j) (lon0 = j * w - 180) taken back to its key.
import { GroundPaint } from './hooks.mjs';
const T = 0.005;
const g = new GroundPaint(256, 'moon-keys-check');
const geoLonW = (i) => T / Math.max(0.02, Math.cos(((i + 0.5) * T * Math.PI) / 180));
const lon360 = (lon) => (((lon + 180) % 360) + 360) % 360;
const keyOf = (lat, lon) => { const pi = Math.floor(lat / T), w = geoLonW(pi), L = lon360(lon); return [pi, Math.floor(L / w), w, L]; };
const visits = (box) => { const s = new Set(); g.eachPic(box, (i, j) => s.add(`${i},${j}`)); return s; };
let n = 0, bad = 0;
const fails = [];
const check = (what, lat, lon, box) => {
  n++;
  const [i, j] = keyOf(lat, lon);
  if (!visits(box).has(`${i},${j}`)) { bad++; if (fails.length < 8) fails.push({ what, lat, lon, key: `${i},${j}`, box }); }
};
const rows = [0, 1, -1, -2, 100, -100, 8000, -8000, 17769, 17770, 17771, -17770, -17771, 17998, 17999, -17999, -18000];
let lastColPts = 0;
for (const i of rows) {
  const w = geoLonW(i), cols = g.constructor.name && Math.floor(360 / w) + 1;
  const lat = (i + 0.5) * T;
  // the last column, and its narrow part: L just under 360 (lon just under 180)
  const Ls = [0, 1e-9, w * 0.5, w - 1e-9, 180, 360 - w * 1.5, (cols - 1) * w + 1e-9, 360 - 1e-7, 360 - 1e-12];
  for (const L of Ls) {
    if ((cols - 1) * w <= L) lastColPts++;
    for (const turns of [0, -1, 1, 3, -5]) {
      const lon = L - 180 + 360 * turns;
      // a small box round the point, its longitudes given in the same representation (as boxOf can give them: round from a corner's)
      for (const [a, b] of [[-0.001, 0.001], [-w * 2, w * 0.1], [-0.0001, 0.3]]) check(`row ${i} L ${L} turns ${turns}`, lat, lon, { la0: lat - 0.0001, la1: lat + 0.0001, lo0: lon + a, lo1: lon + b });
    }
  }
  // spans of 360 and more, from anywhere
  for (const lo0 of [-180, -37.2, 179.99, 400, -900]) for (const span of [359.999, 360, 400]) for (const L of [0, 359.9999999, 180]) check(`row ${i} span ${span}`, lat, L - 180, { la0: lat - 0.0001, la1: lat + 0.0001, lo0, lo1: lo0 + span });
  // fold's corner for a column, back to its key (the texel at its first quarter)
  for (const j of [0, 1, cols - 2, cols - 1]) {
    n++;
    const lon0 = j * w - 180, [i2, j2] = keyOf(i * T + T * 0.25, lon0 + Math.min(w, 360 - j * w) * 0.25);
    if (i2 !== i || j2 !== j) { bad++; fails.push({ what: 'fold corner', i, j, i2, j2 }); }
  }
}
// the pole itself: a point at exactly 90 or -90
for (const lat of [90, -90, 89.99999999, -89.99999999]) check(`pole ${lat}`, lat, 12.3, { la0: lat > 0 ? 89.5 : -90, la1: lat > 0 ? 90 : -89.5, lo0: -180, lo1: 180 });
console.log(`${bad ? 'FAIL' : 'pass'}  ${n} point/box pairs, ${bad} not walked (${lastColPts} points in a row's last column)`, JSON.stringify(fails, null, 0));
