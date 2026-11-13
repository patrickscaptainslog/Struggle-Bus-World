#!/usr/bin/env node
// The take's rules against the areas engine itself (docs/specs/factions/LIFT.md, "Taking it: the rules"): the stand-in in the first account's files
// (src/world/liftRules.ts, TakeRules) and the second account's Areas (src/factions/areas.ts) fed the same hits, outcome by outcome and record by
// record. First take-check.mjs's table, row by row, on both (the table it carries as areas.ts read on 2026-11-12); then sequences of hits over time: an
// owner's and a rival's at every stage, inside and past the five seconds, stage 4's two hits (the crack, then the fall), the heal, the flip, the
// taker's ups back to the Lift, a super's id twice, a Bomb's jump, a tagged square's top. Areas has no seeding call yet (the second account's ask):
// its record is set as one would be. The god is left out (the stand-in stops below it: a Realm-less Areas raises none).
//
// What may differ, said and not failed: `at`. Areas books a change on the beat (beat.ts's Slots, at most a bar late); the stand-in shows it at once.
// Anything else that differs (the outcome, the owner, the stage, the cracks, the owner's hits, `last`, the super's id) is a FAIL: a finding for the
// merge, never an edit of areas.ts here. Bundled with rolldown as take-check.mjs bundles liftRules.ts. Exits 1 on any failure.
//
//   node tools/factions/take-areas.mjs
import { rolldown } from 'rolldown';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const R = root.replace(/\\/g, '/');
const out = `${here}.out`;
mkdirSync(out, { recursive: true });
writeFileSync(
  `${out}/areas-entry.ts`,
  [`export { TakeRules, TAKE, keyAt } from '${R}/src/world/liftRules.ts';`, `export { SQUARE } from '${R}/src/world/liftGlsl.ts';`, `export { Areas, areaTune, squareKey } from '${R}/src/factions/areas.ts';`].join('\n'),
);
const bundle = await rolldown({ input: `${out}/areas-entry.ts`, platform: 'node', logLevel: 'silent', external: [/^three/] });
await bundle.write({ dir: out, format: 'esm', entryFileNames: 'areas.mjs' });
await bundle.close();
const L = await import(pathToFileURL(`${out}/areas.mjs`).href);
const { TakeRules, TAKE, keyAt, SQUARE, Areas, areaTune, squareKey } = L;

let failed = 0, timing = 0;
function report(name, value, limit, ok) {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${value}  (${limit})`);
}

const RB = 1, AT = 2, EW = 3, INF = 5;
const at = (ix, iz) => [(ix + 0.5) * SQUARE, (iz + 0.5) * SQUARE];
const [X, Z] = at(-16, 2);

// ------------------------------------------------------------------ 0. the numbers
report('the numbers: square, cooldown, top, tagged, hitsToDrop', `${SQUARE}, ${TAKE.cooldown}, ${TAKE.top}, ${TAKE.tagged}, [${TAKE.hitsToDrop}]`,
  `areas.ts: ${areaTune.size}, ${areaTune.cooldown}, ${areaTune.top}, ${areaTune.tagged}, [${areaTune.hitsToDrop}]`,
  SQUARE === areaTune.size && TAKE.cooldown === areaTune.cooldown && TAKE.top === areaTune.top && TAKE.tagged === areaTune.tagged && String(TAKE.hitsToDrop) === String(areaTune.hitsToDrop));

/** A pair fed the same hits: the stand-in and the engine, one square seeded the same in both. `tagged`: the square's top is the streets'. */
function pair(owner, stage, cracks, last, tagged = false) {
  const stand = new TakeRules(tagged ? new Set([keyAt(X, Z)]) : new Set());
  const a = stand.seed(keyAt(X, Z), owner, stage, last);
  a.cracks = cracks;
  // (a realm only for a tagged square's top: of() -1, so it raises no god, as the stand-in raises none)
  const realm = tagged ? { count: 0, of: () => -1, heart: () => -1, squares: () => [], km2: () => 0, name: () => '', godless: () => true, top: () => areaTune.tagged } : null;
  const eng = new Areas(undefined, realm);
  const key = squareKey(X, Z);
  eng.all.set(key, { key, faction: owner, stage: Math.min(stage, tagged ? areaTune.tagged : areaTune.top), cracks, hits: 0, tended: 0, last, superId: 0, ax: 0, az: 0, ay: 0 });
  return { stand, eng };
}

const rec = (a) => `${a.faction}/${a.stage}/${a.cracks}/${a.hits}/${a.last}/${a.superId}`;

/** One hit on both: the outcomes and the records after must be the same; `at` is said where it differs. */
function both(p, faction, t, o, name) {
  const s = p.stand.hit(X, Z, faction, t, o), e = p.eng.hit(X, Z, faction, t, o);
  const ok = s.outcome === e.outcome && rec(s.area) === rec(e.area);
  if (s.at !== e.at) timing++;
  report(name, `stand-in ${s.outcome} ${rec(s.area)}${s.at !== e.at ? `, at ${s.at.toFixed(3)}` : ''}`, `areas ${e.outcome} ${rec(e.area)}${s.at !== e.at ? `, at ${e.at.toFixed(3)} (the beat)` : ''}; owner/stage/cracks/hits/last/super`, ok);
  return s.outcome;
}

// ------------------------------------------------------------------ 1. take-check.mjs's table, row by row, on both
const ROWS = [
  // [name, owner, stage, cracks, ready, own] (take-check.mjs's rows, its wanted outcomes left to the engine)
  ['an owner, cracked, ready', INF, 4, 1, true, true],
  ['an owner, cracked, not ready', INF, 4, 1, false, true],
  ['an owner, not ready', INF, 2, 0, false, true],
  ['an owner at the top', INF, 4, 0, true, true],
  ['an owner, ready, under the top', INF, 2, 0, true, true],
  ['a rival, not ready', INF, 4, 0, false, false],
  ['a rival, not ready, stage 1', INF, 1, 0, false, false],
  ['a rival, ready, stage 1', INF, 1, 0, true, false],
  ['a rival, ready, stage 4, no crack', INF, 4, 0, true, false],
  ['a rival, ready, stage 4 cracked', INF, 4, 1, true, false],
  ['a rival, ready, stage 3', INF, 3, 0, true, false],
  ['a rival, ready, stage 2', INF, 2, 0, true, false],
  ['anyone, no owner', 0, 0, 0, true, false],
];
for (const [name, owner, stage, cracks, ready, own] of ROWS) both(pair(owner, stage, cracks, ready ? 0 : 98), own ? owner : RB, 100, {}, `row: ${name}`);

// ------------------------------------------------------------------ 2. every stage, an owner's hit and a rival's, ready and not, cracked and not
for (let stage = 1; stage <= 4; stage++)
  for (const cracks of stage === 4 ? [0, 1] : [0])
    for (const ready of [true, false])
      for (const own of [true, false]) both(pair(INF, stage, cracks, ready ? 0 : 98), own ? INF : RB, 100, {}, `stage ${stage}${cracks ? ' cracked' : ''}, ${ready ? 'ready' : 'cooling'}, ${own ? "the owner's" : "a rival's"}`);

// ------------------------------------------------------------------ 3. the five seconds' edge
for (const dt of [4.99, 5.0, 5.01]) {
  both(pair(INF, 4, 0, 100), RB, 100 + dt, {}, `a rival ${dt} s after the last change`);
  both(pair(INF, 2, 0, 100), INF, 100 + dt, {}, `the owner ${dt} s after the last change`);
}

// ------------------------------------------------------------------ 4. a sequence: Rainbow takes Inferno's Lift, a hit every 2.6 s, then climbs it back to the Lift
{
  const p = pair(INF, 4, 0, 0);
  const seen = [];
  let t = 100;
  for (let k = 0; k < 14; k++, t += 2.6) seen.push(both(p, RB, t, {}, `the take, hit ${k + 1} at ${t.toFixed(1)} s`));
  console.log(`      the take, hit by hit: ${seen.join(' ')} (${seen.filter((o) => o !== 'parry' && o !== 'encore').length} counted)`);
  // the taker's own hits, ready, to the Lift; then an encore at the top
  for (let k = 0; k < 5; k++, t += 5) both(p, RB, t, {}, `the taker's climb, hit ${k + 1} at ${t.toFixed(1)} s`);
}

