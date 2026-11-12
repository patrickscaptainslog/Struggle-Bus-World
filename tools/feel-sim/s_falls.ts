// The Waterfall on the real city (src/fx/Falls.ts, src/world/falls.ts, &falls; docs/specs/shots/BUILT.md, "The extras"): taps through the real Splatter on 20
// towers over 40 m and 20 buildings under it within a kilometre of the Financial District's middle, at 1/60 s. Each tower hit on its roof pours once (a
// slot of the runs at its impact's height and time, its drops, one per 1.25 m of fall up to 160, and its pool as the fastest runs reach the street: the
// tower's hue on the ground round its foot, life told of it with kind 'falls'); none under 40 m pours; a tower hit again pours no more; and none pours from a
// face struck under 40 m up, a drive-by's blast (Curb's side), a breath at a mover on the street or in the air, or a hose's impact. The drops land as main.ts
// lands them (landingY: the roof under the point, or the ground): each lets go out from a wall of the tower standing at its height, in none of its parts
// there, and lands under where it let go (the review: a third flew up onto the tower's own roof). The pool keeps the footprint's shape (its walls by angle)
// and spreads from them: on fresh ground a texel 1.5 m out from a wall shows within 0.6 s of the landing (0.25 s at 6 m/s, and a texel's own reach), one
// 8.5 m out 1.2 s or more after it, where the circle round the farthest corner had half its open ground show at once (the review).
// Last, at 30 fps, the floor's (the Lob review's m90): a Bomb III from 600 m onto a tower whose roof is 40-60 m up pours, and its pool's ground waits for the
// wide ground's own due: nothing of the circle left for begin to draw in one frame.
//   node tools/feel-sim/run.mjs s_falls.ts
import { newCity, pump, ll, save, MODE, config, type BuildingRef } from './lib';
import { Splatter, type Blast } from '@src/game/Splat';
import { Falls, fallsTune, footLut } from '@src/fx/Falls';
import { SHAPE_LUT } from '@src/game/blastLayout';
import { GROUND_N } from '@src/world/groundMask';
import { FALLS, fallsLast, fallTime } from '@src/world/falls';
import { globals } from '@src/render/materials';
import { blastRadiusFor } from '@src/game/blastLayout';
import { blastUniforms } from '@src/world/GroundPaint';

