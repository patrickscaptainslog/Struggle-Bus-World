// The rival buses' rules (docs/specs/factions/RAMPAGE.md, sections 2 and 3), on their own brain (src/rivals/rivals.ts) with the real Flight flying the
// player's bus over a flat world, no browser: node tools/feel-sim/run.mjs ../rivals/s_rivals.ts
//   own      "Can't they just act like normal players?": the city's buses about their own business for ten minutes, twice, with the player's bus flown two
//            quite different ways (parked, and doing laps of the city among them, high over them, their mischief off): every one of them flies the same
//            line both times, to the last bit. Nothing of their business reads the player's bus
//   lives    ten minutes of it: the same buses at the end as at the start, none lost and none moved but by flying; each has worked patches, made trips in
//            more than one gear and played; how their time splits; how far apart they are
//   met      a player painting in one place for ten minutes: how long before one of them is within 400 m, how often one is within a kilometre, and within
//            the tags' reach; and the same for a player who paints nothing. Printed: it's a city of twenty, not a guard of three
//   front    what a tap goes for: the rival nearest the nose's line within the cone and the reach, nobody outside them, never the player's own crew
//   ram      two buses driven at each other every way, at closing speeds from 40 to 1,800 m/s, at 30 and at 60 frames a second: every one touches (none passes
//            through the other), the tier goes by the closing speed alone, the one struck in its side or tail takes all of it and nose to nose both do
//   fling    a bus that takes it flies 1.5 s of the closing speed, 1.5 km at the most, and comes down
//   fair     with their mischief off and left alone they never fire; a bold one shot at honks first and fires only after; a timid one makes off; never two at
//            the player at once; and with their mischief on, every shot at the player still has its honk before it
// Prints a row each, and exits 1 if one fails.
import { config } from '../feel-sim/lib';
import { Flight } from '@src/game/Flight';
import { Rivals, rivalTune as T, RState, Act, type Me, type Rival, type RivalEvent } from '@src/rivals/rivals';

