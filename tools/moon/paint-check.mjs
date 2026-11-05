#!/usr/bin/env node
// The Moon's paint kept by place (src/world/GeoPaint.ts), in Node against the real GroundPaint: node --no-warnings tools/moon/paint-check.mjs [row]
//   pole     a breath and a big blast at 60, 88.9 and 89.9 degrees, at Shackleton (-89.67) and on the pole: the pictures each reaches and makes, its ms, and after a reload its texels back
//   hours    an hour of painting at Jet as play paints, a breath every 2.6 s flying on, then a reload: the first breath's paint there, and the store's size
//   frame    a MEGA from 600 m and a breath land: nothing of their fold on the impact's frame, and the frames after it about 2 ms (95 % under 2.5: the rest is the machine's)
//   tiles    a painted region's 16 tiles ask for their paint at once: the copies spread over frames, under about 4 ms in any one
//   between  a tile that comes in between a blast's impact and the end of its fold shows the blast
//   budget   the store at its budget, then a MEGA over old paint: nothing thrown, and the old paint under it kept
//   near     a tile near the bus, which asks for nothing before it comes: its paint follows it in; its ground made again (a region's change of detail), the paint's on it at once
//   blocked  a store that takes nothing (IndexedDB blocked): 150 breaths flown on, then back to the first: its paint's there, this session's, and what's open stays small
//   quota    a store full at 3 MB, under the budget: the budget comes down to it, the longest untouched go, and the last of the paint is there after a reload
//   old      what builds before this one kept in localStorage, a picture under two pages' names and a list of blasts: moved in once, the two as one, the blast drawn in
// The third review, 2026-11-05 (docs/reviews/earth-pictures-2026-11-04.md): each row its "done". A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const mem = new Map();
globalThis.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { GroundPaint, encodeMask, decodeMask } = await import('../../src/world/GroundPaint.ts');
const { MemoryStore, BUDGET, geoGrid } = await import('../../src/world/GeoPaint.ts');
const { makeFrame, dirOf, latLonToMap, latOf, lonOf } = await import('../../src/moon/map.ts');
const { makeBlastSpec, blastRadiusFor, specToArray } = await import('../../src/game/blastLayout.ts');

