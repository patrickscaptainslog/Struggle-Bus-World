#!/usr/bin/env node
// Any place on the Moon, from the ground map's side: node tools/sky/moon-spots.mjs <out dir> [--t=...] [--q=] name=lat,lon,km[,heading,pitch] ...
// A still frame over each, with the ground landed. For what no flight goes to on purpose: a cube's seam, a corner, a pole, a far side.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const pos = args.filter((a) => !a.startsWith('--'));
const dir = pos.shift();
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', '2026-11-25T04:00:00Z'), extra = opt('q', '');
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
try {
  for (const s of pos) {
    const [name, v] = s.split('=');
    const [lat, lon, km, heading = 0, pitch] = v.split(',');
    const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
    await page.goto(`${BASE}?moonrun&t=${t}&view=moon&lat=${lat}&lon=${lon}&km=${km}&heading=${heading}${pitch ? `&pitch=${pitch}` : ''}&bus=0${extra ? `&${extra}` : ''}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
    await page.waitForFunction(() => window.__game.moon.draw.ground?.ready !== false, null, { timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(dir, `${name}.png`) });
    await page.close();
    console.log(name);
  }
} finally {
  await browser.close();
}
