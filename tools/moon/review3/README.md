# The third review's probes

Plain Node against the real `src/` (but for `gpu/`, below), loaded as `tools/moon/walk-check.mjs` loads it, each printing what it measured. They're the evidence for [docs/reviews/earth-pictures-2026-11-04.md](../../../docs/reviews/earth-pictures-2026-11-04.md), kept as they ran on 688c9de. They aren't maintained tools: rerun them as the pictures change, read what they print, and drop each once a real check covers it.

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
| `gpu/m4-attach.mjs <build dir> <port>` | M4, on the GPU | A strip of Tycho painted and saved, the page again, the strip flown into at Jet in real time, and the same flight over ground never painted: frame times, long tasks, each `pictureInto` and `attach`, every frame over 50 ms with the copies in it |
| `gpu/m2-fold.mjs <build dir> <port>` | M2, on the GPU | The street's breath height and drop, then five full MEGAs from 600 m and five breaths on the Moon in real time: each `fold`'s ms, the longest task and frame after each |
| `gpu/recheck.mjs <build dir> <out dir>` | The second review's long frames | Its real-time runs as they ran for it and again quiet for this one (its paths made relative): `?earth`'s climb through the hand-over, the plain Earth low down, the Moon at Turbo 3 for five minutes, then the repo's browser tools, into one JSON. It cuts each tool's tail lines at 220 characters |

`gpu/` runs in a browser on a real GPU, in real time on the game's own clock, so it's for a laptop, not the cloud. Each probe serves the build it's given: `npx vite build --outDir ../sb-build` at the reviewed commit. `gpu/common.mjs` is the harness of the first two, which reaches the build's `GroundPaint` at `window.__game.city.ground` and wraps its methods by name (the minifier keeps them).
