// The saved city, and what a postcard does to it (docs/specs/core/LINK.md, "The save" on). A square's record is today's 16 bytes (areas.ts's `encode`, byte
// for byte) and 8 more: `rev`, which says which of two records of one square is the later, and the card that put it there. Two saves of one city join into
// one whatever order they are joined in, so two tabs, a journal and a database can't disagree for long. A card lands once a phone, and what it lands is the
// sender's: every square it names becomes the card's, whatever stood there, so the order tiles load in changes nothing. A tile only ever gives a record
// its anchor, and makes one from the phone's own old building paint where there is none. Pure and worker-safe; the stores themselves (localStorage in M1,
// IndexedDB in M2's task 13) sit behind `SaveBackend`.

import { beats, cardSeconds, decode, dealCrew, wornBy, linkTune, mapOf } from './link';
import type { Beat, Card, CardSquare, Read, Visit } from './link';

/** bytes a square */
export const REC = 24;
/** `ay` of a record no tile has given its anchor yet */
export const NO_ANCHOR = -32768;
/** a clock past this (2100-01-01, epoch s) is a broken clock: it is not believed. No `rev` goes past it, and a record that says one does is no record */
export const CLOCK_TOP = 4102444800;
const REV_TOP = CLOCK_TOP;

export const saveTune = {
  /** the cards a phone remembers whole: ones it sent, and ones it opened */
  sent: 192,
  opened: 64,
  /** and the short ids of this many more (8 bytes each), so that a card whose note has been let go still never lands twice */
  seen: 1024,
  /** the climbs it keeps for a card's order */
  climbs: 512,
  /** old building paint makes a record this high at most (STAGES.md 1.5, "Old saves") */
  oldTop: 3,
  /** the key one city's save is kept under in a Storage */
  key: (slug: string): string => `strugglebus.city.v2:${slug}`,
};

export const packSquare = (ix: number, iz: number): number => (((ix & 0xffff) << 16) | (iz & 0xffff)) >>> 0;
export const squareIx = (key: number): number => ((key >>> 16) << 16) >> 16;
export const squareIz = (key: number): number => ((key & 0xffff) << 16) >> 16;

/** One square, saved. */
export interface Rec {
  key: number;
  /** the crew whose it is: 1 to 15 */
  owner: number;
  /** 1 to 4, and 5 at a heart where a god stands */
  stage: number;
  cracks: number;
  hits: number;
  /** epoch s of its owner's last landed hit */
  tended: number;
  /** where its things stand (m in the square) and the ground's height (dm); `ay` is NO_ANCHOR until a tile has said */
  ax: number;
  az: number;
  ay: number;
  /** epoch s of its last change on some phone, always past the one before: the later record of a square stands */
  rev: number;
  /** the card that has been on this square (its id30), -1 for none. It never lands here twice */
  card: number;
  /** put here by a card, and not taken since */
  guest: boolean;
}

/** A landmark, saved: the square's fields that mean anything on one. */
export interface MarkRec {
  owner: number;
  stage: number;
  cracks: number;
  hits: number;
  tended: number;
  rev: number;
  card: number;
}

/** A card this phone knows: one it sent, or one it opened. */
export interface Note {
  /** what makes it this card (link.ts's `Read.id`) */
  id: string;
  id30: number;
  /** 'out' this phone sent it, 'in' it was opened here */
  role: 'in' | 'out';
  /** the card's text, to send it again as it was (an opened card read with its order lost: what was read, until the whole card is opened) */
  text: string;
  /** epoch s it was sent, or first opened */
  at: number;
  gen: number;
  place: string;
  /** the card's own square */
  key: number;
  /** the sender's crew */
  crew: number;
  /** epoch s it was taken back, 0 while it stands */
  taken: number;
  /** the card it answers, -1 for none */
  answers: number;
}

/**
 * One counted change of a square's owner or stage: when (ms, and always past the climb before it on the same phone, so that two in one second keep
 * their order and a clock put back changes nothing), where, and `owner << 4 | stage` after it.
 */
export type Climb = [t: number, key: number, v: number];

/** Everything saved of one city. */
export interface Save {
  squares: Map<number, Rec>;
  marks: Map<string, MarkRec>;
  notes: Map<string, Note>;
  /** the player's crew, 0 until one is picked or dealt, and when it was set */
  crew: { value: number; rev: number };
  /** the last climbs, in order: where a card's order comes from */
  climbs: Climb[];
  /** how many older climbs have been let go: past 0, a stage with no climb kept was reached "long ago" */
  forgot: number;
  /** every card this phone has sent or opened, by its id30: when it was first known here (epoch s) */
  seen: Map<number, number>;
}

export function emptySave(): Save {
  return { squares: new Map(), marks: new Map(), notes: new Map(), crew: { value: 0, rev: 0 }, climbs: [], forgot: 0, seen: new Map() };
}

/** Any clock as whole epoch seconds a record can hold: one given in milliseconds is taken as such; nonsense, and a clock past 2100, is 0. */
export function seconds(now: unknown): number {
  let t = typeof now === 'number' && Number.isFinite(now) ? now : 0;
  if (t >= 1e11) t /= 1000;
  return t < 0 || t > CLOCK_TOP ? 0 : Math.floor(t);
}
/**
 * The `rev` of a change made now to a record that was `old`: now, or one past what was known where the clock has been put back or is not to be
 * believed. Never 0: that is old paint's. `more` is a change that only adds to what was there (an encore: hits, and tended, up, nothing else): it
 * stands over the old record by its own fields at the same `rev`, so it needs no step past it, and a square tapped five times a second doesn't run
 * its `rev` ahead of the clock.
 */
export function nextRev(old: { rev: number } | undefined | null, now: unknown, more = false): number {
  return Math.min(REV_TOP, Math.max(seconds(now), old ? old.rev + (more ? 0 : 1) : 1));
}

// ---- a record's bytes ----

