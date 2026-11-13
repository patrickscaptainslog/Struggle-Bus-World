#!/usr/bin/env node
// Taking the block, part B's rules under Node (docs/specs/factions/LIFT.md, "Taking the block"): the stand-in for the areas engine
// (src/world/liftRules.ts, TakeRules) row by row against a table this check carries (areas.ts's outcomeOf as read on 2026-11-12: the check never
// reads another branch), the five seconds, a square from the Lift to the flip in five counted hits and on to the Lift again in three, a super's id,
// the firehose's swath, seeding and readiness; then each house's session paint (TakeHouses) through a crack, a fall, the wilts, the flip, the ups
// and a tile streaming back in, the gardens' calls recorded by a stub (a wilt clears before it grows). And the plain fall's hold (fallBlocked).
// And the take's motion (part C): the fall, the crack and its hold, the flinch (liftGlsl's liftAt), and the falling wall (LiftField's state 3).
// Bundled with rolldown as lift-check.mjs bundles liftGlsl.ts. Prints pass or FAIL a line with its numbers, exits 1 on any failure.
//
//   node tools/factions/take-check.mjs
import { rolldown } from 'rolldown';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const R = root.replace(/\\/g, '/');
const out = `${here}.out`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/take-entry.ts`, [`export * from '${R}/src/world/liftRules.ts';`, `export * from '${R}/src/world/liftGlsl.ts';`, `export * from '${R}/src/world/LiftField.ts';`].join('\n'));
const bundle = await rolldown({ input: `${out}/take-entry.ts`, platform: 'node', logLevel: 'silent', external: [/^three/] });
await bundle.write({ dir: out, format: 'esm', entryFileNames: 'take.mjs' });
await bundle.close();
const L = await import(pathToFileURL(`${out}/take.mjs`).href);
const { TakeRules, TakeHouses, TAKE, keyAt, SQUARE } = L;

let failed = 0;
function report(name, value, limit, ok) {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${value}  (${limit})`);
}

const RB = 1, AT = 2, INF = 5;
// a square's centre (m) by its indices: Alamo Square's heart is about (-2000, 300) in the game's metres; any will do
const at = (ix, iz) => [(ix + 0.5) * SQUARE, (iz + 0.5) * SQUARE];
const [X, Z] = at(-16, 2);
const K = keyAt(X, Z);

