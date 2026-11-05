import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { Landing } from '../moon/Landing';
import { spaceResolveUniforms as U } from '../render/skyResolve';
import { BusModel, busTune, type BusPose } from '../bus/BusModel';
import { config } from '../config';
import { CameraRig } from '../game/CameraRig';
import { Input, inputTune } from '../game/Input';
import { globals } from '../render/materials';
import type { PixelPipeline } from '../render/PixelPipeline';
import type { WarmUp } from '../render/warmup';
import { Hud } from '../ui/Hud';
import { Perf } from '../ui/Perf';
import { C, HUD_SMALL, PixelCanvas, textWidth } from '../ui/pixelUi';
import { Tuner } from '../ui/Tuner';
import { registerTunables } from '../ui/tunables';
import { MoonBreath } from './MoonBreath';
import { MoonNames, nameTune } from './MoonNames';
import { ALT4, earthStep, LEG_NAMES, MoonTrip, PULL, RUNG_TOP, TAU, YOKE } from './MoonTrip';
import { rungName } from '../game/Turbo';
import { series } from './Series';
import { SkyClock } from './SkyClock';
import { groundTune, SkyDraw } from './SkyDraw';
import { EARTH, MOON, R_MOON, SkyModel, SkyState, type Observer } from './SkyModel';
import { applySpaceTable } from './SkyTable';
import { SpaceFx, spaceFxTune } from './SpaceFx';
import { EasterEgg } from './EasterEgg';
import { SWING, TripView } from './TripView';
import { EarthLanding, type StreetWorld } from './EarthLanding';
import { earthResume, SWAP_FRAME, SWAP_KEY } from './flag';
export { laterStreet } from './EarthLanding';
import { geodeticToFix, sphereToFix } from './WorldFrame';

// ?moonrun: MOONSHOT.md's black box. Space only: no city streams, the bus sits at the render origin, and the real pipeline and resolve draw it. Earth, Moon and Sun come from the real sky
// model; everything out here is a direction or a ray test, so nothing at 384,400 km ever enters the render frame.
//
// `?view=` puts the bus anywhere, to look (see readView below). With none it waits 300 km over San Francisco and flies: MoonTrip.ts is the route, TripView.ts the camera and the lens, SpaceFx.ts the lines and
// the trail. A flick up (E, PageUp) shifts up, a flick down (Q, PageDown) down; the thumb (arrows) steers over a body and swings the camera everywhere else, and a thumb in the left of the screen looks, as on the street. `?t=` sets the date and
// `?g5=` G5's speed in km/s.
//
// The frame's order, which flight keeps: move `pose.ob` (pos and axes, float64) -> `model.frame(ms, ob, sky)` -> `draw.update(sky)` -> the light on the bus -> bus and camera -> `pipeline.render(scene)`.
// The lens first if it changes (`pipeline.setHfov`): `draw.update` reads the focal length. Open-space flight is `free: true`: pos in EQJ km from Earth's centre, axes the render axes in EQJ by rows, as
// view=mid does; it needs no handover all the way to the Moon, and rebaseBody is there for when a Moon-fixed orbit wants it. The bus never leaves the render origin, so speed reaches the frame only through
// the Observer. The camera may turn freely: rays and stars both go through the snapped camera. Whatever else draws goes into the scene before `warm.add(scene)`, or it compiles in flight.
// The bus is the size it is over the city, wherever it flies: the rig's own distance and heroic scale, so what stands round it does too.
// `?tau=` sets the way in's time constant, and `?tune` (or three fingers) opens the tuner, whose "Moon run" rows are live: the way in, the view and what goes with the bus.
// A tap in orbit is a breath: MoonBreath.ts, after the sky and the view; the paint it leaves is MoonPaint.ts's map, read by the resolve's spaceMoon. A hit-stop holds `dt` and not the screen's `real`.
// The ground under the orbit is MoonGround.ts's, made on a worker after the first frame, and the places on it are named by MoonNames.ts: both are behind a URL row too, `?relief= &craters= &bright= &flat= &hill= &wander= &sharp= &keep=`.

const DEG = Math.PI / 180;
/** Half the portrait's vertical field on the 38 degree lens, degrees: what the rig's pitch rule is measured with (earth/geom.py). */
const HALF_V = 36.87;
const R_VIEW_EARTH = 6371;
/** The flight's Moon, on its steady floor (SkyModel.ts's moonDrawnKm): this leaves it 15 px across where the flight starts, and growing. */
const STEADY_FLOOR = 43;
/** ...and drawn this many times its true size from Earth, coming to its true size near it (SkyDraw.moonGrow): about 58 px across at the start, and growing all the way. */
const MOON_GROW = 5;

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V3): V3 => scale(a, 1 / Math.hypot(...a));

/** Where the bus is and how the frame lies, and the bus's own axes in the render frame. */
export interface Pose {
  ob: Observer;
  busFwd: THREE.Vector3;
  busUp: THREE.Vector3;
  showBus: boolean;
}

/** Rows right, up, back: a camera at the render origin with no rotation looks down -Z, along fwd. */
function viewAxes(right: V3, up: V3, fwd: V3): Float64Array {
  return Float64Array.from([...right, ...up, -fwd[0], -fwd[1], -fwd[2]]);
}

/** A level heading (degrees from north), pitched down by `pitch`, at the radial `u` of a body whose north is `north`: earth/globe.py's look(). */
function lookFrom(u: V3, north: V3, headingDeg: number, pitchDeg: number): { right: V3; up: V3; fwd: V3; level: V3 } {
  const e = unit(cross(north, u)), n = cross(u, e);
  const h = headingDeg * DEG, p = pitchDeg * DEG;
  const level = add(scale(e, Math.sin(h)), n, Math.cos(h));
  const fwd = add(scale(level, Math.cos(p)), u, -Math.sin(p));
  const r = cross(fwd, u), rl = Math.hypot(...r);
  const right = rl < 1e-6 ? add(scale(e, Math.cos(h)), n, -Math.sin(h)) : scale(r, 1 / rl);
  return { right, up: cross(right, fwd), fwd, level };
}

