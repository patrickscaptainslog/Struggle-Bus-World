// The Lob on the real city (src/game/Lob.ts; docs/specs/shots/SHOTS.md, "The modes"; sb-checks' lob plan): a pull held, then a tap, through the real
// Flight, TurboDrive, TurboLens, CameraRig, Aimer, Comet, Lob and Splatter, at 1/60 and 1/30 s, the lens projecting as the page's at 393 x 852 (lensFov).
// One thumb: the steering thumb lifts, a finger lands 0.1 s later and lifts 1/15 s after that, the tap; two thumbs: the steering thumb still pulling, a
// second one taps (whole frames at 30 and 60 fps, so both tap at the same game time). Every row starts on paint at level 0, so a building a tap raised two shows.
// Lobs at Cruise, Express and Nonstop (where the Comet applies too: the farther of the two) over the Western Addition from the roofs and from 300 m, and downtown and over Glen Park's hills: each a Lob, at the
// body as it was when the steering thumb lifted (one thumb) or at the tap (two), clamped to config.lob.most; 30 and 60 fps within 2 m and 0.05 s; at the
// impact in frame and config.comet.above of the height over the bus; its radius lobRadius (its fall from the arc's top, at most config.lob.radius), every building it reached a level, none two; no
// hit-stop; its arc never 2 m into the ground.
// None: from a flick's stroke, in School Zone, out of a dive, under the Golden Gate, from 1.5 km up, at Jet. Over the bay from Fort Mason: a Lob's miss, with
// its refund. A Bomb let go after a pull lands where it would with no Lob at all (the slot off). And the aim's cost a frame while it plans the Lob.
// After the review (sb-checks' lob fixes): a one-thumb tap lifted 0.53 s after the steering thumb (late: the press runs the latch on) and one that slides
// past the tap slop (slid: it commits as a steering thumb, lifted inside quickTapMs), each a Lob at the body as the steering thumb lifted; a tower in the climb
// (the Financial District's, toward Salesforce Tower) takes it on its face; at Cruise and Express, once the Lob shows in a pull it stays; and every building
// whose middle is within 0.8 of its circle takes a level, up to the blast's cap.
// --street (the Lob's merge with feat/shots): only Curb's street, aimer.street set as main.ts sets it while Curb rolls, a pull and a tap there nose up at
// Cruise and Express, one thumb and two: never a Lob, no plan in the pull, nothing planned (Curb's street front is the tap's, before the Lob's slot).
//   node tools/feel-sim/run.mjs s_lob.ts [--only=<substring>] [--street]
// Results in SB_OUT (shots/feel/sim)/lob.json, a table on stdout; exit 1 when a check fails.
import { newCity, pump, ll, makeGame, config, manifest, type Game } from './lib';
import { CameraRig } from '@src/game/CameraRig';
import { EXPRESS, JET, NONSTOP, SCHOOL_ZONE, TurboDrive, driveSpeed } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
import { lensFov } from '@src/render/PixelPipeline';
import { blastCap, blastRadiusFor } from '@src/game/blastLayout';
import { Bomb } from '@src/game/Bomb';
import { tapOpts } from '@src/game/Aim';
import { lobRadius } from '@src/game/Lob';
import { makeGoldenGate, bridgeObstacles, paintBridge } from '@src/world/Bridges';
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7) ?? '';
const STREET = args.includes('--street');
const city = await newCity();
const DEG = Math.PI / 180;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** The mean of xs but its slowest share. */
const trimmedMean = (xs: number[], share: number) => {
  const s = [...xs].sort((a, b) => a - b), n = Math.max(1, s.length - Math.floor(s.length * share));
  return s.slice(0, n).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(n, s.length));
};
const SW = 393, SH = 852;

const PLACES = {
  wa: { lat: 37.7763, lon: -122.4352, hdg: 88 },
  dt: { lat: 37.7752, lon: -122.4193, hdg: 45 },
  water: { lat: 37.8065, lon: -122.43, hdg: 0 },
  glen: { lat: 37.733, lon: -122.44, hdg: 300 },
  fidi: { lat: 37.795, lon: -122.395, hdg: 225 },
  gg: { lat: 0, lon: 0, hdg: 0 },
} as const;
type Place = keyof typeof PLACES;
const RUNGS: Record<string, [number, number]> = { zone: [-1, 0], cruise: [0, 0], express: [EXPRESS, 0], nonstop: [NONSTOP, 0], jet: [JET, 0] };
/** a case: where, how high ('floor': the rung's own; m over the ground), the rung, the pull (0-1 of the stick past its dead band) held `hold` s, one thumb or
 *  two, and what it should be: a Lob, none, or a Lob's miss in the water. mode: a flick's stroke (the whole pull for 0.15 s), out of a dive, a Bomb after */
