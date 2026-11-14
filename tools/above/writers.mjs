#!/usr/bin/env node
// Release A, 1a (docs/specs/world/ABOVE.md, ABOVE-BUILT.md): every way paint is written, over a painted coarse region, with the region's paint mask.
//   node tools/above/writers.mjs <base url> <out dir> [--q=rmask=0] [--steps=swap,tap,comet,bomb,boom,falls,lob,curb,dive,reload,reset] [--noref]
// Downtown, its paint laid once (600 settled blasts within 1,400 m) and read at load, the bus held 1.2 km up in Cruise, 60 degrees down, so every region
// in view is coarse. Each step writes paint one way, then the city settles and the step is checked:
//   swap    a Bomb III's crater on the bus's own region, and the bus taken down to the roofs 0.3 s into its wave, so its region turns detailed while the
//           crater draws, then back up: its tiles' arrays must equal a second page's (the same, held at 1.2 km: no swap) byte for byte (--noref: not run)
//   tap     a tap (the real input's onTap: the aimer, the splat, the blast)
//   comet   a tap in Nonstop: the Comet
//   bomb    a Bomb III's crater on the least painted coarse region within 1.6 km
//   boom    Sonic Boom's flick into Turbo 3 at Turbo 2, 150 m up (&boom): its ring
//   falls   a tap on a Financial District tower's roof (&falls): its runs and its pool
//   lob     the Lob from the roofs by real touches (a pull held in the lane, the thumb lifted, a tap), then the climb to 1.2 km: its paint turns coarse
//   curb    Curb's dabs (its own hook, the game's dab: a lane of them) at the street, then the climb: they turn coarse
//   dive    to the roofs and back: every tile's array as before, and the read back
//   reload  the paint saved and read at a new page's load at 1.2 km
//   reset   storage cleared and the page loaded again (a page of its own, nothing in its storage): no paint anywhere
// After each: every region mask read back equals its tiles' arrays; no tile's own ground drawn in a coarse region; no region ground made again (the
// steps that change the level of detail on purpose, swap, lob, curb and dive, may remake them); the paint's texels grew where the step writes; no
// program made after ready; no page error. A frame from above is kept for each step (<out>/<step>.png). Exit 1 if any check fails.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from '../browser.mjs';
import { openPv } from './pvpage.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base, out] = pos;
mkdirSync(out, { recursive: true });
const STEPS = (opt.steps ?? 'swap,tap,comet,bomb,boom,falls,lob,curb,dive,reload,reset').split(',');
const view = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true };
const base0 = ['lat=37.788&lon=-122.4075&heading=45', 'skipintro', 'nohud', 'fixeddt=0.05', 't=2026-11-13T20:00:00Z', 'rate=0', 'sky=off', 'boom', 'falls', 'life', opt.q ?? ''].filter(Boolean);
const url = `${base}?${base0.join('&')}`;
const browser = await chromium.launch(browserOptions([]));
const R = { url, steps: {} };
let bad = 0;
const fail = (why) => (bad++, console.log(`FAIL ${why}`));

// the paint laid once on a page of its own and saved, read at load by every page here
const seeder = await browser.newPage(view);
await seeder.goto(url, { waitUntil: 'load' });
await seeder.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 300000 });
const saved = await seeder.evaluate(() => {
  const g = window.__game, f = g.flight, o = g.city.manifest.origin, k = Math.PI / 180;
  const lat = o[0] - f.z / (k * 6378137), lon = o[1] + f.x / (k * 6378137 * Math.cos(o[0] * k));
  const tiles = g.seedGround(600, lat, lon, 1400);
  g.city.ground.persist();
  return { tiles, entries: Object.entries(localStorage) };
});
await seeder.close();
console.log(`seeded 600 blasts within 1400 m: ${saved.tiles} tiles, ${saved.entries.length} entries in storage`);

