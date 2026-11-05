import { latLonToLocal } from '../game/geo';
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
/** O9: with no geoid for the place, no live plane is drawn under this (m) */
const NO_GEOID_FLOOR = 1000;

let place: LifeInit | null = null;
let weather: Weather = CLEAR;
let live: LivePlane[] = [];
let liveAt = -Infinity;
let asking = false;
let askedAt = -Infinity;
/** keys the host has been sent */
const sent = new Set<number>();

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
    v.u32[3] = Math.max(0, keyAt);
  } else v.u32[3] = 0;
  v.f64[0] = t.utcMs;
  v.u32[2] = n;
  (self as unknown as Worker).postMessage({ type: 'snap', buf: t.buf }, [t.buf]);
}

self.onmessage = (e: MessageEvent<LifeInit | LifeTick>) => {
  const m = e.data;
  if (m.type === 'init') {
    place = m;
    weather = m.weather ?? CLEAR;
    live = [];
    sent.clear();
  } else if (m.type === 'tick') tick(m);
};
