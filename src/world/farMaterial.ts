import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { Ramp } from '../render/palette';
import { GLSL_WATER } from './terrainMaterial';
import { Ground, WATER_Y, type FarRaster } from './tiles';

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
  in vec3 vWorldPos;
  in vec3 vWorldNormal;
  in vec3 vViewNormal;
  in vec2 vUv;
  in float vWallLo;
  ${GLSL_OUT}
  ${GLSL_WATER}
  const float CLASS_RAMP[${CLASS_N}] = float[${CLASS_N}](${glslFloats(CLASS_RAMP)});
  const float CLASS_OVER[${CLASS_N}] = float[${CLASS_N}](${glslFloats(CLASS_RAMP.map((r) => OVER.get(r) ?? 0))});
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
    vec2 ts = texture(uFarTone, vUv).rg;
    float ramp = CLASS_RAMP[c];
    float over = CLASS_OVER[c];
    float lo = ${TONE_C.toFixed(3)} + (ts.r - 0.5) * ${TONE_K.toFixed(3)} * uToneK + over;
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
    sbWrite(ramp, light, sbFog(vWorldPos), 0.0, vViewNormal, 0.01, 1.0);
  }
`;

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
    },
    vertexShader: VS,
    fragmentShader: FS,
  });
}
