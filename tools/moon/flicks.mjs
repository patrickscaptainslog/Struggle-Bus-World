#!/usr/bin/env node
// Flicks out in space, felt a frame at a time on a fixed step (docs/specs/moon/FREEFLIGHT.md, Stage 1): node tools/moon/flicks.mjs <out dir>
//   wait   the label says climb, a left flick up climbs, 13,000 km up TO THE MOON? pops up, a flick down takes it away, and a tap on it sets off on the moon boost
//   dark   in the long dark a right drag carves the bus off the path and it comes back on the lift; a left drag pans the view as far as the finger goes, and it stays; a flick on either side leaves it
//   look   a left drag in orbit turns the view about the bus as far as the finger goes, and it stays there after the lift
//   orbit  a right flick up as slow as the rule allows, its push felt past the old 0.15 s, climbs and starts no fall; 3,500 km up TO PLANET EARTH? pops up, and a tap on it goes home
//   push   and a push held 0.3 s still starts one
// --trip goes on from there, the whole trip on flicks: that push held to the ground, the gears coming down with it at their floors, four
// flicks out of Express by Rainbow Warp, the flight's loop back to the orbit, and a flick home. About 2,000 frames: half an hour on software GL.
// The thumbs are real touches through CDP, stamped 2 s back so the stroke is as long as the row says, and the loop is stepped between
// them (window.__qa.holdFrames). The long dark between is skipped at the route's step. BASE is the page (http://localhost:4179/).
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';
import { flick, flickTo } from '../flick.mjs';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'shots/tmp/flicks';
const trip = process.argv.includes('--trip');
// --high instead: that push let go at 60 km, flying on round the Moon there until the map has moved under the mesh (it dissolves out, the world is made
// again ahead, it comes back), then a push down to the ground in the new world
const high = process.argv.includes('--high');
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(dir, { recursive: true });
const W = 393, H = 852, DT = 1 / 30;
/** a right thumb, out of the left zone and clear of MEGA's place, and a left one */
// (the flying thumb's place is in the bus's lane, read off the page once it's flying: below the bus. The left one is out of it, where a touch looks)
let RX = 196, RY = 700;
const LX = 70, LY = 560;
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(70)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.goto(`${BASE}?moonland&t=2026-11-25T04:00:00Z&fixeddt=${DT.toFixed(6)}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 180000 });
  const cdp = await ctx.newCDPSession(page);
  const frames = async (n) => {
    await page.evaluate((k) => (window.__qa = { holdFrames: k, held: false }), n);
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 600000, polling: 50 });
  };
  await frames(0);
  /** the leg, what the label says, the orbit's felt push, the look, and how the bus stands in the view: its nose's yaw and pitch in the render frame (deg) */
  const read = () => page.evaluate(() => {
    const m = window.__space.moon, n = m.view.nosing, d = 180 / Math.PI;
    const c = m.view.carve;
    return { leg: m.trip.leg, say: document.querySelector('[data-hud="trip-label"]')?.dataset.say?.split('|')[2] ?? '', pushT: +m.trip.pushT.toFixed(3), lookYaw: +(m.view.lookYaw * d).toFixed(1), noseYaw: +(Math.atan2(n.x, -n.z) * d).toFixed(2), nosePitch: +(Math.asin(Math.max(-1, Math.min(1, n.y))) * d).toFixed(2), carveYaw: +c.yaw.toFixed(2), carvePitch: +c.pitch.toFixed(2) };
  });
  const skipTo = async (leg) => {
    const got = await page.evaluate((l) => {
      const m = window.__space.moon;
      for (let i = 0; i < 80000 && m.trip.leg !== l; i++) m.skip(0.05);
      return m.trip.leg;
    }, leg);
    if (got !== leg) throw new Error(`skipped for ${leg} and the leg is ${got}`);
    console.log('  skipped to', got);
  };
  // a thumb's events, stamped from t0 (2 s back): what the page's clock says the stroke took, whatever the loop between does
  let t0 = 0;
  const touch = (type, x, y, ms) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 4, radiusX: 4, radiusY: 4, force: 1 }], timestamp: t0 + ms / 1000 });
  const begin = () => (t0 = Date.now() / 1000 - 2);
  const shot = (name) => page.screenshot({ path: join(dir, `${name}.png`) });
  // the easter egg's button (src/sky/EasterEgg.ts): up, on screen, where; and a real tap on its middle
  const egg = (qa) => page.evaluate((q) => {
    const e = document.querySelector(`[data-hud="${q}"]`);
    return { up: e?.dataset.up === '1', shown: !!e && getComputedStyle(e).display !== 'none', box: e ? e.getBoundingClientRect().toJSON() : null };
  }, qa);
  const tapEgg = async (qa) => {
    const b = (await egg(qa)).box;
    begin();
    await touch('touchStart', b.x + b.width / 2, b.y + b.height / 2, 0);
    await touch('touchEnd', b.x + b.width / 2, b.y + b.height / 2, 60);
  };

  // ---- wait: the label says climb, and a left flick up climbs; extremely high TO THE MOON? comes up (VOYAGE.md V2), a flick down takes the bus back down and it goes, and a tap on it sets off
  const w0 = await read();
  await flick(cdp, 1);
  await frames(3);
  const w1 = await read();
  row('wait: the label says FLICK UP TO CLIMB, and a left flick up climbs', w0.say === 'FLICK UP TO CLIMB' && w0.leg === 'wait' && w1.leg === 'rise', { said: w0.say, leg: w1.leg });
  await skipTo('high');
  await frames(20);
  const e1 = await egg('to-moon'), h1 = await page.evaluate(() => Math.round(window.__space.moon.trip.hEarth));
  await shot('egg-moon');
  row('high: 13,000 km over home TO THE MOON? pops up', e1.up && e1.shown && h1 >= 12990, { up: e1.up, shown: e1.shown, km: h1 });
  await flick(cdp, -1);
  await frames(25);
  const w2 = await read(), e2 = await egg('to-moon');
  row('high: a flick down goes back down, and the button goes', w2.leg === 'sink' && !e2.shown, { leg: w2.leg, shown: e2.shown });
  await skipTo('wait');
  await flick(cdp, 1);
  await frames(3);
  await skipTo('high');
  await frames(20);
  await tapEgg('to-moon');
  await frames(4);
  // (asked for, or on already: from up here it goes on at once if the Moon's clear of Earth)
  const w3 = await read(), boost = await page.evaluate(() => window.__space.moon.trip.armed || window.__space.moon.trip.gear === 5);
  row('high: a tap on TO THE MOON? sets off, on the moon boost', w3.leg !== 'high' && w3.leg !== 'sink' && boost, { leg: w3.leg, boost });

  // ---- the long dark: a right flick up is a stroke on the thumb that swings the view, and it mustn't move it
  await skipTo('cruise');
  await frames(20);
  // (out here only a touch near the bus flies it: the lane round it, down to the bottom. The flying thumb goes there; a touch in the sky over the bus, or beside it, looks)
  const bz = await page.evaluate(() => window.__space.input.busZone);
  if (bz) {
    RX = Math.round(bz.x);
    RY = Math.round(Math.min(bz.y + 90, 780));
  }
  console.log('  the bus\'s lane', JSON.stringify(bz), 'the flying thumb at', RX, RY);
  for (const [name, x, y] of [['in the sky over the bus', bz ? bz.x : 196, bz ? bz.y - 260 : 340], ['beside the bus, on the right', bz ? bz.x + bz.r + 50 : 340, bz ? bz.y : 600]]) {
    const p0 = await read();
    begin();
    await touch('touchStart', x, y, 0);
    await touch('touchMove', x + 60, y, 150);
    await frames(30);
    const p1 = await read();
    await touch('touchEnd', x + 60, y, 150 + 1000);
    await frames(10);
    const panned = Math.hypot(p1.noseYaw - p0.noseYaw, p1.nosePitch - p0.nosePitch);
    row(`dark: a drag ${name} pans the view and carves nothing`, panned > 20 && Math.abs(p1.carveYaw) < 1 && Math.abs(p1.carvePitch) < 1, { panned: +panned.toFixed(1), carve: [p1.carveYaw, p1.carvePitch] });
    // (and back where it was, for the rows after)
    begin();
    await touch('touchStart', x + 60, y, 0);
    await touch('touchMove', x, y, 150);
    await frames(30);
    await touch('touchEnd', x, y, 150 + 1000);
    await frames(10);
  }
  // (what the view does by itself over as many frames as the flick takes)
  const dz = await read();
  await frames(13);
  const d0 = await read();
  const drift = Math.hypot(d0.noseYaw - dz.noseYaw, d0.nosePitch - dz.nosePitch);
  begin();
  await touch('touchStart', RX, RY, 0);
  await touch('touchMove', RX, RY - 37, 42);
  await frames(2);
  await touch('touchMove', RX, RY - 74, 85);
  await frames(1);
  await touch('touchEnd', RX, RY - 74, 85);
  await frames(10);
  const d1 = await read();
  const flickMoved = Math.hypot(d1.noseYaw - d0.noseYaw, d1.nosePitch - d0.nosePitch);
  row('dark: a right flick up (74 px, 85 ms, 3 frames on the stick) leaves the view', flickMoved < 1 + drift, { moved: +flickMoved.toFixed(2), byItself: +drift.toFixed(2), before: d0, after: d1 });
  begin();
  await touch('touchStart', RX, RY, 0);
  await touch('touchMove', RX, RY - 60, 150);
  await frames(30);
  const d2 = await read();
  await shot('dark-carve');
  await touch('touchEnd', RX, RY - 60, 150 + 1000);
  await frames(120);
  const d2b = await read();
  // (the right thumb flies out there too: where it doesn't steer the path, a drag carves the bus off it as the street's turns, and on the lift it comes back to the path)
  row('dark: a right drag up held 1 s carves the nose down off the path, and 4 s after the lift it is back on it', d2.carvePitch < -8 && Math.abs(d2b.carvePitch) < 3 && Math.abs(d2b.carveYaw) < 3, { carved: [d2.carveYaw, d2.carvePitch], after: [d2b.carveYaw, d2b.carvePitch], during: d2 });
  await shot('dark-swung');
  // (the left of the screen pans the same way out here, and the pan stays where it's left)
  await frames(5);
  const d3 = await read();
  begin();
  await touch('touchStart', LX, LY, 0);
  await touch('touchMove', LX + 60, LY, 150);
  await frames(30);
  const d4 = await read();
  await touch('touchEnd', LX + 60, LY, 150 + 1000);
  await frames(30);
  const d5 = await read();
  const lpan = Math.hypot(d4.noseYaw - d3.noseYaw, d4.nosePitch - d3.nosePitch), kept = Math.hypot(d5.noseYaw - d4.noseYaw, d5.nosePitch - d4.nosePitch);
  const lwant = (60 / 393) * 180;
  row(`dark: a left drag of 60 px pans ${lwant.toFixed(1)} deg, and 1 s after the lift the view is where it was left`, Math.abs(lpan - lwant) < 3 && kept < 1 && d4.lookYaw === 0, { panned: +lpan.toFixed(1), movedAfter: +kept.toFixed(2), rigLook: d4.lookYaw });
  await shot('dark-left-pan');
  begin();
  await touch('touchStart', LX, LY, 0);
  await touch('touchMove', LX, LY - 37, 42);
  await frames(2);
  await touch('touchMove', LX, LY - 74, 85);
  await frames(1);
  await touch('touchEnd', LX, LY - 74, 85);
  await frames(10);
  const d6 = await read();
  const leftFlick = Math.hypot(d6.noseYaw - d5.noseYaw, d6.nosePitch - d5.nosePitch);
  row('dark: a left flick up (74 px, 85 ms, 3 frames) leaves the view', leftFlick < 1 + drift, { moved: +leftFlick.toFixed(2), byItself: +drift.toFixed(2) });

  // ---- orbit: the look, a left drag 100 px right, held, and let go
  await skipTo('orbit');
  await frames(30);
  const o0 = await read();
  await shot('orbit-home');
  begin();
  await touch('touchStart', LX, LY, 0);
  await touch('touchMove', LX + 50, LY, 60);
  await touch('touchMove', LX + 100, LY, 120);
  await frames(45);
  const o1 = await read();
  await shot('orbit-look');
  await touch('touchEnd', LX + 100, LY, 120 + 1500);
  await frames(60);
  const o2 = await read();
  await shot('orbit-look-home');
  // (in orbit too the left of the screen pans as far as the finger and leaves the view there: the producer, "just forget auto re-alignment. where the user pans - it goes")
  const turned = o1.noseYaw - o0.noseYaw, stayed = Math.abs(o2.noseYaw - o1.noseYaw), owant = (100 / 393) * 180;
  row(`look: a left drag of 100 px turns the view ${owant.toFixed(1)} deg about the bus`, Math.abs(Math.abs(turned) - owant) < 4 && o1.lookYaw === 0, { turned: +turned.toFixed(1), rig: o1.lookYaw });
  row('look: 2 s after the lift the view is where it was left', stayed < 1 && o2.lookYaw === 0, { moved: +stayed.toFixed(2), rig: o2.lookYaw });

  // ---- orbit: the street's gears from the orbit down (VOYAGE.md V2c): a flick down is Stratos, and the label names it; a flick up is Rainbow Warp, the orbit's speed, again
  {
    const gearOf = () => page.evaluate(() => {
      const t = window.__space.moon.trip;
      return { leg: t.leg, rung: t.rung, v: +t.v.toFixed(2), say: document.querySelector('[data-hud="trip-label"]')?.dataset.say?.split('|')[1] ?? '' };
    });
    await flick(cdp, -1);
    await frames(60);
    const g1 = await gearOf();
    await flick(cdp, 1);
    await frames(90);
    const g2 = await gearOf();
    row('orbit: a flick down is Stratos, named, and a flick up Rainbow Warp again', g1.leg === 'orbit' && g1.rung === 4 && Math.abs(g1.v - 4.5) < 0.1 && g1.say.startsWith('STRATOS') && g2.leg === 'orbit' && g2.rung === 5 && Math.abs(g2.v - 30) < 0.5 && g2.say.startsWith('RAINBOW WARP'), { g1, g2 });
    await shot('orbit-gears');
  }

  // ---- orbit: a tap is a crater shot (VOYAGE.md V2c): the crater under the aim takes a level, a crater a few km across, and the orbit's map takes no splat
  {
    await page.waitForFunction(() => !!window.__space.moon.landing?.world && !!window.__game?.moon?.paint, null, { timeout: 600000, polling: 500 });
    const paintOf = () => page.evaluate(() => {
      const m = window.__space.moon, P = window.__game.moon.paint, recs = [...P.recs.values()];
      const last = recs.reduce((a, r) => (!a || r.order > a.order ? r : a), null);
      return { recs: recs.length, last: last ? { id: last.id, km: +(last.r / 1000).toFixed(2), level: last.level } : null, shots: m.breath.stats.shots, map: +m.breath.paint.painted.toFixed(6), craters: m.breath.craters };
    });
    const p0 = await paintOf();
    begin();
    await touch('touchStart', W / 2, 300, 0);
    await touch('touchEnd', W / 2, 300, 60);
    await frames(60);
    const p1 = await paintOf();
    row('orbit: a tap paints the crater under the aim, a few km across, and no splat', p0.craters && p1.shots === p0.shots + 1 && p1.recs >= p0.recs + (p1.last?.level === 1 ? 1 : 0) && !!p1.last && p1.last.km >= 0.2 && p1.last.km <= 8 && p1.map === p0.map, { p0, p1 });
    await shot('orbit-crater');
  }

  // ---- orbit: a right flick up as slow as the rule allows, felt frame by frame until the old rule would have had it fall
  begin();
  await touch('touchStart', RX, RY, 0);
  await touch('touchMove', RX, RY - 40, 97);
  await touch('touchMove', RX, RY - 80, 195);
  let felt = 0, fell = false;
  for (let i = 0; i < 12 && felt <= 0.155; i++) {
    await frames(1);
    const s = await read();
    felt = Math.max(felt, s.pushT);
    fell ||= s.leg === 'fall';
  }
  await touch('touchEnd', RX, RY - 80, 195);
  await frames(4);
  const o3 = await read();
  row('orbit: a right flick up of 80 px in 195 ms, its push felt past 0.15 s, climbs and starts no fall', felt > 0.15 && !fell && o3.leg === 'moonRise', { felt, fell, leg: o3.leg });
  // (and over the Moon the same easter egg: 3,500 km up, TO PLANET EARTH?, and a tap on it goes home)
  await skipTo('moonHigh');
  await frames(20);
  const e4 = await egg('to-earth'), h4 = await page.evaluate(() => Math.round(window.__space.moon.trip.hMoon));
  await shot('egg-earth');
  await tapEgg('to-earth');
  await frames(4);
  const o4 = await read();
  row('moonHigh: 3,500 km over the Moon TO PLANET EARTH? pops up, and a tap on it goes home', e4.up && e4.shown && h4 >= 3490 && o4.leg === 'leave', { up: e4.up, km: h4, leg: o4.leg });

  // ---- and the push still lands: home, out again, and a push held 0.3 s
  await skipTo('wait');
  await frames(2);
  await flick(cdp, 1);
  await frames(3);
  await skipTo('high');
  await page.evaluate(() => window.__space.moon.trip.toMoon());
  await skipTo('orbit');
  await frames(10);
  begin();
  await touch('touchStart', RX, RY, 0);
  await touch('touchMove', RX, RY - 40, 150);
  await touch('touchMove', RX, RY - 80, 300);
  const legs = [];
  for (let i = 0; i < 15 && !legs.includes('fall'); i++) {
    await frames(1);
    legs.push((await read()).leg);
  }
  row('push: a push held 0.3 s leaves the orbit', legs.includes('fall'), { frames: legs.length, legs: [...new Set(legs)] });
  if (high) {
    const at = () => page.evaluate(() => {
      const sp = window.__space, m = sp.moon, L = m.landing, G = window.__game;
      return { leg: m.trip.leg, near: L.near, low: L.ground, km: +L.height.toFixed(2), moving: L.moving, show: +L.show.toFixed(2), speed: Math.round(m.trip.v * m.trip.gov * 1000), nose: +((m.trip.nose * 180) / Math.PI).toFixed(1), gear: L.ground ? G.controls.turbo.gear : m.trip.gear, programs: sp.pipeline.renderer.info.programs.length };
    });
    const wall = Date.now();
    let s1 = await at(), n = 0;
    for (; n < 300 && !(s1.near && s1.km < 60); n++) {
      await frames(10);
      s1 = await at();
      if (n % 25 === 0) console.log('  down', JSON.stringify(s1));
    }
    await touch('touchEnd', RX, RY - 80, 300 + n * 10 * 33);
    console.log('  let go', JSON.stringify(s1), `${n * 10} frames`);
    const seen = [];
    let k = 0;
    for (; k < 400 && !(seen.includes(2) && s1.moving === 0 && s1.show >= 1); k++) {
      await frames(10);
      s1 = await at();
      if (seen.at(-1) !== s1.moving) seen.push(s1.moving);
      if (k % 20 === 0 || seen.length < 5) console.log('  level', JSON.stringify(s1));
      if (s1.moving === 2 && !seen.includes('shot')) {
        seen.push('shot');
        await shot('high-moving');
      }
    }
    await shot('high-moved');
    row('high: flying on at 60 km the map moves under the mesh, and the mesh comes back', seen.includes(1) && seen.includes(2) && s1.show >= 1 && !s1.low, { frames: k * 10, seen, at: s1 });
    begin();
    await touch('touchStart', RX, RY, 0);
    await touch('touchMove', RX, RY - 80, 300);
    for (n = 0; n < 300 && !s1.low; n++) {
      await frames(10);
      s1 = await at();
      if (n % 20 === 0) console.log('  down again', JSON.stringify(s1));
    }
    await touch('touchEnd', RX, RY - 80, 300 + n * 10 * 33);
    await frames(30);
    await shot('high-landed');
    row('high: and a push down from there lands in the new world', s1.low, { frames: n * 10, at: s1 });
    console.log(`  ${Math.round((Date.now() - wall) / 1000)} s of wall`);
  } else if (trip) {
    // ---- the whole way down on that push, out by flicks, and home
    const at = () => page.evaluate(() => {
      const sp = window.__space, m = sp.moon, L = m.landing, G = window.__game, low = L.ground, f = G?.flight;
      return { leg: m.trip.leg, low, km: +(low ? f.height / 1000 : L.height).toFixed(2), gear: low ? G.controls.turbo.gear : m.trip.gear, gap: low ? +(f.y - f.floorY).toFixed(1) : null, speed: low ? Math.round(f.speed) : Math.round(m.trip.v * 1000), programs: sp.pipeline.renderer.info.programs.length };
    });
    const wall = Date.now(), gears = [];
    let s1 = await at(), n = 0;
    const p0 = s1.programs;
    // (down on a gear's floor near the ground; and if that gear's over Express, 10 s more for the push held there to take it on down, as a push at a floor does)
    let onFloor = -1;
    for (; n < 400; n++) {
      const down = s1.low && s1.gap !== null && s1.gap < 20 && s1.km < 1;
      if (down && onFloor < 0) onFloor = n;
      if (down && (s1.gear <= 1 || n - onFloor >= 30)) break;
      await frames(10);
      s1 = await at();
      if (s1.low && gears.at(-1) !== s1.gear) gears.push(s1.gear);
      if (n % 25 === 0) console.log('  down', JSON.stringify(s1));
      if (n % 50 === 25) await shot(`trip-down-${String(n).padStart(3, '0')}`);
    }
    console.log('  down', JSON.stringify(s1), `${n * 10} frames, ${Math.round((Date.now() - wall) / 1000)} s`);
    row('trip: a push held from orbit takes the bus down to the ground', s1.low && s1.km < 1, { frames: n * 10, at: s1 });
    row('trip: the gears come down with it at their floors, Jet, Nonstop, Express', gears.join() === '3,2,1', { gears });
    await touch('touchEnd', RX, RY - 80, 300 + n * 10 * 33);
    await frames(45);
    await shot('trip-skim');
    const s2 = await at();
    await flickTo(page, cdp, 5);
    const s3 = await at();
    row('trip: on the ground four flicks out of Express reach Rainbow Warp', s2.gear === 1 && s3.gear === 5, { from: s2.gear, to: s3.gear });
    let s4 = s3, k = 0;
    for (; k < 300 && s4.leg !== 'orbit'; k++) {
      await frames(10);
      s4 = await at();
      if (k % 10 === 0) console.log('  up', JSON.stringify(s4));
      if (k === 15) await shot('trip-up');
    }
    row('trip: Rainbow Warp lifts it out, and the flight\'s loop takes it back to the orbit', s4.leg === 'orbit' && !s4.low, { frames: k * 10, at: s4 });
    await shot('trip-orbit-again');
    await flick(cdp, 1);
    await frames(4);
    const s5 = await at();
    row('trip: and a flick up there climbs to the button', s5.leg === 'moonRise', { leg: s5.leg });
    console.log(`  programs: ${p0} at the push, ${s5.programs} home; ${Math.round((Date.now() - wall) / 1000)} s of wall for the trip`);
  } else await touch('touchEnd', RX, RY - 80, 300 + legs.length * 33);
  await page.evaluate(() => (window.__qa = null));
} finally {
  console.log('errors:', errors.length, errors.slice(0, 4));
  if (errors.length) bad++;
  await browser.close();
}
console.log(bad ? `${bad} failed` : 'all passed');
process.exit(bad ? 1 : 0);
