// The Flyby's event stream (STUDIO.md part 3, B, and part 7, #14): what a postcard's landing (save.ts's openLink) plays, and when. The friend's block
// lifts again beside the player in about 3 s, replayed from what the link carries: each square falls from what stood there, then climbs its stages in the
// card's order, and is let go to the engine (cityAreas.ts's release) once its last stage has shown. It starts only once the card's 9 tiles are in and the
// thumb is flying: never before the player is there. A link opened again ("seen", "own") skips it and starts over the player's own floating blocks, with
// the card's in view (`startOver`). Pure: the host plays the events at their times and draws them.

import { linkTune } from './link';
import { packSquare, squareIx, squareIz } from './save';
import type { Landing, Rec, Save } from './save';

export const flybyTune = {
  /** s from the Flyby's start to its first beat: the block is seen grey first */
  lead: 0.6,
  /** s the beats are spread over, at most: "lifts again beside you in 3 s" */
  span: 2.4,
  /** s between two beats at most (a card of few stages doesn't crawl) */
  gap: 0.35,
  /** s after a square's last beat before the engine has it: its climb has landed */
  settle: 0.4,
};

/**
 * One event of the Flyby, at `t` (game s). `start` the replay begins; `fall` a square drops from what stood there (`was`), before its first beat;
 * `beat` a square reaches `stage` (its k-th beat is stage k); `release` the engine takes the square from here (cityAreas.release(key)); `done` the last.
 */
export interface FlybyEvent {
  t: number;
  kind: 'start' | 'fall' | 'beat' | 'release' | 'done';
  /** the square's index on the card, its key and place, for fall, beat and release */
  i: number;
  key: number;
  ix: number;
  iz: number;
  stage: number;
  /** what stood on the square before the card (fall only), null for nothing */
  was: Rec | null;
}

const event = (t: number, kind: FlybyEvent['kind'], i = -1, key = -1, stage = 0, was: Rec | null = null): FlybyEvent => ({
  t, kind, i, key, ix: key < 0 ? 0 : squareIx(key), iz: key < 0 ? 0 : squareIz(key), stage, was,
});

/**
 * The Flyby of a landing, from `t0`: the game time when the card's 9 tiles are in and the thumb flies. Empty unless the landing is a `flyby` or a
 * `score` (a score's ghost plays the same way, and its squares are released to nothing: none were written). Events in time order.
 */
export function flybyPlan(landing: Landing, t0: number): FlybyEvent[] {
  if ((landing.kind !== 'flyby' && landing.kind !== 'score') || !landing.beats.length) return [];
  const T = flybyTune, n = landing.beats.length, gap = Math.min(T.gap, n > 1 ? T.span / (n - 1) : 0);
  const out: FlybyEvent[] = [event(t0, 'start')];
  const byI = new Map(landing.landed.map((l) => [l.i, l]));
  const first = new Map<number, number>(), last = new Map<number, number>();
  landing.beats.forEach((b, j) => {
    const t = t0 + T.lead + j * gap;
    if (!first.has(b.i)) first.set(b.i, t);
    last.set(b.i, t);
  });
  // (each square falls just before its first beat: what was there goes, then the card's colours climb)
  for (const [i, t] of first) {
    const l = byI.get(i), key = l ? l.rec.key : keyOfBeat(landing, i);
    if (l && l.was) out.push(event(t - Math.min(T.lead, gap || T.lead) / 2, 'fall', i, key, l.was.stage, l.was));
  }
  landing.beats.forEach((b, j) => out.push(event(t0 + T.lead + j * gap, 'beat', b.i, packSquare(b.ix, b.iz), b.stage)));
  let end = t0;
  for (const [i, t] of last) {
    const l = byI.get(i);
    if (!l) continue; // (a score's ghost: nothing written, nothing to give the engine)
    out.push(event(t + T.settle, 'release', i, l.rec.key, l.rec.stage));
    end = Math.max(end, t + T.settle);
  }
  out.push(event(Math.max(end, t0 + T.lead + (n - 1) * gap + T.settle), 'done'));
  // (in time order; at one time: start, fall, beat, release, done)
  const rank = { start: 0, fall: 1, beat: 2, release: 3, done: 4 };
  return out.sort((a, b) => a.t - b.t || rank[a.kind] - rank[b.kind] || a.i - b.i);
}

function keyOfBeat(landing: Landing, i: number): number {
  const b = landing.beats.find((x) => x.i === i);
  return b ? packSquare(b.ix, b.iz) : -1;
}

/**
 * Where the bus starts on a link opened again (`seen`, `own`): over the player's own floating blocks, with the card's in view. The player's square of
 * the highest stage within `reach` squares of the card's own (the nearest of those, ties by key), else the nearest of the player's squares of any stage
 * there, else the card's own square. `crew` is the player's (save.ts's crewOf).
 */
export function startOver(save: Save, landing: Pick<Landing, 'key'>, crew: number, reach = 12): number {
  if (landing.key < 0) return -1;
  const cx = squareIx(landing.key), cz = squareIz(landing.key);
  let best = -1, bs = 0, bd = Infinity;
  for (const r of save.squares.values()) {
    if (r.owner !== crew || r.guest || r.stage > linkTune.top) continue;
    const d = Math.max(Math.abs(squareIx(r.key) - cx), Math.abs(squareIz(r.key) - cz));
    if (d > reach) continue;
    if (r.stage > bs || (r.stage === bs && (d < bd || (d === bd && r.key < best)))) (best = r.key), (bs = r.stage), (bd = d);
  }
  return best >= 0 ? best : landing.key;
}
