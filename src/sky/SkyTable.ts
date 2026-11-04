import type * as THREE from 'three';
import { dayRows, HUE_RAMPS, Ramp, RAMP_COUNT, RAMP_STEPS, writePalette } from '../render/palette';
import { DAWN_TABLE, DAY_EXTRA, GOLDEN_TABLE, MORNING_TABLE, NOON_TABLE, SUNSET_TABLE } from './SkyTables';

// A table is this minute's colours (SKY.md 4): one colour for every (ramp, step) of the frame, so one table re-lights the whole city, far field, water, bus and
// particles with it. Light moves, tables colour. Every ramp runs dark to light, sky rows too (a band reads step 7 - i of its row), and every keyframe names every
// row: a pixel on a row its table doesn't name is a hard fail. (24-31, the factions, are reserved and nothing draws them yet.)
//
// S1 held one hour, this one. The live sky blends eight (TableBlend below, the others in SkyTables.ts, written by tools/sky/tables.py from this one's rules). World rows are research-art.md's blue table. It stops at 22 of the rows, so the others follow its own
// make_palette: INK, BUS_BLACK, GRANITE from its city gradient, GLOW_WHITE and WHITE from its glow gradient, SIGN_GREEN its sign rule. Where this differs on purpose:
// - BRIDGE_ORANGE: art graded it as paint, which leaves a salmon bridge under a dark sky. It is a world row: rose to plum, under paint's chroma.
// - FOG is the haze here, not the sky: dark to light, with its step 4 the far side's horizon (SKY_LOW 7), so that the far fade ends in the sky behind it.
// - SKY_LOW takes art's far-side low band, which art kept in FOG (SKY.md 4, Rows). The sky's four rows are art's, turned over: SKY_WARM's steps 6-7 stay warm
//   for the beam's core and nose (SKY.md 4, Traps). Their chroma stops at 0.135: 0.75 of a painted frame's median, the one rule's gate (SKY.md 1). LIT and SIGN_GREEN stop there
//   too: art left them at 0.147 and a lit window is not paint.
// - SAND: its own row, the city's blue a breath toward lilac. Rows nothing draws yet are named from their nearest kin, so S2's blend has something to start from.
export const BLUE_TABLE: Record<number, string[]> = {
  [Ramp.GREY]: ['#0c1131', '#0f153a', '#131b45', '#192353', '#223067', '#31427f', '#475c97', '#7083b5'],
  [Ramp.GREY_LIGHT]: ['#10173d', '#151e4b', '#1d295c', '#283873', '#3d508d', '#5b6fa7', '#8696c2', '#afbbd9'],
  [Ramp.FOG]: ['#16173f', '#262455', '#36326c', '#484083', '#5a4f9c', '#7269ae', '#8c84bf', '#a79fd0'],
  [Ramp.SKY_WARM]: ['#bb6193', '#cb658c', '#da6f82', '#e57879', '#ec8073', '#f38a6e', '#f8936a', '#fc9c66'],
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
  [Ramp.SIGN_GREEN]: ['#04281c', '#00402a', '#005a3d', '#00744d', '#00905d', '#35ac74', '#5ece92', '#aaedc6'],
  [Ramp.WHITE]: ['#3b3a70', '#60608e', '#8888ab', '#b3b1c9', '#d1cede', '#e0dee9', '#efeef4', '#ffffff'],
  [Ramp.ROOF_DARK]: ['#0b0f2e', '#0d1234', '#0f153a', '#111840', '#151e4b', '#1a2556', '#233168', '#31427f'],
  [Ramp.GLASS]: ['#0d1236', '#101640', '#131b4c', '#17215b', '#202b6e', '#2a3987', '#4253a2', '#7a88c8'],
  [Ramp.STONE]: ['#0f1539', '#131a43', '#19224f', '#242f64', '#34437c', '#506198', '#7a88b5', '#aab2ce'],
  [Ramp.GRANITE]: ['#080423', '#090527', '#0a072b', '#0b0930', '#0d0b37', '#111141', '#16194f', '#222968'],
  [Ramp.BRIDGE_ORANGE]: ['#120c26', '#1e112f', '#2f193c', '#452247', '#612d52', '#7e3d5c', '#9a5469', '#b27a84'],
  [Ramp.NIGHT_SKY]: ['#0e154a', '#121b58', '#162164', '#19256d', '#1c2975', '#1f2c7b', '#233080', '#263484'],
  [Ramp.OPEN_SEA]: ['#0c1236', '#101741', '#141c4c', '#192258', '#212b67', '#293477', '#363f86', '#4b4a95'],
  [Ramp.LIMB]: ['#16173f', '#262455', '#36326c', '#484083', '#5a4f9c', '#7269ae', '#8c84bf', '#a79fd0'],
  [Ramp.CLOUD]: ['#20285f', '#2c326f', '#393c7e', '#504a8b', '#685798', '#92699c', '#c27c9c', '#f4a48e'],
  [Ramp.DRY_LAND]: ['#15173f', '#1f214d', '#2b2c5e', '#3a3a70', '#4c4a82', '#635d94', '#8079a8', '#a39abc'],
  [Ramp.TWILIGHT]: ['#121b58', '#1f2a72', '#313688', '#474499', '#5a4f9e', '#7756a4', '#8b5aa4', '#a75f9b'],
  [Ramp.LIT]: ['#3a1f4a', '#7a2f58', '#bb535e', '#ea8859', '#fbb259', '#ffcf72', '#ffe7a4', '#fff7dc'],
  [Ramp.LAMP]: ['#191636', '#2f2449', '#54345a', '#8b4a60', '#bd6a5e', '#e29662', '#f6c07e', '#ffe6b0'],
  [Ramp.MOON]: ['#3d4a73', '#5c698c', '#7e8aa6', '#99a1b5', '#b4b9c4', '#cececd', '#e9e4d6', '#fffbe9'],
  [Ramp.SNOW]: ['#4b5b92', '#6475a9', '#7e8fc0', '#93a3ce', '#a9b7dc', '#c4cee8', '#dfe6f4', '#ffffff'],
  [Ramp.FARGLOW]: ['#20285f', '#2c326f', '#393c7e', '#504a8b', '#685798', '#92699c', '#c27c9c', '#f4a48e'],
  [Ramp.RIDGE]: ['#0f1336', '#15183f', '#1c1e48', '#232352', '#2a295c', '#312e66', '#383470', '#3f3a7a'],
  [Ramp.CLOUD_SHADE]: ['#141a4a', '#202355', '#2c2c60', '#38356b', '#453e77', '#524782', '#5f518e', '#6d5a9a'],
  [Ramp.SKY_LOW]: ['#2a3788', '#2e3b8c', '#333f91', '#394295', '#404696', '#494996', '#524c99', '#5a4f9c'],
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

// The live sky's tables (LIVE.md stage B, SKY.md 4): a keyframe at each of the key table's heights, setting and rising, crossed by the same hour angle the light
// crosses by. Night is the blue table (LIVE.md decision 2), so the setting chain is noon 35, day 22 (today's bytes), golden 7, sunset 1.5, blue -5, and the rising one
// noon 35, morning 16, dawn 1, blue -5. Two keyframes blend in OKLCH by the short hue arc (a grey takes the other's hue): sRGB and OKLab cross the neutral
// middle, where taupe lives. Then the clamp: a swatch the brown gate would fail drops to neutral chroma. Paint rows are exempt.

const DAY_TABLE: Record<number, string[]> = { ...dayRows, ...DAY_EXTRA };
const KEYS = [NOON_TABLE, DAY_TABLE, MORNING_TABLE, GOLDEN_TABLE, SUNSET_TABLE, DAWN_TABLE, BLUE_TABLE];
/** keyframe heights (deg, falling) and their tables (KEYS); which of them draw the bands' sky, and which are the hour */
const SET_H = [35, 22, 7, 1.5, -5], SET_K = [0, 1, 3, 4, 6];
const RISE_H = [35, 16, 1, -5], RISE_K = [0, 2, 5, 6];
const BANDS = [0, 0, 0, 1, 1, 1, 1];
const HOUR = [0, 0, 0, 0, 0, 0, 1];
/** the rows every table names: BLUE_TABLE's */
const NAMED = Object.keys(BLUE_TABLE).map(Number);
const PAINTED = new Set<number>(HUE_RAMPS);
const SW = RAMP_STEPS * 3;

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const gam = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** A hex colour's OKLCH (hue in radians) into o at i. */
function toLch(hex: string, o: Float32Array, i: number): void {
  const r = lin(parseInt(hex.slice(1, 3), 16) / 255), g = lin(parseInt(hex.slice(3, 5), 16) / 255), b = lin(parseInt(hex.slice(5, 7), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  o[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  o[i + 1] = Math.hypot(A, B);
  o[i + 2] = Math.atan2(B, A);
}

/** Two swatches by the short arc, t of the way, into o at k. */
function mixLch(a: Float32Array, i: number, b: Float32Array, j: number, t: number, o: Float32Array, k: number): void {
  const ca = a[i + 1], cb = b[j + 1];
  const ha = ca < 0.012 ? b[j + 2] : a[i + 2];
  const hb = cb < 0.012 ? ha : b[j + 2];
  let dh = hb - ha;
  dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
  o[k] = a[i] + (b[j] - a[i]) * t;
  o[k + 1] = ca + (cb - ca) * t;
  o[k + 2] = ha + dh * t;
}

/** Where h sits on a chain: the two keyframes (KEYS) and how far between. */
function onChain(H: number[], K: number[], h: number, o: Float64Array): void {
  let i = 0;
  while (i < H.length - 1 && h < H[i + 1]) i++;
  const j = Math.min(i + 1, H.length - 1);
  o[0] = K[i];
  o[1] = K[j];
  o[2] = j > i ? Math.min(1, Math.max(0, (H[i] - h) / (H[i] - H[j]))) : 0;
}

/** A keyframe's flag (BANDS, HOUR) where a chain stands. */
const at = (f: number[], c: Float64Array) => f[c[0]] + (f[c[1]] - f[c[0]]) * c[2];
/** The bands take the sky over the middle fifth of their keyframes' blend, 3 degrees: a dither of two skies is a pattern, and a sparse one is noise. */
const handover = (x: number) => {
  const t = Math.min(1, Math.max(0, (x - 0.4) / 0.2));
  return t * t * (3 - 2 * t);
};

export class TableBlend {
  /** every keyframe's swatches in OKLCH, a row of 8 at row * SW */
  private readonly keys = KEYS.map((t) => {
    const o = new Float32Array(RAMP_COUNT * SW);
    for (const r of NAMED) for (let s = 0; s < RAMP_STEPS; s++) toLch(t[r][s], o, r * SW + s * 3);
    return o;
  });
  private readonly set = new Float64Array(3);
  private readonly rise = new Float64Array(3);
  private readonly a = new Float32Array(3);
  private readonly b = new Float32Array(3);
  private readonly dayPaint = new Uint8Array(RAMP_COUNT * RAMP_STEPS * 4);
  private w = 1;
  /** at the last place(): the share of the sky the bands draw, and how far the hour is up */
  bands = 0;
  hour = 0;

  constructor() {
    writePalette(this.dayPaint);
  }

  /** The true Sun's height (deg) and how much of the light is the setting Sun's (0..1, LiveSky's hour angle). Every frame: nothing here allocates. */
  place(h: number, setting: number): void {
    const S = this.set, R = this.rise, w = (this.w = setting);
    onChain(SET_H, SET_K, h, S);
    onChain(RISE_H, RISE_K, h, R);
    const bR = handover(at(BANDS, R));
    this.bands = bR + (handover(at(BANDS, S)) - bR) * w;
    this.hour = at(HOUR, R) + (at(HOUR, S) - at(HOUR, R)) * w;
  }

  /** The placed moment's table into a palette's bytes: the rows every table names, the rest left as they are. `paint` off: the day's paint rows. */
  write(data: Uint8Array, paint: boolean): void {
    const S = this.set, R = this.rise, w = this.w, a = this.a, b = this.b;
    const s0 = this.keys[S[0]], s1 = this.keys[S[1]], r0 = this.keys[R[0]], r1 = this.keys[R[1]];
    for (const r of NAMED) {
      const hue = PAINTED.has(r) || r === Ramp.BUS_YELLOW || r === Ramp.BUS_BLACK;
      for (let s = 0; s < RAMP_STEPS; s++) {
        const i = r * SW + s * 3, d = (r * RAMP_STEPS + s) * 4;
        if (!paint && PAINTED.has(r)) {
          data[d] = this.dayPaint[d];
          data[d + 1] = this.dayPaint[d + 1];
          data[d + 2] = this.dayPaint[d + 2];
          continue;
        }
        mixLch(s0, i, s1, i, S[2], a, 0);
        mixLch(r0, i, r1, i, R[2], b, 0);
        mixLch(b, 0, a, 0, w, a, 0);
        const L = a[0], hh = a[2];
        let C = a[1];
        // (the clamp: art's gate, OKLCH hue 35-100 and dark, or taupe; a little under its floor, so a byte's rounding can't lift it back)
        const deg = ((((hh * 180) / Math.PI) % 360) + 360) % 360;
        if (!hue && deg > 35 && deg < 100 && C > 0.016 && (L < 0.6 || (L < 0.72 && C < 0.09))) C = 0.016;
        const A = C * Math.cos(hh), B = C * Math.sin(hh);
        const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, q = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
        data[d] = Math.round(255 * Math.min(1, Math.max(0, gam(Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q)))));
        data[d + 1] = Math.round(255 * Math.min(1, Math.max(0, gam(Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q)))));
        data[d + 2] = Math.round(255 * Math.min(1, Math.max(0, gam(Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q)))));
        data[d + 3] = 255;
      }
    }
  }
}

/** FOG's luma against its step (base, slope) off a palette's bytes: the live table's, for the resolve's value match. */
export function fogLumaOf(data: Uint8Array, out: THREE.Vector2): THREE.Vector2 {
  const luma = (s: number) => {
    const d = (Ramp.FOG * RAMP_STEPS + s) * 4;
    return (0.299 * data[d] + 0.587 * data[d + 1] + 0.114 * data[d + 2]) / 255;
  };
  const base = luma(0);
  return out.set(base, (luma(7) - base) / 7);
}
