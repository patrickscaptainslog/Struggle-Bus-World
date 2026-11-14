#!/usr/bin/env node
// The return visit (docs/specs/core/CORE.md stage 1; src/game/Return.ts): a visit that paints, then the next one starting over that paint, held still
// under the fog, lifted over the roofs, never at a bridge; and every link and record that must get the Golden Gate instead.
//   node tools/returnvisit.mjs <url> <outdir> [--ref <url>]       exit 1 names each case that failed
// One browser context (the phone's viewport, &t=2026-11-07T00:22:00Z&rate=0) for the cases that share a device; a fresh one for (5) and (13).
// (1) and (2) run under CDP's network throttle (1.6 Mbit/s, 150 ms: an ESTIMATE of a phone network); the rest unthrottled, to keep the row short.
//  (1) a first visit: the Golden Gate; a real tap after the gate; the record stored after a paint save that went through, within 2 s of it; its bus
//      height the breath's, P within 150 m of the shot's aim
//  (2) a reload, untouched: frame 1 at returnStart's pose; the bus still while returnHold holds; on the first frame after the fog P projects at 25-65 %
//      of the frame's height and the bus is over the roof under it; no gate, the gears free every frame, TAP TO SKIP up. Again with a tap at 0.5 s:
//      the fog over within 0.8 s and no splat; a second tap splats, within 5 s of the first frame
//  (3) ?lat=37.7762&lon=-122.4380&heading=90: ?lat's pose        (4) ?skipintro: the Golden Gate
//  (5) a fresh context with the opening marked seen only: the Golden Gate, frame 1's pose equal to the ref's (--ref) under the same storage
//  (6) a record outside the bounds: the Golden Gate               (7) the tuner's reset: the record gone, then the Golden Gate
//  (8) ?moon&site=TYCHO, a crater painted: no record touched
//  (9) a downtown record (the bus 60 m up among the Financial District's towers): after the fog the bus is over the towers, P projects as in (2)
// (10) a record on the Golden Gate's deck: no start, why "bridge"  (11) no record: the skip tap at 0.5 s puts the bus past openingClimbAfter in one
//      frame, the gears free within 1 s; the regions in over the next 2 s are printed (not a pass line)
// (12) the record's building's paint gone from the store: the Golden Gate   (13) localStorage throwing on getItem, then on setItem: the first visit's
//      path, no page error, nothing stored   (14) ?recess and ?swerve with a good record: no start
// --budget: (9)'s record, and a Marina record (a tap at 37.8005, -122.4380, its own height), each a reload into the return start: every frame from the
// first drawn one, the fog's included, to 5 s after the fog at most 200 draws and 1.5 M triangles (Perf's own count of the frame, as __trace takes it);
// then 5 s more and 20 s: __stats.callsMax at most 200, trisMax at most 1.5 M; no page error (the same downtown from its ?lat start beside it); then a
// Comet at Nonstop onto a downtown tower on a fresh page: __stats.hitMs over 0 after its impact. Under the fog the start's whole ring landed at once
// and its first frames drew 229-392 times, each new mesh's first draw unculled (r3; City.firstDraw now lets ten a frame); how many wait their
// turn, under the fog and after it, is printed; and the lens is never under the roofs where it stands
// (city.obstacleAt) under the fog: the opening's pull came in through the towers round the paint, r3's look
// --high: (9)'s record with the bus 400 m up (a shot from high: a Comet's, a Lob's), a reload: after the fog P projects at 25-65 % of the frame's height
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--ref');
const [url = 'http://127.0.0.1:4173/', out = 'shots/tmp/returnvisit'] = pos;
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null;
const budget = args.includes('--budget');
const high = args.includes('--high');
mkdirSync(out, { recursive: true });
const T = '&t=2026-11-07T00:22:00Z&rate=0';
const SEEN = 'strugglebus.opening.v1';
const CLIMB_AFTER = 230; // config.camera.openingClimbAfter

const fails = [];
const R = {};
const ok = (c, m) => (c ? console.log(`ok: ${m}`) : (fails.push(m), console.log(`FAIL: ${m}`)));
const errors = [];

