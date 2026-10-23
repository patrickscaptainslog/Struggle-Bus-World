import * as THREE from 'three';
import { config } from './config';
import { PixelPipeline } from './render/PixelPipeline';
import { globals, GLSL_COMMON, GLSL_OUT, layerTopBase } from './render/materials';
import { Ramp, HUE_RAMPS } from './render/palette';
import { City, type BuildingRef } from './world/City';
import { paintUniforms } from './world/buildingMaterial';
import type { CityManifest } from './world/tiles';
import { Flight } from './game/Flight';
import { CameraRig } from './game/CameraRig';
import { Splatter } from './game/Splat';
import { Input } from './game/Input';
import { BusModel, type BusPose } from './bus/BusModel';
import { Particles } from './fx/Particles';
import { StreetSigns } from './fx/StreetSign';
import { AudioEngine } from './audio/AudioEngine';
import { TreeField, RoofSprouts, makeSutroTower, makeTransamerica, type TreeInstance } from './world/Props';
import { Tuner, applySavedTuning } from './ui/Tuner';
import { makeGoldenGate, makeBayBridgeWest, bridgeObstacles } from './world/Bridges';
import { Perf } from './ui/Perf';
import { clamp } from './game/springs';

// Struggle Bus — Phase 1 (real SF, solo).

/** Pixel-art drop shadow: a small solid core inside a stippled (checker) halo. */
function makeDropShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...globals, uReady: { value: 0 } },
    vertexShader: /* glsl */ `
      ${GLSL_COMMON}
      out vec2 vLocal;
      out vec3 vWorldPos;
      void main() {
        vLocal = position.xz;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      uniform float uReady;
      in vec2 vLocal;
      in vec3 vWorldPos;
      ${GLSL_OUT}
      void main() {
        float r = length(vLocal);
        ivec2 q = ivec2(gl_FragCoord.xy);
        bool checker = ((q.x + q.y) & 1) == 0;
        if (r > 0.62 && !checker) discard;
        if (r > 1.0) discard;
        float fog = sbFog(vWorldPos);
        sbWrite(${Ramp.INK}.0, r > 0.62 ? 0.35 : 0.15 + 0.1 * uReady, fog, 0.0, vec3(0.0, 0.0, 1.0), 0.97, 0.5);
      }
    `,
  });
}

type Manifest = CityManifest & { regions: Array<[number, number, number]>; regionSize: number };

const params = new URLSearchParams(location.search);
applySavedTuning();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const pipeline = new PixelPipeline(canvas);
const renderer = pipeline.renderer;
const scene = new THREE.Scene();
const camera = pipeline.camera;

// --- sun: late-afternoon, low, from the WSW
function updateSun() {
  const az = config.light.sunAzimuth;
  const el = config.light.sunElevation;
  globals.uSunDir.value.set(Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el)).normalize();
  globals.uLight.value.set(config.light.sunStrength, config.light.ambient, config.light.skyBounce);
  globals.uFog.value.set(config.fog.density, config.fog.heightFalloff, config.fog.farFull, 1);
  globals.uPaintClearing.value = config.fog.paintClearing;
  const Fg = config.fog;
  globals.uFogLayer.value.set(Fg.layerTop, Fg.layerTopBay, Fg.layerTopEast, Fg.layerSoft);
  const L2 = globals.uFogLayer2.value;
  L2.set(Fg.layerDensity, Fg.layerHaze, Fg.layerFarFull, L2.w);
  globals.uFogBillow.value.set(Fg.layerBillow, 1 / Math.max(10, Fg.layerBillowSize));
}
updateSun();

const slug = params.get('city') ?? 'sf';
const base = `./city/${slug}`;

