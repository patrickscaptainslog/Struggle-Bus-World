// The second review's real-time runs, kept as they ran for it and run again quiet for the third (only the paths made relative). What the cloud can't run, on a laptop's GPU in real time: ?earth's boot and the climb through the 15 km hand-over,
// the plain Earth low down, the Moon's slide at Turbo 3, then flag-off and warmcheck on ?earth. One JSON of numbers.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

//   node tools/moon/review3/gpu/recheck.mjs <build dir> <out dir>: it serves the build itself on port 4187. keep, light and swap's tail lines are cut at 220 characters.
const W = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/[\\/]+$/, ''), PORT = 4187, BASE = `http://localhost:${PORT}/`;
const [DIST, out] = process.argv.slice(2);
if (!DIST || !out) throw new Error('usage: recheck.mjs <build dir> <out dir>');
mkdirSync(out, { recursive: true });
const require = createRequire(W + '/package.json');
const { chromium } = require('playwright-core');
const { browserOptions } = await import('../../../browser.mjs');
const T = '2026-11-04T21:00:00Z';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = {};
const log = (s) => { console.log(s); };

const srv = spawn('node', [W + '/tools/sky/serve-dist.mjs', DIST, String(PORT)], { stdio: 'ignore' });
await sleep(1500);
const browser = await chromium.launch(browserOptions(['--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required']));

// frame times and program links from the very first frame
const INIT = () => {
  window.__ft = [];
  window.__links = [];
  let last = 0;
  const tick = (t) => {
    if (last) window.__ft.push([t, t - last]);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const P = WebGL2RenderingContext.prototype, link = P.linkProgram;
  P.linkProgram = function (p) {
    window.__links.push(performance.now());
    return link.call(this, p);
  };
};

async function open(q) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.addInitScript(INIT);
  await page.goto(BASE + q, { waitUntil: 'load', timeout: 90000 });
  return { ctx, page, errors };
}

/** frame-time stats between two page times (ms) */
const stats = (page, t0, t1) =>
  page.evaluate(([a, b]) => {
    const f = window.__ft.filter(([t]) => t >= a && t <= (b ?? Infinity)).map(([, d]) => d);
    const s = [...f].sort((x, y) => x - y), q = (p) => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(1);
    const long = window.__ft.filter(([t, d]) => t >= a && t <= (b ?? Infinity) && d > 100).map(([t, d]) => [Math.round(t - a), Math.round(d)]);
    return { frames: f.length, median: q(0.5), p95: q(0.95), p99: q(0.99), max: +(s.at(-1) ?? 0).toFixed(1), over50: f.filter((d) => d > 50).length, over100: long.length, long: long.slice(0, 12), links: window.__links.filter((t) => t >= a && t <= (b ?? Infinity)).length };
  }, [t0, t1]);
const now = (page) => page.evaluate(() => performance.now());
/** the street's sound engine: its context, the ambience bus and the wind's gains (the review: M8) */
const gains = (page) => page.evaluate(() => {
  const gr = window.__game?.audio?.graph; if (!gr) return { graph: null };
  const v = (n) => (n && n.gain ? +n.gain.value.toFixed(4) : null), w = gr.wind;
  return { ctx: gr.ctx?.state, master: v(gr.masterVol), amb: v(gr.ambBus), rumble: v(w?.rumble), rush: v(w?.rushG), howl: (w?.howlG ?? []).map(v), t: +performance.now().toFixed(0) };
});
const mem = (page) =>
  page.evaluate(() => {
    const r = (o) => o?.pipeline?.renderer?.info;
    const g = r(window.__game), s = r(window.__space);
    return { heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), street: g ? { ...g.memory, programs: g.programs?.length } : null, flight: s ? { ...s.memory, programs: s.programs?.length } : null };
  });