// ------------------------------------------------------------------ 1. every row of the table, from its own record
// (areas.ts's outcomeOf below the god, carried here: owner, stage, cracks, ready, the hitter's own or a rival's -> outcome, then the record after)
const ROWS = [
  // [name, owner, stage, cracks, ready, own, outcome, stage after, cracks after, owner after (o: the owner's, h: the hitter's)]
  ['an owner, cracked, ready', INF, 4, 1, true, true, 'heal', 4, 0, 'o'],
  ['an owner, cracked, not ready', INF, 4, 1, false, true, 'encore', 4, 1, 'o'],
  ['an owner, not ready', INF, 2, 0, false, true, 'encore', 2, 0, 'o'],
  ['an owner at the top', INF, 4, 0, true, true, 'encore', 4, 0, 'o'],
  ['an owner, ready, under the top', INF, 2, 0, true, true, 'up', 3, 0, 'o'],
  ['a rival, not ready', INF, 4, 0, false, false, 'parry', 4, 0, 'o'],
  ['a rival, not ready, stage 1', INF, 1, 0, false, false, 'parry', 1, 0, 'o'],
  ['a rival, ready, stage 1', INF, 1, 0, true, false, 'flip', 1, 0, 'h'],
  ['a rival, ready, stage 4, no crack', INF, 4, 0, true, false, 'crack', 4, 1, 'o'],
  ['a rival, ready, stage 4 cracked', INF, 4, 1, true, false, 'down', 3, 0, 'o'],
  ['a rival, ready, stage 3', INF, 3, 0, true, false, 'down', 2, 0, 'o'],
  ['a rival, ready, stage 2', INF, 2, 0, true, false, 'down', 1, 0, 'o'],
  ['anyone, no owner (the merge only)', 0, 0, 0, true, false, 'claim', 1, 0, 'h'],
];
for (const [name, owner, stage, cracks, ready, own, want, st, cr, who] of ROWS) {
  const r = new TakeRules();
  const a = r.seed(K, owner, stage, ready ? 0 : 98);
  a.cracks = cracks;
  const hitter = own ? owner : RB;
  const h = r.hit(X, Z, hitter, 100);
  const after = `stage ${h.area.stage}, cracks ${h.area.cracks}, owner ${h.area.faction}`;
  const wantOwner = who === 'h' ? hitter : owner;
  const changed = !['encore', 'parry', 'none'].includes(want);
  report(`row: ${name}`, `${h.outcome}, ${after}, last ${h.area.last}`, `${want}, stage ${st}, cracks ${cr}, owner ${wantOwner}${changed ? ', last 100' : ''}`,
    h.outcome === want && h.area.stage === st && h.area.cracks === cr && h.area.faction === wantOwner && (changed ? h.area.last === 100 : h.area.last === (ready ? 0 : 98)));
}
{
  const r = new TakeRules();
  r.seed(K, INF, 4, 0);
  const a = r.hit(X, Z, RB, 100, { superId: 7 }), b = r.hit(X, Z, RB, 200, { superId: 7 });
  report('row: the same super a second time', `${a.outcome}, then ${b.outcome} (stage ${b.area.stage}, cracks ${b.area.cracks})`, 'crack, then none, the record as the crack left it', a.outcome === 'crack' && b.outcome === 'none' && b.area.cracks === 1);
  r.seed(K, INF, 4, 98);
  const c = r.hit(X, Z, RB, 100, { superId: 9 }), d = r.hit(X, Z, RB, 104, { superId: 9 });
  report('row: a parried super spends its id', `${c.outcome}, then at 104 s ${d.outcome}`, 'parry, then none', c.outcome === 'parry' && d.outcome === 'none');
}

// ------------------------------------------------------------------ 2. the five seconds, the heal, a square to the flip and back to the Lift
{
  const r = new TakeRules();
  r.seed(K, INF, 4, 100);
  const a = r.hit(X, Z, RB, 104.99), b = r.hit(X, Z, RB, 105);
  report('a rival hit 4.99 s after the last change', a.outcome, 'parry', a.outcome === 'parry');
  report('the same at 5.00 s', b.outcome, 'crack', b.outcome === 'crack');
  const c = r.hit(X, Z, RB, 109.99), d = r.hit(X, Z, RB, 110);
  report('a crack starts the five seconds again', `${c.outcome} at 4.99 s, ${d.outcome} at 5.00`, 'parry, down', c.outcome === 'parry' && d.outcome === 'down');
  const r2 = new TakeRules();
  r2.seed(K, INF, 4, 0);
  r2.hit(X, Z, RB, 100);
  const e = r2.hit(X, Z, INF, 104), f = r2.hit(X, Z, INF, 105), healed = f.area.cracks, g = r2.hit(X, Z, RB, 109.5), h2 = r2.hit(X, Z, RB, 110);
  report('the owner\'s hit heals the crack once its five seconds are up, and starts them again', `${e.outcome} at 4 s, ${f.outcome} at 5 (cracks ${healed}); the rival's then ${g.outcome} at 4.5 s, ${h2.outcome} at 5`, 'encore, heal (0); parry, crack',
    e.outcome === 'encore' && f.outcome === 'heal' && healed === 0 && g.outcome === 'parry' && h2.outcome === 'crack');
}
{
  const r = new TakeRules();
  r.seed(K, INF, 4, 0);
  const seen = [];
  let t = 100;
  for (let k = 0; k < 5; k++, t += 5) seen.push(r.hit(X, Z, RB, t).outcome);
  report('one square from the Lift to the flip in exactly five counted hits', seen.join(', '), 'crack, down, down, down, flip', seen.join() === 'crack,down,down,down,flip' && r.get(K).faction === RB && r.get(K).stage === 1);
  const ups = [];
  for (let k = 0; k < 3; k++, t += 5) ups.push(`${r.hit(X, Z, RB, t).outcome} ${r.get(K).stage}`);
  const more = r.hit(X, Z, RB, t).outcome;
  report('and on to the Lift again, the hitter\'s, in three more', `${ups.join(', ')}, then ${more}`, 'up 2, up 3, up 4, then encore', ups.join() === 'up 2,up 3,up 4' && more === 'encore');
}
{
  // the cadence: a tap every 2.6 s from the square's ready time (a 1.0 s breath, a 1.6 s recharge)
  const r = new TakeRules();
  r.seed(K, INF, 4, 100 - TAKE.cooldown);
  let counted = 0, parried = 0, t = 100;
  while (r.get(K).faction !== RB) {
    const o = r.hit(X, Z, RB, t).outcome;
    if (o === 'parry') parried++;
    else counted++;
    t += 2.6;
  }
  report('a square tapped at the cadence alone', `${counted} counted, ${parried} parried, the flip ${(t - 2.6 - 100).toFixed(1)} s after its first tap`, '5 counted, 4 parried, 20.8 s', counted === 5 && parried === 4 && Math.abs(t - 2.6 - 100 - 20.8) < 1e-6);
}
{
  const r = new TakeRules();
  r.seed(K, RB, 1, 0);
  const a = r.hit(X, Z, RB, 100, { jump: 3 });
  report('a jump climbs the hitter\'s own square past the wait, to 3 at most', `${a.outcome}, stage ${a.area.stage}`, 'up, stage 3', a.outcome === 'up' && a.area.stage === 3);
  r.seed(K, INF, 4, 0);
  const b = r.hit(X, Z, RB, 100, { jump: 3 });
  report('a rival\'s square takes the one hit it always would', `${b.outcome}, stage ${b.area.stage}`, 'crack, stage 4', b.outcome === 'crack' && b.area.stage === 4);
}

