// The duel's dodge test (docs/specs/shots/SHOTS.md, "The duel"; src/recess/Duel.ts), in Node on the REAL Input, Flight, Holds, Recess, Captain and Duel:
//   node tools/controls-sim/run.mjs ../recess/s_duel.ts [--n <shots a cell>] [--quick]
// A captain's shot at the player: doing nothing (straight and in a steady turn, any bearing, Cruise and a faster gear) it hits about 95 %; a flick or a hard
// turn in the white dodges it, by level, at a person's reaction time; too early fails. The player's lock, with a real finger: the pick, the clack, the full
// charge, the weak lift, the taps the lock keeps, and the captains dodging 30 / 55 / 75 % (less against a full charge). Only an aimed shot possesses. And
// the first duel, with the real captains from the real kickoff: a dodge the player wins inside 10 s. Results: shots/controls/sim/duel.json (SB_OUT moves it).
import { installDom, Target, clock, ptr, newId, runTimers } from '../controls-sim/fakedom';
import { mkdirSync, writeFileSync } from 'node:fs';

installDom();
const THREE = await import('three');
const { Input } = await import('@src/game/Input');
const { Flight } = await import('@src/game/Flight');
const { Holds } = await import('@src/game/Hold');
const { Particles } = await import('@src/fx/Particles');
const { Recess, recessTune } = await import('@src/recess/recess');
const { Captain, rng } = await import('@src/recess/captain');
const { Duel, duelTune } = await import('@src/recess/Duel');
const { Faction } = await import('@src/factions/areas');

type Level = 'learner' | 'rival' | 'veteran';
const LEVELS: Level[] = ['learner', 'rival', 'veteran'];
const arg = (k: string, d: number) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const QUICK = process.argv.includes('--quick');
const N = arg('--n', QUICK ? 60 : 240);

const W = 393, H = 852, Y = 120, DT = 1 / 60;
const LANE = { x: 196, y: 506, r: 0.27 * 393, open: 0.25 * 852 };
const FLAT = { obstacleAt: () => 0, groundAt: () => 0 };
const city = { surfaceAt: () => 0, groundAt: () => 0, buildingAt: () => null, roofAt: () => null } as any;
const particles = new Particles(3000) as any;
const audio = { hosePour: () => {}, hoseLevel: () => {}, hoseStop: () => {}, denied: () => {}, superHoseHit: () => {}, homingWhistle: () => {} } as any;

