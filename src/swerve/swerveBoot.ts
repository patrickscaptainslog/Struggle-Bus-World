import * as THREE from 'three';
import { LOOKAHEAD, type Kit } from '../audio/dsp';
import type { BusPose } from '../bus/BusModel';
import { config } from '../config';
import type { Flight } from '../game/Flight';
import type { InputState } from '../game/Input';
import type { BarfOpts } from '../game/Splat';
import type { TurboDrive } from '../game/Turbo';
import { registerTunables } from '../ui/tunables';
import { Swerve, squeeze, swerveTune, wavePlace } from './swerve';
import { airHiss, brakeClunk, skidSqueal } from './swerveSfx';

// ?swerve on the screen (docs/specs/flight/SWERVE.md): the stand-in's hands and its looks. The handling itself is swerve.ts, which the harness flies in Node;
// what's here needs a page.
//
//  - The thumb. Each frame main.ts hands over Input's state: the sideways travel is its finger less its anchor, as the stick itself reads them. A thumb that
//    landed near a side of the glass has less room that way than the hard part and the skid need: they squeeze into what there is (swerve.ts's `squeeze`), so
//    a thumb against the edge is always asking for all of it. Keys have no travel, so on a desktop C held is the hard part and V the skid, with the arrows; X
//    is the long swipe. (Dev keys: the phone has none.)
//  - The long swipe, the producer's: "a large swipe from top to bottom of screen" that "brings the bus to gear 1, just above school zone, very quickly". One
//    stroke down of `share` of the screen's height, landed off the bus's lane (in the lane a stroke down is the stick's pull), nearly straight, in `ms` or
//    less: every rung above Cruise goes at once and the speed with it (TurboDrive.toCruise). It is judged as the stroke passes its length, not at its lift, so the bus
//    answers under the thumb; the lift is then nothing (`flick`: Controls' gate takes the flick it would have been) and the look it began is let go (`swiped`).
//    From Cruise and under it does nothing: School Zone and Curb are still a flick each.
//  - The looks: a fan of the crew's paint off the outside of a slide, the wave when it grips with a full belly (Splatter.barf, as a tap paints), the bus's lean,
//    the stop arm out and the nose up on the brake, and stand-in sounds (swerveSfx.ts).
//
// main.ts, each frame: pre() after the gears and before the flight's steps; post() after them; `slip`, `roll` and `pitch` into the bus's pose and `slip` into
// the aim; pose() on the bus's pose; `swiped` over the look. Controls.flickGate asks flick().

/** The long swipe's numbers and the looks' (tuner group "Swerve" with the handling's). */
export const swipeTune = {
  /** The long swipe: a stroke down of this share of the screen's height, in at most this long (ms), within this many degrees of straight down. */
  share: 0.4,
  ms: 600,
  deg: 28,
  /** ...and the nose comes up this much as it brakes (deg). */
  nose: 9,
  /** A thumb can be read to within this of the glass's sides (px): the room it has, for the squeeze. */
  inset: 14,
  /** The slide's spray: puffs a second, and how hard a skid kicks the view. */
  spray: 42,
  kick: 0.35,
};

export interface SwerveDeps {
  /** what the thumbs land on (Input's element) */
  el: HTMLElement;
  flight: Flight;
  turbo: TurboDrive;
  /** a landing here is off the bus's lane: it looks (Input.inLookZone; CSS px of the element) */
  offLane(x: number, y: number): boolean;
  barf(x: number, z: number, o: BarfOpts): void;
  groundAt(x: number, z: number): number;
  particles: {
    palette: readonly number[];
    puff(pos: THREE.Vector3, vel: THREE.Vector3, ramp?: number, sizeK?: number, paint?: boolean): void;
    fling(from: THREE.Vector3, to: THREE.Vector3, flight: number, hue: number, size: number): void;
  };
  /** the next shot's hue (Splatter.hueNext) */
  hue(): number;
  kick(k: number): void;
  kit(): Kit | null;
}

