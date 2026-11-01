import * as THREE from 'three';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { Ramp } from '../render/palette';
import { heldHour, heldOr } from '../sky/flag';
import { Ground, WATER_Y } from './tiles';
import { blastUniforms, GLSL_BLAST_RING, GLSL_GROUND_PAINT } from './GroundPaint';

// Ground: asphalt streets, lighter sidewalks, grey lawns, still water; with OpenStreetMap also pale
// plazas and park paths, darker woods and garden yards, warm pale sand, dark rail beds, light rock.
// The 2 m class texture is resolved with smooth per-class masks so street
// edges are clean diagonals instead of 2 m stair steps.
// Blasts splatter it (GroundPaint: a per-tile mask, organic edges, spatter
// dots) and the shockwave ring races across it.

/**
 * Water, one function of the world position: the open plane and the ground's water pixels (a canal, a lake, a shore held
 * over the plane: see SHORE_FLOOR) write the same bytes, so nothing shows where one hands over to the other. `wp` is where the
 * water is, `surface` the fragment's own position, for the sun: a mesh on the slope up to a quay must not shade itself. Needs GLSL_OUT.
 * It reflects the fog at grazing angles: in fog the bay mirrors the bright overcast, brightens toward the horizon and melts
 * into the fog bank instead of lying under it as a dark slab. Static swell crests run north-south (the Pacific rolls in
 * through the Golden Gate): short sparse dashes, a step brighter.
 */
export const GLSL_WATER = /* glsl */ `
  float sbWaterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void sbWater(vec3 wp, vec3 surface) {
    vec3 v = normalize(cameraPosition - wp);
    float fres = pow(1.0 - abs(v.y), 4.0);
    float light = 0.3 + 0.66 * fres;
    vec2 q = vec2(wp.z / 9.0, wp.x / 2.6);
    vec2 iq = floor(q);
    float row = sbWaterHash(vec2(iq.y, 3.1));
    float dash = sbWaterHash(vec2(floor(q.x + row * 7.0), iq.y));
    if (dash > 0.9 && fract(q.y) < 0.45) light += ${heldOr('0.12 * min(uLight.x / 0.52, 1.0)', '0.12')};
    float sh = sbShadow(surface, vec3(0.0, 1.0, 0.0));
    light -= (1.0 - sh) * 0.06;
    float fog = sbFog(wp);
    sbWrite(${Ramp.WATER}.0, light, fog, 0.0, mat3(viewMatrix) * vec3(0.0, 1.0, 0.0), 0.02, 0.5);
  }
`;

