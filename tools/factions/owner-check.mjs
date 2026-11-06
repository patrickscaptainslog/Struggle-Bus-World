#!/usr/bin/env node
// Whose paint it is (docs/specs/factions/FACTIONS.md, section 5's step 1, decision 23), in Node against the real stores, no browser:
//   node tools/factions/owner-check.mjs [row] [--src=<dir>]
// --src: the source tree to check, the repo's src/ by default. Given a checkout of main from before factions (058217c), it says what main can't do: every
//   row fails there but those main already did, its own old saves read back and Rainbow's bytes.
//   numbers   the five, named and numbered in one place (src/game/factions.ts); a record naming none, or one this build doesn't know, read as Rainbow's
//   gpu       the buildings' texture: each faction, fresh and already painted, read back, and the shaders' test for "already painted" right for each; no shader
//             left testing a < 1.5
//   old       every store's save as main writes it, loaded by this code: every record there as it was, and Rainbow's. The buildings, landmarks and bridges; the
//             ground's tiles and the blasts kept for a tile that wasn't in; the Moon's pictures and their journal; its craters, strokes and the orbit map's
//             craters; the Moon from orbit
//   same      a Rainbow record saved by this code is byte for byte what main saves
//   five      each of the five splats, and after a reload reads back as its own, in every store above; another faction's hit on painted paint makes it the hitter's
//   rollback  main's build reading this code's saves: Rainbow's as its own; another faction's left out or read as Rainbow's, never as other paint
//   cost      what it costs: a blast drawn on the ground, a tile's code written and read (ms), a building's paint set (us), for the game as it is (Rainbow alone)
//             and for five factions. Prints only: run it with --src at main's to compare
// Life's movers aren't here: their paint is life's, and keeps its faction once C15 (docs/specs/factions/C15.md) is agreed.
// Each row passes or fails on the numbers printed with it; exit 1 if any fails.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// (Splat.ts and CraterPaint.ts have constructor parameter properties, which Node's type stripping alone won't run)
if (!process.execArgv.includes('--experimental-transform-types')) {
  const r = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
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
  clear: () => mem.clear(),
};

const args = process.argv.slice(2);
const srcArg = args.find((a) => a.startsWith('--src='));
const only = args.find((a) => !a.startsWith('--'));
const SRC_DIR = resolve(srcArg ? srcArg.slice(6) : fileURLToPath(new URL('../../src/', import.meta.url)));
const SRC = pathToFileURL(SRC_DIR).href + '/';
const PS = await import(SRC + 'world/PaintState.ts');
const { PaintState } = PS;
const { GroundPaint } = await import(SRC + 'world/GroundPaint.ts');
const { MemoryStore } = await import(SRC + 'world/GeoPaint.ts');
const { encodeMask, decodeMask } = await import(SRC + 'world/groundMask.ts');
const { makeBlastSpec, specToArray, LAYOUT_BANDS } = await import(SRC + 'game/blastLayout.ts');
const { Splatter } = await import(SRC + 'game/Splat.ts');
const { CraterPaint } = await import(SRC + 'moon/CraterPaint.ts');
const { MoonPaint } = await import(SRC + 'sky/MoonPaint.ts');
const map = await import(SRC + 'moon/map.ts');
const F = await import(SRC + 'game/factions.ts').catch(() => null);
console.log(`src ${SRC_DIR}`);

