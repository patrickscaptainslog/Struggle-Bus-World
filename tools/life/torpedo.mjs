#!/usr/bin/env node
// The Torpedo and an aimed hit's show (SHOTS.md, "The shots" and "Lock-on"; src/life/Torpedo.ts, Life.ts's trail and tracks), in Node on a hand-made snapshot and a
// stand-in for main.ts's host (water everywhere but the strips in LAND, the bus at (0, 60, 0)): node --no-warnings tools/life/torpedo.mjs
//   run      a breath down on water 200 m from a ferry runs at it at 130 m/s, spray at its head, its wake in the marks, and paints it in the player's colours
//   far      a sailboat 350 m off isn't run at: two skips on the way it was thrown, 70 m then 45 m, and a splash
//   shore    a boat behind land isn't picked; a hop is cut short at the shore, and the next isn't flown under 8 m
//   pier     a ferry at its pier, land within 60 m of it, is picked and hit
//   car      a car isn't a boat
//   gap      two in one frame: the second refused; a fifth with four out: refused; every slot free again after
//   aground  land come between it and its boat ends it there, a fizz
//   wake     a hit ferry's wake is twice as wide and the one colour for 30 s, then the usual
//   ribbon   a plane's locked hit: a ribbon as long as it has flown since and 60 m wide for a minute, easing back to the 40 s contrail 8 m wide
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const THREE = await import('three');
const { LifeHost } = await import('../../src/life/Life.ts');
const { Pools, MARK_POINTS } = await import('../../src/life/pools.ts');
const { SNAP_BYTES, view, writeKey } = await import('../../src/life/snapshot.ts');
const { fnv1a } = await import('../../src/life/hash.ts');
const { Col, Kind, ROW } = await import('../../src/life/kinds.ts');
const { torpedoTune } = await import('../../src/life/Torpedo.ts');
const { globals } = await import('../../src/render/materials.ts');

