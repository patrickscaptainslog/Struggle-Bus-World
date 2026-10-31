# VERDICT: the far field, judged

Outside judge, 2026-10-30. I read the two audits, the three research reports and the three strategies in full, looked at the five listed screenshots and the strategies' own mock frames, re-read the code on `feat/hybrid` (`git show`, because the `sbw-main` working tree is mid-merge on `merge/perf`) and on `feat/osm`, read WORLD-TRAVEL.md's frame, planet-layer, LOD, tier and effort sections, and re-fetched four external facts. Nothing in any repo was changed. No browser, build or bake ran.

**Labels.** MEASURED = measured in this folder's reports from the repo's data, or a constant I re-read in the code (file:line given). FROM A SOURCE = an external page, linked. ESTIMATE = arithmetic with the assumption stated. MOCK = measured on a CPU mock-up of real SF data, not in the game. Nothing in this folder has run on a phone.

---

## 1. The answer, in plain language

**No, you are not relying on procedural generation too heavily. The distant blobs are not generated. They are empty.** From high above the city, the game only loads real buildings within about 1.9 km of a point ahead of the bus. Past that it draws nothing but a flat pale ground and a handful of tall towers. In the worst views from the ceiling, 85-89 % of the buildings in front of you are not drawn in any form (MEASURED, audit-bands §3.2). That loading radius was built to hide behind a wall of fog, and the fog was turned off at your request (`src/config.ts:77-78` still says "Streaming edge hides behind this"; I re-read it). Nothing replaced the fog. That is why the city fills in as you fly closer: you are flying into the loading radius.

What you do see from altitude is mostly real: half to two thirds of a ceiling frame is real footprints and real heights, and procedural geometry is about 2 % (ESTIMATE, audit-bands §4.2). Your instinct is right in two places only. No pixel anywhere shows a measured colour: colour is 24 ramps chosen by rule, the rules switch themselves off with distance, and nothing data-driven takes over, so distance reads blank. And outside San Francisco building heights are invented for 96-100 % of buildings in most of the world (MEASURED, audit-limits §1). That second one is the real "procedural" worry, and it is a data-sourcing job, not a rendering one.

**What to do.** Stop throwing away data the game already has, and put a cheap, always-present version of every block on screen from the first frame: a small image of the whole city (one cell per 16 m, about 0.4 MB for all of San Francisco, MEASURED) that says what is on top of each cell and how bright it is, plus simple merged boxes for the blocks out to about 7 km, built on the phone from that same image. Real tiles then replace their own cheap version as you descend, so nothing appears from nowhere. The same recipe works anywhere on Earth because it needs only footprints, streets, land class and a height model, all of which are global and free. Ice and the Moon use the same channels with different data. Keep procedural generation for exactly what no data can give: windows, roof clutter, tree shapes, water surface, and the Moon's nearest few kilometres below its data.

**How sure am I.** The diagnosis is solid: three independent teams and my own reading of the code agree. The remedy is three CPU mock-ups on real data that all read as a city (I looked at them). None of it has run in the game or on a phone. SPIKE.md is the five-day test that proves or kills it.

---

## 2. What actually causes the blobs

All re-read by me in `feat/hybrid` (the world and render code main uses) unless marked osm.

