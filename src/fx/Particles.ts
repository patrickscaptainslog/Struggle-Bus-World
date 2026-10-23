import * as THREE from 'three';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { HUE_COUNT, HUE_RAMPS, Ramp } from '../render/palette';
import { registerTunables } from '../ui/tunables';

// Pixel particles: the barf geyser (THE money shot), wet impact splashes,
// bloom sparkles, ambient twinkles and grey exhaust puffs.
//
// One THREE.Points draw call over a fixed-capacity ring buffer. Particles are
// simulated analytically in the vertex shader from their spawn parameters
// (Hermite homing path, ballistic drop with one bounce, drag + rise), so the
// CPU only writes a slot when a particle is born and uploads just those slots
// (reused update ranges, no per-frame allocation, no full re-upload).
//
// Every particle is a crisp sprite of whole game pixels: gl_PointSize is the
// world size projected into the low-res G-buffer and rounded to an integer
// (min 1 px; 1-3 px at gameplay distance). Bigger sprites are shaped in the
// fragment shader into pixel-art shapes: round candy blobs (stretched into
// capsules along their screen velocity, so a fast stream reads as liquid),
// 4-point twinkle stars, puffs. Output goes through sbWrite() with flags 0.5
// (no ink outlines) and writes depth (the resolve pass treats depth == 1 as
// sky). Particles are not in SHADOW_LAYER: they never cast sun shadows.
//
// The geyser is a true ribbon: every particle follows the stream's Hermite
// centerline from the (moving) mouth to the roof, offset across the stream
// along the curve's SCREEN-SPACE perpendicular, so the rainbow bands follow
// the curve and always face the camera. Bands are flat candy colors (one step
// brighter on their sun side), so overlapping blobs merge into continuous
// stripes instead of confetti. 7 bands in rainbow order: the center (widest)
// is the splat's hue, the edges are the complementary hue split in half. The
// bands are mirrored so each neighbor's hue sits on the side its building is
// on, and each neighbor gets a glossy stream that peels off ITS band of the
// ribbon and lands exactly when that building blooms (travelTime + i *
// cascadeStep). The primary stream lands travelTime after emission.

/** Live-tunable look + feel numbers (read every spawn / frame). */
export const fxTune = {
  // --- geyser ribbon
  /** Ribbon particles per second at full flow. */
  ribbonRate: 2300,
  /** Ribbon half-width at the mouth / at the landing (m). */
  halfWidth0: 2.2,
  halfWidth1: 7.5,
  /** Depth (toward-camera) thickness relative to the width; the center bulges forward. */
  depth: 0.45,
  /** Blob size at the landing (m). <= 3 game px at the 175 m chase distance (0.315 m / px). */
  blobSize: 1.25,
  /** Blob size multiplier at the mouth (blobs grow as the ribbon flares). */
  blobMouth: 0.62,
  /** Width of the center (primary hue) band relative to the others. */
  centerWeight: 1.6,
  /** Band-local threshold past which the sun side of each band is one step brighter (1 = off). */
  bandShine: 0.42,
  /** Fraction of ribbon particles that land scattered as small shaded droplets. */
  sprayFrac: 0.1,
  sprayScatter: 2.6,
  /** Droplets flicked off the ribbon's flanks per second (ballistic). */
  flickRate: 260,
  flickOut: 9,
  /** Initial downward blast and arrival speed (m/s) — shapes the Hermite path. */
  blast: 0,
  arrive: 34,
  /** Fraction of the bus velocity the barf inherits (curls the ribbon behind a moving bus). */
  inherit: 0.7,
  /** Sideways blast out of the door (m/s, toward the bus's right). 0 = straight ahead (dragon breath). */
  doorOut: 0,
  /** Forward blast out of the front of the bus (m/s): the dragon-breath projectile. */
  forwardOut: 95,
  /** Upward kick at launch (m/s): the jet lifts a little before it arcs down onto the roofs ahead. */
  doorUp: 12,
  /** Coherent ribbon flutter: amplitude (m) and frequency (Hz). */
  wobbleAmp: 0.32,
  wobbleHz: 1.9,
  /** Glow of the ribbon body, share of tiny white-hot glints, share of brighter blobs. */
  ribbonGlow: 0.2,
  glintFrac: 0.05,
  brightFrac: 0.06,
  /** Motion smear: seconds of screen motion stretched into each blob, and its cap (game px). */
  stretch: 0.03,
  maxStretch: 9,
  /** Fraction of ribbon particles that hop off the roof on landing. */
  landBounce: 0.4,
  /** Hop speed off the roof (m/s). */
  hopUp: 6,
  hopOut: 4,
  // --- streams to neighbors
  /** Stream particles per second per neighbor. */
  arcRate: 260,
  /** Apex of a stream above the mouth (m) for a neighbor 18 m away; nearer ones arc lower (nested rainbows). */
  arcApex: 6,
  /** How much a stream's launch follows the ribbon before it peels off (0..1). */
  arcPeel: 0.3,
  arcSize: 0.6,
  /** Stream half-thickness (m). */
  arcHalfWidth: 0.2,
  /** Extra travel time per stream after the first (s): later neighbors land later. */
  streamStep: 0.075,
  // --- flung blobs (the blast throws paint far out; each lands as a spatter dot)
  /** Blob size multiplier, trailing droplets per blob, landing splash drops per blob. */
  flingSize: 1,
  flingTrail: 2,
  flingSplash: 7,
  /** Gravity multiplier for flung blobs: high = snappy, tall explosive arcs that still land on time. */
  flingGravity: 3.6,
  // --- blast burst (a rainbow fountain thrown straight up out of the impact)
  burstCount: 260,
  /** Upward speed range (m/s) and sideways spread (m/s). */
  burstUp: 34,
  burstOut: 11,
  burstSize: 1.1,
  // --- drops / splash
  gravity: 34,
  splashCount: 150,
  splashUp: 12,
  splashOut: 7,
  splashSize: 0.6,
  /** Share of splash drops that bounce once, and how hard. */
  splashBounce: 0.35,
  restitution: 0.38,
  /** Drops landing farther than this from the impact fall past the roof edge (m). */
  roofRadius: 4.2,
  // --- sparkles
  sparkSize: 1.9,
  sparkLife: 1.25,
  sparkRise: 2.6,
  sparkGlow: 1,
  /** Share of sparkles that are GLOW_WHITE (the rest take the bloom hues). */
  sparkWhite: 0.4,
  // --- puffs (sooty grey wisps of a wheezing engine: never the brightest thing on screen)
  puffSize: 0.75,
  puffGrow: 2.2,
  puffLife: 0.95,
  /** Puff light offset (ramp units) and how much they take the sun shadow. */
  puffLight: -0.3,
  puffShadow: 0.7,
  // --- look
  /** Ramp step of each rainbow hue's body color (R, O, Y, G, B, V). */
  stepRed: 4,
  stepOrange: 4,
  stepYellow: 5,
  stepGreen: 4,
  stepBlue: 4,
  stepViolet: 4,
  /** Fog multiplier for paint / for puffs. */
  fogPaint: 0.6,
  fogPuff: 1,
  /** Largest sprite (game px). */
  maxPx: 28,
};

