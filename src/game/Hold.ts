import * as THREE from 'three';
import type { Input } from './Input';
import type { Flight } from './Flight';
import { hoseTune } from './Hose';
import type { City } from '../world/City';
import type { Particles } from '../fx/Particles';
import type { AudioEngine } from '../audio/AudioEngine';
import { lookOf } from '../render/factionLook';
import { Ramp } from '../render/palette';

// Hold to aim, and the hook the rest of the game builds on it (docs/specs/shots/HOOKS.md).
//
// Input says when a finger off the lane has held still for inputTune.aimHoldMs, where it
// goes, and when it lifts (Input.state.aim, onAimStart, onAimEnd). This turns that into a
// Hold: the screen point, its ray into the world, where the ray meets the city, how long it
// has lasted, the drag, the release. Handlers are asked, in the order they were added, once
// the hold becomes an aim: the first to say yes has it (life's lock on a boat or a plane,
// Recess's on a rival bus). Nobody saying yes, the last handler has it: the Hose
// (src/game/Hose.ts), added with { last: true }. A handler can also take a hold already
// under way (claim), and the one that had it is told (lost), so the Hose stops pouring.
//
// And the homing shot: fire() launches a blob that steers at a moving target with a turn
// limit and a speed, and goes white-hot and stops steering for its last `white` seconds,
// so a hard turn or a flick then beats it (SHOTS.md, "Lock-on" and "Dodging"). Its flight
// is the shot code's; who it's aimed at and what a hit does are the caller's.
//
// One Hold object, filled in place: a handler may keep the reference, and reads it fresh.
// Frame order (main.ts): frame() after the camera is final for the frame and before
// Splatter.update, so what a handler or the Hose fires this frame lands in it.