/** The pitch that holds the horizon 3 degrees under the top of the frame, and never past straight down (earth/geom.py). */
const pitchPinned = (rBody: number, h: number) => Math.min(90, Math.acos(rBody / (rBody + h)) / DEG + HALF_V - 3);

/**
 * The views, all from the URL:
 *   view=earth&km=20000[&lat=&lon=&heading=&pitch=]   over a place (San Francisco), looking along a heading, the horizon held under the top of the frame, then straight down
 *   view=moon&km=13000[&lat=&lon=&heading=&pitch=]    over a place on the Moon, by default where Earth is overhead: how you arrive
 *   view=mid[&f=0.5&look=moon]                        a share of the way from Earth to the Moon, looking at either
 *   view=sky&body=earth&lat=&lon=&km=&az=&el=         standing on a body and looking along azimuth and elevation: the frame centre is that direction (tools check SKY's fixtures with it)
 * With any of them: t= (date), rate=, lens= (hfov, 38), bus=0, lines=0, air=0, airpx= (the air's floor, game px), floor= (the Moon's floor in px, 15; 0: true size).
 */
function readView(params: URLSearchParams, model: SkyModel, sky: SkyState, ms: number): Pose {
  const num = (k: string, d: number) => (params.has(k) && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : d);
  const view = params.get('view') ?? 'earth';
  const showBus = params.get('bus') !== '0' && view !== 'sky';
  const pole: V3 = [0, 0, 1];
  let ob: Observer;
  let level: V3, up: V3;
  // (the Moon and Sun, for the views that need them)
  const probe: Observer = { body: EARTH, free: true, pos: Float64Array.from([7000, 0, 0]), axes: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
  model.frame(ms, probe, sky);
  if (view === 'mid') {
    const m = [...model.moonEqj] as V3;
    const f = num('f', 0.5);
    const pos = scale(m, f);
    const to = unit(params.get('look') === 'earth' ? scale(m, -1) : m);
    const right = unit(cross(to, pole));
    const u = cross(right, to);
    ob = { body: EARTH, free: true, pos: Float64Array.from(pos), axes: viewAxes(right, u, to) };
    level = to;
    up = u;
  } else if (view === 'sky') {
    const body = params.get('body') === 'moon' ? MOON : EARTH;
    const lat = num('lat', 37.7749), lon = num('lon', -122.4194), h = num('km', 0);
    const pos = body === EARTH ? geodeticToFix(lat, lon, h, new Float64Array(3)) : sphereToFix(R_MOON, lat, lon, h, new Float64Array(3));
    const sp = Math.sin(lat * DEG), cp = Math.cos(lat * DEG), sl = Math.sin(lon * DEG), cl = Math.cos(lon * DEG);
    const u: V3 = [cp * cl, cp * sl, sp], e: V3 = [-sl, cl, 0], n: V3 = [-sp * cl, -sp * sl, cp];
    const az = num('az', 0) * DEG, el = num('el', 45) * DEG;
    const fwd = add(add(scale(e, Math.cos(el) * Math.sin(az)), n, Math.cos(el) * Math.cos(az)), u, Math.sin(el));
    const right = unit(cross(fwd, u));
    const up2 = cross(right, fwd);
    ob = { body, free: false, pos, axes: viewAxes(right, up2, fwd) };
    level = fwd;
    up = up2;
  } else {
    const onMoon = view === 'moon';
    const rBody = onMoon ? R_MOON : R_VIEW_EARTH;
    const h = num('km', 300);
    const pos = new Float64Array(3);
    let radial: V3;
    if (onMoon && !params.has('lat')) {
      // the point under Earth, what the route arrives over
      const f = model.moonFix, m = model.moonEqj, l = Math.hypot(m[0], m[1], m[2]);
      radial = [-(f[0] * m[0] + f[1] * m[1] + f[2] * m[2]) / l, -(f[3] * m[0] + f[4] * m[1] + f[5] * m[2]) / l, -(f[6] * m[0] + f[7] * m[1] + f[8] * m[2]) / l];
      pos.set(scale(radial, R_MOON + h));
    } else {
      const lat = num('lat', onMoon ? 0.67416 : 37.7749), lon = num('lon', onMoon ? 23.47314 : -122.4194);
      if (onMoon) sphereToFix(R_MOON, lat, lon, h, pos);
      else geodeticToFix(lat, lon, h, pos);
      const sp = Math.sin(lat * DEG), cp = Math.cos(lat * DEG);
      radial = [cp * Math.cos(lon * DEG), cp * Math.sin(lon * DEG), sp];
    }
    const pitch = num('pitch', pitchPinned(rBody, h));
    const L = lookFrom(radial, pole, num('heading', 95), pitch);
    ob = { body: onMoon ? MOON : EARTH, free: false, pos, axes: viewAxes(L.right, L.up, L.fwd) };
    level = L.level;
    up = radial;
  }
  // the bus's nose and roof in the render frame: the axes' rows are the render axes in that frame
  const a = ob.axes;
  const inRender = (v: V3) => new THREE.Vector3(a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]);
  const busFwd = inRender(level);
  const busUp = inRender(dot(level, up) > 0.999 ? [a[3], a[4], a[5]] : up);
  return { ob, busFwd, busUp, showBus };
}

const thousands = (n: number) => Math.round(n).toLocaleString('en-US');

/** The crater shot's glint off the heading, km ahead for a km of height: about where the view's aim is on the ground, which is what it stands in for when that misses. */
const AHEAD_PER_KM = 1.8;

/** s the welcome stands. */
const WELCOME_S = 5;

/**
 * The moon boost, km/s: from TO THE MOON? to the orbit in 4.7 to 5.1 minutes, and from TO PLANET EARTH? to over home in 5.4 to 6.0, as MoonTrip flies it in Node on four dates of five (DECISIONS.md).
 * When the Moon is behind Earth the level run round it adds two.
 */
const MOON_BOOST = 1550;

