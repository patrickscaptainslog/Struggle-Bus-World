// A: how many pictures fold walks (and creates, make=true) for one blast's box, and geoNear walks for one tile, by latitude and blast radius. Counting only: nothing is drawn.
import { paintAt, makeBlastSpec } from './common.mjs';
const rows = [];
for (const lat of [0, 45, 80, 85, 88, 88.9, 89.01, 89.5, -89.67, 89.99]) {
  const g = paintAt(lat, 30);
  const out = { lat };
  for (const r of [60, 90, 180, 468]) {
    const p = g.prepare(makeBlastSpec(0, 0, r, 0, 1));
    const box = g.boxOf(p.minX, p.minZ, p.maxX, p.maxZ);
    let n = 0;
    g.eachPic(box, () => n++);
    out[`r${r}`] = n;
    if (r === 60) out.box60 = `${(p.maxX - p.minX).toFixed(0)} m, lat ${box.la0.toFixed(4)}..${box.la1.toFixed(4)}, lon span ${(box.lo1 - box.lo0).toFixed(3)}`;
  }
  const tb = g.boxOf(0, 0, 256, 256);
  let nt = 0;
  g.eachPic(tb, () => nt++);
  out.tile = nt;
  rows.push(out);
}
console.table(rows);
