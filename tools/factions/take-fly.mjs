#!/usr/bin/env node
// Taking the block in the browser (docs/specs/factions/LIFT.md, "Taking the block"). Part B's legs: the rules on the real page, Rainbow's bus on
// Inferno's block (?lift&lifted=inferno, the bus by the block: &hoodstart&skipintro).
//   - the bus paints as Rainbow; the wave starts; the squares are seeded, the block's at the Lift, and become ready once their houses settle;
//   - a real breath (Splatter.barf) on a ready square of the block: the blast's hook counts it (a crack), and the house it hit keeps the block's paint;
//   - the scripted leg on a square (Lift.qaHit, forceReady between): a crack, a parry, the fall (every house down), two wilts (the houses' levels
//     2 then 1, in the texel and in the session), the flip (every house Rainbow's at level 1 once the front has passed), two ups (levels 2, 3),
//     the third lifting the square as Rainbow's (its houses up, Rainbow's at level 3);
//   - the heart through the sky piece (via 1): a crack, then the fall takes the piece out;
//   - all the way: no program made after the warm-up, no page error, no shader error.
// Part C adds the flight to it, the real cadence, the hold, the stream, the tile and the producer's own link. Writes <out>/take-fly.json; prints
// pass or FAIL a line; exit 1 on any failure.
//
//   node tools/factions/take-fly.mjs <url> <outDir> [--q=<query>]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserOptions } from '../browser.mjs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const base = pos[0] ?? 'http://127.0.0.1:4179/';
const out = resolve(pos[1] ?? 'shots/tmp/take-fly');
mkdirSync(out, { recursive: true });
const Q = opt.q ?? '?lift&lifted=inferno&hoodstart&skipintro&nohud&t=2026-11-06T20:49:00Z&rate=0';
const RB = 1, INF = 5;

