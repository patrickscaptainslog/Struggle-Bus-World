// Super splat, offline: the real City / Flight / Splatter / Aimer / GroundPaint and the real SuperSplat state
// machine (its fx, audio and camera stubbed and counted), on the baked city, in main.ts's frame order.
//   node tools/feel-sim/run.mjs s_super.ts [dt]
// Checks: the charge (timeline, speed, heartbeat), a release under superMin (a normal tap, no cooldown), a
// cancel (no cooldown), the mega blast at 50 % (radius, buildings, cooldown 30 s), "not yet" in the cooldown,
// the firehose sweeping a right turn from the Painted Ladies toward Hayes Valley (impacts per second, live
// blasts in flight, buildings painted / at L3, ground share along the sweep, finale, cooldown 60 s), the same
// from 250 m, a plain tap at the same spot for comparison, and the CPU cost of the game-side work per frame.
import { newCity, pump, ll, save, config, THREE, type BuildingRef } from './lib';
import { Flight } from '@src/game/Flight';
import { Splatter, type Blast } from '@src/game/Splat';
import { Aimer } from '@src/game/Aim';
import { SuperSplat } from '@src/game/SuperSplat';
import type { City } from '@src/world/City';

const dtArg = Number(process.argv[2] ?? 1 / 30);
const city = await newCity();
const fakeRenderer = { properties: { get: () => ({}) }, getContext: () => ({}), state: {} } as unknown as THREE.WebGLRenderer;

interface Counts { [k: string]: number }
function makeWorld(c: City) {
  const counts: Counts = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const flight = new Flight();
  let hitStop = 0;
  let sup: SuperSplat;
  const bloomed = new Set<number>();
  const fx = {
    geyser: () => bump('geyser'),
    impact: (b: Blast) => {
      bump(b.hose ? 'hoseImpact' : 'impact');
      if (b.hose) sup.impact(b);
    },
    bloom: (ref: BuildingRef) => {
      bump('bloom');
      bloomed.add(ref.index);
    },
    primary: () => bump('sign'),
    hitStop: (f: number) => {
      hitStop = Math.max(hitStop, f / 60);
      bump('hitStop');
    },
    miss: () => bump('miss'),
  };
  const splatter = new Splatter(c, fx as any);
  const aimer = new Aimer(c, splatter);
  const stub = (name: string) => () => bump(name);
  const particles = { geyser: stub('p.geyser'), splash: stub('p.splash'), burst: stub('p.burst'), fling: stub('p.fling'), puff: stub('p.puff') };
  const sfx = { motes: (n: number) => bump('fx.motes', n), sparks: (n: number) => bump('fx.sparks', n), halo: (n: number) => bump('fx.halo', n), arcs: 0 };
  const audio = new Proxy({}, { get: (_t, k) => () => bump(`a.${String(k)}`) });
  const rig = { kick: stub('kick') };
  const mouth = new THREE.Vector3();
  const vel = new THREE.Vector3();
  let tapped = 0;
  sup = new SuperSplat({
    flight, city: c, splatter, aimer, particles: particles as any, fx: sfx as any, audio: audio as any, rig: rig as any,
    mouth: () => mouth.set(flight.x + flight.fx * 9, flight.y, flight.z + flight.fz * 9),
    busVel: () => vel.set(flight.fx * flight.speed, flight.vy, flight.fz * flight.speed),
    exhaust: (o) => o.set(flight.x, flight.y, flight.z),
    hatch: (o) => o.set(flight.x, flight.y + 2, flight.z),
    tap: () => {
      tapped++;
      const shot = aimer.fire(flight);
      if (flight.tryBarf()) splatter.barf(shot.x, shot.z, { drop: shot.drop, travel: config.splat.inhale + shot.travel, target: shot.target, y: shot.y, exact: shot.exact });
    },
    mega: (shot, radius, _w, hs) => {
      flight.barfT = -1;
      flight.fullness = 1;
      flight.tryBarf();
      splatter.barf(shot.x, shot.z, { drop: shot.drop, travel: config.splat.inhale + shot.travel, target: shot.target, y: shot.y, exact: shot.exact, radius, hitStop: hs });
    },
    flash: stub('flash'),
    hitStop: (f) => (hitStop = Math.max(hitStop, f / 60)),
    sign: stub('hoseSign'),
  });
  const focus = new THREE.Vector3();
  let t = 0;
  let maxPending = 0;
  const work: number[] = [];
  const parts: number[][] = [];
  const w = {
    parts,
    flight, splatter, aimer, sup, counts, bloomed, get t() { return t; }, get tapped() { return tapped; }, work,
    get maxPending() { return maxPending; },
    frame(dt: number, inp: { sx: number; sy: number; dragging: boolean }) {
      if (hitStop > 0) { hitStop -= dt; dt = 0; }
      t += dt;
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let i = 0; i < steps; i++) flight.step(dt / steps, inp, c);
      const t0 = performance.now();
      aimer.update(flight, t, inp.dragging);
      sup.update(dt);
      const t1 = performance.now();
      splatter.update(dt);
      const t2 = performance.now();
      focus.set(flight.x, 60, flight.z);
      c.update(focus, fakeRenderer, dt);
      const t3 = performance.now();
      work.push(t3 - t0);
      parts.push([t1 - t0, t2 - t1, t3 - t2]);
      const pend = (splatter as any).pending.length;
      if (pend > maxPending) maxPending = pend;
    },
  };
  return w;
}

