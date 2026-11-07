// Curb on the real baked city and life's real road graphs (docs/specs/shots/CURB.md), offline: the real Flight, TurboDrive, Shifter, CameraRig and
// CurbFlight, and life's own Curb (src/life/Curb.ts) on the cars' net round each place, its worker a stand-in that answers as lifeWorker's curb()
// does, a frame late (or later, or never). The bridges' decks are in, as main.ts adds them. The landing (a dive along a street at Cruise and
// Express, School Zone's sink and its flick; none from Nonstop, Jet or turbo, none let go early, none over the roofs, none from 80 m), the arc down
// (no step over its speed's, nothing backward along the lane, never faster than its top from higher up, the readout eased), FIND A STREET (the
// hint not learned by it), the roll beside a car (paced, painted once at 1.5 s, a dab every 3 m, a push past it), the look at a junction (asked
// square, kept past the lift, as the drive-by's side), getting off (a flick up, a pull held, not a flick's stroke, a gear forced, a dead end),
// the lens down to the kerb and back up. After the review: a look held round each street never hides the bus nor stands the lens in a house; under
// the Bay Bridge's approach the lens stays under the deck; its lower deck is no street, nor its upper one from the water; a dive past a street's
// end with life slow to answer doesn't fly on at street height. Every verdict is at the end; the process fails if one is false.
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
import { bridgeObstacles } from '@src/world/Bridges';
import { D as busShape } from '@src/bus/busShape';
import * as THREE from 'three';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const city = await newCity();
const DATA = process.env.SB_DATA!;
const man = JSON.parse(readFileSync(`${DATA}/city.json`, 'utf8'));
// (the bridges' decks, as main.ts adds them)
for (const lm of man.landmarks) if ((lm.kind === 'ggb' || lm.kind === 'baybridge') && lm.points && lm.deck && lm.supports) city.addObstacles(bridgeObstacles(lm.kind, lm.points, lm.deck, lm.supports));
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

/** A session at a place: the bus at `agl` m over the ground there (or at the floor), heading `hdg`; life's Curb on the net round it, with a car to
 *  pace. Life's worker answers `late` s after a frame (Infinity: never). */
