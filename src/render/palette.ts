import * as THREE from 'three';

// The locked signature palette. Nothing on screen is ever a color that isn't
// listed here: the scene renders ramp indices + light levels, and the post
// pass picks ramp steps with ordered dithering. Mixing two colors is done by
// dithering between them, never by averaging them, so paint can't go brown.
//
// Every ramp has 8 steps, dark -> light. Warm hues shadow toward rose and
// violet instead of brown (pixel-art hue shifting).

export const RAMP_STEPS = 8;

export const Ramp = {
  GREY: 0, // battleship grey: cool shadows, faint warm top light (Hopper)
  GREY_LIGHT: 1, // roofs, sidewalks, trim
  FOG: 2, // fog + sky
  SKY_WARM: 3, // sky near the hidden sun
  GREEN_GREY: 4, // trees and lawns before paint
  WINDOW: 5, // grey-city glass
  INK: 6, // outlines
  WATER: 7,
  RED: 8,
  ORANGE: 9,
  YELLOW: 10,
  GREEN: 11,
  BLUE: 12,
  VIOLET: 13,
  BUS_YELLOW: 14,
  BUS_BLACK: 15,
  GLOW_WHITE: 16,
  SIGN_GREEN: 17,
  WHITE: 18,
  ROOF_DARK: 19, // tar roofs
  // 20-23: world materials (never painted)
  GLASS: 20, // tower curtain walls: blue-silver, the bright end is the fog sky they mirror
  STONE: 21, // pre-war masonry and terracotta: pale buff stone in the sun, cool violet-grey in shade
  GRANITE: 22, // polished dark granite (555 California): near-black plum grey
  BRIDGE_ORANGE: 23, // painted bridge steel (the Golden Gate's International Orange), muted, shadows to rose and plum
  // 24-31: the four other factions' paint (docs/specs/factions/FACTIONS.md, section 2's "Colours."; render/factionLook.ts deals them out). Rainbow's is the
  // six hues above. Paint, as they are: every table names them and grades them as paint is, with no world row's cap or brown gate
  MAGENTA: 24, // Hyperglow's neon
  CYAN: 25, // Hyperglow's neon
  TEAL: 26, // Atlantis: deep indigo to foam white, its shade steps the deep sea's blue
  PEARL: 27, // lilac shadows to pearl white: Atlantis's marble, the Elderwood's bark and stone (and Inferno's bones, when people take paint)
  MOSS: 28, // the Elderwood: near-black depths to emerald, lime only in a glint (6-7)
  CHROME: 29, // Hyperglow's lavender chrome, silver in the light
  CRIMSON: 30, // Inferno: black wine in shade, scarlet to vermilion in the sun, its flame's gold only in a glint (6-7)
  OBSIDIAN: 31, // Inferno's black glass, near black, its violet sheen in the top steps
  // 32-46: the sky's and world travel's (docs/specs/sky/SKY.md 4, Rows). Nothing in the day's frames reads them: only src/sky/SkyTable.ts's tables name
  // them all, and the day's table below names what a part of the held hour falls back on
  NIGHT_SKY: 32, // the sky's far side, high: it can go black while the haze stays bright
  OPEN_SEA: 33,
  LIMB: 34,
  CLOUD: 35,
  DRY_LAND: 36,
  TWILIGHT: 37, // the sky's sun side, high
  LIT: 38, // a lit window
  LAMP: 39, // a lamp
  MOON: 40,
  SNOW: 41,
  FARGLOW: 42,
  RIDGE: 43,
  CLOUD_SHADE: 44,
  SKY_LOW: 45, // the sky's far side, low (FOG by day): the haze keeps FOG
  SAND: 46, // no longer SKY_WARM's: a beach doesn't turn with the sky
  // 47 spare
  REGOLITH: 48, // the Moon's ground (?moon only: nothing else writes them)
  MARE: 49,
  // 50-55: the space sky's own (skyResolve.ts's space branch; SkyTable.ts's SPACE_ROWS): the dark between, Earth's sea, its air's limb, its land, the terminator,
  // the Moon from far off. Rows of their own since review four (its 5 and 7): the street's live sky names 32-44 in every table, so where the two shared a row
  // each wrote over the other, and the climb from the street drew space black by day
  SPACE_DARK: 50,
  SPACE_SEA: 51,
  SPACE_LIMB: 52,
  SPACE_LAND: 53,
  SPACE_DUSK: 54,
  SPACE_MOON: 55,
} as const;

export type RampId = (typeof Ramp)[keyof typeof Ramp];

/** The six rainbow hues, in rainbow order. Paint color index i -> HUE_RAMPS[i]. */
export const HUE_RAMPS: readonly number[] = [
  Ramp.RED,
  Ramp.ORANGE,
  Ramp.YELLOW,
  Ramp.GREEN,
  Ramp.BLUE,
  Ramp.VIOLET,
];
export const HUE_COUNT = 6;

