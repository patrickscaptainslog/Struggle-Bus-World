// The areas (FACTIONS.md section 5, step 4; the rules are STAGES.md section 1, as FACTIONS.md section 3 and decision 16 change them). The city is cut into
// areas, one owner each, stage 0 (grey) to 4. An owner's ready hit climbs one stage, a rival's ready hit knocks one off, and the hit that knocks a stage-1
// area off takes it over. Stage 4 takes two rival hits to lose: the first cracks it, and an owner's hit heals the crack (decision 16). A stage changes at
// most once every five seconds, whoever moves it; a crack or a heal on stage 4 starts the five seconds again (decision 16). Every change lands on the beat
// (beat.ts's Slots: two a second across the city, at most a bar late). Solo, nothing decays (STAGES.md 1.3). Saved one city a key, 16 bytes an area.
//
// Open with the producer, so held out of this: stage 5, the god (decision 27, how many stages), and what an area is, a 128 m square or a neighbourhood
// (decision 28). The second is one switch, `Partition`: everything here goes through its key(), and `squares` is the only one built.
// Pure and worker-safe: nothing here draws, and the host shows each change at its `at`.

import { Beat, Slots } from './beat';

/** Who owns an area. 0 is grey; Rainbow is 1, as PaintState's FACTION_RAINBOW. */
export const Faction = { GREY: 0, RAINBOW: 1, ATLANTIS: 2, ELDERWOOD: 3, HYPERGLOW: 4, INFERNO: 5 } as const;

export const areaTune = {
  /** a square's side (m): STAGES.md's decision 1, on the terrain's 256 m tiles' grid */
  size: 128,
  /** s between an area's changes, whoever makes them */
  cooldown: 5,
  /** the top stage, until decision 27 says how many: 5, the god, stays out */
  top: 4,
  /** rival hits to take a stage off, by the stage: 4 takes two (a crack, then the fall), the rest one. Index by stage. */
  hitsToDrop: [1, 1, 1, 1, 2, 2],
};

/** What an area is: decision 28's switch. A key for any point, and a point to stand an area's things on. */
export interface Partition {
  readonly name: string;
  key(x: number, z: number): number;
  centre(key: number): { x: number; z: number };
}

/** 128 m squares, world-aligned (STAGES.md 1.1): the key packs ix and iz as two 16-bit halves. */
export const squares: Partition = {
  name: 'square',
  key(x, z) {
    const s = areaTune.size;
    return (((Math.floor(x / s) & 0xffff) << 16) | (Math.floor(z / s) & 0xffff)) >>> 0;
  },
  centre(key) {
    const s = areaTune.size, ix = (key >>> 16) << 16 >> 16, iz = (key & 0xffff) << 16 >> 16;
    return { x: (ix + 0.5) * s, z: (iz + 0.5) * s };
  },
};

/** One area's record. */
export interface Area {
  key: number;
  faction: number;
  stage: number;
  /** a rival hit on stage 4 that hasn't knocked it off yet */
  cracked: boolean;
  /** the owner's landed hits since it claimed the area, encores included */
  hits: number;
  /** epoch s of the owner's last landed hit or change: the shared world's weathering clock, kept solo too */
  tended: number;
  /** the game time of its last change, -Infinity after a spill's claim (an aimed hit may climb it at once) */
  last: number;
  /** the last super that counted here: one hit an area a super */
  superId: number;
  /** where its things stand, saved so they show before the tiles come: m in the area, and the ground's height (dm) */
  ax: number;
  az: number;
  ay: number;
}

/**
 * What a hit did: claim (grey to stage 1), up, encore (the owner's, cooling or at the top), crack, heal, down, flip (the rival owns it at stage 1),
 * parry (a rival's, cooling), none (a spill or a hiccup on someone's ground, or a repeat of one super).
 */
export type Outcome = 'claim' | 'up' | 'encore' | 'crack' | 'heal' | 'down' | 'flip' | 'parry' | 'none';

export interface HitResult {
  area: Area;
  outcome: Outcome;
  /** when it shows (game s): a change on its beat, anything else now */
  at: number;
}

export interface HitOptions {
  /** a super's id (SuperSplat's): it counts once an area */
  superId?: number;
  /** epoch s now, for `tended` */
  now?: number;
}

export class Areas {
  readonly all = new Map<number, Area>();
  readonly slots: Slots;
  /** told each area whose record changed, for the save's debounce */
  onChange?: (a: Area) => void;

  readonly beat: Beat;
  partition: Partition;

  constructor(beat: Beat = new Beat(), partition: Partition = squares) {
    this.beat = beat;
    this.partition = partition;
    this.slots = new Slots(beat);
  }

  get(x: number, z: number): Area | undefined {
    return this.all.get(this.partition.key(x, z));
  }

  private make(key: number): Area {
    let a = this.all.get(key);
    if (!a) {
      a = { key, faction: 0, stage: 0, cracked: false, hits: 0, tended: 0, last: -Infinity, superId: 0, ax: 0, az: 0, ay: 0 };
      this.all.set(key, a);
    }
    return a;
  }

