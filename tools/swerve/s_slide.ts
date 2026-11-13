// The shots in a slide (docs/specs/flight/SWERVE.md, "The shots under the handling"), in Node: node tools/feel-sim/run.mjs ../swerve/s_slide.ts
// The real Flight (Swerve inside it), TurboDrive, Aimer, Comet, Lob, CameraRig and TurboLens over the real baked city, each frame as main.ts's: the gears,
// the flight's steps with the stick's hard part, skid and side (Input's stickParts), the aim turned by the slip (aimer.lookYaw = rig.aimYaw + slip), the
// lens, then the plans' lens. A thumb held 150 px out at Jet, a skid's whole slide:
//   hold     from 300 m (the near Comet), 1.5 and 5 km (the far one): each frame's planned landing off the nose. The handling's promise is "a tap in the slide
//            is a shot down the nose" (Swerve.ts); a landing held from before the swing was up to 59 degrees off it (the far shots' review, F1)
//   release  a tap 0.25 s into the slide from 1.5 and 5 km, the thumb let go at it: the shot fired off the nose, and its hit on the screen at the impact
// Prints a row each, and exits 1 if one fails. SB_SRC=<an older tree's src> runs it against that tree.
import { newCity, pump, ll, makeGame, config, THREE } from '../feel-sim/lib';
import { CameraRig } from '@src/game/CameraRig';
import { JET, TurboDrive, driveSpeed } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
import { lensFov } from '@src/render/PixelPipeline';
import { stickParts, inputTune } from '@src/game/Input';

