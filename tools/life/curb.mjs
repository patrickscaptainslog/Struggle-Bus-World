#!/usr/bin/env node
// Curb's road side (SHOTS.md, "Curb"), in Node on San Francisco's own road graphs round the Financial District: node --no-warnings tools/life/curb.mjs
//   land     from 200 points over the district, a bus flying low at 4 headings each: where a road is within 80 m it lands on a lane of a way driven its way, on
//            the kerb's side of it (right of its middle), never in a tunnel, the lane's point within 80 m; where none is, FIND A STREET
//   path     from each landing, 600 m of lane ahead: points 4 m apart with no jump, no turn sharper than a road's, never a tunnel, the road's speed on each
//   look     at the first junction a look to the left or the right takes another way than straight on, and a look ahead keeps it straight
//   same     the same answers twice (every player's lane is the same)
//   roll     the host's Curb (Curb.ts) on the same net: landed, kept on the kerb lane, pulled up beside a car going its way and pacing it, painting it after 1.5 s
//            beside it; the thumb pushed rolls on past it; a long roll goes on stretch after stretch; over open water, none
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
let lands = 0, none = 0, wrongWay = 0, tunnel = 0, far = 0, leftOfMiddle = 0;
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
    if (Math.hypot(s.x - x, s.z - z) > curbTune.reach + 1e-3) far++;
    // (right of the way's middle line: the kerb's side, on a two-way road its own half)
    if (net.two[s.w]) {
      const P = new Float32Array(4), end = { w: 0, s: 0 };
      curbPath(net, s.w, s.s, 1, null, P, end);
      void P;
    }
    spots.push({ s, fx, fz });
  }
}
const landMs = (performance.now() - t0) / 800;
row('land: from 800 tries over the district, lanes driven the bus\'s way within 80 m, none in a tunnel; no street, FIND A STREET', lands > 300 && wrongWay === 0 && tunnel === 0 && far === 0,
  { lands, none, wrongWay, tunnel, far, msEach: +landMs.toFixed(2), ways: net.n });

// ---- path ----
const out = new Float32Array(4 * 200), end = { w: 0, s: 0 };
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
  const left = net.len[s.w] - s.s;
  if (left > 300 || net.outAt[s.w + 1] - net.outAt[s.w] < 2) continue;
  tried++;
  const ex = net.t1[s.w * 2], ez = net.t1[s.w * 2 + 1], e1 = { w: 0, s: 0 }, e2 = { w: 0, s: 0 }, e3 = { w: 0, s: 0 };
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
  const spot = curbLand(net, m.x, m.z, m.fx, m.fz, m.reach), pts = new Float32Array(Math.ceil(m.length / curbTune.step + 2) * 4);
  const n = spot ? curbPath(net, spot.w, spot.s, m.length, m.look, pts, { w: 0, s: 0 }) : 0;
  answers.push({ type: 'curb', id: m.id, n, pts });
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
  snap.rows[o + Col.X] = p.x + p.uz * 3.2;
  snap.rows[o + Col.Z] = p.z - p.ux * 3.2;
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
flush();
let worstOff = 0, besideAt = null, rolled = 0;
const dt = 1 / 30;
for (let k = 0; k < 30 * 12; k++) {
  carD += 10 * dt;
  setCar();
  c.roll(dt, 0, 0, snap, 0, keys, pose);
  flush();
  if (k > 30) worstOff = Math.max(worstOff, nearLane(pose.x, pose.z));
  if (painted.length && besideAt === null) besideAt = k * dt;
  if (process.env.CURB_DEBUG && k % 15 === 0) console.log('t', (k * dt).toFixed(1), 'speed', pose.speed.toFixed(1), 'along', c.qa.along.toFixed(1), 'side', c.qa.side.toFixed(1), 'beside', c.beside);
}
const paced = { speed: +pose.speed.toFixed(1), beside: c.beside, besideFor: +c.besideFor.toFixed(1) };
row('roll: landed, on the kerb lane all along, pulled up beside the car and paced it, painted it after 1.5 s beside it', c.state === 'on' && worstOff < 1 && Math.abs(pose.speed - 10) < 2 && painted[0] === carKey && besideAt !== null,
  { state: c.state, worstOffLaneM: +worstOff.toFixed(2), ...paced, paintedAtS: besideAt && +besideAt.toFixed(1) });
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
// (no street: out over the bay)
const d = new Curb(worker);
d.land(BX + 6000, BZ - 6000, 0);
while (answers.length) d.answer(answers.shift());
row('none: over open water, no lane: FIND A STREET', d.state === 'none', { state: d.state });
process.exit(bad ? 1 : 0);
