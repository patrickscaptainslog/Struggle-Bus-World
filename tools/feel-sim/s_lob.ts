// The Lob on the real city (src/game/Lob.ts; docs/specs/shots/SHOTS.md, "The modes"; sb-checks' lob plan): a pull held, then a tap, through the real
// Flight, TurboDrive, TurboLens, CameraRig, Aimer, Comet, Lob and Splatter, at 1/60 and 1/30 s, the lens projecting as the page's at 393 x 852 (lensFov).
// One thumb: the steering thumb lifts, a finger lands 0.1 s later and lifts 1/15 s after that, the tap; two thumbs: the steering thumb still pulling, a
// second one taps (whole frames at 30 and 60 fps, so both tap at the same game time). Every row starts on paint at level 0, so a building a tap raised two shows.
// Lobs at Cruise, Express and Nonstop (where the Comet applies too: the Lob whenever one is planned, config.lob.wins) over the Western Addition from the roofs and from 300 m, and downtown and over Glen Park's hills: each a Lob, at the
// body as it was when the steering thumb lifted (one thumb) or at the tap (two), clamped to config.lob.most; 30 and 60 fps within 2 m and 0.05 s; at the
// impact in frame and config.lob.above of the height over the bus; its radius lobRadius (its fall from the arc's top, at most config.lob.radius), every building it reached a level, none two; no
// hit-stop; its arc never 2 m into the ground.
// None: from a flick's stroke, in School Zone, out of a dive, under the Golden Gate, at Jet. From 1.5 km up a far Lob (the Lob from any height: no in-view
// rule, its radius a tap's from its height, inside shotReach). Over the bay from Fort Mason: a Lob's miss, with its refund. A Bomb let go after a pull lands where it would with no Lob at all (the slot off). And the aim's cost a frame while it plans the Lob.
// After the review (sb-checks' lob fixes): a one-thumb tap lifted 0.53 s after the steering thumb (late: the press runs the latch on) and one that slides
// past the tap slop (slid: it commits as a steering thumb, lifted inside quickTapMs), each a Lob at the body as the steering thumb lifted; a tower in the climb
// (the Financial District's, toward Salesforce Tower) takes it on its face; at Cruise and Express, once the Lob shows in a pull it stays; and every building
// whose middle is within 0.8 of its circle takes a level, up to the blast's cap.
// After the Lob review (M90, the latch never had to end): a flick up a gear 0.5 s after the lift with the tap 1.2 s after it, and taps mashed every 0.3 s
// after a Lob at Express until the belly is full, and three looks' landings 0.5, 1 and 1.4 s after the lift with the tap at 1.7 s: each a plain splat.
// --street (the Lob's merge with feat/shots): only Curb's street, aimer.street set as main.ts sets it while Curb rolls, a pull and a tap there nose up at
// Cruise and Express, one thumb and two: never a Lob, no plan in the pull, nothing planned (Curb's street front is the tap's, before the Lob's slot).
// --high (the Lob from any height, DESIGN's lob-high): over the Western Addition heading east and downtown, placed 1, 1.5, 2, 5, 10 and 14 km over the
// ground, then a 1.5 s real pull, at Cruise, Express, Nonstop, Jet, Turbo 2 and 3, bodies 30, 45 and 70 (the stick for that path; the body it gives is
// what's thrown), one thumb and two; at the ceiling straining (Cruise, Jet, Turbo 3: the pull held counts, bodyOf); over the bay from Fort Mason at 5 km;
// off the map's edge at 5 km (the classic tap); a 45 degree dive at 5 km (none); a slow climb from 600 to 2,500 m at Nonstop and Turbo 3, the tap at the
// top. Each a Lob, far where the near search found nothing: landing on the stretch nearest min(reach, max(lobRange, the bus at the impact + 300)), the
// stretch's middle 300 m past the bus at the impact, on loaded ground, on L4's flight, its radius a tap's from its height; after the tap the view dips as
// main.ts dips it (shotTip, the rig's skyDipMost): the hit at -0.25 or higher from 5 km and under, the bus at +0.3 or lower every frame to 0.6 s after
// the hit; in the pull planned from the first frame past 25 degrees, never lost; the slow climb's kind changing at most once.
//   node tools/feel-sim/run.mjs s_lob.ts [--only=<substring>] [--street] [--high]
// Results in SB_OUT (shots/feel/sim)/lob.json (--high: lob-high.json), a table on stdout; exit 1 when a check fails.
import { newCity, pump, ll, makeGame, config, manifest, type Game } from './lib';
import { CameraRig } from '@src/game/CameraRig';
import { EXPRESS, JET, NONSTOP, SCHOOL_ZONE, TurboDrive, driveSpeed } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
import { lensFov } from '@src/render/PixelPipeline';
import { blastCap, blastRadiusFor } from '@src/game/blastLayout';
import { Bomb } from '@src/game/Bomb';
import { Aimer, tapOpts } from '@src/game/Aim';
import { bodyOf, lobFlight, lobRange, lobRadius } from '@src/game/Lob';
import { Comet, shotReach } from '@src/game/Comet';
import { shotTip } from '@src/game/CameraRig';
import { makeGoldenGate, bridgeObstacles, paintBridge } from '@src/world/Bridges';
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7) ?? '';
const STREET = args.includes('--street');
const HIGH = args.includes('--high');
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
  // (--high: Ocean Beach heading out to sea, off the map's edge)
  edge: { lat: 37.7597, lon: -122.5104, hdg: 270 },
} as const;
type Place = keyof typeof PLACES;
const RUNGS: Record<string, [number, number]> = { zone: [-1, 0], cruise: [0, 0], express: [EXPRESS, 0], nonstop: [NONSTOP, 0], jet: [JET, 0], t2: [JET, 2], t3: [JET, 3] };
/** a case: where, how high ('floor': the rung's own; m over the ground), the rung, the pull (0-1 of the stick past its dead band) held `hold` s, one thumb or
 *  two, and what it should be: a Lob, none, or a Lob's miss in the water. mode: a flick's stroke (the whole pull for 0.15 s), out of a dive, a Bomb after */
