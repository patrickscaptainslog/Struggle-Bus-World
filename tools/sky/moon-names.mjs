#!/usr/bin/env node
// What the orbit names: node tools/sky/moon-names.mjs <out dir> [--t=2026-11-25T04:00:00Z] [--secs=120] [--dt=0.05] [--turn=0] [--go=lat,lon] [--from=2200] [--q=]
// The route's own step down to --from km over the Moon, then the real frame loop at a fixed step, a frame shot of each sign a second after it goes up. --go steers there with a real thumb, the way a player would.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const dir = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', '2026-11-25T04:00:00Z'), secs = Number(opt('secs', 120)), dt = Number(opt('dt', 0.05)), extra = opt('q', ''), from = Number(opt('from', 2200));
const go = opt('go', '').split(',').filter(Boolean).map(Number);
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
try {
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`${BASE}?moonrun&t=${t}&fixeddt=${dt}${extra ? `&${extra}` : ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__game.moon.draw.ground?.ready !== false, null, { timeout: 30000 });
  await page.evaluate((from) => {
    const m = window.__game.moon;
    m.hold(true);
    m.skip(0.1);
    m.trip.tap();
    m.skip(0.1);
    m.trip.tap();
    for (let i = 0; i < 12000 && !(m.trip.leg === 'in' && m.trip.hMoon <= from); i++) m.skip(0.05);
    m.hold(false);
  }, from);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const read = () => page.evaluate(() => {
    const m = window.__game.moon, s = m.sky, O = s.moonO, R = Math.hypot(O[0], O[1], O[2]);
    return { clock: m.trip.t, leg: m.trip.leg, lat: Math.asin(O[2] / R) * 57.29578, lon: Math.atan2(O[1], O[0]) * 57.29578, h: R - 1737.4, n: m.names.log.length, head: m.trip.heading.slice(), o: [...O], last: m.names.log.at(-1) };
  });
  let s = await read();
  const t0 = s.clock;
  let seen = 0, down = false;
  while (s.clock - t0 < secs) {
    s = await read();
    if (s.n > seen) {
      seen = s.n;
      await page.waitForTimeout(((1 / dt) / 60) * 1000);
      const f = `${String(seen).padStart(2, '0')}-${s.last.name.replace(/[^A-Z0-9]+/g, '-')}`;
      await page.screenshot({ path: join(dir, `${f}.png`) });
      console.log(`${(s.clock - t0).toFixed(0).padStart(4)} s  ${s.last.name.padEnd(28)} ${Math.round(s.last.h)} km up, ${s.last.x}, ${s.last.y} on screen, over ${s.lat.toFixed(1)}, ${s.lon.toFixed(1)}`);
    }
    if (go.length && s.leg === 'orbit') {
      // the bearing to the place, from the heading, in the plane of the ground under the bus: steer at it
      const up = s.o.map((v) => v / Math.hypot(...s.o));
      const p = [Math.cos(go[0] / 57.29578) * Math.cos(go[1] / 57.29578), Math.cos(go[0] / 57.29578) * Math.sin(go[1] / 57.29578), Math.sin(go[0] / 57.29578)];
      const dt0 = await page.evaluate(() => {
        const m = window.__game.moon, f = m.model.moonFix, h = m.trip.heading;
        return [f[0] * h[0] + f[1] * h[1] + f[2] * h[2], f[3] * h[0] + f[4] * h[1] + f[5] * h[2], f[6] * h[0] + f[7] * h[1] + f[8] * h[2]];
      });
      const k = p[0] * up[0] + p[1] * up[1] + p[2] * up[2];
      const tan = p.map((v, i) => v - up[i] * k), right = [dt0[1] * up[2] - dt0[2] * up[1], dt0[2] * up[0] - dt0[0] * up[2], dt0[0] * up[1] - dt0[1] * up[0]];
      const a = Math.atan2(tan[0] * right[0] + tan[1] * right[1] + tan[2] * right[2], tan[0] * dt0[0] + tan[1] * dt0[1] + tan[2] * dt0[2]);
      const want = Math.max(-1, Math.min(1, a * 3));
      if (!down && Math.abs(a) > 0.03) {
        await touch('touchStart', 200, 560);
        down = true;
      }
      if (down) await touch('touchMove', 200 + want * 70, 560);
      if (down && Math.abs(a) <= 0.03) {
        await touch('touchEnd');
        down = false;
      }
    }
    await page.waitForTimeout(60);
  }
  writeFileSync(join(dir, 'names.json'), JSON.stringify(await page.evaluate(() => window.__game.moon.names.log), null, 0));
  console.log('signs', seen, 'at', s.lat.toFixed(1), s.lon.toFixed(1));
} finally {
  await browser.close();
}