async function boot() {
  const manifest = (await (await fetch(`${base}/city.json`)).json()) as Manifest;
  const city = new City(manifest, base);
  scene.add(city.root);
  const farP = city.loadFar();

  // ---- props: trees stream with tiles, landmarks are placed once
  const treeFields = new Map<string, TreeField>();
  const treeIndex = new Map<string, TreeInstance[]>();
  const sprouts = new RoofSprouts();
  scene.add(sprouts.object);
  city.onTile = ({ tx, tz, terrain, refs }) => {
    if (terrain && terrain.trees.length) {
      const list: TreeInstance[] = terrain.trees.map((t) => ({ x: t.x, y: t.y, z: t.z, size: t.size, kind: t.kind }));
      const tf = new TreeField(list);
      scene.add(tf.object);
      treeFields.set(`${tx},${tz}`, tf);
      treeIndex.set(`${tx},${tz}`, list);
    }
    // saved paint: regrow rooftop gardens and thin the fog again
    for (const ref of refs) {
      const lv = city.paint.level(ref.index);
      if (lv > 0.5) {
        bumpPaint(ref.cx, ref.cz, 40);
        if (lv >= 2) sprouts.set(ref.index, city.roofRect(ref), city.paint.get(ref.index).color, lv, -100);
      }
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
  for (const lm of manifest.landmarks) {
    const pts = (lm as { points?: Array<[number, number]> }).points;
    if (lm.kind === 'ggb' && pts) {
      scene.add(makeGoldenGate(pts));
      city.addObstacles(bridgeObstacles('ggb', pts));
    } else if (lm.kind === 'baybridge' && pts) {
      scene.add(makeBayBridgeWest(pts));
      city.addObstacles(bridgeObstacles('baybridge', pts));
    } else {
      // Sutro's legs / the pyramid: solid posts the flight model steers around
      city.addObstacles([{ x: lm.x, z: lm.z, r: lm.kind === 'sutro' ? 45 : 30, top: lm.y + lm.height + 5, under: -Infinity }]);
      const obj = lm.kind === 'sutro' ? makeSutroTower() : lm.kind === 'transamerica' ? makeTransamerica() : null;
      if (!obj) continue;
      obj.position.set(lm.x, lm.y, lm.z);
      scene.add(obj);
    }
  }

  // ---- the hero
  const bus = new BusModel();
  scene.add(bus.root);
  const flight = new Flight();
  flight.x = manifest.start.x;
  flight.z = manifest.start.z;
  flight.heading = manifest.start.heading;
  if (params.has('lat') && params.has('lon')) {
    const [lat0, lon0] = manifest.origin;
    flight.x = (Number(params.get('lon')) - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
    flight.z = -(Number(params.get('lat')) - lat0) * 110574;
  }
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

  // drop shadow straight below the bus: the aim reticle
  const shadowGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const shadowMat = makeDropShadowMaterial();
  shadowMat.depthWrite = false;
  shadowMat.polygonOffset = true;
  shadowMat.polygonOffsetFactor = -2;
  shadowMat.polygonOffsetUnits = -4;
  const dropShadow = new THREE.Mesh(shadowGeo, shadowMat);
  dropShadow.renderOrder = 2;
  scene.add(dropShadow);

  const particles = new Particles();
  scene.add(particles.object);
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
  /** this breath's flight time while Splatter schedules it (null = the classic config.splat.impactDelay) */
  let breathTravel: number | null = null;
  const splatter = new Splatter(city, {
    geyser: (targets, hues) => particles.geyser({ source: mouthWorld, sourceVel: busVel, targets, duration: config.splat.duration, travelTime: breathTravel ?? config.splat.impactDelay, hues }),
    impact: (pos, hue, strength) => {
      particles.splash(pos, hue, strength * 1.5);
      audio.splatImpact(strength);
    },
    bloom: (ref, order, total, hue, level, roof) => {
      const h = ref.roofY - ref.baseY;
      particles.sparkles(roof, Math.sqrt(ref.area) * 0.6 + 2, h, [hue, (hue + 1) % 6, (hue + 5) % 6], 18 + level * 8);
      audio.bloomNote(order, total, hue, level);
      if (level >= 2) sprouts.set(ref.index, city.roofRect(ref), hue, level, globals.uTime.value);
      // trees beside a painted house bloom too
      const reach = Math.sqrt(ref.area) * 0.5 + 9;
      for (const [k, list] of treeIndex) {
        const tf = treeFields.get(k);
        if (!tf) continue;
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          if (Math.abs(t.x - ref.cx) < reach && Math.abs(t.z - ref.cz) < reach) tf.setPaint(i, hue, level, globals.uTime.value + 0.1);
        }
      }
    },
    primary: (ref, hue) => showSign(ref, hue),
    hitStop: (frames) => (hitStop = frames / 60),
    miss: (pos) => particles.splash(pos, 0, 0.6),
  });
  splatter.onPainted = (ref) => bumpPaint(ref.cx, ref.cz, 40);

  function showSign(ref: BuildingRef, hue: number) {
    const f = city.frontOf(ref);
    const gx = f.x + f.nx * 4.5, gz = f.z + f.nz * 4.5;
    signs.show({ text: city.neighborhoodName(ref.hood).toUpperCase(), position: new THREE.Vector3(gx, city.groundAt(gx, gz), gz), facing: Math.atan2(f.nx, f.nz), hue });
    audio.signPop();
  }

  // Dragon breath aim: a forward-down ray from the bus (config.splat.aimDown) cast
  // against rooftops and terrain, so from altitude the breath lands mid-screen
  // where the player is looking. Near the rooftops the ray lands under the bus's
  // nose, and the classic range ahead wins (exactly the old aim).
  const aim = { x: 0, y: 0, z: 0, dist: 0, travel: 0, drop: 0 };
  const F_CLEAR = 12; // the classic shot drops about this far onto the roofs (m)
  const aimPoint = (): [number, number] => {
    const S = config.splat;
    const r0 = S.range + S.rangePerSpeed * flight.speed;
    const a = THREE.MathUtils.degToRad(clamp(S.aimDown, 2, 80));
    const ca = Math.cos(a), sa = Math.sin(a);
    const x0 = flight.x, y0 = flight.y, z0 = flight.z, fx = flight.fx, fz = flight.fz;
    // (roofs, trees and ground only: a landmark's collision post or a bridge deck isn't what the breath lands on)
    const below = (t: number) => y0 - t * sa <= city.surfaceAt(x0 + fx * t * ca, z0 + fz * t * ca);
    const maxT = Math.max(r0, S.maxRange) / ca;
    let t = 0, prev = 0, hit = -1;
    while (t < maxT) {
      t = Math.min(maxT, t + Math.max(3, t * 0.02));
      if (below(t)) {
        hit = t;
        break;
      }
      prev = t;
    }
    if (hit > 0)
      for (let i = 0; i < 6; i++) {
        const m = (prev + hit) * 0.5;
        if (below(m)) hit = m;
        else prev = m;
      }
    const horiz = Math.max(r0, hit > 0 ? hit * ca : S.maxRange);
    aim.x = x0 + fx * horiz;
    aim.z = z0 + fz * horiz;
    aim.y = city.surfaceAt(aim.x, aim.z);
    aim.dist = Math.hypot(horiz, y0 - aim.y);
    // the classic short shot lands after impactDelay; past it the projectile flies on at a
    // constant speed, so a long shot from altitude takes longer and matches the visible jet
    aim.travel = S.impactDelay + Math.max(0, aim.dist - Math.hypot(r0, F_CLEAR)) / Math.max(20, S.projectileSpeed);
    aim.drop = Math.max(0, y0 - aim.y);
    return [aim.x, aim.z];
  };
  /** Barf along the aim with the impact (and the visible jet) timed to the projectile's flight. */
  const breathe = (ax: number, az: number) => {
    breathTravel = aim.travel;
    try {
      splatter.barf(ax, az, { drop: aim.drop, travel: aim.travel });
    } finally {
      breathTravel = null;
    }
  };

  /** QA: the last breath (aim point, flight time, drop, the building it should bloom). */
  let lastShot: unknown = null;

  // ---- input
  const input = new Input(canvas);
  const tuner = new Tuner();
  const perf = new Perf(renderer);
  perf.setVisible(params.has('fps'));
  tuner.onAction = (name) => {
    if (name === 'close') audio.setVolumes(config.audio);
  };
  tuner.onResetPaint = () => {
    city.paint.resetAll();
    location.reload();
  };
  if (params.has('tune')) tuner.toggle();
  input.onTripleFinger = () => tuner.toggle();
  input.onFirstGesture = () => audio.unlock();
  input.onTap = () => {
    if (tuner.visible) return;
    if (flight.tryBarf()) {
      audio.heave();
      // dragon breath: the projectile flies ahead and explodes on the buildings in front
      const [ax, az] = aimPoint();
      const tgt = splatter.pick(ax, az);
      lastShot = { t: simTime, aim: [aim.x, aim.y, aim.z], travel: aim.travel, drop: aim.drop, busY: flight.y, target: tgt ? { index: tgt.index, cx: tgt.cx, cz: tgt.cz, roofY: tgt.roofY } : null };
      breathe(ax, az);
    } else audio.denied();
  };

  // ---- resize
  const onResize = () => {
    pipeline.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    particles.setViewportHeight(pipeline.info.height);
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  onResize();

  await farP;
  globals.uFogBank.value = config.fog.openingBank;
  rig.openingPull = 140;

  // ---- the loop
  let last = performance.now();
  let simTime = 0;
  let wasFull = true;
  let opening = params.has('skipintro') ? config.fog.openingDuration : 0;
  const pose: BusPose = { squash: 1, eye: 1, fullness: 1, mouth: 0, speed: 0, wheeze: 0, heave: 0 };
  let squashV = 0;
  let lodTimer = 0;
  let aimTimer = 0;
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
  // the first ready frame adopts streamed tiles at once (as the classic streaming did); then budgeted
  let everReady = false;

  function frame(now: number) {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
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
      opening = loaded ? opening + dt : Math.min(opening + dt, config.fog.openingDuration * 0.15);
      const k = clamp(opening / config.fog.openingDuration, 0, 1);
      globals.uFogBank.value = 1 + (config.fog.openingBank - 1) * Math.pow(1 - k, 2);
      rig.openingPull = 140 * Math.pow(1 - k, 2);
    } else {
      globals.uFogBank.value = 1;
      rig.openingPull = 0;
    }

    // input -> flight (substeps keep springs stable on slow frames)
    input.update(dt);
    const st = input.state;
    const qa = (window as unknown as { __qa?: { sx: number; sy: number } | null }).__qa;
    let sx = qa ? qa.sx : st.stretch.x;
    let sy = qa ? qa.sy : st.stretch.y;
    // the opening: near the Golden Gate the yoke can't climb until the bus (and the low camera
    // trailing 150 m behind it) is clear of the bridge, so the bus always threads under the deck
    // and the camera never rises through the cables
    const gateAlong = openingBridge ? (flight.x - openingBridge[0]) * flight.fx + (flight.z - openingBridge[1]) * flight.fz : 0;
    const gateDist = openingBridge ? Math.hypot(flight.x - openingBridge[0], flight.z - openingBridge[1]) : Infinity;
    if (openingBridge && gateDist < 320 && gateAlong < config.camera.openingClimbAfter) sy = Math.max(0, sy);
    const dragging = qa ? true : st.dragging;
    // past the edge of the map the bus homes back toward the city, gently
    const ex = Math.max(minX - flight.x, flight.x - maxX, 0), ez = Math.max(minZ - flight.z, flight.z - maxZ, 0);
    if (ex + ez > 300 && !openingBridge) {
      const home = Math.atan2((minX + maxX) / 2 - flight.x, -((minZ + maxZ) / 2 - flight.z));
      let dh = home - flight.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      sx = clamp(sx + clamp(dh, -1, 1) * clamp((ex + ez - 300) / 600, 0, 1), -1, 1);
    }
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < steps; i++) flight.step(dt / steps, { sx, sy, dragging: dragging || sx !== st.stretch.x }, city);
    if (!wasFull && flight.fullness >= 1) audio.ready();
    wasFull = flight.fullness >= 1;

    // bus pose: squash on the tap frame, heave while barfing, wheeze when full
    const barfing = flight.barfing;
    const sqTarget = barfing ? (flight.barfT < 0.12 ? 0.78 : 1.06) : 1;
    squashV += ((sqTarget - pose.squash) * 260 - squashV * 16) * dt;
    pose.squash += squashV * dt;
    pose.heave = barfing ? Math.max(0, 1 - flight.barfT / config.splat.duration) : 0;
    pose.mouth = 0; // the breath comes out of the bus's face, not the side door
    pose.fullness = flight.fullness;
    pose.speed = flight.speed;
    // (and when it strains against the ceiling: the struggle bus)
    pose.wheeze = flight.barfT >= 0 ? 0 : Math.max(flight.fullness * 0.8, flight.strain);
    pose.eye = barfing ? 0.25 : flight.relief > 0 ? 1 : 0.55 + 0.45 * (1 - flight.fullness * 0.6);
    bus.update(dt, simTime, pose);
    eul.set(flight.pitch, -flight.heading, -flight.bank, 'YXZ');
    q.setFromEuler(eul);
    bus.root.quaternion.copy(q);
    bus.root.position.set(flight.x, flight.y, flight.z);

    // drop shadow on whatever is below (roof or street)
    const top = city.obstacleAt(flight.x, flight.z);
    const below = Math.max(flight.groundUnder, top - 3.0);
    dropShadow.position.set(flight.x, below + 0.25, flight.z);
    const sz = 5.6 * (flight.fullness >= 1 ? 1.1 : 0.9) * rig.heroScale;
    shadowMat.uniforms.uReady.value = flight.fullness >= 1 ? 1 : 0;
    dropShadow.scale.set(sz * 0.5, 1, sz);
    dropShadow.rotation.y = -flight.heading;

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
    // aim glint on the building in the line of fire, only while a breath is loaded
    aimTimer -= dt;
    if (aimTimer <= 0) {
      aimTimer = 0.1;
      const [ax, az] = aimPoint();
      const tgt = flight.fullness >= 1 && !flight.barfing ? splatter.pick(ax, az) : null;
      paintUniforms.uTarget.value = tgt ? tgt.index : -1;
    }
    rig.update(camera, focus, flight, dt);
    pipeline.focus.copy(focus);
    globals.uGroundRef.value = flight.groundUnder - 30;

    // ---- altitude: the vista lens, the hero's scale, the marine layer seen from above,
    // streaming ahead under the view, a wider (softer) shadow window
    const vista = rig.vista;
    pipeline.setHfov(rig.hfov);
    bus.root.scale.setScalar(rig.heroScale);
    const Fg = config.fog;
    const camY = camera.position.y;
    // (gated by the vista, i.e. by the height above the ground: skimming the floor over Twin Peaks the
    // camera is 380 m above the sea but the fog must stay exactly the street-level Hopper fog)
    const layerMix = clamp((camY - Fg.layerTop - Fg.layerViewStart) / Math.max(1, Fg.layerViewFull - Fg.layerViewStart), 0, 1) * clamp(vista / 0.3, 0, 1);
    globals.uFogLayer2.value.w = layerMix * layerMix * (3 - 2 * layerMix);
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    if (camFwd.lengthSq() < 1e-6) camFwd.set(flight.fx, 0, flight.fz);
    camFwd.normalize();
    const hk = clamp(flight.lift / 450, 0, 1);
    streamCenter.set(focus.x + camFwd.x * 950 * hk, focus.y, focus.z + camFwd.z * 950 * hk);
    city.viewHeight = flight.lift;
    city.detailScale = Math.tan(THREE.MathUtils.degToRad(config.camera.hfovPortrait / 2)) / Math.tan(THREE.MathUtils.degToRad(rig.hfov / 2));
    const R = config.render;
    const sAhead = 700 * vista;
    const sx0 = focus.x + camFwd.x * sAhead, sz0 = focus.z + camFwd.z * sAhead;
    pipeline.shadowFocusOn = true;
    pipeline.shadowFocus.set(sx0, focus.y + (city.groundAt(sx0, sz0) - focus.y) * vista, sz0);
    pipeline.shadowScale = 1 + (R.shadowExtentVista / Math.max(1, R.shadowExtent) - 1) * vista;
    pipeline.shadowStrength = 1 + (R.shadowStrengthVista - 1) * vista;
    pipeline.shadowEdge = 0.08 + (R.shadowEdgeVista - 0.08) * vista;
    pipeline.calm = clamp(vista / Math.max(0.01, config.render.calmVista), 0, 1);

    city.update(streamCenter, renderer, dt);
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
    splatter.update(dt, simTime);
    // the struggle: a wheezy exhaust sputter, more of it when the belly is full
    puffTimer -= dt;
    if (puffTimer <= 0 && dt > 0) {
      puffTimer = (0.35 + 0.9 * (1 - flight.fullness) + Math.random() * 0.25) * (1 - 0.7 * flight.strain);
      bus.root.localToWorld(puffPos.copy(bus.exhaustLocal));
      puffVel.set(-flight.fx * 4 + (Math.random() - 0.5) * 2, 1.2 + Math.random(), -flight.fz * 4 + (Math.random() - 0.5) * 2);
      particles.puff(puffPos, puffVel);
    }
    particles.update(dt);
    signs.update(dt, camera);

    // painted neighborhoods hum
    const near = city.buildingsNear(flight.x, flight.z, 90, nearTmp);
    let painted = 0;
    for (const n of near) if (city.paint.level(n.ref.index) > 0.5) painted++;
    audio.update(dt, {
      speed: flight.speed,
      surge: flight.surge,
      fullness: flight.fullness,
      altitude: flight.y - flight.groundUnder,
      paintNearby: near.length ? painted / near.length : 0,
      fogBank: clamp((globals.uFogBank.value - 1) / Math.max(0.001, config.fog.openingBank - 1), 0, 1),
      high: clamp(flight.lift / 420, 0, 1),
      fogBelow: globals.uFogLayer2.value.w,
      strain: flight.strain,
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
      const tC = clamp((camY - flight.groundBroad) / Math.max(0.06, -camDir.y), 50, 5000);
      snapPoint.copy(camera.position).addScaledVector(camDir, tC);
      pipeline.focus.lerp(snapPoint, vista);
    }
    pipeline.steadySnap = vista > 0;
    pipeline.snap();
    if (vista > 0) {
      bus.root.position.add(pipeline.snapCompensation(bus.root.position, compTmp));
      dropShadow.position.add(pipeline.snapCompensation(dropShadow.position, compTmp));
      pipeline.snapCompensation(bus.root.position, particles.object.position);
    } else particles.object.position.set(0, 0, 0);
    pipeline.render(scene);
    perf.frame(dt * 1000, performance.now() - t0);
    const ready = city.loadedRegionCount() > 0 && !city.busy && (opening >= config.fog.openingDuration || params.has('openingshot'));
    if (ready) everReady = true;
    city.eager = !everReady;
    (window as unknown as { __shotReady?: boolean }).__shotReady = ready;
  }
  requestAnimationFrame(frame);

  // debug hooks for scripted screenshots / QA
  (window as unknown as Record<string, unknown>).__game = {
    flight, city, splatter, input, audio, rig, camera, tuner, perf, pipeline, scene, config, HUE_RAMPS,
    /** QA: where a breath fired now would land ({x, y, z, dist, travel, drop}), and the last one fired */
    aimNow: () => (aimPoint(), { ...aim }),
    lastShot: () => lastShot,
    tapSplat: () => input.onTap?.(),
    forceReady: () => (flight.fullness = 1),
    /** QA: barf at a lat/lon through the real splat pipeline (cascade, bloom, sign, sound) */
    barfAtLatLon: (lat: number, lon: number) => {
      const [lat0, lon0] = manifest.origin;
      const x = (lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
      const z = -(lat - lat0) * 110574;
      audio.heave();
      splatter.barf(x, z);
    },
    clock: () => simTime,
  };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 0 0 0;color:#fff;font:12px monospace;padding:12px;background:#0008">${String(e)}</pre>`);
});