interface Case { key: string; place: Place; h: number | 'floor'; rung: string; pull: number; thumbs: 1 | 2; want: 'lob' | 'none' | 'miss' | 'longer' | 'wall'; mode?: 'flick' | 'dive' | 'bomb' | 'street'; hold?: number; tap?: 'late' | 'slid'; gap?: number; dur?: number; pin?: boolean }
const CASES: Case[] = [];
for (const place of ['wa'] as const)
  for (const h of ['floor', 300] as const)
    for (const rung of ['cruise', 'express', 'nonstop'])
      for (const pull of [0.5, 0.75])
        for (const thumbs of [1, 2] as const) CASES.push({ key: `${place}-${h}/${rung}/p${pull}/${thumbs}t`, place, h, rung, pull, thumbs, want: rung === 'nonstop' ? 'longer' : 'lob' });
CASES.push({ key: 'wa-floor/cruise/p1/1t', place: 'wa', h: 'floor', rung: 'cruise', pull: 1, thumbs: 1, want: 'lob' });
CASES.push({ key: 'wa-floor/express/p1/2t', place: 'wa', h: 'floor', rung: 'express', pull: 1, thumbs: 2, want: 'lob' });
CASES.push({ key: 'dt-floor/cruise/p0.6/1t', place: 'dt', h: 'floor', rung: 'cruise', pull: 0.6, thumbs: 1, want: 'lob' });
CASES.push({ key: 'dt-floor/express/p0.6/2t', place: 'dt', h: 'floor', rung: 'express', pull: 0.6, thumbs: 2, want: 'lob' });
CASES.push({ key: 'glen-floor/cruise/p0.5/1t', place: 'glen', h: 'floor', rung: 'cruise', pull: 0.5, thumbs: 1, want: 'lob' });
CASES.push({ key: 'glen-floor/express/p0.75/2t', place: 'glen', h: 'floor', rung: 'express', pull: 0.75, thumbs: 2, want: 'lob' });
CASES.push({ key: 'water-floor/cruise/p0.6/1t', place: 'water', h: 'floor', rung: 'cruise', pull: 0.6, thumbs: 1, want: 'miss' });
CASES.push({ key: 'wa-floor/cruise/flick/1t', place: 'wa', h: 'floor', rung: 'cruise', pull: 1, thumbs: 1, want: 'none', mode: 'flick' });
CASES.push({ key: 'wa-floor/express/flick/1t', place: 'wa', h: 'floor', rung: 'express', pull: 1, thumbs: 1, want: 'none', mode: 'flick' });
CASES.push({ key: 'wa-floor/zone/p1/2t', place: 'wa', h: 'floor', rung: 'zone', pull: 1, thumbs: 2, want: 'none' });
CASES.push({ key: 'wa-floor/zone/p1/1t', place: 'wa', h: 'floor', rung: 'zone', pull: 1, thumbs: 1, want: 'none' });
CASES.push({ key: 'wa-800/cruise/dive/2t', place: 'wa', h: 800, rung: 'cruise', pull: 1, thumbs: 2, want: 'none', mode: 'dive' });
CASES.push({ key: 'wa-800/express/dive/2t', place: 'wa', h: 800, rung: 'express', pull: 1, thumbs: 2, want: 'none', mode: 'dive' });
CASES.push({ key: 'wa-1500/cruise/p0.6/1t', place: 'wa', h: 1500, rung: 'cruise', pull: 0.6, thumbs: 1, want: 'none' });
CASES.push({ key: 'wa-1500/express/p0.6/2t', place: 'wa', h: 1500, rung: 'express', pull: 0.6, thumbs: 2, want: 'none' });
CASES.push({ key: 'wa-floor/jet/p0.6/1t', place: 'wa', h: 'floor', rung: 'jet', pull: 0.6, thumbs: 1, want: 'none' });
CASES.push({ key: 'wa-300/jet/p0.6/2t', place: 'wa', h: 300, rung: 'jet', pull: 0.6, thumbs: 2, want: 'none' });
CASES.push({ key: 'wa-floor/cruise/bomb', place: 'wa', h: 'floor', rung: 'cruise', pull: 0.75, thumbs: 1, want: 'none', mode: 'bomb' });
CASES.push({ key: 'wa-300/express/bomb', place: 'wa', h: 300, rung: 'express', pull: 0.75, thumbs: 1, want: 'none', mode: 'bomb' });
// (last: the Golden Gate's obstacles join the city for it)
CASES.push({ key: 'gg-under/cruise/p0.75/2t', place: 'gg', h: 26, rung: 'cruise', pull: 0.75, thumbs: 2, want: 'none' });
CASES.push({ key: 'gg-under/cruise/p0.75/1t', place: 'gg', h: 26, rung: 'cruise', pull: 0.75, thumbs: 1, want: 'none' });
// (after the review: the tap late or slid, and a tower in the climb)
for (const [place, h, rung, pull] of [['wa', 'floor', 'cruise', 0.75], ['wa', 'floor', 'express', 0.75], ['wa', 300, 'cruise', 0.5]] as const)
  for (const tap of ['late', 'slid'] as const) CASES.push({ key: `${place}-${h}/${rung}/p${pull}/1t/${tap}`, place, h, rung, pull, thumbs: 1, want: 'lob', tap });