export interface SwerveBoot {
  readonly core: Swerve;
  /** The bus's model turns, rolls and pitches by these over the flight's own (rad): the skid's slip and lean, the brake's nose. */
  readonly slip: number;
  readonly roll: number;
  readonly pitch: number;
  /** The stroke down now is the long swipe, fired: the look it began is let go until it lifts. */
  readonly swiped: boolean;
  /** After the gears, before the flight's steps. `off`: no handling of it this frame (the street, the opening's gate). */
  pre(dt: number, st: InputState, off: boolean): void;
  /** After the flight's steps. */
  post(dt: number): void;
  pose(p: BusPose): void;
  /** Controls' gate: true, the flick was the long swipe's own lift and is nothing. */
  flick(dir: 1 | -1): boolean;
  /** The long swipe, from a key or a tool. */
  swipe(): void;
  /** A tool's thumb: the sideways travel (px) to fly with, or null for the real one. */
  thumb: number | null;
  /** A wave landed at (x, z), this far round (m): the rival buses in it are soaked (src/rivals/rivalsBoot.ts). */
  onWave: ((x: number, z: number, radius: number) => void) | null;
  /** The stop arm out for this long (s): a bump between buses. */
  arm(seconds: number): void;
}

export function bootSwerve(d: SwerveDeps): SwerveBoot {
  const core = new Swerve(), f = d.flight, T = swerveTune, W = swipeTune;
  registerTunables('Swerve', swerveTune as unknown as Record<string, unknown>, {
    hardFrom: [40, 170, 1], hardFull: [60, 172, 1], hardHz: [2, 9, 0.1], hardCam: [1, 3, 0.05], swoopMax: [1, 4, 0.1], swoopFrom: [0, 0.9, 0.01], swoopFull: [0.1, 1, 0.01],
    swoopEase: [1, 20, 0.5], swoopFall: [0.5, 20, 0.5], skidFrom: [90, 172, 1], skidBack: [0, 40, 1], squeezeSmooth: [20, 78, 1], squeezeHard: [4, 42, 1], squeezeSkid: [0, 40, 1], skidHold: [0, 0.4, 0.01], skidMin: [0, 60, 1], slipMin: [0, 2, 0.05],
    slipMax: [20, 89, 1], scrub: [0, 1.5, 0.01], floor: [5, 40, 1], scrubRate: [1, 12, 0.5], grip: [0.05, 1, 0.01], hold: [0.3, 5, 0.1], lean: [0, 40, 1],
    waveAfter: [0, 1, 0.01], waveSlip: [0, 70, 1], waveOut: [0, 100, 1], waveBack: [0, 60, 1], waveRadius: [15, 90, 1], brakeFor: [0.2, 2, 0.05],
  });
  registerTunables('Swipe', swipeTune as unknown as Record<string, unknown>, {
    share: [0.2, 0.8, 0.01], ms: [200, 1200, 10], deg: [5, 60, 1], nose: [0, 25, 1], inset: [0, 40, 1], spray: [0, 120, 1], kick: [0, 1.5, 0.05],
  });
  const stick = { dragging: false, dx: 0, sx: 0 };
  const p = new THREE.Vector3(), v = new THREE.Vector3(), to = new THREE.Vector3(), place = { x: 0, z: 0 };
  let pitch = 0, braked = 0, armLeft = 0, sprayAcc = 0, sprayN = 0;
  let stopSqueal: ((at: number) => void) | null = null;
  // (dev keys)
  let keyHard = false, keySkid = false;

  // ---- the long swipe: one stroke at a time, read from its landing as it moves
  const S = { id: -1, x0: 0, y0: 0, t0: 0, h: 1, fired: false, dead: false };
  let swiped = false, lifted = false;
  /** the element's width (CSS px), read at each landing: the thumb's room to a side */
  let elW = d.el.getBoundingClientRect().width;
  const swipe = () => {
    // (every rung above Cruise at once, and the gears' brake for it; from Cruise and under it's nothing: School Zone and Curb are a flick each)
    if (!d.turbo.toCruise(f, T.brakeFor)) return;
    braked = 0.9;
    d.kick(W.kick * 1.6);
    const kit = d.kit();
    if (kit) brakeClunk(kit, kit.ctx.currentTime + LOOKAHEAD);
    // (a puff of its paint goes on ahead of it, as it stands on its nose)
    const g = f.ground;
    for (let i = 0; i < 9; i++) {
      p.set(f.x + f.fx * 7, f.y - 0.5, f.z + f.fz * 7);
      v.set(f.fx * (g * 0.5 + 14) + (Math.random() - 0.5) * 9, 1 + Math.random() * 5, f.fz * (g * 0.5 + 14) + (Math.random() - 0.5) * 9);
      d.particles.puff(p, v, d.particles.palette[i % d.particles.palette.length], 1.5, true);
    }
  };
  const down = (e: PointerEvent) => {
    const r = d.el.getBoundingClientRect();
    elW = r.width;
    if (e.pointerType === 'mouse' || S.id >= 0) return;
    if (!d.offLane(e.clientX - r.left, e.clientY - r.top)) return;
    S.id = e.pointerId;
    S.x0 = e.clientX;
    S.y0 = e.clientY;
    S.t0 = e.timeStamp;
    S.h = r.height;
    S.fired = S.dead = false;
    swiped = lifted = false;
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== S.id || S.fired || S.dead) return;
    const dx = e.clientX - S.x0, dy = e.clientY - S.y0, ms = e.timeStamp - S.t0;
    // (too slow, or back up the glass: a look, for good)
    if (ms > W.ms || dy < -24) {
      S.dead = true;
      return;
    }
    if (dy < S.h * W.share || Math.abs(dx) > dy * Math.tan((Math.min(80, W.deg) * Math.PI) / 180)) return;
    S.fired = swiped = true;
    swipe();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== S.id) return;
    S.id = -1;
    // (the stroke is over at the next frame, not here: its lift's flick is asked about by Input's own handlers, whichever of them runs last)
    lifted = true;
  };
  d.el.addEventListener('pointerdown', down, { passive: true });
  d.el.addEventListener('pointermove', move, { passive: true });
  d.el.addEventListener('pointerup', up, { passive: true });
  d.el.addEventListener('pointercancel', up, { passive: true });
  const key = (e: KeyboardEvent) => {
    const on = e.type === 'keydown';
    if (e.code === 'KeyC') keyHard = on;
    else if (e.code === 'KeyV') keySkid = on;
    else if (e.code === 'KeyX' && on && !e.repeat) swipe();
  };
  window.addEventListener('keydown', key);
  window.addEventListener('keyup', key);

  // ---- the skid's looks
  core.onEvent = (ev) => {
    const kit = d.kit(), now = kit ? kit.ctx.currentTime + LOOKAHEAD : 0;
    if (ev === 'skid') {
      d.kick(W.kick);
      stopSqueal?.(now);
      stopSqueal = kit ? skidSqueal(kit, now, Math.log(Math.max(1, f.speed / config.flight.cruiseSpeed)) / Math.log(30)) : null;
    } else if (ev === 'grip') {
      stopSqueal?.(now);
      stopSqueal = null;
      if (kit) airHiss(kit, now, 0.35, 0.05);
      d.kick(W.kick * 0.7);
    } else if (ev === 'wave') {
      // (the belly goes off the outside of the slide and a little behind: one splat's worth, on the ground beside the bus's way)
      const side = -core.dir, rx = Math.cos(f.heading), rz = Math.sin(f.heading);
      const { x: cx, z: cz } = wavePlace(f, core.dir, place);
      const gy = d.groundAt(cx, cz), hue = d.hue();
      d.barf(cx, cz, { drop: Math.max(0, f.y - gy), travel: 0.3, stream: true, hitStop: 0, radius: T.waveRadius });
      boot.onWave?.(cx, cz, T.waveRadius);
      f.fullness = 0;
      f.rechargeSeconds = 0;
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, r = T.waveRadius * Math.sqrt(Math.random()) * 0.9;
        p.set(f.x + rx * side * 2.5, f.y - 0.6, f.z + rz * side * 2.5);
        to.set(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
        to.y = d.groundAt(to.x, to.z) + 0.2;
        d.particles.fling(p, to, 0.22 + Math.random() * 0.16, hue, 0.8 + Math.random() * 0.6);
      }
      if (kit) airHiss(kit, now, 0.5, 0.08);
    }
  };

  const boot: SwerveBoot = {
    core,
    thumb: null,
    onWave: null,
    get slip() {
      return core.slip;
    },
    get roll() {
      return core.roll;
    },
    get pitch() {
      return pitch;
    },
    get swiped() {
      return swiped;
    },
    pre(dt, st, off) {
      if (lifted) swiped = lifted = false;
      stick.dragging = st.dragging;
      stick.sx = st.stretch.x;
      // (a thumb: its travel on the glass. Keys: none, so the stick's own, out to the hard part with C and to the skid with V)
      if (st.anchor && st.finger) {
        // (the room from where it landed to the side it's going toward, on the element's own width)
        const dx = st.finger.x - st.anchor.x, room = (dx > 0 ? elW - st.anchor.x : st.anchor.x) - W.inset;
        stick.dx = Math.sign(dx) * squeeze(Math.abs(dx), room);
      } else stick.dx = st.stretch.x * (keySkid ? 172 : keyHard ? T.hardFull + 4 : T.hardFrom);
      if (boot.thumb !== null) {
        stick.dragging = true;
        stick.dx = boot.thumb;
        stick.sx = Math.sign(boot.thumb);
      }
      core.pre(dt, stick, f, off);
    },
    post(dt) {
      core.post(dt, f);
      // (the fan of paint off the outside of the slide, from under its tail)
      if (core.sliding && dt > 0) {
        const side = -core.dir, nose = f.heading + core.slip, nx = Math.sin(nose), nz = -Math.cos(nose), rx = Math.cos(nose), rz = Math.sin(nose);
        const k = Math.min(1, Math.abs(core.slip) / ((T.slipMax * Math.PI) / 180)), out = 5 + 0.05 * f.ground;
        for (sprayAcc += dt * W.spray * (0.35 + 0.65 * k); sprayAcc >= 1; sprayAcc--) {
          p.set(f.x - nx * 6 + rx * side * 1.6, f.y - 1.8, f.z - nz * 6 + rz * side * 1.6);
          v.set(rx * side * out + f.fx * f.ground * 0.25, 2.5 + Math.random() * 3, rz * side * out + f.fz * f.ground * 0.25);
          d.particles.puff(p, v, d.particles.palette[sprayN++ % d.particles.palette.length], 1.5 + 1.3 * k, true);
        }
      } else sprayAcc = 0;
      // (the brake: the nose up and back, on the wall of air it made)
      braked = Math.max(0, braked - dt);
      armLeft = Math.max(0, armLeft - dt);
      const want = braked > 0.45 ? (W.nose * Math.PI) / 180 : 0;
      pitch += (want - pitch) * (1 - Math.exp(-(want > pitch ? 16 : 5) * dt));
    },
    pose(q) {
      // (the stop arm swings out while it brakes: the model's arm goes with its door, a crack of which is enough)
      if (braked > 0.2 || armLeft > 0) q.mouth = Math.max(q.mouth, 0.13);
    },
    arm(seconds) {
      armLeft = Math.max(armLeft, seconds);
    },
    flick() {
      return swiped;
    },
    swipe,
  };
  return boot;
}
