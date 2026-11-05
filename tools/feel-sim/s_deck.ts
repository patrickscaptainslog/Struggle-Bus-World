// A breath from under the Golden Gate's deck (docs/reviews/main-live-2026-11-05.md, m5): tools/bridge-paint.mjs's aim rows offline, on the real city, the real
// bridge (Bridges.ts, made paintable as main.ts makes it) and the real Aimer and Splatter. In order on one bridge, as there: a tap from the deck's height 110 m beside
// its middle, one from 350 m over its line 900 m back, then one from under the deck 30 m back, 26 m up. The first two glint it and take it a level each, 1 then 2;
// the one from under glints nothing, lands on the water, and must leave it at 2. Then the super splat from the same place under the deck, the real SuperSplat with
// main.ts's host (a MEGA is the tap's breath, `from` the bus's height): a MEGA let go at half charge, and the whole FIREHOSE, its pour and its closer. They must
// leave it at 2 too: the FIREHOSE's own blasts passed no `from`, and took it to its rainbow road from under the deck (fix/live's independent review). Last, the
// FIREHOSE from 350 m over the deck's line takes it to 3.
//   node tools/feel-sim/run.mjs s_deck.ts
import { newCity, pump, makeGame, manifest, config, MODE, THREE } from './lib';
import { makeGoldenGate, bridgeObstacles, paintBridge } from '@src/world/Bridges';
import { SuperSplat, type SuperHost } from '@src/game/SuperSplat';

const city = await newCity();
const lm = manifest.landmarks.find((l: { kind: string }) => l.kind === 'ggb');
const obj = makeGoldenGate(lm.points, lm.deck, lm.supports);
city.addObstacles(bridgeObstacles('ggb', lm.points, lm.deck, lm.supports));
const ref = paintBridge(city, 'lm:ggb', obj, 'Golden Gate Bridge');
if (!ref) throw new Error('the Golden Gate is not paintable');

// the deck's middle station and its direction there (bridge-paint.mjs's bridge().at)
const d: number[][] = lm.deck;
const s = [0];
let L = 0;
for (let i = 1; i < d.length; i++) s.push((L += Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1])));
let i = 0;
while (i + 2 < d.length && L / 2 > s[i + 1]) i++;
const k = (L / 2 - s[i]) / (s[i + 1] - s[i]), dx = d[i + 1][0] - d[i][0], dz = d[i + 1][1] - d[i][1], n = Math.hypot(dx, dz);
const m = { x: d[i][0] + dx * k, z: d[i][1] + dz * k, top: d[i][2] + (d[i + 1][2] - d[i][2]) * k, ux: dx / n, uz: dz / n };
await pump(city, m.x, m.z);

const g = makeGame(city);
const f = g.flight;
const dt = 1 / 30;
const idle = { sx: 0, sy: 0, dragging: false };
const level = () => city.paint.get(ref.index).level;
/** the bus at (x, z), y m up, heading along (fx, fz), holding there, still (bridge-paint.mjs's place) */
const place = (x: number, z: number, y: number, fx: number, fz: number) => {
  Object.assign(f, { x, z, y, heading: Math.atan2(fx, -fz), holdY: y, vy: 0, glideSpeed: 0, speed: 0 });
};
const run = (secs: number) => {
  for (let t = 0; t < secs; t += dt) g.frame(dt, idle);
};
type Row = { pose: string; bus: number[]; glint: boolean; target: boolean; landing: number[] | null; ground: number | null; level: number; note?: string };
const rows: Row[] = [];
for (const pose of ['deck', 'above', 'under']) {
  if (pose === 'deck') place(m.x - m.uz * 110, m.z + m.ux * 110, m.top + 4, m.uz, -m.ux);
  else if (pose === 'above') place(m.x - m.ux * 900, m.z - m.uz * 900, 350, m.ux, m.uz);
  else place(m.x - m.ux * 30, m.z - m.uz * 30, 26, m.ux, m.uz);
  await pump(city, f.x, f.z, f.y);
  run(0.8);
  f.fullness = 1;
  const bus = [f.x, f.y, f.z].map((v) => +v.toFixed(1));
  const e0 = g.events.length;
  const r = g.tap();
  run(config.splat.inhale + 2.5);
  const hit = g.events.slice(e0).find((e) => e.ev === 'impact' || e.ev === 'miss') as { pos?: number[] } | undefined;
  const landing = hit?.pos ? hit.pos.map((v) => +v.toFixed(1)) : null;
  rows.push({ pose, bus, glint: r.glint === ref, target: r.target === ref, landing, ground: landing ? +city.groundAt(landing[0], landing[2]).toFixed(1) : null, level: level() });
  run(1.5);
}

