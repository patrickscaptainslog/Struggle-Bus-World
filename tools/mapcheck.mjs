#!/usr/bin/env node
// The map check (docs M1, task 2): how far the nearest houses that can float are from the Golden Gate, from the baked tiles as the game reads them.
//   node tools/mapcheck.mjs [--city public/city/sf] [--out table.json]
// Reads city.json, hoods.bin and the region bundles (r_*.bin) within RADIUS of the bridge with the game's own parsers (src/world/tiles.ts, hoods.ts,
// gunzip.ts) and builds every 128 m square of the areas' grid (liftGlsl.ts SQUARE) there:
//   houses   the baked buildings whose centroid is on it, as City.addTile makes its refs (the mean of the ground ring's vertices; a footprint a
//            hand-built prop draws instead, towerStyles hiddenAt, makes none), and as Lift.liftable takes them (index under the manifest's buildingCount:
//            no landmark)
//   floats   the Lift's rule (Lift.liftable: on a neighbourhood's square, not tagged) with at least one house, and not a park: parks never lift
//            (docs/specs/factions/LIFT.md). The tiles carry no park outlines, so a park is read two ways from the 2 m class texture (tiles.ts Ground):
//            a park square, its land half or more grass or forest (the share hoods.py gives a park to take a square, COVER), and a park neighbourhood,
//            its land PARK_HOOD or more green (hoods.py makes every big named park a neighbourhood of its own: the Presidio, the Headlands). The
//            stand-in's own rule (no park test) and the rule with park squares alone are printed beside it, and a block: BLOCK houses or more.
// For each start pose at the Golden Gate (the manifest's ggb: its towers, its deck): the nearest square that floats in any direction, the first one
// straight ahead (within a blast's radius of the line, config.splat.blastRadius: a tap flying straight reaches it), each with its distance (m), the seconds
// at Cruise (config.flight.cruiseSpeed) and at Express (config.flight.surgeSpeed), its neighbourhood and streets (the tiles' street names), and what lies
// between (water, park, tagged ground, houses that can't lift, land with no houses), and what a first tap at the pose paints of the bridge: the landing
// (config.splat.range + rangePerSpeed x speed ahead, the low breath), its distance from the deck's ring and from the towers, and the part of the bridge
// nearest it; then, flying straight on, the first second a tap's blast would reach the bridge.
// Self-checks (exit 1 on a failure, exit 2 when the data can't be read): the south tower's square and the middle of the strait don't float, Alamo Square's
// heart (a park with no houses) doesn't float, the hood table and the tiles agree on land, the Presidio's and Golden Gate Park's neighbourhoods read as
// parks and four of the city's don't, and every pose has its row.
import { registerHooks } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { parseBuildingTile, parseTerrainTile, Ground } = await import('../src/world/tiles.ts');
const { parseHoods } = await import('../src/world/hoods.ts');
const { gunzip, isGzip } = await import('../src/world/gunzip.ts');
const { hiddenAt } = await import('../src/world/towerStyles.ts');
const { config } = await import('../src/config.ts');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const CITY = resolve(root, arg('--city', 'public/city/sf'));
const OUT = arg('--out', null);
const SQUARE = 128; // liftGlsl.ts SQUARE: the areas' grid
const RADIUS = 9000; // m from the bridge's middle: every region the table can reach (60 s at Express is 6.7 km)
const CRUISE = config.flight.cruiseSpeed, EXPRESS = config.flight.surgeSpeed;
const BLAST = config.splat.blastRadius;
const CORRIDOR = BLAST; // "straight ahead": a square within a blast's radius of the line
const STEP = 4; // m between samples along a line
const fail = (msg) => {
  console.error(`mapcheck: ${msg}`);
  process.exit(2);
};

