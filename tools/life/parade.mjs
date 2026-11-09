#!/usr/bin/env node
// Parade (SHOTS.md, "The shots"; src/life/Parade.ts), in Node on a hand-made street and a hand-made snapshot of cars, with the host's real Curb on it and a
// stand-in for its worker: node --expose-gc --no-warnings tools/life/parade.mjs
//   air      a car painted with the bus in the air stays on its road
//   join     a car the player's paint lands on while the bus rolls on the street honks and leaps in behind it: over an arc, then on the lane behind the bus's
//            tail, its own row hidden and the car drawn from the Parade's
//   whose    another faction's paint calls no car, and nor does the player's on a car 300 m off
//   six      one splat over seven more: five fall in, a beat apart, each with its honk, the nearest first; the line full, the rest only honk, once
//   line     nose to tail 3 m apart behind the bus's tail on the straight, facing the way the bus went and nose up the hill; round a bend each on the lane (a semi
//            cuts it by under a metre), at the road's height
//   splat    a splat on a car in the line paints it there, and one where its hidden row is doesn't
//   leave    the bus off the street: the line rolls to a stop, waits, pops away one after the other, and each car grows back on its own road
//   landing  a new landing with a line still out: the old line pops away at once and the new street starts its own
//   beside   the car Curb paces and paints falls in, and Curb doesn't go on pacing its hidden row
//   alloc    10,000 frames of a full line rolling round a ring grow the heap by under 64 KB (CONTRACT.md section 7, L4)
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const THREE = await import('three');
const { LifeHost } = await import('../../src/life/Life.ts');
const { Pools } = await import('../../src/life/pools.ts');
const { paradeTune } = await import('../../src/life/Parade.ts');
const { SNAP_BYTES, view, writeKey } = await import('../../src/life/snapshot.ts');
const { fnv1a } = await import('../../src/life/hash.ts');
const { Col, Kind, ROW } = await import('../../src/life/kinds.ts');
const { globals } = await import('../../src/render/materials.ts');

