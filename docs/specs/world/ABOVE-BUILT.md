# Release A, parts 1c and 1a: as built

The plan is `docs/specs/world/ABOVE.md` on the docs branch (section 4, "Release A"). This branch, `feat/above`, holds its parts 1c and 1a and
nothing else: 1b, the gear's twin, is the next job. Cut at 4f33648. Not pushed, not merged, not flown on a phone.

The ruling this serves (CLAUDE.md, "Numbers"): 120-200 draws and 1.0-1.5 M triangles a frame, nothing compiles in flight, Safari 15 parses
the build, an A15 at 30 frames a second is the floor.

**Where it stands.** Both parts are built, reviewed once, and fixed after that review and an outside look at the frames. With the mask on, a
painted downtown seen from 14.9 km held 60 degrees down is 85 draws where it was 239, and 72 at 5 km where it was 192. Every street view
the rows shoot is 4f33648's to the pixel. What is still over the ruling is section "Still over the ruling". Nothing here has run on an
A15 or in Safari. The fixes after the review (e219ee0 to e598ddc) are code written after a review: they get a review of their own before
the merge.

## 1c. Far boxes in chunks of 8 tiles

- **What.** The far field's boxes (the city's buildings past the loaded regions, `farBlocks.ts`) are drawn one instanced draw a chunk. A chunk
  was 4 tiles a side; it is 8 now, two regions a side (`FAR_CHUNK_TILES`, `City.ts`). Each box still sinks by its own distance: the chunk only
  groups the draws.
- **Two things changed with it.** Each box's random look is seeded on a 4-tile grid whatever the chunk, so the boxes are the same boxes
  (`tools/above/farchunk-check.mjs` proves it on the far raster: "every box the same in chunks of 4 and 8"). And the chunks landed a frame
  scale with a chunk's area (2 of 8's where 8 of 4's), so a frame uploads what it did.
- **The switch.** `?farchunk=4` gives 4 back.
- **Its numbers** (the far-chunks row, round 1: downtown in Turbo 3's held frame, draws counted by kind through a wrapped
  `renderBufferDirect`, chunks of 8 against `&farchunk=4` on the same build). From 14.9 km held 60 degrees down the far boxes take 19 draws
  where they took 41 (the frame 370 where 392) and 0.035 M more triangles; at 72 degrees 29 where 78 (382 where 431), +0.038 M. At the roofs
  and 300 m a chunk of 8 is up by 1 or 2 draws where 4's were hidden, up to +0.017 M. Those frames are over the ruling for the gear's held
  detail, which is 1b's.
- **Its look.** Not pixel for pixel. Inside one instanced chunk the boxes draw in the instance's order, where three.js sorted the old chunks
  of 4 by depth between them. Where two boxes tie in depth one wins on one build and the other on the other: 9 game pixels in the `paintup`
  view. With `&farchunk=4` that view is 4f33648's to the pixel. The default street views are equal. This is a studio call (below).

## 1a. One paint mask per coarse region

**What it does.** A coarse region's merged ground carries its own paint mask: one 512 x 512 RGBA8 texture, its 16 tiles' masks side by side
(tile (i, j) of the region at texel (128 i, 128 j), as its class texture lays them). A painted tile in a coarse region is no longer split out
of the merged ground with a mesh, a class texture and a mask texture of its own. Its paint costs no draw, painting it never rebuilds the
region's ground, and a region turning coarse makes no split grounds in its frame. The sizes follow the map's `regionSize` and the tile mask's
`GROUND_N`: no San Francisco number. A map whose regions are more than 4 tiles a side runs with the mask off (one warning), since the tile
flags are a mat4.

