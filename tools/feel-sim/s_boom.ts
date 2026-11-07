// Sonic Boom on the real city (src/game/Boom.ts, &boom; docs/specs/shots/BUILT.md, "Step 8"): the flick into Turbo 3 from Turbo 2's 720 m/s at 150 and 500 m
// over the ground, 1 km and 16 km, over the Western Addition and downtown, through the real Flight, TurboDrive, TurboLens, CameraRig and Splatter at 1/60 s.
// From 150 and 500 m a ring lands where the bus will be about a second on: every building reaching into its band (0.75 to 1 of its radius, 0.94 times the
// tap's circle from there) goes up one level, none in its hole or past its rim does, its ground is painted in the band and not in the hole; the ring is in
// the frame's lower half as its band blooms, and the bus flies over its hole; no frame passes 8 ms (the flick's frame, with its barf, included), leaving out
// a frame Node's collector ran in. From 1 and 16 km, the crack alone: nothing painted. Over the bay, a ring of spray, nothing painted, and the 10 s unspent.
// A second flick inside 10 s is nothing, and one 10 s after the last rings. Node's clock isn't a phone's: the milliseconds say where the cost is.
//   node tools/feel-sim/run.mjs s_boom.ts
import { newCity, pump, ll, makeGame, makeCam, save, MODE, config } from './lib';
import { Boom, boomTune, type BoomPlan } from '@src/game/Boom';
import { JET, driveSpeed, TurboDrive } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
import { globals } from '@src/render/materials';
import { PerformanceObserver } from 'node:perf_hooks';

const gcs: Array<[number, number]> = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) gcs.push([e.startTime, e.startTime + e.duration]); }).observe({ entryTypes: ['gc'] });
const city = await newCity();
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const rows: unknown[] = [];
const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100;
const dt = 1 / 60;
const PLACES: Array<[string, number, number]> = [['western-addition', 37.7795, -122.4335], ['downtown', 37.7905, -122.4035]];
const counting = { properties: { get: () => ({}) }, getContext: () => ({ texSubImage2D() {} }), state: { activeTexture() {}, bindTexture() {}, pixelStorei() {} } } as any;