const RAMPS: Record<number, string[]> = {
  [Ramp.GREY]: ['#141920', '#1f2730', '#2e3843', '#404b57', '#56616c', '#6f7882', '#8d8f91', '#b3aca2'],
  [Ramp.GREY_LIGHT]: ['#262d36', '#36404b', '#4b5661', '#626d78', '#7c8690', '#98a0a7', '#b6bbbe', '#d6d4cd'],
  [Ramp.FOG]: ['#5d6873', '#6e7984', '#808a94', '#939ca5', '#a7aeb5', '#bbc1c6', '#cfd3d6', '#e2e4e5'],
  [Ramp.SKY_WARM]: ['#7d8791', '#919aa1', '#a6abae', '#bbbbb9', '#cfcbc3', '#dfd8cc', '#ece3d4', '#f7eedf'],
  [Ramp.GREEN_GREY]: ['#141a1a', '#1d2625', '#283331', '#36423f', '#47534f', '#5a6762', '#717d76', '#8f978d'],
  [Ramp.WINDOW]: ['#0d1219', '#141c25', '#1d2833', '#283644', '#384757', '#4e5e6e', '#6f7f8d', '#9aa6b0'],
  [Ramp.INK]: ['#0b0e13', '#0f131a', '#141921', '#1a2029', '#202732', '#272f3b', '#2f3845', '#38424f'],
  // (the upper steps climb toward the fog: grazing water mirrors it, luma 0.10 .. 0.67 in even steps)
  [Ramp.WATER]: ['#111a24', '#172330', '#1f2e3d', '#2c3d4e', '#3f5164', '#5b6c7e', '#7d8b99', '#a3adb7'],
  [Ramp.RED]: ['#2a0f2e', '#4d1440', '#7a1d4c', '#b02a55', '#e0405e', '#f6707a', '#ff9f9c', '#ffd6cf'],
  [Ramp.ORANGE]: ['#3a1230', '#6e1f3a', '#a8333e', '#dc5235', '#f58233', '#ffa94a', '#ffcb7a', '#ffeac2'],
  [Ramp.YELLOW]: ['#5c1e3a', '#9a3540', '#d25a3a', '#f08a2e', '#f8b52c', '#ffd23e', '#ffe880', '#fff8cc'],
  [Ramp.GREEN]: ['#0e2a3a', '#11414a', '#12614e', '#1f8a4e', '#3cb84f', '#7ad65a', '#b4ec7c', '#e6ffc4'],
  [Ramp.BLUE]: ['#16124a', '#1c2a78', '#1f45a8', '#2a6ad6', '#3a96f0', '#6cc0ff', '#a6e0ff', '#ddf6ff'],
  [Ramp.VIOLET]: ['#1e0f3e', '#35166a', '#522496', '#7436c4', '#9a56e8', '#bf86ff', '#dcb6ff', '#f4e6ff'],
  [Ramp.BUS_YELLOW]: ['#2b1224', '#5e2232', '#a0412e', '#d8722a', '#f29e1c', '#fbbf24', '#ffd94a', '#fff2a6'],
  [Ramp.BUS_BLACK]: ['#0c0d12', '#15171e', '#1f222b', '#2b2f3a', '#3b404c', '#4f5562', '#686f7c', '#8a919c'],
  [Ramp.GLOW_WHITE]: ['#4a4b55', '#6a6b72', '#8f8e8e', '#b8b4a8', '#ddd8c4', '#f2eed8', '#fffbe8', '#ffffff'],
  [Ramp.SIGN_GREEN]: ['#08241a', '#0c3a28', '#12523a', '#1a6a4a', '#24845a', '#3aa06e', '#64be8c', '#a6dcbc'],
  [Ramp.WHITE]: ['#5c626b', '#787e86', '#959aa0', '#b1b5b9', '#cbced0', '#e0e2e2', '#f0f1ef', '#ffffff'],
  [Ramp.ROOF_DARK]: ['#101419', '#171d24', '#20272f', '#2a323c', '#36404b', '#454f5a', '#58626c', '#6f7882'],
  [Ramp.GLASS]: ['#0f1620', '#17212d', '#212e3d', '#2d3e50', '#3e5266', '#566c80', '#7a90a2', '#aebfcb'],
  // (buff only in the top two steps, the sunlit stone; in shade a cool violet-grey (chroma ~4, hue 273-303):
  // the old near-neutral warm mid steps read taupe and rust next to the blue-grey city, rose read pink)
  [Ramp.STONE]: ['#23262c', '#33353b', '#45464d', '#5d5e65', '#77767d', '#949298', '#b6b0a6', '#d4cdc0'],
  [Ramp.GRANITE]: ['#0c0b11', '#14121a', '#1d1a24', '#28232f', '#352e3c', '#463d4d', '#5c5163', '#7b6e80'],
  [Ramp.BRIDGE_ORANGE]: ['#24121f', '#3d1828', '#5e2131', '#842c38', '#a33a3a', '#b4564a', '#bf7a6c', '#c9a197'],
  // (the factions' rows, from FACTIONS.md's words. Each sits a band of lightness away from Rainbow's six where their hues meet, so no two factions blur
  // in any of the live sky's seven tables, colour-blind sight included: tools/factions/colours.ts measures it. Dark steps shadow to indigo, wine or violet,
  // never brown; a faction's gold is YELLOW's and Inferno's flame its own steps 6-7, which paint reaches only in a glint. MOSS and CRIMSON hold each other
  // apart under deuteranopia, where red and green fall to one hue: the Elderwood a band lighter than Inferno in shade and darker in the sun)
  [Ramp.MAGENTA]: ['#2f0133', '#580055', '#87007b', '#ba00a1', '#eb16be', '#ff6bcd', '#ffb3dd', '#ffe7f3'],
  [Ramp.CYAN]: ['#051a36', '#003754', '#005e7b', '#1c87a5', '#18b1cd', '#3adaf2', '#91f4ff', '#d9fdff'],
  [Ramp.TEAL]: ['#060756', '#063f6a', '#127299', '#1c97b9', '#1cc7bd', '#2ee5c7', '#b1f8eb', '#ebfdf9'],
  [Ramp.PEARL]: ['#402e55', '#654c77', '#8a6e97', '#af93b6', '#cdb4d1', '#e6cfe6', '#f5e5f6', '#fffaff'],
  [Ramp.MOSS]: ['#010404', '#01160f', '#023014', '#044420', '#0f865a', '#15a661', '#97d51c', '#e7ee77'],
  [Ramp.CHROME]: ['#261e6b', '#443e95', '#8073e2', '#a5a0ef', '#cbb8f4', '#e3d1f8', '#f6f4fb', '#fefdff'],
  [Ramp.CRIMSON]: ['#070006', '#15000c', '#270111', '#400213', '#a60b1c', '#ca220a', '#f28f29', '#fcebb6'],
  [Ramp.OBSIDIAN]: ['#010104', '#05010c', '#0e021d', '#1b082c', '#2c143e', '#412354', '#7e479c', '#b989cd'],
  // (a light has one colour at any hour)
  [Ramp.LIT]: ['#3a1f4a', '#7a2f58', '#c04e5c', '#ef8450', '#ffb04e', '#ffcf72', '#ffe7a4', '#fff7dc'],
  [Ramp.LAMP]: ['#191636', '#2f2449', '#54345a', '#8b4a60', '#bd6a5e', '#e29662', '#f6c07e', '#ffe6b0'],
};
// (by day these are the rows they used to borrow)
RAMPS[Ramp.SKY_LOW] = RAMPS[Ramp.FOG];
RAMPS[Ramp.SAND] = RAMPS[Ramp.SKY_WARM];
RAMPS[Ramp.RIDGE] = RAMPS[Ramp.GREEN_GREY];
RAMPS[Ramp.FARGLOW] = RAMPS[Ramp.GREY]; // (the held hour's far lit faces, with its table switched off)

