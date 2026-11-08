// The Lift, Rainbow's stage 4 (docs/specs/factions/FACTIONS.md section 2, "4 · Liftoff"; docs/specs/factions/LIFT.md): a painted house crouches,
// leaps and floats, riding a swell across the neighbourhood like a boat on water, while the bus flies under it. This module is the flag, the numbers and the motion,
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
  /** the swell takes the house over this long after the launch (s): it settles on to the water */
  bobIn0: 0.8,
  bobIn1: 2.4,
  /** the heave with the swell (m, at its crest): a small, light house's, a big building's, and its spread by a hash (+- half) */
  heaveSmall: 3,
  heaveBig: 1.4,
  heaveSpread: 0.3,
  /** how far a house lags the swell under its centre (s, at most): neighbours ride it a little out of step */
  lag: 0.9,
  /** its own slow drift on top (m), its period (s) and the period's spread (s) */
  drift: 0.45,
  driftP: 11,
  driftSpread: 6,
  /** pitch and roll: the share of the water's slope a house follows, its own wobble (a slope), and the most it leans (a slope: tan 4.9 degrees) */
  tiltK: 0.85,
  tiltWobble: 0.012,
  tiltMax: 0.085,
  /** rest heights of the belly over its ground (m): the low ones (to fly over or weave round), the middle, the high flyers, and their shares */
  lowMin: 9,
  lowMax: 16,
  midMin: 34,
  midMax: 62,
  highMin: 72,
  highMax: 94,
  lowShare: 0.12,
  highShare: 0.12,
  /** two touching neighbours' rest heights stay this far apart (m) */
  apart: 6,
  /** the lowest and highest rest, and the top no lifted roof passes over its ground (m) */
  hMin: 9,
  hMax: 94,
  topMax: 105,
  /** the wave's front (m/s) and the jitter of its crouches (s) */
  wave: 110,
  waveJitter: 0.05,
  /** at most this many houses up at once: the gardens' bound */
  cap: 600,
} as const;

/**
 * The swells: two long waves crossing the neighbourhood the same way in every city (a block or two long, several seconds apart, one from the
 * north west and one from the south west of the map), which every floating house heaves, pitches and rolls on and the lake under them shows.
 * Direction of travel in x / z, wavelength (m), period (s), weight (the two sum to 1).
 */
export const SWELLS = [
  { dx: 0.92, dz: 0.39, len: 200, period: 9, weight: 0.62 },
  { dx: 0.82, dz: -0.57, len: 130, period: 6.8, weight: 0.38 },
] as const;
const SW = SWELLS.map((s) => {
  const l = Math.hypot(s.dx, s.dz), k = (2 * Math.PI) / s.len;
  return { kx: (s.dx / l) * k, kz: (s.dz / l) * k, w: (2 * Math.PI) / s.period, a: s.weight };
});

const fract = (x: number) => x - Math.floor(x);
/** the house's seeds, in double precision on the CPU (a shader's sin hash at index 40,000 is float32 noise) */
export const liftSeed = (index: number, k: number) => fract(Math.sin(index * 12.9898 + k * 78.233) * 43758.5453);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** 0 a small house, 1 a big building (by footprint m2 or height m) */
const bigOf = (area: number, height: number) => Math.max(smooth(180, 1400, area), smooth(14, 40, height));
/** the most a house of `height` may rest at: no lifted roof over topMax */
const restCap = (height: number) => Math.max(LIFT.hMin, LIFT.topMax - height);

/**
 * Rest height (m, its belly over its ground) of a house of footprint `area` (m2) and `height` (m over its ground), by a hash: a few low ones
 * (9-16 m: a house to fly over or weave round), most in the middle (34-62), a few high flyers (72-94) far above the rest. A big building keeps
 * to the lower half of the middle and never flies high. Its neighbours then move it (liftPlace).
 */
