// Away from the poles: pictures fold makes for a blast against those that get any paint (empties count toward GEO_PICS = 600 and make hasSaved true).
import { GroundPaint, layout, geoFor } from './hooks.mjs';
const { decodeMask } = await import(new URL('../../../src/world/GroundPaint.ts', import.meta.url).href);
for (const lat0 of [0, 30, 80, 88.9]) for (const drop of [0, 1e9]) {
  const { geo } = geoFor(lat0, 10);
  const g = new GroundPaint(256, 'moon-empties');
  g.useGeo(geo);
  let seed = 3;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 40; k++) g.fold(layout.makeBlastSpec((rnd() - 0.5) * 60000, (rnd() - 0.5) * 60000, layout.blastRadiusFor(drop), k % 6, 100 + k));
  let empty = 0;
  const buf = new Uint8Array(128 * 128 * 4);
  for (const pic of g.geoPics.values()) {
    let d = pic.data;
    if (!d) { buf.fill(0); if (pic.enc) decodeMask(pic.enc, buf); d = buf; }
    let any = false;
    for (let t = 0; t < d.length; t += 4) if (d[t]) { any = true; break; }
    if (!any) empty++;
  }
  console.log(JSON.stringify({ lat0, blastR: layout.blastRadiusFor(drop), blasts: 40, pictures: g.geoPics.size, empty }));
}
