#!/usr/bin/env node
// Renderer cost of one view, sampled after streaming settles (SwiftShader fps
// is meaningless; draw calls, triangles and CPU work per frame are not).
//   node tools/perf-view.mjs <baseUrl> "<query>" [--samples=10] [--label=name]
// e.g. node tools/perf-view.mjs http://127.0.0.1:4302/ "?lat=37.7925&lon=-122.4010&heading=0&skipintro"
// Prints one JSON line: median/min CPU workMs, median calls and triangles.
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base, query] = pos;
const samples = Number(opt.samples ?? 10);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base + query, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
await page.evaluate(() => (window.__qa = { sx: 0, sy: -1 })); // hover: the view barely moves
const frames = (n) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        let k = 0;
        const tick = () => (++k >= n ? res(null) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
for (let i = 0; i < 3; i++) {
  await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 300000 });
  await frames(4);
}
await page.waitForFunction(() => !!window.__stats, null, { timeout: 60000 });
const rows = [];
for (let i = 0; i < samples; i++) {
  await frames(2);
  const s = await page.evaluate(() => window.__stats);
  if (s) rows.push(s);
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = {
  label: opt.label ?? query,
  workMsMedian: med(rows.map((r) => r.workMs)),
  workMsMin: Math.min(...rows.map((r) => r.workMs)),
  calls: med(rows.map((r) => r.calls)),
  triangles: med(rows.map((r) => r.triangles)),
  samples,
};
console.log(JSON.stringify(out));
await browser.close();
