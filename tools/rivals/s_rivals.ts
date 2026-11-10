// The rival buses' rules (docs/specs/factions/RAMPAGE.md, sections 2 and 3), on their own brain (src/rivals/rivals.ts) with the real Flight and TurboDrive
// flying the player's bus over a flat world, no browser: node tools/feel-sim/run.mjs ../rivals/s_rivals.ts
//   seen     flying straight for two minutes, three times over, in Cruise, Express, Nonstop and Jet: how much of it a rival is in front of the bus, inside
//            the lens (19 degrees either side at the least) and no further than one comes in at that speed (1.2 km at Cruise, 2.3 km at Jet). The duel's
//            captains were on the screen 36 to 42 % of a match
//   front    what a tap goes for: the rival nearest the nose's line within the cone and the reach, and nobody outside them
//   ram      two buses driven at each other every way, at closing speeds from 40 to 1,800 m/s, at 30 and at 60 frames a second: every one touches (none passes
//            through the other), the tier goes by the closing speed alone, the one struck in its side or tail takes all of it and nose to nose both do
//   fling    a bus that takes it flies 1.5 s of the closing speed, 1.5 km at the most, and comes down
//   fair     left alone they never fire; one shot at honks first and fires only after, only one hunts at a time, and it lets it go
// Prints a row each, and exits 1 if one fails.
import { config } from '../feel-sim/lib';
import { Flight } from '@src/game/Flight';
import { TurboDrive } from '@src/game/Turbo';
import { Rivals, rivalTune as T, RState, type Me, type Rival, type RivalEvent } from '@src/rivals/rivals';

