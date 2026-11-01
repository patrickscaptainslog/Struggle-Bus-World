#!/usr/bin/env node
// A first-timer flies ?moonrun: node tools/sky/moon-live.mjs <out dir> [--g5=6000] [--t=2026-11-25T04:00:00Z] [--dt=0] [--trips=1] [--w=402] [--h=874] [--dsf=1] [--shots=1] [--q=fps]
// Real frame loop, real clock, real touches, and it does only what the screen says: the top right corner is read off the label, and TURBO is tapped when the label asks and not before, a beat after it asks.
// The thumb is a real drag on the canvas: in the long dark each way (the camera), and on both sides in orbit (the bus). --dt=0.05 holds the frame loop's step there, so a fast laptop flies it faster than life:
// that's for repeat flights; the clock numbers are the same.
// Every frame goes in a log: what's on the sky and how far each body moved on screen since the frame before, in game px. It prints the worst of those by leg, and a frame is shot at each mark. A mark is a state
// of the flight (a leg starting, a size reached), so it lands in the same place at any speed and any date.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const g5 = opt('g5', '6000'), t = opt('t', '2026-11-25T04:00:00Z'), dt = Number(opt('dt', 0)), trips = Number(opt('trips', 1)), w = Number(opt('w', 402)), h = Number(opt('h', 874)), dsf = Number(opt('dsf', 1)), shots = opt('shots', '1') !== '0', extra = opt('q', '');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const t0 = Date.now();
const wall = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, hasTouch: true, isMobile: true });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text().slice(0, 400)}`);
  });
  page.on('pageerror', (e) => {
    bad++;
    console.log('  [pageerror]', e.message);
  });
  await page.goto(`${BASE}?moonrun${t === 'now' ? '' : `&t=${t}`}${g5 === 'default' ? '' : `&g5=${g5}`}${dt ? `&fixeddt=${dt}` : ''}${extra ? `&${extra}` : ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  console.log(wall(), 'ready:', JSON.stringify(await page.evaluate(() => window.__game.moon.load)));

  // the log, a frame at a time, from a loop of its own
  await page.evaluate(() => {
    const m = window.__game.moon, p = window.__game.pipeline, rec = (window.__rec = []);
    let last = performance.now();
    const tick = (now) => {
      const tr = m.trip, s = m.sky, f = 1 / p.pixelWorldSize(1);
      rec.push([+(now - last).toFixed(1), +tr.clock.toFixed(3), tr.leg, tr.gear, +tr.v.toFixed(1), +tr.hEarth.toFixed(2), +tr.hMoon.toFixed(2), +m.view.hfov.toFixed(3), +f.toFixed(1), s.earth[0], s.earth[1], s.earth[2], s.moon[0], s.moon[1], s.moon[2], s.sun[0], s.sun[1], s.sun[2], s.earthR, s.moonR, +s.sunSeen.toFixed(3), +s.moonLit.toFixed(3), +s.earthLit.toFixed(3), tr.ob.body, m.view.target]);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const read = () =>
    page.evaluate(() => {
      const m = window.__game.moon, s = m.sky, tr = m.trip, f = 1 / window.__game.pipeline.pixelWorldSize(1);
      return { leg: tr.leg, gear: tr.gear, clock: +tr.clock.toFixed(1), v: Math.round(tr.v), hE: Math.round(tr.hEarth), hM: Math.round(tr.hMoon), lens: +m.view.hfov.toFixed(1), trips: tr.trips, earthPx: Math.round(2 * Math.tan(s.earthR) * f), moonPx: Math.round(2 * Math.tan(s.moonR) * f), say: document.querySelector('[data-hud="trip-label"]')?.dataset.say ?? '', moonLit: +s.moonLit.toFixed(3), earthLit: +s.earthLit.toFixed(3), sunSeen: +s.sunSeen.toFixed(2) };
    });
  const turbo = await page.locator('[data-hud="turbo"]').boundingBox();
  const tap = () => page.touchscreen.tap(turbo.x + turbo.width / 2, turbo.y + turbo.height / 2);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  /** a real thumb: down, across, held, and off */
  const drag = async (dx, dy, ms) => {
    await touch('touchStart', 200, 560);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', 200 + (dx * i) / 8, 560 + (dy * i) / 8);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(ms);
    await touch('touchEnd');
  };
  const done = new Set();
  const shoot = async (name, s) => {
    if (done.has(name)) return;
    done.add(name);
    if (shots) await page.screenshot({ path: join(out, `${name}.png`) });
    console.log(wall(), name.padEnd(20), JSON.stringify(s));
  };

  let trip = 1, leg = 'wait', legAt = Date.now(), asked = '', askedAt = Date.now(), legs = [];
  await shoot('00-wait', await read());
  for (;;) {
    const s = await read();
    const prompt = s.say.split('|')[2] ?? '';
    if (s.leg !== leg) {
      console.log(wall(), `-> ${s.leg}`.padEnd(20), JSON.stringify(s));
      leg = s.leg;
      legAt = Date.now();
      legs.push([s.leg, s.clock]);
    }
    if (prompt !== asked) {
      asked = prompt;
      askedAt = Date.now();
    }
    const inLeg = ((Date.now() - legAt) / 1000) * (dt ? dt * 60 : 1);
    const heard = ((Date.now() - askedAt) / 1000) * (dt ? dt * 60 : 1);
    const n = `${trip}`;
    // ---- the marks. Out
    if (s.leg === 'climb' || s.leg === 'out') {
      if (s.clock >= 1) await shoot(`${n}a-tip-1s`, s);
      if (s.clock >= 5) await shoot(`${n}b-5s`, s);
      if (s.clock >= 20) await shoot(`${n}c-20s`, s);
      if (s.earthPx <= 402 && s.clock > 30) await shoot(`${n}d-earth-fits`, s);
    }
    if (s.leg === 'cruise') {
      await shoot(`${n}e-g5-on`, s);
      if (s.earthPx <= 100) await shoot(`${n}f-earth-100`, s);
      if (s.moonPx >= 15) await shoot(`${n}g-moon-15`, s);
      if (s.moonPx >= s.earthPx) await shoot(`${n}h-equal`, s);
      if (s.moonPx >= 80) await shoot(`${n}i-moon-80`, s);
    }
    if (s.leg === 'brake') await shoot(`${n}j-ring`, s);
    if (s.leg === 'down' || s.leg === 'flare') {
      await shoot(`${n}k-in`, s);
      if (s.moonPx >= 256) await shoot(`${n}l-moon-256`, s);
      if (s.moonPx >= 402) await shoot(`${n}m-moon-fills`, s);
      if (s.leg === 'flare') await shoot(`${n}n-flare`, s);
    }
    if (s.leg === 'orbit') await shoot(`${n}o-orbit`, s);
    // ---- home
    if (s.leg === 'leave') await shoot(`${n}p-leave`, s);
    if (s.leg === 'homeOut') await shoot(`${n}q-home-out`, s);
    if (s.leg === 'homeCruise') {
      await shoot(`${n}r-home-g5`, s);
      if (s.earthPx >= s.moonPx) await shoot(`${n}s-home-equal`, s);
      if (s.earthPx >= 100) await shoot(`${n}t-earth-100`, s);
    }
    if (s.leg === 'homeBrake') await shoot(`${n}u-home-ring`, s);
    if (s.leg === 'homeDown') {
      await shoot(`${n}v-home-in`, s);
      if (s.earthPx >= 402) await shoot(`${n}w-earth-fills`, s);
    }
    if (s.leg === 'homeLevel') await shoot(`${n}x-level`, s);
    if (s.leg === 'homeDrop') await shoot(`${n}y-drop`, s);

    // ---- the thumb, a few times, where a thumb would wander
    if ((s.leg === 'cruise' || s.leg === 'homeCruise') && inLeg > 12 && !done.has(`${s.leg}-thumb`)) {
      done.add(`${s.leg}-thumb`);
      console.log(wall(), 'thumb: the camera, right and held 2 s, then up');
      await drag(70, 0, 2000);
      if (shots) await page.screenshot({ path: join(out, `${n}-${s.leg}-thumb.png`) });
      await drag(0, -60, 800);
    }
    if (s.leg === 'orbit' && inLeg > 8 && !done.has('orbit-thumb1')) {
      done.add('orbit-thumb1');
      console.log(wall(), 'thumb: the bus, right 3 s');
      await drag(70, 0, 3000);
      if (shots) await page.screenshot({ path: join(out, `${n}-orbit-steer.png`) });
    }
    if (s.leg === 'orbit' && inLeg > 14 && !done.has('orbit-thumb2')) {
      done.add('orbit-thumb2');
      console.log(wall(), 'thumb: the bus, left 3 s');
      await drag(-70, 0, 3000);
    }

    // ---- TURBO, when the label asks. In orbit, a look round first
    const wait = s.leg === 'orbit' ? 24 : 1.5;
    if (prompt.startsWith('TAP TURBO') && heard > wait) {
      if (s.leg === 'wait' && s.trips >= trips) break;
      console.log(wall(), `TURBO (the screen says ${prompt})`);
      if (s.leg === 'wait') {
        trip = s.trips + 1;
        done.clear();
      }
      await tap();
      asked = '';
      await page.waitForTimeout(300);
    }
    if (Date.now() - t0 > 1500000) {
      console.log('GAVE UP, still on', JSON.stringify(s));
      bad++;
      break;
    }
    await page.waitForTimeout(120);
  }
  const end = await read();
  await shoot(`${trip}z-home`, end);
  console.log(wall(), 'home:', JSON.stringify(end));
  const tripLog = await page.evaluate(() => window.__game.moon.trip.log);
  for (const l of tripLog) console.log(`  ${l.at.toFixed(1).padStart(7)} ${l.s.toFixed(1).padStart(6)} s ${String(Math.round(l.km)).padStart(7)} km ${l.leg}`);
  console.log('stats:', JSON.stringify(await page.evaluate(() => window.__stats)));

  // ---- what moved between two frames, on screen, in game px
  const rec = await page.evaluate(() => window.__rec);
  writeFileSync(join(out, 'frames.json'), JSON.stringify(rec));
  const COL = { ms: 0, clock: 1, leg: 2, gear: 3, v: 4, hE: 5, hM: 6, hfov: 7, f: 8, ex: 9, mx: 12, sx: 15, eR: 18, mR: 19, seen: 20 };
  const on = (r, i) => {
    const z = -r[i + 2];
    return z > 0.05 ? [(r[i] / z) * r[COL.f], (-r[i + 1] / z) * r[COL.f]] : null;
  };
  const worst = new Map();
  const note = (leg, k, v, clock) => {
    const w = worst.get(leg) ?? {};
    if (!(w[k]?.[0] >= v)) w[k] = [+v.toFixed(2), +clock.toFixed(1)];
    worst.set(leg, w);
  };
  let longest = 0, slow = 0;
  for (let i = 1; i < rec.length; i++) {
    const a = rec[i - 1], b = rec[i];
    longest = Math.max(longest, b[COL.ms]);
    if (b[COL.ms] > 50) slow++;
    const leg = b[COL.leg];
    // per 1/60 s, so a slow frame on this laptop doesn't read as a jump
    const k = Math.max(1, b[COL.ms] / 16.7);
    for (const [name, c, r] of [['earth', COL.ex, COL.eR], ['moon', COL.mx, COL.mR]]) {
      const p = on(a, c), q = on(b, c);
      if (p && q && Math.abs(q[0]) < 400 && Math.abs(q[1]) < 600) note(leg, `${name}Px`, Math.hypot(q[0] - p[0], q[1] - p[1]) / k, b[COL.clock]);
      const s0 = Math.tan(a[r]) * a[COL.f], s1 = Math.tan(b[r]) * b[COL.f];
      if (s1 > 3 && s1 < 2000) note(leg, `${name}Size`, Math.abs(s1 / s0 - 1) * 100 / k, b[COL.clock]);
    }
    note(leg, 'lens', Math.abs(b[COL.hfov] - a[COL.hfov]) / k, b[COL.clock]);
  }
  console.log(`frames ${rec.length}, longest ${longest} ms, ${slow} over 50 ms. Worst step a 60th of a second, by leg: the body's centre on screen (game px), its size (%), the lens (deg)`);
  for (const [leg, w] of worst) console.log(`  ${leg.padEnd(11)} ${Object.entries(w).map(([k, v]) => `${k} ${v[0]} @${v[1]}`).join('  ')}`);
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
