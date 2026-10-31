#!/usr/bin/env node
// What one frame is made of: draws and triangles per kind of object, the G-buffer pass and the sun pass apart.
// Every draw goes through renderer.renderBufferDirect: this tool counts there, for one frame, on the real scene.
//   node tools/framecost.mjs <baseUrl> "<query>" [--alt=500] [--heading=0] [--label=name]
// e.g. node tools/framecost.mjs http://127.0.0.1:4175/ "lat=37.7560&lon=-122.4830" --alt=500 --heading=0
import { chromium } from 'playwright-core';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base = 'http://127.0.0.1:4175/', query = 'lat=37.7560&lon=-122.4830'] = pos;
const alt = Number(opt.alt ?? 0);
const heading = Number(opt.heading ?? 0);
const browser = await chromium.launch(browserOptions([]));
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}?${query}&heading=${heading}&skipintro&nohud&fps`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
const run = (cond, maxS) =>
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
if (alt > 40) {
  await page.evaluate(() => (window.__qa = { sx: 0, sy: -1 }));
  await run(`g.flight.y + Math.max(0, g.flight.vy) / (2 * 0.85) >= ${alt} || g.flight.strain > 0.85`, 90);
  await page.evaluate(() => (window.__qa = null));
}
await run('false', 2);
await run('!g.city.busy', 30);
await run('false', 1);
const cost = await page.evaluate(
  () =>
    new Promise((res) => {
      const g = window.__game, r = g.pipeline.renderer;
      const orig = r.renderBufferDirect;
      const rows = new Map();
      let armed = false;
      const kindOf = (o, geo, mat) => {
        const a = geo.attributes;
        if (a.aBld) return o.parent === g.city.root && geo.drawRange.count === Infinity ? 'buildings' : 'buildings';
        if (o.isInstancedMesh) return `instanced ${mat.type} ${geo.index ? geo.index.count / 3 : a.position.count / 3}t`;
        if (o.isPoints) return 'points';
        if (Object.keys(a).length === 1 && a.position) return o.layers.mask === 1 ? 'position-only' : 'casters';
        if (a.aHue || a.aPat) return 'landmark / prop';
        return `other ${mat.type} ${Object.keys(a).join('+')}`;
      };
      r.renderBufferDirect = function (camera, scene, geo, mat, o, group) {
        if (armed) {
          const pass = camera.isOrthographicCamera && camera.layers.mask !== 1 ? 'sun' : camera.isPerspectiveCamera ? 'gbuffer' : 'post';
          const dr = geo.drawRange;
          const total = geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0;
          let n = Math.max(0, Math.min(total, dr.start + dr.count) - dr.start);
          const mode = o.isPoints ? 1 : o.isLine ? 2 : 3;
          let tris = n / mode;
          if (o.isInstancedMesh) tris *= o.count;
          const k = `${pass}: ${kindOf(o, geo, mat)}`;
          const row = rows.get(k) ?? { draws: 0, tris: 0 };
          row.draws++;
          row.tris += tris;
          rows.set(k, row);
        }
        return orig.apply(this, arguments);
      };
      let frames = 0;
      const tick = () => {
        frames++;
        if (frames === 2) armed = true;
        if (frames === 3) {
          armed = false;
          r.renderBufferDirect = orig;
          res({ stats: window.__stats, y: g.flight.y, rows: [...rows].sort((a, b) => b[1].tris - a[1].tris) });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
);
const sum = (p) => cost.rows.filter(([k]) => k.startsWith(p)).reduce((s, [, r]) => [s[0] + r.draws, s[1] + r.tris], [0, 0]);
console.log(JSON.stringify({ label: opt.label ?? query, y: Math.round(cost.y), statsCalls: cost.stats?.calls, statsTris: cost.stats?.triangles, gbuffer: sum('gbuffer'), sun: sum('sun') }));
for (const [k, r] of cost.rows) console.log(`  ${k.padEnd(52)} ${String(r.draws).padStart(4)} draws ${String(Math.round(r.tris)).padStart(9)} tris`);
await browser.close();