// ------------------------------------------------------------------ 3. the swath, seeding, the unseeded and the tagged, the key
{
  // the Lift counts a firehose's impacts on a square and credits its sixth with the super's id; the stand-in dedupes ids
  const r = new TakeRules();
  r.seed(K, INF, 4, 0);
  const id = 41, outs = [];
  let n = 0;
  for (let k = 0; k < 8; k++) {
    if (++n < TAKE.dwell) {
      outs.push('-');
      continue;
    }
    outs.push(r.hit(X, Z, RB, 100 + k * 0.1, { superId: id }).outcome);
  }
  const closer = r.hit(X, Z, RB, 120, { superId: id }).outcome;
  report('the swath: five impacts nothing, the sixth one hit, then none, the closer none', `${outs.join(' ')}, closer ${closer}`, '- - - - - crack none none, closer none', outs.join(' ') === '- - - - - crack none none' && closer === 'none');
}
{
  const r = new TakeRules();
  r.seed(K, INF, 4, Infinity);
  const a = r.hit(X, Z, RB, 1e6);
  report('a seeded square with last = Infinity parries until the Lift readies it', a.outcome, 'parry', a.outcome === 'parry');
  // (the Lift readies it at its last staged house's launch plus `settle`: last = that moment - cooldown)
  const launch = 200, ready = launch + TAKE.settle;
  r.get(K).last = ready - TAKE.cooldown;
  const b = r.hit(X, Z, RB, ready - 0.01), c = r.hit(X, Z, RB, ready);
  report(`ready at its last launch plus ${TAKE.settle} s, not plus 5`, `${b.outcome} at ${(ready - 0.01 - launch).toFixed(2)} s, ${c.outcome} at ${(ready - launch).toFixed(2)}`, 'parry, crack', b.outcome === 'parry' && c.outcome === 'crack');
  const [ux, uz] = at(40, 40);
  const n0 = r.all.size, u = r.hit(ux, uz, RB, 300);
  report('a hit on a square with no record', `${u}, records ${n0} -> ${r.all.size}`, 'null, none made', u === null && r.all.size === n0);
  report('peek on it', String(r.peek(ux, uz, RB, 300)), 'null', r.peek(ux, uz, RB, 300) === null);
  const rt = new TakeRules(new Set([K]));
  const h = rt.seed(K, INF, 4, Infinity);
  report('a tagged heart seeded at the Lift stops at 3', `stage ${h.stage}, top ${rt.topOf(K)}`, 'stage 3, top 3', h.stage === 3 && rt.topOf(K) === 3);
}
{
  // keyAt in metres, as areas.ts's squareKey(x, z): ix and iz as two 16-bit halves of floor(x / 128), floor(z / 128)
  const pack = (ix, iz) => (((ix & 0xffff) << 16) | (iz & 0xffff)) >>> 0;
  const cases = [[0, 0], [127.99, 128], [-0.01, -128.01], [-2050.5, 310.2], [5000, -4000]];
  const bad = cases.filter(([x, z]) => keyAt(x, z) !== pack(Math.floor(x / 128), Math.floor(z / 128)));
  report('keyAt against areas.ts-style metres', `${cases.length - bad.length} of ${cases.length}`, `all, and keyAt(300, 0) ${keyAt(300, 0)} is not squareKey(300, 0) ${L.squareKey(300, 0)}`, !bad.length && keyAt(300, 0) !== L.squareKey(300, 0));
}

