// Props dev page: a grey grove (eucalyptus / pine / cypress), street trees
// along the harness blocks, painted trees mid-pop, roof sprouts at levels
// 1-3 on recolored harness boxes, and the two landmarks in the distance.
//
// Query params (plus the harness's dist/elev/yaw/spin/w/fog):
//   view=grove|street|sprouts|sutro|trans|far   camera target preset
//   tx,ty,tz      explicit camera target
//   t=<s>         freeze the shader clock at t (paint events start at t=4)
//   paint=0       no paint at all (pure grey world)
//   city=1        real baked SF instead of the harness (lat=&lon=&paint=N like dev/city.html)
import * as THREE from 'three';
import { createHarness } from './harness';
import { globals, makeRampMaterial, SHADOW_LAYER } from '../src/render/materials';
import { Ramp, HUE_RAMPS } from '../src/render/palette';
import { TreeField, RoofSprouts, makeSutroTower, makeTransamerica, type TreeInstance } from '../src/world/Props';

const params = new URLSearchParams(location.search);
const cityMode = params.get('city') === '1';
const h = createHarness({ ground: !cityMode, buildings: !cityMode });
const P = h.params;
const num = (k: string, d: number) => {
  const v = P.get(k);
  return v === null || v === '' ? d : Number(v);
};
const freezeT = P.get('t');
const PAINT_T = 4; // paint events start here on the shader clock
let clockOffset = 0;

let s = 99;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

const sprouts = new RoofSprouts();
h.scene.add(sprouts.object);
const fields: TreeField[] = [];

if (!cityMode) await harnessScene();
else await cityScene();

const lodParam = P.get('lod');
h.onFrame((_dt, t) => {
  globals.uTime.value = freezeT !== null ? Number(freezeT) : t + clockOffset;
  if (lodParam !== null) for (const f of fields) f.setLod(Number(lodParam) as 0 | 1 | 2);
});

(window as unknown as Record<string, unknown>).__props = { fields, sprouts, globals };
setTimeout(() => h.ready(), 600);

// ------------------------------------------------------------------ harness

