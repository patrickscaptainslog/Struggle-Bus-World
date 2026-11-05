// What the world gives life (docs/specs/earth/CONTRACT.md, the world's file): the graphs' types and their parsers.
// Writer: tools/bake/graphs.py (keep in sync). Worker-safe: no three.js and no DOM, only typed arrays, DataView and
// TextDecoder. A parse takes the inflated file (gunzip.ts inflates it in the worker) and gives null for a magic it
// doesn't know, a major version it can't read or a file that's cut short: never a throw into life.
//
// The byte layout, all little-endian, each section column by column and padded to 4 bytes:
//
// g_<rx>_<rz>.bin (gzip of), one a region of city.json `regions`; places in decimetres from the region's corner
// (rx * 1024, rz * 1024), heights in decimetres over the region's baseY:
//   header  'SBG1', u16 version (major), u16 minor, i32 rx, i32 rz, f32 baseY,
//           u32 counts: nodes, edges, points, areas, area vertices, area triangles, names          (48 bytes)
//   nodes   u32 id[n]; i16 x[n], z[n], y[n]; u8 flags[n]
//   edges   u32 id[e]; a[e], b[e] (indices into this file's nodes: u16, or u32 past 65,535 nodes);
//           u8 kind[e], cls[e], dir[e], lanes[e], speed[e]; i8 level[e]; u16 flags[e]; u32 shape[e + 1] (into points)
//   points  x[p], z[p], y[p]: the edges' inner points, in edge order, each column delta-coded (below)
//   areas   u32 id[a]; u8 kind[a]; u16 name[a] (into names, 0xffff none); u32 tri[a + 1] (into triangles);
//           x[v], z[v], y[v] delta-coded; triangles, 3t vertex indices delta-coded (below), u16 (u32 past 65,535 vertices)
//   names   u8 length, utf-8 (not padded: the end of the file)
// Delta-coded: a column of i16 decimetres is stored as each value less the one before (the first less 0), modulo 2^16,
// so it sums back exactly. A triangle stores its first vertex less the last triangle's first, and its other two less its
// first, modulo the index's width. Small steps, which gzip takes far better than the places themselves.
//
// A minor version adds and never moves (`minor` says which): 1.1 sets EdgeFlag.NO_CARS, which a 1.0 file never had; 1.2
// has the lakes as OPEN_WATER at the grid's height (C8), where a 1.1 file has OPEN_WATER on the sea alone, at WATER_Y.
//
// routes.bin (gzip of), one a city; places i32 at 1e-7 degree, strings a u8 length and utf-8:
//   'SBC1' (C7: 'SBR1' is the region bundles'), u16 version (major), u16 minor
//   u32 ferries,   each u32 id, key, name, u32 from, u32 to (terminal ids), u8 seasonal, f32 lengthM,
//                  u32 n, i32 lat[n], i32 lon[n]
//   u32 terminals, each u32 id, key, u8 kind (0 ferry, 1 cruise), name, i32 lat, i32 lon, f32 berthM
//   u32 marinas,   each u32 id, key, name, i32 lat, i32 lon, u16 berths
//   u32 airports,  each u32 id, icao, iata, i32 lat, i32 lon, f32 elevM, u16 runways,
//                  each runway name, i32 lat0, lat1, lon0, lon1 (its threshold first), f32 widthM

import { latLonToLocal } from '../game/geo';

export const GRAPH_VERSION = 1;
export const ROUTES_VERSION = 1;
export const enum Kind { ROAD = 1, FOOT, RAIL, FERRY, WATER, TAXI, RUNWAY }
export const enum RoadClass { MOTORWAY = 1, TRUNK, PRIMARY, SECONDARY, TERTIARY, RESIDENTIAL, UNCLASSIFIED, LIVING, SERVICE, TRACK, UNKNOWN }
export const enum FootClass { FOOTWAY = 1, SIDEWALK, CROSSING, PATH, STEPS, CYCLEWAY, PEDESTRIAN }
export const enum Dir { BOTH = 0, FORWARD = 1, BACKWARD = 2 } // FORWARD: from a to b only
export const EdgeFlag = { BRIDGE: 1, TUNNEL: 2, UNDRAWN: 4, LINK: 8, ROUNDABOUT: 16, SEASONAL: 32, NO_CARS: 64 } as const; // NO_CARS (C6, minor 1): a whole-edge rule denies motor vehicles and none allows cars, buses and taxis aside
export const NodeFlag = { PORTAL: 1, SIGNAL: 2, STOP: 4 } as const; // PORTAL: the same id is in the next region
export const enum AreaKind { PLAZA = 1, PARK, BEACH, MARINA, FERRY_TERMINAL, CRUISE_TERMINAL, APRON, OPEN_WATER }
export const enum ShipKind { CONTAINER = 0, BULK, TANKER, CAR_CARRIER, CRUISE } // 5 kinds, traffic's and ports' order

