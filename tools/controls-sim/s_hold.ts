// Hold to aim, the hook and the Hose (docs/specs/shots/SHOTS.md, HOOKS.md) through the REAL Input, Flight, Holds and Hose, offline: synthetic pointers on a controlled
// clock, one frame every 16.7 ms like the game loop, and a flat city at sea level under a camera 300 m up. The Splatter, the particles and the sound are stand-ins that
// write down what they were asked. Writes shots/controls/sim/holds.json (SB_OUT moves it) and a table on stdout.
import { installDom, Target, clock, ptr, newId, runTimers } from './fakedom';
const { win } = installDom();
import { mkdirSync, writeFileSync } from 'node:fs';

const THREE = await import('three');
const { Input, inputTune } = await import('@src/game/Input');
const { Flight } = await import('@src/game/Flight');
const { Holds } = await import('@src/game/Hold');
const { Hose, hoseTune } = await import('@src/game/Hose');
const { config } = await import('@src/config');
const { blastRadiusFor } = await import('@src/game/blastLayout');
const { Coach, TAUGHT } = await import('@src/ui/Coach');
const { Particles } = await import('@src/fx/Particles');

const W = 393, H = 852;
// over the bus's line, out of its half disc: off the lane (the bus stands at 196, 506)
const AX = 300, AY = 300;
const LANE = { x: 196, y: 506, r: 0.27 * 393, open: 0.25 * 852 };
const FLAT = { obstacleAt: () => 0, groundAt: () => 0 };

function harness() {
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode('touch');
  input.busZone = LANE;
  const flight = new Flight();
  Object.assign(flight, { x: 0, y: 120, z: 0, heading: 0, fullness: 1 });
  const camera = new THREE.PerspectiveCamera(60, W / H, 1, 20000);
  camera.position.set(0, 300, 200);
  camera.lookAt(0, 0, -300);
  camera.updateMatrixWorld();
  const log: string[] = [];
  let t0 = clock.ms;
  const at = () => `${Math.round(clock.ms - t0)}ms`;
  const barfs: Array<{ x: number; z: number; r: number; pour: number; hose: boolean; t: number }> = [];
  const city = { surfaceAt: () => 0, groundAt: () => 0, buildingAt: () => null, roofAt: () => null } as any;
  const splatter = { faction: 1, hueNext: 2, lastMiss: false, barf: (x: number, z: number, o: any) => { barfs.push({ x, z, r: o.radius, pour: o.pour ?? 0, hose: !!o.hose, t: clock.ms - t0 }); return 0; } } as any;
  // (the real particles, so the stream's own life is checked: a paused pour keeps its emitter)
  const particles = new Particles(3000) as any;
  const geyser = particles.geyser.bind(particles);
  particles.geyser = (o: any) => { log.push(`geyser@${at()}`); geyser(o); };
  const streams = () => (particles.emitters as Array<{ active: boolean }>).filter((e) => e.active).length;
  const audio = { hosePour: () => log.push(`pour@${at()}`), hoseLevel: () => {}, hoseStop: (dry: boolean) => log.push(`${dry ? 'dry' : 'stop'}@${at()}`), denied: () => log.push(`cough@${at()}`), superHoseHit: () => {}, homingWhistle: () => log.push(`whistle@${at()}`) } as any;
  const mouth = new THREE.Vector3();
  const holds = new Holds({ input, camera, city, flight, particles, audio, mouth: () => mouth.set(flight.x, flight.y, flight.z - 6), view: () => ({ w: W, h: H }), faction: () => 1, breath: () => log.push(`breath@${at()}`) });
  const hose = new Hose({ flight, city, splatter, particles, audio, rig: { kick: () => {} } as any, mouth: () => mouth.set(flight.x, flight.y, flight.z - 6), busVel: () => new THREE.Vector3(), hatch: (o) => o.set(0, 125, 0), flash: () => {}, sign: () => {} });
  holds.add(hose, { last: true });
  input.onAimStart = () => { log.push(`aim@${at()}`); holds.begin(); };
  input.onAimEnd = (c) => { log.push(`aimEnd${c ? '(cancelled)' : ''}@${at()}`); holds.end(c); };
  input.onTap = () => { log.push(`tap@${at()}`); if (holds.tap()) log.push('tap taken'); };
  const step = 16.7;
  let next = clock.ms + step;
  let maxDrain = 0;
  let alt = 120;
  const frame = () => {
    const dt = step / 1000;
    input.update(dt);
    flight.step(dt, { sx: input.state.stretch.x, sy: input.state.stretch.y, dragging: input.state.dragging }, FLAT as any);
    Object.assign(flight, { x: 0, y: alt, z: 0 });
    const was = flight.fullness;
    holds.frame(dt);
    hose.update(dt);
    particles.update(dt);
    maxDrain = Math.max(maxDrain, was - flight.fullness);
  };
  const wait = (ms: number) => {
    const end = clock.ms + ms;
    while (next <= end) { clock.ms = next; runTimers(); frame(); next += step; }
    clock.ms = end;
    runTimers();
  };
  return {
    input, flight, holds, hose, log, barfs, wait, streams, camera, at: () => clock.ms - t0,
    set alt(y: number) { alt = y; Object.assign(flight, { y }); },
    reset() { log.length = 0; barfs.length = 0; t0 = clock.ms; next = clock.ms + step; },
    down(id: number, x: number, y: number, primary = true) { el.dispatch('pointerdown', ptr('pointerdown', id, x, y, primary)); },
    move(id: number, x: number, y: number) { el.dispatch('pointermove', ptr('pointermove', id, x, y)); },
    up(id: number, x: number, y: number) { el.dispatch('pointerup', ptr('pointerup', id, x, y)); },
    slide(id: number, x0: number, y0: number, dx: number, dy: number, ms: number) { const n = Math.max(1, Math.round(ms / 16.7)); for (let i = 1; i <= n; i++) { wait(ms / n); this.move(id, x0 + (dx * i) / n, y0 + (dy * i) / n); } },
  };
}
type Hn = ReturnType<typeof harness>;