**How it works.**
- *Two views onto one mask.* In `GroundPaint` a loaded tile has an own view (a tile ground's uniforms: today's `attach`) and a region view
  (`attachRegion`: its slot in its region's mask), either or both. A mask's life is kept apart from its views: the first view in starts it
  (the saved code decoded, its replays queued, a blast in flight joined, the Moon's copy asked for), the last view out ends it (saved, its
  replays and copy dropped, freed). Adding or dropping a second view touches nothing of the array, the jobs or what's saved. So a change of
  detail never decodes an older, lossy code over live paint, and 1b's twin can show one tile in two places.
- *Every tile of a coarse region is loaded* with a region view, painted or not. A blast joins it as it joins a detailed tile. Nothing in the
  write paths changed: the tap, the Comet, the Lob, the Bomb's wide crater, the Sonic Boom's ring, the Waterfall's pool, Curb's dabs, the QA
  seed and the Moon's copies all end in a tile mask's array and its dirty rect.
- *Uploads.* `flush` sends a mask's dirty rect to its own texture (when it has one) and to its slot in the region's mask, one
  `texSubImage2D` a dirty slot a frame, straight from the tile's array (`uploadRectFrom` in `src/render/upload.ts`, no copy). The region
  texture is made with no data (three.js allocates it with `texStorage2D`, which WebGL fills with zeros). A mask made just now, all zeros,
  into a slot never written sends nothing; a mask that already holds paint goes up whole once as it's linked; saved paint decoded onto a
  mask in a region marks its whole rect. In a region's slot the dirty rect is every texel the blast can write (its rows' reach and each of its
  dots'); a tile's own texture keeps today's box, so `?rmask=0` is today's to the texel.
- *The draw.* The region's ground gets a per-vertex tile slot (`aTile`, 4 x u8). The terrain shader (`terrainMaterial.ts`) and the Moon's
  (`moonMaterial.ts`) compute each fragment's tile uv by exactly the arithmetic a split tile's own ground used, from the same vertices, so a
  painted tile in a coarse region is drawn as its split self was: its class lookup and its paint clamped to its own square, as before. A
  uniform mat4, `uGroundSq`, flags the tiles drawn that way (GroundPaint sets a tile's bit when it has a mask; City ORs in its tiles of
  their own). An unflagged tile is drawn as the merged ground drew it. On a tile's own ground (`uTileM.x` 0) every line is today's.
- *No new program.* No define, no new shader text per material: the two programs that read ground paint stay two, warmed at boot. The
  warm-up now also draws one ground with `aTile` on the city and on the Moon, since Metal builds a pipeline per vertex layout.
- *Changes of detail.* Coarse from detailed: the region's ground attaches every tile's region view before the tiles' own grounds go, so
  the masks stay. Detailed from coarse: each tile's own view first, then the region views go. A region built again releases the old
  ground's views only after the new one's attach. Unload releases the region views (saving first). City's split loop, `groundStale` and
  the `swap ||` rule run only with the mask off.
- *The Moon.* Its region ground (`moonBoot.regionMaterial` -> `makeMoonGround`) takes the region's uniforms and the same tile path; its kept
  copies land on loaded masks and go up to the region. The map's slide moves by whole regions, so `GroundPaint.slide` rekeys the region masks
  and each tile keeps its slot. On the Moon only the paint is today's: a formerly split tile's unpainted map is its region's now, as its
  unpainted neighbours have it.

**The switch.** `config.city.regionPaint` (true), and `?rmask=0` on the page: the split ground as it was, pixel for pixel (proven against
4f33648's build, below). `?rmask=1` turns it on where the config is off. QA only: `?rmask=nofill` (region masks made, never filled) and
`?rmask=noclamp` (every tile read over the whole region), the broken variants the rows' proofs run.

**QA hooks** (`main.ts`'s `__game.city.ground`): `regionStats()`, `regionSlot(tx, tz)`, `uploadQa` (calls and bytes in the last flush).
The tools: `tools/above/s_rmask.mjs` (Node, the real GroundPaint), `paintview.mjs` and `paintcmp.py` (a painted place from the roofs to
the ceiling, mask on against `?rmask=0`), `marks.mjs` (their pass marks), `writers.mjs` (every way paint is written, over a painted
coarse region), `pvpage.mjs` (the page they stand on), `farchunk-check.mjs` (1c). `tools/shots.mjs` gains the `paintup`, `paintfar` and
`paintstreet` det views, run only when named, and `--probe` (which draw writes a pixel).

## The numbers

Measured by `tools/above/paintview.mjs` on this branch's build, two pages that differ only by `?rmask=0`: "before" is the split ground, which
the rows prove is 4f33648's picture (below), "after" the mask, the default. The paint laid once (600 settled blasts within 1,400 m of the
start, a square, ground paint only) and read at load by both pages; Cruise, noon, the sky off, the city settled; draws and triangles of the
shot frame from the game's own `perf`. Laptop GPU. 1c is on in both columns (it changes the far boxes' draws by a draw or two here: the
far-chunks row, round 1, has its own table).

| Place, pose | draws before | draws after | tiles' own grounds drawn in coarse regions, before | triangles before / after (M) |
|---|---|---|---|---|
| downtown, roofs | 125 | 119 | 7 | 0.715 / 0.715 |
| downtown, 300 m | 205 | 197 | 10 | 1.050 / 1.057 |
| downtown, 1 km | 85 | 56 | 34 | 0.584 / 0.604 |
| downtown, 5 km 60 deg | 192 | 72 | 127 | 0.884 / 0.897 |
| **downtown, 14.9 km 60 deg** | **239** | **85** | 160 | 1.021 / 1.021 |
| the Sunset's houses, roofs | 129 | 125 | 4 | 0.987 / 0.989 |
| houses, 300 m | 196 | 192 | 5 | 1.498 / 1.508 |
| houses, 1 km | 96 | 72 | 29 | 1.219 / 1.249 |
| houses, 5 km 60 deg | 197 | 83 | 123 | 1.539 / 1.556 |
| houses, 14.9 km 60 deg | 245 | 98 | 156 | 1.637 / 1.637 |
| the Moon by Tycho, 300 m | 55 | 44 | 11 | 0.770 / 0.790 |
| Moon, 1 km | 52 | 21 | 35 | 0.486 / 0.588 |
| Moon, 5 km 60 deg | 168 | 32 | 142 | 0.933 / 1.013 |

At the rig's own pitch from 5 and 14.9 km the painted ground is out of frame: the same draws both ways (downtown 36 and 22, houses 54 and
30, the Moon 15). After, every pose draws no tile's own ground in a coarse region. The plan's estimate for downtown at 14.9 km was 265 to
about 95 (on 98fca30); here 239 to 85. On the Moon the triangles rise 0.02 to 0.10 M with the mask: its region ground draws more of them
than the split tiles did (UNKNOWN why: not looked into).

