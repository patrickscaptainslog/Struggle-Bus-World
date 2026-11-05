// M2 on this laptop's GPU, in real time (the game's own clock: no fixed step, no held frames): what a landed blast's fold costs the frame.
//   node tools/moon/review3/gpu/m2-fold.mjs <build dir> <port> [count, 5]
// First the street's usual height: the plain page (San Francisco) flown at Cruise with the stick let go for 20 s, the bus's height above the ground and a breath's drop (aimNow) read each second.
// Then, each in a new context on ?moon&site=TYCHO:
//   mega    the bus pinned 600 m over open ground, a full MEGA (__game.superSplat held to 9.95 of its 10 s), five times, 4 km apart, 12 s to settle between
//   breath  the bus at Cruise with the stick let go, the real breath (__game.tapSplat) every 6 s, five times
// Prints, for the height and then each blast, one JSON line: the drop, fold's calls (ms after the let-go, ms, radius), the longest task and the longest frame in the 6 s after the let-go,
// and every frame over 50 ms with what ran in it.
import { sleep, serve, launch, open, now, window_ } from './common.mjs';

const [dist, port = '4192', countArg = '5'] = process.argv.slice(2);
if (!dist) throw new Error('usage: m2-fold.mjs <build dir> <port> [count]');
const BASE = `http://127.0.0.1:${port}/`, T = '2026-11-25T04:00:00Z', N = Number(countArg);
const srv = await serve(dist, port);
const browser = await launch();
const out = (name, o) => console.log(JSON.stringify({ name, ...o }));
const ready = (page) => page.waitForFunction(() => window.__shotReady === true && !!window.__wrapped, null, { timeout: 300000, polling: 500 });
const pick = (w) => ({ maxTask: w.maxTask, maxFrame: w.maxFrame, longTasks: w.tasks, over50: w.over50, folds: w.foldCalls, longFrames: w.longFrames, median: w.median });

// ---- the street's usual height
{
  const { ctx, page, errors } = await open(browser, BASE, `?skipintro&fps&t=${T}`);
  await page.waitForFunction(() => !!window.__game && window.__game.city.loadedRegionCount() > 0, null, { timeout: 300000, polling: 500 });
  await sleep(6000);
  await page.evaluate(() => (window.__qa = { sx: 0, sy: 0 }));
  const s = [];
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    s.push(await page.evaluate(() => { const g = window.__game, a = g.aimNow(); return [Math.round(g.flight.height * 10) / 10, Math.round(a.drop * 10) / 10]; }));
  }
  const med = (k) => [...s].map((r) => r[k]).sort((a, b) => a - b)[s.length >> 1];
  out('street height', { heightOverGround: s.map((r) => r[0]), drop: s.map((r) => r[1]), medianHeight: med(0), medianDrop: med(1), errors });
  await ctx.close();
}
await sleep(3000);

// ---- a full MEGA from 600 m
{
  const { ctx, page, errors } = await open(browser, BASE, `?moon&site=TYCHO&skipintro&fps&t=${T}`);
  await ready(page);
  await sleep(4000);
  const at = await page.evaluate(() => { const f = window.__game.flight; return { x: f.x, z: f.z, y: f.y, h: f.height, heading: f.heading, fx: f.fx, fz: f.fz }; });
  for (let k = 0; k < N; k++) {
    // (4 km across the heading each time: fresh open ground, its tiles in)
    const x = at.x - at.fz * 4000 * k, z = at.z + at.fx * 4000 * k;
    await page.evaluate((p) => (window.__qa = { sx: 0, sy: 0, pin: p }), { x, z, y: at.y - at.h + 600, heading: at.heading });
    await sleep(8000);
    const h = await page.evaluate(() => window.__game.flight.height);
    await page.evaluate((p) => (window.__qa = { sx: 0, sy: 0, pin: p }), { x, z, y: at.y - at.h + 600 + (600 - h), heading: at.heading });
    await sleep(4000);
    // (the last one's cooldown skipped: the phase turns ready on the next frames)
    await page.evaluate(() => { const g = window.__game; g.superSkip(1000); g.forceReady(); });
    for (let i = 0; i < 20 && (await page.evaluate(() => window.__game.superState().phase)) !== 'ready'; i++) await sleep(250);
    const pre = await page.evaluate(() => { const g = window.__game; g.forceReady(); return { h: Math.round(g.flight.height), drop: Math.round(g.aimNow().drop), state: g.superState().phase }; });
    const t0 = await now(page);
    const go = await page.evaluate(() => window.__game.superSplat(9.95, 9.9));
    await sleep(6000);
    const w = await window_(page, t0, await now(page));
    out(`mega ${k + 1}`, { ...pre, go, after: await page.evaluate(() => { const s = window.__game.superState(); return { phase: s.phase, stats: s.stats }; }), pictures: await page.evaluate(() => window.__game.city.ground.geoCount), ...pick(w), errors: errors.slice() });
  }
  await ctx.close();
}
await sleep(3000);

// ---- a breath at the street's height: the bus at Cruise, as it flies
{
  const { ctx, page, errors } = await open(browser, BASE, `?moon&site=TYCHO&skipintro&fps&t=${T}`);
  await ready(page);
  await sleep(4000);
  await page.evaluate(() => (window.__qa = { sx: 0, sy: 0 }));
  await sleep(4000);
  for (let k = 0; k < N; k++) {
    const pre = await page.evaluate(() => { const g = window.__game; g.forceReady(); const a = g.aimNow(); return { h: +g.flight.height.toFixed(1), drop: +a.drop.toFixed(1), v: Math.round(g.flight.speed) }; });
    const t0 = await now(page);
    await page.evaluate(() => window.__game.tapSplat());
    await sleep(6000);
    const w = await window_(page, t0, await now(page));
    out(`breath ${k + 1}`, { ...pre, pictures: await page.evaluate(() => window.__game.city.ground.geoCount), ...pick(w), errors: errors.slice() });
  }
  await ctx.close();
}
await browser.close();
srv.kill();
console.log('DONE');
