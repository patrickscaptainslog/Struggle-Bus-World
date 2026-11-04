#!/usr/bin/env node
// Is the plain Earth still under a steady bus? (docs/specs/earth/EARTHFLIGHT.md, E1): node tools/earth/still.mjs <out dir>
//   Over San Francisco in the flight (?moonland), in Jet level at 15 km and then at Jet's 150 m floor, the view settled: three frames in a row each (high-*.png, low-*.png), and how much each changes from the one before.
//   A frame of steady flight moves the ground a pixel or less, so a picture that changes more than a street frame does (7 to 8 % of pixels by more than 24, tools/earth/climb.mjs's) is the ground shimmering.
// The trip is flown with its own calls between drawn frames (window.__qa.holdFrames), the view stepped with it. BASE is the page (http://localhost:4179/).
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'shots/tmp/earth-still';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const T = process.env.T ?? '2026-11-04T21:00:00Z';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => (window.__qa = { holdFrames: 4, held: false }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.goto(`${BASE}?moonland&t=${T}&fixeddt=0.033333`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true && window.__qa?.held === true, null, { timeout: 300000, polling: 500 });
  const frames = async (n) => {
    await page.evaluate((k) => (window.__qa = { holdFrames: k, held: false }), n);
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 600000, polling: 50 });
  };
  const fly = (s, stick, yoke, until) =>
    page.evaluate(
      ([s, stick, yoke, until]) => {
        const m = window.__space.moon, stop = until ? new Function('t', `return ${until}`) : () => false;
        let i = 0;
        for (; i < s * 30 && !stop(m.trip); i++) {
          m.trip.step(1 / 30, stick, yoke);
          m.view.update(1 / 30, m.trip, 0, 0, false, 0);
        }
        return i / 30;
      },
      [s, stick, yoke, until ?? ''],
    );
  const gear = (g) =>
    page.evaluate((g) => {
      const t = window.__space.moon.trip;
      // (over Earth turbo's levels are steps over Jet: a gear here is one with none on)
      for (let i = 0; i < 12 && (t.rung !== g || t.level); i++) {
        if (t.rung > g || (t.rung === g && t.level)) t.shiftDown();
        else t.tap();
        t.step(1 / 30, 0, 0);
      }
      return t.rung;
    }, g);
  /** three frames in a row, and the share of pixels each changes by more than 24 (the three channels' sum, as tools/moon/slide-diff.py counts) */
  const three = async (name) => {
    await frames(8);
    const got = [];
    for (let i = 0; i < 3; i++) {
      if (i) await frames(1);
      const png = await page.screenshot({ path: join(dir, `${name}-${i}.png`) });
      got.push(await page.evaluate(async (url) => {
        const im = new Image();
        im.src = url;
        await im.decode();
        const x = Object.assign(document.createElement('canvas'), { width: im.width, height: im.height }).getContext('2d');
        x.drawImage(im, 0, 0);
        return Array.from(x.getImageData(0, 0, im.width, im.height).data);
      }, `data:image/png;base64,${png.toString('base64')}`));
    }
    const share = [];
    for (let i = 1; i < 3; i++) {
      const a = got[i - 1], b = got[i];
      let n = 0;
      for (let k = 0; k < a.length; k += 4) n += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]) > 24;
      share.push(+((100 * n) / (a.length / 4)).toFixed(2));
    }
    return share;
  };
  const read = () => page.evaluate(() => { const t = window.__space.moon.trip; return { leg: t.leg, rung: t.rung, m: Math.round(t.hGround * 1000), nose: +t.nose.toFixed(3) }; });

  await frames(30);
  await fly(120, 0, 1, 't.hGround < 30');
  await gear(3);
  await fly(120, 0, 1, 't.hGround < 15.2');
  await fly(20, 0, 0);
  const hi = await read(), hs = await three('high');
  row('high: level in Jet at 15 km, three frames in a row change little', hi.rung === 3 && Math.abs(hi.m - 15000) < 1500 && Math.max(...hs) < 10, { ...hi, changedPct: hs });
  await fly(120, 0, 1, 't.hGround < 0.16');
  await fly(10, 0, 0);
  const lo = await read(), ls = await three('low');
  row("low: level at Jet's 150 m floor, three frames in a row", lo.rung === 3 && lo.m < 300 && Math.max(...ls) < 25, { ...lo, changedPct: ls });
  row('no page errors', errors.length === 0, errors.slice(0, 5));
} finally {
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