interface Case { key: string; place: Place; h: number | 'floor'; rung: string; pull: number; thumbs: 1 | 2; want: 'lob' | 'none' | 'miss' | 'longer' | 'wall' | 'far' | 'high'; mode?: 'flick' | 'dive' | 'bomb' | 'street' | 'ceil' | 'climb'; body?: number; hold?: number; tap?: 'late' | 'slid'; after?: 'flick' | 'mash' | 'look'; gap?: number; dur?: number; pin?: boolean }
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
// (from 1.5 km up, where nothing within the reach shows over the bus: the far Lob, "I want to shoot lob shots even when I'm high elevation in the sky")
CASES.push({ key: 'wa-1500/cruise/p0.6/1t', place: 'wa', h: 1500, rung: 'cruise', pull: 0.6, thumbs: 1, want: 'far' });
CASES.push({ key: 'wa-1500/express/p0.6/2t', place: 'wa', h: 1500, rung: 'express', pull: 0.6, thumbs: 2, want: 'far' });
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
// (the Lob review's M90: the latch ends. A flick up a gear 0.5 s after the lift, its landing a press and its 0.1 s stroke a steering thumb, then the tap 1.2 s
// after the lift; and taps mashed every 0.3 s after a Lob at Express until the belly is full again. Each a plain splat: the body is long down, and no tap
// ran the latch on)
CASES.push({ key: 'wa-floor/cruise/p1/1t/flick-after', place: 'wa', h: 'floor', rung: 'cruise', pull: 1, thumbs: 1, want: 'none', after: 'flick' });
CASES.push({ key: 'wa-floor/express/p0.75/1t/mash', place: 'wa', h: 'floor', rung: 'express', pull: 0.75, thumbs: 1, want: 'none', after: 'mash' });
// (and twice the latch by itself: three looks' landings, each a press, 0.5, 1 and 1.4 s after the lift, then the tap's finger at 1.7 s. A plain splat)
CASES.push({ key: 'wa-floor/cruise/p1/1t/look-after', place: 'wa', h: 'floor', rung: 'cruise', pull: 1, thumbs: 1, want: 'none', after: 'look' });
// (--high: the Lob from any height in their place)
if (HIGH) {
  CASES.length = 0;
  for (const place of ['wa', 'dt'] as const)
    for (const h of [1000, 1500, 2000, 5000, 10000, 14000])
      for (const rung of ['cruise', 'express', 'nonstop', 'jet', 't2', 't3'])
        for (const body of [30, 45, 70])
          for (const thumbs of [1, 2] as const) CASES.push({ key: `high/${place}-${h}/${rung}/b${body}/${thumbs}t`, place, h, rung, pull: 0, body, thumbs, want: 'high', hold: 1.5 });
  for (const rung of ['cruise', 'jet', 't3']) CASES.push({ key: `high/ceil/${rung}/b70/1t`, place: 'wa', h: 0, rung, pull: 0, body: 70, thumbs: 1, want: 'far', mode: 'ceil', hold: 1.5 });
  // (over the bay from Fort Mason: the tiles end at the shore, so shotReach's march back to loaded ground finds none along the line, and it's the map's
  // edge, the classic tap (Comet.ts's shotReach). DESIGN.md's row wanted a miss with its refund: its own C4 rule makes it none)
  CASES.push({ key: 'high/water-5000/cruise/b45/1t', place: 'water', h: 5000, rung: 'cruise', pull: 0, body: 45, thumbs: 1, want: 'none', hold: 1.5 });
  CASES.push({ key: 'high/edge-5000/cruise/b45/1t', place: 'edge', h: 5000, rung: 'cruise', pull: 0, body: 45, thumbs: 1, want: 'none', hold: 1.5 });
  CASES.push({ key: 'high/wa-5000/cruise/dive/2t', place: 'wa', h: 5000, rung: 'cruise', pull: 1, thumbs: 2, want: 'none', mode: 'dive' });
  for (const rung of ['nonstop', 't3']) CASES.push({ key: `high/climb/${rung}/b35/1t`, place: 'wa', h: 600, rung, pull: 0, body: 35, thumbs: 1, want: 'far', mode: 'climb' });
}
// (--street: Curb's street in their place)
if (STREET)
  CASES.splice(0, CASES.length, ...(['cruise', 'express'] as const).flatMap((rung) => ([1, 2] as const).map((thumbs): Case => ({ key: `wa-floor/${rung}/p0.75/${thumbs}t/street`, place: 'wa', h: 'floor', rung, pull: 0.75, thumbs, want: 'none', mode: 'street' }))));

