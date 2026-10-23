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
  BRIDGE_ORANGE: 20, // the Golden Gate: International Orange, muted, shadows to rose and plum
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
  [Ramp.BRIDGE_ORANGE]: ['#24121f', '#3d1828', '#5e2131', '#842c38', '#a33a3a', '#b4564a', '#bf7a6c', '#c9a197'],
};

export const RAMP_COUNT = 32; // texture rows (room to grow; unused rows are black)

/** Linear-ish sRGB triplets 0..1 for CPU use (e.g. CSS colors, splash screens). */
export function rampColor(ramp: number, step: number): string {
  const r = RAMPS[ramp];
  if (!r) return '#ff00ff';
  return r[Math.max(0, Math.min(RAMP_STEPS - 1, Math.round(step)))];
}

/**
 * Palette texture: width = RAMP_STEPS, height = RAMP_COUNT, RGBA8, nearest.
 * Row r = ramp r. Sampled in the post pass with texelFetch.
 */
export function makePaletteTexture(): THREE.DataTexture {
  const data = new Uint8Array(RAMP_STEPS * RAMP_COUNT * 4);
  for (let r = 0; r < RAMP_COUNT; r++) {
    const ramp = RAMPS[r];
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
  const tex = new THREE.DataTexture(data, RAMP_STEPS, RAMP_COUNT, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
