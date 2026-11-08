#!/usr/bin/env node
// A splat's blast paints every mover inside its circle (CONTRACT.md section 3; SHOTS.md: "the splat is 85 m across at roof height and paints every car, person,
// picnic and boat inside it, each tap still one level"), in Node on a hand-made snapshot round a blast on a roof 30 m up: node --no-warnings tools/life/blast.mjs
//   inside   cars, a truck, a picnic and a ferry inside the 85 m circle, down in the street and on the water under the roof, each painted at level 1 in the blast's
//            hue and its faction; a car just outside it, and a plane right over it 1.5 km up, not
//   once     a mover the same breath already hit (its hit pending at the blast's arrival) goes up one level, not two; a second blast a level more
//   moving   a car driving into the circle by the time the blast lands is painted; one driving out of it isn't
//   pour     a dozen blasts of one super (a Hose's pour) take a car one level, not twelve; the next pour another (the day review's m22)
//   ring     a ring's blast (Sonic Boom's, SuperTag.inner) paints the car under its band and leaves the one in its hole alone (HOOKS.md)
// The circle is the splat's own radius, 85 m (the review's n16: 42.5 was a quarter of it).
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const THREE = await import('three');
const { LifeHost } = await import('../../src/life/Life.ts');
const { Pools } = await import('../../src/life/pools.ts');
const { SNAP_BYTES, view, writeKey } = await import('../../src/life/snapshot.ts');
const { fnv1a } = await import('../../src/life/hash.ts');
const { Col, Kind, ROW } = await import('../../src/life/kinds.ts');

let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const T0 = Date.parse('2026-11-07T22:00:00Z');
// (the movers: key, kind, where, velocity)
const MOVERS = [
  ['car:in:street', Kind.CAR, 20, 0, 10, 0, 0],
  ['car:in:edge', Kind.CAR, 0, 0, -87, 0, 0],
  ['truck:in', Kind.TRUCK, -30, 0, 15, 0, 0],
  ['picnic:in', Kind.PICNIC, 10, 0, -25, 0, 0],
  ['ferry:in:0:20261107', Kind.FERRY, -20, -12, -20, 0, 0],
  ['car:out', Kind.CAR, 100, 0, 0, 0, 0],
  ['plane:over', Kind.AIRLINER, 0, 1500, 0, 0, 0],
  ['car:driving-in', Kind.CAR, 160, 0, 0, -50, 0],
  ['car:driving-out', Kind.CAR, 60, 0, 0, 25, 0],
  ['car:pour', Kind.CAR, 0, 0, -160, 0, 0],
  ['car:hole', Kind.CAR, 0, 0, 260, 0, 0],
  ['car:band', Kind.CAR, 75, 0, 260, 0, 0],
];
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
const pools = new Pools(), host = new LifeHost(worker, pools, store, 'sf', [37.7749, -122.4194]);
const buf = new ArrayBuffer(SNAP_BYTES);
snapshot(buf);
worker.onmessage({ data: { type: 'snap', buf } });
const camera = new THREE.PerspectiveCamera(24, 393 / 852, 1.5, 30000);
camera.position.set(0, 200, 300);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
let sim = 1, utc = T0;
const step = (s) => {
  for (let k = 0; k < Math.round(s * 60); k++) {
    sim += 1 / 60;
    utc += 1000 / 60;
    host.frame(1 / 60, sim, utc, { x: 0, y: 60, z: 0 }, camera);
  }
};
step(0.1);
const at = (key) => host.painted.get(fnv1a(key)) ?? null;
// (a breath at the car in the street, then its blast on the roof over it, 85 m round, landing together half a second on)
const arrive = sim + 0.5;
host.hit('car:in:street', 3, utc, arrive, 2);
host.blast(0, 30, 0, 85, 3, undefined, arrive, 2);
step(1);
const inside = ['car:in:street', 'car:in:edge', 'truck:in', 'picnic:in', 'ferry:in:0:20261107'].map((k) => ({ k, p: at(k) }));
const outside = ['car:out', 'plane:over'].map((k) => ({ k, p: at(k) }));
row('inside: every car, truck, picnic and ferry in the circle down to the street and the water, its hue and faction; outside and overhead, none',
  inside.every(({ p }) => p && p.level === 1 && p.hue === 3 && p.faction === 2) && outside.every(({ p }) => !p), { inside: inside.map(({ k, p }) => `${k}:${p ? p.level : '-'}`), outside: outside.map(({ k, p }) => `${k}:${p ? p.level : '-'}`) });
row('once: the car the breath hit and its blast took paint once, level 1', at('car:in:street')?.level === 1, at('car:in:street'));
host.blast(0, 30, 0, 85, 5, undefined, sim + 0.3, 5);
step(0.6);
row('once: a second blast takes everything inside a level more, keeping each one\'s hue, and its faction', at('truck:in')?.level === 2 && at('truck:in')?.hue === 3 && at('truck:in')?.faction === 5, at('truck:in'));
// (moving: this blast is let go now, inside the circle for the one car and outside for the other, and lands 2 s on, when the first has driven 50 m out of it
// and the second 100 m into it)
const lv = (k) => at(k)?.level ?? 0, before = { in: lv('car:driving-in'), out: lv('car:driving-out') };
host.blast(0, 30, 0, 85, 1, undefined, sim + 2, 1);
step(2.3);
const got = { in: lv('car:driving-in'), out: lv('car:driving-out') };
row('moving: a car driving into the circle by the blast\'s landing takes a level, one driving out of it doesn\'t', got.in === before.in + 1 && got.out === before.out, { before, after: got });
// (a pour: twelve 40 m blasts in a second, one super's, on the car off by itself; then another pour)
for (let k = 0; k < 12; k++) host.blast(0, 30, -160, 40, 2, { kind: 'hose', charge: 1, id: 7001 }, sim + 0.2 + k / 12, 1);
step(1.4);
const poured = lv('car:pour');
for (let k = 0; k < 12; k++) host.blast(0, 30, -160, 40, 2, { kind: 'hose', charge: 1, id: 7002 }, sim + 0.2 + k / 12, 1);
step(1.4);
row('pour: a dozen blasts of one pour take a car one level, the next pour one more', poured === 1 && lv('car:pour') === 2, { afterOne: poured, afterTwo: lv('car:pour') });
// (a ring 85 m round with its hole 64 m round: the car at its middle stays grey, the one under its band takes paint)
host.blast(0, 30, 260, 85, 4, { kind: 'boom', charge: 1, id: 7003, inner: 64 }, sim + 0.2, 1);
step(0.5);
row('ring: a ring\'s blast paints the car under its band and leaves the one in its hole alone', lv('car:band') === 1 && lv('car:hole') === 0, { band: lv('car:band'), hole: lv('car:hole') });
process.exit(bad ? 1 : 0);