let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const T0 = Date.parse('2026-11-07T22:00:00Z');
// (the movers: key, kind, where, velocity; each row's own stretch of water, 2 km from the next)
const MOVERS = [
  ['ferry:a', Kind.FERRY, 0, 0, -200, 5, 0],
  ['sail:b', Kind.SAILBOAT, 2000, 0, 0, 0, 0],
  ['sail:c', Kind.SAILBOAT, 4000, 0, 0, 0, 0],
  ['ferry:pier', Kind.FERRY, 6000, 0, 0, 0, 0],
  ['car:x', Kind.CAR, 8000, 0, 0, 0, 0],
  ['ferry:slow', Kind.FERRY, 10290, 0, 0, 0, 0],
  ['plane:low', Kind.SMALL_PLANE, 0, 3000, -6000, 60, 0],
];
// (land: strips of x; the aground row adds one mid-run)
const LAND = [[3850, 3900], [5960, 6100]];
const W = 393, H = 852;
const snapshot = (buf) => {
  const v = view(buf), f = new Float32Array(buf, v.rows.byteOffset, v.rows.length), u = v.rowsU32;
  let keyAt = 0;
  MOVERS.forEach(([key, kind, x, y, z, vx, vz], i) => {
    const o = i * ROW, h = fnv1a(key);
    u[o + Col.KEY] = h;
    f[o + Col.KIND] = kind;
    f[o + Col.X] = x;
    f[o + Col.Y] = y;
    f[o + Col.Z] = z;
    f[o + Col.VX] = vx;
    f[o + Col.VZ] = vz;
    f[o + Col.SCALE] = 1;
    f[o + Col.UNTIL] = 3600;
    keyAt = writeKey(v, keyAt, h, key);
  });
  v.u32[3] = keyAt;
  v.f64[0] = T0;
  v.u32[2] = MOVERS.length;
};
const worker = { postMessage: () => {}, onmessage: null };
const store = { put() {}, clear() {}, load: async () => [] };
const pools = new Pools(), life = new LifeHost(worker, pools, store, 'sf', [37.7749, -122.4194]);
const buf = new ArrayBuffer(SNAP_BYTES);
snapshot(buf);
worker.onmessage({ data: { type: 'snap', buf } });
globals.uPixelAngle.value = 0.0005;
let sim = 1, utc = T0, dealt = 0;
const splashes = [], flings = [];
const r1 = (n) => Math.round(n * 10) / 10, r2 = (n) => Math.round(n * 100) / 100;
const torp = life.torpedoOn({
  faction: () => 3,
  dealHue: () => dealt++,
  bus: (out) => out.set(0, 60, 0),
  water: (x) => !LAND.some(([a, b]) => x >= a && x <= b),
  splash: (pos, hue, strength, _delay, count = -1) => splashes.push({ t: sim, x: pos.x, z: pos.z, hue, strength, count }),
  fling: (from, to, flight, hue, size) => flings.push({ t: sim, from: from.x, to: to.x, flight, hue, size }),
});
const camera = new THREE.PerspectiveCamera(24, W / H, 1.5, 30000);
// (the lens on the first ferry, from over the water south of it, until the ribbon's rows turn it to the plane)
const seen = new THREE.Vector3();
let watch = () => {
  life.moverAt('ferry:a', seen);
  camera.position.set(seen.x, 200, 300);
  camera.lookAt(seen.x, 0, -100);
  camera.updateMatrixWorld();
};
const step = (s, each) => {
  for (let k = 0; k < Math.round(s * 60); k++) {
    sim += 1 / 60;
    utc += 1000 / 60;
    watch();
    life.frame(1 / 60, sim, utc, { x: 0, y: 60, z: 0 }, camera);
    each?.();
  }
};
const fire = (x, hue = 4) => life.torpedo(new THREE.Vector3(x, 0.5, 0), hue);
const paintOf = (key) => life.painted.get(fnv1a(key));
/** Ribbon `r` of the marks: its middle line's length, its width at point `j`, and how many ramps it's drawn in. */
const ribbon = (r, j = 0) => {
  const K = pools.marks, mid = (i) => { const v = (r * MARK_POINTS + i) * 2 * 3; return [(K.pos[v] + K.pos[v + 3]) / 2, (K.pos[v + 1] + K.pos[v + 4]) / 2, (K.pos[v + 2] + K.pos[v + 5]) / 2]; };
  const a = mid(0), b = mid(MARK_POINTS - 1), v = (r * MARK_POINTS + j) * 2 * 3;
  const ramps = new Set();
  for (let i = 0; i < MARK_POINTS; i++) ramps.add(K.ramp[(r * MARK_POINTS + i) * 2]);
  return { length: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), width: Math.hypot(K.pos[v] - K.pos[v + 3], K.pos[v + 1] - K.pos[v + 4], K.pos[v + 2] - K.pos[v + 5]), ramps: ramps.size, head: a, tail: b };
};
step(0.2);
// ---- run ----
fire(0);
// (its wake is the one ribbon until the ferry has a wake of its own to show)
let wakeSeen = 0, wakeLen = 0, live = 0;
step(1.3, () => {
  wakeSeen = Math.max(wakeSeen, life.qa.marks);
  if (life.qa.marks === 1 && torp.runs.some((r) => r.live && r.done < 0)) wakeLen = Math.max(wakeLen, ribbon(0).length);
  live = Math.max(live, torp.qa.live);
});
step(0.7);
const hitAt = splashes.find((s) => s.strength === torpedoTune.hitSplash), spray = splashes.filter((s) => s.strength === torpedoTune.spray), fa = paintOf('ferry:a');
const ferryX = 5 * (hitAt ? (hitAt.t - 1) : 0), off = hitAt ? Math.hypot(hitAt.x - ferryX, hitAt.z + 200) : -1;
row('run: 200 m from a ferry it runs at it, spray at its head and a wake behind, and paints it in the player\'s colours',
  torp.qa.runs === 1 && torp.qa.hits === 1 && torp.qa.fresh === 1 && dealt === 1 && fa?.faction === 3 && fa?.hue === 4 && !!fa?.show && !!hitAt && hitAt.t - 1.2 > 1.2 && hitAt.t - 1.2 < 1.6 && off <= 20.5 && spray.length >= 15 && spray.every((s) => s.count === torpedoTune.sprayCount) && wakeSeen >= 1 && wakeLen > 150 && live === 1,
  { qa: { ...torp.qa }, dealt, painted: fa && { faction: fa.faction, hue: fa.hue, level: fa.level, show: !!fa.show }, hitS: hitAt && r2(hitAt.t - 1.2), offHull: r1(off), sprays: spray.length, wakeLen: r1(wakeLen) });
// ---- wake: the show ----
step(8);
const bold = ribbon(0);
// ---- far ----
splashes.length = flings.length = 0;
fire(1650);
step(1.2);
row('far: a sailboat 350 m off isn\'t run at: two skips on the way it was thrown, 70 m in 0.5 s and 45 m in 0.38 s, and the last splash',
  torp.qa.skips === 1 && torp.qa.hops === 2 && !paintOf('sail:b') && flings.length === 2 && r1(flings[0].to) === 1720 && r2(flings[0].flight) === 0.5 && r1(flings[1].to) === 1765 && r2(flings[1].flight) === 0.38 && flings[0].size === torpedoTune.blob && splashes.length === 2 && r1(splashes[0].x) === 1720 && splashes[0].strength === torpedoTune.skipSplash && r1(splashes[1].x) === 1765 && splashes[1].strength === torpedoTune.endSplash,
  { skips: torp.qa.skips, hops: torp.qa.hops, flings: flings.map((f) => [r1(f.from), r1(f.to), r2(f.flight)]), splashes: splashes.map((s) => [r1(s.x), s.strength]) });
