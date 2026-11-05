import { latLonToLocal } from '../game/geo';
import { gunzip, isGzip } from '../world/gunzip';
import { parseRegionGraph, type RegionGraph } from '../world/lifeData';
import { buildNet, carsOn, type CarNet } from './sim/cars';
import { peopleOn, type WalkTile } from './sim/people';
import { livePlanes, LIVE_HOLD, scriptedPlanes, type LivePlane } from './sim/planes';
import { MAX_ROWS, view, writeKey } from './snapshot';
import { CLEAR, type Weather } from './weather';

// Life's simulation (LIFE.md, "The worker"; CONTRACT.md section 5): every mover near the bus as a function of the place and utcMs, into the snapshot the host
// sends with each tick. It fetches the relay's planes itself, every RELAY_MS while it's ticking; a failed or empty answer leaves the scripted sky.

export interface LifeInit {
  type: 'init';
  slug: string;
  origin: [number, number];
  /** the page's URL, for the relay (api/planes); null: no relay (a test, or a page with nothing to ask) */
  relay: string | null;
  /** CONTRACT.md section 4: held at CLEAR until weather has an owner */
  weather?: Weather;
  /** the place's time zone (IANA, city.json's tz), for the local hour's traffic; none: the mean Sun's at its origin */
  tz?: string;
  /** the world's road graphs (CONTRACT.md section 1.2, city.json's life.regions): a region's URL with g_RXRZ for its name, the regions there are, and a region's side
   *  (m); none: no cars */
  graphs?: { url: string; regions: Array<[number, number]>; regionM: number };
}
/** A tile's ground for people, sampled by the host (Life.ts, sampleGround): its arrays transferred. `walk` null: the tile is far, and dropped. */
export interface LifeWalk {
  type: 'walk';
  tile: WalkTile | null;
  tx: number;
  tz: number;
}
export interface LifeTick {
  type: 'tick';
  utcMs: number;
  /** the bus on the map (m), where that is (degrees, for the relay), and the radius to fill round it */
  x: number;
  y: number;
  z: number;
  lat: number;
  lon: number;
  reach: number;
  buf: ArrayBuffer;
}

const RELAY_MS = 10000;
/** People are filled this far round the bus (m): a person is 2 px at about 800 m on the portrait lens */
const PEOPLE_REACH = 800;
/** O9: with no geoid for the place, no live plane is drawn under this (m) */
const NO_GEOID_FLOOR = 1000;
/** Cars round the bus (m): every one in CAR_FULL, fewer on out to none at CAR_REACH (3.5 px on the portrait lens), all of them while the bus is under CAR_THIN and fewer
 *  as it climbs, none over CAR_ALT */
const CAR_FULL = 700, CAR_REACH = 1200, CAR_THIN = 1500, CAR_ALT = 2500;
/** The road graphs are loaded for regions within CAR_LOAD of the bus, two at a time, and dropped past CAR_DROP (m): far enough out that a car driving into the
 *  reach was born in them */
const CAR_LOAD = 2100, CAR_DROP = 3500;

let place: LifeInit | null = null;
let weather: Weather = CLEAR;
let live: LivePlane[] = [];
let liveAt = -Infinity;
let asking = false;
let askedAt = -Infinity;
/** keys the host has been sent */
const sent = new Set<number>();
/** the ground round the bus people walk, by tile */
const walkTiles = new Map<string, WalkTile>();
/** the road graphs by region ("rx,rz"): loaded, being fetched, or failed (null: not asked again); the net cars drive, built from those loaded when they change */
const graphs = new Map<string, RegionGraph | 'asking' | null>();
let fetching = 0;
let net: CarNet | null = null;
let netStale = false;
/** the place's offset from UTC (min), worked out once a minute */
let tzMin = 0;
let tzAt = -1;
let tzFmt: Intl.DateTimeFormat | null = null;

/** The place's offset from UTC (min) at utcMs: from its zone once a minute (so Intl's few objects are no tick's), else the mean Sun's at its origin. */
function zoneOffset(utcMs: number): number {
  const minute = Math.floor(utcMs / 60000);
  if (minute === tzAt) return tzMin;
  tzAt = minute;
  tzMin = Math.round(place!.origin[1] * 4);
  if (place!.tz)
    try {
      tzFmt ??= new Intl.DateTimeFormat('en-US', { timeZone: place!.tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
      const p: Record<string, number> = {};
      for (const x of tzFmt.formatToParts(minute * 60000)) p[x.type] = Number(x.value);
      // (an engine that says 24 for midnight is one hour off from the rest of the day: none of its days have a 24)
      tzMin = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - minute * 60000) / 60000);
    } catch {
      /* the mean Sun's */
    }
  return tzMin;
}

