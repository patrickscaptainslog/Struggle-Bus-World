import * as THREE from 'three';
import { globals, GLSL_COMMON, GLSL_OUT, SHADOW_LAYER } from '../render/materials';
import { GLSL_FACTION } from '../render/factionLook';
import { registerWarm } from '../render/warmup';
import { DEPTH_FS } from './props/common';
import { liftUniforms, paintUniforms } from './buildingMaterial';
import { GLSL_LIFT } from './liftGlsl';
import type { BuildingRef } from './City';

// What the Lift draws besides the houses themselves (docs/specs/factions/LIFT.md, "What's drawn"), two draws in all: the undersides (one mesh of
// every liftable footprint, facing down, shown once its house is up) and the geysers (one InstancedMesh: a rainbow jet from a pool to each belly,
// a crown of foam under it). And the depth material a floating house's shadow is drawn with. Everything here moves in its vertex shader from the
// same tLift as the houses (liftGlsl.ts): the CPU writes these buffers only when a tile arrives or a house is scheduled.

const PAINT_READ = /* glsl */ `
precision highp sampler2D;
uniform sampler2D uPaint;
uniform float uPaintW;
${GLSL_FACTION}
/** the house's faction and its hue slot, from its paint texel */
void sbOwner(float idx, out int fac, out float hue) {
  vec4 pt = texelFetch(uPaint, ivec2(int(mod(idx, uPaintW)), int(floor(idx / uPaintW))), 0);
  fac = sbFac(pt.a > 7.5 ? pt.a - 8.0 : pt.a);
  hue = floor(pt.r + 0.5);
}
float sbSlot(float h) { return mod(h + 60.0, 6.0); }
`;

const uniforms = () => ({ ...globals, ...(liftUniforms ?? {}), uPaint: paintUniforms.uPaint, uPaintW: paintUniforms.uPaintW });

// ---------------------------------------------------------------- the undersides

