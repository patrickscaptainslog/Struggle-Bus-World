#!/usr/bin/env node
// The neighbourhoods' names (docs/M1.md, task 11: "a Node check lists every name in the city's tiles: about 80, none on a deny list (road names,
// plaques), the Mission as one, Twin Peaks and the Castro present, and Alcatraz's square signs ALCATRAZ. It fails on today's tiles (BUNKER RD;
// Alcatraz says FISHERMAN'S WHARF)"). No browser, no bake: it reads what the bake wrote.
//   node tools/world/hoodnames-check.mjs [city folder = public/city/sf] [--list]
// A city has its neighbourhoods twice. The squares' table (hoods.bin, tools/bake/hoods.py; src/world/hoods.ts reads it) puts every 128 m square of
// land in one neighbourhood: the areas engine's, a postcard's place, the count a finale shows. The tiles' own grid (32 m cells into city.json's
// neighborhoods, tools/bake/osm.py) is what a street sign reads today (City.hoodAt, then the building's own, main.ts hoodName). This holds the first to
// the task's rules and says where the second disagrees with it:
//   count     the squares' names, about 80 (60 to 100 passes; printed)
//   deny      none is a road's name (its last word Rd, Ave, St, Blvd, Dr, Hwy, Ln, Trl, Pkwy or one of them spelt out) or a plaque's (Landmark,
//             Memorial, Monument, Plaque, Marker, Duel, Historic Site), and none is two places joined ("A / B")
//   one       no neighbourhood is cut into compass strips where its whole is under WHOLE squares (Mission North and Mission South: the Mission is one);
//             a bigger one cut for its size is printed, not failed
//   present   the names the city must have, by key: for San Francisco the Mission, the Castro and Twin Peaks (a city's own list: PRESENT below)
//   island    a square on an island with one name signs that name: Alcatraz's square is ALCATRAZ (ALCATRAZ ISLAND is the same place), in the squares'
//             table and by what a street sign reads today
//   signs     (printed, not a pass line) the tiles' sign names that the squares' table does not have, and the other way
// Prints a row each and, with --list, every name with its squares. Exits 1 if a row fails, 2 if the city has no hoods.bin.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { latLonToLocal } from '../../src/game/geo.ts';
import { parseBuildingTile, parseTerrainTile } from '../../src/world/tiles.ts';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? 'public/city/sf');
if (!existsSync(`${dir}/hoods.bin`)) {
  console.log(`FAIL  no ${dir}/hoods.bin: python -I tools/bake/hoods.py <slug>`);
  process.exit(2);
}
const city = JSON.parse(readFileSync(`${dir}/city.json`, 'utf8'));
/** a neighbourhood this small (squares: 3 km2, hoods.py's MAX_SQUARES) or smaller is one place, never strips */
const WHOLE = 183;
/** what each city must have, by key, and its islands' squares: [name as signed, lat, lon]. A city not listed has neither row */
const PRESENT = { sf: ['mission', 'castro', 'twin peaks'] };
const ISLANDS = { sf: [['ALCATRAZ', 37.8267, -122.4229]] };

// ---- the squares' table (hoods.bin, 'SBN1': tools/bake/hoods.py pack_hoods has the layout)
function readHoods(file) {
  let b = readFileSync(file);
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 24 || b.toString('latin1', 0, 4) !== 'SBN1') throw new Error('not SBN1');
  const ix0 = dv.getInt32(8, true), iz0 = dv.getInt32(12, true), w = dv.getUint16(16, true), h = dv.getUint16(18, true), n = dv.getUint32(20, true);
  const gridAt = (24 + 5 * n + 3) & ~3, namesAt = (gridAt + 2 * w * h + ((w * h + 7) >> 3) + 3) & ~3;
  const flags = [...b.subarray(24 + 4 * n, 24 + 5 * n)], names = [], squares = new Array(n).fill(0);
  for (let i = 0, o = namesAt; i < n; i++) {
    names.push(b.toString('utf8', o + 1, o + 1 + b[o]));
    o += 1 + b[o];
  }
  const grid = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) if ((grid[i] = dv.getUint16(gridAt + i * 2, true))) squares[grid[i] - 1]++;
  /** the neighbourhood of the square at map (x, z), -1 for none */
  const at = (x, z) => {
    const ix = Math.floor(x / 128) - ix0, iz = Math.floor(z / 128) - iz0;
    return ix < 0 || iz < 0 || ix >= w || iz >= h ? -1 : grid[iz * w + ix] - 1;
  };
  return { names, squares, flags, at, ix0, iz0, w, h, grid };
}

/** A name as one place: lower case, no accents or marks, without "the", "district", "island" and "neighbo(u)rhood" (hoods.py's norm, and an island's
 *  name without the word). */
const key = (name) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !['the', 'district', 'island', 'neighborhood', 'neighbourhood'].includes(w)).join(' ');
const ROAD = /\b(rd|ave|st|blvd|dr|hwy|ln|trl|pkwy|road|avenue|street|boulevard|drive|highway|lane|trail|parkway)\.?$/i;
const PLAQUE = /\b(landmark|memorial|monument|plaque|marker|duel|historic(al)? site)\b/i;
const COMPASS = /^(.*?)\s+(north|south|east|west|central)$/i;

