// The glint's claim where the line of fire ends on a building (the first account's re-review of life, M10): the real City, Flight and Aimer with the real
// LifeHost and the real cars of a Thursday's 17:30 round each place, no browser: node tools/feel-sim/run.mjs ../life/s_glint.ts
// From 160 poses a place and height (over a street a car is on, 100 m back of it, the nose up to half a radian off the street's line, 45 m and 150 m over the
// ground), 20 frames each: on every frame whose aim point the obstacle grid itself says is a building's (the grid there a building's height over the ground, a
// building within 9 m: not the aim's own predicate), does a vehicle have the glint? And on the frames it says are the street, do vehicles still take it?
//   steal    a building's frame where a vehicle glints: under 1 % of them in every place and height
//   street   the street's frames where a vehicle glints: still a fair share (the fix mustn't take the cars' hits)
// Prints a row a place and height, and exits 1 if a row fails.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { config, ll, makeGame, manifest, newCity, pump, THREE } from '../feel-sim/lib';
import { DATA_DIR } from '../feel-sim/env';
import { LifeHost } from '../../src/life/Life';
import { Col, Kind, ROW } from '../../src/life/kinds';
import { Pools } from '../../src/life/pools';
import { buildNet, carsOn } from '../../src/life/sim/cars';
import { SNAP_BYTES, view, writeKey } from '../../src/life/snapshot';
import { globals } from '../../src/render/materials';
import { parseRegionGraph } from '../../src/world/lifeData';

const PLACES: Array<[string, number, number]> = [
  ['mission', 37.7599, -122.4148],
  ['fidi', 37.7925, -122.401],
  ['sunset', 37.755, -122.49],
];
const T0 = Date.parse('2026-11-05T17:30:00-08:00'), TZ = -480, M = manifest.regionSize * manifest.tileSize, MIN = config.splat.minTargetHeight;
(globals.uPixelAngle as { value: number }).value = ((24 * Math.PI) / 180) / 393;
const city = await newCity();
const camera = new THREE.PerspectiveCamera(24, 393 / 852, 1.5, 30000);
let bad = 0, r = 7;
const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
for (const [name, lat, lon] of PLACES) {
  const [x0, z0] = ll(lat, lon);
  await pump(city, x0, z0);
  // (the place's cars: the road graphs within 1.5 km, the cars within 1.2 km of its middle, as the worker's snapshot has them)
  const graphs = [];
  for (const [rx, rz] of manifest.life.regions as Array<[number, number]>) {
    if (Math.hypot(Math.max(rx * M - x0, 0, x0 - (rx + 1) * M), Math.max(rz * M - z0, 0, z0 - (rz + 1) * M)) > 1500) continue;
    let b = readFileSync(`${DATA_DIR}/g_${rx}_${rz}.bin`);
    if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
    const g = parseRegionGraph(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, M);
    if (g) graphs.push(g);
  }
  graphs.sort((p, q) => p.rx - q.rx || p.rz - q.rz);
  const net = buildNet(graphs), buf = new ArrayBuffer(SNAP_BYTES), v = view(buf);
  let keyAt = 0;
  const n = carsOn(net, T0, TZ, x0, z0, 1200, 1200, 1, v.rows, 0, 3000, (h, k) => (keyAt = writeKey(v, keyAt, h, k)));
  v.u32[3] = Math.max(0, keyAt);
  v.f64[0] = T0;
  v.u32[2] = n;
  const worker = { postMessage: () => {}, onmessage: null as null | ((e: { data: unknown }) => void) };
  const life = new LifeHost(worker as unknown as Worker, new Pools(), { put() {}, clear() {}, load: async () => [] } as never, 'sf', [37.7749, -122.4194]);
  worker.onmessage!({ data: { type: 'snap', buf } });
  for (const H of [45, 150]) {
    let frames = 0, building = 0, steal = 0, street = 0, taken = 0, worst = '';
    for (let p = 0; p < 160; p++) {
      const o = Math.floor(rand() * n) * ROW, vx = v.rows[o + Col.VX], vz = v.rows[o + Col.VZ], sp = Math.hypot(vx, vz) || 1, ux = vx / sp, uz = vz / sp;
      const g = makeGame(city), f = g.flight, yaw = (rand() - 0.5) * 1;
      (g.aimer as unknown as { life: LifeHost }).life = life;
      f.x = v.rows[o + Col.X] - ux * 100;
      f.z = v.rows[o + Col.Z] - uz * 100;
      f.heading = Math.atan2(ux, -uz) + yaw;
      f.y = city.groundAt(f.x, f.z) + H;
      await pump(city, f.x, f.z);
      for (let k = 0; k < 20; k++) {
        camera.position.set(f.x, f.y + 20, f.z);
        camera.updateMatrixWorld();
        life.frame(1 / 30, 1 + k / 30, T0, f, camera);
        g.frame(1 / 30, { sx: 0, sy: 0, dragging: false });
        const A = g.aimer as unknown as { aim: { x: number; y: number; z: number }; mover: { key: string; onLine: boolean; x: number; z: number } | null };
        const shown = g.aimer.shown(), a = A.aim, m = A.mover, ground = !!m && m.onLine;
        frames++;
        // (the grid's own word for it, not the aim's: a building's height over the ground at the aim point, and a building within 9 m of it)
        const onBuilding = !!shown && city.obstacleAt(a.x, a.z) - city.groundAt(a.x, a.z) >= MIN && !!city.nearestBuilding(a.x, a.z, 9, MIN, f.y);
        if (onBuilding) {
          building++;
          if (ground) {
            steal++;
            if (!worst) worst = `${m!.key} ${Math.round(Math.hypot(m!.x - a.x, m!.z - a.z))} m from the aim point, pose ${p}`;
          }
        } else if (!shown || city.obstacleAt(a.x, a.z) - city.groundAt(a.x, a.z) < MIN) {
          street++;
          if (ground) taken++;
        }
      }
    }
    const share = building ? steal / building : 0, ok = building > 300 && share < 0.01 && taken / Math.max(1, street) > 0.02;
    if (!ok) bad++;
    console.log(`${ok ? 'pass' : 'FAIL'}  ${`${name} at ${H} m`.padEnd(18)} ${JSON.stringify({ cars: n, frames, building, steals: steal, stealShare: +(100 * share).toFixed(2) + ' %', street, vehicleOnStreetShare: +(100 * taken / Math.max(1, street)).toFixed(1) + ' %', first: worst })}`);
  }
}
void Kind;
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
