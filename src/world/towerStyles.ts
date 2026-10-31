// Facade families for towers and big commercial buildings, chosen per building
// in the mesher (no re-bake): by height, footprint, district and a hash of the
// stable id, with a small per-location table for San Francisco's icons. The
// choice travels to the shader in bytes the vertex format already has:
//   aMeta.y (arch byte): low nibble = arch, high nibble = facade family
//   aMeta.w (flags byte): bit0 front-facing, bit1 corner (as before),
//     bit2 penthouse (a mechanical box on the roof: no windows),
//     bit3 crown (this part's top carries the building's crown band),
//     bits4-5 crown type, bits6-7 family variant
//   aBld2.y: for family buildings this part's own top (m) instead of the
//     front width (only houses use that), so every tier knows where its top band is.
// Garden blobs and onion domes for painted towers (Part.GARDEN / Part.DOME)
// reuse the same bytes differently: see BuildingMesher.ts.

import { Arch, type BuildingTile } from './tiles';

/** Facade family (0 = the classic archetype look). */
export const Fam = {
  NONE: 0,
  /** glass curtain wall: mullion grid, sky-reflection bands, a few lit/dark panes */
  GLASS: 1,
  /** pre-war masonry / terracotta: pale stone, punched windows in pairs, rusticated base, cornice */
  MASONRY: 2,
  /** 1960s-70s modernist: strong horizontal spandrel bands and ribbon windows */
  BANDS: 3,
  /** 1960s-70s modernist: vertical fins (Wells Fargo at 44 Montgomery) */
  FINS: 4,
  /** dark polished granite with thin bright window slots (555 California) */
  GRANITE: 5,
  /** white precast concrete with deep vertical slots (Embarcadero Center) */
  PRECAST: 6,
} as const;

/** What tops a tower (bits 4-5 of the flags byte). */
export const Crown = {
  /** mechanical penthouse band: no windows, louvers */
  MECH: 0,
  /** a stone cornice with a dark shadow line under it and an attic above */
  CORNICE: 1,
  /** a softly lit crown band */
  LIT: 2,
  /** Salesforce Tower's open crown: a lattice of fins over a glowing LED screen */
  LATTICE: 3,
} as const;

/** Family variants (bits 6-7 of the flags byte). */
export const Variant = {
  PLAIN: 0,
  /** glass: pale silver with a white sunshade line on every floor (Salesforce Tower) */
  SILVER: 1,
  /** glass: dark, wrapped in diagonal steel bracing (181 Fremont) */
  BRACED: 2,
  /** masonry: no art-deco piers, plain punched windows (classic commercial blocks) */
  PUNCHED: 3,
} as const;

/** Flag bits the mesher sets per part. */
export const FacadeFlag = { PENTHOUSE: 4, CROWN: 8 } as const;

/**
 * Column module per family (m): the mesher stretches every wall to a whole
 * number of modules so corners land on piers and columns line up up the
 * tower (the shader's grids use the same numbers).
 */
export const FAM_MODULE: Record<number, number> = {
  [Fam.GLASS]: 1.5,
  [Fam.MASONRY]: 3.6,
  [Fam.BANDS]: 1.5,
  [Fam.FINS]: 2.4,
  [Fam.GRANITE]: 2.6,
  [Fam.PRECAST]: 3.0,
};

export interface TowerStyle {
  fam: number;
  crown: number;
  variant: number;
  /** family of the podium parts (tiers whose top is under half the building's) */
  podium: number;
}

export interface Icon {
  name: string;
  lat: number;
  lon: number;
  /** sanity check: the building at that point must stand this tall (m above its ground) */
  minTop: number;
  style: TowerStyle;
}

const S = (fam: number, crown: number, variant: number = Variant.PLAIN, podium: number = fam): TowerStyle => ({ fam, crown, variant, podium });