if (typeof gc !== 'function') {
  console.log('run with --expose-gc');
  process.exit(2);
}
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const T0 = Date.parse('2026-11-07T22:00:00Z'), TAIL = 8.9, ME = 3, FOE = 1;
// ---- the street: 120 m north, a 40 m bend to the east, then east; uphill all the way, 5 in 100 ----
const BEND = 120, RAD = 40, ARC = (RAD * Math.PI) / 2;
const laneAt = (s) => {
  const y = 10 + 0.05 * s;
  if (s <= BEND) return { x: 0, y, z: -s, ux: 0, uz: -1 };
  if (s <= BEND + ARC) {
    const a = (s - BEND) / RAD;
    return { x: RAD - RAD * Math.cos(a), y, z: -BEND - RAD * Math.sin(a), ux: Math.sin(a), uz: -Math.cos(a) };
  }
  return { x: RAD + s - BEND - ARC, y, z: -BEND - RAD, ux: 1, uz: 0 };
};
/** Where on the street (x, z) is: how far along, and how far off it. */
const onLane = (x, z) => {
  let best = Infinity, at = 0;
  const look = (s) => {
    const p = laneAt(s), d = Math.hypot(p.x - x, p.z - z);
    if (d < best) {
      best = d;
      at = s;
    }
  };
  for (let s = 0; s <= 600; s += 0.25) look(s);
  for (let s = at - 0.25, e = at + 0.25; s <= e; s += 0.005) look(s);
  return { s: at, off: best, y: laneAt(at).y };
};
// (the worker's answer, as lifeWorker's curb(): the lane from the point nearest the ask, a point every 4 m, the road's speed on each)
const answers = [];
const answer = (m) => {
  const s0 = onLane(m.x, m.z).s, n = Math.floor(m.length / 4) + 1, pts = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = laneAt(s0 + i * 4);
    pts.set([p.x, p.y, p.z, 10], i * 4);
  }
  answers.push({ type: 'curb', id: m.id, n, pts, js: new Int32Array(0), nj: 0, dead: false });
};
const worker = { postMessage: (m) => m?.type === 'curb' && answer(m), onmessage: null };
const store = { put() {}, clear() {}, load: async () => [] };
const pools = new Pools(), life = new LifeHost(worker, pools, store, 'sf', [37.7749, -122.4194]);
const flush = () => { while (answers.length) worker.onmessage({ data: answers.shift() }); };
// ---- the cars: key, kind, x, z, velocity, scale, look ----
const CLUSTER = [0, 1, 2, 3, 4, 5, 6].map((i) => [`car:p:c${i}`, i === 3 ? Kind.TRUCK : Kind.CAR, -20 - 4 * i, -60 - 5 * i, 0, 0, i === 3 ? 1.2 : 1.3, i === 3 ? 4 : 0]);
const CARS = [
  ['car:p:air', Kind.CAR, 30, -20, 0, 0, 1.3, 0],
  ['car:p:one', Kind.CAR, 25, -30, 0, -2, 1.3, 0],
  ['car:p:foe', Kind.CAR, 60, -10, 0, 0, 1.3, 0],
  ['car:p:far', Kind.CAR, 300, -50, 0, 0, 1.3, 0],
  ...CLUSTER,
];
const hashOf = (key) => fnv1a(key);
let sim = 1, utc = T0;
const snapshot = (cars) => {
  const buf = new ArrayBuffer(SNAP_BYTES), v = view(buf), f = v.rows, u = v.rowsU32;
  let keyAt = 0;
  cars.forEach(([key, kind, x, z, vx, vz, scale, look], i) => {
    const o = i * ROW, h = fnv1a(key);
    u[o + Col.KEY] = h;
    f[o + Col.KIND] = kind;
    f[o + Col.X] = x;
    f[o + Col.Y] = 12;
    f[o + Col.Z] = z;
    f[o + Col.VX] = vx;
    f[o + Col.VZ] = vz;
    f[o + Col.HEADING] = Math.atan2(vz, vx || 1e-9);
    f[o + Col.SCALE] = scale;
    f[o + Col.LOOK] = look;
    f[o + Col.UNTIL] = 3600;
    keyAt = writeKey(v, keyAt, h, key);
  });
  v.u32[3] = keyAt;
  v.f64[0] = utc;
  v.u32[2] = cars.length;
  worker.onmessage({ data: { type: 'snap', buf } });
};
snapshot(CARS);
globals.uPixelAngle.value = 0.0003;
const camera = new THREE.PerspectiveCamera(40, 393 / 852, 1.5, 30000);
camera.position.set(60, 900, 200);
camera.lookAt(60, 0, -80);
camera.updateMatrixWorld();
const honks = [];
const P = life.paradeOn({ faction: () => ME, tail: TAIL, honk: (n) => honks.push([n, +sim.toFixed(3)]) });
const pose = { x: 0, y: 0, z: 0, heading: 0, speed: 0 }, air = { x: 0, y: 300, z: 0 };
let rolling = false, each = null;
const step = (s) => {
  for (let k = 0; k < Math.round(s * 60); k++) {
    sim += 1 / 60;
    utc += 1000 / 60;
    if (rolling) {
      life.curbRoll(1 / 60, 0, 0, pose);
      flush();
    }
    life.frame(1 / 60, sim, utc, rolling ? pose : air, camera);
    each?.();
  }
};
const land = (x, z) => {
  life.curb.land(x, z, 0, 10);
  flush();
  rolling = true;
};
const paint = (key, faction = ME) => life.hit(key, 2, utc, sim, faction);
/** Where mover `key` was drawn last frame: every place its hash was noted at. */
const drawnAt = (key) => {
  const h = hashOf(key), out = [];
  for (let i = 0; i < life.qa.drawn; i++) if (life.drawn[i * 4] === h) out.push({ x: life.drawn[i * 4 + 1], y: life.drawn[i * 4 + 2], z: life.drawn[i * 4 + 3] });
  return out;
};
/** The line, by place: each car's key hash, phase and where its row has it. */
const line = () => {
  const out = [];
  for (let j = 0; j < P.slots; j++) {
    if (!P.shown(j)) continue;
    const o = j * ROW;
    out.push({ j, h: P.u32[o + Col.KEY], place: P.placeOf(j), phase: P.phaseOf(j), heading: P.rows[o + Col.HEADING], pitch: P.rows[o + Col.PITCH], x: P.rows[o + Col.X], y: P.rows[o + Col.Y], z: P.rows[o + Col.Z], scale: P.rows[o + Col.SCALE], long: P.longOf(j) });
  }
  return out.sort((a, b) => a.place - b.place);
};
const r1 = (v) => +v.toFixed(1), r2 = (v) => +v.toFixed(2);

