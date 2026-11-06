// The areas (FACTIONS.md section 5, step 4, and section 1's "The studio's view" and section 3's "Neighbourhoods", decisions 27 and 28, approved 2026-11-06;
// STAGES.md section 1 underneath where those don't change it). The city is cut into 128 m squares, one owner each, stage 0 (grey) to 4: skin, roofs, streets,
// the Lift. An owner's ready hit climbs one stage, a rival's ready hit knocks one off, and the hit that knocks a stage-1 square off takes it over. Stage 4
// takes two rival hits to lose: the first cracks it, and an owner's hit heals the crack (decision 16). A stage changes at most once every five seconds,
// whoever moves it; a crack or a heal starts the five seconds again (decision 16). Every change lands on the beat (beat.ts's Slots: two a second across the
// city, at most a bar late). Solo, nothing decays (STAGES.md 1.3). Saved one city a key, 16 bytes a square.
//
// The fifth stage, the god, belongs to a neighbourhood (`Realm`, neighbourhoods.ts): one at most, at its heart. It rises when a faction holds half the
// neighbourhood's squares at stage 3 or more, the heart's ring of 8 has reached the Lift, and the heart is at 4: its owner's next ready hit on the heart raises
// it. Toppling it takes 5 to 9 rival hits at the heart by the neighbourhood's size, fewer for the leader's (the Crown, decision 17), each a crack an owner's hit
// heals one of; the last gives the heart to the attacker at stage 1. Losing the half doesn't topple it. A Possessed bus's hiccups only ever claim grey at
// stage 1, so they never call a god. Pure and worker-safe: nothing here draws, and the host shows each change at its `at`.

import { Beat, Slots } from './beat';

/** Who owns a square. 0 is grey; Rainbow is 1, as PaintState's FACTION_RAINBOW. */
export const Faction = { GREY: 0, RAINBOW: 1, ATLANTIS: 2, ELDERWOOD: 3, HYPERGLOW: 4, INFERNO: 5 } as const;

export const areaTune = {
  /** a square's side (m): STAGES.md's decision 1, on the terrain's 256 m tiles' grid */
  size: 128,
  /** s between a square's changes, whoever makes them */
  cooldown: 5,
  /** a square's top stage, the Lift (decision 27); the god is the heart's fifth */
  top: 4,
  /** where the map tags worship, cemetery, memorial, school or hospital, a square stops at the streets */
  tagged: 3,
  /** rival hits to take a square's stage off, by the stage: 4 takes two (a crack, then the fall), the rest one */
  hitsToDrop: [1, 1, 1, 1, 2],
};

export const godTune = {
  /** the god's stage at a heart */
  stage: 5,
  /** the share of a neighbourhood's squares a faction holds at `held` or more to raise its god */
  half: 0.5,
  held: 3,
  /** rival hits to topple a god: `fewest` at `small` km² or less, `most` at `big` or more, between by the land */
  fewest: 5,
  most: 9,
  small: 0.5,
  big: 3,
  /** its height (m): `tallest` times 55 % at `small` km² or less, rising to 100 % at `big` (the one adjustable number) */
  tallest: 450,
  shortest: 0.55,
  /** the Crown (decision 17, adjustable): the leading faction's gods fall to this many fewer hits; 0 is off */
  crown: 2,
  /** Recess's score: a point a stage a square, and this a god held */
  godPoints: 36,
};

/** A 128 m square's key: ix and iz as two 16-bit halves. */
export function squareKey(x: number, z: number): number {
  const s = areaTune.size;
  return packSquare(Math.floor(x / s), Math.floor(z / s));
}
export function packSquare(ix: number, iz: number): number {
  return (((ix & 0xffff) << 16) | (iz & 0xffff)) >>> 0;
}
export function squareIx(key: number): number {
  return (key >>> 16) << 16 >> 16;
}
export function squareIz(key: number): number {
  return (key & 0xffff) << 16 >> 16;
}
export function squareCentre(key: number): { x: number; z: number } {
  const s = areaTune.size;
  return { x: (squareIx(key) + 0.5) * s, z: (squareIz(key) + 0.5) * s };
}

