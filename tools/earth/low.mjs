#!/usr/bin/env node
// Low over the plain Earth in the flight (docs/specs/earth/EARTHFLIGHT.md, E1), at a fixed step: node tools/earth/low.mjs <out dir>
//   orbit   300 km over San Francisco, as the trip starts: the Earth as it was
//   down    a held push from there to Rainbow Warp's 10 km floor, then Jet's 150 m, the frames on the way (30 km, 10 km, 150 m)
//   low     at Jet low over the land: two frames half a second apart, low-jet-a and -b, for the ground's breakup moving under the bus
//   sea     turned west out over the Pacific, low over the sea
// The trip is flown with its own calls between drawn frames (window.__qa.holdFrames), the view stepped with it. BASE is the page (http://localhost:4179/).
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'shots/tmp/earth-low';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
// (midday in San Francisco)
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
  /** s of flight with the stick and yoke as given, by the trip's own step and the view's, until `until` says stop */
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
  const read = () =>
    page.evaluate(() => {
      const t = window.__space.moon.trip, ef = t.ef;
      return { leg: t.leg, rung: t.rung, m: Math.round(t.hGround * 1000), kms: +t.v.toFixed(3), lat: +((Math.asin(ef[2] / Math.hypot(...ef)) * 180) / Math.PI).toFixed(2), lon: +((Math.atan2(ef[1], ef[0]) * 180) / Math.PI).toFixed(2), say: document.querySelector('[data-hud="trip-label"]')?.dataset.say?.split('|').slice(0, 2).join(' / ') ?? '' };
    });
  const shot = async (name) => {
    await frames(8);
    await page.screenshot({ path: join(dir, `${name}.png`) });
  };
  const gear = (g) =>
    page.evaluate((g) => {
      const t = window.__space.moon.trip;
      for (let i = 0; i < 8 && t.rung !== g; i++) {
        if (t.rung > g) t.shiftDown();
        else t.tap();
        t.step(1 / 30, 0, 0);
      }
      return t.rung;
    }, g);

  await frames(30);
  const o = await read();
  row('orbit: the trip starts free over San Francisco, 300 km up', o.leg === 'wait' && Math.abs(o.m - 300000) < 2000 && Math.abs(o.lat - 37.77) < 1, o);
  await shot('orbit');
  // (east, inland: the trip sets off toward the Moon's bearing, which from here at this hour is out to sea)
  await page.evaluate(() => {
    const t = window.__space.moon.trip;
    const u = t.ef.map((x) => x / Math.hypot(...t.ef)), e = [-u[1], u[0], 0], l = Math.hypot(...e);
    for (let i = 0; i < 20000; i++) {
      const h = t.eh, w = (h[0] * e[0] + h[1] * e[1]) / l;
      if (w > 0.999) break;
      t.step(1 / 30, w > 0.95 ? 0.05 : 0.5, 0);
    }
  });
  // ---- down
  await fly(120, 0, 1, 't.hGround < 30');
  await shot('down-30km');
  const d30 = await read();
  await fly(120, 0, 1, 't.hGround < 10.2');
  await fly(3, 0, 0);
  const d10 = await read();
  row("down: a held push from orbit levels at Rainbow Warp's 10 km floor", d10.m > 9500 && d10.m < 10600 && d10.rung === 5, { d30, d10 });
  await shot('down-10km');
  await gear(3);
  await fly(120, 0, 1, 't.hGround < 0.16');
  await fly(4, 0, 0);
  await frames(8);
  const j = await read();
  row("down: in Jet over the land, its 150 m floor, the label in metres", j.m >= 145 && j.m < 200 && j.rung === 3 && j.lon > -122.4 && /JET/.test(j.say) && / M$/.test(j.say), j);
  await shot('low-jet-a');
  // ---- low: the ground moves under the bus
  await fly(0.5, 0, 0);
  await frames(8);
  await page.screenshot({ path: join(dir, 'low-jet-b.png') });
  // (low-jet-a.png and low-jet-b.png, half a second apart: how much of the ground moved is for the frames to say, compared outside this tool)
  // ---- sea: west over the Pacific
  const west = await page.evaluate(() => {
    const t = window.__space.moon.trip;
    const u = t.ef.map((x) => x / Math.hypot(...t.ef)), e = [-u[1], u[0], 0], l = Math.hypot(...e);
    for (let i = 0; i < 20000; i++) {
      const h = t.eh, w = -(h[0] * e[0] + h[1] * e[1]) / l;
      if (w > 0.999) break;
      t.step(1 / 30, w > 0.95 ? 0.05 : 0.5, 0);
    }
    return true;
  });
  await gear(5);
  await fly(30, 0, 0);
  await gear(3);
  await fly(120, 0, 1, 't.hGround < 0.16');
  await fly(3, 0, 0);
  const sea = await read();
  row('sea: west over the Pacific, low over the sea', west && sea.lon < -122.6 && sea.m < 300, sea);
  await shot('sea-low');
  row('no page errors', errors.length === 0, errors.slice(0, 5));
} finally {
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
