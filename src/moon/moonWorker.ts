/// <reference lib="webworker" />
// The generator off the main thread: one worker for the far levels and the regions, one job at a time, in the order asked. See gen.ts; moonBoot.ts is the other end.
import { Ground } from '../world/tiles';
import { gunzip, isGzip } from '../world/gunzip';
import type { RegionRequest, RegionResponse, TileResult } from '../world/regionLoader';
import { FarStore, MoonGen, craterList, makeRegion, sunLine, type MoonSource } from './gen';
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
  /** its heading (rad), and to look for lit ground near there: everywhere but the one start picked by hand */
  heading: number;
  seekLit: boolean;
  /** far levels: a world reached from orbit has more of them */
  levels: number;
}

/** A world reached from orbit: the generator again, round another place, with nothing of the last one kept. Anything asked for before this is dropped. */
export interface MoonPlace {
  type: 'place';
  id: number;
  lat: number;
  lon: number;
  /** toward the Sun, the map's frame, and Moon fixed */
  sun: [number, number, number];
  sunFix: [number, number, number];
  bounds: [number, number, number, number];
}

/** Where it stands, once it's made. */
export interface MoonPlaced {
  type: 'placed';
  id: number;
  datum: number;
}

export interface MoonFarRequest {
  type: 'far';
  /** coarse levels first: [k, bi0, bj0] */
  moves: Array<[number, number, number]>;
  /** the place it's for */
  place: number;
}

export interface MoonReady {
  type: 'ready';
  datum: number;
  /** where the bus starts after all, and the ground under it (world Y) */
  startX: number;
  startZ: number;
  startY: number;
}

export type MoonRegionRequest = RegionRequest & { rx: number; rz: number; place: number };

/** The craters around a place, for paint to pick from. */
export interface MoonCraterRequest {
  type: 'craters';
  id: number;
  cx: number;
  cz: number;
  half: number;
  minR: number;
}

export interface MoonCraters {
  type: 'craters';
  id: number;
  n: number;
  ids: Int32Array;
  data: Float32Array;
}

let gen: MoonGen | null = null;
let far: FarStore | null = null;
let src: MoonSource | null = null;
let seed = 0;
/** The place asked for last: read as the message arrives, not as the queue gets to it. */
let latest = 0;
const post = (self as unknown as Worker).postMessage.bind(self) as (m: unknown, t?: Transferable[]) => void;

async function file(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b = await r.arrayBuffer();
  return isGzip(b) ? gunzip(b) : b;
}

async function init(m: MoonInit) {
  const [relief, real, albedo, rows] = await Promise.all([file(`${m.base}/moon/relief.bin`), file(`${m.base}/moon/theophilus.bin`), file(`${m.base}/sky/moon.bin`), fetch(`${m.base}/moon/places.json`).then((r) => r.json() as Promise<PlaceRow[]>)]);
  src = { relief: readRelief(relief), albedo: readAlbedo(albedo), window: readWindow(real), places: readPlaces(rows) };
  seed = m.seed;
  gen = new MoonGen(src, makeFrame(m.lat, m.lon), sunLine(m.sun[0], m.sun[1], m.sun[2]), m.seed, m.bounds);
  far = new FarStore(gen, m.levels);
  const [startX, startZ] = m.seekLit ? gen.findLit(m.startX, m.startZ, m.heading) : [m.startX, m.startZ];
  post({ type: 'ready', datum: gen.datum, startX, startZ, startY: gen.heightAt(startX, startZ, 8) } satisfies MoonReady);
}

function place(m: MoonPlace): void {
  gen = new MoonGen(src!, makeFrame(m.lat, m.lon), sunLine(m.sun[0], m.sun[1], m.sun[2]), seed, m.bounds);
  gen.sunFix = m.sunFix;
  far!.reset(gen);
  post({ type: 'placed', id: m.id, datum: gen.datum } satisfies MoonPlaced);
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
self.onmessage = (ev: MessageEvent<MoonInit | MoonPlace | MoonFarRequest | MoonRegionRequest | MoonCraterRequest>) => {
  const m = ev.data;
  if (m.type === 'place') latest = m.id;
  queue = queue
    .then(async () => {
      if (m.type === 'init') await init(m);
      else if (m.type === 'place') {
        if (m.id === latest) place(m);
      } else if (m.type === 'far') {
        for (const [k, bi0, bj0] of m.moves) {
          if (m.place !== latest) break;
          const u = far!.move(k, bi0, bj0);
          post({ ...u, place: m.place }, [u.blocks.buffer, u.map.buffer, u.heights.buffer]);
        }
      } else if (m.type === 'region') {
        if (m.place === latest) region(m);
      } else if (m.type === 'craters') {
        const { n, ids, data } = craterList(gen!, m.cx, m.cz, m.half, m.minR);
        post({ type: 'craters', id: m.id, n, ids, data } satisfies MoonCraters, [ids.buffer, data.buffer]);
      }
    })
    .catch((e) => console.error('moon worker', e));
};