const browser = await chromium.launch(browserOptions([]));
// (in every page: from the first drawn frame, each animation frame's pose, hold, gate and gears go in window.__trace, and each toast's lines in __toasts)
const TRACE = () => {
  let game;
  window.__trace = [];
  window.__toasts = [];
  Object.defineProperty(window, '__game', {
    configurable: true,
    get: () => game,
    set(v) {
      game = v;
      // (the pose the boot left, before any frame: what the opening or the return start set)
      window.__boot = { x: v.flight.x, y: v.flight.y, z: v.flight.z, h: v.flight.heading };
      const h = v.controls.hud, toast = h.toast.bind(h);
      h.toast = (lines, s) => (window.__toasts.push({ lines, n: window.__trace.length }), toast(lines, s));
      // (and each tap Input hands the game, when)
      window.__taps = [];
      const onTap = v.input.onTap;
      v.input.onTap = (...a) => (window.__taps.push(performance.now()), onTap?.(...a));
      const f = v.flight;
      // (from the first drawn frame: html.drawn, set at its end (index.html's loader); a build without the loader, from its clock's first move)
      const tick = () => {
        if (window.__trace.length < 4000 && (document.documentElement.classList.contains('drawn') || (!document.getElementById('sb-load') && v.clock() > 0)))
          window.__trace.push({ t: performance.now(), c: v.clock(), x: f.x, y: f.y, z: f.z, h: f.heading, hold: v.returnHold?.() ?? false, gate: v.openingBridge ? v.openingBridge() !== null : v.controls.gearsLocked, locked: v.controls.gearsLocked, opening: v.controls.opening, shot: v.lastShot()?.t ?? null, roof: v.city.obstacleAt(f.x, f.z), regions: v.city.loadedRegionCount(), d: v.perf?.calls ?? null, tr: v.perf?.tris ?? null, w: v.city.firstsWaiting ?? null, inside: v.city.obstacleAt(v.camera.position.x, v.camera.position.z) - v.camera.position.y });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
  });
};
// in-page: lat/lon to map metres (tools mirror src/game/geo.ts, as warmcheck's __ll), and a record's key
const HELPERS = () => {
  const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2), E4 = E2 * E2, E6 = E4 * E2;
  const mer = (p) => A * ((1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256) * p - ((3 * E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024) * Math.sin(2 * p) + ((15 * E4) / 256 + (45 * E6) / 1024) * Math.sin(4 * p) - ((35 * E6) / 3072) * Math.sin(6 * p));
  window.__ll = (lat, lon) => {
    const o = window.__game.city.manifest.origin;
    const r = Math.PI / 180, phi = lat * r, s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
    const N = A / Math.sqrt(1 - E2 * s * s), T = t * t, C = EP2 * c * c, a = (lon - o[1]) * r * c, a2 = a * a;
    const x = N * (a + ((1 - T + C) * a2 * a) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a2 * a2 * a) / 120);
    const y = mer(phi) - mer(o[0] * r) + N * t * (a2 / 2 + ((5 - T + 9 * C + 4 * C * C) * a2 * a2) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a2 * a2 * a2) / 720);
    return [x, -y];
  };
  window.__key = () => `strugglebus.last.v1:${window.__game.city.manifest.slug}`;
  window.__rec = () => {
    const s = localStorage.getItem(window.__key());
    return s ? JSON.parse(s) : null;
  };
};
async function context(init) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  await ctx.addInitScript(TRACE);
  await ctx.addInitScript(HELPERS);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => (errors.push(e.message), console.log('[pageerror]', e.message)));
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}
const throttle = (cdp, on) => cdp.send('Network.emulateNetworkConditions', on ? { offline: false, latency: 150, downloadThroughput: (1600 * 1000) / 8, uploadThroughput: (1600 * 1000) / 8 } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
/** loads base+q and waits for the game's first frames (wait 'ready': for __shotReady) */
async function load(page, q, wait = 'frame', base = url) {
  await page.goto(base + q, { waitUntil: 'domcontentloaded', timeout: 400000 });
  await page.waitForFunction(() => (window.__trace?.length ?? 0) > 1, null, { timeout: 400000, polling: 50 });
  if (wait === 'ready') await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 400000, polling: 100 });
  // (a build before the return visit has no returnStart: its gate is read off the gears' lock at frame 1)
  return page.evaluate(() => ({ start: window.__game.returnStart?.() ?? { pose: null, why: 'no returnStart on this build' }, first: window.__trace[0], boot: window.__boot }));
}
// (a tap as controls.mjs's first-run leg gives one, which the coach counts as its TAP)
const tap = async (cdp, x = 300, y = 600, ms = 90) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  await new Promise((r) => setTimeout(r, ms));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const until = (page, cond, s = 60) => page.waitForFunction(cond, null, { timeout: s * 1000, polling: 30 });
/** a real tap on whatever glints (forceReady first; waits up to glintWait s for a glint); resolves with the shot once it has landed */
async function shoot(page, cdp, glintWait = 30) {
  await page.evaluate(() => window.__game.forceReady());
  // (the Moon's ground has no building to glint: a tap there paints the ground; past the Golden Gate the bus is over the water for a while)
  await until(page, () => !!window.__game.glintNow(), glintWait).catch(() => {});
  const before = await page.evaluate(() => window.__game.lastShot()?.t ?? null);
  await tap(cdp);
  await until(page, (b) => (window.__game.lastShot()?.t ?? null) !== b, 10).catch(() => {});
  return page.evaluate(async (b) => {
    const g = window.__game, s = g.lastShot();
    if (!s || s.t === b) return null;
    while (g.clock() < s.t + s.travel + 0.3) await new Promise((r) => requestAnimationFrame(r));
    return s;
  }, before);
}
/** where P (lat, lon of the record) projects on the frame now: the share of the frame's height from the top, and in frame or not. In-page */
const project = (page, pLat, pLon) =>
  page.evaluate(([la, lo]) => {
    const g = window.__game, [x, z] = window.__ll(la, lo), v = g.camera.position.clone().set(x, g.city.obstacleAt(x, z), z).project(g.camera);
    return { fromTop: (1 - v.y) / 2, x: (v.x + 1) / 2, inFrame: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1 };
  }, [pLat, pLon]);
