// Curb on the real baked city and life's real road graphs (docs/specs/shots/CURB.md), offline: the real Flight, TurboDrive, Shifter, CameraRig and
// CurbFlight, and life's own Curb (src/life/Curb.ts) on the cars' net round each place, its worker a stand-in that answers as lifeWorker's curb()
// does, a frame late. The landing (a dive along a street at Cruise and Express, School Zone's sink and its flick; none from Nonstop, Jet or turbo,
// none let go early, none over the roofs, none from 160 m), the arc down (no step over its speed's and nothing backward along the lane), FIND A
// STREET, the roll beside a car (paced, painted once at 1.5 s, a dab every 3 m, a push past it), the look at a junction, getting off (a flick up,
// a pull held, not a flick's stroke, a gear forced), the lens down to the kerb and back up. Every verdict is at the end; the process fails if one is false.
//   node tools/controls-sim/run.mjs s_curb.ts
import { newCity, pump, ll } from '../feel-sim/lib';
import { config } from '@src/config';
import { Flight } from '@src/game/Flight';
import { CameraRig } from '@src/game/CameraRig';
import { Shifter } from '@src/game/Shifter';
import { CURB, EXPRESS, JET, NONSTOP, SCHOOL_ZONE, TurboDrive } from '@src/game/Turbo';
import { CurbFlight, type CurbEvent } from '@src/game/CurbFlight';
import { parseRegionGraph } from '@src/world/lifeData';
import { buildNet } from '@src/life/sim/cars';
import { curbLand, curbPath, curbTune } from '@src/life/sim/curb';
import { Curb } from '@src/life/Curb';
import { SNAP_BYTES, view, writeKey } from '@src/life/snapshot';
import { fnv1a } from '@src/life/hash';
import { Col, Kind } from '@src/life/kinds';
import * as THREE from 'three';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const city = await newCity();
const DATA = process.env.SB_DATA!;
const man = JSON.parse(readFileSync(`${DATA}/city.json`, 'utf8'));
const M = man.regionSize * man.tileSize;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const dt = 1 / 60;
const res: Record<string, any> = {};

/** The cars' net round (x, z): every life region within `reach` m, sorted as the worker's (so the lane is the one a player gets). */
function netAround(x: number, z: number, reach = 2200) {
  const graphs = [];
  for (const [rx, rz] of man.life.regions as number[][]) {
    const dx = Math.max(rx * M - x, 0, x - (rx + 1) * M), dz = Math.max(rz * M - z, 0, z - (rz + 1) * M);
    if (Math.hypot(dx, dz) > reach) continue;
    let b = readFileSync(`${DATA}/g_${rx}_${rz}.bin`);
    if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
    const g = parseRegionGraph(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, M);
    if (g) graphs.push(g);
  }
  graphs.sort((p, q) => p.rx - q.rx || p.rz - q.rz);
  return buildNet(graphs);
}

const stick = { sx: 0, sy: 0, dragging: false };
type Inp = { sx: number; sy: number; dragging: boolean };
const free = (): Inp => ({ sx: 0, sy: 0, dragging: false });
const push = (k = 1) => (): Inp => ({ sx: 0, sy: k, dragging: true });
const pull = (k = 1) => (): Inp => ({ sx: 0, sy: -k, dragging: true });