interface Setup { faction: number; bot?: Level | null; x?: number; z?: number; heading?: number }
function world(o: { levels: [Level, Level]; seed?: number; kickoff?: boolean; brains?: boolean }) {
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode('touch');
  input.busZone = LANE;
  const flight = new Flight();
  const r0 = recessTune.radius * 0.6, ahead = r0 - 500;
  // (the kickoff's layout is recessBoot's: the player at the arena's east, flying west at the two captains)
  Object.assign(flight, o.kickoff ? { x: r0, y: Y, z: 0, heading: -Math.PI / 2, fullness: 1 } : { x: 0, y: Y, z: 0, heading: 0, fullness: 1 });
  const camera = new THREE.PerspectiveCamera(60, W / H, 1, 20000);
  const mouth = new THREE.Vector3();
  const holds = new Holds({ input, camera, city, flight, particles, audio, mouth: () => mouth.set(flight.x, flight.y, flight.z), view: () => ({ w: W, h: H }), faction: () => 1, breath: () => {} } as any);
  const setup: Setup[] = o.kickoff
    ? [{ faction: Faction.RAINBOW, x: r0, z: 0, heading: Math.PI }, { faction: Faction.ATLANTIS, bot: o.levels[0], x: ahead, z: 84, heading: -0.17 }, { faction: Faction.INFERNO, bot: o.levels[1], x: ahead, z: -84, heading: 0.17 }]
    : [{ faction: Faction.RAINBOW, x: 0, z: 0, heading: -Math.PI / 2 }, { faction: Faction.ATLANTIS, bot: o.levels[0], x: 0, z: 400, heading: -Math.PI / 2 }, { faction: Faction.INFERNO, bot: o.levels[1], x: 0, z: 600, heading: -Math.PI / 2 }];
  const sim = new Recess(setup as any, { log: false });
  sim.buses[0].external = true;
  sim.duel = true;
  const captains = [new Captain(o.levels[0], 0x5eed), new Captain(o.levels[1], 0x5eed + 101)];
  const w = {
    el, input, flight, camera, holds, sim, captains, t: 0, acc: 0,
    /** the steering: scripted (the thumb's stretch, -1 to 1), or the real Input's */
    scripted: true, steer: 0,
    brains: !!o.brains, said: [] as string[], clacks: [] as boolean[], counts: {} as Record<string, number>, taps: [] as boolean[],
    events: [] as { t: number; kind: string; a: number; b: number }[],
    duel: null as unknown as InstanceType<typeof Duel>,
  };
  w.duel = new Duel({
    holds, sim, flight, cx: 0, cz: 0, yOf: () => Y, sizeOf: () => 8, level: (id: number) => o.levels[id - 1], playing: () => true,
    steer: () => (w.scripted ? w.steer : input.state.stretch.x),
    clack: (full: boolean) => { w.clacks.push(full); }, say: (lines: string[]) => { w.said.push(lines.join(' / ')); },
    count: (k: string) => { w.counts[k] = (w.counts[k] ?? 0) + 1; }, kick: () => {}, seed: o.seed ?? 1,
  });
  input.onAimStart = () => holds.begin();
  input.onAimEnd = (c: boolean, late: boolean) => holds.end(c, late);
  input.onTap = () => { w.taps.push(holds.tap()); };
  if (o.kickoff) {
    // (recessBoot's bell: the easiest captain's kickoff hunts the player, the other's doesn't)
    const rank = (l: Level) => LEVELS.indexOf(l), easiest = rank(o.levels[1]) <= rank(o.levels[0]) ? 1 : 0;
    captains.forEach((c, i) => c.kickoff(0, i === easiest ? 0 : -1));
  }
  return w;
}
type World = ReturnType<typeof world>;

const tmp = new THREE.Vector3();
/** One frame, in main.ts's order: the Input, the flight, the camera, the holds, then the match's steps and the duel. */
function frame(w: World): void {
  clock.ms += DT * 1000;
  runTimers();
  w.input.update(DT);
  const st = w.input.state, f = w.flight;
  f.step(DT, w.scripted ? { sx: w.steer, sy: 0, dragging: true } : { sx: st.stretch.x, sy: st.stretch.y, dragging: st.dragging }, FLAT as any);
  // (a chase camera: behind and over the bus, the bus low on the screen as the rig holds it)
  w.camera.position.set(f.x - f.fx * 34, f.y + 14, f.z - f.fz * 34);
  w.camera.lookAt(tmp.set(f.x + f.fx * 60, f.y + 6, f.z + f.fz * 60));
  w.camera.updateMatrixWorld();
  w.holds.frame(DT);
  w.acc += DT;
  while (w.acc >= w.sim.dt - 1e-9) {
    w.acc -= w.sim.dt;
    const b = w.sim.buses[0];
    b.x = f.x; b.z = f.z; b.heading = f.heading - Math.PI / 2; b.speed = f.ground;
    w.sim.step(w.sim.buses.map((x: any) => (x.id === 0 || !w.brains ? { steer: 0, tap: false, flick: 0 } : w.captains[x.id - 1].think(w.sim, x))));
    w.duel.heard();
    for (const e of w.sim.events) w.events.push({ t: e.t, kind: e.kind, a: e.a, b: e.b });
  }
  w.duel.frame(DT);
  particles.update(DT);
  w.t += DT;
}
const run = (w: World, s: number) => { for (let i = Math.round(s / DT); i > 0; i--) frame(w); };
const done = (w: World) => { w.duel.reset(); w.input.dispose(); };

const rows: { name: string; got: string; ok: boolean }[] = [];
const fails: string[] = [];
const ok = (cond: boolean, name: string, got: string) => { rows.push({ name, got, ok: cond }); if (!cond) fails.push(`${name}: ${got}`); };
const pct = (a: number, n: number) => `${n ? Math.round((100 * a) / n) : 0} %`;
const out: Record<string, unknown> = { n: N, tune: duelTune };

