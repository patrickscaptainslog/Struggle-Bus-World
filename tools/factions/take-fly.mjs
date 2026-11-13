#!/usr/bin/env node
// Taking the block in the browser (docs/specs/factions/LIFT.md, "Taking the block"). First the producer's own link, ?lift&lifted=inferno (not
// with --q): the start far off, a real tap's paint Rainbow's, the block waking ahead of the bus flown to it at Nonstop by a real flick, a real
// tap through the sky piece counted on the heart. Then part B's legs: the rules on the real page, Rainbow's bus on Inferno's block (the bus by
// the block: &hoodstart&skipintro).
//   - the bus paints as Rainbow; the wave starts; the squares are seeded, the block's at the Lift, and become ready once their houses settle;
//   - a real breath (Splatter.barf) on a ready square of the block: the blast's hook counts it (a crack), and the house it hit keeps the block's paint;
//   - the scripted leg on a square (Lift.qaHit, forceReady between): a crack, a parry, the fall (every house down), two wilts (the houses' levels
//     2 then 1, in the texel and in the session), the flip (every house Rainbow's at level 1 once the front has passed), two ups (levels 2, 3),
//     the third lifting the square as Rainbow's (its houses up, Rainbow's at level 3);
//   - the heart through the sky piece (via 1): a crack, then the fall takes the piece out;
//   - all the way: no program made after the warm-up, no page error, no shader error.
// Part C's: the crack's sink (or its hold) and the waiting glint, the houses falling through the air and each landing once, the sky piece
// coming down in its cut program and then out; the flip's chime once, as its front ends; a landing's corner bursts. And:
//   - the real cadence on a third square: a real breath every 2.6 s from its ready time until it flips, each counted or parried, logged;
//   - the hold: the bus pinned under a floating house of a fourth square as it loses the Lift: that house stays up past its fall's time, houses
//     off the bus's path come down round it, a hit on the square is parried meanwhile, and the rest come down once the bus has gone;
//   - with &veins=stay in --q (call 5), the veins' band on the square as each change leaves it (1 after the fall, 2, 3, 0 after an up).
// Still to add: the stream and the tile (design B1). Writes <out>/take-fly.json; prints pass or FAIL a line; exit 1 on any failure.
//
//   node tools/factions/take-fly.mjs <url> <outDir> [--q=<query>]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserOptions } from '../browser.mjs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// (split at the first '=' only: a query has its own)
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => (a.includes('=') ? [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a.slice(2), true])));
const base = pos[0] ?? 'http://127.0.0.1:4179/';
const out = resolve(pos[1] ?? 'shots/tmp/take-fly');
mkdirSync(out, { recursive: true });
const Q = opt.q ?? '?lift&lifted=inferno&hoodstart&skipintro&nohud&t=2026-11-06T20:49:00Z&rate=0';
const RB = 1, INF = 5;
const stay = new URLSearchParams(Q).get('veins') === 'stay';

