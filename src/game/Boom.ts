import { config } from '../config';
import { clamp } from './springs';
import type { Flight } from './Flight';
import type { City } from '../world/City';
import type { Splatter, SuperTag } from './Splat';
import { arrival, blastRadiusFor, layoutHue, type BlastSpec } from './blastLayout';

// Sonic Boom (docs/specs/shots/BUILT.md, "Step 8"; the extras' plan): behind &boom on the link. The flick into Turbo 3 breaks the barrier again: Mach 1's
// set piece cracks the sky round the bus (the cone, the vapor ring, the flash, the kick and the N-wave), and its hoop flies ahead and down to land flat as a
// ring of paint where the bus will be a second on, so it flies through it: the shock lands 0.3 s after the flick, its band, 0.75 to 1 of 0.94 times the
// tap's circle from there, blooms behind the shockwave as it races out, and the bus crosses its middle as a crown of the band's colours goes up. At most
// once in 10 s; inside them the flick is today's. It paints from Jet's floor to 500 m over the ground; higher, the crack alone. Over open water a ring of
// spray, and the 10 s aren't spent, as a Comet's miss keeps its full show. No geyser, hit-stop or belly: the ring is the flick's, not the breath's.
//
// The ring's paint is a blast of its own (Splatter.barf with BarfOpts.inner): the buildings reaching into its band take one level each, dealt the rainbow by
// angle, its ground is the band alone (GroundPaint's LAYOUT_RING), the Moon's craters in its hole are left out (CraterPaint), and life.blast hears
// SuperTag { kind: 'boom', inner } (HOOKS.md: the movers in the hole are life's to leave, and Recess takes no square from it).
//
// Frame order (main.ts): flick() from Controls.onRung on the 'turbo' event of the last level; update() once a frame on the game clock, after the Splatter.

export const boomTune = {
  /** seconds between two rings, at least */
  cooldown: 10,
  /** where the ring lands: where the bus will be this long after the flick (s) from Jet's floor (150 m over the ground), and `leadK` s more a metre over
   *  that, up to leadMax (s): higher, the frame sees farther ahead (tools/feel-sim/s_boom.ts's in-frame rows set them) */
  lead: 1,
  leadFrom: 150,
  leadK: 1 / 375,
  leadMax: 1.95,
  /** the spool's share counted in that distance: the bus speeds up from Turbo 2's 720 m/s toward Turbo 3's 900 over the second */
  spoolK: 0.3,
  /** the ring: its outer radius x the tap's circle from the height over it (blastRadiusFor), and its inner edge x its radius */
  radiusK: 0.94,
  innerK: 0.75,
  /** the shock's flight to the ground (s) */
  travel: 0.3,
  /** no paint with the bus over this height over the ground under it (m) */
  paintTop: 500,
  /** the crown: puffs round the band as it blooms, how fast they go up (m/s) and out, their size; twinkles with them */
  crown: 40,
  crownUp: 34,
  crownOut: 9,
  crownSize: 2.6,
  sparks: 60,
};

/** Where a ring lands, for the hoop (TurboFx.crack) and its crown. */
export interface BoomPlan {
  /** centre (world m), the ground under it */
  x: number;
  y: number;
  z: number;
  /** outer and inner radius (m) */
  r: number;
  inner: number;
  /** game times: the flick, the shock landing, the band at its middle blooming */
  t0: number;
  land: number;
  bloom: number;
  /** what it was: a ring of paint, a ring of spray on open water, or nothing landing (from too high) */
  kind: 'ring' | 'water' | 'high';
  /** its blast's spec (the hues by angle), once it's planned; null for spray */
  spec: BlastSpec | null;
  /** the crown went up */
  crowned: boolean;
}

export interface BoomHooks {
  /** the crack: Mach 1's set piece, its hoop landing as the ring (null: from too high, the crack alone) */
  crack(plan: BoomPlan | null): void;
  /** the band blooms (or the spray goes up, on water): the crown */
  crown(plan: BoomPlan): void;
}

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
/** &boom on the link */
export const boomOn = !!q && q.has('boom');
/** GLSL only &boom compiles (the hoop's rows and width, fx/Turbo.ts): without it no source differs by a byte, as pogo.ts's pogoed() */
export const boomed = (glsl: string): string => (boomOn ? glsl : '');
export const boomedOr = (glsl: string, off: string): string => (boomOn ? glsl : off);

