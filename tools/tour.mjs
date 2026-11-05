#!/usr/bin/env node
// The picture gate (docs/specs/bridges/BRIDGES.md section 5): the frames tools/bake/tour.py picked from a city's data, taken
// from the real game, on one contact sheet, each frame captioned with what it looks at, its OSM id, lat and lon.
//   node tools/tour.mjs <baseUrl> <slug> [--list=tools/bake/.cache/qa/<slug>/tour.json] [--out=shots/local/tour/<slug>]
//        [--qa=<city.json with stats.qa>] [--only=1,5,9] [--w=393 --h=852 --dpr=1]
// Each frame is a fresh page at ?city=<slug>&lat=&lon=&heading=&skipintro&nohud: the bus held there, every frame, as
// tools/sweep.mjs holds it (where the list puts it, x, z, heading and height, until the city around it has streamed in),
// then __qa.holdFrames freezes the game and the shot is taken. A frame the list gives the 'low' camera is taken with the
// opening's (CameraRig.openingLow: 17 m over the bus, looking level), the others with the chase camera.
// --qa: a city.json whose stats.qa holds the bridge checks (qa.py's): the sheet's head lists those NOT READ and those over
// their limits. The head lists the spans of 1 km or more with no tower and no structure tag either way (openSpans).
// Writes <out>/<nn>.png, <out>/sheet.png and <out>/tour-run.json (per frame: the bus as held, draws, triangles, seconds,
// where the camera stood, and where the bus and the list's marks fell in the frame, x and y from its top left, 0-1).
// No pass or fail: one look, once. Exit code 1 if a page throws or a frame never settles.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const argv = process.argv.slice(2);
const args = argv.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.join('=') || '1'];
  }),
);
const [baseArg = 'http://127.0.0.1:4179/', slug = 'sf'] = args;
const base = baseArg.endsWith('/') ? baseArg : baseArg + '/';
const list = JSON.parse(readFileSync(flags.list ?? `tools/bake/.cache/qa/${slug}/tour.json`, 'utf8'));
const out = flags.out ?? `shots/local/tour/${slug}`;
const W = Number(flags.w ?? 393), H = Number(flags.h ?? 852), dpr = Number(flags.dpr ?? 1);
const only = flags.only ? new Set(flags.only.split(',').map(Number)) : null;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions([]));
const run = { base, slug, list: list.written, frames: [] };
let failed = false;
const t0 = Date.now();
for (const [k, f] of list.frames.entries()) {
  const n = k + 1;
  if (only && !only.has(n)) continue;
  const ts = Date.now();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const rec = { n, ...f, ok: false };
  try {
    await page.goto(`${base}?city=${slug}&lat=${f.lat}&lon=${f.lon}&heading=${f.heading}&skipintro&nohud`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
    // (held every frame, where the list put it: from the load to here the bus has flown on at cruise, 45 m or so. No flying
    // off, no climbing out; the camera starts over behind the bus, the opening's low one if asked)
    await page.evaluate(([y, low, xz, heading]) => {
      const g = window.__game, fl = g.flight;
      const hold = (window.__hold = { x: xz ? xz[0] : fl.x, z: xz ? xz[1] : fl.z, y, heading: (heading * Math.PI) / 180 });
      Object.assign(fl, { y, vy: 0, holdY: y, speed: 0, glideSpeed: 0 });
      g.rig.openingLow = low ? 1 : 0;
      g.rig.initialized = false;
      const tick = () => {
        fl.x = hold.x;
        fl.z = hold.z;
        fl.heading = hold.heading;
        fl.y = hold.y;
        fl.vy = 0;
        requestAnimationFrame(tick);
      };
      tick();
    }, [f.y, f.camera === 'low', f.xz ?? null, f.heading]);
    const until = (cond, maxS) =>
      page.evaluate(
        ([c, m]) =>
          new Promise((res) => {
            const g = window.__game;
            const test = new Function('g', `return (${c})`);
            const start = g.clock();
            const tick = () => (g.clock() - start >= m || test(g) ? res(+(g.clock() - start).toFixed(2)) : requestAnimationFrame(tick));
            tick();
          }),
        [cond, maxS],
      );
    await until('false', 2);
    rec.streamS = await until('!g.city.busy', 20);
    await until('false', 0.5);
    await page.evaluate(() => (window.__qa = { holdFrames: 2 }));
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 30000 });
    const file = `${String(n).padStart(2, '0')}.png`;
    await page.screenshot({ path: `${out}/${file}` });
    Object.assign(rec, await page.evaluate((marks) => {
      const g = window.__game, fl = g.flight, cam = g.camera;
      // (where a point fell in the frame: from the camera as the rig set it, by its own lens, the rig's hfov across the
      // portrait frame; null behind it)
      const P = new cam.position.constructor(), Q = new cam.quaternion.constructor();
      cam.updateMatrixWorld(true);
      cam.getWorldPosition(P);
      cam.getWorldQuaternion(Q);
      const th = Math.tan((g.rig.hfov * Math.PI) / 360), tv = (th * innerHeight) / innerWidth;
      const at = ([x, y, z]) => {
        const v = new P.constructor(x, y, z).sub(P).applyQuaternion(Q.clone().invert());
        return -v.z > 0.1 ? [+(0.5 + v.x / -v.z / th / 2).toFixed(3), +(0.5 - v.y / -v.z / tv / 2).toFixed(3)] : null;
      };
      return {
        bus: [fl.x, fl.y, fl.z].map((v) => +v.toFixed(1)),
        draws: window.__stats?.calls ?? null,
        tris: window.__stats?.triangles ?? null,
        cam: [P.x, P.y, P.z].map((v) => +v.toFixed(1)),
        camLow: g.rig.openingLow,
        speed: +fl.speed.toFixed(1),
        busAt: at([fl.x, fl.y, fl.z]),
        marksAt: marks.map(([what, x, y, z]) => [what, at([x, y, z])]),
      };
    }, f.marks ?? []));
    Object.assign(rec, { file, ok: true });
  } catch (e) {
    rec.error = String(e.message ?? e).slice(0, 300);
    failed = true;
  }
  if (errors.length) {
    rec.pageErrors = errors.slice(0, 5);
    failed = true;
  }
  rec.seconds = +((Date.now() - ts) / 1000).toFixed(1);
  run.frames.push(rec);
  console.log(`${n} ${rec.ok ? 'ok' : 'FAILED'} ${rec.seconds}s ${f.kind} ${f.name}: ${f.subject}` + (rec.error ? ` ${rec.error}` : '') + (rec.pageErrors ? ` [pageerror] ${rec.pageErrors[0]}` : ''));
  await page.close();
}