// ---- a captain's shot at the player ---------------------------------------------------------------------------------------------------------------------------
interface Shot { level: Level; gear: number; steer: number; bearing: number; dist: number; first?: boolean; act?: 'none' | 'flick' | 'turn' | 'earlyFlick' | 'earlyTurn'; react?: number; dir?: 1 | -1; change?: number }
interface ShotOut { how: string; flew: number; white: number; flickTook: boolean | null; moved: number; rose: number; rule: boolean; speed: number }
/** One captain's shot at a bus flying `gear` m/s with the thumb at `steer`, from `bearing` (rad off the nose) and `dist` m; what the player does, and what came of it. */
function shot(o: Shot): ShotOut {
  const w = world({ levels: [o.level, o.level] });
  const f = w.flight, d = w.duel;
  if (o.gear > 31) f.turbo.speed = o.gear;
  w.steer = o.steer;
  run(w, 3);
  const b = w.sim.buses[1], a = f.heading + o.bearing;
  b.x = f.x + Math.sin(a) * o.dist; b.z = f.z - Math.cos(a) * o.dist;
  if (!o.first) d.first.fired = 0;
  (d as any).captainFire(1);
  const c = d.incoming[0];
  const r: ShotOut = { how: 'refused', flew: 0, white: 0, flickTook: null, moved: 0, rose: 0, rule: false, speed: c ? c.speed : 0 };
  if (!c) { done(w); return r; }
  const t0 = w.t;
  let tw = -1, acted = false, x0 = 0, z0 = 0, y0 = 0, hi = 0;
  const s = c.shot!;
  const act = () => {
    acted = true; x0 = f.x; z0 = f.z; y0 = f.y;
    if (o.act === 'flick' || o.act === 'earlyFlick') r.flickTook = d.flick(o.dir ?? 1);
    else w.steer = Math.max(-1, Math.min(1, o.steer + (o.dir ?? 1) * (o.change ?? 1)));
  };
  while (!s.done && w.t - t0 < 8) {
    if (tw < 0 && s.white) tw = w.t;
    if (!acted && (o.act === 'earlyFlick' || o.act === 'earlyTurn') && tw < 0 && w.t - t0 >= (o.react ?? 0.1)) act();
    if (!acted && (o.act === 'flick' || o.act === 'turn') && tw >= 0 && w.t - tw >= (o.react ?? 0.4)) act();
    frame(w);
    if (acted) hi = Math.max(hi, f.y - y0);
  }
  r.how = d.qa.capHits ? 'hit' : d.qa.capWhy || 'flying';
  r.flew = w.t - t0;
  r.white = tw < 0 ? 0 : w.t - tw;
  r.rule = c.dodged;
  if (acted) { r.moved = Math.hypot(f.x - x0, f.z - z0); r.rose = hi; }
  done(w);
  return r;
}

