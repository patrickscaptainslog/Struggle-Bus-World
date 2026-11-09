import * as THREE from 'three';
import type { Hold, HoldHandler, Holds } from '../game/Hold';

// Lock-on for boats and planes (docs/specs/shots/SHOTS.md, "Lock-on"; HOOKS.md): life's side of the shots' hold. A still hold on a ferry or a sailboat within
// 1.5 km, or a plane anywhere on the screen out to 12 km, takes the hold from the Hose; at about 0.55 s it clacks and the target glints, and the lift fires a
// blob that homes in (Holds.fire). A lift before the clack homes weakly; nothing is wasted. The lock holds 4 s after the lift, so the next taps go to the same
// target. It sticks to the target, not the finger, until the target leaves the screen or a building hides it. A plane that comes under a finger the Hose is
// pouring from is taken mid-pour. A hit paints the mover as a breath would (life.hit): a boat's hull and its wake, a plane and its contrail.
//   life.lockOn(host)   once, in main.ts's life block: the handler on the shots' `holds`, and the one-time HOLD TO LOCK hint the first time a boat is in reach

export const lockTune = {
  /** the pick: the nearest within this many px of the finger, or its drawn size's half and `sizePx` more (SHOTS.md: "a plane that's only a dot still catches") */
  pickPx: 48,
  sizePx: 16,
  /** the clack (s of the hold's aim), and how long the lock holds after the lift for taps (s) */
  lockAt: 0.55,
  keep: 4,
  /** reach (m from the bus): boats, planes */
  boatReach: 1500,
  planeReach: 12000,
  /** the shot at a boat: its speed (m/s), turn (rad/s) and hit radius (m); at a plane fast enough to arrive in `planeT` s, never under `planeMin` m/s */
  boatSpeed: 520,
  boatTurn: 4,
  boatHit: 12,
  planeT: 3.5,
  planeMin: 900,
  planeTurn: 8,
  planeHit: 30,
  /** a lift before the clack: the shot this much slower and this much less able to turn ("homes weakly") */
  weakSpeed: 0.8,
  weakTurn: 0.3,
  /** boats and planes can't dodge (SHOTS.md): its white is short */
  white: 0.15,
  /** the hint looks for a boat in reach this often (s) */
  hintEvery: 0.5,
};

/** What lock-on needs of the game (main.ts's life block). */
export interface LockHost {
  holds: Holds;
  /** the splatter's faction and its next hue, and dealing it on (a fresh mover takes a hue) */
  faction(): number;
  hue(): number;
  dealHue(): void;
  /** the clack at the lock */
  clack(): void;
  /** the one-time HOLD TO LOCK hint (Controls' toast) */
  hint(lines: string[]): void;
}

/** What lock-on asks of life (Life.ts). */
export interface LockLife {
  /** The boat or plane nearest screen point (sx, sy) that may be locked (`planes` only planes): its key into `out.key`, where it is into `out.at`; false: none. */
  pickLock(sx: number, sy: number, holds: Holds, planes: boolean, out: LockPick): boolean;
  /** Where the mover keyed `key` is now (world m into `out`); false: gone from life's snapshot. */
  moverAt(key: string, out: THREE.Vector3): boolean;
  /** The velocity of the mover moverAt last found (world m/s into `out`): the shot's lead. */
  moverVel(out: THREE.Vector3): void;
  /** The lock's glint on `key` (or none), over the aim's. */
  lockGlint(key: string | null): void;
  /** A homing shot reached `key`: its paint, now. True if it was fresh. */
  lockHit(key: string, hue: number, faction: number): boolean;
  /** A boat in reach on the screen now (the hint). */
  boatInReach(holds: Holds): boolean;
}

export interface LockPick {
  key: string;
  plane: boolean;
  readonly at: THREE.Vector3;
}

export class LifeLock implements HoldHandler {
  readonly name = 'life-lock';
  /** the target (its key), whether it's a plane, the hold it was taken on, whether it clacked, and until when (performance.now ms) a tap goes to it */
  locked: string | null = null;
  plane = false;
  clacked = false;
  until = 0;
  /** QA: shots fired, hits, misses and why, picks taken, planes taken mid-pour */
  readonly qa = { fired: 0, hits: 0, misses: 0, why: '', picks: 0, midPour: 0, weak: 0, broken: 0, hinted: false };
  private holdId = -1;
  private hintT = 0;
  private readonly pick: LockPick = { key: '', plane: false, at: new THREE.Vector3() };
  private readonly v = new THREE.Vector3();
  private readonly s = { x: 0, y: 0 };
  private readonly life: LockLife;
  private readonly host: LockHost;

