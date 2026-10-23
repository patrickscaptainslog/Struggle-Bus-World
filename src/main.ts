import * as THREE from 'three';
import { config } from './config';
import { PixelPipeline } from './render/PixelPipeline';
import { globals, GLSL_COMMON, GLSL_OUT } from './render/materials';
import { Ramp, HUE_RAMPS } from './render/palette';
import { City, type BuildingRef } from './world/City';
import { paintUniforms } from './world/buildingMaterial';
import type { CityManifest } from './world/tiles';
import { Flight } from './game/Flight';
import { CameraRig } from './game/CameraRig';
import { Splatter, type Blast } from './game/Splat';
import { arrival, blobFlight } from './game/blastLayout';
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
  // trees standing in saved ground paint come back painted once their tile's paint is redrawn
  city.ground.onTileReady = (tx, tz) => {
    const k = `${tx},${tz}`;
    const tf = treeFields.get(k);
    const list = treeIndex.get(k);
    if (!tf || !list) return;
    for (let i = 0; i < list.length; i++) {
      const g = city.ground.sample(list[i].x, list[i].z);
      if (g && g.cov >= 0.5 && tf.paintLevel(i) === 0) tf.setPaint(i, g.hue, 1, -100);
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

  // the blast needs headroom: geyser + crown splash + flung blobs + a sparkle crown per bloom
  const particles = new Particles(8000);
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

  // ---- splat orchestration
  let hitStop = 0;
  const mouthTmp = new THREE.Vector3();
  const velTmp = new THREE.Vector3();
  // the projectile leaves from the front of the bus (its one-eyed face), not the side door
  const frontLocal = new THREE.Vector3(0, 0.4, -bus.length * 0.5 - 0.6);
  const mouthWorld = () => bus.root.localToWorld(mouthTmp.copy(frontLocal));
  const busVel = () => velTmp.set(flight.fx * flight.speed, flight.vy, flight.fz * flight.speed);
  const flingFrom = new THREE.Vector3();
  const flingTo = new THREE.Vector3();
  const flashPos = new THREE.Vector3();
  /** Where a flung blob comes down: the roof it hits, else the ground. */
  const landingY = (x: number, z: number) => city.roofAt(x, z) ?? city.groundAt(x, z);
  /** Trees standing in the blast's fresh ground paint bloom (or escalate) as the shockwave reaches them. */
  const paintTrees = (b: Blast) => {
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
          if (d > reach) continue;
          const g = city.ground.sample(t.x, t.z);
          if (!g || g.cov < 0.5) continue;
          tf.setPaint(i, g.hue, Math.min(3, tf.paintLevel(i) + 1), b.t + arrival(d, r));
        }
      }
  };
  const splatter = new Splatter(city, {
    geyser: (targets, hues) => particles.geyser({ source: mouthWorld, sourceVel: busVel, targets, duration: config.splat.duration, travelTime: config.splat.impactDelay, hues }),
    impact: (b) => {
      const S = config.splat;
      const k = b.strength;
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
      audio.splatImpact(k);
      audio.bloomBurst(b.count, b.spec.hue, b.maxLevel);
      // one white-hot frame centered on the blast, a kick, and the fog thins over it
      flashPos.copy(b.pos).project(camera);
      pipeline.flash(flashPos.x * 0.5 + 0.5, flashPos.y * 0.5 + 0.5, S.flashFrames, S.flashStrength);
      rig.kick(S.kick * Math.sqrt(k));
      bumpPaint(b.spec.x, b.spec.z, Math.min(255, 30 + 5 * b.count));
    },
    bloom: (ref, _order, _total, hue, level, roof) => {
      const h = ref.roofY - ref.baseY;
      particles.sparkles(roof, Math.sqrt(ref.area) * 0.6 + 2, h, [hue, (hue + 1) % 6, (hue + 5) % 6], 14 + level * 8);
      if (level >= 2) sprouts.set(ref.index, city.roofRect(ref), hue, level, globals.uTime.value);
    },
    primary: (ref, hue) => showSign(ref, hue),
    hitStop: (frames) => (hitStop = frames / 60),
  });

  function showSign(ref: BuildingRef, hue: number) {
    const f = city.frontOf(ref);
    const gx = f.x + f.nx * 4.5, gz = f.z + f.nz * 4.5;
    signs.show({ text: city.neighborhoodName(ref.hood).toUpperCase(), position: new THREE.Vector3(gx, city.groundAt(gx, gz), gz), facing: Math.atan2(f.nx, f.nz), hue });
    audio.signPop();
  }

  const aimPoint = (): [number, number] => {
    const r = config.splat.range + config.splat.rangePerSpeed * flight.speed;
    return [flight.x + flight.fx * r, flight.z + flight.fz * r];
  };

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
    city.ground.resetAll();
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
      splatter.barf(ax, az);
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
  // QA: ?fixeddt=<s> steps the game by exactly that much per rendered frame (deterministic captures)
  const fixedDt = params.has('fixeddt') ? Math.max(0.001, Number(params.get('fixeddt')) || 1 / 60) : 0;
  let lodTimer = 0;
  let aimTimer = 0;
  let puffTimer = 0;
  const puffPos = new THREE.Vector3();
  const puffVel = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const sparkPos = new THREE.Vector3();
  const nearTmp: Array<{ ref: BuildingRef; d: number }> = [];

  type QA = { sx?: number; sy?: number; holdAt?: number; held?: boolean; topDown?: { lat: number; lon: number; height: number } | null };
  function frame(now: number) {
    requestAnimationFrame(frame);
    const qa = (window as unknown as { __qa?: QA | null }).__qa;
    // QA: freeze on the first frame at/after holdAt (the canvas keeps showing it)
    if (qa && qa.holdAt !== undefined && simTime >= qa.holdAt) {
      qa.held = true;
      last = now;
      return;
    }
    const t0 = performance.now();
    let dt = fixedDt || Math.min(0.05, (now - last) / 1000);
    const realDt = dt;
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
    const qaStick = qa && typeof qa.sx === 'number' && typeof qa.sy === 'number';
    let sx = qaStick ? qa.sx! : st.stretch.x;
    const sy = qaStick ? qa.sy! : st.stretch.y;
    const dragging = qaStick ? true : st.dragging;
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
    pose.wheeze = flight.barfT >= 0 ? 0 : flight.fullness * 0.8;
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
    const sz = 5.6 * (flight.fullness >= 1 ? 1.1 : 0.9);
    shadowMat.uniforms.uReady.value = flight.fullness >= 1 ? 1 : 0;
    dropShadow.scale.set(sz * 0.5, 1, sz);
    dropShadow.rotation.y = -flight.heading;

    if (openingBridge) {
      // stay low and level until we're well past the bridge, then rise into the normal chase view
      const along = (flight.x - openingBridge[0]) * flight.fx + (flight.z - openingBridge[1]) * flight.fz;
      const want = along < 180 && !dragging ? 1 : 0;
      rig.openingLow += (want - rig.openingLow) * (1 - Math.exp(-(want ? 4 : 0.7) * dt));
      if (rig.openingLow < 0.01 && want === 0) {
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
    rig.applyKick(camera, realDt);
    pipeline.focus.copy(focus);
    if (qa?.topDown) {
      // QA: look straight down on a lat/lon (hue layout from above)
      const [lat0, lon0] = manifest.origin;
      const tx = (qa.topDown.lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
      const tz = -(qa.topDown.lat - lat0) * 110574;
      const gy = city.groundAt(tx, tz);
      camera.position.set(tx, gy + qa.topDown.height, tz + 0.01);
      camera.up.set(0, 0, -1);
      camera.lookAt(tx, gy, tz);
      pipeline.focus.set(tx, gy, tz);
    }
    globals.uGroundRef.value = flight.groundUnder - 30;

    city.update(focus, renderer, dt);
    // tree LOD by tile distance (fog eats far groves anyway)
    lodTimer -= dt;
    if (lodTimer <= 0) {
      lodTimer = 0.25;
      const ts = manifest.tileSize;
      for (const [k, tf] of treeFields) {
        const c = k.indexOf(',');
        const tx = Number(k.slice(0, c)), tz = Number(k.slice(c + 1));
        const d = Math.hypot((tx + 0.5) * ts - camera.position.x, (tz + 0.5) * ts - camera.position.z);
        tf.setLod(d < 350 ? 0 : d < 900 ? 1 : 2);
      }
    }
    splatter.update(dt);
    // the struggle: a wheezy exhaust sputter, more of it when the belly is full
    puffTimer -= dt;
    if (puffTimer <= 0 && dt > 0) {
      puffTimer = 0.35 + 0.9 * (1 - flight.fullness) + Math.random() * 0.25;
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

    pipeline.render(scene);
    perf.frame(dt * 1000, performance.now() - t0);
    (window as unknown as { __shotReady?: boolean }).__shotReady = city.loadedRegionCount() > 0 && !city.busy && (opening >= config.fog.openingDuration || params.has('openingshot'));
  }
  requestAnimationFrame(frame);

  // debug hooks for scripted screenshots / QA
  (window as unknown as Record<string, unknown>).__game = {
    flight, city, splatter, input, audio, rig, camera, tuner, perf, HUE_RAMPS,
    tapSplat: () => input.onTap?.(),
    forceReady: () => (flight.fullness = 1),
    /** QA: barf at a lat/lon through the real splat pipeline (blast, blooms, sign, sound). Returns the impact time (game clock). */
    barfAtLatLon: (lat: number, lon: number, drop?: number) => {
      const [lat0, lon0] = manifest.origin;
      const x = (lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
      const z = -(lat - lat0) * 110574;
      audio.heave();
      return splatter.barf(x, z, { drop });
    },
    clock: () => simTime,
    /** QA: buildings painted / total within r of a lat/lon, and the share of ground painted there */
    paintedNear: (lat: number, lon: number, r: number) => {
      const [lat0, lon0] = manifest.origin;
      const x = (lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
      const z = -(lat - lat0) * 110574;
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
      return { buildings: near.length, painted, groundShare: cells ? ground / cells : 0, paintedTrees: trees, savedBlasts: city.ground.blastCount };
    },
  };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 0 0 0;color:#fff;font:12px monospace;padding:12px;background:#0008">${String(e)}</pre>`);
});
