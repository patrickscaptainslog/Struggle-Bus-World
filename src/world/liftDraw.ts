import * as THREE from 'three';
import { globals, GLSL_COMMON, GLSL_OUT, SHADOW_LAYER } from '../render/materials';
import { GLSL_FACTION } from '../render/factionLook';
import { Ramp } from '../render/palette';
import { FACTION_ATLANTIS, FACTION_ELDERWOOD, FACTION_HYPERGLOW, FACTION_INFERNO } from '../game/factions';
import { registerWarm } from '../render/warmup';
import { DEPTH_FS } from './props/common';
import { liftUniforms, paintUniforms } from './buildingMaterial';
import { GLSL_LIFT, LIFT_TURN } from './liftGlsl';
import type { BuildingRef } from './City';

// What the Lift draws besides the houses themselves (docs/specs/factions/LIFT.md, "What's drawn"), one draw: the undersides (one mesh of every
// liftable footprint, facing down, shown once its house is up, lit from below by the lake of paint, paint dripping off its edges). Nothing joins
// a house to the ground: it floats. And the depth material a floating house's shadow is drawn with. Everything here moves in its vertex shader
// from the same tLift as the houses (liftGlsl.ts): the CPU writes these buffers only when a tile arrives.

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

const R = (r: number) => r.toFixed(1);

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
      ${PAINT_READ}
      in vec4 aCap; // building index, its centre's x and z, its reach from it
      in vec3 aDrip; // a drip off the belly's edge: its length (m, at its tip; 0 elsewhere), its outward x and z (0, 0: the belly)
      out vec3 vWorldPos;
      flat out vec4 vCap;
      flat out vec3 vDrip;
      flat out float vUp;
      void main() {
        vec4 T2;
        vec4 lf = sbLift(aCap.x, aCap.yz, T2);
        if (lf.x < 0.05) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        vec3 p = position;
        // (the paint drips off the edge: it stretches and gives as the house rides the swell, longer as it settles)
        float k = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
        // (by its owner: water's a little longer, the Elderwood's are roots, swaying, Hyperglow's short beads of light, Inferno's molten and long;
        // the other four's never more than 35 % of the way to the ground, so a low house in the swell's trough, leaning, keeps them off it)
        int dfac; float dhue;
        sbOwner(aCap.x, dfac, dhue);
        float dl = aDrip.x * (dfac == ${FACTION_ATLANTIS} ? 1.3 : dfac == ${FACTION_ELDERWOOD} ? 4.5 : dfac == ${FACTION_HYPERGLOW} ? 0.5 : dfac == ${FACTION_INFERNO} ? 1.7 : 1.0);
        if (dfac == ${FACTION_ATLANTIS} || dfac == ${FACTION_ELDERWOOD} || dfac == ${FACTION_HYPERGLOW} || dfac == ${FACTION_INFERNO}) dl = min(dl, 0.35 * lf.x);
        if (dfac == ${FACTION_ELDERWOOD}) p.xz += aDrip.yz * (aDrip.x > 0.0 ? 0.6 * sin(1.3 * uTime + 6.2832 * k) : 0.0);
        p.y -= dl * smoothstep(0.0, 1.6, uTime - sbLiftTexel(aCap.x).x) * (0.82 + 0.18 * sin(2.1 * uTime + 6.2832 * k));
        p = sbLiftMove(p, position.y, lf, T2);
        vWorldPos = p;
        vCap = aCap;
        vDrip = aDrip;
        vUp = lf.x;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${PAINT_READ}
      in vec3 vWorldPos;
      flat in vec4 vCap;
      flat in vec3 vDrip;
      flat in float vUp;
      ${GLSL_OUT}
      void main() {
        int fac; float hue;
        sbOwner(vCap.x, fac, hue);
        float body = sbFacHue(fac, int(sbSlot(hue)), true);
        float fog = sbFog(vWorldPos);
        // the lake's light from under it: the nearer the water, the brighter (a low house glows, a high flyer is a dark shape against the sky)
        float near = 1.0 - smoothstep(8.0, 70.0, vUp);
        if (dot(vDrip.yz, vDrip.yz) > 0.01) {
          // a drip: the house's paint, a little lit, and rim-lit where it faces the sun (at golden hour the bellies' sun-facing edges catch it)
          float rim = max(0.0, dot(normalize(vec3(vDrip.y, 0.0, vDrip.z)), uSunDir));
          // (the other four: a root's lime glow, a bead of cyan light, a molten drop)
          if (fac == ${FACTION_ELDERWOOD}) { sbWrite(${R(Ramp.MOSS)}, 0.72 + 0.1 * rim, fog, 0.45, mat3(viewMatrix) * vec3(vDrip.y, 0.0, vDrip.z), fract(vCap.x * 0.618 + 0.37), 1.0); return; }
          if (fac == ${FACTION_HYPERGLOW}) { sbWrite(${R(Ramp.CYAN)}, 0.86, fog, 0.7, mat3(viewMatrix) * vec3(vDrip.y, 0.0, vDrip.z), fract(vCap.x * 0.618 + 0.37), 0.5); return; }
          if (fac == ${FACTION_INFERNO}) { sbWrite(${R(Ramp.CRIMSON)}, 0.74, fog, 0.7, mat3(viewMatrix) * vec3(vDrip.y, 0.0, vDrip.z), fract(vCap.x * 0.618 + 0.37), 0.5); return; }
          sbWrite(body, 0.5 + 0.22 * rim + 0.06 * near, fog, 0.1 + 0.2 * rim, mat3(viewMatrix) * vec3(vDrip.y, 0.0, vDrip.z), fract(vCap.x * 0.618 + 0.37), 1.0);
          return;
        }
        // caustics: the lake's ripples throw a net of light up on to the belly, wandering over it as the water moves (two warped waves: their
        // sum's zeros are the net's lines), in the paint below's colours (the house's hue a step on, and its trim where they cross): the belly
        // answers the lake. Brighter the nearer the water; a high flyer's is fainter, never gone
        vec2 q = vWorldPos.xz * 0.8;
        float c1 = sin(q.x + 1.7 * sin(q.y * 0.71 + uTime * 0.9) + uTime * 1.1);
        float c2 = sin(q.y * 1.13 + 1.6 * sin(q.x * 0.83 - uTime * 0.8) - uTime * 0.95);
        float e = abs(c1 + c2);
        float ramp = body;
        float light = 0.38 + 0.08 * near;
        float glow = 0.05 + 0.08 * near;
        if (e < 0.16) {
          // the net's bright lines: the lake's paint thrown up, its trim where two cross
          ramp = abs(c1 - c2) < 0.5 ? sbFacTrim(fac) : sbFacHue(fac, int(sbSlot(hue + 1.0)), true);
          light = 0.52 + 0.16 * near;
          glow = 0.15 + 0.2 * near;
        } else if (e < 0.5) {
          // and a softer step round them
          light += 0.08 + 0.06 * near;
          glow += 0.05;
        }
        if (fac == ${FACTION_ELDERWOOD}) {
          // a mossy belly, the net of light the lake's roots throw up on it lime
          ramp = ${R(Ramp.MOSS)};
          light = e < 0.16 ? 0.7 + 0.12 * near : 0.24 + 0.06 * near;
          glow = e < 0.16 ? 0.4 : 0.04;
        } else if (fac == ${FACTION_HYPERGLOW}) {
          // dark chrome, a circuit: ruled in the mirror's cyan grid, a magenta pad in each square, and on every beat a pulse of white running out
          // along it from the middle (not a disc of magenta: from under them they read as stickers)
          vec2 gq = abs(fract(vWorldPos.xz / 4.0) - 0.5);
          ramp = ${R(Ramp.CHROME)};
          light = 0.16 + 0.04 * near;
          glow = 0.05;
          float rr = length(vWorldPos.xz - vCap.yz) / max(vCap.w, 1.0);
          if (min(gq.x, gq.y) > 0.4) { ramp = ${R(Ramp.MAGENTA)}; light = 0.62 + 0.16 * near; glow = 0.45; }
          else if (min(gq.x, gq.y) < 0.05) {
            ramp = ${R(Ramp.CYAN)};
            light = 0.66;
            glow = 0.45;
            if (abs(rr - fract(uTime / ${LIFT_TURN.beat.toFixed(3)}) * 1.2) < 0.06) { ramp = ${R(Ramp.CHROME)}; light = 0.96; glow = 0.85; }
          }
        } else if (fac == ${FACTION_INFERNO}) {
          // black glass lit from the fire under it: crimson, flickering, the net of the lake's cracks molten scarlet
          float fl = 0.5 + 0.5 * sin(uTime * 7.0 + vCap.x) * sin(uTime * 3.1);
          ramp = ${R(Ramp.CRIMSON)};
          light = e < 0.16 ? 0.72 : 0.36 + 0.14 * near + 0.08 * fl;
          glow = e < 0.16 ? 0.6 : 0.2 + 0.15 * near;
        }
        sbWrite(ramp, light, fog, glow, mat3(viewMatrix) * vec3(0.0, -1.0, 0.0), fract(vCap.x * 0.618 + 0.37), 1.0);
      }
    `,
  });
}

/** A house's centre (inside its footprint or not) and its reach from it (m): the swell under it, the lake's rings and the drips run from it. */
export interface Centre {
  x: number;
  z: number;
  r: number;
}

/** one drip a this many m of a belly's edge (3 m was 9k of the undersides' 11k triangles: 4 m reads the same from under them, and gives the 250 m view 2k back) */
const DRIP_EVERY = 4;

/**
 * Every liftable house's tier-0 rings, triangulated at the walls' own foot, facing down: one mesh. And round each ring's edge a fringe of paint
 * drips, one thin triangle each 4 m, 0.5 to 2.6 m long by a hash.
 */
export function makeCapGeometry(refs: Iterable<BuildingRef>, centreOf: (ref: BuildingRef) => Centre): THREE.BufferGeometry {
  const pos: number[] = [], cap: number[] = [], drip: number[] = [], index: number[] = [];
  const contour: THREE.Vector2[] = [];
  const vert = (x: number, y: number, z: number, i: number, ctr: Centre, len: number, ox: number, oz: number) => {
    pos.push(x, y, z);
    cap.push(i, ctr.x, ctr.z, ctr.r);
    drip.push(len, ox, oz);
    return pos.length / 3 - 1;
  };
  for (const ref of refs) {
    const b = ref.tile, ctr = centreOf(ref);
    for (let k = ref.local; k < ref.local + ref.parts; k++) {
      if (b.tier[k] !== 0) continue;
      const s = b.vertStart[k], e = b.vertStart[k + 1];
      if (e - s < 3) continue;
      contour.length = 0;
      for (let v = s; v < e; v++) contour.push(new THREE.Vector2(b.xz[v * 2], b.xz[v * 2 + 1]));
      const faces = THREE.ShapeUtils.triangulateShape(contour, []);
      const y = b.baseY[k] + 0.02;
      const o = pos.length / 3;
      for (let v = s; v < e; v++) vert(b.xz[v * 2], y, b.xz[v * 2 + 1], ref.index, ctr, 0, 0, 0);
      for (const f of faces) index.push(o + f[0], o + f[2], o + f[1]);
      // the drips: outward is away from the centre, near enough for a light's rim
      for (let v = s, w = e - 1; v < e; w = v++) {
        const ax = b.xz[w * 2], az = b.xz[w * 2 + 1], bx = b.xz[v * 2], bz = b.xz[v * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.floor(len / DRIP_EVERY);
        for (let q = 0; q < n; q++) {
          const t0 = (q + 0.4) / n, t1 = (q + 0.6) / n, tm = (q + 0.5) / n;
          const mx = ax + (bx - ax) * tm, mz = az + (bz - az) * tm;
          let ox = mx - ctr.x, oz = mz - ctr.z;
          const ol = Math.hypot(ox, oz) || 1;
          ox /= ol;
          oz /= ol;
          const h = Math.sin(mx * 12.9898 + mz * 78.233) * 43758.5453;
          const L = 0.5 + 2.1 * (h - Math.floor(h)) ** 2;
          const i0 = vert(ax + (bx - ax) * t0, y, az + (bz - az) * t0, ref.index, ctr, 0, ox, oz);
          const i1 = vert(ax + (bx - ax) * t1, y, az + (bz - az) * t1, ref.index, ctr, 0, ox, oz);
          const i2 = vert(mx + ox * 0.08, y, mz + oz * 0.08, ref.index, ctr, L, ox, oz);
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
        vec4 T2;
        vec4 lf = sbLift(aBld.x, vec2(aBld.y, aBld.w), T2);
        p = sbLiftMove(p, aBld.z, lf, T2);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: DEPTH_FS,
  });
  m.allowOverride = false;
  return m;
}

/** Shader warm-up (render/warmup.ts): the undersides and a building mesh's shadow twin, in the layouts they draw with. */
export function registerLiftWarm(depth: THREE.Material) {
  registerWarm('lift', () => {
    const v = 3;
    const capGeo = new THREE.BufferGeometry();
    capGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(v * 3), 3));
    capGeo.setAttribute('aCap', new THREE.Float32BufferAttribute(new Float32Array(v * 4), 4));
    capGeo.setAttribute('aDrip', new THREE.Float32BufferAttribute(new Float32Array(v * 3), 3));
    capGeo.setIndex(new THREE.Uint16BufferAttribute([0, 1, 2], 1));
    const caps = new THREE.Mesh(capGeo, makeCapMaterial());
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
    return [caps, twin];
  });
}