/** San Francisco's icons (WGS84; matched by the footprint that contains the point). */
export const ICONS: Icon[] = [
  { name: 'Salesforce Tower', lat: 37.78977, lon: -122.39676, minTop: 250, style: S(Fam.GLASS, Crown.LATTICE, Variant.SILVER) },
  { name: '181 Fremont', lat: 37.7897, lon: -122.3952, minTop: 180, style: S(Fam.GLASS, Crown.MECH, Variant.BRACED) },
  { name: '555 California', lat: 37.7921, lon: -122.4037, minTop: 190, style: S(Fam.GRANITE, Crown.MECH) },
  { name: 'Millennium Tower', lat: 37.79048, lon: -122.39596, minTop: 150, style: S(Fam.GLASS, Crown.LIT, Variant.PLAIN, Fam.GLASS) },
  { name: 'One Embarcadero Center', lat: 37.79458, lon: -122.3997, minTop: 130, style: S(Fam.PRECAST, Crown.MECH) },
  { name: 'Two Embarcadero Center', lat: 37.79511, lon: -122.39855, minTop: 100, style: S(Fam.PRECAST, Crown.MECH) },
  { name: 'Three Embarcadero Center', lat: 37.79522, lon: -122.39725, minTop: 100, style: S(Fam.PRECAST, Crown.MECH) },
  { name: 'Four Embarcadero Center', lat: 37.79541, lon: -122.39622, minTop: 130, style: S(Fam.PRECAST, Crown.MECH) },
  { name: '345 California', lat: 37.7926, lon: -122.40045, minTop: 150, style: S(Fam.GRANITE, Crown.LIT, Variant.PLAIN, Fam.MASONRY) },
  { name: '101 California', lat: 37.79295, lon: -122.39804, minTop: 150, style: S(Fam.GLASS, Crown.MECH, Variant.PLAIN, Fam.GRANITE) },
  { name: 'One Rincon Hill', lat: 37.78608, lon: -122.39222, minTop: 150, style: S(Fam.GLASS, Crown.LIT) },
  { name: '50 Fremont', lat: 37.79053, lon: -122.3973, minTop: 140, style: S(Fam.BANDS, Crown.MECH) },
  { name: '44 Montgomery', lat: 37.78985, lon: -122.40176, minTop: 140, style: S(Fam.FINS, Crown.MECH) },
  { name: 'One Market', lat: 37.79345, lon: -122.39419, minTop: 140, style: S(Fam.BANDS, Crown.MECH, Variant.PLAIN, Fam.MASONRY) },
  { name: 'Hyatt Regency', lat: 37.7944, lon: -122.3958, minTop: 50, style: S(Fam.BANDS, Crown.MECH) },
];

/**
 * Footprints replaced by a hand-built prop: not meshed, not a building ref (no aim, pick, paint or
 * blast lands on what nobody can see), and their cells of the flight's obstacle grid are the prop's
 * own surface (City.setPropObstacles) instead of the lots'.
 */
export interface Hidden {
  name: string;
  /** center, unit axis along the long side, half length / half width (local m) */
  cx: number;
  cz: number;
  ax: number;
  az: number;
  halfL: number;
  halfW: number;
  /** only footprints lower than this (m above ground) */
  maxTop: number;
  /** no prop's boxes take its cells: City just clears them (a bridge's stand-ins, a bad height) */
  clears?: boolean;
}

/** An oriented box of a prop's collision surface (local m): the cells it covers stand `top` m ASL. */
export interface PropBox {
  cx: number;
  cz: number;
  /** unit axis of the half length (the other half is across it) */
  ax: number;
  az: number;
  halfL: number;
  halfW: number;
  top: number;
  /** grown by this much in the obstacle grid (m): 3, or 6 for a part over 40 m, as the bake's roofs */
  pad: number;
}

