# What breaks beyond San Francisco

Audit for the far-field question. Date 2026-10-30. Nothing in any repo was changed. No browser, bake or build was run.

**How the numbers are labelled.**
- (measured): read from this repo's files, the baked data, the cached Overture footers, a small ranged read or a HEAD request, or calculated directly from those. Constants quoted with a file and line count as measured.
- (source): an external fact, with its link.
- (estimate): my arithmetic, with the assumption next to it.

Claims about what a bake or the client *would do* in Lagos, at McMurdo or on the Moon come from reading the code. None of those runs happened.

**Paths.** `main:` is `C:/Users/Utku/sbw-main` (feat/hybrid; world and render code same as main). `osm:` is `C:/Users/Utku/Struggle-Bus-World` (feat/osm). The scripts behind the measurements are in `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/audit-limits-scripts/`.

---

## Bottom line

1. **The top defect gets worse outside San Francisco.** Past the 1.5-1.9 km streaming radius the only buildings are far.bin's boxes, gated at 20 m. That gate keeps 1.59 % of buildings on main and 1.09 % on feat/osm. By tags alone it would keep 0.08 % of Ikeja in Lagos and none of Gulu (all measured). A far layer gated on height is close to empty wherever heights are missing, as they are in most places sampled here.
2. **The two test cities cannot show the defect.** London's frame is 3.3 x 2 km and Amsterdam's 2 x 2 km, so nearly all of each fits inside the streaming radius. Both are flat, tag-rich and Western European. They prove the pipeline runs without USGS data. They say nothing about far fields, terrain, scale or data-poor places.
3. **The producer's worry about invented content is wrong for SF and right for much of the world.** SF's heights are 97.3 % LiDAR (measured). In Lagos, Dhaka and Gulu 96-100 % of buildings have no height tag, so the bake invents one: 6 m when the class is unknown, at most 14 m on a small plot. Footprints are fine in all three. Heights, ground and terrain are what is missing.
4. **Several failures are plain bugs.** They are listed in the sections below:
   - Ground heights clamp at ±3,200 m.
   - The bake crashes on any tree above 3,276.7 m.
   - The climb ceiling is 520 m above sea level, so the yoke cannot climb in Denver.
   - The sea plane sits at y = -0.6 in every city.
   - Far lakes drop to y = -6 at any altitude.
   - Every bridge is missing except SF's two hand-built ones.
5. **An Antarctic bake would run and be wrong without saying so.** WorldCover has no tiles south of 60°S (measured by listing the bucket), and the code reads a missing tile as open sea. Glaciers become ROCK, Overture's `snow` cover is dropped, the default ground is a green yard, and 30 % of frontage buildings get street trees at 77°S. Then the QA fails on water.
6. **The Moon has no pipeline.** PROJ refuses the transform, and half the surface sits below the water plane. There is no haze to hide distance. The data is good, though: a 118 m DEM, a 100 m image mosaic and 1.3 M catalogued craters.
7. **WORLD-TRAVEL's planet layer is still height plus a few classes, and it would blob.** At 2-10 km up, one 60-76 m texel covers 8-14 game pixels at 3 km slant range. Its L4 layer reuses the 20 m gate and adds "density-extruded blocks", which are blobs by construction. UTM and Web Mercator both fail near the South Pole, and WorldCover stops at 60°S. §6 lists the changes. Most of its §1 (float64 truth, floating origin, curvature chunk) holds.

---

## 1. How rich the data really is

Overture 2026-10-21.0, read through the cached footers with column-projected row groups. Everything in this table is measured, except the Tokyo row, which is WORLD-TRAVEL's own measurement (`main:docs/specs/WORLD-TRAVEL.md:598-599`).

| Place | Box | Buildings in sample | `height` tag | height or floors | At least 20 m by tags (the far.bin gate) | Footprint sources | Roads with a surface tag |
|---|---|---|---|---|---|---|---|
| San Francisco (feat/osm bake) | whole city | 169,503 | 1.7 % (97.3 % LiDAR) | 1.7 % | 1.09 % of buildings in far.bin | OSM 97.9 % | not read |
| London test bake | 3.3 x 2 km | 7,666 | 3.8 % | 75.2 % | 5.71 % in far.bin | OSM 99.6 % | not read |
| Amsterdam test bake | 2 x 2 km | 11,838 | 87.9 % | 88.8 % | 4.65 % in far.bin | OSM 99.9 % | not read |
| Denver downtown | 3.4 x 3.3 km | 11,716 | 77.2 % | 84.3 % | 2.49 % | OSM 98.8 % | 28 % |
| Tokyo (two row groups) | central wards | 69,246 | 1.7-9.0 % | 12.3-16.4 % | not measured | OSM about 98 % | not read |
| Dhaka, Dhanmondi | 4.1 x 3.3 km | 26,596 | 0.1 % | 3.7 % | 1.44 % | OSM 92.9 %, Google 6.3 %, Microsoft 0.8 % | 38 % |
| Lagos, Ikeja | 7.7 x 6.7 km | 19,662 or more | 0.2 % | 0.7 % | 0.08 % | Google 58.8 %, OSM 37.4 %, Microsoft 3.8 % | 14 % |
| Gulu, Uganda | 5.6 x 5.6 km | 50,331 or more | 0 % | 0.01 % | 0 % | OSM 86.0 %, Google 11.1 %, Microsoft 2.9 % | 26 % |
| Longyearbyen | 2.3 x 4.5 km | 698 | 0 % | 3.0 % | not measured | OSM 87.2 %, Microsoft 12.8 % | 50 % |
| McMurdo Station | 2.8 x 6.7 km | 296 | 0 % | 21.6 % | not measured | OSM 100 % | 97 %; 89 % of segments are unpaved or gravel |

Notes:
- Lagos and Gulu read 4 of 7 and 4 of 9 row groups, so their building counts are floors.
- The "20 m by tags" column uses the bake's own rule (`height`, else `floors * 3.2 + 1`). Neighbour fill can add a few big footprints.
- Overture's buildings total 2,533,842,612 and span 84.29°S to 83.09°N (measured from footers).
- 1,405 buildings lie south of 60°S (measured by reading all 21 row groups that reach there).
- The South Pole itself has no Overture building row group within 0.1° (measured).

