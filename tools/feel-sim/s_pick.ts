// Aim INTO footprints (area-weighted): does pick() return that building (tallest containing)? + pick cost.
import { newCity, pump, ll, makeGame, MODE, save } from './lib';
const city = await newCity();
const g = makeGame(city);
const sp = g.splatter as any;
const spots: Array<[string, number, number]> = [['FiDi', 37.7925, -122.401], ['SoMa', 37.779, -122.405], ['MissionBay', 37.77, -122.392], ['Dogpatch', 37.758, -122.388], ['Alamo', 37.7762, -122.4346], ['Sunset', 37.755, -122.49]];
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const res: any[] = [];
for (const [name, lat, lon] of spots) {
  const [x0, z0] = ll(lat, lon);
  await pump(city, x0, z0);
  const refs = [...city.loadedRefs()].filter((r: any) => Math.hypot(r.cx - x0, r.cz - z0) < 450);
  const truthAt = (x: number, z: number) => {
    let best: any = null;
    for (const n of city.buildingsNear(x, z, 260, [])) if (city.contains(n.ref, x, z) && (!best || n.ref.roofY > best.roofY)) best = n.ref;
    return best;
  };
  let n = 0, wrong = 0, miss = 0, areaBad = 0, areaAll = 0, towers = 0, towersBad = 0;
  for (const r of refs as any[]) {
    const b = r.tile, s = b.vertStart[r.local], e = b.vertStart[r.local + 1];
    let x0b = Infinity, x1b = -Infinity, z0b = Infinity, z1b = -Infinity;
    for (let k = s; k < e; k++) { x0b = Math.min(x0b, b.xz[k * 2]); x1b = Math.max(x1b, b.xz[k * 2]); z0b = Math.min(z0b, b.xz[k * 2 + 1]); z1b = Math.max(z1b, b.xz[k * 2 + 1]); }
    const want = Math.max(1, Math.round(r.area / 60));
    let got = 0, bad = 0;
    for (let tries = 0; got < want && tries < want * 25; tries++) {
      const x = x0b + rnd() * (x1b - x0b), z = z0b + rnd() * (z1b - z0b);
      if (!city.contains(r, x, z)) continue;
      const tr = truthAt(x, z);
      if (!tr || tr.roofY - tr.baseY < 2.5) continue;
      got++; n++;
      const p = sp.pick(x, z);
      if (p !== tr) { bad++; if (p) wrong++; else miss++; }
    }
    if (got) { areaAll += r.area; areaBad += (r.area * bad) / got; }
    if (r.roofY - r.baseY > 40 && got) { towers += got; towersBad += bad; }
  }
  // cost of one pick at random points around (street + roofs)
  const t0 = performance.now();
  let k = 0;
  for (; k < 20000; k++) sp.pick(x0 + (rnd() - 0.5) * 600, z0 + (rnd() - 0.5) * 600);
  const us = ((performance.now() - t0) * 1000) / k;
  res.push({ name, aims: n, wrong, miss, unhittableArea: +((100 * areaBad) / areaAll).toFixed(1), towerAims: towers, towerBad: towersBad, pickUs: +us.toFixed(2) });
}
console.log(`[${MODE}]`, JSON.stringify(res));
save('pick', res);
process.exit(0);
