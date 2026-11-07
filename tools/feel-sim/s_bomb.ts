// The Bomb's landing on the real city (src/game/Bomb.ts, Splatter.barf's jump; docs/specs/shots/SHOTS.md, "The modes"): a Bomb II and a Bomb III from the
// roofs, 150 m and 300 m over four places, each on fresh paint, through the real Splatter at 1/60 s. A building in its circle ends at min(3, before + jump),
// one stage a pop, each its own write config.bomb.stageGap s after the last; none past 3; the cap leaves nothing in reach out over dense housing (blastCap);
// a circle over config.bomb.rimOver has its ground drawn ahead of its wave (the wave never meets a texel not drawn yet) and all of it by when the wave reaches
// the rim (groundDeadline); and no frame passes 8 ms, the Splatter's and the ground's slice and its upload as the page's city.update runs them, after three
// taps and a Bomb have warmed its paths (the hint comes after three taps), and leaving out a frame Node's garbage collector ran in, which a row says apart
// (gcFrames, gcWorstMs), as it says its worst frame's parts: the game's, the ground's slice, its upload. Node's streaming is instant and its clock isn't a
// phone's: the milliseconds say where the cost is, not an A15, nor a first Bomb's cold code on one.
// Then ?lift: with the Splatter's Lift answering as the page's would (LiftHooks: every house in reach would lift if a blast asked, ten of them up already), a
// Bomb III from 300 m over each place asks none to lift and starts none, and the ten up are out of it, while a tap there asks and lifts (the control). The
// Lift itself, its motion and Lift.aloft's own answer, is tools/factions/lift-check.mjs's and the page's.
// Then the Moon (src/moon/CraterPaint.ts): six named craters on a Moon page with nothing round them (as tools/factions/owner-check.mjs makes one), each hit
// on its middle: a tap a level and MEGA two, as before; a Bomb II two levels and a Bomb III three, from 0 and from 2, all with its wave, never past 3.
//   node tools/feel-sim/run.mjs s_bomb.ts
import { newCity, pump, ll, makeGame, save, MODE, config, fakeRenderer, type Game } from './lib';
import { blastCap, blastRadiusFor, groundDeadline } from '@src/game/blastLayout';
import { globals } from '@src/render/materials';
import type { LiftHooks } from '@src/world/liftGlsl';
import { PerformanceObserver } from 'node:perf_hooks';

// (Node's collector, when and how long: a frame it ran in is said apart, not counted)
const gcs: Array<[number, number]> = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) gcs.push([e.startTime, e.startTime + e.duration]); }).observe({ entryTypes: ['gc'] });
const settle = () => new Promise((r) => setImmediate(r));