export interface RegionGraph {
  version: number; rx: number; rz: number;
  /** the file's minor version (C9, Proposed; read it or not): 1 and up can set NO_CARS, 2 and up have the lakes (C8) */
  minor: number;
  /** map metres; y is what a mover stands on there: the ground, a deck or a quay (never the drawn mesh) */
  nodes: { n: number; id: Uint32Array; xyz: Float32Array; flags: Uint8Array };
  edges: { n: number; id: Uint32Array; a: Uint32Array; b: Uint32Array; kind: Uint8Array; cls: Uint8Array; dir: Uint8Array;
           lanes: Uint8Array /* lanes in each direction it can be driven: on a one-way, all of them; 0 unknown */;
           speed: Uint8Array /* km/h, 0 unknown */; level: Int8Array /* OSM `layer`, else Overture's level_rules, 0 where neither says: it tells the decks apart */;
           flags: Uint16Array; shape: Uint32Array /* starts into pts, in points (3 floats each) */ };
  pts: Float32Array;                  // x, y, z of the edges' inner points
  areas: { n: number; id: Uint32Array; kind: Uint8Array; name: Uint16Array /* into names, 0xffff none */;
           tri: Uint32Array /* starts into xyz, in triangles (9 floats each) */; xyz: Float32Array /* with heights */ };
  names: string[];
}
/** Map metres (C5): x east and z south of the city's origin, as geo.ts latLonToLocal gives them. */
export interface CityRoutes {
  version: number;
  minor: number;
  /** seasonal: OSM's `seasonal=*` on the route (or its `opening_hours`), never from the name. xz: x, z of each point */
  ferries: Array<{ id: number; key: string /* 'w31772645' */; name: string; from: number; to: number /* terminal ids */; seasonal: boolean; lengthM: number; lat: Float64Array; lon: Float64Array; xz: Float32Array }>;
  terminals: Array<{ id: number; key: string; kind: 'ferry' | 'cruise'; name: string; lat: number; lon: number; x: number; z: number; berthM: number }>;
  marinas: Array<{ id: number; key: string; name: string; lat: number; lon: number; x: number; z: number; berths: number /* mapped, else estimated from the area */ }>;
  airports: Array<{ id: number; icao: string; iata: string; lat: number; lon: number; x: number; z: number; elevM: number /* over sea level */;
                    runways: Array<{ name: string /* '28L' */; lat: [number, number]; lon: [number, number]; x: [number, number]; z: [number, number]; widthM: number }> }>;
}
export interface OceanLanes {
  version: number;
  ports: Array<{ id: number; key: string /* UN/LOCODE 'USOAK' */; name: string; lat: number; lon: number; kinds: number /* bits by ShipKind */ }>;
  /** vertices at most 50 km apart, great circles between them; traffic[kind * 2 + d]: ships a day by ShipKind, d 0 from a to b, 1 back, from the raster */
  lanes: Array<{ id: number; key: string; a: number; b: number /* port ids */; lat: Float64Array; lon: Float64Array; traffic: Float32Array /* 10 */ }>;
}

/** A region's side in map metres where city.json says nothing else: 4 tiles of 256 m (regionSize x tileSize). */
export const REGION_M = 1024;
const MAGIC_GRAPH = 0x31474253; // 'SBG1'
const MAGIC_ROUTES = 0x31434253; // 'SBC1'
const HEAD = 48;
const pad4 = (o: number) => o + ((4 - (o & 3)) & 3);

/** One region's graph from its inflated g_<rx>_<rz>.bin, or null. regionM: the city's region side, city.json's
 *  regionSize x tileSize (the file's places are from the region's corner, so a wrong side moves every one). */
