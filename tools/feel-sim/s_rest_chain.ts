// The resting thumb through the whole chain: the REAL Input (../controls-sim/fakedom) wired to the REAL Flight, Aimer, Comet and Lob as main.ts wires them
// (onPress -> aimer.press(input.presses), onUnpress -> aimer.unpress(n), onTap -> aimer.refresh(flight) then fire, tapSplat's order), frames in main.ts's
// order (input.update, the flight's steps, aimer.update with state.thumb), touches between frames on the fake clock. s_lob's rest cases model Input's
// calls and s_rest never runs the Aimer: each passed with half the fix taken out. This one sees Input, the Aimer and the Lob together.
// Every case: the Western Addition at Cruise on the floor (s_lob's rest-a), a real thumb on the lane pulls the whole stick for 2 s and lifts at L; times
// below are s after L. R: a thumb on the lane (196, 700); O: a finger in the look zone (70, 330); Q: one resting in the look zone (330, 300).
//   node tools/feel-sim/run.mjs s_rest_chain.ts [--only=<substring>[,<substring>]] [--fps=60,30]
// Two kinds of check, a line each per fps, exit 1 on any failure:
// - want: what the tap throws by Lob.ts's rule (the body latched at the lift for config.lob.latch, 0.8 s; a tap's finger landing inside it runs it on;
//   with no finger left down that ran it on, the body as it is, the bus level by then).
// - twin: a case with a finger resting (R on the lane, Q in the look zone) against the same touches with that finger never down: the rest changes
//   nothing, the tap throws a Lob exactly when its twin's does (Input.answer: given back, the latch is as if the rest never landed). A tap landing
//   within a frame of the latch's end can go either way by the frame rate; the twin is the rule there, not a time.
import { newCity, pump, ll, makeGame, config, THREE, CameraRig } from './lib';
import { TurboDrive } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
import { lensFov } from '@src/render/PixelPipeline';
import { installDom, Target, clock, ptr, newId, runTimers } from '../controls-sim/fakedom';

const args = process.argv.slice(2);
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7) ?? '';
const FPS = (args.find((a) => a.startsWith('--fps='))?.slice(6) ?? '60,30').split(',').map(Number);
const city = await newCity();
installDom();
const { Input, inputTune } = await import('@src/game/Input');
const DEG = Math.PI / 180, SW = 393, SH = 852;
const r1 = (x: number) => Math.round(x * 10) / 10;

