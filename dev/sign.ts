// Street-sign dev page: the pop-up neighborhood sign on the real pixel
// pipeline, standing on the sidewalk in front of a grey harness block.
// Query params (plus the harness's dist/elev/yaw/spin/w/fog):
//   text=ALAMO SQUARE|HAYES VALLEY   names (pipe-separated); default cycles SF names
//   hue=<0..5>     rainbow hue (default rotates)
//   t=<s>          freeze every sign at age t (pre-rolled at 60 fps) for screenshots
//   grid=1         three signs side by side (with grid=1, t applies to all of them)
//   first=<k>      start at name/hue k (e.g. grid=1&first=3 shows names 3..5 in hues 3..5)
//   side=back      stand behind a block, on its far side from the camera (occlusion test)
//   face=<deg>     override the facing yaw (default: the facade's street normal)
//   n=<k>          stagger k signs (pool test; k > 4 recycles the oldest)
//   resplat=<s>    re-splat the first sign's block at clock s (it should flip into the next hue, not re-pop)
//   bus=1          hover the bus over the sign's block, between camera and sign (depth-bias test)
//   blocks=0       no harness blocks (open ground: see the sign's sun shadow)
//   tune=k:v,...   override signTune values
import * as THREE from 'three';
import { createHarness } from './harness';
import { StreetSigns, signTune } from '../src/fx/StreetSign';
import { BusModel, type BusPose } from '../src/bus/BusModel';

const P0 = new URLSearchParams(location.search);
const h = createHarness({ buildings: P0.get('blocks') !== '0' });
const P = h.params;
for (const kv of (P.get('tune') ?? '').split(',')) {
  const [k, v] = kv.split(':');
  if (k && v !== undefined && k in signTune) (signTune as Record<string, number>)[k] = Number(v);
}
const num = (k: string, d: number) => {
  const v = P.get(k);
  return v === null || v === '' ? d : Number(v);
};
const NAMES = ['ALAMO SQUARE', 'HAYES VALLEY', 'HAIGHT-ASHBURY', 'FINANCIAL DISTRICT', 'NOE VALLEY', 'MISSION', 'CHINATOWN', 'NOB HILL', "FISHERMAN'S WHARF", 'SOMA', 'VISITACION VALLEY', 'EMBARCADERO'];
const names = P.get('text') ? P.get('text')!.split('|') : NAMES;
const freeze = P.get('t');
const grid = P.get('grid') === '1';
const nStagger = Math.max(1, num('n', 1));
const back = P.get('side') === 'back';
const facing = THREE.MathUtils.degToRad(num('face', back ? -90 : 90));
const hue0 = P.get('hue');
const first = num('first', 0);

// the sidewalk 4.5 m in front of a harness block's facade (as src/main.ts places it):
// block i = -2 faces +X toward the default camera; block i = 2 faces away from it
const FACADE_X = back ? 14.25 - 4.5 : -14.25 + 4.5;
const signs = new StreetSigns();
h.scene.add(signs.object);
h.target.set(FACADE_X, 10, 0);

// the bus hovering over the sign's block during the geyser (on the camera side of the sign)
const bus = P.get('bus') === '1' ? new BusModel() : null;
const busPose: BusPose = { squash: 1, eye: 0.8, fullness: 0.4, mouth: 1, speed: 6, wheeze: 0.3, heave: 0.5 };
if (bus) {
  h.scene.add(bus.root);
  bus.root.position.set(FACADE_X + (back ? 1 : -1) * 13, 23, 3);
  bus.root.rotation.set(0.06, 0, 0, 'YXZ');
}

let k = 0;
function pop(z: number, i = k, hue = hue0 !== null ? Number(hue0) : i % 6) {
  signs.show({
    text: names[i % names.length],
    position: new THREE.Vector3(FACADE_X, 0, z),
    facing,
    hue,
  });
}
const resplat = P.get('resplat');
let resplatDone = resplat === null;

const cycle = signTune.riseTime + signTune.holdGreen + signTune.flipTime + signTune.holdRainbow + signTune.sinkTime + 0.7;
const STAGGER = 0.9;
let clock = 0;
let next = 0;

function begin() {
  if (grid) {
    pop(-24, first);
    pop(0, first + 1);
    pop(24, first + 2);
  } else {
    pop(nStagger > 1 ? -((nStagger - 1) / 2) * 22 : 0, first);
  }
  k = first + 1;
  next = nStagger > 1 ? STAGGER : cycle;
}

/** One tick of the demo loop: pops new signs on schedule, then updates the pool. */
function step(dt: number) {
  clock += dt;
  if (!resplatDone && clock >= Number(resplat)) {
    resplatDone = true;
    pop(nStagger > 1 ? -((nStagger - 1) / 2) * 22 : 0, first, (first + 2) % 6);
  }
  if (!grid && clock >= next) {
    const j = k - first;
    if (nStagger > 1) {
      pop(((j % nStagger) - (nStagger - 1) / 2) * 22, k);
      next = clock + (j % nStagger === nStagger - 1 ? cycle : STAGGER);
    } else {
      pop(0, k);
      next = clock + cycle;
    }
    k++;
  }
  signs.update(dt, h.camera);
  bus?.update(dt, clock, busPose);
}

let started = false;
h.onFrame((dt) => {
  if (!started) {
    started = true;
    begin();
    if (freeze !== null) {
      // pre-roll the whole loop at 60 fps, then hold (the hit-stop path: dt = 0 must keep everything still)
      const steps = Math.round(Number(freeze) * 60);
      for (let s = 0; s < steps; s++) step(1 / 60);
    }
    h.ready();
  }
  if (freeze !== null) {
    signs.update(0, h.camera);
    bus?.update(0, clock, busPose);
  }
  else step(dt);
  (window as unknown as { __stats: unknown }).__stats = { active: signs.active };
});
