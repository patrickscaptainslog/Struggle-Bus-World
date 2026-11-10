#!/usr/bin/env node
// What a match is like to fly, in numbers, for the pvp's rethink (docs/specs/recess/PVP.md on feat/earth): node --no-warnings tools/recess/feel.mjs [matches=120]
// It asserts nothing: it measures. Two parts.
//   turns    from the flight's own numbers (config.flight, config.turbo): at each speed a match is flown at, the yaw at full stretch, the turn's radius, how
//            long half a turn takes and how wide it is against the arena
//   matches  whole matches of the brain alone (src/recess/recess.ts), the default two captains (a Rival and a Learner) and a stand-in for the player flown
//            by the game's own pilot at its best (a Veteran's sense) and at its worst (a Learner's): how much of a match a rival is on the player's screen
//            (inside the match's lens, 20.85 degrees either side of the nose, within the lock's 900 m) or dead ahead (the captains' own cone), how long one
//            stays there each time against the 0.55 s a lock takes, how fast it crosses the screen, how far off the nearest one is, and how much of the
//            match the player's bus is somebody else's
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { Recess, recessTune: T } = await import('../../src/recess/recess.ts');
const { Captain } = await import('../../src/recess/captain.ts');
const { Faction } = await import('../../src/factions/areas.ts');
const { duelTune: D } = await import('../../src/recess/Duel.ts').catch(() => ({ duelTune: { lockAt: 0.55, full: 1, reach: 900, pickPx: 48 } }));

const N = +(process.argv[2] ?? 120);
const r1 = (v) => +v.toFixed(1), r2 = (v) => +v.toFixed(2), pct = (v) => `${(100 * v).toFixed(0)} %`;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const q = (list, p) => (list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(p * list.length))] : NaN);

// ---- turns: Flight.ts's yaw at full stretch (maxYawRate x the speed's share x a gear's authority over the surge) ----
const CRUISE = 30, SURGE = 112, MAX_YAW = 1.35, TURN_EXP = 0.55;
const yawAt = (v) => MAX_YAW * Math.min(1.35, Math.max(0.55, Math.sqrt(CRUISE / v))) * (v > SURGE ? (SURGE / v) ** TURN_EXP : 1);
console.log('turns: at full stretch, by speed');
for (const [name, v] of [['Cruise, the thumb off', 30], ['a half push', 70], ['Express, or a full push', 112], ['Nonstop, and a ride', 225], ['Jet, a ride with &hit=jet', 450]]) {
  const w = yawAt(v), r = v / w;
  console.log(`  ${name.padEnd(28)} ${String(v).padStart(3)} m/s  ${r2(w)} rad/s  radius ${Math.round(r)} m  half a turn ${r1(Math.PI / w)} s, ${Math.round(2 * r)} m wide (${pct((2 * r) / (2 * T.radius))} of the arena)`);
}