const rows: Array<{ name: string; log: string[]; barfs: number; note: unknown }> = [];
const notes: Record<string, any> = {};
function row(name: string, fn: (h: Hn) => unknown) {
  const h = harness();
  h.wait(100);
  h.reset();
  const note = fn(h);
  rows.push({ name, log: [...h.log], barfs: h.barfs.length, note });
  notes[name] = { note, log: [...h.log], barfs: [...h.barfs] };
  h.input.dispose();
}
const hold = (h: Hn, ms: number, x = AX, y = AY) => { const id = newId(); h.down(id, x, y); h.wait(ms); h.up(id, x, y); return id; };

row('tap: off the lane at 150 ms splats, no hold, no pour', (h) => { hold(h, 150); h.wait(300); return { current: h.holds.current, pouring: h.hose.pouring }; });
row('hold to aim, nobody claims: the Hose pours under the finger', (h) => {
  const id = newId(); h.down(id, AX, AY); h.wait(1500);
  const hd = h.holds.current!;
  const v = { owner: hd.owner, hit: hd.hit, point: hd.point.toArray().map((q) => Math.round(q)), ray: { dy: +hd.ray.dy.toFixed(2) }, pouring: h.hose.pouring, tank: +h.flight.fullness.toFixed(3), flightPouring: h.flight.pouring, held: +hd.held.toFixed(2), aimed: +hd.aimed.toFixed(2) };
  h.up(id, AX, AY); h.wait(50);
  return { ...v, after: { pouring: h.hose.pouring, flightPouring: h.flight.pouring, refill: h.flight.rechargeSeconds, current: h.holds.current } };
});
row('the Hose: the tank runs dry at 3 s, it sputters, and this hold pours no more', (h) => { const id = newId(); h.down(id, AX, AY); h.wait(4500); const v = { pouring: h.hose.pouring, tank: h.hose.stats.endTank, dry: h.hose.stats.dry, seconds: +h.hose.stats.seconds.toFixed(2) }; h.up(id, AX, AY); return v; });
row('the Hose: after it runs dry the belly refills in 3 s, not the tap\'s 1.6', (h) => {
  const id = newId(); h.down(id, AX, AY); h.wait(3000);
  for (let i = 0; i < 100 && h.hose.pouring; i++) h.wait(16.7);
  const t0 = h.at(); h.wait(100); h.up(id, AX, AY);
  let full = -1;
  for (let i = 0; i < 300 && full < 0; i++) { h.wait(16.7); if (h.flight.fullness >= 1) full = h.at() - t0; }
  return { fullAfterMs: Math.round(full), refill: h.flight.rechargeSeconds };
});
row('the Hose: let go at 1 s, half a tank refills in 1.5 s', (h) => {
  const id = newId(); h.down(id, AX, AY); h.wait(1000 + 350); h.up(id, AX, AY);
  const left = h.flight.fullness, t0 = h.at(); let full = -1;
  for (let i = 0; i < 300 && full < 0; i++) { h.wait(16.7); if (h.flight.fullness >= 1) full = h.at() - t0; }
  return { left: +left.toFixed(3), fullAfterMs: Math.round(full) };
});
row('the Hose: a drag sweeps it, a blast each time it has moved', (h) => {
  const id = newId(); h.down(id, AX, AY); h.wait(500); h.slide(id, AX, AY, -200, 100, 1200); h.wait(300); h.up(id, AX - 200, AY + 100);
  return {};
});
row('the Hose: a hold with too little in the tank coughs and pours nothing', (h) => { const id = newId(); h.down(id, AX, AY); h.wait(340); h.flight.fullness = 0.05; h.wait(460); h.up(id, AX, AY); return { pours: h.hose.stats.pours, coughs: h.hose.stats.coughs }; });
// (review of step 2, 3: a hold on the sky or past the reach poured nothing and said nothing. Now it throws as far as the stream reaches that way)
const goalRange = (h: Hn) => { const g = (h.hose as any).goal, f = h.flight; return Math.round(Math.hypot(g.x - f.x, g.y - f.y, g.z - f.z)); };
row('the Hose: a hold on the sky pours as far as the stream reaches that way', (h) => {
  const id = newId(); h.down(id, 300, 10); h.wait(900);
  const hd = h.holds.current!;
  const v = { hit: hd.hit, pouring: h.hose.pouring, owner: hd.owner, range: goalRange(h), coughs: h.hose.stats.coughs, rightward: (h.hose as any).goal.x > 0 };
  h.up(id, 300, 10); return v;
});
row('the Hose: a hold on the city past the reach pours at the reach, toward it', (h) => {
  // (the first y down the screen's right side whose ray lands past the reach)
  const r = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 }, p = new THREE.Vector3();
  let y = 10;
  for (; y < 600; y += 2) { h.holds.rayAt(AX, y, r); if (h.holds.landing(r, p) && Math.hypot(p.x, p.y - 120, p.z) > hoseTune.reach + 300) break; }
  const id = newId(); h.down(id, AX, y); h.wait(900);
  const hd = h.holds.current!, g = (h.hose as any).goal;
  const v = { y, hit: hd.hit, range: Math.round(hd.range), pouring: h.hose.pouring, goal: goalRange(h), bearing: +(Math.atan2(g.x, -g.z) - Math.atan2(hd.point.x, -hd.point.z)).toFixed(3) };
  h.up(id, AX, y); return v;
});
row('the Hose: from more than the reach up, nothing reaches: the hold coughs', (h) => { h.alt = 2000; const id = newId(); h.down(id, AX, AY); h.wait(800); const v = { pours: h.hose.stats.pours, coughs: h.hose.stats.coughs, tank: h.flight.fullness }; h.up(id, AX, AY); return v; });
// (review of step 2, 1: the stream's life was fixed when the pour opened; a pour paused longer came back with no stream)
row('the Hose: paused 3.6 s mid-pour (the bus past the reach), the stream comes back with it', (h) => {
  const id = newId(); h.down(id, AX, AY); h.wait(1000);
  const before = { streams: h.streams(), blasts: h.barfs.length, tank: +h.flight.fullness.toFixed(3) };
  h.alt = 2000; h.wait(3600);
  const paused = { streams: h.streams(), blasts: h.barfs.length, tank: +h.flight.fullness.toFixed(3), pouring: h.hose.pouring, flowing: (h.hose as any).flowing };
  h.alt = 120; h.wait(600);
  const back = { streams: h.streams(), blasts: h.barfs.length, open: (h.hose as any).live.open, flowing: (h.hose as any).flowing };
  h.up(id, AX, AY); h.wait(100);
  return { before, paused, back, after: { streams: h.streams(), open: (h.hose as any).live.open } };
});
row('a claimed hold: life takes it at its start, and the Hose never pours', (h) => {
  const seen: string[] = [];
  h.holds.add({ name: 'lock', start: (hd) => (seen.push(`start ${Math.round(hd.x)},${Math.round(hd.y)}`), true), move: () => { if (!seen.includes('move')) seen.push('move'); }, end: (_hd, c) => seen.push(`end ${c}`) });
  hold(h, 1200); return { seen, pours: h.hose.stats.pours, owner: h.holds.stats.lastOwner };
});
row('a claimed hold: one that says no leaves it to the Hose', (h) => { h.holds.add({ name: 'lock', start: () => false }); hold(h, 900); return { pours: h.hose.stats.pours, owner: h.holds.stats.lastOwner }; });
row('a claimed hold: a watcher claims it mid-pour, and the Hose stops', (h) => {
  const seen: string[] = [];
  h.holds.add({ name: 'plane', move: (hd) => { if (hd.aimed > 0.6 && hd.owner !== 'plane') { seen.push(`claim ${h.holds.claim('plane')}`); } }, end: (_hd, c) => seen.push(`end ${c}`) }, { watch: true });
  const id = newId(); h.down(id, AX, AY); h.wait(1400);
  const v = { pouring: h.hose.pouring, owner: h.holds.current!.owner, tank: +h.flight.fullness.toFixed(2) };
  h.up(id, AX, AY); return { seen, ...v };
});
// (review of step 2, 2: a lock that took a hold mid-pour couldn't fire, the belly part drained)
row('a claimed hold: a lock takes it mid-pour, and its lift fires a homing shot from what is left', (h) => {
  const seen: string[] = [];
  let shot: unknown = null, tank = -1;
  h.holds.add({ name: 'ferry', move: (hd) => { if (hd.aimed > 0.6 && hd.owner !== 'ferry') seen.push(`claim ${h.holds.claim('ferry')}`); }, end: (hd, c) => { if (hd.owner !== 'ferry') return; tank = +h.flight.fullness.toFixed(2); shot = h.holds.fire({ target: (o) => (o.set(0, 2, -400), true), speed: 400, turn: 2.5, white: 0.7 }); seen.push(`end ${c}`); } }, { watch: true });
  const id = newId(); h.down(id, AX, AY); h.wait(1200); h.up(id, AX, AY); h.wait(50);
  return { seen, tank, fired: !!shot, barf: h.flight.barfT >= 0 };
});
row('a claimed hold: one handed back to the Hose with 5 % in the tank coughs', (h) => {
  h.holds.add({ name: 'lock', start: () => true });
  const id = newId(); h.down(id, AX, AY); h.wait(600);
  h.flight.fullness = 0.05; h.holds.release('lock'); const back = h.holds.claim('hose'); h.wait(400);
  const v = { back, pours: h.hose.stats.pours, coughs: h.hose.stats.coughs, tank: +h.flight.fullness.toFixed(3) };
  h.up(id, AX, AY); return v;
});
// (review of step 2, 5 and 6)
row('a handler that throws: told once, the frame goes on, and the Hose pours', (h) => {
  const err = console.error; let told = 0; console.error = () => { told++; };
  h.holds.add({ name: 'buggy', start: () => { throw new Error('start'); }, move: () => { throw new Error('move'); }, end: () => { throw new Error('end'); }, tap: () => { throw new Error('tap'); } }, { watch: true });
  const id = newId(); h.down(id, AX, AY); h.wait(1000);
  const v = { pouring: h.hose.pouring, owner: h.holds.current?.owner, blasts: h.barfs.length };
  h.up(id, AX, AY); h.wait(50); hold(h, 120); h.wait(50);
  console.error = err;
  return { ...v, told, errors: h.holds.stats.errors, after: h.hose.pouring };
});
row('a watcher that never has the hold hears it end', (h) => {
  const seen: string[] = [];
  h.holds.add({ name: 'eye', move: () => { if (!seen.includes('move')) seen.push('move'); }, end: (hd, c) => seen.push(`end ${hd.owner} ${c}`) }, { watch: true });
  hold(h, 800); return { seen };
});
row('homing: the player shots past four at once are refused, with a cough', (h) => {
  let n = 0;
  for (let i = 0; i < 5; i++) { h.flight.barfT = -1; h.flight.fullness = 1; if (h.holds.fire({ target: (o) => (o.set(0, 2, -3000), true), speed: 100, turn: 1, white: 0.5 })) n++; }
  return { fired: n, refused: h.holds.stats.refused, coughs: h.log.filter((x) => x.startsWith('cough@')).length };
});
row('a claimed tap: a lock takes the next tap, and nothing splats', (h) => { h.holds.add({ name: 'lock', tap: () => true }); hold(h, 120); return {}; });
row('a hold cancelled (the page lost focus) ends cancelled, and the Hose stops', (h) => { const id = newId(); h.down(id, AX, AY); h.wait(800); win.dispatch('blur', {}); h.wait(50); const v = { pouring: h.hose.pouring, current: h.holds.current }; h.up(id, AX, AY); return v; });

