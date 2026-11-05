// How many pictures eachPic walks for one 256 m tile (geoNear / hasSaved) and one blast (fold), by how far the map's centre is from the north pole,
// and what fold costs: pictures made, time, and geoPics.size after one blast.
import { GroundPaint, layout, geoFor } from './hooks.mjs';
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : [0, 60, 85, 88.5, 88.9, 89.05, 89.5, 89.9, 89.99, 90];
for (const lat0 of only) {
  const { geo } = geoFor(lat0, 10);
  const g = new GroundPaint(256, 'moon-pole-cost');
  g.useGeo(geo);
  let tileN = 0;
  const tb = g.boxOf(0, 0, 256, 256);
  let t0 = performance.now();
  g.eachPic(tb, () => tileN++);
  const tileMs = performance.now() - t0;
  const spec = layout.makeBlastSpec(128, 128, layout.blastRadiusFor(0), 2, 12345);
  const p = g.prepare(spec);
  const bb = g.boxOf(p.minX, p.minZ, p.maxX, p.maxZ);
  let blastN = 0;
  g.eachPic(bb, () => blastN++);
  t0 = performance.now();
  g.fold(spec);
  const foldMs = performance.now() - t0;
  let painted = 0;
  for (const pic of g.geoPics.values()) if (pic.dirty) painted++;
  console.log(JSON.stringify({ lat0, tileBox: { la0: +tb.la0.toFixed(4), la1: +tb.la1.toFixed(4) }, tilePics: tileN, tileWalkMs: +tileMs.toFixed(1), blastReachM: +(p.maxX - spec.x).toFixed(1), blastPics: blastN, foldMs: Math.round(foldMs), picsAfterOneBlast: g.geoPics.size, picsPainted: painted }));
}
