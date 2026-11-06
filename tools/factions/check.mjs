#!/usr/bin/env node
// Factions' steps 3 and 4 in Node (FACTIONS.md section 5): node --no-warnings tools/factions/check.mjs
//   beat     84 a minute, four to a bar; the next beat and the next bar; the beats a tick crosses, none twice or missed over a minute of uneven ticks; a tempo
//            change keeps the count; the music's clock
//   slots    two stage changes a second at most, each on a beat, none more than a bar late, across a burst of forty
//   areas    claim, up to 4 and no further on a square (the god is a neighbourhood's), encores, the five-second wait whoever moves it, a rival's hit down and the flip at 1,
//            stage 4's crack, the owner's heal on the ring only and the wait it restarts (decision 16, seal two), parries, spills and hiccups only on grey, one hit an area a super,
//            changes on their beats
//   realm    decision 28, the neighbourhoods: the stand-ins (nearest points, Recess's camps); a god raised at the heart only once its faction holds half the
//            squares at 3 or more and the ring of 8 is at the Lift, by the owner's next ready hit there and on its beat; not on a godless or tagged heart, nor
//            off the heart; 5 to 9 hits to topple by the land, the Crown's two fewer, each a crack the owner heals one of, at most one every five seconds, the last
//            the heart the attacker's at 1; losing the half doesn't topple it; hiccups never call one; the save keeps a god and its cracks; Recess's score
//   save     what's saved reads back the same, byte for byte; a bad save changes nothing
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { Beat, Slots, BPM } = await import('../../src/factions/beat.ts');
const { Areas, areaTune, godTune, squareKey, squareCentre, packSquare, Faction } = await import('../../src/factions/areas.ts');
const { Neighbourhoods, nearest, camps } = await import('../../src/factions/neighbourhoods.ts');

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
    log.push(`${h.outcome}:${h.area.stage}${h.area.cracks ? 'x' : ''}`);
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
  hit(R, 0.5); // the owner, its ring not closed: only an encore (seal two)
  hit(R, 3.6); // 5.1 s after the crack, the ring closed: the owner heals, the wait again
  hit(A, 4.6); // 4.6 s after the heal: parry
  hit(A, 0.5); // ready: crack
  hit(A, 5.1); // the fall to 3
  hit(A, 5.1);
  hit(A, 5.1);
  hit(A, 5.1); // the flip
  hit(R, 1); // Rainbow's hit on Atlantis's, cooling: parry
  const want = 'claim:1 encore:1 up:2 up:3 up:4 encore:4 encore:4 crack:4x parry:4x encore:4x heal:4 parry:4 crack:4x down:3 down:2 down:1 flip:1 parry:1';
  row('areas: claim, up to 4, encores, parry, crack, the Lift\'s heal on its ring only, down, flip', log.join(' ') === want && top === areaTune.top && g.get(x, z).faction === A, log.join(' '));
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
    const k = squareKey(px, pz), c = squareCentre(k);
    keysOk &&= squareKey(c.x, c.z) === k && Math.abs(c.x - px) <= 64 && Math.abs(c.z - pz) <= 64;
  }
  row('areas: a square\'s key and its middle agree, either side of the origin', keysOk);
}
{
  // ---- save ----
  const g = new Areas();
  for (let k = 0; k < 60; k++) g.hit(k * 97 - 3000, k * 61 - 2000, [R, A, I][k % 3], k * 6, { now: 1_762_400_000 + k });
  g.hit(97 * 4 - 3000, 61 * 4 - 2000, R, 1000);
  const a = [...g.all.values()][3];
  a.stage = 5; a.cracks = 7; a.ax = 77; a.az = 12; a.ay = -315;
  const store = new Map(), ls = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null };
  const wrote = g.save(ls, 'sf');
  const h = new Areas(), read = h.load(ls, 'sf');
  const same = h.encode() === g.encode() && h.all.get(a.key).cracks === 7 && h.all.get(a.key).stage === 5 && h.all.get(a.key).ay === -315;
  const bad = new Areas();
  bad.hit(0, 0, R, 0);
  const before = bad.encode(), r1 = bad.decode('not base64!'), r2 = bad.decode(btoa('short')), r3 = bad.decode(btoa(String.fromCharCode(...new Uint8Array(16).fill(9))));
  row('save: read back byte for byte under its key; a bad save changes nothing', wrote && read && same && !r1 && !r2 && !r3 && bad.encode() === before && store.has('strugglebus.areas.v1:sf'),
    { areas: g.all.size, bytes: atob(g.encode()).length });
}

