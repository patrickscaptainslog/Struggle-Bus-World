import { config } from '../config';
import { clamp } from './springs';
import type { Flight } from './Flight';
import type { City } from '../world/City';
import type { Splatter, SuperTag } from './Splat';
import { arrival, blastRadiusFor, layoutHue, type BlastSpec } from './blastLayout';

// Sonic Boom (docs/specs/shots/BUILT.md, "The extras"; the extras' plan): behind &boom on the link. The flick into Turbo 3 breaks the barrier again: Mach 1's
// set piece cracks the sky round the bus (the cone, the vapor ring, the flash over the frame, the camera's jolt, a pressure ring racing across the sky and
// the N-wave), and its hoop shoots out from the nose, tight there and stretching as it goes, to stand upright across the bus's path at its height a second
// ahead. The bus threads it, and as it crosses the hoop's plane (by where the bus is, at any frame rate) the hoop is punched on ahead and slams down flat onto
// the city as a ring of paint, its band, 0.75 to 1 of 0.94 times the tap's circle from there, blooming as the hoop lands on it, ahead of the bus; the bus
// flies over its band as a crown of the band's colours goes up, and the hoop lies tearing behind it. At most once in 10 s; inside them the
// flick is today's. It paints from Jet's floor to 500 m over the ground; higher, the crack alone. Over open water a ring of spray, and the 10 s aren't spent,
// as a Comet's miss keeps its full show. No geyser, hit-stop or belly: the ring is the flick's, not the breath's.
//
// The ring's paint is a blast of its own (Splatter.barf with BarfOpts.inner), barfed as the bus threads the hoop: the buildings reaching into its band take
// one level each, dealt the rainbow by angle, its ground is the band alone (GroundPaint's LAYOUT_RING), the Moon's craters in its hole are left out
// (CraterPaint), and life.blast hears SuperTag { kind: 'boom', inner } (HOOKS.md: the movers in the hole are life's to leave, and Recess takes no square from it).
//
// Frame order (main.ts): flick() from Controls.onRung on the 'turbo' event of the last level; update() once a frame on the game clock, after the Splatter.

export const boomTune = {
  /** seconds between two rings, at least */
  cooldown: 10,
  /** the hoop: where it stands, where the bus will be this long after the flick (s); how long it takes to get there from the nose (s); its radius there
   *  (m, and more a metre over Jet's floor: higher, the frame is wider) and at the nose */
  hoopAhead: 1,
  hoopFly: 0.3,
  hoopR: 40,
  hoopRK: 0.05,
  hoopR0: 2.5,
  /** standing, it keeps to the bus: its height and its place across the path eased toward the bus's (1/s), across by this share of its radius at most,
   *  and over any roof under it by the bus's own clearance, so a tower in its way has the hoop stand over it, where the flight's floor lifts the bus */
  hoopTrack: 4,
  hoopDrift: 0.8,
  /** a bus that turns away never crosses the hoop's plane: it slams down this long after the flick anyway (s) */
  hoopWait: 2.4,
  /** where the ring lands: where the bus will be once the hoop is threaded, the hoop has slammed onto the band and the band blooms, and `gap` s more from
   *  Jet's floor (150 m over the ground), `gapK` s more a metre higher (the frame sees farther ahead), up to leadMax (s) all told, so the band blooms ahead of
   *  the bus as high on the screen from every height (s_boom: its middle 0.7 of the height down at most) */
  gap: 0.62,
  gapFrom: 150,
  gapK: 1 / 320,
  leadMax: 3.9,
  /** the spool's share counted in that distance: the bus speeds up from Turbo 2's 720 m/s toward Turbo 3's 900 over the second */
  spoolK: 0.3,
  /** the ring: its outer radius x the tap's circle from the height over it (blastRadiusFor), and its inner edge x its radius */
  radiusK: 0.94,
  innerK: 0.75,
  /** the shock's flight to the ground (s), and how long before the bus reaches the hoop's plane its barf goes (s, by the bus's distance from it and its
   *  speed): the shock lands just after the bus threads the hoop, which lands flat on the band as its inner edge blooms, arrival(inner) after that. The ring's
   *  ground is drawn over the shock's flight, so a short one would crowd its slices into a frame or two (s_boom: 8.4-10.9 ms at 0.05 s from 490 m) */
  travel: 0.3,
  preBarf: 0.25,
  /** no paint with the bus over this height over the ground under it (m) */
  paintTop: 500,
  /** the crown: puffs round the band as it blooms, how fast they go up (m/s) and out, their size; twinkles with them */
  crown: 40,
  crownUp: 34,
  crownOut: 9,
  crownSize: 2.6,
  sparks: 60,
};