/** the first traced frame after the fog, and every frame of the hold before it */
const afterFog = async (page) => {
  await until(page, () => window.__trace.some((f) => !f.opening && f.c > 0.2), 120);
  return page.evaluate(() => {
    const tr = window.__trace, i = tr.findIndex((f) => !f.opening && f.c > 0.2);
    return { first: tr[i], held: tr.slice(0, i).filter((f) => f.hold), all: tr.slice(0, i + 1) };
  });
};
const setRec = (page, rec) => page.evaluate((r) => (r ? localStorage.setItem(window.__key(), JSON.stringify(r)) : localStorage.removeItem(window.__key())), rec);

const { ctx, page, cdp } = await context();
const Q = `?${T.slice(1)}`;
let good = null;

/** 5 s flown on (the peaks' ring of five 1-s windows rolls past the fog and the load: their frames are the warm-up's and the streaming's, and their
 *  peaks are reported apart, not passed on), then 20 s of game time: the highest callsMax and trisMax __stats showed, and each second's draws of the
 *  frame then and its peaks. In-page */
const FLY20 = async () => {
  const g = window.__game;
  let early = 0;
  for (const t1 = g.clock(); g.clock() - t1 < 5; ) {
    await new Promise((r) => requestAnimationFrame(r));
    early = Math.max(early, window.__stats?.callsMax ?? 0);
  }
  const t0 = g.clock();
  let calls = 0, tris = 0, last = -1;
  const series = [];
  while (g.clock() - t0 < 20) {
    await new Promise((r) => requestAnimationFrame(r));
    const s = window.__stats;
    if (s) {
      calls = Math.max(calls, s.callsMax ?? 0);
      tris = Math.max(tris, s.trisMax ?? 0);
      if (Math.floor(g.clock() - t0) !== last) {
        last = Math.floor(g.clock() - t0);
        series.push([last, s.calls, s.callsMax, Math.round((s.trisMax ?? 0) / 1000)]);
      }
    }
  }
  return { calls, tris, early, has: !!window.__stats && 'callsMax' in window.__stats, series };
};

