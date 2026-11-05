# The third review's probes

Plain Node against the real `src/`, loaded as `tools/moon/walk-check.mjs` loads it, each printing what it measured. They're the evidence for [docs/reviews/earth-pictures-2026-11-04.md](../../../docs/reviews/earth-pictures-2026-11-04.md), kept as they ran on 688c9de. They aren't maintained tools: rerun them as the pictures change, read what they print, and drop each once a real check covers it.

From the repo root: `node --no-warnings tools/moon/review3/<probe>`. `hooks.mjs`, `fake-storage.mjs` and `geo/common.mjs` are the shared setup (a fake `localStorage`, with a quota in characters in `common.mjs`).

| Probe | Finding | What it prints |
|---|---|---|
| `pole-roundtrip.mjs` | B1, its "done" | 20 blasts at 30 degrees saved, then one blast at a second place (60, 88.9, 89.9, 90 and Shackleton, -89.67), a reload: each place's texels before and after, and the blast's ms. About three minutes today, Shackleton's 119 s of it |
| `pole-cost.mjs` | B1 | By the map's latitude: pictures a tile and a blast walk, fold's ms, pictures after one blast |
| `pole-wipe.mjs`, `pole-session.mjs`, `geo/a-counts.mjs`, `geo/c-polar.mjs` | B1 | A blast by the pole against older paint; the same with no storage; walks by latitude and radius; Shackleton's first 3,000 pictures timed |
| `reach.mjs` | B1's box | A blast's reach by drop, and the sagitta of a box's edge by latitude |
| `keys-check.mjs` | P3 | The key each point gets against the pictures the walk visits, row by row: FAIL, 6 of 3,132 today (column 1440 five times, the exact pole once) |
| `geo/d-cap.mjs`, `geo/l-area.mjs`, `empties.mjs`, `geo/k-crater.mjs` | M1 | Breaths and minutes, by gear and height, until the first paint leaves the store; the paint in 600 pictures; the empty pictures; a crater-shaped breath |
| `geo/j-mega.mjs`, `geo/b-cost.mjs`, `geo/h-split.mjs` | M2, M4 | `fold`'s ms by radius and latitude, `pictureInto`'s ms a tile, `hasSaved` near the pole; where `fold`'s time goes |
| `geo/g-crash.mjs` | M3 | 151 breaths to the cap, then MEGA placements until one throws: `TypeError ... (setting 't')` at `GroundPaint.ts:946` |
| `geo/e-sizes.mjs`, `geo/f-quota.mjs`, `geo/f-quota-small.mjs` | The store | Coded sizes; the street and the Moon in a 5 M store and in a 1.3 M one |
| `geo/i-roundtrip.mjs` | P1, P2 | 200 breaths drawn live, then read back from the pictures on the same map and on one 30 km off |
