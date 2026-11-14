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
  mask in a region marks its whole rect. The dirty rect is every texel the blast can write (its rows' reach and each of its dots'), in a
  region's slot and in a tile's own texture alike. Today's box, kept for own textures at first, missed a dab's edge texels: they were saved
  and not shown until the tile's next whole upload (second review, R2-4). So `?rmask=0` is 4f33648's picture except where today's box
  missed texels a blast wrote, which on the rows' pages is Curb's dabs (`?life`) alone (below).
- *The draw.* The region's ground gets a per-vertex tile slot (`aTile`, 4 x u8). The terrain shader (`terrainMaterial.ts`) and the Moon's
  (`moonMaterial.ts`) compute each fragment's tile uv by exactly the arithmetic a split tile's own ground used, from the same vertices, so a
  painted tile in a coarse region is drawn as its split self was: its class lookup and its paint clamped to its own square, as before. A
  uniform mat4, `uGroundSq`, flags the tiles drawn that way (GroundPaint sets a tile's bit when it has a mask; City ORs in its tiles of
  their own). An unflagged tile is drawn as the merged ground drew it. On a tile's own ground (`uTileM.x` 0) every line is today's.
- *No new program.* No define, no new shader text per material: the two programs that read ground paint stay two, warmed at boot. The
  warm list now also holds one ground with `aTile` on the city and on the Moon, since Metal builds a pipeline per vertex layout. What the
  rows show: no program is made after ready on the city (warm-plain) or on the Moon (moon-programs, over moon-above's poses, where the
  region ground draws with `aTile`). three.js keys a program by its material, not by a custom attribute, so that could not fail on `aTile`
  in WebGL; that the Moon's warm-up draws the `aTile` mesh, and what it does for Metal, no row here shows (warm-moon can't finish, on R too).
  The city's warm mesh is on the shadow layer and the real coarse ground is not: the depth override doesn't read `aTile`, but it breaks
  warmup.ts's "same layers" (left as is, for the next look at the warm list).
- *Changes of detail.* Coarse from detailed: the region's ground attaches every tile's region view before the tiles' own grounds go, so
  the masks stay. Detailed from coarse: each tile's own view first, then the region views go. A region built again releases the old
  ground's views only after the new one's attach. Unload releases the region views (saving first). City's split loop, `groundStale` and
  the `swap ||` rule run only with the mask off.
- *The Moon.* Its region ground (`moonBoot.regionMaterial` -> `makeMoonGround`) takes the region's uniforms and the same tile path; its kept
  copies land on loaded masks and go up to the region. The map's slide moves by whole regions, so `GroundPaint.slide` rekeys the region masks
  and each tile keeps its slot. On the Moon only the paint is today's: a formerly split tile's unpainted map is its region's now, as its
  unpainted neighbours have it.