/** A ray in the world: an origin (the camera, m) and a unit direction. */
export interface HoldRay {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

/** A finger held still off the lane, and on until it lifts (read-only to handlers). */
export interface Hold {
  /** serial: a new one every hold */
  readonly id: number;
  /** down: the finger is on the glass; false once it has lifted (in end) */
  down: boolean;
  /** where the finger is now and where it landed, CSS px of the canvas (+y down) */
  x: number;
  y: number;
  x0: number;
  y0: number;
  /** the drag since it landed (CSS px, +y down; a hold starts within the tap slop of its landing) */
  dragX: number;
  dragY: number;
  /** seconds since the finger landed, and since it became an aim (the wall clock, as a thumb's) */
  held: number;
  aimed: number;
  /** the ray under the finger now, from the camera */
  readonly ray: HoldRay;
  /** where that ray meets the city (a roof, a tree, the ground, the water) within `reach` of the camera, when `hit` */
  hit: boolean;
  readonly point: THREE.Vector3;
  /** metres from the bus to `point` (Infinity when no hit) */
  range: number;
  /** the handler that has it (its name), or null: nobody, as when the Hose found no belly to pour */
  owner: string | null;
}

/** What life or Recess adds (Holds.add) to take holds and taps. Every method is optional. */
export interface HoldHandler {
  readonly name: string;
  /** A still hold just became an aim: true takes it (and nobody after you is asked). Asked in the order added; the Hose last. */
  start?(h: Hold): boolean;
  /** Every frame the finger is down, to whoever has it, and to every handler with watch: true. */
  move?(h: Hold, dt: number): void;
  /** It was yours, and another handler took it (Holds.claim). */
  lost?(h: Hold): void;
  /**
   * The finger lifted (cancelled: the touch was lost, three fingers came down, the page lost focus). To whoever has it, and to every handler with watch: true (one
   * that doesn't have it reads h.owner, and resets what it kept for h.id).
   */
  end?(h: Hold, cancelled: boolean): void;
  /** A tap is about to splat: true takes it (you fire something else instead, Holds.fire), and nothing splats. Asked in the order added. */
  tap?(): boolean;
}

/** Holds.fire's options. */
export interface HomingOpts {
  /** Where the target is now (world m, into `out`); false: it's gone (sunk, off the map), and the shot flies on a beat and ends as a miss, 'lost'. Called every frame. */
  target(out: THREE.Vector3): boolean;
  /** m/s along its path (a boat at 1.5 km: about 500; a plane 12 km out: 3,000 or more to arrive in under 4 s) */
  speed: number;
  /** the most it turns, rad/s (the lower, the easier to dodge before the white) */
  turn: number;
  /** its last seconds (time to go = distance / speed): white-hot, and it no longer steers (SHOTS.md: 0.7, 0.45 at a full charge) */
  white: number;
  /** a hit is within this of the target (m, default 6) */
  hitRadius?: number;
  /** it ends as a miss after this long (s, default 8) */
  maxTime?: number;
  /** where it leaves from (default the bus's mouth) and its first heading (default straight at the target) */
  from?: THREE.Vector3;
  dir?: THREE.Vector3;
  /** whose colours it flies in (game/factions.ts; default the player's), and which of its six (0-5, default 0) */
  faction?: number;
  hue?: number;
  /**
   * it spends the bus's belly: whatever is in it, at least hoseTune.minTank (12 %), so a lock that takes a hold the Hose had been pouring still fires (SHOTS.md:
   * "Nothing is wasted"); with less, or a breath under way, no shot (fire() returns null and the bus coughs). The belly then refills as after a tap.
   * Default: true when `from` is unset
   */
  belly?: boolean;
  /** a whistle rises over its last second (the shot at the player's bus) */
  whistle?: boolean;
  /** the blob's size x (default 1) */
  size?: number;
  onHit?(at: THREE.Vector3, shot: HomingShot): void;
  /** it went white-hot (time to go fell to `white`) */
  onWhite?(shot: HomingShot): void;
  /** it ended without a hit: dodged (passed the target in the white), lost (target() said gone), ground (it flew into the city), time (maxTime) */
  onMiss?(at: THREE.Vector3, shot: HomingShot, why: 'dodged' | 'lost' | 'ground' | 'time'): void;
}

/** A homing shot in flight (read it; cancel() ends it with no callback). */
export interface HomingShot {
  readonly id: number;
  readonly pos: THREE.Vector3;
  /** unit heading */
  readonly dir: THREE.Vector3;
  /** seconds flown, and the time to go at the last frame */
  t: number;
  ttg: number;
  white: boolean;
  done: boolean;
  cancel(): void;
}

/** What Holds needs from the game (main.ts). */
export interface HoldHost {
  input: Input;
  camera: THREE.Camera;
  city: City;
  flight: Flight;
  particles: Particles;
  audio: AudioEngine;
  /** the bus's mouth this frame (world) */
  mouth(): THREE.Vector3;
  /** the canvas's CSS size */
  view(): { w: number; h: number };
  /** the player's faction (crew.ts) */
  faction(): number;
  /** a breath leaves: the bus's anticipation (squash, heave), as a tap's */
  breath(): void;
}

/** How far a hold's ray looks for the city (m from the camera). */
const REACH = 6000;
/** homing shots in flight at once: the player's (from the belly), and everyone else's (captains), each their own */
const MAX_MINE = 4;
const MAX_SHOTS = 8;

interface Live extends HomingShot {
  o: HomingOpts;
  tgt: THREE.Vector3;
  last: THREE.Vector3;
  tv: THREE.Vector3;
  seen: boolean;
  closest: number;
  ramp: number;
  ending: number;
  whistled: boolean;
  mine: boolean;
}

export class Holds {
  /** the hold under way, or null */
  current: Hold | null = null;
  /** homing shots in flight */
  readonly shots: readonly HomingShot[];
  /** QA: what holds and shots came to */
  readonly stats = { holds: 0, claimed: 0, hits: 0, misses: 0, fired: 0, refused: 0, errors: 0, lastOwner: '' };

  private readonly h: HoldHost;
  private readonly handlers: Array<{ h: HoldHandler; last: boolean; watch: boolean }> = [];
  private readonly hold: Hold;
  private serial = 0;
  private shotSerial = 0;
  private readonly live: Live[] = [];
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly u = new THREE.Vector3();

  constructor(host: HoldHost) {
    this.h = host;
    this.shots = this.live;
    this.hold = { id: 0, down: false, x: 0, y: 0, x0: 0, y0: 0, dragX: 0, dragY: 0, held: 0, aimed: 0, ray: { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1 }, hit: false, point: new THREE.Vector3(), range: Infinity, owner: null };
  }

