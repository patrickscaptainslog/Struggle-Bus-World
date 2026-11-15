// The street index (docs/M1.md, task 8; docs/STUDIO.md part 7, system 6): every named street of a city by its name, so FLY TO A STREET can put the bus
// over one before any of its tiles is in. A city's tiles already carry their streets' names and centrelines (tiles.ts, 'SBT2'), but only tile by tile, as
// they stream. tools/streets/build.mjs reads them all and writes one small file beside city.json, streets.bin; this module is that file's format, read and
// written, and the search over it. Any city baked from OpenStreetMap gets one: nothing here knows San Francisco.
//
// Pure: no DOM, no three.js, nothing fetched. The page fetches `<city>/streets.bin` when the sheet opens and hands the bytes to parseStreets.
//
// The file ('SBS1', little-endian):
//   magic[4] 'SBS1', u16 quantum (dm: a coordinate's step), u16 streetCount, i32 x0, i32 z0 (m: the corner the coordinates count from)
//   streets, sorted by name: { u8 byteLength, utf-8 name (as signed: 'Guerrero St'), u8 pieceCount,
//     pieces: { u8 vertCount (2 or more), u16 x, u16 z (quanta from the corner), then vertCount - 1 of { i8 dx, i8 dz } (quanta from the vertex before) } }
// A piece is one unbroken run of the street, simplified; a street the map breaks (a park through it, a second town's Main St) has several, the longest first.
//
// The search takes what a thumb types: "guerrero", "Guerrero Street", "20th", "valenica" (a slip), "guerrero & 20th" (a corner, any of & / @ + and at).
// It answers with the streets it could mean, the likeliest first, each with a point on it: the corner when two streets were named and they cross, the
// point nearest `near` when the caller gives one (the bus), else the middle of its longest piece.

/** What a street's last word is written as, signed or typed: the key holds the short form, so "Street" finds "St". */
const SHORT: Record<string, string> = {
  street: 'st', str: 'st', avenue: 'ave', av: 'ave', boulevard: 'blvd', drive: 'dr', road: 'rd', lane: 'ln', court: 'ct', place: 'pl', terrace: 'ter', highway: 'hwy',
  alley: 'aly', circle: 'cir', parkway: 'pkwy', trail: 'trl', plaza: 'plz', square: 'sq', saint: 'st', mount: 'mt', fort: 'ft',
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th',
};
/** The words that say what kind of way it is: a name's last word, when it has another before it, is its kind and not its key. */
const KINDS = new Set(['st', 'ave', 'blvd', 'dr', 'rd', 'ln', 'ct', 'pl', 'ter', 'hwy', 'aly', 'cir', 'pkwy', 'trl', 'plz', 'sq', 'way', 'walk', 'path', 'row', 'loop', 'steps']);

export interface Street {
  /** as its sign has it: 'Guerrero St' */
  name: string;
  /** what it is found by: lower case, no accents or marks, short forms, without its kind: 'guerrero' */
  key: string;
  /** its kind, short ('st', 'ave'; '' for none: Broadway) */
  kind: string;
  /** its runs, the longest first: x, z pairs in the map's metres */
  pieces: Float32Array[];
  /** all its runs' length (m) */
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
  /** the other street of a corner, when two were named and they meet */
  cross: Street | null;
  /** where: the corner, the point nearest `near`, or the middle of the longest piece (map m) */
  x: number;
  z: number;
  /** 0 the name as typed; higher is a looser match (another kind, a longer name it begins, a slip of the thumb) */
  score: number;
}

/** A name or a query as the index keys it: its key and its kind. "The Embarcadero" is 'embarcadero'; "Lincoln Way" 'lincoln' of kind 'way'. */
export function streetKey(name: string): { key: string; kind: string } {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => SHORT[w] ?? w);
  if (words.length > 1 && words[0] === 'the') words.shift();
  let kind = '';
  if (words.length > 1 && KINDS.has(words[words.length - 1])) kind = words.pop()!;
  return { key: words.join(' '), kind };
}

/** A piece's length (m). */
function lengthOf(xz: Float32Array): number {
  let l = 0;
  for (let i = 2; i < xz.length; i += 2) l += Math.hypot(xz[i] - xz[i - 2], xz[i + 1] - xz[i - 1]);
  return l;
}

/**
 * The file's bytes for these streets (the builder's half). Pieces are x, z pairs in the map's metres; a coordinate is kept to `quantum` m. Streets are
 * written by name and each one's pieces longest first, so the same streets always make the same bytes. A piece with more than 255 vertices, or a step
 * longer than 127 quanta, is split or stepped: nothing is dropped. Names longer than 255 bytes, streets with no piece of two vertices, and more than
 * 65,535 streets or 255 pieces a street, throw: the builder should not hand them over.
 */
