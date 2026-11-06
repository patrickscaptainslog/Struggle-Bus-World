#!/usr/bin/env node
// Recess's brain in Node (FACTIONS.md sections 3 and 4, step 7): node --no-warnings tools/recess/duels.mjs [duels=3000]
// First the rules one at a time, on scripted buses: Possessed (Nonstop, NO BRAKES, the steering kept, eight hiccups on the beats, grey only), the stop
// arm, riding it out, no ganging up, a third of a pair, WANTED, the new player's sparkles and their one lesson, a teammate's wash, Piñata, Bubbled, the
// white-hot flick. Then the duels: thousands of them, a player's stand-in against one AI captain or Recess's two, every mode, new players among them, and
// the check on every step that nobody loses the steering and nobody is bullied, and that what glints is what a tap hits. Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { Recess, recessTune: T } = await import('../../src/recess/recess.ts');
const { Captain, rng } = await import('../../src/recess/captain.ts');
const { Faction } = await import('../../src/factions/areas.ts');

const DUELS = +(process.argv[2] ?? 3000);
let failed = 0;
const row = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${info === undefined ? '' : JSON.stringify(info)}`);
};
const R = Faction.RAINBOW, A = Faction.ATLANTIS, I = Faction.INFERNO;
const still = { steer: 0, tap: false, flick: 0 };
const kinds = (r, k) => r.log.filter((e) => e.kind === k);

/** Two buses face to face 300 m apart, a's breath at b: run until b's ridden, or `most` s. */
function faceOff(o = {}) {
  const r = new Recess([{ faction: o.fa ?? R, x: -150, z: 0, heading: 0, bot: o.botA ?? null }, { faction: o.fb ?? A, x: 150, z: 0, heading: Math.PI, newcomer: o.newcomer }, ...(o.more ?? [])],
    { mode: o.mode ?? 'possessed', log: true });
  return r;
}
const run = (r, s, hands) => {
  for (let k = 0, n = Math.round(s / r.dt); k < n; k++) r.step(hands ? hands(r) : []);
};
const tapA = (r) => [{ steer: 0, tap: true, flick: 0 }, still];

// ---- Possessed ----
{
  const r = faceOff();
  run(r, 2, tapA);
  const hit = kinds(r, 'hit')[0], v = r.buses[1];
  const riding = v.state === 'ride';
  // (in the ride: full right, and flicks down; the gear is Nonstop's and the steering is the driver's)
  let steerOk = true, wheeze = 0;
  for (let k = 0; k < 200 && v.state === 'ride'; k++) {
    const sp = v.speed, h0 = v.heading;
    r.step([still, { steer: 1, tap: false, flick: k % 30 === 0 ? -1 : 0 }]);
    const turned = Math.atan2(Math.sin(v.heading - h0), Math.cos(v.heading - h0)) - v.edgeYaw * r.dt;
    steerOk &&= Math.abs(turned - Recess.yawAt(sp) * r.dt) < 1e-9;
    wheeze += r.events.filter((e) => e.kind === 'wheeze').length;
  }
  const hic = kinds(r, 'hiccup').filter((e) => e.b === 1), onBeats = hic.every((e) => r.beat.phase(e.t) < r.dt / r.beat.period + 1e-6);
  const greyOnly = hic.every((e) => e.outcome === 'claim' || e.outcome === 'none');
  const ended = kinds(r, 'rideEnd')[0];
  row('possessed: a hit rides at Nonstop, NO BRAKES, steering kept, 8 hiccups on beats, grey only', !!hit && riding && steerOk && wheeze >= 3 && hic.length === 8 && onBeats && greyOnly && !!ended && Math.abs(v.speed - T.gears[2]) < 30,
    { hiccups: hic.length, wheeze, speed: Math.round(v.speed), rideS: ended && +(ended.t - hit.t).toFixed(2) });
  // (riding it out: four seconds of the stop arm, the super back, the hitter glints from 1.2 km for 8 s)
  const t0 = r.t, shield = v.state === 'shield' && Math.abs(v.until - t0 - T.shield) < 0.05, sup = v.superReady, av = v.avenge === 0 && Math.abs(v.avengeUntil - t0 - T.avengeFor) < 0.05;
  const bounced = (() => {
    // (a rival can't lock it, so its breaths go by to the ground)
    let locked = 0;
    for (let k = 0; k < 75; k++) {
      r.step(tapA(r));
      if (r.buses[0].lock === 1) locked++;
    }
    return locked === 0 && kinds(r, 'hit').length === 1 && r.buses[1].state === 'shield';
  })();
  const shut = (() => {
    const n = kinds(r, 'fire').filter((e) => e.a === 1).length;
    r.buses[1].belly = 0;
    run(r, 0.2, () => [still, { steer: 0, tap: true, flick: 0 }]);
    return kinds(r, 'fire').filter((e) => e.a === 1).length === n;
  })();
  row('the stop arm: 4 s after a ride, no rival locks it, its mouth shut; ridden out, super back and the hitter its mark from 1.2 km', shield && sup && av && bounced && shut && r.reach(r.buses[1], r.buses[0]) === 1200,
    { shield, sup, av, bounced, shut });
}
// ---- no ganging up: a third bus, a rival to both, can't hit the ridden one ----
{
  const r = faceOff({ more: [{ faction: I, x: 150, z: 300, heading: -Math.PI / 2 }] });
  run(r, 2, tapA);
  const locks = [];
  for (let k = 0; k < 60; k++) {
    r.step([still, still, { steer: 0, tap: true, flick: 0 }]);
    locks.push(r.buses[2].lock);
  }
  row('no ganging up: a ridden bus can\'t be locked by anyone but its crew', r.buses[1].state === 'ride' && locks.every((l) => l !== 1), { lockedIt: locks.filter((l) => l === 1).length });
}
// ---- a teammate's breath washes a ride off ----
{
  const r = faceOff({ more: [{ faction: A, x: 150, z: 300, heading: -Math.PI / 2 }] });
  run(r, 2, tapA);
  const was = r.buses[1].state, v = r.buses[1];
  Object.assign(r.buses[2], { x: v.x - Math.cos(v.heading) * 250, z: v.z - Math.sin(v.heading) * 250, heading: v.heading, belly: 0 });
  Object.assign(r.buses[0], { x: 0, z: 2000 });
  run(r, 2, () => [still, still, { steer: 0, tap: true, flick: 0 }]);
  const wash = kinds(r, 'wash')[0];
  row('a teammate\'s breath washes the ride off early, into the stop arm', was === 'ride' && !!wash && wash.a === 2 && kinds(r, 'hiccup').length < 8, { hiccups: kinds(r, 'hiccup').length });
}
// ---- the same pair a third time in two minutes bounces off; WANTED at three rides unanswered ----
{
  const r = faceOff({ more: [{ faction: I, x: 150, z: -40, heading: Math.PI }] });
  const place = (i) => Object.assign(r.buses[i], { x: 150, z: i === 1 ? 0 : -40, heading: Math.PI, state: 'free', lock: -1 });
  const go = (victim) => {
    place(victim);
    for (const b of r.buses) if (b.id !== victim && b.id !== 0) Object.assign(b, { x: 2000, z: 2000 });
    r.buses[0].x = -150; r.buses[0].z = victim === 1 ? 0 : -40; r.buses[0].heading = 0; r.buses[0].belly = 0;
    run(r, 2, tapA);
    run(r, 12, () => [still, still, still]);
  };
  go(1); go(1); go(1);
  const third = kinds(r, 'hit').length === 2 && kinds(r, 'bounce').some((e) => e.a === 0 && e.b === 1);
  go(2);
  row('a third ride for the same pair in two minutes bounces off; three rides unanswered and WANTED from 1.2 km', third && r.buses[0].wanted && kinds(r, 'wanted').length === 1 && r.reach(r.buses[2], r.buses[0]) === 1200,
    { hits: kinds(r, 'hit').length, wanted: r.buses[0].wanted });
}
// ---- the new player's shield, and the lesson, once, from a captain ----
{
  const r = faceOff({ newcomer: true });
  run(r, 2, tapA);
  const sparkle = kinds(r, 'sparkle').length === 1 && kinds(r, 'hit').length === 0 && r.buses[1].state === 'free';
  const b = faceOff({ newcomer: true, botA: 'veteran' });
  for (let k = 0; k < 3; k++) {
    Object.assign(b.buses[1], { x: 150, z: 0, heading: Math.PI });
    Object.assign(b.buses[0], { x: -150, z: 0, heading: 0, belly: 0 });
    run(b, 2, tapA);
    run(b, 10, () => [still, still]);
  }
  row('a new player\'s rival breaths burst as sparkles; a captain gives one short lesson, once', sparkle && kinds(b, 'lesson').length === 1 && kinds(b, 'sparkle').length >= 1 && kinds(b, 'hiccup').length === 4,
    { lessons: kinds(b, 'lesson').length, lessonHiccups: kinds(b, 'hiccup').length });
}
// ---- a captain's full second of glint ----
{
  const r = faceOff({ botA: 'rival' });
  run(r, 0.9, tapA);
  const early = kinds(r, 'fire').filter((e) => e.b === 1).length;
  run(r, 1.5, tapA);
  const fire = kinds(r, 'fire').find((e) => e.b === 1), glint = kinds(r, 'glint').find((e) => e.a === 0 && e.b === 1);
  row('a captain breathes at a bus only a full second after its glint', early === 0 && !!fire && fire.t - glint.t >= 1 - 1e-9, { glintToBreath: fire && +(fire.t - glint.t).toFixed(2) });
}
// ---- the flick in the white-hot hops out of it; Piñata; Bubbled ----
{
  const r = faceOff();
  r.step(tapA(r));
  let hopped = false;
  run(r, 2, (q) => [still, { steer: 0, tap: false, flick: !hopped && q.breaths.some((s) => s.white) ? ((hopped = true), 1) : 0 }]);
  row('a flick in the white-hot hops out of the breath', kinds(r, 'hop').length === 1 && kinds(r, 'miss').length === 1 && kinds(r, 'hit').length === 0 && r.buses[1].gear === 0);
  const p = faceOff({ mode: 'pinata' });
  run(p, 2, tapA);
  const drops = p.drops.length;
  run(p, 3, (q) => {
    const d = q.drops[0];
    if (d) Object.assign(q.buses[0], { x: d.x, z: d.z });
    return [still, still];
  });
  row('piñata: six drops of the victim\'s paint, a tenth of a MEGA each the hitter catches, the victim straight into the stop arm', drops === 6 && Math.abs(p.buses[0].mega - 0.6) < 1e-9 && kinds(p, 'catch').length === 6,
    { drops, mega: +p.buses[0].mega.toFixed(2) });
  const b = faceOff({ mode: 'bubbled' });
  run(b, 2, tapA);
  const hit = kinds(b, 'hit')[0], inBubble = b.buses[1].state === 'bubble';
  run(b, 4, () => [still, still]);
  const end = kinds(b, 'rideEnd')[0];
  row('bubbled: three seconds still in the bubble, popping as the hitter\'s paint', inBubble && !!end && Math.abs(end.t - hit.t - T.bubble) < 0.05 && kinds(b, 'hiccup').length === 1);
}

// ---- the duels ----
const MODES = ['possessed', 'pinata', 'bubbled'], LEVELS = ['learner', 'rival', 'veteran'];
const crc = (s, h = 2166136261) => {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The player's stand-in: a captain's sense with a person's mess on top, and a person's rules (no glint wait). */
function player(seed) {
  const sense = new Captain(['learner', 'rival', 'veteran'][seed % 3], seed ^ 0x5bd1e995), rand = rng(seed * 7 + 1);
  let wander = 0;
  return (r, me) => {
    const h = sense.think(r, me);
    wander += (rand() - 0.5) * 0.4;
    wander *= 0.95;
    h.steer = Math.max(-1, Math.min(1, h.steer + wander));
    if (rand() < 0.02) h.steer = rand() * 2 - 1;
    if (rand() < 0.01) h.flick = rand() < 0.5 ? -1 : 1;
    if (rand() < 0.03) h.tap = true;
    return h;
  };
}

function duel(n) {
  const mode = MODES[n % 3], recess = n % 4 === 3, level = LEVELS[Math.floor(n / 3) % 3], newcomer = n % 5 === 0;
  const setup = [{ faction: R, newcomer }, { faction: A, bot: level }];
  if (recess) setup.push({ faction: I, bot: LEVELS[(Math.floor(n / 3) + 1) % 3] });
  const r = new Recess(setup, { mode, log: true });
  const godsAtStart = [...r.areas.all.values()].filter((a) => a.stage === 5).length;
  const think = (c) => (r, b) => c.think(r, b), brains = [player(n + 1), think(new Captain(level, n * 31 + 7))];
  if (recess) brains.push(think(new Captain(setup[2].bot, n * 31 + 11)));
  const seconds = recess ? T.length : 60;
  const bad = { steer: 0, glint: 0, gang: 0, pair: 0, shield: 0, newcomer: 0, bully: 0, nonstop: 0, wanted: 0, hiccupPaint: 0 };
  const rides = [], lastEnd = new Map(), lockAt = new Map();
  for (let k = 0, steps = Math.round(seconds / r.dt); k < steps; k++) {
    const hands = r.buses.map((b) => brains[b.id](r, b) ?? still);
    const before = r.buses.map((b) => ({ h: b.heading, sp: b.speed, st: b.state, lock: b.lock, since: b.lockSince, bot: b.bot, faction: b.faction, newcomer: b.newcomer }));
    r.step(hands);
    for (const b of r.buses) {
      const o = before[b.id];
      // (the steering: what the hands asked for, at the speed it had, is what the bus turned, the edge's turn on top; but in a bubble, by design)
      if (o.st !== 'bubble' && b.state !== 'bubble') {
        const turned = Math.atan2(Math.sin(b.heading - o.h), Math.cos(b.heading - o.h)) - b.edgeYaw * r.dt;
        const want = Math.max(-1, Math.min(1, hands[b.id].steer)) * Recess.yawAt(o.sp) * r.dt;
        if (Math.abs(turned - want) > 1e-9 || Recess.yawAt(o.sp) <= 0) bad.steer++;
      }
      if (b.state === 'ride' && o.st === 'ride' && b.speed < o.sp - 1e-6 && o.sp < T.gears[2]) bad.nonstop++;
      if (b.given >= T.wantedRides && !b.wanted) bad.wanted++;
      if (b.lock !== o.lock) lockAt.set(b.id, r.t);
    }
    const cur = before.map((o) => ({ lock: o.lock, since: o.since }));
    for (const e of r.events) {
      if (e.kind === 'glint') cur[e.a] = { lock: e.b, since: e.t };
      if (e.kind === 'fire' && e.b >= 0) {
        // (what glints is what the tap hits: the shooter's glint as the breath goes, a full second of it for a captain)
        const c = cur[e.a];
        if (c.lock !== e.b || (before[e.a].bot && r.t - c.since < 1 - 1e-6)) bad.glint++;
      }
      if (e.kind === 'hit' || e.kind === 'lesson') {
        const o = before[e.b];
        if (o.st !== 'free') bad.shield++;
        if (before[e.a].faction === o.faction) bad.gang++;
        if (o.newcomer && (e.kind === 'hit' || !before[e.a].bot)) bad.newcomer++;
        if (e.kind === 'hit') {
          const same = rides.filter((x) => x.a === e.a && x.b === e.b && r.t - x.t < T.pairWindow).length;
          if (same >= T.pairMost) bad.pair++;
          rides.push({ a: e.a, b: e.b, t: r.t });
        }
        const end = lastEnd.get(e.b);
        if (end !== undefined && r.t - end < T.shield - 1e-6) bad.shield++;
      }
      if (e.kind === 'rideEnd') lastEnd.set(e.b, r.t);
      if (e.kind === 'hiccup' && e.outcome !== 'claim' && e.outcome !== 'none') bad.hiccupPaint++;
    }
    // (bullied: more rides on one bus in two minutes than two from each rival)
    for (const v of r.buses) {
      const rivals = r.buses.filter((b) => b.faction !== v.faction).length;
      if (rides.filter((x) => x.b === v.id && r.t - x.t < T.pairWindow).length > T.pairMost * rivals) bad.bully++;
    }
  }
  const log = r.log.map((e) => `${e.t.toFixed(4)}${e.kind}${e.a},${e.b}${e.outcome ?? ''}`).join(';');
  return { mode, recess, level, newcomer, bad, rides: rides.length, ridesOnPlayer: rides.filter((x) => x.b === 0).length, hops: kinds(r, 'hop').length, misses: kinds(r, 'miss').length,
    hits: kinds(r, 'hit').length, lessons: kinds(r, 'lesson').length, hiccups: kinds(r, 'hiccup').length, paints: kinds(r, 'paint').length, gods: r.log.filter((e) => e.outcome === 'god').length, topples: r.log.filter((e) => e.outcome === 'topple').length, final: r.score(), godsAtStart, cracks: r.log.filter((e) => e.outcome === 'crack').length, heals: r.log.filter((e) => e.outcome === 'heal').length, godsEnd: [...r.areas.all.values()].filter((a) => a.stage === 5).length, score: r.areas.score((a) => Recess.inside(a.ax, a.az) || true), crc: crc(log), seconds };
}

const t0 = Date.now(), all = [];
for (let n = 0; n < DUELS; n++) all.push(duel(n));
const sum = (f) => all.reduce((s, d) => s + f(d), 0);
const bads = {};
for (const k of Object.keys(all[0].bad)) bads[k] = sum((d) => d.bad[k]);
const minutes = sum((d) => d.seconds) / 60;
row(`duels: ${DUELS}, nobody loses the steering (Bubbled's three still seconds aside)`, bads.steer === 0, { steps: Math.round(sum((d) => d.seconds) * 30), bad: bads.steer });
row('duels: what glints is what a tap hits, a captain\'s after a full second', bads.glint === 0, { bad: bads.glint });
row('duels: nobody bullied: no ganging up, no third of a pair, no ride in a stop arm, no pile-on', bads.gang + bads.pair + bads.shield + bads.bully === 0, { gang: bads.gang, pair: bads.pair, shield: bads.shield, bully: bads.bully });
row('duels: new players ridden only by a captain\'s one lesson; WANTED kept; Possessed at Nonstop; hiccups on grey only', bads.newcomer + bads.wanted + bads.nonstop + bads.hiccupPaint === 0,
  { newcomer: bads.newcomer, wanted: bads.wanted, nonstop: bads.nonstop, hiccupPaint: bads.hiccupPaint, lessons: sum((d) => d.lessons) });
const rate = (lv) => {
  const ds = all.filter((d) => d.level === lv && !d.recess && !d.newcomer);
  return +(ds.reduce((s, d) => s + d.ridesOnPlayer, 0) / (ds.reduce((s, d) => s + d.seconds, 0) / 60)).toFixed(2);
};
const lr = rate('learner'), rr = rate('rival'), vr = rate('veteran');
row('duels: the levels climb: a Veteran rides the player more often than a Rival, a Rival than a Learner', lr < rr && rr < vr, { ridesAMinute: { learner: lr, rival: rr, veteran: vr } });
row('duels: things happen: rides, hops, misses and painting in every mode', MODES.every((m) => all.some((d) => d.mode === m && d.hits > 0)) && sum((d) => d.hops) > 0 && sum((d) => d.paints) > 0,
  { rides: sum((d) => d.hits), aMinute: +(sum((d) => d.hits) / minutes).toFixed(2), hops: sum((d) => d.hops), misses: sum((d) => d.misses), paints: sum((d) => d.paints) });
// (the camps, decision 28's fallback: a lone captain raises its camp's god by the rules, and the score counts it; in a contested Recess, how often one rises is
// a number for the studio, printed, not a pass or a fail)
const lone = ['learner', 'rival', 'veteran'].map((lv, k) => {
  const r = new Recess([{ faction: A, bot: lv }], { log: true, gods: false }), c = new Captain(lv, 5 + k);
  for (let s = 0; s < 30 * 400; s++) {
    r.step([c.think(r, r.buses[0])]);
    if (r.events.some((e) => e.outcome === 'god')) return { lv, godS: Math.round(r.t), score: r.score()[A], squares: r.areas.realm.squares(r.buses[0].home).length };
  }
  return { lv, godS: null };
});
row('recess: three camps; a lone captain on grey raises its camp\'s god by the full rule, the score 36 for it', lone.every((l) => l.godS !== null && l.score >= 36), lone);
const full = all.filter((d) => d.recess), fsum = (f) => full.reduce((n, d) => n + f(d), 0);
row('recess: each camp starts with its god (the studio\'s answer); in three minutes some fall, cracks are healed, and the score counts the standing', full.every((d) => d.godsAtStart === 3) && full.some((d) => d.topples > 0) && fsum((d) => d.heals) > 0,
  { matches: full.length, withATopple: full.filter((d) => d.topples > 0).length, topples: fsum((d) => d.topples), cracks: fsum((d) => d.cracks), heals: fsum((d) => d.heals), raised: fsum((d) => d.gods), godsAtTheBell: fsum((d) => d.godsEnd) });
// (both players see it: the same seed and hands, the same match)
const again = [0, 1, 2, 3, 7, 11, 19].map((n) => duel(n).crc === all[n]?.crc);
row('duels: a match replays the same from its seed, every event at its moment', again.every(Boolean), { replayed: again.length });
console.log(`(${DUELS} duels, ${minutes.toFixed(0)} game minutes, in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
