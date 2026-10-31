# Far-field audit: what is on screen at each distance

Code read: `C:/Users/Utku/sbw-main` at feat/hybrid ea1604d (world and render code as main) and `C:/Users/Utku/Struggle-Bus-World` at feat/osm c17bc4a. No browser, build or bake was run. Date 2026-10-30.

Number labels: **[M]** measured here from the repo's data files, the real mesher in Node, or a run logged in the repo. **[S]** from a source: a constant or doc in the repo, path given. **[E]** estimate. No external web fact is used, so there are no URLs; DEM, LiDAR and OSM facts come from the repo's own configs and docs.

Pictures made for this audit, all under `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/audit/crops/`:
- `bands-sheet.png`: simulated band map of four poses. Green detail, blue coarse, orange far boxes, red bare far land, tan horizon, dark blue water.
- `class-west.png`, `class-sutro.png`: ground classes, old SF (left) against feat/osm (right).
- `farpoke-sutro.png`: white = far terrain standing above the near ground.

---

## 1. The findings

1. **The follow-up is right, and it is worse in the west than in the listed shots.** From the ceiling looking along the city, 85-89 % of the buildings in the view are drawn in no form at all. Sunset looking east: 44,392 buildings in the wedge, 5,779 real, 911 boxed, 37,702 absent. Presidio looking south: 47,105, 5,215 real, 60 boxed, 41,830 absent [M, simulation from the streaming rules]. The listed shots hide this: they look at downtown, where tall buildings and the bay fill that part of the frame (12-27 % absent [M]).
2. **The missing city is a thin strip with more buildings than pixels.** Those ~40,000 buildings would land in 6.7-7.4 % of the frame, about 22,000-25,000 game pixels in a strip 70-85 rows tall: 1.5-1.9 buildings per game pixel [M]. That strip is 12 % of the land pixels and holds 87 % of the buildings in view [M].
3. **The cause is a streaming radius built to sit behind a fog wall, and the fog is off.** `config.fog.farFull` 2600 m carries the comment "Streaming edge hides behind this" (src/config.ts:77-78) [S]. DECISIONS says everything below 50 m, "the streaming edge among it, is buried" [S]. HANDOFF already lists "with fog off it shows" [S]. Nothing replaced the fog when it was turned off.
4. **Pop-in is region-sized.** A whole 1 km region appears at once, 1,974 m from the camera at street level, 2,313 m at 250 m, 3,084-3,834 m at the ceiling [M]. At 3 km from the ceiling one region is ~190 game pixels wide, half the frame [M].
5. **Blobs are not mainly procedural generation.** Real footprint-and-height massing is 48-72 % of the frame in the chase and ceiling shots; visible procedural geometry from altitude is ~2 % (trees) [E]. The blobs come from five things: nothing drawn past ~3-4 km; a ground rule on main that calls anything 17 m from a building "grass"; far meshes with 1-2 ramps on 64 m and 256 m grids; a mid-field that loses outlines, windows and shadows at altitude; and a far-terrain mesh that pokes through the near ground on 6.7 % of the land [M].
6. **What the producer senses is real in one way: no pixel carries a measured colour.** All colour is chosen by rule from 24 ramps. OSM has a facade colour on 0.11 % of SF's building parts [M]. The procedural surface layer (windows, trims, facade bands) switches itself off with distance to avoid crawl. Nothing replaces it, so distance reads as blank.
7. **At the ceiling no house has a window, no building has an outline, and no tree casts a shadow** [M from constants: section 3.3]. In the mid-field, 4 colours cover 49-78 % of a 53-row band [M].
8. **Paint stops existing past the streaming edge.** `far.bin` carries each box's paint index and `City.ts` never reads it (only `f.index.length`, City.ts:368) [M]. A painted tower turns grey, a painted house disappears, ground paint and painted trees go with them. The hand-built landmarks are the exception.
9. **feat/osm fixes the near ground and nothing past the streaming edge.** Real streets, lakes and yards replace main's blobs inside the loaded regions. The far band is unchanged and thinner: 1,848 buildings boxed (1.09 %) against 2,245 (1.59 %) [M]. It also costs 2.2 times the coarse triangles: 4.77M for the whole city against 2.19M [M].
10. **Other cities get less.** Only SF has a horizon ring, and `horizon.py` hard-codes one USGS tile [S]. Outside the baked frame every other city sits on the 60 km water plane, so London and Amsterdam are islands in a sea [M from code]. They have no DEM (flat ground at 1 m) [S]. London's heights are 71 % floor counts, 19 % copied from neighbours, 6 % defaults [S: city.json stats].
11. **Bytes are not the limit, vertex memory is.** All of SF's footprints and heights are 4.78 MB on the wire on main, 8.54 MB on feat/osm [M]. Keeping all of it meshed at today's coarse LOD would be ~210 MB of vertices on main and ~434 MB on feat/osm [E from M counts].

---

## 2. The starting facts, checked

