// Aim acceptance: does the building that glints get hit? Taps at the floor in several styles.
import { newCity, pump, ll, makeGame, save, MODE, type BuildingRef } from './lib';

const PLACES: Array<[string, number, number, number]> = [
  ['alamo', 37.7762, -122.438, 90],
  ['noe', 37.7502, -122.4337, 0],
  ['bernal', 37.742, -122.416, 180],
  ['sunset', 37.755, -122.49, 90],
  ['fidi', 37.7925, -122.401, 0],
  ['soma', 37.779, -122.405, 135],
  ['missionbay', 37.77, -122.392, 180],
  ['rincon', 37.788, -122.393, 300],
];
type Style = 'cruise' | 'surge' | 'turn' | 'turn2' | 'slalom';
const STYLES: Style[] = ['cruise', 'surge', 'turn', 'turn2', 'slalom'];
const dtArg = Number(process.argv[2] ?? 1 / 60);
const city = await newCity();
const out: any[] = [];
const idx = (r: BuildingRef | null) => (r ? r.index : -1);
for (const [name, lat, lon, hdg] of PLACES) {
  const [x0, z0] = ll(lat, lon);
  await pump(city, x0, z0);
  for (const style of STYLES) {
    const g = makeGame(city);
    const f = g.flight;
    f.x = x0; f.z = z0; f.heading = (hdg * Math.PI) / 180; f.y = city.obstacleAt(x0, z0) + 9; f.glideSpeed = 0;
    const dt = dtArg;
    const T = 13;
    const taps: number[] = [];
    for (let t = 2.2; t < T - 1; t += 2.1) taps.push(t);
    let nextTap = 0;
    let lastGlint = -2, changes = 0, readyTime = 0;
    let liftGlint: number | null = null;
    const rec: any[] = [];
    for (let t = 0; t < T; t += dt) {
      const tn = taps[nextTap];
      const oneThumb = style === 'surge' || style === 'turn';
      let sx = 0, sy = 0, drag = false;
      if (style === 'surge') { sy = 1; drag = true; }
      if (style === 'turn') { sx = 0.6; drag = true; }
      if (style === 'turn2') { sx = 0.8; drag = true; }
      if (style === 'slalom') { sx = Math.sin(t * 1.3) * 0.85; sy = 0.5; drag = true; }
      if (tn !== undefined && t > tn - 0.65 && t < tn - 0.6 && f.barfT < 0) f.fullness = 1;
      if (oneThumb && tn !== undefined && t >= tn - 0.25 && t < tn + 0.25) { drag = false; sx = 0; sy = 0; }
      // keep the bus in the loaded city
      if (Math.hypot(f.x - x0, f.z - z0) > 900) { await pump(city, f.x, f.z); }
      g.frame(dt, { sx, sy, dragging: drag });
      const gl = idx(g.glint());
      if (f.barfT < 0 && f.fullness >= 0.999) { readyTime += dt; if (gl !== lastGlint) changes++; }
      lastGlint = gl;
      if (oneThumb && tn !== undefined && t >= tn - 0.25 && liftGlint === null) liftGlint = gl;
      if (tn !== undefined && t >= tn - 0.12 && t < tn - 0.12 + dt && (oneThumb || style === 'cruise')) g.press();
      if (tn !== undefined && t >= tn) {
        const glintTap = gl;
        const r = g.tap();
        const e0 = g.events.length;
        // run on until the impact (and the primary bloom) to see what got hit
        const tap = { place: name, style, t: +t.toFixed(3), speed: +f.speed.toFixed(1), yawRate: +f.yawRate.toFixed(2), fired: r.fired, glintLift: oneThumb ? liftGlint : null, glintTap, target: idx(r.target), primary: -1, impact: null as any, miss: false, hitstop: false };
        let tt = 0;
        while (tt < 1.2) {
          g.frame(dt, { sx: oneThumb ? 0 : sx, sy: oneThumb ? 0 : sy, dragging: !oneThumb && drag });
          tt += dt; t += dt;
        }
        for (const ev of g.events.slice(e0 - 1)) {
          if (ev.ev === 'primary' && tap.primary < 0) tap.primary = ev.index as number;
          if (ev.ev === 'impact') tap.impact = (ev.pos as number[]).map((v) => +v.toFixed(1));
          if (ev.ev === 'miss') tap.miss = true;
          if (ev.ev === 'hitstop') tap.hitstop = true;
        }
        rec.push(tap);
        nextTap++;
        liftGlint = null;
      }
    }
    out.push({ place: name, style, glintChangesPerS: +(changes / Math.max(0.1, readyTime)).toFixed(2), taps: rec });
  }
}
// summary
const all = out.flatMap((o) => o.taps.filter((t: any) => t.fired));
const tapMis = all.filter((t: any) => t.glintTap !== t.target).length;
const tapMisHit = all.filter((t: any) => t.glintTap >= 0 && t.glintTap !== t.primary).length;
const lifts = all.filter((t: any) => t.glintLift !== null);
const liftMis = lifts.filter((t: any) => t.glintLift !== t.primary).length;
const noGlintHit = all.filter((t: any) => t.glintTap < 0 && t.primary >= 0).length;
const misses = all.filter((t: any) => t.miss).length;
const nothing = all.filter((t: any) => t.primary < 0 && !t.miss).length;
const rate = out.map((o) => `${o.place}/${o.style}:${o.glintChangesPerS}`).join(' ');
console.log(`[${MODE}] dt=${dtArg.toFixed(4)} taps=${all.length}: glint(tap)!=hit primary ${tapMisHit} | glint(lift)!=hit ${liftMis}/${lifts.length} | hit without glint ${noGlintHit} | misses ${misses} | no bloom ${nothing}`);
console.log('glint changes/s while loaded:', rate);
save(`aim-${dtArg.toFixed(4)}`, out);
process.exit(0);