const flat = { obstacleAt: () => 20, groundAt: () => 10 };
const DEG = Math.PI / 180;
const r1 = (v: number) => +v.toFixed(1);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(34)} ${JSON.stringify(o)}`);
};
const meOf = (f: Flight, out = false): Me => ({ x: f.x, y: f.y, z: f.z, heading: f.heading, nose: f.heading, speed: f.ground, faction: 1, out });

// ---------------------------------------------------------------- seen
for (const [name, rungs] of [['Cruise', 0], ['Express', 1], ['Nonstop', 2], ['Jet', 3]] as const) {
  // (three flights of two minutes, each with its own rivals)
  let seen = 0, front = 0, total = 0, spawns = 0, gone = 0;
  const nearest: number[] = [];
  let full = true;
  for (const seed of [7, 1031, 90001]) {
    const f = new Flight(), drive = new TurboDrive([-1e9, -1e9, 1e9, 1e9]), R = new Rivals(seed + rungs), dt = 1 / 30;
    drive.edgeless = true;
    f.y = 26.5;
    f.glideSpeed = 0;
    for (let i = 0; i < rungs; i++) drive.rung(1, f);
    R.onEvent = (ev) => {
      if (ev === 'spawn') spawns++;
      if (ev === 'gone') gone++;
    };
    for (let t = 0; t < 150; t += dt) {
      drive.update(dt, f);
      for (let i = 0; i < 4; i++) f.step(dt / 4, { sx: 0, sy: 0, dragging: false }, flat);
      R.step(dt, meOf(f), flat);
      if (t < 30) continue;
      total++;
      // (as far as one comes in at this speed, where its tag is on the screen: 1.2 km at Cruise, 2.3 km at Jet)
      const reach = Math.max(1200, T.far * (1 + f.ground / T.nearPer) * 1.1);
      let lens = false, ahead = false, near = Infinity;
      for (const r of R.list) {
        if (!r.live) continue;
        const dx = r.x - f.x, dz = r.z - f.z, d = Math.hypot(dx, dz), off = Math.abs(wrap(Math.atan2(dx, -dz) - f.heading));
        near = Math.min(near, d);
        if (off < 19 * DEG && d < reach) lens = true;
        if (off < 60 * DEG && d < reach) ahead = true;
      }
      if (lens) seen++;
      if (ahead) front++;
      nearest.push(near);
    }
    if (R.live !== T.count) full = false;
  }
  nearest.sort((a, b) => a - b);
  row(seen / total > 0.45 && front / total > 0.7 && full, `seen, ${name}`, { inTheLens: `${Math.round((100 * seen) / total)} %`, within60Degrees: `${Math.round((100 * front) / total)} %`, nearestMedianM: Math.round(nearest[nearest.length >> 1]), cameIn: spawns, went: gone });
}

// ---------------------------------------------------------------- front
{
  const R = new Rivals(3), me: Me = { x: 0, y: 30, z: 0, heading: 0, nose: 0, speed: 30, faction: 1, out: false };
  const put = (i: number, bearingDeg: number, d: number, state = RState.Roam): Rival => {
    const r = R.list[i];
    Object.assign(r, { live: true, x: Math.sin(bearingDeg * DEG) * d, z: -Math.cos(bearingDeg * DEG) * d, y: 30, state });
    return r;
  };
  const clear = () => R.list.forEach((r) => (r.live = false));
  const a = put(0, 10, 300), b = put(1, -4, 350), c = put(2, 40, 100);
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
  row(pick1 === b && pick2 === null && pick3 === null && pick4 === d, 'front', { nearestTheLine: pick1 === b, outsideConeAndReach: pick2 === null, aFlungOne: pick3 === null, byTheNoseInASkid: pick4 === d });
  void a;
  void c;
}

// ---------------------------------------------------------------- the ram
/** The player (heading north along -z at vMe) and one rival, set to meet at the origin in a second; `bearing`: where the rival comes from, the way it goes. */
function meet(vMe: number, vIt: number, itHeadingDeg: number, dt: number, offset = 0) {
  const R = new Rivals(5);
  R.on = false;
  const r = R.list[0], h = itHeadingDeg * DEG, lead = 1;
  Object.assign(r, { live: true, faction: 2, heading: h, course: h, speed: vIt, gear: 0, state: RState.Roam, y: 30, x: -Math.sin(h) * vIt * lead + offset, z: Math.cos(h) * vIt * lead, paintIn: 1e9 });
  r.px = r.x;
  r.pz = r.z;
  r.py = r.y;
  // (the rival holds its line and its speed, whatever its pace would have it: this is the rule's test, not its flying)
  const speeds = T.speeds.slice(), weave = T.weave, crawl = T.crawl;
  T.speeds[0] = T.speeds[1] = T.speeds[2] = T.speeds[3] = T.crawl = vIt;
  T.weave = 0;
  const me: Me = { x: 0, y: 30, z: vMe * lead, heading: 0, nose: 0, speed: vMe, faction: 1, out: false };
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
    // (level with it, as the rival comes level with the player when it's near)
    if (!ram) me.y = r.y;
    R.step(dt, me, flat);
    lowest = Math.min(lowest, r.y);
  }
  T.speeds.splice(0, 4, ...speeds);
  T.weave = weave;
  T.crawl = crawl;
  return { ram: ram as typeof ram, flew: landed ? Math.hypot((landed as { x: number }).x - x0, (landed as { z: number }).z - z0) : NaN, lowest };
}
{
  // (nose to nose: the rival comes south, heading 180)
  const out: string[] = [];
  let ok = true;
  for (const [vMe, vIt, tier] of [[20, 20, 0], [35, 35, 1], [112, 30, 1], [112, 112, 2], [225, 225, 2], [450, 112, 3], [450, 450, 3], [900, 450, 3], [900, 900, 3]] as const) {
    for (const dt of [1 / 60, 1 / 30]) {
      const m = meet(vMe, vIt, 180, dt, 3);
      const good = !!m.ram && m.ram.tier === tier && m.ram.me && m.ram.it && Math.abs(m.ram.closing - (vMe + vIt)) < (vMe + vIt) * 0.02 + 1;
      if (!good) ok = false;
      if (dt === 1 / 30) out.push(`${vMe + vIt} m/s: ${m.ram ? ['bump', 'smash', 'wreck', 'head-on'][m.ram.tier] : 'MISSED'}${good ? '' : ' (!)'}`);
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
      if (dt === 1 / 30) out.push(`${vMe} into its side: ${m.ram ? `${['bump', 'smash', 'wreck', 'head-on'][m.ram.tier]}, ${m.ram.it && !m.ram.me ? 'it takes it' : m.ram.me && m.ram.it ? 'both' : 'the player'}` : 'MISSED'}${good ? '' : ' (!)'}`);
    }
  }
  row(ok, 'ram, into its side', out);
}
{
  // (into its tail: both north, the player faster. The closing speed is the difference)
  const out: string[] = [];
  let ok = true;
  for (const [vMe, vIt, tier] of [[112, 80, 0], [225, 112, 1], [450, 112, 2]] as const) {
    for (const dt of [1 / 60, 1 / 30]) {
      const m = meet(vMe, vIt, 0, dt);
      const good = !!m.ram && m.ram.tier === tier && m.ram.it && !m.ram.me && Math.abs(m.ram.closing - (vMe - vIt)) < 3;
      if (!good) ok = false;
      if (dt === 1 / 30) out.push(`${vMe} into the tail of ${vIt}: ${m.ram ? `${['bump', 'smash', 'wreck', 'head-on'][m.ram.tier]} at ${Math.round(m.ram.closing)}` : 'MISSED'}${good ? '' : ' (!)'}`);
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
      const R = new Rivals(5);
      R.on = false;
      const r = R.list[0];
      Object.assign(r, { live: true, faction: 2, heading: 0, course: 0, speed: vIt, state: RState.Roam, y: 30, x: 0, z: vIt, paintIn: 1e9 });
      r.px = r.x;
      r.pz = r.z;
      r.py = r.y;
      const speeds = T.speeds.slice(), weave = T.weave, crawl = T.crawl;
      T.speeds[0] = T.speeds[1] = T.speeds[2] = T.speeds[3] = T.crawl = vIt;
      T.weave = 0;
      const me: Me = { x: -20, y: 30, z: 0, heading: 90 * DEG, nose: 90 * DEG, speed: 20, faction: 1, out: false };
      let ram: null | typeof R.ram = null;
      R.onEvent = (ev) => {
        if (ev === 'ram' && !ram) ram = { ...R.ram };
      };
      for (let t = 0; t < 3; t += dt) {
        me.x += 20 * dt;
        if (!ram) me.y = r.y;
        R.step(dt, me, flat);
      }
      T.speeds.splice(0, 4, ...speeds);
      T.weave = weave;
      T.crawl = crawl;
      const m = ram as null | typeof R.ram;
      const good = !!m && m.tier === tier && m.me && !m.it && m.meZ < -0.9;
      if (!good) ok = false;
      if (dt === 1 / 30) out.push(`${vIt} into the player's side: ${m ? `${['bump', 'smash', 'wreck', 'head-on'][m.tier]}, ${m.me && !m.it ? 'the player takes it' : 'both'}` : 'MISSED'}${good ? '' : ' (!)'}`);
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

