#!/usr/bin/env node
// Renderer cost split by pass (sun shadow pass vs. main G-buffer pass vs.
// post), from the real game, iPhone portrait viewport. SwiftShader fps is
// meaningless here: draw calls, triangles and CPU work per frame are real.
//   node tools/perf-pass.mjs <baseUrl> <out.json> [modes...] [--frames=8] [--label=name] [--by]
// modes (default: views):
//   views    the Painted Ladies and FiDi at the rooftops, downtown at 250 m and the
//            ceiling (climbed from the altitude QA's downtown start); once
//            streaming settles the bus is put back on a fixed spot and slowed to
//            a near stop (0.01 m/s glide), so both builds measure the same view
//   compile  first blast + first escalation at the Painted Ladies: per-frame CPU
//            work and WebGL programs linked per frame (a compile spike shows as
//            a link + a long frame)
//   stream   a 30 s (game clock) surge east from Alamo Square: main-thread ms per
//            streaming call (region arrival, tile adoption, LOD swaps, ground
//            builds) and bytes uploaded to the GPU per frame (bufferData hook)
//   memory   a 3-minute (game clock) downtown surge loop at the rooftops on a
//            fixed 0.1 s step: building/terrain geometry bytes on the GPU, JS
//            heap (after a forced GC) and LOD0 regions, sampled every 10 s
// --by: also break each pass down by object kind (buildings / casters / terrain /
//       far / instanced ...).
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base = 'http://127.0.0.1:4721/', outFile = 'perf-pass.json', ...modeArgs] = pos;
const modes = new Set(modeArgs.length ? modeArgs : ['views']);
const FRAMES = Number(opt.frames ?? 8);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});

async function open(query, { dpr = 3 } = {}) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  await page.addInitScript(() => {
    // a grey city every time (no saved building or ground paint)
    for (const k of Object.keys(localStorage)) if (k.startsWith('strugglebus.')) localStorage.removeItem(k);
    // bytes uploaded per frame (bufferData / bufferSubData), and live GPU buffer bytes
    window.__upload = 0;
    window.__gpuBytes = 0;
    const P = WebGL2RenderingContext.prototype;
    const bound = new Map();
    const sizes = new Map();
    const bb = P.bindBuffer;
    P.bindBuffer = function (t, b) {
      bound.set(t, b);
      return bb.call(this, t, b);
    };
    const db = P.deleteBuffer;
    P.deleteBuffer = function (b) {
      if (sizes.has(b)) window.__gpuBytes -= sizes.get(b);
      sizes.delete(b);
      return db.call(this, b);
    };
    const bd = P.bufferData;
    P.bufferData = function (t, d, u, ...rest) {
      const n = d && d.byteLength ? d.byteLength : typeof d === 'number' ? d : 0;
      window.__upload += n;
      const b = bound.get(t);
      if (b) {
        window.__gpuBytes += n - (sizes.get(b) ?? 0);
        sizes.set(b, n);
      }
      return bd.call(this, t, d, u, ...rest);
    };
    const bsd = WebGL2RenderingContext.prototype.bufferSubData;
    WebGL2RenderingContext.prototype.bufferSubData = function (t, o, d, so, len) {
      if (d && d.byteLength) window.__upload += len ? len * (d.BYTES_PER_ELEMENT || 1) : d.byteLength;
      return bsd.call(this, t, o, d, so, len);
    };
    // count program links (a link mid-play is a compile hitch)
    window.__links = 0;
    const lp = WebGL2RenderingContext.prototype.linkProgram;
    WebGL2RenderingContext.prototype.linkProgram = function (p) {
      window.__links++;
      return lp.call(this, p);
    };
  });
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await page.evaluate((by) => {
    const g = window.__game;
    const r = g.pipeline.renderer;
    const pl = g.pipeline;
    const cur = { shadow: [0, 0], main: [0, 0], post: [0, 0], by: {} };
    const kindOf = (o, geo) => {
      if (o.userData && o.userData.sbKind) return o.userData.sbKind;
      if (o.isInstancedMesh) return 'instanced';
      const a = geo.attributes;
      if (a.aBld) return 'buildings';
      if (a.ramp) return 'far';
      if (Object.keys(a).length === 1) return 'position-only';
      if (Object.keys(a).length === 2 && a.normal) return 'terrain';
      return 'other';
    };
    let pass = 'post';
    if (by) {
      const rbd = r.renderBufferDirect;
      r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
        const idx = geometry.index;
        let n = (idx ? idx.count : geometry.attributes.position.count) / 3;
        n = Math.min(n, geometry.drawRange.count / 3);
        if (object.isInstancedMesh) n *= object.count;
        const k = pass + ':' + kindOf(object, geometry);
        const e = (cur.by[k] ??= [0, 0]);
        e[0]++;
        e[1] += Math.round(n);
        return rbd.call(this, camera, scene, geometry, material, object, group);
      };
    }
    const orig = r.render.bind(r);
    r.render = (scene, cam) => {
      pass = cam === pl.sunCam ? 'shadow' : cam === pl.snapCam ? 'main' : 'post';
      const c0 = r.info.render.calls, t0 = r.info.render.triangles;
      orig(scene, cam);
      const e = cur[pass];
      e[0] += r.info.render.calls - c0;
      e[1] += r.info.render.triangles - t0;
    };
    const pf = g.perf.frame.bind(g.perf);
    window.__frames = [];
    let links = window.__links;
    let up = window.__upload;
    g.perf.frame = (dt, work) => {
      window.__frames.push({ t: g.clock(), work, shadow: cur.shadow.slice(), main: cur.main.slice(), post: cur.post.slice(), by: { ...cur.by }, links: window.__links - links, upload: window.__upload - up });
      if (window.__frames.length > 2000) window.__frames.shift();
      links = window.__links;
      up = window.__upload;
      cur.shadow = [0, 0];
      cur.main = [0, 0];
      cur.post = [0, 0];
      cur.by = {};
      pf(dt, work);
    };
  }, !!opt.by);
  return page;
}

