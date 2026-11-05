#!/usr/bin/env node
// A mover takes paint (CONTRACT.md section 3; L5), at a fixed step on the street under ?life: node tools/life/paint.mjs <out dir>. BASE is the page.
//   aim       a ray straight at a plane finds it, and the aim's answer is where it will be when the breath gets there
//   hit       a breath's hit takes at its impact, not before: grey until then, then the breath's hue at level 1; a second hit goes up a level and keeps the hue
//   contrail  the painted plane streams a ribbon of its paint behind it (O6)
//   tap       the bus put behind a plane with its nose on it: a real tap's breath paints it, and nothing under it
//   kept      the page again at the same moment: the plane is still painted, from the test store, and the real store has nothing
// Exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv[2] ?? 'shots/tmp/life-paint';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(76)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => (window.__qa = { holdFrames: 4, held: false }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 300)));
  const frames = async (n) => {
    await page.evaluate((k) => (window.__qa = { ...window.__qa, holdFrames: k, held: false }), n);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 600000, polling: 50 });
  };
  // (a moment a scripted plane crosses the city at 5.8 km, so the bus can be put behind it over the map: a breath has no aim past the map's reach, where the bus can't be)
  const T = '2026-11-05T18:22:20Z';
  const url = `${BASE}?life&nohud&skipintro&fixeddt=0.033333&t=${T}&lat=37.7955&lon=-122.3937`;
  const open = async (first) => {
    if (first) await page.goto(url, { waitUntil: 'load', timeout: 180000 });
    else await page.reload({ waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 600000, polling: 500 });
    await frames(40);
  };
  await open(true);
  // (a plane in the snapshot, the farthest from the map's middle, so the nearest is left grey for the tap: its key, where it is now, its velocity)
  const plane = () => page.evaluate(() => {
    const l = window.__game.life, s = l.snap, rows = s.rows, u32 = s.rowsU32, n = s.u32[2], dt = (l.utc - s.f64[0]) / 1000;
    let best = null;
    for (let i = 0; i < n; i++) {
      const o = i * 16, key = l.keys.get(u32[o]);
      if (!key) continue;
      const p = { key, x: rows[o + 2] + rows[o + 5] * dt, y: rows[o + 3] + rows[o + 6] * dt, z: rows[o + 4] + rows[o + 7] * dt, vx: rows[o + 5], vy: rows[o + 6], vz: rows[o + 7], size: rows[o + 11] };
      if (!best || Math.hypot(p.x, p.z) > Math.hypot(best.x, best.z)) best = p;
    }
    return best;
  });
  const p = await plane();
  row('a plane in the sky with its key', !!p, p);
  {
    // (a ray from 2 km behind it, straight at where it is, the breath 2 s on the way)
    const got = await page.evaluate((p) => {
      const l = window.__game.life, sp = Math.hypot(p.vx, p.vz) || 1, ox = p.x - (p.vx / sp) * 2000, oz = p.z - (p.vz / sp) * 2000;
      const t = l.aim(ox, p.y, oz, p.x - ox, 0, p.z - oz, 30, 2);
      return t ? { key: t.key, x: Math.round(t.x), y: Math.round(t.y), z: Math.round(t.z), arrive: +(t.arrive - window.__game.clock()).toFixed(2) } : null;
    }, p);
    const ahead = got ? Math.hypot(got.x - p.x, got.z - p.z) : -1;
    row('aim: a ray at it finds it, where it will be when the breath arrives', !!got && got.key === p.key && got.arrive > 0.5 && ahead > 50, { ...got, ahead: Math.round(ahead) });
  }
  {
    const r = await page.evaluate((key) => {
      const l = window.__game.life, g = window.__game, now = g.clock();
      const fresh = l.hit(key, 2, window.__game.life.utc, now + 1);
      return { fresh, before: l.painted.has(window.__game.life.keyHash(key)) };
    }, p.key);
    await frames(40);
    const after = await page.evaluate((key) => window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, p.key);
    const again = await page.evaluate((key) => window.__game.life.hit(key, 5, window.__game.life.utc, window.__game.clock() + 0.2), p.key);
    await frames(20);
    const twice = await page.evaluate((key) => window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, p.key);
    row('hit: grey until the impact, then its hue at level 1; again, level 2 and the same hue', r.fresh && !r.before && after?.hue === 2 && after.level === 1 && !again && twice?.hue === 2 && twice.level === 2, { ...r, after, again, twice });
  }
  {
    // (O6: the painted plane's ribbon, the only one: its paint's ramp, solid at the plane and its far end the oldest, laid back along the plane's path)
    const k = await page.evaluate((key) => {
      const l = window.__game.life, K = l.pools.marks, g = window.__game, s = l.snap, h = l.keyHash(key);
      let behind = null;
      for (let i = 0; i < s.u32[2]; i++)
        if (s.rowsU32[i * 16] === h) {
          const o = i * 16;
          // (its far end against its near one, along the plane's way: a far plane's ribbon is drawn nearer the lens, which keeps that sign)
          const e = 22 * 3, tx = (K.pos[e] + K.pos[e + 3]) / 2, tz = (K.pos[e + 2] + K.pos[e + 5]) / 2, sx = (K.pos[0] + K.pos[3]) / 2, sz = (K.pos[2] + K.pos[5]) / 2;
          behind = Math.round((tx - sx) * s.rows[o + 5] + (tz - sz) * s.rows[o + 7]);
        }
      return { marks: l.qa.marks, ramp: K.ramp[0], want: g.HUE_RAMPS[l.painted.get(h)?.hue ?? 0], age0: K.age[0], ageEnd: K.age[23], behind };
    }, p.key);
    row('contrail: the painted plane streams its paint behind it, solid at the plane, the far end the oldest', k.marks === 1 && k.ramp === k.want && k.age0 === 0 && k.ageEnd === 1 && k.behind < 0, k);
  }
  {
    // (the bus 1.5 km behind another plane, at its height, nose along its track: a real tap)
    const q = await plane();
    const others = await page.evaluate(() => {
      const l = window.__game.life, s = l.snap, out = [];
      for (let i = 0; i < s.u32[2]; i++) out.push(l.keys.get(s.rowsU32[i * 16]));
      return out;
    });
    // (the unpainted plane nearest the map's middle)
    const target = await page.evaluate((keys) => {
      const l = window.__game.life, s = l.snap, rows = s.rows, dt = (l.utc - s.f64[0]) / 1000;
      let best = null;
      for (let i = 0; i < s.u32[2]; i++) {
        const o = i * 16, key = l.keys.get(s.rowsU32[o]);
        if (!key || l.painted.has(s.rowsU32[o])) continue;
        const p = { key, x: rows[o + 2] + rows[o + 5] * dt, y: rows[o + 3], z: rows[o + 4] + rows[o + 7] * dt, vx: rows[o + 5], vz: rows[o + 7] };
        if (!best || Math.hypot(p.x, p.z) < Math.hypot(best.x, best.z)) best = p;
      }
      return best;
    }, others);
    let tapped = null;
    if (target) {
      // (held level behind it, as a player flying after a plane holds the nose on it: let go, the bus here noses down and slows while the plane draws away at 170 m/s)
      tapped = await page.evaluate((t) => {
        const sp = Math.hypot(t.vx, t.vz) || 1, ux = t.vx / sp, uz = t.vz / sp;
        const pin = { x: t.x - ux * 600, y: t.y, z: t.z - uz * 600, heading: Math.atan2(ux, -uz), nose: 0 };
        window.__qa.pin = pin;
        return { at: [Math.round(pin.x), Math.round(pin.y), Math.round(pin.z)], key: t.key };
      }, target);
      await frames(2);
      const glint = await page.evaluate(() => window.__game.life.glintKey);
      await page.evaluate(() => window.__game.tapSplat());
      await page.evaluate(() => delete window.__qa.pin);
      await frames(90);
      const got = await page.evaluate((key) => ({ painted: window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, hits: window.__game.life.qa.hits }), target.key);
      tapped = { ...tapped, glint, ...got };
    }
    row('tap: the bus behind a plane, nose on it: the plane glints, and a real tap paints it', !!tapped && tapped.glint === tapped.key && !!tapped.painted && tapped.painted.level >= 1, tapped);
  }
  await page.screenshot({ path: join(dir, 'painted.png') });
  await frames(30);
  await open(false);
  await frames(30);
  const kept = await page.evaluate((key) => ({ painted: window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null }), p.key);
  const real = await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('strugglebus.life.v1');
    r.onupgradeneeded = () => r.result.createObjectStore('paint', { keyPath: 'key' });
    r.onsuccess = () => {
      const q = r.result.transaction('paint').objectStore('paint').count();
      q.onsuccess = () => ok(q.result);
      q.onerror = () => ok(-1);
    };
    r.onerror = () => ok(-2);
  }));
  row('kept: the page again, the plane still painted, from the test store; the real store empty', kept.painted?.hue === 2 && real === 0, { ...kept, realStore: real });
} catch (e) {
  bad++;
  console.log('FAIL ', e.message);
} finally {
  row('no page errors', !errors.length, errors.slice(0, 5));
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
