import { latLonToLocal } from '../game/geo';
import { gunzip, isGzip } from '../world/gunzip';
import { parseCityRoutes, parseRegionGraph, type CityRoutes, type RegionGraph } from '../world/lifeData';
import { ferriesOn, ferryLines, harbourOf, sailsOn, WATER_R, type FerryLine, type Harbour } from './sim/boats';
import { buildNet, carsOn, type CarNet } from './sim/cars';
import { type CurbEnd, curbLand, curbPath, curbTune } from './sim/curb';
import { sunsetSec } from './sim/sun';
import { parkBlocks, picnicsOn, type LawnTile } from './sim/parks';
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
  /** the world's graphs (CONTRACT.md section 1.2, city.json's life.regions): a region's URL with g_RXRZ for its name, the regions there are, a region's side (m), and
   *  routes.bin's URL; none: no cars, boats or ferries */
  graphs?: { url: string; regions: Array<[number, number]>; regionM: number; routes?: string };
}
/** A tile's grass for people, sampled by the host (Life.ts, sampleGround): its arrays transferred. `tile` null: the tile is far, and dropped. */
export interface LifeLawn {
  type: 'lawn';
  tile: LawnTile | null;
  tx: number;
  tz: number;
}
/** Curb (sim/curb.ts): the lane near (x, z) driven along (fx, fz) within `reach` m, and `length` m of it ahead, at a junction the way nearest `look` if it turns. */
export interface LifeCurb {
  type: 'curb';
  id: number;
  x: number;
  z: number;
  fx: number;
  fz: number;
  reach: number;
  length: number;
  look: [number, number] | null;
}
/**
 * Its answer: the lane's points (x, y, z, the road's speed), none when there's no street there; where each junction with a choice is (the index of its first point
 * past it), and whether the lane ends at a dead end. `wait`: the roads round there aren't in yet, and the real answer comes when they are.
 */