**Correction to the starting facts.** "2,641 entries against 140,961 buildings, 1.9 %" counts boxes. Tall towers have several. The real share on main is 2,245 buildings, 1.59 %. On feat/osm it is 2,271 boxes for 1,848 of 169,503 buildings, 1.09 % (all measured). Merging feat/osm makes the far layer thinner.

**The building count is not the problem in poor data.** Gulu has at least 1,600 buildings per km² in the sample, against about 1,200 per km² of SF's land (measured; SF's land from far.bin's 44.3 % water share). Overture credits Google and Microsoft footprints with "lower footprint precision", most pronounced in the Global South ([source](https://docs.overturemaps.org/guides/buildings/)).

---

## 2. Status by place

"ok" works as is. "hand work" works once someone writes config. "weak" runs but looks wrong. "breaks" fails or is badly wrong. All of this is by reading the code.

| Topic | (a) Another US city | (b) Lagos, Dhaka, rural town | (c) Antarctica | (d) Moon |
|---|---|---|---|---|
| Far field (top defect) | same as SF | worse | worse | different problem |
| Terrain sources | hand work | flat or a surface model | needs new code | no path |
| Building heights | ok with LiDAR or tags | invented | invented, few buildings | no buildings |
| City frame (tmerc) | ok | ok | ok at McMurdo, breaks at the pole | breaks |
| UTM plan | ok | ok | breaks south of 80°S | undefined |
| Curvature, far plane, radius | ok | ok | ok | breaks |
| Height range | breaks above 3.2 km | breaks above 3.2 km | breaks on the plateau | breaks |
| Sun | fixed, plausible | fixed, plausible | breaks | breaks |
| Fog and sky | off; SF-shaped if on | same | ok | breaks |
| Palette | ok | weak | missing ramps | missing ramps |
| Ground classes | weak | weak | breaks | breaks |
| Trees | weak | weak | breaks | not applicable |
| Water | breaks on lakes and plateaus | weak | weak | breaks |
| Region grid, bake shape | hand work | breaks at metro size | breaks at the pole | breaks |
| Paint on empty ground | capped | capped | weak | breaks |
| Gravity, flight floor | breaks above about 500 m | same | breaks | breaks |

**What already travels** (measured or by reading):
- Overture footprints.
- WorldCover tree evidence down to 60°S.
- City-local tmerc: `geo.ts` agrees with PROJ to 1e-5 m at McMurdo, 47 km from the origin.
- Stable ids from source ids.
- `City.lowGround()`.
- The `isSfOrigin` gate on SF props.
- u8 ground classes, which have room to grow.
- Ten spare palette rows (38-47).
- A flight model with no gravity in it, so the Moon needs no physics rewrite.

---

## 3. The far field outside SF

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `main:src/world/City.ts:132-138` | Regions load within 1.5-1.9 km | every city | Same radius everywhere. Everything past it is the far layer. |
| `osm:tools/bake/bake.py:77,2550` | Far buildings are those at least 20 m tall | a, b, c | Ikeja 0.08 %, Gulu 0 %, Denver 2.49 %, SF 1.09 % (measured). A low-rise city has no far buildings at all. |
| `main:src/world/City.ts:343` | Far ground is WATER or GREY_LIGHT | all | far.bin stores all 11 classes (measured in SF), and the mesh keeps one bit of them. Parks, woods, sand and street pattern go. The real data exists and is discarded. |
| `main:src/config.ts:71,78` | Fog hides the streaming edge (the comment at line 77 says so) | all | Fog has been off since 78a2c74. `main:HANDOFF.md:160` already names this. |
| `main:src/world/City.ts:250` | A 60 km sea plane lies under every city | a, b, c, d | The frame ends and the plane carries on. `osm:shots/local/osm-client/hygiene/amsalt.png` shows Amsterdam ending at a straight line with navy water to a ruler-flat horizon, where the real city carries on. |
| `osm:tools/bake/horizon.py:24` | Surroundings come from one SF DEM tile | a, b, c, d | Only SF has a horizon.bin. London and Amsterdam have none (measured). |

---

## 4. Assumptions by topic

### 4.1 USGS-only sources

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `osm:tools/bake/horizon.py:24,39` | One hard-coded tile, `n38w123`, opened as one file | a, b, c, d | Lagos's would-be tile `n07e003` returns 404 (measured). Denver's `n40w105` exists, but downtown is about 1 km from its west edge, so the Rockies sit in the next tile (estimate from coordinates). |
| `osm:tools/bake/horizon.py:44` | NaN means water | a, and SF itself | SF's 32 km window reaches about 38.06°N, past the tile's 38.0°N edge, so that strip reads as sea (estimate from coordinates). |
| `osm:tools/bake/fetch_inputs.py:18-23` | `SOURCES` holds only `sf` | a, b, c, d | No other city's DEM is fetched. |
| `osm:tools/bake/bake.py:1566-1573` | `dem_fallback` is one file | a | A city across a 1° line can't use it. The `dem` list can (line 1574). |
| `osm:tools/bake/bake.py:1583-1584` | No DEM means flat at `groundLevel` | b, c | London and Amsterdam are flat for this reason. There is no global DEM path. |
| `osm:tools/bake/bake.py:2608` | Any DEM is credited as "USGS 3DEP DEM (public domain)" | b, c, d | Wrong attribution the moment Copernicus or REMA is used. |
| `osm:tools/bake/lidar.py:14,103` | EPT in EPSG:3857, NAVD88 | outside the US | LiDAR massing is USGS-shaped. It needs a per-city dataset URL (`osm:tools/bake/cities/sf.json:432-433`). |

