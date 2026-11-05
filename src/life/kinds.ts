// The kinds of mover (LIFE.md, "How movers are drawn"): which pool, how big, how fast. Worker-safe.

// (constant objects, not const enums: Node's checks load these files as they are, tools/life/)

/** The pools, one draw each: people; cars and boats; ships and planes. */
export const Pool = { SMALL: 0, MIDDLE: 1, LARGE: 2 } as const;
export type Pool = (typeof Pool)[keyof typeof Pool];

export const Kind = { AIRLINER: 1, SMALL_PLANE: 2 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export interface KindInfo {
  pool: Pool;
  /** its long size, m: what its pixels on the screen are reckoned from */
  size: number;
}

export const KINDS: Record<number, KindInfo> = {
  [Kind.AIRLINER]: { pool: Pool.LARGE, size: 60 },
  [Kind.SMALL_PLANE]: { pool: Pool.MIDDLE, size: 11 },
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
} as const;
