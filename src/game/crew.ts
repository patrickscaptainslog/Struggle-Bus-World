import { FACTION_MAX, FACTION_RAINBOW } from './factions';

// The testers' faction button (docs/specs/shots/SHOTS.md, "MEGA off, and the faction button"; the producer, 2026-11-06: "i want an easy way to change factions - a
// button, just for my friends and myself to easily test the factions"). A page whose link carries ?crew (or &crew) turns it on for that phone for good, and the
// faction picked with it is remembered there too. Without ?crew ever seen, nothing changes: every splat is Rainbow's, as before.
//
// This is the player's faction's one source (game/factions.ts: Splatter.faction and MoonPaint.faction, each a painter's own): main.ts and the flight
// (sky/moonrun.ts) set their painters from `faction` and again on every change, so a switch takes the next shot, and paint already down keeps its owner.
// The HUD's crest (ui/Hud.ts) is what a player touches. `locked` greys it out: Recess sets it for a match ("In Recess, it works only between matches").
//
// No three.js; the DOM only for localStorage, every read and write in a try.

const KEY = 'strugglebus.crew.v1';

type Listener = (faction: number) => void;

class Crew {
  /** the button shows on this phone (a page here has seen ?crew) */
  on = false;
  /** the player's faction: Rainbow until a tester picks another */
  faction = FACTION_RAINBOW;
  /** a match is on (Recess): the crest shows, dimmed, and opens nothing */
  locked = false;
  private readonly listeners: Listener[] = [];
  private read = false;

  /** Reads the phone's choice once, and turns the button on for good if this link says ?crew. */
  init(params: URLSearchParams): this {
    if (!this.read) {
      this.read = true;
      try {
        const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { on?: unknown; faction?: unknown } | null;
        if (v && v.on === true) {
          this.on = true;
          const f = v.faction;
          if (typeof f === 'number' && Number.isInteger(f) && f >= FACTION_RAINBOW && f <= FACTION_MAX) this.faction = f;
        }
      } catch {
        // (storage blocked: the button shows on ?crew pages only, and picks last this page)
      }
    }
    if (params.has('crew') && !this.on) {
      this.on = true;
      this.save();
    }
    return this;
  }

  /** Switch: everyone listening sets their painters now. */
  set(faction: number) {
    if (!Number.isInteger(faction) || faction < FACTION_RAINBOW || faction > FACTION_MAX || this.locked) return;
    const was = this.faction;
    this.faction = faction;
    this.save();
    if (faction !== was) for (const l of this.listeners) l(faction);
  }

  /** Called with every switch (not now: the caller reads `faction` for its start). */
  listen(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      const i = this.listeners.indexOf(l);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ on: this.on, faction: this.faction }));
    } catch {
      // (storage blocked: this page only)
    }
  }
}

/** The one per page: the street and the flight share it. */
export const crew = new Crew();