1. **The streaming radius with no fog behind it.** `LOAD_RADIUS = 1500`, `LOAD_RADIUS_HIGH = 1900` (`src/world/City.ts:132-136`); the stream centre leads the bus by up to 950 m at altitude (`src/main.ts:937`); fog `enabled: false`, `farFull: 2600` with the comment "Streaming edge hides behind this" (`src/config.ts:70-78`). Result: a 1 km region pops in whole at 3.1-3.8 km from the ceiling, ~190 game pixels wide (MEASURED, audit-bands §1.4). This is the producer's follow-up, and it is the top defect.
2. **far.bin's eleven ground classes thrown away.** The far ground reads one bit: `ramp[k] = water ? Ramp.WATER : Ramp.GREY_LIGHT` (`City.ts:342`, same line 340 on feat/osm). Every far park, forest, beach and street is one pale grey. The data is on the wire (osm `tools/bake/bake.py:2579` writes classes at 32 m).
3. **Far buildings gated at 20 m of height.** `FAR_MIN_HEIGHT = 20.0` (osm `bake.py:77`). That keeps 1.59 % of buildings on main, 1.09 % on feat/osm, 0.08 % in Lagos Ikeja and 0 % in Gulu (MEASURED, audit-limits §1). Everything under 20 m does not exist past the radius. Any gate on height is near-empty wherever heights are untagged, which is most of the world.
4. **The horizon ring is two colours by a 40 m rule, SF only.** `ramp[k] = y > 40 ? GREEN_GREY : GREY_LIGHT` (`City.ts:289` on osm, same on main), from one hard-coded USGS tile (`horizon.py:24`). London and Amsterdam have no ring and sit as islands in a 60 km sea plane (MEASURED, audit-limits §5).
5. **The ramp index is interpolated across triangles.** `ramp = floor(vRamp + 0.5)` on a smooth varying (`src/render/materials.ts:326`). Shores and the 40 m contour pass through ramps nobody chose: the cream dashes on the East Bay shore in `sheets-E-end.png`, the white fringe on Yerba Buena in `downtown-ceiling.png`. I saw both.
6. **Far terrain pokes through near ground.** The far mesh is sunk only 2.2 m (`City.ts:337`) and has no tile mask; it stands above the near ground on 6.7 % of SF's land (MEASURED, audit-bands §7). The pale slabs on the hillside in `sutro-far-L3.png` are almost certainly this (ESTIMATE, pose unknown).
7. **Mid-field switches that all end before the ceiling sees anything.** Outlines end at 520 m view depth, house windows at ~656 m slant, no tree casts a shadow at the ceiling, trees vanish past ~1.5 km, aerial perspective starts only at ~12.5 km (MEASURED from constants, audit-bands §3.3). Four colours cover 49-78 % of a 53-row band. This is the "grey rubble" between the bus and the void in `downtown-ceiling.png`.
8. **Main's ground rule.** On main, anything 17 m from a building is lawn (main `bake.py:1607`); 83.8 % of the sunlit green in `downtown-ceiling.png` is that rule, and on OSM those cells are 46 % road, 16 % sidewalk, 15 % plaza (MEASURED). The grey collars around every row of houses in `sutro-far-L3.png` are this rule's contour. It is the one literal blob that is a generation rule, and feat/osm already fixes it inside loaded regions.
9. **No measured tone anywhere, and the surface layer fades to nothing.** OSM has a facade colour on 0.11 % of SF's parts; roof shape is tagged on 287 of 169,503 buildings (MEASURED, audit-bands §3.5). The windows, trims and facade bands are shader rules gated by pixel size, and past their gate a building is two flat tones. This is the true sense in which distance "is not beautiful", and it is the one part of the producer's instinct that holds.
10. **Outside SF, heights are invented.** Height-or-floors coverage: Denver downtown 84 %, Dhaka 3.7 %, Lagos 0.7 %, Gulu 0.01 % (MEASURED, audit-limits §1); Overture worldwide 8.1 % with `height` (MEASURED, research-earth §7). The bake fills with neighbours or 6 m. Here procedural generation genuinely is the problem, and the fix is the heights ladder (Microsoft, Google 2.5D Temporal, 3D-GloBFP, GHS-BUILT-H), not rendering.

**Corrections to the starting facts.** "6 % of regions" holds at street level only; it is 9-11 % at the ceiling because the load test uses the region rectangle (MEASURED). "2,641 entries, 1.9 %" counts boxes; it is 2,245 buildings, 1.59 % on main, and merging feat/osm thins it to 1.09 % (MEASURED). Docs say the ground meshes are 4 m and 8 m; the tile cell is 4 m so the meshes are 8 m and 16 m (MEASURED). WORLD-TRAVEL says L3 covers 1-20 km; the code ends coarse at 3.1-3.9 km, so the 2-20 km band, where the defect lives, has no product in the plan (MEASURED).

---

## 3. What I checked myself

- **Screenshots.** `downtown-ceiling.png`: East Bay is a pale 1-2 px streak, Treasure Island and Yerba Buena are flat slabs with a white fringe, the mid-field is real geometry with no windows or outlines, the sky is five flat stripes. `downtown-250m.png`: the Financial District is flat grey boxes with a hard line where real meshes stop, exactly a 1 km region edge. `alamo-ceiling.png`: 161 draws, 1.17 M triangles, 59 fps on the laptop; green bands across SoMa from main's grass rule; bare land at the waterfront. `sutro-far-L3.png`: the most literal blob, grey collars and pale slabs. `sheets-E-end.png`: the near towers in "rest" and "toggle" prove the near band works; blast7's paint at 42 % of the frame is the game. The audits describe these correctly.
- **Mock frames.** `art/out/sheet-sunset-strip.png`: A (today) empty; B (every building drawn) salt-and-pepper noise; C (flat raster) a pale washed sheet with green patches; D (blocks then raster) reads as a city with an avenue grid. `systems/presidio-today-vs-stack.png`: today a void with specks; the stack shows the full grid with Twin Peaks and Mount Sutro standing. `lean/final-sunset-east-ceiling.png`: today a void; "blocks16 to 7 km + raster16" reads as the same city as the truth row, slightly noisier than art's D. `art/out/plan-dial.png`: the heavy value plan is fog by another name; the light one is fine; none is needed for presence. `art/out/worlds-sheet.png` and `systems/scene-three.png`: farmland and the Moon are the strongest panels; the desert panel reads tan and must be checked against the no-brown rule by eye; flat ice at 1 m height steps terraces visibly in the systems render.
- **External facts re-fetched today.** Cesium issue #4043 is still open, opened 2016-06-24, and the proposal for small buildings was to "rasterize them to the imagery tile" ([github](https://github.com/CesiumGS/cesium/issues/4043)). Cesium Native renders a parent while descendants load and `TilesetOptions::forbidHoles` prevents holes ([cesium.com](https://cesium.com/learn/cesium-native/ref-doc/selection-algorithm-details.html)). R2 is $0.015 per GB-month, $4.50 per million Class A operations, egress free ([cloudflare](https://developers.cloudflare.com/r2/pricing/)). The ESA WorldCover Sentinel-2 10 m annual composites for 2020 and 2021 are CC-BY 4.0 on bucket `esa-worldcover-s2` ([AWS registry](https://registry.opendata.aws/esa-worldcover-vito-composites/)). All four match the reports.
- **Where two reports disagreed.** Audit-limits said McMurdo lies in the UTM gap; research-polar-lunar is right that it is in zone 58 and the gap starts at 80°S. Audit-limits found no Antarctic imagery; research-polar-lunar found five sources, and I accept LIMA (public domain) as the practical one. Lean says the raster alone fixes the ceiling and blocks "barely help there"; art shows a flat raster at a grazing angle reads as a pale sheet and swaps yards for walls when tiles arrive (MOCK frame C, 16.3 % blob, 1,986 px pop). I side with art: the raster is step one because it is a day of work, but blocks are step two of the same spike, not an option, and the raster must store what a grazing camera sees. Systems says the far band should be a ray march; art and lean say a mesh. Art's own numbers settle it for now: all of SF as blocks is 179 k triangles, less than today's always-drawn far layer at 210 k, so there is no reason to give up hidden-surface removal on a tile-based GPU for the first version.

