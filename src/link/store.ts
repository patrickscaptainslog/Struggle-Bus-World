// The safe save (STUDIO.md part 7, #13): the city's save (save.ts) kept in the browser's own database, IndexedDB, a row a record, and only what changed
// written. Every row written is joined in the same transaction with the row the database holds, so two tabs never write over each other's work, and the
// tab takes back whatever another tab had that was later. On the way out (pagehide) the whole save goes into localStorage as well, synchronously, as
// M1's save does: that text is the journal, joined in at the next start. Where the database can't be opened (some private windows, a store from a newer
// build) it is M1's save alone. `persist()` asks the browser to keep the site's data through storage pressure. Safari still drops a site's data after
// seven days without a visit, whatever is asked (WebKit's tracking prevention): that is season 2's server, not this.

import { emptySave, flush, joinMark, joinNote, joinRec, joinSave, pack, parseSave, rewear, saveText, saveTune, storageBackend, trim, unpack, REC } from './save';
import type { MarkRec, Note, Rec, Save } from './save';

const DB_VERSION = 1;
const STORES = ['sq', 'lm', 'cards', 'meta'] as const;
type StoreName = (typeof STORES)[number];

/** what the page runs with: the browser's own by default, a stand-in in a check */
export interface StoreEnv {
  indexedDB?: IDBFactory | null;
  localStorage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  storage?: { persist?(): Promise<boolean>; persisted?(): Promise<boolean> } | null;
}

// ---- a row's value, as the database holds it ----

const noteRow = (n: Note): unknown[] => [n.id, n.id30, n.role === 'out' ? 1 : 0, n.text, n.at, n.gen, n.place, n.key, n.crew, n.taken, n.answers];
const markRow = (m: MarkRec): number[] => [m.owner, m.stage, m.cracks, m.hits, m.tended, m.rev, m.card];
/** the crew, the climbs, the forgotten count and the cards known: save.ts's own text for them, its lines 5 to 7 */
function metaRow(save: Save): string {
  const line = saveText({ ...emptySave(), crew: save.crew, climbs: save.climbs, forgot: save.forgot, seen: save.seen }).split('\n');
  return [line[4], line[5], line[6]].join('\n');
}
/** One save of what the four stores hold, read the way save.ts reads its text: a row that can't be read is left out and counted. */
function fromRows(sq: unknown[], lm: [IDBValidKey, unknown][], cards: unknown[], meta: unknown): { save: Save; lost: number } {
  const marks: Record<string, unknown> = {};
  for (const [k, v] of lm) if (typeof k === 'string') marks[k] = v;
  const m = typeof meta === 'string' ? meta.split('\n') : ['', '', ''];
  const text = ['SBW2', '', JSON.stringify(marks), JSON.stringify(cards), m[0] || 'null', m[1] ?? '', m[2] ?? ''].join('\n');
  const out = parseSave(text);
  let lost = out.lost;
  for (const b of sq) {
    const r = b instanceof Uint8Array && b.length === REC ? unpack(b) : null;
    if (r) out.save.squares.set(r.key, joinRec(out.save.squares.get(r.key), r)!);
    else lost++;
  }
  return { save: out.save, lost };
}

const sqPrint = (r: Rec): string => String.fromCharCode(...pack(r));

export class SafeSave {
  /** 'db': the browser's database, with the journal on the way out; 'journal': localStorage alone (M1's save); 'memory': neither could be had */
  where: 'db' | 'journal' | 'memory';
  readonly slug: string;
  private db: Promise<IDBDatabase> | null = null;
  private readonly env: Required<StoreEnv>;
  /** what each row held when this tab last read or wrote it: what "changed" is measured against */
  private readonly written = new Map<string, string>();
  /** notes let go by trim, to delete at the next write */
  private readonly gone = new Set<string>();
  /** one write at a time from this tab */
  private queue: Promise<unknown> = Promise.resolve();
  /** connections opened: past the first, the database may have been lost and made again, so every row is written again */
  private opens = 0;