async function harnessScene() {
  // a park east of the blocks: grass + a dense grove like Golden Gate Park
  const park = { x0: 40, x1: 260, z0: -150, z1: 150 };
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(park.x1 - park.x0 + 16, park.z1 - park.z0 + 16).rotateX(-Math.PI / 2),
    makeRampMaterial({ ramp: Ramp.GREEN_GREY, lightOffset: 0.02 }),
  );
  grass.position.set((park.x0 + park.x1) / 2, 0.04, (park.z0 + park.z1) / 2);
  grass.layers.enable(SHADOW_LAYER);
  h.scene.add(grass);

  const grove: TreeInstance[] = [];
  for (let x = park.x0 + 5; x < park.x1; x += 11)
    for (let z = park.z0 + 5; z < park.z1; z += 11) {
      const jx = x + (rnd() - 0.5) * 9, jz = z + (rnd() - 0.5) * 9;
      // a meadow clearing in the middle of the park
      if (Math.hypot(jx - 150, jz - 20) < 38) continue;
      if (rnd() > 0.55) continue;
      grove.push({ x: jx, y: 0, z: jz, size: 0.75 + 0.7 * rnd(), kind: rnd() < 0.18 ? 2 : 1 });
    }
  // street trees in front of ~30% of the houses (sidewalk side of each row)
  const street: TreeInstance[] = [];
  for (let i = -3; i <= 3; i++)
    for (let j = -3; j <= 3; j++) {
      if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue;
      if (rnd() > 0.45) continue;
      street.push({ x: i * 9 + (rnd() - 0.5) * 4, y: 0, z: j * 26 + 11.2, size: 0.55 + 0.35 * rnd(), kind: 0 });
    }
  // the empty center plaza: a little square of street trees
  for (const [x, z] of [
    [-6, -14],
    [6, -14],
    [-6, 14],
    [6, 14],
    [0, 0],
  ])
    street.push({ x, y: 0, z, size: 0.8, kind: 0 });

  // split the grove into 256 m-ish fields like the game does (here: two)
  const west = grove.filter((t) => t.x < 150);
  const east = grove.filter((t) => t.x >= 150);
  for (const list of [west, east, street]) {
    const tf = new TreeField(list);
    h.scene.add(tf.object);
    fields.push(tf);
  }

  // ---- paint: recolor a few harness boxes + grow their roofs; trees nearby bloom
  const paintOn = P.get('paint') !== '0';
  const boxes: Array<{ mesh: THREE.Mesh; i: number; j: number; h: number }> = [];
  h.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !(m.geometry instanceof THREE.BoxGeometry)) return;
    const i = Math.round(m.position.x / 9), j = Math.round(m.position.z / 26);
    const hgt = (m.geometry as THREE.BoxGeometry).parameters.height;
    boxes.push({ mesh: m, i, j, h: hgt });
  });
  if (paintOn) {
    const plan: Array<[number, number, number, number, number]> = [
      // i, j, hue, level, delay (s after PAINT_T)
      [2, -1, 0, 1, 0.0],
      [2, 0, 1, 2, 0.0],
      [2, 1, 2, 3, 0.0],
      [3, -1, 4, 3, -3],
      [3, 0, 5, 2, -3],
      [3, 1, 3, 3, -3],
      [-2, 2, 4, 2, -3],
      [-1, 2, 5, 3, 0.15],
      [0, 2, 0, 3, -3],
      [1, 2, 1, 1, -3],
      [2, 2, 2, 2, 0.3],
      [-2, -2, 3, 1, -3],
      [-1, -2, 4, 2, -3],
    ];
    for (const [i, j, hue, level, delay] of plan) {
      const b = boxes.find((x) => x.i === i && x.j === j);
      if (!b) continue;
      const g = b.mesh.geometry;
      const ramp = g.getAttribute('ramp') as THREE.BufferAttribute;
      (ramp.array as Float32Array).fill(HUE_RAMPS[hue]);
      ramp.needsUpdate = true;
      const lo = g.getAttribute('lightOffset') as THREE.BufferAttribute;
      (lo.array as Float32Array).fill(0.04);
      lo.needsUpdate = true;
      const idx = (i + 10) * 100 + (j + 10);
      // grow the levels up like the game does (re-splats escalate)
      for (let l = 1; l <= level; l++) {
        const t0 = PAINT_T + delay - (level - l) * 4;
        sprouts.set(idx, { cx: i * 9, cz: j * 26, y: b.h, w: 7.5 * 0.86, d: 18 * 0.86, yaw: Math.PI / 2 }, hue, l, t0);
      }
      // nearby street trees bloom too
      const tf = fields[2];
      street.forEach((t, k) => {
        if (Math.abs(t.x - i * 9) < 12 && Math.abs(t.z - j * 26) < 20) tf.setPaint(k, hue, level, PAINT_T + delay + 0.1);
      });
    }
    // a painted wedge of the grove, popping in a wave (as if a splat landed at its edge)
    const cx = 175, cz = -70;
    for (const [fi, list] of [
      [0, west],
      [1, east],
    ] as Array<[number, TreeInstance[]]>) {
      list.forEach((t, k) => {
        const d = Math.hypot(t.x - cx, t.z - cz);
        if (d < 55) {
          const hue = Math.floor(((Math.atan2(t.z - cz, t.x - cx) + Math.PI) / (Math.PI * 2)) * 6) % 6;
          fields[fi].setPaint(k, hue, d < 25 ? 3 : d < 40 ? 2 : 1, PAINT_T + d * 0.012);
        }
      });
    }
  }

  // ---- landmarks in the distance (Sutro ~600 m, Transamerica ~700 m)
  const sutro = makeSutroTower();
  sutro.position.set(-480, 0, -360);
  h.scene.add(sutro);
  const trans = makeTransamerica();
  trans.position.set(-120, 0, -690);
  h.scene.add(trans);

  const view = P.get('view') ?? 'grove';
  const targets: Record<string, [number, number, number]> = {
    grove: [140, 6, 10],
    street: [10, 6, 0],
    sprouts: [20, 10, 20],
    sutro: [-480, 140, -360],
    trans: [-120, 120, -690],
    far: [0, 20, 0],
  };
  const tg = targets[view] ?? targets.grove;
  h.target.set(num('tx', tg[0]), num('ty', tg[1]), num('tz', tg[2]));
}