/** The neighbourhoods over the squares (decision 28): which a square is in, each one's heart, squares and land. neighbourhoods.ts has the stand-ins; the
 *  world's files will have the real ones, from map data, once the first account bakes them. */
export interface Realm {
  /** how many there are: ids 0 to count - 1 */
  readonly count: number;
  /** the neighbourhood a square is in, -1 for none (water, outside the map) */
  of(key: number): number;
  /** its heart square */
  heart(n: number): number;
  /** its squares */
  squares(n: number): readonly number[];
  /** its land (km²) */
  km2(n: number): number;
  name(n: number): string;
  /** no god here: too small, or its heart on a tagged place */
  godless(n: number): boolean;
  /** a square's top stage: areaTune.top, or areaTune.tagged where the map tags it */
  top(key: number): number;
}

/** One square's record. */
export interface Area {
  key: number;
  faction: number;
  /** 0 to 4, and 5 at a heart where a god stands */
  stage: number;
  /** rival hits that haven't knocked it off yet: a square's stage 4 holds one, a god up to its topple's less one */
  cracks: number;
  /** the owner's landed hits since it claimed the square, encores included */
  hits: number;
  /** epoch s of the owner's last landed hit or change: the shared world's weathering clock, kept solo too */
  tended: number;
  /** the game time of its last change, -Infinity after a spill's claim (an aimed hit may climb it at once) */
  last: number;
  /** the last super that counted here: one hit a square a super */
  superId: number;
  /** where its things stand, saved so they show before the tiles come: m in the square, and the ground's height (dm) */
  ax: number;
  az: number;
  ay: number;
}

/**
 * What a hit did: claim (grey to stage 1), up, encore (the owner's, cooling or at the top), crack, heal, down, flip (the rival owns it at stage 1),
 * parry (a rival's, cooling), none (a spill or a hiccup on someone's ground, or a repeat of one super); at a heart, god (the god rises) and topple (the last
 * hit on a god: the heart the attacker's at stage 1).
 */
export type Outcome = 'claim' | 'up' | 'encore' | 'crack' | 'heal' | 'down' | 'flip' | 'parry' | 'none' | 'god' | 'topple';

export interface HitResult {
  area: Area;
  outcome: Outcome;
  /** when it shows (game s): a change on its beat, anything else now */
  at: number;
}

export interface HitOptions {
  /** a super's id (SuperSplat's): it counts once a square */
  superId?: number;
  /** epoch s now, for `tended` */
  now?: number;
}

/** Where a neighbourhood stands, for the host's ring, sky mark, borders and street sign. */
export interface Standing {
  /** each faction's squares at godTune.held or more */
  held: number[];
  /** the faction holding half of it at that, 0 for none */
  holder: number;
  /** the heart's ring of 8 (those in the neighbourhood) all at the Lift, the holder's */
  ringLifted: boolean;
  heart: Area | undefined;
  /** the holder's sky mark over the heart, at stage 4 there: a god is coming */
  skyMark: number;
  /** the faction whose god stands, 0 for none, its cracks and its topple's hits */
  god: number;
  cracks: number;
  topple: number;
}

export class Areas {
  readonly all = new Map<number, Area>();
  readonly slots: Slots;
  readonly beat: Beat;
  realm: Realm | null;
  /** told each square whose record changed, for the save's debounce */
  onChange?: (a: Area) => void;

  constructor(beat: Beat = new Beat(), realm: Realm | null = null) {
    this.beat = beat;
    this.realm = realm;
    this.slots = new Slots(beat);
  }

  get(x: number, z: number): Area | undefined {
    return this.all.get(squareKey(x, z));
  }

  private make(key: number): Area {
    let a = this.all.get(key);
    if (!a) {
      a = { key, faction: 0, stage: 0, cracks: 0, hits: 0, tended: 0, last: -Infinity, superId: 0, ax: 0, az: 0, ay: 0 };
      this.all.set(key, a);
    }
    return a;
  }

  /** A square's top: the Lift, or the streets where the map tags it. */
  topOf(key: number): number {
    return Math.min(areaTune.top, this.realm ? this.realm.top(key) : areaTune.top);
  }