/** The road graphs round the bus: the nearest regions in CAR_LOAD not asked for yet fetched, two at a time, and those past CAR_DROP dropped. */
function roads(x: number, z: number): void {
  const G = place?.graphs;
  if (!G) return;
  const M = G.regionM;
  let near: Array<[number, string, number, number]> | null = null;
  for (const [rx, rz] of G.regions) {
    const dx = Math.max(rx * M - x, 0, x - (rx + 1) * M), dz = Math.max(rz * M - z, 0, z - (rz + 1) * M), d = Math.sqrt(dx * dx + dz * dz), k = `${rx},${rz}`;
    const had = graphs.get(k);
    if (d > CAR_DROP) {
      if (had !== undefined && had !== 'asking') {
        graphs.delete(k);
        if (had) netStale = true;
      }
    } else if (d <= CAR_LOAD && had === undefined && fetching < 2) (near ??= []).push([d, k, rx, rz]);
  }
  if (!near) return;
  near.sort((p, q) => p[0] - q[0]);
  for (const [, k, rx, rz] of near.slice(0, 2 - fetching)) {
    graphs.set(k, 'asking');
    fetching++;
    fetch(G.url.replace('g_RXRZ', `g_${rx}_${rz}`))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b && isGzip(b) ? gunzip(b) : b))
      .then((b) => {
        const g = b ? parseRegionGraph(b, M) : null;
        // (dropped while it was on its way: not kept)
        if (graphs.get(k) !== 'asking') return;
        graphs.set(k, g);
        if (g) netStale = true;
      })
      .catch(() => graphs.get(k) === 'asking' && graphs.set(k, null))
      .finally(() => fetching--);
  }
}

/** The net from the graphs loaded, in the regions' order, so every player's is the same. */
function rebuild(): void {
  const loaded: RegionGraph[] = [];
  for (const g of graphs.values()) if (g && g !== 'asking') loaded.push(g);
  loaded.sort((p, q) => p.rx - q.rx || p.rz - q.rz);
  net = loaded.length ? buildNet(loaded) : null;
  netStale = false;
}

/** The relay's answer as live planes on this map. */
function takeRelay(j: { now?: number; ac?: Array<Record<string, unknown>> }, utcMs: number): void {
  const p = place!, out: LivePlane[] = [], now = typeof j.now === 'number' ? j.now : utcMs;
  for (const a of j.ac ?? []) {
    const lat = Number(a.lat), lon = Number(a.lon), alt = Number(a.alt), gs = Number(a.gs), tr = Number(a.track);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(alt) || a.ground) continue;
    if (alt < NO_GEOID_FLOOR) continue;
    const [x, z] = latLonToLocal(lat, lon, p.origin), th = (Number.isFinite(tr) ? tr : 0) * (Math.PI / 180), v = Number.isFinite(gs) ? gs : 0;
    // (a true bearing, near enough the map's grid in a city: east sin, north cos, and +z is south)
    const vx = Math.sin(th) * v, vz = -Math.cos(th) * v, vy = Number(a.vr) || 0;
    out.push({ hex: String(a.hex), x, y: alt, z, vx, vy, vz, heading: Math.atan2(vz, vx), t: now - (Number(a.age) || 0) * 1000, day: new Date(now).toISOString().slice(0, 10).replace(/-/g, ''), small: !!a.small });
  }
  live = out;
  liveAt = utcMs;
}

function ask(utcMs: number, lat: number, lon: number): void {
  if (!place?.relay || asking || utcMs - askedAt < RELAY_MS) return;
  asking = true;
  askedAt = utcMs;
  fetch(`${place.relay}?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&r=60`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j && Array.isArray(j.ac)) takeRelay(j, utcMs);
    })
    .catch(() => undefined)
    .finally(() => (asking = false));
}

function tick(t: LifeTick): void {
  const v = view(t.buf);
  let n = 0;
  if (place) {
    ask(t.utcMs, t.lat, t.lon);
    const fresh = live.length > 0 && t.utcMs - liveAt < RELAY_MS * 3 + LIVE_HOLD;
    let keyAt = 0;
    const keys = (h: number, k: string) => {
      if (sent.has(h) || keyAt < 0) return;
      const next = writeKey(v, keyAt, h, k);
      if (next < 0) return;
      keyAt = next;
      sent.add(h);
    };
    n = fresh ? livePlanes(live, t.utcMs, t.x, t.z, t.reach, v.rows, 0, MAX_ROWS, keys) : scriptedPlanes(place.slug, t.utcMs, t.x, t.z, t.reach, v.rows, 0, MAX_ROWS, keys, weather);
    // (people on the ground round the bus, low enough to see them: by the day, UTC)
    if (t.y < 1500) {
      const day = Math.floor(t.utcMs / 86400000);
      for (const w of walkTiles.values()) n = peopleOn(w, day, t.utcMs, t.x, t.z, PEOPLE_REACH, v.rows, n, MAX_ROWS, keys);
    }
    // (cars on the roads round the bus, fewer as it climbs away from them, by the place's hour)
    if (t.y < CAR_ALT) {
      roads(t.x, t.z);
      if (netStale) rebuild();
      if (net) n = carsOn(net, t.utcMs, zoneOffset(t.utcMs), t.x, t.z, CAR_FULL, CAR_REACH, Math.min(1, (CAR_ALT - t.y) / (CAR_ALT - CAR_THIN)), v.rows, n, MAX_ROWS, keys);
    }
    v.u32[3] = Math.max(0, keyAt);
  } else v.u32[3] = 0;
  v.f64[0] = t.utcMs;
  v.u32[2] = n;
  (self as unknown as Worker).postMessage({ type: 'snap', buf: t.buf }, [t.buf]);
}

self.onmessage = (e: MessageEvent<LifeInit | LifeTick | LifeWalk>) => {
  const m = e.data;
  if (m.type === 'init') {
    place = m;
    weather = m.weather ?? CLEAR;
    live = [];
    sent.clear();
    walkTiles.clear();
    graphs.clear();
    net = null;
    netStale = false;
    tzAt = -1;
    tzFmt = null;
  } else if (m.type === 'tick') tick(m);
  else if (m.type === 'walk') {
    if (m.tile) walkTiles.set(`${m.tx},${m.tz}`, m.tile);
    else walkTiles.delete(`${m.tx},${m.tz}`);
  }
};