export function liftRest(area: number, height: number, index: number): number {
  const L = LIFT, big = bigOf(area, height);
  const u = liftSeed(index, 1), v = liftSeed(index, 4);
  let H: number;
  if (u < L.lowShare) H = L.lowMin + (L.lowMax - L.lowMin) * v;
  else if (u < 1 - L.highShare * (1 - big)) H = L.midMin + (L.midMax - L.midMin) * (1 - 0.5 * big) * v;
  else H = L.highMin + (L.highMax - L.highMin) * v;
  return Math.min(Math.max(L.hMin, H), restCap(height));
}

/** A house already placed near the one being placed: its rest, its height over its ground (m), its reach (liftReach), how far its footprint's bounds are (m) and whether it touches (within 3 m). */
export interface LiftNear {
  H: number;
  height: number;
  reach: number;
  dist: number;
  touching: boolean;
}
/**
 * Near: footprints' bounds within this (m), the flight's window on the bellies round the bus (LiftField's NEAR cells), where a belly d m past
 * the bus's half length (6 m) is counted 2d m higher: so is it here, for the room over a low house.
 */
export const LIFT_NEAR = 24;
const nearCredit = (dist: number) => 2 * Math.max(0, dist - 6);
/** The room a low house leaves over its roof (its domes allowed 6 m) under its near neighbours' lowest bellies (m): the bus's hard floor, its body and its floor's gap under a deck */
export const LIFT_ROOM = 22;
/** too low to pass under: its lowest belly under LIFT_PASS */
export const liftLow = (H: number, reach: number) => H - reach < LIFT_PASS;

/**
 * Where a house rests among the houses already placed near it (`near`; the wave places them out from the heart, the same on every run), from its
 * hash's height `H` (liftRest), its `height` and `reach`:
 * - a low house stays low only where every near neighbour floats high enough to leave LIFT_ROOM over it (the bus flies over it under them);
 *   else it goes to the middle band. So no low house is ever a wall the bus meets under a deck it can't climb out of;
 * - a house near a low one floats at least LIFT_ROOM over that one's top;
 * - never two touching neighbours within LIFT.apart: the nearest height in its band that is, in steps of 1.5 m, else the middle band's, else
 *   the one farthest from them.
 */
export function liftPlace(H: number, height: number, reach: number, near: ArrayLike<LiftNear>): number {
  const L = LIFT, cap = restCap(height);
  let h = H;
  if (liftLow(h, reach)) {
    for (let i = 0; i < near.length; i++) {
      const n = near[i];
      if (liftLow(n.H, n.reach)) continue;
      if (n.H - n.reach + nearCredit(n.dist) < h + height + 6 + reach + LIFT_ROOM) {
        h = L.midMin + (L.midMax - L.midMin) * fract((H - L.lowMin) * 0.613 + 0.29);
        break;
      }
    }
  }
  // (the least it may rest at: over every low neighbour's top with the room)
  let least: number = L.hMin;
  if (!liftLow(h, reach))
    for (let i = 0; i < near.length; i++) {
      const n = near[i];
      if (liftLow(n.H, n.reach)) least = Math.max(least, n.H + n.height + 6 + n.reach + LIFT_ROOM + reach - nearCredit(n.dist));
    }
  h = Math.max(h, Math.min(least, cap));
  const gap = (c: number) => {
    let d = Infinity;
    for (let i = 0; i < near.length; i++) if (near[i].touching) d = Math.min(d, Math.abs(near[i].H - c));
    return d;
  };
  let best = h, bestGap = gap(h);
  if (bestGap >= L.apart) return h;
  const band = liftLow(h, reach) ? [L.lowMin, L.lowMax] : h >= L.highMin ? [L.highMin, L.highMax] : [L.midMin, L.midMax];
  for (const [lo0, hi0] of [band, [L.midMin, L.highMax]]) {
    const lo = liftLow(h, reach) ? lo0 : Math.max(lo0, Math.min(least, cap)), hi = Math.min(hi0, cap);
    for (let k = 1; k <= 60; k++) {
      const c = h + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.5;
      if (c < lo || c > hi) continue;
      const g = gap(c);
      if (g >= L.apart) return c;
      if (g > bestGap) [best, bestGap] = [c, g];
    }
  }
  return best;
}

