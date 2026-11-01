import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { Ramp } from '../render/palette';
import { GLSL_WATER } from './terrainMaterial';
import { Ground, WATER_Y, type FarData, type FarRaster, type FarTowers } from './tiles';
import { Fam, Variant, styleFor } from './towerStyles';
import type { FarBlockChunk } from './farBlocks';

// The far ground drawn from the far raster (?farmap; tools/bake/farmap.py): every block of the city exists from the first frame, on the
// far mesh, with no light in the data. Class picks the ramp and is never blended; tone is the near shaders' lo, filtered, and the resolve
// quantises it to a step last; the sun is live, through sbLight, like every other surface.

/** The far flags (main.ts sets them from the URL before anything is built). All off by default, all additive. */
export const farFlags = {
  /** ?farmap: the far ground reads the raster */
  map: false,
  /** ?farmap=oblique: and its walls, what a grazing camera sees */
  oblique: false,
  /** ?farnearest: the class map with no mips, as the spike first specified it (crawl test) */
  nearest: false,
  /** ?farblocks: the raster's height plane as boxes */
  blocks: false,
  /** ?fardebug: the far ground writes its class as a ramp, a box 11 and 15 (tools/far/calib.py) */
  debug: false,
};

/** Classes past Ground's (tools/bake/farmap.py). */
const ROOF = 11;
const TREE = 12;
const ICE = 13;
const ROCK_BARE = 14;
/** The centre and span of lo a tone byte covers (on GREY_LIGHT), the same for a wall tone byte (on GREY): tools/bake/farmap.py. */
const TONE_C = -0.2;
const TONE_K = 1;
const WALL_LO = -0.09;
const WALL_K = 0.8;
/** How far the far mesh sinks under a loaded tile (m): well past where it can stand above the near ground. */
const LOADED_SINK = 40;
/** Levels of the class map: at 16 m a cell the coarsest is 256 m. */
const CLASS_LEVELS = 5;
/** Tone's anisotropy: the far band is seen at 5-10 degrees. */
const TONE_ANISOTROPY = 8;

/** class -> ramp: terrainMaterial's table, with ROOF and TREE. Class chooses the hue, nothing else (brightness is the raster's tone). */
const CLASS_RAMP: number[] = [];
CLASS_RAMP[Ground.PAVED] = Ramp.GREY;
CLASS_RAMP[Ground.GRASS] = Ramp.GREEN_GREY;
CLASS_RAMP[Ground.WATER] = Ramp.WATER;
CLASS_RAMP[Ground.SIDEWALK] = Ramp.GREY_LIGHT;
CLASS_RAMP[Ground.PLAZA] = Ramp.GREY_LIGHT;
CLASS_RAMP[Ground.PATH] = Ramp.GREY_LIGHT;
CLASS_RAMP[Ground.SAND] = Ramp.SKY_WARM;
CLASS_RAMP[Ground.RAIL] = Ramp.ROOF_DARK;
CLASS_RAMP[Ground.FOREST] = Ramp.GREEN_GREY;
CLASS_RAMP[Ground.YARD] = Ramp.GREEN_GREY;
CLASS_RAMP[Ground.ROCK] = Ramp.GREY;
CLASS_RAMP[ROOF] = Ramp.GREY_LIGHT;
CLASS_RAMP[TREE] = Ramp.GREEN_GREY;
CLASS_RAMP[ICE] = Ramp.WHITE;
CLASS_RAMP[ROCK_BARE] = Ramp.GREY;

/** Light a ramp needs over GREY_LIGHT's for the same brightness, measured on the palette across lights 0.4-0.7 (same table in farmap.py). */
const OVER = new Map<number, number>([[Ramp.GREY_LIGHT, 0], [Ramp.GREY, 0.22], [Ramp.GREEN_GREY, 0.33], [Ramp.ROOF_DARK, 0.45], [Ramp.SKY_WARM, -0.5], [Ramp.WATER, 0.27], [Ramp.WHITE, -0.3]]);

/**
 * What a class's tone needs to meet the tiles that replace it, a lo per class: fitted on the hold-still swaps of three poses (tools/far/calib.py), at the
 * game's own grazing view, not top down as SPIKE.md says, because the swap is seen at the grazing view and walls hide half of what a top-down frame
 * shows. Pre-light, nothing keyed to a sun. config.far.fit scales it.
 */
