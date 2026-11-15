// The street index (docs/M1.md, task 8; docs/STUDIO.md part 7, system 6): every named street of a city by its name, so FLY TO A STREET can put the bus
// over one before any of its tiles is in. A city's tiles already carry their streets' names and centrelines (tiles.ts, 'SBT2'), but only tile by tile, as
// they stream. tools/streets/build.mjs reads them all and writes one small file beside city.json, streets.bin; this module is that file's format, read and
// written, and the search over it. Any city baked from OpenStreetMap gets one: nothing here knows San Francisco.
//
// Pure: no DOM, no three.js, nothing fetched. The page fetches `<city>/streets.bin` when the sheet opens and hands the bytes to parseStreets.
//
// The file ('SBS1', little-endian):
//   magic[4] 'SBS1', u16 quantum (dm: a coordinate's step), u16 streetCount, i32 x0, i32 z0 (m: the corner the coordinates count from),
//   u32 bodyBytes (everything after this head), u32 check (FNV-1a over every byte of the file but these four)                              (24 bytes)
//   streets, sorted by name: { u8 byteLength, utf-8 name (as signed: 'Guerrero St'), u8 pieceCount, u8 mainCount,
//     pieces: { u8 vertCount (2 or more), u16 x, u16 z (quanta from the corner), then vertCount - 1 of { i8 dx, i8 dz } (quanta from the vertex before) } }
// A piece is one unbroken run of the street, simplified. A street the map breaks has several. The first mainCount of them are the street itself, the
// longest first; the rest are a namesake's, far off on the same map (another town's Pine St), which the search leaves alone unless the bus is beside it.
// A file whose length or check is wrong, or that steps off its grid, is no index (parseStreets answers null): a damaged one never sends the bus anywhere.
//
// The search takes what a thumb types: "guerrero", "Guerrero Street", "south van ness", "20", "valenica" (a slip), "goodlett" (a later word of a long
// name), "van" (a beginning), "guerrero st, san francisco" (words it has no use for), and a corner: "guerrero & 20th", with any of & / @ + , x and at near,
// or just the two names ("16th mission"). It answers with the streets it could mean, the likeliest first, each with a point and a score that says how sure:
//   0        the name as typed (the kind left off counts: "guerrero" is Guerrero St)
//   1        a looser reading of the whole text: another kind ("van ness st"), a later word or a beginning of a longer name; 1.5 for letters a name begins
//   2        the text with words taken off its end or its start ("guerrero st san francisco", "1200 guerrero st", a slip in the kind: "guerrero sy")
//   3, 4     one slip of the thumb, two
// A corner scores as the looser of its two names; plus 1 where the two streets only come near each other (within NEARLY m: a block the map leaves out,
// an avenue's far side), answered with the point between them; plus 2 where they do not meet at all, answered with one street alone (cross null).

/** What a word of a street's name is written as, signed or typed: the key holds the short form, so "Street" finds "St" and "South" finds "S". */
const SHORT: Record<string, string> = {
  street: 'st', str: 'st', avenue: 'ave', av: 'ave', boulevard: 'blvd', bl: 'blvd', blv: 'blvd', drive: 'dr', road: 'rd', lane: 'ln', court: 'ct', place: 'pl',
  terrace: 'ter', terr: 'ter', highway: 'hwy', alley: 'aly', al: 'aly', circle: 'cir', parkway: 'pkwy', pky: 'pkwy', trail: 'trl', wy: 'way', freeway: 'fwy',
  expressway: 'expy', saint: 'st', mount: 'mt', fort: 'ft', point: 'pt', doctor: 'dr', junior: 'jr', sergeant: 'sgt',
  north: 'n', south: 's', east: 'e', west: 'w',
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th',
};
/** Initials a street is known by, as the words its sign has. */
const KNOWN: Record<string, string[]> = { jfk: ['john', 'f', 'kennedy'], mlk: ['martin', 'luther', 'king'] };
/** The words that say what kind of way it is: a name's last word, when it has another before it, is its kind and not its key. (Not square or plaza: a
 *  thumb that types "Union Square" means the square, and the index holds streets.) */
