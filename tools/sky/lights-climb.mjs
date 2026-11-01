#!/usr/bin/env node
// The city lights through a climb, frame by frame: node tools/sky/lights-climb.mjs <out dir> [--t=2026-11-25T04:00:00Z] [--from=0] [--to=30] [--step=0.2]. Launches with TURBO's real tap, jumps along by __game.moon.skip,
// and shoots a frame at each step, with no bus, no speed lines or trail, no HUD. tools/sky/lights-climb.py reads the frames: how many lamp pixels, and how many stayed lit from one frame to the next.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', '2026-11-25T04:00:00Z'), from = Number(opt('from', 0)), to = Number(opt('to', 30)), step = Number(opt('step', 0.2));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
try {
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`${BASE}?moonrun&t=${t}&fixeddt=0.0001&bus=0&lens=38`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  await page.addStyleTag({ content: '[data-hud] { visibility: hidden !important; }' });
  const turbo = await page.evaluate(() => {
    const m = window.__game.moon;
    m.trip.tap();
    m.skip(0.1);
    window.__game.scene.traverse((o) => {
      if (o.material?.uniforms?.uTrail || o.material?.uniforms?.uLine) o.layers.set(31);
    });
    return true;
  });
  if (!turbo) throw new Error('no launch');
  const log = [];
  const near = (a) => page.evaluate((s) => window.__game.moon.skip(s), a);
  await near(from);
  for (let c = from, i = 0; c <= to; c += step, i++) {
    await near(step);
    await page.waitForTimeout(60);
    await page.screenshot({ path: join(out, `f${String(i).padStart(4, '0')}.png`) });
    log.push(await page.evaluate(() => {
      const tr = window.__game.moon.trip;
      return { clock: +tr.clock.toFixed(2), h: Math.round(tr.hEarth) };
    }));
  }
  writeFileSync(join(out, 'log.json'), JSON.stringify(log));
  console.log(log.length, 'frames, last', JSON.stringify(log.at(-1)));
} finally {
  await browser.close();
}
