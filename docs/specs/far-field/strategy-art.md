# Data for the shapes, rules for the style

An art director's far-field strategy for Struggle Bus World. Date 2026-10-30.

**How to read the numbers.** [M] is measured. [S] comes from a source, linked or given as a repo path. [E] is an estimate. **[M mock]** means measured on the CPU mock-up in section 2, on real San Francisco data, and not in the game. Band edges, plan constants and pass marks are design choices, not measurements.

**What was done.** Nothing in any repo changed. No browser, build, bake or GPU job ran. The mock-ups ran on one core at idle priority. The shared web search budget ran out, so external facts come from the links in the three research reports, plus three Wikipedia pages fetched directly.

---

## 1. The answer

> "is relying on procedural generation so heavily the right move for us?"

**No, but procedural generation is not what is wrong.** The blobs are not generated. They are empty. From the ceiling, 85-89 % of the buildings in view are drawn in no form [M, [audit-bands](./audit-bands.md) 1.1], and procedural geometry is about 2 % of the frame [E, same, 1.5]. far.bin ships 11 ground classes and the mesh keeps one bit of them [M, [audit-limits](./audit-limits.md) section 3], so real data is being thrown away exactly where it matters.

**What is real today, and what causes the blobs.** In the listed shots real footprint-and-height massing fills 48-72 % of the frame, derived ground 13-18 %, sky and water 19-34 %, trees about 2 % and hand-built props about 1 % [E, audit-bands 4.2]. No pixel shows a measured colour [M, same]. The blobs have five causes (audit-bands 1.5): nothing is drawn past 3-4 km, main's rule that calls anything 17 m from a building lawn, far meshes with 1-2 ramps on 64 m and 256 m grids, a mid-field that loses outlines, windows and shadows at altitude, and far terrain poking through near ground. Only the second is a generation rule, and feat/osm replaces it inside loaded tiles.

**Your instinct is still right about one thing.** We spend truth up close, where nobody can check it, and run out of it at distance, where it is the only thing left to see.

**More data drawn the same way is not the cure either.** I drew every real building from the ceiling (frame B below). Past about 4 km it turns to salt and pepper: 19.5 % of far land pixels are isolated noise [M mock]. Real data needs art direction as much as rules do.

**The split I recommend is one sentence: real data draws every shape and sets how bright it is, and rules choose the hue and invent anything smaller than the data.** We never show a photo's colour, because brown and baked shadows would break the look. We never invent a coastline, because a local would know.

**Your follow-up is the top defect, and this fixes it.** DECISIONS.md:42 records why the ceiling exists: "high enough to view everything". The fix is that every block is always present, as a cheap block mass, then as tone in a raster. All of San Francisco costs about 0.8 MB and 179,000 triangles, close to today's far layer at 0.5 MB and 210,000 (section 5). It needs no fog. It is gated on footprints, not height, so the same recipe applies in any city, though only SF has been tried so far. The same stack runs over farmland, ice and the Moon with different data in the same channels.

**The pictures** (all under `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/art/out/`):

| File | Shows |
|---|---|
| `sheet-sunset.png` | The same ceiling view four ways: A today, B every building, C flat raster, D recommended |
| `sheet-sunset-strip.png` | The same four, cropped to the far strip |
| `sheet-ceiling-poses.png` | The recommended stack from three ceiling poses, with paint at 2, 5 and 10 km |
| `sunset-stack-paint-near22.png` | Best frame so far: real buildings to 2.2 km, blocks to 5 km, raster beyond |
| `worlds-sheet.png` | City, farmland, desert, forest, ocean, ice sheet, ice and rock, Moon, under one rule set |
| `plan-dial.png` | The value plan at none, light and heavy |
| `sunset-stack-paint-high.png` | The same stack from 3.3 km up, with faults: see section 13 |

**What is still unproven.** These are static CPU mock-ups. Motion, the A15, and cities with no street-bounded blocks have not been tested. Section 12 says what would kill this.

---

## 2. What the mock-ups showed

**Method.** A small ray march over real footprints, real streets and real ground classes from the feat/osm SF bake, at the audit's logged ceiling pose (393 x 852, 38° lens, pitch 22°). It uses the game's light formula (`sbLight`), real ramps and calm rounding. It has no windows, outlines, props or bridges. It shows composition and value, not finish. Scripts are in `art/`; section 14 lists them.

I tried the options in the order shipped products suggest them: draw everything, then a flat raster, then block massing.

| Frame, far strip of the Sunset view | Pepper | Blob | Top 4 colours | Largest pop | Value jump at the swap |
|---|---|---|---|---|---|
| **A** Today | 3.7 % | **51.3 %** | 93.6 % | **12,570 px** | **0.157** |
| **B** Every building, one sample per pixel | **19.5 %** | 0.0 % | 74.7 % | not measured | not measured |
| **C** Flat raster from 3 km, towers, statistical city | 4.8 % | 16.3 % | 65.0 % | 1,986 px | 0.036 |
| **D** Recommended: blocks, then raster, light plan | 9.6 % | 0.8 % | 58.6 % | **501 px** | **0.016** |
| Reference: the real shot's coarse mid-field | 6.0 % | 1.7 % | 45.7 % | n/a | n/a |

