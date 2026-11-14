# Release A, parts 1c and 1a: as built

The plan is `docs/specs/world/ABOVE.md` on the docs branch (section 4, "Release A"). This branch, `feat/above`, holds its parts 1c and 1a and
nothing else: 1b, the gear's twin, is the next job. Cut at 4f33648. Pushed 2026-11-14, after its whole table ran at the head ("The
whole table at the head", below). Not merged, not flown on a phone.

The ruling this serves (CLAUDE.md, "Numbers"): 120-200 draws and 1.0-1.5 M triangles a frame, nothing compiles in flight, Safari 15 parses
the build, an A15 at 30 frames a second is the floor.

**Where it stands.** Both parts are built, reviewed once, and fixed after that review and an outside look at the frames. With the mask on, a
painted downtown seen from 14.9 km held 60 degrees down is 85 draws where it was 239, and 72 at 5 km where it was 192. Every street view
the rows shoot is 4f33648's to the pixel. What is still over the ruling is section "Still over the ruling". Nothing here has run on an
A15 or in Safari. The fixes after the review (e219ee0 to e598ddc) are code written after a review: they get a review of their own before
the merge. After the second review and a check of its fixes, the src changes stand; what changed after 325573d is tools, comments and this
doc. One pixel row, draws-paint, still exits 1 on its own floor runs, on load noise both pages share (section "What the pixel rows say").

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
  of 4 by depth between them. Where two boxes tie in depth one wins on one build and the other on the other: one game pixel in the `paintup`
  view (det-cmp's "9 px" are the frame's at 3x, one 3 by 3 block at game pixel 275, 276; this doc said nine game pixels before the whole
  table). With `&farchunk=4` that view is 4f33648's to the pixel. The default street views are equal. This is a studio call (below).

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
  region's slot and in a tile's own texture alike. Today's box, kept for own textures at first, missed the edge texels of a dab-sized blast
  with spatter (s_rmask's): they were saved and not shown until the tile's next whole upload (second review, R2-4). Curb's dab as main.ts
  makes it (no dots or blobs) and taps did not miss any in Node, so `?rmask=0` matches 4f33648 on every writer a page reaches (below).
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
writes (R2-4), so where 4f33648 left a small blast's spatter edge texels off the GPU until the next whole upload, this branch shows them at
once. No writer a page reaches was found to leave any: s_rmask's dab-sized blast with spatter did; Curb's dab as main.ts makes it and taps did
not (the third check, in Node). `?rmask=1` turns it on where the config is off. QA only: `?rmask=nofill` (region masks made, never filled) and
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
machine's one GPU lock. B is this branch's build at the head after the check of the second review's fixes (`main-Bmv32K1C.js`: the src
change after c308a3e is comments only, and the build's main chunk keeps its name). R is 4f33648's build. A row's exit decides. The
runs after the first review are in the suite's NOTE-fix.md; these are the runs at the head (NOTE-fix2.md, its third pass).

**Node** (this branch):

| Row | Exit | What it printed |
|---|---|---|
| tsc | 0 | nothing |
| s_rmask | 0 | "s_rmask: all passed": 22 rows, among them "fillBytes added by the attach equals what the first flush sends to the slots it queued whole" (1,728 KiB both) and, new, "Curb's dabs as main.ts makes them, on tiles already up" ("ownBytesOff 0, offByTheDabs 0") |
| s_rmask on 702bb35's GroundPaint (a scratch copy, deleted after) | 1 | the spatter row "ownBytesOff dabs 4"; the Curb row fails only on what the spatter rows left: "ownBytesOff 2, offByTheDabs 0" |
| farchunk-check | 0 | "farchunk: every box the same in chunks of 4 and 8" |
| marks-proof | 0 | "exits: on 0 (0 wanted), off 1 (1 wanted), round 2's blast 1 (1 wanted)" |
| marks-doctor (15 doctored copies of the kept json) | 0 | "every case as wanted (15)"; its two new cases, a pose at 201 draws and the roofs at 999, exit 0 on 325573d's marks.mjs ("MARKS-DOCTOR FAILED: 2") |
| moon-programs, moon-programs-proof | 0, 0 | "moon-programs: no program after ready" with "blast: programs made 0"; on the json with its blast deleted, "FAIL  blast: none in the json", "exit 1 (1 wanted)" |

**Browser** (B unless named):

| Row | Exit | What it printed |
|---|---|---|
| build, iosfloor | 0, 0 | vite's chunk-size warning only; "iOS 15.0 parses every chunk" |
| det-skyoff, det-golden (the eight street views, R against B, the mask on) | 0, 0 | "det-cmp: 8 of 8 views pass" each |
| det-street (paintstreet, R against B) | 0 | "det-cmp: 1 of 1 views pass" |
| paint-above (downtown: on, on2, `?rmask=0` twice; its blast, a lost context; marks) | 0 | "exits: paintview 0, on vs off 0, off vs again 0, on vs on2 0, marks 0": on vs off 7 of 7 (1 px at 5 km 60 deg, 0 elsewhere), each page against its own repeat 7 of 7 (0 to 2 px); the blast's worst frame 56 draws, 155 KiB against `?rmask=0`'s 90 draws, 167 KiB; "marks: downtown on: all passed" |
| draws-paint (the Sunset's houses: on, on2, `?rmask=0` twice; marks) | 1 | "exits: paintview 0, on vs off 0, off vs again 1, on vs on2 1, marks 0": on vs off 7 of 7 (0 to 1 px); **the floors: roofs 452 px (cluster 452, round the bus) on both pages' repeats, and 300 m 32 px on `?rmask=0`'s (the grey tree)**; "marks: houses on: all passed", every pose at most 200 draws |
| floors-nobus (draws-paint's and paint-above's kept frames, the floors with the bus box left out; a report) | 0 | the houses' roofs still 14 px just outside the bus box on both repeats, 300 m 32 px on `?rmask=0`'s; downtown 7 of 7 |
| diag-particles-3 (three runs of two mask-on loads, the particles hidden) | 1 | "2 of 6 pairs not equal": the houses at 300 m, 83 px, in runs 2 and 3 |
| diag-roofs (the same at the roofs, particles hidden; a report) | 0 | 5 of 6 pairs equal; the 6th, on `?rmask=0`, 452 px at the bus: a second particle mesh's attributes and two meshes' uniforms differ, the camera doesn't |
| diag-dump (two loads of each page held draw by draw; a report) | 0 | before the settled pin, 6 of 32 pairs had the camera apart ("camera: largest difference 0.0013"); after it 0 of 12; a grey tree on painted ground in 3 of the 64 loads that counted the trees, on either page |
| writers | 0 | "writers: passed" |
| moon-above (`?moon&site=TYCHO`: on, `?rmask=0` twice, a blast) | 0 | "paintview: passed", "paintcmp moon: 4 of 4 poses pass" twice; the blast's worst frame 29 draws, 258 KiB (`?rmask=0`: 60, 258 KiB) |
| warm-plain | 0 | "warmcheck: passed" |

**What the pixel rows say.** At the plan's limits (cluster 4, none outside the paint's box) and with each side floored by its own repeat,
the mask draws the painted downtown and houses as `?rmask=0` does at every pose: 0 to 3 game pixels, never a cluster over 2. Before the
third check the rows exited 1 on their own floor runs, and that was blamed on the mask-on page and on the bus's particles. Neither holds:
with the particles hidden two mask-on loads still differed (2 of 6 pairs), and the `?rmask=0` page differs from itself too once it is
loaded often enough. Holding two loads draw by draw (`paintview --dump`) found three causes, none of them 1a's:

- The camera, about a millimetre apart (83 game pixels at 300 m, two outcomes). The broad ground under the bus, its nose and the chase
  camera's spring ease, and what they eased from depended on when the tiles round the start landed during the load. `pinAt` now settles
  them (9e000fe): 6 of 32 pairs had it before, 0 of 12 after.
- A tree standing in saved paint by a tile seam comes back grey on some loads (31 game pixels at 300 m, one tree at the Sunset), on the
  `?rmask=0` page as on the mask-on page. Its trace, in both grey loads caught: the tile's `onTileReady` fired before its neighbour across the seam
  was shown; main.ts paints a tile's trees once, on its own tile's ready, from the ground sampled under each tree. That is today's code
  (4f33648's too), and a player can meet it: a tree by a seam stays grey after a reload. The tree itself is not pinned. Not fixed here (call 4).
- At the roofs pose, something at the bus itself differs between loads of either page (452 game pixels round the bus, 14 of them just
  outside its box). With `--noparticles` (the game's main particles hidden) it still came in 1 of 6 pairs, on `?rmask=0`: the draws that
  differ are a second particle mesh at the bus (its attributes) and two meshes' uniforms. Particles draw Math.random, and what else takes
  it in a frame (three.js takes it for every object made) varies with the load. Not proven further.

So the rows still exit 1 (draws-paint, on its floors), on noise that both pages share. The limits stay the plan's.

## The whole table at the head

All 64 rows of the suite ran in one go on the build of 80a886e (built again from the head: `main-Bmv32K1C.js`, the same bundle as after
the second review), the browser rows one at a time. 45 exit 0. The 19 that do not were red before this table too, and none is new:

| Rows | What they printed | Why |
|---|---|---|
| det-far-nofill-proof, det-street-nofill-proof, det-far-noclamp-proof, writers-proof | "DIFFERENT: 12654 px", "2241 px", "9 px"; "WRITERS FAILED: 7" | proofs: each must fail, and does (noclamp against the mask's own frame: one game pixel, at 247, 421) |
| det-up-off, det-up-on, det-up-noclamp-proof, det-up-nofill-proof | "DIFFERENT: 9 px" each, against 4f33648's frame | 1c's tie pixel (call 1), one game pixel. The four frames are equal to each other (by hand, 0 px), and det-up-4 and det-up-0 (`&farchunk=4`) are 4f33648's to the pixel. That view has no painted coarse ground in frame, so its two proofs prove nothing (round 1 said so) |
| det-far-off | "DIFFERENT: 27 px" | the three seam pixels (call 2). det-far-on and det-far-0 pass |
| det-far, det-far4, det-far-rr | "DIFFERENT: 1287 px" each, downtown alone of the six views | 4f33648's first shoot of that view is the odd one: its bus stood 3.3 mm higher (stats.json: y 518.4395 against 518.4362). Shot again in this table (det-far-rr), 4f33648's build gives this build's frame to the pixel (by hand, 0 px), as in round 1 |
| draws-paint | exit 1 on its floors | load noise both pages share ("What the pixel rows say") |
| diag-particles-3 | "2 of 6 pairs not equal" | a diagnostic of that noise, not a gate |
| warm-moon, warm-moon-R | a throw in warmcheck's Moon script | the tool, on 4f33648's build the same |
| moon-keep, moon-keep-R | "1 FAIL", the heavy row: "painted 1000, back 0" | the same row the same way on 4f33648's build |
| moon-keep-R-orig | module not found | a stale row: the temporary tool it ran is gone |

A det row that shoots one side fresh against a side kept from an earlier shoot holds only where the bus's height is the same at both
shots. In that one shoot of downtown it was not (why, not looked into). `pinAt` (9e000fe) settles the bus for the paint rows;
`tools/shots.mjs --det` does not call it. The Moon rows were fixed after this table ("The Moon rows, made able to gate", below).

## What did not run

- A fix for the grey tree by a seam (call 4): today's code, outside 1a, so not touched here.
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
- warm-moon and moon-keep's heavy row failed on 4f33648's build too, through the whole table. Both rows are fixed since ("The Moon rows,
  made able to gate", below) and pass on both builds. What stays unproven on the Moon: paint drawn through the tile path in flight
  (warm-moon's flight puts none in a coarse region's mask; moon-above and moon-programs hold it at fixed poses).
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
- A twin's first fill: its painted tiles' slots, 64 KB each, up to 16 calls in one flush; `GroundPaint.fillBytes` counts the whole slots
  that attaching and linking queue (a mask linked to a slot written before, saved paint decoded onto a slot, the Moon's copy put on one as it
  attaches: `wholeSlot`), what an adoption adds, and a twin adoption adds it to its byte budget the same way. Whole slots queued outside an
  adoption aren't in it: a Moon copy arriving for a tile already shown, a stale serial's clear, a wide blast's bands. Fresh masks send nothing now. (Between e219ee0 and the second review's fix the decoded
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
| R2-2 minor: the pixel rows ran at loosened limits, the floor was one side's and unbounded | fixed in the tool and the rows: each side floored by its own repeat, the plan's limits, a floor over 0.05 % of the frame fails, the floor runs keep their exits. They exit 1 on load noise both pages share, not 1a's ("What the pixel rows say", above). The review's 5 px at 300 m are that noise, on a detailed tile 80 m from its nearest seam, not a seam of the merged ground |
| R2-3 minor: marks.mjs passed on missing poses and fields, allowed 2 %, dropped "no geometry made" | fixed: missing poses and fields fail, no slack (two runs of one build read the same numbers), every pose held to 1.5 M, net geometry in the blast fails; marks-doctor proves each. The Moon's "geometries net 4" are four roof sprouts' meshes made 7.95 s into the blast, on the mask-on page and on `?rmask=0` alike: not ground paint's |
| R2-4 minor: a dab's edge texels missed the GPU on own textures | fixed: every dirty rect is the blast's write box. Of the writers through it (a landed blast that isn't wide, replays, Curb's dab, the Waterfall's pool) only s_rmask's dab-sized blast with spatter was found to miss texels; Curb's dab as main.ts makes it (no dots or blobs) does not (the third check; s_rmask's new row with main.ts's spec). The street's rows against R hold, mask on and off |
| R2-5 minor: writers compares no frame | not done: "What did not run" |
| R2-6 minor: claims no run supported | corrected above: `fillBytes`, the houses at 300 m (now "Still over the ruling", with its cause and a mark), the warm-up on the Moon (unproven), the blast that shows R1's fix (the Moon's), s_rmask's rows, the read back's largest, the Moon blast's marks, the probe's draws |
| R2-7 minor, for 1b: one tile's region view dropped while its region lives keeps its slot flagged and painted | in "What 1b will need from 1a" |

## The check of the fixes, and what became of it

A check of 702bb35..325573d: the src changes sound, no blocker; one major for the lead and four minors.

| Finding | What became of it |
|---|---|
| major: paint-above and draws-paint exit 1 on their own mask-on floor runs; the particles were blamed on one equal run | the particles were not it (three runs with them hidden: 2 of 6 pairs differed). The causes found are shared by both pages and none is 1a's: the camera's eased state (fixed in the tool, 9e000fe), a tree by a tile seam that comes back grey (today's code, call 4), and something at the bus at the roofs pose ("What the pixel rows say"). paint-above now passes; draws-paint still exits 1 on its floors |
| minor: marks.mjs checks draws only at the two marked poses | fixed, 224540d: every pose at most the ruling's 200 draws. marks-doctor's two new cases (300 m at 201 draws, the roofs at 999) exit 0 on the old marks.mjs |
| minor: Curb's dab named as the writer the old box missed | it wasn't: s_rmask's dab is a dab-sized blast with the config's spatter; main.ts's dab has none. Reworded here and in GroundPaint (f9867f7), and s_rmask has a row with main.ts's own dab spec: on 702bb35's GroundPaint the dabs leave no texel off ("offByTheDabs 0"), while the spatter row fails there |
| minor: fillBytes' wording claims every whole slot | reworded (f9867f7): it counts what attaching and linking queue, what an adoption adds; later copies, clears and a wide blast's bands aren't in it, and none runs inside the adoption |
| minor: moon-programs passes with no blast | fixed in the suite's tool: a missing blast fails (its proof row, on the kept json with its blast deleted, exits 1) |

## The Moon rows, made able to gate

After the whole table both Moon rows were fixed, in the tools only (f81ab1d, 150388a). Neither says anything against 1a.

- **warm-moon** threw because its url had no `&mega`: MEGA is off since 2026-11-06, its button never shows, and the tool read null. With
  `&mega`, on 4f33648's build and on this one: "ok: the Moon: no program made after ready", "warmcheck: passed". Its proof, warm-moon-cold
  (the tool's `--qa-cold`, on 4f33648's build): "FAIL: the Moon: no program made after ready (1: ... mega@65759)", exit 1 as wanted.
- **moon-keep**'s heavy row took a tile's mask for its paint. After a reload every tile has an empty mask from the first frame, while its
  copy is on its way and the journal's replays wait: "back 0". The row now waits for the mask, the copy landed and no job queued (up to
  1,500 frames; the bars are unchanged). 4f33648's build: "painted 1000, back 1000, sameHue 969". This build: "painted 1000, back 1000,
  sameHue 973". Its proof, moon-keep-lose (`--lose`): "back 261", exit 1 as wanted. Round 2's 995 and 64 % were read before the replays
  had finished. The floor: 2.4 to 3.1 % of the points change hue each time the paint makes a round trip through the pictures, on both
  builds.
- **Two things of today's game the rows show, on both builds, not touched here.** After a heavy session on the Moon (200 blasts, then
  the page again) the paint's cover is back by frame 30, but about half the points show another hue until the journal's 260 to 311
  replays are drawn, 650 to 780 frames later (the row keep-diag-R). And one program is made on the Moon after the warm-up reports done,
  about 0.3 s before ready: printed by warm-moon, not gated.

## 1b, the gear's twin: planned and attacked, not built

The build plan and its critique are in the suite on the laptop (sb-checks/world/above/a: BUILD-B.md, CRITIQUE-B.md, LEAD-B.md). No game
code yet.

- **Today, measured** (this build, noon, the hold as it is). A climb in Turbo 3 from the roofs to 5 km and a dive back (the row
  climb-today): "hold on in 1027 of 1027 frames", "514 over 200 draws or 1.5 M triangles", the worst "358 draws at 5266 ms lift 4572",
  2.12 M. The same climb in Cruise: "0 over 200 draws or 1.5 M triangles". The settled grid (the row pre-1b; draws / M triangles, Turbo 3
  against Cruise, held 60 degrees down): downtown at 5 km 353 / 2.04 against 74 / 0.90, at 14.9 km 370 / 2.15 against 87 / 1.02; the
  Sunset at 5 km 366 / 2.83 against 84 / 1.54; the Western Addition at 5 km 307 / 2.61 against 82 / 1.38.
- **What 1b will leave over.** A twin is drawn through the gear's wider lens, not Cruise's. With the hold taken off in Turbo 3 (the
  critic's row crb-nohold): at most 116 draws, but the Western Addition reads 1.55 M triangles at 5 km and 1.70 M at 14.9 km (Cruise's
  1.38 and 1.50), and the Sunset 1.56 to 1.77 M; downtown about Cruise's. So Release A brings every gear's draws inside the ruling and
  leaves the houses' triangles over from 5 km up, until the plan's stage 3 or 5.
- **The plan settles:** the twin needs 1a's region mask (with `?rmask=0` it is off); the up line is Cruise's 910 of `detailD`; at most one
  flip and one twin adopted a frame; a twin lives only inside the hold; a classic coarse answer that meets the hold becomes the twin; a
  twin's region views go on and off all 16 tiles at once (the second review's R2-7 cannot be reached); one function writes a tile's
  visibility and one a twin's, so the fog pass and a flip cannot undo each other; 14 invariants, 7 commits, 14 rows, each row with a
  variant that must fail it.
- **The critique:** "build as amended"; two blockers, seven majors, ten minors.
  1. Blocker: a region is loaded detailed under 650 m of `detailD`, but the plan's twin flips back only under 520, so after a dive four
     of downtown's six home regions would stay coarse at Nonstop's floor. **The lead's ruling: a twin's down line is the load line, 650**
     (260 m under the up line; a flip down costs nothing), so the roofs after a dive are today's meshes.
  2. Blocker: three.js sends a texture or an attribute up at a mesh's next draw, and a hidden mesh is not drawn. Paint, the lamps' pools
     and the Moon's rocks' colours put on a hidden level would all go up on the frame of its flip. The plan gains an invariant: nothing a
     flip shows has an upload pending; the flip sends what is pending and flips on the next frame; a row checks the versions.
  3. Among the majors: the look row compares a flip with Cruise's swap of the same region at Cruise's own climb, as a share of the
     region's box; `?twin=0` is compared in a gear, not only in views that never hold; twins are asked two in flight, in Cruise's order,
     and only above about 150 m or rising; a row turns and flicks at 400 m (a region that flips twice in 3 s goes to the lead); on the
     Moon the rocks drop by the twin's current key; the memory row measures after a dive too (a twin is 1.34 MB at the median, 4.94 MB at
     most, plus 1 MB painted: downtown's six come to 19 to 25 MB).
- **Why it is not built yet.** It is the largest job left and the first account is near its weekly limit; and its real rows (the far
  shots' dip, the Lob from any height) need 1c and 1a merged with `feat/shots` first. It is next once this branch has its review from
  the second account.

## Calls for the producer, with the studio's pick

1. **1c's few tie pixels.** Inside one chunk of 8 the far boxes draw in their instance order, so where two far boxes tie in depth the
   other one wins: one game pixel in one view from above, none in the street views. Studio's pick: accept it. The other way keeps chunks of
   4 near the loaded edge and 8 beyond, for about half the saving.
2. **Three seam pixels on unpainted ground from 400 m** (R4): a painted coarse region's ground is now its merged mesh, where today a
   touched tile was meshed again on its own; at three G-buffer pixels on tile seams in one view the shade differs by a step. Studio's pick:
   accept. Matching them would mean meshing those tiles apart again, which is the draw 1a takes away.
3. **The Moon's formerly split tiles take their region's map** (L1): about 1,450 single pixels a step lighter or darker at 5 km held 60
   degrees down, no change of colour or extent. Studio's pick: accept.

Each is invisible at phone size in the outside look. The phone decides.

4. **A tree by a tile seam can come back grey after a reload** (found by the third check; today's code, 4f33648 included, not 1a). A
   tile's trees take saved paint once, when that tile's paint is shown, from the ground under each tree; when the neighbour across the
   seam isn't shown yet, the trace says a tree there stays grey (the tree itself not pinned). Seen in 3 of the 64 loads that counted the trees at the Sunset, on either page. Studio's pick: fix it
   in a small change of its own after this branch's review (on a tile's ready, look again at the grey trees of its neighbours by the
   seam), since paint that doesn't come back is a broken promise to the player. The other way: leave it, one tree on some loads.

## ASK for the second account

- `GroundPaint` has region views: a tile can be loaded with no ground of its own. Code that reads `city.ground` only through `sample`,
  `begin`, `land`, `dab` and `blast` is unaffected. Code that calls `attach`/`detach` or `City.setOwnGround`, or counts tile grounds as
  painted tiles, must use the views (`attachRegion`, `detachRegion`, `regionUniforms`, `releaseRegion`). None is on this base.
- `GLSL_GROUND_PAINT` is `sbGroundPaint(wp, uv, off, n, ...)`: the tile's own uv, its first texel and a scale. The terrain and the Moon's
  near ground read `uTileM` and `uGroundSq`; their defaults keep any material that doesn't set them as it was. The Moon's near ground takes
  `aTile` (`makeMoonGround`'s `ground` may carry `uTileM` and `uGroundSq`).
- Paint lands in a coarse region without splitting it: anything that waited for a tile ground to appear to know a tile was painted should
  ask GroundPaint (`has`, `regionSlot`).
- `onTileReady(tx, tz)` fires when a tile's saved paint is shown, and a neighbour across the seam may not be shown yet (call 4: a tree
  there stays grey on some loads). Anything of life's that takes saved paint on it, ground sampled near a seam, can meet the same.
- `pinAt` in tools/above/pvpage.mjs now settles the bus's broad ground, nose and chase camera at a pin; a tool of yours that
  pins the bus and compares two loads may want the same.

## UNKNOWN

- Everything on an A15 or in Safari: frame times, Metal's pipelines for the `aTile` layout, GPU memory for the region masks.
- Which particle mesh differs at the bus at the roofs pose, and why its random draws differ between two loads; and which tree the seam
  race leaves grey (its two tiles are known, the tree is not).
- Whether R4's three pixels come from the split tile's grid being meshed again on the main thread (the likely cause, by reading
  `City.takeGrid`); not proven.
- Whether the region masks for unpainted tiles a blast reached matter for memory in long sessions on a phone (each region 1 MiB).
- 1c's draws at the roofs and 300 m were counted in Turbo 3's held frames only (round 1's far-chunks).
