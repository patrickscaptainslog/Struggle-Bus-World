#!/usr/bin/env node
// Trees on a tile's edge, back after a reload. The bake keeps a tree's spot in decimetres from its tile's corner, so a tree a few centimetres short of
// the next tile is kept on the seam itself and stands on the next tile's ground (46 of San Francisco's 120,545 trees, 11 of them on a region's edge).
// Saved ground paint under one must paint it again on the next visit, whichever tile's paint is shown first.
//   node tools/treeseam.mjs <url> <outdir>            exit 0: the tree painted; 1: it stayed grey on painted ground; 2: the run could not set it up
//   node tools/treeseam.mjs <url> <outdir> --level    a tree whose nearest house (within 25 m) is on the next tile: its level after a reload with its
//                                                     own tile shown first, and with the house's: exit 1 when they differ (a report: see NOTE)
//   node tools/treeseam.mjs <url> <outdir> --cost     a report: saved paint over the Sunset, a reload there, every onTileReady's time
// The tree: of those on a region's edge (found here in the city's region files), the one nearest the Sunset's houses. The order: one region is
// loaded and its paint shown while the next, across the edge, is past the loading circle (1500 m from the bus at street height); then the bus
// moves up to the edge and that region comes in. Every flight towards a region's edge loads them in this order (regions come nearest first,
// inside the circle): the run only holds the bus still at each end, under __qa.pin.
// (1) a visit at the tree: breaths at it through the real splat pipeline (barfAtLatLon), the tree painted by its blast, the paint saved
// (2) a reload (same storage) 495 m short of the tree's region, looking along the edge: the tree's tile's paint shown, the other region not
// loaded (else exit 2); then the bus 200 m short of the edge: the other tile's paint shown
// (3) 1.5 s on: the tree on painted ground and painted; and every tree within 1500 m on painted ground painted (__game.paintedAt)
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { browserOptions } from './browser.mjs';
import { parseBuildingTile, parseTerrainTile } from '../src/world/tiles.ts';
import { localToLatLon } from '../src/game/geo.ts';

