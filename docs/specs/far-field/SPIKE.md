# SPIKE: every block from the ceiling, in real game frames

**Status, 2026-11-01:** days 1 and 2 are live for San Francisco on the producer's phone verdict (`DECISIONS.md`, "The far field live for San Francisco"), on by default for any city with a `far16.bin`, with `config.far.on` and `?nofar` as kill switches, so section 0's "flags off by default" no longer holds. Days 3 to 5 are still to come: the downloads, the ridgelines (Marin, the East Bay), Ross and the phone sessions.

One spike, one worktree, five agent-days plus two producer phone sessions. It proves or kills the verdict's recommendation: that a small always-present raster of the whole city, plus merged boxes built on the phone, puts every block on screen from the ceiling with no visible pop as you descend, on an A15, inside the pixel grid and the palette, and that the same path draws a non-US city and a place with no buildings at all without a special case.

Labels as in VERDICT.md. Nothing below has run yet. Where a number is a threshold, it is my proposal and the spike may move it, with the reason written down.

**Read `../sky/SKY.md` §9 first; it overrides this file where they differ.** The game gets a real, moving sun and a real night, so far materials hold no baked light or shadow, the raster's tone is pre-light offsets, `height` and `class` stay on the client for the low-sun sweep, the clear-flag sky test lands before any `?farfade`, and the pass list gains one night frame. Branch from main once OpenStreetMap has merged, not from `feat/osm`.

**The scratchpad is gone.** An app restart on 2026-10-31 wiped it, so every `scratchpad/farfield/...` path below no longer exists: `lean/other_probe.py`, `systems/fetch_windows.py`, the REMA, LOLA, SLDEM and WAC windows, `earth-scripts/compress_probe.py`, and `audit/` and `art/`'s classifiers, `bands_sim.py`, `popscore.py`, `oklch.py` and `metrics.py`. The reports in this folder describe each method. Rewrite the small tools into `tools/far/` on the branch so they last, and re-fetch the windows. Keep nothing you need in a scratchpad.

---

## 0. Ground rules

