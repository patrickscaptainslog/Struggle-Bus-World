// FX dev page: the particle system on the real pixel pipeline over the grey
// harness blocks. The bus flies in over a row of five roofs exactly like the
// game's dive-bomb (tap aims the shadow `lead` meters ahead; bus stalls while
// barfing), barfs (geyser + neighbor streams), splats (splash + hit-stop), the
// roofs bloom one by one (sparkles, block recolor), then it zips off puffing
// exhaust while painted walls twinkle.
// Query params (plus the harness's dist/elev/yaw/spin/w/fog):
//   t=<s>       freeze the loop at time t (pre-rolled at 60 fps) for screenshots
//   fx=all|geyser|splash|sparkle|puff|twinkle   which effects to run
//   hue=<0..5>  splat hue (default rotates every loop)
//   bus=0       hide the bus model
//   n=<k>       number of targets (1..5)
//   speed=<m/s> cruise speed (default config.flight.cruiseSpeed)
//   off=<m>     sideways offset of the bus from the primary's center
//   hdg=<deg>   bus heading (0 = flying -Z across the row, 90 = flying +X along it)
//   cam=chase   the game's chase camera (behind the bus, dist/elev from the params)
//   tune=k:v,…  override fxTune values
import * as THREE from 'three';
import { createHarness } from './harness';
import { Particles, fxTune } from '../src/fx/Particles';
import { BusModel, type BusPose } from '../src/bus/BusModel';
import { HUE_RAMPS, Ramp } from '../src/render/palette';
import { config } from '../src/config';

const h = createHarness();
const P = h.params;
for (const kv of (P.get('tune') ?? '').split(',')) {
  const [k, v] = kv.split(':');
  if (k && v !== undefined && k in fxTune) (fxTune as Record<string, number>)[k] = Number(v);
}
const num = (k: string, d: number) => {
  const v = P.get(k);
  return v === null || v === '' ? d : Number(v);
};
const which = P.get('fx') ?? 'all';
const on = (k: string) => which === 'all' || which.split(',').includes(k);

const fx = new Particles();
h.scene.add(fx.object);

// ---- the harness blocks (same layout as dev/harness.ts) so we can aim at roofs
interface Block {
  i: number;
  j: number;
  x: number;
  z: number;
  h: number;
  mesh: THREE.Mesh | null;
}
const blocks: Block[] = [];
for (let i = -3; i <= 3; i++)
  for (let j = -3; j <= 3; j++) {
    if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue;
    blocks.push({ i, j, x: i * 9, z: j * 26, h: 8 + ((i * 7 + j * 13 + 40) % 9) * 1.6, mesh: null });
  }
h.scene.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !m.geometry.getAttribute('ramp')) return;
  const b = blocks.find((q) => Math.abs(q.x - m.position.x) < 0.1 && Math.abs(q.z - m.position.z) < 0.1);
  if (b) b.mesh = m;
});
const blockAt = (i: number, j: number) => blocks.find((b) => b.i === i && b.j === j)!;
function paintBlock(b: Block, ramp: number) {
  if (!b.mesh) return;
  const a = b.mesh.geometry.getAttribute('ramp') as THREE.BufferAttribute;
  (a.array as Float32Array).fill(ramp);
  a.needsUpdate = true;
}

// the row along +X at j = -2: primary in the middle, neighbors in the Splatter's order
// (the bus flies -Z, so +X is its right: right side gets hue+1, +2, left side -1, -2)
const J = -2;
const nT = Math.max(1, Math.min(5, num('n', 5)));
const order = [blockAt(1, J), blockAt(2, J), blockAt(0, J), blockAt(3, J), blockAt(-1, J)].slice(0, nT);
const primary = order[0];
// same as Splatter: targets at roofY + 0.3, impact at roofY + 0.5, sparkles at roofY
const roofs = order.map((b) => new THREE.Vector3(b.x, b.h + 0.3, b.z));
const impactPos = new THREE.Vector3(primary.x, primary.h + 0.5, primary.z);
const sparkPos = order.map((b) => new THREE.Vector3(b.x, b.h, b.z));
h.target.set(primary.x, primary.h + 4, primary.z);
const chase = P.get('cam') === 'chase';

