// Bus dev page: the hero on the real pixel pipeline over the grey test city.
// Query params (plus the harness's dist/elev/yaw/spin/w/fog):
//   pose=anim|rest|full|empty|squash|barf|wide|squint|wheeze   (default anim)
//   t=<s>        freeze the anim loop at time t (springs pre-rolled at 60 fps)
//   grid=1       stack one bus per pose vertically (side-by-side comparison)
//   heading=<deg> bank=<deg> pitch=<deg> alt=<m> scale=<k> speed=<m/s>
//   full=<0..1>  override fullness
//   tune=k:v,... override busTune values
import * as THREE from 'three';
import { createHarness } from './harness';
import { BusModel, busTune, type BusPose } from '../src/bus/BusModel';

const h = createHarness();
const P = h.params;
// tune=key:value,key:value overrides busTune (e.g. tune=heaveAmt:0,lightSnap:0)
for (const kv of (P.get('tune') ?? '').split(',')) {
  const [k, v] = kv.split(':');
  if (k && v !== undefined && k in busTune) (busTune as Record<string, number>)[k] = Number(v);
}
const num = (k: string, d: number) => {
  const v = P.get(k);
  return v === null || v === '' ? d : Number(v);
};
const deg = THREE.MathUtils.degToRad;
const alt = num('alt', 30);
const scale = num('scale', 1.6);
const mode = P.get('pose') ?? 'anim';
const freeze = P.get('t');
const grid = P.get('grid') === '1';

const LOOP = 5.2;

function basePose(): BusPose {
  return { squash: 1, eye: 0.85, fullness: 0.5, mouth: 0, speed: 30, wheeze: 0, heave: 0 };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Struggle-then-release loop: fill + wallow, tap, gag, geyser, recoil, zip off. */
function animPose(t: number, out: BusPose): BusPose {
  const u = ((t % LOOP) + LOOP) % LOOP;
  const tap = 2.7;
  out.mouth = 0;
  out.heave = 0;
  if (u < tap) {
    const fill = smooth(0, 1.6, u);
    out.fullness = fill;
    out.wheeze = 0.25 + 0.6 * fill;
    out.eye = 0.95 - 0.6 * fill;
    out.squash = 1 - 0.035 * fill;
    out.speed = 30 - 6 * fill;
  } else {
    const k = u - tap;
    // squash on the tap frame, heave builds, geyser ~1 s, recoil stretch, relax
    const gush = smooth(0.12, 0.3, k) * (1 - smooth(1.05, 1.3, k));
    out.mouth = gush;
    out.heave = smooth(0, 0.22, k) * (1 - smooth(0.9, 1.25, k));
    out.fullness = 1 - smooth(0.3, 1.15, k);
    const squashIn = 0.72 + 0.28 * smooth(0.0, 0.5, k);
    const recoil = k > 1.05 ? 0.16 * Math.exp(-(k - 1.05) * 3.5) * Math.cos((k - 1.05) * 11) : 0;
    out.squash = (k < 1.05 ? squashIn - 0.06 * gush : 1) + recoil;
    out.wheeze = 0.85 * (1 - smooth(0, 0.3, k));
    out.eye = k < 1.05 ? 0.12 : Math.min(1, 0.6 + (k - 1.05) * 2.5);
    out.speed = k < 1.05 ? 30 * 0.28 : 30 * (1 + 0.45 * Math.exp(-(k - 1.05) * 0.9));
  }
  return out;
}

function namedPose(name: string, out: BusPose): BusPose {
  Object.assign(out, basePose());
  switch (name) {
    case 'full':
      Object.assign(out, { fullness: 1, wheeze: 0.75, eye: 0.38, squash: 0.965, speed: 24 });
      break;
    case 'empty':
      Object.assign(out, { fullness: 0, wheeze: 0, eye: 1, squash: 1.04 });
      break;
    case 'squash':
      Object.assign(out, { fullness: 1, squash: 0.72, heave: 0.35, eye: 0.15, speed: 9 });
      break;
    case 'barf':
      Object.assign(out, { fullness: 0.45, squash: 0.86, heave: 1, mouth: 1, eye: 0.12, speed: 9 });
      break;
    case 'wide':
      Object.assign(out, { fullness: 0.08, squash: 1.12, eye: 1, speed: 90 });
      break;
    case 'squint':
      Object.assign(out, { fullness: 0.7, eye: 0.25, wheeze: 0.4 });
      break;
    case 'wheeze':
      Object.assign(out, { fullness: 0.9, eye: 0.4, wheeze: 1 });
      break;
    case 'rest':
    default:
      break;
  }
  if (P.get('full') !== null) out.fullness = num('full', out.fullness);
  if (P.get('speed') !== null) out.speed = num('speed', out.speed);
  return out;
}

interface Entry {
  bus: BusModel;
  mode: string;
  pose: BusPose;
}

const entries: Entry[] = [];
const modes = grid ? ['empty', 'rest', 'full', 'squash', 'barf', 'wide'] : [mode];
const spacing = 13;
modes.forEach((m, i) => {
  const bus = new BusModel(scale);
  const y = alt + (grid ? (modes.length - 1 - i) * spacing - ((modes.length - 1) * spacing) / 2 : 0);
  bus.root.position.set(0, y, 0);
  bus.root.rotation.set(deg(num('pitch', 0)), deg(num('heading', 0)), deg(num('bank', 0)), 'YXZ');
  h.scene.add(bus.root);
  entries.push({ bus, mode: m, pose: basePose() });
});
h.target.set(0, alt, 0);

function poseFor(e: Entry, t: number): BusPose {
  return e.mode === 'anim' ? animPose(t, e.pose) : namedPose(e.mode, e.pose);
}

// pre-roll springs to the frozen time so screenshots show settled secondary motion
const tFreeze = freeze !== null ? Number(freeze) : null;
if (tFreeze !== null) {
  const step = 1 / 60;
  for (let t = 0; t < tFreeze; t += step) for (const e of entries) e.bus.update(step, t, poseFor(e, t));
}

h.onFrame((dt, t) => {
  const tt = tFreeze ?? t;
  for (const e of entries) e.bus.update(tFreeze !== null ? 0 : dt, tt, poseFor(e, tt));
});

(window as unknown as { __bus: Entry[] }).__bus = entries;
setTimeout(() => h.ready(), 400);
