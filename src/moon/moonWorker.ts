/// <reference lib="webworker" />
// The generator off the main thread: one worker for the far levels and the regions, one job at a time, in the order asked. See gen.ts; moonBoot.ts is the other end.
import { Ground } from '../world/tiles';
import { gunzip, isGzip } from '../world/gunzip';
import type { RegionRequest, RegionResponse, TileResult } from '../world/regionLoader';
import { FarStore, MoonGen, makeRegion, sunLine } from './gen';
import { makeFrame, readAlbedo, readPlaces, readRelief, readWindow, type PlaceRow } from './map';

export interface MoonInit {
  type: 'init';
  base: string;
  lat: number;
  lon: number;
  seed: number;
  /** toward the Sun, the map's frame */
  sun: [number, number, number];
  bounds: [number, number, number, number];
  /** where the bus starts (m), for the height it asks back */
  startX: number;
  startZ: number;
}

export interface MoonFarRequest {
  type: 'far';
  /** coarse levels first: [k, bi0, bj0] */
  moves: Array<[number, number, number]>;
}

export interface MoonReady {
  type: 'ready';
  datum: number;
  /** the ground under the start (world Y) */
  startY: number;
}

export type MoonRegionRequest = RegionRequest & { rx: number; rz: number };

let gen: MoonGen | null = null;
let far: FarStore | null = null;
const post = (self as unknown as Worker).postMessage.bind(self) as (m: unknown, t?: Transferable[]) => void;

async function file(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b = await r.arrayBuffer();
  return isGzip(b) ? gunzip(b) : b;
}

async function init(m: MoonInit) {
  const [relief, real, albedo, rows] = await Promise.all([file(`${m.base}/moon/relief.bin`), file(`${m.base}/moon/theophilus.bin`), file(`${m.base}/sky/moon.bin`), fetch(`${m.base}/moon/places.json`).then((r) => r.json() as Promise<PlaceRow[]>)]);
  gen = new MoonGen({ relief: readRelief(relief), albedo: readAlbedo(albedo), window: readWindow(real), places: readPlaces(rows) }, makeFrame(m.lat, m.lon), sunLine(m.sun[0], m.sun[1], m.sun[2]), m.seed, m.bounds);
  far = new FarStore(gen);
  post({ type: 'ready', datum: gen.datum, startY: gen.heightAt(m.startX, m.startZ, 8) } satisfies MoonReady);
}

function region(q: MoonRegionRequest): void {
  try {
    const { tiles: list, rocks, transfer } = makeRegion(gen!, q.rx, q.rz, q.lod, far!.planeAt);
    const tiles: TileResult[] = list.map((t) => ({
      tx: t.tx, tz: t.tz, building: null, kinds: null, mesh: null, sphere: null, caster: null, grown: null, tops: null,
      terrain: {
        tx: t.tx, tz: t.tz, n: t.n, cell: t.cell, originX: t.tx * q.tileSize, originZ: t.tz * q.tileSize, heights: t.heights, obstN: 32, obst: t.obst, trees: [], classN: 1, cls: Uint8Array.of(Ground.ROCK),
        streetNames: [], streets: [], hoodGrid: null, moon: t.moon,
      },
      grid: t.grid,
    }));
    post({ type: 'region', id: q.id, tiles, lod: q.lod, merged: null, mergedSphere: null, rx: q.rx, rz: q.rz, rocks } satisfies RegionResponse, transfer);
  } catch (e) {
    post({ type: 'region', id: q.id, tiles: [], lod: q.lod, error: String(e) } satisfies RegionResponse);
  }
}

// (one queue: nothing a far level or a region asks of the store runs beside anything else)
let queue: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent<MoonInit | MoonFarRequest | MoonRegionRequest>) => {
  const m = ev.data;
  queue = queue
    .then(async () => {
      if (m.type === 'init') await init(m);
      else if (m.type === 'far') {
        for (const [k, bi0, bj0] of m.moves) {
          const u = far!.move(k, bi0, bj0);
          post(u, [u.blocks.buffer, u.map.buffer, u.heights.buffer]);
        }
      } else if (m.type === 'region') region(m);
    })
    .catch((e) => console.error('moon worker', e));
};
