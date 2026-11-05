#!/usr/bin/env node
// W1 (docs/specs/earth/CONTRACT.md, section 7): a city's graphs for life, read with the shipped parser
// (src/world/lifeData.ts, bundled with rolldown as tools/moon/run.mjs does: Node's own type stripping refuses enums),
// and every invariant of the contract's 1.2 counted against the city's own baked files: the tiles' terrain grids
// (tiles.ts's parser), their class rasters and WATER_Y. Prints each count beside its limit, exits 1 on any failure.
// The plan says what each count stands for: docs/specs/earth/GRAPHS.md, "W1".
//
//   node tools/world/graph-check.mjs sf [--dir=public/city/sf] [--tiles=DIR] [--names]
//     --dir    the city's folder (a copy, to try a broken file)
//     --tiles  where its r_*.bin tiles are, if not there
//     --names  print every name in the files (places may be named; nothing names a person or a vessel: a person reads them)
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

// the shipped parsers, bundled
const out = `${here}.out`;
mkdirSync(out, { recursive: true });
const fwd = (p) => p.replace(/\\/g, '/');
writeFileSync(`${out}/entry.ts`, [
  `export * from '${fwd(root)}/src/world/lifeData.ts';`,
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
const results = [];
let failed = 0;
function report(name, value, limit, ok, note = '') {
  results.push({ name, ok });
  if (ok === false) failed++;
  console.log(`${ok === false ? 'FAIL' : ok === true ? 'pass' : '    '}  ${name}: ${value}${limit !== '' ? `  (${limit})` : ''}${note ? `  ${note}` : ''}`);
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
const sea = (x, z) => { const c = klass(x, z); return c === 255 || (c === WATER && ground(x, z) <= LAKE_M); };

// ------------------------------------------------------------ the files
const life = man.life;
report('city.json life block', life ? `graph ${life.graph}, routes ${life.routes}` : 'none', '', !!life);
if (!life) process.exit(1);
const regions = man.regions.map((r) => [r[0], r[1]]);
const regionSet = new Set(regions.map(([a, b]) => `${a},${b}`));
const [bx0, bz0, bx1, bz1] = man.bounds;

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
  const kb = gunzipSync(readFileSync(`${dir}/gkeys.bin`));
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

const routeEnds = []; // map metres of each ferry route's two ends, for the 150 m exemption
const termById = new Map(routes?.terminals.map((t) => [t.id, t]) ?? []);
for (const f of routes?.ferries ?? []) {
  const n = f.lat.length;
  routeEnds.push([f.xz[0], f.xz[1]], [f.xz[n * 2 - 2], f.xz[n * 2 - 1]]);
}
const nearEnd = (x, z) => routeEnds.some(([ex, ez]) => Math.hypot(x - ex, z - ez) <= 150);
const decks = (man.landmarks ?? []).filter((l) => l.deck).map((l) => l.deck);

const c = {
  files: 0, missing: 0, parseFail: 0, tooBig: 0, gz: 0, raw: 0, sizes: [],
  nodes: 0, edges: 0, points: 0, areas: 0, tris: 0,
  outside: 0, edgesAcross: 0,
  portals: 0, lineNotPortal: 0, lineDeadEnds: 0, lineDeadC1: 0,
  idTwiceInFile: 0, idKinds: 0, noKey: 0,
  byDir: {}, oneWay: 0,
  tunnelUndrawn: 0, undrawnKm: {}, kmByClass: {},
  land: 0, landNoTile: 0, landWorst: 0, landWhere: null, landOver: 0, steps: 0,
  water: 0, waterOff: 0, waterWorst: 0,
  deckSamples: [], stackPairs: 0, rampPairs: 0, inversions: 0, inversionWhere: null,
  ferrySamples: 0, ferryOnLand: 0, ferryLandWhere: null, ferryExempt: 0,
  areaPts: 0, areaWorst: 0, areaOver: 0, areaWhere: null, waterTris: 0, waterTexels: 0, waterOffTexels: 0, waterTriY: 0,
  names: new Set(), byKind: {}, areaByKind: {},
};
const nodeSeen = new Map(); // node id -> [{r, x, y, z, portal, line}]
const deckParent = new Map(); // node id -> parent, the decks' structures
const deckFind = (a) => { let p = deckParent.get(a) ?? a; while (p !== a) { const g = deckParent.get(p) ?? p; deckParent.set(a, g); a = p; p = g; } return a; };
const deckJoin = (a, b) => { const p = deckFind(a), q = deckFind(b); if (p !== q) deckParent.set(Math.max(p, q), Math.min(p, q)); };
const allDeck = []; // [x, y, z, level, edge id, a node id]
const areaSeen = new Map(); // area id -> regions
const edgeSeen = new Map();

const onLine = (v) => { const k = Math.round(v / REGION_M); return Math.abs(v - k * REGION_M) < 1e-3; };
const SAMPLE = 4;

for (const [rx, rz] of regions) {
  const p = `${dir}/g_${rx}_${rz}.bin`;
  if (!existsSync(p)) { c.missing++; continue; }
  const gz = readFileSync(p);
  c.files++;
  c.gz += gz.length;
  c.sizes.push([gz.length, rx, rz]);
  if (gz.length > G_LIMIT) c.tooBig++;
  const raw = gunzipSync(gz);
  c.raw += raw.length;
  const g = parseRegionGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), REGION_M);
  if (!g || g.rx !== rx || g.rz !== rz) { c.parseFail++; continue; }
  const { nodes, edges, pts, areas } = g;
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
  for (let e = 0; e < edges.n; e++) {
    const k = cls(e);
    touch[edges.a[e]] |= k; touch[edges.b[e]] |= k;
    const id = edges.id[e];
    if (seenHere.has(id)) c.idTwiceInFile++;
    seenHere.add(id);
    if (edgeSeen.has(id)) c.idTwiceInFile++;
    edgeSeen.set(id, 1);
    if (!keysOf.has(id)) c.noKey++;
  }
  // nodes
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
    if (t & 1) {
      const h = ground(x, z);
      if (Number.isNaN(h)) c.landNoTile++;
      else {
        c.land++;
        const e = Math.abs(y - h);
        if (e > c.landWorst) { c.landWorst = e; c.landWhere = `node ${id} at ${x.toFixed(1)}, ${z.toFixed(1)}`; }
        if (e > 0.5) c.landOver++;
      }
    } else if (t === 8 && wet(x, z)) {
      c.water++;
      const e = Math.abs(y - WATER_Y);
      c.waterWorst = Math.max(c.waterWorst, e);
      if (e > 1e-3) c.waterOff++;
    }
  }
  // edges: their points, the grid every 4 m, water, decks
  const deckPts = [];
  for (let e = 0; e < edges.n; e++) {
    const k = cls(e), kind = edges.kind[e], f = edges.flags[e];
    const s0 = edges.shape[e], s1 = edges.shape[e + 1];
    const P = [[nodes.xyz[edges.a[e] * 3], nodes.xyz[edges.a[e] * 3 + 1], nodes.xyz[edges.a[e] * 3 + 2]]];
    for (let s = s0; s < s1; s++) P.push([pts[s * 3], pts[s * 3 + 1], pts[s * 3 + 2]]);
    P.push([nodes.xyz[edges.b[e] * 3], nodes.xyz[edges.b[e] * 3 + 1], nodes.xyz[edges.b[e] * 3 + 2]]);
    let len = 0, across = false;
    for (let i = 0; i < P.length; i++) {
      if (i > 0 && i < P.length - 1 && out(P[i][0], P[i][2], 0.1)) c.outside++;
      if (out(P[i][0], P[i][2], 1e-3)) across = true;
      if (i) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]);
    }
    if (across) c.edgesAcross++;
    const name = kind === 1 ? ROAD[edges.cls[e]] : kind === 2 ? 'foot:' + FOOT[edges.cls[e]] : KIND[kind].toLowerCase();
    c.kmByClass[name] = (c.kmByClass[name] ?? 0) + len / 1000;
    if (f & EdgeFlag.UNDRAWN) c.undrawnKm[name] = (c.undrawnKm[name] ?? 0) + len / 1000;
    if (f & EdgeFlag.TUNNEL && f & EdgeFlag.UNDRAWN) c.tunnelUndrawn++;
    const dk = `${KIND[kind]} ${['BOTH', 'FORWARD', 'BACKWARD'][edges.dir[e]] ?? edges.dir[e]}`;
    c.byDir[dk] = (c.byDir[dk] ?? 0) + 1;
    if (edges.dir[e] !== 0) c.oneWay++;
    c.byKind[name] = (c.byKind[name] ?? 0) + 1;
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, ay, az] = P[i], [bx, by, bz] = P[i + 1];
      const d = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(d / SAMPLE));
      for (let j = i === 0 ? 0 : 1; j <= n; j++) {
        const t = j / n, x = ax + t * (bx - ax), z = az + t * (bz - az), y = ay + t * (by - ay);
        if (k === 1) {
          if ((j === 0 && i === 0) || (j === n && i === P.length - 2)) continue; // the nodes, counted above
          const h = ground(x, z);
          if (Number.isNaN(h)) { c.landNoTile++; continue; }
          c.steps++;
          const er = Math.abs(y - h);
          if (er > c.landWorst) { c.landWorst = er; c.landWhere = `edge ${edges.id[e]} at ${x.toFixed(1)}, ${z.toFixed(1)}`; }
          if (er > 0.5) c.landOver++;
        } else if (k === 2) {
          deckPts.push([x, y, z, edges.level[e], e]);
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
        for (const q of [P[i + 1]]) {
          if (i + 1 < P.length - 1 && wet(q[0], q[2])) {
            c.water++;
            const er = Math.abs(q[1] - WATER_Y);
            c.waterWorst = Math.max(c.waterWorst, er);
            if (er > 1e-3) c.waterOff++;
          }
        }
      }
    }
  }
  // decks: against the drawn decks' tops (C2's gap, printed), and stacked decks by level
  for (const [x, y, z] of deckPts) {
    for (const d of decks) {
      let best = Infinity, top = 0;
      for (let i = 0; i < d.length - 1; i++) {
        const [ax, az, ay] = d[i], [bx, bz, by] = d[i + 1];
        const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
        const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / L2)) : 0;
        const dd = Math.hypot(ax + t * vx - x, az + t * vz - z);
        if (dd < best) { best = dd; top = ay + t * (by - ay); }
      }
      if (best <= 15) c.deckSamples.push(y - top);
    }
  }
  // decks a chain of deck edges joins, anywhere in the city (by node ids: a portal is one id in two files), are one
  // structure, its levels changing along its ramps; stacking is checked between two that nothing joins, after the files
  for (let e = 0; e < edges.n; e++) if (cls(e) === 2) deckJoin(nodes.id[edges.a[e]], nodes.id[edges.b[e]]);
  for (const q of deckPts) allDeck.push([q[0], q[1], q[2], q[3], edges.id[q[4]], nodes.id[edges.a[q[4]]]]);
  // areas: the grid's points inside each triangle; OPEN_WATER on water
  for (let a = 0; a < areas.n; a++) {
    const kind = areas.kind[a];
    c.areaByKind[AREA[kind]] = (c.areaByKind[AREA[kind]] ?? 0) + 1;
    if (areas.name[a] !== 0xffff) c.names.add(g.names[areas.name[a]]);
    let l = areaSeen.get(areas.id[a]);
    if (!l) areaSeen.set(areas.id[a], (l = new Set()));
    if (l.has(`${rx},${rz}`)) c.idTwiceInFile++;
    l.add(`${rx},${rz}`);
    if (!keysOf.has(areas.id[a])) c.noKey++;
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
        c.waterTris++;
        if (Math.abs(v[1] - WATER_Y) > 1e-3 || Math.abs(v[4] - WATER_Y) > 1e-3 || Math.abs(v[7] - WATER_Y) > 1e-3) c.waterTriY++;
        for (let x = Math.floor(minx / 2) * 2 + 1; x < maxx; x += 2) for (let z = Math.floor(minz / 2) * 2 + 1; z < maxz; z += 2) {
          const [l0, l1, l2] = bary(x, z);
          if (l0 < 1e-9 || l1 < 1e-9 || l2 < 1e-9) continue;
          c.waterTexels++;
          if (!sea(x, z)) c.waterOffTexels++;
        }
        continue;
      }
      for (let x = Math.ceil(minx / 4) * 4; x <= maxx; x += 4) for (let z = Math.ceil(minz / 4) * 4; z <= maxz; z += 4) {
        const [l0, l1, l2] = bary(x, z);
        if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
        let h = ground(x, z);
        if (Number.isNaN(h)) continue;
        if (sea(x, z)) h = WATER_Y; // an area on the sea stands at the water, as a water node does; on a lake, at the grid
        c.areaPts++;
        const er = Math.abs(l0 * v[1] + l1 * v[4] + l2 * v[7] - h);
        if (er > c.areaWorst) { c.areaWorst = er; c.areaWhere = `area ${areas.id[a]} (${AREA[kind]}) at ${x}, ${z}`; }
        if (er > 0.5) c.areaOver++;
      }
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
    if (across.some(([a, b]) => !regionSet.has(`${a},${b}`))) c.lineDeadC1++;
  }
}
for (const id of nodeSeen.keys()) if (edgeSeen.has(id) || areaSeen.has(id)) c.idKinds++;
for (const id of edgeSeen.keys()) if (areaSeen.has(id)) c.idKinds++;

