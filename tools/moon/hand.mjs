#!/usr/bin/env node
// One browser held open, flown by hand: real touches through CDP, on the real frame loop or a fixed step, one command at a time, so you can look at a frame and choose what to do next, as a stranger would.
//   node tools/moon/hand.mjs <out dir> [--port=4188] [--w=393] [--h=852] [--dpr=1]
// Then POST JavaScript to it: the body runs with `h` in scope, the helpers below. tools/moon/hand.sh '<body>' does the POST.
//   await h.open('site=TYCHO'); await h.drag(0, 80, 2000); await h.tap(); await h.shot('a'); return await h.state();
// A new context each open(true): a device that has never seen the game. BASE is the page (http://localhost:4179/). Nothing here is a timing.
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const out = pos[0] ?? 'shots/local/moonlow/hand';
const base = process.env.BASE ?? 'http://localhost:4179/';
const W = Number(opt.w ?? 393), H = Number(opt.h ?? 852), DPR = Number(opt.dpr ?? 1), PORT = Number(opt.port ?? 4188);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let ctx = null, page = null, cdp = null;
const errors = [];

const h = {
  get page() {
    return page;
  },
  errors,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  /** Opens the page. fresh: a device with nothing saved. query: added to ?moon. */
  async open(query = '', { fresh = false, url = null, ready = true, qa = true } = {}) {
    if (fresh || !ctx) {
      await ctx?.close();
      ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
      page = null;
    }
    if (!page) {
      page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
      page.on('console', (m) => {
        if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('404') && !m.text().includes('GPU stall') && !m.text().includes('did not converge')) errors.push(`${m.type()} ${m.text().slice(0, 400)}`);
      });
      cdp = await ctx.newCDPSession(page);
    }
    errors.length = 0;
    const t0 = Date.now();
    await page.goto(url ?? `${base}?moon${query ? '&' + query : ''}`, { waitUntil: 'load', timeout: 180000 });
    if (ready) await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
    if (ready && qa)
      await page.evaluate(() => {
        const g = window.__game, info = g.pipeline.renderer.info;
        window.__programs0 = info.programs.length;
        info.autoReset = false;
        const f = g.perf.frame.bind(g.perf);
        window.__stats = { calls: 0, triangles: 0 };
        window.__frames = 0;
        g.perf.frame = (a, b) => {
          window.__stats = { calls: info.render.calls, triangles: info.render.triangles };
          window.__frames++;
          info.reset();
          f(a, b);
        };
      });
    return { readyMs: Date.now() - t0 };
  },
  /** One finger down at (x, y) for `ms`, without moving. */
  async press(x = W / 2, y = H * 0.6, ms = 70) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    await h.sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  },
  /** A tap, anywhere on the play field. */
  tap: (x = W / 2, y = H * 0.62) => h.press(x, y, 70),
  /** A thumb down at (x, y), pulled to (x + dx, y + dy) over a moment, held, and lifted. dy > 0 is the yoke back: climb. dy < 0 is the nose down. */
  async drag(dx, dy, ms = 1500, x = W / 2, y = H * 0.68, { lift = true } = {}) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
      await h.sleep(16);
    }
    await h.sleep(ms);
    if (lift) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  },
  /** Thumb moves while it's down (after drag with lift: false). */
  async move(x, y) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  },
  async lift() {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  },
  /** A HUD control's middle, through a real touch: turbo, down, mega... */
  async hud(name, ms = 70) {
    const b = await page.locator(`[data-hud="${name}"]`).first().boundingBox();
    await h.press(b.x + b.width / 2, b.y + b.height / 2, ms);
    return b;
  },
  shot: (name) => page.screenshot({ path: `${out}/${name}.png` }),
  /** Waits this much game time. */
  async game(secs) {
    await page.evaluate((s) => new Promise((res) => {
      const g = window.__game, t0 = g.clock();
      const tick = () => (g.clock() - t0 >= s ? res(null) : requestAnimationFrame(tick));
      tick();
    }), secs);
  },
  state: async () => ({
    ...(await page.evaluate(() => {
      const g = window.__game, f = g.flight, p = g.moon?.paint, t = p?.target, r = (x, k = 1) => +(+x).toFixed(k);
      const s = g.controls.snapshot();
      return { t: r(g.clock(), 2), x: r(f.x, 0), z: r(f.z, 0), y: r(f.y, 0), h: r(f.y - g.city.groundAt(f.x, f.z), 1), hd: r((f.heading * 180) / Math.PI, 0), speed: r(f.speed), vy: r(f.vy), gear: s.turbo.gear, full: r(f.fullness, 2), mode: f.mode, target: t ? { id: t.id, r: r(t.r), level: t.rec?.level ?? 0, name: t.name, d: r(Math.hypot(t.x - f.x, t.z - f.z), 0) } : null, recs: p?.recs.size, coach: s.coach?.cue ?? null, ...window.__stats, frames: window.__frames, sign: g.lastSign?.()?.text ?? null };
    })),
    errors: errors.length,
  }),
  js: (fn, arg) => page.evaluate(fn, arg),
};

const Async = Object.getPrototypeOf(async function () {}).constructor;
createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    try {
      const r = await new Async('h', 'console', body)(h, console);
      res.end(JSON.stringify(r ?? null, null, 0) + '\n');
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e?.stack ?? e) + '\n');
    }
    if (body.includes('h.quit')) process.exit(0);
  });
}).listen(PORT, '127.0.0.1', () => console.log('hand on', PORT, 'frames in', out));
h.quit = async () => {
  await browser.close();
};
