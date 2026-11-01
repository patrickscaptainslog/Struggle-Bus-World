#!/usr/bin/env node
// Flag off against the build it must not differ from: node tools/sky/flag-compare.mjs <url a> <url b> [--s=12]
// One browser at a time, cold, the same phone. Each page runs the same seconds of the plain game while this reads every shader source handed to WebGL, byte for byte, and every request, with the hash taken
// out of asset names. It prints what differs. Pass: not one shader byte, and the same files asked for.
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const urls = args.filter((a) => !a.startsWith('--'));
const secs = Number(args.find((a) => a.startsWith('--s='))?.split('=')[1] ?? 12);
if (urls.length !== 2) throw new Error('two urls');

async function read(url) {
  const browser = await chromium.launch(browserOptions(['--enable-webgl']));
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    const reqs = new Map();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      const u = new URL(r.url());
      const name = u.pathname.replace(/-[A-Za-z0-9_-]{8}\.js$/, '.js') + u.search;
      reqs.set(name, (reqs.get(name) ?? 0) + 1);
    });
    await page.addInitScript(() => {
      const list = (window.__shaders = []);
      const P = WebGL2RenderingContext.prototype;
      const ss = P.shaderSource;
      P.shaderSource = function (s, src) {
        list.push(src);
        return ss.call(this, s, src);
      };
    });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__game?.pipeline, null, { timeout: 120000 });
    await page.waitForTimeout(secs * 1000);
    const shaders = await page.evaluate(() => window.__shaders);
    const programs = await page.evaluate(() => window.__game.pipeline.renderer.info.programs.length);
    return { shaders, reqs, programs, errors };
  } finally {
    await browser.close();
  }
}

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const a = await read(urls[0]);
const b = await read(urls[1]);
const count = (list) => {
  const m = new Map();
  for (const s of list) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
};
const sa = count(a.shaders), sb = count(b.shaders);
const onlyA = [...sa.keys()].filter((s) => !sb.has(s)), onlyB = [...sb.keys()].filter((s) => !sa.has(s));
const times = [...sa].filter(([s, n]) => sb.has(s) && sb.get(s) !== n).length;
console.log(`shaders: ${a.shaders.length} sources (${sa.size} distinct, ${a.shaders.join('').length} bytes) vs ${b.shaders.length} (${sb.size} distinct, ${b.shaders.join('').length} bytes)`);
console.log(`  only in the first ${onlyA.length}, only in the second ${onlyB.length}, used a different number of times ${times}, same order ${a.shaders.length === b.shaders.length && a.shaders.every((s, i) => s === b.shaders[i])}`);
// (the warm-up's compile order: which sources swapped places, if any)
const moved = a.shaders.map((x, i) => (x === b.shaders[i] ? -1 : i)).filter((i) => i >= 0);
if (moved.length) console.log(`  order differs at ${moved.length} places: ${moved.slice(0, 12).map((i) => `${i}: ${hash(a.shaders[i])} / ${hash(b.shaders[i] ?? '')}`).join(', ')}`);
const firstDiff = (x, y) => {
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return i;
};
onlyA.forEach((s, i) => {
  const y = onlyB[i] ?? '';
  const at = firstDiff(s, y);
  console.log(`  ${hash(s)} / ${hash(y)} differ at byte ${at}: ${JSON.stringify(s.slice(Math.max(0, at - 60), at + 80))}\n    against ${JSON.stringify(y.slice(Math.max(0, at - 60), at + 80))}`);
});
const ra = [...a.reqs.keys()].sort(), rb = [...b.reqs.keys()].sort();
const reqOnlyA = ra.filter((r) => !b.reqs.has(r)), reqOnlyB = rb.filter((r) => !a.reqs.has(r));
console.log(`requests: ${ra.length} files vs ${rb.length}`);
console.log(`  only in the first: ${JSON.stringify(reqOnlyA)}\n  only in the second: ${JSON.stringify(reqOnlyB)}`);
console.log(`programs ${a.programs} vs ${b.programs}, page errors ${a.errors.length} vs ${b.errors.length}`);
for (const e of [...a.errors, ...b.errors].slice(0, 5)) console.log('  ', e);
process.exit(onlyA.length || onlyB.length || times || reqOnlyA.length || reqOnlyB.length ? 1 : 0);