// ---- the data, as the game reads it
if (!existsSync(`${CITY}/city.json`)) fail(`no city.json under ${CITY}`);
const manifest = JSON.parse(readFileSync(`${CITY}/city.json`, 'utf8'));
const ggb = manifest.landmarks.find((l) => l.kind === 'ggb');
if (!ggb?.points || !ggb.deck) fail('no Golden Gate (ggb) with points and a deck in city.json');
const inflate = async (path) => {
  const b = readFileSync(path);
  let buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  if (isGzip(buf)) buf = await gunzip(buf).catch(() => fail(`${path}: a gzip cut short or broken`));
  return buf;
};
const hoods = parseHoods(await inflate(`${CITY}/hoods.bin`));
if (!hoods) fail('hoods.bin unreadable');
const keyOf = (ix, iz) => (((ix & 0xffff) << 16) | (iz & 0xffff)) >>> 0;
const hoodOf = new Map(); // square key -> neighbourhood index
hoods.squares.forEach((list, n) => list.forEach((k) => hoodOf.set(k, n)));
const tagged = new Set(hoods.tagged);

const [T1, T2] = [ggb.points[1], ggb.points[2]]; // the towers, south then north (Bridges.ts; main.ts's opening threads the gap beside the first)
const mid = [(T1[0] + T2[0]) / 2, (T1[1] + T2[1]) / 2];
const ts = manifest.tileSize, R = manifest.regionSize ?? 4;
const RS = ts * R;
const sq = new Map(); // key -> square record
const square = (k) => {
  let s = sq.get(k);
  if (!s) {
    s = { k, ix: ((k >>> 16) << 16) >> 16, iz: ((k & 0xffff) << 16) >> 16, houses: 0, land: 0, green: 0, water: 0, texels: 0, streets: new Map() };
    sq.set(k, s);
  }
  return s;
};
let regions = 0, tiles = 0, refs = 0, hidden = 0, landmarks = 0;
const rx0 = Math.floor((mid[0] - RADIUS) / RS), rx1 = Math.floor((mid[0] + RADIUS) / RS);
const rz0 = Math.floor((mid[1] - RADIUS) / RS), rz1 = Math.floor((mid[1] + RADIUS) / RS);
for (let rx = rx0; rx <= rx1; rx++)
  for (let rz = rz0; rz <= rz1; rz++) {
    const path = `${CITY}/r_${rx}_${rz}.bin`;
    if (!existsSync(path)) continue;
    const buf = await inflate(path);
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'SBR1') fail(`${path}: not a region bundle`);
    regions++;
    const count = dv.getUint32(4, true);
    for (let i = 0; i < count; i++) {
      const o = 8 + i * 24;
      const bOff = dv.getUint32(o + 8, true), bLen = dv.getUint32(o + 12, true), tOff = dv.getUint32(o + 16, true), tLen = dv.getUint32(o + 20, true);
      tiles++;
      if (bLen > 0) {
        const b = parseBuildingTile(buf.slice(bOff, bOff + bLen));
        // (City.addTile: a building's tiers are consecutive records sharing its paint index, one ref for all; its centroid the ground ring's mean)
        for (let r = 0; r < b.count; ) {
          let j = r + 1;
          while (j < b.count && b.index[j] === b.index[r]) j++;
          const s0 = b.vertStart[r], e0 = b.vertStart[r + 1];
          let cx = 0, cz = 0;
          for (let v = s0; v < e0; v++) {
            cx += b.xz[v * 2];
            cz += b.xz[v * 2 + 1];
          }
          cx /= e0 - s0;
          cz /= e0 - s0;
          let top = 0;
          for (let q = r; q < j; q++) top = Math.max(top, b.roofY[q] + b.roofH[q], b.baseY[q] + 2.5);
          if (hiddenAt(cx, cz, top - b.groundY[r])) hidden++;
          else if (b.index[r] >= manifest.buildingCount) landmarks++;
          else {
            square(keyOf(Math.floor(cx / SQUARE), Math.floor(cz / SQUARE))).houses++;
            refs++;
          }
          r = j;
        }
      }
      if (tLen > 0) {
        const t = parseTerrainTile(buf.slice(tOff, tOff + tLen), manifest.classN);
        const N = t.classN, tex = ts / N;
        for (let jj = 0; jj < N; jj++)
          for (let ii = 0; ii < N; ii++) {
            const x = t.originX + (ii + 0.5) * tex, z = t.originZ + (jj + 0.5) * tex;
            const s = square(keyOf(Math.floor(x / SQUARE), Math.floor(z / SQUARE)));
            const c = t.cls[jj * N + ii] & 15;
            s.texels++;
            if (c === Ground.WATER) s.water++;
            else {
              s.land++;
              if (c === Ground.GRASS || c === Ground.FOREST) s.green++;
            }
          }
        // street names: each centreline's length on each square (by its segments' midpoints)
        for (const st of t.streets) {
          const name = t.streetNames[st.name];
          if (!name) continue;
          for (let v = 0; v + 3 < st.xz.length; v += 2) {
            const ax = st.xz[v], az = st.xz[v + 1], bx = st.xz[v + 2], bz = st.xz[v + 3];
            const s = square(keyOf(Math.floor((ax + bx) / 2 / SQUARE), Math.floor((az + bz) / 2 / SQUARE)));
            s.streets.set(name, (s.streets.get(name) ?? 0) + Math.hypot(bx - ax, bz - az));
          }
        }
      }
    }
  }
