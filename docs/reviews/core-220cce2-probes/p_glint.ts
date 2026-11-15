// The reviewer's probe (not the branch's): does a tap throw what glinted when a finger is down in the look zone and the tap gives its press back?
// The real Input, Flight, Aimer, Comet, Lob and CameraRig, main.ts's order (input.update, setLook, the flight, aimer.update, rig.update), touches between frames.
//   node tools/feel-sim/run.mjs p_glint.ts [--fps=60,30]
// Each round: finger Q lands in the look zone (still, or dragging sideways: the look), the thumb R taps on the lane 0.3 s on, Q lifts. With and without Q.
import { newCity, pump, ll, makeGame, config, THREE, CameraRig } from './lib';
import { JET, NONSTOP, TurboDrive, driveSpeed } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
import { lensFov } from '@src/render/PixelPipeline';
import { installDom, Target, clock, ptr, newId, runTimers } from '../controls-sim/fakedom';

const args = process.argv.slice(2);
const FPS = (args.find((a) => a.startsWith('--fps='))?.slice(6) ?? '60,30').split(',').map(Number);
const ROUNDS = +(args.find((a) => a.startsWith('--rounds='))?.slice(9) ?? 8);
const GEARS = (args.find((a) => a.startsWith('--gears='))?.slice(8) ?? 'cruise,nonstop,jet').split(',');
const MODES = (args.find((a) => a.startsWith('--modes='))?.slice(8) ?? 'none,still,drag').split(',');
const DRAG = +(args.find((a) => a.startsWith('--drag='))?.slice(7) ?? 4);
const city = await newCity();
installDom();
const { Input, inputTune } = await import('@src/game/Input');
const DEG = Math.PI / 180, SW = 393, SH = 852;
const PLACES = { wa: { lat: 37.7763, lon: -122.4352, hdg: 88 }, dt: { lat: 37.7752, lon: -122.4193, hdg: 45 }, glen: { lat: 37.733, lon: -122.44, hdg: 300 } } as const;