---

## 4. The three strategies, scored

10 is best on every column; on Effort, 10 means least work. Scores are my judgement of each report as written, after checking its evidence.

| Strategy | Beauty | World scale | Moon & Antarctica | Phone | Legal | Effort | One line |
|---|---|---|---|---|---|---|---|
| **Art** (data for shapes, rules for style) | **8** | 6 | 7 | 6 | 7 | 5 | The best-looking mocks and the right rules (2 px silhouettes, one tone per block, far ramp siblings, haze as a dial). Its block band needs street-bounded blocks and a new bake product, and Gulu-type fabric is untested. |
| **Systems** (one tile tree per body) | 7 | **9** | **9** | 4 | **8** | 3 | The right end state: nothing absent, one shader for hills, blocks, ice and craters, layers split along licence lines, proven offline on real SF, ice and lunar data. Its first renderer is a fragment-shader ray march that discards hidden-surface removal and makes 0.7-4.5 M dependent fetches a frame, unmeasured on any phone; and it is 13-18 engineer-weeks before Berkeley appears. |
| **Lean** (two small rasters, boxes on the phone) | 6 | 7 | 6 | **8** | 7 | **9** | A day to the first proof, no rebake, no new geometry format, built on today's far mesh, horizon mesh and tile mask; measured cost per km² nearly constant across SF, Dhaka, Denver, Lagos and Gulu. Noisiest mock; defers ice and the Moon entirely; its own metric measures brightness, not structure. |
| **Verdict: hybrid** | 8 | 8 | 8 | 7 | 8 | 7 | Lean's mechanism and order, art's look rules, systems' end state. |

**What I rejected, and why.**

