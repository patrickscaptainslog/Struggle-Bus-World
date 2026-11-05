import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_COMMON, GLSL_OUT, heldGlobals } from '../render/materials';
import { HUE_RAMPS, Ramp } from '../render/palette';
import { paintUniforms } from '../world/buildingMaterial';
import { registerWarm } from '../render/warmup';
import type { TerrainTile } from '../world/tiles';
import { skyOn } from './flag';
import { LAMP_XZ, LAMP_Y, tileKey, type LampRequest, type LampResult } from './lampData';
import { loadLamps } from './lampLoad';

// The street data is the night look (SKY.md 4.4): one pixel per lamp, the LAMP row, depth tested, one Points draw for the whole city, the far band's too. A light is a pixel.
// On iOS a point's size must be written on every path, or a draw is undefined there: this one writes 1 before anything else, in pixels of the G-buffer it draws into, and the
// point lands on the same snapped grid as every surface. A lamp doesn't glow: a pixel is under the halo's gate at any glow, and thousands of them far off would only boil
// it (8 % of pixels at glow 1 boils 84 % of the area), so share x glow is 0.

// A painted bridge's necklace (SPAN, the spans' own draw): each light takes the next hue of its bridge's paint down the
// deck as the paint's run reaches it, from the bridge's texel and its hit (the same vectors its material reads), so a
// rainbow string of lights at night costs a texel fetch a light and nothing a frame.
const LAMP_VS = /* glsl */ `
  ${GLSL_COMMON}
  uniform vec4 uLampPoint;    // the share lit, a head's lift a metre from the lens (m), the distance past which they thin out (m), how far the dusk's wave has come
  flat out float vLight;
  flat out float vFog;
  #ifdef SPAN
  precision highp sampler2D;
  uniform sampler2D uPaint;
  uniform float uPaintW;
  in float aTag;              // its bridge (1, 2) + 4 x its hue step
  uniform vec2 uSpanIdx;      // the two bridges' paint texels (-1: not paintable yet)
  uniform vec4 uSpanHit1;     // where each bridge's breath hit and when (its material's uLmHit)
  uniform vec4 uSpanHit2;
  uniform float uSpanRun;     // how fast its paint runs along it (m/s)
  flat out float vRamp;
  const float SPAN_HUES[6] = float[6](${HUE_RAMPS.map((r) => r.toFixed(1)).join(', ')});
  #endif
  void main() {
    #ifdef SPAN
    vRamp = ${Ramp.LAMP}.0;
    #endif
    gl_PointSize = 1.0;
    vec3 wp = position * vec3(${LAMP_XZ.toFixed(1)}, ${LAMP_Y.toFixed(2)}, ${LAMP_XZ.toFixed(1)});
    float h = fract(sin(dot(wp.xz, vec2(12.9898, 78.233))) * 43758.5453);
    float dist = distance(wp, cameraPosition);
    vLight = 0.0;
    vFog = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    // (far off they crowd into rows a pixel apart: a stable hash thins them with distance, so a lamp goes out alone, never a row at a time)
    if (h >= uLampPoint.x || h * dist >= uLampPoint.z) return;
    // (they come on in waves near sun -2 to -4 degrees, SKY.md 4.4: a 300 m block's photocells near together, the blocks at their own times)
    if (0.8 * fract(sin(dot(floor(wp.xz / 300.0), vec2(127.1, 311.7))) * 43758.5453) + 0.2 * h >= uLampPoint.w) return;
    // (the far mesh's 64 m cells stand a few metres off the lamp's 32 m heights)
    wp.y += dist * uLampPoint.y;
    vLight = (h < 0.3 ? 6.0 : 7.0) / 7.0;
    vFog = uFog.x > 0.0 || dist > uFog.z * 0.55 ? sbFog(wp) : 0.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    #ifdef SPAN
    float g = mod(aTag, 4.0);
    float idx = g < 1.5 ? uSpanIdx.x : uSpanIdx.y;
    if (idx >= 0.0) {
      vec4 paint = texelFetch(uPaint, ivec2(int(mod(idx, uPaintW)), int(floor(idx / uPaintW))), 0);
      vec4 hit = g < 1.5 ? uSpanHit1 : uSpanHit2;
      // (an escalation is painted already; a fresh bloom lights up as its run passes, light by light)
      bool run = paint.a < 1.5 && hit.w > paint.b - 4.0 && hit.w < paint.b + 0.3;
      if (paint.g > 0.5 && uTime >= paint.b && (!run || distance(wp, hit.xyz) < uSpanRun * (uTime - hit.w))) {
        vRamp = SPAN_HUES[int(mod(floor(paint.r + 0.5) + floor(aTag / 4.0) + 60.0, 6.0))];
        vLight = 0.7;
      }
    }
    #endif
  }
`;

