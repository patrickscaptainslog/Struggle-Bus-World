#!/usr/bin/env node
// Allocation rate in steady flight (the no-per-frame-allocations rule, measured): V8's sampling heap profiler over a
// real-time street cruise, objects later collected included.
//   node tools/allocs.mjs <url> [--seconds=10] [--top=14]
import { chromium } from 'playwright-core';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [url = 'http://127.0.0.1:4173/'] = pos;
const seconds = Number(opt.seconds ?? 10);
const browser = await chromium.launch(browserOptions([]));
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
await page.goto(url + '?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud', { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
await page.waitForTimeout(3000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
await page.waitForTimeout(seconds * 1000);
const { profile } = await cdp.send('HeapProfiler.stopSampling');
await browser.close();
const sites = new Map();
let total = 0;
const walk = (n, path) => {
  const name = n.callFrame.functionName || '(anon)';
  const here = n.selfSize;
  total += here;
  if (here) {
    const k = `${name} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`;
    sites.set(k, (sites.get(k) ?? 0) + here);
  }
  for (const c of n.children) walk(c, path);
};
walk(profile.head, '');
console.log(`${(total / 1048576 / seconds).toFixed(2)} MB/s allocated over ${seconds} s`);
for (const [k, v] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, Number(opt.top ?? 14))) console.log(`  ${(v / 1024 / seconds).toFixed(0)} KB/s  ${k}`);
