#!/usr/bin/env node
// Frames of ?moonrun, in one browser, closed at the end (tools/browser.mjs: GPU Edge here): node tools/sky/moon-shots.mjs <out dir> <name=query> ...
// A frame is 393 x 852 game pixels, one PNG pixel each. BASE is the page (http://localhost:4179/). `--load` also prints each page's load report; `--net` lists its requests.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [out, ...specs] = args.filter((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
try {
  for (const spec of specs) {
    const i = spec.indexOf('=');
    const name = spec.slice(0, i), query = spec.slice(i + 1);
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text().slice(0, 600)}`);
    });
    if (flags.has('--net')) page.on('response', (r) => console.log(`  ${r.status()} ${r.url().replace(BASE, '/')}`));
    page.on('pageerror', (e) => {
      bad++;
      console.log('  [pageerror]', e.message);
    });
    await page.goto(`${BASE}?moonrun&${query}`, { waitUntil: 'load', timeout: 60000 });
    try {
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
    } catch {
      bad++;
      console.log('  [warn] never ready:', name);
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `${name}.png`) });
    const info = await page.evaluate(() => {
      const m = window.__game?.moon;
      if (!m) return null;
      const s = m.sky;
      const px = 1 / window.__game.pipeline.pixelWorldSize(1);
      return { earthKm: Math.round(s.earthKm), moonKm: Math.round(s.moonKm), earthPx: Math.round((2 * s.earthR * px * 10) / 1) / 10, moonPx: Math.round(2 * s.moonR * px * 10) / 10, moonLit: Math.round(s.moonLit * 1000) / 10, earthLit: Math.round(s.earthLit * 1000) / 10, load: m.load };
    });
    console.log(name, JSON.stringify(flags.has('--load') ? info : { ...info, load: undefined }));
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
