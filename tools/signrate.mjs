#!/usr/bin/env node
// How often does a real tap raise a street sign? N real taps along a flight, fixed clock, one city and place at a time. A sign is
// what tells the player where they are, and its placement can fail where its name doesn't: London's first taps found every name
// and no spot a 10 m pole could clear (DECISIONS "OpenStreetMap, outside judge round 1"). --tall=0 is the placement before poleLiftTall.
//   node tools/signrate.mjs <url> <outDir> <tag> <city|sf> <lat> <lon> <heading> [--taps=8] [--lift=m] [--tall=m] [--alt=m] [--name=x] [--shots]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const argv = process.argv.slice(2);
const pos = argv.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || '1']; }));
const [base, out, tag, slug, lat, lon, heading] = pos;
const nTaps = +(opt.taps ?? 8);
mkdirSync(out, { recursive: true });
const VIEW = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true };
const browser = await chromium.launch(browserOptions([]));
const ctx = await browser.newContext(VIEW);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const runFor = (s) => ev((sec) => new Promise((res) => { const g = window.__game; const t0 = g.clock(); const tick = () => (g.clock() - t0 >= sec ? res(null) : requestAnimationFrame(tick)); tick(); }), s);
const until = (cond, maxS) => ev(([c, m]) => new Promise((res) => { const g = window.__game; const f = new Function('g', 'return (' + c + ')'); const t0 = g.clock(); const tick = () => (g.clock() - t0 >= m || f(g) ? res(+(g.clock() - t0).toFixed(2)) : requestAnimationFrame(tick)); tick(); }), [cond, maxS]);
const city = slug === 'sf' ? '' : `city=${slug}&`;
await page.goto(base + `?${city}lat=${lat}&lon=${lon}&heading=${heading}&skipintro&nohud&fixeddt=0.0333&controls=touch`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
await ev(() => { window.__qa = null; window.__game.flight.glideSpeed = 8; });
if (opt.lift) await ev((v) => window.__game.tuneGroup('Signs', 'poleLiftMax', v), +opt.lift);
if (opt.tall !== undefined) await ev((v) => window.__game.tuneGroup('Signs', 'poleLiftTall', v), +opt.tall);
await runFor(1);
await until('!g.city.busy', 40);
if (+opt.alt) {
  await ev(() => (window.__qa = { sx: 0, sy: -1 }));
  await until(`g.flight.y + Math.max(0, g.flight.vy) / 1.7 >= ${+opt.alt} || g.flight.strain > 0.85`, 90);
  await ev(() => (window.__qa = null));
  await runFor(2);
  await until('!g.city.busy', 30);
}
const rows = [];
let lastT = -1;
for (let i = 1; i <= nTaps; i++) {
  await ev(() => window.__game.forceReady());
  await runFor(0.15);
  const before = await ev(() => window.__game.lastShot());
  await page.touchscreen.tap(196, 560);
  await runFor(0.12);
  const s = await ev(() => window.__game.lastShot());
  const fired = s && (!before || s.t !== before.t);
  await runFor(3.4);
  const r = await ev(() => { const g = window.__game; const l = g.lastSign(); const f = g.flight; return { sign: l, at: [Math.round(f.x), Math.round(f.y), Math.round(f.z)], cam: g.camera.position.toArray().map(Math.round) }; });
  const fresh = r.sign && r.sign.t !== lastT;
  if (r.sign) lastT = r.sign.t;
  rows.push({ i, fired: !!fired, target: s?.target ? { index: s.target.index, roofY: +s.target.roofY.toFixed(1) } : null, wall: s?.wall ?? null, sign: fresh ? r.sign.text : null, from: fresh ? r.sign.from : null, at: r.at });
  console.log(`[${tag}:${slug}] tap ${i}`, fired ? '' : 'NOT FIRED', JSON.stringify(rows[i - 1]));
  if (opt.shots) await page.screenshot({ path: `${out}/${tag}-${slug}-tap${i}.png` });
  await runFor(1.2);
}
const firedN = rows.filter((r) => r.fired).length, signN = rows.filter((r) => r.sign).length;
console.log(`[${tag}:${slug}] fired ${firedN} of ${nTaps}, signs ${signN}; errors ${errors.length}`);
writeFileSync(`${out}/${tag}-${slug}${opt.lift ? '-lift' + opt.lift : ''}${opt.tall !== undefined ? '-tall' + opt.tall : ''}${opt.name ? '-' + opt.name : ''}.json`, JSON.stringify({ rows, firedN, signN, errors }, null, 1));
await browser.close();
