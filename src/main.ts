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
import { Splatter, type Blast } from './game/Splat';
import { Aimer, type Shot } from './game/Aim';
import { latLonToLocal } from './game/geo';
import { arrival, blastRadiusFor, blobFlight, makeBlastSpec } from './game/blastLayout';
import { Input } from './game/Input';
import { BusModel, type BusPose } from './bus/BusModel';
import { Particles } from './fx/Particles';
import { StreetSigns, signTune } from './fx/StreetSign';
import { AudioEngine } from './audio/AudioEngine';
import { TreeField, RoofSprouts, makeSutroTower, makeTransamerica, type TreeInstance } from './world/Props';
import { Tuner, applySavedTuning } from './ui/Tuner';
import { makeGoldenGate, makeBayBridgeWest, bridgeObstacles } from './world/Bridges';
import { Perf } from './ui/Perf';
import { clamp } from './game/springs';

// Struggle Bus — Phase 1 (real SF, solo).

/** Pixel-art drop shadow: one solid cool-grey oval about the bus's own size (no stippled halo: a checker
 *  anchored to the screen crawled as the shadow slid over the roofs, and the near-black blob was the
 *  darkest, loudest shape in every frame). */
function makeDropShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...globals, uReady: { value: 0 }, uFar: { value: 0 } },
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
      uniform float uFar;
      in vec2 vLocal;
      in vec3 vWorldPos;
      ${GLSL_OUT}
      void main() {
        float r = length(vLocal);
        if (r > 0.85) discard;
        float fog = sbFog(vWorldPos);
        // (a breath loaded: a step deeper; far above the surface it pales, as a real shadow softens)
        sbWrite(${Ramp.GREY}.0, 0.36 - 0.12 * uReady + 0.16 * uFar, fog, 0.0, vec3(0.0, 0.0, 1.0), 0.97, 0.5);
      }
    `,
  });
}

type Manifest = CityManifest & { regions: Array<[number, number, number]>; regionSize: number };

const params = new URLSearchParams(location.search);
if (params.has('fog')) config.fog.enabled = true;
if (params.has('px')) config.render.pixelWidth = Math.min(1200, Math.max(120, Number(params.get('px')) || config.render.pixelWidth));
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
  globals.uFogStand.value.set(fogOn ? Fg.standFog : 1, Fg.standFrom, Math.max(Fg.standFrom + 1, Fg.standTo), Fg.standFade);
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
  /** buildings whose paint already thinned the fog this session (a tile streaming back in mustn't bump it again) */
  const fogBumped = new Set<number>();
  /** Rooftop garden / Hundertwasser crown on a building: drawn, and the flight's obstacle field rises over it. */
  const growSprouts = (ref: BuildingRef, hue: number, level: number, start: number) => {
    const rect = city.roofRect(ref);
    const top = sprouts.set(ref.index, rect, hue, level, start);
    if (top > 0) city.raiseRoof(rect, rect.y + top);
  };
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

  // drop shadow straight below the bus: grounds the hero (how high it flies)
  const shadowGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const shadowMat = makeDropShadowMaterial();
  shadowMat.depthWrite = false;
  shadowMat.polygonOffset = true;
  shadowMat.polygonOffsetFactor = -2;
  shadowMat.polygonOffsetUnits = -4;
  const dropShadow = new THREE.Mesh(shadowGeo, shadowMat);
  dropShadow.renderOrder = 2;
  scene.add(dropShadow);
  // the headlight beam (the eye): lit in the resolve pass from the lens forward (see PixelPipeline.setHeroBeam)
  const beamEye = new THREE.Vector3();
  const beamTip = new THREE.Vector3();
  const beamFwd = new THREE.Vector3();

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
  let jet: { at: number; impact: number; end: number; targets: THREE.Vector3[]; hues: number[] } | null = null;
  let simTime = 0;
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
  /** the blast being shown (impact fires right before its primary's bloom, in the same update) */
  const lastBlast = { x: 0, z: 0, r: config.splat.blastRadius };
  const splatter = new Splatter(city, {
    geyser: (targets, hues) => {
      const S = config.splat;
      const fly = breathTravel ?? Math.max(0.05, S.impactDelay - S.inhale);
      jet = { at: simTime + S.inhale, impact: simTime + S.inhale + fly, end: simTime + S.duration, targets, hues };
    },
    miss: (pos, hue) => particles.splash(pos, hue, 0.6),
    impact: (b) => {
      const S = config.splat;
      const k = b.strength;
      lastBlast.x = b.spec.x;
      lastBlast.z = b.spec.z;
      lastBlast.r = b.spec.r;
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
      fogBumped.add(ref.stableId);
      if (level >= 2) growSprouts(ref, hue, level, globals.uTime.value);
    },
    // the street sign waits until the shockwave has bloomed the whole blast (game clock: hit-stop holds it)
    primary: (ref, hue) => {
      const r = lastBlast.r;
      pendingSigns.push({ ref, hue, cx: lastBlast.x, cz: lastBlast.z, r, at: simTime + arrival(r, r) + signTune.showDelay });
    },
    hitStop: (frames) => (hitStop = frames / 60),
  });

  // ---- the street sign stands beside the blast, never over it: the impact and the bloom are the money
  // shot. It rises once the wave has reached the edge, on open ground past the blast's far side as the
  // camera sees it, off the flight line (that's where the next target glints), and grows so its letters
  // keep a game pixel at that distance. A re-splat of the same block flips the same sign.
  const pendingSigns: Array<{ ref: BuildingRef; hue: number; cx: number; cz: number; r: number; at: number }> = [];
  let signSpot: { x: number; y: number; z: number; facing: number; scale: number; bias: boolean; cx: number; cz: number; r: number; text: string; until: number } | null = null;
  const signPos = new THREE.Vector3();
  const signNdc = new THREE.Vector3();
  const signFwd = new THREE.Vector3();
  const SIGN_RING: ReadonlyArray<readonly [number, number]> = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [12, 0], [-12, 0], [0, 12], [0, -12], [9, 9], [-9, 9], [9, -9], [-9, -9]];
  function showSign(ref: BuildingRef, hue: number, cx: number, cz: number, r: number) {
    const T = signTune;
    const text = city.neighborhoodName(ref.hood).toUpperCase();
    const life = T.riseTime + T.holdGreen + T.flipTime + T.holdRainbow + T.sinkTime;
    const same = signSpot && simTime < signSpot.until && signSpot.text === text && Math.hypot(cx - signSpot.cx, cz - signSpot.cz) < signSpot.r;
    if (!same) {
      camera.getWorldDirection(signFwd);
      const fl = Math.hypot(signFwd.x, signFwd.z);
      const fx = fl > 1e-3 ? signFwd.x / fl : flight.fx, fz = fl > 1e-3 ? signFwd.z / fl : flight.fz;
      const sx = -fz, sz = fx; // the view's right
      // off the flight line: away from a turn, else on the side the blast already sits
      const lat = (cx - camera.position.x) * sx + (cz - camera.position.z) * sz;
      const pref = Math.abs(flight.yawRate) > 0.05 ? -Math.sign(flight.yawRate) : lat >= 0 ? 1 : -1;
      let found: typeof signSpot = null;
      for (const k of [1, 0.75, 0.5]) {
        for (const side of [pref, -pref]) {
          const out = r + T.besideOut, sd = T.besideSide * r * side;
          const bx = cx + (fx * out + sx * sd) * k, bz = cz + (fz * out + sz * sd) * k;
          for (const [ox, oz] of SIGN_RING) {
            const x = bx + ox, z = bz + oz;
            if (city.roofAt(x, z) !== null) continue; // the pole stands on the street, a sidewalk or a lawn
            const y = city.groundAt(x, z);
            // the blade must land inside the frame, below the top band (the sky and the horizon)
            signNdc.set(x, y + T.poleHeight + 5, z).project(camera);
            if (Math.abs(signNdc.x) > 0.72 || signNdc.y > 0.7 || signNdc.y < -0.6 || signNdc.z > 1) continue;
            const dist = camera.position.distanceTo(signPos.set(x, y + T.poleHeight + 5, z));
            const scale = clamp((T.minFontPx * pipeline.pixelWorldSize(dist)) / Math.max(0.05, T.texelW), 1, 4);
            found = { x, y, z, facing: Math.atan2(-fx, -fz), scale, bias: true, cx, cz, r, text, until: 0 };
            break;
          }
          if (found) break;
        }
        if (found) break;
      }
      if (!found) {
        // nowhere open in frame: the old spot, in front of the primary's facade (the bus may still be
        // between it and the camera there: the depth bias waits, as before)
        const f = city.frontOf(ref);
        const gx = f.x + f.nx * 4.5, gz = f.z + f.nz * 4.5;
        found = { x: gx, y: city.groundAt(gx, gz), z: gz, facing: Math.atan2(f.nx, f.nz), scale: 1, bias: false, cx, cz, r, text, until: 0 };
      }
      signSpot = found;
    }
    const sp = signSpot!;
    sp.until = simTime + life;
    signs.show({ text, position: signPos.set(sp.x, sp.y, sp.z), facing: sp.facing, hue, scale: sp.scale, biasNow: sp.bias });
    audio.signPop();
  }

  // Dragon breath aim (src/game/Aim.ts): the building that glints is the one a tap hits.
  const aimer = new Aimer(city, splatter);
  /** Breathe a shot: the blast is timed to the projectile's flight (inhale + travel), at the glinting building. */
  const breathe = (shot: Shot) => {
    breathTravel = shot.travel;
    try {
      splatter.barf(shot.x, shot.z, { drop: shot.drop, travel: config.splat.inhale + shot.travel, target: shot.target, y: shot.y, exact: shot.exact });
    } finally {
      breathTravel = null;
    }
    // a breath into open water paints nothing: part of the belly comes back
    if (splatter.lastMiss) flight.refund = config.splat.missRefund;
  };

  /** QA: the last breath (aim point, flight time, drop, the building it should bloom). */
  let lastShot: unknown = null;

  const pose: BusPose = { squash: 1, eye: 1, fullness: 1, mouth: 0, speed: 0, wheeze: 0, heave: 0 };
  let squashV = 0;

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
  // (GroundPaint saves on pagehide; a hidden page may never see one on iOS)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) city.ground.persist();
  });
  input.onTripleFinger = () => tuner.toggle();
  input.onFirstGesture = () => audio.unlock();
  input.onPress = () => aimer.press();
  input.onTap = () => {
    if (tuner.visible) return;
    // (taps fire between frames: what fire() hands over is exactly the building on screen glinting)
    const shot = aimer.fire(flight);
    if (flight.tryBarf()) {
      // anticipation: the bus squashes on this very frame, inhales, then the jet leaves
      pose.squash = 0.8;
      squashV = 0;
      audio.heave();
      const tgt = shot.target;
      const iy = shot.y ?? (tgt ? city.roofAtPart(tgt, shot.x, shot.z) + 0.5 : city.groundAt(shot.x, shot.z));
      lastShot = { t: simTime, aim: [shot.x, iy, shot.z], travel: config.splat.inhale + shot.travel, drop: shot.drop, busY: flight.y, wall: shot.exact, target: tgt ? { index: tgt.index, cx: tgt.cx, cz: tgt.cz, roofY: tgt.roofY } : null };
      breathe(shot);
      if (splatter.lastMiss) (lastShot as { miss?: boolean }).miss = true;
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
  let wasFull = true;
  let opening = params.has('skipintro') ? config.fog.openingDuration : 0;
  // QA: ?fixeddt=<s> steps the game by exactly that much per rendered frame (deterministic captures)
  const fixedDt = params.has('fixeddt') ? Math.max(0.001, Number(params.get('fixeddt')) || 1 / 60) : 0;
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
  // the first ready frame adopts streamed tiles at once (as the classic streaming did); then budgeted
  let everReady = false;

  type QA = { sx?: number; sy?: number; holdAt?: number; holdFrames?: number; held?: boolean; topDown?: { lat: number; lon: number; height: number } | null };
  function frame(now: number) {
    requestAnimationFrame(frame);
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
    let sy = qaStick ? qa.sy! : st.stretch.y;
    // the opening: the yoke can't climb until the bus (and the low camera trailing 150 m behind
    // it) is clear of the Golden Gate, so the bus always threads under the deck and the camera
    // never rises through the cables (turning away ends it: `along` is along the heading)
    const gateAlong = openingBridge ? (flight.x - openingBridge[0]) * flight.fx + (flight.z - openingBridge[1]) * flight.fz : 0;
    const gateDist = openingBridge ? Math.hypot(flight.x - openingBridge[0], flight.z - openingBridge[1]) : Infinity;
    if (openingBridge && gateAlong < config.camera.openingClimbAfter) sy = Math.max(0, sy);
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
    bus.update(dt, simTime, pose);
    eul.set(flight.pitch, -flight.heading, -flight.bank, 'YXZ');
    q.setFromEuler(eul);
    bus.root.quaternion.copy(q);
    bus.root.position.set(flight.x, flight.y, flight.z);

    // drop shadow on whatever is below: the roof of the part under the bus, else the street
    const below = city.roofAt(flight.x, flight.z) ?? flight.groundUnder;
    dropShadow.position.set(flight.x, below + 0.25, flight.z);
    // (r <= 0.85 of the disc: ~bus width x 0.6 bus length; it shrinks and pales with the gap below)
    const loaded = Aimer.loaded(flight);
    const shadowFar = clamp((flight.y - below - 14) / 36, 0, 1);
    const sz = 0.38 * bus.length * (loaded ? 1.05 : 0.95) * rig.heroScale * (1 - 0.3 * shadowFar);
    shadowMat.uniforms.uReady.value = loaded ? 1 : 0;
    shadowMat.uniforms.uFar.value = shadowFar;
    dropShadow.scale.set(sz * 0.42, 1, sz);
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
    // aim glint on the building a tap would hit (picked every frame), only while a breath is loaded
    const glint = aimer.update(flight, simTime, dragging);
    paintUniforms.uTarget.value = glint ? glint.index : -1;
    paintUniforms.uTargetT.value = aimer.shownSince;
    paintUniforms.uGlint.value.set(config.splat.glintLift, config.splat.glintSweep, config.splat.glintRate);
    paintUniforms.uFloodHead.value = config.bloom.floodHead;
    rig.update(camera, focus, flight, dt);
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
    bus.root.scale.setScalar(rig.heroScale);
    // this frame's matrix now: the breath and the exhaust leave from where the bus IS (not last frame's pose)
    bus.root.updateMatrixWorld(true);
    const Fg = config.fog;
    const camY = camera.position.y;
    // (gated by the vista, i.e. by the height above the ground: skimming the floor over Twin Peaks the
    // camera is 380 m above the sea but the fog must stay exactly the street-level Hopper fog)
    const layerMix = clamp((camY - Fg.layerTop - Fg.layerViewStart) / Math.max(1, Fg.layerViewFull - Fg.layerViewStart), 0, 1) * clamp(vista / 0.3, 0, 1);
    globals.uFogLayer2.value.w = Fg.enabled ? layerMix * layerMix * (3 - 2 * layerMix) : 0;
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    if (camFwd.lengthSq() < 1e-6) camFwd.set(flight.fx, 0, flight.fz);
    camFwd.normalize();
    const hk = clamp(flight.lift / 450, 0, 1);
    streamCenter.set(focus.x + camFwd.x * 950 * hk, focus.y, focus.z + camFwd.z * 950 * hk);
    city.viewHeight = flight.lift;
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

    // the splat before the city's paint upload: the impact frame itself already shows the hit (and the
    // hit-stop frames hold it), instead of the paint reaching the GPU a frame late
    splatter.update(dt);
    if (jet && simTime >= jet.at) {
      // the inhale is over: the jet leaves the mouth and lands exactly at the impact
      particles.geyser({ source: mouthWorld, sourceVel: busVel, targets: jet.targets, duration: Math.max(0.05, jet.end - simTime), travelTime: Math.max(0.05, jet.impact - simTime), hues: jet.hues });
      jet = null;
    }
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
      pendingSigns.splice(i, 1);
      showSign(ps.ref, ps.hue, ps.cx, ps.cz, ps.r);
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
    // the eye's beam, from the lens along the nose, a little down: wide open on relief, a sliver
    // while barfing (it squints); the bus's matrix is final here
    {
      const Cb = config.camera;
      bus.root.updateMatrixWorld();
      bus.root.localToWorld(beamEye.copy(bus.eyeLocal));
      beamFwd.set(0, -Math.tan(THREE.MathUtils.degToRad(Cb.headBeamPitch)), -1).transformDirection(bus.root.matrixWorld);
      beamTip.copy(beamEye).addScaledVector(beamFwd, Cb.headBeamLength * rig.heroScale);
      const open = 0.3 + 0.7 * pose.eye;
      pipeline.setHeroBeam(beamEye, beamTip, 0.5 * rig.heroScale, 0.5 * Cb.headBeamWidth * open * rig.heroScale, Cb.headBeamLength > 0 ? Cb.headBeamStrength * (0.35 + 0.65 * pose.eye) : 0);
    }
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
    aimNow: () => (aimer.point(flight), { ...aimer.aim }),
    /** QA: the building glinting now (what a tap hits) */
    glintNow: () => {
      const r = aimer.shown();
      return r ? { index: r.index, cx: r.cx, cz: r.cz, roofY: r.roofY, since: aimer.shownSince } : null;
    },
    aimer,
    lastShot: () => lastShot,
    /** QA: how much of the marine layer's seen-from-above fog is on (0 = the street-level fog exactly) */
    fogLayerMix: () => globals.uFogLayer2.value.w,
    tapSplat: () => input.onTap?.(),
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

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 0 0 0;color:#fff;font:12px monospace;padding:12px;background:#0008">${String(e)}</pre>`);
});