export function encodeStreets(streets: ReadonlyArray<{ name: string; pieces: ReadonlyArray<ArrayLike<number>> }>, quantum = 4): Uint8Array {
  const enc = new TextEncoder();
  let x0 = Infinity, z0 = Infinity;
  for (const s of streets)
    for (const p of s.pieces)
      for (let i = 0; i < p.length; i += 2) {
        x0 = Math.min(x0, p[i]);
        z0 = Math.min(z0, p[i + 1]);
      }
  x0 = Number.isFinite(x0) ? Math.floor(x0 / quantum) * quantum : 0;
  z0 = Number.isFinite(z0) ? Math.floor(z0 / quantum) * quantum : 0;
  const q = (v: number, o: number) => Math.round((v - o) / quantum);
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  const sorted = [...streets].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (sorted.length > 0xffff) throw new Error(`encodeStreets: ${sorted.length} streets`);
  for (const s of sorted) {
    const name = enc.encode(s.name);
    if (name.length === 0 || name.length > 255) throw new Error(`encodeStreets: a name of ${name.length} bytes`);
    // (each piece as quantised steps no longer than an i8, runs of at most 255 vertices; a step that quantises to nothing is left out)
    const runs: number[][] = [];
    for (const p of [...s.pieces].sort((a, b) => lengthOf(Float32Array.from(b)) - lengthOf(Float32Array.from(a)))) {
      const pts: number[] = [];
      for (let i = 0; i < p.length; i += 2) {
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
      for (let i = 0; i + 2 < pts.length; i += 254 * 2) runs.push(pts.slice(i, i + 255 * 2));
    }
    const kept = runs.filter((r) => r.length >= 4);
    if (kept.length === 0 || kept.length > 255) throw new Error(`encodeStreets: ${s.name} has ${kept.length} pieces`);
    out.push(name.length, ...name, kept.length);
    for (const r of kept) {
      out.push(r.length / 2);
      u16(r[0]);
      u16(r[1]);
      for (let i = 2; i < r.length; i += 2) out.push((r[i] - r[i - 2]) & 255, (r[i + 1] - r[i - 1]) & 255);
    }
  }
  const head = new Uint8Array(16), dv = new DataView(head.buffer);
  head.set([0x53, 0x42, 0x53, 0x31]);
  dv.setUint16(4, Math.round(quantum * 10), true);
  dv.setUint16(6, sorted.length, true);
  dv.setInt32(8, x0, true);
  dv.setInt32(12, z0, true);
  const bytes = new Uint8Array(16 + out.length);
  bytes.set(head);
  bytes.set(out, 16);
  return bytes;
}

/** The index from the file's bytes; null for a file that isn't one, or that ends early (the sheet then has no street search, and says nothing). */
export function parseStreets(buf: ArrayBuffer | Uint8Array): StreetIndex | null {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 16 || b[0] !== 0x53 || b[1] !== 0x42 || b[2] !== 0x53 || b[3] !== 0x31) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), dec = new TextDecoder();
  const quantum = dv.getUint16(4, true) / 10, count = dv.getUint16(6, true), x0 = dv.getInt32(8, true), z0 = dv.getInt32(12, true);
  if (!(quantum > 0)) return null;
  const streets: Street[] = [], byKey = new Map<string, Street[]>();
  let o = 16;
  for (let s = 0; s < count; s++) {
    if (o + 1 > b.length) return null;
    const len = b[o++];
    if (len === 0 || o + len + 1 > b.length) return null;
    const name = dec.decode(b.subarray(o, o + len));
    o += len;
    const pieces: Float32Array[] = [];
    let length = 0;
    for (let p = 0, n = b[o++]; p < n; p++) {
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
        xz[v * 2] = x0 + x * quantum;
        xz[v * 2 + 1] = z0 + z * quantum;
      }
      pieces.push(xz);
      length += lengthOf(xz);
    }
    if (pieces.length === 0) return null;
    const k = streetKey(name), street: Street = { name, key: k.key, kind: k.kind, pieces, length };
    streets.push(street);
    const list = byKey.get(k.key);
    if (list) list.push(street);
    else byKey.set(k.key, [street]);
  }
  for (const list of byKey.values()) list.sort((a, b) => b.length - a.length);
  return { streets, byKey };
}

/** A street's middle: the point of it nearest the middle of its longest piece's own weight (a piece that doubles back, an avenue's two sides run as one,
 *  has its half-way point at the far end; the point nearest its centre is in the middle of the street either way). */
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
  const p = nearestOn({ ...street, pieces: [xz] }, cx / all, cz / all);
  return { x: p.x, z: p.z };
}

