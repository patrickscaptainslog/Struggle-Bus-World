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
// --lob flies the Lob's rows instead (src/game/Lob.ts), into shots-lob.json, and gates only them: the nose 30 and 75 degrees up from 300 m and 40 from the
// roofs, the stick held through the tap (a second thumb's tap, the body read live) and let go 0.3 s after it, at every rung from Cruise to Turbo 3. At Cruise and Express each is a
// Lob, at Nonstop and faster a Lob wherever one is planned; a Lob lands in frame config.lob.above or more over the bus at the impact (a far one, from 1 km up, has no such rule), on its flight's time, within 2 m and 0.05 s at 30
// and 60 fps, a level each and lobRadius (its fall from the arc's top, at most config.lob.radius), with no hit-stop. Where a Comet applies too, the Lob wins whenever it's planned (config.lob.wins, chooseShot). Without --lob a row the Lob
// throws (kind 'lob') is the Lob's, not the baseline's.
import { newCity, pump, ll, makeGame } from '../feel-sim/lib';
import { config } from '@src/config';
import { CameraRig, shotTip } from '@src/game/CameraRig';
import { shotReach } from '@src/game/Comet';
import { cometAt } from '@src/fx/CometFx';
import { EXPRESS, JET, NONSTOP, SCHOOL_ZONE, TurboDrive, driveSpeed } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
import { lensFov } from '@src/render/PixelPipeline';
import { layoutHud } from '@src/ui/hudLayout';
import { blastRadiusFor } from '@src/game/blastLayout';
import { Bomb } from '@src/game/Bomb';
import { tapOpts } from '@src/game/Aim';
import { lobRadius } from '@src/game/Lob';
import * as THREE from 'three';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const SAVE = args.includes('--save-baseline');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7) ?? '';
const BOMB = args.includes('--bomb');
const LOB = args.includes('--lob');
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
interface Pose { key: string; place: Place; h: number | 'floor'; asl?: boolean; nose?: number; dive?: number; turn?: number; release?: number }
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
  // (the Comet from high up, DESIGN "the Comet dead ahead": climbed there, the lens as a climb leaves it; level, and in dives tapped as they pass the height)
  { pose: { key: 'wa-c1000', place: 'wa', h: 1000 }, rungs: COMET_RUNGS },
  { pose: { key: 'wa-c5000', place: 'wa', h: 5000 }, rungs: COMET_RUNGS },
  { pose: { key: 'wa-c14000', place: 'wa', h: 14000 }, rungs: COMET_RUNGS },
  { pose: { key: 'wa-d45-1000', place: 'wa', h: 1000, dive: 45 }, rungs: COMET_RUNGS },
  { pose: { key: 'wa-d45-5000', place: 'wa', h: 5000, dive: 45 }, rungs: COMET_RUNGS },
  { pose: { key: 'wa-d60-14000', place: 'wa', h: 14000, dive: 60 }, rungs: COMET_RUNGS },
];
/** 4f33648's Turbo 3 Comet at the floor (its shots.json): how far ahead of the bus it landed at the impact and when the bus passed it, at 60 and 30 fps */
const T3_FLOOR: Record<string, { ahead: number; pass: number }> = {
  'wa-floor/t3@60': { ahead: 1107, pass: 1.31 }, 'wa-floor/t3@30': { ahead: 1109, pass: 1.32 },
  'dt-floor/t3@60': { ahead: 1200, pass: 1.42 }, 'dt-floor/t3@30': { ahead: 1202.1, pass: 1.42 },
};
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
    // (a dive from 14 km starts under the ceiling)
    if (pose.dive) f.y = Math.min(f.y, config.flight.ceiling - 20);
    f.holdY = f.y;
  }
  if (gear === EXPRESS) drive.rung(1, f);
  else if (gear > 0) drive.arrive(gear, level);
  if (gear < 0) drive.rung(-1, f);
  await pump(city, f.x, f.z, Math.max(0, f.y - g0), fx, fz);
  const rig = new CameraRig(), lens = new TurboLens(), cam = new THREE.PerspectiveCamera(50, SW / SH, 1, 60000), focus = new THREE.Vector3();
  const inner = { x: 1, y: 1 };
  // (P1: a placed pose at a height has the lens a climb there leaves, its vista and height; the floor's lens put the probe's Turbo 3 at 300 m on no Comet
  // where a climbed player's lens gives one. The classic aim reads no lens)
  if (typeof pose.h === 'number') rig.settleAt(Math.max(0, f.y - city.groundAt(f.x, f.z)));
  let pre: (() => void) | null = null;
  const cometOf = (g.aimer as any).comet;
  if (cometOf) cometOf.lens = cam;
  if (g.aimer.lob) g.aimer.lob.lens = cam;
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
    pre?.();
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
  let k = 0, glints = 0, farFrames = 0, glintLast: number | undefined = undefined;
  const leadFrames = Math.round(lead / dt);
  const held = (k: number) => !!pose.dive || (!!pose.nose && k >= leadFrames - 1.5 / dt) || (!!turn && k >= leadFrames - TURN_S / dt);
  const diveTo = typeof pose.h === 'number' ? pose.h : 800;
  for (; k < leadFrames || (pose.dive && f.y - city.groundAt(f.x, f.z) > diveTo && k < leadFrames + 8 / dt); k++) {
    await frame(k, held(k));
    if (!turn || k < leadFrames - TURN_S / dt) continue;
    const s = g.aimer.shown(), gi = s ? s.index : -1;
    if (g.aimer.planned?.far) farFrames++;
    if (glintLast !== undefined && gi !== glintLast) glints++;
    glintLast = gi;
  }
  // ---- the tap (between frames, as Input's)
  const tap = { x: f.x, y: f.y, z: f.z, t: g.t, speed: f.ground, agl: f.y - city.groundAt(f.x, f.z), nose: f.nose / DEG, fx: f.fx, fz: f.fz, body: f.pitch / DEG, vista: rig.vista };
  const before = city.paint.data.slice();
  const ev0 = g.events.length;
  // (--lob: whether this frame planned a Lob, which wins over the Comet whenever it's planned: config.lob.wins)
  const lobPlanned = !!g.aimer.lobLast;
  // (the reach and the flight a Comet has by DESIGN C2, C4 and C6, from the tap's own numbers)
  const vTap = Math.max(1, f.ground), edgeTap = shotReach(city, f, f.fx, f.fz), reachTap = Math.max(config.comet.reach, edgeTap);
  const lowReach = Math.min(config.comet.flight, Math.max(config.comet.flightMin, cometOf.timeTo(vTap, reachTap) - config.comet.pass - config.splat.inhale));
  // (where the reach cut it, as long as still lands `pass` s ahead of where its stretch comes down: the stretch held, read before the tap fires it)
  const heldAlong = cometOf ? (cometOf.heldX - f.x) * f.fx + (cometOf.heldZ - f.z) * f.fz : 0;
  const low = lowReach < config.comet.flight ? Math.min(lowReach, Math.max(config.comet.flightMin, cometOf.timeTo(vTap, heldAlong) - config.comet.pass - config.splat.inhale)) : lowReach;
  const gReach = city.groundAt(f.x + f.fx * edgeTap, f.z + f.fz * edgeTap);
  const highFlight = Math.min(config.comet.flightHigh, lowReach + (config.comet.fallPerKm * Math.max(0, f.y - gReach - 1000)) / 1000);
  const own = tier ? { ...g.aimer.ownAim } : null;
  const res = tier ? bombTap(g, tier) : g.tap();
  const comet = (res.shot as any).comet ?? null;
  // (after a far one the view dips as main.ts dips it, shotTip with the lead and the star kept in the frame, until config.shotView.hold after the impact)
  const upDeg = (x: number, y: number, z: number) => {
    v3.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    return (Math.atan2(v3.y, -v3.z) * 180) / Math.PI + rig.skyLift;
  };
  const ndcY = (x: number, y: number, z: number) => {
    v3.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    return v3.z >= 0 ? -9 : v3.applyMatrix4(cam.projectionMatrix).y;
  };
  const liftAtTap = rig.skyLift, until = comet?.far ? g.t + config.splat.inhale + comet.travel + config.shotView.hold : -1;
  let boundNow = false;
  if (comet?.far && comet.kind !== 'lob')
    pre = () => {
      if (g.t < until) {
        const half = cam.fov / 2, ld = config.shotView.lead, landUp = upDeg(comet.x - f.fx * f.ground * ld, comet.y - f.vy * ld, comet.z - f.fz * f.ground * ld);
        const t0 = tap.t + config.splat.inhale, u = (g.t - t0) / comet.travel, top = comet.arc > 0 ? Math.min(1, Math.max(0, 0.5 + (comet.y - comet.y0) / (8 * comet.arc))) : 0;
        const arcUp = (w: number) => { const q = cometAt(from0, to0, comet.arc, comet.bow ?? 0, w, v3b); return upDeg(q.x, q.y, q.z); };
        const fly = u >= 0 && u < 1 ? Math.max(arcUp(u), arcUp(Math.max(u, top))) : NaN;
        rig.skyLiftTarget = shotTip(landUp, upDeg(f.x, f.y, f.z), half, false, true, liftAtTap, 0, fly);
        // (bound: where the bus's limit, the swing or the climbing star holds the view over what the hit wants)
        boundNow = rig.skyLiftTarget > landUp - Math.atan(config.shotView.low * Math.tan(half * DEG)) / DEG + 0.5;
        rig.skyLiftRate = config.shotView.rate;
        rig.skyDipMost = config.shotView.most;
      } else if (rig.skyDipMost > 0) {
        if (rig.skyLift >= -0.02) rig.skyDipMost = 0;
        rig.skyLiftTarget = 0;
        rig.skyLiftRate = config.shotView.rate;
      }
    };
  const from0 = new THREE.Vector3(comet?.x0 ?? 0, comet?.y0 ?? 0, comet?.z0 ?? 0), to0 = new THREE.Vector3(comet?.x ?? 0, comet?.y ?? 0, comet?.z ?? 0), v3b = new THREE.Vector3();
  let bowPx: number | null = null, busHi = -9, hitNdc: number | null = null, boundImp = false, liftImp = 0, busImp = 0, liftLo = 0;
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
    // (--lob's poses let the stick go `release` s after the tap: the base's hold it to the end)
    await frame(k, !!turn || (!!stick && !(pose.release !== undefined && g.t - tap.t > pose.release)));
    if (refund < 0 && f.barfT < 0) refund = f.fullness;
    if (comet && comet.kind !== 'lob') {
      // (the bow: at its flight's middle, how far its star stands on the screen from where it would without it, in game px)
      const u = (g.t - tap.t - config.splat.inhale) / comet.travel;
      if (bowPx === null && u >= 0.5) {
        const a = cometAt(from0, to0, comet.arc, comet.bow ?? 0, 0.5, new THREE.Vector3()), b = cometAt(from0, to0, comet.arc, 0, 0.5, new THREE.Vector3());
        const sa = screen(cam, inner, a, a), sb = screen(cam, inner, b, b);
        bowPx = r1(Math.hypot((sa.x - sb.x) * SW, (sa.y - sb.y) * SH));
      }
      if (!impact || g.t - (impact.t as number) <= config.shotView.hold) busHi = Math.max(busHi, ndcY(f.x, f.y, f.z));
      liftLo = Math.min(liftLo, rig.skyLift);
    }
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
      hitNdc = r3(ndcY(at.x, at.y, at.z));
      busImp = ndcY(f.x, f.y, f.z);
      liftImp = rig.skyLift;
      boundImp = boundNow;
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
    if (impact && (pass !== null || g.t - (impact.t as number) > 3) && refund >= 0 && (!tier || g.t - (impact.t as number) > 3.2) && g.t - (impact.t as number) > (comet?.far ? config.shotView.hold : 0)) break;
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
    tap: { agl: r1(tap.agl), speed: r1(tap.speed), nose: r1(tap.nose), vista: r2(tap.vista) },
    kind: !res.fired ? 'refused' : comet?.kind === 'lob' ? 'lob' : comet ? 'comet' : miss ? 'miss' : 'splat',
    cometMiss: !!comet && miss,
    tImpact: impact ? r3((impact.t as number) - tap.t) : null,
    landing: [r1(at.x), r1(at.y), r1(at.z)],
    from: r1(Math.hypot(at.x - tap.x, at.z - tap.z)),
    ahead: r1(ahead),
    pass: pass === null ? null : r2(pass),
    on: miss ? 'water' : res.wall ? 'wall' : res.target ? 'roof' : 'ground',
    target: res.target ? res.target.index : null,
    tapScreen: tapScr, impactScreen: impactScr,
    radius: impact && !miss ? r1(impact.r as number) : null, wantRadius: r1(comet?.kind === 'lob' ? lobRadius(comet) : blastRadiusFor(Math.max(0, tap.y - at.y))),
    painted, raisedTwo: two, loaded, refund: r2(refund),
    plan: comet ? { reach: r1(comet.reach), ahead: r1(comet.ahead), pass: r2(comet.pass), above: r3(comet.above), arc: r1(comet.arc), arcShare: r3(comet.arc / Math.max(1, Math.hypot(comet.x - comet.x0, comet.z - comet.z0, comet.y - comet.y0))), loaded: comet.loaded } : null,
    off: r1(Math.abs((at.x - tap.x) * tap.fz - (at.z - tap.z) * tap.fx)),
    far: !!comet?.far, travel: comet ? r3(comet.travel) : null, wantTravel: comet ? r3(comet.far ? highFlight : low) : null, reachTap: r1(reachTap),
    bowPx, hitNdc, busHi: comet && comet.kind !== 'lob' ? r3(busHi) : null, busImp: r3(busImp), liftImp: r2(liftImp), liftLo: r2(liftLo), boundImp,
    ...(own ? { own: [r1(own.x), r1(own.z)] } : {}),
    underGround: comet ? r1(underGround) : null,
    hiddenBy: impact ? r1(hiddenBy) : null,
    glintsPerS: turn ? r2(glints / TURN_S) : null, farFrames: turn ? farFrames : null,
    aimMs: r3(aimMs / Math.max(1, aimN)),
    ...(tier ? { bomb: tier, rose: rose.slice(1), wrong, past3, hitStops } : {}),
    ...(LOB ? { lobPlanned, body: r1(tap.body), hitStops, planTravel: comet ? r3(config.splat.inhale + comet.travel) : null, angle: comet?.angle !== undefined ? r1(comet.angle / DEG) : null, ...(comet?.far ? { far: true } : {}) } : {}),
  };
}

