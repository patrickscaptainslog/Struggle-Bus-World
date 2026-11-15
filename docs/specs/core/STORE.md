# The safe save

STUDIO.md part 7, #13 ("Safe save: the browser's database, changes only, `persist()` asked"), the second account's. 2026-11-15. Cut from `feat/link`: the save it keeps is `docs/specs/core/LINK.md` section 5.

`src/link/store.ts` keeps the city's save in the browser's own database (IndexedDB), a row a record, and writes only what changed. `node tools/link/store-check.mjs` holds it in a real browser: the machine's Chromium (or the laptop's Chrome, through `tools/browser.mjs`), its own IndexedDB and localStorage, pages of one site sharing them as tabs do.

## How the game uses it

```ts
const store = await SafeSave.open(city.slug);           // never throws
let save = (await store.load(Date.now())).save;          // the database's rows, joined with the journal the last page left
// ... play; then, on a change's debounce:
const w = await store.write(save, Date.now());           // only the rows that changed, each joined with the database's
city.absorb(save, w.changed);                            // (feat/areas) what another tab had that was later
// on pagehide, and visibilitychange to hidden:
store.journal(save, Date.now());                         // the whole save into localStorage, synchronously
// once, after the first paint is kept:
void store.persist();
```

`write` changes `save` in place: each row it writes is joined (save.ts's `joinRec`, `joinMark`, `joinNote`, and `joinSave` for the rest) with the row the database holds, in the same transaction, so two tabs never write over each other's work, and `save` ends with the later of each. `w.changed` is the squares that came out as another tab's.

## The database

`strugglebus.city.<slug>`, version 1, four stores, a row each:

| Store | Key | Row |
|---|---|---|
| `sq` | the square's key (a number) | its 24 bytes (LINK.md 5.1) |
| `lm` | a landmark's key in lower case | `[owner, stage, cracks, hits, tended, rev, card]` |
| `cards` | a card's id | the note as LINK.md's text holds it (11 fields) |
| `meta` | `meta` | the crew, the climbs and the cards known: the save's text's lines 5 to 7 |

"Changed" is measured against what this tab last read or wrote of each row. A row this tab never saw (another tab's) is joined in at the next `load`. A note `trim` lets go is deleted at the next write.

## When there is no database

Where IndexedDB can't be opened (no IndexedDB, one that throws, a database a newer build made at a higher version), the store is M1's save alone: `write` is save.ts's `flush` into localStorage (`strugglebus.city.v2:<slug>`). Where neither can be had it holds the city in memory and says so (`where` is `'db'`, `'journal'` or `'memory'`). A database that fails in the middle of a write drops to the journal for the rest of the page, losing nothing of that write. A connection the browser drops (iOS does, in the background) is opened again; one opened again after the database itself was lost (site data cleared under an open page) writes every row, not only the changed ones.

## The journal

On `pagehide` the whole save goes into localStorage, synchronously, joined with what is stored there (M1's `flush`). The next `load` joins it with the database's rows, and the next `write` puts whatever the journal had that the database lacked into the database. The journal is never deleted: it is M1's save too, and a second tab may still be writing it.

## `persist()`

Asks the browser to keep the site's data under storage pressure (`navigator.storage.persist()`), once it isn't kept already; true if it will be. False, never a throw, where the call fails or isn't there. Safari drops a site's data after seven days without a visit whatever is asked (WebKit's tracking prevention): that is season 2's server (STUDIO.md part 7, "Season 2"), not this.

## What ran

`node tools/link/store-check.mjs` on this machine's Chromium ("store: all passed"):

| Row | What it holds |
|---|---|
| `round` | 25 random saved cities (up to 800 squares, landmarks, sent and opened cards, the crew, climbs, cards known) written into the database and read back the same by another tab, with nothing in localStorage |
| `changes` | only what changed is written: 498 rows for a city of 491 squares at first, 0 when nothing changed, 2 for one square changed (the square and the climbs), 2 for a card sent (its note and the cards known) |
| `tabs` | 12 runs of two tabs on one database, 60 steps each, writes at any time: a third tab reads one city, and every square's latest change stands |
| `journal` | a page that goes with 40 changes unwritten leaves them in the journal; the next page reads them, writes them into the database (40 rows), and they are there with the journal gone |
| `fallback` | no database, a database that throws, a database a newer build made: M1's save, the city kept across pages; with no localStorage either, memory, never a throw |
| `atomic` | a write of 20,000 squares cut off by the page closing: the next page reads the old city whole, with nothing it can't read |
| `persist` | asked once, true where kept, false where it fails or isn't there |
| `reconnect` | the database deleted under an open page: the next write writes every row (104 for 100 squares) and the next page reads the whole city |

## Not done, not checked

- **Not wired.** Where `main.ts` opens it, when it writes (the debounce) and when it asks `persist()` are the first account's.
- **Not run on Safari.** Chromium's IndexedDB is not WebKit's. The rows want running once on the phone (a page that runs this check's scenarios), and on the non-Pro iPhone with the bench.
- **Sizes.** A city of 20,000 squares is about 480 KB of rows and 640 KB of journal text; nothing here caps either.
