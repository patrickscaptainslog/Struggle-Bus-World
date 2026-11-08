// The shots' probe (docs/specs/shots/BUILT.md, "Step 3: the probe and the Comet"): a tap at every rung and pose over the real baked city, through the
// real Flight, TurboDrive, TurboLens, CameraRig, Aimer and Splatter. It taps through tools/feel-sim/loop.ts, whose barf is main.ts's own (Aim.tapOpts),
// and the lens projects as PixelPipeline.updateProjection does at 393 x 852 (lensFov).
//
// Rungs: School Zone, Cruise, Express, Nonstop, Jet, Turbo 1-3, and Jet and Turbo 1-3 at 16 km. Poses: level over the Western Addition (Alamo Square,
// east) at the rung's floor (the roofs; Nonstop's 60 m; 150 m from Jet up), 300, 1,500 and 6,000 m over the ground; the floor downtown (Market from Van
// Ness, the towers ahead); over water (north from Fort Mason); the nose 30 and 75 degrees up from 300 m; a 45 degree dive tapped at 800 m; full stick
// right for the 2 s before the tap at the floor over the Western Addition (what glints while steering); at the floor over the hills (Glen Park north at
// Diamond Heights, the Bayview south at its hills: the arc against the ground, the landing against a ridge). Each at 1/60 and 1/30 s. The bus comes
// into its pose from 3 s back along its way, its gear in, so the lens and the chase have settled when it taps there.
//
// A row: what the tap fired (a splat, a comet, a miss); tap to impact; the landing from the tap and ahead of the bus at the impact, and on what; its
// screen point at the tap and at the impact (in frame, how far above the bus as a share of the height, clear of the HUD's top band); when the bus passes
// it; the blast's radius, the buildings it painted and any it raised two levels; a wall that took it; its tile loaded at the tap; the aim's cost a frame;
// how far off the bus's line it lands; a Comet's arc under the ground at its worst, and the ground over the lens's line to it at the impact; steering,
// how often what glints changed a second. Every row starts on paint at level 1 everywhere, so a building a tap raised two shows. Streaming is Node's: a
// region is in the moment it's asked for, so "loaded" is the best case.
//
//   node tools/controls-sim/run.mjs s_shots.ts [--save-baseline] [--only=<substring>]
// --save-baseline writes tools/controls-sim/shots-baseline.json, today's shot (c09e415), which the gates read: every row that isn't a Comet must be the
// baseline's. Without a baseline file it only reports. Results in SB_OUT (shots/controls/sim)/shots.json, a table on stdout; exit 1 when a gate fails.
// --bomb flies the Bomb's rows instead (SHOTS.md, "The modes"; src/game/Bomb.ts), into shots-bomb.json, and gates only them: at Nonstop, Jet and Turbo 3,
// at the floor and 300 m over the Western Addition and at the floor downtown, the rung's tap as above, then a Bomb II and a Bomb III let go at the same
// moment through the real Bomb, with main.ts's breath (MEGA's radius, hit-stop and tag, the stages it jumps). Its paint starts at level 0 or 1 by turns,
// building by building, so a jump shows whole and the top too. Each Bomb lands within 2 m of that tap's Comet and when it does, 1.4 or 1.8 times its
// radius, every building it reaches at min(3, before + jump) and none past 3, in frame at the impact and with no hit-stop; none of the taps raised two.
// Where the tap is the classic shot (Turbo 3 from 300 m) so is the Bomb, on the tap's landing, with its hit-stop.
import { newCity, pump, ll, makeGame } from '../feel-sim/lib';
import { config } from '@src/config';
import { CameraRig } from '@src/game/CameraRig';
import { EXPRESS, JET, NONSTOP, SCHOOL_ZONE, TurboDrive, driveSpeed } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
import { lensFov } from '@src/render/PixelPipeline';
import { layoutHud } from '@src/ui/hudLayout';
import { blastRadiusFor } from '@src/game/blastLayout';
import { Bomb } from '@src/game/Bomb';
import { tapOpts } from '@src/game/Aim';
import * as THREE from 'three';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const SAVE = args.includes('--save-baseline');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7) ?? '';
const BOMB = args.includes('--bomb');
// (the bundle runs from tools/controls-sim/.out/s_shots_ts/)
const BASE_FILE = fileURLToPath(new URL('../../shots-baseline.json', import.meta.url));
const city = await newCity();
const DEG = Math.PI / 180;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** the page's screen in CSS px (an iPhone's portrait, its insets) and the HUD's top band: the readout and settings row */
const SW = 393, SH = 852;
const hud = layoutHud(SW, SH, { top: 59, right: 0, bottom: 34, left: 0 }, false, false, false);
const BAND = Math.max(hud.readout.y + hud.readout.h, hud.settings.v.y + hud.settings.v.h) / SH;