/** Hand-built hero props (props/landmarks.ts), placed by lat/lon, with collision posts. */
export interface HeroProp {
  kind: 'coit' | 'ferry' | 'fremont181-spire';
  lat: number;
  lon: number;
  /** ground (or roof, for a spire) height the prop stands on (m ASL, from the bake's DEM / tiles) */
  baseY: number;
  /** heading of the prop's long axis (radians, atan2(ax, az) of the local axis) */
  yaw: number;
  /** a paintable landmark of its own (props/landmarkPaint paintLandmark): its saved-paint key (never rename
   * one: saves are keyed by it) and what the street sign says. None for a prop that belongs to a building
   * (the spire paints and pops with its tower). */
  paint?: { key: string; name: string };
}

export const HERO_PROPS: HeroProp[] = [
  { kind: 'coit', lat: 37.80235, lon: -122.40582, baseY: 91.7, yaw: 0, paint: { key: 'lm:coit', name: 'Coit Tower' } },
  // the Ferry Building's center (the clock tower stands at the middle of its front, facing Market Street)
  { kind: 'ferry', lat: 37.795507, lon: -122.393448, baseY: 3.0, yaw: Math.atan2(0.65444, 0.75611), paint: { key: 'lm:ferry', name: 'Ferry Building' } },
  // the spire stands on the top box of the LiDAR massing (its top at 227.9 + 3.2 m ground)
  { kind: 'fremont181-spire', lat: 37.78977, lon: -122.395412, baseY: 231.1, yaw: 0 },
];

/** City origin the icon table is written for (the SF bake's tmerc origin). */
export const SF_ORIGIN: [number, number] = [37.7749, -122.4194];

/** True if a city's origin is the one the SF tables (icons, HIDDEN, HERO_PROPS) are written for. */
export function isSfOrigin(origin: [number, number]): boolean {
  return Math.abs(origin[0] - SF_ORIGIN[0]) < 1e-6 && Math.abs(origin[1] - SF_ORIGIN[1]) < 1e-6;
}

/**
 * WGS84 lat/lon -> local game meters (+x east, +z south) through the bake's
 * projection (+proj=tmerc at the city origin, k=1): exact to centimeters
 * across the city, unlike a flat-earth scale (10-30 m off at the edges).
 */
export function llToLocal(lat: number, lon: number, origin: [number, number] = SF_ORIGIN): [number, number] {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const M = (phi: number) =>
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi));
  const d2r = Math.PI / 180;
  const phi = lat * d2r;
  const lam = (lon - origin[1]) * d2r;
  const s = Math.sin(phi), c = Math.cos(phi);
  const N = a / Math.sqrt(1 - e2 * s * s);
  const T = (s / c) * (s / c);
  const C = ep2 * c * c;
  const A = lam * c;
  const x = N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const y = M(phi) - M(origin[0] * d2r) + N * (s / c) * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720);
  return [x, -y];
}

const COIT = llToLocal(HERO_PROPS[0].lat, HERO_PROPS[0].lon);
const FERRY = llToLocal(HERO_PROPS[1].lat, HERO_PROPS[1].lon);

/**
 * The Ferry Building: OpenStreetMap maps it as one building of eight parts (the hall, the clock tower's
 * steps and its dome, 70.5 m), and USA Structures' rows still lie beside it. Coit Tower: a low box the
 * bake's keep-out capped (8.4 m) stands at the summit. The props (props/landmarks.ts) draw both.
 */
