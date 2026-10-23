// Dev test bed: the real pixel pipeline with a grey ground, a few buildings
// and a turntable camera. Module test pages import createHarness() and add
// their objects to `scene`. Query params: ?dist=60&elev=30&yaw=0&spin=1&w=..
import * as THREE from 'three';
import { PixelPipeline } from '../src/render/PixelPipeline';
import { globals, makeRampMaterial, setVertexRamp, SHADOW_LAYER } from '../src/render/materials';
import { Ramp } from '../src/render/palette';
import { config } from '../src/config';

export interface Harness {
  scene: THREE.Scene;
  pipeline: PixelPipeline;
  camera: THREE.PerspectiveCamera;
  /** Point the camera orbits / looks at. */
  target: THREE.Vector3;
  params: URLSearchParams;
  onFrame(cb: (dt: number, t: number) => void): void;
  /** Call when the scene is ready for a screenshot. */
  ready(): void;
}

export function createHarness(opts: { ground?: boolean; buildings?: boolean } = {}): Harness {
  const params = new URLSearchParams(location.search);
  const canvas = document.querySelector('canvas') ?? document.body.appendChild(document.createElement('canvas'));
  canvas.id = 'game';
  const pipeline = new PixelPipeline(canvas as HTMLCanvasElement);
  const scene = new THREE.Scene();
  const camera = pipeline.camera;
  const target = new THREE.Vector3(0, 4, 0);

  const az = config.light.sunAzimuth;
  const el = config.light.sunElevation;
  globals.uSunDir.value.set(Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el)).normalize();
  globals.uFog.value.x = Number(params.get('fog') ?? config.fog.density);

  if (opts.ground !== false) {
    const g = new THREE.PlaneGeometry(2000, 2000, 1, 1).rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(g, makeRampMaterial({ ramp: Ramp.GREY_LIGHT, lightOffset: -0.05 }));
    ground.layers.enable(SHADOW_LAYER);
    scene.add(ground);
  }
  if (opts.buildings !== false) {
    const mat = makeRampMaterial({ vertexRamp: true });
    let k = 0;
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue;
        const h = 8 + ((i * 7 + j * 13 + 40) % 9) * 1.6;
        const geo = setVertexRamp(new THREE.BoxGeometry(7.5, h, 18).translate(0, h / 2, 0), Ramp.GREY);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(i * 9, 0, j * 26);
        m.layers.enable(SHADOW_LAYER);
        scene.add(m);
        k++;
      }
    }
  }

  const cbs: Array<(dt: number, t: number) => void> = [];
  let last = performance.now();
  let t = 0;
  const dist = Number(params.get('dist') ?? 60);
  const elev = THREE.MathUtils.degToRad(Number(params.get('elev') ?? 30));
  let yaw = THREE.MathUtils.degToRad(Number(params.get('yaw') ?? 20));
  const spin = Number(params.get('spin') ?? 0);
  const pw = params.get('w');
  if (pw) config.render.pixelWidth = Number(pw);

  function resize() {
    pipeline.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  }
  window.addEventListener('resize', resize);
  resize();

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    globals.uTime.value = t;
    yaw += spin * dt;
    camera.position.set(
      target.x + Math.cos(yaw) * Math.cos(elev) * dist,
      target.y + Math.sin(elev) * dist,
      target.z + Math.sin(yaw) * Math.cos(elev) * dist,
    );
    camera.lookAt(target);
    pipeline.focus.copy(target);
    for (const cb of cbs) cb(dt, t);
    pipeline.render(scene);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    scene,
    pipeline,
    camera,
    target,
    params,
    onFrame: (cb) => cbs.push(cb),
    ready: () => {
      (window as unknown as { __shotReady: boolean }).__shotReady = true;
    },
  };
}