const stick = (pull: number) => -(config.flight.yokeDead + pull * (1 - config.flight.yokeDead));
/** the stick for a path `deg` up with a gear in (diveStick's, pulled) */
const upStick = (deg: number) => -diveStick(deg);
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
  const sy = c.body !== undefined ? upStick(c.body) : stick(c.pull);
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
  } else if (c.mode === 'ceil') {
    // (straining at the ceiling: a tenth of its soft band under it, where the gear's limit has turned the nose level)
    f.y = config.flight.ceiling - 0.1 * Math.max(config.flight.ceilingSoft, v0 * config.flight.ceilingSoftT);
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
  // (--high: the view after a far shot, as main.ts sets it before rig.update, and the bus on the lens after: its highest, and the landing's at the impact)
  let pre: (() => void) | null = null, busHi = -Infinity, tipBound = false;
  // (--high: the star on the lens after the tap, each frame it's in the air: how many, how many inside the frame)
  let starOf: (() => THREE.Vector3 | null) | null = null, starN = 0, starIn = 0, starHeld = 0, flyBound = false;
  // (--high: the frame its far stretch was last picked, not kept from a latch: that stretch's middle, L3's want there by the check's own numbers, the
  // odometer then. A latched stretch the bus has closed on to under aheadMin, or that a tile's march back put past the reach, is picked afresh on the frame
  // it fails, between the lift's pose and the tap's)
  const table = new Comet(city, g.splatter);
  let pick: { mid: number; want: number; odo: number } | null = null;
  const picked = () => {
    const lp = g.aimer.lobLast, fl = g.aimer.lob?.farLast;
    if (!lp?.far || !fl || fl.latched) return;
    const L = config.lob, S = config.splat, a = lp.angle ?? 0, H = f.y - city.groundAt(f.x, f.z), reach = shotReach(city, f, f.fx, f.fz);
    const vt = Math.max(Math.max(1, f.ground), f.turbo.speed > 0 ? f.turbo.speed : f.speed);
    const l4 = Math.min(L.flightHigh, lobFlight(a) + (L.fallPerKm * Math.max(0, H - L.highFrom)) / 1000, table.timeTo(vt, reach - L.aheadMin - L.stretch) - S.inhale);
    const want = Math.min(reach, Math.max(Math.hypot(lp.x0 - f.x, lp.z0 - f.z) + lobRange(a, H), table.flown(vt, S.inhale + l4) + L.aheadMin));
    pick = { mid: fl.mid, want, odo: g.aimer.comet!.odometer };
  };
  const ndcOf = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    return v.z >= 0 ? -Infinity : v.applyMatrix4(cam.projectionMatrix).y;
  };
  const frame = async (inp: { sx: number; sy: number; dragging: boolean }) => {
    if (k++ % 10 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
    g.frame(dt, inp);
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
    if (pre) {
      busHi = Math.max(busHi, ndcOf(f.x, f.y, f.z));
      const sp = starOf?.();
      if (sp) {
        const v = sp.applyMatrix4(cam.matrixWorldInverse), front = v.z < 0;
        v.applyMatrix4(cam.projectionMatrix);
        starN++;
        if (front && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) starIn++;
        // (out, with the view held from it by its limits: the bus tipBus under the middle as the star climbs (a throw near 70 degrees climbs 2 km over its
        // chord), or the dip's own as it falls, the bus at busMax or the swing)
        else if (flyBound) starHeld++;
      }
    } else if (HIGH) picked();
  };
  const idle = { sx: 0, sy: 0, dragging: false };
  let pullLob = 0, pullFlips = 0, pullN = 0, pullWas = false, pastAt = -1, hPast = 0, lobAt = -1, kinds = 0, kindWas = '';
  // ---- level in, then the pull (a dive first, from 800 m: 45 degrees down for 2 s, then the whole pull for 0.3 s)
  for (let j = 0; j < Math.round(lead / dt); j++) await frame(idle);
  if (c.mode === 'dive') {
    for (let j = 0; j < Math.round(2 / dt); j++) await frame({ sx: 0, sy: diveStick(45), dragging: true });
    for (let j = 0; j < Math.round(0.3 / dt); j++) await frame({ sx: 0, sy: stick(1), dragging: true });
  } else {
    const held = c.mode === 'flick' ? 0.15 : hold;
    // (the slow climb: the pull held until 2,500 m over the ground, at most 40 s)
    const n = c.mode === 'climb' ? Math.round(40 / dt) : Math.round(held / dt);
    for (let j = 0; j < n; j++) {
      if (c.mode === 'climb' && f.y - city.groundAt(f.x, f.z) >= 2500) break;
      await frame({ sx: 0, sy: sy, dragging: true });
      // (planned from the first frame past config.lob.from; and the plan's kind, near or far, as it changes)
      if (pastAt < 0 && bodyOf(f) >= config.lob.from * DEG) [pastAt, hPast] = [j, f.y - city.groundAt(f.x, f.z)];
      if (lobAt < 0 && g.aimer.lobPlan) lobAt = j;
      const kind = g.aimer.lobPlan ? (g.aimer.lobPlan.far ? 'far' : 'near') : 'none';
      if (kindWas && kind !== kindWas) kinds++;
      kindWas = kind;
      // (the Lob's frames in the pull, and how often it came and went)
      const lp = g.aimer.lobPlan !== null;
      if (lp) pullLob++;
      if (j > 0 && lp !== pullWas) pullFlips++;
      pullWas = lp;
      pullN++;
    }
  }
  const pulled = { sx: 0, sy: c.mode === 'dive' ? stick(1) : sy, dragging: true };
  const bodyLift = f.pitch / DEG, noseLift = f.nose / DEG;
  // ---- the tap: one thumb, the lift, a finger down 0.1 s later and up 0.08 s after; two thumbs, a finger down and up while the other pulls
  const fps = Math.round(1 / dt);
  let ringAtPress = false, first: string | null = null;
  const steps = (s: number) => Math.max(1, Math.round(s / dt));
  if (c.after === 'flick') {
    // (the flick's landing a press, as Input gives every flying thumb's)
    for (let j = 0; j < steps(0.5); j++) await frame(idle);
    g.press();
    drive.rung(1, f);
    for (let j = 0; j < steps(0.1); j++) await frame({ sx: 0, sy: 0, dragging: true });
    for (let j = 0; j < steps(0.5); j++) await frame(idle);
  } else if (c.after === 'look') {
    // (looks' landings, each a press and none a tap, 0.5, 1 and 1.4 s after the lift: the tap's finger then lands at 1.7 s, past twice the latch)
    for (const s of [0.5, 0.5, 0.4]) {
      for (let j = 0; j < steps(s); j++) await frame(idle);
      g.press();
    }
    for (let j = 0; j < steps(0.2); j++) await frame(idle);
  } else if (c.after === 'mash') {
    // (the Lob, then a tap every 0.3 s on the empty belly; the row's tap is the first with it full again)
    for (let j = 0; j < steps(0.1); j++) await frame(idle);
    g.press();
    for (let j = 0; j < steps(1 / 15); j++) await frame(idle);
    const r0 = g.tap();
    first = r0.shot.comet?.kind === 'lob' ? 'lob' : r0.fired ? 'splat' : 'refused';
    for (let n = 0; n < 40; n++) {
      for (let j = 0; j < steps(0.3 - 1 / 15 - 0.1); j++) await frame(idle);
      if (Aimer.loaded(f)) break;
      g.press();
      for (let j = 0; j < steps(1 / 15); j++) await frame(idle);
      g.tap();
      for (let j = 0; j < steps(0.1); j++) await frame(idle);
    }
  }
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
  const reachAtTap = shotReach(city, f, f.fx, f.fz);
  // (L4's flight, from the gear's speed and the reach at the tap, by a table of its own)
  const vt = Math.max(Math.max(1, f.ground), f.turbo.speed > 0 ? f.turbo.speed : f.speed), aglTap = f.y - city.groundAt(f.x, f.z);
  const farMid = g.aimer.lob?.farLast.mid ?? 0, odoTap = g.aimer.comet!.odometer, pickTap = pick as { mid: number; want: number; odo: number } | null;
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
  const l4 = plan?.far ? Math.min(config.lob.flightHigh, lobFlight(plan.angle ?? 0) + (config.lob.fallPerKm * Math.max(0, aglTap - config.lob.highFrom)) / 1000, table.timeTo(vt, reachAtTap - config.lob.aheadMin - config.lob.stretch) - config.splat.inhale) : null;
  // (after a far one the view dips as main.ts dips it: toward the landing until config.shotView.hold after the impact, then back)
  const upDeg = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    return (Math.atan2(v.y, -v.z) * 180) / Math.PI + rig.skyLift;
  };
  const liftAtTap = rig.skyLift, until = plan?.far ? g.t + config.splat.inhale + plan.travel + config.shotView.hold : -1;
  if (HIGH && plan?.far)
    starOf = () => {
      const u = (g.t - tap.t - config.splat.inhale) / plan.travel;
      return u >= 0 && u < 1 ? new THREE.Vector3(plan.x0 + (plan.x - plan.x0) * u, plan.y0 + (plan.y - plan.y0) * u + plan.arc * 4 * u * (1 - u), plan.z0 + (plan.z - plan.z0) * u) : null;
    };
  if (HIGH && plan?.far)
    pre = () => {
      if (g.t < until) {
        const half = cam.fov / 2, ld = config.shotView.lead, landUp = upDeg(plan.x - f.fx * f.ground * ld, plan.y - f.vy * ld, plan.z - f.fz * f.ground * ld);
        // (its star in the air and its arc's top while it climbs to it, CometFx.shotStar's, the higher of the two on the lens; launched at the inhale's end)
        const t0 = tap.t + config.splat.inhale, u = (g.t - t0) / plan.travel, top = plan.arc > 0 ? Math.min(1, Math.max(0, 0.5 + (plan.y - plan.y0) / (8 * plan.arc))) : 0;
        const arcUp = (w: number) => upDeg(plan.x0 + (plan.x - plan.x0) * w, plan.y0 + (plan.y - plan.y0) * w + plan.arc * 4 * w * (1 - w), plan.z0 + (plan.z - plan.z0) * w);
        const fly = u >= 0 && u < 1 ? Math.max(arcUp(u), arcUp(Math.max(u, top))) : NaN;
        rig.skyLiftTarget = shotTip(landUp, upDeg(f.x, f.y, f.z), half, false, true, liftAtTap, 0, fly);
        // (the view's limits, for the star's count: under the climbing star the bus's and the rig's own tip up, at most half the field less 6 degrees
        // (CameraRig.update); and the dip's own without it, the bus at busMax or the swing)
        flyBound = (Number.isFinite(fly) && (upDeg(f.x, f.y, f.z) + half * config.lob.tipBus < fly - half + config.lob.tipTop || rig.skyLiftTarget > half - 6)) || shotTip(landUp, upDeg(f.x, f.y, f.z), half, false, true, liftAtTap) > landUp - (Math.atan(config.shotView.low * Math.tan(half * DEG)) / DEG) + 0.5;
        // (the hit's own want: where shotTip's target is over it, the bus's limit or the swing binds)
        tipBound = rig.skyLiftTarget > landUp - (Math.atan(config.shotView.low * Math.tan(half * DEG)) / DEG) + 0.5;
        rig.skyLiftRate = config.shotView.rate;
        rig.skyDipMost = config.shotView.most;
      } else if (rig.skyDipMost > 0) {
        if (rig.skyLift >= -0.02) rig.skyDipMost = 0;
        rig.skyLiftTarget = 0;
        rig.skyLiftRate = config.shotView.rate;
      }
    };
  let landNdc: number | null = null;
  // ---- to the impact (the steering thumb up), then 0.3 s on
  const at = new THREE.Vector3(res.landing.x, res.landing.y, res.landing.z), busV = new THREE.Vector3();
  let impact: any = null, scr: any = null, miss = false, refund = -1, climb = 0, atImpAlong = 0, busImp = 0, liftImp = 0, boundImp = false;
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
  // (the bus along the way at the frame before, to take its travel at the impact's own time: the event comes on the first frame past it, up to a 30 fps
  // frame later, 30 m at Turbo 3)
  let alongWas = 0, tWas = g.t;
  const alongNow = () => (f.x - tap.x) * tap.fx + (f.z - tap.z) * tap.fz;
  for (let j = 0; res.fired && g.t - tap.t < 6; j++) {
    if (!impact) [alongWas, tWas] = [alongNow(), g.t];
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
      landNdc = ndcOf(at.x, at.y, at.z);
      const tAt = tap.t + (plan ? config.splat.inhale + plan.travel : 0), u = g.t > tWas ? Math.min(1, Math.max(0, (tAt - tWas) / (g.t - tWas))) : 1;
      atImpAlong = alongWas + (alongNow() - alongWas) * u;
      busImp = ndcOf(f.x, f.y, f.z);
      boundImp = tipBound;
      liftImp = rig.skyLift;
    }
    // (the belly 0.3 s after the impact: a miss's refund is in it, which a Lob's late plan gives after its breath has ended)
    if (impact && g.t - (impact.t as number) > (HIGH ? config.shotView.hold : 0.3)) {
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
    painted, inside, holds, struck, raisedTwo: two, ringAtPress, ...(first ? { first } : {}), refund: r2(refund), climb: r1(climb), lobReach, pull: { lob: pullLob, of: pullN, flips: pullFlips },
    hitStops: g.events.slice(ev0).filter((e) => e.ev === 'hitstop').length,
    top: top === null ? null : r1(top), underGround: plan ? r1(underGround) : null,
    on: miss ? 'water' : res.wall ? 'wall' : res.target ? 'roof' : 'ground',
    // (the mean of its frames but the slowest 2 %, and the mean of them all)
    aimMs: r3(trimmedMean(aimT, 0.02)),
    aimMsAll: r3(aimT.reduce((a, b) => a + b, 0) / Math.max(1, aimT.length)),
    lobStats: g.aimer.lob ? { ...g.aimer.lob.stats } : null,
    // (a far Lob's: its drop, and the reach at the tap: kept off the near rows, which stay byte for byte as they were)
    ...(plan?.far ? { far: true, drop: r1(plan.drop), shotReach: r1(reachAtTap) } : {}),
    // (--high's own: L4's flight, the planned stretch's middle and the bus at the impact along the way, the view's numbers, the pull's)
    ...(HIGH ? {
      l4: l4 === null ? null : r3(config.splat.inhale + l4), mid: plan?.far ? r1(farMid) : null, atImp: impact ? r1(atImpAlong) : null,
      along: r1((at.x - tap.x) * tap.fx + (at.z - tap.z) * tap.fz), loaded: plan ? !!plan.loaded : null, landNdc: landNdc === null ? null : r3(landNdc),
      busHi: Number.isFinite(busHi) ? r3(busHi) : null, star: { n: starN, in: starIn, held: starHeld }, busImp: r3(busImp), liftImp: r2(liftImp), boundImp, pastAt, hPast: r1(hPast), lobAt, kinds,
      // (L3's aim: the bus's travel to the impact at the gear's speed over L4's flight, as the design has atImp; the bus's own travel is atImp above)
      atImpPlan: l4 === null ? null : r1(table.flown(vt, config.splat.inhale + l4)),
      // (L3's want where its stretch was picked, and that stretch's middle then and at the tap, on the odometer: the same stretch since)
      pick: plan?.far && pickTap ? { mid: r1(pickTap.mid), want: r1(pickTap.want), odo: r1(pickTap.odo) } : null, odoTap: r1(odoTap),
    } : {}),
  };
}

