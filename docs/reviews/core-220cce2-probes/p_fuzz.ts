// The resting thumb through the whole chain: the REAL Input (../controls-sim/fakedom) wired to the REAL Flight, Aimer, Comet and Lob as main.ts wires them
// (onPress -> aimer.press(input.presses), onUnpress -> aimer.unpress(n), onRepress -> aimer.repress(n), onTap -> aimer.refresh(flight) then fire, tapSplat's order), frames in main.ts's
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
//   within a frame of the latch's end can go either way by the frame rate; the twin is the rule there, not a time. second: a case's second tap against
//   the same touches with that finger never down. Hold to aim is Input's default (on, as ?life and ?hose have it) unless a case says aim: false (the
//   plain page, main.ts's aimOn).
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

type Ev = { t: number; k: 'down' | 'up' | 'move' | 'cancel' | 'blur' | 'keydown' | 'keyup'; who: 'R' | 'O' | 'Q' | 'K'; dy?: number };
interface Case { key: string; want: 'lob' | 'none' | 'twin'; twin?: 'R' | 'Q'; second?: 'R' | 'O' | 'Q'; last?: boolean; eatBefore?: number; aim?: boolean; why: string; evs: Ev[] }
const R = { x: 196, y: 700 }, O = { x: 70, y: 330 }, Q = { x: 330, y: 300 };
// (the reviewer's fuzz: a finger F down after the lift (still, moving, lifted late or cancelled), another finger's tap (plain or slid); F's twin)
let seed = +(args.find((a) => a.startsWith('--seed='))?.slice(7) ?? 1);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const N = +(args.find((a) => a.startsWith('--n='))?.slice(4) ?? 200);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const CASES: Case[] = [];
for (let i = 0; i < N; i++) {
  const F = rnd() < 0.6 ? 'Q' : 'R';
  const T = F === 'Q' ? (rnd() < 0.7 ? 'R' : 'O') : 'O';
  const t1 = r3(0.05 + rnd() * 0.95);
  const how = rnd();
  const evs: Ev[] = [{ t: t1, k: 'down', who: F }];
  let tag = 'still';
  let end = 2.2;
  if (how < 0.2) { evs.push({ t: r3(t1 + 0.03 + rnd() * 0.1), k: 'move', who: F, dy: 40 }); tag = 'moved'; }
  else if (how < 0.35) { end = r3(t1 + 0.5 + rnd() * 0.5); tag = 'lifted'; }
  else if (how < 0.45) { end = r3(t1 + 0.1 + rnd() * 0.5); tag = 'cancel'; }
  evs.push({ t: end, k: tag === 'cancel' ? 'cancel' : 'up', who: F });
  const t2 = r3(Math.max(t1 + 0.02, 0.3 + rnd() * 1.3));
  const d = r3(0.04 + rnd() * 0.08);
  const slid = rnd() < 0.3;
  evs.push({ t: t2, k: 'down', who: T });
  if (slid) evs.push({ t: r3(t2 + 0.02), k: 'move', who: T, dy: 20 });
  evs.push({ t: r3(t2 + d), k: 'up', who: T });
  CASES.push({ key: `f${i}/${F}-${tag}@${t1}${tag === 'still' ? '' : `-${end}`}/${T}${slid ? '-slid' : ''}@${t2}+${d}`, aim: rnd() < 0.5 ? false : undefined, twin: F as 'R' | 'Q', want: 'twin', why: '', evs });
}

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
  if (c.aim !== undefined) input.aimOn = c.aim;
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
  input.onRepress = (n) => {
    log.push(`repress ${n} at ${rel()}`);
    g.aimer.repress(n);
  };
  input.onTap = () => {
    // (what the screen showed: the last frame's plan, then main.ts's tapSplat)
    const ring = g.aimer.lobPlan !== null;
    if (c.eatBefore !== undefined && rel() < c.eatBefore) {
      taps.push({ at: rel(), lob: false, angle: 0, body: r1(f.pitch / DEG), ring, given: givenSinceFrame });
      log.push(`tap at ${rel()} taken (no breath)`);
      return;
    }
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
    if (e.k === 'blur') {
      (globalThis as any).window.dispatch('blur', {});
      down.clear();
      continue;
    }
    if (e.k === 'keydown' || e.k === 'keyup') {
      (globalThis as any).window.dispatch(e.k, { code: 'Space', repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: (globalThis as any).document.body, timeStamp: clock.ms, preventDefault() {} });
      continue;
    }
    const p = at[e.who as 'R' | 'O' | 'Q'], id = ids[e.who as 'R' | 'O' | 'Q'];
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
  for (const fps of FPS) {
    const r = await run(c, fps);
    const w = await run({ ...c, evs: c.evs.filter((e) => e.who !== c.twin) }, fps);
    const t = r.taps[r.taps.length - 1], tw = w.taps[w.taps.length - 1];
    n++;
    if (r.taps.length !== w.taps.length || (t && tw && t.lob !== tw.lob)) {
      bad++;
      console.log(`DIFF ${c.key}@${fps} aim ${c.aim} with F ${r.taps.length} tap(s) ${say(t)} (ring ${t?.ring}, body ${t?.body}) without ${w.taps.length} ${say(tw)} [${r.log.slice(2).join('; ')}]`);
    }
  }
}
console.log(`fuzz: ${bad} of ${n} differ from their twin`);
