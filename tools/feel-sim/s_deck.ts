// A breath from under the Golden Gate's deck (docs/reviews/main-live-2026-11-05.md, m5): tools/bridge-paint.mjs's aim rows offline, on the real city, the real
// bridge (Bridges.ts, made paintable as main.ts makes it) and the real Aimer and Splatter. In order on one bridge, as there: a tap from the deck's height 110 m beside
// its middle, one from 350 m over its line 900 m back, then one from under the deck 30 m back, 26 m up. The first two glint it and take it a level each, 1 then 2;
// the one from under glints nothing, lands on the water, and must leave it at 2.
//   node tools/feel-sim/run.mjs s_deck.ts
import { newCity, pump, makeGame, manifest, config, MODE } from './lib';
import { makeGoldenGate, bridgeObstacles, paintBridge } from '@src/world/Bridges';

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
const level = () => city.paint.get(ref.index).level;
/** the bus at (x, z), y m up, heading along (fx, fz), holding there, still (bridge-paint.mjs's place) */
const place = (x: number, z: number, y: number, fx: number, fz: number) => {
  Object.assign(f, { x, z, y, heading: Math.atan2(fx, -fz), holdY: y, vy: 0, glideSpeed: 0, speed: 0 });
};
const run = (secs: number) => {
  for (let t = 0; t < secs; t += dt) g.frame(dt, { sx: 0, sy: 0, dragging: false });
};
const rows: Array<{ pose: string; bus: number[]; glint: boolean; target: boolean; landing: number[] | null; ground: number | null; level: number }> = [];
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

let fails = 0;
const want: Record<string, [boolean, number]> = { deck: [true, 1], above: [true, 2], under: [false, 2] };
for (const r of rows) {
  const [glints, lv] = want[r.pose];
  const ok = r.glint === glints && r.target === glints && Math.round(r.level) === lv;
  if (!ok) fails++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${r.pose}: bus ${r.bus.join(', ')}; glint ${r.glint}, target ${r.target}; landed ${r.landing ? `${r.landing.join(', ')} (ground ${r.ground})` : 'nowhere'}; the bridge at level ${r.level} (wanted ${lv})`);
}
console.log(`[${MODE}] ${fails ? `${fails} of ${rows.length} failed` : `all ${rows.length} rows as bridge-paint.mjs's aim rows want`}`);
process.exit(fails ? 1 : 0);
