// The hybrid arbitration, offline: the REAL Input + TiltCore + TiltMix + Flight on a fakedom clock, the phone a scripted
// physical model (phone.ts, 60 Hz deviceorientation), the thumb real pointer events. Spec section 10's numbered cases.
// Every number here is a phone motion assumed by a script: only a real phone proves feel.
import { installDom, Target, clock, ptr, newId } from './fakedom';
const { doc } = installDom();
import * as THREE from 'three';
const { Input, inputTune } = await import('@src/game/Input');
const { TiltMix, mixTune } = await import('@src/game/Hybrid');
const { TiltCore } = await import('@src/game/Tilt');
const { Flight } = await import('@src/game/Flight');
const { config } = await import('@src/config');
const { attitude, w3c } = await import('./phone');

const R = new THREE.Matrix4();
const flat = { obstacleAt: () => 20, groundAt: () => 10 } as any;
const DT = 1 / 60;
const sm = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const seg = (pts: number[][]) => (t: number) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t < pts[i][0]) { const [a, x] = pts[i - 1], [c, y] = pts[i]; return x + (y - x) * sm((t - a) / (c - a)); }
  return pts[pts.length - 1][1];
};
const hold = (x: number) => () => x;

interface Span { down: number; up: number; b?: (t: number) => number; x?: number }
interface Opts { pose: (t: number) => number; thumb?: Span[]; reach?: Span; dur?: number; tilt?: boolean; shake?: (t: number) => number; before?: (w: World) => void; hook?: (t: number, w: World) => void; pitch?: number; hud?: boolean }
interface World { input: any; mix: any; core: any; src: any; f: any; el: Target; setActive(v: boolean): void }
interface Out { t: number[]; ox: number[]; yaw: number[]; heading: number[]; world: World; headingAfter: (t: number) => number; yawAccel: number; maxStep: number }

/** One run: fly 1 s calibrated at pose(-1), then the script. */
function run(o: Opts): Out {
  const el = new Target();
  const input: any = new Input(el as unknown as HTMLElement);
  input.setMode('touch');
  const core: any = new TiltCore();
  let active = o.tilt !== false;
  const src = { core, get active() { return active; }, probing: false, get sx() { return core.sx; }, get sy() { return core.sy; }, update() { core.update(clock.ms / 1000); } };
  const mix: any = new TiltMix(src);
  if (o.tilt !== false) input.mix = mix;
  const f: any = new Flight();
  f.y = 26.5; f.fullness = 0; f.glideSpeed = 0;
  const world: World = { input, mix, core, src, f, el, setActive: (v) => (active = v) };
  const sample = (t: number) => {
    const e = w3c(attitude({ lean: 35, roll: o.pose(t) + (o.shake ? o.shake(t) : 0), pitch: o.pitch ?? 0, yaw: 0, screen: 0 }, R));
    core.feed(e.beta, e.gamma, 0, clock.ms / 1000);
  };
  // calibrate at a level grip: the pose is what the script says relative to this neutral
  const level = (t: number) => {
    const e = w3c(attitude({ lean: 35, roll: 0, pitch: 0, yaw: 0, screen: 0 }, R));
    core.feed(e.beta, e.gamma, 0, t);
  };
  core.calibrate();
  for (let i = 0; i < 60; i++) { clock.ms += DT * 1000; level(clock.ms / 1000); }
  if (o.tilt !== false) input.wakeMix();
  const out: Out = { t: [], ox: [], yaw: [], heading: [], world, headingAfter: () => 0, yawAccel: 0, maxStep: 0 };
  // ease into the script's first pose, gain up
  const t0 = -1.2;
  const dur = o.dur ?? 4;
  const anchorX = 200, anchorY = 500;
  let downId = -1, upAt = 0;
  const px = (s: number) => (s === 0 ? 0 : Math.sign(s) * (config.flight.deadZonePx + Math.abs(s) * config.flight.stretchPx));
  let prevO = 0, y = 0, v = 0;
  o.before?.(world);
  for (let n = 0; ; n++) {
    const t = t0 + n * DT;
    if (t >= dur) break;
    clock.ms += DT * 1000;
    sample(t);
    for (const s of o.thumb ?? []) {
      if (downId < 0 && t >= s.down && t < s.up) {
        downId = newId();
        upAt = s.up;
        el.dispatch('pointerdown', ptr('pointerdown', downId, anchorX, anchorY));
        if (s.x !== undefined) el.dispatch('pointermove', ptr('pointermove', downId, s.x, anchorY));
      }
      if (downId >= 0 && t >= s.up && upAt === s.up) {
        el.dispatch('pointerup', ptr('pointerup', downId, anchorX, anchorY));
        downId = -1;
      } else if (downId >= 0 && t >= s.down && t < s.up && s.b) {
        const b = s.b(t);
        const dx = px(b);
        // (a still thumb commits by time, a moving one past the slop)
        el.dispatch('pointermove', ptr('pointermove', downId, anchorX + dx, anchorY));
      }
    }
    if (o.reach) {
      if (!(world as any).rDown && t >= o.reach.down && t < o.reach.up) {
        (world as any).rDown = true;
        input.hudBlip();
        input.reachDown();
        if (o.hud) input.turboHold(true);
      }
      if ((world as any).rDown && t >= o.reach.up) {
        (world as any).rDown = false;
        if (o.hud) input.turboHold(false);
        input.hudBlip();
        input.reachUp();
      }
    }
    o.hook?.(t, world);
    input.update(DT);
    const st = input.state;
    f.step(DT / 2, { sx: st.stretch.x, sy: st.stretch.y, dragging: st.dragging }, flat);
    f.step(DT / 2, { sx: st.stretch.x, sy: st.stretch.y, dragging: st.dragging }, flat);
    out.t.push(t);
    out.ox.push(st.stretch.x);
    out.yaw.push(f.yawRate);
    out.heading.push(f.heading);
    // the yaw spring's acceleration on this stick (the sim's measure, 2.4 Hz, 0.75, max 1.35)
    const w = 2 * Math.PI * 2.4;
    const acc = w * w * (st.stretch.x * 1.35 - y) - 2 * 0.75 * w * v;
    v += acc * DT; y += v * DT;
    if (t > 0) out.yawAccel = Math.max(out.yawAccel, Math.abs(acc));
    if (t > 0) out.maxStep = Math.max(out.maxStep, Math.abs(st.stretch.x - prevO));
    prevO = st.stretch.x;
  }
  out.headingAfter = (at: number) => {
    const i = out.t.findIndex((x) => x >= at);
    return ((out.heading[out.heading.length - 1] - out.heading[i]) * 180) / Math.PI;
  };
  input.dispose();
  return out;
}