const flat = { obstacleAt: () => 20, groundAt: () => 10 };
/** A city 14 km by 17 km, as San Francisco's map is, all of it land. */
const CITY = { ...flat, bounds: [-8704, -9984, 5632, 7680] };
const DEG = Math.PI / 180;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(34)} ${JSON.stringify(o)}`);
};
const meOf = (f: Flight, out = false): Me => ({ x: f.x, y: f.y, z: f.z, heading: f.heading, nose: f.heading, speed: f.ground, faction: 1, out });

// ---------------------------------------------------------------- their own business
{
  const mischief = T.mischief;
  T.mischief = 0;
  const dt = 1 / 30, tracks: Float64Array[] = [];
  for (const way of ['parked', 'laps'] as const) {
    const R = new Rivals(4242), me: Me = { x: 0, y: 2500, z: 0, heading: 0, nose: 0, speed: 0, faction: 1, out: false };
    const track = new Float64Array(T.count * 3 * 600);
    let n = 0;
    for (let k = 0; k < 600 / dt; k++) {
      const t = k * dt;
      if (way === 'laps' && t > 1) {
        // (round the city at Express, through the middle of them, high over their roofs: seen, never touched)
        me.heading = t * 0.05;
        me.nose = me.heading;
        me.speed = 112;
        me.x += Math.sin(me.heading) * 112 * dt;
        me.z -= Math.cos(me.heading) * 112 * dt;
      }
      R.step(dt, me, CITY);
      if (k % 30 === 0) for (let i = 0; i < T.count; i++) {
        const r = R.list[i];
        track[n++] = r.x;
        track[n++] = r.z;
        track[n++] = r.heading;
      }
    }
    tracks.push(track);
  }
  let apart = 0;
  for (let i = 0; i < tracks[0].length; i++) apart = Math.max(apart, Math.abs(tracks[0][i] - tracks[1][i]));
  T.mischief = mischief;
  row(apart === 0, 'own business', { buses: T.count, minutes: 10, apartAtMost: apart });
}

// ---------------------------------------------------------------- their lives
{
  const R = new Rivals(77), dt = 1 / 30, me: Me = { x: 0, y: 2500, z: 0, heading: 0, nose: 0, speed: 0, faction: 1, out: false };
  const acts = [0, 0, 0], gears = [0, 0, 0, 0], taps = new Map<number, number>(), tripsBy = new Map<number, Set<number>>();
  let jumps = 0, outside = 0, total = 0, ids = '';
  R.onEvent = (ev, r) => {
    if (ev === 'paint') taps.set(r.id, (taps.get(r.id) ?? 0) + 1);
  };
  for (let k = 0; k < 600 / dt; k++) {
    R.step(dt, me, CITY);
    if (k === 0) ids = R.list.filter((r) => r.live).map((r) => `${r.id}:${r.faction}`).join();
    for (const r of R.list) {
      if (!r.live) continue;
      total++;
      acts[r.act]++;
      gears[r.gear]++;
      if (r.act === Act.Travel) (tripsBy.get(r.id) ?? tripsBy.set(r.id, new Set()).get(r.id)!).add(r.tripGear);
      // (never moved but by flying: no further in a step than its speed takes it)
      if (Math.hypot(r.x - r.px, r.z - r.pz) > (r.speed + 5) * dt + 1e-6) jumps++;
      if (r.x < CITY.bounds[0] || r.z < CITY.bounds[1] || r.x > CITY.bounds[2] || r.z > CITY.bounds[3]) outside++;
    }
  }
  const live = R.list.filter((r) => r.live), same = live.map((r) => `${r.id}:${r.faction}`).join() === ids;
  const everyoneTaps = live.every((r) => (taps.get(r.id) ?? 0) > 20), everyoneTrips = live.every((r) => r.trips >= 3), gearsUsed = new Set([...tripsBy.values()].flatMap((s) => [...s])).size;
  // (how far from a bus to the nearest other, in the middle of the ten minutes' end)
  const nearest = live.map((r) => Math.min(...live.filter((o) => o !== r).map((o) => Math.hypot(o.x - r.x, o.z - r.z)))).sort((a, b) => a - b);
  const pct = (v: number) => `${Math.round((100 * v) / total)} %`;
  row(same && live.length === T.count && jumps === 0 && outside === 0 && everyoneTaps && everyoneTrips && gearsUsed >= 3 && acts[Act.Play] > 0, 'lives', {
    buses: live.length, theSameOnes: same, movedButByFlying: jumps, outsideTheCity: outside, painting: pct(acts[Act.Paint]), onATrip: pct(acts[Act.Travel]), playing: pct(acts[Act.Play]),
    inCruise: pct(gears[0]), express: pct(gears[1]), nonstop: pct(gears[2]), jet: pct(gears[3]), tapsEachAtLeast: Math.min(...live.map((r) => taps.get(r.id) ?? 0)), tripsEachAtLeast: Math.min(...live.map((r) => r.trips)),
    toTheNearestOtherMedianM: Math.round(nearest[nearest.length >> 1]),
  });
}

// ---------------------------------------------------------------- met
for (const paints of [true, false]) {
  // (three cities of them, each with its own buses: a player at one place for ten minutes, tapping every two seconds or not at all, low enough to be met)
  let first: number[] = [], within1k = 0, inTags = 0, total = 0, visits = 0;
  for (const seed of [5, 606, 70007]) {
    const R = new Rivals(seed), dt = 1 / 30, f = new Flight();
    f.y = 26.5;
    f.glideSpeed = 0;
    let met = NaN, wasNear = false;
    for (let k = 0; k < 600 / dt; k++) {
      const t = k * dt;
      // (a slow round of its own patch)
      for (let i = 0; i < 4; i++) f.step(dt / 4, { sx: 0.35, sy: 0, dragging: true }, flat);
      if (paints && k % 60 === 0) R.heard(f.x + f.fx * 70, f.z + f.fz * 70, 1);
      R.step(dt, { ...meOf(f), y: 2500 }, CITY);
      if (t < 20) continue;
      let near = Infinity;
      for (const r of R.list) if (r.live) near = Math.min(near, Math.hypot(r.x - f.x, r.z - f.z));
      total++;
      if (near < 1000) within1k++;
      if (near < 2400) inTags++;
      if (near < 400) {
        if (Number.isNaN(met)) met = t;
        if (!wasNear) visits++;
      }
      wasNear = near < 400;
    }
    first.push(met);
  }
  first = first.map((v) => Math.round(v));
  // (not a rule but the picture: somebody in the tags' reach most of the time, and visits that come because there's paint to see about)
  row(inTags / total > 0.6, `met, a player who ${paints ? 'paints' : 'paints nothing'}`, { firstWithin400mAtS: first, timesOneCameWithin400m: visits, oneWithinAKm: `${Math.round((100 * within1k) / total)} %`, oneInTheTagsReach: `${Math.round((100 * inTags) / total)} %` });
}

// ---------------------------------------------------------------- front
{
  const R = new Rivals(3), me: Me = { x: 0, y: 30, z: 0, heading: 0, nose: 0, speed: 30, faction: 1, out: false };
  const put = (i: number, bearingDeg: number, d: number, state = RState.Roam, faction = 2): Rival => {
    const r = R.list[i];
    Object.assign(r, { live: true, faction, x: Math.sin(bearingDeg * DEG) * d, z: -Math.cos(bearingDeg * DEG) * d, y: 30, state });
    return r;
  };
  const clear = () => R.list.forEach((r) => (r.live = false));
  put(0, 10, 300);
  const b = put(1, -4, 350);
  put(2, 40, 100);
  const pick1 = R.inFront(me);
  clear();
  put(0, 26, 200);
  put(1, 0, 420);
  const pick2 = R.inFront(me);
  clear();
  put(0, 5, 200, RState.Flung);
  const pick3 = R.inFront(me);
  clear();
  // (in a skid the nose is what aims: one 60 degrees off the bus's way, dead on its nose)
  const d = put(0, 60, 250);
  const pick4 = R.inFront({ ...me, nose: 60 * DEG });
  clear();
  // (one of the player's own crew, dead ahead: a tap is a splat)
  put(0, 0, 150, RState.Roam, 1);
  const pick5 = R.inFront(me);
  row(pick1 === b && pick2 === null && pick3 === null && pick4 === d && pick5 === null, 'front', { nearestTheLine: pick1 === b, outsideConeAndReach: pick2 === null, aFlungOne: pick3 === null, byTheNoseInASkid: pick4 === d, itsOwnCrew: pick5 === null });
}

// ---------------------------------------------------------------- the ram
/** One rival pinned to a line and a speed: on a trip to a place far along its heading, in a gear whose speed is `v`, with no weave and no mischief. */
function pin(R: Rivals, heading: number, v: number, x: number, z: number): Rival {
  const r = R.list[0];
  Object.assign(r, { live: true, faction: 2, bold: 0.9, heading, speed: v, gear: 0, state: RState.Roam, act: Act.Travel, tripGear: 0, y: 30, x, z, tx: x + Math.sin(heading) * 1e7, tz: z - Math.cos(heading) * 1e7, mischiefIn: 1e9, grudge: false });
  r.px = r.x;
  r.pz = r.z;
  r.py = r.y;
  return r;
}
/** The rules' numbers held still for a pinned rival, and put back. */
function pinned<X>(v: number, fn: () => X): X {
  const speeds = T.speeds.slice(), weave = T.weave, count = T.count;
  T.speeds[0] = T.speeds[1] = T.speeds[2] = T.speeds[3] = v;
  T.weave = 0;
  T.count = 0;
  try {
    return fn();
  } finally {
    T.speeds.splice(0, 4, ...speeds);
    T.weave = weave;
    T.count = count;
  }
}
/** The player (heading north along -z at vMe) and one rival going `itHeadingDeg`, set to meet at the origin in a second. */
function meet(vMe: number, vIt: number, itHeadingDeg: number, dt: number, offset = 0) {
  return pinned(vIt, () => {
    const R = new Rivals(5), h = itHeadingDeg * DEG;
    const me: Me = { x: 0, y: 30, z: vMe, heading: 0, nose: 0, speed: vMe, faction: 1, out: false };
    R.step(1e-9, me, flat);
    const r = pin(R, h, vIt, -Math.sin(h) * vIt + offset, Math.cos(h) * vIt);
    let ram: null | { tier: number; closing: number; me: boolean; it: boolean; far: number; itX: number; itZ: number; meX: number; meZ: number } = null, landed: null | { x: number; z: number } = null, x0 = 0, z0 = 0;
    R.onEvent = (ev: RivalEvent, rr: Rival) => {
      if (ev === 'ram' && !ram) {
        ram = { ...R.ram };
        x0 = rr.x;
        z0 = rr.z;
      }
      if (ev === 'land') landed = { x: rr.x, z: rr.z };
    };
    let lowest = Infinity;
    for (let t = 0; t < 6; t += dt) {
      me.z -= vMe * dt;
      // (level with it: this is the rule's test, not the flying's)
      if (!ram) me.y = r.y;
      R.step(dt, me, flat);
      lowest = Math.min(lowest, r.y);
    }
    return { ram: ram as typeof ram, flew: landed ? Math.hypot((landed as { x: number }).x - x0, (landed as { z: number }).z - z0) : NaN, lowest };
  });
}
const WORD = ['bump', 'smash', 'wreck', 'head-on'];
{
  // (nose to nose: the rival comes south, heading 180)
  const out: string[] = [];
  let ok = true;
  for (const [vMe, vIt, tier] of [[20, 20, 0], [35, 35, 1], [112, 30, 1], [112, 112, 2], [225, 225, 2], [450, 112, 3], [450, 450, 3], [900, 450, 3], [900, 900, 3]] as const) {
    for (const dt of [1 / 60, 1 / 30]) {
      const m = meet(vMe, vIt, 180, dt, 3);
      const good = !!m.ram && m.ram.tier === tier && m.ram.me && m.ram.it && Math.abs(m.ram.closing - (vMe + vIt)) < (vMe + vIt) * 0.02 + 1;
      if (!good) ok = false;
      if (dt === 1 / 30) out.push(`${vMe + vIt} m/s: ${m.ram ? WORD[m.ram.tier] : 'MISSED'}${good ? '' : ' (!)'}`);
    }
  }
  row(ok, 'ram, nose to nose', out);
}
{
  // (the player's nose into its side: the rival crosses east, heading 90, slowly. It takes all of it. Two that meet at a corner at the same speed are nose to nose)
  const out: string[] = [];
  let ok = true;
  for (const [vMe, tier] of [[30, 0], [112, 1], [225, 2], [450, 2], [900, 2]] as const) {
    for (const dt of [1 / 60, 1 / 30]) {
      const m = meet(vMe, 12, 90, dt);
      const good = !!m.ram && m.ram.tier === tier && m.ram.it && !m.ram.me && m.ram.itZ < -0.9;
      if (!good) ok = false;
      if (dt === 1 / 30) out.push(`${vMe} into its side: ${m.ram ? `${WORD[m.ram.tier]}, ${m.ram.it && !m.ram.me ? 'it takes it' : m.ram.me && m.ram.it ? 'both' : 'the player'}` : 'MISSED'}${good ? '' : ' (!)'}`);
    }
  }
  row(ok, 'ram, into its side', out);
}
{
  // (into its tail: both north, the player faster. The closing speed is the difference: a rival at Cruise struck from behind by each gear)
  const out: string[] = [];
  let ok = true;
  for (const [vMe, vIt, tier] of [[60, 28, 0], [112, 28, 1], [225, 28, 1], [450, 28, 2], [900, 28, 2], [450, 112, 2]] as const) {
    for (const dt of [1 / 60, 1 / 30]) {
      const m = meet(vMe, vIt, 0, dt);
      const good = !!m.ram && m.ram.tier === tier && m.ram.it && !m.ram.me && Math.abs(m.ram.closing - (vMe - vIt)) < 3;
      if (!good) ok = false;
      if (dt === 1 / 30) out.push(`${vMe} into the tail of ${vIt}: ${m.ram ? `${WORD[m.ram.tier]} at ${Math.round(m.ram.closing)}` : 'MISSED'}${good ? '' : ' (!)'}`);
    }
  }
  row(ok, 'ram, into its tail', out);
}
{
  // (its nose into the player's side: the player crosses east, the rival comes north. The player takes all of it, thrown the way it was going)
  const out: string[] = [];
  let ok = true;
  for (const [vIt, tier] of [[112, 1], [225, 2], [450, 2]] as const) {
    for (const dt of [1 / 60, 1 / 30]) {
      const m = pinned(vIt, () => {
        const R = new Rivals(5), me: Me = { x: -20, y: 30, z: 0, heading: 90 * DEG, nose: 90 * DEG, speed: 20, faction: 1, out: false };
        R.step(1e-9, me, flat);
        const r = pin(R, 0, vIt, 0, vIt);
        let ram: null | typeof R.ram = null;
        R.onEvent = (ev) => {
          if (ev === 'ram' && !ram) ram = { ...R.ram };
        };
        for (let t = 0; t < 3; t += dt) {
          me.x += 20 * dt;
          if (!ram) me.y = r.y;
          R.step(dt, me, flat);
        }
        return ram as null | typeof R.ram;
      });
      const good = !!m && m.tier === tier && m.me && !m.it && m.meZ < -0.9;
      if (!good) ok = false;
      if (dt === 1 / 30) out.push(`${vIt} into the player's side: ${m ? `${WORD[m.tier]}, ${m.me && !m.it ? 'the player takes it' : 'both'}` : 'MISSED'}${good ? '' : ' (!)'}`);
    }
  }
  row(ok, 'ram, into the player\'s side', out);
}
{
  // (how far a struck rival flies: 1.5 s of the closing speed, 1.5 km at the most; and it comes down over the roofs)
  const out: string[] = [];
  let ok = true;
  for (const vMe of [112, 225, 450, 900]) {
    const m = meet(vMe, 12, 90, 1 / 30), want = Math.min(T.flingMax, T.flingSec * (m.ram?.closing ?? 0));
    const good = !!m.ram && Math.abs(m.flew - want) < want * 0.08 + 12 && m.lowest >= 23;
    if (!good) ok = false;
    out.push(`struck at ${Math.round(m.ram?.closing ?? 0)} m/s: ${Math.round(m.flew)} m (${Math.round(want)})${good ? '' : ' (!)'}`);
  }
  row(ok, 'fling', out);
}