// ---- the sheet: a row of nine, each frame captioned; the head names the build, the city and what no check can read
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const img = (f) => `data:image/png;base64,${readFileSync(`${out}/${f}`).toString('base64')}`;
let qaHead = '';
if (flags.qa && existsSync(flags.qa)) {
  const b = JSON.parse(readFileSync(flags.qa, 'utf8')).stats?.qa?.bridges ?? {};
  const nr = Object.keys(b).filter((k) => !b[k].read), over = Object.keys(b).filter((k) => b[k].over);
  qaHead = `<p>Bridge checks NOT READ: ${esc(nr.join(', ') || 'none')}. Over their limits (reported): ${esc(over.join(', ') || 'none')}.</p>`;
}
const spans = (list.openSpans ?? []).map((s) => `${s.name} ${s.length.toLocaleString('en')} m (${s.osm}, ${s.lat}, ${s.lon})`);
const cells = run.frames
  .filter((r) => r.ok)
  .map((r) => `<figure><img src="${img(r.file)}"><figcaption><b>${r.n}. ${esc(r.name)}</b> ${esc(r.osm)}<br>${esc(r.subject)}<br>looks at ${r.look.lat}, ${r.look.lon}<br>bus ${r.lat}, ${r.lon}, y ${r.y}, heading ${r.heading}${r.camera === 'low' ? ', the low camera' : ''}</figcaption></figure>`);
const sheet = await browser.newPage();
await sheet.setViewportSize({ width: 9 * 310 + 20, height: 400 });
await sheet.setContent(
  `<style>body{margin:10px;background:#222;font:13px sans-serif;color:#ddd}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0 8px}.grid{display:flex;flex-wrap:wrap;gap:10px}` +
    `figure{margin:0;width:300px}img{width:300px;height:${Math.round((300 * H) / W)}px;display:block;image-rendering:pixelated}figcaption{font-size:11px;line-height:1.3;margin-top:3px}</style>` +
    `<h1>Tour: ${esc(slug)}, ${cells.length} of ${list.frames.length} frames, ${esc(base)}, list ${esc(list.written)}</h1>` +
    `<p>Decks by class: ${esc(Object.entries(list.classes ?? {}).map(([c, v]) => `${c} ${v}`).join(', '))}. Spans of 1 km or more with no tower and no structure tag: ${esc(spans.join('; ') || 'none')}.</p>` +
    qaHead +
    `<div class="grid">${cells.join('')}</div>`,
);
await sheet.screenshot({ path: `${out}/sheet.png`, fullPage: true });
await browser.close();
run.seconds = +((Date.now() - t0) / 1000).toFixed(1);
writeFileSync(`${out}/tour-run.json`, JSON.stringify(run, null, 1));
console.log(`sheet ${out}/sheet.png: ${cells.length} frames in ${run.seconds} s` + (failed ? '; some frames FAILED' : ''));
process.exit(failed ? 1 : 0);