Global replacements, checked:
- **Copernicus GLO-30 on S3** has tiles at McMurdo and at S90 E000 (HEAD 200, measured). It has a hole: `N40 E044` (Yerevan) is 404 on the 30 m bucket and 200 on the 90 m one (measured). OpenTopography says the restricted countries were released in 2023_1 ([source](https://opentopography.org/node/3557)), so the S3 mirror WORLD-TRAVEL names lags.
- **It is a surface model**, with roofs and trees in it ([source](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)). `osm:DECISIONS.md:609-611` rejected it for this reason. No bare-earth path exists yet.
- **FABDEM** is CC BY-NC-SA, non-commercial ([source](https://gee-community-catalog.org/projects/fabdem/)).
- **GEDTM30** is CC BY 4.0 but marked "for testing purposes only". Its record says 1 arc-second in one place and 120 m in another, and its box stops at 65°S ([source](https://zenodo.org/records/15490367)). Check it before relying on it.
- **Antarctica:** REMA mosaics at 2 m, CC BY 4.0, on AWS ([source](https://registry.opendata.aws/pgc-rema/)). PGC's 32 m and 100 m directories answer 200 (measured).
- **Moon:** LOLA 118 m DEM 8.49 GB and LROC WAC 100 m mosaic 5.96 GB on USGS (HEAD 200 with lengths, measured).

### 4.2 Height fallbacks

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `osm:tools/bake/bake.py:1704-1711` | OSM height, else floors, else a USA Structures row | b, c | No tags and no USA data. |
| `osm:tools/bake/bake.py:1716-1723` | Neighbours' median within 40 m, else a class default, 6.0 m when the class is unknown | b, c | In Ikeja 94 % of footprints have no class (measured), so most get 6 m or a neighbour's guess. |
| `osm:tools/bake/bake.py:1724-1725` | Under 400 m² means at most 14 m | b | In Dhaka the 38 buildings with a `height` tag have a median of 24 m and a p90 of 63 m (measured). A six-storey block on a small plot is capped at 14 m. |
| `osm:tools/bake/bake.py:1959,2205` | The default architecture is `victorian` | a, b, c | Bays, false fronts and stoops (`main:src/world/BuildingMesher.ts:549,719,750`) on Ikeja, Gulu and McMurdo. |

The WORLD-TRAVEL ladder (`main:docs/specs/WORLD-TRAVEL.md:560-571`) has seven steps. The code has LiDAR, OSM height, floors, building parts, neighbours and a class default. Steps 5 and 7 are not built.

Two sources fit the gap, and only one is in the ladder:
- **Google Open Buildings 2.5D Temporal** (not in the ladder): a height raster, effective resolution about 4 m, yearly 2016-2023, for Africa, South and Southeast Asia, Latin America and the Caribbean. Capped at 100 m. Its 1.5 m error was evaluated only in North America, Europe and Japan. CC BY 4.0 or ODbL ([source](https://sites.research.google/gr/open-buildings/temporal/)).
- **GHS-BUILT-H** (the ladder's step 7): average height per 100 m cell, 2018 ([source](https://developers.google.com/earth-engine/datasets/catalog/JRC_GHSL_P2023A_GHS_BUILT_H)). I found no primary license text; the JRC data host timed out from here (measured).

### 4.3 The tmerc frame

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `osm:tools/bake/bake.py:1542-1543` | `+datum=WGS84`, transform from EPSG:4326 | d | PROJ raises "Source and target ellipsoid do not belong to the same celestial body (Moon vs Earth)" (measured). A lunar lon/lat to lunar tmerc transform works (measured). |
| `osm:tools/bake/bake.py:1550-1552` | The four bbox corners bound the frame | c, at the pole | A 2 km polar cap as a lon/lat box gives corners (0, 0) and (0, -2010): zero width (measured). |
| `osm:tools/bake/overture.py:123,163-164`, `osm:tools/bake/worldcover.py:63-69` | lon/lat box with west below east | c at the pole; b on the antimeridian | Nothing matches a box that wraps, so a city across 180° extracts almost nothing. |
| `main:src/game/geo.ts:25-28` | Small longitude difference, no wrap | c, antimeridian | Against PROJ: 1e-6 m in SF, 1e-5 m at McMurdo, 631 m at 1.1 km from the pole on the far meridian, 31 km at 56 km, 8e9 m across the antimeridian (measured). Every `?lat=&lon=` and QA hook goes through it. |

The frame itself is fine for every city on Earth outside roughly the last degree of latitude (estimate from the errors above). That matters for §6: UTM is not needed to get a good city frame.

### 4.4 The UTM plan

UTM stops at 84°N and 80°S, and UPS covers the caps. Norway and Svalbard have irregular zones ([source](https://en.wikipedia.org/wiki/Universal_Transverse_Mercator_coordinate_system)).

| Latitude | Zone width | Yaw at each zone crossing | Seconds per zone at G3 |
|---|---|---|---|
| 45° | 472 km | 4.2° | 15.7 |
| 60° | 334 km | 5.2° | 11.1 |
| 77.85° (McMurdo) | 141 km | 5.9° | 4.7 |
| 84° | 70 km | 6.0° | 2.3 |
| 89° | 12 km | 6.0° | 0.4 |

(Calculated, plain 6° zones.)

- **`main:docs/specs/WORLD-TRAVEL.md:31-33,138,543-550`:** content frames are UTM. South of 80°S there is no zone: about 1,110 km of ice sheet including the Pole (calculated). McMurdo at 77.85°S is inside it. The northern limit is harmless for land, since no Overture land or building feature runs past 83.73°N (measured). It matters only for flights over the Arctic Ocean.
- **`main:docs/specs/WORLD-TRAVEL.md:174-176`:** "about 4° at 45°" every 470 km is the mid-latitude case. Rebases are invisible by design, so high frequency is a cost and not a pop, but the scheme is singular at the pole.
- **Keys:** `{zone}{N|S}/{rx}_{rz}` (`main:docs/specs/WORLD-TRAVEL.md:544`), the 8 km Durable Object cell (line 835) and `(zone, ix, iz)` (`main:docs/specs/STAGES.md:298`) all inherit the gap.
- **Absolute UTM numbers cannot reach the client.** Northings reach 1e7 m, where f32 resolution is 1 m (calculated). `main:src/world/tiles.ts:119-123` stores absolute f32 rings, and `main:src/world/City.ts:943-945` hashes cells within ±131 km. The doc keeps the render frame local, so this is a load-time subtraction, but it must be done.
- **Moon:** no UTM. USGS has defined a lunar equivalent, 45 transverse Mercator strips of 8° plus two polar stereographic zones ([source](https://pubs.usgs.gov/publication/tm11E1)).

### 4.5 Curvature, far plane, planet radius

No radius exists in the client (grep for 6371 and 1737 finds nothing, measured). Earth is hard-wired through `main:src/game/geo.ts:6-10`, `osm:tools/bake/bake.py:1542`, `osm:tools/bake/horizon.py:32` and `osm:tools/bake/lidar.py:57`.

| | Earth | Moon (radius 1,737.4 km, [source](https://en.wikipedia.org/wiki/Moon)) |
|---|---|---|
| Horizon from 2 m / 150 m / 520 m / 2 km / 10 km | 5 / 44 / 81 / 160 / 357 km | 2.6 / 23 / 43 / 83 / 186 km |
| Drop at 10 / 20 / 30 km | 8 / 31 / 71 m | 29 / 115 / 259 m |

(Calculated.)

- **Earth, city scale:** flat is fine. The missing 31 m at 20 km is about one game pixel.
- **Moon:** from 150 m the true horizon (23 km) is inside the 30 km far plane (`main:src/render/PixelPipeline.ts:123`), so a flat frame shows ground that is below the real horizon.
- **The far fade is a haze.** `main:src/render/materials.ts:167` and `main:src/config.ts:72` fade everything into the sky by 20 km even with fog off. On the Moon that is a fade to black, a dark band before the horizon. It must become a clean curved horizon.
- **WORLD-TRAVEL's curve chunk survives.** `uCurve.z = 1 / (2 R_eff)` is a parameter. Its paraboloid error at the horizon from 50 km up is about 240 m on the Moon (estimate, r⁴/24R³), and a sphere test in the shader costs little more.

### 4.6 Sun

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `main:src/config.ts:54-62`, `main:src/main.ts:55-59` | One fixed sun, ambient 0.3, sky bounce 0.24 | c, d | No date, time or latitude. No sky on the Moon, so ambient should be near zero. |
| `main:docs/specs/WORLD-TRAVEL.md:377-379` | NOAA solar position | d | Earth only. |
| `main:docs/specs/WORLD-TRAVEL.md:409-410` | Real UTC sun, one truth for everyone | c | South Pole: no sun roughly May-August, peak near 23.5° ([source](https://en.wikipedia.org/wiki/South_Pole)). McMurdo: sun below the horizon about Apr 23 to Aug 20 (calculated, simple declination model). |
| `main:docs/specs/WORLD-TRAVEL.md:416-419` | Solar time follows longitude flown | c | Near a pole a short circle sweeps 24 hours of longitude, so the sun would spin. |
| `main:docs/specs/WORLD-TRAVEL.md:411-412` | Elevations above 35° are compressed | fine | Handles tropical noon in Lagos and Dhaka. |

The Moon's sun moves 0.51° per hour, and the terminator crawls at about 15 km/h at the equator (calculated from the 29.53-day synodic period, [source](https://en.wikipedia.org/wiki/Moon)). With a 1.54° axial tilt the sun never climbs far above the horizon at the lunar poles. Raking light on the Moon is a place, the terminator, and not a time of day. Terrain shadows are the main relief cue there, yet far ground casts none (`main:src/world/City.ts:581`) and WORLD-TRAVEL turns shadows off above 2 km (line 487).

The fixed sun's comment is wrong: it says WSW (`main:src/config.ts:53`), but `main:src/main.ts:58` puts it at compass 292°, north of west (calculated). A real-sun switch will change every SF shot.

### 4.7 Fog and sky

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `main:src/render/materials.ts:63-75,79-90` | The marine layer is SF geography in game meters | a, b, c, d, if fog returns | SF's fog shape is laid over every city. |
| `main:src/render/PixelPipeline.ts:673-674,829` | The sky is always the FOG or SKY_WARM ramp | d | A bright grey sky on the Moon. |
| `main:src/render/materials.ts:99-107` | The sky is brightest at the horizon | d | The game's whole value structure (dark city, bright haze, pale silhouettes) inverts under a black sky. |
| `main:docs/specs/WORLD-TRAVEL.md:60-61,536-539` | "Uncharted is a fog bank. The opening already does this." | all today, d always | With fog off, density is 0 (`main:src/main.ts:63`) and the bank multiplies zero (`main:src/render/materials.ts:160`), so there is no bank now. The Moon can never have one. |

The rule that follows: a far-field strategy that needs haze is not a world strategy.

### 4.8 Palette

Rows and hard limits (`main:src/render/palette.ts:13-42,89`): 24 ramps used, 24-31 reserved for factions, 32-37 reserved for travel, 38-47 spare. feat/osm still has `RAMP_COUNT = 32` (`osm:src/render/palette.ts:72`).

| Need | Today | Gap |
|---|---|---|
| Snow | WHITE (row 18) runs neutral grey to white | No blue or violet shadow steps. WORLD-TRAVEL's Fuji uses "a snow ramp" (line 659) that its own ramp list (lines 468-475) doesn't have. |
| Glacier and sea ice | none | Needs a cold blue ramp distinct from WATER. |
| Regolith | GREY is the nearest | Mare and highland need two tones of one neutral ramp. Keep warm tints to the top steps and shadow to violet, as STONE does (`main:src/render/palette.ts:82-84`), or it will read brown. Moon albedo 0.136 ([source](https://en.wikipedia.org/wiki/Moon)). |
| Desert, laterite, dry fields | DRY_LAND is reserved, undefined; SAND borrows SKY_WARM (`osm:src/world/terrainMaterial.ts:70`) | Sand shares a ramp with the sky, so a desert horizon loses its edge. Red-earth roads have no rose-violet ramp yet. |
| Dark sky | NIGHT_SKY reserved | Needed on the Moon at all times. |

Ten spare rows are enough. The Moon may be the game's best stage: a whole grey world with black shadows, where paint reads at its strongest.

### 4.9 Ground classes

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `osm:tools/bake/osm.py:39`, `osm:src/world/tiles.ts:22` | 11 classes | c, d | No snow, ice, regolith, tundra, cropland or unpaved road. |
| `osm:tools/bake/worldcover.py:12-13,72-74,110-112`, `osm:docs/ARCHITECTURE.md:173,177` | A missing tile is open sea; every city has WorldCover | c | The bucket holds 2,651 tiles, and the southernmost spans 60°S-57°S (measured by listing it). All of Antarctica comes back WATER, logged as "open sea". GLO-30, by contrast, has a tile at the Pole (measured). |
| `osm:tools/bake/qa.py:244-249,271-272`, `osm:tools/bake/bake.py:2642-2645` | WorldCover's water is the truth for the water check | c | Every land cell disagrees, so the QA fails and the bake exits 3. `"worldcover": false` skips both. |
| `osm:tools/bake/osm.py:579` | The default ground is YARD | b, c, d | YARD renders GREEN_GREY (`osm:src/world/terrainMaterial.ts:68`), so unmapped land is a dark garden. |
| `osm:tools/bake/osm.py:438` | Land cover maps eight subtypes | b, c | `snow` and `urban` are dropped. McMurdo's land cover is one `snow` polygon; Ikeja and Dhaka both have `urban` (measured). |
| `osm:tools/bake/osm.py:489-491` | `glacier` is ROCK; no `tundra`, `fell`, `desert` | c, Arctic towns | Ice renders as grey rock. McMurdo's sample has 5 glacier features (measured). |
| `osm:tools/bake/osm.py:379-395,601-603` | Every road is asphalt, and most get a 3.5 m sidewalk | b, c | `road_surface` is extracted (`osm:tools/bake/overture.py:153-154`) and never read. McMurdo's gravel and Gulu's dirt roads become asphalt with sidewalks. |
| `osm:tools/bake/osm.py:595-597`, `osm:tools/bake/bake.py:2059` | Unknown occupancy counts as residential, which means yards | b | Ikeja's concrete between buildings becomes green gardens: 94 % of footprints have no class there (measured). |
| `main:docs/specs/STAGES.md:170-172` | A stage anchor is GRASS or plaza, a PAVED node, or a flat roof | c, d | An ice or regolith area has no anchor, so no beacon or centerpiece. |

### 4.10 Trees

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `osm:tools/bake/bake.py:2350-2379`, `osm:docs/ARCHITECTURE.md:167-170` | Street trees need no evidence: 30 % of residential frontages get one | b, c | The only tree rule with no WorldCover gate. Riyadh and Longyearbyen get them, and so does McMurdo, where the default `victorian` arch qualifies at 77°S. |
| `osm:tools/bake/osm.py:648-653`, `osm:tools/bake/bake.py:2347`, `main:src/world/props/trees.ts:26` | Street tree, eucalyptus, Monterey pine, cypress | a, b | SF's flora everywhere. No palm: "palm" falls through to a street tree. |
| `osm:tools/bake/qa.py:36-39,55-74` | Thresholds calibrated on SF and London frames | b, c | Untested on tropics, deserts, tundra. Amsterdam's bake has no QA at all (measured: no `stats.qa`). |

Park trees are the good news: the WorldCover gate travels well down to 60°S.

### 4.11 Water

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `main:src/world/City.ts:250-251` | Water is a plane at y = -0.6 | a, b, c, d | Land below that floods once a real DEM is used: New Orleans -3 m, Schiphol -4 m, Baku -28 m, Dead Sea -430 m ([source](https://en.wikipedia.org/wiki/List_of_places_on_land_with_elevations_below_sea_level)). `"groundLevel": 1.0` hides this in Amsterdam. |
| `main:src/world/City.ts:335` | Far water sits at y = -6 | a, b | A lake at any altitude becomes a pit in the far mesh. Lake Michigan is at 176 m ([source](https://en.wikipedia.org/wiki/Lake_Michigan)), so Chicago's far lake drops 182 m. |
| `main:src/world/City.ts:284`, `osm:tools/bake/horizon.py:6` | Height at or below 0.5 m is water | a, b | Below-sea-level land in the hills ring reads as sea. |
| `main:src/world/City.ts:996` | Far ground is never below 0 | a, b, d | `groundAt` clamps. The bus flies at the wrong height over low ground until tiles load. |
| `main:src/game/Splat.ts:217`, `main:src/config.ts:382` | A miss means ground under 0.8 m | a, b, d | It tests height, not class. A breath at an empty spot on low land is a "miss on water", and a breath into a mountain lake is a fake hit. |
| `osm:tools/bake/osm.py:515` | Water is polygons | b | Rivers and drains mapped only as lines are dropped. Gulu has 84 stream features and Ikeja 64 drains and ditches (measured; I did not check how many are lines). |
| `osm:tools/bake/osm.py:617` | The sea is what land polygons leave, where the DEM is under 2 m | c | Ice shelves count as land, which suits us: OSM puts the coastline at the calving line ([source](https://wiki.openstreetmap.org/wiki/Antarctica/Tagging)). Sea ice is not modelled at all. |

On the Moon, zero is the 1,737.4 km sphere, and heights run from about -9.1 km to +10.8 km ([source](https://moonsummits.carrd.co/)). Roughly half the surface is under the plane (estimate: zero is the mean radius). Water has to become an optional body property.

### 4.12 Height range and format

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `osm:tools/bake/bake.py:2497,2523,2581`, `osm:tools/bake/horizon.py:45` | Heights fit i16 decimeters, clipped to ±3,200 m | a, b, c, d | Everything higher is sliced flat at 3,200 m: El Alto 4,150 m, Lhasa 3,658 m ([source](https://en.wikipedia.org/wiki/List_of_highest_cities)), Fuji 3,776 m, Erebus 3,792 m ([source](https://en.wikipedia.org/wiki/Mount_Erebus)), Dome A about 4,090 m ([source](https://en.wikipedia.org/wiki/Dome_A)), and much of the Moon's relief. |
| `osm:tools/bake/bake.py:2529` | Tree height fits `struct 'h'`, with no clip | same | Any tree above 3,276.7 m raises `struct.error` while tiles are written, late in the bake. |

The fix is a per-tile base height plus an i16 offset, or i32. This also blocks WORLD-TRAVEL's own Fuji if it goes through city tiles.

### 4.13 Region grid and bake shape

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `osm:tools/bake/bake.py:1535,1549-1552`, `osm:tools/bake/cities/*.json` | A human writes origin, bbox, start, ground and water levels | all | Nothing generates a config. WORLD-TRAVEL's tier 2 (line 521) needs that. |
| `osm:tools/bake/bake.py:1630-1631`, `osm:tools/bake/osm.py:159-160` | Every bake has an Overture extract or USA Structures | d | Both exit without one. An empty extract would pass, but the Moon has no extract to make, and PROJ stops it first. |
| `osm:tools/bake/bake.py:75,1561-1563` | The whole frame is one 2 m raster in RAM | b, metros | 1 MB per km² per float32 array (measured). A 60 x 45 km metro is 2.7 GB for `dem`, the same again for `dist`, and 0.7 GB of classes (estimate). |
| `osm:tools/bake/osm.py:590` | Block labels span the frame | region jobs | "One container job per region, seconds per job" (`main:docs/specs/WORLD-TRAVEL.md:525-528`) needs a rewrite with overlap halos. SF takes about 30 min today (`osm:CATCHUP.md:59`). |
| `osm:tools/bake/osm.py:698` | 255 neighbourhood names | big cities | Names past 255 vanish. |
| `main:src/world/PaintState.ts:39,57-58` | One dense texture, 16 B per building in the city | metros | 12 M buildings (Kanto, WORLD-TRAVEL's count) is 192 MB on CPU and again on GPU, 1024 x 11,719 (estimate). |
| `main:src/world/City.ts:943-945` | Frames under about 262 km across | world | Hash cells collide past that. |
| `main:src/main.ts:833` | The world ends at the frame | all | The map-edge homing needs to go for world travel, as the doc says. |

### 4.14 What you paint where there are no buildings

1. **Today:** a tap with no building in reach paints ground only, at `count = 0`.
2. **No sign:** the street sign fires only from a primary building (`main:src/game/Splat.ts:349`, `main:src/main.ts:389`).
3. **No levels:** L2 and L3 live on roofs.
4. **Ground paint is capped:** `MAX_TILES = 160` in both branches, about 10.5 km² (calculated), oldest washed away first (`main:src/world/GroundPaint.ts:33`).
5. **Each painted tile costs a draw:** one per tile seen (`main:src/world/City.ts:597`). On an ice sheet, where ground is the only canvas, 160 painted tiles would be as many draws as the whole city budget.
6. **Stages:** "Areas exist only over baked land" (`main:docs/specs/STAGES.md:292`), and an anchor can't form on ice (§4.9).
7. **Ids:** the planned paint key is a hash of the GERS id (`main:docs/specs/WORLD-TRAVEL.md:85,551`). The Moon has no GERS ids.

The fix is to generalize "building" into "target": anything with a stable id and a footprint. The data exists:

| Where | Targets |
|---|---|
| Antarctica | 1,405 buildings in Overture (measured), plus named peaks, ridges, cliffs and glaciers: McMurdo's sample alone has 8 peaks, 6 ridges, 6 cliffs and 5 glaciers (measured). |
| Moon | About 1.3 M catalogued craters, roughly complete above 1-2 km ([source](https://astrogeology.usgs.gov/search/map/moon_crater_database_v1_robbins)), and about 9,000 IAU names ([source](https://planetarynames.wr.usgs.gov/Page/MOON1TO1MATLAS)). |
| Ocean | WORLD-TRAVEL §6 already does this with clouds, ships and whale spouts. |

The doc's sky-paint clipmap (line 744), a paint layer held around the bus rather than per tile, is the right shape for ice and regolith too.

### 4.15 Gravity and the flight floor

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `main:src/config.ts:190-191` | The ceiling is 520 m above sea level, "Sutro tops out ~555" | a, b, c, d | `main:src/game/Flight.ts:254` climbs only if `ceil > floor + 2`. With ground above about 500 m the yoke can't climb at all. Denver is at 1,610 m ([source](https://en.wikipedia.org/wiki/Denver)), the South Pole at about 2,835 m ([source](https://en.wikipedia.org/wiki/South_Pole)). The ceiling should be relative to the ground. |
| `main:src/game/Flight.ts:46` and following | The bus starts at y = 60 and floors start at 60 | a, c, d | It snaps up on frame one, and the smoothed floor takes seconds to arrive. |
| `main:src/world/City.ts:1359` | Unknown ground: rooftops at +18 m | c, d | A guess for urban land. |
| `main:src/fx/Particles.ts:119` | Particle gravity 34 m/s² | d | Moon gravity is 1.62 m/s² ([source](https://en.wikipedia.org/wiki/Moon)). Scale it per body: slow arcs would look wonderful. |
| `main:src/game/Turbo.ts:28,180` | Mach 1 boom at 343 m/s | d | No air, no boom. An art decision. |

Flight itself has no gravity constant, so no physics rewrite is needed. Gears measure from `groundBroad` (`main:src/game/Turbo.ts:125,128`), which already works at altitude.

### 4.16 Data sizes

| Item | Number | Label |
|---|---|---|
| Bytes per building, all regions | SF 151, London 89, Amsterdam 64 | measured |
| Terrain tile, raw | 31.1 KB | measured |
| Empty tile, gzip | flat 0.5-0.8 KB; real relief 5.7-10 KB | measured from SF's edge regions |
| Empty land at tile quality | 91-160 KB per km² | estimate, 16 tiles per km² |
| Antarctica at tile quality | 1.3-2.3 TB | estimate, 14.2 M km² ([source](https://en.wikipedia.org/wiki/Antarctica)) |
| Moon at tile quality | 3.5-6.1 TB | estimate, 37.9 M km² ([source](https://en.wikipedia.org/wiki/Moon)) |
| Moon, global DEM + image | 14.5 GB | measured file sizes |
| Sentinel-2 composite, one 1° tile | 309 MB SF, 466 MB Lagos, 768 MB Dhaka | measured |
| Painted buildings in localStorage | about 230,000 | estimate, 22 chars each at about 5 MB; the quota is from a community source ([source](https://www.xjavascript.com/blog/what-is-the-max-size-of-localstorage-values/)), not confirmed for current iOS |

City tiles must not be used for open land. That is what a planet layer is for.

### 4.17 Other SF-isms

| Where | Assumes | Fails in | Result |
|---|---|---|---|
| `osm:tools/bake/osm.py:364`, `main:src/world/Bridges.ts:79,153`, `main:src/main.ts:157-162` | Bridges are hand-built props | a, b | Bridge, tunnel and elevated segments are dropped from the ground and nothing replaces them. New York, Pittsburgh, London's Thames and Dhaka's flyovers lose them. Amsterdam's shots show long canals with no bridges. |
| `main:src/fx/pixelFont.ts:135,151`, `osm:tools/bake/overture.py:135` | Latin names | b | Anything outside the font is dropped, so the sign goes blank. 35 % of Dhaka's named street segments are Bengali (measured). Lagos and Gulu are all Latin (measured). |
| `main:src/world/City.ts:289` | Hills above 40 m are green | a, b, c | Height-coded colour in the horizon ring. |
| `osm:tools/bake/osm.py:66` | `abbrev` defaults to `us` | b | Harmless, but a default. |

---

## 5. What London and Amsterdam prove

Everything here is measured from `osm:public/city/{london,amsterdam}`.

| | London (Hyde Park) | Amsterdam (Jordaan) |
|---|---|---|
| Frame | 3.33 x 2.05 km, 6.8 km² | 2.05 x 2.05 km, 4.2 km² |
| Buildings | 7,666 | 11,838 |
| Ground heights | -0.9 to 1.0 m, flat | -0.9 to 1.0 m, flat |
| Height sources | floors 71 %, neighbours 19 %, default 6 %, OSM height 4 % | OSM height 88 %, neighbours 10 % |
| In far.bin | 438 buildings, 5.7 % | 551 buildings, 4.7 % |
| WorldCover evidence | yes, QA PASS | no: the bake predates it |
| `"ids"` | osm | absent |
| Files | 20 regions, 0.70 MB | 8 regions, 0.77 MB |

**They prove:**
- The bake runs with no USGS DEM, no LiDAR and no USA Structures, at other latitudes and on both sides of Greenwich.
- OSM heights, floors, parts, roof shapes and the gabled default work.
- Canals carve into a flat ground.
- WorldCover tree evidence works outside SF (London).
- The client loads with `?city=`, and SF props stay gated.

**They do not prove:**
- **Anything about the far field.** London's half-diagonal is 1.95 km and Amsterdam's 1.45 km, against a 1.9 km load radius with a 950 m lead (`main:src/main.ts:937`). Nearly all of each loads as real tiles, so the top defect cannot appear.
- **Any terrain.** Both are `"dem": []`. No non-SF relief has ever been baked, and Copernicus has never been tried.
- **Scale.** 5-7 km² against SF's 253 km² frame. They exercise 6-7 neighbourhood names and tiny paint textures.
- **Poor data.** 75-89 % height coverage against 0-4 % in Lagos, Dhaka and Gulu. Footprints are 99.6 % or more OSM against 37 % in Ikeja.
- **Surroundings.** Neither has a horizon.bin, and `amsalt.png` shows the frame ending in the sea plane.
- **Bridges, non-Latin names, or high or low ground.**

**One thing is stale.** Amsterdam has no `"ids"`, and `osm:src/world/PaintState.ts:37-41` then returns no scheme, so its paint is neither read nor written. `osm:CATCHUP.md:94` already lists the re-bake. `osm:README.md:86` ("Any city Overture covers bakes the same way") is true only in the sense that the code runs.

---

## 6. WORLD-TRAVEL §2-3: the planet layer

**Is land there still just height plus a few classes? Yes.** "Each texel's channels: height, class, coast SDF, density" (line 348). The ocean and far land are shaded from class, hillshade and density (lines 307-309). L4 is "one instanced box per building ≥ 20 m, plus density-extruded blocks for mid-rise fabric" (line 505). That is today's far.bin at a larger scale.

**Would it have the same blob problem at planet scale? Yes, in the band that matters.** A game pixel at 390 px wide (calculated):

| Slant range | 38° vista lens | 50° G3 lens |
|---|---|---|
| 3 km | 5.3 m | 7.2 m |
| 6 km | 10.6 m | 14.3 m |
| 20 km | 35 m | 48 m |
| 50 km | 88 m | 120 m |

z11 is 76 m per texel at the equator and 60 m at SF's latitude, and clipmap ring 0 is 60 m (calculated from Web Mercator; line 324). So one texel is about 8-14 px at 3 km slant range and under one px at 50 km. L5 at 10 km and up is fine. At G1 and G2, 2-10 km up and looking at a metro, the land is a mosaic of flat class patches, which is the blob the producer described.

Three things carry the blob over:
- **A dominant class per texel** loses field patterns, road nets and rivers. Overture's 353 M transportation segments (measured) are what make land read as inhabited from altitude, and the atlas has no channel for them.
- **Density is a scalar.** A density-extruded block is the definition of a blob.
- **Class is empty in two of the producer's three new places.** WorldCover's 2,651 tiles stop at 60°S (measured by listing the bucket). The Moon has no classes at all. Height plus class renders Antarctica and the Moon as hillshade alone.

The Sentinel-2 composites have no tile at the two Antarctic spots I tried, S78E166 and S63W059 (HEAD 404, measured).

**The direct fix is a real appearance layer.** It would be palette-indexed: a ramp and a light offset per texel, baked from real imagery, so `sbWrite` stays ramps only.
- **Earth:** ESA's 10 m Sentinel-2 composites are CC BY 4.0 ([source](https://esa-worldcover.org/en/data-access)) and reachable here (measured). EOX's newer cloudless mosaics are non-commercial or sold ([source](https://eox.at/2019/02/sentinel-2-cloudless-2018/)).
- **Moon:** the WAC mosaic.
- **Antarctica:** still needs a source; I did not find one to confirm here.

### Assumptions that need to change

| Line | Assumption | Verdict | Change |
|---|---|---|---|
| 31-33, 138, 543-550 | UTM zones are the content grid | Fails south of 80°S; undefined on the Moon | At minimum add UPS caps. Better: city-local frames as today, plus one grid that works on any sphere and at the poles. The Moon already needs that grid. |
| 174-176 | A yaw rebase at zone borders | Singular at the pole | Rotate with any origin move, with no zones in the render frame. |
| 307-309, 337-338 | Quadtree tiles read through an affine map | Web Mercator stops at 85.05° ([source](https://en.wikipedia.org/wiki/Web_Mercator_projection)); texels shrink from 76 m at the equator to 16 m at McMurdo (calculated). Across an 800 km view at 45°N a single affine map is off by about 50 km (estimate, second-order Mercator term) | Cube-sphere or similar tiles. Terrarium is EPSG:3857 ([source](https://github.com/tilezen/joerd/blob/master/docs/formats.md)), so use it as a source only. |
| 348 | Height, class, SDF, density | Blobs at 2-10 km; empty in Antarctica and on the Moon | Add the appearance layer above, plus a road or built texture from Overture. |
| 505 | L4: boxes at least 20 m tall plus density blocks | 0-2.5 % of buildings; blobs | Every footprint, merged per block with streets left open, using the raster height ladder. |
| 506 vs 581 | L3 runs "1-20 km" but the streamer is 950 m lead + 1.9 km | **A contradiction in the plan.** The 2-20 km band, which is the top defect, has no product | Design that band first. |
| 342-345 | One source table | Terrain Tiles, WorldCover and GLO-30 each have gaps | A per-region source table: REMA for ice, LOLA and WAC for the Moon, a bare-earth DEM in cities. |
| 349-350 | "The whole planet at z0-z11 is a few GB" | Low by at least an order of magnitude: 55-94 GB for height alone (estimate: 1.38 M land tiles at the 38-68 KB of two real terrarium tiles) | Re-estimate. Storage dollars stay small. |
| 333-335 | The clipmap sits 2 m under city terrain | A DEM with roofs and trees disagrees by far more than 2 m | Mask the clipmap out under cities. |
| 354-360, 377-379 | One exponential atmosphere, NOAA sun | Earth only | A `Body` record (see §7). |
| 416-419 | Solar time follows longitude | Breaks near the poles | Pick the session's sun from latitude and date there. |
| 465-475 | Six new ramps | No snow, ice or regolith | Use rows 38-47. |
| 487 | Shadows off above 2 km | On the Moon and at the poles, low-sun relief is the picture | Bake or compute far terrain shading. Note that a stored hillshade (line 308) assumes one sun, while Sky.ts moves it. |
| 60-61, 536-539 | Uncharted is a fog bank | No fog today; none ever on the Moon | Nothing should be uncharted: the planet layer is always there. |
| 517-528 | Tier 2 bakes in minutes | Needs generated configs and a region-parallel bake | Real work; not "seconds per job" yet. |
| 85, 551-553 | Paint keyed by GERS hash | No GERS on the Moon | A generic target id. |
| 560-571 | The heights ladder | Lacks Open Buildings 2.5D; steps 5 and 7 unbuilt | Add it. It fits the places with no tags. |

**What holds:** float64 truth, the render frame near a floating origin, the lattice-preserving rebase, the curve chunk with R as a parameter, adaptive near and far, the analytic ocean with zero draws, the clipmap as a structure, the three data tiers, and the server design. The Great Lakes, Caspian and Dead Sea need water levels in the land layer, not just an ocean at 0 (line 224).

---

## 7. What any far-field strategy must satisfy outside SF

A strategy that says it works "in every other city" should be checked against this list:

1. **Gate on footprints, never on height.** 2.53 B footprints exist. Height tags don't.
2. **Keep what the bake already knows.** All ground classes and the street pattern reach the far layer.
3. **Need no haze.** Assume fog off, and assume the Moon.
4. **Give every frame a surround.** No frame may end in the sea plane. The hills ring comes from a global DEM or the planet layer, not from one SF tile.
5. **Report invented data.** The bake's QA states, per city, what share of heights are real, and uses raster heights before defaults.
6. **Water level per water body.** Sea level is one value among many, and some bodies have none.
7. **Base height per tile.** Nothing clips at 3,200 m.
8. **A `Body` record:** radius, CRS, atmosphere on or off, sky ramps, ambient, sun ephemeris, gravity scale, palette set. Nothing else in the code says Earth.
9. **Generated configs and a region-parallel bake,** or tier 2 and tier 3 don't exist.
10. **A real test set, replacing London and Amsterdam as evidence.** Whole-city frames of at least 10 km, with no hand tuning:

| City | Tests |
|---|---|
| Denver | altitude, yoke ceiling |
| Chicago | lake at 176 m |
| La Paz | above 3.2 km |
| Dhaka | no tags, Bengali names, density |
| Lagos | ML footprints |
| Gulu | huts, dirt roads |
| Longyearbyen | tundra, no trees |
| McMurdo | ice, gravel, polar sun |
| Apollo 11 site | no atmosphere, no data classes |

---

## 8. Not confirmed

- **No bake or client run was done for any case above.** "Would" means by reading the code.
- **Where Overture's `land_cover` `snow` polygons come from.** The type reaches 80.55°S (measured from footers), which WorldCover tiles do not. Overture's blog says the layer is derived from WorldCover ([source](https://docs.overturemaps.org/blog/2024/05/16/land-cover/)). The polar part is unexplained.
- **How much of the Antarctic ice sheet OSM maps as glacier.** I sampled McMurdo only.
- **Copernicus longitude spacing by latitude.** Sources confirm it widens past 50° but gave no table.
- **GHS-BUILT-H's license text and reachability.** The JRC data host timed out here.
- **Safari's localStorage quota** comes from a community source.
- **iPhone memory headroom** for large paint textures was not measured.
- **Sample limits:** Lagos and Gulu read part of their row groups, and each place is one box. Denver downtown's 84 % may not hold across Denver or for other US cities.
- **A satellite image source for Antarctica** was not found.