/** A bus at Turbo 2's 720 m/s, `over` m over the ground under (x, z) less the second's flight, heading east; flicked into Turbo 3, flown on 3 s. */
async function flick(place: string, lat: number, lon: number, over: number, opts: { second?: boolean; prior?: number } = {}) {
  city.paint.resetAll();
  city.ground.resetAll();
  const [px, pz] = ll(lat, lon);
  const B = boomTune;
  const lead = Math.min(B.leadMax, Math.max(B.lead, B.lead + (over - B.leadFrom) * B.leadK));
  // (a second's run-in at 720 m/s before the flick: the ring lands on the place)
  const x0 = px - 780 * lead - 720, z0 = pz;
  // (where it starts, then where the ring lands, last: the city keeps the tiles round its last focus)
  await pump(city, x0, z0, Math.min(over, 450));
  await pump(city, px, pz, Math.min(over, 450));
  const drive = new TurboDrive([-1e7, -1e7, 1e7, 1e7]);
  const g = makeGame(city, drive);
  const f: any = g.flight;
  const y = city.groundAt(x0, z0) + over;
  Object.assign(f, { x: x0, z: z0, heading: Math.PI / 2, y, holdY: y, targetY: y, vy: 0, mode: 0, speed: 720, fullness: 1 });
  drive.arrive(JET, 2);
  const cam = makeCam(), lens = new TurboLens();
  const plans: Array<BoomPlan | null> = [];
  const boom = new Boom(city, g.splatter, { crack: () => {}, crown: (p) => (p.crowned = true) });
  boom.on = true;
  if (opts.prior !== undefined) boom.last = -opts.prior;
  // (a frame as the page's: the game's, then the city's ground slice and its upload; its parts' milliseconds)
  let parts = [0, 0, 0];
  const step = () => {
    const a = performance.now();
    g.frame(dt, { sx: 0, sy: 0, dragging: false });
    boom.update(dt);
    const t1 = performance.now();
    globals.uTime.value = g.t;
    city.ground.work();
    const t2 = performance.now();
    city.ground.flush(counting, dt);
    const t3 = performance.now();
    parts = [r2(t1 - a), r2(t2 - t1), r2(t3 - t2)];
    lens.update(dt, drive, cam.rig, f);
    cam.update(f, dt);
    return [a, performance.now()];
  };
  for (let i = 0; i < 60; i++) step();
  // (its height over the ground under it now, where the Boom reads it)
  f.y = f.holdY = f.targetY = f.groundBroad + over;
  const before = new Map<number, number>();
  const near = city.buildingsWithin(f.x + f.fx * 780 * lead, f.z + f.fz * 780 * lead, 600, []);
  for (const n of near) before.set(n.ref.index, city.paint.level(n.ref.index));
  // the flick: a rung up from Turbo 2, as Controls.onRung hands it to the Boom
  const frames: Array<{ ms: number; a: number; b: number; parts: number[] }> = [];
  const a0 = performance.now();
  const fire = () => {
    drive.rung(1, f);
    const p = boom.flick(f, driveSpeed(drive.gear, drive.level, true));
    plans.push(p);
    return p;
  };
  fire();
  const flickMs = r2(performance.now() - a0);
  const [, b0] = step();
  frames.push({ ms: b0 - a0, a: a0, b: b0, parts: [flickMs, ...parts] });
  const plan = plans[0];
  let busMin = Infinity, bloomY = NaN, bloomX = NaN, rimY: number[] = [];
  for (let i = 0; i < 180; i++) {
    if (opts.second && i === 60) fire();
    const [a, b] = step();
    frames.push({ ms: b - a, a, b, parts });
    if (plan) {
      busMin = Math.min(busMin, Math.hypot(f.x - plan.x, f.z - plan.z));
      if (Number.isNaN(bloomY) && boom.time >= plan.bloom) {
        const c = cam.project(plan.x, plan.y, plan.z);
        bloomX = c.x;
        bloomY = c.y;
        rimY = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((t) => r2(cam.project(plan.x + Math.cos(t) * plan.r, plan.y, plan.z + Math.sin(t) * plan.r).y));
      }
    }
  }
  // what changed: the band's buildings by one level, none else
  let band = 0, up1 = 0, wrong = 0, hole = 0, outside = 0;
  const after = city.buildingsWithin(plan?.x ?? px, plan?.z ?? pz, 700, []);
  for (const n of after) {
    const ref = n.ref, was = before.get(ref.index) ?? 0, now = city.paint.level(ref.index);
    if (!plan || plan.kind !== 'ring') {
      if (now !== was) wrong++;
      continue;
    }
    // (as Splatter.barf reaches it: a house by its centroid less its half-size, a big footprint by its true edge; out when wholly in the hole)
    const small = ref.rad <= config.splat.smallRad, d = Math.hypot(ref.cx - plan.x, ref.cz - plan.z);
    const e = small ? d - 0.55 * Math.sqrt(ref.area) : n.d, far = d + (small ? 0.55 * Math.sqrt(ref.area) : ref.rad);
    const inBand = e <= plan.r && far >= plan.inner;
    if (inBand) {
      band++;
      if (now === Math.min(3, was + 1)) up1++;
    } else if (now !== was) {
      wrong++;
      if (far < plan.inner) hole++;
      else outside++;
    }
  }
  // the ground: sampled round the ring in the band, in the hole and past the rim
  const at = (k: number) => {
    if (!plan) return 0;
    let n = 0;
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2, s = city.ground.sample(plan.x + Math.cos(t) * plan.r * k, plan.z + Math.sin(t) * plan.r * k);
      if (s && s.cov >= 0.5) n++;
    }
    return n / 24;
  };
  const gBand = at(0.87), gHole = at(0.45), gOut = at(1.6);
  const counted = frames.filter((fr) => !gcs.some(([s, e]) => s < fr.b && e > fr.a));
  const worst = Math.max(...counted.map((fr) => fr.ms)), worstAt = frames.findIndex((fr) => fr.ms === worst);
  const row = { place, over, kind: plan?.kind ?? null, r: plan && r1(plan.r), inner: plan && r1(plan.inner), ahead: plan && r1(Math.hypot(plan.x - x0, plan.z - z0)), band, up1, wrong, hole, outside, gBand: r2(gBand), gHole: r2(gHole), gOut: r2(gOut), bloom: [r2(bloomX), r2(bloomY)], rimY, busMin: r1(busMin), worstMs: r2(worst), worstAt, worstParts: frames[worstAt]?.parts, gcFrames: frames.length - counted.length, last: boom.last, stats: { ...boom.stats }, plans: plans.map((p) => p?.kind ?? null) };
  rows.push(row);
  console.log(JSON.stringify(row));
  return { row, boom, plan };
}

