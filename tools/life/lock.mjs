#!/usr/bin/env node
// Lock-on for boats and planes (SHOTS.md, "Lock-on"; src/life/Lock.ts), in Node on a hand-made snapshot and a stand-in for the shots' holds (src/game/Hold.ts:
// a flat screen over the map, the bus at its middle): node --no-warnings tools/life/lock.mjs
//   pick     a still hold on a ferry 1 km off takes the hold; on one 2 km off, a car or open sky it doesn't (the Hose has it); a plane 10 km off on the screen
//            does, a dot within 48 px of the finger
//   lock     the clack at 0.55 s and the target's glint; the lift fires a homing shot at it with the ferry's own velocity to lead by, the player's faction and hue; a hit paints
//            the ferry; a tap in the next 4 s homes at it again, and one after doesn't
//   weak     a lift before the clack fires a weaker shot (slower, turning less): nothing is wasted
//   plane    a plane coming under a finger the Hose pours from is taken mid-pour, and its shot is fast enough to arrive in under 4 s
//   broken   the target off the screen while held: the lock breaks, nothing fires on the lift
//   hint     HOLD TO LOCK once, the first time a boat is in reach on the screen
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const THREE = await import('three');
const { LifeHost } = await import('../../src/life/Life.ts');
const { Pools } = await import('../../src/life/pools.ts');
const { SNAP_BYTES, view, writeKey } = await import('../../src/life/snapshot.ts');
const { fnv1a } = await import('../../src/life/hash.ts');
const { Col, Kind, ROW } = await import('../../src/life/kinds.ts');
const { globals } = await import('../../src/render/materials.ts');

let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const T0 = Date.parse('2026-11-07T22:00:00Z');
// (the movers: key, kind, where, velocity. The screen is the map from above, 10 m a px for the near ones, the bus at (0, 60, 0) at its middle)
const MOVERS = [
  ['ferry:near:0:20261107', Kind.FERRY, 0, 0, -1000, 0, 5],
  ['ferry:far:0:20261107', Kind.FERRY, 0, 0, -2000, 0, 0],
  ['car:street', Kind.CAR, 1000, 0, 0, 0, 0],
  ['plane:high', Kind.AIRLINER, -1500, 9800, 0, 100, 0],
];
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
// (the holds' stand-in: the screen is the ground plane, 10 m a px round the bus; `hide` hides a point from the camera, `off` puts the ferry off the screen)
const holds = {
  handlers: [], current: null, fired: [], refuse: false, hide: false, off: false, claimed: 0,
  add(h, o) { this.handlers.push({ h, o }); return () => {}; },
  claim(name) { if (!this.current) return false; this.current.owner = name; this.claimed++; return true; },
  release() { if (this.current) this.current.owner = null; },
  screenOf(p, out) {
    out.x = W / 2 + p.x / 10;
    out.y = H / 2 + p.z / 10;
    return !(this.off && p.z < -500) && out.x >= 0 && out.x <= W && out.y >= 0 && out.y <= H;
  },
  inSight() { return !this.hide; },
  bus(out) { return out.set(0, 60, 0); },
  fire(o) { if (this.refuse) return null; this.fired.push(o); return { id: this.fired.length }; },
};
const toasts = [];
let dealt = 0, clacks = 0;
const lock = life.lockOn({ holds, faction: () => 3, hue: () => 4, dealHue: () => dealt++, clack: () => clacks++, hint: (l) => toasts.push(l.join(' ')) });
let sim = 1, utc = T0, id = 0;
const camera = new THREE.PerspectiveCamera(24, W / H, 1.5, 30000);
camera.position.set(0, 200, 300);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const step = (s) => {
  for (let k = 0; k < Math.round(s * 60); k++) {
    sim += 1 / 60;
    utc += 1000 / 60;
    life.frame(1 / 60, sim, utc, { x: 0, y: 60, z: 0 }, camera);
  }
};
/** A hold landing at screen (x, y): asked of the lock as Holds.begin asks a handler, then `aimed` s of it, then the lift. Returns whether the lock took it. */
const hold = (x, y, aimed, opts = {}) => {
  const h = { id: ++id, down: true, x, y, aimed: 0, held: 0, owner: opts.owner ?? null };
  holds.current = h;
  const took = !opts.owner && lock.start(h);
  if (took) h.owner = lock.name;
  for (let t = 0; t < aimed; t += 1 / 60) {
    h.aimed = t;
    lock.move(h, 1 / 60);
    opts.during?.(h, t);
    step(1 / 60);
  }
  h.down = false;
  lock.end(h, !!opts.cancel);
  holds.current = null;
  return took || h.owner === lock.name;
};
const screen = (x, z) => [W / 2 + x / 10, H / 2 + z / 10];
step(0.2);
const hinted = toasts.length;
// ---- pick ----
const nearF = screen(0, -1000), farF = screen(0, -2000), car = screen(1000, 0), sky = [20, 20], plane = screen(-1500, 0);
const picks = {
  near: lock.start({ id: ++id, x: nearF[0] + 30, y: nearF[1], aimed: 0, owner: null }) && lock.locked,
  far: (lock.lost(), lock.start({ id: ++id, x: farF[0], y: farF[1], aimed: 0, owner: null })),
  car: lock.start({ id: ++id, x: car[0], y: car[1], aimed: 0, owner: null }),
  sky: lock.start({ id: ++id, x: sky[0], y: sky[1], aimed: 0, owner: null }),
  plane: lock.start({ id: ++id, x: plane[0] + 40, y: plane[1], aimed: 0, owner: null }) && lock.locked,
};
lock.lost();
row('pick: a ferry 1 km off and a plane 10 km up on the screen take the hold; a ferry 2 km off, a car or the sky don\'t', picks.near === 'ferry:near:0:20261107' && !picks.far && !picks.car && !picks.sky && picks.plane === 'plane:high', picks);
// ---- lock ----
holds.fired.length = 0;
const took = hold(nearF[0], nearF[1], 0.7);
const shot = holds.fired[0];
const glinted = life.lockHash === fnv1a('ferry:near:0:20261107');
// (the shot leads: its vel is the ferry's own, asked after its target as Hold.ts asks it)
const lead = new THREE.Vector3(9, 9, 9);
if (shot?.target(new THREE.Vector3())) shot.vel?.(lead);
shot?.onHit?.();
step(0.05);
const painted = life.painted.get(fnv1a('ferry:near:0:20261107'));
const tapSoon = lock.tap();
const firedSoon = holds.fired.length;
const until = lock.until;
lock.until = performance.now() - 1;
const tapLate = lock.tap();
row('lock: the clack at 0.55 s and its glint; the lift homes at the ferry in the player\'s colours; a hit paints it; a tap in 4 s homes again, one after doesn\'t',
  took && clacks === 1 && glinted && !!shot && lead.x === 0 && lead.y === 0 && lead.z === 5 && shot.speed === 520 && shot.faction === 3 && shot.hue === 4 && painted?.faction === 3 && painted?.hue === 4 && dealt === 1 && tapSoon && firedSoon === 2 && until > 0 && !tapLate,
  { took, clacks, glinted, lead: lead.toArray(), speed: shot?.speed, turn: shot?.turn, painted: painted && { hue: painted.hue, level: painted.level, faction: painted.faction }, tapSoon, tapLate, fired: holds.fired.length });
