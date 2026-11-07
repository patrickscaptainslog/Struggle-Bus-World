// The Bomb's landing on the real city (src/game/Bomb.ts, Splatter.barf's jump; docs/specs/shots/SHOTS.md, "The modes"): a Bomb II and a Bomb III from the
// roofs, 150 m and 300 m over four places, each on fresh paint, through the real Splatter at 1/60 s. A building in its circle ends at min(3, before + jump),
// one stage a pop, each its own write config.bomb.stageGap s after the last; none past 3; the cap leaves nothing in reach out over dense housing (blastCap);
// and no frame of the Splatter's passes 8 ms. Node's streaming is instant and its clock isn't a phone's: the milliseconds say where the cost is, not an A15.
// The Lift isn't in Node (Lift.aloft is a world/Lift.ts question, checked by tools/factions/lift-check.mjs): "nothing lifted under ?lift" is the page's.
//   node tools/feel-sim/run.mjs s_bomb.ts
import { newCity, pump, ll, makeGame, save, MODE, config } from './lib';
import { blastCap, blastRadiusFor } from '@src/game/blastLayout';

const city = await newCity();
const PLACES: Array<[string, number, number]> = [['alamo', 37.7762, -122.4346], ['sunset', 37.755, -122.49], ['mission', 37.7599, -122.4148], ['noe', 37.7502, -122.4337]];
const HEIGHTS = [0, 150, 300];
const rows: unknown[] = [];
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
for (const [name, lat, lon] of PLACES) {
  const [x, z] = ll(lat, lon);
  await pump(city, x, z);
  for (const up of HEIGHTS)
    for (const tier of [2, 3]) {
      city.paint.resetAll();
      const g = makeGame(city);
      const ground = city.groundAt(x, z);
      const roof = city.roofAt(x, z, Infinity) ?? ground;
      const drop = Math.max(20, roof - ground + 18) + up;
      const r = blastRadiusFor(drop) * (tier === 3 ? config.bomb.radius3 : config.bomb.radius2);
      const jump = tier === 3 ? config.bomb.jump3 : config.bomb.jump2;
      // (what's in reach before: its buildings and their levels)
      const before = new Map<number, number>();
      for (const n of city.buildingsWithin(x, z, r + config.splat.smallRad, [])) before.set(n.ref.index, city.paint.level(n.ref.index));
      const blooms = new Map<number, number[]>();
      (g as any).onBloom = (ref: { index: number }, _hue: number, level: number) => { const a = blooms.get(ref.index) ?? []; a.push(+g.t.toFixed(3), level); blooms.set(ref.index, a); };
      const tImpact = g.splatter.barf(x, z, { drop, radius: r, super: { kind: 'bomb', charge: tier === 3 ? 1 : 0.5, id: 1 }, hitStop: 0, jump, from: ground + drop });
      let worst = 0, impactMs = 0;
      for (let i = 0; i < 60 * 5; i++) {
        const t0 = performance.now();
        g.frame(1 / 60, { sx: 0, sy: 0, dragging: false });
        const ms = performance.now() - t0;
        if (Math.abs(g.t - tImpact) < 1 / 120) impactMs = ms;
        worst = Math.max(worst, ms);
      }
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
      const row = { place: name, up, tier, drop: Math.round(drop), r: Math.round(r), inReach: before.size, painted, cap, wrong, past3, gaps, badGap, stagesLeft: g.splatter.stagesLeft, worstMs: +worst.toFixed(2), impactMs: +impactMs.toFixed(2) };
      rows.push(row);
      console.log(JSON.stringify(row));
      const tag = `${name} ${up} m, Bomb ${tier === 3 ? 'III' : 'II'}`;
      ok(painted > 0 && wrong === 0, `${tag}: every building at min(3, before + ${jump}) (${wrong} of ${painted} not)`);
      ok(past3 === 0, `${tag}: none past 3`);
      ok(badGap === 0 && gaps > 0 && g.splatter.stagesLeft === 0, `${tag}: stages ${config.bomb.stageGap} s apart (${badGap} of ${gaps} off)`);
      ok(painted < cap, `${tag}: the cap (${cap}) cut nothing in reach (${painted} painted, ${before.size} within r + smallRad)`);
      ok(worst <= 8, `${tag}: no frame over 8 ms (${worst.toFixed(2)})`);
    }
}
save('bomb', rows);
console.log(fails.length ? `[${MODE}] FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `[${MODE}] bomb checks: all ${checks} passed (${rows.length} rows)`);
process.exit(fails.length ? 1 : 0);
