#!/usr/bin/env node
// W1 (docs/specs/earth/CONTRACT.md, section 7): a city's graphs for life, read with the shipped parser
// (src/world/lifeData.ts, bundled with rolldown as tools/moon/run.mjs does: Node's own type stripping refuses enums),
// and every invariant of the contract's 1.2 counted against the city's own baked files: the tiles' terrain grids
// (tiles.ts's parser), their class rasters and WATER_Y. Prints each count beside its limit, exits 1 on any failure.
// The plan says what each count stands for: docs/specs/earth/GRAPHS.md, "W1".
//
//   node tools/world/graph-check.mjs sf [--dir=public/city/sf] [--tiles=DIR] [--data=DIR] [--names] [--parser=FILE]
//     --dir    the city's folder (a copy, to try a broken file)
//     --tiles  where its r_*.bin tiles are, if not there
//     --data   where its gkeys.bin and checks.json.gz are (tools/world/data/<slug>/; with --dir, that folder)
//     --names  print every name in the files (places may be named; nothing names a person or a vessel: a person reads them)
//     --parser another copy of lifeData.ts to read them with (an old one, to see the parser's checks fail on it);
//              --parser-only stops after those
import { rolldown } from 'rolldown';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const slug = args[0] ?? 'sf';
const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const dir = resolve(flags.dir ?? `${root}/public/city/${slug}`);
const tilesDir = resolve(flags.tiles ?? dir);
// the bake's files for checks, kept in the repo and never shipped: gkeys.bin (W2) and checks.json.gz (the rules' places, C3's land)
const dataDir = resolve(flags.data ?? (flags.dir ? dir : `${root}/tools/world/data/${slug}`));

// the shipped parsers, bundled
const out = `${here}.out`;
mkdirSync(out, { recursive: true });
const fwd = (p) => p.replace(/\\/g, '/');
writeFileSync(`${out}/entry.ts`, [
  `export * from '${fwd(flags.parser ? resolve(flags.parser) : `${root}/src/world/lifeData.ts`)}';`,
  `export { parseTerrainTile, WATER_Y } from '${fwd(root)}/src/world/tiles.ts';`,
  `export { latLonToLocal } from '${fwd(root)}/src/game/geo.ts';`,
].join('\n'));
const bundle = await rolldown({ input: `${out}/entry.ts`, platform: 'node', logLevel: 'warn' });
await bundle.write({ dir: out, format: 'esm', entryFileNames: 'w1.mjs' });
await bundle.close();
const L = await import(pathToFileURL(`${out}/w1.mjs`).href);
const { parseRegionGraph, parseCityRoutes, parseTerrainTile, WATER_Y, latLonToLocal, EdgeFlag, NodeFlag } = L;