| Claim | Verdict | Numbers |
|---|---|---|
| Regions load within 1500-1900 m of a focus point | True, with two riders | The test is distance to the region's rectangle, not its centre (City.ts:433-436). The focus moves up to 950 m ahead of the bus with height (main.ts:936-937) [S] |
| About 6 % of 205 km2 is loaded | True at street level only | 12 of 196 regions, 6.1 %. 250 m: 14, 7.1 %. Ceiling: 18-21, 9.2-10.7 % (19-22 km2) [M] |
| 2,641 far entries, 1.9 % of 140,961 buildings | Entries are boxes, not buildings | 2,641 boxes = 2,245 buildings = 1.59 %. By footprint area 9.9 %, by volume 37.1 % [M]. feat/osm: 2,271 boxes = 1,848 buildings = 1.09 % of 169,503 [M] |
| Bare 64 m ground grid | True | Stored at 32 m, drawn at step 2 (City.ts:320) [S]. One ramp for all land, one for water |
| A view reaches 20 km | True for land | Contrast starts compressing at ~12.5 km, everything becomes a FOG-ramp silhouette at 16.4 km, fully faded at 20 km [M from `sbFog` + resolve]. Far plane 30 km [S] |
| Docs: coarse ground is an 8 m grid, detail 4 m | **False** | `cell` is 4 m, so step 4 = 16 m and step 2 = 8 m (bake.py:57-58, City.ts:563, terrainMaterial.ts:125). Comments in City.ts, DECISIONS and WORLD-TRAVEL 3.1 all repeat the wrong figure [M] |
| WORLD-TRAVEL 3.1: L3 coarse covers 1-20 km | **Not what the code does** | Coarse ends at 3.1-3.9 km from the camera [M]. L4 reuses the 20 m box rule. In a city at G0/G1, 4-20 km has no layer [M] |

---

## 3. The bands

### 3.1 Every band, street to horizon

Constants are [S] from the code cited. Mesher numbers are [M]: the real `meshBuildingTile` run in Node on five sample regions. Bytes are [M] file sizes.

**What draws it**

| Band | Mesh | Data | Grid | Ramps it can show |
|---|---|---|---|---|
| **1 Detail** | Per-tile merged LOD 0 buildings; per-tile ground (City.makeTileTerrain) | `r_x_z.bin`: footprints, parts, heights, 2 m classes, 4 m DEM, trees | Rings to 0.1 m. Ground mesh 8 m, class texture 2 m | Most buildings 3 (GREY, GREY_LIGHT, WINDOW); towers add GLASS, STONE, GRANITE, WHITE, GLOW_WHITE. Ground 4 on main, 6 on feat/osm. 8 steps each |
| **2 Coarse** | One LOD 1 building mesh + one ground mesh per 1 km region (City.ts:511-590) | Same file, same bytes | Rings to 0.1 m, flat tops. Ground mesh 16 m; class texture 512 px, 2 m, nearest, no mips | Same shader as band 1; detail drops by pixel size |
| **3 Far** | InstancedMesh unit boxes (City.ts:368-406); one 64 m ground mesh over the whole frame, never culled | `far.bin`: boxes, 32 m heights, 32 m classes | Box = minimum rotated rectangle of the footprint. Ground 64 m | Boxes 1 (GREY), 3 tones in practice. Ground 2 (GREY_LIGHT, WATER) plus stray ramps at shores (section 7) |
| **4 Horizon** | One mesh outside the frame (City.ts:264-315). SF only | `horizon.bin`: 128 m DEM | Drawn at 256 m, to +/-32 km | 2, chosen by a rule: above 40 m GREEN_GREY, else GREY_LIGHT. Stray FOG and SKY_WARM between them |
| **5 Water** | 60 km plane at y -0.6 | None | Per pixel | 1 (WATER) |
| **6 Sky** | Resolve pass | None | Per pixel | 2 (FOG, SKY_WARM) |
| **Always on** | Golden Gate, Bay Bridge west span, Sutro, Transamerica, Coit, Ferry Building, 181 Fremont spire | Hand-built, placed by real coordinates | Own meshes | Own ramps |

**What it costs, where it ends, and whether paint survives**

| Band | Triangles | Draws | Bytes on the wire | Hands over | Painted buildings |
|---|---|---|---|---|---|
| **1 Detail** | Main 149-237k per region, feat/osm 131-366k [M]. Ground 2,048 per tile [M] | 2 per visible tile; more in the sun pass | Main mean 98 KB per region, max 198; feat/osm 131, max 287 [M] | Swaps to coarse when `detailD` > 910 m, back at < 520 m (City.ts:447-448), a whole region at once | Yes, in full: walls, glass, gardens, domes, ground paint |
| **2 Coarse** | Main 22-25k per building-dense region, feat/osm 32-80k [M]. Ground 8,192 per region [M] | 2 per region; building again in the sun pass | Same file: a coarse region downloads everything a detailed one does | Loads when the rectangle is within `loadR`; unloads past 2300-2800 m | Yes. Ground paint costs +1 draw per painted tile. Trees only to their own limit (3.3) |
| **3 Far** | Boxes 31,692 (feat/osm 27,252), ground 123,648, always drawn [M] | 2 | `far.bin` 299 KB (310) [M] | Each box hides when its 256 m tile loads (vertex shader, City.ts:384). Ground never hides | **No.** Boxes are uniform GREY; everything under 20 m is absent |
| **4 Horizon** | 54,750, always drawn [M] | 1 | `horizon.bin` 190 KB [M] | Ends at +/-32 km; fades out with distance | None: no buildings exist here |
| **5 Water** | 2 | 1 | 0 | Under everything | n/a |
| **6 Sky** | Full-screen pass | Post | 0 | Past the 30 km far plane | n/a |
| **Always on** | Not measured | Not measured | 0 | Never unloaded | **Yes, at every distance** |

