// Fetch + inflate + parse + mesh one region bundle. Runs inside the city
// worker, or on the main thread when a sandbox forbids workers.
import { parseBuildingTile, parseTerrainTile } from './tiles';
import { meshBuildingTile, meshCasterTile, roofKinds, type CasterArrays, type MeshArrays } from './BuildingMesher';
import type { BuildingTile, TerrainTile } from './tiles';
import { gunzip, isGzip } from './gunzip';
import { eaveY, roofSurfaceY } from './roofGeom';
import { trimBridgeTiers } from './towerStyles';

export interface RegionRequest {
  type: 'region';
  id: number;
  url: string;
  classN: number;
  lod: 0 | 1;
  /** the city is San Francisco (the mesher's icons and HIDDEN tables apply) */
  sf: boolean;
  tileSize: number;
}

export interface TileResult {
  tx: number;
  tz: number;
  building: ReturnType<typeof parseBuildingTile> | null;
  /** per record of building: how its mapped roof is built (RoofBuild), as the mesher built it: gameplay's heights follow */
  kinds: Uint8Array | null;
  mesh: MeshArrays | null;
  /** bounds of mesh (center xyz, radius), computed here so the main thread never walks the vertices */
  sphere: Float32Array | null;
  /** full-detail tiles: the sun pass's caster proxy (a subset of mesh: its bounds are mesh's) */
  caster: CasterArrays | null;
  /** the tile's collapsed growth elements (GROWN_STRIDE floats each; kept when a coarse region merges its meshes) */
  grown: Float32Array | null;
  /** full-detail tiles: what the mesh's roofs add to the flight's obstacle grid, per cell (see roofTops) */
  tops: Float32Array | null;
  terrain: ReturnType<typeof parseTerrainTile> | null;
  /** the tile's ground grid, built here (4 m for detailed regions, 8 m for coarse ones) */
  grid: GridArrays | null;
}

/** A tile's ground grid: exactly makeHeightGrid's vertices and normals (terrainMaterial.ts; keep the two in step). */
export interface GridArrays {
  step: number;
  position: Float32Array;
  normal: Float32Array;
  index: Uint16Array | Uint32Array;
  /** center xyz, radius */
  sphere: Float32Array;
}

