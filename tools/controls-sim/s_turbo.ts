// Turbo gears on the real baked city (offline): G0 -> G1 (the climb to the gear's height, engagement,
// the sonic boom) -> steering authority -> boost -> LOCKED -> G0 (braking, the altitude held, the dive
// home) -> the map edge; then G2 with config.turbo.worldTravel on. Logs speed, altitude, camera.
import { newCity, pump, ll } from '../feel-sim/lib';
import { config } from '@src/config';
import { Flight } from '@src/game/Flight';
import { CameraRig } from '@src/game/CameraRig';
import { TurboDrive } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';

const city = await newCity();
const manifest = (city as any).manifest ?? JSON.parse((await import('node:fs')).readFileSync(`${process.env.SB_DATA}/city.json`, 'utf8'));
const [minX, minZ, maxX, maxZ] = manifest.bounds as number[];
const r1 = (x: number) => Math.round(x * 10) / 10;
const dt = 1 / 60;
const res: Record<string, unknown> = {};

function rigFor() {
  const cam = new THREE.PerspectiveCamera(50, 393 / 852, 1, 30000);
  return { cam, rig: new CameraRig(), focus: new THREE.Vector3() };
}

async function session(lat: number, lon: number, hdg: number) {
  const [x0, z0] = ll(lat, lon);
  await pump(city, x0, z0);
  const f = new Flight();
  f.x = x0; f.z = z0; f.heading = (hdg * Math.PI) / 180; f.y = city.obstacleAt(x0, z0) + 9; f.glideSpeed = 0; f.fullness = 0;
  const drive = new TurboDrive([minX, minZ, maxX, maxZ]);
  const lens = new TurboLens();
  const { cam, rig, focus } = rigFor();
  const events: unknown[] = [];
  let t = 0;
  drive.onEvent = (ev, g) => {
    events.push({ t: r1(t), ev, gear: g, speed: r1(f.speed), agl: r1(f.y - f.groundBroad) });
    if (ev === 'boom' || ev === 'up' || ev === 'engage') lens.punch(ev === 'boom' ? config.turbo.fovKick : config.turbo.fovKick * 0.45);
  };
  const log: unknown[] = [];
  let maxStep = 0;
  /** run for `secs`, input per frame; log every 0.1 s */
  const run = async (secs: number, inp: () => { sx: number; sy: number; dragging: boolean; held?: boolean }, tag: string) => {
    const n = Math.round(secs / dt);
    for (let k = 0; k < n; k++) {
      if (k % 10 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
      const i = inp();
      drive.update(dt, f, !!i.held);
      // main.ts's map-edge homing, unchanged
      let sx = i.sx;
      const ex = Math.max(minX - f.x, f.x - maxX, 0), ez = Math.max(minZ - f.z, f.z - maxZ, 0);
      if (ex + ez > 300) {
        const home = Math.atan2((minX + maxX) / 2 - f.x, -((minZ + maxZ) / 2 - f.z));
        let dh = home - f.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        sx = Math.max(-1, Math.min(1, sx + Math.max(-1, Math.min(1, dh)) * Math.max(0, Math.min(1, (ex + ez - 300) / 600))));
      }
      const y0 = f.y;
      for (let s = 0; s < 2; s++) f.step(dt / 2, { sx, sy: i.sy, dragging: i.dragging || sx !== i.sx }, city);
      maxStep = Math.max(maxStep, Math.abs(f.y - y0));
      lens.update(dt, drive, rig, f);
      rig.update(cam, focus, f, dt);
      t += dt;
      if (k % 6 === 0) {
        const camToBus = cam.position.distanceTo(new THREE.Vector3(f.x, f.y, f.z));
        log.push({ tag, t: r1(t), gear: drive.gear, engaged: drive.engaged, speed: r1(f.speed), mph: Math.round(f.speed * 2.237), y: r1(f.y), agl: r1(f.y - f.groundBroad), aboveRoofs: r1(f.lift), mode: f.mode, strain: +drive.strain.toFixed(2), yaw: +f.yawRate.toFixed(3), edge: +drive.edge.toFixed(2), camDist: r1(camToBus), camAbove: r1(cam.position.y - f.y), hfov: r1(rig.hfov), pull: r1(lens.pull), outside: r1(ex + ez) });
      }
    }
  };
  return { f, drive, lens, rig, events, log, run, get t() { return t; }, maxStep: () => maxStep };
}
const free = () => ({ sx: 0, sy: 0, dragging: false });

// ---- 1. Alamo Square, east: G0 cruise -> G1 -> steer -> boost -> LOCKED -> G0 -> dive home
{
  const S = await session(37.7763, -122.4352, 88);
  await S.run(2, free, 'g0 cruise');
  S.drive.shift(1, S.f);
  await S.run(7, free, 'g1');
  const g1 = { speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), camDist: (S.log[S.log.length - 1] as any).camDist };
  await S.run(3, () => ({ sx: 1, sy: 0, dragging: true }), 'g1 full right');
  const steer = { yawRate: +S.f.yawRate.toFixed(3), radiusM: Math.round(S.f.speed / Math.max(1e-3, S.f.yawRate)), bank: +S.f.bank.toFixed(2) };
  await S.run(1, free, 'g1');
  await S.run(2, () => ({ sx: 0, sy: 0, dragging: false, held: true }), 'g1 boost');
  const boost = r1(S.f.speed);
  const lockedOk = !S.drive.shift(1, S.f);
  await S.run(1, free, 'g1 locked');
  S.drive.shift(-1, S.f);
  await S.run(6, free, 'g0 after downshift');
  const after = { speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), mode: S.f.mode };
  await S.run(8, () => ({ sx: 0, sy: 1, dragging: true }), 'g0 dive');
  res.alamo = { g1, steer, boostSpeed: boost, lockedRefused: lockedOk, afterDownshift: after, end: { speed: r1(S.f.speed), aboveRoofs: r1(S.f.lift), mode: S.f.mode }, events: S.events, maxAltStepPerFrame: r1(S.maxStep()), log: S.log };
}
// ---- 2. steering authority at G0 cruise / surge / G1 (full stick, 3 s)
{
  const rows: unknown[] = [];
  for (const [label, gear, sy] of [['G0 cruise', 0, 0], ['G0 surge', 0, 1], ['G1 jet', 1, 0]] as Array<[string, number, number]>) {
    const S = await session(37.7600, -122.4800, 0);
    if (gear) { S.drive.shift(1, S.f); await S.run(8, free, label); }
    await S.run(3, () => ({ sx: 1, sy, dragging: true }), label);
    rows.push({ label, speed: r1(S.f.speed), yawRate: +S.f.yawRate.toFixed(3), radiusM: Math.round(S.f.speed / Math.max(1e-3, S.f.yawRate)), turn180s: r1(Math.PI / Math.max(1e-3, S.f.yawRate)), bank: +S.f.bank.toFixed(2) });
  }
  res.steering = rows;
}
// ---- 3. G0 boost (no gear): a full surge while held
{
  const S = await session(37.7600, -122.4800, 0);
  await S.run(3, () => ({ sx: 0, sy: 0, dragging: false, held: true }), 'g0 boost');
  const b = r1(S.f.speed);
  await S.run(3, free, 'g0 released');
  res.g0Boost = { held: b, released3s: r1(S.f.speed) };
}
// ---- 4. the map edge: G1 heading east from the Embarcadero; the gear fades, the homing turns it back
{
  const S = await session(37.7950, -122.3950, 90);
  S.drive.shift(1, S.f);
  await S.run(30, free, 'edge');
  const out = S.log.map((r: any) => r.outside);
  res.edge = { maxOutsideM: Math.max(...out), events: S.events, log: S.log.filter((_: unknown, i: number) => i % 5 === 0) };
}
// ---- 5. world travel on: G2 (climb to 2 km, ~4.5 km/s)
{
  config.turbo.worldTravel = true;
  const S = await session(37.7600, -122.4800, 270);
  S.drive.shift(1, S.f);
  await S.run(6, free, 'wt g1');
  S.drive.shift(1, S.f);
  await S.run(35, free, 'wt g2');
  res.worldTravelG2 = { gear: S.drive.gear, speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), events: S.events, log: S.log.filter((_: unknown, i: number) => i % 10 === 0) };
  config.turbo.worldTravel = false;
}
mkdirSync('shots/controls/sim', { recursive: true });
writeFileSync('shots/controls/sim/turbo.json', JSON.stringify(res, null, 1));
const a = res.alamo as any;
console.log('alamo G1:', JSON.stringify(a.g1), 'steer:', JSON.stringify(a.steer), 'boost:', a.boostSpeed, 'locked refused:', a.lockedRefused);
console.log('after downshift (6 s):', JSON.stringify(a.afterDownshift), 'after dive:', JSON.stringify(a.end), 'max alt step/frame:', a.maxAltStepPerFrame);
console.log('events:', JSON.stringify(a.events));
for (const r of a.log.filter((_: unknown, i: number) => i % 5 === 0)) console.log(JSON.stringify(r));
console.log('steering:', JSON.stringify(res.steering));
console.log('g0 boost:', JSON.stringify(res.g0Boost));
console.log('edge: max outside', (res.edge as any).maxOutsideM, JSON.stringify((res.edge as any).events));
for (const r of (res.edge as any).log) console.log('  ', JSON.stringify(r));
console.log('world travel G2:', JSON.stringify({ ...(res.worldTravelG2 as any), log: undefined }));
for (const r of (res.worldTravelG2 as any).log) console.log('  ', JSON.stringify(r));