const PLACES = {
  wa: { lat: 37.7763, lon: -122.4352, hdg: 88, name: 'the Western Addition, east from Alamo Square' },
  dt: { lat: 37.7752, lon: -122.4193, hdg: 45, name: 'downtown, Market from Van Ness' },
  water: { lat: 37.8065, lon: -122.43, hdg: 0, name: 'north from Fort Mason' },
  glen: { lat: 37.733, lon: -122.44, hdg: 300, name: 'Glen Park, north at Diamond Heights' },
  bayview: { lat: 37.73, lon: -122.39, hdg: 200, name: 'the Bayview, south at its hills' },
} as const;
type Place = keyof typeof PLACES;
/** [name, gear (-1 School Zone), turbo level] */
const RUNGS: Array<[string, number, number]> = [['zone', -1, 0], ['cruise', 0, 0], ['express', EXPRESS, 0], ['nonstop', NONSTOP, 0], ['jet', JET, 0], ['t1', JET, 1], ['t2', JET, 2], ['t3', JET, 3]];
const COMET_RUNGS = ['nonstop', 'jet', 't1', 't2', 't3'];
/** a pose: where, how high ('floor' = the rung's own: the roofs, 60 m Nonstop, 150 m from Jet up; else m over the ground, or ASL past 15 km), and the
 *  stick (turn: held sideways for TURN_S s before the tap and on) */
interface Pose { key: string; place: Place; h: number | 'floor'; asl?: boolean; nose?: number; dive?: number; turn?: number }
const TURN_S = 2;
const POSES: Array<{ pose: Pose; rungs: string[] }> = [
  { pose: { key: 'wa-floor', place: 'wa', h: 'floor' }, rungs: RUNGS.map((r) => r[0]) },
  { pose: { key: 'wa-300', place: 'wa', h: 300 }, rungs: RUNGS.map((r) => r[0]) },
  { pose: { key: 'wa-1500', place: 'wa', h: 1500 }, rungs: RUNGS.map((r) => r[0]) },
  { pose: { key: 'wa-6000', place: 'wa', h: 6000 }, rungs: RUNGS.map((r) => r[0]) },
  { pose: { key: 'dt-floor', place: 'dt', h: 'floor' }, rungs: RUNGS.map((r) => r[0]) },
  { pose: { key: 'water-floor', place: 'water', h: 'floor' }, rungs: ['cruise', 'express', 'nonstop', 'jet', 't3'] },
  { pose: { key: 'wa-nose30', place: 'wa', h: 300, nose: 30 }, rungs: ['cruise', 'nonstop', 'jet', 't3'] },
  { pose: { key: 'wa-nose75', place: 'wa', h: 300, nose: 75 }, rungs: ['cruise', 'nonstop', 'jet', 't3'] },
  { pose: { key: 'wa-dive45', place: 'wa', h: 800, dive: 45 }, rungs: ['cruise', 'nonstop', 'jet', 't3'] },
  { pose: { key: 'wa-16km', place: 'wa', h: 16000, asl: true }, rungs: ['jet', 't1', 't2', 't3'] },
  { pose: { key: 'wa-turn', place: 'wa', h: 'floor', turn: 1 }, rungs: ['express', 'nonstop', 'jet', 't3'] },
  { pose: { key: 'glen-floor', place: 'glen', h: 'floor' }, rungs: ['nonstop', 'jet', 't3'] },
  { pose: { key: 'bayview-floor', place: 'bayview', h: 'floor' }, rungs: ['nonstop', 'jet', 't3'] },
];
/** the stick for a path at `deg` up (+) or down (-) with a gear in (Flight: the nose wants noseUp x pull^noseCurve past the yoke's dead band) */
const stickFor = (deg: number) => {
  const F = config.flight, k = Math.pow(Math.abs(deg) / F.noseUp, 1 / F.noseCurve);
  return Math.sign(-deg) * Math.min(1, F.yokeDead + k * (1 - F.yokeDead));
};