/** The point of a street nearest (x, z), and how far that is (m). */
export function nearestOn(street: Street, x: number, z: number): { x: number; z: number; d: number } {
  const out = { x: street.pieces[0][0], z: street.pieces[0][1], d: Infinity };
  for (const xz of street.pieces)
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
  return out;
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

/** How many single slips (a letter wrong, missing, added, or two swapped) turn a into b, up to `most`; more is `most` + 1. */
function slips(a: string, b: string, most: number): number {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  let prev2: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1];
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (same ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      low = Math.min(low, v);
    }
    if (low > most) return most + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** The streets one typed name could mean, the likeliest first, each with how loose the match is (0: the name itself). At most `most`. */
function candidates(ix: StreetIndex, text: string, most: number): Array<{ street: Street; score: number }> {
  const q = streetKey(text);
  if (!q.key) return [];
  const out: Array<{ street: Street; score: number }> = [];
  const take = (list: readonly Street[], base: number) => {
    // (of a key's streets the kind typed first, "24th ave" before 24th St, and with no kind typed the one signed with none, "Burrows" before Burrows St;
    // then the longest)
    const ordered = [...list.filter((s) => s.kind === q.kind), ...list.filter((s) => s.kind !== q.kind)];
    for (const s of ordered) if (!out.some((o) => o.street === s)) out.push({ street: s, score: base + (q.kind && s.kind !== q.kind ? 0.5 : 0) });
  };
  // (a bare number is its ordinal's street: "20" is 20th)
  const keys = [q.key];
  if (/^\d+$/.test(q.key)) {
    const n = Number(q.key), t = n % 100;
    keys.push(`${n}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`);
  }
  // (the kind typed may be part of the name: "Great Highway" is keyed 'great', but "Park Presidio" is whole)
  if (q.kind) keys.push(`${q.key} ${q.kind}`);
  for (const k of keys) {
    const list = ix.byKey.get(k);
    if (list) take(list, 0);
  }
  if (out.length === 0) {
    // (a longer name it begins, the longest streets first: "van" finds Van Ness; then a slip of the thumb, by the name's length)
    const words: Street[] = [], begins: Street[] = [];
    if (q.key.length >= 3) for (const [k, list] of ix.byKey) if (k.startsWith(q.key)) (k[q.key.length] === ' ' ? words : begins).push(...list);
    take(words.sort((a, b) => b.length - a.length), 1);
    take(begins.sort((a, b) => b.length - a.length), 1.5);
  }
  if (out.length === 0 && q.key.length >= 4) {
    const may = q.key.length < 7 ? 1 : 2;
    const near: Array<{ list: Street[]; d: number }> = [];
    for (const [k, list] of ix.byKey) {
      const d = slips(q.key, k, may);
      if (d <= may) near.push({ list, d });
    }
    near.sort((a, b) => a.d - b.d || b.list[0].length - a.list[0].length);
    for (const n of near) take(n.list, 2 + n.d);
  }
  return out.slice(0, most);
}

/** a corner's two streets meet when they come this near (m): the index keeps one side of a wide avenue, simplified */
const MEETS = 30;

/**
 * What the typed text could mean: the streets, the likeliest first, each with a point on it (see the head comment). Two names joined by &, /, @, +, "and"
 * or "at" are a corner: answered with the corner where the two meet, else with the first street alone. Nothing found is an empty list. `near` is where
 * the bus is (map m), for the point on a long street and between two streets of one name. At most `most` answers (5).
 */
export function findStreet(ix: StreetIndex, text: string, near?: { x: number; z: number }, most = 5): StreetHit[] {
  const parts = text.split(/\s*(?:&|\/|@|\+|\band\b|\bat\b)\s*/i).filter((p) => streetKey(p).key);
  const first = candidates(ix, parts[0] ?? '', most);
  const hits: StreetHit[] = [];
  if (parts.length >= 2) {
    const second = candidates(ix, parts[1], most);
    for (const a of first)
      for (const b of second) {
        if (a.street === b.street) continue;
        const c = crossing(a.street, b.street);
        if (c.d <= MEETS) hits.push({ street: a.street, cross: b.street, x: c.x, z: c.z, score: a.score + b.score });
      }
    hits.sort((p, q) => p.score - q.score);
  }
  if (hits.length === 0)
    for (const a of first) {
      const p = near ? nearestOn(a.street, near.x, near.z) : middleOf(a.street);
      hits.push({ street: a.street, cross: null, x: p.x, z: p.z, score: a.score });
    }
  return hits.slice(0, most);
}
