import { SQUARE, squareKey } from './liftGlsl';

// The contest's rules on the Lift's squares (docs/specs/factions/LIFT.md, "Taking the block"; STAGES.md 1.2 and 1.3 with its decision 3,
// FACTIONS.md section 3 with decisions 16, 27 and 28). A stand-in for the areas engine (src/factions/areas.ts: Areas.hit and its outcomeOf, the
// second account's), with the same numbers and outcomes, below the god: the areas layer takes its place by answering the same call. No three.js,
// no DOM: tools/factions/take-check.mjs bundles it under Node.
//
// "A white-hot front sweeps from the impact across the area at 120 m/s. Behind it, every building re-floods in the new theme" (STAGES.md 1.3, the
// flip); a knock-down: "The owner's buildings flinch (an inverted jelly squash), and the top stage's layer wilts in the owner's theme. No rival
// paint sticks."

/** What a hit did (areas.ts's Outcome below the god: no god, guard or topple here). */
export type Outcome = 'claim' | 'up' | 'encore' | 'crack' | 'heal' | 'down' | 'flip' | 'parry' | 'none';
/** tTake's code for an outcome (its second texel's a: the time plus 1e5 times this) */
export const OUTCOMES: readonly Outcome[] = ['none', 'claim', 'up', 'encore', 'crack', 'heal', 'down', 'flip', 'parry'];

/** One square's record, as areas.ts's Area (`faction` is the owner). */
export interface Area {
  key: number;
  faction: number;
  /** 0 to 4 */
  stage: number;
  /** rival hits that haven't knocked it off yet: stage 4 holds one */
  cracks: number;
  /** the owner's landed hits since it took the square, encores included */
  hits: number;
  /** the game time of its last change (+Infinity: not ready until the Lift says, B2.2) */
  last: number;
  /** the last super that counted here: one hit a square a super */
  superId: number;
}

export interface TakeHit {
  area: Area;
  outcome: Outcome;
  /** when it shows (game s): the engine books a change on its beat, the stand-in shows it at once */
  at: number;
}

/**
 * The numbers (areas.ts's areaTune; STAGES.md decisions 2 and 3), and the Lift's own: on the tuner (Take). `cooldown` s between a square's
 * changes, whoever makes them; `top` the Lift's stage, `tagged` where the map tags a square; `hitsToDrop` rival hits to take a stage off, by the
 * stage; `dwell` a firehose's impacts on a square for its one hit; `settle` a launch's age once its spring has gone (LIFT.crouch + bobIn1);
 * `front` the flip's and an up's front (m/s), `shock` the wilt's (the blast's shockwave), `fallFront` the fall's order out from the impact
 * (m/s) and `fallG` its drop (m/s², part C's motion)
 */
export const TAKE = { cooldown: 5, top: 4, tagged: 3, hitsToDrop: [1, 1, 1, 1, 2], dwell: 6, settle: 2.7, front: 120, shock: 300, fallFront: 90, fallG: 110, jitter: 0.08 };

/** A square's key from a point (m), as areas.ts's squareKey(x, z). Never liftGlsl's squareKey(ix, iz), which takes indices. */
export const keyAt = (x: number, z: number) => squareKey(Math.floor(x / SQUARE), Math.floor(z / SQUARE));

export interface HitOptions {
  /** a super's id: it counts once a square */
  superId?: number;
  /** a bigger shot's jump (the merged branch's Bomb): the hitter's own square, or a grey one, climbs this many stages at once, to `cap` (3) at most */
  jump?: number;
  cap?: number;
}

export class TakeRules {
  readonly all = new Map<number, Area>();
  constructor(private readonly tagged: ReadonlySet<number> = new Set()) {}

  /** A square's top: the Lift, or the streets where the map tags it (areas.ts topOf). */
  topOf(key: number): number {
    return this.tagged.has(key) ? Math.min(TAKE.top, TAKE.tagged) : TAKE.top;
  }

  get(key: number): Area | undefined {
    return this.all.get(key);
  }

  /** A square's record from the start (the staged block's): `last` +Infinity keeps it parrying until the Lift readies it. */
  seed(key: number, faction: number, stage: number, last: number): Area {
    const a: Area = { key, faction, stage: Math.min(stage, this.topOf(key)), cracks: 0, hits: 0, last, superId: 0 };
    this.all.set(key, a);
    return a;
  }

  /** It takes a counted change now (t - last >= cooldown). */
  ready(a: Area, t: number): boolean {
    return t - a.last >= TAKE.cooldown;
  }

  /** What an aimed hit by `faction` would do now, changing nothing (null: no record, the normal game). */
  peek(x: number, z: number, faction: number, t: number): Outcome | null {
    const a = this.all.get(keyAt(x, z));
    return a ? this.outcomeOf(a, faction, t) : null;
  }

  /**
   * An aimed hit (a tap's blast, a super's release, the firehose's swath, a closer: STAGES.md 1.2) by `faction` at (x, z) (m), game time t. Only
   * a seeded square answers: with no record it is the normal game, and null, and no record is made (a stand-in that made records would refuse the
   * player's paint on grey squares). The `claim` row is kept for the merge.
   */
  hit(x: number, z: number, faction: number, t: number, o: HitOptions = {}): TakeHit | null {
    const a = this.all.get(keyAt(x, z));
    if (!a) return null;
    // (the id is booked before the outcome, so a parried super spends it, as areas.ts)
    if (o.superId) {
      if (a.superId === o.superId) return { area: a, outcome: 'none', at: t };
      a.superId = o.superId;
    }
    if (o.jump && o.jump > 1 && (a.faction === 0 || a.faction === faction)) {
      const from = a.faction === faction ? a.stage : 0, to = Math.min(o.cap ?? 3, this.topOf(a.key), from + o.jump);
      if (to > from) {
        a.faction = faction;
        a.stage = to;
        a.cracks = 0;
        a.hits++;
        a.last = t;
        return { area: a, outcome: from === 0 ? 'claim' : 'up', at: t };
      }
    }
    const out = this.outcomeOf(a, faction, t);
    this.apply(a, out, faction, t);
    return { area: a, outcome: out, at: t };
  }