// ---- realm: the neighbourhoods (decision 28) ----
{
  // (a 7 x 7 neighbourhood, 49 squares, 0.80 km², its heart the middle; a 3 x 3 one beside it, 0.15 km², too small for a god; one tagged square in the first)
  const sq = (x0, z0, w) => { const o = []; for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) o.push(packSquare(x0 + i, z0 + j)); return o; };
  const big = sq(0, 0, 7), small = sq(7, 0, 3), tag = packSquare(6, 6);
  const realm = new Neighbourhoods({ names: ['Test Heights', 'Tiny'], hearts: [packSquare(3, 3), packSquare(8, 1)], squares: [big, small], tagged: [tag] });
  const crown = godTune.crown;
  godTune.crown = 0;
  const g = new Areas(undefined, realm), at = (k) => squareCentre(k);
  let t = 0;
  const hit = (k, f) => { const c = at(k); return g.hit(c.x, c.z, f, t); };
  // (every square in `keys` up to `stage` for f, a round of hits every 5 s)
  const climb = (keys, f, stage) => {
    for (let r = 0; r < stage; r++) {
      t += 5.01;
      for (const k of keys) if ((g.all.get(k)?.stage ?? 0) < stage) hit(k, f);
    }
  };
  const heart = realm.heart(0), ring = g.ring(0);
  climb([heart, ...ring], R, 4);
  t += 5.01;
  const early = hit(heart, R).outcome, sky0 = g.standing(0).skyMark;
  const rest = big.filter((k) => k !== heart && !ring.includes(k) && k !== tag).slice(0, 16);
  climb(rest, R, 3);
  const st = g.standing(0);
  t += 5.01;
  const offHeart = hit(ring[0], R).outcome;
  const god = hit(heart, R), onBeat = Math.abs(g.beat.phase(god.at)) < 1e-6 || Math.abs(g.beat.phase(god.at) - 1) < 1e-6;
  row('realm: the god rises at the heart only when the faction holds half at 3+ and the ring is at the Lift, on its beat',
    early === 'encore' && sky0 === 0 && st.holder === R && st.ringLifted && st.skyMark === R && offHeart === 'encore' && god.outcome === 'god' && god.area.stage === 5 && onBeat && ring.length === 8,
    { early, held: st.held[R], of: big.length, offHeart, god: god.outcome });
  // (the topple: 5 hits for 0.8 km², each a crack, one every 5 s at most, the owner's heal undoing one; losing the half leaves it standing)
  const want = g.toppleHits(0, R), log = [];
  t += 1;
  log.push(hit(heart, A).outcome);
  for (let k = 0; k < 4; k++) { t += 5.01; log.push(hit(heart, A).outcome); }
  t += 1;
  log.push(hit(heart, A).outcome); // (cooling: parry)
  log.push(hit(heart, R).outcome); // (the owner before the ring closes: only an encore)
  t += 4.02;
  log.push(hit(heart, R).outcome); // (the ring closed: the owner seals two of the four cracks)
  const sealed = g.all.get(heart).cracks;
  for (const k of rest) { const a = g.all.get(k); a.stage = 1; }
  const stands = g.standing(0).god === R && g.standing(0).holder === 0;
  t += 5.01; log.push(hit(heart, A).outcome);
  t += 5.01; log.push(hit(heart, A).outcome);
  t += 5.01; log.push(hit(heart, A).outcome);
  const after = g.all.get(heart);
  row('realm: 5 hits to topple 0.8 km², cracks one every 5 s, the owner\'s heal on the ring seals two, the half lost leaves it, the last gives the heart at 1',
    want === 5 && log.join(' ') === 'parry crack crack crack crack parry encore heal crack crack topple' && sealed === 2 && stands && after.faction === A && after.stage === 1 && after.cracks === 0, log.join(' '));
  // (the guard: a whole god's owner, its ring closed, starts the ring again, and a raider's hit inside it is parried)
  const gd = new Areas(undefined, realm);
  gd.setGod(0, R);
  const gk = at(realm.heart(0)), guard = gd.hit(gk.x, gk.z, R, 10).outcome, inRing = gd.hit(gk.x, gk.z, A, 12).outcome, later = gd.hit(gk.x, gk.z, A, 15.1).outcome;
  row('realm: a whole god\'s owner on the ring guards it, the ring again: a raider\'s hit inside it parried, after it a crack', guard === 'guard' && inRing === 'parry' && later === 'crack', { guard, inRing, later });
  // (godless and tagged; hiccups never call a god)
  const tiny = small, th = realm.heart(1);
  climb(tiny, R, 4);
  t += 5.01;
  const tinyHit = hit(th, R).outcome;
  climb([tag], R, 4);
  const tagTop = g.all.get(tag).stage;
  const h2 = new Areas(undefined, realm), c = at(heart), spill = h2.spill(c.x, c.z, R, 0).area.stage;
  row('realm: no god on a neighbourhood too small; a tagged square stops at the streets; a hiccup only claims at 1',
    realm.godless(1) && tinyHit === 'encore' && g.standing(1).skyMark === 0 && tagTop === areaTune.tagged && spill === 1, { tinyHit, tagTop, km2: +realm.km2(1).toFixed(3) });
  // (by size: the topple's hits and the god's height; the Crown's two fewer for the leader)
  const sizes = [17, 49, 100, 200, 365].map((n) => new Neighbourhoods({ names: ['n'], hearts: [packSquare(0, 0)], squares: [sq(0, 0, Math.ceil(Math.sqrt(n))).slice(0, n)] }));
  const hits = sizes.map((r) => new Areas(undefined, r).toppleHits(0, R)), tall = sizes.map((r) => Math.round(new Areas(undefined, r).godHeight(0)));
  godTune.crown = crown;
  const leaderHits = g.toppleHits(0, g.leader()), otherHits = g.toppleHits(0, I);
  row('realm: 5 to 9 hits and 250 to 450 m by the land; the leader\'s gods fall to two fewer (the Crown)', hits[0] === 5 && hits[4] === 9 && hits.every((h, i) => !i || h >= hits[i - 1]) &&
    tall[0] === 248 && tall[4] === 450 && leaderHits === otherHits - 2, { hits, tall, leader: g.leader(), leaderHits, otherHits });
  // (Recess's score: a point a stage a square, 36 a god)
  const sc = new Areas(undefined, realm);
  const hk = realm.heart(0), hc = at(hk);
  sc.hit(hc.x, hc.z, R, 0);
  sc.all.get(hk).stage = 5;
  sc.hit(at(ring[0]).x, at(ring[0]).z, R, 0);
  row('realm: Recess\'s score, a point a stage a square and 36 a god', sc.score()[R] === 4 + 36 + 1, { score: sc.score()[R] });
}
{
  // ---- the stand-ins: nearest points over a city's bounds, and Recess's three camps ----
  const n = nearest([{ name: 'West', x: -500, z: 0 }, { name: 'East', x: 600, z: 100 }], { x0: -1024, z0: -512, x1: 1024, z1: 512 });
  const total = n.squares(0).length + n.squares(1).length, westOk = n.squares(0).every((k) => squareCentre(k).x < 100);
  const c = camps(750), sizes = [0, 1, 2].map((k) => c.squares(k).length), inCircle = [0, 1, 2].every((k) => c.squares(k).every((q) => Math.hypot(squareCentre(q).x, squareCentre(q).z) <= 750));
  const heartsIn = [0, 1, 2].every((k) => c.of(c.heart(k)) === k);
  row('stand-ins: nearest gives every square one neighbourhood; camps give three of about 36 squares, each heart in its own; the first god the nearest under 1 km², not the nearest (West is 1.10 km², East 0.999)',
    total === 16 * 8 && westOk && sizes.every((s) => Math.abs(s - 36) <= 6) && inCircle && heartsIn && n.firstGod(-500, 0) === 1 && c.firstGod(squareCentre(c.heart(2)).x, squareCentre(c.heart(2)).z) === 2, { nearest: [n.squares(0).length, n.squares(1).length], camps: sizes });
}

process.exit(failed ? 1 : 0);