const runFor = (page, s) =>
  page.evaluate(
    (s) =>
      new Promise((res) => {
        const g = window.__game;
        const t0 = g.clock();
        const tick = () => (g.clock() - t0 >= s ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    s,
  );
const runUntil = (page, cond, maxS) =>
  page.evaluate(
    ([c, m]) =>
      new Promise((res) => {
        const g = window.__game;
        const f = new Function('g', `return (${c})`);
        const t0 = g.clock();
        const tick = () => (g.clock() - t0 >= m || f(g) ? res(+(g.clock() - t0).toFixed(2)) : requestAnimationFrame(tick));
        tick();
      }),
    [cond, maxS],
  );
const settle = async (page, s) => {
  await runFor(page, s);
  await runUntil(page, '!g.city.busy', 40);
  await runFor(page, 0.5);
};
const drift = (page, v) => page.evaluate((v) => ((window.__qa = null), (window.__game.flight.glideSpeed = v)), v);
const qa = (page, v) => page.evaluate((x) => (window.__qa = x), v);
const climbTo = async (page, alt) => {
  await qa(page, { sx: 0, sy: -1 });
  await runUntil(page, `g.flight.y + Math.max(0, g.flight.vy) / (2 * 0.85) >= ${alt} || g.flight.strain > 0.85`, 60);
  await qa(page, null);
};
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function measure(page, label) {
  await page.evaluate(() => (window.__frames.length = 0));
  await page.evaluate(
    (n) =>
      new Promise((res) => {
        const tick = () => (window.__frames.length >= n ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    FRAMES,
  );
  const fr = await page.evaluate(() => window.__frames.slice());
  const pick = (p, i) => med(fr.map((f) => f[p][i]));
  const row = {
    label,
    frames: fr.length,
    workMs: +med(fr.map((f) => f.work)).toFixed(2),
    shadowCalls: pick('shadow', 0),
    shadowTris: pick('shadow', 1),
    mainCalls: pick('main', 0),
    mainTris: pick('main', 1),
    postCalls: pick('post', 0),
    calls: med(fr.map((f) => f.shadow[0] + f.main[0] + f.post[0])),
    tris: med(fr.map((f) => f.shadow[1] + f.main[1] + f.post[1])),
    links: fr.reduce((a, f) => a + f.links, 0),
    pos: await page.evaluate(() => {
      const f = window.__game.flight;
      return [Math.round(f.x), Math.round(f.y), Math.round(f.z)];
    }),
  };
  if (opt.by) {
    const keys = new Set(fr.flatMap((f) => Object.keys(f.by)));
    row.by = {};
    for (const k of [...keys].sort()) row.by[k] = [med(fr.map((f) => (f.by[k] ? f.by[k][0] : 0))), med(fr.map((f) => (f.by[k] ? f.by[k][1] : 0)))];
  }
  console.log(JSON.stringify(row));
  return row;
}

const report = { base, label: opt.label ?? base, when: new Date().toISOString(), views: [], compile: null, memory: null };

const HOLD = 0.01; // m/s: the bus all but stops (the view holds still while we measure)
// put the bus on a spot (x, z in m, heading in deg) at a near stop, let the camera and streaming settle;
// floor: back to the rooftop floor (else it keeps holding its altitude)
const pin = async (page, x, z, heading, s, floor = false) => {
  await page.evaluate(
    ([x, z, h, v, floor]) => {
      const f = window.__game.flight;
      window.__qa = null;
      f.x = x;
      f.z = z;
      f.heading = (h * Math.PI) / 180;
      f.speed = 0;
      f.glideSpeed = v;
      if (floor) f.holdY = -Infinity;
    },
    [x, z, heading, HOLD, floor],
  );
  await settle(page, s);
};
const llx = (lat, lon) => [(lon + 122.4194) * 111320 * Math.cos((37.7749 * Math.PI) / 180), -(lat - 37.7749) * 110574];
if (modes.has('views')) {
  {
    const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro');
    await drift(page, HOLD);
    await settle(page, 2);
    await pin(page, ...llx(37.77628, -122.4352), 88, 2.5, true);
    report.views.push(await measure(page, 'ladies'));
    await page.close();
  }
  {
    const page = await open('?lat=37.7925&lon=-122.4010&heading=0&skipintro');
    await drift(page, HOLD);
    await settle(page, 2);
    await pin(page, ...llx(37.7925, -122.401), 0, 2.5, true);
    report.views.push(await measure(page, 'fidi'));
    await page.close();
  }
  {
    const page = await open('?lat=37.7700&lon=-122.4300&heading=45&skipintro');
    await settle(page, 2);
    await climbTo(page, 250);
    await drift(page, HOLD);
    await settle(page, 3);
    await pin(page, ...llx(37.77092, -122.42883), 45, 3);
    report.views.push(await measure(page, 'downtown250'));
    await climbTo(page, 560);
    await drift(page, HOLD);
    await settle(page, 4);
    await pin(page, ...llx(37.77255, -122.42679), 45, 4);
    report.views.push(await measure(page, 'ceiling'));
    await page.close();
  }
}

if (modes.has('compile')) {
  // first blast and first escalation of a session (the programs they need must already be linked)
  const page = await open('?lat=37.7745&lon=-122.4330&heading=0&skipintro');
  await drift(page, 6);
  await settle(page, 1.5);
  const IMPACT = [37.7762, -122.4328];
  const linksBefore = await page.evaluate(() => window.__links);
  const grab = async (tag, s) => {
    await page.evaluate(() => (window.__frames.length = 0));
    await page.evaluate(([la, lo]) => window.__game.barfAtLatLon(la, lo), IMPACT);
    await runFor(page, s);
    const fr = await page.evaluate(() => window.__frames.slice());
    const w = fr.map((f) => f.work);
    const t0 = fr.length ? fr[0].t : 0;
    return {
      tag,
      frames: fr.length,
      workMedian: +med(w).toFixed(2),
      workMax: +Math.max(...w).toFixed(2),
      links: fr.reduce((a, f) => a + f.links, 0),
      linkFrames: fr.filter((f) => f.links > 0).map((f) => ({ t: +(f.t - t0).toFixed(2), links: f.links, work: +f.work.toFixed(1) })),
      worst: [...fr].sort((a, b) => b.work - a.work).slice(0, 4).map((f) => ({ t: +(f.t - t0).toFixed(2), work: +f.work.toFixed(1), links: f.links, uploadMB: +(f.upload / 1048576).toFixed(2) })),
    };
  };
  const first = await grab('first-blast', 2.2);
  const esc = await grab('first-escalation', 2.2);
  report.compile = { linksAtReady: linksBefore, first, escalation: esc };
  console.log(JSON.stringify(report.compile));
  await page.close();
}

if (modes.has('stream')) {
  // surge east from Alamo Square at the rooftops: regions arrive, upgrade to detail, coarsen behind
  // (devicePixelRatio 1: counts, bytes and main-thread calls don't depend on it, and SwiftShader is slow)
  const page = await open('?lat=37.77628&lon=-122.4352&heading=80&skipintro', { dpr: 1 });
  await settle(page, 1);
  await page.evaluate(() => {
    const c = window.__game.city;
    const proto = Object.getPrototypeOf(c);
    window.__calls = {};
    for (const name of ['onRegion', 'addTile', 'buildRegionMesh', 'buildRegionGround', 'swapRegion', 'makeTileTerrain', 'makeBuildingMesh', 'update']) {
      const f = proto[name];
      if (!f) continue;
      c[name] = function (...a) {
        const t0 = performance.now();
        const r = f.apply(this, a);
        (window.__calls[name] ??= []).push(+(performance.now() - t0).toFixed(3));
        return r;
      };
    }
    window.__frames.length = 0;
  });
  await qa(page, { sx: 0.05, sy: 1 });
  await runFor(page, 30);
  await qa(page, null);
  const calls = await page.evaluate(() => window.__calls);
  const fr = await page.evaluate(() => window.__frames.slice());
  const stat = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { n: s.length, sum: +s.reduce((x, y) => x + y, 0).toFixed(1), median: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
  };
  const ups = fr.map((f) => f.upload / 1048576);
  report.stream = {
    frames: fr.length,
    calls: Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, stat(v)])),
    uploadMB: { ...stat(ups.map((v) => +v.toFixed(2))), over4: ups.filter((v) => v > 4).length },
    work: stat(fr.map((f) => +f.work.toFixed(2))),
    worstFrames: [...fr].sort((a, b) => b.work - a.work).slice(0, 6).map((f) => ({ t: +f.t.toFixed(2), work: +f.work.toFixed(1), uploadMB: +(f.upload / 1048576).toFixed(2), links: f.links })),
  };
  console.log(JSON.stringify(report.stream));
  await page.close();
}

if (modes.has('memory')) {
  // a downtown surge loop at the rooftops; the fixed step keeps the run's length bounded
  const page = await open('?lat=37.7880&lon=-122.4050&heading=0&skipintro&fixeddt=0.1', { dpr: 1 });
  await settle(page, 1);
  const snap = () =>
    page.evaluate(() => {
      const g = window.__game;
      if (window.gc) window.gc();
      // JS-side copies still held by scene geometry (released after upload where the city does that)
      const seen = new Set();
      let js = 0;
      g.scene.traverse((o) => {
        const geo = o.geometry;
        if (!geo || seen.has(geo)) return;
        seen.add(geo);
        for (const a of Object.values(geo.attributes)) if (a.array) js += a.array.byteLength;
        if (geo.index && geo.index.array) js += geo.index.array.byteLength;
      });
      const c = g.city;
      let lod0 = 0;
      for (const v of c.regionLod.values()) if (v === 0) lod0++;
      return {
        t: +g.clock().toFixed(1),
        gpuBufferMB: +(window.__gpuBytes / 1048576).toFixed(1),
        jsGeometryMB: +(js / 1048576).toFixed(1),
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        geometries: g.pipeline.renderer.info.memory.geometries,
        regions: c.loadedRegionCount(),
        lod0,
      };
    });
  const rows = [await snap()];
  // surge (push up) while carving a wide loop around downtown, for 180 s of game time
  await qa(page, { sx: 0.12, sy: 1 });
  for (let i = 0; i < 18; i++) {
    await runFor(page, 10);
    rows.push(await snap());
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  await qa(page, null);
  report.memory = { rows, end: rows[rows.length - 1], peakGpuBufferMB: Math.max(...rows.map((r) => r.gpuBufferMB)), peakHeapMB: Math.max(...rows.map((r) => r.heapMB ?? 0)) };
  await page.close();
}

writeFileSync(outFile, JSON.stringify(report, null, 2));
await browser.close();
console.log('wrote', outFile);
