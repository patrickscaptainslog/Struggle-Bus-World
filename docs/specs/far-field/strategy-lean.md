# Far field: the lean strategy

Date 2026-10-30. One of three independent strategists. This angle: a sceptical senior engineer shipping on phones with one producer and AI agents. Nothing in either repo changed. No browser, build or bake ran. Everything new here came from small low-priority scripts over data already on disk, plus about 47 MB of ranged reads of Overture footprints.

**Labels.**
- **[M] MEASURED:** measured here or in the audits from the project's own data, or a constant quoted from code with its file and line.
- **[S] FROM A SOURCE:** an external fact, with its link. These come from the research reports in this folder. I re-fetched four today (WorldCover composites, R2 pricing, Overture's release calendar, Cesium issue 4043). The others are as those reports found them.
- **[E] ESTIMATE:** my arithmetic, with the assumption stated.

**Three terms used throughout.**
- **Streaming edge:** where real 1 km regions stop loading, 2.0 km from the camera at street level and 3.1-3.8 km at the ceiling [M].
- **Ground raster:** a small image of a place, one cell per 16 m, saying what is on top there (roof, street, park, water) and how light it is.
- **Block shapes:** every building merged into simple boxes on a 16 m grid, built on the phone from a second small raster of heights.

---

## 1. The answer

**Is relying on procedural generation so heavily the right move? You rely on it far less than it looks, and it is not what is wrong.**

From altitude, 48-72 % of the frame is real footprints and real heights, and visible procedural geometry is about 2 % [E, audit-bands 4.2]. The distant city is not a generated blob. It is missing. In the worst ceiling views 85-89 % of the buildings in view are drawn in no form at all [M]. The game loads real regions only within about 1.9 km, and that radius was built to sit behind a fog wall that has been off since 78a2c74 (`config.ts:77-78`) [M]. Past it there is a bare 64 m mesh with one colour ramp, and the data that would fill it is thrown away on arrival: `far.bin` ships 11 land classes and `City.ts:333` reads one bit of them [M].

Your instinct holds in two places. No pixel in the game shows a measured colour: all colour comes from rules, those rules switch off with distance, and nothing replaces them [M]. And outside San Francisco building heights are mostly invented: 0.0 % of South Asia's and Sub-Saharan Africa's Overture buildings carry a height [M, research-earth §7].

**So the fix is to stop throwing real data away, not to drop procedure.** Use real data for everything big enough to see. Keep rules for what no data can resolve: windows, roof clutter, tree shapes, the Moon's nearest few kilometres. World-scale products lean on generated content far harder than we do. Flight Simulator 2024 lists 1.5 billion generated buildings and nearly 3 trillion generated trees [S](https://gamesbeat.com/the-metaverse-didnt-die-it-moved-inside-microsoft-flight-simulator-2024-jorg-neumann-interview/). What it has and we lack is a real colour layer under them.

**What to do this month.** Keep every building on screen from the first frame by drawing it from two small rasters, baked from the tiles we already have. Then give every other city the same thing, automatically.

The worst view today, the ceiling over the Sunset looking east:

| | Today | With this plan |
|---|---|---|
| Buildings in view drawn in some form | 15 % (6,690 of 44,392) [M] | All of them, as ground tone; blocks to 7 km |
| Bare far land, share of frame | 7.4 % [M] | 0 [E] |
| Far pixels more than one ramp step from the real city | 59 % [M, schematic] | 10 % [M, schematic] |
| Added triangles | | 85k [M], against 1.26M to load that view for real [M] |
| Added draws | | 1-7 [M, 4 km chunks] |
| Added boot download | | about 0.4 MB for all of SF [M] |
| Added GPU memory | | about 3.3 MB [E], against 434 MB to keep all of SF meshed [E, audit] |

None of this has run on a phone or in the game's shaders. Section 9 is the smallest test that would show it right or wrong.

---

## 2. The plan in one idea

**Every place gets the same small stack of rasters, and everything far away is drawn from them.**

| Layer | Holds, per cell | Comes from | Why it is separate |
|---|---|---|---|
| Height | terrain height, with a per-tile base | USGS in hero cities, GLO-30 elsewhere, REMA on ice, LOLA on the Moon | Each has its own licence notice |
| Urban | building height, roof or street class | Overture footprints and streets | ODbL. Kept apart so it does not spread [S](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Horizontal_Map_Layers_-_Guideline) |
| Surface | land class, tone | WorldCover and its Sentinel-2 composite; polar and lunar sources | Stays outside ODbL only if no OSM data is burned into it [S, research-earth §9] |
| Paint | hue, level | The game, at run time | Changes; the rest never do |

Five rules keep this from painting us into a corner:

1. **Tone is a light offset, never light.** It is the same `lightOffset` every ground class already uses, so the sun stays live. Nothing is baked to one sun. Baking cast shadow into tone also made the match worse on 3 of 4 poses [M, 3.4].
2. **Class picks the ramp, and class is never filtered.** Tone is filtered, then quantised last. That keeps palette lock and the no-brown rule by construction, and removes the stray ramps at shores (`materials.ts:326`) [M].
3. **Gate on nothing but the footprint.** Ground tone conserves area, so a building cannot fall out of it. Block shapes are an enhancement on top. Section 3.2 shows why that order matters.
4. **Nothing may need haze.** Depth bands are a look. They never hide anything, because the Moon has none.
5. **A raster declares its own frame.** Its header carries an affine map to world coordinates, so a city raster and a cube-face tile are the same thing to the shader.

This month's rasters sit still in the city's own frame. Later they become rings that re-centre on the bus and stream from a planet pyramid, through the same shader. That is the path from SF to the Moon, and it is why starting small is not a dead end. The first month writes the contract. The planet only adds an address scheme.

---

## 3. What I measured for this

### 3.1 How many merged boxes does every SF building take?

feat/osm SF, 172,180 records, 33.81 km² of roof. Cell-centre raster at 4 m, a cell counts when at least half its area is roof, equal runs merged row by row, roofs in 4 m steps. Each box is 10 triangles. All [M].

| Cell | Boxes, whole city | Height raster, deflated | Roof area kept | Roads buried | Worst view past the streaming edge: all / to 7 km / to 5 km |
|---|---:|---:|---:|---:|---|
| 8 m | 184,176 | 452 KB | 94 % | 4.1 % | 61,542 / 22,844 / 6,795 |
| 12 m | 100,601 | 226 KB | 80 % | 5.2 % | 33,980 / 12,352 / 3,585 |
| **16 m** | **68,395** | **144 KB** | **77 %** | **6.5 %** | **23,381 / 8,517 / 2,437** |
| 24 m | 32,494 | 66 KB | 61 % | 8.7 % | 11,510 / 3,980 / 1,045 |
| 32 m | 15,721 | 34 KB | 46 % | 9.5 % | 6,003 / 1,882 / 448 |

- At 16 m the boxes cover 34.9 km² against 33.8 km² of real roof, so the mass neither shrinks nor bloats [M].
- Main's data is similar: 61,399 boxes, 135 KB [M].
- To 7 km, the Presidio view takes 6,507 boxes and downtown 431 [M].
- Compare `far.bin` today: 2,271 boxes for 1,848 buildings in 310 KB [M].

So **every building fits in less than `far.bin` takes today**, though `far.bin` also carries the far ground's heights and classes, and the worst view costs 85k triangles instead of the 1.26M real LOD 1 would take [M].

The merge took 0.12 s for the whole city in Python [M]. That is cheap enough to do on the phone in a worker. It means the wire carries a raster, and boxes are a device-side product with no new geometry format.

### 3.2 Does that hold outside SF?

I read footprints for four of the audit's sample boxes, 5-18 MB each. 16 m cells, same rule [M].

| Place | Buildings per km² | Mean footprint | Roof share | Boxes per km² | KB per km² | Roof area kept |
|---|---:|---:|---:|---:|---:|---:|
| SF, land [E: 141 km²] | 1,200 | 197 m² | 0.24 | 485 | 1.02 | 77 % |
| Dhaka, Dhanmondi | 1,963 | 189 m² | 0.37 | 586 | 0.94 | 76 % |
| Denver downtown | 1,026 | 296 m² | 0.30 | 503 | 1.18 | 77 % |
| Lagos, Ikeja | 1,692 | 178 m² | 0.30 | 448 | 0.67 | 73 % |
| Gulu, Uganda | 1,854 | 54 m² | 0.10 | 137 | 0.31 | **34 %** |

Two findings.

**The cost barely moves between very different cities.** It follows pixels and cells, not building count. There is also a hard ceiling: at most one box per occupied cell. In Dhaka that is 1,551 per km², so a 38° view to 7 km (16 km²) can never exceed about 25,000 boxes or 250k triangles, and to 5 km about half that [E]. Dhaka and Lagos may sit below their true counts here, because most of their heights are the 6 m default [M] and real heights merge less well. Distance is a single knob if a real city runs hot.

**Gulu breaks a coverage gate the same way Gulu broke the 20 m gate.** Huts of 54 m² are much smaller than a 256 m² cell, so most cells fall under the threshold and two thirds of the roof area vanishes from the block layer. That is why the ground raster, which conserves area, must be the layer that guarantees every building exists, with block shapes added on top. A hut is 1 px wide at 3 km from the ceiling anyway [M], so tone is the honest form for it.

Scaling the measured 0.2-1.2 bytes per building to 2.53 B buildings gives 0.4-3 GB for the planet [E], in line with research-earth's 1.3-5 GB.

### 3.3 What does the ground raster cost?

The whole baked SF frame on feat/osm, one byte per cell (class and tone), deflated [M].

| Cell | Size | On the wire | GPU, two R8 textures |
|---|---|---:|---:|
| 8 m | 1792 x 2208 | 752 KB | 7.9 MB |
| **16 m** | **896 x 1104** | **264 KB** | **2.0 MB** |
| 32 m | 448 x 552 | 71 KB | 0.5 MB |

With the 144 KB height raster, all of SF is about 0.4 MB. Making it took under 20 s on this laptop at below-normal priority, from the tiles already on disk: footprint raster 7-13 s, class and tone about 2 s [M]. **No rebake is needed, for any city already baked.**

### 3.4 Would it look right?

I built a schematic: a numpy ray march over the baked feat/osm data at game resolution, using the game's sun, light constants and palette. It compares each variant with "truth", every footprint on a 4 m raster. It is not the game: there are no outlines, windows or trees, the rules are simplified, and the raster is unfiltered, so it is noisier than a filtered one would be.

The number is the mean brightness difference from truth over far pixels, after a 5 x 3 pixel box, because exact matches mean nothing at 1.5 buildings per pixel. One ramp step is about 24 units. The bracket is the share of far pixels more than one step off. All [M, schematic].

| Pose | Today | Raster 16 m | Raster 8 m | Blocks to 7 km + raster 16 m |
|---|---:|---:|---:|---:|
| Sunset east, ceiling | 28.8 (59 %) | 13.0 (15 %) | 12.3 (14 %) | **10.9 (10 %)** |
| Presidio south, ceiling | 38.1 (82 %) | 10.6 (9 %) | 10.9 (9 %) | **10.3 (8 %)** |
| Sunset east, 250 m | 28.7 (59 %) | 15.7 (23 %) | 15.0 (22 %) | **13.0 (15 %)** |
| Sunset east, street height | 24.0 (44 %) | 20.6 (37 %) | 19.1 (33 %) | **14.7 (21 %)** |
| Same, 1-3 km band only | 19.3 | 20.8 | 19.0 | **11.9** |

I also looked. In `lean/final-sunset-east-ceiling.png` the pale band is gone, and Golden Gate Park and the avenue grid carry on to the horizon. The proposal row reads as the same city as the truth row beneath it. `lean/final-presidio-south-ceiling.png` is just as clear.

The test changed my plan in four ways:

- **The raster fixes the ceiling alone.** Blocks barely help there (9 % to 8 % over the Presidio). They earn their place as you descend, where the error at the streaming edge falls from 20.8 to 11.9. So the raster ships first.
- **16 m is enough.** 8 m costs 2.8 times the bytes and 4 times the memory for about one unit of gain.
- **Far shadows come out of the first proof.** With no cast shadow in the tone the match improves on 3 of 4 poses: Sunset ceiling 11.5 against 13.0, 250 m 14.2 against 15.7, street 18.4 against 20.6. The Presidio goes the other way, 11.7 against 10.6. A top-down shadow darkens streets that a low view cannot see. A device-side height sweep stays the answer for ice and the Moon (band 8), and it took 0.5-1.2 s for 4 M cells in numpy here [M]. It is not needed to fix SF.
- **The metric is weak on structure.** It compares local brightness. It says nothing about crawl under motion, or about beauty. Only the phone can.

---

## 4. The stack, band by band

Ranges are for the ceiling, the hardest case. "Real" means shape or tone taken from data.

| Band | Drawn | Data | Real, and procedural because | Phone cost | Bytes |
|---|---|---|---|---|---|
| **1 Near**, 0-0.9 km | Today's LOD 0 tiles and tile ground | Footprints, heights, 2 m classes, 4 m DEM, trees | Real shape, position, height. Windows, trims, roof clutter and tree shape are procedural: no global data resolves them | Unchanged: 131-366k tris per region [M], 2 draws per visible tile | 131 KB per region [M] |
| **2 Coarse**, to the streaming edge | Today's LOD 1, one mesh per region. Add: cap feat/osm rings near 6 vertices; ground past about 2 km reads the raster | Same files | Real massing. Same procedural surface, gated by pixel size | 2 draws per region. Target 25k tris per region, from 32-80k on feat/osm [M] | Same file |
| **3 Blocks**, edge to about 7 km | Merged boxes, one instanced draw per 4 km chunk, hidden per 256 m tile by the existing `uMask` | 16 m height raster | Real position and height where known. The merge is a rule. Nothing invented | +1-7 draws, +24-85k tris worst view [M], 0 in the sun pass, about 1 MB [E] | 144 KB SF [M]; about 1 KB per km² [M]; 1-5 GB planet [E] |
| **4 Ground raster**, everywhere, alone past 7 km | The same far mesh, textured | Class and tone at 16 m | Real class, roofs, streets. Tone measured on land. Colour is ramps by rule, on purpose | 0 draws, 0 tris, 2 texture reads per far pixel, 7-10 % of the frame at worst [M]; 2.3 MB with mips [E] | 264 KB SF [M] |
| **5 Tall silhouettes**, any range | Today's far boxes | `far.bin` | Real height and footprint | 1 draw, 27-32k tris [M] | About 70 KB raw [M] |
| **6 Surround**, frame edge to 30-60 km | Today's horizon mesh, textured with a 32 m raster | GLO-30 or 3DEP, Overture coverage, WorldCover, Sentinel-2 tone | All real, replacing the 40 m colour rule (`City.ts:289`) | 1 draw, 55k tris, same as today [M]; about 8 MB [E: 2000² x 2] | About 1 MB [E: 4 M cells at the 2.3 bpp of research-earth §11] |
| **7 Planet**, 60-800 km, G2 and G3 | Rings over cube-grid tiles; ocean analytic in the resolve | The three layers at 30-100 m | All real. Wave detail is procedural: no data exists | ≤ 8 draws claimed, unverified, see 11; ≤ 65k tris [S, WORLD-TRAVEL]; about 25 MB [E] | 14-15 GB at 100 m, 128-146 GB at 30 m [E, research-earth] |
| **8 Orbit**, 10-50 km up | Same tiles, coarser levels; limb and stars in the resolve; sweep shadows from height on ice and Moon | Same | Same | 0-8 draws | Included above; Antarctica 2-5 GB, Moon about 25 GB [E, research-polar-lunar] |

Storage stays cheap at the verified R2 rate of $0.015 per GB-month with free egress [S](https://developers.cloudflare.com/r2/pricing/). The lean order is 100 m worldwide first (about $0.20 a month), then 30 m (about $2), and 10 m only over built-up land and hero landscapes. A full stack is about 1,150 core-hours and $100-200 on one rented machine [E, research-earth §11].

**The coarse band is where "not beautiful" lives.** It is 64 % of the ceiling frame [M], and it is real data that reads as rubble: 4 colours cover 49-78 % of a band [M]. feat/osm fixes the literal blobs on the ground: 83.8 % of the sunlit green in downtown-ceiling comes from main's "grass" rule, and on OSM only 14 % of those cells are grass [M]. Past that, these are cheap experiments. Each is a constant or one texture read, each is untested, and each must pass `tools/shimmer.py`:

1. Fade outlines by camera height instead of a fixed 520 m. Depth breaks only. A fading line is the cheapest pop cover [S](https://www.gamedeveloper.com/marketing/how-shedworks-refined-the-art-of-sable-in-pursuit-of-readability).
2. Widen each roof's tone from ±0.42 of a step toward ±1 past 1 km, so neighbours stop merging.
3. Start a gentle depth band at about 2 km as a ramp remap, not at 12.5 km.
4. Point coarse ground at the raster past 2 km. Its 2 m class texture has no mips, and at 3 km it samples about one texel in 30 [M].
5. Later: one byte per building of measured roof tone from Sentinel-2. `seed_for` (`bake.py:2097`) already lets a colour steer tone, so the first measured pixels in the game need no format change.

---

## 5. How pop-in goes away

Keeping a coarse form of everything resident, and drawing it until the finer one arrives, is standard practice in [Unreal HLOD](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine), [Cesium](https://cesium.com/learn/cesium-native/ref-doc/selection-algorithm-details.html) and [Asobo's terrain system](https://www.asobostudio.com/files/inline-images/Designing_Terrain_System_Fuentes_Lionel.pdf) [S]. Cesium hit this exact bug over Chicago in 2016 and proposed geometry for tall buildings with a raster for the rest. That [issue](https://github.com/CesiumGS/cesium/issues/4043) is still open with no resolution recorded [S, fetched today], so I know of no shipped proof.

1. **Nothing is ever absent.** Rasters load at boot, before the first region. The loading radius stops being a visual edge.
2. **Colour matches by construction.** Rasters are baked from the same tiles the real buildings come from. My Python rules only approximate the shader, so one calibration is needed: fit each class's mean offset once against a top-down in-game frame, then apply it everywhere.
3. **Block shapes dissolve, real buildings do not.** A loading tile fades its blocks out over about 0.3 s with the Bayer dither, so `discard` lands only on block fragments, and real building materials keep their early depth test.
4. **The radius can shrink.** With the edge hidden, cutting the ceiling radius from 1,871 m to 1,400 m removes about 44 % of loaded area [E], which pays for the blocks and part of feat/osm's bill.

**The test is a hold-still swap.** Same pose, regions frozen, then loaded. The share of far pixels that move by more than one ramp step after a 5 x 3 box must be at or under 15 % at the ceiling and 25 % at street height. No region-sized edge may be visible by eye.

---

## 6. Every other city

Each input is global, and no far layer needs a height tag.

| Layer | Input | Coverage |
|---|---|---|
| Urban | Overture, 2,533,842,612 footprints [M]. Streets and water are separate files | Global |
| Class | WorldCover 10 m, already in the bake | To 60°S [M] |
| Tone | WorldCover Sentinel-2 composites, 10 m, 2020-2021, CC BY 4.0, bucket `esa-worldcover-s2` [S, fetched today](https://registry.opendata.aws/esa-worldcover-vito-composites/) | To 60°S |
| Terrain | Copernicus GLO-30, reached by bbox instead of `horizon.py:24`'s one hard-coded tile [S](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf) | Global. A surface model: mask it out under cities |
| Height of blocks | Tags, then [Google 2.5D](https://sites.research.google/gr/open-buildings/temporal/), [Microsoft](https://github.com/microsoft/GlobalMLBuildingFootprints), 3D-GloBFP, GHS-BUILT-H, neighbours [S, research-earth §12] | Regional. At 5 km one pixel is about 10 m, so 5-10 m error is about a pixel [E] |

Imagery goes in as evidence for tone, never as pixels. Natural colour contains brown, so class picks the ramp and measurement picks the step, histogram-matched per class. Google Maps' 2020 colouring is the closest precedent [S](https://blog.google/products/maps/more-detailed-colorful-map/). Google, Bing and Mapbox imagery cannot be baked at all under their terms ([Google](https://cloud.google.com/maps-platform/terms), [Bing](https://www.bingmapsportal.com/terms), [Mapbox](https://www.mapbox.com/legal/product-terms)) [S].

**London and Amsterdam prove nothing here.** Their frames fit inside the load radius, so the defect cannot appear [M, audit-limits §5]. The tests are whole-city frames of at least 10 km with no hand tuning: **Denver and Dhaka first**, then Gulu, Longyearbyen and La Paz.

Fix these before Denver. Each is small, and none is SF-specific art:

- The climb ceiling is 520 m above sea level, so the yoke cannot climb in Denver (`config.ts:191`, `Flight.ts:254`).
- Heights clip at ±3,200 m, and a tree above 3,276.7 m crashes the bake (`bake.py:2497,2529`).
- Far lakes drop to y = -6 at any altitude (`City.ts:335`).
- Default ground, architecture and trees: `osm.py:579`, `bake.py:1959,2350`.
- `district()` runs in every city (`towerStyles.ts:328`).
- `bake.py:2608` credits any DEM as USGS.

The bake also has to report the share of heights that are invented. A real city that looks wrong should be explainable from its QA line.

---

## 7. Over each kind of place

From the ceiling and at G1. All sizes are [E] from the research reports.

| Place | What you see | Real | Procedural, and why | Bytes | Main risk |
|---|---|---|---|---|---|
| **Dense city** (Tokyo, Dhaka) | Real tiles near in hero cities; blocks to 7 km, then raster; tall boxes; never empty | Footprints, streets, class, tone; heights by the ladder | Windows and roofs near, below data | About 1 KB per km² urban [M] | Mostly default heights flatten a six-storey city until 2.5D is wired |
| **Farmland** | Field patchwork in tone, roads, farmsteads as boxes, tree rows as points | All from Sentinel-2. Cropland is one class, so tone is the only thing that shows fields | A per-class pattern under about 2 px, from data's tone | 1 KB per km² at 30 m, 4-5 at 10 m | 30 m cells are blocky from 150 m up: needs that pattern |
| **Desert** | `DRY_LAND` ramp (row 36), dunes from height and sun | Tone stretched per class, since fixed thresholds flattened the Sahara to 1-2 steps [M] | Fine ripple only | Below the mean | Sand borrows `SKY_WARM`, so a desert horizon loses its edge until it gets its own ramp |
| **Forest** | One ramp, canopy texture and clear-cuts in tone; tree points near | GLO-30 is a surface model, so canopy shape is real at altitude | Tree shape | Above the mean; Amazon was the worst sample [M] | Low flight over a surface model: trees need to sit on the canopy, not under it |
| **Ocean** | Today's plane with prefiltered dashes; later analytic, 0 draws, with [GEBCO](https://www.gebco.net/data-products/gridded-bathymetry-data) shelf tone and a real coast | Coast and depth | Waves and glitter: no data, and it moves | About 0 for the surface | Glitter strobing at G3, already flagged in WORLD-TRAVEL |
| **Ice sheet** | Long low-sun relief. McMurdo's sun is 1.7-25.9° today | [REMA](https://registry.opendata.aws/pgc-rema/) 32 m; class from [BedMachine](https://nsidc.org/sites/default/files/documents/user-guide/nsidc-0756-v004-userguide.pdf) and [ADD rock](https://data-search.nerc.ac.uk/geonetwork/srv/api/records/815525ca-cefe-4fbf-9224-3ee784e7de4e); default ICE, per [OSM's convention](https://wiki.openstreetmap.org/wiki/Antarctica/Tagging). Red-band contrast on the Ross Ice Shelf is 0.9 % [M], so imagery adds almost nothing there | Sastrugi below data, fading out where a texel reaches 2 px | 2-5 GB for the continent | Needs height shadows and 0.25 m height steps, or flat ice terraces |
| **Lunar highlands** | Black sky, hard shadow, craters to a curved horizon 48 km off | [LOLA](https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m), SLDEM; tone albedo-like from [WAC Hapke](https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_HAPKE), never the raw WAC mosaic, whose 55-75° shadows fight a moving sun | Seeded craters over the nearest 3-10 km only, added on top of real relief | About 25 GB | Needs the curve chunk, a far plane past 48 km, and a sweep at low sun. No haze anywhere |

Antarctica and the Moon are smaller than cities and depend on the same three commitments: a cube grid, shadows from height, no haze. Nothing this month blocks them, and nothing this month should be spent on them.

---

## 8. How painted buildings read at distance

Today paint stops existing past the streaming edge: a painted tower turns grey and a painted house disappears [M]. `far.bin`'s paint index is unread, and reading it would save only tall buildings.

**Use a world-anchored paint raster instead.** One R8 texture at 32 m over the frame (448 x 552, about 0.33 MB with its levels [E]) holds hue and level per cell. The existing `uploadRect` sends one dirty rectangle per frame. Block shapes, tall boxes and the ground raster all make one extra read: painted cell, paint ramp. No per-instance data, no second path.

| Range | What you see |
|---|---|
| To the streaming edge | Today's paint in full: walls, gardens, domes, ground |
| Edge to 7 km | Block tops and walls take the hue of their cell. A painted house is a 32 m dab, about 4 px wide at 5 km [E, from the audit's pixel table] |
| 7 km to the frame edge | Ground cells flip to paint. Coarser levels take the strongest paint in the cell, so a painted block is never thinner than one pixel row and does not flicker |
| At any range | Landmarks stay painted. District beacons keep their 3 px floor (MAGIC-SPEC #5) |

Paint keeps its saturated ramps while the far grey stays quiet, which is why the blast frame in sheets-E-end works. The far fade should hit paint a step later than grey, so the rainbow is the last thing to go.

Save the raster itself, run-length coded the way `GroundPaint` does, in a new key. Saved building ids stay untouched. After the update a painted area shows at distance once its region has loaded one time.

This also gives you paint on empty ground. The same raster is the "paint clipmap" that ice, regolith and cloud decks need, and it gets around the `MAX_TILES = 160` and one-draw-per-tile limits there [M]. Later, in a city with no real tiles yet, you could paint block shapes through it with no building ids at all. That is one mechanism in place of four.

---

## 9. The smallest proof

**Already done offline:** sections 3.1-3.4, with no GPU.

**Proof 1, about one agent day [E], once the GPU is free.**

1. Write `tools/bake/farmap.py`. It reads SF's baked tiles and writes one 16 m class-and-tone raster. No rebake.
2. Behind `?farmap`, draw the far ground from it. No blocks, no paint, no Sentinel-2.
3. Register the material for warm-up. `warmcheck` must report 0.
4. Fly the real game: ceiling over the Sunset looking east, then Presidio looking south, then descend to street level. Capture with `tools/altitude.mjs`, including the fog-off shot the audit could not get.
5. Run the same flight on a real A15.

| Passes if | Fails if |
|---|---|
| Bare far land goes from 7.4 % to 0, and no building in view is absent | Any land with no city on it remains |
| Draws and triangles do not rise, and the A15 holds 30 fps | Frame time rises by more than 1 ms [E threshold] |
| Hold-still swap: at most 15 % of far pixels more than one ramp step off at the ceiling | A region-sized edge is visible by eye |
| A 3 s pan passes `tools/shimmer.py` | The raster crawls and no filter setting stops it |
| The producer, on the phone: "the city is there" | The producer: "it looks like a printed carpet" |

A failure is informative either way. Crawl or a carpet look says blocks must go further out or the raster must change. A swap failure says calibration comes first. If it passes, the top defect is fixed at the ceiling for one day of work.

---

## 10. The month

One visible win a week, each checked on a real iPhone. Effort is [E].

| Week | Ships | Producer sees | Effort |
|---|---|---|---|
| **Nov 2-6** | Proof 1. The small fixes from audit-bands §7: far terrain poke-through, flat ramp index, water dash prefilter, tower base band gate | Whole city from the ceiling. Pale slabs and shore fringes gone | 2-3 agent days |
| **Nov 9-13** | Block shapes in a worker, the dissolve, the hold-still swap tool. Paint raster | Descent with no region popping. Painted blocks stay visible from the ceiling | 3-4 agent days |
| **Nov 16-20** | Surround raster for the Bay Area: Overture coverage, WorldCover, Sentinel-2, 3DEP. The mid-field constants | Berkeley and Oakland are there, and Marin is not one flat band | 3-4 agent days; a slow download, about an hour at today's 92 KB/s [M] |
| **Nov 23-27** | The same tool on Denver and Dhaka, frames of at least 10 km, no hand tuning. The plain bugs in 6. feat/osm's LOD 1 ring cap | A second and third city that read correctly on arrival | 4-5 agent days |

Freeze the raster format before Overture's next major breaking release, reserved for 2026-12-16 [S, fetched today](https://docs.overturemaps.org/release-calendar/). Releases are deleted after at most 60 days, so a bake must archive its inputs.

After that, in order: the cube-grid spike, the `Body` record, a planet raster at 100 m on one rented machine, moving rings, leaving SF. Nothing needs this laptop to bake the world, and nothing should try: its 8 GB handles a city, not a planet.

---

## 11. WORLD-TRAVEL.md: what to throw away

| It says | Lines | Why it goes | Instead |
|---|---|---|---|
| City content in UTM zone frames, keys `{zone}{N|S}/{rx}_{rz}`, yaw at zone crossings | 31-33, 138, 174-176, 543-550 | No zones past 80°S, 12 km wide at 89°S, none on the Moon. It forces a rebake and a paint migration of every city for no visible gain | Keep each city's local frame, good outside the last degree of latitude [M]. One cube grid per body for planet tiles [S](https://s2geometry.io/devguide/s2cell_hierarchy) |
| Mercator z0-z11 atlas of height, class, coast SDF, density | 337-350 | Mercator stops at 85.05° [S](https://learn.microsoft.com/en-us/bingmaps/articles/bing-maps-tile-system). Class is empty on ice and the Moon. Scalar density is a blob. "A few GB" is low, 24-94 GB by the audits [E] | The three layers on a cube grid |
| Stored hillshade | 308 | One sun, baked in | Live light. Height sweep where needed |
| L4 metro tiles: boxes of at least 20 m plus density-extruded blocks | 505, 556 | It is today's defect at a larger scale: 0-2.5 % of buildings [M] | The urban raster |
| L3 coarse "1-20 km" | 506 | False. It ends at 3.1-3.9 km [M], so the top defect's band has no product | Bands 3, 4 and 6 |
| Uncharted is a fog bank | 60-61, 536-539 | Fog is off, and the Moon has none | The planet raster: nothing is uncharted |
| Tier 2: on-demand bake service, containers, 0.5 TB re-partition per release | 521-528, W4 | A service to run, watch and retry, for one producer. "Seconds per job" against about 30 min for SF today and no region-parallel bake [M] | Far layers for the whole planet in one batch. Real tiles for a growing list, on a schedule |
| Monthly re-bake of changed regions | 533-534 | An operations job, and inputs expire in 60 days [S] | Yearly for surface, at most quarterly for urban |
| Shadows off above 2 km | 487 | On ice and the Moon that removes the picture | Off over open ocean only |
| Geoid ignored | 141 | REMA is about 50 m off at McMurdo [M] | Vertical correction per source |
| AWS Terrain Tiles bathymetry | 343 | A Mercator source | GEBCO |
| Tier 1: about 20 more hand-tuned hero cities, each with landmarks, an opening move, fog and sound | 517-520 | Hand work per city does not fit one producer, and it is the opposite of the scale rule | 3-5 heroes. Everything else gets the automatic far layers and looks right on arrival |
| 21-30 engineer-weeks on three tracks | 940-943 | Assumes three senior tracks in parallel. The real limits here are one producer's eyes, one phone and one busy GPU | One visible win a week |

**Check before relying on it:** clipmap "≤ 8 draws" (line 332). The GPU Gems layout gives 53 draws at 8 levels, or 26 instanced [E, formula](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry). One draw per ring is a different structure and needs its own spike, and cube-face seams may add to that.

**Keep:** float64 truth and the floating origin; `pipeline.rebase()` with the lattice offset, as the only renderer change rebasing forces; the curve chunk with R as a parameter; adaptive near and far; the analytic ocean; the heights ladder, extended; Sky.ts behind a `Body` record, returning a vector; the server design with cell ids from the cube grid; navigation and the crossing's beats; automated beauty sampling across random cities, which is exactly the kind of job agents should own.

---

## 12. Options I rejected

| Option | Why not |
|---|---|
| Turn fog back on, zero work | It hides the city instead of drawing it. You removed it, and the Moon cannot have it |
| Raise the streaming radius | 1.26-1.37M more triangles on feat/osm [M] and most of 25.5 MB [M]; the budget is 1.0-1.5M |
| One box per building | 44,392 boxes for about 25,000 pixels is 18 triangles per pixel [E]. It fails at 2.53 B |
| Street-block outlines | 459k triangles for all SF [E] against my 684k, so a fair option, but they need a mapped street network. The raster does not, and Gulu's streets are only partly mapped |
| Flat raster only, no blocks | Best week-one step and wrong as the end state: at street height the edge error is 20.8 against 11.9 [M, schematic] |
| Height-field ray march in the far ground | Cost follows pixels, about 800,000 fetches a frame [E, research-priorart]. Attractive, unproven on Safari, and it needs `gl_FragDepth`. **Plan B** if blocks crawl |
| Photogrammetry or Google 3D tiles | Barred by terms [S](https://developers.google.com/maps/documentation/tile/policies), and no building identity to paint |
| Planet pyramid first | It does not fix San Francisco. Weeks of work with nothing visible |

---

## 13. What would kill this

1. **Crawl.** The raster or blocks shimmer under motion at 1-2 px, and no filter fixes it inside the palette rules. Untested.
2. **Printed carpet.** Real shaders make the far strip read as a flat photo of a city. The schematic cannot rule this out.
3. **Lego at the edge.** A 16 m cell is 8 px wide at 2 km from street height [E]. Stair-stepped diagonals at the swap may look worse than a brightness metric says. The fallback is 8 m near the edge, at 2.7 times the boxes.
4. **Colour seam.** One calibration fails to hold real materials within a step, and a 1 km grid line returns.
5. **No triangle headroom.** The ceiling already sits near budget and feat/osm likely passes it [E, audit-bands]. If LOD 1 cannot be capped, there is no room for anything.
6. **Flat cities.** Where 96-100 % of heights are defaults, blocks draw Dhaka as uniform low fabric until 2.5D rasters are wired.
7. **Global tone.** Seams, clouds or class errors in composites look worse than clean class colours. Then tone falls back to class and density. Google's precedent also left parts of the Sahara grey [S, secondary](https://tagteam.harvard.edu/hub_feeds/3382/feed_items/2754626).
8. **Cube-face seams.** Rings on six lattices may swim or need more draws. A later risk, and it does not touch cities.
9. **Licence mix.** Streets burned into the surface raster spread ODbL to it. Two files prevent this. Counsel should still read section 9 of research-earth.

---

## 14. Decisions for the producer

1. **Move feat/osm ahead of stages?** I recommend yes. The sutro blobs are main's 17 m ground rule, and stage anchors read that same class grid (STAGES.md:170-172), so building stages first means retuning them.
2. **Agree that past the streaming edge buildings are simple shapes with no windows.** At 3 km and beyond a house is 1-2 px, so nothing visible is lost [M]. I want it said out loud.
3. **Who runs the weekly iPhone check?** Controls, super splat and hybrid have never run on a real phone (HANDOFF), and this plan's main risks can only be seen there.
4. **Later, not now:** $100-200 for one rented machine and a bake of the planet raster [E].

---

## 15. Not confirmed

- **Nothing ran in the game, a browser or on a phone.** Band costs are counts, not frame times. The 1 ms threshold is my guess.
- **The schematic is not the renderer.** The raster in it is unfiltered, so far rows are noisier than they should be. Its metric measures brightness, not structure.
- **Poses.** The Sunset street-height pose uses the logged rig offsets at a bus height I chose, so the camera sits about 120 m above ground rather than the logged 83 m [E]. The Sunset and Presidio ceiling poses are the audit's simulated ones.
- **Cross-city boxes.** These are one box per city, with default heights in Dhaka, Lagos and Gulu. I tested only the 50 % coverage rule.
- **Calibration, filtering and the dissolve** are designs, not tests. Whether class-and-tone anisotropic filtering works inside `calm` is unknown.
- **The surround's bytes** are an estimate. I did not fetch a Bay Area raster.
- **How much land is built up**, which sets the size of a "10 m only in towns" layer, is unknown.
- **A15 memory headroom** was not measured. This plan adds little, so it matters more for later bands.
- **Every polar and lunar figure** rests on samples in research-polar-lunar, and none has been rendered.
- **All external facts** except the four re-fetched today are as the research reports recorded them, with their own gaps (research-earth §14, research-polar-lunar §12, research-priorart §10).

---

## Evidence

Under `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/lean/`:

| What | File |
|---|---|
| Box counts, SF, both datasets | `mass_probe.py`, `mass_osm.json`, `mass_main.json` |
| Other cities | `other_probe.py`, `other_Dhaka-Dhanmondi.json`, `other_Denver-downtown.json`, `other_Lagos-Ikeja.json`, `other_Gulu-UG.json` |
| Raster bytes | `plate_bytes.py`, `plate_bytes.json` |
| Schematic and its numbers | `preview3.py`, `preview3.json` |
| Today, proposal, truth | `final-sunset-east-ceiling.png`, `final-presidio-south-ceiling.png`, `final-sunset-east-250m.png`, `final-sunset-east-street.png` |

Audits and research: `audit-bands.md`, `audit-limits.md`, `research-earth.md`, `research-polar-lunar.md`, `research-priorart.md` in the parent folder. Code citations are at feat/hybrid (main's world and render code) and feat/osm, as in the audits.