Boot download for all far data: city.json 43 KB + far 299 KB + horizon 190 KB = 532 KB on main [M].

### 3.2 Where the bands fall at each height

Poses are logged camera positions from `shots/local/merge-look/alt-next/downtown-report.json` [M], except the marked ones. Frame shares come from a ray march over true footprints on a 4 m raster, one ray per 2 x 2 game pixels, using the rules in City.update and main.ts [M, simulation; occlusion is included, tree crowns and props are not].

| | Street | 250 m | Ceiling |
|---|---|---|---|
| Camera above ground | 83 m | 308 m | 666 m |
| Lens, pitch | 24 deg, 19.0 deg | 29.3 deg (vista 0.38, settling), 22 deg | 38 deg, 22 deg |
| Stream centre ahead of the bus | 0 | 391 m | 950 m |
| `loadR` | 1500 m | 1626 m | 1871 m |
| Regions (detail among them) | 12 (6) | 14 (4) | 18-21 (0) |
| Loaded area | 12.6 km2, 6.1 % | 14.7 km2, 7.1 % | 18.9-22.0 km2, 9.2-10.7 % |
| Loaded bytes, main / feat/osm | 1.78 / 2.51 MB | 1.96 / 2.62 MB | 2.57-2.88 / 3.46-4.12 MB |
| Loaded LOD 1 triangles, main / feat/osm | 277k / 594k | 321k / 587k | 300-459k / 763-912k |
| Whole frame, logged | 120 draws, 1.07M tris | 180, 1.39M | 130, 1.15M |
| Nearest building not loaded, from camera | 1,974 m | 2,313 m | 3,084-3,834 m |

The logged totals include the sun pass (src/ui/Perf.ts:15-16) [S]. Alamo logs 126 / 1.20M, 129 / 1.18M, 162 / 1.18M (`merge-facade/fps/fps.json`) [M]. HANDOFF records 1.8M and 200 draws at 250 m over Alamo Square, over budget already [S]. The feat/osm figures above, doubled by the sun pass for what is in its window, suggest the ceiling goes over budget once it merges [E].

**Share of the frame by band, main data [M, simulation]**

| Pose | Sky | Water | Detail | Coarse | Far boxes | **Bare far land** | Horizon | Distance to the bare land (p5-p95) |
|---|---|---|---|---|---|---|---|---|
| Street, downtown | 10.8 | 0 | 80.7 | 4.7 | 3.2 | 0.0 | 0.6 | n/a |
| 250 m, downtown | 14.3 | 3.2 | 69.8 | 5.3 | 4.4 | 0.6 | 2.4 | 3.6-8.0 km |
| Ceiling, downtown (listed shot) | 24.0 | 8.1 | 0 | 64.5 | 0 | 0.7 | 2.6 | 4.0-7.7 km |
| Ceiling, Alamo (pose estimated) | 24.0 | 8.4 | 0 | 63.6 | 0.3 | 0.3 | 3.5 | 3.3-4.1 km |
| Ceiling, Sunset looking east | 24.3 | 2.2 | 0 | 63.9 | 1.0 | **7.4** | 1.3 | 3.4-9.5 km |
| Ceiling, Presidio looking south | 24.0 | 0.4 | 0 | 65.8 | 0.4 | **6.7** | 2.8 | 4.1-10.3 km |

feat/osm matches within 1.3 points on every band [M].

**Buildings in the view wedge, ignoring occlusion [M, simulation]**

| Pose | In wedge | Real | Boxed | Absent | Absent by footprint area | LOD 1 tris of what is not loaded |
|---|---|---|---|---|---|---|
| Street, downtown | 4,015 | 24.6 % | 14.8 % | 60.6 % | 33.1 % | 102k |
| 250 m, downtown | 4,129 | 40.8 % | 8.5 % | 50.8 % | 29.2 % | 88k |
| Ceiling, downtown | 4,728 | 72.5 % | 0.4 % | 27.1 % | 14.1 % | 23k |
| Ceiling, Alamo | 3,115 | 85.5 % | 1.9 % | 12.6 % | 3.8 % | 9k |
| Ceiling, west (37.76, -122.48) | 30,308 | 24.7 % | 0.5 % | 74.8 % | 79.4 % | 371k |
| Ceiling, Sunset looking east | 44,392 | 13.0 % | 2.1 % | 84.9 % | 78.6 % | 645k |
| Ceiling, Presidio looking south | 47,105 | 11.1 % | 0.1 % | 88.8 % | 82.3 % | 598k |

On feat/osm the last two are 84.4 % and 88.5 % absent, and the unloaded LOD 1 triangles are 1.26M and 1.37M [M].