interface Scr { x: number; y: number; in: boolean; above: number; clear: boolean }
const v3 = new THREE.Vector3();
function screen(cam: THREE.PerspectiveCamera, inner: { x: number; y: number }, p: THREE.Vector3, bus: THREE.Vector3): Scr {
  const vis = (q: THREE.Vector3) => {
    v3.copy(q).applyMatrix4(cam.matrixWorldInverse);
    const front = v3.z < 0;
    v3.applyMatrix4(cam.projectionMatrix);
    return { x: 0.5 + (v3.x * 0.5) / inner.x, y: 0.5 - (v3.y * 0.5) / inner.y, front };
  };
  const a = vis(p), b = vis(bus);
  const inFrame = a.front && a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1;
  return { x: r3(a.x), y: r3(a.y), in: inFrame, above: r3(b.y - a.y), clear: inFrame && a.y > BAND };
}

/** --bomb: a Bomb let go now through the real Bomb on the probe's game (Input's lift at its tier, onBombEnd), with main.ts's breath for it: the tap's barf
 *  (Aim.tapOpts) with MEGA's radius, hit-stop and tag, and the stages its buildings jump. What it fired, as Game.tap says it */
function bombTap(g: ReturnType<typeof makeGame>, tier: 2 | 3) {
  const f = g.flight, nop = () => {};
  const input = { state: { bomb: { on: false, at: 0 } } } as any;
  let shot: any = null;
  const bomb = new Bomb({
    input, flight: f, aimer: g.aimer,
    audio: { bombCharge: nop, bombTier: nop, bombStop: nop, bombBeat: nop, superMega: nop } as any,
    fx: { motes: nop, halo: nop, sparks: nop } as any,
    rig: { kick: nop } as any,
    busVel: () => new THREE.Vector3(),
    breathe: (s, b) => {
      shot = s;
      const o = tapOpts(s, f.y);
      Object.assign(o, { radius: b.radius, hitStop: b.hitStop, super: b.tag, jump: b.jump });
      const at = g.splatter.barf(s.x, s.z, o);
      if (g.splatter.lastMiss) f.refund = config.splat.missRefund;
      return at;
    },
    busy: () => false,
  });
  bomb.on = true;
  input.onBombEnd(tier, false);
  const s = shot ?? { target: null, x: f.x, z: f.z, exact: false, drop: 0, travel: 0 };
  const landing = { x: s.x, y: s.y ?? (s.target ? city.roofAtPart(s.target, s.x, s.z, f.y) + 0.5 : city.groundAt(s.x, s.z)), z: s.z };
  return { fired: !!shot, target: shot ? s.target : null, glint: s.target, shot: s, landing, wall: !!s.exact, bomb: bomb.stats };
}

