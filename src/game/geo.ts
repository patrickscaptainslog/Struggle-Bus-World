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

/** (lat, lon) in degrees -> [x, z] city-local meters about origin [lat0, lon0]. */
export function latLonToLocal(lat: number, lon: number, origin: readonly [number, number] | readonly number[]): [number, number] {
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
  return [x, -y];
}