  /** An aimed hit (a tap's blast, a super's release, the firehose's swath, a closer: STAGES.md 1.2) by `faction` at (x, z), game time t. */
  hit(x: number, z: number, faction: number, t: number, o: HitOptions = {}): HitResult {
    const a = this.make(squareKey(x, z));
    if (o.superId) {
      if (a.superId === o.superId) return { area: a, outcome: 'none', at: t };
      a.superId = o.superId;
    }
    const ready = t - a.last >= areaTune.cooldown, own = a.faction === faction;
    let out: Outcome;
    if (a.faction === 0) out = 'claim';
    else if (a.stage === godTune.stage) {
      const n = this.realm ? this.realm.of(a.key) : -1;
      if (own) out = a.cracks > 0 ? 'heal' : 'encore';
      else if (!ready) out = 'parry';
      else out = a.cracks + 1 >= this.toppleHits(n, a.faction) ? 'topple' : 'crack';
    } else if (own) {
      if (a.cracks > 0) out = 'heal';
      else if (!ready) out = 'encore';
      else if (a.stage < this.topOf(a.key)) out = 'up';
      else out = this.mayRaise(a, faction) ? 'god' : 'encore';
    } else if (!ready) out = 'parry';
    else if (a.stage <= 1) out = 'flip';
    else if (a.cracks + 1 < areaTune.hitsToDrop[a.stage]) out = 'crack';
    else out = 'down';
    return { area: a, outcome: out, at: this.apply(a, out, faction, t, o.now) };
  }

  /** The same blast's spill on a square it isn't aimed at, or a Possessed bus's hiccup: grey becomes `faction`'s at stage 1, ready at once; nobody's ground changes. */
  spill(x: number, z: number, faction: number, t: number, o: HitOptions = {}): HitResult {
    const key = squareKey(x, z), a = this.all.get(key);
    if (a && a.faction !== 0) return { area: a, outcome: 'none', at: t };
    const b = a ?? this.make(key);
    b.faction = faction;
    b.stage = 1;
    b.cracks = 0;
    b.hits = 0;
    b.last = -Infinity;
    if (o.now !== undefined) b.tended = o.now;
    this.onChange?.(b);
    return { area: b, outcome: 'claim', at: this.slots.book(t) };
  }

  private apply(a: Area, out: Outcome, faction: number, t: number, now?: number): number {
    if (out === 'none' || out === 'parry') return t;
    const owner = out === 'claim' || out === 'flip' || out === 'topple' || a.faction === faction;
    if (owner && now !== undefined) a.tended = now;
    switch (out) {
      case 'encore':
        a.hits++;
        this.onChange?.(a);
        return t;
      case 'crack':
      case 'heal':
        a.cracks += out === 'crack' ? 1 : -1;
        if (out === 'heal') a.hits++;
        a.last = t;
        this.onChange?.(a);
        return t;
      case 'claim':
      case 'flip':
      case 'topple':
        a.faction = faction;
        a.stage = 1;
        a.hits = 1;
        break;
      case 'up':
      case 'god':
        a.stage = out === 'god' ? godTune.stage : a.stage + 1;
        a.hits++;
        break;
      case 'down':
        a.stage--;
        break;
    }
    a.cracks = 0;
    a.last = t;
    this.onChange?.(a);
    return this.slots.book(t);
  }

  // ---- the neighbourhoods ----

  /** A god may rise on heart square `a` for `faction`: it's a god's heart, at the Lift, and the faction holds the neighbourhood with the ring lifted. */
  private mayRaise(a: Area, faction: number): boolean {
    const R = this.realm;
    if (!R || a.stage !== areaTune.top) return false;
    const n = R.of(a.key);
    if (n < 0 || R.godless(n) || R.heart(n) !== a.key) return false;
    const s = this.standing(n);
    return s.holder === faction && s.ringLifted;
  }

  /** The heart's ring: the 8 squares round it that are in its neighbourhood. */
  ring(n: number): number[] {
    const R = this.realm!, h = R.heart(n), ix = squareIx(h), iz = squareIz(h), out: number[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const k = packSquare(ix + dx, iz + dz);
        if (R.of(k) === n) out.push(k);
      }
    return out;
  }

