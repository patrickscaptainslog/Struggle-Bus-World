#!/usr/bin/env node
// A mover takes paint (CONTRACT.md section 3; L5), at a fixed step on the street under ?life: node tools/life/paint.mjs <out dir>. BASE is the page.
//   aim       a ray straight at a plane finds it, and the aim's answer is where it will be when the breath gets there
//   hit       a breath's hit takes at its impact, not before: grey until then, then the breath's hue at level 1; a second hit goes up a level and keeps the hue
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
  const url = `${BASE}?life&nohud&skipintro&fixeddt=0.033333&t=2026-11-05T17:30:00Z&lat=37.7955&lon=-122.3937`;
  const open = async (first) => {
    if (first) await page.goto(url, { waitUntil: 'load', timeout: 180000 });
    else await page.reload({ waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 600000, polling: 500 });
    await frames(40);
  };
  await open(true);
  // (a plane in the snapshot: its key, where it is now, its velocity)
  const plane = () => page.evaluate(() => {
    const l = window.__game.life, s = l.snap, rows = s.rows, u32 = s.rowsU32, n = s.u32[2], dt = (l.utc - s.f64[0]) / 1000;
    for (let i = 0; i < n; i++) {
      const o = i * 16, key = l.keys.get(u32[o]);
      if (!key) continue;
      return { key, x: rows[o + 2] + rows[o + 5] * dt, y: rows[o + 3] + rows[o + 6] * dt, z: rows[o + 4] + rows[o + 7] * dt, vx: rows[o + 5], vy: rows[o + 6], vz: rows[o + 7], size: rows[o + 11] };
    }
    return null;
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
      const fresh = l.hit(key, 2, Date.parse('2026-11-05T17:30:00Z'), now + 1);
      return { fresh, before: l.painted.has(window.__game.life.keyHash(key)) };
    }, p.key);
    await frames(40);
    const after = await page.evaluate((key) => window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, p.key);
    const again = await page.evaluate((key) => window.__game.life.hit(key, 5, Date.parse('2026-11-05T17:30:00Z'), window.__game.clock() + 0.2), p.key);
    await frames(20);
    const twice = await page.evaluate((key) => window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, p.key);
    row('hit: grey until the impact, then its hue at level 1; again, level 2 and the same hue', r.fresh && !r.before && after?.hue === 2 && after.level === 1 && !again && twice?.hue === 2 && twice.level === 2, { ...r, after, again, twice });
  }
  {
    // (the bus 1.5 km behind another plane, at its height, nose along its track: a real tap)
    const q = await plane();
    const others = await page.evaluate(() => {
      const l = window.__game.life, s = l.snap, out = [];
      for (let i = 0; i < s.u32[2]; i++) out.push(l.keys.get(s.rowsU32[i * 16]));
      return out;
    });
    const target = await page.evaluate((keys) => {
      const l = window.__game.life, s = l.snap, rows = s.rows, dt = (l.utc - s.f64[0]) / 1000;
      for (let i = 0; i < s.u32[2]; i++) {
        const o = i * 16, key = l.keys.get(s.rowsU32[o]);
        if (!key || l.painted.has(s.rowsU32[o])) continue;
        return { key, x: rows[o + 2] + rows[o + 5] * dt, y: rows[o + 3], z: rows[o + 4] + rows[o + 7] * dt, vx: rows[o + 5], vz: rows[o + 7] };
      }
      return null;
    }, others);
    let tapped = null;
    if (target) {
      tapped = await page.evaluate((t) => {
        const g = window.__game, f = g.flight, sp = Math.hypot(t.vx, t.vz) || 1, ux = t.vx / sp, uz = t.vz / sp;
        f.x = t.x - ux * 600;
        f.z = t.z - uz * 600;
        f.y = t.y;
        f.heading = Math.atan2(ux, -uz);
        f.nose = 0;
        return { at: [Math.round(f.x), Math.round(f.y), Math.round(f.z)], key: t.key };
      }, target);
      await frames(2);
      const glinting = await page.evaluate(() => window.__game.controls.glinting);
      await page.evaluate(() => window.__game.tapSplat());
      await frames(90);
      const got = await page.evaluate((key) => ({ painted: window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, hits: window.__game.life.qa.hits }), target.key);
      tapped = { ...tapped, glinting, ...got };
    }
    row('tap: the bus behind a plane, nose on it: a real tap paints it', !!tapped && tapped.glinting && !!tapped.painted && tapped.painted.level >= 1, tapped);
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