let failed = 0;
const log = [];
function report(name, value, limit, ok) {
  if (!ok) failed++;
  log.push({ name, value, limit, ok });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${value}  (${limit})`);
}

const browser = await chromium.launch({ ...browserOptions([]) });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => {
  failed++;
  console.log('[pageerror]', e.message);
});
page.on('console', (m) => {
  if (m.type() !== 'error' || m.text().startsWith('Failed to load resource')) return;
  failed++;
  console.log('[console error]', m.text().slice(0, 1500));
});
await page.addInitScript(() => {
  const W = (window.__tk = { programs: [] });
  const cp = WebGL2RenderingContext.prototype.createProgram;
  WebGL2RenderingContext.prototype.createProgram = function () {
    W.programs.push(Math.round(performance.now()));
    return cp.call(this);
  };
});
await page.goto(base + Q, { waitUntil: 'load' });
const wait = (fn, arg, timeout = 240000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
await wait(() => {
  const g = window.__game, w = g?.warm;
  return !!g && !!w?.report && !w.running && w.report.programs >= g.pipeline.renderer.info.programs.length;
});
const warmDoneAt = await page.evaluate(() => Math.round(window.__game.warm?.doneAt ?? performance.now()));
const now = () => page.evaluate(() => window.__game.lift.now);
const until = async (t) => wait((t) => window.__game.lift.now >= t, t);
const state = () => page.evaluate(() => window.__game.lift.takeState());
const stats = () => page.evaluate(() => ({ ...window.__game.lift.stats }));

report('the bus paints as Rainbow on Inferno\'s block', await page.evaluate(() => window.__game.splatter.faction), String(RB), (await page.evaluate(() => window.__game.splatter.faction)) === RB);
await wait(() => window.__game.lift.waveAt > 0);
const waveAt = await page.evaluate(() => window.__game.lift.waveAt);
let sq = await state();
report('the squares seeded as the block\'s at the Lift', `${sq.length} squares, owners ${[...new Set(sq.map((s) => s.owner))]}, stages ${[...new Set(sq.map((s) => s.stage))]}`, 'some, Inferno\'s, 4 (a tagged heart 3)', sq.length > 2 && sq.every((s) => s.owner === INF && (s.stage === 4 || (s.heart && s.stage === 3))));
// (the squares ready as their houses settle: the near ones a few seconds after the wave)
await wait(() => window.__game.lift.takeState().filter((s) => !s.heart && s.houses.length >= 3 && s.readyAt <= window.__game.lift.now).length >= 3, null, 120000);
sq = await state();
const tNow = await now();
const readyNow = sq.filter((s) => !s.heart && s.houses.length >= 3 && s.readyAt <= tNow);
report('squares ready once their houses settled', `${readyNow.length} ready at ${(tNow - waveAt).toFixed(1)} s after the wave, the first at ${(Math.min(...readyNow.map((s) => s.readyAt)) - waveAt).toFixed(1)} s`, 'at least 3, the first under 12 s', readyNow.length >= 3 && Math.min(...readyNow.map((s) => s.readyAt)) - waveAt < 12);
// (the bus stands by the block's edge: the squares away from it, so no fall is held over it)
const bus = await page.evaluate(() => [window.__game.flight.x, window.__game.flight.z]);
readyNow.sort((a, b) => Math.hypot(b.x - bus[0], b.z - bus[1]) - Math.hypot(a.x - bus[0], a.z - bus[1]));
const A = readyNow[0], B = readyNow[1];

// ---- a real breath on square B: the hook in the blast
{
  const house = B.houses[0];
  const before = await page.evaluate((i) => window.__game.city.paint.get(i), house);
  const t = await page.evaluate((i) => {
    const g = window.__game, ref = g.city.lift.refs.get(i);
    return g.splatter.barf(ref.cx, ref.cz, { target: ref, drop: 40, from: ref.roofY + 120 });
  }, house);
  await until(t + 1.2);
  const after = await page.evaluate((i) => window.__game.city.paint.get(i), house);
  const b = (await state()).find((s) => s.key === B.key);
  report('a real breath on a ready square of the block counts: a crack', `cracks ${b.cracks}, stage ${b.stage}`, 'cracks 1, stage 4', b.cracks === 1 && b.stage === 4);
  report('the house it hit keeps the block\'s paint', `faction ${after.faction} level ${after.level} (was ${before.faction} ${before.level})`, 'as it was', after.faction === before.faction && after.level === before.level);
}

// ---- the scripted leg on square A
const hit = (f, via = 0) => page.evaluate(([x, z, f, via]) => window.__game.lift.qaHit(x, z, f, via), [A.x, A.z, f, via]);
const ready5 = () => page.evaluate(() => window.__game.lift.forceReady());
const rec = async () => (await state()).find((s) => s.key === A.key);
const texels = (houses) => page.evaluate((hs) => hs.map((i) => { const r = window.__game.city.paint.get(i); return [r.faction, Math.round(r.level)]; }), houses);
const all = (rows, f, lv) => rows.every(([a, b]) => a === f && b === lv);
await hit(RB);
let r = await rec();
report('A: the first counted hit cracks it', `stage ${r.stage}, cracks ${r.cracks}`, 'stage 4, cracks 1', r.stage === 4 && r.cracks === 1);
const s0 = await stats();
await hit(RB);
r = await rec();
const s1 = await stats();
report('A: a hit at once after it is parried', `parried ${s0.parried} -> ${s1.parried}, cracks ${r.cracks}`, 'one more parried, cracks 1', s1.parried === s0.parried + 1 && r.cracks === 1);
await ready5();
await hit(RB);
r = await rec();
report('A: the second counted hit takes the Lift off it', `stage ${r.stage}, ${r.falling} of ${r.houses.length} falling`, 'stage 3, its floating houses falling', r.stage === 3 && r.falling > 0);
await wait((k) => window.__game.lift.takeState().find((s) => s.key === k).falling === 0, A.key, 60000).catch(() => {});
r = await rec();
report('A: every house down', `${r.up} up, ${r.falling} falling of ${r.houses.length}`, '0 and 0', r.up === 0 && r.falling === 0);
await ready5();
await hit(RB);
await until((await now()) + 1);
r = await rec();
report('A: the third counted hit wilts it (3 to 2)', `stage ${r.stage}; session levels ${[...new Set(r.paint.map((p) => p[2]))]}; texels ${JSON.stringify([...new Set((await texels(r.houses)).map((x) => x.join('/')))])}`, 'stage 2; 2; Inferno at 2', r.stage === 2 && r.paint.every((p) => p[0] === INF && p[2] === 2) && all(await texels(r.houses), INF, 2));
await ready5();
await hit(RB);
await until((await now()) + 1);
r = await rec();
report('A: the fourth wilts it again (2 to 1)', `stage ${r.stage}; texels ${JSON.stringify([...new Set((await texels(r.houses)).map((x) => x.join('/')))])}`, 'stage 1; Inferno at 1', r.stage === 1 && all(await texels(r.houses), INF, 1));
await ready5();
await hit(RB);
await until((await now()) + 1.6);
r = await rec();
report('A: the fifth flips it to Rainbow, every house Rainbow\'s at level 1 behind the front', `owner ${r.owner} stage ${r.stage}; texels ${JSON.stringify([...new Set((await texels(r.houses)).map((x) => x.join('/')))])}`, 'owner 1 stage 1; 1/1', r.owner === RB && r.stage === 1 && all(await texels(r.houses), RB, 1));
await ready5();
await hit(INF);
r = await rec();
report('A: Inferno now hits it as a rival (ready, stage 1)', `owner ${r.owner}`, 'Inferno\'s again (a flip): the rules are the hitter\'s, whoever', r.owner === INF);
await ready5();
await hit(RB);
await until((await now()) + 1.6);
r = await rec();
report('A: and Rainbow flips it back', `owner ${r.owner}; texels ${JSON.stringify([...new Set((await texels(r.houses)).map((x) => x.join('/')))])}`, 'owner 1; 1/1', r.owner === RB && all(await texels(r.houses), RB, 1));
for (const lv of [2, 3]) {
  await ready5();
  await hit(RB);
  await until((await now()) + 1.6);
  r = await rec();
  report(`A: an up to ${lv}`, `stage ${r.stage}; texels ${JSON.stringify([...new Set((await texels(r.houses)).map((x) => x.join('/')))])}`, `stage ${lv}; 1/${lv}`, r.stage === lv && all(await texels(r.houses), RB, lv));
}
const sUp = await stats();
await ready5();
await hit(RB);
await until((await now()) + 4);
r = await rec();
const sUp2 = await stats();
report('A: the third up lifts the square as Rainbow\'s', `stage ${r.stage}, ${r.up} of ${r.houses.length} up, lifted as taker ${sUp2.liftedAsTaker - sUp.liftedAsTaker}; texels ${JSON.stringify([...new Set((await texels(r.houses)).map((x) => x.join('/')))])}`, 'stage 4, all up, Rainbow at 3', r.stage === 4 && r.up === r.houses.length && sUp2.liftedAsTaker > sUp.liftedAsTaker && all(await texels(r.houses), RB, 3));
await ready5();
await hit(RB);
r = await rec();
report('A: Rainbow\'s hit on its own square at the top is an encore', `stage ${r.stage}, cracks ${r.cracks}`, 'stage 4, cracks 0', r.stage === 4 && r.cracks === 0);

// ---- the heart through the sky piece
{
  const heart = (await state()).find((s) => s.heart);
  const hasSky = await page.evaluate(() => !!window.__game.lift.sky);
  if (hasSky && heart.stage === 4) {
    await wait(() => window.__game.lift.takeState().find((s) => s.heart).readyAt <= window.__game.lift.now, null, 60000).catch(() => {});
    const hv = (f) => page.evaluate(([f]) => window.__game.lift.qaHit(-1e9, -1e9, f, 1), [f]);
    await hv(RB);
    let h = (await state()).find((s) => s.heart);
    report('the heart through the sky piece: a crack', `stage ${h.stage}, cracks ${h.cracks}`, 'stage 4, cracks 1', h.stage === 4 && h.cracks === 1);
    await ready5();
    await hv(RB);
    h = (await state()).find((s) => s.heart);
    const sky = await page.evaluate(() => !!window.__game.lift.sky);
    report('and its fall takes the piece out', `stage ${h.stage}, the piece ${sky ? 'still there' : 'gone'}`, 'stage 3, gone', h.stage === 3 && !sky);
  } else report('the heart through the sky piece', `no piece (${hasSky}) or the heart at ${heart.stage}`, 'Inferno\'s piece at the Lift', false);
}

const programs = await page.evaluate((t) => window.__tk.programs.filter((p) => p > t).length, warmDoneAt);
report('programs made after the warm-up', String(programs), '0', programs === 0);
const end = await stats();
await browser.close();
writeFileSync(`${out}/take-fly.json`, JSON.stringify({ q: Q, waveAt, stats: end, log }, null, 1));
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