const CLASS_FIT: number[] = [];
CLASS_FIT[Ground.PAVED] = -0.05;
CLASS_FIT[Ground.GRASS] = -0.09;
CLASS_FIT[Ground.WATER] = 0;
CLASS_FIT[Ground.SIDEWALK] = -0.07;
CLASS_FIT[Ground.PLAZA] = -0.07;
CLASS_FIT[Ground.PATH] = -0.03;
CLASS_FIT[Ground.SAND] = 0;
CLASS_FIT[Ground.RAIL] = 0;
CLASS_FIT[Ground.FOREST] = -0.09;
CLASS_FIT[Ground.YARD] = -0.04;
CLASS_FIT[Ground.ROCK] = -0.03;
CLASS_FIT[ROOF] = -0.08;
CLASS_FIT[TREE] = -0.1;
CLASS_FIT[ICE] = 0;
CLASS_FIT[ROCK_BARE] = 0;
/** The same for a far box's roof and walls: a merged box shows more wall and less street than the houses it stands for, so together they read as too hard. */
const FIT_ROOF = -0.1;
const FIT_WALL = 0.08;

const glslFloats = (a: number[]) => a.map((v) => v.toFixed(3)).join(', ');
const CLASS_N = CLASS_RAMP.length;

const VS = /* glsl */ `
  ${GLSL_COMMON}
  precision highp sampler2D;
  uniform sampler2D uMask;
  uniform vec4 uMaskRect;
  uniform vec2 uMaskSize;
  uniform mat3 uFarUv;
  in float lightOffset;
  out vec3 vWorldPos;
  out vec3 vWorldNormal;
  out vec3 vViewNormal;
  out vec2 vUv;
  out float vWallLo;
  float sbTileLoaded(vec2 xz) {
    ivec2 mc = clamp(ivec2(floor((xz - uMaskRect.xy) * uMaskRect.z)), ivec2(0), ivec2(uMaskSize) - 1);
    return texelFetch(uMask, mc, 0).r;
  }
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // under a loaded tile the far mesh goes well below the near ground, or it pokes through it. A vertex on a tile's edge belongs to
    // all the tiles it touches, so nothing inside a loaded tile keeps a corner up. (0.9: FAR_STAND_INS' tiles hide their boxes with a
    // lower value, and have no near ground to stand under.)
    vec2 c = wp.xz;
    float m = max(max(sbTileLoaded(c + vec2(-1.0, -1.0)), sbTileLoaded(c + vec2(1.0, -1.0))), max(sbTileLoaded(c + vec2(-1.0, 1.0)), sbTileLoaded(c + vec2(1.0, 1.0))));
    if (m > 0.9) wp.y -= ${LOADED_SINK.toFixed(1)};
    vUv = (uFarUv * vec3(wp.xz, 1.0)).xy;
    vWallLo = lightOffset;
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FS = /* glsl */ `
  ${GLSL_COMMON}
  precision highp sampler2D;
  uniform sampler2D uFarClass;
  uniform sampler2D uFarTone; // r tone, g wall share
  uniform vec2 uFarSize;
  uniform float uToneK;
  uniform float uWallK;
  uniform float uClassBias;
  uniform float uFit;
  in vec3 vWorldPos;
  in vec3 vWorldNormal;
  in vec3 vViewNormal;
  in vec2 vUv;
  in float vWallLo;
  ${GLSL_OUT}
  ${GLSL_WATER}
  const float CLASS_RAMP[${CLASS_N}] = float[${CLASS_N}](${glslFloats(CLASS_RAMP)});
  const float CLASS_OVER[${CLASS_N}] = float[${CLASS_N}](${glslFloats(CLASS_RAMP.map((r) => OVER.get(r) ?? 0))});
  const float CLASS_FIT[${CLASS_N}] = float[${CLASS_N}](${glslFloats(CLASS_FIT)});
  void main() {
    #ifdef FAR_NEAREST
    int c = int(texelFetch(uFarClass, ivec2(floor(vUv * uFarSize)), 0).r * 255.0 + 0.5);
    #else
    int c = int(texture(uFarClass, vUv, uClassBias).r * 255.0 + 0.5);
    #endif
    if (c == ${Ground.WATER}) {
      // (the raster draws the shore; as on a near tile, the sea stands where the plane does)
      sbWater(vec3(vWorldPos.x, vWorldPos.y < 4.0 ? ${WATER_Y.toFixed(1)} : vWorldPos.y, vWorldPos.z), vWorldPos);
      return;
    }
    c = min(c, ${CLASS_N - 1});
    #ifdef FAR_DEBUG
    sbWrite(float(c), 0.6, 0.0, 0.0, vViewNormal, 0.01, 1.0);
    return;
    #endif
    vec2 ts = texture(uFarTone, vUv).rg;
    float ramp = CLASS_RAMP[c];
    float over = CLASS_OVER[c];
    float lo = ${TONE_C.toFixed(3)} + (ts.r - 0.5) * ${TONE_K.toFixed(3)} * uToneK + over + CLASS_FIT[c] * uFit;
    vec3 n = normalize(vWorldNormal);
    // (the near ground's own calm: its slopes compressed, shadows crisp)
    float light = mix(sbLight(vWorldPos, n, lo, 1.0), sbLight(vWorldPos, vec3(0.0, 1.0, 0.0), lo, 1.0), 0.55);
    #ifdef FAR_OBLIQUE
    // A grazing camera sees walls: a 10 m row house on a 16 m lot at 7 degrees is four fifths wall on the screen. The wall that matters
    // is the one facing the camera, lit live like any wall, so the far city turns with the sun. Walls are GREY: past half a cell the pixel
    // is on that ramp, under it on the cell's own, the light carried across by how much the two ramps differ.
    float share = clamp(ts.g * uWallK, 0.0, 1.0);
    if (share > 0.01) {
      vec3 toCam = cameraPosition - vWorldPos;
      float wall = sbLight(vWorldPos, normalize(vec3(toCam.x, 0.0, toCam.z)), vWallLo, 0.0);
      float toGrey = ${(OVER.get(Ramp.GREY) ?? 0).toFixed(3)} - over;
      if (share >= 0.5) {
        ramp = ${Ramp.GREY}.0;
        light = mix(light + toGrey, wall, share);
      } else light = mix(light, wall - toGrey, share);
    }
    #endif
    // (tone is filtered, so it is a slow gradient, and the resolve dithers those below the vista: a far pixel's step is rounded here, the dots would crawl)
    light = floor(light * 7.0 + 0.5) / 7.0;
    sbWrite(ramp, light, sbFog(vWorldPos), 0.0, vViewNormal, 0.01, 1.0);
  }