/** A session at a place: the bus at `agl` m over the ground there (or at the floor), heading `hdg`; life's Curb on the net round it, with a car to pace. */
async function session(lat: number, lon: number, hdg: number, agl = -1) {
  const [x0, z0] = ll(lat, lon);
  await pump(city, x0, z0);
  const net = netAround(x0, z0);
  const f = new Flight();
  f.x = x0; f.z = z0; f.heading = (hdg * Math.PI) / 180; f.glideSpeed = 0; f.fullness = 1;
  f.y = agl >= 0 ? city.groundAt(x0, z0) + agl : city.obstacleAt(x0, z0) + config.flight.clearance;
  if (agl >= 0) f.holdY = f.y;
  const drive = new TurboDrive([-1e7, -1e7, 1e7, 1e7]);
  const shifter = new Shifter(drive, f);
  const cam = new THREE.PerspectiveCamera(50, 393 / 852, 1, 30000), rig = new CameraRig(), focus = new THREE.Vector3();
  // (life's side: its Curb, a stand-in worker answering a frame late, and a snapshot with one car on the lane once there is one)
  const answers: any[] = [];
  const worker = (m: any) => {
    const spot = curbLand(net, m.x, m.z, m.fx, m.fz, m.reach), pts = new Float32Array(Math.ceil(m.length / curbTune.step + 2) * 4);
    const n = spot ? curbPath(net, spot.w, spot.s, m.length, m.look, pts, { w: 0, s: 0 }) : 0;
    answers.push({ type: 'curb', id: m.id, n, pts });
  };
  const curb = new Curb(worker);
  const snap = view(new ArrayBuffer(SNAP_BYTES)), keys = new Map<number, string>(), carKey = 'car:curb:sim', ch = fnv1a(carKey);
  keys.set(ch, carKey);
  writeKey(snap, 0, ch, carKey);
  const car = { on: false, x: 0, z: 0, ux: 0, uz: 0, v: 10 };
  const road = {
    curb,
    curbRoll: (d: number, p: number, look: number, out: any) => {
      if (car.on) {
        snap.rowsU32[Col.KEY] = ch;
        snap.rows[Col.KIND] = Kind.CAR;
        snap.rows[Col.X] = car.x;
        snap.rows[Col.Z] = car.z;
        snap.rows[Col.VX] = car.ux * car.v;
        snap.rows[Col.VZ] = car.uz * car.v;
        snap.u32[2] = 1;
      } else snap.u32[2] = 0;
      return curb.roll(d, p, look, snap, 0, keys, out);
    },
  };
  const evs: Array<{ t: number; ev: CurbEvent; k: number }> = [];
  const painted: string[] = [];
  curb.onBeside = (k) => painted.push(k);
  const hints: boolean[] = [];
  let dabs = 0, t = 0, lensLast = -1, lensStep = 0, lensWhen = '';
  const cf = new CurbFlight(f, drive, rig, road, city as any, {
    hint: (learn) => (hints.push(learn), true),
    event: (ev, k) => evs.push({ t: r2(t), ev, k: r2(k) }),
    dab: () => dabs++,
  }, { off: () => false, wide: false, rear: 11.2 });
  /** One frame as main.ts runs it: the drive, the lens's rung, the roll or the flight's steps, Curb's watch, the look, the lens. Returns how far the bus moved. */
  const frame = (i: Inp, look = 0) => {
    t += dt;
    drive.update(dt, f);
    rig.zone = drive.below > 0 ? 1 : 0;
    stick.sx = i.sx; stick.sy = i.sy; stick.dragging = i.dragging;
    const px = f.x, py = f.y, pz = f.z;
    while (answers.length) curb.answer(answers.shift());
    if (cf.rolling) cf.roll(dt, stick);
    if (!cf.rolling) for (let k = 0; k < 2; k++) f.step(dt / 2, stick, city);
    cf.watch(dt, stick);
    rig.setLook(look !== 0, look, 0, dt);
    rig.update(cam, focus, f, dt);
    // (the lens's biggest move in a frame, toward the bus or away)
    if (lensLast >= 0 && Math.abs(rig.distance - lensLast) > lensStep) {
      lensStep = Math.abs(rig.distance - lensLast);
      lensWhen = `${cf.state} curbIn ${r2(rig.curbIn)} at ${r1(rig.distance)} m, ${r1(f.speed)} m/s`;
    }
    lensLast = rig.distance;
    return { d: Math.hypot(f.x - px, f.y - py, f.z - pz), dx: f.x - px, dz: f.z - pz };
  };
  const run = async (secs: number, inp: () => Inp, each?: (k: number) => void, look = 0) => {
    for (let k = 0; k < Math.round(secs / dt); k++) {
      if (k % 30 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
      frame(inp(), look);
      each?.(k);
    }
  };
  return { f, drive, shifter, rig, cam, cf, curb, car, evs, painted, hints, get dabs() { return dabs; }, get t() { return t; }, get lensStep() { return lensStep; }, get lensWhen() { return lensWhen; }, resetLens() { lensStep = 0; }, frame, run, net };
}
type S = Awaited<ReturnType<typeof session>>;

/** The lane ahead of where the bus rolls now, 1.5 km of it, and a point d m along it (as tools/life/curb.mjs's car drives it). */
function laneOf(s: S) {
  const L = s.cf.qa.lane, spot = curbLand(s.net, L.x, L.z, Math.sin(L.heading), -Math.cos(L.heading), 12)!;
  const pts = new Float32Array(4 * 400), n = curbPath(s.net, spot.w, spot.s, 1500, null, pts, { w: 0, s: 0 });
  return (d: number) => {
    let i = 0, acc = 0;
    while (i < n - 2) {
      const sl = Math.hypot(pts[i * 4 + 4] - pts[i * 4], pts[i * 4 + 6] - pts[i * 4 + 2]);
      if (acc + sl > d) break;
      acc += sl;
      i++;
    }
    const sl = Math.hypot(pts[i * 4 + 4] - pts[i * 4], pts[i * 4 + 6] - pts[i * 4 + 2]) || 1, k = Math.min(1, (d - acc) / sl);
    return { x: pts[i * 4] + (pts[i * 4 + 4] - pts[i * 4]) * k, z: pts[i * 4 + 2] + (pts[i * 4 + 6] - pts[i * 4 + 2]) * k, ux: (pts[i * 4 + 4] - pts[i * 4]) / sl, uz: (pts[i * 4 + 6] - pts[i * 4 + 2]) / sl };
  };
}
/** The car one lane over from the kerb's, d m along the lane, at 10 m/s. */
function carAt(s: S, at: ReturnType<typeof laneOf>, d: number) {
  const p = at(d);
  s.car.x = p.x + p.uz * 3.2; s.car.z = p.z - p.ux * 3.2; s.car.ux = p.ux; s.car.uz = p.uz;
}

/** The band's parts where the bus is: the class under it, a roof, the floor ahead over the road, the height over it. */
const bandAt = (s: S) => ({ cls: city.groundClassAt(s.f.x, s.f.z), roof: city.roofAt(s.f.x, s.f.z, s.f.y), topOver: r1(s.f.top - s.f.groundUnder), over: r1(s.f.y - s.f.groundUnder), speed: r1(s.f.speed) });

/** Fly until Curb asks (or `secs` pass) with `inp`; how long it took. */
async function untilAsk(s: S, secs: number, inp: () => Inp) {
  const t0 = s.t;
  for (let k = 0; k < Math.round(secs / dt) && s.cf.state === 'fly'; k++) {
    if (k % 30 === 0) await pump(city, s.f.x, s.f.z, s.f.lift, s.f.fx, s.f.fz);
    s.frame(inp());
  }
  return { state: s.cf.state, after: r2(s.t - t0), asked: s.cf.qa.asked };
}

/** The arc, watched frame by frame: the worst step past what its speed allows, the most it went back along the lane, how near the lane it ended. */
async function watchArc(s: S) {
  let worst = 0, back = 0, frames = 0, v = Math.hypot(s.f.ground, s.f.vy);
  const hx = () => Math.sin(s.cf.qa.lane.heading), hz = () => -Math.cos(s.cf.qa.lane.heading);
  while (s.cf.state === 'ask' && frames < 120) { s.frame(free()); frames++; }
  const start = { state: s.cf.state, below: s.drive.below, gear: s.drive.gear, arcFor: r2(s.cf.qa.arcFor), caughtUp: r1(s.cf.qa.caughtUp), over: r1(s.f.y - s.f.groundUnder) };
  frames = 0;
  while (s.cf.state === 'arc' && frames < 240) {
    const m = s.frame(free());
    worst = Math.max(worst, m.d - (v * dt + 0.5));
    back = Math.max(back, -(m.dx * hx() + m.dz * hz()));
    v = Math.max(s.f.speed, m.d / dt);
    frames++;
  }
  const L = s.cf.qa.lane, y = Math.max(L.y, city.groundAt(L.x, L.z)) + config.curb.ride;
  return { ...start, frames, endState: s.cf.state, worstStepOverM: r2(worst), mostBackM: r2(back), endOffM: r2(Math.hypot(s.f.x - L.x, s.f.y - y, s.f.z - L.z)), speed: r1(s.f.speed), touch: s.evs.find((e) => e.ev === 'touch')?.k ?? null };
}

// The four streets of GEARS.md (tools/streetcam/pick.ts, from the cars' own graph) and the Financial District
const ARTERIAL = [37.736181, -122.426973, 227] as const;
const RESIDENTIAL = [37.732412, -122.388112, 305.6] as const;
const HILL = [37.754863, -122.428367, 85.4] as const;
const WATERFRONT = [37.852117, -122.478968, 180] as const;

// ---- 1. the band along each street, flown at Cruise at the floor (what the dive will find)
{
  const out: Record<string, unknown> = {};
  for (const [name, p] of [['arterial', ARTERIAL], ['residential', RESIDENTIAL], ['hill', HILL], ['waterfront', WATERFRONT]] as const) {
    const s = await session(p[0], p[1], p[2]);
    const samples: unknown[] = [];
    let low = 0, frames = 0;
    await s.run(4, free, (k) => { frames++; if (s.cf.qa.low > 0) low++; if (k % 30 === 0) samples.push(bandAt(s)); });
    out[name] = { lowShare: r2(low / frames), samples };
  }
  res.band = out;
  console.log('band along the streets:', JSON.stringify(out));
}

// ---- 2. the dive at Cruise along the arterial: asks at 0.5 s, lands, the arc, the roll
{
  const s = await session(...ARTERIAL);
  await s.run(1, free);
  const lens0 = s.rig.distance;
  s.resetLens();
  const ask = await untilAsk(s, 3, push(1));
  const arc = await watchArc(s);
  res.cruise = { ask, arc, hints: s.hints, evs: s.evs.slice(0, 6) };
  console.log('cruise dive:', JSON.stringify(res.cruise));
  // the roll: a car on the lane 30 m ahead at 10 m/s, one lane over from the kerb's
  const at = laneOf(s);
  let carD = 30;
  s.car.on = true;
  let worstOff = 0, paintedAt = -1, besideAt = -1;
  const d0 = s.dabs, tRoll = s.t;
  let rolled = 0, px = s.f.x, pz = s.f.z;
  for (let k = 0; k < 20 * 60; k++) {
    carD += 10 * dt;
    carAt(s, at, carD);
    if (k % 30 === 0) await pump(city, s.f.x, s.f.z, 0, s.f.fx, s.f.fz);
    s.frame(free());
    rolled += Math.hypot(s.f.x - px, s.f.z - pz); px = s.f.x; pz = s.f.z;
    const Q = s.cf.qa.lane;
    worstOff = Math.max(worstOff, Math.hypot(s.f.x - Q.x, s.f.z - Q.z));
    if (s.curb.beside && besideAt < 0) besideAt = s.t - tRoll;
    if (s.painted.length && paintedAt < 0) paintedAt = s.t - tRoll;
  }
  res.roll = { state: s.cf.state, below: s.drive.below, name: s.drive.name, speed: r1(s.f.speed), beside: s.curb.beside, painted: s.painted.length, besideAtS: r2(besideAt), paintedAtS: r2(paintedAt), worstOffLaneM: r2(worstOff), rolledM: r1(rolled), dabs: s.dabs - d0, lensStart: r1(lens0), lensEnd: r1(s.rig.distance), lensWorstStep: r2(s.lensStep), lensWhen: s.lensWhen, fov: r1(s.rig.hfov), y: r2(s.f.y - city.groundAt(s.f.x, s.f.z)) };
  console.log('the roll:', JSON.stringify(res.roll));
  // the push: on past the car
  const passes0 = s.cf.qa.passes;
  for (let k = 0; k < 6 * 60; k++) {
    carD += 10 * dt;
    carAt(s, at, carD);
    if (k % 30 === 0) await pump(city, s.f.x, s.f.z, 0, s.f.fx, s.f.fz);
    s.frame(push(1)());
  }
  const cp = at(carD), ahead = (s.f.x - cp.x) * cp.ux + (s.f.z - cp.z) * cp.uz;
  res.push = { aheadOfCarM: r1(ahead), speed: r1(s.f.speed), beside: s.curb.beside, passes: s.cf.qa.passes - passes0, state: s.cf.state };
  console.log('the push:', JSON.stringify(res.push));
  s.car.on = false;
  // a flick's stroke (a pull 0.1 s) is no leave; a pull held 0.25 s is
  await s.run(1, free);
  await s.run(0.1, pull(1));
  await s.run(0.3, free);
  const afterStroke = { state: s.cf.state, below: s.drive.below };
  const y0 = s.f.y, tp = s.t;
  let leftAt = -1;
  for (let k = 0; k < 120 && leftAt < 0; k++) { s.frame(pull(1)()); if (s.cf.state === 'leave') leftAt = s.t - tp; }
  let vmax = 0;
  for (let k = 0; k < 120; k++) { s.frame(pull(1)()); vmax = Math.max(vmax, s.f.vy); }
  // (the lens cranes back up to School Zone's)
  s.resetLens();
  for (let k = 0; k < 240; k++) s.frame(free());
  const up = s.lensStep;
  res.pullOff = { afterStroke, leftAtS: r2(leftAt), left: s.cf.left, below: s.drive.below, climbVmax: r1(vmax), rose: r1(s.f.y - y0), lensBack: r1(s.rig.distance), lensWorstStep: r2(up), curbIn: r2(s.rig.curbIn) };
  console.log('a pull held gets off:', JSON.stringify(res.pullOff));
}

// ---- 3. Express down the arterial: the surge latched; the arc lets Express go, never back along the lane
{
  const s = await session(...ARTERIAL);
  s.drive.rung(1, s.f);
  await s.run(2, free);
  const ask = await untilAsk(s, 3, push(1));
  const arc = await watchArc(s);
  res.express = { ask, arc };
  console.log('express dive:', JSON.stringify(res.express));
}

// ---- 4. School Zone: the drift's sink down to the street lands; a flick down at 60 m lands; at 160 m nothing
{
  const s = await session(...ARTERIAL);
  s.drive.rung(-1, s.f);
  await s.run(3, free);
  const ask = await untilAsk(s, 12, push(1));
  const arc = await watchArc(s);
  res.zoneSink = { ask, arc };
  console.log('school zone, the sink:', JSON.stringify(res.zoneSink));
  const z = await session(ARTERIAL[0], ARTERIAL[1], ARTERIAL[2], 60);
  z.drive.rung(-1, z.f);
  await z.run(3, free);
  z.shifter.flick(-1, true);
  const flickArc = await watchArc(z);
  res.zoneFlick = { arc: flickArc, hints: z.hints };
  console.log('school zone, a flick down at 60 m:', JSON.stringify(res.zoneFlick));
  // the flick up off the street: School Zone, hovering at the street's floor
  await z.run(3, free);
  z.shifter.flick(1, true);
  await z.run(0.05, free);
  const flicked = { state: z.cf.state, left: z.cf.left, below: z.drive.below };
  await z.run(4, free);
  res.flickUp = { ...flicked, after: { below: z.drive.below, overRoad: r1(z.f.y - z.f.groundUnder), overFloor: r1(z.f.y - z.f.floorY), speed: r2(z.f.speed), state: z.cf.state } };
  console.log('a flick up off the street:', JSON.stringify(res.flickUp));
  const h = await session(ARTERIAL[0], ARTERIAL[1], ARTERIAL[2], 160);
  h.drive.rung(-1, h.f);
  await h.run(3, free);
  h.shifter.flick(-1, true);
  await h.run(1, free);
  res.zoneHigh = { state: h.cf.state, asked: h.cf.qa.asked, below: h.drive.below, agl: r1(h.f.y - h.f.groundUnder) };
  console.log('school zone, a flick down at 160 m:', JSON.stringify(res.zoneHigh));
}

// ---- 5. none from Nonstop, Jet or turbo, none let go at 0.4 s, none over the roofs
{
  const out: Record<string, unknown> = {};
  for (const [name, rungs] of [['nonstop', 2], ['jet', 3], ['turbo', 4]] as const) {
    const s = await session(...ARTERIAL);
    for (let i = 0; i < rungs; i++) s.drive.rung(1, s.f);
    await s.run(1, free);
    // (down to the street's floor first, where it would land were it slower)
    s.f.y = s.f.groundUnder + 10;
    const a = await untilAsk(s, 2, push(1));
    out[name] = { ...a, gear: s.drive.gear, level: s.drive.level };
  }
  {
    const s = await session(...ARTERIAL);
    await s.run(1, free);
    await s.run(0.4, push(1));
    const a = await untilAsk(s, 1, free);
    out.letGo = { ...a, dive: r2(s.cf.qa.dive) };
  }
  {
    // (across the blocks of the residential grid, its heading turned square to the street: over the roofs)
    const s = await session(RESIDENTIAL[0], RESIDENTIAL[1], RESIDENTIAL[2] + 90);
    await s.run(1, free);
    out.acrossTheBlocks = await untilAsk(s, 3, push(1));
  }
  {
    // (diveOnly: the surge down a street no longer lands; School Zone's sink still does)
    config.curb.diveOnly = true;
    const s = await session(...ARTERIAL);
    await s.run(1, free);
    out.diveOnlySurge = await untilAsk(s, 2, push(1));
    const z = await session(...ARTERIAL);
    z.drive.rung(-1, z.f);
    await z.run(3, free);
    out.diveOnlyZone = await untilAsk(z, 12, push(1));
    config.curb.diveOnly = false;
  }
  res.none = out;
  console.log('none:', JSON.stringify(out));
}

// ---- 6. FIND A STREET: a flick down in School Zone over the bay
{
  const s = await session(37.8105, -122.4400, 0, 40);
  s.drive.rung(-1, s.f);
  await s.run(3, free);
  const vy0 = s.f.vy;
  s.shifter.flick(-1, true);
  for (let k = 0; k < 6 && s.cf.state !== 'bounce'; k++) s.frame(free());
  const hop = { state: s.cf.state, vyGain: r1(s.f.vy - vy0), toast: s.evs.some((e) => e.ev === 'none') };
  // (2 s quiet, and nothing lands until the push lets go)
  await s.run(1.5, free);
  const at15 = s.cf.state;
  await s.run(0.6, free);
  res.findAStreet = { ...hop, at15s: at15, at21s: s.cf.state, below: s.drive.below };
  console.log('find a street:', JSON.stringify(res.findAStreet));
}

// ---- 7. a forced gear throws it off; a look held turns, a glance doesn't
{
  const s = await session(...ARTERIAL);
  s.drive.rung(-1, s.f);
  await s.run(3, free);
  s.shifter.flick(-1, true);
  await watchArc(s);
  await s.run(2, free);
  const t0 = s.cf.qa.turns;
  // (a glance: 30 degrees left for 0.1 s; a look: 40 degrees left for 0.6 s. The look's px for an angle: lookPx)
  const { lookPx } = await import('@src/game/CameraRig');
  await s.run(0.1, free, undefined, lookPx(-30));
  await s.run(1, free);
  const glance = s.cf.qa.turns - t0;
  await s.run(0.6, free, undefined, lookPx(-40));
  const side = s.cf.side;
  await s.run(1, free);
  const looked = s.cf.qa.turns - t0 - glance;
  s.drive.shift(1, s.f);
  await s.run(0.1, free);
  res.thrown = { glanceTurns: glance, lookTurns: looked, sideWhileLooking: side, left: s.cf.left, state: s.cf.state, below: s.drive.below, gear: s.drive.gear, evs: s.evs.filter((e) => e.ev === 'turn' || e.ev === 'leave') };
  console.log('a forced gear, the look:', JSON.stringify(res.thrown));
}

// ---- the verdicts
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const C = res.cruise, R = res.roll;
ok(C.ask.state !== 'fly' && Math.abs(C.ask.after - 0.5) <= 0.02 + dt, `Curb: a dive along a street at Cruise asks at 0.5 s: ${JSON.stringify(C.ask)}`);
for (const [n, a] of [['Cruise', C.arc], ['Express', res.express.arc], ['School Zone, the sink', res.zoneSink.arc], ['School Zone, a flick at 60 m', res.zoneFlick.arc]] as const)
  ok(a.state === 'arc' && a.below === CURB && a.gear === 0 && a.endState === 'on' && a.worstStepOverM <= 0 && a.mostBackM <= 0.05 && a.endOffM <= 0.3, `Curb: the arc from ${n} lands with no step over its speed and nothing back along the lane: ${JSON.stringify(a)}`);
ok(res.express.ask.state !== 'fly', `Curb: Express lands: ${JSON.stringify(res.express.ask)}`);
ok(R.state === 'on' && R.below === CURB && R.name === 'CURB' && R.worstOffLaneM < 1 && Math.abs(R.speed - 10) < 2 && R.beside, `Curb: 20 s rolled on the lane beside the car, at its pace: ${JSON.stringify(R)}`);
ok(R.painted === 1 && Math.abs(R.paintedAtS - R.besideAtS - 1.5) <= 0.05, `Curb: the car ridden beside is painted once, 1.5 s after it's beside: ${JSON.stringify(R)}`);
ok(Math.abs(R.dabs - R.rolledM / 3) <= 2, `Curb: the lane paints a dab every 3 m: ${R.dabs} for ${R.rolledM} m`);
ok(R.lensEnd < 40 && R.lensStart > 100 && R.lensWorstStep < 3, `Curb: the lens comes down to the kerb, no step over 3 m a frame: ${JSON.stringify(R)}`);
ok(res.push.aheadOfCarM > 5 && res.push.state === 'on' && res.push.passes === 1, `Curb: a push rolls on past the car, with the toots: ${JSON.stringify(res.push)}`);
const P = res.pullOff;
ok(P.afterStroke.state === 'on' && P.leftAtS > 0.2 && P.leftAtS < 0.3 && P.left === 'pull' && P.below === SCHOOL_ZONE && P.climbVmax > 10 && P.climbVmax <= 15.5, `Curb: a flick's stroke stays on, a pull held 0.25 s gets off and climbs out at 15 m/s: ${JSON.stringify(P)}`);
ok(P.lensBack > 80 && P.curbIn < 0.05 && P.lensWorstStep < 3, `Curb: the lens cranes back up to School Zone's: ${JSON.stringify(P)}`);
ok(res.flickUp.state === 'leave' && res.flickUp.left === 'flick' && res.flickUp.below === SCHOOL_ZONE && res.flickUp.after.speed < 1 && res.flickUp.after.overFloor > -1.5, `Curb: a flick up gets off to School Zone, hovering at the street's floor: ${JSON.stringify(res.flickUp)}`);
ok(res.zoneHigh.asked === 0 && res.zoneHigh.below === SCHOOL_ZONE, `Curb: a flick down at 160 m does nothing: ${JSON.stringify(res.zoneHigh)}`);
const N = res.none;
for (const k of ['nonstop', 'jet', 'turbo', 'letGo', 'acrossTheBlocks', 'diveOnlySurge']) ok(N[k].asked === 0, `Curb: nothing lands (${k}): ${JSON.stringify(N[k])}`);
ok(N.diveOnlyZone.asked === 1, `Curb: diveOnly still lands School Zone's sink: ${JSON.stringify(N.diveOnlyZone)}`);
const Fs = res.findAStreet;
ok(Fs.state === 'bounce' && Fs.vyGain > 3 && Fs.toast && Fs.at15s === 'bounce' && Fs.at21s === 'fly' && Fs.below === SCHOOL_ZONE, `Curb: no street, the hop and FIND A STREET, 2 s quiet: ${JSON.stringify(Fs)}`);
const Th = res.thrown;
ok(Th.glanceTurns === 0 && Th.lookTurns === 1 && Th.sideWhileLooking === -1, `Curb: a look held turns at the next junction once, a glance doesn't: ${JSON.stringify(Th)}`);
ok(Th.left === 'thrown' && Th.state === 'leave' && Th.gear === EXPRESS, `Curb: a gear forced on it throws it off the street: ${JSON.stringify(Th)}`);
void NONSTOP; void JET;
console.log(fails.length ? `FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `curb checks: all ${checks} passed`);
process.exit(fails.length ? 1 : 0);
