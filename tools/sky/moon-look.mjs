#!/usr/bin/env node
// The same paint under any build, to look at: node tools/sky/moon-look.mjs <out dir> [--t=now] [--strokes=file.json] [--seed=9] [--n=40] [--secs=0,20,40] [--q=]
// No flight and no touches: straight to orbit by the route's own step, a list of strokes laid down the way a player leaves them (some hit once, some three times), and frames along the orbit. --strokes takes a list
// another run wrote, and every run writes the one it used to strokes.json, so a change can be looked at against the frames before it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', 'now'), file = opt('strokes', ''), seed = Number(opt('seed', 9)), n = Number(opt('n', 40)), secs = opt('secs', '0,12,24').split(',').map(Number), extra = opt('q', '');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`${BASE}?moonrun${t === 'now' ? '' : `&t=${t}`}&fixeddt=0.0166${extra ? `&${extra}` : ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  await page.evaluate(() => {
    const m = window.__game.moon;
    m.trip.qaGo();
    m.skip(0.1);
    m.trip.qaGo();
    for (let i = 0; i < 6000 && m.trip.leg !== 'orbit'; i++) m.skip(0.1);
    m.skip(4);
  });
  await page.waitForTimeout(500);
  // a player's paint, ahead of the bus along its track: every stroke through the real strike() and begin(), so levels come out as they would
  const list = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const strokes = await page.evaluate(async ({ list, seed, n }) => {
    const b = window.__game.moon.breath, p = b.paint, m = window.__game.moon;
    let s = seed >>> 0;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const O = m.sky.moonO, R = Math.hypot(O[0], O[1], O[2]), lat0 = Math.asin(O[2] / R) * (180 / Math.PI), lon0 = Math.atan2(O[1], O[0]) * (180 / Math.PI);
    const draw = (st) => {
      const job = p.begin(st, false);
      p.work(job, Infinity);
    };
    if (list) for (const st of list) draw(st);
    else {
      for (let i = 0; i < n; i++) {
        const lat = lat0 + rnd() * 34 - 6, lon = lon0 + (rnd() - 0.5) * 22, hits = 1 + Math.floor(rnd() * 3.2);
        for (let k = 0; k < hits; k++) draw(p.strike(lat + rnd() * 0.5, lon + rnd() * 0.5));
      }
    }
    b.tex.needsUpdate = true;
    return p.strokes.map((q) => ({ ...q }));
  }, { list, seed, n });
  writeFileSync(join(out, 'strokes.json'), JSON.stringify(strokes));
  await page.waitForTimeout(400);
  let at = 0;
  for (const sec of secs) {
    await page.evaluate((s) => window.__game.moon.skip(s), sec - at);
    at = sec;
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(out, `s${String(sec).padStart(3, '0')}.png`) });
  }
  console.log(JSON.stringify(await page.evaluate(() => {
    const m = window.__game.moon, b = m.breath;
    return { strokes: b.paint.strokes.length, painted: +(b.paint.painted * 100).toFixed(2), leg: m.trip.leg, lit: +m.sky.moonLit.toFixed(3) };
  })));
} finally {
  await browser.close();
}
