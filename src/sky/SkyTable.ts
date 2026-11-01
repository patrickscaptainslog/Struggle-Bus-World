import type * as THREE from 'three';
import { dayRows, HUE_RAMPS, Ramp, writePalette } from '../render/palette';

// A table is this minute's colours (SKY.md 4): one colour for every (ramp, step) of the frame, so one table re-lights the whole city, far field, water, bus and
// particles with it. Light moves, tables colour. Every ramp runs dark to light, sky rows too (a band reads step 7 - i of its row), and every keyframe names every
// row: a pixel on a row its table doesn't name is a hard fail. (24-31, the factions, are reserved and nothing draws them yet.)
//
// Only one keyframe exists, because S1 holds one hour. World rows are research-art.md's blue table. It stops at 22 of the rows, so the others follow its own
// make_palette: INK, BUS_BLACK, GRANITE from its city gradient, GLOW_WHITE and WHITE from its glow gradient, SIGN_GREEN its sign rule. Where this differs on purpose:
// - BRIDGE_ORANGE: art graded it as paint, which leaves a salmon bridge under a dark sky. It is a world row: rose to plum, under paint's chroma.
// - FOG is the haze here, not the sky: dark to light, with its step 4 the far side's horizon (SKY_LOW 7), so that the far fade ends in the sky behind it.
// - SKY_LOW takes art's far-side low band, which art kept in FOG (SKY.md 4, Rows). The sky's four rows are art's, turned over: SKY_WARM's steps 6-7 stay warm
//   for the beam's core and nose (SKY.md 4, Traps).
// - SAND: its own row, the city's blue a breath toward lilac. Rows nothing draws yet are named from their nearest kin, so S2's blend has something to start from.
export const BLUE_TABLE: Record<number, string[]> = {
  [Ramp.GREY]: ['#0c1131', '#0f153a', '#131b45', '#192353', '#223067', '#31427f', '#475c97', '#7083b5'],
  [Ramp.GREY_LIGHT]: ['#10173d', '#151e4b', '#1d295c', '#283873', '#3d508d', '#5b6fa7', '#8696c2', '#afbbd9'],
  [Ramp.FOG]: ['#16173f', '#262453', '#363268', '#48407d', '#5a4f93', '#7269a7', '#8c84bc', '#a79fd0'],
  [Ramp.SKY_WARM]: ['#bb6193', '#cc648c', '#db6e82', '#e77678', '#f27c6e', '#f7876a', '#fb9166', '#ff9a62'],
  [Ramp.GREEN_GREY]: ['#0b1930', '#0d1d34', '#0f2038', '#132741', '#182f4b', '#203b5a', '#2d4d70', '#4d6e90'],
  [Ramp.WINDOW]: ['#0c1032', '#0f143b', '#121847', '#151e54', '#1b2664', '#25327a', '#374796', '#5768b3'],
  [Ramp.INK]: ['#090c26', '#0a0d29', '#0b0f2c', '#0c1130', '#0e1334', '#0f1538', '#11183e', '#141c45'],
  [Ramp.WATER]: ['#0c1236', '#101741', '#141c4c', '#192258', '#212b67', '#293477', '#363f86', '#4b4a95'],
  // paint keeps the day: 90 % lightness, 112 % chroma, and a warm hue that darkens slides to rose (research-art.md 3.2)
  [Ramp.RED]: ['#2d0e32', '#500e42', '#7c0c4a', '#b0084d', '#de1e50', '#f05a69', '#f48b89', '#eec1b9'],
  [Ramp.ORANGE]: ['#3d1032', '#701537', '#a81f34', '#da3736', '#ee6e00', '#f59510', '#f0b759', '#ecd4a8'],
  [Ramp.YELLOW]: ['#5e1839', '#9a2637', '#d0433f', '#e97700', '#eda200', '#f0be00', '#edd359', '#eae2b1'],
  [Ramp.GREEN]: ['#0a2b3d', '#03404b', '#005e4a', '#008441', '#00ae34', '#5fc835', '#9ddb5a', '#cfeaa8'],
  [Ramp.BLUE]: ['#171151', '#1a257f', '#153dae', '#135fd9', '#0f8aee', '#4fb1f7', '#8dcef0', '#c5e1eb'],
  [Ramp.VIOLET]: ['#200e44', '#360e71', '#52149c', '#7220c9', '#9441e9', '#b573fa', '#cda2f3', '#e0d0ec'],
  [Ramp.BUS_YELLOW]: ['#270d20', '#57182b', '#952e39', '#d0544b', '#e08900', '#e7a800', '#e9c108', '#e6d989'],
  [Ramp.BUS_BLACK]: ['#090c26', '#090c26', '#0b0e2b', '#0c1131', '#0f1538', '#131a42', '#18224f', '#243166'],
  [Ramp.GLOW_WHITE]: ['#3b3a70', '#60608e', '#8888ab', '#b3b1c9', '#d1cede', '#e0dee9', '#efeef4', '#ffffff'],
  [Ramp.SIGN_GREEN]: ['#04281c', '#00402a', '#005a3d', '#00744d', '#00905d', '#22ae71', '#5bce91', '#aaedc6'],
  [Ramp.WHITE]: ['#3b3a70', '#60608e', '#8888ab', '#b3b1c9', '#d1cede', '#e0dee9', '#efeef4', '#ffffff'],
  [Ramp.ROOF_DARK]: ['#0b0f2e', '#0d1234', '#0f153a', '#111840', '#151e4b', '#1a2556', '#233168', '#31427f'],
  [Ramp.GLASS]: ['#0d1236', '#101640', '#131b4c', '#17215b', '#202b6e', '#2a3987', '#4253a2', '#7a88c8'],
  [Ramp.STONE]: ['#0f1539', '#131a43', '#19224f', '#242f64', '#34437c', '#506198', '#7a88b5', '#aab2ce'],
  [Ramp.GRANITE]: ['#080423', '#090527', '#0a072b', '#0b0930', '#0d0b37', '#111141', '#16194f', '#222968'],
  [Ramp.BRIDGE_ORANGE]: ['#120c26', '#1e112f', '#2f193c', '#452247', '#612d52', '#7e3d5c', '#9a5469', '#b27a84'],
  [Ramp.NIGHT_SKY]: ['#0e154a', '#121b58', '#162164', '#19256d', '#1c2975', '#1f2c7b', '#222f82', '#253387'],
  [Ramp.OPEN_SEA]: ['#0c1236', '#101741', '#141c4c', '#192258', '#212b67', '#293477', '#363f86', '#4b4a95'],
  [Ramp.LIMB]: ['#16173f', '#262453', '#363268', '#48407d', '#5a4f93', '#7269a7', '#8c84bc', '#a79fd0'],
  [Ramp.CLOUD]: ['#20285f', '#2c326f', '#393c7e', '#504a8b', '#685798', '#92699c', '#c27c9c', '#f4a48e'],
  [Ramp.DRY_LAND]: ['#15173f', '#1f214d', '#2b2c5e', '#3a3a70', '#4c4a82', '#635d94', '#8079a8', '#a39abc'],
  [Ramp.TWILIGHT]: ['#121b58', '#1f2a72', '#313689', '#47449a', '#5a4fa4', '#7756a4', '#8b5aa4', '#a75f9b'],
  [Ramp.LIT]: ['#3a1f4a', '#7a2f58', '#c04e5c', '#ef8450', '#ffb04e', '#ffcf72', '#ffe7a4', '#fff7dc'],
  [Ramp.LAMP]: ['#191636', '#2f2449', '#54345a', '#8b4a60', '#bd6a5e', '#e29662', '#f6c07e', '#ffe6b0'],
  [Ramp.MOON]: ['#3d4a73', '#5c698c', '#7e8aa6', '#99a1b5', '#b4b9c4', '#cececd', '#e9e4d6', '#fffbe9'],
  [Ramp.SNOW]: ['#4b5b92', '#6475a9', '#7e8fc0', '#93a3ce', '#a9b7dc', '#c4cee8', '#dfe6f4', '#ffffff'],
  [Ramp.FARGLOW]: ['#20285f', '#2c326f', '#393c7e', '#504a8b', '#685798', '#92699c', '#c27c9c', '#f4a48e'],
  [Ramp.RIDGE]: ['#0f1336', '#15183f', '#1c1e48', '#232352', '#2a295c', '#312e66', '#383470', '#3f3a7a'],
  [Ramp.CLOUD_SHADE]: ['#141a4a', '#202355', '#2c2c60', '#38356b', '#453e77', '#524782', '#5f518e', '#6d5a9a'],
  [Ramp.SKY_LOW]: ['#29368c', '#2d3a90', '#323e93', '#394295', '#404696', '#494995', '#524c94', '#5a4f93'],
  [Ramp.SAND]: ['#15173f', '#1f214d', '#2b2c5e', '#3a3a70', '#4c4a82', '#635d94', '#8079a8', '#a39abc'],
};

/** The day's paint rows, for a blue table with its paint switched off. */
const DAY_PAINT: Record<number, string[]> = Object.fromEntries(HUE_RAMPS.map((r) => [r, dayRows[r]]));

/** FOG's luma against its step (base, slope), what the resolve's value match reads. The day's are the fit it has always had. */
export function fogLuma(blue: boolean, out: THREE.Vector2): THREE.Vector2 {
  if (!blue) return out.set(0.3955, 0.071);
  const luma = (hex: string) => (0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16)) / 255;
  const row = BLUE_TABLE[Ramp.FOG];
  const base = luma(row[0]);
  return out.set(base, (luma(row[7]) - base) / 7);
}

/** The palette texture takes this table. It runs when a tuner switch moves, never on a frame of its own. */
export function applyTable(tex: THREE.DataTexture, blue: boolean, paint: boolean): void {
  writePalette(tex.image.data as unknown as Uint8Array, blue ? BLUE_TABLE : dayRows, blue && !paint ? DAY_PAINT : undefined);
  tex.needsUpdate = true;
}