// (the cells: the thumb, the gear; the bearing and the range are drawn by a seeded dice)
const dice = rng(0xd0d6e);
const between = (a: number, b: number) => a + (b - a) * dice();
const GEARS = [30, 112, 225];
{
  // A: doing nothing
  const cells: Record<string, { n: number; hit: number; why: Record<string, number>; flew: number; white: number }> = {};
  let all = 0, hit = 0;
  for (const level of LEVELS) for (const gear of GEARS) for (const steer of [0, 0.5, -1]) {
    const k = `${level} ${gear} m/s thumb ${steer}`, cell = (cells[k] = { n: 0, hit: 0, why: {}, flew: 0, white: 0 });
    for (let i = 0; i < Math.ceil(N / 6); i++) {
      const r = shot({ level, gear, steer, bearing: between(-Math.PI, Math.PI), dist: between(150, 550) });
      cell.n++; all++;
      if (r.how === 'hit') { cell.hit++; hit++; } else cell.why[r.how] = (cell.why[r.how] ?? 0) + 1;
      cell.flew += r.flew; cell.white += r.white;
    }
    cell.flew = +(cell.flew / cell.n).toFixed(2); cell.white = +(cell.white / cell.n).toFixed(2);
  }
  out.nothing = cells;
  const by = (pick: (k: string) => boolean) => { let n = 0, h = 0; for (const k in cells) if (pick(k)) { n += cells[k].n; h += cells[k].hit; } return { n, h }; };
  const worst = Object.entries(cells).sort((p, q) => p[1].hit / p[1].n - q[1].hit / q[1].n)[0];
  ok(hit / all >= 0.9, 'doing nothing, a captain\'s shot hits (SHOTS.md: about 95 %)', `${pct(hit, all)} of ${all}; the worst cell ${worst[0]}: ${pct(worst[1].hit, worst[1].n)} ${JSON.stringify(worst[1].why)}`);
  for (const steer of [0, 0.5, -1]) { const c = by((k) => k.endsWith(`thumb ${steer}`)); ok(c.h / c.n >= 0.85, `  the thumb held at ${steer}`, `${pct(c.h, c.n)} of ${c.n}`); }
  for (const gear of GEARS) { const c = by((k) => k.includes(` ${gear} m/s`)); ok(c.h / c.n >= 0.85, `  at ${gear} m/s`, `${pct(c.h, c.n)} of ${c.n}`); }
  // (the shot flies and is white a level's real seconds, whatever the bus is closing at)
  for (const level of LEVELS) {
    let n = 0, fl = 0, wh = 0;
    for (const k in cells) if (k.startsWith(level)) { n++; fl += cells[k].flew; wh += cells[k].white; }
    const T = duelTune;
    ok(Math.abs(wh / n - T.capWhite[level]) < 0.25, `  ${level}: white for about ${T.capWhite[level]} s, in the air about ${T.capFlight[level]} s`, `white ${(wh / n).toFixed(2)} s, in the air ${(fl / n).toFixed(2)} s`);
  }
}
{
  // B and C: a flick, and a hard turn, in the white, at a person's reaction time (0.25 to 0.75 s after it goes white)
  for (const way of ['flick', 'turn'] as const) {
    const cells: Record<string, { n: number; dodged: number; took: number }> = {};
    let all = 0, dodged = 0;
    for (const level of LEVELS) for (const gear of GEARS) {
      const cell = (cells[`${level} ${gear}`] = { n: 0, dodged: 0, took: 0 });
      for (let i = 0; i < Math.ceil(N / 3); i++) {
        const steer = way === 'turn' ? [0, 0.4, -0.4][i % 3] : [0, 0.5, -1][i % 3];
        const r = shot({ level, gear, steer, bearing: between(-Math.PI, Math.PI), dist: between(150, 550), act: way, react: between(0.25, 0.75), dir: way === 'turn' && steer ? (steer > 0 ? -1 : 1) : i % 2 ? 1 : -1 });
        cell.n++; all++;
        if (r.how === 'dodged') { cell.dodged++; dodged++; }
        if (r.flickTook) cell.took++;
      }
    }
    out[way] = cells;
    const line = LEVELS.map((l) => { let n = 0, h = 0; for (const k in cells) if (k.startsWith(l)) { n += cells[k].n; h += cells[k].dodged; } return `${l} ${pct(h, n)}`; }).join(', ');
    const gears = GEARS.map((g) => { let n = 0, h = 0; for (const k in cells) if (k.endsWith(` ${g}`)) { n += cells[k].n; h += cells[k].dodged; } return `${g} m/s ${pct(h, n)}`; }).join(', ');
    ok(dodged / all >= 0.75 && dodged / all <= 0.97, `a ${way === 'flick' ? 'flick' : 'hard turn'} in the white, 0.25 to 0.75 s after it starts, dodges (SHOTS.md: about 85 %)`, `${pct(dodged, all)} of ${all}: ${line}; ${gears}`);
  }
  // (the flick's show: the lunge on, the brake-hop back and up; and the gears never hear it)
  const up = shot({ level: 'learner', gear: 30, steer: 0, bearing: 0.4, dist: 400, act: 'flick', react: 0.3, dir: 1 });
  const dn = shot({ level: 'learner', gear: 30, steer: 0, bearing: 0.4, dist: 400, act: 'flick', react: 0.3, dir: -1 });
  ok(up.flickTook === true && dn.flickTook === true && up.how === 'dodged' && dn.how === 'dodged', 'a flick in the white is the dodge\'s: the gears never hear it', `up ${up.flickTook} ${up.how}, down ${dn.flickTook} ${dn.how}`);
  ok(up.moved - dn.moved > duelTune.lunge * 0.8 && dn.rose > duelTune.hop * 0.8 && up.rose < 0.5, 'a flick up lunges the bus on, a flick down brake-hops it', `after the flick the bus went ${up.moved.toFixed(0)} m (up) and ${dn.moved.toFixed(0)} m (down), and rose ${up.rose.toFixed(1)} and ${dn.rose.toFixed(1)} m`);
}
{
  // D: too early fails
  let n = 0, hit = 0, took = 0;
  for (const level of LEVELS) for (let i = 0; i < Math.ceil(N / 4); i++) {
    const r = shot({ level, gear: [30, 112][i % 2], steer: 0, bearing: between(-Math.PI, Math.PI), dist: between(350, 550), act: 'earlyFlick', react: 0.05, dir: i % 2 ? 1 : -1 });
    n++; if (r.how === 'hit') hit++; if (r.flickTook) took++;
  }
  ok(took === 0 && hit / n >= 0.9, 'a flick before the white is a gear\'s, and no dodge', `${took} taken of ${n}; the shot hit ${pct(hit, n)}`);
  let tn = 0, thit = 0;
  for (const level of LEVELS) for (let i = 0; i < Math.ceil(N / 4); i++) {
    const r = shot({ level, gear: [30, 112][i % 2], steer: 0, bearing: between(-Math.PI, Math.PI), dist: between(350, 550), act: 'earlyTurn', react: 0.02, dir: i % 2 ? 1 : -1, change: 1 });
    tn++; if (r.how === 'hit') thit++;
  }
  out.early = { flick: { n, hit, took }, turn: { n: tn, hit: thit } };
  ok(thit / tn >= 0.7, 'a turn begun as the shot leaves, and held, is followed', `the shot hit ${pct(thit, tn)} of ${tn}`);
}
{
  // the match's first shot at the player: longer in the air, white longer, and a gentler turn dodges it
  const r = shot({ level: 'rival', gear: 30, steer: 0, bearing: 0.3, dist: 300, first: true, act: 'turn', react: 0.5, change: 0.35 });
  const later = shot({ level: 'rival', gear: 30, steer: 0, bearing: 0.3, dist: 300, act: 'none' });
  ok(r.how === 'dodged' && r.rule && r.white > later.white + 0.2, 'the match\'s first shot at you: white longer, and a gentle turn dodges it', `${r.how}, white ${r.white.toFixed(2)} s (a later one ${later.white.toFixed(2)} s)`);
}

