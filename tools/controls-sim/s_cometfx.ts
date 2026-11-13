// The Comet's looks from far off (src/fx/CometFx.ts; DESIGN "the Comet dead ahead", C9 and C10, and the far Lob's L10 and L12): a Comet's streak, and a
// far shot's, never under its floors in game px on a phone, wherever it flies, and a far hit that reads from the height it was thrown from. Over the
// real baked city, through the real Flight, TurboDrive, TurboLens and CameraRig, the lens settled as a climb leaves it (CameraRig.settleAt), at Nonstop
// level over the Western Addition heading east at 1.5, 5 and 15 km (14.9: the ceiling), as s_shots places a pose. At each:
// - streakSizes at 1.4 km, 2.75 km and 15 km from the lens: the head config.comet.headPx game px across or more, the first mote 3, the rest
//   config.comet.streakPx; and near (100 m) the sizes as drawn before (9, 6.5, 3.4 m), the floors not binding;
// - a far Lob's beacon on the loaded edge 2.75 km ahead (beaconHeight): its top at -0.2 of the half height by the lens, or config.lob.beaconMost tall;
// - a far hit's pillar there (tallPillar): config.comet.pillarTall game px tall or more; and the white-hot core config.comet.flashPx or more;
// - cometAt: with no bow the old arc to the last bit, and its bow: on the line at both ends, `bow` of the chord to the right at its middle (- to the left).
// And the source checks: CometFx.streak sizes its motes by streakSizes, impact its ring by it and a far pillar by tallPillar, at() is cometAt; main.ts's
// core reads config.comet.flashPx and the Lob's ring config.lob.ringPx.
//   node tools/controls-sim/run.mjs s_cometfx.ts
// Exit 1 when a check fails.
import { newCity, pump, ll, makeGame } from '../feel-sim/lib';
import { config } from '@src/config';
import { CameraRig } from '@src/game/CameraRig';
import { JET, NONSTOP, TurboDrive, driveSpeed } from '@src/game/Turbo';
import { TurboLens } from '@src/fx/Turbo';
import { lensFov } from '@src/render/PixelPipeline';
import { beaconHeight, cometAt, streakSizes, tallPillar } from '@src/fx/CometFx';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SW = 393, SH = 852, DEG = Math.PI / 180;
const r2 = (x: number) => Math.round(x * 100) / 100;
const city = await newCity();
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => {
  checks++;
  if (!c) fails.push(m);
};
const C = config.comet, L = config.lob;
const pxPerM = (cam: THREE.PerspectiveCamera, d: number) => (cam.projectionMatrix.elements[5] * 0.5 * 852) / Math.max(1, d);

/** The bus at Nonstop level h m over the Western Addition heading east, 3 s in, and the lens the player has there. */
async function lensAt(h: number) {
  const [px, pz] = ll(37.7763, -122.4352);
  const hd = 88 * DEG, fx = Math.sin(hd), fz = -Math.cos(hd);
  const drive = new TurboDrive([-1e7, -1e7, 1e7, 1e7]);
  const g = makeGame(city, drive), f = g.flight;
  const v0 = driveSpeed(NONSTOP, 0, true);
  f.x = px - fx * v0 * 3;
  f.z = pz - fz * v0 * 3;
  f.heading = hd;
  f.glideSpeed = 0;
  f.speed = v0;
  f.fullness = 1;
  await pump(city, f.x, f.z);
  f.y = Math.min(config.flight.ceiling - 100, city.groundAt(px, pz) + h);
  f.holdY = f.y;
  drive.arrive(NONSTOP, 0);
  await pump(city, f.x, f.z, f.y - city.groundAt(px, pz), fx, fz);
  const rig = new CameraRig(), lens = new TurboLens(), cam = new THREE.PerspectiveCamera(50, SW / SH, 1, 60000), focus = new THREE.Vector3();
  rig.settleAt(Math.max(0, f.y - city.groundAt(f.x, f.z)));
  const dt = 1 / 60;
  for (let k = 0; k < 180; k++) {
    if (k % 10 === 0) await pump(city, f.x, f.z, f.lift, f.fx, f.fz);
    g.frame(dt, { sx: 0, sy: 0, dragging: false });
    lens.update(dt, drive, rig, f);
    rig.update(cam, focus, f, dt);
    const lf = lensFov(SW, SH, rig.hfov);
    cam.fov = lf.fov;
    cam.aspect = lf.aspect;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }
  return { f, cam };
}

