#!/usr/bin/env node
// The other two flags still stand up: node tools/moon/smoke.mjs <out dir>. ?moonrun and ?moon each to a first ready frame, a shot, and what they cost: the ready time, programs, page errors. BASE is the page.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv[2];
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
try {
  for (const [name, q] of [['moonrun', '?moonrun&t=2026-11-25T04:00:00Z'], ['moon', '?moon'], ['moonland', '?moonland&t=2026-11-25T04:00:00Z']]) {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 160)));
    const t0 = Date.now();
    await page.goto(`${BASE}${q}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000 });
    const ms = Date.now() - t0;
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(dir, `${name}.png`) });
    const n = await page.evaluate(() => (window.__game ?? window.__space).pipeline.renderer.info.programs.length);
    console.log(`${name}: first ready frame ${ms} ms, ${n} programs, ${errors.length ? errors.join(' | ') : 'no errors'}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