All [M mock], except the last row, which is the real `downtown-ceiling.png`, rows 330-430 [M].

- **Pepper** is the share of land pixels that differ from all four neighbours. It is sub-pixel noise, and it will crawl in motion.
- **Blob** is the share of land pixels whose 9 x 9 window holds two colours or fewer. It is the producer's word, made countable.
- **Largest pop** is the biggest connected area whose local mean value moves by half a step or more when the next regions load, with the camera held still. **Value jump** is the mean change in OKLab lightness across the changed pixels.

**What I learned, in order of how much it changed my mind:**

1. **All the real data, drawn plainly, is not beautiful.** Frame B has no blobs and is unreadable past 4 km. Point-sampling 1.5-1.9 buildings per pixel [M audit] gives noise. My first 8 m height raster and block tests also gave pepper, but they had a street-mask bug, so I discount them. Frame D is the corrected test.
2. **A flat raster reads like a place but pops.** It brought back Golden Gate Park and the Sutro forest straight away. It also failed in a way I did not expect: the first version changed almost as many pixels at the swap as today (1.95 % against 2.40 % of the frame). A top-down raster shows yards. A grazing camera sees walls, which hide yards, so green hillsides swapped to grey buildings. Matching class is not enough. A far band must show what the camera sees at that angle. I then added a small statistical city per texel: real cover and fabric height, with live wall light from the view and the sun. That cut the largest pop to 1,986 px, but it flattened the fabric into a pale sheet, which is a new blob (16.3 %).
3. **Blocks are the missing band.** Block-solid masses with one tone per block, cut by the real street network, keep rhythm with far less pepper. Frame D's blob is below the real game's healthy mid-field. Its pepper is 1.6 times higher, and that is the next thing to tune. From the Presidio it scores 11.6 % and 0.4 % [M mock].
4. **It reads with no plan at all.** The top panel of `plan-dial.png` has no value plan and no fog, and every block is there. So the top defect is fixed by data, not by haze.
5. **A heavy plan brings fog back.** The bottom panel reads misty. The producer turned fog off on purpose (`src/config.ts`, "just remove the clouds/fog for now"). I use the light plan: crisp to about 9 km, with only the last distance cooled.
6. **Blocks can come much closer than I assumed.** With real buildings ending at 2.2 km I cannot find the seam by eye in `sunset-stack-paint-near22.png`. That returns 39-59 % of the LOD 1 triangles at the ceiling (section 5).
7. **Paint reads at 2, 5 and 10 km with no help.** It is the strongest thing in every frame, on every kind of ground.

**Crawl, the first look at motion.** I rendered each option twice, 3.7 m apart sideways, which is one frame at G0 surge at 30 fps [S `config.turbo`, via WORLD-TRAVEL section 0], and counted the land pixels that changed colour:

| Rows | Every building | Recommended | Real game |
|---|---|---|---|
| Fabric, 212-265 | 26.3 % | **13.9 %** | |
| Blocks, 265-331 | 36.7 % | **24.3 %** | |
| Coarse, 331-450 | 27.0 % | 23.7 % | 12.8 % |

The first two columns are [M mock]. The last is two real frames 1/30 s apart at the ceiling, from an older fogged build at an unknown speed [M]. The recommended stack flips a third to a half fewer far pixels than drawing everything, and its block rows flip about as much as the coarse rows beside them. That is encouraging, not proof. The mock has no pixel snap and reads about twice the real game in the only rows I can compare, so read across columns one and two only. `tools/shimmer.py` on real frames is the real test.

---

## 3. What the player should see

A landscape painter divides a picture into planes, each with its own value range and its own scale of mark. That is the right frame for a 390-pixel game, because at the ceiling everything past 3 km shares 16 % of the rows.

| Plane | Rows at the ceiling | Share | Distance | It should read as | Steps used | Rhythm at 2-8 px |
|---|---|---|---|---|---|---|
| Sky | 0-195 | 23 % | | mood, sun side, a pale horizon | 5-7 | high streaks |
| Ridgelines | 195-212 | 2 % | 25 km to horizon | paper cut-outs, each paler than the last | 4-6 | ridge lines |
| Fabric | 212-265 | 6 % | 6-25 km | flat tone: parks dark, avenues as threads, towers standing | 3-6 | avenues, park edges |
| Blocks | 265-375 | 13 % | 2.2-6 km | knitted rows of blocks | 2-6 | streets, block rows |
| Coarse | 375-648 | 32 % | 0.7-2.2 km | roofs, long shadows, streets as canals | 1-7 | houses, shadows |
| Detail | 648-852 | 24 % | under 0.7 km | windows, trees, full paint | 0-7 | windows |

Row positions are read from the audit's pixel table [M], with interpolation between its rows [E]. The audit's top defect lives in the Fabric and Blocks planes, 163 rows. Those rows decide whether a frame reads as a world or as an island.

### What makes distance beautiful