if (!regions) fail(`no region bundles near the bridge under ${CITY}`);

// ---- what each square is
for (const s of sq.values()) {
  s.hood = hoodOf.get(s.k);
  s.inHood = s.hood !== undefined;
  s.tagged = tagged.has(s.k);
  s.park = s.land > 0 && s.green / s.land >= 0.5;
  s.standin = s.inHood && !s.tagged && s.houses > 0; // Lift.liftable on a square of its neighbourhood
}
// (a park neighbourhood: hoods.py makes every named park of 0.5 km2 a neighbourhood of its own, and the file keeps no flag for it, so: one whose
// land is PARK_HOOD or more grass or forest. The Presidio's and Golden Gate Park's halves and the Headlands' are 0.63 to 0.99 on this bake, the
// city's own 0.35 at most, Sausalito 0.57)
const PARK_HOOD = 0.6;
const hoodGreen = new Map();
for (const s of sq.values()) {
  if (!s.inHood) continue;
  const h = hoodGreen.get(s.hood) ?? { land: 0, green: 0 };
  h.land += s.land;
  h.green += s.green;
  hoodGreen.set(s.hood, h);
}
const parkHood = (n) => {
  const h = hoodGreen.get(n);
  return !!h && h.green / Math.max(1, h.land) >= PARK_HOOD;
};
for (const s of sq.values()) {
  s.parkHood = s.inHood && parkHood(s.hood);
  s.notPark = s.standin && !s.park; // and not a park square
  s.floats = s.notPark && !s.parkHood; // and not in a park neighbourhood
  s.kind = !s.inHood || s.land < s.texels * 0.5 ? (s.houses ? 'buildings on the water' : 'water') : s.floats ? 'FLOATS' : s.tagged ? (s.houses ? 'tagged houses' : 'tagged ground') : s.park ? (s.houses ? 'park with houses' : 'park') : s.parkHood ? (s.houses ? 'park hood houses' : 'park hood land') : 'land, no houses';
}
const at = (x, z) => sq.get(keyOf(Math.floor(x / SQUARE), Math.floor(z / SQUARE)));
const rect = (s) => [s.ix * SQUARE, s.iz * SQUARE, (s.ix + 1) * SQUARE, (s.iz + 1) * SQUARE];
const distRect = (x, z, s) => {
  const [x0, z0, x1, z1] = rect(s);
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
};
const nearPt = (x, z, s) => {
  const [x0, z0, x1, z1] = rect(s);
  return [Math.min(x1, Math.max(x0, x)), Math.min(z1, Math.max(z0, z))];
};
const streetsOf = (s) => [...s.streets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]);
const nameOf = (s) => (s.inHood ? hoods.names[s.hood] : '-');