/** Where a ring lands, for the hoop (TurboFx.crack, hoopPose) and its crown. */
export interface BoomPlan {
  /** centre (world m), the ground under it */
  x: number;
  y: number;
  z: number;
  /** where the hoop lies down: over the band's rooftops (their median, or 14 m over the ground where they're low), so towers don't bury it */
  top: number;
  /** outer and inner radius (m) */
  r: number;
  inner: number;
  /** the drop from the bus to the ground there at the flick (m), as the barf takes it */
  drop: number;
  /** the hoop standing: its centre (world m), its facing (unit, along the path at the flick), its radius and its hole's (m), the floor it keeps over the
   *  roofs under it, and how far across it has moved toward the bus (m) */
  hx: number;
  hy: number;
  hz: number;
  nx: number;
  nz: number;
  hR: number;
  hole: number;
  floor: number;
  drift: number;
  /** game times: the flick; the bus through the hoop's plane (NaN: not yet); the shock landing; the hoop flat on the band (its inner edge blooming); the band
   *  at its middle blooming (Infinity until it's threaded) */
  t0: number;
  thread: number;
  land: number;
  slam: number;
  bloom: number;
  /** the bus went through the hoop's hole (not past its side, or after the wait) */
  threaded: boolean;
  /** the last ring's time before this one, given back if this one comes down on open water */
  spent: number;
  /** what it was: a ring of paint, a ring of spray on open water, or nothing landing (from too high); a ring until it's threaded */
  kind: 'ring' | 'water' | 'high';
  /** its blast's spec (the hues by angle), once it's barfed; null for spray */
  spec: BlastSpec | null;
  /** the crown went up */
  crowned: boolean;
}

export interface BoomHooks {
  /** the crack: Mach 1's set piece, its hoop standing ahead and landing as the ring (null: from too high, the crack alone) */
  crack(plan: BoomPlan | null): void;
  /** the band blooms (or the spray goes up, on water): the crown */
  crown(plan: BoomPlan): void;
}

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
/** &boom on the link */
export const boomOn = !!q && q.has('boom');
/** GLSL only &boom compiles (the hoop's rows and width, fx/Turbo.ts; the sky's pressure ring, PixelPipeline): without it no source differs by a byte, as pogo.ts's pogoed() */
export const boomed = (glsl: string): string => (boomOn ? glsl : '');
export const boomedOr = (glsl: string, off: string): string => (boomOn ? glsl : off);

/** How far ahead the ring lands, in seconds of the bus's flight after the flick, `over` m over the ground and `r` m its radius. */
export function boomLead(over: number, r: number): number {
  const B = boomTune;
  return Math.min(B.leadMax, B.hoopAhead + B.travel - B.preBarf + arrival(r * (1 + B.innerK) * 0.5, r) + B.gap + Math.max(0, over - B.gapFrom) * B.gapK);
}

/** The hoop's pose: its centre (world m), radius (m), how far it has lain down (0 upright across the path, 1 flat on the band), its band's width (a share of
 *  its radius) and its tear (0 whole, 1 gone). */
export interface HoopPose {
  x: number;
  y: number;
  z: number;
  r: number;
  flat: number;
  w: number;
  tear: number;
}

/** how long the hoop lies on the band, tearing (s), and how far it spreads (x its radius) */
export const HOOP_LIE = 1.1;
export const HOOP_SPREAD = 0.05;

/**
 * The hoop at game time `t` (TurboFx draws it, s_boom checks it): out from the nose (`nose`, world m, where it is now) over hoopFly s, tight there and
 * stretching; standing where the plan has it; punched on ahead from the bus's crossing and slamming down flat onto the band by `slam`; lying there, spreading
 * and tearing, HOOP_LIE s. False once it's gone.
 */