// (the roofs stage, a throw that doesn't fire: one thumb from the roofs at Cruise, the tap's finger landing `gap` s after the lift and down `dur` s, quick
// and a little slow. Each a Lob while its ring is up, config.lob.latch (0.8 s) from the lift; at 0.9 s the ring is gone and the tap is today's)
for (const gap of [0.1, 0.3, 0.5, 0.7, 0.9])
  for (const dur of [1 / 15, 0.25])
    CASES.push({ key: `wa-floor/cruise/p0.75/1t/gap${gap}/${dur < 0.1 ? 'quick' : 'slow'}`, place: 'wa', h: 'floor', rung: 'cruise', pull: 0.75, thumbs: 1, want: gap < 0.8 ? 'lob' : 'none', gap, dur });
// (the roofs stage, the bare tower: pinned over Alamo Square heading east as controls.mjs flies it, 1.5 s on and a 1.8 s pull, the landing 1.57 km off
// stood behind the 129 m tower at Van Ness, which hid it from the lens and stayed bare. The tower takes it, and its circle paints all a tap's would)
CASES.push({ key: 'pin-floor/cruise/p0.65/1t/tower', place: 'wa', h: 'floor', rung: 'cruise', pull: 0.65, thumbs: 1, want: 'lob', pin: true, hold: 1.8 });
CASES.push({ key: 'pin-floor/express/p0.65/2t/tower', place: 'wa', h: 'floor', rung: 'express', pull: 0.65, thumbs: 2, want: 'lob', pin: true, hold: 1.8 });
// (from Justin Herman Plaza 50 m up, at the Embarcadero Center tower that stands highest over a 26 degree climb from there, 150-500 m out)
CASES.push({ key: 'fidi-50/cruise/p0.35/2t', place: 'fidi', h: 50, rung: 'cruise', pull: 0.35, thumbs: 2, want: 'wall' });
// (--street: Curb's street in their place)
if (STREET)
  CASES.splice(0, CASES.length, ...(['cruise', 'express'] as const).flatMap((rung) => ([1, 2] as const).map((thumbs): Case => ({ key: `wa-floor/${rung}/p0.75/${thumbs}t/street`, place: 'wa', h: 'floor', rung, pull: 0.75, thumbs, want: 'none', mode: 'street' }))));

const stick = (pull: number) => -(config.flight.yokeDead + pull * (1 - config.flight.yokeDead));
/** the stick for a path `deg` down with a gear in (s_shots' stickFor) */
const diveStick = (deg: number) => {
  const F = config.flight, k = Math.pow(Math.abs(deg) / F.noseUp, 1 / F.noseCurve);
  return Math.min(1, F.yokeDead + k * (1 - F.yokeDead));
};

/** A Bomb II let go now through the real Bomb (s_shots' bombTap): what it fired */
function bombShot(g: Game) {
  const f = g.flight, nop = () => {};
  let shot: any = null;
  const input = { state: { bomb: { on: false, at: 0 } } } as any;
  const bomb = new Bomb({
    input, flight: f, aimer: g.aimer,
    audio: { bombCharge: nop, bombTier: nop, bombStop: nop, bombBeat: nop, superMega: nop } as any,
    fx: { motes: nop, halo: nop, sparks: nop } as any, rig: { kick: nop } as any, busVel: () => new THREE.Vector3(),
    breathe: (s) => {
      shot = s;
      return g.splatter.barf(s.x, s.z, tapOpts(s, f.y));
    },
    busy: () => false,
  });
  bomb.on = true;
  input.onBombEnd(2, false);
  return shot;
}