// ---- the bridge: its deck as stations from the south end (s m along), its parts by station
const deck = ggb.deck.map(([x, z, y]) => ({ x, z, y }));
let acc = 0;
deck.forEach((p, i) => {
  if (i) acc += Math.hypot(p.x - deck[i - 1].x, p.z - deck[i - 1].z);
  p.s = acc;
});
const stationOf = (x, z) => {
  for (const p of deck) if (Math.hypot(p.x - x, p.z - z) < 1) return p.s;
  return NaN;
};
const sA = stationOf(...ggb.points[0]), sT1 = stationOf(...T1), sT2 = stationOf(...T2), sB = stationOf(...ggb.points[3]);
const HALF = 13.5, TOWER = 30; // Bridges.ts GGB.half; towerStyles HIDDEN's tower boxes (30 m half)
const partAt = (s) =>
  Math.abs(s - sT1) <= TOWER ? 'south tower' : Math.abs(s - sT2) <= TOWER ? 'north tower' : s < sA ? 'south approach' : s < sT1 ? 'south side span' : s < sT2 ? (Math.abs(s - (sT1 + sT2) / 2) < 150 ? 'main span, middle' : s < (sT1 + sT2) / 2 ? 'main span, south half' : 'main span, north half') : s < sB ? 'north side span' : 'north approach';
/** the deck's nearest point to (x, z): its plan distance to the centreline, station, deck top */
const onDeck = (x, z) => {
  let best = { d: Infinity, s: 0, y: 0, x: 0, z: 0 };
  for (let i = 1; i < deck.length; i++) {
    const a = deck[i - 1], b = deck[i];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, s: a.s + (b.s - a.s) * t, y: a.y + (b.y - a.y) * t, x: px, z: pz };
  }
  return best;
};
/** a tap's landing at the pose: config.splat's low breath, range + rangePerSpeed x speed ahead */
const tapReach = (v) => config.splat.range + config.splat.rangePerSpeed * v;
const bridgeFor = (p) => {
  const d = tapReach(p.v);
  const lx = p.x + p.fx * d, lz = p.z + p.fz * d;
  const o = onDeck(lx, lz);
  const ring = Math.max(0, o.d - HALF);
  const towers = Math.min(Math.hypot(lx - T1[0], lz - T1[1]), Math.hypot(lx - T2[0], lz - T2[1]));
  // flying straight on, the first second a tap's blast reaches the deck's ring (and the part it starts its run from)
  let first = null;
  for (let t = 0; t <= 60; t += 0.1) {
    const x = p.x + p.fx * (p.v * t + d), z = p.z + p.fz * (p.v * t + d);
    const q = onDeck(x, z);
    if (q.d - HALF <= BLAST) {
      first = { t: +t.toFixed(1), part: partAt(q.s), ring: Math.round(Math.max(0, q.d - HALF)) };
      break;
    }
  }
  const busDeck = onDeck(p.x, p.z);
  return { tap: Math.round(d), landing: [Math.round(lx), Math.round(lz)], ring: Math.round(ring), towers: Math.round(towers), part: partAt(o.s), inReach: ring <= BLAST, first, busToDeck: Math.round(Math.hypot(busDeck.d, p.y - busDeck.y)), under: busDeck.d < HALF && p.y < busDeck.y };
};