// ---------------------------------------------------------------- fair
{
  // (a player flying about among them, low, for ten minutes)
  const run = (mischief: number, provoke: boolean, seed: number) => {
    const was = T.mischief;
    T.mischief = mischief;
    const f = new Flight(), R = new Rivals(seed), dt = 1 / 30;
    f.y = 26.5;
    f.glideSpeed = 0;
    const log: Array<[number, RivalEvent, number]> = [];
    let t = 0, two = false, fled = 0;
    R.onEvent = (ev, r) => log.push([t, ev, r.id]);
    for (; t < 600; t += dt) {
      for (let i = 0; i < 4; i++) f.step(dt / 4, { sx: Math.sin(t * 0.3) * 0.5, sy: 0, dragging: true }, flat);
      R.step(dt, meOf(f), CITY);
      // (the player starts on the four nearest of them, a minute in)
      if (provoke && Math.abs(t - 60) < dt / 2)
        for (const r of R.list.filter((x) => x.live).sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z)).slice(0, 4)) {
          R.provoke(r);
          if (r.bold < T.timid) fled++;
        }
      if (R.list.filter((r) => r.live && (r.state === RState.Hunt || r.state === RState.Honk)).length > 1) two = true;
    }
    T.mischief = was;
    const honks = log.filter((e) => e[1] === 'honk'), shells = log.filter((e) => e[1] === 'shell');
    // (every shell at the player is from a rival that honked at least `honk` s before it, since its last honk)
    let unannounced = 0;
    for (const s of shells) {
      const h = honks.filter((x) => x[2] === s[2] && x[0] <= s[0] + 1e-9).pop();
      if (!h || s[0] - h[0] < T.honk - 1e-6) unannounced++;
    }
    return { honks: honks.length, shells: shells.length, unannounced, two, fled, between: log.filter((e) => e[1] === 'shellAt').length, taps: log.filter((e) => e[1] === 'paint').length };
  };
  const quiet = run(0, false, 21), shotAt = run(0, true, 21), lively = [run(T.mischief, false, 21), run(T.mischief, false, 2222), run(T.mischief, false, 33333)];
  const livelyShells = lively.reduce((n, r) => n + r.shells, 0), livelyBetween = lively.reduce((n, r) => n + r.between, 0);
  row(
    quiet.honks === 0 && quiet.shells === 0 && quiet.taps > 100 && shotAt.honks >= 1 && shotAt.unannounced === 0 && !shotAt.two && lively.every((r) => r.unannounced === 0 && !r.two) && livelyBetween > 0,
    'fair',
    {
      mischiefOffLeftAlone: { honks: quiet.honks, shells: quiet.shells, tapsOfTheirOwn: quiet.taps },
      mischiefOffShotAt: { honks: shotAt.honks, shells: shotAt.shells, timidOnesMadeOff: shotAt.fled, shellsWithNoHonkBefore: shotAt.unannounced, twoAtOnce: shotAt.two },
      mischiefOnThreeTenMinutes: { atThePlayer: livelyShells, withNoHonkBefore: lively.reduce((n, r) => n + r.unannounced, 0), atEachOther: livelyBetween, twoAtOnce: lively.some((r) => r.two) },
    },
  );
}
void config;
void wrap;
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