/** The heave (m, at the swell's crest) of a house of footprint `area` and `height`: small, light houses more, big ones less. */
export function liftHeave(area: number, height: number, index: number): number {
  const L = LIFT;
  return (L.heaveSmall + (L.heaveBig - L.heaveSmall) * bigOf(area, height)) * (1 + L.heaveSpread * (liftSeed(index, 5) - 0.5));
}

/**
 * A floating house whose lowest belly comes under this over its ground (m) is too low for the bus to pass under (under a belly the flight's
 * floor is 12 m below it, and its hard floor 3.5 m over the ground): it is an obstacle from the ground up, to fly over or round.
 */
export const LIFT_PASS = 17;

/** How far the lean alone takes a point of a house off its centre's height (m): `rad` its reach from its centre. */
export const liftTiltReach = (rad: number) => LIFT.tiltMax * rad + 0.2;
/** How far the swell, the drift and the lean take any point of its belly or roof off its centre's rest (m). */
export const liftReach = (heave: number, rad: number) => heave + LIFT.drift + liftTiltReach(rad) + 0.1;

/** The swell at (x, z) at `t`: out[0] its height (-1..1), out[1] and out[2] its slope along x and z (per m). */
export function swellAt(x: number, z: number, t: number, out: Float64Array | Float32Array | number[]): void {
  let S = 0, gx = 0, gz = 0;
  for (const s of SW) {
    const a = x * s.kx + z * s.kz - s.w * t;
    const c = s.a * Math.cos(a);
    S += s.a * Math.sin(a);
    gx += s.kx * c;
    gz += s.kz * c;
  }
  out[0] = S;
  out[1] = gx;
  out[2] = gz;
}
const swTmp = new Float64Array(3);

/**
 * The lift at `t` s after the crouch started (`now` the game clock): out[0] = dy (m, of its centre), out[1] = the vertical stretch (sy - 1),
 * out[2] and out[3] its lean (its belly's slope along x and z: a point (dx, dz) off its centre is about dx * out[2] + dz * out[3] higher).
 * `cx`, `cz` its centre (the swell under it), `heave` its heave (liftHeave). Mirrors GLSL_LIFT's sbLiftAt line for line.
 */
export function liftAt(t: number, now: number, H: number, seedB: number, cx: number, cz: number, heave: number, out: number[] | Float64Array | Float32Array): void {
  const L = LIFT;
  out[2] = 0;
  out[3] = 0;
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
  // (the swell under its centre, a little late; its own drift; its lean with the water's slope, and a wobble of its own)
  const f = smooth(L.bobIn0, L.bobIn1, t - L.crouch);
  swellAt(cx, cz, now - L.lag * fract(seedB * 5.31), swTmp);
  const P = L.driftP + L.driftSpread * fract(seedB * 7.13);
  const ph = 6.2832 * fract(seedB * 3.71);
  dy += f * (heave * swTmp[0] + L.drift * Math.sin((6.2832 * now) / P + ph));
  let sx = L.tiltK * heave * swTmp[1] + L.tiltWobble * Math.sin((6.2832 * now) / (P * 0.8) + 2 * ph);
  let sz = L.tiltK * heave * swTmp[2] + L.tiltWobble * Math.cos((6.2832 * now) / (P * 1.1) + 3 * ph);
  const l = Math.hypot(sx, sz);
  if (l > L.tiltMax) {
    sx *= L.tiltMax / l;
    sz *= L.tiltMax / l;
  }
  out[0] = dy;
  out[1] = sq;
  out[2] = f * sx;
  out[3] = f * sz;
}

const F = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);
const [S1, S2] = SW;
/** GLSL: the swell's height at p and t (sbSwell adds its slope) */
const SWELL_A = (p: string, t: string, s: (typeof SW)[number]) => `(dot(${p}, vec2(${F(s.kx)}, ${F(s.kz)})) - ${F(s.w)} * ${t})`;

