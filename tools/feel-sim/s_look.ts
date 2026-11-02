// The look (docs/specs/flight/THUMBS.md) through the real Flight, TurboDrive, TurboLens, CameraRig and, over the real city, the
// Aimer, no browser:
//   node tools/feel-sim/run.mjs s_look.ts [--no-city]
// Twin flights, one looking, the other not: what a look may change and what it may not. Every line ends in a verdict, and the
// process fails if any is false. Flat world but for the aim.
import { makeCam, makeGame, newCity, pump, ll, config, MODE, save, THREE } from './lib';
import { Flight } from '@src/game/Flight';
import { TurboDrive } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';

const GROUND = 10, ROOF = 20;
const flat: any = { obstacleAt: () => ROOF, groundAt: () => GROUND };
const DEG = 180 / Math.PI;
const BOUNDS = [-1e6, -1e6, 1e6, 1e6];
const res: Record<string, unknown> = {};
let bad = 0;
const check = (name: string, ok: boolean, data?: unknown) => {
  res[name] = { ok, data };
  if (!ok) bad++;
  console.log(`[${MODE}] ${ok ? 'ok  ' : 'FAIL'} ${name}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`);
};
const r2 = (x: number) => Math.round(x * 100) / 100;

type Look = { x: number; y: number } | null;
/** the same flight every time: Math.random reseeded per session */
function session(y0 = ROOF + 6.5, dt = 1 / 60) {
  let seed = 12345;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const f: any = new Flight();
  f.y = y0;
  if (y0 > 100) {
    f.holdY = y0;
    f.mode = 1;
  }
  f.fullness = 1;
  f.glideSpeed = 0;
  f.groundBroad = GROUND;
  const drive = new TurboDrive(BOUNDS);
  const lens = new TurboLens();
  const c = makeCam();
  const s = {
    f, drive, c, t: 0, held: false,
    frame(sy: number, sx = 0, look: Look = null, simDt = dt) {
      drive.update(simDt, f, s.held);
      const steps = Math.max(1, Math.ceil(simDt * 120));
      for (let i = 0; i < steps; i++) f.step(simDt / steps, { sx, sy, dragging: sy !== 0 || sx !== 0 }, flat);
      lens.update(dt, drive, c.rig, f);
      c.rig.setLook(look !== null, look?.x ?? 0, look?.y ?? 0, dt);
      c.update(f, simDt);
      s.t += dt;
    },
    run(secs: number, sy: number, sx = 0, look: Look = null) {
      const n = Math.round(secs / dt);
      for (let k = 0; k < n; k++) s.frame(sy, sx, look);
    },
    pose: () => [c.cam.position.x, c.cam.position.y, c.cam.position.z, c.cam.quaternion.x, c.cam.quaternion.y, c.cam.quaternion.z, c.cam.quaternion.w],
    /** where the bus stands in the 240 x 520 frame (px) */
    bus() {
      const p = c.project(f.x, f.y, f.z);
      return [p.x * 240, p.y * 520];
    },
    /** how far the view pitches down, and its roll (deg) */
    view() {
      const d = new THREE.Vector3(0, 0, -1).applyQuaternion(c.cam.quaternion);
      const r = new THREE.Vector3(1, 0, 0).applyQuaternion(c.cam.quaternion);
      return { down: Math.asin(-d.y) * DEG, roll: Math.asin(r.y) * DEG, yaw: Math.atan2(d.x, -d.z) * DEG };
    },
    yawOff: () => (c.rig as any).lookYaw.x * DEG,
    pitchOff: () => (c.rig as any).lookPitch.x * DEG,
  };
  return s;
}
/** straight into Jet: the gear above Express */
const toJet = (s: ReturnType<typeof session>) => { s.drive.shift(1, s.f); s.drive.shift(1, s.f); };
const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
const near = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