const rows: string[] = [];
const fails: string[] = [];
const check = (name: string, pass: boolean, val: string) => {
  rows.push(`${pass ? 'ok  ' : 'FAIL'} ${name.padEnd(64)} ${val}`);
  if (!pass) fails.push(`${name}: ${val}`);
};
const f1 = (x: number) => x.toFixed(1);
const f3 = (x: number) => x.toFixed(3);
const thumbRight = (t: number) => Math.max(0, Math.min(1, (t - 1) / 0.25)) * 0.6;

// 1. tilt off: the same stream with and without a (dead) mixer gives bit-equal stretch
{
  const script: Span[] = [{ down: 0.5, up: 1.2, b: (t) => Math.sin(t * 5) * 0.7 }, { down: 2, up: 2.1 }, { down: 2.6, up: 3.6, b: (t) => (t - 2.6) * 0.5 }];
  const a = run({ pose: hold(0), thumb: script, tilt: false });
  const b = run({ pose: hold(0), thumb: script, tilt: false, before: (w) => { w.setActive(false); w.input.mix = w.mix; } });
  let same = a.ox.length === b.ox.length;
  for (let i = 0; i < a.ox.length; i++) if (a.ox[i] !== b.ox[i]) same = false;
  check('1 tilt off identity: bit-equal to the mixer absent', same, `${a.ox.length} frames`);
}
// 2. clutch-in: a thumb lands in a carve, tilt +0.5 equivalent, thumb the other way
{
  const fade = run({ pose: hold(20), thumb: [{ down: 1, up: 2.5, b: () => -0.5 }] });
  const saved = mixTune.fadeOut;
  mixTune.fadeOut = 0.0001;
  const hard = run({ pose: hold(20), thumb: [{ down: 1, up: 2.5, b: () => -0.5 }] });
  mixTune.fadeOut = saved;
  check('2 clutch-in: peak yaw accel at most 50 % of a hard switch', fade.yawAccel <= hard.yawAccel * 0.5, `${f1(fade.yawAccel)} vs ${f1(hard.yawAccel)} rad/s2`);
}
// 2b. a commit during SETTLE reads the held 0
{
  const c = run({ pose: seg([[1, 0], [1.6, 15], [9, 15]]), thumb: [{ down: 1, up: 2.2, b: (t) => 0.4 }, { down: 2.5, up: 3.2, b: () => 0.02 }], dur: 5 });
  let m = 0;
  for (let i = 1; i < c.t.length; i++) if (c.t[i] >= 2.48 && c.t[i] < 2.8) m = Math.max(m, Math.abs(c.ox[i] - c.ox[i - 1]));
  check('2b commit during SETTLE: max per-frame step at most 0.05', m <= 0.05, f3(m));
}
// 3. lift continuity: thumb 0.8 to tilt 0.5 (roll ~ 20 degrees)
{
  const c = run({ pose: hold(21.5), thumb: [{ down: 1, up: 2, b: () => 0.8 }], dur: 3.5 });
  let mn = 9;
  for (let i = 0; i < c.t.length; i++) if (c.t[i] >= 2 && c.t[i] < 3.4) mn = Math.min(mn, c.yaw[i]);
  const tilt = run({ pose: hold(21.5), dur: 3.5 });
  check('3 lift continuity: min yaw after the lift at least 0.6', mn >= 0.6, `${f3(mn)} rad/s, steady ${f3(tilt.yaw[tilt.yaw.length - 1])}`);
}
// 4. a nudge resumes the carve
{
  const c = run({ pose: hold(12), thumb: [{ down: 1, up: 1.4, b: () => 0.45 }], dur: 3.4 });
  const n = run({ pose: hold(12), dur: 3.4 });
  const a = c.headingAfter(1.4), b = n.headingAfter(1.4);
  check('4 nudge resumes: heading within 5 % of no thumb', Math.abs(a - b) <= 0.05 * Math.abs(b), `${f1(a)} vs ${f1(b)} deg`);
}
// 5. body English: the thumb steers, the phone rolls with it, relaxes after the lift
for (const [rel, up] of [[0.1, 2.2], [0.6, 2.2]] as const) {
  const pose = seg([[1, 0], [1.6, 15], [up + rel, 15], [up + rel + 0.5, 0]]);
  const c = run({ pose, thumb: [{ down: 1, up, b: thumbRight }], dur: up + 3 });
  const h = c.headingAfter(up);
  check(`5 body English, relax at ${rel}: heading within +-8`, Math.abs(h) <= 8, `${f1(h)} deg`);
}
// 6. new hold: drifts 15 degrees over a 3 s session and stays there
{
  const c = run({ pose: seg([[1, 0], [3, 15]]), thumb: [{ down: 1, up: 4, b: thumbRight }], dur: 7 });
  const h = c.headingAfter(4);
  check('6 new hold: stick 0 at the settled pose, heading within +-8', Math.abs(h) <= 8 && Math.abs(c.ox[c.ox.length - 1]) < 0.02, `${f1(h)} deg, stick ${f3(c.ox[c.ox.length - 1])}`);
}
// 7. cap: a carve never returns larger than handed over (phone rolled further under the thumb)
{
  const c = run({ pose: seg([[1, 12], [1.3, 16], [9, 16]]), thumb: [{ down: 1, up: 1.4, b: () => 0.1 }], dur: 3.5 });
  const handed = run({ pose: hold(12), dur: 2 }).ox.at(-1)!;
  check('7 cap: the carve returns no larger than it was handed over', c.ox.at(-1)! <= handed + 0.01, `${f3(c.ox.at(-1)!)} vs ${f3(handed)}`);
}
// 8. reach, two-handed: no swing (measured from the lift, as the spec's sim does)
{
  const c = run({ pose: hold(12), reach: { down: 1, up: 1.1 }, dur: 4 });
  const n = run({ pose: hold(12), dur: 4 });
  const a = c.headingAfter(1.1), b = n.headingAfter(1.1);
  check('8 reach two-handed: at least 95 % of ideal heading', a >= 0.95 * b, `${f1(a)} of ${f1(b)} deg`);
}
// 9. reach, one-handed: the phone swings toward the corner and back. By heading alone unguarded wins (it is back on the
// carve sooner: the spec's sim says 48 against 36): what the guard buys is that the bus doesn't turn the wrong way.
{
  const pose = seg([[0.65, 12], [1, -13], [1.1, -13], [1.6, 12]]);
  const c = run({ pose, reach: { down: 1, up: 1.1 }, dur: 4 });
  const un = run({ pose, dur: 4 });
  const ideal = run({ pose: hold(12), dur: 4 });
  const wrong = (o: Out) => { let m = 0; for (let i = 0; i < o.t.length; i++) if (o.t[i] >= 1 && o.ox[i] < m) m = o.ox[i]; return m; };
  const a = wrong(c), b = wrong(un);
  check('9 reach one-handed: less of a wrong-way stick than unguarded', a > b, `${f3(a)} vs ${f3(b)} unguarded`);
  check('9 reach one-handed: the carve comes back', Math.abs(c.ox.at(-1)! - ideal.ox.at(-1)!) < 0.02, `stick ${f3(c.ox.at(-1)!)} of ${f3(ideal.ox.at(-1)!)}; heading after the press ${f1(c.headingAfter(1))}, unguarded ${f1(un.headingAfter(1))}, ideal ${f1(ideal.headingAfter(1))}`);
}
// 9b. 3 s boost with a 25 degree swing, the hand back over 0.4 s after the lift
{
  const pose = seg([[0.65, 0], [1, -25], [4, -25], [4.4, 0]]);
  const c = run({ pose, reach: { down: 1, up: 4 }, hud: true, dur: 7 });
  const h = c.headingAfter(4);
  check('9b 3 s boost, 25 degree reach: heading after within +-8', Math.abs(h) <= 8, `${f1(h)} deg`);
}
// 9c. 3 s two-handed boost in a carve, the phone levelled after the lift
{
  const c = run({ pose: seg([[4.2, 12], [5, 0]]), reach: { down: 1, up: 4 }, hud: true, dur: 8 });
  const h = c.headingAfter(4);
  check('9c 3 s two-handed boost, levelled after: no counter-carve past -8', h >= -8, `${f1(h)} deg`);
}
// 10. press shake 5 degrees 9 Hz at a 20 degree hold
{
  const shake = (t: number) => (t >= 1 && t < 1.15 ? 5 * Math.sin(2 * Math.PI * 9 * (t - 1)) : 0);
  const c = run({ pose: hold(20), shake, thumb: [{ down: 1, up: 1.1 }], dur: 2 });
  const ref = run({ pose: hold(20), dur: 2 });
  let m = 0;
  for (let i = 0; i < c.t.length; i++) if (c.t[i] >= 1 && c.t[i] < 1.5) m = Math.max(m, Math.abs(c.ox[i] - ref.ox[i]));
  check('10 press shake at a 20 degree hold: stick error at most 0.08', m <= 0.08, f3(m));
}
// 11. toggle off, on, app switch: no step over 0.05 per frame
{
  const c = run({ pose: hold(14), dur: 5, hook: (t, w) => {
    if (Math.abs(t - 1) < DT / 2) w.mix.turnOff();
    if (Math.abs(t - 1.1) < DT / 2) w.mix.cancelOff();
    if (Math.abs(t - 2.5) < DT / 2) w.mix.sleep();
    if (Math.abs(t - 3.5) < DT / 2) w.input.wakeMix();
  } });
  check('11 toggle off / on, app switch: no step over 0.05 a frame', c.maxStep <= 0.05, f3(c.maxStep));
}
// 12. edge rest: a grip leaves tilt live
{
  const c = run({ pose: hold(14), before: (w) => w.el.dispatch('pointerdown', ptr('pointerdown', 77, 6, 500)), dur: 3 });
  const n = run({ pose: hold(14), dur: 3 });
  check('12 edge rest: tilt stays live under a grip', Math.abs(c.ox.at(-1)! - n.ox.at(-1)!) < 0.01 && c.world.mix.phase === 'live', `${f3(c.ox.at(-1)!)} vs ${f3(n.ox.at(-1)!)}`);
}
// 13. sensitivity unchanged after every case
{
  const c = run({ pose: seg([[1, 0], [3, 15]]), thumb: [{ down: 1, up: 4, b: thumbRight }], reach: { down: 5, up: 5.5 }, dur: 7 });
  check('13 sensitivity unchanged', c.world.core.sensitivity === config.tilt.sensitivity, String(c.world.core.sensitivity));
}
// 15. no allocation in feed and update (nothing collected inside a short window: what it allocates stays in the count)
{
  const core: any = new TiltCore();
  core.calibrate();
  const loop = (from: number, n: number) => {
    for (let i = from; i < from + n; i++) {
      const t = i * DT;
      core.feed(55 + Math.sin(i * 0.01), 3 * Math.sin(i * 0.007), 0, t);
      core.update(t);
    }
  };
  loop(0, 400000);
  const w: number[] = [];
  for (let k = 0; k < 9; k++) {
    const before = process.memoryUsage().heapUsed;
    loop(400000 + 20000 * k, 20000);
    w.push(process.memoryUsage().heapUsed - before);
  }
  // (the median of nine windows, once optimized: node --trace-gc shows no scavenge at all in 2M samples on its own)
  const med = w.sort((a, b) => a - b)[4];
  check('15 feed + update: heap growth over 20k samples under 64 KB', med < 65536, `median ${(med / 1024).toFixed(1)} KB`);
}
// 16. owner flags
{
  let w!: World;
  run({ pose: hold(8), tilt: true, dur: 4, thumb: [{ down: 0.5, up: 1, b: () => 0.3 }], reach: { down: 2, up: 2.6 }, hud: true, hook: (t, x) => (w = x) });
  check('16 owner flags: thumb, then a TURBO hold: both clear, handed back', !w.mix.thumbHeld && !w.mix.reachHeld && w.mix.phase === 'live', `${w.mix.phase}`);
  // commit with tilt off, toggle on, lift
  const c = run({ pose: hold(8), dur: 4, before: (x) => x.setActive(false), thumb: [{ down: 0.5, up: 1.5, b: () => 0.3 }, { down: 2.5, up: 3, b: () => 0.2 }], hook: (t, x) => {
    if (Math.abs(t - 1) < DT / 2) { x.setActive(true); x.input.wakeMix(); }
  } });
  check('16 commit with tilt off, toggle on, lift; a later session hands back', !c.world.mix.thumbHeld && c.world.mix.phase !== 'thumb', c.world.mix.phase);
}
// 17. a thumb across a toggle-on: one owner, the first hand-back caps at 0
{
  let during = false, after = 0;
  const c = run({ pose: hold(14), dur: 4, before: (x) => x.setActive(false), thumb: [{ down: 0.5, up: 1.5, b: () => 0.3 }], hook: (t, x) => {
    if (Math.abs(t - 1) < DT / 2) { x.setActive(true); x.input.wakeMix(); during = x.mix.thumbHeld && !x.mix.reachHeld && x.mix.phase === 'thumb'; }
    if (Math.abs(t - 1.7) < DT / 2) after = x.mix.out.x;
  } });
  check('17 thumb across a toggle-on: one owner, hand-back at cap 0', during && Math.abs(c.world.core.sx) < 0.02, `stick ${f3(c.world.core.sx)}, ${f3(after)} just after`);
}
// 18. gain: starts 0, a probe writes no stretch, a returning start eases in
{
  const c = run({ pose: hold(14), dur: 1, before: (x) => { Object.defineProperty(x.src, 'probing', { value: true, configurable: true }); } });
  const z = c.ox.every((v) => v === 0);
  const e = run({ pose: hold(14), dur: 1.5 });
  const first = e.ox[0];
  check('18 gain: a probe that reaches active writes no stretch', z, `max ${f3(Math.max(...c.ox))}`);
  check('18 gain: a returning start eases in', Math.abs(first) < 0.05 && e.maxStep <= 0.05, `first ${f3(first)}, max step ${f3(e.maxStep)}`);
}
// 19. sleep and turnOff
{
  let active2 = true, stops = 0;
  const c = run({ pose: hold(14), dur: 6, hook: (t, x) => {
    if (Math.abs(t - 1) < DT / 2) x.mix.sleep();
    if (t > 2.9 && t < 3) active2 = x.src.active && x.mix.g === 0;
    if (Math.abs(t - 3.1) < DT / 2) x.input.wakeMix();
    if (Math.abs(t - 4) < DT / 2) x.mix.turnOff();
    // Controls.frame's rule
    if (x.mix.offPending && x.mix.g === 0) { x.mix.offPending = false; stops++; x.setActive(false); }
  } });
  check('19 sleep: gain 0 for 2 s leaves tilt active', active2, String(active2));
  check('19 turnOff: stops once, at gain 0', stops === 1, `${stops} stop`);
  const d = run({ pose: hold(14), dur: 3, hook: (t, x) => {
    if (Math.abs(t - 1) < DT / 2) x.mix.turnOff();
    if (Math.abs(t - 1.05) < DT / 2) { x.mix.sleep(); doc.hidden = false; x.input.wakeMix(); } // hidden during the fade, then back
  } });
  check('19 a hidden page during turnOff stays off on return', d.world.mix.gTarget === 0 && d.world.mix.offPending, `gTarget ${d.world.mix.gTarget}`);
  void c;
}
for (const r of rows) console.log(r);
void inputTune;
console.log(fails.length ? `FAILED ${fails.length}` : `hybrid checks: all ${rows.length} passed`);
process.exit(fails.length ? 1 : 0);
