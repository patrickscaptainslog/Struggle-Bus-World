# Life's graphs for San Francisco (feat/world, 08849a6 to 5eba314)

The second account, 2026-11-05, on the first account's graphs: `tools/bake/graphs.py` and `decks.py`, `src/world/lifeData.ts`, `tools/world/graph-check.mjs`, the 195 `g_<rx>_<rz>.bin`, `routes.bin`, `gkeys.bin` and `city.json`'s life block. A first reading, the part life reads first; a second follows before life builds on the files.

## How it ran

- **W1, run here**: `node tools/world/graph-check.mjs sf` in a checkout of 5eba314: passed, exit 0, every count as GRAPHS.md reports it. 11,314 portal nodes, each with its twin, 0 cm apart; 264,235 keys, none twice within a kind; one-way edges 18,680 against the bake's 18,680; land within 0.447 m of the grid at worst; water at `WATER_Y` within 0 mm; ferries on water, 0 samples on land; every route's end within 150 m of its terminal; OPEN_WATER on the sea alone.
- **Read in full**: `lifeData.ts`, the parsers life will call.
- **Not read line by line**: `graphs.py` and `decks.py` (2,343 lines). Spot-read: the magics, and where GRAPHS.md says the bake departs from the plan.

## What's built to the 0.5 contract

feat/world merged `feat/earth` at 77d212c, the contract at 0.5, and builds each of GRAPHS.md's changes "as each item says, until Agreed". C1 to C7 were Agreed at 0.6 (83f7794, `CONTRACT.md` section 10) and C8 at 0.7 (this morning, on reading 5eba314). So these are the next step, not faults, and two show in the files today:

- **C2, the decks.** W1's own print: 4,464 deck samples within 15 m of a landmark deck, median 9.4 m off its top, 90th percentile 21.9 m, worst 37.1 m (mean -8.2 m). A car on the Golden Gate or the Bay Bridge would sink into the drawn deck or float over it. With C2 built, W1's deck count is a pass at 0.3 m.
- **C7, the magics.** `routes.bin` is still `SBR1` (`graphs.py:1846`, `lifeData.ts:75` and its header comment), the region bundles' and `far16.bin`'s, so a bundle handed to `parseCityRoutes` passes its magic. `SBC1` from 0.6.
- C1, C3, C5, C6 and C8: as GRAPHS.md says each does until Agreed. Life needs C5 (map metres from `parseCityRoutes`) and C6 (`NO_CARS`) first, for ferries and cars.

## lifeData.ts

Sound: every typed array is taken on 4- or 2-byte offsets the writer pads to; counts are checked against the sections they index (`shape[ne] === np`, `tri[na] === nt`, every edge's ends and every triangle's vertices in range); a short file throws inside the `try` and comes back null. Two nits:

- **N1.** `parseCityRoutes` makes a route's `Float64Array(m)` from its count before reading any of it, so a corrupt `m` can ask for gigabytes (up to 2^32 eight-byte values a column) before the read that would fail. Fix: check `o + m * 8 <= buf.byteLength` first, and the same for each count it loops on.
- **N2.** `parseRegionGraph` checks `tri[na] === nt` but not that `tri` only goes up, where it checks `shape` (`shape[i] > shape[i + 1]`). A file with a step down hands life an area whose triangles run off `areas.xyz`. Fix: the same check for `tri`.

## For the first account

Merge `feat/earth` for the contract at 0.7, then C1 to C8 as Agreed; W1's deck count as a pass at 0.3 m with C2. Life starts on ferries (routes, terminals, map metres: C5) and boats (marinas, OPEN_WATER at its height: C8) once those are in the files.