const VS = /* glsl */ `
  ${GLSL_COMMON}
  uniform vec4 uTileRect; // originX, originZ, 1/size, 0
  out vec3 vWorldPos;
  out vec3 vWorldNormal;
  out vec3 vViewNormal;
  out vec2 vClassUv;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
    vClassUv = (wp.xz - uTileRect.xy) * uTileRect.z;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FS = /* glsl */ `
  ${GLSL_COMMON}
  precision highp usampler2D;
  uniform sampler2D tClass;
  uniform float uClassN;
  uniform float uLift;
  ${GLSL_GROUND_PAINT}
  ${GLSL_BLAST_RING}
  in vec3 vWorldPos;
  in vec3 vWorldNormal;
  in vec3 vViewNormal;
  in vec2 vClassUv;
  ${GLSL_OUT}
  ${GLSL_WATER}
  float cls(ivec2 p) {
    p = clamp(p, ivec2(0), ivec2(int(uClassN) - 1));
    return floor(texelFetch(tClass, p, 0).r * 255.0 + 0.5);
  }
  void main() {
    // smooth class masks via manual bilinear on per-class indicators
    vec2 t = vClassUv * uClassN - 0.5;
    ivec2 i0 = ivec2(floor(t));
    vec2 f = fract(t);
    float c00 = cls(i0), c10 = cls(i0 + ivec2(1, 0)), c01 = cls(i0 + ivec2(0, 1)), c11 = cls(i0 + ivec2(1, 1));
    vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    float best = -1.0; float bc = 0.0;
    float bestLand = -1.0; float landC = 0.0;
    for (int k = 0; k < 4; k++) {
      float c = k == 0 ? c00 : k == 1 ? c10 : k == 2 ? c01 : c11;
      float m = (c00 == c ? w.x : 0.0) + (c10 == c ? w.y : 0.0) + (c01 == c ? w.z : 0.0) + (c11 == c ? w.w : 0.0);
      if (m > best) { best = m; bc = c; }
      if (c != ${Ground.WATER}.0 && m > bestLand) { bestLand = m; landC = c; }
    }
    // The shore. Between the nearest texels a quay at a shallow angle to the 2 m grid is a staircase (6 m runs, 2 m rises), and
    // water against land shows it as no other pair of classes does: there the water's share of the 10 m square around the
    // pixel decides (bilinear at its edges, so it slides with the pixel), a straight line through the stairs. The square's
    // first moment says it is a shore at all: water on one side of the pixel. A ring of pond or a footbridge has it on
    // both, and a share would erase it: the nearest texels keep those. Only pixels on a shore pay for this.
    if (bestLand > 0.0 && (c00 == ${Ground.WATER}.0 || c10 == ${Ground.WATER}.0 || c01 == ${Ground.WATER}.0 || c11 == ${Ground.WATER}.0)) {
      // (the texture ends at its tile: the square shrinks toward that edge, so the tiles on both sides of it agree)
      vec2 toEdge = min(t + 0.5, uClassN - 0.5 - t);
      float h = clamp(min(toEdge.x, toEdge.y), 0.5, 2.5);
      float sea = 0.0;
      vec2 side = vec2(0.0);
      for (int j = -2; j <= 3; j++) {
        float wj = clamp(min(float(j) + 0.5 - f.y + h, f.y + h - float(j) + 0.5), 0.0, 1.0);
        for (int i = -2; i <= 3; i++) {
          float a = wj * clamp(min(float(i) + 0.5 - f.x + h, f.x + h - float(i) + 0.5), 0.0, 1.0);
          if (a == 0.0 || cls(i0 + ivec2(i, j)) != ${Ground.WATER}.0) continue;
          sea += a;
          side += a * (vec2(float(i), float(j)) - f);
        }
      }
      // (a straight shore through the pixel: |side| = h^3; half of that keeps a strip of water or land under 3-4 m wide)
      float keep = 0.48 * h * h * h;
      if (dot(side, side) > keep * keep) {
        if (sea >= 2.0 * h * h) bc = ${Ground.WATER}.0;
        else { bc = landC; best = bestLand; }
      }
    }
    // (the class texture draws the shore; water takes no paint and no shockwave; the sea stands where the plane does, wherever
    // the mesh has it on the slope up to a quay, a lake at its own height)
    if (bc == ${Ground.WATER}.0) {
      sbWater(vec3(vWorldPos.x, vWorldPos.y < 4.0 ? ${WATER_Y.toFixed(1)} : vWorldPos.y, vWorldPos.z), vWorldPos);
      return;
    }
    float ramp = ${Ramp.GREY}.0;
    float lo = -0.1;
    if (bc == ${Ground.SIDEWALK}.0) { ramp = ${Ramp.GREY_LIGHT}.0; lo = -0.04; }
    else if (bc == ${Ground.GRASS}.0) { ramp = ${Ramp.GREEN_GREY}.0; lo = 0.02; }
    else if (bc == ${Ground.PLAZA}.0) { ramp = ${Ramp.GREY_LIGHT}.0; lo = 0.03; }
    else if (bc == ${Ground.PATH}.0) { ramp = ${Ramp.GREY_LIGHT}.0; lo = 0.0; }
    else if (bc == ${Ground.YARD}.0) { ramp = ${Ramp.GREEN_GREY}.0; lo = 0.0; }
    else if (bc == ${Ground.FOREST}.0) { ramp = ${Ramp.GREEN_GREY}.0; lo = -0.1; }
    else if (bc == ${Ground.SAND}.0) { ramp = ${heldHour ? Ramp.SAND : Ramp.SKY_WARM}.0; lo = -0.1; }
    else if (bc == ${Ground.RAIL}.0) { ramp = ${Ramp.ROOF_DARK}.0; lo = -0.04; }
    else if (bc == ${Ground.ROCK}.0) { ramp = ${Ramp.GREY}.0; lo = 0.06; }
    vec3 n = normalize(vWorldNormal);
    float light = sbLight(vWorldPos, n, lo + uLift, 1.0);
    // ground reads calmer than buildings: compress its sun/slope contrast (shadows stay crisp)
    float flatL = sbLight(vWorldPos, vec3(0.0, 1.0, 0.0), lo + uLift, 1.0);
    light = mix(light, flatL, 0.55);
    float glow = 0.0;
    float pr, pEdge, pWet, pFresh;
    // curbs (where two ground classes blend) stay grey through the paint: the street plan still reads
    if (best >= uGroundTone.z && sbGroundPaint(vWorldPos, vClassUv, pr, pEdge, pWet, pFresh)) {
      // figure / ground: paint on the ground sits a couple of steps below the
      // painted walls (houses stand out of their splat); sidewalks a step
      // lighter than the street so the blocks still read; warm hues keep their
      // lighter steps (orange's deep steps turn red, yellow's orange); a darker
      // rim outlines every splat, wet blotches catch the light
      ramp = pr;
      float clsLo = (bc == ${Ground.SIDEWALK}.0 || bc == ${Ground.PLAZA}.0 || bc == ${Ground.PATH}.0) ? uGroundTone.y
        : (bc == ${Ground.GRASS}.0 || bc == ${Ground.YARD}.0 || bc == ${Ground.FOREST}.0) ? uGroundTone.y * 0.5 : 0.0;
      light = max(0.11 + uGroundTone.x + flatL * 0.5 + clsLo, 0.28); // never near-black in shadow
      if (pr == ${Ramp.YELLOW}.0) light = max(light + 0.1, 0.6); // amber, never orange
      else if (pr == ${Ramp.ORANGE}.0) light = max(light + 0.05, 0.45); // vermillion, never brick
      if (pEdge < 0.07) light -= 0.11;
      else light += 0.1 * pWet;
      glow = 0.55 * pFresh;
      light = max(light, glow);
    }
    float rr, rl, rg;
    if (sbRing(vWorldPos, n, rr, rl, rg)) { ramp = rr; light = rl; glow = rg; }
    float fog = sbFog(vWorldPos);
    sbWrite(ramp, light, fog, glow, vViewNormal, 0.01, 1.0);
  }
