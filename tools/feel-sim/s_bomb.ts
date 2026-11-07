// The Bomb's landing on the real city (src/game/Bomb.ts, Splatter.barf's jump; docs/specs/shots/SHOTS.md, "The modes"): a Bomb II and a Bomb III from the
// roofs, 150 m and 300 m over four places, each on fresh paint, through the real Splatter at 1/60 s. A building in its circle ends at min(3, before + jump),
// one stage a pop, each its own write config.bomb.stageGap s after the last; none past 3; the cap leaves nothing in reach out over dense housing (blastCap);
// a circle over config.bomb.rimOver has its ground drawn ahead of its wave (the wave never meets a texel not drawn yet) and all of it by when the wave reaches
// the rim (groundDeadline); and no frame passes 8 ms, the Splatter's and the ground's slice and its upload as the page's city.update runs them, after three
// taps and a Bomb have warmed its paths (the hint comes after three taps), and leaving out a frame Node's garbage collector ran in, which a row says apart
// (gcFrames, gcWorstMs), as it says its worst frame's parts: the game's, the ground's slice, its upload. Node's streaming is instant and its clock isn't a
// phone's: the milliseconds say where the cost is, not an A15, nor a first Bomb's cold code on one.
// The Lift isn't in Node (Lift.aloft is a world/Lift.ts question, checked by tools/factions/lift-check.mjs): "nothing lifted under ?lift" is the page's.
//   node tools/feel-sim/run.mjs s_bomb.ts
import { newCity, pump, ll, makeGame, save, MODE, config, fakeRenderer, type Game } from './lib';
import { blastCap, blastRadiusFor, groundDeadline } from '@src/game/blastLayout';
import { globals } from '@src/render/materials';
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
save('bomb', rows);
console.log(fails.length ? `[${MODE}] FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `[${MODE}] bomb checks: all ${checks} passed (${rows.length} rows)`);
process.exit(fails.length ? 1 : 0);