`;

// The far boxes (?farblocks; farBlocks.ts merges them in a worker): a box is six triangles, its roof and the two walls that face the camera,
// mirrored to it per instance (a box seen from outside never shows more; side: DoubleSide, a mirror turns a face around). No light in the data:
// a roof is the raster's tone, a wall its lo, each lit by sbLight's formula with the true normal, per face, so the far city turns with the sun, and it
// is one tone per block. Past blockSink a box sinks into its own tone on the far ground, gone by blockEnd: a wall there is a pixel. Night's path is
// here from day one: a wall whose lit bit is set wakes when uBlockLit passes its byte (a stable threshold, never a timer) and is one tone,
// a light is a pixel out here, with SKY.md section 9's share x glow <= 0.06 held by config.far (blockLit x 1/2 x blockGlow).
const BLOCK_VS = /* glsl */ `
  ${GLSL_COMMON}
  precision highp sampler2D;
  uniform sampler2D uMask;
  uniform vec4 uMaskRect;
  uniform vec2 uMaskSize;
  uniform vec4 uFarCell;      // x = uFarCell.x * i + uFarCell.y, z = uFarCell.z * j + uFarCell.w
  uniform vec2 uBlockFar;     // sinks from, gone at (m from the lens)
  uniform float uBlockLit;
  uniform float uToneK;
  uniform float uFit;
  in vec4 aCell;              // i, j, w, h
  in vec2 aY;                 // base, top (half metres)
  in vec4 aTone;              // roof tone, wall tone, lit walls (low 4 bits) and the box's own grey (high 4), wake
  flat out vec3 vViewN;
  flat out float vRamp;
  flat out float vLight;
  flat out float vFog;
  flat out float vLit;
  void main() {
    vec2 size = aCell.zw * abs(uFarCell.xz);
    vec2 c = aCell.xy * uFarCell.xz + uFarCell.yw + 0.5 * aCell.zw * uFarCell.xz;
    ivec2 mc = clamp(ivec2(floor((c - uMaskRect.xy) * uMaskRect.z)), ivec2(0), ivec2(uMaskSize) - 1);
    vec2 toCam = cameraPosition.xz - c;
    float keep = 1.0 - smoothstep(uBlockFar.x, uBlockFar.y, length(toCam));
    vViewN = vec3(0.0, 1.0, 0.0);
    vRamp = 0.0;
    vLight = 0.0;
    vFog = 0.0;
    vLit = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    if (keep <= 0.0 || texelFetch(uMask, mc, 0).r > 0.5) return;
    vec2 s = vec2(toCam.x < 0.0 ? -1.0 : 1.0, toCam.y < 0.0 ? -1.0 : 1.0);
    float base = aY.x * 0.5;
    float top = base + (aY.y * 0.5 - base) * keep;
    vec3 wp = vec3(c.x + position.x * s.x * 0.5 * size.x, mix(base, top, position.y), c.y + position.z * s.y * 0.5 * size.y);
    vec3 n = vec3(normal.x * s.x, normal.y, normal.z * s.y);
    vViewN = normalize(mat3(viewMatrix) * n);
    float lo;
    if (normal.y > 0.5) {
      vRamp = ${Ramp.GREY_LIGHT}.0;
      lo = ${TONE_C.toFixed(3)} + (aTone.x - 0.5) * ${TONE_K.toFixed(3)} * uToneK + ${FIT_ROOF.toFixed(3)} * uFit;
    } else {
      vRamp = ${Ramp.GREY}.0;
      int bits = int(aTone.z * 255.0 + 0.5);
      // (the near walls' "each house a slightly different grey", per box: the raster's wall tone is a 64 m mean, which alone lands every wall
      // on one side of a ramp step where the real ones straddle it)
      lo = ${WALL_LO.toFixed(3)} + (aTone.y - 0.5) * ${WALL_K.toFixed(3)} + (float(bits >> 4) / 15.0 - 0.5) * 0.12 + ${FIT_WALL.toFixed(3)} * uFit;
      int bit = normal.x > 0.5 ? (s.x > 0.0 ? 1 : 2) : (s.y > 0.0 ? 4 : 8);
      if ((bits & bit) != 0 && aTone.w < uBlockLit) vLit = 1.0;
    }
    // sbLight per face: a box stands past the shadow window (it is what the streaming edge isn't), so there is no shadow to sample, and a face is one tone
    vLight = clamp(uLight.y + uLight.z * (0.5 + 0.5 * n.y) + uLight.x * max(dot(n, uSunDir), 0.0) + lo, 0.0, 1.0);
    // (with the fog off only the far fade is left, and a box ends well before it starts)
    vFog = uFog.x > 0.0 || length(toCam) > uFog.z * 0.55 ? sbFog(wp) : 0.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const BLOCK_FS = /* glsl */ `
  ${GLSL_COMMON}
  uniform float uBlockGlow;
  flat in vec3 vViewN;
  flat in float vRamp;
  flat in float vLight;
  flat in float vFog;
  flat in float vLit;
  ${GLSL_OUT}
  void main() {
    #ifdef FAR_DEBUG
    sbWrite(vRamp == ${Ramp.GREY_LIGHT}.0 ? 11.0 : 15.0, 0.6, 0.0, 0.0, vViewN, 0.01, 1.0);
    return;
    #endif
    if (vLit > 0.5) sbWrite(${Ramp.GLOW_WHITE}.0, max(vLight, 0.36), vFog, uBlockGlow, vViewN, 0.01, 1.0);
    else sbWrite(vRamp, vLight, vFog, 0.0, vViewN, 0.01, 1.0);
  }
`;

const BLOCK_POS = new THREE.BufferAttribute(new Float32Array([
  // the roof
  -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1,
  // the wall at +x, the wall at +z (mirrored to the camera in the vertex shader)
  1, 0, -1, 1, 0, 1, 1, 1, 1, 1, 1, -1,
  -1, 0, 1, 1, 0, 1, 1, 1, 1, -1, 1, 1,
]), 3);
const BLOCK_NRM = new THREE.BufferAttribute(new Int8Array([
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
]), 3);
const BLOCK_IDX = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]), 1);

