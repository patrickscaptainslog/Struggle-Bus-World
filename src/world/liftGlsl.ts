// The Lift, Rainbow's stage 4 (docs/specs/factions/FACTIONS.md section 2, "4 · Liftoff"; docs/specs/factions/LIFT.md): a painted house crouches,
// leaps on a rainbow geyser and floats, bobbing on its own, while the bus flies under it. This module is the flag, the numbers and the motion,
// once in TypeScript (the flight and the aim) and once in GLSL (every shader that moves with a house), from one table. No three.js and no DOM:
// the Node checks bundle it (tools/factions/lift-check.mjs). With the flag off nothing here reaches a shader (sky/flag.ts's law): `lifted()`
// is '' and no source differs by a byte.

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
/** ?lift: the first look at the stages, in one neighbourhood (off unless asked for; never on a Moon page) */
export const liftOn = !!q && q.has('lift') && !q.has('moon') && !q.has('moonland') && !q.has('moonrun');
/** &lifted: the neighbourhood staged at level 3, Rainbow, for the session, and lifted as a wave from its heart */
export const liftedOn = liftOn && q!.has('lifted');
/** &slowmo=0 turns the lift-off's slow motion off (decision 13: the producer judges it) */
export const slowmoOn = liftOn && q!.get('slowmo') !== '0';
/** GLSL only ?lift compiles (sky/flag.ts's held()) */
export const lifted = (glsl: string): string => (liftOn ? glsl : '');
export const liftedOr = (glsl: string, off: string): string => (liftOn ? glsl : off);

/** Every number of the motion (CPU and GPU read these, never their own copies). */
export const LIFT = {
  /** the crouch: s, how far it sinks (m), how much it squashes */
  crouch: 0.3,
  sink: 0.35,
  squash: 0.16,
  /** the jump: decay and frequency of the spring (1/s): the launch is k * H a second, the overshoot 13 % at 0.571 s */
  k: 3.2,
  w: 4.4,
  /** the stretch on the launch, and how fast the squash snaps into it (s) */
  stretch: 0.16,
  snap: 0.06,
  /** the bob: amplitude at 45 m (m), period and its spread (s), fade-in after the launch (s) */
  bobAmp: 1.2,
  bobP: 3.6,
  bobSpread: 1.6,
  bobIn0: 0.8,
  bobIn1: 2.4,
  /** rest heights (m) and the top no lifted roof passes over its ground (m) */
  hMin: 15,
  hMax: 50,
  topMax: 75,
  /** the wave's front (m/s) and the jitter of its crouches (s) */
  wave: 110,
  waveJitter: 0.05,
  /** at most this many houses up at once: the geysers' capacity and the gardens' bound */
  cap: 600,
} as const;

const fract = (x: number) => x - Math.floor(x);
/** the house's two seeds, in double precision on the CPU (a shader's sin hash at index 40,000 is float32 noise) */
export const liftSeed = (index: number, k: number) => fract(Math.sin(index * 12.9898 + k * 78.233) * 43758.5453);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Rest height (m) of a house of footprint `area` (m2) and `height` (m over its ground): small houses high, big buildings low, +-15 %. */
export function liftRest(area: number, height: number, index: number): number {
  const big = Math.max(smooth(180, 1400, area), smooth(14, 40, height));
  let H = (46 - 29 * big) * (0.85 + 0.3 * liftSeed(index, 1));
  H = Math.min(LIFT.hMax, Math.max(LIFT.hMin, H));
  return Math.min(H, Math.max(LIFT.hMin, LIFT.topMax - height));
}

/** The bob's amplitude (m): its reach is at most 1.3 times this. */
export const liftAmp = (H: number, seedB: number) => LIFT.bobAmp * (0.7 + 0.6 * seedB) * Math.sqrt(H / 45);

/**
 * The lift at `t` s after the crouch started (`now` the game clock, for the bob): out[0] = dy (m), out[1] = the vertical stretch (sy - 1).
 * Mirrors GLSL_LIFT's sbLiftAt line for line.
 */