At street level the near buildings hide most of the hole. From a hilltop floor the camera sees what the ceiling sees [E].

### 3.3 Cut-offs that do not follow the bands

These switches decide what the mid-field looks like. Rules are [S]; distances are [M], computed from the rules.

| Effect | Rule | Street | 250 m | Ceiling |
|---|---|---|---|---|
| Outlines, creases, seams | Fade 286 m to 520 m view depth (PixelPipeline.ts:846, config.ts:34) | Gone above row 31 % of the frame | Gone above row 71 % | **None on the city.** The nearest ground is 624 m deep. Only the bus is outlined, plus towers over ~110 m at the very bottom edge |
| LOD 0 geometry (bays, cornices, gables, stoops) | `detailD` < 650 m | Regions near the bus | Regions within ~500 m of the stream centre | **Never** |
| House windows | Ribbon past 0.6 m/px, flat wall past 1.15 m/px (config.ts:508-509) | 555 m / 1,063 m slant | 450 m / 863 m | 342 m / 656 m (+/-12 % per building). The nearest visible ground is 779 m away: over low ground **no house has a window** |
| Tower floor and column lines | Off at 3 m/px | 2,773 m | 2,252 m | 1,712 m |
| Cast shadows | Window 520 m to 1,604 m square, seen from the sun | Ends ~400-700 m ahead [E] | Between | Ends ~2-3 km out [E] |
| Trees full, and casting | d < 350 m (main.ts:978-979) | 350 m | ~295 m | **Never.** No tree casts at the ceiling |
| Trees simple | d < 900 x (1 + 0.8 vista) | 900 m | ~1,160 m | ~1,525 m ground distance |
| Trees past that | Hidden | Parks turn into flat ground | | |
| Aerial perspective | Fog off: nothing until ~12.5 km (materials.ts:167) | Same | Same | Same |

### 3.4 Old SF data against feat/osm

| | Main (old SF) | feat/osm |
|---|---|---|
| Buildings / records | 140,961 / 143,463 | 169,503 / 172,180 [M] |
| Vertices per footprint ring | 5.74 | 9.89 [M] |
| LOD 1 triangles, whole city | 2.19M | 4.77M [M] |
| LOD 1 vertex memory, whole city | ~210 MB | ~434 MB [E: 5 vertices per ring vertex, 51 bytes each] |
| Regions on the wire | 19.2 MB | 25.5 MB [M] |
| ...buildings section | 4.78 MB, 34 B per building | 8.54 MB, 50 B per building [M] |
| ...heights / classes / obstacles / trees | 7.97 / 1.31 / 2.27 / 0.98 MB | 7.98 / 2.75 / 2.29 / 0.77 MB [M] |
| Boxed far buildings | 2,245 (1.59 %), 9.9 % of area, 37.1 % of volume | 1,848 (1.09 %), 9.3 %, 33.8 % [M] |
| Ground classes | 4, from distance to buildings | 11 mapped to 6 ramps, from OSM [S] |
| Roads | None in the data | OSM centrelines, width by class [S] |
| Trees | 154,759 | 120,545 [M] |
| Far terrain, horizon, water, far-box shader | Same code | Same code [M] |

Terrain heights are the largest item on the wire: 41 % of the region bytes [M]. A region seen from 3 km away cannot show a 4 m grid, and it downloads one anyway.

### 3.5 What every other city gets

| Layer | SF | London, Amsterdam test bakes | Source |
|---|---|---|---|
| Land outside the frame | Horizon ring | **None. The 60 km water plane shows.** | City.ts:250, 257-260; no `horizon.bin` in those folders [M] |
| Far DEM source | One hard-coded USGS tile, n38w123 | n/a | horizon.py:24 [S] |
| Terrain | USGS 1 m | Flat at 1 m | city configs [S] |
| Heights | LiDAR 97.3 % | London: floors 71.4 %, neighbours 18.8 %, defaults 6.1 %, mapped height 3.8 %. Amsterdam: mapped 87.9 %, neighbours 10.4 % | city.json stats [S] |
| Far boxes | 1.09-1.59 % of buildings | London 5.71 %, Amsterdam 4.65 % [M]. A fixed 20 m test catches a different share in every city | far.bin |
| Roof shape | 287 of 169,503 buildings tagged [M] | Amsterdam mostly its config's `roofDefaults`: gabled | amsterdam.json [S] |
| Hand tables | Icons, hero props, `HIDDEN`, gated by origin | Off. `district()` is not gated (towerStyles.ts:328), so SF's district rectangles apply to any city's coordinates near its origin [M] | towerStyles.ts |
| Facade colour in OSM | 0.11 % of parts | London 2.88 %, Amsterdam 0.05 % [M] | SBB3 tiles |

---

## 4. What is real, derived, procedural or hand-authored

### 4.1 By thing