// ---- the player's lock -----------------------------------------------------------------------------------------------------------------------------------------
interface Lock { level: Level; hold: number; seed: number; taps?: number[]; cancel?: boolean }
function lock(o: Lock) {
  const w = world({ levels: [o.level, o.level], seed: o.seed });
  const f = w.flight, d = w.duel, b = w.sim.buses[1];
  // (the captain 260 m ahead and a little right, flying the player's way; the other well behind)
  b.x = 30; b.z = -260; b.heading = -Math.PI / 2;
  w.sim.buses[2].x = 0; w.sim.buses[2].z = 700;
  run(w, 0.5);
  const p = d.at(1, new THREE.Vector3()), s = { x: 0, y: 0 };
  const on = w.holds.screenOf(p, s);
  const id = newId();
  w.el.dispatch('pointerdown', ptr('pointerdown', id, s.x, s.y, true));
  const t0 = w.t;
  let lockedAt = -1;
  while (w.t - t0 < o.hold) { frame(w); if (lockedAt < 0 && d.locked === 1) lockedAt = w.t - t0; }
  w.el.dispatch(o.cancel ? 'pointercancel' : 'pointerup', ptr(o.cancel ? 'pointercancel' : 'pointerup', id, s.x, s.y, true));
  const tl = w.t;
  const fly = () => { const t1 = w.t; while ((d as any).mine.length && w.t - t1 < 6) frame(w); run(w, 0.1); };
  fly();
  const rode = () => w.events.some((e) => e.kind === 'hit' && e.a === 0 && e.b === 1);
  const first = { fired: d.qa.fired, hits: d.qa.hits, why: d.qa.why, rode: rode(), state: b.state as string };
  // (taps after the lift, each this long after it: a quick touch off the lane)
  const tapped: boolean[] = [];
  const was: unknown[] = [];
  for (const at of o.taps ?? []) {
    run(w, Math.max(0, at - (w.t - tl)));
    const tid = newId(), n0 = w.taps.length;
    was.push({ t: +(w.t - tl).toFixed(2), locked: d.locked, state: b.state, taps: n0 });
    w.el.dispatch('pointerdown', ptr('pointerdown', tid, 60, 200, true));
    run(w, 0.05);
    w.el.dispatch('pointerup', ptr('pointerup', tid, 60, 200, true));
    run(w, 0.05);
    tapped.push(w.taps.length > n0 ? w.taps[w.taps.length - 1] : false);
  }
  fly();
  const r = { on, sx: s.x, sy: s.y, lockedAt, qa: { ...d.qa }, clacks: w.clacks.slice(), first, tapped, was, counts: { ...w.counts }, locked: d.locked, bus0: w.sim.buses[0].state as string, breaths: w.sim.breaths.length };
  done(w);
  return r;
}
{
  const a = lock({ level: 'learner', hold: 0.7, seed: 3 });
  out.lock = a;
  ok(a.on && Math.hypot(a.sx - LANE.x, a.sy - LANE.y) > LANE.r && a.qa.picks === 1 && a.lockedAt > 0.3 && a.lockedAt < 0.55, 'a still hold on a captain picks it (the hold starts at about 0.42 s)', `on screen at ${a.sx.toFixed(0)}, ${a.sy.toFixed(0)}; locked at ${a.lockedAt.toFixed(2)} s; picks ${a.qa.picks}`);
  ok(a.qa.clacks === 1 && a.clacks.length === 1 && a.clacks[0] === false && a.qa.fulls === 0 && a.qa.fired === 1 && a.qa.weak === 0, 'held past 0.55 s it clacks, and the lift fires a homing shot', JSON.stringify({ clacks: a.clacks, fired: a.qa.fired, weak: a.qa.weak, fulls: a.qa.fulls }));
  const full = lock({ level: 'learner', hold: 1.1, seed: 3 });
  ok(full.qa.fulls === 1 && full.clacks.length === 2 && full.clacks[1] === true && full.qa.fired === 1, 'held past 1.0 s it charges full (a second clack)', JSON.stringify({ clacks: full.clacks, fulls: full.qa.fulls, fired: full.qa.fired }));
  const weak = lock({ level: 'learner', hold: 0.5, seed: 3 });
  ok(weak.qa.clacks === 0 && weak.qa.fired === 1 && weak.qa.weak === 1, 'a lift before the clack still fires, weakly: nothing is wasted', JSON.stringify({ lockedAt: +weak.lockedAt.toFixed(2), clacks: weak.qa.clacks, fired: weak.qa.fired, weak: weak.qa.weak }));
  const gone = lock({ level: 'learner', hold: 0.8, seed: 3, cancel: true });
  ok(gone.qa.fired === 0 && gone.locked === -1, 'a hold the system takes away fires nothing', JSON.stringify({ fired: gone.qa.fired, locked: gone.locked }));
  // (the lock keeps 4 s for taps: at a captain that dodged the first. One that's hit rides, and a ridden bus can't be locked: the lock lets go)
  let taps: ReturnType<typeof lock> | null = null;
  for (let seed = 1; seed < 40 && !taps; seed++) {
    const r = lock({ level: 'veteran', hold: 0.7, seed, taps: [2, 6.5] });
    if (r.first.why === 'dodged') taps = r;
  }
  ok(!!taps && taps.tapped[0] === true && taps.tapped[1] === false && taps.qa.fired === 2, 'for 4 s after the lift a tap goes to the same captain, and after that it doesn\'t', JSON.stringify(taps && { tapped: taps.tapped, fired: taps.qa.fired, was: taps.was }));
  const rode = lock({ level: 'learner', hold: 0.7, seed: 5, taps: [1.5] });
  ok(rode.first.rode && rode.tapped[0] === false && rode.qa.fired === 1 && rode.locked === -1, 'a captain that\'s hit rides, and the lock lets go: the next tap is a plain splat', JSON.stringify({ rode: rode.first.rode, tapped: rode.tapped, fired: rode.qa.fired, was: rode.was }));

  // captains dodge 30 / 55 / 75 % of the time, a full charge 0.6 of that; one that doesn't is hit and ridden
  const table: Record<string, { n: number; dodged: number; hit: number; rode: number; other: number }> = {};
  for (const level of LEVELS) for (const hold of [0.7, 1.1]) {
    const cell = (table[`${level} ${hold > 1 ? 'full' : 'clack'}`] = { n: 0, dodged: 0, hit: 0, rode: 0, other: 0 });
    for (let i = 0; i < N; i++) {
      const r = lock({ level, hold, seed: 100 + i });
      cell.n++;
      if (r.first.hits) cell.hit++; else if (r.first.why === 'dodged') cell.dodged++; else cell.other++;
      if (r.first.rode) cell.rode++;
    }
  }
  out.captains = table;
  const T = duelTune;
  for (const level of LEVELS) {
    const c = table[`${level} clack`], fl = table[`${level} full`], want = T.dodge[level], se = 2.6 * Math.sqrt((want * (1 - want)) / c.n) + 0.02;
    ok(Math.abs(c.dodged / c.n - want) <= se && c.other <= c.n * 0.03, `a ${level} dodges a locked shot about ${Math.round(want * 100)} % of the time`, `${pct(c.dodged, c.n)} of ${c.n} (hit ${c.hit}, other ${c.other})`);
    ok(Math.abs(fl.dodged / fl.n - want * T.fullDodge) <= se && fl.other <= fl.n * 0.03, `  and a full charge about ${Math.round(want * T.fullDodge * 100)} %`, `${pct(fl.dodged, fl.n)} of ${fl.n} (hit ${fl.hit}, other ${fl.other})`);
  }
  const hits = Object.values(table).reduce((s, c) => s + c.hit, 0), rides = Object.values(table).reduce((s, c) => s + c.rode, 0);
  ok(hits > 0 && rides === hits, 'a locked shot that hits rides the captain (Possessed)', `${rides} rides of ${hits} hits`);
}