const KINDS = new Set(['st', 'ave', 'blvd', 'dr', 'rd', 'ln', 'ct', 'pl', 'ter', 'hwy', 'aly', 'cir', 'pkwy', 'trl', 'way', 'walk', 'path', 'row', 'loop', 'steps', 'fwy', 'expy']);

/** two streets meet when their runs come this near (m): the index keeps one side of an avenue where its sides are close, simplified */
const MEETS = 30;
/** ...and only come near each other within this (m): answered as a corner at the point between them, a looser answer */
const NEARLY = 130;
/** with the bus this near a namesake's run (m), the bus means that one */
const BESIDE = 1000;
/** a typed text is read to this many characters */
const LONGEST = 120;

export interface Street {
  /** as its sign has it: 'Guerrero St' */
  name: string;
  /** what it is found by: lower case, no accents or marks, short forms, without its kind: 'guerrero' */
  key: string;
  /** its kind, short ('st', 'ave'; '' for none: Broadway) */
  kind: string;
  /** its runs: x, z pairs in the map's metres. The first `main` are the street itself, the longest first; the rest a far-off namesake's */
  pieces: Float32Array[];
  main: number;
  /** its own runs' length (m) */
  length: number;
}

export interface StreetIndex {
  /** by name */
  streets: Street[];
  /** the streets of a key ('24th': 24th St, 24th Ave), the longest first */
  byKey: Map<string, Street[]>;
}

export interface StreetHit {
  street: Street;
  /** the other street of a corner, when two were named and they meet or come near */
  cross: Street | null;
  /** where: the corner, the point nearest `near`, or the street's middle (map m) */
  x: number;
  z: number;
  /** how sure: 0 the name as typed, up to 4 and more for a guess (the head comment has the bands) */
  score: number;
}

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/** A name's or a query's words as the index keys them: lower case, no accents or marks, short forms, initials spelt out, without a leading "the". */
function keyWords(name: string): string[] {
  const words: string[] = [];
  for (const w of name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ')) {
    if (!w) continue;
    // (a number with the wrong ending is its number: "22th" is 22nd)
    const n = /^(\d+)(st|nd|rd|th)$/.exec(w);
    if (n) words.push(ordinal(Number(n[1])));
    else if (KNOWN[w]) words.push(...KNOWN[w]);
    else words.push(SHORT[w] ?? w);
  }
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words;
}

/** A name or a query as the index keys it: its key and its kind. "The Embarcadero" is 'embarcadero'; "Lincoln Way" 'lincoln' of kind 'way'. */
export function streetKey(name: string): { key: string; kind: string } {
  const words = keyWords(name);
  let kind = '';
  if (words.length > 1 && KINDS.has(words[words.length - 1])) kind = words.pop()!;
  return { key: words.join(' '), kind };
}

/** A piece's length (m). */
function lengthOf(xz: ArrayLike<number>): number {
  let l = 0;
  for (let i = 2; i < xz.length; i += 2) l += Math.hypot(xz[i] - xz[i - 2], xz[i + 1] - xz[i - 1]);
  return l;
}

/** FNV-1a over the file's bytes but the four of the check itself (20 to 23), as a u32: the head's numbers are under it too. */
function check32(b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) if (i < 20 || i > 23) h = Math.imul(h ^ b[i], 0x01000193);
  return h >>> 0;
}

/**
 * The file's bytes for these streets (the builder's half). Pieces are x, z pairs in the map's metres; `main` says how many of a street's pieces, the first
 * ones, are the street itself (all of them when left out). A coordinate is kept to `quantum` m. Streets are written by name, and within the street's own
 * pieces and within its namesake's the longest as written first, so the same streets always make the same bytes. A piece with more than 255 vertices, or
 * a step longer than 127 quanta, is split or stepped: nothing is dropped, and a street too small to keep two points of is written as its spot. It throws
 * on what it cannot write truly: a quantum that is not a whole number of decimetres, a coordinate that is not a number, a name of no bytes or over 255,
 * a street with no piece, more than 65,535 streets or 255 pieces a street.
 */
