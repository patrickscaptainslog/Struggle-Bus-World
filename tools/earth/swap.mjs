#!/usr/bin/env node
// The page change in the long dark (docs/specs/earth/EARTHFLIGHT.md, E3), at a fixed step: node tools/earth/swap.mjs <out dir>
//   out    ?moonland&swap (the Moon's page made to change over as Earth's does, so the trip needn't start from the street): qaGo, skip to 'cruise', and a few seconds in the page changes to ?moonland&resume.
//          The new page is held before its first frame: the held frame is up, the trip is where the old page saved it (leg, clock, place), and after its third frame the held frame is gone. On to the Moon's orbit,
//          with the Moon's low game booted behind.
//   home   from the orbit, home: a few seconds into 'homeCruise' the page changes to ?earth&resume. The same checks, the street booted behind the flight and drawing nothing, then home over San Francisco,
//          a dive, set back over the city at 20 km (a dive from 300 km lands far off its map), and the street takes the bus under 14 km.
// Frames: out-old (the last the old page drew), out-held (the new page, the held frame up and nothing drawn), out-new (its fourth frame), out-next (a frame after that); the same for home. How much each
// change moves the picture: the mean change of a pixel (0-255) and the share of pixels that changed by more than 24, old to held, held to new, and new to next (a frame of flight by itself).
// Every page this context opens is held from its first frames (window.__qa), or it runs on before the tool looks. BASE is the page (http://localhost:4179/). Exit 1 if a row fails.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';
import { flick } from '../flick.mjs';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'shots/tmp/earth-swap';
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
/** Two frames' change, by PIL: mean per channel and the share over 24. */
const diff = (a, b) => {
  const py = `import sys\nfrom PIL import Image, ImageChops\nimport numpy as np\na=np.asarray(Image.open(sys.argv[1]).convert('RGB'),dtype=np.int16);b=np.asarray(Image.open(sys.argv[2]).convert('RGB'),dtype=np.int16)\nd=np.abs(a-b)\nprint(round(float(d.mean()),2), round(float((d.max(axis=2)>24).mean()),4))`;
  const [mean, share] = execFileSync('python3', ['-I', '-c', py, join(dir, `${a}.png`), join(dir, `${b}.png`)]).toString().trim().split(' ').map(Number);
  return { mean, share };
};
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  // (a page the tool has changed to is held before its first frame, to look at the held frame and the resumed trip; the first page draws four)
  await ctx.addInitScript(() => (window.__qa = { holdFrames: sessionStorage.getItem('qa.swap') ? 0 : 4, held: false }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.goto(`${BASE}?moonland&swap&t=${T}&fixeddt=0.033333&fps`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true && window.__qa?.held === true, null, { timeout: 300000, polling: 500 });
  const frames = async (n) => {
    await page.evaluate((k) => (window.__qa = { holdFrames: k, held: false }), n);
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 600000, polling: 50 });
  };
  const skipTo = (leg, then) =>
    page.evaluate(([l, then]) => {
      const m = window.__space.moon;
      for (let i = 0; i < 80000 && m.trip.leg !== l; i++) m.skip(0.05);
      if (m.trip.leg === l) m.skip(then);
      return m.trip.leg;
    }, [leg, then ?? 0]);
  const read = () =>
    page.evaluate(() => {
      const m = window.__space.moon, t = m.trip;
      return { leg: t.leg, t: t.t, ms: t.ms, r: [...t.r], v: t.v, hEarth: t.hEarth, hMoon: t.hMoon, held: !!document.getElementById('held-frame'), url: location.search };
    });
  const shot = (name) => page.screenshot({ path: join(dir, `${name}.png`) });

  /** From a long dark on this page: let it run on into the change, and look at the new page before its first frame and after its third. */
  async function change(name, leg, to) {
    // (the first frame on the leg starts its clock; the rest of the few seconds skipped, then frames until it goes)
    await frames(1);
    await page.evaluate(() => window.__space.moon.skip(2.9));
    await frames(1);
    await shot(`${name}-old`);
    const before = await read();
    await page.evaluate(() => sessionStorage.setItem('qa.swap', '1'));
    const nav = page.waitForURL((u) => u.search.includes(`${to}&resume`), { timeout: 120000 });
    await page.evaluate(() => (window.__qa = { holdFrames: 6, held: false }));
    await nav;
    await page.waitForFunction(() => window.__space?.moon?.trip && window.__qa?.held === true, null, { timeout: 600000, polling: 250 });
    const held = await read();
    const saved = await page.evaluate(() => window.__space.moon.resumed?.trip ?? null);
    await shot(`${name}-held`);
    // (the trip as the old page saved it: not a frame flown yet)
    const sr = saved ? saved.r : [0, 0, 0], apart = Math.hypot(held.r[0] - sr[0], held.r[1] - sr[1], held.r[2] - sr[2]) * 1000;
    row(`${name}: the page changes to ?${to}&resume a few seconds into ${leg}`, held.url.includes(`${to}&resume`) && before.leg === leg && held.leg === leg, { from: before.leg, url: held.url, leg: held.leg });
    row(`${name}: the held frame is up before the new page draws`, held.held, { held: held.held });
    row(`${name}: the trip resumes where it was saved (leg, clock, place)`, !!saved && saved.leg === held.leg && saved.t === held.t && saved.ms0 + saved.t * 1000 === held.ms && apart < 1, { savedAt: saved ? +saved.t.toFixed(3) : null, t: +held.t.toFixed(3), apartM: +apart.toFixed(4), oldPageAt: +before.t.toFixed(3) });
    await frames(4);
    const after = await read();
    await shot(`${name}-new`);
    await frames(1);
    await shot(`${name}-next`);
    const moved = Math.hypot(after.r[0] - held.r[0], after.r[1] - held.r[1], after.r[2] - held.r[2]);
    row(`${name}: after its third frame the held frame is gone, and the trip flies on`, !after.held && after.leg === leg && Math.abs(moved - after.v * 4 * 0.033333) < after.v * 0.04, { held: after.held, leg: after.leg, km: +moved.toFixed(1), want: +(after.v * 4 * 0.033333).toFixed(1) });
    const a = diff(`${name}-old`, `${name}-held`), b = diff(`${name}-held`, `${name}-new`), c = diff(`${name}-new`, `${name}-next`);
    console.log(`        change of picture: old to held ${JSON.stringify(a)}, held to new ${JSON.stringify(b)}, a frame by itself ${JSON.stringify(c)}`);
    await page.evaluate(() => sessionStorage.removeItem('qa.swap'));
  }

  // ---- out: off from over home by qaGo, to the long dark, and the change to the Moon's page
  await page.evaluate(() => {
    const m = window.__space.moon;
    m.skip(0.1);
    m.trip.qaGo();
    m.skip(0.1);
    m.trip.qaGo();
  });
  row('out: skipped to the long dark', (await skipTo('cruise')) === 'cruise', {});
  await change('out', 'cruise', 'moonland');
  const orbit = await skipTo('orbit', 1);
  await page.waitForFunction(() => !!window.__space.moon.landing?.world, null, { timeout: 600000, polling: 1000 });
  await frames(4);
  const o = await read();
  row('out: on to the Moon\'s orbit, with the Moon\'s low game booted behind', orbit === 'orbit' && Math.abs(o.hMoon - 300) < 1, { leg: o.leg, km: +o.hMoon.toFixed(2) });
  await shot('out-orbit');

  // ---- home: from the orbit, the long dark home, and the change to Earth's page
  await page.evaluate(() => {
    const m = window.__space.moon;
    m.trip.qaGo();
    m.skip(0.1);
  });
  row('home: skipped to the long dark home', (await skipTo('homeCruise')) === 'homeCruise', {});
  await change('home', 'homeCruise', 'earth');
  // (the street boots behind, and draws nothing until the flight hands it the bus)
  await page.waitForFunction(() => !!window.__game?.flight, null, { timeout: 600000, polling: 1000 });
  const st0 = await page.evaluate(() => ({ x: window.__game.flight.x, z: window.__game.flight.z, y: window.__game.flight.y, ground: window.__space.moon.earthLanding?.ground }));
  await frames(6);
  const st1 = await page.evaluate(() => ({ x: window.__game.flight.x, z: window.__game.flight.z, y: window.__game.flight.y, hud: getComputedStyle(document.querySelector('[data-hud="trip-label"]')).display }));
  row('home: the street is booted behind, the flight has the bus, the street stands still', st0.ground === false && st0.x === st1.x && st0.z === st1.z && st1.hud !== 'none', { ground: st0.ground, street: [Math.round(st1.x), Math.round(st1.y), Math.round(st1.z)], label: st1.hud });
  // (the opening's gate is the first flight's, never armed on the way home: the flight's look is on, and the street behind has no low shot. Review four, 6)
  const gate = () => page.evaluate(() => ({ lookOff: window.__space.input.lookOff, gearsLocked: window.__game.controls.gearsLocked, openingLow: window.__game.rig.openingLow }));
  const g0 = await gate();
  row("home: no opening's gate on the way home: the look is on, nothing locked, no low shot", !g0.lookOff && !g0.gearsLocked && g0.openingLow === 0, g0);
  const home = await skipTo('wait', 0.5);
  const h = await read();
  row('home: on to over home', home === 'wait' && Math.abs(h.hEarth - 300) < 3, { leg: h.leg, km: +h.hEarth.toFixed(1) });
  await frames(2);
  await shot('home-over');
  // ---- and down: a held push, to just over the street's height, then frames until the street has it
  const down = await page.evaluate(() => {
    const m = window.__space.moon, t = m.trip;
    let i = 0;
    const fly = (km) => {
      for (; i < 30 * 600 && t.hGround > km; i++) {
        t.step(1 / 30, 0, 1);
        m.view.update(1 / 30, t, 0, 0, false, 0);
      }
    };
    fly(20);
    // (a dive from 300 km comes down tens of km from where it started, off the city's map: at 20 km the bus is set back over home, Earth fixed, at the height it has, and dives on from there)
    const off = Math.hypot(t.ef[0] - t.fx[0], t.ef[1] - t.fx[1], t.ef[2] - t.fx[2]), k = Math.hypot(...t.ef) / Math.hypot(...t.fx);
    for (let j = 0; j < 3; j++) t.ef[j] = t.fx[j] * k;
    fly(14.3);
    return { s: i / 30, km: t.hGround, offKm: Math.round(off) };
  });
  let took = false;
  for (let k = 0; k < 20 && !took; k++) {
    await frames(1);
    took = await page.evaluate(() => window.__space.moon.earthLanding.ground);
  }
  await frames(3);
  const st2 = await page.evaluate(() => ({ y: window.__game.flight.y, x: window.__game.flight.x, z: window.__game.flight.z }));
  await shot('home-street');
  row('home: dived from 300 km, the street takes the bus under 14 km over the city', took && st2.y > 10000 && st2.y < 14500, { diveS: +down.s.toFixed(1), km: +down.km.toFixed(2), offKm: down.offKm, took, street: [Math.round(st2.x), Math.round(st2.y), Math.round(st2.z)] });
  const g1 = await gate();
  row('home: and the street that takes the bus has no gate either', !g1.lookOff && !g1.gearsLocked && g1.openingLow === 0, g1);
  // (and the thumb is the street's: a flick down shifts its ladder, not the trip's, and a tap is the street's, not a breath in the flight's unseen world. The first account's review, 2026-11-04: on this page the street took the flight's hands for good)
  const cdp = await page.context().newCDPSession(page);
  const hands = () => page.evaluate(() => { const T = window.__game.controls.turbo, m = window.__space.moon; return { gear: T.gear, level: T.level, rung: m.trip.rung, tLevel: m.trip.level, breaths: m.breath.stats.shots + m.breath.stats.denied }; });
  const h0 = await hands();
  await flick(cdp, -1, { x: 196, y: 640 });
  await frames(6);
  const h1 = await hands();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 300, id: 11, radiusX: 4, radiusY: 4, force: 1 }], timestamp: Date.now() / 1000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: Date.now() / 1000 + 0.06 });
  await frames(6);
  const h2 = await hands();
  row("home: on the street the thumb is the street's: a flick down shifts its ladder, and a tap breathes nothing in the flight", h1.gear + h1.level === h0.gear + h0.level - 1, { before: h0, flicked: h1, tapped: h2 });
  row("home: and the flight's own ladder and breath are left alone", h1.rung === h0.rung && h1.tLevel === h0.tLevel && h2.breaths === h0.breaths, { before: h0, flicked: h1, tapped: h2 });
} catch (e) {
  bad++;
  console.log('FAIL ', e.message);
} finally {
  row('no page errors', !errors.length, errors.slice(0, 5));
  await browser.close();
}
console.log(bad ? `${bad} FAILED` : 'all pass');
process.exit(bad ? 1 : 0);
