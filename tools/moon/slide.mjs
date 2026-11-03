#!/usr/bin/env node
// The map's slide (docs/specs/moon/FREEFLIGHT.md, Stage 2) flown through at a fixed step: node tools/moon/slide.mjs <out dir> [--gear=0] [--q=site=TYCHO]
// ?moon, the bus flying on by itself. For each slide: a frame (a), the map slid between it and the next (b), and the one after (c), so a to b is the join and b to c
// is what a frame changes by itself. The bus must be where it was by the new map, over the same ground; no tile may go and nothing may compile; a painted crater, its
// garden and a blast on open ground stay where they are; then it flies on over the new map, which loads round it as ever. Both axes, both ways, then a breath
// still in the air at a join, and last a join the game makes by itself, flown through. Frames land in <out dir>; tools/moon/slide-diff.py says how much a join changed the picture.
// BASE is the page (http://localhost:4179/). Exit 1 if a row fails.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const dir = args.find((a) => !a.startsWith('--')) ?? 'shots/tmp/slide';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
// (the game's slide is SLIDE, past SLIDE_AT; one forced from near the middle is half of it, D, or the bus would be off the map's regions)
const DT = 1 / 30, SLIDE = 131072, SLIDE_AT = 70000, D = SLIDE / 2;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const errors = [];
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const log = [];
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.goto(`${BASE}?moon&nohud&fixeddt=${DT.toFixed(6)}${opt.q ? '&' + opt.q : ''}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  const frames = async (n) => {
    await page.evaluate((k) => (window.__qa = { ...(window.__qa ?? {}), holdFrames: k, held: false }), n);
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 600000, polling: 50 });
  };
  await frames(0);
  await page.evaluate(() => (window.__game.flight.fullness = 0.5));
  const read = () => page.evaluate(() => {
    const g = window.__game, f = g.flight, c = g.camera, r = (x, k = 2) => +x.toFixed(k);
    return { slides: g.slides, x: r(f.x), z: r(f.z), y: r(f.y), ground: r(g.city.groundAt(f.x, f.z)), speed: r(f.speed), heading: r((f.heading * 180) / Math.PI, 3), camX: r(c.position.x), camY: r(c.position.y), camZ: r(c.position.z), regions: g.city.loadedRegionCount(), patches: g.moon.far.patchCount, programs: g.pipeline.renderer.info.programs.length, lat: r(g.moon.frame.lat0, 4), lon: r(g.moon.frame.lon0, 4), geo: g.pipeline.renderer.info.memory.geometries, tex: g.pipeline.renderer.info.memory.textures, heap: r((performance.memory?.usedJSHeapSize ?? 0) / 1048576, 1) };
  });
  const shot = (name) => page.screenshot({ path: join(dir, `${name}.png`) });
  // settle: the bus flying on, the ground loaded round it
  if (Number(opt.gear)) await page.evaluate((k) => {
    const g = window.__game;
    for (let i = 0; i < 8 && g.controls.turbo.gear !== k; i++) g.input.onTurbo(1);
  }, Number(opt.gear));
  await frames(150);
  // a crater near the bus painted to level 2 first: it must stay painted, where it stands by the new map
  const paint = await page.evaluate(() => {
    const g = window.__game, f = g.flight, c = g.moon.cratersNear(f.x + f.fx * 300, f.z + f.fz * 300, 900, 60).find((k) => k.r > 40 && k.r < 500 && !k.name);
    if (!c) return null;
    g.moon.paint.qaHit(c.id, g.clock(), 3);
    g.moon.paint.qaHit(c.id, g.clock() + 0.2, 5);
    return { id: c.id, x: c.x, z: c.z, r: c.r };
  });
  // and a blast on open ground ahead, for ground paint
  let gat = await page.evaluate(() => {
    const g = window.__game, f = g.flight, x = f.x + f.fx * 90, z = f.z + f.fz * 90;
    g.splatter.barf(x, z, { drop: 25 });
    return [x, z];
  });
  await frames(60);
  const hueAt = (x, z) => page.evaluate(([px, pz]) => window.__game.moon.paint.hueAt(px, pz), [x, z]);
  const groundAt = (x, z) => page.evaluate(([px, pz]) => window.__game.city.ground.sample(px, pz), [x, z]);
  const rims = () => page.evaluate(() => window.__game.moon.paint.rim?.count ?? 0);
  let at = paint ? [paint.x, paint.z] : null;
  const h0 = at ? await hueAt(at[0], at[1]) : -1, g0 = await groundAt(gat[0], gat[1]), r0 = await rims();
  console.log('  painted', JSON.stringify(paint), 'hue', h0, 'ground', JSON.stringify(g0), 'garden', r0);
  const m0 = await read(), p0 = m0.programs;
  const joins = [[D, 0], [0, -D], [-D, D]];
  for (let i = 0; i < joins.length; i++) {
    const [dx, dz] = joins[i];
    await frames(1);
    const a = await read();
    await shot(`join${i}-a`);
    await page.evaluate(([x, z]) => window.__game.slide(x, z), [dx, dz]);
    await frames(1);
    const b = await read();
    await shot(`join${i}-b`);
    await frames(1);
    const c = await read();
    await shot(`join${i}-c`);
    log.push({ join: i, dx, dz, a, b, c });
    // where it is by the new map: a frame on from a, less the slide
    const stepX = c.x - b.x, stepZ = c.z - b.z;
    const offX = b.x - (a.x - dx) - stepX, offZ = b.z - (a.z - dz) - stepZ;
    row(`join ${i} (${dx}, ${dz}): the bus is where it was, by the new map`, Math.hypot(offX, offZ) < 0.5 && b.slides === a.slides + 1, { off: +Math.hypot(offX, offZ).toFixed(3), slides: b.slides });
    row(`join ${i}: over the same ground, and the lens with it`, Math.abs(b.ground - a.ground) < 1 && Math.abs(b.camX - (a.camX - dx)) < 30 && Math.abs(b.camZ - (a.camZ - dz)) < 30, { ground: [a.ground, b.ground], cam: [a.camX - dx, b.camX, a.camZ - dz, b.camZ] });
    row(`join ${i}: no tile goes, the far field stands, nothing compiles`, b.regions >= a.regions && b.patches > 0 && b.programs === p0, { regions: [a.regions, b.regions], patches: [a.patches, b.patches], programs: [p0, b.programs] });
    if (at) {
      at = [at[0] - dx, at[1] - dz];
      const h = await hueAt(at[0], at[1]), r = await rims();
      row(`join ${i}: the painted crater is painted, where it stands by the new map`, h0 >= 0 && h === h0, { hue: [h0, h], at });
      row(`join ${i}: its garden stands, all of it, in the same frame`, r0 > 0 && r === r0, { garden: [r0, r] });
    }
    gat = [gat[0] - dx, gat[1] - dz];
    const gp = await groundAt(gat[0], gat[1]);
    row(`join ${i}: the blast on open ground is painted, where it is by the new map`, !!g0 && g0.cov >= 0.5 && !!gp && gp.cov >= 0.5 && gp.hue === g0.hue, { ground: [g0, gp] });
    await frames(90);
    const d = await read();
    await shot(`join${i}-d`);
    row(`join ${i}: 3 s on, the new map loads round the bus and holds`, d.regions >= a.regions - 2 && d.patches > 0 && d.programs === p0 && Math.abs(d.y - d.ground) < 400, { regions: d.regions, patches: d.patches, h: +(d.y - d.ground).toFixed(1), at: [d.x, d.z] });
  }
  // a breath in the air at a join: it lands on the crater it was for, on the new map, and takes it up a level
  if (paint) {
    const was = await page.evaluate((id) => {
      const g = window.__game, p = g.moon.paint, rec = [...p.recs.values()].find((r) => r.id === id);
      return rec ? { level: rec.level, x: rec.x, z: rec.z, recs: p.recs.size } : null;
    }, paint.id);
    await page.evaluate(([id, x, z, r]) => {
      const tag = { id, x, z, r, a: 0.3, b: 0.5, c: 0.5, age: 0, kind: 0, name: null, wob: null, turn: 0, rec: null };
      window.__game.splatter.barf(x, z, { drop: 30, travel: 1.5, tag });
    }, [paint.id, was?.x ?? 0, was?.z ?? 0, paint.r]);
    await frames(8);
    await page.evaluate(([x, z]) => window.__game.slide(x, z), [D, 0]);
    await frames(75);
    // (where the crater is by the new map is what the new map makes of it: and nothing painted is left back where the old map had it)
    const now = await page.evaluate((id) => {
      const g = window.__game, f = g.flight, p = g.moon.paint, rec = [...p.recs.values()].find((r) => r.id === id), k = g.moon.crater(id);
      const behind = [...p.recs.values()].filter((r) => Math.hypot(r.x - f.x, r.z - f.z) > 20000).length;
      return rec && k ? { level: rec.level, x: rec.x, z: rec.z, kx: k.x, kz: k.z, recs: p.recs.size, behind, live: p.liveCount } : null;
    }, paint.id);
    const off = now ? Math.hypot(now.x - now.kx, now.z - now.kz) : Infinity;
    row('a breath in the air at a join lands on its crater, by the new map, a level up', !!was && !!now && now.level === Math.min(3, was.level + 1) && now.behind === 0 && off < 0.5, { was, now, off: +off.toFixed(2) });
  }
  // last, a join the game makes by itself: the bus held a little short of SLIDE_AT while the ground loads round it, then let go, east, to fly through it
  await page.evaluate((x) => {
    const g = window.__game, f = g.flight;
    window.__qa.pin = { x, y: f.y, z: f.z, heading: Math.PI / 2 };
  }, SLIDE_AT - 45);
  await frames(150);
  await page.evaluate(() => {
    const g = window.__game, p = window.__qa.pin;
    p.y = g.city.groundAt(p.x, p.z) + 25;
  });
  await frames(45);
  const s0 = (await read()).slides;
  await page.evaluate(() => (window.__qa.pin = null));
  // (every frame of it in <out dir>/nat too, for tools/moon/pops.py)
  mkdirSync(join(dir, 'nat'), { recursive: true });
  let before = null, i = 0, nf = 0;
  const nat = () => page.screenshot({ path: join(dir, 'nat', `f${String(nf++).padStart(4, '0')}.png`) });
  for (; i < 150; i++) {
    const a = await read();
    if (a.slides > s0) break;
    before = a;
    await shot('join3-a');
    await nat();
    await frames(1);
  }
  const b = await read();
  await shot('join3-b');
  await nat();
  await frames(1);
  const c = await read();
  await shot('join3-c');
  await nat();
  for (let k = 0; k < 20; k++) {
    await frames(1);
    await nat();
  }
  log.push({ join: 3, natural: true, before, b, c });
  const stepX = c.x - b.x;
  row('a join by itself: past 70 km east the map slides once, by SLIDE, and the bus is where it was by the new map', !!before && b.slides === s0 + 1 && before.x > SLIDE_AT - 50 && Math.abs(b.x - (before.x - SLIDE) - stepX) < 0.5 && Math.abs(b.ground - before.ground) < 1, { frames: i, x: [before?.x, b.x], slides: [s0, b.slides], ground: [before?.ground, b.ground] });
  // (2^17: every level ?moon has comes over as it is, so no patch of the far field goes)
  // (what the GPU and the page hold, from before the first join to after the last: logged, for the hand-in)
  console.log('  memory', JSON.stringify({ geometries: [m0.geo, c.geo], textures: [m0.tex, c.tex], heapMB: [m0.heap, c.heap] }));
  row('a join by itself: no tile goes, no far patch goes, nothing compiles', !!before && b.regions >= before.regions && b.patches === before.patches && b.programs === p0, { regions: [before?.regions, b.regions], patches: [before?.patches, b.patches], programs: [p0, b.programs] });
} finally {
  writeFileSync(join(dir, 'slide.json'), JSON.stringify(log, null, 1));
  console.log('errors:', errors.length, errors.slice(0, 6));
  if (errors.length) bad++;
  await browser.close();
}
console.log(bad ? `${bad} failed` : 'all passed');
process.exit(bad ? 1 : 0);