export function encodeStreets(streets: ReadonlyArray<{ name: string; pieces: ReadonlyArray<ArrayLike<number>>; main?: number }>, quantum = 4): Uint8Array {
  const dm = quantum * 10;
  if (!(Number.isInteger(dm) && dm >= 1 && dm <= 0xffff)) throw new Error(`encodeStreets: a quantum of ${quantum} m`);
  const enc = new TextEncoder();
  let x0 = Infinity, z0 = Infinity;
  for (const s of streets)
    for (const p of s.pieces)
      for (let i = 0; i < p.length; i++) {
        if (!Number.isFinite(p[i])) throw new Error(`encodeStreets: ${s.name} has a coordinate that is not a number`);
        if (i % 2) z0 = Math.min(z0, p[i]);
        else x0 = Math.min(x0, p[i]);
      }
  // (the corner a whole number of metres, as the head holds it)
  x0 = Number.isFinite(x0) ? Math.floor(Math.floor(x0 / quantum) * quantum) : 0;
  z0 = Number.isFinite(z0) ? Math.floor(Math.floor(z0 / quantum) * quantum) : 0;
  const q = (v: number, o: number) => Math.round((v - o) / quantum);
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  const written = (r: number[]) => {
    let l = 0;
    for (let i = 2; i < r.length; i += 2) l += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
    return l;
  };
  const sorted = [...streets].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (sorted.length > 0xffff) throw new Error(`encodeStreets: ${sorted.length} streets`);
  for (const s of sorted) {
    const name = enc.encode(s.name);
    if (name.length === 0 || name.length > 255) throw new Error(`encodeStreets: a name of ${name.length} bytes`);
    if (s.pieces.length === 0) throw new Error(`encodeStreets: ${s.name} has no piece`);
    const mainIn = Math.min(s.pieces.length, Math.max(1, s.main ?? s.pieces.length));
    // (each piece as quantised steps no longer than an i8, runs of at most 255 vertices; a step that quantises to nothing is left out)
    const groups: number[][][] = [[], []];
    let spot: number[] | null = null;
    s.pieces.forEach((p, pi) => {
      const pts: number[] = [];
      for (let i = 0; i + 1 < p.length; i += 2) {
        const x = q(p[i], x0), z = q(p[i + 1], z0);
        if (x < 0 || z < 0 || x > 0xffff || z > 0xffff) throw new Error(`encodeStreets: ${s.name} leaves the grid`);
        if (pts.length === 0) {
          pts.push(x, z);
          continue;
        }
        const px = pts[pts.length - 2], pz = pts[pts.length - 1];
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(x - px), Math.abs(z - pz)) / 127));
        for (let k = 1; k <= n; k++) {
          const nx = px + Math.round(((x - px) * k) / n), nz = pz + Math.round(((z - pz) * k) / n);
          if (nx !== pts[pts.length - 2] || nz !== pts[pts.length - 1]) pts.push(nx, nz);
        }
      }
      const runs = groups[pi < mainIn ? 0 : 1];
      for (let i = 0; i + 2 < pts.length; i += 254 * 2) runs.push(pts.slice(i, i + 255 * 2));
      if (pts.length === 2 && pi < mainIn && !spot) spot = pts;
    });
    // (a street that is one point at this step: its spot, a step wide, so its name still lands on it)
    if (groups[0].length === 0 && spot) groups[0].push([spot[0], spot[1], spot[0] < 0xffff ? spot[0] + 1 : spot[0] - 1, spot[1]]);
    for (const g of groups) g.sort((a, b) => written(b) - written(a) || a[0] - b[0] || a[1] - b[1] || a.length - b.length);
    const kept = [...groups[0], ...groups[1]];
    if (groups[0].length === 0 || kept.length > 255) throw new Error(`encodeStreets: ${s.name} has ${groups[0].length} pieces of its own, ${kept.length} in all`);
    out.push(name.length, ...name, kept.length, groups[0].length);
    for (const r of kept) {
      out.push(r.length / 2);
      u16(r[0]);
      u16(r[1]);
      for (let i = 2; i < r.length; i += 2) out.push((r[i] - r[i - 2]) & 255, (r[i + 1] - r[i - 1]) & 255);
    }
  }
  const bytes = new Uint8Array(24 + out.length), dv = new DataView(bytes.buffer);
  bytes.set([0x53, 0x42, 0x53, 0x31]);
  dv.setUint16(4, dm, true);
  dv.setUint16(6, sorted.length, true);
  dv.setInt32(8, x0, true);
  dv.setInt32(12, z0, true);
  dv.setUint32(16, out.length, true);
  bytes.set(out, 24);
  dv.setUint32(20, check32(bytes), true);
  return bytes;
}