- *Systems' ray march as the first far renderer.* `discard` plus `gl_FragDepth` switch off Apple's hidden-surface removal for those fragments ([Apple, retired OpenGL ES guide, as cited by systems](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/Performance/Performance.html)); 135 M dependent fetches a second at 30 fps in the worst case (ESTIMATE, systems §1); and it replaces four working systems (far ground, far boxes, horizon, water plane) in one step. Systems itself names "mesh the raster in a worker" as the fallback, which is lean's plan. Keep the march as plan B, measured in the spike only if meshes crawl.
- *Systems' one global batch bake and no tiers as the near-term plan.* Right destination, wrong first move: it does not put Berkeley on screen for weeks and needs a rented machine. Sequence it after the any-city tool.
- *Art's `blocks.bin` cut by the street network as the first block product.* Needs street-bounded blocks (SF has 5,040; Gulu's huts keep 34 % of roof area under any cell gate, MEASURED lean §3.2) and a bake format. Lean's on-device merge from the 16 m height raster needs no mapped streets and is area-conserving through the raster. Adopt art's "one tone per block" and 2 px silhouette rule on top of it. Revisit street-cut outlines if the grid merge reads as Lego at the swap (lean's own killer 3).
- *Art's heavy value plan.* It is fog by another name (I looked at `plan-dial.png`). Ship it as a dial at zero or light. Presence must never depend on it.
- *Lean's "nothing this month on the Moon and Antarctica."* Accepted for the month, with one condition lean itself states: the raster header carries an affine frame and a body id from day one, so the city raster is already a tile of the planet tree.
- *WORLD-TRAVEL's L4 "boxes ≥ 20 m plus density-extruded blocks".* It is today's defect at a larger scale, and a density-extruded block is a blob by construction.
- *Turning fog back on.* Hides instead of draws; you removed it; the Moon has none.
- *Raising the streaming radius.* 1.26-1.37 M more LOD 1 triangles on feat/osm (MEASURED) against a 1.0-1.5 M budget.
- *Photos as pixels, Google or Bing or Mapbox imagery, photorealistic 3D tiles, Cesium ion offline.* Barred by their terms (research-earth §3-4, clause numbers given there), and photos break palette lock and carry baked shadows.
- *Per-building impostors.* 1.5-1.9 buildings per game pixel in the far strip (MEASURED). Nothing to impost.
- *AI-generated tiles.* Isometric NYC needed manual review for one city ([cannoneyed](https://cannoneyed.com/projects/isometric-nyc), via research-priorart).

---

## 5. The verdict: what should be real and what should stay procedural

**The rule in one sentence (art's, and I adopt it): real data draws every shape and sets how bright it is; rules choose the hue and invent anything smaller than the data.** The test for "must be real": would someone from there notice, is it at least 2 px when first seen, can it be painted. Any yes means real.

### By thing

| Thing | Today | Should be | Why |
|---|---|---|---|
| Every building's existence and footprint | Real within ~2-4 km, absent beyond | Real everywhere, as raster tone at any range and as merged boxes to ~7 km | The top defect. A local knows their block is there |
| Building heights | Real in SF (97.3 % LiDAR); invented for 96-100 % of buildings in Dhaka, Lagos, Gulu | Real from a ladder: tags, Microsoft, Google 2.5D Temporal, 3D-GloBFP, GHS-BUILT-H, then neighbours; share of invented heights reported per cell | A wrong skyline is the one lie a local sees. At 5 km one pixel is ~10 m, so 5-10 m error is fine |
| Block pattern and street gaps at 2-7 km | Absent | Real: boxes from the height raster, streets as gaps, one tone per block | Avenues are the far field's only rhythm at a grazing angle |
| Far ground classes | One grey ramp (water bit only) | Real: the 11 classes already in far.bin, WorldCover beyond the frame | The data is already downloaded |
| Brightness (tone) of far land and roofs | 0 % measured; rule only | Measured: building cover and height first, Sentinel-2 composite tone later, histogram-matched per class, quantised last | Tone is what stops far land reading as flat class patches (Google Maps' 2020 method) |
| Hue | Rule (24 ramps) | Stays rule, forever | Palette lock, no brown, paint must stay the only saturated thing |
| Windows, trims, bays, roof clutter, roof shape | Procedural | Stays procedural; gated by pixel size as today | No global data exists; sub-2 px past ~650 m anyway; nobody can check them |
| Tree placement and shape | Main: 100 % procedural; feat/osm: 78 % real or derived | WorldCover-gated placement; shape procedural; draw as points past 1.5 km instead of vanishing | Parks go flat at the ceiling today |
| Hills and the horizon ring | Real relief, colour by a 40 m rule, SF only | Real relief from GLO-30 or 3DEP for every city; class and tone from the surround raster | London is an island today |
| Coast, rivers, lakes | Derived on main, real on feat/osm | Real (OSM land polygons); water level per water body | A local knows the shoreline; Lake Michigan is at 176 m |
| Cast shadows past ~2-3 km | None | From a height sweep over the far raster, in a worker, when the sun moves | "Keep all shadows"; on ice and the Moon relief is shadow |
| Sky | Procedural, five flat stripes | Stays procedural; designed | 23 % of the ceiling frame carries no information today |
| Water surface, glitter, clouds | Procedural | Stays procedural; cells never under 2 px | No data, and it moves; today's dash hash flips up to 4.5 % of pixels at random |
| Paint at distance | Vanishes past the radius (far.bin's paint index is never read, `City.ts:368`) | Real, from a world-anchored paint raster read by boxes, towers and far ground | It is the game. A painted district must be visible from the ceiling |
| Bridges | Hand-built, SF's two only; every other bridge dropped (osm `osm.py:364`) | Real spans from OSM ways | Every other city has none |
| Moon surface under 3-10 km | n/a | Seeded craters on top of real relief, fading where a data texel reaches ~2 px | Data turns soft there; never in place of data |

### By band at the ceiling (hardest case; bands are really metres per game pixel, so they slide with lens and height)

| Band | Range at the ceiling | Drawn from | Real | Procedural | Phone cost | Bytes |
|---|---|---|---|---|---|---|
| 0 Detail | to ~0.7 km | Today's LOD 0 tiles | Footprints, heights, streets, classes | Windows, trims, roof clutter, tree shape | Unchanged | 131 KB per region (MEASURED) |
| 1 Coarse | 0.7-2.2 km | Today's LOD 1 regions, with a calm pass: one tone per block past 1.5 km, trees as points, outlines by camera height | Massing, cast shadows | Same surface, gated | Falls once the edge is hidden (radius can shrink ~1,871 to ~1,400 m, ESTIMATE lean) | Same files |
| 2 Blocks | 2.2-7 km | Merged boxes built in a worker from a 16 m height raster, one instanced draw per 4 km chunk, hidden per 256 m tile by the existing `uMask`, Bayer dissolve on arrival; towers ≥ 2 px keep real outlines | Position, height, street gaps | The merge rule, one tone per block | +1-7 draws, +24-85 k triangles worst view (MEASURED lean), 0 in the sun pass | 144 KB for all SF (MEASURED) |
| 3 Fabric | 7-25 km | Today's 64 m far mesh textured from the 16 m class-and-tone raster: class nearest, tone filtered, quantised last | Classes, roofs, streets, parks, relief | Hue, district drift | 0 draws, 0 triangles, 2 reads per far pixel on ≤ 7-10 % of the frame | 264 KB for all SF (MEASURED) |
| 4 Ridgelines | 25 km to horizon | Today's horizon mesh textured from a 32 m surround raster (GLO-30, WorldCover, composite tone, Overture cover); far fade moved from 11-20 km to 21-34 km with the far plane grown | Relief, land cover, built cover | Hue, the depth remap | 1 draw, 55 k triangles, same as today | ~1 MB per city (ESTIMATE) |
| 5 Regional and orbit | G2-G3 | The same three layers (relief, surface, built) as tiles of one cube-sphere tree per body, parent resident until children arrive; analytic ocean in the resolve | All land | Hue, cloud deck, sea glitter | ≤ 8 draws claimed by WORLD-TRAVEL and unverified (GPU Gems' layout gives 26-53); needs its own spike | 14-15 GB at 100 m, 128-146 GB at 30 m, 0.63-0.80 TB at 10 m (ESTIMATE) |

**How pop-in goes away.** Nothing is ever absent (rasters load at boot). Tone matches by construction because the raster is baked from the same tiles the buildings come from, with one calibration against an in-game frame. Blocks dissolve under an arriving tile with the Bayer dither; real buildings never dissolve, so they keep their early depth test. Art's mock cut the largest visibly moving area at a region swap from 12,570 px to 501 px before any dissolve (MOCK). That is a reduction, not zero, and only a real descent on a phone can say whether the remainder reads as a pop.

**How the same holds in every other city.** Every input is global: 2.53 B Overture footprints (MEASURED), WorldCover to 60°S, Sentinel-2 composites to 60°S, GLO-30 everywhere. No far layer depends on a height tag; the raster conserves roof area so a hut city is tone even where boxes fail. Cost follows pixels and cells, not building count: 0.3-1.2 KB per km² in five cities (MEASURED lean §3.2). London and Amsterdam prove nothing about this because their frames fit inside the load radius; the real tests are whole-city frames of 10 km or more in Denver and Dhaka with no hand tuning, then Gulu, Longyearbyen, La Paz.

---

## 6. The Moon

The data is good and small; the pipeline does not exist; and the Moon is the strongest case for this plan because it has no haze to hide anything. Both lunar mocks (art's highlands panel, systems' Theophilus render) were the best-looking frames in the whole folder.

- **Data** (research-polar-lunar §4): LOLA 118 m global DEM (8.49 GB, MEASURED HEAD), SLDEM2015 59 m to ±60°, USGS Kaguya TC DTMs at 17-33 m (CC0, 155,925 COG items), LROC WAC 100 m mosaic, WAC Hapke normalised colour at 400 m, ~1.3 M Robbins craters, 9,003 IAU names, the Unified Geologic Map as the class layer (CC0). A pyramid to 32 m is about 25 GB (ESTIMATE). The one heavy bake is mosaicking the Kaguya strips.
- **What breaks today** (audit-limits §4): PROJ refuses an Earth-to-Moon transform (`bake.py:1542`); the sea plane at y = -0.6 floods half the surface; the 20 km far fade becomes a black band before a horizon that is 48 km away from the ceiling (ESTIMATE); the 30 km far plane is too short; the sky is always the FOG ramp; heights clip at ±3,200 m; no `Body` record exists anywhere.
- **What it needs:** a `Body` record (radius 1,737.4 km, no sea, no air, NIGHT_SKY, ambient near zero, gravity scale for particles); a curved horizon with the far plane past 48 km; a REGOLITH ramp that is neutral with warmth only in the top steps and violet shadows so it never reads brown; tone from an albedo-like source (WAC Hapke or Clementine), never the morphology mosaic, whose 55-75° incidence bakes shadows that would fight a moving sun (FROM A SOURCE, research-polar-lunar §4.2); terrain shadows from a height sweep to the horizon, because a 3 km rim at 1.5° casts 115 km (ESTIMATE); seeded craters only under the data's resolution, within the nearest 3-10 km; targets instead of buildings: craters by Robbins id (level 3 throws rainbow rays), maria as districts, IAU names as signs; a baked no-paint list with the Apollo keep-out radii (75 m at Apollo 11, about 200-225 m at Apollo 17, FROM A SOURCE) drawn as the only permanently grey circles on a painted Moon.
- **Cheap beauty:** the opposition surge, 40 % brighter within 4° of the anti-sun point, is one dot product in the resolve and surrounds the bus's own shadow (FROM A SOURCE, research-polar-lunar §5.4). Earth is ~20 px wide and rises only near the limb, so an Earthrise is a destination.
- **Order:** after the any-city tool and the cube grid. Nothing in the SF spike blocks it as long as the raster header carries a body id and an affine frame.

## 7. Antarctica

Antarctica is the strict test of "no fog, no height gate, no Mercator", and most of what breaks is plain code.

- **What breaks today** (audit-limits §4.9-4.11): WorldCover has no tile south of 60°S and the bake reads a missing tile as open sea, so a bake runs and then fails QA on water; unmapped land defaults to YARD (a green garden) when OSM's convention is that everything south of 60°S is glacier unless mapped as rock ([OSM wiki](https://wiki.openstreetmap.org/wiki/Antarctica/Tagging)); glacier maps to ROCK; Overture's `snow` cover is dropped; 30 % of frontage buildings get a street tree at 77°S; heights clip at 3,200 m (Erebus is 3,792 m); the sun is fixed; UTM has no zone south of 80°S.
- **Data** (research-polar-lunar §1): REMA v2 at 32 m and 100 m (CC BY 4.0 on the AWS registry; PGC's own commercial-use wording unconfirmed) with a `filled_cop30` product to the pole; REMA heights are ellipsoidal, about 50 m off at McMurdo (MEASURED single samples), so a geoid correction is mandatory or McMurdo's coast floods; BedMachine's 500 m mask plus ADD rock outcrop (CC BY 4.0) as the class layer; LIMA 15 m public domain for tone on rock and coast, MOA's high-passed band for ice, CDSE Q1 mosaics for freshness; flat ice has 0.9 % contrast, so tone there comes from high-passed relief and heights need ~0.25 m steps or the shelf terraces (I saw the terraces in systems' Ross Island render). A pyramid to 32 m is 2-5 GB (ESTIMATE).
- **Light:** the sun is 1.7-25.9° at McMurdo today and never above 23.4° at the pole (ESTIMATE), the game's favourite light for months, but shadows must come from height out to the horizon (Erebus at 1.7° casts 128 km, ESTIMATE) and half the year is dark, which needs night art before it ships. The session "golden band" that follows longitude spins at the pole; pick the sun from latitude and date there.
- **Places:** McMurdo is a real hero town (367 OSM buildings, 89 % gravel roads); the South Pole has zero footprints, so Amundsen-Scott is hand-built or a sign. Targets: stations, 19,803 gazetteer features, ice fronts, rock islands; the snow itself needs the paint raster because 160 painted ground tiles would equal the whole draw budget. No-paint: Lewis Bay (ASPA 156), historic huts, wildlife.
- **Taste call for the producer:** art's Dome C panel needed a 700x exaggeration of light to avoid a blank plate. That is a style choice, and the alternative is a blank plate.

---

## 8. Changes to WORLD-TRAVEL.md

Keep: float64 truth and the floating origin, `pipeline.rebase()`, the curve chunk with R as a parameter, adaptive near and far, the analytic ocean, the heights ladder (extended), Sky.ts behind a `Body` record returning a vector, the server design, navigation and the crossing's beats, automated beauty sampling. Change:

| Where | It says | Change to |
|---|---|---|
| TL;DR 1, §1.2, §3.3 (lines 31-33, 138, 174-176, 543-550) | City content in UTM zone frames, keys `{zone}{N\|S}/{rx}_{rz}`, yaw at zone crossings | Keep each city's local tmerc frame (fine outside the last degree of latitude, MEASURED); one cube-sphere (S2) grid per body for planet tiles, body id in the key. UTM has no zone south of 80°S, pinches to 12 km at 89°S, and does not exist on the Moon |
| §2.1 (337-350) | Mercator z0-z11 atlas of height, class, coast SDF, density; "a few GB" | Three layers on the cube grid: relief, surface (class + measured tone, canopy), built (every footprint); streets as a separate ODbL layer. Mercator stops at 85.05°. "A few GB" is low by 5-20x: ~24 GB at 76 m, 128-146 GB at 30 m (ESTIMATE) |
| §2.1 (308) | Stored hillshade | Live light; height sweep where needed. A stored hillshade assumes one sun |
| §3.1 L4 (505) | Boxes ≥ 20 m plus density-extruded blocks | Every footprint, gated by pixels (2 px rule); boxes merged per cell; never a density scalar |
| §3.1 L3 (506) vs §3.4 (581) | L3 covers 1-20 km; streamer is 950 m lead + 1.9 km | Contradiction. Coarse ends at 2.2-3.9 km. Bands 2-4 of this verdict are the missing product |
| TL;DR 5, §3.2 (60-61, 536-539) | Uncharted is a fog bank; the opening already does this | With fog off, density is 0 and no bank exists today; the Moon can never have one. Nothing is uncharted: an unbaked place is bands 2-4 with no band 0 |
| §2.6 (487) | Shadows off above 2 km | Keep them from the height sweep. On ice and the Moon the shadows are the picture |
| §1.1 (141) | Ignore the geoid | Vertical correction per source: REMA is ~50 m off at McMurdo |
| §2.1 (343) | Bathymetry from AWS Terrain Tiles | GEBCO_2026, 15 arc-second, public domain; Terrarium is Mercator |
| §2.1 source table | Land class from WorldCover | Per-region source rows: WorldCover to 60°S, BedMachine + ADD on ice, Unified Geologic Map on the Moon |
| §2.1 (332) | Clipmap ≤ 8 draws | Unverified. GPU Gems' layout gives 53 draws at 8 levels or 26 instanced (ESTIMATE); one draw per ring is a different structure and needs a spike; cube faces add seams |
| §3.2 tier 1 (517-520) | About 20 hand-tuned hero cities | 3-5 heroes. Everything else looks right on arrival from the automatic far layers |
| §3.2 tier 2 (521-528) | On-demand bake service, containers, "seconds per job" | SF takes ~30 min today and the bake is not region-parallel. Far layers for the planet in one batch; near tiles for a growing list on a schedule |
| §3.2 (533-534) | Monthly re-bake per release | Archive inputs: Overture deletes releases after 60 days; 2026-12-16 is a reserved breaking release ([release calendar](https://docs.overturemaps.org/release-calendar/)) |
| §3.3 ladder (560-571) | Seven steps, two unbuilt | Add Microsoft heights, Google 2.5D Temporal, 3D-GloBFP; keep GlobalBuildingAtlas out (CC BY-NC) |
| §2.5 (465-475) | Six new ramps | Add ICE, BLUE_ICE, REGOLITH, SKY_POLAR, FIELD, far siblings (FAR, FAR_GREEN); give SAND its own ramp (it borrows SKY_WARM, `terrainMaterial.ts:70`) |
| Appendix B | PLATEAU returns 403; Copernicus "free with attribution" | PLATEAU hosts answered 200 today (MEASURED, pages not data); GLO-30 also needs the Art. 6(c) liability sentence |
| §9 (925-943) | 21-30 engineer-weeks on three parallel senior tracks | The real limits are one producer's eyes, one phone and a shared GPU: one visible win per week |

---

## 9. Roadmap, with honest effort for AI agents plus one producer

Effort is agent-days or agent-weeks of calendar time, not engineer-weeks: agents work fast and wrong without a phone check, so each step ends on the producer's iPhone. Nothing here can be baked on this laptop at planet scale (8 GB, 28-92 KB/s measured today).

| # | Step | Effort | Proves |
|---|---|---|---|
| 0 | **No-new-data fixes** on the spike branch: `flat` ramp varying, far ground reads its 11 classes, far terrain sunk under loaded tiles, water dash prefiltered, tower base band gated, far fade 21-34 km, trees as points past 1.5 km | 1-2 agent-days | The stray fringes, pale slabs and speckle go for nearly nothing; the East Bay hills return from data already on the wire |
| 1 | **The spike** (SPIKE.md): 16 m raster from the feat/osm tiles behind `?farmap`, boxes in a worker behind `?farblocks`, surround raster for the Bay Area and London, Ross Island with no buildings; captures with `tools/altitude.mjs --seq`, `tools/shimmer.py`, `tools/fps.mjs`; one real iPhone | 5 agent-days, 2 producer phone sessions, one overnight download | Whether every block reads from the ceiling with no visible pop on an A15, in real game frames. Kills or proves the whole direction |
| 2 | **Descent and paint**: Bayer dissolve per tile, hold-still swap tool, world-anchored paint raster read by boxes, towers and far ground, band-1 calm pass (one tone per block, outlines by camera height, depth band from ~2 km), `?loadr` cut to pay for feat/osm | 2 agent-weeks, 1 producer check per week | A 60 s ceiling-to-street descent with no region appearing; painted districts visible from the ceiling |
| 3 | **Merge gate**: feat/osm ahead of stages (producer decision 1), LOD 1 ring cap so the ceiling fits 1.5 M triangles with the sun pass | 1 agent-week | The live game gets real streets and the spike's far field on the A15 within budget |
| 4 | **Any city**: `farmap.py --from-overture` (bbox, GLO-30 ring, WorldCover, composite tone, Overture cover), heights ladder with Google 2.5D, a QA line reporting invented heights, the plain bugs (ceiling relative to ground, ±3,200 m clip, lakes at altitude, default ground/arch/trees, `district()` gated, DEM credit); Denver and Dhaka at ≥ 10 km frames with no hand tuning, then Gulu, Longyearbyen, La Paz | 3 agent-weeks, 1 producer check per city | "The same holds in every other city" becomes a measured claim instead of a sentence |
| 5 | **Planet layer v1**: S2 cube tree per body, `Body` record, relief/surface/built layers, parent-first streamer, PMTiles archives on R2, 100 m planet bake then 30 m on a rented machine, fly out of SF; the city raster becomes one level of the tree | 6-8 agent-weeks, $100-200 once, ~$15 a month | Berkeley to the horizon from the tree; London is not an island; the G1-G2 band over a metro reads as fabric, not class patches |
| 6 | **Antarctica**: source rows (REMA to a geoid, BedMachine, ADD, LIMA), ICE/BLUE_ICE/SKY_POLAR ramps, default ICE, height-sweep shadows, polar sun rule, McMurdo hero bake, targets and no-paint list | 2-3 agent-weeks | Ice reads from relief and low sun with no fog; the same shader draws it |
| 7 | **The Moon**: `Body` moon, curved horizon and far plane > 48 km, NIGHT_SKY and REGOLITH, albedo tone rule, Kaguya mosaic bake (the one heavy job), seeded craters under the data, crater targets, Apollo keep-outs, opposition glow, scaled particle gravity | 3-4 agent-weeks | One stack with no haze; paint on a grey world; the game's best stage |
| 8 | **Later, only if measured**: the ray-march far renderer (if meshes crawl), AlphaEarth classes, real sun with night art, CDSE quarterly tone | open | |

Total to a planet with ice and the Moon: roughly 18-24 agent-weeks of calendar time at one visible check a week. The three strategies estimated 13-18 engineer-weeks (systems) and one month to any-city (lean); I believe both, and I believe the producer's time is the binding limit, not the agents'.

---

## 10. Decisions only the producer can make

1. **Merge feat/osm ahead of stages.** The sutro blobs are main's 17 m grass rule; stage anchors read that same class grid (STAGES.md:170-172). I recommend yes.
2. **Accept that past about 2 km a building is a simple shape with no windows.** At 3 km a house is 1-2 px, so nothing visible is lost (MEASURED), but say it out loud: it is a look.
3. **The value plan (aerial perspective) ships at zero or light, never heavy.** Look at `art/out/plan-dial.png` and pick.
4. **Who runs the weekly iPhone check.** Controls, super splat and hybrid have never run on a real phone (HANDOFF). Every killer in this folder can only be seen there. It has to be you.
5. **Hero cities: 3-5, not 20.** Everything else looks right on arrival or it does not ship.
6. **Order after any-city:** the planet layer first (which brings Antarctica and the Moon as source rows), or the Moon first as a stage. I recommend the planet layer, because the Moon's `Body` record and curved horizon are the same code.
7. **Spend $100-200 once and ~$15 a month** on a rented bake machine and R2, when step 5 starts. Not now.
8. **Two questions for counsel**: player paint keyed by building id under ODbL, and whether CDSE's mosaics count as Sentinel data (a one-line email to CDSE support). Neither blocks the spike.
9. **Fixed sun or real sun.** DECIDED 2026-10-30: real sun (the producer asked for live sun, moon, stars and weather after this work), so cast shadows must not be baked into tone. A real sun changes every SF shot (the fixed sun sits at compass 292°, not WSW as its comment says, MEASURED).
10. **Two taste calls:** the desert ramp reads tan in art's panel and must pass your eye for brown, and Dome C's 700x light exaggeration against a blank plate.

---

## 11. Risks

1. **Crawl.** Every mock is a still frame; one two-frame proxy flips a third fewer far pixels than drawing everything and still 13.9-24 % per frame (MOCK). If block edges and street gaps boil at 1-2 px in motion, the block band fails as designed. Only `tools/shimmer.py` on real frames can say.
2. **Printed carpet.** The raster strip may read as a flat photo of a city. Lean's metric measures brightness, not structure; art's measures rhythm but on a mock calmer than the game (pepper 4.5 % against 6.0 % on the same shot, MOCK).
3. **The seam.** Real meshes meeting the raster or boxes at 2-3 km is unmeasured in all three strategies. A 16 m cell is ~8 px wide at 2 km from street height (ESTIMATE); diagonals may read as Lego at the swap. Fallback: 8 m near the edge at 2.7x the boxes.
4. **No triangle headroom on feat/osm.** 763-912 k loaded LOD 1 triangles at the ceiling before the sun pass (MEASURED) likely pass the budget once merged. If the LOD 1 rings cannot be capped and the radius cannot shrink, there is no room for anything.
5. **Invented heights in data-poor cities.** Until the ladder is wired, Dhaka's six-storey blocks are 6-14 m slabs. The silhouette rule then picks the wrong buildings.
6. **Imagery quilt and clouds.** Tone seams at scene edges across a continent; a Lagos scene rated 1.35 % cloud was full of clouds (MEASURED). Composites and per-class matching are the answer and are untested at scale.
7. **Licences.** CDSE's reading, paint under ODbL, PGC's commercial wording on REMA, six Japanese DEM sources inside Mapterhorn under GSI terms. Each has a fallback; none stops the spike.
8. **Overture's clock.** Releases are deleted after at most 60 days and 2026-12-16 is a reserved breaking release. Archive inputs; freeze the raster format before then.
9. **This laptop.** 8 GB, C: near full, 28-92 KB/s today. A city bakes here; a planet does not. The London surround download alone is an overnight job here.
10. **Far plane and depth.** Moving the fade to 21-34 km and the far plane past 30 km (48 km on the Moon) must be checked for depth precision with the 1.5 m near plane.
11. **Polar night and the spinning sun.** Half the year dark at the pole needs night art; the session golden band breaks near the poles.
12. **Plan B is unproven.** The ray march has never run on Safari; if meshes crawl, the fallback is itself a spike.
13. **Automatic beauty with no human.** Three sites with hand-picked numbers are not a planet. The QA gates in systems §9 are a proposal.
14. **Producer bandwidth.** One phone, one pair of eyes, one visible win a week. The roadmap's honest unit.

---

## 12. What I could not confirm

- Nothing in this folder has run in the game, in a browser or on a phone. Every frame time is a count, not a measurement.
- The Sunset and Presidio ceiling views have no fog-off capture; their numbers are simulation. The spike takes the first real ones.
- iOS Safari limits for texture arrays, GPU timers and range caching come through crowd-sourced stats and were not rechecked.
- Whether Cesium shipped the rasterise-small-buildings idea from #4043: the issue is still open as of today.
- The strategies' effort figures are guesses; mine are too.
- The desert panel's "brown or not" and the flat-ice terracing are my eyes on two PNGs at mock resolution.
- External facts other than the four re-fetched today stand as the research reports recorded them, with their own gaps listed in research-earth §14, research-polar-lunar §12 and research-priorart §10.
