// What hands the sky model its Observer in the city and from any place on a body: true position in the body's fixed frame and render axes as a mat3 (SKY.md section 2). The model
// never sees a latitude. Grid convergence (a city's tmerc frame against true north) and the inverse of geo.ts are stop 2's: nothing here has a city yet.

const DEG = Math.PI / 180;
const WGS_A = 6378.137;
const WGS_F = 1 / 298.257223563;
const WGS_E2 = WGS_F * (2 - WGS_F);

/** WGS84 geodetic to Earth fixed, km. */
export function geodeticToFix(latDeg: number, lonDeg: number, hKm: number, o: Float64Array): Float64Array {
  const s = Math.sin(latDeg * DEG), c = Math.cos(latDeg * DEG), N = WGS_A / Math.sqrt(1 - WGS_E2 * s * s);
  o[0] = (N + hKm) * c * Math.cos(lonDeg * DEG);
  o[1] = (N + hKm) * c * Math.sin(lonDeg * DEG);
  o[2] = (N * (1 - WGS_E2) + hKm) * s;
  return o;
}

/** A place on a sphere of radius R to that body's fixed frame, km. */
export function sphereToFix(R: number, latDeg: number, lonDeg: number, hKm: number, o: Float64Array): Float64Array {
  const r = R + hKm, c = Math.cos(latDeg * DEG);
  o[0] = r * c * Math.cos(lonDeg * DEG);
  o[1] = r * c * Math.sin(lonDeg * DEG);
  o[2] = r * Math.sin(latDeg * DEG);
  return o;
}

/** Render axes by rows at a place: +X east, +Y up, +Z south, in the body's fixed frame, grid convergence `gamma` (rad) already in them. */
export function axesAt(latDeg: number, lonDeg: number, gamma: number, o: Float64Array): Float64Array {
  const sp = Math.sin(latDeg * DEG), cp = Math.cos(latDeg * DEG), sl = Math.sin(lonDeg * DEG), cl = Math.cos(lonDeg * DEG);
  const cg = Math.cos(gamma), sg = Math.sin(gamma);
  const ex = -sl, ey = cl, nx = -sp * cl, ny = -sp * sl, nz = cp;
  o[0] = cg * ex - sg * nx;
  o[1] = cg * ey - sg * ny;
  o[2] = -sg * nz;
  o[3] = cp * cl;
  o[4] = cp * sl;
  o[5] = sp;
  o[6] = -sg * ex - cg * nx;
  o[7] = -sg * ey - cg * ny;
  o[8] = -cg * nz;
  return o;
}
