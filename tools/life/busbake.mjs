#!/usr/bin/env node
// A city's bus lines baked for life's worker (LIFE.md, "Bus routes"): node --no-warnings tools/life/busbake.mjs <routes.json> <city dir> [--dry]
//   routes.json   what tools/life/busroutes.mjs wrote from the city's OpenStreetMap extract: each route relation's line and stops, lat/lon
//   city dir      public/city/<slug>: its city.json (the map's origin and regions) and its road graphs, g_<rx>_<rz>.bin
// It writes <city dir>/buses.bin and sets city.json's life.buses to its version (--dry: neither, only what it found). What it does, by data alone, for any city:
//   pick      a ref's routes are its variants (each way, short turns, an evening's): the longest, and the longest going the other way; its night variants
//             (an Owl) the same, as a night line of their own
//   lay       each line in the map's metres, cut where it jumps over 150 m (members missing at the extract's edge; a shorter gap is bridged straight), a point
//             every 8 m
//   match     each point to the road graph's nearest road going its way within 12 m: its height there (the ground or a deck), its lanes, whether it's a tunnel;
//             a piece under 800 m, or with under 85 % of it on the map's roads, is dropped
//   lane      the line moved to the kerb lane's middle, right of the road's line (the cars' lanes: src/life/sim/cars.ts laneOff), eased where the lanes change
//   thin      to 1.2 m across and 0.4 m of height
//   stops     each of the route's stops within 40 m of the line, as m along it; under 60 m apart they're one; one at each end
// buses.bin (gzip of), little-endian:
//   u32 'SBB1', u16 version (1), u16 lines
//   a line:  u8 n and its ref's utf-8; u8 flags (1 a night line, 2 a trolleybus); u32 the route relation's id; u16 points, u16 stops, u16 hidden stretches;
//            i32 x, y, z of its first point (dm, the map's metres); i16 dx, dy, dz for each point after (dm); each stop, u16 (m along / 2);
//            each hidden stretch (a tunnel), u16 from, u16 to (m along / 2)
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { latLonToLocal } = await import('../../src/game/geo.ts');
const { rolldown } = await import('rolldown');
const { gunzipSync, gzipSync } = await import('node:zlib');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
const { fileURLToPath, pathToFileURL } = await import('node:url');