let failed = 0;
const log = [];
function report(name, value, limit, ok) {
  if (!ok) failed++;
  log.push({ name, value, limit, ok });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${value}  (${limit})`);
}

const browser = await chromium.launch({ ...browserOptions([]) });
/** a page on `q`, warmed up: its page and console errors fail the run, its programs counted (__tk) */
async function open(q) {
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
  await page.goto(base + q, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const g = window.__game, w = g?.warm;
    return !!g && !!w?.report && !w.running && w.report.programs >= g.pipeline.renderer.info.programs.length;
  }, null, { timeout: 240000, polling: 100 });
  page.warmDoneAt = await page.evaluate(() => Math.round(window.__game.warm?.doneAt ?? performance.now()));
  return page;
}

// ---- the producer's own link (?lift&lifted=inferno: the opening under the Golden Gate, no &hoodstart, no &skipintro) and their notes of
// 2026-11-12 on it: the start far from the block, the bus's own paint by a real tap, the block waking ahead of a bus flown to it at Nonstop by
// a real flick (the distance, height and bearing at the wave logged; a fail if the bus is in the block already), and a real tap whose line of
// fire crosses the sky piece counted on the heart (Aim's sky test, Shot.via, the blast's via: the review's finding 2). Not with --q.
if (!opt.q && !opt.noflight) {
  const pp = await open(Q.replace('&hoodstart&skipintro', ''));
  const pw = (fn, arg, timeout = 240000) => pp.waitForFunction(fn, arg, { timeout, polling: 100 });
  const pnow = () => pp.evaluate(() => window.__game.lift.now);
  const after = async (dt) => pw((t) => window.__game.lift.now >= t, (await pnow()) + dt);
  // (the bus's distance across the ground to the nearest staged square, as the wake measures it (null before staging), to the heart, its
  // height over the heart's ground, how far the heart is off its heading (degrees, + to the right), its ground speed)
  const where = () => pp.evaluate(() => {
    const g = window.__game, L = g.lift, f = g.flight, r = L.stagedRects;
    let dh = Infinity;
    for (let k = 0; k < r.length; k += 4) dh = Math.min(dh, Math.hypot(Math.max(r[k] - f.x, 0, f.x - r[k + 2]), Math.max(r[k + 1] - f.z, 0, f.z - r[k + 3])));
    const hx = L.heart[0] - f.x, hz = L.heart[1] - f.z;
    let off = Math.atan2(hx, -hz) - f.heading;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    return { t: +L.now.toFixed(2), dh: dh === Infinity ? null : +dh.toFixed(0), heart: +Math.hypot(hx, hz).toFixed(0), h: +(f.y - (L.heartY || g.city.groundAt(L.heart[0], L.heart[1]))).toFixed(0), off: +((off * 180) / Math.PI).toFixed(0), speed: +f.ground.toFixed(0), staged: L.staged, waveAt: +L.waveAt.toFixed(2) };
  });
  const w0 = await where();
  report("the producer's link: the bus starts far from the block, its wave not begun", `${w0.heart} m from the heart, the wave at ${w0.waveAt}`, 'over 3 km; not begun (-1)', w0.heart > 3000 && w0.waveAt < 0);
  const fac = await pp.evaluate(() => window.__game.splatter.faction);
  report("the producer's link: the bus paints as Rainbow", String(fac), String(RB), fac === RB);
  // (the opening hands over at about 18 s: then a real flick takes Nonstop and the QA stick steers at the heart)
  await pw(() => window.__game.lift.now >= 19);
  const cdp = await pp.context().newCDPSession(pp);
  const { flickTo } = await import('../flick.mjs');
  await flickTo(pp, cdp, 2);
  // (the stick's way round: a half stick for half a second, and which way the heading went)
  const h0 = await pp.evaluate(() => ((window.__qa = window.__qa ?? {}), (window.__qa.sx = 0.5), (window.__qa.sy = 0), window.__game.flight.heading));
  await after(0.5);
  const turn = Math.sign((await pp.evaluate(() => window.__game.flight.heading)) - h0) || 1;
  const steer = () => pp.evaluate((turn) => {
    const g = window.__game, L = g.lift, f = g.flight;
    let e = Math.atan2(L.heart[0] - f.x, -(L.heart[1] - f.z)) - f.heading;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    window.__qa.sx = Math.max(-1, Math.min(1, 2 * e * turn));
    return L.waveAt;
  }, turn);
  let wave = null;
  const t0 = await pnow();
  while (wave === null && (await pnow()) < t0 + 75) {
    const wa = await steer();
    const w = await where();
    if (wa > 0) wave = w;
    await pp.waitForTimeout(40);
  }
  await pp.evaluate(() => (window.__qa.sx = 0));
  report("the producer's link: the block wakes ahead of the bus flown to it at Nonstop", wave ? `at ${wave.t} s: ${wave.dh} m from the block, ${wave.h} m over the heart's ground, the heart ${wave.off} degrees off the heading and ${wave.heart} m off, ${wave.speed} m/s` : 'no wave in 75 s',
    'a wave, the bus not in the block yet (over 0 m from it)', !!wave && wave.dh !== null && wave.dh > 0);
  // ---- a real tap on the city off the block: the bus held still 1.5 km out from the heart, 40 m up, its glint on a building of no seeded
  // square; the paint it leaves is Rainbow's (at Nonstop on the way a breath's 1 s rarely met a roof: held, it's the tap the producer makes)
  let painted = null;
  for (const [ox, oz] of [[0, 1500], [1500, 0], [0, -1500], [-1500, 0]]) {
    if (painted) break;
    const at = await pp.evaluate(([ox, oz]) => {
      const g = window.__game, L = g.lift, x = L.heart[0] + ox, z = L.heart[1] + oz;
      window.__qa.pin = { x, y: g.city.groundAt(x, z) + 40, z, heading: Math.atan2(-ox, oz), speed: 0 };
      return g.lift.now;
    }, [ox, oz]);
    await pw((t) => window.__game.lift.now >= t, at + 0.8);
    painted = await pp.evaluate(() => {
      const g = window.__game, gl = g.glintNow();
      if (!gl || g.lift.refuses(gl.cx, gl.cz, 0)) return null;
      g.forceReady();
      const t = g.lift.now;
      g.tapSplat();
      const s = g.lastShot();
      return s && s.t >= t - 0.001 && s.target ? { i: s.target.index, at: s.t + s.travel } : null;
    });
  }
  if (painted) {
    await pw((t) => window.__game.lift.now >= t, painted.at + 0.6);
    const p = await pp.evaluate((i) => window.__game.city.paint.get(i), painted.i);
    report("the producer's link: a real tap on the city off the block paints Rainbow's", `building ${painted.i}: faction ${p.faction} level ${Math.round(p.level)}`, 'faction 1', p.faction === RB);
  } else report("the producer's link: a real tap on the city off the block paints Rainbow's", 'no held pose had a glint off the block', 'one', false);
  // ---- the real aim through the sky piece: the bus held where a loaded breath's line of fire crosses the piece, then a real tap
  await pw(() => !!window.__game.lift.sky && window.__game.lift.takeState().find((s) => s.heart).readyAt <= window.__game.lift.now, null, 60000).catch(() => {});
  const pose = await pp.evaluate(() => {
    const L = window.__game.lift, b = L.sky?.boxes;
    if (!b) return null;
    let y1 = -Infinity;
    for (let k = 0; k + 5 < b.length; k += 6) y1 = Math.max(y1, b[k + 4]);
    return { hx: L.heart[0], hz: L.heart[1], y1 };
  });
  let aimed = null;
  if (pose)
    for (const d of [150, 250, 350, 500])
      for (const up of [20, 60, 120, 200]) {
        if (aimed) break;
        // (south of the heart, heading north at it: Flight's heading 0 flies along -z)
        const pin = { x: pose.hx, y: pose.y1 + up, z: pose.hz + d, heading: 0 };
        await pp.evaluate((p) => ((window.__qa.pin = p), window.__game.forceReady()), pin);
        await after(0.3);
        if (await pp.evaluate(() => (window.__game.forceReady(), window.__game.aimer.skyAimed))) aimed = pin;
      }
  if (aimed) {
    const c0 = await pp.evaluate(() => window.__game.lift.takeState().find((s) => s.heart).cracks);
    const at = await pp.evaluate(() => {
      const g = window.__game;
      g.forceReady();
      g.tapSplat();
      const s = g.lastShot();
      return s ? s.t + s.travel : null;
    });
    if (at !== null) await pw((t) => window.__game.lift.now >= t, at + 0.6);
    const hrt = await pp.evaluate(() => window.__game.lift.takeState().find((s) => s.heart));
    report("the producer's link: a real tap through the sky piece counts on the heart", `held ${aimed.y - pose.y1} m over the piece's top, ${aimed.z - pose.hz} m out; the heart's cracks ${c0} -> ${hrt.cracks}, stage ${hrt.stage}`, 'a crack, stage 4', hrt.cracks === c0 + 1 && hrt.stage === 4);
  } else report("the producer's link: a real tap through the sky piece counts on the heart", pose ? 'no pose put the line of fire through the piece' : 'no piece', 'a pose and a crack', false);
  await pp.evaluate(() => (window.__qa.pin = null));
  const pg = await pp.evaluate((t) => window.__tk.programs.filter((p) => p > t).length, pp.warmDoneAt);
  report("the producer's link: programs made after the warm-up", String(pg), '0', pg === 0);
  await pp.close();
}

