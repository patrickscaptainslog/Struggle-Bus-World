import type * as THREE from 'three';
import type { BusModel } from '../bus/BusModel';
import { Ramp } from '../render/palette';
import { FACTION_RAINBOW, FACTIONS } from './factions';

// The bus wears its crew (the producer, 2026-11-13, flying ?show: "Why does my bus not change faction style when I change teams? It only changes the shot
// color/style"). On a page with the faction button (game/crew.ts), what was school-bus yellow on the bus takes its crew's row (FACTIONS' `bus`, the rival
// crews' buses' rows), and nothing else changes: the stripes, the glass, the wheels, the lights, the stop arm. Rainbow's is the yellow it always had.
//
// A switch floods the new colours in from the nose to the tail in half a second, in 30 steps, as a hit floods the bus in its hitter's (rivalsBoot's flood);
// a switch in the middle of one floods over what each part shows then. Only the values of the model's own `ramp` attribute change, as the rivals' flood and
// their buses' bodies do: no material, uniform or program is new, so nothing compiles in flight.
//
// A rival's hit floods the bus in the hitter's colours and drains back to the literal yellow (rivalsBoot's hitFx). This follows that flood from what the
// rivals show anyone (counts.flung, out, rivalScreen's times): inside its front nothing is written, so the hitter's colours show, Rainbow's yellow too; outside
// it a part reading yellow, or what was last written here, takes the crew's row again in the same frame, before the render. A part holding anything else is
// the flood's.
//
// The page makes one only where the button is (crew.on): without it nothing here runs and nothing is written. frame() runs after the rivals' frame.

/** a switch's flood, nose to tail (s), and its steps */
const SWEEP = 0.5;
const STEPS = 30;
/** a bus not framed for this long (ms) isn't on screen (the page's other bus has the frame: the flight's, above 15 km): a switch then is taken at once */
const UNSEEN_MS = 300;

/** What the rivals show of a hit on the player's bus (rivalsBoot's RivalsGame: counts, out, and rivalScreen's flood and drain times). */
export interface RivalsSeen {
  readonly counts: Record<string, number>;
  readonly out: boolean;
  readonly screen: { readonly flood: number; readonly drain: number };
}

/** A faction's body row: FACTIONS' `bus`, Rainbow's yellow for none or a later build's. */
export const busBodyOf = (faction: number): number => Ramp[(FACTIONS.find((f) => f.id === faction) ?? FACTIONS[FACTION_RAINBOW - 1]).bus];

export class CrewBus {
  /** the crew it wears (or is flooding to) */
  faction = FACTION_RAINBOW;
  private readonly ra: THREE.BufferAttribute;
  /** the body's parts: the vertices built yellow, their z (the nose is -z), and what each was last written (or would show, out of a flood) */
  private readonly idx: Uint32Array;
  private readonly z: Float32Array;
  private readonly mine: Float32Array;
  private readonly from: Float32Array;
  /** over every vertex, as the rivals' flood measures it */
  private readonly zMin: number;
  private readonly zMax: number;
  private to: number = Ramp.BUS_YELLOW;
  /** the switch's start (game s): -Infinity for none, NaN for one starting on the next frame */
  private at = -Infinity;
  private now = 0;
  /** a rival's flood as it shows: when it began, when its drain does */
  private flood: { at: number; drainAt: number } | null = null;
  private flung = 0;
  /** the rivals' hits as counted just before their frame (pre()) */
  private flungPre = 0;
  private wasOut = false;
  private shown = -1;
  private version = -1;
  /** the wall clock (ms) of the last frame() */
  private framedAt = -Infinity;
  /** how many times the attribute was written (QA) */
  writes = 0;

  constructor(bus: BusModel) {
    const geo = bus.mesh.geometry;
    this.ra = geo.getAttribute('ramp') as THREE.BufferAttribute;
    const pa = geo.getAttribute('position') as THREE.BufferAttribute;
    const body: number[] = [];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < this.ra.count; i++) {
      if (this.ra.getX(i) === Ramp.BUS_YELLOW) body.push(i);
      const z = pa.getZ(i);
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
    this.idx = Uint32Array.from(body);
    this.z = Float32Array.from(body, (i) => pa.getZ(i));
    this.mine = new Float32Array(body.length).fill(Ramp.BUS_YELLOW);
    this.from = new Float32Array(body.length).fill(Ramp.BUS_YELLOW);
    this.zMin = lo;
    this.zMax = hi;
  }

