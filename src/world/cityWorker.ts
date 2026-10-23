/// <reference lib="webworker" />
// Fetches a gzip'd region bundle, inflates it, parses tiles and builds the
// building meshes off the main thread. Posts typed arrays back as transferables.
import { parseBuildingTile, parseTerrainTile } from './tiles';
import { meshBuildingTile } from './BuildingMesher';

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
  terrain: ReturnType<typeof parseTerrainTile> | null;
}

export interface RegionResponse {
  type: 'region';
  id: number;
  tiles: TileResult[];
  lod: 0 | 1;
  error?: string;
}

async function inflate(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

self.onmessage = async (ev: MessageEvent<RegionRequest>) => {
  const req = ev.data;
  if (req.type !== 'region') return;
  try {
    const res = await fetch(req.url);
    if (!res.ok) throw new Error(`${res.status} ${req.url}`);
    let buf = await res.arrayBuffer();
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) buf = await inflate(buf);
    const dv = new DataView(buf);
    const count = dv.getUint32(4, true);
    const tiles: TileResult[] = [];
    const transfer: Transferable[] = [];
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
      let terrain = null;
      if (bLen > 0) {
        building = parseBuildingTile(buf.slice(bOff, bOff + bLen));
        mesh = meshBuildingTile(building, { lod: req.lod });
        transfer.push(mesh.position.buffer, mesh.normal.buffer, mesh.facade.buffer, mesh.meta.buffer, mesh.bld.buffer, mesh.bld2.buffer, mesh.index.buffer);
      }
      if (tLen > 0) {
        terrain = parseTerrainTile(buf.slice(tOff, tOff + tLen), req.classN);
        transfer.push(terrain.heights.buffer, terrain.obst.buffer, terrain.cls.buffer);
      }
      tiles.push({ tx, tz, building, mesh, terrain });
    }
    const msg: RegionResponse = { type: 'region', id: req.id, tiles, lod: req.lod };
    (self as unknown as Worker).postMessage(msg, transfer);
  } catch (e) {
    const msg: RegionResponse = { type: 'region', id: req.id, tiles: [], lod: req.lod, error: String(e) };
    (self as unknown as Worker).postMessage(msg);
  }
};
