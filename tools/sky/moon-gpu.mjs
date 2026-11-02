#!/usr/bin/env node
// What the Moon's ground costs the GPU: node tools/sky/moon-gpu.mjs [--old=http://localhost:4180/] [--px=390] [--frames=120]
// The same still frames from this build and another, GPU timer queries over the whole frame, in ms. A laptop's GPU, not a phone's: it's the two builds against each other that means anything.
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const NEW = process.env.BASE ?? 'http://localhost:4179/', OLD = opt('old', 'http://localhost:4180/'), px = opt('px', '390'), n = Number(opt('frames', 120));
const VIEWS = { 'orbit, full Sun': 'view=moon&km=300&lat=10&lon=-5&heading=0&pitch=52', 'orbit, painted bits': 'view=moon&km=300&lat=40&lon=-9&heading=0&pitch=52', 'disc 460 px': 'view=moon&km=3000', 'far disc': 'view=moon&km=60000' };
const browser = await chromium.launch(browserOptions([]));
const time = async (base, q) => {
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}?moonrun&t=2026-11-25T04:00:00Z&${q}&px=${px}&fps`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__game.moon.draw.ground?.ready !== false, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(
    (n) =>
      new Promise((res) => {
        const g = window.__game, gl = g.pipeline.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (!ext) return res({ none: true });
        const out = [], pend = [];
        let i = 0;
        const tick = () => {
          for (let k = pend.length - 1; k >= 0; k--) {
            const q = pend[k];
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
              if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
              gl.deleteQuery(q);
              pend.splice(k, 1);
            }
          }
          if (i++ < n) {
            const q = gl.createQuery();
            gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            g.pipeline.render(g.scene);
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            pend.push(q);
            return requestAnimationFrame(tick);
          }
          if (pend.length) return requestAnimationFrame(tick);
          out.sort((a, b) => a - b);
          res({ n: out.length, med: +out[out.length >> 1].toFixed(2), p90: +out[Math.floor(out.length * 0.9)].toFixed(2) });
        };
        tick();
      }),
    n,
  );
  await page.close();
  return r;
};
try {
  for (const [name, q] of Object.entries(VIEWS)) {
    const a = await time(OLD, q), b = await time(NEW, q);
    console.log(name.padEnd(22), 'was', JSON.stringify(a), 'now', JSON.stringify(b));
  }
} finally {
  await browser.close();
}