// ---- a settled view is exactly what it was, and the flight never knew: twin flights, frame by frame
{
  const scripts: Array<[string, number, (s: ReturnType<typeof session>) => { sy: number; sx: number }, (s: ReturnType<typeof session>) => void]> = [
    ['cruise', ROOF + 6.5, () => ({ sy: 0, sx: 0 }), () => {}],
    ['turning', ROOF + 6.5, () => ({ sy: 0, sx: 0.7 }), () => {}],
    ['climbing', ROOF + 6.5, () => ({ sy: -1, sx: 0 }), () => {}],
    ['Jet', ROOF + 6.5, () => ({ sy: -0.6, sx: 0.2 }), (s) => toJet(s)],
    ['diving', 3000, () => ({ sy: 1, sx: 0 }), () => {}],
  ];
  for (const [name, y0, stick, start] of scripts) {
    const A = session(y0);
    start(A);
    const posesA: number[][] = [], flightA: number[][] = [];
    for (let k = 0; k < 480; k++) {
      const i = stick(A);
      A.frame(i.sy, i.sx);
      posesA.push(A.pose());
      flightA.push([A.f.x, A.f.y, A.f.z, A.f.heading, A.f.speed]);
    }
    const B = session(y0);
    start(B);
    let settled = -1, bad0 = 0, flew = 0, moved = 0;
    for (let k = 0; k < 480; k++) {
      const i = stick(B);
      // a look from 0.5 s to 2 s: round, up, over, and let go
      const t = k / 60;
      const look: Look = t > 0.5 && t < 2 ? { x: 200 * (t - 0.5), y: 120 * Math.sin(t * 5) } : null;
      B.frame(i.sy, i.sx, look);
      const p = B.pose();
      if (near(p, posesA[k]) > 1) moved++;
      const fl = [B.f.x, B.f.y, B.f.z, B.f.heading, B.f.speed];
      if (!same(fl, flightA[k])) flew++;
      if (t > 2 && settled < 0 && B.yawOff() === 0 && B.pitchOff() === 0) settled = k;
      if (settled >= 0 && !same(p, posesA[k])) bad0++;
    }
    check(`twin ${name}: settled exactly, the flight untouched`, settled > 0 && bad0 === 0 && flew === 0 && moved > 30, { homeAfterLift: r2(settled / 60 - 2), framesOffAfter: bad0, flightFramesDifferent: flew, framesTheLookMoved: moved });
  }
}

// ---- the bus stands where it stood, the distance doesn't change, at any speed, round the circle and over the top
{
  const cases: Array<[string, (s: ReturnType<typeof session>) => void]> = [
    ['cruise', (s) => s.run(4, 0)],
    ['surge', (s) => { s.held = true; s.run(4, 0.8); }],
    ['Express', (s) => { s.drive.shift(1, s.f); s.run(4, 0); }],
    ['Jet', (s) => { toJet(s); s.run(30, 0); }],
    ['Jet level 3', (s) => { toJet(s); s.run(20, 0); s.drive.level = 3; s.run(8, 0); }],
    ['turning at Jet', (s) => { toJet(s); s.run(30, 0); s.run(2, 0, 1); }],
  ];
  for (const [name, set] of cases)
    for (const [lx, ly] of [[90, 0], [-90, 0], [180, 0], [120, 0], [0, -50], [90, -50]]) {
      const A = session();
      const B = session();
      set(A);
      set(B);
      for (let k = 0; k < 90; k++) {
        const stick = name.startsWith('turning') ? 1 : 0;
        A.frame(0, stick);
        B.frame(0, stick, { x: lx, y: ly });
      }
      const a = A.bus(), b = B.bus();
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const dA = A.c.cam.position.distanceTo(new THREE.Vector3(A.f.x, A.f.y, A.f.z)), dB = B.c.cam.position.distanceTo(new THREE.Vector3(B.f.x, B.f.y, B.f.z));
      check(`bus in place ${name}, look ${lx},${ly}`, d < 0.5 && Math.abs(dA - dB) < 0.01 && Math.abs(b[0] - 120) < 120 && b[1] > 0 && b[1] < 520, { rest: a.map(r2), look: b.map(r2), distance: [r2(dA), r2(dB)], speed: r2(B.f.speed) });
    }
}