**A big blast** (a Bomb III's crater, radius 459 m, from 1 km on the least painted coarse region within 1.6 km, 10 of its 16 tiles painted,
every frame for 4 s):

| | before | after |
|---|---|---|
| worst frame's draws | 89 | 56 |
| region grounds made again in the 4 s | 5 | 0 |
| textures made | 17 | 0 |
| geometries (net) | +8 | 0 |
| programs made | 0 | 0 |
| worst frame's paint uploads (the game's own `texSubImage2D` calls) | 17 calls, 167 KiB | 17 calls, 155 KiB |

Before, the count misses what three.js uploads whole for each new split tile (its mask and class textures, its mesh, its region's merged
ground made again). After, there is nothing it misses. Before the review's fix the after column's worst frame was 576 KiB: each tile a blast
reached in a coarse region sent its whole slot, zeros or not. In Node (`s_rmask`, a Bomb III over 3 x 3 unpainted coarse regions, 36 masks
made in one frame) it was 36 calls and 2,304 KiB in one frame; now the worst frame is 4 calls and 252 KiB.

**Memory.** A region mask is `(128 x regionSize)^2 x 4` bytes of GPU memory, 1 MiB for San Francisco's regions of 4 x 4 tiles, with no CPU
copy. It is made when a coarse region's first tile gets a mask, and that happens for every tile a blast's box reaches, even where the blast
paints nothing; it goes with the region's ground. Before, each painted tile in a coarse region cost its own mask texture (64 KiB) and its own
ground (16 KiB of mesh and class texture in downtown, 4 KiB on the Moon). `aTile` adds 4 bytes a vertex to every coarse region's ground with
the mask on, painted or not: about 18.5 KB a city region and 70 KB a Moon region (ESTIMATE from the grids: 16 x 289 and 16 x 1,089
vertices). Both sides keep each loaded painted tile's 64 KiB CPU array.