// The far skyline with ?farblocks: far.bin's true boxes, each on its near tower's facade family, picked by the mesher's own rule (styleFor), so what
// stands 5 km off in dark glass or pale stone is that from the first frame and doesn't turn into it at the swap. A wall is one tone: the family's ramp,
// with what its windows do to that ramp in the mean (FAM_LO, fitted like CLASS_FIT); glass mirrors the sky, as buildingMaterial's `gl` does, so it
// doesn't turn with the sun. Roofs are as ever.
const TOWER_VS = /* glsl */ `
  ${GLSL_COMMON}
  precision highp sampler2D;
  uniform sampler2D uMask;
  uniform vec4 uMaskRect;
  uniform vec2 uMaskSize;
  in vec3 aTower;             // ramp, lo, family
  out vec3 vWorldPos;
  out vec3 vWorldNormal;
  out vec3 vViewNormal;
  flat out vec3 vLook;
  void main() {
    vec3 wc = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    ivec2 mc = clamp(ivec2(floor((wc.xz - uMaskRect.xy) * uMaskRect.z)), ivec2(0), ivec2(uMaskSize) - 1);
    vec3 p = texelFetch(uMask, mc, 0).r > 0.5 ? vec3(0.0) : position;
    vec4 wp = instanceMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(instanceMatrix) * normal);
    vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
    vLook = normal.y > 0.5 ? vec3(${Ramp.GREY_LIGHT}.0, -0.16, ${Fam.NONE}.0) : aTower;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const TOWER_FS = /* glsl */ `
  ${GLSL_COMMON}
  in vec3 vWorldPos;
  in vec3 vWorldNormal;
  in vec3 vViewNormal;
  flat in vec3 vLook;
  ${GLSL_OUT}
  void main() {
    #ifdef FAR_DEBUG
    sbWrite(16.0 + vLook.z, 0.6, 0.0, 0.0, vViewNormal, 0.01, 1.0);
    return;
    #endif
    vec3 n = normalize(vWorldNormal);
    float light;
    if (vLook.z == ${Fam.GLASS}.0) {
      vec3 v = normalize(cameraPosition - vWorldPos);
      light = 0.31 + 0.34 * (1.0 - abs(dot(n, v))) + vLook.y;
    } else light = sbLight(vWorldPos, n, vLook.y, 1.0);
    sbWrite(vLook.x, light, sbFog(vWorldPos), 0.0, vViewNormal, 0.01, 1.0);
  }