// ---- the gearing: the offset sets the angle, reversing at once; a full circle sideways, 45 up, 50 down
{
  const s = session();
  s.run(2, 0);
  s.run(1, 0, 0, { x: 37, y: 0 });
  check('1 degree per px', Math.abs(s.yawOff() - 37) < 0.01, r2(s.yawOff()));
  s.run(1, 0, 0, { x: 0, y: 200 });
  const top = s.pitchOff();
  s.run(0.5, 0, 0, { x: 0, y: 190 });
  const back = s.pitchOff();
  check('up stops at 45, and 10 px back from past it is 10 degrees back', Math.abs(top - config.camera.lookUp) < 0.01 && Math.abs(back - (config.camera.lookUp - 10)) < 0.05, { top: r2(top), back: r2(back) });
  s.run(1, 0, 0, { x: 0, y: -300 });
  check('down stops at 50', Math.abs(s.pitchOff() + config.camera.lookDown) < 0.01, r2(s.pitchOff()));
  const d0 = s.view().down;
  const s2 = session();
  s2.run(2, 0);
  s2.run(1, 0, 0, { x: 0, y: 30 });
  const v = s2.view(), rest = session();
  rest.run(3, 0);
  check('thumb up looks up, the lens where it was', v.down < rest.view().down - 29 && near(s2.pose().slice(0, 3), rest.pose().slice(0, 3)) < 1, { rest: r2(rest.view().down), up: r2(v.down), lookingDownMost: r2(d0) });
  const s3 = session();
  s3.run(1, 0);
  s3.run(1, 0, 0, { x: 270, y: 0 });
  const was = s3.view().yaw;
  s3.frame(0, 0, null);
  const after = s3.view().yaw;
  check('270 sideways: on the lift the same view, home the short way', Math.abs(s3.yawOff()) < 91 && Math.abs(((was - after + 540) % 360) - 180) < 8, { was: r2(was), after: r2(after), off: r2(s3.yawOff()) });
  const s4 = session();
  s4.run(2, 0);
  const mv: number[] = [];
  for (let k = 0; k < 30; k++) { s4.frame(0, 0, { x: k < 15 ? 90 : 30, y: 0 }); mv.push(s4.yawOff()); }
  check('the view turns back within a frame or two of the thumb', mv[17] < mv[14], mv.slice(13, 19).map(r2));
  const s5 = session();
  s5.run(1, 0);
  s5.run(0.4, 0, 0, { x: 90, y: 0 });
  const left = s5.yawOff();
  s5.run(0.25, 0);
  const was2 = s5.yawOff();
  s5.frame(0, 0, { x: 40, y: 0 });
  const next = s5.yawOff();
  s5.run(1, 0, 0, { x: 40, y: 0 });
  check('a thumb landing on a view still going home takes it from where it is', Math.abs(next - was2) < 3 && Math.abs(s5.yawOff() - 40) < 0.1, { left: r2(left), was: r2(was2), next: r2(next), end: r2(s5.yawOff()) });
}

// ---- a flick that outlasts the thumb's 100 ms wait: only its lift says it was a flick, so the view has to have stayed put
{
  const rows: unknown[] = [];
  let worst = 0;
  for (const fps of [60, 30])
    for (const [ms, px] of [[105, 74], [120, 74], [150, 74], [180, 74], [120, 40]]) {
      const s = session(ROOF + 6.5, 1 / fps);
      s.run(1, 0);
      let peak = 0;
      const n = fps * 2;
      for (let k = 0; k < n; k++) {
        const t = (k * 1000) / fps;
        s.frame(0, 0, t >= 100 && t <= ms ? { x: 0, y: (px * t) / ms } : null);
        peak = Math.max(peak, Math.abs(s.pitchOff()));
      }
      rows.push({ fps, ms, px, peak: r2(peak) });
      if (ms <= 120) worst = Math.max(worst, peak);
    }
  check('a flick of 120 ms or less hardly moves the view', worst < 3, rows);
}

