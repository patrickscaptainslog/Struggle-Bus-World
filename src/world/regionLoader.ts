// Fetch + inflate + parse + mesh one region bundle. Runs inside the city
// worker, or on the main thread when a sandbox forbids workers.
import { parseBuildingTile, parseTerrainTile } from './tiles';
import { meshBuildingTile, type MeshArrays } from './BuildingMesher';

export interface RegionRequest {
  type: 'region';
  id: number;
  url: string;
  classN: number;
  lod: 0 | 1;
  /** the city is San Francisco (the mesher's icons and HIDDEN tables apply) */
  sf: boolean;
}

export interface TileResult {
  tx: number;
  tz: number;
  building: ReturnType<typeof parseBuildingTile> | null;
  mesh: MeshArrays | null;
  /** the tile's collapsed growth elements (GROWN_STRIDE floats each; kept when a coarse region merges its meshes) */
  grown: Float32Array | null;
  terrain: ReturnType<typeof parseTerrainTile> | null;
}

export interface RegionResponse {
  type: 'region';
  id: number;
  tiles: TileResult[];
  lod: 0 | 1;
  /** coarse (lod 1) regions: every tile's buildings merged into one mesh (tiles[].mesh is then null) */
  merged?: MeshArrays | null;
  error?: string;
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
    index: new Uint32Array(ic),
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
      let grown = null;
      let terrain = null;
      if (bLen > 0) {
        building = parseBuildingTile(buf.slice(bOff, bOff + bLen));
        ({ mesh, grown } = meshBuildingTile(building, { lod: req.lod, sf: req.sf }));
        if (req.lod === 0) transfer.push(mesh.position.buffer, mesh.normal.buffer, mesh.facade.buffer, mesh.meta.buffer, mesh.bld.buffer, mesh.bld2.buffer, mesh.index.buffer);
        transfer.push(grown.buffer);
      }
      if (tLen > 0) {
        terrain = parseTerrainTile(buf.slice(tOff, tOff + tLen), req.classN);
        transfer.push(terrain.heights.buffer, terrain.obst.buffer, terrain.cls.buffer);
      }
      tiles.push({ tx, tz, building, mesh, grown, terrain });
    }
    let merged: MeshArrays | null = null;
    if (req.lod === 1) {
      // coarse regions draw as one mesh: far away (or high up) per-tile culling isn't worth 16 draws
      const list: MeshArrays[] = [];
      for (const t of tiles) {
        if (t.mesh && t.mesh.vertexCount > 0) list.push(t.mesh);
        t.mesh = null;
      }
      merged = mergeMeshes(list);
      transfer.push(merged.position.buffer, merged.normal.buffer, merged.facade.buffer, merged.meta.buffer, merged.bld.buffer, merged.bld2.buffer, merged.index.buffer);
    }
    return { type: 'region', id: req.id, tiles, lod: req.lod, merged };
  } catch (e) {
    return { type: 'region', id: req.id, tiles: [], lod: req.lod, error: String(e) };
  }
}
