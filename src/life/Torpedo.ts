import * as THREE from 'three';

// The Torpedo (docs/specs/shots/SHOTS.md, "The shots"; HOOKS.md, "The Torpedo"): a shot that comes down on open water isn't a miss any more. It runs along the
// surface at the nearest ferry or sailboat within 300 m that it has clear water to, spray at its head and a wake behind it, and paints the boat as a locked shot
// does (life.torpedoHit: the hull, and its wake in the one colour for 30 s). With no boat in reach it skips twice, on the way it was thrown, and splashes.
//   life.torpedoOn(host)     once, in main.ts's life block: the splashes and the skipping blob (the particles'), what water is (the Splatter's own test)
//   life.torpedo(pos, hue)   the shot code's hook, from the Splatter's miss (main.ts's `miss:`): a breath came down on water at `pos`

export const torpedoTune = {
  /** the boat it runs at: the nearest within this many m of where the shot came down */
  reach: 300,
  /** its run: m/s along the surface, and the most it runs (s) */
  speed: 130,
  maxTime: 5,
  /** it's there within half the boat's length of its middle, and never under this (m) */
  hitMin: 8,
  /** land under it ends it, but within this of the boat (a ferry at its pier); the pick looks for land this often along the way (m) */
  ashore: 60,
  lookStep: 20,
  /** at most this many at once, and no two within this many s (the Hose's pour on the water is a miss a blob) */
  max: 4,
  gap: 0.35,
  /** the spray at its head: a small crown this often (s), this strong, this many droplets */
  sprayEvery: 0.07,
  spray: 0.3,
  sprayCount: 9,
  /** its wake (the marks' ribbon): m wide at the head, spreading to this many times it at the far end, never under this many px, gone this long after (s) */
  wakeW: 4,
  wakeSpread: 3,
  wakePx: 2,
  wakeFade: 1.6,
  /** the hit's crown at the boat, and a run that ends on nothing */
  hitSplash: 1.3,
  fizz: 0.5,
  /** the skips: each hop's reach (m) and flight (s), the blob's size, the crown where each lands and the last one's */
  hop: [70, 45],
  hopT: [0.5, 0.38],
  blob: 1.1,
  skipSplash: 0.45,
  endSplash: 0.9,
  /** a hop cut short by the shore isn't flown under this (m) */
  hopMin: 8,
};

/** What the Torpedo needs of the game (main.ts's life block). */
export interface TorpedoHost {
  /** the splatter's faction, and dealing its hue on (a fresh boat takes a hue) */
  faction(): number;
  dealHue(): void;
  /** the bus (world m into `out`): the way the shot was thrown is from it to where it came down */
  bus(out: THREE.Vector3): THREE.Vector3;
  /** open water at (x, z), by the Splatter's own test (config.splat.missWaterY) */
  water(x: number, z: number): boolean;
  /** the particles' wet crown at `pos`, and their blob thrown from `from` to land on `to` `flight` s on */
  splash(pos: THREE.Vector3, hue: number, strength: number, delay?: number, count?: number): void;
  fling(from: THREE.Vector3, to: THREE.Vector3, flight: number, hue: number, size: number): void;
}

/** What the Torpedo asks of life (Life.ts). */
export interface TorpedoLife {
  /** The ferry or sailboat nearest (x, z) within `reach` m that `clear` lets through: its key, where it is and its length (m) into `out`; false: none. */
  boatNear(x: number, z: number, reach: number, clear: (bx: number, bz: number) => boolean, out: TorpedoPick): boolean;
  /** Where the mover keyed `key` is now (world m into `out`); false: gone from life's snapshot. */
  moverAt(key: string, out: THREE.Vector3): boolean;
  /** The torpedo reached `key`: its paint, now, and its wake's show. True if it was fresh. */
  torpedoHit(key: string, hue: number, faction: number): boolean;
}

export interface TorpedoPick {
  key: string;
  size: number;
  readonly at: THREE.Vector3;
}

/** One torpedo: a run at a boat, or two skips. */
export interface TorpedoRun {
  live: boolean;
  /** the boat it runs at ('': none, it skips), and half its length (m) */
  key: string;
  half: number;
  hue: number;
  faction: number;
  /** where it went in and its head now (world m), on the water at `y` */
  x0: number;
  z0: number;
  x: number;
  z: number;
  y: number;
  /** its age (s), the s to its next spray, and how long since it ended (-1: under way): its wake fades over torpedoTune.wakeFade */
  t: number;
  spray: number;
  done: number;
  /** the skips: the way it was thrown (unit), the hop it's on, the s to its landing and where that is */
  ux: number;
  uz: number;
  hop: number;
  hopT: number;
  hx: number;
  hz: number;
}

export class LifeTorpedo {
  /** Life.draw reads these for the wakes */
  readonly runs: TorpedoRun[] = [];
  /** QA: runs at a boat, hits, fresh boats, skips flown, runs that ended on land or on nothing, misses refused (too many, too soon) */
  readonly qa = { runs: 0, hits: 0, fresh: 0, skips: 0, hops: 0, aground: 0, lost: 0, refused: 0, live: 0 };
  private since = Infinity;
  private px = 0;
  private pz = 0;
  private readonly pick: TorpedoPick = { key: '', size: 0, at: new THREE.Vector3() };
  private readonly v = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly life: TorpedoLife;
  private readonly host: TorpedoHost;
  /** the pick's test: clear water from where the shot came down to the boat, but for the last `ashore` m */
  private readonly waterTo = (bx: number, bz: number): boolean => {
    const T = torpedoTune, dx = bx - this.px, dz = bz - this.pz, d = Math.sqrt(dx * dx + dz * dz);
    for (let s = T.lookStep; s < d - T.ashore; s += T.lookStep) if (!this.host.water(this.px + (dx / d) * s, this.pz + (dz / d) * s)) return false;
    return true;
  };