const city = await newCity();
const PLACES: Array<[string, number, number]> = [['alamo', 37.7762, -122.4346], ['sunset', 37.755, -122.49], ['mission', 37.7599, -122.4148], ['noe', 37.7502, -122.4337]];
const HEIGHTS = [0, 150, 300];
const rows: unknown[] = [];
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
// (a frame as the page's: the game's, then the city's ground slice and its upload, City.update; its milliseconds)
const parts = [0, 0, 0];
const frame = (g: Game) => {
  const t0 = performance.now();
  g.frame(1 / 60, { sx: 0, sy: 0, dragging: false });
  const t1 = performance.now();
  globals.uTime.value = g.t;
  city.ground.work();
  const t2 = performance.now();
  city.ground.flush(fakeRenderer, 1 / 60);
  const t3 = performance.now();
  parts[0] = t1 - t0;
  parts[1] = t2 - t1;
  parts[2] = t3 - t2;
  return t3 - t0;
};
{
  // (three taps first, unmeasured: the hint teaches the Bomb after three)
  const [x, z] = ll(PLACES[0][1], PLACES[0][2]);
  await pump(city, x, z);
  const g = makeGame(city);
  for (let k = 0; k < 3; k++) {
    g.splatter.barf(x + 60 * k, z, { drop: 40, radius: blastRadiusFor(40), hitStop: 0 });
    for (let i = 0; i < 60; i++) frame(g);
  }
  g.splatter.barf(x, z, { drop: 320, radius: blastRadiusFor(320) * config.bomb.radius3, super: { kind: 'bomb', charge: 1, id: 1 }, hitStop: 0, jump: config.bomb.jump3 });
  for (let i = 0; i < 60 * 3; i++) frame(g);
  city.paint.resetAll();
}
/** One Bomb on fresh paint through 5 s of frames: its blooms by building, and its frames' worst but the collector's. */
async function bomb(x: number, z: number, drop: number, r: number, jump: number, tier: number, ground: number) {
  city.paint.resetAll();
  const g = makeGame(city);
  const blooms = new Map<number, number[]>();
  (g as any).onBloom = (ref: { index: number }, _hue: number, level: number) => { const a = blooms.get(ref.index) ?? []; a.push(+g.t.toFixed(3), level); blooms.set(ref.index, a); };
  city.ground.wideQa.late = 0;
  const tImpact = g.splatter.barf(x, z, { drop, radius: r, super: { kind: 'bomb', charge: tier === 3 ? 1 : 0.5, id: 1 }, hitStop: 0, jump, from: ground + drop });
  const frames: Array<{ a: number; b: number; ms: number; at: number; parts: number[] }> = [];
  let impactMs = 0;
  for (let i = 0; i < 60 * 5; i++) {
    const a = performance.now();
    const ms = frame(g);
    frames.push({ a, b: a + ms, ms, at: g.t - tImpact, parts: parts.map((v) => +v.toFixed(2)) });
    // (the frame the blast lands in: the first at or past its impact)
    if (!impactMs && g.t >= tImpact - 1e-9) impactMs = ms;
  }
  await settle();
  await settle();
  const time = { worst: 0, worstAt: 0, worstParts: [0, 0, 0], impactMs, gcFrames: 0, gcWorst: 0 };
  for (const f of frames) {
    if (gcs.some(([a, b]) => a < f.b && b > f.a)) {
      time.gcFrames++;
      time.gcWorst = Math.max(time.gcWorst, f.ms);
    } else if (f.ms > time.worst) {
      time.worst = f.ms;
      time.worstAt = f.at;
      time.worstParts = f.parts;
    }
  }
  const qa = city.ground.wideQa;
  return { g, tImpact, blooms, time, late: qa.late, done: qa.done };
}