const page = await open(Q);
const wait = (fn, arg, timeout = 240000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const warmDoneAt = page.warmDoneAt;
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

// ---- the real cadence on square C: a real breath every 2.6 s (this branch's tap: a 1.0 s breath, a 1.6 s recharge) from its ready time, until it flips
{
  const C = readyNow[2];
  const house = C.houses[0];
  const tap = () => page.evaluate((i) => {
    const g = window.__game, ref = g.city.lift.refs.get(i);
    return g.splatter.barf(ref.cx, ref.cz, { target: ref, drop: 40, from: ref.roofY + 120 });
  }, house);
  const seq = [], counted = [];
  let T = Math.max(await now(), C.readyAt - 1.0), c;
  for (let k = 0; k < 16; k++) {
    await until(T);
    const s0 = await stats();
    const lt = await tap();
    await until(lt + 0.05);
    const s1 = await stats();
    c = (await state()).find((s) => s.key === C.key);
    const o = s1.counted > s0.counted ? 'c' : s1.parried > s0.parried ? 'p' : '?';
    seq.push(o);
    if (o === 'c') counted.push(lt);
    if (c.owner === RB) break;
    T += 2.6;
  }
  const gaps = counted.slice(1).map((t, k) => t - counted[k]);
  report('the real cadence on one square: a breath every 2.6 s from its ready time to the flip', `${seq.join(' ')}: ${seq.length} taps, ${counted.length} counted, ${seq.filter((o) => o === 'p').length} parried, owner ${c.owner}; counted ${gaps.map((g) => g.toFixed(1)).join(', ')} s apart`,
    '5 counted to the flip, at least 4 parried, every counted at least 5 s after the last (the design reads 9 taps, 4 parried; the fall\'s houses in the air add waits)',
    c.owner === RB && counted.length === 5 && seq.filter((o) => o === 'p').length >= 4 && !seq.includes('?') && gaps.every((g) => g >= 4.99));
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
// (part C: its sink starts once no house of it would sink onto the bus or the lens; the glint on it is the waiting one now)
await until((await now()) + 0.3);
const ck = await page.evaluate(([k, i]) => ({ crack: window.__game.lift.takeSq.get(k).crack, wait: window.__game.lift.takeSq.get(k).sinkWait, waiting: window.__game.lift.waiting(i), held: window.__game.lift.stats.crackHeld }), [A.key, A.houses[0]]);
report('A: the sink of the crack under way (or held for the bus), and its houses waiting for the glint', `crack at ${ck.crack.toFixed(2)}, waiting for the bus ${ck.wait} (${ck.held} frames), the glint's wait ${ck.waiting}`, 'a crack time or a hold; waiting', (ck.crack > 0 || ck.wait) && ck.waiting === true);
const s0 = await stats();
await hit(RB);
r = await rec();
const s1 = await stats();
report('A: a hit at once after it is parried', `parried ${s0.parried} -> ${s1.parried}, cracks ${r.cracks}`, 'one more parried, cracks 1', s1.parried === s0.parried + 1 && r.cracks === 1);
await ready5();
await hit(RB);
r = await rec();
report('A: the second counted hit takes the Lift off it', `stage ${r.stage}, ${r.falling} of ${r.houses.length} falling`, 'stage 3, its floating houses falling', r.stage === 3 && r.falling > 0);
// (part C: the houses come down in the air, a wall to the flight while they fall, and land)
const nFall = r.falling, land0 = (await stats()).landings, corner0 = (await stats()).cornerBursts;
await wait((hs) => hs.some((i) => window.__game.lift.state[i] === 3 && window.__game.lift.dy(i) > 2), A.houses, 20000).catch(() => {});
const mid = await page.evaluate((hs) => hs.filter((i) => window.__game.lift.state[i] === 3).map((i) => +window.__game.lift.dy(i).toFixed(1)), A.houses);
report('A: its houses fall through the air (state 3, drawn above the ground)', `${mid.length} falling, heights ${mid.slice(0, 6).join(', ')} m`, 'some, over 2 m', mid.length > 0 && mid.some((h) => h > 2));
await wait((k) => window.__game.lift.takeState().find((s) => s.key === k).falling === 0, A.key, 60000).catch(() => {});
r = await rec();
report('A: every house down', `${r.up} up, ${r.falling} falling of ${r.houses.length}`, '0 and 0', r.up === 0 && r.falling === 0);
const land1 = (await stats()).landings;
report('A: each one landed once', `${land1 - land0} landings for ${nFall} falls`, 'equal', land1 - land0 === nFall);
const corner1 = (await stats()).cornerBursts;
report('A: each landing bursts its lake\'s colours at its corners', `${corner1 - corner0} for ${land1 - land0} landings`, 'one a landing (its tile in)', corner1 - corner0 === land1 - land0);
if (stay) report('&veins=stay: the crack\'s band stays after the fall', `band ${r.band}`, '1', r.band === 1);
await ready5();
const sW0 = await stats();
await hit(RB);
await until((await now()) + 1);
r = await rec();
const sW1 = await stats();
// (part C: each house's going garden covered by the owner's petals as the shockwave reaches it, its tile in)
report('A: the wilt\'s petals, a burst a house as its front arrives', `${sW1.wiltPetals - sW0.wiltPetals} bursts for ${r.houses.length} houses`, 'some, one a house at most', sW1.wiltPetals > sW0.wiltPetals && sW1.wiltPetals - sW0.wiltPetals <= r.houses.length);
if (stay) report('&veins=stay: a band more at the third (stage 2)', `band ${r.band}`, '2', r.band === 2);
report('A: the third counted hit wilts it (3 to 2)', `stage ${r.stage}; session levels ${[...new Set(r.paint.map((p) => p[2]))]}; texels ${JSON.stringify([...new Set((await texels(r.houses)).map((x) => x.join('/')))])}`, 'stage 2; 2; Inferno at 2', r.stage === 2 && r.paint.every((p) => p[0] === INF && p[2] === 2) && all(await texels(r.houses), INF, 2));
await ready5();
await hit(RB);
await until((await now()) + 1);
r = await rec();
if (stay) report('&veins=stay: a band more at the fourth (stage 1)', `band ${r.band}`, '3', r.band === 3);
report('A: the fourth wilts it again (2 to 1)', `stage ${r.stage}; texels ${JSON.stringify([...new Set((await texels(r.houses)).map((x) => x.join('/')))])}`, 'stage 1; Inferno at 1', r.stage === 1 && all(await texels(r.houses), INF, 1));
await ready5();
const sF0 = await stats();
await hit(RB);
await until((await now()) + 1.6);
r = await rec();
const sF1 = await stats();
report('A: the flip\'s front arrives at each house (its note and petals)', `${sF1.fronted - sF0.fronted} arrivals for ${r.houses.length} houses`, 'some, one a house at most', sF1.fronted > sF0.fronted && sF1.fronted - sF0.fronted <= r.houses.length);
report('A: the flip\'s chime once, as its front ends', `${sF1.frontEnds - sF0.frontEnds}`, '1', sF1.frontEnds - sF0.frontEnds === 1);
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
  if (stay && lv === 2) report('&veins=stay: the veins go at the next change after the flip', `band ${r.band}`, '0', r.band === 0);
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
// (part C: an encore's claim line flares in the owner's hues: tTake's parry time negative, never the parry's white or its walls' shimmer)
const tEnc = await now();
report('A: the encore flares the claim line, not the parry\'s', `parry time ${r.parry.toFixed(2)} at ${tEnc.toFixed(2)}`, 'minus the encore\'s time', r.parry < 0 && Math.abs(-r.parry - tEnc) < 2);

// ---- the hold: the bus pinned under a floating house of square D as the square loses the Lift
{
  const t = await now();
  const D = (await state()).find((s) => !s.heart && ![A.key, B.key, readyNow[2].key].includes(s.key) && s.houses.length >= 3 && s.up === s.houses.length && s.readyAt <= t + 30 && s.stage === 4);
  if (!D) report('the hold', 'no fourth square at the Lift', 'one', false);
  else {
    // (its highest-floating house: the bus 6 m over the ground under its middle)
    const pick = await page.evaluate((hs) => {
      const L = window.__game.lift;
      const i = hs.slice().sort((a, b) => L.H[b] - L.H[a])[0], ref = L.refs.get(i);
      return { i, x: ref.cx, z: ref.cz, y: window.__game.city.groundAt(ref.cx, ref.cz) + 6, H: L.H[i] };
    }, D.houses);
    // (the QA's hooks are the tool's to make: main reads window.__qa each frame)
    await page.evaluate((p) => ((window.__qa = window.__qa ?? {}), (window.__qa.pin = { x: p.x, y: p.y, z: p.z, heading: 0 })), pick);
    await wait((k) => window.__game.lift.takeState().find((s) => s.key === k).readyAt <= window.__game.lift.now, D.key, 60000).catch(() => {});
    const hitD = (f) => page.evaluate(([x, z, f]) => window.__game.lift.qaHit(x, z, f, 0), [D.x, D.z, f]);
    await hitD(RB);
    await ready5();
    const h0 = (await stats()).fallHeld;
    await hitD(RB);
    let d = (await state()).find((s) => s.key === D.key);
    // (the one over the bus stays up, and so does every house near the bus's swept path, its own time to land at the bus's ground speed ahead
    // (fallBlocked, takeLead), or the lens's; houses off it come down round the bus. The whole of its fall's time and more)
    await until((await now()) + 6);
    const mid = await page.evaluate(([k, i]) => ({ st: window.__game.lift.state[i], falling: window.__game.lift.takeState().find((s) => s.key === k).falling, down: window.__game.lift.takeState().find((s) => s.key === k).houses.filter((j) => window.__game.lift.state[j] === 0).length }), [D.key, pick.i]);
    const held = (await stats()).fallHeld - h0;
    report('the hold: the house over the bus stays up, held, past its fall\'s time, and houses off its path come down', `stage ${d.stage}; the house's state ${mid.st} 6 s on; ${mid.falling} of ${d.houses.length} still queued, ${mid.down} down; held ${held} house-frames (its rest ${pick.H.toFixed(1)} m, the bus 6 m up)`, 'stage 3; up (2), queued, held > 0, some down', d.stage === 3 && mid.st === 2 && mid.falling >= 1 && held > 0 && mid.down >= 1);
    await ready5();
    const p0 = (await stats()).parried;
    await hitD(RB);
    d = (await state()).find((s) => s.key === D.key);
    const p1 = (await stats()).parried;
    report('the hold: a hit on the square while its house waits is parried', `parried ${p1 - p0}, stage ${d.stage}`, '1, stage 3', p1 - p0 === 1 && d.stage === 3);
    // (the bus goes 300 m off: the house comes down and lands)
    await page.evaluate((p) => (window.__qa.pin = { x: p.x + 300, y: p.y + 40, z: p.z, heading: 0 }), pick);
    await wait(([k]) => window.__game.lift.takeState().find((s) => s.key === k).falling === 0, [D.key], 30000).catch(() => {});
    d = (await state()).find((s) => s.key === D.key);
    const st = await page.evaluate((i) => window.__game.lift.state[i], pick.i);
    report('the hold: once the bus has gone it comes down', `the house's state ${st}, ${d.falling} falling, ${d.up} up`, 'on the ground (0), 0, 0', st === 0 && d.falling === 0 && d.up === 0);
    await page.evaluate(() => (window.__qa.pin = null));
  }
}

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
    // (part C: the aim's glint on the piece: a step dimmer while the heart waits, brighter once it takes the hit, nothing when not aimed at)
    const glint = (on) => page.evaluate((on) => [window.__game.lift.skyGlint(on), window.__game.lift.sky.mesh.material.uniforms.uSkyGlint.value], on);
    const gWait = await glint(true);
    await ready5();
    // (the square's ready time follows its record a frame later)
    await until((await now()) + 0.2);
    const gReady = await glint(true), gOff = await glint(false);
    report('the sky piece\'s glint: waiting, ready, not aimed at', `${gWait.join('/')}, ${gReady.join('/')}, ${gOff.join('/')}`, '-1/-1, 1/1, 0/0', gWait.join() === '-1,-1' && gReady.join() === '1,1' && gOff.join() === '0,0');
    await ready5();
    await hv(RB);
    h = (await state()).find((s) => s.heart);
    // (part C: it comes down over 1 s in its cut program, then goes)
    await until((await now()) + 0.2);
    const down = await page.evaluate(() => ({ sky: !!window.__game.lift.sky, cut: window.__game.lift.sky?.mesh.material.defines?.SB_CUT !== undefined }));
    await until((await now()) + 1.1);
    const sky = await page.evaluate(() => !!window.__game.lift.sky), skyOut = (await stats()).skyOut;
    report('and its fall brings the piece down in its cut program, then takes it out', `stage ${h.stage}; at the hit the piece ${down.sky ? 'there' : 'gone'}, its cut program ${down.cut}; 1.3 s on ${sky ? 'still there' : 'gone'}, out ${skyOut}`, 'stage 3; there; cut; gone, out 1', h.stage === 3 && down.sky && !sky && skyOut === 1);
  } else report('the heart through the sky piece', `no piece (${hasSky}) or the heart at ${heart.stage}`, 'Inferno\'s piece at the Lift', false);
}

const programs = await page.evaluate((t) => window.__tk.programs.filter((p) => p > t).length, warmDoneAt);
report('programs made after the warm-up', String(programs), '0', programs === 0);
const end = await stats();
await browser.close();
writeFileSync(`${out}/take-fly.json`, JSON.stringify({ q: Q, waveAt, stats: end, log }, null, 1));
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