async function session(lat: number, lon: number, hdg: number, agl = -1, late = 0) {
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
  // (life's side: its Curb, a stand-in worker answering a frame late (or `late` s), and a snapshot with one car on the lane once there is one)
  const answers: Array<{ at: number; a: any }> = [];
  let asks = 0;
  const worker = (m: any) => {
    asks++;
    const spot = curbLand(net, m.x, m.z, m.fx, m.fz, m.reach), pts = new Float32Array(Math.ceil(m.length / curbTune.step + 2) * 4);
    const n = spot ? curbPath(net, spot.w, spot.s, m.length, m.look, pts, { w: 0, s: 0 }) : 0;
    answers.push({ at: t + late, a: { type: 'curb', id: m.id, n, pts } });
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
  }, { off: () => false, wide: false, rear: busShape.axleR * 1.6 });
  /** One frame as main.ts runs it: the drive, the lens's rung, the roll or the flight's steps, Curb's watch, the look, the lens. Returns how far the bus moved. */
  const frame = (i: Inp, look = 0) => {
    t += dt;
    drive.update(dt, f);
    rig.zone = drive.below > 0 ? 1 : 0;
    stick.sx = i.sx; stick.sy = i.sy; stick.dragging = i.dragging;
    const px = f.x, py = f.y, pz = f.z;
    while (answers.length && answers[0].at <= t) curb.answer(answers.shift()!.a);
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
  return { f, drive, shifter, rig, cam, cf, curb, car, evs, painted, hints, get dabs() { return dabs; }, get t() { return t; }, get asks() { return asks; }, get lensStep() { return lensStep; }, get lensWhen() { return lensWhen; }, resetLens() { lensStep = 0; }, frame, run, net };
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

/** The arc, watched frame by frame: the worst step past what its speed allows, the most it went back along the lane, how near the lane it ended; its
 *  fastest frame, the readout's biggest change in a frame, and frames with the bus's middle in a building. */
async function watchArc(s: S) {
  let worst = 0, back = 0, frames = 0, v = Math.hypot(s.f.ground, s.f.vy), top = 0, step = 0, inside = 0, sp = s.f.speed;
  const hx = () => Math.sin(s.cf.qa.lane.heading), hz = () => -Math.cos(s.cf.qa.lane.heading);
  while (s.cf.state === 'ask' && frames < 120) { s.frame(free()); frames++; sp = s.f.speed; }
  const start = { state: s.cf.state, below: s.drive.below, gear: s.drive.gear, arcFor: r2(s.cf.qa.arcFor), caughtUp: r1(s.cf.qa.caughtUp), catchCalls: s.cf.qa.catchCalls, over: r1(s.f.y - s.f.groundUnder), speedIn: r1(sp) };
  frames = 0;
  while (s.cf.state === 'arc' && frames < 300) {
    const m = s.frame(free());
    worst = Math.max(worst, m.d - (v * dt + 0.5));
    back = Math.max(back, -(m.dx * hx() + m.dz * hz()));
    v = Math.max(s.f.speed, m.d / dt);
    top = Math.max(top, m.d / dt);
    step = Math.max(step, Math.abs(s.f.speed - sp));
    sp = s.f.speed;
    if (city.buildingAbove(s.f.x, s.f.z, s.f.y) !== null) inside++;
    frames++;
  }
  const L = s.cf.qa.lane, y = Math.max(L.y, city.groundAt(L.x, L.z)) + config.curb.ride;
  return { ...start, frames, endState: s.cf.state, worstStepOverM: r2(worst), mostBackM: r2(back), endOffM: r2(Math.hypot(s.f.x - L.x, s.f.y - y, s.f.z - L.z)), speed: r1(s.f.speed), topSpeed: r1(top), readoutStep: r2(step), insideFrames: inside, touch: s.evs.find((e) => e.ev === 'touch')?.k ?? null };
}

/** What the lens sees of the bus: the sight lines to its middle and to the middles of its roof's front and back, each tried every 0.5 m for a
 *  building standing over it or the ground; the lens in a building or the ground; how far it stands from the bus. */
function sight(s: S) {
  const c = s.cam.position, f = s.f, fx = Math.sin(f.heading), fz = -Math.cos(f.heading);
  const blocked = (x: number, y: number, z: number) => {
    const n = Math.ceil(Math.hypot(x - c.x, y - c.y, z - c.z) / 0.5);
    for (let i = 1; i < n; i++) {
      const k = i / n, px = c.x + (x - c.x) * k, py = c.y + (y - c.y) * k, pz = c.z + (z - c.z) * k;
      if (city.groundAt(px, pz) > py || city.buildingAbove(px, pz, py) !== null) return true;
    }
    return false;
  };
  const mid = blocked(f.x, f.y, f.z);
  const ends = [blocked(f.x + fx * 7, f.y + 1.8, f.z + fz * 7), blocked(f.x - fx * 7, f.y + 1.8, f.z - fz * 7)];
  return { hidden: mid, partly: mid || ends.some((b) => b), inside: city.groundAt(c.x, c.z) > c.y || city.buildingAbove(c.x, c.z, c.y) !== null, arm: c.distanceTo(new THREE.Vector3(f.x, f.y, f.z)) };
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
  for (let k = 0; k < 12 * 60; k++) {
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
  for (let k = 0; k < 4 * 60; k++) {
    carD += 10 * dt;
    carAt(s, at, carD);
    if (k % 30 === 0) await pump(city, s.f.x, s.f.z, 0, s.f.fx, s.f.fz);
    s.frame(push(1)());
  }
  const cp = at(carD), ahead = (s.f.x - cp.x) * cp.ux + (s.f.z - cp.z) * cp.uz;
  res.push = { aheadOfCarM: r1(ahead), speed: r1(s.f.speed), beside: s.curb.beside, passes: s.cf.qa.passes - passes0, state: s.cf.state, left: s.cf.left };
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

// ---- 4. School Zone: the drift's sink down to the street lands; a flick down at 50 m lands, no faster than its top; at 80 m nothing
{
  const s = await session(...ARTERIAL);
  s.drive.rung(-1, s.f);
  await s.run(3, free);
  const ask = await untilAsk(s, 12, push(1));
  const arc = await watchArc(s);
  res.zoneSink = { ask, arc };
  console.log('school zone, the sink:', JSON.stringify(res.zoneSink));
  const z = await session(ARTERIAL[0], ARTERIAL[1], ARTERIAL[2], 50);
  z.drive.rung(-1, z.f);
  await z.run(3, free);
  z.shifter.flick(-1, true);
  const flickArc = await watchArc(z);
  res.zoneFlick = { arc: flickArc, hints: z.hints };
  console.log('school zone, a flick down at 50 m:', JSON.stringify(res.zoneFlick));
  // (and from 25 m: the arc's top the same or less, not growing with height)
  const z2 = await session(ARTERIAL[0], ARTERIAL[1], ARTERIAL[2], 25);
  z2.drive.rung(-1, z2.f);
  await z2.run(3, free);
  z2.shifter.flick(-1, true);
  res.zoneFlickLow = { arc: await watchArc(z2) };
  console.log('school zone, a flick down at 25 m:', JSON.stringify(res.zoneFlickLow));
  // the flick up off the street: School Zone, hovering at the street's floor
  await z.run(3, free);
  z.shifter.flick(1, true);
  await z.run(0.05, free);
  const flicked = { state: z.cf.state, left: z.cf.left, below: z.drive.below };
  await z.run(4, free);
  res.flickUp = { ...flicked, after: { below: z.drive.below, overRoad: r1(z.f.y - z.f.groundUnder), overFloor: r1(z.f.y - z.f.floorY), speed: r2(z.f.speed), state: z.cf.state } };
  console.log('a flick up off the street:', JSON.stringify(res.flickUp));
  const h = await session(ARTERIAL[0], ARTERIAL[1], ARTERIAL[2], 80);
  h.drive.rung(-1, h.f);
  await h.run(3, free);
  h.shifter.flick(-1, true);
  await h.run(1, free);
  res.zoneHigh = { state: h.cf.state, asked: h.cf.qa.asked, below: h.drive.below, agl: r1(h.f.y - h.f.groundUnder) };
  console.log('school zone, a flick down at 80 m:', JSON.stringify(res.zoneHigh));
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
  res.findAStreet = { ...hop, at15s: at15, at21s: s.cf.state, below: s.drive.below, hints: s.hints };
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
  const side = s.cf.side, asked = r2(s.cf.qa.look), view = r1((s.rig.lookYawNow * 180) / Math.PI);
  // (let go: the turn is still asked, and the drive-by's side kept, a moment; then the kerb's again)
  await s.run(0.5, free);
  const after05 = { side: s.cf.side, asked: r2(s.cf.qa.look) };
  await s.run(1.5, free);
  const after2 = { side: s.cf.side, asked: r2(s.cf.qa.look) };
  const looked = s.cf.qa.turns - t0 - glance;
  s.drive.shift(1, s.f);
  await s.run(0.1, free);
  res.thrown = { glanceTurns: glance, lookTurns: looked, sideWhileLooking: side, askedWhileLooking: asked, viewDeg: view, after05, after2, left: s.cf.left, state: s.cf.state, below: s.drive.below, gear: s.drive.gear, evs: s.evs.filter((e) => e.ev === 'turn' || e.ev === 'leave') };
  console.log('a forced gear, the look:', JSON.stringify(res.thrown));
}

// ---- 8. a look held round each street (the review of feat/curb, B1): the lens never in a house, no house nor the hill between it and the bus
{
  const out: Record<string, unknown> = {};
  const { lookPx } = await import('@src/game/CameraRig');
  for (const [name, p] of [['residential', RESIDENTIAL], ['hill', HILL], ['arterial', ARTERIAL], ['waterfront', WATERFRONT]] as const) {
    const s = await session(p[0], p[1], p[2], 25);
    s.drive.rung(-1, s.f);
    await s.run(2, free);
    s.shifter.flick(-1, true);
    await watchArc(s);
    // (the lens settled at the kerb, then each look held 1.5 s, its last second watched, and let go a second)
    await s.run(4, free);
    const rows: Record<string, unknown> = {};
    let hidden = 0, partly = 0, inside = 0, frames = 0, armMin = Infinity, view = 0;
    for (const deg of [-25, 25, -40, 40, -90, 90, 0]) {
      let h = 0, pa = 0, ins = 0, n = 0, am = Infinity;
      for (let k = 0; k < 90; k++) {
        if (k % 30 === 0) await pump(city, s.f.x, s.f.z, 0, s.f.fx, s.f.fz);
        s.frame(free(), deg ? lookPx(deg) : 0);
        if (k < 30 || s.cf.state !== 'on') continue;
        const v = sight(s);
        n++;
        if (v.hidden) h++;
        if (v.partly) pa++;
        if (v.inside) ins++;
        am = Math.min(am, v.arm);
        view = Math.max(view, Math.abs(s.rig.lookYawNow));
      }
      await s.run(1, free);
      rows[deg] = { hidden: h, partly: pa, inside: ins, frames: n, armMin: r1(am) };
      hidden += h; partly += pa; inside += ins; frames += n; armMin = Math.min(armMin, am);
    }
    out[name] = { hidden, partly, inside, frames, armMin: r1(armMin), viewMaxDeg: r1((view * 180) / Math.PI), state: s.cf.state, rows };
  }
  res.look = out;
  console.log('a look held round each street:', JSON.stringify(out));
}

// ---- 9. a dead end (the review's M1): life holds the bus at the lane's last point; stood still a second, the wheels go up
{
  const s = await session(37.731078, -122.418044, 95.4, 25);
  s.drive.rung(-1, s.f);
  await s.run(2, free);
  s.shifter.flick(-1, true);
  const arc = await watchArc(s);
  let stillAt = -1, readout = 0, asks0 = 0, stoodFor = -1;
  const t0 = s.t;
  for (let k = 0; k < 120 * 60 && s.cf.state === 'on'; k++) {
    if (k % 30 === 0) await pump(city, s.f.x, s.f.z, 0, s.f.fx, s.f.fz);
    s.frame(free());
    if (s.cf.qa.stood > 0 && stillAt < 0) {
      stillAt = s.t - dt;
      asks0 = s.asks;
    } else if (s.cf.qa.stood === 0 && s.cf.state === 'on') stillAt = -1;
    if (stillAt >= 0 && s.cf.state === 'on') readout = Math.max(readout, s.f.speed);
    if (s.cf.state !== 'on' && stillAt >= 0) stoodFor = s.t - stillAt;
  }
  res.deadEnd = { arc: arc.endState, rolledS: r1(s.t - t0), state: s.cf.state, left: s.cf.left, below: s.drive.below, stoodS: r2(stoodFor), readoutWhileStill: r2(readout), lifeAsksWhileStill: s.asks - asks0, lifeState: s.curb.state };
  console.log('a dead end:', JSON.stringify(res.deadEnd));
}

// ---- 10. the decks (the review's M2, the GPU check's fifth): under the Bay Bridge's approach the lens stays under the deck; its lower deck is no
// street, nor its upper deck from the water; its upper deck from above lands, the lens on it
{
  const out: Record<string, unknown> = {};
  {
    // (a street under the approach's deck, 41 m up: Rincon Hill, the cars' own way)
    const s = await session(37.788679, -122.388202, 168.3, 20);
    s.drive.rung(-1, s.f);
    await s.run(2, free);
    s.shifter.flick(-1, true);
    const arc = await watchArc(s);
    let over = 0, step = 0, hi = -Infinity, frames = 0, hidden = 0, last: THREE.Vector3 | null = null;
    for (let k = 0; k < 30 * 60 && s.cf.state === 'on'; k++) {
      if (k % 30 === 0) await pump(city, s.f.x, s.f.z, 0, s.f.fx, s.f.fz);
      s.frame(free());
      const c = s.cam.position, road = s.f.y - config.curb.ride;
      if (last) step = Math.max(step, c.distanceTo(last));
      last = (last ?? new THREE.Vector3()).copy(c);
      if (city.roadwayAt(c.x, c.z, c.y) > road + 3) over++;
      hi = Math.max(hi, c.y - road);
      if (sight(s).hidden) hidden++;
      frames++;
    }
    out.underApproach = { arc: arc.endState, frames, lensOverADeck: over, lensWorstStepM: r2(step), lensHighestOverRoadM: r1(hi), hidden, state: s.cf.state, left: s.cf.left };
  }
  for (const [name, hdg, agl] of [['fromTheWater', 220.3, 30], ['lowerDeckFromAbove', 40.3, 91]] as const) {
    const s = await session(37.7966, -122.3796, hdg, agl);
    s.drive.rung(-1, s.f);
    await s.run(0.5, free);
    s.shifter.flick(-1, true);
    for (let k = 0; k < 90 && (s.cf.state === 'ask' || s.cf.state === 'fly'); k++) s.frame(free());
    out[name] = { state: s.cf.state, below: s.drive.below, none: s.evs.some((e) => e.ev === 'none'), land: s.evs.some((e) => e.ev === 'land'), over: r1(s.f.y - s.f.groundUnder) };
  }
  {
    // (westbound over the upper deck: it lands there, the lens on the deck, the bus in sight)
    const s = await session(37.7966, -122.3796, 220.3, 91);
    s.drive.rung(-1, s.f);
    await s.run(0.5, free);
    s.shifter.flick(-1, true);
    const arc = await watchArc(s);
    let hidden = 0, frames = 0, low = Infinity;
    for (let k = 0; k < 10 * 60 && s.cf.state === 'on'; k++) {
      if (k % 30 === 0) await pump(city, s.f.x, s.f.z, 0, s.f.fx, s.f.fz);
      s.frame(free());
      if (k < 180) continue;
      const c = s.cam.position;
      low = Math.min(low, c.y - Math.max(city.groundAt(c.x, c.z), city.roadwayAt(c.x, c.z, s.f.y)));
      if (sight(s).hidden) hidden++;
      frames++;
    }
    out.upperDeck = { arc: arc.endState, frames, hidden, lensLowestOverDeckM: r1(low), deck: r1(city.roadwayAt(s.f.x, s.f.z, s.f.y)), rideOverDeck: r2(s.f.y - city.roadwayAt(s.f.x, s.f.z, s.f.y)), state: s.cf.state };
  }
  res.decks = out;
  console.log('the decks:', JSON.stringify(out));
}

// ---- 11. a dive at Express past a street's end with life slow to answer (the review's m1): the dive's floor lets go where the road does
{
  const out: Record<string, unknown> = {};
  // (the street ends: the first corner on the arterial's or the residential street's lane, the way turning over 60 degrees within 12 m, or its end
  // (the arterial's runs into a dead end of the cars' net), at least 140 m on: the dive starts 75 m before it, flying straight on into the block
  // past it as life answers. The waterfront and the hill skim over the band)
  const { localToLatLon } = await import('@src/game/geo');
  let start: { lat: number; lon: number; hdg: number; street: string; at: string } | null = null;
  for (const [name, p] of [['arterial', ARTERIAL], ['residential', RESIDENTIAL]] as const) {
    const [x0, z0] = ll(p[0], p[1]);
    const net = netAround(x0, z0);
    const spot = curbLand(net, x0, z0, Math.sin((p[2] * Math.PI) / 180), -Math.cos((p[2] * Math.PI) / 180), 80);
    if (!spot) continue;
    const pts = new Float32Array(4 * 400), n = curbPath(net, spot.w, spot.s, 1500, null, pts, { w: 0, s: 0 });
    const hd = (i: number) => Math.atan2(pts[i * 4 + 4] - pts[i * 4], -(pts[i * 4 + 6] - pts[i * 4 + 2]));
    let at = -1, what = '';
    for (let i = 35; i < n - 4 && at < 0; i++) {
      const turn = Math.abs(Math.atan2(Math.sin(hd(i + 3) - hd(i)), Math.cos(hd(i + 3) - hd(i))));
      if (turn >= Math.PI / 3) (at = i), (what = 'corner');
    }
    if (at < 0 && n >= 40 && n < 360) (at = n - 1), (what = 'end');
    if (at < 0) continue;
    const j = at - Math.round(75 / curbTune.step), [lat, lon] = localToLatLon(pts[j * 4], pts[j * 4 + 2], man.origin);
    start = { lat, lon, hdg: (hd(j) * 180) / Math.PI, street: name, at: `${what} ${at * curbTune.step} m on` };
    break;
  }
  for (const [name, late] of [['late067', 0.67], ['never', Infinity]] as const) {
    if (!start) break;
    const s = await session(start.lat, start.lon, start.hdg, -1, late);
    s.drive.rung(1, s.f);
    await s.run(0.5, free);
    let inside = 0, rise = 0, asked = -1, atStreet = 0, frames = 0, lowest = Infinity;
    for (let k = 0; k < 4 * 60; k++) {
      if (k % 30 === 0) await pump(city, s.f.x, s.f.z, s.f.lift, s.f.fx, s.f.fz);
      const y0 = s.f.y;
      s.frame(s.cf.state === 'fly' && asked < 0 ? push(1)() : free());
      lowest = Math.min(lowest, s.f.y - s.f.groundUnder);
      if (s.cf.state === 'ask' && asked < 0) asked = s.t;
      if (asked < 0) continue;
      frames++;
      if (city.buildingAbove(s.f.x, s.f.z, s.f.y) !== null) inside++;
      rise = Math.max(rise, s.f.y - y0);
      if (s.cf.state === 'ask' && !Number.isNaN(s.f.street)) atStreet++;
      if (s.cf.state === 'on' || s.cf.state === 'bounce' || s.cf.state === 'fly') break;
    }
    out[name] = { street: start.street, at: start.at, asked: asked >= 0, frames, insideFrames: inside, worstRiseInAFrameM: r2(rise), askFramesAtStreetFloor: atStreet, lowestOverGroundM: r1(lowest), state: s.cf.state };
  }
  res.pastTheEnd = out;
  console.log('a dive past a street\'s end, life slow:', JSON.stringify(out));
}

// ---- the verdicts
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const C = res.cruise, R = res.roll;
ok(C.ask.state !== 'fly' && Math.abs(C.ask.after - 0.5) <= 0.02 + dt, `Curb: a dive along a street at Cruise asks at 0.5 s: ${JSON.stringify(C.ask)}`);
for (const [n, a] of [['Cruise', C.arc], ['Express', res.express.arc], ['School Zone, the sink', res.zoneSink.arc], ['School Zone, a flick at 50 m', res.zoneFlick.arc], ['School Zone, a flick at 25 m', res.zoneFlickLow.arc]] as const)
  ok(a.state === 'arc' && a.below === CURB && a.gear === 0 && a.endState === 'on' && a.worstStepOverM <= 0 && a.mostBackM <= 0.05 && a.endOffM <= 0.3, `Curb: the arc from ${n} lands with no step over its speed and nothing back along the lane: ${JSON.stringify(a)}`);
ok(res.express.ask.state !== 'fly', `Curb: Express lands: ${JSON.stringify(res.express.ask)}`);
for (const [n, a] of [['Cruise', C.arc], ['Express', res.express.arc]] as const)
  ok(a.catchCalls <= 6 && a.readoutStep < 4, `Curb: the arc from ${n} catches life's lane up in at most 6 calls, and the readout eases (under 4 m/s a frame): ${JSON.stringify(a)}`);
ok(res.zoneFlick.arc.topSpeed <= config.curb.arcTop + 15 && res.zoneFlick.arc.topSpeed <= res.zoneFlickLow.arc.topSpeed + 15, `Curb: the arc from 50 m is no faster than its top, nor than from 25 m: ${JSON.stringify({ at50: res.zoneFlick.arc, at25: res.zoneFlickLow.arc })}`);
ok(res.zoneFlick.hints.length === 1 && res.zoneFlick.hints[0] === true, `Curb: a flick that lands learns the hint: ${JSON.stringify(res.zoneFlick.hints)}`);
ok(R.state === 'on' && R.below === CURB && R.name === 'CURB' && R.worstOffLaneM < 1 && Math.abs(R.speed - 10) < 2 && R.beside, `Curb: 12 s rolled on the lane beside the car, at its pace: ${JSON.stringify(R)}`);
ok(R.painted === 1 && Math.abs(R.paintedAtS - R.besideAtS - 1.5) <= 0.05, `Curb: the car ridden beside is painted once, 1.5 s after it's beside: ${JSON.stringify(R)}`);
ok(Math.abs(R.dabs - R.rolledM / 3) <= 2, `Curb: the lane paints a dab every 3 m: ${R.dabs} for ${R.rolledM} m`);
ok(R.lensEnd < 40 && R.lensStart > 100 && R.lensWorstStep < 3, `Curb: the lens comes down to the kerb, no step over 3 m a frame: ${JSON.stringify(R)}`);
ok(res.push.aheadOfCarM > 5 && res.push.state === 'on' && res.push.passes === 1, `Curb: a push rolls on past the car, with the toots: ${JSON.stringify(res.push)}`);
const P = res.pullOff;
ok(P.afterStroke.state === 'on' && P.leftAtS > 0.2 && P.leftAtS < 0.3 && P.left === 'pull' && P.below === SCHOOL_ZONE && P.climbVmax > 10 && P.climbVmax <= 15.5, `Curb: a flick's stroke stays on, a pull held 0.25 s gets off and climbs out at 15 m/s: ${JSON.stringify(P)}`);
ok(P.lensBack > 80 && P.curbIn < 0.05 && P.lensWorstStep < 3, `Curb: the lens cranes back up to School Zone's: ${JSON.stringify(P)}`);
ok(res.flickUp.state === 'leave' && res.flickUp.left === 'flick' && res.flickUp.below === SCHOOL_ZONE && res.flickUp.after.speed < 1 && res.flickUp.after.overFloor > -1.5, `Curb: a flick up gets off to School Zone, hovering at the street's floor: ${JSON.stringify(res.flickUp)}`);
ok(res.zoneHigh.asked === 0 && res.zoneHigh.below === SCHOOL_ZONE, `Curb: a flick down at 80 m does nothing: ${JSON.stringify(res.zoneHigh)}`);
const N = res.none;
for (const k of ['nonstop', 'jet', 'turbo', 'letGo', 'acrossTheBlocks', 'diveOnlySurge']) ok(N[k].asked === 0, `Curb: nothing lands (${k}): ${JSON.stringify(N[k])}`);
ok(N.diveOnlyZone.asked === 1, `Curb: diveOnly still lands School Zone's sink: ${JSON.stringify(N.diveOnlyZone)}`);
const Fs = res.findAStreet;
ok(Fs.state === 'bounce' && Fs.vyGain > 3 && Fs.toast && Fs.at15s === 'bounce' && Fs.at21s === 'fly' && Fs.below === SCHOOL_ZONE, `Curb: no street, the hop and FIND A STREET, 2 s quiet: ${JSON.stringify(Fs)}`);
ok(Fs.hints.length === 0, `Curb: a flick that finds no street doesn't learn the hint: ${JSON.stringify(Fs)}`);
const Th = res.thrown;
ok(Th.glanceTurns === 0 && Th.lookTurns === 1 && Th.sideWhileLooking === -1, `Curb: a look held says the turn once, a glance doesn't: ${JSON.stringify(Th)}`);
ok(Math.abs(Th.askedWhileLooking + Math.PI / 2) < 0.01 && Math.abs(Th.after05.asked + Math.PI / 2) < 0.01 && Th.after05.side === -1 && Th.after2.asked === 0 && Th.after2.side === 1, `Curb: the look asks life for the turn square, and it and the drive-by's side are kept a moment past the lift: ${JSON.stringify(Th)}`);
ok(Math.abs(Th.viewDeg) <= config.curb.lookMax + 0.5, `Curb: on the street the view turns at most ${config.curb.lookMax} degrees: ${JSON.stringify(Th)}`);
ok(Th.left === 'thrown' && Th.state === 'leave' && Th.gear === EXPRESS, `Curb: a gear forced on it throws it off the street: ${JSON.stringify(Th)}`);
for (const [name, l] of Object.entries(res.look) as Array<[string, any]>)
  ok(l.frames > 300 && l.hidden === 0 && l.inside === 0, `Curb: a look held round the ${name} street never hides the bus nor stands the lens in a house: ${JSON.stringify(l)}`);
const De = res.deadEnd;
ok(De.left === 'end' && De.below === SCHOOL_ZONE && De.stoodS > 0 && De.stoodS <= config.curb.stallFor + 0.05 && De.readoutWhileStill <= config.curb.stallSpeed, `Curb: at a dead end the wheels go up a second after the bus stands, the readout saying it stands: ${JSON.stringify(De)}`);
const Dk = res.decks;
ok(Dk.underApproach.arc === 'on' && Dk.underApproach.frames > 600 && Dk.underApproach.lensOverADeck === 0 && Dk.underApproach.lensWorstStepM < 3 && Dk.underApproach.hidden === 0, `Curb: under the Bay Bridge's approach the lens stays under the deck, no jump, the bus in sight: ${JSON.stringify(Dk.underApproach)}`);
for (const k of ['fromTheWater', 'lowerDeckFromAbove']) ok(Dk[k].state === 'bounce' && Dk[k].none && !Dk[k].land, `Curb: no street (${k}): ${JSON.stringify(Dk[k])}`);
ok(Dk.upperDeck.arc === 'on' && Dk.upperDeck.frames > 300 && Dk.upperDeck.hidden === 0 && Dk.upperDeck.lensLowestOverDeckM >= config.curb.camFloor - 0.1, `Curb: the upper deck lands from above, the lens on it, the bus in sight: ${JSON.stringify(Dk.upperDeck)}`);
for (const [name, p] of Object.entries(res.pastTheEnd) as Array<[string, any]>)
  ok(p.asked && p.insideFrames === 0, `Curb: a dive past a street's end with life slow (${name}) never has the bus in a building: ${JSON.stringify(p)}`);
void NONSTOP; void JET;
console.log(fails.length ? `FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `curb checks: all ${checks} passed`);
process.exit(fails.length ? 1 : 0);
