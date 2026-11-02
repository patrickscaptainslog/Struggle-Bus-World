#!/usr/bin/env node
// The painted Moon from a long way off: node tools/sky/moon-far.mjs <out dir> [--t=2026-11-25T04:00:00Z] [--strokes="lat,lon,level,seed;..."] [--views="name=query,..."]
// Puts the strokes in this device's store, as a flight would have, and opens one frame per view. Any view of ?moonrun's readView will do; the lens is the flight's, 24 degrees, unless a view says otherwise.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const out = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', '2026-11-25T04:00:00Z');
const strokes = opt('strokes', '0,0,3,12').split(';').flatMap((s) => s.split(',').map(Number));
const views = opt('views', 'km3000=view=moon&km=3000&lens=38|km13000=view=moon&km=13000&lens=24|km100000=view=mid&f=0.74&look=moon&lens=24|km384000=view=mid&f=0.02&look=moon&lens=24').split('|');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.addInitScript((a) => {
    try {
      for (let k = 0; k * 256 < a.length; k++) localStorage.setItem(`strugglebus.moon.v1.${k}`, JSON.stringify(a.slice(k * 256, (k + 1) * 256)));
    } catch {}
  }, strokes);
  for (const spec of views) {
    const i = spec.indexOf('='), name = spec.slice(0, i), q = spec.slice(i + 1);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('  [pageerror]', e.message));
    await p.goto(`${BASE}?moonrun&t=${t}&${q}`, { waitUntil: 'load', timeout: 60000 });
    await p.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
    await p.waitForTimeout(250);
    await p.screenshot({ path: join(out, `${name}.png`) });
    console.log(name, await p.evaluate(() => {
      const m = window.__game.moon, s = m.sky, f = 1 / window.__game.pipeline.pixelWorldSize(1);
      return JSON.stringify({ km: Math.round(s.moonKm), px: Math.round(2 * Math.tan(s.moonR) * f), lit: +s.moonLit.toFixed(3), strokes: m.breath.paint.strokes.length, painted: +(m.breath.paint.painted * 100).toFixed(2), load: m.load.readyMs });
    }));
    await p.close();
  }
} finally {
  await browser.close();
}