export const HIDDEN: Hidden[] = [
  { name: 'Ferry Building', cx: FERRY[0], cz: FERRY[1], ax: Math.sin(HERO_PROPS[1].yaw), az: Math.cos(HERO_PROPS[1].yaw), halfL: 106, halfW: 39, maxTop: 80 },
  { name: 'Coit Tower', cx: COIT[0], cz: COIT[1], ax: 1, az: 0, halfL: 16, halfW: 16, maxTop: 15 },
  // The bridges are hand-built too: what OSM's footprints and the LiDAR make of them stands beside the props, bare grey
  // boxes in the bay: the Golden Gate's real towers (228 and 225 m), the Bay Bridge's (142-156 m), its central anchorage
  // (89 m), the saddles over its piers (64-79 m, LiDAR-only) and the east span's tower, with no span to stand on
  { name: 'Golden Gate south tower', cx: -5152, cz: -4343, ax: 1, az: 0, halfL: 30, halfW: 30, maxTop: 240, clears: true },
  { name: 'Golden Gate north tower', cx: -5268, cz: -5618, ax: 1, az: 0, halfL: 30, halfW: 30, maxTop: 240, clears: true },
  { name: 'Bay Bridge east span', cx: 5362, cz: -4482, ax: 1, az: 0, halfL: 40, halfW: 40, maxTop: 170, clears: true },
  { name: 'Bay Bridge W2', cx: 3422, cz: -2310, ax: 1, az: 0, halfL: 40, halfW: 40, maxTop: 170, clears: true },
  { name: 'Bay Bridge W3', cx: 3600, cz: -2501, ax: 1, az: 0, halfL: 34, halfW: 34, maxTop: 170, clears: true },
  { name: 'Bay Bridge anchorage', cx: 3658, cz: -2585, ax: 1, az: 0, halfL: 40, halfW: 40, maxTop: 170, clears: true },
  { name: 'Bay Bridge W5', cx: 3904, cz: -2877, ax: 1, az: 0, halfL: 50, halfW: 50, maxTop: 170, clears: true },
  { name: 'Bay Bridge W6', cx: 4372, cz: -3424, ax: 1, az: 0, halfL: 40, halfW: 40, maxTop: 170, clears: true },
  // the hut in Alamo Square, 45 m^2 under a cypress, stood 22 m tall on the crown's LiDAR, beside the Painted Ladies
  { name: 'Alamo Square hut', cx: -1320, cz: -126, ax: 1, az: 0, halfL: 9, halfW: 9, maxTop: 25, clears: true },
  { name: 'Bay Bridge W1', cx: 2966, cz: -1768, ax: 1, az: 0, halfL: 32, halfW: 32, maxTop: 170, clears: true },
  // (hides nothing: BRIDGE_TIERS keeps its walls; the grid still held the 67 m the LiDAR read over them)
  { name: 'Fort Point', cx: -5086, cz: -3961, ax: 1, az: 0, halfL: 60, halfW: 60, maxTop: 0, clears: true },
];

/**
 * Far skyline tiles with nothing but those stand-ins (open water, Fort Point): far.bin's boxes for them go for good.
 * The Golden Gate's real south tower stands 357 m north of the prop's, so its box stood on the prop's deck in mid-span,
 * dark and 228 m tall, from anywhere past the streaming radius.
 */
export const FAR_STAND_INS: ReadonlyArray<readonly [number, number]> = [
  [-5152, -4343], [-5268, -5618], [-5086, -3961], [5362, -4482], [2966, -1768], [3432, -2323], [3413, -2297], [3600, -2501], [3658, -2585], [3879, -2852], [4359, -3411],
];

/**
 * Buildings whose upper tiers are a bridge's steel, by stable id: the LiDAR read the Golden Gate's arch and deck over Fort
 * Point (its walls are 16 m; it stood 64 m tall in dark glass in the game's first shot). They keep their ground tier.
 */
const BRIDGE_TIERS = new Set([459630039]);

/** Flatten the tiers BRIDGE_TIERS names, in a freshly parsed tile: no height, no mesh (the mesher skips them), the ground tier's roof for gameplay. */
export function trimBridgeTiers(t: BuildingTile) {
  for (let k = 1; k < t.count; k++)
    if (t.tier[k] > 0 && t.index[k] === t.index[k - 1] && BRIDGE_TIERS.has(t.stableId[k])) t.baseY[k] = t.roofY[k] = t.roofY[k - 1];
}

