// Recess's AI captains (FACTIONS.md section 4): Learner, Rival and Veteran. A captain's hands are a player's, the steering, the tap and the flick, and it
// sees only what a player's screen shows: the buses, their glints, a breath going white-hot at it, the ground's owners. The sim (recess.ts) holds it to a
// full second of glint before its breath goes at a bus, whatever this says. Seeded, so a match replays.

import type { Area } from '../factions/areas';
import { areaTune, squareCentre, squareKey } from '../factions/areas';
import { Recess, recessTune, type Bus, type Hands, type Level } from './recess';

export interface Skill {
  /** s from a breath going white-hot to its flick, and how often it flicks at all */
  react: number;
  dodge: number;
  /** how hard it steers onto what it wants (0..1 of full stretch an error of a radian) */
  aim: number;
  /** its share of the time spent hunting buses, not painting */
  hunt: number;
  /** s it holds a glint past the second before it breathes */
  hold: number;
  /** how much its steering wanders (rad of error) */
  wobble: number;
}

export const SKILLS: Record<Level, Skill> = {
  learner: { react: 0.28, dodge: 0.2, aim: 0.6, hunt: 0.35, hold: 0.4, wobble: 0.25 },
  rival: { react: 0.18, dodge: 0.5, aim: 0.85, hunt: 0.5, hold: 0.15, wobble: 0.12 },
  veteran: { react: 0.1, dodge: 0.8, aim: 1, hunt: 0.65, hold: 0.02, wobble: 0.05 },
};