`;

export function makeTerrainMaterial(
  classTex: THREE.Texture, originX: number, originZ: number, size: number, classN: number, lift = 0,
  ground?: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...globals,
      uBlastRing: blastUniforms.uBlastRing,
      uBlastRing2: blastUniforms.uBlastRing2,
      tGround: { value: null },
      uGroundOn: { value: 0 },
      uGroundLive: blastUniforms.uGroundLive,
      uGroundLive2: blastUniforms.uGroundLive2,
      uGroundTone: blastUniforms.uGroundTone,
      ...(ground ?? {}),
      tClass: { value: classTex },
      uClassN: { value: classN },
      uTileRect: { value: new THREE.Vector4(originX, originZ, 1 / size, 0) },
      uLift: { value: lift },
    },
    vertexShader: VS,
    fragmentShader: FS,
  });
}

/** Grid mesh from a height array (row-major z rows, x cols). `step` subsamples. */
export function makeHeightGrid(heights: Float32Array, n: number, cell: number, originX: number, originZ: number, step: number, yOffset = 0): THREE.BufferGeometry {
  const m = Math.floor((n - 1) / step) + 1;
  const pos = new Float32Array(m * m * 3);
  const nrm = new Float32Array(m * m * 3);
  const h = (ix: number, iz: number) => heights[Math.min(n - 1, Math.max(0, iz)) * n + Math.min(n - 1, Math.max(0, ix))];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const ix = i * step;
      const iz = j * step;
      const k = (j * m + i) * 3;
      pos[k] = originX + ix * cell;
      pos[k + 1] = h(ix, iz) + yOffset;
      pos[k + 2] = originZ + iz * cell;
      // wide-footprint slopes: the bare-earth DEM is bumpy, and every bump
      // would otherwise become a dithered smudge under a low sun
      const sp = Math.max(2, step * 2);
      const dx = (h(ix + sp, iz) - h(ix - sp, iz)) / (2 * sp * cell);
      const dz = (h(ix, iz + sp) - h(ix, iz - sp)) / (2 * sp * cell);
      const l = Math.hypot(dx, 1, dz);
      nrm[k] = -dx / l;
      nrm[k + 1] = 1 / l;
      nrm[k + 2] = -dz / l;
    }
  }
  const idx = new Uint32Array((m - 1) * (m - 1) * 6);
  let q = 0;
  for (let j = 0; j < m - 1; j++) {
    for (let i = 0; i < m - 1; i++) {
      const a = j * m + i;
      const b = a + 1;
      const c = a + m;
      const d = c + 1;
      // +Y facing with +Z south: (a, c, b) / (b, c, d)
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** The open water plane (GLSL_WATER). */
export function makeWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...globals },
    vertexShader: /* glsl */ `
      ${GLSL_COMMON}
      out vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      in vec3 vWorldPos;
      ${GLSL_OUT}
      ${GLSL_WATER}
      void main() {
        sbWater(vWorldPos, vWorldPos);
      }
    `,
  });
}
