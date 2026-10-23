// Paintable landmarks dev page: one landmark on the harness ground with a
// paint texel driven by query params, so every stage of its bloom can be shot
// without streaming the city.
//   view=trans|sutro   which landmark (default trans)
//   level=0..3         paint level (0 = grey)
//   hue=0..5           paint hue
//   t=<s>              seconds since the bloom (the shader clock is frozen there)
//   keep=1             an escalation (stays painted while the wave travels)
//   hit=x,y,z          where the breath hit (local to the landmark's base), for the splash
//   target=1           the aim glint
//   ty=<m>             camera target height (plus the harness's dist/elev/yaw)
import * as THREE from 'three';
import { createHarness } from './harness';
import { globals } from '../src/render/materials';
import { makeSutroTower, makeTransamerica } from '../src/world/Props';
import { paintUniforms } from '../src/world/buildingMaterial';
import { bindLandmarkPaint } from '../src/world/props/landmarkPaint';
import type { BuildingRef } from '../src/world/City';

const h = createHarness({ ground: true, buildings: false });
const P = h.params;
const num = (k: string, d: number) => {
  const v = P.get(k);
  return v === null || v === '' ? d : Number(v);
};
const view = P.get('view') ?? 'trans';
const obj = view === 'sutro' ? makeSutroTower() : makeTransamerica();
h.scene.add(obj);
h.target.set(0, num('ty', view === 'sutro' ? 120 : 110), 0);

// one paint texel (index 0) in a tiny RGBA32F texture, like PaintState's
const W = 4;
const data = new Float32Array(W * 4);
const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat, THREE.FloatType);
tex.minFilter = tex.magFilter = THREE.NearestFilter;
const T0 = 10; // bloom time on the shader clock
const level = num('level', 1);
data[0] = num('hue', 0);
data[1] = level;
data[2] = T0;
data[3] = 1 + (P.get('keep') === '1' ? 2 : 0);
tex.needsUpdate = true;
paintUniforms.uPaint.value = tex;
paintUniforms.uPaintW.value = W;
paintUniforms.uTarget.value = P.get('target') === '1' ? 0 : -1;
const ref = { index: 0 } as BuildingRef;
const mats = bindLandmarkPaint(obj, ref);
const hit = P.get('hit');
if (hit) {
  const [x, y, z] = hit.split(',').map(Number);
  for (const m of mats) (m.uniforms.uLmHit.value as THREE.Vector4).set(x, y, z, T0);
}
const t = num('t', 3);
h.onFrame(() => {
  globals.uTime.value = T0 + t;
});
setTimeout(() => h.ready(), 800);