/** A page with the saved paint, its home where the bus starts, its in-page checks in window.__wr */
const stand = async (entries) => {
  const pv = await openPv(browser, view, url, entries);
  await pv.page.evaluate(() => {
    const g = window.__game, c = g.city, gp = c.ground, A = window.__pv, f = g.flight;
    A.home = { x: f.x, z: f.z, heading: f.heading };
    const coarse = (key) => {
      const [tx, tz] = key.split(',').map(Number);
      return c.regionLod.get(`${Math.floor(tx / c.regionSize)},${Math.floor(tz / c.regionSize)}`) === 1;
    };
    const fnv = (d) => {
      let h = 2166136261;
      for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619);
      return h >>> 0;
    };
    window.__wr = {
      /** painted texels in every mask's array, those in coarse regions' tiles, and each tile's (its count, its array hashed, whether it's coarse) */
      painted: () => {
        let all = 0, inCoarse = 0;
        const byKey = {};
        for (const [key, m] of gp.masks) {
          let n = 0;
          for (let i = 0; i < m.data.length; i += 4) if (m.data[i] >= 128) n++;
          all += n;
          const co = coarse(key);
          if (co) inCoarse += n;
          byKey[key] = [n, fnv(m.data), co];
        }
        return { all, inCoarse, byKey };
      },
      /** each tile's array, hashed */
      hashes: () => Object.fromEntries([...gp.masks].map(([k, m]) => [k, fnv(m.data)])),
      coarse,
    };
  });
  return pv;
};

/** a frame drawn with the hooks on: its ground draws by kind, the read back, what's painted */
const look = async (pv, name) => {
  const { page } = pv;
  await page.evaluate(() => ((window.__pv.frames = []), (window.__pv.on = true)));
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res)))));
  const st = await page.evaluate(() => {
    const A = window.__pv, f = A.frames[A.frames.length - 1] ?? {};
    A.on = false;
    return { calls: f.calls, tris: f.tris, ownCoarse: f.ownCoarse, regionGround: f.regionGround, readBack: A.readBack(), painted: window.__wr.painted(), rebuilds: A.rebuilds, programs: window.__game.pipeline.renderer.info.programs.length };
  });
  if (name) await page.screenshot({ path: `${out}/${name}.png` });
  return st;
};

const strip = (x) => ({ ...x, painted: { all: x.painted.all, inCoarse: x.painted.inCoarse } });
/** the step's checks against the look before it */
const checked = (name, a, b, { rebuildsOk = false, grows = true, extra = {} } = {}) => {
  const rb = b.rebuilds - a.rebuilds;
  // (the tiles loaded before and after whose arrays the step changed, coarse after it: a step over paint already there may paint no new texel)
  let changed = 0;
  for (const [k, v] of Object.entries(b.painted.byKey)) if (v[2] && a.painted.byKey[k] && a.painted.byKey[k][1] !== v[1]) changed++;
  const rec = { before: strip(a), after: strip(b), rebuilds: rb, grew: b.painted.all - a.painted.all, changedCoarseTiles: changed, ...extra };
  R.steps[name] = rec;
  console.log(`${name}: painted texels ${a.painted.all} -> ${b.painted.all} (in coarse regions ${a.painted.inCoarse} -> ${b.painted.inCoarse}), coarse tiles changed ${changed} | read back ${b.readBack.regions} regions ${b.readBack.slots} slots, ${b.readBack.diff} bytes differ | own grounds in coarse ${b.ownCoarse} | region grounds made again ${rb} | ${b.calls} draws | programs ${b.programs} ${JSON.stringify(extra)}`);
  if (b.readBack.diff) fail(`${name}: a region mask differs from its tiles' arrays by ${b.readBack.diff} bytes`);
  if (!b.readBack.regions) fail(`${name}: no region mask read back`);
  if (b.ownCoarse) fail(`${name}: ${b.ownCoarse} draws of tiles' own ground in coarse regions`);
  if (rb && !rebuildsOk) fail(`${name}: ${rb} region grounds made again`);
  if (grows && !changed) fail(`${name}: no coarse tile's array changed`);
  if (b.programs !== a.programs) fail(`${name}: programs ${a.programs} -> ${b.programs}`);
};

