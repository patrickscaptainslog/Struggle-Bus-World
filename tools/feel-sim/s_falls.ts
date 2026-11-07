// The Waterfall on the real city (src/fx/Falls.ts, src/world/falls.ts, &falls; docs/specs/shots/BUILT.md, "Step 8"): taps through the real Splatter on 20
// towers over 40 m and 20 buildings under it within a kilometre of the Financial District's middle, at 1/60 s. Each tower hit on its roof pours once (a
// slot of the runs at its impact's height and time, its drops, one per 1.25 m of fall up to 160, and its pool as the fastest runs reach the street: the
// tower's hue on the ground round its foot, life told of it with kind 'falls'); none under 40 m pours; a tower hit again pours no more; and none pours from a
// face struck under 40 m up, a drive-by's blast (Curb's side), a breath at a mover on the street or in the air, or a hose's impact.
//   node tools/feel-sim/run.mjs s_falls.ts
import { newCity, pump, ll, save, MODE, config, type BuildingRef } from './lib';
import { Splatter, type Blast } from '@src/game/Splat';
import { Falls, fallsTune } from '@src/fx/Falls';
import { FALLS, fallsLast, fallTime } from '@src/world/falls';
import { globals } from '@src/render/materials';

const city = await newCity();
const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) fails.push(m); };
const r1 = (x: number) => Math.round(x * 10) / 10;
const counting = { properties: { get: () => ({}) }, getContext: () => ({ texSubImage2D() {} }), state: { activeTexture() {}, bindTexture() {}, pixelStorei() {} } } as any;
const [cx, cz] = ll(37.7946, -122.3999);
await pump(city, cx, cz, 200);
let t = 0;
const pools: Array<{ x: number; z: number; r: number; hue: number; kind: string; arrive: number }> = [];
const falls = new Falls(city, null, {
  landing: (x, z) => city.groundAt(x, z),
  pool: (x, _y, z, r, hue, tag, arrive) => pools.push({ x, z, r, hue, kind: tag.kind, arrive }),
  trickle: () => {},
  plop: () => {},
  slap: () => {},
});
falls.on = true;
let last: Blast | null = null;
const splatter = new Splatter(city, {
  geyser: () => {},
  impact: (b: Blast) => { last = b; falls.impact(b, t); },
  bloom: () => {},
  primary: () => {},
  hitStop: () => {},
} as any);
const run = (secs: number) => {
  for (let i = 0; i < Math.round(secs * 60); i++) {
    t += 1 / 60;
    splatter.update(1 / 60);
    falls.update(t);
    globals.uTime.value = t;
    city.ground.work();
    city.ground.flush(counting, 1 / 60);
  }
};
const all = city.buildingsWithin(cx, cz, 1000, []).map((n) => n.ref).filter((r) => r.stableId >= 0 && r.roofY - r.baseY >= config.splat.minTargetHeight);
// (a tower whose roof at its middle is over 40 m up: a tap there lands on it, not on a podium beside it)
const tall = all.filter((r) => r.roofY - r.baseY > FALLS.tall + 2 && city.roofAtPart(r, r.cx, r.cz, Infinity) - r.baseY > FALLS.up + 2);
const short = all.filter((r) => r.roofY - r.baseY < FALLS.tall - 2);
// (spread out: every other one by distance from the middle, so no two share a blast)
const pick = (list: BuildingRef[], n: number, skip = new Set<number>()) => {
  const out: BuildingRef[] = [];
  for (const r of list) {
    if (out.length >= n) break;
    if (skip.has(r.index) || out.some((o) => Math.hypot(o.cx - r.cx, o.cz - r.cz) < 2.2 * config.splat.blastRadius)) continue;
    out.push(r);
  }
  return out;
};
const towers = pick(tall, 20), houses = pick(short, 20);
const used = new Set([...towers, ...houses].map((r) => r.index));
const spare = pick(tall, 40, used).filter((r) => !towers.includes(r));
console.log(`towers over ${FALLS.tall} m within 1 km: ${tall.length}; under: ${short.length}; picked ${towers.length} and ${houses.length}, ${spare.length} spare`);
ok(towers.length === 20 && houses.length === 20 && spare.length >= 5, `20 towers, 20 under 40 m and 5 spare picked (${towers.length}, ${houses.length}, ${spare.length})`);
const rows: unknown[] = [];
/** A tap on `ref`'s roof (or what opts say), and the 3 s after it: did it pour? */
async function hit(ref: BuildingRef, label: string, opts: Record<string, unknown> = {}) {
  // (its tiles in, as round the bus on the page)
  await pump(city, ref.cx, ref.cz, 150);
  city.paint.resetAll();
  const p0 = falls.stats.pours, d0 = falls.stats.drops, n0 = pools.length;
  splatter.barf(ref.cx, ref.cz, { target: ref, drop: 120, hitStop: 0, ...opts });
  const tHit = t + config.splat.impactDelay;
  run(config.splat.impactDelay + 0.02);
  const b = last as Blast | null;
  const poured = falls.stats.pours > p0;
  const slot = fallsLast.find((s) => s.index === ref.index && Math.abs(s.t0 - t) < 0.1);
  const fall = b ? Math.min(b.pos.y, ref.roofY) - city.groundAt(ref.cx, ref.cz) : 0;
  run(Math.max(0.3, fallTime(fall)) + 0.6);
  const rec = city.paint.get(ref.index);
  // (the pool's ground: round the foot, 4 m past the footprint's radius, where nothing stands)
  let wet = 0, dry = 0;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, x = ref.cx + Math.cos(a) * (ref.rad + 4), z = ref.cz + Math.sin(a) * (ref.rad + 4);
    const s = city.ground.sample(x, z);
    if (s && s.cov >= 0.5 && s.hue === rec.color) wet++;
    else dry++;
  }
  const row = { label, index: ref.index, h: r1(ref.roofY - ref.baseY), at: b ? r1(b.pos.y - ref.baseY) : null, poured, slot: !!slot, drops: falls.stats.drops - d0, want: Math.min(fallsTune.drops, Math.floor(fall / fallsTune.dropEvery)), pool: pools.length > n0 ? pools[pools.length - 1] : null, wet, dry, tHit: r1(tHit) };
  rows.push(row);
  return row;
}
for (const r of towers) {
  const w = await hit(r, 'tower');
  ok(w.poured && w.slot, `tower ${r.index} (${w.h} m, hit ${w.at} m up): it pours, in a slot at its impact`);
  ok(w.drops === w.want && w.drops > 0, `tower ${r.index}: ${w.want} drops (${w.drops})`);
  ok(!!w.pool && w.pool.kind === 'falls' && Math.abs(w.pool.r - (r.rad + fallsTune.pool)) < 0.5, `tower ${r.index}: its pool, kind 'falls', ${r1(r.rad + fallsTune.pool)} m (${JSON.stringify(w.pool)})`);
  ok(w.wet >= 8, `tower ${r.index}: its pool's ground in its hue round its foot (${w.wet} of 16)`);
  const again = await hit(r, 'tower again');
  ok(!again.poured, `tower ${r.index}: hit again, no second pour`);
}
for (const r of houses) {
  const w = await hit(r, 'under 40 m');
  ok(!w.poured && !w.pool, `building ${r.index} (${w.h} m): no pour`);
}
// what never pours, each on a fresh tower
const [low, drive, mover, air, hose] = spare;
{
  const w = await hit(low, 'a face 20 m up', { exact: true, y: low.baseY + 20, x: low.cx });
  ok(!w.poured, `tower ${low.index}: struck ${w.at} m up its face, no pour`);
  const d = await hit(drive, 'drive-by', { side: { x: drive.cx, z: drive.cz - 30, nx: 0, nz: 1 } });
  ok(!d.poured, `tower ${drive.index}: a drive-by's blast, no pour`);
  const m = await hit(mover, 'a mover on the street', { target: null, exact: true, y: city.groundAt(mover.cx, mover.cz + mover.rad + 6) + 1, moverBlock: true });
  ok(!m.poured, `tower ${mover.index}: a breath at a car beside it, no pour`);
  const a = await hit(air, 'a mover in the air', { mover: { x: air.cx, y: air.roofY + 30, z: air.cz } });
  ok(!a.poured, `tower ${air.index}: a breath at a plane over it, no pour`);
  const h = await hit(hose, 'a hose', { hose: true, radius: 40 });
  ok(!h.poured, `tower ${hose.index}: a hose's impact, no pour`);
}
save('falls', rows);
console.log(fails.length ? `[${MODE}] FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `[${MODE}] falls checks: all ${checks} passed (${rows.length} rows)`);
process.exit(fails.length ? 1 : 0);