export function parseRegionGraph(buf: ArrayBuffer, regionM: number = REGION_M): RegionGraph | null {
  try {
    if (buf.byteLength < HEAD) return null;
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== MAGIC_GRAPH || dv.getUint16(4, true) !== GRAPH_VERSION) return null;
    const minor = dv.getUint16(6, true);
    const rx = dv.getInt32(8, true), rz = dv.getInt32(12, true), baseY = dv.getFloat32(16, true);
    const nn = dv.getUint32(20, true), ne = dv.getUint32(24, true), np = dv.getUint32(28, true);
    const na = dv.getUint32(32, true), nv = dv.getUint32(36, true), nt = dv.getUint32(40, true), nNames = dv.getUint32(44, true);
    const ox = rx * regionM, oz = rz * regionM;
    let o = HEAD;
    // nodes
    const nodeId = new Uint32Array(buf, o, nn).slice();
    o += nn * 4;
    const xyz = places(buf, o, nn, ox, oz, baseY, false);
    o = pad4(o + nn * 6);
    const nodeFlags = new Uint8Array(buf, o, nn).slice();
    o = pad4(o + nn);
    // edges
    const edgeId = new Uint32Array(buf, o, ne).slice();
    o += ne * 4;
    const wide = nn > 65535;
    const a = indices(buf, o, ne, wide);
    o = pad4(o + ne * (wide ? 4 : 2));
    const b = indices(buf, o, ne, wide);
    o = pad4(o + ne * (wide ? 4 : 2));
    const kind = new Uint8Array(buf, o, ne).slice();
    const cls = new Uint8Array(buf, o + ne, ne).slice();
    const dir = new Uint8Array(buf, o + ne * 2, ne).slice();
    const lanes = new Uint8Array(buf, o + ne * 3, ne).slice();
    const speed = new Uint8Array(buf, o + ne * 4, ne).slice();
    const level = new Int8Array(buf, o + ne * 5, ne).slice();
    o = pad4(o + ne * 6);
    const flags = new Uint16Array(buf, o, ne).slice();
    o = pad4(o + ne * 2);
    const shape = new Uint32Array(buf, o, ne + 1).slice();
    o += (ne + 1) * 4;
    if (shape[ne] !== np) return null;
    for (let i = 0; i < ne; i++) if (a[i] >= nn || b[i] >= nn || shape[i] > shape[i + 1]) return null;
    // points
    const pts = places(buf, o, np, ox, oz, baseY, true);
    o = pad4(o + np * 6);
    // areas
    const areaId = new Uint32Array(buf, o, na).slice();
    o += na * 4;
    const areaKind = new Uint8Array(buf, o, na).slice();
    o = pad4(o + na);
    const name = new Uint16Array(buf, o, na).slice();
    o = pad4(o + na * 2);
    const tri = new Uint32Array(buf, o, na + 1).slice();
    o += (na + 1) * 4;
    if (tri[na] !== nt) return null;
    // starts only go up, as shape's do (N2): one stepping down hands life an area whose triangles run off xyz
    for (let i = 0; i < na; i++) if (tri[i] > tri[i + 1] || (name[i] !== 0xffff && name[i] >= nNames)) return null;
    const verts = places(buf, o, nv, ox, oz, baseY, true);
    o = pad4(o + nv * 6);
    const wideT = nv > 65535;
    const t16 = wideT ? null : new Uint16Array(buf, o, nt * 3);
    const t32 = wideT ? new Uint32Array(buf, o, nt * 3) : null;
    o = pad4(o + nt * 3 * (wideT ? 4 : 2));
    const axyz = new Float32Array(nt * 9);
    let first = 0;
    for (let t = 0; t < nt; t++) {
      for (let j = 0; j < 3; j++) {
        // the first vertex from the last triangle's first, the other two from this one's
        const d = t16 ? t16[t * 3 + j] : t32![t * 3 + j];
        const v = wideT ? (first + d) >>> 0 : (first + d) & 0xffff;
        if (j === 0) first = v;
        if (v >= nv) return null;
        const k = t * 3 + j;
        axyz[k * 3] = verts[v * 3];
        axyz[k * 3 + 1] = verts[v * 3 + 1];
        axyz[k * 3 + 2] = verts[v * 3 + 2];
      }
    }
    // names
    const names: string[] = [];
    const dec = new TextDecoder();
    for (let k = 0; k < nNames; k++) {
      const len = dv.getUint8(o);
      names.push(dec.decode(new Uint8Array(buf, o + 1, len)));
      o += 1 + len;
    }
    if (o !== buf.byteLength) return null; // cut short reads past the end and throws; anything left over is damage too
    return {
      version: GRAPH_VERSION, minor, rx, rz,
      nodes: { n: nn, id: nodeId, xyz, flags: nodeFlags },
      edges: { n: ne, id: edgeId, a, b, kind, cls, dir, lanes, speed, level, flags, shape },
      pts,
      areas: { n: na, id: areaId, kind: areaKind, name, tri, xyz: axyz },
      names,
    };
  } catch {
    return null;
  }
}

/** x, y, z in map metres from three i16 columns of decimetres (x, z from the region's corner, y over baseY), each
 *  delta-coded if `delta` (the layout, above). */
function places(buf: ArrayBuffer, o: number, n: number, ox: number, oz: number, baseY: number, delta: boolean): Float32Array {
  const qx = new Int16Array(buf, o, n), qz = new Int16Array(buf, o + n * 2, n), qy = new Int16Array(buf, o + n * 4, n);
  const out = new Float32Array(n * 3);
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < n; i++) {
    if (delta) {
      x = ((x + qx[i]) << 16) >> 16; // the running sum, kept to 16 bits as it was written
      y = ((y + qy[i]) << 16) >> 16;
      z = ((z + qz[i]) << 16) >> 16;
    } else {
      x = qx[i]; y = qy[i]; z = qz[i];
    }
    out[i * 3] = ox + x / 10;
    out[i * 3 + 1] = baseY + y / 10;
    out[i * 3 + 2] = oz + z / 10;
  }
  return out;
}

