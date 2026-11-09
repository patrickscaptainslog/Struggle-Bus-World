// The kinds of mover (LIFE.md, "How movers are drawn"): which pool, how big, how fast. Worker-safe.

// (constant objects, not const enums: Node's checks load these files as they are, tools/life/)

/** The pools, one draw each: people; cars and small planes; ships, boats and airliners (the large pool's instances are few, so a kind's boxes cost least there); buses and
 *  trucks (a pool's every instance draws every box in it, and theirs are many: in the middle pool every car would draw them) */
export const Pool = { SMALL: 0, MIDDLE: 1, LARGE: 2, HEAVY: 3 } as const;
export type Pool = (typeof Pool)[keyof typeof Pool];

// (PERSON and CHEER are poses, never a row's kind, so KINDS has none: a painted picnic's people up and dancing, arms down and up, LIVING.md's "stop, look up, wave,
// dance". A PICNIC is a group on a blanket in a park, one row: who's on it is its row's LOOK)
// (CAR is a sedan, an SUV or a pickup by its look, TRUCK a bus, a box truck or a semi: sim/cars.ts VehicleLook)
export const Kind = { AIRLINER: 1, SMALL_PLANE: 2, PERSON: 3, CHEER: 4, CAR: 5, FERRY: 6, SAILBOAT: 7, PICNIC: 8, TRUCK: 9 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export interface KindInfo {
  pool: Pool;
  /** its long size, m: what its pixels on the screen are reckoned from */
  size: number;
  /** painted, it leaves a mark behind it (O6): a plane's contrail */
  mark?: boolean;
  /** at night its lamp blinks, grey: a plane's beacon, on its model's fin and as its speck */
  beacon?: boolean;
  /** at night its lamps are on, grey or painted: a car's headlights, a ferry's windows; its speck is them */
  lights?: boolean;
  /** its lamps ahead of its middle (m): under LAMP_PX a speck there is them (a car's headlights) */
  nose?: number;
  /** painted, it leaves tyre tracks on the road behind it, in every hue, and bounces as it drives: from its rear axle behind its middle, and its wheels either side (m) */
  track?: boolean;
  axle?: [number, number];
  /** painted, it leaves a wake flat on the water behind it, in every hue, and rocks as it goes */
  wake?: boolean;
  /** its paint is kept (CONTRACT.md section 3); a picnic's and a car's aren't, `picnic:` and `car:` "only while it's near" */
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
  [Kind.PICNIC]: { pool: Pool.SMALL, size: 2.6, kept: false, onLine: true },
  [Kind.CAR]: { pool: Pool.MIDDLE, size: 4.4, lights: true, nose: 2.3, track: true, axle: [1.35, 0.72], kept: false, onLine: true },
  [Kind.TRUCK]: { pool: Pool.HEAVY, size: 12, lights: true, nose: 6, track: true, axle: [3.8, 1.05], kept: false, onLine: true },
  [Kind.FERRY]: { pool: Pool.LARGE, size: 40, lights: true, wake: true, kept: true },
  [Kind.SAILBOAT]: { pool: Pool.LARGE, size: 11, wake: true, kept: true },
};

/** A truck's length by its look (the heavy pool's models, pools.ts): a bus, a box truck, a semi; the aim, the level of detail and the Parade read it, not the kind's one size */
export const TRUCK_LEN = [12, 12, 9.3, 9.3, 20.4];

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
  /** what it looks like, a kind's own bits: a picnic's who's on the blanket (sim/parks.ts LookBit) */
  LOOK: 14,
} as const;

/** A row's flags. */
export const RowFlag = {
  LIVE: 1, // from the relay, not the simulation
  DECK: 2, // on a bridge's deck the world draws, over the ground (a car on the Bay Bridge)
} as const;
