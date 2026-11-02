import * as THREE from 'three';
import { BusModel, type BusPose } from '../bus/BusModel';
import { config } from '../config';
import { Input } from '../game/Input';
import { globals } from '../render/materials';
import type { PixelPipeline } from '../render/PixelPipeline';
import type { WarmUp } from '../render/warmup';
import { Hud } from '../ui/Hud';
import { Perf } from '../ui/Perf';
import { C, HUD_SMALL, PixelCanvas, textWidth } from '../ui/pixelUi';
import { MoonBreath } from './MoonBreath';
import { LEG_NAMES, MoonTrip } from './MoonTrip';
import { series } from './Series';
import { SkyClock } from './SkyClock';
import { SkyDraw } from './SkyDraw';
import { EARTH, MOON, R_MOON, SkyModel, SkyState, type Observer } from './SkyModel';
import { applySpaceTable } from './SkyTable';
import { SpaceFx } from './SpaceFx';
import { TripView } from './TripView';
import { geodeticToFix, sphereToFix } from './WorldFrame';

// ?moonrun: MOONSHOT.md's black box. Space only: no city streams, the bus sits at the render origin, and the real pipeline and resolve draw it. Earth, Moon and Sun come from the real sky
// model; everything out here is a direction or a ray test, so nothing at 384,400 km ever enters the render frame.
//
// `?view=` puts the bus anywhere, to look (see readView below). With none it waits 300 km over San Francisco and flies: MoonTrip.ts is the route, TripView.ts the camera and the lens, SpaceFx.ts the lines and
// the trail. TURBO (E, PageUp) shifts up, its down tab (Q, PageDown) down; the thumb (arrows) steers over a body and swings the camera everywhere else. `?t=` sets the date and `?g5=` G5's speed in km/s.
//
// The frame's order, which flight keeps: move `pose.ob` (pos and axes, float64) -> `model.frame(ms, ob, sky)` -> `draw.update(sky)` -> the light on the bus -> bus and camera -> `pipeline.render(scene)`.
// The lens first if it changes (`pipeline.setHfov`): `draw.update` reads the focal length. Open-space flight is `free: true`: pos in EQJ km from Earth's centre, axes the render axes in EQJ by rows, as
// view=mid does; it needs no handover all the way to the Moon, and rebaseBody is there for when a Moon-fixed orbit wants it. The bus never leaves the render origin, so speed reaches the frame only through
// the Observer. The camera may turn freely: rays and stars both go through the snapped camera. Whatever else draws goes into the scene before `warm.add(scene)`, or it compiles in flight.

const DEG = Math.PI / 180;
/** Half the portrait's vertical field on the 38 degree lens, degrees: what the rig's pitch rule is measured with (earth/geom.py). */
const HALF_V = 36.87;
const R_VIEW_EARTH = 6371;
const TAN19 = Math.tan(19 * DEG);

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

/** The label's font, with the one sign the HUD has never needed. */
const LABEL: typeof HUD_SMALL = { ...HUD_SMALL, glyphs: new Map(HUD_SMALL.glyphs).set('%', { w: 3, bits: Uint8Array.from([1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1]) }) };