// ---- matches ----
const LENS = (20.85 * Math.PI) / 180, PX_PER_RAD = 393 / (2 * LENS), REACH = D.reach ?? 900;
function fly(level, seeds) {
  const S = { t: 0, nearOff: 0, nearBeside: 0, nearBehind: 0, nearSeen: 0, onScreen: 0, two: 0, cone: 0, behind: 0, near300: 0, near600: 0, state: {}, gear: [0, 0, 0], rivalGear: [0, 0, 0], dwell: [], rate: [], nearest: [], ridden: 0, rode: 0, closing: [] };
  for (let n = 0; n < seeds; n++) {
    const r = new Recess([{ faction: Faction.RAINBOW }, { faction: Faction.ATLANTIS, bot: 'rival' }, { faction: Faction.INFERNO, bot: 'learner' }], { mode: 'possessed', log: true });
    const brains = [new Captain(level, n * 31 + 3), new Captain('rival', n * 31 + 7), new Captain('learner', n * 31 + 11)];
    const since = [0, -1, -1], was = [0, NaN, NaN], wasD = [0, NaN, NaN];
    for (let k = 0, steps = Math.round(T.length / r.dt); k < steps; k++) {
      r.step(r.buses.map((b) => brains[b.id].think(r, b) ?? { steer: 0, tap: false, flick: 0 }));
      const me = r.buses[0];
      let seen = 0, cone = false, near = Infinity, anyAhead = false, nearB = 0;
      for (const o of r.buses) {
        if (o.id === 0) continue;
        const dx = o.x - me.x, dz = o.z - me.z, d = Math.hypot(dx, dz), b = wrap(Math.atan2(dz, dx) - me.heading), on = Math.abs(b) < LENS && d < REACH;
        if (d < near) {
          near = d;
          nearB = Math.abs(b);
        }
        if (Math.abs(b) < Math.PI / 2) anyAhead = true;
        if (on) {
          seen++;
          if (since[o.id] < 0) since[o.id] = r.t;
          if (!Number.isNaN(was[o.id])) {
            S.rate.push((Math.abs(wrap(b - was[o.id])) / r.dt) * PX_PER_RAD);
            S.closing.push((wasD[o.id] - d) / r.dt);
          }
          was[o.id] = b;
          wasD[o.id] = d;
        } else {
          if (since[o.id] >= 0) S.dwell.push(r.t - since[o.id]);
          since[o.id] = -1;
          was[o.id] = NaN;
        }
        if (Math.abs(b) < T.lockCone && d < T.lockRange) cone = true;
        S.rivalGear[Math.min(2, o.gear)] += r.dt;
      }
      S.t += r.dt;
      if (seen) S.onScreen += r.dt;
      if (seen > 1) S.two += r.dt;
      if (cone) S.cone += r.dt;
      if (!anyAhead) S.behind += r.dt;
      if (near < 300) S.near300 += r.dt;
      if (near < 600) S.near600 += r.dt;
      // (the nearest rival, when it's within 300 m: on the screen, off it to one side, or behind)
      if (near < 300) {
        if (nearB < LENS) S.nearSeen += r.dt;
        else if (nearB < Math.PI / 2) S.nearBeside += r.dt;
        else S.nearBehind += r.dt;
      }
      S.nearest.push(near);
      S.state[me.state] = (S.state[me.state] ?? 0) + r.dt;
      S.gear[Math.min(2, me.gear)] += r.dt;
    }
    for (const e of r.log) {
      if (e.kind !== 'hit') continue;
      if (e.b === 0) S.ridden++;
      if (e.a === 0) S.rode++;
    }
  }
  const min = S.t / 60, share = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, pct(v / S.t)]));
  return {
    pilot: level, matches: seeds, minutes: Math.round(min),
    aRivalOnScreen: pct(S.onScreen / S.t), bothOnScreen: pct(S.two / S.t), deadAhead: pct(S.cone / S.t), everyRivalBehind: pct(S.behind / S.t),
    nearestRivalM: { median: Math.round(q(S.nearest, 0.5)), within300: pct(S.near300 / S.t), within600: pct(S.near600 / S.t) },
    whenWithin300: { onScreen: pct(S.nearSeen / S.near300), offToOneSide: pct(S.nearBeside / S.near300), behind: pct(S.nearBehind / S.near300) },
    eachTimeOnScreenS: { median: r2(q(S.dwell, 0.5)), quarter: r2(q(S.dwell, 0.25)), under: { lockAt: pct(S.dwell.filter((d) => d < (D.lockAt ?? 0.55)).length / S.dwell.length), full: pct(S.dwell.filter((d) => d < (D.full ?? 1)).length / S.dwell.length) }, timesAMinute: r1(S.dwell.length / min) },
    crossesTheScreenPxS: { median: Math.round(q(S.rate, 0.5)), fastQuarter: Math.round(q(S.rate, 0.75)) },
    closingMS: { median: Math.round(q(S.closing, 0.5)), fastQuarter: Math.round(q(S.closing, 0.75)) },
    myBus: share(S.state), myGear: { cruise: pct(S.gear[0] / S.t), express: pct(S.gear[1] / S.t), nonstop: pct(S.gear[2] / S.t) },
    theirGear: { cruise: pct(S.rivalGear[0] / (2 * S.t)), express: pct(S.rivalGear[1] / (2 * S.t)), nonstop: pct(S.rivalGear[2] / (2 * S.t)) },
    aMinute: { ridden: r2(S.ridden / min), rode: r2(S.rode / min) },
  };
}
console.log(`\nmatches: ${N} of ${T.length} s each, a Rival and a Learner against the player's stand-in`);
for (const level of ['veteran', 'learner']) console.log(JSON.stringify(fly(level, N), null, 1).replace(/\n\s+/g, ' '));
