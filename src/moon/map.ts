// The Moon's data and how a flat map lies on it: no three.js, no DOM, so the worker, the main thread and a tool under Node all read the same thing.
//
// A map is the sphere unrolled around one place: azimuthal equidistant, so metres and bearings from the map's centre are true, and 128 km out the scale is off by under 0.1 %. +X east, +Z south, as a
// city's frame. Y is height over the 1737.4 km sphere, less a datum (gen.ts). The curve comes back at the lens: moonMaterial.ts rolls the ground away from the camera, and nothing in flight knows.
// Moon fixed is IAU's: x at latitude 0, longitude 0, z north, as src/sky/SkyModel.ts has it.

export const R_M = 1737400;
const DEG = Math.PI / 180;

export type V3 = Float64Array | number[];

export interface MapFrame {
  lat0: number;
  lon0: number;
  /** up, east and north at the centre, Moon fixed */
  u: number[];
  e: number[];
  n: number[];
}

export function makeFrame(lat0: number, lon0: number): MapFrame {
  const sp = Math.sin(lat0 * DEG), cp = Math.cos(lat0 * DEG), sl = Math.sin(lon0 * DEG), cl = Math.cos(lon0 * DEG);
  return { lat0, lon0, u: [cp * cl, cp * sl, sp], e: [-sl, cl, 0], n: [-sp * cl, -sp * sl, cp] };
}

/** Map metres to the unit vector at that place, Moon fixed. */
export function dirOf(f: MapFrame, x: number, z: number, o: V3): void {
  const rr = Math.sqrt(x * x + z * z) / R_M;
  const { u, e, n } = f;
  if (rr < 1e-12) {
    o[0] = u[0];
    o[1] = u[1];
    o[2] = u[2];
    return;
  }
  const c = Math.cos(rr), s = Math.sin(rr) / (rr * R_M);
  const a = x * s, b = -z * s;
  o[0] = c * u[0] + a * e[0] + b * n[0];
  o[1] = c * u[1] + a * e[1] + b * n[1];
  o[2] = c * u[2] + a * e[2] + b * n[2];
}

/** A unit vector, Moon fixed, to map metres: out[0] x, out[1] z. */
export function mapOf(f: MapFrame, dx: number, dy: number, dz: number, out: V3): void {
  const { u, e, n } = f;
  const cu = dx * u[0] + dy * u[1] + dz * u[2], ce = dx * e[0] + dy * e[1] + dz * e[2], cn = dx * n[0] + dy * n[1] + dz * n[2];
  const s = Math.sqrt(ce * ce + cn * cn);
  const k = s > 1e-12 ? (Math.atan2(s, cu) * R_M) / s : R_M;
  out[0] = ce * k;
  out[1] = -cn * k;
}

export const latOf = (d: V3) => Math.asin(Math.min(1, Math.max(-1, d[2]))) / DEG;
export const lonOf = (d: V3) => Math.atan2(d[1], d[0]) / DEG;

/** A place to map metres. */
export function latLonToMap(f: MapFrame, lat: number, lon: number, out: V3): void {
  const c = Math.cos(lat * DEG);
  mapOf(f, c * Math.cos(lon * DEG), c * Math.sin(lon * DEG), Math.sin(lat * DEG), out);
}

export const catmull = (a: number, b: number, c: number, d: number, t: number) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

/** A whole-Moon map: longitude -180 at the left, row 0 at the north pole, texel centres. */
export interface WholeMap {
  w: number;
  h: number;
  data: Float32Array;
}

/** A window of real heights, in degrees from its first texel's centre. */
export interface WindowMap {
  w: number;
  h: number;
  lat0: number;
  lon0: number;
  dlat: number;
  dlon: number;
  data: Float32Array;
}

function unpack(dv: DataView, o: number, w: number, h: number, q: number): Float32Array {
  const out = new Float32Array(w * h);
  let prev = 0;
  for (let j = 0; j < h; j++) {
    prev = j ? out[(j - 1) * w] / q + dv.getInt16(o + j * w * 2, true) : dv.getInt16(o, true);
    out[j * w] = prev * q;
    for (let i = 1; i < w; i++) {
      prev += dv.getInt16(o + (j * w + i) * 2, true);
      out[j * w + i] = prev * q;
    }
  }
  return out;
}

/** relief.bin (tools/moon/bake-moon.py), inflated. */
export function readRelief(buf: ArrayBuffer): WholeMap {
  const dv = new DataView(buf);
  const w = dv.getUint16(4, true), h = dv.getUint16(6, true), q = dv.getFloat32(8, true);
  return { w, h, data: unpack(dv, 12, w, h, q) };
}

/** theophilus.bin, inflated. */
export function readWindow(buf: ArrayBuffer): WindowMap {
  const dv = new DataView(buf);
  const w = dv.getUint16(4, true), h = dv.getUint16(6, true), q = dv.getFloat32(8, true);
  const f = (k: number) => dv.getFloat32(12 + k * 4, true);
  return { w, h, lat0: f(0), lon0: f(1), dlat: f(2), dlon: f(3), data: unpack(dv, 28, w, h, q) };
}