| Thing | Main (old SF) | feat/osm SF | What decides it |
|---|---|---|---|
| Hills | REAL | REAL | USGS 3DEP 1 m, 1/3 arc-second fallback. Stored 4 m, meshed 8/16/64/256 m |
| Normals on the ground | DERIVED, smoothed | Same | 16-32 m baseline on purpose (terrainMaterial.ts:138-142) |
| Coastline | DERIVED | REAL | DEM < 0.3 m or no-data; OSM land polygons plus DEM on feat/osm |
| Water surface | PROCEDURAL | PROCEDURAL | Plane, fresnel by view angle, hashed dashes |
| Roads | DERIVED, and often wrong | REAL lines, DERIVED width | Main has no road data: a street is what lies 3.6-17 m from a footprint (bake.py:1604-1614) |
| Sidewalks | DERIVED | DERIVED, some REAL | 3.6 m band by buildings; 3.5 m beside classed roads plus mapped ways |
| Parks, lawns | DERIVED, wrong | REAL | Main: farther than 17 m from any building |
| Footprints | REAL, rows split into ~25 ft lots by rule | REAL | USA Structures + LiDAR outlines; OSM 165,992, Overture 1,681, USA 1,815, LiDAR 15 [M] |
| Tower massing | REAL | REAL | LiDAR tiers and tapers; OSM parts where they pass |
| Heights | REAL | REAL, 97.3 % LiDAR [M] | See 3.5 for elsewhere |
| Roof shape | PROCEDURAL | PROCEDURAL for 99.8 % [M] | Flat at LOD 1; gable by hash on 38 % of small Victorians at LOD 0 (BuildingMesher.ts:569) |
| Roof tone | PROCEDURAL | PROCEDURAL | Three kinds by seed, 9 x 7 m hash patches (buildingMaterial.ts:574-602) |
| Rooftop clutter, chimneys, tanks | PROCEDURAL | PROCEDURAL | Seeded RNG |
| Building type | DERIVED | DERIVED | Occupancy, height, area; district boxes hand-drawn for SF |
| Windows, trims, bays, stoops | PROCEDURAL | PROCEDURAL | Shader grid by type |
| Tower facade family | PROCEDURAL + HAND-AUTHORED | Not on feat/osm yet | Hash by district weights; 15 SF icons by table |
| Wall and roof colour | PROCEDURAL | PROCEDURAL | Ramp by rule, tone by seed. OSM colour on 0.11 % of parts, and it only shifts the grey value (bake.py `seed_for`) |
| Trees: where | PROCEDURAL, 100 % | REAL 9.1 %, DERIVED 69.3 %, PROCEDURAL 21.6 % [M] | Main: 11 m jitter in "grass", 30 % of houses. feat/osm: 10,917 mapped; 83,538 at WorldCover density; 26,090 along frontages |
| Trees: shape | PROCEDURAL | PROCEDURAL | Four templates from one shader |
| Ground colour | DERIVED | DERIVED | Class to ramp table |
| Street furniture | None exists | None exists | No poles, cars or signs as world geometry |
| Landmarks, bridges | HAND-AUTHORED | HAND-AUTHORED | Real coordinates, built by hand, SF only |
| Far boxes | DERIVED | DERIVED | Real position and height, rule shape, 20 m filter |
| Horizon land | REAL relief, rule colour | Same | 40 m rule stands in for land cover |
| Sky | PROCEDURAL | PROCEDURAL | One function of view direction |

### 4.2 By pixel in the listed shots

Method: every game pixel classified to its palette ramp [M], then split by the simulation in 3.2 [E, +/- 3 points]. The match is 100 % exact on downtown-ceiling, downtown-250m, sutro-far and blast7. alamo-ceiling predates the water retune (10 % of pixels below the meter are off-palette, all water). The other sheet frames carry HUD pixels. Each pixel is credited to what shaped it. Colour is a separate question: **0 % of pixels in any shot show a measured colour.**

| Shot | Real massing | Derived | Procedural | Hand-authored |
|---|---|---|---|---|
| downtown-ceiling | 52 | 13 (ground 10, far land + horizon 3) | 34 (sky 24, water 8, trees 2) | 1 |
| downtown-250m | 62 | 18 (ground 11, far boxes 4, far land + horizon 3) | 19 (sky 14, water 3, trees 2) | 1 |
| alamo-ceiling | 48 | 18 (ground 13, far 1, horizon 4) | 34 (sky 24, water 8, trees 2) | under 1 |
| sutro-far-L3 | 32 | 60 (ground; ~4 of it far terrain poking through) | 5 (trees) | 3 (tower, bus) |
| sheets-E slide | 50 | 8 | 41 (sky 14, water 19, trees 4, HUD 4) | 1 |
| sheets-E rest, toggle | 72 | 5 | 19 (sky 12, water 3, trees 1, HUD 3) | 4 |
| sheets-E blast7 | 25 | 20 | 54 (sky 12, water 32, trees 7, HUD 3) | under 1 |

blast7's paint is 42 % of the frame [M], split above into the buildings, ground and trees under it [E].

Inside "real massing", the procedural part is surface. On the near towers of sheets-E rest, glass and window ramps alone are 25 % of the frame [M]. At the ceiling that layer is nearly gone: section 3.3.

**Palette facts [M]:** a frame uses 77-109 of the 192 defined colours. Top four colours by share of a 53-row band:

