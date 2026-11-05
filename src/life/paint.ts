// A mover's paint, kept (LIFE.md, "Paint on a mover"; CONTRACT.md section 3, O14): one record a painted mover, its key, hue, level, `until` (UTC ms, read
// against Date.now()) and the namespace that placed it, in a database of its own in IndexedDB. 2,000 records and 256 KB at most, the soonest `until` first out.
// Under ?t=, ?rate= or ?fixeddt a test store of its own, so a test never expires or purges the real one. Blocked IndexedDB: the paint lasts the session.

export interface PaintRecord {
  key: string;
  hue: number;
  level: number;
  until: number;
  ns: string;
}

const MAX_RECORDS = 2000;
const MAX_BYTES = 256 * 1024;

export class MoverStore {
  private db: Promise<IDBDatabase> | null = null;
  private readonly name: string;
  /** what's kept, by key: written through to IndexedDB */
  readonly records = new Map<string, PaintRecord>();
  private bytes = 0;

  constructor(test: boolean) {
    this.name = test ? 'strugglebus.life.test.v1' : 'strugglebus.life.v1';
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((ok, no) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('paint', { keyPath: 'key' });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    return this.db;
  }

  /** Everything kept that hasn't expired, `now` the real clock's (Date.now()): what's past its `until` goes. */
  async load(now: number): Promise<PaintRecord[]> {
    try {
      const db = await this.open();
      const all = await new Promise<PaintRecord[]>((ok, no) => {
        const q = db.transaction('paint', 'readonly').objectStore('paint').getAll();
        q.onsuccess = () => ok(q.result as PaintRecord[]);
        q.onerror = () => no(q.error);
      });
      const gone: string[] = [];
      for (const r of all) {
        if (!r || typeof r.key !== 'string' || !(r.until > now)) {
          if (r?.key) gone.push(r.key);
          continue;
        }
        this.records.set(r.key, r);
        this.bytes += r.key.length + 40;
      }
      if (gone.length) void this.remove(gone);
      return [...this.records.values()];
    } catch {
      return [];
    }
  }

  /** A record kept, and past the caps the soonest `until` out. */
  put(r: PaintRecord): void {
    const was = this.records.get(r.key);
    if (!was) this.bytes += r.key.length + 40;
    this.records.set(r.key, r);
    const drop: string[] = [];
    if (this.records.size > MAX_RECORDS || this.bytes > MAX_BYTES) {
      const by = [...this.records.values()].sort((a, b) => a.until - b.until);
      for (const x of by) {
        if (this.records.size <= MAX_RECORDS && this.bytes <= MAX_BYTES) break;
        this.records.delete(x.key);
        this.bytes -= x.key.length + 40;
        drop.push(x.key);
      }
    }
    void this.open()
      .then((db) => {
        const t = db.transaction('paint', 'readwrite'), s = t.objectStore('paint');
        s.put(r);
        for (const k of drop) s.delete(k);
      })
      .catch(() => undefined);
  }

  private async remove(keys: string[]): Promise<void> {
    try {
      const db = await this.open(), s = db.transaction('paint', 'readwrite').objectStore('paint');
      for (const k of keys) s.delete(k);
    } catch {
      /* blocked */
    }
  }

  /** The tuner's reset: every record gone. */
  clear(): void {
    this.records.clear();
    this.bytes = 0;
    void this.open()
      .then((db) => db.transaction('paint', 'readwrite').objectStore('paint').clear())
      .catch(() => undefined);
  }
}