/** A pan across the screen's width turns the view this many half turns; up and down, this many (a flick is a short stroke up, and what it tips goes back). */
const PAN_X = 1;
const PAN_Y = 0.5;

/** The page change in the long dark (docs/specs/earth/EARTHFLIGHT.md, E3): s of trip into 'cruise' or 'homeCruise', where nothing but the stars, the bus and its trail is on screen, and what the next page keeps of this one's URL:
 *  the city and the hour too, so a trip from ?earth&city=london comes home to London's street (the first account's review, 2026-11-04: it came home to San Francisco's, with London as the trip's home). */
const SWAP_AFTER = 3;
const SWAP_KEEP = ['fps', 't', 'tune', 'g5', 'fixeddt', 'city', 'hour'];

/** The trip and its view the page before saved (?resume), taken out of storage as they're read: a reload starts afresh. */
function readSwap(): { trip: Record<string, unknown>; view: Record<string, unknown> } | null {
  try {
    const s = sessionStorage.getItem(SWAP_KEY);
    sessionStorage.removeItem(SWAP_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** The tuner's rows for the flight, read every frame. The bus's and the trail's live with those. */
const tripTune = { tau: TAU, pullDegS: PULL / DEG, swing: SWING, busSunSoft: 0.75 };

/** The label's font, with the one sign the HUD has never needed. */
const LABEL: typeof HUD_SMALL = { ...HUD_SMALL, glyphs: new Map(HUD_SMALL.glyphs).set('%', { w: 3, bits: Uint8Array.from([1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1]) }) };

/** What the flight says: the leg and its clock, the gear, how far up, what a tap would do now, and how much of the Moon is yours. A corner of the frame, redrawn when a line changes. */
function tripLabel(orbitPaint: boolean): (trip: MoonTrip, breath: MoonBreath | null) => void {
  const c = new PixelCanvas(122, 30, 2);
  Object.assign(c.el.style, { position: 'fixed', zIndex: '21', pointerEvents: 'none', right: 'max(14px, env(safe-area-inset-right))', top: 'max(8px, env(safe-area-inset-top))' });
  c.el.dataset.hud = 'trip-label';
  document.body.append(c.el);
  let last = '';
  return (trip, breath) => {
    const s = Math.floor(trip.clock), leg = trip.leg;
    const a = `${leg === 'fall' && trip.nose > 0.02 ? 'GOING UP' : LEG_NAMES[leg]} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    // (at the Moon from the orbit down, the street's gear by name)
    const g = leg === 'wait' || leg === 'orbit' || leg === 'fall' ? rungName(trip.rung, trip.level) : trip.gear === 5 ? 'MOON BOOST' : `G${trip.gear}`;
    // (low over Earth, the height over its ground in metres)
    const hk = leg === 'wait' ? trip.hGround : Math.min(trip.hMoon, trip.hEarth);
    const b = `${g} ${trip.v < 1 ? `${Math.round(trip.v * 1000)} M` : trip.v < 10 ? `${trip.v.toFixed(1)} KM` : `${thousands(trip.v)} KM`}/S ${hk < 10 ? `${Math.round(hk * 1000)} M` : `${thousands(hk)} KM`}`;
    // (extremely high the easter egg is the way on: the label says nothing of where it goes)
    const dark = leg === 'cruise' || leg === 'homeCruise';
    // (free, over Earth and at the Moon, a flick up is a step up, and at the top nothing: the button is flown up to. Only with no ground to go down to, ?moonrun's, is it the climb to TO PLANET EARTH? still)
    const top = (leg !== 'orbit' && leg !== 'fall' && leg !== 'wait') || trip.rung >= RUNG_TOP;
    const p = !top ? '' : orbitPaint && leg === 'orbit' ? 'FLICK UP TO CLIMB' : dark ? 'DRAG TO CARVE' : '';
    // the goal, once there is any; and until the first shot, what to do about it
    const share = breath && !breath.paint.rebuilding ? breath.paint.painted * 100 : 0;
    // (a crater from orbit is a few thousandths of a percent: it shows)
    const d = share > 0 ? `PAINTED ${share < 0.01 ? share.toFixed(4) : share < 1 ? share.toFixed(2) : share < 10 ? share.toFixed(1) : share.toFixed(0)} % OF THE MOON` : '';
    const e = orbitPaint && leg === 'orbit' && breath && !breath.fired ? 'TAP TO PAINT' : ''; // (a toast says this, large)
    const text = `${a}|${b}|${p}|${d}|${e}`;
    if (text === last) return;
    last = text;
    c.el.dataset.say = text; // (the tools read what the screen says from here)
    c.clear();
    [a, b, p, d].forEach((t, i) => c.textOutlined(t, c.w - 2 - textWidth(t, LABEL), 1 + i * 7, i === 2 ? C.yellow : C.text, C.ink, LABEL));
    c.flush();
  };
}

export interface MoonrunContext {
  pipeline: PixelPipeline;
  scene: THREE.Scene;
  warm: WarmUp;
  /** ?moonland: what this page's two loops share, one thumb, one sound and one look */
  land?: { input: Input; audio: AudioEngine; rig: CameraRig };
  /** ?earth: the street, which has the bus and the frame until it hands them up (EarthLanding.ts). land is what the two share, as under ?moonland, and there's no Moon's low game */
  earth?: StreetWorld;
  /** the page's one clock (CONTRACT.md O3): the street's live sky reads it too. Without it the flight makes its own */
  clock?: SkyClock;
}

/** Returns what joins this to the low game, under ?moonland; under ?earth, the join to the street. */
export async function bootMoonrun({ pipeline, scene, warm, land, earth, clock: pageClock }: MoonrunContext): Promise<Landing | EarthLanding | null> {
  const params = new URLSearchParams(location.search);
  const t0 = performance.now();
  const renderer = pipeline.renderer;
  // (the sky is the clear flag and nothing else; no sun pass, no fog; calm pixels on the bus, as up high. Under ?earth the street has the frame and these wait for the flight to take it)
  const takeFrame = (world: boolean) => {
    pipeline.setFar(30000);
    pipeline.shadowStrength = 0;
    pipeline.calm = 1;
    globals.uLight.value.set(0.62, 0.2, 0.05);
    // (and the palette: with the day's world rows where the flight has the page first; at the street's hand-up its own rows alone, so the bus and the rest keep the
    // street's table, the live sky's or the held hour's, with no jump at 15 km. Review four, 7)
    applySpaceTable(pipeline.paletteTexture, world);
  };
  // (?earth&resume: home from the Moon's page, the flight has the frame from the start, and the street boots behind it)
  const flightFirst = !earth || earthResume;
  // (with the day's world rows only where there's no street table: ?earth&resume's street wrote its live sky's before this, main.ts, and that's what the way home draws on)
  if (flightFirst) takeFrame(!earth);
  // (behind the street, the space sky's own rows at once: from 8 km up the street draws space's sky and from 11 km the plain Earth, and nothing else names those rows.
  // Before, they waited for the hand-up, and the whole first climb by day drew them black. Review four, 5)
  else applySpaceTable(pipeline.paletteTexture, false);

  const perf = new Perf(renderer);
  perf.setVisible(params.has('fps'));

  const model = new SkyModel(series);
  const sky = new SkyState();
  const clock = pageClock ?? new SkyClock(params);
  const flying = !params.has('view');
  // (?launch=: a trip that starts climbing, the way the bus was flying, over ?home=lat,lon: where the old launch from the street, gone now, went. trip-fuzz.mjs's every fifth player starts so)
  const launch = flying && params.has('launch') ? Number(params.get('launch')) || 0 : undefined;
  const home = (params.get('home') ?? '').split(',').map(Number);
  const homeAt = home.length === 2 && home.every(Number.isFinite) ? { lat: home[0], lon: home[1] } : {};
  const trip = flying ? new MoonTrip(series, clock.now(), { g5: Number(params.get('g5')) || MOON_BOOST, land: !!land && !earth, launch, street: !!earth, ...(earth ? { lat: earth.origin[0], lon: earth.origin[1] } : homeAt) }) : null;
  // (and it comes up out of the dark the street went into)
  let dark: HTMLDivElement | null = null;
  if (launch !== undefined) {
    dark = document.createElement('div');
    Object.assign(dark.style, { position: 'fixed', inset: '0', zIndex: '40', background: '#000', pointerEvents: 'none', transition: 'opacity 1.6s ease-out' });
    document.body.append(dark);
  }
  if (land) Object.assign(YOKE, { dead: config.flight.yokeDead, up: Math.min(config.flight.noseUp, 89) * DEG, down: Math.min(config.flight.noseDown, 89) * DEG, curve: config.flight.noseCurve, rate: config.flight.noseRate });
  const view = flying ? new TripView() : null;
  // (?resume: the trip goes on from the page before, from the moment its last frame was taken, which index.html holds on the screen until this page's third)
  const resumed = trip && view && params.has('resume') ? readSwap() : null;
  if (resumed && trip && view) {
    trip.resume(resumed.trip);
    view.resume(resumed.view);
  }
  const pose = flying ? null : readView(params, model, sky, clock.now());

  const draw = new SkyDraw(pipeline);
  const landing = land && !earth && trip && view ? new Landing(trip, view, pipeline, scene, draw, model, sky) : null;
  const earthLanding = earth && trip && view ? new EarthLanding(trip, view, model, sky, draw, earth) : null;
  if (earthLanding && flightFirst) earthLanding.ground = false;
  if (trip) {
    draw.moonSteady = true;
    draw.moonFloor = STEADY_FLOOR;
    draw.moonGrow = MOON_GROW;
  }
  if (params.has('floor')) draw.moonFloor = Number(params.get('floor')) || 0;
  if (params.has('grow')) draw.moonGrow = Math.max(1, Number(params.get('grow')) || 1);
  if (params.get('lines') === '0') draw.showLines(false);
  draw.air = params.get('air') !== '0';
  if (params.has('airpx')) draw.airPx = Number(params.get('airpx')) || draw.airPx;
  scene.add(draw.object);
  const bus = new BusModel();
  bus.root.visible = pose ? pose.showBus : params.get('bus') !== '0';
  scene.add(bus.root);
  const fx = flying ? new SpaceFx(bus.length) : null;
  if (fx) scene.add(fx.object);
  const breath = new MoonBreath(pipeline, bus);
  scene.add(breath.particles.object);
  if (landing) landing.big = (s) => breath.lowStroke(s);
  const names = trip ? new MoonNames() : null;
  if (names) scene.add(names.object);
  const busPose: BusPose = { squash: 1, eye: 1, fullness: 1, mouth: 0, speed: 0, wheeze: 0, heave: 0 };

  // ---- the lens, and the chase: bus at the origin, the camera behind and above it with no rotation, so the bus sits low in the frame and the view is what the axes say
  const camera = pipeline.camera;
  const pitchAxis = new THREE.Vector3(1, 0, 0);
  const lensParam = Number(params.get('lens')) || 0;
  const lens = lensParam || config.camera.hfovVista;
  const lensOn = () => {
    pipeline.setHfov(lens);
    pipeline.setDepthRange(1.5, 30000);
  };
  if (flightFirst) lensOn();
  const focalAt = () => 1 / pipeline.pixelWorldSize(1);
  const placeCamera = () => {
    bus.root.scale.setScalar(config.camera.heroScaleVista);
    // (where the rig stands, off the bus: flying, the view says how far under the line of sight that is. To look at a place, a quarter of the frame under its middle)
    const D = config.camera.distanceVista, below = view ? view.below : Math.atan((0.25 * pipeline.info.height) / focalAt());
    camera.position.set(0, D * Math.sin(below), D * Math.cos(below));
    camera.quaternion.setFromAxisAngle(pitchAxis, breath.kick);
  };
  if (flightFirst) placeCamera();
  // (under ?earth all of that is the flight's when it takes the frame from the street)
  if (earthLanding)
    earthLanding.onTake = () => {
      takeFrame(false);
      lensOn();
      placeCamera();
    };
  // the tuner, as the street's: `?tune` or three fingers
  const tuner = new Tuner();
  registerTunables('Moon run', tripTune, { tau: [4, 30, 0.5], pullDegS: [1, 10, 0.1], swing: [0.2, 1.5, 0.01], busSunSoft: [0, 1, 0.01] });
  registerTunables('Moon run: what goes with it', spaceFxTune, { linePx: [1, 3, 0.1], lineLong: [0.005, 0.1, 0.001], trailWave: [0, 30, 0.5], trailFlow: [0.5, 8, 0.1], trailPuff: [0, 2, 0.05], trailSparkle: [0, 0.5, 0.01] });
  registerTunables('Moon run: names', nameTune, { every: [2, 20, 0.5], font: [1, 3, 0.1], high: [300, 8000, 100], fast: [30, 600, 5] });
  registerTunables('Moon run: the ground', groundTune, { relief: [0, 8, 0.1], craters: [0, 2, 0.05], bright: [0, 2, 0.05], flat: [0, 4, 0.1], hill: [0, 2, 0.05], wander: [0, 2, 0.05], sharp: [-1.5, 1, 0.1], keep: [0.01, 0.3, 0.01] });
  if (params.has('tune')) tuner.toggle();
  // (the URL wins over a saved row)
  if (params.has('tau')) tripTune.tau = Number(params.get('tau')) || TAU;
  for (const k of Object.keys(groundTune) as Array<keyof typeof groundTune>) if (params.has(k)) groundTune[k] = Number(params.get(k));
  if (pose) {
    const z = pose.busFwd.clone().negate();
    const x = pose.busUp.clone().cross(z).normalize();
    const y = z.clone().cross(x);
    bus.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }

  // ---- the thumb and the flicks: the real Input and the real HUD, less what has no meaning out here. A flick up is what TURBO's tap was, and a flick down its down tab
  const input = flying ? (land?.input ?? new Input(renderer.domElement)) : null;
  const hud = input ? new Hud(input, { onMute() {}, onSwap() {}, onGesture() {} }) : null;
  // (the look is the rig's: on ?moonland the low game's own, so a look held across a join goes on across it)
  const looker = input ? (land?.rig ?? new CameraRig()) : null;
  // (where each panning thumb was last frame)
  const lookAt = new THREE.Vector2(), busOnScreen = new THREE.Vector3(), busZone = { x: 0, y: 0, r: 0, open: 0 };
  let lookOn = false;
  // (on Earth's page a Moon reached with its page change refused has nothing to paint from orbit, and nothing says there is: review four, 21)
  const label = flying ? tripLabel(!landing && !earthLanding) : null;
  /** ?moonland: a tap now is a crater shot, from the orbit down to where the ground's mesh comes in. */
  // (from the orbit down: over it, where the free leg flies on up to TO PLANET EARTH?, nothing, as there's no paint from high orbit)
  const craterHigh = () => !!landing?.world && !!trip && (trip.leg === 'orbit' || (trip.leg === 'fall' && trip.hMoon <= ALT4 + 1)) && !landing.near && !landing.ground;
  // the easter eggs, and what the HUD said on arriving
  const eggMoon = new EasterEgg('TO THE MOON?', 'to-moon', () => trip?.toMoon());
  const eggEarth = new EasterEgg('TO PLANET EARTH?', 'to-earth', () => trip?.toEarth());
  let legWas = trip?.leg ?? 'wait', welcomeAt = -1e9;
  if (input && hud && trip) {
    // (?earth, the street up first: the thumb is the street's until the flight has the bus, and through the boot too, which may fail. The flight's hands are made here and handed to the join, and the street's put back
    // before anything is waited on. The first account's review, 2026-11-04: they went to the flight for the boot, and for good if it failed)
    const streetHands = earth && !flightFirst ? { onTap: input.onTap, onTurbo: input.onTurbo, onTripleFinger: input.onTripleFinger, onFirstGesture: input.onFirstGesture, onPress: input.onPress, onChargeStart: input.onChargeStart, onChargeEnd: input.onChargeEnd } : null;
    input.onTripleFinger = () => tuner.toggle();
    input.onTurbo = (dir) => {
      view?.flicked();
      if (dir < 0) trip.shiftDown();
      else trip.tap();
    };
    // the game's sound, for the breath alone: its one-shots, no wind (there's no air) and no engine (the graph's frame never runs, so nothing but a breath makes a noise)
    const audio = land?.audio ?? new AudioEngine();
    // (the street's engine is the street's: its wind and foghorn stay as it set them, where this turned them off for the session)
    if (!streetHands) audio.setVolumes({ ...config.audio, ambience: 0 });
    audio.warmBackend();
    input.onFirstGesture = () => audio.unlock();
    breath.audio = audio;
    // a tap is a breath, as on the street: the place it touched goes in first, since Input reads the event after this. ?moonland paints nothing from orbit, the producer's word:
    // "i just splatted .04 percent of the moon in one shot. this is terrible". There paint is a crater at a time, from the low game
    // From the orbit down to the ground's mesh, a tap is a crater shot: the crater under the aim takes a level, as one does from the low game (VOYAGE.md V2c). (Under the mesh's height the shot's
    // stand-ins don't stand in the world's frame yet, so there it's nothing until the low game has the bus.)
    input.onTap = () => {
      const high = craterHigh();
      breath.tap(high || (trip.leg === 'orbit' && !landing && !earthLanding), high);
    };
    // (out here there's no MEGA to charge: a press on Space is the flight's, and a hold ends as a breath, where on ?earth it charged the street's MEGA under the flight. The first review's minor)
    const flightTap = input.onTap;
    input.onPress = null;
    input.onChargeStart = null;
    input.onChargeEnd = (_held, cancelled) => {
      if (!cancelled) flightTap();
    };
    breath.onCrater = landing ? (lat, lon, hue) => landing.world?.paintAt(lat, lon, hue) ?? null : null;
    const touched = (e: PointerEvent) => {
      if (e.target === renderer.domElement) breath.touched(e.clientX, e.clientY);
    };
    window.addEventListener('pointerdown', touched, true);
    window.addEventListener('pointerup', touched, true);
    for (const name of ['mega', 'settings']) hud.root.querySelector<HTMLElement>(`[data-hud="${name}"]`)?.style.setProperty('visibility', 'hidden');
    hud.arrive();
    if (streetHands && earthLanding) {
      earthLanding.hands = { onTap: input.onTap, onTurbo: input.onTurbo, onTripleFinger: input.onTripleFinger, onFirstGesture: input.onFirstGesture, onPress: input.onPress, onChargeStart: input.onChargeStart, onChargeEnd: input.onChargeEnd };
      Object.assign(input, streetHands);
    }
  }

  const rearQ = new THREE.Quaternion();
  const labelEl = () => document.querySelector<HTMLElement>('[data-hud="trip-label"]');
  let asked = false;
  let resizeWanted = false;
  const wantResize = () => (resizeWanted = true);
  window.addEventListener('resize', wantResize);
  window.visualViewport?.addEventListener('resize', wantResize);
  // (a lost context is a crash in this flight, and it says so: nothing here rebuilds)
  renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());

  // ---- before the first frame: the programs, the maps. Both start now, side by side
  warm.add(scene);
  await Promise.all([warm.finish(), draw.load('./sky')]);
  const page = new URL('.', location.href).href.replace(/\/$/, '');
  draw.loadGround(page);
  names?.load(page);
  breath.load();
  breath.audio?.prepare();
  // (and the stars' and lines' real geometry was built after their proxies: same layout, same programs)
  const load = {
    ...draw.timing,
    linkMs: warm.report?.resolveLinkMs ?? 0,
    drawMs: warm.report?.resolveDrawMs ?? 0,
    readyMs: Math.round(performance.now() - t0),
    firstFrameMs: 0,
  };
  perf.setBuild(load.linkMs, load.drawMs, `space ${load.readyMs} ms`);

  const fixedDt = params.has('fixeddt') ? Math.max(0.001, Number(params.get('fixeddt')) || 1 / 60) : 0;
  let last = performance.now();
  let time = 0;
  const popSign = () => breath.audio?.signPop();
  let frames = 0;
  // (tools: time stands still and the frame goes on drawing, so a shot is of the moment it asked for)
  let held0 = false;
  // (the long dark: when the leg began, and the page this one has gone to, if it has)
  let darkLeg = trip?.leg, darkAt = trip?.t ?? 0, gone = false, swapTried = false;
  /** The page for where the bus is going, in the long dark: the Moon's out of Earth's, Earth's home from the Moon's. ?moonland&swap: out of the Moon's too, for tools/earth/swap.mjs. */
  const swapTo = (): string | null => (!trip ? null : trip.leg === 'cruise' && (earthLanding || params.has('swap')) ? 'moonland' : trip.leg === 'homeCruise' && landing ? 'earth' : null);
  /**
   * The trip and the view into sessionStorage, and the frame just drawn if there's room for it (without, the change is a cut in the dark), and on to the next page. False if storage
   * won't have even the trip: the trip goes on on this page, and it's tried once a leg, not each frame. The first review's minor: a full-screen JPEG a frame, while storage was full.
   */
  const swap = (to: string): boolean => {
    if (!trip || !view) return false;
    try {
      sessionStorage.setItem(SWAP_KEY, JSON.stringify({ trip: trip.save(), view: view.save() }));
    } catch {
      return false;
    }
    try {
      sessionStorage.setItem(SWAP_FRAME, renderer.domElement.toDataURL('image/jpeg', 0.85));
    } catch {
      try {
        sessionStorage.removeItem(SWAP_FRAME);
      } catch {
        /* blocked */
      }
    }
    const keep = SWAP_KEEP.filter((k) => params.has(k)).map((k) => (params.get(k) ? `&${k}=${encodeURIComponent(params.get(k)!)}` : `&${k}`));
    location.replace(`${location.pathname}?${to}&resume${keep.join('')}`);
    return true;
  };
  // (the frame the page before left on the screen, until this one's third: index.html put it up)
  let heldFrame = document.getElementById('held-frame');
  const frame = (now: number) => {
    if (gone) return;
    requestAnimationFrame(frame);
    // (one page, one pump: below the ground's height the low game has the frame; under ?earth the street, which had it first)
    if (earthLanding?.ground) {
      earthLanding.world.frameAt(now);
      last = now;
      return;
    }
    if (landing?.ground) {
      landing.world!.frameAt(now);
      last = now;
      return;
    }
    // (tools: holdFrames more frames and then it stands, as the street's __qa does, and a thumb's events still land. Down there the low game reads the same)
    const qa = (window as unknown as { __qa?: { holdFrames?: number; held?: boolean } | null }).__qa;
    if (qa && qa.holdFrames !== undefined) {
      if (qa.holdFrames <= 0) {
        qa.held = true;
        last = now;
        return;
      }
      qa.holdFrames--;
    }
    // (?fixeddt: the page's clock steps with this frame, once, if the street's loop under it hasn't already)
    clock.frame(now);
    if (earthLanding?.cameBack) {
      earthLanding.cameBack = false;
      fx?.fromGround();
      labelEl()?.style.removeProperty('display');
      hud?.setVisible(true);
      perf.setVisible(params.has('fps'));
    }
    if (landing?.cameBack && input) {
      landing.cameBack = false;
      fx?.fromGround();
      labelEl()?.style.removeProperty('display');
      hud?.setVisible(true);
    }
    const f0 = performance.now();
    breath.numbersIn();
    if (resizeWanted) {
      resizeWanted = false;
      pipeline.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
      pipeline.setHfov(view?.hfov ?? lens);
      placeCamera();
    }
    const real = held0 ? 0 : fixedDt || Math.min(0.05, Math.max(0, (now - last) / 1000));
    // (a hit-stop holds the flight and the paint, as it does on the street; the screen and the thumb go on)
    const dt = breath.hitStop > 0 ? 0 : real;
    last = now;
    time += dt;
    globals.uTime.value = time;

    // ---- the flight first, then the lens, and draw.update reads the lens: the contract above
    if (trip && view && input && looker) {
      input.update(real);
      const st = input.state;
      // (the left of the screen pans on every leg: as far as the finger goes, the screen's width half way round, and it stays where it's left, the producer's word: "just forget auto re-alignment.
      // where the user pans - it goes". The right flies: where it doesn't steer the path it carves about it, as the street turns. And the longest flick, so the orbit's push doesn't take one for a push)
      const steer = trip.steering, W = Math.max(1, window.innerWidth);
      // (from where the finger landed on its first frame, so a quick swipe's start isn't lost: the look's offset is from there)
      let dx = 0, dy = 0;
      if (st.look.on) {
        dx += st.look.x - (lookOn ? lookAt.x : 0);
        dy += st.look.y - (lookOn ? lookAt.y : 0);
      }
      lookOn = st.look.on;
      lookAt.set(st.look.x, st.look.y);
      const panning = st.look.on;
      looker.setLook(false, 0, 0, real);
      view.lookYaw = looker.lookYawNow;
      view.lookPitch = looker.lookPitchNow;
      YOKE.flick = inputTune.loneFlickMs / 1000;
      trip.tau = tripTune.tau;
      trip.pull = tripTune.pullDegS * DEG;
      view.swing = tripTune.swing;
      view.halfV = camera.fov / 2;
      trip.step(dt, trip.steering && st.dragging ? st.stretch.x : 0, st.dragging ? st.stretch.y : 0);
      view.steerX = steer && st.dragging ? st.stretch.x : 0;
      view.carveX = !steer && st.dragging ? st.stretch.x : 0;
      view.carveY = !steer && st.dragging ? st.stretch.y : 0;
      view.update(dt, trip, (-dx / W) * Math.PI * PAN_X, (dy / W) * Math.PI * PAN_Y, panning, lensParam);
      pipeline.setHfov(view.hfov);
      landing?.update(dt);
      placeCamera();
      bus.root.quaternion.copy(view.busQuat);
      if (landing) {
        // (the near plane out with the height, and the far plane past the horizon from the orbit: what the low game's boot left mustn't matter)
        const near = landing.near;
        pipeline.setDepthRange(near ? 60 : 1.5, near ? 1.6e6 : 30000);
        if (names) names.object.visible = !near;
        landing.pose(camera, bus.root);
      }
    }
    model.frame(trip ? trip.ms : clock.now(), landing ? landing.ob : (trip ?? pose!).ob, sky);
    if (pose) placeCamera();
    // (held, for a tool's frame: the light is where it would have got to)
    draw.update(sky, held0 ? Infinity : real);
    // (the ray-drawn Moon is under the mesh until the mesh has it all, and then the ground is the ground)
    if (landing && landing.show >= 1) U.uMoonO.value.w = -1;
    globals.uSunDir.value.set(sky.sun[0], sky.sun[1], sky.sun[2]);
    // (in Earth's shadow the bus has only its ambient)
    globals.uLight.value.set(0.62 * sky.sunSeen, 0.2, 0.05);
    // (a roof in full sun goes to the ramp's pale top, which from up here is the whole of a bus two pixels wide: it must stay yellow against the grey, and its shaded side isn't touched)
    busTune.sunSoft = tripTune.busSunSoft;
    // (and on the way down it comes to the light the low game has it in)
    if (landing?.near) landing.busLight(globals.uLight.value, config.light, busTune, tripTune.busSunSoft);
    breath.pose(busPose, dt);
    bus.update(dt, time, busPose);
    if (breath.rear > 0) bus.root.quaternion.multiply(rearQ.setFromAxisAngle(pitchAxis, breath.rear));
    if (landing?.near) landing.snap(camera, bus.root);
    earthLanding?.ease(camera, bus.root, real);
    bus.root.updateMatrixWorld(true);
    breath.craters = craterHigh();
    // (the crater shot's glint if the view's own aim misses the Moon: the ground ahead along the heading, as far ahead as the view's aim about is, Moon fixed. moonFix is fixed <- EQJ by rows)
    if (breath.craters && trip) {
      const rm = trip.rm, hd = trip.heading, F = model.moonFix, l = Math.hypot(rm[0], rm[1], rm[2]), th = (AHEAD_PER_KM * Math.max(1, trip.hMoon)) / R_MOON;
      const c = Math.cos(th), s = Math.sin(th), v0 = (rm[0] / l) * c + hd[0] * s, v1 = (rm[1] / l) * c + hd[1] * s, v2 = (rm[2] / l) * c + hd[2] * s;
      breath.ahead[0] = F[0] * v0 + F[1] * v1 + F[2] * v2;
      breath.ahead[1] = F[3] * v0 + F[4] * v1 + F[5] * v2;
      breath.ahead[2] = F[6] * v0 + F[7] * v1 + F[8] * v2;
    }
    breath.aheadOn = breath.craters;
    breath.update(dt, real, sky, (trip?.leg === 'orbit' && !landing && !earthLanding) || breath.craters, camera);
    if (trip && names) names.update(dt, sky, trip.leg === 'in' || trip.leg === 'orbit' || trip.leg === 'moonRise' || trip.leg === 'moonHigh' || trip.leg === 'moonSink', trip.v, trip.t, camera, focalAt(), pipeline.info.width, pipeline.info.height, popSign);
    if (trip && view && fx) {
      fx.free = trip.leg === 'wait' || trip.leg === 'orbit' || trip.leg === 'fall';
      if (landing?.near) fx.update(dt, trip.v, trip.dir, landing.axes, landing.flying.copy(view.flying).applyQuaternion(landing.q), landing.nosing.copy(view.nosing).applyQuaternion(landing.q), camera, bus.root, pipeline.pixelWorldSize(1), landing.bus);
      else fx.update(dt, trip.v, trip.dir, trip.ob.axes, view.flying, view.nosing, camera, bus.root, pipeline.pixelWorldSize(1));
      // (at the Moon from the orbit down the gears are the street's, and so is their readout, for a moment after a shift. Everywhere else the label says the gear: the HUD is here for its toasts)
      const ladder = trip.leg === 'orbit' || trip.leg === 'fall' || trip.leg === 'wait';
      // (the street's ladder, turbo's levels over Jet and the two faster gears over them: one pip a step, and the step's name)
      hud?.update(dt, { gear: ladder ? earthStep(trip.rung, trip.level) : trip.gear, maxGear: RUNG_TOP, engaged: true, level: 0, levels: ladder ? 3 : 0, name: ladder ? rungName(trip.rung, trip.level) : undefined, mph: ladder ? trip.v * 2236.94 : 0, armed: false, sinceShift: ladder ? trip.t - trip.rungAt : Infinity, sinceLocked: Infinity });
      if (frames % 6 === 0) label?.(trip, breath);
      // (the one thing to do up here, where a first-timer's eye is, until they've done it)
      // (and on arriving, WELCOME TO THE MOON, the producer's: "some sort of "welcome to the moon" tab to appear that will essentially say you are in control of the bus again". Home, the same)
      if (trip.leg !== legWas) {
        // (from the trip's way in: not back up from the ground, nor back down from the button)
        if (trip.leg === 'orbit' && legWas !== 'fall' && legWas !== 'moonSink' && legWas !== 'ground') {
          hud?.toast(['WELCOME TO THE MOON', 'THE BUS IS YOURS'], WELCOME_S);
          welcomeAt = time;
          asked = false;
        } else if (trip.leg === 'wait' && legWas === 'homeDrop') hud?.toast(['WELCOME HOME'], WELCOME_S);
        legWas = trip.leg;
      }
      eggMoon.update(real, trip.egg === 'moon');
      eggEarth.update(real, trip.egg === 'earth');
      const ask = trip.leg === 'orbit' && !earthLanding && time > welcomeAt + WELCOME_S && (landing ? !landing.pushed : !breath.fired);
      if (ask !== asked) {
        asked = ask;
        if (ask) hud?.toast(landing ? ['PUSH TO LAND'] : ['TAP TO PAINT'], 3600);
        else hud?.clearToast();
      }
    }
    if (!landing?.near) pipeline.focus.set(0, 0, 0);
    // (out here only a touch near the bus or anywhere under it flies it, and one over it or beside it looks: the bus's lane, where it stands on the screen this frame, the street's
    // shape and numbers. The producer, going live: "anywhere a player touches in the general vicinity below the bus belongs to control of bus")
    if (input && trip && view) {
      const v = bus.root.getWorldPosition(busOnScreen).project(camera), W = window.innerWidth, H = window.innerHeight;
      // (one object, set again each frame: Input reads it as a touch lands, and keeps nothing of it. With the bus behind the lens the lane stays where the bus was last on the
      // screen, where it fell back to the left 42 % before. The first review's minor)
      if (v.z < 1) {
        busZone.x = ((v.x + 1) / 2) * W;
        busZone.y = ((1 - v.y) / 2) * H;
        busZone.r = inputTune.laneHalf * Math.min(W, H);
        busZone.open = inputTune.laneOpen * H;
        input.busZone = busZone;
      }
    }
    pipeline.render(scene);
    breath.numbersOut();
    frames++;
    // (?earth: under the street's height over its city, coming down, the street has it from the next frame)
    if (earthLanding?.update(camera, bus.root)) {
      if (label) labelEl()?.style.setProperty('display', 'none');
      hud?.setVisible(false);
      perf.setVisible(false);
    }
    if (landing?.time) {
      landing.hand(camera, bus.root);
      if (label) labelEl()?.style.setProperty('display', 'none');
      hud?.setVisible(false);
      perf.setVisible(false);
    }
    if (frames === 1) load.firstFrameMs = Math.round(performance.now() - t0);
    if (heldFrame && frames === 3) {
      heldFrame.remove();
      heldFrame = null;
    }
    // (the long dark: a few seconds in, the page changes over to the one for where the bus is going, this frame held on the screen)
    if (trip) {
      if (trip.leg !== darkLeg) {
        darkLeg = trip.leg;
        darkAt = trip.t;
        swapTried = false;
      }
      const to = !swapTried && trip.t - darkAt >= SWAP_AFTER ? swapTo() : null;
      if (to) {
        swapTried = true;
        if (swap(to)) gone = true;
      }
    }
    if (dark && frames === 3) {
      const d = dark;
      d.style.opacity = '0';
      setTimeout(() => d.remove(), 2000);
      dark = null;
    }
    perf.frame(dt * 1000, performance.now() - f0);
    (window as unknown as { __shotReady?: boolean }).__shotReady = frames > 2;
  };
  // (tests: fly on without drawing, at the route's step)
  const skip = (s: number) => {
    for (let i = 0; trip && view && i < s * 30; i++) {
      trip.step(1 / 30, 0);
      view.update(1 / 30, trip, 0, 0, false, lensParam);
    }
    if (trip) label?.(trip, breath);
  };
  const qa = { pipeline, scene, camera, perf, bus, input, warm, moon: { model, sky, clock, draw, pose, load, trip, view, skip, breath, names, tune: tripTune, hold: (on: boolean) => (held0 = on), landing, earthLanding, resumed } };
  (window as unknown as Record<string, unknown>)[land ? '__space' : '__game'] = qa;
  // (?earth: the street has the frame and the thumb; the flight's HUD and label wait for it to hand up, and from here this loop is the pump)
  if (earthLanding && !flightFirst) {
    if (label) labelEl()?.style.setProperty('display', 'none');
    hud?.setVisible(false);
    perf.setVisible(false);
    earthLanding.world.pumpOff();
  }
  requestAnimationFrame(frame);
  return earthLanding ?? landing;
}