**The switch.** `config.city.regionPaint` (true), and `?rmask=0` on the page: the split ground as it was, pixel for pixel (proven against
4f33648's build, below), but for one fix that is on both ways: a blast's dirty rect on a tile's own texture now covers every texel it
writes (R2-4), so where 4f33648 left a dab's edge texels off the GPU until the next whole upload, this branch shows them at once. Only those
edges can differ, and of the writers only Curb's dab (`?life`) was found to leave any. `?rmask=1` turns it on where the config is off. QA only: `?rmask=nofill` (region masks made, never filled) and
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
about 95 (on 98fca30); here 239 to 85. Where the triangles rise with the mask (the houses at 300 m by 9,728, the Moon by 0.02 to 0.10 M), all of the rise is in the region
grounds (paintview's triangles by kind): with `?rmask=0` a painted tile of a coarse region is meshed on its own at the same 8 m step the
merged grid uses, and three culls each such tile alone; a region whose loaded tiles are all painted has no merged ground at all. With the
mask the region's whole grid is one mesh, culled whole, so its tiles out of the view draw too. The houses at 300 m: on 32,768 region
triangles against `?rmask=0`'s 20,480 + 2,560 split, 19 tiles' worth. The Moon at 1 km: 327,680 against 153,600 + 71,680, with 58 of the
drawn region grounds' tiles out of the view (118,784 triangles).

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
step: 0 bytes differing, every time (up to 18 regions and 288 slots in one read, the Moon's blast).

## What ran, and what it printed

Every row ran alone through the suite's gate script (sb-checks/world/above/a on the laptop), the browser rows one at a time under the
machine's one GPU lock. B is this branch's build after the second review's fixes (`main-Bmv32K1C.js`, made at c308a3e's tree: the commits
after it change tools and docs only). R is 4f33648's build. A row's exit decides. The runs after the first review are in the suite's
NOTE-fix.md; these are the runs after the second (NOTE-fix2.md).

**Node** (this branch):

| Row | Exit | What it printed |
|---|---|---|
| tsc | 0 | nothing |
| s_rmask | 0 | "s_rmask: all passed": 21 rows. New: "fillBytes added by the attach equals what the first flush sends to the slots it queued whole" (1,728 KiB counted, 1,728 KiB sent to those 27 slots); "writers on tiles already up: each own texture on the GPU equals its array" (dabs, a settled blast, a tap: 0 bytes off each) |
| s_rmask's proofs (scratch edits, put back) | 1, 1 | without R2-1's count: "fillKiB 0, slots 0, flushKiB 1978.1"; without R2-4's box on own textures: "ownBytesOff dabs 4, settled 0, tap 0" |
| farchunk-check | 0 | "farchunk: every box the same in chunks of 4 and 8" |
| marks-proof | 0 | "exits: on 0 (0 wanted), off 1 (1 wanted), round 2's blast 1 (1 wanted)" |
| marks-doctor (13 doctored copies of the kept json) | 0 | "every case as wanted (13)": a missing marked pose, field or pose list, a renamed pose, a listed cell one triangle or draw worse, a pose over 1.5 M, net geometry in the blast: each exit 1 |
| moon-programs (moon-above's json) | 0 | "programs at ready 33", 33 at every pose with the region ground drawn (5, 10, 4 and 23 draws), "blast: programs made 0" |

**Browser** (B unless named):

| Row | Exit | What it printed |
|---|---|---|
| build, iosfloor | 0, 0 | vite's chunk-size warning only; "iOS 15.0 parses every chunk" |
| det-skyoff, det-golden (the eight street views, R against B, the mask on) | 0, 0 | 8 of 8 each |
| rmask-off (the eight views, `?rmask=0&farchunk=4`, against R) | 0 | "det-cmp: 8 of 8 views pass": R2-4's box changes no street frame |
| det-street, det-street-0 (paintstreet, R against B, the mask on and off) | 0, 0 | 1 of 1 each |
| paint-above (downtown: on, on2, `?rmask=0` twice; its blast, a lost context; marks) | 1 | on vs off at the plan's limits, each side floored by its own repeat: "7 of 7 poses pass" (2 px at 5 km 60 deg, 0 elsewhere, nothing in the floor); off vs again "7 of 7" (0 px everywhere); **on vs on2 "6 of 7": 300 m, 19 px, cluster 9**; marks all pass, the blast's "geometries made, net 0" among them; the blast's worst frame 155 KiB against `?rmask=0`'s 167 |
| draws-paint (the Sunset's houses: on, on2, `?rmask=0` twice; marks) | 1, 1 | two runs. on vs off "7 of 7" both times (0 to 2 px; at 300 m the 5 px the review saw are in the mask-on page's own floor); off vs again "7 of 7", 0 px, both times; **on vs on2: 300 m 37 px (cluster 32) and 1 km 20 px the first time, 300 m 5 px (cluster 5) the second**; "marks: houses on: all passed" |
| diag-particles (houses 300 m and 1 km, on and on2, the particles hidden) | 0 | "0 game px differ" at both poses |
| moon-above (`?moon&site=TYCHO`: on, `?rmask=0` twice, a blast) | 0 | "paintview: passed", "paintcmp moon: 4 of 4 poses pass"; the blast: 2 region masks made, 258 KiB, "read back after: 18 regions 0 bytes differ" |
| writers | 0 | "writers: passed"; the swap's 160 tiles equal the page with no swap |
| warm-plain | 0 | "warmcheck: passed" |
| warm-moon, warm-moon-R | 1, 1 | the same output on B and R: warmcheck.mjs throws at `centre('mega')` (`[data-hud="mega"]` has no box) in the Moon's script, after "its report never counted every program the renderer has" |

**What the pixel rows say.** At the plan's limits (cluster 4, none outside the paint's box) and with each side floored by its own repeat,
the mask draws the painted downtown and houses as `?rmask=0` does at every pose: 0 to 2 game pixels, never a cluster over 2. The rows still
exit 1, on their own floor run: the mask-on page, loaded twice, differs from itself at 300 m in all three runs (and once at 1 km), in
clusters of 5 to 32 game pixels, while the `?rmask=0` page repeats to the pixel every time. The pixels are grey on one load where the
other shows paint or a lighter grey, at the same screen spots in both places (game x 180 to 240, y 400 to 460 at 300 m), and with the
particles hidden the two mask-on loads are equal (diag-particles). So it is the bus's particles: they take Math.random after every
object made, and on the mask-on page what is made before them varies between loads. Why it varies there and not on the split ground is
not known. The review's 5 px at 300 m are that noise: on a detailed tile 80 m from its nearest seam (paintview's `--at`), not a seam of
the merged ground, so not the producer's call 2. The limits stay the plan's; a row can't pass until the particles repeat or are left out.

## What did not run

- An A15, Safari, Safari's GPU memory, Metal's pipelines, frame times. Nothing here can stand in for them (ABOVE.md section 8). Laptop ms
  are printed by the rows as reports only.
- A frame of the bridges' paint: it is building paint, which 1a doesn't touch.
- writers' frame per step against a `?rmask=0` page (BUILD-A's "the paint shows from above" after each step, second review R2-5). writers
  keeps a frame per step and compares none. Doing it means writers run on a `?rmask=0` page with its own checks set aside (they fail there
  by design: its proof row), each page twice for the noise floor, and the bus's box, which writers doesn't record: four runs of about
  2.3 minutes under the shared GPU lock and new plumbing in two tools, not a small change. What stands in for it: every step's read back
  (the region masks on the GPU equal the arrays, 0 bytes) and paint-above and draws-paint, which compare that same drawing path's frames.