let bad = 0;
const row = (ok, name, o) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(8)} ${JSON.stringify(o)}`);
};
const H = readHoods(`${dir}/hoods.bin`);

// ---- count
row(H.names.length >= 60 && H.names.length <= 100, 'count', { names: H.names.length, about80: '60 to 100' });

// ---- deny
{
  const roads = H.names.filter((n) => n.split(' / ').some((p) => ROAD.test(p.trim())));
  const plaques = H.names.filter((n) => PLAQUE.test(n));
  const joined = H.names.filter((n) => n.includes(' / '));
  row(roads.length + plaques.length + joined.length === 0, 'deny', { roads, plaques, twoPlacesJoined: joined });
}

// ---- one
{
  const groups = new Map();
  H.names.forEach((n, i) => {
    const m = COMPASS.exec(n);
    if (!m) return;
    const g = groups.get(m[1]) ?? [];
    g.push({ name: n, squares: H.squares[i] });
    groups.set(m[1], g);
  });
  const strips = [...groups.entries()].filter(([, g]) => g.length > 1).map(([base, g]) => ({ base, parts: g.map((p) => p.name), squares: g.reduce((a, p) => a + p.squares, 0) }));
  const cut = strips.filter((s) => s.squares <= WHOLE * 1.5);
  row(cut.length === 0 && !strips.some((s) => key(s.base) === 'mission'), 'one', { cutIntoStrips: cut.map((s) => `${s.parts.join(', ')} (${s.squares} squares)`), biggerOnesCutForSize: strips.filter((s) => !cut.includes(s)).map((s) => `${s.base}: ${s.parts.length} of ${s.squares} squares`) });
}

// ---- present
if (PRESENT[city.slug]) {
  const keys = new Set(H.names.flatMap((n) => n.split(' / ')).map(key));
  const missing = PRESENT[city.slug].filter((k) => !keys.has(k));
  row(missing.length === 0, 'present', { mustHave: PRESENT[city.slug], missing, asNamed: PRESENT[city.slug].map((k) => H.names.find((n) => n.split(' / ').some((p) => key(p) === k)) ?? null) });
}

// ---- the tiles: each tile's hood grid and its buildings' own
function readTiles() {
  const tiles = new Map();
  for (const f of readdirSync(dir).filter((f) => /^r_-?\d+_-?\d+\.bin$/.test(f)).sort()) {
    let b = readFileSync(`${dir}/${f}`);
    if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), dv = new DataView(buf);
    for (let i = 0, n = dv.getUint32(4, true); i < n; i++) {
      const o = 8 + i * 24, tx = dv.getInt32(o, true), tz = dv.getInt32(o + 4, true);
      tiles.set(`${tx},${tz}`, { buf, bOff: dv.getUint32(o + 8, true), bLen: dv.getUint32(o + 12, true), tOff: dv.getUint32(o + 16, true), tLen: dv.getUint32(o + 20, true) });
    }
  }
  return tiles;
}
const tiles = readTiles(), TS = city.tileSize;
const signNames = city.neighborhoods.map((n) => n.name);
/** what a street sign says of (x, z) today: the tile's grid, else the nearest building's own on that tile, else the nearest label (main.ts hoodName) */
function signAt(x, z) {
  const tx = Math.floor(x / TS), tz = Math.floor(z / TS), t = tiles.get(`${tx},${tz}`);
  if (t?.tLen) {
    const g = parseTerrainTile(t.buf.slice(t.tOff, t.tOff + t.tLen), city.classN).hoodGrid;
    if (g) {
      const h = g[Math.min(7, Math.max(0, Math.floor(((z - tz * TS) / TS) * 8))) * 8 + Math.min(7, Math.max(0, Math.floor(((x - tx * TS) / TS) * 8)))];
      if (h !== 255) return { name: signNames[h], from: 'the tile\'s grid' };
    }
  }
  let best = null;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const u = tiles.get(`${tx + dx},${tz + dz}`);
      if (!u?.bLen) continue;
      const bt = parseBuildingTile(u.buf.slice(u.bOff, u.bOff + u.bLen));
      for (let i = 0; i < bt.count; i++) {
        const v = bt.vertStart[i], d = Math.hypot(bt.xz[v * 2] - x, bt.xz[v * 2 + 1] - z);
        if (!best || d < best.d) best = { d, hood: bt.hood[i] };
      }
    }
  if (best && best.d < 200) return { name: signNames[best.hood] ?? city.name, from: 'a building\'s own' };
  let near = null;
  for (const n of city.neighborhoods) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (!near || d < near.d) near = { d, name: n.name };
  }
  return { name: near?.name ?? city.name, from: 'the nearest label' };
}

// ---- island
if (ISLANDS[city.slug]) {
  const out = [];
  let ok = true;
  for (const [want, lat, lon] of ISLANDS[city.slug]) {
    const [x, z] = latLonToLocal(lat, lon, city.origin), h = H.at(x, z), table = h >= 0 ? H.names[h] : null, sign = signAt(x, z);
    // (by key: ALCATRAZ ISLAND is Alcatraz)
    const good = !!table && key(table) === key(want) && !!sign.name && key(sign.name) === key(want);
    ok &&= good;
    out.push({ island: want, squaresTableSays: table?.toUpperCase() ?? 'no neighbourhood', theSignSays: sign.name?.toUpperCase(), from: sign.from });
  }
  row(ok, 'island', out);
}

// ---- signs (printed)
{
  const squareKeys = new Set(H.names.flatMap((n) => n.split(' / ')).map(key)), signKeys = new Set(signNames.map(key));
  console.log(`      signs    ${JSON.stringify({ signNames: signNames.length, notInTheSquaresTable: signNames.filter((n) => !squareKeys.has(key(n))), squaresNamesNoSignHas: H.names.filter((n) => !n.split(' / ').some((p) => signKeys.has(key(p)))) })}`);
}

if (args.includes('--list')) for (const [i, n] of H.names.entries()) console.log(`      ${String(H.squares[i]).padStart(4)} squares  ${n}${H.flags[i] ? '  (godless)' : ''}`);
console.log(bad ? `hoodnames: FAILED ${bad}` : 'hoodnames: all passed');
process.exit(bad ? 1 : 0);
