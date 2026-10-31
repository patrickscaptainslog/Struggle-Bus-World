#!/usr/bin/env node
// Streaming stalls in real time: flies a scripted route over a neighborhood and attributes every long frame.
//   node tools/stalls.mjs <url> <out.json> [--route=alamo] [--repeat=1] [--hitch=25]
// A fresh browser, the real game clock (no ?fixeddt), iPhone viewport. Per frame: interval, CPU work, time inside
// City.update and inside each streaming call, bytes uploaded (bufferData, texture uploads), programs linked. The report
// lists the frames over --hitch ms with what ran in them, frames over 25 / 33 / 50 / 100 ms and the worst frame by segment.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [url = 'http://127.0.0.1:4173/', out = 'shots/local/stalls.json'] = pos;
const route = opt.route ?? 'alamo';
const hitch = Number(opt.hitch ?? 25);
mkdirSync(dirname(out), { recursive: true });
const ROUTES = {
  // [segment, seconds, stick x, stick y]: sy < 0 climbs, sy > 0 dives / surges, sx steers
  alamo: {
    q: '?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud',
    legs: [['cruise', 12, 0, 0], ['surge', 12, 0, 1], ['turn', 6, 1, 0], ['cruise2', 10, 0, 0], ['surge2', 10, 0, 1], ['turn2', 6, -1, 0.4], ['climb', 9, 0, -1], ['high', 6, 0.5, 0], ['dive', 12, 0, 1], ['cruise3', 8, 0, 0]],
  },
  fidi: {
    q: '?lat=37.7925&lon=-122.4010&heading=180&skipintro&nohud',
    legs: [['cruise', 10, 0, 0], ['surge', 10, 0, 1], ['turn', 6, 1, 0], ['surge2', 10, 0, 1]],
  },
};
const R = ROUTES[route];

const browser = await chromium.launch(browserOptions(['--enable-precise-memory-info']));
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
await page.addInitScript(() => {
  const S = (window.__st = { frames: [], cur: null, long: [], on: false, seg: '' });
  const blank = () => ({ upload: 0, tex: 0, links: 0, calls: {} });
  S.cur = blank();
  const P = WebGL2RenderingContext.prototype;
  const wrapBytes = (name, size) => {
    const f = P[name];
    P[name] = function (...a) {
      S.cur.upload += size(a);
      return f.apply(this, a);
    };
  };
  wrapBytes('bufferData', (a) => (typeof a[1] === 'number' ? a[1] : (a[1]?.byteLength ?? 0)));
  wrapBytes('bufferSubData', (a) => a[2]?.byteLength ?? 0);
  for (const n of ['texImage2D', 'texSubImage2D', 'texStorage2D']) {
    const f = P[n];
    P[n] = function (...a) {
      S.cur.tex++;
      return f.apply(this, a);
    };
  }
  const link = P.linkProgram;
  P.linkProgram = function (p) {
    S.cur.links++;
    return link.call(this, p);
  };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (S.on) S.long.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    /* no longtask API */
  }
  S.wrap = (obj, name, label) => {
    const f = obj[name];
    if (!f) return;
    obj[name] = function (...a) {
      const t = performance.now();
      const r = f.apply(this, a);
      const c = S.cur.calls;
      const e = (c[label] ??= [0, 0]);
      e[0]++;
      e[1] += performance.now() - t;
      return r;
    };
  };
});
await page.goto(url + R.q, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
await page.waitForTimeout(1500);
if (opt.trace) await browser.startTracing(page, { path: opt.trace, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'disabled-by-default-v8.gc', 'blink.user_timing', 'gpu', 'toplevel'] });
await page.evaluate(() => {
  const S = window.__st;
  const g = window.__game;
  const c = g.city;
  for (const n of ['update', 'addTile', 'swapRegion', 'prepTile', 'buildRegionMesh', 'buildRegionGround', 'unloadRegion', 'meshTops', 'makeBuildingMesh', 'onRegion', 'firstsDone']) S.wrap(c, n, n);
  const p = g.pipeline;
  S.wrap(p, 'render', 'render');
  const blank = () => ({ upload: 0, tex: 0, links: 0, calls: {} });
  let last = performance.now();
  const tick = (now) => {
    requestAnimationFrame(tick);
    if (S.on) {
      const f = S.cur;
      f.t = now;
      f.dt = now - last;
      f.seg = S.seg;
      f.tiles = c.tiles.size;
      f.adopt = c.adopt.length;
      S.frames.push(f);
    }
    S.cur = blank();
    last = now;
  };
  requestAnimationFrame(tick);
  S.on = true;
});
const report = { url, route, legs: [] };
for (const [seg, seconds, sx, sy] of R.legs) {
  await page.evaluate(([s, x, y]) => {
    window.__st.seg = s;
    window.__qa = Object.assign(window.__qa ?? {}, { sx: x, sy: y });
  }, [seg, sx, sy]);
  if (sx === 0 && sy === 0) await page.evaluate(() => (delete window.__qa.sx, delete window.__qa.sy));
  await page.waitForTimeout(seconds * 1000);
}
const res = await page.evaluate(() => {
  const S = window.__st;
  S.on = false;
  const g = window.__game;
  return { frames: S.frames, long: S.long, flight: { x: g.flight.x, z: g.flight.z, y: g.flight.y } };
});
if (opt.trace) await browser.stopTracing();
await browser.close();

const fr = res.frames.filter((f, i) => i > 1);
const pct = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];
const summarize = (l) => ({
  frames: l.length,
  fps: Math.round((1000 * l.length) / Math.max(1, l.reduce((s, f) => s + f.dt, 0))),
  p50: +pct(l.map((f) => f.dt), 0.5).toFixed(1),
  p99: +pct(l.map((f) => f.dt), 0.99).toFixed(1),
  max: +Math.max(...l.map((f) => f.dt)).toFixed(1),
  over25: l.filter((f) => f.dt > 25).length,
  over33: l.filter((f) => f.dt > 34).length,
  over50: l.filter((f) => f.dt > 50).length,
  over100: l.filter((f) => f.dt > 100).length,
  maxUploadMB: +(Math.max(...l.map((f) => f.upload)) / 1048576).toFixed(2),
});
report.all = summarize(fr);
const segs = [...new Set(fr.map((f) => f.seg))];
for (const s of segs) report.legs.push({ seg: s, ...summarize(fr.filter((f) => f.seg === s)) });
report.long = res.long;
report.hitches = fr
  .filter((f) => f.dt > hitch)
  .map((f) => ({
    seg: f.seg,
    t: Math.round(f.t),
    dt: +f.dt.toFixed(1),
    uploadMB: +(f.upload / 1048576).toFixed(2),
    tex: f.tex,
    links: f.links,
    adopt: f.adopt,
    calls: Object.fromEntries(Object.entries(f.calls).map(([k, v]) => [k, `${v[0]}x ${v[1].toFixed(1)}ms`])),
  }));
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(url, route, JSON.stringify(report.all));
for (const l of report.legs) console.log(' ', JSON.stringify(l));
console.log('long tasks', report.long.length, 'max', Math.max(0, ...report.long.map((x) => x[1])));
for (const h of [...report.hitches].sort((a, b) => b.dt - a.dt).slice(0, 12)) console.log(' ', JSON.stringify(h));