  /** The crew: flooded in from the next frame on (`now`: at once, as a page starts with its pick, and so while nobody sees this bus: no flood waits for
   *  the next hand-over, to replay there from the old colours). */
  set(faction: number, now = false): void {
    this.faction = faction;
    this.to = busBodyOf(faction);
    this.from.set(this.mine);
    this.at = now || performance.now() - this.framedAt > UNSEEN_MS ? -Infinity : NaN;
    this.shown = -1;
  }

  /** Each frame, just before the rivals' frame: what they have counted so far, so frame() can tell a hit made inside their frame. */
  pre(rivals: RivalsSeen): void {
    this.flungPre = rivals.counts.flung ?? 0;
  }

  /** Each frame, after the rivals' (game s), before the render. */
  frame(t: number, rivals: RivalsSeen | null = null): void {
    const prev = this.now;
    this.now = t;
    this.framedAt = performance.now();
    if (Number.isNaN(this.at)) this.at = t;
    // (a rival's flood: it starts when theirs does, so the two fronts agree. A hit made inside the rivals' frame (a ram's, from sim.step) starts at this
    // frame's time; one made between their frames (a shell's) at the last frame's. A front here behind theirs would write a Rainbow hitter's yellow over and
    // leave it so; one ahead of it leaves yellow showing between the two. The throw's end starts its drain 0.4 s on, as rivalsBoot's hitFx)
    let fk = -1;
    let reach = -Infinity, gone = Infinity;
    if (rivals) {
      const n = rivals.counts.flung ?? 0;
      if (n !== this.flung) {
        this.flung = n;
        this.flood = { at: n !== this.flungPre ? t : Math.min(prev, t), drainAt: Infinity };
      }
      if (this.wasOut && !rivals.out && this.flood) this.flood.drainAt = t + 0.4;
      this.wasOut = rivals.out;
      const fl = this.flood;
      if (fl) {
        const k = Math.min(1, (t - fl.at) / rivals.screen.flood), kd = Math.max(0, Math.min(1, (t - fl.drainAt) / rivals.screen.drain));
        const span = this.zMax - this.zMin;
        reach = this.zMin + k * span;
        gone = this.zMax - kd * span;
        fk = Math.round(k * 30) + Math.round(kd * 30) * 31;
        if (kd >= 1) this.flood = null;
      }
    }
    const step = Math.min(STEPS, Math.max(0, Math.floor(((t - this.at) / SWEEP) * STEPS)));
    const key = step + (fk + 1) * (STEPS + 1);
    if (key === this.shown && this.ra.version === this.version) return;
    this.shown = key;
    const front = this.zMin + (step / STEPS) * (this.zMax - this.zMin);
    const ra = this.ra, to = this.to;
    let wrote = false;
    for (let j = 0; j < this.idx.length; j++) {
      const z = this.z[j];
      const want = step >= STEPS || z <= front ? to : this.from[j];
      // (under a rival's flood: the flood's, as it shows)
      if (z <= reach && z < gone) continue;
      const i = this.idx[j], cur = ra.getX(i);
      if (cur !== Ramp.BUS_YELLOW && cur !== this.mine[j]) continue;
      this.mine[j] = want;
      if (cur !== want) {
        ra.setX(i, want);
        wrote = true;
      }
    }
    if (wrote) {
      ra.needsUpdate = true;
      this.writes++;
    }
    this.version = ra.version;
  }

  /** QA: the crew, the row it floods to, how far the switch is (0-1), whether a rival's flood is on, and how many parts are the body's */
  qa(): { faction: number; ramp: number; sweep: number; at: number; flood: boolean; parts: number; writes: number } {
    const k = Number.isNaN(this.at) ? 0 : Math.min(1, (this.now - this.at) / SWEEP);
    return { faction: this.faction, ramp: this.to, sweep: k, at: this.at, flood: this.flood !== null, parts: this.idx.length, writes: this.writes };
  }
}
