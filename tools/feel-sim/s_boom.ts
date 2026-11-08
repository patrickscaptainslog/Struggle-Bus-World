// Sonic Boom on the real city (src/game/Boom.ts, &boom; docs/specs/shots/BUILT.md, "The extras"): the flick into Turbo 3 from Turbo 2's 720 m/s at 150 and 500 m
// over the ground, 1 km and 16 km, over the Western Addition and downtown, through the real Flight, TurboDrive, TurboLens, CameraRig and Splatter at 1/60 s.
// From 150, 300 and 490 m, at 1/60 s and 1/30 s: the crack fires once (its flash over the frame held 0.16 s, its sky's pressure ring racing out after it),
// the hoop stands upright across the path at the bus's height about a second ahead, the bus threads it (through its hole as it crosses its plane, at either
// frame rate), and the hoop lies flat as the ring by the time the band's inner edge blooms; a ring lands ahead: every building reaching into its band (0.75
// to 1 of its radius, 0.94 times the tap's circle from there) goes up one level, none in its hole or past its rim does, its ground is painted in the band and
// not in the hole; the ring is in the frame's lower half as its band blooms, and the bus flies over its hole; no hit-stop; no frame passes 8 ms (the flick's
// and the thread's frames, with its barf, included), leaving out a frame Node's collector ran in (a row over 8 ms is flown again and the lower counts, as
// s_bomb's). From 1 and 16 km, the crack alone: nothing painted. Over the bay, a ring of spray, nothing painted, and the 10 s unspent.
// A second flick inside 10 s is nothing, and one 10 s after the last rings. Node's clock isn't a phone's: the milliseconds say where the cost is.
//   node tools/feel-sim/run.mjs s_boom.ts
import { newCity, pump, ll, makeGame, makeCam, save, MODE, config } from './lib';
import { Boom, boomLead, boomTune, hoopPose, type BoomPlan, type HoopPose } from '@src/game/Boom';
import { JET, driveSpeed, TurboDrive } from '@src/game/Turbo';
import { crackSky, TurboFx, TurboLens, turboFxTune } from '@src/fx/Turbo';
import { lookOf } from '@src/render/factionLook';
import { Ramp } from '@src/render/palette';
import { FACTION_ATLANTIS, FACTION_ELDERWOOD, FACTION_HYPERGLOW, FACTION_INFERNO, FACTION_RAINBOW } from '@src/game/factions';
import { blastRadiusFor } from '@src/game/blastLayout';
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
/** where the ring's middle sits on the screen at most as its band blooms (of the height down): from 150 m it blooms round the bus at 0.66, and the outside look
 *  asked that every height get that frame (from 300 and 490 m it bloomed at 0.75 or lower, its band at the frame's bottom edge as it came up) */
const BLOOM_Y = 0.7;
const PLACES: Array<[string, number, number]> = [['western-addition', 37.7795, -122.4335], ['downtown', 37.7905, -122.4035]];
const counting = { properties: { get: () => ({}) }, getContext: () => ({ texSubImage2D() {} }), state: { activeTexture() {}, bindTexture() {}, pixelStorei() {} } } as any;

