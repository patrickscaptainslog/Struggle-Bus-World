// The sizes the resolve and the worker that makes the Moon's ground both need, in a file of their own so the worker pulls in no renderer, and the main chunk no worker. See MoonGround.ts.

/** The largest slope the ground map holds, each axis: 99.9 % of the relief is under it. */
export const SLOPE_MAX = 0.64;
/** The crater tile's side, texels. */
export const TILE = 512;
/** A texel of the tile at its two sizes, km on the ground. A crater is 3 to 24 texels across, so these two reach from about 1 km, 2 px at 300 km, to about 34 km, the map's own craters. */
export const TILE_KM_A = 0.35;
export const TILE_KM_B = 1.4;