- The Moon with `?rmask=0` against 4f33648's build: no row compares them (moon-above compares the mask with `?rmask=0`, both on this build).
  By reading, the Moon shader with `uTileM.x` 0 runs today's arithmetic.
- The plan's rows that belong to 1b: shots-above, climb-above, flip-look, warm-above's gear climb.
- warm-moon and moon-keep's heavy row fail on 4f33648's build too (round 2 ran both on R, and warm-moon ran on B and R again after the
  second review: the same output, a throw in warmcheck's Moon script), so they say nothing about 1a. Each needs its own fix, outside this
  job. So the Moon's warm draw with `aTile` is unproven (moon-programs shows only that no program comes after ready).
- A frame where a region's edge is marked: the paint is a 2.8 km square laid over many region edges, and no frame shows a line, but none
  marks where one lies.

## Still over the ruling, and what ends it

With the mask on, the painted downtown from above is inside the ruling at every pose here. Still over:
- The Sunset's houses at 300 m in Cruise: 1.508 M triangles with the mask, 1.498 M with `?rmask=0` (192 and 196 draws). 1a takes it over
  the 1.5 M: the merged region grounds draw their tiles out of the view (the numbers, above). A draw range or groups per view over the
  merged grid would cull them, but that is new work every frame on every coarse region's ground, the street's included: not a small fix,
  so not done here. `tools/above/marks.mjs` holds every pose to 1.5 M and lists this one at 1,507,871, so it can't get worse unseen. Stage 3
  (shadows from high up) takes it back under, by the plan's estimate.
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
- A twin's first fill: its painted tiles' slots, 64 KB each, up to 16 calls in one flush; `GroundPaint.fillBytes` counts every whole slot
  queued (a mask linked to a slot written before, saved paint decoded onto a slot, the Moon's copy put on one: `wholeSlot`), and a twin
  adoption adds it to its byte budget the same way. Fresh masks send nothing now. (Between e219ee0 and the second review's fix the decoded
  paint and the Moon's copies went up uncounted: R2-1.)
- Dropping one tile's region view while its region lives leaves its slot flagged in `uGroundSq` and its paint in the region texture: nothing
  sets a flag back to 0 (second review, R2-7; Node: after `detachRegion(1, 1)` the flag is still 1 and 4,427 painted texels stay, the region
  alive). 1a can't reach it, since City drops a region's views all at once and frees the texture. 1b's twin keeps a region alive under
  detailed tiles, so if it ever drops one tile's region view, `detachRegion` must clear that tile's flag and queue a zero fill of its slot
  when the region stays.
- Two things its rows should know: a settled blast on a tile no view shows keeps only GroundPaint's last few blasts (`MAX_PENDING`; with the
  mask on every tile of a coarse region is loaded, so it no longer bites there); and the masks for unpainted tiles a blast's box reaches
  cost a region its 1 MiB even where nothing is drawn.

## The review, and the look, and what became of them

The branch had one code review (12 findings: no blocker, four majors) and one outside look at 18 pairs of frames (6 findings). Each was
checked first.

| Finding | Held? | What became of it |
|---|---|---|
| R1 major: a big blast over unpainted coarse ground sends about 2.3 MiB of zeros in one frame | yes (s_rmask: 36 calls, 2,304 KiB) | fixed, e219ee0: a fresh mask into a slot never written sends nothing; saved paint decoded marks its whole rect; the region slot's dirty rect covers every texel a blast writes (it missed 38 bytes of a dab). Worst frame 252 KiB in Node. On the page, the case itself (masks made in the blast's frames) is the Moon's blast: 2 region masks made, 258 KiB against `?rmask=0`'s 258, read back 0 bytes differing; downtown's blast (155 KiB against 167) makes no region mask, so it doesn't show this fix. The second review found the skip had taken decoded paint and the Moon's copies out of `fillBytes`: counted again since (R2-1) |
| R2 major: draws-paint and the blast row can't fail on their marks | yes | fixed, a0117a7: `tools/above/marks.mjs` in both rows, cells over a mark listed by name with their number and the stage that ends them; its proof row exits 1 on today's split ground and on the blast before the fix |
| R3 major: the writers row was never built | yes | fixed: `tools/above/writers.mjs` and its row (above) |
| R4 major: the street rule unproven where 1a acts; paintfar 27 px off R | partly: the rule was unproven; the guessed cause (a draw-order tie) was wrong | the street view built (paintstreet: equal to R, and its nofill proof differs by 2,241 px, so 1a's paint is in that frame). The 27 px probed: the same kinds of draw write those pixels in the same order on both builds (not the same draws: at (61, 429) R's are draws 0, 44, 68 and 90, B's 0, 44, 58 and 77), the last being the tile's ground, its own on R and the merged region ground on B, and the G-buffer value differs in its first channel only. So it is the merged ground's own arithmetic at three pixels on tile seams, 400 m up, on unpainted ground (likely: R's split tile is meshed again on the main thread, the region keeps the worker's grid; not proven). A call below |
| R5 minor: paint-above exits 1, its cause a guess | yes | the row now shoots `?rmask=0` twice: the bay's 763 px at 5 km differ between those two as well, so they are today's own noise; paintcmp takes that noise floor out (`--floor`).; and the bus is left out (`--nobus`). In the run after, both were 0 and the row exits 0 |
| R6 minor: 1c is not pixel for pixel | yes | a call below |
| R7 minor: a vertex layout no warmed mesh has | yes | 05e779d puts a ground with `aTile` in the warm list on the city and on the Moon. warm-plain passes on the city. On the Moon no warm row finishes (warm-moon throws the same way on R); moon-programs shows no program after ready there, which `aTile` could not cause in WebGL anyway. The draw itself and its effect on Metal are unproven here |
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

## The second review, and what became of it

A review of the fixes (seven findings: no blocker, one major). A second engineer tried to refute the major and could not.

| Finding | What became of it |
|---|---|
| R2-1 major: saved paint decoded onto a region slot, and the Moon's copies, went up whole without adding to `fillBytes`, so the adoption budget missed up to 1 MiB a region | fixed: `GroundPaint.wholeSlot` counts each whole slot where it is queued (the link, the decode, `attachGeo`), the same bytes sent. s_rmask's new row: what the attach adds equals what the first flush sends to those slots (it fails without the fix). `attachGeo`'s count is by reading: Node has no GeoPaint |
| R2-2 minor: the pixel rows ran at loosened limits, the floor was one side's and unbounded | fixed in the tool and the rows: each side floored by its own repeat, the plan's limits, a floor over 0.05 % of the frame fails, the floor runs keep their exits. They now exit 1 on the mask-on page's own repeat (particles; "What the pixel rows say", above). The review's 5 px are that noise, not a seam |
| R2-3 minor: marks.mjs passed on missing poses and fields, allowed 2 %, dropped "no geometry made" | fixed: missing poses and fields fail, no slack (two runs of one build read the same numbers), every pose held to 1.5 M, net geometry in the blast fails; marks-doctor proves each. The Moon's "geometries net 4" are four roof sprouts' meshes made 7.95 s into the blast, on the mask-on page and on `?rmask=0` alike: not ground paint's |
| R2-4 minor: a dab's edge texels missed the GPU on own textures | fixed: every dirty rect is the blast's write box. Of the writers through it (a landed blast that isn't wide, replays, Curb's dab, the Waterfall's pool) only the dab was found to miss texels; a plain page makes no dab. The street's rows against R hold, mask on and off |
| R2-5 minor: writers compares no frame | not done: "What did not run" |
| R2-6 minor: claims no run supported | corrected above: `fillBytes`, the houses at 300 m (now "Still over the ruling", with its cause and a mark), the warm-up on the Moon (unproven), the blast that shows R1's fix (the Moon's), s_rmask's rows, the read back's largest, the Moon blast's marks, the probe's draws |
| R2-7 minor, for 1b: one tile's region view dropped while its region lives keeps its slot flagged and painted | in "What 1b will need from 1a" |

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
- Why the bus's particles differ between two loads of the mask-on page and not of the split ground (the pixel rows' own floor runs).
- Whether R4's three pixels come from the split tile's grid being meshed again on the main thread (the likely cause, by reading
  `City.takeGrid`); not proven.
- Whether the region masks for unpainted tiles a blast reached matter for memory in long sessions on a phone (each region 1 MiB).
- 1c's draws at the roofs and 300 m were counted in Turbo 3's held frames only (round 1's far-chunks).
