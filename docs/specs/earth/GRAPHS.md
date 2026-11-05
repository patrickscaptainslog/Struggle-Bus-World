# GRAPHS: the world's first graphs for life

What the world builds first for life's stage 1, and how: San Francisco's graphs from the Bay archive, in the contract's files, the parser life reads, and W1. Built to `CONTRACT.md` 0.8, where the second account Agreed this plan's C1 to C7 (0.6), C8 (0.7) and C9 (0.8), its section 10. C10, at the end, is Proposed (`CONTRACT.md` section 8) and isn't built on. Where the ground and the decks disagree, three calls are the studio's ("Where the ground wins"), and W1 counts what each leaves.

**State.** 2026-11-05, the first account, on `feat/world`, with `feat/earth` merged in at e8c44a7 (77d212c: the contract signed by both, main's 6b494b7), then at bf83487 and 0024ef1 (80e6a39 and 255beec: the contract at 0.7 and 0.8, the second account's two readings of the graphs). The third bake built C8, fixed N1 and W1's four residuals, and W1 passes ("C8, N1 and the four residuals", below). Planned, then built the same night: steps 1 to 4 of the order and San Francisco's files ("Built", below). Where the build left the plan, the plan's text says so in place. Facts are marked as `LIVING.md` marks them. MEASURED here means read tonight from the archive (`bay-2026-10-21`, read only) or from the repo, with throwaway scripts that read one row group at a time. They aren't in the repo. The bake's own report prints the same counts.

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
| Any other node: a cut at a region line (a portal), at the bounds, at a range's end, a segment's end with no connector | its edge's OSM way and its own place in whole decimetres of the map, `w31772645@-71680,-22103` (C4, 0.6). Cuts with no connector under 10 cm apart are one node, since they'd share a key. The 0.5 bake keyed portals on their line, `w31772645@x-7168.0`, where that named one place: 309 such keys named two places or more (MEASURED) |
| An edge | its OSM way and its piece, `w31772645#2`, the pieces counted from 0 along the way as it runs (from a node no piece of the way leads into, the smallest key first; a closed way from its smallest node key). An edge over two ways takes the one with more of its length. With no OSM way, the segment's GERS id and its piece, `<gers>#0` |
| An area | its element, `w453930841` or `r14551816`. OPEN_WATER, which has none: `water@<rx>,<rz>`, one a region |
| A ferry route | its OSM way, `w31772645` |
| A terminal, a marina | its OSM element. A terminal the bake makes at a route's end: that end's OSM node |
| An airport, a runway | its ICAO code, `KSFO`; `KSFO:28L` |

Ids: FNV-1a of the key into a range a kind (nodes, edges, areas, ferries, terminals, marinas, airports), probed in key order over the whole city, as `IdAlloc` does (`bake.py` ~994). Every id's key goes in `tools/world/data/<slug>/gkeys.bin`, gzipped, with its kind: in the repo for W2 to compare two bakes' copies from git, and not in `public/`, so no preview deploys it (the game never fetches it). A key is unique within its kind: one OSM element can be two kinds, a marina's area and the marina in `routes.bin` (20 keys on this map).

### Heights