const [url = 'http://127.0.0.1:4173/', out = 'shots/tmp/treeseam'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const LEVEL = process.argv.includes('--level'), COST = process.argv.includes('--cost');
mkdirSync(out, { recursive: true });
const T = '&t=2026-11-07T00:22:00Z&rate=0';
const HOUSES = [-6530, 2483]; // the Sunset's houses (local m), where the grey tree was first seen
const near = (a, b) => Math.hypot(a.x - HOUSES[0], a.z - HOUSES[1]) - Math.hypot(b.x - HOUSES[0], b.z - HOUSES[1]);

// the city's region files: each tile's trees (and, for --level, its buildings' rings)
const dir = new URL('../public/city/sf/', import.meta.url);
const city = JSON.parse(readFileSync(new URL('city.json', dir), 'utf8'));
const TS = city.tileSize, RS = city.regionSize;
const treesOf = new Map(), housesOf = new Map();
for (const f of readdirSync(dir).filter((f) => /^r_-?\d+_-?\d+\.bin$/.test(f))) {
  let b = readFileSync(new URL(f, dir));
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const dv = new DataView(buf);
  for (let i = 0, n = dv.getUint32(4, true); i < n; i++) {
    const o = 8 + i * 24;
    const tx = dv.getInt32(o, true), tz = dv.getInt32(o + 4, true), bOff = dv.getUint32(o + 8, true), bLen = dv.getUint32(o + 12, true);
    const tOff = dv.getUint32(o + 16, true), tLen = dv.getUint32(o + 20, true);
    if (tLen) treesOf.set(`${tx},${tz}`, parseTerrainTile(buf.slice(tOff, tOff + tLen), city.classN).trees);
    if (LEVEL && bLen) housesOf.set(`${tx},${tz}`, parseBuildingTile(buf.slice(bOff, bOff + bLen)));
  }
}
const regionOf = (t) => [Math.floor(t[0] / RS), Math.floor(t[1] / RS)];
/** one axis only, across a region's edge: the axis and the way from a to b */
const edge = (a, b) => {
  if ((a[0] !== b[0]) === (a[1] !== b[1])) return null;
  const ax = a[0] !== b[0] ? 0 : 1;
  return regionOf(a)[ax] !== regionOf(b)[ax] && Math.abs(a[ax] - b[ax]) === 1 ? { ax, dir: Math.sign(b[ax] - a[ax]) } : null;
};
let S = null;
if (!LEVEL) {
  const seams = [];
  let all = 0, strays = 0;
  for (const [k, trees] of treesOf) {
    const l = k.split(',').map(Number);
    for (const t of trees) {
      all++;
      const s = [Math.floor(t.x / TS), Math.floor(t.z / TS)];
      if (s[0] === l[0] && s[1] === l[1]) continue;
      strays++;
      const e = edge(l, s);
      if (e) seams.push({ list: l, other: s, x: t.x, z: t.z, ...e });
    }
  }
  console.log(`trees ${all}, on another tile than their list's ${strays}, across a region's edge on one axis ${seams.length}`);
  S = seams.sort(near)[0];
} else {
  // a tree within 25 m of its tile's edge whose nearest building (by its ring's corners, within 25 m) is on the next tile, across a region's edge
  const cands = [];
  for (const [k, trees] of treesOf) {
    const l = k.split(',').map(Number);
    for (const t of trees) {
      const lx = t.x - l[0] * TS, lz = t.z - l[1] * TS;
      if (Math.min(lx, lz, TS - lx, TS - lz) > 25) continue;
      let best = 25, bt = null;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const h = housesOf.get(`${l[0] + dx},${l[1] + dz}`);
          if (h)
            for (let v = 0; v < h.xz.length; v += 2) {
              const d = Math.hypot(h.xz[v] - t.x, h.xz[v + 1] - t.z);
              if (d < best) [best, bt] = [d, [l[0] + dx, l[1] + dz, h.xz[v], h.xz[v + 1]]];
            }
        }
      const e = bt && edge(l, bt);
      if (e && best < 6) cands.push({ list: l, other: [bt[0], bt[1]], x: t.x, z: t.z, hx: bt[2], hz: bt[3], ...e });
    }
  }
  console.log(`trees within 6 m of a house on the next tile, across a region's edge: ${cands.length}`);
  S = cands.sort(near)[0];
}
if (!S) {
  console.log('FAIL (set-up): no tree to try');
  process.exit(2);
}
const key = (t) => `${t[0]},${t[1]}`;
const ll = (p) => localToLatLon(p[0], p[1], city.origin);
const [tLat, tLon] = ll([S.x, S.z]);
console.log(`the tree: in ${key(S.list)}'s list at ${S.x}, ${S.z} (${tLat.toFixed(6)}, ${tLon.toFixed(6)}), ${LEVEL ? `its nearest house on ${key(S.other)} at ${S.hx.toFixed(1)}, ${S.hz.toFixed(1)}` : `standing on ${key(S.other)}`}`);
/** the start spot and the move for an approach from tile `from`'s side (its region loads first): heading along the edge at the start (the
 *  streaming's look-ahead then keeps its distance to both regions), towards it at the move (fx = sin h, fz = -cos h) */
const approach = (from, way) => {
  const ax = S.ax, along = ax === 0 ? S.x : S.z;
  const r0 = Math.floor(from[ax] / RS) * RS * TS;
  const far = way > 0 ? r0 : r0 + RS * TS;
  const at = (a) => (ax === 0 ? [a, S.z] : [S.x, a]);
  return { P0: at(far - way * 495), P1: at(along - way * 200), H0: ax === 0 ? 0 : Math.PI / 2, H1: ax === 0 ? (way > 0 ? Math.PI / 2 : -Math.PI / 2) : way > 0 ? Math.PI : 0 };
};

