#!/usr/bin/env node
// The street to the flight and back, on one page (?earth; docs/specs/earth/EARTHFLIGHT.md, E2), at a fixed step: node tools/earth/climb.mjs <out dir>
//   boot    the street comes up, and the flight behind it, with the street keeping the bus; the space sky's rows in from then, none black
//   up      in Turbo 3 from 7 km a full pull: the sky turns space's from 8 km, the city goes into the plain Earth from 11 km, and at 15 km the flight has the bus, frames either side of it (handover-*.png);
//           the street's rows (the bus's) the same either side
//   on      the flight flies on, free over Earth, climbing
//   down    a held push back down over the city: under 14 km the street has the bus again, Turbo 3 both ways
// The street's stick is __qa's (sy -1 a full pull); the flight is flown with its own calls between frames. BASE is the page (http://localhost:4179/). Frames: compare handover-*.png with tools/sky/sheet.py or by eye.
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'shots/tmp/earth-climb';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const T = process.env.T ?? '2026-11-04T21:00:00Z';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl', '--autoplay-policy=no-user-gesture-required']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.goto(`${BASE}?earth&lat=37.7700&lon=-122.4300&heading=45&skipintro&t=${T}&fixeddt=0.033333`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__game && window.__game.city.loadedRegionCount() > 0, null, { timeout: 300000, polling: 500 });
  const frames = async (n, stick = { sx: 0, sy: 0 }, pin = null) => {
    await page.evaluate(([k, s, p]) => (window.__qa = { holdFrames: k, held: false, ...s, pin: p }), [n, stick, pin]);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 600000, polling: 50 });
  };
  // ---- boot: the flight comes up behind the street
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await frames(10);
    up = await page.evaluate(() => window.__space?.moon?.trip?.leg === 'street');
  }
  const b = await page.evaluate(() => ({ leg: window.__space?.moon?.trip?.leg, hud: getComputedStyle(document.querySelector('[data-hud="trip-label"]') ?? document.body).display }));
  // (the street's sound, as a first touch wakes it: what quiets its wind in the flight is read off its graph)
  await page.evaluate(() => window.__game.audio.unlock());
  // (where it was sent, and what it is once the audio clock is 3.4 time constants past that going down, or about 0.6 s going up: the frames here are fixed-step, the audio clock real time.
  // The third review: read part way, the rows failed five readings in six on a laptop)
  const wind = () => page.evaluate(async () => {
    const g = window.__game.audio.graph;
    if (!g) return null;
    const wait = g.ambTo ? 0.6 : 0.85, t0 = performance.now();
    while (g.ctx.currentTime < g.ambAt + wait && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    return { to: g.ambTo, duck: +g.ambDuck.gain.value.toFixed(3), past: +(g.ctx.currentTime - g.ambAt).toFixed(2) };
  });
  row('boot: the street is up, and the flight behind it with the street keeping the bus', up && b.hud === 'none', b);
  // (review four, 5 and 7: the space sky's own rows, 50-55, written as the flight boots behind the street, so the climb's space sky and plain Earth are never black;
  // and the street's rows, the bus's yellow among them, the same either side of the hand-up)
  const rows = (list) => page.evaluate((list) => { const d = window.__game.pipeline.paletteTexture.image.data; return list.map((r) => Array.from(d.slice(r * 32, r * 32 + 32)).join(',')); }, list);
  const space = await rows([50, 51, 52, 53, 54, 55]);
  row('boot: the space sky has its rows from the flight\'s boot, none of them black', space.every((r) => r.split(',').some((v, i) => i % 4 !== 3 && Number(v) > 0)), { blackRows: space.filter((r) => !r.split(',').some((v, i) => i % 4 !== 3 && Number(v) > 0)).length });
  const read = () =>
    page.evaluate(() => {
      const g = window.__game, t = window.__space.moon.trip;
      return { leg: t.leg, km: +(g.flight.height / 1000).toFixed(2), flightKm: +t.hGround.toFixed(2), gear: g.controls.turbo.gear, level: g.controls.turbo.level, rung: t.rung, tLevel: t.level, ms: Math.round(g.flight.speed), flightMs: Math.round(t.v * 1000) };
    });
  // ---- up: Turbo 3, from 7 km, a full pull
  let streetRows = null;
  const at = await page.evaluate(() => ({ x: window.__game.flight.x, z: window.__game.flight.z, heading: window.__game.flight.heading }));
  await frames(2, { sx: 0, sy: 0 }, { ...at, y: 7000 });
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 3; i++) g.controls.turbo.shift(1, g.flight);
    for (let i = 0; i < 3; i++) g.controls.turbo.rung(1, g.flight);
  });
  const pull = { sx: 0, sy: -1 };
  const shotAt = [8.5, 11, 13, 14.6];
  let s = await read(), n = 0;
  for (; n < 4000 && s.leg === 'street' && s.km < 14.85; n += 10) {
    await frames(10, pull);
    s = await read();
    if (s.leg === 'street') streetRows = await rows([14, 15, 0, 1]);
    if (shotAt.length && s.km >= shotAt[0]) await page.screenshot({ path: join(dir, `up-${shotAt.shift()}km.png`) });
  }
  // the frames either side of the hand-over, one at a time
  let handed = -1;
  for (let i = 0; i < 40 && handed < 0; i++) {
    await frames(1, pull);
    await page.screenshot({ path: join(dir, `handover-${String(i).padStart(2, '0')}.png`) });
    if ((await read()).leg !== 'street') handed = i;
    else streetRows = await rows([14, 15, 0, 1]);
  }
  for (let i = handed + 1; handed >= 0 && i < handed + 4; i++) {
    await frames(1, pull);
    await page.screenshot({ path: join(dir, `handover-${String(i).padStart(2, '0')}.png`) });
  }
  const h = await read();
  const flightRows = await rows([14, 15, 0, 1]);
  row("up: at the hand-up the bus and the street's rows keep the street's table: nothing jumps at 15 km", !!streetRows && flightRows.every((r, i) => r === streetRows[i]), { same: streetRows ? flightRows.filter((r, i) => r === streetRows[i]).length : 0, of: 4 });
  const hud = await page.evaluate(() => getComputedStyle(document.querySelector('[data-hud="trip-label"]')).display);
  const windUp = await wind();
  // (and Turbo 3 still: the street's turbos go on over Earth, at the street's speed. The producer, 2026-11-04: "Why can't we just keep the normal controls/turbos?")
  await frames(6);
  const says = await page.evaluate(() => document.querySelector('[data-hud="trip-label"]')?.dataset.say?.split('|')[1] ?? '');
  row('up: past 15 km the flight has the bus, free over Earth, its label up, in Turbo 3 still', handed >= 0 && h.leg === 'wait' && h.flightKm > 14.9 && hud !== 'none' && h.rung === 3 && h.tLevel === 3 && Math.abs(h.flightMs - 900) < 30 && /^TURBO 3 /.test(says), { handedAt: handed, ...h, label: hud, says });
  // (no wind up there: the street's wind and foghorn quiet as the flight takes the bus, the second review's P4)
  row("up: and the street's wind and foghorn have gone quiet", windUp !== null && windUp.to === 0 && windUp.past >= 0.85 && windUp.duck < 0.05, { ambience: windUp });
  // ---- on: the flight climbs on
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
  await fly(20, -1);
  await frames(8);
  const o = await read();
  await page.screenshot({ path: join(dir, 'on.png') });
  row('on: the flight climbs on, free over Earth', o.leg === 'wait' && o.flightKm > 20, o);
  // ---- down: back down over the city
  await fly(300, 1, 't.hGround < 14.1');
  let d = await read();
  for (let i = 0; i < 30 && d.leg !== 'street'; i++) {
    await page.evaluate(() => {
      const m = window.__space.moon;
      m.trip.step(1 / 30, 0, 1);
      m.view.update(1 / 30, m.trip, 0, 0, false, 0);
    });
    await frames(1);
    d = await read();
  }
  await frames(20);
  d = await read();
  const windDown = await wind();
  await page.screenshot({ path: join(dir, 'down.png') });
  row("down: and the street's wind and foghorn are back", windDown !== null && windDown.to === 1 && windDown.past >= 0.6 && windDown.duck > 0.9, { ambience: windDown });
  row('down: under 14 km over the city the street has the bus again, in Turbo 3', d.leg === 'street' && d.km < 14.2 && d.km > 10 && d.gear === 3 && d.level === 3, d);
  row('no page errors', errors.length === 0, errors.slice(0, 5));
} finally {
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