registerTunables('Particles', fxTune, {
  ribbonRate: [100, 2500, 10],
  halfWidth0: [0.2, 4, 0.05],
  halfWidth1: [0.2, 6, 0.05],
  depth: [0, 1.5, 0.05],
  blobSize: [0.2, 2.5, 0.05],
  blobMouth: [0.2, 1.5, 0.02],
  centerWeight: [0.5, 4, 0.1],
  bandShine: [0, 1, 0.01],
  sprayFrac: [0, 1, 0.01],
  sprayScatter: [0, 6, 0.1],
  flickRate: [0, 600, 5],
  flickOut: [0, 20, 0.5],
  blast: [0, 60, 0.5],
  arrive: [0, 80, 0.5],
  inherit: [0, 1.5, 0.05],
  doorOut: [0, 90, 1],
  forwardOut: [0, 220, 1],
  doorUp: [-20, 40, 0.5],
  wobbleAmp: [0, 2, 0.02],
  wobbleHz: [0, 6, 0.1],
  ribbonGlow: [0, 1, 0.01],
  glintFrac: [0, 0.5, 0.01],
  brightFrac: [0, 1, 0.01],
  stretch: [0, 0.12, 0.005],
  maxStretch: [0, 24, 1],
  landBounce: [0, 1, 0.01],
  hopUp: [0, 15, 0.1],
  hopOut: [0, 10, 0.1],
  arcRate: [0, 800, 10],
  arcApex: [0, 15, 0.1],
  arcPeel: [0, 1, 0.01],
  arcSize: [0.2, 2.5, 0.05],
  arcHalfWidth: [0, 2, 0.02],
  streamStep: [0, 0.3, 0.005],
  flingSize: [0.2, 3, 0.05],
  flingTrail: [0, 6, 1],
  flingSplash: [0, 30, 1],
  flingGravity: [0.5, 8, 0.1],
  burstCount: [0, 800, 10],
  burstUp: [0, 80, 1],
  burstOut: [0, 40, 0.5],
  burstSize: [0.2, 3, 0.05],
  gravity: [5, 80, 0.5],
  splashCount: [0, 400, 1],
  splashUp: [0, 30, 0.5],
  splashOut: [0, 20, 0.5],
  splashSize: [0.1, 2, 0.02],
  splashBounce: [0, 1, 0.01],
  restitution: [0, 0.9, 0.01],
  roofRadius: [0, 20, 0.1],
  sparkSize: [0.3, 5, 0.05],
  sparkLife: [0.2, 4, 0.05],
  sparkRise: [0, 10, 0.1],
  sparkGlow: [0, 1, 0.01],
  sparkWhite: [0, 1, 0.01],
  puffSize: [0.2, 5, 0.05],
  puffGrow: [0, 5, 0.05],
  puffLife: [0.1, 4, 0.05],
  puffLight: [-0.5, 0.5, 0.01],
  puffShadow: [0, 1, 0.01],
  stepRed: [0, 7, 1],
  stepOrange: [0, 7, 1],
  stepYellow: [0, 7, 1],
  stepGreen: [0, 7, 1],
  stepBlue: [0, 7, 1],
  stepViolet: [0, 7, 1],
  fogPaint: [0, 1, 0.01],
  fogPuff: [0, 1, 0.01],
  maxPx: [2, 64, 1],
});

// slot layout (floats)
//  0..3  aP0   p0.xyz, t0
//  4..7  aV0   v0.xyz, life
//  8..11 aP1   kind-specific (ribbon/stream: target.xyz, travel time)
// 12..15 aV1   kind-specific xyz (ribbon/stream: arrival velocity), kind
// 16..19 aLook ramp, size (m), seed, look flags
// 20..23 aExt  ribbon: u (-1..1 across), depth, band-local coord, width mul
//              stream: u at the mouth, local across (-1..1), band-local coord, width mul
const STRIDE = 24;
const MAX_EMITTERS = 4;
const MAX_TARGETS = 8;
/** The particle clock is rebased (all t0 shifted) past this, to keep float32 precision. */
const REBASE_AT = 2048;
/** Hop time of ribbon blobs that bounce off the roof (s). */
const HOP_LIFE = 0.36;
/** How long a landed drop lingers (shrinking) on the roof (s). */
const LINGER = 0.2;

const K_RIBBON = 0;
const K_DROP = 1;
const K_SPARK = 2;
const K_TWINKLE = 3;
const K_PUFF = 4;
const K_STREAM = 5;

// look flags
const F_SHADED = 1; // per-blob lit edge + shadow edge (individual droplets)
const F_BRIGHT = 2; // one step brighter
const F_GLINT = 4; // brightest step + full glow
const F_NOSTRETCH = 8; // keep round (no motion smear)
const F_DEEP = 16; // one step deeper (wet paint reads darker than the dry, sunlit roof under it)

interface Emitter {
  active: boolean;
  start: number;
  duration: number;
  travel: number;
  source: () => THREE.Vector3;
  sourceVel: () => THREE.Vector3;
  targets: THREE.Vector3[];
  hues: Int32Array;
  /** Ribbon u (-1..1) of the band each neighbor's stream peels off from. */
  bandU: Float32Array;
  carryArc: Float32Array;
  n: number;
  hue0: number;
  bandSign: number;
  carry: number;
  carryFlick: number;
  last: THREE.Vector3;
  lastT: number;
  right: THREE.Vector3;
  /** Last good door direction (bus right, horizontal). */
  door: THREE.Vector3;
}