`;

/** A family's wall ramp (buildingMaterial's wallR). */
const FAM_RAMP: Record<number, number> = {
  [Fam.NONE]: Ramp.GREY, [Fam.GLASS]: Ramp.GLASS, [Fam.MASONRY]: Ramp.STONE, [Fam.BANDS]: Ramp.GREY, [Fam.FINS]: Ramp.GREY, [Fam.GRANITE]: Ramp.GRANITE, [Fam.PRECAST]: Ramp.GREY_LIGHT,
};
/** A family's wall in the mean: its base lo with its windows gone into it. */
const FAM_LO: Record<number, number> = {
  [Fam.NONE]: -0.14, [Fam.GLASS]: 0.15, [Fam.MASONRY]: -0.085, [Fam.BANDS]: -0.075, [Fam.FINS]: -0.03, [Fam.GRANITE]: 0.04, [Fam.PRECAST]: -0.055,
};

/** The boxes' looks, three floats a box: ramp, lo, family. `sf`: the icons table applies (styleFor's rule). */
export function farTowerLooks(f: FarData, t: FarTowers, sf: boolean): Float32Array {
  const n = f.index.length;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const b = f.index[i];
    // (a point on any of the building's boxes: the mesher asks its rings, the box is what is here)
    const inside = (x: number, z: number) => {
      for (let k = 0; k < n; k++) {
        if (f.index[k] !== b) continue;
        const o = k * 7, dx = x - f.boxes[o], dz = z - f.boxes[o + 1], co = Math.cos(f.boxes[o + 4]), si = Math.sin(f.boxes[o + 4]);
        if (Math.abs(dx * co + dz * si) <= f.boxes[o + 2] && Math.abs(-dx * si + dz * co) <= f.boxes[o + 3]) return true;
      }
      return false;
    };
    const st = i < t.n ? styleFor(t.arch[i], t.height[i], t.area[i], t.cx[i], t.cz[i], t.stableId[i], inside, sf) : null;
    const fam = st ? st.fam : Fam.NONE;
    out[i * 3] = FAM_RAMP[fam];
    out[i * 3 + 1] = FAM_LO[fam] + (st && fam === Fam.GLASS ? (st.variant === Variant.SILVER ? 0.12 : st.variant === Variant.BRACED ? -0.08 : 0) : 0);
    out[i * 3 + 2] = fam;
  }
  return out;
}

/** The far skyline's material with ?farblocks. `mask`: the loaded tiles. */
export function makeFarTowerMaterial(mask: THREE.Texture, maskRect: THREE.Vector4, maskSize: THREE.Vector2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines: farFlags.debug ? { FAR_DEBUG: 1 } : {},
    uniforms: { ...globals, uMask: { value: mask }, uMaskRect: { value: maskRect }, uMaskSize: { value: maskSize } },
    vertexShader: TOWER_VS,
    fragmentShader: TOWER_FS,
  });
}

/** One chunk of far boxes, one draw. The arrays stay: they are what a lost GL context comes back from. */
export function farBlockMesh(s: Pick<FarBlockChunk, 'count' | 'cell' | 'y' | 'tone' | 'sphere'>, material: THREE.Material): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', BLOCK_POS);
  g.setAttribute('normal', BLOCK_NRM);
  g.setIndex(BLOCK_IDX);
  g.setAttribute('aCell', new THREE.InstancedBufferAttribute(s.cell, 4));
  g.setAttribute('aY', new THREE.InstancedBufferAttribute(s.y, 2));
  g.setAttribute('aTone', new THREE.InstancedBufferAttribute(s.tone, 4, true));
  g.instanceCount = s.count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(s.sphere[0], s.sphere[1], s.sphere[2]), s.sphere[3]);
  const mesh = new THREE.Mesh(g, material);
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  return mesh;
}

/** The far boxes' material. `mask`: the loaded tiles, as the far skyline reads them. */
export function makeFarBlockMaterial(affine: readonly number[], mask: THREE.Texture, maskRect: THREE.Vector4, maskSize: THREE.Vector2): THREE.ShaderMaterial {
  const uBlockFar = new THREE.Vector2();
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines: farFlags.debug ? { FAR_DEBUG: 1 } : {},
    side: THREE.DoubleSide,
    uniforms: {
      ...globals,
      uMask: { value: mask },
      uMaskRect: { value: maskRect },
      uMaskSize: { value: maskSize },
      uFarCell: { value: new THREE.Vector4(affine[0], affine[2], affine[4], affine[5]) },
      uBlockFar: { get value() { return uBlockFar.set(config.far.blockSink, config.far.blockEnd); } },
      uBlockLit: { get value() { return config.far.blockLit; } },
      uBlockGlow: { get value() { return config.far.blockGlow; } },
      uToneK: { get value() { return config.far.toneK; } },
      uFit: { get value() { return config.far.fit; } },
    },
    vertexShader: BLOCK_VS,
    fragmentShader: BLOCK_FS,
  });
}

/** Mip levels of the class map: each texel the mode of the four under it, so a mip is still a class, never a blend of two. */
function classMips(cls: Uint8Array, W: number, H: number): Array<{ data: Uint8Array; width: number; height: number }> {
  const levels = [{ data: cls, width: W, height: H }];
  for (let l = 1; l < CLASS_LEVELS; l++) {
    const p = levels[l - 1];
    const w = Math.max(1, p.width >> 1), h = Math.max(1, p.height >> 1);
    const out = new Uint8Array(w * h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const j0 = Math.min(p.height - 1, j * 2), j1 = Math.min(p.height - 1, j * 2 + 1);
        const i0 = Math.min(p.width - 1, i * 2), i1 = Math.min(p.width - 1, i * 2 + 1);
        const a = p.data[j0 * p.width + i0], b = p.data[j0 * p.width + i1], c = p.data[j1 * p.width + i0], d = p.data[j1 * p.width + i1];
        out[j * w + i] = a === b || a === c || a === d ? a : b === c || b === d ? b : c === d ? c : a;
      }
    levels.push({ data: out, width: w, height: h });
  }
  return levels;
}

export interface FarTextures {
  cls: THREE.DataTexture;
  tone: THREE.DataTexture;
}

/** The raster's two textures (they aren't uploaded yet: nothing has used them). */
export function makeFarTextures(r: FarRaster): FarTextures {
  // (copies: these stay for the context's sake, and a view would keep the whole inflated file alive)
  const base = r.cls.slice();
  const cls = new THREE.DataTexture(base, r.W, r.H, THREE.RedFormat, THREE.UnsignedByteType);
  cls.mipmaps = classMips(base, r.W, r.H) as unknown as THREE.DataTexture['mipmaps'];
  cls.magFilter = THREE.NearestFilter;
  cls.minFilter = THREE.NearestMipmapNearestFilter;
  cls.generateMipmaps = false;
  cls.unpackAlignment = 1;
  cls.needsUpdate = true;
  const rg = new Uint8Array(r.W * r.H * 2);
  for (let i = 0; i < r.W * r.H; i++) {
    rg[i * 2] = r.tone[i];
    rg[i * 2 + 1] = r.wall[i];
  }
  const tone = new THREE.DataTexture(rg, r.W, r.H, THREE.RGFormat, THREE.UnsignedByteType);
  tone.magFilter = THREE.LinearFilter;
  tone.minFilter = THREE.LinearMipmapLinearFilter;
  tone.generateMipmaps = true;
  tone.anisotropy = TONE_ANISOTROPY;
  tone.unpackAlignment = 1;
  tone.needsUpdate = true;
  return { cls, tone };
}

/** World x, z -> the raster's 0..1 uv (the inverse of its affine). */
function farUv(r: FarRaster): THREE.Matrix3 {
  const [a, b, c, d, e, f] = r.affine;
  const det = a * e - b * d;
  // x' = x - c, z' = z - f; i = (e x' - b z') / det, j = (a z' - d x') / det
  const m = new THREE.Matrix3();
  m.set(e / det / r.W, -b / det / r.W, (-e * c + b * f) / det / r.W, -d / det / r.H, a / det / r.H, (d * c - a * f) / det / r.H, 0, 0, 1);
  return m;
}

/** The walls' lo at a world point, for the far mesh's vertices. */
export function farWallLo(r: FarRaster): (x: number, z: number) => number {
  const e = farUv(r).elements;
  return (x, z) => {
    const i = Math.min(r.W - 1, Math.max(0, Math.floor((e[0] * x + e[3] * z + e[6]) * r.W)));
    const j = Math.min(r.H - 1, Math.max(0, Math.floor((e[1] * x + e[4] * z + e[7]) * r.H)));
    return WALL_LO + (r.wallTone[j * r.W + i] / 255 - 0.5) * WALL_K;
  };
}

/** The far ground's material. `mask`: the loaded tiles, as the far skyline reads them. */
export function makeFarGroundMaterial(r: FarRaster, tex: FarTextures, mask: THREE.Texture, maskRect: THREE.Vector4, maskSize: THREE.Vector2): THREE.ShaderMaterial {
  const defines: Record<string, number> = {};
  if (farFlags.oblique) defines.FAR_OBLIQUE = 1;
  if (farFlags.nearest) defines.FAR_NEAREST = 1;
  if (farFlags.debug) defines.FAR_DEBUG = 1;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines,
    uniforms: {
      ...globals,
      uMask: { value: mask },
      uMaskRect: { value: maskRect },
      uMaskSize: { value: maskSize },
      uFarUv: { value: farUv(r) },
      uFarSize: { value: new THREE.Vector2(r.W, r.H) },
      uFarClass: { value: tex.cls },
      uFarTone: { value: tex.tone },
      uToneK: { get value() { return config.far.toneK; } },
      uWallK: { get value() { return config.far.wallK; } },
      uClassBias: { get value() { return config.far.classBias; } },
      uFit: { get value() { return config.far.fit; } },
    },
    vertexShader: VS,
    fragmentShader: FS,
  });
}
