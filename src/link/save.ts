// The saved city, and what a postcard does to it (docs/specs/core/LINK.md, "The save" on). A square's record is today's 16 bytes (areas.ts's `encode`, byte
// for byte) and 8 more: `rev`, which says which of two records of one square is the later, and the card that put it there. Two saves of one city join into
// one whatever order they are joined in, so two tabs, a journal and a database can't disagree for long. A card lands once a phone, and what it lands is the
// sender's: every square it names becomes the card's, whatever stood there, so the order tiles load in changes nothing. A tile only ever gives a record
// its anchor, and makes one from the phone's own old building paint where there is none. Pure and worker-safe; the stores themselves (localStorage in M1,
// IndexedDB in M2's task 13) sit behind `SaveBackend`.

import { beats, cardSeconds, dealCrew, wornBy, linkTune } from './link';
import type { Beat, Card, Read, Visit } from './link';

/** bytes a square */
export const REC = 24;
/** `ay` of a record no tile has given its anchor yet */
export const NO_ANCHOR = -32768;
/** the last `rev` there is: 2106. A record that reaches it changes no more by `rev` */
const REV_TOP = 0xfffffffe;

export const saveTune = {
  /** the cards a phone remembers, and the climbs it keeps for a card's order */
  notes: 256,
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
  /** the whole text, to send it again as it was */
  text: string;
  /** epoch s it was sent, or first opened */
  at: number;
  gen: number;
  place: string;
  /** the card's own square */
  key: number;
  /** the sender's crew, and the crew its squares wear on this phone (0: it landed none) */
  crew: number;
  as: number;
  /** epoch s it was taken back, 0 while it stands */
  taken: number;
  /** the card it answers, -1 for none */
  answers: number;
}

/** One counted change of a square's owner or stage: when (epoch s), where, and `owner << 4 | stage` after it. */
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
}

export function emptySave(): Save {
  return { squares: new Map(), marks: new Map(), notes: new Map(), crew: { value: 0, rev: 0 }, climbs: [] };
}

/** Any clock as whole epoch seconds a record can hold: one given in milliseconds is taken as such, nonsense is 0. */
export function seconds(now: unknown): number {
  let t = typeof now === 'number' && Number.isFinite(now) ? now : 0;
  if (t >= 1e11) t /= 1000;
  return Math.max(0, Math.min(REV_TOP, Math.floor(t)));
}
/** The `rev` of a change made now to a record that was `old`: now, or one past what was known where the clock has been put back. Never 0: that is old paint's. */
export function nextRev(old: { rev: number } | undefined | null, now: unknown): number {
  return Math.min(REV_TOP, Math.max(seconds(now), old ? old.rev + 1 : 1));
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
  if (owner < 1 || owner > 15 || stage < 1 || stage > 5) return null;
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

function joinMark(a: MarkRec | undefined, b: MarkRec | undefined): MarkRec | undefined {
  if (!a || !b) return a ?? b;
  const c = a.rev - b.rev || a.owner - b.owner || a.stage - b.stage || a.cracks - b.cracks || a.hits - b.hits || a.tended - b.tended || a.card - b.card;
  return c >= 0 ? a : b;
}
const longer = (a: string, b: string): string => (a.length !== b.length ? (a.length > b.length ? a : b) : a >= b ? a : b);
/** One card's two notes as one: sent beats opened, the first time it was seen, the fuller text, taken once it has been on either. */
function joinNote(a: Note | undefined, b: Note | undefined): Note | undefined {
  if (!a || !b) return a ?? b;
  return {
    id: a.id, id30: Math.max(a.id30, b.id30), role: a.role === 'out' || b.role === 'out' ? 'out' : 'in', text: longer(a.text, b.text), at: Math.min(a.at, b.at),
    gen: Math.min(a.gen, b.gen), place: a.place >= b.place ? a.place : b.place, key: Math.max(a.key, b.key), crew: Math.max(a.crew, b.crew),
    as: Math.max(a.as, b.as), taken: Math.max(a.taken, b.taken), answers: Math.max(a.answers, b.answers),
  };
}
const climbOrder = (a: Climb, b: Climb): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

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
  const all = [...a.climbs, ...b.climbs].sort(climbOrder);
  out.climbs = all.filter((c, i) => !i || climbOrder(all[i - 1], c) !== 0);
  return out;
}