- **Worktree:** `git worktree add C:/Users/Utku/sbw-farfield -b spike/farfield main` (main has the OSM city since cc7c14d: where this file says feat/osm, read main). Branch from `feat/osm`, because the 16 m raster must be baked from its OSM-classed tiles, its `far.bin` already carries 11 classes, and all three strategies measured on its data. Never check out, commit or stash in `sbw-main`, `Struggle-Bus-World` or `sbw-perf`. Main stays untouched; nothing merges from this branch without the producer's say.
- **Timing:** nothing starts until the GPU-performance workflow on this laptop is finished. The bake uses `C:/Users/Utku/sb-venv/Scripts/python.exe -I`. Downloads run at below-normal priority, overnight if they are slow (28-92 KB/s was measured today).
- **Flags, all off by default, all additive:** `?farmap` (raster on the far ground), `?farblocks` (boxes), `?farsurround` (raster on the horizon mesh), `?farfade` (fade 21-34 km, far plane 36 km), `?loadr=<m>` (override `LOAD_RADIUS_HIGH`, exposed through the tuner), `?body=<id>` (loads a Body stub; `earth` default). With no flag the game must render byte-identical frames to `feat/osm` (`tools/shotdiff.py` exit 0 on a `tools/shots.mjs --det` pair).
- **Rules that cannot bend:** camera snap and `sbWrite` untouched; every far pixel is written as a ramp index plus a step, never an RGB; class-to-ramp is a table (the one in `src/world/terrainMaterial.ts:61-72`, extended with ROOF and TREE); tone is filtered and quantised to a step last; `vRamp` becomes a `flat` varying; no new ramp may have a step with hue 30-85, lightness under 0.62 and chroma over 0.025 (art's working definition of brown); paint ramps are the only saturated thing.

---

## 1. Places and camera poses

Portrait 393 x 852, the game's own lenses. "Ceiling" is the game's ceiling (`config.flight.ceiling`, 520 m MSL), reached by `tools/altitude.mjs`'s climb; the logged pose is ~666 m above ground at the 38° vista lens, pitch 22°.

| Id | Place | Start query | Why |
|---|---|---|---|
| `sunset` | SF, Sunset District looking east | `?lat=37.7530&lon=-122.4950&heading=90&skipintro&nohud` | The worst view: 44,392 buildings in the wedge, 85 % absent today (MEASURED simulation); Golden Gate Park and Twin Peaks in frame |
| `presidio` | SF, Presidio looking south | `?lat=37.7990&lon=-122.4660&heading=180&skipintro&nohud` | 47,105 in the wedge, 89 % absent; Sutro and the Richmond grid |
| `downtown` | SF, Civic Center heading 45 (exists in `tools/altitude.mjs`) | `?lat=37.7700&lon=-122.4300&heading=45&skipintro&nohud` | The listed shot; the **East Bay** (Berkeley, Oakland) across the bay at 10-20 km |
| `marin` | SF, Presidio looking north-west | `?lat=37.8020&lon=-122.4650&heading=330&skipintro&nohud` | **Marin** Headlands and Mount Tamalpais at 5-20 km over the Gate; no footprints on the Headlands, Sausalito and Mill Valley behind |
| `london` | London, Hyde Park looking east | `?city=london&lat=51.5073&lon=-0.1657&heading=90&skipintro&nohud` | The non-US city. Today the 3.3 x 2 km frame ends in a sea plane; the City is 4-6 km away and Canary Wharf ~9 km, outside the bake |
| `ross` | Ross Island, Antarctica, over the ice shelf looking at Erebus | `?city=ross&body=antarctica&lat=-77.75&lon=167.30&heading=350&skipintro&nohud` | The place with no buildings at all in the wedge: Erebus 25 km ahead, Mount Terror to the right, McMurdo 15 km west and out of the 38° wedge |
| `theo` (optional) | Theophilus crater, Moon | `?city=theo&body=moon&lat=-11.4&lon=26.4&heading=0&skipintro&nohud` | Only if `ross` passes with a day to spare; the Body stub is the same code |

Captures at each: ~30 m, ~120 m, ~250 m and the ceiling (altitude.mjs's four shots), six-frame `--seq` bursts at cruise, 250 m and the ceiling, and the hold-dive-floor descent with its 0.1 s log.

---

## 2. Data to fetch, exactly

Everything is open, with its credit line to be added to `public/city/DATA_LICENSE.md` on the branch.

| Need | Source | Exact location | Size | Licence |
|---|---|---|---|---|
| SF city raster | The feat/osm tiles already on disk | `C:/Users/Utku/Struggle-Bus-World/public/city/sf/r_*.bin` (195 regions, 25.5 MB) and `far.bin` | 0 download | ODbL (already) |
| SF surround footprints (East Bay, Marin) | Overture 2026-10-21.0 buildings, by bbox through the cached footers | `s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/`, footers cached at `C:/Users/Utku/Struggle-Bus-World/tools/bake/.cache/overture/2026-10-21.0/footers/building.json`; method in `scratchpad/farfield/lean/other_probe.py` (geometry column only, ranged reads). Box 37.70-37.95 N, -122.60 to -122.15 E | ~100-300 MB of geometry (ESTIMATE: ~1 M buildings at ~140 B); overnight here | ODbL ([Overture attribution](https://docs.overturemaps.org/attribution/)) |
| London footprints to 12 km | Same | Box 51.35-51.65 N, -0.35 to 0.15 E | ~200-300 MB (ESTIMATE); overnight | ODbL |
| Land class | ESA WorldCover v200 2021 | `s3://esa-worldcover/v200/2021/map/ESA_WorldCover_10m_2021_v200_N36W123_Map.tif` (SF and the Bay), `..._N51W003_Map.tif` (London); 3° tiles named by SW corner, confirm names with a listing | tens of MB each window via COG ranged reads | CC BY 4.0 |
| Tone | ESA WorldCover Sentinel-2 10 m 2021 composite | bucket `esa-worldcover-s2`, RGBNIR product for the same tile names; key pattern per the [registry page](https://registry.opendata.aws/esa-worldcover-vito-composites/), confirm with `aws s3 ls --no-sign-request s3://esa-worldcover-s2/` | windows only, via COG ranged reads (the SF 10 km probe in `earth-scripts/compress_probe.py` is the pattern) | CC-BY 4.0 (re-fetched today) |
| Terrain for the surround | Copernicus GLO-30 | `s3://copernicus-dem-30m/Copernicus_DSM_COG_10_N37_00_W123_00_DEM/...DEM.tif` (Bay), `N51_00_W001_00` and `N51_00_E000_00` (London) | ~25 MB per tile | Free licence with the Art. 6(b) notice and the Art. 6(c) liability sentence ([licence PDF](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf)) |
| SF surround height | Already there | `public/city/sf/horizon.bin` (128 m, 190 KB) stays as the height; only class and tone are new | 0 | public domain (USGS) |
| Ross Island | Already on disk: three nested REMA v2.0 32 m windows | `scratchpad/farfield/systems/windows/rema_near.npy`, `rema_mid.npy`, `rema_far.npy` with their `.json` extents (7.2 MB); re-run `systems/fetch_windows.py rema` with a wider bbox if the pose falls outside | 0 | CC BY 4.0 ([AWS registry](https://registry.opendata.aws/pgc-rema/)) |
| Ross Island class | None needed for the spike: default ICE, rock where REMA slope > 25° or the Sentinel red band is dark (stand-in rule, as systems used) | | | |
| Moon (optional) | Already on disk | `systems/windows/lola.npy`, `sldem.npy`, `wac.npy` (6.3 MB) | 0 | public domain, cite |

Do not fetch: anything from Google, Bing, Mapbox, Cesium ion, EOX's newer mosaics, FABDEM or GlobalBuildingAtlas.

---

## 3. The bake step

`tools/bake/farmap.py` on the branch. Two modes, one output format.

**Format `SBR1`** (gzip like `horizon.bin`): `'<4s' magic, u32 W, u32 H, 6 x f32 affine (world x,z from cell i,j: x = a*i + b*j + c, z = d*i + e*j + f), u16 bodyId, u16 cellM`, then four planes of `W*H` bytes: `class` (0-10 as `Ground` in `src/world/tiles.ts`, 11 ROOF, 12 TREE, 13 ICE, 14 ROCK_BARE, 255 none), `tone` (0-255, mean brightness of what is on top, no cast shadow in it), `height` (building top above ground in 2 m steps, 0 none, 255 ≥ 508 m), `reserved` (0; paint later). The affine and body id are there so this file is already a tile of the planet tree and the shader never changes when tiles move to a cube grid.

**Mode A, from tiles** (`farmap.py sf --cell 16`): rasterise each region's footprints and heights onto a 16 m lattice over the baked frame (896 x 1104 for SF, MEASURED lean); `class` = the mode of the 2 m class texture plus roof where a footprint covers ≥ 50 % of the cell; `tone` = mean of the roof seed tone or ground class offset through the game's own light table at the fixed sun with **no cast shadow** (lean measured that baking shadow worsened the match on 3 of 4 poses); `height` = max roof height in the cell. Expected: under 20 s, 264 KB class+tone and 144 KB height for all SF (MEASURED lean §3.3). No rebake of regions.

**Mode A', what a grazing camera sees** (same run, second tone plane written as `tone` when `--oblique`): tone = area-weighted mix of roof tone and wall tone where the wall share is `min(1, height / cell)`; this is art's finding that a top-down raster swaps green yards for grey walls when tiles arrive. Bake both; the client flag `?farmap=oblique` picks it, and the hold-still swap test (§6) decides.

**Mode B, from the planet sources** (`farmap.py surround --city sf --cell 32 --bbox ...`): Overture footprints by bbox through the footer cache, WorldCover class by mode, composite tone by mean per class then rank-normalised per class across the window and quantised to 8 steps, GLO-30 height (SF keeps `horizon.bin`). Output `surround32.bin` in the same format over a ±32 km frame in the city's tmerc. Streets are not burned in (keeps the surface raster outside ODbL; built cover is ODbL already and lives in `class`/`height`). For London also write `far16.bin` over a ±12 km frame from the same inputs, so London gets bands 2-3 with heights from the ladder as it exists (tags, floors x 3.2 + 1, neighbours; the audit's numbers say 44 % of metro buildings carry a height).

**Mode C, a body stub** (`farmap.py body ross`): from the REMA windows write `public/city/ross/city.json` (origin -77.75, 167.30; `tileSize` 256; one empty region so `__shotReady` can go true, see §4), `far16.bin` and `surround32.bin` with class ICE by default, heights minus a single geoid offset of -53.5 m (the one McMurdo Sound sample, MEASURED; good enough for a spike), height steps of 0.25 m in the `height` plane's spare range, and a `body.json` (`radius 6371008`, `sea: null`, `air: true`, `sky: SKY_POLAR`, `sun: {alt: 14, az: 0}` fixed for the capture). The Moon stub is the same with `radius 1737400`, `air: false`, `sky: NIGHT_SKY`, `sun: {alt: 9}`.

Record: bake wall time, bytes per file, class histogram, tone histogram per class, the share of cells with a building and the share of those whose height came from a default (the QA line every city must carry).

---

## 4. The client change, behind the flags

All in `src/world/City.ts`, `src/world/terrainMaterial.ts`, `src/render/materials.ts`, one new worker, one new `Body` stub. No per-frame allocation; one texture upload per texture per frame.

1. **`flat` ramp** (always on, it is a bug fix): `out float vRamp` becomes `flat out float vRamp`, `in float vRamp` becomes `flat in float vRamp` in `makeRampMaterial`'s `VERTEX_RAMP` path (`materials.ts:318-326`). Verify by a `shotdiff` that only shore and contour fringes change.
2. **`?farmap`**: load `far16.bin` at boot next to `far.bin`; two R8 `DataTexture`s (class nearest, no mips; tone linear with mips and anisotropy) plus the affine as a uniform. The far terrain material (`City.buildFar`, `City.ts:318-366`) gets a fragment chunk: `class = texelFetch(uFarClass, cell)`, `ramp = classRamp[class]` (integer table), `lo = classLo[class] + (texture(uFarTone, uv).r - 0.5) * uToneK` with `uToneK` tunable (start 0.3), then the existing `sbWrite`. Where `class == ROOF` and `?farblocks` is off, the far ground still carries the roof tone, so every building exists as tone from day one. Water keeps its own path. Also sink far terrain cells by 40 m where `uMask` says a tile is loaded (vertex chunk, the same `texelFetch` the far boxes use at `City.ts:378-381`), which fixes the poke-through.
3. **`?farblocks`**: a worker receives the `height` plane, merges equal runs row by row into boxes at 16 m (lean's rule, 0.12 s for all SF in Python, MEASURED), returns `Float32Array` instance data per 4 km chunk; the main thread builds one `InstancedMesh` of a unit box per chunk (expect 7-8 chunks on screen, ≤ 23,381 boxes in the worst view past the edge, MEASURED lean §3.1) with the far boxes' material plus: `uMask` hide per 256 m tile (existing), roof tone fetched from `uFarTone` at the box centre in the vertex shader (one tone per block), walls one step darker, no sun-pass membership, `frustumCulled = false` per chunk is acceptable for the spike. Chunks within the streaming edge are built but masked. Dissolve is **not** in this spike; the first measure is the raw swap (§6).
4. **`?farsurround`**: the horizon mesh (`City.buildHorizon`, `City.ts:264-315`) reads `surround32.bin` the same way and drops the `y > 40` rule. For cities with no `horizon.bin`, the surround's own height plane builds the mesh (London).
5. **`?farfade`**: `config.fog.clearFarFull` 20000 → 34000 and `PerspectiveCamera` far 30000 → 36000 (`src/render/PixelPipeline.ts:123`); record any depth fighting on the Golden Gate deck and tower tops.
6. **`?loadr=1400`**: `LOAD_RADIUS_HIGH` as a tunable (`sb.tuning.v1` path `city.loadRadiusHigh`) so `tools/look.mjs --tune` can set it; also `?loadr=1` for the hold-still test.
7. **`?body=`**: a `Body` record read from `body.json` with `radius`, `sea`, `air`, `sky`, `sun`; the sky ramp and the water plane obey it; the far fade is skipped when `air` is false; the curve chunk from WORLD-TRAVEL §1.4 is **not** built here (Ross Island at 25 km has a 49 m drop on Earth, 1.5 px, acceptable for a spike; the Moon's 48 km horizon is why `theo` is optional).
8. **`__shotReady`** requires `loadedRegionCount() > 0` (`src/main.ts:1071`); the body stub ships one empty region so the tools work unchanged.
9. **`tools/altitude.mjs`**: add the `sunset`, `presidio`, `marin`, `london`, `ross` starts to `STARTS` and a `--q=` option (as `tools/look.mjs` has) to append the flags. Add `--log-far` that samples `window.__stats` plus the worker's merge time and box counts into `<phase>-log.json`.

Register every new material for warm-up; `node tools/warmcheck.mjs` must report 0.

---

## 5. Before and after frames

Run A (flags off) and B (`--q='farmap&farblocks&farsurround&farfade'`), then B2 (`farmap=oblique`) and B3 (`...&loadr=1400`), each into its own folder. SwiftShader in the cloud is fine for frames; frame times only count on this laptop's GPU (`SB_GPU=1`, Edge) and on the iPhone.

```
node tools/altitude.mjs http://127.0.0.1:5173/ shots/local/spike-far/A sunset --seq
node tools/altitude.mjs http://127.0.0.1:5173/ shots/local/spike-far/B sunset --seq --q='farmap&farblocks&farsurround&farfade'
# same for presidio, downtown, marin, london, ross
node tools/look.mjs http://127.0.0.1:5173/ shots/local/spike-far/A twinpeaks --seq           # the known vista, A/B
node tools/look.mjs http://127.0.0.1:5173/ shots/local/spike-far/B twinpeaks --seq --q=farmap&farblocks
node tools/fps.mjs http://127.0.0.1:4173/ shots/local/spike-far/fpsA --spots=west,alamo,fidi --seconds=10
node tools/fps.mjs ... fpsB (with the flags appended to SPOTS)
python -I tools/shotdiff.py shots/local/spike-far/A shots/local/spike-far/B shots/local/spike-far/diff
python -I tools/seqstat.py shots/local/spike-far/B/sunset-seq-ceiling 5     # and -250m, -cruise, for A and B
python -I tools/shimmer.py B/sunset-seq-ceiling-0.png B/sunset-seq-ceiling-1.png B/sunset-shimmer.png
```

**Hold-still swap** (lean's test): open `sunset` with `&farmap&farblocks&loadr=1` (no regions load past the start), climb to the ceiling, hold with `__rv.hold`, capture `swap-0.png`; set `city.loadRadiusHigh` back to 1900 through the tuner, wait for `city.busy === false`, capture `swap-1.png`; `shotdiff.py` between them, plus the largest connected changed area in game pixels (add that line to shotdiff; art's `popscore.py` has the method).

**The phone session** (producer, iPhone with an A15 or newer, Safari, `vite --host` on the LAN once the GPU workflow is over): the same six starts, `&fps` on, flags off then on; the producer reads fps, 1 % low, ms, draws and tris off the meter at the ceiling and after a 60 s descent, and screenshots each. Five minutes of flight at the ceiling with flags on for thermal drop.

**Palette and brown check** on every B frame: every game pixel must be one of the 192 palette colours (the audit's classifier in `scratchpad/farfield/audit/` does this; its `shots_palette.json` method), and zero pixels may fall on a ramp step with hue 30-85, L < 0.62, C > 0.025 outside paint ramps (`art/oklch.py`).

**Bare far land**: count game pixels whose ramp is GREY_LIGHT in rows 195-330 of each ceiling frame (the audit's palette classifier), A against B.

---

## 6. Numbers to record

One JSON per pose and run, `shots/local/spike-far/<run>/<pose>-numbers.json`.

| Number | From | A today (expected) | B target |
|---|---|---|---|
| Draw calls, whole frame | `window.__stats.draws` (Perf.ts), at the ceiling and at 250 m | 130-180 (MEASURED logs) | ≤ 200 |
| Triangles, whole frame | `__stats.tris` | 1.15-1.39 M | ≤ 1.5 M; B − A ≤ +90 k at the ceiling |
| Frame ms, 1 % low, cpu ms | `__stats` on the laptop GPU and on the iPhone meter | laptop 16.9 ms at Alamo | iPhone ≥ 30 fps, 1 % low ≥ 25; B − A ≤ 2 ms at the ceiling (my threshold; lean said 1, systems 3) |
| Thermal | iPhone meter after 5 min at the ceiling | | no drop under 30 fps |
| Bytes at boot | file sizes: `city.json + far.bin + horizon.bin (+ far16.bin + surround32.bin)` | 551 KB SF | ≤ 1.0 MB added for SF; record London and Ross |
| GPU texture bytes | computed: planes x W x H x mips | 0 | ≤ 4 MB per city (ESTIMATE: 2.3 MB SF at 16 m with mips) |
| Worker merge time, box count per chunk, boxes on screen | worker `performance.now()`, `--log-far` | n/a | merge ≤ 100 ms on the phone; ≤ 25 k boxes past the edge in the worst view |
| Bare far land, share of the frame | palette count, rows 195-330 | 6.7-7.4 % Sunset and Presidio (MEASURED simulation) | ≤ 0.5 % |
| Buildings in the wedge absent in every form | by construction from the raster's roof cells against the footprint list for the wedge (`audit/bands_sim.py`) | 85-89 % | 0 |
| Shimmer residual per band (rows 195-265, 265-375, 375-648) | `seqstat.py` over the 6-frame bursts, A and B | coarse rows ~12.8 % flips in an old fogged capture | far rows in B no worse than B's own coarse rows 375-648, and no worse than A's coarse rows |
| Hold-still swap | `shotdiff.py` + largest connected changed area | region-sized (a 1 km region ~190 px wide) | ≤ 15 % of far pixels change by more than one ramp step after a 5 x 3 box; largest connected changed area ≤ 500 game px; no straight 1 km edge visible by eye |
| Top-4 colour share and pepper, rows 212-265 and 265-318 | `art/metrics.py` adapted to read a game-pixel PNG via `shimmer.py`'s `game_px` | 90-98 % top-4 (MEASURED systems) | ≤ 70 % top-4; pepper ≤ 2x the frame's own coarse band |
| Palette, brown | §5 checks | 100 %, 0 | 100 %, 0 |
| Identity with flags off | `shotdiff.py` A vs feat/osm `--det` shots | | exit 0 except the `flat` ramp fringes, which must be the only change |

---

## 7. Pass / fail: what a first-time player would say

The producer answers these on the phone, unprompted, before seeing any number.

| Pose | The question | Pass | Fail |
|---|---|---|---|
| `sunset`, `presidio` at the ceiling | "Is the whole city there?" | Yes, every direction, with the avenue grid and the parks readable | Any pale strip or patch of land with no city on it |
| Any SF pose, 60 s descent to the street | "Did a square piece of city appear while you came down?" | No region-shaped arrival anyone can point to; blocks turn into houses without a visible line | A 1 km edge, or the hard swap from grey boxes to towers that `downtown-250m.png` shows today |
| `sunset` at the ceiling, 3 s pan | "Does the far city boil or crawl?" | No more than the near city does | A shimmering strip where the raster or boxes are |
| `downtown`, `marin` | "Are Berkeley and Marin there?" | Hills with towns and roads on them, not one flat band or a pale slab; Marin's ridges read as ridges | The flat green band of `sheets-E-end.png`, or Lego terraces |
| `london` | "Does London carry on?" | The city continues to the horizon with the City's towers standing where they are | The frame ends in a straight line and the sea |
| `ross` | "What is that?" | "A mountain over an ice shelf, with a long shadow" | A blank plate, a green garden, or grey rock |
| All B frames | "Does it look like a printed carpet?" | No; it reads as the same drawn city as the near band | Yes |
| All B frames | "Anything brown?" | No | Yes |

**Numeric gates** are §6's B targets. Pass = every question answered the right way and every gate met on the iPhone. Partial passes are informative:

- Raster passes, blocks crawl → widen the merge to 24 m (11,510 boxes, MEASURED) or start the raster nearer; if it still crawls, plan B (the height-field march) gets its own 2-day measurement on the phone.
- Blocks pass, swap fails → calibration first: fit each class's tone offset against a top-down in-game frame, then retest; then the dissolve.
- `ross` fails as a blank plate → height steps to 0.25 m and a light-only relief exaggeration dial (art's Dome C panel), a taste call for the producer.
- `london` passes but its towers are wrong → the heights ladder is next, not the renderer.
- Phone frame time fails → `?loadr=1400` first (expect ~44 % less loaded area, ESTIMATE lean), then drop blocks to 5 km, then 32 m boxes.
- Anything passes only with `?farfade` → fine; anything that passes only with a heavy value plan → fail, that is fog.

---

## 8. Five days

| Day | Work | Done when |
|---|---|---|
| 1 | Worktree, `flat` ramp, `farmap.py` mode A (+ oblique), `?farmap`, `?farfade`, far terrain sink under loaded tiles, `warmcheck` 0; start the Overture and WorldCover downloads overnight | `sunset` B ceiling frame shows no bare land; `shotdiff` A vs feat/osm clean |
| 2 | Worker merge, `?farblocks`, `?loadr`, `altitude.mjs` starts and `--q`, A/B captures for `sunset`, `presidio`, `downtown` with `--seq`, `seqstat`, hold-still swap | Numbers JSON for three poses; first shimmer and swap figures |
| 3 | `farmap.py` mode B: Bay Area surround, London far16 + surround; `?farsurround`; captures for `marin`, `downtown`, `london` | Berkeley, Marin and London frames A/B; bytes recorded |
| 4 | Mode C body stub, `?body`, `ross` (and `theo` if time); palette and brown checks on every B frame; `fps.mjs` A/B on the laptop GPU; write-up of all numbers | `ross` frame through the same shader; the numbers table filled |
| 5 | Producer phone session (A/B, descent, 5-minute hold), fix-ups, second phone session if needed; verdict on the spike in `shots/local/spike-far/RESULT.md` | Every §7 question answered on the phone |

What this spike does not do, on purpose: the Bayer dissolve, the paint raster, the band-1 calm pass, the cube grid, any bake of a city not already baked, and any change to main. Those are roadmap steps 2-5 in VERDICT.md, and each of them is pointless if this spike fails.
