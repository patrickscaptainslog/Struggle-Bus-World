#!/usr/bin/env node
// The launch from the street, a frame at a time on a fixed step (docs/specs/moon/VOYAGE.md; src/sky/Launch.ts): node tools/moon/launch.mjs <out dir>
//   up     over San Francisco, put 100 m under the ceiling, a full pull climbs to the top of the sky and strains there, and the dark comes down from the top of the screen
//   back   let go part way and it goes again: no page change
//   out    pull again and the dark has the screen, and the page is ?moonland's: climbing over the same place, the way the bus was flying, out of the dark, until TO THE MOON? is up
// The stick is __qa's (sy -1 is a full pull), and the loop is stepped (window.__qa.holdFrames). BASE is the page (http://localhost:4179/).
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'shots/tmp/launch';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(dir, { recursive: true });
const W = 393, H = 852, DT = 1 / 30, HEADING = 45;
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  // (the trip's page stands from its first frames, so what it does from the start is seen: the street's page is stepped by hand from the start too)
  await ctx.addInitScript(() => {
    if (location.search.includes('moonland')) window.__qa = { holdFrames: 4, held: false };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.goto(`${BASE}?lat=37.7700&lon=-122.4300&heading=${HEADING}&skipintro&fixeddt=${DT.toFixed(6)}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__game && window.__game.city.loadedRegionCount() > 0, null, { timeout: 300000, polling: 500 });
  /** n frames on, with the stick as it's set, and the pose pinned if it's asked */
  const frames = async (n, stick = { sx: 0, sy: 0 }, pin = null) => {
    await page.evaluate(([k, s, p]) => (window.__qa = { holdFrames: k, held: false, ...s, pin: p }), [n, stick, pin]);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 600000, polling: 50 });
  };
  const read = () =>
    page.evaluate(() => {
      const g = window.__game, el = document.querySelector('[data-hud="launch"]');
      return { y: Math.round(g.flight.y), strain: +g.flight.strain.toFixed(2), charge: +g.launch.charge.toFixed(2), shown: el?.style.display === 'block', url: location.search.slice(0, 40) };
    });
  await frames(20);
  const at = await page.evaluate(() => ({ x: window.__game.flight.x, z: window.__game.flight.z, heading: window.__game.flight.heading }));
  // ---- up: 100 m under the ceiling, and a full pull
  await frames(2, { sx: 0, sy: 0 }, { ...at, y: 14900 });
  const pull = { sx: 0, sy: -1 };
  let s = await read(), top = null, n = 0;
  for (; n < 900 && s.charge < 0.55; n += 15) {
    await frames(15, pull);
    s = await read();
    if (!top && s.strain > 0.3) top = { ...s, frame: n };
    if (s.charge >= 0.3 && !(await page.evaluate(() => window.__shot30))) {
      await page.evaluate(() => (window.__shot30 = true));
      await page.screenshot({ path: join(dir, 'up-30.png') });
    }
  }
  row('up: a full pull climbs to the top of the sky and strains there', !!top && top.y > 14850, top);
  row('up: straining there, the dark comes down', s.charge >= 0.55 && s.shown, s);
  await page.screenshot({ path: join(dir, 'up-55.png') });
  // ---- back: let go, and it goes
  await frames(60);
  const back = await read();
  row('back: let go and the dark goes again, on the same page', back.charge === 0 && !back.shown && back.url.startsWith('?lat='), back);
  await page.screenshot({ path: join(dir, 'back.png') });
  // ---- out: pull again, all the way
  const left = page.waitForURL(/moonland/, { timeout: 600000 });
  let last = null;
  for (n = 0; n < 600 && !page.url().includes('moonland'); n += 10) {
    last = await read().catch(() => last);
    if (last?.charge >= 0.9 && !(await page.evaluate(() => window.__shot90).catch(() => true))) {
      await page.evaluate(() => (window.__shot90 = true));
      await page.screenshot({ path: join(dir, 'out-90.png') });
    }
    await frames(10, pull).catch(() => {});
  }
  await left;
  const q = new URL(page.url()).searchParams;
  const home = (q.get('home') ?? '').split(',').map(Number);
  row('out: the dark has the screen and the page is the trip, from here', q.has('moonland') && Math.abs(Number(q.get('launch')) - HEADING) < 3 && Math.abs(home[0] - 37.77) < 0.05 && Math.abs(home[1] + 122.43) < 0.05 && q.has('fixeddt'), { last, url: page.url().replace(BASE, '') });
  await page.waitForFunction(() => window.__shotReady === true && window.__qa?.held === true, null, { timeout: 300000, polling: 500 });
  const space = () =>
    page.evaluate(() => {
      const m = window.__space.moon, t = m.trip, f = t.now.earthFix, u = t.hc, h = t.heading;
      // (the heading on the compass over home)
      const p = [f[6], f[7], f[8]], e = [p[1] * u[2] - p[2] * u[1], p[2] * u[0] - p[0] * u[2], p[0] * u[1] - p[1] * u[0]], el = Math.hypot(...e);
      for (let i = 0; i < 3; i++) e[i] /= el;
      const nn = [u[1] * e[2] - u[2] * e[1], u[2] * e[0] - u[0] * e[2], u[0] * e[1] - u[1] * e[0]];
      const deg = (Math.atan2(h[0] * e[0] + h[1] * e[1] + h[2] * e[2], h[0] * nn[0] + h[1] * nn[1] + h[2] * nn[2]) * 180) / Math.PI;
      const dark = [...document.querySelectorAll('body > div')].find((d) => d.style.zIndex === '40' && d.style.background.includes('0, 0, 0'));
      return { leg: t.leg, gear: t.gear, km: Math.round(t.hEarth), v: +t.v.toFixed(1), compass: +(((deg % 360) + 360) % 360).toFixed(1), egg: t.egg, dark: dark ? dark.style.opacity : 'gone', say: document.querySelector('[data-hud="trip-label"]')?.dataset.say?.split('|')[0] ?? '' };
    });
  const a = await space();
  row('out: up there it climbs over home, the way the bus was flying', a.leg === 'rise' && a.gear === 4 && a.km >= 299 && a.km < 1000 && Math.abs(a.compass - HEADING) < 3, a);
  await page.screenshot({ path: join(dir, 'space-0.png') });
  const sframes = async (k) => {
    await page.evaluate((c) => (window.__qa = { holdFrames: c, held: false }), k);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 600000, polling: 50 });
  };
  await sframes(60);
  const b = await space();
  row('out: out of the dark, climbing', b.leg === 'rise' && b.km > a.km && b.dark !== '1', b);
  await page.screenshot({ path: join(dir, 'space-60.png') });
  await page.evaluate(() => {
    const m = window.__space.moon;
    for (let i = 0; i < 4000 && m.trip.leg !== 'high'; i++) m.skip(0.05);
  });
  await sframes(20);
  const c = await space();
  const up = await page.evaluate(() => document.querySelector('[data-hud="to-moon"]')?.dataset.up);
  row('out: extremely high, TO THE MOON? is up', c.leg === 'high' && c.egg === 'moon' && up === '1', { ...c, up });
  await page.screenshot({ path: join(dir, 'space-egg.png') });
  row('no page errors', errors.length === 0, errors.slice(0, 5));
} finally {
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