  standing(n: number): Standing {
    const R = this.realm!, held = [0, 0, 0, 0, 0, 0], sq = R.squares(n);
    for (const k of sq) {
      const a = this.all.get(k);
      if (a && a.faction && a.stage >= godTune.held) held[a.faction]++;
    }
    let holder = 0;
    for (let f = 1; f < held.length; f++) if (held[f] >= sq.length * godTune.half && held[f] > 0) holder = f;
    const heart = this.all.get(R.heart(n)), god = heart && heart.stage === godTune.stage ? heart.faction : 0;
    const ringLifted = holder > 0 && this.ring(n).every((k) => {
      const a = this.all.get(k);
      return !!a && a.faction === holder && a.stage >= Math.min(areaTune.top, this.topOf(k));
    });
    const skyMark = !god && holder && heart && heart.faction === holder && heart.stage === areaTune.top && !R.godless(n) ? holder : 0;
    return { held, holder, ringLifted, heart, skyMark, god, cracks: god ? heart!.cracks : 0, topple: god ? this.toppleHits(n, god) : 0 };
  }

  /** Rival hits to topple neighbourhood n's god, `faction`'s: 5 to 9 by its land, the Crown's fewer for the leader. */
  toppleHits(n: number, faction: number): number {
    const T = godTune, km2 = n >= 0 && this.realm ? this.realm.km2(n) : 0;
    const f = Math.max(0, Math.min(1, (km2 - T.small) / (T.big - T.small)));
    const hits = Math.round(T.fewest + f * (T.most - T.fewest));
    return Math.max(1, hits - (T.crown && this.leader() === faction ? T.crown : 0));
  }

  /** A god's height (m), by its neighbourhood's land. */
  godHeight(n: number): number {
    const T = godTune, f = Math.max(0, Math.min(1, (this.realm!.km2(n) - T.small) / (T.big - T.small)));
    return T.tallest * (T.shortest + f * (1 - T.shortest));
  }

  /** The leading faction, by squares and stages, a god's heart counting its 5; 0 when none leads alone. */
  leader(): number {
    const s = this.score(undefined, 0);
    let best = 0, tie = false;
    for (let f = 1; f < s.length; f++) {
      if (s[f] > s[best]) {
        best = f;
        tie = false;
      } else if (f !== best && s[f] === s[best] && s[f] > 0) tie = true;
    }
    return tie || !s[best] ? 0 : best;
  }

  /** Each faction's score: a point a stage a square, and `godPoints` a god held (Recess's), over the squares `inside` lets in. */
  score(inside: (a: Area) => boolean = () => true, godPoints = godTune.godPoints): number[] {
    const s = [0, 0, 0, 0, 0, 0];
    for (const a of this.all.values()) {
      if (!a.faction || !inside(a)) continue;
      s[a.faction] += a.stage === godTune.stage ? areaTune.top + godPoints : a.stage;
    }
    return s;
  }

  // ---- the save (STAGES.md 1.5): 16 bytes a square, base64, one key a city ----

  /** The key a city's squares are saved under. */
  static keyFor(slug: string): string {
    return `strugglebus.areas.v1:${slug}`;
  }

  /** Every owned square, 16 bytes each: the key (its two 16-bit halves), faction, stage (its cracks in the top four bits), hits, tended, and its anchor (2 bytes of m, 2 of dm). */
  encode(): string {
    const owned = [...this.all.values()].filter((a) => a.faction !== 0).sort((p, q) => p.key - q.key);
    const b = new Uint8Array(owned.length * 16), v = new DataView(b.buffer);
    owned.forEach((a, i) => {
      const o = i * 16;
      v.setUint32(o, a.key, true);
      v.setUint8(o + 4, a.faction);
      v.setUint8(o + 5, a.stage | (Math.min(15, a.cracks) << 4));
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

  /** Read a save back over what's here. A save it can't read (not base64, a length not of 16s, a stage past the god's) leaves everything as it was, and says so. */
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
      const sb = v.getUint8(o + 5), stage = sb & 15, faction = v.getUint8(o + 4);
      if (stage < 1 || stage > godTune.stage || faction < 1 || faction > 15) return false;
      read.push({
        key: v.getUint32(o, true), faction, stage, cracks: sb >> 4, hits: v.getUint16(o + 6, true), tended: v.getUint32(o + 8, true),
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
