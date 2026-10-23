// Aim from altitude: climb to 120 m / 250 m / the ceiling, hold, tap (straight, turning 2nd finger, lift-then-tap).
import { newCity, pump, ll, makeGame, save, MODE, type BuildingRef } from './lib';
const PLACES: Array<[string, number, number, number]> = [
  ['downtown', 37.77, -122.43, 45],
  ['west', 37.76, -122.48, 60],
  ['soma', 37.775, -122.415, 70],
];
const ALTS: Array<[string, number]> = [['120', 120], ['250', 250], ['ceiling', 1e9]];
const city = await newCity();
const idx = (r: BuildingRef | null) => (r ? r.index : -1);
const out: any[] = [];
const dt = 1 / 60;
for (const [name, lat, lon, hdg] of PLACES) {
  const [x0, z0] = ll(lat, lon);
  for (const [an, alt] of ALTS) {
    await pump(city, x0, z0);
    const g = makeGame(city);
    const f = g.flight;
    f.x = x0; f.z = z0; f.heading = (hdg * Math.PI) / 180; f.y = city.obstacleAt(x0, z0) + 9;
    let t = 0;
    const run = async (secs: number, inp: (t: number) => { sx: number; sy: number; dragging: boolean }) => {
      for (let k = 0; k < secs / dt; k++) {
        if (k % 30 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
        g.frame(dt, inp(t));
        t += dt;
      }
    };
    // climb (full pull) until the height is reached, then hold
    for (let k = 0; k < 60 / dt && !(f.lift >= alt || (alt > 1e8 && f.y > 515)); k++) {
      if (k % 30 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
      g.frame(dt, { sx: 0, sy: -1, dragging: true });
      t += dt;
    }
    await run(2.5, () => ({ sx: 0, sy: 0, dragging: false }));
    const taps: any[] = [];
    for (const style of ['straight', 'straight', 'turn2', 'turn2', 'lift', 'lift']) {
      f.fullness = 1;
      const steer = style === 'turn2' ? 0.6 : style === 'lift' ? 0.5 : 0;
      await run(0.8, () => ({ sx: steer, sy: 0, dragging: style !== 'straight' }));
      let liftGlint = -2;
      if (style === 'lift') {
        await run(0.017, () => ({ sx: 0, sy: 0, dragging: false }));
        liftGlint = idx(g.glint());
        await run(0.13, () => ({ sx: 0, sy: 0, dragging: false }));
        g.press();
        await run(0.12, () => ({ sx: 0, sy: 0, dragging: false }));
      }
      const glintTap = idx(g.glint());
      const aim = (g as any).aimer ? { ...(g as any).aimer.aim } : null;
      const e0 = g.events.length;
      const r = g.tap();
      const y0 = f.y, lift0 = f.lift;
      await run(2.6, () => ({ sx: style === 'turn2' ? steer : 0, sy: 0, dragging: style === 'turn2' }));
      const rec: any = { style, lift: +lift0.toFixed(0), y: +y0.toFixed(0), glintLift: liftGlint, glintTap, target: idx(r.target), primary: -1, impactT: null, miss: false, hitstop: false, aim: aim ? [aim.x, aim.y, aim.z].map((v: number) => +v.toFixed(0)) : null };
      for (const ev of g.events.slice(e0)) {
        if (ev.ev === 'primary' && rec.primary < 0) rec.primary = ev.index;
        if (ev.ev === 'impact') { rec.impactT = +(ev.t - g.events[e0]?.t).toFixed(2); rec.impact = (ev.pos as number[]).map((v) => +v.toFixed(0)); }
        if (ev.ev === 'miss') rec.miss = true;
        if (ev.ev === 'hitstop') rec.hitstop = true;
      }
      if (rec.target >= 0 && rec.impact && (city as any).edgeDistance) {
        const ref = [...city.loadedRefs()].find((q) => q.index === rec.target);
        if (ref) rec.impactOnTargetM = +city.edgeDistance(ref, rec.impact[0], rec.impact[2]).toFixed(1);
      }
      taps.push(rec);
    }
    out.push({ place: name, alt: an, taps });
  }
}
const all = out.flatMap((o) => o.taps);
const mis = all.filter((t) => t.glintTap >= 0 && t.glintTap !== t.primary).length;
const liftMis = all.filter((t) => t.glintLift > -2 && t.glintLift !== t.primary).length;
const none = all.filter((t) => t.glintTap < 0).length;
console.log(`[${MODE}] altitude taps=${all.length}: glint!=hit ${mis} | lift glint!=hit ${liftMis}/${all.filter((t) => t.glintLift > -2).length} | no glint ${none} | misses ${all.filter((t) => t.miss).length}`);
for (const o of out) console.log(o.place, o.alt, o.taps.map((t: any) => `${t.style}@${t.lift}m g${t.glintTap}/h${t.primary}${t.impactOnTargetM !== undefined ? ' on' + t.impactOnTargetM : ''}`).join(' | '));
save('alt', out);
process.exit(0);