const KIND = ['', 'ROAD', 'FOOT', 'RAIL', 'FERRY', 'WATER', 'TAXI', 'RUNWAY'];
const ROAD = ['', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living', 'service', 'track', 'unknown'];
const FOOT = ['', 'footway', 'sidewalk', 'crossing', 'path', 'steps', 'cycleway', 'pedestrian'];
const AREA = ['', 'PLAZA', 'PARK', 'BEACH', 'MARINA', 'FERRY_TERMINAL', 'CRUISE_TERMINAL', 'APRON', 'OPEN_WATER'];
const G_LIMIT = 128 * 1024, R_LIMIT = 256 * 1024;
const WATER = 2, PLAZA = 4;

const man = JSON.parse(readFileSync(`${dir}/city.json`, 'utf8'));
// the known exceptions, each a studio's call (GRAPHS.md, "Where the ground wins"), counted and not failed up to the
// count and the worst a person read in a reviewed bake and wrote here: past either, a class fails. A map with no file
// has none
const knownPath = `${dataDir}/known.json`;
const KNOWN = existsSync(knownPath) ? JSON.parse(readFileSync(knownPath, 'utf8')) : {};
/** a known class against its cap: [ok, what it says] */
const capOf = (name, n, worst) => {
  const k = KNOWN[name] ?? { count: 0 };
  const ok = n <= k.count && (worst === undefined || k.worstM === undefined || n === 0 || worst <= k.worstM);
  return [ok, `at most ${k.count}${k.worstM !== undefined ? `, worst at most ${k.worstM} m` : ''} (${existsSync(knownPath) ? 'known.json' : 'no known.json: none'})`];
};
const results = [];
let failed = 0;
function report(name, value, limit, ok, note = '') {
  results.push({ name, ok });
  if (ok === false) failed++;
  console.log(`${ok === false ? 'FAIL' : ok === true ? 'pass' : '    '}  ${name}: ${value}${limit !== '' ? `  (${limit})` : ''}${note ? `  ${note}` : ''}`);
}

// ------------------------------------------------------------ the parser on broken files (the review's N1 and N2)
// The city's own files, each with one thing broken: every one must come back null, never a throw. N1: routes.bin with
// each count the parser loops on corrupt (the first ferry's points too), and nothing asked for bigger than the file
// could hold: a count is checked against the bytes before an array is made from it. N2: a region's area starts
// stepping down, which hands life an area whose triangles run off its xyz
{
  const inflate = (p) => { const b = gunzipSync(readFileSync(p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const NAMES = ['Float64Array', 'Float32Array', 'Uint32Array', 'Uint16Array', 'Int16Array', 'Uint8Array', 'Int8Array'];
  /** fn()'s result, or what it threw, and the most elements any typed array was asked for meanwhile (past `limit`
   *  the ask throws a RangeError, as an engine short of memory would, rather than taking gigabytes) */
  const spy = (fn, limit) => {
    const real = {};
    let most = 0, r;
    for (const n of NAMES) {
      real[n] = globalThis[n];
      globalThis[n] = new Proxy(real[n], { construct(t, a) {
        if (typeof a[0] === 'number') { most = Math.max(most, a[0]); if (a[0] > limit) throw new RangeError(`${a[0]} elements`); }
        return Reflect.construct(t, a);
      } });
    }
    try { r = fn(); } catch (e) { r = e; } finally { Object.assign(globalThis, real); }
    return [r, most];
  };
  const rb0 = inflate(`${dir}/routes.bin`);
  // where each count sits: the ferries', the first ferry's points, the terminals', marinas', airports', the first runways'
  const at = [], dv = new DataView(rb0);
  let o = 8;
  const str = () => { o += 1 + dv.getUint8(o); };
  at.push(['ferries', o, 4]);
  const nf = dv.getUint32(o, true); o += 4;
  const floats = []; // where an f32 sits: the first ferry's length, the first terminal's berth
  for (let i = 0; i < nf; i++) { o += 4; str(); str(); o += 13; if (i === 0) { at.push(['the first ferry\'s points', o, 4]); floats.push(['the first ferry\'s length', o - 4]); } const m = dv.getUint32(o, true); o += 4 + m * 8; }
  { const t = dv.getUint32(o, true); if (t > 0) { let q = o + 8; q += 1 + dv.getUint8(q); q += 1; q += 1 + dv.getUint8(q); floats.push(['the first terminal\'s berth', q + 8]); } }
  for (const [what, row] of [['terminals', (k) => { o += 4; str(); o += 1; str(); o += 12; }], ['marinas', () => { o += 4; str(); str(); o += 10; }]]) {
    at.push([what, o, 4]);
    const n = dv.getUint32(o, true); o += 4;
    for (let i = 0; i < n; i++) row(i);
  }
  at.push(['airports', o, 4]);
  if (dv.getUint32(o, true) > 0) { o += 8; str(); str(); o += 12; at.push(['the first airport\'s runways', o, 2]); }
  const bad = [];
  let most = 0;
  for (const [what, off, w] of at) {
    const b = rb0.slice(0);
    if (w === 4) new DataView(b).setUint32(off, 0x40000000, true); else new DataView(b).setUint16(off, 0xffff, true);
    const [r, m] = spy(() => parseCityRoutes(b, man.origin), rb0.byteLength);
    most = Math.max(most, m);
    if (r !== null || m > rb0.byteLength) bad.push(`${what}: ${r === null ? 'null' : r instanceof Error ? `threw ${r.message}` : 'parsed'}, ${m} elements asked for`);
  }
  report('routes.bin with a corrupt count (N1)', `${at.length} copies, each with one count the parser loops on set past the file (${at.map((a) => a[0]).join(', ')}); ${bad.length} not null or asking for more than the file holds${bad.length ? ` (${bad.join('; ')})` : `, the most any asked for ${most} elements`}`,
    `null, and no array past the file's ${rb0.byteLength} bytes`, bad.length === 0);
  // a float that isn't a number: routes.bin's f32s (each NaN, then infinite) and a region's baseY, over which every
  // height in its file stands
  const nan = [];
  for (const [what, off] of floats) for (const v of [NaN, Infinity]) {
    const b = rb0.slice(0);
    new DataView(b).setFloat32(off, v, true);
    const [r] = spy(() => parseCityRoutes(b, man.origin), Infinity);
    if (r !== null) nan.push(`${what} ${v}: ${r instanceof Error ? `threw ${r.message}` : 'parsed'}`);
  }
  {
    const [rx, rz] = (man.life?.regions ?? [])[0] ?? [];
    const p = `${dir}/g_${rx}_${rz}.bin`;
    if (existsSync(p)) for (const v of [NaN, -Infinity]) {
      const b = inflate(p);
      new DataView(b).setFloat32(16, v, true);
      const [r] = spy(() => parseRegionGraph(b, man.tileSize * (man.regionSize ?? 4)), Infinity);
      if (r !== null) nan.push(`g_${rx}_${rz}.bin's baseY ${v}: ${r instanceof Error ? `threw ${r.message}` : 'parsed'}`);
    }
  }
  report('a float that isn\'t a number', `${floats.length * 2 + 2} copies, routes.bin's ${floats.map((f) => f[0]).join(' and ')} each NaN and infinite, a region's baseY NaN and -infinite; ${nan.length} not null${nan.length ? ` (${nan.join('; ')})` : ''}`,
    'null', nan.length === 0 && floats.length === 2);
  // N2: the first region with two areas or more, its second area's start past the last triangle
  let done = false;
  for (const [rx, rz] of (man.life?.regions ?? [])) {
    const p = `${dir}/g_${rx}_${rz}.bin`;
    if (!existsSync(p)) continue;
    const b = inflate(p), v = new DataView(b);
    const nn = v.getUint32(20, true), ne = v.getUint32(24, true), np = v.getUint32(28, true), na = v.getUint32(32, true), nt = v.getUint32(40, true);
    if (na < 2) continue;
    const p4 = (x) => x + ((4 - (x & 3)) & 3), wide = nn > 65535 ? 4 : 2;
    let q = 48 + nn * 4;
    q = p4(p4(q + nn * 6) + nn);
    q = p4(p4(q + ne * 4 + ne * wide) + ne * wide);
    q = p4(p4(q + ne * 6) + ne * 2) + (ne + 1) * 4;
    q = p4(q + np * 6) + na * 4;
    q = p4(p4(q + na) + na * 2); // tri[]
    const ok = parseRegionGraph(b.slice(0), man.tileSize * (man.regionSize ?? 4)) !== null && v.getUint32(q + na * 4, true) === nt;
    v.setUint32(q + 4, nt + 1, true); // tri[1] past the triangles, so tri[2] steps down
    const [r] = spy(() => parseRegionGraph(b, man.tileSize * (man.regionSize ?? 4)), Infinity);
    report('a region\'s area starts stepping down (N2)', `g_${rx}_${rz}.bin, ${na} areas, its second area's start set to ${nt + 1} of ${nt} triangles: ${r === null ? 'null' : r instanceof Error ? `threw ${r.message}` : 'parsed'}${ok ? '' : '; the file unbroken did not parse, or its layout is not the one read here'}`,
      'null', ok && r === null);
    done = true;
    break;
  }
  if (!done) report('a region\'s area starts stepping down (N2)', 'no region with two areas', 'null', false);
  if (flags['parser-only']) { console.log(`\nW1 parser checks ${failed ? `FAILED: ${failed}` : 'passed'}`); process.exit(failed ? 1 : 0); }
}

// ------------------------------------------------------------ the tiles, as tiles.ts reads them
const T = man.tileSize, CN = man.classN ?? 128, RS = man.regionSize ?? 4;
const REGION_M = T * RS; // the parser takes it from city.json as life does
const have = new Set(man.tiles.map((t) => `${t[0]},${t[1]}`));
const tileCache = new Map();
function regionTiles(rx, rz) {
  const k = `${rx},${rz}`;
  let m = tileCache.get(k);
  if (m) { tileCache.delete(k); tileCache.set(k, m); return m; }
  m = new Map();
  const p = `${tilesDir}/r_${rx}_${rz}.bin`;
  if (existsSync(p)) {
    let b = readFileSync(p);
    if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const dv = new DataView(ab);
    const n = dv.getUint32(4, true);
    for (let i = 0; i < n; i++) {
      const o = 8 + i * 24;
      const tx = dv.getInt32(o, true), tz = dv.getInt32(o + 4, true), to = dv.getUint32(o + 16, true), tl = dv.getUint32(o + 20, true);
      if (tl) m.set(`${tx},${tz}`, parseTerrainTile(ab.slice(to, to + tl), CN));
    }
  }
  tileCache.set(k, m);
  if (tileCache.size > 12) tileCache.delete(tileCache.keys().next().value);
  return m;
}
function tileOf(x, z) {
  let tx = Math.floor(x / T), tz = Math.floor(z / T);
  if (!have.has(`${tx},${tz}`)) {
    const ex = x === tx * T, ez = z === tz * T;
    const c = [];
    if (ex) c.push([tx - 1, tz]);
    if (ez) c.push([tx, tz - 1]);
    if (ex && ez) c.push([tx - 1, tz - 1]);
    const f = c.find(([a, b]) => have.has(`${a},${b}`));
    if (!f) return null;
    [tx, tz] = f;
  }
  return regionTiles(Math.floor(tx / RS), Math.floor(tz / RS)).get(`${tx},${tz}`) ?? null;
}
/** the ground (m) as City.ts tileGround reads the baked heights; NaN with no tile */
function ground(x, z) {
  const t = tileOf(x, z);
  if (!t) return NaN;
  const fx = Math.min(t.n - 1.001, Math.max(0, (x - t.originX) / t.cell));
  const fz = Math.min(t.n - 1.001, Math.max(0, (z - t.originZ) / t.cell));
  const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz, h = t.heights, n = t.n;
  const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
  return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
}
/** the 2 m class (tiles.ts Ground), 255 with no tile */
function klass(x, z) {
  const t = tileOf(x, z);
  if (!t) return 255;
  const i = Math.min(CN - 1, Math.max(0, Math.floor(((x - t.originX) / T) * CN)));
  const j = Math.min(CN - 1, Math.max(0, Math.floor(((z - t.originZ) / T) * CN)));
  return t.cls[j * CN + i] & 15;
}
const wet = (x, z) => { const c = klass(x, z); return c === 255 || c === WATER; };
/** the sea and the Bay, at WATER_Y: no tile, or a WATER texel the grid holds at 2 m or under. Higher up it's a lake,
 *  drawn on the ground at the grid's height (graphs.py, sea()) */
const LAKE_M = 2;
// a step on the sea may dip under its surface this far, where a polyline crosses from a grid under WATER_Y (land
// texels at the Bay's -1.1) onto the sea's at WATER_Y: the 0.5 bake's footways stood 0.5 m under it on the sea itself
const UNDER_TOL = 0.3;
const sea = (x, z) => { const c = klass(x, z); return c === 255 || (c === WATER && (ground(x, z) <= LAKE_M || seaHeldAt(x, z))); };
// C10 (0.9): a run of WATER texels the grid holds over LAKE_M that touches the sea, 4-connected, is the sea's (seaHeld,
// read from the tiles below, before the files)
const K = REGION_M / 2; // 2 m texels on a region's side
const seaHeld = new Map(); // `${rx},${rz}` -> the region's texel indices (row * K + column) in a raised run that is the sea's
function seaHeldAt(x, z) {
  const t = tileOf(x, z);
  if (!t || !seaHeld.size) return false;
  const tx = Math.round(t.originX / T), tz = Math.round(t.originZ / T), rx = Math.floor(tx / RS), rz = Math.floor(tz / RS);
  const s = seaHeld.get(`${rx},${rz}`);
  if (!s) return false;
  const i = Math.min(CN - 1, Math.max(0, Math.floor(((x - t.originX) / T) * CN))), j = Math.min(CN - 1, Math.max(0, Math.floor(((z - t.originZ) / T) * CN)));
  return s.has(((tz - rz * RS) * CN + j) * K + (tx - rx * RS) * CN + i);
}
/** what a mover on the ground stands on (graphs.py stand()): the grid, never under the sea's surface, WATER_Y with no tile */
const standAt = (x, z) => { const h = ground(x, z); return Number.isNaN(h) ? WATER_Y : sea(x, z) ? Math.max(h, WATER_Y) : h; };
/** |y - standAt|, read either side of a texel line within 0.1 m: a file's point moves up to 5 cm in its decimetres, and
 *  standAt steps where the sea meets a grid under WATER_Y */
const OFF = [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]];
const standErr = (x, z, y) => { let e = Infinity; for (const [dx, dz] of OFF) { e = Math.min(e, Math.abs(y - standAt(x + dx, z + dz))); if (e <= 0.3) break; } return e; };
const seaAll = (x, z) => OFF.every(([dx, dz]) => sea(x + dx, z + dz));

// ------------------------------------------------------------ the files
const life = man.life;
report('city.json life block', life ? `graph ${life.graph}, routes ${life.routes}` : 'none', '', !!life);
if (!life) process.exit(1);
// C1 (0.6): life finds its files in life.regions, every cell inside the bounds with anything in it, water with no tile too
const regions = (life.regions ?? man.regions).map((r) => [r[0], r[1], r[2]]); // (City's, to check the rest of a 0.5 bake)
const regionSet = new Set(regions.map(([a, b]) => `${a},${b}`));
const [bx0, bz0, bx1, bz1] = man.bounds;

// C10, read from the tiles as the bake reads them (graphs.py sea_runs), not from the files: each region's raised WATER
// in 4-connected runs, joined across region lines; a run any part of which has the sea beside it is the sea's
const runs = { sea: 0, seaTexels: 0, highest: 0, where: null, over5: 0, lakes: 0 };
{
  const par = new Map();
  const find = (a) => { while (par.has(a) && par.get(a) !== a) { const p = par.get(a); par.set(a, par.get(p) ?? p); a = p; } return a; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) par.set(b, a); else par.set(a, b); } };
  const touch = new Set(), info = new Map(), kept = new Map(), border = new Map();
  for (const [rx, rz] of regions) {
    const sea = new Uint8Array(K * K), lab = new Int32Array(K * K), H = new Float32Array(K * K);
    const tiles = regionTiles(rx, rz);
    for (let j = 0; j < RS; j++) for (let i = 0; i < RS; i++) {
      const tx = rx * RS + i, tz = rz * RS + j, ox = tx * T, oz = tz * T;
      if (ox + T <= bx0 || ox >= bx1 || oz + T <= bz0 || oz >= bz1) continue;
      const t = have.has(`${tx},${tz}`) ? tiles.get(`${tx},${tz}`) ?? null : null;
      for (let q = 0; q < CN; q++) for (let p = 0; p < CN; p++) {
        const idx = (j * CN + q) * K + i * CN + p;
        if (!t) { sea[idx] = 1; continue; }
        if ((t.cls[q * CN + p] & 15) !== WATER) continue;
        const fx = Math.min(t.n - 1.001, Math.max(0, ((p + 0.5) * (T / CN)) / t.cell)), fz = Math.min(t.n - 1.001, Math.max(0, ((q + 0.5) * (T / CN)) / t.cell));
        const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz, hh = t.heights, n = t.n;
        const h = (hh[iz * n + ix] * (1 - ax) + hh[iz * n + ix + 1] * ax) * (1 - az) + (hh[(iz + 1) * n + ix] * (1 - ax) + hh[(iz + 1) * n + ix + 1] * ax) * az;
        if (h > LAKE_M) { lab[idx] = -1; H[idx] = h; } else sea[idx] = 1;
      }
    }
    // label the raised texels, 4-connected, and which have the sea beside them
    let n = 0;
    const idxs = [], labs = [];
    for (let s = 0; s < K * K; s++) {
      if (lab[s] !== -1) continue;
      n++;
      const key = `${rx},${rz},${n}`;
      let cnt = 0, top = -Infinity, at = s, wet = false;
      const stack = [s];
      lab[s] = n;
      while (stack.length) {
        const v = stack.pop(), vi = v % K, vj = (v - vi) / K;
        cnt++; if (H[v] > top) { top = H[v]; at = v; } idxs.push(v); labs.push(n);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = vi + di, nj = vj + dj;
          if (ni < 0 || nj < 0 || ni >= K || nj >= K) continue;
          const w = nj * K + ni;
          if (sea[w]) wet = true;
          else if (lab[w] === -1) { lab[w] = n; stack.push(w); }
        }
      }
      info.set(key, [cnt, top, `${(rx * REGION_M + (at % K) * 2 + 1).toFixed(0)}, ${(rz * REGION_M + Math.floor(at / K) * 2 + 1).toFixed(0)}`]);
      find(key);
      if (wet) touch.add(key);
    }
    if (n) kept.set(`${rx},${rz}`, [Int32Array.from(idxs), Int32Array.from(labs)]);
    const col = (i) => { const o = new Int32Array(K), w = new Uint8Array(K); for (let j = 0; j < K; j++) { o[j] = Math.max(0, lab[j * K + i]); w[j] = sea[j * K + i]; } return [o, w]; };
    const row = (j) => [Int32Array.from(lab.subarray(j * K, j * K + K), (v) => Math.max(0, v)), sea.slice(j * K, j * K + K)];
    border.set(`${rx},${rz}`, { w: col(0), e: col(K - 1), n: row(0), s: row(K - 1) });
  }
  for (const [rk, b] of border) {
    const [rx, rz] = rk.split(',').map(Number);
    for (const [nk, mine, theirs] of [[`${rx + 1},${rz}`, b.e, 'w'], [`${rx},${rz + 1}`, b.s, 'n']]) {
      const o = border.get(nk);
      if (!o) continue;
      const [ml, ms] = mine, [tl, ts] = o[theirs];
      for (let k = 0; k < K; k++) {
        if (ml[k] && tl[k]) join(`${rk},${ml[k]}`, `${nk},${tl[k]}`);
        if (ml[k] && ts[k]) touch.add(`${rk},${ml[k]}`);
        if (tl[k] && ms[k]) touch.add(`${nk},${tl[k]}`);
      }
    }
  }
  const wet = new Set([...touch].map(find)), comp = new Map();
  for (const [key, [cnt, top, where]] of info) {
    const r = find(key), q = comp.get(r) ?? [0, -Infinity, null];
    q[0] += cnt; if (top > q[1]) { q[1] = top; q[2] = where; }
    comp.set(r, q);
  }
  for (const [r, [cnt, top, where]] of comp) if (wet.has(r)) { runs.sea++; runs.seaTexels += cnt; if (top > runs.highest) { runs.highest = top; runs.where = where; } if (top > 5.5) runs.over5++; } else runs.lakes++;
  for (const [rk, [idxs, labs]] of kept) {
    let s = null;
    for (let k = 0; k < idxs.length; k++) if (wet.has(find(`${rk},${labs[k]}`))) (s ??= new Set()).add(idxs[k]);
    if (s) seaHeld.set(rk, s);
  }
}

