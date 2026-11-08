// Four streets for the street camera preview (?streetcam, docs/specs/shots/GEARS.md), picked from the city's own road
// graph (the cars' g_<rx>_<rz>.bin, src/world/lifeData.ts), so any city gets its four the same way:
//   arterial     a primary or trunk road (or a secondary with two lanes each way), the longest straight flat run
//   residential  a residential street in the densest grid of them, straight and flat
//   hill         the steepest sustained grade a car can drive (residential or tertiary, 80 m at least)
//   waterfront   a through road with open water within 70 m along most of a long run
// No bridge, tunnel, link or car-free edge, and nothing on a deck (level 0). For each: lat, lon and heading at the run's
// middle, the bus in the right-hand lane, and the preview's link. Prints JSON (SB_OUT/streets.json too).
//   node tools/controls-sim/run.mjs ../streetcam/pick.ts
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseRegionGraph, EdgeFlag, type RegionGraph } from '@src/world/lifeData';
import { localToLatLon } from '@src/game/geo';

const DATA = process.env.SB_DATA!;
const manifest = JSON.parse(readFileSync(`${DATA}/city.json`, 'utf8'));
const regionM = (manifest.regionSize ?? 4) * (manifest.tileSize ?? 256);
const origin = manifest.origin as [number, number];
// (lifeData's enums are const: their numbers, as it says them)
const ROAD = 1, MOTORWAY = 1, TRUNK = 2, PRIMARY = 3, SECONDARY = 4, TERTIARY = 5, RESIDENTIAL = 6, OPEN_WATER = 8, FORWARD = 1, BACKWARD = 2;

type Run = { cls: number; lanes: number; dir: number; pts: number[] /* x, y, z */; len: number };
const runs: Run[] = [];
/** open water's triangles, bucketed by 64 m cell */
const CELL = 64;
const water = new Map<number, number[]>();
const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);

for (const f of readdirSync(DATA).filter((n) => /^g_-?\d+_-?\d+\.bin$/.test(n))) {
  const raw = readFileSync(`${DATA}/${f}`);
  const buf = raw[0] === 0x1f ? gunzipSync(raw) : raw;
  const g = parseRegionGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, regionM) as RegionGraph | null;
  if (!g) continue;
  const E = g.edges, N = g.nodes.xyz;
  for (let e = 0; e < E.n; e++) {
    if (E.kind[e] !== ROAD || E.level[e] !== 0) continue;
    if (E.flags[e] & (EdgeFlag.BRIDGE | EdgeFlag.TUNNEL | EdgeFlag.LINK | EdgeFlag.NO_CARS | EdgeFlag.UNDRAWN)) continue;
    const c = E.cls[e];
    if (c === MOTORWAY || c > RESIDENTIAL) continue;
    const pts: number[] = [];
    const a = E.a[e], b = E.b[e];
    pts.push(N[a * 3], N[a * 3 + 1], N[a * 3 + 2]);
    for (let p = E.shape[e]; p < E.shape[e + 1]; p++) pts.push(g.pts[p * 3], g.pts[p * 3 + 1], g.pts[p * 3 + 2]);
    pts.push(N[b * 3], N[b * 3 + 1], N[b * 3 + 2]);
    let len = 0;
    for (let i = 3; i < pts.length; i += 3) len += Math.hypot(pts[i] - pts[i - 3], pts[i + 2] - pts[i - 1]);
    runs.push({ cls: c, lanes: E.lanes[e], dir: E.dir[e], pts, len });
  }
  const A = g.areas;
  for (let i = 0; i < A.n; i++) {
    if (A.kind[i] !== OPEN_WATER) continue;
    for (let t = A.tri[i]; t < A.tri[i + 1]; t++) {
      const o = t * 9, xs = [A.xyz[o], A.xyz[o + 3], A.xyz[o + 6]], zs = [A.xyz[o + 2], A.xyz[o + 5], A.xyz[o + 8]];
      for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++)
        for (let cz = Math.floor(Math.min(...zs) / CELL); cz <= Math.floor(Math.max(...zs) / CELL); cz++) {
          const k = key(cx, cz);
          let l = water.get(k);
          if (!l) water.set(k, (l = []));
          l.push(xs[0], zs[0], xs[1], zs[1], xs[2], zs[2]);
        }
    }
  }
}