export function hoopPose(p: BoomPlan, t: number, nose: { x: number; y: number; z: number }, out: HoopPose): boolean {
  const B = boomTune, age = t - p.t0, band = 1 - p.inner / p.r;
  const ty = Math.max(p.top, p.y + 14);
  if (age < B.hoopFly) {
    // (accelerating away from the nose: the first frames show it there, a tight ring round it)
    const u = Math.max(0, age) / B.hoopFly, e = u * u;
    out.x = nose.x + (p.hx - nose.x) * e;
    out.y = nose.y + (p.hy - nose.y) * e;
    out.z = nose.z + (p.hz - nose.z) * e;
    out.r = B.hoopR0 + (p.hR - B.hoopR0) * Math.pow(u, 0.6);
    out.flat = 0;
    out.w = 0.62 - 0.12 * u;
    out.tear = 0;
    return true;
  }
  if (!(t >= p.thread)) {
    out.x = p.hx;
    out.y = p.hy;
    out.z = p.hz;
    out.r = p.hR;
    out.flat = 0;
    out.w = 0.5;
    out.tear = 0;
    return true;
  }
  if (t < p.slam) {
    // (punched on ahead, then dropping ever faster: a slam, not a glide; it opens to the ring's size, lies down, and its band narrows to the ring's)
    const u = (t - p.thread) / Math.max(1e-3, p.slam - p.thread), h = 1 - (1 - u) * (1 - u);
    out.x = p.hx + (p.x - p.hx) * h;
    out.y = p.hy + (ty - p.hy) * u * u;
    out.z = p.hz + (p.z - p.hz) * h;
    out.r = p.hR + (p.r - p.hR) * h;
    out.flat = Math.min(1, u * 1.25);
    out.w = 0.5 + (band - 0.5) * u;
    out.tear = 0.04 * u;
    return true;
  }
  const w = (t - p.slam) / HOOP_LIE;
  if (w >= 1) return false;
  // (lying on the band, it tears, the crest last)
  out.x = p.x;
  out.y = ty;
  out.z = p.z;
  out.r = p.r * (1 + HOOP_SPREAD * w);
  out.flat = 1;
  out.w = band + 0.12 * w;
  out.tear = 0.04 + 0.96 * w;
  return true;
}

export class Boom {
  /** &boom (main.ts sets it, as bomb.on): off, flick() does nothing */
  on = false;
  /** game time of the last ring spent (-Infinity: none) */
  last = -Infinity;
  /** the last plan (QA, s_boom) */
  plan: BoomPlan | null = null;
  readonly stats = { flicks: 0, rings: 0, water: 0, high: 0, quiet: 0, cracks: 0, threaded: 0 };
  private t = 0;
  private serial = 0;
  private readonly live: BoomPlan[] = [];
  /** the bus the last flick was flown by: update() watches it cross the hoop's plane */
  private f: Flight | null = null;

  constructor(private readonly city: City, private readonly splatter: Splatter, private readonly hooks: BoomHooks) {}

  /** the game clock (s), as update() has it */
  get time(): number {
    return this.t;
  }

  /** The flick into Turbo 3, this frame, `want` m/s the speed the new level drives at. Returns what it did (null: nothing new, the flick is today's). */
  flick(f: Flight, want = f.turbo.speed): BoomPlan | null {
    if (!this.on) return null;
    this.stats.flicks++;
    if (this.t - this.last < boomTune.cooldown) {
      this.stats.quiet++;
      return null;
    }
    const B = boomTune;
    this.f = f;
    const over = f.y - (Number.isFinite(f.groundBroad) ? f.groundBroad : f.groundUnder);
    // (where the bus will be: its speed over the ground now, and a share of what the new level spools it up to)
    const v = f.ground + Math.max(0, want - f.speed) * B.spoolK;
    const r0 = B.radiusK * blastRadiusFor(Math.max(0, over));
    const d = boomLead(over, r0) * v;
    const x = f.x + f.fx * d, z = f.z + f.fz * d;
    const y = this.city.groundAt(x, z);
    const drop = Math.max(0, f.y - y);
    const r = B.radiusK * blastRadiusFor(drop);
    const hd = B.hoopAhead * v, hR = B.hoopR + Math.max(0, over - B.gapFrom) * B.hoopRK;
    const hx = f.x + f.fx * hd, hz = f.z + f.fz * hd;
    // (the roofs across the hoop and a little either side of its plane: a tower taller than the bus there has it stand over the tower, where the bus is lifted)
    let roof = -Infinity;
    for (let i = -2; i <= 2; i++)
      for (let j = -1; j <= 1; j++) {
        const s = (i / 2) * hR, a = j * 25;
        roof = Math.max(roof, this.city.roofAt(hx - f.fz * s + f.fx * a, hz + f.fx * s + f.fz * a) ?? -Infinity);
      }
    const floor = roof + config.flight.clearance + 2;
    const t0 = this.t;
    const plan: BoomPlan = {
      x, y, z, top: y + 14, r, inner: B.innerK * r, drop,
      hx, hy: Math.max(f.y, floor), hz, nx: f.fx, nz: f.fz, hR, hole: hR * 0.5, floor, drift: 0,
      t0, thread: NaN, land: Infinity, slam: Infinity, bloom: Infinity, threaded: false, spent: -Infinity, kind: 'ring', spec: null, crowned: false,
    };
    this.plan = plan;
    this.stats.cracks++;
    if (over > B.paintTop + 1) {
      plan.kind = 'high';
      this.last = this.t;
      this.stats.high++;
      this.hooks.crack(null);
      return plan;
    }
    // (the band's rooftops, at twelve points round it)
    const roofs: number[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, m = (plan.r + plan.inner) * 0.5;
      roofs.push(this.city.roofAt(x + Math.cos(a) * m, z + Math.sin(a) * m) ?? y);
    }
    roofs.sort((p, q) => p - q);
    plan.top = Math.max(y + 14, (roofs[5] + roofs[6]) * 0.5 + 4);
    // (spent now, so a flick while the hoop stands is today's; given back if it comes down on open water)
    plan.spent = this.last;
    this.last = this.t;
    this.live.push(plan);
    this.hooks.crack(plan);
    return plan;
  }

