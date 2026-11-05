#!/usr/bin/env node
// Open-ground paint on the Moon is kept by where it is (src/world/GeoPaint.ts, GroundPaint.useGeo), at a fixed step: node tools/moon/keep.mjs <out dir> [--q=site=TYCHO] [--runs=N] [--short]
//   kept     a blast on open ground ahead of the bus is painted, and kept by its place on the Moon
//   reload   the page again, a new session on a new map at the same place: the paint is where it was, by latitude and longitude
//   heavy    200 breaths over one patch, and the page again: all of it back, two frames after its tiles came in, each with its paint on (the second review's P1 and P2)
//   slide    the map slid, a blast painted after it, and the page again: it's where it was, not a slide's 131 km off
//   new map  the map made again round the bus, as ?moonland's high pass makes it: the paint near the bus is still there
//   one name a page started 25 km off, ?moon&lat=&lon=, and ?moonland: the same store, and on the first the paint where the bus reaches it
// The first account's review, 2026-11-04: kept by tile of a map that slides, the paint came back 131 km off, could overwrite older paint, and a new map wiped it. The third, 2026-11-05: the
// store was named by the page's start place, and the new-map row failed once in four. --runs=N runs it all N times in one browser, a new context each, and counts the runs each row passed.
// --short runs only what leads up to the new map. BASE is the page (http://localhost:4179/). A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const dir = args.find((a) => !a.startsWith('--')) ?? 'shots/tmp/moon-keep';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const DT = 1 / 30, D = 131072 / 2;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const tally = new Map();
const row = (name, ok, got) => {
  if (!ok) bad++;
  const t = tally.get(name) ?? [0, 0];
  tally.set(name, [t[0] + (ok ? 1 : 0), t[1] + 1]);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(76)} ${JSON.stringify(got)}`);
};
const RUNS = Math.max(1, Number(opt.runs ?? 1)), SHORT = !!opt.short;
for (let run = 0; run < RUNS; run++) {
  if (RUNS > 1) console.log(`---- run ${run + 1} of ${RUNS}`);
  const errors = [];
  let ctx = null;
  try {
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => (window.__qa = { holdFrames: 4, held: false }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
    const url = `${BASE}?moon&nohud&fixeddt=${DT.toFixed(6)}&${opt.q ?? 'site=TYCHO'}`;
    const frames = async (n) => {
      await page.evaluate((k) => (window.__qa = { holdFrames: k, held: false }), n);
      await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 600000, polling: 50 });
    };
    const open = async (first) => {
      if (first) await page.goto(url, { waitUntil: 'load', timeout: 180000 });
      else await page.reload({ waitUntil: 'load', timeout: 180000 });
      await page.waitForFunction(() => !!window.__game?.city && window.__game.city.loadedRegionCount() > 0 && window.__qa?.held === true, null, { timeout: 600000, polling: 500 });
      await frames(150);
    };
    /** A blast on open ground ahead of the bus, and where it is on the Moon */
    const blast = async () => {
      const at = await page.evaluate(() => {
        const g = window.__game, f = g.flight, x = f.x + f.fx * 90, z = f.z + f.fz * 90, o = [0, 0];
        g.splatter.barf(x, z, { drop: 25 });
        g.city.ground.geo.toLatLon(x, z, o);
        return { x, z, lat: o[0], lon: o[1] };
      });
      await frames(60);
      return at;
    };
    /** The ground paint at a place on the Moon, on the map as it is now */
    const paintAt = (lat, lon) => page.evaluate(([la, lo]) => {
      const g = window.__game.city.ground, o = [0, 0];
      g.geo.toXZ(la, lo, o);
      const s = g.sample(o[0], o[1]);
      return { x: Math.round(o[0]), z: Math.round(o[1]), cov: s ? +s.cov.toFixed(2) : 0, hue: s?.hue ?? -1, kept: g.geoCount };
    }, [lat, lon]);
    /** The pictures in the page's store (IndexedDB), by their keys */
    const storedPics = () => page.evaluate(() => new Promise((ok) => {
      const r = indexedDB.open('strugglebus.moonpaint');
      r.onsuccess = () => {
        try {
          const q = r.result.transaction('meta').objectStore('meta').getAllKeys();
          q.onsuccess = () => {
            ok(q.result.length);
            r.result.close();
          };
          q.onerror = () => ok(-1);
        } catch {
          ok(-2);
        }
      };
      r.onerror = () => ok(-3);
    }));
    /** after a new page or map, until the tiles round the place have come in and drawn what they kept */
    const settle = async (lat, lon) => {
      let p = await paintAt(lat, lon);
      for (let i = 0; i < 40 && p.cov < 0.5; i++) {
        await frames(15);
        p = await paintAt(lat, lon);
      }
      return p;
    };

    // (--short: only what leads up to the new map, as the third review saw it fail: a page, a slide, a blast and the page again, a blast)
    let a = null;
    if (SHORT) await open(true);
    else {
      // ---- kept
      await open(true);
      a = await blast();
      const a0 = await paintAt(a.lat, a.lon);
      await frames(30);
      const stored = await storedPics();
      row('kept: a blast on open ground is painted, and kept by its place on the Moon', a0.cov >= 0.5 && a0.kept >= 1 && stored >= 1, { at: a, paint: a0, cells: stored });
      await page.screenshot({ path: join(dir, 'kept.png') });

      // ---- reload
      await open(false);
      const a1 = await settle(a.lat, a.lon);
      row('reload: a new session at the same place, and the paint is where it was', a1.cov >= 0.5 && a1.hue === a0.hue, { before: a0, after: a1 });

      // ---- heavy: 200 breaths over a patch 330 by 210 m ahead, as a player who likes a place paints it, and the page again
      const patch = await page.evaluate(() => {
        const g = window.__game, f = g.flight, fx = f.fx, fz = f.fz, cx = f.x + fx * 260, cz = f.z + fz * 260;
        return { cx, cz, ax: fx, az: fz };
      });
      for (let k = 0; k < 200; k++) {
        await page.evaluate(([P, k]) => {
          const g = window.__game, u = (k % 20) / 19 - 0.5, v = Math.floor(k / 20) / 9 - 0.5;
          // (along the way the bus faces 330 m, across it 210)
          g.splatter.barf(P.cx + P.ax * u * 330 - P.az * v * 210, P.cz + P.az * u * 330 + P.ax * v * 210, { drop: 25 });
        }, [patch, k]);
        await frames(2);
      }
      await frames(90);
      // (a grid of places over the patch, and what's painted there)
      const grid = await page.evaluate((P) => {
        const g = window.__game.city.ground, out = [];
        for (let a = 0; a < 40; a++)
          for (let b = 0; b < 25; b++) {
            const u = a / 39 - 0.5, v = b / 24 - 0.5, x = P.cx + P.ax * u * 360 - P.az * v * 240, z = P.cz + P.az * u * 360 + P.ax * v * 240, s = g.sample(x, z), o = [0, 0];
            if (!s || s.cov < 0.5) continue;
            g.geo.toLatLon(x, z, o);
            out.push([o[0], o[1], s.hue]);
          }
        return out;
      }, patch);
      const center = await page.evaluate((P) => { const o = [0, 0]; window.__game.city.ground.geo.toLatLon(P.cx, P.cz, o); return o; }, patch);
      await page.reload({ waitUntil: 'load', timeout: 180000 });
      await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 600000, polling: 500 });
      // (frames until every tile of the patch has come in with its paint, each when its paint's copied out of the pictures, then two more)
      let inAt = -1, firstAt = -1;
      for (let i = 0; i < 400 && inAt < 0; i++) {
        await frames(1);
        const tin = await page.evaluate((G) => {
          const g = window.__game.city.ground, o = [0, 0], ts = window.__game.city.manifest.tileSize, keys = new Set();
          for (const [la, lo] of G) {
            g.geo.toXZ(la, lo, o);
            keys.add(`${Math.floor(o[0] / ts)},${Math.floor(o[1] / ts)}`);
          }
          let n = 0;
          for (const k of keys) if (g.has(...k.split(',').map(Number))) n++;
          return [n, keys.size];
        }, grid);
        if (tin[0] > 0 && firstAt < 0) firstAt = i;
        if (tin[0] === tin[1]) inAt = i;
      }
      await frames(2);
      const back = await page.evaluate((G) => {
        const g = window.__game.city.ground, o = [0, 0];
        let n = 0, hue = 0;
        for (const [la, lo, h] of G) {
          g.geo.toXZ(la, lo, o);
          const s = g.sample(o[0], o[1]);
          if (s && s.cov >= 0.5) {
            n++;
            if (s.hue === h) hue++;
          }
        }
        return { n, hue, of: G.length };
      }, grid);
      await page.screenshot({ path: join(dir, 'heavy.png') });
      row('heavy: 200 breaths over one patch, and the page again: all of it back, two frames after its tiles came in', grid.length > 300 && inAt >= 0 && back.n >= grid.length * 0.99 && back.hue >= grid.length * 0.97, { painted: grid.length, back: back.n, sameHue: back.hue, firstTileAtFrame: firstAt, allTilesAtFrame: inAt });
      await frames(150);
    }

    // ---- slide, then a blast, then the page again
    await page.evaluate((d) => window.__game.slide(d, 0), D);
    await frames(60);
    const b = await blast(), b0 = await paintAt(b.lat, b.lon);
    await open(false);
    const b1 = await settle(b.lat, b.lon);
    row('slide: painted after a slide, and the page again: where it was, by latitude and longitude', b0.cov >= 0.5 && b1.cov >= 0.5 && b1.hue === b0.hue, { at: b, before: b0, after: b1 });

    // ---- a new map round the bus, as ?moonland's high pass makes one
    const c = await blast(), c0 = await paintAt(c.lat, c.lon);
    await page.evaluate(() => {
      // (main.ts's land.world.place, as Landing.moveTo calls it, and the bus at the new map's middle, where it is)
      const g = window.__game, f = g.flight, o = [0, 0];
      g.city.ground.geo.toLatLon(f.x, f.z, o);
      g.city.reloadAll();
      g.city.ground.newMap();
      g.moon.place(o[0], o[1], Date.now());
      f.x = 0;
      f.z = 0;
    });
    await frames(30);
    const c1 = await settle(c.lat, c.lon);
    await page.screenshot({ path: join(dir, 'new-map.png') });
    row('new map: made again round the bus, and the paint near it is still there', c0.cov >= 0.5 && c1.cov >= 0.5 && c1.hue === c0.hue, { at: c, before: c0, after: c1 });

    if (!SHORT) {
      // ---- one name: the first blast's place from a page started 25 km east of it, and ?moonland
      await frames(60);
      const aLast = await paintAt(a.lat, a.lon), n0 = await storedPics();
      const lon25 = a.lon + (25000 / 1737400 / Math.cos((a.lat * Math.PI) / 180)) * (180 / Math.PI);
      await page.goto(`${BASE}?moon&nohud&fixeddt=${DT.toFixed(6)}&lat=${a.lat.toFixed(5)}&lon=${lon25.toFixed(5)}`, { waitUntil: 'load', timeout: 180000 });
      await page.waitForFunction(() => !!window.__game?.city && window.__game.city.loadedRegionCount() > 0 && window.__qa?.held === true, null, { timeout: 600000, polling: 500 });
      await frames(60);
      const n1 = await storedPics();
      // (the bus taken to the place, as if it had flown there: the tiles round it come in, and draw what's kept)
      const there = await page.evaluate(([la, lo]) => {
        const g = window.__game, f = g.flight, o = [0, 0];
        g.city.ground.geo.toXZ(la, lo, o);
        f.x = o[0] - f.fx * 90;
        f.z = o[1] - f.fz * 90;
        return { x: Math.round(o[0]), z: Math.round(o[1]) };
      }, [a.lat, a.lon]);
      await frames(30);
      const a2 = await settle(a.lat, a.lon);
      await page.screenshot({ path: join(dir, 'one-name.png') });
      await page.goto(`${BASE}?moonland&nohud`, { waitUntil: 'load', timeout: 180000 });
      await page.waitForFunction(() => !!window.__space, null, { timeout: 600000, polling: 500 });
      await page.waitForTimeout(3000);
      const n2 = await storedPics();
      row('one name: 25 km off and on ?moonland the same store, and the paint where the bus reaches it', n0 > 0 && n1 >= n0 && n2 >= n0 && a2.cov >= 0.5 && a2.hue === aLast.hue, { pictures: [n0, n1, n2], there, before: aLast, after: a2 });
    }
  } catch (e) {
    bad++;
    console.log('FAIL ', e.message);
  } finally {
    row('no page errors', !errors.length, errors.slice(0, 5));
    await ctx?.close();
  }
}
await browser.close();
if (RUNS > 1) for (const [name, [p, n]] of tally) console.log(`${p === n ? 'pass' : 'FAIL'}  ${p} of ${n}  ${name}`);
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
