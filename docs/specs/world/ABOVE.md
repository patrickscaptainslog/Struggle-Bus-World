# The city from high up: the plan to bring every frame inside the ruling

Final plan, 2026-11-13, after two critics (a rendering engineer's and a player's eye). Design only: no repo was changed. The first plan is
`ABOVE-v1.md` beside this file; the critiques are `CRITIQUE-eng.md` and `CRITIQUE-eye.md`.

Everything was measured on a laptop's GPU, on a build of feat/shots 98fca30 (its main asset `main-BxzC6qHH.js`, the same name as the shots
suite's build log), and once on feat/core's build. **Every number is a laptop count of draws and triangles, which do not depend on the GPU, or a
count from the map data. None is a phone measurement. No frame time is used as evidence.** ESTIMATE marks what is worked out, not measured.

The ruling (CLAUDE.md, "Numbers"): 393 x 852 game pixels at 3x, 120-200 draws, 1.0-1.5 M triangles, nothing compiles in flight, Safari 15
parses the build. The floor is an A15 at 30 frames a second.

## 1. In short

From high up a frame is over the ruling for one main reason: **a gear freezes the level of detail.** Any gear with a height (Nonstop, Jet,
Turbo 1-3) or any speed past the surge sets `City.detailHold`. While it holds, nothing changes level, so a climb carries the street's 92 to 96
detailed tiles to the ceiling. Looking down from 2 km or more, which is what a far shot's dip does, that is 300 to 435 draws and 2.0 to 3.0 M
triangles. Flown in Cruise, where the city turns coarse as it should, the same cells are 53 to 144 draws.

Measured this revision, in the real failing row (the shots suite's Comet row, real touches, real gear), with the hold taken away so a gear
streams as Cruise does: every pose at night passed, where today five of twelve fail (14 km: 264 to 179 draws, 1.78 to 1.03 M). At noon, with the
sun pass on, today fails eleven of twelve (14 km 383 draws, 2.74 M); with the hold taken away the dip from 5 and 14 km and the frame at 1 km come to 148-201
draws and 1.08-1.50 M, at the line. What stays over at noon is the low band: 300 m in a gear at 276-289 draws, the floor at 205, and the dive's
triangles at 1.50-1.53 M.

So the cure is right. But it can't be done the simple way. Letting the hold go (the first plan's stage 1) coarsens the home blocks in a gear
and frees their detail, so after a climb and dive the roofs come back coarse and then pop to detail when the gear comes out. It also brings back
the unprepared swap frames the hold was made to stop, and a painted region's coarse swap is the heaviest frame there is.

**The plan:**
1. **Release A, before any of the dip reaches the live site** (6 to 9 agent-days, ESTIMATE):
   - 1a. One paint mask per coarse region, so a painted tile costs no draw of its own.
   - 1b. The gear's twin: a held detailed region gets its coarse mesh built ahead, unseen; the region shows whichever level its distance calls
     for, flipping in one frame either way. The detailed meshes are never freed in a gear, so the roofs after a climb and dive are today's.
   - 1c. Far boxes in chunks of 8 tiles a side.
2. **The low band** (the floor to 400 m in a gear, at noon over the ruling with or without the hold): sun-pass casters merged by 2 x 2
   tiles, an arrival's first draw in one pass, trees by 2 x 2 tiles (3 to 5 agent-days, ESTIMATE). No look change.
3. **Shadows from high up**: a producer call. Ask it now.
4. **Paint seen from the ceiling**: a world-anchored paint raster read by the far field. A producer call after Release A.
5. **Far regions drawn by the far field**, with a dissolve. A producer call, last.

The core's return start (its first 5 s at 229 to 328 draws) is a different cause and goes to the core's job (section 7).

## 2. How the world is drawn

- A **tile** is 256 m: its buildings, its ground (65 x 65 heights, a 128 x 128 class raster of 2 m cells) and obstacle heights. San Francisco
  has 2,433.
- A **region** is 4 x 4 tiles, 1,024 m, one gzip file; San Francisco has 195. The worker meshes a region at one of two levels:
  - **Detailed (LOD 0), per tile**: a building mesh (bays, cornices, stoops, roof shapes), a caster proxy for the sun pass, and a 4 m ground
    mesh with its own class texture and, once painted, its own ground-paint mask. Downtown: about 10,400 building and 2,000 ground triangles
    a tile.
  - **Coarse (LOD 1), per region**: one merged building mesh (rings simplified to 1.5 m; its own caster) and one merged 8 m ground mesh that
    does not cast. 13,400 building triangles a region downtown, 23,000 in the Sunset; 5,800 to 8,100 ground triangles.
  - Today a painted tile in a coarse region is split out with a ground mesh of its own (`City.setOwnGround`), since ground paint is a mask per
    tile. One more draw each.
  - Paint on buildings is a lookup by building index (`aBld`, `PaintState`) at both levels: no draw. Growth (setback gardens, onion domes) is
    in the detailed mesh; the coarse mesh keeps domes only on towers 150 m and taller, two each, and no gardens (`BuildingMesher.ts`).
- **Trees**: one instanced draw per tile with trees, out to 900 m from the lens (1,620 m at full vista).
- **The far field** over the whole map: far ground (1 draw), far towers (1), horizon (1), water (1), and far boxes in 170 chunks of one region,
  a draw a chunk, shown within 7 km of the lens's map position where a tile is unloaded.