// ---- only an aimed shot possesses, and the first duel ----------------------------------------------------------------------------------------------------------
interface First { act: 'none' | 'flick' | 'turn'; react: number; gear?: number; steer?: number; dir?: 1 | -1; levels?: [Level, Level] }
function firstDuel(o: First) {
  const w = world({ levels: o.levels ?? ['rival', 'learner'], kickoff: true, brains: true });
  const d = w.duel, f = w.flight;
  if (o.gear) f.turbo.speed = o.gear;
  w.steer = o.steer ?? 0;
  let acted = false, brainShots = 0;
  while (w.t < 16 && !(d.first.ended >= 0 && w.t > d.first.ended + 0.5)) {
    if (!acted && d.first.white >= 0 && w.sim.t - d.first.white >= o.react) {
      acted = true;
      if (o.act === 'flick') d.flick(o.dir ?? 1);
      else if (o.act === 'turn') w.steer = (o.steer ?? 0) + (o.dir ?? 1) * 0.5;
    }
    frame(w);
    // (in the duel no brain's breath is ever aimed at the player's bus: its shots are the duel's)
    brainShots += w.sim.breaths.filter((x: any) => x.target === 0).length;
  }
  const r = { ...d.first, from: w.events.find((e) => e.kind === 'aim')?.a ?? -1, level: -1 as number | string, said: w.said.slice(), brainShots, rode: w.sim.buses[0].state as string, counts: { ...w.counts }, glints: w.events.filter((e) => e.kind === 'glint' && e.b === 0 && e.t < 7.5).map((e) => `${e.a}@${e.t.toFixed(1)}`) };
  r.level = r.from > 0 ? (o.levels ?? ['rival', 'learner'])[r.from - 1] : -1;
  done(w);
  return r;
}
{
  const plays: First[] = [
    { act: 'flick', react: 0.4 }, { act: 'flick', react: 0.7, dir: -1 }, { act: 'turn', react: 0.5 }, { act: 'turn', react: 0.6, dir: -1 },
    { act: 'flick', react: 0.5, gear: 112 }, { act: 'turn', react: 0.5, gear: 112 }, { act: 'flick', react: 0.5, steer: 0.3 }, { act: 'flick', react: 0.5, steer: -0.3 },
    { act: 'flick', react: 0.5, gear: 225 }, { act: 'turn', react: 0.5, steer: 1 }, { act: 'flick', react: 0.5, steer: -1 },
  ];
  const got = plays.map((p) => ({ p, r: firstDuel(p) }));
  out.first = got;
  const g = got[0].r;
  ok(g.glint >= 3 && g.glint <= 4.6 && g.fired >= 4.4 && g.fired <= 6 && g.level === 'learner', 'the first duel: the easiest captain locks you at about 4 s and fires at about 5 s (SHOTS.md, "First contact")', `locked ${g.glint.toFixed(1)} s, fired ${g.fired.toFixed(1)} s, by the ${g.level}; the others' locks before 7.5 s: ${g.glints.join(' ')}`);
  const won = got.filter((x) => x.r.how === 'dodged' && x.r.ended < 10 && x.r.level === 'learner');
  ok(won.length === got.length, 'a dodge the player wins inside 10 s, by a flick or a turn, at Cruise or faster, flying straight or turning', got.map((x) => `${x.p.act}${x.p.gear ? ` ${x.p.gear}` : ''}${x.p.steer ? ` thumb ${x.p.steer}` : ''}: locked ${x.r.glint.toFixed(1)}, fired ${x.r.fired.toFixed(1)}, white ${x.r.white.toFixed(1)}, ${x.r.how} at ${x.r.ended.toFixed(1)} s`).join('; '));
  ok(got.every((x) => x.r.said.includes('FLICK!') && x.r.said.some((s) => s.startsWith('DODGED!') && s.includes('HOLD ON A BUS'))), '  it says FLICK! in the white, then DODGED! and how to shoot back', g.said.join(' | '));
  ok(got.every((x) => x.r.brainShots === 0), '  and no brain\'s breath is aimed at the player\'s bus: its shots are the duel\'s', `${got.reduce((s, x) => s + x.r.brainShots, 0)} seen`);
  const sat = firstDuel({ act: 'none', react: 0 });
  ok(sat.how === 'hit' && sat.rode === 'ride', 'doing nothing, that first shot hits, and the ride is the aimed shot\'s (Possessed)', `${sat.how} at ${sat.ended.toFixed(1)} s; the player's bus: ${sat.rode}`);
  // (harder captains: the first lock is still the easier of the two's)
  const hard = firstDuel({ act: 'flick', react: 0.4, levels: ['veteran', 'rival'] });
  ok(hard.level === 'rival' && hard.how === 'dodged' && hard.ended < 10, '  with a Veteran and a Rival, the first shot is the Rival\'s, and dodged the same', `${hard.level}: ${hard.how} at ${hard.ended.toFixed(1)} s`);
}

const OUT = process.env.SB_OUT ?? 'shots/controls/sim';
mkdirSync(OUT, { recursive: true });
out.rows = rows;
writeFileSync(`${OUT}/duel.json`, JSON.stringify(out, null, 1));
for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(112)} | ${r.got}`);
console.log(fails.length ? `DUEL FAILED ${fails.length} of ${rows.length}` : `duel checks: all ${rows.length} passed`);
process.exit(fails.length ? 1 : 0);
