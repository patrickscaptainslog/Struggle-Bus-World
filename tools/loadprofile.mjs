#!/usr/bin/env node
// Cold-load profile of the real game: what happens between navigation and the first
// playable frame, so load time can be measured and compared across builds.
//   node tools/loadprofile.mjs <url> <out.json> [--throttle=<cpuRate>] [--net=<kbps>] [--query=...]
// Records (all ms from navigation start): DOMContentLoaded, first rendered frame, the
// first region loaded, ready (window.__shotReady), every request (size, duration), main
// thread long tasks (> 50 ms), WebGL shader compile / program link time (wrapped calls,
// incl. the first getProgramParameter status poll, where drivers finish linking), and
// the number of programs, the first draw into the canvas (the first presented real frame),
// when each program was created (and how many after ready), and when each region request
// went out. A fresh browser context each run, so nothing is cached.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [url = 'http://127.0.0.1:4173/', out = 'loadprofile.json'] = pos;

const browser = await chromium.launch(browserOptions([]));
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
if (opt.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(opt.throttle) });
if (opt.net) {
  const kbps = Number(opt.net);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (kbps * 1024) / 8, uploadThroughput: (kbps * 1024) / 8 });
}
await page.addInitScript(() => {
  const W = (window.__lp = { compile: 0, link: 0, status: 0, programs: 0, shaders: 0, frames: [], longTasks: [], programAt: [], canvasDrawAt: null, readyAt: null });
  const P = WebGL2RenderingContext.prototype;
  const wrap = (name, key) => {
    const f = P[name];
    P[name] = function (...a) {
      const t = performance.now();
      const r = f.apply(this, a);
      W[key] += performance.now() - t;
      return r;
    };
  };
  wrap('compileShader', 'compile');
  wrap('linkProgram', 'link');
  const gpp = P.getProgramParameter;
  P.getProgramParameter = function (p, k) {
    const t = performance.now();
    const r = gpp.call(this, p, k);
    W.status += performance.now() - t;
    return r;
  };
  const cp = P.createProgram;
  P.createProgram = function () { W.programs++; W.programAt.push(Math.round(performance.now())); return cp.call(this); };
  // the first draw into the default framebuffer: the first real frame the player can see
  let fbNull = true;
  const bf = P.bindFramebuffer;
  P.bindFramebuffer = function (t, fb) { if (t !== this.READ_FRAMEBUFFER) fbNull = fb === null; return bf.call(this, t, fb); };
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
    const f = P[name];
    P[name] = function (...a) { if (fbNull && W.canvasDrawAt === null) W.canvasDrawAt = Math.round(performance.now()); return f.apply(this, a); };
  }
  const cs = P.createShader;
  P.createShader = function (t) { W.shaders++; return cs.call(this, t); };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) W.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
  } catch {}
  const raf = window.requestAnimationFrame.bind(window);
  let n = 0;
  const tick = (t) => {
    if (W.readyAt === null && window.__shotReady === true) W.readyAt = Math.round(performance.now());
    if (n++ < 20000) { if (W.frames.length < 400) W.frames.push(Math.round(t)); raf(tick); }
  };
  raf(tick);
});
const reqs = new Map();
cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, t0: e.timestamp }));
cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.t1 = e.timestamp; r.bytes = e.encodedDataLength; } });
// the city worker's region fetches (the page's CDP session doesn't see a worker's requests; the context does)
const regionReq = new Map();
ctx.on('request', (r) => { if (/\/r_-?\d+_-?\d+/.test(r.url())) regionReq.set(r, { name: r.url().replace(/^.*\//, ''), start: Date.now() }); });
ctx.on('requestfinished', (r) => { const q = regionReq.get(r); if (q) q.end = Date.now(); });
const t0 = Date.now();
await page.goto(url + (opt.query ?? ''), { waitUntil: 'domcontentloaded', timeout: 300000 });
const dcl = Date.now() - t0;
await page.waitForFunction(() => window.__game?.city?.loadedRegionCount?.() > 0, null, { timeout: 300000, polling: 50 });
const firstRegion = Date.now() - t0;
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000, polling: 100 });
const ready = Date.now() - t0;
const lp = await page.evaluate(() => window.__lp);
const warm = await page.evaluate(() => window.__game?.warm?.report ?? null);
const navT0 = Math.min(...[...reqs.values()].map((r) => r.t0));
const list = [...reqs.values()].filter((r) => r.t1).map((r) => ({
  url: r.url.replace(/^https?:\/\/[^/]+/, ''), kb: Math.round((r.bytes ?? 0) / 102.4) / 10,
  start: Math.round((r.t0 - navT0) * 1000), ms: Math.round((r.t1 - r.t0) * 1000),
}));
const byType = {};
for (const r of list) {
  const k = r.url.includes('/city/') ? 'city' : r.url.endsWith('.js') ? 'js' : 'other';
  byType[k] = byType[k] ?? { n: 0, kb: 0 };
  byType[k].n++;
  byType[k].kb += r.kb;
}
const res = {
  url, throttle: opt.throttle ?? 1, net: opt.net ?? 'none', dclMs: dcl, firstRegionMs: firstRegion, readyMs: ready,
  firstFrameMs: lp.canvasDrawAt,
  readyInPageMs: lp.readyAt,
  programsAfterReady: lp.readyAt === null ? null : lp.programAt.filter((t) => t > lp.readyAt).length,
  programAt: lp.programAt,
  warm,
  gl: { programs: lp.programs, shaders: lp.shaders, compileMs: Math.round(lp.compile), linkMs: Math.round(lp.link), statusPollMs: Math.round(lp.status) },
  longTasks: { n: lp.longTasks.length, totalMs: lp.longTasks.reduce((a, b) => a + b[1], 0), top: [...lp.longTasks].sort((a, b) => b[1] - a[1]).slice(0, 10) },
  requests: byType,
  slowest: [...list].sort((a, b) => b.ms - a.ms).slice(0, 10),
  boot: list.filter((r) => /city\.json|far\.|horizon\./.test(r.url)).map((r) => [r.url, r.start, r.ms]),
  // [file, start, ms] from the start of navigation (Date.now based: comparable between runs, ~10 ms coarse)
  regions: [...regionReq.values()].map((q) => [q.name, q.start - t0, q.end ? q.end - q.start : null]).sort((a, b) => a[1] - b[1]),
};
writeFileSync(out, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 1));
await browser.close();
