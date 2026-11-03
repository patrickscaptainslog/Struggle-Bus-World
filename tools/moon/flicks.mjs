#!/usr/bin/env node
// Flicks out in space, felt a frame at a time on a fixed step (docs/specs/moon/FREEFLIGHT.md, Stage 1): node tools/moon/flicks.mjs <out dir>
//   wait   the label asks for a flick, and a left flick up launches
//   dark   in the long dark a drag on either side pans the view, as the flight always has, and it stays where it's left; a flick on either side leaves it
//   look   a left drag in orbit turns the view about the bus, the rig's curve, and on the lift the view comes home
//   orbit  a right flick up as slow as the rule allows, its push felt past the old 0.15 s, goes home and starts no fall
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
const RX = 290, RY = 600, LX = 70, LY = 560;
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
    return { leg: m.trip.leg, say: document.querySelector('[data-hud="trip-label"]')?.dataset.say?.split('|')[2] ?? '', pushT: +m.trip.pushT.toFixed(3), lookYaw: +(m.view.lookYaw * d).toFixed(1), noseYaw: +(Math.atan2(n.x, -n.z) * d).toFixed(2), nosePitch: +(Math.asin(Math.max(-1, Math.min(1, n.y))) * d).toFixed(2) };
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

  // ---- wait: the label asks, and a left flick up launches
  const w0 = await read();
  await flick(cdp, 1);
  await frames(3);
  const w1 = await read();
  row('wait: the label asks for a flick, and a left flick up launches', w0.say === 'FLICK UP FOR THE MOON' && w0.leg === 'wait' && w1.leg !== 'wait', { said: w0.say, leg: w1.leg });
  // (the next asks for G5, and the long dark is G5's)
  await flick(cdp, 1);
  await frames(3);
  const armed = await page.evaluate(() => window.__space.moon.trip.armed);
  row('out: the next flick up asks for G5', armed, { armed });

  // ---- the long dark: a right flick up is a stroke on the thumb that swings the view, and it mustn't move it
  await skipTo('cruise');
  await frames(20);
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
  await touch('touchEnd', RX, RY - 60, 150 + 1000);
  await frames(2);
  const swung = Math.hypot(d2.noseYaw - d1.noseYaw, d2.nosePitch - d1.nosePitch);
  row('dark: a right drag held 1 s still swings it', swung > 10, { swung: +swung.toFixed(1), during: d2 });
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
  row('dark: a left drag held 1 s pans too, and 1 s after the lift the view is where it was left', lpan > 10 && kept < 1 && d4.lookYaw === 0, { panned: +lpan.toFixed(1), movedAfter: +kept.toFixed(2), rigLook: d4.lookYaw });
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
  const turned = o1.noseYaw - o0.noseYaw, back = Math.abs(o2.noseYaw - o0.noseYaw);
  row('look: a left drag of 100 px turns the view 44 deg about the bus (the rig: 44.3)', Math.abs(turned + 44.3) < 4 && Math.abs(o1.lookYaw - 44.3) < 1, { turned: +turned.toFixed(1), rig: o1.lookYaw });
  row('look: 2 s after the lift the view is home', back < 1 && o2.lookYaw === 0, { off: +back.toFixed(2), rig: o2.lookYaw });

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
  row('orbit: a right flick up of 80 px in 195 ms, its push felt past 0.15 s, goes home and starts no fall', felt > 0.15 && !fell && o3.leg === 'leave', { felt, fell, leg: o3.leg });

  // ---- and the push still lands: home, out again, and a push held 0.3 s
  await skipTo('wait');
  await frames(2);
  await flick(cdp, 1);
  await frames(3);
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
    for (; n < 400 && !(s1.low && s1.gap !== null && s1.gap < 20 && s1.km < 1); n++) {
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
    row('trip: and a flick up there goes home', s5.leg === 'leave', { leg: s5.leg });
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