const km = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
const largest = c.sizes.sort((a, b) => b[0] - a[0])[0] ?? [0, 0, 0];
const med = c.sizes.length ? c.sizes.map((s) => s[0]).sort((a, b) => a - b)[c.sizes.length >> 1] : 0;

console.log(`\nW1 ${slug}: ${dir}`);
report('graph files', `${c.files} of ${regions.length} regions, ${c.missing} missing`, 'one a region of city.json regions', c.missing === 0);
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
  // node keys by form: the contract's (1.3) and C4's, which the contract has no form for or whose form names two places
  const f = { 'connector, OSM node': 0, 'connector, GERS id': 0, "portal, the contract's form": 0, 'C4, way and place': 0 };
  for (const k of keysOf.values()) {
    if (!k.startsWith('0:')) continue;
    const s = k.slice(2);
    if (!s.includes('@')) f[s[0] === 'n' && /^n\d+$/.test(s) ? 'connector, OSM node' : 'connector, GERS id']++;
    else if (/@[xz]-?\d+\.\d$/.test(s)) f["portal, the contract's form"]++;
    else f['C4, way and place']++;
  }
  report('node keys by form', Object.entries(f).map(([k, v]) => `${k} ${v}`).join(', '), '');
}
report('nodes on a region line with edges one side only', `${c.lineDeadEnds}, ${c.lineDeadC1} of them on a cell with no file (C1)`, '');
report('direction', Object.entries(c.byDir).sort().map(([k, v]) => `${k} ${v}`).join(', '), '');
report('one-way edges against the bake\'s count', `${c.oneWay} in the files, ${life.stats?.oneWay?.edges} in life.stats (from ${life.stats?.oneWay?.rulesRead} rules read)`, 'the same', c.oneWay === life.stats?.oneWay?.edges);
report('tunnels that are UNDRAWN', c.tunnelUndrawn, '0', c.tunnelUndrawn === 0);
const mw = c.kmByClass.motorway ?? 0, mu = c.undrawnKm.motorway ?? 0;
report('UNDRAWN km by class', km(c.undrawnKm) || 'none', '', null, `motorway ${mw ? ((100 * mu) / mw).toFixed(0) : 0} % of ${mw.toFixed(1)} km (the audit's surface share: 68 %)`);
report('land within 0.5 m of the grid', `${c.land} land nodes and ${c.steps} steps of 4 m or less along land edges; worst ${c.landWorst.toFixed(3)} m (${c.landWhere}); ${c.landOver} over; ${c.landNoTile} with no tile`, '0 over 0.5 m', c.landOver === 0);
report('water at WATER_Y', `${c.water} water nodes and points, worst ${c.waterWorst.toFixed(4)} m off; ${c.waterOff} off by over 1 mm`, '0', c.waterOff === 0);
const ds = c.deckSamples.map(Math.abs).sort((a, b) => a - b);
report('decks against the drawn decks (C2)', ds.length ? `${ds.length} deck samples within 15 m of a landmark deck: median ${ds[ds.length >> 1].toFixed(1)} m, 90th ${ds[Math.floor(ds.length * 0.9)].toFixed(1)} m, worst ${ds[ds.length - 1].toFixed(1)} m (mean signed ${(c.deckSamples.reduce((a, b) => a + b, 0) / ds.length).toFixed(1)} m)` : 'no deck samples near a drawn deck', 'printed: within 0.3 m once C2 is Agreed', null);
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
report('ferry routes\' ends on a terminal', `${(routes?.ferries.length ?? 0) * 2} ends, ${endsOff} not within 150 m of the terminal they name; ${endsIn} inside the map, on ${JSON.stringify(endClass)}`, '0', endsOff === 0);
report('ferries past the map', 'not checked: the coastline download (item 20) was refused, and C3 is Proposed', '', null);
report('areas against the grid', `${c.areaPts} grid points inside area triangles, worst ${c.areaWorst.toFixed(3)} m${c.areaWhere ? ` (${c.areaWhere})` : ''}; ${c.areaOver} over`, '0 over 0.5 m', c.areaOver === 0);
report('OPEN_WATER on water', `${c.waterTris} triangles, ${c.waterTexels} texel centres inside them, ${c.waterOffTexels} not the sea (WATER at 2 m or under, or no tile); ${c.waterTriY} triangles off WATER_Y`, '0 and 0', c.waterOffTexels === 0 && c.waterTriY === 0);
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