export interface LifeCurbAnswer {
  type: 'curb';
  id: number;
  n: number;
  pts: Float32Array;
  js: Int32Array;
  nj: number;
  dead: boolean;
  wait?: boolean;
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
/** People are filled this far round the bus (m): a picnic is 2 px at about 1.2 km on the portrait lens. At most PICNICS_MOST of them, the nearest tiles' first (the
 *  host samples the nearest first): Golden Gate Park's meadows would be thousands, and 276 triangles each (800, the first account's life review M5) */
const PEOPLE_REACH = 800, PICNICS_MOST = 800;
/** O9: with no geoid for the place, no live plane is drawn under this (m) */
const NO_GEOID_FLOOR = 1000;
/** Cars round the bus (m): every one in CAR_FULL, fewer on out to none at CAR_REACH (3.5 px on the portrait lens), all of them while the bus is under CAR_THIN and fewer
 *  as it climbs, none over CAR_ALT */
const CAR_FULL = 700, CAR_REACH = 1200, CAR_THIN = 1500, CAR_ALT = 2500;
/** The road graphs are loaded for regions within CAR_LOAD of the bus, two at a time, and dropped past CAR_DROP (m): far enough out that a car driving into the
 *  reach was born in them */
const CAR_LOAD = 2100, CAR_DROP = 3500;
/** Sailboats: a marina's are sailed while the bus is within BOAT_NEAR of it and under BOAT_ALT (m), filled to BOAT_REACH round the bus (a boat is 2 px at about 5 km);
 *  its regions' graphs, within WATER_R of it, are loaded for its water */
const BOAT_NEAR = 6000, BOAT_ALT = 6000, BOAT_REACH = 5000;

let place: LifeInit | null = null;
let weather: Weather = CLEAR;
let live: LivePlane[] = [];
let liveAt = -Infinity;
let asking = false;
let askedAt = -Infinity;
/** keys the host has been sent */
const sent = new Set<number>();
/** the grass round the bus, by tile, and its park grass in blocks once its region's graph is in (null till then) */
const lawns = new Map<string, { tile: LawnTile; blocks: Uint32Array | null }>();
/** the lawns this tick, nearest first (reused) */
const byNear: Array<{ tile: LawnTile; blocks: Uint32Array | null }> = [];
/** the road graphs by region ("rx,rz"): loaded, being fetched, or failed (null: not asked again); the net cars drive, built from those loaded when they change */
const graphs = new Map<string, RegionGraph | 'asking' | null>();
let fetching = 0;
/** routes.bin, once: the ferry lines, and the marinas, each's water once its regions are in (by its key) */
let routes: CityRoutes | 'asking' | null = null;
let lines: FerryLine[] = [];
const harbours = new Map<string, Harbour>();
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

/** How far (m) the square of region (rx, rz), side M, is from (x, z). */
const regionFrom = (rx: number, rz: number, M: number, x: number, z: number) => Math.hypot(Math.max(rx * M - x, 0, x - (rx + 1) * M), Math.max(rz * M - z, 0, z - (rz + 1) * M));

/** routes.bin, fetched once: the ferry lines and the marinas. */
function askRoutes(): void {
  const url = place?.graphs?.routes;
  if (!url || routes !== null) return;
  routes = 'asking';
  fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((b) => (b && isGzip(b) ? gunzip(b) : b))
    .then((b) => {
      const r = b ? parseCityRoutes(b, place!.origin) : null;
      if (routes !== 'asking') return;
      routes = r ?? null;
      lines = r ? ferryLines(r) : [];
      // (a failed file isn't asked for again)
      if (!r) routes = { version: 0, minor: 0, ferries: [], terminals: [], marinas: [], airports: [] };
    })
    .catch(() => (routes = { version: 0, minor: 0, ferries: [], terminals: [], marinas: [], airports: [] }));
}

/** The marinas being sailed now: within BOAT_NEAR of the bus while it's under BOAT_ALT. */
function activeMarinas(x: number, y: number, z: number): CityRoutes['marinas'] {
  if (!routes || routes === 'asking' || y >= BOAT_ALT) return [];
  return routes.marinas.filter((m) => (m.x - x) ** 2 + (m.z - z) ** 2 < BOAT_NEAR * BOAT_NEAR);
}

/**
 * The graphs round the bus: the nearest regions not asked for yet that cars want (in CAR_LOAD, the bus under CAR_ALT) or a marina being sailed wants (in WATER_R of
 * it) fetched, two at a time, and those past CAR_DROP that no marina wants dropped.
 */
function roads(x: number, y: number, z: number, marinas: CityRoutes['marinas']): void {
  const G = place?.graphs;
  if (!G) return;
  const M = G.regionM;
  let near: Array<[number, string, number, number]> | null = null;
  for (const [rx, rz] of G.regions) {
    const d = regionFrom(rx, rz, M, x, z), k = `${rx},${rz}`, had = graphs.get(k);
    const boats = marinas.some((m) => regionFrom(rx, rz, M, m.x, m.z) <= WATER_R);
    if (d > CAR_DROP && !boats) {
      if (had !== undefined && had !== 'asking') {
        graphs.delete(k);
        if (had) netStale = true;
      }
    } else if (((y < CAR_ALT && d <= CAR_LOAD) || boats) && had === undefined && fetching < 2) (near ??= []).push([d, k, rx, rz]);
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

/** A marina's water, once every region in WATER_R of it is in (or failed): built from those alone, so every player's is the same. */
function harbourFor(m: CityRoutes['marinas'][number]): Harbour | null {
  const had = harbours.get(m.key);
  if (had) return had;
  const G = place!.graphs!, M = G.regionM, mine: RegionGraph[] = [];
  for (const [rx, rz] of G.regions) {
    if (regionFrom(rx, rz, M, m.x, m.z) > WATER_R) continue;
    const g = graphs.get(`${rx},${rz}`);
    if (g === undefined || g === 'asking') return null;
    if (g) mine.push(g);
  }
  mine.sort((p, q) => p.rx - q.rx || p.rz - q.rz);
  const h = harbourOf(m, mine);
  harbours.set(m.key, h);
  return h;
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
    // (people picnicking in the parks round the bus, low enough to see them, by the place's day and hour; a tile's park grass once its region's graph is in)
    if (t.y < 1500 && place.graphs) {
      const tz = zoneOffset(t.utcMs), M = place.graphs.regionM, n0 = n, dusk = sunsetSec(place.origin[0], place.origin[1], Math.floor((t.utcMs / 1000 + tz * 60) / 86400), tz);
      // (the lawns nearest the bus first, so the cap leaves the far ones bare, not the grass under the bus: the first account's life review, M4)
      byNear.length = 0;
      for (const l of lawns.values()) byNear.push(l);
      const dist = (l: { tile: LawnTile }) => {
        const side = l.tile.n * l.tile.cell, cx = l.tile.x0 + side / 2 - t.x, cz = l.tile.z0 + side / 2 - t.z;
        return cx * cx + cz * cz;
      };
      byNear.sort((p, q) => dist(p) - dist(q));
      for (const l of byNear) {
        if (!l.blocks) {
          const side = l.tile.n * l.tile.cell, g = graphs.get(`${Math.floor((l.tile.tx * side) / M)},${Math.floor((l.tile.tz * side) / M)}`);
          if (g === undefined || g === 'asking') continue;
          l.blocks = g ? parkBlocks(l.tile, [g]) : new Uint32Array(0);
        }
        n = picnicsOn(l.tile, l.blocks, t.utcMs, tz, t.x, t.z, PEOPLE_REACH, v.rows, n, Math.min(MAX_ROWS, n0 + PICNICS_MOST), keys, dusk);
      }
    }
    // (ferries on their routes, whatever the height: a ferry is 2 px at about 19 km; sailboats off the marinas near the bus)
    askRoutes();
    const tz = zoneOffset(t.utcMs), marinas = activeMarinas(t.x, t.y, t.z);
    if (lines.length) n = ferriesOn(lines, t.utcMs, tz, t.x, t.z, t.reach, v.rows, n, MAX_ROWS, keys);
    for (const m of marinas) {
      const h = harbourFor(m);
      if (h) n = sailsOn(h, t.utcMs, tz, t.x, t.z, BOAT_REACH, v.rows, n, MAX_ROWS, keys, sunsetSec(place.origin[0], place.origin[1], Math.floor((t.utcMs / 1000 + tz * 60) / 86400), tz));
    }
    roads(t.x, t.y, t.z, marinas);
    if (curbWaiting && roadsIn(curbWaiting.x, curbWaiting.z, curbWaiting.reach)) curb(curbWaiting);
    // (cars on the roads round the bus, fewer as it climbs away from them, by the place's hour)
    if (t.y < CAR_ALT) {
      if (netStale) rebuild();
      if (net) n = carsOn(net, t.utcMs, tz, t.x, t.z, CAR_FULL, CAR_REACH, Math.min(1, (CAR_ALT - t.y) / (CAR_ALT - CAR_THIN)), v.rows, n, MAX_ROWS, keys);
    }
    v.u32[3] = Math.max(0, keyAt);
  } else v.u32[3] = 0;
  v.f64[0] = t.utcMs;
  v.u32[2] = n;
  (self as unknown as Worker).postMessage({ type: 'snap', buf: t.buf }, [t.buf]);
}

/** A Curb ask waiting for the roads round it (the day review's m21: an empty answer was both "no street" and "not yet"). */
let curbWaiting: LifeCurb | null = null;
const curbEnd: CurbEnd = { w: 0, s: 0, dead: false, nj: 0 };

/** Every region within `reach` m of (x, z) has its roads in, or has none: false while one is still on its way. */
function roadsIn(x: number, z: number, reach: number): boolean {
  const G = place?.graphs;
  if (!G) return true;
  for (const [rx, rz] of G.regions) {
    if (regionFrom(rx, rz, G.regionM, x, z) > reach) continue;
    const g = graphs.get(`${rx},${rz}`);
    if (g === undefined || g === 'asking') return false;
  }
  return true;
}

/** Curb's lane: landed again on every ask, by place, since the net's ways are renumbered whenever a region comes or goes. Held while the roads there aren't in. */
function curb(m: LifeCurb): void {
  const post = (a: LifeCurbAnswer) => (self as unknown as Worker).postMessage(a, [a.pts.buffer, a.js.buffer]);
  if (!roadsIn(m.x, m.z, m.reach)) {
    if (curbWaiting?.id !== m.id) post({ type: 'curb', id: m.id, n: 0, pts: new Float32Array(0), js: new Int32Array(0), nj: 0, dead: false, wait: true });
    curbWaiting = m;
    return;
  }
  if (curbWaiting?.id === m.id) curbWaiting = null;
  if (netStale) rebuild();
  const spot = net ? curbLand(net, m.x, m.z, m.fx, m.fz, m.reach) : null, pts = new Float32Array(Math.ceil(m.length / curbTune.step + 2) * 4), js = new Int32Array(64);
  const n = spot && net ? curbPath(net, spot.w, spot.s, m.length, m.look, pts, curbEnd, js) : 0;
  post({ type: 'curb', id: m.id, n, pts, js, nj: n ? curbEnd.nj : 0, dead: n > 0 && curbEnd.dead });
}

self.onmessage = (e: MessageEvent<LifeInit | LifeTick | LifeLawn | LifeCurb>) => {
  const m = e.data;
  if (m.type === 'init') {
    place = m;
    weather = m.weather ?? CLEAR;
    live = [];
    sent.clear();
    lawns.clear();
    graphs.clear();
    harbours.clear();
    routes = null;
    lines = [];
    net = null;
    netStale = false;
    curbWaiting = null;
    tzAt = -1;
    tzFmt = null;
  } else if (m.type === 'tick') tick(m);
  else if (m.type === 'curb') curb(m);
  else if (m.type === 'lawn') {
    if (m.tile) lawns.set(`${m.tx},${m.tz}`, { tile: m.tile, blocks: null });
    else lawns.delete(`${m.tx},${m.tz}`);
  }
};