const routesPath = `${dir}/routes.bin`;
const routesGz = readFileSync(routesPath);
const rb = gunzipSync(routesGz);
const routes = parseCityRoutes(rb.buffer.slice(rb.byteOffset, rb.byteOffset + rb.byteLength), man.origin);
report('routes.bin parses', routes ? `${rb.subarray(0, 4).toString('latin1')} ${routes.version}.${routes.minor}: ${routes.ferries.length} ferries, ${routes.terminals.length} terminals, ${routes.marinas.length} marinas, ${routes.airports.length} airports` : `null (magic ${rb.subarray(0, 4).toString('latin1')})`, "SBC1 (C7)", !!routes);
report('routes.bin size', `${(routesGz.length / 1024).toFixed(1)} KB gzipped`, '256 KB', routesGz.length <= R_LIMIT);
{
  // C5: the parser's map metres against geo.ts, at every place it gives them
  let n = 0, worst = 0;
  const at = (lat, lon, x, z) => { const [ex, ez] = latLonToLocal(lat, lon, man.origin); n++; worst = Math.max(worst, Math.hypot(ex - x, ez - z)); };
  for (const f of routes?.ferries ?? []) for (let i = 0; i < f.lat.length; i++) at(f.lat[i], f.lon[i], f.xz[i * 2], f.xz[i * 2 + 1]);
  for (const t of [...(routes?.terminals ?? []), ...(routes?.marinas ?? []), ...(routes?.airports ?? [])]) at(t.lat, t.lon, t.x, t.z);
  for (const a of routes?.airports ?? []) for (const w of a.runways) for (const i of [0, 1]) at(w.lat[i], w.lon[i], w.x[i], w.z[i]);
  report('routes in map metres (C5)', `${n} places, worst ${(worst * 100).toFixed(1)} cm from geo.ts`, 'within 5 cm (f32)', !!routes && n > 0 && worst < 0.05);
}

// keys
const keysOf = new Map(), idOfKey = new Map();
let keyDup = 0, idDup = 0;
{
  const kp = existsSync(`${dataDir}/gkeys.bin`) ? `${dataDir}/gkeys.bin` : `${dir}/gkeys.bin`;
  const kb = gunzipSync(readFileSync(kp));
  const dv = new DataView(kb.buffer, kb.byteOffset, kb.byteLength);
  const n = dv.getUint32(8, true);
  let o = 12;
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    // u32 id, u8 kind, u8 length, the key: a key is unique within its kind (a marina's area and the marina share one)
    const id = dv.getUint32(o, true), kind = dv.getUint8(o + 4), len = dv.getUint8(o + 5);
    const key = `${kind}:${dec.decode(kb.subarray(o + 6, o + 6 + len))}`;
    o += 6 + len;
    if (keysOf.has(id)) idDup++;
    if (idOfKey.has(key)) keyDup++;
    keysOf.set(id, key);
    idOfKey.set(key, id);
  }
}

// the bake's check file: each one-way rule at its range's middle with the way travel goes, each car-closing rule's place
// (from the segments' own lines, so W1 reads direction and NO_CARS against the rules), C3's land along the ferries
const checksPath = `${dataDir}/checks.json.gz`;
const checks = existsSync(checksPath) ? JSON.parse(gunzipSync(readFileSync(checksPath)).toString('utf8')) : null;
report('check file', checks ? `${checks.oneway.length} one-way rules, ${checks.noCars.length} closing rules, ${checks.land.length} land polygons (${checksPath})` : `none at ${checksPath}`, '', !!checks);
const ruleAt = new Map(); // region -> [[kind 0 one-way / 1 NO_CARS, x, z, ux, uz]]
// (each with its segment's kind and level: Market Street's road and the subway under it share a line)
for (const [x, z, ux, uz, kind, lv] of checks?.oneway ?? []) { const k = `${Math.floor(x / REGION_M)},${Math.floor(z / REGION_M)}`; if (!ruleAt.has(k)) ruleAt.set(k, []); ruleAt.get(k).push([0, x, z, ux, uz, kind, lv]); }
for (const [x, z, lv] of checks?.noCars ?? []) { const k = `${Math.floor(x / REGION_M)},${Math.floor(z / REGION_M)}`; if (!ruleAt.has(k)) ruleAt.set(k, []); ruleAt.get(k).push([1, x, z, 0, 0, 1, lv]); }

const routeEnds = []; // map metres of each ferry route's two ends, for the 150 m exemption
const termById = new Map(routes?.terminals.map((t) => [t.id, t]) ?? []);
for (const f of routes?.ferries ?? []) {
  const n = f.lat.length;
  routeEnds.push([f.xz[0], f.xz[1]], [f.xz[n * 2 - 2], f.xz[n * 2 - 1]]);
}
const nearEnd = (x, z) => routeEnds.some(([ex, ez]) => Math.hypot(x - ex, z - ez) <= 150);
const decks = (man.landmarks ?? []).filter((l) => l.deck).map((l) => l.deck);
for (const d of decks) { d.cum = [0]; for (let i = 1; i < d.length; i++) d.cum.push(d.cum[i - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1])); }
/** a place against a drawn deck: its distance from the line and the top there, past an end (ext), the line's heading,
 *  and the way along it from its first point (s, unclipped past the ends) of its length */
const near = (x, z, d) => {
  let best = Infinity, top = 0, tr = 0, seg = 0;
  for (let i = 0; i < d.length - 1; i++) {
    const [ax, az, ay] = d[i], [bx, bz, by] = d[i + 1];
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
    const r = L2 > 0 ? ((x - ax) * vx + (z - az) * vz) / L2 : 0, t = Math.min(1, Math.max(0, r));
    const dd = Math.hypot(ax + t * vx - x, az + t * vz - z);
    if (dd < best) { best = dd; top = ay + t * (by - ay); tr = r; seg = i; }
  }
  const [ax, az] = d[seg], [bx, bz] = d[seg + 1], L = Math.hypot(bx - ax, bz - az);
  const f = seg === 0 || seg === d.length - 2 ? tr : Math.min(1, Math.max(0, tr));
  return { best, top, ext: (seg === 0 && tr < 0) || (seg === d.length - 2 && tr > 1), vx: (bx - ax) / L, vz: (bz - az) / L, s: d.cum[seg] + f * L, length: d.cum[d.length - 1] };
};
/** a place on a drawn deck, between its ends, at its top or a level or two under it (C2), within 0.3 m */
const onDrawnTop = (x, y, z) => decks.some((d) => { const q = near(x, z, d); return q.best <= 44 && !q.ext && [0, 1, 2].some((m) => Math.abs(y - (q.top - 5.5 * m)) <= 0.3); });

const c = {
  files: 0, missing: 0, parseFail: 0, tooBig: 0, gz: 0, raw: 0, sizes: [],
  nodes: 0, edges: 0, points: 0, areas: 0, tris: 0,
  outside: 0, edgesAcross: 0, selfLoops: 0, shortEdges: 0,
  portals: 0, lineNotPortal: 0, lineDeadEnds: 0, lineDeadC1: 0, cellsOut: 0, bytesOff: 0,
  idTwiceInFile: 0, idKinds: 0, noKey: 0,
  byDir: {}, oneWay: 0, noCars: 0, noCarsKm: 0, noCarsOff: 0, minors: new Set(),
  tunnelUndrawn: 0, undrawnKm: {}, kmByClass: {},
  land: 0, landNoTile: 0, landWorst: 0, landWhere: null, landOver: 0, steps: 0,
  held: 0, heldWorst: 0, heldWhere: null, heldSteps: 0,
  footDeckSteps: 0, walls: 0, wallsAtFeet: 0, wallWorst: 0, wallWhere: null,
  water: 0, waterOff: 0, waterWorst: 0, waterLake: 0, afloat: 0, afloatUnder: 0, afloatWorst: 0, afloatWhere: null,
  lakeTexels: 0, lakeCovered: 0, lakeOffTexels: 0, seaTexels: 0, seaCovered: 0, seaRaised: 0, lakeTris: 0, lakeAreas: 0, seaAreas: 0,
  drawnPts: [], topLevel: [], footDeck: [], roadDeck: [], stackPairs: 0, rampPairs: 0, inversions: 0, inversionWhere: null,
  underWater: 0, underWhere: null, deckGround: 0, deckDrawn: 0, deckUnder: 0, deckUnderWorst: 0, deckUnderWhere: null,
  tunnelPts: 0, tunnelOver: 0, tunnelOverWorst: 0, tunnelOverWhere: null,
  ruleSeen: [0, 0], ruleMiss: [0, 0], ruleWrong: [0, 0], ruleWhere: [null, null], areaOnStructure: 0, areaOnStructureWhere: null,
  ferrySamples: 0, ferryOnLand: 0, ferryLandWhere: null, ferryExempt: 0,
  areaPts: 0, areaWorst: 0, areaOver: 0, areaWhere: null, waterTris: 0, waterTexels: 0, waterOffTexels: 0, waterTriY: 0,
  names: new Set(), byKind: {}, areaByKind: {},
};
const nodeSeen = new Map(); // node id -> [{r, x, y, z, portal, line}]
const onStructure = new Set(checks?.onStructure ?? []); // areas the bake knows stand on a roof or a deck
const ferryEnd = new Map(); // node id -> its FERRY edges in every file, whether a road or footway meets it, a portal, where
const deckParent = new Map(); // node id -> parent, the decks' structures
const deckFind = (a) => { let p = deckParent.get(a) ?? a; while (p !== a) { const g = deckParent.get(p) ?? p; deckParent.set(a, g); a = p; p = g; } return a; };
const deckJoin = (a, b) => { const p = deckFind(a), q = deckFind(b); if (p !== q) deckParent.set(Math.max(p, q), Math.min(p, q)); };
const allDeck = []; // [x, y, z, level, edge id, a node id]
const areaSeen = new Map(); // area id -> regions
const edgeSeen = new Map();

const onLine = (v) => { const k = Math.round(v / REGION_M); return Math.abs(v - k * REGION_M) < 1e-3; };
const SAMPLE = 4;