const up = async (pv) => {
  await pv.pinAt('1200', 60);
  await pv.run(1);
  await pv.settle();
  await pv.run(0.5);
  await pv.settle();
};
/** a Bomb III's crater at (x, z) through the splat's own path (as tools/above/paintview.mjs --blast has it) */
const bomb3 = (pv, at) =>
  pv.page.evaluate((at) => {
    const g = window.__game, S = g.config.splat, B = g.config.bomb;
    const d = Math.min(S.dropMax, 600), radius = S.blastRadius * (1 + ((S.dropGain300 - 1) * d) / 300) * B.radius3;
    g.forceReady();
    g.splatter.barf(at.x, at.z, { radius, width: B.width3, jump: B.jump3, hitStop: 0 });
    return Math.round(radius);
  }, at);

const pv = await stand(saved.entries);
const { page } = pv;
const programs0 = await page.evaluate(() => window.__pv.programs0);
await up(pv);
let prev = await look(pv, 'load');
console.log(`load: saved paint read at 1.2 km: ${prev.painted.all} painted texels (${prev.painted.inCoarse} in coarse regions), read back ${prev.readBack.regions} regions, ${prev.readBack.diff} bytes differ; programs at ready ${programs0}`);
if (prev.readBack.diff || !prev.readBack.regions || !prev.painted.inCoarse) fail('load: the saved paint is not in the region masks as its tiles have it');
const cdp = await page.context().newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id ?? 1, radiusX: 8, radiusY: 8, force: 1 })) });