type Ev = { t: number; k: 'down' | 'up' | 'move' | 'cancel'; who: 'R' | 'O' | 'Q'; dy?: number };
interface Case { key: string; want: 'lob' | 'none' | 'twin'; twin?: 'R' | 'Q'; why: string; evs: Ev[] }
const R = { x: 196, y: 700 }, O = { x: 70, y: 330 }, Q = { x: 330, y: 300 };
const CASES: Case[] = [
  // (the baseline: the other finger's tap inside the lift's latch, nobody down: a Lob)
  { key: 'pending/ctl', want: 'lob', why: 'the tap lifts 0.65 s after the lift, nobody else down', evs: [{ t: 0.55, k: 'down', who: 'O' }, { t: 0.65, k: 'up', who: 'O' }] },
  // (the same tap, the thumb back down on the lane 50 ms before it: the tap waits for the rest to commit (Input's gPendingTap) and fires at its commit,
  // still at stillTapMs (0.95 s) or by a move (0.85 s), past the lift's latch. It lifted inside it: still the Lob, as before the fix and as with nobody resting)
  { key: 'pending/still', twin: 'R', want: 'lob', why: 'the tap lifts at 0.65 s, inside the latch; it fires at the rest\'s commit at 0.95 s', evs: [{ t: 0.5, k: 'down', who: 'R' }, { t: 0.55, k: 'down', who: 'O' }, { t: 0.65, k: 'up', who: 'O' }, { t: 2, k: 'up', who: 'R' }] },
  { key: 'pending/move', twin: 'R', want: 'lob', why: 'the tap lifts at 0.70 s, inside the latch; it fires when the rest moves at 0.90 s', evs: [{ t: 0.55, k: 'down', who: 'R' }, { t: 0.6, k: 'down', who: 'O' }, { t: 0.7, k: 'up', who: 'O' }, { t: 0.9, k: 'move', who: 'R', dy: 30 }, { t: 2, k: 'up', who: 'R' }] },
  // (two fingers landing together inside the latch, 0.70 and 0.75 s, one tap: the Lob, whichever lifts last. a: the look finger last while the lane's is
  // past tapMs (answer() at its lift gives the lane's landing back, the look's own landing ran the latch on); b: the lane's first (answer() at the last lift))
  { key: 'order/a', want: 'lob', why: 'two fingers down at 0.70/0.75 s, the look\'s up at 0.95 s, the lane\'s at 1.0 s', evs: [{ t: 0.7, k: 'down', who: 'R' }, { t: 0.75, k: 'down', who: 'O' }, { t: 0.95, k: 'up', who: 'O' }, { t: 1.0, k: 'up', who: 'R' }] },
  { key: 'order/b', want: 'lob', why: 'two fingers down at 0.70/0.75 s, the lane\'s up at 0.90 s, the look\'s at 0.95 s', evs: [{ t: 0.7, k: 'down', who: 'R' }, { t: 0.75, k: 'down', who: 'O' }, { t: 0.9, k: 'up', who: 'R' }, { t: 0.95, k: 'up', who: 'O' }] },
  // (the hole: the rest at 0.5 s, the tap at 0.85-0.92 s answered at once, its landing a frame or two past the lift's latch. Before the fix it threw the
  // lift's body with the bus level; now what its twin throws: a plain splat at 60 fps, the Lob at 30, where the landing still finds the latch)
  { key: 'hole/rest', twin: 'R', want: 'twin', why: 'the rest down at 0.5 s, the tap 0.85-0.92 s', evs: [{ t: 0.5, k: 'down', who: 'R' }, { t: 0.85, k: 'down', who: 'O' }, { t: 0.92, k: 'up', who: 'O' }, { t: 2, k: 'up', who: 'R' }] },
  // (the pending form: the tap lands at the latch's end, lifts before the rest is past tapMs, and fires at its commit: what its twin throws)
  { key: 'hole/pending-late', twin: 'R', want: 'twin', why: 'the rest down at 0.70 s, the tap 0.80-0.88 s, fired at the commit at 1.15 s', evs: [{ t: 0.7, k: 'down', who: 'R' }, { t: 0.8, k: 'down', who: 'O' }, { t: 0.88, k: 'up', who: 'O' }, { t: 2, k: 'up', who: 'R' }] },
  // (the rest's touch cancelled (pointercancel: iOS took it) before it commits, then the tap: its landing ran the latch on, and is given back)
  { key: 'hole/cancel', twin: 'R', want: 'none', why: 'the rest down at 0.5 s, cancelled at 0.7 s, the tap 0.90-0.97 s', evs: [{ t: 0.5, k: 'down', who: 'R' }, { t: 0.7, k: 'cancel', who: 'R' }, { t: 0.9, k: 'down', who: 'O' }, { t: 0.97, k: 'up', who: 'O' }] },
  { key: 'hole/cancel-ctl', want: 'none', why: 'the same tap 0.90-0.97 s, no rest', evs: [{ t: 0.9, k: 'down', who: 'O' }, { t: 0.97, k: 'up', who: 'O' }] },
  // (a finger resting still in the look zone from 0.5 s, the tap on the lane 0.90-0.97 s (the flying thumb's own quick tap: onTap, no answer()): the look's
  // landing ran the latch on, the tap's landing ran it on again; the look, no longer a tap, gives its press back before the tap fires)
  { key: 'hole/look-rest', twin: 'Q', want: 'none', why: 'a finger still in the look zone from 0.5 s, the tap on the lane 0.90-0.97 s', evs: [{ t: 0.5, k: 'down', who: 'Q' }, { t: 0.9, k: 'down', who: 'R' }, { t: 0.97, k: 'up', who: 'R' }, { t: 2, k: 'up', who: 'Q' }] },
  { key: 'hole/look-rest-ctl', want: 'none', why: 'the same tap on the lane, nothing in the look zone', evs: [{ t: 0.9, k: 'down', who: 'R' }, { t: 0.97, k: 'up', who: 'R' }] },
  // (what the fix must keep: the rest down at 0.3 s, the other thumb's tap 0.55-0.60 s answered at once, inside the latch: the Lob)
  { key: 'keep/rest-early', twin: 'R', want: 'lob', why: 'the rest down at 0.3 s, the tap 0.55-0.60 s', evs: [{ t: 0.3, k: 'down', who: 'R' }, { t: 0.55, k: 'down', who: 'O' }, { t: 0.6, k: 'up', who: 'O' }, { t: 2, k: 'up', who: 'R' }] },
  // (one thumb: the lift, the same thumb's tap at 0.5-0.6 s: the Lob)
  { key: 'keep/one', want: 'lob', why: 'the same thumb taps 0.5-0.6 s', evs: [{ t: 0.5, k: 'down', who: 'R' }, { t: 0.6, k: 'up', who: 'R' }] },
];

