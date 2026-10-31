// Every mapped roof casts: for each tile of a city, every roof the mesher built must stand in the sun pass's caster proxy
// as high as in the visible mesh. Per tile: the highest vertex of each, and per built roof a caster vertex at its top.
//   node tools/feel-sim/run.mjs s_caster.ts
//   SB_DATA=public/city/amsterdam node tools/feel-sim/run.mjs s_caster.ts
import './env';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DATA_DIR } from './env';
import { parseBuildingTile } from '@src/world/tiles';
import { meshBuildingTile, meshCasterTile, roofKinds } from '@src/world/BuildingMesher';
import { eaveY } from '@src/world/roofGeom';

const manifest = JSON.parse(readFileSync(`${DATA_DIR}/city.json`, 'utf8'));
const sf = Math.abs(manifest.origin[0] - 37.7749) < 1e-6;
let tiles = 0, tileLow = 0, roofs = 0, cast = 0;
const lost: string[] = [];
for (const [rx, rz] of manifest.regions as Array<[number, number, number]>) {
  const raw = readFileSync(`${DATA_DIR}/r_${rx}_${rz}.bin`);
  const buf = raw[0] === 0x1f ? gunzipSync(raw) : raw;
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const dv = new DataView(ab);
  const count = dv.getUint32(4, true);
  for (let i = 0; i < count; i++) {
    const o = 8 + i * 24;
    const bOff = dv.getUint32(o + 8, true), bLen = dv.getUint32(o + 12, true);
    if (!bLen) continue;
    const b = parseBuildingTile(ab.slice(bOff, bOff + bLen));
    const kinds = roofKinds(b);
    const m = meshBuildingTile(b, { lod: 0, sf, kinds }).mesh;
    const c = meshCasterTile(b, sf, kinds);
    let top = -Infinity, ctop = -Infinity;
    // (the solid part of the mesh: collapsed growth sits on its anchors anyway)
    for (let v = 0; v < m.vertexCount; v++) top = Math.max(top, m.position[v * 3 + 1]);
    for (let v = 0; v < c.vertexCount; v++) ctop = Math.max(ctop, c.position[v * 3 + 1]);
    tiles++;
    if (ctop < top - 0.01) tileLow++;
    // each built roof: a caster vertex inside its bounds at its ridge / apex
    for (let k = 0; k < b.count; k++) {
      if (!kinds[k]) continue;
      roofs++;
      const want = eaveY(b.baseY[k], b.roofY[k], b.tier[k]) + b.roofH[k];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let v = b.vertStart[k]; v < b.vertStart[k + 1]; v++) {
        x0 = Math.min(x0, b.xz[v * 2]); x1 = Math.max(x1, b.xz[v * 2]);
        z0 = Math.min(z0, b.xz[v * 2 + 1]); z1 = Math.max(z1, b.xz[v * 2 + 1]);
      }
      let hit = false;
      for (let v = 0; v < c.vertexCount && !hit; v++) {
        const x = c.position[v * 3], y = c.position[v * 3 + 1], z = c.position[v * 3 + 2];
        if (x >= x0 - 0.01 && x <= x1 + 0.01 && z >= z0 - 0.01 && z <= z1 + 0.01 && Math.abs(y - want) < 0.05) hit = true;
      }
      if (hit) cast++;
      else if (lost.length < 8) lost.push(`${b.stableId[k]} shape ${b.roofShape[k]} top ${want.toFixed(1)}`);
    }
  }
}
console.log(JSON.stringify({ data: DATA_DIR, tiles, tilesWithALowerCaster: tileLow, builtRoofs: roofs, casting: cast, lost }));