// ---- weak ----
holds.fired.length = 0;
hold(nearF[0], nearF[1], 0.3);
const weak = holds.fired[0];
row('weak: a lift before the clack fires a weaker shot at it, slower and turning less', !!weak && weak.speed < 520 && weak.turn < 4, { speed: weak?.speed, turn: weak?.turn });
lock.until = performance.now() - 1;
step(0.1);
// ---- plane: under a pouring finger ----
holds.fired.length = 0;
hold(plane[0], plane[1], 0.8, { owner: 'hose' });
const ps = holds.fired[0];
let pt = null;
if (ps) {
  const at = new THREE.Vector3();
  ps.target(at);
  pt = Math.hypot(at.x, at.y - 60, at.z) / ps.speed;
}
row('plane: a plane under a finger the Hose pours from is taken mid-pour, its shot there in under 4 s', lock.qa.midPour === 1 && !!ps && pt < 4, { midPour: lock.qa.midPour, speed: ps && Math.round(ps.speed), arrivesS: pt && +pt.toFixed(2) });
lock.until = performance.now() - 1;
step(0.1);
// ---- broken ----
holds.fired.length = 0;
hold(nearF[0], nearF[1], 0.8, { during: (h, t) => (holds.off = t > 0.3) });
holds.off = false;
row('broken: the ferry off the screen while held breaks the lock, and the lift fires nothing', holds.fired.length === 0 && lock.qa.broken === 1, { fired: holds.fired.length, broken: lock.qa.broken });
// ---- hint ----
step(1.2);
row('hint: HOLD TO LOCK once, the first time a boat is in reach on the screen', hinted === 0 && toasts.length === 1 && toasts[0] === 'HOLD TO LOCK', { toasts });
process.exit(bad ? 1 : 0);