// ---- the super splat from under the deck: a fresh SuperSplat a row over this game's flight, aim and Splatter, in main.ts's frame order (the aim, the super, then
// the Splatter), its fx, sound and camera stubbed
const nop = () => {};
const mouth = new THREE.Vector3(), vel = new THREE.Vector3();
const superOf = () =>
  new SuperSplat({
    flight: f, city, splatter: g.splatter, aimer: g.aimer,
    particles: { geyser: nop, splash: nop, burst: nop, fling: nop, puff: nop } as unknown as SuperHost['particles'],
    fx: { motes: nop, sparks: nop, halo: nop, arcs: 0 } as unknown as SuperHost['fx'],
    audio: new Proxy({}, { get: () => nop }) as SuperHost['audio'],
    rig: { kick: nop } as unknown as SuperHost['rig'],
    mouth: () => mouth.set(f.x + f.fx * 9, f.y, f.z + f.fz * 9),
    busVel: () => vel.set(f.fx * f.speed, f.vy, f.fz * f.speed),
    exhaust: (o) => o.set(f.x, f.y, f.z),
    hatch: (o) => o.set(f.x, f.y + 2, f.z),
    tap: () => void g.tap(),
    // (main.ts's: a mega blast is a breath whatever the belly holds, and a breath's `from` is the bus's height)
    mega: (shot, radius, _width, hitStop, tag) => {
      f.barfT = -1;
      f.fullness = 1;
      f.tryBarf();
      g.splatter.barf(shot.x, shot.z, { drop: shot.drop, travel: config.splat.inhale + shot.travel, target: shot.target, y: shot.y, exact: shot.exact, from: f.y, radius, hitStop, super: tag });
    },
    flash: nop,
    hitStop: nop,
    sign: nop,
  });
// (and the FIREHOSE from 350 m over the deck's line, as the tap above: from over the deck it reaches it, and takes it up to 3)
for (const pose of ['mega', 'hose', 'hose above'] as const) {
  const under = pose !== 'hose above';
  if (under) place(m.x - m.ux * 30, m.z - m.uz * 30, 26, m.ux, m.uz);
  else place(m.x - m.ux * 900, m.z - m.uz * 900, 350, m.ux, m.uz);
  await pump(city, f.x, f.z, f.y);
  run(0.8);
  const sup = superOf();
  const bus = [f.x, f.y, f.z].map((v) => +v.toFixed(1));
  const e0 = g.events.length;
  let top = f.y, frames = 0;
  if (pose === 'mega') sup.qaCharge(5);
  else sup.chargeStart(config.splat.superCharge - 0.05);
  // (until it's cooling down: the MEGA let go, or the FIREHOSE's closer fired; then its last blasts land)
  for (let t = 0; t < 12 && sup.phase !== 'cooldown'; t += dt, frames++) {
    for (let j = 0; j < 4; j++) f.step(dt / 4, idle, city);
    g.t += dt;
    g.aimer.update(f, g.t, false);
    sup.update(dt);
    g.splatter.update(dt);
    top = Math.max(top, f.y);
  }
  run(3);
  const ev = g.events.slice(e0);
  const hits = ev.filter((e) => e.ev === 'impact').length, misses = ev.filter((e) => e.ev === 'miss').length;
  const kind = sup.stats.kind, note = `${kind || 'nothing'} after ${(frames * dt).toFixed(1)} s, ${sup.stats.impacts} impacts (${hits} that painted, ${misses} into the water), the bus at most ${top.toFixed(1)} m up`;
  // (the row means nothing if it wasn't the super it asks for, or the bus under the deck rose to it)
  const sound = kind === (pose === 'mega' ? 'mega' : 'firehose') && (!under || top < m.top - 20);
  rows.push({ pose, bus, glint: false, target: false, landing: null, ground: null, level: sound ? level() : NaN, note });
}

let fails = 0;
const want: Record<string, [boolean, number]> = { deck: [true, 1], above: [true, 2], under: [false, 2], mega: [false, 2], hose: [false, 2], 'hose above': [false, 3] };
for (const r of rows) {
  const [glints, lv] = want[r.pose];
  const ok = r.glint === glints && r.target === glints && Math.round(r.level) === lv;
  if (!ok) fails++;
  const what = r.note ?? `glint ${r.glint}, target ${r.target}; landed ${r.landing ? `${r.landing.join(', ')} (ground ${r.ground})` : 'nowhere'}`;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${r.pose}: bus ${r.bus.join(', ')}; ${what}; the bridge at level ${r.level} (wanted ${lv})`);
}
console.log(`[${MODE}] ${fails ? `${fails} of ${rows.length} failed` : `all ${rows.length} rows: bridge-paint.mjs's aim rows, and the super splat from under the deck leaves the bridge alone`}`);
process.exit(fails ? 1 : 0);