void JET;
const sizes = [0, 0, 0];
for (const h of [1500, 5000, 15000]) {
  const { f, cam } = await lensAt(h);
  const agl = Math.round(f.y - city.groundAt(f.x, f.z));
  // the streak's floors, by the distance from the lens
  for (const d of [1400, 2750, 15000]) {
    const z = streakSizes(sizes, [9, 6.5, 3.4], cam.projectionMatrix.elements[5], d), k = pxPerM(cam, d);
    const px = z.map((m) => r2(m * k));
    console.log(`${agl} m up, ${d} m off: the head ${px[0]} px, the first mote ${px[1]}, the rest ${px[2]}`);
    ok(px[0] >= C.headPx - 1e-6 && px[1] >= 3 - 1e-6 && px[2] >= C.streakPx - 1e-6, `${agl} m up, ${d} m off: the head ${C.headPx} px or more, the first mote 3, the rest ${C.streakPx} (${px.join(', ')})`);
  }
  const near = streakSizes(sizes, [9, 6.5, 3.4], cam.projectionMatrix.elements[5], 100).slice();
  ok(near[0] === 9 && near[1] === 6.5 && near[2] === 3.4, `${agl} m up, 100 m off: the sizes as drawn near, no floor binding (${near.join(', ')})`);
  // a far shot's landing on the loaded edge 2.75 km ahead: the beacon, the pillar, the core
  const lx = f.x + f.fx * 2750, lz = f.z + f.fz * 2750, ly = city.groundAt(lx, lz);
  const bh = beaconHeight(cam, lx, ly, lz), top = new THREE.Vector3(lx, ly + bh, lz).applyMatrix4(cam.matrixWorldInverse);
  const topNdc = top.z < 0 ? r2(top.applyMatrix4(cam.projectionMatrix).y) : -9;
  console.log(`${agl} m up: the far Lob's beacon ${Math.round(bh)} m, its top at ${topNdc}`);
  ok(Math.abs(topNdc + 0.2) <= 0.02 || (bh >= L.beaconMost - 1 && topNdc < -0.2) || (bh <= L.beacon + 1 && topNdc >= -0.2), `${agl} m up: the beacon's top at -0.2 by the lens, or ${L.beaconMost} m tall (${Math.round(bh)} m, top at ${topNdc})`);
  const dist = cam.position.distanceTo(new THREE.Vector3(lx, ly, lz)), ph = tallPillar(C.pillar, cam.projectionMatrix.elements[5], dist);
  const phPx = r2(ph * pxPerM(cam, dist));
  console.log(`${agl} m up: a far hit's pillar ${Math.round(ph)} m, ${phPx} px; its core ${r2(Math.max(C.flashPx / 852, (C.flashCore * cam.projectionMatrix.elements[5]) / (2 * dist)) * 852)} px`);
  ok(phPx >= C.pillarTall - 0.01, `${agl} m up: a far hit's pillar ${C.pillarTall} px tall or more (${phPx})`);
  ok(Math.max(C.flashPx / 852, (C.flashCore * cam.projectionMatrix.elements[5]) / (2 * dist)) * 852 >= C.flashPx - 1e-6, `${agl} m up: the hit's core ${C.flashPx} px or more`);
}
// cometAt: the old arc with no bow, and the bow
{
  const from = new THREE.Vector3(10, 200, -30), to = new THREE.Vector3(1210, 40, -830), o = new THREE.Vector3();
  let worst = 0;
  for (let u = 0; u <= 1.0001; u += 0.05) {
    cometAt(from, to, 90, 0, u, o);
    const old = new THREE.Vector3().lerpVectors(from, to, u).setY(from.y + (to.y - from.y) * u + 90 * 4 * u * (1 - u));
    worst = Math.max(worst, o.distanceTo(old));
  }
  ok(worst === 0, `cometAt with no bow: the old arc to the last bit (${worst} m off)`);
  const chord = from.distanceTo(to), b = 0.02;
  const mid = cometAt(from, to, 90, b, 0.5, new THREE.Vector3()), line = cometAt(from, to, 90, 0, 0.5, new THREE.Vector3());
  const dx = to.x - from.x, dz = to.z - from.z, l = Math.hypot(dx, dz), side = ((mid.x - line.x) * -dz + (mid.z - line.z) * dx) / l;
  ok(Math.abs(side - b * chord) < 1e-6 && Math.abs(mid.y - line.y) < 1e-9, `cometAt's bow: ${b} of the chord to the right at the middle (${side} against ${b * chord})`);
  const left = cometAt(from, to, 90, -b, 0.5, new THREE.Vector3());
  ok(Math.abs(((left.x - line.x) * -dz + (left.z - line.z) * dx) / l + b * chord) < 1e-6, `cometAt's bow: to the left with a negative bow`);
  ok(cometAt(from, to, 90, b, 0, o).distanceTo(from) < 1e-9 && cometAt(from, to, 90, b, 1, o).distanceTo(to) < 1e-9, `cometAt's bow: it leaves the mouth and lands on the line`);
}
// the source checks
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const fxSrc = readFileSync(here('../../../../src/fx/CometFx.ts'), 'utf8'), mainSrc = readFileSync(here('../../../../src/main.ts'), 'utf8');
const body = (src: string, head: string) => {
  const a = src.indexOf(head);
  return a < 0 ? '' : src.slice(a, src.indexOf('\n  }\n', a));
};
ok(/streakSizes\(/.test(body(fxSrc, '  private streak(')), 'CometFx.streak sizes its motes by streakSizes');
ok(/streakSizes\(/.test(body(fxSrc, '  impact(')) && /tallPillar\(/.test(body(fxSrc, '  impact(')), "CometFx.impact sizes its ring's motes by streakSizes and a far pillar by tallPillar");
ok(/return cometAt\(/.test(body(fxSrc, '  private at(')), 'CometFx.at is cometAt');
ok(/C\.flashPx/.test(mainSrc) && /config\.lob\.ringPx/.test(mainSrc), "main.ts's core reads config.comet.flashPx and the Lob's ring config.lob.ringPx");
console.log(fails.length ? `COMET-FX FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `comet-fx checks: all ${checks} passed`);
process.exit(fails.length ? 1 : 0);
