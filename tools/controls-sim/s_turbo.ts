// Turbo gears on the real baked city (offline): Cruise -> Express -> Jet (the climb to the gear's height,
// engagement, the sonic boom) -> steering authority -> boost -> LOCKED -> Express -> Cruise (braking, the
// altitude held, the dive home) -> the map edge; the latched turbo's levels, up the nose, down the nose and
// at the map's edge; Express against a held surge; then Stratos with config.turbo.worldTravel on. Logs speed,
// altitude, camera.
import { newCity, pump, ll } from '../feel-sim/lib';
import { config } from '@src/config';
import { Flight } from '@src/game/Flight';
import { CameraRig } from '@src/game/CameraRig';
import { EXPRESS, JET, STRATOS, TurboDrive } from '@src/game/Turbo';
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
/** up to a gear, as flicks would be: one call a gear */
const shiftTo = (S: { drive: TurboDrive; f: Flight }, gear: number) => { while (S.drive.gear < gear) S.drive.shift(1, S.f); };

// ---- 1. Alamo Square, east: Cruise -> Express -> Jet -> steer -> boost -> LOCKED -> Express -> Cruise -> dive home
{
  const S = await session(37.7763, -122.4352, 88);
  await S.run(2, free, 'cruise');
  S.drive.shift(1, S.f);
  await S.run(2, free, 'express');
  const express = { speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), aboveRoofs: r1(S.f.lift), mode: S.f.mode };
  S.drive.shift(1, S.f);
  await S.run(7, free, 'jet');
  const jet = { speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), camDist: (S.log[S.log.length - 1] as any).camDist };
  await S.run(3, () => ({ sx: 1, sy: 0, dragging: true }), 'jet full right');
  const steer = { yawRate: +S.f.yawRate.toFixed(3), radiusM: Math.round(S.f.speed / Math.max(1e-3, S.f.yawRate)), bank: +S.f.bank.toFixed(2) };
  await S.run(1, free, 'jet');
  await S.run(2, () => ({ sx: 0, sy: 0, dragging: false, held: true }), 'jet boost');
  const boost = r1(S.f.speed);
  const lockedOk = !S.drive.shift(1, S.f);
  await S.run(1, free, 'jet locked');
  S.drive.shift(-1, S.f);
  await S.run(6, free, 'express after downshift');
  const down1 = { gear: S.drive.gear, speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), mode: S.f.mode };
  S.drive.shift(-1, S.f);
  await S.run(4, free, 'cruise after downshift');
  const after = { gear: S.drive.gear, speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), mode: S.f.mode };
  await S.run(8, () => ({ sx: 0, sy: 1, dragging: true }), 'cruise dive');
  res.alamo = { express, jet, steer, boostSpeed: boost, lockedRefused: lockedOk, downToExpress: down1, afterDownshift: after, end: { speed: r1(S.f.speed), aboveRoofs: r1(S.f.lift), mode: S.f.mode }, events: S.events, maxAltStepPerFrame: r1(S.maxStep()), log: S.log };
}
// ---- 2. steering authority at Cruise, the surge, Express and Jet (full stick, 3 s)
{
  const rows: unknown[] = [];
  for (const [label, gear, sy] of [['cruise', 0, 0], ['surge', 0, 1], ['express', EXPRESS, 0], ['jet', JET, 0]] as Array<[string, number, number]>) {
    const S = await session(37.7600, -122.4800, 0);
    if (gear) { shiftTo(S, gear); await S.run(8, free, label); }
    await S.run(3, () => ({ sx: 1, sy, dragging: true }), label);
    rows.push({ label, speed: r1(S.f.speed), yawRate: +S.f.yawRate.toFixed(3), radiusM: Math.round(S.f.speed / Math.max(1e-3, S.f.yawRate)), turn180s: r1(Math.PI / Math.max(1e-3, S.f.yawRate)), bank: +S.f.bank.toFixed(2) });
  }
  res.steering = rows;
}
// ---- 3. Cruise's boost (no gear): turbo's first level, on the surge, while held
{
  const S = await session(37.7600, -122.4800, 0);
  await S.run(3, () => ({ sx: 0, sy: 0, dragging: false, held: true }), 'cruise boost');
  const b = r1(S.f.speed);
  await S.run(3, free, 'cruise released');
  res.cruiseBoost = { held: b, released3s: r1(S.f.speed) };
}
// ---- 4. the map edge: Jet heading east from the Embarcadero; the gear fades, the homing turns it back
{
  const S = await session(37.7950, -122.3950, 90);
  shiftTo(S, JET);
  await S.run(30, free, 'edge');
  const out = S.log.map((r: any) => r.outside);
  res.edge = { maxOutsideM: Math.max(...out), events: S.events, log: S.log.filter((_: unknown, i: number) => i % 5 === 0) };
}
// ---- 5. turbo, latched: the levels at Cruise, Express and Jet, what it does at any height, and what ends it
{
  const pull = () => ({ sx: 0, sy: -1, dragging: true });
  const push = () => ({ sx: 0, sy: 1, dragging: true });
  const levels: unknown[] = [];
  for (const gear of [0, EXPRESS, JET]) {
    const S = await session(37.7150, -122.4400, 340);
    if (gear) {
      shiftTo(S, gear);
      await S.run(8, free, `g${gear}`);
    }
    const row: Record<string, unknown> = { gear, plain: r1(S.f.speed) };
    for (let lv = 1; lv <= config.turbo.levels.length; lv++) {
      S.drive.boostUp();
      await S.run(4, free, `g${gear} turbo ${lv}`);
      row[`level${lv}`] = r1(S.f.speed);
    }
    row.pastTheLast = S.drive.boostUp();
    S.drive.boostOff();
    await S.run(6, free, 'off');
    row.off6s = { speed: r1(S.f.speed), gear: S.drive.gear, level: S.drive.level };
    row.events = S.events.map((e: any) => e.ev);
    levels.push(row);
  }
  res.levels = levels;
  // pull with turbo on: up the nose, at the turbo's speed, from the street and with nothing held
  const nose: unknown[] = [];
  for (const lv of [1, 3]) {
    const S = await session(37.7600, -122.4800, 0);
    await S.run(1, free, 'cruise');
    for (let i = 0; i < lv; i++) S.drive.boostUp();
    await S.run(8, pull, `pull turbo ${lv}`);
    const up = { vy: r1(S.f.vy), forward: r1(S.f.ground), path: r1((Math.atan2(S.f.vy, S.f.ground) * 180) / Math.PI), y: r1(S.f.y), gear: S.drive.gear };
    await S.run(2, free, 'let go');
    const level = { vy: r1(S.f.vy), speed: r1(S.f.speed) };
    await S.run(6, push, `push turbo ${lv}`);
    nose.push({ level: lv, up, letGo: level, down: { vy: r1(S.f.vy), forward: r1(S.f.ground) } });
  }
  res.nose = nose;
}
// ---- 6. the map's edge at every turbo speed: Jet east from the Embarcadero, as section 4, with each level on; Cruise's and Express's
{
  const rows: unknown[] = [];
  for (const [gear, lv] of [[JET, 0], [JET, 1], [JET, 2], [JET, 3], [EXPRESS, 0], [EXPRESS, 3], [0, 1], [0, 3]] as Array<[number, number]>) {
    const S = await session(37.7950, -122.3950, 90);
    S.f.y += 400;
    S.f.holdY = S.f.y;
    shiftTo(S, gear);
    for (let i = 0; i < lv; i++) S.drive.boostUp();
    await S.run(30, free, 'edge');
    const log = S.log as any[];
    rows.push({ gear, level: lv, maxOutsideM: Math.max(...log.map((r) => r.outside)), topSpeed: Math.max(...log.map((r) => r.speed)), speedAtEdge: log.find((r) => r.outside > 0)?.speed ?? null, endSpeed: log[log.length - 1].speed, endOutside: log[log.length - 1].outside });
  }
  res.edgeLevels = rows;
}
// ---- 7. a mistaken launch: a flick down while Jet still lifts takes it back, with nothing to fly
{
  const rows: unknown[] = [];
  for (const after of [0.4, 1, 1.5]) {
    const S = await session(37.7763, -122.4352, 88);
    await S.run(2, free, 'cruise');
    const y0 = S.f.y;
    shiftTo(S, JET);
    await S.run(after, free, 'lifting');
    const up = { y: r1(S.f.y - y0), engaged: S.drive.engaged };
    S.drive.shift(-1, S.f);
    // (over the floor: at Express's speed the roofs run past fast enough to shake `lift`)
    let peak = S.f.y, t = 0;
    do {
      await S.run(0.1, free, 'taken back');
      peak = Math.max(peak, S.f.y);
      t += 0.1;
    } while (t < 40 && S.f.y > S.f.floorY + 3);
    rows.push({ after, up, peakOverStart: r1(peak - y0), secondsBack: r1(t), overFloorEnd: r1(S.f.y - S.f.floorY), gear: S.drive.gear, mode: S.f.mode });
  }
  res.takenBack = rows;
}
// ---- 8. Express against a held surge, flown side by side over the same blocks: it rides the rooftops with no lift (a held surge
// with the belly full is 12 % slower: a gear drives the speed whatever the belly). Then the flick down: nothing held, still skimming
{
  const out: Record<string, unknown> = {};
  const A = await session(37.7763, -122.4352, 88), B = await session(37.7763, -122.4352, 88);
  A.drive.shift(1, A.f);
  let worst = 0;
  for (let i = 0; i < 80; i++) {
    await A.run(0.1, free, 'express');
    await B.run(0.1, () => ({ sx: 0, sy: 1, dragging: true }), 'surge');
    worst = Math.max(worst, Math.abs(A.f.y - B.f.y));
  }
  out.afterEightSeconds = { express: { speed: r1(A.f.speed), y: r1(A.f.y), mode: A.f.mode, floor: A.f.turbo.floor }, surge: { speed: r1(B.f.speed), y: r1(B.f.y), mode: B.f.mode }, worstHeightGapM: r1(worst) };
  A.drive.shift(-1, A.f);
  await A.run(4, free, 'express let go');
  out.letGo = { gear: A.drive.gear, speed: r1(A.f.speed), mode: A.f.mode, hold: A.f.holdY, aboveRoofs: r1(A.f.lift) };
  // the pull: up the nose, as the boost does
  const P = await session(37.7600, -122.4800, 0);
  await P.run(1, free, 'cruise');
  P.drive.shift(1, P.f);
  await P.run(6, () => ({ sx: 0, sy: -1, dragging: true }), 'express pull');
  out.pull = { vy: r1(P.f.vy), forward: r1(P.f.ground), speed: r1(P.f.speed), path: r1((Math.atan2(P.f.vy, P.f.ground) * 180) / Math.PI), y: r1(P.f.y) };
  await P.run(2, free, 'let go');
  await P.run(6, () => ({ sx: 0, sy: 1, dragging: true }), 'express push');
  out.push = { vy: r1(P.f.vy), forward: r1(P.f.ground), speed: r1(P.f.speed) };
  // the hop: two spaced flicks, the second this long after Express bit: Jet's lift starts from Express's speed, and never gives any back
  const hop: unknown[] = [];
  for (const gap of [0.1, 0.4, 1]) {
    const S = await session(37.7763, -122.4352, 88);
    await S.run(2, free, 'cruise');
    S.drive.shift(1, S.f);
    await S.run(gap, free, 'express');
    const atShift = r1(S.f.speed);
    S.drive.shift(1, S.f);
    let worstStep = 0, last = S.f.speed, slowest = S.f.speed;
    for (let i = 0; i < 30; i++) {
      await S.run(0.1, free, 'lift');
      worstStep = Math.max(worstStep, last - S.f.speed);
      slowest = Math.min(slowest, S.f.speed);
      last = S.f.speed;
    }
    hop.push({ gap, atShift, slowest: r1(slowest), speedAt3s: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), engaged: S.drive.engaged, worstLossPer100ms: r1(worstStep) });
  }
  out.hop = hop;
  res.express = out;
}
// ---- 9. world travel on: Stratos (climb to 2 km, ~4.5 km/s)
{
  config.turbo.worldTravel = true;
  const S = await session(37.7600, -122.4800, 270);
  shiftTo(S, JET);
  await S.run(6, free, 'wt jet');
  S.drive.shift(1, S.f);
  await S.run(35, free, 'wt stratos');
  res.worldTravelStratos = { gear: S.drive.gear, isStratos: S.drive.gear === STRATOS, speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), events: S.events, log: S.log.filter((_: unknown, i: number) => i % 10 === 0) };
  config.turbo.worldTravel = false;
}
const OUT = process.env.SB_OUT ?? 'shots/controls/sim';
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/turbo.json`, JSON.stringify(res, null, 1));
const a = res.alamo as any;
console.log('alamo express:', JSON.stringify(a.express), 'jet:', JSON.stringify(a.jet), 'steer:', JSON.stringify(a.steer), 'boost:', a.boostSpeed, 'locked refused:', a.lockedRefused);
console.log('down to express (6 s):', JSON.stringify(a.downToExpress), 'then cruise (4 s):', JSON.stringify(a.afterDownshift), 'after dive:', JSON.stringify(a.end), 'max alt step/frame:', a.maxAltStepPerFrame);
console.log('events:', JSON.stringify(a.events));
for (const r of a.log.filter((_: unknown, i: number) => i % 5 === 0)) console.log(JSON.stringify(r));
console.log('steering:', JSON.stringify(res.steering));
console.log('cruise boost:', JSON.stringify(res.cruiseBoost));
console.log('edge: max outside', (res.edge as any).maxOutsideM, JSON.stringify((res.edge as any).events));
for (const r of (res.edge as any).log) console.log('  ', JSON.stringify(r));
console.log('levels:', JSON.stringify(res.levels));
console.log('nose:', JSON.stringify(res.nose));
console.log('edge, by level:', JSON.stringify(res.edgeLevels));
console.log('taken back:', JSON.stringify(res.takenBack));
console.log('express:', JSON.stringify(res.express));
console.log('world travel, Stratos:', JSON.stringify({ ...(res.worldTravelStratos as any), log: undefined }));
for (const r of (res.worldTravelStratos as any).log) console.log('  ', JSON.stringify(r));