export const RAMP_COUNT = 64; // texture rows (8x64 RGBA8, 2 KB; rows 47 and 56-63 spare or held, a row no table names is black)

/** The factions' rows, 24-31 (factionLook.ts): paint, as HUE_RAMPS are, wherever a table or a check tells paint from the world. */
export const FACTION_RAMPS: readonly number[] = [Ramp.MAGENTA, Ramp.CYAN, Ramp.TEAL, Ramp.PEARL, Ramp.MOSS, Ramp.CHROME, Ramp.CRIMSON, Ramp.OBSIDIAN];

/** Linear-ish sRGB triplets 0..1 for CPU use (e.g. CSS colors, splash screens). */
export function rampColor(ramp: number, step: number): string {
  const r = RAMPS[ramp];
  if (!r) return '#ff00ff';
  return r[Math.max(0, Math.min(RAMP_STEPS - 1, Math.round(step)))];
}

/** Rows into a palette's bytes (a row no table names stays as it was). `over` wins over `rows`: the day's paint in a blue table, say. */
export function writePalette(data: Uint8Array, rows: Record<number, string[]> = RAMPS, over?: Record<number, string[]>): void {
  for (let r = 0; r < RAMP_COUNT; r++) {
    const ramp = over?.[r] ?? rows[r];
    for (let s = 0; s < RAMP_STEPS; s++) {
      const i = (r * RAMP_STEPS + s) * 4;
      if (!ramp) {
        data[i + 3] = 255;
        continue;
      }
      const hex = ramp[s];
      data[i] = parseInt(hex.slice(1, 3), 16);
      data[i + 1] = parseInt(hex.slice(3, 5), 16);
      data[i + 2] = parseInt(hex.slice(5, 7), 16);
      data[i + 3] = 255;
    }
  }
}

/** The day's rows (the table a tuner switch falls back on). */
export const dayRows: Readonly<Record<number, string[]>> = RAMPS;

/**
 * Palette texture: width = RAMP_STEPS, height = RAMP_COUNT, RGBA8, nearest.
 * Row r = ramp r. Sampled in the post pass with texelFetch.
 */
export function makePaletteTexture(): THREE.DataTexture {
  const data = new Uint8Array(RAMP_STEPS * RAMP_COUNT * 4);
  writePalette(data);
  const tex = new THREE.DataTexture(data, RAMP_STEPS, RAMP_COUNT, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