function placeBus(w: ReturnType<typeof makeWorld>, lat: number, lon: number, hdg: number, height = 0) {
  const [x, z] = ll(lat, lon);
  const f = w.flight;
  f.x = x; f.z = z; f.heading = (hdg * Math.PI) / 180; f.glideSpeed = 0;
  f.y = city.obstacleAt(x, z) + 9;
  if (height > 0) {
    f.y = city.groundAt(x, z) + height;
    f.holdY = f.y;
    (f as any).mode = 1;
  }
}

/** Painted buildings / total within r of (x, z), at L3, and the ground share painted. */
function painted(x: number, z: number, r: number) {
  const near = city.buildingsNear(x, z, r, []);
  let p = 0, l3 = 0, cells = 0, ground = 0;
  for (const n of near) {
    const lv = city.paint.level(n.ref.index);
    if (lv > 0.5) p++;
    if (lv > 2.5) l3++;
  }
  for (let dz = -r; dz <= r; dz += 4)
    for (let dx = -r; dx <= r; dx += 4) {
      if (dx * dx + dz * dz > r * r) continue;
      cells++;
      const g = city.ground.sample(x + dx, z + dz);
      if (g && g.cov >= 0.5) ground++;
    }
  return { buildings: near.length, painted: p, l3, groundShare: +(cells ? ground / cells : 0).toFixed(3) };
}
function resetPaint() {
  city.paint.resetAll();
  city.ground.resetAll();
  for (const m of (city.ground as any).masks.values()) m.data.fill(0);
}
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(3); };
const max = (a: number[]) => +Math.max(...a).toFixed(3);
const S = config.splat;
const report: any = { dt: dtArg };
const dt = dtArg;
const idle = { sx: 0, sy: 0, dragging: false };

// the Painted Ladies: Steiner St between Hayes and Grove; Hayes Valley lies ~700 m east
const LADIES: [number, number] = [37.7762, -122.4328];
const START: [number, number, number] = [37.7742, -122.4345, 25]; // south-west of the row, heading NNE

// ---- 1) a plain tap at the row (the comparison)
{
  const [x, z] = ll(...START.slice(0, 2) as [number, number]);
  await pump(city, x, z);
  resetPaint();
  const w = makeWorld(city);
  placeBus(w, ...START);
  for (let k = 0; k < 30; k++) w.frame(dt, idle);
  w.flight.fullness = 1;
  w.frame(dt, idle);
  const shot = w.aimer.fire(w.flight);
  w.flight.tryBarf();
  w.splatter.barf(shot.x, shot.z, { drop: shot.drop, travel: S.inhale + shot.travel, target: shot.target, y: shot.y, exact: shot.exact });
  for (let k = 0; k < 2 / dt; k++) w.frame(dt, idle);
  const [lx, lz] = [shot.x, shot.z];
  report.tap = { at: [+lx.toFixed(1), +lz.toFixed(1)], bloomed: w.bloomed.size, near90: painted(lx, lz, 90), work: { median: med(w.work), max: max(w.work) } };
}

