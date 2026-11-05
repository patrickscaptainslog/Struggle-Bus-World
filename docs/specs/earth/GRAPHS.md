# GRAPHS: the world's first graphs for life

What the world builds first for life's stage 1, and how: San Francisco's graphs from the Bay archive, in the contract's files, the parser life reads, and W1. Built to `CONTRACT.md` 0.5. Where the contract can't be met as written, the change is at the end, Proposed, for the second account (`CONTRACT.md` section 8). Nothing is built on a change before it's Agreed.

**State.** 2026-11-05, the first account, on `feat/world`, with `feat/earth` merged in at e8c44a7 (77d212c: the contract signed by both, main's 6b494b7). Planned, then built the same night: steps 1 to 4 of the order and San Francisco's files ("Built", below). Where the build left the plan, the plan's text says so in place. Facts are marked as `LIVING.md` marks them. MEASURED here means read tonight from the archive (`bay-2026-10-21`, read only) or from the repo, with throwaway scripts that read one row group at a time. They aren't in the repo. The bake's own report prints the same counts.

## In one minute

- **One map, as it ships.** San Francisco's: origin 37.7749, -122.4194, bounds x -8,704 to 5,632 and z -9,984 to 7,680, 195 regions of 4 x 4 tiles. Its tiles aren't re-baked. Beside them go a `g_<rx>_<rz>.bin` a region (`SBG1`), one `routes.bin` and a `life` block in `city.json`.
- **From the archive alone.** Overture's raw row groups for segments and connectors, which keep the `between` ranges the flattened extract drops; the base types for areas; OurAirports; the EGM96 grid. Every height comes from the city's own baked terrain grids, a deck's from the deck City draws there (C2) or else the bridges spec's profile, and water's is `WATER_Y`. No download.
- **New code.** `tools/bake/graphs.py`, the bake. `tools/bake/decks.py`, the bridges spec's deck profile, written once for the graphs now and for bridges step 5 later. `src/world/lifeData.ts`, the types and the two parsers, worker-safe. `tools/world/graph-check.mjs`, W1.
- **Under 1 GB.** The map touches 8 of the archive's 64 segment row groups. Read in batches of 4,096 rows with only the leaf columns it needs, one thread for Arrow and one for OpenBLAS, it stays in the low hundreds of MB (MEASURED below). Pieces spill to disk by region, and each region is built alone.
- **Six places the contract can't be met as written, and two smaller asks**: "CONTRACT: changes", at the end. C8, the lakes, was found while building, and C4 was measured: 309 portal keys of the contract's form name two places.

## What the archive holds for the map (MEASURED)

Everything that touches the bounds, from the raw row groups:

| | Count | Notes |
|---|---|---|
| Segments | 56,327 | 55,779 road, 528 rail, 20 water. 5,130 km inside the bounds |
| Car classes | 2,554 km | residential 1,164, service 482, tertiary 233, secondary 224, primary 144, motorway 131, unclassified 84, track 39, trunk 33, unknown 18, living street 3 |
| Foot classes | 2,219 km | footway 1,961 (subclass: 7,661 sidewalks, 6,907 crossings), path 127, cycleway 70, steps 38, pedestrian 23 |
| Connectors | 85,932 | 85,321 name an OSM node (99.3 %). 75,207 references sit inside a segment, not at its end, so a segment is several edges |
| Road flags | 2,186 rules | is_link 721, is_bridge 663, is_covered 308, is_tunnel 291, is_indoor 147, is_under_construction 46, is_abandoned 10. 1,002 cover part of a segment only (`between`) |
| Levels | 1,252 rules | -4 to 5, 732 on part of a segment |
| One-way | 6,893 rules | `denied`, heading `backward`, no mode: 6,749 on the whole segment, 144 on part |
| Closed to cars | 383 road segments | motor vehicles denied and nothing allowing cars. 52 are Market Street's, buses allowed |
| Speed limits | 5,468 segments | 5,574 rules in mph, 4 in km/h, 259 on part |
| OSM ways a segment | | one: 44,518; two or more: 11,393, up to 48; none: 416 |
| Ferry routes | 20 | 107.7 km inside the bounds; whole, 2.8 to 45.4 km (Vallejo). Not one has an access rule, a speed, a flag or a time |
| Ferry terminals | 16 | 15 points (the Ferry Building's gates B to G, Pier 41's two gates, the Alcatraz landing at Pier 33, Pier 48.5, Oracle Park, Sausalito, Treasure Island, Alcatraz, Red & White Fleet) and one polygon, the Ferry Building, 9,900 m². The six gates have no name |
| Marinas | 9 | 48.5 ha, all named. One maps its berths: `capacity` 161 |
| Areas | | parks 347 (2,074 ha), dog parks 36, pedestrian areas 249 and plazas 18 (31 ha), beaches 47 (136 ha), piers 221 polygons (47.5 ha) and 1,153 lines, docks 2, land 27 polygons (the coastline) |
| Traffic signals | 2,248 | 75.0 % within 0.5 m of a connector, 86.3 % within 3 m |
| Stop signs | 4,710 | 24.3 % within 0.5 m of a connector, 99.0 % within 15 m: they sit on the approach |
| Aeroways | none | helipads only. OurAirports has heliports and closed fields inside the bounds, no airport |

Not in it: lanes (Overture's segments have no such column: the S3 footer lists 21 and none is lanes), roundabouts (no flag value says so), OSM's own tags on segments (`seasonal`, `oneway`), a cruise terminal (nothing in these types names one; buildings and places, items 1 and 5, weren't fetched), turn restrictions (`prohibited_transitions`, not fetched).

The map's region grid: 15 x 18 = 270 cells inside the bounds, 195 of them with tiles. The other 75 hold no tile because they're all water: the Pacific off Ocean Beach, the strait, the water north of the city and the Bay to the east. The region files are 25.5 MB gzipped, median 127 KB, largest 280 KB.

## What the bake makes

### Edges and nodes

Each segment is cut into edges at its connectors, wherever a flag, level, one-way, speed or OSM-way range starts or ends, at the map's bounds, and at every region line (x and z at multiples of 1,024 m). Then an edge has one value of everything and lies in one region.

| Overture | Kind | cls |
|---|---|---|
| road: motorway, trunk, primary, secondary, tertiary, residential, unclassified, living_street, service, track, unknown | ROAD | the RoadClass of that name (living_street: LIVING) |
| road: footway (subclass sidewalk: SIDEWALK; crosswalk: CROSSING; else FOOTWAY), path and bridleway (PATH), steps, cycleway, pedestrian | FOOT | FootClass |
| rail, every class | RAIL | 0 |
| water: all 20 are ferry routes | FERRY | 0 |
| nothing tonight | WATER | in-map ship lanes come with `lanes.bin`'s raster |

Left out, as the bridges spec leaves them out: is_indoor, is_under_construction, is_abandoned.

- **dir.** FORWARD where a `denied` rule with heading `backward`, and no mode or a car's, covers the edge. BACKWARD for heading `forward`. Else BOTH. FOOT edges are BOTH.
- **speed.** The rule with no `when`, else the first. mph x 1.609344, rounded. 0 where there's none.
- **level.** `level_rules` on the edge's range, else 0.
- **lanes.** 0 everywhere: no source.
- **flags.** BRIDGE (is_bridge). TUNNEL (is_tunnel, and is_covered: hidden under what covers it). LINK (subclass link, or is_link). UNDRAWN, below. ROUNDABOUT and SEASONAL never: no source. NO_CARS if C6 is Agreed.
- **UNDRAWN** where the ground bake left the segment out (`osm.py`, `segments()` ~353-368: any bridge, tunnel, indoor, covered or construction flag on it, or `level_max` not 0), unless the edge is TUNNEL or on a deck City draws. That's exactly what today's tiles don't draw, because `segments()` judged whole segments. Bridges step 4 (`between`) and step 5 (decks) give it back, and the flags clear with them.
- **Nodes.** A connector, or a cut. SIGNAL on a connector within 0.5 m of a traffic signal. STOP on the junction a stop sign faces, within 15 m along its edge. PORTAL on a cut at a region line, in both regions' files with one id. An edge the bounds cut ends on the bounds, and life knows the bounds from `city.json`.
- **Shapes.** Simplified to 0.25 m in plan, `osm.py`'s footprint tolerance. Then a point goes in wherever the straight line between two points misses the terrain grid by more than 0.5 m at any 4 m step. On San Francisco's hills a 100 m block can crest by metres between its corners, and life moves cars along those straight lines.

### Keys and ids (1.3)

| Thing | Key |
|---|---|
| A connector's node | its OSM node, `n65293476`; else its GERS id, as it is (the contract's "else Overture's GERS id") |
| A cut at a region line | the contract's form, its way and the line, `w31772645@x-7168.0`, where that names one place; where it names two or more, C4's below (built so: 309 keys named two places or more, MEASURED, C4) |
| Any other node: a cut at the bounds, at a range's end, a segment's end with no connector | its edge's OSM way and its own place in whole decimetres of the map, `w31772645@-71680,-22103` (C4: the contract has no form for these) |
| An edge | its OSM way and its piece, `w31772645#2`, the pieces counted from 0 along the way as it runs (from a node no piece of the way leads into, the smallest key first; a closed way from its smallest node key). An edge over two ways takes the one with more of its length. With no OSM way, the segment's GERS id and its piece, `<gers>#0` |
| An area | its element, `w453930841` or `r14551816`. OPEN_WATER, which has none: `water@<rx>,<rz>`, one a region |
| A ferry route | its OSM way, `w31772645` |
| A terminal, a marina | its OSM element. A terminal the bake makes at a route's end: that end's OSM node |
| An airport, a runway | its ICAO code, `KSFO`; `KSFO:28L` |

Ids: FNV-1a of the key into a range a kind (nodes, edges, areas, ferries, terminals, marinas, airports), probed in key order over the whole city, as `IdAlloc` does (`bake.py` ~994). Every id's key goes in `public/city/<slug>/gkeys.bin`, gzipped, with its kind, which the game never fetches: W2 compares two bakes' copies. A key is unique within its kind: one OSM element can be two kinds, a marina's area and the marina in `routes.bin` (20 keys on this map).

### Heights

| Point | y |
|---|---|
| On land | bilinear over its tile's 65 x 65 grid, as `tiles.ts` reads it: the baked heights, never `meshHeights` |
| On water: a FERRY point on a WATER texel, or in a tile or cell with no tile | `WATER_Y`, -0.6 |
| An area's vertex on the sea or the Bay: a WATER texel the grid holds at 2 m or under, or no tile | `WATER_Y` |
| An area's vertex on a lake: a WATER texel higher up | the grid, where the city draws the lake (C8) |
| On a deck City draws | that deck's top, once C2 is Agreed; the profile below until then. A stack's lower deck: 5.5 m a level under the top |
| On any other bridge, or above level 0 | `decks.py`, the bridges spec's rule (`BRIDGES.md`, "Height profile"), on the chain of edges it's in |
| In a tunnel | straight between the tunnel's two ends, which stand on the ground or a deck |
| An area's vertex | as land or water above |

The rule in `decks.py`: over water 1.5 m plus 4.5 % of the crossing's water length, 1.5 to 80 m; over land the ground, smoothed, plus 5.5 m a level; never down faster than 3 % (road), 2 % (rail) or 6 % (foot); a chain's ends on the ground where it meets ground edges. No LiDAR tonight: San Francisco's LiDAR rasters cover only the 128 m chunks that hold a building (`lidar.py`), so a deck over water isn't in them, and reading the decks' own points is a download. With no LiDAR the rule's error on San Francisco's decks is a median of 3.3 m, 87 % within 10 m (`BRIDGES.md`, SOURCE).

Piers stand in the grid: the city bake raised piers over the water to 2.5 m (`bake.py` ~1613-1621). So a FERRY edge ends on its berth's node at the pier's height, and the boat stops where its edge leaves the water.

### Areas

| AreaKind | From |
|---|---|
| PLAZA | land_use pedestrian and plaza; infrastructure pier polygons (piers are PLAZA, as in the class raster) |
| PARK | land_use park, dog_park, village_green. Not the protected areas: those are boundaries over land and water |
| BEACH | land sand, class beach |
| MARINA | land_use marina |
| FERRY_TERMINAL | infrastructure ferry_terminal polygons: the Ferry Building |
| CRUISE_TERMINAL, APRON | none on this map |
| OPEN_WATER | the sea and the Bay: the class raster's WATER texels the grid holds at 2 m or under, and every tile slot with no tile, region by region, as polygons (simplified 0.9 m, under half a texel). One area a region. Lakes aren't in it (C8). A cell with no tile is water whole (C1) |

Each is clipped to its region and cut into triangles on one terrain TIN a region (built so; the plan was a quadtree, which put the Presidio's region at 139.5 KB, over the budget, where the TIN made 90.4 KB at the same tolerance). The TIN starts from a 64 m lattice of the 4 m grid and takes the grid's points under the region's areas, and one step round them, greedily, the worst in each triangle past 0.4 m, until every one is within 0.4 m. Triangles inside an area are kept whole, those across its edge are cut to it, and a cut piece that misses a grid point by over 0.45 m puts that point into the TIN and the region is cut again. OPEN_WATER is flat at `WATER_Y`. Names come from Overture's `names.primary`.

### routes.bin

- **Ferries.** The 20 routes that touch the map, whole. `from` and `to`: the terminal within 150 m of each end. `seasonal`: false, with no source. Four of the 20 names say "(Seasonal)", and the contract rules the name out, so the game-day ferries run every day. `lengthM`: geodesic.
- **Terminals.** The archive's ferry_terminal elements at those ends, from the whole Bay (Larkspur's, Vallejo's and Oakland's are off the map). An end with none gets a terminal of its own, at its end node. `berthM`: the longest side over water of the pier it stands on, else 60 (ESTIMATE, a ferry slip).
- **Marinas.** The 9 on the map. `berths`: `capacity` where it's mapped, else the polygon's area over 450 m², Schoonmaker Point's own ratio (161 berths in 72,396 m²; an ESTIMATE everywhere else).
- **Airports.** OurAirports' scheduled service within 50 km of the origin: SFO (17.7 km), OAK (18.5), SQL (32.7), CCR (39.8). `elevM`: feet x 0.3048. Runways from `runways.csv`: open, both ends, width in feet x 0.3048, one entry a landing direction (`KSFO:28L`, its threshold first). No ODbL runways tonight: there are none on this map.

### city.json

- `"life": { "graph": 1, "routes": 1 }`, with `regions` if C1 is Agreed, and `stats`: the bake's counts (rules read, rules applied, edges by kind), as `stats` sits beside the city bake's output.
- PlaceInit's inputs: `"vdatum": "NAVD88"` (`docs/ARCHITECTURE.md`, "World conventions") and `"geoid": -32.24`, EGM96's N at the origin (MEASURED tonight from item 21, bilinear). Over the bounds N runs -32.46 to -32.12 m, so one number a place holds (O9). Life's worker draws no live plane under 1 km while its place has no N (`feat/life`, `src/life/lifeWorker.ts`, `NO_GEOID_FLOOR`).
- `__sbDataV` goes from osm3 to osm4 with the files (`docs/ARCHITECTURE.md`: every re-bake bumps it).

### Sizes (ESTIMATE)

About 145,000 edges and 100,000 nodes: 126,000 pieces between connectors (from the connectors on each segment), about 6,500 region cuts (5,130 km of lines on a 1 km grid), the rest at ranges. About 10 MB before gzip and 5 MB after: 20-30 KB a region on average, the busiest perhaps 80 KB, under the contract's 128 KB. `routes.bin`: tens of KB, under 256 KB. W1 measures both. MEASURED, built: 154,141 edges, 109,020 nodes, 10.83 MB raw and 5.10 MB gzipped, median 22.9 KB, largest 93.4 KB; `routes.bin` 6.1 KB ("Built").

## How it streams

Measured tonight on this laptop (8 GB, 620-980 MB free during the runs):

| Read | Peak working set | Peak private bytes |
|---|---|---|
| The survey: every segment row group of the Bay one at a time, whole, 15 columns, then the connectors and four base types, default threads | 531 MB | 837 MB |
| Every segment row group in batches of 8,192 rows, keeping the map's 56,327 segments as Python tuples | 543 MB | 944 MB |
| Batches of 4,096, leaf columns only (`names.primary`, three fields of `sources`), Arrow's system pool on one CPU and one IO thread, nothing kept | 118 MB | 352 MB |
| Importing numpy, shapely, pyproj and scipy, nothing else | 76 MB | 521 MB |
| The same with `OPENBLAS_NUM_THREADS=1` | 75 MB | 50 MB |
| The map's 56,327 segments kept as tuples, OpenBLAS on one thread | 366 MB | 364 MB |

The thread pools under numpy and scipy (OpenBLAS, OpenMP) take 470 MB of commit before any data is read. So the bake sets `OPENBLAS_NUM_THREADS=1` and `OMP_NUM_THREADS=1` before it imports numpy, and Arrow's one-thread settings, and it never holds a whole type. The city bake loads the same libraries and would save the same. The passes:

1. **Read**, streamed. Only the row groups whose footer statistics touch the map: 8 of 64 for segments (37.6 MB), 2 of 34 for connectors, 2 to 8 for each base type (MEASURED). Batches of 4,096 rows with only the leaf columns the graph reads. Each segment is cut into pieces as above, and each piece is appended to its region's spill file under `tools/bake/.cache/<slug>/graph/` (numpy, a few MB each). The connectors are two arrays, keys and places, 86,000 rows. Areas the same way, clipped to regions as they come.
2. **Global**, small. Every key sorted and given its id. The bridge chains and their profiles: 663 bridge rules in the map. The ferry routes whole, the terminals, the marinas and the airports.
3. **Region by region.** One region's spill and its tiles (`citydata.py` reads the packed `r_*.bin`): nodes merged by key, heights, shapes densified, areas cut, `g_<rx>_<rz>.bin` written gzipped. Nothing else is in memory.
4. **`routes.bin` and `city.json`.**

San Francisco alone would fit in memory (366 MB, above). The Bay's 974,750 segments, 17 times as many, would not, and pass 1 is the same code there. It runs at below-normal priority. ESTIMATE: a few minutes. Built so, and MEASURED: one region alone in 25 to 37 s, peak 220 MB working set; the whole map in 236 s, peak 435 MB working set and 507 MB private, with the spills (19.6 MB, pickled lists, not numpy) deleted at the end. Pass 2 holds every key and the decks whole, so the Bay's would be about 17 times pass 2's 150 MB: that pass would need its keys spilled too (not built, not measured).

## The parser life reads

`src/world/lifeData.ts`, the world's (CONTRACT section 0). Worker-safe: no three.js and no DOM, only typed arrays, `DataView` and `TextDecoder`, which Safari 15's workers have. The contract's types as written. `parseRegionGraph(buf)` and `parseCityRoutes(buf)` (with `origin` once C5 is Agreed) take an inflated buffer (`gunzip.ts` inflates it in the worker) and give null for a magic they don't know, a major version they can't read or a file cut short: never a throw into life. A parse makes the arrays it returns, and nothing per element but the names. Nothing runs per frame. The const enums compile as the repo's eleven others do (`isolatedModules`). W1 bundles the file with rolldown, as `tools/moon/run.mjs` does, because Node's own type stripping refuses enums.

The byte layout is written once, at the top of the parser, as `tiles.ts` does for the tiles. In outline, all little-endian, each section column by column:

```
g_<rx>_<rz>.bin, gzip of:
  'SBG1', u16 version, u16 minor, i32 rx, rz, f32 baseY; u32 counts: nodes, edges, points, areas, area vertices, area triangles, names
  nodes   u32 id, i16 x, z (dm from the region's corner, rx * 1024, rz * 1024), i16 y (dm over baseY), u8 flags
  edges   u32 id, u16 a, b (u32 past 65,535 nodes), u8 kind, cls, dir, lanes, speed, i8 level, u16 flags, u32 shape[n + 1]
  points  i16 x, z, y, delta-coded (built so: each less the one before, modulo 2^16)
  areas   u32 id, u8 kind, u16 name, u32 tri[n + 1]; vertices i16 x, z, y, delta-coded; triangles u16 (u32 past 65,535) x 3, delta-coded
  names   u8 length, utf-8
routes.bin, gzip of: magic (C7), u16 version, then ferries, terminals, marinas and airports, each a u32 count and its rows;
  latitudes and longitudes i32 at 1e-7 degree, strings a length and utf-8
```

The parser expands the areas into the contract's triangles of 9 floats. The layout as built is the one at the top of `lifeData.ts`; `gkeys.bin` is `graphs.py`'s `write_keys`.

Then, in the same file and small: PlaceInit, `makePlaceFrame` and `weatherAt`, with W3 (sections 1.1 and 4). Life's worker places its live planes with `latLonToLocal` and keeps its own `CLEAR` while it waits for them (`feat/life`, `src/life/lifeWorker.ts`, `src/life/weather.ts`).

## W1: tools/world/graph-check.mjs

`node tools/world/graph-check.mjs sf`, in Node, so it runs on the cloud machine too. It reads `city.json`, parses every graph file and `routes.bin` with the shipped parser, and reads the tiles' heights and classes with `tiles.ts`'s own parser from the `r_*.bin` files, one region at a time. It prints each count beside its limit and exits 1 on any failure.

| Invariant (1.2) | What W1 counts | Fails at |
|---|---|---|
| Every file parses with the shipped parser | files parsed, by version; bytes gzipped against 128 KB and 256 KB | any |
| Every edge's two nodes exist | edges whose a or b isn't a node; points more than 0.1 m outside their region | 1 |
| A node where an edge leaves its region is a PORTAL, with the same id next door | portals; portals with no twin; twins more than 1 cm apart; nodes on a region line that aren't PORTAL; edges across a line | 1 |
| Ids | an id twice in one city but a portal's twin or an area's part in another region; a key with two ids within its kind | 1 |
| Direction as mapped, BOTH where nothing says | edges by dir and class; one-way rules read against edges made one-way, from `life.stats` | the two differ |
| TUNNEL and UNDRAWN apart | tunnel edges that are also UNDRAWN; UNDRAWN km by class (motorways should come near the audit's 68 %, SOURCE) | 1 tunnel |
| A land node within 0.5 m of the tile's grid | land nodes, points, and every 4 m along every land edge, against the 65 x 65 grid, bilinear; the worst and where | 1 over 0.5 m |
| A water node at `WATER_Y` | water nodes and points off -0.6 by over 1 mm | 1 |
| A deck's top from the graph's data, decks told apart by level | deck points within 15 m of a landmark deck's line against its top: median and worst (within 0.3 m once C2 is Agreed); deck points within 3 m of a higher level on another structure (no chain of deck edges joins them in the region) where the higher isn't 0.1 m higher. Pairs on one structure are its ramps between levels, counted and not checked | C2's gate; 1 inversion |
| FERRY and WATER edges on water, but their last 150 m, which ends on a terminal, berth or port area | every 10 m along them against the class raster at 2 m (no tile: water); ends not on a terminal, a berth or PLAZA | 1 |
| The same past the map | `routes.bin`'s ferries every 10 m against Overture's land polygons along them, in a file the bake writes (C3); until then "past the map: not checked" | 1 |
| Areas | the grid's points inside each area against its triangles (`WATER_Y` on the sea, the grid elsewhere, a lake too); OPEN_WATER's texel centres off the sea, its vertices off `WATER_Y` | 1 over 0.5 m; 1 |
| Places may be named; nothing names a person or a vessel | every name in the files, printed once for a person to read: W1 can't tell a person's name by itself | none |

The 4 m test along edges asks more than the contract, which asks it of nodes. It's what a car on a hill needs.

## The order

1. `graphs.py`, passes 1 and 2: the cuts, the keys and ids, `routes.bin`. Its report prints the archive table above, so this file and the bake agree or the report says where they don't.
2. `decks.py` and the heights, the areas, pass 3, `city.json`.
3. `lifeData.ts`: the types and both parsers.
4. W1, then the bake fixed until W1 passes. Its numbers go in `DECISIONS.md` and here.
5. Commit and push to `feat/world`, and a line in `docs/TODO.md` on `feat/earth` saying what life can read.
6. Next: PlaceInit, `makePlaceFrame`, `weatherAt` and W3.

ESTIMATE: about a day of agent time for steps 1 to 4. Nothing here changes what a player sees, so there's nothing for the producer to fly until life reads it.

## Built (2026-11-05, `feat/world`)

Steps 1 to 4 and the files, in 6d98b0f (the bake), 7996b4e (the parser), efd827d (W1) and dc26629 (San Francisco's files). Step 5's line in `docs/TODO.md` on `feat/earth` isn't written: this account pushed `feat/world` only. Everything below is MEASURED from the bake's report and W1 on this laptop, with other jobs running.

**The files**, where the contract puts them, in `public/city/sf/`: 195 `g_<rx>_<rz>.bin`, one for each region in `city.json`, 5.10 MB gzipped (10.83 MB raw), median 22.9 KB, largest 93.4 KB at (-5, 0), Golden Gate Park's east (the contract's 128 KB). `routes.bin`, 6.1 KB (256 KB). `gkeys.bin`, 2.6 MB, 264,235 keys, never fetched. `city.json` gains `life`, `vdatum` (NAVD88, from the city's 3DEP heights), `geoid` -32.24 and `geoidSpread` [-32.46, -32.12], and keeps every other key as it was. `__sbDataV` is osm4.

**What's in them.** 154,141 edges: road 64,304 (residential 25,649, service 16,128, tertiary 7,384, secondary 7,033, primary 3,966, unclassified 1,529, motorway 957, trunk 797, unknown 528, track 277, living 56), foot 84,884 (footway 44,056, crossing 17,971, sidewalk 16,280, steps 2,774, path 1,857, cycleway 1,479, pedestrian 467), rail 4,898, ferry 55. 109,020 nodes, 5,657 of them portals (in two files each), 1,695 SIGNAL (75 % of the 2,250 signals in the map lie within 0.5 m of a connector, as the survey said) and 4,213 STOP (4,545 of 4,713 stop signs placed). 116,657 inner points. 1,234 areas (their parts a region): PARK 515, PLAZA 538, BEACH 77, MARINA 13, FERRY_TERMINAL 1, OPEN_WATER 90, in 587,188 triangles. Dropped: 386 pieces indoor, under construction or abandoned; 121 ferry pieces and 4 foot pieces in cells with no tile (C1). One-way: 6,884 rules read (144 on part of a segment), 18,680 edges made one-way (18,672 FORWARD, 8 BACKWARD). Speed limits: 5,570 rules on 5,461 segments. UNDRAWN: 77.7 of 129.8 km of motorway (60 %, the audit's 68 % was of surface), 75.8 km of rail. `routes.bin`: 20 ferries, 22 terminals (every end found one within 150 m: none made), 9 marinas (1 with its berths mapped), KSFO, KOAK, KSQL and KCCR.

**The archive table, against the bake.** Its kilometres by class match the survey's within 2 % (residential 1,162.3 against 1,164, footway 1,957.9 against 1,961: the dropped pieces). 56,145 segments keep a piece, where 56,327 touch the bounds: the rest lie wholly in cells with no tile, or are left out. Connectors: 85,936 within the bounds and a metre, 85,324 with an OSM node. Areas the same as the survey's. Two counts differ by definition: 692 bridge flags here against the survey's 663 rules, and 289 road segments closed to cars by this bake's narrower rule (a whole-segment denial with no heading or condition) against 383.

**The bake.** `python -I tools/bake/graphs.py sf <archive>`: 236 s, peak 435 MB working set and 507 MB private, at below-normal priority, one thread for Arrow and OpenBLAS. One region alone (`--region=-6,-3`): 25 s, 220 MB.

**W1**, `node tools/world/graph-check.mjs sf`: passed, exit 0. Every file parses (195 of 195). No place more than 0.1 m outside its region, no edge across a line. 11,314 portal nodes, every one with its twin, 0 cm apart. No id twice, no key with two ids within its kind. Node keys: 85,031 OSM nodes, 611 GERS ids, 5,096 portals in the contract's form, 18,282 in C4's. Land: 112,972 nodes and 1,187,571 steps of 4 m or less, worst 0.447 m. Water: 231 nodes and points, exact. Decks against the drawn decks (C2, printed): 4,464 samples within 15 m, median 9.4 m off, 90th 21.9 m, worst 37.1 m, the profile 8.2 m low on average. Stacked: 372 pairs across structures, 0 inversions; 580 pairs on one structure's ramps, not checked. Ferries: 2,731 samples, none on land. Areas: 2,908,380 grid points inside their triangles, worst 0.463 m. OPEN_WATER: 49,758 triangles, 11.0 million texel centres, none off the sea. Names: 443, read by a person tonight: places only, some named after people, none a person or a vessel. On three broken copies it exits 1: a region's nodes 2 m up fails the land and the portal checks, a portal's flag cleared fails the portals, a file cut short fails its parse.

**Where the build left the plan**, each also said in place above:
- Areas on one terrain TIN a region, not a quadtree: the quadtree put the Presidio's region at 139.5 KB.
- Points, area vertices and triangles are delta-coded in the files, which took Golden Gate Park's region from 126 to 93 KB. The parsed shapes are the contract's.
- Draped every metre and at every grid line, not every 4 m: a 4 m step over a bump hid a 0.88 m miss, a 2 m one a 0.84 m miss across a bend in the grid.
- Water for heights is the sea: a WATER texel the grid holds at 2 m or under, or no tile. Lakes take the grid, where the city draws them (C8). OPEN_WATER is the sea alone.
- Decks keep their levels apart where two structures cross (`decks.py`, `Stacked`): a level-2 footbridge came down its steps' free end under a level-1 road.
- Node keys: C4's for the nodes the contract can't key (C4, below).
- A connector with no OSM node keys on its GERS id as it is, and an edge with no OSM way on its segment's GERS id and its piece.

## Left for later

- **Places and buildings** (items 5 and 1, waiting on the producer's OK of their sizes): a cruise terminal at Pier 27 (nothing in tonight's types names one, so life's "one cruise ship at Pier 27" has no terminal yet), and better names and outlines for terminals and marinas.
- **The Bay beyond the city** (O10, the world's call by stage 1's first week): San Francisco's map grown, or maps for Oakland and Marin. Either needs city tiles there first (any-city, `VERDICT.md` step 4; GLO-30 and WorldCover are in the archive). The graph bake is the same code on any map.
- **The ocean lanes**, `lanes.bin` and W4, from the World Bank's commercial layer (item 15, still zipped, 480 MB), with in-map WATER edges from the same raster.
- **`airports.bin`** for the planet (O11): every airport with scheduled service in OurAirports.
- **The coastline**, item 20: a retry, for W4.
- **LiDAR on decks**: a download of the decks' own points, so the profile is LiDAR's wherever it can be.
- **W2** once a second bake exists; **W5** with City's `onRegion`.
- **Freeway surfaces** (bridges steps 4 and 5): as each is drawn, its edges lose UNDRAWN.
- **Lakes as OPEN_WATER**, at the grid's height, once C8 is Agreed.
- **The Bay's pass 2**: its keys spilled too, since it would hold 17 times San Francisco's 264,235.

## CONTRACT: changes

For the second account. Each is Proposed until it marks it Agreed, and then goes into `CONTRACT.md` in a commit whose message starts `CONTRACT:` (section 8). Until then the bake does what the contract says, as each item says.

The five it can't meet as written:

- **C1. Graphs where City has no tile** (1.2, the files; 1.4). As written, a graph file sits on City's region grid and life finds the files through `city.json`'s `regions`, which lists only the 195 regions with tiles. 75 of the 270 cells inside the bounds have none, and they're the open water: the ferries to Marin and the East Bay cross them on their way off the map, and the sailboats would sail there (read off the region grid, not measured route by route). Proposed: a graph file in every cell inside the bounds with anything in it. A cell with no tile holds OPEN_WATER whole, at `WATER_Y`, and the ferry edges across it. `city.json` lists them, `"life": { "graph": 1, "routes": 1, "regions": [[rx, rz, bytes], ...] }`, and life reads that in place of `regions`. Old readers skip the key. Until Agreed: files only where City has a region, ferries whole from `routes.bin`, no OPEN_WATER in those 75 cells. Built so: 121 ferry pieces and 4 foot pieces fell in those cells and are in no file, 35 nodes end on a line to one (W1 counts them), and `routes.bin` has all 20 routes whole.
- **C2. Decks City draws** (1.2, the heights). As written, a deck's y comes from the graph's own data, San Francisco's landmark decks are only a check, and y is what a mover stands on. On a drawn deck those disagree. With no LiDAR, the rule puts the Golden Gate at 74 m and the Bay Bridge at 73 m (`BRIDGES.md`), where their drawn decks rise from 57 to 77 m and from 29 to 79 m (`city.json`), so cars would hover over or sink into the two bridges the opening shows. Proposed: an edge on a deck City draws takes that deck's top, within 0.3 m (W1), and every other deck takes the profile. Today the drawn decks are San Francisco's two landmark rows. From bridges step 5 they're `bridges.bin`'s, made by the same `decks.py`, so the two agree by construction. It's no San Francisco code: it's whatever a city draws. The pick this plan started from, "decks from the landmarks", is this change. Until Agreed: the profile everywhere, and W1 prints the gap on the two bridges. Built so: 4,464 deck samples within 15 m of the drawn decks miss their top by a median 9.4 m, 90th percentile 21.9 m, worst 37.1 m, the profile 8.2 m low on average.
- **C3. The coastline past the map** (1.2; W4). As written, past a map the check is against OSM's land polygons, a download. Item 20 didn't come: its host refused the connection (`DOWNLOADS.md`). Overture's `land` rows of class land, in the same archive, are made from OSM's coastline (their source is OpenStreetMap with no element named, MEASURED; 27 polygons inside the bounds), and the city bake already takes the sea from them (`osm.py`, `water()`). Proposed: inside an Overture extract's box, W1 checks the ferries past the map against those. W4 keeps item 20 for the oceans. Until Agreed: W1 checks the ferries inside the map only, and says so. Built so.
- **C4. Keys for nodes with no connector** (1.3). As written, a PORTAL keys on its way and the region line, `w31772645@x-7168.0`. A piece with no junction can cross one line twice (a winding road), and then two portals share a key, which W2 can't tell apart. A cut where a range ends, such as a bridge starting inside a segment, has no key form at all. MEASURED on San Francisco's map tonight: the contract's key names two places or more for 309 keys, 659 nodes (ways that cross one line twice or run along it). With one key a way's two crossings would be one node, an edge jumping between them. And 17,623 nodes have no form at all: cuts at the bounds, at a range's end and at segment ends with no connector. Proposed: every node with no connector keys on its edge's OSM way and its own place in whole decimetres of the map, `w31772645@-71680,-22103`. **Built so for the nodes the contract can't key, and only those**: a portal keys by the contract's form wherever that names one place (5,096 nodes), by this one where it names more, and every node with no form by this one. Ids are opaque to life (1.3: nothing saved or shared keys on them), so another form changes only `gkeys.bin` and those nodes' ids, at the next bake. OPEN_WATER has no source key either (it's the class raster's): `water@<rx>,<rz>`, one area a region.
- **C5. Map metres from the routes parser** (1.2). As written, the files table says the parser also gives map metres, and `CityRoutes` has no field for them. Proposed: `parseCityRoutes(buf, origin)` adds `xz: Float32Array` to each ferry, and `x` and `z` to each terminal, marina, airport and runway end, from `geo.ts`. Old readers skip them. Until Agreed, built so: `parseCityRoutes(buf)`, degrees only, as `CityRoutes` is written.

And one found while building:

- **C8. Lakes stand where the city draws them** (1.2, the water's surface). As written, the water's surface is `WATER_Y` on every map today. On San Francisco's map that holds for the sea and the Bay: of the 4.11 million WATER texels on its tiles, 3.59 million sit at 0.5 m or under in the grid (2.73 million under -0.3 m), and the plane draws them at -0.6 m. It doesn't hold for its lakes: 334,000 WATER texels sit 5 to 200 m up the grid (Lake Merced, Golden Gate Park's lakes), and the ground mesh draws them there, on the ground (`tiles.ts`, `meshHeights`). Between 2 and 5 m there are only 8,727 (MEASURED, every texel centre of every tile, bilinear over the grid). An area at `WATER_Y` on a lake would stand tens of metres under the water drawn there. Proposed: a WATER texel the grid holds more than 2 m up is a lake, and a lake is OPEN_WATER at the grid's height, the level the city already draws it at, so "when lakes get their own level" is today, from the grid. Until Agreed: OPEN_WATER is the sea and the Bay alone (WATER texels at 2 m or under, and tile slots and cells with no tile), flat at `WATER_Y`. Lakes have no OPEN_WATER, and any other area over a lake takes the grid there, as land does. No FERRY or WATER edge is on a lake on this map.

Two smaller asks:

- **C6. Roads closed to cars** (1.2, `EdgeFlag`). An addition: `NO_CARS: 64`, on an edge where a whole-edge rule denies motor vehicles and none allows cars (buses and taxis aside). That's 383 road segments inside the bounds, 52 of them Market Street's car-free blocks (MEASURED). Without it life's grey cars drive down Market Street. A minor version. Until Agreed, built so: no flag. The bake counts 289 road segments a whole-segment rule closes to motor vehicles with no heading or condition, a narrower reading than the 383 above.
- **C7. Two magics already taken** (1.2). `routes.bin`'s `SBR1` is the region bundles' and `far16.bin`'s (`pack.py`, `farmap.py`), and `lanes.bin`'s `SBL1` is `lamps.bin`'s (`lamps.py`). Each parser checks its magic first, so a file handed to the wrong one would pass. Proposed: `routes.bin` `SBC1`, `lanes.bin` `SBS1`. Until Agreed, built so: `routes.bin` is `SBR1`, as written.

Readings, where the contract leaves it open (the second account says if it reads them otherwise):

- `edges.a` and `b` are indices into the region's own `nodes`, not ids.
- `lanes` is 0 everywhere, ROUNDABOUT and SEASONAL are never set, and `seasonal` is false on every route: there's no source for any of them (above).
- `level` is Overture's `level_rules`, by range: its segments keep no OSM `layer`.
- TUNNEL covers is_covered too. A node that only tunnel edges touch is under ground: its y runs straight between the tunnel's ends, and W1 counts it apart from land nodes.
- A FERRY edge's points on water are at `WATER_Y`, and its end on the berth is at the grid's height, 2.5 m on a pier.
- An edge with no OSM way keys on its segment's GERS id and its piece, `<gers>#0`: the contract's "else Overture's GERS id", with the piece as an OSM way has it, since one segment is several edges.
- An area across a region line is in each region's file, cut to it, with one id: W1 counts an area's parts apart from ids twice.
- OPEN_WATER is one area a region, its key `water@<rx>,<rz>`.
- FOOT edges are BOTH; RAIL takes the access rules as roads do (none makes a rail edge one-way on this map).

## Not checked

- Nothing reads the files yet but W1, in Node. Life's worker doesn't, nothing ran in a browser, a worker or Safari, and `iosfloor` parsed the parser alone (no chunk of the build holds it). Whether life stitches the portals as W1 finds them is life's to test.
- That Overture keeps an OSM way's direction in its segment, which the one-way rules' `backward` reads against. W1 compares the rules with the edges, not with the streets.
- The client changes a few of San Francisco's class texels at load: under the hidden stand-ins over water, SIDEWALK becomes WATER (`towerStyles.ts`, `clearStandInGround`). W1 reads the files as baked, not as drawn there.
- The deck rule's error is `BRIDGES.md`'s, measured on the drawn decks' LiDAR, not on the graph's edges. Its crossings are measured inside the map only, so a deck that leaves it (the Bay Bridge's east span, at x 5,632) reads a shorter crossing and stands lower than the rule would put it.
- The 450 m² a berth rests on one marina. The 60 m slip is a guess. A terminal's `berthM` is the long side of the smallest rectangle round a pier within 30 m of it; "over water" isn't checked.
- A stop sign's junction is the end it faces by OSM's `direction` where the sign has one, else the nearer; how many have one wasn't counted.
- Whether life wants RAIL edges at all: trains are "Later" in `LIVING.md`.
- Memory was measured on San Francisco's bake. The Bay's pass 2 would hold 17 times its keys: not built, not measured.
