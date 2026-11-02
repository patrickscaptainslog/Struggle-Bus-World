#!/usr/bin/env node
// A first-timer flies ?moonrun: node tools/sky/moon-live.mjs <out dir> [--g5=6000] [--t=2026-11-25T04:00:00Z] [--dt=0] [--trips=1] [--w=402] [--h=874] [--dsf=1] [--shots=1] [--q=fps]
// Real frame loop, real clock, real touches, and it does only what the screen says: the top right corner is read off the label, and TURBO is tapped when the label asks and not before, a beat after it asks.
// The thumb is a real drag on the canvas: in the long dark each way (the camera), and on both sides in orbit (the bus). --dt=0.05 holds the frame loop's step there, so a fast laptop flies it faster than life:
// that's for repeat flights; the clock numbers are the same. --thumbat=25: when the thumb wanders in the long dark, seconds into the leg. --tab: the down tab in orbit, and TURBO back up.
// --paint=6: in orbit, a real tap on the ground each time the breath is loaded, each on the paint of the last when that's still ahead of the bus, and the look back on the way home is shot at 13,000 and 100,000 km.
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
const thumbAt = Number(opt('thumbat', 12)), tab = args.includes('--tab'), paint = Number(opt('paint', 0));
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
      return { leg: tr.leg, gear: tr.gear, clock: +tr.clock.toFixed(1), v: Math.round(tr.v), hE: Math.round(tr.hEarth), hM: Math.round(tr.hMoon), lens: +m.view.hfov.toFixed(1), trips: tr.trips, target: m.view.target, moonOff: s.moon[2] < 0 ? +(Math.hypot(s.moon[0], s.moon[1]) / -s.moon[2] * f / 196).toFixed(2) : 9, earthPx: Math.round(2 * Math.tan(s.earthR) * f), moonPx: Math.round(2 * Math.tan(s.moonR) * f), say: document.querySelector('[data-hud="trip-label"]')?.dataset.say ?? '', moonLit: +s.moonLit.toFixed(3), earthLit: +s.earthLit.toFixed(3), sunSeen: +s.sunSeen.toFixed(2) };
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
      if (s.earthPx <= 220) await shoot(`${n}f-view-leaves`, s);
      if (s.target === 1 && s.moonOff < 0.5) await shoot(`${n}g-moon-ahead`, s);
      if (s.moonPx >= 24) await shoot(`${n}h-moon-24`, s);
    }
    if (s.leg === 'in') {
      await shoot(`${n}i-in`, s);
      for (const px of [60, 120, 250, 402, 700, 1000, 1400]) if (s.moonPx >= px) await shoot(`${n}j-moon-${String(px).padStart(4, '0')}`, s);
      for (const [km, name] of [[1700, '1700'], [800, '0800'], [500, '0500']]) if (s.hM <= km) await shoot(`${n}k-pull-${name}`, s);
    }
    if (s.leg === 'orbit') await shoot(`${n}o-orbit`, s);
    // ---- home
    if (s.leg === 'leave') await shoot(`${n}p-leave`, s);
    if (s.leg === 'homeOut') await shoot(`${n}q-home-out`, s);
    if (s.leg === 'homeCruise') {
      await shoot(`${n}r-home-g5`, s);
      if (s.earthPx >= 60) await shoot(`${n}s-earth-60`, s);
    }
    if (s.leg === 'homeIn' || s.leg === 'homeLevel' || s.leg === 'homeDrop') {
      await shoot(`${n}t-home-in`, s);
      for (const px of [120, 250, 402, 700, 1000, 2000]) if (s.earthPx >= px) await shoot(`${n}u-earth-${String(px).padStart(4, '0')}`, s);
    }
    if (s.leg === 'homeLevel') await shoot(`${n}x-level`, s);
    if (s.leg === 'homeDrop') await shoot(`${n}y-drop`, s);

    // ---- the thumb, a few times, where a thumb would wander
    if ((s.leg === 'cruise' || s.leg === 'homeCruise') && inLeg > thumbAt && !done.has(`${s.leg}-thumb`)) {
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

    // ---- paint: what a first-timer does once it says so
    if (paint && s.leg === 'orbit' && inLeg > 3) {
      const b = await page.evaluate(() => {
        const m = window.__game.moon, br = m.breath, l = br.paint.strokes.at(-1);
        return { loaded: br.loaded, shots: br.stats.shots, last: l ? br.screenOf(l.lat, l.lon) : null, painted: +(br.paint.painted * 100).toFixed(3), level: l?.level ?? 0 };
      });
      if (b.loaded && b.shots < paint) {
        const ahead = b.last && b.last.y < 560 && b.level < 3;
        const x = ahead ? b.last.x : 196, y = ahead ? b.last.y : 420;
        console.log(wall(), `tap ${b.shots + 1} at ${Math.round(x)}, ${Math.round(y)}${ahead ? ' (on the paint)' : ''}: ${b.painted} % so far, the screen says ${s.say.split('|').slice(3).join(' ')}`);
        await page.touchscreen.tap(x, y);
        await page.waitForTimeout(200);
        const after = await page.evaluate(() => {
          const br = window.__game.moon.breath, l = br.paint.strokes.at(-1);
          return { tap: br.lastTap, on: l ? br.screenOf(l.lat, l.lon) : null, level: l?.level };
        });
        console.log(wall(), `  landing place at ${Math.round(after.on.x)}, ${Math.round(after.on.y)} on the screen, level ${after.level}`);
        if (b.shots + 1 === paint) await shoot(`${n}o-painted`, s);
      }
    }
    if (paint && s.leg === 'homeOut' || (paint && s.leg === 'homeCruise')) {
      if (s.hM >= 13000) await shoot(`${n}q-paint-13000`, s);
      // the thumb swings the camera back round to the Moon, as the label says it may: past about 75,000 km the law is looking at Earth
      if (s.hM >= 76000 && !done.has('look-back')) {
        done.add('look-back');
        const moonAt = () => page.evaluate(() => {
          const v = window.__game.moon.sky.moon, f = 1 / window.__game.pipeline.pixelWorldSize(1);
          return { z: v[2], x: v[2] < 0 ? (v[0] / -v[2]) * f : 1e4 * Math.sign(v[0] || 1), y: v[2] < 0 ? (v[1] / -v[2]) * f : 0, hM: window.__game.moon.trip.hMoon };
        });
        await touch('touchStart', 200, 560);
        let dx = 60, dy = 0, m;
        for (let i = 0; i < 80; i++) {
          m = await moonAt();
          dx = Math.abs(m.x) > 900 ? (m.x > 0 ? 70 : -70) : Math.max(-70, Math.min(70, m.x * 0.5));
          dy = m.z < 0 ? Math.max(-70, Math.min(70, -m.y * 0.5)) : 0;
          await touch('touchMove', 200 + dx, 560 + dy);
          await page.waitForTimeout(60);
          if (m.z < 0 && Math.hypot(m.x, m.y) < 40) break;
        }
        console.log(wall(), 'look back:', JSON.stringify(m));
        await shoot(`${n}q-paint-look-back`, await read());
        await touch('touchEnd');
      }
    }

    if (tab && s.leg === 'orbit' && inLeg > 19 && !done.has('orbit-tab')) {
      done.add('orbit-tab');
      const b = await page.locator('[data-hud="gear-down"]').boundingBox();
      console.log(wall(), 'the down tab');
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(400);
      console.log(wall(), JSON.stringify(await read()));
    }

    // ---- TURBO, when the label asks. In orbit, a look round first
    const wait = s.leg === 'orbit' ? (done.has('orbit-tab') ? 3 : paint ? 24 + paint * 3 : 24) : 1.5;
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
  console.log('ground:', JSON.stringify(await page.evaluate(() => window.__game.moon.draw.ground)));
  console.log('names:', (await page.evaluate(() => window.__game.moon.names.log)).map((n) => `${n.name} ${Math.round(n.h)}`).join(', '));

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
