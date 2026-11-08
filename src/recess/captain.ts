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
  /** how often it goes home when its god is cracked or a rival is at its heart (once a danger), and how often its painting is a raid on a rival's heart */
  defend: number;
  raid: number;
  /** how often it waits for its god's ring to close before it taps its heart (decision 16, seal two: a heal or a guard counts only then) */
  timing: number;
}

export const SKILLS: Record<Level, Skill> = {
  learner: { react: 0.28, dodge: 0.2, aim: 0.6, hunt: 0.35, hold: 0.4, wobble: 0.25, defend: 0.4, raid: 0.15, timing: 0 },
  rival: { react: 0.18, dodge: 0.5, aim: 0.85, hunt: 0.5, hold: 0.15, wobble: 0.12, defend: 0.7, raid: 0.3, timing: 0.5 },
  veteran: { react: 0.1, dodge: 0.8, aim: 1, hunt: 0.65, hold: 0.02, wobble: 0.05, defend: 0.95, raid: 0.35, timing: 1 },
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
  private goal: 'hunt' | 'paint' | 'defend' = 'paint';
  /** a danger to its god seen and rolled for, and whether this defence chases the raider */
  private alarmed = false;
  private chase = false;
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

  /**
   * The first bell (SHOTS.md, "First contact within 10 s": "The easiest captain locks you at about 4 s and fires at about 5 s ... Your first duel is a dodge you
   * win"): with `prey` (a bus's id, the player's) the first 10 s hunting it, so the duel comes to the player; without, the first 10 s painting, so the first duel
   * is the easiest captain's (the day review's m52: the kickoff hunted the nearest rival, the other captain at 168 m, and the player met the Rival first).
   */
  kickoff(t: number, prey = -1): void {
    this.goal = prey >= 0 ? 'hunt' : 'paint';
    this.goalUntil = t + 10;
    this.mark = prey;
  }
  /** the bus the kickoff's hunt is for (-1 none) */
  private mark = -1;

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
    // (what it wants: home when its god is in danger, its avenger's mark, then a hunt or the ground, rerolled every few seconds)
    // (rolled when a danger starts, not every step: the first account's review, m33; and again each time its run of 4 to 7 s ends while the danger lasts, so a
    // god cracked and not healed at once still gets its owner back, its skill's share of the time (the day review's M45). Home, it hunts the raider one time in
    // seven (the studio's heal study), and otherwise heals and guards its god on the ring. The danger over, it goes back to its own)
    const danger = this.danger(r, me);
    if (danger && !this.alarmed) {
      this.alarmed = true;
      this.rollDefend(t);
    }
    if (!danger) {
      this.alarmed = false;
      if (this.goal === 'defend') this.goalUntil = t;
    }
    if (t >= this.goalUntil && !(danger && this.rollDefend(t))) {
      this.goal = this.rand() < S.hunt ? 'hunt' : 'paint';
      this.goalUntil = t + 3 + this.rand() * 4;
      this.pickGround(r, me);
    }
    let prey: Bus | null = null;
    if (this.goal === 'defend' && danger) {
      // (the raider at its heart, or the heart itself, to heal its cracks and guard it on the ring)
      if (danger !== true && this.chase && r.canLock(me, danger)) prey = danger;
      else {
        const c = squareCentre(r.areas.realm!.heart(me.home));
        this.gx = c.x;
        this.gz = c.z;
      }
    } else if (me.avenge >= 0 && t < me.avengeUntil && r.canLock(me, r.buses[me.avenge])) prey = r.buses[me.avenge];
    else if (this.goal === 'hunt' && me.state !== 'ride' && this.mark >= 0 && t < this.goalUntil && r.canLock(me, r.buses[this.mark])) prey = r.buses[this.mark];
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

  /** Its skill's roll to go home and defend for 4 to 7 s: true if it does. */
  private rollDefend(t: number): boolean {
    if (this.rand() >= this.skill.defend) return false;
    this.goal = 'defend';
    this.goalUntil = t + 4 + this.rand() * 3;
    this.chase = this.rand() < 0.15;
    return true;
  }

  /** Its god in danger: cracked (true), or a rival bus within 350 m of its heart (that bus); else null. */
  private danger(r: Recess, me: Bus): Bus | true | null {
    const R = r.areas.realm;
    if (!R || me.home < 0) return null;
    const h = r.areas.all.get(R.heart(me.home));
    if (!h || h.faction !== me.faction || h.stage < 5) return null;
    const c = squareCentre(h.key);
    for (const b of r.buses) if (b.faction !== me.faction && Math.hypot(b.x - c.x, b.z - c.z) < 350) return b;
    return h.cracks > 0 ? true : null;
  }

  /** Ground worth a breath: grey, a rival's, its own cracked or below its top, or a heart a god may rise on. */
  private worth(a: Area | undefined, me: Bus, r?: Recess): boolean {
    if (!a || a.faction !== me.faction) return true;
    // (its own in the five seconds' wait: a hit there is only an encore. A captain that doesn't time the ring taps its cracked god anyway, now and then)
    const ready = !r || r.t - a.last >= areaTune.cooldown;
    if (!ready) return a.cracks > 0 && this.rand() >= this.skill.timing && this.rand() < 0.05;
    if (a.cracks > 0) return true;
    // (its whole god with a raider near: a guard, the ring again)
    if (r && a.stage === 5 && this.danger(r, me)) return true;
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
    // (a raid: a rival's god, its heart to crack)
    if (R && this.rand() < this.skill.raid) {
      const hearts: number[] = [];
      for (let n = 0; n < R.count; n++) {
        const a = A.all.get(R.heart(n));
        if (a && a.stage === 5 && a.faction !== me.faction) hearts.push(a.key);
      }
      if (hearts.length) {
        const c = squareCentre(hearts[Math.floor(this.rand() * hearts.length)]);
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
