// The view's lift while a shot is up (src/game/CameraRig.ts's shotTip; DESIGN's shot-tip row): with far false it's the near Lob's tip up as main.ts had it
// before (4f33648: max(the sky's lift, config.lob.tip while it climbs, min(star - half + tipTop, bus + half x tipBus))), to the last bit, on a grid of
// star, bus and half angles; with far true, on the same grid with the lift at the tap 0 and 27 (the sky's lift at the ceiling): the hit at
// config.shotView.low or higher wherever the bus allows it, the bus never over busMax, never more than swing under the lift at the tap, and never a tip up
// past it. And main.ts calls shotTip for both, with no copy of the old arithmetic left (a source check).
//   node tools/feel-sim/run.mjs s_tip.ts
// Exit 1 when a check fails.
import { config } from './lib';
import { shotTip } from '@src/game/CameraRig';
import { readFileSync } from 'node:fs';

const L = config.lob, V = config.shotView;
const DEG = 180 / Math.PI;
/** main.ts's tip up at 4f33648, as it was written there */
const old = (star: number, busUp: number, half: number, climbing: boolean, base: number) => Math.max(base, climbing ? L.tip : 0, Math.min(star - half + L.tipTop, busUp + half * L.tipBus));
let checks = 0, diffs = 0;
const fails: string[] = [];
const ok = (c: boolean, m: string) => {
  checks++;
  if (!c && fails.length < 40) fails.push(m);
  if (!c) diffs++;
};
let n = 0, worstBus = -Infinity, worstHit = Infinity;
for (let half = 14; half <= 34; half += 2)
  for (let star = -80; star <= 80; star += 2.5)
    for (let busUp = -half; busUp <= half * 0.6; busUp += 1.5) {
      for (const climbing of [false, true])
        for (const base of [0, 27]) {
          const a = shotTip(star, busUp, half, climbing, false, 0, base), b = old(star, busUp, half, climbing, base);
          ok(a === b, `near: shotTip ${a} against main.ts's ${b} (star ${star}, bus ${busUp}, half ${half}, climbing ${climbing}, base ${base})`);
          n++;
        }
      for (const liftAtTap of [0, 27]) {
        const T = shotTip(star, busUp, half, false, true, liftAtTap), t = Math.tan(half / DEG);
        // (where it shows after: tan(angle - T) / tan(half), NDC)
        const busAfter = Math.tan((busUp - T) / DEG) / t, hitAfter = Math.tan((star - T) / DEG) / t;
        const busWants = busUp - Math.atan(V.busMax * t) * DEG, hitWants = Math.min(0, star - Math.atan(V.low * t) * DEG);
        ok(busAfter <= V.busMax + 1e-9 || T === liftAtTap - V.swing, `far: the bus over busMax (${busAfter.toFixed(3)}; star ${star}, bus ${busUp}, half ${half}, lift ${liftAtTap})`);
        ok(T >= liftAtTap - V.swing - 1e-9, `far: more than swing under the lift at the tap (${T}; lift ${liftAtTap})`);
        ok(T <= Math.max(0, busWants, liftAtTap - V.swing) + 1e-9, `far: a tip up past the bus's need (${T})`);
        // (the hit at low or higher wherever the bus allows: the bus's limit and the swing not binding)
        if (busWants <= hitWants && liftAtTap - V.swing <= hitWants) ok(hitAfter >= V.low - 1e-9 || T === 0, `far: the hit under low where the bus allows (${hitAfter.toFixed(3)}; star ${star}, bus ${busUp}, half ${half})`);
        if (T < 0 && busWants <= hitWants) worstHit = Math.min(worstHit, hitAfter);
        worstBus = Math.max(worstBus, busAfter);
        n++;
      }
    }
// (main.ts: shotTip for both, and no copy of the old arithmetic)
const main = readFileSync('src/main.ts', 'utf8');
const calls = (main.match(/shotTip\(/g) ?? []).length;
ok(calls >= 2 && /shotTip\([^;]*, true, farLift\)/.test(main) && /shotTip\([^;]*, false, 0, live \? rig\.skyLiftTarget : 0\)/.test(main), `main.ts calls shotTip for the far dip and the near tip up (${calls} calls)`);
ok(!/star - half \+ L\.tipTop|half \* L\.tipBus/.test(main), `main.ts keeps no copy of the old tip-up arithmetic`);
console.log(`${n} cases; far: the bus at most ${worstBus.toFixed(3)} after, the hit at least ${worstHit.toFixed(3)} where the bus allows`);
console.log(fails.length ? `TIP FAILED ${diffs} of ${checks}:\n  ${fails.join('\n  ')}` : `tip checks: all ${checks} passed`);
process.exit(fails.length ? 1 : 0);
