#!/usr/bin/env node
// Life stands up on the street (?life), at a fixed step: node tools/life/smoke.mjs <out dir>. BASE is the page (http://localhost:4179/).
//   up        the street boots with life: its worker ticks, snapshots come back, planes in them, drawn as models or specks
//   carried   between snapshots each plane is carried on by its velocity: a plane moves every frame, not every tenth of a second
//   programs  nothing compiles after the warm-up: the programs at the first frame are the programs 300 frames on (L6's cloud leg)
//   people    on the sidewalks round the bus at the Ferry Building: drawn, those within 300 m of the lens as models, each on a walkable cell (but the odd one where a run's line between two 2 m cells' middles clips a kerb) and on the ground
//   cars      on the roads round the bus at 09:30, from the world's graphs, none past 1.2 km: drawn, the near ones as models, each on the ground's height (but where a
//             drawn deck carries it)
//   night     the same at 21:00, fewer, with their lights on: a speck at each one's nose that's too small to show its model's lamps (a frame of it, night.png)
//   worker    L2: the host's two snapshot buffers go out and come back, none lost and none made
//   no life   the same page without ?life has no life on it
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
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
  const open = async (q, t = '2026-11-05T17:30:00Z') => {
    await page.goto(`${BASE}?nohud&fixeddt=0.033333&t=${t}&lat=37.7955&lon=-122.3937${q}`, { waitUntil: 'load', timeout: 180000 });
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
  // (people: on the sidewalks, plazas and paths round the bus at the Ferry Building, each on a walkable cell and standing on the ground there)
  const ppl = await page.evaluate(() => {
    const g = window.__game, l = g.life, s = l.snap, rows = s.rows, n = s.u32[2], dt = (l.utc - s.f64[0]) / 1000;
    const cam = g.camera.position;
    let people = 0, off = 0, worstY = 0, near = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      if (rows[o + 1] !== 3) continue;
      people++;
      const x = rows[o + 2] + rows[o + 5] * dt, z = rows[o + 4] + rows[o + 7] * dt, c = g.city.groundClassAt(x, z);
      if (Math.hypot(x - cam.x, rows[o + 3] - cam.y, z - cam.z) < 300) near++;
      if (c !== 3 && c !== 4 && c !== 5) off++;
      worstY = Math.max(worstY, Math.abs(rows[o + 3] - g.city.groundAt(x, z)));
    }
    // (drawn as models from 2 px, specks under that: every one within 300 m of the lens is 3 px or more, so a model; and the bus's height)
    return { people, near, models: l.qa.people, specks: l.qa.specks, off, worstYm: +worstY.toFixed(2), busY: Math.round(g.flight.y) };
  });
  row('people: on the sidewalks round the bus, drawn, the near ones as models, each on a walkable cell and on the ground', ppl.people > 20 && ppl.near > 0 && ppl.models >= ppl.near && ppl.models + ppl.specks >= ppl.people * 0.9 && ppl.off <= ppl.people * 0.05 && ppl.worstYm < 1, ppl);
  // (cars: on the roads round the bus, each on the ground's height there but where a deck carries it over, and how many of them the graphs' regions in gave)
  const carsNow = () => page.evaluate(() => {
    const g = window.__game, l = g.life, s = l.snap, rows = s.rows, n = s.u32[2], cam = g.camera.position;
    let cars = 0, near = 0, onGround = 0, worstY = 0, far = 0, decks = 0, offGround = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      if (rows[o + 1] !== 5) continue;
      cars++;
      const x = rows[o + 2], z = rows[o + 4], dy = Math.abs(rows[o + 3] - g.city.groundAt(x, z));
      if (Math.hypot(x - cam.x, rows[o + 3] - cam.y, z - cam.z) < 300) near++;
      // (on a drawn deck, flagged by the worker, it may stand over the ground; anywhere else it's on it)
      if (rows[o + 12] & 2) decks++;
      else if (dy < 1) onGround++;
      else {
        offGround++;
        worstY = Math.max(worstY, dy);
      }
      far = Math.max(far, Math.hypot(x - g.flight.x, z - g.flight.z));
    }
    return { cars, near, drawn: l.qa.cars, models: l.qa.models - l.qa.people, lights: l.qa.lights, onGround, decks, offGround, worstOffM: +worstY.toFixed(1), farthestM: Math.round(far) };
  });
  // (the graphs come in a region at a time after the first ticks: a few seconds of the game's clock)
  for (let i = 0; i < 6 && (await carsNow()).cars < 50; i++) await frames(30);
  const cars = await carsNow();
  row("cars: on the roads round the bus at 09:30, drawn, the near ones as models, each on the ground's height but on a drawn deck", cars.cars > 50 && cars.near > 0 && cars.drawn >= cars.cars * 0.9 && cars.offGround === 0 && cars.farthestM <= 1200 && cars.lights === 0, cars);
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