/** A bus at Turbo 2's 720 m/s, `over` m over the ground under (x, z) less the second's flight, heading east; flicked into Turbo 3, flown on 3 s. */
async function flick(place: string, lat: number, lon: number, over: number, opts: { second?: boolean; prior?: number; dt?: number } = {}) {
  const dt = opts.dt ?? 1 / 60;
  city.paint.resetAll();
  city.ground.resetAll();
  const [px, pz] = ll(lat, lon);
  const B = boomTune;
  const lead = boomLead(over, B.radiusK * blastRadiusFor(over));
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
  let cracks = 0;
  const boom = new Boom(city, g.splatter, { crack: () => cracks++, crown: (p) => (p.crowned = true) });
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
  for (let i = 0, n = Math.round(1 / dt); i < n; i++) step();
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
  // the hoop: standing (its pose at hoopFly s, against the bus then), at the thread (the bus's offsets from its middle), and as the band's inner edge blooms
  const pose: HoopPose = { x: 0, y: 0, z: 0, r: 0, flat: 0, w: 0, tear: 0 };
  const nose = { x: 0, y: 0, z: 0 };
  let stand: { ahead: number; dy: number; flat: number; r: number } | null = null, thr: { along: number; across: number; dy: number; age: number; flat: number } | null = null, slam: { flat: number; dx: number; dz: number; r: number } | null = null;
  const hitStops0 = (g as any).events.filter((e: any) => e.ev === 'hitstop').length;
  // (the crack over the frame, by its age: frames with the flash, the front's angles)
  let flashFrames = 0, flashEnd = 0;
  const fronts: number[] = [], t0 = boom.time - dt, sky = { flash: 0, front: -1 };
  // (4 s on: longer, at 30 fps the tiles round the ring are let go behind the bus before its ground is sampled)
  for (let i = 0, n = Math.round(4 / dt); i < n; i++) {
    if (opts.second && i === Math.round(1 / dt)) fire();
    const age = boom.time - t0;
    crackSky(age, sky);
    if (sky.flash > 0) {
      flashFrames++;
      flashEnd = age;
    }
    if (sky.front >= 0) fronts.push(sky.front);
    const [a, b] = step();
    frames.push({ ms: b - a, a, b, parts });
    if (plan && plan.kind !== 'high') {
      Object.assign(nose, { x: f.x + f.fx * 6, y: f.y, z: f.z + f.fz * 6 });
      const has = hoopPose(plan, boom.time, nose, pose);
      if (!stand && boom.time - plan.t0 >= boomTune.hoopFly && has) stand = { ahead: r2(((pose.x - f.x) * plan.nx + (pose.z - f.z) * plan.nz) / Math.max(1, f.ground)), dy: r1(pose.y - f.y), flat: pose.flat, r: r1(pose.r) };
      if (!thr && boom.time >= plan.thread) thr = { along: r1((f.x - plan.hx) * plan.nx + (f.z - plan.hz) * plan.nz), across: r1((f.z - plan.hz) * plan.nx - (f.x - plan.hx) * plan.nz), dy: r1(f.y - plan.hy), age: r2(plan.thread - plan.t0), flat: pose.flat };
      if (!slam && boom.time >= plan.slam && has) slam = { flat: pose.flat, dx: r1(pose.x - plan.x), dz: r1(pose.z - plan.z), r: r2(pose.r / plan.r) };
    }
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
  const hitStops = (g as any).events.filter((e: any) => e.ev === 'hitstop').length - hitStops0;
  const row = { place, over, fps: Math.round(1 / dt), cracks, flashFrames, flashEnd: r2(flashEnd), frontMax: r2(Math.max(-1, ...fronts)), frontFrames: fronts.length, stand, thr, threaded: plan?.threaded ?? null, slam, hitStops, kind: plan?.kind ?? null, r: plan && r1(plan.r), inner: plan && r1(plan.inner), ahead: plan && r1(Math.hypot(plan.x - x0, plan.z - z0)), band, up1, wrong, hole, outside, gBand: r2(gBand), gHole: r2(gHole), gOut: r2(gOut), bloom: [r2(bloomX), r2(bloomY)], rimY, busMin: r1(busMin), worstMs: r2(worst), worstAt, worstParts: frames[worstAt]?.parts, gcFrames: frames.length - counted.length, last: boom.last, stats: { ...boom.stats }, plans: plans.map((p) => p?.kind ?? null) };
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
  for (const [over, dt] of [150, 300, 490].flatMap((o) => [[o, 1 / 60], [o, 1 / 30]])) {
    const { row, plan } = await flick(place, lat, lon, over, { dt });
    const L = `${place} ${over} m at ${row.fps} fps`;
    // (a frame over 8 ms is flown again and the lower counts, as s_bomb's: on the laptop beside the Lob's run a frame with nothing but the flight in it took
    // 22 ms once, the machine's, not the ring's)
    const again = row.worstMs > 8 ? (await flick(place, lat, lon, over, { dt })).row.worstMs : null;
    const st = row.stand, th = row.thr, sl = row.slam, X = turboFxTune;
    ok(row.cracks === 1 && row.flashFrames >= Math.floor(X.crackFlash / dt) && row.flashEnd < X.crackFlash && row.frontFrames > 0 && row.frontMax > 0.9 * X.crackFrontMax, `${L}: the crack fired once, its flash held ${X.crackFlash} s and its pressure ring raced out (${row.cracks} cracks, ${row.flashFrames} frames of flash to ${row.flashEnd} s, the front to ${row.frontMax} rad over ${row.frontFrames} frames)`);
    ok(!!st && st.flat === 0 && st.ahead >= 0.4 && st.ahead <= 1.1 && Math.abs(st.dy) <= 12, `${L}: the hoop stands upright across the path at the bus's height ahead (${JSON.stringify(st)}: s of flight ahead, m over the bus)`);
    ok(!!th && row.threaded === true && th.flat === 0 && th.age >= 0.8 && th.age <= 1.3, `${L}: the bus threads it, upright, about a second on (${JSON.stringify(th)}, threaded ${row.threaded})`);
    ok(!!sl && sl.flat === 1 && Math.hypot(sl.dx, sl.dz) < 1 && sl.r >= 1 && sl.r < 1.06, `${L}: the hoop flat as the ring as its inner edge blooms (${JSON.stringify(sl)})`);
    ok(row.hitStops === 0, `${L}: no hit-stop (${row.hitStops})`);
    const worst = again === null ? row.worstMs : Math.min(row.worstMs, again);
    ok(row.kind === 'ring' && !!plan, `${L}: a ring (${row.kind})`);
    ok(row.band > 0 && row.up1 === row.band, `${L}: every building in the band one level up (${row.up1} of ${row.band})`);
    ok(row.wrong === 0, `${L}: none in the hole or past the rim changed (${row.hole} in the hole, ${row.outside} past it)`);
    ok(row.gBand >= 0.6 && row.gHole === 0, `${L}: the ground painted in the band and not in the hole (${row.gBand} of the band's samples, ${row.gHole} of the hole's)`);
    ok(row.bloom[0] > 0.05 && row.bloom[0] < 0.95 && row.bloom[1] >= 0.5 && row.bloom[1] <= BLOOM_Y, `${L}: in the frame's lower half as its band blooms, its middle ${BLOOM_Y} of the height down at most, as from 150 m (centre ${row.bloom.join(', ')})`);
    ok(!!plan && row.busMin < plan.inner, `${L}: the bus flies over its hole (${row.busMin} m from its middle at the nearest, the hole ${row.inner})`);
    ok(worst <= 8, `${L}: no frame over 8 ms (${row.worstMs}${again === null ? '' : `, flown again ${again}`}, ${row.gcFrames} with the collector left out)`);
  }
  for (const over of [1000, 16000]) {
    const { row } = await flick(place, lat, lon, over);
    const L = `${place} ${over / 1000} km`;
    ok(row.kind === 'high' && row.wrong === 0, `${L}: the crack alone, nothing painted (${row.kind}, ${row.wrong} changed)`);
  }
  // a second flick inside the 10 s: nothing
  const s = await flick(place, lat, lon, 150, { second: true });
  ok(s.row.plans[0] === 'ring' && s.row.plans[1] === null && s.boom.stats.quiet === 1 && s.boom.stats.rings === 1 && s.row.cracks === 1, `${place}: a second flick a second on is nothing (${JSON.stringify(s.row.plans)}, ${JSON.stringify(s.boom.stats)})`);
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
// the contrail's rows (not behind &boom): by the bus's faction its spray, and Rainbow's the hues its shader had as constants (Ramp.RED + band), so its every
// pixel is as before; the shader reads them from the uniform
{
  const fx = new TurboFx({} as any, 12) as any, U = fx.trailU.uTrailRows.value as number[], src = String(fx.trail.material.fragmentShader);
  const hues = [0, 1, 2, 3, 4, 5].map((k) => Ramp.RED + k);
  ok(U.join() === hues.join() && src.includes('uTrailRows[int(band)]'), `the trail's rows before a faction: Rainbow's hues from the uniform (${U.join()})`);
  const got: Record<string, string> = {};
  for (const [name, id] of [['atlantis', FACTION_ATLANTIS], ['elderwood', FACTION_ELDERWOOD], ['hyperglow', FACTION_HYPERGLOW], ['inferno', FACTION_INFERNO], ['rainbow', FACTION_RAINBOW]] as const) {
    fx.setTrailRows(lookOf(id).spray);
    got[name] = U.join();
    ok(U.join() === lookOf(id).spray.join(), `the trail's rows in ${name}: its spray (${U.join()})`);
  }
  ok(got.rainbow === hues.join(), `the trail's rows back in Rainbow: its hues, as the shader had them (${got.rainbow})`);
  rows.push({ trail: got });
  console.log(JSON.stringify({ trail: got }));
}
save('boom', rows);
console.log(fails.length ? `[${MODE}] FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `[${MODE}] boom checks: all ${checks} passed (${rows.length} rows)`);
process.exit(fails.length ? 1 : 0);
