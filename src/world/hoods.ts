// The neighbourhoods (docs/specs/factions/FACTIONS.md section 3, "Neighbourhoods", decision 28; docs/specs/factions/C18.md):
// the table the areas take, feat/recess's src/factions/neighbourhoods.ts `NeighbourhoodTable`, from public/city/<slug>/hoods.bin.
// Writer: tools/bake/hoods.py (keep in sync). Nothing imports this yet, so no page fetches the file. Worker-safe: no three.js
// and no DOM, only typed arrays, DataView and TextDecoder. A parse takes the inflated file and gives null for a magic it
// doesn't know, a major version it can't read, a file cut short, a count past its bytes or a heart off its own squares:
// never a throw into the areas.
//
// hoods.bin (gzip of), all little-endian:
//   header  'SBN1', u16 version (major), u16 minor, i32 ix0, i32 iz0, u16 w, u16 h, u32 count                (24 bytes)
//   hearts  u32 heart[count]: each neighbourhood's heart, a square's key (areas.ts packSquare(ix, iz))
//   flags   u8 flags[count]: why it has no god, 0 for none: 1 too small (a whole piece of land under 0.25 km2: Alcatraz),
//           2 no square for its heart (every one tagged); pad to 4
//   grid    u16 hood[w * h]: square (ix0 + i, iz0 + j) at j * w + i, 0 for none (water, past the map's frame), else its
//           neighbourhood + 1. A square is in one neighbourhood at most by the layout itself
//   tagged  u8 bits[ceil(w * h / 8)] in the grid's order, the low bit first: worship, cemetery, memorial, school or hospital
//           cover a quarter of the square's land, so its stages stop at the streets; pad to 4
//   names   count x (u8 length, utf-8), the neighbourhoods' order (the end of the file)
// The squares are the areas' 128 m grid on the map's origin. A neighbourhood's index is this file's alone: a re-bake can
// renumber them, and nothing saved keys on one (C18).

import { gunzip, isGzip } from './gunzip';

export const HOODS_VERSION = 1;

/** city.json's "hoods" (tools/bake/hoods.py): the file's version and its counts. */
export interface HoodsRef {
  version: number;
  minor: number;
  /** hoods.bin's size, gzipped */
  bytes: number;
  /** neighbourhoods */
  count: number;
  /** land squares, every one in a neighbourhood */
  squares: number;
  godless: number;
  tagged: number;
}

/** The areas' table, field for field (feat/recess ab6c67c, src/factions/neighbourhoods.ts). */
export interface NeighbourhoodTable {
  names: string[];
  /** each one's heart square */
  hearts: number[];
  /** each one's squares */
  squares: number[][];
  /** squares the map tags worship, cemetery, memorial, school or hospital: stages 4 and 5 stay off them */
  tagged?: Iterable<number>;
  /** too small for a god, or no open ground for a heart: squares only (Alcatraz) */
  godless?: boolean[];
}

/** The table as the file gives it, with its version (C9's habit: the minor beside it). */
export interface HoodsTable extends NeighbourhoodTable {
  version: number;
  minor: number;
  tagged: number[];
  godless: boolean[];
}

/** areas.ts packSquare: ix and iz as two 16-bit halves. */
function packSquare(ix: number, iz: number): number {
  return (((ix & 0xffff) << 16) | (iz & 0xffff)) >>> 0;
}

/** hoods.bin, inflated, as the areas' table; null for a file it can't read. */
export function parseHoods(buf: ArrayBuffer): HoodsTable | null {
  if (buf.byteLength < 24) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== 0x53 || dv.getUint8(1) !== 0x42 || dv.getUint8(2) !== 0x4e || dv.getUint8(3) !== 0x31) return null; // 'SBN1'
  const version = dv.getUint16(4, true), minor = dv.getUint16(6, true);
  if (version !== HOODS_VERSION) return null;
  const ix0 = dv.getInt32(8, true), iz0 = dv.getInt32(12, true), w = dv.getUint16(16, true), h = dv.getUint16(18, true);
  const count = dv.getUint32(20, true);
  const cells = w * h;
  let o = 24;
  const flagsAt = o + count * 4;
  const gridAt = (flagsAt + count + 3) & ~3;
  const bitsAt = gridAt + cells * 2;
  const namesAt = (bitsAt + Math.ceil(cells / 8) + 3) & ~3;
  if (count >= 0xffff || namesAt + count > buf.byteLength) return null;
  // (the file's u16s are little-endian and a typed array reads the platform's order: little-endian on every phone and
  // browser the game runs on, and gridAt is 4-aligned)
  const grid = new Uint16Array(buf, gridAt, cells);
  const squares: number[][] = [];
  for (let n = 0; n < count; n++) squares.push([]);
  const tagged: number[] = [];
  const bits = new Uint8Array(buf, bitsAt, Math.ceil(cells / 8));
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const c = j * w + i, n = grid[c];
      if (!n) continue;
      if (n > count) return null;
      const key = packSquare(ix0 + i, iz0 + j);
      squares[n - 1].push(key);
      if (bits[c >> 3] & (1 << (c & 7))) tagged.push(key);
    }
  const hearts: number[] = [];
  const godless: boolean[] = [];
  for (let n = 0; n < count; n++) {
    const key = dv.getUint32(o, true);
    o += 4;
    const i = ((key >>> 16) << 16 >> 16) - ix0, j = ((key & 0xffff) << 16 >> 16) - iz0;
    if (i < 0 || j < 0 || i >= w || j >= h || grid[j * w + i] !== n + 1) return null; // a heart off its own squares
    hearts.push(key);
    godless.push(dv.getUint8(flagsAt + n) !== 0);
  }
  const names: string[] = [];
  const dec = new TextDecoder();
  o = namesAt;
  for (let n = 0; n < count; n++) {
    if (o >= buf.byteLength) return null;
    const len = dv.getUint8(o);
    if (o + 1 + len > buf.byteLength) return null;
    names.push(dec.decode(new Uint8Array(buf, o + 1, len)));
    o += 1 + len;
  }
  return { version, minor, names, hearts, squares, tagged, godless };
}

/**
 * The city's neighbourhoods, or null: none baked (no `ref`), a version this can't read, or the file not there or broken.
 * `base` is the city's folder ('./city/sf'), `query` its data version (City.ts dataQuery(), which this doesn't import:
 * it would bring three.js into a worker).
 */
export async function loadHoods(base: string, ref: HoodsRef | undefined, query = ''): Promise<HoodsTable | null> {
  if (!ref || ref.version !== HOODS_VERSION) return null;
  try {
    const r = await fetch(`${base}/hoods.bin${query}`);
    if (!r.ok) return null;
    let buf = await r.arrayBuffer();
    if (isGzip(buf)) buf = await gunzip(buf);
    return parseHoods(buf);
  } catch {
    return null;
  }
}
