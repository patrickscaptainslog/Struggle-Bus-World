// The main.ts frame loop (flight / aim / splat parts), replicated in the same order for the offline harness. With a drive (makeGame's
// second argument), the turbo gears write Flight.turbo before each step, as Controls.preFlight does; a tap's barf is main.ts's own (Aim.tapOpts).
import * as THREE from 'three';
import { config } from '@src/config';
import { Flight } from '@src/game/Flight';
import { Splatter } from '@src/game/Splat';
import { Aimer, tapOpts, type Shot } from '@src/game/Aim';
import type { TurboDrive } from '@src/game/Turbo';
import { Comet } from '@src/game/Comet';
import { Lob } from '@src/game/Lob';
import type { City, BuildingRef } from '@src/world/City';

export interface Ev { t: number; ev: string; [k: string]: unknown }
export interface Game {
  flight: Flight; splatter: Splatter; city: City; t: number; events: Ev[]; squash: number; bellyUi: number;
  frame(dt: number, inp: { sx: number; sy: number; dragging: boolean }): void;
  /** shot: what fire() handed over, and where it comes down (its roof, its wall, the ground) */
  tap(): { fired: boolean; target: BuildingRef | null; glint: BuildingRef | null; shot: Shot; landing: { x: number; y: number; z: number }; wall: boolean };
  press(): void;
  glint(): BuildingRef | null;
  jetAt: number;
  aimer: Aimer;
  drive: TurboDrive | null;
}

export function makeGame(city: City, drive: TurboDrive | null = null): Game {
  const flight = new Flight();
  const events: Ev[] = [];
  let hitStop = 0;
  const g: Game = {} as Game;
  let breathTravel: number | null = null;
  let jet: { at: number; impact: number; target: number[] } | null = null;
  const fx = {
    geyser: (targets: THREE.Vector3[], hues: number[]) => {
      const S = config.splat;
      const fly = breathTravel ?? Math.max(0.05, S.impactDelay - S.inhale);
      jet = { at: g.t + S.inhale, impact: g.t + S.inhale + fly, target: [targets[0].x, targets[0].y, targets[0].z] };
      events.push({ t: g.t, ev: 'geyserScheduled', target: jet.target, hue: hues[0] });
    },
    impact: (b: any) => events.push({ t: g.t, ev: 'impact', pos: [b.pos.x, b.pos.y, b.pos.z], count: b.count, hue: b.spec.hue, r: b.spec.r, comet: !!b.comet }),
    bloom: (ref: BuildingRef, order: number, _n: number, hue: number, level: number) => { if (order === 0) events.push({ t: g.t, ev: 'primary', index: ref.index }); (g as any).onBloom?.(ref, hue, level); },
    primary: () => {},
    hitStop: (f: number) => { hitStop = f / 60; events.push({ t: g.t, ev: 'hitstop', f }); },
    miss: (pos: THREE.Vector3, hue: number) => events.push({ t: g.t, ev: 'miss', pos: [pos.x, pos.y, pos.z], hue }),
  };
  const splatter = new Splatter(city, fx as any);
  const aimer = new Aimer(city, splatter);
  // (the Comet's lens is the caller's: the probe sets its own, tools/controls-sim/s_shots.ts)
  aimer.comet = new Comet(city, splatter);
  // (the Lob on the Comet's odometer, as main.ts makes it; its lens the caller's too)
  aimer.lob = new Lob(city, splatter, aimer.comet);
  splatter.onLateMiss = () => {
    if (flight.barfT >= 0) flight.refund = config.splat.missRefund;
    else flight.fullness = Math.max(flight.fullness, config.splat.missRefund);
  };
  let squashV = 0;
  Object.assign(g, {
    flight, splatter, city, t: 0, events, squash: 1, bellyUi: 1, jetAt: -1, aimer, drive,
    frame(dt: number, inp: { sx: number; sy: number; dragging: boolean }) {
      if (hitStop > 0) { hitStop -= dt; dt = 0; }
      g.t += dt;
      drive?.update(dt, flight);
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      // (each step knows its frame, as main.ts's do: a hit's throw is held to so much lift a frame)
      const si = { ...inp, frame: dt };
      for (let i = 0; i < steps; i++) flight.step(dt / steps, si, city);
      for (let i = 0; i < steps; i++) { const h = dt / steps; const bt = flight.barfT - (steps - 1 - i) * h; const sqTarget = flight.barfing && bt >= 0 ? (bt < config.splat.inhale + 0.03 ? 0.78 : 1.06) : 1; squashV += ((sqTarget - g.squash) * 260 - squashV * 16) * h; g.squash += squashV * h; }
      g.bellyUi = flight.barfT >= 0 ? flight.belly : flight.fullness;
      aimer.update(flight, g.t, inp.dragging);
      splatter.update(dt);
      if (jet && g.t >= jet.at) {
        events.push({ t: g.t, ev: 'geyser', target: jet.target, travel: jet.impact - g.t });
        g.jetAt = g.t;
        jet = null;
      }
    },
    tap() {
      const shot = aimer.fire(flight);
      const shown = shot.target;
      const landing = { x: shot.x, y: shot.y ?? (shot.target ? city.roofAtPart(shot.target, shot.x, shot.z, flight.y) + 0.5 : city.groundAt(shot.x, shot.z)), z: shot.z };
      if (!flight.tryBarf()) return { fired: false, target: null, glint: shown, shot, landing, wall: shot.exact };
      g.squash = 0.8; squashV = 0;
      breathTravel = shot.travel;
      splatter.barf(shot.x, shot.z, tapOpts(shot, flight.y));
      breathTravel = null;
      if (splatter.lastMiss) flight.refund = config.splat.missRefund;
      return { fired: true, target: shot.target, glint: shown, shot, landing, wall: shot.exact };
    },
    press() { aimer.press(); },
    glint: () => aimer.shown(),
  });
  return g;
}