async function run(place: keyof typeof PLACES, gear: number, level: number, fps: number, mode: 'none' | 'still' | 'drag' | 'steer', rounds: number) {
  const dt = 1 / fps, step = 1000 / fps;
  const P = PLACES[place];
  const [px, pz] = ll(P.lat, P.lon);
  const fx = Math.sin(P.hdg * DEG), fz = -Math.cos(P.hdg * DEG);
  const drive = new TurboDrive([-1e7, -1e7, 1e7, 1e7]);
  const g = makeGame(city, drive);
  const f = g.flight;
  city.paint.resetAll();
  const v0 = gear > 0 ? driveSpeed(gear, level, true) : config.flight.cruiseSpeed;
  f.x = px - fx * v0 * 3;
  f.z = pz - fz * v0 * 3;
  f.heading = Math.atan2(fx, -fz);
  f.glideSpeed = 0;
  f.speed = v0;
  f.fullness = 1;
  await pump(city, f.x, f.z);
  const g0 = city.groundAt(f.x, f.z);
  const alt = gear === NONSTOP ? config.turbo.nonstopAlt : gear >= JET ? config.turbo.jetAlt : 0;
  f.y = alt > 0 ? g0 + alt : city.obstacleAt(f.x, f.z) + 9;
  if (gear > 0) drive.arrive(gear, level);
  await pump(city, f.x, f.z, Math.max(0, f.y - g0), fx, fz);
  const rig = new CameraRig(), lens = new TurboLens(), cam = new THREE.PerspectiveCamera(50, SW / SH, 1, 60000), focus = new THREE.Vector3();
  g.aimer.comet!.lens = cam;
  g.aimer.lob!.lens = cam;
  const el = new Target();
  const input = new Input(el as unknown as HTMLElement);
  input.setMode('touch');
  input.busZone = { x: 196, y: 511, r: inputTune.laneHalf * 393, open: inputTune.laneOpen * 852 };
  input.aimOn = false;
  let replans = 0, givenNow = false;
  input.onPress = () => g.aimer.press(input.presses);
  input.onUnpress = (n) => {
    const before = (g.aimer as any).given;
    g.aimer.unpress(n);
    if (!before && (g.aimer as any).given) givenNow = true;
  };
  input.onRepress = (n) => g.aimer.repress(n);
  type Seen = { idx: number | null; kind: string; x: number; z: number };
  const seen = (): Seen => {
    const p = g.aimer.planned, s = g.aimer.shown();
    return { idx: s ? s.index : null, kind: p ? (p.kind ?? 'comet') : 'tap', x: p ? p.x : g.aimer.aim.x, z: p ? p.z : g.aimer.aim.z };
  };
  const taps: Array<{ pre: Seen; post: Seen; shot: { idx: number | null; kind: string; x: number; z: number }; replanned: boolean; fired: boolean }> = [];
  input.onTap = () => {
    const pre = seen();
    const replanned = givenNow;
    if (replanned) replans++;
    g.aimer.refresh(f);
    const post = seen();
    const r = g.tap();
    taps.push({ pre, post, shot: { idx: r.shot.target ? r.shot.target.index : null, kind: r.shot.comet ? (r.shot.comet.kind ?? 'comet') : 'tap', x: r.shot.x, z: r.shot.z }, replanned, fired: r.fired });
  };
  let k = 0, next = clock.ms + step;
  const frame = async () => {
    clock.ms = next;
    next += step;
    runTimers();
    if (k++ % 10 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
    input.update(dt);
    const st = input.state;
    givenNow = false;
    rig.setLook(st.look.on, st.look.x, st.look.y, dt);
    g.aimer.lookYaw = rig.aimYaw;
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
  const until = async (ms: number) => {
    while (next <= ms) await frame();
    clock.ms = ms;
    runTimers();
  };
  for (let j = 0; j < Math.round(3 / dt); j++) await frame();
  for (let r = 0; r < rounds; r++) {
    const idQ = newId(), idR = newId();
    const T = clock.ms + 7 * (r % 5);
    await until(T);
    let qx = 330;
    if (mode === 'steer') {
      // (the thumb on the lane steers, a slow carve; the other thumb taps in the look zone 0.3 s on: Input.answer)
      const idO = newId();
      let rx = 196, mm = T + 20;
      el.dispatch('pointerdown', ptr('pointerdown', idR, rx, 700, true));
      const carve = async (to: number) => {
        while (mm < to) {
          await until(mm);
          rx += r % 2 ? 2 : -2;
          el.dispatch('pointermove', ptr('pointermove', idR, rx, 700, true));
          mm += 20;
        }
      };
      const d0 = T + 300 + 11 * (r % 4), u0 = d0 + 60 + 9 * (r % 3);
      await carve(d0);
      await until(d0);
      el.dispatch('pointerdown', ptr('pointerdown', idO, 70, 330, false));
      await carve(u0);
      await until(u0);
      el.dispatch('pointerup', ptr('pointerup', idO, 70, 330, false));
      await carve(u0 + 300);
      await until(u0 + 300);
      el.dispatch('pointerup', ptr('pointerup', idR, rx, 700, true));
      await until(clock.ms + 2600);
      continue;
    }
    if (mode !== 'none') el.dispatch('pointerdown', ptr('pointerdown', idQ, qx, 300, true));
    // (the look: 4 px every 20 ms, to and fro)
    const tapDown = T + 300 + 11 * (r % 4), tapUp = tapDown + 60 + 9 * (r % 3);
    let m = T + 20, dir = r % 2 ? 1 : -1;
    const moves = async (to: number) => {
      while (mode === 'drag' && m < to) {
        await until(m);
        qx += DRAG * dir;
        if (qx < 250 || qx > 380) dir = -dir;
        el.dispatch('pointermove', ptr('pointermove', idQ, qx, 300, true));
        m += 20;
      }
    };
    await moves(tapDown);
    await until(tapDown);
    el.dispatch('pointerdown', ptr('pointerdown', idR, 196, 700, mode === 'none'));
    await moves(tapUp);
    await until(tapUp);
    el.dispatch('pointerup', ptr('pointerup', idR, 196, 700, mode === 'none'));
    await moves(tapUp + 250);
    await until(tapUp + 250);
    if (mode !== 'none') el.dispatch('pointerup', ptr('pointerup', idQ, qx, 300, true));
    // (the belly full again, the look home)
    await until(clock.ms + 2600);
  }
  input.dispose();
  const off = taps.filter((t) => t.fired && (t.shot.idx !== t.pre.idx || t.shot.kind !== t.pre.kind));
  const far = off.map((t) => Math.round(Math.hypot(t.shot.x - t.pre.x, t.shot.z - t.pre.z)));
  const offRe = off.filter((t) => t.replanned).length;
  const moved = taps.filter((t) => t.replanned && (t.post.idx !== t.pre.idx || t.post.kind !== t.pre.kind)).length;
  return { n: taps.length, fired: taps.filter((t) => t.fired).length, replans, off: off.length, offRe, moved, far, kinds: [...new Set(taps.map((t) => `${t.pre.kind}>${t.shot.kind}`))] };
}

let total = 0;
for (const fps of FPS)
  for (const [name, gear, level] of ([['cruise', 0, 0], ['nonstop', NONSTOP, 0], ['jet', JET, 0], ['turbo1', JET, 1], ['turbo2', JET, 2], ['turbo3', JET, 3]] as Array<[string, number, number]>).filter((x) => GEARS.includes(x[0])))
    for (const place of ['wa', 'dt', 'glen'] as const)
      for (const mode of (['none', 'still', 'drag', 'steer'] as const).filter((x) => MODES.includes(x))) {
        const r = await run(place, gear, level, fps, mode, ROUNDS);
        if (mode !== 'none') total += r.off;
        console.log(`${place} ${name}@${fps} ${mode.padEnd(5)} taps ${r.n} fired ${r.fired} replanned ${r.replans} off the glint ${r.off} (${r.offRe} of them replanned; the replan moved the plan in ${r.moved}) ${r.far.length ? `(${r.far.join(', ')} m)` : ''} ${r.kinds.join(' ')}`);
      }
console.log(`glint probe: ${total} taps off what glinted with a finger in the look zone`);