const rnd = Math.random;
const wrapHue = (h: number) => ((Math.round(h) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT;

/** Time until a drop launched with vertical speed vy from dy above the floor hits it. */
function hitTime(vy: number, dy: number, g: number): number {
  return (vy + Math.sqrt(vy * vy + 2 * g * Math.max(dy, 0))) / g;
}

/**
 * Band layout across the ribbon in "q" units: bands k = -3..3 have widths
 * .5, 1, 1, cw, 1, 1, .5. Returns the q of edge i (0..7).
 */
function bandEdge(i: number, cw: number): number {
  if (i <= 0) return 0;
  if (i === 1) return 0.5;
  if (i === 2) return 1.5;
  if (i === 3) return 2.5;
  if (i === 4) return 2.5 + cw;
  if (i === 5) return 3.5 + cw;
  if (i === 6) return 4.5 + cw;
  return 5 + cw;
}

const VERT = /* glsl */ `
${GLSL_COMMON}
uniform float uNow;
uniform float uViewH;
uniform float uMaxPx;
uniform vec4 uRib;    // ribbon glow, wobble amp, wobble hz, hop speed up
uniform vec4 uGey;    // half width at mouth, half width at landing, depth, blob size at mouth
uniform vec4 uArc;    // stream half width, band shine threshold, -, -
uniform vec4 uLand;   // gravity, hop out, fog paint, fog puff
uniform vec4 uSpk;    // spark glow, stretch seconds, max stretch px, -
uniform vec4 uPuff;   // light offset, shadow mul, -, -
uniform float uHueStep[6];
in vec4 aP0;
in vec4 aV0;
in vec4 aP1;
in vec4 aV1;
in vec4 aLook;
in vec4 aExt;
flat out vec4 vA;  // ramp, step, glow, shape (0 blob, 1 star, 2 puff)
flat out vec4 vB;  // N px, keep (dissolve), arm px, fog
flat out vec4 vC;  // sprite light dir xy, sun shadow, flags
flat out vec4 vD;  // smear dir xy (sprite space), smear half length px, blob radius px

float hueStep(float ramp) {
  int i = int(ramp + 0.5) - ${Ramp.RED};
  if (i < 0 || i > 5) return 6.0;
  return uHueStep[i];
}

// Ballistic drop with one optional bounce. e > 0 bounce, e == 0 stick, e < 0 fall past.
// restT: time since the drop stopped flying (or fell past the floor); -1 while flying.
vec3 dropPath(vec3 p0, vec3 v0, float t, float floorY, float e, float G, out float restT, out vec3 vel) {
  restT = -1.0;
  float disc = v0.y * v0.y + 2.0 * G * max(p0.y - floorY, 0.0);
  float sq = sqrt(disc);
  float th = (v0.y + sq) / G;
  if (t < th || e < 0.0) {
    if (t >= th) restT = t - th;
    vel = v0 - vec3(0.0, G * t, 0.0);
    return p0 + v0 * t - vec3(0.0, 0.5 * G * t * t, 0.0);
  }
  vec3 ph = p0 + v0 * th;
  ph.y = floorY;
  float tt = t - th;
  vel = vec3(0.0);
  if (e <= 0.0) { restT = tt; return ph; }
  float vyb = sq * e;
  float tb = 2.0 * vyb / G;
  vec2 vh = v0.xz * 0.55;
  if (tt < tb) {
    vel = vec3(vh.x, vyb - G * tt, vh.y);
    return ph + vec3(vh.x * tt, vyb * tt - 0.5 * G * tt * tt, vh.y * tt);
  }
  restT = tt - tb;
  return ph + vec3(vh.x * tb, 0.0, vh.y * tb);
}

// A point of the geyser ribbon (or a neighbor stream) at path parameter s:
// Hermite centerline + offset across the stream along the curve's screen-space
// perpendicular (+ a forward bulge for the ribbon) + coherent flutter.
// velV: view-space velocity (m/s). nOut: screen-space direction of +u.
vec3 ribbonAt(float s, bool stream, out vec3 velV, out vec2 nOut) {
  float T = aP1.w;
  float s2 = s * s;
  float s3 = s2 * s;
  vec3 D0 = aV0.xyz * T;
  vec3 D1 = aV1.xyz * T;
  vec3 C = (2.0 * s3 - 3.0 * s2 + 1.0) * aP0.xyz + (s3 - 2.0 * s2 + s) * D0
         + (-2.0 * s3 + 3.0 * s2) * aP1.xyz + (s3 - s2) * D1;
  vec3 dC = (6.0 * s2 - 6.0 * s) * aP0.xyz + (3.0 * s2 - 4.0 * s + 1.0) * D0
          + (6.0 * s - 6.0 * s2) * aP1.xyz + (3.0 * s2 - 2.0 * s) * D1;
  vec3 tv = mat3(viewMatrix) * dC;
  vec2 perp = vec2(-tv.y, tv.x);
  float pl = length(perp);
  vec2 n = pl > 1e-4 ? perp / pl : vec2(1.0, 0.0);
  vec3 Rw = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 Uw = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 Bh = vec3(viewMatrix[0][2], 0.0, viewMatrix[2][2]);
  float bl = length(Bh);
  Bh = bl > 1e-4 ? Bh / bl : vec3(0.0, 0.0, 1.0);
  vec3 across = n.x * Rw + n.y * Uw;
  vec3 p;
  if (stream) {
    float f = 1.0 - s;
    p = C + across * (aExt.x * uGey.x * aExt.w * f * f + aExt.y * uArc.x);
  } else {
    // narrow through the door bend (no folding), flaring wide onto the roof
    float w = mix(uGey.x, uGey.y, s * s) * aExt.w;
    p = C + across * (aExt.x * w) + Bh * (aExt.y * w * uGey.z);
  }
  // coherent flutter: everything emitted at the same instant shares it, so
  // the bands wave together like a ribbon instead of smearing
  p += across * (uRib.y * sin(aP0.w * uRib.z * 6.2832 + s * 2.6) * sin(3.14159 * s));
  velV = tv / T;
  nOut = n;
  return p;
}

void cull() {
  gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
  gl_PointSize = 1.0;
  vA = vec4(0.0);
  vB = vec4(1.0, 0.0, 0.0, 0.0);
  vC = vec4(0.0);
  vD = vec4(1.0, 0.0, 0.0, 0.5);
}

void main() {
  float t0 = aP0.w;
  float life = aV0.w;
  float kind = aV1.w;
  float age = uNow - t0;
  if (age < 0.0 || age >= life) { cull(); return; }
  float ramp = aLook.x;
  float size = aLook.y;
  float seed = aLook.z;
  int flags = int(aLook.w + 0.5);
  float x = age / life;
  vec3 p;
  vec3 velV = vec3(0.0); // view-space velocity, for the motion smear
  float st = hueStep(ramp);
  float glow = uRib.x;
  float shape = 0.0;
  float keep = 1.0;
  float arm = 0.0;
  float fogMul = uLand.z;
  float G = uLand.x;
  vec3 sv = mat3(viewMatrix) * uSunDir;
  vec2 sunS = normalize(sv.xy + vec2(1e-4, 0.0)); // sun direction on screen (y up)

  if (kind < 0.5 || kind > 4.5) {
    // ---- geyser ribbon / neighbor stream: Hermite homing from the mouth onto the roof
    bool stream = kind > 4.5;
    float T = aP1.w;
    vec2 n;
    if (age < T) {
      float s = age / T;
      p = ribbonAt(s, stream, velV, n);
      if (!stream) size *= mix(uGey.w, 1.0, s);
      // each band is one flat candy color, one step brighter on its sun side:
      // stacked glossy tubes, and blobs of a band merge into a clean stripe
      float side = dot(n, sunS) >= 0.0 ? 1.0 : -1.0;
      if (aExt.z * side > uArc.y) st += 1.0;
    } else {
      // landed: hop off the roof as a little shaded droplet, then shrink away
      vec3 vDummy;
      vec3 L = ribbonAt(1.0, stream, vDummy, n);
      float tau = age - T;
      float post = max(life - T, 1e-3);
      float a = seed * 61.0;
      float out_ = uLand.y * (0.4 + 0.6 * fract(seed * 7.31));
      vec3 vo = vec3(cos(a) * out_, uRib.w * (0.45 + 0.55 * fract(seed * 13.7)), sin(a) * out_);
      p = L + vo * tau;
      p.y -= 0.5 * G * tau * tau;
      float floorY = aP1.y;
      if (p.y < floorY) p.y = floorY;
      velV = mat3(viewMatrix) * (vo - vec3(0.0, G * tau, 0.0));
      size *= 0.55 * (1.0 - tau / post);
      flags |= ${F_SHADED};
    }
  } else if (kind < 1.5) {
    // ---- drop: ballistic, maybe one bounce, lingers or falls past the edge
    float restT;
    vec3 vw;
    p = dropPath(aP0.xyz, aV0.xyz, age, aP1.x, aP1.y, G * aP1.z, restT, vw);
    velV = mat3(viewMatrix) * vw;
    if (restT >= 0.0) size *= max(0.0, 1.0 - restT / ${LINGER.toFixed(3)}) * 0.85;
    glow = uRib.x * 0.8;
  } else if (kind < 3.5) {
    // ---- sparkle / ambient twinkle: rise with drag, twinkle as a 4-point star
    float k = aP1.x;
    p = aP0.xyz + aV0.xyz * ((1.0 - exp(-k * age)) / k) + vec3(0.0, aP1.y * age, 0.0);
    shape = 1.0;
    glow = uSpk.x;
    float tw;
    if (kind < 2.5) {
      // burst flash, then twinkle, then blink out
      float flash = 1.0 - smoothstep(0.0, 0.14, age);
      float pulse = 0.5 + 0.5 * sin(age * aP1.z + seed * 40.0);
      tw = max(flash, pulse * pulse) * (1.0 - smoothstep(0.55, 1.0, x) * 0.5);
      float blinkStart = aV1.x;
      if (x > blinkStart) {
        float k2 = (x - blinkStart) / max(1.0 - blinkStart, 1e-3);
        if (sbHash11(floor(age * 15.0) + seed * 731.0) < k2) { cull(); return; }
      }
    } else {
      // one slow twinkle: grow, hold, shrink
      tw = sin(3.14159 * x);
      tw *= tw;
    }
    arm = tw; // scaled to px below
    st = 6.0;
    flags |= ${F_NOSTRETCH};
  } else {
    // ---- puff: drag + buoyancy, grows, dithers away
    float k = aP1.x;
    p = aP0.xyz + aV0.xyz * ((1.0 - exp(-k * age)) / k) + vec3(0.0, aP1.y * age, 0.0);
    size *= 1.0 + aP1.z * (1.0 - (1.0 - x) * (1.0 - x));
    keep = 1.0 - smoothstep(0.3, 1.0, x);
    // it thins away by shrinking (a dither pattern anchored to the screen crawled over the moving puff)
    size *= keep;
    if (keep < 0.08) { cull(); return; }
    shape = 2.0;
    glow = 0.0;
    fogMul = uLand.w;
    flags |= ${F_NOSTRETCH};
  }

  if ((flags & ${F_BRIGHT}) != 0) st += 1.0;
  if ((flags & ${F_DEEP}) != 0) st -= 1.0;
  if ((flags & ${F_GLINT}) != 0) { st = 7.0; glow = 1.0; }
  if (size <= 0.0) { cull(); return; }

  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // world size -> low-res pixels (projectionMatrix[1][1] = 1 / tan(vfov / 2))
  float pxPerM = projectionMatrix[1][1] * 0.5 * uViewH / max(gl_Position.w, 1e-3);
  float D = max(size * pxPerM, 1.0);
  // motion smear: a capsule along the screen velocity (sprite space, y down)
  vec2 sdir = vec2(1.0, 0.0);
  float ha = 0.0;
  if ((flags & ${F_NOSTRETCH}) == 0 && D > 1.5) {
    vec2 spx = vec2(velV.x, -velV.y) * pxPerM;
    float sl = length(spx);
    if (sl > 1e-3) {
      sdir = spx / sl;
      ha = floor(min(sl * uSpk.y, uSpk.z) + 0.5) * 0.5;
    }
  }
  float span = D + 2.0 * ha;
  if (span > uMaxPx) {
    float k = uMaxPx / span;
    D *= k;
    ha *= k;
  }
  float N = clamp(floor(D + 2.0 * ha + 0.5), 1.0, uMaxPx);
  if (shape > 0.5 && shape < 1.5) {
    // stars: odd sprite, arm length follows the twinkle
    float armMax = floor((N - 1.0) * 0.5);
    float a = floor(armMax * arm + 0.5);
    arm = a;
    N = 2.0 * a + 1.0;
  }
  gl_PointSize = N;

  // sprite-space light direction (x right, y down) from the sun, biased to the top
  vec2 L = normalize(vec2(sv.x, -sv.y) * 0.8 + vec2(-0.2, -0.75));
  float sh = shape > 1.5 ? sbShadow(p, vec3(0.0, 1.0, 0.0)) : 1.0;

  vA = vec4(ramp, st, glow, shape);
  vB = vec4(N, keep, arm, sbFog(p) * fogMul);
  vC = vec4(L, sh, float(flags));
  vD = vec4(sdir, ha, D * 0.5);
}
`;

const FRAG = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uPuff;
flat in vec4 vA;
flat in vec4 vB;
flat in vec4 vC;
flat in vec4 vD;
${GLSL_OUT}

float bayer4(ivec2 p) {
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0;
}

void main() {
  float N = vB.x;
  vec2 c = floor(gl_PointCoord * N) - (N - 1.0) * 0.5; // centered pixel offset in the sprite
  // distance to the smear segment (a capsule; a circle when not smeared)
  float ha = vD.z;
  float R = vD.w;
  vec2 d = c - vD.xy * clamp(dot(c, vD.xy), -ha, ha);
  float r2 = dot(d, d);
  float ramp = vA.x;
  float st = vA.y;
  float glow = vA.z;
  float shape = vA.w;
  int flags = int(vC.w + 0.5);
  float light;
  if (shape < 0.5) {
    // candy blob: pixel-art circle / capsule (plus at 3 px, rounded square at 4)
    if (N > 2.5 && r2 > R * R - 0.3) discard;
    if ((flags & ${F_SHADED}) != 0 && R > 1.25) {
      // glossy drop: lit rim toward the sun, a highlight dot, and a shadow rim
      // only on big drops (small ones stay wet-looking, not beady)
      float dl = dot(d, vC.xy) / max(R - 0.5, 0.5);
      if (dl < -0.62 && R > 2.75) st -= 1.0;
      else if (dl > 0.55) st += 1.0;
      if (R > 2.25) {
        vec2 hd = d + vC.xy * (R - 1.6);
        if (dot(hd, hd) < 0.55) st = 7.0;
      }
    }
    light = (clamp(st, 0.0, 7.0) + 0.15) / 7.0;
  } else if (shape < 1.5) {
    // 4-point twinkle star, white heart
    float ax = abs(c.x);
    float ay = abs(c.y);
    float m = max(ax, ay);
    bool axis = min(ax, ay) < 0.5;
    bool diag = vB.z > 2.5 && abs(ax - 1.0) < 0.1 && abs(ay - 1.0) < 0.1;
    if (!axis && !diag) discard;
    if (m < 0.5) {
      ramp = ${Ramp.GLOW_WHITE}.0;
      st = 7.0;
    } else if (diag) {
      st = 5.0;
    } else {
      st = 7.0 - min(m, 3.0) * 0.67;
      st = floor(st + 0.5);
    }
    light = (st + 0.15) / 7.0;
  } else {
    // puff: grey ball lit by the low sun, dissolves through ordered dither
    float R2 = N * 0.5;
    float q2 = dot(c, c);
    if (N > 2.5 && q2 > R2 * R2 - 0.3) discard;
    vec2 nn = c / max(R2, 1.0);
    vec3 nv = vec3(nn.x, -nn.y, sqrt(max(0.0, 1.0 - dot(nn, nn))));
    vec3 nw = normalize(nv * mat3(viewMatrix));
    float ndl = max(dot(nw, uSunDir), 0.0);
    float sky = 0.5 + 0.5 * nw.y;
    light = uLight.y + uLight.z * sky + uLight.x * ndl * mix(1.0, vC.z, uPuff.y) + uPuff.x;
  }
  sbWrite(ramp, light, vB.w, glow, vec3(0.0, 0.0, 1.0), 0.5, 0.5);
}
`;

export class Particles {
  readonly object: THREE.Object3D;
  private readonly cap: number;
  private readonly data: Float32Array;
  private readonly buf: THREE.InterleavedBuffer;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly death: Float32Array;
  private readonly s = new Float32Array(STRIDE);
  private head = 0;
  private used = 0;
  private time = 0;
  private lastDeath = -1;
  // dirty run of slots (ring order) not yet uploaded
  private dirtyStart = 0;
  private dirtyCount = 0;
  private uploadQueued = false;
  private readonly rangeA = { start: 0, count: 0 };
  private readonly rangeB = { start: 0, count: 0 };
  private viewH = 520;
  private readonly hueSteps = new Float32Array(6);
  private readonly uNow = { value: 0 };
  private readonly uViewH = { value: 520 };
  private readonly uMaxPx = { value: 24 };
  private readonly uRib = { value: new THREE.Vector4() };
  private readonly uGey = { value: new THREE.Vector4() };
  private readonly uArc = { value: new THREE.Vector4() };
  private readonly uLand = { value: new THREE.Vector4() };
  private readonly uSpk = { value: new THREE.Vector4() };
  private readonly uPuff = { value: new THREE.Vector4() };
  private readonly emitters: Emitter[] = [];
  // camera right axis captured at render time (horizontal)
  private readonly camRight = new THREE.Vector3(1, 0, 0);
  private readonly tS = new THREE.Vector3();
  private readonly tV = new THREE.Vector3();
  private readonly tA = new THREE.Vector3();
  private readonly tB = new THREE.Vector3();

  constructor(maxParticles = 6000) {
    const cap = Math.max(16, Math.floor(maxParticles));
    this.cap = cap;
    this.data = new Float32Array(cap * STRIDE);
    this.death = new Float32Array(cap).fill(-1);
    // never born: t0 far in the future, life 0
    for (let i = 0; i < cap; i++) this.data[i * STRIDE + 3] = 1e9;
    this.buf = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    // `position` only gives three.js the vertex count; the shader reads aP0
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    geo.setAttribute('aP0', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    geo.setAttribute('aV0', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    geo.setAttribute('aP1', new THREE.InterleavedBufferAttribute(this.buf, 4, 8));
    geo.setAttribute('aV1', new THREE.InterleavedBufferAttribute(this.buf, 4, 12));
    geo.setAttribute('aLook', new THREE.InterleavedBufferAttribute(this.buf, 4, 16));
    geo.setAttribute('aExt', new THREE.InterleavedBufferAttribute(this.buf, 4, 20));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    geo.setDrawRange(0, 0);
    this.geo = geo;

    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...globals,
        uNow: this.uNow,
        uViewH: this.uViewH,
        uMaxPx: this.uMaxPx,
        uRib: this.uRib,
        uGey: this.uGey,
        uArc: this.uArc,
        uLand: this.uLand,
        uSpk: this.uSpk,
        uPuff: this.uPuff,
        uHueStep: { value: this.hueSteps },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: true,
      depthWrite: true,
      transparent: false,
    });

    const points = new THREE.Points(geo, this.mat);
    points.name = 'Particles';
    points.frustumCulled = false;
    points.visible = false;
    // not in SHADOW_LAYER: particles never cast sun shadows
    points.onBeforeRender = (renderer, _scene, camera) => {
      // gl_PointSize is in pixels of the target being drawn: the G-buffer's
      // exact height (visible height + margin) when there is one, else the
      // height passed to setViewportHeight().
      const rt = renderer.getRenderTarget();
      this.uViewH.value = rt ? rt.height : this.viewH;
      const m = camera.matrixWorld.elements;
      const rx = m[0], rz = m[2];
      const rl = Math.hypot(rx, rz);
      if (rl > 1e-4) this.camRight.set(rx / rl, 0, rz / rl);
    };
    this.object = points;

    for (let i = 0; i < MAX_EMITTERS; i++) {
      const targets: THREE.Vector3[] = [];
      for (let k = 0; k < MAX_TARGETS; k++) targets.push(new THREE.Vector3());
      this.emitters.push({
        active: false,
        start: 0,
        duration: 1,
        travel: 0.35,
        source: () => this.tS,
        sourceVel: () => this.tV,
        targets,
        hues: new Int32Array(MAX_TARGETS),
        bandU: new Float32Array(MAX_TARGETS),
        carryArc: new Float32Array(MAX_TARGETS),
        n: 0,
        hue0: 0,
        bandSign: 1,
        carry: 0,
        carryFlick: 0,
        last: new THREE.Vector3(),
        lastT: 0,
        right: new THREE.Vector3(1, 0, 0),
        door: new THREE.Vector3(1, 0, 0),
      });
    }
    this.syncUniforms();
  }

  /**
   * Height of the low-res framebuffer in game pixels (sprite sizes are computed
   * in these pixels). While the particles render into a render target (the
   * pipeline's G-buffer) that target's exact height is used instead, which
   * also accounts for the pipeline's hidden margin.
   */
  setViewportHeight(px: number): void {
    this.viewH = Math.max(1, px);
    this.uViewH.value = this.viewH;
  }

  /** Number of live particles. */
  get alive(): number {
    let n = 0;
    const t = this.time;
    const d = this.death;
    for (let i = 0; i < this.used; i++) if (d[i] > t) n++;
    return n;
  }

  // ------------------------------------------------------------------ geyser

  geyser(opts: {
    source: () => THREE.Vector3;
    sourceVel: () => THREE.Vector3;
    targets: THREE.Vector3[];
    duration: number;
    travelTime: number;
    hues: number[];
  }): void {
    let e: Emitter | null = null;
    for (let i = 0; i < this.emitters.length; i++) {
      const x = this.emitters[i];
      if (!x.active) {
        e = x;
        break;
      }
      if (!e || x.start < e.start) e = x;
    }
    if (!e) return;
    e.active = true;
    e.start = this.time;
    e.duration = Math.max(0.05, opts.duration);
    e.travel = Math.max(0.05, opts.travelTime);
    e.source = opts.source;
    e.sourceVel = opts.sourceVel;
    e.last.copy(opts.source());
    e.lastT = this.time;
    e.carry = 0;
    e.carryFlick = 0;
    e.right.copy(this.camRight);
    e.door.copy(this.camRight);
    const n = Math.min(MAX_TARGETS, opts.targets.length);
    if (n === 0) {
      e.n = 1;
      e.targets[0].copy(e.last).y -= 9;
    } else {
      e.n = n;
      for (let i = 0; i < n; i++) e.targets[i].copy(opts.targets[i]);
    }
    for (let i = 0; i < e.n; i++) {
      e.hues[i] = wrapHue(opts.hues.length ? opts.hues[Math.min(i, opts.hues.length - 1)] : 0);
      e.carryArc[i] = 0;
    }
    e.hue0 = e.hues[0];
    // lay the rainbow out so each neighbor's hue sits on the side its building is on
    const P1 = e.targets[0];
    let corr = 0;
    for (let i = 1; i < e.n; i++) {
      const lat = (e.targets[i].x - P1.x) * e.right.x + (e.targets[i].z - P1.z) * e.right.z;
      const off = ((e.hues[i] - e.hue0 + HUE_COUNT + 3) % HUE_COUNT) - 3; // -3..2
      corr += off * lat;
    }
    e.bandSign = corr < 0 ? -1 : 1;
    // the band each neighbor's stream peels off from
    const cw = fxTune.centerWeight;
    const W = 5 + cw;
    for (let i = 1; i < e.n; i++) {
      const off = ((e.hues[i] - e.hue0 + HUE_COUNT + 3) % HUE_COUNT) - 3;
      const k = off * e.bandSign; // -3..3
      const q = 0.5 * (bandEdge(k + 3, cw) + bandEdge(k + 4, cw));
      e.bandU[i] = (q / W) * 2 - 1;
    }
  }

  private updateEmitter(e: Emitter, t1: number, dt: number) {
    const T = fxTune;
    const end = e.start + e.duration;
    const a = Math.max(e.start, t1 - dt);
    const b = Math.min(end, t1);
    const S = this.tA.copy(e.source());
    const V = this.tB.copy(e.sourceVel());
    // door direction: the bus's right side, from its heading (kept when hovering)
    const sp = Math.hypot(V.x, V.z);
    if (sp > 0.5) e.door.set(-V.z / sp, 0, V.x / sp);
    if (b > a) {
      const span = t1 - e.lastT;
      const xm = ((a + b) * 0.5 - e.start) / e.duration;
      // gush at the start, thinning dribble at the end
      const gush = xm < 0.12 ? 1 - xm / 0.12 : 0;
      const tail = xm > 0.7 ? (xm - 0.7) / 0.3 : 0;
      const rate = T.ribbonRate * (1 + 0.9 * gush - 0.72 * tail);
      let nf = rate * (b - a) + e.carry;
      let count = Math.floor(nf);
      e.carry = nf - count;
      for (let j = 0; j < count; j++) {
        const tj = a + ((j + rnd()) / count) * (b - a);
        const f = span > 1e-6 ? (tj - e.lastT) / span : 1;
        this.emitRibbon(e, tj, f, S, V, (tj - e.start) / e.duration);
      }
      // droplets flicked off the flanks
      nf = T.flickRate * (b - a) * (1 + gush - 0.5 * tail) + e.carryFlick;
      count = Math.floor(nf);
      e.carryFlick = nf - count;
      for (let j = 0; j < count; j++) {
        const tj = a + ((j + rnd()) / count) * (b - a);
        const f = span > 1e-6 ? (tj - e.lastT) / span : 1;
        this.emitFlick(e, tj, f, S, V);
      }
      // streams to neighbors (stop a little before the ribbon does)
      if (xm < 0.8) {
        for (let i = 1; i < e.n; i++) {
          nf = T.arcRate * (b - a) * (1 + 0.6 * gush) + e.carryArc[i];
          count = Math.floor(nf);
          e.carryArc[i] = nf - count;
          for (let j = 0; j < count; j++) {
            const tj = a + ((j + rnd()) / count) * (b - a);
            const f = span > 1e-6 ? (tj - e.lastT) / span : 1;
            this.emitStream(e, i, tj, f, S, V, gush);
          }
        }
      }
    }
    e.last.copy(S);
    e.lastT = t1;
    if (t1 >= end) e.active = false;
  }

  /** Initial stream velocity out of the mouth (into s[4..6]). */
  private launch(e: Emitter, V: THREE.Vector3, mul: number) {
    const T = fxTune;
    const s = this.s;
    const D = e.door;
    // forward = the bus's heading (door is its right side): forward = (door.z, -door.x)
    const fx = D.z, fz = -D.x;
    s[4] = V.x * T.inherit + D.x * T.doorOut * mul + fx * T.forwardOut * mul;
    s[5] = V.y * T.inherit * 0.5 + T.doorUp * mul - T.blast;
    s[6] = V.z * T.inherit + D.z * T.doorOut * mul + fz * T.forwardOut * mul;
  }

  private emitRibbon(e: Emitter, tj: number, f: number, S: THREE.Vector3, V: THREE.Vector3, x: number) {
    const T = fxTune;
    const s = this.s;
    const gush = x < 0.12 ? 1 - x / 0.12 : 0;
    const tail = x > 0.7 ? (x - 0.7) / 0.3 : 0;
    const P1 = e.targets[0];
    // mouth position at tj (sub-frame interpolated)
    const mx = e.last.x + (S.x - e.last.x) * f;
    const my = e.last.y + (S.y - e.last.y) * f;
    const mz = e.last.z + (S.z - e.last.z) * f;

    // dribble: near the end some drops just fall from the mouth onto the roof
    if (tail > 0 && rnd() < 0.45 * tail) {
      const vx = V.x * 0.55 + (rnd() - 0.5) * 1.2;
      const vy = Math.min(V.y, 0) * 0.5 - 1.5 - rnd() * 2;
      const vz = V.z * 0.55 + (rnd() - 0.5) * 1.2;
      const ramp = HUE_RAMPS[wrapHue(e.hue0 + Math.round((rnd() - 0.5) * 2.4))];
      this.writeDrop(mx, my, mz, tj, vx, vy, vz, P1.y, 0, 1, ramp, T.splashSize * (0.7 + 0.6 * rnd()), F_SHADED);
      return;
    }

    // band: -3..3 with widths .5, 1, 1, cw, 1, 1, .5 (rainbow order, primary in the middle)
    const cw = T.centerWeight;
    const W = 5 + cw;
    const q = rnd() * W;
    let i = 1;
    while (i < 7 && q >= bandEdge(i, cw)) i++;
    const lo = bandEdge(i - 1, cw);
    const hi = bandEdge(i, cw);
    const k = i - 4;
    const u = (q / W) * 2 - 1;
    const hue = wrapHue(e.hue0 + e.bandSign * k);
    const spray = rnd() < T.sprayFrac;
    const jit = 0.1;

    s[0] = mx + (rnd() - 0.5) * jit;
    s[1] = my + (rnd() - 0.5) * jit;
    s[2] = mz + (rnd() - 0.5) * jit;
    s[3] = tj;
    this.launch(e, V, 1 + 0.15 * gush);
    let tt = e.travel;
    let px = P1.x;
    let pz = P1.z;
    let size = T.blobSize * (0.85 + 0.35 * rnd()) * (1 + 0.45 * gush - 0.3 * tail);
    let flags = 0;
    if (spray) {
      const ang = rnd() * Math.PI * 2;
      const rr = T.sprayScatter * (0.4 + 0.6 * rnd());
      px += Math.cos(ang) * rr;
      pz += Math.sin(ang) * rr;
      tt *= 1 + 0.12 * rnd(); // never before the impact
      size *= 0.5 + 0.15 * rnd();
      flags |= F_SHADED;
    }
    const roll = rnd();
    if (roll < T.glintFrac) {
      flags |= F_GLINT;
      size *= 0.5;
    } else if (roll < T.glintFrac + T.brightFrac) flags |= F_BRIGHT;
    s[8] = px;
    s[9] = P1.y;
    s[10] = pz;
    s[11] = tt;
    s[12] = V.x * T.inherit * 0.25;
    s[13] = -T.arrive;
    s[14] = V.z * T.inherit * 0.25;
    s[15] = K_RIBBON;
    s[16] = HUE_RAMPS[hue];
    s[17] = size;
    s[18] = rnd();
    s[19] = flags;
    // across, depth bulge (the center bands sit in front), band-local coord, width
    s[20] = u;
    s[21] = Math.sqrt(Math.max(0, 1 - u * u)) * 0.8 + (rnd() - 0.5) * 0.1;
    s[22] = ((q - lo) / Math.max(hi - lo, 1e-3)) * 2 - 1;
    s[23] = 1 + 0.22 * gush - 0.4 * tail;
    const life = tt + (rnd() < T.landBounce ? HOP_LIFE : 0);
    this.commit(tj, life);
  }

  /** A shaded droplet flicked off the ribbon's flank: flies free, lands on the roof or falls past it. */
  private emitFlick(e: Emitter, tj: number, f: number, S: THREE.Vector3, V: THREE.Vector3) {
    const T = fxTune;
    const R = e.right;
    const P1 = e.targets[0];
    const side = rnd() < 0.5 ? -1 : 1;
    const mx = e.last.x + (S.x - e.last.x) * f + R.x * side * T.halfWidth0 * 0.8;
    const my = e.last.y + (S.y - e.last.y) * f;
    const mz = e.last.z + (S.z - e.last.z) * f + R.z * side * T.halfWidth0 * 0.8;
    // aim roughly along the stream, then fling sideways
    const tt = e.travel * (1 + 0.25 * rnd());
    const out = T.flickOut * (0.35 + 0.65 * rnd());
    const fx = rnd() - 0.5;
    const vx = (P1.x - mx) / tt + R.x * side * out + fx * 2.5;
    const vz = (P1.z - mz) / tt + R.z * side * out - fx * 2.5;
    const g = T.gravity;
    // vertical speed so it would reach the roof plane in ~tt
    const vy = (P1.y - my) / tt + 0.5 * g * tt + (rnd() - 0.3) * 3;
    const th = hitTime(vy, my - P1.y, g);
    const lx = mx + vx * th - P1.x;
    const lz = mz + vz * th - P1.z;
    const ebounce = Math.hypot(lx, lz) > T.roofRadius ? -1 : rnd() < T.splashBounce ? T.restitution : 0;
    const k = side * e.bandSign * (rnd() < 0.6 ? 2 : rnd() < 0.5 ? 1 : 3);
    const ramp = HUE_RAMPS[wrapHue(e.hue0 + k)];
    const r2 = rnd();
    const flags = F_SHADED | (r2 < 0.08 ? F_GLINT : r2 < 0.3 ? F_BRIGHT : 0);
    this.writeDrop(mx, my, mz, tj, vx, vy, vz, P1.y, ebounce, 1, ramp, T.splashSize * (0.55 + 0.7 * rnd()), flags);
  }

  /** A glossy single-hue stream that peels off its band of the ribbon onto neighbor i. */
  private emitStream(e: Emitter, i: number, tj: number, f: number, S: THREE.Vector3, V: THREE.Vector3, gush: number) {
    const T = fxTune;
    const s = this.s;
    const tgt = e.targets[i];
    const mx = e.last.x + (S.x - e.last.x) * f;
    const my = e.last.y + (S.y - e.last.y) * f;
    const mz = e.last.z + (S.z - e.last.z) * f;
    const j = 0.08;
    s[0] = mx + (rnd() - 0.5) * j;
    s[1] = my + (rnd() - 0.5) * j;
    s[2] = mz + (rnd() - 0.5) * j;
    s[3] = tj;
    const tt = e.travel + i * T.streamStep;
    const hx = tgt.x - mx;
    const hz = tgt.z - mz;
    const dH = Math.max(0.5, Math.hypot(hx, hz));
    const ux = hx / dH;
    const uz = hz / dH;
    const chord = dH / tt;
    // launch: part ribbon (so it leaves the mouth inside the ribbon), part its own arc
    this.launch(e, V, 1);
    const pk = T.arcPeel;
    s[4] = s[4] * pk + ux * chord * 0.9 * (1 - pk);
    s[6] = s[6] * pk + uz * chord * 0.9 * (1 - pk);
    // vertical launch solved so the Hermite path peaks ~apex above the mouth
    // (y(1/3) = 0.148 D0 - 0.259 drop - 0.074 D1, tangents D = v * tt)
    const apex = T.arcApex * Math.min(1.3, 0.35 + 0.65 * (dH / 18));
    const vArr = -T.arrive * 0.8;
    const drop = my - tgt.y;
    s[5] = (apex + 0.259 * drop + 0.074 * vArr * tt) / (0.148 * tt);
    const ang = rnd() * Math.PI * 2;
    const rr = 1.4 * Math.sqrt(rnd());
    s[8] = tgt.x + Math.cos(ang) * rr;
    s[9] = tgt.y;
    s[10] = tgt.z + Math.sin(ang) * rr;
    s[11] = tt;
    s[12] = ux * chord * 0.35;
    s[13] = vArr;
    s[14] = uz * chord * 0.35;
    s[15] = K_STREAM;
    s[16] = HUE_RAMPS[e.hues[i]];
    const roll = rnd();
    const glint = roll < T.glintFrac;
    // the head of each stream is a fat blorp, the body a glossy strand
    s[17] = T.arcSize * (0.8 + 0.4 * rnd()) * (glint ? 0.55 : 1) * (1 + 0.8 * gush);
    s[18] = rnd();
    s[19] = glint ? F_GLINT : roll < T.glintFrac + T.brightFrac ? F_BRIGHT : 0;
    const ul = rnd() * 2 - 1;
    s[20] = e.bandU[i];
    s[21] = ul;
    s[22] = ul;
    s[23] = 1;
    this.commit(tj, tt + (rnd() < T.landBounce ? HOP_LIFE : 0));
  }

  // ------------------------------------------------------------------ drops

  /** Writes one ballistic drop. e > 0 bounce, 0 stick, < 0 fall past the floor. */
  private writeDrop(
    x: number, y: number, z: number, t0: number,
    vx: number, vy: number, vz: number,
    floorY: number, e: number, gMul: number, ramp: number, size: number, flags: number,
  ) {
    const s = this.s;
    const g = fxTune.gravity * gMul;
    const th = hitTime(vy, y - floorY, g);
    let life: number;
    if (e < 0) life = th + 0.45;
    else if (e === 0) life = th + LINGER;
    else {
      const vyb = Math.sqrt(vy * vy + 2 * g * Math.max(y - floorY, 0)) * e;
      life = th + (2 * vyb) / g + LINGER;
    }
    s[0] = x;
    s[1] = y;
    s[2] = z;
    s[3] = t0;
    s[4] = vx;
    s[5] = vy;
    s[6] = vz;
    s[7] = life;
    s[8] = floorY;
    s[9] = e;
    s[10] = gMul;
    s[11] = 0;
    s[12] = 0;
    s[13] = 0;
    s[14] = 0;
    s[15] = K_DROP;
    s[16] = ramp;
    s[17] = size;
    s[18] = rnd();
    s[19] = flags;
    s[20] = 0;
    s[21] = 0;
    s[22] = 0;
    s[23] = 0;
    this.commit(t0, life);
  }

  /** A wet crown splash. `delay` (s) schedules it ahead (a flung blob's landing); `count` overrides the drop count. */
  splash(pos: THREE.Vector3, hue: number, strength: number, delay = 0, count = -1): void {
    const T = fxTune;
    const k = Math.max(0, Math.min(2.5, strength));
    const n = count >= 0 ? count : Math.round(T.splashCount * k);
    const t0 = this.time + Math.max(0, delay);
    const h0 = wrapHue(hue);
    const g = T.gravity;
    const nBig = Math.round(n * 0.08);
    const nCrown = Math.round(n * 0.55);
    const a0 = rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      // a crown of droplets rising in a ring (smeared into streaks by their
      // speed), a few fat blobs skidding out low, and a fast fine mist
      const big = i < nBig;
      const crown = !big && i < nBig + nCrown;
      let ang: number;
      let r0: number;
      let out: number;
      let up: number;
      let size: number;
      if (crown) {
        ang = a0 + ((i - nBig + rnd() * 0.6) / nCrown) * Math.PI * 2;
        r0 = 0.8 + 0.35 * rnd();
        up = T.splashUp * (0.8 + 0.35 * rnd());
        out = T.splashOut * (0.4 + 0.25 * rnd());
        size = T.splashSize * (0.6 + 0.5 * rnd());
      } else if (big) {
        ang = rnd() * Math.PI * 2;
        r0 = 0.4 * rnd();
        up = T.splashUp * (0.12 + 0.15 * rnd());
        out = T.splashOut * (1 + 0.5 * rnd());
        size = T.splashSize * (1.25 + 0.4 * rnd());
      } else {
        ang = rnd() * Math.PI * 2;
        r0 = 0.6 * rnd();
        up = T.splashUp * (0.55 + 0.7 * rnd());
        out = T.splashOut * (1.1 + 0.9 * rnd());
        size = T.splashSize * (0.3 + 0.25 * rnd());
      }
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      up *= 0.75 + 0.25 * k;
      const x0 = pos.x + ca * r0;
      const y0 = pos.y + 0.15;
      const z0 = pos.z + sa * r0;
      const th = hitTime(up, y0 - pos.y, g);
      const reach = r0 + out * th;
      let e: number;
      if (reach > T.roofRadius) e = -1;
      else e = !big && rnd() < T.splashBounce ? T.restitution : 0;
      // mostly the splat's hue, wet (a step deeper than the sunlit roof it
      // lands on, with a bright rim + highlight), a few neighbor hues, white foam
      const roll = rnd();
      const own = roll >= 0.1 && roll < 0.8;
      const ramp = roll < 0.1 ? Ramp.GLOW_WHITE : HUE_RAMPS[own ? h0 : wrapHue(h0 + (roll < 0.86 ? 1 : roll < 0.92 ? -1 : roll < 0.96 ? 2 : -2))];
      let flags = F_SHADED;
      const r2 = rnd();
      if (r2 < 0.07) flags |= F_GLINT;
      else if (own && r2 < 0.75) flags |= F_DEEP;
      else if (r2 < 0.9) flags |= F_BRIGHT;
      this.writeDrop(x0, y0, z0, t0, ca * out, up, sa * out, pos.y, e, 1, ramp, size, flags);
    }
    this.flush();
  }

  /**
   * A big glossy paint blob flung by the blast: flies a ballistic arc from
   * `from` and lands exactly on `to` after `flight` s (a spatter dot waits
   * there), with a couple of trailing droplets and a little splash on landing.
   */
  fling(from: THREE.Vector3, to: THREE.Vector3, flight: number, hue: number, size: number): void {
    const T = fxTune;
    const gm = T.flingGravity;
    const g = T.gravity * gm;
    const ft = Math.max(0.15, flight);
    const vx = (to.x - from.x) / ft;
    const vz = (to.z - from.z) / ft;
    const vy = (to.y - from.y + 0.5 * g * ft * ft) / ft;
    const ramp = HUE_RAMPS[wrapHue(hue)];
    const sz = size * T.flingSize;
    this.writeDrop(from.x, from.y, from.z, this.time, vx, vy, vz, to.y, 0, gm, ramp, sz, F_SHADED | (rnd() < 0.25 ? F_BRIGHT : 0));
    // trail: same arc a beat later (lands on the same spot), smaller
    for (let i = 1; i <= T.flingTrail; i++) {
      const lag = 0.035 * i;
      this.writeDrop(from.x, from.y, from.z, this.time + lag, vx, vy, vz, to.y, 0, gm, ramp, sz * (0.62 - 0.12 * i), F_SHADED | (i === 1 && rnd() < 0.3 ? F_GLINT : 0));
    }
    if (T.flingSplash > 0) this.splash(to, hue, 0.35, ft, Math.round(T.flingSplash));
    this.flush();
  }

  /**
   * The blast's fountain: paint thrown straight up out of the impact that
   * rains back down. Hues follow the angle it flies out at (a rainbow
   * pinwheel from above, a rainbow plume from the side), white-hot glints.
   */
  burst(pos: THREE.Vector3, hue: number, strength: number, floorY = pos.y): void {
    const T = fxTune;
    const n = Math.round(T.burstCount * Math.max(0.2, Math.min(3, strength)));
    const a0 = rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const u = rnd();
      // a tight core goes highest, the skirt flies wide and low
      const up = T.burstUp * (0.35 + 0.65 * (1 - u * u)) * (0.85 + 0.3 * Math.sqrt(strength));
      const out = T.burstOut * (0.15 + 0.85 * u) * Math.sqrt(strength);
      let ang = a - a0;
      ang -= Math.floor(ang / (Math.PI * 2)) * Math.PI * 2;
      const h = wrapHue(hue + Math.floor((ang / (Math.PI * 2)) * 6));
      const r2 = rnd();
      const glint = r2 < 0.07;
      const ramp = glint ? Ramp.GLOW_WHITE : HUE_RAMPS[h];
      const flags = F_SHADED | (glint ? F_GLINT : r2 < 0.3 ? F_BRIGHT : 0);
      const delay = rnd() * 0.06;
      this.writeDrop(pos.x + Math.cos(a) * 0.8, pos.y + 0.4, pos.z + Math.sin(a) * 0.8, this.time + delay, Math.cos(a) * out, up, Math.sin(a) * out, floorY, 0, 1, ramp, T.burstSize * (0.6 + 0.8 * rnd()) * (glint ? 0.6 : 1), flags);
    }
    this.flush();
  }

  // ------------------------------------------------------------------ sparkles

  sparkles(center: THREE.Vector3, radius: number, height: number, hues: number[], count: number): void {
    const T = fxTune;
    const s = this.s;
    const n = Math.max(0, Math.floor(count));
    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const above = rnd() < 0.55;
      let rr: number;
      let y: number;
      if (above) {
        // a crown of stars over the roof (always visible from the chase camera)
        rr = radius * 0.7 * Math.sqrt(rnd());
        y = center.y + 0.5 + rnd() * 3;
      } else {
        // around the facade (outside the walls, so they aren't hidden inside)
        rr = radius * (0.85 + 0.2 * rnd());
        y = center.y + 0.5 - Math.max(0, height) * Math.pow(rnd(), 0.8);
      }
      const delay = rnd() * rnd() * 0.32;
      const t0 = this.time + delay;
      const life = T.sparkLife * (0.6 + 0.8 * rnd());
      const out = 0.6 + 2.2 * rnd();
      s[0] = center.x + ca * rr;
      s[1] = y;
      s[2] = center.z + sa * rr;
      s[3] = t0;
      s[4] = ca * out;
      s[5] = 1.2 + 2.4 * rnd();
      s[6] = sa * out;
      s[7] = life;
      s[8] = 2.6; // drag
      s[9] = T.sparkRise * (0.6 + 0.8 * rnd());
      s[10] = 8 + 7 * rnd(); // twinkle rad/s
      s[11] = 0;
      s[12] = 0.55 + 0.2 * rnd(); // blink-out start
      s[13] = 0;
      s[14] = 0;
      s[15] = K_SPARK;
      s[16] = rnd() < T.sparkWhite || hues.length === 0 ? Ramp.GLOW_WHITE : HUE_RAMPS[wrapHue(hues[Math.floor(rnd() * hues.length)])];
      s[17] = T.sparkSize * (0.7 + 0.6 * rnd());
      s[18] = rnd();
      s[19] = 0;
      s[20] = 0;
      s[21] = 0;
      s[22] = 0;
      s[23] = 0;
      this.commit(t0, life);
    }
    this.flush();
  }

  ambientSparkle(pos: THREE.Vector3, hue: number): void {
    const T = fxTune;
    const s = this.s;
    const life = 1.3 + 0.8 * rnd();
    s[0] = pos.x;
    s[1] = pos.y;
    s[2] = pos.z;
    s[3] = this.time;
    s[4] = (rnd() - 0.5) * 0.3;
    s[5] = 0.2;
    s[6] = (rnd() - 0.5) * 0.3;
    s[7] = life;
    s[8] = 1.5;
    s[9] = 0.35 + 0.3 * rnd();
    s[10] = 0;
    s[11] = 0;
    s[12] = 1;
    s[13] = 0;
    s[14] = 0;
    s[15] = K_TWINKLE;
    s[16] = rnd() < 0.3 ? Ramp.GLOW_WHITE : HUE_RAMPS[wrapHue(hue)];
    s[17] = T.sparkSize * (0.65 + 0.3 * rnd());
    s[18] = rnd();
    s[19] = 0;
    s[20] = 0;
    s[21] = 0;
    s[22] = 0;
    s[23] = 0;
    this.commit(this.time, life);
    this.flush();
  }

  // ------------------------------------------------------------------ puffs

  puff(pos: THREE.Vector3, vel: THREE.Vector3, ramp: number = Ramp.GREY): void {
    const T = fxTune;
    const s = this.s;
    const life = T.puffLife * (0.8 + 0.4 * rnd());
    s[0] = pos.x + (rnd() - 0.5) * 0.3;
    s[1] = pos.y + (rnd() - 0.5) * 0.3;
    s[2] = pos.z + (rnd() - 0.5) * 0.3;
    s[3] = this.time;
    s[4] = vel.x + (rnd() - 0.5) * 0.8;
    s[5] = vel.y + (rnd() - 0.5) * 0.8;
    s[6] = vel.z + (rnd() - 0.5) * 0.8;
    s[7] = life;
    s[8] = 2.4; // drag
    s[9] = 0.9 + 0.5 * rnd(); // buoyancy
    s[10] = T.puffGrow;
    s[11] = 0;
    s[12] = 0;
    s[13] = 0;
    s[14] = 0;
    s[15] = K_PUFF;
    s[16] = ramp;
    s[17] = T.puffSize * (0.8 + 0.4 * rnd());
    s[18] = rnd();
    s[19] = 0;
    s[20] = 0;
    s[21] = 0;
    s[22] = 0;
    s[23] = 0;
    this.commit(this.time, life);
    this.flush();
  }

  // ------------------------------------------------------------------ frame

  /** Advances the particle clock (dt may be 0: hit-stop freezes everything mid-air). */
  update(dt: number): void {
    this.syncUpload();
    const step = dt > 0 ? dt : 0;
    this.time += step;
    if (this.time > REBASE_AT) this.rebase();
    const t = this.time;
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (e.active) this.updateEmitter(e, t, step);
    }
    this.flush();
    this.syncUniforms();
    this.object.visible = t < this.lastDeath;
  }

  private syncUniforms() {
    const T = fxTune;
    this.uNow.value = this.time;
    this.uMaxPx.value = T.maxPx;
    this.uRib.value.set(T.ribbonGlow, T.wobbleAmp, T.wobbleHz, T.hopUp);
    this.uGey.value.set(T.halfWidth0, T.halfWidth1, T.depth, T.blobMouth);
    this.uArc.value.set(T.arcHalfWidth, T.bandShine, 0, 0);
    this.uLand.value.set(T.gravity, T.hopOut, T.fogPaint, T.fogPuff);
    this.uSpk.value.set(T.sparkGlow, T.stretch, T.maxStretch, 0);
    this.uPuff.value.set(T.puffLight, T.puffShadow, 0, 0);
    const hs = this.hueSteps;
    hs[0] = T.stepRed;
    hs[1] = T.stepOrange;
    hs[2] = T.stepYellow;
    hs[3] = T.stepGreen;
    hs[4] = T.stepBlue;
    hs[5] = T.stepViolet;
  }

  // ------------------------------------------------------------------ ring buffer

  /** Copies the scratch slot into the ring. */
  private commit(t0: number, life: number) {
    this.syncUpload();
    const slot = this.head;
    this.s[3] = t0;
    this.s[7] = life;
    this.data.set(this.s, slot * STRIDE);
    const d = t0 + life;
    this.death[slot] = d;
    if (d > this.lastDeath) this.lastDeath = d;
    this.head = (slot + 1) % this.cap;
    if (this.used < this.cap) this.used++;
    if (this.dirtyCount === 0) this.dirtyStart = slot;
    if (this.dirtyCount < this.cap) this.dirtyCount++;
  }

  /** Once three.js has uploaded the queued ranges, start a fresh dirty run. */
  private syncUpload() {
    if (this.uploadQueued && this.buf.updateRanges.length === 0) {
      this.uploadQueued = false;
      this.dirtyCount = 0;
    }
  }

  /** Publishes the dirty run as (at most two) update ranges, reusing the range objects. */
  private flush() {
    this.geo.setDrawRange(0, this.used);
    if (this.dirtyCount === 0) return;
    const ranges = this.buf.updateRanges;
    ranges.length = 0;
    const end = this.dirtyStart + this.dirtyCount;
    if (end <= this.cap) {
      this.rangeA.start = this.dirtyStart * STRIDE;
      this.rangeA.count = this.dirtyCount * STRIDE;
      ranges.push(this.rangeA);
    } else {
      this.rangeA.start = this.dirtyStart * STRIDE;
      this.rangeA.count = (this.cap - this.dirtyStart) * STRIDE;
      this.rangeB.start = 0;
      this.rangeB.count = (end - this.cap) * STRIDE;
      ranges.push(this.rangeA, this.rangeB);
    }
    this.buf.needsUpdate = true;
    this.uploadQueued = true;
    if (this.time < this.lastDeath) this.object.visible = true;
  }

  /** Shifts the clock back so float32 ages stay precise on long sessions. */
  private rebase() {
    const shift = Math.floor(this.time);
    this.time -= shift;
    this.lastDeath -= shift;
    const d = this.data;
    for (let i = 0; i < this.used; i++) {
      d[i * STRIDE + 3] -= shift;
      this.death[i] -= shift;
    }
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      e.start -= shift;
      e.lastT -= shift;
    }
    this.dirtyStart = 0;
    this.dirtyCount = this.used;
  }
}