for (const step of STEPS) {
  const a = prev;
  if (step === 'swap') {
    // (the bus's own region: coarse at 1.2 km, detailed at the roofs)
    const home = await page.evaluate(() => window.__pv.home);
    const r = await bomb3(pv, home);
    await pv.run(0.3);
    await pv.pinAt('roofs', null);
    await pv.run(4);
    await pv.settle();
    const atRoofs = await page.evaluate(() => {
      const c = window.__game.city, H = window.__pv.home, rs = c.regionSize * c.manifest.tileSize;
      return c.regionLod.get(`${Math.floor(H.x / rs)},${Math.floor(H.z / rs)}`);
    });
    await up(pv);
    const b = await look(pv, step);
    const hashes = await page.evaluate(() => window.__wr.hashes());
    R.swapHashes = hashes;
    checked(step, a, b, { rebuildsOk: true, extra: { radius: r, homeRegionLodAtRoofs: atRoofs } });
    if (atRoofs !== 0) fail(`swap: the bus's region did not turn detailed at the roofs (lod ${atRoofs})`);
    prev = b;
    continue;
  }
  if (step === 'tap' || step === 'comet') {
    const plan = await page.evaluate((comet) => {
      const g = window.__game, T = g.controls.turbo;
      if (comet) T.arrive(2);
      g.forceReady();
      return comet ? !!g.cometState().plan : true;
    }, step === 'comet');
    await pv.run(0.3);
    const n0 = await page.evaluate(() => window.__game.cometState().fired);
    await page.evaluate(() => window.__game.tapSplat());
    await pv.run(4);
    const info = await page.evaluate(() => {
      const g = window.__game, T = g.controls.turbo, s = g.cometState(), l = g.lastShot();
      const gear = T.name;
      while (T.gear > 0) T.shift(-1, g.flight);
      return { gear, fired: s.fired, last: l?.comet ? 'comet' : l ? 'splat' : null, miss: !!l?.miss };
    });
    await pv.settle();
    const b = await look(pv, step);
    checked(step, a, b, { extra: { plan, ...info, comets: info.fired - n0 } });
    if (step === 'comet' && !(info.fired > n0)) fail('comet: no Comet fired');
    prev = b;
    continue;
  }
  if (step === 'bomb') {
    const aim = await page.evaluate(() => {
      const g = window.__game, c = g.city, gp = c.ground, H = window.__pv.home, ts = c.manifest.tileSize, rs = c.regionSize;
      let best = null;
      for (const [key, lod] of c.regionLod) {
        if (lod !== 1) continue;
        const [rx, rz] = key.split(',').map(Number);
        let painted = 0;
        for (let tz = rz * rs; tz < (rz + 1) * rs; tz++) for (let tx = rx * rs; tx < (rx + 1) * rs; tx++) if (gp.has(tx, tz) || gp.store.has(`${tx},${tz}`)) painted++;
        const x = (rx + 0.5) * rs * ts, z = (rz + 0.5) * rs * ts, d = Math.hypot(x - H.x, z - H.z);
        if (d > 1600) continue;
        if (!best || painted < best.painted || (painted === best.painted && d < best.d)) best = { key, x, z, d: Math.round(d), painted };
      }
      return best;
    });
    if (!aim) {
      fail('bomb: no coarse region within 1.6 km');
      continue;
    }
    const r = await bomb3(pv, aim);
    await pv.run(4);
    await pv.settle();
    const b = await look(pv, step);
    checked(step, a, b, { extra: { radius: r, aim } });
    prev = b;
    continue;
  }
  if (step === 'boom') {
    // (150 m up, 1.1 km short of home along the heading, at Turbo 2's 720 m/s; the flick into Turbo 3 through the Boom's own call, the bus flying on)
    const s0 = await page.evaluate(() => {
      const g = window.__game, H = window.__pv.home, f = g.flight, fx = Math.sin(H.heading), fz = -Math.cos(H.heading);
      const x = H.x - fx * 1100, z = H.z - fz * 1100, y = g.city.groundAt(x, z) + 150;
      window.__qa.pin = null;
      window.__pv.pitch = null;
      Object.assign(f, { x, z, heading: H.heading, y, holdY: -Infinity, targetY: y, vy: 0, mode: 0, speed: 720 });
      g.controls.turbo.arrive(3, 2);
      return { ...g.boomState().stats };
    });
    await pv.run(0.2);
    const plan = await page.evaluate(() => {
      const g = window.__game, p = g.boom.flick(g.flight, 720);
      return p ? { kind: p.kind, x: Math.round(p.x), z: Math.round(p.z), r: Math.round(p.r), coarse: window.__wr.coarse(`${Math.floor(p.x / g.city.manifest.tileSize)},${Math.floor(p.z / g.city.manifest.tileSize)}`) } : null;
    });
    await pv.run(4.2);
    const s1 = await page.evaluate(() => {
      const g = window.__game, T = g.controls.turbo;
      while (T.gear > 0) T.shift(-1, g.flight);
      g.flight.speed = 0;
      return { ...g.boomState().stats };
    });
    // (the ring lands about 3.5 km on, past the seeded square, where no tile had paint: seen from 1.2 km over it, its tiles hold it; then home again)
    let ring = null;
    if (plan) {
      await page.evaluate((p) => {
        const A = window.__pv;
        A.away = A.home;
        A.home = { x: p.x, z: p.z, heading: A.home.heading };
      }, plan);
      await up(pv);
      const at = await look(pv, 'boom-ring');
      ring = await page.evaluate((p) => {
        const g = window.__game, gp = g.city.ground, ts = g.city.manifest.tileSize, R = p.r * 1.3;
        let painted = 0, tiles = 0, coarse = 0;
        for (const [key, m] of gp.masks) {
          const [tx, tz] = key.split(',').map(Number);
          if ((tx + 1) * ts < p.x - R || tx * ts > p.x + R || (tz + 1) * ts < p.z - R || tz * ts > p.z + R) continue;
          tiles++;
          if (window.__wr.coarse(key)) coarse++;
          for (let i = 0; i < m.data.length; i += 4) if (m.data[i] >= 128) painted++;
        }
        window.__pv.home = window.__pv.away;
        return { tiles, coarse, painted };
      }, plan);
      ring.readBack = at.readBack.diff;
      ring.ownCoarse = at.ownCoarse;
      if (!ring.painted || !ring.coarse || at.readBack.diff || at.ownCoarse) fail(`boom: the ring's tiles from 1.2 km: ${JSON.stringify(ring)}`);
    }
    await up(pv);
    const b = await look(pv, step);
    checked(step, a, b, { rebuildsOk: true, grows: false, extra: { plan, rings: s1.rings - s0.rings, ring } });
    if (!(s1.rings > s0.rings)) fail('boom: no ring barfed');
    prev = b;
    continue;
  }
  if (step === 'falls') {
    const p0 = await page.evaluate(() => window.__game.falls.stats.pours);
    const t = await page.evaluate(() => {
      const g = window.__game, c = g.city, o = c.manifest.origin, k = Math.PI / 180;
      // (a Financial District tower: 37.7946, -122.3999, by seedGround's own map)
      const cx = (-122.3999 - o[1]) * k * 6378137 * Math.cos(o[0] * k), cz = -(37.7946 - o[0]) * k * 6378137;
      const all = c.buildingsWithin(cx, cz, 700, []).map((n) => n.ref).filter((r) => r.stableId >= 0 && r.roofY - r.baseY > 60 && c.roofAtPart(r, r.cx, r.cz, Infinity) - r.baseY > 45);
      const out = [];
      for (const r of all.slice(0, 3)) {
        g.forceReady();
        g.splatter.barf(r.cx, r.cz, { target: r, drop: 60, hitStop: 0 });
        out.push(r.index);
      }
      return out;
    });
    await pv.run(5);
    await pv.settle();
    const pours = (await page.evaluate(() => window.__game.falls.stats.pours)) - p0;
    const b = await look(pv, step);
    checked(step, a, b, { extra: { towers: t, pours } });
    if (!pours) fail('falls: no tower poured');
    prev = b;
    continue;
  }
  if (step === 'lob') {
    // (at the roofs over home: the pull, the lift, the tap, as tools/warmcheck.mjs --lob throws it)
    await pv.pinAt('roofs', null);
    await pv.run(1);
    await pv.settle();
    const l0 = await page.evaluate(() => {
      window.__qa.pin = null;
      window.__game.forceReady();
      return window.__game.lobState().stats?.lobs ?? window.__game.lobState().lobs;
    });
    await pv.run(0.3);
    await touch('touchStart', [[196, 690, 1]]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[196, 690 + i * 10, 1]]);
    await pv.run(1.8);
    await touch('touchEnd', []);
    await pv.run(0.1);
    await touch('touchStart', [[300, 300, 2]]);
    await touch('touchEnd', []);
    await pv.run(4);
    const l1 = await page.evaluate(() => window.__game.lobState().stats?.lobs ?? window.__game.lobState().lobs);
    await up(pv);
    const b = await look(pv, step);
    checked(step, a, b, { rebuildsOk: true, extra: { lobs: [l0, l1] } });
    if (!(l1 > l0)) fail(`lob: no Lob thrown (${l0} -> ${l1})`);
    prev = b;
    continue;
  }
  if (step === 'curb') {
    // (Curb's own hook, the game's dab: a lane of 60 dabs every 3 m along the heading from home, at the street; then the climb)
    await pv.pinAt('roofs', null);
    await pv.run(1);
    await pv.settle();
    const n = await page.evaluate(() => {
      const g = window.__game, H = window.__pv.home, fx = Math.sin(H.heading), fz = -Math.cos(H.heading), cf = g.curb;
      if (!cf?.hooks?.dab) return -1;
      for (let k = 0; k < 60; k++) cf.hooks.dab(H.x + fx * k * 3 + fz * 6, H.z + fz * k * 3 - fx * 6, H.x, H.z);
      return 60;
    });
    await pv.run(0.5);
    await up(pv);
    const b = await look(pv, step);
    checked(step, a, b, { rebuildsOk: true, extra: { dabs: n } });
    if (n < 0) fail('curb: no Curb on this page (?life)');
    prev = b;
    continue;
  }
  if (step === 'dive') {
    const h0 = await page.evaluate(() => window.__wr.hashes());
    await pv.pinAt('roofs', null);
    await pv.run(1);
    await pv.settle();
    const low = await look(pv, `${step}-roofs`);
    await up(pv);
    const b = await look(pv, step);
    const h1 = await page.evaluate(() => window.__wr.hashes());
    let changed = 0;
    for (const k of Object.keys(h0)) if (h1[k] !== undefined && h1[k] !== h0[k]) changed++;
    checked(step, a, b, { rebuildsOk: true, grows: false, extra: { changedTiles: changed, tilesBefore: Object.keys(h0).length, tilesAfter: Object.keys(h1).length, roofsDraws: low.calls } });
    if (changed) fail(`dive: ${changed} tiles' arrays changed across the dive and climb`);
    if (b.painted.all !== a.painted.all) fail(`dive: painted texels ${a.painted.all} -> ${b.painted.all}`);
    prev = b;
    continue;
  }
  if (step === 'reload' || step === 'reset') {
    const entries = step === 'reload' ? await page.evaluate(() => (window.__game.city.ground.persist(), Object.entries(localStorage))) : [];
    const pv2 = await stand(entries.length ? entries : null);
    await up(pv2);
    const b = await look(pv2, step);
    const rec = { before: strip(a), after: strip(b) };
    R.steps[step] = rec;
    console.log(`${step}: painted texels ${a.painted.all} -> ${b.painted.all} (in coarse regions ${b.painted.inCoarse}) | read back ${b.readBack.regions} regions ${b.readBack.slots} slots, ${b.readBack.diff} bytes differ | own grounds in coarse ${b.ownCoarse} | programs ${b.programs} | page errors ${pv2.errors}`);
    if (b.readBack.diff) fail(`${step}: a region mask differs from its tiles' arrays by ${b.readBack.diff} bytes`);
    if (b.ownCoarse) fail(`${step}: ${b.ownCoarse} draws of tiles' own ground in coarse regions`);
    if (pv2.errors) fail(`${step}: ${pv2.errors} page errors`);
    // (the saved code is 5 bits: within 1 %)
    if (step === 'reload') {
      // (over the tiles loaded on both pages: where the old page had more loaded, its paint is saved, not shown)
      let pa = 0, pb = 0, both = 0, onlyOld = 0, onlyNew = 0;
      for (const [k, v] of Object.entries(a.painted.byKey)) if (b.painted.byKey[k]) (both++, (pa += v[0]), (pb += b.painted.byKey[k][0])); else onlyOld += v[0] ? 1 : 0;
      for (const [k, v] of Object.entries(b.painted.byKey)) if (!a.painted.byKey[k] && v[0]) onlyNew++;
      rec.common = { tiles: both, before: pa, after: pb, paintedTilesOnlyBefore: onlyOld, paintedTilesOnlyAfter: onlyNew };
      console.log(`reload: on the ${both} tiles loaded on both pages, painted texels ${pa} -> ${pb}; painted tiles loaded only before ${onlyOld}, only after ${onlyNew}`);
      if (Math.abs(pb - pa) > pa * 0.01) fail(`reload: painted texels on the tiles loaded on both pages ${pa} -> ${pb}`);
    }
    if (step === 'reset' && (b.painted.all || b.readBack.painted)) fail(`reset: paint after the reset (${b.painted.all} texels, ${b.readBack.painted} read back)`);
    await pv2.page.close();
    continue;
  }
  fail(`no step ${step}`);
}
const programsEnd = await page.evaluate(() => window.__game.pipeline.renderer.info.programs.length);
if (programsEnd !== programs0) fail(`programs ${programs0} at ready, ${programsEnd} at the end`);
if (pv.errors) fail(`${pv.errors} page errors`);
await page.close();

// the swap's reference: the same paint and the same crater on a page held at 1.2 km, no swap: its tiles' arrays byte for byte
if (STEPS.includes('swap') && !('noref' in opt)) {
  const rf = await stand(saved.entries);
  await up(rf);
  const home = await rf.page.evaluate(() => window.__pv.home);
  await bomb3(rf, home);
  await rf.run(4.3);
  await rf.settle();
  await up(rf);
  const h = await rf.page.evaluate(() => window.__wr.hashes());
  let same = 0, differ = 0, missing = 0;
  for (const [k, v] of Object.entries(h)) {
    const w = R.swapHashes?.[k];
    if (w === undefined) missing++;
    else if (w === v) same++;
    else differ++;
  }
  R.swapRef = { same, differ, missing };
  console.log(`swap against a page with no swap: tiles equal ${same}, differ ${differ}, not loaded on the swapped page ${missing}`);
  if (differ || !same) fail(`swap: ${differ} tiles' arrays differ from the same crater with no swap`);
  await rf.page.close();
}
writeFileSync(`${out}/writers.json`, JSON.stringify(R, null, 1));
await browser.close();
console.log(bad ? `WRITERS FAILED: ${bad}` : 'writers: passed');
process.exit(bad ? 1 : 0);
