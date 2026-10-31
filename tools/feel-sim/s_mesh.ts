// What the mesher makes of a city, offline: triangles and vertices per region at LOD 0, LOD 1 and the sun's
// caster proxy, the rings' vertex counts, the heaviest regions. For a budget question ("what does the ceiling
// load?") before a browser is opened.
//   node tools/feel-sim/run.mjs s_mesh.ts          (the repo's public/city/sf)
//   SB_DATA=../sb-build/city/sf node tools/feel-sim/run.mjs s_mesh.ts
import './env';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DATA_DIR } from './env';
import { parseBuildingTile } from '@src/world/tiles';
import { meshBuildingTile, meshCasterTile, roofKinds } from '@src/world/BuildingMesher';

const manifest = JSON.parse(readFileSync(`${DATA_DIR}/city.json`, 'utf8'));
const sf = Math.abs(manifest.origin[0] - 37.7749) < 1e-6;
type Row = { rx: number; rz: number; bytes: number; tiles: number; recs: number; verts: number; l0: number; grow: number; l1: number; caster: number; l1v: number; l0ms: number; l1ms: number };
const rows: Row[] = [];
let n3 = 0, n5 = 0, n9 = 0, n17 = 0, nMore = 0, shaped = 0;
for (const [rx, rz] of manifest.regions as Array<[number, number, number]>) {
  const raw = readFileSync(`${DATA_DIR}/r_${rx}_${rz}.bin`);
  const buf = raw[0] === 0x1f ? gunzipSync(raw) : raw;
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const dv = new DataView(ab);
  const count = dv.getUint32(4, true);
  const r: Row = { rx, rz, bytes: raw.length, tiles: count, recs: 0, verts: 0, l0: 0, grow: 0, l1: 0, caster: 0, l1v: 0, l0ms: 0, l1ms: 0 };
  for (let i = 0; i < count; i++) {
    const o = 8 + i * 24;
    const bOff = dv.getUint32(o + 8, true), bLen = dv.getUint32(o + 12, true);
    if (!bLen) continue;
    const b = parseBuildingTile(ab.slice(bOff, bOff + bLen));
    const kinds = roofKinds(b);
    r.recs += b.count;
    r.verts += b.vertStart[b.count];
    for (let k = 0; k < b.count; k++) {
      const v = b.vertStart[k + 1] - b.vertStart[k];
      if (v <= 4) n3++;
      else if (v <= 8) n5++;
      else if (v <= 16) n9++;
      else if (v <= 32) n17++;
      else nMore++;
      if (kinds[k]) shaped++;
    }
    let t0 = performance.now();
    const a = meshBuildingTile(b, { lod: 0, sf, kinds }).mesh;
    const c = meshCasterTile(b, sf, kinds);
    r.l0ms += performance.now() - t0;
    t0 = performance.now();
    const d = meshBuildingTile(b, { lod: 1, sf, kinds }).mesh;
    r.l1ms += performance.now() - t0;
    r.l0 += a.solidIndexCount / 3;
    r.grow += (a.index.length - a.solidIndexCount) / 3;
    r.caster += c.index.length / 3;
    r.l1 += d.solidIndexCount / 3;
    r.l1v += d.vertexCount;
  }
  rows.push(r);
}
const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
console.log(JSON.stringify({
  data: DATA_DIR,
  buildings: manifest.buildingCount,
  regions: rows.length,
  records: sum((r) => r.recs),
  ringVerts: sum((r) => r.verts),
  rings: { '<=4': n3, '5-8': n5, '9-16': n9, '17-32': n17, '>32': nMore },
  shapedRecords: shaped,
  l0: sum((r) => r.l0),
  growth: sum((r) => r.grow),
  caster: sum((r) => r.caster),
  l1: sum((r) => r.l1),
  l1Verts: sum((r) => r.l1v),
  l0ms: Math.round(sum((r) => r.l0ms)),
  l1ms: Math.round(sum((r) => r.l1ms)),
}));
rows.sort((a, b) => b.l1 - a.l1);
for (const r of rows.slice(0, 12)) console.log(`r_${r.rx}_${r.rz}  ${(r.bytes / 1024).toFixed(0)} KB  recs ${r.recs}  ring verts ${r.verts}  l0 ${r.l0}  caster ${r.caster}  l1 ${r.l1}`);