// ---- air ----
step(0.2);
paint('car:p:air');
step(0.3);
const airAt = drawnAt('car:p:air');
row('air: a car painted with the bus in the air stays on its road', P.qa.joined === 0 && P.busy === 0 && life.painted.has(hashOf('car:p:air')) && airAt.length === 1 && Math.abs(airAt[0].x - 30) < 0.1,
  { joined: P.qa.joined, painted: life.painted.has(hashOf('car:p:air')), drawnAt: airAt.map((p) => [r1(p.x), r1(p.z)]) });

// ---- join ----
land(0, 0);
step(0.5);
paint('car:p:one');
step(2 / 60);
const j0 = { count: P.count, honks: honks.map((h) => h[0]) };
// (the leap: how far over the straight way from where it was to where it lands it gets)
let top = -Infinity, leapS = 0;
const from = line()[0];
each = () => {
  const c = line()[0];
  if (c && c.phase === 1) {
    top = Math.max(top, c.y - Math.max(from.y, onLane(c.x, c.z).y));
    leapS += 1 / 60;
  }
};
step(2);
each = null;
const one = line()[0], oneAt = drawnAt('car:p:one'), bus1 = onLane(pose.x, pose.z), car1 = onLane(one.x, one.z), back1 = bus1.s - car1.s, want1 = TAIL + paradeTune.gap + (4.4 * 1.3) / 2;
row('join: painted from the street, it honks and leaps in behind the bus: an arc, then on the lane behind the tail, drawn from the Parade\'s row alone',
  life.curb.state === 'on' && j0.count === 1 && j0.honks.length === 1 && j0.honks[0] === 0 && top > 1 && leapS > 0.8 && leapS < 1.6 && one.phase === 2 && car1.off < 0.2 && Math.abs(back1 - want1) < 0.3 && oneAt.length === 1 && Math.hypot(oneAt[0].x - one.x, oneAt[0].z - one.z) < 0.01 && P.ghost(hashOf('car:p:one')) === 0,
  { curb: life.curb.state, count: j0.count, honks: j0.honks, leapTopM: r1(top), leapS: r2(leapS), phase: one.phase, offLaneM: r2(car1.off), behindBusM: r2(back1), wantM: r2(want1), drawn: oneAt.length });

// ---- whose ----
paint('car:p:foe', FOE);
paint('car:p:far');
step(0.3);
row('whose: another faction\'s paint calls no car, nor the player\'s on a car 300 m off', P.count === 1 && P.qa.joined === 1 && life.painted.get(hashOf('car:p:foe'))?.faction === FOE && life.painted.has(hashOf('car:p:far')),
  { count: P.count, joined: P.qa.joined, foe: life.painted.get(hashOf('car:p:foe'))?.faction });

// ---- six ----
honks.length = 0;
life.blast(-32, 12, -75, 40, 2, undefined, sim, ME);
step(0.1);
const s0 = { count: P.count, full: P.qa.full };
step(3);
const fell = honks.filter((h) => h[0] >= 0), low = honks.filter((h) => h[0] < 0), gaps = fell.slice(1).map((h, i) => r2(h[1] - fell[i][1]));
const L6 = line(), byD = CLUSTER.map(([key, , x, z]) => ({ key, d: Math.hypot(x, z + 30) })).sort((a, b) => a.d - b.d).map((c) => hashOf(c.key));
row('six: one splat over seven more: five fall in a beat apart, each with its honk, the nearest first; the line full, the rest only honk, once',
  s0.count === 6 && s0.full === 2 && fell.map((h) => h[0]).join() === '1,2,3,4,5' && gaps.every((g) => Math.abs(g - paradeTune.beat) < 0.02) && low.length === 1 && L6.length === 6 && L6.every((c) => c.phase === 2) && L6.slice(1).every((c, i) => c.h === byD[i]),
  { count: s0.count, full: s0.full, honks: honks.map((h) => h[0]), gapsS: gaps, inLine: L6.length, nearestFirst: L6.slice(1).every((c, i) => c.h === byD[i]) });