{
  // (coming up behind one that goes the player's way, at its pace: a bump at Cruise, a smash from Express, a wreck from Jet)
  const out: string[] = [];
  let ok = true;
  for (const [name, v, least, most] of [['Cruise', 26, 0, 0], ['Express', 112, 1, 1], ['Nonstop', 225, 1, 1], ['Jet', 450, 2, 2], ['Turbo 3', 900, 2, 2]] as const) {
    const tiers: number[] = [];
    for (const pace of [T.paceWith[0], T.paceWith[1]]) {
      const m = meet(v, Math.min(T.speeds[3], Math.max(T.crawl, v * pace)), 0, 1 / 30);
      tiers.push(m.ram ? m.ram.tier : -1);
    }
    if (Math.min(...tiers) < least || Math.max(...tiers) > most) ok = false;
    out.push(`${name}: ${[...new Set(tiers)].map((t) => ['MISSED', 'bump', 'smash', 'wreck', 'head-on'][t + 1]).join(' or ')}`);
  }
  row(ok, 'ram, coming up behind one', out);
}

// ---------------------------------------------------------------- fair
{
  const f = new Flight(), R = new Rivals(21), dt = 1 / 30;
  f.y = 26.5;
  f.glideSpeed = 0;
  const log: Array<[number, RivalEvent, number]> = [];
  let t = 0;
  R.onEvent = (ev, r) => log.push([t, ev, r.id]);
  const fly = (s: number) => {
    for (const end = t + s; t < end; t += dt) {
      for (let i = 0; i < 4; i++) f.step(dt / 4, { sx: Math.sin(t * 0.3) * 0.5, sy: 0, dragging: true }, flat);
      R.step(dt, meOf(f), flat);
    }
  };
  fly(120);
  const before = log.filter((e) => e[1] === 'shell' || e[1] === 'honk').length, paints = log.filter((e) => e[1] === 'paint').length;
  // (the player starts on all three)
  for (const r of R.list) if (r.live) R.provoke(r);
  const t0 = t;
  let twoHunting = false;
  for (const end = t + 90; t < end; t += dt) {
    for (let i = 0; i < 4; i++) f.step(dt / 4, { sx: Math.sin(t * 0.3) * 0.5, sy: 0, dragging: true }, flat);
    R.step(dt, meOf(f), flat);
    if (R.list.filter((r) => r.live && (r.state === RState.Hunt || r.state === RState.Honk)).length > 1) twoHunting = true;
  }
  const after = log.filter((e) => e[0] >= t0), honks = after.filter((e) => e[1] === 'honk'), shells = after.filter((e) => e[1] === 'shell');
  // (every shell is from a rival that honked at least `honk` s before it, since its last honk)
  let unannounced = 0;
  for (const s of shells) {
    const h = honks.filter((x) => x[2] === s[2] && x[0] <= s[0]).pop();
    if (!h || s[0] - h[0] < T.honk - 1e-6) unannounced++;
  }
  const hunters = new Set(honks.map((h) => h[2])).size;
  row(before === 0 && paints > 3 && honks.length >= 1 && shells.length > 0 && unannounced === 0 && !twoHunting, 'fair', { leftAlone120s: { shellsOrHonks: before, splats: paints }, shotAt90s: { honks: honks.length, differentRivals: hunters, shells: shells.length, shellsWithNoHonkBefore: unannounced, twoAtOnce: twoHunting } });
}
void config;
void r1;
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
