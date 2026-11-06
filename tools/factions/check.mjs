#!/usr/bin/env node
// Factions' steps 3 and 4 in Node (FACTIONS.md section 5): node --no-warnings tools/factions/check.mjs
//   beat     84 a minute, four to a bar; the next beat and the next bar; the beats a tick crosses, none twice or missed over a minute of uneven ticks; a tempo
//            change keeps the count; the music's clock
//   slots    two stage changes a second at most, each on a beat, none more than a bar late, across a burst of forty
//   areas    claim, up to 4 and no further (stage 5 waits on decision 27), encores, the five-second wait whoever moves it, a rival's hit down and the flip at 1,
//            stage 4's crack, the owner's heal and the wait it restarts (decision 16), parries, spills and hiccups only on grey, one hit an area a super,
//            changes on their beats
//   partition  decision 28's switch: the same rules over a partition that isn't squares
//   save     what's saved reads back the same, byte for byte; a bad save changes nothing
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { Beat, Slots, BPM } = await import('../../src/factions/beat.ts');
const { Areas, areaTune, squares, Faction } = await import('../../src/factions/areas.ts');

let failed = 0;
const row = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(70)} ${info === undefined ? '' : JSON.stringify(info)}`);
};
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ---- beat ----
{
  const b = new Beat();
  const p = 60 / 84;
  const okNext = near(b.next(0), 0) && near(b.next(0.01), p) && near(b.next(p), p) && near(b.next(0.01, 4), 4 * p) && near(b.next(3 * p + 0.01, 4), 4 * p);
  // (a minute of uneven ticks, 5 to 40 ms: every beat crossed once, in order)
  const seen = [], tmp = [];
  let t = 0, r = 1;
  while (t < 60) {
    r = (r * 16807) % 2147483647;
    const t1 = t + 0.005 + (r / 2147483647) * 0.035;
    for (const i of b.crossed(t, t1, tmp)) seen.push(i);
    t = t1;
  }
  const want = Math.floor(60 / p + 1e-9);
  const okCrossed = seen.length >= want && seen.every((v, k) => v === k + 1);
  const c = new Beat();
  const before = c.at(10);
  c.setBpm(96, 10);
  const okTempo = near(c.at(10), before) && near(c.period, 60 / 96);
  c.sync(2, 7.5);
  const okAudio = near(c.toAudio(3), 8.5) && near(c.fromAudio(8.5), 3);
  row('beat: 84 a minute, the next beat and bar, every beat crossed once, tempo, audio', BPM === 84 && near(b.period, p) && okNext && okCrossed && okTempo && okAudio,
    { period: +b.period.toFixed(4), beatsIn60s: seen.length, bar: +(4 * p).toFixed(3), twoBars: +(8 * p).toFixed(3) });
}

// ---- slots ----
{
  const b = new Beat(), s = new Slots(b), at = [];
  for (let k = 0; k < 40; k++) at.push(s.book(10 + k * 0.05));
  const onBeat = at.every((x) => near(b.phase(x), 0, 1e-6) || near(b.phase(x), 1, 1e-6));
  const lateBy = at.map((x, k) => (x - b.next(10 + k * 0.05)) / b.period), inTime = at.filter((x, k) => lateBy[k] < 4 - 1e-6);
  let worstWin = 0;
  for (const x of inTime) worstWin = Math.max(worstWin, inTime.filter((y) => y > x - 1 + 1e-6 && y <= x + 1e-6).length);
  // (past a bar a full house starts anyway: the burst's tail all lands a bar late, none later)
  row('slots: a burst of forty in two seconds: on the beat, two a second, the rest a bar late, none later', onBeat && worstWin <= 2 && Math.max(...lateBy) <= 4 + 1e-6,
    { inTime: inTime.length, barLate: at.length - inTime.length, worstInASecond: worstWin });
  const q = new Slots(new Beat()), spaced = [];
  for (let k = 0; k < 10; k++) spaced.push(q.book(k * 0.5));
  let worst = 0;
  for (const x of spaced) worst = Math.max(worst, spaced.filter((y) => y > x - 1 + 1e-6 && y <= x + 1e-6).length);
  row('slots: changes asked for twice a second never start more than two in a second', worst <= 2, { worst });
}

// ---- areas ----
const R = Faction.RAINBOW, A = Faction.ATLANTIS, I = Faction.INFERNO;
{
  const g = new Areas(), x = 300, z = -200, log = [];
  let t = 100;
  const hit = (f, dt = 0, o) => {
    t += dt;
    const h = g.hit(x, z, f, t, o);
    log.push(`${h.outcome}:${h.area.stage}${h.area.cracked ? 'x' : ''}`);
    return h;
  };
  hit(R);
  hit(R, 1);
  hit(R, 4.1);
  hit(R, 5);
  hit(R, 5);
  hit(R, 5);
  hit(R, 5);
  const top = g.get(x, z).stage;
  hit(A, 1); // ready: crack, the wait again
  hit(A, 1); // cooling: parry
  hit(R, 0.5); // the owner heals, the wait again
  hit(A, 4.6); // 4.6 s after the heal: parry
  hit(A, 0.5); // ready: crack
  hit(A, 5.1); // the fall to 3
  hit(A, 5.1);
  hit(A, 5.1);
  hit(A, 5.1); // the flip
  hit(R, 1); // Rainbow's hit on Atlantis's, cooling: parry
  const want = 'claim:1 encore:1 up:2 up:3 up:4 encore:4 encore:4 crack:4x parry:4x heal:4 parry:4 crack:4x down:3 down:2 down:1 flip:1 parry:1';
  row('areas: claim, up to 4, encores, parry, crack, heal, down, flip', log.join(' ') === want && top === areaTune.top && g.get(x, z).faction === A, log.join(' '));
  // (the five seconds: from every change, whoever's)
  const h = new Areas();
  h.hit(0, 0, R, 0);
  const early = h.hit(0, 0, R, 4.99).outcome, onTime = h.hit(0, 0, R, 5.0).outcome;
  row('areas: a stage changes at most once every five seconds', early === 'encore' && onTime === 'up', { early, onTime });
}
{
  // (spills and hiccups: grey only, ready at once; someone's ground untouched)
  const g = new Areas();
  g.hit(0, 0, A, 0);
  const onOwned = g.spill(10, 10, R, 1).outcome, owned = g.get(10, 10);
  const onGrey = g.spill(500, 0, R, 1).outcome, then = g.hit(500, 0, R, 1.1).outcome;
  row('areas: a spill or a hiccup claims grey at 1, ready at once, and leaves owned ground', onOwned === 'none' && owned.faction === A && owned.stage === 1 && onGrey === 'claim' && then === 'up',
    { onOwned, onGrey, then });
  // (one hit an area a super)
  const s = new Areas();
  const a1 = s.hit(0, 0, R, 0, { superId: 7 }).outcome, a2 = s.hit(0, 0, R, 6, { superId: 7 }).outcome, a3 = s.hit(0, 0, R, 6, { superId: 8 }).outcome;
  row('areas: one super counts once an area', a1 === 'claim' && a2 === 'none' && a3 === 'up', { a1, a2, a3 });
  // (changes on their beats; stage 5 never)
  const b = new Areas();
  let onBeat = true, most = 0;
  for (let k = 0; k < 400; k++) {
    const r = b.hit((k % 7) * 128, Math.floor(k / 7) % 5 * 128, [R, A, I][k % 3], k * 0.37);
    if (['claim', 'up', 'down', 'flip'].includes(r.outcome)) onBeat &&= near(b.beat.phase(r.at), 0, 1e-6) || near(b.beat.phase(r.at), 1, 1e-6);
    most = Math.max(most, r.area.stage);
  }
  row('areas: every change on a beat, and never past stage 4', onBeat && most <= 4, { most });
  // (the squares' keys round trip, negative cells too)
  let keysOk = true;
  for (const [px, pz] of [[0, 0], [-1, -1], [127.9, 128], [-4000.5, 9000], [4095 * 128, -4095 * 128]]) {
    const k = squares.key(px, pz), c = squares.centre(k);
    keysOk &&= squares.key(c.x, c.z) === k && Math.abs(c.x - px) <= 64 && Math.abs(c.z - pz) <= 64;
  }
  row('areas: a square\'s key and its middle agree, either side of the origin', keysOk);
}
{
  // ---- partition: decision 28's switch, a stand-in neighbourhood of 3 x 3 squares ----
  const blocks = { name: 'test-blocks', key: (x, z) => squares.key(Math.floor(x / 384) * 128, Math.floor(z / 384) * 128), centre: (k) => squares.centre(k) };
  const g = new Areas(undefined, blocks);
  g.hit(10, 10, R, 0);
  const same = g.hit(370, 370, R, 5).outcome, other = g.hit(390, 10, R, 5).outcome;
  row('partition: the same rules over another partition, one switch', same === 'up' && other === 'claim' && g.all.size === 2, { same, other });
}
{
  // ---- save ----
  const g = new Areas();
  for (let k = 0; k < 60; k++) g.hit(k * 97 - 3000, k * 61 - 2000, [R, A, I][k % 3], k * 6, { now: 1_762_400_000 + k });
  g.hit(97 * 4 - 3000, 61 * 4 - 2000, R, 1000);
  const a = [...g.all.values()][3];
  a.stage = 4; a.cracked = true; a.ax = 77; a.az = 12; a.ay = -315;
  const store = new Map(), ls = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null };
  const wrote = g.save(ls, 'sf');
  const h = new Areas(), read = h.load(ls, 'sf');
  const same = h.encode() === g.encode() && h.all.get(a.key).cracked && h.all.get(a.key).ay === -315;
  const bad = new Areas();
  bad.hit(0, 0, R, 0);
  const before = bad.encode(), r1 = bad.decode('not base64!'), r2 = bad.decode(btoa('short')), r3 = bad.decode(btoa(String.fromCharCode(...new Uint8Array(16).fill(9))));
  row('save: read back byte for byte under its key; a bad save changes nothing', wrote && read && same && !r1 && !r2 && !r3 && bad.encode() === before && store.has('strugglebus.areas.v1:sf'),
    { areas: g.all.size, bytes: atob(g.encode()).length });
}

process.exit(failed ? 1 : 0);
