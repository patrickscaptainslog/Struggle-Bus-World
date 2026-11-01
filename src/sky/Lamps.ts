import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_COMMON, GLSL_OUT, heldGlobals } from '../render/materials';
import { Ramp } from '../render/palette';
import { registerWarm } from '../render/warmup';
import type { TerrainTile } from '../world/tiles';
import { heldHour } from './flag';
import { LAMP_XZ, LAMP_Y, tileKey, type LampRequest, type LampResult } from './lampData';
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
  private data: LampResult | null = null;
  /** tile key -> its run in the list */
  private readonly runs = new Map<number, number>();
  private tileSize = 256;
  /** the list hasn't landed, or told us it won't (QA's __shotReady waits) */
  busy = true;
  /** Called once if the list comes: every loaded tile's pools go on the queue. */
  onLanded: (() => void) | null = null;

  constructor() {
    this.object.matrixAutoUpdate = false;
  }

  /** lamps.bin, off the main thread, with the far grid's heights. A city with none has none. */
  load(url: string, ground: LampGround, tileSize: number) {
    this.tileSize = tileSize;
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
    this.data = r;
    for (let i = 0; i < r.keys.length; i++) this.runs.set(r.keys[i], i);
    this.streets = lampPoints(r.pos, this.mat);
    this.object.add(this.streets);
    this.onLanded?.();
  }

  /** Every frame, the tuner's switches. */
  update() {
    const S = config.sky;
    uLampPoint.value.set(S.lampShare, S.lampLift, S.lampThin);
    if (this.streets) this.streets.visible = S.lamps;
    heldGlobals.uLamp.value = S.pools ? S.poolLift : 0;
    heldGlobals.uLampFar.value.set(S.poolFade, S.poolEnd);
  }

  /**
   * Each lamp's pool into the top 4 bits of a tile's classes (classes stop at 10): a disc of hashed radius, brightest at the lamp, the brightest of what overlaps. Lamps
   * near the tile's edge reach into it, so the runs of the tiles around it are walked too. Returns false: this city has no lamps.
   */
  stamp(tr: TerrainTile): boolean {
    const r = this.data;
    if (!r) return false;
    const S = config.sky, N = tr.classN, t = this.tileSize / N, reach = S.poolRadius;
    const tx = Math.round(tr.originX / this.tileSize), tz = Math.round(tr.originZ / this.tileSize);
    const c = tr.cls, p = r.pos;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const run = this.runs.get(tileKey(tx + dx, tz + dz));
        if (run === undefined) continue;
        for (let n = r.starts[run], e = r.starts[run + 1]; n < e; n++) {
          const x = p[n * 4] * LAMP_XZ - tr.originX, z = p[n * 4 + 2] * LAMP_XZ - tr.originZ;
          if (x < -reach || z < -reach || x > this.tileSize + reach || z > this.tileSize + reach) continue;
          // (as the shader hashes a lamp's place)
          const h = Math.sin((x + tr.originX) * 12.9898 + (z + tr.originZ) * 78.233) * 43758.5453;
          const rad = reach * (0.72 + 0.28 * (h - Math.floor(h)));
          const i0 = Math.max(0, Math.ceil((x - rad) / t - 0.5)), i1 = Math.min(N - 1, Math.floor((x + rad) / t - 0.5));
          const j0 = Math.max(0, Math.ceil((z - rad) / t - 0.5)), j1 = Math.min(N - 1, Math.floor((z + rad) / t - 0.5));
          for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
              const ax = (i + 0.5) * t - x, az = (j + 0.5) * t - z;
              const d = 1 - (ax * ax + az * az) / (rad * rad);
              if (d <= 0) continue;
              const v = Math.ceil(d * 15), q = j * N + i;
              if (v > c[q] >> 4) c[q] = (c[q] & 15) | (v << 4);
            }
        }
      }
    return true;
  }
}