// ------------------------------------------------------------------ 4. each house's session paint (C3)
{
  const calls = [];
  const tex = new Map();
  const sink = {
    stage: (i, f, h, l, bt) => {
      tex.set(i, [f, h, l]);
      calls.push(`stage ${i} ${f} ${h} ${l}`);
    },
    clear: (i) => calls.push(`clear ${i}`),
    grow: (i, h, l) => calls.push(`grow ${i} ${h} ${l}`),
  };
  const H = new TakeHouses(16);
  const houses = [3, 5, 9], dist = [0, 60, 120];
  houses.forEach((i, k) => H.stage(i, INF, k, 3, sink));
  const row = () => houses.map((i) => `${H.faction[i]}/${H.hue[i]}/${H.level[i]}`).join(' ');
  const texRow = () => houses.map((i) => (tex.get(i) ?? []).join('/')).join(' ');
  report('staged', row(), '5/0/3 5/1/3 5/2/3', row() === '5/0/3 5/1/3 5/2/3');
  // (a crack and the fall write no paint: the Lift writes none for them)
  report('after a crack and the fall', `${row()}, ${H.queued} queued`, 'as staged, none queued', row() === '5/0/3 5/1/3 5/2/3' && H.queued === 0);
  calls.length = 0;
  H.change('wilt', houses, dist, 100, TAKE.shock, INF, 0);
  H.drain(100, sink);
  report('a wilt\'s front: the impact\'s house at once, the far ones as it reaches them', texRow(), '5/0/2 5/1/3 5/2/3', texRow() === '5/0/2 5/1/3 5/2/3');
  H.drain(101, sink);
  report('after the wilt (3 to 2): a level off, hue and owner kept', `${row()}, texels ${texRow()}`, '5/0/2 5/1/2 5/2/2', row() === '5/0/2 5/1/2 5/2/2' && texRow() === row());
  report('a wilt clears a garden before it grows it again at the lower level', calls.slice(0, 3).join('; '), 'stage 3 5 0 2; clear 3; grow 3 0 2', calls.slice(0, 3).join('; ') === 'stage 3 5 0 2; clear 3; grow 3 0 2');
  calls.length = 0;
  H.change('wilt', houses, dist, 110, TAKE.shock, INF, 0);
  H.drain(111, sink);
  report('after the wilt (2 to 1): level 1, the gardens cleared, none grown', `${row()}; ${calls.filter((c) => c.startsWith('grow')).length} grown, ${calls.filter((c) => c.startsWith('clear')).length} cleared`, '5/0/1 5/1/1 5/2/1; 0 grown, 3 cleared',
    row() === '5/0/1 5/1/1 5/2/1' && !calls.some((c) => c.startsWith('grow')) && calls.filter((c) => c.startsWith('clear')).length === 3);
  H.change('flip', houses, dist, 120, TAKE.front, RB, 1);
  H.drain(120.6, sink);
  report('the flip\'s front at 120 m/s, 0.6 s on', texRow(), '1/0/1 1/1/1 5/2/1 (the 120 m house at 1.0 s)', texRow() === '1/0/1 1/1/1 5/2/1');
  H.drain(121.01, sink);
  report('after the flip: the hitter\'s at level 1, hue kept', row(), '1/0/1 1/1/1 1/2/1', row() === '1/0/1 1/1/1 1/2/1' && texRow() === row());
  calls.length = 0;
  H.change('up', houses, dist, 130, TAKE.front, RB, 2);
  H.drain(132, sink);
  H.change('up', houses, dist, 135, TAKE.front, RB, 3);
  H.drain(137, sink);
  report('after two ups: the owner\'s at 2, then 3, the gardens grown at each', `${row()}; ${calls.filter((c) => c.startsWith('grow')).length} grown`, '1/0/3 1/1/3 1/2/3; 6 grown', row() === '1/0/3 1/1/3 1/2/3' && calls.filter((c) => c.startsWith('grow')).length === 6);
  // (the taker's own lift writes no paint: its houses go up at level 3 in its colours)
  H.change('up', houses, dist, 140, TAKE.front, RB, 3);
  report('the up to the Lift queues no paint', `${H.queued} queued`, '0', H.queued === 0);
  // a tile streaming back in: its houses registered again with a save under them (Rainbow's own old paint, level 1, hue 4), then tileIn's rule
  for (const i of houses) tex.set(i, [RB, 4, 1]);
  for (const i of houses) H.restore(i, sink);
  report('a tile back in over a save: every house\'s owner, hue and level as before', texRow(), row(), texRow() === row());
  report('a house the takeover never held is left to its save', `${H.has(7)}`, 'false', !H.has(7));
}

