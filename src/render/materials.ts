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
  uShadowOn: { value: 0 },
  uFog: { value: new THREE.Vector4(config.fog.density, config.fog.heightFalloff, config.fog.farFull, 1) },
  uFogBank: { value: 1 },
  uPaintFog: { value: null as THREE.Texture | null }, // r = paint density, sampled over uPaintFogRect
  uPaintFogRect: { value: new THREE.Vector4(0, 0, 1, 1) }, // minX, minZ, 1/width, 1/depth
  uPaintClearing: { value: config.fog.paintClearing },
  uGroundRef: { value: 0 }, // sea-level-ish reference for height fog
};

export const GLSL_COMMON = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uLight;            // x sun strength, y ambient, z sky bounce
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform vec4 uFog;              // density, heightFalloff, farFull, unused
uniform float uFogBank;
uniform sampler2D uPaintFog;
uniform vec4 uPaintFogRect;
uniform float uPaintClearing;
uniform float uGroundRef;

float sbShadow(vec3 worldPos, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec3 p = worldPos + n * 0.35;
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  vec3 uvz = sc.xyz / sc.w;
  if (uvz.x <= 0.002 || uvz.x >= 0.998 || uvz.y <= 0.002 || uvz.y >= 0.998 || uvz.z >= 1.0) return 1.0;
  float s = texture(uShadowMap, vec3(uvz.xy, uvz.z - 0.0009));
  // fade shadows out near the edge of the shadow map so the boundary never pops
  vec2 e = min(uvz.xy, 1.0 - uvz.xy);
  float edge = smoothstep(0.0, 0.08, min(e.x, e.y));
  return mix(1.0, s, edge);
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
  return clamp(max(f, far), 0.0, 1.0);
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