// the homing shot
const target = (h: Hn, path: (t: number) => [number, number, number]) => { const p = new THREE.Vector3(); return (out: any) => { const [x, y, z] = path(h.at() / 1000); out.set(x, y, z); return true; }; };
row('homing: a shot at a boat crossing 15 m/s, 400 m out, hits it', (h) => {
  let hit: number[] | null = null;
  const s = h.holds.fire({ target: target(h, (t) => [-100 + 15 * t, 2, -400]), speed: 300, turn: 2.5, white: 0.7, onHit: (at) => (hit = at.toArray().map(Math.round)) });
  const tank = h.flight.fullness, barf = h.flight.barfT >= 0;
  h.wait(3000); return { fired: !!s, hit, tank: barf && tank === 1 };
});
row('homing: a hard break in the white dodges it, and it flies on by', (h) => {
  let why = '', white = -1, hit = false;
  const s = h.holds.fire({ target: (out) => { const k = white < 0 ? 0 : Math.min(1, Math.max(0, (h.at() - white - 50) / 250)); out.set(40 * k, 120, -500); return true; }, speed: 400, turn: 3, white: 0.7, hitRadius: 7, onWhite: () => (white = h.at()), onHit: () => (hit = true), onMiss: (_a, _s, w) => (why = w) });
  h.wait(3000); return { fired: !!s, hit, why, white };
});
row('homing: the same break before the white is followed, and it hits', (h) => {
  let hit = false, why = '';
  h.holds.fire({ target: (out) => { out.set(40 * Math.min(1, Math.max(0, (h.at() - 100) / 250)), 120, -500); return true; }, speed: 400, turn: 3, white: 0.7, hitRadius: 7, onHit: () => (hit = true), onMiss: (_a, _s, w) => (why = w) });
  h.wait(3000); return { hit, why };
});
row('homing: a plane 12 km out at 3,500 m/s arrives in under 4 s', (h) => {
  let at = -1;
  h.holds.fire({ target: (out) => { out.set(2000 + 60 * (h.at() / 1000), 3000, -11500); return true; }, speed: 3500, turn: 1.5, white: 0.5, hitRadius: 25, onHit: () => (at = h.at()) });
  h.wait(5000); return { hitAtMs: Math.round(at) };
});
row('homing: under 12 % in the belly, no shot (it coughs); a captain\'s shot needs none', (h) => {
  h.flight.fullness = 0.08;
  const mine = h.holds.fire({ target: (o) => (o.set(0, 0, -300), true), speed: 300, turn: 2, white: 0.7 });
  const theirs = h.holds.fire({ from: new THREE.Vector3(0, 150, -800), belly: false, whistle: true, target: (o) => (o.set(0, 120, 0), true), speed: 300, turn: 2, white: 0.7 });
  h.wait(3500); return { mine: !!mine, theirs: !!theirs };
});
row('homing: a target that goes (sunk) ends as lost', (h) => { let why = ''; h.holds.fire({ target: (o) => (o.set(0, 2, -400), h.at() < 400), speed: 300, turn: 2, white: 0.7, onMiss: (_a, _s, w) => (why = w) }); h.wait(2000); return { why }; });