export function liftAt(t: number, now: number, H: number, seedB: number, out: [number, number] | Float64Array | Float32Array): void {
  const L = LIFT;
  if (t < 0 || H <= 0) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  if (t < L.crouch) {
    const k = t / L.crouch;
    out[0] = -L.sink * k;
    out[1] = -L.squash * Math.sin((Math.PI / 2) * k);
    return;
  }
  const u = Math.min(t - L.crouch, 8);
  const e = Math.exp(-L.k * u), c = Math.cos(L.w * u), s = Math.sin(L.w * u);
  let dy = (H + L.sink) * (1 - e * c) - L.sink;
  const v = Math.min(1, Math.max(-0.4, (e * (L.k * c + L.w * s)) / L.k));
  const sq = -L.squash + (L.stretch * v + L.squash) * smooth(0, L.snap, u);
  const amp = liftAmp(H, seedB);
  const P = L.bobP + L.bobSpread * fract(seedB * 7.13);
  const ph = 6.2832 * fract(seedB * 3.71);
  const a = (6.2832 * now) / P + ph;
  dy += amp * smooth(L.bobIn0, L.bobIn1, t - L.crouch) * (Math.sin(a) + 0.3 * Math.sin(2.3 * a + ph));
  out[0] = dy;
  out[1] = sq;
}

const F = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/**
 * GLSL: sbLiftAt (the motion) and sbLift(idx, centre) (a house's lift now, from tLift: x crouch start, y rest height, z bob seed). Zero outside the
 * neighbourhood's rect (nothing fetched), for a house on the ground and before its crouch. Needs uTime (GLSL_COMMON or its own).
 */
export const GLSL_LIFT = /* glsl */ `
uniform highp sampler2D tLift;
uniform vec4 uLiftRect;
uniform float uLiftW;
vec2 sbLiftAt(float t, float now, float H, float sb) {
  if (t < ${F(LIFT.crouch)}) {
    float k = t / ${F(LIFT.crouch)};
    return vec2(-${F(LIFT.sink)} * k, -${F(LIFT.squash)} * sin(1.5707963 * k));
  }
  float u = min(t - ${F(LIFT.crouch)}, 8.0);
  float e = exp(-${F(LIFT.k)} * u), c = cos(${F(LIFT.w)} * u), s = sin(${F(LIFT.w)} * u);
  float dy = (H + ${F(LIFT.sink)}) * (1.0 - e * c) - ${F(LIFT.sink)};
  float v = clamp(e * (${F(LIFT.k)} * c + ${F(LIFT.w)} * s) / ${F(LIFT.k)}, -0.4, 1.0);
  float sq = -${F(LIFT.squash)} + (${F(LIFT.stretch)} * v + ${F(LIFT.squash)}) * smoothstep(0.0, ${F(LIFT.snap)}, u);
  float amp = ${F(LIFT.bobAmp)} * (0.7 + 0.6 * sb) * sqrt(H / 45.0);
  float P = ${F(LIFT.bobP)} + ${F(LIFT.bobSpread)} * fract(sb * 7.13);
  float ph = 6.2832 * fract(sb * 3.71);
  float a = 6.2832 * now / P + ph;
  dy += amp * smoothstep(${F(LIFT.bobIn0)}, ${F(LIFT.bobIn1)}, t - ${F(LIFT.crouch)}) * (sin(a) + 0.3 * sin(2.3 * a + ph));
  return vec2(dy, sq);
}
vec4 sbLiftTexel(float idx) {
  return texelFetch(tLift, ivec2(int(mod(idx, uLiftW)), int(floor(idx / uLiftW))), 0);
}
vec2 sbLift(float idx, vec2 cxz) {
  if (idx < 0.0 || cxz.x < uLiftRect.x || cxz.x > uLiftRect.z || cxz.y < uLiftRect.y || cxz.y > uLiftRect.w) return vec2(0.0);
  vec4 L = sbLiftTexel(idx);
  float t = uTime - L.x;
  if (L.y <= 0.0 || t < 0.0) return vec2(0.0);
  return sbLiftAt(t, uTime, L.y, L.z);
}
`;

/**
 * GLSL: the lake of paint under a floating house (the terrain's fragment shader, so it lies on any slope and costs no draw). tLake: RG32F over the
 * neighbourhood at 1 / uLakeRect.z m a texel from (uLakeRect.x, uLakeRect.y): x the house's index + 1 (0 none), y the signed distance to its
 * footprint's edge (m, + inside). It shows once its house is 0.3 m up, in rings of the house's faction hues that follow the footprint and flow in
 * toward the jet, lit as ground paint is (so the house's floating shadow lies on it), a darker rim and a moving glint. Needs GLSL_LIFT, GLSL_FACTION,
 * uPaint and uPaintW, uGroundTone.
 */