  /**
   * Add a handler. `last`: asked after every other (the Hose). `watch`: its move() runs every frame of every hold, whoever has it (a lock that waits for a
   * mover to come under the finger, then claims). Returns the remover.
   */
  add(handler: HoldHandler, opts: { last?: boolean; watch?: boolean } = {}): () => void {
    const e = { h: handler, last: !!opts.last, watch: !!opts.watch };
    this.handlers.push(e);
    this.handlers.sort((a, b) => Number(a.last) - Number(b.last));
    return () => {
      const i = this.handlers.indexOf(e);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** Take the hold under way for `name` (an added handler's); the one that had it gets lost(). False: no hold, or no such handler. */
  claim(name: string): boolean {
    const h = this.current;
    if (!h) return false;
    const e = this.handlers.find((x) => x.h.name === name);
    if (!e) return false;
    if (h.owner === name) return true;
    const was = this.handlers.find((x) => x.h.name === h.owner);
    h.owner = name;
    this.stats.claimed++;
    this.stats.lastOwner = name;
    if (was?.h.lost) {
      try {
        was.h.lost(h);
      } catch (err) {
        this.threw(was.h, err);
      }
    }
    return true;
  }

  /** Let the hold go: nobody has it (its finger stays down, and nothing else is asked). */
  release(name: string): void {
    if (this.current && this.current.owner === name) this.current.owner = null;
  }

  /** A tap is about to splat (main.ts): a handler may take it. */
  tap(): boolean {
    for (const e of this.handlers) {
      if (!e.h.tap) continue;
      try {
        if (e.h.tap()) return true;
      } catch (err) {
        this.threw(e.h, err);
      }
    }
    return false;
  }

  // (a handler that throws is told on the console, once each, and the game goes on: the Hose, the splats and the frame after it never wait on another's bug)
  private readonly told = new Set<string>();
  private threw(h: HoldHandler, err: unknown) {
    this.stats.errors++;
    if (this.told.has(h.name)) return;
    this.told.add(h.name);
    console.error(`Holds: handler '${h.name}' threw`, err);
  }

  // ------------------------------------------------------------------ screen and world

  /** The ray under a screen point (CSS px of the canvas) into `out`. */
  rayAt(sx: number, sy: number, out: HoldRay): HoldRay {
    const { w, h } = this.h.view();
    const cam = this.h.camera;
    const p = this.v.set((sx / Math.max(1, w)) * 2 - 1, 1 - (sy / Math.max(1, h)) * 2, 0.5).unproject(cam);
    cam.getWorldPosition(this.w);
    p.sub(this.w).normalize();
    out.ox = this.w.x;
    out.oy = this.w.y;
    out.oz = this.w.z;
    out.dx = p.x;
    out.dy = p.y;
    out.dz = p.z;
    return out;
  }

  /** A world point on the screen (CSS px of the canvas, into out.x / out.y): false behind the camera or off the screen. */
  screenOf(p: THREE.Vector3, out: { x: number; y: number }): boolean {
    const { w, h } = this.h.view();
    const q = this.u.copy(p).project(this.h.camera);
    out.x = ((q.x + 1) / 2) * w;
    out.y = ((1 - q.y) / 2) * h;
    return q.z < 1 && q.z > -1 && q.x >= -1 && q.x <= 1 && q.y >= -1 && q.y <= 1;
  }

  /** Where a ray meets the city (roofs, trees, the ground, the water) within `reach` m, into `out`: false if it doesn't. No allocation. */
  landing(r: HoldRay, out: THREE.Vector3, reach = REACH): boolean {
    const city = this.h.city;
    const under = (t: number) => r.oy + r.dy * t <= city.surfaceAt(r.ox + r.dx * t, r.oz + r.dz * t, r.oy + r.dy * t + 2);
    let t = 0, prev = 0, hit = -1;
    while (t < reach) {
      t = Math.min(reach, t + Math.max(2, t * 0.015));
      if (under(t)) {
        hit = t;
        break;
      }
      prev = t;
    }
    if (hit < 0) return false;
    for (let i = 0; i < 7; i++) {
      const m = (prev + hit) * 0.5;
      if (under(m)) hit = m;
      else prev = m;
    }
    out.set(r.ox + r.dx * hit, r.oy + r.dy * hit, r.oz + r.dz * hit);
    return true;
  }

  // ------------------------------------------------------------------ the hold (Input's callbacks)

  /** Input.onAimStart. */
  begin(): void {
    if (this.current) this.end(true);
    const h = this.hold;
    (h as { id: number }).id = ++this.serial;
    h.down = true;
    h.owner = null;
    this.fill(0);
    this.current = h;
    this.stats.holds++;
    for (const e of this.handlers) {
      if (!e.h.start) continue;
      let took = false;
      try {
        took = e.h.start(h);
      } catch (err) {
        this.threw(e.h, err);
      }
      if (took) {
        h.owner = e.h.name;
        this.stats.lastOwner = e.h.name;
        break;
      }
    }
  }

  /** Input.onAimEnd. */
  end(cancelled: boolean): void {
    const h = this.current;
    if (!h) return;
    this.fill(0);
    h.down = false;
    this.current = null;
    for (const e of this.handlers) {
      if (!e.h.end || (e.h.name !== h.owner && !e.watch)) continue;
      try {
        e.h.end(h, cancelled);
      } catch (err) {
        this.threw(e.h, err);
      }
    }
  }

  /** Once a frame, after the camera is final (dt: game seconds; the hold's own clocks are the wall clock's). */
  frame(dt: number): void {
    const h = this.current;
    if (h) {
      if (!this.h.input.state.aim.on) this.end(true);
      else {
        this.fill(dt);
        for (const e of this.handlers) {
          if (!e.h.move || (e.h.name !== h.owner && !e.watch)) continue;
          try {
            e.h.move(h, dt);
          } catch (err) {
            this.threw(e.h, err);
          }
        }
      }
    }
    this.stepShots(dt);
  }

  private fill(_dt: number) {
    const h = this.hold, A = this.h.input.state.aim, now = performance.now();
    h.x = A.x;
    h.y = A.y;
    h.x0 = A.x0;
    h.y0 = A.y0;
    h.held = Math.max(0, (now - A.t0) / 1000);
    h.aimed = Math.max(0, (now - A.at) / 1000);
    h.dragX = A.x - A.x0;
    h.dragY = A.y - A.y0;
    this.rayAt(A.x, A.y, h.ray);
    h.hit = this.landing(h.ray, h.point);
    const f = this.h.flight;
    h.range = h.hit ? Math.hypot(h.point.x - f.x, h.point.y - f.y, h.point.z - f.z) : Infinity;
  }

  // ------------------------------------------------------------------ the homing shot

  /** Launch a homing shot (HomingOpts). Null: too little in the belly (when it spends it), or the player's MAX_MINE / everyone else's MAX_SHOTS already flying. */
  fire(o: HomingOpts): HomingShot | null {
    const H = this.h;
    const belly = o.belly ?? !o.from;
    let n = 0;
    for (const s of this.live) if (s.mine === belly) n++;
    // (the player's refused shot coughs, whatever refused it: a lift that fires nothing is never silent)
    if (n >= (belly ? MAX_MINE : MAX_SHOTS) || (belly && !H.flight.tryBarf(hoseTune.minTank))) {
      this.stats.refused++;
      if (belly) H.audio.denied();
      return null;
    }
    if (belly) H.breath();
    const pos = new THREE.Vector3().copy(o.from ?? H.mouth());
    const tgt = new THREE.Vector3();
    const seen = o.target(tgt);
    const dir = new THREE.Vector3();
    if (o.dir) dir.copy(o.dir).normalize();
    else if (seen) dir.copy(tgt).sub(pos).normalize();
    else dir.set(H.flight.fx, 0, H.flight.fz);
    const faction = o.faction ?? H.faction();
    const sprays = lookOf(faction).spray;
    const s: Live = {
      id: ++this.shotSerial, pos, dir, t: 0, ttg: seen ? tgt.distanceTo(pos) / Math.max(1, o.speed) : Infinity, white: false, done: false,
      cancel: () => {
        s.done = true;
      },
      o, tgt, last: tgt.clone(), tv: new THREE.Vector3(), seen, closest: Infinity, ramp: sprays[((o.hue ?? 0) % 6 + 6) % 6], ending: -1, whistled: false, mine: belly,
    };
    this.live.push(s);
    this.stats.fired++;
    return s;
  }

  private stepShots(dt: number) {
    const H = this.h;
    for (let i = 0; i < this.live.length; ) {
      const s = this.live[i];
      if (!s.done && dt > 0) {
        // (its target() and callbacks are the caller's: one that throws ends that shot, not the frame)
        try {
          this.stepShot(s, dt);
        } catch (err) {
          s.done = true;
          this.stats.errors++;
          console.error('Holds: a homing shot threw', err);
        }
      }
      if (s.done) this.live.splice(i, 1);
      else i++;
    }
    void H;
  }

  private stepShot(s: Live, dt: number) {
    const o = s.o, H = this.h;
    s.t += dt;
    // (after a miss it flies on a beat, fading, so a dodge is seen to go by)
    if (s.ending >= 0) {
      s.ending -= dt;
      s.pos.addScaledVector(s.dir, o.speed * dt);
      this.trail(s, 0.5);
      if (s.ending < 0) s.done = true;
      return;
    }
    const was = s.seen;
    s.seen = o.target(s.tgt);
    if (s.seen) {
      // the target's velocity, smoothed: the shot leads it
      if (was) {
        this.v.copy(s.tgt).sub(s.last).divideScalar(dt);
        s.tv.lerp(this.v, 1 - Math.exp(-15 * dt));
      }
      s.last.copy(s.tgt);
    }
    const speed = Math.max(1, o.speed);
    const dist = s.seen ? s.pos.distanceTo(s.tgt) : Infinity;
    s.ttg = dist / speed;
    if (!s.white && s.seen && s.ttg <= o.white) {
      s.white = true;
      o.onWhite?.(s);
    }
    if (o.whistle && !s.whistled && s.seen && s.ttg <= 1) {
      s.whistled = true;
      H.audio.homingWhistle(s.ttg);
    }
    if (s.seen && !s.white) {
      // steer at where the target will be, at most `turn` rad/s
      const lead = this.w.copy(s.tgt).addScaledVector(s.tv, Math.min(s.ttg, 3)).sub(s.pos);
      if (lead.lengthSq() > 1e-6) {
        lead.normalize();
        const cos = Math.min(1, Math.max(-1, s.dir.dot(lead)));
        const ang = Math.acos(cos), max = Math.max(0, o.turn) * dt;
        if (ang <= max) s.dir.copy(lead);
        else {
          // (rotate dir toward lead by max, in their plane)
          const axis = this.u.crossVectors(s.dir, lead);
          if (axis.lengthSq() < 1e-10) axis.set(0, 1, 0);
          s.dir.applyAxisAngle(axis.normalize(), max).normalize();
        }
      }
    }
    // move, and test the segment against the target (a fast shot steps metres a frame)
    const step = speed * dt;
    const a = this.v.copy(s.pos);
    s.pos.addScaledVector(s.dir, step);
    const R = o.hitRadius ?? 6;
    if (s.seen) {
      const ab = this.w.copy(s.pos).sub(a);
      const k = Math.min(1, Math.max(0, this.u.copy(s.tgt).sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
      const near = this.u.copy(a).addScaledVector(ab, k).distanceTo(s.tgt);
      if (near <= R) {
        s.pos.copy(a).addScaledVector(ab, k);
        this.hitFx(s);
        s.done = true;
        this.stats.hits++;
        o.onHit?.(s.pos, s);
        return;
      }
      // (in the white it doesn't steer: once it is moving away it has gone by)
      s.closest = Math.min(s.closest, near);
      if (s.white && s.pos.distanceTo(s.tgt) > s.closest + 2 && s.dir.dot(this.u.copy(s.tgt).sub(s.pos)) < 0) return this.miss(s, 'dodged');
    } else if (was) return this.miss(s, 'lost');
    if (s.pos.y <= H.city.surfaceAt(s.pos.x, s.pos.z, s.pos.y + 2)) {
      this.hitFx(s);
      return this.miss(s, 'ground', true);
    }
    if (s.t >= (o.maxTime ?? 8)) return this.miss(s, 'time', true);
    this.trail(s, 1);
  }

  private miss(s: Live, why: 'dodged' | 'lost' | 'ground' | 'time', now = false) {
    this.stats.misses++;
    s.o.onMiss?.(s.pos, s, why);
    if (now) s.done = true;
    else s.ending = 0.45;
  }

  /** The blob and its trail: motes along this frame's path, in its colours, white-hot in its last window. */
  private trail(s: Live, k: number) {
    const P = this.h.particles, size = (s.o.size ?? 1) * (s.white ? 1.5 : 1);
    const ramp = s.white ? Ramp.GLOW_WHITE : s.ramp;
    // (a blob the size of a car's roof with a glowing core, and a tail a frame's travel long that lingers: from the chase camera at 500 m the first build's
    // 2.6 sparks read as a dotted thread, GPU frames of step 2)
    const back = Math.min(60, s.o.speed / 50);
    const n = Math.max(3, Math.min(8, Math.round(back / 3)));
    P.comet(s.pos, 0, 0, 0, Ramp.GLOW_WHITE, 4.5 * size * k, 0.06);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      this.w.copy(s.pos).addScaledVector(s.dir, -back * u);
      P.comet(this.w, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, i < 2 || s.white ? ramp : s.ramp, (i === 0 ? 7 : 4.2 - 2.4 * u) * size * k, i === 0 ? 0.08 : 0.35 + 0.35 * Math.random());
    }
  }

  /** Where it lands: a burst of its own motes (the caller paints what it hit). */
  private hitFx(s: Live) {
    const P = this.h.particles;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.6, v = 8 + Math.random() * 14;
      P.comet(s.pos, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v + 4, Math.sin(a) * Math.cos(e) * v, i % 4 === 0 ? Ramp.GLOW_WHITE : s.ramp, 1.8, 0.5 + 0.4 * Math.random());
    }
  }
}