// every page: the ground's ready tiles in order (the two tiles'), each with whether the other had ground paint then; and each call's time (--cost)
const INIT = ([lk, sk]) => {
  let game;
  window.__ready = [];
  window.__readyMs = [];
  Object.defineProperty(window, '__game', {
    configurable: true,
    get: () => game,
    set(v) {
      game = v;
      const g = v.city.ground, on = g.onTileReady;
      g.onTileReady = (tx, tz) => {
        const t0 = performance.now();
        on?.(tx, tz);
        window.__readyMs.push(performance.now() - t0);
        const k = `${tx},${tz}`;
        if (k === lk || k === sk) {
          const [ox, oz] = (k === lk ? sk : lk).split(',').map(Number);
          window.__ready.push({ k, other: g.has(ox, oz) });
        }
      };
    },
  });
};
const fails = [];
const ok = (c, m) => (c ? console.log(`ok: ${m}`) : (fails.push(m), console.log(`FAIL: ${m}`)));
const errors = [];
const browser = await chromium.launch(browserOptions([]));
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
await ctx.addInitScript(INIT, [key(S.list), key(S.other)]);
const page = await ctx.newPage();
page.on('pageerror', (e) => (errors.push(e.message), console.log('[pageerror]', e.message)));
const until = (cond, arg, s = 120) => page.waitForFunction(cond, arg, { timeout: s * 1000, polling: 50 });
const go = (p, h) => {
  const [la, lo] = ll(p);
  return page.goto(url + `?lat=${la}&lon=${lo}&heading=${(h * 180) / Math.PI}${T}`, { waitUntil: 'domcontentloaded', timeout: 400000 });
};
const trees = (p, r) => page.evaluate(([x, z, r]) => window.__game.paintedAt(x, z, r), [p[0], p[1], r]);
/** the tree's level (treesAt: a build without it gives null) */
const level = () => page.evaluate(([x, z]) => window.__game.treesAt?.(x, z, 0.5)?.[0]?.level ?? null, [S.x, S.z]);
class Setup extends Error {}
/** a reload from `first`'s side: its tile's paint shown with the other region out of reach, then the bus up to the edge and the other's shown */
async function reload(first, second, way) {
  const A = approach(first, way);
  await go(A.P0, A.H0);
  await until(() => window.__game?.flight, null, 400);
  const y = await page.evaluate(() => window.__game.flight.y);
  await page.evaluate(([x, y, z, h]) => (window.__qa = { ...(window.__qa ?? {}), pin: { x, y, z, heading: h } }), [A.P0[0], y, A.P0[1], A.H0]);
  await until((k) => window.__ready.some((r) => r.k === k), key(first), 400);
  const r0 = await page.evaluate(() => window.__ready.slice());
  const otherIn = await page.evaluate((k) => window.__game.city.tiles.has(k), key(second));
  console.log(`  start ${A.P0.map(Math.round)}: ready ${JSON.stringify(r0)}; ${key(second)} loaded: ${otherIn}`);
  if (otherIn || r0.some((r) => r.k === key(second)) || r0[0].other) throw new Setup(`${key(second)} came in with ${key(first)}: not the order this run needs`);
  await page.waitForTimeout(1500);
  await page.evaluate(([x, y, z, h]) => (window.__qa.pin = { x, y, z, heading: h }), [A.P1[0], y, A.P1[1], A.H1]);
  await until((k) => window.__ready.some((r) => r.k === k) && window.__game.city.tiles.has(k), key(second), 400);
  console.log(`  moved to ${A.P1.map(Math.round)}: ready ${JSON.stringify(await page.evaluate(() => window.__ready.map((r) => r.k)))}`);
  await page.waitForTimeout(1500);
}