  /** areas.ts's outcomeOf, below the god: a square here stops at its top (4, or 3 tagged). */
  outcomeOf(a: Area, faction: number, t: number): Outcome {
    const ready = this.ready(a, t), own = a.faction === faction;
    if (a.faction === 0) return 'claim';
    if (own) {
      if (a.cracks > 0) return ready ? 'heal' : 'encore';
      if (!ready) return 'encore';
      return a.stage < this.topOf(a.key) ? 'up' : 'encore';
    }
    if (!ready) return 'parry';
    if (a.stage <= 1) return 'flip';
    if (a.cracks + 1 < TAKE.hitsToDrop[a.stage]) return 'crack';
    return 'down';
  }

  private apply(a: Area, out: Outcome, faction: number, t: number) {
    switch (out) {
      case 'none':
      case 'parry':
        return;
      case 'encore':
        a.hits++;
        return;
      case 'crack':
        a.cracks++;
        a.last = t;
        return;
      case 'heal':
        a.cracks -= Math.min(1, a.cracks);
        a.hits++;
        a.last = t;
        return;
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
    a.cracks = 0;
    a.last = t;
  }
}

// ------------------------------------------------------------ the session paint on a square's houses

/** What the session paint is written through (the Lift's: PaintState.stage, the gardens' clear and grow). */
export interface TakeSink {
  stage(index: number, faction: number, hue: number, level: number, bloomTime: number): void;
  clear(index: number): void;
  /** `start`: the garden's growing start (game s; -100 grown already) */
  grow(index: number, hue: number, level: number, start: number): void;
}

/** A queued write: its house, when, and its record; `garden` 1 clears it, 2 clears it and grows it at the level, 3 grows it */
interface TakeWrite {
  i: number;
  at: number;
  faction: number;
  hue: number;
  level: number;
  garden: 0 | 1 | 2 | 3;
}

/**
 * Each house's session paint (B5.3): its owner, hue and level as the takeover has them, written on every session write, so a tile streaming
 * back in puts back the takeover's, not staging's level 3 block colours. And the fronts: each change's writes queued to the moment its front
 * reaches the house (a texel holds one faction: writing at arrival is what lets a front show on the houses).
 */
export class TakeHouses {
  readonly faction: Int8Array;
  readonly hue: Int8Array;
  readonly level: Int8Array;
  private readonly q: TakeWrite[] = [];

  constructor(texels: number) {
    this.faction = new Int8Array(texels).fill(-1);
    this.hue = new Int8Array(texels).fill(-1);
    this.level = new Int8Array(texels);
  }

  /** a house the takeover holds (staged, or written since) */
  has(i: number): boolean {
    return this.faction[i] >= 0;
  }

  /** staging's write, at once */
  stage(i: number, faction: number, hue: number, level: number, sink: TakeSink, bloomTime = -1000) {
    this.faction[i] = faction;
    this.hue[i] = hue;
    this.level[i] = level;
    sink.stage(i, faction, hue, level, bloomTime);
  }

  /**
   * A counted change's writes to a square's houses (its indices, each with its distance from the impact, m), queued at t + d / speed:
   * the wilt (a level off, hue and owner kept: the gardens cleared and grown again at it, RoofSprouts.set never lowers one), the flip (the
   * hitter's at level 1, its hue kept, the garden cleared), an up (the owner's at `level`, the gardens grown at 2 and 3). The session's record
   * is the change's at once; the texel takes it at arrival.
   */
  change(kind: 'wilt' | 'flip' | 'up', houses: ArrayLike<number>, dist: ArrayLike<number>, t: number, speed: number, faction: number, level: number) {
    for (let k = 0; k < houses.length; k++) {
      const i = houses[k];
      if (!this.has(i)) continue;
      const lv = kind === 'wilt' ? Math.max(1, this.level[i] - 1) : kind === 'flip' ? 1 : level;
      const f = kind === 'wilt' ? this.faction[i] : faction;
      if (kind === 'up' && lv === this.level[i] && f === this.faction[i]) continue;
      this.faction[i] = f;
      this.level[i] = lv;
      this.q.push({ i, at: t + dist[k] / speed, faction: f, hue: this.hue[i], level: lv, garden: kind === 'up' ? (lv >= 2 ? 3 : 0) : kind === 'flip' || lv < 2 ? 1 : 2 });
    }
  }

  /** The writes whose front has reached their house by `now`: the game's pop at its arrival (bloomTime now). */
  drain(now: number, sink: TakeSink) {
    for (let k = 0; k < this.q.length; ) {
      const w = this.q[k];
      if (now < w.at) {
        k++;
        continue;
      }
      this.q[k] = this.q[this.q.length - 1];
      this.q.pop();
      sink.stage(w.i, w.faction, w.hue, w.level, now);
      if (w.garden === 1 || w.garden === 2) sink.clear(w.i);
      // (a wilt's garden stands at its lower level at once; an up's grows as the front reaches it)
      if (w.garden >= 2) sink.grow(w.i, w.hue, w.level, w.garden === 2 ? -100 : now);
    }
  }

  /** writes still on their way */
  get queued(): number {
    return this.q.length;
  }

  /** A tile brought the house in again over its save (tileIn): the takeover's record back, no pop. */
  restore(i: number, sink: TakeSink) {
    if (this.has(i)) sink.stage(i, this.faction[i], this.hue[i], this.level[i], -1000);
  }
}
