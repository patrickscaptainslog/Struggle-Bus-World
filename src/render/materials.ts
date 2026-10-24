import * as THREE from 'three';
import { config } from '../config';

// Every scene material writes the same small G-buffer, so the post pass can
// light-quantize, dither, outline and fog everything consistently:
//
//   gColor (location 0): r = ramp index / 255, g = light level 0..1,
//                        b = fog amount 0..1,  a = glow (emissive) 0..1
//   gAux   (location 1): rg = view-space normal (octahedral, 0..1),
//                        b = surface id hash 0..1 (adjacent ids get a seam line),
//                        a = flags: 1.0 = normal surface, 0.5 = no outline (particles, glow cards)
//
// Materials never output RGB colors. Use the GLSL chunks below; see
// makeRampMaterial() for the common case.

/** Uniforms shared by every scene material. Update in place; never replace. */
export const globals = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, // world, points toward the sun
  uLight: { value: new THREE.Vector3(config.light.sunStrength, config.light.ambient, config.light.skyBounce) },
  uShadowMap: { value: null as THREE.DepthTexture | null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 }, // shadow strength 0..1 (0 = no shadow map this frame)
  uShadowEdge: { value: 0.08 }, // width of the fade at the shadow window's edge (fraction of the map)
  uFog: { value: new THREE.Vector4(config.fog.density, config.fog.heightFalloff, config.fog.farFull, 1) },
  // the fog ceiling for tall distant shapes: x most fog they get, y/z the heights (m ASL) over which it
  // takes hold, w distance (m) by which it has faded back to full fog
  uFogStand: { value: new THREE.Vector4(config.fog.standFog, config.fog.standFrom, config.fog.standTo, config.fog.standFade) },
  uFogBank: { value: 1 },
  uPaintFog: { value: null as THREE.Texture | null }, // r = paint density, sampled over uPaintFogRect
  uPaintFogRect: { value: new THREE.Vector4(0, 0, 1, 1) }, // minX, minZ, 1/width, 1/depth
  uPaintClearing: { value: config.fog.paintClearing },
  uGroundRef: { value: 0 }, // sea-level-ish reference for height fog
  // marine layer: x top west, y top bay, z top east (m ASL), w soft half-thickness
  uFogLayer: { value: new THREE.Vector4(config.fog.layerTop, config.fog.layerTopBay, config.fog.layerTopEast, config.fog.layerSoft) },
  // x density inside, y clear-air haze above (1/m), z far-full distance (m), w view mix 0..1 (0 = street-level fog only)
  uFogLayer2: { value: new THREE.Vector4(config.fog.layerDensity, config.fog.layerHaze, config.fog.layerFarFull, 0) },
  // x billow amplitude (m), y 1 / billow size (1/m)
  uFogBillow: { value: new THREE.Vector2(config.fog.layerBillow, 1 / config.fog.layerBillowSize) },
};

/**
 * The marine layer's top (m above sea level) at a world point: thick over the
 * ocean, the west side and the Golden Gate, lower over the bay, burnt down
 * over the sunny east side (Mission, downtown); billowed. Shared by the fog of
 * every material and by the resolve pass (which lights the fog top).
 * Needs uFogLayer / uFogBillow declared.
 */
export const GLSL_LAYER_TOP = /* glsl */ `
float sbLayerHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float sbLayerNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = sbLayerHash(i), b = sbLayerHash(i + vec2(1.0, 0.0));
  float c = sbLayerHash(i + vec2(0.0, 1.0)), d = sbLayerHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float sbLayerTop(vec2 xz) {
  // San Francisco, game meters (x east, z south of Civic Center): the fog pours
  // in over the west and through the Golden Gate; Twin Peaks shelters the east;
  // out over the bay it thickens again.
  float east = smoothstep(-2900.0, -1500.0, xz.x);
  float north = 1.0 - smoothstep(-4400.0, -2600.0, xz.y);
  float bay = smoothstep(1700.0, 3400.0, xz.x);
  float top = mix(uFogLayer.x, uFogLayer.z, east);
  top = mix(top, uFogLayer.y, max(bay, north * east));
  vec2 q = xz * uFogBillow.y;
  float b = sbLayerNoise(q) * 0.68 + sbLayerNoise(q * 2.63 + vec2(17.3, 5.1)) * 0.32;
  return top + (b - 0.5) * 2.0 * uFogBillow.x;
}
`;