  constructor(life: LockLife, host: LockHost) {
    this.life = life;
    this.host = host;
    // (a watcher: it hears every hold, so a plane under a finger the Hose has can be taken mid-pour)
    host.holds.add(this, { watch: true });
  }

  start(h: Hold): boolean {
    if (!this.life.pickLock(h.x, h.y, this.host.holds, false, this.pick)) return false;
    this.take(h, false);
    return true;
  }

  move(h: Hold): void {
    if (h.owner !== this.name) {
      // (a plane that comes under the finger while the Hose pours: the lock takes it, and the Hose stops)
      if (h.owner === 'hose' && this.life.pickLock(h.x, h.y, this.host.holds, true, this.pick) && this.host.holds.claim(this.name)) this.take(h, true);
      return;
    }
    if (!this.locked || h.id !== this.holdId) return;
    // (it sticks to the target until it leaves the screen or a building hides it: then the lock breaks, and nothing pours under the finger)
    if (!this.seen(this.locked)) {
      this.qa.broken++;
      this.drop();
      this.host.holds.release(this.name);
      return;
    }
    if (!this.clacked && h.aimed >= lockTune.lockAt) {
      this.clacked = true;
      this.host.clack();
      this.life.lockGlint(this.locked);
    }
  }

  lost(): void {
    this.drop();
  }

  end(h: Hold, cancelled: boolean): void {
    if (h.owner !== this.name || h.id !== this.holdId) return;
    const key = this.locked;
    if (cancelled || !key) {
      this.drop();
      return;
    }
    // (a lift before the clack is a plain shot that homes weakly: nothing is wasted)
    if (this.fire(key, !this.clacked)) this.until = performance.now() + lockTune.keep * 1000;
    else this.drop();
  }

  /** A tap while the lock holds: its shot homes at the same target. */
  tap(): boolean {
    if (!this.locked || performance.now() >= this.until || !this.seen(this.locked)) return false;
    return this.fire(this.locked, false);
  }

  /** Each frame (Life.frame): the lock's glint while it holds, and the hint the first time a boat is in reach. */
  tick(dt: number): void {
    if (this.locked && this.until > 0 && performance.now() >= this.until) this.drop();
    if (this.qa.hinted) return;
    this.hintT += dt;
    if (this.hintT < lockTune.hintEvery) return;
    this.hintT = 0;
    if (this.life.boatInReach(this.host.holds)) {
      this.qa.hinted = true;
      this.host.hint(['HOLD TO LOCK']);
    }
  }

  private take(h: Hold, midPour: boolean): void {
    this.locked = this.pick.key;
    this.plane = this.pick.plane;
    this.holdId = h.id;
    this.clacked = false;
    this.until = 0;
    this.qa.picks++;
    if (midPour) this.qa.midPour++;
  }

  private drop(): void {
    this.locked = null;
    this.until = 0;
    this.clacked = false;
    this.holdId = -1;
    this.life.lockGlint(null);
  }

  /** The target on the screen and in sight. */
  private seen(key: string): boolean {
    return this.life.moverAt(key, this.v) && this.host.holds.screenOf(this.v, this.s) && this.host.holds.inSight(this.v);
  }

  /** The homing shot at `key`: false if none flew (the belly too low, a breath under way, too many in the air: the bus coughs). */
  private fire(key: string, weak: boolean): boolean {
    const T = lockTune, H = this.host, plane = this.plane, life = this.life, v = this.v;
    if (!life.moverAt(key, v)) return false;
    const bus = H.holds.bus(new THREE.Vector3()), d = bus.distanceTo(v), hue = H.hue(), faction = H.faction();
    const speed = (plane ? Math.max(T.planeMin, d / T.planeT) : T.boatSpeed) * (weak ? T.weakSpeed : 1);
    const shot = H.holds.fire({
      target: (out) => life.moverAt(key, out),
      // (the shot leads the boat or the plane from its launch: Hold.ts asks vel after each target that held)
      vel: (out) => life.moverVel(out),
      speed,
      turn: (plane ? T.planeTurn : T.boatTurn) * (weak ? T.weakTurn : 1),
      white: T.white,
      hitRadius: plane ? T.planeHit : T.boatHit,
      maxTime: plane ? T.planeT * 2 + 2 : 8,
      faction,
      hue,
      onHit: () => {
        this.qa.hits++;
        if (life.lockHit(key, hue, faction)) H.dealHue();
      },
      onMiss: (_at, _s, why) => {
        this.qa.misses++;
        this.qa.why = why;
      },
    });
    if (!shot) return false;
    this.qa.fired++;
    if (weak) this.qa.weak++;
    return true;
  }
}
