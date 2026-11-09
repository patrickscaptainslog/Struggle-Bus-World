#!/usr/bin/env node
// Buses on the city's real routes (LIFE.md, "Bus routes"; src/life/sim/buses.ts), in Node on San Francisco's baked buses.bin and its own road graphs:
// node --no-warnings tools/life/buses.mjs
//   file     buses.bin parses: every line 800 m or more, its stops in order from its start to its end
//   road     every line, a point every 40 m off its tunnels: within a road's lanes of the map's own roads and at the road's height
//   hours    a Thursday's buses out over the whole city at 08:00, 13:00, 22:30 and 03:00: most at the rush, only night lines' at 03:00; a line's departures an hour
//   trip     one bus followed stop to stop, a second at a time: never over its speed, no jump, a wait at each stop, about 4.5 m/s with the stops in it
//   rows     the buses within 1.2 km of a point downtown: each a truck with the bus's look, within reach, its key its own and told
//   same     the same moment asked twice, and again after an hour of other moments: the same bytes
//   tunnel   a line with a tunnel: none of its buses is ever placed in it
//   mix      with the lines in, the cars' mix makes no bus of its own on the same roads at the same moment (its bus slots are cars); without, it does
// Exit 1 on a failure.
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { busesOn, busEvery, busTune, parseBusLines } = await import('../../src/life/sim/buses.ts');
const { buildNet, carMix, carsOn } = await import('../../src/life/sim/cars.ts');
const { Col, Kind, ROW } = await import('../../src/life/kinds.ts');
const { rolldown } = await import('rolldown');
const { gunzipSync } = await import('node:zlib');
const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
const { fileURLToPath, pathToFileURL } = await import('node:url');
const here = fileURLToPath(new URL('.', import.meta.url)), root = fileURLToPath(new URL('../..', import.meta.url)), outDir = `${here}.out`;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/entry-buses.ts`, `export { parseRegionGraph } from '${root.replace(/\\/g, '/')}src/world/lifeData.ts';`);
const bundle = await rolldown({ input: `${outDir}/entry-buses.ts`, platform: 'node', logLevel: 'warn' });
await bundle.write({ dir: outDir, format: 'esm', entryFileNames: 'lifedata-buses.mjs' });
await bundle.close();
const { parseRegionGraph } = await import(pathToFileURL(`${outDir}/lifedata-buses.mjs`).href);

let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const city = `${root}public/city/sf`, man = JSON.parse(readFileSync(`${city}/city.json`, 'utf8')), M = man.regionSize * man.tileSize;
const inflate = (b) => (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b);
const raw = inflate(readFileSync(`${city}/buses.bin`)), lines = parseBusLines(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const TZ = -480, at = (hhmm) => Date.parse(`2026-11-05T${hhmm}:00-08:00`), ALL = 1e6;
const out = new Float32Array(4096 * ROW), u32 = new Uint32Array(out.buffer);
/** The buses at utcMs within reach of (x, z): each row's key, place, speed and look. */
const buses = (utcMs, x = 0, z = 0, reach = ALL, of = lines) => {
  const keys = new Map(), n = busesOn(of, utcMs, TZ, x, z, reach, out, 0, 4096, (h, k) => keys.set(h, k)), rows = [];
  for (let i = 0; i < n; i++) {
    const o = i * ROW;
    rows.push({ h: u32[o + Col.KEY], key: keys.get(u32[o + Col.KEY]), kind: out[o + Col.KIND], x: out[o + Col.X], y: out[o + Col.Y], z: out[o + Col.Z], v: Math.hypot(out[o + Col.VX], out[o + Col.VY], out[o + Col.VZ]),
      look: out[o + Col.LOOK], scale: out[o + Col.SCALE], heading: out[o + Col.HEADING] });
  }
  return rows;
};
const r1 = (v) => +v.toFixed(1);

// ---- file ----
const km = lines.reduce((s, l) => s + l.len, 0) / 1000, shortest = Math.min(...lines.map((l) => l.len));
const ordered = lines.every((l) => l.stopS[0] === 0 && l.stopS[l.stopS.length - 1] === l.len && l.stopS.every((s, i) => !i || s > l.stopS[i - 1]) && l.stopT.every((t, i) => !i || t > l.stopT[i - 1]));
row('file: buses.bin parses: every line 800 m or more, its stops in order from its start to its end', lines.length > 50 && shortest >= 795 && ordered,
  { lines: lines.length, refs: new Set(lines.map((l) => l.ref)).size, km: Math.round(km), shortestM: Math.round(shortest), stops: lines.reduce((s, l) => s + l.stopS.length, 0), night: lines.filter((l) => l.night).length, bytes: readFileSync(`${city}/buses.bin`).length });

// ---- road: the map's own roads, every one ----
const CELL = 64, grid = new Map(), segs = [];
for (const [rx, rz] of man.life.regions) {
  let b;
  try {
    b = inflate(readFileSync(`${city}/g_${rx}_${rz}.bin`));
  } catch {
    continue;
  }
  const G = parseRegionGraph(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), M);
  if (!G) continue;
  const E = G.edges;
  for (let i = 0; i < E.n; i++) {
    if (E.kind[i] !== 1) continue;
    const m = E.shape[i + 1] - E.shape[i];
    const pt = (k) => {
      const src = k === 0 || k === m + 1 ? G.nodes.xyz : G.pts, q = (k === 0 ? E.a[i] : k === m + 1 ? E.b[i] : E.shape[i] + k - 1) * 3;
      return [src[q], src[q + 1], src[q + 2]];
    };
    let p = pt(0);
    for (let k = 1; k <= m + 1; k++) {
      const q = pt(k), id = segs.length;
      segs.push([p[0], p[1], p[2], q[0], q[1], q[2]]);
      for (let c = Math.floor(Math.min(p[0], q[0]) / CELL); c <= Math.floor(Math.max(p[0], q[0]) / CELL); c++)
        for (let d = Math.floor(Math.min(p[2], q[2]) / CELL); d <= Math.floor(Math.max(p[2], q[2]) / CELL); d++) {
          const key = c * 100003 + d;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(id);
        }
      p = q;
    }
  }
}
/** The nearest road to (x, y, z) within 16 m across: how far across, and how far off its height. One at the point's own height first, where two are stacked. */
const roadBy = (x, y, z) => {
  let best = null;
  for (let c = Math.floor((x - 16) / CELL); c <= Math.floor((x + 16) / CELL); c++)
    for (let d = Math.floor((z - 16) / CELL); d <= Math.floor((z + 16) / CELL); d++)
      for (const id of grid.get(c * 100003 + d) ?? []) {
        const s = segs[id], sx = s[3] - s[0], sz = s[5] - s[2], L2 = sx * sx + sz * sz || 1e-9, t = Math.max(0, Math.min(1, ((x - s[0]) * sx + (z - s[2]) * sz) / L2));
        const across = Math.hypot(x - s[0] - sx * t, z - s[2] - sz * t), dy = Math.abs(y - (s[1] + (s[4] - s[1]) * t));
        if (across > 16) continue;
        const cost = across + 3 * dy;
        if (!best || cost < best.cost) best = { cost, across, dy };
      }
  return best;
};
let pts = 0, offRoad = 0, offHeight = 0, worstAcross = 0, worstDy = 0;
for (const l of lines) {
  for (let s = 0; s <= l.len; s += 40) {
    let hid = false;
    for (let k = 0; k < l.hidden.length; k += 2) hid ||= s >= l.hidden[k] - 20 && s <= l.hidden[k + 1] + 20;
    if (hid) continue;
    let i = 1;
    while (i < l.cum.length - 1 && l.cum[i] < s) i++;
    const f = (s - l.cum[i - 1]) / (l.cum[i] - l.cum[i - 1] || 1), a = (i - 1) * 3, b = i * 3;
    const x = l.pts[a] + (l.pts[b] - l.pts[a]) * f, y = l.pts[a + 1] + (l.pts[b + 1] - l.pts[a + 1]) * f, z = l.pts[a + 2] + (l.pts[b + 2] - l.pts[a + 2]) * f, r = roadBy(x, y, z);
    pts++;
    if (!r || r.across > 12) offRoad++;
    else {
      worstAcross = Math.max(worstAcross, r.across);
      if (r.dy > 1.5) offHeight++;
      worstDy = Math.max(worstDy, r.dy);
    }
  }
}
row('road: every line, a point every 40 m off its tunnels: within a road\'s lanes of the map\'s roads, at the road\'s height', pts > 20000 && offRoad / pts < 0.03 && offHeight / pts < 0.03,
  { points: pts, offRoadShare: +(offRoad / pts).toFixed(4), offHeightShare: +(offHeight / pts).toFixed(4), worstAcrossM: r1(worstAcross), worstHeightM: r1(worstDy), roadStretches: segs.length });

// ---- hours ----
const count = (hhmm) => {
  const b = buses(at(hhmm)), nightKeys = new Set(lines.filter((l) => l.night).map((l) => `${l.ref}:${l.id}`));
  return { all: b.length, night: b.filter((r) => nightKeys.has(r.key.split(':').slice(1, 3).join(':'))).length };
};
const h8 = count('08:00'), h13 = count('13:00'), h22 = count('22:30'), h3 = count('03:00');
const day = lines.find((l) => !l.night && l.every === 1), per = [8, 13, 22, 3].map((h) => (busEvery(day, h) ? 60 / busEvery(day, h) : 0));
row('hours: a Thursday over the whole city: most out at the rush, fewer at 13:00 and 22:30, only night lines\' at 03:00', h8.all > h13.all && h13.all > h22.all && h22.all > h3.all && h3.all > 0 && h3.all === h3.night && h8.night === 0 && per.join() === '7.5,6,3,0',
  { at0800: h8.all, at1300: h13.all, at2230: h22.all, at0300: h3.all, nightLinesAt0300: h3.night, aDayLineAnHour: per });

// ---- trip: the 08:00 bus of the line with the most stops and no tunnel ----
const long = lines.filter((l) => !l.night && l.every === 1 && !l.hidden.length).sort((a, b) => b.stopS.length - a.stopS.length)[0];
const t0 = at('08:00'), first = buses(t0, 0, 0, ALL, [long]).sort((a, b) => a.key.localeCompare(b.key)).pop();
const dep = +first.key.split(':')[3], depUtc = (dep - TZ * 60) * 1000;
let over = 0, jump = 0, stands = 0, standing = 0, was = null, gone = 0, seen = 0, tEnd = 0;
for (let s = 1; s < long.trip - 1; s++) {
  const b = buses(depUtc + s * 1000, 0, 0, ALL, [long]).find((r) => r.key === first.key);
  if (!b) {
    was = null;
    continue;
  }
  seen++;
  tEnd = s;
  if (b.v > busTune.cruise + 0.01) over++;
  if (was) {
    const d = Math.hypot(b.x - was.x, b.z - was.z);
    gone += d;
    if (d > busTune.cruise * 1.05 + 0.5) jump++;
  }
  if (b.v < 0.01) standing++;
  else {
    if (standing >= busTune.dwell - 2) stands++;
    standing = 0;
  }
  was = b;
}
row('trip: one bus stop to stop, a second at a time: never over its speed, no jump, a wait at each stop, about 4.5 m/s with the stops in it',
  over === 0 && jump === 0 && stands === long.stopS.length - 2 && gone / tEnd > 3.3 && gone / tEnd < 6 && Math.abs(gone - long.len) < long.len * 0.03,
  { line: long.ref, km: r1(long.len / 1000), stops: long.stopS.length, tripMin: r1(long.trip / 60), overSpeed: over, jumps: jump, waits: stands, wentKm: r1(gone / 1000), meanMS: r1(gone / tEnd), seenS: seen });

// ---- rows: downtown, Market and Montgomery ----
const DX = 1700, DZ = -1700, near = buses(t0, DX, DZ, 1200), uniq = new Set(near.map((r) => r.h));
row('rows: within 1.2 km of a point downtown at 08:00: each a truck with the bus\'s look, in reach, its key its own and told',
  near.length > 10 && uniq.size === near.length && near.every((r) => r.kind === Kind.TRUCK && (r.look & 7) === 1 && r.key?.startsWith('bus:') && Math.hypot(r.x - DX, r.z - DZ) <= 1200 && r.scale > 0 && r.scale <= busTune.scale + 1e-6),
  { buses: near.length, lines: new Set(near.map((r) => r.key.split(':')[1])).size, refs: [...new Set(near.map((r) => r.key.split(':')[1]))].sort().slice(0, 14) });

// ---- same ----
const bytes = (utcMs) => {
  const n = busesOn(lines, utcMs, TZ, DX, DZ, 1200, out, 0, 4096);
  return Buffer.from(out.buffer, 0, n * ROW * 4).toString('base64');
};
const a1 = bytes(t0), a2 = bytes(t0);
for (let s = 1; s <= 3600; s += 7) bytes(t0 + s * 1000);
const a3 = bytes(t0);
row('same: the same moment twice, and again after an hour of other moments: the same bytes', a1 === a2 && a1 === a3 && a1.length > 100, { bytes: a1.length });

// ---- tunnel ----
const holed = lines.filter((l) => l.hidden.length).sort((a, b) => b.hidden[1] - b.hidden[0] - (a.hidden[1] - a.hidden[0]))[0];
let inside = 0, samples = 0;
if (holed) {
  const mid = (holed.hidden[0] + holed.hidden[1]) / 2;
  let i = 1;
  while (i < holed.cum.length - 1 && holed.cum[i] < mid) i++;
  const f = (mid - holed.cum[i - 1]) / (holed.cum[i] - holed.cum[i - 1] || 1), mx = holed.pts[(i - 1) * 3] + (holed.pts[i * 3] - holed.pts[(i - 1) * 3]) * f, mz = holed.pts[(i - 1) * 3 + 2] + (holed.pts[i * 3 + 2] - holed.pts[(i - 1) * 3 + 2]) * f;
  const half = (holed.hidden[1] - holed.hidden[0]) / 2;
  for (let s = 0; s < 3600; s += 3) {
    const b = buses(at('08:00') + s * 1000, 0, 0, ALL, [holed]);
    samples += b.length;
    inside += b.filter((r) => Math.hypot(r.x - mx, r.z - mz) < Math.min(15, half * 0.5)).length;
  }
}
row('tunnel: a line with a tunnel: none of its buses is ever placed in it', !!holed && samples > 100 && inside === 0, { line: holed?.ref, hiddenM: holed && Math.round(holed.hidden[1] - holed.hidden[0]), busSamples: samples, inside });

// ---- mix: the cars downtown, with and without the lines ----
const graphs = [];
for (const [rx, rz] of man.life.regions) {
  if (Math.hypot(Math.max(rx * M - DX, 0, DX - (rx + 1) * M), Math.max(rz * M - DZ, 0, DZ - (rz + 1) * M)) > 2100) continue;
  const b = inflate(readFileSync(`${city}/g_${rx}_${rz}.bin`));
  graphs.push(parseRegionGraph(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), M));
}
graphs.sort((p, q) => p.rx - q.rx || p.rz - q.rz);
const net = buildNet(graphs);
const carBuses = () => {
  const n = carsOn(net, at('17:30'), TZ, DX, DZ, 700, 1200, 1, out, 0, 4096);
  let b = 0, trucks = 0;
  for (let i = 0; i < n; i++) {
    if (out[i * ROW + Col.KIND] !== Kind.TRUCK) continue;
    trucks++;
    if ((out[i * ROW + Col.LOOK] & 7) === 1) b++;
  }
  return { vehicles: n, trucks, buses: b };
};
carMix.buses = true;
const own = carBuses();
carMix.buses = false;
const gave = carBuses();
carMix.buses = true;
row('mix: with the lines in, the cars\' mix makes no bus of its own on the same roads at the same moment; without, it does', own.buses > 5 && gave.buses === 0 && Math.abs(gave.vehicles - own.vehicles) <= 3 && Math.abs(gave.trucks - (own.trucks - own.buses)) <= 3, { without: own, withLines: gave });
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