- **What is loaded**: about 19 to 21 regions round a point 950 m ahead of the bus from 450 m up, the same patch at every height. Two
  requests in flight. A region is detailed under 650 m of `detailD` (distance over the lens's detail scale), coarsened past 910, detailed
  again under 520. In a gear none of that runs: arrivals come in coarse and the loaded stay as they are (`City.ts` `request()`), and swaps
  that arrive wait (the adoption filter in `update()`).
- **A frame**: by day the sun pass (depth only, a 2,048 x 2,048 target, casters whose shadow can reach the view), the G-buffer pass (397 x 856),
  five post draws. A mesh adopted this frame draws once whether in view or not (`firstDraw`); a prepared swap's mesh draws once unseen
  (`ghost`).

`DRAWN.md` beside this file has the longer version.

## 3. What was measured

The suite is this job's folder: `gate.sh` (the shots suite's, pointed at the existing build and ports 5340-5359), `with-server.sh`,
`serve.mjs`, and rows in `gates.txt`, `gates-grid.txt`, `gates-more.txt`, `gates-eng.txt` and `gates-final.txt`. Tools in `tools/`.

**The settled grid** (`tools/above.mjs`: three places x Turbo 3, Jet, Cruise x seven heights x five pitches, noon, posed and settled; 418 cells,
107 over the ruling; the engineer rebuilt the table from the saved cells and got the same). The worst cells:

| cell | draws | M tris | made of |
|---|---|---|---|
| Sunset, Turbo 3, 14.9 km, 60-72 deg | 435 | 2.96 | detailed tiles 92 + 96 (1.13 M), sun pass 121 (0.78 M), coarse 20 + 20 (0.62 M), far 70 |
| downtown, Turbo 3, 14.9 km, 72 deg | 431 | 2.27 | detailed 96 + 96 (1.20 M), sun 119 (0.43 M), far 82 (0.44 M) |
| painted downtown, Turbo 3, 14.9 km, 60 deg | 452 | 2.11 | the above plus 157 painted tiles' own ground |
| painted downtown, **Cruise**, 14.9 km, 60 deg | 265 | 0.95 | painted tiles' own ground 173, far 33, coarse 16 + 12, sun 18 |
| painted downtown, **Cruise**, 5 km, 60 deg | 199 | | 134 of them painted tiles' own ground |
| Sunset, **Cruise**, 14.9 km, 72 deg | 144 | 1.55 | coarse 21 + 21 (0.71 M), sun 15 (0.40 M), far 73 (0.44 M) |
| bay, Turbo 3, 300 m, 30 deg | 203 | | sun pass about half: 42 tile casters, 44 tile ground (rerun: 203, 202 flown) |
| downtown, Turbo 3, 1 km, 72 deg | 263 | 1.19 | sun 117, detailed 47 + 45, trees 30 |

What it says:
- Gears hold the street's detail to the ceiling: Turbo 3 and Jet keep 92 to 96 detailed tiles at every height; Cruise has none above 1 km.
- Looking level, high up is cheap (21 to 89 draws from 5 km at the rig's own pitch). The cost is the view looking down.
- The sun pass: 92 to 121 draws and 0.43 to 0.78 M with detail held, 15 to 18 and 0.24 to 0.40 M when all is coarse. It culls by the view
  (`cullCasters`), so a level view draws far fewer.
- Far boxes: up to 82 chunk draws at 14.9 km looking down. Chunks of 8 tiles: 19 to 33 draws for +0.04 M triangles. Chunks of 16: 13 to 18
  for +0.05-0.07 M.
- Painted ground: one draw per painted tile in view in a coarse region.
- The producer's flags (`?crew&life&bomb&boom&falls`) add 1 to 5 draws unpainted (downtown Cruise, 300 m to 5 km). Painted life is not measured.

**Real flight** (these are what the gates must use: a settled grid misses the frames where the level changes):
- *The shots suite's Comet row, today* (real touches, night, 10 taps a pose; its "Turbo 3" is Jet, since the tool shifts with `turbo.shift`,
  which stops at Jet, and the two measure the same here): Turbo 3 floor 145, 300 m 197, 1 km 211, 5 km 260 / 1.72 M, 14 km 264 / 1.78 M,
  dive 247 / 1.81 M; Nonstop 14 km 206. Five of twelve poses fail.
- *The same row with the hold taken away* (this revision, `fin-comet-nohold-night`: the copied tool with `AB_NOHOLD`, which makes
  `city.detailHold` always false; 6 taps a pose; its "Turbo 3" is Jet too): Turbo 3 floor 151 / 1.07 M, 300 m 170 / 1.07, 1 km 131 / 0.70, 5 km 175 / 0.97, 14 km 179 / 1.03,
  dive 161 / 1.07; Nonstop 124 to 179, at most 1.15 M. **Every pose passes; nothing compiles.** This is the draw count stage 1b aims at. It is
  not stage 1b: the poses are pinned, so the swaps' frames are not what a climb would show.
