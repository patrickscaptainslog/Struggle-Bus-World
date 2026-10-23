// Autopilot flight test over the real city: real Flight + CameraRig + City,
// scripted thumb input. ?t=seconds to fast-forward before ready, ?script=turns|surge|hover
import * as THREE from 'three';
import { PixelPipeline } from '../src/render/PixelPipeline';
import { globals } from '../src/render/materials';
import { config } from '../src/config';
import { City } from '../src/world/City';
import { Flight } from '../src/game/Flight';
import { CameraRig } from '../src/game/CameraRig';
import { BusModel } from '../src/bus/BusModel';
import { makeGoldenGate, makeBayBridgeWest } from '../src/world/Bridges';

const p = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const pipe = new PixelPipeline(canvas);
pipe.renderer.info.autoReset = false;
const scene = new THREE.Scene();
const az = config.light.sunAzimuth, el = config.light.sunElevation;
globals.uSunDir.value.set(Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el)).normalize();
const man = await (await fetch('/city/sf/city.json')).json();
const city = new City(man, '/city/sf');
scene.add(city.root);
await city.loadFar();
for (const lm of man.landmarks) {
  if (lm.kind === 'ggb') scene.add(makeGoldenGate(lm.points));
  if (lm.kind === 'baybridge') scene.add(makeBayBridgeWest(lm.points));
}
const bus = new BusModel();
scene.add(bus.root);
const f = new Flight();
f.x = man.start.x; f.z = man.start.z; f.heading = man.start.heading;
if (p.has('lat')) {
  const [lat0, lon0] = man.origin;
  f.x = (Number(p.get('lon')) - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
  f.z = -(Number(p.get('lat')) - lat0) * 110574;
}
if (p.has('heading')) f.heading = THREE.MathUtils.degToRad(Number(p.get('heading')));
const rig = new CameraRig();
const opening = p.has('opening');
let bridgeMid: [number, number] | null = null;
if (opening) {
  const g = man.landmarks.find((l: any) => l.kind === 'ggb');
  const t1 = g.points[1], t2 = g.points[2];
  const sx = t2[0] - t1[0], sz = t2[1] - t1[1], sl = Math.hypot(sx, sz);
  bridgeMid = [t1[0] + (sx / sl) * 85, t1[1] + (sz / sl) * 85];
  f.x = bridgeMid[0] - f.fx * 640; f.z = bridgeMid[1] - f.fz * 640;
  rig.openingLow = 1; f.speed = 60; f.glideSpeed = 60;
  globals.uFogBank.value = Number(p.get('bank') ?? 1);
}
const focus = new THREE.Vector3();
pipe.resize(innerWidth, innerHeight, devicePixelRatio);
const script = p.get('script') ?? 'turns';
const T = Number(p.get('t') ?? 8);
let t = 0;
const log: string[] = [];
function input(t: number) {
  if (script === 'surge') return { sx: 0.15 * Math.sin(t * 0.5), sy: 1, dragging: true };
  if (script === 'hover') return { sx: 0, sy: -1, dragging: true };
  if (script === 'straight') return { sx: 0, sy: 0, dragging: false };
  return { sx: Math.sin(t * 0.7) > 0.3 ? 0.8 : Math.sin(t * 0.7) < -0.3 ? -0.8 : 0, sy: 0.2, dragging: true };
}
function step(dt: number) {
  t += dt;
  globals.uTime.value = t;
  const inp = input(t);
  for (let i = 0; i < 4; i++) f.step(dt / 4, inp, city);
  bus.update(dt, t, { squash: 1, eye: 0.8, fullness: f.fullness, mouth: 0, speed: f.speed, wheeze: 0.3, heave: 0 });
  const e = new THREE.Euler(f.pitch, -f.heading, -f.bank, 'YXZ');
  bus.root.quaternion.setFromEuler(e);
  bus.root.position.set(f.x, f.y, f.z);
  if (bridgeMid) {
    const along = (f.x - bridgeMid[0]) * f.fx + (f.z - bridgeMid[1]) * f.fz;
    const want = along < 180 ? 1 : 0;
    rig.openingLow += (want - rig.openingLow) * (1 - Math.exp(-(want ? 4 : 0.7) * dt));
  }
  rig.update(pipe.camera, focus, f, dt);
  pipe.focus.copy(focus);
  globals.uGroundRef.value = f.groundUnder - 30;
  city.update(focus, pipe.renderer, dt);
}
// wait for the first regions before simulating
while (city.loadedRegionCount() === 0 || city.busy) {
  city.update(new THREE.Vector3(f.x, 0, f.z), pipe.renderer, 0.016);
  await new Promise((r) => setTimeout(r, 50));
}
for (let i = 0; i < T * 30; i++) {
  step(1 / 30);
  if (i % 30 === 0) log.push(`t=${t.toFixed(1)} y=${f.y.toFixed(1)} ground=${f.groundUnder.toFixed(1)} obst=${f.obstacleUnder.toFixed(1)} v=${f.speed.toFixed(1)} bank=${f.bank.toFixed(2)}`);
  if (city.busy && i % 10 === 0) await new Promise((r) => setTimeout(r, 30));
}
console.log(log.join('\n'));
let frames = 0;
function frame() {
  requestAnimationFrame(frame);
  step(1 / 60);
  pipe.renderer.info.reset();
  pipe.render(scene);
  const info = pipe.renderer.info;
  (window as any).__stats = { calls: info.render.calls, tris: info.render.triangles, regions: city.loadedRegionCount() };
  if (++frames === 20 && !city.busy) (window as any).__shotReady = true;
  if (frames > 20 && !city.busy) (window as any).__shotReady = true;
}
frame();