// ------------------------------------------------------------------ 4b. a flip and a flip back whose fronts reach the houses in one frame
{
  const tex = new Map();
  const sink = { stage: (i, f, h, l) => tex.set(i, `${f}/${l}`), clear: () => {}, grow: () => {} };
  const H = new TakeHouses(16);
  const hs = [2, 4, 6], ds = [10, 50, 90];
  hs.forEach((i, k) => H.stage(i, INF, k, 1, sink));
  // (Inferno's flip, then Rainbow's back 0.02 s later, both drained in one frame of 0.5 s: the take-fly run's FAIL of 2026-11-12)
  H.change('flip', hs, ds, 200, TAKE.front, AT, 1);
  H.change('flip', hs, ds, 200.02, TAKE.front, RB, 1);
  H.drain(201, sink);
  const got = hs.map((i) => tex.get(i)).join(' ');
  report('two changes\' writes due in one frame: each house keeps the later change\'s', got, '1/1 1/1 1/1', got === '1/1 1/1 1/1');
}

// ------------------------------------------------------------------ 4c. each front's arrival at a house (the sink's arrive: a wilt's petals, a flip's and an up's notes)
{
  // (the arrivals one drain takes, in house order: within a frame their order is the queue's)
  const got = [];
  const sorted = () => got.slice().sort((a, b) => +a.split(' ')[1] - +b.split(' ')[1]).join('; ');
  const sink = { stage: () => {}, clear: () => {}, grow: () => {}, arrive: (i, kind, f, h, l) => got.push(`${kind} ${i} ${f}/${h}/${l}`) };
  const H = new TakeHouses(16);
  const hs = [2, 4, 6], ds = [0, 60, 120];
  hs.forEach((i, k) => H.stage(i, INF, k, 3, sink));
  report('staging arrives nowhere', `${got.length} arrivals`, '0', got.length === 0);
  H.change('wilt', hs, ds, 10, TAKE.shock, INF, 0);
  H.drain(10, sink);
  const at0 = got.length;
  H.drain(11, sink);
  report('a wilt\'s front arrives at each house as it reaches it, the owner\'s at the lower level', `${at0} at once, then ${sorted()}`, '1 at once; wilt 2 5/0/2; wilt 4 5/1/2; wilt 6 5/2/2',
    at0 === 1 && sorted() === 'wilt 2 5/0/2; wilt 4 5/1/2; wilt 6 5/2/2');
  got.length = 0;
  H.change('flip', hs, ds, 20, TAKE.front, RB, 1);
  H.drain(20.6, sink);
  const at1 = got.length;
  H.drain(22, sink);
  report('a flip\'s front arrives at each house as it reaches it, the hitter\'s at level 1', `${at1} by 0.6 s, then ${sorted()}`, '2 by 0.6 s; flip 2 1/0/1; flip 4 1/1/1; flip 6 1/2/1',
    at1 === 2 && sorted() === 'flip 2 1/0/1; flip 4 1/1/1; flip 6 1/2/1');
  got.length = 0;
  H.change('up', hs, ds, 30, TAKE.front, RB, 2);
  H.drain(32, sink);
  report('an up arrives at each house it steps', sorted(), 'up 2 1/0/2; up 4 1/1/2; up 6 1/2/2', sorted() === 'up 2 1/0/2; up 4 1/1/2; up 6 1/2/2');
  got.length = 0;
  H.change('up', hs, ds, 40, TAKE.front, RB, 2);
  H.drain(42, sink);
  report('an up that steps no house arrives nowhere', `${got.length} arrivals`, '0', got.length === 0);
}