let ggDone = false;
/** the fidi row's tower: how far its roof stands over a 26 degree climb from the plaza (m) */
let tower: number | null = null;
let gg = { x: 0, z: 0, ux: 0, uz: 1 };
async function run(c: Case, dt: number, slot = true) {
  const [gear, level] = RUNGS[c.rung];
  if (c.place === 'gg' && !ggDone) {
    const lm = manifest.landmarks.find((l: { kind: string }) => l.kind === 'ggb');
    const obj = makeGoldenGate(lm.points, lm.deck, lm.supports);
    city.addObstacles(bridgeObstacles('ggb', lm.points, lm.deck, lm.supports));
    paintBridge(city, 'lm:ggb', obj, 'Golden Gate Bridge');
    const d: number[][] = lm.deck, s = [0];
    let L = 0;
    for (let i = 1; i < d.length; i++) s.push((L += Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1])));
    let i = 0;
    while (i + 2 < d.length && L / 2 > s[i + 1]) i++;
    const k = (L / 2 - s[i]) / (s[i + 1] - s[i]), dx = d[i + 1][0] - d[i][0], dz = d[i + 1][1] - d[i][1], n = Math.hypot(dx, dz);
    gg = { x: d[i][0] + dx * k, z: d[i][1] + dz * k, ux: dx / n, uz: dz / n };
    ggDone = true;
  }
  let px: number, pz: number, fx: number, fz: number;
  if (c.place === 'gg') [px, pz, fx, fz] = [gg.x, gg.z, gg.ux, gg.uz];
  else {
    const P = PLACES[c.place];
    [px, pz] = ll(P.lat, P.lon);
    fx = Math.sin(P.hdg * DEG);
    fz = -Math.cos(P.hdg * DEG);
    if (c.place === 'fidi') {
      // (toward the tower standing highest over the climb: its roof over 50 m and a 26 degree slope from the plaza)
      await pump(city, px, pz);
      const y0 = city.groundAt(px, pz) + (c.h as number);
      let best = -Infinity;
      for (const { ref, d } of city.buildingsNear(px, pz, 500)) {
        const over = d < 150 ? -Infinity : ref.roofY - (y0 + d * Math.tan(26 * DEG));
        if (over > best) [best, fx, fz] = [over, (ref.cx - px) / d, (ref.cz - pz) / d];
      }
      tower = r1(best);
    }
  }
  const drive = new TurboDrive([-1e7, -1e7, 1e7, 1e7]);
  const g = makeGame(city, drive);
  const f = g.flight;
  if (!slot) g.aimer.lob = null;
  // (Curb's street: main.ts sets it every frame while CurbFlight rolls; nothing in the sim sets it back)
  if (c.mode === 'street') g.aimer.street = 1;
  city.paint.resetAll();
  const v0 = gear > 0 && gear !== EXPRESS ? driveSpeed(gear, level, true) : gear === EXPRESS ? config.flight.surgeSpeed : config.flight.cruiseSpeed;
  const hold = c.hold ?? 2;
  const lead = c.pin ? 1.5 : c.place === 'gg' ? 0.6 : 3;
  const back = c.pin ? 0 : gear < 0 ? 20 : c.place === 'gg' ? 30 : v0 * (lead + hold);
  f.x = px - fx * back;
  f.z = pz - fz * back;
  f.heading = Math.atan2(fx, -fz);
  f.glideSpeed = 0;
  f.speed = v0;
  f.fullness = 1;
  await pump(city, f.x, f.z);
  const g0 = city.groundAt(f.x, f.z);
  const alt = gear === NONSTOP ? config.turbo.nonstopAlt : gear >= JET ? config.turbo.jetAlt : 0;
  if (c.place === 'gg') {
    f.y = c.h as number;
    f.holdY = f.y;
  } else if (c.h === 'floor') f.y = alt > 0 ? g0 + alt : city.obstacleAt(f.x, f.z) + 9;
  else {
    f.y = g0 + c.h;
    f.holdY = f.y;
  }
  if (gear === EXPRESS) drive.rung(1, f);
  else if (gear > 0) drive.arrive(gear, level);
  if (gear < 0) drive.rung(-1, f);
  await pump(city, f.x, f.z, Math.max(0, f.y - g0), fx, fz);
  const rig = new CameraRig(), lens = new TurboLens(), cam = new THREE.PerspectiveCamera(50, SW / SH, 1, 60000), focus = new THREE.Vector3();
  const inner = { x: 1, y: 1 };
  g.aimer.comet!.lens = cam;
  if (g.aimer.lob) g.aimer.lob.lens = cam;
  // (each frame's, so a pause of the collector's or the laptop's other runs in one frame doesn't stand for the aim's cost: one 50 ms frame in 100 is 0.5 ms
  // on the mean, the gate's whole bound, and it failed one row a run at random on the shared laptop, a different one each time)
  const aimT: number[] = [];
  const upd = g.aimer.update.bind(g.aimer);
  g.aimer.update = (fl, t, dr, th) => { const t0 = performance.now(); const r = upd(fl, t, dr, th); aimT.push(performance.now() - t0); return r; };
  let k = 0;
  const frame = async (inp: { sx: number; sy: number; dragging: boolean }) => {
    if (k++ % 10 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
    g.frame(dt, inp);
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
  const idle = { sx: 0, sy: 0, dragging: false };
  let pullLob = 0, pullFlips = 0, pullN = 0, pullWas = false;
  // ---- level in, then the pull (a dive first, from 800 m: 45 degrees down for 2 s, then the whole pull for 0.3 s)
  for (let j = 0; j < Math.round(lead / dt); j++) await frame(idle);
  if (c.mode === 'dive') {
    for (let j = 0; j < Math.round(2 / dt); j++) await frame({ sx: 0, sy: diveStick(45), dragging: true });
    for (let j = 0; j < Math.round(0.3 / dt); j++) await frame({ sx: 0, sy: stick(1), dragging: true });
  } else {
    const held = c.mode === 'flick' ? 0.15 : hold;
    for (let j = 0; j < Math.round(held / dt); j++) {
      await frame({ sx: 0, sy: stick(c.pull), dragging: true });
      // (the Lob's frames in the pull, and how often it came and went)
      const lp = g.aimer.lobPlan !== null;
      if (lp) pullLob++;
      if (j > 0 && lp !== pullWas) pullFlips++;
      pullWas = lp;
      pullN++;
    }
  }
  const pulled = { sx: 0, sy: c.mode === 'dive' ? stick(1) : stick(c.pull), dragging: true };
  const bodyLift = f.pitch / DEG, noseLift = f.nose / DEG;
  // ---- the tap: one thumb, the lift, a finger down 0.1 s later and up 0.08 s after; two thumbs, a finger down and up while the other pulls
  const fps = Math.round(1 / dt);
  let ringAtPress = false;
  const steps = (s: number) => Math.max(1, Math.round(s / dt));
  if (c.thumbs === 1) {
    // (late: the finger lands 28/60 s after the lift, its tap's lift 0.53 s after it; slid: it slides past the tap slop from its second frame, a steering thumb
    // committed, and lifts as a quick tap, the stick still centred)
    for (let j = 0; j < steps(c.gap ?? (c.tap === 'late' ? 28 / 60 : 0.1)); j++) await frame(idle);
    ringAtPress = g.aimer.lobPlan !== null;
    g.press();
    for (let j = 0; j < steps(c.dur ?? 1 / 15); j++) await frame(c.tap === 'slid' && j >= 1 ? { sx: 0, sy: 0, dragging: true } : idle);
  } else {
    g.press();
    for (let j = 0; j < steps(1 / 15); j++) await frame(pulled);
  }
  const bodyTap = f.pitch / DEG;
  // (what this frame planned, the Lob's and the Comet's: at Nonstop the farther wins)
  const lobLast = g.aimer.lobLast, lobReach = lobLast ? r1(lobLast.reach) : null;
  const before = city.paint.data.slice();
  const ev0 = g.events.length;
  const tap = { x: f.x, y: f.y, z: f.z, t: g.t, fx: f.fx, fz: f.fz };
  let res: any;
  if (c.mode === 'bomb') {
    const s = bombShot(g);
    res = { fired: !!s, shot: s ?? { comet: null, x: f.x, z: f.z }, target: s?.target ?? null, landing: s ? { x: s.x, y: s.y ?? (s.target ? city.roofAtPart(s.target, s.x, s.z, f.y) + 0.5 : city.groundAt(s.x, s.z)), z: s.z } : { x: f.x, y: f.y, z: f.z }, wall: !!s?.exact };
  } else res = g.tap();
  const plan = res.shot.comet ?? null;
  const lob = plan?.kind === 'lob';
  // ---- to the impact (the steering thumb up), then 0.3 s on
  const at = new THREE.Vector3(res.landing.x, res.landing.y, res.landing.z), busV = new THREE.Vector3();
  let impact: any = null, scr: any = null, miss = false, refund = -1, climb = 0;
  const toScreen = (p: THREE.Vector3, b: THREE.Vector3) => {
    const vis = (q: THREE.Vector3) => {
      const v = q.clone().applyMatrix4(cam.matrixWorldInverse);
      const front = v.z < 0;
      v.applyMatrix4(cam.projectionMatrix);
      return { x: 0.5 + (v.x * 0.5) / inner.x, y: 0.5 - (v.y * 0.5) / inner.y, front };
    };
    const a = vis(p), bb = vis(b);
    return { x: r3(a.x), y: r3(a.y), in: a.front && a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1, above: r3(bb.y - a.y) };
  };
  for (let j = 0; res.fired && g.t - tap.t < 6; j++) {
    await frame(c.thumbs === 2 && g.t - tap.t < 0.3 ? pulled : idle);
    for (let e = ev0; e < g.events.length && !impact; e++) {
      const ev = g.events[e];
      if (ev.ev !== 'impact' && ev.ev !== 'miss') continue;
      impact = ev;
      miss = ev.ev === 'miss';
      const p = ev.pos as number[];
      at.set(p[0], p[1], p[2]);
      scr = toScreen(at, busV.set(f.x, f.y, f.z));
      climb = f.y - tap.y;
    }
    // (the belly 0.3 s after the impact: a miss's refund is in it, which a Lob's late plan gives after its breath has ended)
    if (impact && g.t - (impact.t as number) > 0.3) {
      refund = f.fullness;
      break;
    }
  }
  const after = city.paint.data;
  // (the buildings whose middle is well inside its circle: each should take a level, up to the blast's cap)
  const inside = impact && !miss ? Math.min(city.buildingsNear(at.x, at.z, 0.8 * (impact.r as number)).length, blastCap(impact.r as number, config.splat.maxBuildingsCap)) : 0;
  // (what a tap's circle of its size holds there, by Splatter.barf's own reach, up to its cap; and the building it struck, with its level)
  let holds = 0;
  if (impact && !miss) {
    const rr = impact.r as number, S = config.splat;
    for (const n of city.buildingsWithin(at.x, at.z, rr + S.smallRad, [])) if ((n.ref.rad <= S.smallRad ? Math.hypot(n.ref.cx - at.x, n.ref.cz - at.z) - 0.55 * Math.sqrt(n.ref.area) : n.d) <= rr) holds++;
    holds = Math.min(holds, blastCap(rr, S.maxBuildingsCap));
  }
  const struck = res.target ? { h: r1(res.target.roofY - res.target.baseY), lv: r1(city.paint.data[res.target.index * 4 + 1] - before[res.target.index * 4 + 1]) } : null;
  let painted = 0, two = 0;
  for (let i = 1; i < after.length; i += 4) {
    const d = after[i] - before[i];
    if (d > 0.5) painted++;
    if (d > 1.5) two++;
  }
  let underGround = -Infinity;
  if (plan) {
    const L = Math.hypot(plan.x - plan.x0, plan.z - plan.z0);
    for (let s = 4; s < L - 4; s += 4) {
      const u = s / L;
      underGround = Math.max(underGround, city.groundAt(plan.x0 + (plan.x - plan.x0) * u, plan.z0 + (plan.z - plan.z0) * u) - (plan.y0 + (plan.y - plan.y0) * u + plan.arc * 4 * u * (1 - u)));
    }
  }
  const top = plan ? Math.max(...[0.25, 0.5, 0.75].map((u) => plan.y0 + (plan.y - plan.y0) * u + plan.arc * 4 * u * (1 - u))) - plan.y0 : null;
  return {
    key: c.key, fps, want: c.want, slot,
    kind: !res.fired ? 'refused' : lob ? (miss ? 'lob-miss' : 'lob') : plan ? (miss ? 'comet-miss' : 'comet') : miss ? 'miss' : 'splat',
    body: { lift: r1(bodyLift), tap: r1(bodyTap), noseLift: r1(noseLift), angle: plan?.angle !== undefined ? r1(plan.angle / DEG) : null },
    tImpact: impact ? r3((impact.t as number) - tap.t) : null,
    planTravel: plan ? r3(config.splat.inhale + plan.travel) : null, planAbove: plan ? r3(plan.above) : null,
    landing: [r1(at.x), r1(at.y), r1(at.z)],
    from: r1(Math.hypot(at.x - tap.x, at.z - tap.z)),
    agl: r1(tap.y - city.groundAt(tap.x, tap.z)),
    impactScreen: scr,
    radius: impact && !miss ? r1(impact.r as number) : null, wantRadius: r1(lob ? lobRadius(plan) : blastRadiusFor(Math.max(0, tap.y - at.y))),
    painted, inside, holds, struck, raisedTwo: two, ringAtPress, refund: r2(refund), climb: r1(climb), lobReach, pull: { lob: pullLob, of: pullN, flips: pullFlips },
    hitStops: g.events.slice(ev0).filter((e) => e.ev === 'hitstop').length,
    top: top === null ? null : r1(top), underGround: plan ? r1(underGround) : null,
    on: miss ? 'water' : res.wall ? 'wall' : res.target ? 'roof' : 'ground',
    // (the mean of its frames but the slowest 2 %, and the mean of them all)
    aimMs: r3(trimmedMean(aimT, 0.02)),
    aimMsAll: r3(aimT.reduce((a, b) => a + b, 0) / Math.max(1, aimT.length)),
    lobStats: g.aimer.lob ? { ...g.aimer.lob.stats } : null,
  };
}

const t0 = Date.now();
const rows: any[] = [];
for (const c of CASES) {
  if (ONLY && !c.key.includes(ONLY)) continue;
  for (const dt of [1 / 60, 1 / 30]) rows.push(await run(c, dt));
  if (c.mode === 'bomb') rows.push(await run(c, 1 / 60, false));
}
const OUT = process.env.SB_OUT ?? 'shots/feel/sim';
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/lob.json`, JSON.stringify({ rows }, null, 1));
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const most = config.lob.most;
for (const r of rows) {
  const id = `${r.key}@${r.fps}${r.slot ? '' : ' (no Lob)'}`;
  console.log(`${id.padEnd(34)} ${r.kind.padEnd(8)} body ${String(r.body.lift).padStart(5)}/${String(r.body.tap).padStart(5)} at ${String(r.body.angle).padStart(5)} t ${String(r.tImpact).padStart(6)} (${r.planTravel}) from ${String(r.from).padStart(7)} up ${String(r.impactScreen?.above ?? '-').padStart(6)} climb ${r.climb} (plan ${r.planAbove}) in ${r.impactScreen?.in ? 'y' : 'n'} r ${r.radius} (${r.wantRadius}) painted ${r.painted} (${r.inside} inside) two ${r.raisedTwo} pull ${r.pull.lob}/${r.pull.of} ${r.pull.flips} top ${r.top} under ${r.underGround} on ${r.on} agl ${r.agl} aim ${r.aimMs} ms`);
  if (!r.slot) continue;
  // (at Nonstop the Comet applies too: the farther wins, chooseShot. A Comet there must land farther than this frame's Lob would)
  if (r.want === 'longer' && r.kind === 'comet') ok(r.lobReach === null || r.from + 1 >= r.lobReach, `${id}: the Comet, farther than the Lob (${r.from} against ${r.lobReach})`);
  if (r.want === 'lob' || (r.want === 'longer' && r.kind !== 'comet')) {
    ok(r.kind === 'lob', `${id}: a Lob (${r.kind}, the body ${r.body.lift} at the lift, ${r.body.tap} at the tap)`);
    if (r.kind !== 'lob') continue;
    const one = r.key.includes('/1t'), want = Math.min(most, one ? r.body.lift : r.body.tap);
    ok(Math.abs(r.body.angle - want) <= 0.15, `${id}: thrown at the body ${one ? 'as the steering thumb lifted' : 'at the tap, live'} (${r.body.angle} against ${want}; at the tap ${r.body.tap})`);
    ok(r.tImpact !== null && Math.abs(r.tImpact - r.planTravel) <= 0.05, `${id}: lands on its flight's time (${r.tImpact} against ${r.planTravel})`);
    ok(!!r.impactScreen?.in && r.impactScreen.above >= config.comet.above, `${id}: in frame at the impact, ${config.comet.above * 100} % or more over the bus (${JSON.stringify(r.impactScreen)}, planned ${r.planAbove})`);
    ok(r.radius !== null && Math.abs(r.radius - r.wantRadius) <= 1, `${id}: its radius its fall's from the arc's top, lobRadius (${r.radius} against ${r.wantRadius})`);
    ok((r.on === 'ground' || r.painted >= 5) && r.raisedTwo === 0, `${id}: a level each, none two (${r.painted} painted on ${r.on}, ${r.raisedTwo} two)`);
    ok(r.painted >= r.inside, `${id}: every building well inside its circle a level (${r.painted} painted, ${r.inside} inside 0.8 of it, up to its cap)`);
    ok(r.painted >= r.holds && (!r.struck || r.struck.lv >= 0.5), `${id}: all a tap's circle of its size holds, the building it struck among them (${r.painted} painted of ${r.holds}, struck ${JSON.stringify(r.struck)})`);
    if (r.key.endsWith('/tower')) ok(r.on !== 'ground' && !!r.struck && r.struck.h >= 100 && r.struck.lv >= 0.5, `${id}: the tower that hid its landing takes it (struck ${JSON.stringify(r.struck)} on ${r.on}, ${r.from} m out)`);
    if (r.want === 'lob' && !r.key.includes('nonstop')) ok(r.pull.flips <= 1, `${id}: in the pull, once it shows the Lob stays (${r.pull.lob} of ${r.pull.of} frames, ${r.pull.flips} flips)`);
    ok(r.hitStops === 0, `${id}: no hit-stop (${r.hitStops})`);
    ok(r.underGround <= 2, `${id}: its arc never 2 m into the ground (${r.underGround})`);
    ok(r.from >= 600 && r.from <= config.comet.reach + 1, `${id}: lands in the distance, 600-${config.comet.reach} m (${r.from})`);
  } else if (r.want === 'wall') {
    ok(r.kind === 'lob' && r.on === 'wall' && r.from < 600 && r.underGround <= 2, `${id}: a tower in its climb takes it on its face (${r.kind} on ${r.on}, ${r.from} m out; the tower's roof ${tower} m over a 26 degree climb)`);
  } else if (r.want === 'miss') {
    ok(r.kind === 'lob-miss' && r.refund >= config.splat.missRefund - 0.02, `${id}: the bay is a Lob's miss, with its refund (${r.kind}, belly after ${r.refund})`);
  } else {
    ok(!r.kind.startsWith('lob'), `${id}: no Lob (${r.kind}, the body ${r.body.lift} at the lift, ${r.body.tap} at the tap)`);
    if (r.key.endsWith('/street')) ok(r.pull.lob === 0 && r.lobStats?.planned === 0 && r.lobStats?.fired === 0, `${id}: on Curb's street no Lob planned, in the pull or at the tap (${r.pull.lob} of ${r.pull.of} frames, ${JSON.stringify(r.lobStats)})`);
  }
  // (the roofs stage: the ring up at the finger's landing is a Lob at its lift, and gone it's today's tap: never a ring that throws nothing)
  if (r.key.includes('/gap')) ok(r.ringAtPress === (r.want === 'lob') && (r.kind === 'lob') === r.ringAtPress, `${id}: the ring ${r.ringAtPress ? 'up' : 'gone'} at the finger, ${r.kind} thrown (${r.key.split('/').slice(-2).join(' ')})`);
  if (r.key.includes('/bomb')) {
    const base = rows.find((q) => q.key === r.key && !q.slot);
    const d = base ? Math.hypot(r.landing[0] - base.landing[0], r.landing[1] - base.landing[1], r.landing[2] - base.landing[2]) : Infinity;
    ok(r.fps !== 60 || (!!base && base.kind === r.kind && d <= 0.5), `${id}: a Bomb after a pull lands as with no Lob (${r.kind} at ${JSON.stringify(r.landing)}; without ${JSON.stringify(base ? [base.kind, base.landing] : null)})`);
  }
  // (30 and 60 fps: the same throw, within 2 m and 0.05 s)
  if (r.fps === 60 && r.kind === 'lob') {
    const s = rows.find((q) => q.key === r.key && q.fps === 30 && q.slot);
    ok(!!s && s.kind === r.kind && Math.hypot(s.landing[0] - r.landing[0], s.landing[1] - r.landing[1], s.landing[2] - r.landing[2]) <= 2 && Math.abs((s.tImpact ?? 0) - (r.tImpact ?? 0)) <= 0.05, `${r.key}: 30 and 60 fps within 2 m and 0.05 s (${JSON.stringify([r.kind, r.landing, r.tImpact])} against ${JSON.stringify(s ? [s.kind, s.landing, s.tImpact] : null)})`);
  }
  // (what the aim costs a frame while it plans the Lob, in Node: the plan's 0.035-0.066 ms for its plan alone, 0.02-0.09 a row's median with the hider on a
  // loaded laptop; its slowest 2 % of frames left out)
  ok(r.aimMs <= 0.5, `${id}: the aim 0.5 ms a frame or less (${r.aimMs}, ${r.aimMsAll} with its slowest frames)`);
}
console.log(`${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(fails.length ? `LOB FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `lob checks: all ${checks} passed`);
process.exit(fails.length ? 1 : 0);
