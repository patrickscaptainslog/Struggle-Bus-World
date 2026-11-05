// The planes' relay's reading of adsb.lol (LIFE.md, "Planes"; LIVING.md, "No server becomes one small relay"): what it passes on of each aircraft, in metres and
// seconds. Pure, so Node checks it (tools/life/relay-check.mjs). ADS-B's own units: feet, knots, feet a minute, degrees true.

const FT = 0.3048, KN = 0.514444, FPM = 0.00508;

/** One aircraft as the relay sends it. */
export interface RelayPlane {
  hex: string;
  /** the call sign only for an airline's flight, three letters and a number (LIVING.md rule 7: private aircraft stay anonymous) */
  flight?: string;
  lat: number;
  lon: number;
  /** m over the ellipsoid where ADS-B has it (alt_geom), else the pressure altitude, taken as over sea level */
  alt: number;
  /** ground speed m/s, track degrees true, climb m/s */
  gs: number;
  track: number;
  vr: number;
  /** a light aircraft (ADS-B category A1 or A2, or a helicopter A7) */
  small: boolean;
  ground: boolean;
  /** s since its position was heard */
  age: number;
}

const AIRLINE = /^[A-Z]{3}\d{1,4}[A-Z]?$/;

/** An aircraft from adsb.lol's v2 answer, or null when it has no position. */
export function slim(a: Record<string, unknown>): RelayPlane | null {
  const lat = Number(a.lat), lon = Number(a.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof a.hex !== 'string') return null;
  const ground = a.alt_baro === 'ground';
  const geom = Number(a.alt_geom), baro = Number(a.alt_baro);
  const alt = Number.isFinite(geom) ? geom * FT : Number.isFinite(baro) ? baro * FT : ground ? 0 : NaN;
  if (!Number.isFinite(alt)) return null;
  const flight = typeof a.flight === 'string' ? a.flight.trim() : '';
  const cat = typeof a.category === 'string' ? a.category : '';
  const rate = Number.isFinite(Number(a.geom_rate)) ? Number(a.geom_rate) : Number(a.baro_rate);
  return {
    hex: a.hex,
    ...(AIRLINE.test(flight) ? { flight } : {}),
    lat,
    lon,
    alt,
    gs: (Number(a.gs) || 0) * KN,
    track: Number(a.track) || 0,
    vr: Number.isFinite(rate) ? rate * FPM : 0,
    small: cat === 'A1' || cat === 'A2' || cat === 'A7',
    ground,
    age: Number(a.seen_pos) || 0,
  };
}

/** The box asked for, snapped to a quarter degree and 10 nm, so players near each other share one cached answer upstream. Null: a bad request. */
export function box(lat: number, lon: number, r: number): { lat: number; lon: number; r: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 4) / 4, lon: Math.round(lon * 4) / 4, r: Math.min(100, Math.max(10, Math.round((Number.isFinite(r) ? r : 40) / 10) * 10)) };
}
