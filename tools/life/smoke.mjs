#!/usr/bin/env node
// Life stands up on the street (?life), at a fixed step: node tools/life/smoke.mjs <out dir>. BASE is the page (http://localhost:4179/).
//   up        the street boots with life: its worker ticks, snapshots come back, planes in them, drawn as models or specks
//   carried   between snapshots each plane is carried on by its velocity: a plane moves every frame, not every tenth of a second
//   programs  nothing compiles after the warm-up: the programs at the first frame are the programs 300 frames on (L6's cloud leg)
//   picnics   in Mission Dolores Park on a Saturday at 15:00: drawn, those within 300 m of the lens as models, each on grass and on the ground there (a frame, picnics.png)
//   cars      on the roads round the bus at 09:30, from the world's graphs, none past 1.2 km, buses and trucks among them: drawn, the near ones as models, each on the
//             ground's height (but where a drawn deck carries it)
//   ferries   on their routes from routes.bin, the Ferry Building their hub: out on the water at 09:30, each at the water's height, drawn
//   night     the same at 21:00, fewer, with their lights on: a speck at each one's nose that's too small to show its model's lamps (a frame of it, night.png)
//   worker    L2: the host's two snapshot buffers go out and come back, none lost and none made
//   no life   the same page without ?life has no life on it
// Life draws only what's in the lens's view, so a row's drawn counts are a share of what's in reach. A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv[2] ?? 'shots/tmp/life-smoke';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(76)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => (window.__qa = { holdFrames: 4, held: false }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 300)));
  const frames = async (n) => {
    await page.evaluate((k) => (window.__qa = { holdFrames: k, held: false }), n);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 600000, polling: 50 });
  };
  const open = async (q, t = '2026-11-05T17:30:00Z', at = 'lat=37.7955&lon=-122.3937') => {
    await page.goto(`${BASE}?nohud&fixeddt=0.033333&t=${t}&${at}${q}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 600000, polling: 500 });
  };
  await open('&life');
  const programs0 = await page.evaluate(() => window.__game.pipeline.renderer.info.programs.length);
  await frames(30);
  const q = () => page.evaluate(() => ({ ...window.__game.life?.qa }));
  const a = await q();
  row('up: the worker ticks, its snapshots come back with planes, drawn as models or specks', !!a && a.snaps > 0 && a.rows > 0 && a.models + a.specks > 0, a);
  const at = () => page.evaluate(() => { const l = window.__game.life, s = l.pools.specks.pos, m = l.pools.large.mesh.instanceMatrix.array; return [s[0], s[1], s[2], m[12], m[13], m[14]].map((v) => +v.toFixed(2)); });
  const p0 = await at();
  await frames(1);
  const p1 = await at();
  row('carried: from one frame to the next a plane moves, between snapshots too', p0.some((v, i) => v !== p1[i]), { p0, p1 });
  // (in steps of 30: on a loaded cloud machine 270 frames at once outran the wait)
  for (let i = 0; i < 9; i++) await frames(30);
  const programs1 = await page.evaluate(() => window.__game.pipeline.renderer.info.programs.length);
  row('programs: nothing compiles after the warm-up, 300 frames on', programs1 === programs0, { atFirst: programs0, after300: programs1, life: await q() });
  // (cars: on the roads round the bus, each on the ground's height there but where a deck carries it over, and how many of them the graphs' regions in gave)
  const carsNow = () => page.evaluate(() => {
    const g = window.__game, l = g.life, s = l.snap, rows = s.rows, n = s.u32[2], cam = g.camera.position;
    let cars = 0, near = 0, onGround = 0, worstY = 0, far = 0, decks = 0, offGround = 0, buses = 0, trucks = 0, inView = 0, heavyInView = 0;
    // (in the camera's view, a few metres' margin: the host culls what's out of it)
    const vi = g.camera.matrixWorldInverse.elements, pr = g.camera.projectionMatrix.elements;
    const seen = (x, y, z) => {
      const ex = vi[0] * x + vi[4] * y + vi[8] * z + vi[12], ey = vi[1] * x + vi[5] * y + vi[9] * z + vi[13], ez = vi[2] * x + vi[6] * y + vi[10] * z + vi[14];
      if (ez > -1) return false;
      const w = -ez, px = (pr[0] * ex + pr[8] * ez) / w, py = (pr[5] * ey + pr[9] * ez) / w;
      return Math.abs(px) < 0.9 && Math.abs(py) < 0.9;
    };
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      if (rows[o + 1] !== 5 && rows[o + 1] !== 9) continue;
      cars++;
      if (rows[o + 1] === 9) (rows[o + 14] & 7) === 1 ? buses++ : trucks++;
      const x = rows[o + 2], z = rows[o + 4], dy = Math.abs(rows[o + 3] - g.city.groundAt(x, z));
      if (Math.hypot(x - cam.x, rows[o + 3] - cam.y, z - cam.z) < 300) {
        near++;
        if (rows[o + 11] > 0.5 && seen(x, rows[o + 3], z)) {
          inView++;
          if (rows[o + 1] === 9) heavyInView++;
        }
      }
      // (on a drawn deck, flagged by the worker, it may stand over the ground; anywhere else it's on it)
      if (rows[o + 12] & 2) decks++;
      else if (dy < 1) onGround++;
      else {
        offGround++;
        worstY = Math.max(worstY, dy);
      }
      far = Math.max(far, Math.hypot(x - g.flight.x, z - g.flight.z));
    }
    return { cars, buses, trucks, near, inView, heavyInView, drawn: l.qa.cars, heavyModels: l.qa.heavy, lights: l.qa.lights, onGround, decks, offGround, worstOffM: +worstY.toFixed(1), farthestM: Math.round(far) };
  });
  // (the graphs come in a region at a time after the first ticks: a few seconds of the game's clock)
  for (let i = 0; i < 6 && (await carsNow()).cars < 50; i++) await frames(30);
  const cars = await carsNow();
  row("cars: on the roads round the bus at 09:30, buses and trucks among them, drawn, the near ones in view as models, each on the ground's height but on a drawn deck", cars.cars > 50 && cars.near > 0 && cars.drawn >= Math.min(20, cars.inView) && cars.offGround === 0 && cars.farthestM <= 1200 && cars.lights === 0 && cars.buses > 0 && cars.trucks > 0 && (cars.heavyInView === 0 || cars.heavyModels > 0), cars);
  // (ferries: every vessel in the snapshot, on the water, the near ones drawn; underway is a speed over 1 m/s)
  const boats = await page.evaluate(() => {
    const g = window.__game, l = g.life, s = l.snap, rows = s.rows, n = s.u32[2];
    let ferries = 0, underway = 0, offWater = 0, sails = 0, near = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 16, k = rows[o + 1];
      if (k === 7) sails++;
      if (k !== 6) continue;
      ferries++;
      if (Math.hypot(rows[o + 5], rows[o + 7]) > 1) underway++;
      if (Math.abs(rows[o + 3] + 0.6) > 0.01) offWater++;
      if (Math.hypot(rows[o + 2] - g.flight.x, rows[o + 4] - g.flight.z) < 3000) near++;
    }
    return { ferries, underway, offWater, near, sails, drawn: l.qa.boats };
  });
  row('ferries: on their routes at 09:30, out on the water, at its height, the near ones drawn', boats.ferries >= 10 && boats.underway >= 5 && boats.offWater === 0 && boats.near > 0 && boats.drawn > 0, boats);
  // (L2: the host's two buffers, each with the host, in a snapshot it holds, or out with a tick: none lost and none made)
  const bufs = await page.evaluate(() => { const l = window.__game.life; return { sent: l.qa.sent, back: l.qa.snaps, free: l.free.length, held: l.snap ? 1 : 0 }; });
  row('worker: every buffer comes back, the same two all along', bufs.free + bufs.held + (bufs.sent - bufs.back) === 2 && bufs.back >= bufs.sent - 2 && bufs.sent > 50, bufs);
  await page.screenshot({ path: join(dir, 'life.png') });
  // (at night: 21:00 in San Francisco, the windows lit)
  await open('&life', '2026-11-06T05:00:00Z');
  for (let i = 0; i < 8 && (await carsNow()).cars < 20; i++) await frames(30);
  const night = await carsNow();
  row('night: fewer cars at 21:00, their lights on, a speck at the nose of each too small to show its lamps', night.cars > 20 && night.cars < cars.cars && night.lights > 0, night);
  await page.screenshot({ path: join(dir, 'night.png') });
  // (picnics: Mission Dolores Park on a Saturday at 15:00, the bus low over its north-east corner; its grass comes in a tile at a time, and its park with its region's graph)
  await open('&life', '2026-11-07T23:00:00Z', 'lat=37.7605&lon=-122.4262');
  const lawn = () => page.evaluate(() => {
    const g = window.__game, l = g.life, s = l.snap, rows = s.rows, n = s.u32[2], cam = g.camera.position;
    let groups = 0, near = 0, offGrass = 0, worstY = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      if (rows[o + 1] !== 8) continue;
      groups++;
      const x = rows[o + 2], z = rows[o + 4];
      if (Math.hypot(x - cam.x, rows[o + 3] - cam.y, z - cam.z) < 300) near++;
      if (g.city.groundClassAt(x, z) !== 1) offGrass++;
      worstY = Math.max(worstY, Math.abs(rows[o + 3] - g.city.groundAt(x, z)));
    }
    return { groups, near, models: l.qa.people, offGrass, worstYm: +worstY.toFixed(2), busY: Math.round(g.flight.y) };
  });
  for (let i = 0; i < 12 && (await lawn()).groups < 50; i++) await frames(30);
  const pic = await lawn();
  row('picnics: in Dolores Park on a Saturday at 15:00, drawn, the near ones as models, each on grass and on the ground there', pic.groups > 50 && pic.near > 0 && pic.models > 20 && pic.offGrass === 0 && pic.worstYm < 0.5, pic);
  await page.screenshot({ path: join(dir, 'picnics.png') });
  await open('');
  const none = await page.evaluate(() => ({ life: window.__game.life ?? null, workers: performance.getEntriesByType('resource').filter((r) => /lifeWorker|lifeBoot/.test(r.name)).map((r) => r.name.split('/').pop()) }));
  row('no life: the same page without ?life has no life, and fetched none of it', none.life === null && none.workers.length === 0, none);
} catch (e) {
  bad++;
  console.log('FAIL ', e.message);
} finally {
  row('no page errors', !errors.length, errors.slice(0, 5));
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