// ---- line ----
// (on the straight: the bus about 100 m along, the whole line behind it short of the bend)
while (onLane(pose.x, pose.z).s < 100) step(0.1);
const str = line().map((c) => ({ ...c, ...onLane(c.x, c.z) })), busS = onLane(pose.x, pose.z).s;
const bumper = [busS - TAIL - (str[0].s + (str[0].long * str[0].scale) / 2), ...str.slice(1).map((c, i) => str[i].s - (str[i].long * str[i].scale) / 2 - (c.s + (c.long * c.scale) / 2))];
// (a row's heading is the way it faces, atan2(dz, dx): north is -90 degrees; its pitch is its nose up, here the road's 5 in 100)
const faces = Math.max(...str.map((c) => Math.abs(c.heading + Math.PI / 2))), nose = Math.max(...str.map((c) => Math.abs(c.pitch - Math.atan(0.05))));
const offStr = Math.max(...str.map((c) => c.off)), yStr = Math.max(...str.map((c) => Math.abs(c.y - laneAt(c.s).y)));
// (round the bend: the bus 200 m along, the line through the turn)
while (onLane(pose.x, pose.z).s < 200) step(0.1);
const bent = line().map((c) => ({ ...c, ...onLane(c.x, c.z) }));
const offBend = Math.max(...bent.filter((c) => c.long < 15).map((c) => c.off)), offSemi = Math.max(...bent.filter((c) => c.long > 15).map((c) => c.off)), yBend = Math.max(...bent.map((c) => Math.abs(c.y - laneAt(c.s).y)));
const turned = bent.filter((c) => c.s > BEND && c.s < BEND + ARC).length;
row('line: 3 m bumper to bumper behind the tail on the straight; round a bend each on the lane (a semi cuts it by under a metre), at the road\'s height',
  bumper.every((g) => Math.abs(g - paradeTune.gap) < 0.05) && offStr < 0.05 && yStr < 0.2 && faces < 0.01 && nose < 0.005 && turned >= 2 && offBend < 0.25 && offSemi < 1 && yBend < 0.25 && life.qa.marks > 0,
  { bumperM: bumper.map(r2), offStraightM: r2(offStr), yStraightM: r2(yStr), offNorthRad: r2(faces), offGradeRad: r2(nose), inTheBend: turned, offBendM: r2(offBend), semiOffM: r2(offSemi), yBendM: r2(yBend), lineLongM: r1(busS - str[5].s), marks: life.qa.marks });

// ---- splat ----
const lastH = line()[5].h, third = line()[2], key3 = [...CARS].find((c) => hashOf(c[0]) === third.h), lv0 = life.painted.get(third.h).level;
life.blast(key3[2], 12, key3[3], 1, 4, undefined, sim, ME);
step(0.1);
const lvRow = life.painted.get(third.h).level;
const now3 = line()[2];
life.blast(now3.x, now3.y, now3.z, 1, 4, undefined, sim, ME);
step(0.1);
const lvLine = life.painted.get(third.h).level;
row('splat: a splat on a car in the line paints it there, and one where its hidden row is doesn\'t', lvRow === lv0 && lvLine === lv0 + 1 && P.count === 6, { was: lv0, afterItsRow: lvRow, afterTheLine: lvLine, count: P.count });

// ---- leave ----
rolling = false;
life.curb.leave();
const stop0 = line()[0];
step(1.5);
const stop1 = line()[0], coasted = Math.hypot(stop1.x - stop0.x, stop1.z - stop0.z), waiting = { count: P.count, phases: line().map((c) => c.phase).join('') };
step(paradeTune.linger - 1.5 + 5 * paradeTune.outBeat + paradeTune.out + 0.1);
const popped = { count: P.count, shown: line().length, busy: P.busy, left: P.qa.left };
step(paradeTune.back / 2);
const growing = r2(P.ghost(lastH));
step(paradeTune.back);
const homeAt = drawnAt(key3[0]);
row('leave: off the street the line rolls to a stop, waits, pops away one after the other, and each car grows back on its own road',
  coasted > 1 && coasted < 12 && waiting.count === 6 && waiting.phases === '222222' && popped.count === 0 && popped.shown === 0 && popped.left === 6 && growing > 0 && growing < 1 && P.busy === 0 && homeAt.length === 1 && Math.abs(homeAt[0].x - key3[2]) < 0.1,
  { coastedM: r1(coasted), waiting, popped, growingBack: growing, busy: P.busy, backOnItsRoad: homeAt.length === 1 });