// ---- the bus
const showBus = P.get('bus') !== '0';
const bus = new BusModel();
if (showBus) h.scene.add(bus.root);
const pose: BusPose = { squash: 1, eye: 0.8, fullness: 1, mouth: 0, speed: 10, wheeze: 0.6, heave: 0 };
const mouth = new THREE.Vector3();
const vel = new THREE.Vector3();
const exhaust = new THREE.Vector3();
const exhaustVel = new THREE.Vector3();
const twinklePos = new THREE.Vector3();
// like main.ts: reused objects, read through closures every frame
const mouthWorld = () => {
  bus.root.updateMatrixWorld();
  return bus.root.localToWorld(mouth.copy(bus.mouthLocal));
};
const busVel = () => vel;

// ---- the loop
const LOOP = 4.2;
const TAP = 0.35;
const S = config.splat;
const cruise = num('speed', config.flight.cruiseSpeed);
const off = num('off', 0);
const hdg = THREE.MathUtils.degToRad(num('hdg', 0));
const fwd = new THREE.Vector3(Math.sin(hdg), 0, -Math.cos(hdg));
const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
// dive-bomb aim: the shadow `lead` meters ahead of the bus lands on the primary
const lead = cruise * S.stallSpeed * S.impactDelay;
const flyY = primary.h + config.flight.clearance;
let loopT = 0;
let loopN = 0;
let busS = 0; // distance along the heading, relative to the primary
let tapped = false;
let impacted = false;
let bloomed = 0;
let puffT = 0;
let twinkleT = 0;
let hue = num('hue', 2);
const fixedHue = P.get('hue') !== null;
const hues: number[] = [];
let hitStop = 0;

function resetLoop() {
  loopT = 0;
  tapped = false;
  impacted = false;
  bloomed = 0;
  busS = -lead - cruise * TAP;
  for (const b of order) paintBlock(b, Ramp.GREY);
  if (!fixedHue && loopN > 0) hue = (hue + 1) % 6;
  hues.length = 0;
  // Splatter fan: primary = hue, right side +1, +2; left side -1, -2
  const offs = [0, 1, -1, 2, -2];
  for (let k = 0; k < order.length; k++) hues.push((((hue + offs[k]) % 6) + 6) % 6);
  loopN++;
}
resetLoop();