  private constructor(slug: string, env: Required<StoreEnv>, where: SafeSave['where']) {
    this.slug = slug;
    this.env = env;
    this.where = where;
  }

  /** The city's store: the database if it can be opened, else localStorage, else memory. Never throws. */
  static async open(slug: string, env: StoreEnv = {}): Promise<SafeSave> {
    const g = globalThis as unknown as { indexedDB?: IDBFactory; localStorage?: Storage; navigator?: { storage?: StoreEnv['storage'] } };
    let ls: StoreEnv['localStorage'] = null;
    try {
      ls = env.localStorage !== undefined ? env.localStorage : g.localStorage ?? null;
    } catch {
      ls = null; // (a browser that throws on the very name of localStorage)
    }
    const full: Required<StoreEnv> = {
      indexedDB: env.indexedDB !== undefined ? env.indexedDB : g.indexedDB ?? null,
      localStorage: ls,
      storage: env.storage !== undefined ? env.storage : g.navigator?.storage ?? null,
    };
    const s = new SafeSave(slug, full, full.localStorage ? 'journal' : 'memory');
    if (full.indexedDB) {
      try {
        await s.open();
        s.where = 'db';
      } catch {
        s.db = null; // (no database to be had: M1's save alone)
      }
    }
    return s;
  }

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    const p = new Promise<IDBDatabase>((ok, no) => {
      let r: IDBOpenDBRequest;
      try {
        r = this.env.indexedDB!.open(`strugglebus.city.${this.slug}`, DB_VERSION);
      } catch (e) {
        no(e);
        return;
      }
      r.onupgradeneeded = () => {
        for (const name of STORES) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
      };
      r.onsuccess = () => {
        const db = r.result;
        if (++this.opens > 1) this.written.clear();
        // (a connection the browser closes, or another tab's upgrade, is let go of: the next call opens a new one)
        db.onclose = () => this.drop(p);
        db.onversionchange = () => {
          db.close();
          this.drop(p);
        };
        ok(db);
      };
      r.onerror = () => {
        this.drop(p);
        no(r.error);
      };
      r.onblocked = () => no(new Error('blocked'));
    });
    this.db = p;
    return p;
  }

  private drop(p: Promise<IDBDatabase> | null): void {
    if (this.db !== p) return;
    this.db = null;
    void p?.then((db) => db.close()).catch(() => undefined);
  }

  /** One transaction over the four stores, on a connection opened again once if it fails (iOS drops a page's connection after a while in the background). */
  private async tx<T>(mode: IDBTransactionMode, f: (st: Record<StoreName, IDBObjectStore>) => () => T): Promise<T> {
    try {
      return await this.once(mode, f);
    } catch {
      this.drop(this.db);
      return await this.once(mode, f);
    }
  }
  private async once<T>(mode: IDBTransactionMode, f: (st: Record<StoreName, IDBObjectStore>) => () => T): Promise<T> {
    const db = await this.open();
    return new Promise((ok, no) => {
      let t: IDBTransaction;
      try {
        t = db.transaction([...STORES], mode);
      } catch (e) {
        no(e);
        return;
      }
      let done: () => T;
      try {
        done = f({ sq: t.objectStore('sq'), lm: t.objectStore('lm'), cards: t.objectStore('cards'), meta: t.objectStore('meta') });
      } catch (e) {
        try {
          t.abort();
        } catch {
          /* already over */
        }
        no(e);
        return;
      }
      t.oncomplete = () => ok(done());
      t.onerror = () => no(t.error);
      t.onabort = () => no(t.error ?? new Error('aborted'));
    });
  }

  private readJournal(): { save: Save; lost: number } | null {
    try {
      const text = this.env.localStorage?.getItem(saveTune.key(this.slug));
      return text == null ? null : parseSave(text);
    } catch {
      return null;
    }
  }

  /** Remember what every row of `save` holds now, as written. */
  private mark(save: Save): void {
    this.written.clear();
    for (const r of save.squares.values()) this.written.set(`sq:${r.key}`, sqPrint(r));
    for (const [k, m] of save.marks) this.written.set(`lm:${k}`, JSON.stringify(markRow(m)));
    for (const n of save.notes.values()) this.written.set(`cards:${n.id}`, JSON.stringify(noteRow(n)));
    this.written.set('meta', metaRow(save));
  }

  /**
   * The city's save as this phone holds it: the database's rows, joined with the journal the last page left, trimmed. `lost` counts what could not be
   * read (-1: the journal held something that is no save). Never throws: a database that fails to read gives the journal alone.
   */
  async load(now?: unknown): Promise<{ save: Save; lost: number }> {
    const journal = this.readJournal();
    let save = journal ? journal.save : emptySave(), lost = journal ? journal.lost : 0, fromDb: Save | null = null;
    if (this.where === 'db') {
      try {
        const got = await this.tx('readonly', (st) => {
          const sq = st.sq.getAll(), lmK = st.lm.getAllKeys(), lmV = st.lm.getAll(), cards = st.cards.getAll(), meta = st.meta.get('meta');
          return () => fromRows(sq.result, (lmK.result as IDBValidKey[]).map((k, i) => [k, (lmV.result as unknown[])[i]]), cards.result, meta.result);
        });
        fromDb = got.save;
        lost = Math.max(lost, 0) + got.lost;
        save = joinSave(got.save, save);
      } catch {
        this.where = this.env.localStorage ? 'journal' : 'memory';
      }
    }
    rewear(save, now);
    trim(save);
    // (what the database holds is what has been written; the journal's rows over it, and trim's work, are written at the next write)
    this.mark(fromDb ?? emptySave());
    if (fromDb) for (const id of fromDb.notes.keys()) if (!save.notes.has(id)) this.gone.add(id);
    return { save, lost };
  }

  /**
   * Write what changed in `save` since this tab last read or wrote it, each row joined with the row the database holds, in one transaction. `save` takes
   * the joined rows, so it holds what another tab wrote of them that was later. Returns how many rows were written, and the squares another tab's work
   * changed here (to redraw, and for areas' `absorb`). Off the database, it is M1's flush into localStorage.
   */
  write(save: Save, now?: unknown): Promise<{ rows: number; changed: Rec[] }> {
    const run = this.queue.then(() => this.writeNow(save, now));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async writeNow(save: Save, now?: unknown): Promise<{ rows: number; changed: Rec[] }> {
    if (this.where !== 'db') return this.writeJournal(save, now);
    // (the connection first: one opened again after the database was lost writes every row, so what changed is worked out after it)
    try {
      await this.open();
    } catch {
      this.where = this.env.localStorage ? 'journal' : 'memory';
      return this.writeJournal(save, now);
    }
    rewear(save, now);
    const had = [...save.notes.keys()];
    trim(save);
    for (const id of had) if (!save.notes.has(id)) this.gone.add(id);
    const sq: Rec[] = [], lm: [string, MarkRec][] = [], cards: Note[] = [];
    for (const r of save.squares.values()) if (this.written.get(`sq:${r.key}`) !== sqPrint(r)) sq.push(r);
    for (const [k, m] of save.marks) if (this.written.get(`lm:${k}`) !== JSON.stringify(markRow(m))) lm.push([k, m]);
    for (const n of save.notes.values()) if (this.written.get(`cards:${n.id}`) !== JSON.stringify(noteRow(n))) cards.push(n);
    const meta = metaRow(save) !== this.written.get('meta'), gone = [...this.gone].filter((id) => !save.notes.has(id));
    if (!sq.length && !lm.length && !cards.length && !meta && !gone.length) return { rows: 0, changed: [] };
    try {
      const changed = await this.tx('readwrite', (st) => {
        const theirs: Rec[] = [];
        for (const r of sq) {
          const g = st.sq.get(r.key);
          g.onsuccess = () => {
            const was = g.result instanceof Uint8Array && g.result.length === REC ? unpack(g.result) : null, j = joinRec(was ?? undefined, r)!;
            st.sq.put(pack(j), r.key);
            if (j !== r) {
              save.squares.set(j.key, j);
              theirs.push(j);
            }
          };
        }
        for (const [k, m] of lm) {
          const g = st.lm.get(k);
          g.onsuccess = () => {
            const was = fromRows([], [[k, g.result]], [], null).save.marks.get(k), j = joinMark(was, m)!;
            st.lm.put(markRow(j), k);
            save.marks.set(k, j);
          };
        }
        for (const n of cards) {
          const g = st.cards.get(n.id);
          g.onsuccess = () => {
            const was = g.result !== undefined ? fromRows([], [], [g.result], null).save.notes.get(n.id) : undefined, j = joinNote(was, n)!;
            st.cards.put(noteRow(j), n.id);
            save.notes.set(n.id, j);
          };
        }
        for (const id of gone) st.cards.delete(id);
        if (meta) {
          const g = st.meta.get('meta');
          g.onsuccess = () => {
            const was = fromRows([], [], [], g.result).save, mine = { ...emptySave(), crew: save.crew, climbs: save.climbs, forgot: save.forgot, seen: save.seen };
            const j = trim(joinSave(mine, was));
            save.crew = j.crew;
            save.climbs = j.climbs;
            save.forgot = j.forgot;
            save.seen = j.seen;
            st.meta.put(metaRow(j), 'meta');
          };
        }
        return () => theirs;
      });
      for (const r of sq) {
        const now2 = save.squares.get(r.key)!;
        this.written.set(`sq:${r.key}`, sqPrint(now2));
      }
      for (const [k] of lm) this.written.set(`lm:${k}`, JSON.stringify(markRow(save.marks.get(k)!)));
      for (const n of cards) this.written.set(`cards:${n.id}`, JSON.stringify(noteRow(save.notes.get(n.id)!)));
      for (const id of gone) this.gone.delete(id), this.written.delete(`cards:${id}`);
      if (meta) this.written.set('meta', metaRow(save));
      return { rows: sq.length + lm.length + cards.length + gone.length + (meta ? 1 : 0), changed };
    } catch {
      // (the database failed under us: M1's save from here on, and nothing of this write lost)
      this.where = this.env.localStorage ? 'journal' : 'memory';
      this.drop(this.db);
      return this.writeJournal(save, now);
    }
  }

  private writeJournal(save: Save, now?: unknown): { rows: number; changed: Rec[] } {
    if (!this.env.localStorage) return { rows: 0, changed: [] };
    const before = new Map([...save.squares].map(([k, r]) => [k, sqPrint(r)]));
    const f = flush(save, storageBackend(this.env.localStorage, this.slug), now);
    const changed: Rec[] = [];
    for (const r of f.save.squares.values()) if (before.get(r.key) !== sqPrint(r)) changed.push(r);
    Object.assign(save, f.save);
    return { rows: f.wrote ? 1 : 0, changed };
  }

  /**
   * The whole save into localStorage now, synchronously: on `pagehide` (and `visibilitychange` to hidden), when no write can be awaited. What is
   * stored there is joined in first, as M1's flush does. False where localStorage refused it.
   */
  journal(save: Save, now?: unknown): boolean {
    if (!this.env.localStorage) return false;
    try {
      return flush(save, storageBackend(this.env.localStorage, this.slug), now).wrote;
    } catch {
      return false;
    }
  }

  /** Ask the browser to keep the site's data under storage pressure. True if it will. Never throws; asks nothing where the browser has no such call. */
  async persist(): Promise<boolean> {
    const s = this.env.storage;
    try {
      if (s?.persisted && (await s.persisted())) return true;
      return s?.persist ? !!(await s.persist()) : false;
    } catch {
      return false;
    }
  }
}
