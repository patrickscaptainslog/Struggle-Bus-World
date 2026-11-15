import { config } from '../config';
import type { BuildingRef, City } from '../world/City';

// A landmark's crown (docs/specs/sf/DOOR.md): any paintable bridge climbs four stages a player sees from the bus, one counted hit each,
// from the parts every bridge the kit builds already has:
//   1 the deck    its paint runs out along the deck and down the cables (the landmark's level 1)
//   2 the cables  the bunting strings out along them from the towers (level 2: Bridges.ts gates the cables' accents there)
//   3 the towers  the wavy bands, gilt trim and a gold crown on each saddle (level 3)
//   4 the lights  the crown itself: main.ts flares the towers, runs the lights, flashes, punches and rings the bell
// A counted hit is one of the player's own (Splatter.barf's `own`) at least config.door.gap s after the last. Every other hit of theirs still paints
// and blooms (it re-pops at its stage): there is never a dead tap. Another crew's paint (a rival's breath, ?swerve) never climbs one: it re-pops a
// painted one at its stage and leaves a grey one grey. The stage is the landmark's saved paint level; a crowned one is kept in a small list of keys
// per city, saved when the crowning hit lands, and only while its paint is still at level 3 (paint cleared under it, it can climb again).

/** A landmark that can be crowned: the ref its paint lives under, its key, the name it signs, and the tops of its towers (x, y, z). */
export interface CrownSpot {
  ref: BuildingRef;
  key: string;
  name: string;
  tops: ReadonlyArray<readonly [number, number, number]>;
}

/** a city's crowns' localStorage key (?bench clears its own: ui/Bench.ts) */
export const crownKey = (slug: string): string => `strugglebus.crowns.v1:${slug}`;

export class Crowns {
  private readonly spots: CrownSpot[] = [];
  /** per spot (by ref index): the game time of its last counted hit */
  private readonly counted = new Map<number, number>();
  private readonly crowned = new Set<string>();
  /** crowns planned, each shown, crowned and saved when its hit lands (take) */
  private readonly due: Array<{ spot: CrownSpot; at: number }> = [];
  /** the door's pull: a tap that would land on nothing near an uncrowned spot takes it (Splatter.pick). main.ts turns it off once the door's bridge is
   *  crowned or the bus is far from it */
  magnetOn = false;
  /** where the shot leaves from (main.ts: the bus): the pull reaches along the line from it to the aim point, not round the aim point alone */
  from: { x: number; z: number } | null = null;
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
    // (a crown kept from an earlier visit whose paint has gone since, cleared under it: it can climb again)
    if (this.crowned.has(spot.key) && this.city.paint.level(spot.ref.index) < 2.5) this.uncrown(spot);
  }

  private uncrown(spot: CrownSpot): void {
    this.crowned.delete(spot.key);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(crownKey(this.slug), JSON.stringify([...this.crowned]));
    } catch {
      // (storage blocked: it is crowned for this visit)
    }
  }

  /** its crowning hit is in the air (planned, not landed) */
  private crowning(spot: CrownSpot): boolean {
    return this.due.some((d) => d.spot === spot);
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

  /** 0 grey, 1 to 3 its paint level, 4 crowned (the crowning hit landed). */
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
   * A blast lands on ref at game time t (Splatter.barf, as it plans): the level to write, -1 when ref is no spot, -2 when the blast leaves it out
   * (another crew's on a grey one). `lv` is its level now; `own`, the player's own breath.
   * A grey one always counts (the first paint); else a hit counts at most every config.door.gap s, and moves one stage; the fourth crowns it.
   */
  level(ref: BuildingRef, lv: number, t: number, own: boolean): number {
    const spot = this.spotOf(ref);
    if (!spot) return -1;
    const base = lv > 0.5 ? Math.min(3, Math.round(lv)) : 0;
    // (crowned, but its paint has gone since: it climbs again)
    if (this.crowned.has(spot.key) && base < 3) this.uncrown(spot);
    if (!own) return base > 0 ? base : -2;
    if (base > 0 && (this.crowned.has(spot.key) || this.crowning(spot) || t - (this.counted.get(ref.index) ?? -Infinity) < config.door.gap)) return base;
    this.counted.set(ref.index, t);
    this.last = { spot, at: t };
    if (base < 3) return base + 1;
    this.due.push({ spot, at: t });
    return 3;
  }

  /** A crown whose hit has landed by game time t (each once), else null: from now it is crowned, and saved. */
  take(t: number): CrownSpot | null {
    const i = this.due.findIndex((d) => d.at <= t);
    if (i < 0) return null;
    const spot = this.due.splice(i, 1)[0].spot;
    this.crowned.add(spot.key);
    this.save();
    return spot;
  }

  /**
   * The door's pull (magnetOn): the uncrowned spot within config.door.reach of the line from the bus (`from`) to the aim point (x, z), whose outline
   * isn't a deck over fromY where it comes nearest, else null. Along the line, not round the aim point alone: the aim leads the bus by about 90 m, so a
   * second's steer turned it 85 m off the deck and the first tap splashed into the bay with the bridge beside the bus (the review's B1); and climbing
   * over the cables the aim ran 300 m ahead, past the bridge's far side. The line's first config.door.line m from the bus, and the aim point.
   */
  magnet(x: number, z: number, fromY: number): BuildingRef | null {
    if (!this.magnetOn) return null;
    const D = config.door, f = this.from;
    const len = f ? Math.hypot(x - f.x, z - f.z) : 0, k1 = len > D.line ? D.line / len : 1;
    // (the line's end nearest the aim: the aim point itself, or line m along toward it)
    const ex = f ? f.x + (x - f.x) * k1 : x, ez = f ? f.z + (z - f.z) * k1 : z, steps = f ? Math.ceil((len * k1) / 10) : 0;
    let best: BuildingRef | null = null, bd = D.reach;
    for (const s of this.spots) {
      if (this.crowned.has(s.key) || this.crowning(s)) continue;
      // (the aim point, then the line from its end back to the bus every 10 m: the nearest point to the outline, its deck asked there)
      for (let k = -1; k <= steps; k++) {
        const px = k < 0 ? x : steps ? ex + ((f!.x - ex) * k) / steps : ex, pz = k < 0 ? z : steps ? ez + ((f!.z - ez) * k) / steps : ez;
        const d = this.city.edgeDistance(s.ref, px, pz);
        if (d > bd || this.city.lmOverhead(s.ref, px, pz, fromY)) continue;
        best = s.ref;
        bd = d;
      }
    }
    return best;
  }
}