let iconsLocal: Array<{ x: number; z: number; icon: Icon }> | null = null;
/** The icons in local meters (SF origin). */
export function iconPoints(): Array<{ x: number; z: number; icon: Icon }> {
  if (!iconsLocal) iconsLocal = ICONS.map((icon) => { const [x, z] = llToLocal(icon.lat, icon.lon); return { x, z, icon }; });
  return iconsLocal;
}

export const District = { OTHER: 0, FIDI: 1, UNION_SQ: 2, CIVIC: 3, RINCON: 4, SOMA: 5, MISSION_BAY: 6 } as const;

/**
 * Downtown districts in local meters (SF). Market Street runs from Van Ness
 * (0, -33) to the Ferry Building (2262, -2278): north-west of it the Financial
 * District (east of Kearny), Union Square / Nob Hill / the Tenderloin, Civic
 * Center; south-east Rincon Hill / Transbay (east of 2nd), Mission Bay, SoMa.
 */
export function district(x: number, z: number): number {
  if (x < -600 || x > 3200 || z < -3200 || z > 1600) return District.OTHER;
  const nw = x * -2245 - (z + 33) * 2262 > 0;
  if (nw) {
    if (z < -2750) return District.OTHER; // North Beach and the waterfront
    if (x > 1300) return District.FIDI;
    if (x > 550) return District.UNION_SQ;
    return District.CIVIC;
  }
  if (x > 1600 && z > -300) return District.MISSION_BAY;
  if (x > 1750 && z < -1050) return District.RINCON;
  return District.SOMA;
}