let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(76)} ${JSON.stringify(got)}`);
};
const note = (name, got) => console.log(`      ${name.padEnd(76)} ${JSON.stringify(got)}`);
const tick = () => new Promise((r) => setTimeout(r, 0));
let seed = 99;
const nextSeed = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
/** The five's numbers, as FACTIONS.md has them: Team Super Rainbow, Atlantis, The Elderwood, Hyperglow, Inferno */
const FIVE = [1, 2, 3, 4, 5];
const TS = 256, N = 128, CELL = TS / N, uni = () => ({ tGround: { value: null }, uGroundOn: { value: 0 } });
/** San Francisco on an OpenStreetMap bake: strugglebus.paint.v3, strugglebus.landmarks.v1, strugglebus.ground.v4: */
const CITY = { slug: 'sf', ids: 'osm' };
const tilesAround = (x, z, r) => {
  const out = [];
  for (let tz = Math.floor((z - r) / TS); tz <= Math.floor((z + r) / TS); tz++) for (let tx = Math.floor((x - r) / TS); tx <= Math.floor((x + r) / TS); tx++) out.push([tx, tz]);
  return out;
};
const spec = (x, z, r, hue, faction) => {
  const s = makeBlastSpec(x, z, r, hue, nextSeed());
  if (faction !== undefined) s.faction = faction;
  return s;
};
/** a ground's replays drawn to the end */
const settle = (g) => {
  for (let i = 0; i < 5000 && g.jobs.length; i++) g.work(1e6);
};
/** every painted texel (coverage >= 128) of a tile, as the live mask has it: its owner by sample(), and its hue */
const texels = (g, tx, tz) => {
  const m = g.masks.get(`${tx},${tz}`), out = [];
  if (!m) return out;
  for (let t = 0; t < m.data.length; t += 4) {
    if (m.data[t] < 128) continue;
    const i = (t >> 2) % N, j = (t >> 2) >> 7, s = g.sample(tx * TS + (i + 0.5) * CELL, tz * TS + (j + 0.5) * CELL);
    out.push({ t, hue: m.data[t + 1] >> 5, owner: s?.faction });
  }
  return out;
};
const owners = (list) => {
  const n = {};
  for (const x of list) n[x.owner] = (n[x.owner] ?? 0) + 1;
  return n;
};

// ---- what main (058217c) writes, frozen here: the old saves the rows load, and what main's build reads of this code's
const OLD = {
  /** groundMask.ts encodeMask: per texel ((coverage, 5 bits) << 3 | hue, run - 1) byte pairs, base64 */
  encodeMask(d) {
    const RLE = new Uint8Array(N * N * 2);
    let w = 0, prev = -1, run = 0, any = false;
    for (let k = 0, o = 0; k < N * N; k++, o += 4) {
      const q = (d[o] * 31 + 127) / 255 | 0;
      const v = q > 0 ? (q << 3) | Math.min(5, d[o + 1] >> 5) : 0;
      if (v === prev && run < 256) {
        run++;
        continue;
      }
      if (run) {
        RLE[w++] = prev;
        RLE[w++] = run - 1;
      }
      if (v) any = true;
      prev = v;
      run = 1;
    }
    RLE[w++] = prev;
    RLE[w++] = run - 1;
    if (!any) return '';
    let bin = '';
    for (let k = 0; k < w; k++) bin += String.fromCharCode(RLE[k]);
    return btoa(bin);
  },
  /** groundMask.ts decodeMask */
  decodeMask(str, d) {
    let bin;
    try {
      bin = atob(str);
    } catch {
      return false;
    }
    let k = 0;
    for (let i = 0; i + 1 < bin.length; i += 2) {
      const v = bin.charCodeAt(i), q = v >> 3, cov = q ? Math.round((q * 255) / 31) : 0, g = q ? Math.min(5, v & 7) * 32 + 16 : 0, e = k + bin.charCodeAt(i + 1) + 1;
      if (e > N * N) break;
      for (let o = k * 4; k < e; k++, o += 4) {
        d[o] = cov;
        d[o + 1] = g;
        d[o + 2] = 0;
        d[o + 3] = 0;
      }
    }
    if (k === N * N) return true;
    d.fill(0);
    return false;
  },
  FIELDS: ['x', 'z', 'r', 'hue', 'seed', 'layout', 'sectors', 'ring', 'twist', 'edge', 'ragged', 'rays', 'rayLen', 'reach', 'dots', 'blobs'],
  /** blastLayout.ts specToArray */
  specToArray(s) {
    const a = OLD.FIELDS.map((k) => (k === 'x' || k === 'z' || k === 'r' ? Math.round(s[k] * 10) / 10 : Math.round(s[k] * 1000) / 1000));
    if (s.layout === 3) a.push(Math.round((s.ox ?? s.x) * 10) / 10, Math.round((s.oz ?? s.z) * 10) / 10);
    return a;
  },
  /** blastLayout.ts specFromArray */
  specFromArray(a) {
    if (!Array.isArray(a) || a.length < 16 || !a.every((v) => Number.isFinite(v))) return null;
    const s = {};
    OLD.FIELDS.forEach((k, i) => (s[k] = a[i]));
    if (a.length >= 18) {
      s.ox = a[16];
      s.oz = a[17];
    }
    return s;
  },
  /** MoonPaint.ts load: a chunk's (lat, lon, level, seed) fours, a level of 1 to 3 */
  strokes(a) {
    const out = [];
    for (let i = 0; i + 3 < a.length; i += 4) if ([1, 2, 3].includes(a[i + 2])) out.push({ lat: a[i], lon: a[i + 1], level: a[i + 2], seed: a[i + 3] >>> 0 });
    return out;
  },
};
/** A mask main draws: coverage in a disc, the hues in sectors, g = hue * 32 + 16 */
const oldMask = (cx, cz, r) => {
  const d = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const dx = i - cx, dz = j - cz, e = r - Math.hypot(dx, dz);
      if (e <= 0) continue;
      const o = (j * N + i) * 4, hue = Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * 6) % 6;
      d[o] = Math.min(255, Math.round(e * 40));
      d[o + 1] = hue * 32 + 16;
    }
  return d;
};

// ---- the Moon's pages, as tools/moon/paint-check.mjs makes them
const geoAt = (lat0, lon0) => {
  const f = map.makeFrame(lat0, lon0), d = [0, 0, 0];
  return { toLatLon(x, z, o) { map.dirOf(f, x, z, d); o[0] = map.latOf(d); o[1] = map.lonOf(d); }, toXZ(la, lo, o) { map.latLonToMap(f, la, lo, d); o[0] = d[0]; o[1] = d[1]; } };
};
const moonPage = async (rows) => {
  const g = new GroundPaint(TS, 'moon_check', 'rank');
  g.useGeo(geoAt(-20, 30), new MemoryStore(rows));
  for (let i = 0; i < 50 && !g.geoPaint.ready; i++) await tick();
  return g;
};
const moonFrames = async (g, most = 3000) => {
  for (let n = 0; n < most; n++) {
    g.geoPaint.work(1 / 30);
    g.work();
    await tick();
    if (!g.geoPaint.pending && n > 60) break;
  }
};
/** a Moon page's tiles back on after a reload: asked for, copied out, attached */
const moonBack = async (g, tiles) => {
  for (const [tx, tz] of tiles) g.hasSaved(tx, tz);
  for (let i = 0; i < 600 && tiles.some(([tx, tz]) => !g.prepared.has(`${tx},${tz}`) && g.geoPaint.pending); i++) {
    g.geoPaint.work(1 / 30);
    await tick();
  }
  for (let i = 0; i < 60; i++) {
    g.geoPaint.work(1 / 30);
    await tick();
  }
  for (const [tx, tz] of tiles) g.attach(tx, tz, tx * TS, tz * TS, uni());
  settle(g);
};

// ---- a town for the Splatter: houses in groups 1 km apart, and what the City answers it
const fx = { geyser() {}, impact() {}, bloom() {}, primary() {}, hitStop() {}, miss() {} };
function town(paint, ground) {
  const refs = [];
  const city = {
    paint, ground, refs,
    add(index, stableId, cx, cz) {
      const r = { index, stableId, cx, cz, baseY: 0, roofY: 10, area: 80, rad: 6, x0: cx - 5, z0: cz - 5, x1: cx + 5, z1: cz + 5, q: 0 };
      refs.push(r);
      paint.register(index, stableId);
      return r;
    },
    nearestBuilding(x, z, radius) {
      let best = null, bd = radius;
      for (const r of refs) {
        const d = Math.hypot(r.cx - x, r.cz - z);
        if (d <= bd) {
          bd = d;
          best = r;
        }
      }
      return best;
    },
    landingOn(ref, _x, _z, _inset, out) {
      out.x = ref.cx;
      out.z = ref.cz;
      return out;
    },
    roofAtPart: (ref) => ref.roofY,
    groundAt: () => 0,
    buildingsWithin(cx, cz, r, out) {
      out.length = 0;
      for (const ref of refs) {
        const d = Math.max(0, Math.hypot(ref.cx - cx, ref.cz - cz) - ref.rad);
        if (d <= r) out.push({ ref, d });
      }
      return out;
    },
    lmOverhead: () => false,
  };
  return city;
}
/** the town's houses: three a group, group f at x = 1000 f; a landmark (Coit) and a bridge (the Golden Gate) on their own */
const HOUSES = [];
for (const f of FIVE) for (let k = 0; k < 3; k++) HOUSES.push({ group: f, index: (f - 1) * 3 + k, id: 5000 + (f - 1) * 3 + k, x: 1000 * f + (k === 1 ? 14 : 0), z: k === 2 ? 14 : 0 });
const LMS = [{ key: 'lm:coit', index: 40, x: 7000, z: 0 }, { key: 'lm:ggb', index: 41, x: 8000, z: 0 }];
const townTiles = [];
for (const x of [1000, 2000, 3000, 4000, 5000, 7000, 8000]) townTiles.push(...tilesAround(x, 0, 330));
const street = () => {
  const paint = new PaintState(64, CITY), ground = new GroundPaint(TS, CITY);
  for (const [tx, tz] of townTiles) ground.attach(tx, tz, tx * TS, tz * TS, uni());
  const city = town(paint, ground);
  for (const h of HOUSES) city.add(h.index, h.id, h.x, h.z);
  for (const l of LMS) city.add(l.index, l.key, l.x, l.z);
  return city;
};
/** a breath from the Splatter at a house, its faction the hitter's, landed */
const breathe = (sp, city, faction, x, z) => {
  sp.faction = faction;
  const target = city.nearestBuilding(x, z, 30);
  sp.barf(x, z, { target, travel: 0.4 });
  sp.update(1);
};

// ---- numbers
if (!only || only === 'numbers') {
  const names = F ? F.FACTIONS.map((f) => `${f.id} ${f.name}`) : null;
  row('the five, named and numbered in one place (game/factions.ts)', !!F && F.FACTION_NONE === 0 && F.FACTIONS.length === 5 && F.FACTIONS.every((f, i) => f.id === i + 1) && new Set(F.FACTIONS.map((f) => f.key)).size === 5, names);
  const read = F ? [undefined, null, 0, 1, 2, 3, 4, 5, 6, 7, 2.5, '3', NaN, -1].map((v) => F.ownerOf(v)) : null;
  row('a record read: 1-5 its own, none or unknown Rainbow (undefined null 0 1-5 6 7 2.5 "3" NaN -1)', !!read && read.join() === '1,1,1,1,2,3,4,5,1,1,1,1,1,1', read);
}

// ---- gpu
if (!only || only === 'gpu') {
  const p = new PaintState(16, 'gpu_check', 'rank');
  const kept = PS.PAINT_KEPT ?? 2, out = [];
  let ok = true;
  for (const f of [0, ...FIVE])
    for (const keep of [false, true]) {
      const i = f * 2 + (keep ? 1 : 0);
      p.set(i, { faction: f, color: 2, level: 1, bloomTime: 0, keep });
      const a = p.data[i * 4 + 3], back = p.get(i).faction, test = a < kept - 0.5;
      // (a reader still testing a < 1.5, another branch's not yet merged: right for Rainbow's)
      const stale = f > 1 || a < 1.5 === !keep;
      ok &&= back === f && test === !keep && stale;
      out.push(`${f}${keep ? 'k' : ''}:${a}`);
    }
  row('each faction, fresh and kept (k): read back, and the shaders\' kept test right', ok, out.join(' '));
  const left = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith('.ts') && /\b(vPaint|paint)\.a\s*<\s*1\.5/.test(readFileSync(join(dir, e.name), 'utf8'))) left.push(e.name);
    }
  };
  walk(SRC_DIR);
  row('no shader left testing paint.a < 1.5', left.length === 0, left);
}

// ---- old
if (!only || only === 'old') {
  // the buildings, landmarks and bridges: {stable id: [faction, color, level]}, the faction 1 since the first build
  mem.clear();
  const bld = {}, lms = { 'lm:coit': [1, 4, 3], 'lm:ggb': [1, 0, 2], 'lm:baybridge': [1, 5, 1] };
  for (let k = 0; k < 40; k++) bld[String(1e8 + k * 7919)] = [1, k % 6, 1 + (k % 3)];
  const bldRaw = JSON.stringify(bld), lmRaw = JSON.stringify(lms);
  mem.set('strugglebus.paint.v3', bldRaw);
  mem.set('strugglebus.landmarks.v1', lmRaw);
  const p = new PaintState(64, CITY);
  let n = 0, same = 0, rainbow = 0;
  for (const [id, [, c, l]] of [...Object.entries(bld), ...Object.entries(lms)]) {
    const i = n++;
    p.register(i, id.startsWith('lm:') ? id : Number(id));
    const r = p.get(i);
    if (r.color === c && r.level === l) same++;
    if (r.faction === 1) rainbow++;
  }
  p.persist();
  row('buildings, landmarks, bridges (paint.v3, landmarks.v1): every record, Rainbow', same === n && rainbow === n, { records: n, same, rainbow });
  row('  and saved again, byte for byte', mem.get('strugglebus.paint.v3') === bldRaw && mem.get('strugglebus.landmarks.v1') === lmRaw, { bytes: bldRaw.length + lmRaw.length });

  // the ground: a tile's mask, and blasts kept for a tile that wasn't in (a plain one and a band one)
  mem.clear();
  const d0 = oldMask(60, 70, 40), code = OLD.encodeMask(d0), want = new Uint8Array(N * N * 4);
  OLD.decodeMask(code, want);
  mem.set('strugglebus.ground.v4:3,0', JSON.stringify({ t: 1, m: code, p: [] }));
  const plain = spec(5 * TS + 100, 100, 60, 2), band = spec(5 * TS + 160, 160, 40, 4);
  band.layout = LAYOUT_BANDS;
  band.ox = 5 * TS;
  band.oz = 0;
  mem.set('strugglebus.ground.v4:5,0', JSON.stringify({ t: 2, m: '', p: [OLD.specToArray(plain), OLD.specToArray(band)] }));
  const g = new GroundPaint(TS, CITY);
  g.attach(3, 0, 3 * TS, 0, uni());
  g.attach(5, 0, 5 * TS, 0, uni());
  settle(g);
  const m = g.masks.get('3,0'), tx = texels(g, 3, 0), tx5 = texels(g, 5, 0);
  let bytes = !!m;
  for (let t = 0; m && t < want.length; t++) if (m.data[t] !== want[t]) bytes = false;
  row('a ground tile (ground.v4): every texel as main decodes it, byte for byte', bytes, { painted: tx.length, code: code.length });
  row('  every painted texel Rainbow\'s', tx.length > 0 && tx.every((x) => x.owner === 1), owners(tx));
  row('blasts kept for a tile that wasn\'t in (a plain one, a band one): drawn, Rainbow\'s', tx5.length > 0 && tx5.every((x) => x.owner === 1), owners(tx5));

  // the Moon's open ground: pictures in the store as main codes them, and a blast in the journal as main's GeoPaint.toArray writes it
  mem.clear();
  const rows = new Map(), g1 = await moonPage(rows), mt = tilesAround(0, 0, 200);
  for (const [a, b] of mt) g1.attach(a, b, a * TS, b * TS, uni());
  g1.blast(spec(0, 0, 60, 1), 0);
  await moonFrames(g1);
  await moonFrames(g1, 70);
  // (each picture as main's build codes it; every one read by this code byte for byte as main reads it)
  let pics = 0, read = 0;
  for (const [k, [t, c]] of rows) {
    const buf = new Uint8Array(N * N * 4), mine = new Uint8Array(N * N * 4), code = OLD.decodeMask(c, buf) ? OLD.encodeMask(buf) : c;
    rows.set(k, [t, code]);
    pics++;
    if (decodeMask(code, mine) && OLD.decodeMask(code, buf) && mine.every((v, i) => v === buf[i])) read++;
  }
  const before = new Map(mt.map(([a, b]) => [`${a},${b}`, g1.masks.get(`${a},${b}`) ? Uint8Array.from(g1.masks.get(`${a},${b}`).data) : null]));
  const geo = geoAt(-20, 30), ll = [0, 0];
  geo.toLatLon(-170, 170, ll);
  const j = spec(-170, 170, 40, 3);
  mem.set('strugglebus.moonpaint.journal.v1', JSON.stringify({ pics: [], blasts: [[ll[0], ll[1], null, null, OLD.FIELDS.map((k) => j[k])]] }));
  const g2 = await moonPage(rows);
  await moonFrames(g2);
  await moonBack(g2, mt);
  let had = 0, back = 0;
  for (const [a, b] of mt) {
    const was = before.get(`${a},${b}`), now = g2.masks.get(`${a},${b}`);
    if (!was) continue;
    for (let t = 0; t < was.length; t += 4) if (was[t] >= 128) {
      had++;
      if (now && now.data[t] >= 128 && now.data[t + 1] >> 5 === was[t + 1] >> 5) back++;
    }
  }
  const mo = mt.flatMap(([a, b]) => texels(g2, a, b));
  const jb = before.get('-1,0'), jx = texels(g2, -1, 0).filter((x) => !(jb && jb[x.t] >= 128) && Math.hypot(((x.t >> 2) % N + 0.5) * CELL - TS - -170, ((x.t >> 9) + 0.5) * CELL - 170) < 15);
  row('the Moon\'s pictures (moonpaint store): every one read byte for byte as main reads it', pics > 0 && read === pics, { pics, read });
  // (a tile's texels come back through pictures on another grid, by place: what comes back is GeoPaint's, the same on main, which tools/moon/paint-check.mjs holds to 97 %)
  row('  copied back onto the tiles, the journal\'s blast drawn; all of it Rainbow\'s', had > 0 && back / had >= 0.95 && jx.length > 0 && mo.every((x) => x.owner === 1), { had, back, journal: jx.length, owners: owners(mo) });

  // the Moon's craters [id, level, hue], strokes [lat, lon, r, hue, seed], and the orbit map's craters [lat, lon, level, seed, km]
  mem.clear();
  const deps = craterDeps();
  const crRaw = JSON.stringify([['p1', 2, 3], ['p2', 1, 0], ['p5', 3, 5]]), stRaw = JSON.stringify([[-19.5, 30.5, 60, 2, 1.25], [-19.4, 30.4, 90, 4, 3.5]]);
  mem.set('strugglebus.moon.craters.v1', crRaw);
  mem.set('strugglebus.moon.strokes.v1', stRaw);
  const c = new CraterPaint(deps);
  const recs = [...c.recs.values()], strokes = c.strokes;
  row('the Moon\'s craters (moon.craters.v1): each, its level and hue, Rainbow\'s', recs.length === 3 && recs.every((r) => r.faction === 1) && recs.map((r) => `${r.id}:${r.level}:${r.hue}`).join() === 'p1:2:3,p2:1:0,p5:3:5', recs.map((r) => `${r.id}:${r.level}:${r.hue}:${r.faction}`));
  row('  and its strokes (moon.strokes.v1)', strokes.length === 2 && strokes.every((r) => r.faction === 1) && strokes.map((r) => r.hue).join() === '2,4', strokes.map((r) => `${r.r}:${r.hue}:${r.faction}`));
  c.dirty = c.strokesDirty = true;
  c.save();
  const low = mem.get('strugglebus.moon.low.v1');
  row('  saved again, byte for byte; the orbit map\'s crater row as main writes it', mem.get('strugglebus.moon.craters.v1') === crRaw && mem.get('strugglebus.moon.strokes.v1') === stRaw && JSON.parse(low).every((a) => a.length === 5), { low });

  // the Moon from orbit: chunks of (lat, lon, level, seed), and the orbit map's craters
  const ms = { get: (k) => mem.get(k) ?? null, set: (k, v) => mem.set(k, String(v)) };
  const chunk = [10, 20, 1, 6001, 10.2, 20, 2, 6007, -40, 100, 3, 6014];
  mem.set('strugglebus.moon.v1.0', JSON.stringify(chunk));
  const mp = new MoonPaint(ms, 1);
  mp.load();
  const q = mp.queue.slice();
  while (mp.rebuilding && !mp.rebuild(1e9, () => performance.now()));
  const sk = mp.strokes;
  row('the Moon from orbit (moon.v1.<k>): each stroke, its level and seed, Rainbow\'s', sk.length === 3 && sk.every((s) => s.faction === 1) && sk.map((s) => `${s.level}:${s.seed}`).join() === '1:6001,2:6007,3:6014', sk.map((s) => `${s.level}:${s.seed}:${s.faction}`));
  row('  and the orbit map\'s crater (moon.low.v1), Rainbow\'s', q.filter((s) => s.km !== undefined).length === 1 && q.every((s) => s.faction === 1), q.filter((s) => s.km !== undefined).map((s) => `${s.level}:${s.km}:${s.faction}`));
  mp.savedTo = 0;
  mp.save();
  row('  saved again, byte for byte', mem.get('strugglebus.moon.v1.0') === JSON.stringify(chunk), mem.get('strugglebus.moon.v1.0'));
}

/** A Moon page's craters with nothing round them: five named ones (p1..p5) at (-20, 30), the fifth wide enough for the orbit map */
function craterDeps() {
  const frame = map.makeFrame(-20, 30);
  const places = FIVE.map((f) => ({ id: f, name: `TEST ${f}`, type: 'crater', lat: -20 + f * 0.05, lon: 30, km: 10, az: null, d: [0, 0, 1], e: [1, 0, 0], n: [0, 1, 0], R: f === 5 ? 9000 : 400 }));
  return { renderer: {}, post() {}, frame, albedo: null, places, names: [], seed: 1, paintRocks() {} };
}

// ---- same
if (!only || only === 'same') {
  mem.clear();
  const g = new GroundPaint(TS, CITY), tl = tilesAround(500, 500, 300);
  for (const [a, b] of tl) g.attach(a, b, a * TS, b * TS, uni());
  for (let k = 0; k < 6; k++) g.blast(spec(400 + 40 * k, 450 + 25 * k, 30 + 10 * k, k, k % 2 ? 1 : undefined), 0);
  let masks = 0, same = 0;
  for (const [a, b] of tl) {
    const m = g.masks.get(`${a},${b}`);
    if (!m) continue;
    masks++;
    if (encodeMask(m.data) === OLD.encodeMask(m.data)) same++;
  }
  row('a Rainbow tile\'s code, byte for byte main\'s', masks > 0 && same === masks, { masks, same });
  const s1 = spec(10.25, 20.75, 61.3, 3), s2 = spec(10, 20, 40, 1, 1), s3 = spec(5, 6, 33, 2);
  s3.layout = LAYOUT_BANDS;
  s3.ox = 1;
  s3.oz = 2;
  const specs = [s1, s2, s3].map((s) => [JSON.stringify(specToArray(s)), JSON.stringify(OLD.specToArray(s))]);
  row('a Rainbow blast kept for a tile, byte for byte (a plain one, one Rainbow by name, a band one)', specs.every(([a, b]) => a === b), specs.map(([a]) => a.length));
}

// ---- five
if (!only || only === 'five') {
  // buildings, a landmark, a bridge and the ground under them, through the Splatter; then another faction over Rainbow's paint
  mem.clear();
  const town1 = street(), sp = new Splatter(town1, fx);
  for (const f of FIVE) breathe(sp, town1, f, 1000 * f, 0);
  breathe(sp, town1, 3, 7000, 0);
  breathe(sp, town1, 5, 8000, 0);
  breathe(sp, town1, 2, 1000, 0);
  town1.paint.persist();
  town1.ground.persist();
  const town2 = street(), out = [];
  let ok = true;
  for (const h of HOUSES) {
    const r = town2.paint.get(h.index), want = h.group === 1 ? 2 : h.group;
    ok &&= r.faction === want && r.level === (h.group === 1 ? 2 : 1);
    out.push(`${h.index}:${r.faction}/${r.level}`);
  }
  row('each faction\'s houses after a reload; group 1 Rainbow\'s, then Atlantis\'s over it', ok, out.join(' '));
  const lm = LMS.map((l) => town2.paint.get(l.index));
  row('  a landmark (Elderwood) and a bridge (Inferno), by name', lm[0].faction === 3 && lm[1].faction === 5 && lm.every((r) => r.level === 1), lm.map((r) => `${r.faction}/${r.level}`));
  settle(town2.ground);
  const gr = [...FIVE, 3, 5].map((f, k) => {
    const x = k < 5 ? 1000 * f : LMS[k - 5].x, s = town2.ground.sample(x + 3, 3);
    return s ? s.faction : null;
  });
  row('  the ground under each, its own; group 1\'s Atlantis\'s', gr.join() === '2,2,3,4,5,3,5', gr);

  // blasts kept for a tile that wasn't in, drawn when it comes
  mem.clear();
  const ga = new GroundPaint(TS, CITY);
  for (const f of FIVE) ga.blast(spec(20000 + 1000 * f, 0, 50, f, f), 0);
  const gb = new GroundPaint(TS, CITY), pend = [];
  for (const f of FIVE) for (const [a, b] of tilesAround(20000 + 1000 * f, 0, 200)) gb.attach(a, b, a * TS, b * TS, uni());
  settle(gb);
  for (const f of FIVE) pend.push(gb.sample(20000 + 1000 * f + 2, 2)?.faction ?? null);
  row('blasts kept for a tile that wasn\'t in, each faction\'s, after a reload', pend.join() === '1,2,3,4,5', pend);
  const keptRaw = [...mem.entries()].filter(([k]) => k.startsWith('strugglebus.ground.v4:')).map(([, v]) => JSON.parse(v).p.map((a) => a.length)).flat();
  note('  their kept numbers a blast (16, and 17 with a faction)', keptRaw);

  // the Moon's pictures, and the journal: a blast that landed and wasn't in the pictures yet when the page went
  mem.clear();
  const rows = new Map(), g1 = await moonPage(rows), tl = [];
  for (const f of FIVE) tl.push(...tilesAround(1000 * f, 0, 150));
  for (const [a, b] of tl) g1.attach(a, b, a * TS, b * TS, uni());
  for (const f of [1, 2, 3]) g1.blast(spec(1000 * f, 0, 50, f, f), 0);
  await moonFrames(g1);
  for (const f of [4, 5]) g1.blast(spec(1000 * f, 0, 50, f, f), 0);
  g1.persist();
  const journal = JSON.parse(mem.get('strugglebus.moonpaint.journal.v1') ?? '{}');
  const g2 = await moonPage(rows);
  await moonFrames(g2);
  await moonBack(g2, tl);
  const mo = FIVE.map((f) => g2.sample(1000 * f + 2, 2)?.faction ?? null);
  row('the Moon\'s pictures, Rainbow, Atlantis, Elderwood; Hyperglow and Inferno by the journal', mo.join() === '1,2,3,4,5' && (journal.blasts?.length ?? 0) >= 2, { owners: mo, journalled: journal.blasts?.length ?? 0 });
  const codes = [...rows.values()].map(([, c]) => c.includes('~'));
  note('  pictures stored, and those whose code names an owner past Rainbow', { pictures: codes.length, named: codes.filter(Boolean).length });

  // the Moon's craters and strokes (a breath's blast carries its hitter), and the orbit map's crater
  mem.clear();
  const c1 = new CraterPaint(craterDeps());
  for (const f of FIVE) {
    const t = c1.named.find((n) => n.id === `p${f}`), s = spec(t.x, t.z, 60, f, f);
    c1.impact({ spec: s, pos: { x: t.x, y: 0, z: t.z }, t: 1, count: 0, maxLevel: 1, strength: 1, dots: [], hose: false, primary: null, super: null, tag: t });
  }
  for (const f of [2, 4]) c1.impact({ spec: spec(30000 * f, 30000, 60, f, f), pos: { x: 0, y: 0, z: 0 }, t: 1, count: 0, maxLevel: 1, strength: 1, dots: [], hose: false, primary: null, super: null, tag: null });
  c1.save();
  const c2 = new CraterPaint(craterDeps());
  const cr = [...c2.recs.values()].map((r) => `${r.id}:${r.faction}`).sort(), st = c2.strokes.map((r) => r.faction);
  row('the Moon\'s craters, each faction\'s, after a reload', cr.join() === 'p1:1,p2:2,p3:3,p4:4,p5:5', cr);
  row('  and its strokes on open ground (Atlantis, Hyperglow)', st.join() === '2,4', st);
  const ms = { get: (k) => mem.get(k) ?? null, set: (k, v) => mem.set(k, String(v)) };
  const mpLow = new MoonPaint(ms, 1);
  mpLow.load();
  const lows = mpLow.queue.filter((s) => s.km !== undefined).map((s) => s.faction);
  row('  the orbit map\'s crater (p5, Inferno\'s), as the Moon from orbit reads it', lows.join() === '5', { lows, row: mem.get('strugglebus.moon.low.v1') });

  // the Moon from orbit: each faction's strokes, one a level up
  for (const k of [...mem.keys()]) if (k.startsWith('strugglebus.moon.v1.')) mem.delete(k);
  const mp = new MoonPaint(ms, 3);
  const lap = (lat, lon) => {
    const job = mp.begin(mp.strike(lat, lon), true);
    mp.work(job, Infinity);
    mp.settle(job);
  };
  for (const f of FIVE) {
    mp.faction = f;
    lap(f * 10, 40);
  }
  mp.faction = 3;
  lap(30, 40);
  mp.save();
  const mp2 = new MoonPaint(ms, 3);
  mp2.load();
  while (mp2.rebuilding && !mp2.rebuild(1e9, () => performance.now()));
  const sk = mp2.strokes.map((s) => `${s.faction}/${s.level}`);
  row('the Moon from orbit: each faction\'s strokes after a reload, Elderwood\'s a level up', sk.join() === '1/1,2/1,3/1,4/1,5/1,3/2', { strokes: sk, chunk: mem.get('strugglebus.moon.v1.0') });
}

// ---- rollback
if (!only || only === 'rollback') {
  mem.clear();
  const g = new GroundPaint(TS, CITY), tl = [...tilesAround(500, 500, 200), ...tilesAround(1900, 1900, 200)];
  for (const [a, b] of tl) g.attach(a, b, a * TS, b * TS, uni());
  g.blast(spec(500, 500, 60, 1), 0);
  g.blast(spec(540, 500, 40, 3, 4), 0);
  g.blast(spec(1900, 1900, 60, 2), 0);
  let mixed = 0, refused = 0, rainbow = 0, same = 0;
  for (const [a, b] of tl) {
    const m = g.masks.get(`${a},${b}`);
    if (!m) continue;
    const code = encodeMask(m.data), mine = new Uint8Array(N * N * 4), main = new Uint8Array(N * N * 4);
    if (code.includes('~')) {
      mixed++;
      if (!OLD.decodeMask(code, main)) refused++;
    } else {
      rainbow++;
      if (decodeMask(code, mine) && OLD.decodeMask(code, main) && mine.every((v, i) => v === main[i])) same++;
    }
  }
  row('a tile\'s code with Hyperglow in it: main\'s build refuses it, never misreads it', mixed > 0 && refused === mixed, { mixed, refused });
  row('  a Rainbow one: main reads every byte this code does', rainbow > 0 && same === rainbow, { rainbow, same });
  const a17 = specToArray(spec(1, 2, 30, 2, 5)), back = OLD.specFromArray(a17);
  row('a kept blast of Inferno\'s: main reads the blast, and none of its bands', a17.length === 17 && !!back && back.ox === undefined && back.r === 30, a17.length);
  const p = new MoonPaint({ get: () => null, set: (k, v) => mem.set(k, v) }, 5);
  p.faction = 4;
  p.work(p.begin(p.strike(5, 5), true), Infinity);
  p.faction = 1;
  p.work(p.begin(p.strike(-5, 5), true), Infinity);
  p.save();
  const oldRead = OLD.strokes(JSON.parse(mem.get('strugglebus.moon.v1.0') ?? '[]'));
  row('a Moon stroke of Hyperglow\'s: main leaves it out, and keeps the Rainbow one', oldRead.length === 1 && oldRead[0].lat === -5, oldRead);
}

// ---- cost
if (!only || only === 'cost') {
  // (the same blasts every run, by their own seeds; `mixed`: each blast another faction's, which a tree from before factions paints as Rainbow's)
  const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const run = (mixed) => {
    mem.clear();
    const g = new GroundPaint(TS, CITY), tl = tilesAround(0, 0, 400);
    for (const [a, b] of tl) g.attach(a, b, a * TS, b * TS, uni());
    const t0 = performance.now();
    for (let k = 0; k < 60; k++) {
      const s = makeBlastSpec(((k * 37) % 300) - 150, ((k * 53) % 300) - 150, 60, k % 6, 1000 + k);
      if (mixed) s.faction = (k % 5) + 1;
      g.blast(s, 0);
    }
    const blast = (performance.now() - t0) / 60;
    const masks = tl.map(([a, b]) => g.masks.get(`${a},${b}`)).filter(Boolean), codes = [];
    const t1 = performance.now();
    for (let r = 0; r < 20; r++) for (const m of masks) codes.push(encodeMask(m.data));
    const encode = (performance.now() - t1) / codes.length, buf = new Uint8Array(N * N * 4);
    const t2 = performance.now();
    for (const c of codes) decodeMask(c, buf);
    const decode = (performance.now() - t2) / codes.length;
    return { blast, encode, decode, bytes: codes.slice(0, masks.length).reduce((s, c) => s + c.length, 0) };
  };
  const sets = () => {
    const p = new PaintState(4096, 'cost_check', 'rank'), t3 = performance.now();
    for (let k = 0; k < 400000; k++) p.set(k & 4095, { faction: 1, color: k % 6, level: 1, bloomTime: 0, keep: (k & 1) === 1 });
    return ((performance.now() - t3) * 1000) / 400000;
  };
  for (const mixed of [false, true]) {
    run(mixed);
    const r = [0, 1, 2, 3, 4].map(() => run(mixed)), s = [0, 1, 2].map(sets);
    note(`cost, ${mixed ? 'five factions' : 'Rainbow (the game today)'}: a 60 m blast drawn, a tile coded, decoded (ms, median of 5); a building set (us)`, { blast: +median(r.map((x) => x.blast)).toFixed(3), encode: +median(r.map((x) => x.encode)).toFixed(4), decode: +median(r.map((x) => x.decode)).toFixed(4), set: +median(s).toFixed(4), codeBytes: r[0].bytes });
  }
}

console.log(bad ? `${bad} failed` : 'all passed');
process.exit(bad ? 1 : 0);