const [routesFile, cityDir] = process.argv.slice(2).filter((a) => !a.startsWith('--')), dry = process.argv.includes('--dry');
if (!routesFile || !cityDir) {
  console.error('usage: node --no-warnings tools/life/busbake.mjs <routes.json> <city dir> [--dry]');
  process.exit(2);
}
const here = fileURLToPath(new URL('.', import.meta.url)), root = fileURLToPath(new URL('../..', import.meta.url)), outDir = `${here}.out`;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/entry-bus.ts`, `export { parseRegionGraph } from '${root.replace(/\\/g, '/')}src/world/lifeData.ts';`);
const bundle = await rolldown({ input: `${outDir}/entry-bus.ts`, platform: 'node', logLevel: 'warn' });
await bundle.write({ dir: outDir, format: 'esm', entryFileNames: 'lifedata-bus.mjs' });
await bundle.close();
const { parseRegionGraph } = await import(pathToFileURL(`${outDir}/lifedata-bus.mjs`).href);

const VERSION = 1, STEP = 8, NEAR = 12, PIECE_MIN = 800, ON_MIN = 0.85, BRIDGE = 150;
// (the cars' lanes, cars.ts: a lane's width, and lanes each way by road class where the edge names none)
const LANE_W = 3.2, LANES = [0, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1];
const ROAD = 1, DIR_BOTH = 0, TUNNEL = 2, UNDRAWN = 4;
const man = JSON.parse(readFileSync(`${cityDir}/city.json`, 'utf8')), M = man.regionSize * man.tileSize, origin = man.origin;

// ---- the map's roads: every road edge's stretches in a grid of 64 m cells ----
const CELL = 64, grid = new Map(), segs = [];
let edges = 0;
for (const [rx, rz] of man.life.regions) {
  const f = `${cityDir}/g_${rx}_${rz}.bin`;
  if (!existsSync(f)) continue;
  let b = readFileSync(f);
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  const G = parseRegionGraph(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), M);
  if (!G) continue;
  const E = G.edges;
  for (let i = 0; i < E.n; i++) {
    if (E.kind[i] !== ROAD) continue;
    edges++;
    const m = E.shape[i + 1] - E.shape[i], lanes = Math.max(1, E.lanes[i] || LANES[E.cls[i]] || 1);
    // (the bus's lane right of the road's line, going either way: a two-way's lanes are right of it; a one-way's are about it)
    const off = E.dir[i] === DIR_BOTH ? (lanes - 0.5) * LANE_W : (lanes / 2 - 0.5) * LANE_W;
    const at = (k, o) => {
      const src = k === 0 ? G.nodes.xyz : k === m + 1 ? G.nodes.xyz : G.pts, q = (k === 0 ? E.a[i] : k === m + 1 ? E.b[i] : E.shape[i] + k - 1) * 3;
      o[0] = src[q];
      o[1] = src[q + 1];
      o[2] = src[q + 2];
    };
    const p = [0, 0, 0], q = [0, 0, 0];
    at(0, p);
    for (let k = 1; k <= m + 1; k++) {
      at(k, q);
      const id = segs.length;
      segs.push({ x0: p[0], y0: p[1], z0: p[2], x1: q[0], y1: q[1], z1: q[2], dir: E.dir[i], off, hidden: !!(E.flags[i] & (TUNNEL | UNDRAWN)) });
      const c0 = Math.floor(Math.min(p[0], q[0]) / CELL), c1 = Math.floor(Math.max(p[0], q[0]) / CELL), d0 = Math.floor(Math.min(p[2], q[2]) / CELL), d1 = Math.floor(Math.max(p[2], q[2]) / CELL);
      for (let c = c0; c <= c1; c++)
        for (let d = d0; d <= d1; d++) {
          const key = c * 100003 + d;
          let cell = grid.get(key);
          if (!cell) grid.set(key, (cell = []));
          cell.push(id);
        }
      p[0] = q[0];
      p[1] = q[1];
      p[2] = q[2];
    }
  }
}
/** The road at (x, z) going (ux, uz): the nearest stretch within NEAR m that lies along it and may be driven that way, the one nearest `yWas` in height first where two
 *  are stacked (a street under a freeway's deck). Null: none. */
const roadAt = (x, z, ux, uz, yWas) => {
  let best = null, bestD = Infinity;
  const c0 = Math.floor((x - NEAR) / CELL), c1 = Math.floor((x + NEAR) / CELL), d0 = Math.floor((z - NEAR) / CELL), d1 = Math.floor((z + NEAR) / CELL);
  for (let c = c0; c <= c1; c++)
    for (let d = d0; d <= d1; d++)
      for (const id of grid.get(c * 100003 + d) ?? []) {
        const s = segs[id], sx = s.x1 - s.x0, sz = s.z1 - s.z0, L2 = sx * sx + sz * sz;
        if (L2 < 1e-6) continue;
        const L = Math.sqrt(L2), cos = (sx * ux + sz * uz) / L;
        // (along it; and with its traffic: a one-way against the bus is another road's line, or a contraflow lane, taken only as a last resort)
        if (Math.abs(cos) < 0.8) continue;
        const t = Math.max(0, Math.min(1, ((x - s.x0) * sx + (z - s.z0) * sz) / L2)), px = s.x0 + sx * t, pz = s.z0 + sz * t, dist = Math.hypot(x - px, z - pz);
        if (dist > NEAR) continue;
        const y = s.y0 + (s.y1 - s.y0) * t, wrong = s.dir !== DIR_BOTH && (s.dir === 1 ? cos < 0 : cos > 0);
        const cost = dist + (wrong ? 8 : 0) + (yWas === null ? 0 : Math.min(30, Math.abs(y - yWas) > 3 ? 2 * Math.abs(y - yWas) : 0));
        if (cost < bestD) {
          bestD = cost;
          best = { y, off: s.off, hidden: s.hidden };
        }
      }
  return best;
};

// ---- pick ----
const routes = JSON.parse(readFileSync(routesFile, 'utf8'));
// (a night line by its name, as OpenStreetMap has no tag for one: Muni's Owls, London's N29, Amsterdam's Nachtbus)
const night = (r) => /\bowl\b|late.?night|night.?(bus|line|rider)|all.?nighter|nacht(bus|net)/i.test(`${r.ref} ${r.name}`) || /^N\d/.test(r.ref);
const byRef = new Map();
for (const r of routes) {
  if (!r.line || r.line.length < 2 || !r.ref) continue;
  const k = `${r.network || r.operator || ''}|${r.ref}|${night(r) ? 'n' : 'd'}`;
  if (!byRef.has(k)) byRef.set(k, []);
  byRef.get(k).push(r);
}
const picked = [];
for (const list of byRef.values()) {
  list.sort((a, b) => b.km - a.km || a.id - b.id);
  const A = list[0], a0 = A.line[0], a1 = A.line[A.line.length - 1], far = (p, q) => Math.hypot(p[0] - q[0], (p[1] - q[1]) * 0.79);
  picked.push(A);
  // (the other way: the longest that starts nearer A's end than A's start)
  const B = list.slice(1).find((r) => far(r.line[0], a1) < far(r.line[0], a0) && far(r.line[r.line.length - 1], a0) < far(r.line[r.line.length - 1], a1));
  if (B) picked.push(B);
}

// ---- lay, match, lane, thin, stops ----
const thin = (P, tolXZ, tolY) => {
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = 0, at = -1;
    const ax = P[a].x, ay = P[a].y, az = P[a].z, dx = P[b].x - ax, dy = P[b].y - ay, dz = P[b].z - az, L2 = dx * dx + dz * dz || 1e-9;
    for (let i = a + 1; i < b; i++) {
      // (a point kept where a stretch's hidden or not changes, so a tunnel's mouths stay where they are)
      const t = Math.max(0, Math.min(1, ((P[i].x - ax) * dx + (P[i].z - az) * dz) / L2));
      const e = Math.max(Math.hypot(P[i].x - ax - dx * t, P[i].z - az - dz * t) / tolXZ, Math.abs(P[i].y - ay - dy * t) / tolY, P[i].hidden !== P[i - 1].hidden ? 9 : 0);
      if (e > worst) {
        worst = e;
        at = i;
      }
    }
    if (worst > 1) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return P.filter((_, i) => keep[i]);
};
const lines = [], dropped = { short: 0, offMap: 0 };
let stopsIn = 0, stopsOut = 0, km = 0, pieces = 0;
for (const r of picked) {
  const xz = r.line.map(([lat, lon]) => latLonToLocal(lat, lon, origin, [0, 0]));
  // (cut where it jumps: busroutes.mjs says where)
  const parts = [[]], cuts = new Set(r.cuts ?? []);
  for (let i = 0; i < xz.length; i++) {
    if (i && cuts.has(i) && Math.hypot(xz[i][0] - xz[i - 1][0], xz[i][1] - xz[i - 1][1]) > BRIDGE) parts.push([]);
    parts[parts.length - 1].push(xz[i]);
  }
  let part = 0;
  for (const raw of parts) {
    pieces++;
    // (a point every STEP m)
    const pts = [];
    for (let i = 1; i < raw.length; i++) {
      const [x0, z0] = raw[i - 1], [x1, z1] = raw[i], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / STEP));
      if (L < 0.05) continue;
      for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push({ x: x0 + ((x1 - x0) * k) / n, z: z0 + ((z1 - z0) * k) / n, ux: (x1 - x0) / L, uz: (z1 - z0) / L, y: NaN, off: NaN, hidden: false });
    }
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (len < PIECE_MIN) {
      dropped.short++;
      continue;
    }
    let on = 0, yWas = null;
    for (const p of pts) {
      const m = roadAt(p.x, p.z, p.ux, p.uz, yWas);
      if (!m) continue;
      on++;
      p.y = yWas = m.y;
      p.off = m.off;
      p.hidden = m.hidden;
    }
    if (on / pts.length < ON_MIN) {
      if (process.env.BUS_DEBUG) console.log(r.network, r.ref, 'OFF', (len / 1000).toFixed(1), 'km on', (on / pts.length).toFixed(2));
      dropped.offMap++;
      continue;
    }
    // (a point off the map's roads: its height and lane between its neighbours' that are on them)
    for (const key of ['y', 'off']) {
      let last = -1;
      for (let i = 0; i < pts.length; i++) {
        if (Number.isNaN(pts[i][key])) continue;
        if (last < 0) for (let j = 0; j < i; j++) pts[j][key] = pts[i][key];
        else for (let j = last + 1; j < i; j++) pts[j][key] = pts[last][key] + ((pts[i][key] - pts[last][key]) * (j - last)) / (i - last);
        last = i;
      }
      for (let j = last + 1; j < pts.length; j++) pts[j][key] = pts[last][key];
    }
    // (the lane's offset eased over 40 m, then the line moved by it to its right: x east and z south, so right of (ux, uz) is (-uz, ux))
    const W = 5, off = pts.map((_, i) => {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - W); j <= Math.min(pts.length - 1, i + W); j++) {
        s += pts[j].off;
        n++;
      }
      return s / n;
    });
    const dirAt = (i) => {
      const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return [(b.x - a.x) / L, (b.z - a.z) / L];
    };
    const moved = pts.map((p, i) => {
      const [ux, uz] = dirAt(i);
      return { x: p.x - uz * off[i], y: p.y, z: p.z + ux * off[i], hidden: p.hidden };
    });
    const P = thin(moved, 1.2, 0.4), cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    const L = cum[cum.length - 1];
    // (a step past an i16 of dm can't be written: none should be, at 8 m a point before thinning and roads that bend)
    if (P.some((p, i) => i && (Math.abs(p.x - P[i - 1].x) > 3200 || Math.abs(p.z - P[i - 1].z) > 3200))) throw new Error(`a step over 3.2 km on ${r.ref}`);
    // (stops: each within 40 m of the line, as m along it)
    const along = [0, L];
    for (const [lat, lon] of r.stops ?? []) {
      const [sx, sz] = latLonToLocal(lat, lon, origin, [0, 0]);
      let best = Infinity, at = 0;
      for (let i = 1; i < P.length; i++) {
        const ax = P[i - 1].x, az = P[i - 1].z, dx = P[i].x - ax, dz = P[i].z - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sz - az) * dz) / L2));
        const d = Math.hypot(sx - ax - dx * t, sz - az - dz * t);
        if (d < best) {
          best = d;
          at = cum[i - 1] + (cum[i] - cum[i - 1]) * t;
        }
      }
      if (best <= 40) {
        along.push(at);
        stopsIn++;
      } else stopsOut++;
    }
    along.sort((a, b) => a - b);
    const stops = [];
    for (const s of along) if (!stops.length || s - stops[stops.length - 1] >= 60) stops.push(s);
    if (L - stops[stops.length - 1] < 60 && stops.length > 1) stops[stops.length - 1] = L;
    else stops.push(L);
    // (hidden stretches: runs of points in a tunnel, or on a deck the world hasn't drawn)
    const hidden = [];
    for (let i = 0; i < P.length; i++) {
      if (!P[i].hidden) continue;
      let j = i;
      while (j + 1 < P.length && P[j + 1].hidden) j++;
      hidden.push([cum[Math.max(0, i - 1)], cum[Math.min(P.length - 1, j + 1)]]);
      i = j;
    }
    if (process.env.BUS_DEBUG) console.log(r.network, r.ref, night(r) ? 'night' : 'day', 'piece', part, 'km', (L / 1000).toFixed(1), 'of', r.km.toFixed(1), 'on', (on / pts.length).toFixed(2), 'stops', stops.length);
    lines.push({ ref: r.ref.slice(0, 12), id: (r.id * 8 + part++) >>> 0, flags: (night(r) ? 1 : 0) | (r.mode === 'trolleybus' ? 2 : 0), P, stops, hidden, L, who: r.network || r.operator || '?' });
    km += L / 1000;
  }
}
lines.sort((a, b) => a.id - b.id);

// ---- write ----
const dm = (v) => Math.round(v * 10), u2 = (v) => Math.min(65535, Math.round(v / 2));
let bytes = 8;
for (const l of lines) bytes += 1 + Buffer.byteLength(l.ref) + 1 + 4 + 6 + 12 + (l.P.length - 1) * 6 + l.stops.length * 2 + l.hidden.length * 4;
const out = Buffer.alloc(bytes);
let o = 0;
o = out.writeUInt32LE(0x31424253, o);
o = out.writeUInt16LE(VERSION, o);
o = out.writeUInt16LE(lines.length, o);
for (const l of lines) {
  const ref = Buffer.from(l.ref);
  o = out.writeUInt8(ref.length, o);
  o += ref.copy(out, o);
  o = out.writeUInt8(l.flags, o);
  o = out.writeUInt32LE(l.id, o);
  o = out.writeUInt16LE(l.P.length, o);
  o = out.writeUInt16LE(l.stops.length, o);
  o = out.writeUInt16LE(l.hidden.length, o);
  o = out.writeInt32LE(dm(l.P[0].x), o);
  o = out.writeInt32LE(dm(l.P[0].y), o);
  o = out.writeInt32LE(dm(l.P[0].z), o);
  for (let i = 1; i < l.P.length; i++) {
    o = out.writeInt16LE(dm(l.P[i].x) - dm(l.P[i - 1].x), o);
    o = out.writeInt16LE(dm(l.P[i].y) - dm(l.P[i - 1].y), o);
    o = out.writeInt16LE(dm(l.P[i].z) - dm(l.P[i - 1].z), o);
  }
  for (const s of l.stops) o = out.writeUInt16LE(u2(s), o);
  for (const [a, b] of l.hidden) {
    o = out.writeUInt16LE(u2(a), o);
    o = out.writeUInt16LE(u2(b), o);
  }
}
const gz = gzipSync(out, { level: 9 });
const who = {};
for (const l of lines) who[l.who] = (who[l.who] ?? 0) + 1;
console.log(JSON.stringify({
  routes: routes.length, refs: byRef.size, picked: picked.length, pieces, dropped, lines: lines.length, by: who, nightLines: lines.filter((l) => l.flags & 1).length,
  km: +km.toFixed(1), points: lines.reduce((s, l) => s + l.P.length, 0), stops: lines.reduce((s, l) => s + l.stops.length, 0), stopsOffLine: stopsOut, stopsOnLine: stopsIn,
  hiddenKm: +(lines.reduce((s, l) => s + l.hidden.reduce((t, [a, b]) => t + b - a, 0), 0) / 1000).toFixed(1), roadEdges: edges, bytes: [out.length, gz.length],
}));
if (!dry) {
  writeFileSync(`${cityDir}/buses.bin`, gz);
  // (city.json's own text kept, but for the one field: the world's bake writes the rest)
  const text = readFileSync(`${cityDir}/city.json`, 'utf8'), had = /"life":\s*\{\s*("buses":\s*\d+,\s*)?/;
  if (!had.test(text)) throw new Error('city.json has no "life" block');
  writeFileSync(`${cityDir}/city.json`, text.replace(had, (m, was) => (was ? m.replace(/"buses":\s*\d+/, `"buses": ${VERSION}`) : `${m}"buses": ${VERSION}, `)));
  console.log(`wrote ${cityDir}/buses.bin (${gz.length} bytes) and city.json's life.buses`);
}
