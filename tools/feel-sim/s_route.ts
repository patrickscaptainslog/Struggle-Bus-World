// Real-city flights: vertical lurch (per-frame climb acceleration), hard-floor hits, and clearance of the
// bus's underside over the RENDERED surfaces (mesh roofs incl. gables/chimneys, tree crowns, painted sprouts).
import { newCity, pump, ll, makeGame, busClearance, MODE, save, THREE } from './lib';
import { RoofSprouts } from '@src/world/props/sprouts';
const dtArg = Number(process.argv[2] ?? 1 / 60);
const only = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined;
const city = await newCity();
import { config } from './lib';
if (process.env.OVR) { const o = JSON.parse(process.env.OVR); for (const g of Object.keys(o)) Object.assign((config as any)[g], o[g]); }
type Route = { name: string; lat: number; lon: number; hdg: number; T: number; inp: (t: number) => { sx: number; sy: number; dragging: boolean }; full: number; paint?: Array<[number, number]> };
const cruise = () => ({ sx: 0, sy: 0, dragging: false });
const half = () => ({ sx: 0, sy: 0.5, dragging: true });
const surge = () => ({ sx: 0, sy: 1, dragging: true });
const weave = (t: number) => ({ sx: 0.45 * Math.sin(t * 0.9), sy: 0.3, dragging: true });
const ROUTES: Route[] = [];
for (const [nm, inp] of [['cruise', cruise], ['half', half], ['surge', surge]] as const) {
  ROUTES.push({ name: `hills-west-${nm}`, lat: 37.7762, lon: -122.432, hdg: 270, T: 22, inp, full: 1 });
  ROUTES.push({ name: `twinpeaks-${nm}`, lat: 37.7615, lon: -122.428, hdg: 255, T: 20, inp, full: 1 });
  ROUTES.push({ name: `downtown-${nm}`, lat: 37.782, lon: -122.41, hdg: 45, T: 16, inp, full: 1 });
  ROUTES.push({ name: `buenavista-${nm}`, lat: 37.7705, lon: -122.4375, hdg: 200, T: 9, inp, full: 1 });
  ROUTES.push({ name: `ggpark-${nm}`, lat: 37.7705, lon: -122.452, hdg: 270, T: 16, inp, full: 1 });
}
ROUTES.push({ name: 'alamo-weave-light', lat: 37.7745, lon: -122.4395, hdg: 60, T: 14, inp: weave, full: 0 });
// a painted level-3 block: the Painted Ladies row blasted three times, then flown over full and light
const ROW: Array<[number, number]> = [[37.7762, -122.43262], [37.7762, -122.43262], [37.7762, -122.43262], [37.7754, -122.4329], [37.7754, -122.4329], [37.7754, -122.4329]];
ROUTES.push({ name: 'painted-L3-cruise-full', lat: 37.7738, lon: -122.4326, hdg: 0, T: 7, inp: cruise, full: 1, paint: ROW });
ROUTES.push({ name: 'painted-L3-cruise-light', lat: 37.7738, lon: -122.4326, hdg: 0, T: 7, inp: cruise, full: 0, paint: ROW });
ROUTES.push({ name: 'painted-L3-weave-full', lat: 37.7762, lon: -122.4352, hdg: 92, T: 7, inp: (t) => ({ sx: 0.35 * Math.sin(t * 1.6), sy: 0, dragging: true }), full: 1, paint: ROW });
// passes straight over each level-3 roof (filled in after the row is painted)
const L3PASS = process.argv.includes('--l3');
const out: any[] = [];
let sprouts: RoofSprouts | null = null;
const sproutTruth: Array<{ x: number; z: number; r: number; top: number }> = [];
for (const R of ROUTES) {
  if (only && !R.name.includes(only)) continue;
  const [x0, z0] = ll(R.lat, R.lon);
  await pump(city, x0, z0);
  const g = makeGame(city) as any;
  if (R.paint) {
    if (!sprouts) {
      sprouts = new RoofSprouts();
      // paint the row (the real splat pipeline, escalating to level 3), growing gardens and crowns
      g.onBloom = (ref: any, hue: number, level: number) => {
        if (level < 2) return;
        const rect = city.roofRect(ref);
        const top = sprouts!.set(ref.index, rect, hue, level, 0) as unknown as number;
        if (typeof top === 'number' && (city as any).raiseRoof) (city as any).raiseRoof(rect, rect.y + top);
      };
      for (const [la, lo] of R.paint) {
        const [px, pz] = ll(la, lo);
        g.splatter.barf(px, pz);
        for (let k = 0; k < 90; k++) g.frame(1 / 60, { sx: 0, sy: 0, dragging: false });
      }
      // ground truth for the gardens: every live sprout element's world top and reach
      for (const cell of (sprouts as any).cells.values())
        for (const b of cell) {
          const m = b.mesh as THREE.InstancedMesh;
          const bb = (b.geo as THREE.BufferGeometry).boundingBox ?? ((b.geo as THREE.BufferGeometry).computeBoundingBox(), b.geo.boundingBox);
          const M = m.instanceMatrix.array as Float32Array, C = (m.instanceColor!.array as Float32Array);
          for (let i = 0; i < b.hwm; i++) {
            if (C[i * 3 + 2] > 1e8) continue;
            const sx = Math.hypot(M[i * 16], M[i * 16 + 1], M[i * 16 + 2]), sy = Math.hypot(M[i * 16 + 4], M[i * 16 + 5], M[i * 16 + 6]);
            const rr = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z)) * sx;
            sproutTruth.push({ x: M[i * 16 + 12], z: M[i * 16 + 14], r: Math.max(0.5, rr), top: M[i * 16 + 13] + bb.max.y * sy });
          }
        }
      console.log(`painted: ${city.paint.paintedCount} buildings, ${sproutTruth.length} sprout elements, max top ${Math.max(...sproutTruth.map((s) => s.top)).toFixed(1)}`);
    }
  }
  const f = g.flight;
  f.x = x0; f.z = z0; f.heading = (R.hdg * Math.PI) / 180; f.y = city.obstacleAt(x0, z0) + 9; f.glideSpeed = 0; f.fullness = R.full;
  const dt = dtArg;
  let lastVy = 0, minClr = Infinity, clip = 0, hard = 0, frames = 0, peakA = 0, peakJerkFrame = 0, aWin: number[] = [], events40 = 0, minAt: any = null, pRate = 0, lastP = 0;
  for (let k = 0; k < R.T / dt; k++) {
    const t = k * dt;
    if (k % Math.round(0.5 / dt) === 0) await pump(city, f.x, f.z);
    if (R.full === 0) f.fullness = 0; else f.fullness = 1;
    g.frame(dt, R.inp(t));
    if (t < 1.5) { lastVy = f.vy; lastP = f.pitch; continue; }
    frames++;
    const a = (f.vy - lastVy) / dt;
    lastVy = f.vy;
    peakA = Math.max(peakA, Math.abs(a));
    aWin.push(a);
    if (aWin.length > Math.round(0.1 / dt)) aWin.shift();
    const avg = aWin.reduce((s, v) => s + v, 0) / aWin.length;
    if (Math.abs(avg) > 40) events40++;
    pRate = Math.max(pRate, Math.abs(f.pitch - lastP) / dt);
    lastP = f.pitch;
    if (f.y <= f.obstacleUnder + 3.5 + 1e-6) hard++;
    const c = busClearance(city, f, R.paint ? sproutTruth : undefined);
    if (c < minClr) { minClr = c; minAt = { t: +t.toFixed(2), x: +f.x.toFixed(0), z: +f.z.toFixed(0), speed: +f.speed.toFixed(0), pitch: +f.pitch.toFixed(2) }; }
    if (c < 0) clip++;
  }
  out.push({ route: R.name, frames, clipFrames: clip, minClearance: +minClr.toFixed(2), minAt, hardFloorFrames: hard, peakVyAccel: +peakA.toFixed(0), over40ms2_0p1s: events40, peakPitchRate: +pRate.toFixed(2) });
}
if (L3PASS && sprouts) {
  const l3 = [...city.loadedRefs()].filter((r: any) => city.paint.level(r.index) >= 2.5);
  let n = 0, clipFrames = 0, total = 0, minC = Infinity, clipBuildings = 0;
  for (const ref of l3.slice(0, 16)) {
    const rect = city.roofRect(ref);
    for (const full of [1, 0]) {
      for (const [dirName, yawOff] of [['along', 0], ['across', Math.PI / 2]] as Array<[string, number]>) {
        const g = makeGame(city) as any;
        const f = g.flight;
        // heading along the roof's street axis (yaw is the U axis: sin/cos) and across it
        const ux = Math.sin(rect.yaw + yawOff), uz = Math.cos(rect.yaw + yawOff);
        f.heading = Math.atan2(ux, -uz);
        f.x = rect.cx - ux * 70; f.z = rect.cz - uz * 70; f.y = city.obstacleAt(f.x, f.z) + 9; f.fullness = full; f.glideSpeed = 0;
        let mc = Infinity, cf = 0;
        for (let k = 0; k < 3.5 / dtArg; k++) {
          f.fullness = full;
          g.frame(dtArg, { sx: 0, sy: 0, dragging: false });
          if (k * dtArg < 1) continue;
          const c = busClearance(city, f, sproutTruth);
          total++;
          if (c < 0) { cf++; clipFrames++; }
          mc = Math.min(mc, c);
        }
        n++;
        if (cf) clipBuildings++;
        minC = Math.min(minC, mc);
      }
    }
  }
  out.push({ route: `L3-passes(${n})`, frames: total, clipFrames, minClearance: +minC.toFixed(2), clippedPasses: clipBuildings, hardFloorFrames: 0, peakVyAccel: 0, over40ms2_0p1s: 0, peakPitchRate: 0 });
}
for (const o of out) console.log(`[${MODE}] ${o.route.padEnd(26)} clip ${String(o.clipFrames).padStart(4)}/${o.frames} min ${String(o.minClearance).padStart(6)} m  hard ${String(o.hardFloorFrames).padStart(3)}  peak dvy/dt ${String(o.peakVyAccel).padStart(5)}  >40 ${String(o.over40ms2_0p1s).padStart(4)}  pitchRate ${o.peakPitchRate}`);
save(`route-${dtArg.toFixed(4)}${only ? '-' + only : ''}`, out);
process.exit(0);