async function run(c: Case, fps: number) {
  const dt = 1 / fps, step = 1000 / fps;
  const P = { lat: 37.7763, lon: -122.4352, hdg: 88 };
  const [px, pz] = ll(P.lat, P.lon);
  const fx = Math.sin(P.hdg * DEG), fz = -Math.cos(P.hdg * DEG);
  const drive = new TurboDrive([-1e7, -1e7, 1e7, 1e7]);
  const g = makeGame(city, drive);
  const f = g.flight;
  city.paint.resetAll();
  const v0 = config.flight.cruiseSpeed, lead = 3, hold = 2;
  const back = v0 * (lead + hold);
  f.x = px - fx * back;
  f.z = pz - fz * back;
  f.heading = Math.atan2(fx, -fz);
  f.glideSpeed = 0;
  f.speed = v0;
  f.fullness = 1;
  await pump(city, f.x, f.z);
  const g0 = city.groundAt(f.x, f.z);
  f.y = city.obstacleAt(f.x, f.z) + 9;
  await pump(city, f.x, f.z, Math.max(0, f.y - g0), fx, fz);
  const rig = new CameraRig(), lens = new TurboLens(), cam = new THREE.PerspectiveCamera(50, SW / SH, 1, 60000), focus = new THREE.Vector3();
  g.aimer.comet!.lens = cam;
  g.aimer.lob!.lens = cam;
  // ---- the real Input, wired as main.ts wires it
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode('touch');
  input.busZone = { x: 196, y: 511, r: inputTune.laneHalf * 393, open: inputTune.laneOpen * 852 };
  const log: string[] = [];
  let L = -1;
  const rel = () => (L < 0 ? -1 : Math.round(clock.ms - L) / 1000);
  const taps: Array<{ at: number; lob: boolean; angle: number; body: number; ring: boolean; given: boolean }> = [];
  let givenSinceFrame = false;
  input.onPress = () => {
    log.push(`press ${input.presses} at ${rel()}`);
    g.aimer.press(input.presses);
  };
  input.onUnpress = (n) => {
    log.push(`unpress ${n} at ${rel()}`);
    givenSinceFrame = true;
    g.aimer.unpress(n);
  };
  input.onTap = () => {
    // (what the screen showed: the last frame's plan, then main.ts's tapSplat)
    const ring = g.aimer.lobPlan !== null;
    g.aimer.refresh(f);
    const r = g.tap();
    const lob = r.shot.comet?.kind === 'lob';
    taps.push({ at: rel(), lob, angle: lob ? r1(((r.shot.comet as any).angle ?? 0) / DEG) : 0, body: r1(f.pitch / DEG), ring, given: givenSinceFrame });
    log.push(`tap at ${rel()} ${lob ? 'lob' : 'splat'}`);
  };
  let k = 0, next = clock.ms + step;
  const frame = async () => {
    clock.ms = next;
    next += step;
    runTimers();
    if (k++ % 10 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
    input.update(dt);
    const st = input.state;
    givenSinceFrame = false;
    g.frame(dt, { sx: st.stretch.x, sy: st.stretch.y, dragging: st.dragging });
    lens.update(dt, drive, rig, f);
    rig.zone = 0;
    rig.update(cam, focus, f, dt);
    const lf = lensFov(SW, SH, rig.hfov);
    cam.fov = lf.fov;
    cam.aspect = lf.aspect;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  };
  /** frames up to clock time ms, then the clock at ms */
  const until = async (ms: number) => {
    while (next <= ms) await frame();
    clock.ms = ms;
    runTimers();
  };
  for (let j = 0; j < Math.round(lead / dt); j++) await frame();
  // ---- the pull: a real thumb on the lane, dragged down 140 px over three frames, held 2 s, lifted at L (5 ms after a frame)
  const ids = { R: newId(), O: newId(), Q: newId(), P: newId() };
  const P0 = { x: 196, y: 600 };
  el.dispatch('pointerdown', ptr('pointerdown', ids.P, P0.x, P0.y, true));
  for (const dy of [40, 90, 140]) {
    await until(next + 2);
    el.dispatch('pointermove', ptr('pointermove', ids.P, P0.x, P0.y + dy, true));
  }
  const pullEnd = clock.ms + hold * 1000;
  await until(pullEnd);
  const sy = input.state.stretch.y;
  await until(next + 5);
  const bodyLift = r1(f.pitch / DEG);
  L = clock.ms;
  el.dispatch('pointerup', ptr('pointerup', ids.P, P0.x, P0.y + 140, true));
  // ---- the case's touches
  const at = { R: { ...R }, O: { ...O }, Q: { ...Q } };
  const evs = [...c.evs].sort((a, b) => a.t - b.t);
  const down = new Set<string>();
  for (const e of evs) {
    await until(L + e.t * 1000);
    const p = at[e.who], id = ids[e.who];
    if (e.k === 'move') {
      p.y += e.dy ?? 0;
      el.dispatch('pointermove', ptr('pointermove', id, p.x, p.y, down.size === 1));
    } else if (e.k === 'down') {
      el.dispatch('pointerdown', ptr('pointerdown', id, p.x, p.y, down.size === 0));
      down.add(e.who);
    } else {
      el.dispatch(e.k === 'cancel' ? 'pointercancel' : 'pointerup', ptr(e.k === 'cancel' ? 'pointercancel' : 'pointerup', id, p.x, p.y, down.size === 1));
      down.delete(e.who);
    }
  }
  await until(clock.ms + 300);
  input.dispose();
  return { taps, bodyLift, sy: r1(sy), log };
}

let bad = 0, n = 0;
const say = (t: { lob: boolean; angle: number } | undefined) => (!t ? 'no tap' : t.lob ? `lob ${t.angle}` : 'splat');
for (const c of CASES) {
  if (ONLY && !ONLY.split(',').some((o) => c.key.includes(o))) continue;
  for (const fps of FPS) {
    const r = await run(c, fps);
    const t = r.taps[0];
    const facts = `tap at ${t ? t.at.toFixed(3) : '-'} s, given back first ${t ? t.given : '-'}, ring the frame before ${t ? t.ring : '-'}, body ${r.bodyLift} at the lift ${t ? t.body : '-'} at the tap`;
    if (c.want !== 'twin') {
      const ok = r.taps.length === 1 && (c.want === 'lob' ? t.lob : !t.lob);
      n++;
      if (!ok) bad++;
      console.log(`${ok ? 'pass' : 'FAIL'}  ${`${c.key}@${fps}`.padEnd(26)} want ${c.want.padEnd(4)} got ${say(t).padEnd(9)} ${facts}; ${c.why} [${r.log.join('; ')}]`);
    }
    if (c.twin) {
      const w = await run({ ...c, evs: c.evs.filter((e) => e.who !== c.twin) }, fps);
      const tw = w.taps[0];
      const ok = r.taps.length === 1 && w.taps.length === 1 && t.lob === tw.lob;
      n++;
      if (!ok) bad++;
      console.log(`${ok ? 'pass' : 'FAIL'}  ${`${c.key}@${fps}`.padEnd(26)} twin with the rest ${say(t).padEnd(9)} without ${say(tw).padEnd(9)} ${facts}, the twin's at ${tw ? tw.at.toFixed(3) : '-'} s`);
    }
  }
}
console.log(bad ? `rest chain: FAILED ${bad} of ${n}` : `rest chain: all ${n} checks passed`);
process.exit(bad ? 1 : 0);
