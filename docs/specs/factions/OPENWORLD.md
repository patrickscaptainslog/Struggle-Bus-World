# The areas engine in the open world

STUDIO.md part 7, #11 ("The areas engine drives the open world's squares, saved; replaces `liftRules.ts`"), the second account's half. 2026-11-15. Cut from `feat/link` (the save it writes through is `docs/specs/core/LINK.md`).

`src/factions/cityAreas.ts` is the real `areas.ts` on every square of the city, saved. `node tools/areas/check.mjs` holds it (seven rows, no browser).

## What it is

`new CityAreas(save, realm, { now, ground })`:

- `save` is the city's save (`loadSave(backend).save`, LINK.md 5.4), with `CityAreas.adoptOld(save, localStorage.getItem('strugglebus.areas.v1:sf'))` once on a phone's first run of it.
- `realm` is the neighbourhood table (`new Neighbourhoods(parseHoods(...))`), for each square's top stage. No god ever rises here (the gods are stopped); a god a save holds rests at the Lift.
- `now` is `Date.now` (the save's `rev`, a square's `tended`); `ground(key)` a loaded tile's anchor for a square, or null.

It answers `liftRules.ts`'s `TakeRules` call for call: `all`, `topOf`, `get(key)`, `seed`, `ready`, `peek`, `hit`, `outcomeOf`, with the stand-in's outcome type. A file that types the Lift's `rules` as `Pick<TakeRules, 'all' | 'topOf' | 'get' | 'seed' | 'ready' | 'peek' | 'hit' | 'outcomeOf'>` takes a `CityAreas` with no other change (type-checked here against `liftRules.ts` as it is on this branch). On the staged block (`?lift`'s seeds) every hit gives the same outcome and the same square as the stand-in: the `parity` row, 25,290 hits.

## Where it differs from the stand-in

1. **Every square answers.** The stand-in answered only seeded squares and gave null elsewhere ("the normal game"). Here a grey square's hit is a claim, and `hit` and `peek` never give null. What the Lift draws for a square it did not stage is the first account's half of #11.
2. **A change shows on the beat.** `at` is the engine's booked beat (two a second across the city, at most a bar late), where the stand-in gave `t`.
3. **Everything is saved but the staged block.** Every counted change, every encore, every spill goes to the save through `touch`. `seed` is the demo's and is never saved.
4. **`hit` also gives `taken`**: the note of a postcard whose own square the player just took back (`noteTaken`), for TAKEN and for the reply's `answers`.
5. **`spill(x, z, faction, t)`** is the blast's spill on a square it isn't aimed at, saved.

## What the host calls

| When | Call |
|---|---|
| a tile has loaded | `city.tileIn(squares, frame)`: anchors, and the phone's old building paint on squares with no record (save.ts's `landTile`). Redraw what it returns |
| a postcard has landed (`openLink` gave `flyby`) | `city.land(landing)`: its squares come into the engine held, parrying a rival and giving the card's crew only encores, until the Flyby shows them |
| a Flyby beat has shown a square | `city.release(key)`; `city.release()` for all when the Flyby is over or skipped |
| on a change's debounce, `pagehide`, and when a tab comes back into view | `const f = flush(city.save, backend, Date.now()); city.absorb(f.save, changedSquares(city.save, f.save))`, then redraw what `absorb` returns |
| the faction button | `setCrew(city.save, crew, Date.now())` (save.ts), and redraw the squares it returns |

## What ran

`node tools/areas/check.mjs` on this commit ("areas: all passed"):

| Row | What it holds |
|---|---|
| `parity` | 25,290 hits in 600 games on staged blocks: every outcome and every square the same as `TakeRules` (claim, parry, crack, flip, encore, up, heal, none, down all came up); nothing of the staged block saved |
| `saved` | 300 games on the real map, 27,503 counted changes (hits four a second, spills, Bomb jumps): after every hit the save's squares are byte for byte the engine's own `encode()`; a new page's engine read from the stored text is the same, every square ready |
| `cards` | 200 postcards on blocks the player had painted (a third of the player's own crew): their squares come in at the card's stages, held (the player's hit parries, the card crew's is an encore, nothing changes) until released; then the player takes the card's own square back hit by hit (crack, down, flip) and the card is marked taken, 200 of 200 |
| `tiles` | 100 places, three tiles each with old paint on half their squares: engine and save agree, and every order the tiles load in (one loading twice) gives the same engine |
| `tabs` | 150 runs of two tabs on one store, flushes at any time, each flush's changes taken in: one save and one engine at the end, and each engine is its save |
| `gods` | 12 neighbourhoods held whole at the Lift: the plain engine raises a god at each heart, this one none; a god a save holds rests at the Lift and a rival takes it as any Lift square |
| `old` | the save before this one comes in under every newer record |

## Not done, not checked

- **Nothing is wired.** `Lift.ts`, `main.ts` and the drawing of a square nobody staged are the first account's half (3 days in STUDIO.md). Nothing ran in a browser.
- **The engine's anchor** (`Area.ax`, `az`, `ay`) is copied from the save's record where a tile has given one, and is 0, 0, 0 where none has, as `areas.ts` makes it. The save keeps its own anchor through every change (`touch`), so the save is right either way; whatever draws from the engine's anchor should check the save's `ay` for "no tile has said yet".
- **Safe save (#13)** is the next: the same `flush`, with IndexedDB behind `SaveBackend`.
