import { config } from '../config';
import type { BuildingRef, City } from '../world/City';

// A landmark's crown (docs/specs/sf/DOOR.md): any paintable bridge climbs four stages a player sees from the bus, one counted hit each,
// from the parts every bridge the kit builds already has:
//   1 the deck    its paint runs out along the deck and down the cables (the landmark's level 1)
//   2 the cables  the bunting strings out along them from the towers (level 2: Bridges.ts gates the cables' accents there)
//   3 the towers  the wavy bands, gilt trim and a gold crown on each saddle (level 3)
//   4 the lights  the crown itself: main.ts flares the towers, runs the lights, flashes, punches and rings the bell
// A counted hit is one at least config.door.gap s after the last. Every other hit still paints and blooms (it re-pops at its stage): there is
// never a dead tap. The stage is the landmark's saved paint level; a crowned one is kept in a small list of keys per city.

/** A landmark that can be crowned: the ref its paint lives under, its key, the name it signs, and the tops of its towers (x, y, z). */
export interface CrownSpot {
  ref: BuildingRef;
  key: string;
  name: string;
  tops: ReadonlyArray<readonly [number, number, number]>;
}

const crownKey = (slug: string): string => `strugglebus.crowns.v1:${slug}`;

export class Crowns {
  private readonly spots: CrownSpot[] = [];
  /** per spot (by ref index): the game time of its last counted hit */
  private readonly counted = new Map<number, number>();
  private readonly crowned = new Set<string>();
  /** crowns planned, each shown when its hit lands (take) */
  private readonly due: Array<{ spot: CrownSpot; at: number }> = [];
  /** the door's pull: a tap that would land on nothing near an uncrowned spot takes it (Splatter.pick) */
  magnetOn = false;
  /** the last counted hit: which spot and when it lands (the HUD's ring and pips) */
  last: { spot: CrownSpot; at: number } | null = null;

  constructor(private readonly city: City, private readonly slug: string) {
    try {
      const v = JSON.parse(localStorage.getItem(crownKey(slug)) ?? '[]');
      if (Array.isArray(v)) for (const k of v) if (typeof k === 'string') this.crowned.add(k);
    } catch {
      // (storage blocked or a bad record: nothing is crowned)
    }
  }

  add(spot: CrownSpot): void {
    this.spots.push(spot);
  }

  spotOf(ref: BuildingRef): CrownSpot | undefined {
    for (const s of this.spots) if (s.ref === ref) return s;
    return undefined;
  }

  /** The spot under `key` (lm:ggb), once it is paintable. */
  byKey(key: string): CrownSpot | undefined {
    return this.spots.find((s) => s.key === key);
  }

  isCrowned(spot: CrownSpot): boolean {
    return this.crowned.has(spot.key);
  }

  /** 0 grey, 1 to 3 its paint level, 4 crowned. */
  stage(spot: CrownSpot): number {
    if (this.crowned.has(spot.key)) return 4;
    const lv = this.city.paint.level(spot.ref.index);
    return lv > 0.5 ? Math.min(3, Math.round(lv)) : 0;
  }

  /** How far through the wait for its next counted hit (0 just counted, 1 ready), at game time t. */
  wait(spot: CrownSpot, t: number): number {
    const at = this.counted.get(spot.ref.index);
    return at === undefined ? 1 : Math.max(0, Math.min(1, (t - at) / config.door.gap));
  }

  /**
   * A blast lands on ref at game time t (Splatter.barf, as it plans): the level to write, or -1 when ref is no spot. `lv` is its level now.
   * A grey one always counts (the first paint); else a hit counts at most every config.door.gap s, and moves one stage; the fourth crowns it.
   */
  level(ref: BuildingRef, lv: number, t: number): number {
    const spot = this.spotOf(ref);
    if (!spot) return -1;
    const base = lv > 0.5 ? Math.min(3, Math.round(lv)) : 0;
    if (base > 0 && (this.crowned.has(spot.key) || t - (this.counted.get(ref.index) ?? -Infinity) < config.door.gap)) return base;
    this.counted.set(ref.index, t);
    this.last = { spot, at: t };
    if (base < 3) return base + 1;
    this.crowned.add(spot.key);
    this.due.push({ spot, at: t });
    try {
      localStorage.setItem(crownKey(this.slug), JSON.stringify([...this.crowned]));
    } catch {
      // (storage blocked: it is crowned for this visit)
    }
    return 3;
  }

  /** A crown whose hit has landed by game time t (each once), else null. */
  take(t: number): CrownSpot | null {
    const i = this.due.findIndex((d) => d.at <= t);
    return i < 0 ? null : this.due.splice(i, 1)[0].spot;
  }

  /** The door's pull (magnetOn): the uncrowned spot within config.door.reach of (x, z) whose outline isn't a deck over fromY there, else null. */
  magnet(x: number, z: number, fromY: number): BuildingRef | null {
    if (!this.magnetOn) return null;
    let best: BuildingRef | null = null, bd = config.door.reach;
    for (const s of this.spots) {
      if (this.crowned.has(s.key)) continue;
      const d = this.city.edgeDistance(s.ref, x, z);
      if (d > bd || this.city.lmOverhead(s.ref, x, z, fromY)) continue;
      best = s.ref;
      bd = d;
    }
    return best;
  }
}
