#!/usr/bin/env node
// L4 (CONTRACT.md section 7): life's frame makes nothing. node --expose-gc --no-warnings tools/life/alloc.mjs
//   street   frame() 10,000 times after a warm-up of 30,000, on the sky over the city with every plane painted, so models, specks and contrails are all drawn
//   flight   frameSky() the same, the bus 40 km over the city
//   aim      aim() 10,000 times, along a line through the sky
//   people   frame() low over a street's ground, once its tiles round the bus are sampled (two arrays a tile, as it comes near)
//   dance    frame() the same with the worker's people on those tiles in the snapshot, every one painted, so they stop and dance
//   cars     frame() low over a grid of streets at night with the worker's cars on them, every one painted: they bounce, lay their tyre tracks and show their lights
//   each     what the heap grows by over the 10,000 calls, after a collection: under 64 KB (the contract's bar). Printed beside it, what they made before one: in V8 a
//            double stored in an object's field, or passed to a call it doesn't inline, is boxed, 16 bytes dropped at once (measured: six doubles to a call not inlined,
//            96 bytes; six small integers, none), which JavaScriptCore never makes, keeping a double in the value itself
//   message  what a snapshot's arrival makes, for L2: its views over the new buffer, CONTRACT.md section 2 (printed, not barred: a transfer can't arrive as nothing)
// The host as the page has it, on three.js with no GL: the worker a stand-in that keeps its ticks, the store one that keeps nothing. Exit 1 if any fails.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const THREE = await import('three');
const { LifeHost } = await import('../../src/life/Life.ts');
const { Pools } = await import('../../src/life/pools.ts');
const { scriptedPlanes } = await import('../../src/life/sim/planes.ts');
const { MAX_ROWS, SNAP_BYTES, view, writeKey } = await import('../../src/life/snapshot.ts');
const { fnv1a } = await import('../../src/life/hash.ts');
const { axesAt, geodeticToFix } = await import('../../src/sky/WorldFrame.ts');