for (const [rx, rz, bytes] of regions) {
  const p = `${dir}/g_${rx}_${rz}.bin`;
  if (!existsSync(p)) { c.missing++; continue; }
  if (rx < Math.floor(bx0 / REGION_M) || rx >= Math.ceil(bx1 / REGION_M) || rz < Math.floor(bz0 / REGION_M) || rz >= Math.ceil(bz1 / REGION_M)) c.cellsOut++;
  const gz = readFileSync(p);
  c.files++;
  c.gz += gz.length;
  c.sizes.push([gz.length, rx, rz]);
  if (gz.length !== bytes) c.bytesOff++;
  if (gz.length > G_LIMIT) c.tooBig++;
  const raw = gunzipSync(gz);
  c.raw += raw.length;
  const g = parseRegionGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), REGION_M);
  if (!g || g.rx !== rx || g.rz !== rz) { c.parseFail++; continue; }
  const { nodes, edges, pts, areas } = g;
  c.minors.add(g.minor);
  c.nodes += nodes.n; c.edges += edges.n; c.points += pts.length / 3; c.areas += areas.n; c.tris += areas.xyz.length / 9;
  const x0 = rx * REGION_M, z0 = rz * REGION_M, x1 = x0 + REGION_M, z1 = z0 + REGION_M;
  const out = (x, z, tol) => x < x0 - tol || x > x1 + tol || z < z0 - tol || z > z1 + tol;
  // what touches each node
  const touch = new Uint8Array(nodes.n); // 1 ground, 2 deck, 4 tunnel, 8 ferry
  const cls = (e) => {
    const k = edges.kind[e], f = edges.flags[e];
    if (k === 4 || k === 5) return 8;
    if (f & EdgeFlag.BRIDGE || edges.level[e] > 0) return 2;
    if (f & EdgeFlag.TUNNEL) return 4;
    return 1;
  };
  const seenHere = new Set();
  const deckDeg = new Uint8Array(nodes.n); // deck edges at each node: a foot has one, a junction mid-span two or more
  for (let e = 0; e < edges.n; e++) {
    const k = cls(e);
    touch[edges.a[e]] |= k; touch[edges.b[e]] |= k;
    if (k === 2) { deckDeg[edges.a[e]]++; deckDeg[edges.b[e]]++; }
    const id = edges.id[e];
    if (seenHere.has(id)) c.idTwiceInFile++;
    seenHere.add(id);
    if (edgeSeen.has(id)) c.idTwiceInFile++;
    edgeSeen.set(id, 1);
    if (!keysOf.has(id)) c.noKey++;
  }
  // nodes
  const heldNode = new Uint8Array(nodes.n);
  for (let i = 0; i < nodes.n; i++) {
    const x = nodes.xyz[i * 3], y = nodes.xyz[i * 3 + 1], z = nodes.xyz[i * 3 + 2];
    if (out(x, z, 0.1)) c.outside++;
    const id = nodes.id[i];
    if (seenHere.has(id)) c.idTwiceInFile++;
    seenHere.add(id);
    if (!keysOf.has(id)) c.noKey++;
    const portal = (nodes.flags[i] & NodeFlag.PORTAL) !== 0;
    const line = onLine(x) || onLine(z);
    if (portal) c.portals++;
    let l = nodeSeen.get(id);
    if (!l) nodeSeen.set(id, (l = []));
    l.push({ r: `${rx},${rz}`, x, y, z, portal, line });
    const t = touch[i];
    if (t & 1 && deckDeg[i] >= 2 && standErr(x, z, y) > 0.5 && onDrawnTop(x, y, z)) {
      // where a ground way meets a drawn deck mid-span the deck wins, and the way climbs to it at its end (GRAPHS.md,
      // "Where the ground wins"): counted, and its ways' first steps with it
      heldNode[i] = 1;
      c.held++;
      const er = standErr(x, z, y);
      if (er > c.heldWorst) { c.heldWorst = er; c.heldWhere = `node ${id} (${keysOf.get(id)?.slice(2)}) at ${x.toFixed(1)}, ${z.toFixed(1)}: ${y.toFixed(1)}, the ground ${ground(x, z).toFixed(1)}`; }
    } else if (t & 1) {
      if (Number.isNaN(ground(x, z))) c.landNoTile++;
      c.land++;
      const e = standErr(x, z, y);
      if (e > c.landWorst) { c.landWorst = e; c.landWhere = `node ${id} at ${x.toFixed(1)}, ${z.toFixed(1)}`; }
      if (e > 0.5) c.landOver++;
      if (y < WATER_Y - UNDER_TOL && seaAll(x, z)) { c.underWater++; c.underWhere ??= `node ${id} at ${x.toFixed(1)}, ${z.toFixed(1)}: ${y.toFixed(1)}`; }
    } else if (t === 8 && wet(x, z)) {
      // on the sea at WATER_Y; on a lake at its own height, the grid (C8)
      c.water++;
      const e = sea(x, z) ? Math.abs(y - WATER_Y) : Math.abs(y - ground(x, z));
      c.waterWorst = Math.max(c.waterWorst, sea(x, z) ? e : 0);
      if (sea(x, z) ? e > 1e-3 : e > 0.5) c.waterOff++;
      if (!sea(x, z)) c.waterLake++;
    }
  }
  // edges: their points, the grid every 4 m, water, decks
  const deckPts = [], segs = [];
  for (let e = 0; e < edges.n; e++) {
    const k = cls(e), kind = edges.kind[e], f = edges.flags[e];
    const s0 = edges.shape[e], s1 = edges.shape[e + 1];
    const P = [[nodes.xyz[edges.a[e] * 3], nodes.xyz[edges.a[e] * 3 + 1], nodes.xyz[edges.a[e] * 3 + 2]]];
    for (let s = s0; s < s1; s++) P.push([pts[s * 3], pts[s * 3 + 1], pts[s * 3 + 2]]);
    P.push([nodes.xyz[edges.b[e] * 3], nodes.xyz[edges.b[e] * 3 + 1], nodes.xyz[edges.b[e] * 3 + 2]]);
    let len = 0, across = false;
    const pre = [0]; // the way along the edge to each point
    for (let i = 0; i < P.length; i++) {
      if (i > 0 && i < P.length - 1 && out(P[i][0], P[i][2], 0.1)) c.outside++;
      if (out(P[i][0], P[i][2], 1e-3)) across = true;
      if (i) { len += Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]); pre.push(len); }
    }
    if (across) c.edgesAcross++;
    if (k === 2 && kind === 2) {
      // a walker on a deck never meets a wall: a step between two of a foot deck's points that rises over 1 m faster
      // than a ramp's 50 %, or on stairs a stair's 77.5 % (decks.py STAIR_MAX; a decimetre's rounding over it)
      const stairs = edges.cls[e] === 5;
      for (let i = 0; i < P.length - 1; i++) {
        const dy = Math.abs(P[i + 1][1] - P[i][1]), d = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][2] - P[i][2]);
        c.footDeckSteps++;
        if (dy > 1 && dy > (stairs ? 0.775 * d + 0.1 : 0.5 * d)) {
          c.walls++;
          if ((i === 0 && touch[edges.a[e]] & 1) || (i === P.length - 2 && touch[edges.b[e]] & 1)) c.wallsAtFeet++;
          if (dy > c.wallWorst) { c.wallWorst = dy; c.wallWhere = `edge ${edges.id[e]} (${keysOf.get(edges.id[e])?.slice(2)}, ${FOOT[edges.cls[e]]}) at ${P[i][0].toFixed(1)}, ${P[i][2].toFixed(1)}: ${P[i][1].toFixed(1)} to ${P[i + 1][1].toFixed(1)} in ${d.toFixed(1)} m`; }
        }
      }
    }
    if (edges.a[e] === edges.b[e]) c.selfLoops++;
    if (len < 0.05) c.shortEdges++;
    const name = kind === 1 ? ROAD[edges.cls[e]] : kind === 2 ? 'foot:' + FOOT[edges.cls[e]] : KIND[kind].toLowerCase();
    c.kmByClass[name] = (c.kmByClass[name] ?? 0) + len / 1000;
    if (f & EdgeFlag.UNDRAWN) c.undrawnKm[name] = (c.undrawnKm[name] ?? 0) + len / 1000;
    if (f & EdgeFlag.TUNNEL && f & EdgeFlag.UNDRAWN) c.tunnelUndrawn++;
    if (f & EdgeFlag.NO_CARS) { if (kind === 1) { c.noCars++; c.noCarsKm += len / 1000; } else c.noCarsOff++; }
    const dk =`${KIND[kind]} ${['BOTH', 'FORWARD', 'BACKWARD'][edges.dir[e]] ?? edges.dir[e]}`;
    c.byDir[dk] = (c.byDir[dk] ?? 0) + 1;
    if (edges.dir[e] !== 0) c.oneWay++;
    c.byKind[name] = (c.byKind[name] ?? 0) + 1;
    if (kind === 4) for (const [q, other] of [[edges.a[e], edges.b[e]], [edges.b[e], edges.a[e]]]) {
      const id = nodes.id[q];
      let r = ferryEnd.get(id);
      if (!r) ferryEnd.set(id, (r = { deg: 0, joined: false, portal: (nodes.flags[q] & NodeFlag.PORTAL) !== 0, x: nodes.xyz[q * 3], z: nodes.xyz[q * 3 + 2] }));
      r.deg++;
      if (touch[q] & 7) r.joined = true; // a road or a footway meets it: a berth
    }
    for (let i = 0; i < P.length - 1; i++) {
      if (kind === 1 || kind === 3) segs.push([e, P[i][0], P[i][2], P[i + 1][0], P[i + 1][2]]);
      const [ax, ay, az] = P[i], [bx, by, bz] = P[i + 1];
      const d = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(d / SAMPLE));
      for (let j = i === 0 ? 0 : 1; j <= n; j++) {
        const t = j / n, x = ax + t * (bx - ax), z = az + t * (bz - az), y = ay + t * (by - ay);
        if (k === 1) {
          if ((j === 0 && i === 0) || (j === n && i === P.length - 2)) continue; // the nodes, counted above
          if ((i === 0 && heldNode[edges.a[e]]) || (i === P.length - 2 && heldNode[edges.b[e]])) { c.heldSteps++; continue; } // climbing to a deck that holds its end
          if (Number.isNaN(ground(x, z))) c.landNoTile++;
          c.steps++;
          const er = standErr(x, z, y);
          if (er > c.landWorst) { c.landWorst = er; c.landWhere = `edge ${edges.id[e]} at ${x.toFixed(1)}, ${z.toFixed(1)}`; }
          if (er > 0.5) c.landOver++;
          if (y < WATER_Y - UNDER_TOL && seaAll(x, z)) { c.underWater++; c.underWhere ??= `edge ${edges.id[e]} at ${x.toFixed(1)}, ${z.toFixed(1)}: ${y.toFixed(1)}`; }
        } else if (k === 2) {
          // (its last field: a step at a node a ground way meets, the deck's own foot, where the bake's anchors win)
          const foot = (i === 0 && j === 0 && (touch[edges.a[e]] & 1) !== 0) || (i === P.length - 2 && j === n && (touch[edges.b[e]] & 1) !== 0);
          const node = i === 0 && j === 0 ? nodes.id[edges.a[e]] : i === P.length - 2 && j === n ? nodes.id[edges.b[e]] : -1; // a step at a node, each of its edges'
          // within 5 m of its foot (the bake's 4 m, a sample's step): a road's climb to the ground there, no carriageway
          const sa = pre[i] + t * d, nearFoot = ((touch[edges.a[e]] & 1) !== 0 && sa < 5) || ((touch[edges.b[e]] & 1) !== 0 && len - sa < 5);
          deckPts.push([x, y, z, edges.level[e], e, d > 0 ? (bx - ax) / d : 0, d > 0 ? (bz - az) / d : 0, edges.kind[e], foot, node, nearFoot]);
          // a deck never under the ground on land, under the sea's surface, or under a lake's (the grid there). On the
          // sea within a millimetre, as the water's own check: a deck's foot on the sea stands at WATER_Y, which the
          // file's f32 reads as -0.6000000238
          const h = ground(x, z), lake = !sea(x, z) && wet(x, z);
          const under = sea(x, z) ? WATER_Y - 1e-3 - y : h - 0.5 - y;
          c.deckGround++;
          if (under > 0 && decks.some((dk) => { const r = near(x, z, dk); return r.best <= 44 && !r.ext; })) c.deckDrawn++; // C2's: City draws it there
          else if (under > 0) { c.deckUnder++; if (under > c.deckUnderWorst) { c.deckUnderWorst = under; c.deckUnderWhere = `edge ${edges.id[e]} (${keysOf.get(edges.id[e])?.slice(2)}) at ${x.toFixed(1)}, ${z.toFixed(1)}: ${y.toFixed(1)}, ${sea(x, z) ? 'the sea' : lake ? 'a lake' : 'the ground'} ${(sea(x, z) ? WATER_Y : h).toFixed(1)}`; } }
        } else if (k === 4) {
          // a tunnel never over the ground (the bed, where wet; WATER_Y with no tile), but where it comes down from an
          // end of its edge at the bake's grade: a portal can stand over the ground (decks.under)
          const h = Number.isNaN(ground(x, z)) ? WATER_Y : ground(x, z);
          const sa = pre[i] + t * d, ya = P[0][1], yb = P[P.length - 1][1];
          c.tunnelPts++;
          const gr = kind === 3 ? 0.035 : kind === 2 ? 0.5 : 0.06; // decks.py GRADE_STAIR: a road's 6 %, a railway's 3.5 %, a stair's 50 % on foot
          if (y > Math.max(h + 0.5, ya - gr * sa + 0.5, yb - gr * (len - sa) + 0.5)) { c.tunnelOver++; if (y - h > c.tunnelOverWorst) { c.tunnelOverWorst = y - h; c.tunnelOverWhere = `edge ${edges.id[e]} at ${x.toFixed(1)}, ${z.toFixed(1)}: ${y.toFixed(1)} over ${h.toFixed(1)}`; } }
        }
      }
      if (k === 8) {
        // every 10 m on water, but within 150 m of a route's end
        const m = Math.max(1, Math.ceil(d / 10));
        for (let j = 0; j <= m; j++) {
          const t = j / m, x = ax + t * (bx - ax), z = az + t * (bz - az);
          c.ferrySamples++;
          if (nearEnd(x, z)) { c.ferryExempt++; continue; }
          if (!wet(x, z)) { c.ferryOnLand++; c.ferryLandWhere ??= `edge ${edges.id[e]} at ${x.toFixed(1)}, ${z.toFixed(1)}`; }
        }
        // anywhere along it, on water, a pier or its last 150 m, never under the sea's surface: a boat floats
        for (const q of i === 0 ? [P[0], P[1]] : [P[i + 1]]) {
          c.afloat++;
          if (q[1] < WATER_Y - 1e-3) { c.afloatUnder++; if (WATER_Y - q[1] > c.afloatWorst) { c.afloatWorst = WATER_Y - q[1]; c.afloatWhere = `edge ${edges.id[e]} (${keysOf.get(edges.id[e])?.slice(2)}) at ${q[0].toFixed(1)}, ${q[2].toFixed(1)}: ${q[1].toFixed(2)}`; } }
        }
        for (const q of [P[i + 1]]) {
          if (i + 1 < P.length - 1 && wet(q[0], q[2])) {
            // on the sea at WATER_Y; on a lake at its own height, the grid (C8)
            c.water++;
            const s = sea(q[0], q[2]), er = s ? Math.abs(q[1] - WATER_Y) : Math.abs(q[1] - ground(q[0], q[2]));
            if (s) c.waterWorst = Math.max(c.waterWorst, er); else c.waterLake++;
            if (s ? er > 1e-3 : er > 0.5) c.waterOff++;
          }
        }
      }
    }
  }
  // the rules: the road or rail edge through each rule's place, along it within 30 degrees, nearest within 0.6 m. A
  // one-way's must run the way the rule lets travel go; a closing rule's must be NO_CARS
  {
    const sg = new Map();
    for (const s of segs) {
      for (let gx = Math.floor((Math.min(s[1], s[3]) - 1) / 8); gx <= Math.floor((Math.max(s[1], s[3]) + 1) / 8); gx++)
        for (let gz = Math.floor((Math.min(s[2], s[4]) - 1) / 8); gz <= Math.floor((Math.max(s[2], s[4]) + 1) / 8); gz++) {
          const k = `${gx},${gz}`;
          if (!sg.has(k)) sg.set(k, []);
          sg.get(k).push(s);
        }
    }
    for (const [what, x, z, ux, uz, kind, lv] of ruleAt.get(`${rx},${rz}`) ?? []) {
      let best = 0.6, hit = null;
      for (const s of sg.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`) ?? []) {
        const vx = s[3] - s[1], vz = s[4] - s[2], L = Math.hypot(vx, vz);
        if (L < 1e-6 || edges.kind[s[0]] !== kind || edges.level[s[0]] !== Math.max(-128, Math.min(127, lv))) continue;
        const t = Math.min(1, Math.max(0, ((x - s[1]) * vx + (z - s[2]) * vz) / (L * L)));
        const d = Math.hypot(s[1] + t * vx - x, s[2] + t * vz - z);
        if (d < best && (what === 1 || Math.abs((vx * ux + vz * uz) / L) >= Math.cos(Math.PI / 6))) { best = d; hit = [s[0], vx / L, vz / L]; }
      }
      if (!hit) { c.ruleMiss[what]++; continue; }
      const [e, vx, vz] = hit;
      if (what === 1) { c.ruleSeen[1]++; if (!(edges.flags[e] & EdgeFlag.NO_CARS)) { c.ruleWrong[1]++; c.ruleWhere[1] ??= `edge ${edges.id[e]} (${keysOf.get(edges.id[e])?.slice(2)}) at ${x}, ${z}`; } continue; }
      c.ruleSeen[0]++;
      const dir = edges.dir[e], along = vx * ux + vz * uz > 0; // the rule's way of travel along the edge's a to b
      if (!(dir === 1 && along) && !(dir === 2 && !along)) { c.ruleWrong[0]++; c.ruleWhere[0] ??= `edge ${edges.id[e]} (${keysOf.get(edges.id[e])?.slice(2)}) at ${x}, ${z}: ${['BOTH', 'FORWARD', 'BACKWARD'][dir]}, travel ${along ? 'a to b' : 'b to a'}`; }
    }
  }
  // decks along a deck City draws (C2): an edge most of whose steps run within 22 m of its line, between its ends and
  // heading within 30 degrees of it takes its top at every step between its ends within 44 m, a lower level 5.5 m a
  // level under the highest along it, never under the ground. Checked after the files, on the edges well inside that
  // (60 % of their steps within 21.5 m and 28 degrees) and their steps within 40 m
  const along = new Map(); // `${edge},${deck}` -> [steps, steps along]
  for (const [x, , z, , e, ux, uz] of deckPts) {
    for (let k = 0; k < decks.length; k++) {
      const q = near(x, z, decks[k]), key = `${e},${k}`, a = along.get(key) ?? [0, 0, 0];
      a[0]++;
      const heading = Math.abs(ux * q.vx + uz * q.vz) >= Math.cos((28 * Math.PI) / 180);
      if (q.best <= 21.5 && !q.ext && heading) a[1]++;
      if (q.best <= 40 && !q.ext && heading) a[2]++;
      along.set(key, a);
    }
  }
  // an edge whose foot (its structure's end on the ground: a ground way meets it, no other deck edge does) stands
  // beside a drawn deck well inside its ends is a ramp down to the street, not on it (the bake's rule: 44 m from the
  // line, more than 44 m in from each end; 48 and 40 here). A foot by a drawn deck's end is where the deck meets the
  // ground: the edge is on the deck to there
  const offRamp = (e, k) => [edges.a[e], edges.b[e]].some((q) => (touch[q] & 1) && deckDeg[q] === 1 && (() => {
    const r = near(nodes.xyz[q * 3], nodes.xyz[q * 3 + 2], decks[k]);
    return r.best <= 48 && r.s > 40 && r.s < r.length - 40;
  })());
  for (const [x, y, z, lv, e, ux, uz, kind, foot, node, nearFoot] of deckPts) {
    for (let k = 0; k < decks.length; k++) {
      const a = along.get(`${e},${k}`);
      if (!a) continue;
      if (a[1] >= 0.5 * a[0]) c.topLevel[k] = Math.max(c.topLevel[k] ?? 1, Math.max(1, lv)); // the highest level along it, as the bake reads it
      if (a[2] < 0.6 * a[0] || offRamp(e, k)) continue;
      // a node a street meets stands on the street (the bake's anchors win)
      if ([edges.a[e], edges.b[e]].some((q) => (touch[q] & 1) && Math.hypot(nodes.xyz[q * 3] - x, nodes.xyz[q * 3 + 2] - z) < 0.01)) continue;
      const q = near(x, z, decks[k]);
      if (q.best <= 40 && !q.ext) c.drawnPts.push([k, y, q.top, Math.max(1, lv), edges.id[e], x, z, sea(x, z) || wet(x, z) ? NaN : ground(x, z)]);
    }
    if (kind === 2 && edges.cls[e] !== 5) c.footDeck.push([x, y, z, Math.max(1, lv), ux, uz, foot, node]); // stairs climb: they ride nothing
    else if (kind === 1 && !foot && !nearFoot) c.roadDeck.push([x, y, z, Math.max(1, lv), ux, uz]); // a road's foot is the ground's: no carriageway
  }
  // decks a chain of deck edges joins, anywhere in the city (by node ids: a portal is one id in two files), are one
  // structure, its levels changing along its ramps; stacking is checked between two that nothing joins, after the files
  for (let e = 0; e < edges.n; e++) if (cls(e) === 2) deckJoin(nodes.id[edges.a[e]], nodes.id[edges.b[e]]);
  for (const q of deckPts) allDeck.push([q[0], q[1], q[2], q[3], edges.id[q[4]], nodes.id[edges.a[q[4]]]]);
  // areas: the grid's points inside each triangle; OPEN_WATER on water: the sea's (`water@`) flat at WATER_Y on the
  // sea's texels, a lake's (`lake@`, C8) on the lake's texels at the grid's height; both cover their texels whole
  const cover = new Uint8Array((REGION_M / 2) * (REGION_M / 2)); // per texel: 1 the sea's area covers its centre, 2 a lake's
  const mark = (x, z, b) => { const i = Math.floor((x - x0) / 2), j = Math.floor((z - z0) / 2); if (i >= 0 && j >= 0 && i < REGION_M / 2 && j < REGION_M / 2) cover[j * (REGION_M / 2) + i] |= b; };
  for (let a = 0; a < areas.n; a++) {
    const kind = areas.kind[a];
    const lake = kind === 8 && (keysOf.get(areas.id[a]) ?? '').slice(2).startsWith('lake@');
    if (kind === 8) { if (lake) c.lakeAreas++; else c.seaAreas++; }
    c.areaByKind[AREA[kind]] = (c.areaByKind[AREA[kind]] ?? 0) + 1;
    if (areas.name[a] !== 0xffff) c.names.add(g.names[areas.name[a]]);
    let l = areaSeen.get(areas.id[a]);
    if (!l) areaSeen.set(areas.id[a], (l = new Set()));
    if (l.has(`${rx},${rz}`)) c.idTwiceInFile++;
    l.add(`${rx},${rz}`);
    if (!keysOf.has(areas.id[a])) c.noKey++;
    if (onStructure.has(keysOf.get(areas.id[a])?.slice(2))) { c.areaOnStructure++; c.areaOnStructureWhere ??= keysOf.get(areas.id[a]).slice(2); }
    for (let t = areas.tri[a]; t < areas.tri[a + 1]; t++) {
      const v = areas.xyz.subarray(t * 9, t * 9 + 9);
      const minx = Math.min(v[0], v[3], v[6]), maxx = Math.max(v[0], v[3], v[6]);
      const minz = Math.min(v[2], v[5], v[8]), maxz = Math.max(v[2], v[5], v[8]);
      const det = (v[5] - v[8]) * (v[0] - v[6]) + (v[6] - v[3]) * (v[2] - v[8]);
      if (Math.abs(det) < 1e-9) continue;
      const bary = (x, z) => {
        const l0 = ((v[5] - v[8]) * (x - v[6]) + (v[6] - v[3]) * (z - v[8])) / det;
        const l1 = ((v[8] - v[2]) * (x - v[6]) + (v[0] - v[6]) * (z - v[8])) / det;
        return [l0, l1, 1 - l0 - l1];
      };
      if (kind === 8) {
        // texel centres on the triangle's edge count for covering; strictly inside, for what they are
        if (lake) c.lakeTris++;
        else {
          c.waterTris++;
          if (Math.abs(v[1] - WATER_Y) > 1e-3 || Math.abs(v[4] - WATER_Y) > 1e-3 || Math.abs(v[7] - WATER_Y) > 1e-3) c.waterTriY++;
        }
        for (let x = Math.floor(minx / 2) * 2 + 1; x <= maxx; x += 2) for (let z = Math.floor(minz / 2) * 2 + 1; z <= maxz; z += 2) {
          const [l0, l1, l2] = bary(x, z);
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          mark(x, z, lake ? 2 : 1);
          if (l0 < 1e-9 || l1 < 1e-9 || l2 < 1e-9) continue;
          if (lake) { c.lakeTexelsIn = (c.lakeTexelsIn ?? 0) + 1; if (sea(x, z) || !wet(x, z)) c.lakeOffTexels++; }
          else { c.waterTexels++; if (!sea(x, z)) c.waterOffTexels++; }
        }
        if (!lake) continue; // a lake's heights: the grid's, below
      }
      for (let x = Math.ceil(minx / 4) * 4; x <= maxx; x += 4) for (let z = Math.ceil(minz / 4) * 4; z <= maxz; z += 4) {
        const [l0, l1, l2] = bary(x, z);
        if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
        let h = ground(x, z);
        if (Number.isNaN(h)) continue;
        h = standAt(x, z); // an area stands as a node does: the grid, never under the sea's surface; on a lake, the grid
        c.areaPts++;
        const er = Math.abs(l0 * v[1] + l1 * v[4] + l2 * v[7] - h);
        if (er > c.areaWorst) { c.areaWorst = er; c.areaWhere = `area ${areas.id[a]} (${lake ? 'OPEN_WATER, a lake' : AREA[kind]}) at ${x}, ${z}`; }
        if (er > 0.5) c.areaOver++;
      }
    }
  }
  // every WATER texel of the region's tiles under its own water's area, the sea's or a lake's, and every texel of a
  // tile slot with no tile inside the bounds under the sea's (C1, C8); raised WATER in a run that touches the sea, the
  // sea's (C10)
  const held = seaHeld.get(`${rx},${rz}`);
  for (let j = 0; j < RS; j++) for (let i = 0; i < RS; i++) {
    const tx = rx * RS + i, tz = rz * RS + j, ox = tx * T, oz = tz * T;
    if (ox + T <= bx0 || ox >= bx1 || oz + T <= bz0 || oz >= bz1) continue;
    const t = have.has(`${tx},${tz}`) ? regionTiles(rx, rz).get(`${tx},${tz}`) ?? null : null;
    const W = REGION_M / 2, k0 = (oz - z0) / 2, l0 = (ox - x0) / 2;
    for (let q = 0; q < CN; q++) for (let p = 0; p < CN; p++) {
      const cv = cover[(k0 + q) * W + l0 + p];
      if (!t) { c.seaTexels++; if (cv & 1) c.seaCovered++; continue; }
      if ((t.cls[q * CN + p] & 15) !== WATER) continue;
      const fx = Math.min(t.n - 1.001, Math.max(0, ((p + 0.5) * (T / CN)) / t.cell)), fz = Math.min(t.n - 1.001, Math.max(0, ((q + 0.5) * (T / CN)) / t.cell));
      const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz, hh = t.heights, n = t.n;
      const H = (hh[iz * n + ix] * (1 - ax) + hh[iz * n + ix + 1] * ax) * (1 - az) + (hh[(iz + 1) * n + ix] * (1 - ax) + hh[(iz + 1) * n + ix + 1] * ax) * az;
      if (H > LAKE_M && !held?.has((k0 + q) * W + l0 + p)) { c.lakeTexels++; if (cv & 2) c.lakeCovered++; else c.lakeMissWhere ??= `${(ox + (p + 0.5) * 2).toFixed(0)}, ${(oz + (q + 0.5) * 2).toFixed(0)}`; }
      else { c.seaTexels++; if (H > LAKE_M) c.seaRaised++; if (cv & 1) c.seaCovered++; else c.seaMissWhere ??= `${(ox + (p + 0.5) * 2).toFixed(0)}, ${(oz + (q + 0.5) * 2).toFixed(0)}`; }
    }
  }
}

// ------------------------------------------------------------ across regions
{
  const grid = new Map();
  for (const q of allDeck) {
    const k = `${Math.floor(q[0] / 4)},${Math.floor(q[2] / 4)}`;
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(q);
  }
  for (const q of allDeck) {
    const gx = Math.floor(q[0] / 4), gz = Math.floor(q[2] / 4);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const r of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
        if (r[3] <= q[3] || r[4] === q[4]) continue;
        if (Math.hypot(r[0] - q[0], r[2] - q[2]) > 3) continue;
        if (deckFind(q[5]) === deckFind(r[5])) { c.rampPairs++; continue; }
        c.stackPairs++;
        if (r[1] < q[1] + 0.1) { c.inversions++; c.inversionWhere ??= `levels ${q[3]} and ${r[3]} at ${q[0].toFixed(1)}, ${q[2].toFixed(1)}: ${q[1].toFixed(1)} over ${r[1].toFixed(1)}`; }
      }
    }
  }
}
let twinless = 0, twinsApart = 0, twinsWorst = 0, idOther = 0;
for (const [id, l] of nodeSeen) {
  const regs = new Set(l.map((q) => q.r));
  if (l.length > regs.size) idOther++;
  if (l.some((q) => q.portal)) {
    if (regs.size < 2 || !l.every((q) => q.portal)) twinless++;
    for (const q of l) for (const r of l) {
      const d = Math.hypot(q.x - r.x, q.y - r.y, q.z - r.z);
      twinsWorst = Math.max(twinsWorst, d);
      if (d > 0.01) twinsApart++;
    }
  } else if (regs.size > 1) idOther++;
  else if (l[0].line) {
    // a node on a region line with edges on one side only: a dead end there; C1 when the cell across has no file
    c.lineDeadEnds++;
    const q = l[0];
    const [rx, rz] = q.r.split(',').map(Number);
    const across = [];
    if (onLine(q.x)) across.push(Math.abs(q.x - rx * REGION_M) < 1e-3 ? [rx - 1, rz] : [rx + 1, rz]);
    if (onLine(q.z)) across.push(Math.abs(q.z - rz * REGION_M) < 1e-3 ? [rx, rz - 1] : [rx, rz + 1]);
    const inBounds = ([a, b]) => a >= Math.floor(bx0 / REGION_M) && a < Math.ceil(bx1 / REGION_M) && b >= Math.floor(bz0 / REGION_M) && b < Math.ceil(bz1 / REGION_M);
    if (across.some((q) => inBounds(q) && !regionSet.has(`${q[0]},${q[1]}`))) c.lineDeadC1++;
  }
}
for (const id of nodeSeen.keys()) if (edgeSeen.has(id) || areaSeen.has(id)) c.idKinds++;
for (const id of edgeSeen.keys()) if (areaSeen.has(id)) c.idKinds++;

const km = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
const largest = c.sizes.sort((a, b) => b[0] - a[0])[0] ?? [0, 0, 0];
const med = c.sizes.length ? c.sizes.map((s) => s[0]).sort((a, b) => a - b)[c.sizes.length >> 1] : 0;

console.log(`\nW1 ${slug}: ${dir}`);
{
  const listed = new Set(regions.map(([a, b]) => `${a},${b}`));
  const tileless = regions.filter(([a, b]) => !man.regions.some((r) => r[0] === a && r[1] === b)).length;
  const unlisted = man.regions.filter((r) => !listed.has(`${r[0]},${r[1]}`)).length;
  report('graph files (C1)', `${c.files} of ${regions.length} in life.regions, ${c.missing} missing, ${tileless} where City has no tile, ${unlisted} of City's ${man.regions.length} regions not listed, ${c.cellsOut} outside the bounds, ${c.bytesOff} whose bytes aren't listed's`,
    'every file listed, every City region listed', !!life.regions && regions.length > 0 && c.missing === 0 && unlisted === 0 && c.cellsOut === 0 && c.bytesOff === 0);
}
report('graph files parse with the shipped parser', `${c.files - c.parseFail} of ${c.files}, version ${L.GRAPH_VERSION}`, 'every one', c.parseFail === 0);
report('graph file sizes', `${(c.gz / 1e6).toFixed(2)} MB gzipped (${(c.raw / 1e6).toFixed(2)} MB raw), median ${(med / 1024).toFixed(1)} KB, largest ${(largest[0] / 1024).toFixed(1)} KB at ${largest[1]}, ${largest[2]}`, '128 KB each', c.tooBig === 0);
report('counts', `${c.nodes} nodes, ${c.edges} edges, ${c.points} inner points, ${c.areas} areas, ${c.tris} triangles`, '');
report('edges by class', Object.entries(c.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '), '');
report('km by class', km(c.kmByClass), '');
report('every edge\'s nodes exist', 'the parser checks a and b against the nodes', 'any missing: no parse', c.parseFail === 0);
report('places outside their region', `${c.outside} nodes and points over 0.1 m out`, '0', c.outside === 0);
report('edges across a region line', c.edgesAcross, '0', c.edgesAcross === 0);
report('portals', `${c.portals} portal nodes; ${twinless} with no twin; ${twinsApart} twin pairs over 1 cm apart (worst ${(twinsWorst * 100).toFixed(2)} cm)`, '0 and 0', twinless === 0 && twinsApart === 0);
report('ids twice', `${c.idTwiceInFile} twice in one file or edge ids twice; ${idOther} node ids in two regions but not portals; ${c.idKinds} ids of two kinds`, '0', c.idTwiceInFile === 0 && idOther === 0 && c.idKinds === 0);
report('keys', `${keysOf.size} in gkeys.bin; ${keyDup} keys with two ids within a kind, ${idDup} ids with two keys, ${c.noKey} ids with no key`, '0', keyDup === 0 && idDup === 0 && c.noKey === 0);
{
  // node keys (1.3, C4 0.6): a connector's OSM node or GERS id; every other node its edge's way and its own place in
  // whole decimetres, `w31772645@-71680,-22103`, which must be where the node is
  const f = { 'connector, OSM node': 0, 'connector, GERS id': 0, 'way and place (C4)': 0, 'another form': 0, 'place not the node\'s': 0 };
  let where = null;
  for (const [id, l] of nodeSeen) {
    const k = keysOf.get(id);
    if (!k || !k.startsWith('0:')) continue;
    const s = k.slice(2);
    if (!s.includes('@')) { f[/^n\d+$/.test(s) ? 'connector, OSM node' : 'connector, GERS id']++; continue; }
    const m = /@(-?\d+),(-?\d+)$/.exec(s);
    if (!m) { f['another form']++; where ??= s; continue; }
    f['way and place (C4)']++;
    if (Math.abs(Number(m[1]) - l[0].x * 10) > 1 || Math.abs(Number(m[2]) - l[0].z * 10) > 1) { f['place not the node\'s']++; where ??= `${s} at ${l[0].x.toFixed(1)}, ${l[0].z.toFixed(1)}`; }
  }
  report('node keys (C4)', Object.entries(f).map(([k, v]) => `${k} ${v}`).join(', ') + (where ? ` (first: ${where})` : ''), 'no other form, each place the node\'s', f['another form'] === 0 && f['place not the node\'s'] === 0);
}
report('edges from a node to itself', `${c.selfLoops}; ${c.shortEdges} edges under 5 cm in plan (a cut by a junction: both ends can fall in one decimetre)`, '0', c.selfLoops === 0);
report('nodes on a region line with edges one side only', `${c.lineDeadEnds}, ${c.lineDeadC1} of them where the cell across, inside the bounds, has no file (C1)`, '0 where the cell across has no file', c.lineDeadC1 === 0);
report('direction', Object.entries(c.byDir).sort().map(([k, v]) => `${k} ${v}`).join(', '), '');
report('one-way edges against the bake\'s count', `${c.oneWay} in the files, ${life.stats?.oneWay?.edges} in life.stats (from ${life.stats?.oneWay?.rulesRead} rules read)`, 'the same', c.oneWay === life.stats?.oneWay?.edges);
{
  // direction and NO_CARS against the rules themselves (the check file), not the bake's counts: a swap of FORWARD and
  // BACKWARD, or every edge BOTH, fails here
  const n = [checks?.oneway.length ?? 0, checks?.noCars.length ?? 0];
  for (const [w, name, lim] of [[0, 'one-way rules against the edges', 'travel as the rule lets it'], [1, 'closing rules against NO_CARS (C6)', 'NO_CARS']]) {
    report(name, `${c.ruleSeen[w]} of ${n[w]} rules found on their edge, ${c.ruleWrong[w]} wrong${c.ruleWhere[w] ? ` (first: ${c.ruleWhere[w]})` : ''}, ${c.ruleMiss[w]} not found within 0.6 m${w === 0 ? `; ${checks?.onewayConflicts ?? 0} places two headings cover, not checked` : ''}`,
      `${lim}; under 1 % not found`, !!checks && n[w] > 0 && c.ruleWrong[w] === 0 && c.ruleMiss[w] <= 0.01 * n[w]);
  }
}
report('tunnels that are UNDRAWN', c.tunnelUndrawn, '0', c.tunnelUndrawn === 0);
{
  // C6: NO_CARS on roads only, in files of minor 1 and up, and set wherever the bake read a rule closing a road to cars
  const rules = life.stats?.noCars?.segmentsWithARule ?? 0;
  report('NO_CARS (C6)', `${c.noCars} road edges, ${c.noCarsKm.toFixed(1)} km; ${c.noCarsOff} not roads; files of minor ${[...c.minors].sort().join(', ')}; ${rules} road segments with a rule closing cars out (life.stats)`,
    'roads only, minor 1, some wherever a rule says', c.noCarsOff === 0 && [...c.minors].every((m) => m >= 1) && (rules === 0 || c.noCars > 0));
}
const mw = c.kmByClass.motorway ?? 0, mu = c.undrawnKm.motorway ?? 0;
report('UNDRAWN km by class', km(c.undrawnKm) || 'none', '', null, `motorway ${mw ? ((100 * mu) / mw).toFixed(0) : 0} % of ${mw.toFixed(1)} km (the audit's surface share: 68 %)`);
report('land within 0.5 m of the grid', `${c.land} land nodes and ${c.steps} steps of 4 m or less along land edges, against the grid and never under the sea's surface; worst ${c.landWorst.toFixed(3)} m (${c.landWhere}); ${c.landOver} over; ${c.landNoTile} with no tile, at WATER_Y`, '0 over 0.5 m', c.landOver === 0);
{
  const [a, la] = capOf('heldNodes', c.held, c.heldWorst), [b, lb] = capOf('heldSteps', c.heldSteps);
  report('  where a drawn deck wins (known)', `${c.held} nodes where a ground way meets a drawn deck mid-span stand on its top${c.held ? ` (worst ${c.heldWorst.toFixed(1)} m over the grid: ${c.heldWhere})` : ''}, and ${c.heldSteps} steps of their ways climbing to it`, `nodes ${la}; steps ${lb}`, a && b);
}
report('ground under the drawn water', `${c.underWater} land nodes and steps under WATER_Y on the sea${c.underWhere ? ` (first: ${c.underWhere})` : ''}`, '0', c.underWater === 0);
report('water at WATER_Y, a lake at its height (C8)', `${c.water} water nodes and points, ${c.waterLake} of them on a lake; on the sea worst ${c.waterWorst.toFixed(4)} m off WATER_Y; ${c.waterOff} off by over 1 mm on the sea or 0.5 m from a lake's grid`, '0', c.waterOff === 0);
report('ferries and water edges never under the water', `${c.afloat} nodes and points of FERRY and WATER edges, anywhere along them; ${c.afloatUnder} more than 1 mm under WATER_Y${c.afloatWhere ? ` (worst ${c.afloatWorst.toFixed(2)} m under: ${c.afloatWhere})` : ''}`, '0', c.afloatUnder === 0);
report('decks over the ground and the water', `${c.deckGround} deck steps, ${c.deckDrawn} under the ground on a drawn deck (C2: where City draws it); ${c.deckUnder} more under the ground by over 0.5 m, under the sea's surface, or a lake's by over 0.5 m${c.deckUnderWhere ? ` (worst ${c.deckUnderWorst.toFixed(1)} m: ${c.deckUnderWhere})` : ''}`, '0', c.deckUnder === 0);
report('tunnels under the ground', `${c.tunnelPts} tunnel steps; ${c.tunnelOver} over the ground or the bed by over 0.5 m${c.tunnelOverWhere ? ` (worst ${c.tunnelOverWorst.toFixed(1)} m: ${c.tunnelOverWhere})` : ''}`, '0', c.tunnelOver === 0);
{
  // C2 (0.6): a deck along a deck City draws takes its top within 0.3 m, a lower level 5.5 m a level under the highest
  // along it. W1 checks the points well inside the bake's reach (21.5 m of 22, 28 degrees of 30)
  const topLevel = decks.map((_, k) => c.topLevel[k] ?? 1);
  const off = [];
  let where = null, worst = 0;
  let grounded = 0;
  for (const [k, y, top, lv, id, x, z, h] of c.drawnPts) {
    const want = top - 5.5 * (topLevel[k] - lv);
    if (lv < topLevel[k] && h > want) { grounded++; continue; } // a lower deck the ground holds up: the check above
    const er = Math.abs(y - want);
    off.push(er);
    if (er > worst) { worst = er; where = `edge ${id} (${keysOf.get(id)?.slice(2)}) at ${x.toFixed(1)}, ${z.toFixed(1)}, level ${lv} of ${topLevel[k]}`; }
  }
  off.sort((a, b) => a - b);
  const over = off.filter((v) => v > 0.3).length;
  report('decks along the drawn decks (C2)', off.length ? `${off.length} deck steps along ${decks.length} drawn decks (top levels ${topLevel.join(', ')}; ${grounded} of a lower level on the ground, not checked here): median ${off[off.length >> 1].toFixed(2)} m off, worst ${worst.toFixed(2)} m (${where}); ${over} over 0.3 m` : 'no deck steps along a drawn deck',
    'within 0.3 m', decks.length === 0 || (off.length > 0 && over === 0));
}
{
  // a sidewalk on a bridge rides its carriageway: foot deck steps within 14 m of a road deck's at one level, heading with it
  const grid = new Map();
  for (const q of c.roadDeck) { const k = `${Math.floor(q[0] / 15)},${Math.floor(q[2] / 15)}`; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(q); }
  // Where the ground wins (GRAPHS.md, "Where the ground wins"), counted and not checked: a sidewalk's own foot, where
  // a ground way meets it and the bake's anchors stand it on the ground (as the drawn decks' check has it), and a step
  // the ground holds over its road, which a sidewalk riding it never goes under
  // A road's own foot is no carriageway (it's the ground's, left out of roadDeck). A step at a node is one per edge
  // there, each against the road its own edge heads along: a node has one height, so it rides one of them, and passes
  // if it rides any (where a crossing meets a sidewalk between two carriageways at two heights)
  // It rides a carriageway: within 1 m of a road deck beside it, any within 14 m at its level heading with it. The bake
  // rides the nearest by its own samples, and W1's steps lie elsewhere, so between two carriageways at two heights
  // (one 12.6 m away at 39.9 m, one 13.1 m away at 41.1) the nearest flips: counted when it rides one but the nearest
  let n = 0, over = 0, worst = 0, where = null, other = 0;
  const known = { feet: [0, 0, null], held: [0, 0, null] };
  const note = (w, er, at) => { const q = known[w]; q[0]++; if (er > q[1]) { q[1] = er; q[2] = at; } };
  const atNode = new Map(); // node id -> its steps' [er, at, held], one an edge
  for (const [x, y, z, lv, ux, uz, foot, node] of c.footDeck) {
    let best = 14, near = null, er = Infinity, by = null;
    const gx = Math.floor(x / 15), gz = Math.floor(z / 15);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const r of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
      const d = Math.hypot(r[0] - x, r[2] - z);
      if (d >= 14 || r[3] !== lv || Math.abs(r[4] * ux + r[5] * uz) < Math.cos((28 * Math.PI) / 180)) continue;
      if (d < best) { best = d; near = r[1]; }
      if (Math.abs(y - r[1]) < er) { er = Math.abs(y - r[1]); by = r[1]; }
    }
    if (by === null) continue;
    if (er <= 1 && Math.abs(y - near) > 1) other++;
    const at = `${x.toFixed(1)}, ${z.toFixed(1)}: ${y.toFixed(1)} beside ${by.toFixed(1)}`;
    if (er > 1 && foot) { note('feet', er, at); continue; }
    const held = er > 1 && !wet(x, z) && Math.abs(y - ground(x, z)) <= 0.5 && ground(x, z) > by + 1;
    if (node >= 0) { let l = atNode.get(node); if (!l) atNode.set(node, (l = [])); l.push([er, held ? `${at}, the ground ${ground(x, z).toFixed(1)}` : at, held]); continue; }
    if (held) { note('held', er, `${at}, the ground ${ground(x, z).toFixed(1)}`); continue; }
    n++;
    if (er > 1) over++;
    if (er > worst) { worst = er; where = at; }
  }
  for (const l of atNode.values()) {
    l.sort((a, b) => a[0] - b[0]);
    const [er, at, held] = l[0]; // the road it rides, if it rides one
    if (held) { note('held', er, at); continue; }
    n++;
    if (er > 1) over++;
    if (er > worst) { worst = er; where = at; }
  }
  const kn = (q, what) => `${q[0]} ${what}${q[0] ? ` (worst ${q[1].toFixed(1)} m: ${q[2]})` : ''}`;
  const [oo, lo] = capOf('otherRoad', other);
  report('sidewalks beside their carriageway', `${n} foot deck steps within 14 m of a road deck at their level; worst ${worst.toFixed(1)} m from the nearest in height${where ? ` (${where})` : ''}; ${over} over 1 m; ${other} riding a road beside them that isn't the nearest`, `0 over 1 m; riding another ${lo}`, over === 0 && oo);
  const [fa, la] = capOf('feet', known.feet[0], known.feet[1]), [ha, lh] = capOf('held', known.held[0], known.held[1]);
  report('  where the ground wins (known)', `${kn(known.feet, 'at their own feet on the ground')}; ${kn(known.held, 'held by the ground over their road')}`, `feet ${la}; held ${lh}`, fa && ha);
}
{
  // the walls the studio's calls leave at a deck's feet (a foot on the ground beside a deck held up, a drawn deck held
  // mid-span), and those along the decks that W1 found the night it learned to look, in the files before too (one
  // traced: riding that flips between two carriageways at two heights): known, the next pass's, and nothing past them
  const [ok, l] = capOf('walls', c.walls, c.wallWorst);
  report('walls on foot decks (known)', `${c.footDeckSteps} steps between foot deck points; ${c.walls} rising over 1 m faster than a ramp's 50 % or, on stairs, a stair's 77.5 %, ${c.wallsAtFeet} of them at a foot${c.wallWhere ? ` (worst ${c.wallWorst.toFixed(1)} m: ${c.wallWhere})` : ''}`, l, ok);
}
report('stacked decks by level', `${c.stackPairs} pairs of deck points within 3 m of a higher level on another structure; ${c.inversions} where the higher isn't 0.1 m higher${c.inversionWhere ? ` (${c.inversionWhere})` : ''}; ${c.rampPairs} pairs on one structure, across its ramps, not checked`, '0', c.inversions === 0);
report('ferries on water inside the map', `${c.ferrySamples} samples every 10 m, ${c.ferryExempt} within 150 m of a route's end; ${c.ferryOnLand} on land${c.ferryLandWhere ? ` (first: ${c.ferryLandWhere})` : ''}`, '0', c.ferryOnLand === 0);
let endsOff = 0, endsIn = 0, endClass = {};
for (const f of routes?.ferries ?? []) {
  const n = f.lat.length;
  for (const [i, tid] of [[0, f.from], [n - 1, f.to]]) {
    const t = termById.get(tid);
    if (!t) { endsOff++; continue; }
    const [ex, ez] = latLonToLocal(f.lat[i], f.lon[i], man.origin), [tx, tz] = latLonToLocal(t.lat, t.lon, man.origin);
    if (Math.hypot(ex - tx, ez - tz) > 150) endsOff++;
    if (ex >= bx0 && ex <= bx1 && ez >= bz0 && ez <= bz1) {
      endsIn++;
      const k = klass(ex, ez);
      const nm = k === 255 ? 'no tile' : k === WATER ? 'WATER' : k === PLAZA ? 'PLAZA' : `class ${k}`;
      endClass[nm] = (endClass[nm] ?? 0) + 1;
    }
  }
}
report('ferry routes\' ends on a terminal', `${(routes?.ferries.length ?? 0) * 2} ends, ${endsOff} not within 150 m of the terminal they name; ${endsIn} inside the map, on ${JSON.stringify(endClass)}`, '0', !!routes && routes.ferries.length > 0 && endsOff === 0);
{
  // the graphs' ferry edges end on a terminal, a berth or a port area: an end node (one FERRY edge in every file, no
  // portal, not on the bounds) a road or footway meets, on a PLAZA texel, or within 30 m of a terminal in routes.bin
  let ends = 0, off = 0, where = null;
  const terms = routes?.terminals ?? [];
  for (const [id, r] of ferryEnd) {
    if (r.deg !== 1 || r.portal) continue;
    if (Math.abs(r.x - bx0) < 0.05 || Math.abs(r.x - bx1) < 0.05 || Math.abs(r.z - bz0) < 0.05 || Math.abs(r.z - bz1) < 0.05) continue;
    ends++;
    const ok = r.joined || klass(r.x, r.z) === PLAZA || terms.some((t) => Math.hypot(t.x - r.x, t.z - r.z) <= 30);
    if (!ok) { off++; where ??= `node ${id} at ${r.x.toFixed(1)}, ${r.z.toFixed(1)}`; }
  }
  report('ferry edges\' ends on a terminal, berth or port area', `${ends} ends in the map, ${off} on none${where ? ` (first: ${where})` : ''}`, '0', off === 0);
}
{
  // C3 (0.6): past the map, inside the archive's box, the routes every 10 m against Overture's land (OSM's coastline),
  // but within 150 m of their ends
  const polys = (checks?.land ?? []).map((rings) => rings.map((r) => r.map(([x, z]) => [x / 10, z / 10])));
  const boxes = polys.map((rings) => { let a = Infinity, b = Infinity, cc = -Infinity, d = -Infinity; for (const [x, z] of rings[0]) { a = Math.min(a, x); b = Math.min(b, z); cc = Math.max(cc, x); d = Math.max(d, z); } return [a, b, cc, d]; });
  const inRing = (r, x, z) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins; } return ins; };
  const onLand = (x, z) => polys.some((rings, k) => { const b = boxes[k]; return x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && inRing(rings[0], x, z) && !rings.slice(1).some((h) => inRing(h, x, z)); });
  const [lo0, la0, lo1, la1] = checks?.landBox ?? [0, 0, 0, 0];
  let n = 0, land = 0, outBox = 0, where = null;
  for (const f of routes?.ferries ?? []) {
    const m = f.lat.length, ends = [[f.xz[0], f.xz[1]], [f.xz[m * 2 - 2], f.xz[m * 2 - 1]]];
    for (let i = 0; i < m - 1; i++) {
      const ax = f.xz[i * 2], az = f.xz[i * 2 + 1], bx = f.xz[i * 2 + 2], bz = f.xz[i * 2 + 3];
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
      for (let j = 0; j < k; j++) {
        const t = j / k, x = ax + t * (bx - ax), z = az + t * (bz - az);
        if (x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1) continue; // the map's own check, above
        if (ends.some(([ex, ez]) => Math.hypot(x - ex, z - ez) <= 150)) continue;
        const lat = f.lat[i] + t * (f.lat[i + 1] - f.lat[i]), lon = f.lon[i] + t * (f.lon[i + 1] - f.lon[i]);
        if (lon < lo0 || lon > lo1 || lat < la0 || lat > la1) { outBox++; continue; }
        n++;
        if (onLand(x, z)) { land++; where ??= `${f.key} at ${lat.toFixed(5)}, ${lon.toFixed(5)}`; }
      }
    }
  }
  report('ferries past the map (C3)', `${n} samples every 10 m inside the archive's box against ${polys.length} land polygons; ${land} on land${where ? ` (first: ${where})` : ''}; ${outBox} past the box, not checked`, '0', !!checks && n > 0 && land === 0);
}
report('areas against the grid', `${c.areaPts} grid points inside area triangles, against the grid and never under the sea's surface, worst ${c.areaWorst.toFixed(3)} m${c.areaWhere ? ` (${c.areaWhere})` : ''}; ${c.areaOver} over`, '0 over 0.5 m', c.areaOver === 0);
report('areas on a roof or a deck left out', `${c.areaOnStructure} in the files of the ${onStructure.size} the bake read on a structure${c.areaOnStructureWhere ? ` (first: ${c.areaOnStructureWhere})` : ''}`, '0', !!checks && c.areaOnStructure === 0);
report('raised water that touches the sea is the sea\'s (C10)', `${runs.sea} runs of WATER the grid holds over 2 m touch the sea, ${runs.seaTexels} texels, the highest ${runs.highest.toFixed(1)} m (${runs.where}), ${runs.over5} with a texel over 5.5 m, read from the tiles; ${runs.lakes} runs don't, the lakes; ${c.seaRaised} of those texels in the regions' files checked under the sea's area next`, '', null);
report('OPEN_WATER on the sea', `${c.seaAreas} areas, ${c.waterTris} triangles, ${c.waterTexels} texel centres inside them, ${c.waterOffTexels} not the sea (WATER at 2 m or under or in a run that touches the sea, or no tile); ${c.waterTriY} triangles off WATER_Y; the sea's texels under it ${c.seaCovered} of ${c.seaTexels}${c.seaMissWhere ? ` (first not: ${c.seaMissWhere})` : ''}`,
  '0 and 0, every one', c.waterOffTexels === 0 && c.waterTriY === 0 && c.seaCovered === c.seaTexels);