export class Boom {
  /** &boom (main.ts sets it, as bomb.on): off, flick() does nothing */
  on = false;
  /** game time of the last ring spent (-Infinity: none) */
  last = -Infinity;
  /** the last plan (QA, s_boom) */
  plan: BoomPlan | null = null;
  readonly stats = { flicks: 0, rings: 0, water: 0, high: 0, quiet: 0 };
  private t = 0;
  private serial = 0;
  private readonly live: BoomPlan[] = [];

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
    const over = f.y - (Number.isFinite(f.groundBroad) ? f.groundBroad : f.groundUnder);
    const lead = clamp(B.lead + (over - B.leadFrom) * B.leadK, B.lead, B.leadMax);
    // (where the bus will be: its speed over the ground now, and a share of what the new level spools it up to)
    const d = lead * (f.ground + Math.max(0, want - f.speed) * B.spoolK);
    const x = f.x + f.fx * d, z = f.z + f.fz * d;
    const y = this.city.groundAt(x, z);
    const drop = Math.max(0, f.y - y);
    const r = B.radiusK * blastRadiusFor(drop);
    const t0 = this.t, land = t0 + B.travel;
    const plan: BoomPlan = { x, y, z, r, inner: B.innerK * r, t0, land, bloom: land + arrival(r * (1 + B.innerK) * 0.5, r), kind: 'ring', spec: null, crowned: false };
    this.plan = plan;
    if (over > B.paintTop + 1) {
      plan.kind = 'high';
      this.last = this.t;
      this.stats.high++;
      this.hooks.crack(null);
      return plan;
    }
    const tag: SuperTag = { kind: 'boom', charge: 1, id: ++this.serial, inner: plan.inner };
    this.splatter.barf(x, z, { target: null, exact: true, y: y + 0.5, drop, radius: r, inner: plan.inner, travel: B.travel, stream: true, hitStop: 0, super: tag });
    if (this.splatter.lastMiss) {
      plan.kind = 'water';
      this.stats.water++;
    } else {
      plan.spec = this.splatter.lastSpec;
      this.last = this.t;
      this.stats.rings++;
    }
    this.live.push(plan);
    this.hooks.crack(plan);
    return plan;
  }

  /** Once a frame on the game clock: each ring's crown as its band blooms. */
  update(dt: number) {
    this.t += dt;
    for (let i = 0; i < this.live.length; ) {
      const p = this.live[i];
      if (this.t < (p.kind === 'water' ? p.land : p.bloom)) {
        i++;
        continue;
      }
      p.crowned = true;
      this.hooks.crown(p);
      this.live.splice(i, 1);
    }
  }

  /** The hue of the ring at angle a (rad) round its centre: its blast's pinwheel there, so the crown is the band it rises from (water: the next hue on). */
  hueAt(p: BoomPlan, a: number): number {
    return p.spec ? layoutHue(p.spec, Math.cos(a) * (p.r + p.inner) * 0.5, Math.sin(a) * (p.r + p.inner) * 0.5) : (this.splatter.hueNext + Math.floor((a / (Math.PI * 2)) * 6 + 6)) % 6;
  }

  /** ?moon: the map slid by (dx, dz) (main.ts): a ring on its way lands where it was going, by the new map. */
  slide(dx: number, dz: number) {
    for (const p of this.live) {
      p.x -= dx;
      p.z -= dz;
    }
  }
}

/** A ring's spray, for its crown: whether open water is under its band at angle a (the hue's ground gives way to white foam there). */
export function waterAt(city: City, p: BoomPlan, a: number): boolean {
  const m = (p.r + p.inner) * 0.5;
  return city.groundAt(p.x + Math.cos(a) * m, p.z + Math.sin(a) * m) < config.splat.missWaterY;
}
