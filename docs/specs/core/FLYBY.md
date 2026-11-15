# The Flyby's event stream

STUDIO.md part 7, #14 ("The link carries outcomes: the Flyby beside you, tiles first, the swoop, the dealt crew, the friend's square kept, the takeover and TAKEN, replayed links start at home"), the second account's part: the event stream and the start of a link opened again. 2026-11-15. Cut from `feat/areas`.

`src/link/flyby.ts`. `node tools/link/flyby-check.mjs` holds it (three rows, no browser).

## What a landing plays

STUDIO.md part 3, B: "150 m over your street, the city grey. The thumb flies at once. The friend's block lifts again beside you in 3 s, replayed from what the link carries. Its 9 tiles first; the replay beside you, never before you."

`flybyPlan(landing, t0)` turns save.ts's `openLink` landing into timed events. `t0` is the game time when the card's 9 tiles (save.ts's `nineTiles`) are in and the thumb is flying, so the replay never plays before the player is there.

| Event | When | The host |
|---|---|---|
| `start` | `t0` | the block is seen grey |
| `fall` | just before a square's first beat, where something stood (`was`) | what stood there goes |
| `beat` | from `t0 + 0.6 s`, one after another in the card's own order, spread over 2.4 s at most (0.35 s apart at most) | the square reaches `stage` in the card's colours |
| `release` | 0.4 s after a square's last beat | `city.release(key)` (feat/areas): the engine has the square from now |
| `done` | after the last release | `city.release()` |

So the whole replay is 3 s from `t0`, 3.4 s with the last square let go. A card of today's place plays its ghost the same way, with nothing released (nothing was written). A card opened again, a place alone, the door: no Flyby.

The numbers are `flybyTune`, the studio's to tune on the phone.

## A link opened again

STUDIO.md part 3, B, "The next day: the same link again skips the Flyby and starts over your own floating blocks, with theirs in view."

`startOver(save, landing, crew)` is the square the bus starts over when `openLink` says `seen` or `own`: the player's own highest block within 12 squares of the card's own square, the nearest of those; else the card's own square. A card's squares, a rival's and a god's are never it.

## Not this

The swoop, the start pose beside the block, the camera, the sounds and what each event looks like are the first account's (five days of #14 in STUDIO.md). The dealt crew, the friend's square kept, the takeover and TAKEN are in save.ts (`docs/specs/core/LINK.md` section 6) and cityAreas.ts (`docs/specs/factions/OPENWORLD.md`).

## What ran

`node tools/link/flyby-check.mjs` ("flyby: all passed"):

| Row | What it holds |
|---|---|
| `plan` | 2,000 postcards of up to 16 squares, landed by the real `openLink` over the player's own paint and a rival's, then played through the real engine as the host would: every Flyby plays the card's own beats in its order, each square falling from what stood there (11,286 falls) and climbing its stages one by one, held in the engine until its one release after its last beat; the last beat 3.00 s after the start at most (70,065 beats); after it the engine and the save are one |
| `others` | a score's ghost (its beats; nothing falls, nothing is released); a card opened again, the door and a place play none |
| `home` | 500 phones with a link opened again: the bus starts over the player's own highest block near the card's, never a card's, a rival's or a god's square, else over the card's own |
