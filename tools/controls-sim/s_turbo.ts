// The ladder on the real baked city (offline), one rung at a time as flicks go: Cruise -> Express -> Nonstop -> Jet (the climb to
// each gear's height, engagement, the sonic boom) -> steering authority -> TURBO, TURBO 2, TURBO 3 -> LOCKED -> all the way back
// down (braking, the altitude held, the dive home) -> the map edge at every rung; up the nose, down the nose; Express against a
// held surge; the hop through the rungs; a gear taken back; then the ladder with config.turbo.worldTravel on, turbo over Rainbow
// Warp. Logs speed, altitude, camera. Every verdict is at the end, and the process fails if one is false.
import { newCity, pump, ll } from '../feel-sim/lib';
import { config } from '@src/config';
import { Flight } from '@src/game/Flight';
import { CameraRig } from '@src/game/CameraRig';
import { EXPRESS, JET, NONSTOP, SCHOOL_ZONE, STRATOS, TurboDrive, WARP } from '@src/game/Turbo';
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

/** `open`: no map's edge, for what a rung does with the length of the map behind it */
async function session(lat: number, lon: number, hdg: number, open = false) {
  const [x0, z0] = ll(lat, lon);
  await pump(city, x0, z0);
  const f = new Flight();
  f.x = x0; f.z = z0; f.heading = (hdg * Math.PI) / 180; f.y = city.obstacleAt(x0, z0) + 9; f.glideSpeed = 0; f.fullness = 0;
  const drive = new TurboDrive(open ? [-1e7, -1e7, 1e7, 1e7] : [minX, minZ, maxX, maxZ]);
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
  const run = async (secs: number, inp: () => { sx: number; sy: number; dragging: boolean }, tag: string) => {
    const n = Math.round(secs / dt);
    for (let k = 0; k < n; k++) {
      if (k % 10 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
      const i = inp();
      drive.update(dt, f);
      // main.ts's map-edge homing, unchanged
      let sx = i.sx;
      const ex = Math.max(minX - f.x, f.x - maxX, 0), ez = Math.max(minZ - f.z, f.z - maxZ, 0);
      if (!open && ex + ez > 300) {
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
        log.push({ tag, t: r1(t), gear: drive.gear, level: drive.level, engaged: drive.engaged, speed: r1(f.speed), mph: Math.round(f.speed * 2.237), y: r1(f.y), agl: r1(f.y - f.groundBroad), aboveRoofs: r1(f.lift), mode: f.mode, strain: +drive.strain.toFixed(2), speedK: +drive.speedK.toFixed(2), yaw: +f.yawRate.toFixed(3), edge: +drive.edge.toFixed(2), camDist: r1(camToBus), camAbove: r1(cam.position.y - f.y), hfov: r1(rig.hfov), pull: r1(lens.pull), outside: r1(ex + ez) });
      }
    }
  };
  return { f, drive, lens, rig, events, log, run, get t() { return t; }, maxStep: () => maxStep };
}
const free = () => ({ sx: 0, sy: 0, dragging: false });
const pull = () => ({ sx: 0, sy: -1, dragging: true });
const push = () => ({ sx: 0, sy: 1, dragging: true });
/** up the ladder, as flicks would be: one call a rung */
const climbTo = (S: { drive: TurboDrive; f: Flight }, gear: number, level = 0) => { while (S.drive.gear < gear || S.drive.level < level) S.drive.rung(1, S.f); };
/** how fast the speed changes at its worst (m/s per 100 ms), the way down */
const worstLoss = (log: any[], from: number) => { let w = 0; const l = log.filter((r) => r.t >= from); for (let i = 1; i < l.length; i++) w = Math.max(w, l[i - 1].speed - l[i].speed); return w; };

// ---- 1. Alamo Square, east: up every rung, then back down every rung
{
  const S = await session(37.7763, -122.4352, 88, true);
  await S.run(2, free, 'cruise');
  S.drive.rung(1, S.f);
  await S.run(2, free, 'express');
  const express = { speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), aboveRoofs: r1(S.f.lift), mode: S.f.mode };
  S.drive.rung(1, S.f);
  await S.run(6, free, 'nonstop');
  const nonstop = { speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), aboveRoofs: r1(S.f.lift), engaged: S.drive.engaged, camDist: (S.log[S.log.length - 1] as any).camDist };
  S.drive.rung(1, S.f);
  await S.run(7, free, 'jet');
  const jet = { speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), camDist: (S.log[S.log.length - 1] as any).camDist };
  await S.run(3, () => ({ sx: 1, sy: 0, dragging: true }), 'jet full right');
  const steer = { yawRate: +S.f.yawRate.toFixed(3), radiusM: Math.round(S.f.speed / Math.max(1e-3, S.f.yawRate)), bank: +S.f.bank.toFixed(2) };
  await S.run(1, free, 'jet');
  const up: number[] = [];
  for (let lv = 1; lv <= config.turbo.levels.length; lv++) {
    S.drive.rung(1, S.f);
    await S.run(3, free, `turbo ${lv}`);
    up.push(r1(S.f.speed));
  }
  const lockedRefused = !S.drive.rung(1, S.f);
  await S.run(1, free, 'locked');
  const down: unknown[] = [];
  for (const [rungName, secs] of [['turbo 2', 4], ['turbo 1', 4], ['jet', 4], ['nonstop', 6], ['express', 6], ['cruise', 4]] as Array<[string, number]>) {
    const from = S.t;
    S.drive.rung(-1, S.f);
    const y0 = S.f.y;
    await S.run(secs, free, `down to ${rungName}`);
    down.push({ rung: rungName, gear: S.drive.gear, level: S.drive.level, speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), heldWithin: r1(Math.abs(S.f.y - y0)), mode: S.f.mode, worstLossPer100ms: r1(worstLoss(S.log, from)) });
  }
  await S.run(8, push, 'cruise dive');
  res.alamo = { express, nonstop, jet, steer, turboUp: up, lockedRefused, down, end: { speed: r1(S.f.speed), aboveRoofs: r1(S.f.lift), mode: S.f.mode }, events: S.events, maxAltStepPerFrame: r1(S.maxStep()), log: S.log };
}
// ---- 2. steering authority at Cruise, the surge, Express, Nonstop and Jet (full stick, 3 s)
{
  const rows: unknown[] = [];
  for (const [label, gear, sy] of [['cruise', 0, 0], ['surge', 0, 1], ['express', EXPRESS, 0], ['nonstop', NONSTOP, 0], ['jet', JET, 0]] as Array<[string, number, number]>) {
    const S = await session(37.7600, -122.4800, 0);
    if (gear) { climbTo(S, gear); await S.run(8, free, label); }
    await S.run(3, () => ({ sx: 1, sy, dragging: true }), label);
    rows.push({ label, speed: r1(S.f.speed), yawRate: +S.f.yawRate.toFixed(3), radiusM: Math.round(S.f.speed / Math.max(1e-3, S.f.yawRate)), turn180s: r1(Math.PI / Math.max(1e-3, S.f.yawRate)), bank: +S.f.bank.toFixed(2) });
  }
  res.steering = rows;
}
// ---- 3. the map edge: Jet heading east from the Embarcadero; the gear fades, the homing turns it back
{
  const S = await session(37.7950, -122.3950, 90);
  climbTo(S, JET);
  await S.run(30, free, 'edge');
  const out = S.log.map((r: any) => r.outside);
  res.edge = { maxOutsideM: Math.max(...out), events: S.events, log: S.log.filter((_: unknown, i: number) => i % 5 === 0) };
}
// ---- 4. turbo: the rungs over Jet, up the length of the map, then a level at a time back down; up and down the nose
{
  const S = await session(37.7150, -122.4400, 340, true);
  climbTo(S, JET);
  await S.run(8, free, 'jet');
  const row: Record<string, unknown> = { plain: r1(S.f.speed) };
  for (let lv = 1; lv <= config.turbo.levels.length; lv++) {
    S.drive.rung(1, S.f);
    await S.run(4, free, `turbo ${lv}`);
    row[`level${lv}`] = r1(S.f.speed);
  }
  row.pastTheLast = S.drive.rung(1, S.f);
  for (let lv = config.turbo.levels.length - 1; lv >= 0; lv--) {
    S.drive.rung(-1, S.f);
    await S.run(5, free, `down to ${lv}`);
    row[`downTo${lv}`] = { speed: r1(S.f.speed), level: S.drive.level, gear: S.drive.gear };
  }
  row.events = S.events.map((e: any) => e.ev);
  res.levels = row;
  // the nose, from Nonstop's height: pull with a gear in and the speed goes up it, and at turbo's too
  const nose: unknown[] = [];
  for (const [name, gear, lv] of [['nonstop', NONSTOP, 0], ['jet', JET, 0], ['turbo', JET, 1], ['turbo 3', JET, 3]] as Array<[string, number, number]>) {
    const S2 = await session(37.7600, -122.4800, 0);
    await S2.run(1, free, 'cruise');
    climbTo(S2, gear, lv);
    await S2.run(8, free, name);
    await S2.run(gear === NONSTOP ? 6 : 8, pull, `pull ${name}`);
    const up = { vy: r1(S2.f.vy), forward: r1(S2.f.ground), speed: r1(S2.f.speed), path: r1((Math.atan2(S2.f.vy, S2.f.ground) * 180) / Math.PI), y: r1(S2.f.y), gear: S2.drive.gear };
    await S2.run(2, free, 'let go');
    const level = { vy: r1(S2.f.vy), speed: r1(S2.f.speed) };
    await S2.run(6, push, `push ${name}`);
    nose.push({ name, up, letGo: level, down: { vy: r1(S2.f.vy), forward: r1(S2.f.ground) } });
  }
  res.nose = nose;
}
// ---- 5. the map's edge at every rung: east from the Embarcadero, 400 m up, as section 3
{
  const rows: unknown[] = [];
  for (const [gear, lv] of [[0, 0], [EXPRESS, 0], [NONSTOP, 0], [JET, 0], [JET, 1], [JET, 2], [JET, 3]] as Array<[number, number]>) {
    const S = await session(37.7950, -122.3950, 90);
    S.f.y += 400;
    S.f.holdY = S.f.y;
    climbTo(S, gear, lv);
    await S.run(60, free, 'edge');
    const log = S.log as any[];
    rows.push({ gear, level: lv, maxOutsideM: Math.max(...log.map((r) => r.outside)), topSpeed: Math.max(...log.map((r) => r.speed)), speedAtEdge: log.find((r) => r.outside > 0)?.speed ?? null, endSpeed: log[log.length - 1].speed, endOutside: log[log.length - 1].outside });
  }
  res.edgeLevels = rows;
}
// ---- 6. a mistaken launch: a flick down while a gear still lifts takes it back, with nothing to fly
{
  const rows: unknown[] = [];
  for (const [name, gear, after] of [['nonstop', NONSTOP, 0.3], ['nonstop', NONSTOP, 0.6], ['jet over nonstop', JET, 0.4], ['jet over nonstop', JET, 0.9]] as Array<[string, number, number]>) {
    const S = await session(37.7763, -122.4352, 88);
    await S.run(2, free, 'cruise');
    const y0 = S.f.y;
    climbTo(S, gear - 1);
    if (gear > NONSTOP) await S.run(6, free, 'below');
    const y1 = S.f.y;
    S.drive.rung(1, S.f);
    await S.run(after, free, 'lifting');
    const up = { y: r1(S.f.y - y1), engaged: S.drive.engaged };
    S.drive.rung(-1, S.f);
    // (over the floor: at Express's speed the roofs run past fast enough to shake `lift`)
    let peak = S.f.y, t = 0;
    do {
      await S.run(0.1, free, 'taken back');
      peak = Math.max(peak, S.f.y);
      t += 0.1;
    } while (t < 40 && S.f.y > S.f.floorY + 3);
    rows.push({ name, after, up, y0: r1(y0), peakOverStart: r1(peak - y1), secondsBack: r1(t), overFloorEnd: r1(S.f.y - S.f.floorY), gear: S.drive.gear, engaged: S.drive.engaged, mode: S.f.mode });
  }
  res.takenBack = rows;
}
// ---- 7. Express against a held surge, flown side by side over the same blocks: it rides the rooftops with no lift (a held surge
// with the belly full is 12 % slower: a gear drives the speed whatever the belly). Then the flick down: nothing held, still skimming
{
  const out: Record<string, unknown> = {};
  const A = await session(37.7763, -122.4352, 88), B = await session(37.7763, -122.4352, 88);
  A.drive.rung(1, A.f);
  let worst = 0;
  for (let i = 0; i < 80; i++) {
    await A.run(0.1, free, 'express');
    await B.run(0.1, () => ({ sx: 0, sy: 1, dragging: true }), 'surge');
    worst = Math.max(worst, Math.abs(A.f.y - B.f.y));
  }
  out.afterEightSeconds = { express: { speed: r1(A.f.speed), y: r1(A.f.y), mode: A.f.mode, floor: A.f.turbo.floor }, surge: { speed: r1(B.f.speed), y: r1(B.f.y), mode: B.f.mode }, worstHeightGapM: r1(worst) };
  A.drive.rung(-1, A.f);
  await A.run(4, free, 'express let go');
  out.letGo = { gear: A.drive.gear, speed: r1(A.f.speed), mode: A.f.mode, hold: A.f.holdY, aboveRoofs: r1(A.f.lift) };
  // the pull: up the nose, as the boost does
  const P = await session(37.7600, -122.4800, 0);
  await P.run(1, free, 'cruise');
  P.drive.rung(1, P.f);
  await P.run(6, pull, 'express pull');
  out.pull = { vy: r1(P.f.vy), forward: r1(P.f.ground), speed: r1(P.f.speed), path: r1((Math.atan2(P.f.vy, P.f.ground) * 180) / Math.PI), y: r1(P.f.y) };
  await P.run(2, free, 'let go');
  await P.run(6, push, 'express push');
  out.push = { vy: r1(P.f.vy), forward: r1(P.f.ground), speed: r1(P.f.speed) };
  res.express = out;
}
// ---- 8. the hop: rung after rung from the rooftops, this far apart, and what the speed, the climb, the lens and the voice's inputs do
{
  const rows: unknown[] = [];
  for (const gap of [0.1, 0.4, 1, 2, 4]) {
    const S = await session(37.7763, -122.4352, 88, true);
    await S.run(2, free, 'cruise');
    const t0 = S.t;
    const ladder: unknown[] = [];
    let worstLossAny = 0, last = S.f.speed, worstVy = 0;
    const span = async (secs: number) => {
      for (let i = 0; i < Math.round(secs / 0.05); i++) {
        await S.run(0.05, free, 'hop');
        worstLossAny = Math.max(worstLossAny, last - S.f.speed);
        worstVy = Math.max(worstVy, S.f.vy);
        last = S.f.speed;
      }
    };
    for (let g = EXPRESS; g <= JET; g++) {
      S.drive.rung(1, S.f);
      ladder.push({ gear: g, t: r1(S.t - t0), speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad) });
      await span(gap);
    }
    await span(9);
    const bites = S.events.filter((e: any) => e.ev === 'engage').map((e: any) => ({ gear: e.gear, t: r1(e.t - t0), speed: e.speed, agl: e.agl }));
    const log = (S.log as any[]).filter((r) => r.tag === 'hop');
    const at = (t: number) => { const r = log.find((x) => x.t >= t0 + t); return r ? { t, speed: r.speed, agl: r.agl, k: r.speedK, fov: r1(r.hfov), pull: r.pull, strain: r.strain } : null; };
    rows.push({ gap, ladder, bites, speedGivenBackMax: r1(worstLossAny), peakVy: r1(worstVy), end: { speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad), gear: S.drive.gear, engaged: S.drive.engaged }, samples: [0.5, 1, 2, 3, 4, 6, 8].map(at) });
  }
  res.hop = rows;
}
// ---- 9. world travel on: the gears go on, and turbo sits over Rainbow Warp
{
  config.turbo.worldTravel = true;
  const S = await session(37.7600, -122.4800, 270);
  climbTo(S, JET);
  await S.run(6, free, 'wt jet');
  S.drive.rung(1, S.f);
  await S.run(35, free, 'wt stratos');
  const steps: unknown[] = [];
  const stratos = { gear: S.drive.gear, isStratos: S.drive.gear === STRATOS, speed: r1(S.f.speed), agl: r1(S.f.y - S.f.groundBroad) };
  const D = new TurboDrive([minX, minZ, maxX, maxZ]), F = new Flight();
  for (let i = 0; i < 10; i++) { const went = D.rung(1, F); steps.push([D.gear, D.level, went]); }
  res.worldTravel = { ...stratos, ladder: steps, topIsWarp: D.gear === WARP && D.level === config.turbo.levels.length, events: S.events, log: S.log.filter((_: unknown, i: number) => i % 10 === 0) };
  config.turbo.worldTravel = false;
}
const OUT = process.env.SB_OUT ?? 'shots/controls/sim';
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/turbo.json`, JSON.stringify(res, null, 1));
const a = res.alamo as any;
console.log('alamo express:', JSON.stringify(a.express), 'nonstop:', JSON.stringify(a.nonstop), 'jet:', JSON.stringify(a.jet), 'steer:', JSON.stringify(a.steer), 'turbo:', a.turboUp, 'locked refused:', a.lockedRefused);
console.log('down:', JSON.stringify(a.down), 'after dive:', JSON.stringify(a.end), 'max alt step/frame:', a.maxAltStepPerFrame);
console.log('events:', JSON.stringify(a.events));
console.log('steering:', JSON.stringify(res.steering));
console.log('edge: max outside', (res.edge as any).maxOutsideM, JSON.stringify((res.edge as any).events));
console.log('levels:', JSON.stringify(res.levels));
console.log('nose:', JSON.stringify(res.nose));
console.log('edge, by rung:', JSON.stringify(res.edgeLevels));
console.log('taken back:', JSON.stringify(res.takenBack));
console.log('express:', JSON.stringify(res.express));
console.log('hop:');
for (const r of res.hop as any[]) console.log('  ', JSON.stringify(r));
console.log('world travel:', JSON.stringify({ ...(res.worldTravel as any), log: undefined }));

// ---- 10. School Zone (docs/specs/shots/GEARS.md) on the real city: down a rung from Cruise over Alamo Square's roofs, the hover, the
// lens coming in 30 %, a full turn on the spot, a drift with the stick up over the blocks, a climb, and a flick up back to Cruise.
// (Controls sets rig.zone from the drive each frame; here the session does it.)
{
  const out: Record<string, unknown> = {};
  const Z = await session(37.7763, -122.4352, 88);
  const camDist = () => Z.rig.distance;
  await Z.run(3, free, 'cruise');
  const d0 = camDist(), y0 = Z.f.y;
  out.flick = Z.drive.rung(-1, Z.f);
  Z.rig.zone = Z.drive.below === SCHOOL_ZONE ? 1 : 0;
  const v: number[] = [];
  for (let i = 0; i < 4; i++) { await Z.run(0.5, free, 'zone'); v.push(r1(Z.f.speed)); }
  await Z.run(3, free, 'zone');
  out.settle = { below: Z.drive.below, speedEvery05s: v, heldFromCruise: r1(Z.f.y - y0), camIn: +(1 - camDist() / d0).toFixed(3), d0: r1(d0), d1: r1(camDist()) };
  const h0 = Z.f.heading, x0 = Z.f.x, z0 = Z.f.z;
  await Z.run(5, () => ({ sx: 1, sy: 0, dragging: true }), 'zone turn');
  out.turn = { degIn5s: r1(((Z.f.heading - h0) * 180) / Math.PI), moved: r1(Math.hypot(Z.f.x - x0, Z.f.z - z0)) };
  await Z.run(2, free, 'zone');
  let vmax = 0, low = Infinity, lowFloor = Infinity;
  const yd = Z.f.y, xd = Z.f.x, zd = Z.f.z;
  for (let i = 0; i < 160; i++) {
    await Z.run(0.1, push, 'zone drift');
    vmax = Math.max(vmax, Z.f.ground);
    low = Math.min(low, Z.f.y - Z.f.obstacleUnder);
    lowFloor = Math.min(lowFloor, Z.f.y - Z.f.floorY);
  }
  out.drift = { vmax: r1(vmax), metresIn16s: r1(Math.hypot(Z.f.x - xd, Z.f.z - zd)), fell: r1(yd - Z.f.y), lowestOverRoofs: r1(low), lowestUnderFloor: r1(lowFloor) };
  await Z.run(2, free, 'zone');
  let up = 0;
  const yc = Z.f.y;
  for (let i = 0; i < 60; i++) { await Z.run(0.1, pull, 'zone climb'); up = Math.max(up, Z.f.vy); }
  await Z.run(4, free, 'zone');
  out.climb = { vmax: r1(up), rose: r1(Z.f.y - yc), forward: r1(Z.f.ground), mode: Z.f.mode };
  out.out = Z.drive.rung(1, Z.f);
  Z.rig.zone = Z.drive.below === SCHOOL_ZONE ? 1 : 0;
  await Z.run(5, free, 'cruise again');
  out.back = { below: Z.drive.below, gear: Z.drive.gear, speed: r1(Z.f.speed), mode: Z.f.mode, lensIn: +Z.rig.zoneIn.toFixed(3) };
  out.events = Z.events;
  res.zone = out;
  console.log('school zone:', JSON.stringify(out));
}

// ---- 11. School Zone at a wall (review of feat/gears, 1): drifting into Salesforce Tower from ~200 m west at the hover's height, the
// drift stops short of it with nothing thrown up its face; a pull climbs it, and a drift on goes over its top. Then a tap's breath
// halves the turn on the spot, as in every gear.
{
  const out: Record<string, unknown> = {};
  const W = await session(37.78977, -122.39914, 90);
  await W.run(3, free, 'cruise');
  W.drive.rung(-1, W.f);
  await W.run(3, free, 'zone');
  const tower = (() => { let h = 0; for (let d = 0; d < 400; d += 4) h = Math.max(h, city.obstacleAt(W.f.x + W.f.fx * d, W.f.z + W.f.fz * d, 0)); return h; })();
  let vyMax = 0, vyMin = 0, minOver = Infinity;
  const watch = async (secs: number, inp: () => { sx: number; sy: number; dragging: boolean }, tag: string) => {
    for (let i = 0; i < Math.round(secs / 0.1); i++) {
      await W.run(0.1, inp, tag);
      vyMax = Math.max(vyMax, W.f.vy); vyMin = Math.min(vyMin, W.f.vy);
      minOver = Math.min(minOver, W.f.y - city.obstacleAt(W.f.x, W.f.z, W.f.y));
    }
  };
  const x0 = W.f.x, z0 = W.f.z, y0 = W.f.y;
  await watch(30, push, 'zone wall drift');
  const ahead = (() => { for (let d = 0; d < 60; d += 0.5) if (city.obstacleAt(W.f.x + W.f.fx * d, W.f.z + W.f.fz * d, 0) > tower - 30) return d; return Infinity; })();
  out.stop = { tower: r1(tower), y0: r1(y0), y: r1(W.f.y), went: r1(Math.hypot(W.f.x - x0, W.f.z - z0)), toWall: r1(ahead), ground: +W.f.ground.toFixed(2), vyMax: r1(vyMax), minOver: r1(minOver) };
  vyMax = 0;
  await watch(Math.ceil((tower + 20 - W.f.y) / 14) + 2, pull, 'zone wall climb');
  await W.run(2, free, 'zone');
  out.climb = { y: r1(W.f.y), vyMax: r1(vyMax) };
  vyMax = 0; vyMin = 0; minOver = Infinity;
  const xc = W.f.x, zc = W.f.z;
  await watch(20, push, 'zone wall over');
  out.over = { went: r1(Math.hypot(W.f.x - xc, W.f.z - zc)), y: r1(W.f.y), vyMax: r1(vyMax), vyMin: r1(vyMin), minOver: r1(minOver) };
  // the breath's plant on the turn
  const T = await session(37.7763, -122.4352, 88);
  await T.run(3, free, 'cruise');
  T.drive.rung(-1, T.f);
  await T.run(4, free, 'zone');
  const right = () => ({ sx: 1, sy: 0, dragging: true });
  await T.run(2, right, 'zone turn');
  const steady = T.f.yawRate;
  T.f.fullness = 1;
  const breathed = T.f.tryBarf();
  await T.run(0.4, right, 'zone turn, breathing');
  out.breath = { breathed, steadyDegPerS: r1((steady * 180) / Math.PI), breathingDegPerS: r1((T.f.yawRate * 180) / Math.PI) };
  res.zoneWall = out;
  console.log('school zone at a wall:', JSON.stringify(out));
}

// ---- the verdicts
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const near = (x: number, want: number, within: number) => Math.abs(x - want) <= within;
ok(near(a.express.speed, 108, 5) && a.express.mode === 0, `Express rides the rooftops at the surge: ${JSON.stringify(a.express)}`);
ok(near(a.nonstop.speed, 225, 2) && a.nonstop.agl > 48 && a.nonstop.engaged, `Nonstop: 225 m/s, lifted to about 60 m: ${JSON.stringify(a.nonstop)}`);
ok(near(a.jet.speed, 450, 3) && near(a.jet.agl, 150, 20), `Jet keeps its 450 and its 150 m: ${JSON.stringify(a.jet)}`);
ok(near(res.levels ? (res.levels as any).level1 : 0, 585, 3) && near((res.levels as any).level2, 720, 3) && near((res.levels as any).level3, 900, 3), `the rungs over Jet: ${JSON.stringify(res.levels)}`);
ok(a.lockedRefused && a.events.filter((e: any) => e.ev === 'locked').length === 1, 'past TURBO 3: LOCKED');
const d = a.down as any[];
ok(d[0].level === 2 && d[1].level === 1 && d[2].level === 0 && d[2].gear === JET && d[3].gear === NONSTOP && d[4].gear === EXPRESS && d[5].gear === 0, `a flick down drops exactly one rung: ${JSON.stringify(d)}`);
ok(d.every((r) => r.level !== undefined) && d[0].worstLossPer100ms < 25 && d[3].worstLossPer100ms < 25, `the way down has no wall in it: ${JSON.stringify(d.map((r) => r.worstLossPer100ms))}`);
ok(d[3].heldWithin < 8 && d[4].heldWithin < 8, `out of a gear with a height it holds the height: ${JSON.stringify(d.map((r) => r.heldWithin))}`);
const L = res.levels as any;
ok(L.pastTheLast === false && L.downTo2.level === 2 && L.downTo1.level === 1 && L.downTo0.level === 0 && L.downTo0.gear === JET && near(L.downTo0.speed, 450, 12), `turbo comes down a level at a time: ${JSON.stringify(L)}`);
const N = (res.nose as any[]).find((r) => r.name === 'nonstop');
ok(near(N.up.speed, 225, 3) && N.up.path > 80, `a pull in Nonstop goes up the nose: ${JSON.stringify(N)}`);
for (const r of res.edgeLevels as any[]) ok(r.maxOutsideM < 760, `the map's edge stops every rung: ${JSON.stringify(r)}`);
for (const r of res.hop as any[]) ok(r.speedGivenBackMax < 0.5, `no speed given back on the way up, ${r.gap} s apart: ${JSON.stringify(r)}`);
for (const r of res.takenBack as any[]) ok(r.gear === (r.name === 'nonstop' ? EXPRESS : NONSTOP), `a gear still lifting goes back a rung: ${JSON.stringify(r)}`);
ok((res.worldTravel as any).isStratos && (res.worldTravel as any).topIsWarp, 'world travel: the gears go on, turbo over Rainbow Warp');
{
  const Z = res.zone as any;
  ok(Z.flick === true && Z.settle.below === SCHOOL_ZONE && Z.settle.speedEvery05s[2] < 2 && Z.settle.speedEvery05s[3] < 1, `School Zone: a flick down from Cruise eases to a hover in about 1.5 s: ${JSON.stringify(Z.settle)}`);
  ok(near(Z.settle.camIn, 0.3, 0.06), `School Zone: the lens comes in 30 %: ${JSON.stringify(Z.settle)}`);
  ok(near(Z.turn.degIn5s, 360, 40) && Z.turn.moved < 3, `School Zone: a full turn on the spot in about 5 s: ${JSON.stringify(Z.turn)}`);
  ok(Z.drift.vmax <= 8.05 && Z.drift.vmax > 6 && Z.drift.lowestUnderFloor > -3 && Z.drift.lowestOverRoofs > 3, `School Zone: the stick up drifts at up to 8 m/s, over the roofs, never into one: ${JSON.stringify(Z.drift)}`);
  ok(near(Z.climb.vmax, 15, 1) && Z.climb.forward < 1, `School Zone: the stick down climbs at about 15 m/s: ${JSON.stringify(Z.climb)}`);
  ok(Z.out === true && Z.back.below === 0 && Z.back.gear === 0 && Z.back.speed > 25 && Z.back.lensIn < 0.01, `School Zone: a flick up is Cruise again, the lens back out: ${JSON.stringify(Z.back)}`);
  const Wl = res.zoneWall as any;
  ok(Wl.stop.tower > 250 && Wl.stop.ground < 0.3 && Wl.stop.toWall > 4 && Wl.stop.toWall < 14 && Wl.stop.vyMax < 3 && Wl.stop.y < Wl.stop.y0 + 3, `School Zone: a drift into a tower stops short of its wall, nothing thrown up its face: ${JSON.stringify(Wl.stop)}`);
  ok(Wl.climb.y > Wl.stop.tower && Wl.climb.vyMax < 15.5, `School Zone: a pull climbs the tower at 15 m/s: ${JSON.stringify(Wl.climb)}`);
  ok(Wl.over.went > 60 && Wl.over.vyMax < 25 && Wl.over.minOver > 2, `School Zone: a drift on from its height goes over its top: ${JSON.stringify(Wl.over)}`);
  ok(Wl.breath.breathed && Wl.breath.steadyDegPerS > 60 && Wl.breath.breathingDegPerS < Wl.breath.steadyDegPerS * 0.7, `School Zone: a tap's breath slows the turn on the spot, as in every gear: ${JSON.stringify(Wl.breath)}`);
}
console.log(fails.length ? `FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `turbo checks: all ${checks} passed`);
process.exit(fails.length ? 1 : 0);