// ---- home: about 1 s, exactly, at any frame rate
{
  const rows: unknown[] = [];
  let same3060 = true;
  for (const [x, y] of [[30, 0], [90, 0], [180, 0], [0, 45], [0, -50], [120, 30]]) {
    const path: Record<number, { px: number; zero: number; at5: number }> = {};
    for (const fps of [30, 60]) {
      const s = session(ROOF + 6.5, 1 / fps);
      s.run(1, 0);
      s.run(1, 0, 0, { x, y });
      let t = 0, px = -1, zero = -1, at5 = 0;
      for (let k = 0; k < 4 * fps && zero < 0; k++) {
        s.frame(0);
        t += 1 / fps;
        const m = Math.hypot(s.yawOff(), s.pitchOff());
        if (px < 0 && m < 0.06) px = t;
        if (m === 0) zero = t;
        if (k === Math.round(0.5 * fps) - 1) at5 = m;
      }
      path[fps] = { px: r2(px), zero: r2(zero), at5: r2(at5) };
    }
    if (Math.abs(path[30].at5 - path[60].at5) > 0.15) same3060 = false;
    rows.push({ x, y, ...path });
  }
  check('home within a game pixel in about 1 s, exactly 0 soon after', (rows as any[]).every((r) => r[60].px < 1.25 && r[60].zero > 0 && r[60].zero < 2 && r[30].zero < 2.1), rows);
  check('the same path at 30 and 60 fps', same3060);
}

// ---- the wall clock: a hit-stop doesn't stall it
{
  const s = session();
  s.run(2, 0);
  const p0 = s.f.x;
  for (let k = 0; k < 60; k++) s.frame(0, 0, { x: 50, y: 0 }, 0);
  check('it turns through a hit-stop', Math.abs(s.yawOff() - 50) < 0.1 && s.f.x === p0, r2(s.yawOff()));
}

// ---- the opening's low shot keeps its camera
{
  const A = session(), B = session();
  A.c.rig.openingLow = 1;
  B.c.rig.openingLow = 1;
  for (let k = 0; k < 120; k++) {
    A.frame(0);
    B.frame(0, 0, { x: 80, y: 40 });
  }
  check('off under the low shot', same(A.pose(), B.pose()));
}

// ---- over a dive: the tilt and the look add, and it never turns over
{
  const mk = () => {
    const s = session(4000);
    s.run(6, 1);
    return s;
  };
  const rest = mk();
  const down = mk();
  down.run(1, 1, 0, { x: 0, y: -100 });
  const up = mk();
  up.run(1, 1, 0, { x: 0, y: 45 });
  const side = mk();
  side.run(1, 1, 0, { x: 90, y: 0 });
  const r = rest.view(), d = down.view(), u = up.view(), si = side.view();
  check('a dive: rest, down, up, sideways', r.down > 65 && d.down > r.down && d.down <= config.camera.lookViewMax + 0.01 && u.down < r.down - 40 && Math.abs(d.roll) < 0.01 && Math.abs(si.roll) < 0.01 && Math.abs(si.down - r.down) < 3, { rest: r2(r.down), down: r2(d.down), up: r2(u.down), side: r2(si.down), roll: r2(d.roll) });
}