/** One record as its 24 bytes: areas.ts's 16, then `rev`, then the card (bit 31 guest, bit 30 a card has been here, bits 0 to 29 its id30). */
export function pack(r: Rec, out: Uint8Array = new Uint8Array(REC), o = 0): Uint8Array {
  const v = new DataView(out.buffer, out.byteOffset + o, REC);
  v.setUint32(0, r.key, true);
  v.setUint8(4, r.owner);
  v.setUint8(5, r.stage | (Math.min(15, r.cracks) << 4));
  v.setUint16(6, Math.min(0xffff, r.hits), true);
  v.setUint32(8, r.tended >>> 0, true);
  v.setUint8(12, r.ax & 0xff);
  v.setUint8(13, r.az & 0xff);
  v.setInt16(14, r.ay, true);
  v.setUint32(16, r.rev >>> 0, true);
  v.setUint32(20, r.card < 0 ? 0 : ((r.guest ? 3 : 1) * 2 ** 30 + r.card) >>> 0, true);
  return out;
}
/** Bytes as a record, or null for ones that make none: a crew or a stage that doesn't exist, an anchor off its square, a guest no card brought. */
export function unpack(b: Uint8Array, o = 0): Rec | null {
  if (o < 0 || o + REC > b.length) return null;
  const v = new DataView(b.buffer, b.byteOffset + o, REC);
  const sb = v.getUint8(5), stage = sb & 15, owner = v.getUint8(4), via = v.getUint32(20, true);
  const has = Math.floor(via / 2 ** 30) % 2 === 1, guest = via >= 2 ** 31;
  if (owner < 1 || owner > 15 || stage < 1 || stage > 5 || v.getUint32(16, true) > REV_TOP) return null;
  const ax = v.getUint8(12), az = v.getUint8(13), ay = v.getInt16(14, true);
  if (ay !== NO_ANCHOR && (ax > 127 || az > 127)) return null;
  if (ay === NO_ANCHOR && (ax || az)) return null;
  if ((guest && !has) || (!has && via !== 0)) return null;
  return { key: v.getUint32(0, true), owner, stage, cracks: sb >> 4, hits: v.getUint16(6, true), tended: v.getUint32(8, true), ax, az, ay, rev: v.getUint32(16, true), card: has ? via % 2 ** 30 : -1, guest };
}

const anchorRank = (r: Rec): number => (r.ay === NO_ANCHOR ? -1 : (r.ay + 32768) * 65536 + r.ax * 256 + r.az);
const viaOf = (r: Rec): number => (r.card < 0 ? 0 : (r.guest ? 3 : 1) * 2 ** 30 + r.card);
/** which of two records of one square is the later: by `rev`, and where that ties by their own fields, so that both phones pick the same one */
function later(a: Rec, b: Rec): number {
  return a.rev - b.rev || a.owner - b.owner || a.stage - b.stage || a.cracks - b.cracks || a.hits - b.hits || a.tended - b.tended || viaOf(a) - viaOf(b);
}
/**
 * Two records of one square as one: the later stands, with the anchor of whichever has one (a tile's word, the same on every phone). No order in it:
 * join(a, b) is join(b, a), joining three either way round is the same, and a record joined with itself is itself.
 */
export function joinRec(a: Rec | undefined, b: Rec | undefined): Rec | undefined {
  if (!a || !b) return a ?? b;
  const win = later(a, b) >= 0 ? a : b, anchor = anchorRank(a) >= anchorRank(b) ? a : b;
  if (anchor.ax === win.ax && anchor.az === win.az && anchor.ay === win.ay) return win;
  return { ...win, ax: anchor.ax, az: anchor.az, ay: anchor.ay };
}

/** Two records of one landmark as one: the later stands. */
export function joinMark(a: MarkRec | undefined, b: MarkRec | undefined): MarkRec | undefined {
  if (!a || !b) return a ?? b;
  const c = a.rev - b.rev || a.owner - b.owner || a.stage - b.stage || a.cracks - b.cracks || a.hits - b.hits || a.tended - b.tended || a.card - b.card;
  return c >= 0 ? a : b;
}
const longer = (a: string, b: string): string => (a.length !== b.length ? (a.length > b.length ? a : b) : a >= b ? a : b);
/** One card's two notes as one: sent beats opened, the first time it was seen, the fuller text, taken once it has been on either. */
export function joinNote(a: Note | undefined, b: Note | undefined): Note | undefined {
  if (!a || !b) return a ?? b;
  return {
    id: a.id, id30: Math.max(a.id30, b.id30), role: a.role === 'out' || b.role === 'out' ? 'out' : 'in', text: longer(a.text, b.text), at: Math.min(a.at, b.at),
    gen: Math.min(a.gen, b.gen), place: a.place >= b.place ? a.place : b.place, key: Math.max(a.key, b.key), crew: Math.max(a.crew, b.crew),
    taken: Math.max(a.taken, b.taken), answers: Math.max(a.answers, b.answers),
  };
}
const climbOrder = (a: Climb, b: Climb): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function sortedClimbs(list: Climb[]): Climb[] {
  const all = list.slice().sort(climbOrder);
  return all.filter((c, i) => !i || climbOrder(all[i - 1], c) !== 0);
}

/**
 * Two saves of one city as one, with no order in it (the three laws of `joinRec` hold for the whole save): what a flush does with what is stored, and a
 * tab with what another tab wrote. Nothing is dropped here; `trim` does that, when a save is written.
 */
export function joinSave(a: Save, b: Save): Save {
  const out = emptySave();
  for (const k of new Set([...a.squares.keys(), ...b.squares.keys()])) out.squares.set(k, joinRec(a.squares.get(k), b.squares.get(k))!);
  for (const k of new Set([...a.marks.keys(), ...b.marks.keys()])) out.marks.set(k, joinMark(a.marks.get(k), b.marks.get(k))!);
  for (const k of new Set([...a.notes.keys(), ...b.notes.keys()])) out.notes.set(k, joinNote(a.notes.get(k), b.notes.get(k))!);
  out.crew = (a.crew.rev - b.crew.rev || a.crew.value - b.crew.value) >= 0 ? { ...a.crew } : { ...b.crew };
  out.climbs = sortedClimbs([...a.climbs, ...b.climbs]);
  out.forgot = Math.max(a.forgot, b.forgot);
  for (const [id, at] of [...a.seen, ...b.seen]) out.seen.set(id, Math.min(at, out.seen.get(id) ?? at));
  return out;
}