| Shot, rows | Band | Top 4 colours cover |
|---|---|---|
| downtown-ceiling 424-477 | Coarse mid-field | 60 % |
| downtown-ceiling 530-583 | Coarse mid-field | 49 % |
| alamo-ceiling 742-795 | Coarse near bottom | 78 % |
| alamo-ceiling 424-477 | Coarse mid-field | 60 % |
| downtown-250m 159-212 | Far boxes | 72 % (3 of them GREY tones of the boxes, 52 %) |
| alamo-ceiling 265-318 | Bay | 80 % is one colour |

### 4.3 What this says about the producer's question

The question mixes three things, and they have different answers.

- **Geometry from altitude is mostly real data.** Half to two thirds of a frame is real massing. Procedural geometry is ~2 %.
- **Colour and surface are entirely rule-made.** That layer fades with distance by design, and nothing data-driven takes over. This is the true sense in which distance looks unbeautiful.
- **The far field is not procedural, it is empty.** Bare land is not a generated blob. It is a 64 m grid with one ramp and no buildings on it.

Outside SF the first point weakens, because the massing leans on floor counts, neighbours and defaults (3.5).

---

## 5. Ground size of one game pixel

Frame 393 x 852, flat ground, centre column. Across = view depth / f. Along = depth^2 / (f x camera height). Heights and pitch are the logged poses of 3.2. All [M, computed]. The ratio along/across is depth / camera height, which is why grid cells turn into streaks.

| Ground distance | Street: across x along (m) | 10 m wall (px) | 250 m: across x along | 10 m wall | Ceiling: across x along | 10 m wall | Ceiling row from top |
|---|---|---|---|---|---|---|---|
| 500 m | 0.54 x 3.2 | 18.6 | 0.77 x 1.4 | 11.3 | 1.25 x 1.3 | 5.6 | 90.4 % |
| 1 km | 1.05 x 12.3 | 9.8 | 1.39 x 4.7 | 6.9 | 2.06 x 3.6 | 4.1 | 63.8 % |
| 2 km | 2.08 x 47.8 | 5.0 | 2.62 x 16.8 | 3.9 | 3.69 x 11.7 | 2.6 | 45.8 % |
| 3 km | 3.10 x 107 | 3.4 | 3.86 x 36.3 | 2.7 | 5.31 x 24.2 | 1.9 | 38.8 % |
| 5 km | 5.14 x 294 | 2.1 | 6.33 x 97.5 | 1.7 | 8.56 x 62.8 | 1.2 | 32.8 % |
| 10 km | 10.3 x 1,169 | 1.0 | 12.5 x 381 | 0.9 | 16.7 x 239 | 0.6 | 28.0 % |
| 20 km | 20.5 x 4,664 | 0.5 | 24.9 x 1,504 | 0.4 | 32.9 x 930 | 0.3 | 25.5 % |
| 40 km | 41.0 x 18,628 | 0.3 | 49.6 x 5,979 | 0.2 | 65.4 x 3,670 | 0.2 | 24.2 % |

Horizon rows: street 12.7 %, 250 m 14.4 %, ceiling 22.9 %. Bottom of the frame on the ground: 87 m, 245 m, 404 m. 40 km is past the 30 km far plane today. The game is flat: real curvature would drop the ground 7.8 m at 10 km, 31 m at 20 km, 126 m at 40 km.

At the ceiling, everything past 5 km shares 84 rows (10 % of the frame), past 10 km 43 rows, past 20 km 22 rows [M].

**What each distance can use at the ceiling, the hardest case [M from the table, reading of it E]**

| Distance | Smallest thing that reads (2 px across) | One pixel of height | Used today | Reading |
|---|---|---|---|---|
| 0.5-1 km | 2.5-4 m | ~1-2 m | Footprints, 16 m ground, 2 m classes | About right |
| 2 km | 7 m | ~4 m | Same | A 7.6 m lot is 2 px wide. Facade detail is already unusable |
| 3 km | 11 m | ~5 m | Same, until the streaming edge | Houses are 1-2 px; roofs and row shapes are what reads |
| 5 km | 17 m | ~8 m | **Nothing but 64 m ground** (7.5 px across a cell) | A 10-20 m height and tone grid could fill every pixel. Individual houses cannot be seen |
| 10 km | 33 m | ~16 m | 64 m ground; horizon 256 m (15 px across, under 1 px along) | Block-scale data is the limit. Horizon cells read as streaks |
| 20 km | 66 m | ~31 m | 256 m horizon (8 px across) | Silhouette and district-scale tone only |

Coarse ground at 2 m class texels is point-sampled with no mips: at 3 km one pixel covers 5 x 24 m, so it samples about one texel in 30 [M]. Street edges there are sampling noise.

---

## 6. Screenshot by screenshot

Rows are game rows, 0-851. The tags are the causes the brief asked for.

### downtown-ceiling.png (bus over Civic Center, heading 45)