const only = process.argv[2];
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(80)} ${JSON.stringify(got)}`);
};
let seed = 99;
const nextSeed = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const tick = () => new Promise((r) => setTimeout(r, 0));
const TS = 256, uni = () => ({ tGround: { value: null }, uGroundOn: { value: 0 } });
const geoAt = (lat0, lon0) => {
  const f = makeFrame(lat0, lon0), d = [0, 0, 0];
  return { toLatLon(x, z, o) { dirOf(f, x, z, d); o[0] = latOf(d); o[1] = lonOf(d); }, toXZ(la, lo, o) { latLonToMap(f, la, lo, d); o[0] = d[0]; o[1] = d[1]; } };
};
/** A page on the Moon, its map centred at (lat0, lon0), its pictures in `rows` (a store outliving the page) */
const page = async (lat0, lon0, rows) => {
  const g = new GroundPaint(TS, 'moon_check', 'rank');
  g.useGeo(geoAt(lat0, lon0), new MemoryStore(rows));
  for (let i = 0; i < 50 && !g.geoPaint.ready; i++) await tick();
  return g;
};
/** frames of the pictures' work, `dt` each, until nothing's pending or `most` frames; the slowest frame, ms */
const frames = async (g, most, dt = 1 / 30) => {
  let worst = 0, n = 0;
  const ms = [];
  for (; n < most; n++) {
    const t0 = performance.now();
    g.geoPaint.work(dt);
    g.work();
    const d = performance.now() - t0;
    ms.push(d);
    worst = Math.max(worst, d);
    await tick();
    if (!g.geoPaint.pending && n > 40) break;
  }
  // (and the 95th of them: Node's collector, or another job on the machine, can stretch one frame of the 2 ms past it)
  ms.sort((a, b) => a - b);
  return { worst: +worst.toFixed(2), p95: +(ms[Math.floor(ms.length * 0.95)] ?? 0).toFixed(2), frames: n };
};
/** every texel painted on the tiles round (x, z), as the live masks have them */
const tilesAround = (x, z, r) => {
  const out = [];
  for (let tz = Math.floor((z - r) / TS); tz <= Math.floor((z + r) / TS); tz++) for (let tx = Math.floor((x - r) / TS); tx <= Math.floor((x + r) / TS); tx++) out.push([tx, tz]);
  return out;
};
const painted = (m) => {
  let n = 0;
  for (let t = 0; t < m.data.length; t += 4) if (m.data[t] >= 128) n++;
  return n;
};
/** the tiles' paint after a reload: asked for, copied out over frames, attached, and held against what they had */
const backOn = async (g, tiles, before) => {
  for (const [tx, tz] of tiles) g.hasSaved(tx, tz);
  for (let i = 0; i < 400 && tiles.some(([tx, tz]) => before.get(`${tx},${tz}`) && !g.hasSaved(tx, tz)); i++) {
    g.geoPaint.work(1 / 30);
    await tick();
  }
  let had = 0, back = 0, hue = 0;
  for (const [tx, tz] of tiles) {
    const was = before.get(`${tx},${tz}`);
    if (!was) continue;
    g.attach(tx, tz, tx * TS, tz * TS, uni());
    const m = g.masks.get(`${tx},${tz}`);
    for (let t = 0; t < was.length; t += 4) {
      if (was[t] < 128) continue;
      had++;
      if (m && m.data[t] >= 128) {
        back++;
        if (m.data[t + 1] >> 5 === was[t + 1] >> 5) hue++;
      }
    }
  }
  return { had, back, hue, backPct: had ? +((100 * back) / had).toFixed(2) : 0, huePct: had ? +((100 * hue) / had).toFixed(2) : 0 };
};

// ---- pole
if (!only || only === 'pole')
for (const [name, lat0, lon0] of [['60', 60, 10], ['88.9', 88.9, 40], ['Shackleton', -89.67, 129.2], ['89.9', 89.9, -70], ['the pole', 90, 0]]) {
  const rows = new Map(), g = await page(lat0, lon0, rows);
  const out = [];
  let ok = true;
  for (const r of [blastRadiusFor(25), 134]) {
    const x = (r - 60) * 3, z = 40, tiles = tilesAround(x, z, r * 3);
    for (const [tx, tz] of tiles) g.attach(tx, tz, tx * TS, tz * TS, uni());
    const made0 = g.geoPaint.qa.made, t0 = performance.now();
    g.blast(makeBlastSpec(x, z, r, 2, nextSeed()), 0);
    const f = await frames(g, 2000);
    const ms = performance.now() - t0, made = g.geoPaint.qa.made - made0;
    await frames(g, 70);
    for (let i = 0; i < 5; i++) await tick();
    const before = new Map();
    for (const [tx, tz] of tiles) {
      const m = g.masks.get(`${tx},${tz}`);
      if (m && painted(m)) before.set(`${tx},${tz}`, Uint8Array.from(m.data));
    }
    const g2 = await page(lat0, lon0, rows), b = await backOn(g2, tiles, before);
    for (const [tx, tz] of tiles) g.detach(tx, tz);
    out.push({ r: Math.round(r), ms: Math.round(ms), worst: f.worst, made, ...b });
    ok &&= made < 40 && ms < 2000 && b.backPct >= 97 && b.huePct >= 93;
  }
  row(`pole: at ${name}, a breath and a big blast: a few pictures, ms, and back after a reload`, ok, out);
}

// ---- hours: an hour of painting at Jet, a breath every 2.6 s, flying straight on at 450 m/s
if (!only || only === 'hours')
{
  const rows = new Map();
  let g = await page(-11.45, 26.28, rows);
  const first = [];
  const N = 1385, gap = 450 * 2.6, r = blastRadiusFor(150);
  let worst = 0;
  for (let n = 0; n < N; n++) {
    const x = -800000 + n * gap, z = (n % 2 ? 1 : -1) * 30;
    if (n === 0) for (const [tx, tz] of tilesAround(x, z, r * 3)) {
      g.attach(tx, tz, tx * TS, tz * TS, uni());
      first.push([tx, tz]);
    }
    g.blast(makeBlastSpec(x, z, r, n % 6, nextSeed()), 0);
    if (n === 0) {
      await frames(g, 400);
    }
    // (2.6 s of frames between breaths, 78 at 30 fps: the work runs in each)
    for (let k = 0; k < 78; k++) {
      const t0 = performance.now();
      g.geoPaint.work(1 / 30);
      worst = Math.max(worst, performance.now() - t0);
      if (k % 13 === 0) await tick();
    }
  }
  await frames(g, 100);
  for (let i = 0; i < 10; i++) await tick();
  const before = new Map();
  for (const [tx, tz] of first) {
    const m = g.masks.get(`${tx},${tz}`);
    if (m && painted(m)) before.set(`${tx},${tz}`, Uint8Array.from(m.data));
  }
  const kept = g.geoPaint.kept, count = g.geoPaint.count;
  g = await page(-11.45, 26.28, rows);
  const b = await backOn(g, first, before);
  row("hours: an hour at Jet, a breath every 2.6 s, then a reload: the first breath's paint there", b.had > 1000 && b.backPct >= 97 && kept < BUDGET, { breaths: N, pictures: count, MB: +(kept / 1048576).toFixed(1), budgetMB: BUDGET / 1048576, worstFrameMs: +worst.toFixed(2), ...b });
}

// ---- frame: a MEGA from 600 m and a breath, nothing of their fold on the impact's frame
if (!only || only === 'frame')
{
  const g = await page(-43.3, -11.2, new Map());
  const out = [];
  // (warm first, a MEGA and a breath 20 km off, so it's the frames that are measured and not Node compiling them)
  for (const r of [468, blastRadiusFor(25)]) {
    g.blast(makeBlastSpec(-20000, 0, r, 3, nextSeed()), 0);
    await frames(g, 4000);
  }
  for (const r of [468, blastRadiusFor(25), 135]) {
    const t0 = performance.now();
    g.blast(makeBlastSpec(r * 10, 0, r, 1, nextSeed()), 0);
    const impact = performance.now() - t0, f = await frames(g, 4000);
    out.push({ r: Math.round(r), impactMs: +impact.toFixed(2), p95AfterMs: f.p95, worstAfterMs: f.worst, frames: f.frames });
  }
  // (the worst is printed, not barred: one frame in forty can be Node's collector or another job on the machine, up to 8 ms here with a browser beside it)
  row('frame: a MEGA from 600 m, a breath and a firehose: nothing at the impact, after it 95 % of frames under 2.5 ms', out.every((o) => o.impactMs < 3 && o.p95AfterMs < 2.5), out);
}

// ---- tiles: a painted region's 16 tiles, their paint copied out over frames
if (!only || only === 'tiles')
{
  const rows = new Map();
  let g = await page(-43.3, -11.2, rows);
  for (let n = 0; n < 40; n++) g.blast(makeBlastSpec(((n % 8) / 7) * 900, (Math.floor(n / 8) / 4) * 900, blastRadiusFor(25), n % 6, nextSeed()), 0);
  await frames(g, 4000);
  await frames(g, 70);
  for (let i = 0; i < 5; i++) await tick();
  g = await page(-43.3, -11.2, rows);
  const tiles = [];
  for (let tz = 0; tz < 4; tz++) for (let tx = 0; tx < 4; tx++) tiles.push([tx, tz]);
  for (const [tx, tz] of tiles) g.hasSaved(tx, tz);
  let worst = 0, n = 0;
  for (; n < 400 && !tiles.every(([tx, tz]) => g.hasSaved(tx, tz)); n++) {
    const t0 = performance.now();
    g.geoPaint.work(1 / 30);
    worst = Math.max(worst, performance.now() - t0);
    await tick();
  }
  const readyN = tiles.filter(([tx, tz]) => g.hasSaved(tx, tz)).length;
  row("tiles: a painted region's 16 tiles ask at once: their copies over frames, under 4.5 ms in any one", readyN === 16 && worst < 4.5, { ready: readyN, frames: n, worstMs: +worst.toFixed(2) });
}

// ---- between: a tile that comes in between a blast's impact and its fold's end
if (!only || only === 'between')
{
  const g = await page(10, 10, new Map());
  g.blast(makeBlastSpec(100, 100, 468, 3, nextSeed()), 0);
  g.attach(0, 0, 0, 0, uni());
  for (let i = 0; i < 200; i++) g.work();
  const m = g.masks.get('0,0'), n = m ? painted(m) : 0;
  row('between: a tile in between a MEGA\'s impact and its fold\'s end shows it', n > 1000 && g.geoPaint.pending > 0, { painted: n, pendingStill: g.geoPaint.pending });
}

// ---- budget: the store full, then a MEGA over old paint
if (!only || only === 'budget')
{
  const rows = new Map();
  // (old paint where the MEGA lands, then pictures far off, older still, till the store's at its budget)
  let g = await page(0, 0, rows);
  for (let n = 0; n < 12; n++) g.blast(makeBlastSpec(-300 + n * 60, 0, blastRadiusFor(25), 4, nextSeed()), 0);
  await frames(g, 4000);
  await frames(g, 70);
  for (let i = 0; i < 5; i++) await tick();
  const oldKeys = [...rows.keys()];
  for (const k of oldKeys) rows.get(k)[0] = 1000;
  const half = new Uint8Array(128 * 128 * 4);
  for (let t = 0; t < half.length; t += 4 * 3) half[t] = 255, (half[t + 1] = 80);
  const enc = encodeMask(half);
  for (let n = 0; rows.size * enc.length < BUDGET * 1.02; n++) rows.set((n % 30000 + 2600) * 100000 + Math.floor(n / 30000), [500, enc]);
  const tiles = tilesAround(0, 0, 400), before = new Map();
  g = await page(0, 0, rows);
  // (the old paint as it was, read back first)
  const ref = await page(0, 0, new Map(rows));
  for (const [tx, tz] of tiles) ref.hasSaved(tx, tz);
  for (let i = 0; i < 200; i++) { ref.geoPaint.work(1 / 30); await tick(); }
  for (const [tx, tz] of tiles) {
    if (!ref.hasSaved(tx, tz)) continue;
    ref.attach(tx, tz, tx * TS, tz * TS, uni());
    before.set(`${tx},${tz}`, Uint8Array.from(ref.masks.get(`${tx},${tz}`).data));
  }
  let threw = null;
  try {
    g.blast(makeBlastSpec(0, 0, 468, 1, nextSeed()), 0);
    await frames(g, 6000);
    await frames(g, 70, 1 / 30);
    for (let i = 0; i < 10; i++) await tick();
  } catch (e) {
    threw = String(e);
  }
  const g2 = await page(0, 0, rows);
  // (each texel that had old paint has paint after: the MEGA's over it or the old)
  const b = await backOn(g2, tiles, before);
  row('budget: the store at its budget, a MEGA over old paint: nothing thrown, the old paint kept', !threw && b.had > 1000 && b.backPct >= 99, { threw, storeMB: +([...rows.values()].reduce((s, [, e]) => s + e.length, 0) / 1048576).toFixed(1), ...b });
}

// ---- near: tiles attached as a detailed region attaches them, with no hasSaved first
if (!only || only === 'near')
{
  const rows = new Map();
  let g = await page(-11.45, 26.28, rows);
  const x = 300, z = 300, r = blastRadiusFor(25), tiles = tilesAround(x, z, r * 3);
  for (const [tx, tz] of tiles) g.attach(tx, tz, tx * TS, tz * TS, uni());
  g.blast(makeBlastSpec(x, z, r, 3, nextSeed()), 0);
  await frames(g, 400);
  await frames(g, 70);
  for (let i = 0; i < 5; i++) await tick();
  const before = new Map();
  for (const [tx, tz] of tiles) {
    const m = g.masks.get(`${tx},${tz}`);
    if (m && painted(m)) before.set(`${tx},${tz}`, Uint8Array.from(m.data));
  }
  const same = (g) => {
    let had = 0, back = 0, hue = 0;
    for (const [k, was] of before) {
      const m = g.masks.get(k);
      for (let t = 0; t < was.length; t += 4) {
        if (was[t] < 128) continue;
        had++;
        if (!m || m.data[t] < 128) continue;
        back++;
        if (m.data[t + 1] >> 5 === was[t + 1] >> 5) hue++;
      }
    }
    return { had, back, hue, backPct: had ? +((100 * back) / had).toFixed(2) : 0, huePct: had ? +((100 * hue) / had).toFixed(2) : 0 };
  };
  g = await page(-11.45, 26.28, rows);
  for (const [tx, tz] of tiles) g.attach(tx, tz, tx * TS, tz * TS, uni());
  let n = 0;
  for (; n < 400 && [...before.keys()].some((k) => !g.masks.has(k)); n++) {
    g.geoPaint.work(1 / 30);
    g.work();
    await tick();
  }
  const inn = same(g);
  for (const [tx, tz] of tiles) g.detach(tx, tz);
  for (const [tx, tz] of tiles) g.attach(tx, tz, tx * TS, tz * TS, uni());
  const again = same(g);
  row("near: a tile that asked for nothing gets its paint as it comes, and made again it's on at once", inn.had > 1000 && inn.backPct >= 97 && inn.huePct >= 93 && again.back === inn.back && again.hue === inn.hue, { tiles: before.size, framesTillIn: n, came: inn, madeAgain: again });
}

// ---- blocked: IndexedDB blocked, every call refused
if (!only || only === 'blocked')
{
  const no = () => Promise.reject(new Error('blocked'));
  const store = { load: no, get: no, put: no, remove: no, clear: no };
  const g = new GroundPaint(TS, 'moon_check', 'rank');
  g.useGeo(geoAt(-11.45, 26.28), store);
  for (let i = 0; i < 50 && !g.geoPaint.ready; i++) await tick();
  const r = blastRadiusFor(150), first = tilesAround(-800000, 0, r * 3);
  for (const [tx, tz] of first) g.attach(tx, tz, tx * TS, tz * TS, uni());
  let threw = null, most = 0;
  try {
    for (let n = 0; n < 150; n++) {
      g.blast(makeBlastSpec(-800000 + n * 1170, 0, r, n % 6, nextSeed()), 0);
      if (n === 0) await frames(g, 400);
      for (let k = 0; k < 78; k++) {
        g.geoPaint.work(1 / 30);
        if (k % 13 === 0) await tick();
      }
      most = Math.max(most, g.geoPaint.open.size);
    }
  } catch (e) {
    threw = String(e);
  }
  const before = new Map();
  for (const [tx, tz] of first) {
    const m = g.masks.get(`${tx},${tz}`);
    if (m && painted(m)) before.set(`${tx},${tz}`, Uint8Array.from(m.data));
    g.detach(tx, tz);
  }
  // (and the tiles again, much later, the pictures under them long closed)
  g.prepared.clear();
  const b = await backOn(g, first, before);
  row('blocked: a store that takes nothing: the first breath back after 150 more, what is open small', !threw && b.had > 1000 && b.backPct >= 97 && most < 200, { threw, mostOpen: most, ...b });
}

// ---- quota: the store full at 3 MB
if (!only || only === 'quota')
{
  const rows = new Map(), inner = new MemoryStore(rows), CAP = 3 * 1048576;
  let refused = 0;
  const size = () => [...rows.values()].reduce((s, [, e]) => s + e.length, 0);
  const store = {
    load: () => inner.load(),
    get: (k) => inner.get(k),
    remove: (k) => inner.remove(k),
    clear: () => inner.clear(),
    put: async (r) => {
      const add = r.reduce((s, [k, , e]) => s + e.length - (rows.get(k)?.[1].length ?? 0), 0);
      if (size() + add > CAP) {
        refused++;
        throw new Error('QuotaExceededError');
      }
      return inner.put(r);
    },
  };
  const mk = async () => {
    const g = new GroundPaint(TS, 'moon_check', 'rank');
    g.useGeo(geoAt(-11.45, 26.28), store);
    for (let i = 0; i < 50 && !g.geoPaint.ready; i++) await tick();
    return g;
  };
  let g = await mk();
  const r = blastRadiusFor(150), N = 400, last = tilesAround(-800000 + (N - 1) * 1170, 0, r * 3);
  for (let n = 0; n < N; n++) {
    if (n === N - 1) for (const [tx, tz] of last) g.attach(tx, tz, tx * TS, tz * TS, uni());
    g.blast(makeBlastSpec(-800000 + n * 1170, 0, r, n % 6, nextSeed()), 0);
    for (let k = 0; k < 78; k++) {
      g.geoPaint.work(1 / 30);
      if (k % 13 === 0) await tick();
    }
  }
  await frames(g, 200);
  for (let i = 0; i < 10; i++) await tick();
  const before = new Map();
  for (const [tx, tz] of last) {
    const m = g.masks.get(`${tx},${tz}`);
    if (m && painted(m)) before.set(`${tx},${tz}`, Uint8Array.from(m.data));
  }
  const kept = g.geoPaint.kept;
  g = await mk();
  const b = await backOn(g, last, before);
  row('quota: a store full at 3 MB: the budget comes down to it, and the last breath is there after a reload', refused > 0 && size() <= CAP && b.had > 1000 && b.backPct >= 97, { refused, storeMB: +(size() / 1048576).toFixed(2), keptMB: +(kept / 1048576).toFixed(2), ...b });
}

// ---- old: a build before this one's pictures and lists in localStorage, by the page's start place
if (!only || only === 'old')
{
  mem.clear();
  const sp = { key: 0, a: 0, b: 0 }, DEG = Math.PI / 180;
  geoGrid.locate(-11.45, 26.28, sp);
  const key = sp.key, i = Math.floor(key / 100000) - 20000, j = key % 100000;
  // (one picture, its left half painted from Theophilus's page and its right from Tycho's)
  const A = new Uint8Array(128 * 128 * 4), B = new Uint8Array(128 * 128 * 4);
  for (let b = 0; b < 128; b++)
    for (let a = 0; a < 128; a++) {
      const t = (b * 128 + a) * 4, m = a < 64 ? A : B;
      m[t] = 255;
      m[t + 1] = (a < 64 ? 1 : 3) * 32 + 16;
    }
  const olds = [`strugglebus.ground.v2.moon_-11.45_26.28:gpic:${i},${j}`, `strugglebus.ground.v2.moon_-43.30_-11.20:gpic:${i},${j}`, 'strugglebus.ground.v2.moon_-11.45_26.28:geo:0,0'];
  localStorage.setItem(olds[0], JSON.stringify({ t: 2000, m: encodeMask(A) }));
  localStorage.setItem(olds[1], JSON.stringify({ t: 1000, m: encodeMask(B) }));
  // (and a list with a breath 2 km east)
  const blat = -11.45, blon = 26.28 + 2000 / 1737400 / Math.cos(blat * DEG) / DEG;
  localStorage.setItem(olds[2], JSON.stringify([[0, blat, blon, null, null, specToArray(makeBlastSpec(0, 0, blastRadiusFor(25), 5, 4242))]]));
  const rows = new Map(), g = await page(-11.45, 26.28, rows);
  const journalled = localStorage.getItem('strugglebus.moonpaint.journal.v1') !== null;
  await frames(g, 400);
  for (let k = 0; k < 40; k++) {
    g.geoPaint.work(1 / 30);
    await tick();
  }
  const d = new Uint8Array(128 * 128 * 4), got = rows.get(key);
  let left = 0, right = 0;
  if (got && decodeMask(got[1], d))
    for (let t = 0; t < d.length; t += 4) {
      const a = (t / 4) % 128;
      if (d[t] >= 128 && d[t + 1] >> 5 === (a < 64 ? 1 : 3)) a < 64 ? left++ : right++;
    }
  geoGrid.locate(blat, blon, sp);
  const bk = rows.get(sp.key), bd = new Uint8Array(128 * 128 * 4);
  const blast = !!bk && decodeMask(bk[1], bd) && bd[(sp.b * 128 + sp.a) * 4] >= 128 && bd[(sp.b * 128 + sp.a) * 4 + 1] >> 5 === 5;
  const left0 = olds.filter((k) => localStorage.getItem(k) !== null).length, journal = localStorage.getItem('strugglebus.moonpaint.journal.v1') !== null;
  row("old: a build before's pictures under two names and its list, moved in once: the two as one, the blast drawn", left === 8192 && right === 8192 && blast && left0 === 0 && journalled && !journal, { left, right, blast, oldKeysLeft: left0, journalledAtBoot: journalled, journalAfter: journal });
}

console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