if (typeof gc !== 'function') {
  console.log('run with --expose-gc');
  process.exit(2);
}
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const ORIGIN = [37.7749, -122.4194], T0 = Date.parse('2026-11-05T17:30:00Z'), N = 10000, LIMIT = 64 * 1024;
// (the worker's tick, as lifeWorker.ts makes it: the sky over the map round the bus, its keys after the rows)
const snapshot = (buf, utcMs, bx, bz) => {
  const v = view(buf);
  let keyAt = 0;
  const n = scriptedPlanes('sf', utcMs, bx, bz, 150000, v.rows, 0, MAX_ROWS, (h, k) => {
    const next = writeKey(v, keyAt, h, k);
    if (next >= 0) keyAt = next;
  });
  v.u32[3] = keyAt;
  v.f64[0] = utcMs;
  v.u32[2] = n;
  return n;
};
// (the worker keeps what it's sent: the host's two buffers go out with its first two ticks, and it sends no more till one is back)
const worker = { postMessage: () => {}, onmessage: null };
const store = { put() {}, clear() {}, load: async () => [] };
const scene = new THREE.Scene(), pools = new Pools();
scene.add(pools.group);
const host = new LifeHost(worker, pools, store, 'sf', ORIGIN);
const arrive = (buf) => worker.onmessage({ data: { type: 'snap', buf } });
const first = new ArrayBuffer(SNAP_BYTES), planes = snapshot(first, T0, 0, 0);
arrive(first);
// (every plane painted, landed on the first frame)
for (const key of host.keys.values()) host.hit(key, fnv1a(key) % 6, T0, 0);
const camera = new THREE.PerspectiveCamera(24, 393 / 852, 1.5, 30000);
camera.position.set(0, 900, 0);
camera.lookAt(0, 9000, -20000);
camera.updateMatrixWorld();
const bus = { x: 0, y: 880, z: 0 };
let utc = T0, sim = 1;
const street = () => {
  utc += 16;
  sim += 1 / 60;
  host.frame(1 / 60, sim, utc, bus, camera);
};
// (the flight's: the bus 40 km over the city, the render axes the map's there, Earth fixed)
const skyScene = new THREE.Scene(), skyCam = new THREE.PerspectiveCamera(24, 393 / 852, 1.5, 30000);
skyCam.position.set(0, 120, 250);
skyCam.updateMatrixWorld();
const ob = { body: 0, free: false, pos: geodeticToFix(ORIGIN[0], ORIGIN[1], 40, new Float64Array(3)), axes: axesAt(ORIGIN[0], ORIGIN[1], 0, new Float64Array(9)) };
const flight = () => {
  utc += 16;
  host.frameSky(1 / 60, utc, ob);
};
// (a line from the bus to where the first plane is now)
let aimed = 0;
const aim = () => {
  const s = host.snap, r = s.rows, dt = (host.utc - s.f64[0]) / 1000, x = r[2] + r[5] * dt, y = r[3] + r[6] * dt, z = r[4] + r[7] * dt;
  if (host.aim(bus.x, bus.y, bus.z, x - bus.x, y - bus.y, z - bus.z, 30, 2)) aimed++;
};
// (a long warm-up first: what the JIT keeps of its own while it optimises isn't life's)
// (a host with the street's ground behind it, a sidewalk every 32 m, the bus low over it: people sampled, sent and drawn)
const { Ground } = await import('../../src/world/tiles.ts');
const world = { tileSize: 256, groundAt: () => 4, groundClassAt: (x, z) => (Math.floor(x / 4) % 8 === 0 || Math.floor(z / 4) % 8 === 0 ? Ground.SIDEWALK : Ground.PAVED) };
const walkTiles = [], walkWorker = { postMessage: (m) => m?.type === 'walk' && m.tile && walkTiles.push(m.tile), onmessage: null }, walkPools = new Pools(), walkScene = new THREE.Scene();
walkScene.add(walkPools.group);
const walkHost = new LifeHost(walkWorker, walkPools, store, 'sf', ORIGIN, world);
let wutc = T0, wsim = 1;
const low = { x: 100, y: 40, z: 100 };
const people = () => {
  wutc += 16;
  wsim += 1 / 60;
  walkHost.frame(1 / 60, wsim, wutc, low, camera);
};
const measure = (name, fn, check, h = host) => {
  for (let i = 0; i < 30000; i++) fn();
  gc();
  gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < N; i++) fn();
  const made = process.memoryUsage().heapUsed - h0;
  gc();
  gc();
  const kept = process.memoryUsage().heapUsed - h0;
  const q = { ...h.qa };
  row(`${name}: 10,000 calls grow the heap by under 64 KB`, kept < LIMIT && check(q), { keptKB: +(kept / 1024).toFixed(1), madeKB: +(made / 1024).toFixed(1), rows: q.rows, models: q.models, specks: q.specks, marks: q.marks });
};
measure('street', street, (q) => q.rows > 0 && q.specks + q.models > 0 && q.marks > 0);
host.attachSky(skyScene, skyCam);
measure('flight', flight, (q) => q.rows > 0 && q.sky && q.specks + q.models > 0 && q.marks > 0);
measure('aim', aim, () => aimed > 0);
// (its tiles sampled in the warm-up, two arrays each, as a tile comes near: after that a frame keeps nothing)
measure('people', people, () => walkHost.walked.size > 0, walkHost);
{
  // (the worker's tick for people as lifeWorker.ts makes it, from the tiles the host sent, every one of them painted, and a lens low over them: each frame they dance)
  const { peopleOn } = await import('../../src/life/sim/people.ts');
  const buf = new ArrayBuffer(SNAP_BYTES), v = view(buf), day = Math.floor(wutc / 86400000);
  let keyAt = 0, n = 0;
  for (const t of walkTiles) n = peopleOn(t, day, wutc, low.x, low.z, 800, v.rows, n, MAX_ROWS, (h, k) => {
    const next = writeKey(v, keyAt, h, k);
    if (next >= 0) keyAt = next;
  });
  v.u32[3] = keyAt;
  v.f64[0] = wutc;
  v.u32[2] = n;
  walkWorker.onmessage({ data: { type: 'snap', buf } });
  for (const key of walkHost.keys.values()) walkHost.hit(key, fnv1a(key) % 6, wutc, 0);
  const lowCam = new THREE.PerspectiveCamera(24, 393 / 852, 1.5, 30000);
  lowCam.position.set(low.x, low.y + 20, low.z + 60);
  lowCam.lookAt(low.x, 4, low.z);
  lowCam.updateMatrixWorld();
  const dance = () => {
    wutc += 16;
    wsim += 1 / 60;
    walkHost.frame(1 / 60, wsim, wutc, low, lowCam);
  };
  measure('dance', dance, () => walkHost.qa.dancers > 20, walkHost);
  console.log(`      dance: ${n} people in the snapshot, every one painted, ${walkHost.qa.dancers} of them near enough to be drawn dancing`);
}
{
  // (cars, as lifeWorker.ts fills them, on a grid of two-way secondary streets 80 m apart round the bus, a graph shaped as lifeData.ts gives one; every car painted, the
  // windows lit, a lens low over them. The clock swings 3 s either side of the snapshot's, so they drive on and back and their tracks keep growing)
  const { buildNet, carsOn } = await import('../../src/life/sim/cars.ts');
  const { heldGlobals } = await import('../../src/render/materials.ts');
  const K = 12, S = 80, nn = K * K, ids = new Uint32Array(nn), xyz = new Float32Array(nn * 3), A = [], B = [];
  for (let j = 0; j < K; j++)
    for (let i = 0; i < K; i++) {
      const q = j * K + i;
      ids[q] = 1000 + q;
      xyz.set([100 + (i - K / 2) * S, 4, 100 + (j - K / 2) * S], q * 3);
      if (i + 1 < K) A.push(q), B.push(q + 1);
      if (j + 1 < K) A.push(q), B.push(q + K);
    }
  const ne = A.length, z8 = () => new Uint8Array(ne);
  const graph = {
    version: 1, minor: 2, rx: 0, rz: 0, names: [], pts: new Float32Array(0),
    nodes: { n: nn, id: ids, xyz, flags: new Uint8Array(nn) },
    edges: { n: ne, id: Uint32Array.from(A, (_, e) => 5000 + e), a: Uint32Array.from(A), b: Uint32Array.from(B), kind: z8().fill(1), cls: z8().fill(4), dir: z8(), lanes: z8(), speed: z8(), level: new Int8Array(ne), flags: new Uint16Array(ne), shape: new Uint32Array(ne + 1) },
    areas: { n: 0, id: new Uint32Array(0), kind: new Uint8Array(0), name: new Uint16Array(0), tri: new Uint32Array(1), xyz: new Float32Array(0) },
  };
  const net = buildNet([graph]), carWorker = { postMessage: () => {}, onmessage: null }, carPools = new Pools(), carScene = new THREE.Scene();
  carScene.add(carPools.group);
  const carHost = new LifeHost(carWorker, carPools, store, 'sf', ORIGIN);
  const buf = new ArrayBuffer(SNAP_BYTES), v = view(buf), T = T0 + 600000;
  let keyAt = 0;
  const n = carsOn(net, T, -480, 100, 100, 700, 1200, 1, v.rows, 0, MAX_ROWS, (h, k) => {
    const next = writeKey(v, keyAt, h, k);
    if (next >= 0) keyAt = next;
  });
  v.u32[3] = keyAt;
  v.f64[0] = T;
  v.u32[2] = n;
  carWorker.onmessage({ data: { type: 'snap', buf } });
  for (const key of carHost.keys.values()) carHost.hit(key, fnv1a(key) % 6, T, 0);
  const lowCam = new THREE.PerspectiveCamera(24, 393 / 852, 1.5, 30000);
  lowCam.position.set(100, 60, 220);
  lowCam.lookAt(100, 4, 100);
  lowCam.updateMatrixWorld();
  heldGlobals.uLit.value = 1;
  let i = 0, csim = 1;
  const drive = () => {
    csim += 1 / 60;
    carHost.frame(1 / 60, csim, T + 3000 * Math.sin(++i / 200), { x: 100, y: 40, z: 100 }, lowCam);
  };
  measure('cars', drive, (q) => q.bouncers > 20 && q.tracks > 20 && q.lights > 0, carHost);
  heldGlobals.uLit.value = 0;
  console.log(`      cars: ${n} in the snapshot, every one painted; ${carHost.qa.bouncers} drawn bouncing, ${carHost.qa.tracks} laying tracks, ${carHost.qa.lights} lit as specks`);
}
{
  // (a snapshot's arrival: a fresh buffer each, as a transfer gives, its keys known already)
  const bufs = Array.from({ length: 200 }, () => {
    const b = new ArrayBuffer(SNAP_BYTES);
    snapshot(b, utc, 0, 0);
    return b;
  });
  gc();
  gc();
  const h0 = process.memoryUsage().heapUsed;
  for (const b of bufs) arrive(b);
  const per = (process.memoryUsage().heapUsed - h0) / bufs.length;
  console.log(`      message: a snapshot's arrival makes ${Math.round(per)} bytes (its views over the new buffer), at 10 Hz ${((per * 10) / 1024).toFixed(1)} KB/s; ${planes} planes`);
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