export function makeCapMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: uniforms(),
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${GLSL_COMMON}
      ${GLSL_LIFT}
      in vec4 aCap; // building index, the jet's x and z, its radius
      out vec3 vWorldPos;
      flat out vec4 vCap;
      void main() {
        vec2 lf = sbLift(aCap.x, aCap.yz);
        if (lf.x < 0.05) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        vec3 p = position;
        p.xz = aCap.yz + (p.xz - aCap.yz) / sqrt(max(1.0 + lf.y, 0.4));
        p.y += lf.x;
        vWorldPos = p;
        vCap = aCap;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${PAINT_READ}
      in vec3 vWorldPos;
      flat in vec4 vCap;
      ${GLSL_OUT}
      void main() {
        int fac; float hue;
        sbOwner(vCap.x, fac, hue);
        vec2 d2 = vWorldPos.xz - vCap.yz;
        float d = length(d2) / max(vCap.w, 0.5);
        // the belly in its own body colour, lit from below by its paint toward the jet
        float ramp = sbFacHue(fac, int(sbSlot(hue)), true);
        float light = 0.3 + 0.12 * (1.0 - smoothstep(1.2, 6.0, d));
        float glow = 0.0;
        if (d < 2.4) {
          // the foam ring where the jet meets the house, turning, with gold flecks
          float a = atan(d2.y, d2.x) / 6.2832 + 0.5;
          float k = floor(a * 14.0 + uTime * 1.6);
          ramp = fract(sin(k * 12.9898 + vCap.x) * 43758.5453) > 0.78 ? sbFacGold(fac) : sbFacTrim(fac);
          light = d < 1.15 ? 0.62 : 0.74;
          glow = 0.3;
        }
        float fog = sbFog(vWorldPos);
        sbWrite(ramp, light, fog, glow, mat3(viewMatrix) * vec3(0.0, -1.0, 0.0), fract(vCap.x * 0.618 + 0.37), 1.0);
      }
    `,
  });
}

/** The jet under a house: where it stands (inside its footprint) and how wide. */
export interface Jet {
  x: number;
  z: number;
  r: number;
}

/** Every liftable house's tier-0 rings, triangulated at the walls' own foot, facing down: one mesh. */
export function makeCapGeometry(refs: Iterable<BuildingRef>, jetOf: (ref: BuildingRef) => Jet): THREE.BufferGeometry {
  const pos: number[] = [], cap: number[] = [], index: number[] = [];
  const contour: THREE.Vector2[] = [];
  for (const ref of refs) {
    const b = ref.tile, jet = jetOf(ref);
    for (let k = ref.local; k < ref.local + ref.parts; k++) {
      if (b.tier[k] !== 0) continue;
      const s = b.vertStart[k], e = b.vertStart[k + 1];
      if (e - s < 3) continue;
      contour.length = 0;
      for (let v = s; v < e; v++) contour.push(new THREE.Vector2(b.xz[v * 2], b.xz[v * 2 + 1]));
      const faces = THREE.ShapeUtils.triangulateShape(contour, []);
      const o = pos.length / 3;
      for (let v = s; v < e; v++) {
        pos.push(b.xz[v * 2], b.baseY[k] + 0.02, b.xz[v * 2 + 1]);
        cap.push(ref.index, jet.x, jet.z, jet.r);
      }
      for (const f of faces) index.push(o + f[0], o + f[2], o + f[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCap', new THREE.Float32BufferAttribute(cap, 4));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  return g;
}

// ---------------------------------------------------------------- the geysers

const SIDES = 6;
const RINGS = 5;

/** One geyser at unit size: a column (part 0, y 0..1), the crown under the belly (1) and the foot on the lake (2). 72 triangles. */
function geyserGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], part: number[] = [], index: number[] = [];
  const ring = (y: number, p: number) => {
    const o = pos.length / 3;
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2;
      pos.push(Math.cos(a), y, Math.sin(a));
      part.push(p);
    }
    return o;
  };
  const band = (a: number, b: number) => {
    for (let i = 0; i < SIDES; i++) {
      const j = (i + 1) % SIDES;
      index.push(a + i, b + i, a + j, a + j, b + i, b + j);
    }
  };
  let prev = ring(0, 0);
  for (let r = 1; r < RINGS; r++) {
    const cur = ring(r / (RINGS - 1), 0);
    band(prev, cur);
    prev = cur;
  }
  band(ring(0, 1), ring(1, 1));
  band(ring(0, 2), ring(1, 2));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(index);
  return g;
}

export function makeGeyserMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: uniforms(),
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${GLSL_COMMON}
      ${GLSL_LIFT}
      in float aPart;
      in vec3 aGey; // building index, the jet's radius, the house's foot over the jet's ground
      out vec3 vWorldPos;
      out vec2 vDir;
      out float vY;
      flat out vec2 vGey;
      flat out float vPart;
      void main() {
        vec3 base = instanceMatrix[3].xyz;
        vec4 L = sbLiftTexel(aGey.x);
        vec2 lf = sbLift(aGey.x, base.xz);
        float r = aGey.y;
        float top = aGey.z + lf.x;
        // (and a jet the lens flies beside, up among the houses: the low shot never looks through a column filling half the frame; one from the street stays)
        bool hide = L.y <= 0.0 || uTime < L.x || (distance(cameraPosition.xz, base.xz) < 28.0 && cameraPosition.y > base.y + 8.0);
        vec3 p = vec3(0.0);
        float ph = aGey.x * 1.7;
        if (aPart < 0.5) {
          // the jet, all of its height, its waist wobbling as it pumps
          hide = hide || top < 0.3;
          float y = position.y * max(top, 0.0);
          float wob = 1.0 + 0.12 * sin(0.6 * y + 7.0 * uTime + ph) + 0.25 * (1.0 - smoothstep(0.0, 3.0, y));
          p = vec3(position.x * r * wob, y, position.z * r * wob);
        } else if (aPart < 1.5) {
          // the crown: it fans out under the belly
          hide = hide || top < 0.3;
          float rr = mix(r * 1.1, r * 2.2, position.y) * (1.0 + 0.08 * sin(9.0 * uTime + ph + position.x * 3.0));
          p = vec3(position.x * rr, top - mix(2.6, 0.08, position.y), position.z * rr);
        } else {
          // the foot on the lake: in the crouch the ground erupts first
          float k = lf.x < 0.0 ? clamp(-lf.x / 0.35, 0.0, 1.0) : 1.0;
          float rr = mix(r, r * 2.6, position.y) * k;
          p = vec3(position.x * rr, mix(0.7, 0.12, position.y), position.z * rr);
        }
        if (hide) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        vec3 wp = base + p;
        vWorldPos = wp;
        vDir = position.xz;
        vY = p.y;
        vGey = aGey.xy;
        vPart = aPart;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${PAINT_READ}
      in vec3 vWorldPos;
      in vec2 vDir;
      in float vY;
      flat in vec2 vGey;
      flat in float vPart;
      ${GLSL_OUT}
      void main() {
        int fac; float hue;
        sbOwner(vGey.x, fac, hue);
        float a = atan(vDir.y, vDir.x) / 6.2832 + 0.5;
        float face = floor(a * ${SIDES}.0);
        vec3 n = normalize(vec3(vDir.x, 0.0, vDir.y));
        float ramp, light, glow;
        if (vPart < 0.5) {
          // the faction's hues spiralling up the jet: paint, the saturated thing
          // (every fourth band foam in the faction's trim: it reads as water rushing up, not a painted post)
          float band = floor(vY / 2.2 - 3.0 * uTime + face * 0.5);
          bool foam = mod(band, 4.0) < 0.5;
          ramp = foam ? sbFacTrim(fac) : sbFacHue(fac, int(sbSlot(hue + band)), true);
          light = (foam ? 0.84 : 0.7) + 0.08 * dot(n, uSunDir);
          glow = 0.35;
        } else {
          float k = floor(a * 16.0 + uTime * 3.0);
          ramp = fract(sin(k * 12.9898 + vGey.x * 0.37) * 43758.5453) > 0.8 ? sbFacGold(fac) : sbFacTrim(fac);
          light = 0.78;
          glow = 0.3;
        }
        float fog = sbFog(vWorldPos);
        sbWrite(ramp, light, fog, glow, mat3(viewMatrix) * n, fract(vGey.x * 0.618 + 0.71), 1.0);
      }
    `,
  });
}

