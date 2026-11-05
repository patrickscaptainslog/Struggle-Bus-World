#!/usr/bin/env node
// Life stands up on the street (?life), at a fixed step: node tools/life/smoke.mjs <out dir>. BASE is the page (http://localhost:4179/).
//   up        the street boots with life: its worker ticks, snapshots come back, planes in them, drawn as models or specks
//   carried   between snapshots each plane is carried on by its velocity: a plane moves every frame, not every tenth of a second
//   programs  nothing compiles after the warm-up: the programs at the first frame are the programs 300 frames on (L6's cloud leg)
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
  const open = async (q) => {
    await page.goto(`${BASE}?nohud&fixeddt=0.033333&t=2026-11-05T17:30:00Z&lat=37.7955&lon=-122.3937${q}`, { waitUntil: 'load', timeout: 180000 });
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
  // (L2: the host's two buffers, each with the host, in a snapshot it holds, or out with a tick: none lost and none made)
  const bufs = await page.evaluate(() => { const l = window.__game.life; return { sent: l.qa.sent, back: l.qa.snaps, free: l.free.length, held: l.snap ? 1 : 0 }; });
  row('worker: every buffer comes back, the same two all along', bufs.free + bufs.held + (bufs.sent - bufs.back) === 2 && bufs.back >= bufs.sent - 2 && bufs.sent > 50, bufs);
  await page.screenshot({ path: join(dir, 'life.png') });
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