/** The index from the file's bytes; null for a file that isn't one: cut short, grown, a byte wrong anywhere, a step off its grid (the sheet then has no
 *  street search, and says nothing). Never throws. */
export function parseStreets(buf: ArrayBuffer | Uint8Array | null | undefined): StreetIndex | null {
  if (!buf || typeof buf !== 'object' || typeof (buf as ArrayBuffer).byteLength !== 'number') return null;
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer);
  if (b.length < 24 || b[0] !== 0x53 || b[1] !== 0x42 || b[2] !== 0x53 || b[3] !== 0x31) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), dec = new TextDecoder();
  const quantum = dv.getUint16(4, true) / 10, count = dv.getUint16(6, true), x0 = dv.getInt32(8, true), z0 = dv.getInt32(12, true);
  if (!(quantum > 0) || dv.getUint32(16, true) !== b.length - 24 || dv.getUint32(20, true) !== check32(b)) return null;
  const streets: Street[] = [], byKey = new Map<string, Street[]>();
  let o = 24;
  for (let s = 0; s < count; s++) {
    if (o + 1 > b.length) return null;
    const len = b[o++];
    if (len === 0 || o + len + 2 > b.length) return null;
    const name = dec.decode(b.subarray(o, o + len));
    o += len;
    const n = b[o++], main = b[o++];
    if (n === 0 || main === 0 || main > n) return null;
    const pieces: Float32Array[] = [];
    let length = 0;
    for (let p = 0; p < n; p++) {
      if (o + 5 > b.length) return null;
      const verts = b[o];
      if (verts < 2 || o + 5 + (verts - 1) * 2 > b.length) return null;
      const xz = new Float32Array(verts * 2);
      let x = dv.getUint16(o + 1, true), z = dv.getUint16(o + 3, true);
      o += 5;
      xz[0] = x0 + x * quantum;
      xz[1] = z0 + z * quantum;
      for (let v = 1; v < verts; v++, o += 2) {
        x += dv.getInt8(o);
        z += dv.getInt8(o + 1);
        if (x < 0 || z < 0 || x > 0xffff || z > 0xffff) return null;
        xz[v * 2] = x0 + x * quantum;
        xz[v * 2 + 1] = z0 + z * quantum;
      }
      pieces.push(xz);
      if (p < main) length += lengthOf(xz);
    }
    const k = streetKey(name), street: Street = { name, key: k.key, kind: k.kind, pieces, main, length };
    streets.push(street);
    const list = byKey.get(k.key);
    if (list) list.push(street);
    else byKey.set(k.key, [street]);
  }
  if (o !== b.length) return null;
  for (const list of byKey.values()) list.sort((a, b) => b.length - a.length);
  return { streets, byKey };
}

/** The point of a street's runs nearest (x, z), and how far that is (m): of pieces `from` to `to` (all of them when left out). */
export function nearestOn(street: Street, x: number, z: number, from = 0, to = street.pieces.length): { x: number; z: number; d: number } {
  const out = { x: street.pieces[from][0], z: street.pieces[from][1], d: Infinity };
  for (let p = from; p < to; p++) {
    const xz = street.pieces[p];
    for (let i = 2; i < xz.length; i += 2) {
      const ax = xz[i - 2], az = xz[i - 1], bx = xz[i] - ax, bz = xz[i + 1] - az, l2 = bx * bx + bz * bz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / l2)) : 0;
      const px = ax + bx * t, pz = az + bz * t, d = Math.hypot(x - px, z - pz);
      if (d < out.d) {
        out.x = px;
        out.z = pz;
        out.d = d;
      }
    }
  }
  return out;
}

/** A street's middle: the point of its longest run nearest that run's own centre of weight (a run that bends back on itself has its half-way point at
 *  the bend; the point nearest its centre is in the middle of the street either way). */