const inTri = (x: number, z: number, t: number[], o: number) => {
  const [ax, az, bx, bz, cx, cz] = [t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5]];
  const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz), d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz), d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const wet = (x: number, z: number) => {
  const l = water.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (l) for (let o = 0; o < l.length; o += 6) if (inTri(x, z, l, o)) return true;
  return false;
};
/** straightness: the chord over the length (1 straight) */
const straight = (r: Run) => Math.hypot(r.pts[r.pts.length - 3] - r.pts[0], r.pts[r.pts.length - 1] - r.pts[2]) / Math.max(1, r.len);
const grade = (r: Run) => Math.abs(r.pts[r.pts.length - 2] - r.pts[1]) / Math.max(1, Math.hypot(r.pts[r.pts.length - 3] - r.pts[0], r.pts[r.pts.length - 1] - r.pts[2]));
/** the point and heading at a share of the run, and the share of it with water within `reach` m on either side */
function at(r: Run, share: number) {
  let want = r.len * share, i = 3;
  for (; i < r.pts.length - 3; i += 3) {
    const s = Math.hypot(r.pts[i] - r.pts[i - 3], r.pts[i + 2] - r.pts[i - 1]);
    if (want <= s) break;
    want -= s;
  }
  const x0 = r.pts[i - 3], z0 = r.pts[i - 1], x1 = r.pts[i], z1 = r.pts[i + 2];
  const s = Math.max(1e-6, Math.hypot(x1 - x0, z1 - z0)), u = Math.min(1, want / s);
  return { x: x0 + (x1 - x0) * u, z: z0 + (z1 - z0) * u, y: r.pts[i - 2] + (r.pts[i + 1] - r.pts[i - 2]) * u, fx: (x1 - x0) / s, fz: (z1 - z0) / s };
}
const waterShare = (r: Run, reach: number) => {
  let hit = 0, n = 0;
  for (let k = 1; k < 20; k++) {
    const p = at(r, k / 20);
    n++;
    for (const side of [-1, 1]) if (wet(p.x - p.fz * reach * side, p.z + p.fx * reach * side) || wet(p.x - p.fz * reach * 0.5 * side, p.z + p.fx * reach * 0.5 * side)) { hit++; break; }
  }
  return hit / n;
};
/** residential edges within 300 m (the density of the grid) */
const grid = new Map<number, number>();
for (const r of runs) if (r.cls === RESIDENTIAL) { const p = at(r, 0.5), k = key(Math.floor(p.x / 300), Math.floor(p.z / 300)); grid.set(k, (grid.get(k) ?? 0) + 1); }
const density = (r: Run) => { const p = at(r, 0.5), cx = Math.floor(p.x / 300), cz = Math.floor(p.z / 300); let n = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += grid.get(key(cx + i, cz + j)) ?? 0; return n; };
const [bx0, bz0, bx1, bz1] = manifest.bounds as number[];
const inside = (r: Run) => { const p = at(r, 0.5); return p.x > bx0 + 500 && p.x < bx1 - 500 && p.z > bz0 + 500 && p.z < bz1 - 500; };

function best(name: string, keep: (r: Run) => boolean, score: (r: Run) => number) {
  let top: Run | null = null, s = -Infinity;
  for (const r of runs) if (inside(r) && keep(r)) { const v = score(r); if (v > s) { s = v; top = r; } }
  if (!top) return { name, none: true };
  const p = at(top, 0.5);
  // (facing the way it may be driven; the right-hand lane, the one at the curb)
  const back = top.dir === BACKWARD;
  const fx = back ? -p.fx : p.fx, fz = back ? -p.fz : p.fz;
  const lanes = Math.max(1, top.lanes || 1), oneWay = top.dir === FORWARD || top.dir === BACKWARD;
  const off = oneWay ? (lanes * 3.4) / 2 - 1.7 : lanes * 3.4 - 1.7;
  const x = p.x - fz * off, z = p.z + fx * off;
  const [lat, lon] = localToLatLon(x, z, origin);
  const heading = ((Math.atan2(fx, -fz) * 180) / Math.PI + 360) % 360;
  const q = `?streetcam&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&heading=${heading.toFixed(1)}&skipintro`;
  return { name, cls: top.cls, lanes: top.lanes, oneWay, lengthM: Math.round(top.len), grade: +grade(top).toFixed(3), straight: +straight(top).toFixed(3), water70: +waterShare(top, 70).toFixed(2), lat: +lat.toFixed(6), lon: +lon.toFixed(6), heading: +heading.toFixed(1), roadY: +p.y.toFixed(1), query: q };
}

const picks = [
  // (the lanes are often unmapped, 0: then a primary or a trunk counts as wide)
  best('arterial', (r) => (r.cls === PRIMARY || r.cls === TRUNK || (r.cls === SECONDARY && r.lanes >= 2)) && (r.lanes >= 2 || r.lanes === 0) && r.len >= 120 && straight(r) > 0.98 && grade(r) < 0.03 && waterShare(r, 70) === 0, (r) => r.len * Math.max(2, r.lanes) * (r.cls === SECONDARY ? 0.7 : 1)),
  best('residential', (r) => r.cls === RESIDENTIAL && r.len >= 110 && straight(r) > 0.98 && grade(r) < 0.04 && waterShare(r, 70) === 0, (r) => density(r) + r.len / 50),
  best('hill', (r) => (r.cls === RESIDENTIAL || r.cls === TERTIARY) && r.len >= 80 && straight(r) > 0.97 && grade(r) < 0.4, (r) => grade(r)),
  best('waterfront', (r) => (r.cls === PRIMARY || r.cls === SECONDARY || r.cls === TERTIARY) && r.len >= 150 && straight(r) > 0.96 && grade(r) < 0.03, (r) => waterShare(r, 70) * 1000 + r.len),
];
console.log(JSON.stringify({ city: manifest.slug, runs: runs.length, waterCells: water.size, picks }, null, 1));
if (process.env.SB_OUT) {
  mkdirSync(process.env.SB_OUT, { recursive: true });
  writeFileSync(`${process.env.SB_OUT}/streets.json`, JSON.stringify(picks, null, 1));
}