/**
 * GLSL: sbLiftAt (the motion), sbLift(idx, centre, T2) (a house's lift now: x dy, y the stretch, zw its lean, from tLift's two texels: the first
 * x crouch start, y rest height, z bob seed; the second, uLiftRows rows down, x and z its centre, y its ground, w its heave, into T2),
 * sbLiftMove (a point of it moved: stretched, lifted and leant about its belly's middle) and sbSwell / sbSwellH (the swell). Zero outside the
 * neighbourhood's rect (nothing fetched), for a house on the ground and before its crouch. Needs uTime (GLSL_COMMON or its own).
 */
export const GLSL_LIFT = /* glsl */ `
uniform highp sampler2D tLift;
uniform vec4 uLiftRect;
uniform float uLiftW;
uniform float uLiftRows;
float sbSwellH(vec2 p, float t) {
  return ${F(S1.a)} * sin${SWELL_A('p', 't', S1)} + ${F(S2.a)} * sin${SWELL_A('p', 't', S2)};
}
vec3 sbSwell(vec2 p, float t) {
  float a1 = ${SWELL_A('p', 't', S1)}, a2 = ${SWELL_A('p', 't', S2)};
  float c1 = ${F(S1.a)} * cos(a1), c2 = ${F(S2.a)} * cos(a2);
  return vec3(${F(S1.a)} * sin(a1) + ${F(S2.a)} * sin(a2), vec2(${F(S1.kx)}, ${F(S1.kz)}) * c1 + vec2(${F(S2.kx)}, ${F(S2.kz)}) * c2);
}
vec4 sbLiftAt(float t, float now, float H, float sb, vec2 cxz, float heave) {
  if (t < ${F(LIFT.crouch)}) {
    float k = t / ${F(LIFT.crouch)};
    return vec4(-${F(LIFT.sink)} * k, -${F(LIFT.squash)} * sin(1.5707963 * k), 0.0, 0.0);
  }
  float u = min(t - ${F(LIFT.crouch)}, 8.0);
  float e = exp(-${F(LIFT.k)} * u), c = cos(${F(LIFT.w)} * u), s = sin(${F(LIFT.w)} * u);
  float dy = (H + ${F(LIFT.sink)}) * (1.0 - e * c) - ${F(LIFT.sink)};
  float v = clamp(e * (${F(LIFT.k)} * c + ${F(LIFT.w)} * s) / ${F(LIFT.k)}, -0.4, 1.0);
  float sq = -${F(LIFT.squash)} + (${F(LIFT.stretch)} * v + ${F(LIFT.squash)}) * smoothstep(0.0, ${F(LIFT.snap)}, u);
  float f = smoothstep(${F(LIFT.bobIn0)}, ${F(LIFT.bobIn1)}, t - ${F(LIFT.crouch)});
  vec3 sw = sbSwell(cxz, now - ${F(LIFT.lag)} * fract(sb * 5.31));
  float P = ${F(LIFT.driftP)} + ${F(LIFT.driftSpread)} * fract(sb * 7.13);
  float ph = 6.2832 * fract(sb * 3.71);
  dy += f * (heave * sw.x + ${F(LIFT.drift)} * sin(6.2832 * now / P + ph));
  vec2 ln = ${F(LIFT.tiltK)} * heave * sw.yz + ${F(LIFT.tiltWobble)} * vec2(sin(6.2832 * now / (P * 0.8) + 2.0 * ph), cos(6.2832 * now / (P * 1.1) + 3.0 * ph));
  float l = length(ln);
  if (l > ${F(LIFT.tiltMax)}) ln *= ${F(LIFT.tiltMax)} / l;
  return vec4(dy, sq, f * ln);
}
vec4 sbLiftTexel(float idx) {
  return texelFetch(tLift, ivec2(int(mod(idx, uLiftW)), int(floor(idx / uLiftW))), 0);
}
vec4 sbLiftTexel2(float idx) {
  return texelFetch(tLift, ivec2(int(mod(idx, uLiftW)), int(floor(idx / uLiftW) + uLiftRows)), 0);
}
vec4 sbLift(float idx, vec2 cxz, out vec4 T2) {
  T2 = vec4(0.0);
  if (idx < 0.0 || cxz.x < uLiftRect.x || cxz.x > uLiftRect.z || cxz.y < uLiftRect.y || cxz.y > uLiftRect.w) return vec4(0.0);
  vec4 L = sbLiftTexel(idx);
  float t = uTime - L.x;
  if (L.y <= 0.0 || t < 0.0) return vec4(0.0);
  T2 = sbLiftTexel2(idx);
  return sbLiftAt(t, uTime, L.y, L.z, T2.xz, T2.w);
}
// (v turned with its up leant to the slope s: up goes to the water's normal)
vec3 sbTilt(vec3 v, vec2 s) {
  float l = length(s);
  if (l < 1e-6) return v;
  vec3 k = vec3(-s.y, 0.0, s.x) / l;
  float c = inversesqrt(1.0 + l * l);
  return v * c + cross(k, v) * (l * c) + k * dot(k, v) * (1.0 - c);
}
vec3 sbLiftMove(vec3 p, float baseY, vec4 lf, vec4 T2) {
  float sy = 1.0 + lf.y;
  p.y = baseY + (p.y - baseY) * sy + lf.x;
  p.xz = T2.xz + (p.xz - T2.xz) / sqrt(max(sy, 0.4));
  vec3 piv = vec3(T2.x, T2.y + lf.x, T2.z);
  return piv + sbTilt(p - piv, lf.zw);
}
`;

