// Neighbourhoods over the squares (decision 28, FACTIONS.md section 3, "Neighbourhoods"): a Realm for areas.ts. The real ones come from map data in the
// world's files once the first account bakes them (Overture's points and outlines, the big parks, the section's fixes, each one's heart), offered by a
// contract clause to come; `Neighbourhoods` takes them as a table. Until then two stand-ins: `nearest`, each square to its nearest named point, which is how
// the bake starts before its fixes; and `camps`, Recess's fallback of three camps of about 36 squares in its 1.5 km circle.

import { areaTune, packSquare, squareCentre, squareKey, type Realm } from './areas';

/** A square's land (km²). */
const SQUARE_KM2 = (areaTune.size * areaTune.size) / 1e6;

export interface NeighbourhoodTable {
  names: string[];
  /** each one's heart square */
  hearts: number[];
  /** each one's squares */
  squares: number[][];
  /** squares the map tags worship, cemetery, memorial, school or hospital: stages 4 and 5 stay off them */
  tagged?: Iterable<number>;
  /** too small for a god, or no open ground for a heart: squares only (Alcatraz) */
  godless?: boolean[];
}

export const neighbourhoodTune = {
  /** under this (km²) a neighbourhood has no god: Alcatraz's 5 squares */
  godMin: 0.25,
  /** the first god: the sky mark points a newcomer at the nearest neighbourhood under this (km²) */
  firstUnder: 1,
};

export class Neighbourhoods implements Realm {
  readonly count: number;
  private readonly byKey = new Map<number, number>();
  private readonly t: NeighbourhoodTable;
  private readonly tagged: Set<number>;

  constructor(t: NeighbourhoodTable) {
    this.t = t;
    this.count = t.names.length;
    this.tagged = new Set(t.tagged ?? []);
    t.squares.forEach((sq, n) => {
      for (const k of sq) this.byKey.set(k, n);
    });
  }

  of(key: number): number {
    return this.byKey.get(key) ?? -1;
  }
  heart(n: number): number {
    return this.t.hearts[n];
  }
  squares(n: number): readonly number[] {
    return this.t.squares[n];
  }
  km2(n: number): number {
    return this.t.squares[n].length * SQUARE_KM2;
  }
  name(n: number): string {
    return this.t.names[n];
  }
  godless(n: number): boolean {
    return !!this.t.godless?.[n] || this.km2(n) < neighbourhoodTune.godMin || this.tagged.has(this.t.hearts[n]);
  }
  top(key: number): number {
    return this.tagged.has(key) ? areaTune.tagged : areaTune.top;
  }

  /** The first god (FACTIONS.md section 3): the neighbourhood the sky mark points a newcomer at from (x, z), the nearest under 1 km² with a god allowed; -1 for none. */
  firstGod(x: number, z: number): number {
    let best = -1, d0 = Infinity;
    for (let n = 0; n < this.count; n++) {
      if (this.godless(n) || this.km2(n) >= neighbourhoodTune.firstUnder) continue;
      const c = squareCentre(this.heart(n)), d = Math.hypot(c.x - x, c.z - z);
      if (d < d0) {
        d0 = d;
        best = n;
      }
    }
    return best;
  }
}

/**
 * The stand-in for any city: every square in the bounds (and on land, if `land` says) to its nearest named point, the heart the point's own square unless
 * one is given. No fixes (the bake's: splits, parks kept whole, hearts 450 m apart, one list of names).
 */
export function nearest(points: { name: string; x: number; z: number; heart?: { x: number; z: number } }[], bounds: { x0: number; z0: number; x1: number; z1: number },
  land: (x: number, z: number) => boolean = () => true, tagged: Iterable<number> = []): Neighbourhoods {
  const s = areaTune.size, squares: number[][] = points.map(() => []);
  for (let iz = Math.floor(bounds.z0 / s); iz * s < bounds.z1; iz++)
    for (let ix = Math.floor(bounds.x0 / s); ix * s < bounds.x1; ix++) {
      const x = (ix + 0.5) * s, z = (iz + 0.5) * s;
      if (!land(x, z)) continue;
      let best = -1, d0 = Infinity;
      points.forEach((p, n) => {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < d0) {
          d0 = d;
          best = n;
        }
      });
      if (best >= 0) squares[best].push(packSquare(ix, iz));
    }
  return new Neighbourhoods({ names: points.map((p) => p.name), hearts: points.map((p) => squareKey(p.heart?.x ?? p.x, p.heart?.z ?? p.z)), squares, tagged });
}

/** Recess's fallback (FACTIONS.md section 3): three camps, the circle's thirds, about 36 squares each, round (cx, cz); each heart the square nearest its third's middle. */
export function camps(radius: number, cx = 0, cz = 0, names = ['camp 1', 'camp 2', 'camp 3'], turn = 0): Neighbourhoods {
  const s = areaTune.size, squares: number[][] = [[], [], []], third = (Math.PI * 2) / 3;
  for (let iz = Math.floor((cz - radius) / s); iz * s < cz + radius; iz++)
    for (let ix = Math.floor((cx - radius) / s); ix * s < cx + radius; ix++) {
      const x = (ix + 0.5) * s - cx, z = (iz + 0.5) * s - cz;
      if (x * x + z * z > radius * radius) continue;
      const a = (((Math.atan2(z, x) - turn) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      squares[Math.min(2, Math.floor(a / third))].push(packSquare(ix, iz));
    }
  // (a third's middle: 4 r sin(60°) / (3 · 120° in radians) out along its bisector)
  const r = (4 * radius * Math.sin(third / 2)) / (3 * third);
  const hearts = [0, 1, 2].map((k) => {
    const a = turn + third * (k + 0.5), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    let best = squares[k][0], d0 = Infinity;
    for (const key of squares[k]) {
      const c = squareCentre(key), d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < d0) {
        d0 = d;
        best = key;
      }
    }
    return best;
  });
  return new Neighbourhoods({ names, hearts, squares });
}
