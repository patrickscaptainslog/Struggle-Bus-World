#!/usr/bin/env node
// A shot as it plays, frame by frame, not frozen: node tools/sky/moon-film.mjs <out dir> [--t=now] [--secs=3.2] [--dt=0.0166] [--every=2]
// Real frame loop, a real touch, and the page's own screencast from just before the tap. One on bare ground, one on that paint, one on that again. It writes the frames as they came, and the time of each from the tap.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', 'now'), secs = Number(opt('secs', 3.2)), every = Number(opt('every', 2));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`${BASE}?moonrun${t === 'now' ? '' : `&t=${t}`}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  await page.evaluate(() => {
    const m = window.__game.moon;
    m.trip.qaGo();
    m.skip(0.1);
    m.trip.qaGo();
    for (let i = 0; i < 6000 && m.trip.leg !== 'orbit'; i++) m.skip(0.1);
    m.skip(4);
  });
  await page.waitForTimeout(800);
  const cdp = await ctx.newCDPSession(page);
  const film = async (name, x, y) => {
    const frames = [];
    let t0 = 0;
    const on = async ({ data, sessionId, metadata }) => {
      frames.push({ data, at: metadata.timestamp });
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    };
    cdp.on('Page.screencastFrame', on);
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: every });
    await page.waitForTimeout(150);
    t0 = Date.now() / 1000;
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(secs * 1000);
    await cdp.send('Page.stopScreencast');
    cdp.off('Page.screencastFrame', on);
    const list = frames.map((f, i) => {
      const file = `${name}-${String(i).padStart(3, '0')}.png`;
      writeFileSync(join(out, file), Buffer.from(f.data, 'base64'));
      return `${file} ${(f.at - t0).toFixed(3)}`;
    });
    writeFileSync(join(out, `${name}.txt`), list.join('\n'));
    console.log(name, frames.length, 'frames', (frames.length / secs).toFixed(0), 'a second');
  };
  const last = () => page.evaluate(() => {
    const b = window.__game.moon.breath, s = b.paint.strokes.at(-1);
    return b.screenOf(s.lat, s.lon);
  });
  const loaded = () => page.waitForFunction(() => window.__game.moon.breath.loaded, null, { timeout: 20000, polling: 30 });
  await film('a', 196, 400);
  await loaded();
  let p = await last();
  await film('b', p.x, p.y);
  await loaded();
  p = await last();
  await film('c', p.x, p.y);
} finally {
  await browser.close();
}
