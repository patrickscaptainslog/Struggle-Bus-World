import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { Ramp } from '../render/palette';
import { registerWarm } from '../render/warmup';
import { heldHour } from './flag';
import { LAMP_XZ, LAMP_Y, type LampRequest, type LampResult } from './lampData';
import { loadLamps } from './lampLoad';

// The street data is the night look (SKY.md 4.4): one pixel per lamp, the LAMP row, depth tested, one Points draw for the whole city, the far band's too. A light is a pixel.
// On iOS a point's size must be written on every path, or a draw is undefined there: this one writes 1 before anything else, in pixels of the G-buffer it draws into, and the
// point lands on the same snapped grid as every surface. A lamp doesn't glow: a pixel is under the halo's gate at any glow, and thousands of them far off would only boil
// it (8 % of pixels at glow 1 boils 84 % of the area), so share x glow is 0.

const LAMP_VS = /* glsl */ `
  ${GLSL_COMMON}
  uniform vec3 uLampPoint;    // the share lit, a head's lift a metre from the lens (m), the distance past which they thin out (m)
  flat out float vLight;
  flat out float vFog;
  void main() {
    gl_PointSize = 1.0;
    vec3 wp = position * vec3(${LAMP_XZ.toFixed(1)}, ${LAMP_Y.toFixed(2)}, ${LAMP_XZ.toFixed(1)});
    float h = fract(sin(dot(wp.xz, vec2(12.9898, 78.233))) * 43758.5453);
    float dist = distance(wp, cameraPosition);
    vLight = 0.0;
    vFog = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    // (far off they crowd into rows a pixel apart: a stable hash thins them with distance, so a lamp goes out alone, never a row at a time)
    if (h >= uLampPoint.x || h * dist >= uLampPoint.z) return;
    // (the far mesh's 64 m cells stand a few metres off the lamp's 32 m heights)
    wp.y += dist * uLampPoint.y;
    vLight = (h < 0.3 ? 6.0 : 7.0) / 7.0;
    vFog = uFog.x > 0.0 || dist > uFog.z * 0.55 ? sbFog(wp) : 0.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const LAMP_FS = /* glsl */ `
  ${GLSL_COMMON}
  flat in float vLight;
  flat in float vFog;
  ${GLSL_OUT}
  void main() {
    sbWrite(${Ramp.LAMP}.0, vLight, vFog, 0.0, vec3(0.0, 0.0, 1.0), 0.03, 0.5);
  }
`;

const uLampPoint = { value: new THREE.Vector3() };

function makeLampMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { ...globals, uLampPoint }, vertexShader: LAMP_VS, fragmentShader: LAMP_FS });
}

/** A lamp list's one draw. `pos`: 4 i16 a lamp, in the list's units. */
function lampPoints(pos: Int16Array, material: THREE.Material): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 4));
  const p = new THREE.Points(g, material);
  p.frustumCulled = false;
  p.matrixAutoUpdate = false;
  p.matrixWorldAutoUpdate = false;
  return p;
}

// (the warm-up's source: nothing compiles in flight, and flag off this program doesn't exist)
if (heldHour) registerWarm('lamps', () => lampPoints(new Int16Array(4), makeLampMaterial()));

/** The ground grid a lamp list stands on. */
export type LampGround = Pick<LampRequest, 'ground' | 'gridW' | 'gridH' | 'minX' | 'minZ' | 'cell'>;

export class Lamps {
  readonly object = new THREE.Group();
  private readonly mat = makeLampMaterial();
  private streets: THREE.Points | null = null;
  /** the list hasn't landed, or told us it won't (QA's __shotReady waits) */
  busy = true;

  constructor() {
    this.object.matrixAutoUpdate = false;
  }

  /** lamps.bin, off the main thread, with the far grid's heights. A city with none has none. */
  load(url: string, ground: LampGround, tileSize: number) {
    this.busy = true;
    const req: LampRequest = { url: new URL(url, location.href).href, ...ground, tileSize, head: config.sky.lampHead };
    const landed = (r: LampResult | null) => {
      this.busy = false;
      if (r) this.land(r);
    };
    const onThread = () => void loadLamps(req).then(landed);
    try {
      const worker = new Worker(new URL('./lampWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<LampResult | null>) => {
        worker.terminate();
        landed(ev.data);
      };
      // (a sandboxed host can refuse a module worker)
      worker.onerror = () => {
        worker.terminate();
        onThread();
      };
      worker.postMessage(req);
    } catch {
      onThread();
    }
  }

  private land(r: LampResult) {
    this.streets = lampPoints(r.pos, this.mat);
    this.object.add(this.streets);
  }

  /** Every frame, the tuner's switches. */
  update() {
    const S = config.sky;
    uLampPoint.value.set(S.lampShare, S.lampLift, S.lampThin);
    if (this.streets) this.streets.visible = S.lamps;
  }
}
