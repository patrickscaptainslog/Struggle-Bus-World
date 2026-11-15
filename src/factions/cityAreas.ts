// The areas engine in the open world (STUDIO.md part 7, #11; M2's "My street floats"): areas.ts's rules on every square of the city, saved through
// src/link/save.ts. It answers liftRules.ts's TakeRules call for call (all, topOf, get, seed, ready, peek, hit, outcomeOf), so the Lift takes it in
// place of the stand-in; and it answers the save for every change: the engine's onChange writes the square's record (touch), a tile that loads gives
// records their anchors and the phone's old paint its squares (landTile), a postcard's squares come into the engine held until their Flyby has shown,
// and a square the player takes back from a postcard marks that card taken. The gods are stopped (CLAUDE.md, 2026-11-14): no square here rises
// to one, and a god a save holds (none has ever been saved in the open world) rests at the Lift in the engine, its record kept as it is until the
// square changes. So the outcomes are liftRules.ts's own, and this drops in where the Lift types the stand-in. Pure and worker-safe: nothing here draws, and the host shows each change at its `at`.

import { Areas, areaTune, squareCentre, squareKey } from './areas';
import type { Area, HitOptions, Outcome, Realm } from './areas';
import { Beat } from './beat';
import { crewOf, fromAreasText, joinSave, emptySave, landTile, noteTaken, touch } from '../link/save';
import type { Frame, Ground, Landing, Note, Rec, Save, TileSquare } from '../link/save';

/** What a hit can do here: areas.ts's outcomes below the god, which are liftRules.ts's. */
export type CityOutcome = Exclude<Outcome, 'god' | 'guard' | 'topple'>;

/** What a hit did here: areas.ts's, and the postcard the player took back by it (its note, now marked taken), or null. */
export interface CityHit {
  area: Area;
  outcome: CityOutcome;
  /** when it shows (game s): a change on its beat, anything else now */
  at: number;
  taken: Note | null;
}

export interface CityOptions {
  /** epoch ms now, for the save's `rev` and a square's `tended` (Date.now in the game; a stand-in in Node) */
  now?: () => number;
  /** a loaded tile's anchor for a square, or null where its tile isn't in */
  ground?: Ground;
  beat?: Beat;
}

/** A realm with every neighbourhood godless: the engine's own rules, and no god ever rises. */
function noGods(realm: Realm): Realm {
  return {
    get count() {
      return realm.count;
    },
    of: (key) => realm.of(key),
    heart: (n) => realm.heart(n),
    squares: (n) => realm.squares(n),
    km2: (n) => realm.km2(n),
    name: (n) => realm.name(n),
    godless: () => true,
    top: (key) => realm.top(key),
  };
}

/** A saved record as the engine's square: ready at once (`last` -Infinity), or held (+Infinity) until the host says. A god rests at the Lift. */
function areaOf(r: Rec, held: boolean): Area {
  const god = r.stage > areaTune.top;
  return {
    key: r.key, faction: r.owner, stage: god ? areaTune.top : r.stage, cracks: god ? 0 : r.cracks, hits: r.hits, tended: r.tended, last: held ? Infinity : -Infinity, superId: 0,
    ax: r.ay === -32768 ? 0 : r.ax, az: r.ay === -32768 ? 0 : r.az, ay: r.ay === -32768 ? 0 : r.ay,
  };
}

export class CityAreas {
  readonly engine: Areas;
  save: Save;
  private readonly now: () => number;
  private readonly ground: Ground | undefined;
  /** squares the staged block seeded: the demo's, never saved */
  private readonly seeded = new Set<number>();
  /** squares a postcard put here, held until their Flyby has shown */
  private readonly held = new Set<number>();

  constructor(save: Save, realm: Realm | null, opts: CityOptions = {}) {
    this.save = save;
    this.now = opts.now ?? (() => Date.now());
    this.ground = opts.ground;
    this.engine = new Areas(opts.beat ?? new Beat(), realm ? noGods(realm) : null);
    for (const r of save.squares.values()) this.engine.all.set(r.key, areaOf(r, false));
    this.engine.onChange = (a) => {
      if (this.seeded.has(a.key)) return;
      touch(this.save, a, this.now(), this.ground);
    };
  }

  /** The save before this one (areas.ts's strugglebus.areas.v1:<slug>), brought in under everything newer: once, at a phone's first run of this one. */
  static adoptOld(save: Save, text: string | null): number {
    const old = text ? fromAreasText(text) : null;
    if (!old) return 0;
    const from = emptySave();
    from.squares = old.squares;
    save.squares = joinSave(save, from).squares;
    return old.squares.size;
  }

  // ---- liftRules.ts's TakeRules, call for call ----

  get all(): Map<number, Area> {
    return this.engine.all;
  }

  topOf(key: number): number {
    return this.engine.topOf(key);
  }

  get(key: number): Area | undefined {
    return this.engine.all.get(key);
  }