if (budget) {
  // ---- --budget: (9)'s downtown record and a Marina one, the return start from its first frame, then 20 s of flight after the fog
  R.budget = {};
  for (const [where, lat, lon, up] of [['downtown', 37.7935, -122.4, 60], ['the Marina', 37.8005, -122.438, null]]) {
    await load(page, `?lat=${lat}&lon=${lon}&heading=90&skipintro&noreturn${T}`, 'ready');
    await page.evaluate(HELPERS);
    await page.evaluate((k) => localStorage.setItem(k, '1'), SEEN);
    const s = await shoot(page, cdp);
    await page.evaluate(() => window.__game.city.paint.persist());
    const rec = await page.evaluate(() => window.__rec());
    ok(!!s && !!rec, `budget, ${where}: a tap stored a record (${JSON.stringify(rec)})`);
    if (!rec) continue;
    if (up !== null) rec[2] = up;
    await setRec(page, rec);
    const L = await load(page, `?fps${T}`);
    const B = (R.budget[where] = { start: L.start });
    ok(!!L.start?.pose, `budget, ${where}: the reload is a return start (${L.start?.which ?? L.start?.why})`);
    const fog = await afterFog(page);
    // (the start's first seconds: every frame traced from the first drawn one, under the fog and 5 s past it, by Perf's own count of the frame)
    const first = await page.evaluate(async (c0) => {
      while (window.__game.clock() < c0 + 5) await new Promise((r) => requestAnimationFrame(r));
      const tr = window.__trace.filter((f) => f.d !== null && f.c <= c0 + 5);
      const top = tr.reduce((a, f) => (f.d > a.d ? f : a), { d: 0 });
      return { frames: tr.length, fog: tr.filter((f) => f.opening).length, draws: Math.max(0, ...tr.map((f) => f.d)), tris: Math.max(0, ...tr.map((f) => f.tr)), at: top.c ?? null, under: top.opening ?? null, over: tr.filter((f) => f.d > 200).map((f) => [+f.c.toFixed(2), f.d]), waitFog: Math.max(0, ...tr.filter((f) => f.opening).map((f) => f.w ?? 0)), waitAfter: Math.max(0, ...tr.filter((f) => !f.opening).map((f) => f.w ?? 0)), waitAfterFrames: tr.filter((f) => !f.opening && f.w > 0).length, inside: tr.filter((f) => f.opening && f.inside > 0).map((f) => [+f.c.toFixed(2), +f.inside.toFixed(1)]) };
    }, fog.first.c);
    B.first = first;
    ok(first.frames > 10 && first.draws <= 200, `budget, ${where}: the return start's frames from the first drawn one to 5 s after the fog at most 200 draws (${first.frames} frames, ${first.fog} under the fog; the most ${first.draws} at ${first.at} s, ${first.under ? 'under the fog' : 'after it'}${first.over.length ? `; over 200: ${JSON.stringify(first.over.slice(0, 8))}` : ''})`);
    ok(first.tris <= 1.5e6, `budget, ${where}: ... and at most 1.5 M triangles (${(first.tris / 1e6).toFixed(3)} M)`);
    ok(first.inside.length === 0, `budget, ${where}: the lens never under the roofs where it stands under the fog (${first.inside.length} frames${first.inside.length ? `, the first at ${JSON.stringify(first.inside.slice(0, 4))} (s, m under)` : ''})`);
    console.log(`budget, ${where}: meshes waiting their first draw (City.firstsWaiting), the most under the fog ${first.waitFog}, after it ${first.waitAfter} (in ${first.waitAfterFrames} frames to 5 s past it; not a pass line)`);
    const st = await page.evaluate(FLY20);
    B.stats = st;
    ok(st.has, `budget, ${where}: __stats carries callsMax and trisMax`);
    ok(st.calls > 0 && st.calls <= 200, `budget, ${where}: the peak draws over 20 s of flight at most 200 (${st.calls})`);
    ok(st.tris > 0 && st.tris <= 1.5e6, `budget, ${where}: the peak triangles at most 1.5 M (${st.tris})`);
    console.log(`budget, ${where}: 5-10 s after the fog, the peak draws in __stats: ${st.early} (not a pass line); then each second (s, the frame's draws, callsMax, trisMax k): ${JSON.stringify(st.series)}`);
  }
  {
    // (beside it, not a pass line: the same downtown flown from the tap's own ?lat start, no return start, for what the return adds)
    await load(page, `?lat=37.7935&lon=-122.4000&heading=90&skipintro&noreturn&fps${T}`, 'ready');
    const lat = await page.evaluate(FLY20);
    R.budget.lat = lat;
    console.log(`budget, beside it: the same downtown from its ?lat start: peak draws ${lat.calls}, triangles ${lat.tris} (its first 5 s: ${lat.early}); each second ${JSON.stringify(lat.series)}`);
  }
  // (?fps's hit after a Comet: a fresh page, so nothing before it set hit; at Nonstop facing the towers west of the tap, a tap on what glints is a Comet,
  // whose plan has no hit-stop. Before the hit moved to the impact hook a Comet never set it, and it read 0 here)
  await load(page, `?lat=37.7935&lon=-122.4000&heading=270&skipintro&noreturn&fps${T}`, 'ready');
  await page.evaluate(async () => {
    const g = window.__game;
    g.controls.turbo.arrive(2, 0);
    for (const t1 = g.clock(); g.clock() - t1 < 1; ) await new Promise((r) => requestAnimationFrame(r));
  });
  const c = await shoot(page, cdp);
  const hit = await page.evaluate(async () => {
    const g = window.__game;
    for (const t1 = g.clock(); g.clock() - t1 < 1; ) await new Promise((r) => requestAnimationFrame(r));
    return { hitMs: window.__stats?.hitMs, gear: g.controls.turbo.name };
  });
  R.budget = { ...R.budget, comet: { shot: c, ...hit } };
  ok(!!c?.comet && c.target !== null && !c.miss, `budget: a tap at ${hit.gear} is a Comet onto a building (${c ? `comet ${!!c.comet}, target ${c.target?.index ?? null}, miss ${!!c.miss}` : 'no shot'})`);
  ok(hit.hitMs > 0, `budget: __stats.hitMs after the Comet's impact over 0 (${hit.hitMs})`);
  ok(errors.length === 0, `budget: no page error (${errors.length}${errors.length ? ': ' + errors[0] : ''})`);
} else if (high) {
  // ---- --high: (9)'s downtown record, its bus 400 m up, the return start; P after the fog
  await load(page, `?lat=37.7935&lon=-122.4000&heading=90&skipintro&noreturn${T}`, 'ready');
  await page.evaluate(HELPERS);
  await page.evaluate((k) => localStorage.setItem(k, '1'), SEEN);
  const s = await shoot(page, cdp);
  await page.evaluate(() => window.__game.city.paint.persist());
  const rec = await page.evaluate(() => window.__rec());
  ok(!!s && !!rec, `high: a downtown tap stored a record (${JSON.stringify(rec)})`);
  if (rec) {
    const before = [...rec];
    rec[2] = 400;
    await setRec(page, rec);
    const L = await load(page, Q);
    await page.evaluate(HELPERS);
    ok(!!L.start?.pose, `high: a record at 400 m: a return start (${L.start?.which ?? L.start?.why}, at ${L.start?.pose?.y ?? '-'} m)`);
    const fog = await afterFog(page);
    const pr = await project(page, rec[4], rec[5]);
    R.high = { stored: before, start: L.start, afterFog: fog.first, project: pr };
    ok(pr.inFrame && pr.fromTop >= 0.25 && pr.fromTop <= 0.65, `high: P projects at 25-65 % of the frame's height (${(pr.fromTop * 100).toFixed(1)} %, in frame ${pr.inFrame}; the bus ${fog.first.y.toFixed(1)} m)`);
    await page.screenshot({ path: `${out}/15-high.png` });
  }
  ok(errors.length === 0, `high: no page error (${errors.length}${errors.length ? ': ' + errors[0] : ''})`);
} else {
  // ---- (1) a first visit through the Golden Gate, a real tap after the gate, the record after the paint's save
  await throttle(cdp, true);
  let L = await load(page, Q);
  await page.evaluate(HELPERS);
  ok(L.first.gate && !L.start.pose && L.start.why === 'first visit', `(1) a first visit gets the Golden Gate (gate ${L.first.gate}, ${L.start.why})`);
  await until(page, () => !window.__game.controls.gearsLocked && !window.__game.controls.opening, 300);
  await throttle(cdp, false);
  await page.evaluate(() => {
    const p = window.__game.city.paint, was = p.afterSave;
    window.__saves = [];
    p.afterSave = () => (window.__saves.push(performance.now()), was?.());
  });
  const s1 = await shoot(page, cdp, 180);
  const saved = await page
    .waitForFunction(() => window.__rec() && window.__saves.length ? { rec: window.__rec(), at: performance.now(), save: window.__saves[0] } : null, null, { timeout: 15000, polling: 20 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  R.first = { shot: s1, saved };
  const why1 = await page.evaluate(() => ({ sign: window.__game.lastSign(), saves: window.__saves.length, slug: window.__game.city.manifest.slug }));
  ok(!!s1 && !!saved, `(1) a tap after the gate stored the record after a paint save that went through (${JSON.stringify(saved?.rec)}; the shot ${JSON.stringify(s1 && { t: s1.t, aim: s1.aim, target: s1.target, miss: s1.miss })}, ${JSON.stringify(why1)})`);
  if (s1 && saved) {
    const [bLat, bLon, bY, , pLat, pLon] = saved.rec;
    const pd = await page.evaluate(([la, lo, a]) => {
      const [x, z] = window.__ll(la, lo);
      return Math.hypot(x - a[0], z - a[2]);
    }, [pLat, pLon, s1.aim]);
    ok(saved.at - saved.save <= 2000, `(1) stored within 2 s of the save (${Math.round(saved.at - saved.save)} ms)`);
    ok(Math.abs(bY - s1.busY) <= 0.11, `(1) its bus height is the breath's (${bY} against ${s1.busY.toFixed(2)})`);
    ok(pd <= 150, `(1) P within 150 m of the shot's aim (${pd.toFixed(1)} m)`);
    good = saved.rec;
    R.first.bus = [bLat, bLon];
  }
  writeFileSync(`${out}/record.json`, JSON.stringify(good));

  // ---- (2) the reload: the return start, held, then flying over the paint
  if (good) {
    await throttle(cdp, true);
    L = await load(page, Q);
    await page.evaluate(HELPERS);
    const P = L.start.pose;
    ok(!!P, `(2) the reload starts over the paint (${L.start.which ?? L.start.why})`);
    if (P) {
      const b = L.boot, f = L.first;
      ok(b.x === P.x && b.y === P.y && b.z === P.z && b.h === P.heading, `(2) the boot leaves the bus at returnStart's pose (${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)}, ${b.h.toFixed(4)} against ${P.x.toFixed(2)}, ${P.y.toFixed(2)}, ${P.z.toFixed(2)}, ${P.heading.toFixed(4)})`);
      ok(Math.hypot(f.x - P.x, f.z - P.z) < 0.01 && f.y >= P.y && f.h === P.heading, `(2) frame 1 there too, lifted only (${f.x.toFixed(2)}, ${f.y.toFixed(1)}, ${f.z.toFixed(2)})`);
    }
    const fog = await afterFog(page);
    await throttle(cdp, false);
    const moved = fog.held.reduce((m, f) => Math.max(m, Math.hypot(f.x - fog.held[0].x, f.z - fog.held[0].z)), 0);
    ok(fog.held.length > 1 && moved < 0.01, `(2) the bus still while the hold holds (${fog.held.length} frames, moved ${moved.toFixed(3)} m)`);
    ok(fog.all.every((f) => !f.gate && !f.locked), `(2) no gate and the gears free every frame (${fog.all.filter((f) => f.gate || f.locked).length} frames not)`);
    const pr = await project(page, good[4], good[5]);
    const f1 = fog.first;
    R.reload = { start: L.start, afterFog: f1, project: pr, held: fog.held.length };
    ok(pr.inFrame && pr.fromTop >= 0.25 && pr.fromTop <= 0.65, `(2) on the first frame after the fog P projects in frame at 25-65 % of its height (${(pr.fromTop * 100).toFixed(1)} %, x ${(pr.x * 100).toFixed(1)} %)`);
    ok(f1.y > f1.roof, `(2) the bus over the roof under it (${f1.y.toFixed(1)} over ${f1.roof.toFixed(1)})`);
    const toasts = await page.evaluate(() => window.__toasts);
    ok(toasts.some((t) => t.lines[0] === 'TAP TO SKIP'), `(2) TAP TO SKIP up (${JSON.stringify(toasts.map((t) => t.lines[0]))})`);
    await page.screenshot({ path: `${out}/02-after-fog.png` });
    // again, with a tap at 0.5 s
    L = await load(page, Q);
    await page.evaluate(HELPERS);
    const t0 = await page.evaluate(() => window.__trace[0].t);
    await page.waitForFunction((t) => performance.now() - t >= 500, t0, { polling: 10 });
    // (the skip tap as tools/skipopening.mjs gives it)
    await tap(cdp, 200, 500, 60);
    const tapAt = await page.evaluate(() => performance.now());
    const end = await page
      .waitForFunction(() => (window.__game.controls.opening ? null : performance.now()), null, { timeout: 10000, polling: 'raf' })
      .then((h) => h.jsonValue())
      .catch(() => null);
    const skip = await page.evaluate((ta) => ({ shot: window.__game.lastShot(), taps: window.__taps.map((t) => Math.round(t - ta)) }), tapAt);
    const fogEnd = end === null ? null : end - tapAt;
    ok(fogEnd !== null && fogEnd <= 800 && !skip.shot, `(2) a tap at 0.5 s ends the fog within 0.8 s (${fogEnd === null ? 'never' : Math.round(fogEnd) + ' ms'}) with no splat (${!!skip.shot}; taps the game heard, ms from the tap's end: ${JSON.stringify(skip.taps)})`);
    const s2 = await shoot(page, cdp);
    const at = await page.evaluate((t) => (window.__game.lastShot() ? performance.now() - t : null), t0);
    ok(!!s2, `(2) a second tap splats (${at === null ? 'none' : (at / 1000).toFixed(1) + ' s after the first frame, its landing included'})`);
    const firstShot = await page.evaluate((t) => {
      const f = window.__trace.find((f) => f.shot !== null);
      return f ? f.t - t : null;
    }, t0);
    ok(firstShot !== null && firstShot <= 5000, `(2) the first splat leaves within 5 s of the first frame (${firstShot === null ? 'none' : (firstShot / 1000).toFixed(2) + ' s'})`);
    good = (await page.evaluate(() => window.__rec())) ?? good;
  }

  // ---- (3) ?lat, (4) ?skipintro
  L = await load(page, `?lat=37.7762&lon=-122.4380&heading=90${T}`);
  const want3 = await page.evaluate(() => window.__ll(37.7762, -122.438));
  ok(!L.start.pose && L.start.why === 'lat' && Math.hypot(L.first.x - want3[0], L.first.z - want3[1]) < 1 && !L.first.gate, `(3) ?lat's pose (${L.start.why}, ${Math.hypot(L.first.x - want3[0], L.first.z - want3[1]).toFixed(2)} m off)`);
  L = await load(page, `?skipintro${T}`);
  ok(!L.start.pose && L.start.why === 'skipintro' && L.first.gate, `(4) ?skipintro: the Golden Gate (${L.start.why}, gate ${L.first.gate})`);

  // ---- (6) outside the bounds, (10) on the deck, (12) the paint gone, (14) recess and swerve
  if (good) {
    await page.evaluate(HELPERS);
    const b = await page.evaluate(() => window.__game.city.manifest.bounds);
    const outside = [...good];
    outside[4] = good[4] + 0.5; // ~55 km north
    await setRec(page, outside);
    L = await load(page, Q);
    ok(!L.start.pose && L.start.why === 'outside' && L.first.gate, `(6) a record outside the bounds: the Golden Gate (${L.start.why})`);
    await page.evaluate(HELPERS);
    const deck = await page.evaluate(() => {
      const g = window.__game, ggb = g.city.manifest.landmarks.find((l) => l.kind === 'ggb');
      const [a, c] = [ggb.points[1], ggb.points[2]], m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      // (map metres back to lat/lon: Newton's steps on __ll, its Jacobian by differences)
      const toLL = (x, z) => {
        let la = g.city.manifest.origin[0], lo = g.city.manifest.origin[1];
        for (let i = 0; i < 8; i++) {
          const [px, pz] = window.__ll(la, lo), [ax, az] = window.__ll(la + 1e-4, lo), [bx, bz] = window.__ll(la, lo + 1e-4);
          const j11 = (ax - px) / 1e-4, j12 = (bx - px) / 1e-4, j21 = (az - pz) / 1e-4, j22 = (bz - pz) / 1e-4, det = j11 * j22 - j12 * j21;
          const ex = x - px, ez = z - pz;
          la += (ex * j22 - ez * j12) / det;
          lo += (ez * j11 - ex * j21) / det;
        }
        return [la, lo];
      };
      return { ll: toLL(m[0], m[1]), m, heading: Math.round((Math.atan2(c[0] - a[0], -(c[1] - a[1])) * 180) / Math.PI) };
    });
    const onDeck = [deck.ll[0], deck.ll[1], 70, (deck.heading + 360) % 360, deck.ll[0], deck.ll[1], good[6], good[7]];
    await setRec(page, onDeck);
    L = await load(page, Q);
    R.deck = { record: onDeck, start: L.start, m: deck.m };
    ok(!L.start.pose && L.start.why === 'bridge' && L.first.gate, `(10) a record on the Golden Gate's deck: no start, why "bridge" (${L.start.why}), the Golden Gate (${L.first.gate})`);
    // ((12) before (14): the store's key is read on a plain page. On the one link a ?swerve page's paint keeps to the session (main.ts, its slug
    // sf~swerve has no id scheme), so its city.paint.key is null, and the store it was to empty was left whole)
    await page.evaluate(HELPERS);
    const paint = await page.evaluate(() => {
      const k = window.__game.city.paint.key, v = localStorage.getItem(k);
      localStorage.removeItem(k);
      return { k, v };
    });
    await setRec(page, good);
    L = await load(page, Q);
    ok(!L.start.pose && L.start.why === 'paint not saved' && L.first.gate, `(12) the building's paint gone from the store: the Golden Gate (${L.start.why})`);
    await page.evaluate(({ k, v }) => v && localStorage.setItem(k, v), paint);
    await setRec(page, good);
    // (?recess on the one link boots its arena before the return start and gives it its own lat and skipintro (docs/specs/core/STAGE1.md): no start, the
    // first flag the start finds being lat)
    for (const flag of ['recess', 'swerve']) {
      L = await load(page, `?${flag}${T}`);
      ok(!L.start.pose && (L.start.why === flag || (flag === 'recess' && L.start.why === 'lat')), `(14) ?${flag} with a good record: no start (${L.start.why})`);
    }
    await setRec(page, good);
  }

  // ---- (9) downtown: a record at 60 m among the Financial District's towers (P a tower a real tap painted), over the towers after the fog
  L = await load(page, `?lat=37.7935&lon=-122.4000&heading=90&skipintro&noreturn${T}`, 'ready');
  await page.evaluate(HELPERS);
  const s9 = await shoot(page, cdp);
  await page.evaluate(() => window.__game.city.paint.persist());
  const down = await page.evaluate(() => window.__rec());
  if (s9 && down) {
    const before = [...down];
    down[2] = 60;
    await setRec(page, down);
    L = await load(page, Q);
    await page.evaluate(HELPERS);
    ok(!!L.start.pose, `(9) a downtown record at 60 m: a return start (${L.start.which ?? L.start.why})`);
    const fog = await afterFog(page);
    const pr = await project(page, down[4], down[5]);
    const f1 = fog.first;
    const tops = await page.evaluate(() => {
      const g = window.__game, f = g.flight, ax = f.fx * 30, az = f.fz * 30, o = (x, z) => g.city.obstacleAt(x, z);
      return Math.max(o(f.x, f.z), o(f.x + ax, f.z + az), o(f.x - az, f.z + ax), o(f.x + az, f.z - ax));
    });
    R.downtown = { stored: before, start: L.start, afterFog: f1, tops, project: pr };
    ok(f1.y > f1.roof && f1.y >= tops, `(9) after the fog the bus is over the towers (${f1.y.toFixed(1)} m; the roof under it ${f1.roof.toFixed(1)}, the highest round it ${tops.toFixed(1)})`);
    ok(pr.inFrame && pr.fromTop >= 0.25 && pr.fromTop <= 0.65, `(9) P projects at 25-65 % of the frame's height (${(pr.fromTop * 100).toFixed(1)} %)`);
    await page.screenshot({ path: `${out}/09-downtown.png` });
  } else ok(false, `(9) a downtown tap stored a record (${JSON.stringify(down)})`);

  // ---- (11) a return with no record: the skip tap jumps the bus past the gate
  await page.evaluate(HELPERS);
  await setRec(page, null);
  L = await load(page, Q);
  ok(!L.start.pose && L.start.why === 'no record' && L.first.gate, `(11) no record: the Golden Gate (${L.start.why})`);
  {
    const t0 = await page.evaluate(() => window.__trace[0].t);
    await page.waitForFunction((t) => performance.now() - t >= 500, t0, { polling: 10 });
    const n = await page.evaluate(() => window.__trace.length);
    // (the skip tap as tools/skipopening.mjs gives it)
    await tap(cdp, 200, 500, 60);
    const tapAt = await page.evaluate(() => performance.now());
    await page.waitForFunction((t) => performance.now() - t >= 2200, tapAt, { polling: 50 });
    const r = await page.evaluate(([n, ta]) => {
      const tr = window.__trace.slice(n);
      return { tr: tr.map((f) => ({ dt: f.t - ta, x: f.x, z: f.z, h: f.h, locked: f.locked, regions: f.regions })) };
    }, [n, tapAt]);
    const gap = await page.evaluate(() => {
      const l = window.__game.city.manifest.landmarks.find((l) => l.kind === 'ggb'), [, t1, t2] = l.points, sx = t2[0] - t1[0], sz = t2[1] - t1[1], sl = Math.hypot(sx, sz);
      return [t1[0] + (sx / sl) * 85, t1[1] + (sz / sl) * 85];
    });
    const along = (f) => (f.x - gap[0]) * Math.sin(f.h) + (f.z - gap[1]) * -Math.cos(f.h);
    const first = r.tr.find((f) => f.dt >= 0);
    const free = r.tr.find((f) => f.dt >= 0 && !f.locked);
    R.skip = { first: first && { ...first, along: along(first) }, free: free?.dt, regions: r.tr.filter((_, i) => i % 10 === 0).map((f) => [Math.round(f.dt), f.regions]) };
    const taps = await page.evaluate((ta) => window.__taps.map((t) => Math.round(t - ta)), tapAt);
    ok(!!first && along(first) >= CLIMB_AFTER, `(11) the skip tap puts the bus past openingClimbAfter on the next frame (${first ? along(first).toFixed(1) : '?'} m along, ${first ? Math.round(first.dt) : '?'} ms after the tap; taps the game heard, ms from the tap's end: ${JSON.stringify(taps)})`);
    ok(!!free && free.dt <= 1000, `(11) the gears free within 1 s (${free ? Math.round(free.dt) + ' ms' : 'never'})`);
    console.log(`(11) regions in over the 2 s after the skip (ms, count): ${JSON.stringify(R.skip.regions)} (not a pass line)`);
    await page.screenshot({ path: `${out}/11-after-skip.png` });
  }

  // ---- (7) the tuner's reset: the record gone, then the Golden Gate
  if (good) {
    await setRec(page, good);
    await load(page, Q, 'ready');
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 400000 }), page.evaluate(() => window.__game.tuner.onResetPaint())]);
    await page.waitForFunction(() => (window.__trace?.length ?? 0) > 1, null, { timeout: 400000, polling: 50 });
    await page.evaluate(HELPERS);
    const r7 = await page.evaluate(() => ({ rec: window.__rec(), start: window.__game.returnStart?.() ?? { pose: null }, gate: window.__trace[0].gate }));
    ok(r7.rec === null && !r7.start.pose && r7.gate, `(7) the tuner's reset: the record gone (${JSON.stringify(r7.rec)}), then the Golden Gate (${r7.start.why})`);
  }

  // ---- (8) the Moon: a crater painted, no record touched
  if (good) {
    await page.evaluate(HELPERS);
    await setRec(page, good);
    const keys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('strugglebus.last.v1')).map((k) => [k, localStorage.getItem(k)]));
    const was = JSON.stringify(await keys());
    await load(page, `?moon&site=TYCHO${T}`, 'ready');
    const s8 = await shoot(page, cdp);
    await page.evaluate(() => window.__game.city.paint.persist?.());
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const now = JSON.stringify(await keys());
    ok(!!s8 && now === was, `(8) ?moon&site=TYCHO, a crater painted (${!!s8}): no record touched (${now === was ? 'same' : was + ' -> ' + now})`);
  }
}
await ctx.close();

