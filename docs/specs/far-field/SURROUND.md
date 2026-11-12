# Far field days 3-5 for the Bay Area: the build plan

Written 2026-11-12 by the first account's planning run. Read only: no repo was changed, nothing was downloaded, no browser or bake ran. Paths are on `main` unless a branch is named, as `branch:path`. "The archive" is the studio's copy of the Bay Area's inputs, `bay-2026-10-21`, kept outside the repo (`feat/world:docs/specs/earth/DOWNLOADS.md` lists it). Labels: MEASURED = read or run today from the files named (small read-only Python against the archive, each under 5 s); FROM THE DOCS = a number a repo doc gives; ESTIMATE = arithmetic, assumption stated; UNKNOWN = could not find out.

**Revised the same day, before anything is built,** on what the wild places' research found (`docs/specs/earth/WILD.md`):
- The new container is `SBP1`. `SBT1` is already the name inside today's near tiles (`src/world/tiles.ts`).
- Water keeps its own height unless it is at sea level (section 2.3, step 2). Sinking every water cell would dig a pit under each of the Bay's reservoirs.
- The class table's TREE row takes its tone from the `KIT` and `CANOPY` planes where a tile carries them (section 4.3).
- Section 5 was a sketch. `WILD.md` is the plan for wild places and trees by region now, and the producer added its three test places on 2026-11-12.

---

## The step in one paragraph

Replace `horizon.bin` (one 128 m height grid from a USGS tile, drawn in two colours by a 37 m rule) with a **surround** for the Bay Area baked only from the archive already on disk: relief from Copernicus GLO-30, land class from ESA WorldCover, every building's cover and height from Overture, and a tone made from those (no imagery needed). It lands after `far16.bin`, one draw, drawn by the far ground's own class-and-tone shader, so Marin and the East Bay get real ridgelines and Oakland and Berkeley exist as blocks of tone from the 15 km ceiling, with the seam at San Francisco's map edge calibrated away. The files are written in a container that is already a planet tile (frame, layer and level in the header, one shared class table), so the planet layer (VERDICT step 5) takes them over as two levels of its tree instead of throwing them away. London and Ross Island wait on downloads.

---

## 1. What is live today, and VERDICT step 0

**Live on main (head 34d55cf):** SPIKE days 1 and 2 for San Francisco, on by data for any city with a `far16.bin`.

- Decision: `DECISIONS.md:2508-2528` ("The far field live for San Francisco", the producer: "it's amazing well done"). It says days 3-5 are not part of it, "so the East Bay and Marin past the raster's edge stay a flat green band" (line 2509).
- Switches: `config.far.on` (`src/config.ts`, `far:` block) and `?nofar`; `farOn` at `src/main.ts:59`, the flags at `src/main.ts:60-68`.
- The 16 m raster: `public/city/sf/far16.bin`, 837,979 bytes on the wire, 896 x 1104 cells at 16 m, affine (16, 0, -8704, 0, 16, -9984), six planes plus the towers table, 5,982,839 bytes inflated (MEASURED). Baked by `tools/bake/farmap.py` (mode A only, `feat/world:tools/bake/farmap.py:1-31` documents SBR1). Read by `parseFarRaster`, `feat/world:src/world/tiles.ts:400-420`.
- Started after far.bin and horizon.bin, 400 ms grace (`config.far.graceMs`), late landing in one step (`City.loadFar` / `landFar`, `feat/world:src/world/City.ts:627-691`; main `src/world/City.ts:603`). index.html hands far16 out unstarted (`index.html:22-39`).
- Far boxes in a worker (`src/world/farBlocks.ts`, `farWorker.ts`), sinking from 5.5 km and gone at 7 km (`config.far.blockSink`, `blockEnd`).
- Load radius unchanged: `LOAD_RADIUS = 1500` (`src/world/City.ts:381`), `loadRadiusHigh: 1900` (`src/config.ts:257`).
- Fade: `FADE_END = 34000`, far plane +2000 (`src/main.ts:79-88`), turned on when the raster lands (`src/main.ts:192-197`). With height the fade ends at `room + 2000` m past the land's edge by 3 km up (`src/game/Ascent.ts:27-32`, `config.ascent.fadeLandAt/fadeLandPast`, `src/config.ts:470-485`), because `horizon.bin` ends 32 km from the origin and the bus may go 8 km past the map (`reachMax: 8000`). DECISIONS 2534 says outright: "Far-field day 3's surround raster is what lifts both."
- The horizon ring itself is unchanged since before the spike: `horizon.bin` (190,311 bytes, 500 x 500 at 128 m, ±32 km, MEASURED), drawn at 256 m vertex spacing (`step = 2`, `feat/world:src/world/City.ts:770-813`) with `makeHorizonMaterial`: GREY_LIGHT under 37 m, RIDGE (GREEN_GREY without the sky) over (`src/world/City.ts:258`).
- **A live bug found today (MEASURED):** `horizon.py` reads one USGS tile, `n38w123` (`feat/world:tools/bake/horizon.py:24`), which ends at 38.0° N. Every row of `horizon.bin` north of z = -25 km is 0, so it's drawn as sea: rows 0-50 have 0 % land, row 55 on has 87 %. Novato, the north of San Rafael and San Pablo Bay's north shore are open water from the ceiling. The surround fixes it.
- `spike/farfield` (d3ad7ca) is an ancestor of main (`git merge-base --is-ancestor` true): nothing of days 1-2 is left off main.
- `feat/world` (7333500) carries the same far code as main (no far commits of its own since the merges) and is 36 commits behind main.

**VERDICT step 0's seven fixes** (`VERDICT.md:173`):