| What looks dull | Band and code | Why |
|---|---|---|
| East Bay: pale strip, 1-2 px streaks, rows ~205-225 | Horizon. `City.buildHorizon`, then the far fade | **Missing buildings**: no data outside the frame. **Too little height data**: 256 m cells are 15 px wide and under 1 px tall at 10 km. **Too few colours**: 2 ramps by a 40 m rule |
| Treasure Island, Yerba Buena: pale slabs with a scalloped fringe, rows ~235-265 | Far terrain inside the frame. `City.buildFar` | **Missing buildings**: all under 20 m. **Too few colours**: GREY_LIGHT only. Fringe: the ramp index is interpolated (section 7, item 2) |
| White specks over the bay, rows ~225-300 | Water. terrainMaterial.ts:198-202 | **No surface pattern that survives distance**: a 2.6 x 9 m dash hash is point-sampled at ~9-17 x 60-240 m per pixel, so up to 4.5 % of pixels flip at random [M from the hash thresholds] |
| Flat bay stripes | Water. Fresnel from view angle alone | **Too few colours**: a whole bay in 3-4 flat steps, 2 of them 61 % of band 212-265 [M] |
| Grey rubble, rows ~330-640 | Coarse. Same `buildingMaterial` with everything gated off | **Too few colours**: roofs land on 2 tones, walls on 2-3; a house's tone offset is +/-0.42 of a step, so neighbours merge. **No surface pattern**: no windows, no outlines. No cast shadows past ~2-3 km. Streets narrower than the building height are hidden, so the grid does not read |
| Camouflage rectangles on roofs, rows ~700-850 | Coarse. buildingMaterial.ts:601-602 | **Procedural**: a 9 x 7 m hash patch rounds to a step edge with no dither at the ceiling |
| Pale green under Civic Center trees and along wide streets | Coarse ground, main's class rule | **Wrong data**: traced to the ground, 83.8 % of the sunlit green pixels are "grass" on main. On OSM the same cells are 46 % road, 16 % sidewalk, 15 % plaza, 7 % path, 14 % grass [M] |
| Identical lumpy trees, no shadows | Trees LOD 1 | **Procedural**, one 8-face canopy each, never cast at the ceiling |
| Top 23 % of the frame | Sky | 2 colours per 53-row band [M]. Five flat stripes carry no information |

The downtown strip looks complete only because of what sits there: tall boxes and water.

### downtown-250m.png

| What looks dull | Band and code | Why |
|---|---|---|
| Financial District as flat grey blocks, rows ~100-250 | Far boxes. City.ts:368-406 | **No surface pattern, too few colours**: 3 GREY tones are 52 % of band 159-212 [M]. No roof ramp, no facade, no shadow. **LOD popping**: climb to the ceiling and these become glass and stone towers (compare downtown-ceiling.png). FiDi is ~2.7 km from the stream centre, past the 1,626 m `loadR` [M] |
| Hard change from dark glass towers to grey boxes, rows ~180-250 | Coarse to far, by region | **LOD popping**: material and shape change at a 1 km grid line |
| Pale island and the bay | As above | As above |
| Green strip with a line of trees across the foreground | Detail ground, main's class rule | **Wrong data** likely: wide corridor with no building within 17 m gets lawn and trees. City-wide: 30.6 % of what OSM calls road or paved lot is lawn on main, and 17.6 % of main's lawn is road or paved lot (9.9 km2) [M] |
| Long flat roofs with pale patches | Detail | **Procedural** tone patches; the real roofs have no data |
| White dashes along tower bases | Detail, tower base (buildingMaterial.ts:356-362) | **Procedural** storefront piers and a dark band. No size gate; at distance it reads as a dotted line |

### alamo-ceiling.png (bus near Hayes Valley, heading 88; pose estimated)

| What looks dull | Band and code | Why |
|---|---|---|
| East Bay as jagged pale shapes with dark inlets, rows ~220-250 | Horizon | As above. The stair-steps are 256 m cells |
| Near-black flat bay | Water, looking away from the sun | **Too few colours**: one tone is 80 % of band 265-318 [M]. Plain and dark, with faint specks. This shot predates the water retune, so main's water is a little lighter |
| Green bands across SoMa | Coarse ground, main's class rule | **Wrong data**: no building within 17 m, so freeway and rail land is lawn. The class map shows the rule (`class-sutro.png`, `class-west.png`) |
| Black dashes at the base of big blocks | Coarse, tower base band | **Procedural** band with no LOD, 1-2 px and the darkest thing in the mid-field |
| A few grey blocks at the waterfront on bare ground | Far band past x = 3,072 m [E] | **Missing buildings**, region edge. Only ~12 % of the wedge here, so it reads as a sparse shore |
| Patchwork roofs filling the bottom third | Coarse | **Too few colours**: 4 colours are 78 % of band 742-795. No outline at any depth here |

This shot's meter reads 59 fps, 161 draws, 1.17M triangles on the UHD 620 [M].

### sutro-far-L3.png (near Twin Peaks)