const t0 = Date.now();
const rows: any[] = [];
// (a row whose aim cost over the gate's 0.5 ms is timed again, up to twice, and keeps its least: the sim is the same every run, so what's over the least is the
// laptop's load. Its trimmed mean still failed one row a run beside the extras' browsers, 0.507 at gg-under@30 with a median frame of 0.02-0.09: the Lob's check)
const timed = async (c: Case, dt: number) => {
  const r: any = await run(c, dt);
  for (let i = 0; i < 2 && r.aimMs > 0.5; i++) {
    const q = await run(c, dt);
    r.aimTries = [...(r.aimTries ?? [r.aimMs]), q.aimMs];
    if (q.aimMs < r.aimMs) [r.aimMs, r.aimMsAll] = [q.aimMs, q.aimMsAll];
  }
  return r;
};
for (const c of CASES) {
  if (ONLY && !c.key.includes(ONLY)) continue;
  for (const dt of [1 / 60, 1 / 30]) rows.push(await timed(c, dt));
  if (c.mode === 'bomb') rows.push(await run(c, 1 / 60, false));
}
const OUT = process.env.SB_OUT ?? 'shots/feel/sim';
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/${HIGH ? 'lob-high' : 'lob'}.json`, JSON.stringify({ rows }, null, 1));
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const most = config.lob.most;
for (const r of rows) {
  const id = `${r.key}@${r.fps}${r.slot ? '' : ' (no Lob)'}`;
  console.log(`${id.padEnd(34)} ${r.kind.padEnd(8)} body ${String(r.body.lift).padStart(5)}/${String(r.body.tap).padStart(5)} at ${String(r.body.angle).padStart(5)} t ${String(r.tImpact).padStart(6)} (${r.planTravel}) from ${String(r.from).padStart(7)} up ${String(r.impactScreen?.above ?? '-').padStart(6)} climb ${r.climb} (plan ${r.planAbove}) in ${r.impactScreen?.in ? 'y' : 'n'} r ${r.radius} (${r.wantRadius}) painted ${r.painted} (${r.inside} inside) two ${r.raisedTwo} pull ${r.pull.lob}/${r.pull.of} ${r.pull.flips} top ${r.top} under ${r.underGround} on ${r.on} agl ${r.agl} aim ${r.aimMs} ms`);
  if (!r.slot) continue;
  // (at Nonstop the Comet applies too: the Lob whenever one is planned (config.lob.wins, chooseShot), else the farther. A Comet there only where this
  // frame planned no Lob)
  if (r.want === 'longer' && r.kind === 'comet') ok(r.lobReach === null || (!config.lob.wins && r.from + 1 >= r.lobReach), `${id}: the Comet, no Lob planned${config.lob.wins ? '' : ' or the farther'} (${r.from} against ${r.lobReach})`);
  if (r.want === 'lob' || (r.want === 'longer' && r.kind !== 'comet')) {
    ok(r.kind === 'lob', `${id}: a Lob (${r.kind}, the body ${r.body.lift} at the lift, ${r.body.tap} at the tap)`);
    if (r.kind !== 'lob') continue;
    const one = r.key.includes('/1t'), want = Math.min(most, one ? r.body.lift : r.body.tap);
    ok(Math.abs(r.body.angle - want) <= 0.15, `${id}: thrown at the body ${one ? 'as the steering thumb lifted' : 'at the tap, live'} (${r.body.angle} against ${want}; at the tap ${r.body.tap})`);
    ok(r.tImpact !== null && Math.abs(r.tImpact - r.planTravel) <= 0.05, `${id}: lands on its flight's time (${r.tImpact} against ${r.planTravel})`);
    ok(!!r.impactScreen?.in && r.impactScreen.above >= config.lob.above, `${id}: in frame at the impact, ${config.lob.above * 100} % or more over the bus (${JSON.stringify(r.impactScreen)}, planned ${r.planAbove})`);
    ok(r.radius !== null && Math.abs(r.radius - r.wantRadius) <= 1, `${id}: its radius its fall's from the arc's top, lobRadius (${r.radius} against ${r.wantRadius})`);
    ok((r.on === 'ground' || r.painted >= 5) && r.raisedTwo === 0, `${id}: a level each, none two (${r.painted} painted on ${r.on}, ${r.raisedTwo} two)`);
    ok(r.painted >= r.inside, `${id}: every building well inside its circle a level (${r.painted} painted, ${r.inside} inside 0.8 of it, up to its cap)`);
    ok(r.painted >= r.holds && (!r.struck || r.struck.lv >= 0.5), `${id}: all a tap's circle of its size holds, the building it struck among them (${r.painted} painted of ${r.holds}, struck ${JSON.stringify(r.struck)})`);
    if (r.key.endsWith('/tower')) ok(r.on !== 'ground' && !!r.struck && r.struck.h >= 100 && r.struck.lv >= 0.5, `${id}: the tower that hid its landing takes it (struck ${JSON.stringify(r.struck)} on ${r.on}, ${r.from} m out)`);
    if (r.want === 'lob' && !r.key.includes('nonstop')) ok(r.pull.flips <= 1, `${id}: in the pull, once it shows the Lob stays (${r.pull.lob} of ${r.pull.of} frames, ${r.pull.flips} flips)`);
    ok(r.hitStops === 0, `${id}: no hit-stop (${r.hitStops})`);
    ok(r.underGround <= 2, `${id}: its arc never 2 m into the ground (${r.underGround})`);
    ok(r.from >= 600 && r.from <= config.lob.reach + 1, `${id}: lands in the distance, 600-${config.lob.reach} m (${r.from})`);
  } else if (r.want === 'far') {
    // (the far Lob: thrown, no in-view rule; its radius a tap's from its height; inside the reach; on its flight's time; its arc out of the ground)
    ok(r.kind === 'lob' && r.far === true, `${id}: a far Lob (${r.kind}${r.far ? ', far' : ''}, the body ${r.body.lift} at the lift, ${r.body.tap} at the tap)`);
    if (r.kind !== 'lob') continue;
    ok(r.radius !== null && Math.abs(r.radius - Math.min(config.lob.radiusHigh, blastRadiusFor(r.drop ?? 0))) <= 1, `${id}: its radius a tap's from its height (${r.radius} against ${r.wantRadius}, drop ${r.drop})`);
    ok(r.tImpact !== null && Math.abs(r.tImpact - r.planTravel) <= 0.05, `${id}: lands on its flight's time (${r.tImpact} against ${r.planTravel})`);
    ok(r.from >= 600 && r.from <= (r.shotReach ?? 0) + config.splat.snapReachMax + 1, `${id}: lands in the distance, inside the reach and a snap (${r.from}, the reach ${r.shotReach})`);
    ok(r.underGround <= 2 && r.hitStops === 0, `${id}: its arc never 2 m into the ground, no hit-stop (${r.underGround}, ${r.hitStops})`);
    ok(r.pull.flips <= 1, `${id}: in the pull, once it shows the Lob stays (${r.pull.lob} of ${r.pull.of} frames, ${r.pull.flips} flips)`);
  } else if (r.want === 'high') {
    // (--high: a Lob from every height and gear, far where the near search found nothing)
    ok(r.kind === 'lob', `${id}: a Lob (${r.kind}, the body ${r.body.lift} at the lift, ${r.body.tap} at the tap)`);
    if (r.kind !== 'lob') continue;
    ok(r.tImpact !== null && Math.abs(r.tImpact - r.planTravel) <= 0.05, `${id}: lands on its flight's time (${r.tImpact} against ${r.planTravel})`);
    ok(r.underGround <= 2 && r.hitStops === 0, `${id}: its arc never 2 m into the ground, no hit-stop (${r.underGround}, ${r.hitStops})`);
    // (from the first frame past config.lob.from where the bus is highFrom over the ground under it then: placed at 1 km, rising ground ahead put it under)
    ok(r.pull.flips <= 1 && r.lobAt >= 0 && (r.hPast < config.lob.highFrom || r.lobAt - r.pastAt <= 1), `${id}: planned from the first frame past ${config.lob.from} degrees and never lost (past at ${r.pastAt}, ${r.hPast} m up then, planned at ${r.lobAt}, ${r.pull.flips} flips)`);
    if (!r.far) ok(r.radius !== null && Math.abs(r.radius - r.wantRadius) <= 1 && r.agl < config.lob.highFrom + 400, `${id}: a near one, low enough, its radius lobRadius (${r.radius} against ${r.wantRadius}, ${r.agl} m up)`);
  } else if (r.want === 'wall') {
    ok(r.kind === 'lob' && r.on === 'wall' && r.from < 600 && r.underGround <= 2, `${id}: a tower in its climb takes it on its face (${r.kind} on ${r.on}, ${r.from} m out; the tower's roof ${tower} m over a 26 degree climb)`);
  } else if (r.want === 'miss') {
    ok(r.kind === 'lob-miss' && r.refund >= config.splat.missRefund - 0.02, `${id}: the bay is a Lob's miss, with its refund (${r.kind}, belly after ${r.refund})`);
  } else {
    ok(!r.kind.startsWith('lob'), `${id}: no Lob (${r.kind}, the body ${r.body.lift} at the lift, ${r.body.tap} at the tap)`);
    if (r.key.endsWith('/street')) ok(r.pull.lob === 0 && r.lobStats?.planned === 0 && r.lobStats?.fired === 0, `${id}: on Curb's street no Lob planned, in the pull or at the tap (${r.pull.lob} of ${r.pull.of} frames, ${JSON.stringify(r.lobStats)})`);
  }
  if (HIGH && r.far && (r.want === 'high' || r.want === 'far')) {
    const S = config.splat;
    // (nearest its want, within half a stretch, or a whole one where the reach or aheadMin moves it; on the frame it was picked, the same stretch at the tap)
    const p = r.pick;
    ok(!!p && Math.abs(p.mid - p.want) <= config.lob.stretch && Math.abs(r.mid + r.odoTap - (p.mid + p.odo)) <= 0.5, `${id}: its stretch nearest min(reach, max(lobRange, the bus at the impact + ${config.lob.aheadMin})) where it was picked, the same at the tap (${JSON.stringify(p)}, at the tap ${r.mid} on ${r.odoTap})`);
    ok(Math.abs(r.along - r.mid) <= S.snapReachMax + config.lob.stretch / 2, `${id}: landing on its stretch's building (${r.along} along, the middle ${r.mid})`);
    // (the bus's own travel against the plan's at the gear's speed: 3 m over it at 30 fps from 14 km)
    ok(r.mid - r.atImp >= config.lob.aheadMin - 5 && r.mid <= r.shotReach + 1, `${id}: its stretch ${config.lob.aheadMin} m past the bus at the impact, inside the reach (middle ${r.mid}, the bus at ${r.atImp}, the reach ${r.shotReach})`);
    ok(r.loaded === true && r.on !== 'water', `${id}: on loaded ground (${r.loaded}, on ${r.on})`);
    ok(r.l4 !== null && Math.abs(r.tImpact - r.l4) <= 0.05, `${id}: the tap to the hit by L4 (${r.tImpact} against ${r.l4})`);
    ok(r.radius !== null && Math.abs(r.radius - Math.min(config.lob.radiusHigh, blastRadiusFor(r.drop))) <= 1, `${id}: its radius a tap's from its height (${r.radius}, drop ${r.drop})`);
    // (the star on the lens on 90 % of its frames in the air, where the view's limits let it: at the ceiling the dip stays within config.shotView.swing of
    // the sky's lift, about level, and the hit is under the frame, the design's (V5))
    if (!r.key.includes('/ceil/')) ok(r.star.n > 0 && r.star.in + r.star.held >= 0.9 * r.star.n, `${id}: the star on the lens on 90 % of its frames in the air, but where the view's limits hold it from it (${r.star.in} of ${r.star.n}, ${r.star.held} held out)`);
    ok(r.busHi !== null && r.busHi <= config.shotView.busMax + 0.005, `${id}: the bus at +${config.shotView.busMax} or lower every frame to ${config.shotView.hold} s after the hit (${r.busHi})`);
    // (where the bus's limit allows it: the bus not at busMax at the impact, and the dip not at its swing or its most. Fast and low, the bus has flown to
    // within 300-400 m of the landing by its impact, which shows under it)
    const bound = r.boundImp || r.busImp >= config.shotView.busMax - 0.02 || r.liftImp <= -(Math.min(config.shotView.swing, config.shotView.most) - 0.5);
    if (r.agl <= 5000) ok(r.landNdc !== null && (r.landNdc >= -0.25 || bound), `${id}: the hit at -0.25 or higher at the impact where the bus allows it (${r.landNdc}, the bus ${r.busImp}, the lift ${r.liftImp}, ${r.agl} m up)`);
  }
  if (r.key.includes('/climb/')) ok(r.kinds <= 1 && r.far === true, `${id}: the slow climb's kind changes at most once, and the tap at the top a far Lob (${r.kinds} changes, ${r.kind}${r.far ? ', far' : ''})`);
  // (M90: after the lift's latch, a flick or a Lob and taps mashed on the empty belly: the next tap is a plain splat, the first of the mash a Lob)
  if (r.key.endsWith('/flick-after') || r.key.endsWith('/mash') || r.key.endsWith('/look-after')) ok(r.kind === 'splat' && (r.first === undefined || r.first === 'lob'), `${id}: a plain splat, the latch long ended (${r.kind}, the body ${r.body.lift} at the lift, ${r.body.tap} at the tap, ${r.body.angle} thrown${r.first ? `; the first tap ${r.first}` : ''})`);
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
    // (--high: a far one whose want sat on a stretch's edge at both rates, within 1 m, may land on the stretch either side. dt-1000/cruise/b70/1t's was
    // 1,260.0 on the odometer at both, 1260 an edge: a quantized landing has an edge somewhere, and only there do the two rates part)
    const Ls = config.lob.stretch, edge = (q: any) => !!q?.pick && Math.abs(((q.pick.odo + q.pick.want) / Ls) - Math.round((q.pick.odo + q.pick.want) / Ls)) * Ls <= 1;
    const tie = HIGH && r.far && s?.far && edge(r) && edge(s) && Math.abs(Math.abs(r.mid + r.odoTap - (s.mid + s.odoTap)) - Ls) <= 0.5;
    ok(!!s && s.kind === r.kind && (tie || Math.hypot(s.landing[0] - r.landing[0], s.landing[1] - r.landing[1], s.landing[2] - r.landing[2]) <= 2) && Math.abs((s.tImpact ?? 0) - (r.tImpact ?? 0)) <= 0.05, `${r.key}: 30 and 60 fps within 2 m and 0.05 s${tie ? ', or a stretch apart on a tie' : ''} (${JSON.stringify([r.kind, r.landing, r.tImpact])} against ${JSON.stringify(s ? [s.kind, s.landing, s.tImpact] : null)})`);
  }
  // (what the aim costs a frame while it plans the Lob, in Node: the plan's 0.035-0.066 ms for its plan alone, 0.02-0.09 a row's median with the hider on a
  // loaded laptop; its slowest 2 % of frames left out)
  ok(r.aimMs <= 0.5, `${id}: the aim 0.5 ms a frame or less (${r.aimMs}, ${r.aimMsAll} with its slowest frames${r.aimTries ? `; timed ${r.aimTries.join(', ')}` : ''})`);
}
console.log(`${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(fails.length ? `LOB FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `lob checks: all ${checks} passed`);
process.exit(fails.length ? 1 : 0);
