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
const CASES: Case[] = [
  // G2: a look in the look zone 0.5-0.6 s after the lift (it moves 40 px: a look), lifted; the tap on the lane 1.20-1.27 s (410222e's own fault)
  { key: 'x/look-lift', twin: 'Q', want: 'none', why: 'a look 0.5-0.6 s, lifted; the tap on the lane 1.20-1.27 s', evs: [{ t: 0.5, k: 'down', who: 'Q' }, { t: 0.55, k: 'move', who: 'Q', dy: 40 }, { t: 0.6, k: 'up', who: 'Q' }, { t: 1.2, k: 'down', who: 'R' }, { t: 1.27, k: 'up', who: 'R' }] },
  // a rest in the look zone 0.5-1.0 s, lifted still (no tap past stillTapMs on the plain page); the tap on the lane 1.10-1.17 s
  { key: 'x/look-rest-lift', aim: false, twin: 'Q', want: 'none', why: 'a still finger in the look zone 0.5-1.0 s, lifted; the tap 1.10-1.17 s', evs: [{ t: 0.5, k: 'down', who: 'Q' }, { t: 1.0, k: 'up', who: 'Q' }, { t: 1.1, k: 'down', who: 'R' }, { t: 1.17, k: 'up', who: 'R' }] },
  // G1a: the thumb back down on the lane at 0.5 s, lifted still 455 ms on, between the frames (past stillTapMs, before the frame that commits it); the tap in the look zone 1.0-1.07 s
  { key: 'x/fly-late-lift', twin: 'R', want: 'none', why: 'the rest on the lane 0.5-0.955 s, never committed; the tap 1.0-1.07 s', evs: [{ t: 0.5, k: 'down', who: 'R' }, { t: 0.955, k: 'up', who: 'R' }, { t: 1.0, k: 'down', who: 'O' }, { t: 1.07, k: 'up', who: 'O' }] },
  // blur: a still finger in the look zone at 0.5 s, the window blurs at 0.6 s (releaseAll), the tap on the lane 0.90-0.97 s
  { key: 'x/blur', aim: false, twin: 'Q', want: 'none', why: 'a finger in the look zone at 0.5 s, blur at 0.6 s; the tap 0.90-0.97 s', evs: [{ t: 0.5, k: 'down', who: 'Q' }, { t: 0.6, k: 'blur', who: 'Q' }, { t: 0.9, k: 'down', who: 'R' }, { t: 0.97, k: 'up', who: 'R' }] },
  // G7: Space's tap beside a finger resting in the look zone
  { key: 'x/space-look', aim: false, twin: 'Q', want: 'twin', why: 'a finger in the look zone from 0.5 s, Space 0.90-0.97 s', evs: [{ t: 0.5, k: 'down', who: 'Q' }, { t: 0.9, k: 'keydown', who: 'K' }, { t: 0.97, k: 'keyup', who: 'K' }, { t: 2, k: 'up', who: 'Q' }] },
  // G6: Space's tap beside a thumb resting on the lane, not yet committed
  { key: 'x/space-lane', twin: 'R', want: 'twin', why: 'the rest on the lane from 0.55 s, Space 0.90-0.97 s', evs: [{ t: 0.55, k: 'down', who: 'R' }, { t: 0.9, k: 'keydown', who: 'K' }, { t: 0.97, k: 'keyup', who: 'K' }, { t: 2, k: 'up', who: 'R' }] },
  // G5: three fingers: the rest on the lane at 0.5 s, a finger in the look zone at 0.55 s, the third's tap 0.85-0.92 s (answer)
  { key: 'x/three', aim: false, twin: 'Q', want: 'twin', why: 'the rest on the lane 0.5 s, a finger in the look zone 0.55 s, the tap 0.85-0.92 s', evs: [{ t: 0.5, k: 'down', who: 'R' }, { t: 0.55, k: 'down', who: 'Q' }, { t: 0.85, k: 'down', who: 'O' }, { t: 0.92, k: 'up', who: 'O' }, { t: 2, k: 'up', who: 'R' }, { t: 2, k: 'up', who: 'Q' }] },
  // P9: given back at the other's tap (no breath), then lifted as no tap: a second tap after it reads as with the finger never down
  { key: 'x/given-then-rest', aim: false, twin: 'Q', last: true, eatBefore: 0.95, want: 'twin', why: 'a finger in the look zone 0.6-1.15 s, a tap on the lane 0.86-0.91 s (no breath), a second 1.2-1.27 s', evs: [{ t: 0.6, k: 'down', who: 'Q' }, { t: 0.86, k: 'down', who: 'R' }, { t: 0.91, k: 'up', who: 'R' }, { t: 1.15, k: 'up', who: 'Q' }, { t: 1.2, k: 'down', who: 'R' }, { t: 1.27, k: 'up', who: 'R' }] },
  // the ring: a finger resting in the look zone from 0.5 s, the tap on the lane 1.15-1.22 s (the look finger 650 ms old: no tap of its own left)
  { key: 'x/ring-look', aim: false, twin: 'Q', want: 'none', why: 'a finger in the look zone from 0.5 s, the tap 1.15-1.22 s', evs: [{ t: 0.5, k: 'down', who: 'Q' }, { t: 1.15, k: 'down', who: 'R' }, { t: 1.22, k: 'up', who: 'R' }, { t: 2, k: 'up', who: 'Q' }] },
  // a rest on the lane from 0.05 s, committed at 0.5 s (steering at neutral); the tap in the look zone 0.70-0.76 s, inside the lift's latch for its twin
  { key: 'x/committed-rest', twin: 'R', want: 'twin', why: 'the rest on the lane from 0.05 s (committed at 0.5 s), the tap 0.70-0.76 s', evs: [{ t: 0.05, k: 'down', who: 'R' }, { t: 0.7, k: 'down', who: 'O' }, { t: 0.76, k: 'up', who: 'O' }, { t: 2, k: 'up', who: 'R' }] },
  // the slid tap: a finger still in the look zone from 0.5 s; the tap on the lane 0.90-0.97 s slides 20 px 20 ms in (a quick tap by quickTapSlopPx, a committed thumb for the frames between)
  { key: 'x/slid-look', aim: false, twin: 'Q', want: 'none', why: 'a finger in the look zone from 0.5 s, a slid tap on the lane 0.90-0.97 s', evs: [{ t: 0.5, k: 'down', who: 'Q' }, { t: 0.9, k: 'down', who: 'R' }, { t: 0.92, k: 'move', who: 'R', dy: 20 }, { t: 0.97, k: 'up', who: 'R' }, { t: 2, k: 'up', who: 'Q' }] },
  { key: 'x/slid-look-aim', twin: 'Q', want: 'none', why: 'the same with hold to aim on (?hose): the finger 400 ms old, short of its aim', evs: [{ t: 0.55, k: 'down', who: 'Q' }, { t: 0.9, k: 'down', who: 'R' }, { t: 0.92, k: 'move', who: 'R', dy: 20 }, { t: 0.97, k: 'up', who: 'R' }, { t: 2, k: 'up', who: 'Q' }] },
  { key: 'x/slid-ctl', want: 'none', why: 'the same slid tap, nobody in the look zone', evs: [{ t: 0.9, k: 'down', who: 'R' }, { t: 0.92, k: 'move', who: 'R', dy: 20 }, { t: 0.97, k: 'up', who: 'R' }] },
  // a finger looking (it moved) from 0.5 s, still down; the slid tap on the lane 1.0-1.07 s
  { key: 'x/slid-looking', aim: false, twin: 'Q', want: 'none', why: 'a look from 0.5 s, still down; a slid tap on the lane 1.0-1.07 s', evs: [{ t: 0.5, k: 'down', who: 'Q' }, { t: 0.6, k: 'move', who: 'Q', dy: 40 }, { t: 1.0, k: 'down', who: 'R' }, { t: 1.02, k: 'move', who: 'R', dy: 20 }, { t: 1.07, k: 'up', who: 'R' }, { t: 2, k: 'up', who: 'Q' }] },
  // a finger still in the look zone from 0.5 s; a flick on the lane 0.9-0.98 s (60 px up), then the thumb's plain tap 1.1-1.17 s
  { key: 'x/flick-look', aim: false, twin: 'Q', want: 'none', why: 'a finger in the look zone from 0.5 s, a flick on the lane 0.90-0.98 s, the tap on the lane 1.10-1.17 s', evs: [{ t: 0.5, k: 'down', who: 'Q' }, { t: 0.9, k: 'down', who: 'R' }, { t: 0.93, k: 'move', who: 'R', dy: -60 }, { t: 0.98, k: 'up', who: 'R' }, { t: 1.1, k: 'down', who: 'O' }, { t: 1.17, k: 'up', who: 'O' }, { t: 2, k: 'up', who: 'Q' }] },
  // the tap that straddles the rest's commit: the thumb back down on the lane at 0.5 s (it commits still at 0.95 s), the other thumb's plain tap 0.90-1.00 s
  { key: 'x/commit-park', twin: 'R', want: 'none', why: 'the rest on the lane from 0.5 s (commits at 0.95 s), the tap in the look zone 0.90-1.00 s', evs: [{ t: 0.5, k: 'down', who: 'R' }, { t: 0.9, k: 'down', who: 'O' }, { t: 1.0, k: 'up', who: 'O' }, { t: 2, k: 'up', who: 'R' }] },
  { key: 'x/commit-park-b', twin: 'R', want: 'none', why: 'the rest on the lane from 0.6 s (commits at 1.05 s), the tap in the look zone 0.98-1.10 s', evs: [{ t: 0.6, k: 'down', who: 'R' }, { t: 0.98, k: 'down', who: 'O' }, { t: 1.1, k: 'up', who: 'O' }, { t: 2, k: 'up', who: 'R' }] },
  { key: 'x/commit-park-ctl', want: 'none', why: 'the same tap 0.90-1.00 s, nobody resting', evs: [{ t: 0.9, k: 'down', who: 'O' }, { t: 1.0, k: 'up', who: 'O' }] },
  // the author's minor 1: Q in the look zone 0.6 s, R's tap 0.86-0.91 s takes no breath, a third finger O lands 0.95 s (stays), Q lifts as a tap at 1.0 s
  { key: 'x/m1', aim: false, eatBefore: 0.95, want: 'lob', why: 'three fingers, the first tap takes no breath; Q\'s own tap at 1.0 s', evs: [{ t: 0.6, k: 'down', who: 'Q' }, { t: 0.86, k: 'down', who: 'R' }, { t: 0.91, k: 'up', who: 'R' }, { t: 0.95, k: 'down', who: 'O' }, { t: 1.0, k: 'up', who: 'Q' }, { t: 2, k: 'up', who: 'O' }] },
  { key: 'x/m1-twin', aim: false, want: 'lob', why: 'the same with R never down', evs: [{ t: 0.6, k: 'down', who: 'Q' }, { t: 0.95, k: 'down', who: 'O' }, { t: 1.0, k: 'up', who: 'Q' }, { t: 2, k: 'up', who: 'O' }] },
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
  if (ONLY && !ONLY.split(',').some((o) => c.key.includes(o))) continue;
  for (const fps of FPS) {
    const r = await run(c, fps);
    const t = r.taps[0];
    const facts = `tap at ${t ? t.at.toFixed(3) : '-'} s, given back first ${t ? t.given : '-'}, ring the frame before ${t ? t.ring : '-'}, body ${r.bodyLift} at the lift ${t ? t.body : '-'} at the tap`;
    if (c.want !== 'twin') {
      const tl = r.taps[r.taps.length - 1];
      const ok = (c.key === 'x/m1' ? r.taps.length === 2 : r.taps.length === 1) && (c.want === 'lob' ? tl.lob : !tl.lob);
      n++;
      if (!ok) bad++;
      console.log(`${ok ? 'pass' : 'FAIL'}  ${`${c.key}@${fps}`.padEnd(26)} want ${c.want.padEnd(4)} got ${say(t).padEnd(9)} ${facts}; ${c.why} [${r.log.join('; ')}]`);
    }
    if (c.twin) {
      const w = await run({ ...c, evs: c.evs.filter((e) => e.who !== c.twin) }, fps);
      const tw = w.taps[0];
      let ok = r.taps.length === (c.second ? 2 : 1) && w.taps.length === 1 && t.lob === tw.lob;
      if (c.last) {
        const a = r.taps[r.taps.length - 1], b2 = w.taps[w.taps.length - 1];
        ok = r.taps.length === w.taps.length && a.lob === b2.lob;
        n++;
        if (!ok) bad++;
        console.log(`${ok ? 'pass' : 'FAIL'}  ${`${c.key}@${fps}`.padEnd(26)} last tap with the rest ${say(a).padEnd(9)} (ring ${a.ring}) without ${say(b2).padEnd(9)} [${r.log.join('; ')}] twin [${w.log.join('; ')}]`);
        continue;
      }
      let more = '';
      if (c.second) {
        const w2 = await run({ ...c, evs: c.evs.filter((e) => e.who !== c.second) }, fps);
        const t2 = r.taps[1], tw2 = w2.taps[0];
        ok &&= w2.taps.length === 1 && !!t2 && t2.lob === tw2.lob;
        more = ` second tap with ${c.second} ${say(t2)}, without ${say(tw2)};`;
      }
      n++;
      if (!ok) bad++;
      console.log(`${ok ? 'pass' : 'FAIL'}  ${`${c.key}@${fps}`.padEnd(26)} twin with the rest ${say(t).padEnd(9)} without ${say(tw).padEnd(9)}${more} ${facts}, the twin's at ${tw ? tw.at.toFixed(3) : '-'} s [${r.log.join('; ')}]`);
    }
  }
}
console.log(bad ? `probe chain: FAILED ${bad} of ${n}` : `probe chain: all ${n} checks passed`);
process.exit(bad ? 1 : 0);