| What looks dull | Band and code | Why |
|---|---|---|
| Pale slabs on the hillside, one with a green hole | Far terrain poking through detail ground. `buildFar` has no tile mask | **LOD overlap bug.** Far-above-near is measured on 6.7 % of SF's land (9.56 km2), up to 3.9 m at p99 and 9 m at p99.9 [M]. The link to these exact patches is [E]: the ramp and shapes match, one patch lands in the projected mask, and the pose is not known exactly |
| Grey collar around every row of houses, green beyond, soft blobby edges | Detail ground, main's class rule | **Wrong data**: the edge is the 17 m distance contour from footprints, not a road or a lawn. Roads with no houses beside them do not exist. This is the most literal "blob" in the game, and feat/osm removes it (`class-sutro.png`) |
| Big olive shapes with streaky edges | Terrain light | **Too few colours, smoothed height**: normals over 16 m, slope contrast halved, so a hill is 2-3 steps with dithered contours |
| Bare Mount Sutro, lollipop trees in rows | Trees | **Wrong data, procedural**: main plants only on "grass" with slope < 0.2, so steep woods are bare. On feat/osm WorldCover gates trees |
| Rainbow tower | Hand-built | Fine, stays painted at any distance |

### sheets-E-end.png (four frames: slide, rest, toggle, blast7)

| What looks dull | Band and code | Why |
|---|---|---|
| Near towers in rest and toggle look good | Detail with facade families | This shows the near band works: real massing, rich surface |
| Island in slide, pale stripes and hard stairs | Far terrain | As above |
| East Bay in blast7: flat green band, nothing on it | Horizon, y > 40 m rule | **Missing buildings, too few colours**: the hills are one flat ramp with no city on them |
| Cream dashes at the shore in blast7 | Horizon | **Stray ramp**: the interpolated index passes through SKY_WARM between GREEN_GREY and GREY_LIGHT [M from code; visible in `crops/sheet-hills.png`] |
| Streaky pale flats under the hills | Horizon, y <= 40 m | **Missing buildings**, 256 m cells, GREY_LIGHT |
| Bay speckle | Water | As above |
| blast7's paint | Detail, paint | The opposite of the problem: 42 % of the frame [M]. Colour is what makes this frame work |

---

## 7. Defects found on the way, separate from any strategy

1. **Far terrain pokes through near ground.** It is sunk only 2.2 m and has no tile mask. Measured on 6.7 % of the land on main, 6.6 % on feat/osm [M]. The mask the boxes use exists already.
2. **Ramp index is interpolated.** `in float ramp` is smooth-interpolated and rounded (materials.ts:326). Across a shore triangle it runs 1 to 7, so far terrain's edges pass through FOG, SKY_WARM, GREEN_GREY, WINDOW and INK. The horizon's 40 m contour passes through FOG and SKY_WARM.
3. **`far.bin` classes are thrown away.** City.ts:333 tests water only. Grass, forest and road at 32 m are on the wire, and all land draws GREY_LIGHT [M].
4. **`far.bin` paint indices are thrown away** (finding 8).
5. **`horizon.bin` is stored at 128 m and drawn at 256 m** (City.ts:270) [S].
6. **Ground and water patterns alias.** The class texture has no mips, and the water dash hash is point-sampled.
7. **The mesh sizes in comments and docs are wrong by a factor of 2** (section 2).
8. **Tower base band has no LOD.**
9. **`district()` runs in every city.**
10. **A coarse region costs the same download as a detailed one.** Buildings are 25 % of the bytes on main [M]. There is no cheap band on the wire.
11. **The whole far ground draws every frame**, 123,648 triangles uncut, including what lies under loaded tiles and behind the camera [M].

---

## 8. Method and limits

- **Branch.** At 18:21 today, while this audit ran, another session moved the `sbw-main` working tree to `merge/perf` with an unfinished merge (City.ts, BuildingMesher.ts, PixelPipeline.ts and regionLoader.ts unmerged). All file:line citations here were re-checked with `git show feat/hybrid:<path>` and match; read them on that branch, not in the working tree. Nothing was edited in either repo.
- **Simulation.** `audit/bands_fine.py` and `audit/bands_sim.py` ray-march baked data with the load and detail rules of City.update and the stream centre of main.ts. They do not reproduce hysteresis: regions stay loaded up to 2300-2800 m after flying past, which adds area behind the camera and changes nothing ahead. Tree crowns, props and the shadow window are not in them. The wedge counts ignore occlusion.
- **Poses.** Street, 250 m and downtown ceiling come from the run's log. The Alamo pose is estimated from where City Hall sits in the frame, and the Sutro pose from `tools/landmarks.mjs` with a small search, so its share row uses palette data instead.
- **The worst view has no fog-off screenshot.** `shots/altitude/west-ceiling.png` predates fog-off and shows the marine layer, so it was not used. The Sunset and Presidio rows are simulation only. A real capture would need `tools/altitude.mjs west` on a free GPU.
- **Listed shots are old SF data**, from merge-look, merge-facade, merge-landmarks and judge-hybrid. Feat/osm was not rendered; its numbers are data and mesher measurements.
- **Mesher numbers** come from five sampled regions per dataset, not all of them. Whole-city LOD 1 triangles are from the data (3n - 2 per ring), which agrees with the mesher to within 1 % on every sampled region [M].
- **Trace of green pixels** assumes flat ground at the logged height, so it is only quoted for the exact-pose ceiling shot.

Scripts and their outputs are in `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/audit/`: `bands_fine_main.json`, `bands_fine_osm.json`, `bands_sim.json`, `footprint.json`, `shots_palette.json`, `mesh/mesh.json`, `regions_main.json`, `regions_osm.json`.