// (a ring and three taps first, unmeasured, as s_bomb warms its paths: the page has flown before its first Turbo 3)
await flick('warm-up', PLACES[0][1], PLACES[0][2] - 0.02, 150);
await flick('warm-up', PLACES[0][1] - 0.01, PLACES[0][2] - 0.02, 500);
rows.length = 0;
for (const [place, lat, lon] of PLACES) {
  // (the 500 m row is flown at 490 over the ground where it starts: the ground under it a second on is a few metres either way, and over 500 it's the crack alone)
  for (const over of [150, 490]) {
    const { row, plan } = await flick(place, lat, lon, over);
    const L = `${place} ${over} m`;
    ok(row.kind === 'ring' && !!plan, `${L}: a ring (${row.kind})`);
    ok(row.band > 0 && row.up1 === row.band, `${L}: every building in the band one level up (${row.up1} of ${row.band})`);
    ok(row.wrong === 0, `${L}: none in the hole or past the rim changed (${row.hole} in the hole, ${row.outside} past it)`);
    ok(row.gBand >= 0.6 && row.gHole === 0, `${L}: the ground painted in the band and not in the hole (${row.gBand} of the band's samples, ${row.gHole} of the hole's)`);
    ok(row.bloom[0] > 0.05 && row.bloom[0] < 0.95 && row.bloom[1] >= 0.5 && row.bloom[1] < 1, `${L}: in the frame's lower half as its band blooms (centre ${row.bloom.join(', ')})`);
    ok(!!plan && row.busMin < plan.inner, `${L}: the bus flies over its hole (${row.busMin} m from its middle at the nearest, the hole ${row.inner})`);
    ok(row.worstMs <= 8, `${L}: no frame over 8 ms (${row.worstMs}, ${row.gcFrames} with the collector left out)`);
  }
  for (const over of [1000, 16000]) {
    const { row } = await flick(place, lat, lon, over);
    const L = `${place} ${over / 1000} km`;
    ok(row.kind === 'high' && row.wrong === 0, `${L}: the crack alone, nothing painted (${row.kind}, ${row.wrong} changed)`);
  }
  // a second flick inside the 10 s: nothing
  const s = await flick(place, lat, lon, 150, { second: true });
  ok(s.row.plans[0] === 'ring' && s.row.plans[1] === null && s.boom.stats.quiet === 1 && s.boom.stats.rings === 1, `${place}: a second flick a second on is nothing (${JSON.stringify(s.row.plans)}, ${JSON.stringify(s.boom.stats)})`);
  // the 10 s run out: a flick 10 s after the last rings
  const t = await flick(place, lat, lon, 150, { prior: 10.05 });
  ok(t.row.kind === 'ring', `${place}: a flick 10 s after the last rings (${t.row.kind})`);
}
// over the bay east of the Ferry Building: spray, nothing painted, and the 10 s kept
{
  const w = await flick('bay', 37.8035, -122.372, 150, {});
  ok(w.row.kind === 'water' && w.row.wrong === 0 && w.row.gBand === 0, `the bay: a ring of spray, nothing painted (${w.row.kind}, ${w.row.wrong} changed, ${w.row.gBand} of the band's ground)`);
  ok(w.boom.last === -Infinity && w.plan?.crowned === true, `the bay: the 10 s unspent and its spray up (last ${w.boom.last}, ${w.plan?.crowned})`);
}
save('boom', rows);
console.log(fails.length ? `[${MODE}] FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `[${MODE}] boom checks: all ${checks} passed (${rows.length} rows)`);
process.exit(fails.length ? 1 : 0);