report('lakes as OPEN_WATER at the grid\'s height (C8)', `${c.lakeAreas} areas (a lake's part in each region), ${c.lakeTris} triangles, ${c.lakeTexelsIn ?? 0} texel centres inside them, ${c.lakeOffTexels} not a lake (WATER the grid holds over 2 m); the lakes' texels under them ${c.lakeCovered} of ${c.lakeTexels}${c.lakeMissWhere ? ` (first not: ${c.lakeMissWhere})` : ''}; their heights in the areas' check above; files of minor ${[...c.minors].sort().join(', ')}`,
  '0, every one, minor 2', c.lakeOffTexels === 0 && c.lakeCovered === c.lakeTexels && (c.lakeTexels === 0 || [...c.minors].every((m) => m >= 2)));
report('areas by kind', Object.entries(c.areaByKind).map(([k, v]) => `${k} ${v}`).join(', '), '');
const allNames = new Set(c.names);
for (const f of routes?.ferries ?? []) allNames.add(f.name);
for (const t of routes?.terminals ?? []) allNames.add(t.name);
for (const m of routes?.marinas ?? []) allNames.add(m.name);
for (const a of routes?.airports ?? []) allNames.add(`${a.icao} ${a.iata}`);
allNames.delete('');
report('names', `${allNames.size} distinct names in the files (places only; a person reads them: --names prints them)`, '', null);
if (flags.names) for (const n of [...allNames].sort()) console.log(`        ${n}`);
console.log(`\nW1 ${failed ? `FAILED: ${failed} check${failed > 1 ? 's' : ''}` : 'passed'}`);
process.exit(failed ? 1 : 0);
