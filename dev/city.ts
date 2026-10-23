// Dev view of the real baked city. ?lat=&lon=&dist=&elev=&yaw=&paint=N (paint N nearby buildings)
import * as THREE from 'three';
import { createHarness } from './harness';
import { City } from '../src/world/City';
import { globals } from '../src/render/materials';
import { FACTION_RAINBOW } from '../src/world/PaintState';

const h = createHarness({ ground: false, buildings: false });
const p = h.params;
const slug = p.get('city') ?? 'sf';
const base = `/city/${slug}`;
const man = await (await fetch(`${base}/city.json`)).json();
const [lat0, lon0] = man.origin;
const lat = Number(p.get('lat') ?? 37.7762);
const lon = Number(p.get('lon') ?? -122.4334);
const x = (lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
const z = -(lat - lat0) * 110574;
const city = new City(man, base);
h.scene.add(city.root);
await city.loadFar();
const focus = new THREE.Vector3(x, 0, z);
let ready = false;
let settle = 0;
const paintN = Number(p.get('paint') ?? 0);
let painted = false;
h.onFrame((dt) => {
  focus.y = city.groundAt(focus.x, focus.z) + Number(p.get('ty') ?? 8);
  h.target.copy(focus);
  globals.uGroundRef.value = city.groundAt(focus.x, focus.z) - 20;
  city.update(focus, h.pipeline.renderer, dt);
  if (!painted && paintN > 0 && city.loadedRegionCount() > 0 && !city.busy) {
    painted = true;
    const near = city.buildingsNear(focus.x, focus.z, Number(p.get('pr') ?? 60));
    near.slice(0, paintN).forEach((n, i) => {
      city.paint.set(n.ref.index, { faction: FACTION_RAINBOW, color: i % 6, level: 1 + (i % 3 === 2 ? 2 : i % 3), bloomTime: globals.uTime.value - 5 });
    });
  }
  if (!ready && city.loadedRegionCount() > 0 && !city.busy) {
    settle += dt;
    if (settle > 1.0) {
      ready = true;
      h.ready();
    }
  }
});