export function middleOf(street: Street): { x: number; z: number } {
  const xz = street.pieces[0];
  let cx = 0, cz = 0, all = 0;
  for (let i = 2; i < xz.length; i += 2) {
    const l = Math.hypot(xz[i] - xz[i - 2], xz[i + 1] - xz[i - 1]);
    cx += ((xz[i] + xz[i - 2]) / 2) * l;
    cz += ((xz[i + 1] + xz[i - 1]) / 2) * l;
    all += l;
  }
  if (!(all > 0)) return { x: xz[0], z: xz[1] };
  const p = nearestOn(street, cx / all, cz / all, 0, 1);
  return { x: p.x, z: p.z };
}

/** Where a street is for the bus at `near`: its own runs' nearest point, or a namesake's when the bus is beside that one; with no bus, its middle. */
function pointFor(street: Street, near?: { x: number; z: number }): { x: number; z: number; d: number } {
  if (!near) return { ...middleOf(street), d: 0 };
  const own = nearestOn(street, near.x, near.z, 0, street.main);
  if (street.main === street.pieces.length) return own;
  const other = nearestOn(street, near.x, near.z, street.main);
  return other.d < own.d && other.d <= BESIDE ? other : own;
}

/** Where two streets come nearest each other: the point between them and the gap (m). They cross, or meet at a corner, when the gap is a few metres. */
export function crossing(a: Street, b: Street): { x: number; z: number; d: number } {
  const out = { x: 0, z: 0, d: Infinity };
  const seg = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) => {
    // (two segments' nearest points: where they cross if they do, else an end of one against the other)
    const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx;
    if (den !== 0) {
      const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        out.x = ax + rx * t;
        out.z = az + rz * t;
        out.d = 0;
        return;
      }
    }
    const end = (px: number, pz: number, qx: number, qz: number, wx: number, wz: number) => {
      const l2 = wx * wx + wz * wz, t = l2 > 0 ? Math.min(1, Math.max(0, ((px - qx) * wx + (pz - qz) * wz) / l2)) : 0;
      const nx = qx + wx * t, nz = qz + wz * t, d = Math.hypot(px - nx, pz - nz);
      if (d < out.d) {
        out.x = (px + nx) / 2;
        out.z = (pz + nz) / 2;
        out.d = d;
      }
    };
    end(ax, az, cx, cz, sx, sz);
    end(bx, bz, cx, cz, sx, sz);
    end(cx, cz, ax, az, rx, rz);
    end(dx, dz, ax, az, rx, rz);
  };
  for (const p of a.pieces)
    for (const r of b.pieces)
      for (let i = 2; i < p.length && out.d > 0; i += 2)
        for (let j = 2; j < r.length && out.d > 0; j += 2) seg(p[i - 2], p[i - 1], p[i], p[i + 1], r[j - 2], r[j - 1], r[j], r[j + 1]);
  return out;
}

/** How many single slips (a letter wrong, missing, added, or two swapped) turn a into b, up to `most`; more is `most` + 1. A figure is never a slip:
 *  "Pier 39" is not Pier 96. */
function slips(a: string, b: string, most: number): number {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  const digit = (c: string) => c >= '0' && c <= '9', far = most + 1;
  let prev2: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, j) => (j === 0 || !digit(b[j - 1]) ? j : far));
  for (let j = 1; j <= b.length; j++) if (prev[j - 1] >= far) prev[j] = far;
  for (let i = 1; i <= a.length; i++) {
    const ca = a[i - 1], cur = [digit(ca) || prev[0] >= far ? far : prev[0] + 1];
    let low = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cb = b[j - 1];
      let v = Math.min(prev[j] + (digit(ca) ? far : 1), cur[j - 1] + (digit(cb) ? far : 1), prev[j - 1] + (ca === cb ? 0 : digit(ca) || digit(cb) ? far : 1));
      if (i > 1 && j > 1 && ca === b[j - 2] && a[i - 2] === cb && !digit(ca) && !digit(cb)) v = Math.min(v, prev2[j - 2] + 1);
      v = Math.min(v, far);
      cur.push(v);
      low = Math.min(low, v);
    }
    if (low > most) return far;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

interface Found {
  street: Street;
  score: number;
  /** signed with the kind as typed (none typed and none signed counts): before a street of the same score that is not, wherever the bus is */
  as: boolean;
}