/**
 * A save held to what a phone keeps: the last `climbs` climbs, and `notes` cards. Opened cards go before sent ones, those none of whose squares still
 * carry them first, the oldest first.
 */
export function trim(save: Save): Save {
  if (save.climbs.length > saveTune.climbs) save.climbs = save.climbs.slice(save.climbs.length - saveTune.climbs);
  if (save.notes.size > saveTune.notes) {
    const carried = new Set<number>();
    for (const r of save.squares.values()) if (r.card >= 0) carried.add(r.card);
    const rank = (n: Note): number => (n.role === 'out' ? 2 : carried.has(n.id30) ? 1 : 0);
    const by = [...save.notes.values()].sort((p, q) => rank(p) - rank(q) || p.at - q.at || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
    for (let i = 0; i < by.length - saveTune.notes; i++) save.notes.delete(by[i].id);
  }
  return save;
}

// ---- the save as text ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}
function fromBase64(s: string): Uint8Array | null {
  if (s.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0, out = new Uint8Array((s.length / 4) * 3 - pad);
  for (let i = 0, o = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | ((s[i + 2] === '=' ? 0 : B64.indexOf(s[i + 2])) << 6) | (s[i + 3] === '=' ? 0 : B64.indexOf(s[i + 3]));
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
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
/** areas.ts's save (strugglebus.areas.v1) as records, for a phone's first run of this one: `rev` 0, so anything newer stands over them. */
export function fromAreasText(text: string): Map<number, Rec> | null {
  const b = fromBase64(text);
  if (!b || b.length % 16) return null;
  const out = new Map<number, Rec>(), full = new Uint8Array(REC);
  for (let o = 0; o < b.length; o += 16) {
    full.fill(0);
    full.set(b.subarray(o, o + 16));
    if (!full[12] && !full[13] && !full[14] && !full[15]) new DataView(full.buffer).setInt16(14, NO_ANCHOR, true);
    const r = unpack(full);
    if (!r) return null;
    out.set(r.key, r);
  }
  return out;
}

const MAGIC = 'SBW2';
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** The whole save as one text, the same text for the same save: what a Storage holds, and what two saves are compared by. */
export function saveText(save: Save): string {
  const marks: Record<string, number[]> = {};
  for (const k of [...save.marks.keys()].sort()) {
    const m = save.marks.get(k)!;
    marks[k] = [m.owner, m.stage, m.cracks, m.hits, m.tended, m.rev, m.card];
  }
  const notes = [...save.notes.values()].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
    .map((n) => [n.id, n.id30, n.role === 'out' ? 1 : 0, n.text, n.at, n.gen, n.place, n.key, n.crew, n.as, n.taken, n.answers]);
  const climbs = new Uint8Array(save.climbs.length * 9), v = new DataView(climbs.buffer);
  save.climbs.forEach((c, i) => (v.setUint32(i * 9, c[0], true), v.setUint32(i * 9 + 4, c[1], true), v.setUint8(i * 9 + 8, c[2])));
  return [MAGIC, toBase64(squaresBytes(save.squares)), JSON.stringify(marks), JSON.stringify(notes), JSON.stringify([save.crew.value, save.crew.rev]), toBase64(climbs)].join('\n');
}

/**
 * A text as a save. Total: what can't be read is left out and counted in `lost`, record by record, so one bad square never costs the city. A text that
 * isn't a save at all is an empty one with `lost` -1.
 */
export function parseSave(text: unknown): { save: Save; lost: number } {
  const save = emptySave();
  if (typeof text !== 'string') return { save, lost: -1 };
  const line = text.split('\n');
  if (line[0] !== MAGIC) return { save, lost: -1 };
  let lost = 0;
  const sq = fromBase64(line[1] ?? '');
  if (!sq) lost++;
  else {
    if (sq.length % REC) lost++;
    for (let o = 0; o + REC <= sq.length; o += REC) {
      const r = unpack(sq, o);
      if (r) save.squares.set(r.key, joinRec(save.squares.get(r.key), r)!);
      else lost++;
    }
  }
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
      if (/^[a-z0-9-]{1,16}$/.test(k) && Array.isArray(m) && m.length === 7 && num(m[0], 1, 15) && num(m[1], 1, 5) && num(m[2], 0, 15) && num(m[3], 0, 0xffff) && num(m[4], 0, 0xffffffff) && num(m[5], 0, 0xffffffff) && num(m[6], -1, 2 ** 30 - 1))
        save.marks.set(k, { owner: m[0], stage: m[1], cracks: m[2], hits: m[3], tended: m[4], rev: m[5], card: m[6] });
      else lost++;
    }
  const notes = json(line[3]);
  if (Array.isArray(notes))
    for (const n of notes) {
      if (Array.isArray(n) && n.length === 12 && typeof n[0] === 'string' && n[0] && num(n[1], 0, 2 ** 30 - 1) && (n[2] === 0 || n[2] === 1) && typeof n[3] === 'string' && num(n[4], 0, 0xffffffff) && num(n[5], 0, linkTune.gen) && typeof n[6] === 'string' && num(n[7], 0, 0xffffffff) && num(n[8], 1, 15) && num(n[9], 0, 15) && num(n[10], 0, 0xffffffff) && num(n[11], -1, 2 ** 30 - 1)) {
        const note: Note = { id: n[0], id30: n[1], role: n[2] ? 'out' : 'in', text: n[3], at: n[4], gen: n[5], place: n[6], key: n[7], crew: n[8], as: n[9], taken: n[10], answers: n[11] };
        save.notes.set(note.id, joinNote(save.notes.get(note.id), note)!);
      } else lost++;
    }
  const crew = json(line[4]);
  if (Array.isArray(crew) && crew.length === 2 && num(crew[0], 0, 15) && num(crew[1], 0, 0xffffffff)) save.crew = { value: crew[0], rev: crew[1] };
  else if (crew !== null) lost++;
  const cl = fromBase64(line[5] ?? '');
  if (!cl || cl.length % 9) lost++;
  else {
    const v = new DataView(cl.buffer, cl.byteOffset, cl.byteLength);
    for (let o = 0; o < cl.length; o += 9) save.climbs.push([v.getUint32(o, true), v.getUint32(o + 4, true), v.getUint8(o + 8)]);
    save.climbs.sort(climbOrder);
    save.climbs = save.climbs.filter((c, i) => !i || climbOrder(save.climbs[i - 1], c) !== 0);
  }
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
/**
 * Write a save: what is stored is read and joined in first, so a second tab's work is never written over, and the joined save is what this tab goes on
 * with. Call it on a change's debounce, on `pagehide`, and when a tab comes back into view (to pick up what another wrote).
 */
export function flush(mem: Save, backend: SaveBackend): { save: Save; wrote: boolean } {
  const stored = backend.read();
  const save = trim(stored === null ? joinSave(mem, emptySave()) : joinSave(mem, parseSave(stored).save));
  return { save, wrote: backend.write(saveText(save)) };
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
 * square changes hands. A square gone grey keeps no record.
 */
export function touch(save: Save, a: AreaLike, now: unknown, ground?: Ground): Rec | null {
  const old = save.squares.get(a.key);
  if (a.faction < 1 || a.stage < 1) return null;
  const rec: Rec = {
    key: a.key, owner: a.faction, stage: a.stage, cracks: a.cracks, hits: Math.min(0xffff, a.hits), tended: a.tended >>> 0,
    ax: old ? old.ax : 0, az: old ? old.az : 0, ay: old ? old.ay : NO_ANCHOR, rev: nextRev(old, now), card: old ? old.card : -1,
    guest: !!old && old.guest && old.owner === a.faction,
  };
  if (!old || old.owner !== rec.owner || old.stage !== rec.stage) noteClimb(save, now, rec.key, rec.owner, rec.stage);
  save.squares.set(rec.key, settle(rec, ground));
  return rec;
}

/** Note a counted change of a square's owner or stage, in its place by time. */
export function noteClimb(save: Save, now: unknown, key: number, owner: number, stage: number): void {
  const c: Climb = [seconds(now), key >>> 0, ((owner & 15) << 4) | (stage & 15)];
  let i = save.climbs.length;
  while (i > 0 && climbOrder(save.climbs[i - 1], c) > 0) i--;
  if (i > 0 && climbOrder(save.climbs[i - 1], c) === 0) return;
  save.climbs.splice(i, 0, c);
}

/**
 * The order these squares climbed in, for a card: an index into `squares` for every stage of every square, as link.ts's `order` wants it. From the climbs
 * still kept; a stage whose climb is forgotten counts as long ago and goes first. Always an order a card can carry.
 */
export function orderFrom(climbs: readonly Climb[], squares: readonly { key: number; stage: number }[], crew: number): number[] {
  const idx = new Map(squares.map((q, i) => [q.key, i])), when: number[][] = squares.map(() => []), cur = squares.map(() => 0);
  climbs.forEach(([, key, v], p) => {
    const i = idx.get(key);
    if (i === undefined) return;
    const stage = v & 15;
    if (v >> 4 !== crew) {
      when[i].length = 0;
      cur[i] = 0;
      return;
    }
    if (stage > cur[i]) for (let s = cur[i] + 1; s <= stage; s++) when[i][s] = p;
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
 * record and the phone has old building paint there, one is made (stage as the paint's, 3 at most, `rev` 0, so anything else stands over it); and a
 * record with no anchor takes the tile's. It never changes whose a square is or how high. Returns the records it made or changed.
 */
export function landTile(save: Save, squares: readonly TileSquare[], frame: Pick<Frame, 'top'>): Rec[] {
  const changed: Rec[] = [];
  for (const q of squares) {
    const top = frame.top(q.key);
    if (top < 1) continue;
    let r = save.squares.get(q.key);
    if (!r && q.old > 0) {
      const stage = Math.min(saveTune.oldTop, q.old, top);
      r = { key: q.key, owner: q.oldCrew && q.oldCrew >= 1 && q.oldCrew <= 15 ? q.oldCrew : 1, stage, cracks: 0, hits: stage, tended: 0, ax: 0, az: 0, ay: NO_ANCHOR, rev: 0, card: -1, guest: false };
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
  /** this city's number on a card: 0 is San Francisco */
  map: number;
  crews: number;
  /** is this square on the map at all */
  inside(key: number): boolean;
  /** a square's top stage: 0 where nothing can be lifted (water, off the map), 3 where the map tags it, else 4 */
  top(key: number): number;
  /** a page name's own square (a neighbourhood's heart, a landmark's square), -1 for none */
  place(slug: string): number;
  /** a landmark's square by its key in lower case, -1 where the city has none of that name */
  mark(key: string): number;
}

/** A city's frame from its two small files: city.json's bounds ([x0, z0, x1, z1], m) and landmarks, and hoods.bin's table (src/world/hoods.ts). */
export function frameFrom(
  city: { map: number; crews?: number; bounds: readonly number[]; landmarks?: readonly { kind: string; x: number; z: number }[] },
  hoods: { names: readonly string[]; hearts: readonly number[]; squares: readonly (readonly number[])[]; tagged?: Iterable<number> },
  slugOf: (name: string) => string,
): Frame {
  const land = new Set<number>(), tagged = new Set<number>(hoods.tagged ?? []), places = new Map<string, number>(), marks = new Map<string, number>();
  for (const list of hoods.squares) for (const k of list) land.add(k);
  for (const m of city.landmarks ?? []) {
    const key = packSquare(Math.floor(m.x / 128), Math.floor(m.z / 128));
    marks.set(m.kind.toLowerCase(), key);
    places.set(slugOf(m.kind), key);
  }
  hoods.names.forEach((name, n) => places.set(slugOf(name), hoods.hearts[n]));
  const [x0, z0, x1, z1] = city.bounds;
  return {
    map: city.map,
    crews: city.crews ?? linkTune.crews,
    inside(key) {
      const x = squareIx(key) * 128, z = squareIz(key) * 128;
      return x + 128 > x0 && x < x1 && z + 128 > z0 && z < z1;
    },
    top: (key) => (land.has(key) ? (tagged.has(key) ? 3 : linkTune.top) : 0),
    place: (slug) => places.get(slug) ?? -1,
    mark: (key) => marks.get(key) ?? -1,
  };
}

/**
 * What opening an address did, and what the game does next. `kind`:
 *   'flyby'  a card new to this phone: its squares are written (`wrote`, and `was` what stood there) and it is remembered; play `beats`
 *   'score'  a card of today's place, new here: remembered, nothing written; `beats` is the ghost to beat
 *   'mark'   a landmark's card, new here: remembered, nothing written; replay its crown
 *   'spot'   a place and no more (a card with no squares, or one torn down to its head): land there
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
  /** the crew the card's squares wear here, 0 where it has none */
  as: number;
  wrote: Rec[];
  was: (Rec | null)[];
  beats: Beat[];
  note: Note | null;
  /** a card of this phone's that this one answers: its note, now marked taken */
  answered: Note | null;
}

const NOWHERE = (kind: Landing['kind'], key: number, why: string): Landing => ({ kind, key, why, dealt: 0, as: 0, wrote: [], was: [], beats: [], note: null, answered: null });

/**
 * Every square a card names becomes the card's record, whatever stood there, the player's own included: nothing here asks whose a square was, which is
 * what makes the order tiles load in beside the point. Left alone are only squares no tile can change the answer for: one nothing can be lifted on, one
 * where a god stands, and one this very card has been on. A stage past what the ground can reach comes down to it.
 */
function landSquares(save: Save, card: Card, id30: number, as: number, frame: Frame, now: unknown, ground: Ground | undefined): { wrote: Rec[]; was: (Rec | null)[]; kept: number[] } {
  const wrote: Rec[] = [], was: (Rec | null)[] = [], kept: number[] = [];
  const b = card.body;
  if (!b || b.form !== 'squares') return { wrote, was, kept };
  const tended = Math.min(seconds(cardSeconds(card.at)), seconds(now));
  for (const q of b.squares) {
    const key = packSquare(q.ix, q.iz), top = frame.top(key), old = save.squares.get(key);
    if (top < 1 || (old && (old.stage > linkTune.top || old.card === id30))) {
      kept.push(0);
      continue;
    }
    const stage = Math.min(q.stage, top);
    const rec: Rec = { key, owner: as, stage, cracks: 0, hits: stage, tended, ax: old ? old.ax : 0, az: old ? old.az : 0, ay: old ? old.ay : NO_ANCHOR, rev: nextRev(old, now), card: id30, guest: true };
    save.squares.set(key, settle(rec, ground));
    noteClimb(save, now, key, as, stage);
    wrote.push(rec);
    was.push(old ?? null);
    kept.push(stage);
  }
  return { wrote, was, kept };
}

/**
 * Open an address on this phone, once a page: `visit` is link.ts's `parseLocation` of the address the page started with. A card lands once a phone and is
 * remembered; a newcomer is dealt a crew by the card that brought them, before anything is drawn. `save` is changed in place: flush it before the first frame.
 * `ground` is for a card that lands with tiles already in (none are, when a page starts).
 */
export function openLink(save: Save, visit: Visit, frame: Frame, now: unknown, ground?: Ground): Landing {
  const r: Read = visit.link, card = r.card, t = seconds(now);
  const fallback = (why: string): Landing => {
    const at = visit.place ? frame.place(visit.place) : -1;
    return at >= 0 ? NOWHERE('place', at, why) : NOWHERE('door', -1, why);
  };
  if (!card || r.level === 'none') return fallback(r.why);
  if (card.map !== frame.map) return fallback('a card of another city');
  const b = card.body, mk = b && b.form === 'mark' ? frame.mark(b.key.toLowerCase()) : -1;
  const key = mk >= 0 ? mk : packSquare(card.ix, card.iz);
  if (!frame.inside(key)) return fallback('a card of somewhere off the map');
  const out = NOWHERE('spot', key, r.why);
  if (save.crew.value === 0) {
    out.dealt = dealCrew(r.id30, card.crew, frame.crews);
    save.crew = { value: out.dealt, rev: nextRev(save.crew, now) };
  }
  // (a card with no squares, or torn down to its head, is a place: nothing to land twice, so nothing to remember)
  if (!b || r.level === 'head' || !r.id) return out;
  const known = save.notes.get(r.id);
  if (known) {
    out.kind = known.role === 'out' ? 'own' : 'seen';
    out.note = known;
    if (r.canon.length > known.text.length) known.text = r.canon; // (first read with its order lost, now whole)
    return out;
  }
  const note: Note = { id: r.id, id30: r.id30, role: 'in', text: r.canon, at: t, gen: visit.gen, place: visit.place, key, crew: card.crew, as: 0, taken: 0, answers: b.answers ?? -1 };
  save.notes.set(note.id, note);
  out.note = note;
  if (b.answers !== null)
    for (const n of save.notes.values())
      if (n.role === 'out' && n.id30 === b.answers && (b.form === 'mark' ? n.key === key : b.squares.some((q) => packSquare(q.ix, q.iz) === n.key))) {
        if (!n.taken) n.taken = Math.max(1, t);
        out.answered = n;
      }
  if (b.form === 'mark') {
    out.kind = 'mark';
    return out;
  }
  const top = (ix: number, iz: number): number => frame.top(packSquare(ix, iz));
  if (b.score) {
    out.kind = 'score';
    out.beats = beats(card, top);
    return out;
  }
  if (card.crew > frame.crews) return out; // (a crew this city has none of: its squares can't be worn)
  out.as = note.as = wornBy(card.crew, save.crew.value, frame.crews);
  const done = landSquares(save, card, r.id30, out.as, frame, now, ground);
  out.wrote = done.wrote;
  out.was = done.was;
  out.beats = beats(card, (ix, iz) => done.kept[b.squares.findIndex((q) => q.ix === ix && q.iz === iz)]);
  if (done.wrote.length) out.kind = 'flyby';
  return out;
}

/** Remember a card this phone sends (`written` is link.ts's `encode` of it), so it is never landed here and can be sent again as it was. */
export function noteSent(save: Save, written: { text: string; id: string; id30: number }, card: Card, gen: number, place: string, now: unknown): Note {
  const b = card.body;
  const note: Note = { id: written.id, id30: written.id30, role: 'out', text: written.text, at: seconds(now), gen: Math.max(0, Math.min(linkTune.gen, gen | 0)), place, key: packSquare(card.ix, card.iz), crew: card.crew, as: 0, taken: 0, answers: b && b.answers !== null ? b.answers : -1 };
  const have = save.notes.get(note.id);
  if (have) {
    have.role = 'out';
    return have;
  }
  save.notes.set(note.id, note);
  return note;
}

/**
 * The player has taken a square back (the engine's flip). Where it was an opened card's own square, still as the card left it, that card is taken:
 * its note is marked and returned, for TAKEN and for the reply card's `answers`.
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
