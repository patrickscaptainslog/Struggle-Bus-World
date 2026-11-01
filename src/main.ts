import * as THREE from 'three';
import { config } from './config';
import { PixelPipeline } from './render/PixelPipeline';
import { globals, layerTopBase } from './render/materials';
import { HUE_RAMPS } from './render/palette';
import { WarmUp } from './render/warmup';
import { City, bootFetch, dataQuery, type BuildingRef } from './world/City';
import { paintUniforms, setFacadeView } from './world/buildingMaterial';
import { Ground, type CityManifest } from './world/tiles';
import { Flight } from './game/Flight';
import { fadeEnd, floorPastMap, mapReach, nearPlane, snapReach } from './game/Ascent';
import { CameraRig } from './game/CameraRig';
import { Splatter, BLOOM_HOSE, BLOOM_REPOP, type Blast, type SuperTag } from './game/Splat';
import { Aimer, type Shot } from './game/Aim';
import { latLonToLocal } from './game/geo';
import { arrival, blastRadiusFor, blobFlight, makeBlastSpec } from './game/blastLayout';
import { Input } from './game/Input';
import { Controls } from './game/Controls';
import { BusModel, type BusPose } from './bus/BusModel';
import { Particles } from './fx/Particles';
import { StreetSigns, signBladeWidth, signTune } from './fx/StreetSign';
import { Credit } from './ui/Credits';
import { registerCityData } from './world/PaintState';
import { AudioEngine } from './audio/AudioEngine';
import { TreeField, RoofSprouts, makeSutroTower, makeTransamerica, type TreeInstance } from './world/Props';
import { paintLandmark, bindLandmarkPaint, landmarkHit, landmarkSparkles } from './world/props/landmarkPaint';
import { Tuner, applySavedTuning } from './ui/Tuner';
import { makeGoldenGate, makeBayBridgeWest, bridgeObstacles } from './world/Bridges';
import { heroLandmarks, SpireRide } from './world/props/landmarks';
import { Perf } from './ui/Perf';
import { clamp } from './game/springs';
import { tunableGroups } from './ui/tunables';
import { SuperSplat } from './game/SuperSplat';
import { SuperFx } from './fx/SuperFx';
import { SuperMeter } from './ui/SuperMeter';
import { farFlags } from './world/farMaterial';

// Struggle Bus — Phase 1 (real SF, solo).

type Manifest = CityManifest & { regions: Array<[number, number, number]>; regionSize: number };
/** What the street sign says when a landmark is hit. */
const LANDMARK_NAMES: Record<string, string> = { sutro: 'Sutro Tower', transamerica: 'Transamerica' };

/** The opening was seen through once on this device: a tap skips it from then on. */
const OPENING_SEEN_KEY = 'strugglebus.opening.v1';

const params = new URLSearchParams(location.search);
if (params.has('fog')) config.fog.enabled = true;
if (params.has('px')) config.render.pixelWidth = Math.min(1200, Math.max(120, Number(params.get('px')) || config.render.pixelWidth));
applySavedTuning();
// The far field (docs/ARCHITECTURE.md, "The far raster"): on, for any city whose far16.bin arrives. config.far.on and ?nofar turn all of it off. A tool
// spelling any of ?farmap, ?farblocks, ?farfade asks for exactly those.
const farOn = config.far.on && !params.has('nofar');
const farPicked = params.has('farmap') || params.has('farblocks') || params.has('farfade');
if (farOn) {
  farFlags.map = !farPicked || params.has('farmap');
  farFlags.oblique = !farPicked || params.get('farmap') === 'oblique';
  farFlags.blocks = !farPicked || params.has('farblocks');
  farFlags.nearest = params.has('farnearest');
  farFlags.debug = params.has('fardebug');
  if (params.has('farbias')) config.far.classBias = Number(params.get('farbias'));
}
if (params.has('loadr')) config.city.loadRadiusHigh = Number(params.get('loadr')) || config.city.loadRadiusHigh;
// (tools that mean the old ceiling: shots.mjs's views, a measurement at "the ceiling")
if (params.has('ceiling')) {
  config.flight.ceiling = Number(params.get('ceiling')) || config.flight.ceiling;
  config.flight.ceilingSoft = 150;
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const pipeline = new PixelPipeline(canvas);
/** Where the far fade ends at the ground, and the far plane stands past it (m); 0 until the far fade is on. */
const FADE_END = 34000;
const FADE_FAR = 2000;
let fadeOn = false;
/** The fade to 34 km and the far plane past it. It runs after the saved tuning, whenever it runs: no saved value takes it back. */
function farFade() {
  config.fog.clearFarFull = FADE_END;
  pipeline.setFar(FADE_END + FADE_FAR);
  fadeOn = true;
}
if (farOn && params.has('farfade')) farFade();
const renderer = pipeline.renderer;
const scene = new THREE.Scene();
// (what moves has its own matrices updated; a scene that recomposed its identity would force all 900 objects' every frame)
scene.matrixAutoUpdate = false;
const camera = pipeline.camera;
const camNear = camera.near;
// Every shader the game draws with starts compiling now, all at once and off the main thread,
// while the city data downloads; the first frame waits for it (render/warmup.ts). This first
// wave: the post passes and what modules registered (tiles, trees, landmarks, bridges).
let warm = new WarmUp(pipeline, scene);

// --- sun: late-afternoon, low, from the WSW
/** The city's low ground (m, City.lowGround once the far grid is in): the fog ceiling's heights are
 *  above it, so a city on a plateau stands out of its fog the way SF does at sea level */
let fogGround = 0;
function updateSun() {
  const az = config.light.sunAzimuth;
  const el = config.light.sunElevation;
  globals.uSunDir.value.set(Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el)).normalize();
  globals.uLight.value.set(config.light.sunStrength, config.light.ambient, config.light.skyBounce);
  const Fg = config.fog;
  const fogOn = Fg.enabled;
  // (fog off: no density, no marine layer; only a far fade so the far plane never cuts hard)
  globals.uFog.value.set(fogOn ? Fg.density : 0, Fg.heightFalloff, fogOn ? Fg.farFull : Fg.clearFarFull, 1);
  globals.uPaintClearing.value = Fg.paintClearing;
  globals.uFogLayer.value.set(Fg.layerTop, Fg.layerTopBay, Fg.layerTopEast, Fg.layerSoft);
  const L2 = globals.uFogLayer2.value;
  L2.set(Fg.layerDensity, Fg.layerHaze, Fg.layerFarFull, fogOn ? L2.w : 0);
  globals.uFogBillow.value.set(Fg.layerBillow, 1 / Math.max(10, Fg.layerBillowSize));
  // (the fog ceiling of tall far shapes: meaningless with the fog off, so off with it)
  globals.uFogStand.value.set(fogOn ? Fg.standFog : 1, fogGround + Fg.standFrom, fogGround + Math.max(Fg.standFrom + 1, Fg.standTo), Fg.standFade);
}
updateSun();

const slug = params.get('city') ?? 'sf';
const base = `./city/${slug}`;

