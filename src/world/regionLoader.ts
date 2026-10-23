// Fetch + inflate + parse + mesh one region bundle. Runs inside the city
// worker, or on the main thread when a sandbox forbids workers.
import { parseBuildingTile, parseTerrainTile } from './tiles';
import { meshBuildingTile, meshCasterTile, type CasterArrays, type MeshArrays } from './BuildingMesher';

export interface RegionRequest {
  type: 'region';
  id: number;
  url: string;
  classN: number;
  lod: 0 | 1;
}

export interface TileResult {
  tx: number;
  tz: number;
  building: ReturnType<typeof parseBuildingTile> | null;
  mesh: ReturnType<typeof meshBuildingTile> | null;
  /** bounds of mesh (center xyz, radius), computed here so the main thread never walks the vertices */
  sphere: Float32Array | null;
  /** full-detail tiles: the sun pass's caster proxy (a subset of mesh: its bounds are mesh's) */
  caster: CasterArrays | null;
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
  /** where each tile's triangles end in merged's index (tiles order; -1 = no buildings): an upgrade swaps tile by tile */
  mergedEnds?: Int32Array | null;
  error?: string;
}

/** Bounding sphere of a position array (center of its box, half its diagonal). */
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
  return new Float32Array([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2]);
}

/** Concatenate building meshes (one draw for a whole coarse region). */
function mergeMeshes(list: MeshArrays[]): MeshArrays {
  let vc = 0, ic = 0;
  for (const m of list) {
    vc += m.vertexCount;
    ic += m.index.length;
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
  };
  let vo = 0, io = 0;
  for (const m of list) {
    out.position.set(m.position, vo * 3);
    out.normal.set(m.normal, vo * 3);
    out.facade.set(m.facade, vo * 2);
    out.meta.set(m.meta, vo * 4);
    out.bld.set(m.bld, vo * 4);
    out.bld2.set(m.bld2, vo * 2);
    for (let i = 0; i < m.index.length; i++) out.index[io + i] = m.index[i] + vo;
    vo += m.vertexCount;
    io += m.index.length;
  }
  return out;
}

async function inflate(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

export async function loadRegion(req: RegionRequest, transfer: Transferable[] = []): Promise<RegionResponse> {
  try {
    const res = await fetch(req.url);
    if (!res.ok) throw new Error(`${res.status} ${req.url}`);
    let buf = await res.arrayBuffer();
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) buf = await inflate(buf);
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
      let mesh = null;
      let sphere = null;
      let caster = null;
      let terrain = null;
      let grid = null;
      if (bLen > 0) {
        building = parseBuildingTile(buf.slice(bOff, bOff + bLen));
        mesh = meshBuildingTile(building, { lod: req.lod });
        if (req.lod === 0) {
          sphere = sphereOf(mesh.position);
          caster = meshCasterTile(building);
          transfer.push(mesh.position.buffer, mesh.normal.buffer, mesh.facade.buffer, mesh.meta.buffer, mesh.bld.buffer, mesh.bld2.buffer, mesh.index.buffer, caster.position.buffer, caster.index.buffer);
        }
      }
      if (tLen > 0) {
        terrain = parseTerrainTile(buf.slice(tOff, tOff + tLen), req.classN);
        grid = heightGrid(terrain.heights, terrain.n, terrain.cell, terrain.originX, terrain.originZ, req.lod === 0 ? 2 : 4);
        transfer.push(terrain.heights.buffer, terrain.obst.buffer, terrain.cls.buffer, grid.position.buffer, grid.normal.buffer, grid.index.buffer);
      }
      tiles.push({ tx, tz, building, mesh, sphere, caster, terrain, grid });
    }
    let merged: MeshArrays | null = null;
    let mergedSphere: Float32Array | null = null;
    let mergedEnds: Int32Array | null = null;
    if (req.lod === 1) {
      // coarse regions draw as one mesh: far away (or high up) per-tile culling isn't worth 16 draws
      const list: MeshArrays[] = [];
      mergedEnds = new Int32Array(tiles.length).fill(-1);
      let end = 0;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (t.mesh && t.mesh.vertexCount > 0) {
          list.push(t.mesh);
          end += t.mesh.index.length;
          mergedEnds[i] = end;
        }
        t.mesh = null;
      }
      merged = mergeMeshes(list);
      mergedSphere = sphereOf(merged.position);
      transfer.push(merged.position.buffer, merged.normal.buffer, merged.facade.buffer, merged.meta.buffer, merged.bld.buffer, merged.bld2.buffer, merged.index.buffer);
    }
    return { type: 'region', id: req.id, tiles, lod: req.lod, merged, mergedSphere, mergedEnds };
  } catch (e) {
    return { type: 'region', id: req.id, tiles: [], lod: req.lod, error: String(e) };
  }
}