/** How far the lake floods out past a floating house's footprint (m): the yards, the alleys and the street between, one lake under a lifted block. */
export const LAKE_FLOOD = 12;

/**
 * GLSL: the lake of paint under the floating houses (the terrain's fragment shader, so it lies on any slope and costs no draw). tLake: RGBA32F over
 * the neighbourhood at 1 / uLakeRect.z m a texel from (uLakeRect.x, uLakeRect.y), on its squares only: x the nearest liftable house's index + 1
 * (0 none), y the signed distance to its footprint's edge (m, + inside, down to -LAKE_FLOOD), z and w its centre. Each texel is its nearest
 * house's: once that one is 30 ms into its launch the ground there is lake, so a lifted block floods as one, yards and streets with it, and a lone
 * house lifted by a hit leaves a pool to its grounded neighbours' halfway. The swell runs across it, lighter on its crests with foam along them,
 * the same swell the houses ride; rings of the faction's hues, tinted by the house above, ripple out from under each house, pushed out as it
 * comes down and drawn in as it rises, with foam in them and a foam shore; it glows a little, so from a kilometre the lifted block reads as a
 * pool of light. Needs GLSL_LIFT, GLSL_FACTION, uPaint and uPaintW, uGroundTone.
 */
export const GLSL_LAKE = /* glsl */ `
uniform highp sampler2D tLake;
uniform vec4 uLakeRect;
bool sbLake(vec3 wp, float flatL, out float ramp, out float light, out float glow) {
  ramp = 0.0; light = 0.0; glow = 0.0;
  if (wp.x < uLiftRect.x || wp.x > uLiftRect.z || wp.z < uLiftRect.y || wp.z > uLiftRect.w) return false;
  vec2 g = (wp.xz - uLakeRect.xy) * uLakeRect.z - 0.5;
  ivec2 sz = textureSize(tLake, 0);
  if (g.x < 0.0 || g.y < 0.0 || g.x > float(sz.x) - 2.0 || g.y > float(sz.y) - 2.0) return false;
  ivec2 i0 = ivec2(floor(g));
  vec2 f = fract(g);
  vec4 a = texelFetch(tLake, i0, 0), b = texelFetch(tLake, i0 + ivec2(1, 0), 0);
  vec4 c = texelFetch(tLake, i0 + ivec2(0, 1), 0), d = texelFetch(tLake, i0 + ivec2(1, 1), 0);
  float sd = mix(mix(a.y, b.y, f.x), mix(c.y, d.y, f.x), f.y);
  if (sd <= -${F(LAKE_FLOOD)} + 0.25) return false;
  vec4 best = a;
  if (b.y > best.y) best = b;
  if (c.y > best.y) best = c;
  if (d.y > best.y) best = d;
  float idx = best.x - 1.0;
  if (idx < 0.0) return false;
  vec4 L = sbLiftTexel(idx);
  float t = uTime - L.x;
  // (once 30 ms into its launch, a metre up for the lowest house: the motion's exp and trig are not run on every lake pixel)
  if (L.y <= 0.0 || t < ${F(LIFT.crouch)} + 0.03) return false;
  vec4 pt = texelFetch(uPaint, ivec2(int(mod(idx, uPaintW)), int(floor(idx / uPaintW))), 0);
  int fac = sbFac(pt.a > 7.5 ? pt.a - 8.0 : pt.a);
  float hue = floor(pt.r + 0.5);
  // the swell here, and under the house above as it rides it (its heave in m, a little late, as sbLiftAt has it)
  float sw = sbSwellH(wp.xz, uTime);
  float hv = sbSwellH(best.zw, uTime - ${F(LIFT.lag)} * fract(L.z * 5.31)) * sbLiftTexel2(idx).w;
  // rings out from under the house, stirred by its heave, tinted by the house above (its hue, a step either way), every fifth one foam
  float dj = length(wp.xz - best.zw);
  float band = floor(dj / 1.7 - 1.15 * uTime - 0.6 * hv + idx * 0.37);
  float m4 = mod(band, 4.0);
  bool foam = mod(band, 5.0) < 0.5;
  ramp = foam ? sbFacTrim(fac) : sbFacHue(fac, int(mod(hue + (m4 < 0.5 ? 0.0 : m4 < 1.5 ? 1.0 : m4 < 2.5 ? 0.0 : -1.0) + 60.0, 6.0)), true);
  light = max(0.17 + uGroundTone.x + flatL * 0.5, 0.36) + (foam ? 0.16 : 0.1) + 0.07 * sw;
  glow = 0.4;
  float shore = sd + ${F(LAKE_FLOOD)};
  if (shore < 0.9) { light -= 0.12; glow = 0.2; }
  else if (shore < 1.9) { ramp = sbFacTrim(fac); light += 0.12; }
  else {
    // (the water's dashes, moving out with the rings; and on the swell's crests a broken line of foam, running with it)
    vec2 q = vec2(dj / 1.7 - 1.15 * uTime, (wp.x + wp.z) / 2.6);
    float row = fract(sin(dot(floor(q.yy), vec2(127.1, 311.7))) * 43758.5453);
    float dash = fract(sin(dot(vec2(floor(q.x * 2.0 + row * 7.0), floor(q.y)), vec2(127.1, 311.7))) * 43758.5453);
    if (dash > 0.86 && fract(q.y) < 0.4) light += 0.14;
    if (sw > 0.8 && dash > 0.35) { ramp = sbFacTrim(fac); light += 0.1; glow = 0.45; }
  }
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
  /** the drawn lift of a house now (m; 0 on the ground): its centre's */
  dy(index: number): number;
  /** the drawn lift of a house at (x, z) now, its lean in it (m; 0 on the ground): where its roof is drawn there */
  dyAt(index: number, x: number, z: number): number;
  /** how far over its roof a house can reach while it's up (m; 0 on the ground): the line-of-fire prefilter */
  reach(index: number): number;
  /** is the house floating wholly over fromY (its drawn underside more than a metre above it): no target from there */
  over(index: number, baseY: number, fromY: number): boolean;
  /** a garden or a dome's top over this house (m ASL): the field lifts it with the house */
  noteTop(index: number, top: number): void;
  /** Splat's question for a building a blast reaches: 0 no, 1 it lifts now (Rainbow on Rainbow at level 3), 2 it's lifting or up already */
  wants(ref: { index: number }, level: number, faction: number): 0 | 1 | 2;
  /** a Bomb's question: is it lifting, up or staged already (wants' 2), with nothing asked to lift and nothing counted */
  aloft(ref: { index: number }): boolean;
  /** a hit lifts it: it crouches at `at`, its bloom's arrival (game clock) */
  start(ref: { index: number }, at: number, hose?: boolean): void;
}