/** CPU mirror of sbLayerTop() without the billows (m above sea level). */
export function layerTopBase(x: number, z: number): number {
  const F = config.fog;
  const ss = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const east = ss(-2900, -1500, x);
  const north = 1 - ss(-4400, -2600, z);
  const bay = ss(1700, 3400, x);
  const top = F.layerTop + (F.layerTopEast - F.layerTop) * east;
  return top + (F.layerTopBay - top) * Math.max(bay, north * east);
}

/**
 * The sky's light by view direction, one copy for both users: the resolve (PixelPipeline RESOLVE_FS: the
 * sky itself, and the value fog converges on) and the tower facades' mirror of the resolve's atmospheric
 * perspective (buildingMaterial skyMirror: towers write the light that lands exactly on a ramp step).
 * `calm` is pipeline.calm (0 at the floor, 1 with the vista fully calm).
 */
export const GLSL_SKY_LIGHT = /* glsl */ `
float sbSkyLight(vec3 dir, vec3 sunDir, float calm) {
  float e = clamp(dir.y * 2.6, -0.3, 1.0);
  float sunNear = pow(max(dot(dir, sunDir), 0.0), 16.0);
  // (at the floor the sky band is the frame's top ~10 deg: it holds one step there, so its first step
  // change, a dithered stripe, never rides the top edge of the chase view; up high it deepens as before)
  float l = 0.9 - mix(0.25, 0.5, calm) * max(e, 0.0) + 0.12 * sunNear;
  l -= 0.6 * max(-e, 0.0);
  return clamp(l, 0.0, 1.0);
}
`;

export const GLSL_COMMON = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uLight;            // x sun strength, y ambient, z sky bounce
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform float uShadowEdge;
uniform vec4 uFog;              // density, heightFalloff, farFull, unused
uniform vec4 uFogStand;         // fog ceiling of tall far shapes: cap, gate from / to (m: the city's low ground + standFrom / standTo), fade end (m)
uniform float uFogBank;
uniform sampler2D uPaintFog;
uniform vec4 uPaintFogRect;
uniform float uPaintClearing;
uniform float uGroundRef;
uniform vec4 uFogLayer;
uniform vec4 uFogLayer2;
uniform vec2 uFogBillow;
${GLSL_LAYER_TOP}

float sbShadow(vec3 worldPos, vec3 n) {
  if (uShadowOn < 0.01) return 1.0;
  vec3 p = worldPos + n * 0.35;
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  vec3 uvz = sc.xyz / sc.w;
  if (uvz.x <= 0.002 || uvz.x >= 0.998 || uvz.y <= 0.002 || uvz.y >= 0.998 || uvz.z >= 1.0) return 1.0;
  float s = texture(uShadowMap, vec3(uvz.xy, uvz.z - 0.0009));
  // fade shadows out near the edge of the shadow map so the boundary never pops
  vec2 e = min(uvz.xy, 1.0 - uvz.xy);
  float edge = smoothstep(0.0, uShadowEdge, min(e.x, e.y));
  return mix(1.0, s, edge * min(uShadowOn, 1.0));
}

// Toon light: returns 0..1 light level fed to the ramp lookup.
float sbLight(vec3 worldPos, vec3 n, float lightOffset, float shadowMul) {
  float ndl = max(dot(n, uSunDir), 0.0);
  float sh = mix(1.0, sbShadow(worldPos, n), shadowMul);
  float sky = 0.5 + 0.5 * n.y;
  float l = uLight.y + uLight.z * sky + uLight.x * ndl * sh;
  return clamp(l + lightOffset, 0.0, 1.0);
}

