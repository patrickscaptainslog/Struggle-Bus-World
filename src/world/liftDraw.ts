import * as THREE from 'three';
import { globals, GLSL_COMMON, GLSL_OUT, SHADOW_LAYER } from '../render/materials';
import { GLSL_FACTION } from '../render/factionLook';
import { registerWarm } from '../render/warmup';
import { DEPTH_FS } from './props/common';
import { liftUniforms, paintUniforms } from './buildingMaterial';
import { GLSL_LIFT } from './liftGlsl';
import type { BuildingRef } from './City';

// What the Lift draws besides the houses themselves (docs/specs/factions/LIFT.md, "What's drawn"), two draws in all: the undersides (one mesh of
// every liftable footprint, facing down, shown once its house is up, lit from below by its jet, paint dripping off its edges) and the geysers (one
// InstancedMesh: a round rainbow jet from a splash on the lake to each belly, a mushroom of foam under it). And the depth material a floating house's shadow is drawn with. Everything here moves in its vertex shader from the
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
      in vec3 aDrip; // a drip off the belly's edge: its length (m, at its tip; 0 elsewhere), its outward x and z (0, 0: the belly)
      out vec3 vWorldPos;
      flat out vec4 vCap;
      flat out vec3 vDrip;
      void main() {
        vec2 lf = sbLift(aCap.x, aCap.yz);
        if (lf.x < 0.05) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        vec3 p = position;
        p.xz = aCap.yz + (p.xz - aCap.yz) / sqrt(max(1.0 + lf.y, 0.4));
        p.y += lf.x;
        // (the paint drips off the edge: it stretches and gives as the house bobs, longer as it settles)
        float k = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
        p.y -= aDrip.x * smoothstep(0.0, 1.6, uTime - sbLiftTexel(aCap.x).x) * (0.82 + 0.18 * sin(2.1 * uTime + 6.2832 * k));
        vWorldPos = p;
        vCap = aCap;
        vDrip = aDrip;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${PAINT_READ}
      in vec3 vWorldPos;
      flat in vec4 vCap;
      flat in vec3 vDrip;
      ${GLSL_OUT}
      void main() {
        int fac; float hue;
        sbOwner(vCap.x, fac, hue);
        float body = sbFacHue(fac, int(sbSlot(hue)), true);
        float fog = sbFog(vWorldPos);
        if (dot(vDrip.yz, vDrip.yz) > 0.01) {
          // a drip: the house's paint, a little lit, and rim-lit where it faces the sun (at golden hour the bellies' sun-facing edges catch it)
          float rim = max(0.0, dot(normalize(vec3(vDrip.y, 0.0, vDrip.z)), uSunDir));
          sbWrite(body, 0.5 + 0.22 * rim, fog, 0.1 + 0.2 * rim, mat3(viewMatrix) * vec3(vDrip.y, 0.0, vDrip.z), fract(vCap.x * 0.618 + 0.37), 1.0);
          return;
        }
        vec2 d2 = vWorldPos.xz - vCap.yz;
        float dm = length(d2);
        float d = dm / max(vCap.w, 0.5);
        // the belly in its own body colour, lit from below by the jet's foam: brighter toward it, and caustics rippling out from it
        float ramp = body;
        float light = 0.42 + 0.24 * (1.0 - smoothstep(2.4, 9.0, d));
        float cr = fract(dm * 0.38 - uTime * 0.85);
        if (cr < 0.14) light += 0.12 * (1.0 - smoothstep(4.0, 16.0, dm));
        float glow = 0.12 * (1.0 - smoothstep(2.4, 9.0, d));
        if (d < 2.4) {
          // the foam ring where the jet meets the house, turning, with gold flecks
          float a = atan(d2.y, d2.x) / 6.2832 + 0.5;
          float k = floor(a * 14.0 + uTime * 1.6);
          ramp = fract(sin(k * 12.9898 + vCap.x) * 43758.5453) > 0.78 ? sbFacGold(fac) : sbFacTrim(fac);
          light = d < 1.15 ? 0.66 : 0.8;
          glow = 0.35;
        } else if (d < 4.2) {
          // a halo of gold round it: the foam's light on the paint
          ramp = sbFacGold(fac);
          light = 0.62 - 0.1 * (d - 2.4);
          glow = 0.25;
        }
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

/** one drip a this many m of a belly's edge */
const DRIP_EVERY = 3;

/**
 * Every liftable house's tier-0 rings, triangulated at the walls' own foot, facing down: one mesh. And round each ring's edge a fringe of paint
 * drips, one thin triangle each 3 m, 0.5 to 2.6 m long by a hash.
 */
export function makeCapGeometry(refs: Iterable<BuildingRef>, jetOf: (ref: BuildingRef) => Jet): THREE.BufferGeometry {
  const pos: number[] = [], cap: number[] = [], drip: number[] = [], index: number[] = [];
  const contour: THREE.Vector2[] = [];
  const vert = (x: number, y: number, z: number, i: number, jet: Jet, len: number, ox: number, oz: number) => {
    pos.push(x, y, z);
    cap.push(i, jet.x, jet.z, jet.r);
    drip.push(len, ox, oz);
    return pos.length / 3 - 1;
  };
  for (const ref of refs) {
    const b = ref.tile, jet = jetOf(ref);
    for (let k = ref.local; k < ref.local + ref.parts; k++) {
      if (b.tier[k] !== 0) continue;
      const s = b.vertStart[k], e = b.vertStart[k + 1];
      if (e - s < 3) continue;
      contour.length = 0;
      for (let v = s; v < e; v++) contour.push(new THREE.Vector2(b.xz[v * 2], b.xz[v * 2 + 1]));
      const faces = THREE.ShapeUtils.triangulateShape(contour, []);
      const y = b.baseY[k] + 0.02;
      const o = pos.length / 3;
      for (let v = s; v < e; v++) vert(b.xz[v * 2], y, b.xz[v * 2 + 1], ref.index, jet, 0, 0, 0);
      for (const f of faces) index.push(o + f[0], o + f[2], o + f[1]);
      // the drips: outward is away from the jet, near enough for a light's rim
      for (let v = s, w = e - 1; v < e; w = v++) {
        const ax = b.xz[w * 2], az = b.xz[w * 2 + 1], bx = b.xz[v * 2], bz = b.xz[v * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.floor(len / DRIP_EVERY);
        for (let q = 0; q < n; q++) {
          const t0 = (q + 0.4) / n, t1 = (q + 0.6) / n, tm = (q + 0.5) / n;
          const mx = ax + (bx - ax) * tm, mz = az + (bz - az) * tm;
          let ox = mx - jet.x, oz = mz - jet.z;
          const ol = Math.hypot(ox, oz) || 1;
          ox /= ol;
          oz /= ol;
          const h = Math.sin(mx * 12.9898 + mz * 78.233) * 43758.5453;
          const L = 0.5 + 2.1 * (h - Math.floor(h)) ** 2;
          const i0 = vert(ax + (bx - ax) * t0, y, az + (bz - az) * t0, ref.index, jet, 0, ox, oz);
          const i1 = vert(ax + (bx - ax) * t1, y, az + (bz - az) * t1, ref.index, jet, 0, ox, oz);
          const i2 = vert(mx + ox * 0.08, y, mz + oz * 0.08, ref.index, jet, L, ox, oz);
          index.push(i0, i1, i2);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCap', new THREE.Float32BufferAttribute(cap, 4));
  g.setAttribute('aDrip', new THREE.Float32BufferAttribute(drip, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  return g;
}

// ---------------------------------------------------------------- the geysers

const SIDES = 6;

/**
 * One geyser at unit size, round (6 sides: 8 took the 250 m view 20k triangles further over the floor) and in three parts: the jet (part 0, y 0..1 of its height), the foam mushroom under the belly where it
 * hits and splashes out and down (1: y 0..1 from its foot to its lip), and the splash at its foot on the lake (2: a skirt, y 0..1, and a ring,
 * y 2..3, that runs out). 84 triangles.
 */
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
  const strip = (ys: number[], p: number) => {
    let prev = ring(ys[0], p);
    for (let r = 1; r < ys.length; r++) {
      const cur = ring(ys[r], p);
      band(prev, cur);
      prev = cur;
    }
  };
  strip([0, 0.5, 0.82, 1], 0);
  strip([0, 0.5, 1], 1);
  strip([0, 1], 2);
  strip([2, 3], 2);
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
        // the jet's width up its height: narrowest at the lake (0.8 of the house's jet radius), opening to 1.6 times that under the belly
        float rl = r * 0.8, rt = rl * 1.6;
        if (aPart < 0.5) {
          // the jet, all of its height, ripples running up it as it pumps
          hide = hide || top < 0.3;
          float y = position.y * max(top, 0.0);
          float w = rl * (1.0 + 0.6 * pow(position.y, 2.2)) * (1.0 + 0.12 * sin(0.9 * y - 11.0 * uTime + ph)) + 0.3 * rl * (1.0 - smoothstep(0.0, 2.5, y));
          p = vec3(position.x * w, y, position.z * w);
        } else if (aPart < 1.5) {
          // the foam mushroom: up the jet's top, out under the belly, and down at its lip, breathing
          hide = hide || top < 0.3;
          float br = 1.0 + 0.07 * sin(8.0 * uTime + ph + position.x * 3.0);
          float rr = (position.y < 0.25 ? rt : position.y < 0.75 ? rt * 1.3 : rt * 1.4) * br;
          float yy = position.y < 0.25 ? top - 2.2 : position.y < 0.75 ? top - 0.15 : top - 1.2;
          p = vec3(position.x * rr, yy, position.z * rr);
        } else {
          // the splash at its foot: in the crouch the ground erupts first; then a skirt of foam, and a ring that runs out with the bob's beat
          float k = lf.x < 0.0 ? clamp(-lf.x / 0.35, 0.0, 1.0) : 1.0;
          if (position.y < 1.5) {
            float rr = mix(r * 1.05, r * 2.0, position.y) * k;
            p = vec3(position.x * rr, mix(1.1, 0.12, position.y) * (0.8 + 0.2 * sin(5.0 * uTime + ph)), position.z * rr);
          } else {
            float run = fract(0.55 * uTime + fract(ph));
            float rr = r * (2.0 + 2.2 * run + 0.5 * (position.y - 2.0)) * k;
            hide = hide || run > 0.92;
            p = vec3(position.x * rr, 0.1, position.z * rr);
          }
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
        vec3 n = normalize(vec3(vDir.x, 0.0, vDir.y));
        float ramp, light, glow;
        if (vPart < 0.5) {
          // the faction's hues in one smooth spiral, rushing up the jet at 8 m/s: paint, the saturated thing
          // (every fourth band foam in the faction's trim: water, not a painted post. Twelve bands a turn, so the spiral meets itself)
          float band = floor((vY - 8.0 * uTime) / 2.4 + a * 12.0);
          bool foam = mod(band, 4.0) < 0.5;
          ramp = foam ? sbFacTrim(fac) : sbFacHue(fac, int(sbSlot(hue + band)), true);
          light = (foam ? 0.86 : 0.72) + 0.08 * dot(n, uSunDir);
          glow = foam ? 0.4 : 0.35;
        } else {
          float k = floor(a * 16.0 + uTime * 3.0 + vY * 0.7);
          ramp = fract(sin(k * 12.9898 + vGey.x * 0.37) * 43758.5453) > 0.82 ? sbFacGold(fac) : sbFacTrim(fac);
          light = 0.8 + 0.06 * dot(n, uSunDir);
          glow = 0.35;
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
    capGeo.setAttribute('aDrip', new THREE.Float32BufferAttribute(new Float32Array(v * 3), 3));
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