/** Deterministic 0..1 hash of a stable id. */
function hash01(n: number, salt: number): number {
  let h = (n ^ (salt * 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Pick from [family, weight] pairs with r in 0..1. */
function pick(r: number, w: Array<[number, number]>): number {
  let sum = 0;
  for (const [, v] of w) sum += v;
  let acc = 0;
  for (const [f, v] of w) {
    acc += v / sum;
    if (r < acc) return f;
  }
  return w[w.length - 1][0];
}

const G = Fam.GLASS, MA = Fam.MASONRY, BA = Fam.BANDS, FI = Fam.FINS, GR = Fam.GRANITE, PR = Fam.PRECAST;

/** Family weights by height class and district. */
function weights(h: number, d: number, civic: boolean, bigSlab: boolean): Array<[number, number]> {
  let w: Array<[number, number]>;
  if (h >= 120) {
    // (granite stays rare: 555 California is the dark one, 345 California its icon-table cousin)
    if (d === District.FIDI) w = [[GR, 0.05], [BA, 0.3], [FI, 0.25], [G, 0.25], [PR, 0.15]];
    else if (d === District.RINCON) w = [[G, 0.75], [FI, 0.15], [BA, 0.1]];
    else if (d === District.SOMA) w = [[G, 0.5], [BA, 0.25], [FI, 0.15], [MA, 0.1]];
    else if (d === District.UNION_SQ || d === District.CIVIC) w = [[BA, 0.35], [G, 0.25], [MA, 0.25], [PR, 0.15]];
    else w = [[G, 0.5], [BA, 0.3], [PR, 0.2]];
  } else if (h >= 40) {
    if (d === District.FIDI) w = [[MA, 0.42], [BA, 0.28], [GR, 0.03], [FI, 0.1], [G, 0.12], [PR, 0.05]];
    else if (d === District.RINCON) w = [[G, 0.55], [BA, 0.2], [MA, 0.15], [FI, 0.1]];
    else if (d === District.SOMA) w = [[MA, 0.35], [BA, 0.3], [G, 0.25], [FI, 0.1]];
    else if (d === District.UNION_SQ || d === District.CIVIC) w = [[MA, 0.6], [BA, 0.25], [PR, 0.1], [G, 0.05]];
    else if (d === District.MISSION_BAY) w = [[G, 0.5], [PR, 0.3], [BA, 0.2]];
    else w = [[MA, 0.4], [BA, 0.4], [G, 0.2]];
  } else {
    if (d === District.FIDI || d === District.UNION_SQ || d === District.CIVIC) w = [[MA, 0.65], [BA, 0.3], [G, 0.05]];
    else if (d === District.SOMA) w = [[MA, 0.55], [BA, 0.35], [G, 0.1]];
    // Rincon / Transbay, Mission Bay (outside downtown styleFor keeps blocks under 40 m classic)
    else w = [[G, 0.4], [BA, 0.35], [MA, 0.25]];
  }
  if (civic && h < 60) w = [[MA, 0.75], [BA, 0.25]];
  if (bigSlab) w = w.map(([f, v]) => [f, f === BA ? v + 0.2 : v] as [number, number]);
  return w;
}

function crownFor(fam: number, r: number): number {
  if (fam === Fam.MASONRY) return Crown.CORNICE;
  if (fam === Fam.GLASS) return r < 0.25 ? Crown.LIT : Crown.MECH;
  if (fam === Fam.FINS) return r < 0.15 ? Crown.LIT : Crown.MECH;
  return Crown.MECH;
}

/** Which buildings get a facade family at all: towers and big commercial / civic blocks. */
export function wantsFamily(arch: number, top: number): boolean {
  if (arch === Arch.TOWER) return top >= 14;
  if (arch === Arch.COMMERCIAL || arch === Arch.CIVIC) return top >= 16;
  return false;
}

/**
 * The facade style of one building (null = keep the classic archetype look).
 * `inside(x, z)` tests a point against the building's parts (for the icon table).
 */
export function styleFor(
  arch: number, top: number, area0: number, cx: number, cz: number, stableId: number,
  inside: (x: number, z: number) => boolean, sf: boolean,
): TowerStyle | null {
  // (the icons table is San Francisco's, in SF local meters: never on another city)
  if (sf && top >= 40) {
    for (const p of iconPoints()) {
      if (Math.abs(p.x - cx) > 120 || Math.abs(p.z - cz) > 120) continue;
      if (top >= p.icon.minTop && inside(p.x, p.z)) return p.icon.style;
    }
  }
  if (!wantsFamily(arch, top)) return null;
  const d = district(cx, cz);
  // outside downtown, blocks under 40 m keep the classic archetype look: they stand among the houses of the
  // battleship-grey city, where a pale stone or glass box reads as an intruder (review: a cream masonry
  // school by Alamo Square)
  if (d === District.OTHER && top < 40) return null;
  const r = hash01(stableId, 1);
  const fam = pick(r, weights(top, d, arch === Arch.CIVIC, area0 > 6000 && top < 80));
  const r2 = hash01(stableId, 2);
  // (lit crowns only on real towers; a lit band on a mid-rise reads as a stripe)
  const crown = top < 60 && crownFor(fam, r2) === Crown.LIT ? Crown.MECH : crownFor(fam, r2);
  // a few deco towers keep their piers; plain commercial blocks get punched windows
  const variant = fam === Fam.MASONRY && (top < 30 || r2 > 0.6) ? Variant.PUNCHED : Variant.PLAIN;
  // big blocks with a tower on a podium: the podium is often older and plainer
  let podium = fam;
  if (top >= 60) {
    const r3 = hash01(stableId, 3);
    podium = fam === Fam.GLASS ? (r3 < 0.6 ? Fam.GLASS : Fam.BANDS) : r3 < 0.5 ? fam : Fam.MASONRY;
  }
  return { fam, crown, variant, podium };
}

/** True if a footprint centered at (x, z), `top` m tall, is drawn by a prop instead. */
export function hiddenAt(x: number, z: number, top: number): boolean {
  for (const h of HIDDEN) {
    if (top > h.maxTop) continue;
    const dx = x - h.cx, dz = z - h.cz;
    const al = dx * h.ax + dz * h.az;
    const ac = -dx * h.az + dz * h.ax;
    if (Math.abs(al) <= h.halfL && Math.abs(ac) <= h.halfW) return true;
  }
  return false;
}