/** What the flight says: the leg and its clock, the gear, how far up, what a tap would do now, and how much of the Moon is yours. A corner of the frame, redrawn when a line changes. */
function tripLabel(): (trip: MoonTrip, breath: MoonBreath | null) => void {
  const c = new PixelCanvas(122, 30, 2);
  Object.assign(c.el.style, { position: 'fixed', zIndex: '21', pointerEvents: 'none', right: 'max(14px, env(safe-area-inset-right))', top: 'max(8px, env(safe-area-inset-top))' });
  c.el.dataset.hud = 'trip-label';
  document.body.append(c.el);
  let last = '';
  return (trip, breath) => {
    const s = Math.floor(trip.clock), leg = trip.leg;
    const a = `${LEG_NAMES[leg]} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const b = `G${trip.gear} ${trip.v < 1 ? '0' : thousands(trip.v)} KM/S ${thousands(Math.min(trip.hMoon, trip.hEarth))} KM`;
    const asks = (leg === 'out' || leg === 'homeOut' || leg === 'climb' || leg === 'arc' || leg === 'leave') && trip.g5Room;
    const dark = leg === 'cruise' || leg === 'homeCruise';
    const p = trip.armed ? 'G5 ARMED' : leg === 'wait' ? 'TAP TURBO: MOON' : leg === 'orbit' ? 'TAP TURBO: HOME' : asks ? 'TAP TURBO: G5' : dark ? 'DRAG TO LOOK ROUND' : '';
    // the goal, once there is any; and until the first shot, what to do about it
    const share = breath ? breath.paint.painted * 100 : 0;
    const d = share > 0 ? `PAINTED ${share < 1 ? share.toFixed(2) : share < 10 ? share.toFixed(1) : share.toFixed(0)} % OF THE MOON` : '';
    const e = leg === 'orbit' && breath && !breath.fired ? 'TAP TO PAINT' : ''; // (a toast says this, large)
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
}

export async function bootMoonrun({ pipeline, scene, warm }: MoonrunContext): Promise<void> {
  const params = new URLSearchParams(location.search);
  const t0 = performance.now();
  const renderer = pipeline.renderer;
  // (the sky is the clear flag and nothing else; no sun pass, no fog; calm pixels on the bus, as up high)
  pipeline.setFar(30000);
  pipeline.shadowStrength = 0;
  pipeline.calm = 1;
  applySpaceTable(pipeline.paletteTexture);
  globals.uLight.value.set(0.62, 0.2, 0.05);

  const perf = new Perf(renderer);
  perf.setVisible(params.has('fps'));

  const model = new SkyModel(series);
  const sky = new SkyState();
  const clock = new SkyClock(params);
  const flying = !params.has('view');
  const trip = flying ? new MoonTrip(series, clock.now(), { g5: Number(params.get('g5')) || 6000 }) : null;
  const view = flying ? new TripView() : null;
  const pose = flying ? null : readView(params, model, sky, clock.now());

  const draw = new SkyDraw(pipeline);
  if (params.has('floor')) draw.moonFloor = Number(params.get('floor')) || 0;
  if (params.get('lines') === '0') draw.showLines(false);
  draw.air = params.get('air') !== '0';
  if (params.has('airpx')) draw.airPx = Number(params.get('airpx')) || draw.airPx;
  scene.add(draw.object);
  const bus = new BusModel();
  bus.root.scale.setScalar(config.camera.heroScaleVista);
  bus.root.visible = pose ? pose.showBus : params.get('bus') !== '0';
  scene.add(bus.root);
  const fx = flying ? new SpaceFx(bus.length) : null;
  if (fx) scene.add(fx.object);
  const breath = new MoonBreath(pipeline, bus);
  scene.add(breath.particles.object);
  const busPose: BusPose = { squash: 1, eye: 1, fullness: 1, mouth: 0, speed: 0, wheeze: 0, heave: 0 };

  // ---- the lens, and the chase: bus at the origin, the camera behind and above it with no rotation, so the bus sits low in the frame and the view is what the axes say
  const camera = pipeline.camera;
  const pitchAxis = new THREE.Vector3(1, 0, 0);
  const lensParam = Number(params.get('lens')) || 0;
  const lens = lensParam || config.camera.hfovVista;
  pipeline.setHfov(lens);
  pipeline.setDepthRange(1.5, 30000);
  const focalAt = () => 1 / pipeline.pixelWorldSize(1);
  /** The rig's distance over the 38 degree lens's: it keeps the bus's size on screen through a lens change. */
  let rigScale = 1;
  const placeCamera = () => {
    rigScale = view ? TAN19 / Math.tan((view.hfov * DEG) / 2) : 1;
    // (a quarter of the frame under its middle, the bus's row at 852 tall, wherever a browser's bars leave the bottom)
    const D = config.camera.distanceVista * rigScale, row = (0.25 * pipeline.info.height) / focalAt();
    const k = D / Math.sqrt(1 + row * row);
    camera.position.set(0, k * row, k);
    camera.quaternion.setFromAxisAngle(pitchAxis, breath.kick);
  };
  const fitView = () => {
    if (view) {
      view.width = pipeline.info.width;
      view.height = pipeline.info.height;
    }
  };
  fitView();
  placeCamera();
  if (pose) {
    const z = pose.busFwd.clone().negate();
    const x = pose.busUp.clone().cross(z).normalize();
    const y = z.clone().cross(x);
    bus.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }

  // ---- the thumb and TURBO: the real Input and the real HUD, less what has no meaning out here. TURBO's boost has no meaning either, so a long press is a tap: the press that started it already shifted, and its lift mustn't again
  let pressTaken = false, held = false;
  const input = flying ? new Input(renderer.domElement) : null;
  const hud = input ? new Hud(input, { onTiltToggle() {}, onChip() {}, onSensitivity() {}, onRecenter() {}, onMute() {}, onSwap() {}, onSettings() {}, onGesture() {} }) : null;
  const label = flying ? tripLabel() : null;
  if (input && hud && trip) {
    input.onTurbo = (dir) => {
      if (dir < 0) trip.shiftDown();
      else if (pressTaken) pressTaken = false;
      else trip.tap();
    };
    // a tap is a breath, as on the street: the place it touched goes in first, since Input reads the event after this
    input.onTap = () => {
      if (breath.tap(trip.leg === 'orbit')) hud.clearToast();
    };
    const touched = (e: PointerEvent) => {
      if (e.target === renderer.domElement) breath.touched(e.clientX, e.clientY);
    };
    window.addEventListener('pointerdown', touched, true);
    window.addEventListener('pointerup', touched, true);
    for (const name of ['mega', 'settings', 'recenter', 'tilt-toggle', 'tilt-chip']) hud.root.querySelector<HTMLElement>(`[data-hud="${name}"]`)?.style.setProperty('visibility', 'hidden');
    hud.arrive();
  }

  const rearQ = new THREE.Quaternion();
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
  breath.load();
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
  let frames = 0;
  // (tools: time stands still and the frame goes on drawing, so a shot is of the moment it asked for)
  let held0 = false;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const f0 = performance.now();
    if (resizeWanted) {
      resizeWanted = false;
      pipeline.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
      pipeline.setHfov(view?.hfov ?? lens);
      fitView();
      placeCamera();
    }
    const real = held0 ? 0 : fixedDt || Math.min(0.05, Math.max(0, (now - last) / 1000));
    // (a hit-stop holds the flight and the paint, as it does on the street; the screen and the thumb go on)
    const dt = breath.hitStop > 0 ? 0 : real;
    last = now;
    time += dt;
    globals.uTime.value = time;

    // ---- the flight first, then the lens, and draw.update reads the lens: the contract above
    if (trip && view && input) {
      input.update(real);
      const st = input.state;
      if (st.turboHeld !== held) {
        held = st.turboHeld;
        pressTaken = held;
        if (held) trip.tap();
      }
      trip.step(dt, trip.steering && st.dragging ? st.stretch.x : 0);
      view.update(dt, trip, st.stretch.x, st.stretch.y, st.dragging, lensParam);
      pipeline.setHfov(view.hfov);
      placeCamera();
      bus.root.quaternion.copy(view.busQuat);
    }
    model.frame(trip ? trip.ms : clock.now(), (trip ?? pose!).ob, sky);
    draw.update(sky);
    globals.uSunDir.value.set(sky.sun[0], sky.sun[1], sky.sun[2]);
    // (in Earth's shadow the bus has only its ambient)
    globals.uLight.value.x = 0.62 * sky.sunSeen;
    breath.pose(busPose, dt);
    bus.update(dt, time, busPose);
    if (breath.rear > 0) bus.root.quaternion.multiply(rearQ.setFromAxisAngle(pitchAxis, breath.rear));
    bus.root.updateMatrixWorld(true);
    breath.update(dt, real, sky, trip?.leg === 'orbit', camera);
    if (trip && view && fx) {
      fx.update(dt, trip.v, trip.dir, trip.ob.axes, view.flying, view.nosing, camera, bus.root, rigScale, pipeline.pixelWorldSize(1));
      // (the readout's names stop at G3 and the label says the gear: TURBO and its down tab are all that's wanted from the HUD)
      hud?.update(dt, { gear: trip.gear, maxGear: 5, engaged: true, boosting: false, mph: 0, armed: false, sinceShift: Infinity, sinceLocked: Infinity, tiltState: 'none', gearDown: trip.canShiftDown });
      if (frames % 6 === 0) label?.(trip, breath);
      // (the one thing to do up here, where a first-timer's eye is, until they've done it)
      if (trip.leg === 'orbit' && !breath.fired && !asked) {
        asked = true;
        hud?.toast(['TAP TO PAINT'], 3600);
      }
    }
    pipeline.focus.set(0, 0, 0);
    pipeline.render(scene);
    frames++;
    if (frames === 1) load.firstFrameMs = Math.round(performance.now() - t0);
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
  (window as unknown as Record<string, unknown>).__game = { pipeline, scene, camera, perf, bus, input, warm, moon: { model, sky, clock, draw, pose, load, trip, view, skip, breath, hold: (on: boolean) => (held0 = on) } };
  requestAnimationFrame(frame);
}
