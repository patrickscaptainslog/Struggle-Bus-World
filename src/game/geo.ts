// Geographic -> city-local meters, exactly as the bake projects the data
// (tools/bake/bake.py: +proj=tmerc +lat_0 +lon_0 +k=1 +datum=WGS84, x east,
// z = -northing). Snyder's transverse Mercator series (sub-millimeter at city
// scale). Every lat/lon in the game (?lat=&lon= start, QA hooks) goes through here.

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const E4 = E2 * E2, E6 = E4 * E2;

/** Meridian arc length from the equator to latitude phi (rad), m. */
function meridian(phi: number): number {
  return A * ((1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256) * phi - ((3 * E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024) * Math.sin(2 * phi) + ((15 * E4) / 256 + (45 * E6) / 1024) * Math.sin(4 * phi) - ((35 * E6) / 3072) * Math.sin(6 * phi));
}

/** (lat, lon) in degrees -> [x, z] city-local meters about origin [lat0, lon0], into `o` if it's given (a loop that mustn't allocate). */
export function latLonToLocal(lat: number, lon: number, origin: readonly [number, number] | readonly number[], o: [number, number] = [0, 0]): [number, number] {
  const r = Math.PI / 180;
  const phi = lat * r, phi0 = origin[0] * r;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t;
  const C = EP2 * c * c;
  const a = (lon - origin[1]) * r * c;
  const a2 = a * a;
  const x = N * (a + ((1 - T + C) * a2 * a) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a2 * a2 * a) / 120);
  const y = meridian(phi) - meridian(phi0) + N * t * (a2 / 2 + ((5 - T + 9 * C + 4 * C * C) * a2 * a2) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a2 * a2 * a2) / 720);
  o[0] = x;
  o[1] = -y;
  return o;
}

/**
 * City-local metres about origin [lat0, lon0] -> [lat, lon] in degrees: the inverse of latLonToLocal, Snyder's series again (eqs. 8-18 to 8-25), sub-millimetre at city scale and a few
 * centimetres 100 km out. The street's join with the flight goes through here (docs/specs/earth/EARTHFLIGHT.md, E2). Into `o` if it's given.
 */
export function localToLatLon(x: number, z: number, origin: readonly [number, number] | readonly number[], o: [number, number] = [0, 0]): [number, number] {
  const r = Math.PI / 180;
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const mu = (meridian(origin[0] * r) - z) / (A * (1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256));
  const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const C1 = EP2 * c * c, T1 = t * t, N1 = A / Math.sqrt(1 - E2 * s * s), R1 = (A * (1 - E2)) / Math.pow(1 - E2 * s * s, 1.5), D = x / N1;
  const D2 = D * D;
  const lat = p1 - ((N1 * t) / R1) * (D2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D2 * D2) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D2 * D2 * D2) / 720);
  const lon = origin[1] * r + (D - ((1 + 2 * T1 + C1) * D2 * D) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D2 * D2 * D) / 120) / c;
  o[0] = lat / r;
  o[1] = lon / r;
  return o;
}