// ------------------------------------------------------------------ 5. the plain fall's hold (fallBlocked)
{
  const box = { x0: 0, z0: 0, x1: 20, z1: 20, top: 80, reach: 4 };
  const fb = (bx, by, bz, speed = 0, cx = 500, cy = 30, cz = 500) => L.fallBlocked(box.x0, box.z0, box.x1, box.z1, box.top, box.reach, bx, by, bz, 1, 0, 8, speed, cx, cy, cz);
  report('the bus under a floating house: held', String(fb(10, 20, 10)), 'true', fb(10, 20, 10) === true);
  report('the bus 30 m beside it, still: falls', String(fb(54, 20, 10)), 'false', fb(54, 20, 10) === false);
  report('the bus 30 m beside it at 60 m/s (36 m of margin): held', String(fb(54, 20, 10, 60)), 'true', fb(54, 20, 10, 60) === true);
  report('the bus over its top plus 8: falls', String(fb(10, 89, 10)), 'false', fb(10, 89, 10) === false);
  report('the lens under it: held', String(fb(200, 20, 200, 0, 10, 60, 10)), 'true', fb(200, 20, 200, 0, 10, 60, 10) === true);
  report('the bus\'s tail under its edge, its middle 13 m out: held', String(fb(-13 + 0.5, 20, 10)), 'true', fb(-13 + 0.5, 20, 10) === true);
}

