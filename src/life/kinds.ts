// The kinds of mover (LIFE.md, "How movers are drawn"): which pool, how big, how fast. Worker-safe.

// (constant objects, not const enums: Node's checks load these files as they are, tools/life/)

/** The pools, one draw each: people; cars, boats and small planes; ships and airliners. */
export const Pool = { SMALL: 0, MIDDLE: 1, LARGE: 2 } as const;
export type Pool = (typeof Pool)[keyof typeof Pool];

// (CHEER is a pose, never a row's kind, so KINDS has none: a painted person's arms up as they dance, LIVING.md's "stop, look up, wave, dance")
export const Kind = { AIRLINER: 1, SMALL_PLANE: 2, PERSON: 3, CHEER: 4, CAR: 5 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export interface KindInfo {
  pool: Pool;
  /** its long size, m: what its pixels on the screen are reckoned from */
  size: number;
  /** painted, it leaves a mark behind it (O6): a plane's contrail */
  mark?: boolean;
  /** at night its lamp blinks, grey: a plane's beacon, on its model's fin and as its speck */
  beacon?: boolean;
  /** at night its lamps are on, grey or painted: a car's headlights, on its model and as a speck at its nose */
  lights?: boolean;
  /** painted, it leaves tyre tracks on the road behind it, in every hue, and bounces as it drives */
  track?: boolean;
  /** its paint is kept (CONTRACT.md section 3); a person's and a car's aren't, `walk:` and `car:` "only while it's near" */
  kept: boolean;
  /**
   * the aim takes it on the line of fire alone: within its own size of the line, which runs on past the aim point onto the street under it, with no building
   * standing between (Aim.clearTo), not the breath's pick radius round it; and then no building the aim point is near has it instead (a person, among the
   * buildings the breath paints, would otherwise steal every glint on a street)
   */
  onLine?: boolean;
}

export const KINDS: Record<number, KindInfo> = {
  [Kind.AIRLINER]: { pool: Pool.LARGE, size: 60, mark: true, beacon: true, kept: true },
  [Kind.SMALL_PLANE]: { pool: Pool.MIDDLE, size: 11, mark: true, beacon: true, kept: true },
  [Kind.PERSON]: { pool: Pool.SMALL, size: 1.7, kept: false, onLine: true },
  [Kind.CAR]: { pool: Pool.MIDDLE, size: 4.4, lights: true, track: true, kept: false, onLine: true },
};

/** A snapshot row (LIFE.md, "The worker"): 16 floats. */
export const ROW = 16;
export const Col = {
  KEY: 0, // u32 bits of the key's FNV-1a
  KIND: 1,
  X: 2,
  Y: 3,
  Z: 4,
  VX: 5,
  VY: 6,
  VZ: 7,
  HEADING: 8, // rad from +X toward +Z, as the map's
  PITCH: 9,
  BANK: 10,
  SCALE: 11,
  FLAGS: 12,
  /** s from the snapshot's utcMs until it leaves the place or lands: what a paint record keeps it for (CONTRACT.md section 3, `until`) */
  UNTIL: 13,
} as const;

/** A row's flags. */
export const RowFlag = {
  LIVE: 1, // from the relay, not the simulation
  DECK: 2, // on a bridge's deck the world draws, over the ground (a car on the Bay Bridge)
} as const;