// ---- the poses
const unit = (dx, dz) => {
  const l = Math.hypot(dx, dz);
  return [dx / l, dz / l];
};
const headingOf = (dx, dz) => Math.atan2(dx, -dz); // Flight.ts: forward (sin h, -cos h)
const deg = (h) => ((((h * 180) / Math.PI) % 360) + 360) % 360;
// (a place's bearing from map coordinates, for a heading only: the tile's transverse Mercator near its origin)
const local = (lat, lon) => [(lon - manifest.origin[1]) * Math.cos((manifest.origin[0] * Math.PI) / 180) * 111320, -(lat - manifest.origin[0]) * 110574];
const north = unit(T2[0] - T1[0], T2[1] - T1[1]);
const along = (s0, ds) => [s0[0] + north[0] * ds, s0[1] + north[1] * ds];
const deckTop = onDeck(...mid).y;
const toward = (from, lat, lon) => {
  const [x, z] = local(lat, lon);
  return headingOf(x - from[0], z - from[1]);
};
// today's start: main.ts's opening, the gap 85 m north of the south tower, the bus 640 m back along the manifest's heading at its speed, 60 m up (Flight.y)
const h0 = manifest.start.heading;
const gap = along(T1, 85);
const T1e = [T1[0] + 45, T1[1]]; // just east of the south tower's box (its 30 m half and the bus)
const T2e = [T2[0] + 45, T2[1]];
const poses = [
  { name: "today's start (the opening, 640 m west of the gap)", x: gap[0] - Math.sin(h0) * 640, z: gap[1] + Math.cos(h0) * 640, h: h0, y: 60, v: manifest.start.speed ?? 60 },
  { name: 'under the deck, heading south (60 m past the north tower)', ...xz(along(T2, -60)), h: headingOf(-north[0], -north[1]), y: 45, v: CRUISE },
  { name: 'under the deck, heading north (60 m past the south tower)', ...xz(along(T1, 60)), h: headingOf(north[0], north[1]), y: 45, v: CRUISE },
  { name: 'along the deck, heading south (over the middle)', ...xz(mid), h: headingOf(-north[0], -north[1]), y: deckTop + 12, v: CRUISE },
  { name: 'along the deck, heading north (over the middle)', ...xz(mid), h: headingOf(north[0], north[1]), y: deckTop + 12, v: CRUISE },
  { name: 'off the south tower toward the city (Union Square)', ...xz(T1e), h: toward(T1e, 37.788, -122.4075), y: 60, v: CRUISE },
  { name: 'off the south tower toward the Presidio (due south)', ...xz(T1e), h: Math.PI, y: 60, v: CRUISE },
  { name: 'off the south tower toward the Marina (Marina Green)', ...xz(T1e), h: toward(T1e, 37.8065, -122.4405), y: 60, v: CRUISE },
  { name: 'off the south tower toward Sea Cliff (south-west)', ...xz(T1e), h: toward(T1e, 37.787, -122.49), y: 60, v: CRUISE },
  { name: 'off the north tower toward Sausalito', ...xz(T2e), h: toward(T2e, 37.859, -122.485), y: 60, v: CRUISE },
];
function xz(p) {
  return { x: p[0], z: p[1] };
}
for (const p of poses) {
  p.fx = Math.sin(p.h);
  p.fz = -Math.cos(p.h);
}

// ---- what lies along a line: runs of square kinds (the bridge's deck where the line is under or over it)
const between = (x0, z0, x1, z1) => {
  const L = Math.hypot(x1 - x0, z1 - z0), runs = [];
  for (let d = 0; d < L; d += STEP) {
    const x = x0 + ((x1 - x0) * d) / L, z = z0 + ((z1 - z0) * d) / L;
    const s = at(x, z);
    let k = s ? s.kind : 'water';
    if (onDeck(x, z).d < HALF + 2) k = 'the bridge';
    const last = runs[runs.length - 1];
    if (last && last.k === k) last.m += STEP;
    else runs.push({ k, m: STEP, hood: s?.inHood ? nameOf(s) : '' });
  }
  return runs;
};
const sumRuns = (runs) => {
  const tot = {};
  for (const r of runs) tot[r.k] = (tot[r.k] ?? 0) + r.m;
  return tot;
};
const fmtRuns = (runs) => {
  // (short runs merge into their neighbours' story: print runs of 24 m or more, in order)
  const out = [];
  for (const r of runs) {
    if (r.m < 24) continue;
    const last = out[out.length - 1];
    if (last && last.k === r.k) last.m += r.m;
    else out.push({ ...r });
  }
  return out.map((r) => `${r.k}${r.hood && r.k !== 'water' && r.k !== 'the bridge' ? ` (${r.hood})` : ''} ${r.m} m`).join(' > ');
};