const SW = 393, SH = 852, DEG = Math.PI / 180, dt = 1 / 60;
/** the most a planned landing may be off the nose in a slide (deg): the Comet's and the Lob's 8 degrees, and a frame's swing at Jet (2.3) */
const OFF_MOST = 12;
const r1 = (v: number) => Math.round(v * 10) / 10, r3 = (v: number) => Math.round(v * 1000) / 1000;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const city = await newCity();
const F = config.flight;
let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(40)} ${JSON.stringify(o)}`);
};

/** Input.applyStretch's stick for a thumb (dx, dy) px off the stick's middle (+dy down: a pull), leashed; and the travel stickParts reads (leashed dx). */
function stickOf(dx: number, dy: number) {
  const px = F.stretchPx, max = Math.max(F.deadZonePx + 1, inputTune.leash * px);
  let d = Math.hypot(dx, dy);
  if (d > max) {
    dx *= max / d;
    dy *= max / d;
    d = max;
  }
  if (d <= F.deadZonePx) return { sx: 0, sy: 0, dx };
  const s0 = (d - F.deadZonePx) / px, k = inputTune.knee, r = 1 - k, s = s0 <= k ? s0 : k + r * Math.tanh((s0 - k) / r);
  return { sx: (dx / d) * s, sy: (-dy / d) * s, dx };
}

/** The bus at Jet h m over Alamo Square, heading east, the handling on, the city streamed round it */
async function rigAt(h: number) {
  const [px, pz] = ll(37.7763, -122.4352);
  const hd = 88 * DEG, fx = Math.sin(hd), fz = -Math.cos(hd);
  const drive = new TurboDrive([-1e7, -1e7, 1e7, 1e7]);
  const g = makeGame(city, drive), f = g.flight;
  f.swerve.on = true;
  const v0 = driveSpeed(JET, 0, true);
  f.x = px - fx * v0 * 3;
  f.z = pz - fz * v0 * 3;
  f.heading = hd;
  f.glideSpeed = 0;
  f.speed = v0;
  f.fullness = 1;
  await pump(city, f.x, f.z);
  const g0 = city.groundAt(f.x, f.z);
  f.y = g0 + h;
  f.holdY = f.y;
  drive.arrive(JET, 0);
  await pump(city, f.x, f.z, f.y - g0, fx, fz);
  const rig = new CameraRig(), lens = new TurboLens(), cam = new THREE.PerspectiveCamera(50, SW / SH, 1, 60000), focus = new THREE.Vector3();
  rig.settleAt(Math.max(0, f.y - g0));
  g.aimer.comet!.lens = cam;
  g.aimer.lob!.lens = cam;
  // (main.ts: aimer.lookYaw = rig.aimYaw + slip, set before aimer.update)
  const upd = g.aimer.update.bind(g.aimer);
  g.aimer.update = (fl, t, dr, th) => ((g.aimer.lookYaw = rig.aimYaw + fl.swerve.slip), upd(fl, t, dr, th));
  const inner = { x: 1, y: 1 };
  const parts = { hard: 0, skid: -Infinity, hardTop: 1 };
  const camFwd = new THREE.Vector3(), streamFwd = new THREE.Vector3();
  let k = 0;
  const b = {
    g, f, cam,
    async frame(thumb: [number, number] | null) {
      if (k++ % 10 === 0) await pump(city, focus.lengthSq() > 0 ? focus.x : f.x, focus.lengthSq() > 0 ? focus.z : f.z, f.lift, streamFwd.lengthSq() > 0 ? streamFwd.x : f.fx, streamFwd.lengthSq() > 0 ? streamFwd.z : f.fz);
      const st = thumb ? stickOf(thumb[0], thumb[1]) : { sx: 0, sy: 0, dx: 0 };
      if (thumb) stickParts(Math.abs(st.dx), Infinity, parts);
      g.frame(dt, { sx: st.sx, sy: st.sy, dragging: !!thumb, hard: thumb ? parts.hard : 0, skid: thumb ? parts.skid : -Infinity, side: thumb ? Math.sign(st.dx) : 0, hardTop: parts.hardTop } as never);
      lens.update(dt, drive, rig, f);
      rig.zone = 0;
      rig.skyLiftTarget = 0;
      rig.update(cam, focus, f, dt);
      const lf = lensFov(SW, SH, rig.hfov);
      cam.fov = lf.fov;
      cam.aspect = lf.aspect;
      inner.y = lf.inner;
      inner.x = SW / (SW + (SH / lf.inner - SH));
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      cam.getWorldDirection(camFwd);
      camFwd.y = 0;
      if (camFwd.lengthSq() < 1e-6) camFwd.set(f.fx, 0, f.fz);
      camFwd.normalize();
      rig.streamDir(camFwd, streamFwd);
    },
    /** A tap as main.ts's (the finger's press, 1/15 s, then the tap), the stick held as `thumb` */
    async tap(thumb: [number, number] | null) {
      g.press();
      for (let j = 0; j < 4; j++) await b.frame(thumb);
      const ev0 = g.events.length, t = g.t;
      return { res: g.tap(), ev0, t };
    },
    /** where a point shows on the screen (0..1, y down), in it or not */
    screen(p: { x: number; y: number; z: number }) {
      const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse), front = v.z < 0;
      v.applyMatrix4(cam.projectionMatrix);
      const x = 0.5 + (v.x * 0.5) / inner.x, y = 0.5 - (v.y * 0.5) / inner.y;
      return { x: r3(x), y: r3(y), in: front && x >= 0 && x <= 1 && y >= 0 && y <= 1 };
    },
    /** a point's flat angle off the nose (heading + slip, deg) */
    offNose(p: { x: number; z: number }) {
      return wrap(Math.atan2(p.x - f.x, -(p.z - f.z)) - f.heading - f.swerve.slip) / DEG;
    },
  };
  for (let j = 0; j < 180; j++) await b.frame(null);
  return b;
}

// ---------------------------------------------------------------- hold: every frame of the slide
for (const h of [300, 1500, 5000]) {
  const b = await rigAt(h), f = b.f;
  const thumb: [number, number] = [150, 0];
  let t0 = -1, n = 0, none = 0, far = 0, offMost = 0, offAt = 0;
  for (let j = 0; j < 150; j++) {
    await b.frame(thumb);
    if (t0 < 0 && f.swerve.sliding) t0 = b.g.t;
    if (t0 < 0) continue;
    const p = b.g.aimer.cometPlan;
    n++;
    if (!p) none++;
    else {
      if (p.far) far++;
      const off = Math.abs(b.offNose(p));
      if (off > offMost) [offMost, offAt] = [off, b.g.t - t0];
    }
    if (!f.swerve.sliding) break;
  }
  row(n > 30 && n - none > 30 && offMost <= OFF_MOST, `hold: the slide from ${h} m, its plans`, { frames: n, noPlan: none, far, offNoseMostDeg: r1(offMost), at: r1(offAt), limit: OFF_MOST });
}

// ---------------------------------------------------------------- release: a tap in the slide, the thumb let go at it
for (const h of [1500, 5000]) {
  const b = await rigAt(h), f = b.f, g = b.g;
  const thumb: [number, number] = [150, 0];
  let t0 = -1;
  for (let j = 0; j < 240; j++) {
    await b.frame(thumb);
    if (t0 < 0 && f.swerve.sliding) t0 = g.t;
    if (t0 >= 0 && g.t - t0 >= 0.25 - 4 / 60) break;
  }
  const slip = f.swerve.slip / DEG;
  const tp = await b.tap(thumb);
  const c = tp.res.shot.comet;
  const off = c ? b.offNose(c) : NaN;
  let hit: { x: number; y: number; z: number } | null = null, scr = null as ReturnType<typeof b.screen> | null;
  for (let j = 0; !hit && g.t - tp.t < 8; j++) {
    await b.frame(null);
    for (let e = tp.ev0; e < g.events.length; e++) {
      const ev = g.events[e];
      if (ev.ev !== 'impact' && ev.ev !== 'miss') continue;
      const p = ev.pos as number[];
      hit = { x: p[0], y: p[1], z: p[2] };
      scr = b.screen(hit);
      break;
    }
  }
  row(!!c && Math.abs(off) <= OFF_MOST, `release: a tap 0.25 s into the slide, ${h} m`, { slipDeg: r1(slip), shot: c ? (c.far ? 'far ' : '') + (c.kind ?? 'comet') : 'none', offNoseDeg: r1(off), limit: OFF_MOST, hitOnScreen: scr });
}

console.log(bad ? `${bad} FAILED` : 'all pass');
process.exit(bad ? 1 : 0);