/** Note that this phone knows a card (sent or opened). */
function know(save: Save, id30: number, now: unknown): void {
  if (!num(id30, 0, 2 ** 30 - 1)) return;
  const at = seconds(now);
  save.seen.set(id30, Math.min(at, save.seen.get(id30) ?? at));
}

/**
 * A save held to what a phone keeps: the newest `climbs` climbs; `opened` opened cards (those none of whose squares still carry them go first, then
 * the oldest) and `sent` sent ones (the oldest go). The two kinds have a cap each, so no number of sent cards can push out the card a friend's
 * squares came by.
 */
export function trim(save: Save): Save {
  if (save.climbs.length > saveTune.climbs) {
    save.forgot = Math.min(0xffffffff, save.forgot + save.climbs.length - saveTune.climbs);
    save.climbs = save.climbs.slice(save.climbs.length - saveTune.climbs);
  }
  const carried = new Set<number>();
  for (const r of save.squares.values()) if (r.card >= 0) carried.add(r.card);
  const byAge = (p: Note, q: Note): number => p.at - q.at || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
  const sent = [...save.notes.values()].filter((n) => n.role === 'out').sort(byAge);
  const opened = [...save.notes.values()].filter((n) => n.role === 'in').sort((p, q) => (carried.has(p.id30) ? 1 : 0) - (carried.has(q.id30) ? 1 : 0) || byAge(p, q));
  for (let i = 0; i < sent.length - saveTune.sent; i++) save.notes.delete(sent[i].id);
  for (let i = 0; i < opened.length - saveTune.opened; i++) save.notes.delete(opened[i].id);
  if (save.seen.size > saveTune.seen) {
    const keep = [...save.seen].sort((p, q) => q[1] - p[1] || q[0] - p[0]).slice(0, saveTune.seen);
    for (const n of save.notes.values()) if (!keep.some((k) => k[0] === n.id30)) keep.push([n.id30, save.seen.get(n.id30) ?? n.at]);
    save.seen = new Map(keep);
  }
  return save;
}

// ---- the save as text ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64V = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64V[B64.charCodeAt(i)] = i;
/** bytes as base64. The save writes whole numbers of 3 bytes, so no padding, and one record is one run of characters */
function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}
/** `chars` characters of base64 from `at` as bytes (a multiple of 4, unpadded), or null where one of them is no base64 */
function chunk(s: string, at: number, chars: number): Uint8Array | null {
  const out = new Uint8Array((chars / 4) * 3);
  for (let i = 0, o = 0; i < chars; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = s.charCodeAt(at + i + k), v = c < 128 ? B64V[c] : -1;
      if (v < 0) return null;
      n = n * 64 + v;
    }
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  return out;
}

/** The squares as bytes, by key: 24 a square. */
export function squaresBytes(squares: Map<number, Rec>): Uint8Array {
  const keys = [...squares.keys()].sort((p, q) => p - q), out = new Uint8Array(keys.length * REC);
  keys.forEach((k, i) => pack(squares.get(k)!, out, i * REC));
  return out;
}
/** The same squares as areas.ts's own save, 16 bytes each: what `Areas.decode` reads. A record with no anchor yet says 0, 0, 0, as the engine does. */
export function areasText(squares: Map<number, Rec>): string {
  const keys = [...squares.keys()].sort((p, q) => p - q), out = new Uint8Array(keys.length * 16), full = new Uint8Array(REC);
  keys.forEach((k, i) => {
    pack(squares.get(k)!, full);
    out.set(full.subarray(0, 16), i * 16);
    if (squares.get(k)!.ay === NO_ANCHOR) out.fill(0, i * 16 + 12, i * 16 + 16);
  });
  return toBase64(out);
}
/**
 * areas.ts's save (strugglebus.areas.v1) as records, for a phone's first run of this one: `rev` 0, so anything newer stands over them. A square it can't
 * read is left out and counted; an anchor no square could have (the engine never wrote one) is read as none. Null for a text that is no such save.
 */