/** The geysers: one InstancedMesh of `cap` slots, every slot hidden until its house is scheduled (Lift.ts writes its matrix and aGey). */
export function makeGeysers(cap: number, material = makeGeyserMaterial()): THREE.InstancedMesh {
  const g = geyserGeometry();
  const gey = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(-1), 3);
  gey.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aGey', gey);
  const mesh = new THREE.InstancedMesh(g, material, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- floating shadows

/** The sun pass's material for a building mesh under the neighbourhood (City.liftShadow): its houses where they float. Positions and aBld only. */
export function makeLiftDepthMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uTime: globals.uTime, ...(liftUniforms ?? {}) },
    vertexShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      ${GLSL_LIFT}
      in vec4 aBld;
      void main() {
        vec3 p = position;
        vec2 lf = sbLift(aBld.x, vec2(aBld.y, aBld.w));
        p.y = aBld.z + (p.y - aBld.z) * (1.0 + lf.y) + lf.x;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: DEPTH_FS,
  });
  m.allowOverride = false;
  return m;
}

/** Shader warm-up (render/warmup.ts): the caps, the geysers and a building mesh's shadow twin, in the layouts they draw with. */
export function registerLiftWarm(depth: THREE.Material) {
  registerWarm('lift', () => {
    const v = 3;
    const capGeo = new THREE.BufferGeometry();
    capGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(v * 3), 3));
    capGeo.setAttribute('aCap', new THREE.Float32BufferAttribute(new Float32Array(v * 4), 4));
    capGeo.setIndex(new THREE.Uint16BufferAttribute([0, 1, 2], 1));
    const caps = new THREE.Mesh(capGeo, makeCapMaterial());
    const gey = makeGeysers(1);
    gey.count = 1;
    // (the twin's layout is a building mesh's: City.ts buildingMesh)
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(v * 3), 3, true));
    g.setAttribute('aFacade', new THREE.BufferAttribute(new Float32Array(v * 2), 2));
    g.setAttribute('aMeta', new THREE.BufferAttribute(new Uint8Array(v * 4), 4));
    g.setAttribute('aBld', new THREE.BufferAttribute(new Float32Array(v * 4), 4));
    g.setAttribute('aBld2', new THREE.BufferAttribute(new Float32Array(v * 2), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    const twin = new THREE.Mesh(g, depth);
    twin.layers.set(SHADOW_LAYER);
    return [caps, gey, twin];
  });
}