// ---- checks
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const N = (k: string) => notes[Object.keys(notes).find((x) => x.startsWith(k))!];
const has = (k: string, e: string) => N(k).log.some((x: string) => x.startsWith(e));
{
  const a = N('tap:');
  ok(has('tap:', 'tap@') && !has('tap:', 'aim') && a.barfs.length === 0 && a.note.current === null && !a.note.pouring, 'a tap off the lane splats: no hold, no pour');
  const b = N('hold to aim, nobody');
  const r = hoseTune.radius * (blastRadiusFor(120) / config.splat.blastRadius);
  ok(b.note.owner === 'hose' && b.note.hit && b.note.pouring && b.note.flightPouring, `an unclaimed hold is the Hose's, and it pours: ${JSON.stringify(b.note)}`);
  ok(Math.abs(b.note.aimed - (1.5 - (inputTune.aimHoldMs + inputTune.aimLagMs) / 1000)) < 0.04 && Math.abs(b.note.held - 1.5) < 0.03, `the hold's clocks: held ${b.note.held} s, aimed ${b.note.aimed} s`);
  ok(b.barfs.length >= 3 && b.barfs.every((x: any) => x.hose && x.pour > 0 && Math.abs(x.r - r) < 0.01), `its blasts are the Hose's: ${b.barfs.length} of ${r.toFixed(1)} m, one pour id ${b.barfs[0]?.pour}`);
  ok(b.barfs.every((x: any) => x.pour === b.barfs[0].pour), 'one pour, one id (a pour raises each building at most one level)');
  // (it pours from the aim's start: aimed s out of a 3 s tank)
  ok(Math.abs(b.note.tank - (1 - b.note.aimed / hoseTune.tank)) < 0.03, `the tank drains as it pours: ${b.note.tank} after ${b.note.aimed} s`);
  ok(!b.note.after.pouring && !b.note.after.flightPouring && b.note.after.refill === hoseTune.refill && b.note.after.current === null, `its lift stops it, and the belly refills in ${hoseTune.refill} s`);
  ok(has('hold to aim, nobody', 'pour@') && has('hold to aim, nobody', 'stop@') && has('hold to aim, nobody', 'geyser@'), 'the stream and its sound open and close');
  const c = N('the Hose: the tank runs dry');
  ok(c.note.dry && !c.note.pouring && c.note.tank === 0 && Math.abs(c.note.seconds - hoseTune.tank) < 0.05 && has('the Hose: the tank runs dry', 'dry@'), `the tank runs dry at ${c.note.seconds} s and sputters`);
  ok(N('the Hose: the tank runs dry').log.filter((x: string) => x.startsWith('pour@')).length === 1, 'and that hold pours no more');
  const d = N('the Hose: after it runs dry').note;
  ok(Math.abs(d.fullAfterMs - hoseTune.refill * 1000) < 40 && d.refill === 0, `empty to full in ${d.fullAfterMs} ms`);
  const e = N('the Hose: let go at 1 s').note;
  ok(Math.abs(e.fullAfterMs - (1 - e.left) * hoseTune.refill * 1000) < 60, `a part tank refills at the same rate: ${JSON.stringify(e)}`);
  const f = N('the Hose: a drag sweeps it').barfs;
  let minGap = Infinity;
  for (let i = 1; i < f.length; i++) minGap = Math.min(minGap, Math.hypot(f[i].x - f[i - 1].x, f[i].z - f[i - 1].z));
  const span = Math.hypot(f[f.length - 1].x - f[0].x, f[f.length - 1].z - f[0].z);
  ok(f.length >= 6 && span > 150, `a drag sweeps it: ${f.length} blasts over ${Math.round(span)} m, at least ${Math.round(minGap)} m apart`);
  const g = N('the Hose: a hold with too little').note;
  ok(g.pours === 0 && g.coughs === 1 && N('the Hose: a hold with too little').barfs.length === 0, 'too little in the tank: a cough, no pour');
  const k = N('the Hose: a hold on the sky').note;
  ok(!k.hit && k.pouring && k.owner === 'hose' && k.coughs === 0 && Math.abs(k.range - hoseTune.reach) < hoseTune.reach * 0.04 && k.rightward && N('the Hose: a hold on the sky').barfs.length >= 1, `a hold on the sky pours at the reach, the way the finger points: ${JSON.stringify(k)}`);
  const k2 = N('the Hose: a hold on the city past').note;
  ok(k2.hit && k2.range > hoseTune.reach && k2.pouring && Math.abs(k2.goal - hoseTune.reach) < hoseTune.reach * 0.04 && Math.abs(k2.bearing) < 0.01 && N('the Hose: a hold on the city past').barfs.length >= 1, `a hold past the reach pours at the reach, toward the finger: ${JSON.stringify(k2)}`);
  const k3 = N('the Hose: from more than the reach up').note;
  ok(k3.pours === 0 && k3.coughs === 1 && k3.tank === 1, `nothing in reach: a cough, the tank kept: ${JSON.stringify(k3)}`);
  const k4 = N('the Hose: paused 3.6 s').note;
  ok(k4.before.streams === 1 && k4.paused.streams === 1 && k4.paused.pouring && !k4.paused.flowing && k4.paused.blasts === k4.before.blasts && Math.abs(k4.paused.tank - k4.before.tank) < 0.01, `paused, the stream waits and the tank with it: ${JSON.stringify(k4.paused)}`);
  ok(k4.back.streams === 1 && k4.back.open && k4.back.flowing && k4.back.blasts > k4.paused.blasts && k4.after.streams === 0 && !k4.after.open, `back in reach, it flows again with its stream, and the lift ends the stream: ${JSON.stringify(k4)}`);
  const l = N('a claimed hold: life takes it');
  ok(l.note.pours === 0 && l.barfs.length === 0 && l.note.owner === 'lock' && l.note.seen.join() === `start ${AX},${AY},move,end false`, `a claimed hold: the claimer has it, and nothing pours: ${JSON.stringify(l.note)}`);
  ok(N('a claimed hold: one that says no').note.pours === 1, 'a handler that says no leaves it to the Hose');
  const m = N('a claimed hold: a watcher');
  ok(m.note.seen[0] === 'claim true' && m.note.seen.includes('end false') && !m.note.pouring && m.note.owner === 'plane' && has('a claimed hold: a watcher', 'stop@'), `claimed mid-pour, the Hose stops: ${JSON.stringify(m.note)}`);
  ok(m.note.tank > 0.6, 'and its tank is kept');
  ok(N('a claimed tap').log.includes('tap taken'), 'a lock can take the next tap');
  const lk = N('a claimed hold: a lock takes it mid-pour').note;
  ok(lk.seen[0] === 'claim true' && lk.seen.includes('end false') && lk.tank > 0.12 && lk.tank < 0.99 && lk.fired && lk.barf && has('a claimed hold: a lock takes it mid-pour', 'breath@') && !has('a claimed hold: a lock takes it mid-pour', 'cough@'), `a lock that took a pour fires from what was left: ${JSON.stringify(lk)}`);
  const hb = N('a claimed hold: one handed back').note;
  ok(hb.back && hb.pours === 0 && hb.coughs === 1, `handed back to the Hose with 5 %: a cough, no pour: ${JSON.stringify(hb)}`);
  const th = N('a handler that throws').note;
  ok(th.pouring && th.owner === 'hose' && th.blasts >= 2 && th.told === 1 && th.errors >= 10 && !th.after && has('a handler that throws', 'tap@'), `a handler that throws is told once, and the Hose and the frame go on: ${JSON.stringify(th)}`);
  const wa = N('a watcher that never').note;
  ok(wa.seen.join() === 'move,end hose false', `a watcher hears the end, with whose it was: ${JSON.stringify(wa)}`);
  const cap = N('homing: the player shots').note;
  ok(cap.fired === 4 && cap.refused === 1 && cap.coughs === 1, `four of the player's shots at once, the fifth coughs: ${JSON.stringify(cap)}`);
  const q = N('a hold cancelled');
  ok(has('a hold cancelled', 'aimEnd(cancelled)') && !q.note.pouring && q.note.current === null, 'a cancelled hold stops the Hose');
  const s1 = N('homing: a shot at a boat').note;
  ok(s1.fired && s1.hit && s1.tank, `a homing shot leads a crossing boat and hits it, out of the belly: ${JSON.stringify(s1)}`);
  ok(has('homing: a shot at a boat', 'breath@'), 'the bus breathes it, as a tap');
  const s2 = N('homing: a hard break in the white').note;
  ok(s2.fired && !s2.hit && s2.why === 'dodged' && s2.white > 0, `a break in the white dodges it: ${JSON.stringify(s2)}`);
  const s3 = N('homing: the same break before').note;
  ok(s3.hit && !s3.why, 'too early fails: a break before the white is followed');
  const s4 = N('homing: a plane 12 km').note;
  ok(s4.hitAtMs > 0 && s4.hitAtMs < 4000, `a plane 12 km out, hit at ${s4.hitAtMs} ms`);
  const s5 = N('homing: under 12 %').note;
  ok(!s5.mine && s5.theirs && has('homing: under 12 %', 'cough@') && has('homing: under 12 %', 'whistle@'), `no belly, no shot; a captain's needs none, and whistles: ${JSON.stringify(s5)}`);
  ok(N('homing: a target that goes').note.why === 'lost', 'a target that goes: lost');
}
// the first run's hint: HOLD TO AIM in it, once; a save that saw the hint before gets the line alone, once
{
  const run = (taught: number) => { const c = new Coach(taught, false, true); let hint = 0, aim = 0; for (let i = 0; i < 1800; i++) { c.frame(1 / 60, { glinting: false, openingOver: true, splats: 0, thumb: false, stillPress: 0, charged: false }); if (c.hintDue) hint++; if (c.aimHintDue) aim++; } return { hint, aim, taught: c.taught }; };
  const fresh = run(0), old = run(TAUGHT.thumbs), both = run(TAUGHT.thumbs | TAUGHT.aim);
  ok(fresh.hint === 1 && fresh.aim === 0 && (fresh.taught & TAUGHT.aim) !== 0, `a first run: the whole hint once, HOLD TO AIM in it: ${JSON.stringify(fresh)}`);
  ok(old.hint === 0 && old.aim === 1 && run(old.taught).aim === 0, `a save that had the hint: HOLD TO AIM alone, once: ${JSON.stringify(old)}`);
  ok(both.hint === 0 && both.aim === 0, 'a save that had both: nothing');
}

for (const r of rows) console.log(`${r.name.padEnd(86)} | ${r.log.join(', ') || '-'}${r.barfs ? ` | ${r.barfs} blasts` : ''}`);
const OUT = process.env.SB_OUT ?? 'shots/controls/sim';
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/holds.json`, JSON.stringify({ inputTune, hoseTune, rows: notes }, null, 1));
console.log(fails.length ? `FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `hold checks: all ${checks} passed (${rows.length} rows)`);
process.exit(fails.length ? 1 : 0);