const floating = [...sq.values()].filter((s) => s.floats);
const standin = [...sq.values()].filter((s) => s.standin);
const notPark = [...sq.values()].filter((s) => s.notPark);
// (a block: a square that floats with BLOCK houses or more, a street's worth lifting, not a lone harbour shed)
const BLOCK = 8;
const blocks = floating.filter((s) => s.houses >= BLOCK);
const result = [];
for (const p of poses) {
  const row = { pose: p.name, x: Math.round(p.x), z: Math.round(p.z), heading: Math.round(deg(p.h)), y: Math.round(p.y), v: p.v };
  // nearest in any direction (the turn it takes: its bearing off the heading)
  const near = (list) => {
    let best = null, bd = Infinity;
    for (const s of list) {
      const d = distRect(p.x, p.z, s);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { s: best, d: bd } : null;
  };
  // first straight ahead: the square whose rect comes within CORRIDOR of the line ahead, the least along it
  const ahead = (list) => {
    let best = null, ba = Infinity;
    for (const s of list) {
      const [cx, cz] = [(s.ix + 0.5) * SQUARE, (s.iz + 0.5) * SQUARE];
      const a = (cx - p.x) * p.fx + (cz - p.z) * p.fz;
      if (a <= 0) continue;
      const lat = Math.abs((cx - p.x) * -p.fz + (cz - p.z) * p.fx);
      if (lat - SQUARE * 0.71 > CORRIDOR) continue;
      // (the point of the line nearest its rect's near edge: the distance the bus flies before a tap reaches it)
      const reach = Math.max(0, a - SQUARE * 0.5 - Math.sqrt(Math.max(0, CORRIDOR * CORRIDOR - Math.max(0, lat - SQUARE * 0.5) ** 2)));
      if (reach < ba) {
        ba = reach;
        best = s;
      }
    }
    return best ? { s: best, d: ba } : null;
  };
  const describe = (hit, straight) => {
    if (!hit) return null;
    const { s, d } = hit;
    const [nx, nz] = straight ? [p.x + p.fx * d, p.z + p.fz * d] : nearPt(p.x, p.z, s);
    const [cx, cz] = [(s.ix + 0.5) * SQUARE, (s.iz + 0.5) * SQUARE];
    const off = ((deg(headingOf(cx - p.x, cz - p.z)) - deg(p.h) + 540) % 360) - 180;
    const runs = between(p.x, p.z, straight ? cx : nx, straight ? cz : nz);
    return { square: [s.ix, s.iz], centre: [Math.round(cx), Math.round(cz)], m: Math.round(d), cruise: +(d / CRUISE).toFixed(1), express: +(d / EXPRESS).toFixed(1), turn: Math.round(off), hood: nameOf(s), streets: streetsOf(s), houses: s.houses, green: +(s.green / Math.max(1, s.land)).toFixed(2), between: fmtRuns(runs), sums: sumRuns(runs) };
  };
  row.nearest = describe(near(floating), false);
  row.ahead = describe(ahead(floating), true);
  row.aheadBlock = describe(ahead(blocks), true);
  row.nearestNotPark = describe(near(notPark), false);
  row.aheadNotPark = describe(ahead(notPark), true);
  row.nearestStandin = describe(near(standin), false);
  row.bridge = bridgeFor(p);
  result.push(row);
}

// ---- self-checks: the reading is the game's (or the table means nothing)
const checks = [];
const check = (name, ok, info) => {
  checks.push({ name, ok, info });
};
const sT = at(T1[0], T1[1]), strait = at(mid[0], mid[1]);
check("the south tower's square doesn't float", !!sT && !sT.floats, sT?.kind);
check('the middle of the strait is water (no tile there, or water)', !strait || strait.kind === 'water', strait?.kind ?? 'no tile');
const alamo = hoods.names.findIndex((n) => n === 'Alamo Square');
const aH = alamo >= 0 ? sq.get(hoods.hearts[alamo]) : null;
check("Alamo Square's heart (a park, no houses) doesn't float", !!aH && !aH.floats && aH.houses === 0 && aH.park, aH ? { kind: aH.kind, houses: aH.houses, green: +(aH.green / Math.max(1, aH.land)).toFixed(2) } : 'not loaded');
let landNoHood = 0, hoodNoLand = 0, both = 0;
for (const s of sq.values()) {
  if (s.texels < 4096 * 0.99) continue; // (squares the loaded tiles cover whole)
  const land = s.land >= s.texels * 0.5;
  if (land && !s.inHood) landNoHood++;
  else if (!land && s.inHood && s.land < s.texels * 0.1) hoodNoLand++;
  else if (land && s.inHood) both++;
}
check('the hood table and the tiles agree on land (under 2 % of land squares off)', both > 0 && (landNoHood + hoodNoLand) / both < 0.02, { both, landNoHood, hoodNoLand });
check('every pose has its row', result.length === poses.length && result.length >= 8, result.length);
const hoodsNamed = (re) => hoods.names.map((n, i) => (re.test(n) ? i : -1)).filter((i) => i >= 0 && hoodGreen.has(i));
const parkHoods = hoodsNamed(/^(Presidio (West|East|Central)|Golden Gate Park)/), townHoods = hoodsNamed(/^(Marina District|Seacliff|Sausalito|Presidio Terrace)$/);
check("the Presidio's and Golden Gate Park's neighbourhoods are park neighbourhoods; the Marina, Seacliff, Sausalito and Presidio Terrace aren't", parkHoods.length >= 4 && parkHoods.every(parkHood) && townHoods.length === 4 && !townHoods.some(parkHood), { park: parkHoods.map((n) => hoods.names[n]), town: townHoods.map((n) => hoods.names[n]) });
check('some square floats near the bridge', floating.length > 0, floating.length);

// ---- the table
const pad = (s, n) => String(s).padEnd(n);
console.log(`mapcheck: ${CITY.replace(root, '.')}: ${regions} regions, ${tiles} tiles, ${refs} houses (${hidden} prop footprints and ${landmarks} landmarks left out), ${sq.size} squares; ${standin.length} lift by the stand-in's rule, ${notPark.length} of them not on a park square, ${floating.length} of those not in a park neighbourhood: they float`);
console.log(`Cruise ${CRUISE} m/s, Express ${EXPRESS} m/s; a tap lands range ${config.splat.range} + ${config.splat.rangePerSpeed} x speed ahead, its blast ${BLAST} m; "ahead" is within ${CORRIDOR} m of the line\n`);
console.log(`${pad('pose', 58)}${pad('hdg', 5)}${pad('nearest floats (any way)', 46)}${pad('first floats straight ahead', 46)}${pad(`first block (${BLOCK}+ houses) ahead`, 46)}first tap on the bridge`);
for (const r of result) {
  const f = (d) => (d ? `${d.m} m ${d.cruise}s/${d.express}s ${d.turn > 0 ? '+' : ''}${d.turn}deg ${d.hood}` : 'none');
  const b = r.bridge;
  console.log(`${pad(r.pose, 58)}${pad(r.heading, 5)}${pad(f(r.nearest), 46)}${pad(f(r.ahead), 46)}${pad(f(r.aheadBlock), 46)}${b.inReach ? `now: ${b.part}, ${b.ring} m` : b.first ? `at ${b.first.t} s: ${b.first.part}` : 'never straight on'}`);
}
console.log('');
for (const r of result) {
  console.log(`## ${r.pose}: (${r.x}, ${r.z}) heading ${r.heading} deg, ${r.y} m up, ${r.v} m/s`);
  for (const [label, d] of [['nearest that floats', r.nearest], ['first ahead that floats', r.ahead], [`first block ahead that floats (${BLOCK}+ houses)`, r.aheadBlock], ['nearest not on a park square (park neighbourhoods too)', r.nearestNotPark], ['first ahead not on a park square', r.aheadNotPark], ["nearest by the stand-in's rule (parks too)", r.nearestStandin]]) {
    if (!d) {
      console.log(`  ${label}: none within ${RADIUS / 1000} km`);
      continue;
    }
    console.log(`  ${label}: square ${d.square.join(',')} (${d.centre.join(', ')}), ${d.m} m: ${d.cruise} s at Cruise, ${d.express} s at Express; turn ${d.turn} deg; ${d.hood}; streets ${d.streets.join(' / ') || '(none named)'}; ${d.houses} houses, ${Math.round(d.green * 100)} % green`);
    console.log(`    between: ${d.between || '(nothing: it is under the bus)'}`);
  }
  const b = r.bridge;
  console.log(`  bridge: the bus ${b.under ? 'is under the deck' : `is ${b.busToDeck} m from the deck`}; a first tap lands ${b.tap} m ahead at (${b.landing.join(', ')}): ${b.ring} m from the deck's ring (${b.part}), ${b.towers} m from a tower: ${b.inReach ? `IN the ${BLAST} m blast, paints the bridge from the ${b.part}` : 'out of reach'}`);
  console.log(`    flying straight on: ${b.first ? `a tap reaches the bridge at ${b.first.t} s (${b.first.part}, ${b.first.ring} m off its ring)` : 'a tap never reaches the bridge'}`);
}
const best = result.filter((r) => r.ahead).sort((a, b) => a.ahead.m - b.ahead.m)[0];
const bestAny = result.filter((r) => r.nearest).sort((a, b) => a.nearest.m - b.nearest.m)[0];
console.log('');
console.log(best ? `closest first square straight ahead: ${best.pose}: ${best.ahead.m} m, ${best.ahead.cruise} s at Cruise, ${best.ahead.express} s at Express (${best.ahead.hood}, ${best.ahead.streets.join(' / ')})` : 'closest first square straight ahead: none');
console.log(bestAny ? `closest in any direction: ${bestAny.pose}: ${bestAny.nearest.m} m, ${bestAny.nearest.cruise} s at Cruise, turn ${bestAny.nearest.turn} deg (${bestAny.nearest.hood}, ${bestAny.nearest.streets.join(' / ')})` : 'closest in any direction: none');
const within = result.filter((r) => r.ahead && r.ahead.cruise <= 60).length, withinAny = result.filter((r) => r.nearest && r.nearest.cruise <= 60).length;
console.log(within ? `within 60 s at Cruise straight ahead: ${within} of ${result.length} poses` : 'NONE of the poses has a square that floats within 60 s at Cruise straight ahead');
console.log(withinAny ? `within 60 s at Cruise in any direction: ${withinAny} of ${result.length} poses` : 'NONE within 60 s at Cruise in any direction');
console.log('');
for (const c of checks) console.log(`${c.ok ? 'pass' : 'FAIL'}  ${c.name}  ${JSON.stringify(c.info)}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ city: CITY.replace(root, '.'), cruise: CRUISE, express: EXPRESS, blast: BLAST, poses: result, best: best?.pose ?? null, checks }, null, 1));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