| Fix | State | Where |
|---|---|---|
| `flat` ramp varying | In | `src/render/materials.ts:334` (`flat out float vRamp`), `:376` |
| Far ground reads its classes | In (the 16 m raster's 15 classes, not far.bin's 11) | `src/world/farMaterial.ts:45-62` (class to ramp table) |
| Far terrain sunk under loaded tiles | In, 40 m | `src/world/farMaterial.ts:40` (`LOADED_SINK`), `:135` |
| Far fade 21-34 km | In (ends at 34 km, far plane 36 km) | `src/main.ts:79-88` |
| Water dash prefiltered | **Not in.** The dash is still a per-position hash with no distance gate | `src/world/terrainMaterial.ts:31-33` |
| Tower base band gated | **Not found.** I found no gate under that name in `farMaterial.ts`; UNKNOWN whether it went in another form | |
| Trees as points past 1.5 km | **Not in.** Trees have a far canopy LOD and still end; no point form | `src/world/props/trees.ts:779-787` |
| (not on the list, but VERDICT defect 4) Horizon two colours by a contour, SF only | **Not in**: this plan's step | `src/world/City.ts:258` |

---

## 2. The Bay Area's surround

### 2.1 The frame and what it must cover

- San Francisco's map: x -8,704 to 5,632, z -9,984 to 7,680 m about 37.7749, -122.4194 (CONTRACT.md 1.1, `feat/earth:docs/specs/earth/CONTRACT.md:26-28`). Its north edge (37.864° N) crosses Marin at Mill Valley; its south edge (37.706° N) crosses Daly City. Those are the two land seams.
- What must be drawn: the bus may be 8 km past the map from 2.5 km up, and the fade reaches 34 km from it. So land is needed to about 60 km from the origin (17.7 + 8 + 34). Today's ring stops at 32 km, which is why the fade closes in near the edge.
- Proposal: **two levels, parent first**, same bake, same container:
  - **L8 (outer, the parent):** ±64 km, class and tone at 128 m (1000 x 1000), relief at 256 m (500 x 500). Mt Diablo, Point Reyes, Petaluma, the South Bay to Palo Alto come in.
  - **L10 (inner):** ±32 km, class and tone at 32 m (2000 x 2000), relief at 128 m on a 513 x 513 grid (125 m, see 2.4), built cover and height at 32 m.
  - Names follow the S2 level whose texel is nearest (strategy-systems §3: level 8 texel 141 m, level 10 35 m), so the planet streamer's level numbers are these.
- Why not 16 m like San Francisco: from the 15 km ceiling Oakland is about 20 km away, seen steeply (about 49° down); a 32 m cell is about 1.5 px wide there (portrait lens, 1.07 mrad a pixel, CONTRACT.md 1.4). 16 m would be under a pixel. It matters only flying over Oakland itself at 2.5-8 km, off the map. Say it to the producer: from the ceiling Oakland is blocks and arterials and parks as tone; residential street gaps of 15-20 m aren't resolved at 32 m.

### 2.2 The archived files that feed it

Archive: `bay-2026-10-21` (3.10 GB, 508 files, all matching `manifest.json`, `feat/world:docs/specs/earth/DOWNLOADS.md:7-12`). Listed today (MEASURED):