// ---- the stream stays on the heading, and a long look takes it along
{
  const s = session(1200);
  s.run(3, 0);
  const flat2 = (q: THREE.Quaternion) => {
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    d.y = 0;
    return d.normalize();
  };
  const out = new THREE.Vector3();
  const row: Array<[number, number]> = [];
  for (let k = 0; k < 6 * 60; k++) {
    const held = k < 4 * 60;
    s.frame(0, 0, held ? { x: 180, y: 0 } : null);
    s.c.rig.streamDir(flat2(s.c.cam.quaternion), out);
    if (k % 30 === 29) row.push([r2((k + 1) / 60), r2(Math.atan2(out.x, -out.z) * DEG - s.f.heading * DEG)]);
  }
  const at = (t: number) => Math.abs(((row.find((r) => r[0] === t)![1] + 540) % 360) - 180);
  check('the stream: on the heading to 2 s, then round, then home', at(1.5) === 0 && at(2) === 0 && at(4) > 170 && at(6) < 5, row);
}

// ---- the aim, over the real city: it turns with the view, sideways, and what glints is what a tap hits
if (!process.argv.includes('--no-city')) {
  const city = await newCity();
  const places: Array<[string, number, number, number]> = [
    ['alamo', 37.7762, -122.438, 90],
    ['noe', 37.7502, -122.4337, 0],
    ['fidi', 37.7925, -122.401, 0],
    ['sunset', 37.755, -122.49, 90],
  ];
  const rows: any[] = [];
  for (const [name, lat, lon, hdg] of places) {
    const [x0, z0] = ll(lat, lon);
    await pump(city, x0, z0);
    for (const look of [0, 30, -30, 60, -60, 90, -90, 100, -100]) {
      const g = makeGame(city);
      const f = g.flight;
      f.x = x0; f.z = z0; f.heading = (hdg * Math.PI) / 180; f.y = city.obstacleAt(x0, z0) + 9; f.glideSpeed = 0;
      g.aimer.lookYaw = (look * Math.PI) / 180;
      const dt = 1 / 60;
      for (let k = 0; k < 90; k++) g.frame(dt, { sx: 0, sy: 0, dragging: false });
      f.fullness = 1;
      for (let k = 0; k < 20; k++) g.frame(dt, { sx: 0, sy: 0, dragging: false });
      const bearing = (Math.atan2(g.aimer.fx, -g.aimer.fz) - f.heading) * DEG;
      const glint = g.glint();
      const fx0 = f.x, fz0 = f.z, head = f.heading;
      const r = g.tap();
      let primary = -1, impact: number[] | null = null;
      const e0 = g.events.length;
      for (let k = 0; k < 90; k++) g.frame(dt, { sx: 0, sy: 0, dragging: false });
      for (const ev of g.events.slice(Math.max(0, e0 - 1))) {
        if (ev.ev === 'primary' && primary < 0) primary = ev.index as number;
        if (ev.ev === 'impact') impact = ev.pos as number[];
      }
      const off = impact ? ((Math.atan2(impact[0] - fx0, -(impact[2] - fz0)) - head) * DEG + 540) % 360 - 180 : null;
      rows.push({ place: name, look, aim: r2(((bearing + 540) % 360) - 180), glint: glint?.index ?? -1, fired: r.fired, target: r.target?.index ?? -1, primary, off: off === null ? null : r2(off) });
    }
  }
  const lookRows = rows.filter((r) => r.fired);
  // (a building is picked round the aim point and a wall can take the shot first: the nose's own scatter here is 22 degrees)
  const wrongWay = lookRows.filter((r) => r.off !== null && Math.abs(((r.off - r.look + 540) % 360) - 180) > 30);
  const missHit = lookRows.filter((r) => r.glint >= 0 && r.primary >= 0 && r.glint !== r.primary);
  check('the breath goes where the view looks', rows.every((r) => Math.abs(r.aim - r.look) < 0.01), rows.slice(0, 9).map((r) => [r.look, r.aim]));
  check('a tap lands where the view looks, and what glints is what it hits', lookRows.length >= 30 && wrongWay.length === 0 && missHit.length === 0, { fired: lookRows.length, off: lookRows.map((r) => [r.look, r.off]), wrongWay, missHit });
}

save('look', res);
console.log(bad ? `FAILED ${bad}` : 'all passed');
process.exit(bad ? 1 : 0);