for (const [name, lat, lon] of PLACES) {
  const [x, z] = ll(lat, lon);
  await pump(city, x, z);
  for (const up of HEIGHTS)
    for (const tier of [2, 3]) {
      const ground = city.groundAt(x, z);
      const roof = city.roofAt(x, z, Infinity) ?? ground;
      const drop = Math.max(20, roof - ground + 18) + up;
      const r = blastRadiusFor(drop) * (tier === 3 ? config.bomb.radius3 : config.bomb.radius2);
      const jump = tier === 3 ? config.bomb.jump3 : config.bomb.jump2;
      // (what's in reach before: its buildings and their levels)
      city.paint.resetAll();
      const before = new Map<number, number>();
      for (const n of city.buildingsWithin(x, z, r + config.splat.smallRad, [])) before.set(n.ref.index, city.paint.level(n.ref.index));
      const { g, tImpact, blooms, time, late, done } = await bomb(x, z, drop, r, jump, tier, ground);
      const deadline = groundDeadline(r);
      // (a row with a frame over 8 ms is flown once more, on fresh paint, and passes if that one's under: the laptop is shared, and its noise only adds)
      const again = time.worst > 8 ? (await bomb(x, z, drop, r, jump, tier, ground)).time : null;
      const { worst, worstAt, worstParts, impactMs, gcFrames, gcWorst } = again && again.worst < time.worst ? again : time;
      let wrong = 0, past3 = 0, gaps = 0, badGap = 0, painted = 0;
      for (const [i, a] of blooms) {
        painted++;
        const lv = city.paint.level(i), was = Math.round(before.get(i) ?? 0);
        if (Math.round(lv) !== Math.min(3, was + jump)) wrong++;
        if (lv > 3.01) past3++;
        for (let k = 2; k < a.length; k += 2) {
          gaps++;
          if (Math.abs(a[k] - a[k - 2] - config.bomb.stageGap) > 0.02) badGap++;
        }
      }
      const cap = blastCap(r, config.bomb.cap);
      const row = {
        place: name, up, tier, drop: Math.round(drop), r: Math.round(r), inReach: before.size, painted, cap, wrong, past3, gaps, badGap, stagesLeft: g.splatter.stagesLeft,
        groundDue: +deadline.toFixed(3), groundDone: deadline > 0 ? +(done - tImpact).toFixed(3) : null, late, queued: city.ground.queued,
        worstMs: +worst.toFixed(2), worstAt: +worstAt.toFixed(3), worstParts, impactMs: +impactMs.toFixed(2), gcFrames, gcWorstMs: +gcWorst.toFixed(2),
        firstMs: again ? +time.worst.toFixed(2) : undefined, againMs: again ? +again.worst.toFixed(2) : undefined,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
      const tag = `${name} ${up} m, Bomb ${tier === 3 ? 'III' : 'II'}`;
      ok(painted > 0 && wrong === 0, `${tag}: every building at min(3, before + ${jump}) (${wrong} of ${painted} not)`);
      ok(past3 === 0, `${tag}: none past 3`);
      ok(badGap === 0 && gaps > 0 && g.splatter.stagesLeft === 0, `${tag}: stages ${config.bomb.stageGap} s apart (${badGap} of ${gaps} off)`);
      ok(painted < cap, `${tag}: the cap (${cap}) cut nothing in reach (${painted} painted, ${before.size} within r + smallRad)`);
      if (deadline > 0) {
        ok(late === 0, `${tag}: the wave never met ground not drawn yet (${late} rows or dots late)`);
        ok(done > 0 && done <= tImpact + deadline + 1 / 60 + 1e-6, `${tag}: its ground all down by ${deadline.toFixed(2)} s after the impact (${(done - tImpact).toFixed(3)})`);
      }
      ok(city.ground.queued === 0, `${tag}: the ground's queue empty after 5 s (${city.ground.queued})`);
      ok(worst <= 8, `${tag}: no frame over 8 ms but the collector's (${worst.toFixed(2)}, ${worstAt.toFixed(2)} s from the impact${again ? `, flown twice: ${time.worst.toFixed(2)} and ${again.worst.toFixed(2)}` : ''}; ${gcFrames} with the collector, at most ${gcWorst.toFixed(2)})`);
    }
}

// ---- ?lift
const asked = { wants: 0, aloft: 0, start: 0 };
const up = new Set<number>();
const spy: LiftHooks = {
  obstacle: (_x, _z, _y, baked) => baked, overhead: () => Infinity, surface: (_x, _z, _y, baked) => baked, dy: () => 0, dyAt: () => 0, reach: () => 0, over: () => false, noteTop: () => {},
  wants: () => (asked.wants++, 1), aloft: (ref) => (asked.aloft++, up.has(ref.index)), start: () => { asked.start++; },
};
const liftRows: unknown[] = [];
for (const [name, lat, lon] of PLACES) {
  const [x, z] = ll(lat, lon);
  await pump(city, x, z);
  const ground = city.groundAt(x, z);
  const roof = city.roofAt(x, z, Infinity) ?? ground;
  const drop = Math.max(20, roof - ground + 18) + 300;
  const r = blastRadiusFor(drop) * config.bomb.radius3;
  up.clear();
  for (const n of city.buildingsWithin(x, z, r * 0.6, [])) if (up.size < 10) up.add(n.ref.index);
  city.lift = spy;
  Object.assign(asked, { wants: 0, aloft: 0, start: 0 });
  const b = await bomb(x, z, drop, r, config.bomb.jump3, 3, ground);
  const bombAsked = { ...asked };
  const upHit = [...up].filter((i) => b.blooms.has(i)).length;
  // (the control: a tap at the same place, its own circle, every house it reaches asked)
  Object.assign(asked, { wants: 0, aloft: 0, start: 0 });
  city.paint.resetAll();
  const g = makeGame(city);
  g.splatter.barf(x, z, { drop, radius: blastRadiusFor(drop), hitStop: 0, from: ground + drop });
  for (let i = 0; i < 60 * 3; i++) frame(g);
  const tapAsked = { ...asked };
  city.lift = null;
  const row = { place: name, r: Math.round(r), up: up.size, upHit, painted: b.blooms.size, bomb: bombAsked, tap: tapAsked };
  liftRows.push(row);
  console.log(JSON.stringify(row));
  const tag = `?lift, ${name} 300 m, Bomb III`;
  ok(bombAsked.wants === 0 && bombAsked.start === 0 && b.blooms.size > 0, `${tag}: asks none to lift and lifts none (${bombAsked.wants} asked, ${bombAsked.start} started, ${b.blooms.size} painted)`);
  ok(bombAsked.aloft > 0 && upHit === 0, `${tag}: the ten up already are out of it (${upHit} of ${up.size} bloomed)`);
  ok(tapAsked.wants > 0 && tapAsked.start > 0, `?lift, ${name}: a tap there asks and lifts, so the Lift was asked as the page's (${tapAsked.wants} asked, ${tapAsked.start} started)`);
}
// ---- the Moon: the craters take the jumps (craters don't hop: the pogo is the street's houses')
const { CraterPaint } = await import('@src/moon/CraterPaint');
const { makeFrame } = await import('@src/moon/map');
const { makeBlastSpec } = await import('@src/game/blastLayout');
const moonRows: unknown[] = [];
{
  const places = [1, 2, 3, 4, 5, 6].map((f) => ({ id: f, name: `TEST ${f}`, type: 'crater', lat: -20 + f * 0.05, lon: 30, km: 10, az: null, d: [0, 0, 1], e: [1, 0, 0], n: [0, 1, 0], R: 400 }));
  const c = new CraterPaint({ renderer: {}, post() {}, frame: makeFrame(-20, 30), albedo: null, places, names: [], seed: 1, paintRocks() {} } as any);
  // [what hits it, the crater's level first (taps), a super, its jump, the level it ends at]
  const cases: Array<[string, number, boolean, number, number]> = [['a tap', 0, false, 1, 1], ['MEGA', 0, true, 1, 2], ['Bomb II from 0', 0, true, 2, 2], ['Bomb III from 0', 0, true, 3, 3], ['Bomb II from 2', 2, true, 2, 3], ['Bomb III from 2', 2, true, 3, 3]];
  cases.forEach(([name, from, sup, jump, want], i) => {
    const t: any = c.named.find((n: any) => n.id === `p${i + 1}`);
    const hit = (s: boolean, j: number, at: number) => c.impact({ spec: makeBlastSpec(t.x, t.z, 60, 0, 11 + i * 7 + at), pos: { x: t.x, y: 0, z: t.z }, t: at, count: 0, maxLevel: 1, strength: 1, dots: [], hose: false, mover: false, afloat: false, primary: null, super: s ? { kind: j > 1 ? 'bomb' : 'mega', charge: 1, id: i + 1 } : null, tag: t, comet: null, jump: j } as any);
    for (let k = 0; k < from; k++) hit(false, 1, 1 + 2 * k);
    const before = t.rec?.level ?? 0;
    hit(sup, jump, 10);
    const after = t.rec?.level ?? 0;
    moonRows.push({ name, before, after, want });
    ok(before === from && after === want, `the Moon, ${name}: its crater ${before} to ${after}, not past 3 (wanted ${from} to ${want})`);
  });
}
console.log('the Moon:', JSON.stringify(moonRows));
save('bomb', rows);
save('bomb-lift', liftRows);
save('bomb-moon', moonRows);
console.log(fails.length ? `[${MODE}] FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `[${MODE}] bomb checks: all ${checks} passed (${rows.length} rows)`);
process.exit(fails.length ? 1 : 0);