async function run(rung: [string, number, number], pose: Pose, dt: number, tier: 0 | 2 | 3 = 0) {
  const [rname, gear, level] = rung;
  const P = PLACES[pose.place];
  const [px, pz] = ll(P.lat, P.lon);
  const hd = P.hdg * DEG, fx = Math.sin(hd), fz = -Math.cos(hd);
  const drive = new TurboDrive([-1e7, -1e7, 1e7, 1e7]);
  const g = makeGame(city, drive);
  const f = g.flight;
  city.paint.resetAll();
  // (level 1 everywhere: a tap's blast takes each building to 2, so one it raised two shows as a 3. The review of step 3, 7. A Bomb's rows: 0 and 1 by
  // turns, so its jump shows whole from 0 and its top from 1)
  for (let i = 1, k = 0; i < city.paint.data.length; i += 4, k++) city.paint.data[i] = tier ? k % 2 : 1;
  const ceiling = config.flight.ceiling;
  if (pose.asl) config.flight.ceiling = 20000; // (?earth's ceiling: past 15 km)
  const v0 = gear > 0 && gear !== EXPRESS ? driveSpeed(gear, level, true) : gear === EXPRESS ? config.flight.surgeSpeed : config.flight.cruiseSpeed;
  const lead = 3;
  const back = gear < 0 ? 20 : v0 * lead * (pose.dive ? Math.cos(pose.dive * DEG) : 1);
  f.x = px - fx * back;
  f.z = pz - fz * back;
  f.heading = hd;
  f.glideSpeed = 0;
  f.speed = v0;
  f.fullness = 1;
  await pump(city, f.x, f.z);
  const g0 = city.groundAt(px, pz);
  const alt = gear === NONSTOP ? config.turbo.nonstopAlt : gear >= JET ? config.turbo.jetAlt : 0;
  if (pose.h === 'floor') f.y = alt > 0 ? city.groundAt(f.x, f.z) + alt : city.obstacleAt(f.x, f.z) + 9;
  else {
    f.y = pose.asl ? pose.h : g0 + pose.h + (pose.dive ? v0 * Math.sin(pose.dive * DEG) * (lead - 0.6) : 0);
    f.holdY = f.y;
  }
  if (gear === EXPRESS) drive.rung(1, f);
  else if (gear > 0) drive.arrive(gear, level);
  if (gear < 0) drive.rung(-1, f);
  await pump(city, f.x, f.z, Math.max(0, f.y - g0), fx, fz);
  const rig = new CameraRig(), lens = new TurboLens(), cam = new THREE.PerspectiveCamera(50, SW / SH, 1, 60000), focus = new THREE.Vector3();
  const inner = { x: 1, y: 1 };
  const cometOf = (g.aimer as any).comet;
  if (cometOf) cometOf.lens = cam;
  let aimMs = 0, aimN = 0;
  const upd = g.aimer.update.bind(g.aimer);
  g.aimer.update = (fl, t, dr) => { const t0 = performance.now(); const r = upd(fl, t, dr); aimMs += performance.now() - t0; aimN++; return r; };
  const stick = pose.nose ? stickFor(pose.nose) : pose.dive ? stickFor(-pose.dive) : 0;
  const turn = pose.turn ?? 0;
  const frame = async (k: number, holdStick: boolean) => {
    if (k % 10 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
    g.frame(dt, holdStick ? { sx: turn, sy: stick, dragging: true } : { sx: 0, sy: 0, dragging: false });
    lens.update(dt, drive, rig, f);
    rig.zone = drive.below === SCHOOL_ZONE ? 1 : 0;
    rig.update(cam, focus, f, dt);
    const lf = lensFov(SW, SH, rig.hfov);
    cam.fov = lf.fov;
    cam.aspect = lf.aspect;
    inner.y = lf.inner;
    inner.x = SW / (SW + (SH / lf.inner - SH));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  };
  // ---- into the pose: the stick held for the nose from 1.5 s before the tap; the dive from the start, tapped as it passes 800 m; the turn for the
  // TURN_S s before the tap, what glints counted each time it changes
  let k = 0, glints = 0, glintLast: number | undefined = undefined;
  const leadFrames = Math.round(lead / dt);
  const held = (k: number) => !!pose.dive || (!!pose.nose && k >= leadFrames - 1.5 / dt) || (!!turn && k >= leadFrames - TURN_S / dt);
  for (; k < leadFrames || (pose.dive && f.y - city.groundAt(f.x, f.z) > 800 && k < leadFrames + 8 / dt); k++) {
    await frame(k, held(k));
    if (!turn || k < leadFrames - TURN_S / dt) continue;
    const s = g.aimer.shown(), gi = s ? s.index : -1;
    if (glintLast !== undefined && gi !== glintLast) glints++;
    glintLast = gi;
  }
  // ---- the tap (between frames, as Input's)
  const tap = { x: f.x, y: f.y, z: f.z, t: g.t, speed: f.ground, agl: f.y - city.groundAt(f.x, f.z), nose: f.nose / DEG, fx: f.fx, fz: f.fz };
  const before = city.paint.data.slice();
  const ev0 = g.events.length;
  const res = tier ? bombTap(g, tier) : g.tap();
  const comet = (res.shot as any).comet ?? null;
  const at = new THREE.Vector3(res.landing.x, res.landing.y, res.landing.z);
  const busV = new THREE.Vector3(f.x, f.y, f.z);
  const tapScr = res.fired ? screen(cam, inner, at, busV) : null;
  const loaded = res.fired ? city.terrainAt(at.x, at.z) !== null : false;
  // ---- to the impact, then until the bus passes it
  let impact: any = null, impactScr: Scr | null = null, ahead = NaN, pass: number | null = null, miss = false, refund = -1;
  const maxT = pose.h === 'floor' || (typeof pose.h === 'number' && pose.h < 1000) ? 6 : 30;
  const along = () => (at.x - f.x) * tap.fx + (at.z - f.z) * tap.fz;
  let hiddenBy = -Infinity;
  for (let j = 0; res.fired && g.t - tap.t < maxT; j++, k++) {
    const was = along();
    await frame(k, !!stick || !!turn);
    if (refund < 0 && f.barfT < 0) refund = f.fullness;
    for (let e = ev0; e < g.events.length && !impact; e++) {
      const ev = g.events[e];
      if (ev.ev !== 'impact' && ev.ev !== 'miss') continue;
      impact = ev;
      miss = ev.ev === 'miss';
      const p = ev.pos as number[];
      at.set(p[0], p[1], p[2]);
      busV.set(f.x, f.y, f.z);
      impactScr = screen(cam, inner, at, busV);
      ahead = along();
      // (the ground over the lens's line to it, at the impact: a ridge hiding it)
      const cp = cam.position, D = Math.hypot(at.x - cp.x, at.z - cp.z);
      for (let s = 10; s < D - 10; s += 5) {
        const u = s / D;
        hiddenBy = Math.max(hiddenBy, city.groundAt(cp.x + (at.x - cp.x) * u, cp.z + (at.z - cp.z) * u) - (cp.y + (at.y - cp.y) * u));
      }
    }
    if (impact && pass === null) {
      const now = along();
      if (ahead <= 0) pass = -ahead / Math.max(1, f.ground);
      else if (now <= 0) pass = g.t - (impact.t as number) - (dt * -now) / Math.max(1e-3, was - now);
    }
    // (a Bomb: until its last stage is down, its third 2 x stageGap after the wave reaches the rim)
    if (impact && (pass !== null || g.t - (impact.t as number) > 3) && refund >= 0 && (!tier || g.t - (impact.t as number) > 3.2)) break;
  }
  // ---- what it painted: every building whose level rose, and any that rose two (a Bomb's: by how much, and any not at min(3, before + jump) or past 3)
  const after = city.paint.data;
  const jump = tier === 3 ? config.bomb.jump3 : config.bomb.jump2;
  let painted = 0, two = 0, wrong = 0, past3 = 0;
  const rose = [0, 0, 0, 0];
  for (let i = 1; i < after.length; i += 4) {
    const d = after[i] - before[i];
    if (d > 0.5) painted++;
    if (d > 1.5) two++;
    if (!tier || d < 0.5) continue;
    rose[Math.min(3, Math.round(d))]++;
    if (after[i] > 3) past3++;
    if (after[i] !== Math.min(3, before[i] + jump)) wrong++;
  }
  const hitStops = g.events.slice(ev0).filter((e) => e.ev === 'hitstop').length;
  config.flight.ceiling = ceiling;
  // a Comet's arc (Comet.ts and CometFx.at: the chord, topped by arc 4u(1-u)) against the ground, every 4 m, at its worst
  let underGround = -Infinity;
  if (comet) {
    const L = Math.hypot(comet.x - comet.x0, comet.z - comet.z0);
    for (let s = 4; s < L - 4; s += 4) {
      const u = s / L;
      underGround = Math.max(underGround, city.groundAt(comet.x0 + (comet.x - comet.x0) * u, comet.z0 + (comet.z - comet.z0) * u) - (comet.y0 + (comet.y - comet.y0) * u + comet.arc * 4 * u * (1 - u)));
    }
  }
  return {
    key: `${pose.key}/${rname}`, rung: rname, pose: pose.key, fps: Math.round(1 / dt),
    tap: { agl: r1(tap.agl), speed: r1(tap.speed), nose: r1(tap.nose) },
    kind: !res.fired ? 'refused' : comet ? 'comet' : miss ? 'miss' : 'splat',
    cometMiss: !!comet && miss,
    tImpact: impact ? r3((impact.t as number) - tap.t) : null,
    landing: [r1(at.x), r1(at.y), r1(at.z)],
    from: r1(Math.hypot(at.x - tap.x, at.z - tap.z)),
    ahead: r1(ahead),
    pass: pass === null ? null : r2(pass),
    on: miss ? 'water' : res.wall ? 'wall' : res.target ? 'roof' : 'ground',
    target: res.target ? res.target.index : null,
    tapScreen: tapScr, impactScreen: impactScr,
    radius: impact && !miss ? r1(impact.r as number) : null, wantRadius: r1(blastRadiusFor(Math.max(0, tap.y - at.y))),
    painted, raisedTwo: two, loaded, refund: r2(refund),
    plan: comet ? { reach: r1(comet.reach), ahead: r1(comet.ahead), pass: r2(comet.pass), above: r3(comet.above), arc: r1(comet.arc), arcShare: r3(comet.arc / Math.max(1, Math.hypot(comet.x - comet.x0, comet.z - comet.z0, comet.y - comet.y0))), loaded: comet.loaded } : null,
    off: r1(Math.abs((at.x - tap.x) * tap.fz - (at.z - tap.z) * tap.fx)),
    underGround: comet ? r1(underGround) : null,
    hiddenBy: impact ? r1(hiddenBy) : null,
    glintsPerS: turn ? r2(glints / TURN_S) : null,
    aimMs: r3(aimMs / Math.max(1, aimN)),
    ...(tier ? { bomb: tier, rose: rose.slice(1), wrong, past3, hitStops } : {}),
  };
}

const rows: any[] = [];
const t0 = Date.now();
const OUT = process.env.SB_OUT ?? 'shots/controls/sim';
mkdirSync(OUT, { recursive: true });
if (BOMB) {
  // ---- the Bomb's rows: each pose's tap, then a Bomb II and III let go at the same moment, and their gates alone
  for (const key of ['wa-floor', 'wa-300', 'dt-floor'])
    for (const name of ['nonstop', 'jet', 't3']) {
      const pose = POSES.find((p) => p.pose.key === key)!.pose, rung = RUNGS.find((r) => r[0] === name)!;
      if (ONLY && !`${key}/${name}`.includes(ONLY)) continue;
      for (const dt of [1 / 60, 1 / 30]) for (const tier of [0, 2, 3] as const) rows.push(await run(rung, pose, dt, tier));
    }
  writeFileSync(`${OUT}/shots-bomb.json`, JSON.stringify({ band: r3(BAND), rows }, null, 1));
  const fails: string[] = [];
  let checks = 0;
  const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
  for (const r of rows) {
    const id = `${r.key}@${r.fps}${r.bomb ? ` Bomb ${r.bomb === 3 ? 'III' : 'II'}` : ''}`;
    const t = rows.find((q) => q.key === r.key && q.fps === r.fps && !q.bomb);
    console.log(`${id.padEnd(30)} ${r.kind.padEnd(6)} t ${String(r.tImpact).padStart(6)} at ${JSON.stringify(r.landing)} r ${r.radius} (tap ${t?.radius}) painted ${r.painted} rose ${JSON.stringify(r.rose ?? null)} two ${r.raisedTwo} in ${r.impactScreen?.in ? 'y' : 'n'} up ${r.impactScreen?.above}`);
    // ("none raised two" stays for taps)
    if (!r.bomb) { ok(r.raisedTwo === 0, `${id}: the tap raised none two (${r.raisedTwo})`); continue; }
    const k = r.bomb === 3 ? config.bomb.radius3 : config.bomb.radius2;
    const d = t ? Math.hypot(r.landing[0] - t.landing[0], r.landing[1] - t.landing[1], r.landing[2] - t.landing[2]) : Infinity;
    // (where the tap is the classic shot, at Turbo 3 from 300 m (BUILT.md: no Comet in turbo from about 300 m up, the producer's call), so is the Bomb, with
    // its hit-stop; the Comet's own gates are where the tap's a Comet)
    const comet = t?.kind === 'comet';
    ok(r.kind === t?.kind, `${id}: the tap's shot (${r.kind}, tap ${t?.kind})`);
    ok(d <= 2 && Math.abs((r.tImpact ?? 9) - (t?.tImpact ?? 0)) <= 0.05, `${id}: lands within 2 m and 0.05 s of the tap's ${comet ? 'Comet' : 'shot'} (${r1(d)} m, ${r.tImpact} against ${t?.tImpact} s)`);
    ok(r.radius !== null && t?.radius != null && Math.abs(r.radius - k * t.radius) <= k, `${id}: ${k} times the tap's radius (${r.radius} against ${t?.radius})`);
    ok(r.painted > 0 && r.painted >= (t?.painted ?? Infinity) && r.wrong === 0 && r.past3 === 0, `${id}: as many buildings as the tap or more, each at min(3, before + ${r.bomb === 3 ? config.bomb.jump3 : config.bomb.jump2}), none past 3 (${r.painted} against ${t?.painted}, ${r.wrong} not, ${r.past3} past)`);
    ok(r.rose[1] > 0 && (r.bomb === 3 ? r.rose[2] > 0 && r.rose[0] === 0 : r.rose[2] === 0 && r.rose[0] === 0), `${id}: raised 2${r.bomb === 3 ? ' and 3' : ''} levels, never 1${r.bomb === 3 ? '' : ' or 3'} (${JSON.stringify(r.rose)} raised 1, 2, 3)`);
    if (comet) ok(!!r.impactScreen?.in, `${id}: in frame at the impact (${JSON.stringify(r.impactScreen)})`);
    ok(r.hitStops === (comet ? 0 : 1), `${id}: ${comet ? 'no hit-stop at Comet range' : "the classic shot's hit-stop"} (${r.hitStops})`);
  }
  console.log(`${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(fails.length ? `BOMB FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `bomb checks: all ${checks} passed`);
  process.exit(fails.length ? 1 : 0);
}
for (const { pose, rungs } of POSES)
  for (const name of rungs) {
    const rung = RUNGS.find((r) => r[0] === name)!;
    if (ONLY && !`${pose.key}/${name}`.includes(ONLY)) continue;
    for (const dt of [1 / 60, 1 / 30]) rows.push(await run(rung, pose, dt));
  }
writeFileSync(`${OUT}/shots.json`, JSON.stringify({ band: r3(BAND), rows }, null, 1));
const fmt = (r: any) =>
  `${r.key.padEnd(18)} ${String(r.fps).padStart(2)} ${r.kind.padEnd(6)} t ${String(r.tImpact).padStart(6)} from ${String(r.from).padStart(7)} ahead ${String(r.ahead).padStart(8)} pass ${String(r.pass).padStart(6)} on ${r.on.padEnd(6)} up ${String(r.impactScreen?.above ?? '-').padStart(6)} in ${r.impactScreen?.in ? 'y' : 'n'}${r.impactScreen?.clear ? 'c' : '-'} r ${String(r.radius).padStart(5)} painted ${String(r.painted).padStart(3)} two ${r.raisedTwo} loaded ${r.loaded ? 'y' : 'n'} agl ${r.tap.agl} v ${r.tap.speed} off ${r.off}` +
  (r.plan ? ` arc ${r.plan.arcShare} under ${r.underGround} hid ${r.hiddenBy}` : '') + (r.glintsPerS !== null ? ` glints/s ${r.glintsPerS}` : '');
for (const r of rows) if (r.fps === 60) console.log(fmt(r));
console.log(`${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)} s; the HUD's top band ends at ${r3(BAND)} of the height`);

// ---- the gates
const base: Record<string, any> | null = existsSync(BASE_FILE) ? JSON.parse(readFileSync(BASE_FILE, 'utf8')) : null;
if (SAVE) {
  const keep: Record<string, unknown> = {};
  for (const r of rows) keep[`${r.key}@${r.fps}`] = { kind: r.kind, tImpact: r.tImpact, landing: r.landing, from: r.from, ahead: r.ahead, pass: r.pass, on: r.on, painted: r.painted, radius: r.radius };
  writeFileSync(BASE_FILE, JSON.stringify(keep, null, 0).replace(/\},"/g, '},\n"') + '\n');
  console.log(`baseline saved: ${BASE_FILE}`);
  process.exit(0);
}
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const by = (key: string, fps: number) => rows.find((r) => r.key === key && r.fps === fps);
const basePoses = new Set(Object.keys(base ?? {}).map((k) => k.split('/')[0]));
for (const r of rows) {
  const isComet = COMET_RUNGS.includes(r.rung);
  const gated = isComet && (r.pose === 'wa-floor' || r.pose === 'wa-300' || r.pose === 'dt-floor');
  const v = r.tap.speed;
  if (gated) {
    // (a wall that takes it at the floor, downtown or where Turbo's reach gets there from the Western Addition, at least 0.5 s ahead of the bus at the impact)
    // (at 300 m the bus may not reach it in the run's 6 s: what's ahead of it at the impact says how long it has, 1.3 to 3 s. The review of step 3, 7: a
    // Nonstop Comet 1.26 km ahead, about 5.6 s, passed with no bound)
    const p300 = r.pass ?? r.ahead / Math.max(1, v);
    const passOk = r.on === 'wall' ? r.ahead >= 0.5 * v : r.pose === 'wa-300' ? p300 >= 1.3 && p300 <= 3 : r.pass !== null && r.pass >= 1.3 && r.pass <= 1.7;
    ok(r.kind === 'comet', `${r.key}@${r.fps}: a Comet (${r.kind})`);
    ok(r.tImpact !== null && r.tImpact >= 0.6 && r.tImpact <= 0.8, `${r.key}@${r.fps}: lands 0.6-0.8 s after the tap (${r.tImpact})`);
    ok(passOk, `${r.key}@${r.fps}: passed ${r.pose === 'wa-300' ? '1.3-3' : '1.3-1.7'} s after the impact, or a wall 0.5 s ahead (pass ${r.pass}, ahead ${r.ahead}, on ${r.on})`);
    // (off the bus's line, inside the drops' reach: never a beam out of the bus, the outside look of step 3. A wall's face is where the arc meets it)
    if (r.kind === 'comet' && r.on !== 'wall') ok(r.off >= 12 && r.off <= config.comet.lensReach, `${r.key}@${r.fps}: lands 12-${config.comet.lensReach} m off the bus's line (${r.off})`);
    ok(r.from <= config.city.loadRadiusHigh + 1, `${r.key}@${r.fps}: within ${config.city.loadRadiusHigh} m of the tap (${r.from})`);
    ok(!!r.impactScreen && r.impactScreen.above >= 0.05 && r.impactScreen.clear, `${r.key}@${r.fps}: at the impact 5 % or more above the bus, clear of the HUD band (${JSON.stringify(r.impactScreen)})`);
    ok(r.painted >= 20 && r.raisedTwo === 0, `${r.key}@${r.fps}: 20 or more buildings, none raised two (${r.painted}, ${r.raisedTwo})`);
    ok(r.radius !== null && Math.abs(r.radius - r.wantRadius) <= 1, `${r.key}@${r.fps}: its radius blastRadiusFor(drop) (${r.radius} against ${r.wantRadius})`);
  }
  if (isComet && r.pose === 'water-floor') ok(r.kind === 'comet' && r.cometMiss && r.refund >= config.splat.missRefund - 0.02 && r.refund < 0.9, `${r.key}@${r.fps}: over water a Comet's miss, with its refund (${r.kind}, miss ${r.cometMiss}, belly after ${r.refund})`);
  if (isComet && r.pose === 'wa-dive45') ok(r.kind === 'comet' && r.ahead > 0 && !!r.impactScreen?.in, `${r.key}@${r.fps}: the dive's tap is a Comet, ahead and in frame (${r.kind}, ahead ${r.ahead}, ${JSON.stringify(r.impactScreen)})`);
  // (steering: what glints changes about once a stretch, 1 / (2 x config.comet.hold) a second, and where the margin moves it on as the bus comes up to it
  // a little more: today's aim's rate at these gears, 3.7-10, where the review of step 3, 3, had 16-26)
  if (isComet && r.pose === 'wa-turn') ok(r.kind === 'comet' && r.glintsPerS !== null && r.glintsPerS <= 7, `${r.key}@${r.fps}: steering, a Comet, what glints changing 7 times a second or less (${r.kind}, ${r.glintsPerS})`);
  // (the hills: its arc never into the ground, the review of step 3, 5)
  if (isComet && (r.pose === 'glen-floor' || r.pose === 'bayview-floor')) ok(r.kind === 'comet' && r.underGround !== null && r.underGround <= 2, `${r.key}@${r.fps}: over the hills a Comet, its arc never 2 m or more into the ground (${r.kind}, ${r.underGround})`);
  // (the poses the baseline has: the turn and the hills came after it)
  if (base && r.kind !== 'comet' && basePoses.has(r.pose)) {
    const b = base[`${r.key}@${r.fps}`];
    const d = b ? Math.hypot(r.landing[0] - b.landing[0], r.landing[1] - b.landing[1], r.landing[2] - b.landing[2]) : Infinity;
    ok(!!b && b.kind === r.kind && d <= 0.5 && Math.abs((r.tImpact ?? 0) - (b.tImpact ?? 0)) <= 0.02, `${r.key}@${r.fps}: no Comet, so the baseline's shot (${r.kind} at ${JSON.stringify(r.landing)}, ${r.tImpact} s; baseline ${JSON.stringify(b ? [b.kind, b.landing, b.tImpact] : null)})`);
  }
  if (base && (r.rung === 'zone' || r.rung === 'cruise' || r.rung === 'express')) ok(r.kind !== 'comet', `${r.key}@${r.fps}: School Zone, Cruise and Express never fire a Comet`);
  // (the classic shot from far up lands apart at 30 and 60 fps already: the aim's march is metres long out there. The gate is the Comet's)
  // (steering integrates at the frame's step, so the turn's rows fly apart at 30 and 60 fps before they tap: not gated)
  const s30 = r.fps === 60 && r.pose !== 'wa-turn' ? by(r.key, 30) : null;
  if (s30 && (r.kind === 'comet' || s30.kind === 'comet')) {
    const s = s30;
    if (s) ok(s.kind === r.kind && Math.hypot(s.landing[0] - r.landing[0], s.landing[1] - r.landing[1], s.landing[2] - r.landing[2]) <= 2 && Math.abs((s.tImpact ?? 0) - (r.tImpact ?? 0)) <= 0.05, `${r.key}: 30 and 60 fps within 2 m and 0.05 s (${JSON.stringify([r.kind, r.landing, r.tImpact])} against ${JSON.stringify([s.kind, s.landing, s.tImpact])})`);
  }
}
if (!base) console.log('no baseline file: nothing gated');
console.log(fails.length ? `FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `shots checks: all ${checks} passed`);
process.exit(fails.length ? 1 : 0);