1. **Silhouette.** People recognise a city by its top edge. Anything standing 2 px above its surroundings keeps its true outline. That is a pixel test, not a 20 m test, so it picks the tallest things in Gulu as well as in Manhattan. In SF a gate of the local fabric plus 18 m keeps 1,248 buildings, 0.74 % [M]. Bridges, masts, stadiums and cranes join by OSM tag.
2. **Layered value.** Each plane gets a narrower range than the one in front. Painters have known this for centuries: distant things look "paler, less detailed, and usually bluer than near objects" ([Wikipedia, aerial perspective](https://en.wikipedia.org/wiki/Aerial_perspective)). Here it is a dial, never a hiding place.
3. **Colour perspective.** Every world ramp gets a far sibling with the same lightness per step and a cooler hue, so the swap is a hue drift and never a value jump (section 9). My first version used a dither at this seam, and it read as a screen door.
4. **Surface rhythm.** This is the real meaning of "blob": a region with no pattern between 2 and 8 px. Under 2 px a pattern becomes pepper. So each plane owns one scale of mark: windows, then houses, then blocks, then avenues, then ridges. At a grazing camera, lines running toward you survive and lines running across you vanish, because a pixel at 5 km covers 8.6 x 63 m [M audit]. So avenues are the far field's main rhythm, and they have to come from real data.
5. **Landmarks.** Hero props stay in hero cities. Everywhere else, rule 1 finds the landmarks.

### Seven rules to adopt

1. Nothing may be absent. A coarser version of everything is always resident.
2. Nothing smaller than 2 px is drawn as geometry or pattern.
3. Every depth has a rhythm between 2 and 8 px.
4. Paint never takes the air.
5. World ramps stay under OKLCH chroma 0.06. Paint peaks at 0.16-0.21 [M]. That gap is the game's whole contrast.
6. Far ramps match near ramps step for step in lightness.
7. Haze is a dial, never a hiding place. On the Moon it is off.

---

## 4. Truth or invention

**The test.** Would someone from here notice? Is it at least 2 px when first seen? Can it be painted? Any yes means it must be real.

| Must be real | May be invented |
|---|---|
| Coast, rivers, lakes | Every hue: class picks the ramp, never a photo |
| Hills, ridges, peaks, craters above about 2 px | Facades, windows, roof shapes on houses, roof clutter |
| That every building exists, and its block outline | Which tree stands where inside a real forest, and tree shapes |
| Street network, avenues, freeways, rail yards, runways | Crop rows, hedges, dune ripples, sastrugi, small craters, all below the data |
| Parks, forest extents, field shapes | Water surface, glitter, whitecaps |
| Skyline towers, bridges, stadiums | Clouds and cloud shadows, until real weather is wired in |
| Relative brightness of districts | Tone within a block, the sky |
| Names | |

**Why hue stays invented.** World ramps sit near hue 250, greens near hue 170, with peak chroma 0.02-0.04, and paint runs 4 to 10 times stronger [M]. Measured colour would compete with paint and bring brown. The audit's "0 % of pixels show a measured colour" should stay true for hue. What should become measured is **value**. This is the same method as [Google Maps' 2020 colour update](https://blog.google/products/maps/more-detailed-colorful-map/): computer vision finds the land type, each type gets a colour range, and density picks the shade. It also has a stylised precedent: [Firewatch's rocks](https://blog.camposanto.com/post/102893584324/i-asked-twitter-if-anyone-had-questions-about-the) mostly have grey diffuse, with colour coming from light and fog.

**Compared with shipped products.** [Flight Simulator generates 1.5 B buildings and nearly 3 trillion trees](https://gamesbeat.com/the-metaverse-didnt-die-it-moved-inside-microsoft-flight-simulator-2024-jorg-neumann-interview/) and still reads as real, because its ground colour is photographed. We are its mirror image: real shapes, invented colour. Both work. What fails is neither: an empty far field.

---

## 5. The stack, street to orbit

Bands are chosen by metres per game pixel, not by distance, so they hold at any lens and height. The distances below are for the ceiling pose.

### What is drawn

| Band | m/px across | At the ceiling | The player sees | Drawn | Data |
|---|---|---|---|---|---|
| **0 Detail** | under 1.5 | to 0.7 km | windows, gardens, full paint | Today's LOD 0 tiles | Region tiles |
| **1 Coarse** | 1.5-4 | 0.7-2.2 km | roofs, shadows, streets | Today's LOD 1 regions, one tone per block, trees as points | Region tiles, one extra byte per building |
| **2 Blocks** | 4-10 | 2.2-6 km | knitted rows, avenues | One merged mesh per 2 km cell: block masses, plus towers as real LOD 1 | New `blocks.bin` |
| **3 Fabric** | 10-40 | 6-25 km | tone, parks, threads of avenues, towers | Far ground mesh with a class and value raster, area-sampled; towers to 2 px | New raster at 16 and 32 m |
| **4 Ridgelines** | over 40 | 25 km to horizon | paper-cut hills | Rings of real relief | DEM pyramid, land class |
| **5 Regional** | G2, 2-10 km up | whole metros | coast, city as tone, road nets, beacons | Clipmap rings over tile arrays | Planet tiles: height, class, tone; street layer apart |
| **6 Orbit** | G3, 10-50 km up | continents | continents, cloud deck, limb, night lights | Resolve pass, outer rings | Coarse planet tiles |

### What is real, what is procedural, and why

| Band | Real | Procedural | Why |
|---|---|---|---|
| **0** | Footprints, heights, streets, classes | Windows, trims, roof clutter, tree shape | Too small for any global data. Nobody can check them |
| **1** | Same; shadows from real geometry | Block tone, tree placement where unmapped | Per-house tone rounds to noise past 1.5 km [M mock] |
| **2** | Block outlines, street gaps, median height, tower outlines | One tone per block | Sub-pixel variety is what made pepper |
| **3** | Classes, street pattern, parks, relief, tower heights | Hue, district tone drift | A pixel here covers 17 x 240 m at 10 km [M audit]. Only tone survives |
| **4** | Relief, land cover | Hue, the depth remap | Silhouette is all that is left, and it is real |
| **5** | Relief, class, measured tone, roads, coast | Hue, cloud deck, ocean surface | Tone is what stops land reading as flat class patches |
| **6** | Coast, relief, night lights, cloud weather later | Limb, sea glitter, stars by catalogue | At this scale the ocean is pattern, not data |

### What it costs

| Band | Draws | Triangles | Other phone cost | Bytes, all of SF | Bytes, planet |
|---|---|---|---|---|---|
| **0** | 2 per visible tile [M audit] | 131-366k per region on feat/osm [M audit] | Unchanged | 131 KB per region, mean [M audit] | Tiles only where flown |
| **1** | 2 per region [M audit], +1 for tree points | 368-464k at the ceiling, from 763-898k today on feat/osm [M, per-region counts, 9-12 regions] | 120,545 tree points in SF [M audit] | Same files | Same |
| **2** | 1-4 | 179k for the whole city [M]; about 13k in the band's own wedge (10.3 km², 38 blocks per km², 34 triangles each), up to 50k with 2 km cells [E] | 0.5 MB of 4-byte vertices [M]; no sun pass | 87 KB outlines [M], about 16 KB heights and tone [E], about 62 KB towers [E] | 1-5 GB [E] |
| **3** | 1 | Today's 124k ground mesh [M audit], less with a tile mask | Up to 6 fetches per pixel on at most 30,000 px [E]; 3 MB of texture [M computed] | 234 KB at 16 m, 66 KB at 32 m [M] | 4-13 GB [E] |
| **4** | 1 | 55k [M audit] | None new | 190 KB per city today [M audit]; 33 KB fabric height and 81 KB ground at 32 m [M] | In the planet layer |
| **5** | up to 8 [S WORLD-TRAVEL 2.1, its estimate] | up to 65k [S same] | 1.6 MB for 8 rings [E, research-polar 7] | n/a | 128-146 GB at 30 m; 0.63-0.80 TB at 10 m [E, research-earth 11] |
| **6** | 0-8 | small | Resolve only; 30-40 draws at G3 [S WORLD-TRAVEL 2.6] | n/a | Included above |

**Frame totals.** The far layer today is 3 draws and 210,090 triangles, always drawn [M audit]. The new far bands are about 3-6 draws and 170-230k triangles [E]. Band 1 falls by 300-530k [M counts, E load rule: 500 m lead, 1,300 m radius]. So the ceiling goes down, and that is what lets feat/osm merge without going over budget. The audit expected the ceiling to go over once it merges.

**Bytes for the whole city.** Bands 2-4 for all of SF are about 0.8 MB [M + E: 165 + 300 + 304 KB], against 0.5 MB of far.bin and horizon.bin today and 25.5 MB of region files [M audit]. The raster's value channel in this measure is 8 levels of building cover standing in for tone, so a real value channel may differ. Extra 8 m raster: 646 KB [M], only if band 2's ground needs it.

**Planet estimates, how they were made.** Blocks: about 20 B per block measured in SF, times the 50-250 M blocks [E] from research-earth section 11. Raster: 1.7 B per building in SF, times 2.53 B buildings [M], with the high end at 3 times for dispersed fabric [E].

**Shadows are kept.** Bands 2-3 get cast shadows from a client sweep over heights, one byte per texel. The whole city at 8 m took 0.74 s in NumPy under load [M], about 12 ms per 256² tile [E from that]. It is the same pass that gives Erebus and lunar rims their shadows. It runs in a worker, and only when the sun moves. It is unmeasured on a phone.

**Mesh, not ray march.** The priorart report floated a height-field march for band 2. All of SF as blocks is 179k triangles, less than today's whole far layer at 210k, and only 3-6 km of it is on screen. So there is no reason to take gl_FragDepth and fragment risk on a tile-based GPU. Keep the march as a fallback idea.

### Band notes

- **Band 1 is the largest plane, and it needs a calm pass.** It is 32 % of the rows and the "grey rubble" of the audit. Past 1.5 km, roofs take one tone per block and camouflage patches go. Trees become points instead of vanishing at about 1.5 km [M audit]. This is tuning, not new data.
- **Band 2 ends by morphing.** Past 5.5 km walls shrink to zero in the vertex shader, so a block sinks into its own raster tone. A wall there is 1 px, so nobody can see it go.
- **Band 3 is baked from band 2.** The raster stores what the block masses look like, with the sun left out. Sun and slope are live. Pixels are area-sampled: class by mode, value by mean, quantised last. This is the "class and tone stored apart" rule from research-priorart section 6. A flat textured plane read as a world to players for decades: [Mode 7](https://en.wikipedia.org/wiki/Mode_7) "transforms the background layer into a two-dimensional horizontal texture-mapped plane that trades height for depth".
- **Band 4 needs one small change.** Today's far fade runs 11-20 km [S `materials.ts:167`, `config.ts`] and kills the East Bay. In the mock, moving it to 21-34 km brings back layered hills from data already on the wire. The 30 km far plane has to grow with it.
- **The sky is a separate quick win.** It is the top 23 % of the frame and has five flat stripes [M audit]. It is fully procedural, so it should carry design: a warm side, a pale horizon, high streaks. Cloud shadows, invented and world-anchored, add one large soft value shape across the city for one texture fetch. They are in the mock at low strength. Not on the Moon.
- **Water stops speckling** if its pattern lattice doubles with distance, so a cell is never under 2 px (ocean panel in `worlds-sheet.png`). Today's dash hash flips up to 4.5 % of pixels at random [M audit].

---

## 6. Every block, no pop, every city

### How every block reads

The streaming radius stops mattering for presence. It only decides where real buildings replace blocks. `blocks.bin` and the raster load at boot, for the whole city, and nothing has a distance test. The Sunset view's 37,702 absent buildings [M audit] become blocks and tone.

### How pop goes away

| Step | What it does |
|---|---|
| Same data | Blocks are built from the same footprints as the tiles, so a tile replaces its own mass |
| Same tone | Block tone is what band 1 already uses past 1.5 km, so the value holds across the swap |
| Same light | Sun is live in every band |
| Dissolve | Each 256 m tile dissolves in by a world-anchored Bayer pattern over about 12 frames. The far boxes' `loadedMask` already tracks tiles. `sbDissolve` is specified in MAGIC-SPEC 1.4, but I found no dissolve in `src/render` or `src/world` on feat/hybrid, so it has to be written |
| Morph | Band 2 to band 3 is a height morph, so there is no swap at all |
| Parent first | Blocks stay until the tile is ready. This is [Cesium's rule](https://cesium.com/learn/cesium-native/ref-doc/selection-algorithm-details.html). [Cesium issue 4043](https://github.com/CesiumGS/cesium/issues/4043) is our exact bug from 2016 |

**Measured so far.** For one region swap at the Sunset pose, the largest area that visibly moves falls from 12,570 px to 501 px, and the mean value jump from 0.157 to 0.016 [M mock]. That is not zero. It is before any dissolve. The rest is texture changing, from fabric to individual houses, and whether that reads as a pop can only be judged in motion.

**The camera's lens matters.** At the 24° street lens one pixel is smaller, so band 2 starts further out, about 4 km against 2.2 km. Near buildings hide most of that from the street, but a hilltop floor sees it. Streaming should follow the view wedge and pixel size, not a disc: at 24° a wedge out to 5 km is 5.2 km², less than today's 12.6 km² disc [E, M audit].

### How the same holds in every other city

Every input is footprints, streets, class and a DEM. None depends on height tags. Coverage figures are from audit-limits section 1 [M].

| Place | Footprints | Heights | Blocks | Raster | Surround |
|---|---|---|---|---|---|
| Any US city | Good | Tags or LiDAR | Good | OSM and WorldCover | GLO-30 ring |
| Tokyo | Good, 12-16 % tagged | 3D-GloBFP, PLATEAU | Good, dense | Same | Same |
| Dhaka | Good, 3.7 % tagged | Google 2.5D Temporal | Good, heights from raster | Same | Same |
| Lagos, Ikeja | 59 % Google ML, 0.7 % tagged | Google 2.5D Temporal | Where cover is at least 50 %, otherwise tone | Same | Same |
| Gulu | 1,600 or more per km², almost none tagged | Google 2.5D Temporal | Mostly none: tone only, every hut counted | Same | Same |
| McMurdo | 296, all OSM | 22 % tagged, REMA minus ice is an idea | Small real town | ICE by default | REMA ring |

**Rules that keep this honest:**

- **Never fill what is not at least 50 % built.** Sparse fabric stays tone, so a settlement never becomes a slab. That is the trap "density-extruded blocks" in WORLD-TRAVEL line 505 falls into.
- **Bridges come from data.** All bridges outside SF are missing today (audit-limits 4.17). Add a generated deck from OSM ways, with towers from `bridge:structure`.
- **No frame ends in the sea plane.** Each city gets a ring from a global DEM until the planet layer exists.
- **Uncharted stops being a fog bank.** WORLD-TRAVEL section 3.2 hides unbaked places in fog, and the audit showed that fog does not exist now. If blocks and raster are global, an unbaked city is simply bands 2-4 with no band 0. It is never empty, and the Moon works the same way.

---

## 7. Seven kinds of ground

All panels are in `worlds-sheet.png`: real samples, same camera rule, 30 m imagery or real elevation [M mock]. Classes for the imagery panels were guessed from RGB for the mock. A real bake uses WorldCover.

| Ground | What the player sees | Real | Invented | Trap found |
|---|---|---|---|---|
| **Dense city** | Sections 2-6. The panel shows imagery tone alone: Tokyo reads as a city with a river before any footprints arrive | Footprints, streets, tone | Hue, windows | Tone seams between scenes |
| **Farmland** | The best panel. Real field shapes, canals and section roads, irregular in a way no generator would be | Field shapes, canals, roads, farm footprints, relief | Crop rows near the bus, hedges below 10 m | DRY_LAND's lilac needs a cap. Single scenes differ by season, so use composites |
| **Desert** | Long washes of tone with dark rock, under low sun | Ergs, wadis, rock | Ripples below the data, along the dominant gradient | Sand must not share SKY_WARM ([audit-limits](./audit-limits.md) 4.8). Imagery holds baked shadows, so low-pass it |
| **Forest** | The weakest panel, a dark plate with faint clearings. It needs relief and rivers to work | Extent, clearings, rivers, ridges | Which tree; crowns as points, one vertex each | RGB classes read the Amazon as water until I changed them. Use WorldCover |
| **Ocean** | Value bands by view angle, a sun road, a cloud deck and its shadows | Coast, shelf, weather later | Everything on the surface | Cell size must double with distance or it speckles |
| **Ice sheet** | Long pale bands of real relief with violet shadow, sky darker than the ground | Relief | Sastrugi near the bus, along the wind | **Plain light gave a blank plate.** Dome C has 19 m of relief over 41 km [M]. Band-passing it and exaggerating 700 times, in the light only, gives rhythm with no invented terrain |
| **Lunar highlands** | The strongest panel. Hard black shadows, real craters, a sharp curved limb, black sky | SLDEM 59 m relief, low-passed WAC albedo | 2,600 seeded craters below the data in the mock | No value plan at all. Depth comes from craters shrinking toward the limb. WAC has baked shadows, so low-pass it ([research-polar](./research-polar-lunar.md) 4.2) |

**What changes by body.** Band 2 does not exist where nothing is built. Bands 3-6 are the same channels with different sources, listed in research-polar sections 1.7 and 4.6. Ice reads from relief and low sun. The Moon reads from relief and albedo. A `Body` record holds `air: off`, the sky ramp and the source table.

**Low sun is a gift in both.** At the South Pole the sun never climbs above 23.4° and at McMurdo it stays under 36° [E, research-polar 3], so the look the game is built on holds for months. Terrain shadows must therefore work to the horizon. The sweep in section 5 is how.

**Cost of the rest of the world.** Antarctica to 32 m is about 2-5 GB and the Moon about 25 GB [E, research-polar 7].

---

## 8. Paint at distance

**The rule: paint is the only thing exempt from distance.** It skips the value plan and the far siblings, and it gets a step brighter past 1.5 km, so it reads as a lamp rather than a surface. In the mock this needed nothing else: patches at 2, 5 and 10 km are the first thing the eye finds (`sheet-ceiling-poses.png`). That only works because rule 5 keeps the world quiet.

**Hues are never averaged.** A far pixel takes one hue, and coverage sets how many pixels get one. So a painted district far away is confetti of pure colour, and it can never go brown. In the mock a pixel takes its area's dominant hue if paint covers at least 1/8 of it [M mock].

| Distance | Painted building reads as | From |
|---|---|---|
| Under 2.2 km | Itself, in full | `PaintState`, as today |
| 2.2-6 km | Block mass takes hue cells | Far paint map |
| 6-25 km | Confetti of hue pixels on the raster; a painted tower is a small rainbow flag | Far paint map; towers keep their own paint texel |
| Past 25 km | STAGES' beacons, at least 3 px wide, 800-1,500 m tall [S `docs/specs/STAGES.md` 2.4, 2.5] | Area records |
| Orbit | A coloured spark at the city; the shared Moon sprite's tint | Per-metro counters |

**Most of this exists already.** `main.ts` keeps a whole-city paint density map at 64 m, 224 x 276 cells [M, computed from the bounds], updated by `bumpPaint` on every blast. It was built to clear fog, and fog is off, so today it does nothing. Add a dominant hue and it is the far paint map, about 124 KB [M computed]. Far boxes carry paint indices nobody reads (`City.ts:368`, audit finding 8), and block masses replace those.

**Targets beyond buildings.** Ground paint is capped at 160 tiles at one draw each [M audit], so ice and regolith need the sky-paint clipmap WORLD-TRAVEL already plans. Generalise "building" to "target": craters by Robbins id, ice fronts, peaks (research-polar section 6). In `worlds-sheet.png` a disc of paint is the strongest element on ice and on the Moon alike.

---

## 9. Palette

Rows 38-47 are spare [S `src/render/palette.ts`]. All ramps below pass the check of no step with hue 30-85, lightness under 0.62 and chroma over 0.025, which is my working definition of brown [M]. Hex values are starting points that have only been seen in the mock.

| Ramp | Row | Steps 0-7 | Peak chroma |
|---|---|---|---|
| FAR | 38 | `#1e2e3c #304150 #455767 #5c6e7e #748798 #90a1b0 #aebcca #c9d6e1` | 0.035 |
| FAR_GREEN | 39 | `#0a1c1e #152729 #223436 #304345 #415456 #566769 #6e7d7e #8b9798` | 0.024 |
| DRY_LAND | 36, reserved | `#2f2c37 #463f4b #625662 #7f7077 #9b8b88 #b6a996 #d3c6aa #ede1c0` | 0.045 |
| FIELD | 40 | `#1b2627 #2a3936 #3d4c43 #515f51 #6a7664 #858d79 #a0a48f #bdbca6` | 0.031 |
| ICE | 41 | `#5c6085 #767ea2 #8d9bba #a6b5cd #beccdb #d5e0e8 #e9f0f3 #fafcfc` | 0.059 |
| BLUE_ICE | 42 | `#263951 #374f69 #4a677f #5f7f95 #7797ab #92b0c0 #afc9d4 #cfe2e8` | 0.053 |
| REGOLITH | 43 | `#020203 #0f0f13 #232328 #3c3d42 #57575c #77777c #9c9890 #c2bdb2` | 0.016 |
| SKY_POLAR | 44 | `#2e3d59 #41536f #556b86 #6c839b #859bb0 #a0b4c4 #becdd7 #dde6eb` | 0.053 |
| OPEN_SEA | 33, reserved | `#021b2c #092536 #152f41 #243e51 #375366 #556e7f #778c9c #9daebc` | 0.046 |
| NIGHT_SKY | 32, reserved | `#010103 #040409 #0b0c16 #161a27 #222938 #333e4e #4c5a69 #6e7c89` | 0.031 |

**FAR and FAR_GREEN are made, not picked:** the lightness of GREY_LIGHT and GREEN_GREY per step, with a new hue. Every ramp the far field uses needs such a sibling, so more will follow: FAR_DRY, FAR_FIELD.

**The value plan in the mock.** Value moves toward a pale target by 0.08 from 1.4 to 3.6 km, 0.10 more by 8 km and 0.27 more by 20 km. Ramps swap to far siblings at 9 km. It belongs in the resolve: one lookup from ramp to sibling, paint ramps mapped to themselves. No material changes.

---

## 10. The smallest proof

**Already done:** the CPU mock. `art/run3.py sunset stack paint` re-renders the recommended frame in about a minute, with the settings in section 14. It shows the composition works. It says little about motion and nothing about the phone.

**The smallest real proof is San Francisco only, on a real iPhone, with no streaming rewrite:**

1. Bake `blocks.bin` from the feat/osm tiles: block masses plus towers. `art/blocks.py` already does the geometry and the polygon step took 0.9 s [M].
2. In `City.ts`, draw blocks wherever `loadedMask` says no tile is loaded, and let towers replace the 20 m far boxes.
3. Give the far ground its classes and fix the interpolated ramp (audit-bands section 7, items 2 and 3).
4. Move the far fade to 21-34 km and add the light plan to the resolve, behind a tunable.
5. Capture `tools/altitude.mjs west --seq` at the Sunset ceiling, add a Presidio start point, and fly ceiling to street.

| Check | Pass |
|---|---|
| The producer looks at both ceiling frames | "Every block is there", unprompted |
| Far strip pepper and blob, using `art/metrics.py` on game frames | Pepper at most twice the game's coarse band, blob 5 % or less |
| `tools/shimmer.py` on `--seq` frames | No worse than today's coarse rows |
| Largest visible pop at a tile swap, with dissolve | Under 500 px, and nobody can name the moment in a fly-through |
| A15 at the ceiling | At least 30 fps, at most 200 draws, at most 1.5 M triangles |
| Bytes at boot | Under 1 MB |

**If it fails:** motion fails, widen the block tolerance to 16 m (144k triangles [M]) and start the raster nearer. Phone fails, drop the block band to 3-5 km.

**A second proof before going global:** one real data-poor bake, Gulu or Ikeja, with the same checks. London and Amsterdam cannot show the defect (audit-limits section 5).

---

## 11. Order of work

1. **No new data:** far ground classes, interpolated ramp, far terrain tile mask, far fade, sky pass, band 1 calm pass, trees as points. This alone changes the frame.
2. **The proof above:** blocks, towers, light plan, far paint map.
3. **Any city:** raster pyramid, DEM ring, generated bridges, height ladder with Google 2.5D, QA that reports invented data.
4. **Planet layer:** tone from composites, a cube grid per body (research-polar 2.5), no Mercator.
5. **Antarctica, then the Moon:** `Body` records, new ramps, sweep shadows, targets beyond buildings.

### What changes in WORLD-TRAVEL

| Where | It says | Change |
|---|---|---|
| 3.1 L3 | Coarse covers 1-20 km | Coarse ends at about 2.2 km at the ceiling |
| 3.1 L4 | Boxes of at least 20 m plus density-extruded blocks | Blocks from real footprints, then raster, gated by pixels |
| 2.1 | Height, class, coast SDF, density | Add measured tone and a separate street layer |
| 3.2 | Uncharted is a fog bank | Uncharted is bands 2-4 |
| 2.5 | Six new ramps | Add far siblings, ice, regolith, field |
| 2.6 | Shadows off above 2 km | Keep them, from the sweep |

---

## 12. What would kill this

1. **Motion.** Everything here is a still frame, apart from one two-frame proxy. If block edges and street gaps boil at 1-2 px, the block band fails as designed.
2. **The swap.** 501 px before a dissolve is not zero. If the producer can still see regions arrive, the top defect is only reduced.
3. **Places with no blocks.** Dispersed or thinly mapped fabric has few street-bounded blocks. Tone-only may leave those cities flat in the middle distance. I have not tested this on real data, and most of the 2.53 B buildings [M] are outside places like SF.
4. **Invented heights.** In the 0 % regions a wrong skyline is the one lie a local sees. If raster heights disappoint, the silhouette rule picks the wrong buildings.
5. **Imagery quilt.** Tone must not jump at tile or scene edges across a continent at G2. Per-class matching is untested at that scale.
6. **The value plan reading as fog.** Keep it a dial, and be ready to ship it at zero. `plan-dial.png` shows that the defect stays fixed without it.
7. **Phone memory and heat.** Vertex counts look fine. Texture arrays, worker sweeps and streaming at G1 are unmeasured on an A15.
8. **Taste on ice.** A 700-times exaggeration of light is a style choice, and it may look wrong next to a real photo of Dome C. The alternative is a blank plate.
9. **Seeded detail repeating.** Craters and sastrugi must not show their lattice. The mock is too short a look to know.
10. **Band edges at altitude.** The ceiling frames hide them, but the 3.3 km frame does not. If the pixel rule does not fix that, G1 and G2 flight over a city will show rings.

---

## 13. Not confirmed

- **The mock is not the renderer.** It has no windows, outlines, bridges, props or pixel snap. Roofs are flat. Far frames in the Sunset and Presidio views have no fog-off real capture to compare with ([audit-bands](./audit-bands.md) section 8).
- **Mock calibration.** On the downtown ceiling, rows 330-430, the mock gives pepper 4.5 %, blob 1.0 %, top 4 colours 69 %, 23 colours. The real shot gives 6.0 %, 1.7 %, 45.7 %, 37 colours [M]. So the mock is calmer and poorer in colour than the game, because it has no windows or facade detail. Expect pepper on real frames to sit above the mock's.
- **High altitude shows faults.** From 3.3 km up the whole peninsula reads, with Lake Merced, Golden Gate Park and the East Bay shore. But two band edges show as straight tonal steps, and block rows alias into moiré. The mock's bands use fixed ground distance, not the pixel rule in section 5, so this should improve, but it has not been shown.
- **Three poses, one sun.** Looking into the sun was not tried. The statistical wall term that makes band 3 respond to heading is in the mock at low weight and was only tested on one heading.
- **Terrain panels** use one sample each, a single scene, mirrored tiles and guessed classes. Ross Island's framing is weak. The forest panel is the flattest place on Earth, so it is the worst case.
- **All phone costs are estimates** except where marked. Nothing ran on an A15.
- **Carlson's value-by-plane theory** (sky lightest, ground next, slopes, uprights darkest) informed section 3 from memory. The page I could fetch [confirms the book](https://en.wikipedia.org/wiki/John_Fabian_Carlson), not the theory, so I do not rest anything on it.
- **Search budget.** The shared web search ran out. I fetched the Wikipedia pages on Mode 7, aerial perspective and Carlson directly. Other links are from the research reports, and I did not reopen them.
- **Global block counts** rest on SF and London (research-earth section 11).

---

## 14. Evidence

Everything is under `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/art/`.

| What | Path |
|---|---|
| Height raster from real footprints | `build_city.py`, `city4.npz` |
| Mock renderer | `lab.py`, `shade.py` |
| Far-band variants, swap test | `run2.py`, `run3.py`, `today.py`, `popscore.py` |
| Beauty measures | `metrics.py`, `final.py`, `final-metrics.json` |
| Crawl proxy | `crawl.py` |
| Far product bytes | `bytes.py`, `bytes.json` |
| Block mesh size, towers, sweep time | `blocks.py`, `blocks.json` |
| LOD 1 budget at a nearer band | `budget.py` |
| Terrain sheet and new ramps | `worlds.py`, `oklch.py`, `fetch.py`, `samples/` |
| All frames | `out/` |

Recommended frame settings for `run3.py`: `FILT=5800 K1=0.08 K2=0.10 K3=0.27 COOL=9000`, with `NEAR=2200 FAR6=5000` for the closest band. Run them with `C:/Users/Utku/sb-venv/Scripts/python.exe -I`.