function step(dt: number) {
  if (hitStop > 0) {
    hitStop -= dt;
    dt = 0;
  }
  loopT += dt;
  if (loopT >= LOOP) resetLoop();
  const t = loopT;
  const barfing = tapped && t < TAP + S.duration;
  // speed: cruise in, stall while barfing, zip off light after (relief boost)
  const after = t - TAP - S.duration;
  const speed = !tapped ? cruise : barfing ? cruise * S.stallSpeed : cruise * (S.stallSpeed + (S.reliefBoost - S.stallSpeed) * (1 - Math.exp(-after * 3)));
  busS += speed * dt;
  const sag = !tapped ? -config.flight.fullSag : barfing ? -config.flight.fullSag - 0.6 : Math.min(config.flight.lightLift, after * 6);
  bus.root.position.set(primary.x + fwd.x * busS + right.x * off, flyY + sag + Math.sin(t * 3.1) * 0.15, primary.z + fwd.z * busS + right.z * off);
  bus.root.rotation.set(barfing ? 0.06 : 0, -hdg, Math.sin(t * 2.3) * 0.03, 'YXZ');
  vel.copy(fwd).multiplyScalar(speed);

  pose.speed = speed;
  pose.fullness = !tapped ? 1 : Math.max(0, 1 - (t - TAP) / 0.9);
  pose.mouth = barfing ? 1 : Math.max(0, pose.mouth - dt * 4);
  pose.heave = barfing ? Math.max(0, 1 - (t - TAP) / S.duration) : 0;
  pose.squash = barfing && t - TAP < 0.12 ? 0.78 : barfing ? 1.04 : 1;
  pose.eye = barfing ? 0.2 : tapped ? 1 : 0.45;
  pose.wheeze = tapped ? 0 : 0.8;
  bus.update(dt, t, pose);

  if (!tapped && t >= TAP) {
    tapped = true;
    if (on('geyser')) fx.geyser({ source: mouthWorld, sourceVel: busVel, targets: roofs, duration: S.duration, travelTime: S.impactDelay, hues });
  }
  const tImpact = TAP + S.impactDelay;
  if (tapped && !impacted && t >= tImpact) {
    impacted = true;
    if (on('splash')) fx.splash(impactPos, hues[0], 1);
    hitStop = S.hitStopFrames / 60;
  }
  while (impacted && bloomed < order.length && t >= tImpact + bloomed * fxTune.streamStep) {
    const b = order[bloomed];
    paintBlock(b, HUE_RAMPS[hues[bloomed]]);
    const hh = hues[bloomed];
    if (on('sparkle')) fx.sparkles(sparkPos[bloomed], Math.sqrt(7.5 * 18) * 0.6 + 2, b.h, [hh, (hh + 1) % 6, (hh + 5) % 6], 26);
    bloomed++;
  }
  // grey exhaust puffs from the tailpipe
  puffT -= dt;
  if (on('puff') && puffT <= 0 && dt > 0) {
    puffT = tapped && !barfing ? 0.05 : 0.13;
    bus.root.updateMatrixWorld();
    bus.root.localToWorld(exhaust.copy(bus.exhaustLocal));
    exhaustVel.set((Math.random() - 0.5) * 1.5, 0.6, speed * 0.25 + 2.5);
    fx.puff(exhaust, exhaustVel, Ramp.FOG);
  }
  // painted walls twinkle (like main.ts: one reused position object)
  twinkleT -= dt;
  if (on('twinkle') && bloomed > 0 && twinkleT <= 0 && dt > 0) {
    twinkleT = 0.12;
    const b = order[Math.floor(Math.random() * bloomed)];
    const side = Math.random() < 0.5 ? -1 : 1;
    twinklePos.set(b.x + side * (4.4 + Math.random()), Math.random() * (b.h + 2), b.z + (Math.random() - 0.5) * 16);
    fx.ambientSparkle(twinklePos, hues[order.indexOf(b)]);
  }
  fx.update(dt);
}

// the game's chase camera: behind the bus, looking ahead and a little below it
const dist = num('dist', 175);
const elev = THREE.MathUtils.degToRad(num('elev', 31));
const look = new THREE.Vector3();
function chaseCam() {
  const bp = bus.root.position;
  const la = config.camera.lookAhead * 0.75;
  const back = Math.cos(elev) * dist;
  h.camera.position.set(bp.x - fwd.x * back, bp.y + Math.sin(elev) * dist, bp.z - fwd.z * back);
  h.camera.lookAt(look.set(bp.x + fwd.x * la, bp.y - 4, bp.z + fwd.z * la));
  h.pipeline.focus.copy(bp);
}

// freeze for screenshots: pre-roll deterministically at 60 fps
const freeze = P.get('t');
if (freeze !== null) {
  const tf = Number(freeze);
  const dt = 1 / 60;
  for (let t = 0; t < tf; t += dt) step(dt);
}

h.onFrame((dt) => {
  fx.setViewportHeight(h.pipeline.info.height);
  step(freeze !== null ? 0 : dt);
  if (chase) chaseCam();
  (window as unknown as { __stats: unknown }).__stats = { alive: fx.alive, loopT };
});

(window as unknown as { __fx: unknown }).__fx = { fx, fxTune, bus };
setTimeout(() => h.ready(), 300);