let code = 0;
try {
  if (COST) {
    // (a report, no pass line): 60 settled blasts within 700 m of the Sunset's houses (seedGround, saved), a reload there, and every
    // onTileReady's time over the 12 s after the city's first tile (performance.now: 0.1 ms steps without cross-origin isolation)
    await go(HOUSES, Math.PI / 2);
    await until(() => window.__game?.city?.tiles?.size > 20, null, 400);
    const [hl, ho] = ll(HOUSES);
    const saved = await page.evaluate(([la, lo]) => window.__game.seedGround(60, la, lo, 700), [hl, ho]);
    await go(HOUSES, Math.PI / 2);
    await until(() => window.__game?.city?.tiles?.size > 0, null, 400);
    await page.waitForTimeout(12000);
    const ms = await page.evaluate(() => window.__readyMs);
    const sorted = ms.slice().sort((a, b) => b - a);
    const tr = await trees(HOUSES, 1500);
    console.log(`cost: saved tiles ${saved}; onTileReady calls ${ms.length}, worst ${sorted[0]?.toFixed(2)} ms, next ${sorted.slice(1, 4).map((v) => v.toFixed(2)).join(', ')}, all ${ms.reduce((a, b) => a + b, 0).toFixed(2)} ms`);
    console.log(`cost: within 1500 m of the houses: trees on painted ground ${tr.treesOnPaint}, of them grey ${tr.treesGrey}`);
    writeFileSync(`${out}/cost.json`, JSON.stringify({ saved, ms, trees: tr }));
    code = errors.length ? 1 : 0;
  } else {
    // (1) the visit that paints
    await go([S.x, S.z], Math.PI / 2);
    await until(([a, b]) => window.__game?.city?.tiles?.has(a) && window.__game.city.tiles.has(b), [key(S.list), key(S.other)], 400);
    await page.waitForTimeout(1500);
    const before = await trees([S.x, S.z], 2);
    if (before.treesOnPaint) throw new Setup(`the tree on painted ground before any breath (${JSON.stringify(before)}): storage not fresh`);
    // (--level: three breaths at the house, so it climbs above the level every reload gives a tree at least)
    const aims = LEVEL ? [[S.hx, S.hz], [S.hx, S.hz], [S.hx, S.hz]] : [[S.x, S.z]];
    for (const a of aims) {
      const [la, lo] = ll(a);
      const impact = await page.evaluate(([la, lo]) => window.__game.barfAtLatLon(la, lo), [la, lo]);
      await until((t) => window.__game.clock() > t + 2, impact, 60);
    }
    const painted = await trees([S.x, S.z], 2);
    const house = LEVEL ? await page.evaluate(([x, z]) => { const c = window.__game.city, b = c.nearestBuilding(x, z, 25); return b ? { level: c.paint.level(b.index), cx: b.cx, cz: b.cz } : null; }, [S.x, S.z]) : null;
    console.log(`after the visit: ${JSON.stringify(painted)}${LEVEL ? `; the tree's level ${await level()}, its nearest house ${JSON.stringify(house)}` : ''}`);
    if (painted.treesOnPaint < 1 || painted.paintedTrees < 1) throw new Setup('the visit did not paint the ground under the tree, or the tree');
    await page.evaluate(() => (window.__game.city.ground.persist(), window.__game.city.paint.persist()));
    await page.waitForTimeout(500);
    if (!LEVEL) {
      // (2) the reload, the tree's tile first; (3) the count
      await reload(S.list, S.other, S.dir);
      const t = await trees([S.x, S.z], 2);
      const wide = await trees(approach(S.list, S.dir).P1, 1500);
      console.log(`the tree: ${JSON.stringify(t)}`);
      console.log(`within 1500 m: trees on painted ground ${wide.treesOnPaint}, of them grey ${wide.treesGrey}`);
      ok(t.treesOnPaint >= 1, 'the tree stands on painted ground after the reload');
      ok(t.treesGrey === 0, `the tree on the seam (in ${key(S.list)}'s list, on ${key(S.other)}) painted after the reload`);
      ok(wide.treesGrey === 0, `no tree within 1500 m grey on painted ground (${wide.treesGrey})`);
    } else {
      // the tree's level after a reload from the house's side, then from its own
      console.log('from the house\'s side:');
      await reload(S.other, S.list, -S.dir);
      const fromHouse = await level();
      console.log('from the tree\'s side:');
      await reload(S.list, S.other, S.dir);
      const fromTree = await level();
      console.log(`level: the tree ${fromHouse} with the house's tile shown first, ${fromTree} with its own first (the house ${house?.level})`);
      ok(fromHouse !== null && fromHouse === fromTree, 'the tree comes back at one level whichever tile is shown first');
    }
    ok(!errors.length, `no page error (${errors.length})`);
    code = fails.length ? 1 : 0;
  }
} catch (e) {
  console.log(`FAIL (set-up): ${e.message.split('\n')[0]}`);
  code = 2;
}
writeFileSync(`${out}/treeseam${LEVEL ? '-level' : ''}.json`, JSON.stringify({ tree: S, fails, errors }, null, 1));
await browser.close();
console.log(code === 0 ? 'treeseam: passed' : code === 1 ? `treeseam: FAILED ${fails.length}: ${fails.join('; ')}` : 'treeseam: could not set up');
process.exit(code);