// ------------------------------------------------------------------ real city

async function cityScene() {
  const { City } = await import('../src/world/City');
  const { FACTION_RAINBOW } = await import('../src/world/PaintState');
  const slug = P.get('slug') ?? 'sf';
  const base = `/city/${slug}`;
  const man = await (await fetch(`${base}/city.json`)).json();
  const [lat0, lon0] = man.origin;
  const lat = num('lat', 37.7726);
  const lon = num('lon', -122.4446); // the Panhandle
  const x = (lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
  const z = -(lat - lat0) * 110574;
  const city = new City(man, base);
  h.scene.add(city.root);
  const lists = new Map<string, TreeInstance[]>();
  city.onTile = ({ tx, tz, terrain }) => {
    if (terrain && terrain.trees.length) {
      const list: TreeInstance[] = terrain.trees.map((t) => ({ x: t.x, y: t.y, z: t.z, size: t.size, kind: t.kind }));
      const tf = new TreeField(list);
      h.scene.add(tf.object);
      fields.push(tf);
      lists.set(`${tx},${tz}`, list);
      (tf as unknown as { key: string }).key = `${tx},${tz}`;
    }
  };
  city.onTileUnload = (tx, tz) => {
    const k = `${tx},${tz}`;
    const i = fields.findIndex((f) => (f as unknown as { key: string }).key === k);
    if (i >= 0) {
      fields[i].dispose();
      fields.splice(i, 1);
    }
    lists.delete(k);
  };
  for (const lm of man.landmarks as Array<{ kind: string; x: number; y: number; z: number }>) {
    const obj = lm.kind === 'sutro' ? makeSutroTower() : lm.kind === 'transamerica' ? makeTransamerica() : null;
    if (!obj) continue;
    obj.position.set(lm.x, lm.y, lm.z);
    h.scene.add(obj);
  }
  await city.loadFar();
  const focus = new THREE.Vector3(x, 0, z);
  const paintN = num('paint', 0);
  let painted = false;
  let settle = 0;
  let ready = false;
  h.onFrame((dt) => {
    focus.y = city.groundAt(focus.x, focus.z) + num('ty', 8);
    h.target.copy(focus);
    globals.uGroundRef.value = city.groundAt(focus.x, focus.z) - 20;
    city.update(focus, h.pipeline.renderer, dt);
    if (!painted && paintN > 0 && city.loadedRegionCount() > 0 && !city.busy) {
      painted = true;
      const now = freezeT !== null ? Number(freezeT) : globals.uTime.value;
      const near = city.buildingsNear(focus.x, focus.z, num('pr', 80));
      near.slice(0, paintN).forEach((n, i) => {
        const hue = i % 6;
        const level = 1 + (i % 3);
        const t0 = now - (P.get('pop') === '1' ? 0 : 5) + (P.get('pop') === '1' ? i * 0.05 : 0);
        city.paint.set(n.ref.index, { faction: FACTION_RAINBOW, color: hue, level, bloomTime: t0 });
        if (level >= 1) sprouts.set(n.ref.index, city.roofRect(n.ref), hue, level, t0);
        const reach = Math.sqrt(n.ref.area) * 0.5 + 9;
        for (const [k, list] of lists) {
          const tf = fields.find((f) => (f as unknown as { key: string }).key === k);
          if (!tf) continue;
          list.forEach((t, ti) => {
            if (Math.abs(t.x - n.ref.cx) < reach && Math.abs(t.z - n.ref.cz) < reach) tf.setPaint(ti, hue, level, t0 + 0.1);
          });
        }
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
  clockOffset = 0;
}