  /** A square's record from the start (the staged block's: `?lift`): `last` +Infinity keeps it parrying until the Lift readies it. A demo: never saved. */
  seed(key: number, faction: number, stage: number, last: number): Area {
    const a: Area = { key, faction, stage: Math.min(stage, this.topOf(key)), cracks: 0, hits: 0, tended: 0, last, superId: 0, ax: 0, az: 0, ay: 0 };
    this.engine.all.set(key, a);
    this.seeded.add(key);
    return a;
  }

  /** It takes a counted change now (t - last >= cooldown). */
  ready(a: Area, t: number): boolean {
    return t - a.last >= areaTune.cooldown;
  }

  /** What an aimed hit by `faction` would do now, changing nothing. A grey square claims. */
  peek(x: number, z: number, faction: number, t: number): CityOutcome {
    return this.engine.peek(x, z, faction, t) as CityOutcome;
  }

  /** What a hit by `faction` would do to square `a` now (the square in the engine at a's key). */
  outcomeOf(a: Area, faction: number, t: number): CityOutcome {
    const c = squareCentre(a.key);
    return this.engine.peek(c.x, c.z, faction, t) as CityOutcome;
  }

  /**
   * An aimed hit by `faction` at (x, z) (m), game time t: areas.ts's, saved. Where it is the player's, and takes back the own square of a postcard the
   * player opened, that card is taken (`taken`): TAKEN, and the reply's `answers`.
   */
  hit(x: number, z: number, faction: number, t: number, o: HitOptions = {}): CityHit {
    const key = squareKey(x, z), before = this.save.squares.get(key), was = before ? { ...before } : null;
    const h = this.engine.hit(x, z, faction, t, { ...o, now: Math.floor(this.now() / 1000) });
    let taken: Note | null = null;
    if (h.outcome === 'flip' && faction === crewOf(this.save) && !this.seeded.has(key)) taken = noteTaken(this.save, key, was, this.now());
    return { area: h.area, outcome: h.outcome as CityOutcome, at: h.at, taken };
  }

  /** A blast's spill, or a hiccup, on a square it isn't aimed at: grey becomes `faction`'s at stage 1; nobody's ground changes. Saved. */
  spill(x: number, z: number, faction: number, t: number): CityHit {
    const h = this.engine.spill(x, z, faction, t, { now: Math.floor(this.now() / 1000) });
    return { area: h.area, outcome: h.outcome as CityOutcome, at: h.at, taken: null };
  }

  // ---- the save's side ----

  /** A tile has loaded: its squares' anchors, and the phone's old paint where a square has no record (save.ts's landTile). Returns the squares it made or changed. */
  tileIn(squares: readonly TileSquare[], frame: Pick<Frame, 'top'>): Area[] {
    const out: Area[] = [];
    for (const r of landTile(this.save, squares, frame)) {
      if (this.seeded.has(r.key)) continue;
      const a = this.engine.all.get(r.key);
      if (a && a.faction === r.owner && a.stage === r.stage) {
        a.ax = r.ax;
        a.az = r.az;
        a.ay = r.ay;
        out.push(a);
      } else if (!a) {
        const b = areaOf(r, false);
        this.engine.all.set(r.key, b);
        out.push(b);
      }
    }
    return out;
  }

  /**
   * A postcard has landed (save.ts's openLink): its squares into the engine, held (they parry a rival and give the player's own hits nothing) until
   * `release` says their Flyby has shown them. Returns the squares, in the card's order.
   */
  land(landing: Landing): Area[] {
    const out: Area[] = [];
    for (const l of landing.landed) {
      if (this.seeded.has(l.rec.key)) continue;
      const a = areaOf(l.rec, true);
      this.engine.all.set(l.rec.key, a);
      this.held.add(l.rec.key);
      out.push(a);
    }
    return out;
  }

  /** A held square's Flyby beat has shown: it takes hits from now. With no key, all of them (the Flyby skipped, or over). */
  release(key?: number): void {
    for (const k of key === undefined ? [...this.held] : [key]) {
      if (!this.held.delete(k)) continue;
      const a = this.engine.all.get(k);
      if (a && a.last === Infinity) a.last = -Infinity;
    }
  }

  /** Is this square held for its Flyby? */
  holding(key: number): boolean {
    return this.held.has(key);
  }

  /**
   * After a flush brought in another tab's work (save.ts's flush and changedSquares): the save this tab goes on with, and the squares the engine must
   * take from it. A square changed elsewhere is ready at once here. Returns the engine's squares that changed, to redraw.
   */
  absorb(save: Save, changed: readonly Rec[]): Area[] {
    this.save = save;
    const out: Area[] = [];
    for (const r of changed) {
      if (this.seeded.has(r.key)) continue;
      const a = this.engine.all.get(r.key), b = areaOf(r, this.held.has(r.key));
      if (a) {
        b.superId = a.superId;
        Object.assign(a, b);
        out.push(a);
      } else {
        this.engine.all.set(r.key, b);
        out.push(b);
      }
    }
    return out;
  }
}