function indices(buf: ArrayBuffer, o: number, n: number, wide: boolean): Uint32Array {
  if (wide) return new Uint32Array(buf, o, n).slice();
  const q = new Uint16Array(buf, o, n);
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = q[i];
  return out;
}

/** The city's routes from its inflated routes.bin, or null. origin: city.json's [lat, lon], for the map metres (C5). */
export function parseCityRoutes(buf: ArrayBuffer, origin: readonly [number, number] | readonly number[]): CityRoutes | null {
  try {
    const dv = new DataView(buf);
    if (buf.byteLength < 8 || dv.getUint32(0, true) !== MAGIC_ROUTES || dv.getUint16(4, true) !== ROUTES_VERSION) return null;
    const minor = dv.getUint16(6, true);
    const dec = new TextDecoder();
    let o = 8;
    const u8 = () => dv.getUint8(o++);
    const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
    const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
    const f32 = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
    const deg = () => { const v = dv.getInt32(o, true); o += 4; return v / 1e7; };
    const str = () => { const len = u8(); const s = dec.decode(new Uint8Array(buf, o, len)); o += len; return s; };
    // every count against the bytes left before anything is made from it or read for it (N1): a corrupt point count
    // asked for up to 2^32 eight-byte values a column. A row is at least its fixed fields and a length byte a string
    const fits = (n: number, row: number) => n * row <= buf.byteLength - o;
    const ferries: CityRoutes['ferries'] = [];
    const nf = u32();
    if (!fits(nf, 23)) return null;
    for (let i = 0; i < nf; i++) {
      const id = u32(), key = str(), name = str(), from = u32(), to = u32(), seasonal = u8() !== 0, lengthM = f32();
      const m = u32();
      if (!fits(m, 8)) return null;
      const lat = new Float64Array(m), lon = new Float64Array(m), xz = new Float32Array(m * 2);
      for (let k = 0; k < m; k++) lat[k] = deg();
      for (let k = 0; k < m; k++) lon[k] = deg();
      for (let k = 0; k < m; k++) {
        const p = latLonToLocal(lat[k], lon[k], origin);
        xz[k * 2] = p[0]; xz[k * 2 + 1] = p[1];
      }
      ferries.push({ id, key, name, from, to, seasonal, lengthM, lat, lon, xz });
    }
    const terminals: CityRoutes['terminals'] = [];
    const nt = u32();
    if (!fits(nt, 19)) return null;
    for (let i = 0; i < nt; i++) {
      const id = u32(), key = str(), kind = u8() === 1 ? 'cruise' : 'ferry', name = str(), lat = deg(), lon = deg(), berthM = f32();
      const [x, z] = latLonToLocal(lat, lon, origin);
      terminals.push({ id, key, kind, name, lat, lon, x, z, berthM });
    }
    const marinas: CityRoutes['marinas'] = [];
    const nm = u32();
    if (!fits(nm, 16)) return null;
    for (let i = 0; i < nm; i++) {
      const id = u32(), key = str(), name = str(), lat = deg(), lon = deg(), berths = u16();
      const [x, z] = latLonToLocal(lat, lon, origin);
      marinas.push({ id, key, name, lat, lon, x, z, berths });
    }
    const airports: CityRoutes['airports'] = [];
    const na = u32();
    if (!fits(na, 20)) return null;
    for (let i = 0; i < na; i++) {
      const id = u32(), icao = str(), iata = str(), lat = deg(), lon = deg(), elevM = f32();
      const runways: CityRoutes['airports'][number]['runways'] = [];
      const nr = u16();
      if (!fits(nr, 21)) return null;
      for (let k = 0; k < nr; k++) {
        const rname = str(), lat0 = deg(), lat1 = deg(), lon0 = deg(), lon1 = deg(), widthM = f32();
        const p0 = latLonToLocal(lat0, lon0, origin), p1 = latLonToLocal(lat1, lon1, origin);
        runways.push({ name: rname, lat: [lat0, lat1], lon: [lon0, lon1], x: [p0[0], p1[0]], z: [p0[1], p1[1]], widthM });
      }
      const [x, z] = latLonToLocal(lat, lon, origin);
      airports.push({ id, icao, iata, lat, lon, x, z, elevM, runways });
    }
    if (o !== buf.byteLength) return null;
    return { version: ROUTES_VERSION, minor, ferries, terminals, marinas, airports };
  } catch {
    return null;
  }
}