  constructor(life: TorpedoLife, host: TorpedoHost) {
    this.life = life;
    this.host = host;
    for (let i = 0; i < torpedoTune.max; i++) this.runs.push({ live: false, key: '', half: 0, hue: 0, faction: 0, x0: 0, z0: 0, x: 0, z: 0, y: 0, t: 0, spray: 0, done: -1, ux: 0, uz: -1, hop: 0, hopT: 0, hx: 0, hz: 0 });
  }

  /** A breath came down on open water at `pos` (the shot code's own splash is thrown already): a run at the nearest boat, or two skips. False: none (too many, too soon). */
  launch(pos: THREE.Vector3, hue: number): boolean {
    const T = torpedoTune, H = this.host;
    let r: TorpedoRun | null = null;
    for (const x of this.runs) if (!x.live) r = r ?? x;
    if (!r || this.since < T.gap) {
      this.qa.refused++;
      return false;
    }
    this.since = 0;
    r.live = true;
    r.hue = hue;
    r.faction = H.faction();
    r.x0 = r.x = this.px = pos.x;
    r.z0 = r.z = this.pz = pos.z;
    r.y = pos.y;
    r.t = r.spray = 0;
    r.done = -1;
    if (this.life.boatNear(pos.x, pos.z, T.reach, this.waterTo, this.pick)) {
      r.key = this.pick.key;
      r.half = Math.max(T.hitMin, 0.5 * this.pick.size);
      this.qa.runs++;
      return true;
    }
    // (no boat: it skips on the way it was thrown, from the bus to where it came down)
    r.key = '';
    const bus = H.bus(this.v), dx = pos.x - bus.x, dz = pos.z - bus.z, d = Math.sqrt(dx * dx + dz * dz);
    r.ux = d > 1 ? dx / d : 0;
    r.uz = d > 1 ? dz / d : -1;
    r.hop = 0;
    this.qa.skips++;
    if (!this.hopOff(r)) this.end(r, 0);
    return true;
  }

  /** Each frame (Life.frame). */
  tick(dt: number): void {
    const T = torpedoTune, H = this.host, v = this.v;
    this.since += dt;
    let live = 0;
    for (const r of this.runs) {
      if (!r.live) continue;
      live++;
      if (r.done >= 0) {
        // (ended: its wake fades, and the slot is free again)
        r.done += dt;
        if (r.done >= T.wakeFade) r.live = false;
        continue;
      }
      r.t += dt;
      if (!r.key) {
        r.hopT -= dt;
        if (r.hopT > 0) continue;
        r.x = r.hx;
        r.z = r.hz;
        r.hop++;
        const last = r.hop >= T.hop.length || !this.hopOff(r);
        H.splash(v.set(r.x, r.y, r.z), r.hue, last ? T.endSplash : T.skipSplash);
        if (last) this.end(r, 0);
        continue;
      }
      // (straight at where the boat is now: it's ten times a ferry's speed)
      if (!this.life.moverAt(r.key, v) || r.t > T.maxTime) {
        this.qa.lost++;
        this.end(r, T.fizz);
        continue;
      }
      const dx = v.x - r.x, dz = v.z - r.z, d = Math.sqrt(dx * dx + dz * dz), step = T.speed * dt;
      if (d <= r.half + step) {
        this.qa.hits++;
        if (this.life.torpedoHit(r.key, r.hue, r.faction)) {
          this.qa.fresh++;
          H.dealHue();
        }
        r.x = v.x - (d > 1e-6 ? (dx / d) * Math.min(d, r.half) : 0);
        r.z = v.z - (d > 1e-6 ? (dz / d) * Math.min(d, r.half) : 0);
        this.end(r, T.hitSplash);
        continue;
      }
      r.x += (dx / d) * step;
      r.z += (dz / d) * step;
      if (d > T.ashore && !H.water(r.x, r.z)) {
        this.qa.aground++;
        this.end(r, T.fizz);
        continue;
      }
      r.spray -= dt;
      if (r.spray <= 0) {
        r.spray = T.sprayEvery;
        H.splash(v.set(r.x, r.y, r.z), r.hue, T.spray, 0, T.sprayCount);
      }
    }
    this.qa.live = live;
  }

  /** Every torpedo gone (the tuner's reset, a new place). */
  reset(): void {
    for (const r of this.runs) r.live = false;
  }

  /** The next hop thrown from where `r` is: as far as the hop goes or the shore lets it. False: no water ahead to land on. */
  private hopOff(r: TorpedoRun): boolean {
    const T = torpedoTune, H = this.host, reach = T.hop[r.hop], flight = T.hopT[r.hop];
    let k = 8;
    while (k > 0 && !H.water(r.x + r.ux * reach * (k / 8), r.z + r.uz * reach * (k / 8))) k--;
    const d = reach * (k / 8);
    if (d < T.hopMin) return false;
    r.hx = r.x + r.ux * d;
    r.hz = r.z + r.uz * d;
    r.hopT = flight * Math.sqrt(k / 8);
    H.fling(this.a.set(r.x, r.y, r.z), this.b.set(r.hx, r.y, r.hz), r.hopT, r.hue, T.blob);
    this.qa.hops++;
    return true;
  }

  /** It's over where it is: a crown of `strength` (0: none), and its wake left to fade. */
  private end(r: TorpedoRun, strength: number): void {
    if (strength > 0) this.host.splash(this.v.set(r.x, r.y, r.z), r.hue, strength);
    r.done = 0;
    // (a skip leaves no wake: its slot is free at once)
    if (!r.key) r.live = false;
  }
}