float sbFog(vec3 worldPos) {
  vec3 d = worldPos - cameraPosition;
  float dist = length(d);
  float hCam = max(cameraPosition.y - uGroundRef, 0.0);
  float hPos = max(worldPos.y - uGroundRef, 0.0);
  float hf = 0.5 * (exp(-hCam / uFog.y) + exp(-hPos / uFog.y));
  float density = uFog.x * uFogBank;
  // painted neighborhoods thin the fog above them
  vec2 puv = (worldPos.xz - uPaintFogRect.xy) * uPaintFogRect.zw;
  float paint = 0.0;
  if (puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0) paint = texture(uPaintFog, puv).r;
  density *= 1.0 - uPaintClearing * paint;
  float f = 1.0 - exp(-density * dist * (0.35 + 0.65 * hf));
  float far = smoothstep(uFog.z * 0.55, uFog.z, dist);
  f = clamp(max(f, far), 0.0, 1.0);
  // tall distant shapes (downtown's towers, Sutro, the peaks, the hilltops, the Headlands) stand out of
  // the low fog as pale Hopper silhouettes: a fog ceiling gated by height over the city's low ground
  // (City.lowGround: sea level in SF, the plateau elsewhere), so everything low
  // (the streaming edge among them) is buried exactly as before and their bases melt into the fog; the
  // far skyline boxes and the real tiles share it, so nothing inverts where a region streams in. Off
  // while the opening's fog bank is up; it fades back to full fog with distance (layers recede).
  float stand = smoothstep(uFogStand.y, uFogStand.z, worldPos.y) * clamp(2.0 - uFogBank, 0.0, 1.0);
  float cap = mix(uFogStand.x, 1.0, smoothstep(uFogStand.w * 0.5, uFogStand.w, dist));
  f = min(f, mix(1.0, cap, stand));
  if (uFogLayer2.w > 0.001) {
    // high above it, the marine layer is a fog sea with a top: the optical
    // depth is the ray's path inside the layer (an exact average of the soft
    // top's profile between the two heights) plus a whisper of clear-air haze.
    float top = sbLayerTop(worldPos.xz);
    float s = max(uFogLayer.w, 1.0);
    float y0 = cameraPosition.y, y1 = worldPos.y;
    float a = top - s;
    float A0 = y0 <= a ? y0 : y0 >= top + s ? top : a + (y0 - a) - (y0 - a) * (y0 - a) / (4.0 * s);
    float A1 = y1 <= a ? y1 : y1 >= top + s ? top : a + (y1 - a) - (y1 - a) * (y1 - a) / (4.0 * s);
    float dy = y1 - y0;
    float inL = abs(dy) > 0.5 ? (A1 - A0) / dy : (top + s - y1) / (2.0 * s);
    inL = clamp(inL, 0.0, 1.0);
    float od = dist * (uFogLayer2.x * inL + uFogLayer2.y * (1.0 - inL)) * uFogBank * (1.0 - uPaintClearing * paint);
    float fl = max(1.0 - exp(-od), smoothstep(uFogLayer2.z * 0.55, uFogLayer2.z, dist));
    f = mix(f, clamp(fl, 0.0, 1.0), uFogLayer2.w);
  }
  return f;
}

vec2 sbOctEncode(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return e * 0.5 + 0.5;
}