- *Both again at noon* (this revision, `fin-comet-hold-noon` and `fin-comet-nohold-noon`, the sun pass on, 6 taps a pose). Today: Turbo 3
  floor 154 / 1.23 M, 300 m 306 / 1.88, 1 km 324 / 2.12, 5 km 386 / 2.60, 14 km 383 / 2.74, dive 366 / 2.61; Nonstop 207 to 282, up to 2.16 M:
  eleven of twelve over. Hold taken away: Turbo 3 floor 205 / 1.17, 300 m 276 / 1.84, 1 km 148 / 1.08, 5 km 191 / 1.39, 14 km 201 / 1.50,
  dive 173 / 1.50; Nonstop floor 190, 300 m 289 / 1.83, 1 km 168, 5 km 159 / 1.38, 14 km 178 / 1.46, dive 169 / 1.53. Nothing compiles in either.
  So high up the hold is the whole cause; under 400 m it is not, and at 300 m with the hold away it is no better (the pose is pinned while the
  city streams, so in Cruise's rule it loads detail ahead where the hold loads it coarse).
- *The low band, settled* (this revision, `fin-west-band`: the Comet row's place, the Western Addition, noon, 300 m and 1 km at the rig's
  pitch, 15 and 30 degrees). Turbo 3, 300 m: 193 to 205 draws, 1.26 to 1.39 M; of them the sun pass's tile casters 42 to 45 and tile ground
  41 to 43, the detailed tiles in view 50 to 52, trees 17 to 22. Cruise, 300 m: 181 to 186. Turbo 3, 1 km: 168 to 209, up to 1.51 M, with 64
  detailed tiles held; Cruise, 1 km: 58 to 72, all coarse.
- *A 900 m/s climb to 3 km and dive in Cruise* (the engineer's `eng-climb-downtown`, noon, 60 degrees down, every frame): no frame over 200 or
  1.5 M; worst 190 at 766 m. The six home regions were coarse by 1,223 m; at the roofs five came back one at a time 0.14 to 1.6 s after
  arriving, and one was still coarse 8 s later. The six coarsening frames carried 13 to 24 ms of laptop main-thread work each; an arrival's
  adoption 32 ms. (Laptop ms: they show which frames carry work, not what an A15 takes.)
- *The band the grid skipped*: the bay in Cruise, settled, 500 m: 121 to 162 draws, two regions still detailed; 700 m: 62 to 67.
- *The map's relief* (the engineer's `tools/relief-eng.mjs`, from the region files, no browser): land tiles whose heights span 6 m or less are
  12 % of San Francisco, 16 % round Union Square, 19 % round the return start, 4 % round the Sunset. And by slope (this revision,
  `tools/slope.mjs`): a tile's steepest 4 m slope beats a 33 degree sun in 69 % of the city's land tiles (66 % downtown, 81 % round the return
  start, 62 % in the Western Addition, 20 % in the Sunset), 98 % counting neighbours; a 45 degree sun, 36 % (79 %).
- *The return start* on feat/core: frame 0 at 229 (89 far chunks' first draws, 64 first tiles' first draws in both passes); the core's own runs
  saw 229, 328 and 308.

## 4. Release A (before live): stages 1a, 1b and 1c

One release. Each part has its own switch and is built and reviewed in this order, but none of it goes live without the others: 1b without
1a leaves a painted city over the ruling and makes a painted region's flip build a split ground per painted tile.

Estimate: 1a 2 to 3 agent-days, 1b 3 to 5, 1c a quarter of a day, the rows 1 to 2. **6 to 9 agent-days** (ESTIMATE), plus a producer session on
the phone. If the flip is seen (the look row), a dissolve adds 1 to 2 (below).

### 1a. One paint mask per coarse region

**What it does.** A coarse region's merged ground carries its own paint mask, 512 x 512 texels, the region's 16 tile masks side by side. A
painted tile in a coarse region is no longer split out. Its paint costs no draw, painting it never rebuilds the region's ground, and a region
going coarse makes no split grounds in its frame.

**Files.**
- `src/world/GroundPaint.ts`
  - The mask lookup (`GLSL_GROUND_PAINT`) reads its size from a uniform, `uGroundN`, where it now has the constant `GROUND_N` (128): 128 on a
    tile, 512 on a region. Its UV is the ground's own 0..1 (`vClassUv`, already over the region on a region's ground). One program, so
    nothing new compiles. Everything else in the lookup is in world space or per texel and stays as it is: the fresh-paint serials in each
    texel's alpha read the shared `uGroundLive` uniforms, so the splat's shine works on a region mask unchanged.
  - A region mask: a 512 x 512 RGBA8 texture laid out as the region's class texture is (tile (i, j) of the region at texel (128 i, 128 j)),
    made when a coarse region's ground is built and any of its tiles has paint or saved paint, freed with the region's ground.
  - Tile masks stay as they are (each tile's CPU copy, decode, save, replays, live blasts). New: a tile mask may show through its region's
    mask. `attach()` takes either a tile ground's uniforms, as now, or a region mask and the tile's place in it. In `flush()`, a tile's
    dirty rect is uploaded to wherever it shows (`uploadRect` with the region offset). Both when both are resident (1b's twin).
  - The region texture keeps no CPU copy: it is filled from the tile masks' own data, rect by rect, and its first upload's buffer is
    dropped (as `dropAfterUpload` does for geometry). About 1 MB of GPU memory a painted coarse region (ESTIMATE), not 2.
- `src/world/City.ts`
  - `buildRegionGround()`: no tile is split out for paint. Every tile goes into the merged ground; the region's material gets the region mask
    when one exists (`tGround`, `uGroundOn`, `uGroundN`).
  - `setOwnGround()` on a tile in a coarse region: no `groundStale`, no rebuild; it makes or fills the region mask. On a detailed tile it does
    what it does now.
  - `SPLITS`, `groundStale` and the `swap ||` split rule stay only behind the switch.
- `src/moon/moonMaterial.ts`, `src/moon/moonBoot.ts`: the Moon's region ground (`regionMaterial` -> `makeMoonGround`) gets the same three
  uniforms and the same lookup, so the Moon's open-ground paint (all of its paint) goes through a region mask too. `onPaintReady` (the
  Moon's kept paint, copied out of its pictures) fills the region mask on a coarse tile instead of asking for a split.
- `src/world/terrainMaterial.ts`: the `uGroundN` uniform beside `tGround` and `uGroundOn`, which it already has.

**The data it needs.** None new. The tile masks it copies already exist.

**The switch.** `config.city.regionPaint` (true), and `?rmask=0` on the page: false is today's splits, exactly.

**Saving.** One draw per painted tile in view in a coarse region. The painted downtown in Cruise, 14.9 km 60 degrees: 265 to about 95; 5 km:
199 to about 65 (ESTIMATE: the painted cells less their own-ground draws, plus one region mask lookup that adds no draw).

**What a player sees.** Nothing. The mask's texels are the same 2 m texels the split ground sampled, on the same 8 m ground.

**What could break.** A tile's edge: today the lookup clamps at the tile's edge; over a region it reads the neighbour's texels, which is right,
but at the region's edge it must clamp (`uGroundN - 1`). The Moon's pictures path. A MEGA's 43 to 49 tiles in one frame now copy rects, not
meshes (cheaper). GPU memory: up to about 20 MB with 20 painted regions loaded (ESTIMATE; measure in Safari).

### 1b. The gear's twin

**What it does.** In a gear, a detailed region the bus climbs away from gets its coarse twin: the coarse mesh and merged ground built from a
second request, drawn once unseen, and kept hidden beside the detailed tiles. From then on the region shows whichever level its distance calls
for, and the switch between them is a change of visibility in one frame, either way: no worker, no upload, no texture, no compile. The detailed
tiles are not freed while the gear holds, as today. Regions that arrive during a gear still come in coarse, as today (NOSE.md accepts that).

**Files.** `src/world/City.ts` only, plus a config entry.
- State: per region, `twin` (a `RegionMesh`, the same shape as a coarse region's) and `shows` (0 detailed, 1 coarse). Per tile, `lodOff`
  (hidden by the twin), next to the fog's `hidden` (`cullBuried`): a tile's meshes are visible when neither is set. A twin's meshes likewise
  combine `shows` with the region's fog `hidden`.
- Asking (`request()`): while `detailHold` holds, each loaded detailed region with no twin, not pending, whose `detailD(d)` is past
  `TWIN_ASK` (start 0.8 x the flip's upper line) is asked for its coarse level, marked as a twin. Twins go in the same queue as new loads, by
  distance, two in flight. The hold's other rules stay: arrivals coarse, no classic upgrade or coarsening.
- Arriving (`onRegion()`): a coarse response for a region asked as a twin is queued as a new adoption kind, `twin`. It must not set
  `regionLod` (today the last line of `onRegion` does, for every response).
- Adopting (`update()`): the hold's filter (`findIndex` skipping `swap` and `prep`) lets `twin` through. A twin is built like a coarse region
  (`buildRegionMesh`), with three differences: it goes into `twin`, not `regionMeshes`; it does not drop the tiles' own ground (in
  `buildRegionGround`, `dropTileTerrain` and the loaded mask stay as they are); its ground takes 1a's region mask. Both meshes are drawn once
  unseen (`ghost`). One twin a frame, on the adoption's byte budget (its merged mesh is 1 to 4 MB). If the region keeps grown towers, the twin
  shows its domes as a coarse region does (`setDrawRange`).
- Flipping (a new `flipTwins()`, each frame, from `update()`): a twin whose first draw is done shows coarse when `detailD(d)` is past
  `FLIP_UP`, detailed when under `FLIP_DOWN`, and keeps what it shows between. Start at Cruise's own lines, 910 and 520; the look row (below)
  may raise them. A flip sets `lodOff` on the region's 16 tiles (their buildings, casters and ground) and the opposite on the twin. Nothing
  else changes: the loaded mask, the far field, the trees (per tile, independent of the level), the rooftop sprouts, the aim's picking (it
  reads footprints, not meshes) and life.
- The hold ends (`detailHold` false again): each twinned region settles on what it shows, one region a frame. Showing coarse: the twin becomes
  its coarse region (`regionMeshes`, `regionLod` 1) and the tiles' detailed meshes are freed (`dropTileMeshes`). Showing detail: the twin is
  freed. Then the classic streaming does the rest by its own rules.
- `unloadRegion()` frees a twin with its region.
- On the Moon the coarse level is its own data (heights and map). The twin's ground uses the twin's data; the tile keeps its detailed
  `terrainData` for the ground's height, since its detailed meshes stay.

**The data it needs.** None new. The worker already meshes either level from the same region file; the second fetch hits Safari's cache.

**The switch.** `config.city.twin` (true), and `?twin=0` on the page: false is today's hold, exactly. With `?rmask=0` as well, the build is
today's.

**No new program.** The coarse building mesh and the region ground are drawn today and warmed. The warm row proves it.

**Saving.** A gear's frame becomes Cruise's. Measured with the hold taken away in the real Comet row at night: 14 km 264 to 179 draws and 1.78
to 1.03 M; 5 km 260 to 175; 1 km 211 to 131; the dive 247 to 161. At noon: 14 km 383 to 201 draws and 2.74 to 1.50 M; 5 km 386 to 191 and 2.60 to 1.39 M; 1 km 324 to 148; the dive 366 to 173 and 2.61 to 1.50 M.
With 1c's chunks, about 40 fewer draws at 14 km and 0.04 M more triangles (ESTIMATE): the 14 km dip and the dive stay at the triangle line at
noon until stage 3. The settled grid's worst, Cruise's cell for each:
downtown 14.9 km 72 degrees 431 / 2.27 M to about 130 / 1.1-1.3 M; the Sunset 435 / 2.96 to about 144 / 1.6-1.8 M (still over in triangles: stage
3 or 5); the bay 386 / 2.16 to about 124 / 1.0-1.2 M (ESTIMATE: Cruise's cells, plus up to six coarse regions a gear keeps behind, plus 1c).

**What a player sees.**
- Climbing in a gear: from about 550 m up (Cruise's 910 m of `detailD`; the stream's centre is 840-950 m ahead of the bus, so regions under
  and behind it may flip lower, about 350 to 400 m) the home blocks show the coarse level, as Cruise shows it today. Bays, cornices and
  stoops are about a game pixel there (1.3 m a pixel at the flip, ESTIMATE).
- Diving back: they flip back to detail at Cruise's 520, in one frame, with nothing missing in between, and at the roofs they are the same
  meshes as today, because they were never freed.
- Painted towers' growth: the coarse level keeps domes only on towers of 150 m and more. Under the flip line a dome is 2 to 8 game pixels.
  The paint row decides: if their loss shows, the coarse mesher keeps every crown's domes in the coarse mesh's hidden tail (data-driven; its
  triangles counted over all 195 regions first, in Node). The studio's pick is to keep them.
- If the look row sees the flip, a dissolve: both levels drawn for about 0.25 s, each through a screen-door pattern, in variants of the two
  programs warmed at boot. Never a discard in the main building program: on a tile-based GPU a discard costs hidden-surface removal on every
  building. 1 to 2 agent-days more; a flip's frames then cost both levels' draws.

**What could break.**
- Memory: the held detailed tiles (as today, about 96) plus up to six to eight twins, 2 to 4 MB each with their class textures (ESTIMATE). The
  tab's limit is about 1.4 GB. Measure in Safari.
- A twin that arrives late: the region stays detailed, which is today's frame. The worst case is today.
- A flip of several regions in one frame is more visible than one; spread them if the look row says so (at most one region a frame, the rest
  the frames after: at 900 m/s a frame is 15 m of climb).
- The fog's `cullBuried` and the twin's `lodOff` both hide tiles: one combined rule, or one undoes the other.
- `?lift` (the floating houses): the coarse mesh gets the Lift's twin too (`makeBuildingMesh`). Check from 1 km.

### 1c. Far boxes in chunks of 8 tiles

`FAR_CHUNK_TILES` 4 to 8 in `City.ts` (`?farchunk=` already overrides it). 82 chunk draws at 14.9 km to 19-33, for +0.04 M triangles. Each box
still sinks by its own distance; the chunk only groups them. A bigger chunk stays up a little longer at the loaded edge: count it at the roofs
and 300 m, which the grid ran only from 2 km. The switch is the constant.

### Release A's rows (the gates)

Each is a row of a suite like this one's (`gate.sh`, the GPU lock, a build that exists). Each exits 1 on its own pass mark. Each under about
6 minutes. "Every frame" means every frame from the page's ready, counted by wrapping the renderer's draw.

1. **`shots-above`, the pass row.** The shots suite's Comet row, real touches, with the gear set by `turbo.rung` (real Turbo 3, not Jet), and
   Nonstop: the floor, 300 m, 1, 5, 14 km and the dive. A real Lob too. Night and noon; unpainted, painted (600 blasts within 1,400 m, and
   building paint at levels 2 and 3), and with the producer's flags. Pass: every frame at most 200 draws and 1.5 M triangles; no program made
   after ready. A cell a later stage must end is listed by name in the row, with its number, and the row fails if it gets worse. Expected on
   Release A, from the hold-off rows: at noon the floor (about 205) and 300 m (276 to 289) in a gear, which stage 2 ends; at noon the 14 km dip
   and the dive at 1.50 to 1.53 M, at the triangle line, which stage 3 ends. Nothing else.
2. **`climb-above`.** A 900 m/s climb in Turbo 3 from the roofs to 5 km and a dive back to Nonstop's floor (60 m) and Jet's (150 m), over
   downtown, painted and not, noon, 60 degrees down. Every frame: draws, triangles, each flip (its region, lift, `detailD`), and for each flip
   frame the worker requests, textures made and buffer bytes uploaded. Pass: no flip frame makes a request, a texture or an upload past paint
   rects; every frame inside the ruling or a listed cell; at the roofs after the dive, the frame equal to today's build's at the same frozen
   pose (`?fixeddt`, a fixed time, life held; the core suite's frame-compare tools do this), the bus aside.
3. **`flip-look`.** Each flip frame against the frame before it, in the flipped region's screen box, in a gear's climb and dive. Pass: no more
   changed pixels than Cruise's swap at the same place on today's build. If it fails at Cruise's lines, raise them and count the draws again,
   or build the dissolve.
4. **`paint-above`.** A painted downtown, two factions side by side, ground paint and building paint at levels 1 to 3 with gardens and domes;
   from 1, 5 and 14.9 km at 30 and 60 degrees, and in a real dip; the resolved frame read back. Pass: each ramp's pixels within 5 % of today's
   build, each ramp on its own, and none outside the painted area's screen box by more than 1 px.
5. **`moon-above`.** `?moon`, open ground painted, in a gear from the Moon's low heights: the draws and triangles, and the Moon's paint kept
   (`keep.mjs`) over a flip and in a coarse region.
6. **`warm-above`.** The warm check over a gear's climb to the ceiling and a far shot's dip: no program compiles in flight.
7. **`budget-above`.** The settled grid, all three places, noon, as a map of where the cost is. Report only: it is not the gate.

**Before live: an A15.** The flip frames, the dip from 5 and 14 km, and the painted city, with `?fps`, on an iPhone 13 or SE (3rd generation).
It is a gate, not an unknown. Nothing in this folder can stand in for it.

## 5. The stages after Release A

### Stage 2. The low band: the sun pass, first draws and trees near the roofs (3 to 5 agent-days, ESTIMATE)

**Why.** Under about 400 m in a gear nothing flips (the home blocks stay detailed, as the roofs require), and at noon this band is over the
ruling with or without the hold. Settled, the Western Addition at 300 m in Turbo 3 is 193 to 205 draws (Cruise 181 to 186), of which the sun
pass's tile casters and tile ground are 85 to 88 and trees 17 to 22. Flown in the Comet row it is 260 before any tap and 276 to 306 with the
taps. The 55 to 60 more before a tap are, by inference, the first draws of what streams in at a gear's speed: each adopted mesh draws once in
both passes, in view or not (`firstDraw` turns off both the frustum's and the sun window's cull). The 15 to 45 more with taps are the shots'
own (not broken down: the row must count them by kind).

**What changes.**
- **Casters merged by 2 x 2 tiles**, the building proxies and the tiles' ground alike: the same positions, concatenated, in the sun pass only
  (`makeCasterMesh`'s way: positions, no material of its own). The shadow map is the same, so the look is the same, to the pixel. Built in the
  worker beside the per-tile ones (`regionLoader.ts`), all 16 tiles of a region arrive together. Hidden with their tiles by the fog and by
  1b's flip. Per-tile culling in the sun window is lost: count triangles too.
- **A first draw in one pass.** A mesh that draws in the main pass uploads its buffers there; its first draw in the sun pass is a second draw
  that uploads nothing new. Only the caster proxies (sun pass only) need a first draw there. ESTIMATE: about half the streaming's first
  draws. And try the first draw with an empty range, which binds and uploads but rasterises nothing: in three r186 a zero count still issues
  a zero-length draw (its guard returns only on a negative count), so measure what it costs before counting on it.
- **Trees by 2 x 2 tiles** (`world/props/trees.ts`, `main.ts` `onTile`): one instanced draw per four tiles. 17 to 22 draws at 300 m to about 5;
  their triangles are a few thousand.
- **Switches:** `config.city.mergedCasters`, `config.city.firstDrawOnce`, `config.trees.merged`.

**Saving** (ESTIMATE): the sun pass's 85 to 88 tile draws at 300 m to about 25; first draws about 30 fewer in flight; trees about 15 fewer.
300 m in flight at noon from 276-306 to about 175-215: at the line, not safely under it. If the row says it is still over, the shots' own
draws are next, once counted.

**Not this stage: the ground casting only where it has relief, or by slope.** Measured from the map's heights (`tools/slope.mjs`, no browser):
the steepest 4 m slope in a tile beats a 33 degree sun (noon in November) in 62 to 81 % of tiles round downtown, the return start and the
Western Addition, 20 % in the Sunset, and 85 to 100 % counting the tile's neighbours, whose slopes can shadow it. At a 45 degree sun, 1 to 64 %.
So in winter, mornings and evenings it saves almost nothing, and the merged casters save more for every sun with no rule to prove.

**What a player sees.** Nothing; that is the rule to prove. **Rows:** `shadow-same`: the street and 300 m at four suns, frozen frames (`?fixeddt`,
a fixed time, life held), before and after: every pixel equal. And the pass row's 300 m and floor cells at noon, counted by kind in flight.

### Stage 3. Shadows from high up (half to 1 agent-day, ESTIMATE; a producer call, ask now)

**What changes.** `pipeline.shadowStrength` (`main.ts`) fades with the lift from 3 to 5 km; at 0 the pass is skipped
(`PixelPipeline.updateShadow` already does). Data-driven.

**Saving.** The Sunset at 14.9 km 72 degrees: 15 draws and 0.40 M triangles, its last cells over in triangles after Release A (about 1.6-1.8 M to
1.2-1.4 M, ESTIMATE). Downtown 18 draws, 0.24 M. And the 2,048 x 2,048 depth target, written to memory every daytime frame (about 17 MB a
frame, ESTIMATE).

**What a player sees, put straight.** The towers' long shadows round the bus fade out between 3 and 5 km. They are not a pixel or two: at 5 km
a game pixel is about 10.5 m, and a 200 m tower in a 20 degree sun throws about 550 m of shadow, about 50 game pixels (ESTIMATE). The call goes
with before-and-after frames from 3, 4 and 5 km at a low sun downtown.

**If the producer keeps the shadows,** two things that change no look: from 2 km up render the sun pass into a 1,024 square of the same target
(a shadow texel 1.6 m against a game pixel of 4.4 m or more: fill only, no new target, no compile), and stage 5 for the triangles.

### Stage 4. Paint seen from the ceiling (3 to 5 agent-days, ESTIMATE; a producer call after Release A)

**Why.** From 14.9 km at the rig's own pitch the loaded city covers none of the screen; from 5 km 1 %. A player's paint shows only inside a
dip and only inside the loaded patch; anything 2.3 to 2.8 km behind the stream is unloaded and its paint is gone. The far field's verdict calls
paint at a distance the game.

**What changes.** A world-anchored paint raster on the far raster's frame (16 m cells, `far16.bin`'s reserved plane), written as buildings and
ground take paint, saved with them, read by the far ground, the far boxes and the far towers (`farMaterial.ts`, `farBlocks.ts`). Each cell
stores one ramp index and level, never a mixed colour: the indexed G-buffer takes ramps only. Which, when a cell holds more than one: most
area, the newest on a tie. Programs warmed at boot. No draw added.

**What a player sees.** Their painted districts from the ceiling and across the map, as 16 m cells (under a pixel at 14.9 km: 30 to 47 m a
pixel). **Rows:** `paint-above` from 14.9 km at the rig's pitch, and a crawl check (no shimmer as the view moves).

### Stage 5. Far regions drawn by the far field (4 to 6 agent-days, ESTIMATE; a producer call, last)

**What changes.** Loaded regions far from the lens hide their coarse meshes and let the far field (with stage 4's paint) show over them.
Distance measured on the ground plane, not from the lens (from 8 km up every region is more than 8 km from the lens, so a lens distance
would hand the whole patch over at one height), with a per-tile dissolve. The region a far shot lands on stays a mesh through its dip (its
splat's shine, growth, the Lift's houses).

**Saving.** From 10 km up the loaded regions' meshes and their shadows: the Sunset's 21 + 21 draws and 0.71 M.

**Row.** The far field's own: a 60 s descent from 14.9 km to the roofs with no region appearing (a pop count), and the dip from 14 km with
the landing region kept.

## 6. Options rejected

- **Letting the hold go** (the first plan's stage 1): the roofs after a climb and dive change, and the swap frames come back (section 8, eng B1,
  M2).
- **A smaller load radius up high**: a far shot lands only on loaded ground, so the far reach of about 2.75 km would shrink.
- **Cap the dip near 5 degrees**: the studio's pick keeps the dip.
- **Far boxes ending by 3D distance**: changes the look from 7 km up. Chunks of 8 save the draws and change nothing.
- **One draw for all far boxes, or chunks of 16**: one draw is 425 k triangles in every frame; 16 saves 15 more draws than 8 for 0.05-0.07 M
  more triangles.
- **The sun pass every few frames**: the ruling is per frame.
- **Detailed tiles merged into bigger meshes**: ground paint and swaps are per tile today; the coarse level is the merge. (Casters are
  different: stage 2 merges them.)
- **Fewer game pixels**: the G-buffer is 0.34 M pixels; the cost is draws and vertices. The sun pass's 4.2 M texels are stage 3's.
- **Letting the hold upgrade under 400 m through the prepare path** (the eye's first way for B2): it would add swap frames at the roofs in a
  gear. The twin keeps the detailed meshes instead, so nothing needs making at the roofs.

## 7. What goes to the core's job (feat/core), not this plan

The return start's first 5 s (229, 328, 308 in the core's runs) are frames while the bus is held under the opening's fog: first draws of far
chunks and tiles. Release A's 1c cuts the far chunks' first draws (89 at frame 0) to about a quarter, and stage 2's first draw in one pass halves the tiles'
(32 + 16 + 16 at frame 0) (ESTIMATE). The rest, a cap on first
draws, belongs with the core's build, with two fixes the critics found: the adoption itself waits in the queue, so a tile is not marked loaded
(far ground sunk, far boxes hidden) until it is drawn; and the row runs at least three times and takes the worst.

## 8. What must be measured on an A15 (none of it has been)

On an iPhone 13 or SE (3rd generation), with `?fps`:
- The frame time of the worst cells before and after Release A: the climbs in Turbo 3 to 5 and 14.9 km, a far shot's dip at each, painted.
- A flip frame, and a twin's arrival frame, in a gear's climb.
- What one draw costs the CPU in Safari's WebGL (ANGLE on Metal), and the sun pass's second draw of each caster. It decides whether 200 is
  the right ceiling.
- Triangles on a tile-based GPU: every triangle is binned whatever it covers; from 14.9 km the coarse Sunset is about 16 triangles to a
  covered pixel. Does 2 M or more overflow the tiler's buffer into partial renders? The far boxes the vertex shader hides are still binned.
- Memory with the held tiles, the twins, and the region masks.

## 9. Calls for the producer

1. **Shadows from high up** (stage 3). The towers' long shadows round the bus fade out between 3 and 5 km up; at a low sun they are about 50
   game pixels long at 5 km. It buys the Sunset's last 0.4 M triangles and the shadow map's memory traffic in a day. **Studio's pick: yes**,
   with before-and-after frames on the phone first. If no, stage 5 does the triangles later.
2. **Paint seen from the ceiling** (stage 4): painted districts read from the ceiling and across the whole map as 16 m cells. **Studio's pick:
   yes, built straight after stage 2**, ahead of stage 5. It is the game's point from high up and adds no draw.
3. **Far regions by the far field** (stage 5): from about 10 km up the loaded city is drawn by the far field, with a dissolve. **Studio's pick:
   yes, last**, after stage 4 is flown.
4. **An A15 phone for the floor.** Nothing has ever been measured on one, and Release A should not go live on the 17 Pro's word. **Studio's
   pick: get one (an iPhone 13 or SE 3rd generation) before Release A goes live.** The producer decides on the purchase.
5. **Only if the paint row shows it:** painted towers' domes kept in the coarse level (more triangles in every coarse region), or lost from
   about 550 m up in a gear as they are in Cruise today. Studio's pick: keep them.

Release A changes nothing a player sees beyond what Cruise does today (the coarse level from about 550 m up, coming back on the way down in
one frame), and the look and roof rows must prove that. If they can't, the flip goes to the producer as a call before it ships.

## 10. Unknowns

- Everything on an A15 (section 8).
- Stage 1b's frames: the hold-off row pins its poses, so it measures the draws, not a climb's flips. Only `climb-above` on the built stage
  shows those.
- The twins' arrival time on a phone's worker, and their memory.
- Whether the flip is seen at Cruise's lines (the look row), and so whether the dissolve is needed.
- The domes' triangle cost if the coarse level keeps them.
- The share of tiles whose ground can shadow by the slope rule (stage 2's saving).
- What the shots themselves draw at 300 m (15 to 45 draws over the frame before the taps) and what streaming at a gear's speed adds (55 to 60
  over the settled frame): both totals are measured, their make-up is inferred.
- Painted life's draws, gardens on painted buildings at levels 2 and 3 in the grid, and the Moon's painted cells: none measured.
- Only San Francisco; the Sunset's coarse meshes are the heaviest per region measured (23 k triangles).
- The stages' savings are worked from Cruise's cells and the hold-off row (ESTIMATE); nothing is built.

## 11. The critics' findings: taken and not taken

**The engineer.**
- B1, the home blocks coarse at the bottom of a gear's dive, then popping at the roofs: **taken**. 1b keeps both levels resident and flips by
  visibility, the engineer's own fix.
- M1, the adoption filter that holds swaps in a gear: **taken**. 1b names it and lets the new `twin` kind through; `regionLod` is not set by a
  twin.
- M2, the swap frames the hold was made to stop: **taken**. The flip needs no worker, upload or compile; the twin is prepared ahead and drawn
  unseen. `climb-above` counts requests, textures and bytes per flip frame, not ms.
- M3, stage 1 reaches the ruling only over an unpainted city above 400 m: **taken**. Release A ships 1a with 1b; each stage says which cells it
  ends; the 300 m to 1 km band has its own stage (2). Its sums for the Sunset (1.67-1.79 M) and downtown (1.22-1.32 M) are used in 1b's saving.
- M4, the gate can't see stage 1 and can't pass: **taken**. The real-flight rows (`shots-above`, `climb-above`, `flip-look`) are the gates; the
  settled grid is a report; listed cells have names and numbers in the row.
- M5, growth at the coarse level: **taken**. The paint row seeds levels 2 and 3; the domes are a counted fix or a producer call.
- M6, a painted region's coarse swap is the heaviest frame: **taken**. 1a removes the splits; 1b ships only with it.
- M7, stage 4's flat-tile saving is not in the map: **taken**. Its suggested slope-against-the-sun rule was measured too (`tools/slope.mjs`) and
  also saves little at a winter sun (62 to 81 % of tiles still cast at 33 degrees, 85 to 100 % with neighbours), so **not taken**: stage 2
  merges the ground's casters instead, which changes no pixel.
- M8, the 300 m to 1 km band has no plan: **taken**. Stage 2 with merged casters, measured in draws and triangles.
- m1, the fill numbers: **taken**. The G-buffer 0.34 M, the sun pass 4.2 M texels, the upscale 3.0 M; the 1,024-square sun pass from 2 km is
  in stage 3 as the no-look-change option.
- m2, the sun pass culls by the view: **taken**, section 3 corrected.
- m3, "over 400 m" is not Cruise's rule: **taken**. 1b flips by `detailD` alone, at Cruise's lines, with no height gate; the real flip height
  is stated.
- m4, the first-draw cap opens holes: **taken**, and moved with the cap to the core's job (section 7).
- m5, the return start's peak changes run to run: **taken** (229, 328, 308; three runs, the worst), in section 7.
- m6, a pixel-equal row needs a frozen frame: **taken** for `shadow-same` and `climb-above`'s roof frame.
- m7, stage 2's memory: **taken in part**. The CPU copy is real if kept; 1a keeps none (the tile masks hold the data), so about 1 MB a region.
- m8, the producer's flags add 1 to 5 draws unpainted: **taken**; the pass row runs with the flags.

**The eye (13).**
- B1, a painted city stays over after stage 1 alone, and a hit on a coarse region rebuilds its ground in the dip: **taken**. 1a and 1b are one
  release; the 265 is in the plan; painted variants are in the pass row.
- B2, the roofs change after a climb and dive, and nothing measures a descent: **taken**, by the second of the eye's two ways (keep the
  detailed meshes and show them again). The first way (upgrade under 400 m by the prepare path) **not taken**: it makes swap frames at the
  roofs. `climb-above` dives to Nonstop's and Jet's floors and compares the roofs' frame with today's. One claim **not taken**: Express does
  not hold (the hold is a gear with a height, or a speed past the surge; NOSE.md, "Express holds nothing"), so Express at the roofs is not
  affected at all.
- M1, the swap's hitch judged on laptop ms with no look at the picture: **taken**. Preparing ahead is in 1b from the start; `flip-look` diffs
  each flip against Cruise's swap; the A15 is a gate before live (and a producer call, since none is owned).
- M2, the gates don't rerun the failing rows and leave out the flags: **taken**. `shots-above` is the Comet row with real Turbo 3 (by rung),
  a Lob, the flags, night and noon. Part of it run already: the hold-off night and noon rows in section 3.
- M3, paint from high up comes last: **taken in part**. The paint raster is its own stage (4), split from the far regions, with no draw cost,
  and its call goes to the producer right after Release A. It is built after stage 2, which ends cells over the ruling that every gear reaches
  today; the producer may put it first.
- M4, the Moon is outside the plan: **taken**. 1a changes the Moon's region ground too; `moon-above` is a row.
- M5, stage 5's 8 km line is a height: **taken**. Ground-plane distance, a per-tile dissolve, the shot's region kept, the 60 s descent as the gate.
- M6, "a pixel or two" is false: **taken**. The call now says about 50 game pixels at a low sun at 5 km, with frames.
- M7, the first-draw cap leaves holes: **taken**, with the core's job (section 7): the adoption waits, not only the draw.
- m1, the paint row doesn't prove colours: **taken**. Each ramp on its own, two factions, building paint at levels 2 and 3, run on Release A.
- m2, the raster must hold a palette index: **taken**. One ramp index and level per cell, by most area then newest; a crawl check.
- m3, stage 1 starts lower than 500 m: **taken**. The flip's real height is stated (about 350-400 m for regions under and behind the bus).
- m4, the order: **taken in part**. Release A first; stage 3's question now; the return start to the core's job. The raster comes after stage
  2, not before it, because the noon rows found the low band over the ruling in every gear (276 to 306 at 300 m). Trees are not last: the
  low band's breakdown put them into stage 2 (17 to 22 draws at 300 m).