/** makeHeightGrid without three: runs in the worker, so the main thread only wraps the arrays. */
export function heightGrid(heights: Float32Array, n: number, cell: number, originX: number, originZ: number, step: number): GridArrays {
  const m = Math.floor((n - 1) / step) + 1;
  const pos = new Float32Array(m * m * 3);
  const nrm = new Float32Array(m * m * 3);
  const h = (ix: number, iz: number) => heights[Math.min(n - 1, Math.max(0, iz)) * n + Math.min(n - 1, Math.max(0, ix))];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const ix = i * step;
      const iz = j * step;
      const k = (j * m + i) * 3;
      pos[k] = originX + ix * cell;
      pos[k + 1] = h(ix, iz) + 0;
      pos[k + 2] = originZ + iz * cell;
      const sp = Math.max(2, step * 2);
      const dx = (h(ix + sp, iz) - h(ix - sp, iz)) / (2 * sp * cell);
      const dz = (h(ix, iz + sp) - h(ix, iz - sp)) / (2 * sp * cell);
      const l = Math.hypot(dx, 1, dz);
      nrm[k] = -dx / l;
      nrm[k + 1] = 1 / l;
      nrm[k + 2] = -dz / l;
    }
  }
  const idx = m * m < 65535 ? new Uint16Array((m - 1) * (m - 1) * 6) : new Uint32Array((m - 1) * (m - 1) * 6);
  let q = 0;
  for (let j = 0; j < m - 1; j++) {
    for (let i = 0; i < m - 1; i++) {
      const a = j * m + i;
      const b = a + 1;
      const c = a + m;
      const d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  return { step, position: pos, normal: nrm, index: idx, sphere: sphereOf(pos) };
}

export interface RegionResponse {
  type: 'region';
  id: number;
  tiles: TileResult[];
  lod: 0 | 1;
  /** coarse (lod 1) regions: every tile's buildings merged into one mesh (tiles[].mesh is then null) */
  merged?: MeshArrays | null;
  mergedSphere?: Float32Array | null;
  error?: string;
}

/** Distance from (x, z) to the segment a-b (m). */
function segDist(ax: number, az: number, bx: number, bz: number, x: number, z: number): number {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

/** True if (x, z) lies within `r` of record k's ring: inside it, or that close to an edge. */
function nearRing(b: BuildingTile, k: number, x: number, z: number, r: number): boolean {
  const s = b.vertStart[k], e = b.vertStart[k + 1];
  let inside = false;
  let d = Infinity;
  for (let i = s, j = e - 1; i < e; j = i++) {
    const xi = b.xz[i * 2], zi = b.xz[i * 2 + 1], xj = b.xz[j * 2], zj = b.xz[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    d = Math.min(d, segDist(xj, zj, xi, zi, x, z));
  }
  return inside || d <= r;
}

/**
 * What the detailed mesh adds to the flight's obstacle cells, per cell (the most: -Infinity = nothing): gable ridges,
 * chimneys, parapets and rooftop clutter (the bake's grid only knows the flat roofs). Every vertex lifts its own cell (a
 * box on a tower or a podium); a single-part house lifts every cell within 3 m of its footprint (as the bake's buffer) to
 * its top, so a gable's ridge holds between its two ends; a mapped roof on a building of several parts lifts its cells to
 * the drawn roof over them. Here because it walks every vertex: the main thread only takes the larger of two numbers per
 * cell (City.adoptTops).
 */
function roofTops(b: BuildingTile, kinds: Uint8Array, m: MeshArrays, tr: TerrainTile, tileSize: number): Float32Array {
  const N = tr.obstN, oc = tileSize / N;
  const out = new Float32Array(N * N).fill(-Infinity);
  // a building's records are consecutive, and so are its vertices in the tile's mesh
  const house = new Map<number, number>();
  for (let i = 0; i < b.count; i++) {
    const solo = (i === 0 || b.index[i - 1] !== b.index[i]) && (i + 1 === b.count || b.index[i + 1] !== b.index[i]);
    if (solo && b.tier[i] === 0) house.set(b.index[i], i);
  }
  let x0 = 0, z0 = 0, x1 = 0, z1 = 0, ix0 = 0, ix1 = 0, iz0 = 0, iz1 = 0;
  /** record k's bounds grown by `pad`, and the obstacle cells they touch */
  const cellsOf = (k: number, pad: number) => {
    x0 = Infinity; z0 = Infinity; x1 = -Infinity; z1 = -Infinity;
    for (let v = b.vertStart[k]; v < b.vertStart[k + 1]; v++) {
      const vx = b.xz[v * 2], vz = b.xz[v * 2 + 1];
      if (vx < x0) x0 = vx;
      if (vx > x1) x1 = vx;
      if (vz < z0) z0 = vz;
      if (vz > z1) z1 = vz;
    }
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
    ix0 = Math.max(0, Math.floor((x0 - tr.originX) / oc - 0.5));
    ix1 = Math.min(N - 1, Math.floor((x1 - tr.originX) / oc - 0.5) + 1);
    iz0 = Math.max(0, Math.floor((z0 - tr.originZ) / oc - 0.5));
    iz1 = Math.min(N - 1, Math.floor((z1 - tr.originZ) / oc - 0.5) + 1);
  };
  const flush = (id: number, top: number) => {
    const k = house.get(id);
    if (k === undefined || top <= b.roofY[k] + 0.3) return;
    cellsOf(k, 3);
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const c = iz * N + ix;
        if (out[c] >= top) continue;
        const cx = tr.originX + (ix + 0.5) * oc, cz = tr.originZ + (iz + 0.5) * oc;
        if (cx < x0 || cx > x1 || cz < z0 || cz > z1 || !nearRing(b, k, cx, cz, 3)) continue;
        out[c] = top;
      }
  };
  let cur = -1, top = -Infinity;
  for (let v = 0; v < m.vertexCount; v++) {
    const id = m.bld[v * 4];
    const y = m.position[v * 3 + 1];
    const ix = Math.floor((m.position[v * 3] - tr.originX) / oc), iz = Math.floor((m.position[v * 3 + 2] - tr.originZ) / oc);
    if (ix >= 0 && iz >= 0 && ix < N && iz < N && y > out[iz * N + ix]) out[iz * N + ix] = y;
    if (id !== cur) {
      if (cur >= 0) flush(cur, top);
      cur = id;
      top = y;
    } else if (y > top) top = y;
  }
  if (cur >= 0) flush(cur, top);
  // the part of a bigger building: its ridge runs between vertices that may be cells apart (the bake's grid holds 80 % of
  // the rise there). Each cell takes the roof at its center and corners, as drawn: a dome on a hall lifts only its dome
  for (let k = 0; k < b.count; k++) {
    if (!kinds[k] || house.get(b.index[k]) === k) continue;
    cellsOf(k, 0);
    const s = b.vertStart[k], e = b.vertStart[k + 1], eave = eaveY(b.baseY[k], b.roofY[k], b.tier[k]), h = oc / 2;
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const cx = tr.originX + (ix + 0.5) * oc, cz = tr.originZ + (iz + 0.5) * oc;
        for (let q = 0; q < 5; q++) {
          const x = q ? cx + (q & 1 ? h : -h) : cx, z = q ? cz + (q & 2 ? h : -h) : cz;
          if (!nearRing(b, k, x, z, 0)) continue;
          const y = roofSurfaceY(b.xz, s, e, eave, b.roofH[k], b.roofShape[k], b.roofDir[k], x, z);
          if (y > out[iz * N + ix]) out[iz * N + ix] = y;
        }
      }
  }
  return out;
}

/** Bounding sphere of a position array, as three computes it (its box's center, the farthest vertex): frustum culling draws what it drew. */
export function sphereOf(p: Float32Array): Float32Array {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (x0 > x1) return new Float32Array(4);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - cx, dy = p[i + 1] - cy, dz = p[i + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  return new Float32Array([cx, cy, cz, Math.sqrt(r2)]);
}

/** Concatenate building meshes (one draw for a whole coarse region): every mesh's solid triangles, then
 * every mesh's collapsed growth, so the merged mesh's solidIndexCount still splits them. */
function mergeMeshes(list: MeshArrays[]): MeshArrays {
  let vc = 0, ic = 0, sc = 0;
  for (const m of list) {
    vc += m.vertexCount;
    ic += m.index.length;
    sc += m.solidIndexCount;
  }
  const out: MeshArrays = {
    position: new Float32Array(vc * 3),
    normal: new Int8Array(vc * 3),
    facade: new Float32Array(vc * 2),
    meta: new Uint8Array(vc * 4),
    bld: new Float32Array(vc * 4),
    bld2: new Float32Array(vc * 2),
    index: vc < 65535 ? new Uint16Array(ic) : new Uint32Array(ic),
    vertexCount: vc,
    solidIndexCount: sc,
  };
  let vo = 0, io = 0, go = sc;
  for (const m of list) {
    out.position.set(m.position, vo * 3);
    out.normal.set(m.normal, vo * 3);
    out.facade.set(m.facade, vo * 2);
    out.meta.set(m.meta, vo * 4);
    out.bld.set(m.bld, vo * 4);
    out.bld2.set(m.bld2, vo * 2);
    for (let i = 0; i < m.solidIndexCount; i++) out.index[io + i] = m.index[i] + vo;
    for (let i = m.solidIndexCount; i < m.index.length; i++) out.index[go + i - m.solidIndexCount] = m.index[i] + vo;
    vo += m.vertexCount;
    io += m.solidIndexCount;
    go += m.index.length - m.solidIndexCount;
  }
  return out;
}

export async function loadRegion(req: RegionRequest, transfer: Transferable[] = []): Promise<RegionResponse> {
  try {
    const res = await fetch(req.url);
    if (!res.ok) throw new Error(`${res.status} ${req.url}`);
    let buf = await res.arrayBuffer();
    if (isGzip(buf)) buf = await gunzip(buf);
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'SBR1') throw new Error('not a region bundle');
    const count = dv.getUint32(4, true);
    const tiles: TileResult[] = [];
    for (let i = 0; i < count; i++) {
      const o = 8 + i * 24;
      const tx = dv.getInt32(o, true);
      const tz = dv.getInt32(o + 4, true);
      const bOff = dv.getUint32(o + 8, true);
      const bLen = dv.getUint32(o + 12, true);
      const tOff = dv.getUint32(o + 16, true);
      const tLen = dv.getUint32(o + 20, true);
      let building = null;
      let kinds = null;
      let mesh = null;
      let sphere = null;
      let caster = null;
      let grown = null;
      let tops = null;
      let terrain = null;
      let grid = null;
      if (bLen > 0) {
        building = parseBuildingTile(buf.slice(bOff, bOff + bLen));
        if (req.sf) trimBridgeTiers(building);
        kinds = roofKinds(building);
        ({ mesh, grown } = meshBuildingTile(building, { lod: req.lod, sf: req.sf, kinds }));
        // (hand everything over: a copied message deserializes on the main thread, a long task outside any frame)
        const b = building;
        for (const a of [b.index, b.stableId, b.vertStart, b.baseY, b.roofY, b.groundY, b.arch, b.floors, b.front, b.front2, b.hood, b.seed, b.tier, b.taper, b.roofShape, b.roofH, b.roofDir, b.facadeColor, b.roofColor, b.facadeMat, b.roofMat, b.source, b.xz, kinds]) transfer.push(a.buffer as ArrayBuffer);
        if (req.lod === 0) {
          sphere = sphereOf(mesh.position);
          caster = meshCasterTile(building, req.sf, kinds);
          transfer.push(mesh.position.buffer, mesh.normal.buffer, mesh.facade.buffer, mesh.meta.buffer, mesh.bld.buffer, mesh.bld2.buffer, mesh.index.buffer, caster.position.buffer, caster.index.buffer);
        }
        transfer.push(grown.buffer);
      }
      if (tLen > 0) {
        terrain = parseTerrainTile(buf.slice(tOff, tOff + tLen), req.classN);
        grid = heightGrid(terrain.heights, terrain.n, terrain.cell, terrain.originX, terrain.originZ, req.lod === 0 ? 2 : 4);
        transfer.push(terrain.heights.buffer, terrain.obst.buffer, terrain.cls.buffer, grid.position.buffer, grid.normal.buffer, grid.index.buffer);
        if (terrain.hoodGrid) transfer.push(terrain.hoodGrid.buffer as ArrayBuffer);
        for (const ln of terrain.streets) transfer.push(ln.xz.buffer as ArrayBuffer);
        if (mesh && req.lod === 0) {
          tops = roofTops(building!, kinds!, mesh, terrain, req.tileSize);
          transfer.push(tops.buffer);
        }
      }
      tiles.push({ tx, tz, building, kinds, mesh, sphere, caster, grown, tops, terrain, grid });
    }
    let merged: MeshArrays | null = null;
    let mergedSphere: Float32Array | null = null;
    if (req.lod === 1) {
      // coarse regions draw as one mesh: far away (or high up) per-tile culling isn't worth 16 draws
      const list: MeshArrays[] = [];
      for (const t of tiles) {
        if (t.mesh && t.mesh.vertexCount > 0) list.push(t.mesh);
        t.mesh = null;
      }
      merged = mergeMeshes(list);
      mergedSphere = sphereOf(merged.position);
      transfer.push(merged.position.buffer, merged.normal.buffer, merged.facade.buffer, merged.meta.buffer, merged.bld.buffer, merged.bld2.buffer, merged.index.buffer);
    }
    return { type: 'region', id: req.id, tiles, lod: req.lod, merged, mergedSphere };
  } catch (e) {
    return { type: 'region', id: req.id, tiles: [], lod: req.lod, error: String(e) };
  }
}