// ------------------------------------------------------------------ 6. the take's motion (C2): the fall, the crack, the flinch, the falling wall
{
  const F = L.LIFT_FALL, T = L.LIFT_TAKE, LT = L.LIFT;
  const o = [0, 0, 0, 0], p = [0, 0, 0, 0];
  // (rests 9 to 94 m, heaves of a big building's to a small house's, centres a few km apart, the swell's every phase by the clock)
  const rests = [9, 12, 16, 34, 48, 62, 72, 94], heaves = [1.2, 2.2, 3.45];
  let under = 0, underAt = null, lands = 0, landBad = 0, settleBad = 0, jump = 0, jumpLean = 0, n = 0;
  for (const H of rests)
    for (const hv of heaves)
      for (const fps of [20, 30, 60])
        for (const k of [0, 1, 2]) {
          const t0 = 100 + 37 * k, f0 = t0 + 2.7 + 1.3 * k, cx = -2000 + 900 * k, cz = 300 - 700 * k, sb = 0.17 + 0.3 * k, rad = 18;
          // (continuous at the fall's start: the motion where the swell has it, and the fall 0 s in)
          L.liftAt(f0 - t0, f0, H, sb, cx, cz, hv, o);
          L.liftAt(f0 - t0, f0, H, sb, cx, cz, hv, p, 0);
          jump = Math.max(jump, Math.abs(o[0] - p[0]));
          jumpLean = Math.max(jumpLean, Math.abs(o[2] - p[2]), Math.abs(o[3] - p[3]));
          const dt = 1 / fps, land = L.fallLands(H), settle = land + F.settle;
          let first = -1, last = -1;
          for (let u = 0; u <= L.fallEnds(H) + dt; u += dt) {
            L.liftAt(f0 + u - t0, f0 + u, H, sb, cx, cz, hv, o, u);
            // (its lowest drawn point: its belly's centre less its lean across its reach, never under its ground less the landing's sink)
            const low = o[0] - (Math.abs(o[2]) + Math.abs(o[3])) * rad;
            if (low < -F.sink - 1e-9 && -F.sink - low > under) [under, underAt] = [-F.sink - low, { H, hv, fps, u: +u.toFixed(3) }];
            if (first < 0 && o[0] <= 0) first = u;
            if (o[0] !== 0 || o[1] !== 0) last = u;
            n++;
          }
          lands++;
          if (Math.abs(first - land) > dt + 1e-9) landBad++;
          if (Math.abs(last - settle) > dt + 1e-9) settleBad++;
        }
  report('the fall: no drawn point under its ground less the landing\'s sink (rests 9-94 m, three heaves, 20/30/60 fps, a 18 m reach)', under ? `${under.toFixed(3)} m under at ${JSON.stringify(underAt)}` : `0 of ${n} samples`, 'none', !under);
  report('the fall: each lands at its hitch plus its drop, within a frame', `${lands - landBad} of ${lands}`, 'all', !landBad);
  report('the fall: each settles at hitch + drop + settle, within a frame', `${lands - settleBad} of ${lands}`, 'all', !settleBad);
  report('the fall: dy and the lean continuous at its start (its launch 2.7 s old or more)', `dy ${(jump * 100).toFixed(2)} cm, the lean ${jumpLean.toExponential(1)}`, 'dy <= 1 cm', jump <= 0.01 && jumpLean <= 1e-6);
  const drops = [9, 34, 72, 94].map((H) => L.fallDrop(H + 3).toFixed(2)).join(', ');
  report('the fall: drop times from 9, 34, 72, 94 m and a 3 m crest', `${drops} s`, 'the design\'s 0.47, 0.82, 1.17, 1.33', drops === '0.47, 0.82, 1.17, 1.33');

  // the crack: its peak vertical speed, its list with the swell's lean, the heal's speed; the defaults change nothing
  let vMax = 0, vAt = null, tilt = 0, hvMax = 0, same = true;
  for (const H of rests)
    for (const hv of heaves)
      for (let a = 0; a < 8; a++) {
        const c = 500, la = (a * Math.PI) / 4, lx = Math.cos(la), lz = Math.sin(la), dt = 1 / 240;
        let prev = null;
        for (let u = -0.1; u < 4; u += dt) {
          L.liftAt(50 + u, c + u, H, 0.31, -1800 + 40 * a, 200, hv, o, -1, c, lx, lz);
          L.liftAt(50 + u, c + u, H, 0.31, -1800 + 40 * a, 200, hv, p);
          // (the house's own swell taken out: the crack's own speed)
          const d = o[0] - p[0];
          if (prev !== null && Math.abs(d - prev) / dt > vMax) [vMax, vAt] = [Math.abs(d - prev) / dt, { H, u: +u.toFixed(3) }];
          prev = d;
          tilt = Math.max(tilt, Math.hypot(o[2], o[3]));
        }
        // (the heal 6 s on: back up)
        prev = null;
        for (let u = 0; u < 4; u += dt) {
          L.liftAt(56 + u, c + 6 + u, H, 0.31, -1800, 200, hv, o, -1, -(c + 6), lx, lz);
          L.liftAt(56 + u, c + 6 + u, H, 0.31, -1800, 200, hv, p);
          const d = o[0] - p[0];
          if (prev !== null) hvMax = Math.max(hvMax, Math.abs(d - prev) / dt);
          prev = d;
        }
        L.liftAt(50, c, H, 0.31, -1800, 200, hv, o);
        L.liftAt(50, c, H, 0.31, -1800, 200, hv, p, -1, 0, 0, 0);
        same &&= o.every((v, i) => Object.is(v, p[i]));
      }
  report('the crack: its peak vertical speed (sink and jolt)', `${vMax.toFixed(2)} m/s at ${JSON.stringify(vAt)}`, '< 10 m/s', vMax < 10);
  report('the crack: its list with the swell\'s lean never over tiltMax', `${tilt.toFixed(4)}`, `<= ${LT.tiltMax}`, tilt <= LT.tiltMax + 1e-12);
  report('the heal: its rise\'s peak speed', `${hvMax.toFixed(2)} m/s`, '< 10 m/s', hvMax < 10);
  report('the defaults (no fall, no crack) answer bit for bit as before', String(same), 'true', same);
  const sinks = [9, 12, 20, 94].map((H) => L.crackSinkOf(H).toFixed(2)).join(', ');
  report('the sink: 12 % of the rest, at least 1.5 m, the belly never under hMin', `${sinks} m for rests 9, 12, 20, 94`, '0.00, 1.50, 2.40, 11.28', sinks === '0.00, 1.50, 2.40, 11.28');

  // the flinch: drawn only, never up, under 0.3 m, done by flinchT
  let fUp = 0, fDown = 0, fEnd = 0;
  for (let u = 0; u < 1; u += 1 / 240) {
    L.liftAt(u, 0, -1, 0, 0, 0, 0, o);
    fUp = Math.max(fUp, o[0], o[1]);
    fDown = Math.max(fDown, -o[0]);
    if (u >= T.flinchT) fEnd = Math.max(fEnd, Math.abs(o[0]), Math.abs(o[1]));
  }
  report('the flinch: never up, under 0.3 m down, done by its 0.6 s', `up ${fUp}, down ${fDown.toFixed(3)} m, after ${fEnd}`, 'up 0, down < 0.3, after 0', fUp === 0 && fDown < 0.3 && fEnd === 0);

  // the crack's hold (crackBlocked): the bus under a house whose belly would sink onto it
  const cb = (by, bx = 10, cy = 300) => L.crackBlocked(0, 0, 20, 20, 60, 80, 7, 4, bx, by, 10, 1, 0, 8, 0, 500, cy, 500);
  report('the crack\'s hold: the bus 6 m under a belly about to sink 7 m: held', String(cb(54 - 5)), 'true', cb(49) === true);
  report('the crack\'s hold: the bus 30 m under it: sinks', String(cb(20)), 'false', cb(20) === false);
  report('the crack\'s hold: the bus 40 m beside it: sinks', String(cb(49, 60)), 'false', cb(49, 60) === false);
  report('the crack\'s hold: the lens under it: held', String(L.crackBlocked(0, 0, 20, 20, 60, 80, 7, 4, 500, 20, 500, 1, 0, 8, 0, 10, 52, 10)), 'true', L.crackBlocked(0, 0, 20, 20, 60, 80, 7, 4, 500, 20, 500, 1, 0, 8, 0, 10, 52, 10) === true);
}