// ---- 2) charge timeline, release under superMin, cancel, mega at 50 %, "not yet"
{
  const [x, z] = ll(...START.slice(0, 2) as [number, number]);
  await pump(city, x, z);
  resetPaint();
  const w = makeWorld(city);
  placeBus(w, ...START);
  for (let k = 0; k < 30; k++) w.frame(dt, idle);
  const cruise = w.flight.speed;
  // under min: a 2 s hold is a normal tap
  w.sup.qaCharge(2);
  for (let k = 0; k < 2.2 / dt; k++) w.frame(dt, idle);
  const under = { phase: w.sup.phase, tapped: w.tapped, cooldown: w.sup.cooldownLeft };
  for (let k = 0; k < 2 / dt; k++) w.frame(dt, idle);
  // cancel at 4 s
  w.sup.chargeStart(0);
  for (let k = 0; k < 4 / dt; k++) w.frame(dt, idle);
  const chargeAt4 = +w.sup.charge.toFixed(3);
  w.sup.chargeEnd(4, true);
  const cancel = { phase: w.sup.phase, charge: chargeAt4, cooldown: w.sup.cooldownLeft, stop: w.counts['a.superChargeStop'] };
  for (let k = 0; k < 1 / dt; k++) w.frame(dt, idle);
  // mega at 50 %
  resetPaint();
  w.bloomed.clear();
  const timeline: any[] = [];
  const t0 = w.t;
  w.sup.qaCharge(5);
  let next = 0;
  while (w.sup.phase === 'charging') {
    w.frame(dt, idle);
    if (w.t - t0 >= next) {
      timeline.push({ t: +(w.t - t0).toFixed(2), charge: +w.sup.charge.toFixed(3), speed: +w.flight.speed.toFixed(1), swell: +w.sup.swell.toFixed(3), dolly: +w.sup.dolly.toFixed(3) });
      next += 1.25;
    }
  }
  const megaShot = { radius: +w.sup.stats.radius.toFixed(1), cooldown: +w.sup.cooldownLeft.toFixed(1), phase: w.sup.phase };
  for (let k = 0; k < 2.5 / dt; k++) w.frame(dt, idle);
  const ms: any = (w as any).splatter;
  void ms;
  // where did it land: the biggest painted cluster = around the bus's aim; measure around the last impact sample
  const deny0 = w.counts['a.superFizzle'] ?? 0;
  w.sup.chargeStart(0);
  const deny = { fizzles: (w.counts['a.superFizzle'] ?? 0) - deny0, phase: w.sup.phase };
  report.charge = { cruise: +cruise.toFixed(1), under, cancel, mega50: { ...megaShot, bloomed: w.bloomed.size, hitStops: w.counts.hitStop ?? 0 }, timeline, deny };
}