export const GLSL_LAKE = /* glsl */ `
uniform highp sampler2D tLake;
uniform vec4 uLakeRect;
bool sbLake(vec3 wp, float flatL, out float ramp, out float light, out float glow) {
  ramp = 0.0; light = 0.0; glow = 0.0;
  vec2 g = (wp.xz - uLakeRect.xy) * uLakeRect.z - 0.5;
  ivec2 sz = textureSize(tLake, 0);
  if (g.x < 0.0 || g.y < 0.0 || g.x > float(sz.x) - 2.0 || g.y > float(sz.y) - 2.0) return false;
  ivec2 i0 = ivec2(floor(g));
  vec2 f = fract(g);
  vec2 a = texelFetch(tLake, i0, 0).rg, b = texelFetch(tLake, i0 + ivec2(1, 0), 0).rg;
  vec2 c = texelFetch(tLake, i0 + ivec2(0, 1), 0).rg, d = texelFetch(tLake, i0 + ivec2(1, 1), 0).rg;
  float sd = mix(mix(a.y, b.y, f.x), mix(c.y, d.y, f.x), f.y);
  if (sd <= 0.0) return false;
  vec2 best = a;
  if (b.y > best.y) best = b;
  if (c.y > best.y) best = c;
  if (d.y > best.y) best = d;
  float idx = best.x - 1.0;
  if (idx < 0.0) return false;
  vec4 L = sbLiftTexel(idx);
  float t = uTime - L.x;
  if (L.y <= 0.0 || t < 0.0 || sbLiftAt(t, uTime, L.y, L.z).x < 0.3) return false;
  vec4 pt = texelFetch(uPaint, ivec2(int(mod(idx, uPaintW)), int(floor(idx / uPaintW))), 0);
  int fac = sbFac(pt.a > 7.5 ? pt.a - 8.0 : pt.a);
  float band = floor(sd / 1.3 - 0.7 * uTime + idx * 0.37);
  ramp = sbFacHue(fac, int(mod(floor(pt.r + 0.5) + band + 60.0, 6.0)), true);
  light = max(0.11 + uGroundTone.x + flatL * 0.5, 0.28) + 0.06;
  if (sd < 0.7) light -= 0.11;
  else {
    // (the water's dashes, moving in with the rings)
    vec2 q = vec2(sd / 1.3 - 0.7 * uTime, (wp.x + wp.z) / 2.6);
    float row = fract(sin(dot(floor(q.yy), vec2(127.1, 311.7))) * 43758.5453);
    float dash = fract(sin(dot(vec2(floor(q.x * 2.0 + row * 7.0), floor(q.y)), vec2(127.1, 311.7))) * 43758.5453);
    if (dash > 0.86 && fract(q.y) < 0.4) light += 0.14;
  }
  glow = 0.25;
  return true;
}
`;

/** The slow motion's factor `t` s (wall clock) into a profile: down to k over tin (a cosine), held, back over tout. */
export function slowAt(t: number, k: number, tin: number, hold: number, tout: number): number {
  if (t < 0 || t >= tin + hold + tout) return 1;
  if (t < tin) return k + (1 - k) * 0.5 * (1 + Math.cos((Math.PI * t) / tin));
  if (t < tin + hold) return k;
  return k + (1 - k) * 0.5 * (1 - Math.cos((Math.PI * (t - tin - hold)) / tout));
}
/** A hit's lift-off: 0.35x for 0.9 s of wall clock. The wave's front reaching the bus: 0.30x for 1.2 s. */
export const SLOW_HIT = [0.35, 0.1, 0.45, 0.35] as const;
export const SLOW_WAVE = [0.3, 0.15, 0.6, 0.45] as const;
/** no slow motion again within this many s of wall clock: a firehose or a chain of taps never stutters */
export const SLOW_COOLDOWN = 8;

/** The bake's normalisation of a neighbourhood's name: lower case, accents stripped, only letters and digits. */
export const hoodKey = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** What picking a neighbourhood reads of city.json. */
export interface HoodCity {
  bounds: [number, number, number, number];
  tileSize: number;
  tiles: Array<[number, number, number]>;
}
/** What it reads of hoods.bin's table (world/hoods.ts). */
export interface HoodList {
  names: string[];
  hearts: number[];
  squares: number[][];
  godless: boolean[];
}
/** The areas' square size (m): FACTIONS.md section 3, C18. */
export const SQUARE = 128;
export const squareIx = (key: number) => ((key >>> 16) << 16) >> 16;
export const squareIz = (key: number) => ((key & 0xffff) << 16) >> 16;
export const squareKey = (ix: number, iz: number) => (((ix & 0xffff) << 16) | (iz & 0xffff)) >>> 0;