async function boot() {
  // (first: the warm-up hasn't started a compile yet, so this query waits for nothing, and boot().catch prints a refusal)
  pipeline.checkTargets();
  // (index.html started this download before this script had even loaded)
  const manifest = (await (await (bootFetch(base, 'manifest') ?? fetch(`${base}/city.json${dataQuery()}`))).json()) as Manifest;
  // saved paint is keyed by the folder that served the city, not the slug inside its city.json (only the
  // paint stores read manifest.slug): a bake served beside the live one (?city=sf_osm, slug 'sf') opens
  // its own stores and never drops or fills the ones ?city=sf uses
  if (manifest.slug !== slug) manifest.slug = slug;
  // and by the data's id scheme (city.json "ids"): the stores the City opens need it first
  registerCityData(manifest);
  const city = new City(manifest, base);
  scene.add(city.root);
  // the opening streams everything it needs at once (adopted as it lands, many regions in flight);
  // streaming is budgeted again after the first ready frame
  city.eager = true;

  // ---- the hero's start, first: the opening's regions are asked for from there right away
  const flight = new Flight();
  flight.x = manifest.start.x;
  flight.z = manifest.start.z;
  flight.heading = manifest.start.heading;
  if (params.has('lat') && params.has('lon')) [flight.x, flight.z] = latLonToLocal(Number(params.get('lat')), Number(params.get('lon')), manifest.origin);
  if (params.has('heading')) flight.heading = THREE.MathUtils.degToRad(Number(params.get('heading')));
  // the opening: emerge from the fog bank west of the Golden Gate, glide under it
  const start = manifest.start as typeof manifest.start & { speed?: number; opening?: string };
  const ggb = manifest.landmarks.find((l) => l.kind === 'ggb') as { points?: Array<[number, number]> } | undefined;
  let openingBridge: [number, number] | null = null;
  if (!params.has('lat') && start.opening === 'golden-gate' && ggb?.points) {
    // thread the gap just north of the south tower so the tower fills the
    // narrow portrait lens as we glide under the deck
    const [, t1, t2] = ggb.points;
    const sx = (t2[0] - t1[0]), sz = (t2[1] - t1[1]);
    const sl = Math.hypot(sx, sz);
    const gap: [number, number] = [t1[0] + (sx / sl) * 85, t1[1] + (sz / sl) * 85];
    flight.x = gap[0] - flight.fx * 640;
    flight.z = gap[1] - flight.fz * 640;
    openingBridge = gap;
    flight.speed = start.speed ?? 60;
    flight.glideSpeed = start.speed ?? 60;
  }
  const rig = new CameraRig();
  if (openingBridge) rig.openingLow = 1;
  const focus = new THREE.Vector3(flight.x, 60, flight.z);
  // (the first frame streams around the bus: the same want-list, so nothing is asked for twice)
  const primeFocus = focus.clone();
  city.prime(primeFocus);
  // (the fade goes with the raster, on whichever frame that lands; a city with no raster keeps its old horizon)
  if (farOn && !farPicked)
    city.onFarRaster = () => {
      farFade();
      city.fitWater();
      updateSun();
    };
  const farP = city.loadFar(renderer, () => warm.busy);

  // ---- props: trees stream with tiles, landmarks are placed once
  const treeFields = new Map<string, TreeField>();
  const treeIndex = new Map<string, TreeInstance[]>();
  const sprouts = new RoofSprouts();
  scene.add(sprouts.object);
  /** buildings whose paint already thinned the fog this session (a tile streaming back in mustn't bump it again) */
  const fogBumped = new Set<number>();
  /** Rooftop garden / Hundertwasser crown on a building: drawn, and the flight's obstacle field rises over it. */
  const growSprouts = (ref: BuildingRef, hue: number, level: number, start: number) => {
    const rect = city.roofRect(ref);
    const top = sprouts.set(ref.index, rect, hue, level, start);
    if (top > 0) city.raiseRoof(rect, rect.y + top);
    // a tower's own setback gardens, trees and onion domes (baked in its mesh) grow too
    city.growTo(ref, level);
  };
  /** 181 Fremont's spire, once its tower streams in: it rides the tower's pop and wobble */
  let spire: SpireRide | null = null;
  /** 181 Fremont's spire binds to its tower (and the roof under it) once both exist (whichever comes last) */
  const bindSpire = () => {
    if (!spire || spire.bound) return;
    const sp = spire.object.position;
    const ref = city.buildingAt(sp.x, sp.z);
    if (ref && ref.roofY - ref.baseY > 150) {
      spire.bind(ref, city.roofAtPart(ref, sp.x, sp.z));
      // it paints and glints with its tower (one building: never an 'lm:' key of its own); SpireRide moves it
      bindLandmarkPaint(spire.object, ref, { ride: true });
    }
  };
  city.onTile = ({ tx, tz, terrain, refs }) => {
    if (terrain && terrain.trees.length) {
      const list: TreeInstance[] = terrain.trees.map((t) => ({ x: t.x, y: t.y, z: t.z, size: t.size, kind: t.kind }));
      const tf = new TreeField(list);
      scene.add(tf.object);
      for (const m of tf.meshes) city.firstDraw(m);
      treeFields.set(`${tx},${tz}`, tf);
      treeIndex.set(`${tx},${tz}`, list);
    }
    bindSpire();
    // saved paint: regrow rooftop gardens and thin the fog again
    for (const ref of refs) {
      const lv = city.paint.level(ref.index);
      if (lv > 0.5) {
        if (!fogBumped.has(ref.stableId)) {
          fogBumped.add(ref.stableId);
          bumpPaint(ref.cx, ref.cz, 40);
        }
        if (lv >= 2) growSprouts(ref, city.paint.get(ref.index).color, lv, -100);
      }
    }
  };
  // trees standing in saved ground paint come back painted once their tile's paint is redrawn, at the
  // level of the painted house beside them (every blast that splattered them escalated it too)
  city.ground.onTileReady = (tx, tz) => {
    const k = `${tx},${tz}`;
    const tf = treeFields.get(k);
    const list = treeIndex.get(k);
    if (!tf || !list) return;
    for (let i = 0; i < list.length; i++) {
      const g = city.ground.sample(list[i].x, list[i].z);
      if (!g || g.cov < 0.5 || tf.paintLevel(i) !== 0) continue;
      const near = city.nearestBuilding(list[i].x, list[i].z, 25);
      const lv = near ? Math.round(city.paint.level(near.index)) : 0;
      tf.setPaint(i, g.hue, Math.min(3, Math.max(1, lv)), -100);
    }
  };
  city.onTileUnload = (tx, tz) => {
    const k = `${tx},${tz}`;
    const tf = treeFields.get(k);
    if (tf) {
      scene.remove(tf.object);
      tf.dispose();
      treeFields.delete(k);
      treeIndex.delete(k);
    }
  };
  // Only what the opening shows is built before the first frame (the bus, the Golden Gate); the
  // other landmarks are built after it, one per idle tick while the shaders compile, else one per
  // frame early in the opening (far from the gate, they are built long before the bus gets near).
  // Their materials are in the warm-up already (registerWarm in Bridges.ts, props/landmarks.ts).
  const later: Array<() => void> = [() => audio.warmBackend()];
  /** a landmark becomes a first-class paintable building (its paint saved under its key); saved paint thins the fog again */
  const paintable = (key: string, obj: THREE.Object3D, name?: string) => {
    const ref = paintLandmark(city, key, obj, { name });
    if (ref && city.paint.level(ref.index) > 0.5) bumpPaint(ref.cx, ref.cz, 40);
  };
  for (const lm of manifest.landmarks) {
    const pts = (lm as { points?: Array<[number, number]> }).points;
    const deck = lm.deck;
    if (lm.kind === 'ggb' && pts && deck && lm.supports) {
      scene.add(makeGoldenGate(pts, deck, lm.supports));
      city.addObstacles(bridgeObstacles('ggb', pts, deck, lm.supports));
    } else if (lm.kind === 'baybridge' && pts && deck && lm.supports) {
      const { supports } = lm;
      city.addObstacles(bridgeObstacles('baybridge', pts, deck, supports));
      later.push(() => scene.add(makeBayBridgeWest(pts, deck, supports)));
    } else {
      // Sutro's legs / the pyramid: solid posts the flight model steers around
      city.addObstacles([{ x: lm.x, z: lm.z, r: lm.kind === 'sutro' ? 45 : 30, top: lm.y + lm.height + 5, under: -Infinity }]);
      const kind = lm.kind;
      if (kind !== 'sutro' && kind !== 'transamerica') continue;
      later.push(() => {
        const obj = kind === 'sutro' ? makeSutroTower() : makeTransamerica();
        obj.position.set(lm.x, lm.y, lm.z);
        scene.add(obj);
        paintable(`lm:${kind}`, obj, LANDMARK_NAMES[kind]);
      });
    }
  }
  // the hand-built heroes the footprints can't draw: Coit Tower, the Ferry Building, 181 Fremont's spire
  later.push(() => {
    for (const h of heroLandmarks(manifest.origin)) {
      scene.add(h.object);
      city.addObstacles(h.posts);
      // the footprints a prop replaces leave the obstacle grid; its own surface takes their cells
      if (h.clear) city.setPropObstacles(h.clear, h.boxes);
      if (h.kind === 'fremont181-spire') {
        spire = new SpireRide(h.object);
        bindSpire();
      } else if (h.paint) {
        // Coit Tower and the Ferry Building: first-class paintable buildings, like Sutro and the pyramid
        // (after them, in the same order as ever: landmark paint slots are handed out in this order)
        const p = h.paint;
        later.push(() => paintable(p.key, h.object, p.name));
      }
    }
  });

  // ---- the hero
  const bus = new BusModel();
  scene.add(bus.root);

  // drop shadow straight below the bus: grounds the hero (how high it flies). No decal: the resolve pass
  // draws whatever faces up below the bus, inside an oval about its size, a ramp step darker (paint
  // too: a grey blob over paint was a hole), see PixelPipeline.setHeroShadow
  const dropShadow = new THREE.Vector3();
  let dropShadowL = 1;
  // the headlight beam (the eye): lit in the resolve pass from the lens forward (see PixelPipeline.setHeroBeam)
  const beamEye = new THREE.Vector3();
  const beamTip = new THREE.Vector3();
  const beamFwd = new THREE.Vector3();

  // the blast needs headroom: geyser + crown splash + flung blobs + a sparkle crown per bloom
  const particles = new Particles(8000);
  scene.add(particles.object);
  // the super splat's own motes, arcs and sparks (one draw, only while alive)
  const superFx = new SuperFx();
  // (the body in the bus root's space: design units x the model's scale; y from the tyres up)
  superFx.setBusSize(1.22 * bus.scale, 3.19 * bus.scale, bus.length * 0.5, -1.58 * bus.scale);
  scene.add(superFx.object);
  const signs = new StreetSigns();
  scene.add(signs.object);
  const audio = new AudioEngine();
  audio.setVolumes(config.audio);

  // ---- paint-density map for fog clearing over painted neighborhoods
  const [minX, minZ, maxX, maxZ] = manifest.bounds;
  const PD = 64; // m per cell
  const pdW = Math.ceil((maxX - minX) / PD), pdH = Math.ceil((maxZ - minZ) / PD);
  const pdData = new Uint8Array(pdW * pdH);
  const pdTex = new THREE.DataTexture(pdData, pdW, pdH, THREE.RedFormat, THREE.UnsignedByteType);
  pdTex.minFilter = pdTex.magFilter = THREE.LinearFilter;
  pdTex.needsUpdate = true;
  globals.uPaintFog.value = pdTex;
  globals.uPaintFogRect.value.set(minX, minZ, 1 / (maxX - minX), 1 / (maxZ - minZ));
  function bumpPaint(x: number, z: number, amt: number) {
    const cx = (x - minX) / PD, cz = (z - minZ) / PD;
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const ix = Math.floor(cx) + dx, iz = Math.floor(cz) + dz;
        if (ix < 0 || iz < 0 || ix >= pdW || iz >= pdH) continue;
        const w = Math.max(0, 1 - Math.hypot(dx, dz) / 2.6);
        pdData[iz * pdW + ix] = Math.min(255, pdData[iz * pdW + ix] + Math.round(amt * w));
      }
    pdTex.needsUpdate = true;
  }
  /** A landmark blooms: its sparkles hug its shape, its garden grows in its own shader (no rooftop sprouts on a spire). */
  const landmarkBloom = (ref: BuildingRef, hue: number, level: number): boolean => {
    const slices = landmarkSparkles(ref);
    if (!slices) return false;
    for (const s of slices) particles.sparkles(s.center, s.radius, s.height, [hue, (hue + 1) % 6, (hue + 5) % 6], 10 + level * 4);
    return true;
  };

  /**
   * Is a tile (rect, tallest point) buried so deep in the fog sea that, from the
   * camera, even its nearest, highest point is solid fog? (A lower bound on the
   * optical depth the fog shader would find: lowest billow, no soft band, the
   * tile's own paint thinning.) Hysteresis via `was`.
   */
  const buriedTile = (x0: number, z0: number, x1: number, z1: number, maxY: number, was: boolean): boolean => {
    const Fg = config.fog;
    const cp = camera.position;
    const top = Math.min(layerTopBase(x0, z0), layerTopBase(x1, z0), layerTopBase(x0, z1), layerTopBase(x1, z1)) - Fg.layerBillow - Fg.layerSoft;
    const dv = cp.y - maxY;
    if (maxY >= top || dv <= 0) return false;
    const dh = Math.hypot(cp.x - clamp(cp.x, x0, x1), cp.z - clamp(cp.z, z0, z1));
    const path = (Math.hypot(dh, dv) * (top - maxY)) / dv;
    let paint = 0;
    const i0 = Math.max(0, Math.floor((x0 - minX) / PD) - 1), i1 = Math.min(pdW - 1, Math.floor((x1 - minX) / PD) + 1);
    const j0 = Math.max(0, Math.floor((z0 - minZ) / PD) - 1), j1 = Math.min(pdH - 1, Math.floor((z1 - minZ) / PD) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) paint = Math.max(paint, pdData[j * pdW + i] / 255);
    const od = path * Fg.layerDensity * (1 - Fg.paintClearing * paint);
    // (past ~87% fog a pixel is solid fog-sea color: nothing of the tile would show)
    return od > (was ? 1.8 : 2.1);
  };

  // ---- splat orchestration
  let hitStop = 0;
  const mouthTmp = new THREE.Vector3();
  const velTmp = new THREE.Vector3();
  // the projectile leaves from the front of the bus (its one-eyed face), not the side door
  const frontLocal = new THREE.Vector3(0, 0.4, -bus.length * 0.5 - 0.6);
  const mouthWorld = () => bus.root.localToWorld(mouthTmp.copy(frontLocal));
  const busVel = () => velTmp.set(flight.fx * flight.speed, flight.vy, flight.fz * flight.speed);
  /** this breath's flight time from launch while Splatter schedules it (null = the classic one) */
  let breathTravel: number | null = null;
  /** The jet waits out the inhale (the bus squashes and gulps first), then flies so it lands exactly at the impact. */
  let jet: { at: number; impact: number; end: number; targets: THREE.Vector3[]; hues: number[]; width: number } | null = null;
  /** this breath's jet width (x the breath's; a super splat's mega blast is fatter) */
  let breathWidth = 1;
  let simTime = 0;
  const flingFrom = new THREE.Vector3();
  const flingTo = new THREE.Vector3();
  const flashPos = new THREE.Vector3();
  /** Where a flung blob comes down: the roof it hits, else the ground. */
  const landingY = (x: number, z: number) => city.roofAt(x, z) ?? city.groundAt(x, z);
  /** Trees standing in the blast's fresh ground paint bloom (or escalate) as the shockwave reaches them. */
  const paintTrees = (b: Blast, freshOnly = false) => {
    const ts = manifest.tileSize;
    const { x, z, r } = b.spec;
    const reach = r * b.spec.reach;
    for (let tz = Math.floor((z - reach) / ts); tz <= Math.floor((z + reach) / ts); tz++)
      for (let tx = Math.floor((x - reach) / ts); tx <= Math.floor((x + reach) / ts); tx++) {
        const key = `${tx},${tz}`;
        const list = treeIndex.get(key);
        const tf = treeFields.get(key);
        if (!list || !tf) continue;
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          const d = Math.hypot(t.x - x, t.z - z);
          if (d > reach || (freshOnly && tf.paintLevel(i) > 0)) continue;
          const g = city.ground.sample(t.x, t.z);
          if (!g || g.cov < 0.5) continue;
          tf.setPaint(i, g.hue, Math.min(3, tf.paintLevel(i) + 1), b.t + arrival(d, r));
        }
      }
  };
  const bloomHues = [0, 0, 0];
  /** the blast being shown (impact fires right before its primary's bloom, in the same update) */
  const lastBlast = { x: 0, z: 0, r: config.splat.blastRadius, open: false };
  const splatter = new Splatter(city, {
    geyser: (targets, hues) => {
      const S = config.splat;
      const fly = breathTravel ?? Math.max(0.05, S.impactDelay - S.inhale);
      jet = { at: simTime + S.inhale, impact: simTime + S.inhale + fly, end: simTime + S.duration, targets, hues, width: breathWidth };
    },
    miss: (pos, hue) => particles.splash(pos, hue, 0.6),
    impact: (b) => {
      const S = config.splat;
      const k = b.strength;
      lastBlast.x = b.spec.x;
      lastBlast.z = b.spec.z;
      lastBlast.r = b.spec.r;
      // where it came down, for its sign: open ground (a park, a plaza, a street, a canal) when the breath
      // landed on the ground, not on a roof or a wall
      lastBlast.open = b.pos.y < city.groundAt(b.pos.x, b.pos.z) + 1;
      if (b.hose) {
        // a firehose impact: the super splat plays its own (lighter) fx; trees take their first colour only
        // (a dozen impacts a second would run a tree through every level at once)
        paintTrees(b, true);
        landmarkHit(city, b.pos, b.t);
        bumpPaint(b.spec.x, b.spec.z, Math.min(255, 20 + 3 * b.count));
        superSplat.impact(b);
        return;
      }
      particles.splash(b.pos, b.spec.hue, 2.2 * Math.sqrt(k));
      particles.burst(b.pos, b.spec.hue, k, city.groundAt(b.pos.x, b.pos.z));
      // paint blobs flung far out, each landing on a spatter dot the ground paint already holds
      for (const dot of b.dots) {
        if (!dot.blob) continue;
        flingFrom.set(b.pos.x + (Math.random() - 0.5) * 3, b.pos.y + 0.8 + Math.random() * 1.5, b.pos.z + (Math.random() - 0.5) * 3);
        flingTo.set(dot.x, landingY(dot.x, dot.z) + 0.15, dot.z);
        particles.fling(flingFrom, flingTo, blobFlight(dot), dot.hue, 0.7 + dot.rad * 0.5);
      }
      paintTrees(b);
      landmarkHit(city, b.pos, b.t);
      audio.splatImpact(k);
      audio.bloomBurst(b.count, b.spec.hue, b.maxLevel);
      // one white-hot frame centered on the blast, a kick, and the fog thins over it
      flashPos.copy(b.pos).project(camera);
      pipeline.flash(flashPos.x * 0.5 + 0.5, flashPos.y * 0.5 + 0.5, S.flashFrames, S.flashStrength);
      rig.kick(S.kick * Math.sqrt(k));
      bumpPaint(b.spec.x, b.spec.z, Math.min(255, 30 + 5 * b.count));
      // nothing blooms (open ground with no building in reach): no first bloom will queue a sign, so it queues here
      if (!b.count) queueSign(null, b.spec.hue, b.spec.x, b.spec.z, b.spec.r);
    },
    bloom: (ref, _order, _total, hue, level, roof, flags) => {
      if (landmarkBloom(ref, hue, level)) return;
      const h = ref.roofY - ref.baseY;
      // (the firehose blooms a dozen blocks a second: fewer sparkles each)
      bloomHues[0] = hue;
      bloomHues[1] = (hue + 1) % 6;
      bloomHues[2] = (hue + 5) % 6;
      particles.sparkles(roof, Math.sqrt(ref.area) * 0.6 + 2, h, bloomHues, flags & BLOOM_HOSE ? 5 + level * 3 : 14 + level * 8);
      fogBumped.add(ref.stableId);
      if (level >= 2 && !(flags & BLOOM_REPOP)) growSprouts(ref, hue, level, globals.uTime.value);
    },
    // the street sign waits until the shockwave has bloomed the whole blast (game clock: hit-stop holds it)
    primary: (ref, hue) => queueSign(ref, hue, lastBlast.x, lastBlast.z, lastBlast.r),
    hitStop: (frames) => (hitStop = frames / 60),
  });

  /** QA: the last sign raised (its text, where, and what named it). */
  let lastSign: { text: string; x: number; z: number; from: string; t: number } | null = null;

  /** The neighbourhood at (x, z): OpenStreetMap's polygons (32 m cells), else `hood`, else the nearest label. */
  const hoodNameAt = (x: number, z: number, hood: number): [string, string] => {
    const h = city.hoodAt(x, z);
    if (h >= 0) return [city.neighborhoodName(h), 'hoodAt'];
    if (hood >= 0) return [city.neighborhoodName(hood), 'building hood'];
    let best = Infinity, name = manifest.name;
    for (const n of manifest.neighborhoods) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < best) {
        best = d;
        name = n.name;
      }
    }
    return [name, 'nearest label'];
  };

  /** What a blast's sign says, and what named it. A landmark signs its own name. A breath that came down on open
   *  ground (a park, a plaza, a canal, or no building in reach: ref null) names the spot it hit: the street there
   *  (OpenStreetMap), else the neighbourhood there. One that hit a building: the real street in front of it, else
   *  the building's own neighbourhood. */
  const signName = (ref: BuildingRef | null, x: number, z: number, open: boolean): [string, string] => {
    if (ref && city.isLandmark(ref)) return [city.neighborhoodName(ref.hood), 'landmark'];
    if (open || !ref) {
      const street = city.streetNameAt(x, z);
      return street ? [street, 'street'] : hoodNameAt(x, z, ref ? ref.hood : -1);
    }
    const f = city.frontOf(ref);
    const street = city.streetNameAt(f.x + f.nx * 4.5, f.z + f.nz * 4.5);
    return street ? [street, 'street'] : [city.neighborhoodName(ref.hood), 'building hood'];
  };

  // ---- the street sign stands beside the blast, never over it: the impact and the bloom are the money
  // shot. It rises once the wave has reached the edge, on open ground past the blast's far side as the
  // camera sees it, off the flight line (that's where the next target glints), and grows so its letters
  // keep a game pixel at that distance. A re-splat of the same block flips the same sign. It stands at
  // its true depth (the painted houses in front of it keep covering it), preferring a spot whose pole
  // is seen to its foot; else its pole grows until the blade clears the roofs in front (never a blade
  // hovering over the roofs with no pole). Nothing farther along its sightline (a tower, a landmark up
  // the hill) may hide any of the blade either: no sign beats half a blade.
  const pendingSigns: Array<{ ref: BuildingRef | null; text: string; from: string; hue: number; cx: number; cz: number; r: number; at: number; tries: number }> = [];
  /** ref: what the blast hit first, null when nothing blooms (it stands by the spot it hit, no front to fall back on). */
  const queueSign = (ref: BuildingRef | null, hue: number, cx: number, cz: number, r: number) => {
    const [text, from] = signName(ref, cx, cz, lastBlast.open);
    pendingSigns.push({ ref, text: text.toUpperCase(), from, hue, cx, cz, r, at: simTime + arrival(r, r) + signTune.showDelay, tries: 0 });
  };
  let signSpot: { x: number; y: number; z: number; facing: number; scale: number; bias: boolean; pole: number; cx: number; cz: number; r: number; text: string; until: number } | null = null;
  /** How far (m) a point must rise for its sightline to the camera to clear the roofs and crowns over
   *  the first ~60 m in front of it (0 = in the clear). */
  function sightLift(x: number, y: number, z: number): number {
    const c = camera.position;
    const d = Math.max(1, Math.hypot(c.x - x, c.y - y, c.z - z));
    let need = 0;
    for (let i = 1; i <= 10; i++) {
      const t = Math.min(0.9, (i * 6) / d);
      const over = city.surfaceAt(x + (c.x - x) * t, z + (c.z - z) * t) - (y + (c.y - y) * t);
      // (lifting the point by h lifts the line there by h (1 - t))
      if (over > 0) need = Math.max(need, over / (1 - t));
      if (t >= 0.9) break;
    }
    return need;
  }
  const signPos = new THREE.Vector3();
  const signNdc = new THREE.Vector3();
  /** a landmark primary's screen box (NDC x0, y0, x1, y1): the landmark is the bloom itself, the blade stays off it */
  const lmBox = [0, 0, 0, 0];
  /** The screen box (NDC) of the blade standing at (x, y, z), half width hw (m), into out; false if behind the camera. */
  const bladeBox = (x: number, y: number, z: number, hw: number, scale: number, pole: number, sx: number, sz: number, out: number[]): boolean => {
    out[0] = out[1] = Infinity;
    out[2] = out[3] = -Infinity;
    for (const k of [-1, 1])
      for (const h of [signTune.poleHeight - 1, signTune.poleHeight + 4]) {
        signNdc.set(x + sx * hw * scale * k, y + h * scale + pole, z + sz * hw * scale * k).project(camera);
        if (signNdc.z > 1) return false;
        out[0] = Math.min(out[0], signNdc.x); out[1] = Math.min(out[1], signNdc.y);
        out[2] = Math.max(out[2], signNdc.x); out[3] = Math.max(out[3], signNdc.y);
      }
    return true;
  };
  const bladeTmp = [0, 0, 0, 0];
  /** The blade's bottom edge (height yb, (hx, hz) = its half width along the view's right) is seen over
   *  its whole sightline to the camera (every 6 m, to 90% of the way), at five points across it: a tower
   *  or landmark more than 60 m in front (past what sightLift samples) hid half of the blade ("TELEGRA / H"
   *  behind Coit Tower). Buildings and landmarks by their real footprints and surfaces, not the obstacle
   *  grid: that is a collision grid (8 m cells, footprints grown 3-6 m) standing ~10 m proud of a facade,
   *  and a sign on the Ferry Building's apron read as hidden by the building behind it. Only for a spot
   *  that passed every other test (it samples the whole line). */
  function bladeSeen(x: number, yb: number, z: number, hx: number, hz: number): boolean {
    const c = camera.position;
    for (let k = -1; k <= 1; k += 0.5) {
      const px = x + hx * k, pz = z + hz * k;
      const d = Math.max(1, Math.hypot(c.x - px, c.y - yb, c.z - pz));
      for (let s = 6; s < 0.9 * d; s += 6) {
        const t = s / d, qx = px + (c.x - px) * t, qz = pz + (c.z - pz) * t;
        // (half a meter of slack at the blade, as sightLift's 0.5 m)
        if (Math.max(city.roofAt(qx, qz) ?? -Infinity, city.landmarkSurfaceAt(qx, qz)) > yb + (c.y - yb) * t + 0.5 * (1 - t)) return false;
      }
    }
    return true;
  }
  const signFwd = new THREE.Vector3();
  const SIGN_RING: ReadonlyArray<readonly [number, number]> = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [12, 0], [-12, 0], [0, 12], [0, -12], [9, 9], [-9, 9], [9, -9], [-9, -9]];
  /** Show (or re-flip) the sign of a blast at (cx, cz) of radius r. False: no open spot in frame yet, ask
   *  again later (`tries` so far); true once it is shown or given up on. */
  function showSign(ref: BuildingRef | null, text: string, from: string, hue: number, cx: number, cz: number, r: number, tries: number): boolean {
    const T = signTune;
    const life = T.riseTime + T.holdGreen + T.flipTime + T.holdRainbow + T.sinkTime;
    // another blast in the neighborhood while its sign stands: that sign flips again while it is in view
    // (two signs saying the same name side by side read as a glitch), unless this blast's bloom reaches
    // its spot: then it sinks, and the sign stands anew beside this blast (never in front of fresh paint)
    let same = false;
    if (signSpot && simTime < signSpot.until && signSpot.text === text) {
      signNdc.set(signSpot.x, signSpot.y + (T.poleHeight + 4) * signSpot.scale + signSpot.pole, signSpot.z).project(camera);
      const inView = Math.abs(signNdc.x) < 0.95 && Math.abs(signNdc.y) < 0.95 && signNdc.z < 1;
      const clear = Math.hypot(signSpot.x - cx, signSpot.z - cz) >= r + 4;
      same = clear && inView;
      if (!clear) signs.retire(signPos.set(signSpot.x, signSpot.y, signSpot.z));
    }
    if (!same) {
      camera.getWorldDirection(signFwd);
      const fl = Math.hypot(signFwd.x, signFwd.z);
      const fx = fl > 1e-3 ? signFwd.x / fl : flight.fx, fz = fl > 1e-3 ? signFwd.z / fl : flight.fz;
      const sx = -fz, sz = fx; // the view's right
      // off the flight line: away from a turn, else on the side the blast already sits
      const lat = (cx - camera.position.x) * sx + (cz - camera.position.z) * sz;
      const pref = Math.abs(flight.yawRate) > 0.05 ? -Math.sign(flight.yawRate) : lat >= 0 ? 1 : -1;
      let found: typeof signSpot = null;
      /** the first spot only a tall pole clears: it stands by, for when nothing takes less */
      let tall: typeof signSpot = null;
      // where to look (m along the view's forward and right from the blast's center): past the far side,
      // off the flight line; then beside it; then farther past. Never inside the blast (+ a margin): there
      // the sign stands in front of painted houses and covers the bloom. Per spot: the pole seen to its
      // foot, else (second pass) a pole lifted clear of the roofs in front, up to signTune.poleLiftMax; on a street
      // between taller roofs than that, the shortest pole up to signTune.poleLiftTall stands by for the last look
      const o1 = r + T.besideOut, s1 = T.besideSide * r;
      // (the blade's half width: its bottom corners must clear the roofs in front too, not just its middle:
      // a roof edge in front cut the letters diagonally)
      const hw = 0.5 * signBladeWidth(text);
      // a landmark is the money shot itself and may reach far past the blast: no blade over its box on screen
      const lm = !!ref && city.isLandmark(ref);
      if (ref && lm) {
        lmBox[0] = lmBox[1] = Infinity;
        lmBox[2] = lmBox[3] = -Infinity;
        for (const px of [ref.x0, ref.x1]) for (const pz of [ref.z0, ref.z1]) for (const py of [ref.baseY, ref.roofY]) {
          signNdc.set(px, py, pz).project(camera);
          if (signNdc.z > 1) continue;
          lmBox[0] = Math.min(lmBox[0], signNdc.x); lmBox[1] = Math.min(lmBox[1], signNdc.y);
          lmBox[2] = Math.max(lmBox[2], signNdc.x); lmBox[3] = Math.max(lmBox[3], signNdc.y);
        }
      }
      const overLm = (b: number[]) => lm && b[0] < lmBox[2] && b[2] > lmBox[0] && b[1] < lmBox[3] && b[3] > lmBox[1];
      const spots: Array<readonly [number, number]> = [];
      for (const [o, sd] of [[o1, s1], [0.25 * r, o1], [1.4 * o1, s1]]) spots.push([o, sd * pref], [o, -sd * pref]);
      for (let pass = 0; pass < 2 && !found; pass++) {
        for (const [out, sd] of spots) {
          const bx = cx + fx * out + sx * sd, bz = cz + fz * out + sz * sd;
          for (const [ox, oz] of SIGN_RING) {
            const x = bx + ox, z = bz + oz;
            if (Math.hypot(x - cx, z - cz) < r + 4) continue;
            if (city.roofAt(x, z) !== null) continue; // the pole stands on the street, a sidewalk or a lawn
            if (city.groundClassAt(x, z) === Ground.WATER) continue; // (not in the bay: the Ferry Building's far side)
            const y = city.groundAt(x, z);
            const dist = camera.position.distanceTo(signPos.set(x, y + T.poleHeight + 5, z));
            const scale = clamp((T.minFontPx * pipeline.pixelWorldSize(dist)) / Math.max(0.05, T.texelW), 1, 4);
            // the foot of the pole in view, or how much taller the pole must be for a meter of it to
            // show under the blade above the roofs in front
            const yb = y + (T.poleHeight - 1) * scale, cx0 = sx * hw * scale, cz0 = sz * hw * scale;
            const corners = Math.max(sightLift(x - cx0, yb, z - cz0), sightLift(x + cx0, yb, z + cz0));
            const pole = pass === 0 ? (sightLift(x, y + 1.5, z) > 0.5 || corners > 0.5 ? -1 : 0) : Math.max(sightLift(x, yb, z), corners);
            if (pole < 0 || pole > Math.max(T.poleLiftMax, T.poleLiftTall) || (tall && pole >= tall.pole)) continue;
            // the blade must land inside the frame, below the top band (the sky and the horizon)
            signNdc.set(x, y + (T.poleHeight + 4) * scale + pole, z).project(camera);
            if (Math.abs(signNdc.x) > 0.72 || signNdc.y > 0.7 || signNdc.y < -0.6 || signNdc.z > 1) continue;
            // (the whole blade in the frame, and never over a landmark primary's box)
            if (!bladeBox(x, y, z, hw, scale, pole, sx, sz, bladeTmp) || bladeTmp[0] < -0.96 || bladeTmp[2] > 0.96 || overLm(bladeTmp)) continue;
            // (and nothing farther in front hides it: the pole test above sees only the first 60 m)
            if (!bladeSeen(x, yb + pole, z, cx0, cz0)) continue;
            const spot = { x, y, z, facing: Math.atan2(-fx, -fz), scale, bias: true, pole, cx, cz, r, text, until: 0 };
            if (pole > T.poleLiftMax) {
              tall = spot;
              continue;
            }
            found = spot;
            break;
          }
          if (found) break;
        }
      }
      if (!found) {
        // nowhere open in frame: look again in a moment (the camera moves on), twice. Then a landmark
        // (it has no street front: the edge facing the bus) signs its name on its apron along that edge, as
        // far toward an end as the frame allows: off its box on screen if it can, else at least off its
        // middle (the landmark is the bloom; MAIN stood the sign at the middle of its face). Any other
        // primary: its own front only when that stands clear of the blast; inside it the blade would cover
        // the bloom: then no sign this time. Either way only a blade wholly in the frame and seen over its
        // whole sightline: else the tall pole, if this last look found one, else no sign (half a blade behind
        // a tower reads as a glitch, not a name).
        if (tries < 2) return false;
        if (ref) { // (open ground, nothing in reach: no front to fall back on)
          const f = lm ? city.edgeToward(ref, flight.x, flight.z) : city.frontOf(ref);
          const ex = -f.nz, ez = f.nx;
          const first = ex * sx + ez * sz >= 0 ? pref : -pref;
          let spare: typeof signSpot = null;
          for (const t of lm ? [1, 0.75, 0.5, 0.25] : [0]) {
            for (const k of [first, -first]) {
              const reach = t * (0.5 * f.len + hw + 4) * k;
              const gx = f.x + f.nx * 4.5 + ex * reach, gz = f.z + f.nz * 4.5 + ez * reach;
              if (!lm && Math.hypot(gx - cx, gz - cz) < r + 4) continue;
              if (city.groundClassAt(gx, gz) === Ground.WATER || city.roofAt(gx, gz) !== null) continue;
              const gy = city.groundAt(gx, gz);
              if (!bladeBox(gx, gy, gz, hw, 1, 0, sx, sz, bladeTmp) || bladeTmp[0] < -0.96 || bladeTmp[2] > 0.96 || bladeTmp[1] < -0.96 || bladeTmp[3] > 0.7) continue;
              if (!bladeSeen(gx, gy + T.poleHeight - 1, gz, sx * hw, sz * hw)) continue;
              const spot = { x: gx, y: gy, z: gz, facing: Math.atan2(f.nx, f.nz), scale: 1, bias: true, pole: 0, cx, cz, r, text, until: 0 };
              if (!overLm(bladeTmp)) { found = spot; break; }
              spare ??= spot;
            }
            if (found) break;
          }
          found ??= spare;
        }
        found ??= tall;
        if (!found) return true;
      }
      signSpot = found;
    }
    const sp = signSpot!;
    sp.until = simTime + life;
    // (true depth everywhere: a meter's bias against its own lawn, so painted houses in front keep covering it)
    signs.show({ text, position: signPos.set(sp.x, sp.y, sp.z), facing: sp.facing, hue, scale: sp.scale, biasNow: true, depthBias: 1, pole: sp.pole });
    lastSign = { text, x: sp.x, z: sp.z, from, t: simTime };
    audio.signPop();
    return true;
  }

  /** What a super splat's mega blast adds to a breath. */
  type MegaBreath = { radius: number; width: number; hitStop: number; tag: SuperTag };
  // Dragon breath aim (src/game/Aim.ts): the building that glints is the one a tap hits.
  const aimer = new Aimer(city, splatter);
  /** Breathe a shot: the blast is timed to the projectile's flight (inhale + travel), at the glinting building. */
  const breathe = (shot: Shot, mega?: MegaBreath) => {
    breathTravel = shot.travel;
    breathWidth = mega ? mega.width : 1;
    try {
      splatter.barf(shot.x, shot.z, { drop: shot.drop, travel: config.splat.inhale + shot.travel, target: shot.target, y: shot.y, exact: shot.exact, radius: mega?.radius, hitStop: mega?.hitStop, super: mega?.tag });
    } finally {
      breathTravel = null;
      breathWidth = 1;
    }
    // a breath into open water paints nothing: part of the belly comes back
    if (splatter.lastMiss) flight.refund = config.splat.missRefund;
  };

  /** QA: the last breath (aim point, flight time, drop, the building it should bloom). */
  let lastShot: unknown = null;

  const pose: BusPose = { squash: 1, eye: 1, fullness: 1, mouth: 0, speed: 0, wheeze: 0, heave: 0 };
  let squashV = 0;

  // ---- the opening's clock (0 .. config.fog.openingDuration), and the tap that skips it on repeat visits: it has been
  // seen through once, on this device (a lost flag only plays it again)
  let opening = params.has('skipintro') ? config.fog.openingDuration : 0;
  let openingSkip = false;
  let openingSeen = false;
  try {
    openingSeen = localStorage.getItem(OPENING_SEEN_KEY) === '1';
  } catch {
    // (storage blocked: the opening plays in full)
  }

  // ---- input
  const input = new Input(canvas);
  const tuner = new Tuner();
  // (the ODbL credit, then the other sources' own: ESA WorldCover's CC BY for where the trees stand)
  const dataCredits = [manifest.attribution ? `Map data ${manifest.attribution} (ODbL)` : '', ...Object.values(manifest.credits ?? {})].filter(Boolean);
  tuner.credits = dataCredits.join('; ');
  const perf = new Perf(renderer);
  perf.setVisible(params.has('fps'));
  tuner.onAction = (name) => {
    if (name === 'close') audio.setVolumes(config.audio);
  };
  tuner.onResetPaint = () => {
    city.paint.resetAll();
    city.ground.resetAll();
    location.reload();
  };
  if (params.has('tune')) tuner.toggle();
  // (GroundPaint saves on pagehide; a hidden page may never see one on iOS)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) city.ground.persist();
  });
  // tilt / touch / keyboard, the turbo gears and the HUD (src/game/Controls.ts)
  const controls = new Controls({ input, flight, rig, audio, particles, pipeline, camera, scene, bus, bounds: manifest.bounds, params });
  controls.hud.setCredits(dataCredits);
  input.onTripleFinger = () => tuner.toggle();
  input.onFirstGesture = () => {
    audio.unlock();
    controls.firstGesture();
  };
  input.onPress = () => aimer.press();
  /** A breath leaves now: anticipation (the bus squashes on this very frame, inhales, then the jet leaves), then the shot. */
  const breatheNow = (shot: Shot, mega?: MegaBreath) => {
    pose.squash = mega ? 0.72 : 0.8;
    squashV = 0;
    audio.heave();
    const tgt = shot.target;
    const iy = shot.y ?? (tgt ? city.roofAtPart(tgt, shot.x, shot.z) + 0.5 : city.groundAt(shot.x, shot.z));
    lastShot = { t: simTime, aim: [shot.x, iy, shot.z], travel: config.splat.inhale + shot.travel, drop: shot.drop, busY: flight.y, wall: shot.exact, target: tgt ? { index: tgt.index, cx: tgt.cx, cz: tgt.cz, roofY: tgt.roofY } : null, mega: mega?.radius };
    breathe(shot, mega);
    if (splatter.lastMiss) (lastShot as { miss?: boolean }).miss = true;
  };
  const tapSplat = () => {
    // (taps fire between frames: what fire() hands over is exactly the building on screen glinting)
    const shot = aimer.fire(flight);
    if (flight.tryBarf()) {
      breatheNow(shot);
      controls.splatted();
    } else audio.denied();
  };
  input.onTap = () => {
    if (tuner.visible || superSplat.hosing) return;
    // (the tap that skips the opening doesn't splat as well)
    if (openingSeen && !openingSkip && opening < config.fog.openingDuration) {
      openingSkip = true;
      controls.hud.clearToast();
      return;
    }
    tapSplat();
  };

  // ---- the super splat: hold to charge (src/game/SuperSplat.ts), its meter in the HUD's slot above MEGA
  const superSplat = new SuperSplat({
    flight, city, splatter, aimer, particles, fx: superFx, audio, rig,
    mouth: mouthWorld,
    busVel,
    exhaust: (out) => bus.root.localToWorld(out.copy(bus.exhaustLocal)),
    hatch: (out) => bus.root.localToWorld(out.copy(bus.hatchLocal)),
    tap: tapSplat,
    mega: (shot, radius, width, hitStop, tag) => {
      // a mega blast is a breath (the bus rears, stalls, heaves), whatever the belly holds
      flight.barfT = -1;
      flight.fullness = 1;
      flight.tryBarf();
      breatheNow(shot, { radius, width, hitStop, tag });
    },
    flash: (at, frames, strength) => {
      flashPos.copy(at).project(camera);
      pipeline.flash(flashPos.x * 0.5 + 0.5, flashPos.y * 0.5 + 0.5, frames, strength);
    },
    hitStop: (frames) => (hitStop = Math.max(hitStop, frames / 60)),
    sign: queueSign,
  });
  // (the charge's press: Input decides what a hold is, on MEGA or Space. Held past the threshold it charges; let go
  // under superMin it is still a splat, so no press is ever dead)
  input.onChargeStart = () => {
    if (tuner.visible) return;
    superSplat.chargeStart(input.state.chargeHeld);
    if (superSplat.phase === 'charging') {
      // (the line that teaches the hold ends the moment it is learned)
      controls.charged();
      superHintShown = true;
    }
  };
  input.onChargeEnd = (held, cancelled) => superSplat.chargeEnd(held, cancelled);
  // (the slot lives in the HUD's root: ?nohud hides it with the rest)
  const superMeter = new SuperMeter();
  superMeter.mount(controls.hud.slot('super'));
  // the hold is taught by the HOLD cue on MEGA's face (src/ui/Coach.ts); a desktop has no MEGA, so it gets the one line:
  // when the belly first fills again after a splat (the player knows the tap by then), once a session, until they have
  // charged a super. (Per viewer; a lost flag only shows it again.)
  const SUPER_HINT_KEY = 'strugglebus.superhint.v1';
  let superHintShown = false;
  try {
    superHintShown = localStorage.getItem(SUPER_HINT_KEY) === '1';
  } catch {
    // (storage blocked: the line shows once a session)
  }
  if (superHintShown) controls.learnedMega();
  const superHint = () => {
    if (superHintShown || superSplat.phase !== 'ready' || input.mode !== 'keyboard') return;
    superHintShown = true;
    controls.holdHint();
  };
  superSplat.onLearned = () => {
    superHintShown = true;
    controls.learnedMega();
    try {
      localStorage.setItem(SUPER_HINT_KEY, '1');
    } catch {
      // (storage blocked: see above)
    }
  };
  /** the bus's pose with the super splat's body language on top (the game's own pose stays its spring state) */
  const superPose: BusPose = { ...pose };

  // ---- resize (applied once per frame: iOS fires bursts of resize / visualViewport events while its toolbars move)
  const onResize = () => {
    pipeline.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    particles.setViewportHeight(pipeline.info.height);
    superFx.setViewportHeight(pipeline.info.height);
  };
  let resizeWanted = false;
  const wantResize = () => (resizeWanted = true);
  window.addEventListener('resize', wantResize);
  window.visualViewport?.addEventListener('resize', wantResize);
  onResize();

  // ---- a lost GL context (a GPU reset, memory pressure on iOS, a tab long in the background): the game stops, the
  // fog-grey page shows in place of the dead canvas. On restore every program compiles again through the warm-up, not
  // one by one in the first frames; every region streams back in (their meshes kept no JS copy, City.reloadAll), budgeted
  // like the opening's, with the game clock standing until the city is in
  let glLost = false;
  /** the page shows instead of the canvas: frames run at dt 0 until the city is back */
  let covered = false;
  // the first ready frame adopts streamed tiles at once (as the classic streaming did); then budgeted
  let everReady = false;
  canvas.addEventListener('webglcontextlost', () => {
    glLost = covered = true;
    warm.abandon();
    canvas.style.visibility = 'hidden';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    // (three re-created its GL state first: its own listener was added with the renderer)
    city.reloadAll();
    everReady = false;
    city.eager = true;
    warm = new WarmUp(pipeline, scene);
    warm.add(scene);
    void warm.finish().then(() => (glLost = false));
  });

  // ---- the warm-up's second wave: the live scene as built so far (the bus, the Golden Gate, water,
  // signs, particles, the drop shadow) and what registered while it was built (rooftop gardens)
  warm.addSources();
  warm.add(scene);
  exposeQA();

  // ---- before the first frame: every program compiled and drawn once (never presented) and the far
  // city in. Meanwhile the opening's regions are adopted as they land, and the deferred landmarks are
  // built, one per tick (the main thread is free: the GPU process compiles)
  let farIn = false;
  let farErr: unknown = null;
  void farP.then(
    () => (farIn = true),
    (e) => ((farErr = e), (farIn = true)),
  );
  for (;;) {
    later.shift()?.();
    // (a few tiles per tick: no long task while the GPU process compiles; the first frame takes the rest)
    city.update(primeFocus, renderer, 0, 12);
    if (farIn) {
      if (farErr) throw farErr;
      // (the far meshes, and whatever was built meanwhile: only kinds not seen yet compile)
      if (!glLost) warm.add(scene);
      if (!warm.busy) break;
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  fogGround = city.lowGround();
  updateSun();
  globals.uFogBank.value = config.fog.openingBank;
  rig.openingPull = 140;

  // ---- the loop
  let last = performance.now();
  let wasFull = true;
  // QA: ?fixeddt=<s> steps the game by exactly that much per rendered frame (deterministic captures)
  const fixedDt = params.has('fixeddt') ? Math.max(0.001, Number(params.get('fixeddt')) || 1 / 60) : 0;
  // the data credit (ODbL), small, on every load however the game starts (the opening played, a repeat visit's
  // tap past it, ?skipintro): it has its own clock, not the opening's. From the frame the first region is in
  // (something is on screen), not from boot (a slow phone may show fog for seconds), on the game clock (the first
  // frames after the city lands can each take a second), and at most 6.4 s of the wall clock once it is up (a slow
  // device's game clock runs behind the wall; a ?fixeddt capture's game clock has nothing to do with it, so there
  // only the game clock counts). Settings' MAP DATA keeps it one tap away afterwards. (?nohud: a capture.)
  const credit = manifest.attribution && !params.has('nohud') ? new Credit(manifest.attribution, 0.3, 5.8, fixedDt ? 0 : 6.4) : null;
  let lodTimer = 0;
  let puffTimer = 0;
  const puffPos = new THREE.Vector3();
  const puffVel = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const sparkPos = new THREE.Vector3();
  const nearTmp: Array<{ ref: BuildingRef; d: number }> = [];
  const camFwd = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const snapPoint = new THREE.Vector3();
  const compTmp = new THREE.Vector3();
  const streamCenter = new THREE.Vector3();
  /** frames rendered (the opening's clock starts once the first one is on screen) */
  let framesDrawn = 0;

  type QA = { sx?: number; sy?: number; holdAt?: number; holdFrames?: number; held?: boolean; topDown?: { lat: number; lon: number; height: number } | null };
  function frame(now: number) {
    requestAnimationFrame(frame);
    if (glLost) {
      last = now;
      return;
    }
    const qa = (window as unknown as { __qa?: QA | null }).__qa;
    // QA: freeze on the first frame at/after holdAt (the canvas keeps showing it)
    if (qa && qa.holdAt !== undefined && simTime >= qa.holdAt) {
      qa.held = true;
      last = now;
      return;
    }
    // QA: render holdFrames more frames, then freeze (steps through hit-stop frames, whose game time stands still)
    if (qa && qa.holdFrames !== undefined) {
      if (qa.holdFrames <= 0) {
        qa.held = true;
        last = now;
        return;
      }
      qa.holdFrames--;
    }
    const t0 = performance.now();
    if (resizeWanted) {
      resizeWanted = false;
      onResize();
    }
    // (never negative: the first frame's timestamp can predate `last`, by the whole warm-up on a slow GPU)
    let dt = fixedDt || Math.min(0.05, Math.max(0, (now - last) / 1000));
    const realDt = dt;
    // the game holds under iOS's motion sheet, and while a restored context streams the city back in
    const held = controls.sheetUp || covered;
    // the opening runs on the wall clock from when the first frame reached the screen (the second
    // frame's callback): it overlaps loading, and slow frames (down to 4 fps) don't stretch it. A
    // longer gap (a tab switch, a locked phone, a long task) moves it 0.25 s at most, so the reveal
    // is never skipped. It holds with the game
    const openDt = held ? 0 : fixedDt || (framesDrawn >= 2 ? Math.min(0.25, Math.max(0, (now - last) / 1000)) : 0);
    last = now;
    if (held) dt = 0;
    if (hitStop > 0) {
      hitStop -= dt;
      dt = 0; // freeze everything: two frames of awe
    }
    simTime += dt;
    globals.uTime.value = simTime;
    updateSun(); // cheap; keeps the tuner's light + fog sliders live

    // opening: the bus emerges from a fog bank while the city streams in behind it
    if (opening < config.fog.openingDuration) {
      const loaded = city.loadedRegionCount() > 0;
      // (skipped: the same reveal, played in ~0.7 s)
      const step = openingSkip ? openDt * 6 : openDt;
      opening = loaded ? opening + step : Math.min(opening + step, config.fog.openingDuration * 0.15);
      const k = clamp(opening / config.fog.openingDuration, 0, 1);
      globals.uFogBank.value = 1 + (config.fog.openingBank - 1) * Math.pow(1 - k, 2);
      rig.openingPull = 140 * Math.pow(1 - k, 2);
    } else {
      globals.uFogBank.value = 1;
      rig.openingPull = 0;
    }
    if (city.loadedRegionCount() > 0) credit?.start(simTime);
    credit?.update(simTime, now);

    // input -> flight (substeps keep springs stable on slow frames)
    input.update(dt);
    controls.preFlight(dt);
    const st = input.state;
    const qaStick = qa && typeof qa.sx === 'number' && typeof qa.sy === 'number';
    let sx = qaStick ? qa.sx! : st.stretch.x;
    let sy = qaStick ? qa.sy! : st.stretch.y;
    // the opening: the yoke can't climb until the bus (and the low camera trailing 150 m behind
    // it) is clear of the Golden Gate, so the bus always threads under the deck and the camera
    // never rises through the cables (turning away ends it: `along` is along the heading)
    const gateAlong = openingBridge ? (flight.x - openingBridge[0]) * flight.fx + (flight.z - openingBridge[1]) * flight.fz : 0;
    const gateDist = openingBridge ? Math.hypot(flight.x - openingBridge[0], flight.z - openingBridge[1]) : Infinity;
    if (openingBridge && gateAlong < config.camera.openingClimbAfter) {
      if (sy < -0.5 && opening >= config.fog.openingDuration) controls.climbGated();
      sy = Math.max(0, sy);
      // (and it glides level: the floor over the strait drops 19 m in each tile the data has, and the one under the deck ends just past it)
      flight.turbo.floor = Math.max(flight.turbo.floor, config.camera.openingGlide);
    }
    // (nor can a gear lift it: a shift waits for the gate)
    controls.gearsLocked = !!openingBridge && gateAlong < config.camera.openingClimbAfter;
    controls.opening = opening < config.fog.openingDuration;
    const dragging = qaStick ? true : st.dragging;
    // past the edge of the map the bus homes back toward the city, gently; the edge gives way with the height, and out
    // there only the ground has collision, so the bus holds a slope down to the map
    const ex = Math.max(minX - flight.x, flight.x - maxX, 0), ez = Math.max(minZ - flight.z, flight.z - maxZ, 0);
    const edgeOut = mapReach(flight.height);
    if (ex + ez > edgeOut && !openingBridge) {
      const home = Math.atan2((minX + maxX) / 2 - flight.x, -((minZ + maxZ) / 2 - flight.z));
      let dh = home - flight.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      sx = clamp(sx + clamp(dh, -1, 1) * clamp((ex + ez - edgeOut) / 600, 0, 1), -1, 1);
    }
    const pastMap = floorPastMap(ex + ez);
    if (pastMap > 0) flight.turbo.floor = Math.max(flight.turbo.floor, pastMap);
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < steps; i++) flight.step(dt / steps, { sx, sy, dragging: dragging || sx !== st.stretch.x }, city);
    if (!wasFull && flight.fullness >= 1) {
      audio.ready();
      superHint();
    }
    wasFull = flight.fullness >= 1;

    // bus pose: squash on the tap frame and through the inhale, stretch as the jet leaves, heave while
    // barfing, wheeze when full (the squash spring is substepped like the flight: same at 30 and 60 fps)
    const barfing = flight.barfing;
    for (let i = 0; i < steps; i++) {
      const h = dt / steps;
      // (the breath's clock at this substep, so the squash -> stretch switch lands at the same time at any fps)
      const bt = flight.barfT - (steps - 1 - i) * h;
      const sqTarget = barfing && bt >= 0 ? (bt < config.splat.inhale + 0.03 ? 0.78 : 1.06) : 1;
      squashV += ((sqTarget - pose.squash) * 260 - squashV * 16) * h;
      pose.squash += squashV * h;
    }
    pose.heave = barfing ? Math.max(0, 1 - flight.barfT / config.splat.duration) : 0;
    pose.mouth = 0; // the breath comes out of the bus's face, not the side door
    // the belly band drains as the breath pours out (and the "loaded" cues drop on the blast)
    pose.fullness = flight.barfT >= 0 ? flight.belly : flight.fullness;
    pose.speed = flight.speed;
    // (and when it strains against the ceiling: the struggle bus)
    pose.wheeze = flight.barfT >= 0 ? 0 : Math.max(flight.fullness * 0.8, flight.strain);
    pose.eye = barfing ? 0.25 : flight.relief > 0 ? 1 : 0.55 + 0.45 * (1 - flight.fullness * 0.6);
    controls.pose(pose);
    superSplat.pose(pose, superPose);
    bus.update(dt, simTime, superPose);
    eul.set(flight.pitch + superSplat.pitch, -flight.heading, -flight.bank, 'YXZ');
    q.setFromEuler(eul);
    bus.root.quaternion.copy(q);
    bus.root.position.set(flight.x, flight.y, flight.z).add(superSplat.shake);
    controls.afterPose(bus.root);

    // drop shadow on whatever is below: the roof of the part under the bus, else the street
    const below = city.roofAt(flight.x, flight.z) ?? flight.groundUnder;
    dropShadow.set(flight.x, below, flight.z);
    // (half length ~0.32 bus length, half width 0.42 of that: about the bus's own footprint, a little
    // bigger with a breath loaded; it shrinks with the gap below)
    const shadowFar = clamp((flight.y - below - 14) / 36, 0, 1);
    dropShadowL = 0.32 * bus.length * (Aimer.loaded(flight) ? 1.05 : 0.95) * rig.heroScale * (1 - 0.3 * shadowFar);

    if (openingBridge) {
      // stay low and level until we're well past the bridge, then rise into the normal chase view
      // (steering takes over early, but never near the bridge: the chase camera would fly through the cables)
      const want = gateAlong < 180 && (!dragging || gateDist < 320) ? 1 : 0;
      rig.openingLow += (want - rig.openingLow) * (1 - Math.exp(-(want ? 4 : 0.7) * dt));
      if (rig.openingLow < 0.01 && want === 0 && (gateAlong >= 180 || gateDist > 1500)) {
        rig.openingLow = 0;
        openingBridge = null;
      }
    }
    // aim glint on the building a tap would hit (picked every frame), only while a breath is loaded
    // (a committed thumb thaws the glint, as keys and a QA stick do; tilt never does; and a press that fires on its lift
    // keeps what it froze, whatever else is steering)
    const glint = aimer.update(flight, simTime, (qaStick || st.thumb || (st.dragging && input.mode === 'keyboard')) && !input.pressHeld);
    controls.glinting = glint !== null;
    paintUniforms.uTarget.value = glint ? glint.index : -1;
    paintUniforms.uTargetT.value = aimer.shownSince;
    paintUniforms.uGlint.value.set(config.splat.glintLift, config.splat.glintSweep, config.splat.glintRate);
    paintUniforms.uFloodHead.value = config.bloom.floodHead;
    rig.update(camera, focus, flight, dt);
    superSplat.camera(camera, focus, dt);
    rig.applyKick(camera, realDt);
    pipeline.focus.copy(focus);
    if (qa?.topDown) {
      // QA: look straight down on a lat/lon (hue layout from above)
      const [tx, tz] = latLonToLocal(qa.topDown.lat, qa.topDown.lon, manifest.origin);
      const gy = city.groundAt(tx, tz);
      camera.position.set(tx, gy + qa.topDown.height, tz + 0.01);
      camera.up.set(0, 0, -1);
      camera.lookAt(tx, gy, tz);
      pipeline.focus.set(tx, gy, tz);
    }
    globals.uGroundRef.value = flight.groundUnder - 30;

    // ---- altitude: the vista lens, the hero's scale, the marine layer seen from above,
    // streaming ahead under the view, a wider (softer) shadow window
    const vista = rig.vista;
    pipeline.setHfov(rig.hfov);
    bus.root.scale.setScalar(rig.heroScale * superSplat.swell);
    // this frame's matrix now: the breath and the exhaust leave from where the bus IS (not last frame's pose)
    bus.root.updateMatrixWorld(true);
    controls.frame(dt, realDt);
    const Fg = config.fog;
    const camY = camera.position.y;
    // (gated by the vista, i.e. by the height above the ground: skimming the floor over Twin Peaks the
    // camera is 380 m above the sea but the fog must stay exactly the street-level Hopper fog)
    const layerMix = clamp((camY - Fg.layerTop - Fg.layerViewStart) / Math.max(1, Fg.layerViewFull - Fg.layerViewStart), 0, 1) * clamp(vista / 0.3, 0, 1);
    const layerS = layerMix * layerMix * (3 - 2 * layerMix);
    globals.uFogLayer2.value.w = Fg.enabled ? layerS : 0;
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    if (camFwd.lengthSq() < 1e-6) camFwd.set(flight.fx, 0, flight.fz);
    camFwd.normalize();
    // the lens with the height: depth where the ground is, and the fade as far along it from any height
    const lensFar = fadeOn ? fadeEnd(flight.height, FADE_END, city.landRoom(camera.position.x, camera.position.z)) : 0;
    pipeline.setDepthRange(nearPlane(flight.height, camNear), fadeOn ? lensFar + FADE_FAR : camera.far);
    if (fadeOn && !Fg.enabled) globals.uFog.value.z = lensFar;
    const hk = clamp(flight.lift / 450, 0, 1);
    streamCenter.set(focus.x + camFwd.x * 950 * hk, focus.y, focus.z + camFwd.z * 950 * hk);
    city.viewHeight = flight.lift;
    city.viewX = camera.position.x;
    city.viewZ = camera.position.z;
    city.detailHold = controls.tearing;
    city.detailScale = Math.tan(THREE.MathUtils.degToRad(config.camera.hfovPortrait / 2)) / Math.tan(THREE.MathUtils.degToRad(rig.hfov / 2));
    const R = config.render;
    const sAhead = R.shadowAheadVista * vista;
    const sx0 = focus.x + camFwd.x * sAhead, sz0 = focus.z + camFwd.z * sAhead;
    pipeline.shadowFocusOn = true;
    pipeline.shadowFocus.set(sx0, focus.y + (city.groundAt(sx0, sz0) - focus.y) * vista, sz0);
    pipeline.shadowScale = 1 + (R.shadowExtentVista / Math.max(1, R.shadowExtent) - 1) * vista;
    pipeline.shadowStrength = 1 + (R.shadowStrengthVista - 1) * vista;
    pipeline.shadowEdge = 0.08 + (R.shadowEdgeVista - 0.08) * vista;
    pipeline.calm = clamp(vista / Math.max(0.01, config.render.calmVista), 0, 1);
    // tower facades: the up-high anti-crawl guard follows the view's height (with fog on or off), and their
    // mirror of the resolve's sky light needs its calm term
    setFacadeView(layerS, pipeline.calm);

    // the splat before the city's paint upload: the impact frame itself already shows the hit (and the
    // hit-stop frames hold it), instead of the paint reaching the GPU a frame late
    superSplat.update(dt);
    splatter.update(dt);
    if (jet && simTime >= jet.at) {
      // the inhale is over: the jet leaves the mouth and lands exactly at the impact
      particles.geyser({ source: mouthWorld, sourceVel: busVel, targets: jet.targets, duration: Math.max(0.05, jet.end - simTime), travelTime: Math.max(0.05, jet.impact - simTime), hues: jet.hues, width: jet.width });
      jet = null;
    }
    superFx.update(dt, mouthWorld(), bus.root.matrixWorld);
    city.update(streamCenter, renderer, dt);
    spire?.update(city.paint.data, globals.uTime.value);
    // tree LOD by distance from the lens (fog eats far groves anyway; a wider view keeps simple canopies farther)
    lodTimer -= dt;
    if (lodTimer <= 0) {
      lodTimer = 0.25;
      // high above the marine layer, tiles buried in solid fog skip their draws
      city.cullBuried(globals.uFogLayer2.value.w > 0.99 ? buriedTile : null);
      const ts = manifest.tileSize;
      const far1 = 900 * (1 + 0.8 * vista);
      for (const [k, tf] of treeFields) {
        const c = k.indexOf(',');
        const tx = Number(k.slice(0, c)), tz = Number(k.slice(c + 1));
        const cx = (tx + 0.5) * ts, cz = (tz + 0.5) * ts;
        const d = Math.hypot(cx - camera.position.x, cz - camera.position.z, Math.max(0, camY - city.groundAt(cx, cz) - 120));
        tf.setLod(city.tileHidden(tx, tz) ? 2 : d < 350 ? 0 : d < far1 ? 1 : 2);
      }
    }
    // the struggle: a wheezy exhaust sputter, more of it when the belly is full
    puffTimer -= dt;
    if (puffTimer <= 0 && dt > 0) {
      puffTimer = (0.35 + 0.9 * (1 - flight.fullness) + Math.random() * 0.25) * (1 - 0.7 * flight.strain);
      bus.root.localToWorld(puffPos.copy(bus.exhaustLocal));
      puffVel.set(-flight.fx * 4 + (Math.random() - 0.5) * 2, 1.2 + Math.random(), -flight.fz * 4 + (Math.random() - 0.5) * 2);
      particles.puff(puffPos, puffVel);
    }
    particles.update(dt);
    // (a street sign waiting for its blast's bloom)
    for (let i = pendingSigns.length - 1; i >= 0; i--) {
      const ps = pendingSigns[i];
      if (simTime < ps.at) continue;
      if (!showSign(ps.ref, ps.text, ps.from, ps.hue, ps.cx, ps.cz, ps.r, ps.tries)) {
        ps.tries++;
        ps.at = simTime + 0.8;
        continue;
      }
      pendingSigns.splice(i, 1);
    }
    signs.update(dt, camera);

    // painted neighborhoods hum
    const near = city.buildingsNear(flight.x, flight.z, 90, nearTmp);
    let painted = 0;
    for (const n of near) if (city.paint.level(n.ref.index) > 0.5) painted++;
    audio.update(dt, {
      speed: flight.speed,
      surge: flight.surge,
      fullness: flight.barfT >= 0 ? flight.belly : flight.fullness,
      altitude: flight.y - flight.groundUnder,
      paintNearby: near.length ? painted / near.length : 0,
      fogBank: clamp((globals.uFogBank.value - 1) / Math.max(0.001, config.fog.openingBank - 1), 0, 1),
      high: clamp(flight.lift / 420, 0, 1),
      fogBelow: globals.uFogLayer2.value.w,
      strain: Math.max(flight.strain, superSplat.spent),
    });
    // ambient twinkles on painted buildings near the bus
    if (painted && Math.random() < dt * 6) {
      const pick = near[Math.floor(Math.random() * near.length)];
      if (pick && city.paint.level(pick.ref.index) > 0.5) {
        const r = pick.ref;
        sparkPos.set(r.cx + (Math.random() - 0.5) * 6, r.baseY + Math.random() * (r.roofY - r.baseY + 2), r.cz + (Math.random() - 0.5) * 6);
        particles.ambientSparkle(sparkPos, city.paint.get(r.index).color);
      }
    }

    // ---- up high the city is what must hold still: the pixel grid snaps at the depth of the ground
    // under the screen center instead of at the bus (whose snap step would resample every far roof
    // on every frame); the bus, its drop shadow and its particles take the snap's remainder, so
    // they stay exactly where they are
    if (vista > 0) {
      camera.getWorldDirection(camDir);
      const tC = clamp((camY - flight.groundBroad) / Math.max(0.06, -camDir.y), 50, snapReach(flight.height, 5000));
      snapPoint.copy(camera.position).addScaledVector(camDir, tC);
      pipeline.focus.lerp(snapPoint, vista);
    }
    pipeline.steadySnap = vista > 0;
    pipeline.snap();
    if (vista > 0) {
      bus.root.position.add(pipeline.snapCompensation(bus.root.position, compTmp));
      dropShadow.add(pipeline.snapCompensation(dropShadow, compTmp));
      pipeline.snapCompensation(bus.root.position, particles.object.position);
    } else particles.object.position.set(0, 0, 0);
    superFx.object.position.copy(particles.object.position);
    controls.fx.object.position.copy(particles.object.position);
    // (only what lies below the bus's wheels; whatever faces up there, roof, street, lawn or crown)
    pipeline.setHeroShadow(dropShadow.x, dropShadow.z, bus.root.position.y - 2.2 * rig.heroScale, flight.fx, flight.fz, dropShadowL, dropShadowL * 0.42, 1);
    // the charge's summoning circle: a rainbow pinwheel around that shadow, on the same surfaces (no decal, no draw)
    {
      const sz = 5.6 * rig.heroScale * (1 + 2.4 * superSplat.circle);
      pipeline.setHeroCircle(superSplat.circle, superSplat.circleSpin, sz, sz * 0.5);
    }
    // the eye's beam, from the lens along the nose, a little down: wide open on relief, a sliver
    // while barfing (it squints); the bus's matrix is final here
    {
      const Cb = config.camera;
      bus.root.updateMatrixWorld();
      bus.root.localToWorld(beamEye.copy(bus.eyeLocal));
      beamFwd.set(0, -Math.tan(THREE.MathUtils.degToRad(Cb.headBeamPitch)), -1).transformDirection(bus.root.matrixWorld);
      beamTip.copy(beamEye).addScaledVector(beamFwd, Cb.headBeamLength * rig.heroScale);
      const open = 0.3 + 0.7 * superPose.eye;
      pipeline.setHeroBeam(beamEye, beamTip, 0.5 * rig.heroScale, 0.5 * Cb.headBeamWidth * open * rig.heroScale, Cb.headBeamLength > 0 ? Cb.headBeamStrength * (0.35 + 0.65 * superPose.eye) : 0);
    }
    pipeline.render(scene);
    framesDrawn++;
    // (a tap in the grey has skipped it already)
    if (framesDrawn === 2 && openingSeen && !openingSkip && opening < config.fog.openingDuration) controls.hud.toast(['TAP TO SKIP'], 2.2);
    // a deferred landmark (one per frame, early in the opening) when the warm-up didn't leave time for them all
    later.shift()?.();
    const superView = superSplat.view();
    superMeter.update(realDt, superView);
    controls.hud.setMega(superView.phase);
    perf.frame(dt * 1000, performance.now() - t0);
    const cityIn = city.loadedRegionCount() > 0 && !city.busy && !later.length;
    if (covered && cityIn) {
      covered = false;
      canvas.style.visibility = '';
    }
    const ready = cityIn && (opening >= config.fog.openingDuration || params.has('openingshot'));
    if (ready && !everReady) {
      audio.prepare();
      if (!params.has('skipintro') && !params.has('lat')) {
        try {
          localStorage.setItem(OPENING_SEEN_KEY, '1');
        } catch {
          // (storage blocked: see above)
        }
      }
    }
    if (ready) everReady = true;
    city.eager = !everReady;
    (window as unknown as { __shotReady?: boolean }).__shotReady = ready && !city.farLate;
  }
  requestAnimationFrame(frame);

  // debug hooks for scripted screenshots / QA (set before the warm-up wait: tools see the city stream in)
  function exposeQA() {
    // (asked for now: there is no asking once the context is gone)
    const lose = renderer.getContext().getExtension('WEBGL_lose_context');
    (window as unknown as Record<string, unknown>).__game = {
      flight, city, splatter, input, audio, rig, camera, tuner, perf, pipeline, scene, config, HUE_RAMPS, controls,
      /** QA: the shader warm-up (report: programs, draws, ms; doneAt: performance.now() when it finished) */
      get warm() {
        return warm;
      },
      /** QA: lose the GL context, and get it back (the game's whole path through a GPU reset) */
      loseContext: () => lose?.loseContext(),
      restoreContext: () => lose?.restoreContext(),
      /** QA: where a breath fired now would land ({x, y, z, dist, travel, drop}), and the last one fired */
      aimNow: () => (aimer.point(flight), { ...aimer.aim }),
      /** QA: the building glinting now (what a tap hits) */
      glintNow: () => {
        const r = aimer.shown();
        return r ? { index: r.index, cx: r.cx, cz: r.cz, roofY: r.roofY, since: aimer.shownSince } : null;
      },
      aimer,
      /** QA: set a registered tunable (group name, key) live, e.g. ('Props', 'treeFine', 0) */
      tuneGroup: (name: string, key: string, v: number | boolean) => {
        const g = tunableGroups().find((x) => x.name === name);
        if (g && key in g.values) (g.values as Record<string, unknown>)[key] = v;
      },
      /** QA: render the frozen frame again (after a tunable change: the same frame, another variant) */
      renderAgain: () => {
        updateSun();
        pipeline.render(scene);
      },
      lastShot: () => lastShot,
      /** QA: the last street sign raised: { text, x, z, from: 'street' | 'hoodAt' | 'building hood' | 'nearest label' | 'landmark', t } */
      lastSign: () => lastSign,
      /** QA: how much of the marine layer's seen-from-above fog is on (0 = the street-level fog exactly) */
      fogLayerMix: () => globals.uFogLayer2.value.w,
      tapSplat: () => input.onTap?.(),
      /** QA: hold the super splat's charge until `chargeSeconds` held (from `fromSeconds`, default 0), then let go
       * (>= config.splat.superCharge: the firehose). Returns the game time it lets go, or -1 (cooling down: "not yet"). */
      superSplat: (chargeSeconds: number, fromSeconds?: number) => superSplat.qaCharge(chargeSeconds, fromSeconds),
      /** QA: the super splat's state (phase, charge, cooldown, the last super's stats) */
      superState: () => ({ phase: superSplat.phase, charge: superSplat.charge, since: superSplat.since, cooldownLeft: superSplat.cooldownLeft, cooldownTotal: superSplat.cooldownTotal, spent: superSplat.spent, stats: { ...superSplat.stats } }),
      /** QA: skip seconds of the super splat's cooldown */
      superSkip: (seconds: number) => superSplat.qaSkip(seconds),
      /** QA: render a scripted super splat session offline through the real audio graph (peak, RMS, NaN) */
      superAudioCheck: () => import('./audio/superAudioCheck').then((m) => m.superAudioCheck()),
      superSplatter: superSplat,
      superMeter,
      forceReady: () => (flight.fullness = 1),
      /** QA: barf at a lat/lon through the real splat pipeline (blast, blooms, sign, sound). Returns the impact time (game clock). */
      barfAtLatLon: (lat: number, lon: number, drop?: number) => {
        const [x, z] = latLonToLocal(lat, lon, manifest.origin);
        audio.heave();
        return splatter.barf(x, z, { drop });
      },
      clock: () => simTime,
      /** QA: n settled blasts scattered within `spread` m of a lat/lon straight into the ground paint (and saved), like a long play session. Returns the saved tile count. */
      seedGround: (n: number, lat: number, lon: number, spread: number) => {
        const [x, z] = latLonToLocal(lat, lon, manifest.origin);
        let s = 12345;
        const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < n; i++)
          city.ground.blast(makeBlastSpec(x + (rnd() - 0.5) * 2 * spread, z + (rnd() - 0.5) * 2 * spread, blastRadiusFor(rnd() < 0.2 ? 300 : 0), i % 6, (rnd() * 4294967295) >>> 0), -100);
        city.ground.persist();
        return city.ground.tileCount;
      },
      /** QA: buildings painted / total within r of a lat/lon, and the share of ground painted there */
      paintedNear: (lat: number, lon: number, r: number) => {
        const [x, z] = latLonToLocal(lat, lon, manifest.origin);
        const near = city.buildingsNear(x, z, r, []);
        let painted = 0, cells = 0, ground = 0;
        for (const n of near) if (city.paint.level(n.ref.index) > 0.5) painted++;
        for (let dz = -r; dz <= r; dz += 4)
          for (let dx = -r; dx <= r; dx += 4) {
            if (dx * dx + dz * dz > r * r) continue;
            cells++;
            const g = city.ground.sample(x + dx, z + dz);
            if (g && g.cov >= 0.5) ground++;
          }
        let trees = 0;
        for (const [k, list] of treeIndex) {
          const tf = treeFields.get(k);
          if (tf) for (let i = 0; i < list.length; i++) if (Math.hypot(list[i].x - x, list[i].z - z) < r && tf.paintLevel(i) > 0) trees++;
        }
        return { buildings: near.length, painted, groundShare: cells ? ground / cells : 0, paintedTrees: trees, savedTiles: city.ground.tileCount, landed: city.ground.landedCount, queued: city.ground.queued };
      },
    };
  }
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 0 0 0;color:#fff;font:12px monospace;padding:12px;background:#0008">${String(e)}</pre>`);
});