/** A small seeded random (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class Captain {
  readonly skill: Skill;
  private readonly rand: () => number;
  private goal: 'hunt' | 'paint' = 'paint';
  private goalUntil = 0;
  private gx = 0;
  private gz = 0;
  /** the white-hot breath it's decided on, and when its flick goes */
  private dodging = false;
  private flickAt = Infinity;
  private noise = 0;

  readonly level: Level;

  constructor(level: Level, seed: number) {
    this.level = level;
    this.skill = SKILLS[level];
    this.rand = rng(seed);
  }

  think(r: Recess, me: Bus): Hands {
    const T = recessTune, S = this.skill, t = r.t, h: Hands = { steer: 0, tap: false, flick: 0 };
    // (a breath at me gone white-hot: flick out of it, if I'm quick enough and see it)
    const hot = r.breaths.some((s) => s.target === me.id && s.white);
    if (hot && !this.dodging) {
      this.dodging = true;
      this.flickAt = this.rand() < S.dodge ? t + S.react * (0.7 + 0.6 * this.rand()) : Infinity;
    }
    if (!hot) {
      this.dodging = false;
      this.flickAt = Infinity;
    }
    if (t >= this.flickAt) {
      h.flick = 1;
      this.flickAt = Infinity;
    }
    // (what it wants: its avenger's mark first, then a hunt or the ground, rerolled every few seconds)
    if (t >= this.goalUntil) {
      this.goal = this.rand() < S.hunt ? 'hunt' : 'paint';
      this.goalUntil = t + 3 + this.rand() * 4;
      this.pickGround(r, me);
    }
    let prey: Bus | null = null;
    if (me.avenge >= 0 && t < me.avengeUntil && r.canLock(me, r.buses[me.avenge])) prey = r.buses[me.avenge];
    else if (this.goal === 'hunt' && me.state !== 'ride') {
      let d0 = Infinity;
      for (const b of r.buses) {
        if (!r.canLock(me, b) || b.faction === me.faction) continue;
        const d = Math.hypot(b.x - me.x, b.z - me.z);
        if (d < d0) {
          d0 = d;
          prey = b;
        }
      }
    }
    let tx = this.gx, tz = this.gz;
    if (prey) {
      const d = Math.hypot(prey.x - me.x, prey.z - me.z), lead = Math.min(1.5, d / T.breathSpeed);
      tx = prey.x + Math.cos(prey.heading) * prey.speed * lead;
      tz = prey.z + Math.sin(prey.heading) * prey.speed * lead;
    } else if (Math.hypot(tx - me.x, tz - me.z) < 60) this.pickGround(r, me);
    // (steering: onto it, with a wobble of its skill's size)
    this.noise += (this.rand() - 0.5) * 0.3;
    this.noise *= 0.97;
    const err = wrap(Math.atan2(tz - me.z, tx - me.x) - me.heading) + this.noise * S.wobble;
    h.steer = Math.max(-1, Math.min(1, err * 2 * S.aim));
    // (gears: quick across, slow to turn in close)
    const far = Math.hypot(tx - me.x, tz - me.z);
    const want = me.state === 'ride' ? me.gear : far > 450 && Math.abs(err) < 0.5 ? 1 : 0;
    if (!h.flick && want !== me.gear && me.state !== 'ride' && this.rand() < 0.05) h.flick = Math.sign(want - me.gear);
    // (the tap: at a bus it has held the glint on long enough, or at ground worth painting ahead)
    if (t >= me.belly) {
      if (me.lock >= 0 && r.buses[me.lock].faction !== me.faction) h.tap = t - me.lockSince >= T.botGlint + S.hold;
      else if (me.lock >= 0) h.tap = t - me.lockSince >= T.botGlint;
      else if (!prey) {
        const d = T.aheadMin + me.speed * T.aheadT, ax = me.x + Math.cos(me.heading) * d, az = me.z + Math.sin(me.heading) * d;
        h.tap = Recess.inside(ax, az) && this.worth(r.areas.get(ax, az), me, r);
      }
    }
    return h;
  }

  /** Ground worth a breath: grey, a rival's, its own below its top, or a heart a god may rise on. */
  private worth(a: Area | undefined, me: Bus, r?: Recess): boolean {
    if (!a || a.faction !== me.faction) return true;
    // (its own in the five seconds' wait: a hit there is only an encore)
    if (r && r.t - a.last < areaTune.cooldown) return false;
    if (a.stage < (r ? r.areas.topOf(a.key) : 4)) return true;
    const R = r?.areas.realm;
    return !!R && me.home >= 0 && R.heart(me.home) === a.key && a.stage < 5;
  }

  /** Somewhere in the circle to paint, nearer ground first: a few tries at random, the best kept. Holding its home, it goes for the heart's ring and the heart. */
  private pickGround(r: Recess, me: Bus): void {
    const A = r.areas, R = A.realm;
    if (R && me.home >= 0) {
      const s = A.standing(me.home);
      // (not held yet: its home's squares below the streets, nearest first; held: the heart's ring and the heart)
      if (s.holder !== me.faction && this.rand() < 0.8) {
        let best = -1, d0 = Infinity;
        for (const k of R.squares(me.home)) {
          const a = A.all.get(k);
          if (a && a.faction === me.faction && a.stage >= 3) continue;
          const c = squareCentre(k), d = Math.hypot(c.x - me.x, c.z - me.z) + this.rand() * 150 + (a && r.t - a.last < areaTune.cooldown ? 300 : 0);
          if (d < d0) {
            d0 = d;
            best = k;
          }
        }
        if (best >= 0) {
          const c = squareCentre(best);
          this.gx = c.x;
          this.gz = c.z;
          return;
        }
      }
      if (s.holder === me.faction && !s.god && this.rand() < 0.8) {
        const todo = [...A.ring(me.home), R.heart(me.home)].filter((k) => {
          const a = A.all.get(k);
          return !a || a.faction !== me.faction || a.stage < A.topOf(k) || k === R.heart(me.home);
        });
        const k = todo[Math.floor(this.rand() * todo.length)], c = squareCentre(k);
        this.gx = c.x;
        this.gz = c.z;
        return;
      }
    }
    const rad = recessTune.radius * 0.8;
    let best = Infinity;
    for (let k = 0; k < 6; k++) {
      const a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * rad, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const area = A.get(x, z), home = R && me.home >= 0 && R.of(squareKey(x, z)) === me.home ? -200 : 0;
      const cost = Math.hypot(x - me.x, z - me.z) + (this.worth(area, me, r) ? 0 : 800) + (area && area.faction !== me.faction ? -150 : 0) + home;
      if (cost < best) {
        best = cost;
        this.gx = x;
        this.gz = z;
      }
    }
  }
}
