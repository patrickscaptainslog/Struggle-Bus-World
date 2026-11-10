import type * as THREE from 'three';
import type { HomingOpts, HomingShot } from '../game/Hold';
import { rivalTune, type Rival, type Rivals } from './rivals';

// The two shells (docs/specs/factions/RAMPAGE.md, "In front of you: the shell"), as the shot code's homing shot takes them (Holds.fire): what each flies like, in
// one place, so the harness fires the very shots the game does (tools/rivals/s_shell.ts).

/** The player's shell at a rival, from a bus going `busSpeed` m/s: it leads the rival, steers hard, and flies straight for its last shellWhite s, when the rival
 *  may try to skid out of its way (Rivals.threat). */
export function shellAt(sim: Rivals, r: Rival, busSpeed: number, hit: (at: THREE.Vector3, shot: HomingShot) => void, miss: () => void): HomingOpts {
  const T = rivalTune;
  return {
    target: (out) => r.live && (out.set(r.x, r.y, r.z), true),
    vel: (out) => void out.set(Math.sin(r.heading) * r.speed, 0, -Math.cos(r.heading) * r.speed),
    speed: T.shellSpeed + busSpeed,
    turn: T.shellTurn,
    white: T.shellWhite,
    hitRadius: Math.max(9, r.speed / 30 + 5),
    maxTime: 5,
    onWhite: (s) => {
      // (which side of it the shot comes from, by its right hand: it skids the other way, if it tries)
      const side = Math.cos(r.heading) * (s.pos.x - r.x) + Math.sin(r.heading) * (s.pos.z - r.z);
      sim.threat(r, side > 0 ? 1 : -1);
    },
    onHit: hit,
    onMiss: miss,
  };
}

/** A rival's shell at the player's bus, from `from` (its nose): the player's own shot's speed over the rival's, a little less turn, a little more white, and a
 *  whistle over its last second. `bus` and `busVel` write the player's bus's place and velocity (Holds.bus, Holds.busVel); `busSpeed` is its speed now. */
export function shellBack(
  r: Rival, from: THREE.Vector3, bus: (out: THREE.Vector3) => void, busVel: (out: THREE.Vector3) => void, busSpeed: number,
  hit: (at: THREE.Vector3, shot: HomingShot) => void, miss: (why: string) => void,
): HomingOpts {
  const T = rivalTune;
  return {
    from, faction: r.faction, belly: false, whistle: true,
    target: (out) => (bus(out), true),
    vel: (out) => void busVel(out),
    speed: T.shellSpeed + r.speed, turn: T.backTurn, white: T.backWhite, maxTime: 5, hitRadius: Math.max(7, busSpeed / 30 + 3),
    onHit: hit,
    onMiss: (_at, _s, why) => miss(why),
  };
}
