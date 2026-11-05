// The GPU half's shared setup: its own server for a build, the browser as tools/browser.mjs opens it (393 x 852 at 3x, the real GPU), and an init script that, from the first frame,
// records each rAF frame time, each long task (PerformanceObserver 'longtask'), and each call to three of GroundPaint's methods, wrapped on the instance the page holds
// (window.__game.city.ground; the build's minifier keeps property names): pictureInto (a tile's paint copied out of the pictures), attach (which calls it) and fold (a landed blast into the pictures).
// Since the second account's fix of this review (96ee034) the copy and the fold are spread over frames in the pictures' own GeoPaint (window.__game.city.ground.geoPaint), a step at a
// time: "pictureInto" is each of its copySteps (a tile's rows until the frame's 2 ms are up, or all of them), "fold" each foldStep (a picture's rows of one blast), under the old names.
// Prints nothing itself.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserOptions } from '../../../browser.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** node tools/sky/serve-dist.mjs <dist> <port>, from the repo root; kill() it when done */
export async function serve(dist, port) {
  const srv = spawn(process.execPath, ['tools/sky/serve-dist.mjs', dist, String(port)], { stdio: 'ignore' });
  await sleep(1500);
  return srv;
}

export const launch = () => chromium.launch(browserOptions(['--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required']));

const INIT = () => {
  window.__ft = [];
  window.__lt = [];
  window.__calls = { pictureInto: [], attach: [], fold: [] };
  window.__wrapped = null;
  window.__wrappedP = null;
  window.__wrapMiss = [];
  const wrap = () => {
    const g = window.__game?.city?.ground;
    if (!g) return;
    // (the ground once, and its pictures by place once they're made: useGeo comes after the city)
    const P = g.geoPaint ?? null;
    if (window.__wrapped === g && window.__wrappedP === P) return;
    const one = (name, on, as) => {
      const orig = on[as];
      if (typeof orig !== 'function') {
        window.__wrapMiss.push(name);
        return;
      }
      on[as] = function (...a) {
        const t0 = performance.now();
        try {
          return orig.apply(this, a);
        } finally {
          // [start, ms, tile key or the blast's radius]
          window.__calls[name].push([t0, performance.now() - t0, name === 'fold' ? (a[0]?.spec ?? a[0])?.r : (a[0]?.key ?? a[0])]);
        }
      };
    };
    if (window.__wrapped !== g) {
      window.__wrapped = g;
      window.__wrapMiss = [];
      one('attach', g, 'attach');
      if (!P) for (const n of ['pictureInto', 'fold']) if (typeof g[n] === 'function') one(n, g, n);
    }
    if (P && window.__wrappedP !== P) {
      window.__wrappedP = P;
      one('pictureInto', P, 'copyStep');
      one('fold', P, 'foldStep');
    }
  };
  let last = 0;
  const tick = (t) => {
    if (last) window.__ft.push([t, t - last]);
    last = t;
    wrap();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {
    window.__ltError = String(e);
  }
};

export async function open(browser, base, q, ctx = null) {
  ctx ??= await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.addInitScript(INIT);
  await page.goto(base + q, { waitUntil: 'load', timeout: 120000 });
  return { ctx, page, errors };
}

export const now = (page) => page.evaluate(() => performance.now());

/** Frames, long tasks and wrapped calls between two page times (ms), each call put in the frame it delayed (the first rAF stamp after it starts). */
export const window_ = (page, a, b) =>
  page.evaluate(([a, b]) => {
    const ft = window.__ft.filter(([t]) => t > a && t <= b);
    const fts = ft.map(([, d]) => d).sort((x, y) => x - y);
    const q = (s, p) => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(1);
    const lt = window.__lt.filter(([t]) => t >= a && t <= b);
    const frameOf = (c) => ft.findIndex(([t]) => t > c);
    const calls = {};
    for (const [name, list] of Object.entries(window.__calls)) {
      const cs = list.filter(([t]) => t >= a && t <= b);
      const ms = cs.map(([, d]) => d).sort((x, y) => x - y);
      const per = new Map();
      for (const [t, d] of cs) {
        const i = frameOf(t);
        per.set(i, (per.get(i) ?? [0, 0]).map((v, k) => v + (k ? d : 1)));
      }
      calls[name] = { n: cs.length, median: +(ms[ms.length >> 1] ?? 0).toFixed(2), max: +(ms.at(-1) ?? 0).toFixed(2), total: +ms.reduce((s, d) => s + d, 0).toFixed(1), mostInAFrame: Math.max(0, ...[...per.values()].map((v) => v[0])), mostMsInAFrame: +Math.max(0, ...[...per.values()].map((v) => v[1])).toFixed(1), perFrame: per, raw: cs };
    }
    return {
      frames: ft.length, median: q(fts, 0.5), p95: q(fts, 0.95), p99: q(fts, 0.99), maxFrame: +(fts.at(-1) ?? 0).toFixed(1),
      over33: fts.filter((d) => d > 33.4).length, over50: fts.filter((d) => d > 50).length, over100: fts.filter((d) => d > 100).length,
      longTasks: lt.length, maxTask: +Math.max(0, ...lt.map(([, d]) => d)).toFixed(0),
      // each frame over 50 ms: [ms after a, its ms, pictureInto calls in it, their ms, attach calls in it, fold calls in it]
      longFrames: ft.map(([t, d], i) => [t, d, i]).filter(([, d]) => d > 50).map(([t, d, i]) => [Math.round(t - a), Math.round(d), ...['pictureInto', 'attach', 'fold'].flatMap((n) => (n === 'pictureInto' ? [calls[n].perFrame.get(i)?.[0] ?? 0, +(calls[n].perFrame.get(i)?.[1] ?? 0).toFixed(1)] : [calls[n].perFrame.get(i)?.[0] ?? 0]))]),
      tasks: lt.map(([t, d]) => [Math.round(t - a), Math.round(d)]),
      calls: Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, { ...v, perFrame: undefined, raw: undefined }])),
      // pictureInto calls that did the copy (over 0.2 ms; the rest return before it: no pictures near the tile)
      copies: (() => {
        const cs = calls.pictureInto.raw.filter(([, d]) => d > 0.2), ms = cs.map(([, d]) => d).sort((x, y) => x - y), per = new Map();
        for (const [t] of cs) per.set(frameOf(t), (per.get(frameOf(t)) ?? 0) + 1);
        const frameMs = [...per.keys()].map((i) => ft[i]?.[1] ?? 0).sort((x, y) => x - y);
        return { n: cs.length, median: +(ms[ms.length >> 1] ?? 0).toFixed(2), max: +(ms.at(-1) ?? 0).toFixed(2), mostInAFrame: Math.max(0, ...per.values()), framesWithCopies: per.size, theirFrameMedian: +(frameMs[frameMs.length >> 1] ?? 0).toFixed(1), theirFrameMax: +(frameMs.at(-1) ?? 0).toFixed(1) };
      })(),
      foldCalls: calls.fold.raw.map(([t, d, r]) => [Math.round(t - a), +d.toFixed(1), Math.round(r)]),
    };
  }, [a, b]);