// ---- landing ----
snapshot(CARS);
land(0, 0);
step(0.5);
paint('car:p:one');
paint('car:p:c0');
step(2);
const before = { count: P.count, landings: P.qa.landings };
rolling = false;
life.curb.leave();
step(0.6);
const lingering = P.count;
land(pose.x, pose.z);
step(2 / 60);
const after = { count: P.count, shown: line().length, phases: line().map((c) => c.phase).join(''), landings: P.qa.landings };
paint('car:p:c1');
step(2.2);
const fresh = line();
row('landing: a new landing with a line still out: the old line pops away at once, and the new street starts its own',
  before.count === 2 && lingering === 2 && after.count === 0 && after.phases === '33' && after.landings === before.landings + 1 && P.count === 1 && fresh.length === 1 && fresh[0].h === hashOf('car:p:c1') && fresh[0].place === 0 && fresh[0].phase === 2,
  { before, lingering, after, then: { count: P.count, place: fresh[0]?.place, phase: fresh[0]?.phase } });

// ---- beside ----
rolling = false;
life.curb.leave();
step(paradeTune.linger + 2);
// (a car a lane over on the traffic's side, 40 m ahead at 5 m/s: the bus pulls up beside it, paces it and paints it after 1.5 s)
const SLOW = 'car:p:slow', besides = [];
snapshot([[SLOW, Kind.CAR, -3.9, -40, 0, -5, 1.3, 0]]);
life.curb.onBeside = (key) => {
  besides.push(key);
  paint(key);
};
land(0, 0);
let pacedAt = -1, slowest = Infinity, t = 0, still = 0;
each = () => {
  t += 1 / 60;
  if (besides.length && pacedAt < 0) pacedAt = t;
  if (pacedAt < 0) slowest = Math.min(slowest, pose.speed);
  else if (t > pacedAt + 0.2 && life.curb.beside === SLOW) still++;
};
while (pacedAt < 0 && t < 20) step(0.1);
step(4);
each = null;
row('beside: the car Curb paces and paints falls in, and Curb doesn\'t go on pacing its hidden row', besides.join() === SLOW && slowest < 8 && P.count === 1 && line()[0]?.h === hashOf(SLOW) && still === 0 && pose.speed > 9,
  { painted: besides, pacedAtS: r1(pacedAt), slowestMS: r1(slowest), count: P.count, framesStillBeside: still, speedAfterMS: r1(pose.speed) });

// ---- alloc ----
rolling = false;
life.curb.leave();
life.curb.onBeside = null;
step(paradeTune.linger + 2);
const RING = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [`car:p:r${i}`, i === 2 ? Kind.TRUCK : Kind.CAR, 150 - 8 * i, -60 - 5 * i, 0, 0, 1.3, i === 2 ? 4 : 0]);
snapshot(RING);
let a = 0;
const ring = () => {
  a += (10 / 60) / 100;
  pose.x = 60 + 100 * Math.cos(a);
  pose.z = -80 + 100 * Math.sin(a);
  pose.y = 12;
  pose.heading = a + Math.PI;
  pose.speed = 10;
  sim += 1 / 60;
  utc += 1000 / 60;
  P.lead(pose);
  life.frame(1 / 60, sim, utc, pose, camera);
};
ring();
for (const c of RING) paint(c[0]);
for (let i = 0; i < 30000; i++) ring();
gc();
gc();
const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 10000; i++) ring();
const made = process.memoryUsage().heapUsed - h0;
gc();
gc();
const kept = process.memoryUsage().heapUsed - h0;
row('alloc: 10,000 frames of a full line rolling round a ring grow the heap by under 64 KB', kept < 64 * 1024 && P.count === 6 && line().every((c) => c.phase === 2) && life.qa.marks > 0,
  { keptKB: r1(kept / 1024), madeKB: r1(made / 1024), count: P.count, models: life.qa.models, marks: life.qa.marks });
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