| Measured (paintview's count, from 1 to 14.9 km) | before | after |
|---|---|---|
| downtown, 160 painted tiles, 19 coarse regions loaded | 160 mask textures and 160 own grounds: 12.5 MiB | 14 region masks: 14 MiB |
| the Sunset's houses, 156 painted tiles | 12.2 MiB | 14 MiB |
| the Moon, 178 painted tiles | 11.9 MiB | 16 MiB |

So a region with more than about 13 painted tiles cost more before, and one with fewer costs more now. A whole painted city: only the
loaded coarse regions hold a mask, at most the loaded set, about 20 regions here, so about 20 MiB (ESTIMATE). Safari's own GPU memory was
not measured.

**The read back.** Every region mask on the GPU against its tiles' arrays, after every pose, the blast, a lost GL context and every writer
step: 0 bytes differing, every time (up to 14 regions and 216 slots in one read).

## What ran, and what it printed

Every row ran alone through the suite's gate script, the browser rows one at a time under the machine's one GPU lock. B is this branch's
build (`main-jqctVSnz.js`, made at 05e779d's tree: the commits after it change tools and docs only). R is 4f33648's build. A row's exit
decides.

**Node** (this branch):

| Row | Exit | What it printed |
|---|---|---|
| tsc | 0 | nothing |
| s_rmask | 0 | "s_rmask: all passed": 18 rows. New: a Bomb III over 3 x 3 unpainted coarse regions, "masks 36, frames 88, worstFrame 18, worstCalls 4, worstKiB 252" |
| s_rmask's proofs (each a scratch edit, then put back) | 1, 1, 1 | without the zero skip: "worstCalls 36, worstKiB 2304"; without the write box: Curb's dabs, the stale clear and the blast in flight 38 bytes off; without the decode's whole rect: saved paint at load 120,890 bytes off |
| farchunk-check | 0 | "farchunk: every box the same in chunks of 4 and 8" |
| moon-paint | 0 | "all pass" (the Moon's paint kept by place, in Node) |
| marks-proof | 0 | the mask-on houses pass; the same file's `?rmask=0` tag exits 1 ("MARKS FAILED: 7"); the blast before the fix exits 1 ("576 KiB, off's 213 KiB") |

**Browser** (B unless named):

| Row | Exit | What it printed |
|---|---|---|
| build | 0 | vite's chunk-size warning only |
| iosfloor | 0 | "iOS 15.0 parses every chunk" |
| det-skyoff (the eight street views, R against B, the mask on) | 0 | "det-cmp: 8 of 8 views pass" |
| det-street (paintstreet, R against B) | 0 | "1 of 1 views pass"; "6 painted tiles loaded, 5 of them in coarse regions; 8 m off the ground" |
| det-street-nofill-proof (region masks never filled) | 1 | "DIFFERENT: 2241 px": so that street frame shows paint drawn from the region masks, and with the mask on it is R's to the pixel |
| det-street-noclamp-proof | 0 | equal: a read across the tiles' seams changes nothing that frame shows |
| det-street-0 (`?rmask=0&farchunk=4`) | 0 | "1 of 1 views pass" |
| probe-far (paintfar's differing pixels, R and B) | 0 | a report: section "The review" |
| paint-above (downtown: on, `?rmask=0` twice; its blast and a lost context; marks) | 1, then 0 | first run: "paintview: passed", "paintcmp downtown: 5 of 7 poses pass" (the bay at 5 km, 763 px, the same between the two `?rmask=0` pages; 19 px at 300 m, cluster 9) and the marks all passed, the blast's worst frame 155 KiB against today's 167. Then, with paintcmp's noise floor and bus mask: "7 of 7 poses pass" (2 px at 5 km 60 deg, 0 elsewhere, nothing left out) and "marks: downtown on: all passed"; programs 35 at ready and at the end on every page; the lost context's read back 0 bytes differing |
| draws-paint (the Sunset's houses: on, `?rmask=0` twice; marks) | 1, then 0 | first: paintcmp failed the roofs on a ramp the second `?rmask=0` page differed in by as much (4,099 px between the two); with the ramp check floored, "7 of 7 poses pass" (0 to 5 px) and "marks: houses on: all passed" (the houses' listed cells at their numbers) |
| moon-above (`?moon&site=TYCHO`: on, `?rmask=0` twice, a blast) | 0 | "paintview: passed"; "paintcmp moon: 4 of 4 poses pass" (2, 3, 0 and 1,452 px at 5 km 60 deg, none of those in the noise floor; ramps within 0.89 %); the blast's marks pass when run by hand (worst frame 29 draws, 258 KiB against today's 258, 2 textures made, both region masks) |
| writers | 1, then 0, 0 | first: three of its own checks were wrong (the Boom's ring lands 3.5 km off, so the loaded set's count fell; Curb's dabs land on paint already there; the reload compared loaded sets that differ). Fixed in the tool, then "writers: passed" twice: every step's read back 0 bytes differing, own grounds 0, region grounds made again only where the step changes the level of detail; the swap's 160 tiles equal the page with no swap |
| writers-proof (`?rmask=0`, tap and bomb) | 1 | "55 draws of tiles' own ground in coarse regions", "1 region grounds made again", then 56 and 8 |
| warm-plain | 0 | "warmcheck: passed": no program after the warm-up, which now draws the ground with `aTile` too |

Run in round 1 or 2 on builds whose src these fixes don't change for that row, and not again here: det-golden (8 of 8), det-far (6 far
views, 1c), rmask-off (the eight views with `?rmask=0&farchunk=4` against R: 8 of 8), det-up-0 and det-far-0 (paintup and paintfar, the
switch off, against R: equal), far-chunks (1c's draws), budget, budget-bomb, the warm rows for the Comet, the crew's Bomb and Lob, the
extras and Curb (all exit 0). The fixes touch GroundPaint's upload path, the warm list and tools; det-skyoff, det-street, paint-above,
draws-paint, moon-above, writers and warm-plain are the rows that see those, and they ran on B.

## What did not run

- An A15, Safari, Safari's GPU memory, Metal's pipelines, frame times. Nothing here can stand in for them (ABOVE.md section 8). Laptop ms
  are printed by the rows as reports only.
- A frame of the bridges' paint: it is building paint, which 1a doesn't touch.
- The Moon with `?rmask=0` against 4f33648's build: no row compares them (moon-above compares the mask with `?rmask=0`, both on this build).
  By reading, the Moon shader with `uTileM.x` 0 runs today's arithmetic.
- The plan's rows that belong to 1b: shots-above, climb-above, flip-look, warm-above's gear climb.
- warm-moon and moon-keep's heavy row fail on 4f33648's build too (round 2 ran both on R: the same throw, the same row), so they say
  nothing about 1a. Each needs its own fix, outside this job.
- A frame where a region's edge is marked: the paint is a 2.8 km square laid over many region edges, and no frame shows a line, but none
  marks where one lies.

## Still over the ruling, and what ends it

With the mask on, the painted downtown from above is inside the ruling at every pose here. Still over:
- The Sunset's houses held 60 degrees down from 5 and 14.9 km: 1.556 and 1.637 M triangles (draws 83 and 98, inside). The houses' coarse
  meshes are the heaviest per region measured. Stage 3 (shadows from high up, a producer call) takes about 0.4 M, then stage 5 (far regions
  drawn by the far field).
- Any gear's climb, unpainted or painted: the gear holds the street's detail to the ceiling (300 to 435 draws looking down). That is 1b.
- 300 m in a gear at noon (about 205 settled, 276 to 289 in flight): stage 2, the low band.
- Inside the ruling but over BUILD-A's own tighter marks, listed by name in `tools/above/marks.mjs`: downtown 5 km 60 deg 72 draws (mark
  70), downtown 14.9 km 60 deg 1.021 M (mark 1.0 M), houses 5 km 60 deg 83 draws.

## What 1b will need from 1a

- `GroundPaint.regionUniforms(rx, rz, n)` gives one uniforms object a region, counted in `grounds`: a twin's ground takes the same object,
  and the mask lives while either ground does.
- `attachRegion` never touches an own view and `detach` keeps a mask a region view holds, so one tile can be shown by its detailed ground
  and its region's twin at once; `flush` sends a dirty rect to both (s_rmask has that case).
- `City.buildRegionGround` is still one function: it makes the merged mesh and material and takes the tiles over (`dropTileTerrain`). 1b
  splits it. `regionViewsOn(key)` is the part a twin calls, `regionViewsOff` releases it. `takeGrid` consumes a tile's worker grid, so a twin
  brings its own grids.
- Nothing marks a region stale with the mask on, so a twin is never made again for paint. `uGroundSq` is GroundPaint's, set for every tile
  with a mask, and City ORs in its tiles of their own (`flagRegionTile`).
- A twin's first fill: its painted tiles' slots, 64 KB each, up to 16 calls in one flush; `GroundPaint.fillBytes` counts what an adoption
  adds, and a twin adoption adds it to its byte budget the same way. Fresh masks send nothing now.
- Two things its rows should know: a settled blast on a tile no view shows keeps only GroundPaint's last few blasts (`MAX_PENDING`; with the
  mask on every tile of a coarse region is loaded, so it no longer bites there); and the masks for unpainted tiles a blast's box reaches
  cost a region its 1 MiB even where nothing is drawn.

## The review, and the look, and what became of them

The branch had one code review (12 findings: no blocker, four majors) and one outside look at 18 pairs of frames (6 findings). Each was
checked first.

| Finding | Held? | What became of it |
|---|---|---|
| R1 major: a big blast over unpainted coarse ground sends about 2.3 MiB of zeros in one frame | yes (s_rmask: 36 calls, 2,304 KiB) | fixed, e219ee0: a fresh mask into a slot never written sends nothing; saved paint decoded marks its whole rect; the region slot's dirty rect covers every texel a blast writes (it missed 38 bytes of a dab). Worst frame 252 KiB in Node; 155 KiB on the page against today's 167 |
| R2 major: draws-paint and the blast row can't fail on their marks | yes | fixed, a0117a7: `tools/above/marks.mjs` in both rows, cells over a mark listed by name with their number and the stage that ends them; its proof row exits 1 on today's split ground and on the blast before the fix |
| R3 major: the writers row was never built | yes | fixed: `tools/above/writers.mjs` and its row (above) |
| R4 major: the street rule unproven where 1a acts; paintfar 27 px off R | partly: the rule was unproven; the guessed cause (a draw-order tie) was wrong | the street view built (paintstreet: equal to R, and its nofill proof differs by 2,241 px, so 1a's paint is in that frame). The 27 px probed: the same draws write those pixels in the same order on both builds, the last being the tile's ground, its own on R and the merged region ground on B, and the G-buffer value differs in its first channel only. So it is the merged ground's own arithmetic at three pixels on tile seams, 400 m up, on unpainted ground (likely: R's split tile is meshed again on the main thread, the region keeps the worker's grid; not proven). A call below |
| R5 minor: paint-above exits 1, its cause a guess | yes | the row now shoots `?rmask=0` twice: the bay's 763 px at 5 km differ between those two as well, so they are today's own noise; paintcmp takes that noise floor out (`--floor`).; and the bus is left out (`--nobus`). In the run after, both were 0 and the row exits 0 |
| R6 minor: 1c is not pixel for pixel | yes | a call below |
| R7 minor: a vertex layout no warmed mesh has | yes | fixed, 05e779d: the warm-up draws a ground with `aTile` on the city and on the Moon. Its effect on Metal can't be measured here |
| R8 minor: no row guards City's call order across a change of detail | yes | covered: writers' swap step lays a Bomb III's crater on the bus's region and takes the bus to the roofs 0.3 s into its wave, so the region turns detailed while it draws, then climbs back; its 160 tiles' arrays equal a page with no swap, byte for byte |
| R9 minor: 5dce203's title overclaims ("Release A 1a's rows closed") | yes | not rewritten (history is not rewritten here); said here: at 5dce203 writers, warm-above, mem-region and blast-worst were not built, and paint-above, moon-keep and warm-moon exited 1 |
| R10 minor: `?rmask=0` on the Moon not compared with R | yes | not done (see "What did not run") |
| R11 minor: memory the note left out | yes | in "Memory" above: `aTile` on every coarse region's ground, and the 1 MiB of a region whose only masks hold nothing |
| R12 minor: the ASK isn't in the repo | yes | it is in this file (below); docs/TODO.md's line for this job is the merge's |
| L1 minor: the Moon at 5 km 60 deg, about 1,437 one-shade pixels | yes, and not noise: moon-above's second `?rmask=0` page differs from the first by 258 px there, none of them these | by design: a formerly split tile's unpainted map is its region's now (its own cut had its own mips), as the build plan said. The ramps are within 0.9 % |
| L2 minor: water glints differ over the bay | yes | today's own noise (R5) |
| L3 major (to check): the houses' paint ends in straight lines | checked: not a clip | the QA seed lays its blasts in a square (`seedGround`: x and z each uniform within the spread). Both sides draw the same square |
| L4 minor: the paint reads as confetti from the top | yes, the seed's | not changed: it is how the test paints. A real flown trail from above is for the producer's phone |
| L5 minor: four poses show no paint | yes | not counted as paint evidence above |
| L6 (what it couldn't see): a change of detail, a fresh write, a marked region edge | yes | writers covers a change of detail with paint in flight and every writer, by the read back and the arrays, not by eye; no frame marks a region edge |

## Calls for the producer, with the studio's pick

1. **1c's few tie pixels.** Inside one chunk of 8 the far boxes draw in their instance order, so where two far boxes tie in depth the
   other one wins: 9 game pixels in one view from above, none in the street views. Studio's pick: accept them. The other way keeps chunks of
   4 near the loaded edge and 8 beyond, for about half the saving.
2. **Three seam pixels on unpainted ground from 400 m** (R4): a painted coarse region's ground is now its merged mesh, where today a
   touched tile was meshed again on its own; at three G-buffer pixels on tile seams in one view the shade differs by a step. Studio's pick:
   accept. Matching them would mean meshing those tiles apart again, which is the draw 1a takes away.
3. **The Moon's formerly split tiles take their region's map** (L1): about 1,450 single pixels a step lighter or darker at 5 km held 60
   degrees down, no change of colour or extent. Studio's pick: accept.

Each is invisible at phone size in the outside look. The phone decides.

## ASK for the second account

- `GroundPaint` has region views: a tile can be loaded with no ground of its own. Code that reads `city.ground` only through `sample`,
  `begin`, `land`, `dab` and `blast` is unaffected. Code that calls `attach`/`detach` or `City.setOwnGround`, or counts tile grounds as
  painted tiles, must use the views (`attachRegion`, `detachRegion`, `regionUniforms`, `releaseRegion`). None is on this base.
- `GLSL_GROUND_PAINT` is `sbGroundPaint(wp, uv, off, n, ...)`: the tile's own uv, its first texel and a scale. The terrain and the Moon's
  near ground read `uTileM` and `uGroundSq`; their defaults keep any material that doesn't set them as it was. The Moon's near ground takes
  `aTile` (`makeMoonGround`'s `ground` may carry `uTileM` and `uGroundSq`).
- Paint lands in a coarse region without splitting it: anything that waited for a tile ground to appear to know a tile was painted should
  ask GroundPaint (`has`, `regionSlot`).

## UNKNOWN

- Everything on an A15 or in Safari: frame times, Metal's pipelines for the `aTile` layout, GPU memory for the region masks.
- Why the Moon's region ground draws 0.02 to 0.10 M more triangles than its split tiles did.
- Whether R4's three pixels come from the split tile's grid being meshed again on the main thread (the likely cause, by reading
  `City.takeGrid`); not proven.
- Whether the region masks for unpainted tiles a blast reached matter for memory in long sessions on a phone (each region 1 MiB).
- 1c's draws at the roofs and 300 m were counted in Turbo 3's held frames only (round 1's far-chunks).
