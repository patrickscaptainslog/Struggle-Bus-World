#!/usr/bin/env node
// A whole trip, played as a person would, on today's sky unless --t says otherwise: node tools/sky/moon-fresh.mjs <out dir> [--t=now] [--paint=120] [--dt=0] [--trips=2] [--store=1] [--w=393] [--h=852] [--q=]
// Real frame loop, real touches, and it does only what the screen shows: TURBO when the label asks. In orbit it plays for --paint seconds: it taps the paint it can see while that paint is still ahead of the bus, until
// that's level 3, and then taps fresh ground: the middle of the frame, or a little to one side. Every tap is written down: where the finger was, where the place lands on the screen at the tap and at the impact,
// the seconds from tap to impact, the level, how long the frames around it took. On the way home it shoots the look back. Then it reloads the page and flies again, and looks for what it painted.
// Exits 1 if the page threw or the paint didn't come back.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = args.find((a) => !a.startsWith('--'));
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const t = opt('t', 'now'), paintFor = Number(opt('paint', 120)), dt = Number(opt('dt', 0)), trips = Number(opt('trips', 2)), w = Number(opt('w', 393)), h = Number(opt('h', 852)), extra = opt('q', ''), g5 = opt('g5', '6000');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const t0 = Date.now();
const wall = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const say = (...a) => console.log(wall(), ...a);
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const url = `${BASE}?moonrun${t === 'now' ? '' : `&t=${t}`}&g5=${g5}${dt ? `&fixeddt=${dt}` : ''}${extra ? `&${extra}` : ''}`;
const open = async () => {
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text().slice(0, 300)} ${m.location().url}`);
  });
  page.on('pageerror', (e) => {
    bad++;
    console.log('  [pageerror]', e.message);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  // every frame's length, from a loop of its own, with the map's upload counters beside it
  await page.evaluate(() => {
    const rec = (window.__rec = []);
    let last = performance.now();
    const tick = (now) => {
      const b = window.__game.moon.breath;
      rec.push([+(now - last).toFixed(1), b.stats.shots, b.stats.bytes + b.stats.overBytes, Math.round(now)]);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return page;
};

const read = (page) =>
  page.evaluate(() => {
    const m = window.__game.moon, s = m.sky, tr = m.trip, f = 1 / window.__game.pipeline.pixelWorldSize(1), b = m.breath;
    return { leg: tr.leg, gear: tr.gear, clock: +tr.clock.toFixed(1), v: Math.round(tr.v), hE: Math.round(tr.hEarth), hM: Math.round(tr.hMoon), trips: tr.trips, moonPx: Math.round(2 * Math.tan(s.moonR) * f), earthPx: Math.round(2 * Math.tan(s.earthR) * f), say: document.querySelector('[data-hud="trip-label"]')?.dataset.say ?? '', moonLit: +s.moonLit.toFixed(3), loaded: b.loaded, shots: b.stats.shots, denied: b.stats.denied, painted: +(b.paint.painted * 100).toFixed(3), strokes: b.paint.strokes.length, moonDir: [...s.moon] };
  });

const tapLog = [];
async function playOrbit(page, seconds, name) {
  const started = Date.now();
  let turn = 0;
  const scale = dt ? dt * 60 : 1;
  while (((Date.now() - started) / 1000) * scale < seconds) {
    const s = await read(page);
    if (s.leg !== 'orbit') break;
    if (!s.loaded) {
      await page.waitForTimeout(60);
      continue;
    }
    // what a person sees: the last stroke that isn't yet level 3 and is still on the ground ahead of the bus
    const look = await page.evaluate(() => {
      const b = window.__game.moon.breath, S = b.paint.strokes;
      for (let i = S.length - 1; i >= Math.max(0, S.length - 6); i--) {
        const l = S[i], p = b.screenOf(l.lat, l.lon);
        if (p && l.level < 3 && p.y > 240 && p.y < window.innerHeight * 0.68 && p.x > 30 && p.x < window.innerWidth - 30) return { ...p, level: l.level };
      }
      return null;
    });
    turn++;
    const x = look ? look.x : w / 2 + [0, -90, 90, -40, 70][turn % 5], y = look ? look.y : h * [0.5, 0.42, 0.55][turn % 3];
    const before = await read(page);
    const wantLevel = look ? Math.min(3, look.level + 1) : 1;
    await page.touchscreen.tap(x, y);
    const at = Date.now();
    await page.waitForTimeout(40);
    const c = await page.evaluate(() => {
      const b = window.__game.moon.breath, l = b.paint.strokes.at(-1);
      return { shots: b.stats.shots, stroke: l, tap: { ...b.lastTap }, on: l ? b.screenOf(l.lat, l.lon) : null };
    });
    if (c.shots === before.shots) {
      say(`tap ${tapLog.length + 1} at ${Math.round(x)}, ${Math.round(y)}: nothing fired, ${JSON.stringify(c.tap)}`);
      tapLog.push({ x, y, fired: false });
      await page.waitForTimeout(400);
      continue;
    }
    const miss0 = Math.hypot(c.on.x - x, c.on.y - y);
    // wait for the impact: the upload counter moves
    const landed = await page.evaluate(async (shots) => {
      const b = window.__game.moon.breath, l = b.paint.strokes.at(-1), s = performance.now(), u0 = b.stats.uploads;
      while (b.stats.uploads === u0 && performance.now() - s < 4000) await new Promise((r) => requestAnimationFrame(r));
      return { s: (performance.now() - s) / 1000, on: b.screenOf(l.lat, l.lon) };
    }, c.shots);
    const left = Date.now() - at;
    tapLog.push({ x: Math.round(x), y: Math.round(y), fired: true, level: c.stroke.level, wanted: wantLevel, ground: c.tap.ground, miss0: +miss0.toFixed(1), landedS: +(left / 1000).toFixed(2), slid: landed.on ? Math.round(Math.hypot(landed.on.x - x, landed.on.y - y)) : -1 });
    say(`tap ${tapLog.length} at ${Math.round(x)}, ${Math.round(y)}${look ? ' on paint' : ''}: level ${c.stroke.level}${wantLevel !== c.stroke.level ? ` (wanted ${wantLevel})` : ''}, ground ${c.tap.ground}, place ${miss0.toFixed(1)} px from the finger, lands ${(left / 1000).toFixed(2)} s on, ${tapLog.at(-1).slid} px from the finger by then. ${s.say.split('|').slice(3).join(' ')}`);
    if (tapLog.length === 1) await page.screenshot({ path: join(out, `${name}-first-splash-0.png`) });
    if (tapLog.length % 8 === 1) await page.screenshot({ path: join(out, `${name}-tap-${tapLog.length}.png`) });
    await page.waitForTimeout(100);
  }
}

try {
  let page = await open();
  for (let trip = 1; trip <= trips; trip++) {
    const turboBox = await page.locator('[data-hud="turbo"]').boundingBox();
    const tapTurbo = () => page.touchscreen.tap(turboBox.x + turboBox.width / 2, turboBox.y + turboBox.height / 2);
    const start = await read(page);
    const pageTrips = start.trips;
    say(`flight ${trip}: ready, ${start.strokes} strokes, ${start.painted} % painted, says ${start.say}`);
    await page.screenshot({ path: join(out, `t${trip}-00-home.png`) });
    let leg = '', asked = '', askedAt = Date.now(), done = new Set(), played = false;
    const once = async (name, s) => {
      if (done.has(name)) return;
      done.add(name);
      await page.screenshot({ path: join(out, `t${trip}-${name}.png`) });
      say(name, JSON.stringify({ hM: s.hM, hE: s.hE, moonPx: s.moonPx, earthPx: s.earthPx, lit: s.moonLit }));
    };
    for (;;) {
      const s = await read(page);
      const prompt = s.say.split('|')[2] ?? '';
      if (s.leg !== leg) {
        leg = s.leg;
        say(`-> ${leg}`, s.say);
      }
      if (prompt !== asked) {
        asked = prompt;
        askedAt = Date.now();
      }
      if (s.leg === 'orbit' && !played) {
        played = true;
        await page.waitForTimeout(1600 / (dt ? dt * 60 : 1));
        await once('10-orbit', await read(page));
        await playOrbit(page, trip === 1 ? paintFor : Math.min(paintFor, 30), `t${trip}`);
        await once('11-painted', await read(page));
        asked = '';
      }
      if (s.leg === 'homeOut' || s.leg === 'homeCruise' || s.leg === 'homeIn') {
        if (s.hM >= 2000) await once('12-home-2000', s);
        if (s.hM >= 13000) await once('13-home-13000', s);
        if (s.hM >= 100000 && !done.has('14-home-100000')) {
          // the thumb swings the camera round to the Moon, as the label says it may
          const cdp = await page.context().newCDPSession(page);
          const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
          const moonAt = () => page.evaluate(() => {
            const v = window.__game.moon.sky.moon, f = 1 / window.__game.pipeline.pixelWorldSize(1);
            return { z: v[2], x: v[2] < 0 ? (v[0] / -v[2]) * f : 1e4 * Math.sign(v[0] || 1), y: v[2] < 0 ? (v[1] / -v[2]) * f : 0, hM: window.__game.moon.trip.hMoon };
          });
          await touch('touchStart', 200, 560);
          let m;
          for (let i = 0; i < 80; i++) {
            m = await moonAt();
            const dx = Math.abs(m.x) > 900 ? (m.x > 0 ? 70 : -70) : Math.max(-70, Math.min(70, m.x * 0.5)), dy = m.z < 0 ? Math.max(-70, Math.min(70, -m.y * 0.5)) : 0;
            await touch('touchMove', 200 + dx, 560 + dy);
            await page.waitForTimeout(60);
            if (m.z < 0 && Math.hypot(m.x, m.y) < 40) break;
          }
          say('swung back to the Moon:', JSON.stringify(m));
          await once('14-home-100000', await read(page));
          await touch('touchEnd');
        }
      }
      if (s.leg === 'wait' && s.trips > pageTrips) {
        await once('19-home', s);
        break;
      }
      if (prompt.startsWith('TAP TURBO') && (Date.now() - askedAt) * (dt ? dt * 60 : 1) > 1500) {
        say(`TURBO: the screen says ${prompt}`);
        await tapTurbo();
        asked = '';
        await page.waitForTimeout(300);
      }
      if (Date.now() - t0 > 1500000 * trip) {
        say('GAVE UP', JSON.stringify(s));
        bad++;
        break;
      }
      await page.waitForTimeout(120);
    }
    // frames
    const rec = await page.evaluate(() => window.__rec.splice(0));
    writeFileSync(join(out, `frames-${trip}.json`), JSON.stringify(rec));
    const long = rec.filter((r) => r[0] > 50).length;
    const around = [];
    for (let i = 1; i < rec.length; i++) {
      // the frames where an upload went
      if (rec[i][2] !== rec[i - 1][2]) around.push(rec[i][0]);
    }
    around.sort((a, b) => b - a);
    const med = [...rec].map((r) => r[0]).sort((a, b) => a - b)[rec.length >> 1];
    say(`flight ${trip}: ${rec.length} frames, median ${med} ms, ${long} over 50 ms; frames with an upload: ${around.length}, worst ${around.slice(0, 5).join(', ')} ms`);
    const end = await read(page);
    say(`home: ${end.say}`);
    if (trip < trips) {
      // the next flight is a new page
      const painted = end.painted, strokes = end.strokes;
      await page.close();
      page = await open();
      await page.waitForFunction(() => !window.__game.moon.breath.paint.rebuilding, null, { timeout: 20000, polling: 20 });
      const again = await read(page);
      say(`reloaded: ${again.strokes} strokes against ${strokes}, ${again.painted} % against ${painted} %, says ${again.say}`);
      if (again.strokes !== strokes || Math.abs(again.painted - painted) > 0.001) {
        bad++;
        say('FAIL: the paint did not come back');
      }
    }
  }
  const fired = tapLog.filter((a) => a.fired);
  const summary = { taps: tapLog.length, fired: fired.length, l1: fired.filter((a) => a.level === 1).length, l2: fired.filter((a) => a.level === 2).length, l3: fired.filter((a) => a.level === 3).length, wrongLevel: fired.filter((a) => a.level !== a.wanted).length, worstAtTap: Math.max(...fired.map((a) => a.miss0)), worstSlid: Math.max(...fired.map((a) => a.slid)), landS: [Math.min(...fired.map((a) => a.landedS)), Math.max(...fired.map((a) => a.landedS))] };
  console.log('taps:', JSON.stringify(summary));
  writeFileSync(join(out, 'taps.json'), JSON.stringify(tapLog, null, 1));
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