const rows: any[] = [];
const t0 = Date.now();
const OUT = process.env.SB_OUT ?? 'shots/controls/sim';
mkdirSync(OUT, { recursive: true });
if (BOMB) {
  // ---- the Bomb's rows: each pose's tap, then a Bomb II and III let go at the same moment, and their gates alone
  // (and from 5 km at Nonstop and Turbo 3, where the tap is the far Comet: the Bomb never takes it, it's the classic tap's, as before. DESIGN C13)
  for (const key of ['wa-floor', 'wa-300', 'dt-floor', 'wa-c5000'])
    for (const name of key === 'wa-c5000' ? ['nonstop', 't3'] : ['nonstop', 'jet', 't3']) {
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
    if (t?.far) {
      // (the tap a far Comet: the Bomb the aim's own shot, on the landing the aim had under it, its radius a tap's from there, with its hit-stop)
      const dOwn = r.own ? Math.hypot(r.landing[0] - r.own[0], r.landing[2] - r.own[1]) : Infinity;
      // (the classic shot lands on the building glinting by the aim's own point, not on the point: within a tap's circle of it)
      ok(r.kind === 'splat' && dOwn <= r.wantRadius / k, `${id}: never the far Comet, the aim's own shot (${r.kind}, ${r1(dOwn)} m from the aim's own landing)`);
      ok(r.radius !== null && Math.abs(r.radius - k * r.wantRadius) <= k, `${id}: ${k} times a tap's radius from there (${r.radius} against ${r.wantRadius})`);
      ok(r.painted > 0 && r.wrong === 0 && r.past3 === 0 && r.hitStops === 1, `${id}: its buildings each at min(3, before + jump), none past 3, the classic shot's hit-stop (${r.painted}, ${r.wrong} not, ${r.past3} past, ${r.hitStops} hit-stops)`);
      continue;
    }
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
if (LOB) {
  // ---- the Lob's rows: the nose up, the stick held through the tap, every rung from Cruise up, and their gates alone
  // (the stick let go 0.3 s after the tap, a second thumb's tap: held on to the impact, a climb at Nonstop took the landing under the bus on the screen)
  const poses: Pose[] = [{ ...POSES.find((p) => p.pose.key === 'wa-nose30')!.pose, release: 0.3 }, { ...POSES.find((p) => p.pose.key === 'wa-nose75')!.pose, release: 0.3 }, { key: 'wa-floor-nose40', place: 'wa', h: 'floor', nose: 40, release: 0.3 }];
  for (const pose of poses)
    for (const name of ['cruise', 'express', 'nonstop', 'jet', 't3']) {
      if (ONLY && !`${pose.key}/${name}`.includes(ONLY)) continue;
      const rung = RUNGS.find((r) => r[0] === name)!;
      for (const dt of [1 / 60, 1 / 30]) rows.push(await run(rung, pose, dt));
    }
  writeFileSync(`${OUT}/shots-lob.json`, JSON.stringify({ band: r3(BAND), rows }, null, 1));
  const fails: string[] = [];
  let checks = 0;
  const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
  for (const r of rows) {
    const id = `${r.key}@${r.fps}`;
    console.log(`${id.padEnd(30)} ${r.kind.padEnd(6)} body ${String(r.body).padStart(5)} at ${String(r.angle).padStart(5)} t ${String(r.tImpact).padStart(6)} (${r.planTravel}) from ${String(r.from).padStart(7)} up ${String(r.impactScreen?.above ?? '-').padStart(6)} in ${r.impactScreen?.in ? 'y' : 'n'} r ${r.radius} (${r.wantRadius}) painted ${r.painted} two ${r.raisedTwo} on ${r.on} agl ${r.tap.agl}`);
    if (r.rung === 'cruise' || r.rung === 'express') ok(r.body < config.lob.from || r.kind === 'lob', `${id}: the body ${r.body} up at Cruise and Express, a Lob (${r.kind})`);
    // (Nonstop and faster: the Lob wherever one is planned, else the Comet's or the tap's: config.lob.wins, chooseShot. Turbo 3 nose 75 from 300 m is 1.4 km
    // up by the tap, where the near search finds nothing: the far Lob)
    if (r.rung !== 'cruise' && r.rung !== 'express') ok(config.lob.wins ? r.kind === 'lob' || !r.lobPlanned : r.rung === 'nonstop' || r.kind !== 'lob', `${id}: at Nonstop and faster a Lob where one is planned (${r.kind}, planned ${r.lobPlanned})`);
    if (r.kind !== 'lob') continue;
    ok(Math.abs(r.angle - Math.min(config.lob.most, r.body)) <= 0.15, `${id}: thrown at the body, at most ${config.lob.most} (${r.angle} for ${r.body})`);
    ok(r.tImpact !== null && Math.abs(r.tImpact - r.planTravel) <= 0.05, `${id}: lands on its flight's time (${r.tImpact} against ${r.planTravel})`);
    // (a far one has no in-view rule, only from config.lob.highFrom up (highBack once a pull has one); the view dips after it, s_lob --high's to gate)
    if (r.far) ok(r.tap.agl >= config.lob.highBack, `${id}: a far Lob, from high up (${r.tap.agl} m over the ground)`);
    else ok(!!r.impactScreen?.in && r.impactScreen.above >= config.lob.above, `${id}: in frame at the impact, ${config.lob.above * 100} % or more over the bus (${JSON.stringify(r.impactScreen)})`);
    ok(r.radius !== null && Math.abs(r.radius - r.wantRadius) <= 1, `${id}: its radius its fall's from the arc's top, lobRadius (${r.radius} against ${r.wantRadius})`);
    ok(r.raisedTwo === 0 && r.hitStops === 0, `${id}: a level each and no hit-stop (${r.raisedTwo} raised two, ${r.hitStops} hit-stops)`);
    const s30 = r.fps === 60 ? rows.find((q) => q.key === r.key && q.fps === 30) : null;
    if (s30) ok(s30.kind === r.kind && Math.hypot(s30.landing[0] - r.landing[0], s30.landing[1] - r.landing[1], s30.landing[2] - r.landing[2]) <= 2 && Math.abs((s30.tImpact ?? 0) - (r.tImpact ?? 0)) <= 0.05, `${r.key}: 30 and 60 fps within 2 m and 0.05 s (${JSON.stringify([r.kind, r.landing, r.tImpact])} against ${JSON.stringify([s30.kind, s30.landing, s30.tImpact])})`);
  }
  console.log(`${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(fails.length ? `LOB FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `lob checks: all ${checks} passed`);
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
  const id = `${r.key}@${r.fps}`, v = r.tap.speed;
  // (Nonstop and faster: a Comet in every pose, never the classic shot (DESIGN "the Comet dead ahead": low where something in view takes it, else far, on
  // the loaded edge). Not over the water (its miss, below), nor a nose-up pose's Lob (s_shots --lob's), nor past 15 km: off the city's map nothing is
  // loaded on the page, and Node loads every tile, so there it says nothing)
  const gated = isComet && r.kind !== 'lob' && r.pose !== 'water-floor' && r.pose !== 'wa-16km';
  if (gated) {
    ok(r.kind === 'comet', `${id}: a Comet, never the classic shot (${r.kind})`);
    if (r.kind !== 'comet') continue;
    // (on the bus's line: "I want this shot to soar essentially directly in front of me", sidePick and a tap's landInset. A wall's face is where the arc meets it)
    if (r.on !== 'wall' && r.pose !== 'wa-turn') ok(r.off <= config.comet.sidePick + config.splat.landInset + 4, `${id}: on the bus's line, ${config.comet.sidePick + config.splat.landInset + 4} m or less off it (${r.off})`);
    // (its flight: C2's low, as long as the reach allows, 0.6-1.0 s; C6's far, longer from high up; the impact on its frame)
    ok(r.travel !== null && Math.abs(r.travel - r.wantTravel) <= 0.02, `${id}: its flight ${r.far ? 'the far one\'s' : 'as long as the reach allows'} (${r.travel} against ${r.wantTravel} s)`);
    ok(r.tImpact !== null && Math.abs(r.tImpact - (config.splat.inhale + r.travel)) <= 0.05, `${id}: lands on its flight's time (${r.tImpact} against ${r1(config.splat.inhale + r.travel)})`);
    ok(r.from <= r.reachTap + 1, `${id}: within the reach of the tap, shotReach (${r.from} against ${r.reachTap})`);
    ok(r.plan && r.plan.arcShare >= config.comet.arcMin - 0.002, `${id}: its arc's top ${config.comet.arcMin} of its chord or more (${r.plan?.arcShare})`);
    // (the bow, read on the screen at its flight's middle: from behind, an arc in the plane through the lens draws as a straight line)
    if (!r.far) ok(r.bowPx !== null && r.bowPx >= 6 && r.bowPx <= 20, `${id}: at its flight's middle its star 6-20 game px to the side (${r.bowPx})`);
    const low = r.pose.endsWith('-floor') || r.pose === 'wa-300' || r.pose === 'wa-turn';
    if (low && r.pose !== 'wa-turn') {
      // (the pass, the margin's: where the bus will be 1.5 s after the impact, moved out to show 3 % over the bus; at 300 m the bus may not reach it in the
      // run's 6 s, and what's ahead of it at the impact says how long it has. A wall that takes it, at least 0.5 s ahead of the bus at the impact)
      const pr = r.pass ?? r.ahead / Math.max(1, v), [lo, hi] = r.rung === 'nonstop' ? [1.3, 3] : [0.8, 2.2];
      ok(!r.far, `${id}: near the roofs a low Comet, never the far one`);
      ok(r.on === 'wall' ? r.ahead >= 0.5 * v : pr >= lo && pr <= hi, `${id}: passed ${lo}-${hi} s after the impact, or a wall 0.5 s ahead (pass ${r.pass}, ahead ${r.ahead}, on ${r.on})`);
      const b = T3_FLOOR[id];
      if (b) ok(Math.abs(r.ahead - b.ahead) <= 0.05 * b.ahead && r.pass !== null && Math.abs(r.pass - b.pass) <= 0.05 * b.pass, `${id}: Turbo 3 at the floor lands as far ahead as 4f33648's, within 5 % (ahead ${r.ahead}, pass ${r.pass}; then ${b.ahead}, ${b.pass})`);
      // (on a tower's face downtown: Nonstop's there paints 10, fewer on a wall is the producer's call, not the probe's: BUILT.md's open call)
      if (r.pose === 'wa-floor' || r.pose === 'dt-floor' || r.pose === 'wa-300') ok(r.painted >= 20 && r.raisedTwo === 0, `${id}: 20 or more buildings, none raised two (${r.painted}, ${r.raisedTwo})`);
    }
    // (steering, the bus turns on through the flight and the line with it: the turn's rows are its glints' alone, as before)
    if (!r.far && r.pose !== 'wa-turn') {
      ok(!!r.impactScreen && r.impactScreen.above >= config.comet.above && r.impactScreen.clear, `${id}: at the impact ${config.comet.above * 100} % or more above the bus, clear of the HUD band (${JSON.stringify(r.impactScreen)})`);
      ok(!!r.impactScreen && Math.abs(r.impactScreen.x - 0.5) <= 0.25, `${id}: straight ahead, its screen x within 0.25 of the middle at the impact (${r.impactScreen?.x})`);
      ok(r.liftLo >= 0, `${id}: a low one, the view never dips (lift down to ${r.liftLo})`);
    } else if (r.far) {
      // (far: the view dips toward the hit, the bus held at config.shotView.busMax; from 5 km and under the hit at -0.25 or higher where no limit binds)
      // (the dip's target holds the bus at busMax; eased, a steep dive at 30 fps carries it a little past: the page's bound, as controls-lob-high has it)
      ok(r.busHi !== null && r.busHi <= 0.35, `${id}: the bus at +0.35 or lower every frame to ${config.shotView.hold} s after the hit (${r.busHi}; the dip's target ${config.shotView.busMax})`);
      const bound = r.boundImp || r.busImp >= config.shotView.busMax - 0.02 || r.liftImp <= -(Math.min(config.shotView.swing, config.shotView.most) - 0.5);
      if (r.tap.agl <= 5200 && !bound) ok(r.hitNdc !== null && r.hitNdc >= -0.25, `${id}: far, the hit at -0.25 or higher by the dipped view (${r.hitNdc})`);
      ok(r.loaded, `${id}: far, on loaded ground (${r.loaded})`);
    }
    ok(r.radius !== null && Math.abs(r.radius - r.wantRadius) <= 1, `${id}: its radius blastRadiusFor(drop) (${r.radius} against ${r.wantRadius})`);
  }
  if (isComet && r.pose === 'water-floor') ok(r.kind === 'comet' && r.cometMiss && r.refund >= config.splat.missRefund - 0.02 && r.refund < 0.9, `${id}: over water a Comet's miss, with its refund (${r.kind}, miss ${r.cometMiss}, belly after ${r.refund})`);
  if (isComet && r.pose === 'wa-dive45') ok(r.kind === 'comet' && r.ahead > 0 && !!r.impactScreen?.in, `${id}: the dive's tap is a Comet, ahead and in frame (${r.kind}, ahead ${r.ahead}, ${JSON.stringify(r.impactScreen)})`);
  // (steering: what glints changes about once a stretch, 1 / (2 x config.comet.hold) a second, and where the margin moves it on as the bus comes up to it
  // a little more: today's aim's rate at these gears, 3.7-10, where the review of step 3, 3, had 16-26)
  if (isComet && r.pose === 'wa-turn') ok(r.kind === 'comet' && r.glintsPerS !== null && r.glintsPerS <= 7, `${id}: steering, a Comet, what glints changing 7 times a second or less (${r.kind}, ${r.glintsPerS})`);
  // (the hills: its arc never into the ground, the review of step 3, 5; and from high up, its plunge)
  if (isComet && r.kind === 'comet' && (r.pose === 'glen-floor' || r.pose === 'bayview-floor' || r.far)) ok(r.underGround !== null && r.underGround <= 2, `${id}: its arc never 2 m or more into the ground (${r.underGround})`);
  // (the poses the baseline has: the turn and the hills came after it)
  // (a Lob's row, the body past config.lob.from, is the Lob's: s_shots.ts --lob gates it)
  if (base && r.kind !== 'comet' && r.kind !== 'lob' && basePoses.has(r.pose)) {
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