// ---- shore ----
splashes.length = flings.length = 0;
fire(3800);
step(1.2);
row('shore: a boat behind land isn\'t picked; the hop is cut short at the shore (43.75 m), and the next (5.6 m) isn\'t flown',
  torp.qa.skips === 2 && torp.qa.hops === 3 && !paintOf('sail:c') && flings.length === 1 && r2(flings[0].to) === 3843.75 && r2(flings[0].flight) === r2(0.5 * Math.sqrt(5 / 8)) && splashes.length === 1 && r2(splashes[0].x) === 3843.75 && splashes[0].strength === torpedoTune.endSplash,
  { skips: torp.qa.skips, hops: torp.qa.hops, flings: flings.map((f) => [r2(f.from), r2(f.to), r2(f.flight)]), splashes: splashes.map((s) => [r2(s.x), s.strength]) });
// ---- pier ----
fire(5800);
step(4);
const fp = paintOf('ferry:pier');
row('pier: a ferry at its pier, land within 60 m of it, is picked and hit, not run aground', torp.qa.runs === 2 && torp.qa.hits === 2 && torp.qa.aground === 0 && fp?.faction === 3, { runs: torp.qa.runs, hits: torp.qa.hits, aground: torp.qa.aground, painted: !!fp });
// ---- car ----
fire(7900);
step(1.2);
row('car: a car isn\'t a boat: it skips', torp.qa.skips === 3 && torp.qa.runs === 2 && !paintOf('car:x'), { skips: torp.qa.skips, runs: torp.qa.runs });
// ---- gap and cap ----
const refused0 = torp.qa.refused;
fire(20000);
fire(20000);
const gap = torp.qa.refused - refused0;
step(1.5);
const runs0 = torp.qa.runs;
let most = 0;
for (let k = 0; k < 5; k++) {
  fire(10000);
  step(0.4, () => (most = Math.max(most, torp.qa.live)));
}
const cap = torp.qa.refused - refused0 - gap, ran = torp.qa.runs - runs0;
step(6);
row('gap: two in one frame, the second refused; a fifth with four out refused; every slot free again 6 s on', gap === 1 && ran === 4 && cap === 1 && most === 4 && torp.qa.live === 0 && torp.runs.every((r) => !r.live),
  { gap, ran, cap, most, liveAfter: torp.qa.live, hits: torp.qa.hits });
// ---- aground ----
splashes.length = 0;
fire(10000);
step(0.3);
LAND.push([10100, 10150]);
step(3);
LAND.pop();
const fizz = splashes.find((s) => s.strength === torpedoTune.fizz);
row('aground: land come between it and its boat ends it there, a fizz', torp.qa.aground === 1 && !!fizz && fizz.x >= 10100 && fizz.x <= 10110, { aground: torp.qa.aground, fizzAt: fizz && r1(fizz.x), lost: torp.qa.lost });
// ---- wake: back to the usual ----
step(6);
const plain = ribbon(0), since = (utc - fa.show) / 1000;
row('wake: a hit ferry\'s wake is twice as wide (24 m at the stern) and the one colour for 30 s, then 12 m in every hue',
  r1(bold.width) === 24 && bold.ramps === 1 && since > 30 && r1(plain.width) === 12 && plain.ramps > 1, { shown: { width: r1(bold.width), ramps: bold.ramps }, sinceS: r1(since), after: { width: r1(plain.width), ramps: plain.ramps } });
// ---- ribbon ----
// (the lens on the plane, from the bus, a fifth of the px an m so the widths read are the ribbon's own m, not its least px)
globals.uPixelAngle.value = 0.0001;
watch = () => {
  life.moverAt('plane:low', seen);
  camera.position.set(0, 60, 0);
  camera.lookAt(seen);
  camera.updateMatrixWorld();
};
step(0.1);
const fresh = life.lockHit('plane:low', 2, 3);
const read = (s) => {
  step(s);
  const r = ribbon(0, 3);
  return { marks: life.qa.marks, length: Math.round(r.length), width: r1(r.width), ramps: r.ramps };
};
const at30 = read(30), pp = paintOf('plane:low'), at50 = read(20), at56 = read(6), at70 = read(14);
row('ribbon: a plane\'s locked hit: 30 s on, 1,800 m long and 60 m wide in one colour; 50 s on, 3,000 m; easing at 56 s; the 40 s contrail 8 m wide past a minute',
  fresh && !!pp?.show && at30.marks === 1 && Math.abs(at30.length - 1800) < 8 && at30.width === 60 && at30.ramps === 1 && Math.abs(at50.length - 3000) < 8 && at50.width === 60 && Math.abs(at56.length - 2880) < 12 && at56.width > 30 && at56.width < 40 && Math.abs(at70.length - 2400) < 8 && at70.width === 8,
  { fresh, show: !!pp?.show, at30, at50, at56, at70 });
process.exit(bad ? 1 : 0);