| Folder | Files and bytes | Used here |
|---|---|---|
| `dem/` | 8 GLO-30 tiles, 216,100,743 bytes: N36W122 38.9 MB, N36W123 0.45 MB, N37W122 47.7 MB, N37W123 20.1 MB, N37W124 0.1 MB, N38W122 49.3 MB, N38W123 45.8 MB, N38W124 13.8 MB. Float32, 3600 x 3600, deflate, overviews 2/4/8, EGM2008 | **Relief** (all 8: the ±64 km box needs N36-N38, W122-W124) |
| `worldcover/bay.tif` | 20,208,712 bytes; 25,752 x 20,952 uint8, EPSG:4326, 10 m, 256 x 256 blocks, deflate, no overviews; box -123.523 to -121.377, 36.777 to 38.523 | **Class**, tree share |
| `overture/2026-10-21.0/bay/building.parquet` | 391,752,085 bytes, 2,809,787 rows, 173 row groups (median 17,596 rows, largest 29,143), WKB geometry, **no bbox column**. 80.3 % have `height` (2,255,043), 38,940 `num_floors`, 80.5 % either (MEASURED) | **Built** cover and height |
| `overture/.../bay/land.parquet` | 33,798,712 bytes, 171,250 rows; classes incl. `wood` 13,858, `scrub` 8,078, `grassland` 7,720, `tree` (single trees) 128,266, `land` 336 (the coastline's land polygons) | Optional: coastline and scrub correction (ODbL, see 2.6) |
| `overture/.../bay/water.parquet`, `land_use.parquet`, `land_cover.parquet` | 29.8, 38.2, 26.8 MB | Not needed for this step (land_cover is WorldCover-derived) |
| `geoid/us_nga_egm96_15.tif` | 2,710,815 bytes | O9's geoid, not this step (GLO-30 is on EGM2008; SF's map on NAVD88; the difference in the Bay is under about 1 m, ESTIMATE, unchecked) |
| `overture/.../raw/*`, `footers/*` | 2.2 GB of row-group pieces and footers (raw building 501,680,135 bytes in 173 files) | No: the flattened `bay/` files are enough |
| `shipdensity/`, `ourairports/` | 503 MB, 16.7 MB | No (life's) |
| `landpolygons/` | empty (item 20 never came) | Not needed: Overture `land` holds the coastline polygons (130 km² of class `land` in the Mt Tam box alone, MEASURED) |

What the archive does **not** have and this step does without: a Sentinel-2 composite for tone (SPIKE §2's tone row). The tone recipe below needs none.

### 2.3 The bake: `tools/bake/surround.py`

One script, `python -I tools/bake/surround.py sf [--levels 8,10] [--report r.json] [--png dir] [--strip 256]`, reading only the archive (path from `SB_ARCHIVE`; no default, so the bake stops if it isn't set). Below-normal priority. Before importing numpy it sets `OPENBLAS_NUM_THREADS=1`, `OMP_NUM_THREADS=1` and Arrow's one-thread pools: GRAPHS.md measured 470 MB of commit from the thread pools alone (`feat/world:docs/specs/earth/GRAPHS.md:155-160`).

1. **Frame.** The city's tmerc from `tools/bake/cities/sf.json` (`origin`), the two levels' rectangles. Every function below takes a `Grid` (CRS, affine, W, H), never a city: the planet bake passes an S2 tile's grid to the same functions (section 4).
2. **Relief** (GLO-30). `rasterio.warp.reproject`, average, one source tile at a time into the output (never a merged mosaic: four tiles merged are 207 MB). Decimetres in a u16 with a base and step per file (0.5 m). Two fixes: under cells with built cover over 30 %, a 3 x 3 minimum (GLO-30 is a surface model: Oakland's towers are bumps in it); no fix under forest (the canopy is what one sees from far off: Muir Woods' redwoods add up to tens of metres, ESTIMATE). Water keeps its own height unless it is at sea level. A connected body of water cells (from step 3) whose median GLO-30 height is under 3 m is sea, bay or salt pond, and is set to -6 m as `buildHorizon` does. Any other is a lake or a reservoir (San Pablo, Briones and Crystal Springs are inside L10) and is flattened to its median. The 3 m is a starting value: the report lists every body kept, with its height and its cell count.
3. **Class** (WorldCover). Reprojected with `Resampling.mode` to 32 m in strips of 256 output rows (a strip's source window is about 8 x 64 km at 10 m, about 5 M pixels). Mapped through the shared class table (section 4.3): 10 and 95 TREE, 20 SHRUB, 30 GRASS, 40 CROP, 50 BUILT_COVER (resolved by step 4), 60 ROCK_BARE, 70 ICE, 80 WATER, 90 WETLAND, 100 MOSS. Same strips give each cell's **tree share** (count of 10/95 pixels of the ~10 under it), kept for tone.
4. **Built** (Overture). Row group by row group: `shapely.from_wkb`, keep what touches the frame, project every vertex with one `pyproj` call, area and centroid. A footprint under 1,024 m² (99.3 % of them, MEASURED on the largest row group, mean 203 m²) adds its area to its centroid's cell; bigger ones are rasterised at 8 m with `rasterio.features.rasterize` into a local window. Planes: **cover** (share of the cell under roofs, 0-255) and **height** (tallest top in the cell, 2 m steps as far16). Height from `height`, else `num_floors * 3.2 + 1`, else the neighbours' median, else 6 m, and the report says how many of each (the QA line SPIKE §3 asks every city to carry). A cell is ROOF where cover is 50 % or more, as far16 does (`farmap.py` `ROOF_SHARE`).
5. **Tone, with no imagery.** Tone is brightness only, a lo on GREY_LIGHT as far16's (`farmap.py:1-14`), so the client code is the same. Per class: TREE and SHRUB from tree share (open canopy reads lighter: grass shows through), GRASS and CROP flat, ROOF from cover and height through far16's oblique rule (wall share `min(1, height / cell)`, `farmap.py` `wall`), WATER none. Then **calibrated on the overlap**: San Francisco's whole map lies inside L10, so every class has thousands of cells where far16's tone (baked from the real tiles) and the surround's tone sit on the same ground. Fit one gain and offset per class so the two means and spreads match; that is what keeps the seam at Mill Valley and Daly City from showing. Quantised last (TONE_Q 4).
6. **Parent from child**, the planet rule (strategy-systems §2 rule 4): L8's class is the commonest of the 4 x 4 L10 cells under it, tone the mean luma taken back to a lo, never an averaged hue. Outside L10's rectangle L8 is baked directly at 128 m (same functions).
7. **Write** the three layers per level (section 4.1), a report JSON (wall time per step, peak working set, bytes per plane gzipped, class histogram, tone per class, calibration residual per class, share of heights defaulted) and PNG sheets through `farmap.sheet`'s palette rule.

### 2.4 Size on the wire

Measured today on a decimated read, not the bake (ESTIMATE from it):

- WorldCover class over ±32 km at about 25 m, nearest neighbour, through the class map, gzip 9: **429 KB** for 6.66 M cells, 51 % land (MEASURED). A 32 m mode is smoother and has 40 % fewer cells: about 200-300 KB.
- GLO-30 over the same box at 30 m, 0.5 m steps: 3,286 KB gzip raw, 2,315 KB with a row delta; **712 KB** at 60 m with the delta (MEASURED). At 125 m and 0.5 m with the delta: about 180-220 KB, the same as today's `horizon.bin` (190 KB at 128 m).
- Tone at 32 m on land, 64 levels: about 300-450 KB (ESTIMATE: 2-3 bits a land cell after gzip).
- Built cover and height at 32 m: about 100-200 KB together (ESTIMATE: SF's far16 height plane is 144 KB for 1 M cells of dense city, FROM THE DOCS, SPIKE §3; the surround has about 4 M cells with perhaps three San Franciscos of built land in them, at a quarter of the cells per building).
- L8 (±64 km at 128 m, relief at 256 m): about 150-250 KB.

**Total: about 1.0-1.4 MB added, minus `horizon.bin`'s 190 KB if the surround replaces it.** SPIKE §6's line is ≤ 1.0 MB added for SF *including* far16 (838 KB already spent). So this goes over that line by about 1 MB. It downloads after far16, nothing waits on it, and L8 (the small parent) comes first. **Producer decision 1** (below). If it must shrink: relief at 256 m inside (-100 KB), tone at 32 levels (-100 KB), drop L8 and keep the fade closing in at the edge as today (-200 KB).

**GPU texture bytes** (ESTIMATE): L10 class and tone, 2000² each, R8 with mips: 5.3 MB each, 10.7 MB; L8 2.7 MB; relief as a texture for per-pixel normals (optional, 513² R16): 0.5 MB. About 14 MB against SPIKE §6's ≤ 4 MB a city (written before the 15 km ceiling widened the frame). Half the L10 texels are water. A sparse atlas of 256² tiles (only land tiles) would cut it to about 6 MB, and is the planet layer's own cache: not in this step.

### 2.5 The client change

All behind `?nosurround` (old horizon path, byte-identical frames to main) and on by data (a city with the files gets it, as far16):

1. **Reader**: `parseSurfaceTile` in `src/world/tiles.ts` for the new container (section 4.1); SBR1 stays as is for far16.
2. **Load**: `City.loadFar` starts L8 when far16 is in, L10 when L8 is in; no grace, never part of the first frame; a late landing swaps the ring in one frame as `landFar` does. Until L8 lands, `horizon.bin` draws as today (it stays on the wire this step; dropping it is a follow-up once the surround has flown on the phone).
3. **Mesh**: `buildSurround` replaces `buildHorizon`. A regular grid at 256 m inside L10 (as today) and 512 m out to ±64 km, one draw, the SF frame's hole as today. Budget: no more than +40 k triangles over today's ring at Sunset's ceiling, and none at Noe at 350 m (already 1.72 M on the live build, DECISIONS 2526). If the ridges read as polygons, RTIN (Martini) on the 513 x 513 relief in the far worker, max error about 3 m, held to the same triangle budget.
4. **Material**: the far ground's class-and-tone chunk (`farMaterial.ts`) with a second set of uniforms (affine, class texture nearest with mode mips, tone linear with mips, anisotropy 8): class picks the ramp from the shared table, tone the lo, `sbWrite` quantises last, the real sun lights it. No 37 m rule. ROOF from the cover plane. Optional per-pixel normal from the relief texture so ridges and gullies take the low sun at 128 m. Registered for warm-up (`warmcheck` 0).
5. **Ground**: `horizonGround` (`City.ts:819-830`) reads the new mesh the same way (its triangles), so a dive past the map still meets the hills (DECISIONS 2538), and `landRoom` (`City.ts:763-768`) the L8 rectangle: the fade no longer closes in near the edge.
6. **Seam**: inside the SF frame the far ground keeps far16; the surround's L10 cells there aren't drawn. If the calibrated tones still step at the north and south edges, a world-anchored Bayer dither over a 512 m band picks far16 or surround per pixel (hue never blends), as VERDICT plans for tiles.
7. **Credits**: GLO-30's credit and liability sentence, verbatim from DOWNLOADS.md, in `public/city/DATA_LICENSE.md` (it has WorldCover's, `DATA_LICENSE.md:26-38`, and no Copernicus line today).

Not in this step: boxes for the East Bay (`farBlocks` could take L10's height plane at 32 m unchanged, but from the SF map Oakland is past `blockEnd` 7 km; worth a measured try only for the off-map flights over Oakland at 2.5-8 km), the paint raster, the planet streamer.

### 2.6 Memory and time on the laptop that bakes

The laptop: 4 cores, 8 GB (`LIVING.md`, "Machines and money"). Other runs often hold most of the memory.

| Bake step | Peak memory | Time | Basis |
|---|---|---|---|
| Libraries with one-thread pools | about 75 MB | seconds | GRAPHS.md table, `feat/world:docs/specs/earth/GRAPHS.md:147-156` |
| Relief, one GLO-30 tile at a time into 1000² and 500² | 150-250 MB (a tile is 52 MB as float32, plus the warp's buffers) | 20-60 s | MEASURED: three tiles merged at full resolution over ±32 km read in 3.9 s |
| Class, mode resampling in 256-row strips | under 150 MB | 30-120 s (GDAL's mode is the slow part) | MEASURED: a decimated read of the ±32 km window took 0.3 s |
| Built, row group by row group | 150-300 MB (output planes 4 M cells x 6 bytes = 24 MB; the largest row group's geometry about 10 MB) | 2-4 min | MEASURED on the largest row group (29,143 rows): read 0.05 s, WKB 0.98 s, projection 0.16 s, area and centroid 0.03 s. 173 groups at the median size: about 100-170 s |
| Tone, calibration, parents, write | under 100 MB | under 30 s | ESTIMATE |
| **Whole bake** | **about 400-600 MB peak** (steps run one after another, each freeing its inputs) | **about 5-8 minutes** | ESTIMATE from the above |

It fits in 8 GB with the laptop otherwise idle. With other runs holding RAM (under 1 GB was free while this was written), run it in `--strip` mode: relief, class and built all write their outputs strip by strip (8 km bands of output rows), so the peak is one strip's inputs, about 200-300 MB (ESTIMATE). No step needs the whole Bay in memory; the WorldCover window (540 M pixels) is never read whole. Peak working set is reported from the bake itself through `ctypes` and Windows' `GetProcessMemoryInfo` (psutil isn't in the venv; nothing to install).

### 2.7 Poses and captures that prove it

Portrait 393 x 852, the game's lenses, laptop GPU (`SB_GPU=1`, Edge) for numbers; SwiftShader only for frames. Every pose A (`?nosurround`) against B (default).

| Pose | Start | Heights | What it proves |
|---|---|---|---|
| `downtown` (exists, `tools/altitude.mjs:34`) | Civic Center, heading 45 | 520 m, 3, 6, 12, 15 km | Berkeley and Oakland and their hills across the Bay |
| `marin` (exists, `altitude.mjs:38`) | Presidio, heading 330 | 520 m, 3, 15 km | The Headlands, Tam, Mill Valley over the north seam |
| `tam` (new) | lat 37.850, lon -122.520 (off the map's north-west), heading 330 | 3 km | Tam's ridge and Muir Woods' canyon from close, the bus off the map |
| `oakland` (new) | lat 37.810, lon -122.330 (off the map's east edge), heading 80 | 2.5, 6 km | Oakland's and Berkeley's blocks from over them; the 32 m look at its worst |
| `seamN`, `seamS` (new) | over Sausalito heading 0; over Visitacion Valley heading 180 | 1 km | The far16 / surround edge on land, both sides |
| `ceil15` (new) | over the origin, headings 0, 90, 180, 270, plus `__qa.topDown` at 15 km over Lake Merritt (`src/main.ts:1058`) | 15 km | The whole Bay from the ceiling; the north strip that is sea today |
| descent | 15 km to the street over SF, heading 45, 0.1 s log | all | No pop: the surround never changes during a descent (it is resident), only the SF tiles do |
| night and low sun | `downtown` at the ceiling, `?hour=` blue and night | 520 m | SKY.md §9: one night frame; ridges by a low sun |

Checks on every B frame: palette 100 % and brown 0 (`tools/far/pal.py`); `shotdiff` A vs B is 0 where no surround is in view; `seqstat`/`shimmer` on 6-frame bursts at `downtown` 15 km and `oakland` 6 km (the far rows crawl no more than the near rows); draws and triangles from `__stats` at Sunset's ceiling, Noe 350 m, `downtown` 15 km; `warmcheck` 0; `contextloss`; `iosfloor`; `tsc`.

**The ridgeline test, new and data-driven** (`tools/far/ridge.py`): from the pose's camera, compute the skyline's angle column by column from GLO-30 itself, and compare with the frame's land/sky boundary. Pass: within 2 game px in 95 % of columns at `marin` and `downtown`. This is what "drawn from real data" means in a number.

**The seam test**: mean ramp-step difference across the map's north and south edges in `seamN`/`seamS` (≤ 0.5 step a class) and the largest connected changed area in a hold-still pair with `?nosurround` (it must stay inside the surround's own area).

**The phone** (the producer, the preview link, `?fps`): `downtown` and `marin` at the ceiling and at 15 km; a dive past the map into Marin; "Are Berkeley and Marin there?" and "Do Marin's ridges read as ridges?" (SPIKE §7's questions), and "anything brown?".

---

## 3. What days 3-5 need that we don't have

None fetched. Each needs the producer's OK with file, source and size (CLAUDE.md:118).

| For | File | Source | Size | Licence |
|---|---|---|---|---|
| London's surround and far frame | Overture 2026-10-21.0 buildings, box 51.35-51.65 N, -0.35 to 0.15 E (SPIKE's 12 km) | `s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/`, 86 row groups by the archived footers | **about 262 MB** (ESTIMATE: 1,682,696 rows in the row groups the box touches, MEASURED from `footers/building.json`, at the Bay's 156 bytes a row). ±32 km (to match the Bay's L10): 152 row groups, about 456 MB | ODbL |
| London relief | GLO-30 `Copernicus_DSM_COG_10_N51_00_W001_00_DEM.tif` and `..._N51_00_E000_00_DEM.tif` | `copernicus-dem-30m` bucket | about 25-50 MB each (SPIKE §2 says ~25 MB; the Bay's land tiles are 38-49 MB) | Copernicus licence (credit, liability sentence) |
| London class | WorldCover window from tile N51W003 (and N48W003 if the box dips under 51° N: it doesn't) | `esa-worldcover` bucket, as `tools/bake/worldcover.py` reads it | about 8-15 MB for ±32 km (ESTIMATE: the Bay's 540 M-pixel window is 20 MB with half of it sea) | CC BY 4.0 |
| Ross Island (`ross`, SPIKE day 4) | REMA v2.0 32 m mosaic windows round -77.75, 167.30 (three nested, as before) | PGC's REMA on AWS (`registry.opendata.aws/pgc-rema`) | 7.2 MB for the old three windows (FROM THE DOCS, SPIKE §2); they were in the wiped scratchpad | CC BY 4.0 (PGC's commercial wording to check, VERDICT §11.7) |
| Ross Island buildings | none needed: the box touches one row group with 22,400 rows worldwide, about 3 MB, and McMurdo is out of the 38° wedge | | | |
| Tone from imagery (optional, later) | ESA WorldCover S2 RGBNIR composite 2021, tile N36W123 window | `esa-worldcover-s2` bucket | UNKNOWN (4 bands x 16 bit: the ±32 km window is about 0.4 GB raw before compression, ESTIMATE) | CC BY 4.0 |
| The Moon (`theo`, optional) | nothing: `public/moon/relief.bin` and `theophilus.bin` are on `feat/earth` (`feat/earth:public/moon/`) | | 0 | as used there |
| Not needed after all | GEBCO (item 18), land polygons (item 20) | | | |

London's own map (`public/city/london`, 24 files, a 49 KB far16.bin over the 3.3 x 2 km frame) has no horizon.bin, so it is still an island; the London surround is the same `surround.py` with no city name in it, which is the point of doing it (CLAUDE.md:19).

---

## 4. Shaped for the planet layer

The planet layer (VERDICT step 5, `VERDICT.md:178`; strategy-systems §2-4) is a cube-sphere tile tree per body, three layers (relief, surface, built), 256-texel tiles keyed (body, level, cell), parent resident until the children land, one far shader. This step makes the surround **two tiles of that tree that happen to be placed in a city frame**, so nothing is thrown away.

### 4.1 One container for every layer and level: `SBP1`

```
char[4] 'SBP1', u16 version 1, u16 flags
u8  layer        0 relief, 1 surface, 2 built (strategy-systems §4; one licence family a file)
u8  level        the S2 level its texel is nearest (8, 10 here)
u16 bodyId       0 Earth (as SBR1)
u8  frameKind    0 = a city's tmerc: f64 lat0, lon0 follow (the file is self-describing, no city.json needed)
                 1 = an S2 cell: u8 face, u8 pad, u32 i, u32 j at `level` (unused this step)
f32 a, b, c, d, e, f   cell (i, j) -> frame x, z, as SBR1 (for kind 1, the tile's local affine, computed by the client)
u8  nPlanes, then nPlanes x { u8 kind, u8 bytesPerTexel, u16 W, u16 H, f32 base, f32 step }
    kinds: CLASS, TONE, TREE_SHARE, COVER, HEIGHT, RELIEF16, KIT (reserved, 0), CANOPY (reserved), PAINT (reserved)
then each plane's bytes, rows of i; gzip over the whole.
```

Planes may differ in resolution (relief at a quarter of class's). Layers are separate files, so `surface` (WorldCover + GLO-30: CC BY and the Copernicus licence) never carries anything from OSM, and `built` (Overture: ODbL) stays its own: strategy-systems' licence rule, and the OSMF guideline it cites. Files: `public/city/sf/surround/{relief,surface,built}-L8.bin` and `-L10.bin`. far16.bin stays SBR1 this step; moving it into SBP1 (as a level-11 `surface`+`built` pair) is a later, separate commit.

### 4.2 Tile addressing

- Levels are S2 levels by texel size, so the streamer's "a level while its texel is ≤ 1.6 px" rule (strategy-systems §2 rule 3) reads these files with no table of its own.
- This step uses `frameKind 0` only. The planet layer bakes `frameKind 1` tiles with the **same** `surround.py` functions, because every function takes a `Grid`, not a city: `Grid` = (CRS, affine, W, H). For an S2 tile the grid is the tile's local tangent frame and its affine. Strategy-systems §3 says version one places far tiles into today's city frame through `geo.ts`; a tile-local affine is what SBP1 already stores.
- An affine per tile is exact for kind 0. For kind 1 it is an approximation: over a 36 km level-8 tile I expect the error from S2's projection to be well under a 141 m texel (ESTIMATE, not computed); the step-5 spike must measure it.

### 4.3 One class table and one tone rule

Today the class-to-ramp table is written twice and kept equal by comments ("Same table in src/world/farMaterial.ts", `farmap.py:58-66`; `farMaterial.ts:45-62`, `:64-65`). This step makes it one file, `src/world/surface.json`, read by `farmap.py`, `surround.py` and `farMaterial.ts` (a JSON import in Vite):

- Rows append-only, ids fixed forever, one enum for every body (strategy-systems §2: "one enum for all bodies"): 0-10 Ground, 11 ROOF, 12 TREE, 13 ICE, 14 ROCK_BARE as today, then 15 SHRUB, 16 CROP, 17 WETLAND, 18 MOSS, 19 BUILT_COVER (built land with no footprint data).
- Each row: name, ramp, lo, CLASS_OVER, CLASS_FIT, WorldCover codes that map to it, and `kit` (0, see section 5). TREE's tone is not a fixed number: it comes from the `KIT` and `CANOPY` planes where a tile carries them (`docs/specs/earth/WILD.md`, section 4.8), and from tree share where it doesn't, which is every tile of this step. New classes use existing ramps this step (SHRUB on GREEN_GREY a step darker, CROP and WETLAND on GREEN_GREY, MOSS on GREY): no palette change, so no new brown risk.
- Tone stays far16's: brightness as a lo on GREY_LIGHT at REF_LIGHT, quantised last, parents by mean luma (never averaged hue). The surround's L10-to-L8 code is the planet bake's downsample.

### 4.4 The client side

The surround draw is one mesh, one texture set, one affine uniform, the far ground's shader chunk. The planet layer is many of those, from a cache, chosen by pixels. Keep `buildSurround` taking a parsed tile and its affine, not a city, so step 5 calls it per tile.

---

## 5. Wild places and trees by region (a sketch, kept for its measures)

`docs/specs/earth/WILD.md` is the plan now: it was researched and checked after this section was written, and it corrects it. Height comes before the region map, no new green is added, ESA CCI land cover is not allowed for a commercial game, and the OSM scrub layer only scores the rule and never feeds it. What stays true below is what was measured, and the seam this step leaves.

### What the archive can show at Mt Tamalpais and Muir Woods today (MEASURED from `worldcover/bay.tif` and `land.parquet`)

| Box | WorldCover |
|---|---|
| Tam + Muir Woods (-122.65 to -122.50, 37.86-37.96, 147 km²) | tree 69.6 %, water 12.2 %, built 8.7 %, grass 8.3 % |
| Muir Woods' core (180 x 180 px) | tree 97.4 %, grass 2.6 % |
| Tam's summit | tree 95.8 %, built 2.1 %, grass 1.4 %, bare 0.6 % |
| Marin Headlands | tree 49.6 %, water 23.6 %, grass 21.3 %, built 3.0 %, shrub 1.6 % |
| Berkeley/Oakland hills | tree 62.3 %, built 25.8 %, grass 11.1 % |

- So the surround would show Tam and Muir Woods as one TREE class (GREEN_GREY), toned by tree share, on GLO-30 relief that includes the canopy. Muir Woods would read as a dark forested canyon; nothing would say "redwood".
- WorldCover gets this place wrong in a way a local would notice: Tam's summit is chaparral and serpentine grassland, and the Headlands are mostly coastal scrub, yet WorldCover calls 95.8 % and 49.6 % of them tree, and only 1.6 % shrub. OSM (via Overture `land`, archived) has 78.5 km² of `wood` and 6.3 km² of `scrub` in the Tam box: better on scrub, but ODbL, so it can only go in the `built`-family file or its own ODbL overlay, never in `surface`.
- Species: OSM `leaf_type` is on 1,514 of 13,858 woods in the whole Bay box (11 %: broadleaved 1,044, mixed 413, needleleaved 57); single trees carry `genus` 1,068 times (Sequoia 28). Too thin to drive a look.

### What a first "tree kit by region" would need

1. **Which trees grow where.** A global region key, then a table region to kit. Best fit: **RESOLVE Ecoregions 2017** (846 ecoregions in 14 biomes; e.g. "Northern California coastal forests" is the redwood belt), CC BY 4.0, one shapefile, about 150 MB zipped (ESTIMATE, size to confirm). Leaf type and phenology to split a forest within a region: **Copernicus Global Land Cover LC100** forest-type layer (100 m; evergreen/deciduous, needle/broad), free with credit, tiles of 20°, tens of MB a tile per layer (ESTIMATE); or **ESA CCI Land Cover** 300 m (licence differs by version: check). In the US only, LANDFIRE EVT (30 m, public domain) names "redwood forest" itself; as a source row it's allowed by the planet design, but it can't be the rule (CLAUDE.md:19).
2. **How tall they are.** **ETH Global Canopy Height 2020** (10 m, CC BY 4.0, 3° tiles, size UNKNOWN: hundreds of MB a tile, ESTIMATE) or Meta/WRI's 1 m canopy height (CC BY 4.0, far larger). Height is what separates a 70 m redwood canyon from a 12 m oak hillside without naming a species. It also lets relief subtract the canopy (a DTM from GLO-30 minus canopy height).
3. **The art.** Crown families per kit (redwood spire, oak dome, palm, fir, beech, southern beech/podocarp for New Zealand, spruce/larch for the Alps, chaparral as low lumps), each drawn as `props/trees.ts` draws today, and perhaps two new greens (a blue-green for conifers, a yellow-green for broadleaf). New ramps are a palette change: OKLCH hue must stay out of art's brown band (30-85 at L < 0.62, C > 0.025, SPIKE §0), and yellow-greens sit near it. The producer's eye on a swatch first.
4. **One table**, biome x realm x leaf type to kit (about 60-100 rows, written once for the world, not a city one-off). Whether a world table is "hand-made" under the scale rule is the producer's to say.

### The seam this step leaves

- The class table's TREE row carries `kit: 0` (generic) and the shader picks TREE's ramp through `kit`, a one-row table today.
- SBP1 reserves `KIT` (u8, coarse, e.g. one per 256 m) and `CANOPY` (u8, metres) plane kinds; `surround.py` has a `tree_kit(grid, cls) -> 0` hook beside `tree_share`.
- The near bake's trees (`bake.py`, WorldCover-gated) and the far trees read the same `kit` later, so a redwood is a redwood from the street to the far field.
- Nothing else: no download, no new ramp, no new mesh.

---

## 6. Commit by commit

Branch: **`feat/surround`, cut from main** (main holds the live far field; `feat/world` is 36 commits behind and its graphs await a review). Merge into `feat/world` after the review. The producer or TODO names the branch first (CLAUDE.md "How we work").

| # | Commit | Acceptance |
|---|---|---|
| 1 | **One class table.** `src/world/surface.json`; `farmap.py` and `farMaterial.ts` read it; the new classes 15-19 appended, unused yet. | `farmap.py sf` rebuilds `far16.bin` byte for byte; `shots --det` 16 of 16 identical to main; `tsc` clean both configs |
| 2 | **SBP1** writer (`tools/bake/sbp.py`) and reader (`parseSurfaceTile`, `tiles.ts`), a round-trip test both sides (`tools/world/sbp-check.mjs`). | Python writes, TS reads, every plane equal; a malformed or unknown-version file returns null and the page goes on |
| 3 | **`surround.py`: relief and class** (steps 1-3, 6, 7 for those layers), strip mode, the report. | Report: wall time, peak working set, bytes; the sheet shows Novato as land (rows north of z -25 km); the report lists the water bodies kept above sea level, the three reservoirs of step 2 among them, and none is a pit in the sheet; class histogram within ±2 points of the decimated measure above (tree about 23 %, water about 49 % over ±32 km) |
| 4 | **`surround.py`: built and tone**, the overlap calibration. | 2.8 M footprints read, the in-frame count in the report; heights by source; calibration residual ≤ 0.5 ramp step a class inside the SF frame; whole bake under 10 min and under 700 MB peak on this laptop |
| 5 | **The bake's files** in `public/city/sf/surround/`, the GLO-30 credit in `DATA_LICENSE.md`. | Total bytes reported against section 2.4; producer decision 1 answered before this lands on a pushed branch |
| 6 | **Client: load and draw** (`buildSurround`, the material, ROOF from cover, `?nosurround`), warm-up. | `warmcheck` 0 on time and late; `?nosurround` identical to main; draws +0, triangles ≤ +40 k at Sunset's ceiling and +0 at Noe 350 m; GPU bytes reported; late landing (file held 9 s) worst frame no worse than far16's (67 ms) |
| 7 | **Ground and fade**: `horizonGround` on the new mesh, `landRoom` on L8. | The Marin dive (DECISIONS 2543) stays over the hills; at 6 km past the map's west edge the fade ends at 34 km, not at the land's edge |
| 8 | **Poses and checks**: `tam`, `oakland`, `seamN`, `seamS`, `ceil15` in `altitude.mjs` (and a straight climb to a set height), `tools/far/ridge.py`. | Ridge test ≤ 2 px in 95 % of columns at `marin` and `downtown`; seam ≤ 0.5 step; palette 100 %, brown 0; crawl rows no worse than near rows |
| 9 | **Seam dither** only if commit 8's seam test fails. | Same test passes |
| 10 | **Hand-in**: push, preview link, DECISIONS entry with every number, the phone session. | The producer flies `downtown`, `marin`, a dive into Marin, and answers SPIKE §7's Berkeley/Marin questions |
| 11 | London (after its downloads are OK'd and fetched overnight): the same `surround.py`, a London `horizon` from L10's relief. | `london` frames: the city goes on to the horizon; the bake ran with no city name in its code |
| 12 | Ross Island (after REMA is OK'd): SPIKE §3 mode C as SBP1 `relief`+`surface` with an empty `built`. Check first whether `feat/earth`'s Body work already has a `Body` record to reuse. | `ross` through the same shader; "a mountain over an ice shelf" |

Optional, VERDICT step 0's leftovers, each its own small commit after 10: the water dash prefiltered by distance (it flips up to 4.5 % of pixels, VERDICT §5); trees as points past 1.5 km.

### Estimate (agent-days, honest)

- Commits 1-2: 0.5-1.
- Commits 3-5 (the bake): 1.5-2. The overlap calibration is the unknown.
- Commits 6-7 (client): 1.5-2.
- Commits 8-10 (checks, hand-in, phone fixes): 1-1.5, plus one producer session.
- **Bay Area: 4.5-6.5 agent-days.** SPIKE gave days 3-5 three days for all of it, London and Ross included; that was before the 15 km ceiling doubled the frame.
- London: +1-1.5 after an overnight download. Ross: +1.5-2. `theo`: +0.5 if the Moon's files on `feat/earth` serve.

### Risks

1. **Bytes.** About 1.0-1.4 MB added against a 1.0 MB line already 84 % spent by far16. A producer call.
2. **GPU memory.** About 14 MB of far textures against SPIKE's 4 MB; probably fine on an A15, unmeasured there.
3. **The seam.** far16 comes from OSM-classed tiles, the surround from WorldCover: the same street can be PAVED on one side and BUILT_COVER on the other. Calibration matches brightness, not class; the dither is the fallback.
4. **WorldCover's California error**: chaparral and coastal scrub read as tree (Tam summit 95.8 % tree). Marin's ridges will be greener and darker than they are. Fix needs OSM scrub (ODbL, its own file) or a better class source.
5. **GLO-30 is a surface model**: towers and canopy in the relief; the min filter covers built land only.
6. **Triangles**: the live build is already over 1.5 M at Noe and Bernal (DECISIONS 2526); the ring must add nothing there.
7. **The shore**: GLO-30's heights near 0 m are noisy (a few metres); salt ponds, Alameda and the Bay's flats sit at the water plane (-0.6 m). Class decides water; land is held at ≥ +0.5 m.
8. **Crawl** at 32 m tone from 15 km, untested; the class map's mode mips are the guard.
9. **This laptop**: with other runs holding RAM, strip mode is a must, and the GPU numbers need the laptop idle.
10. **Overture's clock**: the inputs are archived; the 2026-12-16 breaking release only matters for London if fetched after it.

### What I could not find out

- Whether the "tower base band" fix of step 0 went in under another name.
- Real sizes of the London, REMA, composite, ecoregion, LC100 and canopy files (no HEAD request was allowed); the London Overture figure is from footer row counts.
- The surround's real gzip sizes for tone and built, and the bake's real peak memory and time: only partial reads ran.
- How well WorldCover matches far16's OSM classes along the seam.
- The affine-per-tile error for S2 tiles (step 5's to measure).
- The tool the ASCENT checks used to shoot at 1.5-15 km; `altitude.mjs` climbs by input (about 6 minutes to 15 km), so commit 8 adds a straight climb to a set height.
- Whether `feat/earth`/`feat/moonfree` already has a `Body` record for Ross and the Moon stubs.
- `extract.json`'s credit strings are mojibake (multiply-encoded UTF-8, seen while reading it); DOWNLOADS.md has the clean ones. Worth fixing before any credit is copied from it.

---

## The calls

1. **About 1 MB more download for the Bay's hills and the East Bay, after the city is on screen.** The studio's call: yes, with the parent level first. Nothing waits on it and the first frame doesn't change. It is the producer's to overrule, and commit 5 reports the real bytes before anything is pushed.
2. **London's downloads** (about 262 MB of buildings for 12 km, or about 456 MB for 32 km, two GLO-30 tiles, a WorldCover window). Not asked for yet. The pick, when the Bay has flown: the 32 km set, so London gets what the Bay gets.
3. **REMA for Ross Island** (about 7 MB). Not asked for yet. The pick: yes, after the Bay has flown.
4. The tree kits' downloads are `docs/specs/earth/DOWNLOADS-WILD.md`'s now, group by group.