/** public/sky/moon.bin: the albedo, 0..1. */
export function readAlbedo(buf: ArrayBuffer): WholeMap {
  const dv = new DataView(buf);
  const w = dv.getUint16(0, true), h = dv.getUint16(2, true);
  const b = new Uint8Array(buf, 4, w * h), data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = b[i] / 7;
  return { w, h, data };
}

/** Bicubic, longitude wrapping, the poles clamped. */
export function cubicAt(m: WholeMap, lat: number, lon: number): number {
  const { w, h, data: d } = m;
  const fx = ((lon + 180) / 360) * w - 0.5, fy = ((90 - lat) / 180) * h - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  let r0 = 0, r1 = 0, r2 = 0, r3 = 0;
  const x0 = (ix - 1 + w) % w, x1 = (ix + w) % w, x2 = (ix + 1) % w, x3 = (ix + 2) % w;
  for (let k = 0; k < 4; k++) {
    const y = Math.min(h - 1, Math.max(0, iy - 1 + k)) * w;
    const v = catmull(d[y + x0], d[y + x1], d[y + x2], d[y + x3], tx);
    if (k === 0) r0 = v;
    else if (k === 1) r1 = v;
    else if (k === 2) r2 = v;
    else r3 = v;
  }
  return catmull(r0, r1, r2, r3, ty);
}

export function linearAt(m: WholeMap, lat: number, lon: number): number {
  const { w, h, data: d } = m;
  const fx = ((lon + 180) / 360) * w - 0.5, fy = ((90 - lat) / 180) * h - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const x0 = ((ix % w) + w) % w, x1 = (x0 + 1) % w, y0 = Math.max(0, iy) * w, y1 = Math.min(h - 1, iy + 1) * w;
  return (d[y0 + x0] * (1 - tx) + d[y0 + x1] * tx) * (1 - ty) + (d[y1 + x0] * (1 - tx) + d[y1 + x1] * tx) * ty;
}

/** The window's height at a place and how much of it stands there (0 at its edges, in a band `band` km wide). */
export function windowAt(m: WindowMap, lat: number, lon: number, band: number, o: { h: number; w: number }): void {
  const fx = (lon - m.lon0) / m.dlon, fy = (lat - m.lat0) / m.dlat;
  if (fx < 0 || fy < 0 || fx >= m.w - 1 || fy >= m.h - 1) {
    o.w = 0;
    return;
  }
  const km = (Math.abs(m.dlat) * Math.PI * R_M) / 180 / 1000;
  const edge = Math.min(fx, fy, m.w - 1 - fx, m.h - 1 - fy) * km;
  const k = Math.min(1, edge / band);
  o.w = k * k * (3 - 2 * k);
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, { w, h, data: d } = m;
  const col = (j: number) => {
    const y = Math.min(h - 1, Math.max(0, j)) * w;
    return catmull(d[y + Math.max(0, ix - 1)], d[y + ix], d[y + Math.min(w - 1, ix + 1)], d[y + Math.min(w - 1, ix + 2)], tx);
  };
  o.h = catmull(col(iy - 1), col(iy), col(iy + 1), col(iy + 2), ty);
}

export type PlaceType = 'mare' | 'crater' | 'basin' | 'mountains' | 'valley' | 'site';

/** A row of places.json. */
export type PlaceRow = [name: string, type: PlaceType, lat: number, lon: number, km: number, az?: number];

export interface Place {
  id: number;
  name: string;
  type: PlaceType;
  lat: number;
  lon: number;
  km: number;
  az: number | null;
  /** where it is: the unit vector, and east and north there */
  d: number[];
  e: number[];
  n: number[];
  /** radius (m) */
  R: number;
}

export function readPlaces(rows: PlaceRow[]): Place[] {
  return rows.map(([name, type, lat, lon, km, az], id) => {
    const f = makeFrame(lat, lon);
    return { id, name, type, lat, lon, km, az: az ?? null, d: f.u, e: f.e, n: f.n, R: (km * 500) };
  });
}

/** Tolerant lookup: ?site=THEOPHILUS, ?site=theophilus, ?site=Apollo%2011. */
export function findPlace(places: Place[], name: string): Place | null {
  const want = name.trim().toUpperCase();
  return places.find((p) => p.name === want) ?? places.find((p) => p.name.includes(want)) ?? null;
}

/** The same over the gazetteer's other craters (names.json: name, latitude, longitude, km): ?site=PTOLEMAEUS is on the Moon too, and a crater is all it can be. */
export function findNamed(rows: Array<[string, number, number, number]>, name: string): Place | null {
  const want = name.trim().toUpperCase();
  const row = rows.find((r) => r[0] === want) ?? rows.find((r) => r[0].startsWith(want)) ?? rows.find((r) => r[0].includes(want));
  return row ? readPlaces([[row[0], 'crater', row[1], row[2], row[3]]])[0] : null;
}
