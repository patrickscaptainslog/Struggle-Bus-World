#!/usr/bin/env node
// Saved paint is keyed by building stableId: a re-bake must never move an id
// to another building. Compares two baked cities (SBB1 or SBB2 tiles).
//   node tools/check-stable-ids.mjs <oldCityDir> <newCityDir>
// Checks, for every building of the old bake:
//   - its stableId still exists, on exactly one building (one paint index)
//   - that building is the same one: most of its new ground tier lies inside
//     the old footprint (LiDAR outlines trim/nudge footprints by a meter or two
//     and party-wall splits keep a piece of them; neither moves to a neighbor)
// and that ids new to this bake (split-off pieces, LiDAR-only towers) come
// after the old range, and that all tiers of a building share its id.
// Exit code 1 on any violation.
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const [oldDir, newDir] = process.argv.slice(2);
if (!oldDir || !newDir) {
  console.error('usage: node tools/check-stable-ids.mjs <oldCityDir> <newCityDir>');
  process.exit(1);
}

function parseBuildings(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  const v2 = magic === 'SBB2';
  if (!v2 && magic !== 'SBB1') throw new Error('bad building tile ' + magic);
  const count = dv.getUint32(4, true);
  const vc = dv.getUint32(8, true);
  const ox = dv.getFloat32(12, true), oz = dv.getFloat32(16, true);
  let o = 24;
  const u32 = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(dv.getUint32(o + i * 4, true)); o += n * 4; return a; };
  const f32 = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(dv.getFloat32(o + i * 4, true)); o += n * 4; return a; };
  const u8 = (n) => { const a = Array.from(buf.subarray(o, o + n)); o += n; return a; };
  const index = u32(count), stable = u32(count), vstart = u32(count + 1);
  f32(count); f32(count); // baseY, roofY
  if (v2) f32(count); // groundY
  for (let k = 0; k < 6; k++) u8(count);
  const tier = v2 ? u8(count) : new Array(count).fill(0);
  if (v2) u8(count); // taper
  o += (4 - ((count * (v2 ? 8 : 6)) % 4)) % 4;
  const vx = [], vz = [];
  for (let i = 0; i < vc; i++) vx.push(ox + dv.getInt16(o + i * 2, true) / 10);
  o += vc * 2;
  for (let i = 0; i < vc; i++) vz.push(oz + dv.getInt16(o + i * 2, true) / 10);
  const recs = [];
  for (let i = 0; i < count; i++) {
    const ring = [];
    for (let k = vstart[i]; k < vstart[i + 1]; k++) ring.push([vx[k], vz[k]]);
    recs.push({ index: index[i], stable: stable[i], tier: tier[i], ring });
  }
  return recs;
}

function loadCity(dir) {
  const recs = [];
  for (const f of readdirSync(dir)) {
    if (!/^r_-?\d+_-?\d+\.bin$/.test(f)) continue;
    let buf = readFileSync(join(dir, f));
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const n = dv.getUint32(4, true);
    for (let i = 0; i < n; i++) {
      const o = 8 + i * 24;
      const bOff = dv.getUint32(o + 8, true), bLen = dv.getUint32(o + 12, true);
      if (bLen) for (const r of parseBuildings(buf.subarray(bOff, bOff + bLen))) recs.push(r);
    }
  }
  return recs;
}

const centroid = (ring) => {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
};
const inside = (ring, x, z) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};

/** Fraction of ring a's area that lies inside ring b (sampled on a grid of ~400 points). */
function overlap(a, b) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of a) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const st = Math.max(0.25, Math.sqrt(((x1 - x0) * (z1 - z0)) / 400));
  let n = 0, k = 0;
  for (let x = x0 + st / 2; x < x1; x += st)
    for (let z = z0 + st / 2; z < z1; z += st) {
      if (!inside(a, x, z)) continue;
      n++;
      if (inside(b, x, z)) k++;
    }
  return n ? k / n : 0;
}

const oldRecs = loadCity(oldDir);
const newRecs = loadCity(newDir);
const old = new Map();
for (const r of oldRecs) if (r.tier === 0) old.set(r.stable, r);
let oldMax = -1;
for (const id of old.keys()) if (id > oldMax) oldMax = id;

const byIdx = new Map();
for (const r of newRecs) {
  let g = byIdx.get(r.index);
  if (!g) byIdx.set(r.index, (g = []));
  g.push(r);
}
const errors = [];
const neu = new Map(); // stableId -> ground tier record
let tiered = 0, partsTotal = 0;
for (const [idx, g] of byIdx) {
  const ids = new Set(g.map((r) => r.stable));
  if (ids.size !== 1) errors.push(`paint index ${idx}: parts carry ${ids.size} different stableIds`);
  const base = g.find((r) => r.tier === 0);
  if (!base) { errors.push(`paint index ${idx}: no ground tier`); continue; }
  if (neu.has(base.stable)) errors.push(`stableId ${base.stable} on two buildings (paint ${neu.get(base.stable).index} and ${idx})`);
  neu.set(base.stable, base);
  if (g.length > 1) tiered++;
  partsTotal += g.length;
}

let missing = 0, moved = 0, maxShift = 0;
const shifts = [];
for (const [id, o] of old) {
  const n = neu.get(id);
  if (!n) { missing++; if (missing <= 10) errors.push(`stableId ${id} disappeared`); continue; }
  const [ox, oz] = centroid(o.ring), [nx, nz] = centroid(n.ring);
  const d = Math.hypot(nx - ox, nz - oz);
  shifts.push(d);
  if (d > maxShift) maxShift = d;
  const ov = d > 1 ? overlap(n.ring, o.ring) : 1;
  if (ov < 0.5) {
    moved++;
    if (moved <= 10) errors.push(`stableId ${id} moved ${d.toFixed(1)} m off its old footprint (${(100 * ov).toFixed(0)} % inside; old ${ox.toFixed(1)},${oz.toFixed(1)} new ${nx.toFixed(1)},${nz.toFixed(1)})`);
  }
}
let added = 0;
for (const id of neu.keys()) if (!old.has(id)) { added++; if (id <= oldMax) errors.push(`new stableId ${id} inside the old id range`); }
shifts.sort((a, b) => a - b);
const q = (p) => (shifts.length ? shifts[Math.min(shifts.length - 1, Math.floor(p * shifts.length))] : 0).toFixed(2);

console.log(`old: ${old.size} buildings (ids 0..${oldMax}); new: ${neu.size} buildings in ${partsTotal} parts (${tiered} multi-part)`);
console.log(`kept ${old.size - missing}/${old.size} ids; added ${added} (all > ${oldMax}); centroid shift p50 ${q(0.5)} m, p99 ${q(0.99)} m, max ${maxShift.toFixed(1)} m`);
console.log(`moved off their footprint: ${moved}; missing: ${missing}`);
if (errors.length) {
  for (const e of errors.slice(0, 30)) console.log('  FAIL', e);
  process.exit(1);
}
console.log('OK: no existing stableId changed buildings');