  /** Once a frame on the game clock: each hoop kept to the bus until the bus crosses its plane, then its ring barfed; each ring's crown as its band blooms. */
  update(dt: number) {
    this.t += dt;
    const B = boomTune, f = this.f;
    for (let i = 0; i < this.live.length; ) {
      const p = this.live[i];
      if (Number.isNaN(p.thread)) {
        // (along the path: under 0 the bus hasn't reached the hoop's plane; across it, and up)
        const along = f ? (f.x - p.hx) * p.nx + (f.z - p.hz) * p.nz : 0;
        const across = f ? (f.z - p.hz) * p.nx - (f.x - p.hx) * p.nz : 0;
        if (f && along < 0 && dt > 0) {
          const k = 1 - Math.exp(-B.hoopTrack * dt), lim = B.hoopDrift * p.hR;
          const s = clamp(p.drift + across * k, -lim, lim) - p.drift;
          p.drift += s;
          p.hx -= p.nz * s;
          p.hz += p.nx * s;
          p.hy += (Math.max(f.y, p.floor) - p.hy) * k;
        }
        const age = this.t - p.t0;
        if (!(p.land < Infinity) && ((f && along >= -B.preBarf * Math.max(1, f.ground)) || age >= B.hoopWait - B.preBarf)) this.barf(p);
        if (p.land < Infinity && ((f && along >= 0) || age >= B.hoopWait)) this.thread(p, along >= 0 && Math.abs(across) < p.hole && !!f && Math.abs(f.y - p.hy) < p.hole);
        i++;
        continue;
      }
      if (this.t < (p.kind === 'water' ? p.land : p.bloom)) {
        i++;
        continue;
      }
      p.crowned = true;
      this.hooks.crown(p);
      this.live.splice(i, 1);
    }
  }

  /** The bus through the hoop's plane (`threaded`: through its hole), this frame: the hoop is punched on and slams down flat onto the band as its inner edge
   *  blooms (a bus that came late, slowed or turned: a quarter second at least). */
  private thread(p: BoomPlan, threaded: boolean) {
    p.thread = this.t;
    p.threaded = threaded;
    if (threaded) this.stats.threaded++;
    p.slam = Math.max(this.t + 0.25, p.land + arrival(p.inner, p.r));
  }

  /** The bus preBarf s from the hoop's plane, this frame: the ring's barf, its shock landing `travel` s on, just after the bus threads the hoop. */
  private barf(p: BoomPlan) {
    const B = boomTune;
    p.land = this.t + B.travel;
    p.bloom = p.land + arrival(p.r * (1 + B.innerK) * 0.5, p.r);
    const tag: SuperTag = { kind: 'boom', charge: 1, id: ++this.serial, inner: p.inner };
    this.splatter.barf(p.x, p.z, { target: null, exact: true, y: p.y + 0.5, drop: p.drop, radius: p.r, inner: p.inner, travel: B.travel, stream: true, hitStop: 0, super: tag });
    if (this.splatter.lastMiss) {
      p.kind = 'water';
      this.last = p.spent;
      this.stats.water++;
    } else {
      p.spec = this.splatter.lastSpec;
      this.stats.rings++;
    }
  }

  /** The hue of the ring at angle a (rad) round its centre: its blast's pinwheel there, so the crown is the band it rises from (water: the next hue on). */
  hueAt(p: BoomPlan, a: number): number {
    return p.spec ? layoutHue(p.spec, Math.cos(a) * (p.r + p.inner) * 0.5, Math.sin(a) * (p.r + p.inner) * 0.5) : (this.splatter.hueNext + Math.floor((a / (Math.PI * 2)) * 6 + 6)) % 6;
  }

  /** ?moon: the map slid by (dx, dz) (main.ts): a ring on its way lands where it was going, by the new map, and its hoop stands there. */
  slide(dx: number, dz: number) {
    for (const p of this.live) {
      p.x -= dx;
      p.z -= dz;
      p.hx -= dx;
      p.hz -= dz;
    }
  }
}

/** A ring's spray, for its crown: whether open water is under its band at angle a (the hue's ground gives way to white foam there). */
export function waterAt(city: City, p: BoomPlan, a: number): boolean {
  const m = (p.r + p.inner) * 0.5;
  return city.groundAt(p.x + Math.cos(a) * m, p.z + Math.sin(a) * m) < config.splat.missWaterY;
}