/** Buildings a square (m): from city.json's per-tile counts, each tile's spread over the squares in it. */
export function hoodDensity(t: HoodList, n: number, city: HoodCity): number {
  const per = (SQUARE * SQUARE) / (city.tileSize * city.tileSize);
  const count = new Map<number, number>();
  for (const [tx, tz, c] of city.tiles) count.set(tx * 65536 + tz, c);
  let sum = 0;
  for (const key of t.squares[n]) {
    const x = (squareIx(key) + 0.5) * SQUARE, z = (squareIz(key) + 0.5) * SQUARE;
    sum += (count.get(Math.floor(x / city.tileSize) * 65536 + Math.floor(z / city.tileSize)) ?? 0) * per;
  }
  return t.squares[n].length ? sum / t.squares[n].length : 0;
}

/**
 * The neighbourhood ?lift stages: `want` (&hood=, either part of an "A / B" name counts), else Alamo Square, else by the data: of those with a god
 * and 8 or more buildings a square, the one whose heart is nearest the middle of the map. -1 when there is none.
 */
export function pickHood(t: HoodList, want: string | null, city: HoodCity): number {
  for (const w of [want, 'Alamo Square']) {
    if (!w) continue;
    const k = hoodKey(w);
    if (!k) continue;
    for (let n = 0; n < t.names.length; n++) {
      const name = t.names[n];
      if (hoodKey(name) === k || name.split('/').some((p) => hoodKey(p) === k)) return n;
    }
  }
  const [x0, z0, x1, z1] = city.bounds;
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  let best = -1, bd = Infinity;
  for (let n = 0; n < t.names.length; n++) {
    if (t.godless[n] || hoodDensity(t, n, city) < 8) continue;
    const h = t.hearts[n];
    const d = Math.hypot((squareIx(h) + 0.5) * SQUARE - mx, (squareIz(h) + 0.5) * SQUARE - mz);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/**
 * Where the bus starts for a neighbourhood: from its heart toward the sun (sx, sz on the ground) until the square under the step is no longer
 * the neighbourhood's, then 40 m on (or `out` m from the heart), facing in, away from the sun: the houses are front-lit. Heading in compass
 * radians (0 north, -Z).
 */
export function hoodStart(squares: Set<number>, heart: number, sx: number, sz: number, out?: number): { x: number; z: number; heading: number } {
  const l = Math.hypot(sx, sz) || 1;
  const ux = sx / l, uz = sz / l;
  const hx = (squareIx(heart) + 0.5) * SQUARE, hz = (squareIz(heart) + 0.5) * SQUARE;
  let d = 0;
  if (out !== undefined) d = out;
  else {
    while (d < 4000 && squares.has(squareKey(Math.floor((hx + ux * d) / SQUARE), Math.floor((hz + uz * d) / SQUARE)))) d += 8;
    d += 40;
  }
  return { x: hx + ux * d, z: hz + uz * d, heading: Math.atan2(-ux, uz) };
}

/** What the City asks of the Lift (City.lift; the type alone: the City pulls in no runtime code of it). Every call is a no-op answer outside the hood. */
export interface LiftHooks {
  /** the flight's obstacle at (x, z) seen from fromY (Infinity from above), given the City's own baked answer there */
  obstacle(x: number, z: number, fromY: number, baked: number): number;
  /** the lowest underside of a floating house over fromY at (x, z), or Infinity */
  overhead(x: number, z: number, fromY: number): number;
  /** where a breath lands at (x, z) seen from fromY, as drawn now (the exact path) */
  surface(x: number, z: number, fromY: number, baked: number): number;
  /** the drawn lift of a house now (m; 0 on the ground) */
  dy(index: number): number;
  /** how far over its roof a house can reach while it's up (m; 0 on the ground): the line-of-fire prefilter */
  reach(index: number): number;
  /** is the house floating wholly over fromY (its drawn underside more than a metre above it): no target from there */
  over(index: number, baseY: number, fromY: number): boolean;
  /** a garden or a dome's top over this house (m ASL): the field lifts it with the house */
  noteTop(index: number, top: number): void;
  /** Splat's question for a building a blast reaches: 0 no, 1 it lifts now (Rainbow on Rainbow at level 3), 2 it's lifting or up already */
  wants(ref: { index: number }, level: number, faction: number): 0 | 1 | 2;
  /** a hit lifts it: it crouches at `at`, its bloom's arrival (game clock) */
  start(ref: { index: number }, at: number, hose?: boolean): void;
}