// ---- 3) the firehose, sweeping a right turn over the Painted Ladies toward Hayes Valley, at the rooftops
async function firehose(name: string, lat: number, lon: number, hdg: number, height: number, steer: number) {
  const [x, z] = ll(lat, lon);
  await pump(city, x, z, height);
  resetPaint();
  const w = makeWorld(city);
  placeBus(w, lat, lon, hdg, height);
  for (let k = 0; k < 20; k++) w.frame(dt, idle);
  // a quick charge (the timeline is checked above): start at 9.9 s held
  w.sup.chargeStart(S.superCharge - 0.05);
  let k = 0;
  while (w.sup.phase === 'charging' && k++ < 100) w.frame(dt, idle);
  const startT = w.t;
  const startSpeed = w.flight.speed;
  const path: any[] = [];
  const impactTimes: number[] = [];
  let lastImp = 0;
  const aims: Array<[number, number]> = [];
  const work0 = w.work.length;
  while (w.sup.phase === 'firehose' && w.t - startT < 8) {
    w.frame(dt, { sx: steer, sy: 0, dragging: steer !== 0 });
    const imp = w.sup.stats.impacts;
    if (imp > lastImp) {
      impactTimes.push(+(w.t - startT).toFixed(3));
      lastImp = imp;
    }
    const a = w.aimer.aim;
    aims.push([a.x, a.z]);
    if (path.length === 0 || w.t - startT >= path.length * 0.5) path.push({ t: +(w.t - startT).toFixed(2), speed: +w.flight.speed.toFixed(1), heading: +((w.flight.heading * 180) / Math.PI).toFixed(0), aim: [+a.x.toFixed(0), +a.z.toFixed(0)], drop: +a.drop.toFixed(0), y: +w.flight.y.toFixed(0) });
  }
  const hoseWork = w.work.slice(work0);
  const hp = w.parts.slice(work0);
  const worst = hp.map((p, i) => ({ i, p })).sort((a, b) => b.p[0] + b.p[1] + b.p[2] - (a.p[0] + a.p[1] + a.p[2])).slice(0, 4).map((o) => o.p.map((v) => +v.toFixed(2)));
  const dur = w.t - startT;
  for (let j = 0; j < 2.5 / dt; j++) w.frame(dt, { sx: steer, sy: 0, dragging: steer !== 0 });
  // what it painted: every building bloomed, those at L3, the ground share in a 60 m band along the aim path
  let l3 = 0;
  for (const i of w.bloomed) if (city.paint.level(i) > 2.5) l3++;
  let cells = 0, ground = 0;
  const seen = new Set<string>();
  for (let j = 0; j < aims.length; j += 2) {
    const [ax, az] = aims[j];
    for (let dz = -30; dz <= 30; dz += 6)
      for (let dx = -30; dx <= 30; dx += 6) {
        const key = `${Math.round((ax + dx) / 6)},${Math.round((az + dz) / 6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells++;
        const g = city.ground.sample(ax + dx, az + dz);
        if (g && g.cov >= 0.5) ground++;
      }
  }
  const gaps: number[] = [];
  for (let j = 1; j < impactTimes.length; j++) gaps.push(impactTimes[j] - impactTimes[j - 1]);
  const out = {
    startSpeed: +startSpeed.toFixed(1), duration: +dur.toFixed(2), impacts: w.sup.stats.impacts, misses: w.sup.stats.misses,
    impactsPerSecond: +(w.sup.stats.impacts / S.firehoseDuration).toFixed(1), firstImpact: impactTimes[0], gapMedian: gaps.length ? med(gaps) : null, gapMax: gaps.length ? max(gaps) : null,
    maxLiveBlasts: w.maxPending, bloomed: w.bloomed.size, l3, bloomEvents: w.counts.bloom ?? 0, groundShareAlongSweep: +(ground / Math.max(1, cells)).toFixed(3),
    finale: w.counts.impact ?? 0, hitStops: w.counts.hitStop ?? 0, signs: w.counts.hoseSign ?? 0, flashes: w.counts.flash ?? 0, phaseAfter: w.sup.phase, cooldown: +w.sup.cooldownLeft.toFixed(1),
    particles: { geyser: w.counts['p.geyser'], splash: w.counts['p.splash'], burst: w.counts['p.burst'], fling: w.counts['p.fling'] },
    work: { median: med(hoseWork), max: max(hoseWork), superMedian: med(hp.map((p) => p[0])), splatterMedian: med(hp.map((p) => p[1])), cityMedian: med(hp.map((p) => p[2])), worst }, path,
  };
  report[name] = out;
  return w;
}
// (profile what an impact frame spends its time on)
const prof: Record<string, number[]> = {};
function wrap(obj: any, name: string, tag: string) {
  const orig = obj[name].bind(obj);
  obj[name] = (...args: any[]) => {
    const t0 = performance.now();
    const r = orig(...args);
    (prof[tag] ??= []).push(performance.now() - t0);
    return r;
  };
}
wrap(city.ground, 'land', 'ground.land');
wrap(city.ground, 'begin', 'ground.begin');
wrap(city.ground, 'work', 'ground.work');
wrap(city, 'buildingsWithin', 'city.buildingsWithin');
for (const m of ['rows', 'dots', 'addPending', 'writeTile', 'start', 'step', 'prepare', 'mask', 'clearSerial', 'replayed']) wrap(city.ground, m, `g.${m}`);
wrap(city, 'setOwnGround', 'city.setOwnGround');
const hose = await firehose('firehose', START[0], START[1], 40, 0, 0.32);
report.prof = Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, { n: v.length, median: med(v), max: max(v), sum: +v.reduce((a, b) => a + b, 0).toFixed(1) }]));
await firehose('firehose250', 37.7735, -122.4395, 60, 250, 0.25);

// ---- 4) the cooldown runs out: ready again, chime
{
  const w = hose;
  const left = w.sup.cooldownLeft;
  const marks: any[] = [];
  for (const at of [0, 30, 59, 60]) {
    w.sup.qaSkip(Math.max(0, at - (S.superCooldown - w.sup.cooldownLeft)));
    w.frame(dt, idle);
    marks.push({ at, phase: w.sup.phase, left: +w.sup.cooldownLeft.toFixed(2), chimes: w.counts['a.superReady'] ?? 0 });
  }
  report.cooldown = { startedWith: +left.toFixed(1), marks };
}

save('super', report);
const { firehose: fh, firehose250: fh2, ...rest } = report;
console.log(JSON.stringify(rest.prof, null, 1));
const brief = (o: any) => { const { path, ...r } = o; return r; };
console.log('firehose', JSON.stringify(brief(fh), null, 1));
console.log('firehose path', JSON.stringify(fh.path));
console.log('firehose250', JSON.stringify(brief(fh2), null, 1));
console.log('firehose250 path', JSON.stringify(fh2.path));