export function fromAreasText(text: unknown): { squares: Map<number, Rec>; lost: number } | null {
  if (typeof text !== 'string' || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0, whole = chunk(text.replace(/=/g, 'A'), 0, text.length);
  if (!whole || (whole.length - pad) % 16) return null;
  const squares = new Map<number, Rec>(), full = new Uint8Array(REC), view = new DataView(full.buffer);
  let lost = 0;
  for (let o = 0; o + 16 <= whole.length - pad; o += 16) {
    full.fill(0);
    full.set(whole.subarray(o, o + 16));
    if (full[12] > 127 || full[13] > 127 || view.getInt16(14, true) === NO_ANCHOR || (!full[12] && !full[13] && !full[14] && !full[15])) {
      full[12] = full[13] = 0;
      view.setInt16(14, NO_ANCHOR, true);
    }
    const r = unpack(full);
    if (r) squares.set(r.key, r);
    else lost++;
  }
  return { squares, lost };
}

const MAGIC = 'SBW2';
/** base64 characters a square (24 bytes) and a climb (15: its time as a float, its square, its owner and stage, two spare) */
const SQ_CHARS = 32, CLIMB_BYTES = 15, CLIMB_CHARS = 20;
/** and a card known (9 bytes: its id30, when, one spare) */
const SEEN_CHARS = 12;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const MARK_KEY = /^[a-z0-9-]{1,16}$/;

/** The whole save as one text of seven lines, the same text for the same save: what a Storage holds, and what two saves are compared by. */
export function saveText(save: Save): string {
  const marks: Record<string, number[]> = {};
  for (const k of [...save.marks.keys()].sort()) {
    const m = save.marks.get(k)!;
    marks[k] = [m.owner, m.stage, m.cracks, m.hits, m.tended, m.rev, m.card];
  }
  const notes = [...save.notes.values()].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
    .map((n) => [n.id, n.id30, n.role === 'out' ? 1 : 0, n.text, n.at, n.gen, n.place, n.key, n.crew, n.taken, n.answers]);
  const list = sortedClimbs(save.climbs), climbs = new Uint8Array(list.length * CLIMB_BYTES), v = new DataView(climbs.buffer);
  list.forEach((c, i) => (v.setFloat64(i * CLIMB_BYTES, c[0], true), v.setUint32(i * CLIMB_BYTES + 8, c[1], true), v.setUint8(i * CLIMB_BYTES + 12, c[2])));
  const ids = [...save.seen.keys()].sort((p, q) => p - q), seen = new Uint8Array(ids.length * 9), sv = new DataView(seen.buffer);
  ids.forEach((id, i) => (sv.setUint32(i * 9, id, true), sv.setUint32(i * 9 + 4, save.seen.get(id)!, true)));
  return [MAGIC, toBase64(squaresBytes(save.squares)), JSON.stringify(marks), JSON.stringify(notes), JSON.stringify([save.crew.value, save.crew.rev, save.forgot]), toBase64(climbs), toBase64(seen)].join('\n');
}

/**
 * A text as a save. Total: what can't be read is left out and counted in `lost`, record by record, so one bad character never costs the city (a square
 * is 32 characters of its line, and a bad one costs that square). A text that isn't a save at all is an empty one with `lost` -1.
 */
export function parseSave(text: unknown): { save: Save; lost: number } {
  const save = emptySave();
  if (typeof text !== 'string') return { save, lost: -1 };
  const line = text.split('\n');
  if (line[0] !== MAGIC) return { save, lost: -1 };
  let lost = 0;
  const sq = line[1] ?? '';
  for (let at = 0; at + SQ_CHARS <= sq.length; at += SQ_CHARS) {
    const b = chunk(sq, at, SQ_CHARS), r = b ? unpack(b) : null;
    if (r) save.squares.set(r.key, joinRec(save.squares.get(r.key), r)!);
    else lost++;
  }
  if (sq.length % SQ_CHARS) lost++;
  const json = (s: string | undefined): unknown => {
    try {
      return JSON.parse(s ?? '');
    } catch {
      lost++;
      return null;
    }
  };
  const marks = json(line[2]);
  if (marks && typeof marks === 'object' && !Array.isArray(marks))
    for (const k of Object.keys(marks)) {
      const m = (marks as Record<string, unknown>)[k];
      if (MARK_KEY.test(k) && Array.isArray(m) && m.length === 7 && num(m[0], 1, 15) && num(m[1], 1, 5) && num(m[2], 0, 15) && num(m[3], 0, 0xffff) && num(m[4], 0, 0xffffffff) && num(m[5], 0, REV_TOP) && num(m[6], -1, 2 ** 30 - 1))
        save.marks.set(k, { owner: m[0], stage: m[1], cracks: m[2], hits: m[3], tended: m[4], rev: m[5], card: m[6] });
      else lost++;
    }
  const notes = json(line[3]);
  if (Array.isArray(notes))
    for (const n of notes) {
      if (Array.isArray(n) && n.length === 11 && typeof n[0] === 'string' && n[0] && num(n[1], 0, 2 ** 30 - 1) && (n[2] === 0 || n[2] === 1) && typeof n[3] === 'string' && num(n[4], 0, 0xffffffff) && num(n[5], 0, linkTune.gen) && typeof n[6] === 'string' && num(n[7], 0, 0xffffffff) && num(n[8], 1, 15) && num(n[9], 0, 0xffffffff) && num(n[10], -1, 2 ** 30 - 1)) {
        const note: Note = { id: n[0], id30: n[1], role: n[2] ? 'out' : 'in', text: n[3], at: n[4], gen: n[5], place: n[6], key: n[7], crew: n[8], taken: n[9], answers: n[10] };
        save.notes.set(note.id, joinNote(save.notes.get(note.id), note)!);
      } else lost++;
    }
  const crew = json(line[4]);
  if (Array.isArray(crew) && crew.length === 3 && num(crew[0], 0, 15) && num(crew[1], 0, 0xffffffff) && num(crew[2], 0, 0xffffffff)) {
    save.crew = { value: crew[0], rev: crew[1] };
    save.forgot = crew[2];
  } else if (crew !== null) lost++;
  const cl = line[5] ?? '', climbs: Climb[] = [];
  for (let at = 0; at + CLIMB_CHARS <= cl.length; at += CLIMB_CHARS) {
    const b = chunk(cl, at, CLIMB_CHARS), v = b ? new DataView(b.buffer) : null, t = v ? v.getFloat64(0, true) : -1;
    if (v && Number.isInteger(t) && t >= 0 && t <= Number.MAX_SAFE_INTEGER) climbs.push([t, v.getUint32(8, true), v.getUint8(12)]);
    else lost++;
  }
  if (cl.length % CLIMB_CHARS) lost++;
  save.climbs = sortedClimbs(climbs);
  const sn = line[6] ?? '';
  for (let at = 0; at + SEEN_CHARS <= sn.length; at += SEEN_CHARS) {
    const b = chunk(sn, at, SEEN_CHARS), v = b ? new DataView(b.buffer) : null, id = v ? v.getUint32(0, true) : -1;
    if (v && num(id, 0, 2 ** 30 - 1)) save.seen.set(id, Math.min(v.getUint32(4, true), save.seen.get(id) ?? Infinity));
    else lost++;
  }
  if (sn.length % SEEN_CHARS) lost++;
  return { save, lost };
}

/** Where a save is kept: a Storage's one key in M1, the database in M2. `read` gives null where there is nothing; `write` says whether it took. */
export interface SaveBackend {
  read(): string | null;
  write(text: string): boolean;
}
/** A Storage (localStorage, or a stand-in) as a backend for one city. A Storage that throws (private browsing, a full disk) reads as empty and writes as failed. */
export function storageBackend(store: Pick<Storage, 'getItem' | 'setItem'>, slug: string): SaveBackend {
  const key = saveTune.key(slug);
  return {
    read() {
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    write(text) {
      try {
        store.setItem(key, text);
        return true;
      } catch {
        return false;
      }
    },
  };
}
/** What is stored, read: an empty save where there is nothing. `lost` as `parseSave` counts it (-1: something is stored that is no save). */
export function loadSave(backend: SaveBackend): { save: Save; lost: number } {
  const stored = backend.read();
  return stored === null ? { save: emptySave(), lost: 0 } : parseSave(stored);
}
/**
 * Write a save: what is stored is read and joined in first, so a second tab's work is never written over, and the joined save is what this tab goes on
 * with. Call it on a change's debounce, on `pagehide`, and when a tab comes back into view (to pick up what another wrote). `lost` is what of the stored
 * text could not be read (it is written over all the same: what this tab holds is the best there is).
 */
export function flush(mem: Save, backend: SaveBackend, now?: unknown): { save: Save; wrote: boolean; lost: number } {
  const stored = loadSave(backend), save = joinSave(mem, stored.save);
  rewear(save, now);
  trim(save);
  return { save, wrote: backend.write(saveText(save)), lost: stored.lost };
}

/** The squares whose record in `after` isn't what `before` had: what a tab shows anew after a flush brought in another tab's work. */
export function changedSquares(before: Save, after: Save): Rec[] {
  const out: Rec[] = [];
  for (const r of after.squares.values()) {
    const o = before.squares.get(r.key);
    if (!o || later(o, r) !== 0 || anchorRank(o) !== anchorRank(r)) out.push(r);
  }
  return out;
}

// ---- the crew ----

/** The crew this phone paints as: its own, and Rainbow until it has one. */
export const crewOf = (save: Save): number => save.crew.value || 1;

/**
 * No square a card left may wear the player's own crew, or there would be nothing to take back: one that does (the player changed crew, or two tabs
 * were dealt two crews) moves on round the wheel. Returns the records it changed.
 */
export function rewear(save: Save, now?: unknown, crews: number = linkTune.crews): Rec[] {
  const mine = save.crew.value, out: Rec[] = [];
  if (!mine) return out;
  for (const r of save.squares.values())
    if (r.guest && r.owner === mine) {
      const rec: Rec = { ...r, owner: wornBy(r.owner, mine, crews), rev: nextRev(r, now) };
      save.squares.set(r.key, rec);
      out.push(rec);
    }
  return out;
}
/** The player picks a crew (the faction button). Returns the cards' squares that had to change theirs. */
export function setCrew(save: Save, crew: number, now: unknown, crews: number = linkTune.crews): Rec[] {
  if (!num(crew, 1, crews) || crew === save.crew.value) return [];
  save.crew = { value: crew, rev: nextRev(save.crew, now) };
  return rewear(save, now, crews);
}

// ---- the engine's side ----

/** A square's anchor as a tile that is in right now has it, or null where its tile isn't in: a record made after its tile landed takes it at once. */
export type Ground = (key: number) => { ax: number; az: number; ay: number } | null;
function settle(r: Rec, ground: Ground | undefined): Rec {
  const g = r.ay === NO_ANCHOR && ground ? ground(r.key) : null;
  if (g && g.ay !== NO_ANCHOR) {
    r.ax = Math.max(0, Math.min(127, g.ax | 0));
    r.az = Math.max(0, Math.min(127, g.az | 0));
    r.ay = Math.max(-32767, Math.min(32767, g.ay | 0));
  }
  return r;
}

/** The fields of areas.ts's `Area` a record keeps. */
export interface AreaLike {
  key: number;
  faction: number;
  stage: number;
  cracks: number;
  hits: number;
  tended: number;
}
/**
 * After the engine changes a square (areas.ts's `onChange`): its record now. The anchor and the card that was here are kept; `guest` lasts until the
 * square changes hands. The engine changes a square only while its tile is in, so `ground` has its anchor. A square the engine calls grey is left as it
 * is saved (nothing in the game turns a square grey, and a save can't forget one: another tab would bring it back).
 */
export function touch(save: Save, a: AreaLike, now: unknown, ground?: Ground): Rec | null {
  const old = save.squares.get(a.key);
  if (!num(a.faction, 1, 15) || !num(a.stage, 1, 5)) return null;
  const rec: Rec = {
    key: a.key, owner: a.faction, stage: a.stage, cracks: Math.max(0, Math.min(15, a.cracks | 0)), hits: Math.max(0, Math.min(0xffff, a.hits | 0)), tended: seconds(a.tended),
    ax: old ? old.ax : 0, az: old ? old.az : 0, ay: old ? old.ay : NO_ANCHOR, rev: 0, card: old ? old.card : -1,
    guest: !!old && old.guest && old.owner === a.faction,
  };
  const more = !!old && old.owner === rec.owner && old.stage === rec.stage && old.cracks === rec.cracks && old.guest === rec.guest && rec.hits >= old.hits && rec.tended >= old.tended;
  rec.rev = nextRev(old, now, more);
  // (a record no change on this phone has made: old paint, or the save before this one. Its stages were reached long ago, and go first in a card's order)
  if (old && old.rev === 0) longAgo(save, old);
  if (!old || old.owner !== rec.owner || old.stage !== rec.stage) noteClimb(save, now, rec.key, rec.owner, rec.stage);
  save.squares.set(rec.key, settle(rec, ground));
  return rec;
}

/**
 * A landmark's record after the game changes it (the door's crown): by the landmark's key in any case, saved in lower case. Null for a key no card
 * could carry.
 */
export function touchMark(save: Save, key: string, a: Omit<AreaLike, 'key'>, now: unknown): MarkRec | null {
  const k = String(key).toLowerCase(), old = save.marks.get(k);
  if (!MARK_KEY.test(k) || !num(a.faction, 1, 15) || !num(a.stage, 1, 5)) return null;
  const rec: MarkRec = { owner: a.faction, stage: a.stage, cracks: Math.max(0, Math.min(15, a.cracks | 0)), hits: Math.max(0, Math.min(0xffff, a.hits | 0)), tended: seconds(a.tended), rev: nextRev(old, now), card: old ? old.card : -1 };
  save.marks.set(k, rec);
  return rec;
}

/** A record's stages as one climb before every other: what a square had before this save knew it. Once a square, whatever the order things happen in. */
function longAgo(save: Save, r: Rec): void {
  const c: Climb = [0, r.key >>> 0, ((r.owner & 15) << 4) | (r.stage & 15)];
  let i = 0;
  while (i < save.climbs.length && save.climbs[i][0] === 0 && climbOrder(save.climbs[i], c) < 0) i++;
  if (i < save.climbs.length && climbOrder(save.climbs[i], c) === 0) return;
  if (save.climbs.some((x) => x[0] === 0 && x[1] === c[1])) return;
  save.climbs.splice(i, 0, c);
}

/** Note a counted change of a square's owner or stage. Its time is the clock's in ms, or 1 past the last climb's where the clock hasn't moved on. */
export function noteClimb(save: Save, now: unknown, key: number, owner: number, stage: number): void {
  let t = typeof now === 'number' && Number.isFinite(now) && now > 0 ? now : 0;
  if (t < 1e11) t *= 1000;
  const last = save.climbs.length ? save.climbs[save.climbs.length - 1][0] : 0;
  save.climbs.push([Math.min(Number.MAX_SAFE_INTEGER, Math.max(Math.floor(t > CLOCK_TOP * 1000 ? 0 : t), last + 1)), key >>> 0, ((owner & 15) << 4) | (stage & 15)]);
}

/**
 * The order these squares climbed in, for a card: an index into `squares` for every stage of every square, as link.ts's `order` wants it. From the
 * climbs still kept. Once climbs have been let go (`forgot`), the stages below the first climb a square still has were reached long ago, and go first.
 * Always an order a card can carry.
 */
export function orderFrom(save: Pick<Save, 'climbs' | 'forgot'>, squares: readonly CardSquare[], crew: number): number[] {
  const idx = new Map(squares.map((q, i) => [packSquare(q.ix, q.iz), i])), when: number[][] = squares.map(() => []), cur = squares.map(() => 0), met = squares.map(() => false);
  save.climbs.forEach(([, key, v], p) => {
    const i = idx.get(key);
    if (i === undefined) return;
    const stage = v & 15, first = !met[i];
    met[i] = true;
    if (v >> 4 !== crew) {
      when[i].length = 0;
      cur[i] = 0;
      return;
    }
    if (stage > cur[i]) for (let s = cur[i] + 1; s <= stage; s++) when[i][s] = first && save.forgot > 0 && s < stage ? -1 : p;
    else when[i].length = stage + 1;
    cur[i] = stage;
  });
  const hits: [number, number, number][] = [];
  squares.forEach((q, i) => {
    let t = -1;
    for (let s = 1; s <= q.stage; s++) {
      t = Math.max(t, when[i][s] ?? -1);
      hits.push([t, i, s]);
    }
  });
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return hits.map((h) => h[1]);
}

// ---- a tile lands ----

/** One square as a tile that has loaded knows it: its anchor, and the phone's own old building paint on it (0 for none: its highest level, and whose). */
export interface TileSquare {
  key: number;
  ax: number;
  az: number;
  ay: number;
  old: number;
  oldCrew?: number;
}
/**
 * A tile has loaded. All it may do is a matter of each square's own record and the tile's own data, the same every time it lands: where there is no
 * record, the phone has old building paint there and the ground can be lifted, one is made (stage as the paint's, 3 at most, `rev` 0, so anything else
 * stands over it); and a record with no anchor takes the tile's. It never changes whose a square is or how high. Returns the records it made or changed.
 */
export function landTile(save: Save, squares: readonly TileSquare[], frame: Pick<Frame, 'top'>): Rec[] {
  const changed: Rec[] = [];
  for (const q of squares) {
    const top = frame.top(q.key);
    let r = save.squares.get(q.key);
    if (!r && q.old > 0 && top >= 1) {
      const stage = Math.min(saveTune.oldTop, Math.floor(q.old), top);
      r = { key: q.key, owner: num(q.oldCrew, 1, 15) ? q.oldCrew : 1, stage, cracks: 0, hits: stage, tended: 0, ax: 0, az: 0, ay: NO_ANCHOR, rev: 0, card: -1, guest: false };
      save.squares.set(q.key, r);
      changed.push(r);
    }
    if (r && r.ay === NO_ANCHOR && q.ay !== NO_ANCHOR) {
      settle(r, () => q);
      if (changed[changed.length - 1] !== r) changed.push(r);
    }
  }
  return changed;
}

/** The 3 x 3 tiles (256 m, two squares a side) round a square's own: what a landing loads first. */
export function nineTiles(key: number): [tx: number, tz: number][] {
  const tx = Math.floor(squareIx(key) / 2), tz = Math.floor(squareIz(key) / 2), out: [number, number][] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push([tx + dx, tz + dz]);
  return out;
}

// ---- a card lands ----

/** The city as a landing needs it, all of it from files a page has before any tile (city.json and hoods.bin), so no answer waits on a tile. */
export interface Frame {
  /** this city's number on a card: 0 is San Francisco (link.ts's MAPS) */
  map: number;
  crews: number;
  /** is this square on the map at all */
  inside(key: number): boolean;
  /** a square's top stage: 0 where nothing can be lifted (water, off the map), 3 where the map tags it, else 4 */
  top(key: number): number;
  /** a page name's own square (a neighbourhood's heart, a landmark's square), -1 for none */
  place(slug: string): number;
  /** the page name of the neighbourhood a square is in, '' for none: the <place> of a card sent from there */
  pageOf(key: number): string;
  /** a landmark's square by its key in lower case, -1 where the city has none of that name */
  mark(key: string): number;
}

/**
 * A city's frame from its two small files: city.json's slug, bounds ([x0, z0, x1, z1], m) and landmarks, and hoods.bin's table (src/world/hoods.ts).
 * `top` is the engine's own word on a square's top stage where the host has one (areas.ts's `topOf`): the frame and the engine must not disagree.
 */
export function frameFrom(
  city: { slug: string; bounds: readonly number[]; landmarks?: readonly { kind: string; x: number; z: number }[] },
  hoods: { names: readonly string[]; hearts: readonly number[]; squares: readonly (readonly number[])[]; tagged?: Iterable<number> },
  slugOf: (name: string) => string,
  opts: { crews?: number; top?: (key: number) => number } = {},
): Frame {
  const page = new Map<number, string>(), tagged = new Set<number>(hoods.tagged ?? []), places = new Map<string, number>(), marks = new Map<string, number>();
  for (const m of city.landmarks ?? []) {
    const key = packSquare(Math.floor(m.x / 128), Math.floor(m.z / 128));
    marks.set(m.kind.toLowerCase(), key);
    places.set(slugOf(m.kind), key);
  }
  hoods.names.forEach((name, n) => {
    const slug = slugOf(name);
    places.set(slug, hoods.hearts[n]);
    for (const k of hoods.squares[n]) page.set(k, slug);
  });
  const [x0, z0, x1, z1] = city.bounds;
  return {
    map: mapOf(city.slug),
    crews: opts.crews ?? linkTune.crews,
    inside(key) {
      const x = squareIx(key) * 128, z = squareIz(key) * 128;
      return x + 128 > x0 && x < x1 && z + 128 > z0 && z < z1;
    },
    top: opts.top ?? ((key) => (page.has(key) ? (tagged.has(key) ? 3 : linkTune.top) : 0)),
    place: (slug) => places.get(slug) ?? -1,
    pageOf: (key) => page.get(key) ?? '',
    mark: (key) => marks.get(key) ?? -1,
  };
}

/** The squares a card names, as keys, in the card's order: none for a place or a landmark. */
export function cardKeys(card: Card): number[] {
  const b = card.body;
  return b && b.form === 'squares' ? b.squares.map((q) => packSquare(q.ix, q.iz)) : [];
}

/** One square a card wrote: its index on the card, its record now, and what stood there (null: nothing), for the fall. */
export interface Landed {
  i: number;
  rec: Rec;
  was: Rec | null;
}

/**
 * What opening an address did, and what the game does next. `kind`:
 *   'flyby'  a card new to this phone: its squares are written (`landed`) and it is remembered; play `beats`
 *   'score'  a card of today's place, new here: remembered, nothing written; `beats` is the ghost to beat
 *   'mark'   a landmark's card, new here: remembered, nothing written; replay its crown
 *   'spot'   a place and no more (a card with no squares, one torn down to its head, or one that had nothing left to land): land there
 *   'seen'   a card opened here before, 'own' one this phone sent: nothing changes
 *   'place'  no card that can be read, a page name that can: land at its square
 *   'door'   none of those: the game's own start
 */
export interface Landing {
  kind: 'flyby' | 'score' | 'mark' | 'spot' | 'seen' | 'own' | 'place' | 'door';
  /** the square the bus lands over, -1 at the door */
  key: number;
  why: string;
  /** the crew this card dealt a newcomer (now saved), 0 where none was dealt */
  dealt: number;
  /** the crew the card's squares wear here, 0 where it landed none */
  as: number;
  landed: Landed[];
  beats: Beat[];
  note: Note | null;
  /** a card of this phone's that this one answers and has taken the own square of: its note, now marked taken */
  answered: Note | null;
}

const NOWHERE = (kind: Landing['kind'], key: number, why: string): Landing => ({ kind, key, why, dealt: 0, as: 0, landed: [], beats: [], note: null, answered: null });

/**
 * Every square a card names becomes the card's record, whatever stood there, the player's own included: nothing here asks whose a square was, which is
 * what makes the order tiles load in beside the point. Left alone are only squares no tile can change the answer for: one nothing can be lifted on, one
 * where a god stands, and one this very card has been on. A stage past what the ground can reach comes down to it.
 */
function landSquares(save: Save, card: Card, id30: number, as: number, frame: Frame, now: unknown, ground: Ground | undefined): { landed: Landed[]; kept: number[] } {
  const landed: Landed[] = [], kept: number[] = [];
  const b = card.body;
  if (!b || b.form !== 'squares') return { landed, kept };
  const tended = Math.min(seconds(cardSeconds(card.at)), seconds(now) || CLOCK_TOP);
  b.squares.forEach((q, i) => {
    const key = packSquare(q.ix, q.iz), top = frame.top(key), old = save.squares.get(key);
    if (top < 1 || (old && (old.stage > linkTune.top || old.card === id30))) {
      kept.push(0);
      return;
    }
    const stage = Math.min(q.stage, top);
    const rec: Rec = { key, owner: as, stage, cracks: 0, hits: stage, tended, ax: old ? old.ax : 0, az: old ? old.az : 0, ay: old ? old.ay : NO_ANCHOR, rev: nextRev(old, now), card: id30, guest: true };
    save.squares.set(key, settle(rec, ground));
    noteClimb(save, now, key, as, stage);
    landed.push({ i, rec, was: old ?? null });
    kept.push(stage);
  });
  return { landed, kept };
}

/**
 * Open an address on this phone, once a page: `visit` is link.ts's `parseLocation` of the address the page started with. A card lands once a phone and is
 * remembered; a newcomer is dealt a crew by the card that brought them, before anything is drawn. `save` is changed in place: flush it before the first
 * frame. `returning` says the phone has painted before this save existed (its old paint is not empty): it is Rainbow, as it always painted, and is dealt
 * nothing. `ground` is for a card that lands with tiles already in (none are, when a page starts).
 */
export function openLink(save: Save, visit: Visit, frame: Frame, now: unknown, opts: { ground?: Ground; returning?: boolean } = {}): Landing {
  const r: Read = visit.link, card = r.card, t = seconds(now);
  const fallback = (why: string): Landing => {
    const at = visit.place ? frame.place(visit.place) : -1;
    return at >= 0 ? NOWHERE('place', at, why) : NOWHERE('door', -1, why);
  };
  if (!card || r.level === 'none') return fallback(r.why);
  if (card.map !== frame.map) return fallback('a card of another city');
  const b = card.body, own = packSquare(card.ix, card.iz), mk = b && b.form === 'mark' ? frame.mark(b.key.toLowerCase()) : -1;
  const key = mk >= 0 ? mk : own;
  if (!frame.inside(key)) return fallback('a card of somewhere off the map');
  const out = NOWHERE('spot', key, r.why);
  const known = r.id ? save.notes.get(r.id) : undefined;
  if (known) {
    out.kind = known.role === 'out' ? 'own' : 'seen';
    out.note = known;
    // (an opened card first read with its order lost, now read whole: its text made whole. A sent card's text is never changed by an address)
    if (known.role === 'in' && known.text === known.id && r.level === 'full' && r.canon.length > known.text.length) known.text = r.canon;
    return out;
  }
  // (a card whose note has been let go, known still by its short id: it never lands twice)
  if (r.id && r.level !== 'head' && save.seen.has(r.id30)) {
    out.kind = 'seen';
    return out;
  }
  if (save.crew.value === 0) {
    if (opts.returning) save.crew = { value: 1, rev: nextRev(save.crew, now) };
    else {
      out.dealt = dealCrew(r.seed, card.crew, frame.crews);
      save.crew = { value: out.dealt, rev: nextRev(save.crew, now) };
    }
  }
  // (a card with no squares, or torn down to its head, is a place: nothing to land twice, so nothing to remember)
  if (!b || r.level === 'head' || !r.id) return out;
  const note: Note = { id: r.id, id30: r.id30, role: 'in', text: r.canon, at: t, gen: visit.gen, place: visit.place, key: own, crew: card.crew, taken: 0, answers: b.answers ?? -1 };
  save.notes.set(note.id, note);
  know(save, note.id30, now);
  out.note = note;
  if (b.form === 'mark') {
    out.kind = 'mark';
    return out;
  }
  if (b.score) {
    out.kind = 'score';
    out.beats = beats(card, (ix, iz) => frame.top(packSquare(ix, iz)));
    return out;
  }
  if (card.crew > frame.crews) return out; // (a crew this city has none of: its squares can't be worn)
  const as = wornBy(card.crew, save.crew.value, frame.crews), done = landSquares(save, card, r.id30, as, frame, now, opts.ground);
  out.landed = done.landed;
  out.beats = beats(card, (ix, iz) => done.kept[b.squares.findIndex((q) => q.ix === ix && q.iz === iz)]);
  if (!done.landed.length) return out;
  out.kind = 'flyby';
  out.as = as;
  // an answer: this card took the own square of a card this phone sent. That card is taken
  if (b.answers !== null)
    for (const n of save.notes.values())
      if (n.role === 'out' && n.id30 === b.answers && done.landed.some((l) => l.rec.key === n.key)) {
        if (!n.taken) n.taken = Math.max(1, t);
        out.answered = n;
      }
  return out;
}

/**
 * Remember a card this phone sends (`written` is link.ts's `encode` of it), so it is never landed here and can be sent again as it was. A phone that
 * had no crew yet has the card's from now on.
 */
export function noteSent(save: Save, written: { text: string; id: string; id30: number }, card: Card, gen: number, place: string, now: unknown): Note {
  const b = card.body;
  if (save.crew.value === 0) save.crew = { value: card.crew, rev: nextRev(save.crew, now) };
  const note: Note = { id: written.id, id30: written.id30, role: 'out', text: written.text, at: seconds(now), gen: num(gen, 0, linkTune.gen) ? gen : 0, place: String(place), key: packSquare(card.ix, card.iz), crew: card.crew, taken: 0, answers: b && b.answers !== null ? b.answers : -1 };
  know(save, note.id30, now);
  const have = save.notes.get(note.id);
  if (have) {
    have.role = 'out';
    have.text = longer(have.text, note.text);
    return have;
  }
  save.notes.set(note.id, note);
  return note;
}

/**
 * The player's own squares for a postcard of here: the square `key` and the crew's others nearest it (by rings, ties by key), 32 at most, all within
 * 7 squares of it each way so they fit a card's box, sorted as a card wants them. None where `key` itself isn't the crew's (or a god stands there).
 * Its order is `orderFrom(save, squares, crew)`.
 */
export function squaresFor(save: Save, key: number, crew: number): CardSquare[] {
  const own = save.squares.get(key);
  if (!own || own.owner !== crew || own.stage > linkTune.top) return [];
  const ix = squareIx(key), iz = squareIz(key), near: { d: number; r: Rec }[] = [];
  for (const r of save.squares.values()) {
    if (r.owner !== crew || r.stage > linkTune.top) continue;
    const d = Math.max(Math.abs(squareIx(r.key) - ix), Math.abs(squareIz(r.key) - iz));
    if (d <= 7) near.push({ d, r });
  }
  near.sort((a, b) => a.d - b.d || a.r.key - b.r.key);
  return near.slice(0, linkTune.squares).map(({ r }) => ({ ix: squareIx(r.key), iz: squareIz(r.key), stage: r.stage })).sort((a, b) => a.iz - b.iz || a.ix - b.ix);
}

/** The newest card this phone sent, or null: what the next visit's loading page offers (stamp.js's sbwLastCard reads the same from the save's text). */
export function lastSent(save: Save): Note | null {
  let best: Note | null = null;
  for (const n of save.notes.values()) if (n.role === 'out' && (!best || n.at > best.at || (n.at === best.at && n.id > best.id))) best = n;
  return best;
}

/** The crew an opened card's squares wear on this phone now: its own square's owner while that square is still as the card left it, else 0. */
export function wornNow(save: Save, note: Note): number {
  const r = save.squares.get(note.key);
  return r && r.guest && r.card === note.id30 ? r.owner : 0;
}

/**
 * The player has taken a square back (the engine's flip to the player's own crew): `was` is its record before. Where it was an opened card's own
 * square, still as the card left it, that card is taken: its note is marked and returned, for TAKEN and for the reply card's `answers`.
 */
export function noteTaken(save: Save, key: number, was: Rec | null | undefined, now: unknown): Note | null {
  if (!was || !was.guest || was.card < 0) return null;
  for (const n of save.notes.values())
    if (n.role === 'in' && n.id30 === was.card && n.key === key) {
      if (!n.taken) n.taken = Math.max(1, seconds(now));
      return n;
    }
  return null;
}

/** A sent or opened card's own card, read back from its note's text (null for a text that no longer reads). */
export function noteCard(note: Note): Card | null {
  return decode(note.text).card;
}
