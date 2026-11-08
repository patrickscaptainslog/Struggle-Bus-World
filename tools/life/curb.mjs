#!/usr/bin/env node
// Curb's road side (SHOTS.md, "Curb"), in Node on San Francisco's own road graphs round the Financial District: node --no-warnings tools/life/curb.mjs
//   land     from 200 points over the district, a bus flying low at 4 headings each: where a road is within 80 m it lands on the kerb's line of a way driven its
//            way, never in a tunnel, an alley or a living street, the line's point within 80 m; where none is, FIND A STREET
//   path     from each landing, 600 m of lane ahead: points 4 m apart with no jump, no turn sharper than a road's, never a tunnel, the road's speed on each
//   look     at the first junction a look to the left or the right takes another way than straight on, and a look ahead keeps it straight
//   same     the same answers twice (every player's lane is the same)
//   roll     the host's Curb (Curb.ts) on the same net: landed, kept on its line, pulled up beside a car in the kerb lane going its way and pacing it a lane to the
//            kerb's side of it, never inside it (the day review's B2), painting it after 1.5 s beside it; the thumb pushed rolls on past it; a long roll goes on
//            stretch after stretch; over open water, none
//   speed    landed with the bus's own speed, it rolls on from it (H1)
//   turn     a look held right from the landing takes the first junction ahead with a way to the right, not one 220 to 600 m on (M12)
//   dead     at a dead end it brakes to a stop at the kerb, no harder than curbHost.brake, and stops asking (M13)
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { buildNet } = await import('../../src/life/sim/cars.ts');
const { curbLand, curbPath, curbTune } = await import('../../src/life/sim/curb.ts');
const { rolldown } = await import('rolldown');
const { gunzipSync } = await import('node:zlib');
const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
const { fileURLToPath, pathToFileURL } = await import('node:url');
const here = fileURLToPath(new URL('.', import.meta.url)), root = fileURLToPath(new URL('../..', import.meta.url)), outDir = `${here}.out`;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/entry.ts`, `export { parseRegionGraph } from '${root.replace(/\\/g, '/')}src/world/lifeData.ts';`);
const bundle = await rolldown({ input: `${outDir}/entry.ts`, platform: 'node', logLevel: 'warn' });
await bundle.write({ dir: outDir, format: 'esm', entryFileNames: 'lifedata-curb.mjs' });
await bundle.close();
const { parseRegionGraph } = await import(pathToFileURL(`${outDir}/lifedata-curb.mjs`).href);

let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const man = JSON.parse(readFileSync(`${root}public/city/sf/city.json`, 'utf8')), M = man.regionSize * man.tileSize, BX = 1700, BZ = -1700;
const graphs = [];
for (const [rx, rz] of man.life.regions) {
  const dx = Math.max(rx * M - BX, 0, BX - (rx + 1) * M), dz = Math.max(rz * M - BZ, 0, BZ - (rz + 1) * M);
  if (Math.hypot(dx, dz) > 2100) continue;
  let b = readFileSync(`${root}public/city/sf/g_${rx}_${rz}.bin`);
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  graphs.push(parseRegionGraph(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), M));
}
graphs.sort((p, q) => p.rx - q.rx || p.rz - q.rz);
const net = buildNet(graphs);

// ---- land ----
let lands = 0, none = 0, wrongWay = 0, tunnel = 0, far = 0, narrow = 0;
const spots = [];
let r = 1;
const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
const t0 = performance.now();
for (let k = 0; k < 200; k++) {
  const x = BX + (rand() - 0.5) * 1600, z = BZ + (rand() - 0.5) * 1600;
  for (let h = 0; h < 4; h++) {
    const a = (h * Math.PI) / 2 + rand() * 0.6, fx = Math.cos(a), fz = Math.sin(a), s = curbLand(net, x, z, fx, fz);
    if (!s) {
      none++;
      continue;
    }
    lands++;
    if (s.ux * fx + s.uz * fz < curbTune.along - 1e-6) wrongWay++;
    if (net.tunnel[s.w]) tunnel++;
    if (net.cls[s.w] === 8 || net.cls[s.w] === 9) narrow++;
    if (Math.hypot(s.x - x, s.z - z) > curbTune.reach + 1e-3) far++;
    spots.push({ s, fx, fz });
  }
}
const landMs = (performance.now() - t0) / 800;
row('land: from 800 tries over the district, lines driven the bus\'s way within 80 m, none in a tunnel or an alley; no street, FIND A STREET', lands > 300 && wrongWay === 0 && tunnel === 0 && narrow === 0 && far === 0,
  { lands, none, wrongWay, tunnel, narrow, far, msEach: +landMs.toFixed(2), ways: net.n });

// ---- path ----
const out = new Float32Array(4 * 200), end = { w: 0, s: 0, dead: false, nj: 0 };
let paths = 0, jumps = 0, sharp = 0, reversals = 0, tunnels = 0, short = 0, worstStep = 0, noSpeed = 0, total = 0;
for (const { s } of spots.slice(0, 200)) {
  const n = curbPath(net, s.w, s.s, 600, null, out, end);
  paths++;
  total += n;
  if (n < 20) short++;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(out[i * 4] - out[i * 4 - 4], out[i * 4 + 2] - out[i * 4 - 2]);
    worstStep = Math.max(worstStep, d);
    if (d > curbTune.step * 3) jumps++;
    if (!(out[i * 4 + 3] > 0)) noSpeed++;
    if (i > 1) {
      const ax = out[i * 4 - 4] - out[i * 4 - 8], az = out[i * 4 - 2] - out[i * 4 - 6], bx = out[i * 4] - out[i * 4 - 4], bz = out[i * 4 + 2] - out[i * 4 - 2];
      const c = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1);
      if (c < -0.2) sharp++;
      if (c < -0.7) reversals++;
    }
  }
  if (net.tunnel[end.w]) tunnels++;
}
// (a corner past 100 degrees within 8 m is a real road's, counted; one past 135 would be the lane folding back on itself)
row('path: 600 m of lane ahead from each landing, 4 m steps with no jump or fold back, never a tunnel, the road\'s speed on each', paths > 100 && jumps <= paths * 0.02 && reversals === 0 && tunnels === 0 && noSpeed === 0,
  { paths, meanPoints: Math.round(total / paths), short, jumps, worstStepM: +worstStep.toFixed(1), sharpCorners: sharp, reversals, tunnels });

// ---- look: at the first junction, a look left or right takes another way than straight on ----
let tried = 0, turned = 0, straightKept = 0;
for (const { s } of spots.slice(0, 200)) {
  const left = net.len[s.w] - s.s, ex = net.t1[s.w * 2], ez = net.t1[s.w * 2 + 1];
  // (a choice: two ways on or more that the lane may take, no tunnel, no U-turn, and no alley where a street goes on)
  const ok = [];
  for (let k = net.outAt[s.w]; k < net.outAt[s.w + 1]; k++) {
    const o = net.outs[k];
    if (!net.tunnel[o] && net.t0[o * 2] * ex + net.t0[o * 2 + 1] * ez >= curbTune.uturn) ok.push(o);
  }
  const wide = ok.filter((o) => net.cls[o] !== 8 && net.cls[o] !== 9);
  if (left > 300 || (wide.length ? wide.length : ok.length) < 2) continue;
  tried++;
  const e1 = { w: 0, s: 0 }, e2 = { w: 0, s: 0 }, e3 = { w: 0, s: 0 };
  curbPath(net, s.w, s.s, left + 20, null, out, e1);
  curbPath(net, s.w, s.s, left + 20, [-ez, ex], out, e2);
  curbPath(net, s.w, s.s, left + 20, [ez, -ex], out, e3);
  const e4 = { w: 0, s: 0 };
  curbPath(net, s.w, s.s, left + 20, [ex, ez], out, e4);
  if (e2.w !== e1.w || e3.w !== e1.w) turned++;
  if (e4.w === e1.w) straightKept++;
}
row('look: at a junction a look left or right takes another way, a look ahead goes straight on', tried > 20 && turned / tried > 0.7 && straightKept === tried, { tried, turned, straightKept });

// ---- same ----
const a = spots[7].s, p1 = new Float32Array(400), p2 = new Float32Array(400);
curbPath(net, a.w, a.s, 300, null, p1, end);
curbPath(buildNet([...graphs]), a.w, a.s, 300, null, p2, end);
row('same: the same lane twice', p1.every((v, i) => v === p2[i]) && JSON.stringify(curbLand(net, a.x, a.z, 1, 0)) === JSON.stringify(curbLand(net, a.x, a.z, 1, 0)), {});
// ---- roll: the host's Curb on the same net, its worker a stand-in that answers as lifeWorker's curb() does; a car on the lane ahead at 10 m/s ----
const { Curb } = await import('../../src/life/Curb.ts');
const { SNAP_BYTES, view, writeKey } = await import('../../src/life/snapshot.ts');
const { fnv1a } = await import('../../src/life/hash.ts');
const { Col, Kind, ROW } = await import('../../src/life/kinds.ts');
const answers = [];
const worker = (m) => {
  const spot = curbLand(net, m.x, m.z, m.fx, m.fz, m.reach), pts = new Float32Array(Math.ceil(m.length / curbTune.step + 2) * 4), js = new Int32Array(64), e = { w: 0, s: 0, dead: false, nj: 0 };
  const n = spot ? curbPath(net, spot.w, spot.s, m.length, m.look, pts, e, js) : 0;
  answers.push({ type: 'curb', id: m.id, n, pts, js, nj: n ? e.nj : 0, dead: n > 0 && e.dead });
};
// (a long straight-ish lane: the landing whose 600 m path is longest, and 3 km of it for the car to drive)
let start = null, longest = 0;
for (const { s, fx, fz } of spots) {
  const n = curbPath(net, s.w, s.s, 600, null, out, end);
  if (n > longest) {
    longest = n;
    start = { s, fx, fz };
  }
}
const lane = new Float32Array(4 * 800), laneN = curbPath(net, start.s.w, start.s.s, 3000, null, lane, end);
const laneAt = (d) => {
  let i = 0, acc = 0;
  while (i < laneN - 2) {
    const sl = Math.hypot(lane[i * 4 + 4] - lane[i * 4], lane[i * 4 + 6] - lane[i * 4 + 2]);
    if (acc + sl > d) break;
    acc += sl;
    i++;
  }
  const sl = Math.hypot(lane[i * 4 + 4] - lane[i * 4], lane[i * 4 + 6] - lane[i * 4 + 2]) || 1, f = Math.min(1, (d - acc) / sl);
  return { x: lane[i * 4] + (lane[i * 4 + 4] - lane[i * 4]) * f, z: lane[i * 4 + 2] + (lane[i * 4 + 6] - lane[i * 4 + 2]) * f, ux: (lane[i * 4 + 4] - lane[i * 4]) / sl, uz: (lane[i * 4 + 6] - lane[i * 4 + 2]) / sl };
};
const nearLane = (x, z) => {
  let d = Infinity;
  for (let i = 0; i < laneN - 1; i++) {
    const ax = lane[i * 4], az = lane[i * 4 + 2], bx = lane[i * 4 + 4], bz = lane[i * 4 + 6], L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1, t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2));
    d = Math.min(d, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
  }
  return d;
};
const buf = new ArrayBuffer(SNAP_BYTES), snap = view(buf), keys = new Map(), carKey = 'car:curb:test', ch = fnv1a(carKey);
keys.set(ch, carKey);
let carD = 40;
const setCar = () => {
  const p = laneAt(carD), o = 0;
  snap.rowsU32[o + Col.KEY] = ch;
  snap.rows[o + Col.KIND] = Kind.CAR;
  // (one lane over from the kerb's, as the car beside the bus would be)
  snap.rows[o + Col.X] = p.x + p.uz * curbTune.out;
  snap.rows[o + Col.Z] = p.z - p.ux * curbTune.out;
  snap.rows[o + Col.VX] = p.ux * 10;
  snap.rows[o + Col.VZ] = p.uz * 10;
  snap.u32[2] = 1;
};
writeKey(snap, 0, ch, carKey);
const c = new Curb(worker), pose = { x: 0, y: 0, z: 0, heading: 0, speed: 0 }, painted = [];
c.onBeside = (k) => painted.push(k);
const h0 = Math.atan2(start.fx, -start.fz);
c.land(start.s.x, start.s.z, h0);
const flush = () => { while (answers.length) c.answer(answers.shift()); };
const flush2 = (x) => { while (answers.length) x.answer(answers.shift()); };
flush();
let worstOff = 0, besideAt = null, rolled = 0, nearest = Infinity;
const dt = 1 / 30;
for (let k = 0; k < 30 * 12; k++) {
  carD += 10 * dt;
  setCar();
  c.roll(dt, 0, 0, snap, 0, keys, pose);
  flush();
  if (k > 30) worstOff = Math.max(worstOff, nearLane(pose.x, pose.z));
  // (the bus 18 m long, a sedan 7.4 m at its scale: alongside, how far apart their middles are across the lane)
  const p = laneAt(carD), cx = snap.rows[Col.X], cz = snap.rows[Col.Z], al = (cx - pose.x) * p.ux + (cz - pose.z) * p.uz;
  // (on the straight: at a bend the test's car, set a lane over from each 4 m step, jumps across where a real car turns with its lane)
  const pa = laneAt(carD - 10), pb = laneAt(carD + 10);
  if (Math.abs(al) < 12 && pa.ux * pb.ux + pa.uz * pb.uz > 0.985) {
    const across = Math.abs(-(cx - pose.x) * p.uz + (cz - pose.z) * p.ux);
    if (process.env.CURB_DEBUG && across < 3) console.log('near', k, across.toFixed(2), al.toFixed(1), carD.toFixed(0));
    nearest = Math.min(nearest, across);
  }
  if (painted.length && besideAt === null) besideAt = k * dt;
  if (process.env.CURB_DEBUG && k % 15 === 0) console.log('t', (k * dt).toFixed(1), 'speed', pose.speed.toFixed(1), 'along', c.qa.along.toFixed(1), 'side', c.qa.side.toFixed(1), 'beside', c.beside);
}
const paced = { speed: +pose.speed.toFixed(1), beside: c.beside, besideFor: +c.besideFor.toFixed(1) };
row('roll: landed, on its line all along, pulled up beside the kerb lane\'s car a lane over and paced it, painted it after 1.5 s beside it', c.state === 'on' && worstOff < 1 && Math.abs(pose.speed - 10) < 2 && painted[0] === carKey && besideAt !== null && nearest > 3,
  { state: c.state, worstOffLaneM: +worstOff.toFixed(2), acrossM: +nearest.toFixed(2), ...paced, besideAt: c.besideAt && 'set', paintedAtS: besideAt && +besideAt.toFixed(1) });
// (a car on the bus's own line, as no car drives, is never paced: nothing closes on a car in its way)
{
  const e = new Curb(worker), q = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
  e.land(start.s.x, start.s.z, h0);
  flush2(e);
  let d0 = 30, closed = 0;
  for (let k = 0; k < 30 * 8; k++) {
    d0 += 10 * dt;
    const p = laneAt(d0);
    snap.rows[Col.X] = p.x;
    snap.rows[Col.Z] = p.z;
    snap.rows[Col.VX] = p.ux * 10;
    snap.rows[Col.VZ] = p.uz * 10;
    snap.u32[2] = 1;
    e.roll(dt, 0, 0, snap, 0, keys, q);
    flush2(e);
    if (e.beside) closed++;
  }
  row('own line: a car standing on the bus\'s own line is never paced', closed === 0, { closed });
}
// (the thumb pushed: it rolls on past the car)
for (let k = 0; k < 30 * 6; k++) {
  carD += 10 * dt;
  setCar();
  c.roll(dt, 1, 0, snap, 0, keys, pose);
  flush();
}
const ahead = (() => { const p = laneAt(carD); return (pose.x - p.x) * p.ux + (pose.z - p.z) * p.uz; })();
row('push: the thumb pushed rolls on past the car beside it', ahead > 5 && c.beside === null, { aheadOfCarM: +ahead.toFixed(1), speed: +pose.speed.toFixed(1) });
// (a long roll with nothing to pace: the lane goes on stretch after stretch, asked for by place)
snap.u32[2] = 0;
let x0 = pose.x, z0 = pose.z;
for (let k = 0; k < 30 * 90; k++) {
  c.roll(dt, 0, 0, null, 0, keys, pose);
  flush();
  rolled += Math.hypot(pose.x - x0, pose.z - z0);
  x0 = pose.x;
  z0 = pose.z;
}
row('long: 90 s on, the lane went on stretch after stretch past its first 600 m, or slowed to a stop at a dead end', c.state === 'on' && (rolled > 700 || pose.speed < 0.5), { rolledM: Math.round(rolled), speed: +pose.speed.toFixed(1) });
// ---- speed: landed at 20 m/s, it rolls on from that (H1) ----
{
  const e = new Curb(worker), q = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
  e.land(start.s.x, start.s.z, h0, 20);
  flush2(e);
  e.roll(dt, 0, 0, null, 0, keys, q);
  flush2(e);
  const first = q.speed;
  for (let k = 0; k < 30 * 4; k++) {
    e.roll(dt, 0, 0, null, 0, keys, q);
    flush2(e);
  }
  row('speed: landed with the bus\'s 20 m/s it rolls on from it, easing to the road\'s pace', first > 18 && q.speed < first - 3, { first: +first.toFixed(1), after4s: +q.speed.toFixed(1) });
}
// ---- turn: a look held right from the landing takes the first junction ahead that has a way to the right (M12) ----
{
  let tried = 0, turned = 0, firstAt = [];
  const S = new Float32Array(4 * 200), R = new Float32Array(4 * 200), js = new Int32Array(64), e0 = { w: 0, s: 0, dead: false, nj: 0 };
  for (const { s, fx, fz } of spots) {
    if (tried >= 60) break;
    const nS = curbPath(net, s.w, s.s, 400, null, S, e0, js);
    if (!e0.nj || js[0] * 4 > 200 || js[0] < 6) continue;
    // (the look right of the way in to the first junction: where the two lines part, and 40 m past the junction on the right's)
    const J = js[0], ax = S[(J - 1) * 4] - S[(J - 3) * 4], az = S[(J - 1) * 4 + 2] - S[(J - 3) * 4 + 2], al = Math.hypot(ax, az) || 1;
    const nR = curbPath(net, s.w, s.s, 400, [-az / al, ax / al], R, { w: 0, s: 0, dead: false, nj: 0 });
    const k = Math.min(J + 10, nR - 1, nS - 1);
    if (k <= J + 4 || Math.hypot(R[k * 4] - S[k * 4], R[k * 4 + 2] - S[k * 4 + 2]) < 15) continue;
    tried++;
    const e = new Curb(worker), q = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
    e.land(s.x, s.z, Math.atan2(fx, -fz));
    flush2(e);
    let best = Infinity;
    for (let f = 0; f < 30 * 40; f++) {
      if (!e.roll(dt, 0, Math.PI / 2, null, 0, keys, q)) break;
      flush2(e);
      best = Math.min(best, Math.hypot(q.x - R[k * 4], q.z - R[k * 4 + 2]));
      if (best < 2) break;
    }
    if (best < 3) turned++;
    firstAt.push(J * 4);
  }
  row('turn: a look held right takes the first junction ahead with a way right, not one 220 to 600 m on', tried >= 20 && turned / tried >= 0.9, { tried, turned, firstJunctionM: Math.round(firstAt.reduce((a, b) => a + b, 0) / Math.max(1, firstAt.length)) });
}
// ---- dead: at a dead end, braking to a stop at the kerb and asking no more (M13) ----
{
  let tried = 0, stopped = 0, worstBrake = 0, worstAsks = 0, worstShort = 0, worstOver = 0;
  const S = new Float32Array(4 * 200), e0 = { w: 0, s: 0, dead: false, nj: 0 };
  for (const { s, fx, fz } of spots) {
    if (tried >= 12) break;
    const nS = curbPath(net, s.w, s.s, 600, null, S, e0);
    if (!e0.dead || nS * 4 > 400 || nS < 15) continue;
    tried++;
    const e = new Curb(worker), q = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
    e.land(s.x, s.z, Math.atan2(fx, -fz));
    flush2(e);
    let v0 = NaN, asksAtEnd = -1;
    for (let f = 0; f < 30 * 120; f++) {
      e.roll(dt, 0, 0, null, 0, keys, q);
      flush2(e);
      if (v0 >= 1) worstBrake = Math.max(worstBrake, (v0 - q.speed) / dt);
      v0 = q.speed;
      if (q.speed < 0.05) {
        if (asksAtEnd < 0) asksAtEnd = e.qa.asks;
        if (f % 30 === 0 && e.qa.asks > asksAtEnd) break;
      }
      if (q.speed < 0.05 && f > 60 && asksAtEnd >= 0 && e.qa.asks === asksAtEnd && f % 90 === 0) break;
    }
    const lx = S[(nS - 1) * 4], lz = S[(nS - 1) * 4 + 2], short = Math.hypot(q.x - lx, q.z - lz);
    if (q.speed < 0.05) stopped++;
    worstShort = Math.max(worstShort, short);
    worstAsks = Math.max(worstAsks, e.qa.asks);
    worstOver = Math.max(worstOver, e.qa.asks - asksAtEnd);
  }
  row('dead: at a dead end it brakes to a stop by the line\'s end, never harder than curbHost.brake, and stops asking', tried >= 3 && stopped === tried && worstBrake <= 3.3 && worstShort < 8 && worstOver === 0 && worstAsks <= 3,
    { tried, stopped, worstBrakeMs2: +worstBrake.toFixed(2), worstShortM: +worstShort.toFixed(1), worstAsks, asksAfterStop: worstOver });
}
// ---- traffic: the real cars at Thursday 17:30, 25 landings of 20 s each: the bus never inside a vehicle, and what it paints never in its own way (B2) ----
{
  const { carsOn } = await import('../../src/life/sim/cars.ts');
  const { MAX_ROWS } = await import('../../src/life/snapshot.ts');
  const utc = Date.parse('2026-11-06T01:30:00Z'), tz = -480, step = 1 / 15, LEN = [5.7, 6.2, 6.4], TLEN = [13.8, 10.2, 23.8];
  const bit = (b) => (b & 4 ? 2 : b & 2 ? 1 : 0);
  let frames = 0, inside = 0, insideWith = 0, paints = 0, ownLane = 0, landed = 0, besideF = 0;
  const hits = [];
  const kk = new Map();
  for (let L = 0; L < spots.length && landed < 25; L += Math.floor(spots.length / 30)) {
    const { s, fx, fz } = spots[L], e = new Curb(worker), q = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
    e.land(s.x, s.z, Math.atan2(fx, -fz));
    flush2(e);
    if (e.state !== 'on') continue;
    landed++;
    let paintedNow = null;
    e.onBeside = (k) => (paintedNow = k);
    for (let f = 0; f < 20 / step; f++) {
      const t = utc + (L * 37 + f * step) * 1000;
      const n = carsOn(net, t, tz, q.x || s.x, q.z || s.z, 700, 1200, 1, snap.rows, 0, MAX_ROWS, (h, k) => kk.set(h, k));
      snap.u32[2] = n;
      if (!e.roll(step, 0, 0, snap, 0, kk, q)) break;
      flush2(e);
      frames++;
      if (e.beside) besideF++;
      // (the bus a box 18 m by 4 m, each vehicle three discs down its length, its half width round)
      const hx = Math.sin(q.heading), hz = -Math.cos(q.heading);
      let hit = false, hitWith = false;
      for (let r = 0; r < n; r++) {
        const o = r * ROW, kind = snap.rows[o + Col.KIND];
        if (kind !== Kind.CAR && kind !== Kind.TRUCK) continue;
        const cx = snap.rows[o + Col.X], cz = snap.rows[o + Col.Z];
        if (Math.abs(cx - q.x) > 30 || Math.abs(cz - q.z) > 30) continue;
        const vx = snap.rows[o + Col.VX], vz = snap.rows[o + Col.VZ], vl = Math.hypot(vx, vz) || 1, b = snap.rowsU32[o + Col.LOOK] ?? 0;
        const look = snap.rows[o + Col.LOOK] & 7, len = kind === Kind.TRUCK ? TLEN[bit(look)] : LEN[bit(look)], hw = kind === Kind.TRUCK ? 1.45 : 1.2;
        void b;
        for (const u of [-0.5 + hw / len, 0, 0.5 - hw / len]) {
          const px = cx + (vx / vl) * u * len - q.x, pz = cz + (vz / vl) * u * len - q.z, al = px * hx + pz * hz, ac = -px * hz + pz * hx;
          const dx = Math.max(0, Math.abs(al) - 9), dz = Math.max(0, Math.abs(ac) - 2);
          if (Math.hypot(dx, dz) < hw) {
            hit = true;
            if ((vx * hx + vz * hz) / vl > 0.7) hitWith = true;
            if (process.env.CURB_DEBUG) hits.push([Math.round(ac * 10) / 10, Math.round(al), Math.round(((vx * hx + vz * hz) / vl) * 10) / 10, kind === Kind.TRUCK ? 'T' : 'C']);
          }
        }
      }
      if (hit) inside++;
      if (hitWith) insideWith++;
      if (paintedNow) {
        paints++;
        if (e.besideAt) {
          const ac = Math.abs(-(e.besideAt.x - q.x) * hz + (e.besideAt.z - q.z) * hx);
          if (ac < 2) ownLane++;
        }
        paintedNow = null;
      }
    }
  }
  if (process.env.CURB_DEBUG) {
    const by = {};
    for (const [ac, al, dir, k] of hits) {
      const key = `${dir > 0.7 ? 'with' : dir < -0.7 ? 'against' : 'across'} ac${Math.floor(Math.abs(ac))} ${k}`;
      by[key] = (by[key] ?? 0) + 1;
    }
    console.log(by);
  }
  // (the review's 51 % of frames, 24 of 26 cars painted in the bus's own lane. What's left is mostly at junctions: a car crossing the bus's way, as life's own cars
  // cross each other there, and a truck turning in across the kerb)
  row('traffic: real cars at Thursday 17:30, 25 landings: the bus inside one going its way under 1 % of frames, any under 2 %, never painting one in its way', landed >= 20 && insideWith / frames < 0.01 && inside / frames < 0.02 && ownLane === 0 && paints > 3,
    { landed, frames, insideWithShare: +(insideWith / frames).toFixed(4), insideShare: +(inside / frames).toFixed(4), besideShare: +(besideF / frames).toFixed(2), paints, ownLane });
}
// (no street: out over the bay)
const d = new Curb(worker);
d.land(BX + 6000, BZ - 6000, 0);
while (answers.length) d.answer(answers.shift());
row('none: over open water, no lane: FIND A STREET', d.state === 'none', { state: d.state });
process.exit(bad ? 1 : 0);