// ------------------------------------------------------------------ 7. the falling house is a wall to the flight (LiftField's state 3)
{
  const { LiftField } = L;
  const one = (a) => new Float32Array([a]);
  const houses = { state: new Uint8Array([2]), H: one(40), margin: one(4), tiltM: one(1.5), solid: new Uint8Array([0]), cx: one(4), cz: one(4), rad: one(6), base: one(0), t0: one(0), extra: one(0), now: 100, dyNow: () => 40, dyAt: () => 40 };
  const world = { stampLift: (x, z, c, idx, top, o, max, rest) => ((idx[o] = 0), (top[o] = 10), (rest[0] = 0), 1) };
  const f = new LiftField(0, 0, 64, 64, 8, world, houses);
  f.reach(0, 0, 8, 8);
  const up = f.query(4, 4, 5, 0, false);
  const upUnder = f.under;
  houses.state[0] = 3;
  const lowQ = f.query(4, 4, 5, 0, false), lowUnder = f.under, highQ = f.query(4, 4, 200, 0, false);
  report('the field: a floating house is a deck from under it', `floor ${up}, underside ${upUnder.toFixed(1)}`, 'floor 0, an underside', up === 0 && upUnder < Infinity);
  report('the field: a falling one is a wall from the ground to its drawn top, from under and over', `from 5 m ${lowQ.toFixed(1)}, underside ${lowUnder}; from 200 m ${highQ.toFixed(1)}`, '>= 51.5 both, no underside', lowQ >= 51.5 && highQ >= 51.5 && lowUnder === Infinity);
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