/** The streets these words could mean as they stand, the likeliest first: the name itself (0), then a looser reading of all of it (0.75 to 1.5). */
function whole(ix: StreetIndex, words: readonly string[]): Found[] {
  let kind = '';
  const w = [...words];
  if (w.length > 1 && KINDS.has(w[w.length - 1])) kind = w.pop()!;
  const key = w.join(' ');
  if (!key) return [];
  const out: Found[] = [];
  const add = (s: Street, score: number, as = false) => {
    if (!out.some((o) => o.street === s)) out.push({ street: s, score, as });
  };
  // the name itself: of a key's streets the kind typed first, "24th ave" before 24th St, and with no kind typed the one signed with none, "Burrows"
  // before Burrows St, then the longest. A kind typed that no street of the key has is a looser reading
  const keys = [key];
  // (a bare number is its ordinal's street: "20" is 20th)
  if (/^\d+$/.test(key)) keys.push(ordinal(Number(key)));
  for (const k of keys) {
    const list = ix.byKey.get(k);
    if (!list) continue;
    for (const s of list) if (s.kind === kind) add(s, 0, true);
    for (const s of list) if (s.kind !== kind) add(s, kind ? 1 : 0);
  }
  // a looser reading: the typed words as a longer name's later words or its first ones ("goodlett", "kennedy dr", "van"), then letters a name begins
  // ("gue"); the longest street first. Where a kind was typed that the key's own streets lack and a longer name has both, that one comes before them
  // ("kennedy drive" is John F Kennedy Dr before Kennedy Pl)
  const full = kind ? `${key} ${kind}` : '';
  const has = (k: string, t: string) => k.startsWith(`${t} `) || k.endsWith(` ${t}`) || k.includes(` ${t} `);
  const inside: Street[] = [], begins: Street[] = [];
  for (const [k, list] of ix.byKey) {
    if (k === key) continue;
    if (has(k, key) || (full && (k === full || has(k, full)))) inside.push(...list);
    else if (key.length >= 3 && k.startsWith(key)) begins.push(...list);
  }
  const byLength = (a: Street, b: Street) => b.length - a.length;
  if (kind && !out.some((o) => o.score === 0)) for (const s of inside.filter((s) => s.kind === kind).sort(byLength)) add(s, 0.75);
  for (const s of inside.sort(byLength)) add(s, 1);
  for (const s of begins.sort(byLength)) add(s, 1.5);
  return out.sort((a, b) => a.score - b.score);
}

/** The streets one typed name could mean, the likeliest first, each with how loose the match is (the head comment's bands). At most `most`. */
function candidates(ix: StreetIndex, text: string, most: number): Found[] {
  const words = keyWords(text);
  if (words.length === 0) return [];
  let out = whole(ix, words);
  if (out.length === 0 && words.length > 1) {
    // words it has no use for: off the end (a town, a slip in the kind), at most three; then off the start (a house number, "on"); then both. Never a
    // word with a figure in it but a house number ("pier 93" is not some other pier), and never down to words that name nothing (a kind, a letter)
    const num = (w: string) => /\d/.test(w), names = (ws: string[]) => ws.some((w) => w.length > 1 && !KINDS.has(w)) && whole(ix, ws);
    const head = /^\d+$/.test(words[0]) || !num(words[0]);
    for (let cut = 1; cut <= 3 && cut < words.length && out.length === 0 && !num(words[words.length - cut]); cut++) out = names(words.slice(0, words.length - cut)) || [];
    if (out.length === 0 && head) out = names(words.slice(1)) || [];
    if (out.length === 0 && head && words.length > 2 && !num(words[words.length - 1])) out = names(words.slice(1, words.length - 1)) || [];
    out = out.map((o) => ({ street: o.street, score: 2 + o.score / 4, as: false }));
  }
  if (out.length === 0) {
    // a slip of the thumb, by the name's length: none under four letters, one under seven, two from there
    const q = streetKey(words.join(' '));
    if (q.key.length >= 4) {
      const may = q.key.length < 7 ? 1 : 2;
      const near: Array<{ list: Street[]; d: number }> = [];
      for (const [k, list] of ix.byKey) {
        const d = slips(q.key, k, may);
        if (d <= may) near.push({ list, d });
      }
      near.sort((a, b) => a.d - b.d || b.list[0].length - a.list[0].length);
      for (const n of near) for (const s of [...n.list.filter((s) => s.kind === q.kind), ...n.list.filter((s) => s.kind !== q.kind)]) if (!out.some((o) => o.street === s)) out.push({ street: s, score: 2 + n.d, as: false });
    }
  }
  return out.slice(0, most);
}