if (!budget && !high) {
  // ---- (5) a fresh context with the opening marked seen only: the Golden Gate, frame 1 as the ref's
  const seen = (k) => localStorage.setItem(k, '1');
  const first5 = async (base) => {
    const c = await context(`(${seen})(${JSON.stringify(SEEN)})`);
    const L = await load(c.page, Q, 'frame', base);
    await c.ctx.close();
    return L;
  };
  const b5 = await first5(url);
  ok(!b5.start.pose && b5.start.why === 'no record' && b5.first.gate, `(5) the opening seen and nothing else: the Golden Gate (${b5.start.why})`);
  if (ref) {
    const r5 = await first5(ref);
    const d = Math.hypot(b5.boot.x - r5.boot.x, b5.boot.z - r5.boot.z) + Math.abs(b5.boot.y - r5.boot.y) + Math.abs(b5.boot.h - r5.boot.h);
    R.same = { b: b5.boot, r: r5.boot };
    ok(d === 0, `(5) the boot's pose equal to the ref's (off by ${d})`);
  } else console.log('(5) no --ref: the pose against the ref was not compared');

  // ---- (13) storage that throws: on getItem, then on setItem
  for (const which of ['getItem', 'setItem']) {
    const n = errors.length;
    const c = await context(`Storage.prototype.${which} = function () { throw new DOMException('blocked', 'SecurityError'); };`);
    const L = await load(c.page, Q, 'ready');
    await c.page.evaluate(HELPERS);
    const s = await shoot(c.page, c.cdp).catch(() => null);
    await c.page.evaluate(() => window.__game.city.paint.persist());
    const st = await c.page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      return keys.filter((k) => k.startsWith('strugglebus.last'));
    });
    ok(!L.start.pose && L.first.gate && errors.length === n && st.length === 0, `(13) localStorage throwing on ${which}: the first visit's path (${L.start.why}, gate ${L.first.gate}), a tap (${!!s}), no page error (${errors.length - n}), nothing stored (${st.length})`);
    await c.ctx.close();
  }
  ok(errors.length === 0, `no page error in any case (${errors.length}${errors.length ? ': ' + errors[0] : ''})`);
}
await browser.close();
writeFileSync(`${out}/${budget ? 'budget' : high ? 'high' : 'returnvisit'}.json`, JSON.stringify(R, null, 1));
console.log(fails.length ? `RETURNVISIT FAILED ${fails.length}:\n  ${fails.join('\n  ')}` : `returnvisit: all passed`);
process.exit(fails.length ? 1 : 0);
