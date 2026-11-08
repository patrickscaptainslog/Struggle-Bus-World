// Hold to aim, the hook and the Hose (docs/specs/shots/SHOTS.md, HOOKS.md) through the REAL Input, Flight, Holds and Hose, offline: synthetic pointers on a controlled
// clock, one frame every 16.7 ms like the game loop, and a flat city at sea level under a camera 300 m up. The Splatter, the particles and the sound are stand-ins that
// write down what they were asked. Writes shots/controls/sim/holds.json (SB_OUT moves it) and a table on stdout.
// --late (the Lob's check, 1): only the late lift, a still finger whose lift reaches the page after its aim began, its own time 60 ms in: with the Lob's ring up
// (input.lobUp, as main.ts sets it) it is a tap and the Hose gives back what it poured; without it, as the base had it, its aim ends and pours. A real hold
// with the ring up, and a lost touch, keep what they poured. Writes holds-late.json; exit 0 only when every check passes.
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

function harness(bomb?: (dt: number) => void, step = 16.7) {
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
  input.onAimEnd = (c, late) => { log.push(`aimEnd${c ? '(cancelled)' : ''}@${at()}`); holds.end(c, late); };
  input.onTap = () => { log.push(`tap@${at()}`); if (holds.tap()) log.push('tap taken'); };
  let next = clock.ms + step;
  let maxDrain = 0;
  let alt = 120;
  const frame = () => {
    const dt = step / 1000;
    // (the Bomb's rows: its update before input.update, and a charge on the bus making a hold off the lane cough, as main.ts)
    bomb?.(dt);
    input.update(dt);
    flight.step(dt, { sx: input.state.stretch.x, sy: input.state.stretch.y, dragging: input.state.dragging }, FLAT as any);
    Object.assign(flight, { x: 0, y: alt, z: 0 });
    const was = flight.fullness;
    if (bomb) hose.bombing = input.state.bomb.on;
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
    /** a lift whose own time is `ms` (the clock's), reaching the page now: behind slow frames */
    upAt(id: number, x: number, y: number, ms: number) { el.dispatch('pointerup', { ...ptr('pointerup', id, x, y), timeStamp: ms }); },
    cancel(id: number, x: number, y: number) { el.dispatch('pointercancel', ptr('pointercancel', id, x, y)); },
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

if (process.argv.includes('--late')) {
  const out: Record<string, unknown> = {};
  const lf: string[] = [];
  let n = 0;
  const lok = (c: boolean, m: string) => { n++; if (!c) lf.push(m); };
  // (down, held still to 520 ms by the frames' clock, the aim begun at about 434; then the lift: `own` its own time from the landing, or a lost touch)
  const late = (name: string, lobUp: boolean, own: number | 'cancel') => {
    const h = harness();
    h.wait(100);
    h.reset();
    h.input.lobUp = lobUp;
    const id = newId(), t0 = h.at();
    h.down(id, AX, AY);
    h.wait(520);
    const before = h.flight.fullness, aimed = h.input.state.aim.on;
    if (own === 'cancel') h.cancel(id, AX, AY);
    else h.upAt(id, AX, AY, clock.ms - h.at() + t0 + own);
    const after = h.flight.fullness;
    h.wait(300);
    const v = { lobUp, own, aimed, poured: +(1 - before).toFixed(3), tankAfter: +after.toFixed(3), log: [...h.log] };
    out[name] = v;
    console.log(`${name.padEnd(70)} | ${v.log.join(', ')} | tank ${before.toFixed(3)} -> ${after.toFixed(3)}`);
    h.input.dispose();
    return v;
  };
  const tap = (v: { log: string[] }) => v.log.some((s) => s.startsWith('tap@'));
  const cancelled = (v: { log: string[] }) => v.log.some((s) => s.startsWith('aimEnd(cancelled)'));
  const a = late('ring up: a late lift, 60 ms its own time, is a tap, the pour given back', true, 60);
  lok(a.aimed && a.poured > 0 && cancelled(a) && tap(a) && a.tankAfter >= 0.999, `ring up, late lift: aimed, poured, ended cancelled, a tap, the tank back (${JSON.stringify(a)})`);
  const b = late('no ring (the base): a late lift ends its aim and keeps its pour, no tap', false, 60);
  lok(b.aimed && b.poured > 0 && !cancelled(b) && !tap(b) && b.tankAfter <= 1 - b.poured + 1e-3, `no ring, late lift: as the base, its aim ended, no tap, the pour kept (${JSON.stringify(b)})`);
  const c = late('ring up: a real hold, lifted at 520 ms its own time, keeps its pour', true, 520);
  lok(c.aimed && !cancelled(c) && !tap(c) && c.tankAfter < 0.999, `ring up, a real hold: no tap, the pour kept (${JSON.stringify(c)})`);
  const d = late('ring up: a lost touch at 520 ms keeps its pour, no tap', true, 'cancel');
  lok(d.aimed && cancelled(d) && !tap(d) && d.tankAfter < 0.999, `ring up, a lost touch: no tap, the pour kept (${JSON.stringify(d)})`);
  const OUTL = process.env.SB_OUT ?? 'shots/controls/sim';
  mkdirSync(OUTL, { recursive: true });
  writeFileSync(`${OUTL}/holds-late.json`, JSON.stringify(out, null, 1));
  console.log(lf.length ? `LATE FAILED ${lf.length} of ${n}:\n  ${lf.join('\n  ')}` : `late lift checks: all ${n} passed`);
  process.exit(lf.length ? 1 : 0);
}

// --review (the second account's review of fd6d413): the homing shot led from its launch (M80) and the hook's minors, each a row with its own check, the real
// Input, Flight, Holds and Hose as above. Writes holds-review.json and a table on stdout; exit 0 only when every check passes. The rows below are left as they were.
if (process.argv.includes('--review')) {
  const out: Record<string, unknown> = {};
  const rf: string[] = [];
  let n = 0;
  const rok = (c: boolean, m: string) => { n++; if (!c) rf.push(m); };
  const fresh = (fps = 60) => { const h = harness(undefined, 1000 / fps); h.wait(100); h.reset(); return h; };
  const line = (name: string, v: unknown) => { out[name] = v; console.log(`${name.padEnd(100)} | ${JSON.stringify(v)}`); };
  // M80: a target crossing the shot's line at v m/s, d m from the mouth (0, 120, -6), at the bus's height (a boat: on the water, 2 m), on the line at the launch,
  // the caller giving its velocity (HomingOpts.vel). dodge: from 50 ms into the white, 'turn' breaks 40 m up off its line over 250 ms (the hard break row below),
  // 'flick' goes from its speed to Express's 112 m/s over 250 ms along it (a flick up; the flight's lunge isn't built)
  type Cross = { d: number; v: number; speed: number; white: number; turn: number; r: number; boat?: boolean; captain?: boolean; fps?: number; dodge?: 'turn' | 'flick'; secs?: number };
  const cross = (c: Cross) => {
    const fps = c.fps ?? 60, h = fresh(fps);
    const y = c.boat ? 2 : 120, dz = Math.sqrt(c.d * c.d - (120 - y) ** 2);
    let white = -1, hit = false, why = '', miss = Infinity;
    // (u: how far into its dodge, 0 to 1; t0 its start, s after the launch)
    const t0 = () => (white < 0 ? Infinity : (white + 50) / 1000);
    const u = (t: number) => Math.min(1, Math.max(0, (t - t0()) / 0.25));
    const at = (t: number, o: InstanceType<typeof THREE.Vector3>) => {
      const k = u(t);
      if (c.dodge === 'turn') return o.set(c.v * t, y + 40 * k, -6 - dz);
      // (the flick: its distance is the speed's integral, the speed rising evenly over the 250 ms)
      const extra = c.dodge === 'flick' && t > t0() ? (112 - c.v) * (k < 1 ? 0.125 * k * k : 0.125 + (t - t0() - 0.25)) : 0;
      return o.set(c.v * t + extra, y, -6 - dz);
    };
    const velAt = (t: number, o: InstanceType<typeof THREE.Vector3>) => {
      const k = u(t);
      if (c.dodge === 'turn') return o.set(c.v, k > 0 && k < 1 ? 160 : 0, 0);
      return o.set(c.dodge === 'flick' ? c.v + (112 - c.v) * k : c.v, 0, 0);
    };
    const s = h.holds.fire({
      target: (o) => (at(h.at() / 1000, o), true), vel: (o) => { velAt(h.at() / 1000, o); },
      speed: c.speed, turn: c.turn, white: c.white, hitRadius: c.r, ...(c.captain ? { from: new THREE.Vector3(0, 120, -6), belly: false } : {}),
      onWhite: () => (white = h.at()), onHit: () => (hit = true), onMiss: (_a, _s, w) => { why = w; },
    });
    // (its closest pass, the shot's end of each frame against the target then)
    const p = new THREE.Vector3();
    for (let i = 0; i < (c.secs ?? 2.5) * fps && s && !s.done; i++) { h.wait(1000 / fps); if (!s.done) miss = Math.min(miss, s.pos.distanceTo(at(h.at() / 1000, p))); }
    h.wait(600);
    const v = { fired: !!s, hit, why, whiteMs: Math.round(white), inWhite: white >= 0 && white <= 1000 / fps + 1, closest: hit ? 0 : +miss.toFixed(1) };
    h.input.dispose();
    return v;
  };
  const HOOK = { speed: 420, white: 0.7, turn: 2.2, r: 7 }, CAPTAIN = { speed: 380, white: 0.7, turn: 1.8, r: 6, captain: true }, BOAT = { speed: 500, white: 0.7, turn: 2, r: 6, boat: true };
  for (const fps of [60, 30]) {
    const a = cross({ d: 200, v: 30, ...HOOK, fps });
    line(`M80 @${fps}: a lock at 200 m, the target crossing at 30 m/s on its line: inside the white, a hit`, a);
    rok(a.fired && a.inWhite && a.hit, `M80 @${fps}: a lock at 200 m inside its white on a target crossing at 30 m/s holding its line hits (${JSON.stringify(a)})`);
    const b = cross({ d: 200, v: 30, ...HOOK, fps, dodge: 'turn' });
    line(`M80 @${fps}: the same, a hard break in the white: dodged`, b);
    rok(b.fired && b.inWhite && !b.hit && b.why === 'dodged', `M80 @${fps}: a hard break in the white still beats it (${JSON.stringify(b)})`);
    const f = cross({ d: 200, v: 30, ...HOOK, fps, dodge: 'flick' });
    line(`M80 @${fps}: the same, a flick up in the white (30 to 112 m/s): dodged`, f);
    rok(f.fired && f.inWhite && !f.hit && f.why === 'dodged', `M80 @${fps}: a flick up in the white still beats it (${JSON.stringify(f)})`);
    // (the review's table, every cell, each holding its line: a hit)
    const table: Array<[string, number, Omit<Cross, 'd' | 'v' | 'fps'>]> = [['the hook', 0, HOOK], ['the hook', 30, HOOK], ['the hook', 100, HOOK], ["a captain's", 30, CAPTAIN], ['a boat lock', 12, BOAT]];
    for (const [who, v, o] of table) for (const d of [150, 250, 290, 320, 500, 800]) {
      const r = cross({ d, v, ...o, fps });
      line(`M80 @${fps}: the table, ${who} (${o.speed} m/s, white ${o.white}, turn ${o.turn}, r ${o.r}), crossing at ${v} m/s, ${d} m`, r);
      rok(r.fired && r.hit, `M80 @${fps}: the table, ${who} crossing at ${v} m/s from ${d} m, holding its line, hits (${JSON.stringify(r)})`);
    }
    // (the check of the fixes: a plane lock, HOOKS.md's 3,000 m/s, on a plane crossing at 250 m/s, 3 to 12 km, at eight launch phases each (the distance moved on
    // by eighths of a frame of the shot). The hit test is the frame's target against the shot's segment, so the radius must cover a frame of the plane's travel,
    // 250 / 30 = 8.3 m at 30 fps: with 6 m it hit 6, 7 and 6 of 8. 9 m here)
    for (const d of [3000, 6000, 12000]) {
      const rs = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => cross({ d: d + (k / 8) * (3000 / fps), v: 250, speed: 3000, white: 0.45, turn: 1.5, r: 9, fps, secs: d / 3000 + 1 }));
      const r = { hits: rs.filter((x) => x.hit).length, of: rs.length, inWhite: rs.every((x) => x.inWhite), closest: Math.max(...rs.map((x) => x.closest)) };
      line(`M80 @${fps}: a plane lock (3000 m/s, white 0.45, turn 1.5, r 9), a plane crossing at 250 m/s, ${d} m, eight phases`, r);
      rok(r.hits === r.of, `M80 @${fps}: a plane lock from ${d} m on a plane crossing at 250 m/s, holding its line, hits at every phase (${JSON.stringify(r)})`);
    }
  }
  // m81: a target() that throws at the launch refuses the shot, with the cough, nothing spent
  {
    const h = fresh();
    const err = console.error; let told = 0; console.error = () => { told++; };
    const s = h.holds.fire({ target: () => { throw new Error('target'); }, speed: 420, turn: 2.2, white: 0.7 });
    console.error = err;
    const v = { shot: !!s, tank: h.flight.fullness, barfT: h.flight.barfT, errors: h.holds.stats.errors, refused: h.holds.stats.refused, told, log: [...h.log] };
    line('m81: a target() that throws at the launch: no shot, the cough, the belly kept', v);
    rok(!s && v.tank === 1 && v.barfT < 0 && v.errors === 1 && v.refused === 1 && told === 1 && v.log.some((x) => x.startsWith('cough@')) && !v.log.some((x) => x.startsWith('breath@')), `m81: a target() that throws refuses the shot before the belly or the breath (${JSON.stringify(v)})`);
    h.input.dispose();
  }
  // m82: a target never there ends as lost after the beat, not at maxTime
  {
    const h = fresh();
    let why = '', at = -1;
    const s = h.holds.fire({ target: () => false, speed: 500, turn: 2, white: 0.7, onMiss: (_a, _s, w) => { why = w; at = h.at(); } })!;
    h.wait(1000);
    const v = { why, missAtMs: Math.round(at), done: s.done, flown: Math.round(s.pos.distanceTo(new THREE.Vector3(0, 120, -6))) };
    line('m82: a target never there: lost on its first frame, gone after the beat', v);
    rok(why === 'lost' && at > 0 && at < 40 && s.done && v.flown < 0.6 * 500, `m82: a target never seen ends as lost after the beat (${JSON.stringify(v)})`);
    h.input.dispose();
  }
  // n80: the Hose pours; another handler releases it: the Hose is told, and stops
  {
    const h = fresh();
    const id = newId(); h.down(id, AX, AY); h.wait(1000);
    const before = { pouring: h.hose.pouring, owner: h.holds.current!.owner };
    h.holds.release('hose'); h.wait(100);
    const v = { before, after: { pouring: h.hose.pouring, owner: h.holds.current!.owner, flightPouring: h.flight.pouring }, log: [...h.log] };
    h.up(id, AX, AY); h.wait(50);
    line('n80: the Hose pouring, released by another handler: told (lost), it stops', v);
    rok(before.pouring && before.owner === 'hose' && !v.after.pouring && !v.after.flightPouring && v.after.owner === null && v.log.some((x) => x.startsWith('stop@')), `n80: a release tells the owner, and the Hose stops (${JSON.stringify(v)})`);
    h.input.dispose();
  }
  // (M80, a captain's side: holds.busVel is the player's bus's velocity, Flight.velocity's, for a captain's shot's vel)
  {
    const h = fresh();
    Object.assign(h.flight, { heading: 0.6, speed: 50, vy: 4 });
    const v = { busVel: h.holds.busVel(new THREE.Vector3()).toArray(), flight: h.flight.velocity(new THREE.Vector3()).toArray() };
    line("M80: holds.busVel, a captain's shot's vel at the player's bus", v);
    rok(v.busVel.join() === v.flight.join() && Math.hypot(...v.busVel) > 49, `M80: holds.busVel is the bus's velocity (${JSON.stringify(v)})`);
    h.input.dispose();
  }
  // m83: a lock takes a hold mid-pour and its lift fires: the belly then refills as after a tap (config.splat.recharge), not as after the Hose
  {
    const h = fresh();
    let shot: unknown = null, tank = -1;
    h.holds.add({ name: 'ferry', move: (hd) => { if (hd.aimed > 0.6 && hd.owner !== 'ferry') h.holds.claim('ferry'); }, end: (hd, c) => { if (hd.owner !== 'ferry' || c) return; tank = +h.flight.fullness.toFixed(2); shot = h.holds.fire({ target: (o) => (o.set(0, 2, -400), true), speed: 400, turn: 2.5, white: 0.7 }); } }, { watch: true });
    const id = newId(); h.down(id, AX, AY); h.wait(1200); h.up(id, AX, AY);
    const secs = h.flight.rechargeSeconds;
    let empty = -1, full = -1;
    for (let i = 0; i < 600 && full < 0; i++) {
      h.wait(16.7);
      if (empty < 0 && h.flight.barfT < 0 && h.flight.fullness < 0.05) empty = h.at();
      else if (empty >= 0 && h.flight.fullness >= 1) full = h.at();
    }
    const v = { fired: !!shot, tank, secs, emptyToFullMs: Math.round(full - empty), tap: config.splat.recharge, hose: hoseTune.refill };
    line("m83: a lock's shot after a pour: the belly refills in a tap's 1.6 s, not the Hose's 3", v);
    rok(v.fired && tank > 0.12 && tank < 0.99 && secs === 0 && Math.abs(v.emptyToFullMs - config.splat.recharge * 1000) < 40, `m83: a lock's shot after a pour refills as after a tap (${JSON.stringify(v)})`);
    h.input.dispose();
  }
  // m84: a tap while the Hose pours (main.ts asks Hose.tapWhilePouring before anything splats): the cough, nothing splats; once it stops, nothing said
  {
    const h = fresh();
    const id = newId(); h.down(id, AX, AY); h.wait(1000);
    const pouring = { took: h.hose.tapWhilePouring(), log: [...h.log] };
    h.up(id, AX, AY); h.wait(100);
    const coughs = h.log.filter((x) => x.startsWith('cough@')).length;
    const after = { took: h.hose.tapWhilePouring(), coughs: h.log.filter((x) => x.startsWith('cough@')).length };
    const v = { pouring, after };
    line('m84: a tap while the Hose pours: the cough, and no splat; after the pour, nothing', v);
    rok(pouring.took && pouring.log.some((x) => x.startsWith('cough@')) && coughs === 1 && !after.took && after.coughs === 1, `m84: a tap while the Hose pours coughs, and one after doesn't (${JSON.stringify(v)})`);
    h.input.dispose();
  }
  // n82: the real Comet: a shot that doesn't leave puts its side and its held landing back (unshot); and the real Bomb, fizzling on a breath under way at its
  // lift, tells the aimer (unfire), which hands it to the Comet
  {
    const { Comet } = await import('@src/game/Comet');
    const { Bomb } = await import('@src/game/Bomb');
    const comet = new Comet({} as any, {} as any) as any;
    const plan = { target: null, x: 0, y: 0, z: -900, wall: false, drop: 120, travel: 1.2 } as any;
    const side0 = comet.side;
    comet.shotOf(plan);
    const fired = comet.side;
    comet.unshot();
    const back = comet.side;
    comet.shotOf(plan);
    const next = comet.side;
    const h = harness((dt) => bomb.update(dt));
    const said: string[] = [];
    const bomb: InstanceType<typeof Bomb> = new Bomb({
      input: h.input, flight: h.flight, rig: { kick: () => {} } as any, busVel: () => new THREE.Vector3(),
      aimer: { fire: () => (said.push('fire'), { x: 0, z: -120, drop: 120, comet: {} }), unfire: () => said.push('unfire'), aim: { x: 0, z: -120, drop: 120 } } as any,
      audio: { bombCharge: () => {}, bombTier: () => {}, bombStop: (f: boolean) => said.push(f ? 'let go' : 'fizzle'), bombFade: () => {}, bombBeat: () => {}, superMega: () => {} } as any,
      fx: { motes: () => {}, sparks: () => {}, halo: () => {} } as any,
      breathe: () => (said.push('bomb'), 0), busy: () => false,
    });
    bomb.on = true;
    h.input.busBox = { x0: 172, y0: 470, x1: 220, y1: 542 };
    h.wait(100); h.reset();
    const id = newId(); h.down(id, 196, 506); h.wait(800);
    // (a breath under way at the lift: its tryBarf says no)
    h.flight.barfT = 0;
    h.up(id, 196, 506); h.wait(50);
    const v = { side0, fired, back, next, bomb: said, fizzles: bomb.stats.fizzles };
    line("n82: a Comet's shot that doesn't leave keeps its side; a Bomb fizzling on its breath says so to the aimer", v);
    rok(fired === -side0 && back === side0 && next === -side0 && said.join() === 'fire,unfire,fizzle' && v.fizzles === 1, `n82: unshot puts the side back, and a Bomb that fizzles on tryBarf unfires (${JSON.stringify(v)})`);
    h.input.dispose();
  }
  const OUTR = process.env.SB_OUT ?? 'shots/controls/sim';
  mkdirSync(OUTR, { recursive: true });
  writeFileSync(`${OUTR}/holds-review.json`, JSON.stringify(out, null, 1));
  console.log(rf.length ? `REVIEW FAILED ${rf.length} of ${n}:\n  ${rf.join('\n  ')}` : `review checks: all ${n} passed`);
  process.exit(rf.length ? 1 : 0);
}

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
// (the review's "is the hook enough": the player's bus for a captain's aim, and a building hiding a target)
row('the hook: holds.bus is the player bus, holds.inSight says a building hides a target', (h) => {
  const city = (h.holds as any).h.city, was = city.surfaceAt;
  const boat = new THREE.Vector3(0, 2, -800), bus = h.holds.bus(new THREE.Vector3()).toArray();
  const open = h.holds.inSight(boat);
  // (a 200 m wall 400 m ahead, between the camera (300 m up) and the boat: the line passes it at 121 m)
  city.surfaceAt = (_x: number, z: number) => (z < -380 && z > -420 ? 200 : 0);
  const walled = h.holds.inSight(boat), over = h.holds.inSight(new THREE.Vector3(0, 400, -800));
  city.surfaceAt = was;
  return { bus, open, walled, over };
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
  const hk = N('the hook: holds.bus').note;
  ok(hk.bus.join() === '0,120,0' && hk.open && !hk.walled && hk.over, `holds.bus and holds.inSight: ${JSON.stringify(hk)}`);
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

// ---- the Bomb (docs/specs/shots/SHOTS.md, "The modes"), behind &bomb: its rows in a table of their own (holds-bomb.json), so the one above stays byte for byte
// what it was. The real Bomb on the real Input, Flight, Holds and Hose; its breath is written down (main.ts's breatheNow is the page's), landing where the tap's
// shot does, 120 m under the bus. The bus on screen at the lane's (196, 506), its box grown 10 px a side: Input.busBox.
const { Bomb } = await import('@src/game/Bomb');
const BOX = { x0: 172, y0: 470, x1: 220, y1: 542 };
const BX = 196, BY = 506, DROP = 120;
const bombRows: typeof rows = [];
const bombNotes: Record<string, any> = {};
function bombRow(name: string, fn: (h: Hn, b: InstanceType<typeof Bomb>, breaths: any[], fxN: { motes: number; halo: number; sparks: number }) => unknown, comet = false) {
  let bomb: InstanceType<typeof Bomb> | null = null;
  const h = harness((dt) => bomb!.update(dt));
  const breaths: any[] = [];
  const fxN = { motes: 0, halo: 0, sparks: 0 };
  const ms = () => `${Math.round(h.at())}ms`;
  bomb = new Bomb({
    input: h.input, flight: h.flight, rig: { kick: () => {} } as any, busVel: () => new THREE.Vector3(),
    aimer: { fire: () => ({ x: 0, z: -DROP, drop: DROP, comet: comet ? {} : null }), unfire: () => {}, aim: { x: 0, z: -DROP, drop: DROP } } as any,
    audio: { bombCharge: () => h.log.push(`riser@${ms()}`), bombTier: (t: number) => h.log.push(`clunk${t}@${ms()}`), bombStop: (fired: boolean) => h.log.push(`${fired ? 'let go' : 'fizzle'}@${ms()}`), bombFade: () => h.log.push(`fade@${ms()}`), bombBeat: () => {}, superMega: () => {} } as any,
    fx: { motes: (n: number) => (fxN.motes += n), sparks: (n: number) => (fxN.sparks += n), halo: (n: number) => (fxN.halo += n) } as any,
    breathe: (shot, b) => { breaths.push({ ...b, tag: { ...b.tag }, x: shot.x, z: shot.z, at: Math.round(h.at()) }); h.log.push(`bomb@${ms()}`); return 0; },
    busy: () => h.hose.pouring,
  });
  bomb.on = true;
  h.input.busBox = BOX;
  h.wait(100);
  h.reset();
  const note = fn(h, bomb, breaths, fxN);
  bombRows.push({ name, log: [...h.log], barfs: h.barfs.length, note });
  bombNotes[name] = { note, log: [...h.log], breaths };
  h.input.dispose();
}
/** From the lift: the belly's refill once the breath is out (ms, empty to full), and its refill seconds just after the lift. */
const refill = (h: Hn) => {
  const secs = h.flight.rechargeSeconds;
  let empty = -1, full = -1;
  for (let i = 0; i < 600 && full < 0; i++) {
    h.wait(16.7);
    if (empty < 0 && h.flight.barfT < 0 && h.flight.fullness < 0.05) empty = h.at();
    else if (empty >= 0 && h.flight.fullness >= 1) full = h.at();
  }
  return { secs, emptyToFullMs: Math.round(full - empty) };
};
bombRow('bomb: still on the bus 0.7 s from 120 m: Bomb II', (h) => { hold(h, 700, BX, BY); return refill(h); });
bombRow('bomb: still on the bus 1.3 s from 120 m: Bomb III', (h) => { hold(h, 1300, BX, BY); return refill(h); });
bombRow('bomb: where the tap\'s shot is a Comet: no hit-stop', (h) => { hold(h, 1300, BX, BY); h.wait(300); return {}; }, true);
bombRow('bomb: a hold off the lane while it charges coughs, and pours nothing', (h, b) => {
  const one = newId(); h.down(one, BX, BY); h.wait(400);
  // (a second finger down beside the first: not the primary, which would retire the first as lost)
  const two = newId(); h.down(two, AX, AY, false); h.wait(800);
  const mid = { tier: b.tier, pouring: h.hose.pouring, tank: h.flight.fullness };
  h.up(two, AX, AY); h.wait(200); h.up(one, BX, BY); h.wait(300);
  return { mid, pours: h.hose.stats.pours, coughs: h.hose.stats.coughs };
});
// (the look: what it asks of SuperFx a second, charging before II (351-685 ms), at II (685-1,286) and at III, held 3 s)
bombRow('bomb: the look: a fifth of the motes before II, half at II and no halo, at III all, the halo and sparks', (h, _b, _br, fx) => {
  const id = newId(); h.down(id, BX, BY);
  const snap = (ms: number) => { h.wait(ms - h.at()); return { t: h.at(), ...fx }; };
  const w = [snap(420), snap(670), snap(720), snap(1270), snap(1320), snap(2820)];
  h.up(id, BX, BY);
  const rate = (a: typeof w[0], b: typeof w[0]) => ({ motes: Math.round(((b.motes - a.motes) * 1000) / (b.t - a.t)), halo: Math.round(((b.halo - a.halo) * 1000) / (b.t - a.t)), sparks: Math.round(((b.sparks - a.sparks) * 1000) / (b.t - a.t)) });
  return { one: rate(w[0], w[1]), two: rate(w[2], w[3]), three: rate(w[4], w[5]) };
});
bombRow('bomb: let go at II, the Hose pours again once the belly is full', (h) => {
  hold(h, 700, BX, BY); refill(h); h.wait(100);
  const id = newId(); h.down(id, AX, AY); h.wait(1000); const v = { pouring: h.hose.pouring }; h.up(id, AX, AY); return v;
});
// (after the review: a thumb that rests on the bus and then steers, before II and after; a charge lifted as a tap, as a watcher hears it)
const heard = (b: InstanceType<typeof Bomb>, h: Hn) => b.watch({ tier: (t) => h.log.push(`watch tier${t}`), tap: () => h.log.push('watch tap'), cancel: () => h.log.push('watch cancel'), release: () => h.log.push('watch release') });
bombRow('bomb: on the bus 0.5 s, then a 14 px slide: the riser goes quiet, no power-down', (h, b) => { heard(b, h); const id = newId(); h.down(id, BX, BY); h.wait(500); h.slide(id, BX, BY, 14, 0, 50); h.wait(300); h.up(id, BX + 14, BY); return {}; });
bombRow('bomb: at II, then a 30 px slide: the fizzle, its power-down', (h, b) => { heard(b, h); const id = newId(); h.down(id, BX, BY); h.wait(800); h.slide(id, BX, BY, 30, 0, 50); h.wait(300); h.up(id, BX + 30, BY); return {}; });
bombRow('bomb: lifted at 0.5 s: a tap, and a watcher hears it end as one', (h, b) => { heard(b, h); hold(h, 500, BX, BY); h.wait(300); return {}; });
const bf: string[] = [];
let bchecks = 0;
const bok = (c: boolean, m: string) => { bchecks++; if (!c) bf.push(m); };
const BN = (k: string) => bombNotes[Object.keys(bombNotes).find((x) => x.startsWith(k))!];
{
  const near = (a: number, b: number, e = 0.01) => Math.abs(a - b) < e;
  for (const [k, tier] of [['bomb: still on the bus 0.7 s', 2], ['bomb: still on the bus 1.3 s', 3]] as const) {
    const n = BN(k), b = n.breaths[0], B = config.bomb, three = tier === 3;
    const r = blastRadiusFor(DROP) * (three ? B.radius3 : B.radius2);
    bok(n.breaths.length === 1 && !n.log.some((x: string) => x.startsWith('tap@')), `${k}: one Bomb, no tap (${n.log.join(', ')})`);
    bok(near(b.radius, r) && b.jump === (three ? B.jump3 : B.jump2), `${k}: ${three ? 1.8 : 1.4} x the tap's ${blastRadiusFor(DROP).toFixed(1)} m, ${r.toFixed(1)} m, ${three ? 3 : 2} stages (${b.radius.toFixed(1)}, ${b.jump})`);
    bok(b.width === (three ? B.width3 : B.width2) && b.hitStop === (three ? B.hitStop3 : B.hitStop2), `${k}: MEGA's breath, jet x${b.width}, hit-stop ${b.hitStop} frames`);
    bok(b.tag.kind === 'bomb' && b.tag.charge === (three ? 1 : 0.5) && b.tag.id > 0, `${k}: tagged ${JSON.stringify(b.tag)}`);
    const want = (three ? B.recharge3 : B.recharge2) * 1000;
    bok(n.note.secs * 1000 === want && Math.abs(n.note.emptyToFullMs - want) < 40, `${k}: the belly refills in ${want / 1000} s (${n.note.emptyToFullMs} ms empty to full)`);
    bok(n.log.some((x: string) => x.startsWith('riser@')) && n.log.some((x: string) => x.startsWith(`clunk${tier}@`)) && n.log.some((x: string) => x.startsWith('let go@')), `${k}: its riser, its clunk and its let-go`);
  }
  const c = BN('bomb: where the tap');
  bok(c.breaths.length === 1 && c.breaths[0].hitStop === 0 && near(c.breaths[0].radius, blastRadiusFor(DROP) * config.bomb.radius3), `a Bomb on a Comet's shot has no hit-stop: ${JSON.stringify(c.breaths[0])}`);
  const d = BN('bomb: a hold off the lane');
  bok(d.note.mid.tier >= 2 && !d.note.mid.pouring && d.note.mid.tank === 1 && d.note.pours === 0 && d.note.coughs >= 1 && d.log.some((x: string) => x.startsWith('cough@')), `a hold off the lane during a charge coughs and the belly stays: ${JSON.stringify(d.note)}`);
  bok(d.breaths.length === 1 && d.breaths[0].tag.charge === 1 && !d.log.some((x: string) => x.startsWith('fizzle@')), `and the charge goes on to its Bomb III (${d.log.join(', ')})`);
  bok(BN('bomb: let go at II, the Hose').note.pouring, 'after a Bomb, with the belly full again, the Hose pours as before');
  const lk = BN('bomb: the look').note, B = config.bomb, within = (v: number, want: number) => Math.abs(v - want) <= Math.max(3, want * 0.1);
  bok(within(lk.one.motes, B.motes * 0.2) && lk.one.halo === 0 && lk.one.sparks === 0, `charging before II, a fifth of III's motes and nothing else: ${JSON.stringify(lk.one)} a second`);
  bok(within(lk.two.motes, B.motes * 0.5) && lk.two.halo === 0 && lk.two.sparks === 0, `at II, MEGA's floor: half the motes, no halo: ${JSON.stringify(lk.two)} a second`);
  bok(within(lk.three.motes, B.motes) && within(lk.three.halo, B.halo) && within(lk.three.sparks, B.sparks), `at III, MEGA's built look: ${B.motes} motes, ${B.halo} halo and ${B.sparks} sparks a second: ${JSON.stringify(lk.three)}`);
  const q = BN('bomb: on the bus 0.5 s, then a 14 px'), f = BN('bomb: at II, then a 30 px'), tp = BN('bomb: lifted at 0.5 s');
  const has = (n: any, k: string) => n.log.some((x: string) => x.startsWith(k));
  bok(has(q, 'riser@') && has(q, 'fade@') && !has(q, 'fizzle@') && has(q, 'watch cancel') && !q.breaths.length, `steering off the bus before II: the riser fades, no power-down, a watcher hears the cancel (${q.log.join(', ')})`);
  bok(has(f, 'clunk2@') && has(f, 'fizzle@') && !has(f, 'fade@') && !f.breaths.length, `steering off it at II: the fizzle's power-down (${f.log.join(', ')})`);
  bok(has(tp, 'watch tier1') && has(tp, 'watch tap') && !has(tp, 'watch cancel') && !tp.breaths.length, `a charge lifted before II: a watcher hears tier 1 and then the tap (${tp.log.join(', ')})`);
}
// the rows SuperFx draws them in (src/fx/SuperFx.ts, its own data): Rainbow's six by default, and with a faction's spray set (main.ts's bombLook, &bomb) its
// motes and halo in that spray alone and its sparks white-hot, yellow or that spray, never a row of another's
{
  const { SuperFx } = await import('@src/fx/SuperFx');
  const { lookOf } = await import('@src/render/factionLook');
  const { FACTIONS } = await import('@src/game/factions');
  const { HUE_RAMPS, Ramp } = await import('@src/render/palette');
  const drawn = (palette: readonly number[] | null) => {
    const fx = new SuperFx(1200) as any;
    if (palette) fx.palette = palette;
    fx.motes(120, 92, 0.9);
    fx.halo(60, 1.1, 7);
    fx.sparks(240, new THREE.Vector3(), 12);
    const seen: Record<string, Set<number>> = { mote: new Set(), spark: new Set(), halo: new Set() };
    for (let i = 0; i < fx.data.length; i += 16) if (fx.data[i + 1] > 0) seen[fx.data[i + 2] === 0 ? 'mote' : fx.data[i + 2] === 2 ? 'spark' : fx.data[i + 2] === 3 ? 'halo' : 'arc']?.add(fx.data[i + 12]);
    return seen;
  };
  const only = (set: Set<number>, rows: readonly number[]) => [...set].every((r) => rows.includes(r));
  const rb = drawn(null);
  bok(only(rb.mote, HUE_RAMPS) && rb.mote.size === 6 && only(rb.halo, HUE_RAMPS) && only(rb.spark, [Ramp.GLOW_WHITE, Ramp.YELLOW, ...HUE_RAMPS]), 'by default its motes, halo and sparks are Rainbow\'s, as MEGA\'s were');
  for (const f of FACTIONS) {
    const spray = lookOf(f.id).spray, s = drawn(spray);
    bok(only(s.mote, spray) && only(s.halo, spray) && s.mote.size === new Set(spray).size && only(s.spark, [Ramp.GLOW_WHITE, Ramp.YELLOW, ...spray]), `${f.name}: its motes and halo in its spray alone (${[...s.mote].join(', ')}), its sparks white-hot, yellow or its spray`);
  }
}
// the Bomb's hint (Coach's TAUGHT.bomb, 256): HOLD THE BUS STILL / LIFT TO BOMB once, after three taps, the first time a painted building glints with a full
// belly under 300 m; a Bomb let go first teaches it with no hint; and without the link nothing
{
  const run = (taught: number, bomb: boolean, f: { splats: number; bombGlint: boolean; bombed?: boolean }) => {
    const c = new Coach(taught, false, true, bomb);
    let due = 0;
    for (let i = 0; i < 600; i++) { c.frame(1 / 60, { glinting: true, openingOver: true, splats: f.splats, thumb: true, stillPress: 0, charged: false, bombGlint: f.bombGlint, bombed: f.bombed }); if (c.bombHintDue) due++; }
    return { due, taught: c.taught };
  };
  const all = TAUGHT.thumbs | TAUGHT.aim | TAUGHT.tap | TAUGHT.drag;
  const yes = run(all, true, { splats: 3, bombGlint: true });
  bok(TAUGHT.bomb === 256 && yes.due === 1 && (yes.taught & TAUGHT.bomb) !== 0, `after three taps and a glint, the Bomb's hint once: ${JSON.stringify(yes)}`);
  bok(run(all, true, { splats: 2, bombGlint: true }).due === 0 && run(all, true, { splats: 3, bombGlint: false }).due === 0, 'not before three taps, nor without a glint');
  const went = run(all, true, { splats: 3, bombGlint: true, bombed: true });
  bok(went.due === 0 && (went.taught & TAUGHT.bomb) !== 0, `a Bomb let go first teaches it with no hint: ${JSON.stringify(went)}`);
  bok(run(all | TAUGHT.bomb, true, { splats: 3, bombGlint: true }).due === 0 && run(all, false, { splats: 3, bombGlint: true }).due === 0, 'taught before, or without the link: nothing');
}
writeFileSync(`${OUT}/holds-bomb.json`, JSON.stringify({ box: BOX, drop: DROP, rows: bombNotes }, null, 1));
for (const r of bombRows) console.log(`${r.name.padEnd(86)} | ${r.log.join(', ') || '-'}${r.barfs ? ` | ${r.barfs} blasts` : ''}`);
console.log(bf.length ? `BOMB FAILED ${bf.length} of ${bchecks}:\n  ${bf.join('\n  ')}` : `bomb checks: all ${bchecks} passed (${bombRows.length} rows)`);
process.exit(fails.length || bf.length ? 1 : 0);
