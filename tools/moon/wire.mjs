#!/usr/bin/env node
// What ?moon asks for, file by file, and what that is on the wire: node tools/moon/wire.mjs [dist dir] [flag, moonland say]. BASE is the page (http://localhost:4179/). Compressed files as they stand; text by gzip -9, about what a CDN sends.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv[2] ?? 'C:/Users/Utku/sb-build-perf';
const base = process.env.BASE ?? 'http://localhost:4179/';
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const seen = new Set();
page.on('request', (r) => seen.add(new URL(r.url()).pathname));
await page.goto(`${base}?${process.argv[3] ?? 'moon'}`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await browser.close();
const rows = [];
for (const p of seen) {
  const f = join(dir, p === '/' ? 'index.html' : p);
  try {
    if (statSync(f).isDirectory()) continue;
  } catch {
    continue;
  }
  const raw = readFileSync(f), gz = raw[0] === 0x1f && raw[1] === 0x8b;
  rows.push([p, raw.length, gz ? raw.length : gzipSync(raw, { level: 9 }).length]);
}
rows.sort((a, b) => b[2] - a[2]);
for (const [p, r, w] of rows) console.log(p.padEnd(40), String(r).padStart(10), String(w).padStart(10));
const sum = (re) => rows.filter((x) => re.test(x[0])).reduce((a, x) => a + x[2], 0);
console.log('all', rows.reduce((a, x) => a + x[2], 0), 'moon data', sum(/^\/moon\//), 'sky data', sum(/^\/sky\//), 'code', sum(/\.js$/));
