import * as THREE from 'three';
import { GLSL_COMMON, GLSL_OUT, globals, SHADOW_LAYER } from '../render/materials';
import { GLSL_MOON_CURVE, GLSL_MOON_LIGHT, moonGlobals } from './moonMaterial';

// (three declares instanceColor: here r is lit, g the tone.)
// Boulders: one small rock, instanced, one draw a detailed region and one more in the sun pass, which is what gives them the long hard shadows that make a low Sun worth having. The worker says where (gen.ts rocksOf).
// The Sun's own map decides per rock whether it stands in the light: the ground's big shadows are no caster, so a rock can't learn that from the sun pass.

const VS = /* glsl */ `
  ${GLSL_COMMON}
  ${GLSL_MOON_CURVE}
  out vec3 vWorldPos;
  flat out vec2 vRock;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vRock = instanceColor.rg;
    gl_Position = projectionMatrix * viewMatrix * vec4(moonCurve(wp.xyz), 1.0);
  }
`;

const FS = /* glsl */ `
  ${GLSL_COMMON}
  ${GLSL_MOON_LIGHT}
  in vec3 vWorldPos;
  flat in vec2 vRock;
  ${GLSL_OUT}
  void main() {
    // (flat faces: a rock is what its facets catch)
    vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (n.y < 0.0 && dot(n, cameraPosition - vWorldPos) < 0.0) n = -n;
    float sun = vRock.x * sbShadow(vWorldPos, n);
    float l = moonLit(n, vRock.y, sun);
    sbWrite(moonRamp(vRock.y), l, 0.0, 0.0, mat3(viewMatrix) * n, 0.03, 1.0);
  }
`;

let material: THREE.ShaderMaterial | null = null;
export function rockMaterial(): THREE.ShaderMaterial {
  return (material ??= new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { ...globals, ...moonGlobals }, vertexShader: VS, fragmentShader: FS }));
}

let shape: THREE.BufferGeometry | null = null;
/** One lumpy boulder of radius about 1, sat on y = 0, a faceted thing of 20 triangles. */
export function rockGeometry(): THREE.BufferGeometry {
  if (shape) return shape;
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  // (icosahedra arrive unindexed: the same corner moves the same way on every face it is on)
  const lump = (x: number, y: number, z: number) => 0.72 + 0.56 * (Math.abs(Math.sin(x * 12.9 + y * 78.2 + z * 37.7) * 43758.5453) % 1);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = lump(x, y, z);
    p.setXYZ(i, x * k, Math.max(y * k * 0.72 + 0.3, 0), z * k);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  shape = g;
  return g;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const v = new THREE.Vector3();
const s = new THREE.Vector3();

/** One region's rocks: x, y, z, size, turn, lit, tone, for each. */
export function rockMesh(data: Float32Array): THREE.InstancedMesh {
  const n = data.length / 7;
  const mesh = new THREE.InstancedMesh(rockGeometry(), rockMaterial(), n);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 7, size = data[o + 3], turn = data[o + 4];
    q.setFromAxisAngle(up, turn);
    s.set(size * (0.8 + 0.4 * Math.abs(Math.sin(turn * 7))), size * (0.7 + 0.5 * Math.abs(Math.cos(turn * 3))), size * (0.8 + 0.4 * Math.abs(Math.cos(turn * 11))));
    m4.compose(v.set(data[o], data[o + 1], data[o + 2]), q, s);
    mesh.setMatrixAt(i, m4);
    col[i * 3] = data[o + 5];
    col[i * 3 + 1] = data[o + 6];
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
  mesh.layers.enable(SHADOW_LAYER);
  mesh.userData.sunCull = true;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = true;
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  return mesh;
}

/** The warm-up's one of them. */
export function rockProxy(): THREE.InstancedMesh {
  return rockMesh(new Float32Array(7));
}

