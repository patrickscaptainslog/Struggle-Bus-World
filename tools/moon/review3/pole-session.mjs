// No storage (nothing evicted to it): a blast on a tile at the pole, the tile out and in again in the same session (pictureInto). Is it all back?
import { GroundPaint, layout, geoFor } from './hooks.mjs';
const lat0 = Number(process.argv[2] ?? 90);
const U = () => ({ tGround: { value: null }, uGroundOn: { value: 0 } });
const painted = (g, key) => { const m = g.masks.get(key); if (!m) return 0; let n = 0; for (let t = 0; t < m.data.length; t += 4) if (m.data[t]) n++; return n; };
const { geo } = geoFor(lat0, 10);
const g = new GroundPaint(256, 'moon-pole-session');
g.useGeo(geo);
g.attach(0, 0, 0, 0, U());
const t0 = performance.now();
g.blast(layout.makeBlastSpec(128, 128, layout.blastRadiusFor(0), 3, 777), 0);
const ms = performance.now() - t0;
const live = painted(g, '0,0');
g.detach(0, 0);
g.attach(0, 0, 0, 0, U());
console.log(JSON.stringify({ lat0, blastMs: Math.round(ms), pictures: g.geoPics.size, liveTexels: live, backTexels: painted(g, '0,0') }));