  /** An aimed hit (a tap's blast, a super's release, the firehose's swath, a closer: STAGES.md 1.2) by `faction` at (x, z), game time t. */
  hit(x: number, z: number, faction: number, t: number, o: HitOptions = {}): HitResult {
    const a = this.make(this.partition.key(x, z));
    if (o.superId) {
      if (a.superId === o.superId) return { area: a, outcome: 'none', at: t };
      a.superId = o.superId;
    }
    const ready = t - a.last >= areaTune.cooldown, own = a.faction === faction;
    let out: Outcome;
    if (a.faction === 0) out = 'claim';
    else if (own) {
      if (a.cracked) out = 'heal';
      else out = ready && a.stage < areaTune.top ? 'up' : 'encore';
    } else if (!ready) out = 'parry';
    else if (a.stage <= 1) out = 'flip';
    else if (areaTune.hitsToDrop[a.stage] > 1 && !a.cracked) out = 'crack';
    else out = 'down';
    return { area: a, outcome: out, at: this.apply(a, out, faction, t, o.now) };
  }

  /** The same blast's spill on an area it isn't aimed at, or a Possessed bus's hiccup: grey becomes `faction`'s at stage 1, ready at once; nobody's ground changes. */
  spill(x: number, z: number, faction: number, t: number, o: HitOptions = {}): HitResult {
    const key = this.partition.key(x, z), a = this.all.get(key);
    if (a && a.faction !== 0) return { area: a, outcome: 'none', at: t };
    const b = a ?? this.make(key);
    b.faction = faction;
    b.stage = 1;
    b.cracked = false;
    b.hits = 0;
    b.last = -Infinity;
    if (o.now !== undefined) b.tended = o.now;
    this.onChange?.(b);
    return { area: b, outcome: 'claim', at: this.slots.book(t) };
  }

  private apply(a: Area, out: Outcome, faction: number, t: number, now?: number): number {
    if (out === 'none' || out === 'parry') return t;
    const owner = out === 'claim' || out === 'flip' || a.faction === faction;
    if (owner && now !== undefined) a.tended = now;
    switch (out) {
      case 'encore':
        a.hits++;
        this.onChange?.(a);
        return t;
      case 'crack':
      case 'heal':
        a.cracked = out === 'crack';
        if (out === 'heal') a.hits++;
        a.last = t;
        this.onChange?.(a);
        return t;
      case 'claim':
      case 'flip':
        a.faction = faction;
        a.stage = 1;
        a.hits = 1;
        break;
      case 'up':
        a.stage++;
        a.hits++;
        break;
      case 'down':
        a.stage--;
        break;
    }
    a.cracked = false;
    a.last = t;
    this.onChange?.(a);
    return this.slots.book(t);
  }

  /** Each faction's ground: its areas' stages summed (Recess's scoreboard), over the areas `inside` lets in. */
  score(inside: (a: Area) => boolean = () => true): number[] {
    const s = [0, 0, 0, 0, 0, 0];
    for (const a of this.all.values()) if (a.faction && inside(a)) s[a.faction] += a.stage;
    return s;
  }

  // ---- the save (STAGES.md 1.5): 16 bytes an area, base64, one key a city ----

  /** The key a city's areas are saved under. */
  static keyFor(slug: string): string {
    return `strugglebus.areas.v1:${slug}`;
  }

  /** Every owned area, 16 bytes each: the key (its two 16-bit halves), faction, stage (the crack its top bit), hits, tended, and its anchor (2 bytes of m, 2 of dm). */
  encode(): string {
    const owned = [...this.all.values()].filter((a) => a.faction !== 0).sort((p, q) => p.key - q.key);
    const b = new Uint8Array(owned.length * 16), v = new DataView(b.buffer);
    owned.forEach((a, i) => {
      const o = i * 16;
      v.setUint32(o, a.key, true);
      v.setUint8(o + 4, a.faction);
      v.setUint8(o + 5, a.stage | (a.cracked ? 0x80 : 0));
      v.setUint16(o + 6, Math.min(0xffff, a.hits), true);
      v.setUint32(o + 8, a.tended >>> 0, true);
      v.setUint8(o + 12, a.ax & 0xff);
      v.setUint8(o + 13, a.az & 0xff);
      v.setInt16(o + 14, a.ay, true);
    });
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  /** Read a save back over what's here. A save it can't read (not base64, a length not of 16s, a stage past the top) leaves everything as it was, and says so. */
  decode(text: string): boolean {
    let s: string;
    try {
      s = atob(text);
    } catch {
      return false;
    }
    if (s.length % 16) return false;
    const b = Uint8Array.from(s, (c) => c.charCodeAt(0)), v = new DataView(b.buffer), read: Area[] = [];
    for (let o = 0; o < b.length; o += 16) {
      const stage = v.getUint8(o + 5) & 0x7f, faction = v.getUint8(o + 4);
      if (stage < 1 || stage > areaTune.top || faction < 1 || faction > 15) return false;
      read.push({
        key: v.getUint32(o, true), faction, stage, cracked: (v.getUint8(o + 5) & 0x80) !== 0, hits: v.getUint16(o + 6, true), tended: v.getUint32(o + 8, true),
        last: -Infinity, superId: 0, ax: v.getUint8(o + 12), az: v.getUint8(o + 13), ay: v.getInt16(o + 14, true),
      });
    }
    for (const a of read) this.all.set(a.key, a);
    return true;
  }

  /** Into a Storage (localStorage, or a stand-in in Node), and back: false when there's nothing there or it can't be read or written. */
  save(store: Pick<Storage, 'setItem'>, slug: string): boolean {
    try {
      store.setItem(Areas.keyFor(slug), this.encode());
      return true;
    } catch {
      return false;
    }
  }
  load(store: Pick<Storage, 'getItem'>, slug: string): boolean {
    let s: string | null;
    try {
      s = store.getItem(Areas.keyFor(slug));
    } catch {
      return false;
    }
    return s !== null && this.decode(s);
  }
}