// ------------------------------------------------------------------ 5. the top stage's two hits, a heal between, and Inferno's flip back
{
  const p = pair(INF, 4, 0, 0);
  both(p, RB, 100, {}, 'stage 4: the crack');
  both(p, INF, 102, {}, 'stage 4 cracked: the owner inside the five seconds (an encore)');
  both(p, INF, 105, {}, 'stage 4 cracked: the owner past them (the heal)');
  both(p, RB, 110, {}, 'stage 4 healed: the crack again');
  both(p, RB, 115, {}, 'stage 4 cracked: the fall');
  both(p, AT, 120, {}, 'stage 3: a second rival knocks it down');
  both(p, RB, 125, {}, 'stage 2: down');
  both(p, RB, 130, {}, 'stage 1: the flip, Rainbow\'s');
  both(p, INF, 132, {}, 'Rainbow\'s at 1: Inferno inside the five seconds (a parry)');
  both(p, INF, 135, {}, 'Rainbow\'s at 1: Inferno\'s flip back');
}

// ------------------------------------------------------------------ 6. a super's id, twice on one square and once on a parry
{
  const p = pair(INF, 4, 0, 0);
  both(p, RB, 100, { superId: 7 }, 'a super: the crack');
  both(p, RB, 200, { superId: 7 }, 'the same super again: none');
  both(p, RB, 202, { superId: 8 }, 'a new super, ready: the fall');
  both(p, RB, 203, { superId: 9 }, 'a super, parried, spends its id');
  both(p, RB, 300, { superId: 9 }, 'that super again: none');
}

// ------------------------------------------------------------------ 7. a Bomb's jump: the hitter's own square, a rival's, a grey one, the cap
{
  both(pair(RB, 1, 0, 99), RB, 100, { jump: 3, cap: 3 }, "a Bomb's jump 3 on its own square at 1, inside the five seconds");
  both(pair(RB, 3, 0, 0), RB, 100, { jump: 2, cap: 3 }, "a Bomb's jump 2 on its own square at 3, the cap 3");
  both(pair(INF, 4, 0, 0), RB, 100, { jump: 3, cap: 3 }, "a Bomb's jump 3 on a rival's Lift (one hit, as any)");
  both(pair(0, 0, 0, 0), RB, 100, { jump: 2, cap: 3 }, "a Bomb's jump 2 on grey");
}

// ------------------------------------------------------------------ 8. a tagged square's top (3)
{
  const p = pair(INF, 4, 0, 0, true);
  both(p, INF, 100, {}, 'a tagged square seeded at 4: the owner at its top');
  both(p, RB, 105, {}, 'a tagged square at its top: a rival (one hit: down)');
  const q = pair(INF, 2, 0, 0, true);
  both(q, INF, 100, {}, 'a tagged square at 2: the owner up');
  both(q, INF, 105, {}, 'a tagged square at 3: the owner at its top');
}

console.log(`${timing} hit(s) shown at another time (Areas books a change on the beat, the stand-in shows it at once: said, not failed)`);
console.log(failed ? `FAILED ${failed}` : 'all passed');
process.exit(failed ? 1 : 0);