| Point | y |
|---|---|
| On land | bilinear over its tile's 65 x 65 grid, as `tiles.ts` reads it: the baked heights, never `meshHeights` |
| On the ground over the sea: a road or footway point on a WATER texel the grid holds at 2 m or under | the grid, but never under `WATER_Y` (`stand()`): footways out to the ferries' gates and onto docks stood 0.5 m under the drawn water. With no tile, `WATER_Y` |
| On water: a FERRY point on a WATER texel, or in a tile or cell with no tile | `WATER_Y`, -0.6, on the sea; on a lake, a WATER texel the grid holds over 2 m, the grid (C8: each water edge carries its lake's height; none on this map) |
| An area's vertex | as a node on the ground stands (`stand()`): the grid, never under `WATER_Y`, which also keeps a pier's plaza from sloping into the sea at its edge. The sea's OPEN_WATER is flat at `WATER_Y` |
| An area's vertex on a lake: a WATER texel higher up | the grid, where the city draws the lake (C8), a lake's own OPEN_WATER included |
| An area on a roof or a deck (OSM's `level` over 0, else `location=roof` or `bridge`, else Overture's `level` over 0) | left out: the bake has no buildings to stand it on (item 1), and the street under it is the wrong place. Salesforce Park stood at street level, 21 m under its roof |
| On a deck City draws (C2, 0.6): within 22 m of its line, between its ends, heading within 30 degrees of it | that deck's top, up to a sample just inside each of its ends. A lower level 5.5 m a level under the highest level along it: the Bay Bridge's eastbound deck, level 1, 5.5 m under the westbound top, level 2. A piece whose foot (its structure's end, where a ground way meets it) stands beside the deck more than 44 m inside its ends is a ramp down to the street, not on it; a foot by an end is where the deck meets the ground, and the piece takes the top to there |
| A ground way meeting a drawn deck mid-span (two pieces of the deck go on through the node) | the deck's top: the way climbs to it in its first segment ("Where the ground wins", 3) |
| A sidewalk or path on a bridge within 15 m of a road's deck, at its level and heading with it | that road deck's height, but never under the ground on land ("Where the ground wins", 2): profiled apart, the Golden Gate's walkers stood up to 41 m under its cars. Against every road deck as placed, its own structure's and later ones' too (a second pass, `ride()`); a foot on the ground stays on it ("Where the ground wins", 1) |
| On any other bridge, or above level 0 | `decks.py`, the bridges spec's rule (`BRIDGES.md`, "Height profile"), on the chain of edges it's in, from any fixed heights above; over water from the water's own surface (a lake's grid, the sea's 0); on land never under the ground, at its samples and every metre and grid line between them (`lift()`) |
| In a tunnel | straight between the tunnel's two ends, which stand on the ground or a deck, but never over the ground or the bed, and 5.5 m a level under it away from its ends, going down at a road's 6 %, a railway's 3.5 % or, on foot, a stair's 50 % (`decks.under()`, `GRADE_STAIR`) |

The rule in `decks.py`: over water 1.5 m plus 4.5 % of the crossing's water length, 1.5 to 80 m; over land the ground, smoothed, plus 5.5 m a level; never down faster than 3 % (road), 2 % (rail) or 6 % (foot); a chain's ends on the ground where it meets ground edges. No LiDAR tonight: San Francisco's LiDAR rasters cover only the 128 m chunks that hold a building (`lidar.py`), so a deck over water isn't in them, and reading the decks' own points is a download. With no LiDAR the rule's error on San Francisco's decks is a median of 3.3 m, 87 % within 10 m (`BRIDGES.md`, SOURCE).

Piers stand in the grid: the city bake raised piers over the water to 2.5 m (`bake.py` ~1613-1621). So a FERRY edge ends on its berth's node at the pier's height, and the boat stops where its edge leaves the water.

### Where the ground wins (the studio's call)

Three places where the map's own data and the ground disagree about a deck, and no rule can satisfy both. Each was one of W1's four residuals, or what was left of one once the bake's own faults under it were fixed (below, "C8, N1 and the four residuals"). The picks are the studio's, for the second account and the producer to overrule; W1 counts what each leaves as a known exception, with its worst, and fails on anything past it.

1. **A deck's foot on the ground stands on the ground.** A sidewalk piece whose end meets a ground way stands there on the ground, while the rest of it rides its road deck. Where its road is still up at that point, the sidewalk drops at its last sample: at the Golden Gate's north anchorage the east path's foot is 5.5 m under the drawn top 9 m away, and on a bridge over a freeway OSM ends a sidewalk's bridge pieces where untagged sidewalk continues across the bridge, so its feet are on the trench floor 9.5 m under it. The other picks: the foot rides the road too, and the ground way meeting it climbs 5 to 10 m in its first segment (the cliff moves onto the street, where every walker that comes along takes it); or the sidewalk follows its feet and sags under its bridge (the 0.5 bake's Golden Gate walkers, 41 m under its cars). W1: "at their own feet on the ground".
2. **Never under the ground.** A sidewalk riding a road deck stands on its own ground where that's higher than the road: on Yerba Buena Island the cycleway's ground is 2.2 m over the motorway's ramp 12 m away, and on a hillside interchange a footway's is up to 4.2 m over the ramp beside it. The other pick: it rides the ramp and walks inside the hill, which life would draw buried. W1: "held by the ground over their road".
3. **A drawn deck wins mid-span.** Where a ground way meets a deck City draws at a node the deck goes on through (two of its pieces meet there), the node stands on the deck's top and the way climbs to it in its first segment. At the Golden Gate's north tower a footway joins the east path 23 m over the ground. The other picks: the deck dives to the ground there and back up (the path's walkers through a 23 m spike within 8 m, as b5e3d70's bake had it); or the way is cut from the bridge, a junction the map has dropped and a dead end left on the street. W1: "where a drawn deck wins". Only drawn decks: on any other deck the ground way's node is the deck's foot, as 1 has it.

### Areas

| AreaKind | From |
|---|---|
| PLAZA | land_use pedestrian and plaza; infrastructure pier polygons (piers are PLAZA, as in the class raster) |
| PARK | land_use park, dog_park, village_green. Not the protected areas: those are boundaries over land and water |
| BEACH | land sand, class beach |
| MARINA | land_use marina |
| FERRY_TERMINAL | infrastructure ferry_terminal polygons: the Ferry Building |
| CRUISE_TERMINAL, APRON | none on this map |
| OPEN_WATER | the sea and the Bay: the class raster's WATER texels the grid holds at 2 m or under, and every tile slot with no tile, region by region, as polygons (simplified 0.9 m, under half a texel), flat at `WATER_Y`. One area a region, `water@<rx>,<rz>`. A cell with no tile is water whole (C1). And the lakes (C8): each 4-connected run of WATER texels the grid holds over 2 m, joined across region lines, is one lake, keyed on its first texel's centre in whole decimetres, the northernmost row's westernmost (Lake Merced's is `lake@-72230,54150`, at 5.6 to 6.1 m), with no name; its part in each region is cut to it with the one id and stands on the TIN as any area does, at the grid's height |

Each is clipped to its region and cut into triangles on one terrain TIN a region (built so; the plan was a quadtree, which put the Presidio's region at 139.5 KB, over the budget, where the TIN made 90.4 KB at the same tolerance). The TIN starts from a 64 m lattice of the 4 m grid and takes the grid's points under the region's areas, and one step round them, greedily, the worst in each triangle past 0.4 m, until every one is within 0.4 m. Triangles inside an area are kept whole, those across its edge are cut to it, and a cut piece that misses a grid point by over 0.45 m puts that point into the TIN and the region is cut again. OPEN_WATER is flat at `WATER_Y`. Names come from Overture's `names.primary`.

### routes.bin

- **Ferries.** The 20 routes that touch the map, whole. `from` and `to`: the terminal within 150 m of each end. `seasonal`: false, with no source. Four of the 20 names say "(Seasonal)", and the contract rules the name out, so the game-day ferries run every day. `lengthM`: geodesic.
- **Terminals.** The archive's ferry_terminal elements at those ends, from the whole Bay (Larkspur's, Vallejo's and Oakland's are off the map). An end with none gets a terminal of its own, at its end node. `berthM`: the longest side over water of the pier it stands on, else 60 (ESTIMATE, a ferry slip).
- **Marinas.** The 9 on the map. `berths`: `capacity` where it's mapped, else the polygon's area over 450 m², Schoonmaker Point's own ratio (161 berths in 72,396 m²; an ESTIMATE everywhere else).
- **Airports.** OurAirports' scheduled service within 50 km of the origin: SFO (17.7 km), OAK (18.5), SQL (32.7), CCR (39.8). `elevM`: feet x 0.3048. Runways from `runways.csv`: open, both ends, width in feet x 0.3048, one entry a landing direction (`KSFO:28L`, its threshold first). No ODbL runways tonight: there are none on this map.

### city.json

- `"life": { "graph": 1, "routes": 1, "regions": [[rx, rz, bytes], ...] }` (C1: every file, the open water's included), and `stats`: the bake's counts (rules read, rules applied, edges by kind, NO_CARS), as `stats` sits beside the city bake's output.
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

`src/world/lifeData.ts`, the world's (CONTRACT section 0). Worker-safe: no three.js and no DOM, only typed arrays, `DataView` and `TextDecoder`, which Safari 15's workers have. The contract's types as written, with C5's map metres and C9's `minor` (Agreed, 0.8: 1.1 sets NO_CARS, 1.2 has the lakes as OPEN_WATER, C8). `parseRegionGraph(buf, regionM)` and `parseCityRoutes(buf, origin)` take an inflated buffer (`gunzip.ts` inflates it in the worker), the region's side (city.json's `regionSize` x `tileSize`, 1,024 m by default) and the city's origin, and give null for a magic they don't know, a major version they can't read, a file cut short or with bytes left over, an area's triangle starts that go back (the review's N2), a name past the names, or a count the bytes left can't hold, checked before anything is made from it (N1: a route's corrupt point count asked for up to 2^32 eight-byte values a column): never a throw into life. A parse makes the arrays it returns, and nothing per element but the names and a pair a place for the routes' map metres (`geo.ts`'s `latLonToLocal`). Nothing runs per frame. The const enums compile as the repo's eleven others do (`isolatedModules`). W1 bundles the file with rolldown, as `tools/moon/run.mjs` does, because Node's own type stripping refuses enums.

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

`node tools/world/graph-check.mjs sf`, in Node, so it runs on the cloud machine too. It reads `city.json`, parses every graph file in `life.regions` and `routes.bin` with the shipped parser, and reads the tiles' heights and classes with `tiles.ts`'s own parser from the `r_*.bin` files, one region at a time. From `tools/world/data/<slug>/`, in the repo and never on the site, it reads `gkeys.bin` and the bake's check file, `checks.json.gz`: every one-way and car-closing rule's place on its segment's own line, the areas on a roof or a deck, and the land along the ferries (C3). So direction and NO_CARS are read against the rules, not against the bake's own counts. It prints each count beside its limit and exits 1 on any failure.

| Invariant (1.2) | What W1 counts | Fails at |
|---|---|---|
| The parser on broken files (the review's N1 and N2) | `routes.bin` with each count the parser loops on set past the file, the first route's points among them, and the most elements any typed array is asked for meanwhile (a spy on the constructors); a region with its second area's triangle start past the last triangle. `--parser=FILE` runs these on another copy of `lifeData.ts`, `--parser-only` stops after them | not null, an array past the file's bytes, or a throw |
| Every file parses with the shipped parser | files parsed, by version; bytes gzipped against 128 KB and 256 KB | any |
| Every edge's two nodes exist | edges whose a or b isn't a node; points more than 0.1 m outside their region | 1 |
| A node where an edge leaves its region is a PORTAL, with the same id next door | portals; portals with no twin; twins more than 1 cm apart; nodes on a region line that aren't PORTAL; edges across a line | 1 |
| Ids | an id twice in one city but a portal's twin or an area's part in another region; a key with two ids within its kind | 1 |
| Direction as mapped, BOTH where nothing says | edges by dir and class; each one-way rule at its range's middle, from the check file, against the road or rail edge of its kind and level through that place (nearest within 0.6 m, heading within 30 degrees), which must run the way the rule lets travel go; the files' one-way count against `life.stats` | 1 wrong; over 1 % not found; the counts differ |
| NO_CARS (C6) | each closing rule's place against its edge's flag; NO_CARS on a non-road; a file under minor 1 | 1 |
| Keys (C4) | every node key with no connector `way@x,z`, its place the node's within a decimetre; an edge from a node to itself (edges under 5 cm printed) | 1 |
| Files (C1) | every file in `life.regions` there with its bytes, every City region listed, none outside the bounds; a node on a region line with edges one side only where the cell across, inside the bounds, has no file | 1 |
| TUNNEL and UNDRAWN apart | tunnel edges that are also UNDRAWN; UNDRAWN km by class (motorways should come near the audit's 68 %, SOURCE) | 1 tunnel |
| A land node within 0.5 m of the tile's grid | land nodes, points, and every 4 m along every land edge, against the 65 x 65 grid, bilinear, never under `WATER_Y` on the sea (`stand()`); the worst and where. Counted apart, as known: a node where a ground way meets a drawn deck mid-span, standing on the deck's top, and its ways' steps climbing to it ("Where the ground wins", 3) | 1 over 0.5 m |
| Nothing on the ground under the drawn water | land nodes and steps on the sea more than 0.3 m under `WATER_Y` (a step crossing from a grid under it onto the sea dips that far between texels) | 1 |
| A water node at `WATER_Y`, a lake's at its height (C8) | water nodes and points on the sea off -0.6 by over 1 mm, on a lake off the grid by over 0.5 m | 1 |
| Decks on the drawn decks (C2) | edges with 60 % of their steps within 21.5 m of a drawn deck's line, between its ends, heading within 28 degrees (inside the bake's 22 m and 30), their steps within 40 m against its top, a lower level 5.5 m a level under the highest along it unless the ground holds it up; but an edge whose foot stands within 48 m of the line and more than 40 m inside its ends, a ramp beside it (the bake's 44 and 44), and the step at a foot itself | 1 over 0.3 m |
| Decks never in the ground or the water | every deck step against the grid on land (0.5 m), `WATER_Y` on the sea (1 mm: a foot on the sea at `WATER_Y` reads 2.4e-8 m under it as an f32), a lake's grid (0.5 m) | 1 |
| A sidewalk rides its carriageway | foot deck steps within 1 m of a road deck step beside them: any within 14 m at their level heading with them (the bake rides the nearest by its own samples, and between two carriageways at two heights the nearest flips; one ridden that isn't the nearest is counted), a road's foot and its last 5 m left out (the bake's 4 m), and a step at a node passing on any of its edges (one height rides one road). Counted apart, as known: a sidewalk's own foot, where a ground way meets it, and a step the ground holds over its road ("Where the ground wins", 1 and 2) | 1 over 1 m |
| Decks told apart by level | deck points within 3 m of a higher level on another structure (no chain of deck edges joins them) where the higher isn't 0.1 m higher. Pairs on one structure are its ramps between levels, counted and not checked | 1 inversion |
| Tunnels under the ground | every tunnel step over the ground or the bed by 0.5 m, but where it comes down from an end of its edge at 10 % or less | 1 |
| FERRY and WATER edges on water, but their last 150 m, which ends on a terminal, berth or port area | every 10 m along them against the class raster at 2 m (no tile: water); an end node of one ferry edge, not a portal or on the bounds, that no road or footway meets, off PLAZA and over 30 m from a terminal; `routes.bin`'s ends over 150 m from the terminal they name | 1 |
| The same past the map (C3) | `routes.bin`'s ferries every 10 m inside the archive's box, but within 150 m of their ends, against Overture's land (class land, OSM's coastline) within 300 m of the routes less Overture's water polygons (the coastline runs on up the Mare Island Strait), from the check file | 1 |
| Areas | the grid's points inside each area against its triangles (`stand()`: the grid, never under `WATER_Y`, a lake's grid); the sea's OPEN_WATER (`water@`): its texel centres off the sea, its vertices off `WATER_Y`, and every sea texel (WATER at 2 m or under, every texel of a slot with no tile) under it; a lake's (`lake@`, C8): its texel centres off a lake, every lake texel under one, files of minor 2; an area the bake read on a roof or a deck found in the files | 1 over 0.5 m; 1; 1 |
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

## Rebuilt to 0.6 after the review (2026-11-05)

The review of the build above found it baked to 0.5, and four majors (`DECISIONS.md`, "Life's graphs to the contract's 0.6"). The files now: 270 `g_*.bin` (195 where City has tiles, 75 open water, C1), 5.05 MB gzipped, largest 93.5 KB; `routes.bin` `SBC1`, 6.1 KB; 154,259 edges (64,300 road, 84,885 foot, 4,898 rail, 176 ferry; 852 NO_CARS, 53.9 km), 109,118 nodes, 23,465 keyed on way and place (C4). The bake: 332 s, peak 335 MB working set, 532 MB private. W1 passes every check but four, on residuals: 28 deck steps up to 1.8 m under the ground, 25 tunnel steps up to 2.8 m over it, 1 drawn-deck step 1.18 m off, 170 sidewalk steps over 1 m from their road (the Golden Gate's north end, past its drawn deck: as traced next, its north tower and its south roadway). The numbers in "Built" above are the 0.5 bake's; the third bake's are below.

## C8, N1 and the four residuals (2026-11-05, the third bake)

With `feat/earth` merged at 80e6a39 and 255beec (the contract at 0.7, then 0.8; the second account's two readings, `docs/reviews/world-graphs-2026-11-05.md`). Each residual was traced to its cause before anything changed, with throwaway scripts over the files and the bake's own passes; W1's new checks fail on the 0.6 files (b5e3d70) and pass on these.

- **C8, built.** 1,489 lakes, 344,055 texels, in 1,509 areas, a lake's part in each region (15 lakes cross a region line; the largest holds 171,062 texels, Lake Merced at 5.6 to 6.1 m), each OPEN_WATER at the grid's height, keyed `lake@<x>,<z>`, the files at 1.2. W1 now checks every lake texel under a lake's area and every sea texel under the sea's (27,637,355 of them), and a water point on a lake at the grid. On the 0.6 files: 0 of the 344,055 lake texels under an area, and minor 1. Of the 1,510 runs, 1,297 touch the sea: C10, below.
- **N1, fixed; N2 held** (it was in at 837d345). W1's parser checks fail on 2102d88's parser (the ferries' count and the first route's points asked for 1,092,288,560 and 1,073,741,824 elements) and on a copy without the triangle starts' check (it parses).
- **28 decks under the ground.** 17 were W1's own: a deck's foot on the sea stands at `WATER_Y`, which the file's f32 reads 2.4e-8 m under it; W1 compares to a millimetre now, as its water check does. 10 were sidewalk samples riding a road deck below their own ground, which riding didn't clamp (Yerba Buena Island's cycleway, 2.2 m under, beside the motorway ramp's foot; a footbridge's portal at x 2,048 a metre under): never under the ground now. 1 was a road deck's line between samples 4 m apart under a crest, 0.66 m: `lift()` samples every metre and grid line.
- **25 tunnel steps over the ground**, all the Embarcadero Center's covered sidewalks: between the street and covered stairs up to its podium at 16.6 m, the cap came down from the stairs at a ramp's 10 %, so the sidewalks 100 m from them could stand 2.5 m over the street, and did. A foot tunnel comes down at a stair's 50 % now (`GRADE_STAIR`).
- **1 drawn-deck step 1.18 m off**, the Golden Gate's south end: the southbound roadway kept the drawn top to a sample 2 m inside the deck's end and dropped to its foot past it, so W1's step between was off. A sample now stands just inside each end of a drawn deck, and the drop is past it.
- **170 sidewalk steps over 1 m from their road.** 47 were the Golden Gate's south path, rightly on the drawn deck's top, beside a roadway 4 to 6 m over it: the roadway's foot, 0.4 m inside the drawn deck's end, made it a "ramp off" the deck (the rule read whether a foot lay inside a drawn deck at all), and it was profiled over the water instead. A foot by a drawn deck's end is the deck meeting the ground now; a ramp's is more than 44 m inside. 4 were the north tower's 23 m spike ("Where the ground wins", 3). The rest were the bake riding the nearest road it had placed before, never one of its own structure's or placed after it, and matching headings at shared nodes by the last piece's alone (a crossing's stood for a road's): a second pass rides every sidewalk sample against every road deck as placed, by its own pieces' segments, and a road's foot and its last 4 m are no carriageway. What's left is the ground's, counted ("Where the ground wins", 1 and 2).

W1, after: every check passes, exit 0, with the known exceptions counted: 1 node a drawn deck holds (23.0 m over the ground) and 1 step climbing to it; 33 sidewalk steps at their own feet (worst 9.5 m from their road) and 12 the ground holds over it (worst 4.2 m); 11 riding a road beside them that isn't the nearest. On the 0.6 files the same W1 fails 5 checks: decks under the ground (11), tunnels (25), the drawn decks (154 over 0.3 m: its ramp rule reads feet by the ends now), sidewalks (104 over 1 m) and lakes (0 of 344,055). The bake: 202 s at below-normal priority, peak 443 MB working set and 534 MB private. 270 files, 5.14 MB gzipped (10.91 MB raw), the largest 102.7 KB (Golden Gate Park's east, its lakes in it now; the contract's 128 KB). 114,892 nodes, 154,259 edges, 2,800 areas (OPEN_WATER 1,674: the sea's 165 and the lakes' 1,509), 586,447 triangles. In the decks: 4,086 samples on a drawn deck, 942 riding a road deck in the first pass and 157 more in the second (4 structures profiled again), 376 points lifted to the ground between samples, 1 junction held on the Golden Gate.

## Left for later

- **C10** (below), once the second account answers it, and the city's raised water by its piers, which is City's.
- **Places and buildings** (items 5 and 1, waiting on the producer's OK of their sizes): a cruise terminal at Pier 27 (nothing in tonight's types names one, so life's "one cruise ship at Pier 27" has no terminal yet), and better names and outlines for terminals and marinas.
- **The Bay beyond the city** (O10, the world's call by stage 1's first week): San Francisco's map grown, or maps for Oakland and Marin. Either needs city tiles there first (any-city, `VERDICT.md` step 4; GLO-30 and WorldCover are in the archive). The graph bake is the same code on any map.
- **The ocean lanes**, `lanes.bin` and W4, from the World Bank's commercial layer (item 15, still zipped, 480 MB), with in-map WATER edges from the same raster.
- **`airports.bin`** for the planet (O11): every airport with scheduled service in OurAirports.
- **The coastline**, item 20: a retry, for W4.
- **LiDAR on decks**: a download of the decks' own points, so the profile is LiDAR's wherever it can be.
- **W2** once a second bake exists; **W5** with City's `onRegion`.
- **Freeway surfaces** (bridges steps 4 and 5): as each is drawn, its edges lose UNDRAWN.
- **The Bay's pass 2**: its keys spilled too, since it would hold 17 times San Francisco's 264,509. Until then the bake stops at its 950 MB guard on a map much bigger than San Francisco's (the review's minor: holds, not fixed; no other map has tiles yet).
- **Areas on roofs and decks** (18 on this map, Salesforce Park and Rooftop Park among them): left out until the buildings (item 1) give them a roof to stand on.

## CONTRACT: changes

For the second account. Each is Proposed until it marks it Agreed, and then goes into `CONTRACT.md` in a commit whose message starts `CONTRACT:` (section 8). **C1 to C7 are Agreed (0.6), C8 (0.7) and C9 (0.8), and all nine are built as each says**; the "until Agreed" lines are the bakes' before them. C10 is open.

The five it can't meet as written:

- **C1. Graphs where City has no tile** (1.2, the files; 1.4). As written, a graph file sits on City's region grid and life finds the files through `city.json`'s `regions`, which lists only the 195 regions with tiles. 75 of the 270 cells inside the bounds have none, and they're the open water: the ferries to Marin and the East Bay cross them on their way off the map, and the sailboats would sail there (read off the region grid, not measured route by route). Proposed: a graph file in every cell inside the bounds with anything in it. A cell with no tile holds OPEN_WATER whole, at `WATER_Y`, and the ferry edges across it. `city.json` lists them, `"life": { "graph": 1, "routes": 1, "regions": [[rx, rz, bytes], ...] }`, and life reads that in place of `regions`. Old readers skip the key. Until Agreed: files only where City has a region, ferries whole from `routes.bin`, no OPEN_WATER in those 75 cells. Built so: 121 ferry pieces and 4 foot pieces fell in those cells and are in no file, 35 nodes end on a line to one (W1 counts them), and `routes.bin` has all 20 routes whole.
- **C2. Decks City draws** (1.2, the heights). As written, a deck's y comes from the graph's own data, San Francisco's landmark decks are only a check, and y is what a mover stands on. On a drawn deck those disagree. With no LiDAR, the rule puts the Golden Gate at 74 m and the Bay Bridge at 73 m (`BRIDGES.md`), where their drawn decks rise from 57 to 77 m and from 29 to 79 m (`city.json`), so cars would hover over or sink into the two bridges the opening shows. Proposed: an edge on a deck City draws takes that deck's top, within 0.3 m (W1), and every other deck takes the profile. Today the drawn decks are San Francisco's two landmark rows. From bridges step 5 they're `bridges.bin`'s, made by the same `decks.py`, so the two agree by construction. It's no San Francisco code: it's whatever a city draws. The pick this plan started from, "decks from the landmarks", is this change. Until Agreed: the profile everywhere, and W1 prints the gap on the two bridges. Built so: 4,464 deck samples within 15 m of the drawn decks miss their top by a median 9.4 m, 90th percentile 21.9 m, worst 37.1 m, the profile 8.2 m low on average.
- **C3. The coastline past the map** (1.2; W4). As written, past a map the check is against OSM's land polygons, a download. Item 20 didn't come: its host refused the connection (`DOWNLOADS.md`). Overture's `land` rows of class land, in the same archive, are made from OSM's coastline (their source is OpenStreetMap with no element named, MEASURED; 27 polygons inside the bounds), and the city bake already takes the sea from them (`osm.py`, `water()`). Proposed: inside an Overture extract's box, W1 checks the ferries past the map against those. W4 keeps item 20 for the oceans. Until Agreed: W1 checks the ferries inside the map only, and says so. Built so.
- **C4. Keys for nodes with no connector** (1.3). As written, a PORTAL keys on its way and the region line, `w31772645@x-7168.0`. A piece with no junction can cross one line twice (a winding road), and then two portals share a key, which W2 can't tell apart. A cut where a range ends, such as a bridge starting inside a segment, has no key form at all. MEASURED on San Francisco's map tonight: the contract's key names two places or more for 309 keys, 659 nodes (ways that cross one line twice or run along it). With one key a way's two crossings would be one node, an edge jumping between them. And 17,623 nodes have no form at all: cuts at the bounds, at a range's end and at segment ends with no connector. Proposed: every node with no connector keys on its edge's OSM way and its own place in whole decimetres of the map, `w31772645@-71680,-22103`. **Built so for the nodes the contract can't key, and only those**: a portal keys by the contract's form wherever that names one place (5,096 nodes), by this one where it names more, and every node with no form by this one. Ids are opaque to life (1.3: nothing saved or shared keys on them), so another form changes only `gkeys.bin` and those nodes' ids, at the next bake. OPEN_WATER has no source key either (it's the class raster's): `water@<rx>,<rz>`, one area a region.
- **C5. Map metres from the routes parser** (1.2). As written, the files table says the parser also gives map metres, and `CityRoutes` has no field for them. Proposed: `parseCityRoutes(buf, origin)` adds `xz: Float32Array` to each ferry, and `x` and `z` to each terminal, marina, airport and runway end, from `geo.ts`. Old readers skip them. Until Agreed, built so: `parseCityRoutes(buf)`, degrees only, as `CityRoutes` is written.

And one found while building:

- **C8. Lakes stand where the city draws them** (1.2, the water's surface). **Agreed, 0.7; built** ("C8, N1 and the four residuals", above). As written, the water's surface is `WATER_Y` on every map today. On San Francisco's map that holds for the sea and the Bay: of the 4.11 million WATER texels on its tiles, 3.59 million sit at 0.5 m or under in the grid (2.73 million under -0.3 m), and the plane draws them at -0.6 m. It doesn't hold for its lakes: 334,000 WATER texels sit 5 to 200 m up the grid (Lake Merced, Golden Gate Park's lakes), and the ground mesh draws them there, on the ground (`tiles.ts`, `meshHeights`). Between 2 and 5 m there are only 8,727 (MEASURED, every texel centre of every tile, bilinear over the grid). An area at `WATER_Y` on a lake would stand tens of metres under the water drawn there. Proposed: a WATER texel the grid holds more than 2 m up is a lake, and a lake is OPEN_WATER at the grid's height, the level the city already draws it at, so "when lakes get their own level" is today, from the grid. Until Agreed: OPEN_WATER is the sea and the Bay alone (WATER texels at 2 m or under, and tile slots and cells with no tile), flat at `WATER_Y`. Lakes have no OPEN_WATER, and any other area over a lake takes the grid there, as land does. No FERRY or WATER edge is on a lake on this map.

And one from the review of the build:

- **C9. The files' minor version, parsed** (1.3). As written, `RegionGraph` and `CityRoutes` have a `version` and no minor, so life can't tell a 1.0 file, which never sets NO_CARS, from a 1.1 file whose road has no closure. Proposed: both parsed shapes give `minor` too. A field life may read or not, so it's built: if the second account says no, it goes. **Agreed, 0.8.** The graphs are at 1.2 now: lakes as OPEN_WATER (C8), where a 1.1 file has none.

And one from building C8:

- **C10. Lakes that touch the sea are the sea's** (1.2, the water's surface; C8). As C8 is written, every WATER texel the grid holds more than 2 m up is a lake, and built so, San Francisco's map has 1,489 lakes. 1,297 of the 1,510 runs of those texels (a run is one region's part of a lake) touch the sea, 4-connected, and hold 2,053 texels between them, 0.6 % of the lakes' 344,055: they're the Bay's own water under a pier's or a quay's raised grid (the city bake lifts piers to 2.5 m, `bake.py` ~1613-1621), standing 2 to 5 m over the sea beside them, a few texels each, the largest 123 (MEASURED, every texel centre, bilinear over the grid). So the file has 1,297 lakes a boat would find a few metres over the water it berths in. Proposed: a run that touches the sea is the sea's, OPEN_WATER at `WATER_Y` with it, and a lake is a run that doesn't; the city drawing those texels on its raised ground is City's to change, not the graphs'. What it costs: a boat by a raised pier floats at sea level under the water-coloured texels the ground mesh draws there, as it does today beside them. Until Agreed: built as C8 says, those runs are lakes of their own at the grid's height, and W1 checks them as lakes.

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
