#!/usr/bin/env node
// The whole trip from the street and back to it, both changes of page in it (docs/specs/earth/EARTHFLIGHT.md, E2 and E3), at a fixed step: node tools/earth/trip.mjs <out dir>
//   up      ?earth: the street up and the flight behind it; Jet from 14.9 km, a full pull, and the flight has the bus at 15 km
//   button  two flicks up to Rainbow Warp and one more: straight up to 13,000 km, TO THE MOON?, and off
//   out     a few seconds into the long dark the page is ?moonland&resume, the trip carried on
//   moon    on to the orbit, and a push held there leaves it for the ground: the Earth page's trip came over able to land
//   home    off home, the long dark, ?earth&resume, over home, a dive, and under 14 km over the city the street has the bus
// The street's stick is __qa's; the flight is flown and skipped with its own calls between frames (as tools/earth/swap.mjs does). BASE is the page (http://localhost:4179/).
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'shots/tmp/earth-trip';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const T = process.env.T ?? '2026-11-25T04:00:00Z';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(76)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  // (a page changed to is held from its first frames, or it runs on before the tool looks)
  await ctx.addInitScript(() => {
    if (location.search.includes('resume')) window.__qa = { holdFrames: 6, held: false };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.goto(`${BASE}?earth&lat=37.7700&lon=-122.4300&heading=45&skipintro&t=${T}&fixeddt=0.033333`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__game && window.__game.city.loadedRegionCount() > 0, null, { timeout: 300000, polling: 500 });
  const frames = async (n, stick = { sx: 0, sy: 0 }, pin = null) => {
    await page.evaluate(([k, s, p]) => (window.__qa = { holdFrames: k, held: false, ...s, pin: p }), [n, stick, pin]);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 600000, polling: 50 });
  };
  const skipTo = (leg, then) =>
    page.evaluate(([l, then]) => {
      const m = window.__space.moon;
      for (let i = 0; i < 80000 && m.trip.leg !== l; i++) m.skip(0.05);
      if (m.trip.leg === l) m.skip(then);
      return m.trip.leg;
    }, [leg, then ?? 0]);
  const fly = (secs, yoke, until) =>
    page.evaluate(
      ([secs, yoke, until]) => {
        const m = window.__space.moon, stop = until ? new Function('t', `return ${until}`) : () => false;
        let i = 0;
        for (; i < secs * 30 && !stop(m.trip); i++) {
          m.trip.step(1 / 30, 0, yoke);
          m.view.update(1 / 30, m.trip, 0, 0, false, 0);
        }
        return i / 30;
      },
      [secs, yoke, until ?? ''],
    );
  const trip = () => page.evaluate(() => { const t = window.__space.moon.trip; return { leg: t.leg, egg: t.egg, rung: t.rung, km: +Math.min(t.hEarth, t.hMoon).toFixed(1), url: location.search.slice(0, 40) }; });
  /** In a long dark: on into the change of page, and the new page held as it comes up. */
  const change = async (to) => {
    await frames(1);
    await page.evaluate(() => window.__space.moon.skip(2.9));
    const nav = page.waitForURL((u) => u.search.includes(`${to}&resume`), { timeout: 180000 });
    await page.evaluate(() => (window.__qa = { holdFrames: 6, held: false }));
    await nav;
    await page.waitForFunction(() => window.__space?.moon?.trip && window.__qa?.held === true, null, { timeout: 600000, polling: 250 });
  };

  // ---- up
  for (let i = 0; i < 120 && !(await page.evaluate(() => window.__space?.moon?.trip?.leg === 'street')); i++) await frames(10);
  const at = await page.evaluate(() => ({ x: window.__game.flight.x, z: window.__game.flight.z, heading: window.__game.flight.heading }));
  await frames(2, { sx: 0, sy: 0 }, { ...at, y: 14800 });
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 3; i++) g.controls.turbo.shift(1, g.flight);
  });
  let u = await trip();
  for (let i = 0; i < 300 && u.leg === 'street'; i++) {
    await frames(5, { sx: 0, sy: -1 });
    u = await trip();
  }
  row('up: the street climbs out, and the flight has the bus at 15 km', u.leg === 'wait' && u.km >= 14.9, u);
  // ---- button
  await page.evaluate(() => {
    const t = window.__space.moon.trip;
    t.tap();
    t.step(1 / 30, 0, 0);
    t.tap();
    t.step(1 / 30, 0, 0);
    t.tap();
  });
  await skipTo('high', 0.5);
  await frames(4);
  const b = await trip();
  row('button: up to Rainbow Warp and straight up: 13,000 km, TO THE MOON? up', b.leg === 'high' && b.egg === 'moon' && b.km > 12900, b);
  await page.evaluate(() => window.__space.moon.trip.toMoon());
  // ---- out
  const lc = await skipTo('cruise');
  await change('moonland');
  const o = await trip();
  row('out: a few seconds into the long dark the page is the Moon\'s, the trip carried on', lc === 'cruise' && o.url.includes('moonland&resume') && o.leg === 'cruise', o);
  // ---- moon
  await skipTo('orbit', 1);
  await page.waitForFunction(() => !!window.__space.moon.landing?.world, null, { timeout: 600000, polling: 1000 });
  await frames(4);
  const left = await fly(1.5, 1, "t.leg === 'fall'");
  const f = await trip();
  row('moon: in orbit a push held leaves it for the ground (the trip came over able to land)', f.leg === 'fall', { ...f, pushS: left });
  await page.screenshot({ path: join(dir, 'moon-fall.png') });
  // ---- home
  await page.evaluate(() => window.__space.moon.trip.qaGo());
  const lh = await skipTo('homeCruise');
  await change('earth');
  const h = await trip();
  row('home: a few seconds into the long dark home the page is Earth\'s, the trip carried on', lh === 'homeCruise' && h.url.includes('earth&resume') && h.leg === 'homeCruise', h);
  await page.waitForFunction(() => !!window.__game?.flight, null, { timeout: 600000, polling: 1000 });
  await skipTo('wait', 0.5);
  // (a dive from 300 km comes down tens of km from where it started: at 20 km the bus is set back over home, as tools/earth/swap.mjs does)
  await fly(600, 1, 't.hGround < 20');
  await page.evaluate(() => {
    const t = window.__space.moon.trip, k = Math.hypot(...t.ef) / Math.hypot(...t.fx);
    for (let j = 0; j < 3; j++) t.ef[j] = t.fx[j] * k;
  });
  await fly(120, 1, 't.hGround < 14.3');
  let took = false;
  for (let i = 0; i < 30 && !took; i++) {
    await fly(1 / 30, 1);
    await frames(1);
    took = await page.evaluate(() => window.__space.moon.earthLanding.ground);
  }
  await frames(10);
  const s = await page.evaluate(() => ({ km: +(window.__game.flight.height / 1000).toFixed(2), leg: window.__space.moon.trip.leg }));
  await page.screenshot({ path: join(dir, 'home-street.png') });
  row('home: over home, a dive, and under 14 km over the city the street has the bus', took && s.leg === 'street' && s.km < 14.2 && s.km > 10, s);
} catch (e) {
  bad++;
  console.log('FAIL ', e.message);
} finally {
  row('no page errors', !errors.length, errors.slice(0, 5));
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