// ---- A: ?earth, the street with the flight behind it, and the climb through 15 km at real speed
try {
  const { ctx, page, errors } = await open(`?earth&lat=37.7700&lon=-122.4300&heading=45&skipintro&fps&t=${T}`);
  await page.waitForFunction(() => !!window.__game && window.__game.city.loadedRegionCount() > 0, null, { timeout: 300000, polling: 500 });
  const tBoot = await now(page);
  await page.waitForFunction(() => window.__space?.moon?.trip?.leg === 'street', null, { timeout: 120000, polling: 250 });
  const tBehind = await now(page);
  await sleep(8000);
  const t0 = await now(page);
  await page.evaluate(() => (window.__qa = { sx: 0, sy: 0 }));
  await sleep(10000);
  const cruise = await stats(page, t0, await now(page));
  const memStreet = await mem(page);
  await page.evaluate(() => window.__game.audio.unlock());
  await sleep(1500);
  const sound = { street: await gains(page) };
  // pin at 7 km, Turbo 3, then a full pull in real time
  const at = await page.evaluate(() => ({ x: window.__game.flight.x, z: window.__game.flight.z, heading: window.__game.flight.heading }));
  await page.evaluate((p) => (window.__qa = { holdFrames: 2, held: false, sx: 0, sy: 0, pin: { ...p, y: 7000 } }), at);
  await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 60000, polling: 50 });
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 3; i++) g.controls.turbo.shift(1, g.flight);
    for (let i = 0; i < 3; i++) g.controls.turbo.rung(1, g.flight);
  });
  const tClimb = await now(page);
  await page.evaluate(() => (window.__qa = { sx: 0, sy: -1 }));
  let handAt = null, s = null;
  for (let i = 0; i < 600; i++) {
    await sleep(250);
    s = await page.evaluate(() => {
      const g = window.__game, t = window.__space.moon.trip;
      return { leg: t.leg, km: +(g.flight.height / 1000).toFixed(2), flightKm: +t.hGround.toFixed(2), t: performance.now() };
    });
    if (handAt === null && s.leg !== 'street') { handAt = s.t; sound.handUp = await gains(page); }
    if (handAt !== null && !sound.space && s.t - handAt > 8000) sound.space = { ...(await gains(page)), km: s.flightKm, leg: s.leg };
    if (handAt !== null && s.flightKm > 22) break;
  }
  await sleep(4000);
  const tEnd = await now(page);
  report.earth = {
    bootToFirstRegion: 'page time ' + Math.round(tBoot) + ' ms', flightBehindAfter: Math.round(tBehind - tBoot) + ' ms',
    linksAfterBehind: await page.evaluate((a) => window.__links.filter((t) => t > a).length, tBehind),
    cruise, memStreet,
    climbSecs: handAt ? +((handAt - tClimb) / 1000).toFixed(1) : null,
    handOver: handAt ? await stats(page, handAt - 2000, handAt + 2000) : 'no hand-over in 150 s',
    climbWhole: await stats(page, tClimb, tEnd),
    last: s, memBoth: await mem(page), sound, errors,
  };
  await page.screenshot({ path: join(out, 'earth-after-climb.png') });
  await ctx.close();
  log('A done');
} catch (e) {
  report.earth = { failed: String(e).slice(0, 300) };
}

// ---- B: the plain Earth low down, in real time (?moonland's free leg, flown down by the trip's own steps, then left to run)
try {
  const { ctx, page, errors } = await open(`?moonland&fps&t=${T}`);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000, polling: 500 });
  await sleep(3000);
  const tHigh = await now(page);
  await sleep(6000);
  const orbit = await stats(page, tHigh, await now(page));
  await page.evaluate(() => {
    const m = window.__space.moon, t = m.trip;
    const fly = (s, stick, yoke, until) => {
      for (let i = 0; i < s * 30 && !until(t); i++) {
        t.step(1 / 30, stick, yoke);
        m.view.update(1 / 30, t, 0, 0, false, 0);
      }
    };
    const u = t.ef.map((x) => x / Math.hypot(...t.ef)), e = [-u[1], u[0], 0], l = Math.hypot(...e);
    for (let i = 0; i < 20000; i++) {
      const h = t.eh, w = (h[0] * e[0] + h[1] * e[1]) / l;
      if (w > 0.999) break;
      t.step(1 / 30, w > 0.95 ? 0.05 : 0.5, 0);
    }
    fly(240, 0, 1, (t) => t.hGround < 10.2);
    fly(3, 0, 0, () => false);
    for (let i = 0; i < 12 && (t.rung !== 3 || t.level); i++) {
      if (t.rung > 3 || (t.rung === 3 && t.level)) t.shiftDown();
      else t.tap();
      t.step(1 / 30, 0, 0);
    }
    fly(240, 0, 1, (t) => t.hGround < 0.2);
    fly(4, 0, 0, () => false);
  });
  await sleep(2000);
  const tLow = await now(page);
  await sleep(15000);
  const low = await stats(page, tLow, await now(page));
  const where = await page.evaluate(() => {
    const t = window.__space.moon.trip, ef = t.ef;
    return { leg: t.leg, m: Math.round(t.hGround * 1000), lat: +((Math.asin(ef[2] / Math.hypot(...ef)) * 180) / Math.PI).toFixed(2), lon: +((Math.atan2(ef[1], ef[0]) * 180) / Math.PI).toFixed(2) };
  });
  await page.screenshot({ path: join(out, 'plain-earth-low.png') });
  report.plainEarth = { orbit, low, where, mem: await mem(page), errors };
  await ctx.close();
  log('B done');
} catch (e) {
  report.plainEarth = { failed: String(e).slice(0, 300) };
}