/** One name's answers as hits: where each is for the bus, and of equally likely streets the one nearer the bus first ("24th" over the Mission). */
function singles(found: readonly Found[], near: { x: number; z: number } | undefined, add: number): StreetHit[] {
  const hits = found.map((f) => {
    const p = pointFor(f.street, near);
    return { hit: { street: f.street, cross: null, x: p.x, z: p.z, score: f.score + add } as StreetHit, d: p.d, as: f.as };
  });
  if (near) hits.sort((a, b) => a.hit.score - b.hit.score || Number(b.as) - Number(a.as) || a.d - b.d);
  return hits.map((h) => h.hit);
}

/** Two names as a corner: the pairs that meet, the surest first; if none does, the pairs that come near, each at the point between its two streets. */
function corner(a: readonly Found[], b: readonly Found[]): StreetHit[] {
  const meet: StreetHit[] = [], nearly: Array<{ hit: StreetHit; gap: number }> = [];
  for (const p of a)
    for (const r of b) {
      if (p.street === r.street) continue;
      const c = crossing(p.street, r.street), score = Math.max(p.score, r.score);
      if (c.d <= MEETS) meet.push({ street: p.street, cross: r.street, x: c.x, z: c.z, score });
      else if (c.d <= NEARLY) nearly.push({ hit: { street: p.street, cross: r.street, x: c.x, z: c.z, score: score + 1 }, gap: c.d });
    }
  if (meet.length) return meet.sort((p, r) => p.score - r.score);
  return nearly.sort((p, r) => p.hit.score - r.hit.score || p.gap - r.gap).map((n) => n.hit);
}

/**
 * What the typed text could mean: the streets, the likeliest first, each with a point on it and a score (the head comment has both). Nothing found is an
 * empty list; it never throws. `near` is where the bus is (map m): the point on a long street, and which of two streets of one name. At most `most`
 * answers (5).
 */
export function findStreet(ix: StreetIndex, text: string, near?: { x: number; z: number }, most = 5): StreetHit[] {
  if (typeof text !== 'string') return [];
  const t = text.slice(0, LONGEST).replace(/\s+/g, ' ').trim().replace(/^(?:the )?(?:corner|intersection) of /i, '').replace(/^on /i, '');
  if (!t) return [];
  // a street whose own name is all of the text, joiners and all (Elephant and Castle), is that street
  const all = candidates(ix, t, most);
  if (all.length && all[0].score === 0) return singles(all, near, 0).slice(0, most);
  // two names joined: a corner
  const parts = t.split(/ ?(?:&|\/|@|\+|,|;| x | and | at | near | by ) ?/i).filter((p) => keyWords(p).length);
  if (parts.length >= 2) {
    const a = candidates(ix, parts[0], most), b = candidates(ix, parts[1], most);
    // (one of the two a street and the other only a guess: the street alone, the rest words it has no use for: "guerrero st, san francisco")
    const sure = (f: readonly Found[]) => f.length > 0 && f[0].score < 2;
    const hits = sure(a) === sure(b) ? corner(a, b) : [];
    if (hits.length) return hits.slice(0, most);
    // (they do not meet: the first street alone, or the second when the first is nothing or a guess; a looser answer either way)
    return singles(sure(a) || !sure(b) ? (a.length ? a : b) : b, near, 2).slice(0, most);
  }
  if (all.length && all[0].score < 2) return singles(all, near, 0).slice(0, most);
  // two names with nothing between them ("16th mission"): a way of cutting the words in two whose streets meet, before a guess at one street
  const words = t.split(' ');
  for (let cut = 1; cut < words.length && words.length <= 8; cut++) {
    const a = candidates(ix, words.slice(0, cut).join(' '), 3).filter((f) => f.score < 2), b = candidates(ix, words.slice(cut).join(' '), 3).filter((f) => f.score < 2);
    const hits = a.length && b.length ? corner(a, b).filter((h) => h.score < 2) : [];
    if (hits.length) return hits.slice(0, most);
  }
  return singles(all, near, 0).slice(0, most);
}