float sbHash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
`;

export const GLSL_OUT = /* glsl */ `
layout(location = 0) out highp vec4 gColor;
layout(location = 1) out highp vec4 gAux;
void sbWrite(float ramp, float light, float fog, float glow, vec3 viewNormal, float surfaceId, float flags) {
  gColor = vec4(ramp / 255.0, clamp(light, 0.0, 1.0), clamp(fog, 0.0, 1.0), clamp(glow, 0.0, 1.0));
  gAux = vec4(sbOctEncode(normalize(viewNormal)), fract(surfaceId), flags);
}
`;

export interface RampMaterialOptions {
  /** Ramp index used when the geometry has no `ramp` attribute. */
  ramp?: number;
  /** Use the per-vertex float attribute `ramp` (and optional `lightOffset`, `glow`). */
  vertexRamp?: boolean;
  /** Constant light offset added to the toon light (+ brighter / - darker). */
  lightOffset?: number;
  /** Constant glow 0..1. */
  glow?: number;
  /** 0 = ignore shadow map, 1 = full shadows. */
  shadowMul?: number;
  /** Surface id for seam outlines (0..1). Objects with different ids get a seam where they touch. */
  surfaceId?: number;
  /** Disable outlines on this material (particles, glow cards). */
  noOutline?: boolean;
  /** Fog multiplier (0 = never fogged, e.g. the bus close to the camera). */
  fogMul?: number;
  /** Extra GLSL inserted in the vertex shader after `vec3 p` (object space) is set; may modify p and n. */
  vertexChunk?: string;
  /** Extra uniforms for vertexChunk. */
  uniforms?: Record<string, THREE.IUniform>;
  side?: THREE.Side;
}

/**
 * The standard toon material for anything that isn't a building: bus, trees,
 * props, landmarks, signs. Supports InstancedMesh (instanceMatrix).
 */
export function makeRampMaterial(opts: RampMaterialOptions = {}): THREE.ShaderMaterial {
  const defines: Record<string, string | number | boolean> = {};
  if (opts.vertexRamp) defines.VERTEX_RAMP = 1;
  const uniforms: Record<string, THREE.IUniform> = {
    ...globals,
    uRamp: { value: opts.ramp ?? 0 },
    uLightOffset: { value: opts.lightOffset ?? 0 },
    uGlow: { value: opts.glow ?? 0 },
    uShadowMul: { value: opts.shadowMul ?? 1 },
    uSurfaceId: { value: opts.surfaceId ?? 0.5 },
    uFlags: { value: opts.noOutline ? 0.5 : 1.0 },
    uFogMul: { value: opts.fogMul ?? 1 },
    ...(opts.uniforms ?? {}),
  };
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines,
    uniforms,
    side: opts.side ?? THREE.FrontSide,
    vertexShader: /* glsl */ `
      ${GLSL_COMMON}
      #ifdef VERTEX_RAMP
      in float ramp;
      in float lightOffset;
      in float glow;
      out float vRamp;
      out float vLightOffset;
      out float vGlowA;
      #endif
      out vec3 vWorldPos;
      out vec3 vWorldNormal;
      out vec3 vViewNormal;
      void main() {
        vec3 p = position;
        vec3 n = normal;
        ${opts.vertexChunk ?? ''}
        vec4 wp = vec4(p, 1.0);
        mat3 nm = mat3(modelMatrix);
        #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
        nm = nm * mat3(instanceMatrix);
        #endif
        wp = modelMatrix * wp;
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(nm * n);
        vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
        #ifdef VERTEX_RAMP
        vRamp = ramp;
        vLightOffset = lightOffset;
        vGlowA = glow;
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      uniform float uRamp;
      uniform float uLightOffset;
      uniform float uGlow;
      uniform float uShadowMul;
      uniform float uSurfaceId;
      uniform float uFlags;
      uniform float uFogMul;
      in vec3 vWorldPos;
      in vec3 vWorldNormal;
      in vec3 vViewNormal;
      #ifdef VERTEX_RAMP
      in float vRamp;
      in float vLightOffset;
      in float vGlowA;
      #endif
      ${GLSL_OUT}
      void main() {
        float ramp = uRamp;
        float lo = uLightOffset;
        float glow = uGlow;
        #ifdef VERTEX_RAMP
        ramp = floor(vRamp + 0.5);
        lo += vLightOffset;
        glow = max(glow, vGlowA);
        #endif
        vec3 n = normalize(vWorldNormal);
        if (!gl_FrontFacing) n = -n;
        float light = sbLight(vWorldPos, n, lo, uShadowMul);
        light = max(light, glow);
        float fog = sbFog(vWorldPos) * uFogMul;
        sbWrite(ramp, light, fog, glow, gl_FrontFacing ? vViewNormal : -vViewNormal, uSurfaceId, uFlags);
      }
    `,
  });
}

/** Adds per-vertex ramp/lightOffset/glow attributes to a geometry (for vertexRamp materials). */
export function setVertexRamp(geo: THREE.BufferGeometry, ramp: number, lightOffset = 0, glow = 0): THREE.BufferGeometry {
  const n = geo.getAttribute('position').count;
  const r = new Float32Array(n).fill(ramp);
  const l = new Float32Array(n).fill(lightOffset);
  const g = new Float32Array(n).fill(glow);
  geo.setAttribute('ramp', new THREE.BufferAttribute(r, 1));
  geo.setAttribute('lightOffset', new THREE.BufferAttribute(l, 1));
  geo.setAttribute('glow', new THREE.BufferAttribute(g, 1));
  return geo;
}

/** Layer used for objects that cast shadows (rendered in the sun depth pass). */
export const SHADOW_LAYER = 1;