const city = await newCity();
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const okAll = ok;
const r1 = (x: number) => Math.round(x * 10) / 10;
const counting = { properties: { get: () => ({}) }, getContext: () => ({ texSubImage2D() {} }), state: { activeTexture() {}, bindTexture() {}, pixelStorei() {} } } as any;
const [cx, cz] = ll(37.7946, -122.3999);
await pump(city, cx, cz, 200);
let t = 0;
const pools: Array<{ x: number; z: number; r: number; hue: number; kind: string; arrive: number }> = [];
/** each drop as it's flung: where it let go and where it lands (main.ts's landingY) */
const flung: Array<{ fx: number; fy: number; fz: number; ty: number }> = [];
const fakeParticles = { fling: (from: any, to: any) => flung.push({ fx: from.x, fy: from.y, fz: from.z, ty: to.y - 0.15 }), splash: () => {} } as any;
const fallsHooks = {
  landing: (x: number, z: number, fromY: number) => city.roofAt(x, z, fromY) ?? city.groundAt(x, z),
  pool: (x: number, _y: number, z: number, r: number, hue: number, tag: { kind: string }, arrive: number) => pools.push({ x, z, r, hue, kind: tag.kind, arrive }),
  trickle: () => {},
  plop: () => {},
  slap: () => {},
};
const falls = new Falls(city, fakeParticles, fallsHooks);
falls.on = true;
let last: Blast | null = null;
const splatter = new Splatter(city, {
  geyser: () => {},
  impact: (b: Blast) => { last = b; falls.impact(b, t); },
  bloom: () => {},
  primary: () => {},
  hitStop: () => {},
} as any);
const run = (secs: number) => {
  for (let i = 0; i < Math.round(secs * 60); i++) {
    t += 1 / 60;
    splatter.update(1 / 60);
    falls.update(t);
    globals.uTime.value = t;
    city.ground.work();
    city.ground.flush(counting, 1 / 60);
  }
};
const all = city.buildingsWithin(cx, cz, 1000, []).map((n) => n.ref).filter((r) => r.stableId >= 0 && r.roofY - r.baseY >= config.splat.minTargetHeight);
// (a tower whose roof at its middle is over 40 m up: a tap there lands on it, not on a podium beside it)
const tall = all.filter((r) => r.roofY - r.baseY > FALLS.tall + 2 && city.roofAtPart(r, r.cx, r.cz, Infinity) - r.baseY > FALLS.up + 2);
const short = all.filter((r) => r.roofY - r.baseY < FALLS.tall - 2);
// (spread out: every other one by distance from the middle, so no two share a blast)
const pick = (list: BuildingRef[], n: number, skip = new Set<number>()) => {
  const out: BuildingRef[] = [];
  for (const r of list) {
    if (out.length >= n) break;
    if (skip.has(r.index) || out.some((o) => Math.hypot(o.cx - r.cx, o.cz - r.cz) < 2.2 * config.splat.blastRadius)) continue;
    out.push(r);
  }
  return out;
};
const towers = pick(tall, 20), houses = pick(short, 20);
const used = new Set([...towers, ...houses].map((r) => r.index));
const spare = pick(tall, 40, used).filter((r) => !towers.includes(r));
console.log(`towers over ${FALLS.tall} m within 1 km: ${tall.length}; under: ${short.length}; picked ${towers.length} and ${houses.length}, ${spare.length} spare`);
ok(towers.length === 20 && houses.length === 20 && spare.length >= 5, `20 towers, 20 under 40 m and 5 spare picked (${towers.length}, ${houses.length}, ${spare.length})`);
const rows: unknown[] = [];
/** point-in-ring for record k of a building tile, and a point's distance to a segment (m), as City's */
const ringContainsAt = (b: any, k: number, x: number, z: number) => {
  let inside = false;
  for (let i = b.vertStart[k], j = b.vertStart[k + 1] - 1; i < b.vertStart[k + 1]; j = i++) {
    const xi = b.xz[i * 2], zi = b.xz[i * 2 + 1], xj = b.xz[j * 2], zj = b.xz[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const segDist = (ax: number, az: number, bx: number, bz: number, x: number, z: number) => {
  const ex = bx - ax, ez = bz - az, L = ex * ex + ez * ez, u = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L)) : 0;
  return Math.hypot(ax + ex * u - x, az + ez * u - z);
};
/** A tap on `ref`'s roof (or what opts say), and the 3 s after it: did it pour? */
async function hit(ref: BuildingRef, label: string, opts: Record<string, unknown> = {}) {
  // (its tiles in, as round the bus on the page)
  await pump(city, ref.cx, ref.cz, 150);
  city.paint.resetAll();
  const p0 = falls.stats.pours, d0 = falls.stats.drops, n0 = pools.length, f0 = flung.length, l0 = falls.stats.dropsLeft;
  splatter.barf(ref.cx, ref.cz, { target: ref, drop: 120, hitStop: 0, ...opts });
  const tHit = t + config.splat.impactDelay;
  run(config.splat.impactDelay + 0.02);
  const b = last as Blast | null;
  const poured = falls.stats.pours > p0;
  const slot = fallsLast.find((s) => s.index === ref.index && Math.abs(s.t0 - t) < 0.1);
  const fall = b ? Math.min(b.pos.y, ref.roofY) - city.groundAt(ref.cx, ref.cz) : 0;
  run(Math.max(0.3, fallTime(fall)) + 0.6);
  const rec = city.paint.get(ref.index);
  // (the pool's ground: round the foot, 4 m out past its walls, where nothing stands)
  const foot = footLut(ref);
  let wet = 0, dry = 0;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, d = foot[(i * SHAPE_LUT) / 16] + 4, x = ref.cx + Math.cos(a) * d, z = ref.cz + Math.sin(a) * d;
    const s = city.ground.sample(x, z);
    if (s && s.cov >= 0.5 && s.hue === rec.color) wet++;
    else dry++;
  }
  // (its drops: each let go out from a wall standing at its height, in none of the tower's parts there, and landed under it)
  const tb = ref.tile;
  let inside = 0, far = 0, up = 0;
  for (const d of flung.slice(f0)) {
    let near = Infinity, inPart = false;
    for (let k = ref.local; k < ref.local + ref.parts; k++) {
      if (tb.baseY[k] > d.fy || tb.roofY[k] <= d.fy) continue;
      if (ringContainsAt(tb, k, d.fx, d.fz)) inPart = true;
      for (let i = tb.vertStart[k], j = tb.vertStart[k + 1] - 1; i < tb.vertStart[k + 1]; j = i++) near = Math.min(near, segDist(tb.xz[j * 2], tb.xz[j * 2 + 1], tb.xz[i * 2], tb.xz[i * 2 + 1], d.fx, d.fz));
    }
    if (inPart) inside++;
    if (near > fallsTune.dropOut + 0.2) far++;
    if (d.ty >= d.fy - 1) up++;
  }
  const row = { label, index: ref.index, flung: flung.length - f0, left: falls.stats.dropsLeft - l0, inside, far, up, h: r1(ref.roofY - ref.baseY), at: b ? r1(b.pos.y - ref.baseY) : null, poured, slot: !!slot, drops: falls.stats.drops - d0, want: Math.min(fallsTune.drops, Math.floor(fall / fallsTune.dropEvery)), pool: pools.length > n0 ? pools[pools.length - 1] : null, wet, dry, tHit: r1(tHit) };
  rows.push(row);
  return row;
}
for (const r of towers) {
  const w = await hit(r, 'tower');
  ok(w.poured && w.slot, `tower ${r.index} (${w.h} m, hit ${w.at} m up): it pours, in a slot at its impact`);
  ok(w.drops === w.want && w.drops > 0, `tower ${r.index}: ${w.want} drops (${w.drops})`);
  ok(w.flung + w.left === w.drops && w.left <= 0.1 * w.drops, `tower ${r.index}: every drop flung or left out, a tenth left at most (${w.flung} flung, ${w.left} left)`);
  ok(w.inside === 0 && w.far === 0, `tower ${r.index}: every drop let go ${fallsTune.dropOut} m out from a wall at its height, in none of its parts (${w.inside} inside, ${w.far} farther out)`);
  ok(w.up === 0, `tower ${r.index}: every drop lands under where it let go, as main.ts lands it (${w.up} at or over its start)`);
  ok(!!w.pool && w.pool.kind === 'falls' && Math.abs(w.pool.r - (r.rad + fallsTune.pool)) < 0.5, `tower ${r.index}: its pool, kind 'falls', ${r1(r.rad + fallsTune.pool)} m (${JSON.stringify(w.pool)})`);
  ok(w.wet >= 8, `tower ${r.index}: its pool's ground in its hue round its foot (${w.wet} of 16)`);
  const again = await hit(r, 'tower again');
  ok(!again.poured, `tower ${r.index}: hit again, no second pour`);
}
for (const r of houses) {
  const w = await hit(r, 'under 40 m');
  ok(!w.poured && !w.pool, `building ${r.index} (${w.h} m): no pour`);
}
// what never pours, each on a fresh tower
const [low, drive, mover, air, hose] = spare;
{
  const w = await hit(low, 'a face 20 m up', { exact: true, y: low.baseY + 20, x: low.cx });
  ok(!w.poured, `tower ${low.index}: struck ${w.at} m up its face, no pour`);
  const d = await hit(drive, 'drive-by', { side: { x: drive.cx, z: drive.cz - 30, nx: 0, nz: 1 } });
  ok(!d.poured, `tower ${drive.index}: a drive-by's blast, no pour`);
  const m = await hit(mover, 'a mover on the street', { target: null, exact: true, y: city.groundAt(mover.cx, mover.cz + mover.rad + 6) + 1, moverBlock: true });
  ok(!m.poured, `tower ${mover.index}: a breath at a car beside it, no pour`);
  const a = await hit(air, 'a mover in the air', { mover: { x: air.cx, y: air.roofY + 30, z: air.cz } });
  ok(!a.poured, `tower ${air.index}: a breath at a plane over it, no pour`);
  const h = await hit(hose, 'a hose', { hose: true, radius: 40 });
  ok(!h.poured, `tower ${hose.index}: a hose's impact, no pour`);
}
// the pool on fresh ground: a pour on each of five towers with no paint round it, its reveal read from the ground's mask (seconds after the landing, to
// 2.55) 1.5 and 8.5 m out from its walls along 16 angles
{
  const G = city.ground as any;
  const reveal = (x: number, z: number): number | null => {
    const m = G.masks.get(`${Math.floor(x / G.tileSize)},${Math.floor(z / G.tileSize)}`);
    if (!m) return null;
    const i = Math.min(GROUND_N - 1, Math.max(0, Math.floor((x - m.ox) / G.cell))), j = Math.min(GROUND_N - 1, Math.max(0, Math.floor((z - m.oz) / G.cell)));
    const o = (j * GROUND_N + i) * 4;
    return m.data[o] >= 128 ? m.data[o + 2] / 100 : null;
  };
  for (const ref of spare.slice(5, 10)) {
    await pump(city, ref.cx, ref.cz, 150);
    city.paint.resetAll();
    city.ground.resetAll();
    // (resetAll forgets the saved paint, not the loaded tiles' masks: the taps above left paint here, and a pool over paint changes its hue at the landing)
    for (const m of G.masks.values()) m.data.fill(0);
    const fresh = new Falls(city, null, fallsHooks);
    fresh.on = true;
    fresh.impact({ primary: ref, pos: { y: ref.roofY }, super: null } as any, t);
    for (let i = 0; i < 240; i++) {
      t += 1 / 60;
      fresh.update(t);
      globals.uTime.value = t;
      city.ground.work();
      city.ground.flush(counting, 1 / 60);
    }
    const foot = footLut(ref);
    const nearR: number[] = [], farR: number[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, w = foot[(k * SHAPE_LUT) / 16];
      for (const [d, list] of [[1.5, nearR], [8.5, farR]] as const) {
        const x = ref.cx + Math.cos(a) * (w + d), z = ref.cz + Math.sin(a) * (w + d);
        // (only open ground: another building's footprint there is no pool's)
        if (city.buildingAt(x, z)) continue;
        const rv = reveal(x, z);
        if (rv !== null) list.push(rv);
      }
    }
    const nearMax = Math.max(...nearR), farMin = Math.min(...farR);
    rows.push({ label: 'pool on fresh ground', index: ref.index, near: nearR, far: farR });
    ok(nearR.length >= 6 && farR.length >= 3, `tower ${ref.index}: its pool on the open ground round it, 1.5 and 8.5 m out from its walls (${nearR.length} and ${farR.length} of 16)`);
    ok(nearMax <= 0.6 && farMin >= 1.2, `tower ${ref.index}: its pool spreads out from its walls (1.5 m out by ${r1(nearMax)} s, 8.5 m out from ${r1(farMin)} s after it lands)`);
  }
}
// the reviews of the Sonic Boom pass and of feat/extras (BUILT.md, "The reviews of the Sonic Boom pass and of feat/extras, and what they came to"), each on
// towers no row above has struck
{
  // (each row's verdict printed, for BUILT.md's numbers)
  const ok = (c: boolean, m: string) => {
    okAll(c, m);
    console.log(`${c ? 'ok' : 'FAIL'}: ${m}`);
  };
  // (the Splatter's clock brought up to the page's: the rows on fresh ground above ran the game's clock alone, and on the page they're one)
  (splatter as any).t = t;
  const taken = new Set([...used, ...spare.map((r) => r.index)]);
  // (the tallest first: its coat floods longest)
  const fresh = pick(tall.filter((r) => r.roofY - r.baseY > 100), 12, taken).sort((a, b) => b.roofY - b.baseY - (a.roofY - a.baseY));
  const houses2 = pick(short, 8, new Set([...taken, ...fresh.map((r) => r.index)]));
  ok(fresh.length >= 9 && houses2.length >= 4, `the review rows' towers over 100 m and houses (${fresh.length}, ${houses2.length})`);
  const front = (ref: BuildingRef) => {
    const rec = city.paint.get(ref.index), held = fallsLast.some((s) => s.index === ref.index);
    return Math.min(ref.roofY - ref.baseY, config.bloom.floodSpeed * Math.max(0, t - rec.bloomTime - (held ? FALLS.hold : 0)));
  };
  // a fifth tower struck while four run takes the slot of the one drying soonest: that tower's coat floods on as it was, where it jumped FALLS.hold of the
  // flood's 55 m/s (27 m) down its walls in a frame, the building program's hold gone with the slot (the Sonic Boom pass's review, 9)
  if (fresh.length >= 9) {
    await pump(city, fresh[0].cx, fresh[0].cz, 150);
    city.paint.resetAll();
    // (the rows above's slots dry and given back first: the fifth's is then the first of these)
    run(FALLS.dry * 1.3 + 4);
    const A = fresh[0];
    let last = 0, jump = 0, atSteal = -1, steps = 0, was = false;
    const p0 = falls.stats.pours;
    for (let k = 0; k < 8; k++) {
      // (taps 0.2 s apart on seven towers, until one takes the first's slot, and a second on for the last to land)
      if (k < 7 && atSteal < 0) splatter.barf(fresh[k].cx, fresh[k].cz, { target: fresh[k], drop: 120, hitStop: 0 });
      for (let i = 0; i < (k < 7 ? 12 : 60); i++) {
        run(1 / 60);
        const fr = front(A), held = fallsLast.some((s) => s.index === A.index);
        if (steps++ > 0) jump = Math.max(jump, fr - last - config.bloom.floodSpeed / 60);
        if (held) was = true;
        else if (was && atSteal < 0) atSteal = fr;
        last = fr;
      }
    }
    run(1);
    ok(atSteal >= 0 && atSteal < A.roofY - A.baseY - 30 && jump < 1, `a fifth tower takes the slot of a ${r1(A.roofY - A.baseY)} m one still flooding (${r1(atSteal)} m down its walls then, ${falls.stats.pours - p0} pours): its coat floods on, ${r1(jump)} m past the flood in a frame at most`);
  }
  // m71: a free slot isn't set again every frame
  {
    run(FALLS.dry * 1.3 + 4);
    const free = fallsLast.findIndex((s) => s.index < 0);
    if (free >= 0) fallsLast[free].t0 = 12345;
    run(0.1);
    ok(free >= 0 && fallsLast[free].t0 === 12345, `a free slot left alone frame to frame (slot ${free}: ${free >= 0 ? fallsLast[free].t0 : 'none free'})`);
  }
  // M71: a Bomb III that pours, its wide ground spread over its deadline, not finished in the frame it lands by the pool's begin (GroundPaint.begin draws
  // every wide job still drawing whole first); and the pool after it, in the tower's hue round its foot
  if (fresh.length >= 9) {
    const B = fresh[7];
    await pump(city, B.cx, B.cz, 150);
    city.paint.resetAll();
    const Q = city.ground.wideQa, r = blastRadiusFor(60) * config.bomb.radius3;
    Q.due = 0;
    Q.done = 0;
    const p0 = falls.stats.pours, n0 = pools.length;
    const tImpact = splatter.barf(B.cx, B.cz, { target: B, drop: 60, radius: r, super: { kind: 'bomb', charge: 1, id: 7 }, hitStop: 0, jump: config.bomb.jump3 });
    run(4);
    const pool = pools.length > n0 ? pools[pools.length - 1] : null, rec = city.paint.get(B.index), foot = footLut(B);
    let wet = 0;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, d = foot[(i * SHAPE_LUT) / 16] + 4, s = city.ground.sample(B.cx + Math.cos(a) * d, B.cz + Math.sin(a) * d);
      if (s && s.cov >= 0.5 && s.hue === rec.color) wet++;
    }
    ok(falls.stats.pours > p0 && Q.due > tImpact && Q.done >= tImpact + 3 / 60 && !!pool && pool.arrive >= Q.done - 1e-6 && wet >= 8, `a Bomb III pours on a ${r1(B.roofY - B.baseY)} m tower: its wide ground spread from its landing at ${r1(tImpact)} s to ${r1(Q.done)} s (due ${r1(Q.due)}), the pool after it at ${pool && r1(pool.arrive)} s, ${wet} of 16 round its foot in its hue`);
  }
  // m70: the pool keeps its live slot for its reveal through four more blasts begun after its tower is struck
  if (fresh.length >= 9 && houses2.length >= 4) {
    const C = fresh[8];
    await pump(city, C.cx, C.cz, 150);
    city.paint.resetAll();
    splatter.barf(C.cx, C.cz, { target: C, drop: 120, hitStop: 0 });
    run(config.splat.impactDelay + 0.02);
    for (const h of houses2.slice(0, 4)) {
      splatter.barf(h.cx, h.cz, { target: h, drop: 120, hitStop: 0 });
      run(0.1);
    }
    let job: { serial: number | null } | null = null, land = Infinity;
    const runs = (falls as any).runs as Array<{ ref: BuildingRef; pool: { serial: number | null } | null; land: number }>;
    for (let i = 0; i < 240 && !(t > land + 1); i++) {
      const rr = runs.find((x) => x.ref === C);
      if (rr?.pool) {
        job = rr.pool;
        land = rr.land;
      }
      run(1 / 60);
    }
    const L1 = blastUniforms.uGroundLive.value, L2 = blastUniforms.uGroundLive2.value, ser = job?.serial ?? -1;
    ok(!!job && t > land + 1 && [L1.x, L1.z, L2.x, L2.z].includes(ser), `the pool on a ${r1(C.roofY - C.baseY)} m tower after four more blasts: its live slot held a second past its landing for its reveal (serial ${ser}, slots ${[L1.x, L1.z, L2.x, L2.z].join(', ')})`);
  }
  // the Lob review's m90: a Bomb III from 600 m onto a tower whose roof is 40-60 m up, the runs reaching the street 1.6 s or so after it lands and its wide
  // ground due 2.3 s after: the pool waits for that due, where 1.2 s past the street it began, and begin drew the rest of the circle whole in that frame.
  // What the wide job had left to draw when the pool's ground began (GroundPaint's own count, its texels and 4 a dot) must be nothing. At 30 fps, the floor's:
  // at 60 the queue's 1,500 texels a frame drew it all 0.6 s before its due, and before the pool
  {
    const D = tall.find((r) => r.roofY - r.baseY <= 60 && !taken.has(r.index) && !fresh.includes(r));
    if (D) {
      await pump(city, D.cx, D.cz, 600);
      city.paint.resetAll();
      run(FALLS.dry * 1.3 + 4);
      const Q = city.ground.wideQa, h = D.roofY - city.groundAt(D.cx, D.cz), drop = 600 - h, r = blastRadiusFor(drop) * config.bomb.radius3;
      Q.due = 0;
      Q.done = 0;
      const p0 = falls.stats.pours, n0 = pools.length;
      const tImpact = splatter.barf(D.cx, D.cz, { target: D, drop, radius: r, super: { kind: 'bomb', charge: 1, id: 8 }, hitStop: 0, jump: config.bomb.jump3 });
      const G = city.ground as any, begin0 = G.begin;
      let left = -1, at = -1;
      G.begin = function (spec: unknown, tImp: number, deadline = 0) {
        if (deadline === 0 && left < 0) {
          left = 0;
          at = t;
          for (const j of G.jobs) if (j.wide) left += j.p ? G.left(j) : Infinity;
        }
        return begin0.call(this, spec, tImp, deadline);
      };
      for (let i = 0; i < 150; i++) {
        t += 1 / 30;
        splatter.update(1 / 30);
        falls.update(t);
        globals.uTime.value = t;
        city.ground.work();
        city.ground.flush(counting, 1 / 30);
      }
      G.begin = begin0;
      const pool = pools.length > n0 ? pools[pools.length - 1] : null;
      ok(falls.stats.pours > p0 && Q.due > tImpact + 2 && left === 0 && !!pool && pool.arrive >= Q.done - 1e-6, `a Bomb III from 600 m pours on a tower ${r1(h)} m up: its wide ground (${r1(r)} m) left to draw when the pool's began at ${r1(at)} s: ${left}; landing at ${r1(tImpact)} s, all down at ${r1(Q.done)} s (due ${r1(Q.due)}), the pool after it at ${pool && r1(pool.arrive)} s`);
    } else ok(false, 'a tower whose roof is 40-60 m up for the 600 m Bomb');
  }
}
save('falls', rows);
console.log(fails.length ? `[${MODE}] FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `[${MODE}] falls checks: all ${checks} passed (${rows.length} rows)`);
process.exit(fails.length ? 1 : 0);
