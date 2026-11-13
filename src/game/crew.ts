import { FACTION_MAX, FACTION_RAINBOW } from './factions';

// The testers' faction button (docs/specs/shots/SHOTS.md, "MEGA off, and the faction button"; the producer, 2026-11-06: "i want an easy way to change factions - a
// button, just for my friends and myself to easily test the factions"). A page whose link carries ?crew (or &crew) turns it on for that phone for good, and the
// faction picked with it is remembered there too. Without ?crew ever seen, nothing changes: every splat is Rainbow's, as before. ?crew=off forgets it all on
// that phone: no button, and the bus paints as Rainbow again (paint already down keeps its owner). ?crew=show (what ?show's one link writes, index.html) turns
// it on for that page only, and nothing picked there is saved on the phone: the plain link after it is as it was. What is picked there lasts the tab
// (sessionStorage), so the Moon's page change (sky/moonrun.ts, location.replace with show kept) and the way home keep it, and a new tab starts again.
//
// This is the player's faction's one source (game/factions.ts: Splatter.faction and MoonPaint.faction, each a painter's own): main.ts and the flight
// (sky/moonrun.ts) set their painters from `faction` and again on every change, so a switch takes the next shot, and paint already down keeps its owner.
// The HUD's crest (ui/Hud.ts) is what a player touches. `locked` greys it out: Recess sets it for a match ("In Recess, it works only between matches").
//
// No three.js; the DOM only for localStorage, every read and write in a try.

const KEY = 'strugglebus.crew.v1';
/** ...and a ?crew=show page's pick, for the tab only */
const SHOW_KEY = 'strugglebus.crew.show.v1';
const isFaction = (f: unknown): f is number => typeof f === 'number' && Number.isInteger(f) && f >= FACTION_RAINBOW && f <= FACTION_MAX;

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
  /** the phone keeps what this page picks (not on a ?crew=show page) */
  private keep = true;

  /** Reads the phone's choice once, and turns the button on for good if this link says ?crew, or off for good, back to Rainbow, if it says ?crew=off; on
   *  this page only if it says ?crew=show. */
  init(params: URLSearchParams): this {
    if (!this.read) {
      this.read = true;
      try {
        const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { on?: unknown; faction?: unknown } | null;
        if (v && v.on === true) {
          this.on = true;
          const f = v.faction;
          if (isFaction(f)) this.faction = f;
        }
      } catch {
        // (storage blocked: the button shows on ?crew pages only, and picks last this page)
      }
    }
    if (params.get('crew') === 'off') {
      this.on = false;
      this.faction = FACTION_RAINBOW;
      try {
        localStorage.removeItem(KEY);
      } catch {
        // (storage blocked: nothing was kept)
      }
    } else if (params.get('crew') === 'show') {
      this.on = true;
      this.keep = false;
      try {
        const f = JSON.parse(sessionStorage.getItem(SHOW_KEY) ?? 'null') as unknown;
        if (isFaction(f)) this.faction = f;
      } catch {
        // (storage blocked: this page's pick, this page only)
      }
    } else if (params.has('crew') && !this.on) {
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
    if (!this.keep) {
      try {
        sessionStorage.setItem(SHOW_KEY, JSON.stringify(this.faction));
      } catch {
        // (storage blocked: this page only)
      }
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify({ on: this.on, faction: this.faction }));
    } catch {
      // (storage blocked: this page only)
    }
  }
}

/** The one per page: the street and the flight share it. (The class for tools/swerve/s_show.ts, which needs a fresh one a page.) */
export { Crew };
export const crew = new Crew();