const LAMP_FS = /* glsl */ `
  ${GLSL_COMMON}
  flat in float vLight;
  flat in float vFog;
  #ifdef SPAN
  flat in float vRamp;
  #endif
  ${GLSL_OUT}
  void main() {
    #ifdef SPAN
    sbWrite(vRamp, vLight, vFog, 0.0, vec3(0.0, 0.0, 1.0), 0.03, 0.5);
    #else
    sbWrite(${Ramp.LAMP}.0, vLight, vFog, 0.0, vec3(0.0, 0.0, 1.0), 0.03, 0.5);
    #endif
  }
`;

const uLampPoint = { value: new THREE.Vector4() };

/** The lamps' material; `span`, the spans' (their lights take a painted bridge's hues). */
function makeLampMaterial(span = false): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = { ...globals, uLampPoint };
  if (span)
    Object.assign(uniforms, {
      uPaint: paintUniforms.uPaint,
      uPaintW: paintUniforms.uPaintW,
      uSpanIdx: { value: new THREE.Vector2(-1, -1) },
      uSpanHit1: { value: new THREE.Vector4(0, 0, 0, -1e9) },
      uSpanHit2: { value: new THREE.Vector4(0, 0, 0, -1e9) },
      uSpanRun: { value: 0 },
    });
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, defines: span ? { SPAN: 1 } : {}, uniforms, vertexShader: LAMP_VS, fragmentShader: LAMP_FS });
}

/** A lamp list's one draw. `pos`: 4 i16 a lamp, in the list's units; `tags`: a span light's bridge and hue step. */
function lampPoints(pos: Int16Array, material: THREE.Material, tags?: Uint8Array): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 4));
  if (tags) g.setAttribute('aTag', new THREE.BufferAttribute(tags, 1));
  const p = new THREE.Points(g, material);
  p.frustumCulled = false;
  p.matrixAutoUpdate = false;
  p.matrixWorldAutoUpdate = false;
  return p;
}

// (the warm-up's source: nothing compiles in flight, and flag off this program doesn't exist)
if (skyOn) registerWarm('lamps', () => [lampPoints(new Int16Array(4), makeLampMaterial()), lampPoints(new Int16Array(4), makeLampMaterial(true), new Uint8Array(1))]);

/** The ground grid a lamp list stands on. */
export type LampGround = Pick<LampRequest, 'ground' | 'gridW' | 'gridH' | 'minX' | 'minZ' | 'cell'>;

export class Lamps {
  readonly object = new THREE.Group();
  private readonly mat = makeLampMaterial();
  private readonly spanMat = makeLampMaterial(true);
  private streets: THREE.Points | null = null;
  private bridges: THREE.Points | null = null;
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

  /**
   * The spans' lights, x, y, z a light (Bridges.ts bridgeLights): their own draw, there from the first frame. `tags`: each
   * light's bridge (1, 2) + 4 x its hue step; `run`: how fast a bridge's paint runs along it (m/s).
   */
  setBridges(xyz: number[], tags: number[], run: number) {
    const n = xyz.length / 3;
    if (!n) return;
    const pos = new Int16Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 4] = Math.round(xyz[i * 3] / LAMP_XZ);
      pos[i * 4 + 1] = Math.round(xyz[i * 3 + 1] / LAMP_Y);
      pos[i * 4 + 2] = Math.round(xyz[i * 3 + 2] / LAMP_XZ);
    }
    this.spanMat.uniforms.uSpanRun.value = run;
    this.bridges = lampPoints(pos, this.spanMat, Uint8Array.from(tags));
    this.object.add(this.bridges);
  }

  /** Bridge `group` (1, 2) paints from texel `index`, its breath's hit read from its material's own vector. */
  paintSpan(group: number, index: number, hit: THREE.Vector4) {
    const u = this.spanMat.uniforms;
    (u.uSpanIdx.value as THREE.Vector2).setComponent(group - 1, index);
    u[group === 1 ? 'uSpanHit1' : 'uSpanHit2'].value = hit;
  }

  /** Every frame, the tuner's switches. `wave`: how far the dusk's wave has come, 0 none on (the day), 1 all of them. */
  update(wave: number) {
    const S = config.sky, on = wave > 0;
    uLampPoint.value.set(S.lampShare, S.lampLift, S.lampThin, wave);
    if (this.streets) this.streets.visible = on && !!S.lamps;
    if (this.bridges) this.bridges.visible = on && !!S.bridges;
    heldGlobals.uLamp.value = S.pools ? S.poolLift * wave : 0;
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