// ---- C: the Moon low at Turbo 3 for five minutes, straight: the slide at speed
try {
  const { ctx, page, errors } = await open(`?moon&site=TYCHO&skipintro&fps&t=${T}`);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000, polling: 500 });
  await sleep(4000);
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 3; i++) g.controls.turbo.shift(1, g.flight);
    for (let i = 0; i < 3; i++) g.controls.turbo.rung(1, g.flight);
    window.__qa = { sx: 0, sy: 0 };
  });
  const mem0 = await mem(page);
  const t0 = await now(page);
  const slides = [];
  let prev = await page.evaluate(() => ({ x: window.__game.flight.x, z: window.__game.flight.z }));
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    const p = await page.evaluate(() => ({ x: window.__game.flight.x, z: window.__game.flight.z, t: performance.now(), v: Math.round(window.__game.flight.speed), h: Math.round(window.__game.flight.height) }));
    if (Math.abs(p.x - prev.x) > 10000 || Math.abs(p.z - prev.z) > 10000) slides.push({ at: Math.round((p.t - t0) / 1000), dx: Math.round(p.x - prev.x), dz: Math.round(p.z - prev.z) });
    prev = p;
  }
  const t1 = await now(page);
  const around = [];
  for (const s of slides) around.push(await stats(page, t0 + s.at * 1000 - 3000, t0 + s.at * 1000 + 3000));
  report.moonSlide = { whole: await stats(page, t0, t1), slides, aroundSlides: around, last: prev, mem0, mem1: await mem(page), errors };
  await page.screenshot({ path: join(out, 'moon-turbo3.png') });
  await ctx.close();
  log('C done');
} catch (e) {
  report.moonSlide = { failed: String(e).slice(0, 300) };
}

await browser.close();

// ---- D: the repo's own checks that want a real GPU
const run = (name, cmd, env = {}) => {
  const t = Date.now();
  const r = spawnSync(cmd, { cwd: W, shell: true, encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26, env: { ...process.env, BASE, ...env } });
  report[name] = { exit: r.status, secs: Math.round((Date.now() - t) / 1000), tail: ((r.stdout ?? '') + (r.stderr ?? '')).trim().split('\n').slice(-14).map((l) => l.slice(0, 220)) };
  log(name + ' done');
};
run('keep', 'node tools/moon/keep.mjs shots/tmp/rr-keep');
run('light', 'node tools/moon/light.mjs');
run('swap', 'node tools/earth/swap.mjs shots/tmp/rr-swap');
run('flagOff', 'node tools/sky/flag-off.mjs', { DIST });
run('warmEarth', `node tools/warmcheck.mjs "${BASE}?earth" "${out.replace(/\\/g, '/')}/warm-earth.json"`);
run('warmPlain', `node tools/warmcheck.mjs "${BASE}" "${out.replace(/\\/g, '/')}/warm-plain.json"`);

srv.kill();
writeFileSync(join(out, 'gpu-checks.json'), JSON.stringify(report, null, 1));
console.log('ALL DONE');
